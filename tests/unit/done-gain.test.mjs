// Round 8 fix pass (UX review S1, S2): the done screen's "+N" and its "last one" line stay honest.
// "+N" counts only the items right first time, the new items studied and the items marked as known: a miss lapses
// only from the next study day (domain/knowledge.js), so a missed item counted tonight would drop out tomorrow.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as S from '../../src/features/shared/session.js';

const res = (id, o) => ({ id, first: true, ok: true, ...o });
const byId = new Map(['a', 'b', 'c', 'd', 'e', 'n1', 'n2'].map(id => [id, { id, model: id }]));

test('"+N" leaves out the items missed first time and keeps right, new and known items', () => {
  const round = { results: [
    res('a'), res('b', { ok: false }), res('c'), res('d', { ok: false }), res('e', { known: true }),
    res('n1', { isNew: true, study: true, ok: false }), res('n1', { first: false, isNew: true }),
    res('b', { first: false }), res('d', { first: false }),
  ] };
  const ids = ['a', 'b', 'c', 'd', 'e', 'n1', 'n2', 'z'];
  assert.deepEqual(S.gainIds(round, ids), ['a', 'c', 'e', 'n1', 'n2', 'z']);
  // the review's repro: 5 due, 2 missed, 4 new; everything counts as known tonight, the misses stop tomorrow
  const before = new Set(), tonight = new Set(['a', 'b', 'c', 'd', 'e', 'n1']), tomorrow = new Set(['a', 'c', 'e', 'n1']);
  const delta = (/** @type {Set<string>} */ after) => S.gainIds(round, ids).filter(id => after.has(id)).length - S.gainIds(round, ids).filter(id => before.has(id)).length;
  assert.equal(delta(tonight), 4);
  assert.equal(delta(tonight), delta(tomorrow), '"+N" does not drop overnight');
});

test('the done screen counts "+N" over gainIds, and the known total over every item', () => {
  const s = readFileSync(new URL('../../src/features/practice-round/round.js', import.meta.url), 'utf8');
  const fn = /function doneTimeline[\s\S]*?\n\}\n/.exec(s)[0];
  assert.match(fn, /const counted = S\.gainIds\(round, ids\);\s*counts = \{ nb: known\(kb, counted\), na: known\(ka, counted\) \};/);
  assert.match(fn, /knownNow', \{ a: known\(ka, ids\)/);
});

test('"The last one was right this time." only after a real fix, never after a new item\'s second pass', () => {
  const perfect = { results: [res('a'), res('c'), res('n1', { isNew: true, study: true, ok: false }), res('n1', { first: false, isNew: true })] };
  assert.equal(S.summary(perfect, byId).fixedLast, false);
  assert.equal(S.summary(perfect, byId).right, 2);
  const fixed = { results: [res('a'), res('b', { ok: false }), res('b', { first: false })] };
  assert.equal(S.summary(fixed, byId).fixedLast, true);
  const stillWrong = { results: [res('b', { ok: false }), res('b', { first: false, ok: false })] };
  assert.equal(S.summary(stillWrong, byId).fixedLast, false);
});
