// Conversation's Today row (features/practice-conversation/plan.js): only on a Talk day of his week (ctx.day.slot
// 'talk', lane L1b), with the slot's minutes; done once a conversation of today has ended. Synthetic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planItems } from '../../src/features/practice-conversation/plan.js';
import { dayPlan, LIVE_SLOTS } from '../../src/domain/week.js';

const t = (/** @type {string} */ k, /** @type {any} */ v = {}) => `${k}${v.min ? `:${v.min}` : ''}`;
const store = (/** @type {any} */ kv = {}) => ({ get: (/** @type {string} */ n, /** @type {any} */ d) => kv[n] ?? d });
const c = { today: '2026-10-24', phase: 'none' };
const german = { language: 'german', minutesPerDay: 60, activeCourse: 'de', courses: [{ id: 'de', lang: 'de', week: { min: [45, 45, 20, 45, 30, 60, 0], kind: ['n', 'read', 'light', 'write', 'n', 'talk', 'off'] } }] };

test('a Talk day has the row with the slot minutes; other days have none', () => {
  assert.ok(LIVE_SLOTS.includes('talk'), 'the Talk slot is live (lane L4 ships its row)');
  const day = dayPlan(german, c);                               // 2026-10-24 is a Saturday: Talk, 60 min
  assert.deepEqual([day.kind, day.slot, day.slotMin], ['talk', 'talk', 20]);
  const keyed = { secrets: { anthropicKey: 'test-key-not-real' } };
  const rows = planItems(/** @type {any} */ ({ store: store(keyed), c, settings: german, t, day }));
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].id, rows[0].minutes, rows[0].href, rows[0].done, rows[0].kind], ['conversation.talk', 20, '#/practice/conversation?from=today', false, 'speak']);
  // without a key the row leads to Connections and says why
  const nokey = planItems(/** @type {any} */ ({ store: store(), c, settings: german, t, day }))[0];
  assert.deepEqual([nokey.href, nokey.detail], ['#/profile/connections', 'conv.plan.noKey']);
  assert.deepEqual(planItems(/** @type {any} */ ({ store: store(), c: { ...c, today: '2026-10-23' }, settings: german, t, day: dayPlan(german, { today: '2026-10-23' }) })), []);
  assert.deepEqual(planItems(/** @type {any} */ ({ store: store(), c, settings: { ...german, courses: [] }, t, day: dayPlan({ ...german, courses: [] }, c) })), [], 'no week: no row');
  assert.deepEqual(planItems(/** @type {any} */ ({ store: store(), c: { ...c, phase: 'eve' }, settings: german, t, day })), [], 'not on the exam eve');
});

test('done once a conversation of today ended with a message of his', () => {
  const day = dayPlan(german, c);
  const s = (/** @type {any} */ o) => ({ 'conv.sessions': { a: { id: 'a', day: c.today, status: 'ended', turns: 4, deletedAt: null, ...o } } });
  assert.equal(planItems(/** @type {any} */ ({ store: store(s({})), c, settings: german, t, day }))[0].done, true);
  assert.equal(planItems(/** @type {any} */ ({ store: store(s({ status: 'open' })), c, settings: german, t, day }))[0].done, false);
  assert.equal(planItems(/** @type {any} */ ({ store: store(s({ day: '2026-10-23' })), c, settings: german, t, day }))[0].done, false);
});
