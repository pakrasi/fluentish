/* The store: the only way features read and write learner data.

   Reads are synchronous, from an in-memory cache filled at open(), so view code stays simple. Writes update the cache
   at once and go to the adapter: immediately for cards, attempts and events (review S6), debounced for the small
   collections that change in bursts (settings, prefs, ui). Other tabs learn about writes over a BroadcastChannel and
   reload what changed. Nothing here knows about IndexedDB; the adapter does (adapters/idb.js, adapters/memory.js).

   Adapter interface (both adapters implement it; a server adapter in phase 4 implements the same):
     getDevice() / putDevice(rec)                       device record { deviceId, activeProfile, seq, ... }
     listProfiles() / putProfile(p) / deleteProfile(id)
     loadScope(scope) / putKV(scope, name, value)       key-value collections; scope = profileId or 'device'
     loadProfile(p) → { cards: {deck: {id: rec}}, attempts: [], outbox: [] }
     putCards(p, deck, [[id, rec | null]]) / putAttempts(p, []) / putEvents(p, [])
     archiveEvents(p, [events]) / loadArchive(p)        move events out of the outbox (data/archive.js); read them
     putBlob(id, blob) / getBlob(id) / deleteBlob(id) / estimate() / close()

   Collections (key-value):
     settings  profile, synced   the goal and practice options (data/settings.js); the exam date lives here only
     prefs     device            theme, motion, locale
     secrets   device            anthropicKey, githubToken; never exported or synced
     backup    device            the progress backup's state (data/sync/backup.js); never exported or uploaded
     meta      profile           migration record, import summary
     activity  profile           { [day]: { minutes, rounds } } for the runway and study days
     ui        profile           dismissed notices
     b1.session, exams.drafts, exams.training, exams.voice, exams.seen, exams.feedbackLocal, vocab.local,
     vocab.events                carried over from the legacy apps for the stage-B features */
import { uuidv7, isoWithOffset } from './ids.js';

export const DEVICE_SCOPE = new Set(['prefs', 'secrets', 'palace', 'backup']);
const DEBOUNCED = new Set(['settings', 'prefs', 'ui', 'activity']);
const DEBOUNCE_MS = 250;

/**
 * @typedef {object} Event
 * @property {string} id @property {1} v @property {string} profileId @property {string} deviceId @property {number} seq
 * @property {string} at @property {string} day @property {string} type @property {Record<string, any>} payload
 * @property {boolean} synced @property {string|null} path
 */

/**
 * Two tabs changed the same collection before either wrote it: keep both. Study minutes per day take the larger
 * count of each tab (they were added on top of the same value); for other collections this tab's pending change
 * wins, as it would have without the merge.
 * @param {string} name @param {any} local @param {any} remote
 */
export function mergeKV(name, local, remote) {
  if (name === 'activity' && local && remote && typeof local === 'object' && typeof remote === 'object') {
    /** @type {Record<string, any>} */ const out = { ...remote };
    for (const [day, x] of Object.entries(local)) {
      const y = out[day] || {};
      out[day] = { ...y, ...x, minutes: Math.max(x?.minutes || 0, y.minutes || 0), rounds: Math.max(x?.rounds || 0, y.rounds || 0) };
    }
    return out;
  }
  return local;
}

export class Store {
  /**
   * @param {object} o
   * @param {any} o.adapter
   * @param {{id: string, name: string, kind: string}} o.profile
   * @param {{deviceId: string, seq?: number, [k: string]: any}} o.device
   * @param {{ today: () => string }} o.clock
   * @param {{ emit: (t: string, d?: any) => void }} [o.bus]
   * @param {BroadcastChannel | null} [o.channel]
   */
  constructor({ adapter, profile, device, clock, bus, channel = null }) {
    this.adapter = adapter;
    this.profile = profile;
    this.device = device;
    this.clock = clock;
    this.bus = bus;
    this.channel = channel;
    /** @type {Record<string, any>} */ this.kv = {};
    /** @type {Record<string, Record<string, any>>} */ this.cardsByDeck = {};
    /** @type {Map<string, any>} */ this.attemptsById = new Map();
    /** @type {Map<string, Event>} */ this.events = new Map();
    /** @type {Map<string, Set<(v: any) => void>>} */ this.subs = new Map();
    /** @type {Map<string, ReturnType<typeof setTimeout>>} */ this.timers = new Map();
    /** @type {Set<Promise<any>>} */ this.inflight = new Set();
    /** @type {((path: string) => void) | null} */ this.onWriteError = null;
    /** another tab deleted this profile @type {(() => void) | null} */ this.onDeleted = null;
    this.deleted = false;
    if (channel) channel.onmessage = e => this.onRemote(e.data);
  }

  /** Open the store for a profile: loads everything that profile has. */
  static async open(/** @type {ConstructorParameters<typeof Store>[0]} */ o) {
    const s = new Store(o);
    await s.load();
    return s;
  }

  async load() {
    const [dev, prof, data] = await Promise.all([
      this.adapter.loadScope('device'), this.adapter.loadScope(this.profile.id), this.adapter.loadProfile(this.profile.id),
    ]);
    this.kv = { ...prof, ...Object.fromEntries(Object.entries(dev).filter(([k]) => DEVICE_SCOPE.has(k))) };
    this.cardsByDeck = data.cards;
    this.attemptsById = new Map(data.attempts.map((/** @type {any} */ a) => [a.id, a]));
    this.events = new Map(data.outbox.map((/** @type {Event} */ e) => [e.id, e]));
  }

  /* ---------- key-value collections ---------- */

  /** @param {string} name @param {any} [fallback] */
  get(name, fallback) { return name in this.kv ? this.kv[name] : fallback; }

  /** Replace a collection. Never mutate what get() returned; use update(). @param {string} name @param {any} value */
  set(name, value) {
    this.kv[name] = value;
    // writes the value as it is when the write runs, not as it was when set() was called: another tab's change merged
    // in meanwhile (onRemote) is kept
    const write = () => this.deleted ? Promise.resolve() : this.track(this.adapter.putKV(DEVICE_SCOPE.has(name) ? 'device' : this.profile.id, name, this.kv[name]), name)
      .then(() => this.post({ kind: 'kv', name }));
    if (DEBOUNCED.has(name)) {
      clearTimeout(this.timers.get(name));
      this.timers.set(name, setTimeout(() => { this.timers.delete(name); write(); }, DEBOUNCE_MS));
    } else write();
    this.notify(name, value);
  }

  /** Read-modify-write on a copy. @param {string} name @param {(v: any) => any} fn @param {any} [fallback] */
  update(name, fn, fallback) {
    const cur = this.get(name, fallback);
    const next = fn(cur === undefined ? cur : structuredClone(cur));
    this.set(name, next);
    return next;
  }

  /* ---------- cards ---------- */

  /** All records of a deck, keyed by item id. Read-only. @param {string} deck */
  cards(deck) { return this.cardsByDeck[deck] || (this.cardsByDeck[deck] = {}); }

  /** Write several cards at once (one transaction). @param {string} deck @param {[string, any][]} entries rec null deletes */
  putCards(deck, entries) {
    const c = this.cards(deck);
    for (const [id, rec] of entries) { if (rec == null) delete c[id]; else c[id] = rec; }
    if (!this.deleted) this.track(this.adapter.putCards(this.profile.id, deck, entries), `cards:${deck}`).then(() => this.post({ kind: 'cards', name: deck }));
    this.notify(`cards:${deck}`, c);
  }

  /* ---------- exam attempts ---------- */

  attempts() { return [...this.attemptsById.values()]; }
  /** @param {any[]} list */
  putAttempts(list) {
    for (const a of list) this.attemptsById.set(a.id, a);
    if (!this.deleted) this.track(this.adapter.putAttempts(this.profile.id, list), 'attempts').then(() => this.post({ kind: 'attempts' }));
    this.notify('attempts', this.attempts());
  }

  /* ---------- outbox ---------- */

  /**
   * Append a progress event (event@1). Written through at once.
   * @param {string} type @param {Record<string, any>} payload @param {{day?: string, at?: Date, path?: string | null}} [o]
   * @returns {Event}
   */
  append(type, payload, { day, at = new Date(), path = null } = {}) {
    this.device.seq = (this.device.seq || 0) + 1;
    /** @type {Event} */
    const e = {
      id: uuidv7(at.getTime()), v: 1, profileId: this.profile.id, deviceId: this.device.deviceId, seq: this.device.seq,
      at: isoWithOffset(at), day: day || this.clock.today(), type, payload, synced: false, path,
    };
    this.events.set(e.id, e);
    if (!this.deleted) this.track(Promise.all([this.adapter.putEvents(this.profile.id, [e]), this.adapter.putDevice(this.device)]), 'outbox')
      .then(() => this.post({ kind: 'outbox' }));
    this.notify('outbox', e);
    return e;
  }

  /** Events not yet acknowledged by a sync target. */
  pending() { return [...this.events.values()].filter(e => !e.synced).sort((a, b) => a.seq - b.seq); }

  /** @param {string[]} ids */
  markSynced(ids) {
    const changed = ids.map(id => this.events.get(id)).filter(Boolean).map(e => ({ .../** @type {Event} */ (e), synced: true }));
    changed.forEach(e => this.events.set(e.id, e));
    if (changed.length && !this.deleted) this.track(this.adapter.putEvents(this.profile.id, changed), 'outbox').then(() => this.post({ kind: 'outbox' }));
    this.notify('outbox', null);
  }

  /**
   * Move events to the archive (data/archive.js chooses which): out of memory and out of the outbox store, kept in
   * the archive store. Awaited, so a failed move leaves them where they were.
   * @param {Event[]} list
   */
  async archive(list) {
    if (!list.length || this.deleted || !this.adapter.archiveEvents) return 0;
    await this.adapter.archiveEvents(this.profile.id, list);
    for (const e of list) this.events.delete(e.id);
    this.post({ kind: 'outbox' });
    return list.length;
  }

  /** Every archived event of this profile (Export reads them). @returns {Promise<Event[]>} */
  async archived() { return this.adapter.loadArchive ? this.adapter.loadArchive(this.profile.id) : []; }

  /* ---------- plumbing ---------- */

  /** @param {string} name @param {(v: any) => void} fn @returns {() => void} */
  subscribe(name, fn) {
    let set = this.subs.get(name);
    if (!set) this.subs.set(name, (set = new Set()));
    set.add(fn);
    return () => { set.delete(fn); };
  }

  /** @param {string} name @param {any} value */
  notify(name, value) {
    for (const fn of [...(this.subs.get(name) || [])]) { try { fn(value); } catch (e) { console.error(e); } }
    this.bus?.emit('store:changed', { name });
  }

  /** @template T @param {Promise<T>} p @param {string} what */
  track(p, what) {
    const q = p.catch(e => { console.error(`store write failed (${what})`, e); this.onWriteError?.(what); });
    this.inflight.add(q);
    q.finally(() => this.inflight.delete(q));
    return q;
  }

  /** Write everything that is waiting (call on pagehide / visibilitychange). */
  async flush() {
    if (this.deleted) return;
    for (const [name, t] of this.timers) {
      clearTimeout(t);
      this.timers.delete(name);
      this.track(this.adapter.putKV(DEVICE_SCOPE.has(name) ? 'device' : this.profile.id, name, this.kv[name]), name);
    }
    await Promise.all([...this.inflight]);
  }

  /** @param {{kind: string, name?: string}} msg */
  post(msg) { try { this.channel?.postMessage({ ...msg, profileId: this.profile.id }); } catch { /* channel closed */ } }

  /** Another tab wrote: reload that part from the adapter. @param {{kind: string, name?: string, profileId: string}} m */
  async onRemote(m) {
    if (m && m.kind === 'deleted' && m.profileId === this.profile.id) {
      // never write into a deleted profile: drop what was waiting, and refuse later writes
      this.deleted = true;
      for (const tm of this.timers.values()) clearTimeout(tm);
      this.timers.clear();
      this.onDeleted?.();
      return;
    }
    if (!m || (m.profileId !== this.profile.id && !(m.kind === 'kv' && m.name && DEVICE_SCOPE.has(m.name)))) return;
    if (m.kind === 'kv' && m.name) {
      const scope = DEVICE_SCOPE.has(m.name) ? 'device' : this.profile.id;
      const all = await this.adapter.loadScope(scope);
      // a change of ours is still waiting to be written: merge, so neither tab's change is lost
      this.kv[m.name] = this.timers.has(m.name) ? mergeKV(m.name, this.kv[m.name], all[m.name]) : all[m.name];
      this.notify(m.name, this.kv[m.name]);
      return;
    }
    const data = await this.adapter.loadProfile(this.profile.id);
    if (m.kind === 'cards' && m.name) { this.cardsByDeck[m.name] = data.cards[m.name] || {}; this.notify(`cards:${m.name}`, this.cardsByDeck[m.name]); }
    if (m.kind === 'attempts') { this.attemptsById = new Map(data.attempts.map((/** @type {any} */ a) => [a.id, a])); this.notify('attempts', this.attempts()); }
    if (m.kind === 'outbox') {
      this.events = new Map(data.outbox.map((/** @type {Event} */ e) => [e.id, e]));
      const d = await this.adapter.getDevice();   // keep seq monotonic across tabs
      if (d && (d.seq || 0) > (this.device.seq || 0)) this.device.seq = d.seq;
      this.notify('outbox', null);
    }
  }

  close() { this.channel?.close(); }
}
