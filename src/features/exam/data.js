/* Exam data: everything the exam screens and the Today provider read and write, over the store. No DOM.

   Collections (kv, profile scope):
     exams.drafts          { "N:module": {answers, start, pause, seen, tab, meta}, "plays:N": {id: {used}} }   (shape moved from the old app)
     exams.feedbackLocal   one-click corrections made here; a feedback.created event sends each one
     exams.seen            ids of feedback rows already read
     exams.remote          what the Mac wrote (feedback.json, results.json, vocab.json, learner.json) + ETags
     exams.syncStatus      the last flush
     exams.learnerNotes    private notes for the corrector (fills the grader prompt's {learner_profile})
     mistakes.inbox        corrections waiting to become Practice cards (hand-off; see README in this folder)
   Attempts live in the attempts store; each new one also gets an exam.attempt event whose file path is fixed then. */
import { uuidv7, isoWithOffset } from '../../data/ids.js';
import { config } from '../../core/config.js';
import { appendResult, attemptFile, pathFor, syncResults, notSentCount, audioExt } from '../../data/sync/github-b1exam.js';
import { latestByTestModule, fbSplit, stampMs, wordCount, corrections, attemptIds } from '../../domain/grade.js';
import * as T from './timer.js';

export const MODS = ['lesen', 'hoeren', 'schreiben', 'sprechen'];
export const pad2 = (/** @type {number} */ n) => String(n).padStart(2, '0');

/* ---------- content ---------- */

/** The exam the profile prepares for (manifest entry) or null. @param {any} ctx */
export async function examDef(ctx) {
  const s = ctx.settings();
  if (!s.exam.type) return null;
  return ctx.content.exam(s.exam.type).catch(() => null);
}
/** One mock test. @param {any} ctx @param {any} exam @param {number} n */
export const loadTest = (ctx, exam, n) => ctx.content.load(`exam.${exam.id}.${pad2(n)}`);
/** The "Warum?" explanations of a test, or {} when there are none. @param {any} ctx @param {any} exam @param {number} n */
export const loadWhy = (ctx, exam, n) => ctx.content.load(`exam.${exam.id}.why.${pad2(n)}`).catch(() => ({}));
/** Audio for a test from the exam's media base (manifest). @param {any} exam @param {number} n @param {string} file */
export const mediaUrl = (exam, n, file) => `${exam.media}day${pad2(n)}/${file}`;
/** The manifest version, stored with each attempt. @param {any} ctx */
export const contentVersion = async ctx => (await ctx.content.manifest().catch(() => null))?.version ?? null;

/* ---------- attempts: this device + every device (results.json) ---------- */

/** @param {any} store */
const remote = store => store.get('exams.remote', {}) || {};

/**
 * All attempts of an exam: the ones in the store (with the Mac's id as alias once it imported them) and the ones the
 * Mac knows from other devices (results.json, latest per test and module).
 * @param {any} store @param {string} examId @returns {any[]}
 */
export function allAttempts(store, examId) {
  const results = remote(store).results?.days || {};
  /** @type {Map<string, any>} */ const byFile = new Map();
  for (const [day, d] of Object.entries(results)) {
    for (const x of /** @type {any} */ (d).all || []) if (x.file) byFile.set(x.file, { ...x, day: Number(day) });
  }
  const local = store.attempts().filter((/** @type {any} */ a) => a.examId === examId && !a.deletedAt).map((/** @type {any} */ a) => {
    const file = a.path || a.legacy?.path;
    const mac = file ? byFile.get(file) : null;
    return mac ? { ...a, alias: mac.id } : a;
  });
  const known = new Set(local.flatMap((/** @type {any} */ a) => [a.path, a.legacy?.path].filter(Boolean)));
  const knownIds = new Set(local.flatMap(attemptIds));
  const others = [];
  for (const [day, d] of Object.entries(results)) {
    for (const [module, a] of Object.entries(/** @type {any} */ (d).attempts || {})) {
      const x = /** @type {any} */ (a);
      if (!x || (x.file && known.has(x.file)) || knownIds.has(String(x.id))) continue;
      others.push({ ...x, id: `mac-${x.id}`, alias: x.id, day: Number(day), module, remote: true, source: x.source || 'mac', responses: x.responses || [], writings: x.writings || [] });
    }
  }
  return [...local, ...others];
}

/** The latest attempt per test and module. @param {any} store @param {string} examId */
export const latest = (store, examId) => latestByTestModule(allAttempts(store, examId));

/** @param {any} store @param {string} examId @param {string} id */
export const findAttempt = (store, examId, id) => allAttempts(store, examId).find(a => String(a.id) === String(id)) || null;

/* ---------- feedback: Fritz's (feedback.json) and corrections made here ---------- */

/** @param {any} store @returns {any[]} */
export function allFeedback(store) {
  const mac = remote(store).feedback?.feedback || [];
  const same = (/** @type {any} */ a, /** @type {any} */ b) => a.day === b.day && a.module === b.module && String(a.body || '').trim() === String(b.body || '').trim();
  const seen = new Set(store.get('exams.seen', []) || []);
  const local = (store.get('exams.feedbackLocal', []) || []).filter((/** @type {any} */ l) => l && !mac.some((/** @type {any} */ m) => same(m, l)));
  return [...mac, ...local].map(f => ({ ...f, seen: seen.has(f.id) }));
}

/** @param {any} store @param {any[]} ids */
export function markSeen(store, ids) {
  if (!ids.length) return;
  store.update('exams.seen', (/** @type {any[]} */ xs) => [...new Set([...(xs || []), ...ids])], []);
}

/** Feedback for one attempt, split into current and older. @param {any} store @param {string} examId @param {any} a */
export function feedbackFor(store, examId, a) {
  return fbSplit(allFeedback(store).filter(f => f.day === a.day), a.module, a, allAttempts(store, examId).filter(x => x.day === a.day));
}

/* ---------- drafts and clocks ---------- */

/** @param {any} store */
const drafts = store => store.get('exams.drafts', {}) || {};

/**
 * One module's draft, with the clock fields of drafts moved from the old app normalised
 * (Sprechen kept its clock under prepStart / prep:pause / prep:seen).
 * @param {any} store @param {number} n @param {string} module
 */
export function draft(store, n, module) {
  const d = drafts(store)[`${n}:${module}`];
  if (!d) return null;
  const clock = T.normalize({ start: d.start ?? d.prepStart, pause: d.pause ?? d['prep:pause'], seen: d.seen ?? d['prep:seen'] });
  return { answers: d.answers ?? null, tab: d.tab || 0, meta: d.meta || {}, clock };
}

/** Write part of a draft (answers, tab, meta or clock). Written through to IndexedDB at once. @param {any} store @param {number} n @param {string} module @param {{answers?: any, tab?: number, meta?: any, clock?: T.Clock | null}} patch */
export function saveDraft(store, n, module, patch) {
  store.update('exams.drafts', (/** @type {any} */ all) => {
    const k = `${n}:${module}`;
    const cur = { ...((all || {})[k] || {}) };
    if ('answers' in patch) cur.answers = patch.answers;
    if ('tab' in patch) cur.tab = patch.tab;
    if ('meta' in patch) cur.meta = patch.meta;
    if ('clock' in patch) {
      delete cur.prepStart; delete cur['prep:pause']; delete cur['prep:seen'];
      if (patch.clock) { cur.start = patch.clock.start; cur.pause = patch.clock.pause; cur.seen = patch.clock.seen; } else { delete cur.start; delete cur.pause; delete cur.seen; }
    }
    return { ...(all || {}), [k]: cur };
  }, {});
}

/** Drop a module's draft and, for Hören, its play counts. @param {any} store @param {number} n @param {string} module */
export function clearDraft(store, n, module) {
  store.update('exams.drafts', (/** @type {any} */ all) => {
    const next = { ...(all || {}) };
    delete next[`${n}:${module}`];
    if (module === 'hoeren') delete next[`plays:${n}`];
    return next;
  }, {});
}

/** Started (clock running or answers saved) and not yet submitted. @param {any} store @param {number} n @param {string} module */
export function isStarted(store, n, module) {
  const d = draft(store, n, module);
  return !!(d && (d.clock || d.answers != null));
}

/** Plays used per recording of a test. @param {any} store @param {number} n @returns {Record<string, {used: number}>} */
export const plays = (store, n) => drafts(store)[`plays:${n}`] || {};
/** @param {any} store @param {number} n @param {string} id */
export function usePlay(store, n, id) {
  store.update('exams.drafts', (/** @type {any} */ all) => {
    const k = `plays:${n}`;
    const p = { ...((all || {})[k] || {}) };
    p[id] = { ...(p[id] || { used: 0 }), used: ((p[id] || {}).used || 0) + 1 };
    return { ...(all || {}), [k]: p };
  }, {});
}

/* ---------- submitting ---------- */

/**
 * Store a submitted attempt and queue it for the results sync. Returns the record.
 * @param {any} ctx
 * @param {{ exam: any, n: number, module: string, clock: T.Clock, now?: number, score?: number | null, maxScore: number,
 *           responses?: any[], writings?: any[], meta?: any }} o
 */
export async function submitAttempt(ctx, { exam, n, module, clock, now = Date.now(), score = null, maxScore, responses = [], writings = [], meta = {} }) {
  const { store, app } = ctx;
  const at = new Date(now);
  const rec = {
    id: uuidv7(now), profileId: store.profile.id, deviceId: app?.device?.deviceId || store.device?.deviceId || null, createdAt: isoWithOffset(at),
    examId: exam.id, contentVersion: await contentVersion(ctx),
    day: n, module, started_at: isoWithOffset(new Date(clock.start)), submitted_at: isoWithOffset(at),
    duration_s: Math.round(T.elapsed(clock, now) / 1000), score, max_score: maxScore,
    meta: { ...meta, pauses: T.pauses(clock, now) }, responses, writings, synced: false,
  };
  const e = appendResult(store, 'exam.attempt', { attemptId: rec.id, file: attemptFile(rec) }, at);
  const saved = { ...rec, eventId: e.id, path: e.path };
  store.putAttempts([saved]);
  clearDraft(store, n, module);
  const day = ctx.clock.today();
  store.update('activity', (/** @type {any} */ a) => {
    const x = { minutes: 0, rounds: 0, ...((a || {})[day] || {}) };
    x.minutes += Math.max(1, Math.round(saved.duration_s / 60));
    return { ...(a || {}), [day]: x };
  }, {});
  sync(ctx, true);
  return saved;
}

/** Schreiben texts → writings rows. @param {Record<string, string>} texts */
export const writingsOf = texts => ['aufgabe1', 'aufgabe2', 'aufgabe3'].map(k => ({ aufgabe: k, text: texts[k] || '', word_count: wordCount(texts[k]) }));

/* ---------- recordings ---------- */

/**
 * Keep a recording: the blob goes to IndexedDB first, then a voice event with its path; the upload is retried until
 * both files are in the repository. Returns the event.
 * @param {any} ctx @param {{n: number, part: string, label: string, blob: Blob, mime: string, now?: number}} o
 */
export async function saveRecording(ctx, { n, part, label, blob, mime, now = Date.now() }) {
  const { store } = ctx;
  const blobRef = uuidv7(now);
  await store.adapter.putBlob(blobRef, blob);
  const e = appendResult(store, 'exam.voice', { day: n, module: 'sprechen', part, label, mime, bytes: blob.size, created_at: isoWithOffset(new Date(now)), blobRef, ext: audioExt(mime) }, new Date(now));
  sync(ctx, true);
  return e;
}

/**
 * Recordings of a test: made here (events; the blob while not yet sent), moved from the old app, and known to the Mac
 * (with transcripts).
 * @param {any} store @param {number} n @returns {{ id: string, part: string, created_at: string, blobRef?: string, sent: boolean, transcript?: string | null, label?: string }[]}
 */
export function recordings(store, n) {
  const out = [];
  const macVoice = (remote(store).results?.days?.[String(n)]?.voice || []).filter((/** @type {any} */ v) => v.module === 'sprechen');
  const transcriptFor = (/** @type {string} */ created) => macVoice.find((/** @type {any} */ v) => Math.abs(stampMs(v.created_at) - stampMs(created)) < 5000)?.transcript || null;
  for (const e of store.events.values()) {
    if (e.type !== 'exam.voice' || e.payload.day !== n) continue;
    out.push({ id: e.id, part: e.payload.part, label: e.payload.label, created_at: e.payload.created_at, blobRef: e.synced ? undefined : e.payload.blobRef, sent: !!e.synced, transcript: transcriptFor(e.payload.created_at) });
  }
  for (const v of store.get('exams.voice', []) || []) {
    if (!v || v.day !== n || v.module !== 'sprechen') continue;
    out.push({ id: String(v.id), part: v.part, label: v.label, created_at: v.created_at, sent: true, transcript: transcriptFor(v.created_at) });
  }
  const mine = new Set(out.map(x => Math.round(stampMs(x.created_at) / 5000)));
  for (const v of macVoice) {
    if (mine.has(Math.round(stampMs(v.created_at) / 5000))) continue;
    out.push({ id: `mac-${v.created_at}`, part: v.part, created_at: v.created_at, sent: true, transcript: v.transcript || null });
  }
  return out.sort((a, b) => stampMs(a.created_at) - stampMs(b.created_at));
}

/* ---------- corrections made here ---------- */

/**
 * Keep a one-click correction: shown at once, sent as data/feedback-ai/*.json, attached to its attempt by the Mac.
 * @param {any} ctx @param {{ attempt: any, body: string, model: string | null, now?: number }} o
 */
export function saveCorrection(ctx, { attempt, body, model, now = Date.now() }) {
  const { store } = ctx;
  const at = new Date(now);
  const f = {
    id: `local-${uuidv7(now)}`, day: attempt.day, module: attempt.module, attempt_id: attempt.alias ?? attempt.legacy?.id ?? attempt.id,
    attempt_file: attempt.path || attempt.legacy?.path || attempt.file || null, body, created_at: isoWithOffset(at), model, source: 'fritz-app',
  };
  const e = appendResult(store, 'feedback.created', { day: f.day, module: f.module, attempt_id: f.attempt_id, attempt_file: f.attempt_file, body, created_at: f.created_at, model }, at);
  store.update('exams.feedbackLocal', (/** @type {any[]} */ xs) => [...(xs || []), { ...f, eventId: e.id }], []);
  sync(ctx, true);
  return f;
}

/** Private notes for the corrector: this profile's setting, else data/learner.json from the results repository. @param {any} store */
export function learnerNotes(store) {
  const own = store.get('exams.learnerNotes', null);
  if (typeof own === 'string' && own.trim()) return own;
  const l = remote(store).learner;
  return (l && (l.notes || l.grader_notes || l.learner_profile)) || null;
}

/* ---------- mistakes → Practice (hand-off) ---------- */

/**
 * Corrections in a feedback body become items for Practice. Practice turns each into an `f:` card and removes it
 * from the inbox (see README.md in this folder). Ids are stable, so pressing the button twice adds nothing.
 * @param {any} store @param {{ attempt: any, feedback: any }} o @returns {number} how many are waiting for that attempt
 */
export function queueMistakes(store, { attempt, feedback }) {
  const items = corrections(feedback.body).map((c, i) => ({
    id: `f:${attempt.id}-${i + 1}`, kind: 'correction', language: 'german', wrong: c.wrong, right: c.right, rule: c.rule,
    source: { examId: attempt.examId || null, test: attempt.day, module: attempt.module, attemptId: attempt.id, feedbackId: feedback.id },
    createdAt: isoWithOffset(new Date()),
  }));
  const next = store.update('mistakes.inbox', (/** @type {any[]} */ xs) => {
    const have = new Set((xs || []).map(x => x.id));
    return [...(xs || []), ...items.filter(x => !have.has(x.id))];
  }, []);
  return next.filter((/** @type {any} */ x) => x.source?.attemptId === attempt.id).length;
}

/** How many mistakes of this attempt are in the inbox or already cards. @param {any} store @param {any} attempt */
export function mistakesQueued(store, attempt) {
  const inbox = (store.get('mistakes.inbox', []) || []).filter((/** @type {any} */ x) => x.source?.attemptId === attempt.id).length;
  const cards = Object.keys(store.cards('b1')).filter(k => k.startsWith(`f:${attempt.id}-`)).length;
  return inbox + cards;
}

/* ---------- sync ---------- */

/** Flush the outbox and read the Mac's files (at most once a minute unless forced). @param {any} ctx @param {boolean} [force] */
export function sync(ctx, force = false) {
  return syncResults(ctx.store, { repo: config.resultsRepo, api: config.github.api, force, emit: (t, d) => ctx.bus?.emit(t, d) })
    .catch((/** @type {any} */ e) => ({ ok: 0, fail: 0, pending: notSentCount(ctx.store), error: String(e?.message || e) }));
}

export { notSentCount, pathFor };

/** Whether this device is linked to the results repository. @param {any} store */
export const linked = store => !!(store.get('secrets', {}) || {}).githubToken;
