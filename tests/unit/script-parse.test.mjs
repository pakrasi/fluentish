// Script mode: reading a pasted script (src/features/practice/script/parse.js). Fixtures are a synthetic talk about
// how a bicycle works, in plain German and in the EN/DE pair format with parts, ROLLUP and skipped blocks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as P from '../../src/features/practice/script/parse.js';

const de = fs.readFileSync(new URL('../fixtures/script-bicycle.md', import.meta.url), 'utf8');
const pairs = fs.readFileSync(new URL('../fixtures/script-bicycle-pairs.md', import.meta.url), 'utf8');

test('detect: German, pairs, English, notes', () => {
  assert.deepEqual(P.detect(de), { format: 'de', lang: 'de', words: 128, sections: 3 });
  const d = P.detect(pairs);
  assert.equal(d.format, 'pairs'); assert.equal(d.sections, 3);
  assert.equal(P.detect('Today I want to show you how a bicycle works. The frame is the heart of it, and it has to be light.').format, 'en');
  assert.equal(P.detect('- Rahmen aus Stahl\n- Kette und Zahnräder\n- Bremsen prüfen\n- Dank').format, 'notes');
  // alternating English and German lines without markers
  const alt = 'The frame is the heart of the bike.\nDer Rahmen ist das Herz des Fahrrads.\nThe chain drives the rear wheel.\nDie Kette treibt das Hinterrad an.';
  assert.equal(P.detect(alt).format, 'pairs');
  const s = P.parseScript(alt, { format: 'pairs', id: P.counterIds() });
  assert.deepEqual(s.sections[0].sentences.map(x => [x.de, x.en]), [
    ['Der Rahmen ist das Herz des Fahrrads.', 'The frame is the heart of the bike.'],
    ['Die Kette treibt das Hinterrad an.', 'The chain drives the rear wheel.']]);
});

test('plain German: sections from headings, sentences, the title and a slide note', () => {
  const s = P.parseScript(de, { id: P.counterIds() });
  assert.equal(s.title, 'Wie ein Fahrrad funktioniert');
  assert.deepEqual(s.sections.map(x => x.title), ['Der Rahmen', 'Kette und Gangschaltung', 'Bremsen']);
  assert.deepEqual(s.sections.map(x => x.sentences.length), [4, 4, 4]);
  assert.equal(s.sections[0].note, 'Folien 1–2');
  assert.equal(s.sections[2].sentences[3].de, 'Vielen Dank fürs Zuhören!');
  assert.ok(s.sections.every(x => x.kind === 'talk'));
  const ids = s.sections.flatMap(x => [x.id, ...x.sentences.map(y => y.id)]);
  assert.equal(new Set(ids).size, ids.length, 'every id is unique in the script');
});

test('pairs: English kept, parts before a ✦ line, bold words, ROLLUP, skipped blocks', () => {
  const s = P.parseScript(pairs, { id: P.counterIds() });
  assert.equal(s.title, 'Fahrrad-Vortrag · Lern-Edition');
  assert.deepEqual(s.sections.map(x => x.title), ['Der Rahmen', 'Der Rahmen · 2', 'Die Kette']);
  const [a, b, c] = s.sections;
  assert.equal(a.sentences.length, 2);
  assert.equal(a.sentences[1].de, 'Der Rahmen verbindet alle Teile miteinander und muss gleichzeitig leicht und stabil sein.');
  assert.equal(a.sentences[1].en, 'The frame connects all parts and has to be light and stable at the same time.');
  assert.deepEqual(a.sentences[1].parts, ['Der Rahmen verbindet alle Teile miteinander', 'und muss gleichzeitig leicht und stabil sein.']);
  assert.equal(b.note, 'Folien 1–2');
  assert.deepEqual(b.sentences.map(x => x.de), ['Viele Rahmen sind heute aus Aluminium oder Carbon.'], 'Vertiefung and Publikumsfragen are not spoken text');
  assert.equal(c.sentences.length, 2);
  assert.deepEqual(s.bold.map(x => x.surface), ['Rahmen', 'gleichzeitig', 'Kette', 'Hinterrad']);
  assert.equal(s.bold[0].sentenceId, a.sentences[1].id, 'bold words in parts attach to the full sentence');
  assert.ok(s.names.includes('carbon') && s.names.includes('bicycle'));
  assert.ok(!s.names.includes('the'), 'English stop words are not names');
});

test('headings: chapter numbers and slide notes come off the title', () => {
  const s = P.parseScript('## Kapitel 2 — Die Kette *(Folie 3)*\n\nDie Kette überträgt die Kraft.', { id: P.counterIds() });
  assert.equal(s.sections[0].title, 'Die Kette');
  assert.equal(s.sections[0].note, 'Folie 3');
});

test('a pair with several sentences is split when both sides agree', () => {
  const t = '1. **EN**: The chain is oiled. It runs quietly.\n   **DE**: Die Kette ist geölt. Sie läuft leise.\n\n2. **EN**: Thanks.\n   **DE**: Danke. Das war es.';
  const s = P.parseScript(t, { format: 'pairs', id: P.counterIds() });
  assert.deepEqual(s.sections[0].sentences.map(x => [x.de, x.en]), [
    ['Die Kette ist geölt.', 'The chain is oiled.'], ['Sie läuft leise.', 'It runs quietly.'], ['Danke. Das war es.', 'Thanks.']]);
});

test('no headings: paragraphs make sections, a long run is split near 150 words', () => {
  const para = 'Das Fahrrad steht im Keller und wartet auf den Frühling. ';
  const t = `${para.repeat(3)}\n\n${para.repeat(3)}\n\n${para.repeat(30)}`;
  const s = P.parseScript(t, { id: P.counterIds() });
  const words = s.sections.map(P.sectionWords);
  assert.ok(s.sections.length >= 3, 'the long paragraph is split');
  assert.ok(words.every(w => w <= 220), `no section over 220 words: ${words}`);
  assert.equal(P.scriptWords(s), 36 * 10);
});

test('splitSentences: abbreviations, numbers and quotes', () => {
  assert.deepEqual(P.splitSentences('Das ist z. B. ein Rad. Am 3. Oktober fahren wir los. Dr. Weber sagt: „Gut.“ Dann gehen wir.'),
    ['Das ist z. B. ein Rad.', 'Am 3. Oktober fahren wir los.', 'Dr. Weber sagt: „Gut.“', 'Dann gehen wir.']);
  assert.deepEqual(P.splitSentences('Wirklich? Ja! Und dann…'), ['Wirklich?', 'Ja!', 'Und dann…']);
});

test('tokenize: compounds stay whole, punctuation and quotes are their own tokens', () => {
  const t = P.tokenize('Die Gangschaltung – das „Herz“ des E-Bikes – funktioniert, 2 Mal.');
  assert.deepEqual(t.filter(x => x.w).map(x => x.t), ['Die', 'Gangschaltung', 'das', 'Herz', 'des', 'E-Bikes', 'funktioniert', '2', 'Mal']);
  assert.deepEqual(t.filter(x => x.w).map(x => x.k), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.ok(t.find(x => x.t === '„').w === false && t.find(x => x.t === '2').num);
  assert.equal(P.wordCount('Die Kette, das Rad.'), 4);
});

test('long sentences: flagged over 25 words, split only where two main clauses meet', () => {
  const long = 'Das Team hat drei Monate lang jeden Abend an dem neuen Prototyp gearbeitet, aber die Ergebnisse waren am Ende leider nicht so gut wie wir gehofft hatten.';
  assert.ok(P.isLong(long));
  assert.deepEqual(P.splitLocal(long), ['Das Team hat drei Monate lang jeden Abend an dem neuen Prototyp gearbeitet.', 'Aber die Ergebnisse waren am Ende leider nicht so gut wie wir gehofft hatten.']);
  assert.deepEqual(P.splitLocal('Am Anfang hatten wir nur wenig Zeit und sehr wenig Geld für das ganze Projekt; trotzdem haben wir es am Ende mit viel Arbeit gemeinsam geschafft.'),
    ['Am Anfang hatten wir nur wenig Zeit und sehr wenig Geld für das ganze Projekt.', 'Trotzdem haben wir es am Ende mit viel Arbeit gemeinsam geschafft.']);
  assert.equal(P.splitLocal('Ohne Komma gibt es hier keine Stelle zum Teilen.'), null);
});

// a relative or subordinate clause is verb-final and can never stand alone: the German review's examples
test('splitLocal never makes a fragment of a relative or subordinate clause', () => {
  const rel = 'Wir haben in den letzten zwei Jahren ein völlig neues System gebaut, das die Daten von allen Satelliten in Echtzeit sammelt und sofort an die Teams in drei Ländern weitergibt.';
  const dass = 'Ich möchte mich ganz herzlich bei euch allen bedanken und ich freue mich wirklich sehr, dass ihr heute alle hier seid und dass wir heute zusammen darüber sprechen können.';
  const elided = 'Der Rahmen eines modernen Fahrrads muss viele Kräfte aufnehmen, die beim Fahren auf unebenen Straßen entstehen, und trotzdem leicht genug bleiben, damit man ihn gut tragen kann.';
  for (const s of [rel, dass, elided]) { assert.ok(P.isLong(s)); assert.equal(P.splitLocal(s), null, s); }
  // weil … , aber …: the cut is at aber, and the weil clause stays with its main clause
  const weil = 'Das Projekt war am Anfang sehr schwierig für das ganze Team, weil wir nur wenig Zeit und sehr wenig Geld hatten, aber es hat am Ende doch geklappt.';
  assert.deepEqual(P.splitLocal(weil), ['Das Projekt war am Anfang sehr schwierig für das ganze Team, weil wir nur wenig Zeit und sehr wenig Geld hatten.', 'Aber es hat am Ende doch geklappt.']);
  // a relative clause before ", und wir …" stays in the first sentence
  const both = 'Wir haben ein neues System für die Auswertung der Daten gebaut, das sehr schnell arbeitet, und wir nutzen es seit dem letzten Sommer jeden Tag im ganzen Team.';
  assert.deepEqual(P.splitLocal(both), ['Wir haben ein neues System für die Auswertung der Daten gebaut, das sehr schnell arbeitet.', 'Und wir nutzen es seit dem letzten Sommer jeden Tag im ganzen Team.']);
  // no half ever starts with a subordinator or relative pronoun
  const SUB = /^(die|der|das|dem|den|deren|dessen|weil|dass|wenn|obwohl|damit|als|ob|während|bevor|nachdem|sodass|indem|wo|was|wie|um)\b/i;
  for (const s of [rel, dass, elided, weil, both]) for (const half of (P.splitLocal(s) || []).slice(1)) assert.ok(!SUB.test(half), half);
});

test('partsOf: his own parts first, else chunks of about 4 to 9 words', () => {
  assert.deepEqual(P.partsOf({ de: 'A b c.', parts: ['A b', 'c.'] }), ['A b', 'c.']);
  const parts = P.partsOf({ de: 'Wenn ihr in die Pedale tretet, überträgt die Kette die Kraft auf das Hinterrad.' });
  assert.deepEqual(parts, ['Wenn ihr in die Pedale tretet,', 'überträgt die Kette die Kraft auf das Hinterrad.']);
  assert.ok(P.partsOf({ de: 'Eins zwei drei vier fünf sechs sieben acht neun zehn elf zwölf.' }).every(p => P.wordCount(p) <= 9));
});

test('idMaker: 6 base36 characters, unique against taken ids', () => {
  let n = 0;
  const rnd = () => [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5][n++ % 12];
  const make = P.idMaker(['333333'], rnd);
  const a = make();
  assert.match(a, /^[0-9a-z]{6}$/);
  assert.notEqual(a, '333333');
});
