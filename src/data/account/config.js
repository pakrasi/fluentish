/* Which account provider this page may use (docs/ACCOUNTS.md, round 8 stage 0). The config guard: accounts turn on
   only when every check below passes; anything else resolves to 'local' with a reason, which Profile › Diagnostics
   shows when it is not simply "not configured". The resolved provider is the only flag, so there is no second switch
   to keep in step.

   'supabase' needs all of:
     - config.accounts.provider === 'supabase'
     - url is https://<20-character project ref>.supabase.co
     - publishableKey starts sb_publishable_ (public by design). A legacy anon or service_role key (a JWT) and a
       secret key (sb_secret_) are refused.
     - origins lists https origins only, none of them on github.io
     - this page's origin is one of them, and it is not on github.io: every repository's site on pakrasi.github.io
       shares one origin, so any of them could read a session stored there (reports/auth.md finding 2)
   'fake' (an in-memory server, no network): only on localhost, 127.0.0.1 or [::1], with ?accounts=fake. For
   development and the e2e suite.

   Pure: no DOM, no network, no store. tools/stamp.mjs uses connectHost() to add the project to connect-src. */

/** @typedef {{provider: string, url: string | null, publishableKey: string | null, origins: string[]}} AccountsConfig */
/** @typedef {'local' | 'supabase' | 'fake'} ProviderId */
/**
 * Why accounts are off ('none' when they are on).
 * @typedef {'none' | 'notConfigured' | 'unknownProvider' | 'badUrl' | 'badKey' | 'legacyKey' | 'secretKey' | 'badOrigins'
 *   | 'sharedOrigin' | 'originNotAllowed'} AccountsReason
 */
/** @typedef {{provider: ProviderId, reason: AccountsReason, url: string | null, publishableKey: string | null}} ResolvedAccounts */

/** A Supabase project URL: https, a 20-character lower-case project ref, no path, no port. */
export const SUPABASE_URL = /^https:\/\/[a-z0-9]{20}\.supabase\.co$/;
/** A publishable key ("safe to expose online"). */
export const PUBLISHABLE_KEY = /^sb_publishable_[A-Za-z0-9_-]{8,}$/;
/** A legacy anon or service_role key: a JWT. Refused, whatever its role. */
const JWT = /^eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/;
/** Hosts that share one origin with other people's or other projects' pages. */
const SHARED_HOST = /(^|\.)github\.io$/i;
/** The hosts a fake provider may run on. */
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])$/;

/** The default: no provider, nothing configured. @type {Readonly<AccountsConfig>} */
export const NO_ACCOUNTS = Object.freeze({ provider: 'local', url: null, publishableKey: null, origins: /** @type {string[]} */ ([]) });

/** @param {string} s */
function parseOrigin(s) {
  try { const u = new URL(s); return u.origin === s ? u : null; } catch { return null; }
}

/**
 * The config's own checks, without the page's origin: why it cannot turn accounts on anywhere, or 'none'.
 * @param {Partial<AccountsConfig> | null | undefined} acc
 * @returns {AccountsReason}
 */
export function configProblem(acc) {
  const a = acc || NO_ACCOUNTS;
  if (!a.provider || a.provider === 'local') return 'notConfigured';
  if (a.provider !== 'supabase') return 'unknownProvider';
  if (typeof a.url !== 'string' || !SUPABASE_URL.test(a.url)) return 'badUrl';
  const key = typeof a.publishableKey === 'string' ? a.publishableKey : '';
  if (key.startsWith('sb_secret_')) return 'secretKey';
  if (JWT.test(key)) return 'legacyKey';
  if (!PUBLISHABLE_KEY.test(key)) return 'badKey';
  const origins = Array.isArray(a.origins) ? a.origins : [];
  if (!origins.length) return 'badOrigins';
  for (const o of origins) {
    const u = typeof o === 'string' ? parseOrigin(o) : null;
    if (!u || u.protocol !== 'https:' || SHARED_HOST.test(u.hostname)) return 'badOrigins';
  }
  return 'none';
}

/**
 * The provider this page uses.
 * @param {Partial<AccountsConfig> | null | undefined} acc config.accounts
 * @param {{origin: string, hostname: string, search?: string} | null | undefined} loc the page's location
 * @returns {ResolvedAccounts}
 */
export function resolveAccountsConfig(acc, loc) {
  /** @param {AccountsReason} reason @returns {ResolvedAccounts} */
  const local = reason => ({ provider: 'local', reason, url: null, publishableKey: null });
  if (!loc || typeof loc.origin !== 'string' || typeof loc.hostname !== 'string') return local('notConfigured');
  // development only: an in-memory server on this computer
  if (LOCAL_HOST.test(loc.hostname) && new URLSearchParams(loc.search || '').get('accounts') === 'fake') {
    return { provider: 'fake', reason: 'none', url: null, publishableKey: null };
  }
  const problem = configProblem(acc);
  if (problem !== 'none') return local(problem);
  if (SHARED_HOST.test(loc.hostname)) return local('sharedOrigin');
  const a = /** @type {AccountsConfig} */ (acc);
  // origins are https only (configProblem), so an http page is never in the list
  if (!a.origins.includes(loc.origin)) return local('originNotAllowed');
  return { provider: 'supabase', reason: 'none', url: a.url, publishableKey: a.publishableKey };
}

/**
 * The host connect-src must allow for this config, or null (tools/stamp.mjs). Only a config that could turn accounts
 * on somewhere adds one; the runtime guard still decides per page.
 * @param {Partial<AccountsConfig> | null | undefined} acc @returns {string | null}
 */
export const connectHost = acc => (configProblem(acc) === 'none' ? /** @type {string} */ (/** @type {AccountsConfig} */ (acc).url) : null);
