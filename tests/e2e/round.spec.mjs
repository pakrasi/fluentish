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

// Round 5: a mistake card says what to do and shows the words around it; his own sentence typed back is wrong and the
// feedback names the capital he left (synthetic records: a line after a greeting, a fragment inside a weil-clause)
test('a mistake card: the task, the kinds of change, the words around it; typing it back unchanged names the capital', async ({ page }, info) => {
  const src = { attemptId: 'W-e2e-1', test: null, module: 'schreiben', label: 'Schreiben Aufgabe 1 · Test' };
  const rec = (/** @type {number} */ n, /** @type {string} */ wrong, /** @type {string} */ right, /** @type {any} */ context) => ({ id: `F:W-e2e-1-${n}`, v: 1, wrong, right, rule: 'Nach der Anrede mit Komma schreibt man klein weiter.', source: src, createdAt: '2026-10-01T10:00:00.000Z', deletedAt: null, context });
  await seed(page, { kv: { mistakes: {
    'F:W-e2e-1-1': rec(1, 'Vielen Dank für deine Nachricht!', 'vielen Dank für deine Nachricht!', { before: 'Liebe Anna,', after: '' }),
    'F:W-e2e-1-2': rec(2, 'meine Hotel hat einen Pool', 'mein Hotel einen Pool hat', { before: 'Mein Urlaub war schön, weil das Wetter gut war und', after: '.' }),
  } } });
  await open(page, '#/practice/round?kind=mistakes');
  await expect(page.locator('.pr-round')).toBeVisible();
  const task = page.locator('.pr-task').first();
  await expect(task).toContainText('Rewrite this correctly.');
  await expect(task).toContainText('thing');
  await expect(page.locator('.pr-context')).toContainText('In your text:');
  await expect(page.locator('.pr-context')).toContainText('___');
  await page.screenshot({ path: info.outputPath('mistake-card.png') });
  const prompt = (await page.locator('.prompt').first().innerText()).trim();
  await page.locator('textarea, input[type="text"]').first().fill(prompt);
  await page.keyboard.press('Enter');
  await expect(page.locator('.pr-res, .pr-study').first()).toBeVisible();
  if (prompt.startsWith('Vielen')) await expect(page.locator('.pr-notes')).toContainText('vielen takes a small letter');
  await page.waitForTimeout(600);
  await page.screenshot({ path: info.outputPath('mistake-feedback.png'), fullPage: true });
  await checkA11y(page, 'mistake card feedback');
});
