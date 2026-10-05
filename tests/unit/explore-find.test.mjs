// Explore search (src/features/explore/data.js): umlauts and ß fold, German prefixes first, then German anywhere, then English.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fold, find } from '../../src/features/explore/data.js';

test('fold drops accents and writes ß as ss', () => {
  assert.equal(fold('Größe'), 'grosse');
  assert.equal(fold('Übung'), 'ubung');
});

test('find ranks a German prefix before German inside a word before English', () => {
  const texts = ['der Unfall', 'der Zufall', 'fremd', 'die Fallhöhe'];
  const en = ['accident', 'chance', 'unfamiliar', 'height of fall'];
  const A = { n: texts.length, F: new Float32Array([4, 4, 5, 2]) };
  const folded = texts.map(fold), english = en.map(fold);
  assert.deepEqual(find(A, folded, english, 'fall'), [3, 0, 1]);
  assert.deepEqual(find(A, folded, english, 'unfa'), [0, 2]);
  assert.deepEqual(find(A, folded, english, 'Fallhohe'), [3]);
  assert.deepEqual(find(A, folded, english, '  '), []);
});
