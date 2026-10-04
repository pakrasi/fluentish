/* Boot-time data: the device record, the active profile, the one-time legacy migration, and the open store.

   First run on a device:
     - legacy progress in localStorage → a profile is created from it (migration), onboarding is skipped, and the
       import summary is shown once on Today
     - nothing to move → an empty profile; the router sends it to onboarding (#/welcome)
   Later runs open the active profile. Profiles are local today (kind 'local'); 'shadow' marks a preview copy that
   must never sync (review A3); 'remote' arrives with accounts. */
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

  const profiles = await adapter.listProfiles();
  /** @type {any} */ let profile = profiles.find((/** @type {any} */ p) => p.id === device.activeProfile) || profiles[0] || null;
  /** @type {any} */ let migration = null;

  if (!profile) {
    // once per device: after "Delete all" the legacy keys are still there, and must not come back
    const snap = legacyStorage && !device.migratedAt ? readLegacy(legacyStorage) : {};
    profile = { id: uuidv7(now().getTime()), name: '', kind, createdAt: isoWithOffset(now()), remoteId: null };
    await adapter.putProfile(profile);
    if (hasLegacyProgress(snap)) {
      const plan = planMigration(snap, { profileId: profile.id, deviceId: device.deviceId, now: now() });
      if (plan.kv.meta.legacyDeviceId && !device.legacyDeviceId) device.legacyDeviceId = plan.kv.meta.legacyDeviceId;
      await applyMigration(adapter, plan, profile);
      device.migratedAt = plan.kv.meta.migratedAt;
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
  return { store, profile, device, hlc, migration, profiles: await adapter.listProfiles() };
}

/**
 * Delete this profile's data and start a fresh one (Profile > Data > Delete all). Legacy keys stay untouched.
 * @param {any} adapter @param {any} device @param {{id: string}} profile
 */
export async function deleteProfile(adapter, device, profile) {
  await adapter.deleteProfile(profile.id);
  await adapter.putKV('device', 'secrets', undefined);
  device.activeProfile = null;
  await adapter.putDevice(device);
}
