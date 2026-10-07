// The phone with the keyboard open (round 6, AUDIT §6). WebKit at a phone's width, with the iOS keyboard emulated as
// the audit harness did: the layout viewport keeps its height, and window.visualViewport is replaced before the app
// boots by a fake whose height (and offsetTop) the test sets, then resize and scroll fire on it, which is what iOS
// Safari does. Every typing flow, at visible heights 460 (keyboard plus its bar) and 400 (QuickType on):
//   - the field and the primary action are fully inside the visible part of the screen and not covered;
//   - nothing runs off the side (no horizontal overflow, every visible button inside the screen);
//   - the keyboard stays up across cards: the same field keeps the focus after Check, Next and Send.
// What the phone itself must still show is in docs/IOS-CHECKS.md (Keyboard).
import { test, expect, seed, open, checkA11y } from './fixtures.mjs';
import { sse } from '../fixtures/conversation-sse.mjs';

test.skip(({ browserName }) => browserName !== 'webkit', 'the on-screen keyboard is a phone matter (WebKit at 390 px)');

/** The fake visualViewport, installed before the app's scripts run. */
const fakeViewport = () => {
  const fake = new EventTarget();
  const st = { h: /** @type {number | null} */ (null), top: 0 };
  const def = (/** @type {string} */ k, /** @type {() => number} */ f) => Object.defineProperty(fake, k, { get: f });
  def('height', () => st.h ?? innerHeight); def('width', () => innerWidth); def('offsetTop', () => st.top); def('offsetLeft', () => 0);
  def('pageTop', () => scrollY + st.top); def('pageLeft', () => scrollX); def('scale', () => 1);
  Object.defineProperty(window, 'visualViewport', { get: () => fake, configurable: true });
  /** @type {any} */ (window).__kb = (/** @type {number | null} */ h, top = 0) => { st.h = h; st.top = top; fake.dispatchEvent(new Event('resize')); fake.dispatchEvent(new Event('scroll')); };
};

/** @param {import('@playwright/test').Page} page */
async function setup(page) { await page.context().addInitScript(fakeViewport); }

/** Open the keyboard: the visible part of the screen is h tall, panned by top. @param {import('@playwright/test').Page} page @param {number | null} h */
async function keyboard(page, h, top = 0) {
  await page.evaluate(([h, top]) => /** @type {any} */ (window).__kb(h, top), /** @type {[number | null, number]} */ ([h, top]));
  // two frames for the helper (it batches on a frame, then reveals on the next), then let an answer's reveal (it
  // opens over --dur-base) and a smooth scroll settle
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.waitForTimeout(400);
}

/**
 * How much of an element shows inside the visible part of the screen [top, top + h], clipped by its scrolling
 * ancestors, and whether something else covers its middle.
 * @param {import('@playwright/test').Locator} loc
 */
async function shown(loc) {
  return loc.evaluate(e => {
    const vv = /** @type {VisualViewport} */ (window.visualViewport);
    const r = e.getBoundingClientRect();
    let y0 = r.top, y1 = r.bottom;
    let fixed = getComputedStyle(e).position === 'fixed';
    for (let a = e.parentElement; a && a !== document.body && !fixed; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.position === 'fixed') fixed = true;
      if (cs.overflowY !== 'visible') { const ar = a.getBoundingClientRect(); y0 = Math.max(y0, ar.top); y1 = Math.min(y1, ar.bottom); }
    }
    y0 = Math.max(y0, vv.offsetTop); y1 = Math.min(y1, vv.offsetTop + vv.height);
    const vis = r.height ? Math.max(0, y1 - y0) / r.height : 0;
    let covered = null;
    if (vis > 0) {
      const hit = document.elementFromPoint(Math.min(Math.max(r.left + Math.min(r.width / 2, 40), 1), innerWidth - 1), (y0 + y1) / 2);
      if (hit && !(hit === e || e.contains(hit) || hit.contains(e))) covered = `${hit.tagName}.${hit.className}`;
    }
    return { vis: Math.round(vis * 100), covered };
  });
}

/** @param {import('@playwright/test').Locator} loc @param {string} what */
async function expectInView(loc, what) {
  await expect(loc, what).toBeVisible();
  const s = await shown(loc);
  expect(s.vis, `${what}: share inside the visible screen`).toBe(100);
  expect(s.covered, `${what}: not covered`).toBeNull();
}

/** Nothing runs off the side: no horizontal scroll, every visible button inside the screen. @param {import('@playwright/test').Page} page @param {string} what */
async function expectNoOverflow(page, what) {
  const bad = await page.evaluate(() => {
    const out = [];
    if (document.documentElement.scrollWidth > innerWidth + 1) out.push(`page ${document.documentElement.scrollWidth}px wide`);
    for (const b of document.querySelectorAll('button, a.btn')) {
      const r = b.getBoundingClientRect();
      if (!r.width || getComputedStyle(b).visibility === 'hidden') continue;
      let clipped = false;
      for (let a = b.parentElement; a; a = a.parentElement) { const cs = getComputedStyle(a); if (cs.overflowX !== 'visible' && a.scrollWidth > a.clientWidth + 1 && /auto|scroll/.test(cs.overflowX)) { clipped = true; break; } }
      if (clipped) continue;   // a row that scrolls sideways on purpose (helper phrases, tabs)
      if (r.right > innerWidth + 1 || r.left < -1) out.push(`${b.textContent?.trim().slice(0, 30)} at ${Math.round(r.left)}..${Math.round(r.right)}`);
    }
    return out;
  });
  expect(bad, `${what}: horizontal overflow`).toEqual([]);
}

/** Tag the focused element, to check later that the very same one still has the focus. @param {import('@playwright/test').Page} page */
const tagFocus = page => page.evaluate(() => { const a = /** @type {any} */ (document.activeElement); a.__kbTag = 'kept'; return a.tagName; });
/** @param {import('@playwright/test').Page} page */
const sameFocus = page => page.evaluate(() => /** @type {any} */ (document.activeElement)?.__kbTag === 'kept');

/**
 * The checks at both heights: in keyboard mode, the field and the actions in view, nothing off the side.
 * @param {import('@playwright/test').Page} page @param {string} what @param {Record<string, import('@playwright/test').Locator>} parts
 */
async function atBothHeights(page, what, parts) {
  for (const h of [460, 400]) {
    await keyboard(page, h);
    await expect(page.locator('body'), `${what} @${h}: keyboard mode`).toHaveClass(/\bkb\b/);
    for (const [name, loc] of Object.entries(parts)) await expectInView(loc, `${what} @${h}: ${name}`);
    await expectNoOverflow(page, `${what} @${h}`);
  }
}

test('Quick sort, Produce: a two-line prompt, the field and Check all show; the field keeps the focus through Check and Next', async ({ page }) => {
  await setup(page);
  await seed(page);
  await open(page, '#/practice/sort?level=A2');
  const input = page.locator('#qs-input');
  await expect(input).toBeFocused();
  // the owner's case: a prompt that runs to two lines
  await page.evaluate(() => { /** @type {HTMLElement} */ (document.querySelector('.qs-prompt')).textContent = 'shut (colloquial: die Tür ist ...); closed'; });
  const check = page.locator('.qs-kbrow .btn-primary');
  await atBothHeights(page, 'Quick sort', { prompt: page.locator('.qs-prompt'), field: input, check, learn: page.locator('.qs-kbrow .btn-quiet').nth(1), tally: page.locator('.qs-tally') });
  await expect(page.locator('.qs-btns')).toBeHidden();
  await expect(page.locator('.qs-how')).toBeHidden();
  await checkA11y(page, 'Quick sort with the keyboard up');
  expect(await input.evaluate(e => getComputedStyle(e).resize)).toBe('none');
  // a miss: the answer and "I knew it, typo" open above the field, in view; Check and Next keep the keyboard
  await tagFocus(page);
  await input.fill('ganz falsch');
  await check.click();
  await expect(page.locator('.qs-produce .pr-res.is-bad')).toBeVisible();
  expect(await sameFocus(page)).toBe(true);
  await keyboard(page, 400);
  await expectInView(page.locator('.qs-typo'), 'Quick sort miss: I knew it, typo');
  await expectInView(input, 'Quick sort miss: the field');
  await expect(check).toHaveText('Next');
  await check.click();
  await expect(check).toHaveText('Check');
  expect(await sameFocus(page)).toBe(true);
  // the keyboard closes: the tiles come back
  await page.evaluate(() => /** @type {HTMLElement} */ (document.activeElement).blur());
  await keyboard(page, null);
  await expect(page.locator('body')).not.toHaveClass(/\bkb\b/);
  await expect(page.locator('.qs-btns')).toBeVisible();
});

test('typed round: the card, the field and Check on the keyboard; the sentence to retype shows above the field; the field persists', async ({ page }) => {
  await setup(page);
  await seed(page, { examInDays: 10 });
  await open(page, '#/practice/round');
  const input = page.locator('#pr-input');
  await expect(input).toBeFocused();
  await atBothHeights(page, 'typed round', { top: page.locator('.pr-top'), prompt: page.locator('.pr-promptbox .prompt').first(), field: input, check: page.locator('.pr-primary') });
  // the header is one 32 px row
  expect(Math.round((await page.locator('.pr-top').boundingBox())?.height || 0)).toBeLessThanOrEqual(34);
  // a miss: "Type it once" and the sentence to copy, above the field, at both heights
  await tagFocus(page);
  await input.fill('falsch falsch');
  await page.locator('.pr-primary').click();
  await expect(input).toHaveAttribute('placeholder', 'Type it once');
  expect(await sameFocus(page)).toBe(true);
  for (const h of [460, 400]) {
    await keyboard(page, h);
    await expectInView(page.locator('.pr-fb .answer-key').first(), `retype @${h}: the sentence to type`);
    await expectInView(input, `retype @${h}: the field`);
    await expectInView(page.locator('.pr-primary'), `retype @${h}: Check`);
  }
  // iOS pans the page: the round box follows the visible part of the screen
  await keyboard(page, 400, 120);
  await expectInView(input, 'retype, panned 120 px: the field');
  await expectInView(page.locator('.pr-primary'), 'retype, panned 120 px: Check');
  await keyboard(page, 400, 0);
  // Skip, then Next: the next card, and the same field still has the focus
  await page.getByRole('button', { name: /^Skip/ }).click();
  expect(await sameFocus(page)).toBe(true);
  await expect(page.locator('.pr-primary')).toHaveText(/^Check/);
  expect(await sameFocus(page)).toBe(true);
});

test('typed round, a mistake card: the task and the words around it clamp, the field is never clipped', async ({ page }) => {
  await setup(page);
  const src = { attemptId: 'W-e2e-1', test: null, module: 'schreiben', label: 'Schreiben Aufgabe 1 · Test' };
  await seed(page, { kv: { mistakes: { 'F:W-e2e-1-2': { id: 'F:W-e2e-1-2', v: 1, wrong: 'meine Hotel hat einen Pool', right: 'mein Hotel einen Pool hat', rule: 'Im Nebensatz steht das Verb am Ende.',
    source: src, createdAt: '2026-10-01T10:00:00.000Z', deletedAt: null, context: { before: 'Mein Urlaub war schön, weil das Wetter gut war und', after: '.' } } } } });
  await open(page, '#/practice/round?kind=mistakes');
  await expect(page.locator('#pr-input')).toBeFocused();
  await atBothHeights(page, 'mistake card', { task: page.locator('.pr-task').first(), field: page.locator('#pr-input'), check: page.locator('.pr-primary') });
});

test('Situations, Check by typing: the panel is the last row over the keyboard, the goal right above it', async ({ page }) => {
  await setup(page);
  await seed(page, { veteran: true, examInDays: null });
  await open(page, '#/practice/situations/round?pick=mixed');
  await page.getByRole('button', { name: /^I know this/ }).click();
  const field = page.locator('.pr-typecheck textarea');
  await expect(field).toBeFocused();
  await atBothHeights(page, 'Situations check', { goal: page.locator('.sim-goal'), field, check: page.locator('.pr-typecheck .btn-primary'), back: page.getByRole('button', { name: 'Back' }) });
  await checkA11y(page, 'Situations, Check by typing with the keyboard up');
  // Check keeps the focus in the field (a wrong answer: the answer opens above it)
  await tagFocus(page);
  await field.fill('falsch');
  await page.locator('.pr-typecheck .btn-primary').click();
  await expect(page.locator('.pr-typecheck .pr-res.is-bad')).toBeVisible();
  expect(await sameFocus(page)).toBe(true);
  await keyboard(page, 400);
  await expectInView(page.locator('.pr-typecheck .answer-key'), 'Situations check, wrong @400: the answer');
});

test('Word building: ONE persistent field across typed cards, and Check / Next on the keyboard', async ({ page }) => {
  await setup(page);
  await seed(page, { examInDays: null, veteran: true });
  await open(page, '#/practice/build/round?kind=pick&ids=PV:abstellen,PS:aufstehen.pres');
  const input = page.locator('.wb-rcard input.answer-input');
  await input.focus();
  await atBothHeights(page, 'Word building', { prompt: page.locator('.wb-rcard .prompt').first(), field: input, check: page.locator('.wb-ractions .btn-primary') });
  await tagFocus(page);
  for (let k = 0; k < 2; k++) {
    await input.fill('xyz');
    await page.locator('.wb-ractions .btn-primary').click();   // Check
    await expect(page.locator('.wb-ractions .btn-primary')).toHaveText(/^Next/);
    expect(await sameFocus(page), `card ${k + 1}: Check keeps the field`).toBe(true);
    await keyboard(page, 400);
    await expectInView(page.locator('.wb-fb .wb-res'), `card ${k + 1}: the answer above the field`);
    await page.locator('.wb-ractions .btn-primary').click();   // Next
    if (!(await page.locator('.wb-rcard input.answer-input:visible').count())) break;
    await expect(page.locator('.wb-ractions .btn-primary')).toHaveText(/^Check/);
    expect(await sameFocus(page), `card ${k + 2}: the same field, still focused`).toBe(true);
  }
});

test('Reading round and Script words: docked, Check on the keyboard', async ({ page }) => {
  await setup(page);
  await seed(page, { veteran: true, examInDays: null });
  await open(page, '#/practice/read/new');
  await page.getByRole('textbox', { name: 'Title' }).fill('Vier Tage');
  await page.getByRole('textbox', { name: 'Text' }).fill('Die Woche wird kürzer\n\nSeit einigen Jahren wird über eine kürzere Arbeitswoche diskutiert. In der Firma Nordlicht arbeiten alle nur noch vier Tage, und die ganze Branche schaut genau hin.');
  await page.getByRole('button', { name: 'Save and read' }).click();
  await page.locator('.tv-w', { hasText: /^Branche$/ }).click();
  await page.locator('dialog.tv-sheet').getByRole('button', { name: 'Add to review' }).click();
  await page.keyboard.press('Escape');
  await open(page, '#/practice/round?kind=read&size=rec');
  await expect(page.locator('.pr-round')).toHaveClass(/is-docked/);
  const field = page.locator('.pr-card textarea');
  await expect(field).toBeFocused();
  await atBothHeights(page, 'Reading round', { prompt: page.locator('.pr-promptbox .prompt'), field, check: page.locator('.pr-actions .btn-primary') });

  await open(page, '#/practice/scripts/new');
  await page.getByRole('textbox', { name: 'Title' }).fill('Fahrrad');
  await page.getByRole('textbox', { name: 'Your script' }).fill('# Einleitung\n\nHallo zusammen, heute erkläre ich euch, wie ein Fahrrad funktioniert. Das Herz jedes Fahrrads ist der Rahmen.\n\n# Bremsen\n\nScheibenbremsen funktionieren auch bei Regen zuverlässig. Vielen Dank fürs Zuhören!');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Rahmen', exact: true }).click();
  await page.keyboard.press('Escape');
  const sid = /scripts\/([^/?]+)/.exec(page.url())?.[1];
  await open(page, `#/practice/round?kind=script:${sid}`);
  await expect(page.locator('.pr-round')).toHaveClass(/is-docked/);
  await page.locator('.pr-card textarea').focus();
  await atBothHeights(page, 'Script words', { prompt: page.locator('.pr-card .prompt'), field: page.locator('.pr-card textarea'), check: page.locator('.pr-actions .btn-primary') });
});

test('Conversation: a fitted column, the bar stays, Send keeps the keyboard; setup Start on the keyboard', async ({ page, claude }) => {
  await setup(page);
  await seed(page, { veteran: true, examInDays: null, kv: { secrets: { anthropicKey: 'e2e-fake-claude-key-0001', githubToken: null } } });
  await open(page, '#/practice/conversation');
  // setup: his own topic, Start on the keyboard, Return starts
  const own = page.locator('#cv-own');
  await own.focus();
  await own.fill('Mein Fahrrad');
  await atBothHeights(page, 'Conversation setup', { field: own, start: page.locator('.cv-start') });
  await expect(own).toHaveAttribute('enterkeyhint', 'go');
  claude.replies.push({ sse: sse('Hallo! Erzähl mir von deinem Fahrrad. Wie oft fährst du damit?') },
    { sse: sse('Das klingt gut. Wohin fährst du am liebsten?') }, { sse: sse('Schön. Und im Winter?') });
  await own.press('Enter');
  await expect(page.locator('.cv-them .cv-line').first()).toBeVisible();
  const field = page.getByRole('textbox', { name: /Your message/ });
  await expect(field).toHaveAttribute('enterkeyhint', 'send');
  await field.focus();
  await tagFocus(page);
  for (const [k, text] of ['Ich fahre jeden Tag zur Arbeit.', 'Am liebsten fahre ich an den See.'].entries()) {
    await field.fill(text);
    await page.locator('.cv-send').click();
    await expect(page.locator('.cv-them .cv-line')).toHaveCount(k + 2);
    expect(await sameFocus(page), `message ${k + 1}: Send keeps the field`).toBe(true);
  }
  await field.fill('Im Winter fahre ich');
  await atBothHeights(page, 'Conversation', { bar: page.locator('.cv-bar'), last: page.locator('.cv-log > li').last(), field, send: page.locator('.cv-send') });
  await expect(page.locator('.cv-helpers')).toBeHidden();   // hidden while the field has text
  await checkA11y(page, 'Conversation with the keyboard up');
  // iOS has nothing to pan: the page itself does not scroll
  expect(await page.evaluate(() => document.scrollingElement?.scrollHeight || 0)).toBeLessThanOrEqual(await page.evaluate(() => innerHeight + 1));
});

test('Write: Build an email folds the email and keeps Check on the keyboard; Write it yourself pins the count and Correct', async ({ page }) => {
  await setup(page);
  await seed(page, { veteran: true, examInDays: null });
  await open(page, '#/practice/write/build/a1-umzug');
  const input = page.locator('.wr-card textarea.answer-input');
  await input.focus();
  await atBothHeights(page, 'Build an email', { cue: page.locator('.wr-cue'), field: input, check: page.locator('.wr-card .card-actions .btn-primary'), lines: page.locator('.wr-prog') });
  await expect(page.locator('.wr-letter')).toBeHidden();
  await open(page, '#/practice/write/build/a1-umzug/free');
  const area = page.locator('textarea.wr-free');
  await area.fill('Liebe Maria,\n\nich bin umgezogen.');
  await area.focus();
  await atBothHeights(page, 'Write it yourself', { field: area, count: page.locator('.wr-kbcount'), correct: page.locator('.wr-kbbar .btn-primary') });
});

test('Exam Schreiben: the header with Abgeben stays at the top of the visible screen', async ({ page }) => {
  await setup(page);
  await seed(page);
  await open(page, '#/exam/1/schreiben');
  await page.getByRole('button', { name: /Schreiben starten/ }).click();
  const ta = page.locator('textarea.ex-write').last();
  await ta.focus();
  for (const h of [460, 400]) {
    await keyboard(page, h);
    await expectInView(page.locator('.ex-submit-top'), `Schreiben @${h}: Abgeben`);
    await expectInView(page.locator('.ex-kbwc'), `Schreiben @${h}: the task's words`);
    await expectNoOverflow(page, `Schreiben @${h}`);
    // iOS pans to the caret: the header follows
    await keyboard(page, h, 80);
    await expectInView(page.locator('.ex-submit-top'), `Schreiben @${h}, panned: Abgeben`);
  }
});

test('Look up: while searching the title and the Map card give way and the first results show; Return closes the keyboard', async ({ page }) => {
  await setup(page);
  await seed(page);
  await open(page, '#/lookup/words');
  const input = page.locator('input.lk-input');
  await input.fill('Hund');
  await input.focus();
  await page.waitForTimeout(400);
  await atBothHeights(page, 'Look up', { search: input, first: page.locator('.lk-list .lk-row, .lk-list li').first() });
  await expect(page.locator('.lk-map')).toBeHidden();
  await checkA11y(page, 'Look up with the keyboard up');
  await input.press('Enter');
  await expect(input).not.toBeFocused();
});

test('the round size picker, the spot check and Profile: the action is in reach; Return saves the key', async ({ page }) => {
  await setup(page);
  await seed(page);
  // the level spot check: a typed card in the round shell
  await open(page, '#/practice/known/A1');
  await page.getByRole('button', { name: 'Start the check' }).click();
  await expect(page.locator('.pr-round textarea')).toBeFocused();
  await atBothHeights(page, 'spot check', { field: page.locator('.pr-round textarea'), check: page.locator('.pr-primary') });
  // the picker's custom number
  await open(page, '#/lookup/map/topic/food');
  await page.locator('.cl-dock .btn-primary').first().click();
  const sheet = page.locator('dialog.rs-sheet');
  if (await sheet.count()) {
    await sheet.locator('.rs-opt[data-k=custom]').click();
    await sheet.locator('input.rs-input').focus();
    await atBothHeights(page, 'size picker', { field: sheet.locator('input.rs-input'), start: sheet.locator('.rs-start') });
    await page.keyboard.press('Escape');
  }
  // Profile: the Claude key is a form; Return saves it
  await open(page, '#/profile/connections');
  const key = page.locator('#profile-connections input[type=password]').first();
  await key.focus();
  await atBothHeights(page, 'Profile key', { field: key, save: page.locator('#profile-connections form.conn button[type=submit]').first() });
  await key.fill('e2e-fake-claude-key-0002');
  await key.press('Enter');
  await expect(page.locator('.toast')).toContainText(/saved/i);
});
