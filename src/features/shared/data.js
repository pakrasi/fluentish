/* Practice: loading and saving. The only module in this feature that touches the store, the content pack or the
   network; everything it calls is pure (pool, compose, session, words).

   Collections it writes:
     cards 'b1'        one FSRS record per item id (the one review schedule)
     b1.session        { round, day, days, variants, cal, teil2, stats } (shapes carried over from the B1 trainer)
     words.exam        the trimmed copy of the private vocab list (words.js)
     activity          { [day]: { minutes, rounds } } for Today's runway and study days
   and appends card.reviewed events to the outbox. */
import { config } from '../../core/config.js';
import { resultsRepo } from '../../data/connection.js';
import { github } from '../../data/credentials.js';
import { listMistakes, backfillContext } from '../../data/mistakes.js';
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
import { courseRound, buildCoursePool } from './course.js';
import { langCode } from '../../data/settings.js';
import { packFor } from '../../core/lang.js';
import { DECK_STATS_KV } from '../../domain/decks.js';

// igloo.words.de and igloo.chunks.german (both precached) only feed the grader's lexicon of German word forms; without
// them the B1 content's own words do
const FILES = ['b1.items', 'b1.grammar', 'b1.bank', 'b1.plan', 'b1.nouns', 'b1.wordmap', 'igloo.words.de', 'igloo.chunks.german', 'b1.schreiben'];
// the B2 layer's sources (pool.js b2Layer; round 4, L1b), all in the German pack's precache; without them data.b2 is empty
const B2_FILES = ['igloo.grammar.items.de', 'igloo.grammar.concepts.de', 'b1.annot', 'igloo.chunks.en', 'igloo.chunks.accept.german'];
// the forms table, for the grader's verb forms (pool.js verbIndex; round 4); without it the word list's verbs only
const FORM_FILES = ['b1.forms'];
/** The exam words file in the profile's results repository (data/connection.js), or null without one. @param {any} store */
export const vocabUrl = store => { const r = resultsRepo(store); return r ? `${config.github.api}/repos/${r}/contents/data/vocab.json` : null; };

/** @type {{key: string, data: any, words: any[]} | null} */ let memo = null;
/** @type {{key: string, data: any} | null} */ let courseMemo = null;

/**
 * Where the active course's review round lives (shared/course.js): German's is the B1 trainer's deck 'b1' and session
 * 'b1.session'; another language's is '<lang>:core' and '<lang>.session'.
 * @param {{settings: () => any}} ctx
 */
export const roundOf = ctx => courseRound(langCode(ctx.settings().language));

/**
 * The item pool for the current profile and day. Content files are cached by the content module; the pool is rebuilt
 * when the exam words, the mistakes or the phase change.
 * @param {import('../contract.js').ViewCtx} ctx
 */
export async function loadData(ctx) {
  const cr = roundOf(ctx);
  if (!cr.trainer) return loadCourse(ctx, cr.lang);
  const [items, grammar, bank, plan, nouns, wordmap, lexWords, chunksDe, schreiben, b2Grammar, b2Concepts, annot, chunksEn, accept, formsTable] = await Promise.all([...FILES, ...B2_FILES, ...FORM_FILES].map(id => ctx.content.load(id).catch(e => {
    if (id === 'b1.plan') throw e;
    return null;
  })));
  const c = ctx.clock.ctx();
  const wc = ctx.store.get(WORDS, null);
  // mistakes from before round 5: the words around them in the text they came from, written once (an added field)
  try { backfillContext(ctx.store, { feedback: ctx.store.get('exams.feedbackLocal', []) || [] }); } catch { /* a card without context still works */ }
  const mistakes = listMistakes(ctx.store);
  const key = [wc?.fetchedAt || 0, c.phase, mistakes.map(m => (m.context ? `${m.id}+` : m.id)).join(',')].join('|');
  // the placement import is per profile, the pool is not: a pool built for another profile still imports for this one
  if (memo && memo.key === key) { placeOnce(ctx, memo.data, memo.words); return memo.data; }
  const wx = Array.isArray(lexWords) ? await loadWordIx(ctx, lexWords).catch(() => null) : null;
  const data = /** @type {any} */ (buildPool({ items: items || [], grammar: grammar || [], bank: bank || {}, plan, nouns: nouns || {},
    words: wordItems(wc?.words, c.phase, wx || {}), mistakes, lexWords: Array.isArray(lexWords) ? lexWords : null, lexTexts: chunkExamples(chunksDe),
    schreiben: schreiben && Array.isArray(schreiben.items) ? schreiben : null, forms: formsTable || null,
    b2: Array.isArray(b2Grammar) || Array.isArray(chunksEn) ? { grammar: Array.isArray(b2Grammar) ? b2Grammar : null, concepts: Array.isArray(b2Concepts) ? b2Concepts : null,
      annot: annot || null, en: Array.isArray(chunksEn) ? chunksEn : null, de: chunksDe && chunksDe.chunks ? chunksDe.chunks : null, accept: accept || null } : null }));
  data.wordmap = wordmap || {};
  memo = { key, data, words: Array.isArray(lexWords) ? lexWords : [] };
  placeOnce(ctx, data, memo.words);
  return data;
}

/**
 * The pool of a course in another language (shared/course.js): its phrase cards (content course.<lang>) and word
 * cards (igloo.words.<lang>), graded through the language's pack. Cached per language.
 * @param {import('../contract.js').ViewCtx} ctx @param {string} lang
 */
async function loadCourse(ctx, lang) {
  const pack = packFor(lang);
  if (!pack) throw new Error(`no pack for ${lang}`);
  const [course, words, chunks] = await Promise.all([`course.${lang}`, `igloo.words.${lang}`, `igloo.chunks.${pack.legacyId}`].map(id => ctx.content.load(id).catch(e => {
    if (id === `course.${lang}`) throw e;
    return null;
  })));
  const key = lang;
  if (courseMemo && courseMemo.key === key) return courseMemo.data;
  const data = buildCoursePool({ course, words: Array.isArray(words) ? words : null, pack, t: ctx.t, lang, texts: chunkExamples(chunks) || [] });
  courseMemo = { key, data };
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
  if (!roundOf(ctx).trainer) return null;   // the map is German's (a course in another language has none, C3b)
  await ensurePlacement(ctx);
  /** @type {any} */ const A = await loadAtlas(ctx).catch(() => null);
  return A ? totals(A, await scores(ctx, A)) : null;
}

/** The German example sentences of the chunk file (igloo.chunks.german: {chunks: {id: {ex}}}). @param {any} f */
const chunkExamples = f => (f && f.chunks ? Object.values(f.chunks).map((/** @type {any} */ c) => c && c.ex).filter(Boolean) : null);

/** A round's session (kv 'b1.session' for German; '<lang>.session' for another course). @param {any} store */
export const session = (store, kv = 'b1.session') => store.get(kv, {}) || {};

/** Today's day log; an earlier day's log is moved into the history first. @param {any} store @param {string} today */
export function dayLog(store, today, kv = 'b1.session') {
  const s = session(store, kv);
  const r = C.rollDay(s, today);
  if (r.rolled) store.set(kv, { ...s, day: r.day, days: r.days });
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
  if (data && data.course) return courseState(ctx, data);
  const c = ctx.clock.ctx();
  const cards = ctx.store.cards('b1');
  const day = dayLog(ctx.store, c.today);
  const settings = ctx.settings();
  // items marked known anywhere are never introduced as new (domain/known.js); a learner below B1 meets items of his
  // level first, and only those in his first week (compose.js newOrder)
  const fresh = firstWeek(ctx.store, c.today, settings);
  const base = { data, cards, day, c, newPerDay: 0, marked: marked(ctx.store), level: settings.level || null, fresh: !!fresh };
  // the level gate (domain/levels.js): which strands take B2 new items today; shut without a B2 level goal
  /** @type {any} */ (base).gate = C.gateFor(base, settings);
  let unseen = 0, wUnseen = 0;
  for (const it of data.pool) {
    if (it.area === 'mistakes' || cards[it.id]?.reps) continue;
    if (it.area === 'writing') wUnseen++; else unseen++;
  }
  // cards in deck b1 that no round can ask (an exam word the triage leaves out today, a deleted mistake): they are
  // not reviews he can do, so no count shows them
  // the B2 items the gate lets in are open new items of the b1 deck too (none while it is shut)
  unseen += C.layerOpen(base);
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

/**
 * The composer's state for a course in another language: its deck and session (shared/course.js), today's allowance
 * (its deck counts in the daily round's share, domain/allowance.js), and the counts the allowance and Today read
 * without loading content, in kv 'deck.stats'[deck]: {day, open (items never answered), next (the next round's size)}.
 * @param {{clock: any, store: any, settings: () => any}} ctx @param {any} data
 */
function courseState(ctx, data) {
  const c = ctx.clock.ctx();
  const cr = courseRound(data.course);
  const cards = ctx.store.cards(cr.deck);
  const day = dayLog(ctx.store, c.today, cr.kv);
  const settings = ctx.settings();
  const fresh = firstWeek(ctx.store, c.today, settings);
  const base = { data, cards, day, c, newPerDay: 0, marked: marked(ctx.store), level: settings.level || null, fresh: !!fresh };
  const unseen = data.pool.filter((/** @type {any} */ it) => !cards[it.id]?.reps).length;
  const write = (/** @type {any} */ st) => {
    const all = ctx.store.get(DECK_STATS_KV, {}) || {};
    if (JSON.stringify(all[cr.deck]) !== JSON.stringify(st)) ctx.store.set(DECK_STATS_KV, { ...all, [cr.deck]: st });
  };
  const prev = (ctx.store.get(DECK_STATS_KV, {}) || {})[cr.deck];
  write({ day: c.today, open: unseen, ...(prev && prev.day === c.today && Number.isFinite(prev.next) ? { next: prev.next } : {}) });
  const budget = todayBudget({ store: ctx.store, c, settings });
  base.newPerDay = budget.b1.newPerDay;
  /** @type {any} */ (base).writingNew = 0;
  /** @type {any} */ (base).mistakesNew = 0;
  write({ day: c.today, open: unseen, next: C.compose(base).length });
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
export function saveAnswer(store, itemId, rec, event, logs, deck = 'b1', kv = 'b1.session') {
  if (rec) store.putCards(deck, [[itemId, rec]]);
  if (event) store.append('card.reviewed', event);
  saveLogs(store, logs, kv);
}

/**
 * @param {any} store @param {{round?: any, slot?: string, day?: any, variants?: any[]}} logs
 *   slot: where the round lives ('today' is b1.session.round, any other kind is b1.session.rounds[slot])
 */
export function saveLogs(store, logs, kv = 'b1.session') {
  const s = session(store, kv), next = { ...s };
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
  store.set(kv, next);
}

/** Add minutes and a round to today's activity (Today's runway and study days), per device and kind (data/activity.js). */
export { addActivity } from '../../data/activity.js';

/** The last exam-word refresh this session: 'ok' | 'cached' | 'no-token' | 'error' | null (not tried yet). */
export let wordsState = /** @type {string | null} */ (null);

/**
 * Refresh the exam words from the private repository (at most once per 10 minutes). Writes the cache when it changed.
 * @param {import('../contract.js').ViewCtx} ctx @param {{force?: boolean}} [o]
 */
export async function refreshWords(ctx, { force = false } = {}) {
  const wordmap = await ctx.content.load('b1.wordmap').catch(() => ({}));
  const cached = ctx.store.get(WORDS, null);
  const res = await fetchWords({ token: github(ctx.store), cached, wordmap, url: vocabUrl(ctx.store) || '', fetch: (...a) => fetch(...a), has: (/** @type {string} */ id) => !!ctx.store.cards('b1')[id]?.reps,
    now: Date.now(), online: navigator.onLine, force });
  if (res.cache && res.cache !== cached) ctx.store.set(WORDS, res.cache);
  wordsState = res.state;
  return res;
}
