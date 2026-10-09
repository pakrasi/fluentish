// Safe to share (docs/SHARING.md). A visitor (no token, no repository) gets a local-only app: no request reaches
// api.github.com or the owner's study hours file, no repository or person is named on any page, and the features that
// need a repository are hidden. The owner's device (a token on it) keeps its repository, its backup and its study
// hours file, and can disconnect itself; the token never shows on a page. All data and tokens here are synthetic.
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, seed, open, settle, checkA11y, FAKE_TOKEN, APP } from './fixtures.mjs';

/** Words that would name the owner's repositories or files on a visitor's page, plus the personal terms in the
   git-ignored .privacy-terms when it is there (the owner's machines; CI checks the generic ones). */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TERMS = (() => {
  const f = path.join(ROOT, '.privacy-terms');
  if (!existsSync(f)) return [];
  return readFileSync(f, 'utf8').split('\n').map(x => x.trim()).filter(x => x && !x.startsWith('#'))
    .map(x => (x.startsWith('re:') ? new RegExp(x.slice(3), 'iu') : new RegExp(`\\b${x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')));
})();
const PRIVATE = { test: (/** @type {string} */ s) => /pakrasi|b1-exam|language-stack|toggl\.json|your tutor/i.test(s) || TERMS.some(re => re.test(s)) };
/** @param {string} s */
const leaks = s => (PRIVATE.test(s) ? s : '');

/**
 * Every request to GitHub's API or to the owner's other sites (not the exam audio, which the app publishes).
 * @param {import('@playwright/test').Page} page
 */
function requestGuard(page) {
  /** @type {string[]} */ const hits = [];
  page.context().on('request', req => {
    const u = new URL(req.url());
    // accounts (round 8): LocalOnly is the default, so no request may reach a Supabase project either
    if (u.hostname === 'api.github.com' || /(^|\.)supabase\.co$/i.test(u.hostname) || (u.hostname === 'pakrasi.github.io' && !u.pathname.startsWith('/b1-exam/audio/') && !/\.(mp3|m4a|wav|ogg|webm)$/.test(u.pathname))) hits.push(`${req.method()} ${u.hostname}${u.pathname}`);
  });
  return hits;
}

/** The page's visible text. @param {import('@playwright/test').Page} page */
const text = page => page.evaluate(() => document.body.innerText);

test('a first-time visitor: the welcome page asks nothing of GitHub and names nobody', async ({ page }) => {
  const hits = requestGuard(page);
  await page.goto(APP);
  await expect(page.locator('html.booted')).toHaveCount(1);
  await expect(page).toHaveURL(/#\/welcome$/);
  await expect(page.locator('#view h1').first()).toBeVisible();
  await page.waitForLoadState('networkidle');
  expect(leaks(await text(page))).toBe('');
  expect(hits).toEqual([]);
});

test('a visitor: every tab works locally, nothing reaches GitHub or the hours file, nothing names the owner', async ({ page, gh }) => {
  const hits = requestGuard(page);
  await seed(page);
  /** @type {[string, (p: import('@playwright/test').Page) => Promise<void>][]} */
  const pages = [
    ['#/today', async () => {}],
    ['#/today/progress', async p => {
      const time = p.locator('section', { has: p.getByRole('heading', { name: 'Time per week' }) });
      if (await time.count()) {
        await expect(p.getByRole('group', { name: 'Which hours' })).toHaveCount(0);
        await expect(time.getByRole('button', { name: 'Add a study hours file' })).toBeVisible();
      }
    }],
    ['#/practice', async () => {}],
    ['#/exam', async p => { await expect(p.locator('.ex-sync')).toHaveCount(0); }],
    ['#/lookup/words', async p => { await expect(p.getByText('Link this device')).toHaveCount(0); }],
    ['#/profile', async p => {
      await expect(p.locator('#profile-sync')).toContainText('Not connected. Your progress stays in this browser.');
      await expect(p.getByRole('button', { name: 'Disconnect this device' })).toHaveCount(0);
      // accounts (round 8): no Account section while no provider is configured
      await expect(p.locator('#profile-account')).toHaveCount(0);
      // Profile › Data: where the progress is, how to keep it, no backup or restore
      const data = p.locator('#profile-data');
      await expect(data).toContainText('Your progress is saved in this browser, on this device only.');
      await expect(data).toContainText('Export progress');
      expect(await data.innerText()).not.toMatch(/\bnull\b/);
      await expect(data).toContainText('Accounts that keep your progress on all your devices are planned.');
      await expect(p.getByRole('button', { name: 'Back up now' })).toHaveCount(0);
      await expect(p.getByRole('button', { name: 'Restore from backup' })).toHaveCount(0);
      await expect(p.getByText('Merge my other devices automatically')).toHaveCount(0);
    }],
  ];
  for (const [hash, more] of pages) {
    await open(page, hash);
    await page.waitForLoadState('networkidle');
    await settle(page);
    await more(page);
    expect(leaks(await text(page)), hash).toBe('');
  }
  await checkA11y(page, 'Profile, local only');
  // the connect form names no repository either, opened
  await page.getByText('Connect a GitHub repository').click();
  await expect(page.getByLabel('Repository')).toHaveValue('');
  expect(leaks(await text(page))).toBe('');
  expect(hits, 'requests to GitHub or the owner\'s sites').toEqual([]);
  expect(gh.calls.length).toBe(0);
});

test('the owner\'s device: connected to his repository with the backup, token never shown; Disconnect this device', async ({ page }) => {
  await seed(page, { token: true, kv: { ui: { importSeen: true } } });
  await open(page, '#/profile/connections');
  const box = page.locator('#profile-sync');
  await expect(box).toContainText('Connected to pakrasi/b1-exam.');
  await expect(box).toContainText('The token expires on 2099-01-01.');
  await expect(box).toContainText('Lost a device? Revoke its token on GitHub.');
  await expect(page.getByRole('button', { name: 'Back up now' })).toBeVisible();
  // the token is in no field, no attribute, no text
  expect(await page.content()).not.toContain(FAKE_TOKEN);
  expect(await page.locator('input').evaluateAll(els => els.map(e => /** @type {HTMLInputElement} */ (e).value))).not.toContain(FAKE_TOKEN);
  await checkA11y(page, 'Profile, connected');
  // (Progress keeps All tracked from the migration: progress.spec.mjs › All tracked runs as this owner device)

  // Disconnect this device: the token goes, the repository stays named for the profile
  await open(page, '#/profile/connections');
  await page.getByRole('button', { name: 'Disconnect this device' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Disconnect' }).click();
  await expect(page.locator('.toast').filter({ hasText: 'This device is disconnected.' })).toBeVisible();
  await expect(page.locator('#profile-sync')).toContainText('Not connected on this device.');
  const secrets = await page.evaluate(() => new Promise((resolve, reject) => {
    const r = indexedDB.open('fluentish');
    r.onerror = () => reject(r.error);
    r.onsuccess = () => {
      const q = r.result.transaction('kv').objectStore('kv').get(['device', 'secrets']);
      q.onsuccess = () => { r.result.close(); resolve(q.result); };
      q.onerror = () => reject(q.error);
    };
  }));
  expect(/** @type {any} */ (secrets)?.githubToken ?? null).toBe(null);
  await expect(page.getByRole('button', { name: 'Back up now' })).toHaveCount(0);
});
