// The device link from b1-token.py (core/link.js): Fluentish opened with #token=… or #/profile?token=… stores the token
// through the secrets path and says "Device linked", and the token never shows up anywhere else: not in the address,
// not in the session history, not in a console line, not in the error ring, not in a backup and not in an export.
// The token is the e2e fake the GitHub mock answers (fixtures.mjs); nothing here is real.
import { test, expect, seed, FAKE_TOKEN, APP, SHA } from './fixtures.mjs';

/** Every kv value in IndexedDB, as [scope, name, value]. @param {import('@playwright/test').Page} page */
async function allKv(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const r = indexedDB.open('fluentish');
    r.onerror = () => reject(r.error);
    r.onsuccess = () => {
      const db = r.result, out = /** @type {any[]} */ ([]);
      const q = db.transaction('kv').objectStore('kv').openCursor();
      q.onsuccess = () => {
        const c = q.result;
        if (!c) { db.close(); resolve(out); return; }
        out.push([.../** @type {any[]} */ (c.key), c.value]);
        c.continue();
      };
      q.onerror = () => reject(q.error);
    };
  }));
}

/** The app opened from a link, with every console line kept. @param {import('@playwright/test').Page} page @param {string} hash */
async function openLink(page, hash) {
  /** @type {string[]} */ const lines = [];
  page.on('console', m => lines.push(m.text()));
  page.on('pageerror', e => lines.push(e.message));
  await page.goto(`${APP}${hash}`);
  await expect(page.locator('html.booted')).toHaveCount(1);
  await expect(page.locator('#view h1').first()).toBeVisible();
  return lines;
}

for (const form of ['#token=', '#/profile?token=']) {
  test(`a link with ${form}… links this device once and leaves the token nowhere else`, async ({ page, gh }) => {
    // a learner past the import notice (his settings events are what the backup sends)
    await seed(page, { kv: { ui: { importSeen: true } } });
    const lines = await openLink(page, `${form}${FAKE_TOKEN}`);

    await expect(page.locator('.toast').filter({ hasText: 'Device linked.' })).toBeVisible();
    await expect(page).toHaveURL(/#\/profile$/);
    await expect(page.locator('#view')).toContainText('Connected to pakrasi/b1-exam.');
    await expect(page.locator('#view')).toContainText('The token expires on 2099-01-01.');

    // stored through the secrets path: device scope, kv 'secrets'
    const kv = /** @type {any[][]} */ (await allKv(page));
    const secrets = kv.find(([scope, name]) => scope === 'device' && name === 'secrets');
    expect(secrets?.[2]?.githubToken).toBe(FAKE_TOKEN);

    // the address and this history entry
    const where = await page.evaluate(() => ({ href: location.href, hash: location.hash, state: JSON.stringify(history.state ?? null), title: document.title }));
    expect(JSON.stringify(where)).not.toContain(FAKE_TOKEN);
    expect(where.hash).toBe('#/profile');

    // the results sync runs with the linked token (the mock answers only this token); let a backup go up
    await page.goto(`${APP}#/profile/data`);
    await expect(page.locator('#view h1').first()).toBeVisible();
    await page.getByRole('button', { name: 'Back up now' }).click();
    await expect(page.locator('.toast').filter({ hasText: 'Backed up.' })).toBeVisible();
    expect(gh.files.size).toBeGreaterThan(0);
    for (const [p, b64] of gh.files) expect(Buffer.from(b64, 'base64').toString('latin1').includes(FAKE_TOKEN), `backup file ${p}`).toBe(false);

    // the export file
    const bundle = await page.evaluate(async sha => {
      const v = `/fluentish/v/${sha}/src/`;
      const [{ createIdbAdapter }, { openSession }, { exportBundle }, clockM] = await Promise.all([
        import(v + 'data/adapters/idb.js'), import(v + 'data/session.js'), import(v + 'data/transfer.js'), import(v + 'core/clock.js')]);
      const adapter = await createIdbAdapter();
      const s = await openSession({ adapter, legacyStorage: null, clock: clockM.createClock({ exam: () => null, now: () => new Date() }), kind: 'local' });
      const out = JSON.stringify(exportBundle(s.store, { profile: s.profile, includeScripts: true, archived: [] }));
      s.store.close(); adapter.close?.();
      return out;
    }, SHA);
    expect(bundle.length).toBeGreaterThan(100);
    expect(bundle.includes(FAKE_TOKEN), 'export').toBe(false);

    // Back and Forward find the rewritten entry, never the link
    await page.goBack();
    await page.goForward();
    await expect(page.locator('html.booted')).toHaveCount(1);
    expect(page.url()).not.toContain(FAKE_TOKEN);
    await expect(page.locator('.toast').filter({ hasText: 'Device linked.' })).toHaveCount(0);

    // the error ring (device kv 'log') and every console line
    const after = /** @type {any[][]} */ (await allKv(page));
    const ring = after.find(([scope, name]) => scope === 'device' && name === 'log')?.[2] || [];
    expect(JSON.stringify(ring).includes(FAKE_TOKEN), 'error ring').toBe(false);
    expect(lines.filter(l => l.includes(FAKE_TOKEN)), 'console').toEqual([]);
    // nothing but the secrets record holds it
    expect(after.filter(([, name, v]) => name !== 'secrets' && JSON.stringify(v ?? null).includes(FAKE_TOKEN)).map(([s, n]) => `${s}/${n}`)).toEqual([]);
  });
}

test('a link whose token is not usable is scrubbed too and says so; nothing is stored', async ({ page }) => {
  await seed(page);
  const lines = await openLink(page, '#token=nope');
  await expect(page.locator('.toast').filter({ hasText: 'This link has no usable token.' })).toBeVisible();
  expect(page.url()).not.toContain('token');
  const kv = /** @type {any[][]} */ (await allKv(page));
  expect(kv.find(([scope, name]) => scope === 'device' && name === 'secrets')?.[2]?.githubToken ?? null).toBe(null);
  expect(lines.filter(l => l.includes('nope'))).toEqual([]);
});

test('an expired link is refused and scrubbed; nothing is stored and GitHub is not asked', async ({ page, gh }) => {
  await seed(page);
  const lines = await openLink(page, `#/profile?token=${FAKE_TOKEN}&exp=1`);
  await expect(page.locator('.toast').filter({ hasText: 'This link has expired.' })).toBeVisible();
  expect(page.url()).not.toContain('token');
  const kv = /** @type {any[][]} */ (await allKv(page));
  expect(kv.find(([scope, name]) => scope === 'device' && name === 'secrets')?.[2]?.githubToken ?? null).toBe(null);
  expect(gh.calls.length).toBe(0);
  await expect(page.locator('#view')).toContainText('Not connected. Your progress stays in this browser.');
  expect(lines.filter(l => l.includes(FAKE_TOKEN))).toEqual([]);
});
