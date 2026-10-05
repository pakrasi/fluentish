// Courses (round 3, wave C, Arch #11): Profile lists the German course with its level, exam, date and minutes, the
// other languages are listed as later under "Add a course", and onboarding makes the profile's first course.
import { test, expect, seed, open, checkA11y } from './fixtures.mjs';

/** The stored settings record, read straight from IndexedDB (kv store, key [profileId, 'settings']). @param {import('@playwright/test').Page} page */
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

test('Profile › Courses: the German course with its goal and minutes; French can be added, other languages are listed as later', async ({ page }) => {
  await seed(page, { examInDays: 4, minutes: 60 });
  await open(page, '#/profile/courses');
  const sec = page.locator('#profile-courses');
  await expect(sec.getByRole('heading', { name: 'Courses' })).toBeVisible();
  const de = sec.locator('.course-row[data-course="de"]');
  await expect(de.locator('.row-title')).toHaveText('German');
  await expect(de.locator('.row-detail')).toContainText('B1 · Goethe B1 · exam ');
  await expect(de.locator('.row-detail')).toContainText('60 min');
  await expect(de.locator('.row-trail')).toHaveText('Active');
  await sec.getByText('Add a course').click();
  // French ships (C3b): it can be added; a language without content is listed as later
  await expect(sec.getByRole('button', { name: 'Add a French course' })).toHaveCount(1);
  const es = sec.locator('.course-add li', { hasText: 'Spanish' });
  await expect(es.locator('.row-trail')).toHaveText('Later');
  await expect(sec.getByRole('button', { name: 'Add a Spanish course' })).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Language' })).toHaveCount(0);   // the language is the course now
  await checkA11y(page, 'Profile courses');
  const s = await storedSettings(page);
  expect(s.activeCourse).toBe('de');
  expect(s.courses.map((/** @type {any} */ c) => [c.id, c.lang, c.level, c.goal.exam])).toEqual([['de', 'de', 'B1', 'goethe-b1']]);
  expect(s.courses[0].goal.date).toBe(s.exam.date);
});

test('the exam date set in Goal is the course\'s, and the plan follows it', async ({ page }) => {
  await seed(page, { examInDays: 30 });
  await open(page, '#/profile/goal');
  const input = page.locator('input[name="exam-date"]');
  const moved = await page.evaluate(() => { const d = new Date(); d.setDate(d.getDate() + 20); return d.toISOString().slice(0, 10); });
  await input.fill(moved);
  await input.dispatchEvent('change');
  await expect(page.locator('#profile-goal .derived')).toContainText('days left');
  await expect.poll(async () => (await storedSettings(page))?.courses?.[0]?.goal?.date).toBe(moved);
  const s = await storedSettings(page);
  expect(s.exam.date).toBe(moved);
  expect(s.rev['exam.date']).toBe(s.rev['courses.de.goal.date']);
});

test('onboarding makes the first course', async ({ page }) => {
  await open(page, '#/welcome');
  await page.getByRole('radio', { name: /German/ }).check();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('radio', { name: /^B1/ }).check();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('radio', { name: /Goethe/ }).check();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page).toHaveURL(/#\/today$/);
  await expect.poll(async () => (await storedSettings(page))?.activeCourse).toBe('de');
  const s = await storedSettings(page);
  expect(s.courses).toEqual([{ id: 'de', lang: 'de', level: 'B1', goal: { exam: 'goethe-b1', date: null }, decks: ['b1', 'speak', 'script', 'clusters', 'build'] }]);
  expect([s.language, s.level, s.exam.type]).toEqual(['german', 'B1', 'goethe-b1']);
});
