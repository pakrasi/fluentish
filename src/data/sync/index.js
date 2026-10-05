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

/**
 * @typedef {{acked: string[], rejected: {id: string, error: string}[], error: {message: string, auth?: boolean, offline?: boolean} | null}} PushResult
 * @typedef {{cursor: any, docs: Record<string, any>, changed: string[]}} PullResult
 * @typedef {{push: (events: any[]) => Promise<PushResult>, pull: (cursor?: any) => Promise<PullResult>}} SyncTarget
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
 * @param {{force?: boolean, pull?: boolean, emit?: (type: string, data: any) => void, fetch?: typeof fetch, now?: () => number}} [o]
 */
export function sync(store, { force = false, pull = true, emit, fetch: f, now } = {}) {
  return GH.syncResults(store, { repo: config.resultsRepo, api: config.github.api, force, pull, emit, fetch: f, now });
}
