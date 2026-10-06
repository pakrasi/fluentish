// The German B2 layer (round 4, L3; tools/b2.mjs): content agrees with the reviewed batches in authoring/de/b2, every
// B2-layer entry is stamped, the machine gates pass (every accepted answer right, no detector on a model sentence, every
// near miss wrong, the corpus's generated errors never right), and nothing of it reaches the B1 pool (PLAN-REVIEW B7).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { applyAll, gates, stampErrors, ROOT, FILES } from '../../tools/b2.mjs';
import { buildPool } from '../../src/features/shared/pool.js';

const J = (/** @type {string} */ p) => JSON.parse(readFileSync(path.join(ROOT, p), 'utf8'));

test('B2 layer: content is what the reviewed batches build', () => {
  for (const [p, text] of Object.entries(applyAll())) assert.equal(readFileSync(path.join(ROOT, p), 'utf8'), text, `${p} is out of date: node tools/b2.mjs apply`);
});

test('B2 layer: every batch reviewed, every B2-layer entry stamped', () => {
  assert.deepEqual(stampErrors(), []);
});

test('B2 layer: machine gates (grader, detectors, near misses, generated errors)', async () => {
  const { problems, counts } = await gates();
  assert.deepEqual(problems.map(p => `${p.cls} ${p.id}: ${p.text} (${p.why})`), []);
  assert.ok(counts.items >= 96 && counts.rights > counts.items, `gates ran over ${counts.items} items`);
});

test('B2 layer: never in the B1 pool, never written into the B1 trainer', () => {
  const files = applyAll();
  assert.ok(!Object.keys(files).some(p => p.startsWith('content/b1/')), 'tools/b2.mjs writes no B1 trainer file');
  const data = buildPool({ items: J('content/b1/items.json'), grammar: J('content/b1/grammar.json'), bank: J('content/b1/bank.json'), plan: J('content/b1/plan.json'),
    nouns: J('content/b1/nouns.json'), schreiben: J('content/b1/schreiben.json') });
  const ids = new Set(data.pool.map((/** @type {any} */ it) => it.id));
  const layerItems = J(FILES.items).filter((/** @type {any} */ x) => x.layer === 'b2').map((/** @type {any} */ x) => `G:${x.id}`);
  const layerPhrases = Object.entries(J(FILES.german).chunks).filter(([, c]) => /** @type {any} */ (c).layer === 'b2').map(([id]) => `K:${id}`);
  assert.ok(layerItems.length && layerPhrases.length);
  assert.deepEqual([...layerItems, ...layerPhrases].filter(id => ids.has(id)), [], 'a B2-layer id is in the B1 pool');
  // the B1 trainer's B2 items (je … desto, two-part connectors) stay outside the layer
  const items = new Map(J(FILES.items).map((/** @type {any} */ x) => [x.id, x]));
  for (const g of J('content/b1/grammar.json')) assert.notEqual(items.get(g.id)?.layer, 'b2', g.id);
});
