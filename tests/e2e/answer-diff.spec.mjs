// Answer feedback with a letter diff (round 8, C1: src/ui/answer-diff.js). Display only: grading is the corpus test's.
// A right answer with a typo shows his answer once with accent marks and nothing red; a near miss marks letters, the
// Right line still reads as the whole sentence (the retype and the helpers read it), and a screen reader gets one
// sentence instead of the drawn marks. Synthetic learner only.
import { test, expect, seed, open, SHA } from './fixtures.mjs';

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

// Round 8 fix pass (UX review S4): a far miss on a gap card still marks the word the card is about
test('a far miss on a gap card: both lines plain except the gap word, marked in the right line', async ({ page }) => {
  await seed(page);
  await open(page, '#/today');
  const out = await page.evaluate(async sha => {
    const { createAnswerDiff } = await import(`/fluentish/v/${sha}/src/ui/answer-diff.js`);
    const { gapWords } = await import(`/fluentish/v/${sha}/src/domain/letterdiff.js`);
    const right = 'Mit dem neuen Auto fahren wir nach Berlin.';
    const gap = gapWords('Mit dem ___ Auto fahren wir nach Berlin. (neu)', right);
    const d = createAnswerDiff({ kind: 'wrong', typed: 'keine Ahnung', right, gap, labels: { you: 'You', right: 'Right' } });
    document.querySelector('#view')?.append(d.el);
    d.finish();
    return { gap, marked: [...d.el.querySelectorAll('.ui-ad-m')].map(m => `${m.className} ${m.textContent}`), mode: d.diff.mode };
  }, SHA);
  expect(out).toEqual({ gap: [2], marked: ['ui-ad-m is-miss is-word neuen'], mode: 'words' });
});

// Round 8 fix pass (design review S6): letters he left out never read as typed: full ink-3 (4.5:1 or more) with the
// wrong line's red dotted underline
test('ghost letters are part of the miss: red dotted underline, contrast 4.5:1 or more', async ({ page }) => {
  await seed(page);
  await open(page, '#/today');
  const out = await page.evaluate(async sha => {
    const { createAnswerDiff } = await import(`/fluentish/v/${sha}/src/ui/answer-diff.js`);
    const d = createAnswerDiff({ kind: 'wrong', typed: 'Das ist ein interessante Buch.', right: 'Das ist ein interessantes Buch.', labels: { you: 'You', right: 'Right' } });
    document.querySelector('#view')?.append(d.el);
    d.finish();
    const g = /** @type {HTMLElement} */ (d.el.querySelector('.ui-ad-m.is-ghost'));
    const cs = getComputedStyle(g);
    const probe = document.createElement('i'); probe.style.color = 'var(--bad)'; document.body.append(probe);
    const bad = getComputedStyle(probe).color; probe.remove();
    /** relative luminance of an rgb() string */
    const lum = (/** @type {string} */ c) => { const [r, gg, b] = (c.match(/[\d.]+/g) || []).map(Number).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * gg + 0.0722 * b; };
    let bg = 'rgb(255, 255, 255)';
    for (let n = /** @type {HTMLElement | null} */ (g); n; n = n.parentElement) { const c = getComputedStyle(n).backgroundColor; if (!/rgba\(0, 0, 0, 0\)|transparent/.test(c)) { bg = c; break; } }
    const [a, b2] = [lum(cs.color), lum(bg)].sort((x, y) => y - x);
    return { text: g.textContent, opacity: cs.opacity, style: cs.textDecorationStyle, red: cs.textDecorationColor === bad, ratio: (a + 0.05) / (b2 + 0.05) };
  }, SHA);
  expect(out).toMatchObject({ text: 's', opacity: '1', style: 'dotted', red: true });
  expect(out.ratio).toBeGreaterThanOrEqual(4.5);
});
