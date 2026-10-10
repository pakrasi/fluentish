/* The restore journal at start, and the other small parts of restore that boot and the Profile screen read, without
   the merge engine (data/restore.js, which re-exports all of these).

   Every start reads the device kv 'backup.journal' before the store opens. It is almost always absent or 'done', and
   then nothing else loads. Only a restore or an undo that was cut off ('applying' or 'undoing': the tab was closed or
   iOS killed it mid-way) loads data/restore.js, whose recoverRestore() puts it right, as it always has. restore.js
   pulls in the card merge, the word-family rules and the backup format, so keeping it out of the boot graph saves the
   phone their download and compile on every launch (tests/unit/boot-graph.test.mjs).

   When the recovery is needed and restore.js cannot be loaded, the start fails: opening the store over a
   half-applied restore would let new answers land on records a later recovery puts back. */

import * as B from './sync/backup.js';

export const JOURNAL_KV = 'backup.journal';

/** The journal stages a start must finish before the store opens. */
export const CUT_OFF = /** @type {const} */ (['applying', 'undoing']);

/** @param {any} adapter @returns {Promise<any>} the journal, or null */
export const readJournal = async adapter => (await adapter.loadScope('device'))[JOURNAL_KV] || null;

/**
 * At start, before the store opens: a restore that was cut off is rolled back; an undo that was cut off is finished
 * (data/restore.js recoverRestore). Loads restore.js only then.
 * @param {any} adapter @param {string} profileId
 * @param {() => Promise<{recoverRestore: (adapter: any, profileId: string) => Promise<'rolledBack' | 'undone' | null>}>} [load]
 * @returns {Promise<'rolledBack' | 'undone' | null>} throws an error with `fatal: true` when restore.js did not load
 */
export async function recoverIfCutOff(adapter, profileId, load = () => import('./restore.js')) {
  const j = await readJournal(adapter);
  if (!j || j.profileId !== profileId || !CUT_OFF.includes(j.stage)) return null;
  let mod;
  try { mod = await load(); } catch (e) { throw Object.assign(new Error('a cut-off restore needs data/restore.js, which did not load', { cause: e }), { fatal: true }); }
  return mod.recoverRestore(adapter, profileId);
}

/* ---------- read without the merge engine ---------- */

/** Whether the automatic merge is on (a one-time opt-in per device, kv 'backup'.autoMerge). @param {any} store */
export const autoMergeOn = store => !!B.state(store).autoMerge;
/** @param {any} store @param {boolean} on @param {() => number} [now] */
export const setAutoMerge = (store, on, now = Date.now) => B.setState(store, { autoMerge: on ? { since: new Date(now()).toISOString() } : null });

/** A device's first and last day, and how many days of events. @param {import('./restore.js').DeviceBackup} d */
export function span(d) {
  const days = [...new Set([...d.events, ...d.snapshots].map(f => f.day))].sort();
  return { first: days[0] || null, last: days[days.length - 1] || null, eventDays: d.events.length, snapshot: d.snapshots[d.snapshots.length - 1]?.day || null };
}
