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

test('week: priority order within the minutes, at most four rows, setup last', () => {
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
  assert.equal(r.minutes.planned, 73);
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
