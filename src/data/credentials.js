/* Credentials: the one place features learn whether and how they may call Claude or GitHub (arch F4).

   Features never read kv 'secrets' themselves (tests/unit/secrets-lint.test.mjs; Profile › Connections, which edits
   the secrets, is the one exception). They ask here and hand what they get to the service that makes the call:

     claude(store)        → ClaudeCredential | null      services/claude.js takes it as `cred`
     canAskClaude(store)  → boolean                      for showing, enabling or hiding a Claude control
     github(store)        → string | null                the token for the connected repository (connection.js)

   Today a credential is the learner's own key on this device ({mode: 'key'}). Accounts later add a server proxy
   ({mode: 'proxy'}), where the request goes to our own endpoint through the account's authFetch, so no token ever
   reaches a feature or this object. Only this file changes then; the features and their tests stay as they are.

   The key is held in a frozen object whose `key` property is not enumerable and whose toJSON names the mode only, so
   spreading, JSON.stringify, structuredClone or a stray log of the object never carries it. Nothing here
   logs. */
import { githubToken } from './connection.js';

/**
 * @typedef {{readonly mode: 'key', readonly key: string}} KeyCredential
 *   The learner's own Anthropic key on this device; services/claude.js calls the Messages API directly.
 * @typedef {{readonly mode: 'proxy', readonly url: string, readonly fetch: typeof fetch}} ProxyCredential
 *   Reserved for accounts: `url` takes a Messages API body, `fetch` is the account's authFetch (it adds the session).
 * @typedef {KeyCredential | ProxyCredential} ClaudeCredential
 */

/** @param {any} store @returns {Record<string, any>} */
const secretsOf = store => (store?.get('secrets', {}) || {});

/**
 * A key credential that does not show its key when spread, serialised or printed.
 * @param {string} key @returns {KeyCredential}
 */
export function keyCredential(key) {
  const cred = { mode: /** @type {const} */ ('key') };
  Object.defineProperty(cred, 'key', { value: key, enumerable: false });
  Object.defineProperty(cred, 'toJSON', { value: () => ({ mode: 'key' }), enumerable: false });
  return /** @type {KeyCredential} */ (Object.freeze(cred));
}

/**
 * How this device may ask Claude, or null when it may not.
 * @param {any} store @returns {ClaudeCredential | null}
 */
export function claude(store) {
  const k = secretsOf(store).anthropicKey;
  return typeof k === 'string' && k ? keyCredential(k) : null;
}

/** This device may ask Claude. @param {any} store */
export const canAskClaude = store => claude(store) !== null;

/** The GitHub token for the connected repository, or null (no repository, or none on this device). @param {any} store */
export const github = store => githubToken(store);
