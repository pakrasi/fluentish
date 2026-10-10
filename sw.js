/* Fluentish service worker. Lives at the app root, so its scope is the app root (/fluentish/ when deployed) and nothing
   else on the shared pakrasi.github.io origin. tools/stamp.mjs writes the deployed copy: it fills in VERSION, the
   PRECACHE list (the shell, v/<sha>/src, v/<sha>/styles, assets, the content manifest and the shared content files,
   addressed by hash), PACKS (each language pack's content files, manifest packs[lang]) and TAKEOVER.

   - Install precaches PRECACHE and the packs its registration URL names: sw.js?packs=fr (src/services/sw.js asks for
     the active course's language). A registration without packs is German: every registration made before courses
     has that URL, so his German pack is precached as it always was. Install fails (and the installed worker keeps
     serving) when the shell it fetched is not its own version (a deploy landed meanwhile) or the manifest does not
     match its hash.

   - A launch never waits on the network. The shell (index.html) and the other unversioned files it precached
     (assets/) come from this worker's own cache, so the page, its code and its content manifest are always one
     version (review S1). A new deploy reaches the device as a new worker: the browser checks sw.js on every launch and
     the page checks again when it becomes visible; the new worker installs in the background, waits, and takes over
     from Today (below). Without a cached shell (never after a good install) navigations are network first, 3 s.
   - v/<sha>/** and content/*?h=<hash> (the manifest included): immutable, cache first. The code of one deploy sits
     under one v/<sha>/ path, so modules from two deploys never mix.
   - Anything else in scope: network first with a timeout, cache fallback.
   - Google Fonts, on the deployed origin only: the font files (immutable URLs) cache first, the stylesheet from the
     cache with a refresh in the background, in the cache fluentish-fonts that deploys keep. A dev or test origin
     (localhost, 127.0.0.1) never fetches another origin from the worker.
   - Never handled, so never cached: other origins (GitHub API, Anthropic API), other apps on this origin (b1-exam
     audio, Igloo), media and any Range request (Safari audio breaks otherwise, review S9), sw.js and version.json (the
     update check and the kill switch).
   - Updates: a new version installs and then waits. The page tells it to take over only while Today is showing
     (src/services/sw.js), never mid-round or mid-exam. TAKEOVER 'now' (deploy with sw=now, an emergency fix) takes
     over as soon as it is installed instead.
   - Kill switch: a deploy with sw=off publishes a different sw.js (tools/stamp.mjs killSw) that takes over at once,
     deletes this app's caches and unregisters itself; docs/ARCHITECTURE.md §7 has the procedure.
   - Lazy content (the word families, manifest lazy: true) is not precached; install copies forward any lazy file an
     older version cached under the same hash (content/manifest.json lists them), so a deploy keeps them offline.
   - activate deletes only this app's old caches (fluentish-*, but not fluentish-fonts), never another app's. */
const VERSION = 'dev'; // stamp:version
const PRECACHE = []; // stamp:precache
const PACKS = {}; // stamp:packs
const TAKEOVER = 'today'; // stamp:takeover

const CACHE = 'fluentish-' + VERSION;
const FONT_CACHE = 'fluentish-fonts';
const ROOT_URL = new URL('./', self.location.href).href;
const ROOT = new URL(ROOT_URL).pathname;
const MEDIA = /\.(mp3|m4a|aac|wav|ogg|oga|opus|webm|mp4|m4v|mov)$/i;
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])$/;
const NAV_TIMEOUT_MS = 3000;
const NET_TIMEOUT_MS = 4000;
const DEFAULT_PACKS = ['de'];

/** The language packs this registration precaches: ?packs=fr,de on the script URL, else German. Pure; tests run it. */
function packsOf(href) {
  const q = new URL(href).searchParams.get('packs');
  const want = q ? q.split(',').map(s => s.trim()).filter(p => /^[a-z]{2,3}$/.test(p)) : [];
  return want.length ? want : DEFAULT_PACKS;
}

/** Everything install fetches: the shell and shared content, then the named packs' files. Pure; tests run it. */
function precacheList(href) {
  return [...PRECACHE, ...packsOf(href).flatMap(p => PACKS[p] || [])];
}

/** Immutable by its path: one deploy's code (v/<sha>/) or a content file addressed by hash (?h=). Pure. @param {URL} url */
function immutableUrl(url) {
  const rest = url.pathname.slice(ROOT.length);
  return /^v\/[0-9a-f]{7,40}\//.test(rest) || (rest.startsWith('content/') && url.searchParams.has('h'));
}

/** The unversioned files install put in this worker's cache (the shell, assets/): absolute URLs without a query. */
const OWN = new Set(PRECACHE.map(p => new URL(p, ROOT_URL)).filter(u => !u.search && !immutableUrl(u)).map(u => u.href));

/**
 * How a request is handled: 'pass' (not touched), 'navigate', 'immutable', 'own' (this worker's precached copy),
 * 'font' (Google Fonts, deployed origin only) or 'network'. Pure; tests run it.
 */
function route(req) {
  if (req.method !== 'GET') return 'pass';
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) {
    return url.protocol === 'https:' && FONT_HOSTS.includes(url.hostname) && !LOCAL_HOST.test(self.location.hostname) ? 'font' : 'pass';
  }
  if (!url.pathname.startsWith(ROOT)) return 'pass';
  if (req.headers.has('range') || MEDIA.test(url.pathname) || req.destination === 'audio' || req.destination === 'video') return 'pass';
  const rest = url.pathname.slice(ROOT.length);
  if (rest === 'sw.js' || rest === 'version.json') return 'pass';
  if (req.mode === 'navigate') return 'navigate';
  if (immutableUrl(url)) return 'immutable';
  if (!url.search && OWN.has(url.href)) return 'own';
  return 'network';
}

const isImmutable = href => route({ method: 'GET', url: href, headers: new Headers(), mode: 'cors', destination: '' }) === 'immutable';

/**
 * Why a precached file must not be kept, or null when it is right: the shell must load this version's code (a deploy
 * that landed while this one installed serves a newer index.html), and the manifest must match the hash in its URL.
 * @param {string} p a PRECACHE entry  @param {ArrayBuffer} body
 */
async function mismatch(p, body) {
  if (p === './') return new TextDecoder().decode(body).includes(`v/${VERSION}`) ? null : `the shell is not version ${VERSION}`;
  const m = /^content\/manifest\.json\?h=([0-9a-f]+)$/.exec(p);
  if (!m) return null;
  const hex = [...new Uint8Array(await crypto.subtle.digest('SHA-256', body))].map(b => b.toString(16).padStart(2, '0')).join('');
  return hex.startsWith(m[1]) ? null : `the manifest does not match ${m[1]}`;
}
const checked = p => p === './' || p.startsWith('content/manifest.json?h=');

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await Promise.all(precacheList(self.location.href).map(async p => {
      const href = new URL(p, ROOT_URL).href;
      // an immutable file an older version already cached is copied, not downloaded again
      const old = isImmutable(href) && !checked(p) ? await caches.match(href) : null;
      if (old) return c.put(href, old);
      const r = await fetch(href, { cache: 'reload' });
      if (!r.ok || r.redirected) throw new Error(`precache ${href}: HTTP ${r.status}${r.redirected ? ', redirected' : ''}`);
      if (checked(p)) {
        const why = await mismatch(p, await r.clone().arrayBuffer());
        if (why) throw new Error(`precache ${href}: ${why}`);   // the installed worker keeps serving; the next check retries
      }
      await c.put(href, r);
    }));
    await copyLazy(c);
    if (TAKEOVER === 'now') await self.skipWaiting();
  })());
});

/** The lazy content files of a manifest (the word families, one file per root): never precached, cached on first use. Pure; tests run it. */
function lazyList(manifest) {
  return ((manifest && manifest.files) || []).filter(f => f.lazy && f.path && f.sha256).map(f => `content/${f.path}?h=${String(f.sha256).slice(0, 8)}`);
}

/** A lazy file an older version cached under the same hash is copied forward, so a deploy keeps what he opened offline. */
async function copyLazy(c) {
  try {
    const entry = PRECACHE.find(p => p === 'content/manifest.json' || p.startsWith('content/manifest.json?'));
    const m = entry && await c.match(new URL(entry, ROOT_URL).href);
    if (!m) return;
    await Promise.all(lazyList(await m.json()).map(async p => {
      const href = new URL(p, ROOT_URL).href;
      const old = await caches.match(href);
      if (old) await c.put(href, old);
    }));
  } catch { /* the copy is a saving, never a reason to fail the install */ }
}

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('fluentish-') && k !== CACHE && k !== FONT_CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('message', e => { if (e.data === 'skipWaiting') self.skipWaiting(); });

self.addEventListener('fetch', e => {
  const how = route(e.request);
  if (how === 'navigate') e.respondWith(navigate(e.request));
  else if (how === 'immutable') e.respondWith(cacheFirst(e.request));
  else if (how === 'own') e.respondWith(own(e.request));
  else if (how === 'font') e.respondWith(font(e));
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

/** A precached unversioned file from this worker's own cache (its version's copy); network first if it is missing. */
async function own(req) {
  const url = new URL(req.url);
  const hit = await (await caches.open(CACHE)).match(url.origin + url.pathname);
  return hit && !hit.redirected ? hit : networkFirst(req, req, NET_TIMEOUT_MS);
}

async function navigate(req) {
  const rest = new URL(req.url).pathname.slice(ROOT.length);
  if (rest === '' || rest === 'index.html') {
    // the shell this worker installed, at once: a launch never waits on the network, and the page it loads is this
    // worker's version, whose code and manifest are in the same cache (an update arrives as a new worker)
    const shell = OWN.has(ROOT_URL) ? await (await caches.open(CACHE)).match(ROOT_URL) : null;
    if (shell && !shell.redirected) return shell;
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

/** This worker's copy first (the one install checked), then any older version's copy of the same immutable URL. */
async function cacheFirst(req) {
  const hit = (await (await caches.open(CACHE)).match(req)) || await caches.match(req);
  if (hit) return hit;
  const r = await fetch(req);
  if (r.ok) await (await caches.open(CACHE)).put(req, r.clone());
  return r;
}

/**
 * Google Fonts (deployed origin only). The font files have immutable URLs: cache first. The stylesheet is answered from
 * the cache when there is a copy and refreshed in the background (Google changes it rarely); a refresh drops the font
 * files no cached stylesheet names any more. Fetched with CORS, so nothing opaque is stored. Without a copy and without
 * a network the request fails as it would without the worker, and the page falls back to the system fonts.
 */
async function font(e) {
  const key = e.request.url;
  const c = await caches.open(FONT_CACHE);
  const hit = await c.match(key);
  const sheet = new URL(key).hostname === 'fonts.googleapis.com';
  if (hit && !sheet) return hit;
  const net = fetch(key, { mode: 'cors', credentials: 'omit' }).then(async r => {
    if (r.status === 200 && r.type === 'cors') {
      await c.put(key, r.clone());
      if (sheet) await pruneFonts(c);
    }
    return r;
  });
  if (!hit) return net;
  try { e.waitUntil(net.catch(() => {})); } catch { /* the refresh still runs while the worker is awake */ }
  return hit;
}

async function pruneFonts(c) {
  const keys = await c.keys();
  const host = k => new URL(k.url).hostname;
  const sheets = (await Promise.all(keys.filter(k => host(k) === 'fonts.googleapis.com').map(async k => (await c.match(k))?.text() ?? ''))).join('\n');
  await Promise.all(keys.filter(k => host(k) === 'fonts.gstatic.com' && !sheets.includes(k.url)).map(k => c.delete(k)));
}
