/* Today's plan, composed once for every screen that shows it: Today's rows and dock, and Practice's Start button
   (which needs the review row after Today's cut, so both say "round 1 of 2"). Core: it asks every feature's plan
   module through the registry and arranges what they offer with arrange() before domain/today.js composes the day. */
import { composeToday } from '../domain/today.js';
import { planProviders } from './registry.js';
import { dayPlan } from '../domain/week.js';
import FS from '../domain/fsrs.js';
import { dueOn } from '../domain/b1ready.js';
import { add } from '../domain/days.js';
import { courseLang, inLang, LEGACY_DECKS, namedDecks, deckName } from '../domain/decks.js';

/* ---------- the exam window (round 4, PLAN-REVIEW B3) ----------
   Before an exam's window (core/clock.js planPhase: 'none' until exam − 14) cards are scheduled as with no date:
   0.90 retention and no cap, so some fall due after exam − 1. The scheduler's in-window rule (fsrs.dueFor, and
   b1ready.dueOn when due dates are read) owes those cards one review before the exam unless they will still be
   recalled on the exam day (R ≥ 0.95). When the window opens, windowRecap writes that review into the cards once
   (fsrs.recap: spread over exam−3 … exam−1 by load), so every deck and every reader sees it.
   It runs once per exam date, and only when the window is entered by the passage of time: the date was seen outside
   its window and is unchanged since. Setting, moving or removing a date never writes a card (the read-time cap
   covers a date moved into the window, as before). Device-only, no personal text:
     kv 'exam.window'  { exam: the date last seen | null, outside: it was seen before its window,
                         recapped: { [date]: { on: day, moved: n } } }
   Running it again for a date writes nothing: a recapped card is due by exam − 1, which dueOn leaves as it is. */

export const WINDOW_KV = 'exam.window';
const AHEAD = new Set(['week', 'lastNew', 'eve']);

/**
 * The next window record, and whether the window opened today for a date seen outside it (pure).
 * @param {any} prev kv 'exam.window' @param {{today: string, exam: string|null, phase: string}} c
 * @returns {{next: any, recap: boolean}}  next === prev when nothing changed
 */
export function windowStep(prev, c) {
  const p = prev && typeof prev === 'object' ? prev : {};
  const recapped = p.recapped && typeof p.recapped === 'object' ? p.recapped : {};
  const exam = c.exam || null;
  // a date set, moved or removed: remember it, never recap on it
  if (exam !== (p.exam ?? null)) {
    const keep = Object.fromEntries(Object.entries(recapped).filter(([d]) => d >= c.today));
    return { next: { exam, outside: !!exam && c.phase === 'none', recapped: keep }, recap: false };
  }
  if (!exam) return { next: prev, recap: false };
  if (c.phase === 'none') return p.outside ? { next: prev, recap: false } : { next: { ...p, outside: true, recapped }, recap: false };
  if (!p.outside) return { next: prev, recap: false };
  // the window has opened since the date was seen outside it
  const recap = AHEAD.has(c.phase) && !recapped[exam];
  return { next: { ...p, outside: false, recapped: recap ? { ...recapped, [exam]: { on: c.today, moved: 0 } } : recapped }, recap };
}

/**
 * The decks a course's exam date schedules: its legacy decks (German) and its '<lang>:<name>' decks. Script cards are
 * left out: they are capped by their script's delivery date (domain/script/plan.js fsCtx), never by the exam.
 * @param {string[]} names the decks the store holds @param {string | null} lang
 */
export const windowDecks = (names, lang) => [...LEGACY_DECKS.filter(d => !lang || inLang(d, lang)), ...namedDecks(names, lang)]
  .filter(d => deckName(d) !== 'script');

/**
 * The cards the opening window pulls in (pure): per deck, every card due after exam − 1 that the in-window rule owes a
 * review before the exam (b1ready.dueOn moves it), given a due date by fsrs.recap. Cards due by exam − 1 are passed
 * too, so recap spreads by the real load; they never move. Records are copied with only `due` changed.
 * @param {Record<string, Record<string, any>>} cardsByDeck @param {any} c the clock context
 * @returns {Record<string, [string, any][]>}
 */
export function windowRecap(cardsByDeck, c) {
  /** @type {Record<string, [string, any][]>} */ const out = {};
  if (!c.exam || !AHEAD.has(c.phase)) return out;
  const cap = add(c.exam, -1);
  for (const [deck, cards] of Object.entries(cardsByDeck)) {
    /** @type {Record<string, any>} */ const pick = {};
    for (const [id, rec] of Object.entries(cards || {})) {
      if (!rec || !rec.reps || !rec.due) continue;
      if (rec.due <= cap || dueOn(rec, c) !== rec.due) pick[id] = rec;
    }
    const moved = FS.recap(pick, c);
    /** @type {[string, any][]} */ const entries = Object.keys(moved).sort().map(id => [id, { ...cards[id], due: moved[id] }]);
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
  const { next, recap } = windowStep(prev, c);
  let moved = 0;
  if (recap) {
    const decks = windowDecks(Object.keys(store.cardsByDeck || {}), courseLang(settings));
    const puts = windowRecap(Object.fromEntries(decks.map(d => [d, store.cards(d)])), c);
    for (const [deck, entries] of Object.entries(puts)) { store.putCards(deck, entries); moved += entries.length; }
    next.recapped[/** @type {string} */ (c.exam)] = { on: c.today, moved };
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
 * @param {import('./contract.js').ViewCtx} ctx @param {{prepare?: boolean}} [o] prepare: let features refresh their
 *   cached stats first (Today does; Practice has just built its own)
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
  const pctx = { store, c, settings: s, exam, t, day: dayPlan(s, c) };
  /** @type {any[]} */ const items = [], feedback = [], modules = [];
  const providers = /** @type {any[]} */ (await planProviders());
  if (prepare) await Promise.all(providers.map(p => p.mod.prepare?.(ctx)));   // e.g. Practice's pool stats, so both tabs read one budget
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
  const plan = composeToday({ ctx: c, budget: s.minutesPerDay, items: a.items, feedback: c.phase === 'day' ? [] : a.feedback, modules, doneMinutes: activity[c.today]?.minutes || 0 });
  return { plan, exam, lang, c, settings: s, activity };
}
