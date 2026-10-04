// Item ids and the mistakes API (src/domain/itemids.js, src/data/mistakes.js). Synthetic data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tagOf, kindOf, wordId, mistakeId, slug } from '../../src/domain/itemids.js';
import { planMistakes, addMistakes, listMistakes, removeMistake, COLLECTION } from '../../src/data/mistakes.js';

test('item ids: every kind is tagged in its id', () => {
  assert.equal(tagOf('BP:s1-wir-sollen-ja-planen'), 'BP');
  assert.deepEqual(kindOf('BG:verb-final.03'), { tag: 'BG', kind: 'grammar', area: 'grammar' });
  assert.equal(kindOf('K:ENG_CHUNK_0001').kind, 'phrase');
  assert.equal(kindOf('W:tisch.noun').area, 'words');
  assert.equal(kindOf('F:0192-1').kind, 'mistake');
  assert.equal(kindOf('nonsense'), null);
  assert.equal(kindOf('ZZ:x'), null);
  assert.equal(slug('Größe Übung'), 'groesse-uebung');
  assert.equal(wordId('Tisch', { tisch: ['tisch.noun', 'A1'] }), 'W:tisch.noun');
  assert.equal(wordId('Nachbarschaft', {}), 'BW:nachbarschaft');
  assert.equal(mistakeId('abc', 2), 'F:abc-2');
});

test('mistakes: add, re-correct, remove', () => {
  const now = '2026-10-03T10:00:00.000Z';
  const items = [{ wrong: 'weil ich habe keine Zeit', right: 'weil ich keine Zeit habe', rule: 'Verb at the end after weil.' },
    { wrong: 'same', right: 'same' }, { wrong: '', right: 'x' }, { wrong: 'Ich freue mich für das Treffen.', right: 'Ich freue mich auf das Treffen.' }];
  const a = planMistakes({}, { attemptId: 'att-1', test: 2, module: 'schreiben', label: 'Test 2 · Schreiben', items }, now);
  assert.deepEqual(a.added, ['F:att-1-1', 'F:att-1-2'], 'empty and unchanged sentences are skipped');
  assert.equal(a.next['F:att-1-1'].source.test, 2);
  // a re-correction keeps the unchanged pair's id, drops the one that is gone, numbers the new one after the old ones
  const b = planMistakes(a.next, { attemptId: 'att-1', items: [items[0], { wrong: 'Er kommt morgen nicht.', right: 'Er kommt morgen nicht mit.' }] }, now);
  assert.deepEqual(b.added, ['F:att-1-3']);
  assert.equal(b.next['F:att-1-2'].deletedAt, now);
  assert.equal(b.next['F:att-1-1'].deletedAt, null);
  // through a store
  /** @type {Record<string, any>} */ const kv = {};
  const store = { get: (/** @type {string} */ n, /** @type {any} */ f) => (n in kv ? kv[n] : f), set: (/** @type {string} */ n, /** @type {any} */ v) => { kv[n] = v; } };
  assert.deepEqual(addMistakes(store, { attemptId: 'x', items: [{ wrong: 'a b', right: 'a c' }] }), ['F:x-1']);
  assert.equal(listMistakes(store).length, 1);
  assert.equal(removeMistake(store, 'F:x-1'), true);
  assert.equal(removeMistake(store, 'F:x-1'), false);
  assert.equal(listMistakes(store).length, 0);
  assert.ok(kv[COLLECTION]['F:x-1'], 'removed records stay as tombstones');
  assert.throws(() => planMistakes({}, /** @type {any} */ ({ items: [] }), now));
});
