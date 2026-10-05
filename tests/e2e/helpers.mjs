// Steps several specs share. Not a spec itself.
import { expect } from './fixtures.mjs';

/**
 * Answer the current typed card and move on. A new item shows its answer (Show me) and is typed once; a card seen
 * before is typed from memory (the answers this test has seen); an unknown one is answered wrong first, and its right
 * answer is remembered from the feedback. Returns false when the round is over.
 * @param {import('@playwright/test').Page} page @param {Map<string, string>} known prompt → answer
 */
export async function answerCard(page, known) {
  const done = page.locator('.pr-done');
  await expect(page.locator('.pr-card').or(done).first()).toBeVisible();
  if (await done.count()) return false;
  const primary = page.locator('.pr-primary');
  await expect(primary).toHaveText(/^Check/);
  const move = page.locator('.pr-move').first();
  if (await move.isVisible()) await move.click();
  const prompt = (await page.locator('.pr-promptbox .prompt').first().innerText()).trim();
  const keyText = async () => String(await page.locator('.pr-fb .answer-key').first().textContent()).replace(/\s+/g, ' ').replace(/^\s*(The right answer|Right)\s*:?\s*/i, '').trim();
  const shown = page.locator('.pr-fb .answer-key').first();
  if (!known.has(prompt) && await shown.isVisible()) known.set(prompt, await keyText());   // a wrong try showed it
  const showMe = page.getByRole('button', { name: 'Show me' });
  if (!known.has(prompt) && await showMe.isVisible()) {
    await showMe.click();
    await expect(page.locator('.pr-fb .answer-key').first()).toBeVisible();
    known.set(prompt, await keyText());
  }
  await page.locator('#pr-input').fill(known.get(prompt) || 'weiß ich nicht');
  await primary.click();   // Check
  await expect(primary.or(done).first()).toBeVisible();
  if (await done.count()) return false;
  if (/^Next/.test(await primary.innerText())) {
    if (!known.has(prompt) && await page.locator('.pr-fb .answer-key').count()) known.set(prompt, await keyText());
    await primary.click();
  }
  return true;
}
