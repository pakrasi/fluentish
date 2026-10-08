// Word families (round 7, content/build/FAMILY-SCHEMA.md): the written parts and the stress rule of the build
// (tools/family-build.mjs), the validator's guards (src/domain/wordbuild-family-check.js) and the shipped content.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { segOf, stressOf, showStress } from '../../tools/family-build.mjs';
import { validateFamilies, familyCardIds, exampleHolds, BOARD_SIZE } from '../../src/domain/wordbuild-family-check.js';
import { cardIds } from '../../src/domain/wordbuild.js';

const J = (/** @type {string} */ p) => JSON.parse(readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8'));
const C = J('content/build/de.json');

/** A form with its parts and stress, as the build makes it. @param {any} f @param {string[]} stems @param {any} [parent] */
const built = (f, stems, parent = null) => { const g = { suf: [], pre: [], ...f }; g.seg = segOf(g, stems); g.stress = stressOf(g, parent); return g; };

test('family parts: prefixes, the root stem and the ending spell the word', () => {
  assert.deepEqual(segOf({ word: 'Vorstellung', cls: 'noun', pre: ['vor'], suf: ['ung'] }, ['stell']), [['p', 'Vor'], ['r', 'stell'], ['s', 'ung']]);
  assert.deepEqual(segOf({ word: 'unvorstellbar', cls: 'adj', pre: ['un', 'vor'], suf: ['bar'] }, ['stell']), [['p', 'un'], ['p', 'vor'], ['r', 'stell'], ['s', 'bar']]);
  assert.deepEqual(segOf({ word: 'Angestellte', cls: 'noun', adjNoun: true, pre: ['an'], suf: ['pp'] }, ['stell']), [['p', 'An'], ['i', 'ge'], ['r', 'stell'], ['i', 't'], ['i', 'e']]);
  assert.deepEqual(segOf({ word: 'Abfall', cls: 'noun', pre: ['ab'], suf: ['stem'] }, ['fall']), [['p', 'Ab'], ['r', 'fall']]);
  assert.deepEqual(segOf({ word: 'Ansicht', cls: 'noun', pre: ['an'], suf: ['t'] }, ['seh', 'sicht']), [['p', 'An'], ['r', 'sicht']]);
  assert.equal(segOf({ word: 'Ausgabe', cls: 'noun', pre: ['aus'], suf: ['e'] }, ['geb']), null, 'a stem the family does not list');
});

test('family stress: the particle of a separable verb, the stem after be-/ver-, a bare-stem noun on its prefix', () => {
  const S = ['stell'];
  const v = built({ word: 'herstellen', cls: 'verb', kind: 's', pre: ['her'] }, S);
  assert.equal(showStress(v.word, v.stress), 'hErstellen');
  assert.equal(showStress('bestellen', built({ word: 'bestellen', cls: 'verb', kind: 'i', pre: ['be'] }, S).stress), 'bestEllen');
  assert.equal(showStress('umstellen', built({ word: 'umstellen', cls: 'verb', kind: 'i', pre: ['um'] }, S).stress), 'umstEllen');
  assert.equal(showStress('herausstellen', built({ word: 'herausstellen', cls: 'verb', kind: 's', pre: ['heraus'] }, S).stress), 'herAusstellen');
  const parent = built({ word: 'bestellen', cls: 'verb', kind: 'i', pre: ['be'] }, S);
  assert.equal(showStress('Bestellung', built({ word: 'Bestellung', cls: 'noun', side: 'suf', pre: ['be'], suf: ['ung'] }, S, parent).stress), 'BestEllung');
  assert.equal(showStress('Unterschied', built({ word: 'Unterschied', cls: 'noun', side: 'suf', pre: ['unter'], suf: ['stem'] }, ['schied']).stress), 'Unterschied');
  assert.equal(showStress('zurückgeben', built({ word: 'zurückgeben', cls: 'verb', kind: 's', pre: ['zurück'] }, ['geb']).stress), 'zurÜckgeben');
});

test('family examples: a separable verb shows its particle at the end, a welded one stays welded', () => {
  const f = { word: 'herstellen', cls: 'verb', kind: 's', pre: ['her'], pp: 'hergestellt' };
  assert.ok(exampleHolds({ ...f, ex: 'Die Firma stellt Möbel her.' }, ['stell']));
  assert.ok(!exampleHolds({ ...f, ex: 'Die Firma stellt Möbel.' }, ['stell']));
  assert.ok(exampleHolds({ ...f, ex: 'Wir haben das selbst hergestellt.' }, ['stell']));
  assert.ok(exampleHolds({ word: 'Bestellung', cls: 'noun', ex: 'Die Bestellungen kommen morgen.' }, ['stell']));
});

/** A minimal family to break on purpose. */
function mini() {
  const root = { id: 'stellen.verb', card: null, word: 'stellen', cls: 'verb', parent: null, pre: [], suf: [], key: '|', seg: [['r', 'stell'], ['i', 'en']], stress: 2, en: 'put', ex: 'Stell es hin.', exEn: 'Put it down.', grade: 'T', how: 'lit', level: 'A1', lemma: null, lex: ['dwds'], board: false, aux: 'hat', pp: 'gestellt' };
  const her = { id: 'herstellen.verb', card: 'PF:herstellen.verb', word: 'herstellen', cls: 'verb', kind: 's', aux: 'hat', pp: 'hergestellt', parent: 'stellen.verb', add: 'her', side: 'pre', pre: ['her'], suf: [], key: 'her|', seg: [['p', 'her'], ['r', 'stell'], ['i', 'en']], stress: 1,
    en: 'produce', clue: 'to manufacture', ex: 'Die Firma stellt Möbel her.', exEn: 'The firm makes furniture.', grade: 'M', how: 'pic', level: 'B1', lemma: null, lex: ['dwds'], board: true };
  const noun = { id: 'die_Herstellung', card: 'PF:die_Herstellung', word: 'Herstellung', cls: 'noun', art: 'die', parent: 'herstellen.verb', add: 'ung', side: 'suf', pre: ['her'], suf: ['ung'], key: 'her|ung', seg: [['p', 'Her'], ['r', 'stell'], ['s', 'ung']], stress: 1,
    en: 'production', clue: 'the production', ex: 'Die Herstellung ist teuer.', exEn: 'Production is expensive.', grade: 'T', how: 'lit', level: 'B2', lemma: null, lex: ['dwds'], board: true };
  return { prefixes: C.prefixes, suffixes: C.suffixes, verbs: [], chains: [], particles: [{ id: 'her', kind: 's', core: 'here', short: 'here' }],
    families: [{ root: 'stellen', lemma: 'stellen.verb', en: 'put', pres3: 'stellt', pret: 'stellte', aux: 'hat', pp: 'gestellt', level: 'A1', stems: ['stell'], forms: [root, her, noun], boards: {}, none: [{ key: 'zer|', word: 'zerstellen', chk: { dwds: false, wf: 0, hits: 0 } }], rare: [] }] };
}

test('family validator: a clean family passes; each guard fires', () => {
  assert.deepEqual(validateFamilies(mini()), []);
  const has = (/** @type {any} */ c, /** @type {RegExp} */ re) => assert.ok(validateFamilies(c).some(e => re.test(e)), `expected ${re}: ${validateFamilies(c).join(' | ')}`);
  let c = mini(); c.families[0].forms[2].art = 'der'; has(c, /-ung gives die/);
  c = mini(); c.families[0].forms[2].clue = 'to manufacture'; has(c, /clue "to manufacture" is also/);
  c = mini(); c.families[0].forms[1].kind = 'i'; has(c, /her- always splits|stressed on its stem/);
  c = mini(); c.families[0].forms[1].ex = 'Die Firma stellt Möbel.'; has(c, /does not hold herstellen/);
  c = mini(); c.families[0].none[0].word = 'herstellen'; has(c, /a word the content knows/);
  c = mini(); c.families[0].none[0].chk = { dwds: true, wf: 0, hits: 0 }; has(c, /recorded check/);
  c = mini(); c.families[0].none[0].chk = { dwds: false, wf: 0, hits: 40 }; has(c, /recorded check/);
  c = mini(); c.families[0].forms[2].lex = ['wf']; has(c, /found in no lexicon/);
  c = mini(); c.families[0].forms[2].seg = [['p', 'Her'], ['r', 'stel'], ['s', 'lung']]; has(c, /not one of the stems/);
  c = mini(); c.families[0].forms[2].stress = 0; has(c, /not on a vowel/);
});

test('family content: valid, every board the right size, PF ids never shadow a PV/PW card', () => {
  if (!C.families) return;   // before the families land
  assert.ok(C.families.length >= 40, `${C.families.length} families`);
  const old = new Set(cardIds(C));
  const pf = familyCardIds(C);
  assert.ok(pf.length > 300, `${pf.length} PF cards`);
  for (const id of pf) assert.ok(!old.has(id), id);
  for (const fam of C.families) {
    for (const [lv, n] of Object.entries(BOARD_SIZE)) if (lv !== 'A2' || fam.boards.A2) assert.equal(fam.boards[lv]?.words.length, n, `${fam.root} ${lv}`);
    assert.ok(fam.boards.B1 && fam.boards.B2, `${fam.root}: B1 and B2 boards`);
    assert.ok(fam.none.length >= 1, `${fam.root}: no checked non-word`);
  }
});
