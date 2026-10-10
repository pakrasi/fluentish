import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test, expect, seed, APP, SHA } from './fixtures.mjs';

// The service worker across deploys (round 8, P4). Like the offline spec, each test runs its own server with the
// worker on. The server publishes the stamped site (_site/) as one deploy or another: a later deploy is the same build
// under another sha (its code at v/<that sha>/, its index.html, sw.js and version.json naming it), so the tests see
// which version a page and a worker are. Variants: a broken page, a shell a deploy ahead, the kill switch (sw=off),
// and a network that answers nothing for 10 s.
//
// WebKit hands a navigation to the worker only when no route fulfils it, so each test lets the shell's navigation
// through (page.route … continue) instead of the fixtures' Trusted Types tripwire, which fetches it from the server.
test.use({ serviceWorkers: 'allow' });
test.setTimeout(180_000);   // two cold precaches on a slow runner

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(HERE, '../../_site');
const REPO = path.resolve(HERE, '../..');
// the kill worker a deploy with sw=off publishes (loaded by URL so the e2e typecheck stays out of tools/)
const STAMP = pathToFileURL(path.join(REPO, 'tools/stamp.mjs')).href;
const { killSw } = /** @type {{killSw: () => string}} */ (await import(STAMP));
const B = 'b'.repeat(40), C = 'c'.repeat(40), K = 'd'.repeat(40);
const TYPES = /** @type {Record<string, string>} */ ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' });

/**
 * @typedef {{sha: string, shell?: string, broken?: boolean, now?: boolean, off?: 'page+worker' | 'worker'}} Deploy
 *   shell: the sha index.html names (default sha); broken: main.js throws; now: stamped sw=now (takes over once
 *   installed); off: the kill switch (version.json and sw.js, or only sw.js)
 */

/** A Pages-like server for the stamped site, as the deploy `d` (switchable), each answer `delay` ms late. */
async function deployServer() {
  /** @type {Deploy} */ let d = { sha: SHA };
  let delay = 0, answered = 0;
  const as = (/** @type {string} */ text, /** @type {string} */ sha) => text.replaceAll(SHA, sha).replaceAll(SHA.slice(0, 12), sha.slice(0, 12));
  /** @returns {Promise<{type: string, body: string | Buffer} | null>} */
  async function file(/** @type {string} */ rel) {
    if (rel.startsWith('schemas/records/')) return { type: TYPES['.json'], body: await readFile(path.join(REPO, rel)) };   // as tests/e2e/server.mjs
    if (rel === '' || rel === 'index.html') return { type: TYPES['.html'], body: as(await readFile(path.join(SITE, 'index.html'), 'utf8'), d.shell || d.sha) };
    if (rel === '404.html') return { type: TYPES['.html'], body: as(await readFile(path.join(SITE, '404.html'), 'utf8'), d.sha) };
    if (rel === 'sw.js') {
      const js = as(await readFile(path.join(SITE, 'sw.js'), 'utf8'), d.sha);
      if (d.now && !js.includes("const TAKEOVER = 'today'; // stamp:takeover")) throw new Error('sw.js: no takeover line');
      return { type: TYPES['.js'], body: d.off ? killSw() : d.now ? js.replace("const TAKEOVER = 'today';", "const TAKEOVER = 'now';") : js };
    }
    if (rel === 'version.json') {
      const v = JSON.parse(await readFile(path.join(SITE, 'version.json'), 'utf8'));
      return { type: TYPES['.json'], body: JSON.stringify({ ...v, sha: d.sha, sw: d.off === 'page+worker' ? 'off' : 'on' }) };
    }
    const m = /^v\/([0-9a-f]{40})\/(.*)$/.exec(rel);
    if (m && m[1] !== SHA && ![d.sha, d.shell].includes(m[1])) return null;   // only this deploy's code (and the base build's)
    if (m && d.broken && m[1] === d.sha && m[2] === 'src/main.js') return { type: TYPES['.js'], body: 'throw new Error("e2e: a broken deploy");\n' };
    const real = m ? `v/${SHA}/${m[2]}` : rel;
    const p = path.join(SITE, path.normalize(real));
    if (!p.startsWith(SITE) || !(await stat(p).catch(() => null))?.isFile()) return null;
    return { type: TYPES[path.extname(p)] || 'application/octet-stream', body: await readFile(p) };
  }
  const server = createServer(async (req, res) => {
    if (delay) await new Promise(r => setTimeout(r, delay));
    const p = decodeURIComponent(new URL(req.url || '/', 'http://x').pathname);
    const f = p.startsWith(APP) ? await file(p.slice(APP.length)).catch(() => null) : null;
    answered++;
    if (f) res.writeHead(200, { 'Content-Type': f.type, 'Cache-Control': 'no-cache' }).end(f.body);
    else res.writeHead(404, { 'Content-Type': TYPES['.html'] }).end(await readFile(path.join(SITE, '404.html')));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', () => r(null)));
  const origin = `http://127.0.0.1:${/** @type {any} */ (server.address()).port}`;
  return {
    origin,
    deploy: (/** @type {Deploy} */ next) => { d = next; },
    slow: (/** @type {number} */ ms) => { delay = ms; answered = 0; },
    answered: () => answered,
    stop: () => new Promise(r => { server.closeAllConnections(); server.close(() => r(null)); }),
  };
}

/** Lets the shell's navigation reach the worker (see the top). @param {import('@playwright/test').Page} page @param {string} origin */
async function shellToWorker(page, origin) {
  await page.route(u => u.origin === origin && (u.pathname === APP || u.pathname === `${APP}index.html`), r => r.continue());
}

/** The sha of the code the page runs (its module script), or null mid-navigation. @param {import('@playwright/test').Page} page */
const pageSha = page => page.evaluate(() => /\/v\/([0-9a-f]{40})\//.exec(/** @type {HTMLScriptElement} */ (document.querySelector('script[type="module"]'))?.src || '')?.[1] || null).catch(() => null);

/** Every v/<sha>/ the page loaded code from: one version per page. @param {import('@playwright/test').Page} page */
const loadedShas = page => page.evaluate(() => [...new Set(performance.getEntriesByType('resource').map(e => /\/v\/([0-9a-f]{40})\//.exec(e.name)?.[1]).filter(Boolean))]);

/** This app's caches. @param {import('@playwright/test').Page} page */
const appCaches = page => page.evaluate(async () => (await caches.keys()).filter(k => k.startsWith('fluentish-')).sort());

/** First visit: seeded, the worker installed and in control (as in offline.spec). @param {import('@playwright/test').Page} page @param {string} origin */
async function install(page, origin) {
  await page.goto(`${origin}${APP}version.json`);
  await seed(page, { origin });
  await shellToWorker(page, origin);
  await page.goto(`${origin}${APP}?sw=on#/today`);
  await expect(page.locator('html.booted')).toHaveCount(1);
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    const w = reg.active;
    if (w && w.state !== 'activated') await new Promise(r => w.addEventListener('statechange', () => { if (w.state === 'activated') r(null); }));
    if (!navigator.serviceWorker.controller) await new Promise(r => navigator.serviceWorker.addEventListener('controllerchange', () => r(null), { once: true }));
  });
  expect(await pageSha(page)).toBe(SHA);
}

/** Waits until the registration has a waiting worker (true) or its new worker failed to install (false). @param {import('@playwright/test').Page} page */
const nextWorker = page => page.evaluate(async () => {
  const reg = /** @type {ServiceWorkerRegistration} */ (await navigator.serviceWorker.getRegistration());
  const settle = (/** @type {ServiceWorker} */ w) => new Promise(r => {
    const done = () => { if (w.state === 'installed' || w.state === 'activated' || w.state === 'redundant') r(w.state !== 'redundant'); };
    w.addEventListener('statechange', done); done();
  });
  if (reg.waiting) return true;
  if (reg.installing) return settle(reg.installing);
  return new Promise(r => {
    reg.addEventListener('updatefound', () => settle(/** @type {ServiceWorker} */ (reg.installing)).then(r), { once: true });
    reg.update().catch(() => {});
  });
});

/** Drops the connection errors a stopped or slow server leaves in the console. @param {string[]} errors */
function dropNetworkErrors(errors) {
  const net = errors.filter(e => /^console: Failed to load resource: (net::ERR_CONNECTION_REFUSED|Could not connect to (the server\.|127\.0\.0\.1: Connection refused))$/.test(e));
  for (const e of net) errors.splice(errors.indexOf(e), 1);
}

test('a new deploy installs in the background, waits off Today, takes over from Today, and starts offline after', async ({ page, context, consoleErrors }) => {
  const srv = await deployServer();
  try {
    await install(page, srv.origin);
    // the next launch, on Practice, with B deployed: the page is A, from the worker, and B installs behind it and waits
    await page.evaluate(() => { location.hash = '#/practice'; });
    await expect(page.locator('#view h1').first()).toBeVisible();
    srv.deploy({ sha: B });
    await page.reload();
    await expect(page.locator('html.booted')).toHaveCount(1);
    expect(await pageSha(page)).toBe(SHA);
    expect(await nextWorker(page)).toBe(true);
    expect(await loadedShas(page), 'one version per page').toEqual([SHA]);
    await page.waitForTimeout(500);
    expect(await pageSha(page), 'no takeover off Today').toBe(SHA);
    // Today: the waiting worker takes over and the page reloads once, as B, with only B's code and B's cache. WebKit (his
    // Safari) always does. Chromium often holds the takeover until the window closes (the old worker counts as busy;
    // the round-7 worker too): then the page stays A, whole, and the next window is B (below).
    await page.evaluate(() => { location.hash = '#/today'; });
    const webkit = test.info().project.name.startsWith('webkit');
    const tookOver = await expect.poll(() => pageSha(page), { timeout: webkit ? 30_000 : 15_000 }).toBe(B).then(() => true, e => { if (webkit) throw e; return false; });
    if (tookOver) {
      await expect(page.locator('html.booted')).toHaveCount(1);
      await expect(page.locator('#view h1').first()).toBeVisible();
      expect(await loadedShas(page), 'one version per page').toEqual([B]);
      expect(await appCaches(page)).toEqual([`fluentish-${B.slice(0, 12)}`]);
      expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    } else {
      test.info().annotations.push({ type: 'chromium', description: 'the takeover waited for the next window' });
      expect(await pageSha(page)).toBe(SHA);
      expect(await loadedShas(page), 'one version per page').toEqual([SHA]);
    }
  } finally {
    await srv.stop();
  }
  // a cold start with the server gone: a new window, nothing else open
  const fresh = await context.newPage();
  await page.close();
  await fresh.goto(`${srv.origin}${APP}?sw=on#/today`);
  await expect(fresh.locator('html.booted')).toHaveCount(1);
  await expect(fresh.locator('#view h1').first()).toBeVisible();
  expect(await pageSha(fresh)).toBe(B);
  expect(await loadedShas(fresh), 'one version per page').toEqual([B]);
  expect(await appCaches(fresh)).toEqual([`fluentish-${B.slice(0, 12)}`]);
  await fresh.evaluate(() => { location.hash = '#/practice/round'; });
  await expect(fresh.locator('.pr-card')).toBeVisible();
  dropNetworkErrors(consoleErrors);
  // the takeover ends the old worker, and a module Today was still importing through it fails just before the page
  // reloads (WebKit; the round-7 worker the same). Only that line, and only this once (lanes/perf-sw.md).
  const cut = consoleErrors.filter(e => /^console: \[route\] TypeError: Importing a module script failed\.$/.test(e));
  expect(cut.length).toBeLessThanOrEqual(1);
  for (const e of cut) consoleErrors.splice(consoleErrors.indexOf(e), 1);
});

test('a warm launch never waits on the network: the app starts while the server has answered nothing', async ({ page, consoleErrors }) => {
  const srv = await deployServer();
  try {
    await install(page, srv.origin);
    srv.slow(10_000);
    await page.reload({ waitUntil: 'commit' });
    await expect(page.locator('#view h1').first()).toBeVisible({ timeout: 8_000 });
    await expect(page.locator('html.booted')).toHaveCount(1);
    expect(srv.answered(), 'nothing came from the server').toBe(0);
    expect(await pageSha(page)).toBe(SHA);
  } finally {
    await srv.stop();
  }
  dropNetworkErrors(consoleErrors);
});

test('a deploy whose shell is not its own version fails to install, and the installed version keeps serving', async ({ page }) => {
  const srv = await deployServer();
  try {
    await install(page, srv.origin);
    await page.evaluate(() => { location.hash = '#/practice'; });
    await expect(page.locator('#view h1').first()).toBeVisible();
    // B's sw.js, but index.html is already C's (a deploy landed while B installed)
    srv.deploy({ sha: B, shell: C });
    expect(await nextWorker(page), 'B never installs').toBe(false);
    await page.reload();
    await expect(page.locator('html.booted')).toHaveCount(1);
    expect(await pageSha(page)).toBe(SHA);
    expect(await loadedShas(page)).toEqual([SHA]);
    // the next deploy is whole again: it installs
    srv.deploy({ sha: C });
    expect(await nextWorker(page)).toBe(true);
  } finally {
    await srv.stop();
  }
});

test('kill switch: after a deploy that breaks the page, a deploy with sw=off removes the worker without the page', async ({ page, consoleErrors }) => {
  const srv = await deployServer();
  try {
    await install(page, srv.origin);
    // B breaks the page itself (main.js throws), and takes over from Today like any update
    srv.deploy({ sha: B, broken: true });
    await page.reload();
    await expect.poll(() => pageSha(page), { timeout: 60_000 }).toBe(B);
    await expect(page.locator('html.booted')).toHaveCount(0);
    expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    // the kill switch, as a deploy (the page can't run: the browser's own check of sw.js finds the kill worker)
    srv.deploy({ sha: K, off: 'page+worker' });
    await page.reload();
    await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length), { timeout: 60_000 }).toBe(0);
    expect(await appCaches(page)).toEqual([]);
    // the next launch comes from the network: the deploy's own page, which does not register a worker again
    await page.reload();
    await expect(page.locator('html.booted')).toHaveCount(1);
    expect(await pageSha(page)).toBe(K);
    expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(false);
    await page.waitForTimeout(1_000);
    expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);
  } finally {
    await srv.stop();
  }
  const broken = consoleErrors.filter(e => /e2e: a broken deploy/.test(e));
  expect(broken.length).toBeGreaterThan(0);
  for (const e of broken) consoleErrors.splice(consoleErrors.indexOf(e), 1);
});

test('sw=now: after a deploy that breaks the page, a fix stamped sw=now takes over without the page and keeps the worker', async ({ page, consoleErrors }) => {
  const srv = await deployServer();
  try {
    await install(page, srv.origin);
    srv.deploy({ sha: B, broken: true });
    await page.reload();
    await expect.poll(() => pageSha(page), { timeout: 60_000 }).toBe(B);
    await expect(page.locator('html.booted')).toHaveCount(0);
    // the fix, stamped sw=now: the browser's own check installs it, and it takes over at once (no Today needed)
    srv.deploy({ sha: C, now: true });
    await page.reload();
    await expect.poll(() => page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      return !reg?.waiting && !reg?.installing && (await caches.keys()).filter(k => k.startsWith('fluentish-')).join(',');
    }), { timeout: 60_000 }).toBe(`fluentish-${C.slice(0, 12)}`);
    // the next launch runs the fix, from its worker (offline too)
    await srv.stop();
    await page.reload();
    await expect(page.locator('html.booted')).toHaveCount(1);
    expect(await pageSha(page)).toBe(C);
    expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  } finally {
    await srv.stop();
  }
  const broken = consoleErrors.filter(e => /e2e: a broken deploy/.test(e));
  for (const e of broken) consoleErrors.splice(consoleErrors.indexOf(e), 1);
  dropNetworkErrors(consoleErrors);
});
