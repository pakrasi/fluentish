// The French grading corpus (tests/corpus/grading-corpus.fr.mjs) as a regression test: typical A2-B1 errors made in
// the French course's sentences and words (wrong article or gender, elision left out, an accent that changes the word,
// the wrong auxiliary, agreement, ne … pas, a participle's final é) must never come back as right, and right variants
// (accents left out as slips, typographic punctuation, the other accepted wordings) must not be marked wrong.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, table } from '../corpus/grading-corpus.fr.mjs';
import { setActivePack } from '../../src/lang/registry.js';

after(() => setActivePack('de'));

test('French grading corpus: no wrong French is right, right French is not wrong', () => {
  const corpus = evaluate();
  const { by, all } = table(corpus);
  assert.ok(all.wrong > 1200 && all.right > 1500 && all.vRight > 1000, `corpus size ${all.wrong} wrong, ${all.right} right, ${all.vRight} other wordings`);
  for (const cls of ['gender', 'elision', 'meaning-accent', 'aux', 'participle-e', 'agreement', 'person', 'ne-pas', 'noun-gender', 'noun-elision', 'verb-conjugated'])
    assert.ok([...by.keys()].some(k => k.startsWith('wrong ') && k.endsWith(` ${cls}`)), `no ${cls} errors in the corpus`);
  assert.deepEqual(corpus.filter(c => c.fp).map(c => `${c.cls} ${c.id}: ${c.text}`), [], 'false positives');
  assert.deepEqual(corpus.filter(c => c.fn && !c.variant).map(c => `${c.cls} ${c.id}: ${c.text}`), [], 'false negatives');
  // the other accepted wordings put in the model's place: none graded wrong; a few are Hard where the rest of the
  // sentence does not fit the wording
  assert.deepEqual(corpus.filter(c => c.fn && c.variant).map(c => `${c.id}: ${c.text}`), [], 'other wordings graded wrong');
  assert.ok(all.vSoft <= 12, `${all.vSoft} other wordings flagged Hard`);
  // every accent slip is right and listed as a slip (the round rates it Hard)
  assert.ok(corpus.filter(c => /accent-slip/.test(c.cls)).every(c => c.verdict === 'right' && c.slip));
  console.log(`French grading corpus: ${all.wrong} wrong answers, ${all.fp} right; ${all.right} right answers, ${all.fn} wrong, ${all.soft} Hard; ${all.vRight} other wordings, ${all.vFn} wrong, ${all.vSoft} Hard`);
});
