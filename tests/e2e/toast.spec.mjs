// The toast and the skeleton (round 8, lane C5; design C §8, §9, F8, F10), in the app:
//   - Undo then Undone: one pill on the screen, never two;
//   - with the keyboard up (WebKit at 390 px, the iOS keyboard emulated as keyboard.spec does) the pill is inside the
//     visible screen and clear of the answer field;
//   - a swipe down or sideways takes it away, a short drag does not; the pointer resting on it holds it;
//   - it is spoken through #live (polite) or #live-assertive, once; reduced motion moves nothing but still swipes;
//   - the Reading library: a fast load shows no skeleton at all, a slow one shows still blocks with aria-busy.
import { test, expect, seed, open, SHA } from './fixtures.mjs';

/** Show a toast through the app's own motion.toast (the same module instance the app uses). @param {import('@playwright/test').Page} page @param {string} text @param {Record<string, any>} [o] */
const toast = (page, text, o = {}) => page.evaluate(([sha, text, o]) => import(`/fluentish/v/${sha}/src/core/motion.js`)
  .then(m => { m.toast(text, o.action ? { ...o, onAction: () => { /** @type {any} */ (window).__acted = true; } } : o); }), /** @type {[string, string, Record<string, any>]} */ ([SHA, text, o]));
/** Pills on the screen (a leaving one is aria-hidden). @param {import('@playwright/test').Page} page */
const pills = page => page.locator('.toast:not([aria-hidden])');

test('Undo, then Back to new: one pill at a time, and the old one is gone after its exit', async ({ page }) => {
  await seed(page, { motion: 'system' });
  await open(page, '#/practice/round');
  await page.getByRole('button', { name: 'I know this' }).click();
  const first = page.locator('.toast').filter({ hasText: 'Marked as known' });
  await expect(first).toBeVisible();
  await expect(first).not.toHaveAttribute('role');
  await first.getByRole('button', { name: 'Undo' }).click();
  await expect(pills(page)).toHaveCount(1);
  await expect(pills(page)).toContainText('Back to new.');
  await expect(page.locator('.toast')).toHaveCount(1);
  // two quick ones in a row: the second waits its turn, then replaces the first
  await toast(page, 'First note.');
  await toast(page, 'Second note.');
  await toast(page, 'Second note.');
  await expect(pills(page)).toHaveCount(1);
  await expect(pills(page)).toContainText('First note.');
  await expect(pills(page)).toContainText('Second note.', { timeout: 3000 });
  await expect(page.locator('.toast')).toHaveCount(1);
});

test('spoken once: polite through #live, assertive through #live-assertive', async ({ page }) => {
  await seed(page);
  await open(page, '#/today');
  await expect(page.locator('#live-assertive')).toHaveAttribute('aria-live', 'assertive');
  await toast(page, 'Saved.');
  await expect(page.locator('#live')).toHaveText('Saved.');
  await toast(page, 'Could not save.', { politeness: 'assertive', ms: 800 });
  await expect(page.locator('#live-assertive')).toHaveText('Could not save.');
  await expect(page.locator('.toast[role], .toast [aria-live]')).toHaveCount(0);
});

test('swipe: a short drag springs back, a drag down or sideways takes it away (also with reduced motion)', async ({ page }) => {
  await seed(page);   // reduced motion: the e2e default
  await open(page, '#/today');
  for (const [dx, dy] of [[0, 90], [-90, 4]]) {
    await toast(page, 'Swipe me.', { ms: 20000 });
    const pill = pills(page);
    await expect(pill).toBeVisible();
    const b = /** @type {{x: number, y: number, width: number, height: number}} */ (await pill.boundingBox());
    const x = b.x + 20, y = b.y + b.height / 2;
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x + 6, y + 6, { steps: 3 }); await page.mouse.up();
    await expect(pill, 'a wobble is not a swipe').toBeVisible();
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x + dx, y + dy, { steps: 8 }); await page.mouse.up();
    await expect(page.locator('.toast')).toHaveCount(0);
  }
  // reduced motion: the pill only fades, nothing moves
  await page.evaluate(() => { document.documentElement.dataset.motion = 'reduce'; });
  await toast(page, 'Still.');
  const moves = await page.evaluate(() => document.getAnimations().flatMap(a => /** @type {KeyframeEffect} */ (a.effect).getKeyframes?.() || [])
    .filter(k => k.translate || k.transform).length);
  expect(moves).toBe(0);
});

test('the pointer resting on it holds it; a drag on Undo is not a tap', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'hover is a desktop matter');
  await seed(page);
  await open(page, '#/today');
  await toast(page, 'Marked as known.', { action: 'Undo', ms: 900 });
  const pill = pills(page);
  await pill.hover();
  await page.waitForTimeout(1600);
  await expect(pill, 'held while the pointer is on it').toBeVisible();
  // drag from the Undo button sideways: the toast goes, the action does not run
  const b = /** @type {{x: number, y: number, width: number, height: number}} */ (await pill.getByRole('button', { name: 'Undo' }).boundingBox());
  await page.mouse.move(b.x + 10, b.y + 10); await page.mouse.down();
  await page.mouse.move(b.x + 120, b.y + 12, { steps: 8 }); await page.mouse.up();
  await expect(page.locator('.toast')).toHaveCount(0);
  expect(await page.evaluate(() => /** @type {any} */ (window).__acted || false)).toBe(false);
  // and once the pointer leaves, its time runs again
  await toast(page, 'Saved.', { ms: 900 });
  await pills(page).hover();
  await page.mouse.move(5, 5);
  await expect(page.locator('.toast')).toHaveCount(0, { timeout: 3000 });
});

test('keyboard up (iPhone): the toast is inside the visible screen and clear of the answer field', async ({ page, browserName }) => {
  test.skip(browserName !== 'webkit', 'the on-screen keyboard is a phone matter (WebKit at 390 px)');
  await page.context().addInitScript(() => {
    const fake = new EventTarget();
    const st = { h: /** @type {number | null} */ (null), top: 0 };
    const def = (/** @type {string} */ k, /** @type {() => number} */ f) => Object.defineProperty(fake, k, { get: f });
    def('height', () => st.h ?? innerHeight); def('width', () => innerWidth); def('offsetTop', () => st.top); def('offsetLeft', () => 0);
    def('pageTop', () => scrollY + st.top); def('pageLeft', () => scrollX); def('scale', () => 1);
    Object.defineProperty(window, 'visualViewport', { get: () => fake, configurable: true });
    /** @type {any} */ (window).__kb = (/** @type {number | null} */ h, top = 0) => { st.h = h; st.top = top; fake.dispatchEvent(new Event('resize')); fake.dispatchEvent(new Event('scroll')); };
  });
  await seed(page);
  await open(page, '#/practice/known/A1');
  await page.getByRole('button', { name: 'Start the check' }).click();
  const field = page.locator('.pr-round textarea');
  await expect(field).toBeFocused();
  for (const [h, top] of [[460, 0], [400, 0], [400, 60]]) {
    await page.evaluate(([h, top]) => /** @type {any} */ (window).__kb(h, top), [h, top]);
    await expect(page.locator('body')).toHaveClass(/\bkb\b/);
    await toast(page, `Marked as known. One check in about 60 days. ${h}/${top}`, { action: 'Undo' });
    const pill = pills(page).filter({ hasText: `${h}/${top}` });
    await expect(pill).toHaveClass(/\bis-kb\b/);
    await page.waitForTimeout(450);
    const t = /** @type {{x: number, y: number, width: number, height: number}} */ (await pill.boundingBox());
    const f = /** @type {{x: number, y: number, width: number, height: number}} */ (await field.boundingBox());
    expect(t.y, `${h}/${top}: below the top of the visible screen`).toBeGreaterThanOrEqual(top);
    expect(t.y + t.height, `${h}/${top}: above the keyboard`).toBeLessThanOrEqual(top + h);
    expect(t.y + t.height <= f.y || t.y >= f.y + f.height, `${h}/${top}: clear of the answer field`).toBe(true);
    await page.evaluate(() => document.querySelectorAll('.toast').forEach(e => e.remove()));
  }
  await expect(field, 'the field kept the focus').toBeFocused();
});

/** Watch for a skeleton that is ever painted (opacity above 0), from before the app boots. @param {import('@playwright/test').Page} page */
const watchSkeleton = page => page.addInitScript(() => {
  const w = /** @type {any} */ (window);
  w.__skelSeen = 0; w.__skelShown = 0;
  const tick = () => {
    const s = document.querySelectorAll('.ui-skel');
    if (s.length) w.__skelSeen++;
    for (const e of s) if (parseFloat(getComputedStyle(e).opacity) > 0.01) w.__skelShown++;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});

test('Reading library, fast: no skeleton is ever painted', async ({ page }) => {
  await watchSkeleton(page);
  await seed(page, { veteran: true, examInDays: null });
  await open(page, '#/practice');
  await page.evaluate(() => { location.hash = '#/practice/read'; });
  await expect(page.locator('#view h1')).toHaveText('Reading');
  await expect(page.locator('.rd-lib .rd-text-row').first()).toBeVisible();
  expect(await page.evaluate(() => /** @type {any} */ (window).__skelShown), 'a fast load paints no skeleton').toBe(0);
});

test('Reading library, slow: still blocks, aria-busy and the status text, then the list', async ({ page }) => {
  await seed(page, { veteran: true, examInDays: null });
  await open(page, '#/practice');
  // the graded texts take 2 s
  await page.route('**/content/read/**', async r => { await new Promise(res => setTimeout(res, 2000)); await r.fallback(); });
  await page.evaluate(() => { location.hash = '#/practice/read'; });
  const skel = page.locator('.rd-lib .ui-skel');
  await expect(skel).toBeVisible();
  await expect(skel).toHaveCSS('opacity', '1');
  await expect(skel).toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('.rd-lib[aria-busy="true"] [role="status"]')).toHaveText('Loading the texts…');
  // reduced motion (the e2e default): no sweep
  expect(await page.evaluate(() => document.getAnimations().some(a => /** @type {any} */ (a).animationName === 'ui-skel-sweep'))).toBe(false);
  await expect(page.locator('.rd-lib .rd-text-row').first()).toBeVisible({ timeout: 8000 });
  await expect(page.locator('.ui-skel')).toHaveCount(0);
  await expect(page.locator('.rd-lib[aria-busy]')).toHaveCount(0);
});

test('a slow skeleton sweeps from 400 ms when motion is on', async ({ page }) => {
  await seed(page, { motion: 'full', veteran: true, examInDays: null });
  await open(page, '#/practice');
  await page.route('**/content/read/**', async r => { await new Promise(res => setTimeout(res, 2000)); await r.fallback(); });
  await page.evaluate(() => { location.hash = '#/practice/read'; });
  await expect(page.locator('.ui-skel').first()).toBeAttached();
  const sweep = () => page.evaluate(() => document.getAnimations().filter(a => /** @type {any} */ (a).animationName === 'ui-skel-sweep')
    .map(a => /** @type {KeyframeEffect} */ (a.effect).getComputedTiming().delay));
  // the view transition may hold the old page while the mount waits; the sweep's own timing is what counts here
  await expect.poll(async () => (await sweep()).length).toBeGreaterThan(0);
  expect(new Set(await sweep())).toEqual(new Set([400]));
});

// Round 8 fix pass: code review S5, S6, N2; design review S3, S4
test('I know this: the toast and its Undo are what #live says; Undo has a 44 px hit box; the toast stays on its page', async ({ page }) => {
  await seed(page, { motion: 'system' });
  await open(page, '#/practice/round');
  await page.getByRole('button', { name: 'I know this' }).click();
  const pill = page.locator('.toast').filter({ hasText: 'Marked as known' });
  await expect(pill).toBeVisible();
  await page.waitForTimeout(700);   // past its entrance (380 ms), so the pill stands still
  await expect(page.locator('#live')).toHaveText('Marked as known. One check in about 60 days. Undo');
  // the hit box: 44 px, so 4.5 px above and below the 34 px button still land on Undo (asked until the pill stands
  // still: on a slow runner its entrance runs longer than the wait above)
  const undo = pill.getByRole('button', { name: 'Undo' });
  await expect.poll(() => undo.evaluate(b => {
    const r = b.getBoundingClientRect(), x = r.left + r.width / 2;
    return [r.top - 4.5, r.bottom + 4.5].map(y => b.contains(document.elementFromPoint(x, y)));
  })).toEqual([true, true]);
  // leave the round: its Undo does not follow to Today
  await page.evaluate(() => { location.hash = '#/today'; });
  await expect(page.locator('#view h1').first()).toBeVisible();
  await expect(pills(page)).toHaveCount(0);
});

test('a repeat is spoken again; a replacement enters only after the old pill has left; keyboard Undo keeps the focus', async ({ page }) => {
  await seed(page, { motion: 'system' });
  await open(page, '#/today');
  await toast(page, 'Saved again.');
  await expect(page.locator('#live')).toHaveText('Saved again.');
  await page.evaluate(() => { const l = /** @type {HTMLElement} */ (document.getElementById('live')); l.textContent = ''; });
  await toast(page, 'Saved again.');
  await expect(page.locator('#live')).toHaveText('Saved again.');
  // a replacement after MIN_SHOW: its entrance is delayed by the old one's exit
  await page.waitForTimeout(1300);
  await toast(page, 'Next one.');
  const delay = await page.locator('.toast').filter({ hasText: 'Next one.' }).evaluate(el => el.getAnimations().map(a => /** @type {any} */ (a.effect).getTiming().delay)[0]);
  expect(delay).toBeGreaterThan(100);
  // Undo from the keyboard: the focus goes back where it was
  await page.evaluate(() => { const b = document.createElement('button'); b.id = 'was-here'; b.textContent = 'Here'; document.querySelector('#view')?.prepend(b); b.focus(); });
  await toast(page, 'With undo.', { action: 'Undo', ms: 20000 });
  await page.waitForTimeout(1300);
  const undo = page.locator('.toast').filter({ hasText: 'With undo.' }).getByRole('button', { name: 'Undo' });
  await expect(undo).toBeVisible();
  await undo.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#was-here')).toBeFocused();
});
