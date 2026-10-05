import { test, expect, seed, open, checkA11y } from './fixtures.mjs';

test('Look up › Map: the 2D map opens, draws, and opens a group', async ({ page }) => {
  await seed(page);
  await open(page, '#/lookup/map');
  const map = page.getByRole('application', { name: /Map of German words/ });
  await expect(map).toBeVisible();
  const box = await map.boundingBox();
  expect(box && box.width > 200 && box.height > 200).toBe(true);
  // the header: words and phrases known (Today's Where you stand says the same) and the next best group
  await expect(page.locator('.ex-known')).toContainText(/of [\d,]+ words and phrases known/);
  await expect(page.locator('.ex-nextbtn')).toHaveAttribute('href', /kind=cluster%3Apick&ids=/);
  // the canvas has been drawn on (not blank)
  const inked = await page.evaluate(() => {
    const c = /** @type {HTMLCanvasElement | null} */ (document.querySelector('#view canvas'));
    if (!c || !c.width) return false;
    const ctx2d = c.getContext('2d');
    if (!ctx2d) return true;   // a WebGL canvas: drawn if it exists with a size
    const d = ctx2d.getImageData(0, 0, c.width, c.height).data;
    const first = d.slice(0, 4).join();
    for (let i = 0; i < d.length; i += 4 * 97) if (d.slice(i, i + 4).join() !== first) return true;
    return false;
  });
  expect(inked).toBe(true);
  await checkA11y(page, 'Map');
  // keyboard: Tab into the map reaches a group, Enter opens it
  await map.focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('heading', { level: 2 })).toBeVisible();
  await expect(sheet.getByRole('link', { name: /Open the group/ })).toHaveAttribute('href', /^#\/lookup\/map\/\w+\//);
  await checkA11y(page, 'Map group sheet');
  await sheet.getByRole('button', { name: 'Close' }).click();
  await expect(sheet).toBeHidden();
  // the List view reads the same items
  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'List' }).click();
  await expect(page.locator('#view')).toContainText(/known/);
});
