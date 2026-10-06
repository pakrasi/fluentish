import { test, expect, seed, open, checkA11y, storedCards } from './fixtures.mjs';

/** A stand-in for the browser's speech recogniser: it "hears" window.__heard, with window.__conf (default 0.9). */
const fakeRecogniser = () => {
  class FakeRecognition {
    /** @type {((e: any) => void) | null} */ onresult = null;
    /** @type {(() => void) | null} */ onend = null;
    start() {
      setTimeout(() => {
        const text = /** @type {any} */ (window).__heard || '';
        if (text) {
          const alt = [{ transcript: text, confidence: /** @type {any} */ (window).__conf ?? 0.9 }];
          this.onresult?.({ resultIndex: 0, results: [Object.assign(alt, { isFinal: true })] });
        }
        this.onend?.();
      }, 30);
    }
    stop() {}
    abort() {}
  }
  Object.assign(window, { SpeechRecognition: FakeRecognition, webkitSpeechRecognition: FakeRecognition });
};

test('a situation is heard first: the words wait behind Show the words', async ({ page }) => {
  await seed(page, { veteran: true, examInDays: null, motion: 'full' });
  await open(page, '#/practice/situations/round?pick=mixed');
  const card = page.locator('.sim-card');
  await expect(card).toBeVisible();
  const line = card.locator('.sim-them .sim-line');
  await expect(line).toBeHidden();
  const show = card.getByRole('button', { name: 'Show the words' });
  await expect(show).toBeVisible();
  await checkA11y(page, 'situation, line hidden');
  await show.click();
  await expect(line).toBeVisible();
  await expect(show).toBeHidden();
  // Show answer always puts the words on screen too, and grading moves on
  await page.getByRole('button', { name: /^Show answer/ }).click();
  await expect(card.locator('.sim-reveal.is-open')).toHaveCount(1);
  await page.locator('.grade4-b[data-g="3"]').click();
  await expect(line).toBeHidden();   // the next card starts heard-first again
  expect(Object.keys(await storedCards(page, 'speak'))).toHaveLength(1);
});

test('with reduced motion the line is always on screen', async ({ page }) => {
  await seed(page, { veteran: true, examInDays: null, motion: 'reduce' });
  await open(page, '#/practice/situations/round?pick=mixed');
  await expect(page.locator('.sim-them .sim-line')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Show the words' })).toBeHidden();
});

test('Check with the mic inside a situation: the phrase heard, a suggested grade, the card graded', async ({ page }) => {
  await page.addInitScript(fakeRecogniser);
  await seed(page, { veteran: true, examInDays: null });
  await open(page, '#/practice/situations/round?pick=mixed');
  const card = page.locator('.sim-card');
  const toggle = card.getByRole('button', { name: 'Check with the mic' });
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  // say the model answer (it is on the card, folded away until Show answer)
  const answer = String(await card.locator('.sim-you .sim-line').textContent());
  await page.evaluate(a => { /** @type {any} */ (window).__heard = a; }, answer);
  await card.getByRole('button', { name: 'Say your answer' }).click();
  await expect(card.locator('.sim-heard')).toContainText('You said:');
  await expect(card.locator('.sim-heard .pr-checks')).toContainText('Right');
  await expect(card.locator('.sim-reveal.is-open')).toHaveCount(1);
  await expect(page.locator('.grade4-b.is-suggested')).toHaveAttribute('data-g', '3');
  await checkA11y(page, 'situation, mic checked');
  await page.locator('.grade4-b.is-suggested').click();
  // the switch stays on for the next card and the next round
  await expect(card.getByRole('button', { name: 'Say your answer' })).toBeVisible();
  // a wrong answer, heard clearly in a quiet room: the chunk is missing, Again is suggested
  await page.evaluate(() => { /** @type {any} */ (window).__heard = 'Ich habe heute leider keine Zeit, vielleicht morgen.'; });
  await card.getByRole('button', { name: 'Say your answer' }).click();
  await expect(card.locator('.sim-heard .pr-checks')).toContainText('Wrong');
  await expect(page.locator('.grade4-b.is-suggested')).toHaveAttribute('data-g', '1');
});

/** A microphone whose level is window.__amp (RMS, 0..1): getUserMedia and Web Audio answered on the page. */
const fakeMic = () => {
  const w = /** @type {any} */ (window);
  w.__amp = w.__amp ?? 0.001;
  class FakeAC {
    resume() { return Promise.resolve(); }
    close() { return Promise.resolve(); }
    createMediaStreamSource() { return { connect() {} }; }
    createAnalyser() { return { fftSize: 1024, getFloatTimeDomainData(/** @type {Float32Array} */ b) { for (let i = 0; i < b.length; i++) b[i] = i % 2 ? w.__amp : -w.__amp; } }; }
  }
  Object.assign(window, { AudioContext: FakeAC, webkitAudioContext: FakeAC });
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
    getUserMedia: async () => new MediaStream(),
    getSupportedConstraints: () => ({ echoCancellation: true }),
  } });
};

test('outdoors: a loud room is named, an unsure answer is never marked wrong, and typing it instead is checked', async ({ page }) => {
  await page.addInitScript(fakeRecogniser);
  await page.addInitScript(fakeMic);
  await seed(page, { veteran: true, examInDays: null });
  await open(page, '#/practice/situations/round?pick=mixed');
  const card = page.locator('.sim-card');
  await card.getByRole('button', { name: 'Check with the mic' }).click();
  const answer = String(await card.locator('.sim-you .sim-line').textContent());
  // a street: about -26 dBFS; the phone hears something else, unsure of it
  await page.evaluate(() => { const w = /** @type {any} */ (window); w.__amp = 0.05; w.__heard = 'Mittwoch nicht Freitag'; w.__conf = 0.9; });
  await card.getByRole('button', { name: 'Say your answer' }).click();
  await expect(card.locator('.pr-mic-l')).toContainText('checking how loud it is');
  await expect(card.locator('.pr-meter')).toBeVisible();
  await expect(card.locator('.pr-loud')).toHaveText("It's loud here. Hold the phone closer, or type instead.");
  const unsure = card.locator('.pr-unsure');
  await expect(unsure).toContainText('Mittwoch nicht Freitag');
  await expect(unsure.locator('.pr-checks')).toContainText('Not sure');
  await expect(unsure.locator('.pr-checks')).not.toContainText('Wrong');
  await expect(card.locator('.sim-reveal.is-open')).toHaveCount(0);
  await expect(card.locator('.pr-meter')).toBeHidden();
  await checkA11y(page, 'situation, unsure in a loud room');
  // hold to talk is offered; that's not what I said: try again or type
  await expect(card.getByRole('button', { name: 'Hold to talk' })).toHaveClass(/is-offered/);
  await unsure.getByRole('button', { name: "That's not what I said" }).click();
  await expect(unsure.getByRole('button', { name: 'Try again' })).toBeVisible();
  await unsure.getByRole('button', { name: 'Type instead' }).click();
  await card.getByRole('textbox', { name: 'Your answer' }).fill(answer);
  await card.getByRole('button', { name: 'Check', exact: true }).click();
  await expect(card.locator('.sim-heard')).toContainText('You typed:');
  await expect(card.locator('.sim-heard .pr-checks')).toContainText('Right');
  await expect(page.locator('.grade4-b.is-suggested')).toHaveAttribute('data-g', '3');
  await page.locator('.grade4-b.is-suggested').click();
  // the attempts are logged on this device (kv speech.log, device scope): numbers and flags only, no words
  await expect.poll(() => page.evaluate(() => new Promise((resolve, reject) => {
    const r = indexedDB.open('fluentish');
    r.onerror = () => reject(r.error);
    r.onsuccess = () => {
      const q = r.result.transaction('kv').objectStore('kv').get(['device', 'speech.log']);
      q.onsuccess = () => { r.result.close(); resolve(q.result || null); };
      q.onerror = () => reject(q.error);
    };
  }))).not.toBeNull();
  const log = /** @type {any} */ (await page.evaluate(() => new Promise(resolve => {
    const r = indexedDB.open('fluentish');
    r.onsuccess = () => { const q = r.result.transaction('kv').objectStore('kv').get(['device', 'speech.log']); q.onsuccess = () => { r.result.close(); resolve(q.result); }; };
  })));
  const [heard, misheard, typed] = log.entries;
  expect(heard).toMatchObject({ where: 'sim', noisy: true, unsure: true, why: ['noise'], conf: 0.9 });
  expect(heard.db).toBeGreaterThan(-30);
  expect(misheard.misheard).toBe(true);
  expect(typed.typed).toBe(true);
  expect(JSON.stringify(log)).not.toContain('Mittwoch');
});

test('outdoors: low confidence in a quiet room is unsure too; Show answer leaves the grade to him', async ({ page }) => {
  await page.addInitScript(fakeRecogniser);
  await page.addInitScript(fakeMic);
  await seed(page, { veteran: true, examInDays: null });
  await open(page, '#/practice/situations/round?pick=mixed');
  const card = page.locator('.sim-card');
  await card.getByRole('button', { name: 'Check with the mic' }).click();
  await page.evaluate(() => { const w = /** @type {any} */ (window); w.__amp = 0.001; w.__heard = 'Ich habe heute leider keine Zeit, vielleicht morgen.'; w.__conf = 0.2; });
  await card.getByRole('button', { name: 'Say your answer' }).click();
  await expect(card.locator('.pr-unsure .pr-checks')).toContainText('Not sure');
  await expect(card.locator('.pr-loud')).toBeHidden();
  await page.getByRole('button', { name: /^Show answer/ }).click();
  await expect(card.locator('.sim-heard')).toContainText('Not checked. Grade it yourself.');
  await expect(page.locator('.grade4-b.is-suggested')).toHaveAttribute('data-g', '3');
});

test('a clear answer heard wrongly: "That\'s not what I said" sets the check aside and suggests Good', async ({ page }) => {
  await page.addInitScript(fakeRecogniser);
  await page.addInitScript(fakeMic);
  await seed(page, { veteran: true, examInDays: null });
  await open(page, '#/practice/situations/round?pick=mixed');
  const card = page.locator('.sim-card');
  await card.getByRole('button', { name: 'Check with the mic' }).click();
  await page.evaluate(() => { const w = /** @type {any} */ (window); w.__heard = 'Ich habe heute leider keine Zeit, vielleicht morgen.'; w.__conf = 0.95; });
  await card.getByRole('button', { name: 'Say your answer' }).click();
  await expect(card.locator('.sim-heard .pr-checks')).toContainText('Wrong');
  await expect(page.locator('.grade4-b.is-suggested')).toHaveAttribute('data-g', '1');
  await card.locator('.sim-heard').getByRole('button', { name: "That's not what I said" }).click();
  await expect(card.locator('.sim-heard .pr-checks')).toHaveCount(0);
  await expect(card.locator('.sim-heard')).toContainText('Not checked. Grade it yourself.');
  await expect(page.locator('.grade4-b.is-suggested')).toHaveAttribute('data-g', '3');
});

test('Say it aloud folded into Sprechen: its old routes open the situations, the mic check stays', async ({ page }) => {
  await page.addInitScript(fakeRecogniser);
  await seed(page, { veteran: true, examInDays: null });
  await open(page, '#/practice/speak');
  await expect(page.locator('#view')).not.toContainText('Say it aloud');
  await expect(page.locator('a[href="#/practice/situations"]')).toBeVisible();
  await expect(page.locator('a[href="#/practice/speak/aloud/check"]')).toBeVisible();
  await checkA11y(page, 'Sprechen');
  for (const old of ['#/practice/speak/aloud', '#/practice/speak/aloud/go', '#b1/aloud']) {
    await open(page, old);
    await expect(page).toHaveURL(/#\/practice\/situations$/);
    await expect(page.locator('#view h1')).toHaveText('Speaking situations');
  }
  await open(page, '#/practice/speak/aloud/check');
  await expect(page.locator('#view h1')).toHaveText('Mic check');
});

test('I know this on a situation asks Check by typing first: a miss marks nothing, the chunk typed right marks it known', async ({ page }) => {
  await seed(page, { veteran: true, examInDays: null });
  await open(page, '#/practice/situations/round?pick=mixed');
  const card = page.locator('.sim-card');
  await expect(card).toBeVisible();
  await page.getByRole('button', { name: /^I know this/ }).click();
  const panel = page.locator('.pr-typecheck');
  await expect(panel).toBeVisible();
  const input = panel.locator('textarea');
  await expect(input).toBeFocused();
  await checkA11y(page, 'situation, Check by typing');
  await input.fill('Das weiß ich nicht.');
  await input.press('Enter');
  await expect(panel).toContainText('Not marked');
  expect(await storedCards(page, 'speak')).toEqual({});
  await panel.getByRole('button', { name: /^Go on/ }).click();
  await expect(panel).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Show answer/ })).toBeVisible();
  // again, typed right: the chunk of the model answer
  const chunk = String(await card.locator('.sim-you .sim-chunk').textContent());
  await page.getByRole('button', { name: /^I know this/ }).click();
  await page.locator('.pr-typecheck textarea').fill(chunk);
  await page.locator('.pr-typecheck textarea').press('Enter');
  await expect.poll(async () => Object.values(await storedCards(page, 'speak')).filter(r => r.known).length).toBe(1);
});
