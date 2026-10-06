/* The device link in a URL: b1-token.py opens Fluentish (and shows a QR code that does the same on the phone) with the
   results-sync token in the fragment, #token=… or #/profile?token=…. main.js calls takeLinkToken() as its very first
   statement, before the error log, the router or anything else can read or log the address: it takes the token out
   and rewrites the address with history.replaceState, so the token never stays in the location, in the session history,
   in a log line or in the error ring. main.js then stores it through the secrets path (device-scope kv 'secrets',
   never exported, never synced, never in a backup) and says "Device linked".

   A fragment is never sent to a server, so the token reaches no request either. One URL links once: after the rewrite
   a reload or Back finds no token.

   Two optional parameters (docs/SHARING.md › Device link): repo=owner/name, the repository the token is for (without
   it, main.js tries the owner's, data/connection.js OWNER), and exp=<unix seconds>, when the link stops working. A link
   whose exp has passed, or lies more than LINK_MAX_S ahead, is refused; the token is scrubbed either way and checked
   against GitHub before anything is stored (data/sync/token-check.js). */

/** How far ahead a link's exp may lie: a link is meant to be used within minutes of being made. */
export const LINK_MAX_S = 60 * 60;

/** What a token looks like (b1-token.py has checked it with GitHub already): one run of URL-safe characters. */
const TOKEN = /^[A-Za-z0-9_-]{20,255}$/;

/**
 * The fragment without its token: '#/profile?x=1' keeps its other parameters, '#token=…' becomes '#/profile'.
 * Returns null when the fragment carries no token.
 * @param {string} hash  location.hash, with its '#'
 * @returns {{ token: string, hash: string, repo?: string, exp?: number } | null}
 */
export function splitLinkHash(hash) {
  const raw = String(hash || '').replace(/^#/, '');
  if (!/(^|[?&])token=/.test(raw)) return null;
  const q = raw.indexOf('?');
  const path = q < 0 ? (raw.includes('=') ? '' : raw) : raw.slice(0, q);
  const params = new URLSearchParams(q < 0 ? raw : raw.slice(q + 1));
  const token = (params.get('token') || '').trim();
  const repo = (params.get('repo') || '').trim() || null;
  const exp = params.has('exp') ? Number(params.get('exp')) : null;
  for (const k of ['token', 'repo', 'exp']) params.delete(k);
  const rest = params.toString();
  const route = path.startsWith('/') ? path : '/profile';
  return { token, hash: `#${route}${rest ? `?${rest}` : ''}`, ...(repo ? { repo } : {}), ...(exp != null ? { exp } : {}) };
}

/**
 * Take a link token out of the address. Always scrubs a fragment that has one, valid or not; returns the token when it
 * looks like one, '' when the fragment had a token that is not (the caller says the link did not work), and null when
 * there was none.
 * @param {{ hash: string, pathname: string, search: string }} [loc]
 * @param {{ replaceState: (data: any, unused: string, url?: string) => void, state: any }} [hist]
 * @returns {string | null}
 */
export function takeLinkToken(loc = location, hist = history) {
  let found;
  try { found = splitLinkHash(loc.hash); } catch { found = null; }
  if (!found) return null;
  try { hist.replaceState(hist.state, '', `${loc.pathname}${loc.search}${found.hash}`); } catch { /* nothing else can be done */ }
  return TOKEN.test(found.token) ? found.token : '';
}

/**
 * Take a device link out of the address (takeLinkToken, with the link's repo and exp). null: no link; token '': the
 * link carried no usable token; expired: its exp has passed or is implausibly far ahead.
 * @param {{ hash: string, pathname: string, search: string }} [loc]
 * @param {{ replaceState: (data: any, unused: string, url?: string) => void, state: any }} [hist]
 * @param {() => number} [nowS] seconds since the epoch
 * @returns {{ token: string, repo: string | null, expired: boolean } | null}
 */
export function takeLink(loc = location, hist = history, nowS = () => Math.floor(Date.now() / 1000)) {
  let found;
  try { found = splitLinkHash(loc.hash); } catch { found = null; }
  if (!found) return null;
  try { hist.replaceState(hist.state, '', `${loc.pathname}${loc.search}${found.hash}`); } catch { /* nothing else can be done */ }
  const n = nowS();
  const expired = found.exp != null && !(Number.isFinite(found.exp) && found.exp >= n && found.exp - n <= LINK_MAX_S);
  return { token: TOKEN.test(found.token) ? found.token : '', repo: found.repo || null, expired };
}
