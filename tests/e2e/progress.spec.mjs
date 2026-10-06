// Today › Progress (round 4, lane L5): the page over a seeded multi-month synthetic log (tests/e2e/progress-seed.mjs),
// its table twins, the range row, the level goal, and the study hours file (Toggl) mocked on its GitHub Pages URL and
// never added to the app's minutes. axe on both views. All data is synthetic.
import { test, expect, seed, open, checkA11y, SHA, APP } from './fixtures.mjs';
import { syntheticLog, syntheticHours } from './progress-seed.mjs';

const HOURS_URL = 'https://pakrasi.github.io/language-stack/data/toggl.json';

/** The app's study day in the browser (its clock: local time, the 4 o'clock cutoff). @param {import('@playwright/test').Page} page @returns {Promise<string>} */
async function appToday(page) {
  await page.goto(`${APP}version.json`);
  return page.evaluate(async (/** @type {string} */ sha) => (await import(`/fluentish/v/${sha}/src/core/clock.js`)).createClock({ exam: () => null }).today(), SHA);
}

/** A level goal on the active course, written through the app's own settings writer. @param {import('@playwright/test').Page} page @param {Record<string, any>} patch */
async function setGoal(page, patch) {
  await page.evaluate(async (/** @type {{sha: string, patch: Record<string, any>}} */ { sha, patch }) => {
    const v = `/fluentish/v/${sha}/src/`;
    const [{ createIdbAdapter }, { openSession }, S, clockM] = await Promise.all([import(v + 'data/adapters/idb.js'), import(v + 'data/session.js'), import(v + 'data/settings.js'), import(v + 'core/clock.js')]);
    const adapter = await createIdbAdapter();
    const s = await openSession({ adapter, legacyStorage: null, clock: clockM.createClock({ exam: () => null }), kind: 'local' });
    const settings = S.normalizeSettings(s.store.get('settings'));
    S.setCourse({ store: s.store, hlc: s.hlc }, settings.activeCourse, patch);
    await s.store.flush(); s.store.close(); adapter.close?.();
  }, { sha: SHA, patch });
}

/** The minutes of a week of the seeded log, every device added up (what the In Fluentish table must show). @param {Record<string, Record<string, any>>} kv @param {string} mon */
function weekMinutes(kv, mon) {
  let m = 0;
  for (const month of Object.values(kv)) for (const [d, r] of Object.entries(month)) if (d >= mon && d <= addDay(mon, 6)) m += r.min.total;
  return Math.round(m);
}
const addDay = (/** @type {string} */ d, /** @type {number} */ n) => { const [y, m, dd] = d.split('-').map(Number); return new Date(Date.UTC(y, m - 1, dd + n)).toISOString().slice(0, 10); };
const hm = (/** @type {number} */ m) => (m < 60 ? `${m} min` : m % 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}` : `${m / 60} h`);

test('Progress over a seeded log: charts with table twins, the range row, milestones, the level goal and the weekly log', async ({ page }) => {
  const today = await appToday(page);
  const kv = syntheticLog(today);
  await seed(page, { examInDays: null, kv });
  await setGoal(page, { 'goal.level': 'B2', 'goal.by': `${Number(today.slice(0, 4)) + 1}-12` });
  await page.route(HOURS_URL, route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(syntheticHours(today)) }));
  await open(page, '#/today/progress');
  await expect(page.getByRole('heading', { level: 1, name: 'Progress' })).toBeVisible();
  for (const name of ['Words and phrases known', 'By level', 'Learnt per week', 'Time per week', 'Study days', 'Milestones', 'Weekly log']) {
    await expect(page.getByRole('heading', { level: 2, name })).toBeVisible();
  }
  await expect(page.getByRole('heading', { level: 2, name: /^Goal: B2 by Dec/ })).toBeVisible();
  // every chart is an image with a name and has a table twin
  const charts = page.locator('.progress svg.pg-chart[role="img"]');
  expect(await charts.count()).toBeGreaterThanOrEqual(8);
  for (const label of await charts.evaluateAll(els => els.map(e => e.getAttribute('aria-label')))) expect(label?.length).toBeGreaterThan(10);
  expect(await page.locator('.progress details.pg-table').count()).toBeGreaterThanOrEqual(5);
  // the known table twin holds the latest record's count
  const last = /** @type {[string, any]} */ (Object.values(kv).flatMap(m => Object.entries(m)).sort(([a], [b]) => (a < b ? -1 : 1)).at(-1))[1];
  const lastKnown = ['w', 'p', 'g'].flatMap(k => last.known[k]).reduce((a, b) => a + b, 0);
  const knownSec = page.locator('section', { has: page.getByRole('heading', { name: 'Words and phrases known' }) });
  await knownSec.getByText('Show as a table').click();
  await expect(knownSec.locator('tbody tr').first().locator('td').first()).toHaveText(lastKnown.toLocaleString('en-GB'));
  // honest encodings: the estimated start, the Igloo jump and the map release are labelled
  await expect(knownSec.getByText(/estimated from each card/)).toBeVisible();
  // the range row scopes the numbers and is kept in the address
  const learnt = page.locator('.pg-kpi').nth(1).locator('.pg-kpi-v');
  const all = await learnt.textContent();
  await page.getByRole('group', { name: 'Range' }).getByRole('button', { name: 'All' }).click();
  await expect(knownSec.locator('svg text', { hasText: /^Igloo import \+/ })).toHaveCount(1);
  await expect(knownSec.locator('svg text', { hasText: /^Word list \+/ })).toHaveCount(1);
  await expect(page).toHaveURL(/r=all/);
  await expect(learnt).not.toHaveText(String(all));
  await page.getByRole('group', { name: 'Range' }).getByRole('button', { name: '12 weeks' }).click();
  await expect(page).toHaveURL(/r=12w/);
  // the keyboard readout on a chart
  await page.locator('.progress svg.pg-chart').first().focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('.pg-tip.on')).toBeVisible();
  await page.keyboard.press('Escape');
  // no streaks anywhere
  await expect(page.locator('#view')).not.toContainText(/in a row|streak/i);
  // milestones are dated facts; the level goal is a range or says why there is none
  await expect(page.locator('.pg-ms li').first()).toBeVisible();
  await expect(page.locator('.pg-goal')).toContainText(/80%/);
  await expect(page.locator('.pg-log-row').first()).toContainText(/Week of/);
  await checkA11y(page, 'Progress');
});

test('Progress › All tracked: the study hours file on its own, never added to the Fluentish minutes', async ({ page }) => {
  const today = await appToday(page);
  const kv = syntheticLog(today);
  const hours = syntheticHours(today);
  // the owner's device (a token on it): the boot migration keeps his study hours file (data/connection.js)
  await seed(page, { examInDays: null, kv: { ...kv, ui: { importSeen: true } }, token: true });
  let reads = 0;
  await page.route(HOURS_URL, route => { reads++; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(hours) }); });
  await open(page, '#/today/progress?r=12w');
  const time = page.locator('section', { has: page.getByRole('heading', { name: 'Time per week' }) });
  const kpi = await page.locator('.pg-kpi').nth(2).locator('.pg-kpi-v').textContent();
  // In Fluentish: last full week's minutes are the log's, every device added up
  await time.getByText('Show as a table').click();
  const appRow = time.locator('tbody tr').nth(1);
  const appCell = await appRow.locator('td').first().textContent();
  // All tracked
  await page.getByRole('group', { name: 'Which hours' }).getByRole('button', { name: 'All tracked' }).click();
  await expect(time.getByText(/includes the time you spent in Fluentish/)).toBeVisible();
  await expect(time.getByText('Show as a table')).toBeVisible();
  expect(reads).toBe(1);
  await time.getByText('Show as a table').click();
  const trackedCell = await time.locator('tbody tr').nth(1).locator('td').first().textContent();
  // the tracked hours of that week are the file's German entries only
  const weekStart = (() => { const t = new Date(`${today}T12:00:00Z`); const dow = (t.getUTCDay() + 6) % 7; return addDay(today, -dow - 7); })();
  const fileMin = Math.round(hours.entries.filter(e => e.lang === 'german' && e.date >= weekStart && e.date <= addDay(weekStart, 6)).reduce((s, e) => s + e.hours * 60, 0));
  expect(trackedCell).toBe(hm(fileMin));
  expect(appCell).toBe(hm(weekMinutes(kv, weekStart)));
  expect(trackedCell).not.toBe(hm(fileMin + weekMinutes(kv, weekStart)));
  // the Fluentish figure at the top did not change
  await expect(page.locator('.pg-kpi').nth(2).locator('.pg-kpi-v')).toHaveText(String(kpi));
  await checkA11y(page, 'Progress, All tracked');
  // read once a day: back to In Fluentish and again does not fetch again
  await page.getByRole('group', { name: 'Which hours' }).getByRole('button', { name: 'In Fluentish' }).click();
  await page.getByRole('group', { name: 'Which hours' }).getByRole('button', { name: 'All tracked' }).click();
  await expect(time.getByText(/includes the time you spent in Fluentish/)).toBeVisible();
  expect(reads).toBe(1);
  // a range switch with All tracked keeps the chart (it was once an empty holder: round 4 design review P0-1)
  await page.getByRole('group', { name: 'Range' }).getByRole('button', { name: 'All' }).click();
  await expect(time.locator('svg.pg-chart')).toHaveCount(1);
  await expect(time.getByText(/includes the time you spent in Fluentish/)).toBeVisible();
  // the source can be changed; a malformed one is refused
  await time.getByRole('button', { name: 'Change source' }).click();
  await time.getByLabel('Repository (owner/name)').fill('not a repo');
  await time.getByRole('button', { name: 'Save source' }).click();
  await expect(time.getByText(/Write the repository as owner\/name/)).toBeVisible();
});

test('Progress with no log yet says what fills it; Today links to it and back', async ({ page }) => {
  await seed(page, { examInDays: null });
  await open(page, '#/today/progress');
  await expect(page.getByText(/No progress records yet/)).toBeVisible();
  await page.getByRole('link', { name: 'Today' }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();
  // and Today's Where you stand leads to it
  await page.getByRole('link', { name: 'Progress over time' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Progress' })).toBeVisible();
  await expect(page.locator('[data-tab="today"][aria-current="page"]').first()).toBeAttached();
});

test('Progress with motion on: the charts draw in once and settle', async ({ page }) => {
  const today = await appToday(page);
  await seed(page, { examInDays: null, kv: syntheticLog(today, { days: 90 }), motion: 'full' });
  await page.route(HOURS_URL, route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"entries": []}' }));
  await open(page, '#/today/progress');
  await expect(page.locator('.progress svg.pg-chart .pg-line').first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.getAnimations().filter(a => a.playState === 'running').length), { timeout: 5000 }).toBe(0);
  await expect(page.locator('.pg-kpi-v').first()).not.toHaveText(/^[+−]?0$/);
});
