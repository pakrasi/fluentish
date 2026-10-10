// Today draws before the content has loaded (R8 P3, perf finding 1). On the day's first visit the stats are not
// today's yet: a shell (page head, the hero and plan's space, busy) and no plan row until the prepared plan. On a later
// visit the plan is drawn at once from today's stats, and it is the plan the prepared compose gives: every plan Today
// draws during the load has the same rows as the settled page.
import { test, expect, seed, open, settle } from './fixtures.mjs';

/** Record every state of Today's view while it loads: busy (the shell) and the plan rows' titles and minutes. */
const RECORD = () => {
  /** @type {{busy: boolean, rows: string[], numeral: boolean}[]} */ const log = [];
  /** @type {any} */ (window).__today = log;
  let last = '';
  const look = () => {
    const page = document.querySelector('#view .today');
    if (!page) return;
    const s = {
      busy: page.classList.contains('is-loading'),
      rows: [...page.querySelectorAll('.today-b .plan-row')].map(r => r.textContent || ''),
      numeral: !!page.querySelector('.today-hero .numeral'),
    };
    const k = JSON.stringify(s);
    if (k !== last) { last = k; log.push(s); }
  };
  new MutationObserver(look).observe(document, { childList: true, subtree: true });
};

/** @param {import('@playwright/test').Page} page */
async function loaded(page) {
  await expect(page.locator('#view .today:not(.is-loading) .today-b .plan-row').first()).toBeVisible();
  await page.waitForLoadState('networkidle');
  await settle(page);
  const final = await page.locator('#view .today .today-b .plan-row').allTextContents();
  const log = /** @type {{busy: boolean, rows: string[], numeral: boolean}[]} */ (await page.evaluate(() => /** @type {any} */ (window).__today || []));
  return { final, log };
}

test('first visit of the day: a quiet shell, then the plan; a later visit draws the same plan at once', async ({ page }) => {
  await page.addInitScript(RECORD);
  await seed(page, { examInDays: 60, veteran: true });
  await open(page, '#/today');
  const first = await loaded(page);
  expect(first.final.length).toBeGreaterThan(0);
  expect(first.log[0].busy, 'the seeded profile has no stats for today: the shell first').toBe(true);
  expect(first.log[0].rows, 'the shell has no plan row').toEqual([]);
  for (const s of first.log.filter(x => x.rows.length)) expect(s.rows).toEqual(first.final);

  // the stats are today's now: the next start draws the plan without waiting for the content
  await page.reload();
  const again = await loaded(page);
  expect(again.final).toEqual(first.final);
  expect(again.log.some(s => s.busy), 'no shell on a later visit').toBe(false);
  for (const s of again.log.filter(x => x.rows.length)) expect(s.rows, 'every plan drawn during the load is the settled one').toEqual(again.final);
  await expect(page.locator('#view .today[aria-busy]')).toHaveCount(0);
});

/** A B1 review card due on the seeded day's month start (a synthetic id), so the hero has its week strip. */
const due = { S: 3, D: 5, reps: 2, lapses: 0, first: '2026-09-01', last: '2026-09-20', due: '2026-09-25', stage: 1, learn: null, hist: [] };
const CASES = /** @type {[string, any][]} */ ([
  ['maintenance', { examInDays: 60, veteran: true }],
  ['maintenance with reviews and a week', { examInDays: null, veteran: true, cards: { b1: { 'W:test-a': due, 'W:test-b': due } }, week: { min: [45, 45, 20, 45, 30, 60, 0], kind: ['n', 'read', 'light', 'write', 'n', 'talk', 'off'] } }],
  ['exam in 10 days', { examInDays: 10, veteran: true }],
]);
for (const [name, o] of CASES) {
  test(`the shell holds the hero's height: the plan does not move when it arrives · ${name}`, async ({ page }) => {
    await seed(page, o);
    await page.addInitScript(() => {
      /** @type {any} */ (window).__planTop = [];
      new MutationObserver(() => {
        const h = document.querySelector('#view .today .today-b .section h2');
        const busy = !!document.querySelector('#view .today.is-loading');
        if (h) /** @type {any} */ (window).__planTop.push({ busy, top: Math.round(h.getBoundingClientRect().top + scrollY) });
      }).observe(document, { childList: true, subtree: true });
    });
    await open(page, '#/today');
    await expect(page.locator('#view .today:not(.is-loading) .today-b .plan-row').first()).toBeVisible();
    await settle(page);
    const tops = /** @type {{busy: boolean, top: number}[]} */ (await page.evaluate(() => /** @type {any} */ (window).__planTop));
    const shell = tops.filter(x => x.busy).pop(), done = tops.filter(x => !x.busy).pop();
    expect(shell && done).toBeTruthy();
    expect(Math.abs(/** @type {any} */ (done).top - /** @type {any} */ (shell).top), `shell ${shell?.top}, plan ${done?.top}`).toBeLessThanOrEqual(4);
  });
}
