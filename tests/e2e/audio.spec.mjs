// Platform services in the browser (Arch #8): exam audio through services/audio.js track() keeps the Hören play limits,
// a situation line plays through clip(), and Export hands a phone's share sheet the file (services/share.js).
import { test, expect, seed, open } from './fixtures.mjs';

/** Every play() the page makes, and the ones that really started (a media element is not in the DOM, so wrap play). */
const recordPlays = () => {
  const w = /** @type {any} */ (window);
  w.__plays = []; w.__started = [];
  const orig = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    const src = this.currentSrc || this.src;
    w.__plays.push(src);
    const p = orig.call(this);
    p.then(() => w.__started.push(src), () => {});
    return p;
  };
};

/** Values of a kv collection by name (any scope), straight from IndexedDB. @param {import('@playwright/test').Page} page @param {string} name */
async function storedKv(page, name) {
  return page.evaluate(name => new Promise((resolve, reject) => {
    const r = indexedDB.open('fluentish');
    r.onerror = () => reject(r.error);
    r.onsuccess = () => {
      const db = r.result, out = /** @type {any[]} */ ([]);
      const q = db.transaction('kv').objectStore('kv').openCursor();
      q.onsuccess = () => {
        const c = q.result;
        if (!c) { db.close(); resolve(out); return; }
        if (/** @type {any[]} */ (c.key)[1] === name) out.push(c.value);
        c.continue();
      };
      q.onerror = () => reject(q.error);
    };
  }), name);
}

test('Hören: a play counts once it started, the second hearing starts by itself, the limit holds after a reload', async ({ page }) => {
  await page.addInitScript(recordPlays);
  await seed(page);
  await open(page, '#/exam/1/hoeren');
  await page.getByRole('button', { name: /Hören starten/ }).click();
  await expect(page.getByRole('timer')).toBeVisible();

  // Teil 1, text 1: two hearings, the second after 5 seconds by itself
  const p1 = page.locator('.ex-player').first();
  const btn = p1.locator('.ex-play');
  await expect(p1.locator('.ex-plays')).toHaveText('Noch 2 Wiedergaben');
  await btn.click();
  await expect(p1.locator('.ex-play-note')).toContainText('Zweites Hören in');
  await expect(p1.locator('.ex-plays')).toHaveText('Keine Wiedergabe mehr', { timeout: 15_000 });
  await expect(btn).toBeDisabled();
  const started = (await page.evaluate(() => /** @type {any} */ (window).__started)).filter((/** @type {string} */ s) => s.endsWith('/h1-1.mp3'));
  expect(started).toHaveLength(2);
  const drafts = (await storedKv(page, 'exams.drafts'))[0] || {};
  const plays = Object.entries(drafts).find(([k]) => k.startsWith('plays:'))?.[1] || {};
  expect(plays['h1-1']?.used).toBe(2);

  // Teil 2: one hearing, after the reading time (skipped here)
  await page.getByRole('tab', { name: /Teil 2/ }).click();
  const p2 = page.locator('.ex-player:visible').first();
  await expect(p2.locator('.ex-plays')).toHaveText('Noch 1 Wiedergabe');
  await p2.locator('.ex-play').click();
  await expect(p2.locator('.ex-play-note')).toContainText('Lesezeit');
  await p2.getByRole('button', { name: 'Lesezeit überspringen' }).click();
  await expect(p2.locator('.ex-plays')).toHaveText('Keine Wiedergabe mehr', { timeout: 15_000 });

  // a reload does not give a play back
  await page.reload();
  await expect(page.locator('html.booted')).toHaveCount(1);
  await expect(page.getByRole('timer')).toBeVisible();
  await expect(page.locator('.ex-player').first().locator('.ex-plays')).toHaveText('Keine Wiedergabe mehr');
  await expect(page.locator('.ex-player').first().locator('.ex-play')).toBeDisabled();
  await page.getByRole('tab', { name: /Teil 2/ }).click();
  await expect(page.locator('.ex-player:visible').first().locator('.ex-play')).toBeDisabled();
});

test('a situation line plays as a recording, on its own and again on a tap', async ({ page }) => {
  await page.addInitScript(recordPlays);
  await seed(page, { veteran: true, examInDays: null, motion: 'full' });
  await open(page, '#/practice/situations/round?pick=mixed');
  const card = page.locator('.sim-card');
  await expect(card).toBeVisible();
  const speak = () => page.evaluate(() => /** @type {any} */ (window).__started.filter((/** @type {string} */ s) => /\/speak\/[^/]+\.mp3$/.test(s)).length);
  await expect.poll(speak).toBeGreaterThan(0);   // heard first: the line plays when the card opens
  const before = await speak();
  await card.getByRole('button', { name: 'Play the line again' }).click();
  await expect.poll(speak).toBeGreaterThan(before);
  await expect(card.locator('.sim-status')).toHaveText('');   // not "No audio" and not "Tap to play"
  await expect(card.locator('.sim-them .sim-line')).toBeHidden();   // a played line keeps the words folded away
});

test('Export on a touch device hands the file to the share sheet', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'the share sheet is for touch devices; a desktop downloads (the backup spec)');
  await page.addInitScript(() => {
    const w = /** @type {any} */ (window);
    w.__shared = [];
    Object.defineProperty(Navigator.prototype, 'canShare', { configurable: true, value: () => true });
    Object.defineProperty(Navigator.prototype, 'share', { configurable: true, value: async (/** @type {any} */ o) => { w.__shared.push(o.files.map((/** @type {File} */ f) => [f.name, f.type, f.size])); } });
  });
  await seed(page);
  await open(page, '#/profile/data');
  await page.getByRole('button', { name: /Export/ }).click();
  await expect.poll(() => page.evaluate(() => /** @type {any} */ (window).__shared.length)).toBe(1);
  const [[name, type, size]] = (await page.evaluate(() => /** @type {any} */ (window).__shared))[0];
  expect(name).toMatch(/^fluentish-\d{4}-\d\d-\d\d\.json$/);
  expect(type).toBe('application/json');
  expect(size).toBeGreaterThan(10);
});
