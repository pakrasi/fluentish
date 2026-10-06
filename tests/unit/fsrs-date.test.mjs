// The scheduler and readiness with a user-set exam date: no date ('none'), a date moved earlier or later.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import FS from '../../src/domain/fsrs.js';
import RD from '../../src/domain/b1ready.js';
import { context, add, diff } from '../../src/core/clock.js';

const strong = { S: 40, D: 4, reps: 5, lapses: 0, last: '2026-10-03', due: '2026-10-04', stage: 2, streak: 0, learn: null, hist: [] };

test("no exam date: no cap, 'after' retention, stage may reach 3", () => {
  const ctx = context({ today: '2026-10-04', exam: null });
  const { rec } = FS.schedule(strong, { g: 3, ms: 3000, onTime: true }, ctx);
  assert.equal(rec.due, add('2026-10-04', FS.interval(rec.S, 0.90)), 'interval at 0.90, uncapped');
  let st = { ...strong, stage: 2, streak: 2, last: '2026-10-01' };
  st = FS.schedule(st, { g: 3, ms: 2000, onTime: true }, context({ today: '2026-10-02', exam: null })).rec;
  assert.equal(st.stage, 3);
});

test('a long interval is capped at exam−1 with a date, and not without one', () => {
  const withDate = FS.schedule(strong, { g: 3, ms: 3000, onTime: true }, { ...context({ today: '2026-10-04', exam: '2026-10-09' }), forecast: () => 0 }).rec;
  const without = FS.schedule(strong, { g: 3, ms: 3000, onTime: true }, context({ today: '2026-10-04', exam: null })).rec;
  assert.ok(withDate.due <= '2026-10-08' || FS.R(diff('2026-10-04', '2026-10-09'), withDate.S) >= FS.EXAM_RECALL);
  assert.ok(without.due > '2026-10-08');
});

test('recap (hotfix): owed reviews go as late as each day holds, from exam − 1 back; never earlier than needed', () => {
  // exam 10 Oct, today 3 Oct: window days 4 … 9 Oct. Cards a–c are due after the exam and would be recalled on the
  // day with less than 0.90; d will be (S 400); e and f are already due inside the window; g is not answered yet.
  const R0 = (/** @type {number} */ S, /** @type {string} */ last, /** @type {string} */ due) => ({ S, D: 5, reps: 3, last, due, learn: null, relearn: false });
  const store = {
    a: R0(3, '2026-10-01', '2026-10-20'), b: R0(4, '2026-10-01', '2026-10-25'), c: R0(5, '2026-10-02', '2026-10-30'),
    d: R0(400, '2026-10-01', '2026-12-30'), e: R0(6, '2026-10-02', '2026-10-09'), f: R0(6, '2026-10-02', '2026-10-08'), g: { reps: 0, due: '2026-11-30' },
  };
  const ctx = context({ today: '2026-10-03', exam: '2026-10-10' });
  for (const id of ['a', 'b', 'c']) assert.ok(FS.R(diff(store[id].last, '2026-10-10'), store[id].S) < FS.EXAM_RECALL, id);
  // no limit: every owed review on exam − 1
  assert.deepEqual(FS.recap(store, ctx), { a: '2026-10-09', b: '2026-10-09', c: '2026-10-09' });
  // 2 reviews a day (1 on the eve): the eve keeps e, the owed ones go back day by day, the most stable furthest (an early review costs it least)
  const cap = (/** @type {string} */ d) => (d === '2026-10-09' ? 1 : 2);
  const m = FS.recap(store, ctx, cap);
  assert.deepEqual(m, { a: '2026-10-08', b: '2026-10-07', c: '2026-10-07' });
  const load = /** @type {Record<string, number>} */ ({});
  for (const [id, r] of Object.entries(store)) { const d = m[id] || r.due; if (r.reps && d <= '2026-10-09') load[d] = (load[d] || 0) + 1; }
  for (const [d, n] of Object.entries(load)) assert.ok(n <= cap(d), `${d}: ${n}`);
  // a card pulled by the old rule (exam − 3 … − 1) that is recalled on the day anyway goes back to its own date
  const old = { p: R0(30, '2026-10-02', '2026-10-08') };
  const back = FS.recap(old, ctx);
  assert.ok(back.p > '2026-10-09' && back.p === add('2026-10-02', FS.interval(30, 0.90)), 'its own interval, later');
  // the same card due the day after its last review (a learning step's +1) is never touched
  assert.deepEqual(FS.recap({ p: R0(30, '2026-10-07', '2026-10-08') }, ctx), {});
  // idempotent
  const after = Object.fromEntries(Object.entries(store).map(([id, r]) => [id, m[id] ? { ...r, due: m[id] } : r]));
  assert.deepEqual(FS.recap(after, ctx, cap), {});
});

test('recap: nothing moves without a date, after the exam, on the day, or when the cap is not ahead', () => {
  const store = { a: { reps: 3, due: '2026-12-01' } };
  assert.deepEqual(FS.recap(store, context({ today: '2026-10-03', exam: null })), {});
  assert.deepEqual(FS.recap(store, context({ today: '2026-10-12', exam: '2026-10-09' })), {});
  assert.deepEqual(FS.recap(store, context({ today: '2026-10-09', exam: '2026-10-09' })), {});
  assert.deepEqual(FS.recap(store, context({ today: '2026-10-08', exam: '2026-10-09' })), {}, 'eve: the cap is today');
});

test('readiness: no date measures recall today; with a date, on the exam day; the set never changes', () => {
  const pool = [{ id: 'a', area: 'speaking', group: 'S1' }, { id: 'b', area: 'speaking', group: 'S1' }];
  const store = { a: { S: 10, D: 5, reps: 3, last: '2026-10-01', due: '2026-10-08', learn: null } };
  const none = RD.compute({ pool, store, today: '2026-10-03', exam: null, phase: 'none' });
  assert.ok(Math.abs(none.areas.speaking.recall - FS.R(2, 10) / 2) < 1e-9, 'R today over both items');
  const far = RD.compute({ pool, store, today: '2026-10-03', exam: '2026-12-01', phase: 'week' });
  assert.ok(Math.abs(far.areas.speaking.recall - FS.R(61, 10) / 2) < 1e-9, 'a far exam: R on that day');
  const near = RD.compute({ pool, store, today: '2026-10-03', exam: '2026-10-09', phase: 'week' });
  assert.ok(Math.abs(near.areas.speaking.recall - FS.R(8, 10) / 2) < 1e-9, 'R on the exam morning');
  assert.equal(far.overall.n, near.overall.n);
  assert.equal(near.day, '2026-10-09'); assert.equal(none.day, '2026-10-03');
});

test('the exam cap is applied when due dates are read: moving the date 9 → 5 → 9 changes no card and no count', async () => {
  const { Store } = await import('../../src/data/store.js');
  const { createMemoryAdapter } = await import('../../src/data/adapters/memory.js');
  const { setExamDate } = await import('../../src/data/settings.js');
  const { createClock } = await import('../../src/core/clock.js');
  let exam = '2026-10-09';
  const clock = createClock({ exam: () => exam, forcedToday: '2026-10-03' });
  const store = await Store.open({ adapter: createMemoryAdapter(), profile: { id: 'p', name: '', kind: 'local' }, device: { deviceId: 'd' }, clock });
  store.set('settings', { exam: { type: 'goethe-b1', date: exam, modules: [] } });
  const cards = {
    a: { S: 3, D: 5, reps: 3, last: '2026-10-02', due: '2026-10-06', learn: null },
    b: { S: 1.5, D: 5, reps: 3, last: '2026-10-02', due: '2026-10-20', learn: null },
    c: { S: 2, D: 5, reps: 3, last: '2026-10-01', due: '2026-10-11', learn: null },
    d: { S: 400, D: 2, reps: 9, last: '2026-10-02', due: '2026-12-01', learn: null },
  };
  store.putCards('b1', Object.entries(cards));
  const before = structuredClone(store.cards('b1'));
  const counts = () => { const c = clock.ctx(); return RD.forecast(store.cards('b1'), c.today, 8, c).map(x => x.n); };
  const app = { store, hlc: { tick: () => String(Date.now()) }, clock };
  const at9 = counts();
  for (const d of ['2026-10-05', '2026-10-09']) {
    assert.equal(setExamDate(app, d).ok, true);
    exam = d;
    if (d === '2026-10-05') {
      const c = clock.ctx();
      for (const id of ['b', 'c']) assert.ok(RD.dueOn(store.cards('b1')[id], c) <= '2026-10-04', `${id} is capped at the new exam−1 while read`);
      assert.equal(RD.dueOn(store.cards('b1').d, c), '2026-12-01', 'a card recalled on the exam day anyway keeps its date');
    }
  }
  assert.deepEqual(store.cards('b1'), before, 'no card was written');
  assert.deepEqual(counts(), at9, 'due counts are exactly what they were');
});
