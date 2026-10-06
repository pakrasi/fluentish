import { test, expect, seed, open, checkA11y, storedCards } from './fixtures.mjs';
import { answerCard } from './helpers.mjs';


test('one typed round, from the first card to Done', async ({ page }) => {
  // in exam weeks, as this spec has always run (the default seed's exam is 60 days out: since the exam window that is
  // the calm loop, whose first round is longer)
  await seed(page, { examInDays: 10 });
  await open(page, '#/practice/round');
  await expect(page.locator('.pr-round')).toBeVisible();
  await checkA11y(page, 'round');
  let n = 0;
  const known = new Map();
  while (await answerCard(page, known)) { n++; expect(n, 'the round ends').toBeLessThan(40); }
  await expect(page.locator('.pr-done h1, .pr-done .figure').first()).toBeVisible();
  await checkA11y(page, 'round done');
  // every answer was written through: after a reload the round's cards are in IndexedDB with a review each
  await page.reload();
  await open(page, '#/practice');
  const cards = Object.values(await storedCards(page, 'b1'));
  expect(cards.length).toBeGreaterThan(0);
  expect(cards.every(c => c.reps >= 1)).toBe(true);
});
