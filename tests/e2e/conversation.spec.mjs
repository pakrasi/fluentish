// Conversation practice (round 4, lane L4): setup, a streamed conversation from a mocked api.anthropic.com (canned
// server-sent events), a correction ("You wrote"), a word's gloss from the word list, Slower, End, the feedback card,
// two mistakes added as cards. And the privacy gate in the browser: a sentinel he types reaches only api.anthropic.com,
// never localStorage, never the GitHub mock. axe on every screen. Synthetic data only.
import { test, expect, seed, open, checkA11y } from './fixtures.mjs';
import { sse } from '../fixtures/conversation-sse.mjs';

const KEY = 'e2e-fake-claude-key-0001';
const SENTINEL = 'Quorxelbrandt';
const OPENING = 'Hallo! Schön, dass du da bist. Heute geht es um Kunst und Museen. Warst du in letzter Zeit in einer Ausstellung?';
const TURN1 = 'Ja! Am Samstag ich bin in eine Ausstellung gegangen. Es war über Roboter.';
const REPLY1 = 'Oh, <r was="Am Samstag ich bin">am Samstag bist du</r> in eine Ausstellung gegangen? Roboter und Kunst, das klingt spannend. Was hast du dort gesehen?';
const TURN2 = `Ein Künstler hat ein Roboter gebaut, der malt Bilder. Ich war sehr überrascht. Er heißt ${SENTINEL}.`;
const REPLY2 = 'Moment, er hat einen Roboter gebaut, der Bilder malt? Das finde ich ja verrückt. Was für Bilder malt er denn?';
const FEEDBACK = {
  summary: 'You told a short story about an exhibition and kept the conversation going. Work on the verb position after a time phrase and in relative clauses.',
  mistakes: [
    { turn: 1, wrong: 'Am Samstag ich bin in eine Ausstellung gegangen.', right: 'Am Samstag bin ich in eine Ausstellung gegangen.', rule: 'The verb comes second: after a time phrase, the subject follows the verb.', pattern: 'verb-second', severity: 'grammar' },
    { turn: 3, wrong: 'Ein Künstler hat ein Roboter gebaut, der malt Bilder.', right: 'Ein Künstler hat einen Roboter gebaut, der Bilder malt.', rule: 'Roboter is masculine and the object: einen. In a relative clause the verb goes to the end.', pattern: 'case', severity: 'grammar' },
    { turn: 3, wrong: 'Ich war sehr überrascht.', right: 'Das hat mich sehr überrascht.', rule: 'Both are right; this is the more usual way to say it.', pattern: 'other', severity: 'style' },
    { turn: 3, wrong: 'Er hat nie Bilder gemalt.', right: 'x', rule: 'not his', pattern: 'other', severity: 'grammar' },
  ],
  better_phrases: [{ turn: 1, said: 'Es war über Roboter.', better: 'Es ging um Roboter.', why: 'The usual way to say what something is about.' }],
  used_well: [{ turn: 1, text: 'Ja!', why: 'A natural short answer.' }],
};

test('conversation: setup, a streamed chat with a correction and a gloss, Slower, feedback, two cards', async ({ page, claude, gh }) => {
  await seed(page, { veteran: true, examInDays: null, kv: { secrets: { anthropicKey: KEY, githubToken: null } } });
  await open(page, '#/practice');
  await page.getByRole('link', { name: /^Conversation/ }).click();
  await expect(page.locator('#view h1')).toHaveText('Conversation');
  await expect(page.locator('.cv-choice').first()).toBeVisible();
  await expect(page.locator('.cv-month')).toContainText('This month: $0.00 of your $3.00 limit.');
  await checkA11y(page, 'Conversation › setup');
  // What is sent
  await page.getByRole('button', { name: 'What is sent' }).click();
  const sent = page.locator('dialog.tv-sheet');
  await expect(sent).toContainText('Sent to Anthropic, with your key');
  await expect(sent).toContainText('Never sent');
  await checkA11y(page, 'Conversation › what is sent');
  await sent.getByRole('button', { name: 'Close' }).click();
  await expect(sent).toHaveCount(0);
  // role-play lists the scenes
  await page.getByRole('radio', { name: 'Role-play' }).or(page.getByRole('button', { name: 'Role-play' })).first().click();
  await expect(page.locator('.cv-choice')).toHaveCount(11);
  await page.getByRole('radio', { name: 'Free chat' }).or(page.getByRole('button', { name: 'Free chat' })).first().click();

  // start: the opening streams in
  claude.replies.push({ sse: sse(OPENING) }, { sse: sse(REPLY1, { usage: { cacheRead: 1200 } }) }, { sse: sse(REPLY2) },
    { id: 'msg_fb', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '', signature: 'x' }, { type: 'text', text: JSON.stringify(FEEDBACK) }],
      usage: { input_tokens: 2400, output_tokens: 900, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } });
  await page.getByRole('button', { name: /^Start · about \$0\.10$/ }).click();
  await expect(page.locator('.cv-them .cv-line').first()).toHaveText(OPENING);
  await expect(page.locator('body')).toHaveAttribute('data-chrome', 'off');
  const first = claude.calls[0];
  expect(first.model).toBe('claude-sonnet-5-5');
  expect(first.stream).toBe(true);
  expect(first.output_config).toEqual({ effort: 'low' });
  expect(first.system[1].cache_control).toEqual({ type: 'ephemeral' });
  expect(first.messages).toEqual([{ role: 'user', content: '<start/>' }]);
  expect(JSON.stringify(first.system)).toContain('Topic: ');
  await checkA11y(page, 'Conversation › chat');

  // his first message; the reply picks up his mistake
  const field = page.getByRole('textbox', { name: 'Your message in German' });
  await field.fill(TURN1);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.locator('.cv-you .cv-line').first()).toHaveText(TURN1);
  const recast = page.locator('.cv-recast');
  await expect(recast).toHaveText('am Samstag bist du');
  await expect(page.locator('.cv-them .cv-line').nth(1)).toContainText('Oh, am Samstag bist du in eine Ausstellung gegangen?');
  await expect(page.locator('.cv-them .cv-line').nth(1)).not.toContainText('<r');
  await recast.click();
  await expect(page.locator('.cv-note')).toContainText('You wrote: „Am Samstag ich bin“');
  await expect(recast).toHaveAttribute('aria-expanded', 'true');
  // history: the second request is the first one plus his message, the opening reply kept as it came (thinking block too)
  const second = claude.calls[1];
  expect(second.messages.slice(0, 1)).toEqual(first.messages);
  expect(second.messages[1].role).toBe('assistant');
  expect(second.messages[1].content[0]).toEqual({ type: 'thinking', thinking: '', signature: 'c2lnLWUyZQ==' });
  expect(second.messages[2]).toEqual({ role: 'user', content: TURN1 });
  expect(second.system).toEqual(first.system);

  // a word of the reply: its gloss from the word list
  await page.locator('.cv-them .cv-w', { hasText: /^Ausstellung$/ }).first().click();
  const gloss = page.locator('dialog.tv-sheet');
  await expect(gloss.locator('.tv-sheet-title')).toContainText('Ausstellung');
  await expect(gloss).toContainText('From the word list on this device.');
  await checkA11y(page, 'Conversation › gloss');
  await gloss.getByRole('button', { name: 'Close' }).click();
  await expect(gloss).toHaveCount(0);

  // Slower: a system message goes after his next message, the cached history is untouched
  await page.getByRole('button', { name: 'Slower', exact: true }).click();
  await expect(page.locator('.cv-meta')).toContainText('Claude speaks B1');
  await field.fill(TURN2);
  await field.press('Enter');
  await expect(page.locator('.cv-them .cv-line').nth(2)).toHaveText(REPLY2);
  const third = claude.calls[2];
  expect(third.messages.slice(0, second.messages.length)).toEqual(second.messages);
  expect(third.messages.slice(-2)).toEqual([{ role: 'user', content: TURN2 }, { role: 'system', content: 'From now on speak at B1: shorter sentences and more common words.' }]);
  await expect(page.locator('.cv-meta')).toContainText('2 of 30 messages');

  // End: the feedback card
  await page.getByRole('button', { name: 'End', exact: true }).click();
  await expect(page.locator('#view h1')).toHaveText(/minute(s)? in German/);
  const fb = claude.calls[3];
  expect(fb.model).toBe('claude-opus-5-5');
  expect(fb.output_config.format.type).toBe('json_schema');
  expect(fb.messages[0].content).toContain('<turn i="1" who="learner" input="typed">');
  await expect(page.locator('.cv-item .cv-wrong')).toHaveCount(3, { timeout: 10000 });   // the one not copied from his turn is dropped
  await expect(page.locator('.cv-sec').first()).toContainText('Correct, but less natural. Not a card.');
  await expect(page.getByRole('checkbox')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Add 2 cards and finish' })).toBeVisible();
  await expect(page.locator('.cv-cost')).toContainText('This conversation cost about $');
  await checkA11y(page, 'Conversation › feedback');
  await page.getByRole('button', { name: 'Add 2 cards and finish' }).click();
  await expect(page.locator('#view h1')).toHaveText('Practice');

  const mistakes = await kv(page, 'mistakes');
  const ids = Object.keys(mistakes || {});
  expect(ids).toHaveLength(2);
  for (const id of ids) expect(id).toMatch(/^F:C-[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}-\d$/);
  expect(Object.values(mistakes).every((/** @type {any} */ m) => m.source.module === 'conversation' && m.source.label === 'Conversation · Kunst und Museen' || m.source.module === 'conversation')).toBe(true);

  // privacy: the sentinel he typed went only to Anthropic; never to local storage, the GitHub mock or the sessions record
  const sessions = await kv(page, 'conv.sessions');
  expect(JSON.stringify(sessions)).not.toContain(SENTINEL);
  expect(JSON.stringify(sessions)).not.toContain('Kunst');
  expect(await page.evaluate(() => JSON.stringify(Object.entries(localStorage)))).not.toContain(SENTINEL);
  expect([...gh.files.values()].some(b64 => Buffer.from(b64, 'base64').toString('utf8').includes(SENTINEL))).toBe(false);
  expect(claude.calls.filter(c => JSON.stringify(c).includes(SENTINEL)).length).toBe(2);   // the third turn and the feedback
});

test('conversation: no key, the setup says so and Start is off', async ({ page }) => {
  await seed(page, { veteran: true, examInDays: null });
  await open(page, '#/practice/conversation');
  await expect(page.locator('#view')).toContainText('Conversation needs a Claude key.');
  await expect(page.getByRole('button', { name: /^Start/ })).toBeDisabled();
});

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
