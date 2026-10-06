/* The results connection of a profile (docs/SHARING.md). Until accounts exist, a profile may connect one private GitHub
   repository it owns: the results sync, the progress backup, restore and the automatic merge, the exam words and the
   corrections written back by the results review all go through it. The repository is a profile setting,
   settings.connections.results ('owner/name', synced and merged per field like every setting); the token that
   reaches it stays on the device (kv 'secrets'.githubToken, never exported, synced or backed up).

   A new profile has no repository: nothing is sent anywhere and the features that need one stay hidden or say
   "Not connected". There is no default repository in the code any more (config.js has none).

   The owner's devices (the ones that synced before this setting existed) keep working unchanged through a one-time,
   additive migration per profile (migrateConnections, run at boot by main.js): a profile that holds a GitHub token,
   or results or backup state that only a sync can have written, gets the repository and the study hours file it used
   before, OWNER below. A profile without any of that gets nothing. The migration records that it ran in kv 'meta'
   (meta.connections), so it never runs twice for a profile and never fills a value the learner removed later. */
import { normalizeSettings, setSetting } from './settings.js';

/** Device kv: the last token check (data/sync/token-check.js), never exported or uploaded. */
export const CHECK_KV = 'connection.check';

/** What the owner's devices used before the connection became a setting. Read only by the migration below and by a
   device link that reaches this repository with its token (main.js); never a default for anyone else. */
export const OWNER = Object.freeze({
  results: 'pakrasi/b1-exam',
  hours: Object.freeze({ repo: 'pakrasi/language-stack', path: 'data/toggl.json', lang: 'german' }),
});

/** 'owner/name' as GitHub allows it. */
export const REPO_RE = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9_.-]{1,100}$/;
/** @param {any} v */
export const validRepo = v => typeof v === 'string' && REPO_RE.test(v) && !/\/\.\.?$/.test(v);

/** The repository this profile connects, or null. @param {any} store */
export function resultsRepo(store) {
  const r = normalizeSettings(store?.get('settings'))?.connections?.results;
  return validRepo(r) ? r : null;
}

/** The token on this device, whatever it is for. @param {any} store @returns {string | null} */
export const deviceToken = store => (store?.get('secrets', {}) || {}).githubToken || null;

/** The token for the connected repository: null when the profile connects none, so nothing can be sent with it. @param {any} store */
export const githubToken = store => (resultsRepo(store) ? deviceToken(store) : null);

/** A repository is set and this device holds a token for it. @param {any} store */
export const connected = store => !!githubToken(store);

/** The state for the UI: 'none' (no repository: a local-only profile), 'device' (a repository, but this device has no
   token), 'connected'. @param {any} store @returns {'none' | 'device' | 'connected'} */
export const connectionState = store => (!resultsRepo(store) ? 'none' : connected(store) ? 'connected' : 'device');

/* ---------- the owner migration ---------- */

/** Collections only a sync with the results repository writes (data/sync/github-b1exam.js, data/sync/backup.js). */
const SYNC_STATE = /** @type {const} */ (['exams.remote', 'exams.syncStatus', 'backup']);

/**
 * Why this profile is the owner's: a token on the device, or state a sync wrote. null when there is none.
 * @param {any} store @returns {'token' | 'pulled' | 'synced' | 'backup' | null}
 */
export function ownerSignal(store) {
  if (deviceToken(store)) return 'token';
  const remote = store.get(SYNC_STATE[0], null);
  if (remote && typeof remote === 'object' && (remote.cursor || remote.fetchedAt)) return 'pulled';
  const st = store.get(SYNC_STATE[1], null);
  if (st && typeof st === 'object' && st.at) return 'synced';
  const b = store.get(SYNC_STATE[2], null);
  if (b && typeof b === 'object' && (b.at || b.snapshot || b.files)) return 'backup';
  return null;
}

/**
 * What the migration would write: [path, value] pairs for the fields that are not set yet. Pure.
 * @param {any} store @returns {{signal: ReturnType<typeof ownerSignal>, writes: [string, any][]}}
 */
export function planConnections(store) {
  const signal = ownerSignal(store);
  if (!signal) return { signal, writes: [] };
  const c = normalizeSettings(store.get('settings')).connections || {};
  /** @type {[string, any][]} */ const writes = [];
  if (!validRepo(c.results)) writes.push(['connections.results', OWNER.results]);
  if (!c.hours) writes.push(['connections.hours', { ...OWNER.hours }]);
  return { signal, writes };
}

/**
 * Run the migration once per profile. Additive: it only fills fields that are not set, and only for a profile that
 * synced before. Idempotent: the second run finds meta.connections and does nothing.
 * @param {{store: any, hlc: {tick: () => string}, bus?: any}} app @param {{now?: () => Date}} [o]
 * @returns {{ran: boolean, signal: string | null, writes: [string, any][]}}
 */
export function migrateConnections(app, { now = () => new Date() } = {}) {
  const { store } = app;
  if (store.profile?.kind === 'shadow') return { ran: false, signal: null, writes: [] };
  const meta = store.get('meta', {}) || {};
  if (meta.connections) return { ran: false, signal: null, writes: [] };
  const { signal, writes } = planConnections(store);
  for (const [path, value] of writes) setSetting(app, path, value);
  store.set('meta', { ...meta, connections: { at: now().toISOString(), owner: !!signal, set: writes.map(([p]) => p) } });
  return { ran: true, signal, writes };
}

/**
 * The owner's link: a device link (b1-token.py) whose token reaches OWNER.results while the profile connects no
 * repository. It sets what the migration would have set on a device that synced before. @param {{store: any, hlc: {tick: () => string}, bus?: any}} app
 */
export function applyOwnerLink(app) {
  const c = normalizeSettings(app.store.get('settings')).connections || {};
  if (!validRepo(c.results)) setSetting(app, 'connections.results', OWNER.results);
  if (!c.hours) setSetting(app, 'connections.hours', { ...OWNER.hours });
}

/**
 * Connect a repository (Profile › Connections, after the token was checked): the repository setting and the token.
 * @param {{store: any, hlc: {tick: () => string}, bus?: any}} app @param {string} repo @param {string} token
 */
export function connect(app, repo, token) {
  if (!validRepo(repo)) throw new Error('connection: not a repository');
  if (resultsRepo(app.store) !== repo) setSetting(app, 'connections.results', repo);
  app.store.set('secrets', { anthropicKey: null, ...(app.store.get('secrets', {}) || {}), githubToken: token });
}

/**
 * Disconnect this device: its token and the token check go; the profile's repository setting stays, so another
 * device (or this one, with a new token) still knows where the results are. Nothing already on the device is deleted.
 * @param {any} store
 */
export function disconnectDevice(store) {
  store.set('secrets', { anthropicKey: null, ...(store.get('secrets', {}) || {}), githubToken: null });
  store.set(CHECK_KV, null);
}

/** Forget the repository too (a profile that no longer wants a connection). @param {{store: any, hlc: {tick: () => string}, bus?: any}} app */
export function forgetRepo(app) {
  disconnectDevice(app.store);
  if (resultsRepo(app.store)) setSetting(app, 'connections.results', null);
}
