/* Progress backup (roadmap item 1): the learning events and a daily copy of the cards go to the private results
   repository through the device link, so a cleared Safari, a new phone or a second device can get them back
   (data/restore.js reads them). Format, all under data/ in the results repository, which sync.py never reads:

     data/events/<deviceId>/<day>.ndjson        one event@1 per line, without `synced` and `path`; the learning events
                                                (BACKUP_TYPES) this device holds for that study day, by seq. This
                                                device is the only writer of its folder, so a file is rewritten with
                                                its sha and lines are only ever added (a read-merge-write: the lines
                                                already there are kept, new ones are added by id).
     data/snapshots/<deviceId>/<day>.json.gz    fluentish-snapshot@1, gzip (plain .json where the browser has no
                                                CompressionStream): every card outside the private decks and the
                                                learning collections (SNAPSHOT_KV) and the progress log's
                                                months (SNAPSHOT_PREFIX: kv progress.<course>.<YYYY-MM>,
                                                domain/progress.js; added in round 4, which a reader from before
                                                ignores), so a restore does not depend on
                                                replaying every event. Rewritten in place during the day (at most every
                                                SNAPSHOT_EVERY_MS, when it changed); a new file each study day.
     data/logs/<deviceId>/<day>.ndjson          the scrubbed error log (core/log.js), once a study day: {at, where,
                                                message, build} per line, a message with script text replaced

   Never uploaded: scripts (kv scripts*, deck 'script', reviews marked local), secrets, device prefs, caches of the
   results repository. Every body is checked before it leaves (leakIn): a token or key, or a script's marks, stop
   the upload. Consent and backoff are the results sync's: a linked device, uploads allowed (the import notice has
   been seen), not a preview profile, at most one flush a minute, stopped by a connection or token error. The
   learner can turn the backup off in Profile › Data (kv 'backup'.on === false). */
import { fnv1a, isoWithOffset } from '../ids.js';
import { MONTH_KEY } from '../../domain/progress-key.js';

/** Event types that carry learning state (review B4: card events carry base and post). */
export const BACKUP_TYPES = new Set(['card.reviewed', 'card.marked_known', 'card.unmarked_known', 'card.checked', 'settings.changed']);
/** Decks that never leave the device (Script mode, practice/script/store.js). */
export const PRIVATE_DECKS = new Set(['script']);
/**
 * Profile collections a snapshot carries, with the rule data/restore.js merges each by:
 *   settings   per field by HLC (data/settings.js mergeSettings)
 *   activity   per day, each device's minutes added up (domain/activity.js joinActivity)
 *   mistakes   by id; a deleted mistake stays deleted
 *   seen       by item: first the earliest, last the latest, n the larger
 *   fill       taken only when this device has none (logs that belong to one device: the day's new-item counts …)
 *   checks     typed production checks and Quick sort's Learn picks: per item and field, the later (domain/checks.js joinChecks)
 *   family     Today's family by day: the union of found, the most tries (domain/wordbuild-family.js joinFamily)
 * @type {Record<string, 'settings' | 'activity' | 'mistakes' | 'seen' | 'fill' | 'checks' | 'family'>}
 */
export const SNAPSHOT_KV = {
  settings: 'settings', activity: 'activity', mistakes: 'mistakes', 'lookup.seen': 'seen', known: 'fill',
  'b1.session': 'fill', 'speak.sim': 'fill', clusters: 'fill', 'practice.write': 'fill', 'exams.feedbackLocal': 'fill',
  'exams.seen': 'fill', 'exams.learnerNotes': 'fill', 'vocab.local': 'fill', 'vocab.events': 'fill',
  // the French course's round session (C3b; a course's cards are in its deck fr:core, which every snapshot carries)
  'fr.session': 'fill',
  // what he saved while reading (round 4; no sentence and no title: those stay in read.ctx and reads, device-only)
  'read.words': 'fill',
  // conversation practice (round 4): each session's numbers and ids, no free text (the title and the transcript stay
  // in conv.transcripts, device-only), and the words he used (conversation evidence, merged like lookup.seen)
  'conv.sessions': 'fill', 'conv.used': 'seen',
  // typed production checks and the words he sorted to Learn (round 5, domain/checks.js): item ids, days and results only
  'known.checks': 'checks',
  // Today's family (round 7): each day's root, board (card ids), tries, finds and extra words; no free text
  'build.family': 'family',
};
/**
 * Collections found by an exact name pattern rather than a fixed name, with their merge rule (data/restore.js). Only
 * the progress log's months match (^progress\.[a-z0-9-]+\.\d{4}-\d\d$): a later collection under progress.* gets
 * a rule of its own. A snapshot reader from before round 4 reads only SNAPSHOT_KV and passes these by.
 * @type {[RegExp, 'progressDays'][]}
 */
export const SNAPSHOT_PREFIX = [[MONTH_KEY, 'progressDays']];

/** The rule of a collection named by pattern, or null. @param {string} name */
export const prefixRule = name => (SNAPSHOT_PREFIX.find(([re]) => re.test(name)) || [])[1] || null;

/** The kv names of a profile that match SNAPSHOT_PREFIX, sorted. @param {Record<string, any>} kv @returns {string[]} */
export const prefixKeys = kv => Object.keys(kv || {}).filter(name => prefixRule(name) !== null).sort();

/**
 * Saved reading items whose words come from a private text: a phrase he marked (RP:). Their words and meaning
 * (PRIVATE_ITEM_FIELDS) live only in device-only read.ctx (features/shared/read-data.js); read.words holds the
 * numbers. A snapshot and an export without "Include reading texts" leave those fields out even of an entry written
 * before round 4's fix and not yet moved (read-data.js migratePhrases), so they never leave the device.
 */
export const PRIVATE_ITEM = /^RP:/;
export const PRIVATE_ITEM_FIELDS = /** @type {const} */ (['lemma', 'head', 'gloss']);
/** A saved entry without its private words. @param {any} w */
export const publicEntry = w => (w && typeof w === 'object' ? { ...w, lemma: '', head: '', gloss: null } : w);
/**
 * A collection as it may leave the device: read.words without the words of a marked phrase; anything else as it is.
 * @param {string} name @param {any} v
 */
export function withoutPrivate(name, v) {
  if (name !== 'read.words' || !v || typeof v !== 'object') return v;
  /** @type {Record<string, any>} */ const out = {};
  for (const [id, w] of Object.entries(v)) out[id] = PRIVATE_ITEM.test(id) ? publicEntry(w) : w;
  return out;
}

/** Device-scope collection with the backup's state (store.js DEVICE_SCOPE): never exported or uploaded. */
export const STATE_KV = 'backup';
export const SNAPSHOT_SCHEMA = 'fluentish-snapshot@1';

export const EVENTS_DIR = 'data/events';
export const SNAPSHOTS_DIR = 'data/snapshots';
export const LOGS_DIR = 'data/logs';
/** Events go up at most this often unless the learner asks ("Back up now"). */
export const EVENTS_EVERY_MS = 5 * 60e3;
/** Today's snapshot is rewritten at most this often (the events cover what changed in between). */
export const SNAPSHOT_EVERY_MS = 6 * 3600e3;

const DAY = /^\d{4}-\d\d-\d\d$/;
/** A device id as a folder name (ids are 8 base-36 characters; anything else is made safe). @param {string} id */
export const deviceDir = id => String(id || 'unknown').replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 64) || 'unknown';
/** @param {string} dev @param {string} day */
export const eventsPath = (dev, day) => `${EVENTS_DIR}/${deviceDir(dev)}/${DAY.test(day) ? day : 'undated'}.ndjson`;
/** @param {string} dev @param {string} day @param {boolean} gz */
export const snapshotPath = (dev, day, gz) => `${SNAPSHOTS_DIR}/${deviceDir(dev)}/${day}.json${gz ? '.gz' : ''}`;
/** @param {string} dev @param {string} day */
export const logPath = (dev, day) => `${LOGS_DIR}/${deviceDir(dev)}/${day}.ndjson`;

/** Whether an event is backed up: a learning event, not one of a private deck or marked local. @param {any} e */
export function backupable(e) {
  if (!e || !BACKUP_TYPES.has(e.type)) return false;
  const p = e.payload || {};
  return !p.local && !PRIVATE_DECKS.has(p.deck);
}

/** One NDJSON line: the event without the outbox's own fields. @param {any} e */
export const lineOf = e => JSON.stringify({ id: e.id, v: e.v, profileId: e.profileId, deviceId: e.deviceId, seq: e.seq, at: e.at, day: e.day, type: e.type, payload: e.payload });

/** Events of an NDJSON text; lines that do not parse or have no id are skipped. @param {string} text @returns {any[]} */
export function parseLines(text) {
  /** @type {any[]} */ const out = [];
  for (const line of String(text || '').split('\n')) {
    if (!line.trim()) continue;
    try { const e = JSON.parse(line); if (e && typeof e.id === 'string') out.push(e); } catch { /* a torn line: skipped */ }
  }
  return out;
}

/**
 * A day file's next text: the lines already there, plus these events by id, by seq. Lines are never removed.
 * @param {string | null} existing @param {any[]} events
 */
export function mergeLines(existing, events) {
  /** @type {Map<string, string>} */ const byId = new Map();
  /** @type {Map<string, any>} */ const order = new Map();
  for (const line of String(existing || '').split('\n')) {
    if (!line.trim()) continue;
    let e = null;
    try { e = JSON.parse(line); } catch { /* kept below under its own text */ }
    const id = e && typeof e.id === 'string' ? e.id : `raw:${line}`;
    if (!byId.has(id)) { byId.set(id, line); order.set(id, e || {}); }
  }
  for (const e of events) if (!byId.has(e.id)) { byId.set(e.id, lineOf(e)); order.set(e.id, e); }
  const ids = [...byId.keys()].sort((a, b) => (order.get(a).seq ?? 0) - (order.get(b).seq ?? 0) || (a < b ? -1 : a > b ? 1 : 0));
  return ids.map(id => byId.get(id)).join('\n') + (ids.length ? '\n' : '');
}

/* ---------- what must never leave the device ---------- */

const TOKEN = /github_pat_[A-Za-z0-9_]{20,}|\bgh[opsur]_[A-Za-z0-9]{20,}|sk-ant-[A-Za-z0-9_-]{16,}|-----BEGIN [A-Z ]*PRIVATE KEY-----/;
const SCRIPT_MARKS = /"deck":"script"|"local":true|"(?:SR|SW):|"script:/;

/**
 * Why a body must not be uploaded, or null. Looks for this device's own secrets, anything shaped like a token or
 * key, and the marks of Script mode's private data.
 * @param {string} text @param {Record<string, any>} [secrets] kv 'secrets'
 * @returns {string | null}
 */
export function leakIn(text, secrets = {}) {
  for (const v of Object.values(secrets || {})) if (typeof v === 'string' && v.length >= 8 && text.includes(v)) return 'a key or token of this device';
  if (TOKEN.test(text)) return 'something shaped like a key or token';
  if (SCRIPT_MARKS.test(text)) return 'private script data';
  return null;
}

/* ---------- snapshot ---------- */

/**
 * The snapshot of a profile: cards outside the private decks, and the learning collections.
 * @param {any} store @param {{now?: number, build?: string | null}} [o]
 */
export function snapshotOf(store, { now = Date.now(), build = null } = {}) {
  /** @type {Record<string, Record<string, any>>} */ const cards = {};
  let n = 0;
  for (const [deck, recs] of Object.entries(/** @type {Record<string, Record<string, any>>} */ (store.cardsByDeck || {}))) {
    if (PRIVATE_DECKS.has(deck) || !recs || !Object.keys(recs).length) continue;
    cards[deck] = recs;
    n += Object.keys(recs).length;
  }
  /** @type {Record<string, any>} */ const kv = {};
  for (const name of [...Object.keys(SNAPSHOT_KV), ...prefixKeys(store.kv)]) { const v = store.get(name); if (v !== undefined && v !== null) kv[name] = withoutPrivate(name, v); }
  return {
    schema: SNAPSHOT_SCHEMA, deviceId: store.device.deviceId, profileId: store.profile.id, at: isoWithOffset(new Date(now)),
    day: store.clock.today(), seq: store.device.seq || 0, build, counts: { cards: n }, cards, kv,
  };
}

/** What a snapshot holds, for change detection (not its time). @param {any} snap */
export const snapshotHash = snap => fnv1a(JSON.stringify({ cards: snap.cards, kv: snap.kv }));

/** gzip bytes of a text, or null where the browser has no CompressionStream. @param {string} text */
export async function gzip(text) {
  if (typeof CompressionStream === 'undefined') return null;
  const s = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
/** Text of gzip bytes. @param {Uint8Array} bytes */
export async function gunzip(bytes) {
  if (typeof DecompressionStream === 'undefined') throw new Error('this browser cannot read compressed backups');
  const s = new Blob([/** @type {BlobPart} */ (bytes)]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(s).text();
}

/* ---------- the upload ---------- */

/**
 * @typedef {{
 *   read: (path: string) => Promise<{sha: string, bytes: Uint8Array} | null>,
 *   write: (path: string, body: string | Uint8Array, message: string, sha?: string | null) => Promise<string | null>,
 *   list: (path: string) => Promise<{name: string, path: string, type: string, sha: string, size: number}[]>,
 * }} Files  a target's own files (github-b1exam.js createGithubB1Exam().files)
 */

/* A target's state lives in a device kv of its own: 'backup' for the results repository (STATE_KV), and later
   'backup.account' for the account (docs/ACCOUNTS.md, stage 2), which keeps its own high-water mark instead of
   event.synced. Every function below takes the kv name, and its default is today's. */
/** The backup's state on this device. @param {any} store @param {string} [kv] @returns {Record<string, any>} */
export const state = (store, kv = STATE_KV) => store.get(kv, {}) || {};
/** @param {any} store @param {Record<string, any>} patch @param {string} [kv] */
export const setState = (store, patch, kv = STATE_KV) => store.set(kv, { ...state(store, kv), ...patch });
/** Whether progress is backed up (on unless turned off). @param {any} store @param {string} [kv] */
export const backupOn = (store, kv = STATE_KV) => state(store, kv).on !== false;
/** The results repository's pending selector: learning events not yet marked synced. @param {any} store @returns {any[]} */
export const pendingEvents = store => store.pending().filter(backupable);
/** The results repository's acknowledgement: event.synced. @param {any} store @param {any[]} events */
export const markEventsSent = (store, events) => store.markSynced(events.map(e => e.id));
/** Learning events waiting for the backup. @param {any} store */
export const waiting = store => pendingEvents(store).length;

/**
 * Write a file this device owns: read it (for its sha and what is there), make the new text, write with the sha.
 * A conflict (another tab, a retry that did arrive) reads again; three tries.
 * @param {Files} files @param {string} path @param {(old: string | null) => string} next @param {string} message
 * @param {Record<string, any>} secrets
 * @returns {Promise<{sha: string | null, changed: boolean}>}
 */
export async function writeOwned(files, path, next, message, secrets) {
  for (let i = 0; ; i++) {
    const cur = await files.read(path);
    const old = cur ? new TextDecoder().decode(cur.bytes) : null;
    const text = next(old);
    if (old === text) return { sha: cur ? cur.sha : null, changed: false };
    const leak = leakIn(text, secrets);
    if (leak) throw Object.assign(new Error(`backup blocked: ${path} would contain ${leak}`), { blocked: true });
    try { return { sha: await files.write(path, text, message, cur ? cur.sha : null), changed: true }; } catch (e) {
      if (!(/** @type {any} */ (e)?.conflict) || i >= 2) throw e;
    }
  }
}

/**
 * Back up what is waiting: the learning events (one file per study day, by this device), then today's snapshot
 * when it is due. Marks the events it wrote as synced. Stops at a token or connection error.
 * @param {any} store @param {Files} files
 * @param {{now?: () => number, force?: boolean, build?: string | null, extra?: (o: {files: Files, secrets: any, now: () => number}) => Promise<void>,
 *   stateKv?: string, pending?: (store: any) => any[], markSent?: (store: any, events: any[]) => void}} [o]
 *   extra: one more daily upload in the same run (the error log). stateKv, pending, markSent: the target's own state
 *   kv, its selector of the learning events still to send, and how it records them as sent; the defaults are the
 *   results repository's ('backup', pendingEvents, markEventsSent)
 * @returns {Promise<{ok: number, files: number, snapshot: boolean, error: any}>}
 */
export async function backupProgress(store, files, { now = Date.now, force = false, build = null, extra, stateKv = STATE_KV, pending: select = pendingEvents, markSent = markEventsSent } = {}) {
  const out = { ok: 0, files: 0, snapshot: false, error: /** @type {any} */ (null) };
  if (!backupOn(store, stateKv)) return out;
  const st = state(store, stateKv);
  const secrets = store.get('secrets', {}) || {};
  const dev = store.device.deviceId;
  // 1. learning events, oldest day first
  const pending = select(store).filter(backupable);
  const eventsDue = force || !st.eventsAt || now() - (Date.parse(st.eventsAt) || 0) >= EVENTS_EVERY_MS;
  if (pending.length && eventsDue) {
    /** @type {Map<string, any[]>} */ const byFile = new Map();
    for (const e of pending) { const p = eventsPath(dev, e.day); byFile.set(p, [...(byFile.get(p) || []), e]); }
    for (const [path, evs] of [...byFile].sort(([a], [b]) => (a < b ? -1 : 1))) {
      try {
        await writeOwned(files, path, old => mergeLines(old, evs), `progress: ${evs.length} event${evs.length === 1 ? '' : 's'} (${deviceDir(dev)})`, secrets);
        markSent(store, evs);
        out.ok += evs.length;
        out.files++;
      } catch (e) {
        out.error = e;
        if (/** @type {any} */ (e)?.auth || /** @type {any} */ (e)?.offline) break;
      }
    }
    if (!out.error) setState(store, { eventsAt: new Date(now()).toISOString() }, stateKv);
  }
  if (out.error?.auth || out.error?.offline) return finish(store, out, now, stateKv);
  // 2. today's snapshot
  try { out.snapshot = await snapshotIfDue(store, files, { now, force, build, secrets, stateKv }); } catch (e) { out.error = out.error || e; }
  if (out.error?.auth || out.error?.offline) return finish(store, out, now, stateKv);
  // 3. anything else that goes once a day (the error log)
  if (extra) { try { await extra({ files, secrets, now }); } catch (e) { out.error = out.error || e; } }
  return finish(store, out, now, stateKv);
}

/** @param {any} store @param {{ok: number, files: number, snapshot: boolean, error: any}} out @param {() => number} now @param {string} stateKv */
function finish(store, out, now, stateKv) {
  const at = new Date(now()).toISOString();
  setState(store, out.error ? { error: { at, message: String(out.error?.message || out.error) } } : { at, error: null }, stateKv);
  return out;
}

/**
 * Upload today's snapshot when it is due: none yet today, or older than SNAPSHOT_EVERY_MS and changed, or asked for.
 * A profile without cards writes none (a fresh start never covers a real backup).
 * @param {any} store @param {Files} files @param {{now: () => number, force: boolean, build: string | null, secrets: any, stateKv: string}} o
 */
async function snapshotIfDue(store, files, { now, force, build, secrets, stateKv }) {
  const st = state(store, stateKv);
  const today = store.clock.today();
  const prev = st.snapshot && st.snapshot.profileId === store.profile.id ? st.snapshot : null;
  const due = force || !prev || prev.day !== today || now() - (Date.parse(prev.at) || 0) >= SNAPSHOT_EVERY_MS;
  if (!due) return false;
  const snap = snapshotOf(store, { now: now(), build });
  if (!snap.counts.cards) return false;
  const hash = snapshotHash(snap);
  if (prev && prev.day === today && prev.hash === hash) { setState(store, { snapshot: { ...prev, at: snap.at } }, stateKv); return false; }
  const text = JSON.stringify(snap);
  const leak = leakIn(text, secrets);
  if (leak) throw Object.assign(new Error(`backup blocked: the snapshot would contain ${leak}`), { blocked: true });
  const gz = await gzip(text);
  const path = snapshotPath(store.device.deviceId, today, !!gz);
  const message = `progress: snapshot, ${snap.counts.cards} cards (${deviceDir(store.device.deviceId)})`;
  const body = gz || text;
  let sha = prev && prev.path === path ? prev.sha : null;
  for (let i = 0; ; i++) {
    try { sha = await files.write(path, body, message, sha); break; } catch (e) {
      if (!(/** @type {any} */ (e)?.conflict) || i >= 2) throw e;
      sha = (await files.read(path))?.sha || null;   // written by an earlier try, or by another tab: replace it
    }
  }
  setState(store, { snapshot: { day: today, at: snap.at, hash, path, sha, profileId: store.profile.id, cards: snap.counts.cards } }, stateKv);
  return true;
}

/* ---------- the error log, once a day ---------- */

/** Lower-case words of a text. @param {string} s */
const words = s => String(s || '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];

/**
 * A test for script text: true when a message holds three words in a row from one of his scripts, or a script's title.
 * @param {Record<string, any>} scripts kv 'scripts'
 * @returns {(message: string) => boolean}
 */
export function scriptText(scripts) {
  /** @type {Set<string>} */ const grams = new Set();
  /** @type {string[]} */ const titles = [];
  for (const s of Object.values(scripts || {})) {
    if (!s || typeof s !== 'object') continue;
    if (typeof s.title === 'string' && s.title.trim().length >= 4) titles.push(s.title.trim().toLowerCase());
    for (const sec of s.sections || []) {
      for (const text of [sec.title, ...(sec.sentences || []).map((/** @type {any} */ x) => x && x.de)]) {
        const w = words(text);
        for (let i = 0; i + 2 < w.length; i++) grams.add(`${w[i]} ${w[i + 1]} ${w[i + 2]}`);
      }
    }
  }
  return message => {
    const m = String(message || '').toLowerCase();
    if (titles.some(t => m.includes(t))) return true;
    const w = words(m);
    for (let i = 0; i + 2 < w.length; i++) if (grams.has(`${w[i]} ${w[i + 1]} ${w[i + 2]}`)) return true;
    return false;
  };
}

/**
 * The reading texts on this device in Scripts' shape ({title, sections: [{sentences: [{de}]}]}): the texts he pasted
 * and the sentences his saved words were met in, for the log check.
 * @param {any} store @returns {Record<string, any>}
 */
export function readTexts(store) {
  /** @type {Record<string, any>} */ const out = {};
  for (const [id, r] of Object.entries(store.get('reads', {}) || {})) if (r && r.sections) out[`read:${id}`] = { title: r.title, sections: r.sections };
  const ctx = Object.values(store.get('read.ctx', {}) || {}).flat().map((/** @type {any} */ x) => ({ de: x && x.de }));
  if (ctx.length) out['read:ctx'] = { title: null, sections: [{ sentences: ctx }] };
  return out;
}

/**
 * The conversations on this device in Scripts' shape: each transcript's title and every line, his and Claude's, for
 * the log check (conversation practice, round 4; the transcripts never leave the device).
 * @param {any} store @returns {Record<string, any>}
 */
export function convTexts(store) {
  /** @type {Record<string, any>} */ const out = {};
  for (const [id, tr] of Object.entries(store.get('conv.transcripts', {}) || {})) {
    if (!tr || typeof tr !== 'object') continue;
    const x = /** @type {any} */ (tr);
    out[`conv:${id}`] = { title: typeof x.title === 'string' ? x.title : null, sections: [{ sentences: (Array.isArray(x.turns) ? x.turns : []).map((/** @type {any} */ t) => ({ de: String(t && t.text || '').replace(/<\/?r\b[^>]*>/g, '') })) }] };
  }
  return out;
}

/**
 * Upload the error log once a study day: the entries logged since the last upload, to data/logs/<device>/<day>.ndjson,
 * each checked again for script text (a match is replaced, never sent).
 * @param {any} store @param {Files} files
 * @param {{entries: {at: string, where: string, message: string}[], now: () => number, secrets: any, build?: string | null, stateKv?: string}} o
 *   stateKv: the target's state kv (default 'backup')
 * @returns {Promise<number>} entries uploaded
 */
export async function uploadLog(store, files, { entries, now, secrets, build = null, stateKv = STATE_KV }) {
  const st = state(store, stateKv);
  const today = store.clock.today();
  if (st.logDay === today) return 0;
  const since = st.logAt || '';
  const fresh = entries.filter(e => e && typeof e.at === 'string' && e.at > since);
  if (!fresh.length) { setState(store, { logDay: today }, stateKv); return 0; }
  // reading texts (kv reads, read.ctx) and conversation transcripts have Scripts' shape, so the same check finds them
  // (round 4)
  const isScript = scriptText({ ...(store.get('scripts', {}) || {}), ...readTexts(store), ...convTexts(store) });
  const lines = fresh.map(e => JSON.stringify({ at: e.at, where: String(e.where || '').slice(0, 40), message: isScript(e.message) || isScript(e.where) ? '[removed: script text]' : String(e.message || '').slice(0, 300), build }));
  await writeOwned(files, logPath(store.device.deviceId, today), old => {
    const have = new Set(String(old || '').split('\n').filter(Boolean));
    return [...have, ...lines.filter(l => !have.has(l))].join('\n') + '\n';
  }, `progress: error log (${deviceDir(store.device.deviceId)})`, secrets);
  setState(store, { logDay: today, logAt: fresh[fresh.length - 1].at }, stateKv);
  return fresh.length;
}
