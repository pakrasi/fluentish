import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, seed, APP } from './fixtures.mjs';

// The one spec with the service worker on. Offline here is real: the spec starts its own copy of the e2e server,
// visits once, then stops that server and reloads, so every file must come from the worker's cache. The worker serves
// only this origin (sw.js passes other origins through to the page, where the fixtures' routes answer them), and no
// device is linked here, so nothing could reach GitHub either way.
test.use({ serviceWorkers: 'allow' });
test.setTimeout(120_000);   // a cold precache on a slow runner

const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'server.mjs');

/** @returns {Promise<{origin: string, stop: () => Promise<void>}>} */
function startServer() {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [SERVER, '0'], { stdio: ['ignore', 'pipe', 'inherit'] });
    p.on('error', reject);
    p.stdout.on('data', d => {
      const m = /http:\/\/127\.0\.0\.1:(\d+)\//.exec(String(d));
      if (m) resolve({ origin: `http://127.0.0.1:${m[1]}`, stop: () => new Promise(r => { p.once('exit', () => r()); p.kill(); }) });
    });
  });
}

test('after one visit, the app reloads offline from the service worker', async ({ page, consoleErrors }) => {
  const srv = await startServer();
  try {
    await page.goto(`${srv.origin}${APP}version.json`);
    await seed(page, { origin: srv.origin });
    await page.goto(`${srv.origin}${APP}?sw=on#/today`);
    await expect(page.locator('html.booted')).toHaveCount(1);
    // installed (the stamped precache list) and in control of this page, with the app root as its scope
    // the worker precaches about 8 MB: wait until it is active, then load once more under its control
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => null));
    if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) { await page.reload(); await expect(page.locator('html.booted')).toHaveCount(1); }
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 30_000 }).toBe(true);
    expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.scope)).toBe(`${srv.origin}${APP}`);
  } finally {
    await srv.stop();
  }
  // the server is gone: only the worker can answer
  await page.reload();
  await expect(page.locator('html.booted')).toHaveCount(1);
  await expect(page.locator('#view h1').first()).toBeVisible();
  // a view loaded on demand and the core content work too: a round opens
  await page.evaluate(() => { location.hash = '#/practice/round'; });
  await expect(page.locator('.pr-card')).toBeVisible();
  // the browser logs the requests the worker lets fail with the server gone (the update check, version.json, is never
  // cached, and the shell is network first); nothing else may be logged
  const expected = consoleErrors.filter(e => /^console: Failed to load resource: (net::ERR_CONNECTION_REFUSED|Could not connect to (the server\.|127\.0\.0\.1: Connection refused))$/.test(e));
  for (const e of expected) consoleErrors.splice(consoleErrors.indexOf(e), 1);
});
