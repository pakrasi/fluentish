import { test, expect, seed, open, settle, checkA11y, storedCards, REPO, FAKE_TOKEN } from './fixtures.mjs';
import { answerCard } from './helpers.mjs';

/** A short round: answer `n` cards, then End (the answers are saved as they are given). @param {import('@playwright/test').Page} page */
async function studyALittle(page, n = 3) {
  await open(page, '#/practice/round');
  const known = new Map();
  for (let i = 0; i < n; i++) if (!(await answerCard(page, known))) break;
  if (await page.locator('.pr-round').count()) await page.getByRole('button', { name: /^End/ }).click();
  const cards = await storedCards(page, 'b1');
  expect(Object.keys(cards).length).toBeGreaterThan(0);
  return cards;
}

/** Requests in flight per page, so a reload can wait for none (page.waitForLoadState('networkidle') does not wait
   again once the page has loaded). @type {WeakMap<import('@playwright/test').Page, Set<any>>} */
const inFlight = new WeakMap();
/** @param {import('@playwright/test').Page} page */
function track(page) {
  const set = new Set();
  inFlight.set(page, set);
  page.on('request', r => set.add(r));
  page.on('requestfinished', r => set.delete(r));
  page.on('requestfailed', r => set.delete(r));
}
/** Wait until no request has been in flight for 500 ms (at most 15 s). @param {import('@playwright/test').Page} page */
async function quiet(page) {
  const set = inFlight.get(page) || new Set();
  const t0 = Date.now();
  let since = Date.now();
  while (Date.now() - t0 < 15000) {
    if (set.size) since = Date.now();
    else if (Date.now() - since >= 500) return;
    await page.waitForTimeout(100);
  }
}

/** The progress log's months in IndexedDB (kv progress.<course>.<YYYY-MM>, data/progress.js). @param {import('@playwright/test').Page} page */
async function progressLog(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const r = indexedDB.open('fluentish');
    r.onerror = () => reject(r.error);
    r.onsuccess = () => {
      const db = r.result, out = /** @type {Record<string, any>} */ ({});
      const q = db.transaction('kv').objectStore('kv').openCursor();
      q.onsuccess = () => {
        const c = q.result;
        if (!c) { db.close(); resolve(out); return; }
        const k = /** @type {any[]} */ (c.key);
        if (/^progress\.[a-z0-9-]+\.\d{4}-\d\d$/.test(String(k[1]))) out[k[1]] = c.value;
        c.continue();
      };
      q.onerror = () => reject(q.error);
    };
  }));
}
/** The days the log holds. @param {Record<string, any>} log */
const logDays = log => Object.values(log).flatMap(m => Object.keys(m || {})).sort();

/** Profile › Data › Delete all, confirmed; the app restarts on onboarding. @param {import('@playwright/test').Page} page */
async function deleteAll(page) {
  await open(page, '#/profile/data');
  await page.getByRole('button', { name: 'Delete all' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: /^Delete/ }).click();
  await expect(page).toHaveURL(/#\/welcome$/);
  await expect(page.locator('html.booted')).toHaveCount(1);
  await expect(page.locator('#view h1').first()).toBeVisible();
  expect(await storedCards(page, 'b1')).toEqual({});
}

test('progress backup to the (mock) results repository, Delete all, Restore from backup', async ({ page, gh }) => {
  track(page);
  await seed(page, { token: true });
  const before = await studyALittle(page);
  // the next open records the study day in the progress log (data/progress.js), which goes in the snapshot
  await open(page, '#/today');
  await page.waitForLoadState('networkidle');
  await settle(page);
  // no request in flight (the atlas the progress log reads may still be loading): WebKit reports a read the reload
  // cuts off as a page error
  await quiet(page);
  await page.reload();
  await expect(page.locator('html.booted')).toHaveCount(1);
  await expect.poll(async () => logDays(await progressLog(page)).length).toBe(1);
  const log = await progressLog(page);
  const [day] = logDays(log);
  const rec0 = Object.values(log)[0][day];
  expect(rec0.src).toBe('live');
  expect(rec0.day.new + rec0.day.reviews).toBeGreaterThan(0);
  expect(rec0.of.w.length).toBeGreaterThan(0);
  await open(page, '#/profile/diagnostics');
  await page.getByText('Show diagnostics').click();
  await expect(page.locator('.diag')).toContainText('Progress log');
  await expect(page.locator('.diag')).toContainText('1 day recorded (0 estimated)');

  await open(page, '#/profile/data');
  await checkA11y(page, 'Profile › Data');
  await page.getByRole('button', { name: 'Back up now' }).click();
  await expect(page.locator('.toast').filter({ hasText: 'Backed up.' })).toBeVisible();
  const paths = [...gh.files.keys()];
  expect(paths.some(p => /^data\/events\/[^/]+\/\d{4}-\d\d-\d\d\.ndjson$/.test(p)), paths.join(', ')).toBe(true);
  expect(paths.some(p => /^data\/snapshots\/[^/]+\/\d{4}-\d\d-\d\d\.json(\.gz)?$/.test(p)), paths.join(', ')).toBe(true);
  // only the private results repository was written, and only under data/
  expect(gh.calls.filter(x => x.method === 'PUT').every(x => x.path.startsWith('data/'))).toBe(true);

  await deleteAll(page);

  // the same learner links this device again: a fresh profile, then the device link (b1-token.py), which connects the
  // owner's repository once GitHub accepts the token (data/connection.js applyOwnerLink)
  await seed(page);
  await open(page, `#/profile?token=${FAKE_TOKEN}`);
  await expect(page.locator('.toast').filter({ hasText: 'Device linked.' })).toBeVisible();
  await page.waitForLoadState('networkidle');
  await open(page, '#/profile/data');
  await page.getByRole('button', { name: 'Restore from backup' }).click();
  const panel = page.locator('.restore-panel');
  await expect(panel).toContainText(REPO);
  await panel.getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(page.locator('.toast').filter({ hasText: 'Restored.' })).toBeVisible();
  const after = await storedCards(page, 'b1');
  expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
  for (const [id, rec] of Object.entries(before)) expect(after[id].reps, id).toBe(rec.reps);
  // the progress log came back with the day
  const back = await progressLog(page);
  expect(logDays(back)).toEqual([day]);
  expect(Object.values(back)[0][day].day).toEqual(rec0.day);
  expect(Object.values(back)[0][day].seen).toEqual(rec0.seen);
  // and the app shows it after a reload (once the restore's own reads are done, as above)
  await quiet(page);
  await page.reload();
  expect(Object.keys(await storedCards(page, 'b1')).sort()).toEqual(Object.keys(before).sort());

  // a restore cut off mid-way: the journal still says 'applying' at the next start. Boot loads data/restore.js for it
  // (data/restore-journal.js) and puts the before-image back, here the empty profile of before the restore.
  await quiet(page);
  expect(await journalStage(page, 'applying')).toBe('done');
  await page.reload();
  await expect(page.locator('html.booted')).toHaveCount(1);
  expect(await storedCards(page, 'b1')).toEqual({});
  expect(await journalStage(page)).toBe('rolledBack');
});

/** The restore journal's stage (device kv backup.journal), after setting it when `to` is given; returns the stage
   found. @param {import('@playwright/test').Page} page @param {string} [to] */
async function journalStage(page, to) {
  return page.evaluate(to => new Promise((resolve, reject) => {
    const r = indexedDB.open('fluentish');
    r.onerror = () => reject(r.error);
    r.onsuccess = () => {
      const db = r.result, t = db.transaction('kv', 'readwrite'), kv = t.objectStore('kv');
      const q = kv.get(['device', 'backup.journal']);
      let stage = null;
      q.onsuccess = () => { stage = q.result?.stage ?? null; if (to && q.result) kv.put({ ...q.result, stage: to }, ['device', 'backup.journal']); };
      t.oncomplete = () => { db.close(); resolve(stage); };
      t.onerror = () => reject(t.error);
    };
  }), to);
}

test('export file, Delete all, import the file', async ({ page }) => {
  // the file itself is what this test is about: no share sheet (a phone's Export opens one, services/share.js; the
  // share spec checks that), so Export downloads in both browsers
  await page.addInitScript(() => { try { delete /** @type {any} */ (Navigator.prototype).share; delete /** @type {any} */ (Navigator.prototype).canShare; } catch { /* not there */ } });
  await seed(page);
  const before = await studyALittle(page, 2);
  await open(page, '#/profile/data');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Export/ }).click()]);
  const file = await download.path();
  await deleteAll(page);
  await seed(page);
  await open(page, '#/profile/data');
  await page.locator('input[type=file]').setInputFiles(file);
  await expect(page.locator('#view')).toContainText(/Imported|imported/);
  expect(Object.keys(await storedCards(page, 'b1')).sort()).toEqual(Object.keys(before).sort());
});
