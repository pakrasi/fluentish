// Practice's hub (round 3, journey #8): what to do now, then three groups that open and close.
import { test, expect, seed, open, checkA11y, settle } from './fixtures.mjs';

test('the hub: the next step, three groups, a group closes and stays closed', async ({ page }) => {
  await seed(page, { examInDays: 30, veteran: true });
  await open(page, '#/practice');
  await expect(page.locator('.pr-queue')).toBeVisible();
  const heads = page.locator('.pr-group-head');
  await expect(heads).toHaveCount(3);
  await expect(heads.nth(0)).toContainText('Exam modules');
  await expect(heads.nth(1)).toContainText('Words');
  await expect(heads.nth(2)).toContainText('Your own material');
  // the exam modules: Schreiben, Sprechen, Lesen phrases and grammar; the old Areas list is gone
  const exam = page.locator('[data-group="exam"]');
  for (const href of ['#/practice/write', '#/practice/speak', '#/practice/round?kind=area:reading', '#/practice/round?kind=area:grammar']) {
    await expect(exam.locator(`a[href="${href}"]`)).toBeVisible();
  }
  await expect(page.locator('.pr-areas')).toHaveCount(0);
  // exam words need a linked results repository: no row without one
  await expect(page.locator('a[href="#/practice/words"], a[href="#/lookup/words"], a[href="#/practice/round?kind=area:words"]')).toHaveCount(0);
  await checkA11y(page, 'Practice hub');
  // close Exam modules: its rows leave the tab order, and the choice survives a reload
  await expect(heads.nth(0)).toHaveAttribute('aria-expanded', 'true');
  await heads.nth(0).click();
  await expect(heads.nth(0)).toHaveAttribute('aria-expanded', 'false');
  await expect(exam.locator('.pr-group-panel')).toHaveJSProperty('inert', true);
  await settle(page);
  await page.reload();
  await expect(page.locator('.pr-group-head').nth(0)).toHaveAttribute('aria-expanded', 'false');
  await page.locator('.pr-group-head').nth(0).click();
  await expect(page.locator('[data-group="exam"] a[href="#/practice/write"]')).toBeVisible();
});

test('with no exam goal the first group is Skills, and a new learner sees his new items as the number', async ({ page }) => {
  await seed(page, { examInDays: null, level: 'A2', minutes: 30 });
  await open(page, '#/practice');
  await expect(page.locator('.pr-group-head').nth(0)).toContainText('Skills');
  await expect(page.locator('.pr-due')).toContainText(/new items? to meet today/);
  await expect(page.locator('#pr-start')).toBeVisible();
});

test('Sprechen holds its phrases; the size picker keeps Practice all behind More choices', async ({ page }) => {
  await seed(page, { examInDays: 30, veteran: true });
  await open(page, '#/practice/speak');
  const phrases = page.locator('a[href="#/practice/round?kind=area:speaking"]');
  await expect(phrases).toBeVisible();
  await phrases.click();
  const sheet = page.locator('dialog.ui-sheet');
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('radio', { name: /Practice all/ })).toBeHidden();
  await sheet.getByRole('button', { name: 'More choices' }).click();
  await expect(sheet.getByRole('radio', { name: /Practice all/ })).toBeVisible();
  await checkA11y(page, 'round size picker');
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
});
