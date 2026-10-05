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
   The learner's first study week (firstWeek) and the decks he uses (goals) come from the same store. */
import { isDue } from '../domain/b1ready.js';
import { allowance, mode as modeOf } from '../domain/budget.js';
import { isWriting } from '../domain/itemids.js';
import { writingFocus } from '../domain/modules.js';
import { shownToday as buildShown } from '../domain/wordbuild-plan.js';
import * as D8 from '../domain/days.js';
import { KV as SIM_KV, DECK as SIM_DECK, dueCount, dayOf as simDay } from './practice/sim.js';
import * as St from './practice/script/store.js';
import { words as scriptWords, newShownToday } from './practice/script/plan.js';
import { scriptPlanItems } from './practice/script/today.js';

const WRITE_KV = 'practice.write';
const EXAM_AHEAD = new Set(['week', 'lastNew', 'eve', 'day']);

/** @param {any} store */
const session = store => store.get('b1.session', {}) || {};

/**
 * The learner's first study week: {day} (0 on his first day) while his first study day is less than 7 days ago,
 * or he has not studied yet; null after it. The first day is the earliest day with study minutes or a first answer in
 * any deck.
 * @param {any} store @param {string} today
 */
export function firstWeek(store, today) {
  let first = '';
  for (const [d, a] of Object.entries(store.get('activity', {}) || {})) if (a && (a.minutes || a.rounds) && (!first || d < first)) first = d;
  for (const deck of ['b1', 'speak', 'script', 'build', 'clusters']) {
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
  return {
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
  };
}

/**
 * Today's allowance and the numbers around it: the plan rows, the hub, the rounds and the Today hero all read this.
 * @param {{store: any, c: any, settings: any}} ctx
 */
export function dayAllowance({ store, c, settings }) {
  const inp = deckInputs({ store, c, settings });
  const fresh = (c.phase === 'none' || c.phase === 'after') ? firstWeek(store, c.today) : null;
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
