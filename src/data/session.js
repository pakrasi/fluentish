/* Boot-time data: the device record, the active profile, the one-time legacy migration, and the open store.

   First run on a device:
     - legacy progress in localStorage → a profile is created from it (migration), onboarding is skipped, and the
       import summary is shown once on Today
     - nothing to move → an empty profile; the router sends it to onboarding (#/welcome)
   Later runs open the active profile. Profiles are local today (kind 'local'); 'shadow' marks a preview copy that
   must never sync (review A3); 'remote' arrives with accounts.

   Leaving shadow mode (docs/CUTOVER.md, blocker 1): a device that opened the live preview has a shadow profile as its
   active profile, and the shadow migration set device.migratedAt. On the first local boot the shadow profiles are
   deleted with their data (practice-only by design, never synced), the marker of the shadow migration is forgotten,
   and the one-time migration runs from the legacy keys as on a first run. device.migratedKind records which kind of
   profile a migration made; a marker without it predates that field and could only come from a shadow migration when
   no local profile exists. */
import { Store } from './store.js';
import { uuidv7, isoWithOffset, newDeviceId, createHlc } from './ids.js';
import { readLegacy, hasLegacyProgress, planMigration, applyMigration } from './migrate.js';

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

  let profiles = await adapter.listProfiles();
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
  // Leaving shadow mode: the preview profiles go, and the real migration runs below.
  let previewDropped = 0;
  const current = profiles.find((/** @type {any} */ p) => p.id === device.activeProfile) || profiles[0] || null;
  if (kind === 'local' && current?.kind === 'shadow') {
    for (const p of profiles.filter((/** @type {any} */ p) => p.kind === 'shadow')) { await dropProfileData(adapter, p.id); previewDropped++; }
    profiles = profiles.filter((/** @type {any} */ p) => p.kind !== 'shadow');
    await adapter.putKV('device', 'secrets', undefined);   // re-imported from the legacy keys by the migration
    device.activeProfile = null;
    if (!profiles.length && device.migratedKind !== 'local') { delete device.migratedAt; delete device.migratedKind; }
    await adapter.putDevice(device);
  }
  /** @type {any} */ let profile = profiles.find((/** @type {any} */ p) => p.id === device.activeProfile) || profiles[0] || null;
  /** @type {any} */ let migration = null;

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

  const store = await Store.open({ adapter, profile, device, clock, bus, channel: channel() });
  const hlc = createHlc(device.deviceId);
  if (migration) store.append('legacy.imported', { summary: migration });
  return { store, profile, device, hlc, migration, previewDropped, profiles: await adapter.listProfiles() };
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
 * @param {any} adapter @param {any} device @param {{id: string}} profile
 */
export async function deleteProfile(adapter, device, profile) {
  await dropProfileData(adapter, profile.id);
  await adapter.putKV('device', 'secrets', undefined);
  device.activeProfile = null;
  delete device.migratedAt;
  delete device.migratedKind;
  await adapter.putDevice(device);
}
