/* Supabase Auth over plain fetch (docs/ACCOUNTS.md; reports/auth.md §1.3): no SDK, no bundler. Inert until
   config.accounts passes the guard in ../config.js; index.js loads this file only then.

   Endpoints (GoTrue, https://github.com/supabase/auth; the Auth REST shapes are not in Supabase's reference docs, so
   tests/fixtures/account/supabase.json pins the request and response shapes this client relies on):
     POST /auth/v1/otp                              {email, create_user: false}  → 200 {}       (sends the 6-digit code)
     POST /auth/v1/verify                           {type: 'email', email, token} → 200 session
     POST /auth/v1/token?grant_type=refresh_token   {refresh_token}               → 200 session
     POST /auth/v1/logout?scope=local|global        Authorization: Bearer <access> → 204
   A session is {access_token, refresh_token, expires_in, expires_at, user: {id, email}}.

   Headers: the publishable key goes in `apikey` only (it is not a JWT); the user's access token goes in
   Authorization. Errors: no answer or a 5xx is 'offline' (a paused project, an outage: the app waits), 429 is
   'rateLimited'. A refresh token works once, so a refresh that is refused (400/401) means signed out; index.js runs
   refreshes one tab at a time. */

/** @typedef {import('../types.js').Provider} Provider @typedef {import('../types.js').Tokens} Tokens @typedef {import('../types.js').AccountError} AccountError */

/**
 * @param {{url: string, publishableKey: string, fetch: typeof fetch, now?: () => number, timeoutMs?: number}} o
 * @returns {Provider}
 */
export function supabaseProvider({ url, publishableKey, fetch: fetchFn, now = Date.now, timeoutMs = 15_000 }) {
  const json = { 'content-type': 'application/json' };
  const signal = () => (typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined);

  /** @param {string} path @param {any} body @param {Record<string, string>} [headers] @returns {Promise<Response | null>} null: no answer */
  async function post(path, body, headers = {}) {
    try {
      return await fetchFn(`${url}${path}`, { method: 'POST', headers: { apikey: publishableKey, ...json, ...headers }, body: JSON.stringify(body), signal: signal(), credentials: 'omit', cache: 'no-store' });
    } catch { return null; }
  }

  /** @param {Response | null} r @param {AccountError} fallback @returns {AccountError} */
  const errorOf = (r, fallback) => (!r || r.status >= 500 ? 'offline' : r.status === 429 ? 'rateLimited' : fallback);

  /** A session response as Tokens, or null when it is not one. @param {Response} r @returns {Promise<Tokens | null>} */
  async function tokensOf(r) {
    /** @type {any} */ let b = null;
    try { b = await r.json(); } catch { return null; }
    if (!b || typeof b.access_token !== 'string' || typeof b.refresh_token !== 'string') return null;
    const expiresAt = Number.isFinite(b.expires_at) ? b.expires_at * 1000 : now() + (Number(b.expires_in) || 3600) * 1000;
    return { accessToken: b.access_token, refreshToken: b.refresh_token, expiresAt, userId: typeof b.user?.id === 'string' ? b.user.id : '', email: typeof b.user?.email === 'string' ? b.user.email : null };
  }

  return Object.freeze({
    id: /** @type {const} */ ('supabase'),
    network: true,
    async requestCode({ email }) {
      const r = await post('/auth/v1/otp', { email, create_user: false });
      if (r && r.ok) return { ok: /** @type {const} */ (true) };
      // sign-ups are invite-only: an email without an account is refused (422, "Signups not allowed for otp")
      return { error: errorOf(r, r && r.status === 422 ? 'noAccount' : r && r.status === 400 ? 'badEmail' : 'failed') };
    },
    async verifyCode({ email, code }) {
      const r = await post('/auth/v1/verify', { type: 'email', email, token: code });
      if (r && r.ok) { const t = await tokensOf(r); return t ? { tokens: t } : { error: /** @type {const} */ ('failed') }; }
      return { error: errorOf(r, r && r.status >= 400 && r.status < 500 ? 'badCode' : 'failed') };
    },
    async refresh(refreshToken) {
      const r = await post('/auth/v1/token?grant_type=refresh_token', { refresh_token: refreshToken });
      if (r && r.ok) { const t = await tokensOf(r); return t ? { tokens: t } : { error: /** @type {const} */ ('failed') }; }
      return { error: errorOf(r, r && (r.status === 400 || r.status === 401) ? 'signedOut' : 'failed') };
    },
    async logout(accessToken, scope) {
      await post(`/auth/v1/logout?scope=${scope === 'global' ? 'global' : 'local'}`, {}, { authorization: `Bearer ${accessToken}` });
    },
    async fetchAuthed(path, init, accessToken) {
      if (!path.startsWith('/')) throw new Error('account: a path on the project, starting with /');
      const headers = new Headers(init.headers || {});
      headers.set('apikey', publishableKey);
      headers.set('authorization', `Bearer ${accessToken}`);
      return fetchFn(`${url}${path}`, { ...init, headers, credentials: 'omit', cache: 'no-store' });
    },
  });
}
