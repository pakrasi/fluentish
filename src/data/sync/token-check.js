/* Checking a GitHub token against the repository it is for (docs/SHARING.md › Token safety). Run when a device is
   linked (main.js, Profile › Connections) and on start at most once a study day (recheck below), never with a token
   other than the device's own, and nothing it reads or returns holds the token: the result names the kind of token,
   its expiry and what is wrong with it, and is kept in the device kv 'connection.check' with a short one-way
   fingerprint of the token, so a replaced token is checked again.

   What GitHub tells:
     GET /repos/<owner>/<name>   200: the token reaches the repository (and permissions.push says whether the account
                                 may write); 401: bad or expired token; 403/404: the token cannot see it.
                                 github-authentication-token-expiration: the expiry, absent for a token without one.
                                 x-oauth-scopes: present only for classic tokens (and OAuth tokens), e.g. "repo, gist".
     GET /user/repos?visibility=private   the private repositories the token can reach. A fine-grained token limited
                                 to one repository lists only that one; "All repositories" lists more.

   Verdicts:
     refused  a classic token (ghp_…, or any token with x-oauth-scopes) that has the full 'repo' scope: it opens every
              private repository of the account, so it is never stored, and one already stored is removed
     denied   GitHub said no (401, 403, 404): not stored when linking
     offline  GitHub could not be reached: not stored when linking (open the link again when online)
     ok       usable, with warnings: 'broad' (a classic token, or a fine-grained one that reaches other private
              repositories), 'noExpiry', 'readOnly' (the account cannot push) */
import { CHECK_KV, resultsRepo, deviceToken, disconnectDevice } from '../connection.js';

/**
 * @typedef {{status: 'ok' | 'refused' | 'denied' | 'offline', kind: 'fine-grained' | 'classic' | 'other',
 *   repo: string, expires: string | null, warnings: ('broad' | 'noExpiry' | 'readOnly')[], http?: number,
 *   at: string, day?: string, key?: string}} TokenCheck
 */

/** The kind of a token from its prefix (GitHub's documented token prefixes). @param {string} token */
export const tokenKind = token => (/^github_pat_/.test(token) ? 'fine-grained' : /^gh[po]_/.test(token) ? 'classic' : 'other');

/** The scopes of a classic token from x-oauth-scopes, or null when the header is absent. @param {Headers} headers */
const scopesOf = headers => {
  const raw = headers.get('x-oauth-scopes');
  return raw == null ? null : raw.split(',').map(s => s.trim()).filter(Boolean);
};

/**
 * Check a token against a repository. Never throws; the result never holds the token.
 * @param {{token: string, repo: string, api: string, fetch?: typeof fetch, now?: () => Date}} o
 * @returns {Promise<TokenCheck>}
 */
export async function checkToken({ token, repo, api, fetch: f = (...a) => fetch(...a), now = () => new Date() }) {
  const at = now().toISOString();
  let kind = /** @type {TokenCheck['kind']} */ (tokenKind(token));
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' };
  /** @type {Response} */ let r;
  try { r = await f(`${api}/repos/${repo}`, { headers, cache: 'no-store' }); } catch { return { status: 'offline', kind, repo, expires: null, warnings: [], at }; }
  const scopes = scopesOf(r.headers);
  if (scopes) kind = 'classic';
  // a classic token with the full repo scope opens every private repository of the account: refused, whatever it reached
  if (kind === 'classic' && (scopes ? scopes.includes('repo') : r.ok)) return { status: 'refused', kind, repo, expires: null, warnings: ['broad'], http: r.status, at };
  if (!r.ok) return { status: r.status === 401 || r.status === 403 || r.status === 404 ? 'denied' : 'offline', kind, repo, expires: null, warnings: [], http: r.status, at };
  const exp = r.headers.get('github-authentication-token-expiration');
  const expires = exp && /^\d{4}-\d{2}-\d{2}/.test(exp) ? exp.slice(0, 10) : null;
  /** @type {TokenCheck['warnings']} */ const warnings = [];
  let body = null;
  try { body = await r.json(); } catch { /* no body: nothing more to read */ }
  if (body && body.permissions && body.permissions.push === false) warnings.push('readOnly');
  if (kind === 'classic') warnings.push('broad');
  else {
    // a fine-grained token: does it reach other private repositories than this one? (All repositories, or several)
    try {
      const l = await f(`${api}/user/repos?visibility=private&per_page=100`, { headers, cache: 'no-store' });
      if (l.ok) {
        const list = await l.json();
        const want = repo.toLowerCase();
        if (Array.isArray(list) && list.some((/** @type {any} */ x) => x && typeof x.full_name === 'string' && x.full_name.toLowerCase() !== want)) warnings.push('broad');
      }
    } catch { /* unknown: no warning */ }
  }
  if (!expires) warnings.push('noExpiry');
  return { status: 'ok', kind, repo, expires, warnings, http: r.status, at };
}

/** A short one-way fingerprint of the token, so a stored check belongs to one token. @param {string} token */
export async function fingerprint(token) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`fluentish-token-check:${token}`));
  return [...new Uint8Array(d)].slice(0, 6).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** The stored check of this device's token for the connected repository, or null. @param {any} store @returns {TokenCheck | null} */
export const lastCheck = store => {
  const c = store.get(CHECK_KV, null);
  return c && typeof c === 'object' && c.repo === resultsRepo(store) ? c : null;
};

/**
 * Check this device's token again, at most once a study day (or now with force). A refused token is removed from the
 * device (disconnectDevice); any other verdict is only recorded. Returns the check, or null when there is nothing to
 * check or it was checked today already.
 * @param {any} store @param {{api: string, today: string, force?: boolean, fetch?: typeof fetch, now?: () => Date}} o
 * @returns {Promise<TokenCheck | null>}
 */
export async function recheck(store, { api, today, force = false, fetch: f, now }) {
  const token = deviceToken(store), repo = resultsRepo(store);
  if (!token || !repo) return null;
  const key = await fingerprint(token);
  const prev = lastCheck(store);
  if (!force && prev && prev.key === key && prev.day === today && prev.status !== 'offline') return null;
  const c = await checkToken({ token, repo, api, fetch: f, now });
  if (deviceToken(store) !== token) return null;   // replaced or removed meanwhile
  const rec = { ...c, day: today, key };
  if (c.status === 'refused') { disconnectDevice(store); store.set(CHECK_KV, rec); return rec; }
  store.set(CHECK_KV, rec);
  return rec;
}

/**
 * Store a checked token: the check goes with it (Profile shows the expiry and the warnings at once).
 * @param {any} store @param {string} token @param {TokenCheck} c @param {string} today
 */
export async function keepCheck(store, token, c, today) {
  store.set(CHECK_KV, { ...c, day: today, key: await fingerprint(token) });
}
