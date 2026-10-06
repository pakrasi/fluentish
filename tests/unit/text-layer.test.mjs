// The shared text layer (round 4, L2a): domain/text/{tokens,suggest,estimate}.js take a language pack, German's rules
// live in src/lang/de/{lemma,reading}.js, and Scripts read them through thin bindings (features/practice-script/
// lemma.js, suggest.js; domain/script/parse.js). Scripts' own tests (script-words, script-parse) are unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import de from '../../src/lang/de/index.js';
import fr from '../../src/lang/fr/index.js';
import * as Tok from '../../src/domain/text/tokens.js';
import * as Sug from '../../src/domain/text/suggest.js';
import * as Est from '../../src/domain/text/estimate.js';
import * as P from '../../src/domain/script/parse.js';
import * as SL from '../../src/features/practice-script/lemma.js';
import * as SS from '../../src/features/practice-script/suggest.js';
import { knowledge } from '../../src/domain/knowledge.js';
import { buildLexicon } from '../../src/features/shared/pool.js';

const words = JSON.parse(fs.readFileSync(new URL('../../content/igloo/words/de.json', import.meta.url), 'utf8'));
const M = /** @type {any} */ (de.grammar.morphology);
const idx = M.index(words);
const lexicon = buildLexicon({ lexWords: words });
const talk = fs.readFileSync(new URL('../fixtures/script-bicycle.md', import.meta.url), 'utf8');

test('Scripts read the shared layer: the same functions, bound to the German pack', () => {
  assert.equal(P.tokenize, Tok.tokenize);
  assert.equal(P.wordCount, Tok.wordCount);
  assert.equal(SL.lemmaOf, M.lookup);
  assert.equal(SL.buildIndex, M.index);
  assert.equal(SL.scriptPack, de);
  assert.equal(SS.cardId, Sug.cardId);
  assert.equal(SS.capSuggest, Sug.capSuggest);
  const s = 'Das ist z. B. ein Test. Dr. Meier kommt am 3. Oktober. Er kommt!';
  assert.deepEqual(P.splitSentences(s), Tok.splitSentences(s, de));
  assert.deepEqual(P.splitSentences(s), ['Das ist z. B. ein Test.', 'Dr. Meier kommt am 3. Oktober.', 'Er kommt!']);
  assert.deepEqual(Tok.splitSentences('Dr. Meier kommt.'), ['Dr.', 'Meier kommt.'], 'without a pack no word is an abbreviation');
  for (const sec of P.parseScript(talk).sections) for (const x of sec.sentences) {
    const toks = P.tokenize(x.de);
    assert.deepEqual(SS.classify(toks, { idx, lexicon, level: 'B1' }), Sug.classify(toks, { pack: de, idx, lexicon, level: 'B1' }));
  }
});

test('the German pack has the optional parts: lemma, index, lookup, reading', () => {
  assert.equal(typeof M.lemma, 'function');
  assert.ok(de.reading && de.reading.stop.has('und') && de.reading.stop.has('fuer'), 'folded stop words');
  assert.ok(de.reading.cognate?.test('Installation'));
  assert.equal(de.reading.spelling['daß'], 'dass');
  assert.ok(de.reading.abbreviations?.has('bzw'));
  const t = Tok.tokenize('Thinking for Kids');
  assert.ok(de.reading.foreign?.(t[0], t, 0) && de.reading.foreign?.(t[1], t, 1), 'English letters, an English function word');
  assert.ok(!de.reading.foreign?.(t[2], t, 2), 'Kids: a name only beside an English word (classify)');
  assert.ok(!de.reading.foreign?.(Tok.tokenize('Rahmen')[0], [], 0));
  assert.ok(de.reading.foreignWords?.has('for') && !de.reading.foreignWords?.has('in'), 'in is German too');
});

test('reading constructions: Konjunktiv I, a modal passive, je … desto; and none in plain sentences', () => {
  const C = Object.fromEntries((de.reading?.constructions || []).map(c => [c.id, c]));
  const has = (/** @type {string} */ id, /** @type {string} */ s) => C[id].test(Tok.tokenize(s));
  assert.ok(has('konj1', 'Er sagt, er sei krank.'));
  assert.ok(has('konj1', 'Man habe keine Zeit, sagte sie.'));
  assert.ok(!has('konj1', 'Ich habe keine Zeit.'));
  assert.ok(has('passive-modal', 'Das Fahrrad muss repariert werden.'));
  assert.ok(has('passive-modal', 'Die Regeln sollten geändert werden.'));
  assert.ok(!has('passive-modal', 'Das Fahrrad wird repariert.'));
  assert.ok(!has('passive-modal', 'Ich will Lehrer werden.'));
  assert.ok(has('je-desto', 'Je früher wir anfangen, desto besser.'));
  assert.ok(has('je-desto', 'Je mehr er liest, umso mehr weiß er.'));
  assert.ok(!has('je-desto', 'Ich habe je einen Apfel.'));
  for (const c of de.reading?.constructions || []) assert.ok(c.concept === null || typeof c.concept === 'string');
});

test('classify degrades for a pack without a lookup or reading rules: every word a guess, nothing thrown', () => {
  const toks = Tok.tokenize('Le chat dort sur le canapé.');
  const c = Sug.classify(toks, { pack: { ...fr, reading: undefined, grammar: { ...fr.grammar, morphology: null } }, idx: M.index([]), level: 'B1' });
  assert.equal(c.filter(x => x.type === 'word').length, 6);
  assert.ok(c.every(x => x.type !== 'word' || (x.how === 'guess' && x.entry === null)));
  assert.equal(c[1].lemma, 'chat');
});

test('levels: levelRank as Scripts used it', () => {
  assert.equal(Est.levelRank('a1'), 0); assert.equal(Est.levelRank('C2'), 5);
  assert.equal(Est.levelRank(null), 2, 'unknown reads as B1'); assert.equal(SS.levelRank, Est.levelRank);
});

test('coverage bands at 98, 95 and 90 %', () => {
  assert.equal(Est.bandOf(1), 'easy'); assert.equal(Est.bandOf(0.98), 'easy');
  assert.equal(Est.bandOf(0.9799), 'study'); assert.equal(Est.bandOf(0.95), 'study');
  assert.equal(Est.bandOf(0.9499), 'stretch'); assert.equal(Est.bandOf(0.9), 'stretch');
  assert.equal(Est.bandOf(0.8999), 'hard'); assert.equal(Est.bandOf(0), 'hard');
  assert.equal(Est.bandOf(49 / 50), 'easy', 'one unknown in fifty words');
  assert.equal(Est.bandOf(19 / 20), 'study'); assert.equal(Est.bandOf(9 / 10), 'stretch');
});

/** classify() per sentence of a text. @param {string} text @param {string} [level] */
const classified = (text, level = 'B1') => Tok.splitSentences(text, de).map(s => Sug.classify(Tok.tokenize(s), { pack: de, idx, lexicon, level }));
const TODAY = '2026-10-05';
/** A graduated card reviewed four days ago with stability S. @param {number} S */
const card = S => ({ reps: 3, S, D: 5, last: '2026-10-01', due: '2026-11-01', hist: [['2026-10-01', 3]] });

test('personal coverage reads his knowledge: known and shaky count, unknown and unseen do not', () => {
  const text = 'Der Rahmen ist eine Schnittstelle.';
  const none = knowledge({ today: TODAY, decks: {} });
  const r0 = Est.personalCoverage(classified(text), { pack: de, view: none, level: 'B1', idx });
  // der, ist, eine: function words; Rahmen (B2) and Schnittstelle (C1) unseen
  assert.equal(r0.words, 5); assert.equal(r0.known, 3); assert.deepEqual(r0.unknown, ['Rahmen', 'Schnittstelle']);
  assert.equal(r0.by.stop, 3); assert.equal(r0.band, 'hard');
  const view = knowledge({ today: TODAY, decks: { b1: { 'W:der_Rahmen': card(60), 'W:die_Schnittstelle': card(60) } } });
  assert.equal(view.get('W:der_Rahmen').state, 'known');
  const r1 = Est.personalCoverage(classified(text), { pack: de, view, level: 'B1', idx });
  assert.equal(r1.coverage, 1); assert.equal(r1.band, 'easy'); assert.equal(r1.by.known, 2);
  // a lapsed card (unknown) is not known
  const lapsed = knowledge({ today: TODAY, decks: { b1: { 'W:der_Rahmen': { reps: 2, S: 1, D: 5, last: '2026-09-01', due: '2026-09-02', hist: [['2026-09-01', 1]], lapses: 1 } } } });
  assert.equal(Est.personalCoverage(classified(text), { pack: de, view: lapsed, idx }).unknown[0], 'Rahmen');
  // a word he unmarked counts as known
  assert.equal(Est.personalCoverage(classified(text), { pack: de, view: none, idx, known: new Set(['rahmen', 'schnittstelle']) }).coverage, 1);
});

test('personal coverage: common words two levels below his are known unless he missed them; cognates and names', () => {
  const none = knowledge({ today: TODAY, decks: {} });
  // Zeit: A1, zipf 6; for a B1 learner it counts as known, for an A2 learner it does not
  const z = classified('Zeit');
  assert.equal(Est.personalCoverage(z, { pack: de, view: none, level: 'B1', idx }).by.easy, 1);
  assert.equal(Est.personalCoverage(z, { pack: de, view: none, level: 'A2', idx }).by.unknown, 1);
  const missed = knowledge({ today: TODAY, decks: { b1: { 'W:die_Zeit': { reps: 2, S: 1, D: 5, last: '2026-09-01', due: '2026-09-02', hist: [['2026-09-01', 1]], lapses: 1 } } } });
  assert.equal(Est.personalCoverage(z, { pack: de, view: missed, level: 'B1', idx }).by.unknown, 1, 'missed: unknown');
  // an international word off the list reads at once; a name and a number are not running words
  const r = Est.personalCoverage(classified('Die Modalität von NASA kostet 300 Euro.'), { pack: de, view: none, level: 'B1', idx });
  assert.equal(r.by.cognate, 1);
  assert.ok(!r.unknown.includes('NASA') && r.words === 5, `${r.words} words`);
});

test('personal coverage: a compound counts when he knows its last part; the unknown list is most frequent first', () => {
  const view = knowledge({ today: TODAY, decks: { b1: { 'W:der_Baum': card(60) } } });
  const r = Est.personalCoverage(classified('Die Apfelbäume sind alt. Ein Rahmen, noch ein Rahmen und eine Schnittstelle.'), { pack: de, view, level: 'B1', idx });
  assert.equal(r.by.compound, 1);
  assert.deepEqual(r.unknown, ['Rahmen', 'Schnittstelle']);
  assert.deepEqual(Est.personalCoverage([], { pack: de, view, idx }), { words: 0, known: 0, coverage: 1, band: 'easy', unknown: [], by: { known: 0, stop: 0, easy: 0, cognate: 0, compound: 0, unknown: 0 } }, 'no words: nothing to miss');
});

test('personal coverage for a pack without reading rules: only his scores count', () => {
  const frPack = { ...fr, reading: undefined };
  const c = [Sug.classify(Tok.tokenize('Le chat dort.'), { pack: frPack, idx: M.index([]), level: 'B1' })];
  const r = Est.personalCoverage(c, { pack: frPack, view: knowledge({ today: TODAY, decks: {} }), idx: M.index([]) });
  assert.equal(r.words, 3); assert.equal(r.band, 'hard');
});
