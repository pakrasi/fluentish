import { test, expect, seed, open, checkA11y, storedCards } from './fixtures.mjs';

test('Word building: the hub, then one card of a review round', async ({ page }) => {
  // no exam date: Word building is a side deck, and a learner without an exam week gets its new cards
  await seed(page, { examInDays: null });
  await open(page, '#/practice/build');
  await checkA11y(page, 'Word building');
  await page.locator('a[href^="#/practice/build/round"]').first().click();
  const round = page.getByRole('region', { name: 'Word building round' });
  await expect(round).toBeVisible();
  await expect(round).toContainText(/1 of \d+/);
  await checkA11y(page, 'Word building card');
  await round.getByRole('button', { name: 'Got it' }).click();
  await expect(round).toContainText(/2 of \d+/);
  const cards = Object.keys(await storedCards(page, 'build'));
  expect(cards).toHaveLength(1);
  expect(cards[0]).toMatch(/^PX:/);   // the prefix card (shipped id ledger: PX/PD/PV/PS/SX/PW)
});
