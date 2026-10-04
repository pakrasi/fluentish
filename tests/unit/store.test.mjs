// The store over the memory adapter (the adapter contract the IndexedDB adapter also implements), the ids, and the
// settings writers including the exam date.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from '../../src/data/store.js';
import { createMemoryAdapter } from '../../src/data/adapters/memory.js';
import { uuidv7, uuidTime, isoWithOffset, createHlc, fnv1a } from '../../src/data/ids.js';
import { setSetting, setExamDate, mergeSettings, normalizeSettings, examDateError } from '../../src/data/settings.js';
import { createBus } from '../../src/core/bus.js';
import { validate } from '../../src/core/schema.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const J = p => JSON.parse(readFileSync(path.join(ROOT, p), 'utf8'));
const PID = '0192a3b4-c5d6-7e8f-9a0b-000000000001';

async function fresh(today = '2026-10-03') {
  const adapter = createMemoryAdapter();
  const bus = createBus();
  const clock = { today: () => today };
  const store = await Store.open({ adapter, profile: { id: PID, name: '', kind: 'local' }, device: { deviceId: 'dev1', seq: 0 }, clock, bus });
  return { adapter, bus, clock, store, hlc: createHlc('dev1') };
}

test('ids: uuidv7 is time-ordered and valid, timestamps keep the offset, the HLC orders as strings', () => {
  const a = uuidv7(1790000000000), b = uuidv7(1790000000001);
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.ok(a < b);
  assert.equal(uuidTime(a), 1790000000000);
  assert.match(isoWithOffset(new Date(2026, 9, 3, 9, 5, 7, 12)), /^2026-10-03T09:05:07\.012[+-]\d{2}:\d{2}$/);
  let t = 1000;
  const h = createHlc('dev', () => t);
  const x = h.tick(), y = h.tick(); t = 999; const z = h.tick();
  assert.ok(x < y && y < z, 'monotonic even when the wall clock goes back');
  assert.ok(h.receive('9999999999999-0003-other') > z);
  assert.equal(fnv1a('abc'), fnv1a('abc')); assert.notEqual(fnv1a('abc'), fnv1a('abd'));
});

test('key-value: sync reads, debounced writes, flush, subscribe, update works on a copy', async () => {
  const { adapter, store, bus } = await fresh();
  const seen = [];
  store.subscribe('ui', v => seen.push(v));
  let changed = 0; bus.on('store:changed', () => changed++);
  store.set('ui', { a: 1 });
  assert.deepEqual(store.get('ui'), { a: 1 }, 'read back at once');
  assert.deepEqual(await adapter.loadScope(PID), {}, 'ui is debounced');
  await store.flush();
  assert.deepEqual((await adapter.loadScope(PID)).ui, { a: 1 });
  const before = store.get('ui');
  store.update('ui', v => { v.a = 2; return v; });
  assert.equal(before.a, 1, 'update did not mutate the previous value');
  assert.deepEqual(seen, [{ a: 1 }, { a: 2 }]);
  assert.equal(changed, 2);
  store.set('prefs', { theme: 'dark' });
  await store.flush();
  assert.deepEqual((await adapter.loadScope('device')).prefs, { theme: 'dark' }, 'prefs live on the device, not the profile');
  assert.equal((await adapter.loadScope(PID)).prefs, undefined);
});

test('cards and attempts write through at once', async () => {
  const { adapter, store } = await fresh();
  store.putCards('b1', [['a', { S: 1, D: 5, due: '2026-10-04', reps: 1 }], ['b', { S: 2, D: 5, due: '2026-10-05', reps: 1 }]]);
  await Promise.all([...store.inflight]);
  assert.deepEqual(Object.keys((await adapter.loadProfile(PID)).cards.b1).sort(), ['a', 'b']);
  store.putCards('b1', [['a', null]]);
  await Promise.all([...store.inflight]);
  assert.deepEqual(Object.keys((await adapter.loadProfile(PID)).cards.b1), ['b']);
  store.putAttempts([{ id: 'x', module: 'lesen' }]);
  await Promise.all([...store.inflight]);
  assert.equal((await adapter.loadProfile(PID)).attempts.length, 1);
});

test('events: valid event@1, seq per device, pending until synced', async () => {
  const { store, adapter } = await fresh();
  const e1 = store.append('settings.changed', { key: 'minutesPerDay', value: 30 });
  const e2 = store.append('settings.changed', { key: 'minutesPerDay', value: 45 });
  assert.equal(e1.seq, 1); assert.equal(e2.seq, 2);
  assert.equal(e1.day, '2026-10-03');
  const schema = J('schemas/records/event.schema.json');
  assert.deepEqual(validate(schema, e1), []);
  assert.deepEqual(store.pending().map(e => e.id), [e1.id, e2.id]);
  store.markSynced([e1.id]);
  assert.deepEqual(store.pending().map(e => e.id), [e2.id]);
  await store.flush();
  assert.equal((await adapter.getDevice()).seq, 2);
});

test('another tab writes: the store reloads that part', async () => {
  const { adapter, store } = await fresh();
  await adapter.putKV(PID, 'ui', { from: 'other tab' });
  await adapter.putCards(PID, 'b1', [['z', { S: 1, D: 5, due: '2026-10-04', reps: 1 }]]);
  await store.onRemote({ kind: 'kv', name: 'ui', profileId: PID });
  await store.onRemote({ kind: 'cards', name: 'b1', profileId: PID });
  assert.deepEqual(store.get('ui'), { from: 'other tab' });
  assert.ok(store.cards('b1').z);
  await store.onRemote({ kind: 'kv', name: 'ui', profileId: 'someone-else' });
  assert.deepEqual(store.get('ui'), { from: 'other tab' }, 'other profiles are ignored');
});

test('settings: field writes with rev, an event and a bus message; merge by rev', async () => {
  const { store, hlc, bus } = await fresh();
  const msgs = []; bus.on('settings:changed', d => msgs.push(d));
  setSetting({ store, hlc, bus }, 'minutesPerDay', 30);
  setSetting({ store, hlc, bus }, 'minutesPerDay', 30);   // no-op
  const s = store.get('settings');
  assert.equal(s.minutesPerDay, 30);
  assert.ok(s.rev.minutesPerDay);
  assert.deepEqual(msgs, [{ key: 'minutesPerDay', value: 30, prev: 60 }]);
  assert.equal(store.pending().filter(e => e.type === 'settings.changed').length, 1);
  assert.deepEqual(validate(J('schemas/records/settings.schema.json'), s), []);
  const older = { ...normalizeSettings(null), minutesPerDay: 90, rev: { minutesPerDay: '0000000000001-0000-x' } };
  assert.equal(mergeSettings(s, older).minutesPerDay, 30, 'older remote loses');
  const newer = { ...normalizeSettings(null), minutesPerDay: 90, rev: { minutesPerDay: '9999999999999-0000-x' } };
  assert.equal(mergeSettings(s, newer).minutesPerDay, 90, 'newer remote wins');
});

test('exam date: validated, the single writer, and it never rewrites a card', async () => {
  const { store, hlc, bus, clock } = await fresh('2026-10-03');
  const app = { store, hlc, bus, clock };
  assert.equal(examDateError('2026-10-02', '2026-10-03'), 'goal.date.past');
  assert.equal(examDateError('2026-02-30', '2026-10-03'), 'goal.date.invalid');
  assert.equal(examDateError(null, '2026-10-03'), null);
  assert.deepEqual(setExamDate(app, '2026-10-01'), { ok: false, error: 'goal.date.past' });
  store.putCards('b1', [
    ['a', { S: 30, D: 5, due: '2026-10-25', reps: 3 }], ['b', { S: 30, D: 5, due: '2026-10-12', reps: 3 }], ['c', { S: 3, D: 5, due: '2026-10-05', reps: 2 }],
  ]);
  const before = structuredClone(store.cards('b1'));
  let r = setExamDate(app, '2026-10-30');
  assert.deepEqual(r, { ok: true, prev: null });
  assert.equal(store.get('settings').exam.date, '2026-10-30');
  r = setExamDate(app, '2026-10-09');
  assert.equal(r.ok, true);
  r = setExamDate(app, '2026-10-20');
  assert.deepEqual(store.cards('b1'), before, 'earlier or later, the cards keep their stored dates (the cap is applied on read)');
  r = setExamDate(app, null);
  assert.equal(r.ok, true);
  assert.equal(store.get('settings').exam.date, null, 'the date can be cleared');
});
