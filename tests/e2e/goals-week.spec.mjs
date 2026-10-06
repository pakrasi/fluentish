// Goals and week, and the everyday Today (round 4, L1c): a week set on Profile › Goals and week plans Today's kind of
// day; an Off day and Study anyway; back after a break; a B2 level goal and its gate; moving and removing an exam;
// an exam far ahead is a maintenance Today. Every profile here is synthetic.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, seed, open, checkA11y, storedCards } from './fixtures.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
/** Content ids whose cards count as b1 reviews (phrases and grammar). */
const IDS = readFileSync(path.join(ROOT, 'tests/fixtures/shipped-ids.txt'), 'utf8').split('\n').filter(l => /^(K|G):/.test(l));
const day = (/** @type {number} */ n) => { const d = new Date(); d.setHours(12); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
/** n cards in deck b1, due yesterday. @param {number} n */
function dueCards(n) {
  const back = day(-20), due = day(-1);
  return Object.fromEntries(IDS.slice(0, n).map(id => [id, { S: 3, D: 5, due, last: back, reps: 2, lapses: 0, hist: [[back, 3, 0, 0, '']], first: back }]));
}
const every = (/** @type {number} */ min, /** @type {string} */ kind) => ({ min: Array(7).fill(min), kind: Array(7).fill(kind) });

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

test('a week set on Goals and week: Today names the kind of day and draws the week; no days in a row', async ({ page }) => {
  await seed(page, { examInDays: null, veteran: true, cards: { b1: dueCards(12) } });
  await open(page, '#/profile/goal');
  await expect(page.getByRole('heading', { level: 1, name: 'Goals and week' })).toBeVisible();
  await page.getByRole('button', { name: 'Use a week plan' }).click();
  await expect(page.locator('.week-sum')).toHaveText(/^4 h 05 a week\./);
  await expect.poll(async () => (await storedSettings(page))?.courses?.[0]?.week?.min).toEqual([45, 45, 20, 45, 30, 60, 0]);
  // the week editor: the strip, then seven rows on a phone (each opens a sheet) or the strip's columns as tabs
  const phone = await page.locator('button[name="week:day:0"]').isVisible();
  await expect(page.locator('.week-ed .wk-strip .runway-day')).toHaveCount(7);
  if (phone) await expect(page.locator('button[name="week:day:3"]')).toContainText('45 min · Write (later)');
  /** Open day i: its sheet on a phone, its tab from 720 px. @param {number} i */
  const openDay = async i => { if (phone) await page.locator(`button[name="week:day:${i}"]`).click(); else await page.locator(`#wk-tab-${i}`).click(); };
  // kinds whose feature has not shipped say so
  await openDay(3);
  await expect(page.getByText('Write days are coming later. Until then this is a normal day.')).toBeVisible();
  await expect(page.locator('button[name="week:3:kind:write"]')).toHaveClass(/is-later/);
  if (phone) await page.keyboard.press('Escape');
  // Read has shipped (L2b: 'read' in LIVE_SLOTS): its day is a read day, not "coming later"
  await openDay(1);
  await expect(page.getByText('Read days are coming later. Until then this is a normal day.')).toHaveCount(0);
  await expect(page.locator('button[name="week:1:kind:read"]')).not.toHaveClass(/is-later/);
  await checkA11y(page, phone ? 'Goals and week, day sheet' : 'Goals and week');
  if (phone) { await page.keyboard.press('Escape'); await expect(page.locator('dialog.rs-sheet')).toHaveCount(0); await checkA11y(page, 'Goals and week'); }
  // every day light: on a phone in one sheet, stepping from day to day
  if (phone) await openDay(0);
  for (let i = 0; i < 7; i++) {
    if (!phone) await openDay(i);
    await page.locator(`button[name="week:${i}:min:20"]`).click();
    await page.locator(`button[name="week:${i}:kind:light"]`).click();
    if (phone && i < 6) await page.getByRole('button', { name: `Go to ${['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][i + 1]}` }).click();
  }
  if (phone) await page.keyboard.press('Escape');
  // the rows (or the columns) are one tab stop; the arrow keys move between days
  if (phone) {
    await page.locator('button[name="week:day:0"]').focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('button[name="week:day:1"]')).toBeFocused();
    await expect(page.locator('.week-rows [tabindex="0"]')).toHaveCount(1);
  } else {
    await page.locator('#wk-tab-0').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#wk-tab-1')).toBeFocused();
    await expect(page.locator('#wk-tab-1')).toHaveAttribute('aria-selected', 'true');
  }
  await expect.poll(async () => (await storedSettings(page))?.courses?.[0]?.week).toEqual(every(20, 'light'));
  await open(page, '#/today');
  const hero = page.getByRole('region', { name: 'Review queue' });
  await expect(hero.getByText('Light day: reviews only')).toBeVisible();
  await expect(hero.getByRole('listitem')).toHaveCount(7);
  await expect(hero.getByText(/of 2 h 20 this week/)).toBeVisible();
  await expect(page.getByText(/in a row/)).toHaveCount(0);
  await expect(page.getByText('0 of 20 min today')).toBeVisible();
  await checkA11y(page, 'Today, light day');
});

test('an Off day: no plan, the reviews wait; Study anyway makes it a normal day', async ({ page }) => {
  await seed(page, { examInDays: null, veteran: true, week: every(0, 'off'), cards: { b1: dueCards(12) } });
  await open(page, '#/today');
  // the hero states the day, never the debt: "Day off" in the numeral's place, what waits under it
  const hero = page.getByRole('region', { name: 'Review queue' });
  await expect(hero.getByText('Day off', { exact: true })).toBeVisible();
  await expect(hero.getByText('12 reviews wait for tomorrow.')).toBeVisible();
  await expect(hero.locator('.numeral')).toHaveCount(0);
  await expect(page.getByText(/Day off\. 12 reviews are due; they will be in tomorrow's plan\./)).toBeVisible();
  await expect(page.locator('.dock')).toHaveCount(0);
  await expect(page.locator('.plan-row')).toHaveCount(0);
  await checkA11y(page, 'Today, off day');
  // Study anyway changes the hero in place: the same background and strip, today's column labelled Anyway
  const atmo = await page.locator('.today-hero .atmo').elementHandle();
  await page.getByRole('button', { name: 'Study anyway' }).click();
  await expect(page.getByText('Day off, studying anyway: a normal day')).toBeVisible();
  expect(await atmo?.evaluate(n => n.isConnected)).toBe(true);
  await expect(hero.locator('.wk-strip .is-today small')).toHaveText('Anyway');
  await expect(hero.locator('.numeral')).toHaveText('12');
  await expect(page.locator('.plan-row').filter({ hasText: 'Review round' })).toBeVisible();
  await expect(page.locator('.dock')).toHaveCount(1);
});

test('back after a break: welcome back, the most urgent reviews first, no new items', async ({ page }) => {
  await seed(page, { examInDays: null, week: every(15, 'n'), cards: { b1: dueCards(150) }, kv: { activity: { [day(-6)]: { minutes: 30, rounds: 2 }, [day(-40)]: { minutes: 30, rounds: 2 } } } });
  await open(page, '#/today');
  // the welcome is in the hero (after 3 days or more away); the numeral is today's share, the rest said under it
  const hero = page.getByRole('region', { name: 'Review queue' });
  await expect(hero.getByText(/^Welcome back\. You were away 5 days; today starts with the most urgent\./)).toBeVisible();
  await expect(hero.locator('.unit')).toHaveText('today');
  await expect(hero.getByText(/^of 150 due\. The rest are spread over the next 3 days\./)).toBeVisible();
  await expect(page.getByText(/^150 reviews are due\. Today takes the \d+ most urgent; the rest are spread over the next 3 days\./)).toBeVisible();
  await expect(page.getByText(/\d+ new/)).toHaveCount(0);
  await checkA11y(page, 'Today, back after a break');
});

test('a B2 level goal: the gate says when B2 items join, and Today names the goal', async ({ page }) => {
  await seed(page, { examInDays: null, veteran: true });
  await open(page, '#/profile/goal');
  await page.locator('button[name="add:level"]').click();
  await page.locator('button[name="goal-level:B2"]').click();
  await expect.poll(async () => (await storedSettings(page))?.courses?.[0]?.goal?.level).toBe('B2');
  await expect(page.getByText('B2 items in your new items')).toBeVisible();
  await expect(page.locator('.goal-gate-list li')).toHaveCount(2);
  await expect(page.locator('.goal-gate-list')).toContainText(/Starts when you know half of the B1 items \(\d+ of [\d,]+\)|1 in 4 new items|B2 items first, B1 items still mixed in/);
  await page.locator('input[name="goal-by"]').fill('2027-06');
  await page.locator('input[name="goal-by"]').dispatchEvent('change');
  await expect.poll(async () => (await storedSettings(page))?.courses?.[0]?.goal?.by).toBe('2027-06');
  await checkA11y(page, 'Goals and week, level goal');
  await open(page, '#/today');
  await expect(page.getByText('German · working towards B2 by June 2027')).toBeVisible();
  await expect(page.getByText('Goal: B2 by June 2027')).toBeVisible();
});

test('moving and removing an exam changes no card; removing hides the Exam tab; a date-only exam can be added', async ({ page }) => {
  await seed(page, { examInDays: 60, veteran: true, cards: { b1: dueCards(5) } });
  const before = await storedCards(page, 'b1');
  await open(page, '#/profile/goal');
  await expect(page.locator('#profile-goal .derived')).toHaveText(/^60 days left\. Exam weeks start /);
  await page.locator('button[name="exam:move"]').click();
  const input = page.locator('input[name="exam-date"]');
  await input.fill(day(90));
  await input.dispatchEvent('change');
  await expect(page.locator('#profile-goal .derived')).toHaveText(/^(89|90|91) days left\./);
  await expect.poll(async () => (await storedSettings(page))?.courses?.[0]?.goal?.date).toBe(day(90));
  await page.locator('button[name="exam:remove"]').click();
  await page.getByRole('button', { name: 'Remove exam' }).click();
  await expect.poll(async () => (await storedSettings(page))?.courses?.[0]?.goal).toMatchObject({ exam: null, date: null });
  await expect(page.locator('nav.tabs a[data-tab="exam"]')).toHaveCount(0);
  expect(await storedCards(page, 'b1')).toEqual(before);
  // add it back as a date-only exam (Goethe B2 has no mock tests yet)
  await page.locator('button[name="add:exam"]').click();
  await page.locator('button[name="add-exam:goethe-b2"]').click();
  await page.locator('input[name="exam-date-new"]').fill(day(200));
  await page.locator('button[name="add-exam:save"]').click();
  await expect.poll(async () => (await storedSettings(page))?.courses?.[0]?.goal?.exam).toBe('goethe-b2');
  await expect(page.locator('#profile-goal')).toContainText('No mock tests for this exam yet');
  await expect(page.locator('nav.tabs a[data-tab="exam"]')).toHaveCount(0);
  expect(await storedCards(page, 'b1')).toEqual(before);
});

test('an exam months ahead plans a maintenance Today: the week strip, no countdown, no open mock rows', async ({ page }) => {
  await seed(page, { examInDays: 120, veteran: true, cards: { b1: dueCards(8) } });
  await open(page, '#/today');
  const hero = page.getByRole('region', { name: 'Review queue' });
  await expect(hero).toBeVisible();
  await expect(hero.getByRole('listitem')).toHaveCount(7);
  await expect(page.getByRole('region', { name: 'Exam countdown' })).toHaveCount(0);
  await expect(page.locator('.mbar')).toHaveCount(0);
  await expect(page.getByText(/in a row/)).toHaveCount(0);
});
