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
    // the newest transition owns data-vt from its update until its own end: read it the moment its update is done
    // (not after the slow one too: on a slow runner the fast transition can be over by then), then wait for the end
    // (fix pass: a fixed 900 ms failed both ways under CI load, on a5e191e as well)
    await fast;
    const during = document.documentElement.dataset.vt || null;
    await Promise.allSettled([slow]);
    const t0 = performance.now();
    while (document.documentElement.dataset.vt && performance.now() - t0 < 5000) await new Promise(r => setTimeout(r, 50));
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
  for (const [target, alone] of /** @type {[string, boolean][]} */ ([['#/lookup/words', true], ['#/today/progress', false]])) {
    await open(page, '#/today');
    await settle(page);
    await expect(page.locator('.stand-spark')).toHaveCount(1);
    const h1 = page.locator('#view h1').first();
    const todayH1 = await h1.textContent();
    // the sparkline has no standing name: it is named only when the Progress row hands it off (motion.js handoff)
    expect(await page.locator('.stand-spark').evaluate(e => getComputedStyle(e).viewTransitionName)).toBe('none');
    await record(page);
    if (alone) await page.evaluate(h => { location.hash = h; }, target);
    else await page.locator('.stand-progress').click();
    await expect(h1).not.toHaveText(todayH1 || '');
    await expect(page.locator('html')).not.toHaveAttribute('data-vt', /.+/);
    await settle(page);
    const log = await recorded(page);
    if (alone) {
      // Today → Look up: the sparkline is part of the page and leaves with fx-view; no pg-known layer at all
      expect(log.filter(l => /pg-known/.test(l))).toEqual([]);
    } else {
      // Today → Progress: the sparkline grows into the chart frame on the browser's morph (handoff → receive)
      expect(log.some(l => l.startsWith('::view-transition-group(pg-known)'))).toBe(true);
      expect(log.some(l => /view-transition-old\(pg-known\) vt-fade-out/.test(l))).toBe(false);
      // and the names are taken off again once the morph has run
      await expect.poll(() => page.locator('.pg-known-frame').evaluate(e => getComputedStyle(e).viewTransitionName)).toBe('none');
    }
  }
});

test('segmented control: no slide on mount; a press slides transform only, never width', async ({ page }) => {
  await seed(page, { veteran: true, motion: 'full' });
  await page.goto(`${APP}#/profile`);
  // log every transition the thumbs run from the first frame of the page
  await page.evaluate(() => {
    const w = /** @type {any} */ (window);
    w.__seg = [];
    document.addEventListener('transitionrun', e => { if (/** @type {Element} */ (e.target).classList?.contains('seg-thumb')) w.__seg.push(e.propertyName); }, true);
  });
  await expect(page.locator('.seg').first()).toBeVisible();
  await settle(page);
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => /** @type {any} */ (window).__seg), 'the thumb moved on its own on mount').toEqual([]);
  // Theme: Auto and Light look the same here (light colour scheme), so the page does not change under the press
  const seg = page.getByRole('group', { name: 'Theme' });
  await expect(seg.getByRole('button', { name: 'Light' })).toHaveAttribute('aria-pressed', 'true');
  await seg.getByRole('button', { name: 'Auto' }).click();
  await expect(seg.getByRole('button', { name: 'Auto' })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.evaluate(() => /** @type {any} */ (window).__seg), { message: 'a press slides the thumb' }).toContain('transform');
  expect(await page.evaluate(() => /** @type {any} */ (window).__seg)).not.toContain('width');
});

test('reduced motion: the answer reveal, the check stroke, round segments, the segmented thumb and the tab dash do not animate', async ({ page }) => {
  await seed(page, { veteran: true });   // the default seed: motion 'reduce'
  await open(page, '#/profile');
  await expect(page.locator('.seg-thumb').first()).toBeAttached();
  const durations = await page.evaluate(() => {
    const mk = (/** @type {string} */ tag, /** @type {string} */ cls, /** @type {Element} */ parent) => { const e = document.createElement(tag); e.setAttribute('class', cls); parent.append(e); return e; };
    const box = mk('div', '', /** @type {Element} */ (document.getElementById('view')));
    const reveal = mk('div', 'reveal-answer', box);
    const answer = mk('div', 'answer is-correct', box);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('class', 'check'); answer.append(svg);
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); svg.append(path);
    const seg = mk('i', 'is-done', mk('div', 'segments', box));
    const d = (/** @type {Element} */ e, /** @type {string | null} */ pseudo = null) => getComputedStyle(e, pseudo).transitionDuration;
    const out = { reveal: d(reveal), check: d(path), segment: d(seg, '::after'), thumb: d(/** @type {Element} */ (document.querySelector('.seg-thumb'))),
      dash: d(/** @type {Element} */ (document.querySelector('.tabs-dash'))) };
    box.remove();
    return out;
  });
  for (const [what, v] of Object.entries(durations)) expect(v.split(',').every(x => parseFloat(x) === 0), `${what}: ${v}`).toBe(true);
});

/* ---------- the chrome moves as one piece (round 8, M2) ---------- */

/** The tab dash's centre and the centre of the current tab, in px. @param {import('@playwright/test').Page} page */
const dashAt = page => page.evaluate(() => {
  const dash = document.querySelector('.tabs-bottom .tabs-dash');
  const cur = document.querySelector('.tabs-bottom a[aria-current="page"]');
  if (!dash || !cur) return null;
  const a = dash.getBoundingClientRect(), b = cur.getBoundingClientRect();
  return { dash: Math.round(a.left + a.width / 2), tab: Math.round(b.left + b.width / 2), drawn: a.width > 0 };
});
/**
 * Log the view-transition animations that start, from animationstart events ("<pseudo> <name>"). The chrome tests use
 * this rather than record(): Playwright's WebKit crashes the page when document.getAnimations() is polled while a
 * view transition leaves a round (seen 9 Oct 2026, on the base commit as well; without the polling the same
 * transition runs clean, and the app never calls getAnimations() on the document).
 * @param {import('@playwright/test').Page} page
 */
async function listen(page) {
  await page.evaluate(() => {
    const w = /** @type {any} */ (window);
    w.__vtEv = [];
    if (w.__vtEvOn) return;
    w.__vtEvOn = true;
    document.documentElement.addEventListener('animationstart', e => { if (e.pseudoElement?.startsWith('::view-transition')) w.__vtEv.push(`${e.pseudoElement} ${e.animationName}`); });
  });
}
/** @param {import('@playwright/test').Page} page @returns {Promise<string[]>} */
const heard = page => page.evaluate(() => [.../** @type {any} */ (window).__vtEv]);
/** Whether the phone tab bar is the one on screen (below 900 px). @param {import('@playwright/test').Page} page */
const phone = page => page.evaluate(() => innerWidth < 900);

test('tab change: the dash slides under the new tab, the bars hold still', async ({ page }) => {
  await seed(page, { veteran: true, motion: 'full' });
  await open(page, '#/practice'); await settle(page);
  await open(page, '#/today'); await settle(page);
  if (!(await phone(page))) {
    // from 900 px the tabs are top links with their own underline: no dash
    await expect(page.locator('.tabs-dash')).toBeHidden();
    await expect(page.locator('.tabs-top a[aria-current="page"]')).toHaveAttribute('data-tab', 'today');
    return;
  }
  expect(await dashAt(page)).toMatchObject({ drawn: true });
  await page.evaluate(() => {
    const w = /** @type {any} */ (window);
    w.__dash = [];
    document.addEventListener('transitionrun', e => { if (/** @type {Element} */ (e.target).classList?.contains('tabs-dash')) w.__dash.push(e.propertyName); }, true);
  });
  await listen(page);
  await page.locator('.tabs-bottom a[data-tab="practice"]').click();
  await expect.poll(() => page.evaluate(() => /** @type {any} */ (window).__dash), { message: 'the dash slides' }).toContain('transform');
  await settle(page);
  const at = /** @type {{dash: number, tab: number}} */ (await dashAt(page));
  expect(Math.abs(at.dash - at.tab)).toBeLessThanOrEqual(1);
  // both bars are on both sides of the change: their layers do not animate (no fade, no slide)
  const log = await heard(page);
  expect(log.some(l => /\(fx-view\) vt-rise/.test(l)), 'a view transition ran').toBe(true);
  expect(log.filter(l => /\(fx-(tabs|bar)\)/.test(l))).toEqual([]);
});

test('the dock is chrome: between two pages with one it holds still, to a page without one it slides off', async ({ page }) => {
  await seed(page, { veteran: true, examInDays: 10, motion: 'full' });
  await open(page, '#/exam'); await settle(page);
  await open(page, '#/today'); await settle(page);
  test.skip(!(await phone(page)), 'the dock is the phone layout');
  test.skip(!(await page.evaluate(() => typeof document.startViewTransition === 'function')), 'no View Transitions here');
  await expect(page.locator('.dock').first()).toBeVisible();
  expect(await page.locator('.dock').first().evaluate(d => getComputedStyle(d).viewTransitionName)).toBe('fx-dock');
  // Today and Exam both have one: no fade, no slide (design review S1: it was a double image inside fx-view)
  await listen(page);
  await page.locator('.tabs-bottom a[data-tab="exam"]').click();
  await expect(page).toHaveURL(/#\/exam/);
  await settle(page);
  const both = await heard(page);
  expect(both.some(l => /\(fx-view\) vt-rise/.test(l)), 'a view transition ran').toBe(true);
  expect(both.filter(l => /\(fx-dock\)/.test(l))).toEqual([]);
  // Look up has none: the dock slides off its bottom edge
  await listen(page);
  await page.locator('.tabs-bottom a[data-tab="lookup"]').click();
  await expect(page).toHaveURL(/#\/lookup/);
  await settle(page);
  expect(await heard(page)).toContain('::view-transition-old(fx-dock) vt-off-down');
});

test('a tapped tab is the current one at once, with its dash (the route confirms it)', async ({ page }) => {
  await seed(page, { veteran: true });
  await open(page, '#/today'); await settle(page);
  const now = await page.evaluate(() => {
    const bar = innerWidth < 900 ? 'bottom' : 'top';
    const a = /** @type {HTMLElement} */ (document.querySelector(`.tabs-${bar} a[data-tab="practice"]`));
    a.click();
    // the same task as the tap: the router has not drawn anything yet
    return [...document.querySelectorAll(`.tabs-${bar} a[aria-current="page"]`)].map(x => /** @type {HTMLElement} */ (x).dataset.tab);
  });
  expect(now).toEqual(['practice']);
  await expect(page).toHaveURL(/#\/practice$/);
});

test('rapid tab taps during a transition: the dash ends under the last tab, nothing left behind', async ({ page }) => {
  await seed(page, { veteran: true, motion: 'full' });
  for (const hsh of ['#/practice', '#/lookup', '#/today']) { await open(page, hsh); await settle(page); }
  // three taps 60 ms apart, each inside the last one's transition
  await page.evaluate(() => new Promise(r => {
    const pick = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.querySelector(`.tabs-${innerWidth < 900 ? 'bottom' : 'top'} a[data-tab="${id}"]`)).click();
    pick('practice');
    setTimeout(() => { pick('lookup'); setTimeout(() => { pick('practice'); setTimeout(r, 40); }, 60); }, 60);
  }));
  await expect(page).toHaveURL(/#\/practice$/);
  await settle(page);
  await expect(page.locator('html')).not.toHaveAttribute('data-vt', /.+/);
  if (await phone(page)) {
    await expect.poll(async () => { const a = await dashAt(page); return a ? Math.abs(a.dash - a.tab) : 99; }).toBeLessThanOrEqual(1);
  }
  // no view-transition pseudo is left on screen, and every chrome layer is back in the page
  expect(await page.evaluate(() => document.getAnimations().filter(a => /** @type {any} */ (a.effect)?.pseudoElement?.startsWith('::view-transition')).length)).toBe(0);
});

test('a round takes the bars away and End gives them back, sliding off and on their own edges', async ({ page }) => {
  await seed(page, { examInDays: 10, motion: 'full' });
  await open(page, '#/today'); await settle(page);
  const vtSupported = await page.evaluate(() => typeof document.startViewTransition === 'function');
  test.skip(!vtSupported, 'no View Transitions here');
  const narrow = await phone(page);
  await listen(page);
  await page.evaluate(() => { location.hash = '#/practice/round'; });
  await expect(page.locator('.pr-round')).toBeVisible();
  await settle(page);
  let log = await heard(page);
  expect(log).toContain('::view-transition-old(fx-bar) vt-off-up');
  if (narrow) expect(log).toContain('::view-transition-old(fx-tabs) vt-off-down');
  // fix pass (design review S2): the round's header and action row come in after the bar has gone
  expect(log).toContain('::view-transition-new(fx-roundhead) vt-fade-in');
  expect(log).toContain('::view-transition-new(fx-roundact) vt-rise');
  await expect(page.locator('.bar')).toBeHidden();
  await listen(page);
  await page.locator('.pr-end').click();
  await expect(page.locator('.pr-round')).toHaveCount(0);
  // no settle() here: it polls document.getAnimations(), which crashes Playwright's WebKit while a view transition
  // leaves a round (on the base commit too); the end of the transition is when data-vt goes
  await expect(page.locator('html')).not.toHaveAttribute('data-vt', /.+/);
  log = await heard(page);
  expect(log).toContain('::view-transition-new(fx-bar) vt-on-down');
  if (narrow) expect(log).toContain('::view-transition-new(fx-tabs) vt-on-up');
  await expect(page.locator('.bar')).toBeVisible();
  if (narrow) await expect.poll(async () => { const a = await dashAt(page); return a ? Math.abs(a.dash - a.tab) : 99; }).toBeLessThanOrEqual(1);
});

// Fix pass (design review S8): Today's figure rolls up once a day, not on every return
test('back on Today the same day, its figure stands at its number (no roll from 0)', async ({ page }) => {
  await seed(page, { examInDays: 10, motion: 'full' });
  await open(page, '#/today'); await settle(page);
  const fig = page.locator('#view .numeral.odo').first();
  await expect(fig).toBeVisible();
  const n = String(await fig.getAttribute('aria-label')).match(/\d+/)?.[0] || '';
  expect(n).not.toBe('');
  await page.evaluate(() => { location.hash = '#/lookup'; });
  await expect(page).toHaveURL(/#\/lookup/);
  await settle(page);
  // the moment the figure is back in the page: where its columns stand
  await page.evaluate(() => {
    const mo = new MutationObserver(() => {
      const el = document.querySelector('#view .numeral.odo');
      if (!el) return;
      mo.disconnect();
      requestAnimationFrame(() => {
        /** @type {any} */ (window).__at = [...el.querySelectorAll('.odo-col')].map(c => {
          const m = new DOMMatrixReadOnly(getComputedStyle(c).transform);
          return Math.round(-m.m42 / parseFloat(getComputedStyle(c).fontSize));
        }).join('');
      });
    });
    mo.observe(document.body, { childList: true, subtree: true });
    location.hash = '#/today';
  });
  await expect.poll(() => page.evaluate(() => /** @type {any} */ (window).__at)).toBe(n);
});
