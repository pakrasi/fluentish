// A round of items picked on the Explore map (phrases, grammar): #/practice/round?kind=pick:<id>,<id>…
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseKind } from '../../src/features/practice/compose.js';
import { slotKey, roundHref } from '../../src/features/practice/session.js';

test('kind=pick: keeps its ids, has its own slot and comes back to the same address', () => {
  const k = parseKind('pick:K:ENG_CHUNK_0001,BP:s1-x,G:akkusativ.01');
  assert.deepEqual(k, { kind: 'pick', topic: 'K:ENG_CHUNK_0001,BP:s1-x,G:akkusativ.01' });
  assert.equal(slotKey(k), 'pick:K:ENG_CHUNK_0001,BP:s1-x,G:akkusativ.01');
  assert.equal(decodeURIComponent(roundHref(k).split('kind=')[1]), 'pick:K:ENG_CHUNK_0001,BP:s1-x,G:akkusativ.01');
  // other kinds are unchanged
  assert.deepEqual(parseKind('topic:verb-final'), { kind: 'topic', area: 'grammar', topic: 'verb-final' });
  assert.deepEqual(parseKind('nonsense'), { kind: 'today' });
});
