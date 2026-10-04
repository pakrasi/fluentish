/* Fluentish service worker. Lives at the app root, so its scope is the app root (/fluentish/ when deployed) and nothing
   else on the shared pakrasi.github.io origin. tools/stamp.mjs writes the deployed copy: it fills in VERSION and the
   PRECACHE list (the shell, v/<sha>/src, v/<sha>/styles, assets and the core content files addressed by hash).

   - Navigations: network first with a 3 s timeout, then the cached index.html.
   - v/<sha>/** and content/*?h=<hash>: immutable, cache first. The code of one deploy sits under one v/<sha>/ path, so
     modules from two deploys never mix (review S1).
   - Anything else in scope: network first with a timeout, cache fallback.
   - Never handled, so never cached: other origins (GitHub API, Anthropic API, fonts), other apps on this origin
     (b1-exam audio, Igloo), media and any Range request (Safari audio breaks otherwise, review S9), sw.js and
     version.json (the update check and the kill switch).
   - Updates: a new version installs and then waits. The page tells it to take over only while Today is showing
     (src/services/sw.js), never mid-round or mid-exam.
   - activate deletes only this app's old caches (fluentish-*), never another app's. */
const VERSION = 'dev'; // stamp:version
const PRECACHE = []; // stamp:precache

const CACHE = 'fluentish-' + VERSION;
const ROOT_URL = new URL('./', self.location.href).href;
const ROOT = new URL(ROOT_URL).pathname;
const MEDIA = /\.(mp3|m4a|aac|wav|ogg|oga|opus|webm|mp4|m4v|mov)$/i;
const NAV_TIMEOUT_MS = 3000;
const NET_TIMEOUT_MS = 4000;

/** How a request is handled: 'pass' (not touched), 'navigate', 'immutable' or 'network'. Pure; tests run it. */
function route(req) {
  if (req.method !== 'GET') return 'pass';
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return 'pass';
  if (!url.pathname.startsWith(ROOT)) return 'pass';
  if (req.headers.has('range') || MEDIA.test(url.pathname) || req.destination === 'audio' || req.destination === 'video') return 'pass';
  const rest = url.pathname.slice(ROOT.length);
  if (rest === 'sw.js' || rest === 'version.json') return 'pass';
  if (req.mode === 'navigate') return 'navigate';
  if (/^v\/[0-9a-f]{7,40}\//.test(rest)) return 'immutable';
  if (rest.startsWith('content/') && url.searchParams.has('h')) return 'immutable';
  return 'network';
}

const isImmutable = href => route({ method: 'GET', url: href, headers: new Headers(), mode: 'cors', destination: '' }) === 'immutable';

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await Promise.all(PRECACHE.map(async p => {
      const href = new URL(p, ROOT_URL).href;
      // an immutable file an older version already cached is copied, not downloaded again
      const old = isImmutable(href) ? await caches.match(href) : null;
      if (old) return c.put(href, old);
      const r = await fetch(href, { cache: 'reload' });
      if (!r.ok) throw new Error(`precache ${href}: HTTP ${r.status}`);
      await c.put(href, r);
    }));
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('fluentish-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('message', e => { if (e.data === 'skipWaiting') self.skipWaiting(); });

self.addEventListener('fetch', e => {
  const how = route(e.request);
  if (how === 'navigate') e.respondWith(navigate(e.request));
  else if (how === 'immutable') e.respondWith(cacheFirst(e.request));
  else if (how === 'network') e.respondWith(networkFirst(e.request, e.request, NET_TIMEOUT_MS));
});

/** Network first; after `ms` the cached copy if there is one, else keep waiting for the network. */
async function networkFirst(req, key, ms) {
  const net = fetch(req).then(async r => {
    if (r.ok && !r.redirected) await (await caches.open(CACHE)).put(key, r.clone());
    return r;
  });
  net.catch(() => {});   // answered from the cache: a late network failure is not an error
  const cached = () => caches.match(key, { ignoreSearch: typeof key === 'string' });
  try {
    return await Promise.race([net, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
  } catch {
    const hit = await cached();
    if (hit) return hit;
    return net.catch(() => Response.error());
  }
}

async function navigate(req) {
  const rest = new URL(req.url).pathname.slice(ROOT.length);
  if (rest === '' || rest === 'index.html') {
    const r = await networkFirst(req, ROOT_URL, NAV_TIMEOUT_MS);
    return r.redirected ? Response.redirect(r.url, 302) : r;
  }
  // a deep path: online, Pages answers with 404.html, which redirects to #/<path>; offline, redirect here
  try {
    const r = await fetch(req);
    return r.redirected ? Response.redirect(r.url, 302) : r;
  } catch {
    return Response.redirect(ROOT_URL + '#/' + rest.replace(/\/$/, ''), 302);
  }
}

async function cacheFirst(req) {
  const hit = await caches.match(req);
  if (hit) return hit;
  const r = await fetch(req);
  if (r.ok) await (await caches.open(CACHE)).put(req, r.clone());
  return r;
}
