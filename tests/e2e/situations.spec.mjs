import { test, expect, seed, open, checkA11y, storedCards } from './fixtures.mjs';

/** A stand-in for the browser's speech recogniser: it "hears" window.__heard. */
const fakeRecogniser = () => {
  class FakeRecognition {
    /** @type {((e: any) => void) | null} */ onresult = null;
    /** @type {(() => void) | null} */ onend = null;
    start() {
      setTimeout(() => {
        const text = /** @type {any} */ (window).__heard || '';
        if (text) {
          const alt = [{ transcript: text, confidence: 0.9 }];
          this.onresult?.({ resultIndex: 0, results: [Object.assign(alt, { isFinal: true })] });
        }
        this.onend?.();
      }, 30);
    }
    stop() {}
    abort() {}
  }
  Object.assign(window, { SpeechRecognition: FakeRecognition, webkitSpeechRecognition: FakeRecognition });
};

test('a situation is heard first: the words wait behind Show the words', async ({ page }) => {
  await seed(page, { veteran: true, examInDays: null, motion: 'full' });
  await open(page, '#/practice/situations/round?pick=mixed');
  const card = page.locator('.sim-card');
  await expect(card).toBeVisible();
  const line = card.locator('.sim-them .sim-line');
  await expect(line).toBeHidden();
  const show = card.getByRole('button', { name: 'Show the words' });
  await expect(show).toBeVisible();
  await checkA11y(page, 'situation, line hidden');
  await show.click();
  await expect(line).toBeVisible();
  await expect(show).toBeHidden();
  // Show answer always puts the words on screen too, and grading moves on
  await page.getByRole('button', { name: /^Show answer/ }).click();
  await expect(card.locator('.sim-reveal.is-open')).toHaveCount(1);
  await page.locator('.grade4-b[data-g="3"]').click();
  await expect(line).toBeHidden();   // the next card starts heard-first again
  expect(Object.keys(await storedCards(page, 'speak'))).toHaveLength(1);
});

test('with reduced motion the line is always on screen', async ({ page }) => {
  await seed(page, { veteran: true, examInDays: null, motion: 'reduce' });
  await open(page, '#/practice/situations/round?pick=mixed');
  await expect(page.locator('.sim-them .sim-line')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Show the words' })).toBeHidden();
});

test('Check with the mic inside a situation: the phrase heard, a suggested grade, the card graded', async ({ page }) => {
  await page.addInitScript(fakeRecogniser);
  await seed(page, { veteran: true, examInDays: null });
  await open(page, '#/practice/situations/round?pick=mixed');
  const card = page.locator('.sim-card');
  const toggle = card.getByRole('button', { name: 'Check with the mic' });
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  // say the model answer (it is on the card, folded away until Show answer)
  const answer = String(await card.locator('.sim-you .sim-line').textContent());
  await page.evaluate(a => { /** @type {any} */ (window).__heard = a; }, answer);
  await card.getByRole('button', { name: 'Say your answer' }).click();
  await expect(card.locator('.sim-heard')).toContainText('You said:');
  await expect(card.locator('.sim-heard .pr-checks')).toContainText('Right');
  await expect(card.locator('.sim-reveal.is-open')).toHaveCount(1);
  await expect(page.locator('.grade4-b.is-suggested')).toHaveAttribute('data-g', '3');
  await checkA11y(page, 'situation, mic checked');
  await page.locator('.grade4-b.is-suggested').click();
  // the switch stays on for the next card and the next round
  await expect(card.getByRole('button', { name: 'Say your answer' })).toBeVisible();
  // a wrong answer: the chunk is missing, Again is suggested
  await page.evaluate(() => { /** @type {any} */ (window).__heard = 'ja'; });
  await card.getByRole('button', { name: 'Say your answer' }).click();
  await expect(card.locator('.sim-heard .pr-checks')).toContainText('Wrong');
  await expect(page.locator('.grade4-b.is-suggested')).toHaveAttribute('data-g', '1');
});

test('Say it aloud folded into Sprechen: its old routes open the situations, the mic check stays', async ({ page }) => {
  await page.addInitScript(fakeRecogniser);
  await seed(page, { veteran: true, examInDays: null });
  await open(page, '#/practice/speak');
  await expect(page.locator('#view')).not.toContainText('Say it aloud');
  await expect(page.locator('a[href="#/practice/situations"]')).toBeVisible();
  await expect(page.locator('a[href="#/practice/speak/aloud/check"]')).toBeVisible();
  await checkA11y(page, 'Sprechen');
  for (const old of ['#/practice/speak/aloud', '#/practice/speak/aloud/go', '#b1/aloud']) {
    await open(page, old);
    await expect(page).toHaveURL(/#\/practice\/situations$/);
    await expect(page.locator('#view h1')).toHaveText('Speaking situations');
  }
  await open(page, '#/practice/speak/aloud/check');
  await expect(page.locator('#view h1')).toHaveText('Mic check');
});

test('I know this on a situation asks Check by typing first: a miss marks nothing, the chunk typed right marks it known', async ({ page }) => {
  await seed(page, { veteran: true, examInDays: null });
  await open(page, '#/practice/situations/round?pick=mixed');
  const card = page.locator('.sim-card');
  await expect(card).toBeVisible();
  await page.getByRole('button', { name: /^I know this/ }).click();
  const panel = page.locator('.pr-typecheck');
  await expect(panel).toBeVisible();
  const input = panel.locator('textarea');
  await expect(input).toBeFocused();
  await checkA11y(page, 'situation, Check by typing');
  await input.fill('Das weiß ich nicht.');
  await input.press('Enter');
  await expect(panel).toContainText('Not marked');
  expect(await storedCards(page, 'speak')).toEqual({});
  await panel.getByRole('button', { name: /^Go on/ }).click();
  await expect(panel).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Show answer/ })).toBeVisible();
  // again, typed right: the chunk of the model answer
  const chunk = String(await card.locator('.sim-you .sim-chunk').textContent());
  await page.getByRole('button', { name: /^I know this/ }).click();
  await page.locator('.pr-typecheck textarea').fill(chunk);
  await page.locator('.pr-typecheck textarea').press('Enter');
  await expect.poll(async () => Object.values(await storedCards(page, 'speak')).filter(r => r.known).length).toBe(1);
});
