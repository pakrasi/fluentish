/* Practice: loading and saving. The only module in this feature that touches the store, the content pack or the
   network; everything it calls is pure (pool, compose, session, words).

   Collections it writes:
     cards 'b1'        one FSRS record per item id (the one review schedule)
     b1.session        { round, day, days, variants, cal, teil2, stats } (shapes carried over from the B1 trainer)
     words.exam        the trimmed copy of the private vocab list (words.js)
     activity          { [day]: { minutes, rounds } } for Today's runway and study days
   and appends card.reviewed events to the outbox. */
import { config } from '../../core/config.js';
import { listMistakes } from '../../data/mistakes.js';
import * as RD from '../../domain/b1ready.js';
import { buildPool } from './pool.js';
import { wordItems, fetchWords, COLLECTION as WORDS } from './words.js';
import * as C from './compose.js';
import { dayBudget } from '../../domain/budget.js';
import { slotKey } from './session.js';

// igloo.words.de and igloo.chunks.german (both precached) only feed the grader's lexicon of German word forms; without
// them the B1 content's own words do
const FILES = ['b1.items', 'b1.grammar', 'b1.bank', 'b1.plan', 'b1.nouns', 'b1.wordmap', 'igloo.words.de', 'igloo.chunks.german'];
export const VOCAB_URL = `${config.github.api}/repos/${config.resultsRepo}/contents/data/vocab.json`;

/** @type {{key: string, data: any} | null} */ let memo = null;

/**
 * The item pool for the current profile and day. Content files are cached by the content module; the pool is rebuilt
 * when the exam words, the mistakes or the phase change.
 * @param {import('../contract.js').ViewCtx} ctx
 */
export async function loadData(ctx) {
  const [items, grammar, bank, plan, nouns, wordmap, lexWords, chunksDe] = await Promise.all(FILES.map(id => ctx.content.load(id).catch(e => {
    if (id === 'b1.plan') throw e;
    return null;
  })));
  const c = ctx.clock.ctx();
  const wc = ctx.store.get(WORDS, null);
  const mistakes = listMistakes(ctx.store);
  const key = [wc?.fetchedAt || 0, c.phase, mistakes.map(m => m.id).join(',')].join('|');
  if (memo && memo.key === key) return memo.data;
  const data = /** @type {any} */ (buildPool({ items: items || [], grammar: grammar || [], bank: bank || {}, plan, nouns: nouns || {},
    words: wordItems(wc?.words, c.phase), mistakes, lexWords: Array.isArray(lexWords) ? lexWords : null, lexTexts: chunkExamples(chunksDe) }));
  data.wordmap = wordmap || {};
  memo = { key, data };
  return data;
}

/** The German example sentences of the chunk file (igloo.chunks.german: {chunks: {id: {ex}}}). @param {any} f */
const chunkExamples = f => (f && f.chunks ? Object.values(f.chunks).map((/** @type {any} */ c) => c && c.ex).filter(Boolean) : null);

/** @param {any} store */
export const session = store => store.get('b1.session', {}) || {};

/** Today's day log; an earlier day's log is moved into the history first. @param {any} store @param {string} today */
export function dayLog(store, today) {
  const s = session(store);
  const r = C.rollDay(s, today);
  if (r.rolled) store.set('b1.session', { ...s, day: r.day, days: r.days });
  return structuredClone(r.day);
}

/**
 * The composer's state for now, with today's budget (domain/budget.js: the same numbers Today's plan shows).
 * @param {{clock: any, store: any, settings: () => any}} ctx @param {any} data
 * @returns {import('./compose.js').State & {dueN: number, budget: import('../../domain/budget.js').Budget}}
 */
export function stateFor(ctx, data) {
  const c = ctx.clock.ctx();
  const cards = ctx.store.cards('b1');
  const day = dayLog(ctx.store, c.today);
  const base = { data, cards, day, c, newPerDay: 0 };
  // the review round's due count: mistakes from corrections have their own row and round
  const dueN = data.pool.reduce((/** @type {number} */ n, /** @type {any} */ it) => n + (it.area !== 'mistakes' && RD.isDue(cards[it.id], c.today, c) ? 1 : 0), 0);
  const pLeft = C.priorityLeft(base);
  const unseen = data.pool.reduce((/** @type {number} */ n, /** @type {any} */ it) => n + (it.area !== 'mistakes' && !cards[it.id]?.reps ? 1 : 0), 0);
  const budget = dayBudget({ c, settings: ctx.settings(), dueN, priorityLeft: pLeft, newShown: day.newShown || 0, poolLeft: unseen });
  base.newPerDay = budget.newPerDay;
  // Today's plan reads these without loading content
  const s = session(ctx.store), stats = { day: c.today, priorityLeft: pLeft, pool: data.pool.length, unseen, newPerDay: base.newPerDay };
  if (JSON.stringify(s.stats) !== JSON.stringify(stats)) ctx.store.set('b1.session', { ...s, stats });
  return { ...base, dueN, budget };
}

/** A forecast(day) for the scheduler's load balancing, from the cards as they are now (due dates capped for the exam). @param {Record<string, any>} cards @param {any} c the clock context */
export function forecaster(cards, c) {
  const fc = RD.forecast(cards, c.today, 8, c);
  return (/** @type {string} */ d) => fc.find(x => x.day === d)?.n || 0;
}

/** The time zone for card.reviewed ctx. */
export const tz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } };

/**
 * Save one scheduled answer: the card, its event, and the round and day logs.
 * @param {any} store @param {string} itemId @param {any} rec @param {any} event @param {{round?: any, day?: any}} logs
 */
export function saveAnswer(store, itemId, rec, event, logs) {
  if (rec) store.putCards('b1', [[itemId, rec]]);
  if (event) store.append('card.reviewed', event);
  saveLogs(store, logs);
}

/**
 * @param {any} store @param {{round?: any, slot?: string, day?: any, variants?: any[]}} logs
 *   slot: where the round lives ('today' is b1.session.round, any other kind is b1.session.rounds[slot])
 */
export function saveLogs(store, logs) {
  const s = session(store), next = { ...s };
  if ('round' in logs) {
    const slot = logs.slot || 'today';
    if (slot === 'today') next.round = logs.round;
    else {
      next.rounds = { ...(s.rounds || {}), [slot]: logs.round };
      if (s.round && slotKey(s.round) === slot) next.round = null;   // a carried-over round of this kind moves to its slot
    }
  }
  if (logs.day) next.day = logs.day;
  if (logs.variants) next.variants = logs.variants;
  store.set('b1.session', next);
}

/** Add minutes and a round to today's activity (Today's runway and study days). @param {any} store @param {string} day @param {{minutes: number, rounds?: number}} o */
export function addActivity(store, day, { minutes, rounds = 0 }) {
  store.update('activity', (/** @type {any} */ a) => {
    const cur = (a || {})[day] || { minutes: 0, rounds: 0 };
    return { ...(a || {}), [day]: { ...cur, minutes: Math.round(((cur.minutes || 0) + minutes) * 10) / 10, rounds: (cur.rounds || 0) + rounds } };
  }, {});
}

/** The last exam-word refresh this session: 'ok' | 'cached' | 'no-token' | 'error' | null (not tried yet). */
export let wordsState = /** @type {string | null} */ (null);

/** @param {any} store */
export const secrets = store => store.get('secrets', {}) || {};

/**
 * Refresh the exam words from the private repository (at most once per 10 minutes). Writes the cache when it changed.
 * @param {import('../contract.js').ViewCtx} ctx @param {{force?: boolean}} [o]
 */
export async function refreshWords(ctx, { force = false } = {}) {
  const wordmap = await ctx.content.load('b1.wordmap').catch(() => ({}));
  const cached = ctx.store.get(WORDS, null);
  const res = await fetchWords({ token: secrets(ctx.store).githubToken || null, cached, wordmap, url: VOCAB_URL, fetch: (...a) => fetch(...a), has: (/** @type {string} */ id) => !!ctx.store.cards('b1')[id]?.reps,
    now: Date.now(), online: navigator.onLine, force });
  if (res.cache && res.cache !== cached) ctx.store.set(WORDS, res.cache);
  wordsState = res.state;
  return res;
}
