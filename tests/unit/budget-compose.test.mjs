// The day's one allowance (round 3, journey #1, #2, #5): every deck's new items from one number, every deck's
// reviews counted, and the plan that comes of it in exam week, on the eve, after the exam, with no date and in a new
// learner's first week. Synthetic store only: generic ids, the bicycle fixture script.
//
// Changes from round 2, on purpose (each one is a rule that changed):
//   - dayBudget, writingBudget, simBudget, buildBudget and sideMinutes are gone: allowance() is the one rule, so the
//     tests read it (todayBudget is allowance() read from the store).
//   - "situations' minutes come off the B1 new items" becomes "every deck's share adds up to the day's number": the
//     reserve is now the sharing itself.
//   - the fixture's cards carry a first day (2026-09-01): with none, a learner with no first day is in his first
//     study week, which is its own mode now (level-fit, few decks).
//   - "no date": the day is maintenance (his goals: the script, Word building, clusters), so Word building's row is
//     on Today without a first start; the script keeps its 25 % share.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { context } from '../../src/core/clock.js';
import { composeToday } from '../../src/domain/today.js';
import { allowance, DECKS, NEW_COST } from '../../src/domain/budget.js';
import RD from '../../src/domain/b1ready.js';
import { planItems, todayBudget, simToday } from './practice-rows.mjs';
import { planItems as buildItems } from '../../src/features/build/plan.js';
import { planItems as examItems } from '../../src/features/exam/plan.js';
import { arrange } from '../../src/features/day.js';
import { stateFor } from '../../src/features/shared/data.js';
import * as P from '../../src/domain/script/parse.js';
import { MINUTES_SHARE } from '../../src/domain/script/config.js';

const t = (k, v = {}) => `${k}${Object.keys(v).length ? ' ' + JSON.stringify(v) : ''}`;
const EXAM = '2026-10-09';
const MIN = 60;
const PHASES = {
  week: { today: '2026-10-04', exam: EXAM },
  lastNew: { today: '2026-10-07', exam: EXAM },
  eve: { today: '2026-10-08', exam: EXAM },
  day: { today: EXAM, exam: EXAM },
  after: { today: '2026-10-12', exam: EXAM },
  none: { today: '2026-10-04', exam: null },
};
const settingsFor = (exam, minutes = MIN) => ({ language: 'german', minutesPerDay: minutes, newPerDay: null, practice: {}, level: 'B1',
  exam: { type: 'goethe-b1', date: exam, modules: ['lesen', 'hoeren', 'schreiben', 'sprechen'] } });
const rec = (o = {}) => ({ S: 5, D: 5, reps: 3, lapses: 0, first: '2026-09-01', last: '2026-10-01', due: '2026-10-03', stage: 1, learn: null, relearn: false, hist: [], ...o });
const range = (n, f) => Object.fromEntries(Array.from({ length: n }, (_, i) => f(String(i + 1).padStart(2, '0'))));

/** A script whose sections are all at Cue: its next step is a full run, longer than its share of the day. */
function script() {
  const de = fs.readFileSync(new URL('../fixtures/script-bicycle.md', import.meta.url), 'utf8');
  const s = P.parseScript(de, { id: P.counterIds('s') });
  const sc = { id: 'bike01', v: 1, title: 'Bike', register: 'both', deliverOn: null, targetMin: 40, status: 'active', source: { format: 'de' },
    sections: s.sections, marks: [], flagged: [], createdAt: '2026-09-20T10:00:00Z' };
  const sections = Object.fromEntries(sc.sections.map(x => [x.id, { step: 'cue', at: null, done: { listen: '2026-09-25', cue: '2026-09-30' }, marked: '2026-09-21' }]));
  return { sc, prog: { sections, runs: [], newBy: {} } };
}

/**
 * 30 B1 phrases and 6 Schreiben phrases due, plus due cards in the speak, script, build and clusters decks.
 * @param {string} today @param {{sideDecks?: boolean, more?: number}} [o] more: that many extra due cards in every deck
 */
function makeStore(today, { sideDecks = true, more = 0 } = {}) {
  const { sc, prog } = script();
  const decks = {
    b1: { ...range(30 + more, n => [`BP:s-${n}`, rec()]), ...range(6 + more, n => [`BS:a1-x${n}`, rec()]) },
    speak: sideDecks ? range(5 + more, n => [`SS:agree-${n}`, rec()]) : {},
    script: sideDecks ? { [`SR:bike01.${sc.sections[0].id}`]: rec({ due: '2026-10-20' }), 'SW:bike01.rahmen': rec() } : {},
    build: sideDecks ? range(4 + more, n => [`PD:ab${n}`, rec()]) : {},
    clusters: sideDecks ? range(8 + more, n => [`W:w${n}`, rec()]) : {},
  };
  /** @type {Record<string, any>} */
  const kv = {
    'b1.session': { stats: { day: today, priorityLeft: 120, pool: 900, unseen: 700, newPerDay: 0, writing: { unseen: 60 } }, day: { day: today, newShown: 0, rounds: 0 } },
    'speak.sim': { stats: { day: today, unseen: 40, total: 60 } },
    build: { stats: { day: today, open: 12 } },
    scripts: { [sc.id]: sc },
    'scripts.progress': { [sc.id]: prog },
  };
  return {
    cards: (/** @type {string} */ d) => decks[d] || {},
    get: (/** @type {string} */ n, /** @type {any} */ f) => (n in kv ? kv[n] : f),
    set: (/** @type {string} */ n, /** @type {any} */ v) => { kv[n] = v; },
    update: (/** @type {string} */ n, /** @type {any} */ fn, /** @type {any} */ f) => { kv[n] = fn(n in kv ? kv[n] : f); },
    attempts: () => [],
    kv, decks,
  };
}

/** Today's plan from Practice's and Word building's providers (the exam has no content here). */
function day(phaseName, o = {}) {
  const { today, exam } = PHASES[phaseName];
  const c = context({ today, exam });
  const settings = o.settings || settingsFor(exam, o.minutes);
  const store = o.store || makeStore(today, o);
  const items = [...planItems({ store, c, settings, exam: null, t }), ...buildItems({ store, c, settings, t })];
  const plan = composeToday({ ctx: c, budget: settings.minutesPerDay, items });
  return { c, settings, store, items, plan, b: todayBudget({ store, c, settings }), sim: simToday({ store, c, settings }), ids: plan.rows.map(r => r.id) };
}

test('composed budget, exam week: B1 round, Schreiben (focus), situations; side decks paused; no script row; within 60 min', () => {
  const { c, plan, b, sim, ids, items } = day('week');
  assert.equal(c.phase, 'week'); assert.equal(b.mode, 'exam');
  assert.ok(plan.minutes.planned <= MIN, `planned ${plan.minutes.planned} > ${MIN}`);
  assert.deepEqual(ids.slice(0, 2), ['practice.round', 'practice.writing'], 'Schreiben right after the review round while it is the focus');
  assert.ok(ids.includes('practice.situations'), 'situations fit the day');
  assert.ok(!items.some(r => r.id.startsWith('script.')), 'no script row while the exam is ahead');
  // Schreiben gets its share (about 8 minutes of phrases) and the B1 new items keep their floor
  assert.equal(b.writing.focus, true);
  assert.ok(b.decks.writing.newPerDay * 0.75 <= MIN * 0.3);
  assert.ok(b.decks.b1.newPerDay >= 4);
  // one number: every deck's share adds up to it; Word building and clusters are paused, their reviews go on
  assert.equal(DECKS.reduce((n, id) => n + b.decks[id].newPerDay, 0), b.newPerDay);
  assert.deepEqual([b.decks.build.newPerDay, b.decks.build.paused, b.decks.clusters.newPerDay, b.decks.clusters.paused], [0, true, 0, true]);
  assert.equal(b.reviews.due, 30 + 6 + 5 + 4 + 8, 'b1, Schreiben, situations, Word building and clusters reviews, all counted');
  assert.ok(!items.some(r => r.id === 'build.game'), 'no game while the exam is ahead');
  const br = items.find(r => r.id === 'build.round');
  assert.ok(br && !br.introducesNew && br.reviews === 4, 'Word building: its due cards only');
  // the rows the budget gives add up to the day (B1 half + Schreiben + situations), mocks keep the other half
  assert.ok(b.minutes + b.decks.writing.minutes + sim.minutes <= MIN, `${b.minutes} + ${b.decks.writing.minutes} + ${sim.minutes}`);
});

test('composed budget, exam eve: reviews only, frames to read, no new items anywhere, no script row', () => {
  const { plan, b, sim, ids, items } = day('eve');
  assert.ok(plan.minutes.planned <= MIN);
  assert.equal(b.newLeft, 0); assert.equal(b.decks.writing.newLeft, 0); assert.equal(sim.newLeft, 0);
  assert.ok(ids.includes('practice.round'));
  assert.ok(items.some(r => r.id === 'practice.writing' && !r.introducesNew), 'Schreiben: due phrases only');
  assert.ok(items.some(r => r.id === 'practice.situations' && /plan\.sim\.detail \{"n":5\}/.test(r.detail)), 'situations: the 5 due');
  assert.ok(items.some(r => r.id === 'practice.frames'));
  assert.ok(!items.some(r => r.id.startsWith('script.')));
  assert.ok(!plan.rows.some(r => r.introducesNew));
});

test('composed budget, no exam date: maintenance; scripts take at most 25 %, every goal shows, within 60 min', () => {
  const { c, plan, b, sim, ids, items } = day('none');
  assert.equal(c.phase, 'none'); assert.equal(b.mode, 'maintenance');
  assert.ok(plan.minutes.planned <= MIN, `planned ${plan.minutes.planned} > ${MIN}`);
  const sc = items.find(r => r.id === 'script.bike01');
  assert.ok(sc, `script row on Today: ${ids}`);
  assert.equal(sc.minutes, Math.round(MIN * MINUTES_SHARE), 'a 40-minute full run is capped at 15 min');
  assert.equal(sc.priority, 30, 'after the exam or with no date the script is one of his goals');
  for (const id of ['practice.round', 'practice.writing', 'practice.situations', 'build.round']) assert.ok(items.some(r => r.id === id), `${id} in ${items.map(r => r.id)}`);
  assert.equal(b.writing.focus, false, 'no exam: Schreiben is a trickle');
  assert.ok(b.decks.build.newPerDay > 0 && b.decks.clusters.newPerDay > 0, 'his goals get new items');
  assert.equal(DECKS.reduce((n, id) => n + b.decks[id].newPerDay, 0), b.newPerDay);
  assert.ok(b.minutes + b.decks.writing.minutes + sim.minutes + sc.minutes <= MIN, `${b.minutes} + ${b.decks.writing.minutes} + ${sim.minutes} + ${sc.minutes}`);
});

test('the speak and script decks never count as B1 due items or in readiness', () => {
  const { today, exam } = PHASES.week;
  const c = context({ today, exam });
  const settings = settingsFor(exam);
  const pool = [...Array.from({ length: 30 }, (_, i) => ({ id: `BP:s-${String(i + 1).padStart(2, '0')}`, area: 'speaking', group: 'g' })),
    ...Array.from({ length: 6 }, (_, i) => ({ id: `BS:a1-x${String(i + 1).padStart(2, '0')}`, area: 'writing', group: 'w' }))];
  const data = { pool, byId: new Map(pool.map(it => [it.id, it])), topics: new Map(), plan: { topics: [], traps: [], functions: [] } };
  const run = sideDecks => {
    const store = makeStore(today, { sideDecks });
    const st = stateFor({ clock: { ctx: () => c }, store, settings: () => settings }, data);
    const rd = RD.compute({ pool, store: store.cards('b1'), today, exam, phase: c.phase });
    return { due: todayBudget({ store, c, settings }).due, dueN: st.dueN, wDue: st.budget.writing.due, rd };
  };
  const a = run(true), z = run(false);
  assert.equal(a.due, 30); assert.equal(a.dueN, 30); assert.equal(a.wDue, 6);
  assert.deepEqual({ due: a.due, dueN: a.dueN, wDue: a.wDue }, { due: z.due, dueN: z.dueN, wDue: z.wDue });
  assert.deepEqual(a.rd, z.rd);
  assert.equal(a.rd.dueToday, 36);
  assert.deepEqual(Object.keys(a.rd.areas).sort(), ['speaking', 'writing']);
});

/* ---------- round 3: the one allowance ---------- */

test('the allowance in every phase and at every number of minutes: one number, its shares add up, and they fit', () => {
  for (const ph of Object.keys(PHASES)) {
    for (const minutes of [15, 30, 45, 60, 90, 120]) {
      const { b, plan, c } = day(ph, { minutes });
      const sum = DECKS.reduce((n, id) => n + b.decks[id].newPerDay, 0);
      assert.equal(sum, b.newPerDay, `${ph} ${minutes}: shares ${sum} vs ${b.newPerDay}`);
      if (!c.newItems) assert.equal(b.newPerDay, 0, `${ph}: no new items`);
      // new items and reviews fit the minutes they share, unless the floor (the few a day kept in any case) is what
      // the day gets; reviews are never cut by the allowance, Today says when they do not fit
      const newMin = DECKS.reduce((n, id) => n + b.decks[id].newPerDay * NEW_COST[id], 0);
      if (b.newPerDay > b.room.floor) assert.ok(b.reviews.minutes + b.room.fixed + newMin <= b.room.minutes + 1, `${ph} ${minutes}: ${b.reviews.minutes} + ${b.room.fixed} + ${newMin} > ${b.room.minutes}`);
      // the plan itself stays inside the minutes (no mock here), whatever the phase
      assert.ok(plan.minutes.planned <= minutes, `${ph} ${minutes}: planned ${plan.minutes.planned}`);
      // the side decks pause while an exam is ahead
      if (['week', 'lastNew', 'eve', 'day'].includes(ph)) for (const id of ['build', 'clusters']) assert.equal(b.decks[id].newPerDay, 0, `${ph}: ${id} paused`);
    }
  }
  // more minutes never mean fewer new items
  for (const ph of ['week', 'lastNew', 'after', 'none']) {
    let prev = -1;
    for (const minutes of [15, 30, 45, 60, 90, 120]) { const n = day(ph, { minutes }).b.newPerDay; assert.ok(n >= prev, `${ph} ${minutes}: ${n} < ${prev}`); prev = n; }
  }
});

test('a deck that goes over its share uses up the day: the others get less, never below 0', () => {
  const c = context(PHASES.after);
  const settings = settingsFor(EXAM);
  const decks = { b1: { due: 10 }, build: { due: 0, open: 50 }, clusters: { due: 0, shown: 0 }, speak: { due: 0, open: 40 } };
  const base = allowance({ c, settings, decks, goals: { build: true, clusters: true } });
  const over = allowance({ c, settings, decks: { ...decks, clusters: { due: 0, shown: base.newPerDay + 30 } }, goals: { build: true, clusters: true } });
  assert.equal(over.newLeft, 0, 'a map pick of many words leaves nothing new for today');
  for (const id of DECKS) assert.ok(over.decks[id].newLeft >= 0);
  const some = allowance({ c, settings, decks: { ...decks, clusters: { due: 0, shown: base.decks.clusters.newPerDay + 5 } }, goals: { build: true, clusters: true } });
  assert.equal(some.newLeft, Math.max(0, base.newPerDay - (base.decks.clusters.newPerDay + 5)), 'the day loses what the deck took over its share');
  assert.equal(some.decks.b1.newLeft, base.decks.b1.newLeft, 'the lowest value decks give first; b1 keeps its share');
});

test('no review is dropped silently: every deck\'s due cards are in the plan or counted as left out, in order of value', () => {
  // a heavy day: many due in every deck, 30 minutes
  const { b, plan, items } = day('after', { minutes: 30, more: 60 });
  assert.equal(plan.reviews.due, b.reviews.due, 'every deck\'s due cards are on a row (in the plan or under "If you have time")');
  assert.ok(plan.reviews.left > 0, 'the day cannot fit them');
  assert.equal(plan.reviews.left, plan.reviews.due - plan.reviews.planned);
  // what is left out is ordered by value: lower priority last
  const pr = plan.extra.map(r => r.priority);
  assert.deepEqual(pr, [...pr].sort((x, y) => x - y));
  assert.ok(items.filter(r => r.reviews).every(r => plan.rows.includes(r) || plan.extra.includes(r) || plan.rows.some(x => x.id === r.id)), 'no row with reviews vanishes');
  // in exam week too: Word building and clusters reviews are counted though their new cards pause
  const w = day('week', { minutes: 30, more: 20 });
  assert.equal(w.plan.reviews.due, w.b.reviews.due);
});

test('maintenance after the exam: no mock unless a next exam is set, his goals on Today', () => {
  const { today } = PHASES.after;
  const c = context({ today, exam: EXAM });
  const exam = { id: 'goethe-b1', tests: [1, 2, 3], modules: [{ id: 'lesen', name: 'Lesen', minutes: 65, max: 30, pass: 18 }, { id: 'hoeren', name: 'Hören', minutes: 40, max: 30, pass: 18 },
    { id: 'schreiben', name: 'Schreiben', minutes: 60, max: 100, pass: 60 }, { id: 'sprechen', name: 'Sprechen', minutes: 15, max: 100, pass: 60 }] };
  const store = makeStore(today);
  const settings = settingsFor(EXAM);
  assert.deepEqual(examItems({ store: { ...store, get: (n, f) => store.get(n, f) }, c, settings, exam, t }), [], 'no mock after the exam');
  const week = context(PHASES.week);
  const mock = examItems({ store, c: week, settings, exam, t });
  assert.equal(mock.length, 1); assert.equal(mock[0].module, 'schreiben', 'with the exam ahead and Schreiben weakest, its mock comes first');
  assert.equal(mock[0].noOverrun, true, 'a 60-minute module on a 60-minute day waits under "If you have time"; the task from memory is the writing');
  assert.equal(examItems({ store, c: week, settings: { ...settings, minutesPerDay: 90 }, exam, t })[0].noOverrun, undefined, 'on a 90-minute day the whole module fits');
  const { items, b } = day('after');
  assert.equal(b.mode, 'maintenance');
  assert.ok(!items.some(r => r.id === 'practice.teil2'), 'no Teil 2 talk after the exam');
  assert.ok(items.some(r => r.id === 'build.round' && r.priority === 35), 'Word building is a goal');
  assert.ok(!items.some(r => r.id === 'build.game'), 'Split or stay has no Today row any more (round 7: Today\'s family replaces it)');
  assert.ok(items.some(r => r.id === 'script.bike01' && r.priority === 30), 'the script gets its share');
});

test('a new learner\'s first week: level-fit, a few decks, nothing for the exam', () => {
  const today = '2026-10-04';
  const c = context({ today, exam: null });
  const settings = { ...settingsFor(null, 30), level: 'A2', exam: { type: null, date: null, modules: [] } };
  /** @type {Record<string, any>} */ const kv = { 'b1.session': { stats: { day: today, priorityLeft: 120, pool: 900, unseen: 900, writing: { unseen: 108 } }, day: { day: today, newShown: 0, rounds: 0 } },
    'speak.sim': { stats: { day: today, unseen: 60 } }, build: { stats: { day: today, open: 12 } } };
  const store = { cards: () => ({}), get: (n, f) => (n in kv ? kv[n] : f), set: (n, v) => { kv[n] = v; }, update: (n, fn, f) => { kv[n] = fn(n in kv ? kv[n] : f); }, attempts: () => [] };
  const b = todayBudget({ store, c, settings });
  assert.equal(b.mode, 'start');
  assert.deepEqual([b.decks.b1.newPerDay, b.decks.writing.newPerDay, b.decks.speak.newPerDay, b.decks.build.newPerDay], [8, 0, 0, 0], 'day 1: 8 items of his level, nothing else new');
  const items = [...planItems({ store, c, settings, exam: null, t }), ...buildItems({ store, c, settings, t })];
  assert.deepEqual(items.map(r => r.id), ['practice.round'], 'a first round, no Schreiben phrases, no Word building, no game');
  assert.match(items[0].title, /plan\.firstRound/);
  // day 3: situations open, but the day's whole number is the sustainable rate (hotfix: 8 at 30 min a day), which
  // the b1 items take first
  kv.activity = { '2026-10-02': { minutes: 20, rounds: 2 } };
  const d3 = todayBudget({ store, c, settings });
  assert.equal(d3.decks.speak.want, 4, 'situations want 4 from day 3');
  assert.equal(d3.newPerDay, 8, 'at most the sustainable rate');
  assert.equal(d3.decks.speak.newPerDay, 0);
  // day 8: the first week is over
  kv.activity = { '2026-09-26': { minutes: 20, rounds: 2 } };
  assert.equal(todayBudget({ store, c, settings }).mode, 'maintenance');
});

test('Today and Practice show the same numbers: b1 cards no round can ask are counted by neither', () => {
  // the 58 vs 39 case: Today counted every due b1 card (mistakes, Schreiben phrases, exam words the triage left out,
  // deleted mistakes) while Practice counted the review round's pool. Both read the allowance now.
  const { today, exam } = PHASES.after;
  const c = context({ today, exam });
  const settings = settingsFor(exam);
  const pool = [...Array.from({ length: 30 }, (_, i) => ({ id: `BP:s-${String(i + 1).padStart(2, '0')}`, area: 'speaking', group: 'g' })),
    ...Array.from({ length: 6 }, (_, i) => ({ id: `BS:a1-x${String(i + 1).padStart(2, '0')}`, area: 'writing', group: 'w' }))];
  const data = { pool, byId: new Map(pool.map(it => [it.id, it])), topics: new Map(), plan: { topics: [], traps: [], functions: [] } };
  const store = makeStore(today, { sideDecks: false });
  // 19 exam words due that the triage keeps out of today's pool, and a deleted mistake's card
  for (let i = 0; i < 19; i++) store.decks.b1[`W:old${i}`] = rec();
  store.decks.b1['F:gone-1'] = rec();
  store.kv.mistakes = { 'F:gone-1': { id: 'F:gone-1', deletedAt: '2026-10-01T00:00:00Z' } };
  const st = stateFor({ clock: { ctx: () => c }, store, settings: () => settings }, data);
  const a = todayBudget({ store, c, settings });
  assert.equal(st.dueN, 30, 'the review round: its pool');
  assert.equal(a.decks.b1.due, 30, 'the allowance: the same, the cards no round can ask are left out');
  assert.equal(st.budget.reviews.due, a.reviews.due, 'Practice\'s hub and Today\'s hero read one number');
  assert.equal(a.reviews.due, 30 + 6, 'b1 and Schreiben');
});
