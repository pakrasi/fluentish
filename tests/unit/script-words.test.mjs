// Script mode: lemmas and the unknown-word suggestion (script/lemma.js, script/suggest.js) over the public German word
// list and the synthetic bicycle talk.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as P from '../../src/features/practice/script/parse.js';
import * as L from '../../src/features/practice/script/lemma.js';
import * as S from '../../src/features/practice/script/suggest.js';
import { buildLexicon } from '../../src/features/practice/pool.js';

const words = JSON.parse(fs.readFileSync(new URL('../../content/igloo/words/de.json', import.meta.url), 'utf8'));
const idx = L.buildIndex(words);
const lexicon = buildLexicon({ lexWords: words });
const de = fs.readFileSync(new URL('../fixtures/script-bicycle.md', import.meta.url), 'utf8');

test('lemma: listed words, forms, endings, prefixes, compounds', () => {
  const lem = (/** @type {string} */ w, o = {}) => L.lemmaOf(w, idx, o).lemma;
  assert.equal(lem('Rahmen'), 'Rahmen');
  assert.equal(lem('Fahrrads'), 'Fahrrad', 'genitive');
  assert.equal(lem('Häuser'), 'Haus', 'listed plural');
  assert.equal(lem('ging'), 'gehen', 'listed verb form');
  assert.equal(lem('bestanden'), 'bestehen');
  assert.equal(lem('erkläre'), 'erklären', 'present ending');
  assert.equal(lem('niedrigen'), 'niedrig', 'adjective ending');
  assert.equal(lem('schwächer'), 'schwach', 'comparative with the umlaut taken back');
  assert.equal(lem('losfahrt'), 'losfahren', 'separable prefix');
  assert.equal(lem('Gangschaltung'), 'Gangschaltung', 'a compound keeps its own head');
  assert.equal(L.lemmaOf('Gangschaltung', idx).how, 'compound');
  assert.equal(lem('Bremsen'), 'Bremsen', 'a capital mid-sentence is a noun: never the verb bremsen');
  assert.equal(lem('Bremsen', { start: true }), 'bremsen', 'at the start of a sentence the capital says nothing');
  const e = L.lemmaOf('Schnittstelle', idx).entry;
  assert.equal(L.headOf(e, 'Schnittstelle'), 'die Schnittstelle, Schnittstellen');
  assert.equal(L.glossOf(e), 'interface');
});

test('suggest: above his level, off the list, names and English never, his own choices win', () => {
  const sent = 'Der Rahmen von Velo Labs ist im Grunde eine Schnittstelle, sagt NASA in Bikes for Kids.';
  const toks = P.tokenize(sent);
  const c = S.classify(toks, { idx, lexicon, level: 'B1' });
  const by = (/** @type {string} */ w) => c[toks.findIndex(x => x.t === w)];
  assert.ok(by('Rahmen').suggest, 'B2 word for a B1 learner');
  assert.ok(by('Schnittstelle').suggest, 'C1');
  assert.ok(!by('ist').suggest && !by('eine').suggest, 'list words at or below B1');
  assert.equal(by('Velo').type, 'name'); assert.equal(by('Labs').type, 'name');
  assert.equal(by('NASA').type, 'name', 'all caps');
  assert.equal(by('Kids').type, 'name', 'next to an English word');
  assert.equal(by(',').type, 'skip');
  // his level moves the line
  assert.ok(!S.classify(toks, { idx, lexicon, level: 'B2' })[toks.findIndex(x => x.t === 'Rahmen')].suggest);
  // unmarked in this script, known card, lapsed card
  const un = S.classify(toks, { idx, lexicon, level: 'B1', unmarked: new Set(['rahmen']) });
  assert.ok(!un[toks.findIndex(x => x.t === 'Rahmen')].suggest);
  const known = S.classify(toks, { idx, lexicon, level: 'B1', card: id => (id === 'W:die_Schnittstelle' ? { r: 0.95, lapses: 0 } : null) });
  assert.ok(!known[toks.findIndex(x => x.t === 'Schnittstelle')].suggest);
  const lapsed = S.classify(P.tokenize('Ich habe heute Zeit.'), { idx, lexicon, level: 'B1', card: id => (id === 'W:die_Zeit' ? { r: 0.5, lapses: 2 } : null) });
  assert.ok(lapsed[3].suggest, 'two lapses make even an A1 word a suggestion');
  // names from the English lines of a pair import
  const nm = S.classify(P.tokenize('Das Video zeigt den Velobot.'), { idx, lexicon, level: 'B1', names: new Set(['velobot']) });
  assert.equal(nm[4].type, 'name');
  // a long press makes a wrongly guessed name tappable
  const forced = S.classify(P.tokenize('Das Video zeigt den Velobot.'), { idx, lexicon, level: 'B1', names: new Set(['velobot']), forced: new Set(['velobot']) });
  assert.equal(forced[4].type, 'word');
});

test('suggest: international words are tappable but not suggested', () => {
  const toks = P.tokenize('Die Installation simuliert eine visuelle Modalität.');
  const c = S.classify(toks, { idx, lexicon, level: 'B1' });
  for (const w of ['Installation', 'simuliert', 'visuelle', 'Modalität']) {
    const x = c[toks.findIndex(t => t.t === w)];
    assert.equal(x.type, 'word', w); assert.ok(!x.suggest, w);
  }
});

test('suggest: a share of the synthetic talk, never most of it', () => {
  const s = P.parseScript(de);
  let n = 0, sug = 0;
  for (const sec of s.sections) for (const x of sec.sentences) for (const c of S.classify(P.tokenize(x.de), { idx, lexicon, level: 'B1' })) {
    if (c.type === 'skip') continue; n++; if (c.suggest) sug++;
  }
  assert.ok(sug > 0 && sug / n < 0.2, `${sug} of ${n}`);
});

test('cardId: the list id for listed lemmas, SW: for script words', () => {
  const e = L.lemmaOf('Schnittstelle', idx).entry;
  assert.equal(S.cardId('Schnittstelle', e), 'W:die_Schnittstelle');
  assert.equal(S.cardId('Gangschaltung', null), 'SW:gangschaltung');
  assert.equal(S.cardId('Übersetzungsverhältnis', null), 'SW:uebersetzungsverhaeltnis');
  assert.equal(S.cardId('Zeit', null, { Zeit: ['die_Zeit', 'A1'] }), 'W:die_Zeit', 'the word map when the entry is missing');
});
