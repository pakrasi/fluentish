// Right to left smoke (round 3, C3a; Arch #16). A fixture course in Arabic, whose pack is metadata only (src/lang
// registry: dir 'rtl', no content yet, so the app still shows German content), with the page forced right to left:
// the document and every study-language node get dir="rtl". The layout must hold on every main screen: nothing wider
// than the screen, the tab bar on screen, mirrored (Today at the start edge, the right) and usable.
import { test, expect, seed, open, settle, APP, SHA } from './fixtures.mjs';

const SCREENS = ['#/today', '#/practice', '#/practice/round', '#/exam', '#/exam/1/lesen', '#/lookup', '#/lookup/words', '#/profile', '#/practice/write', '#/practice/situations'];
const SHOTS = process.env.RTL_SHOTS || '';

test('right to left: an Arabic course forced rtl keeps every main screen inside the screen, the tab bar usable', async ({ page }, info) => {
  test.setTimeout(180_000);
  await seed(page, { examInDays: null, veteran: true });
  // the fixture course: Arabic, made active through the app's own settings writer
  await page.evaluate(async sha => {
    const v = `/fluentish/v/${sha}/src/`;
    const [{ createIdbAdapter }, { openSession }, S, clockM] = await Promise.all([
      import(v + 'data/adapters/idb.js'), import(v + 'data/session.js'), import(v + 'data/settings.js'), import(v + 'core/clock.js')]);
    const adapter = await createIdbAdapter();
    const s = await openSession({ adapter, legacyStorage: null, clock: clockM.createClock({ exam: () => null, now: () => new Date() }), kind: 'local' });
    const app = { store: s.store, hlc: s.hlc };
    S.setCourse(app, 'ar', { lang: 'ar', level: 'A1' });
    S.setActiveCourse(app, 'ar');
    await s.store.flush();
    s.store.close();
    adapter.close?.();
  }, SHA);
  // forced right to left: the document, and every study-language node the app marks (dir follows the pack, which is
  // German while Arabic has no content)
  await page.addInitScript(() => {
    const flip = () => {
      if (document.documentElement.dir !== 'rtl') document.documentElement.dir = 'rtl';
      for (const el of document.querySelectorAll('[dir="ltr"]:not([lang="en"])')) el.setAttribute('dir', 'rtl');
    };
    new MutationObserver(flip).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['dir'] });
    document.addEventListener('DOMContentLoaded', flip);
  });
  for (const hash of SCREENS) {
    await open(page, hash);
    await settle(page);
    expect(await page.evaluate(() => document.documentElement.dir), hash).toBe('rtl');
    // nothing wider than the screen
    const over = await page.evaluate(() => {
      const W = document.documentElement.clientWidth;
      const bad = [];
      if (document.documentElement.scrollWidth > W + 1) bad.push(`page scrollWidth ${document.documentElement.scrollWidth} > ${W}`);
      for (const el of document.querySelectorAll('#view *, .tabs *, header *')) {
        const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
        if (!r.width || cs.visibility === 'hidden' || cs.position === 'fixed' && el.closest('[hidden]')) continue;
        if (el.closest('[aria-hidden="true"], .sr-only, [hidden]')) continue;
        // inside a box that scrolls sideways on purpose (chip rows, tables), an element may go past the screen
        let p = el.parentElement, scrolls = false;
        while (p && p !== document.body) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden' || o === 'clip') { scrolls = true; break; } p = p.parentElement; }
        if (scrolls) continue;
        if (r.left < -1 || r.right > W + 1) bad.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} [${Math.round(r.left)}, ${Math.round(r.right)}]`);
      }
      return bad.slice(0, 8);
    });
    expect(over, `${hash}: past the screen edge`).toEqual([]);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/rtl-${info.project.name}-${hash.replace(/[^a-z0-9]+/gi, '_')}.png`, fullPage: false });
    await page.goto(`${APP}version.json`);   // leave the view before the next one (a fresh boot per screen)
  }
  // the tab bar: on screen, mirrored, every tab big enough and working
  await open(page, '#/today');
  const tabs = page.locator('.tabs-bottom a:visible, .tabs-top a:visible');
  const n = await tabs.count();
  expect(n).toBeGreaterThanOrEqual(3);
  const W = await page.evaluate(() => document.documentElement.clientWidth);
  const boxes = [];
  for (let i = 0; i < n; i++) {
    const b = await tabs.nth(i).boundingBox();
    expect(b, `tab ${i}`).not.toBeNull();
    const box = /** @type {{x: number, y: number, width: number, height: number}} */ (b);
    expect(box.x).toBeGreaterThanOrEqual(-1);
    expect(box.x + box.width).toBeLessThanOrEqual(W + 1);
    expect(box.height).toBeGreaterThanOrEqual(40);
    boxes.push(box);
  }
  expect(boxes[0].x, 'mirrored: the first tab (Today) is at the right, the start edge in rtl').toBeGreaterThan(boxes[n - 1].x);
  for (let i = n - 1; i >= 0; i--) {
    const href = await tabs.nth(i).getAttribute('href');
    await tabs.nth(i).click();
    await expect(page).toHaveURL(new RegExp(`${String(href).replace(/[?#/]/g, '\\$&')}`));
    await expect(page.locator('#view h1').first()).toBeVisible();
    await settle(page);
  }
});
