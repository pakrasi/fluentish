/* Boot-time data: the device record, the active profile, the one-time legacy migration, and the open store.

   First run on a device:
     - legacy progress in localStorage → a profile is created from it (migration), onboarding is skipped, and the
       import summary is shown once on Today
     - nothing to move → an empty profile; the router sends it to onboarding (#/welcome)
   Later runs open the active profile. Profiles are local today (kind 'local'); 'shadow' marks a preview copy that
   must never sync (review A3); 'remote' arrives with accounts.

   Leaving shadow mode (docs/CUTOVER.md): a device that opened the live preview has a shadow profile with real study
   work in it. On the first local boot keepPreview() keeps the real profile (or makes it and runs the legacy import,
   read-only on the legacy keys), merges every preview profile into it (data/cutover.js), reads the result back, and
   only then archives the preview; purgeArchived() removes it 30 days later. device.cutover records the step before
   anything is written, so a boot that was cut off resumes, and a finished cutover leaves nothing to do. */
import { Store } from './store.js';
import { uuidv7, isoWithOffset, newDeviceId, createHlc } from './ids.js';
import { readLegacy, hasLegacyProgress, planMigration, applyMigration } from './migrate.js';
import { planPreviewMerge, legacyChangedSince, deviceMerge, purgeArchived, canon } from './cutover.js';
import { recoverRestore } from './restore.js';
import { archiveOld } from './archive.js';
import { normalizeSettings } from './settings.js';

/**
 * @param {object} o
 * @param {any} o.adapter
 * @param {Pick<Storage, 'length' | 'key' | 'getItem'> | null} o.legacyStorage  localStorage (read only), or null
 * @param {{ today: () => string }} o.clock
 * @param {any} [o.bus]
 * @param {() => BroadcastChannel | null} [o.channel]
 * @param {() => Date} [o.now]
 * @param {'local' | 'shadow'} [o.kind]
 */
export async function openSession({ adapter, legacyStorage, clock, bus, channel = () => null, now = () => new Date(), kind = 'local' }) {
  let device = await adapter.getDevice();
  if (!device) { device = { deviceId: newDeviceId(), activeProfile: null, seq: 0, createdAt: isoWithOffset(now()) }; await adapter.putDevice(device); }

  // archived preview profiles (kept 30 days after the cutover) are never opened; the expired ones are purged
  let profiles = (await purgeArchived(adapter, await adapter.listProfiles(), now())).filter((/** @type {any} */ p) => !p.archivedAt);
  // A migration that was cut off (the tab closed, iOS killed it, the disk was full) left a half-filled profile. If
  // nothing was done in it since, it is removed and the migration runs again from the legacy keys, which it never
  // touched. A profile that was used is kept as it is.
  if (device.migrating) {
    const half = profiles.find((/** @type {any} */ p) => p.id === device.migrating);
    if (half && !(await adapter.loadProfile(half.id)).outbox.length) {
      await adapter.deleteProfile(half.id);
      profiles = profiles.filter((/** @type {any} */ p) => p.id !== half.id);
      if (device.activeProfile === half.id) device.activeProfile = null;
    }
    delete device.migrating;
    await adapter.putDevice(device);
  }
  // Leaving shadow mode: the preview's work is merged into the real profile, then the preview is archived.
  /** @type {any} */ let previewKept = null;
  /** @type {any} */ let cutoverMigration = null;
  let cutoverError = null;
  const current = profiles.find((/** @type {any} */ p) => p.id === device.activeProfile) || profiles[0] || null;
  if (kind === 'local' && (device.cutover || current?.kind === 'shadow')) {
    const r = await keepPreview({ adapter, device, profiles, legacyStorage, now });
    previewKept = r.kept;
    cutoverMigration = r.migration;
    cutoverError = r.error;
    profiles = (await adapter.listProfiles()).filter((/** @type {any} */ p) => !p.archivedAt);
  }
  /** @type {any} */ let profile = profiles.find((/** @type {any} */ p) => p.id === device.activeProfile) || profiles[0] || null;
  /** @type {any} */ let migration = cutoverMigration;

  if (!profile) {
    // once per device (until "Delete all", which forgets the marker so a fresh import is possible)
    const snap = legacyStorage && !device.migratedAt ? readLegacy(legacyStorage) : {};
    profile = { id: uuidv7(now().getTime()), name: '', kind, createdAt: isoWithOffset(now()), remoteId: null };
    const legacy = hasLegacyProgress(snap);
    if (legacy) { device.migrating = profile.id; await adapter.putDevice(device); }   // marker first: see above
    await adapter.putProfile(profile);
    if (legacy) {
      const plan = planMigration(snap, { profileId: profile.id, deviceId: device.deviceId, now: now() });
      if (plan.kv.meta.legacyDeviceId && !device.legacyDeviceId) device.legacyDeviceId = plan.kv.meta.legacyDeviceId;
      await applyMigration(adapter, plan, profile);
      device.migratedAt = plan.kv.meta.migratedAt;
      device.migratedKind = kind;
      delete device.migrating;
      migration = plan.summary;
    }
    device.activeProfile = profile.id;
    await adapter.putDevice(device);
  } else if (device.activeProfile !== profile.id) {
    device.activeProfile = profile.id;
    await adapter.putDevice(device);
  }

  // a restore from the backup that was cut off is put back before anything reads the cards (data/restore.js)
  /** @type {'rolledBack' | 'undone' | null} */ let restoreRecovered = null;
  try { restoreRecovered = await recoverRestore(adapter, profile.id); } catch (e) { console.error('restore recovery failed', e); }
  const store = await Store.open({ adapter, profile, device, clock, bus, channel: channel() });
  // the bounded outbox: acknowledged events older than 30 days move to the archive (data/archive.js), so later
  // starts load only what is pending or recent
  await archiveOld(store, now().getTime());
  migrateCourses(store);
  const hlc = createHlc(device.deviceId);
  if (migration) store.append('legacy.imported', { summary: migration });
  return { store, profile, device, hlc, migration, previewKept, cutoverError, restoreRecovered, profiles: (await adapter.listProfiles()).filter((/** @type {any} */ p) => !p.archivedAt) };
}

/**
 * Leaving shadow mode, keeping the preview's work. Steps (device.cutover.stage), each recorded before it writes:
 *   start     make the real profile and run the legacy import into it (or keep a local profile that exists)
 *   imported  merge each preview into it, read the result back, archive that preview
 * A boot cut off in 'start' removes the half-made real profile (nothing of the preview is in it yet) and imports
 * again; one cut off in 'imported' merges again, which changes only what the first try did not write.
 * A merge that cannot be read back leaves the preview as it is, opens the real profile and tries again next time.
 * @param {{adapter: any, device: any, profiles: any[], legacyStorage: any, now: () => Date}} o
 * @returns {Promise<{kept: any, migration: any, error: string | null}>}
 */
async function keepPreview({ adapter, device, profiles, legacyStorage, now }) {
  const byCreated = (/** @type {any} */ a, /** @type {any} */ b) => String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
  /** @type {any} */ let c = device.cutover;
  if (!c) {
    const local = profiles.filter(p => p.kind !== 'shadow').sort(byCreated)[0] || null;
    c = device.cutover = { at: isoWithOffset(now()), stage: 'start', previews: profiles.filter(p => p.kind === 'shadow').sort(byCreated).map(p => p.id),
      realId: local ? local.id : null, createdReal: false, merged: [], counts: {} };
    await adapter.putDevice(device);
  }
  const snap = legacyStorage ? readLegacy(legacyStorage) : {};
  // the newest preview's view of the legacy keys: "did the old app change this key after the preview read it?"
  const previews = c.previews.map((/** @type {string} */ id) => profiles.find(p => p.id === id)).filter(Boolean);
  const metas = await Promise.all(previews.map(async (/** @type {any} */ p) => (await adapter.loadScope(p.id)).meta || {}));
  const fp = metas.map(m => m.fingerprint).filter(Boolean).pop() || null;
  const legacyChanged = legacyChangedSince(fp, snap);
  /** @type {any} */ let migration = null;

  if (c.stage === 'start') {
    if (c.createdReal && c.realId) { await adapter.deleteProfile(c.realId); c.realId = null; c.createdReal = false; }
    if (!c.realId) {
      const profile = { id: uuidv7(now().getTime()), name: '', kind: 'local', createdAt: isoWithOffset(now()), remoteId: null };
      c.realId = profile.id; c.createdReal = true;
      await adapter.putDevice(device);   // first, so a cut-off import is found and redone
      await adapter.putProfile(profile);
      if (hasLegacyProgress(snap)) {
        const plan = planMigration(snap, { profileId: profile.id, deviceId: device.deviceId, now: now() });
        if (plan.kv.meta.legacyDeviceId && !device.legacyDeviceId) device.legacyDeviceId = plan.kv.meta.legacyDeviceId;
        const dev = await adapter.loadScope('device');
        const merged = deviceMerge({ prefs: dev.prefs, secrets: dev.secrets }, plan, legacyChanged);
        await applyMigration(adapter, { ...plan, ...merged }, profile);
        device.migratedAt = plan.kv.meta.migratedAt;
        device.migratedKind = 'local';
        c.migration = plan.summary;
      } else if (device.migratedKind !== 'local') { delete device.migratedAt; delete device.migratedKind; }
    }
    c.stage = 'imported';
    await adapter.putDevice(device);
  }

  /** @type {string | null} */ let error = null;
  for (const p of previews) {
    if (c.merged.includes(p.id)) continue;
    try {
      const load = async (/** @type {string} */ id) => ({ ...(await adapter.loadProfile(id)), kv: await adapter.loadScope(id) });
      const [real, prev] = await Promise.all([load(c.realId), load(p.id)]);
      const meta = real.kv.meta || {};
      const stamp = meta.migratedAt ? `${String(Date.parse(meta.migratedAt)).padStart(13, '0')}-0000-${device.deviceId}` : null;
      const plan = planPreviewMerge({ real, preview: prev, realId: c.realId, legacyChanged, migrationStamp: stamp, nextSeq: () => (device.seq = (device.seq || 0) + 1) });
      if (!c.counts[p.id]) { c.counts[p.id] = plan.counts; }
      await adapter.putDevice(device);   // the counts of the first try, and the seqs of events made here
      // the notice's numbers: everything kept from every preview so far
      const kept = sumCounts(c.previews.map((/** @type {string} */ id) => c.counts[id]).filter(Boolean));
      plan.kv.meta = { ...(plan.kv.meta || meta), preview: kept };
      for (const [deck, entries] of Object.entries(plan.cards)) if (entries.length) await adapter.putCards(c.realId, deck, entries);
      if (plan.attempts.length) await adapter.putAttempts(c.realId, plan.attempts);
      if (plan.events.length) await adapter.putEvents(c.realId, plan.events);
      for (const [name, value] of Object.entries(plan.kv)) await adapter.putKV(c.realId, name, value);
      // read back: every record written is there as written, before the preview is archived
      const back = await load(c.realId);
      const outIds = new Map(back.outbox.map((/** @type {any} */ e) => [e.id, e]));
      const attIds = new Map(back.attempts.map((/** @type {any} */ a) => [a.id, a]));
      const bad = [
        ...Object.entries(plan.cards).flatMap(([deck, entries]) => entries.filter(([id, rec]) => canon(back.cards[deck]?.[id]) !== canon(rec)).map(([id]) => `card ${id}`)),
        ...plan.attempts.filter(a => canon(attIds.get(a.id)) !== canon(a)).map(a => `attempt ${a.id}`),
        ...plan.events.filter(e => canon(outIds.get(e.id)) !== canon(e)).map(e => `event ${e.id}`),
        ...Object.entries(plan.kv).filter(([name, v]) => canon(back.kv[name]) !== canon(v)).map(([name]) => name),
        ...prev.outbox.filter((/** @type {any} */ e) => !outIds.has(e.id)).map((/** @type {any} */ e) => `event ${e.id}`),
      ];
      if (bad.length) throw new Error(`read-back differs: ${bad.slice(0, 5).join(', ')}`);
      await adapter.putProfile({ ...p, archivedAt: isoWithOffset(now()), archivedInto: c.realId });
      c.merged.push(p.id);
      await adapter.putDevice(device);
    } catch (e) {
      error = /** @type {any} */ (e)?.message || String(e);
      console.error('cutover: preview kept as it is, tried again next start', e);
      break;
    }
  }
  if (!error) {
    migration = c.migration || null;
    const kept = sumCounts(c.previews.map((/** @type {string} */ id) => c.counts[id]).filter(Boolean));
    device.cutoverDone = { at: isoWithOffset(now()), realId: c.realId, previews: c.previews, kept };
    delete device.cutover;
    device.activeProfile = c.realId;
    await adapter.putDevice(device);
    return { kept, migration, error };
  }
  device.activeProfile = c.realId;   // work goes on in the real profile; the preview stays until a merge reads back
  await adapter.putDevice(device);
  return { kept: null, migration: null, error };
}

/**
 * Courses (Arch #11): a profile's settings from before courses gain course 'de', derived from language, level and
 * exam with the revs those fields had (data/settings.js normalizeSettings), and the fields from before stay as they
 * are, as the active course's mirror. Idempotent: settings that have a courses list are left alone, and so is a
 * profile with no settings or no language yet (onboarding makes its first course). Writes no event and stamps no new
 * rev, so every device derives the same record, and it touches no card, attempt or event.
 * @param {any} store @returns {boolean} whether it wrote
 */
export function migrateCourses(store) {
  const cur = store.get('settings');
  if (!cur || typeof cur !== 'object' || Array.isArray(cur.courses)) return false;
  const next = normalizeSettings(cur);
  if (!next.courses.length) return false;
  store.set('settings', next);
  return true;
}

/** @param {any[]} list */
function sumCounts(list) {
  /** @type {Record<string, number>} */ const out = {};
  for (const x of list) for (const [k, v] of Object.entries(x || {})) out[k] = (out[k] || 0) + (Number(v) || 0);
  return out;
}

/**
 * A profile's data and the recordings it still holds on this device (the blobs of unsent exam.voice events, and a
 * take in progress): they live outside the profile's key range, so they are found through its outbox.
 * @param {any} adapter @param {string} id
 */
async function dropProfileData(adapter, id) {
  const { outbox } = await adapter.loadProfile(id);
  const scope = await adapter.loadScope(id);
  const blobs = new Set(outbox.filter((/** @type {any} */ e) => e && e.type === 'exam.voice').map((/** @type {any} */ e) => e.payload?.blobRef || e.id));
  if (scope['exams.takeInProgress']?.id) blobs.add(`take:${scope['exams.takeInProgress'].id}`);
  for (const b of blobs) await adapter.deleteBlob(b).catch(() => {});
  await adapter.deleteProfile(id);
}

/**
 * Delete this profile's data and start a fresh one (Profile > Data > Delete all). Legacy keys stay untouched, and the
 * migration marker is forgotten: the next start imports from them again, or goes to onboarding when there is nothing.
 * The device gets a new id: the progress backup's folders are named by it and have one writer each, so a fresh start
 * never writes over the deleted profile's backup (which a restore can still read).
 * @param {any} adapter @param {any} device @param {{id: string}} profile
 */
export async function deleteProfile(adapter, device, profile) {
  await dropProfileData(adapter, profile.id);
  await adapter.putKV('device', 'secrets', undefined);
  await adapter.putKV('device', 'backup', undefined);
  await adapter.putKV('device', 'backup.journal', undefined);
  await adapter.putKV('device', 'progress.device', undefined);
  device.previousDeviceIds = [...new Set([...(device.previousDeviceIds || []), device.deviceId])].slice(-8);
  device.deviceId = newDeviceId();
  device.activeProfile = null;
  delete device.migratedAt;
  delete device.migratedKind;
  await adapter.putDevice(device);
}
