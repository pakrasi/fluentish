// The round 4 German review of the B2 phrase layer (reviews4/german): what the grader accepted as right and the
// sentences it showed as right. Each case here was graded fully right, or shown as the right sentence, before the fix.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildData, errorsIn, lexicon } from '../corpus/grading-corpus.mjs';
import { gradeAnswer, isPhraseCard } from '../../src/features/shared/grade.js';
import { build, clashes, prefixSwap, tokenize } from '../../src/lang/de/conj.js';

const data = await buildData();
const grade = (/** @type {string} */ id, /** @type {string} */ t) => { const it = data.byId.get(id); assert.ok(it, id); return gradeAnswer(it, t, null, data); };
const right = (/** @type {any} */ g) => g.ok && !g.partial;

// fixes.json G1, G2, G4, G5, G6: wrong German the grader took for right
const WRONG = [
  ['K:ENG_CHUNK_1639', 'Der neue Windpark wird im Frühjahr in Betrieb nehmen.'], ['K:ENG_CHUNK_1651', 'Die Geschäftsführung hat dem Team einen Bonus in Aussicht stellen.'],
  ['K:ENG_CHUNK_1657', 'Die Gewerkschaft hat klare Forderungen stellen.'], ['K:ENG_CHUNK_1661', 'Das Team hat in der Krise seine Flexibilität unter Beweis stellen.'],
  ['K:ENG_CHUNK_1671', 'Die Reform hat viele Veränderungen in Gang setzen.'], ['K:ENG_CHUNK_1685', 'Die Verantwortlichen müssen zur Verantwortung ziehen werden.'],
  ['K:ENG_CHUNK_1690', 'Der Verband hat in der Frage klar Position beziehen.'], ['K:ENG_CHUNK_1692', 'Die Werkstatt hat uns die Ersatzteile in Rechnung stellen.'],
  ['K:ENG_CHUNK_1696', 'Der Vorschlag wird am Donnerstag zur Abstimmung stellen.'], ['K:ENG_CHUNK_1705', 'Der Stadtrat hat einen neuen Standort ins Spiel bringen.'],
  ['K:ENG_CHUNK_1706', 'Die Stadt hat einen neuen Fonds für junge Gründer ins Leben rufen.'], ['K:ENG_CHUNK_1714', 'Die Dürre hat besorgniserregende Ausmaße annehmen.'],
  ['K:ENG_CHUNK_1732', 'Das Gericht hat die neue Verordnung außer Kraft setzen.'], ['K:ENG_CHUNK_1741', 'Die neue App hat bei älteren Nutzern großen Anklang finden.'],
  ['K:ENG_CHUNK_1747', 'Das Feuchtgebiet wurde letztes Jahr unter Schutz stellen.'], ['K:ENG_CHUNK_1757', 'Nach zehn Jahren hat sie ihre Kündigung einreichen.'],
  ['K:ENG_CHUNK_1773', 'Das Parlament hat gestern das neue Gesetz verabschieden.'], ['K:ENG_CHUNK_1776', 'Die EU hat neue Sanktionen verhängen.'],
  ['K:ENG_CHUNK_1782', 'Am Ende haben beide Parteien einen Kompromiss schließen.'], ['K:ENG_CHUNK_1793', 'Die Forscher haben eine neue Hypothese aufstellen.'],
  ['K:ENG_CHUNK_1798', 'Die Läuferin hat in Berlin einen neuen Rekord aufstellen.'], ['K:ENG_CHUNK_1806', 'Die Ärztin hat mir ein Rezept ausstellen.'],
  ['K:ENG_CHUNK_1820', 'Die Studie hat eine hitzige Debatte auslösen.'], ['K:ENG_CHUNK_1827', 'Die Stadt hat die ersten Maßnahmen umsetzen.'],
  ['K:ENG_CHUNK_1654', 'Gewerkschaften und Arbeitgeber haben eine Einigung erzielen.'], ['K:ENG_CHUNK_1765', 'Der Unternehmer hat jahrelang Steuern hinterziehen.'],
  ['K:ENG_CHUNK_1491', 'Diese Zahlen sind mit Vorsicht genießen.'], ['K:ENG_CHUNK_1699', 'Es ist schwer, Beruf und Familie in Einklang bringen.'],
  ['K:ENG_CHUNK_1762', 'Die neuen Betten reichen nicht aus, um den Bedarf decken.'], ['K:ENG_CHUNK_1766', 'Die Zentralbank erhöht die Zinsen, um die Inflation bekämpfen.'],
  ['K:ENG_CHUNK_1804', 'Regelmäßige Bewegung hilft, Herzkrankheiten vorbeugen.'], ['K:ENG_CHUNK_1811', 'Ziel ist es, die Erderwärmung auf 1,5 Grad begrenzen.'],
  ['K:ENG_CHUNK_1815', 'Begegnungen helfen, Vorurteile abbauen.'], ['K:ENG_CHUNK_1815', 'Begegnungen helfen, Vorurteile zu abbauen.'],
  ['K:ENG_CHUNK_1828', 'Viele Firmen haben Mühe, Fachkräfte gewinnen.'],
  ['K:ENG_CHUNK_1711', 'Viele alte Bäume fallten dem Sturm zum Opfer.'], ['K:ENG_CHUNK_1644', 'Die neue Straße geratet in Konflikt mit dem Naturschutz.'],
  ['K:ENG_CHUNK_1814', 'Viele Insektenarten sind vom Aussterben gedroht.'], ['K:ENG_CHUNK_1682', 'Nach der Ankündigung geratet viele Anleger in Panik.'],
  ['K:ENG_CHUNK_1673', 'Die Stadt treffen Vorkehrungen gegen Hochwasser.'], ['K:ENG_CHUNK_1640', 'Eltern tragt die Verantwortung für die Sicherheit ihrer Kinder im Internet.'],
  ['K:ENG_CHUNK_1619', 'Mit großem Interesse habe ich ihre Stellenanzeige gelesen.'], ['K:ENG_CHUNK_1624', 'Ich möchte ihnen mitteilen, dass ich vom 1. bis 15. August nicht im Büro bin.'],
  ['K:ENG_CHUNK_1594', 'Könnten sie das näher erläutern? Ich bin mir nicht sicher, was sie meinen.'], ['K:ENG_CHUNK_1744', 'Unsere Berater stehen ihnen während des Bewerbungsverfahrens zur Seite.'],
];
test('B2 phrases: the review\'s wrong German is never graded right', () => {
  const bad = WRONG.filter(([id, t]) => right(grade(id, t))).map(([id, t]) => `${id}: ${t}`);
  assert.deepEqual(bad, []);
  // the tragt slip is not corrected to trägt (the subject is plural)
  assert.ok(!grade('K:ENG_CHUNK_1640', 'Eltern tragt die Verantwortung für die Sicherheit ihrer Kinder im Internet.').umlautMiss.some((/** @type {any} */ u) => u.expected === 'trägt'));
});

test('every phrase card: its own sentence is right, and the sentence shown for it is the sentence itself', () => {
  const bad = [];
  for (const it of [...data.pool, ...data.b2]) {
    if (!isPhraseCard(it)) continue;
    const s = it.sentence || it.model;
    if (!s || /…/.test(s)) continue;
    const g = gradeAnswer(it, s, null, data);
    if (!right(g)) bad.push(`${it.id}: ${s} is not right`);
    else if (g.rest && g.rest.ref && g.rest.ref !== s) bad.push(`${it.id}: ${s} shows ${g.rest.ref}`);
  }
  assert.deepEqual(bad, []);
});

test('B2 phrases: the sentence shown on a partly right answer is right German (the model or an accepted sentence)', () => {
  const lex = lexicon();
  const bad = [];
  let n = 0;
  for (const it of data.b2) {
    if (!isPhraseCard(it) || !it.sentence) continue;
    for (const e of errorsIn(it.sentence, { lex }).slice(0, 4)) {
      const g = gradeAnswer(it, e.text, null, data);
      if (!g.partial) continue;
      n++;
      const r = gradeAnswer(it, g.rest.ref, null, data);
      if (!right(r) || /\b(\p{L}+) \1\b/iu.test(g.rest.ref)) bad.push(`${it.id}: ${e.text} → ${g.rest.ref}`);
    }
  }
  assert.ok(n > 300, `${n} partly right answers`);
  assert.deepEqual(bad, []);
  // the review's cases: a whole sentence, the model's number and lower case after an ordinal
  assert.equal(grade('K:ENG_CHUNK_1711', 'Viele alte Bäume fielen den Sturm zum Opfer.').rest.ref, 'Viele alte Bäume fielen dem Sturm zum Opfer.');
  assert.doesNotMatch(grade('K:ENG_CHUNK_1636', 'Bei Brückenprüfungen werden Drohnen eingesetzt.').right, /kommt Drohnen/);
  assert.doesNotMatch(grade('K:ENG_CHUNK_1624', 'Hiermit teile ich Ihnen mit, dass ich vom 1. bis 15. August nicht im Büro bin.').right, /1\. Bis/);
});

test('German verb forms: forms, misbuilt forms, prefix swaps and the frames that decide a form', () => {
  const c = build([{ pos: 'verb', w: 'fallen', forms: 'fällt · fiel · ist gefallen' }, { pos: 'verb', w: 'treffen', forms: 'trifft · traf · hat getroffen' },
    { pos: 'verb', w: 'ziehen', forms: 'zieht · zog · hat gezogen' }, { pos: 'verb', w: 'machen', forms: 'macht · machte · hat gemacht' }], null, ['hinterziehen', 'abbauen', 'decken']);
  const k = (/** @type {string} */ w) => tokenize(w)[0].n;
  const slots = (/** @type {string} */ w) => c.lookup(k(w)).map(a => `${a.lemma}:${a.slot}`).sort();
  assert.deepEqual(slots('hinterzogen'), ['hinterziehen:1p', 'hinterziehen:pp']);
  assert.deepEqual(slots('abzubauen'), ['abbauen:zu']);
  assert.ok(slots('fiele').includes('fallen:3s'));
  for (const w of ['fallten', 'fallte', 'gefallt', 'getrefft']) assert.ok(c.misbuilt(k(w)), w);
  for (const w of ['machte', 'gemacht', 'fiel', 'machten', 'arbeitten']) assert.ok(!c.misbuilt(k(w)), w);   // real forms, and a weak verb's typo
  assert.ok(prefixSwap('gedroht', 'bedroht') && prefixSwap('gebedroht', 'bedroht') && !prefixSwap('gezahlt', 'bezahlt'));
  const cl = (/** @type {string} */ a, /** @type {string} */ b) => clashes(tokenize(a), tokenize(b), b, c).map(x => x.kind);
  assert.deepEqual(cl('Er hat Steuern hinterziehen.', 'Er hat Steuern hinterzogen.'), ['form']);
  assert.deepEqual(cl('Die Stadt treffen Vorkehrungen.', 'Die Stadt trifft Vorkehrungen.'), ['number']);
  assert.deepEqual(cl('Sie bauen ab, um den Bedarf decken.', 'Sie bauen ab, um den Bedarf zu decken.'), ['zu-missing']);
  assert.deepEqual(cl('Die Stadt traf Vorkehrungen.', 'Die Stadt trifft Vorkehrungen.'), []);                     // another tense
  assert.deepEqual(cl('Die Städte treffen Vorkehrungen.', 'Die Stadt trifft Vorkehrungen.'), []);                 // another subject
  assert.deepEqual(cl('Er hat Steuern hinterzogen.', 'Er will Steuern hinterziehen.'), []);                      // another frame
});
