// Round 3 (B3): one path from "see what I know" to "study it". A map group opens its group page, a round started there
// comes back to it, and "On the map" returns to the same group; 3D studies the gaps of the district it is in; the exam
// words list lives in Look up. Synthetic learner and words only.
import { test, expect, seed, open, checkA11y, settle } from './fixtures.mjs';

/** Start the round a link opens: through the round size picker when it asks (Enter takes Recommended). @param {import('@playwright/test').Page} page */
async function startRound(page) {
  const sheet = page.locator('dialog[open]');
  await Promise.race([sheet.waitFor({ state: 'visible' }).catch(() => null), page.locator('.pr-round').waitFor({ state: 'visible' }).catch(() => null)]);
  if (await sheet.isVisible()) await page.keyboard.press('Enter');
  await expect(page.locator('.pr-round')).toBeVisible();
}

test('map group → group page → round → back to the same group, and On the map opens that group again', async ({ page }) => {
  await seed(page);
  await open(page, '#/lookup/map?mode=topic');
  const map = page.getByRole('application', { name: /Map of German words/ });
  await map.focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  const sheet = page.getByRole('dialog');
  const name = (await sheet.getByRole('heading', { level: 2 }).textContent() || '').trim();
  expect(name).not.toBe('');
  await sheet.getByRole('link', { name: /Open the group/ }).click();
  await expect(page).toHaveURL(/#\/lookup\/map\/topic\//);
  const pageUrl = page.url();
  await expect(page.locator('#view h1')).toHaveText(name);
  await expect(page.locator('.gp-head')).toContainText(/of [\d,]+ known/);
  await checkA11y(page, 'Group page');
  // the round starts from the page and End comes back to it
  await page.locator('.cl-dock .btn-primary').click();
  await startRound(page);
  await expect(page).toHaveURL(/from=map%2Ftopic%2F/);
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(pageUrl);
  await expect(page.locator('#view h1')).toHaveText(name);
  // On the map: the map opens on the same group, its sheet open
  await settle(page);
  await page.getByRole('link', { name: 'On the map' }).click();
  await expect(page).toHaveURL(/#\/lookup\/map(\?|$)/);
  await expect(page.getByRole('dialog').getByRole('heading', { level: 2 })).toHaveText(name);
});

test('the old Word clusters address opens the same group page', async ({ page }) => {
  await seed(page);
  await open(page, '#/practice/clusters/family/fallen');
  await expect(page).toHaveURL(/#\/lookup\/map\/family\/fallen$/);
  await expect(page.locator('#view h1')).toHaveText('fallen');
  await expect(page.getByRole('link', { name: /Say it aloud/ })).toHaveAttribute('href', '#/practice/clusters/family/fallen/say');
});

test('3D: Study the gaps here makes a round of the district\'s words not known, through the round size picker', async ({ page }) => {
  await seed(page);
  await open(page, '#/lookup/map?view=3d');
  const ok = await page.waitForFunction(() => {
    const E = /** @type {any} */ (window).__explore;
    return (E && E.palace && E.palace.raised) || document.querySelector('.explore:not(.is-3d)') ? true : null;
  }, null, { timeout: 20_000 }).then(() => page.evaluate(() => !!(/** @type {any} */ (window).__explore?.palace?.raised))).catch(() => false);
  test.skip(!ok, 'no WebGL2 in this browser: 3D falls back to the map (its own spec covers that)');
  // fly into the first district: the button names the district and how many words it has to learn
  await page.evaluate(() => /** @type {any} */ (window).__explore.palace.flyToGroup(0));
  const gaps = page.getByRole('button', { name: /Study the gaps here/ });
  await expect(gaps).toBeVisible();
  await expect(gaps).toHaveAttribute('aria-label', /\d+ words? not known in /);
  await gaps.click();
  const picker = page.locator('dialog[open]');
  await expect(picker).toBeVisible();
  await expect(picker).toContainText(/Not known in /);
  await checkA11y(page, '3D gaps picker');
  await page.keyboard.press('Enter');
  await expect(page.locator('.pr-round')).toBeVisible();
  await expect(page).toHaveURL(/kind=cluster%3Agaps&ids=/);
  // back to the map in 3D, at the same district
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/#\/lookup\/map/);
});

test('Look up › Words › Exam words: the list with its round, and the old Practice address comes here', async ({ page, gh }) => {
  const words = [
    { day: 1, module: 'lesen', teil: 1, word: 'Nachbarschaft', word_key: 'nachbarschaft', lemma: 'Nachbarschaft', gloss: 'neighbourhood', gender: 'die', zipf: 4.4, exam_days: 3, sentence: 'Die Nachbarschaft ist ruhig.' },
    { day: 2, module: 'hoeren', teil: 2, word: 'Termin', word_key: 'termin', lemma: 'Termin', gloss: 'appointment', gender: 'der', zipf: 4.6, exam_days: 4 },
  ];
  gh.files.set('data/vocab.json', Buffer.from(JSON.stringify({ words })).toString('base64'));
  await seed(page, { token: true });
  await open(page, '#/practice/words');
  await expect(page).toHaveURL(/#\/lookup\/words/);
  await expect(page.getByRole('group', { name: 'Which words' }).getByRole('button', { name: 'Exam words' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.lk-exam')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Update now' })).toBeVisible();
  const row = page.locator('.lk-list a.lk-row', { hasText: 'Nachbarschaft' });
  await expect(row).toBeVisible();
  await expect(page.locator('.lk-list')).toContainText('appointment');
  await checkA11y(page, 'Look up exam words');
  // the word panel
  await row.click();
  await expect(page.locator('#view h1')).toContainText('Nachbarschaft');
  await expect(page.locator('#view')).toContainText('Die Nachbarschaft ist ruhig.');
});
