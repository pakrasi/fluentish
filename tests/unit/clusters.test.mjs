// domain/clusters.js and content/clusters/de.json: the content rules, known heuristic errors kept out, the index.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateClusters, index, primaryPairs, topicOf, TYPES } from '../../src/domain/clusters.js';
import { build, serialise, withAdded } from '../../tools/build-clusters.mjs';

const read = p => JSON.parse(readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8'));
const C = read('content/clusters/de.json');
const words = read('content/igloo/words/de.json');
const byW = new Map(words.map(w => [w.w + '|' + w.pos, w.id]));
const id = (w, pos) => byW.get(`${w}|${pos}`);
const fam = wid => C.morph[wid]?.family || null;

test('the content passes its rules and is what the sources build', () => {
  assert.deepEqual(validateClusters(C, { words, chunkIds: new Set(Object.keys(read('content/igloo/chunks/german.json').chunks)) }), []);
  assert.equal(serialise(build(words)), readFileSync(new URL('../../content/clusters/de.json', import.meta.url), 'utf8'));
  const added = read('authoring/clusters/words-added.de.json');
  const text = readFileSync(new URL('../../content/igloo/words/de.json', import.meta.url), 'utf8');
  assert.equal(withAdded(text, added), text, 'the added words are in the word list');
  for (const a of added) for (const k of ['level', 'en', 'ex', 'exen', 'theme']) assert.ok(a[k] && a[k].length, `${a.id}: ${k}`);
});

test('every word has morphology and a topic; every chunk a topic', () => {
  for (const w of words) {
    assert.ok(C.morph[w.id]?.stem, w.id);
    assert.ok(topicOf(C, w), `${w.id} topic`);
  }
  assert.equal(Object.keys(C.topics.chunks).length, read('content/igloo/chunks/en.json').length);
});

test('word families: his clusters are there, the heuristic errors are not', () => {
  for (const w of ['Unfall|noun', 'Zufall|noun', 'ausfallen|verb', 'Ausfall|noun', 'verfallen|verb', 'falls|conj', 'auf jeden Fall|phrase', 'zerfallen|verb', 'Anfall|noun', 'umfallen|verb'])
    assert.equal(fam(byW.get(w)), 'fallen', w);
  for (const w of ['hinweisen|verb', 'beweisen|verb', 'nachweisen|verb']) assert.equal(fam(byW.get(w)), 'weisen', w);
  for (const w of ['widersprechen|verb', 'entsprechend|adj', 'vielversprechend|adj']) assert.equal(fam(byW.get(w)), 'sprechen', w);
  for (const w of ['Vorteil|noun', 'Nachteil|noun', 'Anteil|noun']) assert.equal(fam(byW.get(w)), 'teil', w);
  for (const w of ['Absicht|noun', 'Ansicht|noun', 'Aussicht|noun']) assert.equal(fam(byW.get(w)), 'sicht', w);
  for (const w of ['abholen|verb', 'wiederholen|verb']) assert.equal(fam(byW.get(w)), 'holen', w);
  assert.equal(fam(id('bestimmt', 'adv') || id('bestimmen', 'verb')), 'stimmen');
  assert.equal(fam(id('widerlegen', 'verb')), 'legen');
  assert.equal(fam(id('einräumen', 'verb')), 'raum');
  // known false families
  assert.notEqual(fam(id('Zeitung', 'noun')), 'zeit');
  assert.notEqual(fam(id('Gefahr', 'noun')), 'fahren');
  assert.notEqual(fam(id('gehören', 'verb')), 'holen');
  assert.ok(!C.families.some(f => ['Mittel', 'statt', 'zumal'].includes(words.find(w => w.id === f.head).w)), 'Mittel, statt and zumal head no family');
  // one family a word
  const seen = new Set();
  for (const f of C.families) for (const m of f.members) { assert.ok(!seen.has(m), m); seen.add(m); }
});

test('prefixes and separability', () => {
  const m = w => C.morph[id(w, 'verb')];
  assert.deepEqual(m('ausfallen').pre, ['aus']); assert.equal(m('ausfallen').sep, true);
  assert.equal(m('besuchen').sep, false);
  assert.equal(m('übersetzen').sep, false);
  assert.equal(m('umsteigen').sep, true);
  assert.equal(m('widersprechen').sep, false);
  assert.deepEqual(m('behaupten').pre, ['be']);
  assert.ok(!C.morph[id('Mittag', 'noun')].pre, 'Mittag is not mit- + Tag');
  assert.ok(!C.morph[id('Beispiel', 'noun')].pre, 'Beispiel is not bei- + Spiel');
  assert.equal(C.morph[id('Unfall', 'noun')].pre[0], 'un');
});

test('suffix gender rules hold, with their listed exceptions', () => {
  const art = new Map(words.map(w => [w.id, w.art]));
  for (const s of C.suffixes.filter(x => x.pos === 'noun' && x.art)) {
    for (const [wid, m] of Object.entries(C.morph)) if ((m.suf || []).includes(s.id) && words.find(w => w.id === wid)?.pos === 'noun')
      assert.ok(art.get(wid) === s.art || s.except.includes(wid), `${wid} -${s.id}`);
  }
  assert.ok(C.suffixes.find(s => s.id === 'nis').except.includes('die_Erlaubnis'));
});

test('opposites: his pairs are there, spelt right, every member in the word list', () => {
  const has = (a, b) => C.opposites.pairs.some(p => (p.a === a && p.b === b) || (p.a === b && p.b === a));
  for (const [a, b] of [['innen', 'außen'], ['groß', 'klein'], ['nah', 'fern'], ['drinnen', 'draußen'], ['voll', 'leer'], ['früh', 'spät'], ['immer', 'nie'], ['mit', 'ohne'], ['über', 'unter']]) {
    const ia = words.find(w => w.w === a)?.id, ib = words.find(w => w.w === b)?.id;
    assert.ok(ia && ib && has(ia, ib), `${a}–${b}`);
  }
  assert.ok(has('an.adv', 'aus.adv'), 'an–aus as on/off, not as prepositions');
  assert.ok(C.opposites.pairs.length >= 150);
  const byWord = new Set(words.map(w => w.id));
  for (const p of C.opposites.pairs) { assert.ok(byWord.has(p.a)); assert.ok(byWord.has(p.b)); }
});

test('primary pairs place a word once', () => {
  const out = primaryPairs([{ a: 'alt', b: 'neu' }, { a: 'alt', b: 'jung' }, { a: 'heiß', b: 'kalt' }, { a: 'warm', b: 'kalt' }, { a: 'warm', b: 'kühl' }]);
  assert.deepEqual(out.map(p => p.primary), [true, false, true, false, true]);
});

test('prepositions: notes, gap sentences, meiner Meinung nach', () => {
  for (const p of ['bei.prep', 'nach.prep', 'zu.prep', 'in.prep', 'an.prep', 'auf.prep']) assert.ok(C.preps.notes[p]?.note.length > 40, p);
  assert.ok(C.preps.gaps.some(g => g.de.startsWith('Meiner Meinung ___')));
  assert.ok(C.preps.gaps.some(g => g.de.startsWith('___ meiner Meinung')));
  for (const g of C.preps.gaps) assert.equal(g.de.split('___').length, 2, g.id);
  assert.deepEqual(C.preps.notes['meiner_meinung_nach.phrase'] ? true : false, true);
});

test('the validator catches the mistakes it is there for', () => {
  const bad = structuredClone(C);
  bad.families[1].members.push(bad.families[0].members[1]);
  bad.morph[bad.families[0].members[1]].sep = true;
  const ung = Object.keys(bad.morph).find(k => (bad.morph[k].suf || []).includes('ung'));
  const w2 = structuredClone(words); w2.find(w => w.id === ung).art = 'der';
  bad.opposites.pairs.push({ a: 'groß.adj', b: 'groß.adj', group: 'amount', primary: false });
  const errs = validateClusters(bad, { words: w2 }).join('\n');
  assert.match(errs, /is already in family/);
  assert.match(errs, /paired with itself/);
  assert.match(errs, /not die/);
});

test('index: the study clusters of every type', () => {
  const ix = index(C, words);
  for (const t of TYPES) assert.ok(ix.byType[t].length > 0, t);
  const f = ix.byKey.get('family:fallen');
  assert.equal(f.items[0], f.head);
  assert.ok(ix.byKey.get('prefix:be').items.includes(id('behaupten', 'verb')));
  assert.ok(ix.byKey.get('suffix:ung').items.length > 100);
  assert.ok(ix.opposites('groß.adj').includes('klein.adj'));
  assert.ok(ix.byKey.get('prep:places').gaps.length >= 10);
  assert.ok(ix.byType.topic.every(t => t.items.every(w => ['A1', 'A2', 'B1', 'B2'].includes(ix.word(w).level))));
});
