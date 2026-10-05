// Practice was split into sibling features (round 3): every route it had still resolves to the feature that owns it
// now. The list is tests/fixtures/practice-routes.mjs (the e2e spec
// tests/e2e/routes.spec.mjs opens the same list in the browser and checks each view mounts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHash, matchRoute } from '../../src/core/router.js';
import { FEATURES, routes } from '../../src/features/registry.js';
import { PRACTICE_ROUTES } from '../fixtures/practice-routes.mjs';

test('every old Practice route resolves to the feature that owns it now', () => {
  const table = routes();
  for (const [hash, feature] of PRACTICE_ROUTES) {
    const { path, query } = parseHash(hash);
    const hit = matchRoute(table, path, query);
    assert.ok(hit, `${hash} resolves`);
    assert.equal(/** @type {any} */ (hit.route).feature, feature, `${hash} belongs to ${feature}`);
  }
});

test('a query-narrowed route matches only with its query: a script words round, and every other round', () => {
  const table = routes();
  const at = (/** @type {string} */ h) => { const { path, query } = parseHash(h); return /** @type {any} */ (matchRoute(table, path, query)?.route).feature; };
  assert.equal(at('#/practice/round?kind=script:abc'), 'practice-script');
  assert.equal(at('#/practice/round?kind=scripted'), 'practice-round', 'only kind=script:<id> goes to the scripts');
  assert.equal(at('#/practice/round'), 'practice-round');
  assert.equal(matchRoute(table, '/practice/round').route.path, '/practice/round', 'no query is an empty query');
});

test('every Practice feature is registered once, on the Practice tab, with a view', () => {
  const ids = FEATURES.map(f => f.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ['practice', 'practice-round', 'practice-write', 'practice-speak', 'practice-script', 'practice-clusters', 'build']) {
    const f = FEATURES.find(x => x.id === id);
    assert.ok(f, id);
    assert.equal(f.tab, 'practice');
  }
});
