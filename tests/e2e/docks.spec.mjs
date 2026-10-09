// One Start per screen, in the thumb zone (round 8, design B2, B3, B10, B11): on a 390x844 phone with the keyboard
// down, the primary action of Practice, Exam and Conversation sits in the bottom third of the screen and shows without
// scrolling; on a desktop it sits inline in the page. Look up puts its search above the Map card and focuses it on a
// desktop only. The Lesen runner's headings go h1 then h2. axe on each screen.
import { AxeBuilder } from '@axe-core/playwright';
import { test, expect, seed, open, settle, checkA11y } from './fixtures.mjs';

const KEY = 'e2e-fake-claude-key-0001';

/**
 * The primary is visible without scrolling: on a phone in the bottom third, on a desktop anywhere in the first screen.
 * @param {import('@playwright/test').Page} page @param {import('@playwright/test').Locator} btn @param {boolean} phone
 */
async function inReach(page, btn, phone) {
  await expect(btn).toBeVisible();
  await settle(page);
  expect(await page.evaluate(() => document.body.classList.contains('kb')), 'the keyboard is down').toBe(false);
  expect(await page.evaluate(() => scrollY), 'no scrolling').toBe(0);
  const vh = /** @type {{height: number}} */ (page.viewportSize()).height;
  const box = /** @type {{y: number, height: number}} */ (await btn.boundingBox());
  expect(box.y + box.height, 'the whole button is on screen').toBeLessThanOrEqual(vh);
  if (phone) {
    expect(box.y, `in the bottom third (top at ${Math.round(box.y)} of ${vh})`).toBeGreaterThanOrEqual(vh * 2 / 3);
    expect(await btn.evaluate(b => getComputedStyle(/** @type {HTMLElement} */ (b.closest('.dock, .pr-queue-btn'))).position)).toBe('fixed');
  } else {
    // a desktop has no fixed dock: the Start is in the page's flow (Conversation's sticks to the bottom of a long page)
    expect(['static', 'sticky']).toContain(await btn.evaluate(b => getComputedStyle(/** @type {HTMLElement} */ (b.closest('.dock, .pr-queue-btn'))).position));
  }
  // one primary on the screen
  expect(await page.locator('#view .btn-primary:visible').count(), 'one primary button').toBe(1);
}

test('Practice hub: one Start, the plan\'s next row, in the dock', async ({ page }, info) => {
  const phone = info.project.name.startsWith('webkit');
  await seed(page, { examInDays: 4, veteran: true });
  await open(page, '#/practice');
  await expect(page.locator('.pr-next')).toBeVisible();
  const start = page.locator('#pr-next');
  await inReach(page, start, phone);
  // no second Start in the card (design B2; SECOND_START 'drop')
  await expect(page.locator('.pr-queue a.btn[href="#/practice/round"]')).toHaveCount(0);
  await checkA11y(page, 'Practice hub, one start');
});

test('Exam tab: Start in the dock on a phone, inline on a desktop; Up next names the module', async ({ page }, info) => {
  const phone = info.project.name.startsWith('webkit');
  await seed(page, { examInDays: 4, veteran: true });
  await open(page, '#/exam');
  const start = page.locator('#ex-start');
  await expect(start).toContainText(/Start \w+ · Test 1/);
  await inReach(page, start, phone);
  if (phone) await expect(page.locator('.ex-upnext-title')).toBeVisible();
  else await expect(page.locator('.ex-upnext-title')).toBeHidden();
  await checkA11y(page, 'Exam tab, docked start');
  // the dock goes with the page: the module's start panel has no dock
  await start.click();
  await expect(page).toHaveURL(/#\/exam\/1\/\w+$/);
  await expect(page.locator('.ex-dock')).toHaveCount(0);
});

test('Conversation setup: Start in the dock once a topic is chosen, without scrolling', async ({ page }, info) => {
  const phone = info.project.name.startsWith('webkit');
  await seed(page, { veteran: true, examInDays: null, kv: { secrets: { anthropicKey: KEY, githubToken: null } } });
  await open(page, '#/practice/conversation');
  await expect(page.locator('.cv-choice.is-on')).toHaveCount(1);
  const start = page.locator('.cv-start');
  await expect(start).toBeEnabled();
  await inReach(page, start, phone);
  // choosing another topic redraws the page; the dock stays put (it rises in only once)
  await page.locator('.cv-choice').nth(1).click();
  await expect(page.locator('.cv-startbar.fx-rise')).toHaveCount(0);
  await inReach(page, start, phone);
  await checkA11y(page, 'Conversation setup, docked start');
});

test('Look up: the search is above the Map card; a desktop focuses it, a phone does not', async ({ page }, info) => {
  const phone = info.project.name.startsWith('webkit');
  await seed(page, { examInDays: 30, veteran: true });
  await open(page, '#/lookup');
  const search = page.locator('.lk-input');
  const map = page.locator('.lk-map');
  await expect(map).toBeVisible();
  const [s, m] = [await search.boundingBox(), await map.boundingBox()];
  expect(/** @type {any} */ (s).y).toBeLessThan(/** @type {any} */ (m).y);
  if (phone) {
    await page.waitForTimeout(150);
    await expect(search).not.toBeFocused();
  } else {
    await expect(search).toBeFocused();
    await page.keyboard.type('Haus');
    await expect(page).toHaveURL(/q=Haus/);
  }
  await checkA11y(page, 'Look up, search first');
});

test('Lesen runner: headings go h1, then h2 (axe heading-order)', async ({ page }) => {
  await seed(page, { examInDays: 30 });
  await open(page, '#/exam/1/lesen');
  await page.getByRole('button', { name: /Lesen starten/ }).click();
  await expect(page.getByRole('timer')).toBeVisible();
  await expect(page.locator('.ex-run h1')).toBeVisible();
  await expect(page.locator('.ex-run .ex-text-title').first()).toBeVisible();
  await settle(page);
  const res = await new AxeBuilder({ page }).withRules(['heading-order']).options({ preload: false }).analyze();
  expect(res.violations.map(v => v.id)).toEqual([]);
  await checkA11y(page, 'Lesen runner');
});
