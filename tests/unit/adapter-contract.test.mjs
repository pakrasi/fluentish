// Runs the adapter conformance suite (adapter-contract.mjs) on the memory adapter and on the IndexedDB adapter over
// fake-indexeddb (a devDependency; nothing ships). Each storage is a fresh IDBFactory, so tests do not share data.
// Then the IndexedDB-only checks: opening a version 1 database (before the archive store) keeps everything in it,
// and a recording stored the old way (a Blob, not bytes) still reads.
import 'fake-indexeddb/auto';
import { IDBFactory, forceCloseDatabase } from 'fake-indexeddb';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryAdapter } from '../../src/data/adapters/memory.js';
import { createIdbAdapter } from '../../src/data/adapters/idb.js';
import { adapterContract, A } from './adapter-contract.mjs';

adapterContract({
  label: 'memory',
  async create() {
    const ad = createMemoryAdapter();   // the memory adapter is its own storage: a "reload" is the same object
    return { open: async () => ad };
  },
});

/** A factory over a fake IndexedDB that remembers each connection it opened, so a test can lose the newest one. */
function spyFactory(/** @type {IDBFactory} */ factory) {
  /** @type {IDBDatabase[]} */ const opened = [];
  const spy = /** @type {IDBFactory} */ (/** @type {unknown} */ ({
    open(/** @type {string} */ name, /** @type {number} */ version) {
      const r = factory.open(name, version);
      r.addEventListener('success', () => opened.push(r.result));
      return r;
    },
  }));
  return { spy, opened };
}

adapterContract({
  label: 'idb',
  async create() {
    const factory = new IDBFactory();
    /** @type {Map<any, IDBDatabase[]>} */ const conns = new Map();
    return {
      async open() {
        const { spy, opened } = spyFactory(factory);   // one per adapter: its connections are its own
        const ad = await createIdbAdapter(spy);
        conns.set(ad, opened);
        return ad;
      },
      drop(ad, how) {
        const list = /** @type {IDBDatabase[]} */ (conns.get(ad));
        const db = list[list.length - 1];
        if (how === 'event') forceCloseDatabase(db);   // iOS closed it: the close event fires
        else db.close();                               // closed under it: the adapter finds out on its next call
      },
    };
  },
});

test('idb: opening a version 1 database (no archive store) upgrades it and keeps every record', async () => {
  const factory = new IDBFactory();
  const r = factory.open('fluentish', 1);
  r.onupgradeneeded = () => {
    const d = r.result;
    for (const s of ['device', 'kv', 'cards', 'attempts', 'outbox', 'blobs']) d.createObjectStore(s);
    d.createObjectStore('profiles', { keyPath: 'id' });
  };
  const v1 = await new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const t = v1.transaction(['device', 'profiles', 'kv', 'cards', 'attempts', 'outbox', 'blobs'], 'readwrite');
  t.objectStore('device').put({ deviceId: 'dev-old', activeProfile: A, seq: 9 }, 'device');
  t.objectStore('profiles').put({ id: A, name: '', kind: 'local' });
  t.objectStore('kv').put({ goal: 'b1' }, [A, 'settings']);
  t.objectStore('kv').put({ theme: 'light' }, ['device', 'prefs']);
  t.objectStore('cards').put({ due: '2026-11-01', reps: 4 }, [A, 'de-b1', 'W:Haus']);
  t.objectStore('attempts').put({ id: 'att-old', score: 20 }, [A, 'att-old']);
  t.objectStore('outbox').put({ id: 'ev-old', seq: 9, synced: false }, [A, 'ev-old']);
  t.objectStore('blobs').put({ type: 'audio/mp4', buf: new Uint8Array([1, 2, 3]).buffer }, 'voice:old');
  await new Promise((res, rej) => { t.oncomplete = res; t.onerror = () => rej(t.error); });
  v1.close();

  const ad = await createIdbAdapter(factory);
  assert.deepEqual(await ad.getDevice(), { deviceId: 'dev-old', activeProfile: A, seq: 9 });
  assert.deepEqual(await ad.listProfiles(), [{ id: A, name: '', kind: 'local' }]);
  assert.deepEqual(await ad.loadScope(A), { settings: { goal: 'b1' } });
  assert.deepEqual(await ad.loadScope('device'), { prefs: { theme: 'light' } });
  assert.deepEqual(await ad.loadProfile(A), {
    cards: { 'de-b1': { 'W:Haus': { due: '2026-11-01', reps: 4 } } },
    attempts: [{ id: 'att-old', score: 20 }],
    outbox: [{ id: 'ev-old', seq: 9, synced: false }],
  });
  assert.deepEqual(await ad.loadArchive(A), [], 'the new archive store exists and is empty');
  const blob = /** @type {Blob} */ (await ad.getBlob('voice:old'));
  assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())], [1, 2, 3]);
  await ad.archiveEvents(A, [{ id: 'ev-old', seq: 9, synced: true }]);
  assert.deepEqual((await ad.loadProfile(A)).outbox, []);
  assert.deepEqual(await ad.loadArchive(A), [{ id: 'ev-old', seq: 9, synced: true }]);
});

test('idb: a recording stored as a Blob (before bytes were stored) still reads', async () => {
  const factory = new IDBFactory();
  const ad = await createIdbAdapter(factory);
  ad.close();
  const r = factory.open('fluentish', 2);
  const d = await new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const t = d.transaction(['blobs'], 'readwrite');
  t.objectStore('blobs').put(new Blob([new Uint8Array([4, 5])], { type: 'audio/webm' }), 'voice:blob');
  await new Promise((res, rej) => { t.oncomplete = res; t.onerror = () => rej(t.error); });
  d.close();
  const ad2 = await createIdbAdapter(factory);
  const blob = /** @type {Blob} */ (await ad2.getBlob('voice:blob'));
  assert.ok(blob instanceof Blob);
  assert.equal(blob.type, 'audio/webm');
  assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())], [4, 5]);
});
