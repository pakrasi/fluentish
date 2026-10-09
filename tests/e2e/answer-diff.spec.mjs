// Answer feedback with a letter diff (round 8, C1: src/ui/answer-diff.js). Display only: grading is the corpus test's.
// A right answer with a typo shows his answer once with accent marks and nothing red; a near miss marks letters, the
// Right line still reads as the whole sentence (the retype and the helpers read it), and a screen reader gets one
// sentence instead of the drawn marks. Synthetic learner only.
import { test, expect, seed, open } from './fixtures.mjs';

/** @param {string[]} w */
const longest = w => { let i = 0; w.forEach((x, k) => { if (x.replace(/\W/g, '').length > w[i].replace(/\W/g, '').length) i = k; }); return i; };
/** Two letters swapped in the longest word: a typo the grader forgives. @param {string} s */
const withTypo = s => { const w = s.split(' '), i = longest(w); w[i] = w[i].slice(0, 2) + w[i][3] + w[i][2] + w[i].slice(4); return w.join(' '); };
/** The second word without its last two letters: a near miss in the graded phrase. @param {string} s */
const nearMiss = s => { const w = s.split(' '); const m = /^(.*?)(\W*)$/.exec(w[1]); w[1] = /** @type {RegExpExecArray} */ (m)[1].slice(0, -2) + /** @type {RegExpExecArray} */ (m)[2]; return w.join(' '); };

/** Learn the new cards (Show me, type once) until one comes back; answer it with make(right). @param {import('@playwright/test').Page} page @param {(s: string) => string} make */
async function answerReturning(page, make) {
  await seed(page, { examInDays: 10 });
  await open(page, '#/practice/round');
  /** @type {Map<string, string>} */ const known = new Map();
  const primary = page.locator('.pr-primary');
  for (let k = 0; ; k++) {
    expect(k, 'a card comes back in the round').toBeLessThan(12);
    await expect(primary).toHaveText(/^Check/);
    const prompt = (await page.locator('.pr-promptbox .prompt').first().innerText()).trim();
    const showMe = page.getByRole('button', { name: 'Show me' });
    if (known.has(prompt) && !(await showMe.isVisible())) {
      const right = /** @type {string} */ (known.get(prompt));
      await page.locator('#pr-input').fill(make(right));
      await primary.click();
      return right;
    }
    await showMe.click();
    known.set(prompt, String(await page.locator('.pr-fb .answer-key').first().textContent()).replace(/\s+/g, ' ').trim());
    await page.locator('#pr-input').fill(/** @type {string} */ (known.get(prompt)));
    await primary.click();
    await expect(primary).toHaveText(/^(Next|Check)/);
    if (/^Next/.test(await primary.innerText())) await primary.click({ timeout: 3000 }).catch(() => {});
  }
}

test('a typo on a right answer: the word once in its right spelling, the letters in accent, nothing red', async ({ page }) => {
  const right = await answerReturning(page, withTypo);
  await expect(page.locator('.pr-res.is-ok')).toHaveText('Right, with a typo');
  const fix = page.locator('.pr-fb .ui-ad-m.is-fix').first();
  await expect(fix).toBeVisible();
  const c = await page.evaluate(() => {
    const probe = (/** @type {string} */ v) => { const p = document.createElement('span'); p.style.color = `var(${v})`; document.body.append(p); const col = getComputedStyle(p).color; p.remove(); return col; };
    const bad = probe('--bad'), accent = probe('--accent');
    const fb = /** @type {Element} */ (document.querySelector('.pr-fb'));
    const red = [fb, ...fb.querySelectorAll('*')].filter(e => [getComputedStyle(e).color, getComputedStyle(e).textDecorationColor, getComputedStyle(e, '::after').backgroundColor].includes(bad)).map(e => e.className || e.tagName);
    return { accent, red, mark: getComputedStyle(/** @type {Element} */ (document.querySelector('.ui-ad-m.is-fix')), '::after').backgroundColor };
  });
  expect(c.mark).toBe(c.accent);
  expect(c.red, 'no red on a right answer').toEqual([]);
  // the line reads as the right answer (his typo is not kept beside it)
  const line = String(await page.locator('.pr-fb .ui-ad-you').textContent()).replace(/\s+/g, ' ').trim();
  expect(line).toBe(right.replace(/\s+/g, ' ').trim());
});

test('a near miss: letters marked, the Right line is the whole sentence, one sentence for a screen reader', async ({ page }) => {
  const right = await answerReturning(page, nearMiss);
  await expect(page.locator('.pr-res.is-bad')).toBeVisible();
  const ad = page.locator('.pr-fb .ui-ad');
  await expect(ad).toHaveAttribute('data-mode', 'letters');
  await expect(ad.locator('.ui-ad-you .ui-ad-m.is-ghost')).toHaveCount(1);
  await expect(ad.locator('.ui-ad-right .ui-ad-m.is-miss')).toHaveCount(1);
  await expect(ad.locator('.ui-ad-caption')).toContainText('Letters missing at the end of');
  const key = String(await page.locator('.pr-fb .answer-key').first().textContent()).replace(/\s+/g, ' ').replace(/^Right:\s*/, '').trim();
  expect(key).toBe(right.replace(/\s+/g, ' ').trim());
  for (const l of await ad.locator('.ui-ad-line').all()) await expect(l).toHaveAttribute('aria-hidden', 'true');
  await expect(ad.locator('.sr-only')).toContainText(right.replace(/\s+/g, ' ').trim());
  // typed right once: his line goes, the Right line stays
  await page.locator('#pr-input').fill(right);
  await page.locator('.pr-primary').click();
  await expect(page.locator('.pr-res.is-ok')).toBeVisible();
  await expect(ad.locator('.ui-ad-you')).toHaveCount(0);
  await expect(ad.locator('.ui-ad-right')).toBeVisible();
});
