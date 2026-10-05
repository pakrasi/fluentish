// Today's plan composer: the exam-date rules, the minutes budget, ordering and the states.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeToday, roundMinutes } from '../../src/domain/today.js';
import { context } from '../../src/core/clock.js';

const item = (id, o = {}) => ({ id, source: 'x', kind: 'review', title: id, minutes: 10, href: `#/${id}`, priority: 50, ...o });
const items = [
  item('review', { priority: 20, minutes: 8 }),
  item('mock', { kind: 'mock', mock: true, priority: 30, minutes: 40 }),
  item('new', { kind: 'new', introducesNew: true, priority: 40, minutes: 6 }),
  item('speak', { kind: 'speak', priority: 50, minutes: 6 }),
  item('frames', { kind: 'read', priority: 60, minutes: 5 }),
  item('warmup', { kind: 'warmup', priority: 10, minutes: 3 }),
  item('setdate', { kind: 'setup', priority: 90, minutes: 0 }),
];
const ids = r => r.rows.map(x => x.id);

test('week: priority order within the minutes, at most five open rows, setup last', () => {
  const r = composeToday({ ctx: context({ today: '2026-10-03', exam: '2026-10-09' }), budget: 60, items });
  assert.deepEqual(ids(r), ['warmup', 'review', 'mock', 'new', 'setdate']);
  assert.equal(r.minutes.planned, 57);
  assert.equal(r.more, 2);
  assert.equal(r.primary.id, 'warmup');
  assert.equal(r.state, 'todo');
});

test('one mock module may run over the minutes; nothing else does', () => {
  const ctx = context({ today: '2026-10-03', exam: '2026-10-09' });
  const r = composeToday({ ctx, budget: 60, items: [item('review', { priority: 20, minutes: 8 }), item('mock', { kind: 'mock', mock: true, priority: 30, minutes: 65 }), item('speak', { kind: 'speak', priority: 50, minutes: 6 })] });
  assert.deepEqual(ids(r), ['review', 'mock']);
  assert.equal(r.rows[0].minutes, 4, 'the review round is cut to one round');
  assert.equal(r.rows[0].cut, true);
  assert.equal(r.minutes.planned, 69);
  assert.deepEqual(r.minutes.mock, { title: 'mock', minutes: 65 });
  assert.deepEqual(r.extra.map(x => x.id), ['speak'], 'what did not fit is listed, not just counted');
});

test('without a mock the plan never runs over: a long review round is cut to whole rounds that fit', () => {
  const ctx = context({ today: '2026-10-03', exam: '2026-10-09' });
  const r = composeToday({ ctx, budget: 30, items: [item('review', { priority: 20, minutes: 48, rounds: 12 }), item('speak', { kind: 'speak', priority: 50, minutes: 6 })] });
  assert.deepEqual(ids(r), ['review']);
  assert.equal(r.rows[0].minutes, 28); assert.equal(r.rows[0].rounds, 7); assert.equal(r.minutes.planned, 28);
  assert.equal(r.minutes.cut, true); assert.equal(r.minutes.mock, null);
});

test('a small budget still gets the first row', () => {
  const r = composeToday({ ctx: context({ today: '2026-10-03', exam: '2026-10-09' }), budget: 5, items: [item('mock', { mock: true, kind: 'mock', minutes: 40 })] });
  assert.deepEqual(ids(r), ['mock']);
});

test('lastNew keeps new items and mocks; eve drops both', () => {
  const lastNew = composeToday({ ctx: context({ today: '2026-10-07', exam: '2026-10-09' }), budget: 90, items });
  assert.ok(ids(lastNew).includes('new') && ids(lastNew).includes('mock'));
  const eve = composeToday({ ctx: context({ today: '2026-10-08', exam: '2026-10-09' }), budget: 90, items });
  assert.deepEqual(ids(eve), ['warmup', 'review', 'speak', 'frames', 'setdate']);
});

test('exam day: only the warm-up and things to read', () => {
  const r = composeToday({ ctx: context({ today: '2026-10-09', exam: '2026-10-09' }), budget: 60, items });
  assert.deepEqual(ids(r), ['warmup', 'frames', 'setdate']);
});

test('after and none plan like an ordinary day', () => {
  for (const exam of ['2026-10-01', null]) {
    const r = composeToday({ ctx: context({ today: '2026-10-03', exam }), budget: 60, items });
    assert.ok(ids(r).includes('mock') && ids(r).includes('new'), String(exam));
  }
});

test('states: done when every row is done, empty when there is nothing to do', () => {
  const ctx = context({ today: '2026-10-03', exam: null });
  const done = composeToday({ ctx, budget: 60, items: [item('a', { done: true }), item('b', { done: true })] });
  assert.equal(done.state, 'done'); assert.equal(done.primary, null);
  const empty = composeToday({ ctx, budget: 60, items: [item('s', { kind: 'setup', minutes: 0 })] });
  assert.equal(empty.state, 'empty'); assert.deepEqual(ids(empty), ['s']);
  const half = composeToday({ ctx, budget: 60, items: [item('a', { done: true, priority: 1 }), item('b', { priority: 2 })] });
  assert.equal(half.primary.id, 'b', 'the sticky button is the first unfinished row');
});

test('feedback is capped at three with a count of the rest', () => {
  const fb = Array.from({ length: 5 }, (_, i) => ({ id: `f${i}`, title: 't', status: 's', href: '#' }));
  const r = composeToday({ ctx: context({ today: '2026-10-03', exam: null }), budget: 60, items: [], feedback: fb });
  assert.equal(r.feedback.length, 3); assert.equal(r.feedbackMore, 2);
});

test('round minutes', () => {
  assert.equal(roundMinutes(0), 4); assert.equal(roundMinutes(12), 4); assert.equal(roundMinutes(38), 13);
});

test('one budget: new items, rounds and minutes; a carried-over number counts as Auto', async () => {
  // round 3: allowance() replaces dayBudget(); the same day, now with every deck in one number. Only the b1 deck is
  // given here, so its share is the day's.
  const { allowance, newPerDayChosen, streamQuota } = await import('../../src/domain/budget.js');
  const s = { minutesPerDay: 60, newPerDay: null, exam: { type: 'goethe-b1' }, rev: {} };
  const c = context({ today: '2026-10-03', exam: '2026-10-09' });
  const at = (/** @type {any} */ o) => allowance({ c, settings: s, decks: { b1: { due: 24 } }, priorityLeft: 100, ...o });
  const b = at({});
  // 6 days left, 5 new-days: pace 20; fit (30 − 8) / 0.75 = 29 → 20 new; 8 + 15 = 23 min → 6 rounds, 24 min
  assert.equal(b.decks.b1.newPerDay, 20); assert.equal(b.decks.b1.newLeft, 20); assert.equal(b.decks.b1.rounds, 6); assert.equal(b.decks.b1.minutes, 24);
  assert.deepEqual(b.pace, { lastNew: '2026-10-07', left: 100, needed: 20, reach: 100, fits: true });
  const legacy = { ...s, newPerDay: 30 };
  assert.equal(newPerDayChosen(legacy), false, 'Igloo\'s 30 a day has no rev stamp');
  assert.equal(at({ settings: legacy }).newPerDay, 20, 'so Auto applies');
  assert.equal(at({ settings: { ...legacy, rev: { newPerDay: 'x' } } }).newPerDay, 30, 'a number chosen here is kept');
  // the pace line moves with the horizon
  const far = allowance({ c: context({ today: '2026-10-03', exam: '2026-10-30' }), settings: s, decks: { b1: {} }, priorityLeft: 100 });
  assert.equal(far.pace.needed, 4);
  const short = allowance({ c: context({ today: '2026-10-03', exam: '2026-10-07' }), settings: s, decks: { b1: {} }, priorityLeft: 200 });
  assert.equal(short.pace.needed, 67); assert.equal(short.decks.b1.newPerDay, 40, 'the minutes cap it'); assert.equal(short.pace.fits, false); assert.equal(short.pace.reach, 120);
  for (const n of [0, 1, 7, 20, 55]) assert.equal(streamQuota(n, 'p') + streamQuota(n, 'g'), n);
  assert.equal(allowance({ c: context({ today: '2026-10-08', exam: '2026-10-09' }), settings: s, decks: { b1: {} }, priorityLeft: 9 }).decks.b1.rounds, 0, 'eve, nothing due: no rounds');
});

test('next to a short mock the review round keeps what still fits', () => {
  const ctx = context({ today: '2026-10-03', exam: '2026-10-09' });
  const r = composeToday({ ctx, budget: 60, items: [item('review', { priority: 20, minutes: 44, rounds: 11 }), item('mock', { kind: 'mock', mock: true, priority: 30, minutes: 30 })] });
  assert.equal(r.rows[0].minutes, 28); assert.equal(r.minutes.planned, 58); assert.equal(r.minutes.mock, null, 'nothing runs over now');
});

test('a row done today stays in the plan with its check, even after a mock runs over and the review round is cut', () => {
  const ctx = context({ today: '2026-10-04', exam: '2026-10-08' });
  const r = composeToday({ ctx, budget: 60, items: [
    item('review', { priority: 20, minutes: 24, rounds: 6, actionFor: n => `1 of ${n}` }),
    item('mock', { kind: 'mock', mock: true, priority: 30, minutes: 65 }),
    item('situations', { kind: 'speak', priority: 48, minutes: 4, done: true }),
  ] });
  assert.deepEqual(ids(r), ['review', 'mock', 'situations']);
  assert.equal(r.extra.length, 0, 'nothing done drops to "If you have time"');
  assert.equal(r.rows[0].cut, true); assert.equal(r.rows[0].rounds, 1);
  assert.equal(r.rows[0].action, '1 of 1', 'a cut row relabels its button with the rounds it now has');
});

test('the review cut happens before the next row is tested: a row after the mock is tested against the cut minutes', () => {
  const ctx = context({ today: '2026-10-04', exam: '2026-10-08' });
  const r = composeToday({ ctx, budget: 60, items: [
    item('review', { priority: 20, minutes: 20, rounds: 5 }),
    item('mock', { kind: 'mock', mock: true, priority: 30, minutes: 45 }),
    item('talk', { kind: 'speak', priority: 50, minutes: 6 }),
  ] });
  // 20 + 45 runs over: the review is cut to 12 (60 − 45, whole rounds), so 57 planned, and the 6-minute talk does not fit
  assert.equal(r.rows[0].minutes, 12);
  assert.deepEqual(r.extra.map(x => x.id), ['talk']);
  const s = composeToday({ ctx, budget: 60, items: [
    item('review', { priority: 20, minutes: 20, rounds: 5 }),
    item('mock', { kind: 'mock', mock: true, priority: 30, minutes: 45 }),
    item('sit', { kind: 'speak', priority: 50, minutes: 3 }),
  ] });
  assert.deepEqual(ids(s), ['review', 'mock', 'sit'], 'a 3-minute row fits in what the cut left (57 + 3 = 60)');
});

test('arrange: the Schreiben task stays first and its correction follows it; situations move up on a non-Sprechen mock day', async () => {
  // changed in round 3 (journey #2): a correction waiting no longer replaces the task from memory. The task stays
  // (priority 18) and the correction is its own row right after it (practice.correction, priority 19), a new one to
  // read before one to get. Every Schreiben mock waiting for a correction leaves Feedback: the plan row counts them.
  // A Schreiben mock day drops the task only when the mock may run over (the whole module fits the day).
  const { arrange } = await import('../../src/features/day.js');
  const t = (k, v = {}) => `${k}${Object.keys(v).length ? ' ' + JSON.stringify(v) : ''}`;
  const task = item('practice.schreiben', { kind: 'write', priority: 18, minutes: 20, href: '#/practice/write/build/a1-x/free' });
  const sit = item('practice.situations', { kind: 'speak', priority: 48, minutes: 4 });
  const mock = item('exam.next', { kind: 'mock', mock: true, module: 'lesen', priority: 30, minutes: 65 });
  const read = { id: 'fb.1', title: 'Schreiben · Test 3', status: 's', href: '#/exam/3/schreiben/review/a', module: 'schreiben', need: 'read', test: 3 };
  const get = { id: 'uncorrected.2', title: 'Schreiben · Test 2', status: 's', href: '#/exam/2/schreiben/review/b?correct=1', module: 'schreiben', need: 'correct', test: 2 };
  let a = arrange([task, sit, mock], [get, read], t);
  assert.equal(a.items.find(r => r.id === 'practice.schreiben').href, task.href, 'the task stays');
  const corr = a.items.find(r => r.id === 'practice.correction');
  assert.equal(corr.href, read.href); assert.equal(corr.minutes, 5); assert.equal(corr.priority, 19);
  assert.match(corr.detail, /plan\.schreiben\.more \{"n":1\}/, 'the other one waiting is counted on the row');
  assert.deepEqual(a.feedback.map(f => f.id), [], 'both leave the Feedback list');
  assert.equal(a.items.find(r => r.id === 'practice.situations').priority, 28);
  a = arrange([task, sit, mock], [get], t);
  assert.equal(a.items.find(r => r.id === 'practice.correction').href, get.href);
  a = arrange([task, sit, { ...mock, module: 'schreiben' }], [], t);
  assert.ok(!a.items.some(r => r.id === 'practice.schreiben'), 'a Schreiben mock day that fits writes the mock instead');
  a = arrange([task, sit, { ...mock, module: 'schreiben', noOverrun: true }], [], t);
  assert.ok(a.items.some(r => r.id === 'practice.schreiben'), 'a Schreiben mock that does not fit the day leaves the task in place');
  a = arrange([task, sit, { ...mock, module: 'sprechen' }], [], t);
  assert.equal(a.items.find(r => r.id === 'practice.situations').priority, 48);
});
