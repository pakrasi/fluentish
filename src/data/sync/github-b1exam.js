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

     read with the token: data/feedback.json, data/results.json, data/vocab.json, data/learner.json (optional)

   <stamp> is YYYYMMDDTHHMMSS in UTC, taken from the moment the event was created, so a retry writes the same file
   and a "422 sha" answer (the file already arrived) counts as sent. sync.py dedupes by path, so nothing is imported
   twice. sync.py splits a voice file stem on the first '-', which is why the stamp has no '-' in it.

   Voice blobs wait in the IDB blobs store (blobRef = the event id) and are deleted only after both PUTs succeed.
   Unsent items moved from the old app (attempts, corrections, words, word answers with synced:false) are sent from
   their collections with the path the old app already chose, or a new one.

   The network is injected (fetch), so node tests run the whole flow against a mock and against the real sync.py. */

export const TYPES = new Set(['exam.attempt', 'exam.voice', 'feedback.created', 'vocab.captured', 'vocab.reviewed', 'training.logged']);

const AUDIO_EXT = /** @type {Record<string, string>} */ ({ 'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/aac': 'aac' });

/** File extension for a recording's MIME type (the same table as the B1 exam app). @param {string} mime */
export const audioExt = mime => AUDIO_EXT[String(mime || '').split(';')[0].trim()] || 'bin';

/** 'YYYYMMDDTHHMMSS' in UTC. @param {Date | number} at */
export const stamp = at => new Date(at).toISOString().replace(/[-:]/g, '').slice(0, 15);

const pad2 = (/** @type {number | string} */ n) => String(n).padStart(2, '0');
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
    case 'exam.attempt': return `data/attempts/${s}-day${pad2(p.file.day)}-${p.file.module}.json`;
    case 'exam.voice': return safe(`data/voice/day${pad2(p.day)}/${s}-${p.module}-${p.part}`) + `.${audioExt(p.mime)}`;
    case 'feedback.created': return `data/feedback-ai/${s}-day${pad2(p.day)}-${p.module}.json`;
    case 'vocab.captured': return `data/vocab/${s}-${(p.word_key || wordKey(p.word)).slice(0, 24) || 'wort'}.json`;
    case 'vocab.reviewed': return `data/vocab-reviews/${s}-${safe(p.batch || 'batch')}.json`;
    case 'training.logged': return `data/training/${s}-${safe(p.task || 'text')}.json`;
    default: throw new Error(`github-b1exam: no file for ${type}`);
  }
}

/** The sidecar path of a voice file (same stem, .json). @param {string} audioPath */
export const sidecarPath = audioPath => audioPath.replace(/\.[^./]+$/, '.json');

/**
 * Append an event this target sends, with its path fixed now.
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
      return [{ path, body: json({ day: p.day, module: p.module, attempt_id: p.attempt_id ?? null, attempt_file: p.attempt_file ?? null, body: p.body, created_at: p.created_at, model: p.model ?? null }, 1), message: `Tag ${p.day} ${p.module}: Korrektur` }];
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

/** Base64 of UTF-8 text or a Blob's bytes. @param {string | Blob} body */
export async function toBase64(body) {
  const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : new Uint8Array(await body.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export class SyncError extends Error {
  /** @param {string} message @param {{status?: number, auth?: boolean, offline?: boolean}} [o] */
  constructor(message, { status = 0, auth = false, offline = false } = {}) { super(message); this.status = status; this.auth = auth; this.offline = offline; }
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

  return {
    put,
    /**
     * Send events in order. Stops at the first auth or connection error (the rest would fail the same way).
     * @param {any[]} events @returns {Promise<{acked: string[], rejected: {id: string, error: string}[], error: SyncError | null}>}
     */
    async push(events) {
      /** @type {string[]} */ const acked = [];
      /** @type {{id: string, error: string}[]} */ const rejected = [];
      for (const e of events) {
        if (!TYPES.has(e.type) || !e.path) { rejected.push({ id: e.id, error: 'not for this target' }); continue; }
        try {
          const blob = e.type === 'exam.voice' ? await getBlob(e.payload.blobRef || e.id) : null;
          for (const file of filesFor(e, blob)) await put(file);
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
     * Read what the Mac wrote. 304 keeps the cached doc; 404 means not there (yet).
     * @param {{etags?: Record<string, string>}} [cursor]
     * @returns {Promise<{cursor: {etags: Record<string, string>}, docs: Record<string, any>, changed: string[]}>}
     */
    async pull(cursor = {}) {
      const etags = { ...(cursor.etags || {}) };
      /** @type {Record<string, any>} */ const docs = {};
      /** @type {string[]} */ const changed = [];
      for (const name of ['feedback', 'results', 'vocab', 'learner']) {
        const p = `data/${name}.json`;
        /** @type {Record<string, string>} */ const h = { ...headers(), Accept: 'application/vnd.github.raw+json' };
        if (etags[name]) h['If-None-Match'] = etags[name];
        let r;
        try { r = await f(url(p), { headers: h, cache: 'no-store' }); } catch { throw new SyncError('No connection', { offline: true }); }
        if (r.status === 304) continue;
        if (r.status === 401 || r.status === 403) throw new SyncError('The GitHub token is invalid or expired', { status: r.status, auth: true });
        if (r.status === 404) { docs[name] = null; changed.push(name); delete etags[name]; continue; }
        if (!r.ok) continue;
        try { docs[name] = await r.json(); changed.push(name); } catch { continue; }
        const tag = r.headers.get('etag');
        if (tag) etags[name] = tag; else delete etags[name];
      }
      return { cursor: { etags }, docs, changed };
    },
  };
}

/* ---------- the flush, over the store ---------- */

const REMOTE_KV = 'exams.remote';
const STATUS_KV = 'exams.syncStatus';

/**
 * Unsent items moved from the old app, as send jobs with the path the old app chose (or a new one).
 * @param {any} store @returns {{key: string, event: any, done: () => void}[]}
 */
export function legacyJobs(store) {
  /** @type {{key: string, event: any, done: () => void}[]} */ const jobs = [];
  for (const a of store.attempts()) {
    if (!a.legacy || a.synced !== false || a.eventId) continue;
    const file = attemptFile(a);
    const path = a.legacy.path || pathFor('exam.attempt', { file }, Date.parse(a.submitted_at) || Date.now());
    jobs.push({ key: `attempt:${a.id}`, event: { id: `legacy:${a.id}`, type: 'exam.attempt', path, payload: { file: { ...file, id: a.legacy.id ?? file.id } } },
      done: () => store.putAttempts([{ ...a, synced: true, path }]) });
  }
  const list = (/** @type {string} */ name) => /** @type {any[]} */ (Array.isArray(store.get(name)) ? store.get(name) : []);
  const mark = (/** @type {string} */ name, /** @type {(x: any) => boolean} */ match, /** @type {string | null} */ path) =>
    store.update(name, (/** @type {any[]} */ xs) => (xs || []).map(x => (match(x) ? { ...x, synced: true, _path: path || x._path } : x)), []);
  for (const fb of list('exams.feedbackLocal')) {
    if (!fb || fb.synced !== false) continue;
    const payload = { day: fb.day, module: fb.module, attempt_id: fb.alias_id ?? fb.attempt_id, attempt_file: fb.attempt_file, body: fb.body, created_at: fb.created_at, model: fb.model };
    const path = fb._path || pathFor('feedback.created', payload, Date.parse(fb.created_at) || Date.now());
    jobs.push({ key: `fb:${fb.id}`, event: { id: `legacy:fb:${fb.id}`, type: 'feedback.created', path, payload }, done: () => mark('exams.feedbackLocal', x => x.id === fb.id, path) });
  }
  for (const w of list('vocab.local')) {
    if (!w || w.synced !== false) continue;
    const { synced, _path, ...rest } = w;
    const path = _path || pathFor('vocab.captured', rest, Date.parse(w.created_at) || Date.now());
    jobs.push({ key: `word:${w.id}`, event: { id: `legacy:word:${w.id}`, type: 'vocab.captured', path, payload: rest }, done: () => mark('vocab.local', x => x.id === w.id, path) });
  }
  const open = list('vocab.events').filter(e => e && e.synced === false);
  if (open.length) {
    const first = open[0];
    const payload = { batch: `legacy${open.length}`, events: open.map(({ synced, _path, ...rest }) => rest) };
    const path = pathFor('vocab.reviewed', payload, Date.parse(first.at) || Date.now());
    const ids = new Set(open);
    jobs.push({ key: 'vocab-events', event: { id: 'legacy:vocab-events', type: 'vocab.reviewed', path, payload },
      done: () => store.update('vocab.events', (/** @type {any[]} */ xs) => (xs || []).map(x => (x && x.synced === false && [...ids].some(o => o.at === x.at && o.word === x.word) ? { ...x, synced: true } : x)), []) });
  }
  return jobs;
}

/** Events this target sends that have not been acknowledged. @param {any} store */
export const pendingEvents = store => store.pending().filter((/** @type {any} */ e) => TYPES.has(e.type) && e.path);

/** "N not sent": events plus unsent items moved from the old app. @param {any} store */
export const notSentCount = store => pendingEvents(store).length + legacyJobs(store).length;

/**
 * An attempt record → the file body sync.py imports (the B1 exam app's attempt shape).
 * @param {any} a
 */
export function attemptFile(a) {
  const meta = { ...(a.meta || {}), source: 'remote' };
  return {
    id: a.id, day: a.day, module: a.module, started_at: a.started_at ?? null, submitted_at: a.submitted_at, duration_s: a.duration_s ?? null,
    score: a.score ?? null, max_score: a.max_score, meta,
    responses: (a.responses || []).map((/** @type {any} */ r) => ({ item_id: r.item_id, teil: r.teil, skill: r.skill, given: r.given ?? null, correct: r.correct, is_correct: r.is_correct ? 1 : 0 })),
    writings: (a.writings || []).map((/** @type {any} */ w) => ({ aufgabe: w.aufgabe, text: w.text ?? '', word_count: w.word_count ?? 0 })),
  };
}

let flushing = /** @type {Promise<any> | null} */ (null);
let lastFlush = 0;

/**
 * Send what is waiting and read what the Mac wrote. At most once a minute unless forced; one tab at a time.
 * @param {any} store
 * @param {{ repo: string, api?: string, fetch?: typeof fetch, force?: boolean, pull?: boolean, now?: () => number,
 *           emit?: (type: string, data: any) => void }} o
 * @returns {Promise<{ok: number, fail: number, pending: number, error: string | null, skipped?: boolean}>}
 */
export function syncResults(store, { repo, api, fetch: f, force = false, pull = true, now = Date.now, emit }) {
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
    let ok = 0, fail = 0;
    /** @type {string | null} */ let error = null;
    // 1. events in the outbox
    const events = pendingEvents(store);
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
      if (res.error) error = res.error.message;
      else if (res.rejected.length) error = res.rejected[0].error;
    }
    // 2. unsent items from the old app
    if (!error) {
      for (const job of legacyJobs(store)) {
        const r = await target.push([job.event]);
        if (r.acked.length) { job.done(); ok++; } else { fail++; error = r.rejected[0]?.error || 'not sent'; if (r.error) break; }
      }
    }
    // 3. Fritz's feedback, results from every device, words
    if (pull && !error) {
      try {
        const prev = store.get(REMOTE_KV, {}) || {};
        const res = await target.pull(prev.cursor || {});
        if (res.changed.length) store.set(REMOTE_KV, { ...prev, ...res.docs, cursor: res.cursor, fetchedAt: new Date(now()).toISOString() });
        else if (JSON.stringify(res.cursor) !== JSON.stringify(prev.cursor || {})) store.set(REMOTE_KV, { ...prev, cursor: res.cursor });
      } catch (e) { error = /** @type {any} */ (e).message || String(e); }
    }
    const status = { at: new Date(now()).toISOString(), ok, fail, error, pending: notSentCount(store) };
    store.set(STATUS_KV, status);
    emit?.('sync:status', status);
    return { ok, fail, pending: status.pending, error };
  };
  const locked = typeof navigator !== 'undefined' && /** @type {any} */ (navigator).locks?.request
    ? /** @type {Promise<any>} */ (/** @type {any} */ (navigator).locks.request('outbox-flush', run))
    : run();
  flushing = locked.finally(() => { flushing = null; });
  return flushing;
}

/** For tests: forget the once-a-minute throttle. */
export const resetThrottle = () => { lastFlush = 0; flushing = null; };
