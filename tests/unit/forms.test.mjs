// Word cards (domain/forms.js, domain/wordcard.js): the dictionary form, the key forms, ONE example, how common the
// word is, and prompts that never give the answer away. Over the whole content, and over the owner's exam words when
// their private list is on this machine (tests/private/vocab.json, git-ignored).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import * as F from '../../src/domain/forms.js';
import * as WC from '../../src/domain/wordcard.js';
import { index } from '../../src/domain/clusters.js';
import * as CI from '../../src/features/practice/clusters/items.js';
import * as W from '../../src/features/practice/words.js';
import { gradeAnswer } from '../../src/features/practice/grade.js';

const J = p => JSON.parse(readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8'));
const WORDS = J('content/igloo/words/de.json'), FORMS = J('content/b1/forms.json'), CL = J('content/clusters/de.json');
const IX = F.formsIndex(WORDS, FORMS);
const FX = { ix: IX, verbs: F.verbSet(IX) };
const t = (k, v) => `${k} ${JSON.stringify(v || {})}`;

test('the forms content is valid: every verb of the word list has its forms, no word has two sources', () => {
  assert.deepEqual(F.validateForms(FORMS, WORDS), []);
});

test('key forms: verbs, nouns, adjectives', () => {
  const zieh = F.formsOf(IX, { lemma: 'ziehen', pos: 'Verb' });
  assert.equal(zieh.line, 'ziehen – zog – hat/ist gezogen');
  assert.equal(zieh.pres, null, 'zieht is the regular present');
  assert.equal(F.formsOf(IX, { lemma: 'fahren', pos: 'Verb' }).pres, 'er fährt');
  assert.equal(F.formsOf(IX, { lemma: 'nehmen', pos: 'Verb' }).pres, 'er nimmt');
  assert.equal(F.formsOf(IX, { lemma: 'machen', pos: 'Verb' }).pres, null);
  assert.equal(F.formsOf(IX, { lemma: 'arbeiten', pos: 'Verb' }).pres, null, 'arbeitet: e-insertion is regular');
  const bew = F.formsOf(IX, { lemma: 'bewerben', pos: 'Verb' });
  assert.equal(bew.head, 'sich bewerben'); assert.equal(bew.line, 'sich bewerben – bewarb sich – hat sich beworben'); assert.equal(bew.pres, 'er bewirbt sich');
  assert.deepEqual(bew.accept, ['sich bewerben', 'bewerben']);
  const ab = F.formsOf(IX, { lemma: 'abfahren', pos: 'Verb' });
  assert.equal(ab.line, 'abfahren – fuhr ab – ist abgefahren'); assert.equal(ab.pres, 'er fährt ab');
  const rauch = F.formsOf(IX, { lemma: 'Rauch', pos: 'Nomen' });
  assert.equal(rauch.head, 'der Rauch'); assert.equal(rauch.pluralNote, 'none'); assert.deepEqual(rauch.accept, ['der Rauch']);
  assert.equal(F.formsOf(IX, { lemma: 'Zaun', pos: 'Nomen' }).plural, 'die Zäune');
  assert.equal(F.formsOf(IX, { lemma: 'Öffnungszeiten', pos: 'Nomen' }).pluralNote, 'only');
  assert.deepEqual(F.formsOf(IX, { lemma: 'Freiwillige', pos: 'Nomen' }).accept, ['der Freiwillige', 'die Freiwillige']);
  assert.equal(F.formsOf(IX, { lemma: 'gut', pos: 'Adjektiv' }).line, 'gut – besser – am besten');
  assert.equal(F.formsOf(IX, { lemma: 'zufrieden', pos: 'Adjektiv' }).line, null, 'a regular comparison is not shown');
});

test('strong and irregular verbs in the forms are right', () => {
  const want = {
    gehen: 'geht · ging · ist gegangen', sein: 'ist · war · ist gewesen', haben: 'hat · hatte · hat gehabt', werden: 'wird · wurde · ist geworden',
    bringen: 'bringt · brachte · hat gebracht', denken: 'denkt · dachte · hat gedacht', wissen: 'weiß · wusste · hat gewusst', lesen: 'liest · las · hat gelesen',
    sprechen: 'spricht · sprach · hat gesprochen', laufen: 'läuft · lief · ist gelaufen', schlafen: 'schläft · schlief · hat geschlafen', bleiben: 'bleibt · blieb · ist geblieben',
    stinken: 'stinkt · stank · hat gestunken', beißen: 'beißt · biss · hat gebissen', übernehmen: 'übernimmt · übernahm · hat übernommen', loswerden: 'wird los · wurde los · ist losgeworden',
  };
  for (const [w, f] of Object.entries(want)) assert.equal(IX.verbs.get(w)?.forms, f, w);
});

test('the example: his exam sentence cut to the one clause with the word', () => {
  const c = F.exampleClause('Ein Beispiel: Familie Öztürk grillte im Sommer fast jeden Abend, der Rauch zog in die Wohnung von Herrn Lange im ersten Stock.', 'zog', { verbs: FX.verbs });
  assert.equal(c.text, 'Der Rauch zog in die Wohnung.');
  assert.equal(c.text.slice(c.start, c.end), 'zog');
  assert.equal(F.exampleClause('Vor drei Wochen sind wir umgezogen: aus einer Dreizimmerwohnung mitten in Frankfurt.', 'umgezogen').text, 'Vor drei Wochen sind wir umgezogen.');
  // a clause that cannot stand alone falls back
  assert.equal(F.exampleClause('Ich weiß nicht, wie man sich richtig bewirbt.', 'bewirbt'), null, 'a subordinate clause');
  assert.equal(F.exampleClause('Deshalb bin ich froh, dass meine Firma wieder Präsenztage verlangt.', 'froh'), null, 'its object follows');
  assert.equal(F.exampleClause('Die gelbe Tonne.', 'gelbe', { verbs: FX.verbs }), null, 'a heading is not a sentence');
  assert.equal(F.exampleClause('Die Kirche ist aus dem 12. Jahrhundert.', 'Jahrhundert').text, 'Die Kirche ist aus dem 12. Jahrhundert.');
  // the exam word card: ziehen
  const it = W.toItem({ id: 'W:ziehen.verb', lemma: 'ziehen', art: null, pl: null, pos: 'Verb', gloss: ['to drift', 'to pull'], form: 'zog', ex: null, cluster: null, day: 2, module: 'lesen',
    sent: 'Ein Beispiel: Familie Öztürk grillte im Sommer fast jeden Abend, der Rauch zog in die Wohnung von Herrn Lange im ersten Stock.', examDays: 11, level: 'A2', conf: null, zipf: 5.05 }, FX);
  assert.equal(it.prompt, 'to drift, to pull'); assert.equal(it.card.type, 'verb'); assert.deepEqual(it.accept, ['ziehen']);
  assert.equal(it.card.forms, 'ziehen – zog – hat/ist gezogen');
  assert.equal(it.card.ex, 'Der Rauch zog in die Wohnung.'); assert.equal(it.card.exSrc, 'From Test 2 · Lesen');
  assert.equal(gradeAnswer(it, 'ziehen').ok, true); assert.equal(gradeAnswer(it, 'zog').ok, false); assert.equal(gradeAnswer(it, 'gezogen').ok, false);
  // a noun is typed with its article; a reflexive verb with or without sich
  const rauch = W.toItem({ id: 'BW:rauch', lemma: 'Rauch', art: 'der', pl: '–', pos: 'Nomen', gloss: ['smoke'], form: 'Rauch', ex: null, sent: 'Der Rauch zog in die Wohnung.', day: 2, module: 'lesen', zipf: 4.17 }, FX);
  assert.equal(gradeAnswer(rauch, 'der Rauch').ok, true); assert.equal(gradeAnswer(rauch, 'die Rauch').ok, false); assert.equal(gradeAnswer(rauch, 'Rauch').ok, false);
  const bew = W.toItem({ id: 'BW:bewerben', lemma: 'bewerben', pos: 'Verb', gloss: ['to apply'], form: 'bewerben', ex: null, sent: 'Ich möchte mich bei einer Firma bewerben.', day: 1, module: 'hoeren' }, FX);
  assert.equal(gradeAnswer(bew, 'bewerben').ok, true); assert.equal(gradeAnswer(bew, 'sich bewerben').ok, true); assert.equal(gradeAnswer(bew, 'bewirbt').ok, false);
  // the card id is the word's id as before: its schedule carries over
  assert.equal(it.id, 'W:ziehen.verb'); assert.equal(rauch.id, 'BW:rauch');
});

test('how common a word is: 5 bars and a plain band; lists go most common first', () => {
  assert.deepEqual(WC.freq(6.3), { bars: 5, band: 'very' });
  assert.deepEqual(WC.freq(4.5), { bars: 3, band: 'common' });
  assert.deepEqual(WC.freq(2.9), { bars: 1, band: 'less' });
  assert.equal(WC.freq(null), null);
  assert.deepEqual(WC.byFrequency([{ z: 3 }, { z: 6 }, { z: null }, { z: 4 }], x => x.z).map(x => x.z), [6, 4, 3, null]);
  const cix = index(CL, WORDS);
  for (const cl of cix.all.filter(c => c.type !== 'family' && c.type !== 'opp' && c.type !== 'prep')) {
    const z = cl.items.map(id => cix.word(id).zipf || 0);
    assert.ok(z.every((x, i) => i === 0 || z[i - 1] >= x), `${cl.key} lists its words most common first`);
  }
});

test('a prompt never gives its answer away', () => {
  const forms = WC.answerForms(['die Sicht']);
  assert.equal(WC.maskAnswer('point of view (aus meiner Sicht)', forms, 'die Sicht'), 'point of view (aus meiner …)');
  assert.deepEqual(WC.leaks('point of view (aus meiner …)', forms, 'die Sicht'), []);
  assert.equal(WC.maskAnswer('hotel', WC.answerForms(['das Hotel']), 'das Hotel'), 'hotel', 'the English word for a cognate is its meaning');
  assert.equal(WC.maskAnswer('to move (wir ziehen um)', WC.answerForms(['ziehen'], F.formsOf(IX, { lemma: 'ziehen', pos: 'Verb' }).surface), 'ziehen'), 'to move (wir … um)');
});

/** Every card whose item is one word, over the whole content: Word clusters (families, opposites, prefixes, suffixes, topics) and every typable word of the list. */
function clusterItems() {
  const cix = index(CL, WORDS);
  const ids = new Set();
  for (const cl of cix.all) for (const id of CI.cardIds(cl, cix)) ids.add(id);
  for (const w of WORDS) if (CI.typable(w)) ids.add(`W:${w.id}`);
  return [...ids].map(id => CI.itemFor(id, cix, CL, { t, fx: FX })).filter(it => it && it.card && it.card.type);
}

test('every word card in the content: its type, ONE example with the word in it, a prompt that does not give the answer', () => {
  const items = clusterItems();
  assert.ok(items.length > 4000, `${items.length} word cards`);
  const bad = [];
  for (const it of items) {
    const c = it.card;
    if (!c.type || c.type === 'word') bad.push(`${it.id}: no word type`);
    if (!c.ex) { bad.push(`${it.id}: no example`); continue; }
    const [a, b] = c.exAt || [0, 0];
    if (!(b > a)) bad.push(`${it.id}: the example does not mark the word`);
    if (c.ex.split(/\s+/).length > 16) bad.push(`${it.id}: the example is long (${c.ex})`);
    const forms = WC.answerForms(it.accept);
    for (const txt of [it.prompt, it.gloss, it.task].filter(Boolean)) {
      if (it.promptLang === 'de' && txt === it.prompt) continue;   // an opposite's prompt is the other German word
      const l = WC.leaks(txt, forms, it.model);
      if (l.length) bad.push(`${it.id}: "${txt}" shows ${l.join(', ')}`);
    }
  }
  assert.deepEqual(bad, []);
});

test('a word family prompt names its head, never the answer', () => {
  const cix = index(CL, WORDS);
  const bad = [];
  for (const cl of cix.all.filter(c => c.type === 'family')) {
    for (const id of CI.cardIds(cl, cix).filter(x => x.startsWith('CF:'))) {
      const it = CI.itemFor(id, cix, CL, { t, fx: FX });
      if (!it) continue;
      // the head ("die Sicht") is a part of the answer ("die Vorsicht") by design; it must not be the answer itself
      const head = CI.form(cix.word(cl.head));
      if (it.accept.some(a => a.toLowerCase() === head.toLowerCase())) bad.push(`${id}: the family head ${head} is the answer`);
      const l = WC.leaks(it.prompt, WC.answerForms(it.accept), it.model);
      if (l.length) bad.push(`${id}: the meaning shows ${l.join(', ')}`);
    }
  }
  assert.deepEqual(bad, []);
});

// The owner's exam words: only on his Mac (the list is private). Every card has its forms and one example with the word.
const PRIVATE = new URL('../private/vocab.json', import.meta.url);
test('every exam word card has its forms and one example with the word (private list)', { skip: !existsSync(PRIVATE) && 'tests/private/vocab.json is not on this machine' }, () => {
  const body = JSON.parse(readFileSync(PRIVATE, 'utf8'));
  const words = W.trimWords(Array.isArray(body) ? body : body.words, J('content/b1/wordmap.json'));
  assert.ok(words.length > 100);
  const bad = [];
  for (const w of words) {
    const it = W.toItem(w, FX);
    const c = it.card;
    const f = F.formsOf(IX, { lemma: w.lemma, pos: w.pos, id: w.id });
    if (!f) bad.push(`${w.id}: no forms`);
    if (!c.ex) bad.push(`${w.id}: no example`);
    else if (!(c.exAt && c.exAt[1] > c.exAt[0])) bad.push(`${w.id}: the example does not mark the word`);
    const l = WC.leaks(it.prompt, WC.answerForms(it.accept, f ? f.surface : []), it.model);
    if (l.length) bad.push(`${w.id}: the prompt shows ${l.join(', ')}`);
  }
  assert.deepEqual(bad, []);
});
