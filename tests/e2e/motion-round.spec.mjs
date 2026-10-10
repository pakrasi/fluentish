// The end of a round with motion ON (round 8, M1; design A3, A4, A7). Every other spec seeds reduced motion, where
// none of this runs. No document.getAnimations() here: Playwright's WebKit crashes the page when it is polled while a
// view transition leaves a round (lanes/motion-chrome.md), so the transition is heard through animationstart events.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, seed, open, SHA } from './fixtures.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
/** Content ids whose cards count as b1 reviews (phrases and grammar). */
const IDS = readFileSync(path.join(ROOT, 'tests/fixtures/shipped-ids.txt'), 'utf8').split('\n').filter(l => /^(K|G):/.test(l));
const day = (/** @type {number} */ n) => { const d = new Date(); d.setHours(12); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
/** n cards in deck b1, due yesterday. @param {number} n */
function dueCards(n) {
  const back = day(-20), due = day(-1);
  return Object.fromEntries(IDS.slice(0, n).map(id => [id, { S: 3, D: 5, due, last: back, reps: 2, lapses: 0, hist: [[back, 3, 0, 0, '']], first: back }]));
}

/** The current card's right answer, as the grader has it, without its prefill. @param {import('@playwright/test').Page} page */
const rightNow = page => page.evaluate(async sha => {
  const { gradeAnswer } = await import(`/fluentish/v/${sha}/src/features/shared/grade.js`);
  const it = /** @type {any} */ (window).__practice.entry.item;
  const g = gradeAnswer(it, '-');
  const r = String(g.target || g.right || '');
  return it.prefill && r.startsWith(it.prefill) ? r.slice(it.prefill.length).trim() : r;
}, SHA);
/** What identifies the card on screen. @param {import('@playwright/test').Page} page */
const cardKey = async page => `${await page.locator('.pr-top-row .caption').first().innerText()} | ${await page.locator('.pr-promptbox').first().innerText()}`;

/** Answer every card right first time (Show me first on a new card when asked) until the done page. */
async function runRound(/** @type {import('@playwright/test').Page} */ page, showMe = false) {
  for (let n = 0; n < 40; n++) {
    if (await page.locator('.pr-done').count()) return;
    await expect(page.locator('.pr-primary')).toHaveText(/^Check/);
    const key = await cardKey(page);
    const move = page.locator('.pr-move').first();
    if (await move.isVisible()) await move.click();
    const show = page.getByRole('button', { name: 'Show me' });
    if (showMe && await show.isVisible()) { await show.click(); await expect(page.locator('.pr-fb .answer-key').first()).toBeVisible(); }
    await page.locator('#pr-input').fill(await rightNow(page));
    await page.locator('#pr-input').press('Enter');
    await expect.poll(async () => {
      if (await page.locator('.pr-done').count()) return 'done';
      const btn = await page.locator('.pr-primary').innerText().catch(() => '');
      if (/^Next/.test(btn)) { await page.locator('#pr-input').press('Enter').catch(() => {}); return key; }
      return /^Check/.test(btn) ? cardKey(page).catch(() => 'done') : key;
    }, { timeout: 10_000 }).not.toBe(key);
  }
  throw new Error('the round did not end');
}

/** Log the view-transition animations that start ("<pseudo> <name>"). @param {import('@playwright/test').Page} page */
const listen = page => page.evaluate(() => {
  const w = /** @type {any} */ (window);
  w.__vtEv = [];
  document.documentElement.addEventListener('animationstart', e => { if (e.pseudoElement?.startsWith('::view-transition')) w.__vtEv.push(`${e.pseudoElement} ${e.animationName}`); });
});
/** @param {import('@playwright/test').Page} page @returns {Promise<string[]>} */
const heard = page => page.evaluate(() => [.../** @type {any} */ (window).__vtEv]);
/** The figure's digits where its odometer columns stand now (from their computed transform). */
const standing = (/** @type {import('@playwright/test').Page} */ page) => page.evaluate(() => [...document.querySelectorAll('.pr-done .figure .odo-col')].map(c => {
  const m = new DOMMatrixReadOnly(getComputedStyle(c).transform);
  return Math.round(-m.m42 / parseFloat(getComputedStyle(c).fontSize) * 100) / 100;
}).join(','));

test('a round ends in one transition: the card lifts, the bars slide back, the figure rolls, +N in accent', async ({ page }) => {
  await seed(page, { examInDays: 10, motion: 'full', cards: { b1: dueCards(5) } });
  await open(page, '#/practice/round');
  await expect(page.locator('.pr-round')).toBeVisible();
  const vt = await page.evaluate(() => typeof document.startViewTransition === 'function');
  const narrow = await page.evaluate(() => innerWidth < 900);
  await listen(page);
  await runRound(page);
  // the end of the transition is when data-vt goes (no settle(): see the header)
  await expect(page.locator('html')).not.toHaveAttribute('data-vt', /.+/);
  if (vt) {
    const log = await heard(page);
    expect(log).toContain('::view-transition-old(pr-done-card) vt-lift');
    expect(log).toContain('::view-transition-new(fx-view) vt-rise');
    expect(log).toContain('::view-transition-new(fx-bar) vt-on-down');
    if (narrow) expect(log).toContain('::view-transition-new(fx-tabs) vt-on-up');
  }
  await expect(page.locator('.bar')).toBeVisible();
  await expect(page.locator('html')).not.toHaveAttribute('data-arrive', /.+/);
  // the figure: an odometer that a screen reader hears as the number, rolled to it
  const fig = page.locator('.pr-done .figure');
  await expect(fig).toHaveClass(/\bodo\b/);
  const n = Number(await fig.getAttribute('aria-label'));
  expect(n).toBeGreaterThan(0);
  await expect(page.locator('.pr-done h1')).toContainText(/of \d+ right first time/);
  await expect.poll(() => standing(page)).toBe(String(n).split('').join(','));
  // the exam items known: the count and what the round added, no bar
  await expect(page.locator('.pr-ready-n b')).toHaveText(/^\d+ of \d+$/);
  await expect(page.locator('.pr-gain')).toHaveText(/^\+\d+$/);
  await expect(page.locator('.pr-ready .track')).toHaveCount(0);
  // the actions were there all along
  await expect(page.locator('.pr-done-actions a').last()).toBeVisible();
});

test('a tap skips the arrival: the figure stands at its number at once', async ({ page }) => {
  await seed(page, { examInDays: 10, motion: 'full', cards: { b1: dueCards(5) } });
  await open(page, '#/practice/round');
  await expect(page.locator('.pr-round')).toBeVisible();
  // tap the done page the moment it is in the DOM, before the roll (120 ms) could have started
  await page.evaluate(() => {
    const mo = new MutationObserver(() => {
      const done = document.querySelector('.pr-done');
      if (!done) return;
      mo.disconnect();
      requestAnimationFrame(() => requestAnimationFrame(() => {
        done.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        const w = /** @type {any} */ (window);
        w.__at = [...done.querySelectorAll('.figure .odo-col')].map(c => /** @type {HTMLElement} */ (c).style.transform).join(',');
      }));
    });
    mo.observe(document.body, { childList: true, subtree: true });
  });
  await runRound(page);
  const n = String(await page.locator('.pr-done .figure').getAttribute('aria-label'));
  await expect.poll(() => page.evaluate(() => /** @type {any} */ (window).__at)).toBe(n.split('').map(d => `translateY(${-Number(d)}em)`).join(','));
});

test('a round of new items only says how many were studied, never "0 of 0"', async ({ page }) => {
  await seed(page, { examInDays: 10, motion: 'full' });
  await open(page, '#/practice/round');
  await expect(page.locator('.pr-round')).toBeVisible();
  await runRound(page, true);
  await expect(page.locator('.pr-done h1')).toContainText(/new items? studied/);
  await expect(page.locator('.pr-done h1')).not.toContainText('of 0');
});

for (const motion of /** @type {const} */ (['full', 'reduce'])) {
  test(`a retype miss points at the first word his copy lacks (motion ${motion})`, async ({ page }) => {
    await seed(page, { examInDays: 10, motion, cards: { b1: dueCards(5) } });
    await open(page, '#/practice/round');
    await expect(page.locator('.pr-round')).toBeVisible();
    const right = await rightNow(page);
    await page.locator('#pr-input').fill('ganz falsch');
    await page.locator('#pr-input').press('Enter');
    await expect(page.locator('.answer.is-retype')).toBeVisible();
    // one slip in a word in the middle of the sentence
    const words = right.split(' ');
    const k = Math.floor(words.length / 2);
    const typo = [...words];
    typo[k] = `${typo[k].slice(0, -2)}x${typo[k].slice(-1)}`;
    await page.locator('#pr-input').fill(typo.join(' '));
    await page.locator('#pr-input').press('Enter');
    const lit = page.locator('.pr-fb [data-pulse="locus"]');
    await expect(lit).toHaveCount(1);
    await expect(lit).toHaveText(words[k]);
    // it goes again by itself (1.44 s; 1.2 s with reduced motion), and the card still waits for the sentence
    await expect(lit).toHaveCount(0, { timeout: 4000 });
    await expect(page.locator('.answer.is-retype')).toBeVisible();
  });
}

// Fix pass (code review S1): "Another round" to the address already showing mounts the round again with no
// hashchange. The done page's field (its observers) and its atmosphere (a WebGL context) end with the view's signal.
test('"Another round" to the same address ends the done page: its field and atmosphere stop', async ({ page }) => {
  await page.addInitScript(() => {
    const w = /** @type {any} */ (window);
    const live = new Map();
    w.__roLive = (/** @type {Element} */ el) => [...live.values()].some(s => s.has(el));
    const RO = window.ResizeObserver;
    window.ResizeObserver = class extends RO {
      /** @param {ResizeObserverCallback} cb */
      constructor(cb) { super(cb); live.set(this, new Set()); }
      /** @param {Element} el @param {ResizeObserverOptions} [o] */
      observe(el, o) { live.get(this)?.add(el); super.observe(el, o); }
      disconnect() { live.get(this)?.clear(); super.disconnect(); }
    };
  });
  // more due than one round takes, so the done page offers another
  await seed(page, { examInDays: 10, motion: 'full', cards: { b1: dueCards(24) } });
  await open(page, '#/practice/round');
  await expect(page.locator('.pr-round')).toBeVisible();
  await runRound(page);
  const again = page.locator('#pr-again');
  await expect(again).toHaveAttribute('href', '#/practice/round');
  await expect(page.locator('.pr-done .pr-done-field')).toBeVisible();
  const before = await page.evaluate(() => {
    const w = /** @type {any} */ (window);
    w.__oldField = document.querySelector('.pr-done .pr-done-field');
    w.__oldAtmo = document.querySelector('.pr-done .atmo');
    return { field: w.__roLive(w.__oldField) };
  });
  expect(before.field).toBe(true);
  // the atmosphere goes live once its shader lands (no WebGL: it never does, and there is nothing to stop)
  await page.waitForTimeout(400);
  await again.click();
  await expect(page.locator('.pr-round')).toBeVisible();
  await expect(page.locator('.pr-done')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => {
    const w = /** @type {any} */ (window);
    return { field: w.__roLive(w.__oldField), atmo: w.__oldAtmo.classList.contains('is-live') };
  })).toEqual({ field: false, atmo: false });
});
