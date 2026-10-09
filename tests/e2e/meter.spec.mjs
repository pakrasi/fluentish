// The meter family and the count-up (round 8 C2: src/ui/meter.js, src/ui/count.js) in the real app, both browsers.
// Look up's map art draws on the meter geometry; the components are mounted into a test host on the Look up page (no
// feature uses them yet), checked for their ARIA, their arcs, the still first draw, the fill on update, the one pop at
// the goal, reduced motion and destroy, and run through axe.
import { test, expect, seed, open, settle, checkA11y, SHA } from './fixtures.mjs';

/** Mount a ring, a bar and a count into a host at the end of #view. @param {import('@playwright/test').Page} page */
async function mountAll(page) {
  await page.evaluate(async sha => {
    const v = `/fluentish/v/${sha}/src/`;
    const [{ mountRing, mountBar }, { mountCount }] = await Promise.all([import(v + 'ui/meter.js'), import(v + 'ui/count.js')]);
    const host = document.createElement('section');
    host.id = 'meter-host';
    const ring = document.createElement('div'), bar = document.createElement('div'), count = document.createElement('p');
    host.append(ring, bar, count);
    document.querySelector('#view')?.append(host);
    const w = /** @type {any} */ (window);
    w.__m = {
      ring: mountRing(ring, { value: 22, max: 60, today: 10, size: 72, name: 'Minutes today', valueText: '22 of 60 minutes today', label: '22' }),
      bar: mountBar(bar, { value: 6, max: 18, today: 6, name: 'New items today', valueText: '6 of 18 new items today' }),
      count: mountCount(count, { value: 7, format: (/** @type {number} */ n) => String(Math.round(n)) }),
    };
  }, SHA);
}
/** The first number of each arc's stroke-dasharray, by class. @param {import('@playwright/test').Page} page */
const arcs = page => page.evaluate(() => Object.fromEntries(['ui-ring-base', 'ui-ring-today', 'ui-ring-over'].map(c => {
  const e = /** @type {SVGElement} */ (document.querySelector(`#meter-host .${c}`));
  return [c, parseFloat(getComputedStyle(e).strokeDasharray)];
})));
/** Running animations and transitions inside the host. @param {import('@playwright/test').Page} page */
const moving = page => page.evaluate(() => document.querySelector('#meter-host')?.getAnimations({ subtree: true }).filter(a => a.playState === 'running').length ?? 0);

test('Look up: the map art is drawn on the meter geometry, and the page passes axe', async ({ page }) => {
  await seed(page);
  await open(page, '#/lookup');
  const art = page.locator('.lk-map-art');
  await expect(art).toHaveCount(1);
  const dashes = await art.locator('circle[stroke-dasharray]').evaluateAll(cs => cs.map(c => c.getAttribute('stroke-dasharray')));
  expect(dashes).toHaveLength(6);
  // 0.7 of a ring of radius 15: 65.973 of 94.248
  expect(dashes[0]).toBe('65.973 94.248');
  await checkA11y(page, 'Look up');
});

test('ring, bar and count: ARIA, a still first draw, a fill on update, one pop at the goal, destroy', async ({ page }) => {
  await seed(page, { motion: 'full' });
  await open(page, '#/lookup');
  await settle(page);
  await mountAll(page);
  const ring = page.locator('#meter-host .ui-ring');
  await expect(ring).toHaveAttribute('role', 'meter');
  await expect(ring).toHaveAttribute('aria-valuenow', '22');
  await expect(ring).toHaveAttribute('aria-valuemax', '60');
  await expect(ring).toHaveAttribute('aria-valuetext', '22 of 60 minutes today');
  await expect(ring).toHaveAttribute('aria-label', 'Minutes today');
  await expect(ring).toHaveAttribute('data-state', 'partial');
  await expect(page.locator('#meter-host .ui-bar')).toHaveAttribute('aria-valuetext', '6 of 18 new items today');
  await expect(page.locator('#meter-host .ui-ring-label')).toHaveText('22');
  // the first draw stands at the value: nothing moves, ink to 12/60 and accent to 22/60 of the circumference
  expect(await moving(page)).toBe(0);
  const C = 2 * Math.PI * 47.25;
  let a = await arcs(page);
  expect(a['ui-ring-base']).toBeCloseTo((12 / 60) * C, 1);
  expect(a['ui-ring-today']).toBeCloseTo((22 / 60) * C, 1);
  expect(a['ui-ring-over']).toBe(0);
  await checkA11y(page, 'Look up with meters');

  // an update fills from what is drawn; reaching the goal pops the ring once
  await page.evaluate(() => { const m = /** @type {any} */ (window).__m; m.ring.update({ value: 60, today: 48, label: '60' }); m.count.update({ value: 10 }); });
  await expect.poll(() => moving(page)).toBeGreaterThan(0);
  await expect(ring).toHaveAttribute('data-state', 'goal');
  await expect.poll(() => page.evaluate(() => document.querySelector('#meter-host .ui-ring-svg')?.getAnimations().length ?? 0)).toBe(1);
  await settle(page);
  a = await arcs(page);
  expect(a['ui-ring-today']).toBeCloseTo(C, 1);
  await expect(page.locator('#meter-host .ui-count-num')).toHaveText('10');
  await expect(page.locator('#meter-host .ui-count .sr-only')).toHaveText('10');
  // over the goal: a second lap, no second pop
  await page.evaluate(() => /** @type {any} */ (window).__m.ring.update({ value: 75, today: 63 }));
  await expect(ring).toHaveAttribute('data-state', 'over');
  await page.waitForTimeout(120);
  expect(await page.evaluate(() => document.querySelector('#meter-host .ui-ring-svg')?.getAnimations().length ?? 0)).toBe(0);
  await settle(page);
  expect((await arcs(page))['ui-ring-over']).toBeGreaterThan(0);
  await expect(ring).toHaveAttribute('aria-valuenow', '60');

  // destroy mid-count: the number stays where it was
  const left = await page.evaluate(async () => {
    const m = /** @type {any} */ (window).__m;
    m.count.update({ value: 500 });
    await new Promise(r => setTimeout(r, 120));
    m.count.destroy(); m.ring.destroy(); m.bar.destroy();
    const at = document.querySelector('#meter-host .ui-count-num')?.textContent;
    await new Promise(r => setTimeout(r, 800));
    return [at, document.querySelector('#meter-host .ui-count-num')?.textContent];
  });
  expect(left[1]).toBe(left[0]);
  expect(Number(left[0])).toBeLessThan(500);
});

test('reduced motion: values at once, nothing moves', async ({ page }) => {
  await seed(page);
  await open(page, '#/lookup');
  await settle(page);
  await mountAll(page);
  await page.evaluate(() => { const m = /** @type {any} */ (window).__m; m.ring.update({ value: 60, today: 48 }); m.bar.update({ value: 18, today: 18 }); m.count.update({ value: 42 }); });
  expect(await moving(page)).toBe(0);
  await expect(page.locator('#meter-host .ui-count-num')).toHaveText('42');
  expect((await arcs(page))['ui-ring-today']).toBeCloseTo(2 * Math.PI * 47.25, 1);
});
