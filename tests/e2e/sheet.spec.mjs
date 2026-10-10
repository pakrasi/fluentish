// The sheet (src/ui/sheet.js, round 8 C4): open, drag to dismiss (touch in WebKit at 390 px, a mouse on the handle
// in Chromium at 390 px), a flick, peek and full, Esc and the focus back on the opener, closing when the view is left
// (ctx.signal), the keyboard inside the sheet, the page never scrolled under it, and reduced motion.
// The picker and the week editor are the app's sheets; peek and full use a sheet built in the page from the stamped
// module (no screen uses two detents yet). Every profile here is synthetic.
import { test, expect, seed, open, SHA } from './fixtures.mjs';

/** @typedef {import('@playwright/test').Page} Page */

const PHONE = { width: 390, height: 844 };

/** The phone width in both projects (Chromium's own viewport is a desktop's). @param {Page} page */
async function phone(page) { await page.setViewportSize(PHONE); }

/** Speaking's phrases list and its size picker. @param {Page} page */
async function openPicker(page) {
  await open(page, '#/practice/speak');
  const link = page.locator('a[href="#/practice/round?kind=area:speaking"]');
  await link.click();
  const sheet = page.locator('dialog.ui-sheet');
  await expect(sheet).toBeVisible();
  await expect(sheet).toHaveClass(/is-shown/);
  return { link, sheet };
}

/**
 * A sheet built in the page: `paras` lines of body, an opener button that has the focus.
 * @param {Page} page @param {{detents?: string[], peek?: number, paras?: number, field?: boolean}} [o]
 */
async function demo(page, o = {}) {
  await page.evaluate(async ([sha, o]) => {
    const { createSheet } = await import(`/fluentish/v/${sha}/src/ui/sheet.js`);
    const opener = document.createElement('button');
    opener.id = 'demo-opener'; opener.textContent = 'Open the demo';
    document.querySelector('#view')?.prepend(opener);
    opener.focus();
    const body = Array.from({ length: o.paras ?? 4 }, (_, i) => { const p = document.createElement('p'); p.textContent = `Line ${i + 1}`; return p; });
    const w = /** @type {any} */ (window);
    w.__reasons = [];
    w.__sheet = createSheet({ title: 'Demo', body, detents: o.detents, peek: o.peek, opener, labels: { close: 'Close', expand: 'Expand', collapse: 'Collapse' },
      onClose: (/** @type {string} */ r) => w.__reasons.push(r) });
  }, /** @type {const} */ ([SHA, o]));
  const sheet = page.locator('dialog.ui-sheet');
  await expect(sheet).toHaveClass(/is-shown/);
  await settled(page);
  return sheet;
}

/** The panel's offset down (px) and its height. @param {Page} page */
const where = page => page.locator('.ui-sheet-panel').evaluate(p => ({ y: new DOMMatrix(getComputedStyle(p).transform).m42, h: p.getBoundingClientRect().height, bottom: p.getBoundingClientRect().bottom }));

/** Wait until the sheet's transitions are done. @param {Page} page */
const settled = page => page.waitForFunction(() => !document.getAnimations().some(a => a.playState === 'running'), null, { timeout: 5000 });

/**
 * Drag from near the top of `sel` by dy px in `steps` moves `ms` apart. touch: Touch Events in WebKit (what an iPhone
 * sends); otherwise pointer events of a mouse, dispatched in the page so the timing is the page's own (Playwright's
 * mouse is slow under parallel load, and a flick must stay a flick). real: the Playwright mouse, for slow drags.
 * Returns, for touch, whether each move was held (preventDefault).
 * @param {Page} page @param {string} sel @param {number} dy @param {{steps?: number, ms?: number, touch: boolean, real?: boolean}} o
 */
async function drag(page, sel, dy, { steps = 10, ms = 16, touch, real = false }) {
  if (real && !touch) {
    const box = await page.locator(sel).boundingBox();
    if (!box) throw new Error(`${sel} is not on the screen`);
    const x = box.x + box.width / 2, y0 = box.y + Math.min(box.height / 2, 20);
    await page.mouse.move(x, y0);
    await page.mouse.down();
    for (let i = 1; i <= steps; i++) { await page.mouse.move(x, y0 + (dy * i) / steps); await page.waitForTimeout(ms); }
    await page.mouse.up();
    return [];
  }
  return page.evaluate(async ([sel, dy, steps, ms, touch]) => {
    const el = /** @type {HTMLElement} */ (document.querySelector(sel));
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y0 = r.top + Math.min(r.height / 2, 20);
    // WebKit has no Touch constructor; document.createTouch and createTouchList (what iOS Safari keeps) work
    const d = /** @type {any} */ (document);
    const ev = (/** @type {string} */ type, /** @type {number} */ y) => {
      if (!touch) {
        const kind = { touchstart: 'pointerdown', touchmove: 'pointermove', touchend: 'pointerup' }[type] || type;
        return new PointerEvent(kind, { bubbles: true, cancelable: true, composed: true, pointerId: 7, pointerType: 'mouse', button: 0, buttons: kind === 'pointerup' ? 0 : 1, clientX: x, clientY: y });
      }
      const t = d.createTouch(window, el, 1, x, y + scrollY, x, y);
      const live = type === 'touchend' ? d.createTouchList() : d.createTouchList(t);
      return new TouchEvent(type, { bubbles: true, cancelable: true, composed: true, touches: live, targetTouches: live, changedTouches: d.createTouchList(t) });
    };
    el.dispatchEvent(ev('touchstart', y0));
    const held = [];
    for (let i = 1; i <= steps; i++) {
      await new Promise(r => setTimeout(r, ms));
      held.push(!el.dispatchEvent(ev('touchmove', y0 + (dy * i) / steps)));
    }
    el.dispatchEvent(ev('touchend', y0 + dy));
    return held;
  }, /** @type {const} */ ([sel, dy, steps, ms, touch]));
}

test('the size picker opens as a sheet; Esc closes it and the focus goes back to the list', async ({ page }) => {
  await seed(page, { examInDays: 30, veteran: true });
  const { link, sheet } = await openPicker(page);
  await expect(sheet.getByRole('heading', { level: 2 })).toBeVisible();
  await expect(sheet.locator('.rs-start')).toBeFocused();
  // on the bottom edge (phone) or in the middle (desktop), never scrolled inside its dialog
  await settled(page);
  const box = await where(page), vh = page.viewportSize()?.height || 0;
  if ((page.viewportSize()?.width || 0) < 720) expect(Math.abs(box.bottom - vh)).toBeLessThan(2);
  else expect(Math.abs(box.bottom - box.h / 2 - vh / 2)).toBeLessThan(2);
  expect(await sheet.evaluate(d => d.scrollTop)).toBe(0);
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await expect(link).toBeFocused();
});

test('drag down: a short slow drag springs back, past a third it closes; a flick closes from anywhere', async ({ page, browserName }) => {
  const touch = browserName === 'webkit';
  await phone(page);
  await seed(page, { examInDays: 30, veteran: true, motion: 'system' });
  let { link, sheet } = await openPicker(page);
  await settled(page);
  const { h } = await where(page);
  // a short slow drag on the handle: the sheet follows, then springs back
  const held = await drag(page, '.ui-sheet-grab', 40, { steps: 8, ms: 40, touch, real: true });
  if (touch) expect(held.every(Boolean), 'the page is held while the sheet moves').toBe(true);
  await settled(page);
  await expect(sheet).toBeVisible();
  expect(Math.abs((await where(page)).y)).toBeLessThan(1);
  // past a third, slowly: it closes and the focus goes back to the list
  await drag(page, '.ui-sheet-head', h * 0.45, { steps: 12, ms: 40, touch, real: true });
  await expect(sheet).toHaveCount(0);
  await expect(link).toBeFocused();
  // a flick of 80 px on the header closes it
  ({ sheet } = await openPicker(page));
  await settled(page);
  await drag(page, '.ui-sheet-head', 80, { steps: 4, ms: 12, touch });
  await expect(sheet).toHaveCount(0);
});

test('peek and full: the handle toggles; a flick down steps one detent, then closes', async ({ page, browserName }) => {
  const touch = browserName === 'webkit';
  await phone(page);
  await seed(page, { motion: 'system' });
  await open(page, '#/today');
  await demo(page, { detents: ['peek', 'full'], peek: 0.5 });
  const grab = page.locator('.ui-sheet-grab');
  await expect(grab).toHaveAttribute('aria-expanded', 'false');
  await expect(grab).toHaveAccessibleName('Expand');
  let at = await where(page);
  expect(Math.abs(at.y - at.h / 2)).toBeLessThan(2);
  await grab.click();
  await settled(page);
  await expect(grab).toHaveAttribute('aria-expanded', 'true');
  await expect(grab).toHaveAccessibleName('Collapse');
  expect(Math.abs((await where(page)).y)).toBeLessThan(1);
  // a flick down from full: to peek, not closed
  await drag(page, '.ui-sheet-head', 80, { steps: 4, ms: 12, touch });
  await settled(page);
  at = await where(page);
  expect(Math.abs(at.y - at.h / 2)).toBeLessThan(2);
  // a slow drag up from peek to near the top: full
  await drag(page, '.ui-sheet-head', -at.h * 0.4, { steps: 12, ms: 40, touch });
  await settled(page);
  expect(Math.abs((await where(page)).y)).toBeLessThan(1);
  await drag(page, '.ui-sheet-head', 80, { steps: 4, ms: 12, touch });   // a flick: back to peek
  await settled(page);
  await drag(page, '.ui-sheet-head', 80, { steps: 4, ms: 12, touch });   // and closed
  await expect(page.locator('dialog.ui-sheet')).toHaveCount(0);
  expect(await page.evaluate(() => /** @type {any} */ (window).__reasons)).toEqual(['drag']);
  await expect(page.locator('#demo-opener')).toBeFocused();
});

test('the rubber band above the top, and the page never scrolls under the sheet', async ({ page, browserName }) => {
  test.skip(browserName !== 'webkit', 'touch: WebKit at 390 px');
  await seed(page, { motion: 'system' });
  await open(page, '#/today');
  const before = await page.evaluate(() => ({ html: document.documentElement.style.cssText, body: document.body.style.cssText }));
  await demo(page, { paras: 80 });
  // mid-drag upward: a quarter of the finger's way
  const mid = await page.evaluate(() => new Promise(resolve => {
    const el = /** @type {HTMLElement} */ (document.querySelector('.ui-sheet-head'));
    const r = el.getBoundingClientRect(), x = r.left + 20, y0 = r.top + 10;
    const d = /** @type {any} */ (document);
    const ev = (/** @type {string} */ type, /** @type {number} */ y) => {
      const t = d.createTouch(window, el, 2, x, y, x, y);
      const live = type === 'touchend' ? d.createTouchList() : d.createTouchList(t);
      return new TouchEvent(type, { bubbles: true, cancelable: true, touches: live, targetTouches: live, changedTouches: d.createTouchList(t) });
    };
    el.dispatchEvent(ev('touchstart', y0));
    el.dispatchEvent(ev('touchmove', y0 - 10));
    el.dispatchEvent(ev('touchmove', y0 - 80));
    const y = new DOMMatrix(getComputedStyle(/** @type {Element} */ (document.querySelector('.ui-sheet-panel'))).transform).m42;
    el.dispatchEvent(ev('touchend', y0 - 80));
    resolve(y);
  }));
  expect(mid).toBeCloseTo(-20, 0);
  await settled(page);
  // the scrim and the header hold every move; the body scrolls itself (not held) once it is scrolled down
  expect((await drag(page, '.ui-sheet-scrim', -100, { steps: 3, touch: true })).every(Boolean)).toBe(true);
  await page.locator('.ui-sheet-body').evaluate(b => { b.scrollTop = 200; });
  expect((await drag(page, '.ui-sheet-body', 80, { steps: 3, touch: true })).some(Boolean)).toBe(false);
  await expect(page.locator('dialog.ui-sheet')).toBeVisible();
  // at its top, a pull down on the body moves the sheet and closes it
  await page.locator('.ui-sheet-body').evaluate(b => { b.scrollTop = 0; });
  await drag(page, '.ui-sheet-body', 300, { steps: 10, ms: 30, touch: true });
  await expect(page.locator('dialog.ui-sheet')).toHaveCount(0);
  // nothing was set on the page's own scroll
  expect(await page.evaluate(() => ({ html: document.documentElement.style.cssText, body: document.body.style.cssText }))).toEqual(before);
});

test('Esc and the backdrop close it with their reason; the focus goes back to the opener', async ({ page }) => {
  await phone(page);
  await seed(page);
  await open(page, '#/today');
  await demo(page);
  await expect(page.locator('.ui-sheet-title')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('dialog.ui-sheet')).toHaveCount(0);
  await expect(page.locator('#demo-opener')).toBeFocused();
  await demo(page);
  await page.mouse.click(195, 40);   // the backdrop, above the sheet
  await expect(page.locator('dialog.ui-sheet')).toHaveCount(0);
  await demo(page);
  await page.locator('.ui-sheet-grab').click();   // a one-detent sheet's handle is Close
  await expect(page.locator('dialog.ui-sheet')).toHaveCount(0);
  expect(await page.evaluate(() => /** @type {any} */ (window).__reasons)).toEqual(['button']);
  // Esc and the backdrop were recorded by the earlier sheets
});

test('leaving the view closes the sheet (ctx.signal): the picker and the week editor', async ({ page }) => {
  await phone(page);
  await seed(page, { examInDays: 30, veteran: true, week: { min: Array(7).fill(30), kind: Array(7).fill('n') } });
  await openPicker(page);
  await page.evaluate(() => { location.hash = '#/today'; });
  await expect(page.locator('dialog')).toHaveCount(0);
  await expect(page.locator('#view h1').first()).toBeVisible();
  await open(page, '#/profile/goal');
  await page.locator('button[name="week:day:2"]').click();
  await expect(page.locator('dialog.ui-sheet.week-sheet')).toBeVisible();
  await page.evaluate(() => { history.back(); });
  await expect(page.locator('dialog')).toHaveCount(0);
  await expect(page.locator('main, #view').first()).toBeVisible();
});

// Fix pass (code review S2, S3, N1): a route left during the close animation wins over the reason the close began
// with, and close() resolves however the sheet ends.
test('Back right after Start stays out of the round; Enter during the close starts nothing twice', async ({ page }) => {
  await phone(page);
  await seed(page, { examInDays: 30, veteran: true, motion: 'full' });
  await open(page, '#/today');
  await openPicker(page);
  // Start, then the page is left within the close animation (160 ms)
  await page.evaluate(() => {
    /** @type {HTMLElement} */ (document.querySelector('.rs-start')).click();
    setTimeout(() => { location.hash = '#/today'; }, 30);
  });
  await expect(page.locator('dialog.ui-sheet')).toHaveCount(0);
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => location.hash)).toBe('#/today');
  await expect(page.locator('.pr-round')).toHaveCount(0);
  // Enter twice: one round, one history entry
  await openPicker(page);
  const n0 = await page.evaluate(() => history.length);
  await page.evaluate(() => {
    const dlg = /** @type {HTMLElement} */ (document.querySelector('dialog.ui-sheet'));
    const enter = () => dlg.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    enter(); setTimeout(enter, 40);
  });
  await expect(page.locator('.pr-round')).toBeVisible();
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => history.length)).toBe(n0 + 1);
});

test('a sheet ended during its close animation: the route reason wins and close() resolves on destroy', async ({ page }) => {
  await phone(page);
  await seed(page, { motion: 'full' });
  await open(page, '#/today');
  const out = await page.evaluate(async sha => {
    const { createSheet } = await import(`/fluentish/v/${sha}/src/ui/sheet.js`);
    /** @type {string[]} */ const reasons = [];
    const ac = new AbortController();
    const a = createSheet({ title: 'A', body: [], signal: ac.signal, labels: { close: 'Close' }, onClose: (/** @type {string} */ r) => reasons.push(r) });
    await new Promise(r => setTimeout(r, 300));
    const p1 = a.close('start');
    ac.abort();   // the view is left while it slides out
    const r1 = await Promise.race([p1.then(() => a.closed), new Promise(r => setTimeout(() => r('hung'), 1000))]);
    const b = createSheet({ title: 'B', body: [], labels: { close: 'Close' }, onClose: (/** @type {string} */ r) => reasons.push(r) });
    await new Promise(r => setTimeout(r, 300));
    const p2 = b.close('button');
    b.destroy();
    const r2 = await Promise.race([p2.then(() => b.closed), new Promise(r => setTimeout(() => r('hung'), 1000))]);
    await new Promise(r => setTimeout(r, 300));
    return { r1, r2, reasons, left: document.querySelectorAll('dialog.ui-sheet').length };
  }, SHA);
  expect(out).toEqual({ r1: 'route', r2: 'destroy', reasons: ['route', 'destroy'], left: 0 });
});

test('the keyboard inside the sheet: it sits on the keyboard with Start in view, and goes back down after', async ({ page, browserName }) => {
  test.skip(browserName !== 'webkit', 'the on-screen keyboard is a phone matter (WebKit at 390 px)');
  // the iOS keyboard as keyboard.spec fakes it: the layout viewport keeps its height, visualViewport shrinks
  await page.context().addInitScript(() => {
    const fake = new EventTarget();
    const st = { h: /** @type {number | null} */ (null) };
    const def = (/** @type {string} */ k, /** @type {() => number} */ f) => Object.defineProperty(fake, k, { get: f });
    def('height', () => st.h ?? innerHeight); def('width', () => innerWidth); def('offsetTop', () => 0); def('offsetLeft', () => 0);
    def('pageTop', () => scrollY); def('pageLeft', () => scrollX); def('scale', () => 1);
    Object.defineProperty(window, 'visualViewport', { get: () => fake, configurable: true });
    /** @type {any} */ (window).__kb = (/** @type {number | null} */ h) => { st.h = h; fake.dispatchEvent(new Event('resize')); };
  });
  await seed(page, { examInDays: 30, veteran: true });
  const { sheet } = await openPicker(page);
  await sheet.locator('.rs-opt[data-k=custom]').click();
  await sheet.locator('input.rs-input').focus();
  await page.evaluate(() => /** @type {any} */ (window).__kb(400));
  await expect(sheet).toHaveClass(/is-kb/);
  await settled(page);
  const at = await where(page);
  expect(Math.abs(at.bottom - 400)).toBeLessThan(2);
  expect(at.h).toBeLessThanOrEqual(400);
  const start = await sheet.locator('.rs-start').boundingBox();
  expect(start && start.y >= 0 && start.y + start.height <= 400).toBe(true);
  await page.locator('input.rs-input').blur();
  await page.evaluate(() => /** @type {any} */ (window).__kb(null));
  await expect(sheet).not.toHaveClass(/is-kb/);
  expect(Math.abs((await where(page)).bottom - 844)).toBeLessThan(2);
});

test('reduced motion: open and close fade in place; with motion on the panel slides', async ({ page }) => {
  await phone(page);
  await seed(page, { motion: 'reduce' });
  await open(page, '#/today');
  await demo(page);
  const panel = page.locator('.ui-sheet-panel');
  await expect(page.locator('dialog.ui-sheet')).toHaveClass(/is-rm/);
  expect(await panel.evaluate(p => getComputedStyle(p).transitionProperty)).toBe('opacity');
  // closing: the panel stays where it is and fades (read in the same task as the close starts)
  const mid = await page.evaluate(() => {
    void (/** @type {any} */ (window)).__sheet.close('esc');
    const p = /** @type {HTMLElement} */ (document.querySelector('.ui-sheet-panel'));
    return { y: new DOMMatrix(getComputedStyle(p).transform).m42, closing: /** @type {Element} */ (p.parentElement).classList.contains('is-closing') };
  });
  expect(mid).toEqual({ y: 0, closing: true });
  await expect(page.locator('dialog.ui-sheet')).toHaveCount(0);
  // motion on: the panel's transform is a transition (the slide)
  await seed(page, { motion: 'full' });
  await open(page, '#/today');
  await demo(page);
  await expect(page.locator('dialog.ui-sheet')).not.toHaveClass(/is-rm/);
  expect(await panel.evaluate(p => getComputedStyle(p).transitionProperty)).toContain('transform');
});
