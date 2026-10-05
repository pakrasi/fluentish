import { test, expect, seed, open, checkA11y } from './fixtures.mjs';

test('boots to Today with no console errors, and the tabs work', async ({ page }) => {
  await seed(page);
  await open(page, '#/today');
  await expect(page.locator('nav.tabs a[data-tab="today"][aria-current="page"]').first()).toHaveCount(1);
  await checkA11y(page, 'Today');
  for (const [tab, hash] of [['practice', '#/practice'], ['exam', '#/exam'], ['lookup', '#/lookup']]) {
    await page.locator(`nav.tabs a[data-tab="${tab}"]:visible`).first().click();
    await expect(page).toHaveURL(new RegExp(`${hash}$`));
    await expect(page.locator('#view h1').first()).toBeVisible();
  }
  await checkA11y(page, 'Look up');
});

test('a fresh device goes to onboarding', async ({ page }) => {
  await open(page, '#/today');
  await expect(page).toHaveURL(/#\/welcome$/);
});

test('records are checked against schemas/records while the tests run', async ({ page, consoleErrors }) => {
  // a schema that refuses every event: the first event the app appends must be reported
  await page.route('**/schemas/records/event.schema.json', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ $id: 'event@1', not: {} }) }));
  await seed(page);
  await open(page, '#/practice/round');
  await page.getByRole('button', { name: 'I know this' }).click();
  await expect.poll(() => consoleErrors.filter(e => /schema: event card\.marked_known does not match/.test(e)).length).toBeGreaterThan(0);
  consoleErrors.length = 0;   // expected here
});

test('the Trusted Types tripwire is armed: an HTML string written into the page is refused and reported', async ({ page, consoleErrors }) => {
  await seed(page);
  await open(page, '#/today');
  const wrote = await page.evaluate(() => { try { document.body.insertAdjacentHTML('beforeend', '<b id="tt">x</b>'); } catch { /* refused */ } return !!document.getElementById('tt'); });
  expect(wrote).toBe(false);
  expect(consoleErrors.some(e => /Trusted Types tripwire: an HTML string reached the DOM/.test(e))).toBe(true);
  consoleErrors.length = 0;   // expected here
});
