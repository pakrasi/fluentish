// core/clock.js: the study day, the phases from a user-set exam date, labels, and the app clock.
// Runs in a time-zone matrix in CI (TZ=America/New_York, Europe/Berlin, Asia/Kolkata).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../../src/core/clock.js';

test('study day: 04:00 cutoff in local time', () => {
  assert.equal(C.today(new Date(2026, 9, 3, 1, 30)), '2026-10-02');
  assert.equal(C.today(new Date(2026, 9, 3, 3, 59)), '2026-10-02');
  assert.equal(C.today(new Date(2026, 9, 3, 4, 0)), '2026-10-03');
  assert.equal(C.today(new Date(2026, 9, 3, 23, 59)), '2026-10-03');
  assert.equal(C.today(new Date(2026, 9, 3, 2, 0), 0), '2026-10-03', 'cutoff 0 = midnight');
});

test('study day across the DST change (1 Nov 2026 in the US, 25 Oct in Europe)', () => {
  // whatever the zone, 01:30 belongs to the previous day and noon to the same day
  for (const [y, m, d] of [[2026, 10, 1], [2026, 9, 25], [2027, 2, 14]]) {
    const prev = C.iso(new Date(y, m, d - 1, 12));
    assert.equal(C.today(new Date(y, m, d, 1, 30)), prev);
    assert.equal(C.today(new Date(y, m, d, 12, 0)), C.iso(new Date(y, m, d, 12)));
  }
  assert.equal(C.add('2026-10-31', 1), '2026-11-01');
  assert.equal(C.add('2026-11-01', 1), '2026-11-02');
  assert.equal(C.diff('2026-10-24', '2026-10-26'), 2);
  assert.equal(C.diff('2026-10-31', '2026-11-02'), 2);
});

test('phases: none without a date, then week · lastNew · eve · day · after', () => {
  assert.equal(C.phase('2026-10-03', null), 'none');
  assert.equal(C.phase('2026-10-03', undefined), 'none');
  const ex = '2026-10-09';
  assert.deepEqual(['2026-09-01', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2027-01-01'].map(d => C.phase(d, ex)),
    ['week', 'week', 'lastNew', 'eve', 'day', 'after', 'after']);
});

test('context: everything derived from the date follows it', () => {
  const c = C.context({ today: '2026-10-03', exam: '2026-10-09' });
  assert.deepEqual(c, { today: '2026-10-03', exam: '2026-10-09', phase: 'week', daysLeft: 6, lastNewDay: '2026-10-07', capDay: '2026-10-08', newItems: true, mocks: true });
  const moved = C.context({ today: '2026-10-03', exam: '2026-10-16' });
  assert.equal(moved.daysLeft, 13); assert.equal(moved.lastNewDay, '2026-10-14'); assert.equal(moved.capDay, '2026-10-15');
  const none = C.context({ today: '2026-10-03', exam: null });
  assert.deepEqual(none, { today: '2026-10-03', exam: null, phase: 'none', daysLeft: null, lastNewDay: null, capDay: null, newItems: true, mocks: true });
  assert.equal(C.context({ today: '2026-10-08', exam: '2026-10-09' }).newItems, false, 'eve: no new items');
  assert.equal(C.context({ today: '2026-10-08', exam: '2026-10-09' }).mocks, false, 'eve: no mock');
  assert.equal(C.context({ today: '2026-10-09', exam: '2026-10-09' }).mocks, false, 'day: no mock');
  assert.equal(C.context({ today: '2026-10-12', exam: '2026-10-09' }).daysLeft, -3);
  assert.equal(C.context({ today: '2026-10-03', exam: 'not a date' }).phase, 'none', 'garbage is no date');
  assert.equal(C.context({ today: '2026-02-30', exam: null, now: new Date(2026, 9, 3, 12) }).today, '2026-10-03', 'an invalid forced day is ignored');
});

test('labels', () => {
  assert.equal(C.label('2026-10-09'), 'Fri 9 Oct');
  assert.equal(C.label('2026-09-09'), 'Wed 9 Sep', 'one spelling of September in every engine');
  assert.equal(C.labelLong('2026-10-09'), 'Fri 9 Oct 2026');
  assert.match(C.labelDe('2026-10-09'), /^9\. Okt\.?$/);
  assert.equal(C.weekdayShort('2026-10-09'), 'Fr');
  assert.equal(C.rel('2026-10-04', '2026-10-03'), 'tomorrow');
  assert.equal(C.rel('2026-10-03', '2026-10-03'), 'today');
  assert.equal(C.rel('2026-10-06', '2026-10-03'), 'in 3 days');
  assert.equal(C.rel('2026-10-01', '2026-10-03'), '2 days ago');
});

test('epoch day is UTC (the SM-2 deck unit)', () => {
  assert.equal(C.epochDay(new Date(Date.UTC(2026, 9, 3, 23, 30))), Math.floor(Date.UTC(2026, 9, 3) / 864e5));
});

test('createClock reads the setting, memoises per day and date, honours a forced day', () => {
  let exam = '2026-10-09', now = new Date(2026, 9, 3, 10);
  const clock = C.createClock({ exam: () => exam, now: () => now });
  const a = clock.ctx();
  assert.equal(a.daysLeft, 6);
  assert.equal(clock.ctx(), a, 'same object while nothing changed');
  exam = '2026-10-16';
  assert.equal(clock.ctx().daysLeft, 13, 'a new date is picked up at once');
  now = new Date(2026, 9, 4, 3, 0);
  assert.equal(clock.today(), '2026-10-03', 'before 04:00 it is still yesterday');
  exam = null;
  assert.equal(clock.ctx().phase, 'none');
  const forced = C.createClock({ exam: () => '2026-10-09', forcedToday: '2026-10-08' });
  assert.equal(forced.ctx().phase, 'eve');
});
