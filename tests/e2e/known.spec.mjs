import { test, expect, seed, open, checkA11y, storedCards } from './fixtures.mjs';

/** A kv collection of the active profile, read straight from IndexedDB. @param {import('@playwright/test').Page} page @param {string} name */
async function storedKV(page, name) {
  return page.evaluate(name => new Promise((resolve, reject) => {
    const r = indexedDB.open('fluentish');
    r.onerror = () => reject(r.error);
    r.onsuccess = () => {
      const db = r.result, out = /** @type {any[]} */ ([]);
      const q = db.transaction('kv').objectStore('kv').openCursor();
      q.onsuccess = () => {
        const c = q.result;
        if (!c) { db.close(); resolve(out.length ? out[0] : null); return; }
        const k = /** @type {any[]} */ (c.key);
        if (k[1] === name && k[0] !== 'device') out.push(c.value);
        c.continue();
      };
      q.onerror = () => reject(q.error);
    };
  }), name);
}

/** Every card marked known, in any deck. @param {import('@playwright/test').Page} page */
async function marks(page) {
  /** @type {string[]} */ const out = [];
  for (const deck of ['b1', 'clusters', 'speak', 'script']) for (const [id, r] of Object.entries(await storedCards(page, deck))) if (r.known) out.push(id);
  return out;
}

test('I know this on a new card, then Undo from the toast', async ({ page }) => {
  await seed(page);
  await open(page, '#/practice/round');
  const prompt = await page.locator('.pr-promptbox .prompt').first().textContent();
  await page.getByRole('button', { name: 'I know this' }).click();
  // the card lifted away: the round shows the next prompt
  await expect(page.locator('.pr-promptbox .prompt').first()).not.toHaveText(String(prompt));
  const marked = Object.entries(await storedCards(page, 'b1'));
  expect(marked).toHaveLength(1);
  const [id, rec] = marked[0];
  expect(rec.known?.by).toBe('self');   // marked known (data/known.js), checked once in about 60 days
  const toast = page.locator('.toast').filter({ hasText: 'Marked as known' });
  await expect(toast).toBeVisible();
  await toast.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.toast').filter({ hasText: 'Back to new.' })).toBeVisible();
  expect(await storedCards(page, 'b1'), `${id} is back to new`).toEqual({});
});

test('Quick sort: Know, Learn, Know, undo the last, then the summary', async ({ page }) => {
  await seed(page);
  await open(page, '#/practice/sort?level=A1');
  await expect(page.locator('.qs-round')).toBeVisible();
  // a fresh device with no typed answers opens in Produce; Recognise is today's flow
  await expect(page.getByRole('button', { name: 'Produce' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Recognise' }).click();
  await checkA11y(page, 'Quick sort');
  const word = page.locator('.qs-word');
  const words = [];
  for (const pick of ['Know', 'Learn', 'Know']) {
    words.push(await word.getAttribute('aria-label'));
    await page.locator(`.qs-btn.is-${pick.toLowerCase()}`).click();
    await expect(word).not.toHaveAttribute('aria-label', String(words.at(-1)));
  }
  await page.getByRole('button', { name: /^Undo/ }).click();
  await expect(word).toHaveAttribute('aria-label', String(words[2]));   // the third word is back
  await page.getByRole('button', { name: /^(End|Done)/ }).first().click();
  await expect(page.locator('#view h1').first()).toBeVisible();
  await expect(page.locator('#view')).toContainText(/1 known/i);
  // one word is stored as known, whatever deck its card lives in; the undone one is not
  let marks = 0;
  for (const deck of ['b1', 'clusters', 'speak', 'script']) marks += Object.values(await storedCards(page, deck)).filter(r => r.known).length;
  expect(marks).toBe(1);
  await checkA11y(page, 'Quick sort done');
});

test('Quick sort in Produce: type the German, right is marked known, a miss goes to Learn with the typo override, skip, then Recheck', async ({ page }) => {
  await seed(page);
  await open(page, '#/practice/sort?level=A1');
  await expect(page.locator('.qs-round.is-produce')).toBeVisible();
  const input = page.locator('#qs-input');
  await expect(input).toBeFocused();
  await checkA11y(page, 'Quick sort, Produce');
  const model = async () => page.evaluate(() => { const s = /** @type {any} */ (window).__sort; return s.model(s.list[s.i]); });
  const prompt = page.locator('.qs-prompt');
  // 1: right first time
  let p0 = await prompt.textContent();
  await input.fill(String(await model()));
  await input.press('Enter');
  await expect(prompt).not.toHaveText(String(p0));
  expect(await marks(page)).toHaveLength(1);
  // 2: a miss shows the answer and counts as Learn; "I knew it, typo" marks it known after all
  const right2 = String(await model());
  p0 = await prompt.textContent();
  await input.fill('ganz falsch');
  await input.press('Enter');
  await expect(page.locator('.pr-fb .answer-key')).toContainText(right2);
  await expect(page.locator('.qs-btn.is-learn .qs-n')).toHaveText('1');
  await checkA11y(page, 'Quick sort, Produce, a miss');
  await page.getByRole('button', { name: /I knew it, typo/ }).click();
  await expect(prompt).not.toHaveText(String(p0));
  await expect(page.locator('.qs-btn.is-know .qs-n')).toHaveText('2');
  expect(await marks(page)).toHaveLength(2);
  // 3: skip leaves it untouched
  p0 = await prompt.textContent();
  await page.getByRole('button', { name: /^Skip/ }).click();
  await expect(prompt).not.toHaveText(String(p0));
  // 4: a miss, then Enter: it stays in Learn, its card untouched
  await input.fill('ganz falsch');
  await input.press('Enter');
  await expect(page.locator('.pr-fb .answer-key')).toBeVisible();
  await input.press('Enter');
  await expect(page.locator('.qs-btn.is-learn .qs-n')).toHaveText('1');
  expect(await marks(page)).toHaveLength(2);
  // undo the last (the miss), then end
  await page.getByRole('button', { name: /^Undo/ }).click();
  await expect(page.locator('.qs-btn.is-learn .qs-n')).toHaveText('0');
  await input.fill('ganz falsch');
  await input.press('Enter');
  await expect(page.locator('.pr-fb .answer-key')).toBeVisible();
  await page.getByRole('button', { name: /^End/ }).click();
  await expect(page.locator('#view')).toContainText(/Marked 2 known, 1 to learn/);
  await expect(page.locator('#view')).toContainText(/1 word skipped/);
  const checks = /** @type {Record<string, any>} */ (await storedKV(page, 'known.checks'));
  // two Learn picks were made (the typo word and the miss); the typo word's later right check takes it off the Recheck list
  expect(Object.values(checks).filter(e => e.learn)).toHaveLength(2);
  expect(Object.values(checks).filter(e => e.learn && !(e.prod?.ok && e.prod.at >= e.learn.at))).toHaveLength(1);
  expect(Object.values(checks).filter(e => e.prod?.ok)).toHaveLength(2);
  // only a mode he picks is remembered on this device; the default was not picked
  expect(await page.evaluate(() => localStorage.getItem('fluentish.sortMode'))).toBeNull();
  await checkA11y(page, 'Quick sort, Produce, done');
  // Recheck by typing: the one word sorted to Learn; a miss changes nothing
  await page.locator('#qs-recheck').click();
  await expect(page.locator('.qs-round.is-produce')).toBeVisible();
  await expect(page.locator('.qs-mode')).toHaveCount(0);
  await expect(page.locator('.qs-name')).toContainText('Words sorted to Learn');
  const before = await marks(page);
  await page.locator('#qs-input').fill('ganz falsch');
  await page.locator('#qs-input').press('Enter');
  await expect(page.locator('.pr-fb')).toContainText('Nothing changes');
  expect(await marks(page)).toEqual(before);
  await checkA11y(page, 'Recheck by typing');
});

test('Recheck by typing from Look up › Words: the earlier Learn picks; typing right marks the word known, nothing else changes', async ({ page }) => {
  // two Learn picks from an earlier Recognise sort (synthetic)
  const day = '2026-10-01';
  await seed(page, { kv: { 'known.checks': { 'W:der_Hund': { learn: { on: day, at: 1, mode: 'recognise', from: 'sort' } }, 'W:gehen.verb': { learn: { on: day, at: 2, mode: 'recognise', from: 'sort' } } } } });
  await open(page, '#/lookup/words?w=all');
  const link = page.locator('.lk-recheck a');
  await expect(link).toBeVisible();
  const n = Number((await link.textContent())?.match(/\d+/)?.[0]);
  expect(n).toBeGreaterThan(0);
  await checkA11y(page, 'Look up › Words with Recheck');
  await link.click();
  await expect(page.locator('.qs-round.is-produce')).toBeVisible();
  await expect(page.locator('.caption.tnum').first()).toContainText(`1 of ${n}`);
  const model = await page.evaluate(() => { const s = /** @type {any} */ (window).__sort; return s.model(s.list[s.i]); });
  await page.locator('#qs-input').fill(String(model));
  await page.locator('#qs-input').press('Enter');
  await expect.poll(async () => (await marks(page)).length).toBe(1);
  await expect(page.locator('.caption.tnum').first()).toContainText(`2 of ${n}`);
});
