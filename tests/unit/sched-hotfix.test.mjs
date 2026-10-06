// The scheduler hotfix before the Goethe B1 (round 4, UX/learning review P0-1, P0-2, P0-3 and item 7; code audit
// P0-1). Everything here is synthetic.
//   1. a sustainable new-item rate: Auto never goes past what the week's minutes hold (budget.js steadyRate), and the
//      14-day forecast counts the reviews today's new items bring
//   2. the exam window: only the exam's decks are pulled in, to R(exam) ≥ 0.90, spread over the window by his
//      minutes; side decks keep their own schedule; a window an earlier build already crammed is spread once
//   3. the review round is cut to fit, never left out; side rows give way first
//   4. exam week: no new items (but his mistakes) while the reviews do not fit the day
//   5. (code audit P0-1) Off and Light days inside the window: reviews planned, fewer new items, "Study anyway"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import FS from '../../src/domain/fsrs.js';
import RD from '../../src/domain/b1ready.js';
import * as B from '../../src/domain/budget.js';
import { composeToday } from '../../src/domain/today.js';
import { dayPlan, defaultWeek, weekMinutes } from '../../src/domain/week.js';
import { examDeck } from '../../src/domain/decks.js';
import { context, add, diff } from '../../src/core/clock.js';
import { windowStep, windowRecap, windowCapacity, examWindow, WINDOW_KV } from '../../src/features/day.js';
import { deckInputs } from '../../src/domain/allowance.js';
import { dueCount } from '../../src/domain/sim.js';

/** mulberry32 */
function rng(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const EXAM = '2026-10-13';   // a Tuesday, as his B1 (the date is a test input; nothing in src knows it)
const german = (/** @type {any} */ o = {}) => ({ language: 'german', minutesPerDay: 45, newPerDay: null, exam: { type: 'goethe-b1', date: EXAM, modules: ['lesen', 'hoeren', 'schreiben', 'sprechen'] },
  practice: {}, activeCourse: 'de', courses: [{ id: 'de', lang: 'de', goal: { exam: 'goethe-b1', date: EXAM } }], ...o });
const withWeek = (/** @type {any} */ s, /** @type {any} */ week) => ({ ...s, courses: [{ ...s.courses[0], week }] });

/* ---------------- 1. the sustainable rate ---------------- */

test('the model: review load per new item, measured with fsrs.js, matches the constants', () => {
  // a new item learnt on day 0, then reviewed when due by a learner who recalls 85 % of what FSRS predicts and is
  // late (Hard) on 40 % of right answers (the review's synthetic learner)
  const r = rng(7), T0 = '2027-01-04', N = 4000;
  const ctx = (/** @type {string} */ d) => ({ today: d, exam: null, phase: 'none', forecast: () => 0 });
  /** @type {Record<number, number>} */ const tot = { 14: 0, 30: 0 };
  for (let i = 0; i < N; i++) {
    let rec = FS.schedule(FS.schedule(null, { g: 3 }, ctx(T0), 1).rec, { g: 3 }, ctx(T0), 1).rec;
    let n = 0;
    for (;;) {
      const d = rec.relearn ? add(rec.last, 1) : rec.due;
      if (d >= add(T0, 30)) break;
      const p = 0.85 * FS.R(diff(rec.last, d), rec.S);
      const g = r() < p ? (r() < 0.4 ? 2 : 3) : 1;
      n++; if (d < add(T0, 14)) tot[14]++;
      rec = FS.schedule(rec, { g }, ctx(d), 1).rec;
      if (g === 1) rec = FS.schedule(rec, { g: 3 }, ctx(d), 1).rec;
    }
    tot[30] += n;
  }
  const r14 = tot[14] / N, r30 = tot[30] / N;
  assert.ok(Math.abs(r14 - B.NEW_REVIEWS_14) < 0.4, `14 days: ${r14.toFixed(2)} reviews`);
  assert.ok(Math.abs(r30 - B.NEW_REVIEWS_30) < 0.5, `30 days: ${r30.toFixed(2)} reviews`);
  assert.equal(B.STEADY_ITEM_MIN, 2.75);
  // about 9 a day on the default 4 h 05 week (the review's figure), 11 at 45 min a day, 23 at 90
  assert.equal(weekMinutes(defaultWeek()), 245);
  assert.equal(B.steadyRate(245), 9);
  assert.equal(B.steadyRate(7 * 45), 11);
  assert.equal(B.steadyRate(7 * 90), 23);
  assert.equal(B.steadyFor(withWeek(german(), defaultWeek())), 9);
  assert.equal(B.steadyFor(german({ minutesPerDay: 90 })), 23);
});

/** A random allowance case in maintenance or the first week. @param {() => number} r */
function calmCase(r) {
  const int = (/** @type {number} */ a, /** @type {number} */ b) => a + Math.floor(r() * (b - a + 1));
  const minutes = [10, 20, 30, 45, 60, 90, 120, 180][int(0, 7)];
  const week = r() < 0.5 ? { min: Array.from({ length: 7 }, () => [0, 20, 45, 60, 90][int(0, 4)]), kind: Array.from({ length: 7 }, () => ['n', 'light', 'read', 'talk', 'off'][int(0, 4)]) } : null;
  const s = week ? withWeek(german({ minutesPerDay: minutes, exam: { type: null } }), week) : german({ minutesPerDay: minutes, exam: { type: null }, courses: [] });
  const c = context({ today: add('2026-11-02', int(0, 6)), exam: null });
  const decks = /** @type {any} */ ({});
  for (const id of B.DECKS) if (r() < 0.8) decks[id] = { due: int(0, r() < 0.2 ? 400 : 40), open: r() < 0.3 ? undefined : int(0, 300), shown: r() < 0.2 ? int(0, 10) : 0 };
  const fresh = r() < 0.25 ? { day: int(0, 6) } : null;
  const day = dayPlan(s, c, { live: ['read', 'talk'] });
  const forecast = day.planned && r() < 0.6 ? { reviewMin: int(0, 1500), plannedMin: int(1, 1500), days: 14 } : null;
  return { s, c, inp: { decks, fresh, fixedMin: int(0, 20), goals: { script: r() < 0.3, build: r() < 0.5, clusters: r() < 0.5 }, scripts: int(0, 2), day, forecast, weekMin: B.plannedWeekMin(s) } };
}

test('property: under Auto, new items never go past the sustainable rate; a chosen number is never capped by it', () => {
  const r = rng(0x5eed1);
  let capped = 0;
  for (let n = 0; n < 4000; n++) {
    const { s, c, inp } = calmCase(r);
    const a = B.allowance({ c, settings: s, ...inp });
    const where = JSON.stringify({ today: c.today, min: s.minutesPerDay, week: s.courses[0]?.week, inp: { ...inp, day: undefined } });
    const steady = B.steadyFor(s);
    assert.ok(a.newPerDay <= steady, `${a.newPerDay} > ${steady} ${where}`);
    if (a.newPerDay === steady && steady > 0) capped++;
    // reviews are never dropped by it
    assert.equal(a.reviews.due, B.DECKS.reduce((k, id) => k + Math.max(0, inp.decks[id]?.due || 0), 0), where);
    // his own number wins (outside Light, Off and a break)
    const chosen = B.allowance({ c, settings: { ...s, newPerDay: steady + 17, rev: { newPerDay: 'x' } }, ...inp });
    if (!chosen.plan?.why) assert.ok(chosen.newPerDay >= Math.min(steady + 17, a.newPerDay), where);
  }
  assert.ok(capped > 200, `the cap was reached ${capped} times`);
});

test('the forecast counts the reviews today\'s new items will bring', () => {
  const s = withWeek(german({ exam: { type: null } }), { min: Array(7).fill(45), kind: Array(7).fill('n') });
  const c = context({ today: '2026-11-02', exam: null });
  const day = dayPlan(s, c);
  const decks = { b1: { due: 9, open: 400 } };
  const planned = 14 * 45;
  const at = (/** @type {number} */ reviewMin) => B.allowance({ c, settings: s, decks, day, forecast: { reviewMin, plannedMin: planned, days: 14 }, weekMin: 315 });
  const free = at(0);
  assert.equal(free.newPerDay, 11);
  assert.equal(free.plan?.forecast?.fromNew, Math.round(11 * B.NEW_REVIEWS_14 * B.REVIEW_COST.b1 * 10) / 10);
  // existing reviews alone just under the limit: today's new items' reviews put it over, so fewer new items
  const near = at(B.FORECAST_LIMIT * planned - 1);
  assert.ok(near.newPerDay < free.newPerDay && near.plan?.why === 'reviewsHigh');
});

/* ---------------- 2. the exam window ---------------- */

/** The rule before the hotfix (fsrs.recap and the read-time cap until 6 Oct): R(exam) < 0.95 → exam − 3 … exam − 1. */
const oldCapDay = (/** @type {any} */ r, /** @type {string} */ exam) => add(exam, -1 - (Math.abs(Math.round(r.S * 1000)) % 3));

/**
 * A learner like the review's: about 1,600 b1 cards with stabilities 3 to 53 days, 400 word-cluster cards and 60
 * situations, all scheduled at 0.90 and none overdue on `today`; then, as an earlier build did inside the window,
 * every card whose R(exam) < 0.95 put on exam − 3 … exam − 1 (crammed: true). @param {number} seed
 */
function learner(seed, { crammed = false, today = '2026-10-06' } = {}) {
  const r = rng(seed);
  const lastFor = (/** @type {number} */ S) => add(today, -Math.floor(r() * Math.min(FS.interval(S, 0.9), 365)));
  /** @type {Record<string, Record<string, any>>} */ const decks = { b1: {}, clusters: {}, speak: {} };
  const mk = (/** @type {string} */ deck, /** @type {string} */ id, /** @type {number} */ S, /** @type {string} */ last) => {
    const rec = { S, D: 5, reps: 4, lapses: 0, last, first: add(last, -40), stage: 1, streak: 0, learn: null, relearn: false, hist: [], due: add(last, Math.min(FS.interval(S, 0.9), 365)) };
    if (crammed && rec.due > add(EXAM, -1) && FS.R(diff(last, EXAM), S) < 0.95 && add(last, 1) <= add(EXAM, -1)) rec.due = oldCapDay(rec, EXAM);
    decks[deck][id] = rec;
  };
  for (let i = 0; i < 1600; i++) { const S = 3 + r() * 50; mk('b1', `BP:s${i}`, S, lastFor(S)); }
  for (let i = 0; i < 400; i++) { const S = 2 + r() * 40; mk('clusters', `W:c${i}`, S, lastFor(S)); }
  for (let i = 0; i < 60; i++) { const S = 2 + r() * 30; mk('speak', `SS:x-${String(i).padStart(2, '0')}`, S, lastFor(S)); }
  return decks;
}

/**
 * Days from `from` to the exam: each morning the exam deck's due count is noted; he answers every due b1 card
 * (recall by R), and learns 8 new items a day until exam − 2. Side decks are left alone (Today defers them).
 * @param {Record<string, Record<string, any>>} decks @param {string} from
 */
function live(decks, from) {
  const r = rng(99);
  /** @type {Record<string, number>} */ const dueAt = {};
  /** @type {Record<string, number>} */ const sideAt = {};
  let k = 0;
  for (let d = from; d <= EXAM; d = add(d, 1)) {
    const c = context({ today: d, exam: EXAM });
    const b1 = decks.b1;
    const due = Object.keys(b1).filter(id => RD.isDue(b1[id], d, c));
    dueAt[d] = due.length;
    sideAt[d] = ['clusters', 'speak'].reduce((n, deck) => n + Object.values(decks[deck]).filter(x => RD.isDue(x, d, RD.sideCap(c))).length, 0);
    if (c.phase === 'day') break;
    const fc = RD.forecast(b1, d, 16, c);
    const forecast = (/** @type {string} */ x) => (fc.find(f => f.day === x) || {}).n || 0;
    for (const id of due) {
      const rec = b1[id];
      const g = r() < 0.9 * FS.R(diff(rec.last, d), rec.S) ? 3 : 1;
      let x = FS.schedule(rec, { g, ms: 3000, onTime: true }, { ...c, forecast }, 1).rec;
      if (g === 1) x = FS.schedule(x, { g: 3, ms: 3000 }, { ...c, forecast }, 1).rec;
      b1[id] = x;
    }
    if (c.newItems && c.phase !== 'lastNew' || c.phase === 'lastNew') for (let i = 0; i < 8 && c.newItems; i++) {
      const id = `BP:n${k++}`;
      b1[id] = FS.schedule(FS.schedule(null, { g: 3 }, { ...c, forecast }, 1).rec, { g: 3 }, { ...c, forecast }, 1).rec;
    }
  }
  return { dueAt, sideAt };
}

for (const [label, crammed, minutes] of /** @type {const} */ ([['window entered by time', false, 45], ['an earlier build crammed the last three days', true, 45], ['crammed, 90 min a day', true, 90]])) {
  test(`synthetic learner (${label}): the eve and the exam day hold their minutes; no side card is pulled in`, () => {
    const settings = german({ minutesPerDay: minutes });
    // the window pass: at window entry (exam − 14) for a date seen outside it, or today (6 Oct) for a record an
    // earlier build wrote
    const start = crammed ? '2026-10-06' : add(EXAM, -14);
    const decks = learner(0xb1, { crammed, today: start });
    const before = structuredClone(decks);
    const c = context({ today: start, exam: EXAM });
    const prev = crammed ? { exam: EXAM, outside: false, recapped: {} } : { exam: EXAM, outside: true, recapped: {}, v: 2 };
    const step = windowStep(prev, c);
    assert.equal(step.recap, true);
    const puts = windowRecap(decks, c, windowCapacity(settings, c));
    for (const [deck, entries] of Object.entries(puts)) for (const [id, rec] of entries) {
      // only due changes; a side card only ever moves later (back to its own date)
      assert.deepEqual({ ...rec, due: 0 }, { ...decks[deck][id], due: 0 });
      if (!examDeck(deck)) assert.ok(rec.due > decks[deck][id].due, `${deck} ${id} moves later`);
      decks[deck][id] = rec;
    }
    if (!crammed) assert.deepEqual(Object.keys(puts).filter(d => !examDeck(d)), [], 'nothing to send back when no build crammed');
    // side decks: every card at its own date (as scheduled before any cram)
    for (const deck of ['clusters', 'speak']) for (const [id, rec] of Object.entries(decks[deck])) {
      const own = add(rec.last, Math.min(FS.interval(rec.S, 0.9), 365));
      assert.ok(rec.due >= (crammed ? before[deck][id].due : own), `${deck} ${id} never earlier`);
      assert.equal(RD.dueOn(rec, RD.sideCap(c)), rec.due, 'read at its own date');
    }
    const { dueAt, sideAt } = live(decks, crammed ? '2026-10-07' : add(EXAM, -13));
    const eve = add(EXAM, -1);
    const evenMin = dueAt[eve] * B.REVIEW_COST.b1, dayMin = dueAt[EXAM] * B.REVIEW_COST.b1;
    assert.ok(evenMin <= minutes, `the eve: ${dueAt[eve]} due, ${evenMin.toFixed(0)} min > ${minutes}`);
    assert.ok(dayMin <= minutes, `the exam day: ${dueAt[EXAM]} due, ${dayMin.toFixed(0)} min`);
    // every window day after the pass stays within the day's minutes too
    for (const [d, n] of Object.entries(dueAt)) if (d > start) assert.ok(n * B.REVIEW_COST.b1 <= minutes, `${d}: ${n} due`);
    assert.ok(Object.values(sideAt).every(n => n >= 0));
  });
}

test('the cram the hotfix removes: the old rule put hundreds on the last three days of the same learner', () => {
  const decks = learner(0xb1, { crammed: true });
  const on = (/** @type {string} */ d) => Object.values(decks.b1).filter(r => r.due === d).length;
  const last3 = [-3, -2, -1].map(k => on(add(EXAM, k)));
  assert.ok(last3.every(n => n * B.REVIEW_COST.b1 > 45), `old rule: ${last3.join(' ')} due on exam − 3 … − 1`);
  const side = [-3, -2, -1].map(k => Object.values(decks.clusters).filter(r => r.due === add(EXAM, k)).length);
  assert.ok(side.some(n => n > 10), `and side decks too: ${side.join(' ')}`);
});

test('property: side decks are never pulled forward (read, recap, scheduler, allowance)', () => {
  const r = rng(0x51de);
  for (let n = 0; n < 300; n++) {
    const today = add(EXAM, -1 - Math.floor(r() * 14));
    const c = context({ today, exam: EXAM });
    /** @type {Record<string, Record<string, any>>} */ const decks = { b1: {}, clusters: {}, build: {}, speak: {}, 'de:read': {} };
    for (const deck of Object.keys(decks)) for (let i = 0; i < 20; i++) {
      const S = 0.5 + r() * 60, last = add(today, -Math.floor(r() * 40));
      decks[deck][`${deck === 'speak' ? 'SS:x-' : 'W:'}${i}`] = { S, D: 5, reps: 3, last, learn: null, relearn: false, hist: [], due: add(last, 1 + Math.floor(r() * 80)) };
    }
    const puts = windowRecap(decks, c, () => 1 + Math.floor(r() * 30));
    for (const [deck, entries] of Object.entries(puts)) if (!examDeck(deck)) for (const [id, rec] of entries) assert.ok(rec.due > decks[deck][id].due, `${deck} ${id}`);
    for (const deck of ['clusters', 'build', 'speak', 'de:read']) for (const rec of Object.values(decks[deck])) {
      assert.equal(RD.dueOn(rec, RD.deckCap(c, deck)), rec.due);
      const side = FS.dueFor(rec.S, { ...RD.sideCap(c), forecast: () => 0 });
      assert.equal(side, add(today, FS.interval(rec.S, 0.92)), 'its own interval');
    }
    // the allowance's counts: a side deck's due is the cards due by their own date
    const store = { cards: (/** @type {string} */ d) => decks[d] || {}, get: (/** @type {string} */ _k, /** @type {any} */ f) => f, cardsByDeck: decks };
    const inp = deckInputs({ store, c, settings: german() });
    const own = (/** @type {string} */ d) => Object.values(decks[d]).filter(x => x.due <= today && x.last !== today).length;
    assert.equal(inp.decks.clusters.due, own('clusters'));
    assert.equal(inp.decks.build.due, own('build'));
    assert.equal(dueCount(decks.speak, c), own('speak'));
  }
});

test('an earlier build\'s window record: spread once (the recap-once marker kept); a new record never re-spreads', async () => {
  const c = context({ today: '2026-10-06', exam: EXAM });
  // his case: the window opened before the window code shipped, so the record was first written inside it
  const legacy = { exam: EXAM, outside: false, recapped: {} };
  const st = windowStep(legacy, c);
  assert.equal(st.recap, true); assert.equal(st.spread, true); assert.equal(st.next.v, 2);
  assert.deepEqual(st.next.recapped[EXAM].spread, { on: c.today, moved: 0 });
  // an old recap's marker is kept, with the spread added
  const old = windowStep({ exam: EXAM, outside: false, recapped: { [EXAM]: { on: '2026-09-29', moved: 40 } } }, c);
  assert.equal(old.recap, true); assert.equal(old.next.recapped[EXAM].on, '2026-09-29'); assert.equal(old.next.recapped[EXAM].moved, 40);
  // once
  assert.equal(windowStep(st.next, c).recap, false);
  assert.equal(windowStep(st.next, context({ today: '2026-10-08', exam: EXAM })).recap, false);
  // a record of this build first written inside the window (a date set or moved there): no pass, as before
  assert.equal(windowStep(null, c).recap, false);
  assert.equal(windowStep(windowStep(null, c).next, context({ today: '2026-10-07', exam: EXAM })).recap, false);
  // outside the window or after the exam: nothing for a legacy record
  assert.equal(windowStep({ exam: EXAM, outside: false, recapped: {} }, context({ today: EXAM, exam: EXAM })).recap, false);
  assert.equal(windowStep({ exam: EXAM, outside: false, recapped: {} }, context({ today: '2026-10-20', exam: EXAM })).recap, false);

  // through the store: the cards move once, only due changes
  const decks = learner(0xfeed, { crammed: true });
  /** @type {Record<string, any>} */ const kv = { [WINDOW_KV]: legacy };
  const writes = /** @type {[string, number][]} */ ([]);
  const store = { cardsByDeck: decks, cards: (/** @type {string} */ d) => decks[d] || {}, get: (/** @type {string} */ k, /** @type {any} */ f) => (k in kv ? kv[k] : f), set: (/** @type {string} */ k, /** @type {any} */ v) => { kv[k] = v; },
    putCards: (/** @type {string} */ d, /** @type {[string, any][]} */ e) => { writes.push([d, e.length]); for (const [id, rec] of e) decks[d][id] = rec; } };
  const moved = examWindow({ store, c, settings: german() });
  assert.ok(moved > 100, `${moved} moved`);
  assert.equal(kv[WINDOW_KV].recapped[EXAM].spread.moved, moved);
  assert.ok(writes.some(([d]) => d === 'clusters'), 'crammed cluster cards go back to their own date');
  writes.length = 0;
  assert.equal(examWindow({ store, c: context({ today: '2026-10-07', exam: EXAM }), settings: german() }), 0);
  assert.equal(writes.length, 0);
});

/* ---------------- 3. the review round is cut, never left out ---------------- */

const row = (/** @type {any} */ o) => ({ source: 'x', href: '#', title: o.id, ...o });

test('the review round behind the Schreiben task is cut to fit; the side rows give way (UX review P0-3)', () => {
  const ctx = context({ today: '2026-10-10', exam: EXAM });
  const items = [
    row({ id: 'practice.schreiben', kind: 'write', minutes: 20, priority: 18 }),
    row({ id: 'practice.round', kind: 'review', minutes: 56, priority: 20, rounds: 14, reviews: 158, actionFor: (/** @type {number} */ k) => `round 1 of ${k}` }),
    row({ id: 'practice.writing', kind: 'write', minutes: 8, priority: 22, reviews: 17 }),
    row({ id: 'practice.situations', kind: 'speak', minutes: 4, priority: 48 }),
    row({ id: 'practice.clusters', kind: 'review', minutes: 16, priority: 55, noCut: true, reviews: 53 }),
  ];
  const p = composeToday({ ctx, budget: 60, items });
  assert.deepEqual(p.rows.map(r => r.id), ['practice.schreiben', 'practice.round']);
  const rr = p.rows[1];
  assert.equal(rr.minutes, 40); assert.equal(rr.cut, true); assert.equal(rr.rounds, 10); assert.equal(rr.action, 'round 1 of 10');
  assert.deepEqual(p.extra.map(r => r.id), ['practice.writing', 'practice.situations', 'practice.clusters']);
  assert.equal(p.reviews.due, 158 + 17 + 53, 'every due card is still counted');
  assert.equal(p.reviews.left, p.reviews.due - 120);
});

test('property: whenever reviews are due the review round is in the plan (outside the exam day)', () => {
  const r = rng(0x70da);
  for (let n = 0; n < 3000; n++) {
    const int = (/** @type {number} */ a, /** @type {number} */ b) => a + Math.floor(r() * (b - a + 1));
    const phase = ['none', 'week', 'lastNew', 'eve', 'after'][int(0, 4)];
    const ctx = { phase, newItems: phase !== 'eve', mocks: phase !== 'eve' };
    const items = [row({ id: 'practice.round', kind: 'review', minutes: 4 * int(1, 30), priority: 20, rounds: int(1, 30), reviews: int(1, 400) })];
    for (let i = 0; i < int(0, 9); i++) {
      const kind = ['write', 'mock', 'speak', 'read', 'review', 'new'][int(0, 5)];
      items.push(row({ id: `r${i}`, kind, minutes: int(1, 60), priority: int(10, 60), mock: kind === 'mock', noCut: kind === 'review' || kind === 'new' ? r() < 0.7 : undefined, optional: r() < 0.3, noOverrun: r() < 0.2, reviews: kind !== 'mock' && r() < 0.5 ? int(0, 50) : 0, done: r() < 0.1 }));
    }
    const p = composeToday({ ctx, budget: int(0, 120), items });
    const rr = p.rows.find(x => x.id === 'practice.round');
    assert.ok(rr, JSON.stringify({ phase, budget: p.minutes.budget, items: items.map(x => [x.id, x.kind, x.minutes, x.priority]) }));
    assert.ok(rr.minutes >= 4);
    const all = items.reduce((k, x) => k + (x.done ? 0 : x.reviews || 0), 0);
    assert.equal(p.reviews.due, all, 'reviews are never dropped from the count');
  }
});

/* ---------------- 4. exam week: no new items while the reviews do not fit ---------------- */

test('exam week: while the exam decks\' reviews do not fit the day, no new items but his mistakes (UX review item 7)', () => {
  const s = german({ minutesPerDay: 45 });
  const c = context({ today: '2026-10-10', exam: EXAM });
  const decks = { b1: { due: 158, open: 400 }, writing: { due: 17, open: 40 }, speak: { due: 6, open: 30 }, mistakes: { due: 2, open: 3 }, clusters: { due: 53, open: 80 } };
  const a = B.allowance({ c, settings: s, decks, priorityLeft: 80, focus: true, fixedMin: 20 });
  assert.equal(a.mode, 'exam');
  assert.equal(a.newPerDay, 3, 'only the 3 open mistakes');
  assert.equal(a.decks.mistakes.newPerDay, 3);
  assert.equal(a.why, 'reviewsDue');
  assert.equal(a.reviews.due, 158 + 17 + 6 + 2 + 53, 'every review counted');
  // the side decks' reviews alone never block new items (Today defers them)
  const light = B.allowance({ c, settings: s, decks: { ...decks, b1: { due: 10, open: 400 }, writing: { due: 2, open: 40 }, clusters: { due: 400, open: 80 } }, priorityLeft: 80, focus: true, fixedMin: 0 });
  assert.ok(light.newPerDay > 3); assert.equal(light.why, undefined);
  // his own number is his
  const chosen = B.allowance({ c, settings: { ...s, newPerDay: 10, rev: { newPerDay: 'x' } }, decks, priorityLeft: 80, focus: true, fixedMin: 20 });
  assert.equal(chosen.newPerDay, 10);
});

/* ---------------- 5. Off and Light inside the exam window (code audit P0-1) ---------------- */

test('code audit P0-1: with the default week, Sun 11 Oct (Off, last new day) plans every review and a few new items', () => {
  const s = withWeek(german({ minutesPerDay: 45 }), defaultWeek());
  const sun = context({ today: '2026-10-11', exam: EXAM });
  assert.equal(sun.phase, 'lastNew');
  const day = dayPlan(s, sun, { live: ['read', 'talk'] });
  assert.equal(day.kind, 'off');
  assert.equal(day.minutes, 45, 'the exam plans the day: his daily minutes');
  const decks = { b1: { due: 100, open: 400 }, writing: { due: 12, open: 40 }, speak: { due: 8, open: 30 }, mistakes: { due: 0, open: 2 } };
  const a = B.allowance({ c: sun, settings: s, decks, day, priorityLeft: 30, focus: true, fixedMin: 0 });
  assert.equal(a.plan?.reviewsToday, 120, 'no review dropped');
  assert.ok(a.newPerDay > 0 || a.plan?.why === 'reviewsDue', 'new items only give way to reviews');
  const normal = B.allowance({ c: sun, settings: s, decks, day: { ...day, kind: 'n' }, priorityLeft: 30, focus: true, fixedMin: 0 });
  assert.ok(a.newPerDay <= normal.newPerDay, 'fewer than a normal day');
  // the composed day keeps the review round at its full size in the day's 45 minutes
  const p = composeToday({ ctx: sun, budget: day.minutes, items: [row({ id: 'practice.round', kind: 'review', minutes: 40, priority: 20, rounds: 10, reviews: 120 })] });
  assert.equal(p.rows[0].minutes, 40); assert.equal(p.rows[0].cut, undefined);
  // the audit's numbers: before the fix the day had 0 minutes and dropped 108 of 120 reviews
  const was = composeToday({ ctx: sun, budget: 0, items: [row({ id: 'practice.round', kind: 'review', minutes: 40, priority: 20, rounds: 10, reviews: 120 })] });
  assert.equal(was.reviews.left, 108);
  // Wed 7 Oct is Light: reviews planned, fewer new items, never none for that reason
  const wed = context({ today: '2026-10-07', exam: EXAM });
  const wd = dayPlan(s, wed, { live: ['read', 'talk'] });
  assert.equal(wd.kind, 'light');
  const w = B.allowance({ c: wed, settings: s, decks: { b1: { due: 20, open: 400 }, writing: { due: 2, open: 40 } }, day: wd, priorityLeft: 30, focus: true });
  assert.ok(w.newPerDay > 0); assert.equal(w.plan?.reviewsToday, 22);
  // "Study anyway" on the Off day: a Normal day
  assert.equal(dayPlan(s, sun, { anyway: true }).kind, 'n');
  // outside the window Off and Light are as before
  const later = context({ today: '2026-10-25', exam: EXAM });
  const off = dayPlan(s, later);
  assert.equal(off.kind, 'off'); assert.equal(off.minutes, 0);
  assert.equal(B.allowance({ c: later, settings: s, decks, day: off }).plan?.reviewsToday, 0);
});
