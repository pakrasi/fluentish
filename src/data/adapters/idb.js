/* IndexedDB adapter. Database "fluentish", one record per card, attempt and event (review S6), so an answer writes
   one small record instead of rewriting a 300 KB blob, and a write that iOS kills mid-way loses at most that record.

   Stores (keys are arrays, so one profile's records are one key range):
     device    'device'               → { deviceId, activeProfile, seq, migratedAt? }
     profiles  id                     → Profile
     kv        [scope, name]          → any   (scope = profileId, or 'device' for prefs and secrets)
     cards     [profileId, deck, id]  → FSRS record
     attempts  [profileId, id]        → ExamAttempt
     outbox    [profileId, id]        → Event  (pending and recent events: what the store loads)
     archive   [profileId, id]        → Event  (acknowledged events older than 30 days, moved out of the outbox by
                                                data/archive.js; never loaded at start, read by Export; version 2)
     blobs     id                     → Blob  (voice notes until both uploads succeed)

   Version 2 only adds the archive store (onupgradeneeded creates the stores that are missing; nothing else changes).

   The connection is reopened when iOS closes it in the background (InvalidStateError / "connection is closing"). */

const NAME = 'fluentish';
const VERSION = 2;
const STORES = ['device', 'profiles', 'kv', 'cards', 'attempts', 'outbox', 'blobs', 'archive'];

/** @template T @param {IDBRequest<T>} r @returns {Promise<T>} */
const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
/** @param {IDBTransaction} t @returns {Promise<void>} */
const done = t => new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error('transaction aborted')); });

/** @param {IDBFactory} [factory] */
export async function createIdbAdapter(factory = indexedDB) {
  /** @type {IDBDatabase | null} */
  let db = null;

  async function open() {
    const r = factory.open(NAME, VERSION);
    r.onupgradeneeded = () => {
      const d = r.result;
      for (const s of STORES) if (!d.objectStoreNames.contains(s)) s === 'profiles' ? d.createObjectStore(s, { keyPath: 'id' }) : d.createObjectStore(s);
    };
    const d = await req(r);
    d.onversionchange = () => { d.close(); db = null; };
    d.onclose = () => { db = null; };
    return d;
  }

  /**
   * Run fn inside a transaction; reopen once if the connection was lost.
   * @template T @param {string[]} names @param {IDBTransactionMode} mode @param {(t: IDBTransaction) => Promise<T> | T} fn @returns {Promise<T>}
   */
  async function tx(names, mode, fn) {
    for (let attempt = 0; ; attempt++) {
      try {
        if (!db) db = await open();
        const t = db.transaction(names, mode);
        const finished = done(t);
        const out = await fn(t);
        await finished;
        return out;
      } catch (e) {
        const lost = e && (/** @type {any} */ (e).name === 'InvalidStateError' || /closing|closed/i.test(String(/** @type {any} */ (e).message)));
        if (lost && attempt === 0) { try { db?.close(); } catch {} db = null; continue; }
        throw e;
      }
    }
  }

  /**
   * All [key, value] pairs whose array key starts with prefix, in key order. One getAllKeys and one getAll on the same
   * range in the same transaction (two requests instead of a cursor's callback per record; perf finding 4): both list
   * the range in key order, so the i-th key belongs to the i-th value.
   * @param {IDBObjectStore} s @param {any[]} prefix @returns {Promise<[any, any][]>}
   */
  async function range(s, prefix) {
    const r = IDBKeyRange.bound(prefix, [...prefix, []]);
    const [keys, values] = await Promise.all([req(s.getAllKeys(r)), req(s.getAll(r))]);
    if (keys.length !== values.length) throw new Error(`idb range: ${keys.length} keys, ${values.length} values`);
    return keys.map((k, i) => /** @type {[any, any]} */ ([k, values[i]]));
  }

  db = await open();

  return {
    kind: 'idb',
    getDevice: () => tx(['device'], 'readonly', t => req(t.objectStore('device').get('device'))).then(v => v ?? null),
    putDevice: (/** @type {any} */ d) => tx(['device'], 'readwrite', t => { t.objectStore('device').put(d, 'device'); }),
    listProfiles: () => tx(['profiles'], 'readonly', t => req(t.objectStore('profiles').getAll())),
    putProfile: (/** @type {any} */ p) => tx(['profiles'], 'readwrite', t => { t.objectStore('profiles').put(p); }),
    deleteProfile: (/** @type {string} */ id) => tx(['profiles', 'kv', 'cards', 'attempts', 'outbox', 'archive'], 'readwrite', t => {
      t.objectStore('profiles').delete(id);
      for (const s of ['kv', 'cards', 'attempts', 'outbox', 'archive']) t.objectStore(s).delete(IDBKeyRange.bound([id], [id, []]));
    }),
    loadScope: (/** @type {string} */ scope) => tx(['kv'], 'readonly', async t => {
      /** @type {Record<string, any>} */ const out = {};
      for (const [k, v] of /** @type {[any[], any][]} */ (await range(t.objectStore('kv'), [scope]))) out[k[1]] = v;
      return out;
    }),
    putKV: (/** @type {string} */ scope, /** @type {string} */ name, /** @type {any} */ value) => tx(['kv'], 'readwrite', t => {
      const s = t.objectStore('kv');
      if (value === undefined) s.delete([scope, name]); else s.put(value, [scope, name]);
    }),
    loadProfile: (/** @type {string} */ p) => tx(['cards', 'attempts', 'outbox'], 'readonly', async t => {
      /** @type {Record<string, Record<string, any>>} */ const cards = {};
      for (const [k, v] of /** @type {[any[], any][]} */ (await range(t.objectStore('cards'), [p]))) (cards[k[1]] ||= {})[k[2]] = v;
      const attempts = (/** @type {[any, any][]} */ (await range(t.objectStore('attempts'), [p]))).map(([, v]) => v);
      const outbox = (/** @type {[any, any][]} */ (await range(t.objectStore('outbox'), [p]))).map(([, v]) => v);
      return { cards, attempts, outbox };
    }),
    putCards: (/** @type {string} */ p, /** @type {string} */ deck, /** @type {[string, any][]} */ entries) => tx(['cards'], 'readwrite', t => {
      const s = t.objectStore('cards');
      for (const [id, rec] of entries) rec == null ? s.delete([p, deck, id]) : s.put(rec, [p, deck, id]);
    }),
    putAttempts: (/** @type {string} */ p, /** @type {any[]} */ list) => tx(['attempts'], 'readwrite', t => { for (const a of list) t.objectStore('attempts').put(a, [p, a.id]); }),
    putEvents: (/** @type {string} */ p, /** @type {any[]} */ list) => tx(['outbox'], 'readwrite', t => { for (const e of list) t.objectStore('outbox').put(e, [p, e.id]); }),
    /** Move events from the outbox to the archive, in one transaction (both or neither). */
    archiveEvents: (/** @type {string} */ p, /** @type {any[]} */ list) => tx(['outbox', 'archive'], 'readwrite', t => {
      for (const e of list) { t.objectStore('archive').put(e, [p, e.id]); t.objectStore('outbox').delete([p, e.id]); }
    }),
    loadArchive: (/** @type {string} */ p) => tx(['archive'], 'readonly', async t => (/** @type {[any, any][]} */ (await range(t.objectStore('archive'), [p]))).map(([, v]) => v)),
    // Bytes, not the Blob itself: WebKit refuses Blobs in IndexedDB in private windows (and older iOS everywhere),
    // while an ArrayBuffer is stored by every engine. The bytes are read before the transaction opens.
    putBlob: async (/** @type {string} */ id, /** @type {Blob} */ b) => {
      const rec = { type: b.type || 'application/octet-stream', buf: await b.arrayBuffer() };
      return tx(['blobs'], 'readwrite', t => { t.objectStore('blobs').put(rec, id); });
    },
    getBlob: (/** @type {string} */ id) => tx(['blobs'], 'readonly', t => req(t.objectStore('blobs').get(id)))
      .then((/** @type {any} */ v) => (v == null ? null : v instanceof Blob ? v : new Blob([v.buf], { type: v.type }))),
    deleteBlob: (/** @type {string} */ id) => tx(['blobs'], 'readwrite', t => { t.objectStore('blobs').delete(id); }),
    async estimate() {
      try {
        const [persisted, est] = await Promise.all([navigator.storage?.persisted?.(), navigator.storage?.estimate?.()]);
        return { persisted: !!persisted, usage: est?.usage ?? null, quota: est?.quota ?? null };
      } catch { return null; }
    },
    close() { try { db?.close(); } catch {} db = null; },
  };
}
