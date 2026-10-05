/* Results sync to the private B1 exam repository through the GitHub Contents API (review A8, ARCHITECTURE §3.3).

   It writes exactly the files the Mac's scripts/sync.py imports, and reads what sync.py writes back:

     event type         file written (one per event; the path is fixed when the event is created)
     exam.attempt       data/attempts/<stamp>-dayNN-<module>.json     the attempt in the B1 exam app's shape
     exam.voice         data/voice/dayNN/<stamp>-<module>-<part>.json  sidecar first, then the audio
                        data/voice/dayNN/<stamp>-<module>-<part>.<ext>
     feedback.created   data/feedback-ai/<stamp>-dayNN-<module>.json   a one-click correction
     vocab.captured     data/vocab/<stamp>-<word key>.json
     vocab.reviewed     data/vocab-reviews/<stamp>-<batch>.json        {events: [...]}
     training.logged    data/training/<stamp>-<task>.json

     read with the token: data/feedback.json, data/results.json, data/vocab.json, data/learner.json (optional),
     found through one listing of data/ so only changed files are fetched

   <stamp> is YYYYMMDDTHHMMSS in UTC, taken from the moment the event was created, so a retry writes the same file
   and a "422 sha" answer (the file already arrived) counts as sent. sync.py dedupes by path, so nothing is imported
   twice. sync.py splits a voice file stem on the first '-', which is why the stamp has no '-' in it.

   Voice blobs wait in the IDB blobs store (blobRef = the event id) and are deleted only after both PUTs succeed.
   Unsent items moved from the old app (attempts, corrections, words, word answers with synced:false) are sent from
   their collections with the path the old app already chose, or a new one, and only after the learner said so
   (ui.sendLegacy, set by "Send … from the old app" on Today or "Send now" on Exam). An item without a time keeps
   created_at null; its file name takes the migration time, never "now".

   Consent: after a migration nothing is uploaded until the import notice on Today has been seen (ui.importSeen), and
   after the cutover merged a preview's work, until its notice has been seen (ui.previewSeen).
   Reading what the Mac wrote is allowed before that.

   The same flush backs up progress (data/sync/backup.js): the learning events as one NDJSON file per device per
   study day under data/events/, and a daily snapshot of the cards under data/snapshots/. sync.py reads only the
   folders above, so it never sees them.

   The network is injected (fetch), so node tests run the whole flow against a mock and against the real sync.py. */
import { backupProgress } from './backup.js';
import { b1ExamSync } from '../../domain/exam-results.js';

/** The files sync.py (and the tutor) write that this app reads. */
/** data/<name>.json read back. 'vocab-audio' is the private word-audio index; it goes to its own store key (below). */
export const PULLED = ['feedback', 'results', 'vocab', 'learner', 'vocab-audio'];

export const TYPES = new Set(['exam.attempt', 'exam.voice', 'feedback.created', 'vocab.captured', 'vocab.reviewed', 'training.logged']);

const AUDIO_EXT = /** @type {Record<string, string>} */ ({ 'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/aac': 'aac' });

/** File extension for a recording's MIME type (the same table as the B1 exam app). @param {string} mime */
export const audioExt = mime => AUDIO_EXT[String(mime || '').split(';')[0].trim()] || 'bin';

/** 'YYYYMMDDTHHMMSS' in UTC. @param {Date | number} at */
export const stamp = at => new Date(at).toISOString().replace(/[-:]/g, '').slice(0, 15);

const safe = (/** @type {string} */ s) => String(s).replace(/[^a-zA-Z0-9/_.-]+/g, '-');
/** The B1 exam app's word key (lower case letters and digits only). @param {string} w */
export const wordKey = w => String(w || '').trim().toLowerCase().replace(/[^\p{L}\p{N}_]/gu, '');

/**
 * The repository path for an event, fixed at creation.
 * @param {string} type @param {Record<string, any>} p payload @param {Date | number} at
 * @returns {string}
 */
export function pathFor(type, p, at) {
  const s = stamp(at);
  switch (type) {
    // the exam files are named by the result-file adapter this target implements (domain/exam-results.js)
    case 'exam.attempt': return b1ExamSync.attemptName(p.file, s);
    case 'exam.voice': return safe(b1ExamSync.voiceStem(p, s)) + `.${audioExt(p.mime)}`;
    case 'feedback.created': return b1ExamSync.feedbackName(p, s);
    case 'vocab.captured': return `data/vocab/${s}-${(p.word_key || wordKey(p.word)).slice(0, 24) || 'wort'}.json`;
    case 'vocab.reviewed': return `data/vocab-reviews/${s}-${safe(p.batch || 'batch')}.json`;
    case 'training.logged': return `data/training/${s}-${safe(p.task || 'text')}.json`;
    default: throw new Error(`github-b1exam: no file for ${type}`);
  }
}

/**
 * The path an event is filed under. An event that stored a path (every event from before the sync seam, and the
 * cutover's) keeps it; an event recorded through data/sync/index.js stores none and its path is derived here, from
 * its type, payload and creation time, which gives exactly what pathFor gave when it was created. null for an event
 * this target does not send.
 * @param {{type: string, payload: Record<string, any>, at: string, path?: string | null}} e
 * @returns {string | null}
 */
export function pathOf(e) {
  if (!e || !TYPES.has(e.type)) return null;
  if (e.path) return e.path;
  const at = Date.parse(e.at);
  if (!Number.isFinite(at)) return null;
  try { return pathFor(e.type, e.payload || {}, at); } catch { return null; }
}

/** The sidecar path of a voice file (same stem, .json). @param {string} audioPath */
export const sidecarPath = audioPath => audioPath.replace(/\.[^./]+$/, '.json');

/**
 * Append an event this target sends, with its path stored now (the format before the sync seam; features record
 * through data/sync/index.js, which stores no path). Kept for the tests of events that carry a stored path.
 * @param {{ append: (type: string, payload: Record<string, any>, o?: {at?: Date, path?: string|null, day?: string}) => any }} store
 * @param {string} type @param {Record<string, any>} payload @param {Date} [at]
 */
export function appendResult(store, type, payload, at = new Date()) {
  return store.append(type, payload, { at, path: pathFor(type, payload, at) });
}

/**
 * The files one event becomes, in upload order: [{path, body: string | Blob, message}].
 * @param {{type: string, payload: Record<string, any>, path: string | null}} e
 * @param {Blob | null} [blob] the recording for exam.voice
 * @returns {{path: string, body: string | Blob, message: string}[]}
 */
export function filesFor(e, blob = null) {
  const p = e.payload || {};
  const path = e.path || '';
  const json = (/** @type {any} */ v, indent = 0) => JSON.stringify(v, null, indent || undefined);
  switch (e.type) {
    case 'exam.attempt': {
      const a = p.file;
      return [{ path, body: json(a, 1), message: `Tag ${a.day} ${a.module}${a.score != null ? ` ${a.score}/${a.max_score}` : ''}` }];
    }
    case 'exam.voice': {
      if (!blob) throw new Error('recording missing on this device');
      const info = { day: Number(p.day), module: p.module, part: p.part, label: p.label || '', mime: p.mime, created_at: p.created_at, bytes: p.bytes ?? blob.size };
      return [
        { path: sidecarPath(path), body: json(info), message: `Tag ${p.day} Aufnahme ${p.module}/${p.part} (meta)` },
        { path, body: blob, message: `Tag ${p.day} Aufnahme ${p.module}/${p.part}` },
      ];
    }
    case 'feedback.created':
      // author and prompt_version are additive (feedback@1); events from before them send neither
      return [{ path, body: json({ day: p.day, module: p.module, attempt_id: p.attempt_id ?? null, attempt_file: p.attempt_file ?? null, body: p.body, created_at: p.created_at, model: p.model ?? null,
        ...(p.author ? { author: p.author } : {}), ...(p.promptVersion ? { prompt_version: p.promptVersion } : {}) }, 1), message: `Tag ${p.day} ${p.module}: Korrektur` }];
    case 'vocab.captured':
      return [{ path, body: json({ day: p.day, module: p.module ?? null, teil: p.teil ?? null, word: p.word, word_key: p.word_key || wordKey(p.word), sentence: p.sentence || '', created_at: p.created_at }), message: `Wort: ${p.word} (Tag ${p.day})` }];
    case 'vocab.reviewed': {
      const evs = p.events || [];
      return [{ path, body: json({ events: evs }), message: evs.length === 1 ? `Wörter: ${evs[0].action || 'review'} ${evs[0].word}` : `Wörter: ${evs.length} Antworten` }];
    }
    case 'training.logged':
      return [{ path, body: json({ task: p.task, day: p.day, aufgabe: p.aufgabe, text: p.text, result: p.result ?? null, model: p.model ?? null, usage: p.usage ?? null, at: p.at }), message: `Training ${p.task}` }];
    default: throw new Error(`github-b1exam: cannot send ${e.type}`);
  }
}

/* ---------- transport ---------- */

/** Base64 of UTF-8 text, bytes or a Blob's bytes. @param {string | Blob | Uint8Array} body */
export async function toBase64(body) {
  const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body instanceof Uint8Array ? body : new Uint8Array(await body.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Bytes of a base64 string (GitHub wraps it in newlines). @param {string} b64 */
export function fromBase64(b64) {
  const bin = atob(String(b64 || '').replace(/\s+/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export class SyncError extends Error {
  /** @param {string} message @param {{status?: number, auth?: boolean, offline?: boolean, conflict?: boolean}} [o] */
  constructor(message, { status = 0, auth = false, offline = false, conflict = false } = {}) {
    super(message); this.status = status; this.auth = auth; this.offline = offline; this.conflict = conflict;
  }
}

/**
 * The GitHub target. push/pull follow the sync interface (review A8): push(events) → {acked, rejected},
 * pull(cursor) → {cursor, docs}; the cursor is a map of ETags.
 * @param {{ token: () => string | null | undefined, repo: string, api?: string, fetch?: typeof fetch,
 *           getBlob?: (id: string) => Promise<Blob | null>, deleteBlob?: (id: string) => Promise<void> }} o
 */
export function createGithubB1Exam({ token, repo, api = 'https://api.github.com', fetch: f = (...a) => fetch(...a), getBlob = async () => null, deleteBlob = async () => {} }) {
  const headers = () => {
    const tok = token();
    if (!tok) throw new SyncError('This device is not linked', { auth: true });
    return { Authorization: `Bearer ${tok}`, Accept: 'application/vnd.github+json' };
  };
  const url = (/** @type {string} */ p) => `${api}/repos/${repo}/contents/${p.split('/').map(encodeURIComponent).join('/')}`;

  /** PUT one file; true when written or already there. @param {{path: string, body: string | Blob, message: string}} file */
  async function put(file) {
    const h = headers();
    let r;
    try {
      r = await f(url(file.path), { method: 'PUT', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify({ message: file.message, content: await toBase64(file.body) }) });
    } catch (e) { throw new SyncError('No connection', { offline: true }); }
    if (r.ok) return true;
    let msg = r.statusText || '';
    try { msg = (await r.json()).message || msg; } catch { /* not json */ }
    if (r.status === 422 && /sha/i.test(msg)) return true;          // a retry of a file that did arrive
    if (r.status === 401 || r.status === 403) throw new SyncError('The GitHub token is invalid or expired', { status: r.status, auth: true });
    throw new SyncError(`GitHub ${r.status}: ${msg}`, { status: r.status });
  }

  /** A GET that maps transport and auth failures to SyncError. @param {string} p @param {Record<string, string>} [extra] */
  async function get(p, extra = {}) {
    let r;
    try { r = await f(url(p), { headers: { ...headers(), ...extra }, cache: 'no-store' }); } catch { throw new SyncError('No connection', { offline: true }); }
    if (r.status === 401 || r.status === 403) throw new SyncError('The GitHub token is invalid or expired', { status: r.status, auth: true });
    return r;
  }

  /* Files this device owns alone (the progress backup, data/sync/backup.js): read with their sha, written with it. */
  const files = {
    /**
     * One file's bytes and blob sha, or null when it is not there. Files over 1 MB come back without content from
     * the JSON endpoint and are read raw.
     * @param {string} p @returns {Promise<{sha: string, bytes: Uint8Array} | null>}
     */
    async read(p) {
      const r = await get(p);
      if (r.status === 404) return null;
      if (!r.ok) throw new SyncError(`GitHub ${r.status}: ${p} could not be read`, { status: r.status });
      /** @type {any} */ let meta;
      try { meta = await r.json(); } catch { throw new SyncError(`GitHub: ${p} could not be read`); }
      if (!meta || Array.isArray(meta) || meta.type !== 'file') throw new SyncError(`GitHub: ${p} is not a file`);
      if (meta.encoding === 'base64' && (meta.content || !meta.size)) return { sha: meta.sha, bytes: fromBase64(meta.content || '') };
      const raw = await get(p, { Accept: 'application/vnd.github.raw+json' });
      if (!raw.ok) throw new SyncError(`GitHub ${raw.status}: ${p} could not be read`, { status: raw.status });
      return { sha: meta.sha, bytes: new Uint8Array(await raw.arrayBuffer()) };
    },
    /**
     * Create or replace a file. sha: the blob it replaces (null to create). Returns the new blob sha. A stale or
     * missing sha is a conflict (409, or 422 naming the sha): the caller reads the file again and retries.
     * @param {string} p @param {string | Uint8Array} body @param {string} message @param {string | null} [sha]
     * @returns {Promise<string | null>}
     */
    async write(p, body, message, sha = null) {
      const h = headers();
      let r;
      try {
        r = await f(url(p), { method: 'PUT', headers: { ...h, 'Content-Type': 'application/json' },
          body: JSON.stringify({ message, content: await toBase64(body), ...(sha ? { sha } : {}) }) });
      } catch { throw new SyncError('No connection', { offline: true }); }
      /** @type {any} */ let out = null;
      try { out = await r.json(); } catch { /* not json */ }
      if (r.ok) return out?.content?.sha ?? null;
      const msg = out?.message || r.statusText || '';
      if (r.status === 401 || r.status === 403) throw new SyncError('The GitHub token is invalid or expired', { status: r.status, auth: true });
      if (r.status === 409 || (r.status === 422 && /sha/i.test(msg))) throw new SyncError(`GitHub ${r.status}: ${p} changed`, { status: r.status, conflict: true });
      throw new SyncError(`GitHub ${r.status}: ${msg}`, { status: r.status });
    },
    /**
     * A folder's entries ([] when it is not there).
     * @param {string} p @returns {Promise<{name: string, path: string, type: string, sha: string, size: number}[]>}
     */
    async list(p) {
      const r = await get(p);
      if (r.status === 404) return [];
      if (!r.ok) throw new SyncError(`GitHub ${r.status}: ${p} could not be listed`, { status: r.status });
      /** @type {any} */ let entries;
      try { entries = await r.json(); } catch { entries = []; }
      return (Array.isArray(entries) ? entries : []).filter(e => e && typeof e.name === 'string')
        .map(e => ({ name: e.name, path: e.path || `${p}/${e.name}`, type: e.type, sha: e.sha, size: e.size || 0 }));
    },
  };

  return {
    put,
    files,
    /**
     * Send events in order. Stops at the first auth or connection error (the rest would fail the same way).
     * @param {any[]} events @returns {Promise<{acked: string[], rejected: {id: string, error: string}[], error: SyncError | null}>}
     */
    async push(events) {
      /** @type {string[]} */ const acked = [];
      /** @type {{id: string, error: string}[]} */ const rejected = [];
      for (const e of events) {
        const path = pathOf(e);
        if (!path) { rejected.push({ id: e.id, error: 'not for this target' }); continue; }
        try {
          const blob = e.type === 'exam.voice' ? await getBlob(e.payload.blobRef || e.id) : null;
          for (const file of filesFor({ ...e, path }, blob)) await put(file);
          if (e.type === 'exam.voice') await deleteBlob(e.payload.blobRef || e.id).catch(() => {});
          acked.push(e.id);
        } catch (err) {
          const se = err instanceof SyncError ? err : new SyncError(String(/** @type {any} */ (err)?.message || err));
          rejected.push({ id: e.id, error: se.message });
          if (se.auth || se.offline) return { acked, rejected, error: se };
        }
      }
      return { acked, rejected, error: null };
    },
    /**
     * Read what the Mac wrote. One listing of data/ (with its ETag; a 304 means nothing changed), then only the
     * files whose blob sha changed. Files that are not there are not requested, so a missing optional file
     * (learner.json) never shows up as a failed request.
     * @param {{etag?: string, names?: string, shas?: Record<string, string>}} [cursor]
     * @returns {Promise<{cursor: {etag?: string, names?: string, shas: Record<string, string>}, docs: Record<string, any>, changed: string[]}>}
     */
    async pull(cursor = {}) {
      const shas = { ...(cursor.shas || {}) };
      /** @type {Record<string, any>} */ const docs = {};
      /** @type {string[]} */ const changed = [];
      // the ETag only counts for the same list of files: a file added to PULLED is read on the next pull
      const names = PULLED.join(',');
      const etag = cursor.names === names ? cursor.etag : undefined;
      const list = await get('data', etag ? { 'If-None-Match': etag } : {});
      if (list.status === 304) return { cursor: { etag, names, shas }, docs, changed };
      if (!list.ok) throw new SyncError(`GitHub ${list.status}: data/ could not be listed`, { status: list.status });
      /** @type {any[]} */ let entries = [];
      try { entries = await list.json(); } catch { entries = []; }
      const bySha = new Map((Array.isArray(entries) ? entries : []).filter(e => e && e.type === 'file').map(e => [e.name, e.sha]));
      for (const name of PULLED) {
        const sha = bySha.get(`${name}.json`);
        if (!sha) { if (shas[name]) { docs[name] = null; changed.push(name); delete shas[name]; } continue; }
        if (shas[name] === sha) continue;
        const r = await get(`data/${name}.json`, { Accept: 'application/vnd.github.raw+json' });
        if (!r.ok) continue;
        try { docs[name] = await r.json(); } catch { continue; }
        shas[name] = sha;
        changed.push(name);
      }
      return { cursor: { etag: list.headers.get('etag') || undefined, names, shas }, docs, changed };
    },
  };
}

/* ---------- the flush, over the store ---------- */

const REMOTE_KV = 'exams.remote';
const VOCAB_AUDIO_KV = 'exams.vocabAudio';   // services/audio.js reads it
const STATUS_KV = 'exams.syncStatus';

/**
 * Unsent items moved from the old app, as send jobs with the path the old app chose (or a new one).
 * @param {any} store @returns {{key: string, event: any, done: () => void}[]}
 */
export function legacyJobs(store) {
  /** @type {{key: string, event: any, done: () => void}[]} */ const jobs = [];
  // a stamp for file names of items that carry no time of their own: when they were moved here, not now
  const moved = Date.parse((store.get('meta', {}) || {}).migratedAt || '') || 0;
  const when = (/** @type {any} */ v) => Date.parse(v || '') || moved;
  for (const a of store.attempts()) {
    if (!a.legacy || a.synced !== false || a.eventId) continue;
    const file = attemptFile(a);
    const path = a.legacy.path || pathFor('exam.attempt', { file }, when(a.submitted_at));
    jobs.push({ key: `attempt:${a.id}`, event: { id: `legacy:${a.id}`, type: 'exam.attempt', path, payload: { file: { ...file, id: a.legacy.id ?? file.id } } },
      done: () => store.putAttempts([{ ...a, synced: true, path }]) });
  }
  const list = (/** @type {string} */ name) => /** @type {any[]} */ (Array.isArray(store.get(name)) ? store.get(name) : []);
  const mark = (/** @type {string} */ name, /** @type {(x: any) => boolean} */ match, /** @type {string | null} */ path) =>
    store.update(name, (/** @type {any[]} */ xs) => (xs || []).map(x => (match(x) ? { ...x, synced: true, _path: path || x._path } : x)), []);
  for (const fb of list('exams.feedbackLocal')) {
    if (!fb || fb.synced !== false) continue;
    const payload = { day: fb.day, module: fb.module, attempt_id: fb.alias_id ?? fb.attempt_id, attempt_file: fb.attempt_file, body: fb.body, created_at: fb.created_at ?? null, model: fb.model ?? null };
    const path = fb._path || pathFor('feedback.created', payload, when(fb.created_at));
    jobs.push({ key: `fb:${fb.id}`, event: { id: `legacy:fb:${fb.id}`, type: 'feedback.created', path, payload }, done: () => mark('exams.feedbackLocal', x => x.id === fb.id, path) });
  }
  for (const w of list('vocab.local')) {
    if (!w || w.synced !== false) continue;
    const { synced, _path, ...rest } = w;
    rest.created_at = w.created_at ?? null;
    const path = _path || pathFor('vocab.captured', rest, when(w.created_at));
    jobs.push({ key: `word:${w.id}`, event: { id: `legacy:word:${w.id}`, type: 'vocab.captured', path, payload: rest }, done: () => mark('vocab.local', x => x.id === w.id, path) });
  }
  const open = list('vocab.events').filter(e => e && e.synced === false);
  if (open.length) {
    const first = open[0];
    const payload = { batch: `legacy${open.length}`, events: open.map(({ synced, _path, ...rest }) => rest) };
    const path = pathFor('vocab.reviewed', payload, when(first.at));
    const ids = new Set(open);
    jobs.push({ key: 'vocab-events', event: { id: 'legacy:vocab-events', type: 'vocab.reviewed', path, payload },
      done: () => store.update('vocab.events', (/** @type {any[]} */ xs) => (xs || []).map(x => (x && x.synced === false && [...ids].some(o => o.at === x.at && o.word === x.word) ? { ...x, synced: true } : x)), []) });
  }
  return jobs;
}

/** Events this target sends that have not been acknowledged. @param {any} store */
export const pendingEvents = store => store.pending().filter((/** @type {any} */ e) => !!pathOf(e));

/** "N not sent": events plus unsent items moved from the old app. @param {any} store */
export const notSentCount = store => pendingEvents(store).length + legacyJobs(store).length;

/** Whether uploads may start: not before the notice of a migration, or of work kept from the preview, has been seen. @param {any} store */
export function uploadsAllowed(store) {
  const meta = store.get('meta', {}) || {}, ui = store.get('ui', {}) || {};
  return (!meta.summary || !!ui.importSeen || !!ui.sendLegacy) && (!meta.preview || !!ui.previewSeen || !!ui.sendLegacy);
}
/** Whether the learner asked to send the unsent items moved from the old app. @param {any} store */
export const legacyAllowed = store => !!(store.get('ui', {}) || {}).sendLegacy;
/** The one tap that sends them (Today's import notice, Exam's "Send now"). @param {any} store */
export function allowLegacy(store) {
  store.update('ui', (/** @type {any} */ u) => ({ ...(u || {}), sendLegacy: true }), {});
  store.flush?.();
}

/** An attempt record as the B1 exam app's attempt file (the b1-exam-sync@1 adapter, domain/exam-results.js). */
export const attemptFile = b1ExamSync.attemptFile;

let flushing = /** @type {Promise<any> | null} */ (null);
let lastFlush = 0;

/**
 * Send what is waiting, back up progress and read what the Mac wrote. At most once a minute unless forced; one tab
 * at a time.
 * @param {any} store
 * @param {{ repo: string, api?: string, fetch?: typeof fetch, force?: boolean, pull?: boolean, now?: () => number,
 *           emit?: (type: string, data: any) => void, backupNow?: boolean, build?: string | null,
 *           extra?: (o: {files: any, secrets: any, now: () => number}) => Promise<void> }} o
 *   backupNow: "Back up now" (the events and a snapshot whatever their cadence); extra: the daily error-log upload
 * @returns {Promise<{ok: number, fail: number, pending: number, error: string | null, skipped?: boolean, backup?: any}>}
 */
export function syncResults(store, { repo, api, fetch: f, force = false, pull = true, now = Date.now, emit, backupNow = false, build = null, extra }) {
  const token = () => (store.get('secrets', {}) || {}).githubToken || null;
  if (!token() || store.profile?.kind === 'shadow') return Promise.resolve({ ok: 0, fail: 0, pending: notSentCount(store), error: null, skipped: true });
  if (flushing) return flushing;
  if (!force && now() - lastFlush < 60000) return Promise.resolve({ ok: 0, fail: 0, pending: notSentCount(store), error: null, skipped: true });
  lastFlush = now();
  const adapter = store.adapter;
  const target = createGithubB1Exam({
    token, repo, api, fetch: f,
    getBlob: id => adapter.getBlob(id), deleteBlob: id => adapter.deleteBlob(id),
  });
  const run = async () => {
    let ok = 0, fail = 0, halted = false;
    /** @type {string | null} */ let error = null;
    const allowed = uploadsAllowed(store);
    // 1. events in the outbox
    const events = allowed ? pendingEvents(store) : [];
    if (events.length) {
      const res = await target.push(events);
      if (res.acked.length) {
        store.markSynced(res.acked);
        const sent = new Set(res.acked);
        const atts = store.attempts().filter((/** @type {any} */ a) => a.eventId && sent.has(a.eventId) && a.synced !== true);
        if (atts.length) store.putAttempts(atts.map((/** @type {any} */ a) => ({ ...a, synced: true })));
      }
      ok += res.acked.length;
      fail += res.rejected.length;
      if (res.error) { error = res.error.message; halted = true; }
      else if (res.rejected.length) error = res.rejected[0].error;
    }
    // 2. unsent items from the old app, once the learner asked for it
    if (!error && allowed && legacyAllowed(store)) {
      for (const job of legacyJobs(store)) {
        const r = await target.push([job.event]);
        if (r.acked.length) { job.done(); ok++; } else { fail++; error = r.rejected[0]?.error || 'not sent'; if (r.error) { halted = true; break; } }
      }
    }
    // 3. progress backup: learning events and today's snapshot, on the same consent; its own errors do not hold
    //    back the read below unless the token or the connection failed
    /** @type {any} */ let backup = null;
    if (allowed && !halted) {
      const b = await backupProgress(store, target.files, { now, force: backupNow, build, extra });
      backup = { ok: b.ok, files: b.files, snapshot: b.snapshot, error: b.error ? String(b.error?.message || b.error) : null };
      if (b.error?.auth || b.error?.offline) { halted = true; error = error || backup.error; }
    }
    // 4. Fritz's feedback, results from every device, words
    if (pull && !error) {
      try {
        const prev = store.get(REMOTE_KV, {}) || {};
        const res = await target.pull(prev.cursor || {});
        if ('vocab-audio' in res.docs) {
          // its own key: a 175 kB index would be rewritten with every feedback change otherwise
          const { 'vocab-audio': index, ...rest } = res.docs;
          store.set(VOCAB_AUDIO_KV, index && typeof index === 'object' && !Array.isArray(index) ? index : null);
          res.docs = rest;
        }
        if (res.changed.length) store.set(REMOTE_KV, { ...prev, ...res.docs, cursor: res.cursor, fetchedAt: new Date(now()).toISOString() });
        else if (JSON.stringify(res.cursor) !== JSON.stringify(prev.cursor || {})) store.set(REMOTE_KV, { ...prev, cursor: res.cursor });
      } catch (e) { error = /** @type {any} */ (e).message || String(e); }
    }
    const status = { at: new Date(now()).toISOString(), ok, fail, error, pending: notSentCount(store) };
    store.set(STATUS_KV, status);
    emit?.('sync:status', { ...status, backup });
    return { ok, fail, pending: status.pending, error, backup };
  };
  const locked = typeof navigator !== 'undefined' && /** @type {any} */ (navigator).locks?.request
    ? /** @type {Promise<any>} */ (/** @type {any} */ (navigator).locks.request('outbox-flush', run))
    : run();
  flushing = locked.finally(() => { flushing = null; });
  return flushing;
}

/** For tests: forget the once-a-minute throttle. */
export const resetThrottle = () => { lastFlush = 0; flushing = null; };
