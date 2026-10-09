/* Where the account's session lives (docs/ACCOUNTS.md). A port, so the iOS shell can keep it in the Keychain
   instead (Capacitor: sensitive values belong in memory or the Keychain, not in Preferences).

   Default: the device-scope kv 'account.session' in IndexedDB (store.js DEVICE_SCOPE): never in localStorage, never
   exported (transfer.js NOT_EXPORTED), never in a snapshot (backup.js SNAPSHOT_KV is an allow-list), never in the
   error log (core/log.js scrubs the token field names and JWTs). Only this file and providers/* see the tokens;
   index.js hands features a Session without them.

   Device-scope kv names this module family owns (all additive, all device-only):
     account.session   {accessToken, refreshToken, expiresAt (ms), userId, email} | null
     account.claim     the first sign-in's upload journal (stage 2; not written before then)
     backup.account    the account backup target's state, shaped like kv 'backup' plus seqHigh (stage 2; not written
                       before then) */

export const SESSION_KV = 'account.session';
export const CLAIM_KV = 'account.claim';
export const BACKUP_KV = 'backup.account';
/** Every device kv the accounts layer owns. store.js DEVICE_SCOPE and transfer.js NOT_EXPORTED hold each of them. */
export const ACCOUNT_DEVICE_KV = /** @type {const} */ ([SESSION_KV, CLAIM_KV, BACKUP_KV]);

/** @typedef {{accessToken: string, refreshToken: string, expiresAt: number, userId: string, email: string | null}} Tokens */
/** @typedef {{read: () => Tokens | null, write: (t: Tokens | null) => void}} SessionStore */

/** @param {any} v @returns {v is Tokens} */
export const isTokens = v => !!v && typeof v === 'object' && typeof v.accessToken === 'string' && typeof v.refreshToken === 'string'
  && typeof v.userId === 'string' && Number.isFinite(v.expiresAt);

/**
 * The session in the store's device kv.
 * @param {{get: (name: string, fallback?: any) => any, set: (name: string, value: any) => void}} store
 * @returns {SessionStore}
 */
export function kvSessionStore(store) {
  return {
    read: () => { const v = store.get(SESSION_KV, null); return isTokens(v) ? v : null; },
    write: tokens => store.set(SESSION_KV, tokens ? { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, expiresAt: tokens.expiresAt, userId: tokens.userId, email: tokens.email ?? null } : null),
  };
}

/** A session kept in memory only (tests; a browser that blocks storage). @returns {SessionStore} */
export function memorySessionStore() {
  /** @type {Tokens | null} */ let v = null;
  return { read: () => v, write: t => { v = t ? { ...t } : null; } };
}
