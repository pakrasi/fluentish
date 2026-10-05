// The deploy build (tools/stamp.mjs), the service worker's routing (sw.js) and its page side (src/services/sw.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stampIndex, stampSw, importGraph, pickKept, CORE_CONTENT, swSetting } from '../../tools/stamp.mjs';
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
  assert.throws(() => stampSw('const x = 1;', SHA, []));
});

test('pickKept keeps at most two earlier deployable versions, live first', () => {
  const ok = (/** @type {string} */ s) => s !== 'old';
  assert.deepEqual(pickKept('cur', ['live', 'cur', 'live', 'k1', 'k2', 'p1'], ok), ['live', 'k1']);
  assert.deepEqual(pickKept('cur', [undefined, 'old', 'p1'], ok), ['p1']);
});

test('core content covers B1, the mock exams and German Look up', () => {
  for (const id of ['b1.items', 'exam.goethe-b1.01', 'exam.goethe-b1.why.01', 'igloo.framework', 'igloo.lang.german', 'igloo.chunks.en', 'speak.situations', 'atlas.de']) assert.ok(CORE_CONTENT.test(id), id);
  for (const id of ['igloo.lang.french', 'igloo.chunks.spanish']) assert.ok(!CORE_CONTENT.test(id), id);
});

/** sw.js in a sandbox whose location is the deployed root. */
function loadSw() {
  const listeners = {};
  const ctx = { URL, Headers, setTimeout, Promise, location: new URL('https://pakrasi.github.io/fluentish/sw.js'), addEventListener: (t, f) => { listeners[t] = f; } };
  ctx.self = ctx;
  vm.runInNewContext(readFileSync(path.join(ROOT, 'sw.js'), 'utf8'), ctx);
  return /** @type {any} */ (ctx);
}
const req = (url, o = {}) => ({ method: 'GET', url, headers: new Headers(o.headers || {}), mode: o.mode || 'cors', destination: o.destination || '', ...o.extra });

test('sw.js never touches other origins, other apps, media, Range requests, sw.js or version.json', () => {
  const { route } = loadSw();
  for (const u of ['https://api.github.com/repos/x/y/contents/a', 'https://api.anthropic.com/v1/messages', 'https://fonts.gstatic.com/a.woff2',
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
