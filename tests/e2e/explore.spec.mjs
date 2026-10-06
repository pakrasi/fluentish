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

test('Look up › Map header (round 5): one status line, Group by, one study action, Key and groups', async ({ page }) => {
  await seed(page);
  await open(page, '#/lookup/map');
  const phone = (page.viewportSize()?.width || 0) < 720;
  // the head row and one status line above the map; the next best group's round is the study action over the map
  const head = await page.locator('.ex-head').boundingBox(), status = await page.locator('.ex-statusrow').boundingBox();
  expect(head && status && status.y + status.height - head.y).toBeLessThan(phone ? 112 : 130);
  const study = page.locator('.ex-hud').getByRole('link', { name: /^Study \d+ words? of / });
  await expect(study).toBeVisible();
  await expect(study).toHaveAttribute('href', /kind=cluster%3Apick&ids=/);
  // Group by: a button and a panel on a phone, chips from 720 px; a mode switch says so on the button
  const modes = page.getByRole('group', { name: 'Group by' });
  if (phone) {
    const btn = page.getByRole('button', { name: 'Group by: Topic' });
    await expect(modes).toBeHidden();
    await btn.click();
    await expect(btn).toHaveAttribute('aria-expanded', 'true');
    await expect(modes.getByRole('button', { name: 'Topic' })).toBeFocused();
    await checkA11y(page, 'Map Group by panel');
    await page.keyboard.press('Escape');
    await expect(modes).toBeHidden();
    await expect(btn).toBeFocused();
    await btn.click();
    await modes.getByRole('button', { name: 'Level' }).click();
    await expect(modes).toBeHidden();
    await expect(page.getByRole('button', { name: 'Group by: Level' })).toBeVisible();
  } else {
    await expect(modes).toBeVisible();
    await modes.getByRole('button', { name: 'Level' }).click();
    await expect(modes.getByRole('button', { name: 'Level' })).toHaveAttribute('aria-pressed', 'true');
  }
  // zoom: − and + with a pointer, pinch on a phone
  await expect(page.getByRole('button', { name: 'Zoom in' })).toBeVisible({ visible: !phone });
  // Key and groups: one panel (the key and Gaps only sit in the row from 720 px); a group flies there and opens its sheet
  const panelBtn = page.getByRole('button', { name: phone ? 'Key and groups' : 'Groups' });
  await panelBtn.click();
  const panel = page.locator('#pl-dist');
  await expect(panel).toBeVisible();
  if (phone) {
    await expect(panel).toContainText(/of [\d,]+ words and phrases known/);
    await expect(panel.getByRole('group', { name: 'Key' })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Gaps only' })).toBeVisible();
  }
  await checkA11y(page, 'Map Key and groups');
  await panel.getByRole('button').filter({ hasText: /known/ }).first().click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('link', { name: /Open the group/ })).toBeVisible();
  await sheet.getByRole('button', { name: 'Close' }).click();
  // Next: the group's name opens its sheet, which says how many common words it has to learn and studies them
  await page.getByRole('button', { name: /^Next: .*Show it on the map/ }).click();
  await expect(sheet).toContainText(/\d+ common words? to learn/);
  await expect(sheet.getByRole('link', { name: /^Study \d+ words? of / })).toBeVisible();
  await checkA11y(page, 'Map next best group sheet');
});
