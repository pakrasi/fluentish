// Reading (round 4, lane L2b): paste a text, read it, save words into the tray, review them in the reading round,
// questions from (mocked) Claude, and the privacy gate in the browser: a pasted token is never in localStorage and
// leaves the page only in a request to api.anthropic.com after a tap that says it sends it. Synthetic text.
import { test, expect, seed, open, checkA11y, storedCards, settle } from './fixtures.mjs';

const SENTINEL = 'Quorxelbrandt';
const TEXT = 'Die Woche wird kürzer\n\nSeit einigen Jahren wird über eine kürzere Arbeitswoche diskutiert. '
  + `In der Firma ${SENTINEL} arbeiten alle nur noch vier Tage, und die ganze Branche schaut genau hin. `
  + 'Das Ergebnis ist gut: Die Leute sind gesund und das Geld spielt dabei eine kleine Rolle.';
const KEY = 'e2e-fake-claude-key-0001';

/** A kv collection as IndexedDB holds it. @param {import('@playwright/test').Page} page @param {string} name */
async function storedKV(page, name) {
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

/** Paste the text and open it. @param {import('@playwright/test').Page} page */
async function paste(page) {
  await open(page, '#/practice/read/new');
  await checkA11y(page, 'Reading › new text');
  await page.getByRole('textbox', { name: 'Title' }).fill('Vier Tage');
  await page.getByRole('textbox', { name: 'Text' }).fill(TEXT);
  await expect(page.locator('.rd-est')).toContainText(/words · About [ABC][12]/);
  await page.getByRole('button', { name: 'Save and read' }).click();
  await expect(page.locator('#view h1.rd-title')).toHaveText('Vier Tage');
}

test('reading: paste, the estimate, a word sheet, save to the tray; the review round makes the card', async ({ page }) => {
  await seed(page, { veteran: true, examInDays: null });
  await open(page, '#/practice/read');
  await expect(page.locator('#view')).toContainText('Paste an article');
  await checkA11y(page, 'Reading › library');
  await paste(page);
  await expect(page.locator('.rd-badge').first()).toHaveText(/About [ABC][12]/);
  await expect(page.getByRole('progressbar', { name: 'How far you have read' })).toBeAttached();
  await checkA11y(page, 'Reading › reader');

  // the word sheet: the meaning from the list, the sentence, Add to review
  await page.locator('.tv-w', { hasText: /^Branche$/ }).click();
  const sheet = page.locator('dialog.tv-sheet');
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('.tv-sheet-title')).toHaveText('die Branche');
  await expect(sheet).toContainText('Meaning from the word list.');
  await expect(sheet.locator('.tv-quote mark')).toHaveText('Branche');
  await checkA11y(page, 'Reading › word sheet');
  await sheet.getByRole('button', { name: 'Add to review' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.locator('.tv-tray')).toContainText('1 word to review');
  await expect(page.locator('.tv-w', { hasText: /^Branche$/ })).toHaveClass(/is-saved/);

  // a phrase band: eine Rolle spielen, saved as the word list's phrase
  await page.locator('.tv-w.is-band', { hasText: /^Rolle$/ }).click();
  await expect(sheet.locator('.tv-sheet-title')).toHaveText('eine Rolle spielen');
  await sheet.getByRole('button', { name: 'Add to review' }).click();
  await expect(page.locator('.tv-tray')).toContainText('2 words to review');

  // what was stored: two entries with no sentence; the sentences on this device only; no card yet
  const words = /** @type {any} */ (await storedKV(page, 'read.words'));
  expect(Object.keys(words).sort()).toEqual(['W:die_Branche', 'W:eine_rolle_spielen.phrase']);
  expect(JSON.stringify(words)).not.toContain('Firma');
  const ctxs = /** @type {any} */ (await storedKV(page, 'read.ctx'));
  expect(ctxs['W:die_Branche'][0].de).toContain(SENTINEL);
  expect(await storedCards(page, 'de:read')).toEqual({});

  // the tray sheet lists them
  await page.locator('.tv-tray').click();
  await expect(page.locator('dialog.tv-sheet')).toContainText('die Branche');
  await checkA11y(page, 'Reading › tray');
  await page.keyboard.press('Escape');

  // the review round: the word gapped in his sentence
  await open(page, '#/practice/round?kind=read&size=rec');
  await expect(page.locator('.pr-round')).toBeVisible();
  await checkA11y(page, 'Reading › round');
  for (let i = 0; i < 6; i++) {
    const prompt = await page.locator('.pr-promptbox .prompt').innerText();
    const answer = /Firma/.test(prompt) ? 'Branche' : 'eine Rolle spielen';
    await page.getByRole('textbox', { name: 'Your answer in German' }).fill(answer);
    await page.getByRole('button', { name: 'Check' }).click();
    if (await page.locator('.pr-done').count()) break;
    const next = page.getByRole('button', { name: 'Next' });
    if (await next.isVisible()) await next.click();
    if (await page.locator('.pr-done').count()) break;
  }
  await expect(page.locator('.pr-done')).toBeVisible();
  // the round makes cards of the saved words in the order he saved them, as many as reading's share of the day's
  // new items allows (scheduler hotfix: Auto is at most the sustainable rate, which the decks share), so the first
  // saved word is a card and the second may wait for tomorrow's share
  const cards = await storedCards(page, 'de:read');
  const made = Object.keys(cards).sort();
  expect(made).toContain('W:die_Branche');
  expect(made.every(id => ['W:die_Branche', 'W:eine_rolle_spielen.phrase'].includes(id))).toBe(true);
  expect(cards['W:die_Branche'].src).toBe('read');
  expect(JSON.stringify(cards)).not.toContain(SENTINEL);
});

test('reading: a word he already has a card for keeps it; saving adds only the sentence', async ({ page }) => {
  const rec = { S: 4, D: 5, due: '2099-01-01', reps: 3, lapses: 0, last: '2026-09-01', first: '2026-08-01', stage: 1, streak: 0, learn: null, relearn: false, u: 1, hist: [] };
  await seed(page, { veteran: true, examInDays: null, cards: { b1: { 'W:die_Branche': rec } } });
  await paste(page);
  await page.locator('.tv-w', { hasText: /^Branche$/ }).click();
  await page.locator('dialog.tv-sheet').getByRole('button', { name: 'Add to review' }).click();
  await page.locator('.tv-tray').click();
  await expect(page.locator('dialog.tv-sheet')).toContainText('Already in your reviews');
  const words = /** @type {any} */ (await storedKV(page, 'read.words'));
  expect(words['W:die_Branche'].home).toBe('b1');
  await page.keyboard.press('Escape');
  await open(page, '#/practice/round?kind=read&size=rec');
  await expect(page.locator('#view h1')).toHaveText('No saved words to review now');
  expect(await storedCards(page, 'de:read')).toEqual({});
  expect((await storedCards(page, 'b1'))['W:die_Branche'].reps).toBe(3);
});

test('reading privacy: the pasted text reaches Anthropic only after a tap, and never localStorage', async ({ page, claude }) => {
  await seed(page, { veteran: true, examInDays: null, kv: { secrets: { anthropicKey: KEY, githubToken: null } } });
  /** @type {{url: string, body: string, at: number}[]} */ const sent = [];
  page.on('request', req => { const body = req.postData() || ''; sent.push({ url: req.url(), body, at: Date.now() }); });
  await paste(page);
  // read, tap a word in the sentence that holds the token; nothing has gone anywhere yet
  await page.locator('.tv-w', { hasText: /^Branche$/ }).click();
  const sheet = page.locator('dialog.tv-sheet');
  await expect(sheet).toContainText('Translate sends this sentence to Claude with your key.');
  await settle(page);
  expect(sent.filter(r => r.body.includes(SENTINEL)).map(r => r.url)).toEqual([]);
  // the tap that says it sends the sentence
  claude.replies.push({ model: 'claude-haiku-4-5', stop_reason: 'end_turn', content: [{ type: 'text', text: 'In the company the whole sector watches closely.' }] });
  const tapped = Date.now();
  await sheet.getByRole('button', { name: 'Translate sentence' }).click();
  await expect(sheet.locator('.rd-en')).toHaveText('In the company the whole sector watches closely.');
  const carrying = sent.filter(r => r.body.includes(SENTINEL));
  expect(carrying.length).toBe(1);
  expect(new URL(carrying[0].url).hostname).toBe('api.anthropic.com');
  expect(carrying[0].at).toBeGreaterThanOrEqual(tapped);
  await page.keyboard.press('Escape');

  // questions: the whole text, only after "Write questions"
  await page.getByRole('link', { name: 'Questions' }).click();
  await expect(page.locator('#view h1')).toHaveText('Questions');
  await expect(page.locator('#view')).toContainText('This sends the whole text to Claude with your key.');
  await checkA11y(page, 'Reading › questions');
  const reply = { questions: [
    { type: 'mc', skill: 'global', q: 'Worum geht es im Text?', options: ['Um eine kürzere Arbeitswoche', 'Um Urlaub', 'Um Sport'], answer: 0, evidence: 'über eine kürzere Arbeitswoche diskutiert' },
    { type: 'tf', skill: 'detail', q: 'In der Firma arbeiten alle fünf Tage.', options: ['richtig', 'falsch'], answer: 1, evidence: 'arbeiten alle nur noch vier Tage' },
    { type: 'mc', skill: 'detail', q: 'Wer schaut genau hin?', options: ['Die ganze Branche', 'Niemand', 'Die Schule'], answer: 0, evidence: 'die ganze Branche schaut genau hin' },
  ] };
  claude.replies.push({ model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(reply) }] });
  await page.getByRole('button', { name: 'Write questions' }).click();
  await expect(page.locator('.rd-q')).toHaveCount(3);
  const call = claude.calls[claude.calls.length - 1];
  expect(call.output_config.format.type).toBe('json_schema');
  expect(JSON.stringify(call.messages)).toContain(SENTINEL);
  await page.getByRole('button', { name: 'Um Urlaub' }).click();
  await expect(page.locator('.rd-q').first()).toContainText('Not quite. The text says:');
  await page.getByRole('button', { name: 'falsch' }).click();
  await page.getByRole('button', { name: 'Die ganze Branche' }).click();
  await expect(page.locator('.rd-qscore')).toHaveText('2 of 3 right');
  await checkA11y(page, 'Reading › questions answered');

  // nothing of the text in localStorage, and every request that carried it went to Anthropic
  const ls = await page.evaluate(() => JSON.stringify(Object.fromEntries(Object.keys(localStorage).map(k => [k, localStorage.getItem(k)]))));
  expect(ls).not.toContain(SENTINEL);
  expect([...new Set(sent.filter(r => r.body.includes(SENTINEL)).map(r => new URL(r.url).hostname))]).toEqual(['api.anthropic.com']);

  // Done: the finish screen, and the library shows the text
  await page.getByRole('link', { name: 'Finish' }).click();
  await expect(page.locator('#view')).toContainText('Learn to say it');
  await checkA11y(page, 'Reading › done');
  await open(page, '#/practice/read');
  await expect(page.locator('.rd-card')).toContainText('Vier Tage');
});

test('reading: Today offers the text once there is one', async ({ page }) => {
  await seed(page, { veteran: true, examInDays: null });
  await paste(page);
  await open(page, '#/today');
  await expect(page.locator('#view')).toContainText('Reading');
});

test('reading: a graded text opens in the reader with its own reviewed questions, no key needed', async ({ page }) => {
  await seed(page, { veteran: true, examInDays: null });
  await open(page, '#/practice/read');
  await expect(page.locator('#view')).toContainText('Graded texts');
  await page.locator('a[href^="#/practice/read/lib/"]').first().click();
  await expect(page.locator('#view h1.rd-title')).toBeVisible();
  await expect(page.locator('#view')).toContainText('Graded text, B1');
  await checkA11y(page, 'Reading › graded text');
  await page.getByRole('link', { name: 'Questions' }).click();
  await expect(page.locator('.rd-q').first()).toBeVisible();
  await checkA11y(page, 'Reading › graded questions');
});
