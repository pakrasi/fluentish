import { test, expect, seed, open, checkA11y } from './fixtures.mjs';

test('a Lesen module: answer every Aufgabe, submit, see the score and the review', async ({ page }) => {
  await seed(page);
  await open(page, '#/exam/1/lesen');
  await page.getByRole('button', { name: /Lesen starten/ }).click();
  await expect(page.getByRole('timer')).toBeVisible();
  await checkA11y(page, 'Lesen runner');
  const tabs = page.getByRole('tab');
  const n = await tabs.count();
  expect(n).toBeGreaterThan(1);
  for (let i = 0; i < n; i++) {
    await tabs.nth(i).click();
    const panel = page.getByRole('tabpanel');
    const groups = panel.getByRole('radiogroup');
    const g = await groups.count();
    for (let k = 0; k < g; k++) await groups.nth(k).getByRole('radio').first().check();
  }
  await expect(page.getByText(/30 von 30 beantwortet/).first()).toBeVisible();
  await page.getByRole('button', { name: 'Abgeben' }).last().click();
  const confirm = page.getByRole('alertdialog', { name: 'Lesen abgeben?' });
  await expect(confirm).toContainText('30 von 30 beantwortet');
  await confirm.getByRole('button', { name: 'Abgeben' }).click();
  await expect(page).toHaveURL(/#\/exam\/1\/lesen\/review\//);
  await expect(page.locator('#view h1').first()).toBeVisible();
  await checkA11y(page, 'Lesen review');
});
