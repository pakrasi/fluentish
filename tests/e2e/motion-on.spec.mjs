// Route transitions with motion ON. Every other spec seeds reduced motion (no View Transitions run there), which is
// how two swap() bugs reached production unseen:
//   - a route change that starts while the last one is finishing had its data-vt taken off by the old transition, so
//     the page fell back to the browser's own 380 ms plus-lighter crossfade (-ua-view-transition-fade-*) on fx-view;
//   - the skipped transition's `ready` rejected with nobody listening: an unhandled AbortError.
// The console-error fixture fails the test on the second; a recorder of the animations that ran catches the first.
import { test, expect, seed, open, settle, SHA, APP } from './fixtures.mjs';
import { syntheticLog } from './progress-seed.mjs';

/** Start logging every animation on a view-transition pseudo-element (name and pseudo), deduplicated. @param {import('@playwright/test').Page} page */
async function record(page) {
  await page.evaluate(() => {
    const w = /** @type {any} */ (window);
    w.__vt = new Set();
    const tick = () => {
      for (const a of document.getAnimations()) {
        const fx = /** @type {any} */ (a.effect);
        if (fx?.pseudoElement?.startsWith('::view-transition')) w.__vt.add(`${fx.pseudoElement} ${/** @type {any} */ (a).animationName || ''} ${fx.getComputedTiming().duration}`);
      }
      w.__vtRaf = requestAnimationFrame(tick);
    };
    tick();
  });
}
/** @param {import('@playwright/test').Page} page @returns {Promise<string[]>} */
const recorded = page => page.evaluate(() => { const w = /** @type {any} */ (window); cancelAnimationFrame(w.__vtRaf); return [...w.__vt]; });

test('two route changes within 100 ms: no unhandled rejection, data-vt cleared at the end', async ({ page }) => {
  await seed(page, { veteran: true, motion: 'full' });
  // visit both targets first, so their modules are loaded and the second change can start inside the first one
  await open(page, '#/lookup/words'); await settle(page);
  await open(page, '#/practice'); await settle(page);
  await open(page, '#/today'); await settle(page);
  for (const gap of [0, 60]) {
    await page.evaluate(gap => new Promise(r => {
      location.hash = '#/practice';
      setTimeout(() => { location.hash = '#/lookup/words'; setTimeout(r, 40); }, gap);
    }), gap);
    await expect(page).toHaveURL(/#\/lookup\/words$/);
    await settle(page);
    await expect(page.locator('html')).not.toHaveAttribute('data-vt', /.+/);
    await page.evaluate(() => { location.hash = '#/today'; });
    await expect(page).toHaveURL(/#\/today$/);
    await settle(page);
  }
  // the console-error fixture asserts no "Transition was skipped" / AbortError pageerror after the test
});

test('swap() started while the last one is still updating: the skipped one rejects nothing unhandled', async ({ page }) => {
  await seed(page, { veteran: true, motion: 'full' });
  await open(page, '#/today');
  await settle(page);
  const vt = await page.evaluate(async sha => {
    const { swap } = await import(`/fluentish/v/${sha}/src/core/motion.js`);
    if (typeof document.startViewTransition !== 'function') return null;
    const slow = swap(() => new Promise(r => setTimeout(r, 80)), { kind: 'view' });   // a view still rendering
    const fast = swap(() => {}, { kind: 'view' });                                      // the next tap
    await Promise.allSettled([slow, fast]);
    const during = document.documentElement.dataset.vt || null;
    await new Promise(r => setTimeout(r, 900));
    return { during, after: document.documentElement.dataset.vt || null };
  }, SHA);
  test.skip(vt === null, 'no View Transitions here');
  expect(vt).toEqual({ during: 'view', after: null });
});

test('a burst of route changes keeps the kit\'s view transition (never the browser crossfade on fx-view)', async ({ page, browserName }) => {
  test.setTimeout(90_000);
  await seed(page, { veteran: true, motion: 'full' });
  await open(page, '#/today');
  await settle(page);
  const vtSupported = await page.evaluate(() => typeof document.startViewTransition === 'function');
  test.skip(!vtSupported, `${browserName}: no View Transitions here`);
  await record(page);
  // nine navigations, each a little before the previous transition has finished (a tap right after arriving)
  const hops = ['#/practice', '#/lookup', '#/today', '#/today/progress', '#/today', '#/practice', '#/profile', '#/lookup', '#/today'];
  for (const hash of hops) {
    await page.evaluate(h => { location.hash = h; }, hash);
    await page.waitForTimeout(300);
  }
  await settle(page);
  const log = await recorded(page);
  test.info().annotations.push({ type: 'view-transition animations', description: log.sort().join('\n') });
  const ua = log.filter(l => /\(fx-view\)/.test(l) && /-ua-view-transition-fade/.test(l));
  expect(ua, 'fx-view fell back to the browser crossfade').toEqual([]);
  expect(log.some(l => /view-transition-new\(fx-view\) vt-rise/.test(l)), 'the kit\'s rise ran on fx-view').toBe(true);
  await expect(page.locator('html')).not.toHaveAttribute('data-vt', /.+/);
});

test('a named element only the old view has leaves with the page; a pair that morphs keeps its morph', async ({ page }) => {
  await page.goto(`${APP}version.json`);
  const today = await page.evaluate(async sha => (await import(`/fluentish/v/${sha}/src/core/clock.js`)).createClock({ exam: () => null }).today(), SHA);
  await seed(page, { examInDays: null, kv: syntheticLog(today, { days: 90 }), motion: 'full' });
  for (const [target, alone] of [['#/lookup/words', true], ['#/today/progress', false]]) {
    await open(page, '#/today');
    await settle(page);
    await expect(page.locator('.stand-spark')).toHaveCount(1);
    const h1 = page.locator('#view h1').first();
    const todayH1 = await h1.textContent();
    await record(page);
    await page.evaluate(h => { location.hash = h; }, target);
    await expect(h1).not.toHaveText(todayH1 || '');
    await expect(page.locator('html')).not.toHaveAttribute('data-vt', /.+/);
    await settle(page);
    const log = await recorded(page);
    if (alone) {
      // Today's sparkline (pg-known) has no partner on Look up: it fades out in 160 ms with fx-view
      expect(log).toContain('::view-transition-old(pg-known) vt-fade-out 160');
    } else {
      // Today → Progress: the sparkline grows into the chart frame on the browser's morph, as before
      expect(log.some(l => l.startsWith('::view-transition-group(pg-known)'))).toBe(true);
      expect(log.some(l => /view-transition-old\(pg-known\) vt-fade-out/.test(l))).toBe(false);
    }
  }
});
