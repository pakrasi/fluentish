// The deploy build (tools/stamp.mjs), the service worker's routing (sw.js) and its page side (src/services/sw.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stampIndex, stampSw, importGraph, pickKept, contentPrecache, swSetting, stampTakeover, killSw, withManifestHash } from '../../tools/stamp.mjs';
import { createContent } from '../../src/data/content.js';
import { createSw } from '../../src/services/sw.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SHA = 'a'.repeat(40);

test('stampIndex moves every src/ and styles/ reference under v/<sha>/ and preloads the boot graph', () => {
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const out = stampIndex(html, SHA, ['src/main.js', 'src/core/config.js']);
  assert.match(out, new RegExp(`<script src="v/${SHA}/src/boot.js">`));
  assert.match(out, new RegExp(`<script type="module" src="v/${SHA}/src/main.js">`));
  assert.match(out, new RegExp(`href="v/${SHA}/styles/tokens.css"`));
  assert.equal((out.match(/rel="modulepreload"/g) || []).length, 2);
  assert.doesNotMatch(out, /\s(src|href)="(src|styles)\//);
  assert.match(out, /href="assets\/favicon.svg"/, 'assets stay at the root');
});

test('importGraph follows static imports only', () => {
  const files = {
    'src/main.js': "import { a } from './a.js';\nimport './side.js';\nexport { b } from './lib/b.js';\nconst x = import('./lazy.js');\n// import './commented.js'\n",
    'src/a.js': "import { c } from './lib/c.js';",
    'src/side.js': '', 'src/lib/b.js': "import '../a.js';", 'src/lib/c.js': '',
  };
  const g = importGraph('src/main.js', p => { if (!(p in files)) throw new Error(p); return files[p]; });
  assert.deepEqual(g.sort(), ['src/a.js', 'src/lib/b.js', 'src/lib/c.js', 'src/main.js', 'src/side.js']);
});

test('importGraph of the real app resolves every file', () => {
  const g = importGraph('src/main.js', p => readFileSync(path.join(ROOT, p), 'utf8'));
  assert.ok(g.includes('src/core/config.js') && g.includes('src/services/sw.js'));
});

test('stampSw fills in the version and the precache list, and fails without its markers', () => {
  const js = readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const out = stampSw(js, SHA, ['./', 'content/manifest.json']);
  assert.match(out, /const VERSION = 'aaaaaaaaaaaa'; \/\/ stamp:version/);
  assert.match(out, /const PRECACHE = \[".\/","content\/manifest.json"\]; \/\/ stamp:precache/);
  assert.match(out, /const PACKS = \{\}; \/\/ stamp:packs/);
  assert.match(stampSw(js, SHA, [], { de: ['content/a.json?h=1'] }), /const PACKS = \{"de":\["content\/a.json\?h=1"\]\}; \/\/ stamp:packs/);
  assert.throws(() => stampSw('const x = 1;', SHA, []));
});

test('pickKept keeps at most two earlier deployable versions, live first', () => {
  const ok = (/** @type {string} */ s) => s !== 'old';
  assert.deepEqual(pickKept('cur', ['live', 'cur', 'live', 'k1', 'k2', 'p1'], ok), ['live', 'k1']);
  assert.deepEqual(pickKept('cur', [undefined, 'old', 'p1'], ok), ['p1']);
});

test('German precache (shared + the de pack) covers B1, the mock exams and German Look up, and no other language', () => {
  const m = JSON.parse(readFileSync(path.join(ROOT, 'content/manifest.json'), 'utf8'));
  const { shared, packs } = contentPrecache(m);
  const urlOf = (/** @type {string} */ id) => { const f = m.files.find((/** @type {any} */ x) => x.id === id); return `content/${f.path}?h=${f.sha256.slice(0, 8)}`; };
  const de = new Set([...shared, ...packs.de]);
  for (const id of ['b1.items', 'exam.goethe-b1.01', 'exam.goethe-b1.why.01', 'igloo.framework', 'igloo.lang.german', 'igloo.chunks.en', 'speak.situations', 'atlas.de']) assert.ok(de.has(urlOf(id)), id);
  for (const id of ['igloo.lang.french', 'igloo.chunks.spanish']) assert.ok(!de.has(urlOf(id)), id);
});

/** sw.js in a sandbox whose location is the deployed root (or `where`); `js` is a stamped copy when given. */
function loadSw({ js = readFileSync(path.join(ROOT, 'sw.js'), 'utf8'), where = 'https://pakrasi.github.io/fluentish/sw.js', env = {} } = {}) {
  const listeners = {};
  const ctx = { URL, URLSearchParams, Headers, Response, TextDecoder, crypto: globalThis.crypto, setTimeout, Promise, location: new URL(where),
    addEventListener: (t, f) => { listeners[t] = f; }, listeners, ...env };
  ctx.self = ctx;
  vm.runInNewContext(js, ctx);
  return /** @type {any} */ (ctx);
}
const req = (url, o = {}) => ({ method: 'GET', url, headers: new Headers(o.headers || {}), mode: o.mode || 'cors', destination: o.destination || '', ...o.extra });

test('sw.js never touches other origins, other apps, media, Range requests, sw.js or version.json', () => {
  const { route } = loadSw();
  for (const u of ['https://api.github.com/repos/x/y/contents/a', 'https://api.anthropic.com/v1/messages', 'http://fonts.gstatic.com/a.woff2',
    'https://pakrasi.github.io/b1-exam/audio/day01/teil1.mp3', 'https://pakrasi.github.io/language-doors/app.html',
    'https://pakrasi.github.io/fluentish/sw.js', 'https://pakrasi.github.io/fluentish/version.json',
    'https://pakrasi.github.io/fluentish/rec/take.m4a']) assert.equal(route(req(u)), 'pass', u);
  assert.equal(route(req('https://pakrasi.github.io/fluentish/content/b1/items.json?h=1', { headers: { range: 'bytes=0-' } })), 'pass');
  assert.equal(route(req('https://pakrasi.github.io/fluentish/x', { destination: 'audio' })), 'pass');
  assert.equal(route({ ...req('https://pakrasi.github.io/fluentish/'), method: 'POST' }), 'pass');
});

test('sw.js routes navigations, versioned code, hashed content and the rest', () => {
  const { route } = loadSw();
  assert.equal(route(req('https://pakrasi.github.io/fluentish/', { mode: 'navigate' })), 'navigate');
  assert.equal(route(req(`https://pakrasi.github.io/fluentish/v/${SHA}/src/main.js`)), 'immutable');
  assert.equal(route(req('https://pakrasi.github.io/fluentish/content/b1/items.json?h=abcd1234')), 'immutable');
  assert.equal(route(req('https://pakrasi.github.io/fluentish/content/manifest.json?h=abcd1234')), 'immutable');
  // an unstamped worker (dev) has no precache of its own: the shell, the plain manifest and assets are network first
  assert.equal(route(req('https://pakrasi.github.io/fluentish/content/manifest.json')), 'network');
  assert.equal(route(req('https://pakrasi.github.io/fluentish/assets/favicon.svg')), 'network');
});

/** A fake navigator.serviceWorker with registrations for several apps on the origin. */
function fakeEnv({ registered = true, waiting = false, controller = true, version = { sha: 'x', sw: 'on' } } = {}) {
  const root = 'https://pakrasi.github.io/fluentish/';
  const events = {}, unregistered = [], deleted = [], posted = [], reloads = [];
  const mk = scope => ({ scope, waiting: null, installing: null, unregister: async () => { unregistered.push(scope); return true; }, update: async () => {}, addEventListener: () => {} });
  const regs = [mk('https://pakrasi.github.io/language-doors/'), mk('https://pakrasi.github.io/')];
  const ours = mk(root);
  if (waiting) ours.waiting = { postMessage: m => posted.push(m) };
  if (registered) regs.push(ours);
  const container = {
    controller: controller ? {} : null,
    getRegistrations: async () => regs,
    getRegistration: async () => (registered ? ours : regs[1]),   // without ours, the origin-root one matches
    register: async (url, o) => { assert.equal(o.scope, root); registered = true; regs.push(ours); return ours; },
    addEventListener: (t, f) => { events[t] = f; },
  };
  const win = {
    fetch: async () => ({ ok: true, json: async () => version }),
    caches: { keys: async () => ['igloo-20261002g', 'igloo-fonts', 'fluentish-aaa', 'other'], delete: async k => { deleted.push(k); return true; } },
    location: { reload: () => reloads.push(1) },
    document: { visibilityState: 'visible', addEventListener: () => {} },
  };
  return { root, container, win, events, unregistered, deleted, posted, reloads, ours, nav: { serviceWorker: container } };
}
const tick = () => new Promise(r => setTimeout(r, 0));

test('the service worker is off on a dev server unless ?sw=on', async () => {
  const e = fakeEnv({ registered: false });
  const sw = createSw({ root: e.root, dev: true, nav: e.nav, win: e.win });
  sw.start(); await tick();
  assert.equal(sw.state.status, 'off');
  const on = createSw({ root: e.root, dev: true, devOptIn: true, nav: e.nav, win: e.win });
  on.start(); await tick(); await tick();
  assert.equal(on.state.status, 'registered');
});

test('it registers again after another app unregistered it, and ignores a wider-scope registration', async () => {
  const e = fakeEnv({ registered: false });
  const sw = createSw({ root: e.root, dev: false, nav: e.nav, win: e.win });
  sw.start(); await tick(); await tick();
  assert.equal(sw.state.status, 'registered');
  assert.deepEqual(e.unregistered, []);
});

test('the kill switch unregisters only this app and deletes only fluentish-* caches', async () => {
  const e = fakeEnv({ version: { sha: 'x', sw: 'off' } });
  const sw = createSw({ root: e.root, dev: false, nav: e.nav, win: e.win });
  sw.start(); await tick(); await tick(); await tick();
  assert.equal(sw.state.status, 'killed');
  assert.deepEqual(e.unregistered, [e.root]);
  assert.deepEqual(e.deleted, ['fluentish-aaa']);
});

test('a waiting update takes over only on Today, and only a takeover the page asked for reloads it', async () => {
  const e = fakeEnv({ waiting: true });
  const sw = createSw({ root: e.root, dev: false, nav: e.nav, win: e.win });
  sw.atRest(false);
  sw.start(); await tick(); await tick();
  assert.deepEqual(e.posted, [], 'mid-round: no takeover');
  e.events.controllerchange();
  assert.equal(e.reloads.length, 0, 'a takeover it did not ask for does not reload');
  sw.atRest(true);
  assert.deepEqual(e.posted, ['skipWaiting']);
  e.events.controllerchange();
  assert.equal(e.reloads.length, 1);
});

test('a waiting update does not reload a page that left Today before the takeover', async () => {
  const e = fakeEnv({ waiting: true });
  const sw = createSw({ root: e.root, dev: false, nav: e.nav, win: e.win });
  sw.atRest(true);
  sw.start(); await tick(); await tick();
  sw.atRest(false);
  e.events.controllerchange();
  assert.equal(e.reloads.length, 0);
});

test('the kill switch comes from --sw, then FLUENTISH_SW, then "on"; nothing else is accepted', () => {
  assert.equal(swSetting(undefined, undefined), 'on');
  assert.equal(swSetting(undefined, ''), 'on');
  assert.equal(swSetting(undefined, 'off'), 'off');
  assert.equal(swSetting('on', 'off'), 'on', 'the flag wins');
  assert.equal(swSetting('OFF', undefined), 'off');
  assert.throws(() => swSetting('of', undefined));
  assert.throws(() => swSetting(undefined, 'false'));
});

// ---- round 8 (P4): a launch never waits on the network; installs that would mix versions fail; fonts; kill worker ----

const DEP = 'https://pakrasi.github.io/fluentish/';
const SHELL = `<!doctype html><html><head><meta charset="utf-8">\n<script type="module" src="v/${SHA}/src/main.js"></script></head></html>`;
const MANIFEST = '{"files":[]}';
const sha8 = (/** @type {string} */ t) => createHash('sha256').update(t).digest('hex').slice(0, 8);

/** CacheStorage over Maps, keyed by URL (a query is part of the key). */
function fakeCaches(/** @type {Record<string, Record<string, Response>>} */ seed = {}) {
  /** @type {Map<string, Map<string, Response>>} */ const all = new Map();
  const keyOf = (/** @type {any} */ k) => (typeof k === 'string' ? k : k.url);
  const open = (/** @type {string} */ name) => {
    if (!all.has(name)) all.set(name, new Map());
    const m = /** @type {Map<string, Response>} */ (all.get(name));
    return {
      match: async (/** @type {any} */ k) => m.get(keyOf(k))?.clone(),
      put: async (/** @type {any} */ k, /** @type {Response} */ r) => { m.set(keyOf(k), r); },
      keys: async () => [...m.keys()].map(url => ({ url })),
      delete: async (/** @type {any} */ k) => m.delete(keyOf(k)),
    };
  };
  for (const [name, entries] of Object.entries(seed)) all.set(name, new Map(Object.entries(entries)));
  return {
    all,
    open: async (/** @type {string} */ n) => open(n),
    keys: async () => [...all.keys()],
    delete: async (/** @type {string} */ n) => all.delete(n),
    match: async (/** @type {any} */ k) => { for (const m of all.values()) if (m.has(keyOf(k))) return m.get(keyOf(k))?.clone(); return undefined; },
  };
}

/** A stamped sw.js in a sandbox with fake caches and a fake network (`files`: URL → body; anything else fails). */
function stampedSw({ precache = ['./', `content/manifest.json?h=${sha8(MANIFEST)}`, 'assets/favicon.svg', `v/${SHA}/src/main.js`], files = {}, seed = {}, sw = 'on', where } = {}) {
  const js = stampTakeover(stampSw(readFileSync(path.join(ROOT, 'sw.js'), 'utf8'), SHA, precache), /** @type {any} */ (sw));
  const caches = fakeCaches(seed);
  /** @type {string[]} */ const fetched = [];
  const net = { [DEP]: SHELL, [`${DEP}content/manifest.json?h=${sha8(MANIFEST)}`]: MANIFEST, [`${DEP}assets/favicon.svg`]: '<svg/>', [`${DEP}v/${SHA}/src/main.js`]: '//', ...files };
  const fetch = async (/** @type {any} */ r, /** @type {any} */ o = {}) => {
    const url = typeof r === 'string' ? r : r.url;
    fetched.push(url);
    if (!(url in net)) throw new TypeError('network down');
    const res = new Response(net[url], { status: 200 });
    Object.defineProperty(res, 'type', { value: o.mode === 'cors' || url.startsWith(DEP) ? (url.startsWith(DEP) ? 'basic' : 'cors') : 'opaque' });
    return res;
  };
  /** @type {string[]} */ const calls = [];
  const ctx = loadSw({ js, where, env: { caches, fetch, skipWaiting: async () => { calls.push('skipWaiting'); }, clients: { claim: async () => { calls.push('claim'); } } } });
  return { ctx, caches, fetched, calls, net };
}
/** Runs an install or activate listener; resolves when its waitUntil settles. */
async function fire(/** @type {any} */ ctx, /** @type {string} */ type) {
  /** @type {Promise<any>[]} */ const waits = [];
  ctx.listeners[type]({ waitUntil: (/** @type {Promise<any>} */ p) => waits.push(p) });
  await Promise.all(waits);
}
/** Runs the fetch listener for a request; resolves with its response (or null when it is not handled). */
async function respond(/** @type {any} */ ctx, /** @type {any} */ request) {
  /** @type {any} */ let answer = null; /** @type {Promise<any>[]} */ const waits = [];
  ctx.listeners.fetch({ request, respondWith: (/** @type {any} */ p) => { answer = p; }, waitUntil: (/** @type {Promise<any>} */ p) => waits.push(p) });
  const r = answer && await answer;
  await Promise.all(waits);
  return r;
}

test('a stamped worker serves the shell and assets from its own cache, without the network', async () => {
  const { ctx, caches, fetched } = stampedSw();
  assert.equal(ctx.route(req(`${DEP}assets/favicon.svg`)), 'own');
  assert.equal(ctx.route(req(`${DEP}assets/favicon.svg?x=1`)), 'network');
  assert.equal(ctx.route(req(`${DEP}assets/other.svg`)), 'network', 'not precached: network first');
  await fire(ctx, 'install');
  assert.ok(caches.all.get(`fluentish-${SHA.slice(0, 12)}`)?.has(DEP));
  fetched.length = 0;
  const shell = await respond(ctx, req(`${DEP}?sw=on`, { mode: 'navigate' }));
  assert.equal(await shell.text(), SHELL);
  assert.equal(await (await respond(ctx, req(`${DEP}index.html`, { mode: 'navigate' }))).text(), SHELL);
  assert.equal(await (await respond(ctx, req(`${DEP}assets/favicon.svg`))).text(), '<svg/>');
  assert.equal(await (await respond(ctx, req(`${DEP}content/manifest.json?h=${sha8(MANIFEST)}`))).text(), MANIFEST);
  assert.deepEqual(fetched, [], 'a warm launch fetches nothing');
});

test('the shell it serves is the one of its own version, even when a newer worker cached another', async () => {
  const other = { [DEP]: new Response('newer shell') };
  const { ctx } = stampedSw({ seed: { 'fluentish-bbbbbbbbbbbb': other } });
  await fire(ctx, 'install');
  assert.equal(await (await respond(ctx, req(DEP, { mode: 'navigate' }))).text(), SHELL);
});

test('install fails when the shell it fetched is another version (a deploy landed meanwhile), and keeps no shell', async () => {
  const { ctx, caches } = stampedSw({ files: { [DEP]: SHELL.replaceAll(SHA, 'c'.repeat(40)) } });
  await assert.rejects(fire(ctx, 'install'), /the shell is not version/);
  assert.ok(!caches.all.get(`fluentish-${SHA.slice(0, 12)}`)?.has(DEP));
});

test('install fails when the manifest does not match the hash in its URL, and never copies one from an older cache', async () => {
  const url = `${DEP}content/manifest.json?h=${sha8(MANIFEST)}`;
  const bad = stampedSw({ files: { [url]: '{"files":[1]}' } });
  await assert.rejects(fire(bad.ctx, 'install'), /manifest does not match/);
  // an older cache holding a wrong copy under the right URL: fetched and checked again, so the bad copy never spreads
  const old = stampedSw({ seed: { 'fluentish-old': { [url]: new Response('{"wrong":1}') } } });
  await fire(old.ctx, 'install');
  assert.ok(old.fetched.includes(url));
  assert.equal(await (await respond(old.ctx, req(url))).text(), MANIFEST);
});

test('an unchanged immutable file is still copied from an older cache, not downloaded', async () => {
  const main = `${DEP}v/${SHA}/src/main.js`;
  const { ctx, fetched } = stampedSw({ seed: { 'fluentish-old': { [main]: new Response('//') } } });
  await fire(ctx, 'install');
  assert.ok(!fetched.includes(main));
});

test('an unstamped worker (dev) keeps the shell network first', async () => {
  const caches = fakeCaches();
  /** @type {string[]} */ const fetched = [];
  const ctx = loadSw({ env: { caches, fetch: async (/** @type {any} */ r) => { fetched.push(typeof r === 'string' ? r : r.url); return new Response('fresh'); } } });
  assert.equal(await (await respond(ctx, req(DEP, { mode: 'navigate' }))).text(), 'fresh');
  assert.equal(await (await respond(ctx, req(DEP, { mode: 'navigate' }))).text(), 'fresh');
  assert.equal(fetched.length, 2);
});

test('TAKEOVER: a worker stamped sw=now takes over once installed; the normal one waits for the page', async () => {
  const now = stampedSw({ sw: 'now' });
  await fire(now.ctx, 'install');
  assert.deepEqual(now.calls, ['skipWaiting']);
  const normal = stampedSw();
  await fire(normal.ctx, 'install');
  assert.deepEqual(normal.calls, []);
  assert.throws(() => stampTakeover('const x = 1;', 'on'));
});

test('activate deletes older fluentish caches but keeps the fonts and every other app\'s caches', async () => {
  const { ctx, caches } = stampedSw({ seed: { 'fluentish-old': {}, 'fluentish-fonts': {}, 'igloo-fonts': {}, other: {} } });
  await fire(ctx, 'install');
  await fire(ctx, 'activate');
  assert.deepEqual((await caches.keys()).sort(), [`fluentish-${SHA.slice(0, 12)}`, 'fluentish-fonts', 'igloo-fonts', 'other'].sort());
});

test('Google Fonts: cached on the deployed origin (files cache first, the stylesheet refreshed behind), never on a local one', async () => {
  const css = 'https://fonts.googleapis.com/css2?family=Geist';
  const woff = 'https://fonts.gstatic.com/s/geist/v1/a.woff2', gone = 'https://fonts.gstatic.com/s/geist/v0/old.woff2';
  const local = stampedSw({ where: 'http://127.0.0.1:8471/fluentish/sw.js' });
  assert.equal(local.ctx.route(req(css, { destination: 'style' })), 'pass');
  assert.equal(local.ctx.route(req(woff, { destination: 'font' })), 'pass');
  const { ctx, caches, fetched } = stampedSw({ files: { [css]: `@font-face{src:url(${woff})}`, [woff]: 'font' } });
  assert.equal(ctx.route(req(css, { destination: 'style' })), 'font');
  assert.equal(ctx.route(req(woff, { destination: 'font' })), 'font');
  // first visit: from the network, then kept
  assert.equal(await (await respond(ctx, req(css))).text(), `@font-face{src:url(${woff})}`);
  assert.equal(await (await respond(ctx, req(woff))).text(), 'font');
  await (await caches.open('fluentish-fonts')).put(gone, new Response('old'));
  fetched.length = 0;
  // a file: cache, no network; the stylesheet: the cached copy, refreshed in the background, which drops `gone`
  assert.equal(await (await respond(ctx, req(woff))).text(), 'font');
  assert.deepEqual(fetched, []);
  assert.equal(await (await respond(ctx, req(css))).text(), `@font-face{src:url(${woff})}`);
  assert.deepEqual(fetched, [css]);
  assert.deepEqual((await (await caches.open('fluentish-fonts')).keys()).map(k => k.url).sort(), [css, woff].sort());
  // offline with a copy: still answered
  const off = stampedSw({ seed: { 'fluentish-fonts': { [css]: new Response('cached') } } });
  assert.equal(await (await respond(off.ctx, req(css))).text(), 'cached');
});

test('the kill worker (sw=off) takes over at once, deletes only fluentish-* caches, unregisters, and handles no fetch', async () => {
  const caches = fakeCaches({ 'fluentish-aaa': {}, 'fluentish-fonts': {}, 'igloo-20261002g': {}, other: {} });
  /** @type {string[]} */ const calls = [];
  const ctx = loadSw({ js: killSw(), env: { caches, skipWaiting: () => { calls.push('skipWaiting'); }, registration: { unregister: async () => { calls.push('unregister'); return true; } } } });
  assert.equal(ctx.listeners.fetch, undefined);
  ctx.listeners.install({});
  await fire(ctx, 'activate');
  assert.deepEqual(calls, ['skipWaiting', 'unregister']);
  assert.deepEqual((await caches.keys()).sort(), ['igloo-20261002g', 'other']);
});

test('sw=now is accepted; the shell names the manifest hash once', () => {
  assert.equal(swSetting('now', undefined), 'now');
  assert.equal(swSetting(undefined, 'NOW'), 'now');
  const html = withManifestHash('<head>\n<meta charset="utf-8">\n<title>x</title>', 'abcd1234');
  assert.equal(html, '<head>\n<meta charset="utf-8">\n<meta name="fluentish-manifest" content="abcd1234">\n<title>x</title>');
  assert.throws(() => withManifestHash(html, 'xyz'));
  assert.throws(() => withManifestHash('<head></head>', 'abcd1234'));
  // the real shell has the line it needs
  assert.match(withManifestHash(readFileSync(path.join(ROOT, 'index.html'), 'utf8'), 'abcd1234'), /<meta name="fluentish-manifest" content="abcd1234">/);
});

test('content: the manifest is fetched by its hash when the shell names one, else plain and revalidated', async () => {
  /** @type {[string, any][]} */ const calls = [];
  const f = /** @type {any} */ (async (/** @type {string} */ url, /** @type {any} */ o) => { calls.push([url, o.cache]); return new Response('{"files":[],"exams":[]}'); });
  await createContent({ base: `${DEP}content/`, fetch: f, manifestHash: 'abcd1234' }).manifest();
  await createContent({ base: `${DEP}content/`, fetch: f }).manifest();
  assert.deepEqual(calls, [[`${DEP}content/manifest.json?h=abcd1234`, 'default'], [`${DEP}content/manifest.json`, 'no-cache']]);
});
