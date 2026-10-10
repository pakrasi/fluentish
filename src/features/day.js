/* Today's plan, composed once for every screen that shows it: Today's rows and dock, and Practice's Start button
   (which needs the review row after Today's cut, so both say "round 1 of 2"). Core: it asks every feature's plan
   module through the registry and arranges what they offer with arrange() before domain/today.js composes the day. */
import { composeToday } from '../domain/today.js';
import { planProviders } from './registry.js';
import { todayPlan } from '../domain/allowance.js';
import FS from '../domain/fsrs.js';
import { courseLang, inLang, LEGACY_DECKS, namedDecks, deckName, examDeck, DECK_STATS_KV } from '../domain/decks.js';
import { dayPlan } from '../domain/week.js';
import { REVIEW_COST, WINDOW_REVIEW_SHARE, EVE_REVIEW_SHARE } from '../domain/budget.js';
import { context as clockContext } from '../core/clock.js';

/* ---------- the exam window (round 4, PLAN-REVIEW B3; the scheduler hotfix before the B1) ----------
   Before an exam's window (core/clock.js planPhase: 'none' until exam − 14) cards are scheduled as with no date:
   0.90 retention and no cap, so some fall due after exam − 1. The scheduler's in-window rule (fsrs.dueFor, and
   b1ready.dueOn when due dates are read) owes an exam deck's card one review before the exam unless it will still be
   recalled on the exam day with 0.90 or more (fsrs.EXAM_RECALL). When the window opens, windowRecap writes those
   reviews into the cards once (fsrs.recap: spread from tomorrow to exam − 1, each day holding at most what his
   minutes give reviews, windowCapacity, the eve least), so every deck and every reader sees it. Only the exam's decks
   (domain/decks.js examDeck: deck b1) are pulled in; Word clusters, Word building, situations and reading keep their
   own schedule, and a side card an earlier build pulled before the exam goes back to its own date (fsrs.unpull).
   It runs once per exam date, and only when the window is entered by the passage of time: the date was seen outside
   its window and is unchanged since. Setting, moving or removing a date never writes a card (the read-time cap
   covers a date moved into the window, as before). One more pass runs once: a record an earlier build wrote (no `v`)
   on a day inside the window gets the spread above for what is still ahead, so the reviews the old rule (R < 0.95,
   exam − 3 … exam − 1) put on the last three days are spread or sent back; the record then has `v: 2`.
   Device-only, no personal text:
     kv 'exam.window'  { exam: the date last seen | null, outside: it was seen before its window,
                         recapped: { [date]: { on: day, moved: n, spread?: {on, moved} } }, v: 2 }
   Running it again for a date writes nothing: a recapped card is due by exam − 1, which dueOn leaves as it is. */

export const WINDOW_KV = 'exam.window';
/** The window record's version: 2 from the hotfix (a record without it was written by an earlier build). */
export const WINDOW_V = 2;
const AHEAD = new Set(['week', 'lastNew', 'eve']);

/**
 * The next window record, and whether to recap today: the window opened today for a date seen outside it, or a
 * record from an earlier build is in its window (the one-time re-spread, `spread`). Pure.
 * @param {any} prev kv 'exam.window' @param {{today: string, exam: string|null, phase: string}} c
 * @returns {{next: any, recap: boolean, spread?: boolean}}  next === prev when nothing changed
 */
export function windowStep(prev, c) {
  const p = prev && typeof prev === 'object' ? prev : {};
  const recapped = p.recapped && typeof p.recapped === 'object' ? p.recapped : {};
  const exam = c.exam || null;
  const legacy = !!prev && p.v !== WINDOW_V;
  // a date set, moved or removed: remember it, never recap on it
  if (exam !== (p.exam ?? null)) {
    const keep = Object.fromEntries(Object.entries(recapped).filter(([d]) => d >= c.today));
    return { next: { exam, outside: !!exam && c.phase === 'none', recapped: keep, v: WINDOW_V }, recap: false };
  }
  if (!exam) return { next: prev, recap: false };
  if (c.phase === 'none') return p.outside ? { next: prev, recap: false } : { next: { ...p, outside: true, recapped, v: WINDOW_V }, recap: false };
  if (p.outside && AHEAD.has(c.phase) && !recapped[exam]) {
    // the window has opened since the date was seen outside it
    return { next: { ...p, outside: false, recapped: { ...recapped, [exam]: { on: c.today, moved: 0 } }, v: WINDOW_V }, recap: true };
  }
  if (legacy && AHEAD.has(c.phase)) {
    // an earlier build's record inside the window: spread what is still ahead, once
    const was = recapped[exam] || { on: c.today, moved: 0 };
    return { next: { ...p, outside: false, recapped: { ...recapped, [exam]: { ...was, spread: { on: c.today, moved: 0 } } }, v: WINDOW_V }, recap: true, spread: true };
  }
  if (!p.outside) return { next: prev, recap: false };
  return { next: { ...p, outside: false, ...(legacy ? {} : { v: WINDOW_V }) }, recap: false };
}

/**
 * The decks a course's exam date schedules: its legacy decks (German) and its '<lang>:<name>' decks. Script cards are
 * left out: they are capped by their script's delivery date (domain/script/plan.js fsCtx), never by the exam. The
 * recap pulls in only the exam decks among them (examDeck); the others are only checked for cards an earlier build
 * pulled in (fsrs.unpull).
 * @param {string[]} names the decks the store holds @param {string | null} lang
 */
export const windowDecks = (names, lang) => [...LEGACY_DECKS.filter(d => !lang || inLang(d, lang)), ...namedDecks(names, lang)]
  .filter(d => deckName(d) !== 'script');

/**
 * How many of the exam decks' reviews each window day can hold: a share of the day's planned minutes
 * (WINDOW_REVIEW_SHARE, the eve EVE_REVIEW_SHARE) at a review's cost. The rest of the day is the Schreiben task, a
 * mock, the situations and the side decks. Pure.
 * @param {any} settings normalised settings @param {{exam: string|null}} c
 * @returns {(day: string) => number}
 */
export function windowCapacity(settings, c) {
  return day => {
    const dc = clockContext({ today: day, exam: c.exam });
    const eve = dc.phase === 'eve';
    return Math.floor((dayPlan(settings, dc).minutes * (eve ? EVE_REVIEW_SHARE : WINDOW_REVIEW_SHARE)) / REVIEW_COST.b1 + 1e-9);
  };
}

/**
 * The cards the window moves (pure): the exam decks' reviews owed before the exam, spread by fsrs.recap over every
 * exam deck together, and the side decks' cards an earlier build pulled in, sent back (fsrs.unpull). Cards due by
 * exam − 1 are passed too, so recap spreads by the real load. Records are copied with only `due` changed.
 * @param {Record<string, Record<string, any>>} cardsByDeck @param {any} c the clock context
 * @param {(day: string) => number} [capacity] exam-deck reviews a day holds (none given: no limit)
 * @returns {Record<string, [string, any][]>}
 */
export function windowRecap(cardsByDeck, c, capacity = () => Infinity) {
  /** @type {Record<string, [string, any][]>} */ const out = {};
  if (!c.exam || !AHEAD.has(c.phase)) return out;
  const SEP = '\n';
  /** @type {Record<string, any>} */ const joint = {};
  for (const [deck, cards] of Object.entries(cardsByDeck)) if (examDeck(deck)) for (const [id, rec] of Object.entries(cards || {})) joint[deck + SEP + id] = rec;
  const moved = FS.recap(joint, c, capacity);
  for (const key of Object.keys(moved).sort()) {
    const [deck, id] = [key.slice(0, key.indexOf(SEP)), key.slice(key.indexOf(SEP) + 1)];
    (out[deck] || (out[deck] = [])).push([id, { ...cardsByDeck[deck][id], due: moved[key] }]);
  }
  for (const [deck, cards] of Object.entries(cardsByDeck)) {
    if (examDeck(deck)) continue;
    const back = FS.unpull(cards || {}, c);
    const entries = /** @type {[string, any][]} */ (Object.keys(back).sort().map(id => [id, { ...cards[id], due: back[id] }]));
    if (entries.length) out[deck] = entries;
  }
  return out;
}

/**
 * Keep the window record and recap once when the window opens (composeDay calls it before the plan is read).
 * @param {{store: any, c: any, settings: any}} o @returns {number} cards moved
 */
export function examWindow({ store, c, settings }) {
  const prev = store.get(WINDOW_KV, null);
  const { next, recap, spread } = windowStep(prev, c);
  let moved = 0;
  if (recap) {
    const decks = windowDecks(Object.keys(store.cardsByDeck || {}), courseLang(settings));
    const puts = windowRecap(Object.fromEntries(decks.map(d => [d, store.cards(d)])), c, windowCapacity(settings, c));
    for (const [deck, entries] of Object.entries(puts)) { store.putCards(deck, entries); moved += entries.length; }
    const k = /** @type {string} */ (c.exam);
    next.recapped[k] = spread ? { ...next.recapped[k], spread: { on: c.today, moved } } : { on: c.today, moved };
  }
  if (next !== prev) store.set(WINDOW_KV, next);
  return moved;
}

/**
 * The rules that need more than one feature's rows (pure, tested in node):
 *   - Schreiben while it is the weakest module: the task from memory stays the first row, and a correction waiting
 *     (a new one to read first, else a written mock not corrected yet) comes right after it as its own row; its
 *     mistakes follow (practice.mistakes). The promoted correction, and every other Schreiben mock waiting for a
 *     correction, leave the Feedback list: the plan row says how many, so each shows once.
 *   - On a day whose mock is Schreiben and the whole module fits the day (it may run over), the mock is the writing:
 *     the task from memory waits for another day.
 *   - On a day whose mock is not Sprechen, speaking situations move up (priority 28, before the mock), so their four
 *     minutes fit.
 * @param {import('../domain/today.js').PlanItem[]} items @param {import('../domain/today.js').FeedbackRow[]} feedback
 * @param {(k: string, v?: any) => string} t
 */
export function arrange(items, feedback, t) {
  let rows = [...items];
  let fb = [...feedback];
  const mock = rows.find(r => r.mock && !r.done && r.module);
  const k = rows.findIndex(r => r.id === 'practice.schreiben');
  if (k >= 0) {
    const pick = fb.find(f => f.module === 'schreiben' && f.need === 'read') || fb.find(f => f.module === 'schreiben' && f.need === 'correct') || null;
    if (pick) {
      const read = pick.need === 'read';
      const waiting = fb.filter(f => f.module === 'schreiben' && f.need === 'correct');
      const more = read ? waiting.length : waiting.length - 1;
      rows.push({ id: 'practice.correction', source: 'exam', kind: 'read', href: pick.href, minutes: read ? 5 : 3, priority: 19,
        title: t(read ? 'plan.schreiben.read' : 'plan.schreiben.get'),
        detail: [t(read ? 'plan.schreiben.readDetail' : 'plan.schreiben.getDetail', { n: pick.test }), more > 0 ? t('plan.schreiben.more', { n: more }) : null].filter(Boolean).join(' · '),
        action: t(read ? 'plan.schreiben.readAction' : 'plan.schreiben.getAction', { n: pick.test }) });
      fb = fb.filter(f => f !== pick && !(f.module === 'schreiben' && f.need === 'correct'));
    }
    if (mock && mock.module === 'schreiben' && !mock.noOverrun && !rows[k].done) rows = rows.filter(r => r.id !== 'practice.schreiben');
  }
  if (mock && mock.module !== 'sprechen') rows = rows.map(r => (r.id === 'practice.situations' ? { ...r, priority: 28 } : r));
  return { items: rows, feedback: fb };
}

/**
 * Today's setup rows (pure): "Set an exam date" only for an exam goal without a date (never for a date months away,
 * never with no exam goal); "Set your next exam" after the exam, for a language whose content has a mock exam.
 * @param {any} s settings @param {{exam: string|null, phase: string}} c @param {any} manifest
 * @param {(k: string, v?: any) => string} t
 * @returns {import('../domain/today.js').PlanItem[]}
 */
export function setupRows(s, c, manifest, t) {
  /** @type {import('../domain/today.js').PlanItem[]} */ const out = [];
  if (s.language && s.exam?.type && !c.exam) out.push({ id: 'today.setDate', source: 'today', kind: 'setup', title: t('plan.setDate'), detail: t('plan.setDate.detail'), minutes: 0, href: '#/profile/goal', priority: 90 });
  // a language with no mock exam in the content (French, C3b) is studied without a date: no prompt for the next one
  const examLang = !manifest || (manifest.exams || []).some((/** @type {any} */ e) => e.language === s.language);
  if (s.language && examLang && c.phase === 'after') out.push({ id: 'today.nextExam', source: 'today', kind: 'setup', title: t('plan.nextExam'), detail: t('plan.nextExam.detail'), minutes: 0, href: '#/profile/goal', priority: 90 });
  return out;
}

/**
 * Let every feature refresh the stats its plan rows read without content (Practice's pool stats, Word building's open
 * cards and the day's family board, the situations' bank, reading's next text). This is the slow part of the day:
 * it loads the content. Never throws (each prepare() catches its own errors; offline, the plan reads the last stats).
 * Call it after a composeDay (which keeps the exam window first), then compose again: the plan is then the one
 * composeDay(ctx) gives in one call.
 * @param {import('./contract.js').ViewCtx} ctx @param {any[]} [providers] planProviders(), when already loaded
 */
export async function prepareDay(ctx, providers) {
  const ps = providers || /** @type {any[]} */ (await planProviders());
  await Promise.all(ps.map(p => p.mod.prepare?.(ctx)));
}

/**
 * Whether the stats the plan reads without content were written today (pure over the store): German's trainer stats
 * in 'b1.session' and Word building's open count, or for a course in another language its decks' 'deck.stats'. Today
 * draws its plan before prepareDay only then; on the day's first visit the counts would be yesterday's. With no
 * language there is nothing to prepare.
 * @param {any} store @param {{today: string}} c @param {any} settings normalised settings
 */
export function statsFresh(store, c, settings) {
  if (!settings || !settings.language) return true;
  const lang = courseLang(settings);
  if (!lang || LEGACY_DECKS.some(d => inLang(d, lang))) {
    const b1 = (store.get('b1.session', {}) || {}).stats;
    const build = (store.get('build', {}) || {}).stats;
    return !!b1 && b1.day === c.today && (settings.language !== 'german' || (!!build && build.day === c.today));
  }
  const ds = store.get(DECK_STATS_KV, {}) || {};
  return Object.entries(ds).some(([d, x]) => inLang(d, lang) && !!x && x.day === c.today);
}

/**
 * @param {import('./contract.js').ViewCtx} ctx @param {{prepare?: boolean}} [o] prepare: let features refresh their
 *   cached stats first (prepareDay; Practice has just built its own). Today composes without it to draw at once, then
 *   runs prepareDay and composes again (features/today/index.js).
 */
export async function composeDay(ctx, { prepare = true } = {}) {
  const { store, t } = ctx;
  const s = ctx.settings();
  const c = ctx.clock.ctx();
  const manifest = await ctx.content.manifest().catch(() => null);
  const exam = manifest && s.exam.type ? manifest.exams.find((/** @type {any} */ e) => e.id === s.exam.type) || null : null;
  const lang = manifest && s.language ? manifest.languages.find((/** @type {any} */ l) => l.id === s.language) : null;
  // the exam window opening: pull in the reviews owed before the exam, once (above), before any plan reads a card
  try { examWindow({ store, c, settings: s }); } catch (e) { console.error('today: exam window', e); }
  /** @type {any[]} */ const items = [], feedback = [], modules = [];
  const providers = /** @type {any[]} */ (await planProviders());
  if (prepare) await prepareDay(ctx, providers);   // e.g. Practice's pool stats, so both tabs read one budget
  // today's plan from the week (domain/allowance.js todayPlan: the slot fitted to today's reviews, after the stats
  // above); the round 3 day without a week
  const pctx = { store, c, settings: s, exam, t, day: todayPlan({ store, c, settings: s }) };
  for (const { id, mod } of providers) {
    try {
      items.push(...((await mod.planItems?.(pctx)) || []));
      feedback.push(...(mod.todayFeedback?.(pctx) || []));
      modules.push(...(mod.todayModules?.(pctx) || []));
    } catch (e) { console.error(`today: ${id}`, e); }
  }
  items.push(...setupRows(s, c, manifest, t));
  const a = arrange(items, feedback, t);
  const activity = store.get('activity', {}) || {};
  // on the exam day nothing asks for work: no corrections to read, only the warm-up
  const plan = composeToday({ ctx: c, budget: pctx.day.planned ? pctx.day.minutes : s.minutesPerDay, items: a.items, feedback: c.phase === 'day' ? [] : a.feedback, modules, doneMinutes: activity[c.today]?.minutes || 0 });
  return { plan, exam, lang, c, settings: s, activity };
}
