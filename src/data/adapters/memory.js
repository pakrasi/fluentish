/* In-memory adapter: the reference implementation of the adapter interface (see ../store.js), used by the unit
   tests and as the fallback when IndexedDB is unavailable (the app then says progress is not being kept).
   Values are structured-cloned on the way in and out, like IndexedDB does, so tests catch shared-object bugs. */

const clone = (/** @type {any} */ v) => (v === undefined ? undefined : structuredClone(v));

export function createMemoryAdapter() {
  /** @type {any} */ let device = null;
  /** @type {Map<string, any>} */ const profiles = new Map();
  /** @type {Map<string, any>} */ const kv = new Map();       // `${scope}\u0000${name}`
  /** @type {Map<string, any>} */ const cards = new Map();    // `${p}\u0000${deck}\u0000${id}`
  /** @type {Map<string, any>} */ const attempts = new Map(); // `${p}\u0000${id}`
  /** @type {Map<string, any>} */ const outbox = new Map();   // `${p}\u0000${id}`
  /** @type {Map<string, any>} */ const archive = new Map();  // `${p}\u0000${id}`
  /** @type {Map<string, any>} */ const blobs = new Map();
  const S = '\u0000';
  const dropPrefix = (/** @type {Map<string, any>} */ m, /** @type {string} */ p) => { for (const k of [...m.keys()]) if (k.startsWith(p + S)) m.delete(k); };

  return {
    kind: 'memory',
    async getDevice() { return clone(device); },
    async putDevice(/** @type {any} */ d) { device = clone(d); },
    async listProfiles() { return [...profiles.values()].map(clone); },
    async putProfile(/** @type {any} */ p) { profiles.set(p.id, clone(p)); },
    async deleteProfile(/** @type {string} */ id) {
      profiles.delete(id);
      for (const m of [kv, cards, attempts, outbox, archive]) dropPrefix(m, id);
    },
    async loadScope(/** @type {string} */ scope) {
      /** @type {Record<string, any>} */ const out = {};
      for (const [k, v] of kv) if (k.startsWith(scope + S)) out[k.slice(scope.length + 1)] = clone(v);
      return out;
    },
    async putKV(/** @type {string} */ scope, /** @type {string} */ name, /** @type {any} */ value) {
      if (value === undefined) kv.delete(scope + S + name); else kv.set(scope + S + name, clone(value));
    },
    async loadProfile(/** @type {string} */ p) {
      /** @type {Record<string, Record<string, any>>} */ const c = {};
      for (const [k, v] of cards) {
        const [pp, deck, id] = k.split(S);
        if (pp === p) (c[deck] ||= {})[id] = clone(v);
      }
      const pick = (/** @type {Map<string, any>} */ m) => [...m].filter(([k]) => k.startsWith(p + S)).map(([, v]) => clone(v));
      return { cards: c, attempts: pick(attempts), outbox: pick(outbox) };
    },
    async putCards(/** @type {string} */ p, /** @type {string} */ deck, /** @type {[string, any][]} */ entries) {
      for (const [id, rec] of entries) { const k = [p, deck, id].join(S); if (rec == null) cards.delete(k); else cards.set(k, clone(rec)); }
    },
    async putAttempts(/** @type {string} */ p, /** @type {any[]} */ list) { for (const a of list) attempts.set(p + S + a.id, clone(a)); },
    async putEvents(/** @type {string} */ p, /** @type {any[]} */ list) { for (const e of list) outbox.set(p + S + e.id, clone(e)); },
    async archiveEvents(/** @type {string} */ p, /** @type {any[]} */ list) { for (const e of list) { archive.set(p + S + e.id, clone(e)); outbox.delete(p + S + e.id); } },
    async loadArchive(/** @type {string} */ p) { return [...archive].filter(([k]) => k.startsWith(p + S)).map(([, v]) => clone(v)); },
    async putBlob(/** @type {string} */ id, /** @type {Blob} */ b) { blobs.set(id, b); },
    async getBlob(/** @type {string} */ id) { return blobs.get(id) ?? null; },
    async deleteBlob(/** @type {string} */ id) { blobs.delete(id); },
    async estimate() { return null; },
    close() {},
  };
}
