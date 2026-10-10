// Word families, the round 7 design pass: the board fits a phone at every level, the ring never overlaps, a find says
// what its parts mean, the done screen lists the board's prefixes and endings with their meanings and names tomorrow's
// root, Today's family is in view on Today, the family view is a few tab stops deep, and names start with the text
// shown (WCAG 2.5.3). Synthetic learner only.
import { test, expect, seed, open, checkA11y, settle } from './fixtures.mjs';
import { AxeBuilder } from '@axe-core/playwright';

const PHONE = { width: 390, height: 664 };
const NARROW = { width: 360, height: 664 };

/** No two boxes of these elements intersect. @param {import('@playwright/test').Page} page @param {string} sel */
const overlaps = (page, sel) => page.evaluate(sel => {
  const bx = [...document.querySelectorAll(sel)].map(e => ({ t: e.textContent || e.getAttribute('class'), r: e.getBoundingClientRect() })).filter(x => x.r.width);
  /** @type {string[]} */ const hits = [];
  for (let i = 0; i < bx.length; i++) for (let j = i + 1; j < bx.length; j++) {
    const a = bx[i].r, b = bx[j].r;
    if (a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5) hits.push(`${bx[i].t} × ${bx[j].t}`);
  }
  return hits;
}, sel);

/** The targets of these elements a tap 22 px above or below the centre misses (a 44 px tall hit box; the box may be
 * drawn smaller and grown with a ::before, as .hx and .fv-node do). @param {import('@playwright/test').Page} page @param {string} sel */
const shortTargets = (page, sel) => page.evaluate(sel => [...document.querySelectorAll(sel)].filter(e => {
  const r = e.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
  return r.width && [y - 21.5, y + 21.5].some(yy => document.elementFromPoint(x, yy)?.closest(sel) !== e);
}).map(e => e.textContent), sel);

/** WCAG 2.5.3 (axe's label-content-name-mismatch is experimental, so it is asked for by name). @param {import('@playwright/test').Page} page @param {string} [only] a selector to check alone */
async function labelInName(page, only = '') {
  await settle(page);   // a half-faded frame is not what is measured
  const ax = new AxeBuilder({ page }).withRules(['label-content-name-mismatch']).options({ preload: false });
  const res = await (only ? ax.include(only) : ax).analyze();
  return res.violations.filter(v => v.id === 'label-content-name-mismatch').flatMap(v => v.nodes.map(n => n.target.join(' ')));
}

/** Build the open clue with its tiles (and answer Splits or Stays). @param {import('@playwright/test').Page} page */
async function solveOne(page) {
  const box = page.getByRole('region', { name: "Today's family" });
  if (await page.evaluate(() => { const x = /** @type {any} */ (window).__family; return !!x.day.done[x.day.cards[x.idx]]; })) await box.locator('.pz-check').click();
  const s = await page.evaluate(() => { const x = /** @type {any} */ (window).__family; const f = x.forms[x.idx]; return { card: x.day.cards[x.idx], pre: [...f.pre].reverse(), suf: [...f.suf], art: f.art || null, join: f.cls === 'verb' ? f.join : null }; });
  for (const p of s.pre) await box.getByRole('button', { name: `Prefix ${p}-`, exact: true }).click();
  for (const x of s.suf) await box.locator(`button[data-suf="${x}"]`).click();
  if (s.art) await box.getByRole('button', { name: `Article ${s.art}`, exact: true }).click();
  await box.getByRole('button', { name: /^Check/ }).click();
  if (s.join) await box.getByRole('group', { name: 'Does the prefix split off?' }).getByRole('button', { name: s.join === 's' ? /^Splits/ : /^Stays/ }).click();
  await expect.poll(() => page.evaluate(card => !!(/** @type {any} */ (window).__family.day.done[card]), s.card)).toBe(true);
}

for (const [level, size] of /** @type {const} */ ([['A2', PHONE], ['B1', PHONE], ['B2', PHONE], ['B2', NARROW]])) {
  test(`the ${level} board fits ${size.width} × ${size.height}: Check in view on every meaning, no tiles overlap`, async ({ page, isMobile }) => {
    test.skip(!isMobile, 'a phone layout');
    await page.setViewportSize(size);
    await seed(page, { examInDays: null, veteran: true, level });
    await open(page, '#/practice/build/today');
    await expect.poll(() => page.evaluate(() => !!(/** @type {any} */ (window).__family))).toBe(true);
    const n = await page.evaluate(() => /** @type {any} */ (window).__family.day.cards.length);
    for (let i = 0; i < n; i++) {
      await settle(page);
      const check = await page.locator('.pz-check').boundingBox();
      expect(check && check.y + check.height, `meaning ${i + 1}`).toBeLessThanOrEqual(size.height);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
      await expect(page.locator('.pz-hive .hx.is-centre')).toBeVisible();
      expect(await overlaps(page, '.pz-hive .hx, .pz-ends .hx')).toEqual([]);
      expect(await shortTargets(page, '.pz-hive .ui-tile, .pz-ends .ui-tile'), 'tiles: 44 px tall targets').toEqual([]);
      await page.locator('.pz-meaning').click();
      await page.keyboard.press('ArrowDown');
    }
  });
}

test('the ring never overlaps: every root at 360 px, the rest of a dense family as chips', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'a phone layout');
  test.setTimeout(120_000);
  await page.setViewportSize(NARROW);
  await seed(page, { examInDays: null, veteran: true });
  await open(page, '#/practice/build/family/stellen');
  const roots = await page.evaluate(() => [...document.querySelectorAll('.fv-chips .chip')].map(x => String(x.textContent)));
  expect(roots.length).toBeGreaterThanOrEqual(15);
  for (const r of roots) {
    await page.goto(`/fluentish/#/practice/build/family/${r}`);
    await expect(page.getByRole('heading', { level: 1, name: r, exact: true })).toBeVisible();
    await expect(page.locator('.fv-node').first()).toBeVisible();
    // the squares are placed again from the tiles' measured size in the frame after the ring is drawn
    await page.evaluate(() => new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res))));
    expect(await overlaps(page, '.fv-node, .fv-node-root, .fv-kid, .fv-node .fv-gr'), r).toEqual([]);
    // ring nodes are about 40 px apart, so neighbouring hit areas may overlap: measure the ::before hit box itself
    const short = await page.evaluate(() => [...document.querySelectorAll('.fv-node')].filter(e => { const b = getComputedStyle(e, '::before'); return e.getBoundingClientRect().height - parseFloat(b.top) - parseFloat(b.bottom) < 44; }).map(e => e.textContent));
    expect(short, `${r}: 44 px tall targets`).toEqual([]);
    const outside = await page.evaluate(() => { const c = /** @type {Element} */ (document.querySelector('.fv-ring-card')).getBoundingClientRect(); return [...document.querySelectorAll('.fv-node, .fv-kid')].filter(e => { const b = e.getBoundingClientRect(); return b.left < c.left || b.right > c.right || b.top < c.top || b.bottom > c.bottom; }).length; });
    expect(outside, r).toBe(0);
    expect(await page.locator('.fv-node').count(), r).toBeLessThanOrEqual(12);
  }
  // kommen has 20 verbs: 12 on the ring, the rest as chips, the most common first
  await page.goto('/fluentish/#/practice/build/family/kommen');
  await expect(page.locator('.fv-vchip').first()).toBeVisible();
  await page.locator('.fv-vchip').first().click();
  await expect(page.locator('.fv-detail.is-open')).toHaveCount(1);
});

test("a find says what its parts mean; the done screen lists the board's prefixes and endings, every word, and tomorrow's root", async ({ page, isMobile }) => {
  test.setTimeout(150_000);
  if (isMobile) await page.setViewportSize(PHONE);
  await seed(page, { examInDays: null, veteran: true });
  await open(page, '#/practice/build/today');
  await expect.poll(() => page.evaluate(() => !!(/** @type {any} */ (window).__family))).toBe(true);
  const box = page.getByRole('region', { name: "Today's family" });
  await solveOne(page);
  // the lesson: each part with its meaning, the content's line, the change, the example; Next in view
  const lesson = page.locator('.pz-learn');
  await expect(lesson).toBeVisible();
  await expect(lesson.locator('.pz-part.is-pre .pz-part-en').first()).not.toBeEmpty();
  await expect(lesson.locator('.pz-part.is-root')).toHaveCount(1);
  await expect(lesson.locator('.pz-change')).toBeVisible();
  await expect(lesson.locator('.pz-learn-ex')).toBeVisible();
  const next = box.locator('.pz-check');
  await expect(next).toHaveText(/^Next/);
  await expect(next).toBeInViewport();
  await checkA11y(page, "Today's family lesson");
  expect(await labelInName(page)).toEqual([]);
  // no timer: the lesson waits
  await page.waitForTimeout(2500);
  await expect(lesson).toBeVisible();
  const n = await page.evaluate(() => /** @type {any} */ (window).__family.day.cards.length);
  for (let i = 1; i < n; i++) await solveOne(page);
  await expect(box.locator('.pz-check')).toHaveText(/^Finish/);
  await box.locator('.pz-check').click();
  await expect(page.getByRole('heading', { level: 2, name: "Today's board is done" })).toBeVisible();
  // the board's prefixes with their meanings (from the content: ab- down, off, away …)
  const pre = await page.evaluate(() => { const x = /** @type {any} */ (window).__family; return [...new Set(x.forms.flatMap((/** @type {any} */ f) => [...f.pre].reverse()))]; });
  const parts = page.getByRole('region', { name: 'The prefixes and endings' });
  for (const p of pre) await expect(parts.getByText(`${p}-`, { exact: true })).toBeVisible();
  await expect(parts.locator('.pz-dp-en').first()).not.toBeEmpty();
  // every word, each a link to its card in the family
  const words = page.getByRole('region', { name: 'The words' }).getByRole('link');
  await expect(words).toHaveCount(n);
  await expect(words.first()).toHaveAttribute('href', /#\/practice\/build\/family\/[^?]+\?w=/);
  // tomorrow's root, kept for tomorrow's board
  await expect(page.locator('.pz-next')).toContainText('Tomorrow:');
  const next2 = await page.evaluate(() => new Promise(resolve => {
    const r = indexedDB.open('fluentish');
    /** @type {any} */
    let out = null;
    r.onsuccess = () => { const q = r.result.transaction('kv').objectStore('kv').openCursor(); q.onsuccess = () => { const c = q.result; if (!c) { r.result.close(); resolve(out); return; } if (/** @type {any[]} */ (c.key)[1] === 'build.family') out = c.value.next || null; c.continue(); }; };
  }));
  expect(next2).toMatchObject({ root: expect.any(String) });
  await expect(page.locator('.pz-next')).toContainText(/** @type {any} */ (next2).root);
  await checkA11y(page, "Today's family done");
  expect(await labelInName(page)).toEqual([]);
  // a word opens its card in the family
  await words.first().click();
  await expect(page.locator('.fv-detail.is-open')).toHaveCount(1);
});

test("Today's family is in view on Today without scrolling", async ({ page, isMobile }) => {
  test.skip(!isMobile, 'a phone layout');
  await page.setViewportSize(PHONE);
  await seed(page, { examInDays: null, veteran: true });
  await open(page, '#/today');
  const link = page.locator('.hero-fam');
  await expect(link).toBeVisible();
  await expect(link).toContainText("Today's family");
  const b = await link.boundingBox();
  const dock = await page.locator('.dock').boundingBox();
  expect(b && b.y + b.height).toBeLessThanOrEqual(dock ? dock.y : PHONE.height);
  await link.click();
  await expect(page.getByRole('heading', { level: 1, name: "Today's family" })).toBeVisible();
  // the family view is one more tap: the root
  await page.locator('.pz-root').click();
  await expect(page.locator('.fv-ring')).toBeVisible();
});

test('the family view: a few tab stops to the first word, a skip link, the tree by level, names that start with the text shown', async ({ page, isMobile }) => {
  test.skip(!!isMobile, 'a hardware keyboard');
  await seed(page, { examInDays: null, veteran: true });
  await open(page, '#/practice/build/family/bringen');
  await expect(page.locator('.fv-node').first()).toBeVisible();
  // from the back link to the first word of the tree
  await page.locator('.fv .back-link').focus();
  let stops = 0;
  for (; stops < 40; stops++) {
    if (await page.evaluate(() => !!document.activeElement?.matches('.fv-rowbtn'))) break;
    await page.keyboard.press('Tab');
  }
  expect(stops).toBeLessThanOrEqual(10);
  // the skip link is the next stop after the back link
  await page.locator('.fv .back-link').focus();
  await page.keyboard.press('Tab');
  await expect(page.locator('.fv-skip')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('.fv-rowbtn').first()).toBeFocused();
  // the ring is one stop; the arrows go round it
  const first = page.locator('.fv-node[tabindex="0"]');
  await expect(first).toHaveCount(1);
  await first.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.fv-node[tabindex="0"]')).toBeFocused();
  // each group of the tree runs by level, A1 first
  const levels = await page.evaluate(() => [...document.querySelectorAll('.fv-sec')].map(sec => [...sec.querySelectorAll(':scope > .fv-list > .fv-row:not(.is-kid) .fv-r .tnum')].map(x => x.textContent || '')));
  const rank = (/** @type {string} */ l) => { const i = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'].indexOf(l); return i < 0 ? 9 : i; };
  for (const sec of levels) expect(sec.map(rank)).toEqual([...sec.map(rank)].sort((a, b) => a - b));
  await checkA11y(page, 'Word family bringen');
  expect(await labelInName(page)).toEqual([]);
  await open(page, '#/practice/build/today');
  await expect.poll(() => page.evaluate(() => !!(/** @type {any} */ (window).__family))).toBe(true);
  expect(await labelInName(page)).toEqual([]);
  // the word page's "Family: stellen" link
  await open(page, '#/lookup/words/die_Ausstellung');
  await expect(page.getByRole('link', { name: /^Family: stellen/ })).toBeVisible();
  expect(await labelInName(page, '.fam-link')).toEqual([]);   // the word page's other names are Look up's
});

// Round 8: a tile pressed shrinks in place. The ring's tiles keep their centring translate under the press scale (a
// bare .pressable:active dropped it, so the tile jumped by half its size), the rows' tiles get the scale at all.
// src/ui/tile.js: the face takes the press (0.94), the button (the hit box) does not move or shrink.
for (const [level, layout] of /** @type {const} */ ([['A2', 'ring'], ['B1', 'rows']])) {
  test(`a hive tile pressed shrinks in place (${layout})`, async ({ page, isMobile }) => {
    test.skip(!!isMobile, 'a mouse press holds :active');
    await seed(page, { examInDays: null, veteran: true, level, motion: 'full' });
    await open(page, '#/practice/build/today');
    await expect.poll(() => page.evaluate(() => !!(/** @type {any} */ (window).__family))).toBe(true);
    await expect(page.locator('.pz-hive')).toHaveClass(layout === 'rows' ? /is-rows/ : /^(?!.*is-rows)/);
    await settle(page);
    for (const sel of ['.pz-hive .ui-tile', '.pz-ends .ui-tile']) {
      const tile = page.locator(sel).first(), face = tile.locator('.ui-tile-face');
      const box = () => /** @type {Promise<{x: number, y: number, width: number, height: number}>} */ (face.boundingBox());
      const rest = await box(), hit = await tile.boundingBox();
      await page.mouse.move(rest.x + rest.width / 2, rest.y + rest.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(150);
      const held = await box();
      expect(await tile.boundingBox(), `${sel}: the hit box stays`).toEqual(hit);
      await page.mouse.move(0, 0);
      await page.mouse.up();
      expect(Math.abs(held.x + held.width / 2 - (rest.x + rest.width / 2)), `${sel}: centre stays`).toBeLessThan(1);
      expect(Math.abs(held.y + held.height / 2 - (rest.y + rest.height / 2)), `${sel}: centre stays`).toBeLessThan(1);
      expect(held.width / rest.width, `${sel}: pressed`).toBeCloseTo(0.94, 2);
      // released: back to its size on the spring, no jump
      await page.waitForTimeout(400);
      const back = await box();
      expect(Math.abs(back.width - rest.width), `${sel}: released`).toBeLessThan(0.5);
    }
  });
}

// Round 8: the status line keeps its two lines when quiet, so a build that names another clue does not move the tiles
for (const level of ['A2', 'B2']) {
  test(`a message does not move the ${level} board`, async ({ page, isMobile }) => {
    test.skip(!isMobile, 'a phone layout');
    await page.setViewportSize(PHONE);
    await seed(page, { examInDays: null, veteran: true, level });
    await open(page, '#/practice/build/today');
    await expect.poll(() => page.evaluate(() => !!(/** @type {any} */ (window).__family))).toBe(true);
    await settle(page);
    const tops = () => page.evaluate(() => [...document.querySelectorAll('.pz-hive .hx, .pz-ends .hx')].map(e => Math.round(e.getBoundingClientRect().top)));
    const before = await tops();
    const msg = page.locator('.pz-msg');
    await expect(msg).toBeEmpty();
    // build the word of the next meaning
    const s = await page.evaluate(() => { const x = /** @type {any} */ (window).__family; const f = x.forms[(x.idx + 1) % x.forms.length]; return { pre: [...f.pre].reverse(), suf: [...f.suf], art: f.art || null }; });
    const box = page.getByRole('region', { name: "Today's family" });
    for (const p of s.pre) await box.getByRole('button', { name: `Prefix ${p}-`, exact: true }).click();
    for (const x of s.suf) await box.locator(`button[data-suf="${x}"]`).click();
    if (s.art) await box.getByRole('button', { name: `Article ${s.art}`, exact: true }).click();
    await box.getByRole('button', { name: /^Check/ }).click();
    await expect(msg).toContainText('is on the board, for another meaning');
    expect(await tops()).toEqual(before);
    const check = await page.locator('.pz-check').boundingBox();
    expect(check && check.y + check.height).toBeLessThanOrEqual(PHONE.height);
  });
}
