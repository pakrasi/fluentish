// The exam window (round 4, L1a): a date months ahead plans Today like no date (no countdown, no mock rows, no
// prompt to set a date), the mocks stay on the Exam tab, and exam weeks start 14 days before the date.
import { test, expect, seed, open, checkA11y } from './fixtures.mjs';

test('an exam 60 days ahead: no exam-week Today and no Set-date prompt; the mocks are on the Exam tab', async ({ page }) => {
  await seed(page, { examInDays: 60, veteran: true });
  await open(page, '#/today');
  await expect(page.getByRole('region', { name: 'Review queue' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Exam countdown' })).toHaveCount(0);
  await expect(page.getByText('Set an exam date')).toHaveCount(0);
  await expect(page.getByText(/^Timed, /)).toHaveCount(0);   // no mock row
  await checkA11y(page, 'Today, exam far ahead');
  await page.locator('nav.tabs a[data-tab="exam"]:visible').first().click();
  await expect(page).toHaveURL(/#\/exam$/);
  await expect(page.getByRole('link', { name: /Test 1\b/ }).or(page.getByRole('button', { name: /Test 1\b/ })).first()).toBeVisible();
  await open(page, '#/profile/goal');
  await expect(page.locator('#profile-goal .derived')).toHaveText(/^60 days left\. Exam weeks start /);
});

test('an exam 10 days ahead: the exam-week Today, as before', async ({ page }) => {
  await seed(page, { examInDays: 10, veteran: true });
  await open(page, '#/today');
  await expect(page.getByRole('region', { name: 'Exam countdown' })).toBeVisible();
  await expect(page.getByText(/^Timed, /).first()).toBeVisible();   // the mock row
  await expect(page.getByText('Set an exam date')).toHaveCount(0);
});

test('a date-only exam goal (Goethe B2, no mock tests yet): countdown in its window, no Exam tab', async ({ page }) => {
  await seed(page, { examInDays: 10, examType: 'goethe-b2', veteran: true });
  await open(page, '#/today');
  await expect(page.getByRole('region', { name: 'Exam countdown' })).toBeVisible();
  await expect(page.locator('nav.tabs a[data-tab="exam"]')).toHaveCount(0);
  await expect(page.getByText(/^Timed, /)).toHaveCount(0);
  await expect(page.locator('nav.tabs a[data-tab="practice"]').first()).toHaveCount(1);
});
