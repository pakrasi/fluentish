// The week plan and the allowance (round 4, lane L1b): domain/week.js dayPlan, domain/budget.js allowance({day,
// forecast}) and domain/allowance.js (reviewForecast, the memo, todayPlan). A seeded property test runs the allowance
// over goal types × day kinds × Auto/chosen × random decks and checks the invariants of PLAN-REVIEW's L1 gate; the
// golden vectors' inputs prove that a course without a week gets the round 3 numbers byte for byte. All data synthetic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createMemoryAdapter } from '../../src/data/adapters/memory.js';
import { migrateCourses } from '../../src/data/session.js';
import { Store } from '../../src/data/store.js';
import { createHlc } from '../../src/data/ids.js';
import * as S from '../../src/data/settings.js';
import { context } from '../../src/core/clock.js';
import * as B from '../../src/domain/budget.js';
import { dayPlan, daysAhead, defaultWeek, weekMinutes, weekday, DAY_KINDS, LIVE_SLOTS, SLOT_SHARE } from '../../src/domain/week.js';
import { dayAllowance, todayBudget, todayPlan, reviewForecast, awayDays, ANYWAY_KV } from '../../src/domain/allowance.js';
import * as D8 from '../../src/domain/days.js';

const { allowance, DECKS, SIDE, FORECAST_LIMIT, FORECAST_DAYS, BREAK_FACTOR, NEW_ITEM_MIN } = B;
const WINDOW = new Set(['week', 'lastNew', 'eve', 'day']);
const MON = '2026-10-19';   // a Monday
const german = (/** @type {any} */ o = {}) => S.normalizeSettings({
  v: 1, language: 'german', level: 'B1', exam: { type: 'goethe-b1', date: null, modules: ['lesen', 'hoeren', 'schreiben', 'sprechen'] },
  minutesPerDay: 60, newPerDay: null, practice: { readAloud: true }, onboarded: '2026-10-01T09:00:00.000+02:00', rev: {}, ...o,
});
/** Settings with a week on the active course. @param {any} s @param {any} week */
const withWeek = (s, week) => ({ ...s, courses: s.courses.map((/** @type {any} */ c) => (c.id === s.activeCourse ? { ...c, week } : c)) });
/** A week whose every day is the same. @param {string} kind @param {number} min */
const flat = (kind, min) => ({ min: Array(7).fill(min), kind: Array(7).fill(kind) });
const MAINT = context({ today: MON, exam: null });

/* ---------------- the week plan ---------------- */

test('week: no week is the round 3 day; a week gives each weekday its minutes and kind, Monday first', () => {
  const s = german();
  assert.deepEqual(dayPlan(s, MAINT), { kind: 'n', minutes: 60, slot: null, slotMin: 0, planned: false });
  assert.deepEqual(dayPlan({ ...s, minutesPerDay: undefined }, MAINT).minutes, 60);
  const w = withWeek(s, defaultWeek());
  assert.equal(weekMinutes(defaultWeek()), 245, 'the default week is 4 h 05');
  const days = daysAhead(w, MON, 7);
  assert.deepEqual(days.map(d => d.day), ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25']);
  assert.deepEqual(days.map(d => weekday(d.day)), [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(days.map(d => d.minutes), [45, 45, 20, 45, 30, 60, 0]);
  // Reading (L2b), Conversation (L4) and Writing (round 4 ruling 8: the Schreiben task as the slot) have shipped: a
  // Read, Write or Talk day has its slot
  assert.deepEqual(LIVE_SLOTS, ['read', 'write', 'talk']);
  assert.deepEqual(days.map(d => d.kind), ['n', 'read', 'light', 'write', 'n', 'talk', 'off']);
  assert.deepEqual(days.map(d => d.asked || null), [null, null, null, null, null, null, null]);
  assert.deepEqual(days.map(d => d.slot), [null, 'read', null, 'write', null, 'talk', null]);
  assert.equal(days[1].slotMin, Math.round(45 * SLOT_SHARE));
  assert.equal(days[3].slotMin, Math.round(45 * SLOT_SHARE));
  assert.equal(days[5].slotMin, Math.round(60 * SLOT_SHARE));
  assert.ok(days.every(d => d.planned && (d.slot === 'read' || d.slot === 'write' || d.slot === 'talk' || d.slotMin === 0)));
});

test('week: a live slot takes a third of the day; 0 minutes is an Off day; Study anyway makes an Off day Normal', () => {
  const s = withWeek(german(), { min: [45, 60, 20, 0, 30, 90, 15], kind: ['read', 'talk', 'light', 'n', 'write', 'n', 'off'] });
  const at = (/** @type {number} */ i, /** @type {any} */ o) => dayPlan(s, { today: D8.add(MON, i) }, o);
  const live = { live: ['read', 'write', 'talk'] };
  assert.deepEqual(at(0, live), { kind: 'read', minutes: 45, slot: 'read', slotMin: 15, planned: true });
  assert.deepEqual(at(1, live), { kind: 'talk', minutes: 60, slot: 'talk', slotMin: 20, planned: true });
  assert.equal(at(4, live).slotMin, Math.round(30 * SLOT_SHARE));
  assert.deepEqual(at(3), { kind: 'off', minutes: 0, slot: null, slotMin: 0, planned: true }, '0 minutes: off');
  assert.deepEqual(at(6), { kind: 'off', minutes: 0, slot: null, slotMin: 0, planned: true }, 'kind off: 0 minutes');
  assert.deepEqual(at(6, { anyway: true }), { kind: 'n', minutes: 60, slot: null, slotMin: 0, planned: true }, 'Study anyway: a Normal day of minutesPerDay');
  assert.deepEqual(at(2, { anyway: true }).kind, 'light', 'anyway only changes an Off day');
  // a malformed week is no week
  assert.equal(dayPlan(withWeek(german(), { min: [1], kind: ['n'] }), MAINT).planned, false);
});

/* ---------------- byte-equal without a week ---------------- */

const VECTORS = readFileSync(new URL('../vectors/budget.json', import.meta.url), 'utf8').split('\n').filter(l => l.startsWith('{"fn":"allowance"')).map(l => JSON.parse(l.replace(/,$/, '')));

test('legacy: every golden-vector input gives its stored output byte for byte with the no-week day plan passed in', () => {
  assert.ok(VECTORS.length > 1000, `${VECTORS.length} allowance vectors`);
  for (const v of VECTORS) {
    const { today, exam, settings, ...inp } = v.in;
    const c = context({ today, exam });
    const day = dayPlan(settings, c);
    assert.equal(day.planned, false);
    const forecast = { reviewMin: 9999, plannedMin: 10, days: 14 };   // a forecast is ignored without a week too
    assert.equal(JSON.stringify(allowance({ c, settings, ...inp, day, forecast })), JSON.stringify(v.out), JSON.stringify(v.in));
  }
});

/* ---------------- the seeded property test ---------------- */

/** mulberry32 @param {number} seed */
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const GOALS = ['none', 'level', 'examFar', 'b1Window', 'b2Window', 'after'];

/** One random case. @param {() => number} r */
function makeCase(r) {
  const int = (/** @type {number} */ a, /** @type {number} */ b) => a + Math.floor(r() * (b - a + 1));
  const pick = (/** @type {any[]} */ xs) => xs[int(0, xs.length - 1)];
  const today = D8.add(MON, int(0, 400));
  const goal = pick(GOALS);
  const exam = goal === 'examFar' ? D8.add(today, int(15, 200)) : goal === 'b1Window' || goal === 'b2Window' ? D8.add(today, int(0, 14))
    : goal === 'after' ? D8.add(today, -int(1, 60)) : null;
  const c = context({ today, exam });
  const chosen = r() < 0.3;
  let settings = german({ minutesPerDay: pick([15, 20, 30, 45, 60, 90, 120]), newPerDay: chosen ? int(0, 60) : null, rev: chosen ? { newPerDay: 'x' } : {},
    practice: { readAloud: true, ...(r() < 0.5 ? { buildNew: int(0, 30), readNew: int(0, 30) } : {}) } });
  settings.courses[0].goal = { ...settings.courses[0].goal, exam: goal === 'b2Window' ? 'goethe-b2' : 'goethe-b1', date: exam, ...(goal === 'level' ? { level: 'B2' } : {}) };
  const kind = pick([null, ...DAY_KINDS]);
  if (kind) {
    const week = { min: Array.from({ length: 7 }, () => pick([0, 15, 20, 30, 45, 60, 90, 240])), kind: Array.from({ length: 7 }, () => pick([...DAY_KINDS])) };
    week.kind[weekday(today)] = kind;
    settings = withWeek(settings, week);
  }
  const live = r() < 0.5 ? ['read', 'write', 'talk'] : [];
  const day = dayPlan(settings, c, { live, anyway: r() < 0.1 });
  /** @type {any} */ const decks = {};
  for (const id of DECKS) {
    if (r() < 0.3) continue;
    decks[id] = { due: int(0, r() < 0.2 ? 600 : 80), ...(r() < 0.8 ? { open: int(0, 300) } : {}), shown: r() < 0.3 ? int(0, 40) : 0 };
  }
  const fresh = r() < 0.15 ? { day: int(0, 6) } : null;
  const inp = {
    decks, priorityLeft: r() < 0.3 ? null : int(0, 300), focus: r() < 0.3, fixedMin: r() < 0.5 ? 0 : int(0, 40), fresh,
    goals: { script: r() < 0.5, build: r() < 0.5, clusters: r() < 0.5 }, examDecks: { script: int(0, 2) }, scripts: int(0, 3),
    forecast: r() < 0.7 ? { reviewMin: int(0, 3000), plannedMin: int(0, 3000), days: FORECAST_DAYS } : null,
  };
  return { c, settings, day, inp, goal, kind, chosen };
}

test('property: the allowance keeps its invariants over goals × day kinds × Auto/chosen × random decks (seeded)', () => {
  const r = rng(0x4c3162);
  const seen = { goals: new Set(), kinds: new Set(), why: new Set(), break: 0, cut: 0, chosen: 0 };
  const N = 6000;
  for (let n = 0; n < N; n++) {
    const k = makeCase(r);
    const { c, settings, day, inp } = k;
    const a = allowance({ c, settings, ...inp, day });
    const where = () => JSON.stringify({ c: [c.today, c.exam, c.phase], kind: day.kind, planned: day.planned, minutes: day.minutes, newPerDay: settings.newPerDay, inp });
    seen.goals.add(k.goal); seen.kinds.add(day.planned ? day.kind : 'none'); if (k.chosen) seen.chosen++;
    // reviews are never dropped: every deck's due is its input, and reviews.due their sum
    let due = 0;
    for (const id of DECKS) { const want = Math.max(0, inp.decks[id]?.due || 0); assert.equal(a.decks[id].due, want, where()); due += want; }
    assert.equal(a.reviews.due, due, where());
    // nothing below 0; the decks' shares add up to the day's number; nothing past what a deck has open
    assert.ok(a.newLeft >= 0 && a.newPerDay >= 0, where());
    for (const id of DECKS) {
      const x = a.decks[id];
      assert.ok(x.newLeft >= 0 && x.newPerDay >= 0 && x.want >= 0 && x.rounds >= 0 && x.minutes >= 0, where());
      const open = inp.decks[id] ? (inp.decks[id].open ?? Infinity) : 0;
      assert.ok(x.newLeft <= open, where());
    }
    assert.equal(DECKS.reduce((s, id) => s + a.decks[id].newPerDay, 0), a.newPerDay, where());
    assert.equal(DECKS.reduce((s, id) => s + a.decks[id].newLeft, 0), a.newLeft, where());
    // the eve, the exam day, Light and Off days: no new items, a chosen number included. Hotfix (code audit P0-1):
    // inside the exam window a Light or Off day has fewer new items than a Normal one, never more
    if (c.phase === 'eve' || c.phase === 'day' || (day.planned && !WINDOW.has(c.phase) && (day.kind === 'light' || day.kind === 'off'))) {
      assert.equal(a.newPerDay, 0, where()); assert.equal(a.newLeft, 0, where());
    }
    if (day.planned && WINDOW.has(c.phase) && (day.kind === 'light' || day.kind === 'off')) {
      const normal = allowance({ c, settings, ...inp, day: { ...day, kind: 'n' } });
      assert.ok(a.newPerDay <= normal.newPerDay, where());
    }
    // hotfix: Auto in maintenance and the first week never goes past the sustainable rate of the week's minutes
    if (!B.newPerDayChosen(settings) && (a.mode === 'maintenance' || a.mode === 'start')) assert.ok(a.newPerDay <= B.steadyRate(7 * (day.planned ? day.minutes : settings.minutesPerDay || 60)), where());
    // side decks pause only inside the exam window
    for (const id of DECKS) if (a.decks[id].paused) { assert.ok(SIDE.includes(id), where()); assert.ok(WINDOW.has(c.phase), where()); }
    if (!WINDOW.has(c.phase)) assert.ok(DECKS.every(id => !a.decks[id].paused), where());
    if (!day.planned) {
      // no week: the plan is not read, and the output is the round 3 one
      assert.equal(a.plan, undefined, where());
      assert.deepEqual(a, allowance({ c, settings, ...inp }), where());
      continue;
    }
    const p = /** @type {any} */ (a.plan);
    assert.ok(p, where());
    assert.equal(p.kind, day.kind, where());
    assert.ok(p.reviewsToday >= 0 && p.reviewsToday <= due, where());
    // an Off day plans no reviews, except inside the exam window, where reviews are never dropped (code audit P0-1)
    if (day.kind === 'off' && !WINDOW.has(c.phase)) assert.equal(p.reviewsToday, 0, where());
    else if (!p.break) assert.equal(p.reviewsToday, due, where());
    else {
      seen.break++;
      assert.ok(p.reviewsToday >= Math.ceil(due / 3), where());
      assert.equal(a.newPerDay, 0, 'no new items after a break, a chosen number included');
      assert.ok(a.reviews.minutes > BREAK_FACTOR * day.minutes - 0.05, where());
    }
    assert.ok(p.slotMin >= 0 && p.slotMin <= day.slotMin && p.slotMin <= day.minutes, where());
    if (p.why) seen.why.add(p.why);
    if (p.forecast && p.forecast.cut) {
      seen.cut++;
      assert.equal(p.why, 'reviewsHigh', where());
      // hotfix: the forecast counts the reviews today's new items bring (fromNew)
      assert.ok(p.forecast.reviewMin + p.forecast.fromNew > FORECAST_LIMIT * p.forecast.plannedMin, where());
    }
    // the forecast cap only ever takes new items away; a chosen number is never cut
    const free = allowance({ c, settings, ...inp, day, forecast: null });
    assert.ok(a.newPerDay <= free.newPerDay, where());
    if (B.newPerDayChosen(settings)) assert.equal(a.newPerDay, free.newPerDay, where());
    // more forecast reviews never give more new items
    if (inp.forecast) {
      const more = allowance({ c, settings, ...inp, day, forecast: { ...inp.forecast, reviewMin: inp.forecast.reviewMin + 200 } });
      assert.ok(more.newPerDay <= a.newPerDay, where());
    }
  }
  assert.deepEqual([...seen.goals].sort(), [...GOALS].sort(), 'every goal type was drawn');
  assert.deepEqual([...seen.kinds].sort(), ['light', 'n', 'none', 'off', 'read', 'talk', 'write'], 'every day kind was drawn');
  assert.deepEqual([...seen.why].sort(), ['break', 'light', 'off', 'reviewsDue', 'reviewsHigh'], 'every reason was reached');
  assert.ok(seen.break > 50 && seen.cut > 50 && seen.chosen > 1000, JSON.stringify({ break: seen.break, cut: seen.cut, chosen: seen.chosen }));
});

/* ---------------- the forecast cap ---------------- */

test('forecast cap: over 55 % of the planned minutes, each day loses its overflow in new items, and says why', () => {
  const s = withWeek(german(), flat('n', 45));
  const c = MAINT;
  const day = dayPlan(s, c);
  const decks = { b1: { due: 9, open: 400 }, speak: { due: 0, open: 50 } };
  const planned = 14 * 45;   // 630
  const base = allowance({ c, settings: s, decks, day });
  const at = (/** @type {number} */ reviewMin) => allowance({ c, settings: s, decks, day, forecast: { reviewMin, plannedMin: planned, days: 14 } });
  // hotfix: the forecast counts the reviews today's new items will bring in the 14 days (NEW_REVIEWS_14 each), so
  // the limit is reached that much sooner. base: the sustainable rate at 45 min a day, 11
  assert.equal(base.newPerDay, B.steadyRate(7 * 45));
  const fromNew = base.newPerDay * B.NEW_REVIEWS_14 * B.REVIEW_COST.b1;   // 12.8 min
  const limit = FORECAST_LIMIT * planned - fromNew;   // 346.5 − 12.8
  assert.equal(at(limit).newPerDay, base.newPerDay);
  assert.equal(at(limit).plan?.forecast?.cut, 0);
  assert.equal(at(limit).plan?.why, null);
  assert.equal(at(FORECAST_LIMIT * planned).plan?.forecast?.cut, 2, 'at the old limit, its own new items put it over');
  // 70 min over the horizon is 5 min a day: 7 fewer new items (5 ÷ 0.75, rounded up)
  const over = at(limit + 70);
  assert.equal(over.plan?.forecast?.cut, Math.ceil(5 / NEW_ITEM_MIN));
  assert.equal(over.newPerDay, base.newPerDay - 7);
  assert.equal(over.plan?.why, 'reviewsHigh');
  // far over: down to 0, reviews untouched
  const far = at(2 * planned);
  assert.equal(far.newPerDay, 0);
  assert.equal(far.reviews.due, base.reviews.due);
  // a number he chose wins; outside maintenance there is no cap
  const chosen = { ...s, newPerDay: 12, rev: { newPerDay: 'x' } };
  assert.equal(allowance({ c, settings: chosen, decks, day, forecast: { reviewMin: planned, plannedMin: planned } }).newPerDay, 12);
  const ex = context({ today: MON, exam: D8.add(MON, 10) });
  assert.equal(allowance({ c: ex, settings: s, decks, day: dayPlan(s, ex), forecast: { reviewMin: planned, plannedMin: planned } }).plan?.forecast, null);
});

test('forecast: the course cards due in the next 14 days at their decks\' cost, against the week\'s planned minutes', async () => {
  const { store } = await session();
  const s = withWeek(german(), defaultWeek());
  const card = (/** @type {string} */ due) => ({ S: 4, D: 5, due, reps: 2, lapses: 0, last: D8.add(due, -3), first: D8.add(due, -3), stage: 1, streak: 0, learn: null, relearn: false, u: 1, hist: [] });
  store.putCards('b1', [['G:a.01', card(MON)], ['G:a.02', card(D8.add(MON, 13))], ['G:a.03', card(D8.add(MON, 14))], ['G:a.04', card(D8.add(MON, -5))]]);
  store.putCards('speak', [['SS:a', card(D8.add(MON, 2))]]);
  store.putCards('build', [['PX:a', card(D8.add(MON, 2))]]);
  store.putCards('script', [['SR:x-1', card(MON)]]);   // a script run step: not a review
  const f = reviewForecast({ store, c: MAINT, settings: s });
  assert.equal(f.days, 14);
  assert.equal(Math.round(f.reviewMin * 1000) / 1000, Math.round((3 * B.REVIEW_COST.b1 + B.REVIEW_COST.speak + B.REVIEW_COST.build) * 1000) / 1000);
  assert.equal(f.plannedMin, 2 * 245, 'two default weeks');
});

/* ---------------- back after a break, Light and Off ---------------- */

test('back after a break: urgent reviews first, the rest over 3 days, no new items until a day holds the reviews', () => {
  const s = withWeek(german({ newPerDay: 10, rev: { newPerDay: 'x' } }), flat('n', 30));
  const day = dayPlan(s, MAINT);
  // 164 due b1 cards ≈ 54.7 min > 1.5 × 30
  const a = allowance({ c: MAINT, settings: s, decks: { b1: { due: 164, open: 300 } }, day });
  assert.equal(a.plan?.break, true);
  assert.equal(a.plan?.why, 'break');
  assert.equal(a.newPerDay, 0, 'his chosen 10 waits too');
  assert.equal(a.reviews.due, 164, 'every review still counted');
  assert.equal(a.plan?.reviewsToday, 90, 'the 30 minutes hold 90 of them, more than a third (55)');
  const slotDay = { ...dayPlan(withWeek(s, flat('read', 30)), MAINT, { live: ['read'] }) };
  assert.equal(allowance({ c: MAINT, settings: s, decks: { b1: { due: 164 } }, day: slotDay }).plan?.slotMin, B.BREAK_SLOT_MIN, 'the slot shrinks to a short read');
  // between one and 1.5 days of reviews: no break, but Auto has no room for new items
  const auto = withWeek(german(), flat('n', 30));
  const heavy = allowance({ c: MAINT, settings: auto, decks: { b1: { due: 110, open: 300 } }, day: dayPlan(auto, MAINT) });
  assert.equal(heavy.plan?.break, false);
  assert.equal(heavy.plan?.why, 'reviewsDue');
  assert.equal(heavy.newPerDay, 0);
  // once a day holds them, new items come back
  const fits = allowance({ c: MAINT, settings: auto, decks: { b1: { due: 60, open: 300 } }, day: dayPlan(auto, MAINT) });
  assert.equal(fits.plan?.why, null);
  assert.ok(fits.newPerDay > 0);
  // in the exam window the window's rules plan the day: no break, no spread. Hotfix (UX review item 7): the 164
  // reviews do not fit the day, so no new items but his mistakes (none here), and the plan says why
  const ex = context({ today: MON, exam: D8.add(MON, 9) });
  const w = allowance({ c: ex, settings: auto, decks: { b1: { due: 164, open: 300 } }, day: dayPlan(auto, ex), priorityLeft: 50 });
  assert.equal(w.plan?.break, false);
  assert.equal(w.newPerDay, 0);
  assert.equal(w.plan?.why, 'reviewsDue');
  assert.equal(w.plan?.reviewsToday, 164, 'every review planned');
  const wl = allowance({ c: ex, settings: auto, decks: { b1: { due: 20, open: 300 } }, day: dayPlan(auto, ex), priorityLeft: 50 });
  assert.ok(wl.newPerDay > 0, 'when the reviews fit, new items come');
});

test('Light and Off days: reviews only, or none planned; a chosen number waits; Off reviews stay counted', () => {
  const chosen = german({ newPerDay: 15, rev: { newPerDay: 'x' } });
  for (const [kind, min] of /** @type {const} */ ([['light', 20], ['off', 0]])) {
    const s = withWeek(chosen, flat(kind, min));
    const a = allowance({ c: MAINT, settings: s, decks: { b1: { due: 23, open: 100 }, speak: { due: 2, open: 10 } }, day: dayPlan(s, MAINT) });
    assert.equal(a.newPerDay, 0, kind);
    assert.equal(a.plan?.why, kind);
    assert.equal(a.reviews.due, 25);
    assert.equal(a.plan?.reviewsToday, kind === 'off' ? 0 : 25);
  }
});

/* ---------------- the store side: memo, todayPlan, no writes ---------------- */

const PID = '0192a3b4-c5d6-7e8f-9a0b-0000000000b1';
async function session(today = MON) {
  const clock = { today: () => today };
  const store = await Store.open({ adapter: createMemoryAdapter(), profile: { id: PID, name: '', kind: 'local' }, device: { deviceId: 'dev', seq: 0 }, clock });
  store.set('settings', german());
  let t = Date.UTC(2026, 9, 19, 8);
  const app = { store, hlc: createHlc('dev', () => (t += 1000)), bus: { emit: () => {} }, clock };
  migrateCourses(store);
  return { store, app };
}

test('memo: dayAllowance is kept per store revision and day, and each caller gets its own copy', async () => {
  const { store } = await session();
  const s = withWeek(german(), flat('n', 45));
  const a = dayAllowance({ store, c: MAINT, settings: s });
  const b = dayAllowance({ store, c: MAINT, settings: s });
  assert.deepEqual(a, b);
  assert.notEqual(a, b, 'a copy');
  a.decks.b1.due = 999;
  assert.notEqual(dayAllowance({ store, c: MAINT, settings: s }).decks.b1.due, 999, 'a caller cannot change the cache');
  const rev = store.rev;
  store.putCards('b1', [['G:x.01', { S: 1, D: 5, due: MON, reps: 1, lapses: 0, last: D8.add(MON, -1), first: D8.add(MON, -1), stage: 0, streak: 0, learn: null, relearn: false, u: 1, hist: [] }]]);
  assert.ok(store.rev > rev, 'a write bumps the revision');
  assert.equal(dayAllowance({ store, c: MAINT, settings: s }).decks.b1.due, b.decks.b1.due + 1, 'and the next read sees it');
  const tue = context({ today: D8.add(MON, 1), exam: null });
  assert.notDeepEqual(dayAllowance({ store, c: tue, settings: s }).plan, undefined);
});

test('todayPlan: the providers\' ctx.day; Study anyway is a device kv for one day; no read ever writes a card or a kv', async () => {
  const { store } = await session();
  const none = german();
  assert.deepEqual(todayPlan({ store, c: MAINT, settings: none }), dayPlan(none, MAINT), 'no week: the round 3 day');
  const offWeek = withWeek(german(), flat('off', 0));
  assert.equal(todayPlan({ store, c: MAINT, settings: offWeek }).kind, 'off');
  store.set(ANYWAY_KV, { day: MON });
  assert.equal(todayPlan({ store, c: MAINT, settings: offWeek }).kind, 'n');
  assert.equal(todayPlan({ store, c: context({ today: D8.add(MON, 1), exam: null }), settings: offWeek }).kind, 'off', 'only that day');
  // a spy: reading the plan, the allowance and the budget for many exam dates never writes
  let writes = 0;
  const put = store.putCards.bind(store), set = store.set.bind(store);
  store.putCards = (/** @type {any[]} */ ...x) => { writes++; return put(...x); };
  store.set = (/** @type {any[]} */ ...x) => { writes++; return set(...x); };
  for (const exam of [null, D8.add(MON, 60), D8.add(MON, 14), D8.add(MON, 5), D8.add(MON, 1), MON, D8.add(MON, -3)]) {
    const c = context({ today: MON, exam });
    for (const settings of [none, withWeek(german(), defaultWeek()), offWeek]) { todayPlan({ store, c, settings }); todayBudget({ store, c, settings }); }
  }
  assert.equal(writes, 0);
});

test('away: whole days without study before today', async () => {
  const { store } = await session();
  assert.equal(awayDays(store, MON), null);
  store.set('activity', { [D8.add(MON, -7)]: { minutes: 20, rounds: 1 }, [D8.add(MON, -1)]: { minutes: 0, rounds: 0 } });
  assert.equal(awayDays(store, MON), 6);
  store.set('activity', { [D8.add(MON, -1)]: { minutes: 5, rounds: 1 } });
  assert.equal(awayDays(store, MON), 0);
});

/* ---------------- settings round trip ---------------- */

test('settings: a week and a level goal written on one device reach the plan on another, through merge and an older record', async () => {
  const { store, app } = await session();
  const id = store.get('settings').activeCourse;
  S.setCourse(app, id, { week: defaultWeek(), 'goal.level': 'B2' });
  const written = store.get('settings');
  const other = S.normalizeSettings(german());   // a device that never saw the fields
  for (const m of [S.mergeSettings(other, written), S.mergeSettings(written, other)]) {
    const n = S.normalizeSettings(JSON.parse(JSON.stringify(m)));
    assert.deepEqual(n.courses[0].week, defaultWeek());
    assert.equal(n.courses[0].goal.level, 'B2');
    assert.deepEqual(dayPlan(n, { today: D8.add(MON, 2) }), { kind: 'light', minutes: 20, slot: null, slotMin: 0, planned: true });
  }
  // cleared again: the round 3 day
  S.setCourse(app, id, { week: null });
  assert.equal(dayPlan(S.normalizeSettings(store.get('settings')), MAINT).planned, false);
});

test('reading: deck read gets its share of new items (practice.readNew) on a normal day; Light, Off and a break give it a deliberate 0', () => {
  const decks = { b1: { due: 10, open: 300 }, read: { due: 2, open: 30 } };
  const s = withWeek(german({ practice: { readAloud: true, readNew: 5 } }), flat('n', 45));
  const n = allowance({ c: MAINT, settings: s, decks, day: dayPlan(s, MAINT) });
  // hotfix: the day's number is the sustainable rate (11 at 45 min a day), split by the decks' wants
  assert.ok(n.newPerDay <= B.steadyRate(7 * 45));
  assert.ok(n.decks.read.newPerDay > 0 && n.decks.read.newPerDay <= 5);
  assert.equal(n.decks.read.newLeft, n.decks.read.newPerDay);
  for (const [kind, min] of /** @type {const} */ ([['light', 20], ['off', 0]])) {
    const w = withWeek(s, flat(kind, min));
    const a = allowance({ c: MAINT, settings: w, decks, day: dayPlan(w, MAINT) });
    assert.equal(a.decks.read.newPerDay, 0, kind);
    assert.equal(a.decks.read.newLeft, 0, kind);
    assert.equal(a.decks.read.due, 2, `${kind}: its reviews stay counted`);
  }
  const br = allowance({ c: MAINT, settings: s, decks: { ...decks, b1: { due: 300, open: 300 } }, day: dayPlan(s, MAINT) });
  assert.equal(br.decks.read.newPerDay, 0, 'after a break');
  // a Read day with the slot live: the providers' slot minutes, a third of the day after reviews
  const r = withWeek(s, flat('read', 45));
  const rd = allowance({ c: MAINT, settings: r, decks, day: dayPlan(r, MAINT, { live: ['read'] }) });
  assert.deepEqual([rd.plan?.slot, rd.plan?.slotMin], ['read', 15]);
  assert.ok(rd.decks.read.newPerDay > 0 && rd.decks.read.newPerDay <= 5);
});
