/* The day's allowance from the store: every deck's due cards, new items open and new items shown today, read without
   loading content (the pool-wide numbers come from the stats each feature writes when it loads its content), then
   domain/budget.js allowance(). Today's plan, Practice's hub, every feature's plan.js and every round read this one
   function, so they show the same numbers.

   Where each deck's numbers come from:
     b1         deck b1 due cards, without mistakes (F:), Schreiben phrases (isWriting) and cards no round can ask
                ('b1.session'.stats.outside: exam words the triage left out, deleted mistakes); open: stats.unseen;
                shown: the day log's newShown
     writing    deck b1 Schreiben cards due; open: stats.writing.unseen; shown: the day log's newBy.w
     mistakes   live mistakes (data/mistakes.js) due, and not practised yet; shown: the day log's newBy.m
     speak      deck speak (SS:) due; open: kv 'speak.sim'.stats.unseen; shown: its day log
     script     deck script word cards due (SW:), words of active scripts not met yet; shown: newBy per day
     build      deck build due; open: kv 'build'.stats.open; shown: cards first answered today
     clusters   deck clusters due; shown: kv 'clusters'.day.newShown
   A course in another language (C3a) has '<lang>:<name>' decks (domain/decks.js): the legacy decks count nothing for
   it and its own decks count instead, each in the allowance deck its name gives (allowanceDeck: fr:speak in speak,
   fr:core and any other in b1): due cards, cards first answered today (shown) and the new items its feature recorded
   open today in kv 'deck.stats' (any number without a record). German has no such decks; its numbers are the legacy
   reading above, unchanged.
   The learner's first study week (firstWeek) and the decks he uses (goals) come from the same store.

   Pure over the store object it is given (get, cards; no writes, no DOM, no content), so Today, Practice's features
   and the rounds all import it from domain/ and never from one another. Also here: the numbers built on the allowance
   that more than one screen shows (todayBudget, simToday, clusterToday, dueTomorrow, roundAction). */
import { isDue, dueOn } from './b1ready.js';
import { allowance, mode as modeOf, ROUND } from './budget.js';
import { isWriting } from './itemids.js';
import { writingFocus } from './modules.js';
import { shownToday as buildShown } from './wordbuild-plan.js';
import * as D8 from './days.js';
import { KV as SIM_KV, DECK as SIM_DECK, dueCount, dayOf as simDay } from './sim.js';
import * as St from './script/store.js';
import { words as scriptWords, newShownToday } from './script/plan.js';
import { scriptPlanItems } from './script/today.js';
import { roundMinutes } from './today.js';
import { courseLang, inLang, LEGACY_DECKS, namedDecks, allowanceDeck, DECK_STATS_KV } from './decks.js';

const WRITE_KV = 'practice.write';
const EXAM_AHEAD = new Set(['week', 'lastNew', 'eve', 'day']);

/** @param {any} store */
const session = store => store.get('b1.session', {}) || {};

/** The store deck each of the allowance's decks reads (mistakes and Schreiben phrases are cards in deck b1). */
const STORE_DECK = /** @type {Record<string, string>} */ ({ b1: 'b1', writing: 'b1', mistakes: 'b1', speak: 'speak', script: 'script', build: 'build', clusters: 'clusters' });

/**
 * The legacy decks the active course reads (Arch #12): all of them for German, none for a course in another language,
 * every one without a course (as before courses). @param {any} settings @returns {readonly string[]}
 */
const courseDecks = settings => { const l = courseLang(settings); return l ? LEGACY_DECKS.filter(d => inLang(d, l)) : LEGACY_DECKS; };

/**
 * The active course's own namespaced decks in the store ('fr:core' …); none without a course, and none for German
 * today (its decks are the legacy ones). @param {any} store @param {any} settings @returns {string[]}
 */
const courseNamed = (store, settings) => namedDecks([...new Set([...Object.keys((store && store.cardsByDeck) || {}),
  // a course deck its feature has recorded today's numbers for, before its first card (C3b: a new French course)
  ...Object.keys((store && typeof store.get === 'function' && store.get(DECK_STATS_KV, {})) || {})])], courseLang(settings));

/**
 * The learner's first study week: {day} (0 on his first day) while his first study day is less than 7 days ago,
 * or he has not studied yet; null after it. The first day is the earliest day with study minutes or a first answer in
 * any deck of the active course.
 * @param {any} store @param {string} today @param {any} [settings] normalised settings (their active course)
 */
export function firstWeek(store, today, settings = null) {
  let first = '';
  for (const [d, a] of Object.entries(store.get('activity', {}) || {})) if (a && (a.minutes || a.rounds) && (!first || d < first)) first = d;
  const mine = courseDecks(settings);
  for (const deck of [...['b1', 'speak', 'script', 'build', 'clusters'].filter(d => mine.includes(d)), ...courseNamed(store, settings)]) {
    for (const r of Object.values(store.cards(deck) || {})) if (r && r.reps && r.first && (!first || r.first < first)) first = r.first;
  }
  if (!first) return { day: 0 };
  const day = D8.diff(first, today);
  return day >= 0 && day < 7 ? { day } : null;
}

/**
 * Today's Schreiben task to write from memory while Schreiben is the weakest module: the Aufgabe written least
 * recently, and in it a task not written yet (else the one written longest ago). done: a task was written today.
 * tasks: [{id, a: 'A1', title, min}] (from the content; read from the session stats when not given).
 * @param {{store: any, c: any, settings: any, tasks?: {id: string, a: string, title: string, min: number}[] | null}} o
 * @returns {{id: string, a: string, title: string, min: number, done: boolean} | null}
 */
export function writingTask({ store, c, settings, tasks = null }) {
  // the eve is for reviews and the Sprechen frames (domain/today.js), the exam day for a warm-up: no task then
  if (c.phase === 'day' || c.phase === 'eve' || !writingFocus({ store, c, settings })) return null;
  const list = tasks || (session(store).stats?.tasks) || [];
  if (!list.length) return null;
  const written = /** @type {Record<string, string>} */ ((store.get(WRITE_KV, {}) || {}).written || {});
  const today = list.find(x => written[x.id] === c.today);
  if (today) return { ...today, done: true };
  const aufs = [...new Set(list.map(x => x.a))].sort();
  const last = (/** @type {string} */ a) => list.filter(x => x.a === a).map(x => written[x.id] || '').sort().pop() || '';
  const a = aufs.sort((x, y) => last(x).localeCompare(last(y)) || x.localeCompare(y))[0];
  const mine = list.filter(x => x.a === a).sort((x, y) => (written[x.id] || '').localeCompare(written[y.id] || ''));
  return { ...mine[0], done: false };
}

/**
 * The scripts that count today: active ones; while an exam is ahead only those delivered on or before it.
 * @param {any} store @param {any} c
 */
export function liveScripts(store, c) {
  const examAhead = c.exam && EXAM_AHEAD.has(c.phase);
  return St.active(store).filter((/** @type {any} */ s) => !(examAhead && !(s.deliverOn && s.deliverOn <= c.exam)) && !(s.deliverOn && D8.diff(c.today, s.deliverOn) < 0));
}

/**
 * Every deck's inputs, read from the store.
 * @param {{store: any, c: any, settings: any}} ctx
 */
export function deckInputs({ store, c, settings }) {
  const cards = store.cards('b1') || {};
  const sess = session(store);
  const stats = sess.stats && sess.stats.day === c.today ? sess.stats : null;
  const day = sess.day && sess.day.day === c.today ? sess.day : null;
  const by = (day && day.newBy) || {};
  const outside = new Set((stats && stats.outside) || []);
  const live = Object.values(store.get('mistakes', {}) || {}).filter((/** @type {any} */ m) => m && !m.deletedAt);
  const mistakeIds = new Set(live.map((/** @type {any} */ m) => m.id));
  let due = 0, wDue = 0;
  for (const [id, r] of Object.entries(cards)) {
    if (mistakeIds.has(id) || outside.has(id) || /^F:/.test(id) || !isDue(r, c.today, c)) continue;
    if (isWriting(id)) wDue++; else due++;
  }
  const mDue = live.filter((/** @type {any} */ m) => isDue(cards[m.id], c.today, c)).length;
  const mOpen = live.filter((/** @type {any} */ m) => !cards[m.id]?.reps).length;
  // b1 new items shown today: the daily streams (newShown counts p and g)
  const b1Shown = day ? (day.newShown || 0) : 0;
  const sim = store.get(SIM_KV, {}) || {};
  const simD = simDay(sim, c.today);
  const scripts = liveScripts(store, c);
  const cardOf = St.cardOf(store);
  let sDue = 0, sOpen = 0;
  // (a script delivered today is a warm-up only: its words wait, as its Today row says)
  for (const s of scripts) {
    if (s.deliverOn === c.today) continue;
    const w = scriptWords(s, cardOf, c); sDue += w.due.filter(id => cardOf(id)?.deck === St.DECK).length; sOpen += w.fresh.length;
  }
  const bCards = store.cards('build') || {};
  const bStats = (store.get('build', {}) || {}).stats;
  const clCards = store.cards('clusters') || {};
  const cl = (store.get('clusters', {}) || {}).day;
  return withNamed(store, c, settings, inCourse(settings, {
    stats, day,
    decks: {
      b1: { due, open: stats ? (stats.unseen ?? Math.max(0, stats.pool - Object.keys(cards).length)) : Infinity, shown: b1Shown },
      writing: { due: wDue, open: stats && stats.writing ? stats.writing.unseen : 0, shown: by.w || 0 },
      mistakes: { due: mDue, open: mOpen, shown: by.m || 0 },
      speak: { due: dueCount(store.cards(SIM_DECK), c), open: sim.stats && Number.isFinite(sim.stats.unseen) ? sim.stats.unseen : Infinity, shown: simD.newShown || 0 },
      script: { due: sDue, open: sOpen, shown: newShownToday(store.get(St.PROGRESS, {}) || {}, c.today) },
      build: { due: Object.values(bCards).filter(r => r && r.reps && isDue(r, c.today, c)).length, open: bStats && bStats.day === c.today ? bStats.open : 0, shown: buildShown(bCards, c.today).all },
      clusters: { due: Object.values(clCards).filter(r => r && r.reps && isDue(r, c.today, c)).length, open: Infinity, shown: cl && cl.day === c.today ? cl.newShown || 0 : 0 },
    },
    scripts,
    started: { build: Object.values(bCards).some(r => r && r.reps), clusters: Object.values(clCards).some(r => r && r.reps) },
  }));
}

/**
 * The active course's namespaced decks added to the inputs (C3a): each deck's due cards, cards first answered today
 * and its open count (kv 'deck.stats', today's; any number without one) go to the allowance deck its name gives.
 * Inputs without such decks (German, no course) are returned as they are.
 * @template {{decks: Record<string, any>, started: Record<string, boolean>}} T
 * @param {any} store @param {any} c @param {any} settings @param {T} inp @returns {T}
 */
function withNamed(store, c, settings, inp) {
  const named = courseNamed(store, settings);
  if (!named.length) return inp;
  const stats = /** @type {Record<string, {day?: string, open?: number}>} */ (store.get(DECK_STATS_KV, {}) || {});
  for (const deck of named) {
    const k = allowanceDeck(deck), x = inp.decks[k];
    const cards = Object.values(store.cards(deck) || {});
    const st = stats[deck];
    const open = st && st.day === c.today && Number.isFinite(st.open) ? Math.max(0, /** @type {number} */ (st.open)) : Infinity;
    x.due += cards.filter(r => r && r.reps && isDue(r, c.today, c)).length;
    x.shown += cards.filter(r => r && r.reps && r.first === c.today).length;
    x.open = (x.open || 0) + open;
    if (k in inp.started && cards.some(r => r && r.reps)) inp.started[k] = true;
  }
  return inp;
}

/**
 * The inputs as the active course sees them: a deck outside it counts nothing (no due cards, nothing new, no scripts,
 * not started). German reads every legacy deck, so its inputs are left exactly as they are.
 * @template {{decks: Record<string, any>, scripts: any[], started: Record<string, boolean>, stats: any, day: any}} T
 * @param {any} settings @param {T} inp @returns {T}
 */
function inCourse(settings, inp) {
  const mine = courseDecks(settings);
  if (mine.length === LEGACY_DECKS.length) return inp;
  for (const k of Object.keys(inp.decks)) if (!mine.includes(STORE_DECK[k])) inp.decks[k] = { due: 0, open: 0, shown: 0 };
  // the b1 session's stats and day log are deck b1's (the German trainer's pool, ★ pace, Schreiben tasks)
  if (!mine.includes('b1')) { /** @type {any} */ (inp).stats = null; /** @type {any} */ (inp).day = null; }
  if (!mine.includes('script')) inp.scripts = [];
  for (const k of Object.keys(inp.started)) if (!mine.includes(k)) inp.started[k] = false;
  return inp;
}

/**
 * Today's allowance and the numbers around it: the plan rows, the hub, the rounds and the Today hero all read this.
 * @param {{store: any, c: any, settings: any}} ctx
 */
export function dayAllowance({ store, c, settings }) {
  const inp = deckInputs({ store, c, settings });
  const fresh = (c.phase === 'none' || c.phase === 'after') ? firstWeek(store, c.today, settings) : null;
  const md = modeOf(c, fresh);
  const focus = writingFocus({ store, c, settings });
  const task = writingTask({ store, c, settings, tasks: inp.stats ? inp.stats.tasks : null });
  // the script rows' minutes (a step, a run, due words; capped at their share of the day by script/plan.js) are
  // fixed time today; new script words are the script deck's share
  const scriptMin = inp.scripts.length ? scriptPlanItems({ store, c: { ...c, dayNewLeft: 0 }, settings, t: () => '' })
    .filter(r => !r.done && !r.reviews && !r.introducesNew).reduce((n, r) => n + (r.minutes || 0), 0) : 0;
  const fixedMin = (task && !task.done ? task.min : 0) + scriptMin;
  const a = allowance({
    c, settings, decks: inp.decks, priorityLeft: inp.stats ? inp.stats.priorityLeft ?? null : null, focus, fixedMin, fresh,
    goals: { script: inp.scripts.length > 0, build: md === 'maintenance' || inp.started.build, clusters: inp.started.clusters },
    examDecks: { script: md === 'exam' ? inp.scripts.length : 0 }, scripts: inp.scripts.length,
  });
  return { ...a, task, fresh, started: inp.started, stats: inp.stats, day: inp.day };
}

/**
 * Today's numbers from the store and the cached stats: the allowance (every deck), plus what the review round's row,
 * Practice's hub and the rounds read: the b1 deck's due count, rounds and minutes, the size of the next round.
 * @param {{store: any, c: any, settings: any}} ctx
 */
export function todayBudget({ store, c, settings }) {
  const a = dayAllowance({ store, c, settings });
  const b = a.decks.b1;
  const act = (store.get('activity', {}) || {})[c.today];
  const day = a.day;
  const roundsToday = Math.max(act ? act.rounds || 0 : 0, day ? day.rounds || 0 : 0);
  // a course in another language (C3b) has its round in its own decks, and its next round's size in 'deck.stats'
  const named = courseNamed(store, settings).filter(d => allowanceDeck(d) === 'b1');
  const cards = named.length ? Object.assign({}, ...named.map(d => store.cards(d) || {})) : store.cards('b1');
  const firstEver = !Object.values(cards).some(r => r && r.hist && r.hist.length);
  const ds = named.length ? /** @type {Record<string, any>} */ (store.get(DECK_STATS_KV, {}) || {}) : {};
  const own = named.map(d => ds[d]).find(x => x && x.day === c.today && Number.isFinite(x.next));
  // the next daily round's size: what the composer made of the same state (data.js stateFor), else its rule
  const next = own ? own.next : a.stats && Number.isFinite(a.stats.next) ? a.stats.next : Math.min(ROUND, b.due + Math.min(b.newLeft, firstEver ? 8 : 4));
  return { ...a, due: b.due, rounds: b.rounds, minutes: b.minutes, b1: b, writing: { ...a.decks.writing, focus: a.focus, n: a.decks.writing.due + a.decks.writing.newLeft },
    roundsToday, writeRounds: day ? day.writeRounds || 0 : 0, next };
}

/**
 * Word clusters today, from the allowance: cards due and, outside the exam, its share of new cards.
 * @param {{store: any, c: any, settings?: any}} ctx
 */
export function clusterToday({ store, c, settings }) {
  const x = dayAllowance({ store, c, settings: settings || {} }).decks.clusters;
  return { due: x.due, newLeft: x.newLeft, paused: x.paused, minutes: x.due + x.newLeft ? roundMinutes(Math.min(ROUND, x.due + x.newLeft)) : 0 };
}

/**
 * Speaking situations today: due cards, new ones left and the minutes they take (the hub and Today's row agree), from
 * the allowance's speak share.
 * @param {{store: any, c: any, settings: any}} ctx
 */
export function simToday({ store, c, settings }) {
  const x = dayAllowance({ store, c, settings }).decks.speak;
  const day = simDay(store.get(SIM_KV, {}) || {}, c.today);
  return { newPerDay: x.newPerDay, newLeft: x.newLeft, cards: x.due + 2 * x.newLeft, minutes: x.minutes, due: x.due, roundsToday: day.rounds || 0 };
}

/**
 * The label of the button that starts the next review round, shared by Today's dock and Practice's hub. It counts the
 * rounds the composed plan row shows, after Today's cut ("2 rounds today" → "Start round 1 of 2"), so the row and both
 * buttons say the same.
 * @param {{rounds: number}} b @param {number} n questions in the next round @param {(k: string, v?: any) => string} t
 */
export function roundAction(b, n, t) {
  return b.rounds > 1 ? t('plan.round.actionOf', { k: 1, total: b.rounds, n }) : t('plan.round.action', { n, min: roundMinutes(n) });
}

/**
 * Cards due tomorrow in every deck of the active course, for "Done for today. Tomorrow: about N due."
 * @param {{store: any, c: any, settings: any}} ctx
 */
export function dueTomorrow({ store, c, settings }) {
  const tomorrow = D8.add(c.today, 1);
  let n = 0;
  const mine = courseDecks(settings);
  for (const deck of [...['b1', SIM_DECK, 'script', 'build', 'clusters'].filter(d => mine.includes(d)), ...courseNamed(store, settings)]) {
    for (const [id, r] of Object.entries(store.cards(deck) || {})) {
      if (!r || !r.reps || /^SR:/.test(id)) continue;
      if ((dueOn(r, c) || '') <= tomorrow || r.learn != null || r.relearn) n++;
    }
  }
  return n;
}
