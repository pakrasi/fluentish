// The bounded outbox (src/data/archive.js): acknowledged events older than 30 days move to the archive store, the
// start loads only pending and recent events, nothing is ever deleted, and Export still has every event.
// Synthetic data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../../src/data/store.js';
import { createMemoryAdapter } from '../../src/data/adapters/memory.js';
import { openSession, deleteProfile } from '../../src/data/session.js';
import { archivable, archiveOld, ARCHIVE_AFTER_DAYS } from '../../src/data/archive.js';
import { exportBundle, importFile } from '../../src/data/transfer.js';
import { canon } from '../../src/domain/cardmerge.js';

const NOW = Date.UTC(2026, 11, 1, 12);
const DAY = 86400e3;
const CTX = { exam: null, phase: 'none', tz: 'UTC' };
const rev = (id, at) => ['card.reviewed', { deck: 'b1', itemId: id, g: 3, ms: 1, flags: '', mode: 't', ctx: CTX, base: { u: null, reps: 0 }, post: { u: at, reps: 1 } }];

/** A profile with 90 days of events of every kind; returns the store and what each event should do. */
async function history(adapter = createMemoryAdapter()) {
  const s = await openSession({ adapter, legacyStorage: null, clock: { today: () => '2026-12-01' }, now: () => new Date(NOW - 95 * DAY) });
  const store = s.store;
  /** @type {Record<string, 'archive' | 'stay'>} */ const want = {};
  const add = (type, payload, ageDays, { synced = false, expect }) => {
    const e = store.append(type, payload, { at: new Date(NOW - ageDays * DAY), day: '2026-10-01' });
    if (synced) store.markSynced([e.id]);
    want[e.id] = expect;
    return e;
  };
  for (let d = 90; d >= 0; d -= 3) add(...rev(`BP:${d}`, NOW - d * DAY), d, { synced: d % 2 === 0, expect: d % 2 === 0 && d > ARCHIVE_AFTER_DAYS ? 'archive' : 'stay' });
  add('card.reviewed', { ...rev('SR:s.1', 0)[1], deck: 'script', local: true }, 60, { expect: 'archive' });             // never sent: not pending anywhere
  add('legacy.imported', { summary: { cards: 3 } }, 80, { expect: 'archive' });
  add('exam.voice', { day: 3, module: 'sprechen', part: 'teil2', mime: 'audio/mp4' }, 70, { synced: true, expect: 'stay' });   // the Exam tab lists it
  add('exam.attempt', { attemptId: 'a', file: { day: 3, module: 'lesen' } }, 70, { expect: 'stay' });                  // not sent yet: pending
  add('exam.attempt', { attemptId: 'b', file: { day: 4, module: 'lesen' } }, 70, { synced: true, expect: 'archive' });
  add('settings.changed', { key: 'minutesPerDay', value: 30, rev: 'r' }, 40, { synced: true, expect: 'archive' });
  add('settings.changed', { key: 'minutesPerDay', value: 45, rev: 'r2' }, 29, { synced: true, expect: 'stay' });      // recent
  await store.flush();
  return { adapter, store, profile: s.profile, device: s.device, want };
}

test('acknowledged events older than 30 days move to the archive; pending, recent and voice events stay', async () => {
  const { store, want } = await history();
  const all = [...store.events.values()].map(e => structuredClone(e));
  for (const e of all) assert.equal(archivable(e, NOW), want[e.id] === 'archive', `${e.type} ${e.payload.itemId || ''} ${e.at}`);
  const n = await archiveOld(store, NOW);
  assert.equal(n, Object.values(want).filter(x => x === 'archive').length);
  assert.ok(n >= 10);
  const archived = await store.archived();
  assert.deepEqual(archived.map(e => e.id).sort(), Object.keys(want).filter(id => want[id] === 'archive').sort());
  assert.deepEqual([...store.events.keys()].sort(), Object.keys(want).filter(id => want[id] === 'stay').sort());
  // nothing lost, nothing changed: the outbox and the archive together are exactly what there was
  const byId = new Map([...archived, ...store.events.values()].map(e => [e.id, e]));
  assert.equal(byId.size, all.length);
  for (const e of all) assert.equal(canon(byId.get(e.id)), canon(e));
});

test('the start loads only pending and recent events; the archive is read only when asked', async () => {
  const { adapter, profile, device, want } = await history();
  // the next start (data/session.js) archives, and the start after that loads the bounded outbox
  await openSession({ adapter, legacyStorage: null, clock: { today: () => '2026-12-01' }, now: () => new Date(NOW) });
  let loads = 0;
  const lp = adapter.loadProfile;
  adapter.loadProfile = async p => { loads++; return lp(p); };
  const s = await openSession({ adapter, legacyStorage: null, clock: { today: () => '2026-12-01' }, now: () => new Date(NOW) });
  assert.equal(s.profile.id, profile.id); assert.equal(s.device.deviceId, device.deviceId);
  assert.deepEqual([...s.store.events.keys()].sort(), Object.keys(want).filter(id => want[id] === 'stay').sort());
  assert.ok(loads >= 1);
  assert.equal((await adapter.loadProfile(profile.id)).outbox.length, s.store.events.size, 'the outbox store holds only those');
});

test('Export still has every event, archived or not, and an import of it adds no duplicates', async () => {
  const { store, profile, want } = await history();
  const total = Object.keys(want).length;
  await archiveOld(store, NOW);
  const out = exportBundle(store, { profile, archived: await store.archived(), includeScripts: true });
  assert.equal(out.events.length, total);
  assert.equal(exportBundle(store, { profile, archived: await store.archived() }).events.length, total - 1, 'the local script review stays out unless scripts are included');
  // import the file back: nothing archived comes back into the outbox
  const before = store.events.size;
  await importFile(JSON.stringify(out), { store, bus: null });
  assert.equal(store.events.size, before);
});

test('a failed move leaves everything where it was', async () => {
  const { store, adapter } = await history();
  const size = store.events.size;
  adapter.archiveEvents = async () => { throw new Error('QuotaExceededError'); };
  assert.equal(await archiveOld(store, NOW), 0);
  assert.equal(store.events.size, size);
  assert.equal((await store.archived()).length, 0);
});

test('Delete all removes the archive with the profile', async () => {
  const { store, adapter, profile, device } = await history();
  await archiveOld(store, NOW);
  assert.ok((await adapter.loadArchive(profile.id)).length);
  await deleteProfile(adapter, device, profile);
  assert.equal((await adapter.loadArchive(profile.id)).length, 0);
});
