// The French language pack (src/lang/fr/, C3b): text, the accent slip and its exceptions, the closed class, gender
// through the article (elided l' included), the word card's verb forms, the detectors (each with its wrong cases and
// a zero-fire check over every correct French sentence of the content), voices and case.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fr from '../../src/lang/fr/index.js';
import * as Match from '../../src/domain/match.js';
import Det from '../../src/domain/detect.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const J = (/** @type {string} */ p) => JSON.parse(readFileSync(path.join(ROOT, p), 'utf8'));
const raws = (/** @type {string} */ s) => fr.text.tokenize(fr.text.normalize(s)).map(t => t.raw);
const B1 = { pack: fr, endings: true, umlaut: true, slotMax: 10 };
const check = (/** @type {string} */ typed, /** @type {string[]} */ acc, o = {}) => Match.check(typed, acc, { ...B1, ...o });
const det = (/** @type {string} */ s) => Det.run(s, {}, null, {}, fr);

test('fr text: elision splits (l\', qu\', jusqu\'), aujourd\'hui is one word; NFC; no-break spaces before ; : ! ? are spaces', () => {
  assert.deepEqual(raws("L'ami qu'il voit jusqu'à aujourd'hui"), ["L'", 'ami', "qu'", 'il', 'voit', "jusqu'", 'à', "aujourd'hui"]);
  assert.equal(fr.text.normalize('Ça va ? Oui !'), 'Ça va ? Oui !');
  assert.equal(fr.text.normalize('été'), 'été');
  assert.deepEqual(raws('« Bonjour » ; non'), ['Bonjour', 'non']);
  assert.equal(fr.grading.caseSensitive, 'proper');
  assert.deepEqual([fr.bcp47, fr.speech.tts.locales, fr.speech.asr?.locale], ['fr-FR', ['fr-FR'], 'fr-FR']);
  assert.ok(!fr.speech.tts.prefer?.test('Multilingual'));
});

test('fr accents: kept in the key; a dropped accent is a slip (right, listed), except the meaning pairs and a participle\'s final é', () => {
  // a slip: right, rated Hard by the round (umlautMiss is the mark-slip list)
  for (const [typed, want] of [['la fenetre', 'la fenêtre'], ['tres bien', 'très bien'], ['ca va', 'ça va'], ["l'ecole", "l'école"], ["l'ete dernier", "l'été dernier"], ['une arrivee', 'une arrivée']]) {
    const r = check(typed, [want]);
    assert.equal(r.ok, true, typed); assert.equal(r.exact, false, typed); assert.ok((r.umlautMiss || []).length > 0, typed);
  }
  // the meaning pairs: wrong
  for (const [typed, want] of [['ou est la gare', 'où est la gare'], ['il a la maison', 'il à la maison'], ['je suis la', 'je suis là'], ['je suis sur', 'je suis sûr'], ['des demain', 'dès demain']])
    assert.equal(check(typed, [want]).ok, false, typed);
  // a participle's final é left out is the present tense: wrong; a noun in -é keeps the slip
  for (const [typed, want] of [["j'ai mange", "j'ai mangé"], ["j'ai rate le bus", "j'ai raté le bus"], ['ils sont fatigues', 'ils sont fatigués']]) assert.equal(check(typed, [want]).ok, false, typed);
  assert.equal(check('un cafe', ['un café']).ok, true);
  assert.equal(check('la verite', ['la vérité']).ok, true);
  // an accent that is not there, or another accent: wrong
  assert.equal(check('il à faim', ['il a faim']).ok, false);
  assert.equal(check('le pére', ['le père']).ok, false);
  // œ typed oe is the same word
  assert.equal(check('ma soeur', ['ma sœur']).ok, true);
  assert.deepEqual(check('ma soeur', ['ma sœur']).umlautMiss, []);
});

test('fr closed class: articles, pronouns and prepositions are never typos', () => {
  for (const [typed, want] of [['le maison', 'la maison'], ['un idée', 'une idée'], ['je vais a Paris', 'je vais à Paris'], ['il parle avec moi', 'il parle avec toi'], ['je pense de toi', 'je pense à toi'], ['dans la rue', 'sur la rue']])
    assert.equal(check(typed, [want]).ok, false, typed);
  // a real typo in an open word is still forgiven
  assert.equal(check('la maisson', ['la maison']).ok, true);
  for (const w of ['le', 'la', "l'", 'les', 'un', 'une', 'des', 'du', 'de', 'au', 'aux', 'je', 'vous', 'à', 'dans', 'chez']) assert.ok(fr.grading.closedClass.has(w), w);
});

test('fr gender: through the article, l\' included; the word card accepts the definite or indefinite article of its gender and names it', () => {
  const words = [{ id: 'école.noun', w: 'école', pos: 'noun', art: "l'", g: 'f', pl: 'écoles', en: ['school'], level: 'A1' },
    { id: 'hôtel.noun', w: 'hôtel', pos: 'noun', art: "l'", g: 'm', pl: 'hôtels', en: ['hotel'], level: 'A1' },
    { id: 'maison.noun', w: 'maison', pos: 'noun', art: 'la', g: 'f', pl: 'maisons', en: ['house'], level: 'A1' },
    { id: 'aller.verb', w: 'aller', pos: 'verb', forms: 'il va · il est allé · il allait · il ira', aux: 'être', pp: 'allé', en: ['to go'], level: 'A1' },
    { id: 'grand.adj', w: 'grand', pos: 'adj', fem: 'grande', before: true, en: ['big'], level: 'A1' }];
  const F = fr.grammar.forms, ix = F.formsIndex(words, null);
  const ecole = /** @type {any} */ (F.formsOf(ix, { lemma: 'école', pos: 'noun', id: 'W:école.noun' }));
  assert.deepEqual(ecole.accept, ["l'école", 'une école']);
  assert.equal(ecole.line, "l'école (f) · une école");
  assert.equal(ecole.plural, 'les écoles');
  assert.deepEqual(/** @type {any} */ (F.formsOf(ix, { lemma: 'hôtel', pos: 'noun', id: 'W:hôtel.noun' })).accept, ["l'hôtel", 'un hôtel']);
  assert.equal(/** @type {any} */ (F.formsOf(ix, { lemma: 'maison', pos: 'noun', id: 'W:maison.noun' })).line, 'la maison (f)');
  // graded: either article of the right gender is right; the other gender, or le/la before a vowel, is wrong
  assert.equal(check("l'école", ecole.accept, { literal: true }).ok, true);
  assert.equal(check('une école', ecole.accept).ok, true);
  assert.equal(check('un école', ecole.accept).ok, false);
  assert.equal(check('la école', ecole.accept).ok, false);
  assert.equal(check('école', ecole.accept).ok, false);
  // verbs: infinitive, présent, passé composé with its auxiliary, imparfait, futur; the agreement note with être
  const aller = /** @type {any} */ (F.formsOf(ix, { lemma: 'aller', pos: 'verb', id: 'W:aller.verb' }));
  assert.equal(aller.line, 'aller · il va · il est allé · il allait · il ira');
  assert.match(String(/** @type {any} */ (F).formNote(words[3])), /elle est allée, ils sont allés/);
  assert.equal(/** @type {any} */ (F.formsOf(ix, { lemma: 'grand', pos: 'adj', id: 'W:grand.adj' })).line, 'grand · grande');
  assert.equal(fr.grammar.gender?.toIndefinite('la maison'), 'une maison');
  assert.deepEqual(fr.grammar.gender?.elided, ["l'"]);
  assert.equal(fr.grammar.cases, null);
});

test('fr detectors: each fires on its error', () => {
  for (const [s, cls] of [["Hier, j'ai allé au cinéma.", 'aux-etre'], ["Je n'ai pas parti.", 'aux-etre'], ["Je m'ai levé tôt.", 'aux-etre'], ['Il est arrivé, puis il a tombé.', 'aux-etre'],
    ['Je ne pas parle anglais.', 'ne-pas'], ['Je ne suis allé pas au cinéma.', 'ne-pas'], ["Il n'a fini pas.", 'ne-pas'],
    ['Elle est allé à Paris.', 'agree-etre'], ['Elles sont parti hier.', 'agree-etre'],
    ['Je aime le café.', 'elision'], ['Parce que il pleut.', 'elision'], ['Le ami de Paul.', 'elision'], ['Si il pleut, on reste.', 'elision']]) {
    assert.equal(det(s)?.cls, cls, s);
  }
  for (const s of ['Il a monté les valises.', 'Elle a sorti la poubelle.', 'Pour ne pas oublier, je note.', 'Paul et elle sont partis.', 'Le héros arrive.', 'Le onze novembre.', "Il m'a dit non.", 'Le yaourt est bon.'])
    assert.equal(det(s), null, s);
});

/** Every correct French sentence the content has: the chunk examples, the course models, the sentence bank, the framework items' examples, the word list's examples. */
function frenchSentences() {
  const out = [];
  for (const c of Object.values(J('content/igloo/chunks/french.json').chunks)) if (/** @type {any} */ (c).ex) out.push(/** @type {any} */ (c).ex);
  for (const v of Object.values(J('content/igloo/sentences/french.json').variants)) out.push(/** @type {any} */ (v).tokens.map((/** @type {any} */ t) => t[0]).join(' '));
  const lang = J('content/igloo/lang/french.json');
  for (const it of lang.items) if (it.example && it.example.target) out.push(...String(it.example.target).split(/\s+[—–]\s+/));
  for (const sc of lang.scenarios || []) if (sc.model && sc.model.target) out.push(sc.model.target);
  for (const w of J('content/igloo/words/fr.json')) if (w.ex) out.push(w.ex);
  return out;
}

test('fr detectors: none fires on a correct sentence of the content (zero-fire corpus)', () => {
  const all = frenchSentences();
  assert.ok(all.length > 2000, `${all.length} sentences`);
  const hits = all.map(s => [s, det(s)]).filter(([, d]) => d).map(([s, d]) => `${/** @type {any} */ (d).cls}: ${s}`);
  assert.deepEqual(hits, []);
});
