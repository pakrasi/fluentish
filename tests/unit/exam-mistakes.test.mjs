// Exam → Practice: "Practise these mistakes" writes through data/mistakes.js (kv 'mistakes', ids 'F:<attempt>-<n>'),
// the same records Practice turns into round items. Synthetic data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { queueMistakes, mistakesQueued } from '../../src/features/exam/data.js';
import { mistakeItem } from '../../src/features/shared/pool.js';
import { COLLECTION } from '../../src/data/mistakes.js';

const memStore = () => { const kv = new Map(); return { get: (n, f) => kv.has(n) ? kv.get(n) : f, set: (n, v) => kv.set(n, v), kv }; };
const fb = body => ({ id: 'fb', body });
const A = '~~Ich habe gegeht.~~ → ==Ich bin gegangen.==\n_Perfekt mit sein_';
const B = '~~weil ich habe Zeit~~ → ==weil ich Zeit habe==\n_Verb ans Ende_';

test('corrections from every current feedback entry become F: mistakes, once', () => {
  const store = memStore();
  const attempt = { id: '0192abc', day: 3, module: 'schreiben' };
  assert.equal(mistakesQueued(store, attempt), 0);
  assert.equal(queueMistakes(store, { attempt, feedback: [fb(A), fb(B)] }), 2);
  assert.equal(queueMistakes(store, { attempt, feedback: [fb(A), fb(B)] }), 2);   // pressing twice adds nothing
  const recs = Object.values(store.get(COLLECTION));
  assert.deepEqual(recs.map(r => r.id).sort(), ['F:0192abc-1', 'F:0192abc-2']);
  assert.equal(store.get('mistakes.inbox', null), null);
  const item = mistakeItem(recs.find(r => r.id === 'F:0192abc-1'));
  assert.equal(item.prompt, 'Ich habe gegeht.');
  assert.deepEqual(item.accept, ['Ich bin gegangen.']);
  assert.equal(item.source, 'Schreiben Test 3');
  assert.equal(mistakeItem({ ...recs[0], source: { ...recs[0].source, module: 'hoeren' } }).source, 'Hören Test 3');
});
