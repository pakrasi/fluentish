/* The account (docs/ACCOUNTS.md, round 8 stage 0): the only module features and other data modules import from
   src/data/account/. Nothing reaches providers/* except through here, and no token leaves this folder: getSession()
   and onChange() hand out {userId, email, expiresAt} only, and authFetch() is how a data module (stage 2: the
   account's backup Files target) talks to the server.

   Which provider runs is decided by config.js resolveAccountsConfig() from config.accounts and the page's address:
     local     the default. available() is false, the UI shows nothing, every call answers 'off', no fetch is ever
               made and the store is never read or written for accounts.
     fake      localhost with ?accounts=fake only: an in-memory server (providers/fake.js), for development and e2e.
     supabase  a configured project on an allowed origin (providers/supabase.js, loaded only then).

   Rules (tests/unit/account.test.mjs):
     - Offline is a state, not an error. A refresh that gets no answer keeps the session and tries again later; only a
       refused refresh token (400/401) signs out.
     - A refresh token works once, so one tab refreshes at a time: navigator.locks 'account-refresh', and a tab that
       waited takes the pair the other tab already stored (the store's BroadcastChannel carries the new kv to every
       tab). authFetch retries once after a 401.
     - Sign out is local first (the session is gone at once, offline too), then the server is told when it can be. */
import { config } from '../../core/config.js';
import { resolveAccountsConfig } from './config.js';
import { kvSessionStore, SESSION_KV } from './session-store.js';
import { localProvider } from './providers/local.js';

/** @typedef {import('./types.js').Account} Account @typedef {import('./types.js').AccountState} AccountState
    @typedef {import('./types.js').Session} Session @typedef {import('./types.js').Provider} Provider
    @typedef {import('./types.js').Tokens} Tokens @typedef {import('./types.js').AccountError} AccountError
    @typedef {import('./session-store.js').SessionStore} SessionStore @typedef {import('./config.js').ResolvedAccounts} ResolvedAccounts */
/** @typedef {{request: (name: string, fn: () => Promise<any>) => Promise<any>}} Locks */

/** Refresh this long before the access token runs out. */
export const REFRESH_EARLY_MS = 60e3;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** @type {WeakMap<object, Promise<Account>>} */
const opened = new WeakMap();

/**
 * Which provider this page resolves to, and why: sync, no import, no network (Profile › Diagnostics).
 * @param {{accounts?: any, location?: any}} [o]
 * @returns {ResolvedAccounts}
 */
export function accountsStatus({ accounts = config.accounts, location = globalThis.location } = {}) {
  return resolveAccountsConfig(accounts, location ?? null);
}

/**
 * The account of this store's device, made once per store (Profile makes it lazily; main.js does not).
 * @param {{store?: any, accounts?: any, location?: any, fetch?: typeof fetch, locks?: Locks | null, now?: () => number,
 *   sessions?: SessionStore, provider?: Provider}} [o]
 *   provider and sessions: tests only
 * @returns {Promise<Account>}
 */
export function openAccount(o = {}) {
  const { store } = o;
  if (store && opened.has(store)) return /** @type {Promise<Account>} */ (opened.get(store));
  const p = make(o);
  if (store) opened.set(store, p);
  return p;
}

/** @param {Parameters<typeof openAccount>[0] & {}} o @returns {Promise<Account>} */
async function make({ store, accounts, location, fetch: fetchFn, locks, now = Date.now, sessions, provider }) {
  const resolved = accountsStatus({ accounts: accounts ?? config.accounts, location });
  /** @type {Provider} */ let p;
  if (provider) p = provider;
  else if (resolved.provider === 'fake') p = (await import('./providers/fake.js')).fakeProvider({ now });
  else if (resolved.provider === 'supabase') {
    p = (await import('./providers/supabase.js')).supabaseProvider({
      url: /** @type {string} */ (resolved.url), publishableKey: /** @type {string} */ (resolved.publishableKey),
      fetch: fetchFn ?? globalThis.fetch.bind(globalThis), now });
  } else p = localProvider();
  if (p.id === 'local') return createAccount({ provider: p, resolved, sessions: null, locks: null, now });
  const acc = createAccount({ provider: p, resolved, sessions: sessions ?? kvSessionStore(store), locks: locks === undefined ? defaultLocks() : locks, now });
  // another tab signed in, refreshed or signed out: the store reloads the kv from its BroadcastChannel
  store?.subscribe?.(SESSION_KV, () => acc.reload());
  return acc;
}

/** @returns {Locks | null} */
const defaultLocks = () => /** @type {any} */ (globalThis.navigator)?.locks ?? null;

/**
 * The account over one provider. Exported for tests.
 * @param {{provider: Provider, resolved: ResolvedAccounts, sessions: SessionStore | null, locks: Locks | null, now: () => number}} o
 * @returns {Account & {reload: () => void}}
 */
export function createAccount({ provider, resolved, sessions, locks, now }) {
  const on = provider.id !== 'local' && !!sessions;
  /** @type {Set<(s: AccountState, session: Session | null) => void>} */ const subs = new Set();
  /** @type {string | null} */ let pending = null;
  /** @type {Promise<Tokens | null> | null} */ let refreshing = null;
  /** @type {AccountState} */ let st = on ? (sessions?.read() ? 'signedIn' : 'signedOut') : 'off';

  /** @param {Tokens | null} t @returns {Session | null} */
  const publicOf = t => (t ? { userId: t.userId, email: t.email, expiresAt: t.expiresAt } : null);
  const read = () => (on && sessions ? sessions.read() : null);
  /** @param {AccountState} next */
  const set = next => {
    if (next === st) return;
    st = next;
    const s = publicOf(read());
    for (const fn of [...subs]) { try { fn(st, s); } catch (e) { console.error('[account]', e); } }
  };
  /** @param {AccountError} code */
  const fail = code => Object.assign(new Error(`account: ${code}`), { code, offline: code === 'offline', auth: code === 'signedOut' });

  /** One refresh at a time, in this tab and across tabs. @param {Tokens} stale @returns {Promise<Tokens | null>} */
  function refresh(stale) {
    if (refreshing) return refreshing;
    const run = async () => {
      const cur = read();
      if (!cur) { set('signedOut'); return null; }
      // another tab refreshed while this one waited for the lock: its pair is already stored
      if (cur.refreshToken !== stale.refreshToken && cur.expiresAt - now() > REFRESH_EARLY_MS) { set('signedIn'); return cur; }
      const r = await provider.refresh(cur.refreshToken);
      if ('tokens' in r) {
        const t = { ...r.tokens, userId: r.tokens.userId || cur.userId, email: r.tokens.email ?? cur.email };
        sessions?.write(t);
        set('signedIn');
        return t;
      }
      if (r.error === 'signedOut') { sessions?.write(null); set('signedOut'); return null; }
      set('offline');
      return null;
    };
    refreshing = (locks ? locks.request('account-refresh', run) : run()).finally(() => { refreshing = null; });
    return refreshing;
  }

  return {
    available: () => on,
    provider: () => provider.id,
    reason: () => resolved.reason,
    state: () => st,
    getSession: () => publicOf(read()),
    pendingEmail: () => pending,
    reload() { if (!on) return; const t = read(); if (!t && st !== 'codeSent') set('signedOut'); else if (t && (st === 'signedOut' || st === 'codeSent')) { pending = null; set('signedIn'); } },
    async signIn({ email }) {
      if (!on) return { error: 'off' };
      const e = String(email || '').trim();
      if (e.length > 254 || !EMAIL.test(e)) return { error: 'badEmail' };
      const r = await provider.requestCode({ email: e });
      if ('error' in r) return r;
      pending = e;
      set('codeSent');
      return { step: 'code' };
    },
    async verify({ code, email = pending || '' }) {
      if (!on) return { error: 'off' };
      const c = String(code || '').replace(/\s+/g, '');
      if (!/^\d{6}$/.test(c) || !email) return { error: 'badCode' };
      const r = await provider.verifyCode({ email, code: c });
      if ('error' in r) return r;
      const t = { ...r.tokens, email: r.tokens.email ?? email };
      sessions?.write(t);
      pending = null;
      set('signedIn');
      return { session: /** @type {Session} */ (publicOf(t)) };
    },
    restart() { if (!on) return; pending = null; if (st === 'codeSent') set('signedOut'); },
    async signOut({ everywhere = false } = {}) {
      if (!on) return;
      const t = read();
      sessions?.write(null);
      pending = null;
      set('signedOut');
      if (t) { try { await provider.logout(t.accessToken, everywhere ? 'global' : 'local'); } catch { /* signed out here; the server's session runs out by itself */ } }
    },
    async authFetch(path, init = {}) {
      if (!on) throw fail('off');
      let t = read();
      if (!t) throw fail('signedOut');
      if (t.expiresAt - now() < REFRESH_EARLY_MS) { t = await refresh(t); if (!t) throw fail(st === 'signedOut' ? 'signedOut' : 'offline'); }
      /** @param {Tokens} tok */
      const go = async tok => { try { return await provider.fetchAuthed(path, init, tok.accessToken); } catch (e) { set('offline'); throw Object.assign(fail('offline'), { cause: e }); } };
      let res = await go(t);
      if (res.status === 401) {
        const t2 = await refresh(t);
        if (!t2) return res;
        res = await go(t2);
      }
      if (st === 'offline' && res.status < 500) set('signedIn');
      return res;
    },
    onChange(fn) { subs.add(fn); return () => { subs.delete(fn); }; },
    // stage 3: an Edge Function deletes the user; until then there is nothing on a server to delete
    async deleteAccount() { return { ok: false, error: on ? 'failed' : 'off' }; },
  };
}
