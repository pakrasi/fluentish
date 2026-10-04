// The day budget after round 2: the B1 rounds, the Schreiben share, speaking situations and scripts composed into
// one day of 60 minutes, in exam week, on the eve and with no exam date (domain/budget.js "How the shares compose").
// Synthetic store only: generic ids, the bicycle fixture script.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { context } from '../../src/core/clock.js';
import { composeToday } from '../../src/domain/today.js';
import { dayBudget } from '../../src/domain/budget.js';
import RD from '../../src/domain/b1ready.js';
import { planItems, todayBudget, simToday, sideMinutes } from '../../src/features/practice/plan.js';
import { stateFor } from '../../src/features/practice/data.js';
import * as P from '../../src/features/practice/script/parse.js';
import { MINUTES_SHARE } from '../../src/features/practice/script/config.js';

const t = (k, v = {}) => `${k}${Object.keys(v).length ? ' ' + JSON.stringify(v) : ''}`;
const EXAM = '2026-10-09';
const MIN = 60;
const PHASES = {
  week: { today: '2026-10-04', exam: EXAM },
  eve: { today: '2026-10-08', exam: EXAM },
  none: { today: '2026-10-04', exam: null },
};
const settingsFor = exam => ({ language: 'german', minutesPerDay: MIN, newPerDay: null,
  exam: { type: 'goethe-b1', date: exam, modules: ['lesen', 'hoeren', 'schreiben', 'sprechen'] } });
const rec = (o = {}) => ({ S: 5, D: 5, reps: 3, lapses: 0, last: '2026-10-01', due: '2026-10-03', stage: 1, learn: null, relearn: false, hist: [], ...o });
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

/** 30 B1 phrases and 6 Schreiben phrases due, plus due cards in the speak and script decks. */
function makeStore(today, { sideDecks = true } = {}) {
  const { sc, prog } = script();
  const decks = {
    b1: { ...range(30, n => [`BP:s-${n}`, rec()]), ...range(6, n => [`BS:a1-x${n}`, rec()]) },
    speak: sideDecks ? range(5, n => [`SS:agree-${n}`, rec()]) : {},
    script: sideDecks ? { [`SR:bike01.${sc.sections[0].id}`]: rec({ due: '2026-10-20' }), 'SW:bike01.rahmen': rec() } : {},
  };
  /** @type {Record<string, any>} */
  const kv = {
    'b1.session': { stats: { day: today, priorityLeft: 120, pool: 900, unseen: 700, newPerDay: 0, writing: { due: 6, unseen: 60 } }, day: { day: today, newShown: 0, rounds: 0 } },
    'speak.sim': { stats: { day: today, unseen: 40, total: 60 } },
    scripts: { [sc.id]: sc },
    'scripts.progress': { [sc.id]: prog },
  };
  return {
    cards: (/** @type {string} */ d) => decks[d] || {},
    get: (/** @type {string} */ n, /** @type {any} */ f) => (n in kv ? kv[n] : f),
    set: (/** @type {string} */ n, /** @type {any} */ v) => { kv[n] = v; },
    update: (/** @type {string} */ n, /** @type {any} */ fn, /** @type {any} */ f) => { kv[n] = fn(n in kv ? kv[n] : f); },
    attempts: () => [],
    kv,
  };
}

function day(phaseName) {
  const { today, exam } = PHASES[phaseName];
  const c = context({ today, exam });
  const settings = settingsFor(exam);
  const store = makeStore(today);
  const items = planItems({ store, c, settings, exam: null, t });
  const plan = composeToday({ ctx: c, budget: MIN, items });
  return { c, settings, store, items, plan, b: todayBudget({ store, c, settings }), sim: simToday({ store, c, settings }), ids: plan.rows.map(r => r.id) };
}

test('composed budget, exam week: B1 round, Schreiben (focus), situations; no script row; within 60 min', () => {
  const { c, settings, store, plan, b, sim, ids, items } = day('week');
  assert.equal(c.phase, 'week');
  assert.ok(plan.minutes.planned <= MIN, `planned ${plan.minutes.planned} > ${MIN}`);
  assert.deepEqual(ids.slice(0, 2), ['practice.round', 'practice.writing'], 'Schreiben right after the review round while it is the focus');
  assert.ok(ids.includes('practice.situations'), 'situations fit the day');
  assert.ok(!items.some(r => r.id.startsWith('script.')), 'no script row while the exam is ahead');
  // Schreiben gets its 30 % share for new phrases and B1 new items fill what is left of their half
  assert.equal(b.writing.focus, true);
  assert.ok(b.writing.newPerDay * 0.75 <= MIN * 0.3);
  assert.ok(b.newPerDay >= 4);
  // the reserve: situations' minutes come off the B1 new items
  const without = dayBudget({ c, settings, dueN: 30, priorityLeft: 120, poolLeft: 700, writing: { due: 6, left: 60, focus: true } });
  assert.equal(sideMinutes({ store, c, settings }), sim.minutes);
  assert.ok(b.newPerDay <= without.newPerDay);
  // the budget's own rows add up to the day (B1 half + Schreiben + situations), mocks keep the other half
  assert.ok(b.minutes + b.writing.minutes + sim.minutes <= MIN, `${b.minutes} + ${b.writing.minutes} + ${sim.minutes}`);
});

test('composed budget, exam eve: reviews only, frames to read, no new items anywhere, no script row', () => {
  const { plan, b, sim, ids, items } = day('eve');
  assert.ok(plan.minutes.planned <= MIN);
  assert.equal(b.newLeft, 0); assert.equal(b.writing.newLeft, 0); assert.equal(sim.newLeft, 0);
  assert.ok(ids.includes('practice.round'));
  assert.ok(items.some(r => r.id === 'practice.writing' && !r.introducesNew), 'Schreiben: due phrases only');
  assert.ok(items.some(r => r.id === 'practice.situations' && /plan\.sim\.detail \{"n":5\}/.test(r.detail)), 'situations: the 5 due');
  assert.ok(items.some(r => r.id === 'practice.frames'));
  assert.ok(!items.some(r => r.id.startsWith('script.')));
  assert.ok(!plan.rows.some(r => r.introducesNew));
});

test('composed budget, no exam date: scripts take at most 25 %, every feature shows, within 60 min', () => {
  const { c, settings, store, plan, b, sim, ids } = day('none');
  assert.equal(c.phase, 'none');
  assert.ok(plan.minutes.planned <= MIN, `planned ${plan.minutes.planned} > ${MIN}`);
  const sc = plan.rows.find(r => r.id === 'script.bike01');
  assert.ok(sc, `script row on Today: ${ids}`);
  assert.equal(sc.minutes, Math.round(MIN * MINUTES_SHARE), 'a 40-minute full run is capped at 15 min');
  for (const id of ['practice.round', 'practice.writing', 'practice.situations']) assert.ok(ids.includes(id), `${id} in ${ids}`);
  assert.equal(b.writing.focus, false, 'no exam: Schreiben is a trickle');
  assert.equal(sideMinutes({ store, c, settings }), sim.minutes + sc.minutes);
  assert.ok(b.minutes + b.writing.minutes + sim.minutes + sc.minutes <= MIN, `${b.minutes} + ${b.writing.minutes} + ${sim.minutes} + ${sc.minutes}`);
});

test('the speak and script decks never count as B1 due items or in readiness', () => {
  const { today, exam } = PHASES.week;
  const c = context({ today, exam });
  const settings = settingsFor(exam);
  const pool = [...Array.from({ length: 30 }, (_, i) => ({ id: `BP:s-${String(i + 1).padStart(2, '0')}`, area: 'speaking', group: 'g' })),
    ...Array.from({ length: 6 }, (_, i) => ({ id: `BS:a1-x${String(i + 1).padStart(2, '0')}`, area: 'writing', group: 'w' }))];
  const run = sideDecks => {
    const store = makeStore(today, { sideDecks });
    const st = stateFor({ clock: { ctx: () => c }, store, settings: () => settings }, { pool });
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
