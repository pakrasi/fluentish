// Word families and Today's family (round 7): Today's row → the puzzle → the done screen, a word sheet → its family,
// the Map's family group → the family and back, and typing a word in the puzzle. Synthetic learner and cards only.
import { test, expect, seed, open, checkA11y, storedCards, settle } from './fixtures.mjs';

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(new Date());
const shift = (/** @type {string} */ day, /** @type {number} */ n) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
/** A card answered before: S days of stability, due on `due`. @param {string} due @param {number} S */
const rec = (due, S) => { const t = today(); return { S, D: 5, due, reps: 4, lapses: 0, last: shift(t, -5), first: shift(t, -40), stage: 1, streak: 0, learn: null, relearn: false, u: 1, hist: [[shift(t, -5), 3, 2000, 't', '']] }; };
/** Word building cards: one review due today on stellen, the rest known and not due (they must not be written). */
const cards = () => {
  const t = today();
  return { build: { 'PV:ausstellen': rec(t, 4), 'PD:ausstellen': rec(t, 4), 'PV:bestellen': rec(shift(t, 30), 60), 'PD:bestellen': rec(shift(t, 30), 60), 'PV:vorstellen': rec(shift(t, 20), 40),
    'PW:Ausstellung': rec(shift(t, 25), 40), 'PX:auf.see': rec(shift(t, 30), 50), 'PX:aus.see': rec(shift(t, 30), 50), 'PX:be.say': rec(shift(t, 30), 50) } };
};

/** The day's log in IndexedDB (kv build.family). @param {import('@playwright/test').Page} page */
async function familyLog(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const r = indexedDB.open('fluentish');
    r.onerror = () => reject(r.error);
    r.onsuccess = () => {
      const db = r.result;
      /** @type {any} */
      let out = null;
      const q = db.transaction('kv').objectStore('kv').openCursor();
      q.onsuccess = () => { const c = q.result; if (!c) { db.close(); resolve(out); return; } if (/** @type {any[]} */ (c.key)[1] === 'build.family') out = c.value; c.continue(); };
      q.onerror = () => reject(q.error);
    };
  }));
}

/**
 * Build the open clue with the tiles (and answer Splits or Stays), as he would: the test hook (localhost) says which
 * word it is. Resolves when the clue is done.
 * @param {import('@playwright/test').Page} page
 */
async function solveOne(page) {
  // a found word's lesson stays until Next (no timer): move on to the next open meaning
  if (await page.evaluate(() => { const x = /** @type {any} */ (window).__family; return !!x.day.done[x.day.cards[x.idx]] && !x.day.cards.every((/** @type {string} */ id) => x.day.done[id]); })) {
    await page.getByRole('region', { name: "Today's family" }).locator('.pz-check').click();
  }
  await expect.poll(() => page.evaluate(() => { const x = /** @type {any} */ (window).__family; return !x.day.done[x.day.cards[x.idx]]; }), { timeout: 8000 }).toBe(true);
  // every tile of the word: un- and the inner prefix (unverständlich), each ending of a chain (-lich, then -keit)
  const s = await page.evaluate(() => { const x = /** @type {any} */ (window).__family; const f = x.forms[x.idx]; return { card: x.day.cards[x.idx], pre: [...f.pre].reverse(), suf: [...f.suf], art: f.art || null, join: f.cls === 'verb' ? f.join : null }; });
  const tiles = page.getByRole('region', { name: "Today's family" });
  // start from an empty build (a word typed before stays in the slots)
  await page.locator('.pz-meaning').click();
  await page.keyboard.press('Escape');
  for (const p of s.pre) await tiles.getByRole('button', { name: `Prefix ${p}-`, exact: true }).click();
  for (const x of s.suf) await tiles.locator(`button[data-suf="${x}"]`).click();
  if (s.art) await tiles.getByRole('button', { name: `Article ${s.art}`, exact: true }).click();
  await tiles.getByRole('button', { name: /^Check/ }).click();
  if (s.join) {
    const q = tiles.getByRole('group', { name: 'Does the prefix split off?' });
    await expect(q).toBeVisible();
    await q.getByRole('button', { name: s.join === 's' ? /^Splits/ : /^Stays/ }).click();
  }
  await expect.poll(() => page.evaluate(card => !!(/** @type {any} */ (window).__family.day.done[card]), s.card), { timeout: 8000 }).toBe(true);
  return s.card;
}

test("Today's row opens Today's family; build every word, the done screen, and only due or new words are written", async ({ page }) => {
  test.setTimeout(150_000);
  await seed(page, { examInDays: null, veteran: true, cards: cards() });
  await open(page, '#/today');
  const row = page.getByRole('link', { name: /Today's family/ }).first();
  await expect(row).toBeVisible();
  await expect(page.getByText(/Split or stay/)).toHaveCount(0);   // Today's family replaces Split or stay's row
  await row.click();
  await expect(page.getByRole('heading', { level: 1, name: "Today's family" })).toBeVisible();
  await expect(page.getByRole('button', { name: /of \d+ found/ })).toBeVisible();
  await checkA11y(page, "Today's family");
  const before = await storedCards(page, 'build');
  const n = await page.evaluate(() => /** @type {any} */ (window).__family.day.cards.length);
  expect(n).toBeGreaterThanOrEqual(6);
  for (let i = 0; i < n; i++) await solveOne(page);
  await page.getByRole('region', { name: "Today's family" }).locator('.pz-check').click();
  await expect(page.getByText(`of ${n} words found`)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('heading', { level: 2, name: "Today's board is done" })).toBeVisible();
  await checkA11y(page, "Today's family done");
  // the schedule: a board word writes only when it was due today or new inside the allowance
  const log = /** @type {any} */ (await familyLog(page));
  const day = log.days.find((/** @type {any} */ x) => x.day === today());
  expect(Object.keys(day.done)).toHaveLength(n);
  const after = await storedCards(page, 'build');
  const written = Object.keys(after).filter(id => JSON.stringify(after[id]) !== JSON.stringify(before[id]));
  for (const id of written) expect(day.writes, `${id} was written`).toContain(id);
  expect(after['PV:bestellen']).toEqual(before['PV:bestellen']);   // known and not due: logged only
  if (day.cards.includes('PV:ausstellen')) expect(after['PV:ausstellen'].last).toBe(today());   // due today: written
  // back to Today: the row shows the count and the done tick
  await page.getByRole('link', { name: 'Back to Today' }).click();
  await expect(page.getByRole('link', { name: /Today's family/ }).first()).toContainText(`of ${n} found`);
});

test('a word sheet opens its family with the form open; Look up shows no stray "null"', async ({ page }) => {
  await seed(page, { examInDays: null, veteran: true });
  await open(page, '#/lookup/words/die_Ausstellung');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Ausstellung');
  await expect(page.locator('#view')).not.toContainText('null');
  const link = page.getByRole('link', { name: 'The family of stellen' });
  await expect(link).toBeVisible();
  await link.click();
  await expect(page.getByRole('heading', { level: 1, name: 'stellen' })).toBeVisible();
  const row = page.locator('.fv-row[data-id="die_Ausstellung"] > .fv-rowbtn');
  await expect(row).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.fv-detail.is-open .fv-what')).toHaveText('exhibition');
  await checkA11y(page, 'Word family');
  // browse by prefix: every verb with aus- across the roots
  await page.getByRole('group', { name: 'Browse by' }).getByRole('button', { name: 'Prefix' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'By prefix' })).toBeVisible();
  await expect(page.locator('.fv-browse-list .fv-row').first()).toBeVisible();
});

test("the Map's family group links to the family, and the family links back", async ({ page }) => {
  await seed(page, { examInDays: null, veteran: true });
  await open(page, '#/lookup/map/family/stellen');
  const built = page.getByRole('link', { name: 'How the words are built' });
  await expect(built).toBeVisible();
  await built.click();
  await expect(page.getByRole('heading', { level: 1, name: 'stellen' })).toBeVisible();
  await expect(page.getByRole('group', { name: /The family of stellen/ })).toBeVisible();
  await settle(page);
  await page.getByRole('link', { name: 'On the map' }).last().click();
  await expect(page).toHaveURL(/#\/lookup\/map\/family\/stellen/);
});

test("typing in Today's family: keyboard mode, the word parsed into its parts", async ({ page, isMobile }) => {
  test.setTimeout(90_000);
  await seed(page, { examInDays: null, veteran: true, cards: cards() });
  await open(page, '#/practice/build/today');
  const s = await page.evaluate(() => { const x = /** @type {any} */ (window).__family; const f = x.forms[x.idx]; return { card: x.day.cards[x.idx], word: `${f.art ? `${f.art} ` : ''}${f.word}`, join: f.cls === 'verb' ? f.join : null }; });
  const box = page.getByRole('region', { name: "Today's family" });
  if (isMobile) {
    await box.getByRole('button', { name: 'Type', exact: true }).click();
    const field = box.getByRole('textbox', { name: 'Type the word, with its article for a noun' });
    await expect(field).toBeFocused();
    await field.fill(s.word);
    await field.press('Enter');
  } else {
    // a hardware keyboard: letters typed anywhere switch to typed mode
    await page.locator('.pz-meaning').click();
    await page.keyboard.type(s.word);
    await expect(box.getByRole('textbox', { name: 'Type the word, with its article for a noun' })).toHaveValue(s.word);
    await page.keyboard.press('Enter');
  }
  if (s.join) await box.getByRole('button', { name: s.join === 's' ? /^Splits/ : /^Stays/ }).click();
  await expect.poll(() => page.evaluate(card => /** @type {any} */ (window).__family.day.done[card] || null, s.card)).toBe('f1');
  await checkA11y(page, "Today's family typed");
});

test("Today's family builds un- words and chained endings with the tiles; another word typed is not the clue's", async ({ page }) => {
  test.setTimeout(90_000);
  const t = today();
  // due reviews on fallen put its words with un- and two endings on the board (der Unfall, zufällig, unauffällig)
  const due = ['PF:der_Unfall', 'PW:zufällig', 'PF:unauffällig.adj'];
  await seed(page, { examInDays: null, veteran: true, cards: { build: Object.fromEntries(due.map(id => [id, rec(t, 4)])) } });
  await open(page, '#/practice/build/today');
  const box = page.getByRole('region', { name: "Today's family" });
  await expect.poll(() => page.evaluate(() => /** @type {any} */ (window).__family?.day.root)).toBe('fallen');
  const cards = await page.evaluate(() => /** @type {any} */ (window).__family.day.cards);
  for (const id of due) expect(cards).toContain(id);
  /** Go to a clue with the arrow keys. @param {string} id */
  const goTo = async id => {
    for (let k = 0; k < cards.length; k++) {
      if (await page.evaluate(c => { const x = /** @type {any} */ (window).__family; return x.day.cards[x.idx] === c; }, id)) return;
      await page.locator('.pz-meaning').click();
      await page.keyboard.press('ArrowDown');
    }
  };
  // another word of the family typed for der Unfall is never der Unfall (and never "a wrong article")
  await goTo('PF:der_Unfall');
  await page.locator('.pz-meaning').click();
  await page.keyboard.type('der Zufall');
  await page.keyboard.press('Enter');
  await expect(box.locator('.pz-msg')).not.toHaveText(/wrong article/);
  expect(await page.evaluate(() => /** @type {any} */ (window).__family.day.done['PF:der_Unfall'] || null)).toBe(null);
  // each of them built with its tiles: un + bare stem + der; zu + bare stem + -ig; un + auf + -ig
  for (const id of due) {
    await goTo(id);
    if (await page.evaluate(c => !!(/** @type {any} */ (window).__family.day.done[c]), id)) continue;
    expect(await solveOne(page)).toBe(id);
  }
});

test("a build that is another clue's word names that clue and fills nothing: no try, no card written", async ({ page }) => {
  test.setTimeout(60_000);
  await seed(page, { examInDays: null, veteran: true, cards: cards() });
  await open(page, '#/practice/build/today');
  const box = page.getByRole('region', { name: "Today's family" });
  // the open clue, and another open clue on the board that a different set of tiles builds
  const s = await page.evaluate(() => {
    const x = /** @type {any} */ (window).__family, f = x.forms[x.idx];
    const j = x.forms.findIndex((/** @type {any} */ g, /** @type {number} */ k) => k !== x.idx && !x.day.done[x.day.cards[k]] && g.key !== f.key && g.word !== f.word);
    const g = x.forms[j];
    return { card: x.day.cards[x.idx], other: x.day.cards[j], word: `${g.art ? `${g.art} ` : ''}${g.word}`, pre: [...g.pre].reverse(), suf: [...g.suf], art: g.art || null };
  });
  const before = await storedCards(page, 'build');
  // with the tiles
  for (const p of s.pre) await box.getByRole('button', { name: `Prefix ${p}-`, exact: true }).click();
  for (const x of s.suf) await box.locator(`button[data-suf="${x}"]`).click();
  if (s.art) await box.getByRole('button', { name: `Article ${s.art}`, exact: true }).click();
  await box.getByRole('button', { name: /^Check/ }).click();
  await expect(box.locator('.pz-msg')).toContainText('for another meaning');
  // typed
  await page.locator('.pz-meaning').click();
  await page.keyboard.press('Escape');
  await page.keyboard.type(s.word);
  await page.keyboard.press('Enter');
  await expect(box.locator('.pz-msg')).toContainText('for another meaning');
  const day = await page.evaluate(() => /** @type {any} */ (window).__family.day);
  expect(day.done[s.other] || null).toBe(null);
  expect(day.done[s.card] || null).toBe(null);
  expect(day.tries[s.card] || 0).toBe(0);
  expect(await page.evaluate(() => { const x = /** @type {any} */ (window).__family; return x.day.cards[x.idx]; })).toBe(s.card);
  expect(await storedCards(page, 'build')).toEqual(before);
});

test('inside a round the family opens as a sheet over it, and the round goes on', async ({ page }) => {
  await seed(page, { examInDays: null, veteran: true, cards: cards() });
  await open(page, '#/practice/build/round?kind=pick&ids=PV:ausstellen');
  const round = page.getByRole('region', { name: 'Word building round' });
  await round.getByRole('textbox').fill('ausstellen');
  await round.getByRole('button', { name: /^Check/ }).click();
  const link = round.getByRole('button', { name: 'The family of stellen' });
  await expect(link).toBeVisible();
  await link.click();
  const sheet = page.getByRole('dialog', { name: 'Word family' });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('heading', { level: 1, name: 'stellen' })).toBeVisible();
  await expect(sheet.locator('.fv-row[data-id="ausstellen.verb"] > .fv-rowbtn')).toHaveAttribute('aria-expanded', 'true');
  await checkA11y(page, 'Word family sheet');
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await expect(round).toBeVisible();
  await expect(page).toHaveURL(/#\/practice\/build\/round/);
});
