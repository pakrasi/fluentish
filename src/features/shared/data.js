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
import { loadWordIx } from './wordix.js';
import * as C from './compose.js';
import { slotKey } from './session.js';
import { todayBudget } from '../../domain/allowance.js';
import { firstWeek } from '../../domain/allowance.js';
import { marked, importPlacement } from '../../data/known.js';
import { loadAtlas, scores, totals } from '../../data/atlas.js';

// igloo.words.de and igloo.chunks.german (both precached) only feed the grader's lexicon of German word forms; without
// them the B1 content's own words do
const FILES = ['b1.items', 'b1.grammar', 'b1.bank', 'b1.plan', 'b1.nouns', 'b1.wordmap', 'igloo.words.de', 'igloo.chunks.german', 'b1.schreiben'];
export const VOCAB_URL = `${config.github.api}/repos/${config.resultsRepo}/contents/data/vocab.json`;

/** @type {{key: string, data: any, words: any[]} | null} */ let memo = null;

/**
 * The item pool for the current profile and day. Content files are cached by the content module; the pool is rebuilt
 * when the exam words, the mistakes or the phase change.
 * @param {import('../contract.js').ViewCtx} ctx
 */
export async function loadData(ctx) {
  const [items, grammar, bank, plan, nouns, wordmap, lexWords, chunksDe, schreiben] = await Promise.all(FILES.map(id => ctx.content.load(id).catch(e => {
    if (id === 'b1.plan') throw e;
    return null;
  })));
  const c = ctx.clock.ctx();
  const wc = ctx.store.get(WORDS, null);
  const mistakes = listMistakes(ctx.store);
  const key = [wc?.fetchedAt || 0, c.phase, mistakes.map(m => m.id).join(',')].join('|');
  // the placement import is per profile, the pool is not: a pool built for another profile still imports for this one
  if (memo && memo.key === key) { placeOnce(ctx, memo.data, memo.words); return memo.data; }
  const wx = Array.isArray(lexWords) ? await loadWordIx(ctx, lexWords).catch(() => null) : null;
  const data = /** @type {any} */ (buildPool({ items: items || [], grammar: grammar || [], bank: bank || {}, plan, nouns: nouns || {},
    words: wordItems(wc?.words, c.phase, wx || {}), mistakes, lexWords: Array.isArray(lexWords) ? lexWords : null, lexTexts: chunkExamples(chunksDe),
    schreiben: schreiben && Array.isArray(schreiben.items) ? schreiben : null }));
  data.wordmap = wordmap || {};
  memo = { key, data, words: Array.isArray(lexWords) ? lexWords : [] };
  placeOnce(ctx, data, memo.words);
  return data;
}

/**
 * Igloo's placement results ("known" in its Test) become marks once a profile, through the same path as "I know this"
 * (data/known.js importPlacement): a pool item under its pool id (a chunk under the B1 phrase that is its twin), any
 * other word of the list as a deck-clusters word card. Only for the profile the legacy import ran for. Never throws.
 * @param {any} ctx @param {any} data the pool @param {any[]} words the German word list
 */
function placeOnce(ctx, data, words) {
  try {
    if (!(ctx.store.get('meta', {}) || {}).migratedAt || (ctx.store.get('known', {}) || {}).placement) return;
    const raw = globalThis.localStorage && localStorage.getItem('doors.know.v1');
    const know = raw ? JSON.parse(raw) || {} : {};
    if (!Object.keys(know).length) return;
    /** @type {Map<string, string>} */ const twin = new Map();
    for (const it of data.pool) if (it.chunk) twin.set(`K:${it.chunk}`, it.id);
    const listed = new Set(words.filter(w => w && !/[…()[\]]/.test(w.w)).map(w => `W:${w.id}`));
    importPlacement(ctx, know, id => {
      if (data.byId.has(id)) return data.byId.get(id).area === 'mistakes' ? null : { deck: 'b1', id };
      if (twin.has(id)) return { deck: 'b1', id: /** @type {string} */ (twin.get(id)) };
      if (listed.has(id)) return { deck: 'clusters', id };
      return null;
    });
  } catch { /* legacy data unreadable: nothing to import */ }
}

/**
 * Igloo's placement import before anything counts what he knows: on a migrated profile it runs once (placeOnce, with
 * the pool loaded); otherwise, and every later time, it returns at once. The map's first visit used to count before
 * Practice had loaded the pool, so a migrated profile saw fewer known words there than on Today until then.
 * @param {import('../contract.js').ViewCtx} ctx
 */
export async function ensurePlacement(ctx) {
  if (!placementPending(ctx.store)) return;
  try { await loadData(ctx); } catch { /* content missing: nothing to import now */ }
}

/** Whether Igloo's placement import is still to run for this profile. @param {any} store */
export function placementPending(store) {
  if (!(store.get('meta', {}) || {}).migratedAt || (store.get('known', {}) || {}).placement) return false;
  try { const raw = globalThis.localStorage && localStorage.getItem('doors.know.v1'); return !!raw && Object.keys(JSON.parse(raw) || {}).length > 0; } catch { return false; }
}

/**
 * Words and phrases known on the whole map, of all of them: the one number Today's Where you stand and the map's
 * header show (data/atlas.js totals over domain/knowledge.js), after the placement import. Null without the map.
 * @param {import('../contract.js').ViewCtx} ctx
 * @returns {Promise<{known: number, n: number} | null>}
 */
export async function wordsKnown(ctx) {
  await ensurePlacement(ctx);
  /** @type {any} */ const A = await loadAtlas(ctx).catch(() => null);
  return A ? totals(A, await scores(ctx, A)) : null;
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
 * The composer's state for now, with today's allowance (domain/allowance.js: the same numbers Today's plan and the
 * hub show). It first writes the pool-wide stats the allowance reads ('b1.session'.stats: ★ and trap items not seen
 * yet, unseen items, the Schreiben tasks, and the b1 cards no round can ask), then reads the allowance from them.
 * @param {{clock: any, store: any, settings: () => any}} ctx @param {any} data
 * @returns {import('./compose.js').State & {dueN: number, budget: ReturnType<typeof todayBudget>}}
 */
export function stateFor(ctx, data) {
  const c = ctx.clock.ctx();
  const cards = ctx.store.cards('b1');
  const day = dayLog(ctx.store, c.today);
  const settings = ctx.settings();
  // items marked known anywhere are never introduced as new (domain/known.js); a learner below B1 meets items of his
  // level first, and only those in his first week (compose.js newOrder)
  const fresh = firstWeek(ctx.store, c.today);
  const base = { data, cards, day, c, newPerDay: 0, marked: marked(ctx.store), level: settings.level || null, fresh: !!fresh };
  let unseen = 0, wUnseen = 0;
  for (const it of data.pool) {
    if (it.area === 'mistakes' || cards[it.id]?.reps) continue;
    if (it.area === 'writing') wUnseen++; else unseen++;
  }
  // cards in deck b1 that no round can ask (an exam word the triage leaves out today, a deleted mistake): they are
  // not reviews he can do, so no count shows them
  const outside = Object.keys(cards).filter(id => !data.byId.has(id) && cards[id]?.reps).sort();
  const pLeft = C.priorityLeft(base);
  const tasks = data.writing ? data.writing.tasks.map((/** @type {any} */ x) => ({ id: x.id, a: x.aufgabe, title: x.title,
    min: (data.writing.aufgaben.find((/** @type {any} */ a) => a.id === x.aufgabe) || {}).minutes || 20 })) : [];
  const s0 = session(ctx.store);
  const write = (/** @type {any} */ stats) => { const s = session(ctx.store); if (JSON.stringify(s.stats) !== JSON.stringify(stats)) ctx.store.set('b1.session', { ...s, stats }); };
  const stats = { day: c.today, priorityLeft: pLeft, pool: data.pool.length, unseen, ...(wUnseen || data.pool.some((/** @type {any} */ it) => it.area === 'writing') ? { writing: { unseen: wUnseen } } : {}),
    ...(tasks.length ? { tasks } : {}), ...(outside.length ? { outside } : {}) };
  // the next round's size is kept from the last write while the inputs are the same, so a re-read does not churn
  write({ ...stats, ...(s0.stats && s0.stats.day === c.today && Number.isFinite(s0.stats.next) ? { next: s0.stats.next } : {}) });
  const budget = todayBudget({ store: ctx.store, c, settings });
  base.newPerDay = budget.b1.newPerDay;
  /** @type {any} */ (base).writingNew = budget.decks.writing.newPerDay;
  /** @type {any} */ (base).mistakesNew = budget.decks.mistakes.newPerDay;
  // Today's plan reads these without loading content; next is the size of the next daily round, so Today's button and
  // Practice's Start say the same number of questions
  write({ ...stats, newPerDay: base.newPerDay, next: C.compose(base).length });
  return { ...base, dueN: budget.due, budget };
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
 * @param {any} store @param {string} itemId @param {any} rec @param {any} event @param {{round?: any, day?: any}} logs @param {string} [deck] 'clusters' for a cluster round
 */
export function saveAnswer(store, itemId, rec, event, logs, deck = 'b1') {
  if (rec) store.putCards(deck, [[itemId, rec]]);
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
