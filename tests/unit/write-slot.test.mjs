// A Write day (round 4 ruling 8): the week plan's Write slot is one Schreiben task written from memory, with the slot's
// minutes; done once a task was written today; with no tasks known yet, the Schreiben page. Synthetic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planItems } from '../../src/features/practice-write/plan.js';
import { nextWritingTask } from '../../src/domain/allowance.js';

const t = (/** @type {string} */ k) => k;
const TASKS = [{ id: 'T1-A1', a: 'A1', title: 'Einladung', min: 20 }, { id: 'T1-A2', a: 'A2', title: 'Forum', min: 25 }, { id: 'T2-A1', a: 'A1', title: 'Umzug', min: 20 }];
const store = (/** @type {Record<string, any>} */ kv = {}) => ({ get: (/** @type {string} */ n, /** @type {any} */ d) => (n in kv ? kv[n] : d), cards: () => ({}), cardsByDeck: {}, rev: undefined });
const c = { today: '2026-10-22', exam: null, phase: 'none', newItems: true };

test('nextWritingTask: the Aufgabe written least recently, a task not written yet; done when one was written today', () => {
  const s = store({ 'b1.session': { stats: { tasks: TASKS } }, 'practice.write': { written: { 'T1-A1': '2026-10-01' } } });
  assert.equal(nextWritingTask({ store: s, c })?.id, 'T1-A2');
  const done = store({ 'b1.session': { stats: { tasks: TASKS } }, 'practice.write': { written: { 'T1-A2': c.today } } });
  assert.deepEqual(nextWritingTask({ store: done, c }), { ...TASKS[1], done: true });
  assert.equal(nextWritingTask({ store: store(), c }), null);
});

test('a Write day has the Writing row with the slot minutes; other days do not', () => {
  const settings = { language: 'german', minutesPerDay: 45, exam: { type: null }, courses: [] };
  const slot = { kind: 'write', minutes: 45, slot: 'write', slotMin: 15, planned: true };
  const s = store({ 'b1.session': { stats: { tasks: TASKS } } });
  const row = planItems(/** @type {any} */ ({ store: s, c, settings, t, day: slot })).find(r => r.id === 'write.slot');
  assert.ok(row, 'the slot row');
  assert.deepEqual([row.minutes, row.href, row.done || false], [15, '#/practice/write/build/T1-A1/free', false]);
  const none = planItems(/** @type {any} */ ({ store: store(), c, settings, t, day: slot })).find(r => r.id === 'write.slot');
  assert.equal(none?.href, '#/practice/write', 'no tasks known yet: the Schreiben page');
  assert.equal(planItems(/** @type {any} */ ({ store: s, c, settings, t, day: { ...slot, kind: 'n', slot: null, slotMin: 0 } })).some(r => r.id === 'write.slot'), false);
});
