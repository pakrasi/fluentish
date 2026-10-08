// Word building: the content model (domain/wordbuild.js) against the shipped content (content/build/de.json): the
// validator, card ids (format, uniqueness, stability), the German forms the content teaches, sentence gaps, word
// chains as trees and the knowledge mapping. Synthetic data only where a case needs breaking.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as W from '../../src/domain/wordbuild.js';
import { resolver } from '../../src/domain/knowledge.js';
import { tagOf, kindOf } from '../../src/domain/itemids.js';

const J = p => JSON.parse(readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8'));
const C = J('content/build/de.json');
const WORDS = J('content/igloo/words/de.json');
const CL = J('content/clusters/de.json');
const ctx = { words: WORDS, morph: CL.morph, clusterSuffixes: CL.suffixes };

test('the shipped content passes every rule', () => {
  assert.deepEqual(W.validateBuild(C, ctx), []);
  assert.ok(C.prefixes.length >= 20 && C.roots.length === 15 && C.verbs.length >= 170 && C.frames.length >= 30 && C.chains.length >= 20);
});

test('the validator catches broken German and broken structure', () => {
  const bad = structuredClone(C);
  const v = bad.verbs.find(x => x.id === 'abstellen'); v.pp = 'abstellt';
  bad.verbs.find(x => x.id === 'bestellen').kind = 's';
  bad.frames.find(f => f.id === 'aufstehen').forms.perf.find(t => t[0] === 'X')[1] = 'habe';
  bad.frames.find(f => f.id === 'bestellen').forms.perf.splice(3, 0, ['G', 'ge']);
  bad.chains[0].nodes.find(n => n.word === 'Vorstellung').art = 'der';
  const e = W.validateBuild(bad, ctx).join('\n');
  const broken = structuredClone(C);
  broken.chains[0].nodes.push({ id: 'n9', from: 'n99', word: 'Quatsch', cls: 'noun', art: 'der', en: 'x' });
  const e2 = W.validateBuild(broken, ctx).join('\n');
  assert.match(e, /abstellen: participle abstellt, expected abgestellt/);
  assert.match(e, /bestellen: be- never splits/);
  assert.match(e, /aufstehen perf: helper habe is not a form of sein/);
  assert.match(e, /bestellen perf: an inseparable verb never splits and has no ge-/);
  assert.match(e, /Vorstellung: is der, but -ung gives die/);
  assert.match(e2, /n9 grows from n99/);
});

test('card ids: one form per kind, unique, and the tags are registered', () => {
  const ids = W.cardIds(C);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) {
    assert.match(id, /^(PX:[a-zäöü]+\.(see|say)|P[DV]:[a-zäöüß-]+|PS:[a-zäöüß-]+\.(pres|perf|sub|modal|zu)|SX:[a-z]+|PW:[A-Za-zÄÖÜäöüß]+)$/, id);
    assert.equal(kindOf(id)?.area, 'build', id);
  }
  // the ids the spec names stay exactly as they are (a learner's card is keyed by them)
  for (const id of ['PX:auf.see', 'PX:ver.say', 'PD:vorstellen', 'PV:umfahren-s', 'PV:umfahren-i', 'PD:umstellen-i', 'PS:anrufen.perf', 'PS:übersetzen-s.pres', 'SX:ung', 'PW:Vorstellung', 'PW:Umzug'])
    assert.ok(ids.includes(id), id);
  // a verb id is its infinitive (without sich), plus -s / -i for the two readings of a dual verb
  for (const v of C.verbs) assert.equal(v.id.replace(/-[si]$/, ''), W.bare(v.inf));
  assert.equal(tagOf('PX:auf.see'), 'PX');
});

test('German forms: participles, auxiliaries and the split the content teaches', () => {
  const R = new Map(C.roots.map(r => [r.id, r]));
  for (const v of C.verbs) {
    const r = R.get(v.root);
    // separable: the particle before the root's participle (auf + gestanden); inseparable: no ge- (be + stellt)
    assert.equal(v.pp, v.kind === 's' ? v.pre + r.pp : v.pre + r.pp.replace(/^ge/, ''), v.id);
    if (v.kind === 'i') assert.ok(!v.pp.startsWith(`${v.pre}ge`) || r.pp.startsWith('gege'), v.id);
  }
  const by = id => C.verbs.find(v => v.id === id);
  assert.equal(by('umfahren-s').pp, 'umgefahren'); assert.equal(by('umfahren-i').pp, 'umfahren');
  assert.equal(by('übersetzen-s').pp, 'übergesetzt'); assert.equal(by('übersetzen-i').pp, 'übersetzt');
  assert.equal(by('umstellen-i').pp, 'umstellt'); assert.equal(by('umstellen-s').pp, 'umgestellt');
  assert.equal(by('gefallen').pp, 'gefallen'); assert.equal(by('vergeben').pp, 'vergeben');
  assert.equal(by('aufstehen').aux, 'ist'); assert.equal(by('umziehen').aux, 'hat/ist', 'move house: ist; get changed: hat sich umgezogen'); assert.equal(by('ausziehen').aux, 'hat/ist'); assert.equal(by('bekommen').aux, 'hat');
  // ge- prefixed verbs carry no meaning a learner can use: every ge- verb is a word to learn
  for (const v of C.verbs.filter(x => x.pre === 'ge')) assert.equal(v.grade, 'O', v.id);
  // um- reading "surround" is inseparable, "rearrange" separable (PREFIX-DESIGN §4.4)
  assert.equal(by('umstellen-i').kind, 'i'); assert.match(by('umstellen-i').en, /surround/);
});

test('sentence frames: the pieces spell the right forms', () => {
  const f = id => C.frames.find(x => x.id === id);
  assert.equal(W.sentenceOf(f('aufstehen').forms.perf, 's'), 'Ich bin um sieben aufgestanden.');
  assert.equal(W.sentenceOf(f('aufstehen').forms.zu, 's'), 'Ich versuche, um sieben aufzustehen.');
  assert.equal(W.sentenceOf(f('bestellen').forms.zu, 'i'), 'Ich versuche, eine Pizza zu bestellen.');
  assert.equal(W.sentenceOf(f('vorbereiten').forms.perf, 's'), 'Ich habe mich auf die Prüfung vorbereitet.');
  assert.deepEqual(W.gapped(f('anrufen'), 'perf').pieces, ['habe', 'angerufen']);
  assert.equal(W.gapped(f('aufstehen'), 'pres').answer, 'stehe auf');
  assert.equal(W.gapped(f('aufstehen'), 'sub').answer, 'aufstehe');
  assert.equal(W.gapped(f('bestellen'), 'zu').answer, 'zu bestellen');
  assert.equal(W.gapped(f('einbeziehen'), 'perf').answer, 'haben einbezogen');
  for (const fr of C.frames) for (const form of W.FORMS) if (fr.forms[form]) {
    const g = W.gapped(fr, form);
    assert.ok(g.answer && g.parts.some(p => 'gap' in p), `${fr.id}.${form}`);
  }
});

test('chains are trees: every node grows from an earlier one; vorstellbar comes from the verb', () => {
  for (const ch of C.chains) {
    const t = W.chainTree(ch);
    assert.equal(t.order.length, ch.nodes.length, ch.id);
    for (const x of t.order) if (x.parent) assert.equal(x.depth, x.parent.depth + 1);
  }
  const t = W.chainTree(C.chains.find(c => c.id === 'vorstellen'));
  const node = w => [...t.byId.values()].find(x => x.node.word === w);
  assert.equal(node('vorstellbar').parent.node.word, 'vorstellen');
  assert.equal(node('Vorstellung').parent.node.word, 'vorstellen');
  assert.equal(node('Vorstellbarkeit').parent.node.word, 'vorstellbar');
  assert.deepEqual(W.pieces(node('Vorstellung').node), { before: 'Vorstell', add: 'ung', after: '' });
  assert.deepEqual(W.pieces(node('unvorstellbar').node), { before: '', add: 'un', after: 'vorstellbar' });
  // the Umzug pattern: a bare-stem noun, no -ung form
  const umzug = C.chains.flatMap(c => c.nodes).find(n => n.word === 'Umzug');
  assert.equal(umzug.add, 'stem'); assert.equal(umzug.art, 'der');
  assert.throws(() => W.chainTree({ id: 'x', title: 'x', nodes: [{ id: 'n0', word: 'a', cls: 'verb', en: 'x' }, { id: 'n1', from: 'n2', word: 'b', cls: 'verb', en: 'x' }] }), /not before it/);
});

test('knowledge: Word building cards map onto items, a listed verb onto its word', () => {
  const resolve = resolver({ words: WORDS, build: W.lemmaMaps(C) });
  assert.equal(resolve('PX:auf.see', 'build'), 'PX:auf');
  assert.equal(resolve('PX:auf.say', 'build'), 'PX:auf');
  assert.equal(resolve('PD:abstellen', 'build'), 'W:abstellen.verb');
  assert.equal(resolve('PV:abstellen', 'build'), 'W:abstellen.verb');
  assert.equal(resolve('PD:übersetzen-i', 'build'), 'W:übersetzen.verb');
  assert.equal(resolve('PD:übersetzen-s', 'build'), 'PV:übersetzen-s');   // the ferry reading is not the word list's
  assert.equal(resolve('PW:Vorstellung', 'build'), 'W:die_Vorstellung');
  assert.equal(resolve('PS:anrufen.perf', 'build'), 'PS:anrufen.perf');
  assert.equal(resolve('SX:ung', 'build'), 'SX:ung');
  // the word list now has every lemma a verb names (the 103 added verbs), with the gloss fixes
  const w = new Map(WORDS.map(x => [x.id, x]));
  for (const v of C.verbs) if (v.lemma) assert.ok(w.has(v.lemma), v.lemma);
  assert.ok(w.has('setzen.verb'));
  assert.ok(w.get('ausstellen.verb').en.some(e => /exhibit/.test(e)));
  assert.ok(w.get('einstellen.verb').en.some(e => /adjust/.test(e)));
  const m = CL.morph['die_Vorstellung'];
  assert.deepEqual({ pre: m.pre, stem: m.stem, suf: m.suf }, { pre: ['vor'], stem: 'stell', suf: ['ung'] });
  assert.deepEqual({ pre: CL.morph['der_Empfänger'].pre, stem: CL.morph['der_Empfänger'].stem, suf: CL.morph['der_Empfänger'].suf }, { pre: ['emp'], stem: 'fang', suf: ['er'] });
});
