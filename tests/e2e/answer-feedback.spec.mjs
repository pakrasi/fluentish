// Answer feedback, round 8 (S2): a right answer is never red (DESIGN.md Colors), and the verdict sweep lies on the
// field's rule instead of 1 px above it. Display only: grading is the corpus test's. Synthetic learner only.
import { test, expect, seed, open } from './fixtures.mjs';

/** A one-letter swap inside the longest word: a typo the grader forgives (2 edits allowed from 8 letters). @param {string} s */
const withTypo = s => {
  const w = s.split(' ');
  let i = 0;
  w.forEach((x, k) => { if (x.replace(/\W/g, '').length > w[i].replace(/\W/g, '').length) i = k; });
  w[i] = w[i].slice(0, 2) + w[i][3] + w[i][2] + w[i].slice(4);
  return w.join(' ');
};

/** The colours a right answer's feedback draws with, against the theme's --bad. @param {import('@playwright/test').Page} page */
const colours = page => page.evaluate(() => {
  const probe = (/** @type {string} */ v) => { const p = document.createElement('span'); p.style.color = `var(${v})`; document.body.append(p); const c = getComputedStyle(p).color; p.remove(); return c; };
  const bad = probe('--bad'), accent = probe('--accent');
  const fb = /** @type {Element} */ (document.querySelector('.pr-fb'));
  const red = [fb, ...fb.querySelectorAll('*')].filter(e => { const s = getComputedStyle(e); return [s.color, s.textDecorationColor, s.borderBottomColor, s.backgroundColor, getComputedStyle(e, '::after').backgroundColor].includes(bad); }).map(e => e.className || e.tagName);
  // the letters to fix: ui/answer-diff's mark, a ::after bar (round 8 C1 replaced round.js's .pr-slip)
  const fix = document.querySelector('.pr-fb .ui-ad-m.is-fix');
  const bar = fix ? getComputedStyle(fix, '::after') : null;
  return { bad, accent, red, slip: bar ? bar.backgroundColor : null, height: bar ? bar.height : null };
});

test('a typo on a right answer: the letters underlined in accent, nothing in the feedback is red, the sweep lies on the rule', async ({ page }) => {
  await seed(page, { examInDays: 10 });
  await open(page, '#/practice/round');
  await expect(page.locator('.pr-round')).toBeVisible();
  // learn each new card once (Show me), and type the first card that comes back with a typo in its longest word
  /** @type {Map<string, string>} */ const known = new Map();
  const primary = page.locator('.pr-primary');
  for (let k = 0; ; k++) {
    expect(k, 'a card comes back in the round').toBeLessThan(12);
    await expect(primary).toHaveText(/^Check/);
    const prompt = (await page.locator('.pr-promptbox .prompt').first().innerText()).trim();
    const showMe = page.getByRole('button', { name: 'Show me' });
    if (known.has(prompt) && !(await showMe.isVisible())) { await page.locator('#pr-input').fill(withTypo(/** @type {string} */ (known.get(prompt)))); await primary.click(); break; }
    await showMe.click();
    known.set(prompt, String(await page.locator('.pr-fb .answer-key').first().textContent()).replace(/\s+/g, ' ').trim());
    await page.locator('#pr-input').fill(/** @type {string} */ (known.get(prompt)));
    await primary.click();
    await expect(primary).toHaveText(/^(Next|Check)/);
    if (/^Next/.test(await primary.innerText())) await primary.click({ timeout: 3000 }).catch(() => {});
  }
  await expect(page.locator('.pr-res.is-ok')).toHaveText('Right, with a typo');
  await expect(page.locator('.pr-fb .ui-ad-m.is-fix').first()).toBeVisible();
  const c = await colours(page);
  expect(c.slip, 'the fix mark is accent, not --bad').toBe(c.accent);
  expect(c.slip).not.toBe(c.bad);
  expect(c.height).toBe('2px');
  expect(c.red, 'no red on a right answer').toEqual([]);
  // the sweep covers the 1 px border and the 1 px focus shadow under it: one line, not a green line over a black one
  const sweep = await page.locator('.pr-card .answer').evaluate(a => { const s = getComputedStyle(a, '::after'); return { bottom: s.bottom, height: s.height, border: getComputedStyle(a).borderBottomWidth }; });
  expect(sweep).toEqual({ bottom: '-2px', height: '2px', border: '1px' });
});

test('every mark on a right answer is drawn without --bad, in light and dark', async ({ page }) => {
  await seed(page, {});
  await open(page, '#/practice');
  for (const theme of ['light', 'dark']) {
    await page.evaluate(th => { document.documentElement.dataset.theme = th; }, theme);
    const out = await page.evaluate(() => {
      const probe = (/** @type {string} */ v) => { const p = document.createElement('span'); p.style.color = `var(${v})`; document.body.append(p); const c = getComputedStyle(p).color; p.remove(); return c; };
      const bad = probe('--bad');
      // the marks ui/answer-diff (a right answer's fix, and an extra word on a right answer) and the write builder
      // (write.js) put on an answer graded right
      const host = document.createElement('div');
      host.className = 'pr-fb';
      const ad = document.createElement('div');
      ad.className = 'ui-ad is-right-slip';
      host.append(ad);
      for (const [tag, cls, into] of [['span', 'ui-ad-m is-fix', ad], ['span', 'ui-ad-m is-extra', ad], ['button', 'wr-text wr-fixme', host]]) { const e = document.createElement(/** @type {string} */ (tag)); e.className = /** @type {string} */ (cls); e.textContent = 'Geschenk'; /** @type {Element} */ (into).append(e); }
      document.body.append(host);
      const res = [...host.querySelectorAll('span, button')].map(e => ({ cls: e.className, red: [getComputedStyle(e).color, getComputedStyle(e).textDecorationColor, getComputedStyle(e, '::after').backgroundColor].includes(bad) }));
      host.remove();
      return res;
    });
    expect(out.filter(x => x.red), theme).toEqual([]);
  }
});
