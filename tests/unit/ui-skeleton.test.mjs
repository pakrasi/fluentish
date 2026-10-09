// ui/skeleton.js (round 8, design C §8): the blocks of each shape (pure). The wait and the sweep are CSS; the browser
// side (nothing for a fast load, blocks then a band for a slow one) is in tests/e2e/toast.spec.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { skelPlan } from '../../src/ui/skeleton.js';

test('rows: a title and a detail line per row, widths varied, count kept within 1..8', () => {
  const p = skelPlan('rows', 3);
  assert.equal(p.length, 3);
  for (const g of p) assert.deepEqual(g.map(b => b.kind), ['title', 'line']);
  assert.notEqual(p[0][0].w, p[1][0].w);
  assert.equal(skelPlan('rows').length, 4, 'four rows by default');
  assert.equal(skelPlan('rows', 50).length, 8);
  assert.equal(skelPlan('rows', 0).length, 4);
  assert.equal(skelPlan('rows', -2).length, 1);
});

test('card, tiles, chart', () => {
  assert.deepEqual(skelPlan('card', 2).map(g => g.map(b => b.kind)), [['card', 'line'], ['card', 'line']]);
  const tiles = skelPlan('tiles', 9);
  assert.equal(tiles.length, 1, 'one grid');
  assert.equal(tiles[0].length, 9);
  assert.equal(skelPlan('tiles')[0].length, 12);
  assert.equal(skelPlan('tiles', 100)[0].length, 24);
  assert.deepEqual(skelPlan('chart').map(g => g.map(b => b.kind)), [['line', 'chart']]);
  assert.deepEqual(skelPlan(/** @type {any} */ ('nope'), 2).map(g => g.length), [2, 2], 'an unknown shape is rows');
});
