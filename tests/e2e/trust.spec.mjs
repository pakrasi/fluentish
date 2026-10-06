// Round 4, lane I1 (trust): in the browser, every Claude request that was billed is counted (a stream that breaks and
// is retried, Stop, leaving the page, a feedback reply cut off), feedback's Try again stops at the monthly cap, the
// chat's closing at the cap is announced with focus moved, the topic list takes arrow keys, and forced colours keep
// the chat and setup readable. Anthropic and GitHub are mocked; the key is fake; all data is synthetic.
import { test, expect, seed, open } from './fixtures.mjs';
import { sse } from '../fixtures/conversation-sse.mjs';
import zlib from 'node:zlib';

const KEY = 'e2e-fake-claude-key-0002';
const OPENING = 'Hallo! Heute sprechen wir über Reisen. Wohin bist du zuletzt gefahren?';

/** The study month the app counts spend in (the study day starts at 04:00 Berlin time). */
function studyMonth() {
  const d = new Date(Date.now() - 4 * 3600e3);
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit' }).formatToParts(d).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}`;
}

/** A kv collection as IndexedDB holds it. @param {import('@playwright/test').Page} page @param {string} name */
function kv(page, name) {
  return page.evaluate(name => new Promise((resolve, reject) => {
    const r = indexedDB.open('fluentish');
    r.onerror = () => reject(r.error);
    r.onsuccess = () => {
      const db = r.result, out = /** @type {any[]} */ ([]);
      const q = db.transaction('kv').objectStore('kv').openCursor();
      q.onsuccess = () => { const c = q.result; if (!c) { db.close(); resolve(out.length ? out[0] : null); return; } const k = /** @type {any[]} */ (c.key); if (k[k.length - 1] === name) out.push(c.value); c.continue(); };
      q.onerror = () => reject(q.error);
    };
  }), name);
}

/** The one session's record. @param {import('@playwright/test').Page} page @returns {Promise<any>} */
async function session(page) {
  const all = await kv(page, 'conv.sessions');
  return Object.values(all || {})[0] || null;
}

/** @param {import('@playwright/test').Page} page @param {{spent?: number}} [o] */
async function start(page, { spent = 0 } = {}) {
  await seed(page, { veteran: true, examInDays: null, kv: { secrets: { anthropicKey: KEY, githubToken: null }, ...(spent ? { 'conv.spend': { month: studyMonth(), usd: spent, sessions: 1 } } : {}) } });
  await open(page, '#/practice/conversation');
  await expect(page.locator('.cv-choice').first()).toBeVisible();
  await page.getByRole('button', { name: /^Start · about/ }).click();
}

test('a reply whose stream breaks: each try is counted (9000 input tokens a try, four tries)', async ({ page, claude }) => {
  for (let i = 0; i < 4; i++) claude.replies.push({ sse: sse('Hallo, wie geht', { cut: true, usage: { in: 9000, cacheRead: 0, cacheWrite: 0 } }) });
  await start(page);
  await expect(page.locator('.cv-error')).toContainText('The connection broke', { timeout: 30000 });
  expect(claude.calls.length).toBe(4);
  await expect.poll(async () => (await session(page))?.usage?.in).toBe(36000);
  const spend = await kv(page, 'conv.spend');
  expect(spend.usd).toBeGreaterThan(0.07);   // 36,000 input tokens at least
});

test('Stop while the reply is on its way: the request is counted', async ({ page, claude }) => {
  claude.replies.push({ delay: 4000, sse: sse(OPENING) });
  await start(page);
  const stop = page.getByRole('button', { name: 'Stop the reply' });
  await expect(stop).toBeVisible();
  await page.waitForTimeout(1800);
  await stop.click();
  await expect.poll(async () => (await session(page))?.usage?.out ?? 0, { timeout: 10000 }).toBe(1200);   // its max_tokens: the reply was lost
  expect((await kv(page, 'conv.spend')).usd).toBeGreaterThan(0);
});

test('leaving the page while the reply is on its way: the request is counted', async ({ page, claude }) => {
  claude.replies.push({ delay: 4000, sse: sse(OPENING) });
  await start(page);
  await expect(page.getByRole('button', { name: 'Stop the reply' })).toBeVisible();
  await page.waitForTimeout(1800);
  await page.getByRole('link', { name: 'Topics' }).first().click();
  await expect(page.locator('#view h1')).toHaveText('Conversation');
  await expect.poll(async () => (await kv(page, 'conv.spend'))?.usd ?? 0, { timeout: 10000 }).toBeGreaterThan(0);
});

test('feedback cut off at max_tokens is counted; past the cap, Try again sends nothing', async ({ page, claude }) => {
  claude.replies.push({ sse: sse(OPENING) }, { sse: sse('Nach Wien? Wie schön. Was hast du dort gemacht?') },
    { id: 'm', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"summ' }],
      usage: { input_tokens: 2400, output_tokens: 16000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } });
  await start(page, { spent: 2.7 });
  await expect(page.locator('.cv-them .cv-line').first()).toHaveText(OPENING);
  await page.getByRole('textbox', { name: /Your message/ }).fill('Ich bin nach Wien gefahren.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.locator('.cv-them .cv-line').nth(1)).toContainText('Wien');
  await page.getByRole('button', { name: 'End', exact: true }).click();
  await expect(page.locator('.cv-error')).toContainText('cut off');
  expect(claude.calls.length).toBe(3);
  await expect.poll(async () => (await kv(page, 'conv.spend')).usd).toBeGreaterThan(3);
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.locator('.cv-error')).toContainText('this month\'s limit');
  await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
  expect(claude.calls.length).toBe(3);
});

test('the chat closes at the monthly cap: said aloud with the reply, focus on Get feedback', async ({ page, claude }) => {
  claude.replies.push({ sse: sse(OPENING, { usage: { in: 10, cacheRead: 0, cacheWrite: 0, out: 10 } }) },
    { sse: sse('Wien ist schön.', { usage: { in: 4000, cacheRead: 0, cacheWrite: 0, out: 800 } }) });
  await start(page, { spent: 2.99 });
  await expect(page.locator('.cv-them .cv-line').first()).toHaveText(OPENING);
  const field = page.getByRole('textbox', { name: /Your message/ });
  await field.fill('Ich war in Wien.');
  await field.press('Enter');
  await expect(page.locator('.cv-closed')).toBeVisible();
  await expect(page.locator('#live')).toContainText('Wien ist schön.');
  await expect(page.locator('#live')).toContainText('this month\'s limit');
  await expect(page.getByRole('button', { name: 'Get feedback' })).toBeFocused();
});

test('topics: one tab stop per list, arrow keys choose', async ({ page }) => {
  await seed(page, { veteran: true, examInDays: null, kv: { secrets: { anthropicKey: KEY, githubToken: null } } });
  await open(page, '#/practice/conversation');
  const group = page.getByRole('radiogroup').first();
  const radios = group.getByRole('radio');
  await expect(radios.first()).toBeVisible();
  const n = await radios.count();
  expect(n).toBeGreaterThan(1);
  expect(await group.locator('[role="radio"][tabindex="0"]').count()).toBe(1);
  const on = group.locator('[role="radio"][aria-checked="true"]');
  await on.focus();
  const before = await on.getAttribute('data-id');
  await page.keyboard.press('ArrowDown');
  const now = group.locator('[role="radio"][aria-checked="true"]');
  await expect(now).not.toHaveAttribute('data-id', before || '');
  await expect(now).toBeFocused();
  await expect(group.locator('[role="radio"][tabindex="0"]')).toHaveCount(1);
  await page.keyboard.press('ArrowUp');
  await expect(group.locator('[role="radio"][aria-checked="true"]')).toHaveAttribute('data-id', before || '');
});

test('forced colours: the picked topic and the composer stay visible', async ({ page, claude, browserName }) => {
  test.skip(browserName !== 'chromium', 'forced colours are emulated in Chromium only');
  await page.emulateMedia({ forcedColors: 'active' });
  claude.replies.push({ sse: sse(OPENING) });
  await seed(page, { veteran: true, examInDays: null, kv: { secrets: { anthropicKey: KEY, githubToken: null } } });
  await open(page, '#/practice/conversation');
  const picked = page.locator('.cv-choice.is-on').first();
  await expect(picked).toBeVisible();
  expect(await picked.evaluate(el => getComputedStyle(el).outlineStyle)).toBe('solid');
  await page.getByRole('button', { name: /^Start · about/ }).click();
  await expect(page.locator('.cv-them .cv-line').first()).toHaveText(OPENING);
  const css = await page.locator('.cv-composer').evaluate(el => ({ bg: getComputedStyle(el).backgroundColor, img: getComputedStyle(el).backgroundImage }));
  expect(css.bg).not.toBe('rgba(0, 0, 0, 0)');
  expect(await page.locator('.cv-field').evaluate(el => getComputedStyle(el).borderTopStyle)).toBe('solid');
});

test('the browser\'s backup (fake token, gzip snapshot decompressed here) carries no word of a marked phrase', async ({ page, gh }) => {
  const SENTINEL = 'Quorxelbrandt';
  const day = '2026-10-01';
  const legacy = 'RP:auf-dem-schirm-haben';   // saved before the fix: its id stays, its words move to read.ctx
  const card = { S: 2, D: 5, due: day, reps: 1, lapses: 0, last: day, first: day, stage: 1, streak: 0, learn: null, relearn: false, u: 5, hist: [] };
  await seed(page, { token: true, examInDays: null, cards: { 'de:read': { [legacy]: card } }, kv: {
    'read.words': { [legacy]: { lemma: 'auf dem Schirm haben', head: 'auf dem Schirm haben', gloss: `notice ${SENTINEL}`, from: 'me', level: null, zipf: null, kind: 'phrase', home: 'de:read', ref: false, first: day, last: day, n: 1 } },
  } });
  await open(page, '#/profile/data');
  await page.getByRole('button', { name: 'Back up now' }).click();
  await expect(page.locator('.toast').filter({ hasText: 'Backed up.' })).toBeVisible();
  const texts = [...gh.files].map(([p, b64]) => { const b = Buffer.from(b64, 'base64'); return [p, (b[0] === 0x1f && b[1] === 0x8b ? zlib.gunzipSync(b) : b).toString('utf8')]; });
  const snap = texts.find(([p]) => p.includes('/snapshots/'));
  if (!snap) throw new Error('no snapshot went up');
  expect(snap[0].endsWith('.json.gz')).toBe(true);
  expect(texts.filter(([, t]) => t.includes(SENTINEL)).map(([p]) => p)).toEqual([]);
  expect(JSON.parse(snap[1]).cards['de:read'][legacy]).toBeTruthy();
  // on the device the phrase keeps its words (moved to read.ctx)
  await expect.poll(async () => JSON.stringify(await kv(page, 'read.ctx'))).toContain(SENTINEL);
});
