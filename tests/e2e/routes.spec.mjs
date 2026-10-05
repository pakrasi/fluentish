// Practice was split into sibling features (round 3). Every route it had still opens a page in the browser: the
// view module loads, mounts and draws its heading, and nothing falls back to "No such page" or the error view. The
// list (with the feature that owns each route now) is tests/fixtures/practice-routes.mjs; the unit test
// tests/unit/practice-routes.test.mjs checks the registry matches it.
import { test, expect, seed, open, settle } from './fixtures.mjs';
import { PRACTICE_ROUTES } from '../fixtures/practice-routes.mjs';

test('every old Practice route still opens its page', async ({ page }) => {
  test.setTimeout(180_000);
  await seed(page, { veteran: true });
  for (const [hash] of PRACTICE_ROUTES) {
    await open(page, hash);
    const h1 = page.locator('#view h1').first();
    await expect(h1, hash).toBeVisible();
    await expect(h1, `${hash} is not a missing page`).not.toHaveText(/No such page|Something went wrong/);
    await settle(page);
  }
});
