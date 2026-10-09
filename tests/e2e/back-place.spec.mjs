// Back returns to where you were (round 8, lane U1; core/scroll.js): list → item → Back keeps the list's scroll
// position, a new navigation starts at the top, a tap on the current tab goes to the top. Also: a deep link opened
// before onboarding opens after Welcome, and a page that could not load offers Try again.
import { test, expect, seed, open, settle, APP, SHA } from './fixtures.mjs';
import { syntheticLog } from './progress-seed.mjs';

const scrollY = (/** @type {import('@playwright/test').Page} */ page) => page.evaluate(() => Math.round(window.scrollY));

/**
 * Scroll a list page down, open the first link to another page that shows on screen, go Back: the list comes back
 * at the same place.
 * @param {import('@playwright/test').Page} page @param {string} hash
 * @param {RegExp | string} linkHref which links lead to an item, or a tab's id: leave through the tab bar
 */
async function backKeepsPlace(page, hash, linkHref) {
  await open(page, hash);
  await settle(page);
  const max = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
  expect(max, `${hash} is long enough to scroll`).toBeGreaterThan(150);
  const want = Math.min(700, max - 20);
  await page.evaluate(y => window.scrollTo({ top: y, behavior: 'instant' }), want);
  await expect.poll(() => scrollY(page)).toBe(want);
  // a link to another page that is on screen now (the tab bar and the header are not in #view)
  const href = typeof linkHref === 'string' ? await page.locator(`.tabs a[data-tab="${linkHref}"]:visible`).first().getAttribute('href') : await page.evaluate(src => {
    const re = new RegExp(src);
    const a = [...document.querySelectorAll('#view a[href^="#/"]')].find(a => {
      const r = a.getBoundingClientRect();
      return re.test(a.getAttribute('href') || '') && r.top > 80 && r.bottom < innerHeight - 100 && r.width > 0;
    });
    return a ? a.getAttribute('href') : null;
  }, linkHref.source);
  expect(href, `a link on screen in ${hash}`).toBeTruthy();
  const listTitle = await page.locator('#view h1').first().textContent();
  // the tab bar is sticky: Playwright's click would first scroll the page to the bar's place in the flow, which a
  // finger never does, so the tab is clicked in the page
  if (typeof linkHref === 'string') await page.locator(`.tabs a[data-tab="${linkHref}"]:visible`).first().evaluate(a => /** @type {HTMLElement} */ (a).click());
  else await page.locator(`#view a[href="${href}"]`).first().click();
  await expect(page.locator('#view h1').first()).not.toHaveText(String(listTitle));
  await settle(page);
  expect(await scrollY(page), 'a new page starts at the top').toBe(0);
  await page.goBack();
  await expect(page.locator('#view h1').first()).toHaveText(String(listTitle));
  await expect.poll(() => scrollY(page), { message: `Back to ${hash} returns to the place` }).toBe(want);
  // and it stays there once the view has drawn everything
  await settle(page);
  expect(await scrollY(page)).toBe(want);
}

test('Back keeps the place: Reading list → a text → Back', async ({ page }) => {
  await seed(page, { veteran: true });
  await backKeepsPlace(page, '#/practice/read', /^#\/practice\/read\/[^/?]+/);
});

test('Back keeps the place with motion on (view transitions where the browser has them)', async ({ page }) => {
  await seed(page, { veteran: true, motion: 'full' });
  await backKeepsPlace(page, '#/practice/read', /^#\/practice\/read\/[^/?]+/);
});

test('Back keeps the place: Look up word list → a word → Back', async ({ page }) => {
  await seed(page, { veteran: true });
  await backKeepsPlace(page, '#/lookup/words?w=all', /^#\/lookup\/words\/[^/?]+/);
});

test('Back keeps the place: Practice hub → a practice → Back', async ({ page }) => {
  await seed(page, { veteran: true });
  await backKeepsPlace(page, '#/practice', /^#\/practice\/(?!round)[a-z]/);
});

test('Back keeps the place: Progress (charts drawn after an async step) → Look up tab → Back', async ({ page }) => {
  await page.goto(`${APP}version.json`);
  const today = await page.evaluate(async (/** @type {string} */ sha) => (await import(`/fluentish/v/${sha}/src/core/clock.js`)).createClock({ exam: () => null }).today(), SHA);
  await seed(page, { examInDays: null, kv: syntheticLog(today) });
  await backKeepsPlace(page, '#/today/progress', 'lookup');
});

test('Forward returns to the item; Back again to the list place; a reload keeps it too', async ({ page }) => {
  await seed(page, { veteran: true });
  await backKeepsPlace(page, '#/practice/read', /^#\/practice\/read\/[^/?]+/);
  const y = await scrollY(page);
  await page.goForward();
  await expect(page.locator('#view h1').first()).toBeVisible();
  await expect.poll(() => scrollY(page)).toBe(0);
  await page.goBack();
  await expect.poll(() => scrollY(page)).toBe(y);
  // the y is in the entry's history.state too, written while the page scrolled
  await page.waitForTimeout(400);
  await page.reload();
  await expect(page.locator('html.booted')).toHaveCount(1);
  await expect.poll(() => scrollY(page)).toBe(y);
});

test('scrolling first wins: no jump once the page was scrolled by hand', async ({ page }) => {
  await seed(page, { veteran: true });
  await backKeepsPlace(page, '#/practice/read', /^#\/practice\/read\/[^/?]+/);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await settle(page);
  expect(await scrollY(page)).toBe(0);
});

test('a tap on the tab you are on goes to the top', async ({ page }) => {
  await seed(page, { veteran: true });
  await open(page, '#/practice');
  await settle(page);
  await page.evaluate(() => window.scrollTo({ top: 400, behavior: 'instant' }));
  await expect.poll(() => scrollY(page)).toBeGreaterThan(100);
  await page.locator('.tabs a[data-tab="practice"]:visible').first().click();
  await expect.poll(() => scrollY(page)).toBe(0);
  await expect(page).toHaveURL(/#\/practice$/);
});

test('a deep link opened before onboarding opens once Welcome is done', async ({ page }) => {
  await open(page, '#/lookup/grammar');
  await expect(page).toHaveURL(/#\/welcome\?next=%2Flookup%2Fgrammar$/);
  await page.getByRole('radio', { name: /German/ }).check();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('radio', { name: /^B1/ }).check();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('radio', { name: /Goethe/ }).check();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page).toHaveURL(/#\/lookup\/grammar$/);
  await expect(page.locator('#view h1').first()).toBeVisible();
  // Welcome is not left behind in the history: Back does not land on it
  expect(await page.evaluate(() => location.hash)).toBe('#/lookup/grammar');
});

test('a link to another site in ?next= is ignored: Welcome goes to Today', async ({ page }) => {
  await open(page, '#/welcome?next=//evil.example/x');
  await page.getByRole('radio', { name: /German/ }).check();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('radio', { name: /^B1/ }).check();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('radio', { name: /Goethe/ }).check();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page).toHaveURL(/#\/today$/);
});

test('a page that could not load offers Try again, which loads it', async ({ page, consoleErrors }) => {
  await seed(page, { veteran: true });
  await open(page, '#/today');
  let block = true;
  await page.route(/\/src\/features\/practice-conversation\/index\.js/, r => (block ? r.abort() : r.fallback()));
  await page.evaluate(() => { location.hash = '#/practice/conversation'; });
  await expect(page.locator('#view h1')).toHaveText('Something went wrong');
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to Today' })).toBeVisible();
  block = false;
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page).toHaveURL(/#\/practice\/conversation$/);
  await expect(page.locator('#view h1').first()).not.toHaveText('Something went wrong');
  consoleErrors.length = 0;   // the blocked module is the test's doing
});
