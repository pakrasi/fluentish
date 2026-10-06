// Today in maintenance (round 4, L1c): the week strip's days, the kind-of-day line, why new items are fewer, and when
// the exam's mock rows fold away. Synthetic settings only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fmtMin, weekDays, weekTotals, laterThisWeek, kindLine, whyLine, examRows } from '../../src/features/today/week.js';
import { defaultWeek } from '../../src/domain/week.js';

const t = (/** @type {string} */ k, /** @type {any} */ v = {}) => `${k}${JSON.stringify(v)}`;
const settings = (week = defaultWeek()) => ({ minutesPerDay: 45, activeCourse: 'de', courses: [{ id: 'de', lang: 'de', level: 'B1', goal: { exam: null, date: null }, decks: [], week }] });
// a Wednesday: Mon 0 … Sun 6 of the default week (45 n, 45 read, 20 light, 45 write, 30 n, 60 talk, 0 off)
const WED = '2026-04-15';

test('fmtMin: minutes, whole hours and hours with minutes', () => {
  assert.equal(fmtMin(t, 45), 'unit.min{"n":45}');
  assert.equal(fmtMin(t, 120), 'unit.h{"h":2}');
  assert.equal(fmtMin(t, 245), 'unit.hm{"h":4,"m":"05"}');
});

test('weekDays: Monday first, the week\'s minutes, done from activity, today marked; the default week is 4 h 05', () => {
  const days = weekDays({ settings: settings(), today: WED, activity: { '2026-04-13': { minutes: 52 }, '2026-04-15': { minutes: 7.6 } } });
  assert.equal(days.length, 7);
  assert.equal(days[0].day, '2026-04-13');
  assert.deepEqual(days.map(d => d.plan), [45, 45, 20, 45, 30, 60, 0]);
  assert.deepEqual(days.map(d => d.kind), ['n', 'read', 'light', 'write', 'n', 'talk', 'off']);
  assert.deepEqual(days.map(d => d.done), [52, 0, 8, 0, 0, 0, 0]);
  assert.deepEqual(days.map(d => d.today), [false, false, true, false, false, false, false]);
  assert.deepEqual(weekTotals(days), { plan: 245, done: 60 });
  // read, write and talk have no feature yet: they are planned as normal days
  assert.deepEqual(days.map(d => d.as), ['n', 'n', 'light', 'n', 'n', 'n', 'off']);
  assert.deepEqual(laterThisWeek(days).map(d => d.day), ['2026-04-16', '2026-04-17', '2026-04-18', '2026-04-19']);
});

test('weekDays: without a week every day is minutes a day; Study anyway turns today\'s Off into a normal day', () => {
  const none = weekDays({ settings: settings(null), today: WED, activity: {} });
  assert.deepEqual(none.map(d => d.plan), [45, 45, 45, 45, 45, 45, 45]);
  const sun = '2026-04-19';
  assert.equal(weekDays({ settings: settings(), today: sun, activity: {} })[6].plan, 0);
  assert.equal(weekDays({ settings: settings(), today: sun, activity: {}, anyway: true })[6].plan, 45);
});

test('kindLine: the kind of a day from a week, none without one; coming later and Study anyway say so', () => {
  assert.equal(kindLine(undefined), null);
  assert.deepEqual(kindLine({ kind: 'light' }), { key: 'week.day.light' });
  assert.deepEqual(kindLine({ kind: 'off' }), { key: 'week.day.off' });
  assert.deepEqual(kindLine({ kind: 'n', asked: 'read' }), { key: 'week.day.asked', vars: { kind: 'read' } });
  assert.deepEqual(kindLine({ kind: 'n' }, { anyway: true }), { key: 'week.day.anyway' });
});

test('whyLine: a break is a welcome back with the numbers; the forecast cap and a full day say why; light and off are the kind line', () => {
  assert.deepEqual(whyLine({ why: 'break', away: 6, reviewsToday: 58 }, 164), { key: 'week.why.break', vars: { d: 6, n: 164, k: 58 }, welcome: true });
  assert.deepEqual(whyLine({ why: 'break', away: null, reviewsToday: 58 }, 164), { key: 'week.why.breakDue', vars: { n: 164, k: 58 }, welcome: true });
  assert.deepEqual(whyLine({ why: 'reviewsHigh' }), { key: 'today.why.reviewsHigh' });
  assert.deepEqual(whyLine({ why: 'reviewsDue' }), { key: 'week.why.reviewsDue' });
  assert.equal(whyLine({ why: 'light' }), null);
  assert.equal(whyLine({ why: 'off' }), null);
  assert.equal(whyLine({ why: null }), null);
});

test('examRows: open in the window and for 14 days after; folded otherwise when there are scores; none without', () => {
  const c = (/** @type {string} */ phase, /** @type {string | null} */ exam, today = '2026-10-20') => ({ phase, exam, today });
  assert.equal(examRows(c('week', '2026-10-25'), false), 'open');
  assert.equal(examRows(c('day', '2026-10-20'), false), 'open');
  assert.equal(examRows(c('after', '2026-10-13'), true), 'open');
  assert.equal(examRows(c('after', '2026-10-13', '2026-10-27'), true), 'open');
  assert.equal(examRows(c('after', '2026-10-13', '2026-10-28'), true), 'folded');
  assert.equal(examRows(c('none', '2027-06-12'), true), 'folded');
  assert.equal(examRows(c('none', null), true), 'folded');
  assert.equal(examRows(c('none', null), false), 'none');
});
