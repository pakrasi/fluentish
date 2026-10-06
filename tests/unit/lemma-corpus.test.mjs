// The German lemma regression corpus (tests/fixtures/lemma.de.json): the pack lemma (src/lang/de/lemma.js lemma(),
// pack.grammar.morphology.lemma) over the public word list. Separable verbs with the particle at the end of the clause,
// Funktionsverbgefüge spread over a clause, compounds, Konjunktiv I and II, adjective endings, and the traps around
// them (sein, modals, a preposition that is not at the clause end). Every expected lemma was checked in a German review.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import de from '../../src/lang/de/index.js';
import { tokenize } from '../../src/domain/text/tokens.js';

const corpus = JSON.parse(fs.readFileSync(new URL('../fixtures/lemma.de.json', import.meta.url), 'utf8'));
const words = JSON.parse(fs.readFileSync(new URL('../../content/igloo/words/de.json', import.meta.url), 'utf8'));
const M = /** @type {any} */ (de.grammar.morphology);
const idx = M.index(words);

/** @param {{sentence: string, word: string}} c */
const lemmaIn = c => {
  const toks = tokenize(c.sentence);
  const i = toks.findIndex(t => t.w && t.t === c.word);
  assert.ok(i >= 0, `${c.word} is in "${c.sentence}"`);
  return M.lemma(toks[i], toks, i, idx);
};

test('lemma corpus: the shape, about 150 cases or more, every kind present, reviewed', () => {
  assert.ok(corpus.cases.length >= 150, `${corpus.cases.length} cases`);
  const kinds = new Set(corpus.cases.map((/** @type {any} */ c) => c.kind));
  for (const k of ['separable', 'not-separable', 'infinitive', 'fvg', 'compound', 'konj', 'adj']) assert.ok(kinds.has(k), k);
  assert.equal(new Set(corpus.cases.map((/** @type {any} */ c) => c.id)).size, corpus.cases.length, 'ids are unique');
  assert.notEqual(corpus.reviewedBy, 'pending');
});

test('lemma corpus: every case gives its lemma first, and its alternatives after it', () => {
  const wrong = [];
  for (const c of corpus.cases) {
    const got = lemmaIn(c);
    if (got[0] !== c.lemma || (c.also || []).some((/** @type {string} */ a) => !got.slice(1).includes(a))) wrong.push(`${c.id} ${c.word}: ${JSON.stringify(got)}, want ${c.lemma}${c.also ? ` + ${c.also}` : ''}`);
  }
  assert.deepEqual(wrong, []);
});

test('lemma: the pack tokenizer\'s tokens work too (no punctuation: coordinators and subordinators still bound the clause)', () => {
  const at = (/** @type {string} */ s, /** @type {string} */ w) => { const t = de.text.tokenize(de.text.normalize(s)); const i = t.findIndex(x => x.raw === w); return M.lemma(t[i], t, i, idx); };
  assert.equal(at('Ich rufe dich morgen an', 'rufe')[0], 'anrufen');
  assert.equal(at('Er steht auf und geht los', 'steht')[0], 'aufstehen');
  assert.equal(at('Was ist denn los', 'ist')[0], 'sein');
});

test('lemma: without the word list only the list-free rules apply; a non-word gives nothing', () => {
  const toks = tokenize('Er kommt morgen an.');
  assert.deepEqual(M.lemma(toks[1], toks, 1), ['kommt']);
  assert.deepEqual(M.lemma(toks[4], toks, 4, idx), [], 'the full stop');
  assert.deepEqual(M.lemma(tokenize('Häuser')[0], [], 0, idx), ['Haus'], 'a token without its sentence is read alone');
});
