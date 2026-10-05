/* The sync seam (ARCHITECTURE §3.2; roadmap item 3). Features record results and ask for a flush here and never name a
   transport, so a server target (phase 4) can replace the private results repository without touching them.

     results(store).record(type, payload, at?)   append a result event (exam.attempt, exam.voice, feedback.created,
                                                 vocab.captured, vocab.reviewed, training.logged); returns the event
     results(store).ref(event)                   the name the target files it under (today: its repository path,
                                                 which sync.py links corrections to their attempt with)
     results(store).notSent() / legacyCount() / allowLegacy() / uploadsAllowed()
     sync(store, {force, pull, emit, fetch})     send what is waiting, back up progress, read what the Mac wrote

   A SyncTarget implements
     push(events) → {acked: id[], rejected: [{id, error}], error: {message, auth?, offline?} | null}
     pull(cursor) → {cursor, docs, changed}         the cursor is opaque to callers
   and names its own files: an event created here stores no path (path: null); the GitHub target derives it from the
   event's type, payload and time (github-b1exam.js pathOf). Events from before the seam keep the path they stored,
   and that stored path is what is used for them. */
import { config } from '../../core/config.js';
import * as GH from './github-b1exam.js';
import * as B from './backup.js';
import * as R from '../restore.js';

/**
 * @typedef {{acked: string[], rejected: {id: string, error: string}[], error: {message: string, auth?: boolean, offline?: boolean} | null}} PushResult
 * @typedef {{cursor: any, docs: Record<string, any>, changed: string[]}} PullResult
 * @typedef {{push: (events: any[]) => Promise<PushResult>, pull: (cursor?: any) => Promise<PullResult>,
 *            files?: import('./backup.js').Files}} SyncTarget  files: the target's own files (progress backup)
 */

/** Result types: what the results target files. Learning events (card.*, settings.changed) are backed up instead. */
export const RESULT_TYPES = GH.TYPES;

/** File extension for a recording's MIME type. */
export const audioExt = GH.audioExt;

/** An attempt record as the exam.attempt payload's `file` (the B1 exam app's attempt shape, which sync.py imports). */
export const attemptFile = GH.attemptFile;

/**
 * The name a result event is filed under: its stored path (events from before the seam), else the one the target
 * derives. null for events the target does not send.
 * @param {{type: string, payload: Record<string, any>, at: string, path?: string | null}} e
 */
export const ref = e => GH.pathOf(e);

/**
 * The results API over one store.
 * @param {any} store
 */
export function results(store) {
  return {
    /**
     * Append a result event. Its file name comes from the target (ref), so nothing transport-specific is stored.
     * @param {string} type @param {Record<string, any>} payload @param {Date} [at]
     */
    record(type, payload, at = new Date()) {
      if (!RESULT_TYPES.has(type)) throw new Error(`results.record: ${type} is not a result`);
      return store.append(type, payload, { at, path: null });
    },
    ref,
    /** Results not yet acknowledged: events plus unsent items moved from the old app ("N not sent"). */
    notSent: () => GH.notSentCount(store),
    /** Unsent items moved from the old app. */
    legacyCount: () => GH.legacyJobs(store).length,
    /** The learner's one tap that lets the old app's unsent items go. */
    allowLegacy: () => GH.allowLegacy(store),
    uploadsAllowed: () => GH.uploadsAllowed(store),
  };
}

/**
 * Flush: send results, back up progress, read what the Mac wrote. At most once a minute unless forced; one tab at a
 * time; skips by itself when the device is not linked or the profile is a preview.
 * @param {any} store
 * @param {{force?: boolean, pull?: boolean, emit?: (type: string, data: any) => void, fetch?: typeof fetch, now?: () => number,
 *          backupNow?: boolean}} [o]  backupNow: "Back up now" (events and a snapshot, whatever their cadence)
 */
export function sync(store, { force = false, pull = true, emit, fetch: f, now, backupNow = false } = {}) {
  return GH.syncResults(store, { repo: config.resultsRepo, api: config.github.api, force: force || backupNow, pull, emit, fetch: f, now, backupNow, build: config.build });
}

/**
 * The GitHub target's own files, for the backup and the restore (data/restore.js). Not for features.
 * @param {any} store @param {{fetch?: typeof fetch}} [o]
 */
export function backupFiles(store, { fetch: f } = {}) {
  return GH.createGithubB1Exam({ token: () => (store.get('secrets', {}) || {}).githubToken || null, repo: config.resultsRepo, api: config.github.api, fetch: f }).files;
}

/**
 * The progress backup over one store (data/sync/backup.js): what Profile › Data shows and switches.
 * @param {any} store
 */
export function backup(store) {
  return {
    /** Whether this device links to the results repository (the backup goes there). */
    linked: () => !!(store.get('secrets', {}) || {}).githubToken,
    /** Uploads may start (an import notice has been seen); the backup waits like the results do. */
    allowed: () => GH.uploadsAllowed(store) && store.profile?.kind !== 'shadow',
    on: () => B.backupOn(store),
    /** @param {boolean} v */
    setOn: v => B.setState(store, { on: !!v }),
    /** Learning events not yet backed up. */
    waiting: () => B.waiting(store),
    /** {at, error, snapshot: {day, at, cards}} of the last run on this device. */
    state: () => B.state(store),
    repo: config.resultsRepo,
  };
}

/** Run fn with the restore lock (one tab at a time), where the browser has Web Locks. @template T @param {() => Promise<T>} fn @returns {Promise<T>} */
const locked = fn => (typeof navigator !== 'undefined' && /** @type {any} */ (navigator).locks?.request
  ? /** @type {Promise<T>} */ (/** @type {any} */ (navigator).locks.request('backup-restore', fn)) : fn());

/**
 * Restore from the backup and the automatic merge (data/restore.js), over one store.
 * @param {any} store @param {{fetch?: typeof fetch}} [o]
 */
export function restore(store, { fetch: f } = {}) {
  const files = () => backupFiles(store, { fetch: f });
  return {
    /**
     * Read the backup and plan the merge: the devices and days found, the data, and the counts a restore would
     * change. Changes nothing.
     * @param {(done: number, total: number) => void} [onProgress]
     */
    async find(onProgress) {
      const devices = await R.listBackups(files());
      const data = await R.readBackups(files(), devices, { onProgress });
      return { devices, data, plan: R.planRestore(store, data) };
    },
    /**
     * Apply what find() read. The plan is made again now, from the cards as they are now, so an answer given
     * while the preview was open is never undone by it.
     * @param {R.BackupData} data @param {string[]} [sources]
     */
    apply: (data, sources) => locked(() => R.applyRestore(store, R.planRestore(store, data), { kind: 'restore', sources })),
    undo: () => locked(() => R.undoRestore(store)),
    last: () => R.lastRestore(store),
    autoMergeOn: () => R.autoMergeOn(store),
    /** @param {boolean} v */
    setAutoMerge: v => R.setAutoMerge(store, v),
    /** The automatic merge (only after the opt-in, at most every 30 minutes unless forced). @param {{force?: boolean}} [o] */
    merge: (o = {}) => (backup(store).linked() ? locked(() => R.autoMerge(store, files(), o)) : Promise.resolve(null)),
    span: R.span,
  };
}
