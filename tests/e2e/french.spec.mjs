// The French course (round 3, C3b): added from Profile › Courses next to his German course, a round to Done with
// French items from the course's own deck (fr:core) graded through the French pack, Look up's French phrases, no map,
// then back to German with every German number as it was. And onboarding straight into French.
import { test, expect, seed, open, checkA11y, storedCards } from './fixtures.mjs';
import { answerCard } from './helpers.mjs';

/** The stored settings record. @param {import('@playwright/test').Page} page */
async function storedSettings(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const r = indexedDB.open('fluentish');
    r.onerror = () => reject(r.error);
    r.onsuccess = () => {
      const db = r.result;
      /** @type {any} */ let out = null;
      const q = db.transaction('kv').objectStore('kv').openCursor();
      q.onsuccess = () => {
        const c = q.result;
        if (!c) { db.close(); resolve(out); return; }
        if (/** @type {any[]} */ (c.key)[1] === 'settings') out = c.value;
        c.continue();
      };
      q.onerror = () => reject(q.error);
    };
  }));
}

/**
 * What Today shows of his German day: the countdown and every plan row's title and detail (the day's minutes are
 * shared by his courses, so the minutes studied today are not compared; the day is long enough that no row is cut).
 * @param {import('@playwright/test').Page} page
 */
async function todayNumbers(page) {
  await open(page, '#/today');
  await expect(page.locator('.today-b .row-title').first()).toBeVisible();
  await page.waitForLoadState('networkidle');
  return { days: await page.locator('.today-hero .numeral').first().textContent(), rows: await page.locator('.today-b .row-title, .today-b .row-detail').allInnerTexts() };
}

/**
 * answerCard, after a Next left over from the card before: a right answer that is not word for word the first one
 * (another accepted wording, a dropped accent) waits for Next, and a tap during the check mark's short hold only ends
 * the hold. @param {import('@playwright/test').Page} page @param {Map<string, string>} known
 */
async function answerFr(page, known) {
  const primary = page.locator('.pr-primary');
  if (await primary.count() && /^Next/.test(await primary.innerText())) await primary.click();
  return answerCard(page, known);
}

/** A synthetic German review card due today. @param {string} today */
const dueCard = today => ({ S: 3, D: 5, due: today, last: today.replace(/\d\d$/, '01'), reps: 2, lapses: 0, hist: [[today.replace(/\d\d$/, '01'), 3, 0, 0, '']], first: today.replace(/\d\d$/, '01') });

test('a French course next to German: add it, a round to Done in French, back to German unchanged', async ({ page }) => {
  test.setTimeout(180_000);
  const today = new Date().toISOString().slice(0, 10);
  await seed(page, { examInDays: 30, minutes: 240, veteran: true, cards: { b1: { 'K:ENG_CHUNK_0023': dueCard(today), 'G:nebensatz-1': dueCard(today) } } });
  const before = await todayNumbers(page);
  const b1Before = await storedCards(page, 'b1');

  // Profile › Courses › Add a course: French is ready
  await open(page, '#/profile/courses');
  const sec = page.locator('#profile-courses');
  await sec.getByText('Add a course').click();
  await sec.getByRole('button', { name: 'Add a French course' }).click();
  await expect.poll(async () => (await storedSettings(page))?.activeCourse).toBe('fr');
  const s = await storedSettings(page);
  expect(s.courses.map((/** @type {any} */ c) => [c.id, c.lang])).toEqual([['de', 'de'], ['fr', 'fr']]);
  expect(s.language).toBe('french');
  expect(s.courses.find((/** @type {any} */ c) => c.id === 'de').goal.exam).toBe('goethe-b1');

  // Today: the French review round, no German rows, no prompt for an exam date
  await open(page, '#/today');
  await expect(page.locator('#view')).toContainText(/round/i);
  await expect(page.locator('#view')).not.toContainText(/Schreiben|Sprechen|Goethe|exam date/i);
  await checkA11y(page, 'Today, French');

  // Practice: the hub shows the course's phrases and words
  await open(page, '#/practice');
  await expect(page.locator('#view')).toContainText('Phrases and words');
  await expect(page.locator('#view')).not.toContainText(/Schreiben|Sprechen|Word building/);
  await checkA11y(page, 'Practice, French');

  // the round: French items, typed, to Done
  await open(page, '#/practice/round');
  await expect(page.locator('.pr-round')).toBeVisible();
  await expect(page.locator('#pr-input')).toHaveAttribute('lang', 'fr');
  await expect(page.locator('#pr-input')).toHaveAttribute('placeholder', 'Type the French');
  await checkA11y(page, 'French round');
  let n = 0;
  const known = new Map();
  while (await answerFr(page, known)) { n++; expect(n, 'the round ends').toBeLessThan(40); }
  await expect(page.locator('.pr-done h1, .pr-done .figure').first()).toBeVisible();
  const fr = await storedCards(page, 'fr:core');
  expect(Object.keys(fr).length).toBeGreaterThan(0);
  expect(Object.keys(fr).every(id => /^(K:ENG_CHUNK_\d{4}|W:.+)$/.test(id))).toBe(true);
  expect(Object.values(fr).every((/** @type {any} */ c) => c.reps >= 1)).toBe(true);
  // the answers' text was French: the model answers shown came from the French course
  expect([...known.values()].some(a => /[éèêàçù]|\b(je|tu|le|la|les|un|une|de)\b/i.test(a))).toBe(true);
  // German's deck was not touched
  expect(await storedCards(page, 'b1')).toEqual(b1Before);

  // Look up: French phrases; the map is German's
  await open(page, '#/lookup/phrases');
  await expect(page.locator('#view [lang="fr"]').first()).toBeVisible();
  await expect(page.locator('.lk-map')).toHaveCount(0);
  await open(page, '#/lookup/map');
  await expect(page.locator('#view')).toContainText('French has no map yet');
  // Profile: a goal without an exam (no stray text where the date and modules would be)
  await open(page, '#/profile/goal');
  await expect(page.locator('#profile-goal')).not.toContainText('null');

  // back to German: every number as it was
  await open(page, '#/profile/courses');
  await page.locator('#profile-courses').getByRole('button', { name: 'Study German' }).click();
  await expect.poll(async () => (await storedSettings(page))?.activeCourse).toBe('de');
  expect(await todayNumbers(page)).toEqual(before);
  expect(await storedCards(page, 'b1')).toEqual(b1Before);
  expect(Object.keys(await storedCards(page, 'fr:core')).length).toBe(Object.keys(fr).length);
});

test('onboarding into French: a course with no exam and no date', async ({ page }) => {
  await open(page, '#/welcome');
  await page.getByRole('radio', { name: /French/ }).check();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('radio', { name: /^A2/ }).check();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByRole('radio', { name: /Goethe/ })).toHaveCount(0);
  await page.getByRole('radio', { name: /No exam/ }).check();
  await page.getByRole('button', { name: 'Next' }).click();
  while (await page.getByRole('button', { name: 'Next' }).isVisible()) await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page).toHaveURL(/#\/today$/);
  await expect.poll(async () => (await storedSettings(page))?.activeCourse).toBe('fr');
  const s = await storedSettings(page);
  expect(s.courses).toEqual([{ id: 'fr', lang: 'fr', level: 'A2', goal: { exam: null, date: null }, decks: [] }]);
  await expect(page.locator('#view')).toContainText(/round/i);
  await expect(page.locator('#view')).not.toContainText(/exam date/i);
});
