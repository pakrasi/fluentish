import { test, expect, seed, open, checkA11y } from './fixtures.mjs';

// Synthetic script: every heading is a "# …" heading (journey #9: the first one used to be dropped).
const TEXT = '# Einleitung\n\nHallo zusammen, heute erkläre ich euch, wie ein Fahrrad funktioniert. Das Herz jedes Fahrrads ist der Rahmen.\n\n'
  + '# Bremsen\n\nScheibenbremsen funktionieren auch bei Regen zuverlässig. Vielen Dank fürs Zuhören!';

/** Paste the script and mark one word in each section; leaves the page on the last section. @param {import('@playwright/test').Page} page */
async function pasteAndMark(page) {
  await open(page, '#/practice/scripts/new');
  await page.getByRole('textbox', { name: 'Title' }).fill('Fahrrad');
  await page.getByRole('textbox', { name: 'Your script' }).fill(TEXT);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.locator('#view h1')).toHaveText('Einleitung');   // the first "# …" heading is a section
  await expect(page.locator('#view')).toContainText('Section 1 of 2');
  await checkA11y(page, 'Script › mark words');
  await page.getByRole('button', { name: 'Rahmen', exact: true }).click();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.locator('#view h1')).toHaveText('Bremsen');
  await page.getByRole('button', { name: 'Scheibenbremsen', exact: true }).click();
}

test('script: the Marked words sheet after the last section closes, and never outlives its screen', async ({ page }) => {
  await seed(page);
  await pasteAndMark(page);
  // Done on the last section: words without a meaning are offered once, in the Marked words sheet
  await page.locator('.sc-mark-actions .btn-primary, .sc-mark-actions button').last().click();
  const tray = page.locator('dialog.sc-sheet');
  await expect(tray).toBeVisible();
  await expect(tray).toContainText('Rahmen');
  await checkA11y(page, 'Marked words sheet');
  // closing it goes on to the script's overview, with no sheet left
  await tray.getByRole('button', { name: 'Close' }).click();
  await expect(page).toHaveURL(/#\/practice\/scripts\/[^/]+$/);
  await expect(page.locator('dialog.sc-sheet')).toHaveCount(0);
  // every later screen is usable: the tab bar works and nothing modal is left on the page
  await page.locator('nav.tabs a[data-tab="today"]:visible').first().click();
  await expect(page).toHaveURL(/#\/today$/);
  await expect(page.locator('dialog[open]')).toHaveCount(0);
});

test('script: leaving while a sheet is open (Back) removes the sheet', async ({ page }) => {
  await seed(page);
  await pasteAndMark(page);
  await page.getByRole('button', { name: /words? marked/ }).click();   // the tray, opened from the dock
  await expect(page.locator('dialog.sc-sheet')).toBeVisible();
  await page.goBack();                                                  // the browser's Back: a hash change
  await expect(page.locator('#view h1')).toHaveText('Einleitung');
  await expect(page.locator('dialog.sc-sheet')).toHaveCount(0);
});
