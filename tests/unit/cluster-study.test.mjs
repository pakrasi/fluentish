// Cluster study (features/shared/cluster-items.js): cards from ids, round composition, and grading of every
// cluster card through Practice's grader. Wrong articles, wrong preposition forms and the other word of a pair must
// never come back as right (the grading corpus rule, applied to the cluster cards).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { index } from '../../src/domain/clusters.js';
import { cardIds, itemFor, compose, parseClusterKind, form } from '../../src/features/shared/cluster-items.js';
import { gradeAnswer } from '../../src/features/shared/grade.js';
import { buildLexicon } from '../../src/features/shared/pool.js';

const read = p => JSON.parse(readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8'));
const C = read('content/clusters/de.json');
const words = read('content/igloo/words/de.json');
const ix = index(C, words);
const t = (k, v) => `${k}${v ? JSON.stringify(v) : ''}`;
const nouns = read('content/b1/nouns.json');
const lexicon = buildLexicon({ nouns, lexWords: words });
const grade = (it, s) => gradeAnswer(it, s, null, { nouns, lexicon });

test('every card of every cluster builds an item, and its own model is graded right', () => {
  let n = 0;
  for (const cl of ix.all) for (const id of cardIds(cl, ix)) {
    const it = itemFor(id, ix, C, { t });
    assert.ok(it, id);
    assert.ok(it.accept.length && it.model, id);
    const g = grade(it, it.gap ? it.accept[0] : it.model);
    assert.ok(g.ok, `${id}: ${it.model}`);
    n++;
  }
  assert.ok(n > 2000, `${n} cards`);
});

test('no false positives: wrong article, wrong preposition form, the prompt word itself', () => {
  const ARTS = ['der', 'die', 'das'];
  const PREPS = ['bei', 'beim', 'zu', 'zum', 'zur', 'nach', 'in', 'im', 'ins', 'an', 'am', 'ans', 'auf', 'aus', 'von', 'vom', 'mit', 'für', 'vor', 'seit', 'über', 'unter'];
  const fp = [];
  for (const cl of ix.all) for (const id of cardIds(cl, ix)) {
    const it = itemFor(id, ix, C, { t });
    const ok = new Set(it.accept.map(a => a.toLowerCase()));
    const tries = [];
    const m = /^(der|die|das) (.+)$/.exec(it.model);
    if (m) for (const a of ARTS) if (a !== m[1] && !ok.has(`${a} ${m[2]}`.toLowerCase())) tries.push(`${a} ${m[2]}`);
    if (it.kind === 'prep') for (const p of PREPS) if (!ok.has(p)) tries.push(p);
    if (it.kind === 'opposite' && !ok.has(it.prompt.toLowerCase())) tries.push(it.prompt);
    for (const s of tries) if (grade(it, s).ok) fp.push(`${id}: ${s}`);
  }
  assert.deepEqual(fp, []);
});

test('an opposite card accepts every listed opposite; a family card asks for the family word', () => {
  const it = itemFor('CO:alt.adj~neu.adj', ix, C, { t });
  assert.ok(grade(it, 'neu').ok);
  assert.ok(grade(it, 'jung').ok, 'alt has two opposites');
  assert.ok(!grade(it, 'alt').ok);
  const unfall = itemFor('CF:der_Unfall', ix, C, { t });
  assert.equal(unfall.model, 'der Unfall');
  assert.match(unfall.task, /fallen/);
  assert.ok(!grade(unfall, 'die Unfall').ok);
  const gap = itemFor('CP:bei-arzt', ix, C, { t });
  assert.ok(grade(gap, 'beim').ok);
  assert.ok(!grade(gap, 'zum').ok);
  assert.ok(gap.usage.length > 10, 'the usage note shows after the answer');
  // the German review: in einer Bank, am Bahnhof abholen and aufgrund are right too
  for (const [id, yes, no] of [['CP:bei-firma', 'in', 'zu'], ['CP:von-bahnhof', 'am', 'zum'], ['CP:wegen-streik', 'aufgrund', 'trotz']]) {
    const g = itemFor(id, ix, C, { t });
    assert.ok(grade(g, yes).ok, `${id}: ${yes}`);
    assert.ok(!grade(g, no).ok, `${id}: ${no}`);
  }
});

test('round composition: due first, at most 6 new, practise ahead when nothing is left', () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'];
  const c = { today: '2026-03-10', newItems: true };
  const cards = { a: { reps: 2, last: '2026-03-01' }, b: { reps: 1, last: '2026-03-10' } };
  const r = compose({ ids, cards, c, isDue: rec => rec.last < c.today, recall: () => 0.5 });
  assert.equal(r.due, 1); assert.equal(r.fresh, 6); assert.equal(r.ids[0], 'a');
  const none = compose({ ids, cards, c: { ...c, newItems: false }, isDue: () => false, recall: () => 0.5 });
  assert.deepEqual(none.ids, ['a']); assert.equal(none.extra, true);
  assert.deepEqual(parseClusterKind('cluster:family:fallen'), { due: false, key: 'family:fallen' });
  assert.deepEqual(parseClusterKind('cluster:due'), { due: true, key: null });
  assert.equal(parseClusterKind('cluster:nope:x'), null);
  assert.equal(form(ix.word('der_Raum')), 'der Raum');
});

test('a round of words picked on the map: ids from the address, all new ones taken while new items are allowed', async () => {
  const { pickIds, PICK_MAX } = await import('../../src/features/shared/cluster-items.js');
  assert.deepEqual(parseClusterKind('cluster:pick'), { due: false, key: null, pick: true });
  assert.deepEqual(pickIds('der_Apfel, laufen.verb,der_Apfel,<x>,'), ['W:der_Apfel', 'W:laufen.verb']);
  assert.equal(pickIds(Array.from({ length: 30 }, (_, i) => `w${i}`).join(',')).length, PICK_MAX);
  const ids = ['W:a', 'W:b', 'W:c', 'W:d', 'W:e', 'W:f', 'W:g', 'W:h', 'W:i', 'W:j'];
  const run = (/** @type {boolean} */ newItems) => compose({ ids, cards: {}, c: { today: 'd', newItems }, isDue: () => false, recall: () => 0, size: ids.length, newCap: ids.length });
  assert.equal(run(true).ids.length, 10);
  assert.equal(run(false).ids.length, 0);
});
