/* The bounded outbox (roadmap item 2). The outbox holds every event the store loads at start; without a bound it grew
   with every answer. Events that need nothing more and are older than ARCHIVE_AFTER_DAYS move to the IDB `archive`
   store (adapters/idb.js, version 2): nothing is deleted, Export still includes them, and the start loads only what
   is pending or recent.

   An event moves when it is older than 30 days (by `at`) and
     - a sync target acknowledged it (synced: true), or
     - no target ever sends it (reviews marked local in Script mode, legacy.imported): it is not pending anywhere.
   It stays while a target would still send it (not linked, backup off, offline: it is pending), and exam.voice
   events stay (the Exam tab lists the recordings made here from them). */
import { pathOf } from './sync/github-b1exam.js';
import { backupable } from './sync/backup.js';

export const ARCHIVE_AFTER_DAYS = 30;
const DAY_MS = 86400e3;

/** Whether an event may leave the outbox. @param {any} e @param {number} now */
export function archivable(e, now) {
  if (!e || e.type === 'exam.voice') return false;
  const at = Date.parse(e.at);
  if (!Number.isFinite(at) || now - at <= ARCHIVE_AFTER_DAYS * DAY_MS) return false;
  if (e.synced) return true;
  return !pathOf(e) && !backupable(e);
}

/**
 * Move what may go to the archive. Returns how many moved; a failure leaves everything where it was.
 * @param {any} store @param {number} [now]
 */
export async function archiveOld(store, now = Date.now()) {
  const list = [...store.events.values()].filter(e => archivable(e, now));
  try { return await store.archive(list); } catch (e) { console.error('outbox: archive failed, kept as it is', e); return 0; }
}
