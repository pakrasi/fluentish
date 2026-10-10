// Accounts, stage 0 (docs/ACCOUNTS.md). With the committed config (LocalOnly) Profile has no Account section and no
// Diagnostics line, and nothing goes to a Supabase host. On this server (127.0.0.1) ?accounts=fake turns on the
// in-memory fake provider: sign in with an email and the 6-digit code, sign out, on a phone's 390 px with 44 px
// targets. The fake provider makes no request at all; the fixtures' network seal fails the test on any other host.
import { test, expect, seed, open, settle, checkA11y } from './fixtures.mjs';

/** Requests to any *.supabase.co host. @param {import('@playwright/test').Page} page */
function supabaseGuard(page) {
  /** @type {string[]} */ const hits = [];
  page.context().on('request', req => { if (/(^|\.)supabase\.co$/i.test(new URL(req.url()).hostname)) hits.push(req.url()); });
  return hits;
}

/** The session kv as stored in IndexedDB. @param {import('@playwright/test').Page} page */
const storedSession = page => page.evaluate(() => new Promise((resolve, reject) => {
  const r = indexedDB.open('fluentish');
  r.onerror = () => reject(r.error);
  r.onsuccess = () => {
    const q = r.result.transaction('kv').objectStore('kv').get(['device', 'account.session']);
    q.onsuccess = () => { r.result.close(); resolve(q.result ?? null); };
    q.onerror = () => reject(q.error);
  };
}));

test('LocalOnly (the default): no Account section, no Diagnostics line, no Supabase request', async ({ page }) => {
  const hits = supabaseGuard(page);
  await seed(page);
  await open(page, '#/profile');
  await page.waitForLoadState('networkidle');
  await expect(page.locator('#profile-account')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Account', exact: true })).toHaveCount(0);
  await page.getByText('Show diagnostics').click();
  await expect(page.locator('.diag dt', { hasText: 'Accounts' })).toHaveCount(0);
  // ?accounts=fake does nothing for the session kv until he signs in
  expect(await storedSession(page)).toBe(null);
  expect(hits).toEqual([]);
});

test('?accounts=fake: sign in with an email code, sign out; 44 px targets; the session stays in device kv', async ({ page }, info) => {
  const hits = supabaseGuard(page);
  await seed(page);
  await open(page, '?accounts=fake#/profile');
  const sec = page.locator('#profile-account');
  await expect(sec.getByRole('heading', { name: 'Account' })).toBeVisible();
  await expect(sec).toContainText('Test accounts on this computer.');
  const email = sec.getByLabel('Email');
  await expect(email).toHaveAttribute('autocomplete', 'email');
  await expect(email).toHaveAttribute('type', 'email');

  // a wrong email, then a right one
  await email.fill('not an email');
  await sec.getByRole('button', { name: 'Send code' }).click();
  await expect(sec).toContainText('Enter an email address.');
  await email.fill('learner@example.com');
  await email.press('Enter');
  await expect(sec).toContainText('A code was sent to learner@example.com.');
  const code = sec.getByLabel('6-digit code');
  await expect(code).toBeFocused();
  await expect(code).toHaveAttribute('inputmode', 'numeric');
  await expect(code).toHaveAttribute('autocomplete', 'one-time-code');
  await expect(sec.getByRole('button', { name: 'Send a new code' })).toBeDisabled();
  await checkA11y(page, 'Profile › Account, code sent');

  if (info.project.name === 'webkit-390') {
    for (const el of [code, sec.getByRole('button', { name: 'Sign in' }), sec.getByRole('button', { name: 'Use another email' })]) {
      const box = await el.boundingBox();
      expect(box && box.height, 'a 44 px target').toBeGreaterThanOrEqual(44);
    }
  }

  // a wrong code, then the fake server's code
  await code.fill('000000');
  await sec.getByRole('button', { name: 'Sign in' }).click();
  await expect(sec).toContainText('That code is wrong or has run out.');
  await code.fill('123456');
  await code.press('Enter');
  await expect(sec).toContainText('Signed in as learner@example.com.');
  expect(await page.locator('#profile-account').innerText()).not.toMatch(/\b(null|undefined)\b/);
  const session = /** @type {any} */ (await storedSession(page));
  expect(session.refreshToken).toMatch(/^fake-refresh-/);
  // no token on the page
  expect(await page.content()).not.toContain(session.accessToken);
  expect(await page.content()).not.toContain(session.refreshToken);
  await page.getByText('Show diagnostics').click();
  await expect(page.locator('.diag')).toContainText('On (test accounts, this computer only)');
  await checkA11y(page, 'Profile › Account, signed in');

  // signed in survives a reload
  await open(page, '?accounts=fake#/profile');
  await expect(page.locator('#profile-account')).toContainText('Signed in as learner@example.com.');

  // sign out: the session is gone at once
  await page.locator('#profile-account').getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.locator('.toast').filter({ hasText: 'Signed out.' })).toBeVisible();
  await expect(page.locator('#profile-account').getByLabel('Email')).toBeVisible();
  await expect.poll(() => storedSession(page)).toBe(null);
  await settle(page);
  expect(hits).toEqual([]);
});
