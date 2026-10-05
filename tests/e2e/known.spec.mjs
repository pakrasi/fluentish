import { test, expect, seed, open, checkA11y, storedCards } from './fixtures.mjs';

test('I know this on a new card, then Undo from the toast', async ({ page }) => {
  await seed(page);
  await open(page, '#/practice/round');
  const prompt = await page.locator('.pr-promptbox .prompt').first().textContent();
  await page.getByRole('button', { name: 'I know this' }).click();
  // the card lifted away: the round shows the next prompt
  await expect(page.locator('.pr-promptbox .prompt').first()).not.toHaveText(String(prompt));
  const marked = Object.entries(await storedCards(page, 'b1'));
  expect(marked).toHaveLength(1);
  const [id, rec] = marked[0];
  expect(rec.known?.by).toBe('self');   // marked known (data/known.js), checked once in about 60 days
  const toast = page.locator('.toast').filter({ hasText: 'Marked as known' });
  await expect(toast).toBeVisible();
  await toast.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.toast').filter({ hasText: 'Back to new.' })).toBeVisible();
  expect(await storedCards(page, 'b1'), `${id} is back to new`).toEqual({});
});

test('Quick sort: Know, Learn, Know, undo the last, then the summary', async ({ page }) => {
  await seed(page);
  await open(page, '#/practice/sort?level=A1');
  await expect(page.locator('.qs-round')).toBeVisible();
  await checkA11y(page, 'Quick sort');
  const word = page.locator('.qs-word');
  const words = [];
  for (const pick of ['Know', 'Learn', 'Know']) {
    words.push(await word.getAttribute('aria-label'));
    await page.locator(`.qs-btn.is-${pick.toLowerCase()}`).click();
    await expect(word).not.toHaveAttribute('aria-label', String(words.at(-1)));
  }
  await page.getByRole('button', { name: /^Undo/ }).click();
  await expect(word).toHaveAttribute('aria-label', String(words[2]));   // the third word is back
  await page.getByRole('button', { name: /^(End|Done)/ }).first().click();
  await expect(page.locator('#view h1').first()).toBeVisible();
  await expect(page.locator('#view')).toContainText(/1 known/i);
  // one word is stored as known, whatever deck its card lives in; the undone one is not
  let marks = 0;
  for (const deck of ['b1', 'clusters', 'speak', 'script']) marks += Object.values(await storedCards(page, deck)).filter(r => r.known).length;
  expect(marks).toBe(1);
  await checkA11y(page, 'Quick sort done');
});
