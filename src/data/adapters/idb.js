/* IndexedDB adapter. Database "fluentish", one record per card, attempt and event (review S6), so an answer writes
   one small record instead of rewriting a 300 KB blob, and a write that iOS kills mid-way loses at most that record.

   Stores (keys are arrays, so one profile's records are one key range):
     device    'device'               → { deviceId, activeProfile, seq, migratedAt? }
     profiles  id                     → Profile
     kv        [scope, name]          → any   (scope = profileId, or 'device' for prefs and secrets)
     cards     [profileId, deck, id]  → FSRS record
     attempts  [profileId, id]        → ExamAttempt
     outbox    [profileId, id]        → Event
     blobs     id                     → Blob  (voice notes until both uploads succeed)

   The connection is reopened when iOS closes it in the background (InvalidStateError / "connection is closing"). */

const NAME = 'fluentish';
const VERSION = 1;
const STORES = ['device', 'profiles', 'kv', 'cards', 'attempts', 'outbox', 'blobs'];

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

  /** All [key, value] pairs whose array key starts with prefix. @param {IDBObjectStore} s @param {any[]} prefix */
  function range(s, prefix) {
    return new Promise((res, rej) => {
      /** @type {[any, any][]} */ const out = [];
      const r = s.openCursor(IDBKeyRange.bound(prefix, [...prefix, []]));
      r.onsuccess = () => { const c = r.result; if (!c) return res(out); out.push([c.key, c.value]); c.continue(); };
      r.onerror = () => rej(r.error);
    });
  }

  db = await open();

  return {
    kind: 'idb',
    getDevice: () => tx(['device'], 'readonly', t => req(t.objectStore('device').get('device'))).then(v => v ?? null),
    putDevice: (/** @type {any} */ d) => tx(['device'], 'readwrite', t => { t.objectStore('device').put(d, 'device'); }),
    listProfiles: () => tx(['profiles'], 'readonly', t => req(t.objectStore('profiles').getAll())),
    putProfile: (/** @type {any} */ p) => tx(['profiles'], 'readwrite', t => { t.objectStore('profiles').put(p); }),
    deleteProfile: (/** @type {string} */ id) => tx(['profiles', 'kv', 'cards', 'attempts', 'outbox'], 'readwrite', t => {
      t.objectStore('profiles').delete(id);
      for (const s of ['kv', 'cards', 'attempts', 'outbox']) t.objectStore(s).delete(IDBKeyRange.bound([id], [id, []]));
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
    putBlob: (/** @type {string} */ id, /** @type {Blob} */ b) => tx(['blobs'], 'readwrite', t => { t.objectStore('blobs').put(b, id); }),
    getBlob: (/** @type {string} */ id) => tx(['blobs'], 'readonly', t => req(t.objectStore('blobs').get(id))).then(v => v ?? null),
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
