// domain/letterdiff.js (round 8, C1): the letter diff behind answer feedback. Display only; grading is untouched
// (the last tests check that this module and src/ui/answer-diff.js never reach the grader). German sentences are
// synthetic examples at A2/B1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { graphemes, letterDiff, letterChunks, distance, near, answerDiff, rangeDiff, slipSegs, describe, firstDiffWord } from '../../src/domain/letterdiff.js';
import { importsOf } from './ui-lint.test.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** A line as text with marks in brackets: "gearbeit[ghost:et]", whole-word marks with W. @param {{text: string, k: string, w?: boolean}[]} segs */
const show = segs => segs.map(s => (s.k === 'eq' ? s.text : `[${s.k}${s.w ? 'W' : ''}:${s.text}]`)).join('');
const join = (/** @type {{text: string}[]} */ segs) => segs.map(s => s.text).join('');

test('graphemes: a composed and a decomposed umlaut are one unit and the same', () => {
  assert.deepEqual(graphemes('Möbel'), ['M', 'ö', 'b', 'e', 'l']);
  assert.deepEqual(graphemes('Möbel'), graphemes('Möbel'));
  assert.deepEqual(letterDiff('Möbel', 'Möbel'), [{ op: 'eq', text: 'Möbel' }]);
});

test('letterDiff: runs of equal, deleted (typed only) and inserted (right only) letters', () => {
  assert.deepEqual(letterDiff('gearbeit', 'gearbeitet'), [{ op: 'eq', text: 'gearbeit' }, { op: 'ins', text: 'et' }]);
  assert.deepEqual(letterDiff('Gesschenk', 'Geschenk'), [{ op: 'eq', text: 'Ges' }, { op: 'del', text: 's' }, { op: 'eq', text: 'chenk' }]);
  assert.deepEqual(letterDiff('dem', 'den'), [{ op: 'eq', text: 'de' }, { op: 'del', text: 'm' }, { op: 'ins', text: 'n' }]);
  assert.deepEqual(letterDiff('', 'ab'), [{ op: 'ins', text: 'ab' }]);
  assert.deepEqual(letterDiff('ab', ''), [{ op: 'del', text: 'ab' }]);
});

test('letterChunks: changes, a missing ending, ß for ss, an umlaut written out, a swap as one change', () => {
  assert.deepEqual(letterChunks('dem', 'den'), [{ a: 'de', b: 'de' }, { a: 'm', b: 'n' }]);
  assert.deepEqual(letterChunks('gearbeit', 'gearbeitet'), [{ a: 'gearbeit', b: 'gearbeit' }, { a: '', b: 'et' }]);
  assert.deepEqual(letterChunks('weiss', 'weiß'), [{ a: 'wei', b: 'wei' }, { a: 'ss', b: 'ß' }]);
  assert.deepEqual(letterChunks('Maedchen', 'Mädchen'), [{ a: 'M', b: 'M' }, { a: 'ae', b: 'ä' }, { a: 'dchen', b: 'dchen' }]);
  assert.deepEqual(letterChunks('Geshcenk', 'Geschenk'), [{ a: 'Ges', b: 'Ges' }, { a: 'hc', b: 'ch' }, { a: 'enk', b: 'enk' }]);
  assert.deepEqual(letterChunks('wiel', 'weil'), [{ a: 'w', b: 'w' }, { a: 'ie', b: 'ei' }, { a: 'l', b: 'l' }]);
  assert.deepEqual(letterChunks('damen', 'Damen'), [{ a: 'd', b: 'D' }, { a: 'amen', b: 'amen' }]);
  // the chunks put the two words back together
  for (const [a, b] of [['Kafee', 'Kaffee'], ['Strasse', 'Straße'], ['Fahrad', 'Fahrrad'], ['ausgezeichent', 'ausgezeichnet']]) {
    const c = letterChunks(a, b);
    assert.equal(c.map(x => x.a).join(''), a);
    assert.equal(c.map(x => x.b).join(''), b);
  }
});

test('distance and near: Damerau over graphemes, at most 2 edits and a third of the word', () => {
  assert.equal(distance('Geshcenk', 'Geschenk'), 1);
  assert.equal(distance('gearbeit', 'gearbeitet'), 2);
  assert.equal(distance('Damen', 'damen'), 0);   // lower case
  assert.ok(near('dem', 'den'));
  assert.ok(near('gearbeit', 'gearbeitet'));
  assert.ok(near('ihm', 'im'));
  assert.ok(!near('der', 'die'));        // 2 of 3 letters: a different word
  assert.ok(!near('in', 'im'));          // two letters: a whole-word mark says it as well
  assert.ok(!near('ein', 'aus'));
  assert.ok(!near('gestern', 'gestern'));
  assert.ok(!near('arbeiten', 'arb'));
});

test('answerDiff, near miss: one ending missing shows as a ghost in his word and a mark in the right one', () => {
  const d = answerDiff('Ich habe gestern lange gearbeit.', 'Ich habe gestern lange gearbeitet.');
  assert.equal(d.mode, 'letters');
  assert.equal(show(d.typed), 'Ich habe gestern lange gearbeit[ghost:et].');
  assert.equal(show(d.right), 'Ich habe gestern lange gearbeit[miss:et].');
  assert.deepEqual(describe(d), { kind: 'ending-missing', part: 'et', word: 'gearbeitet' });
  assert.equal(join(d.right), 'Ich habe gestern lange gearbeitet.');
});

test('answerDiff, case endings: dem for den and a plural -n, letter by letter', () => {
  const d = answerDiff('Ich helfe dem Mann mit dem Koffer.', 'Ich helfe dem Mann mit den Koffern.');
  assert.equal(d.mode, 'letters');
  assert.equal(show(d.typed), 'Ich helfe dem Mann mit de[wrong:m] Koffer[ghost:n].');
  assert.equal(show(d.right), 'Ich helfe dem Mann mit de[miss:n] Koffer[miss:n].');
  assert.equal(describe(d), null);   // two words differ: the marks say it, no caption
});

test('answerDiff, umlauts: a dropped umlaut is a letter to correct in a long compound; ae and ss count as the same word', () => {
  const d = answerDiff('Die Krankenversicherungsbeitrage steigen.', 'Die Krankenversicherungsbeiträge steigen.');
  assert.equal(show(d.typed), 'Die Krankenversicherungsbeitr[wrong:a]ge steigen.');
  assert.equal(show(d.right), 'Die Krankenversicherungsbeitr[miss:ä]ge steigen.');
  const ae = answerDiff('Das Maedchen liest ein Buch.', 'Das Mädchen liest ein Buch.');
  assert.equal(show(ae.typed), 'Das Maedchen liest ein Buch.');   // nothing red: the pack counts ae as ä
  assert.equal(show(ae.right), 'Das M[fix:ä]dchen liest ein Buch.');
  assert.equal(ae.mode, 'letters');
  const ss = answerDiff('Ich weiss es nicht.', 'Ich weiß es nicht.');
  assert.equal(show(ss.right), 'Ich wei[fix:ß] es nicht.');
  assert.equal(ss.stats.missing, 0);
  const dec = answerDiff('Ich möchte zahlen.', 'Ich möchte zahlen.');
  assert.equal(show(dec.right), 'Ich möchte zahlen.');   // decomposed input: no difference at all
});

test('answerDiff, capitals: marked only where the grader listed the word, never at a sentence start', () => {
  const d = answerDiff('ich habe keine zeit', 'Ich habe keine Zeit.', { capMiss: [{ typed: 'zeit' }] });
  assert.equal(show(d.right), 'Ich habe keine [fix:Z]eit.');
  assert.equal(show(answerDiff('ich habe keine zeit', 'Ich habe keine Zeit.').right), 'Ich habe keine Zeit.');
});

test('answerDiff, a swap of two letters and an extra letter', () => {
  const d = answerDiff('Ich habe ein Geshcenk gekauft.', 'Ich habe ein Geschenk gekauft.');
  assert.equal(show(d.typed), 'Ich habe ein Ges[wrong:hc]enk gekauft.');
  assert.equal(show(d.right), 'Ich habe ein Ges[miss:ch]enk gekauft.');
  const x = answerDiff('Wir trinken einen Kafffee.', 'Wir trinken einen Kaffee.');
  assert.equal(show(x.typed), 'Wir trinken einen Kaff[extra:f]ee.');
  assert.equal(show(x.right), 'Wir trinken einen Kaffee.');
});

test('answerDiff, whole words: a word too many and a word missing', () => {
  const d = answerDiff('Ich gehe heute zu Hause.', 'Ich bleibe heute zu Hause.');
  assert.equal(d.mode, 'words');
  assert.equal(show(d.typed), 'Ich [wrongW:gehe] heute zu Hause.');
  assert.equal(show(d.right), 'Ich [missW:bleibe] heute zu Hause.');
  const m = answerDiff('Ich fahre nach Berlin.', 'Ich fahre morgen nach Berlin.');
  assert.equal(show(m.right), 'Ich fahre [missW:morgen] nach Berlin.');
  assert.equal(show(m.typed), 'Ich fahre nach Berlin.');
});

test('answerDiff, a pair never crosses an equal word (word order)', () => {
  const d = answerDiff('Morgen ich fahre nach Berlin.', 'Morgen fahre ich nach Berlin.');
  assert.equal(join(d.right), 'Morgen fahre ich nach Berlin.');
  assert.ok(d.right.every(s => s.k === 'eq' || s.w), 'no letter marks across a moved word');
});

test('answerDiff, far miss: more than 60 % of the right words missing shows both lines plain', () => {
  const d = answerDiff('Wir fahren morgen nach Berlin.', 'Ich möchte einen Kaffee bestellen.');
  assert.equal(d.mode, 'plain');
  assert.deepEqual(d.right, [{ text: 'Ich möchte einen Kaffee bestellen.', k: 'eq' }]);
  assert.deepEqual(d.typed, [{ text: 'Wir fahren morgen nach Berlin.', k: 'eq' }]);
  // close pairs do not count toward the share: a one-word answer with one letter off is still a letter diff
  assert.equal(answerDiff('Madchen', 'Mädchen').mode, 'letters');
  assert.equal(answerDiff('', 'Guten Morgen').mode, 'plain');
  // 3 of 5 words missing is 60 %: still marked
  assert.equal(answerDiff('Ich habe Zeit.', 'Ich habe heute keine Zeit.').mode, 'words');
});

test('answerDiff, multi-word lines keep his spacing tidy and the right line whole', () => {
  const d = answerDiff('  Ich   interessiere mich fur  Musik ', 'Ich interessiere mich für Musik.');
  assert.equal(join(d.typed), 'Ich interessiere mich fur Musik');
  assert.equal(show(d.right), 'Ich interessiere mich f[miss:ü]r Musik.');
});

test('rangeDiff: marks only inside the grader ranges, close pairs as letters', () => {
  const typed = 'Ich kümmere mich um die Kinder und koche dem Essen.';
  const ref = 'Ich kümmere mich um die Kinder und koche das Essen.';
  const tw = typed.indexOf('dem'), rw = ref.indexOf('das');
  const d = rangeDiff(typed, ref, [{ start: tw, end: tw + 3 }], [{ start: rw, end: rw + 3 }]);
  assert.equal(show(d.right), 'Ich kümmere mich um die Kinder und koche [missW:das] Essen.');   // dem/das: 2 of 3 letters
  assert.equal(show(d.typed), 'Ich kümmere mich um die Kinder und koche [wrongW:dem] Essen.');
  const e = rangeDiff('Ich warte auf den Bus seit zehn Minute.', 'Ich warte seit zehn Minuten auf den Bus.', [{ start: 32, end: 38 }], [{ start: 20, end: 27 }]);
  assert.equal(show(e.typed), 'Ich warte auf den Bus seit zehn Minute[ghost:n].');
  assert.equal(show(e.right), 'Ich warte seit zehn Minute[miss:n] auf den Bus.');
});

test('slipSegs: a right answer once, the letters to fix marked, nothing else', () => {
  const s = 'Ich kaufe ein Geshcenk für die damen';
  const segs = slipSegs(s, [{ start: 31, end: 36, expected: 'Damen' }, { start: 14, end: 22, expected: 'Geschenk' }]);
  assert.equal(show(segs), 'Ich kaufe ein Ges[fix:ch]enk für die [fix:D]amen');
  assert.ok(segs.every(x => x.k !== 'wrong' && x.k !== 'miss'), 'a right answer has no red kinds');
  assert.equal(show(slipSegs('Wir gehen in die Schulle', [{ start: 17, end: 24, expected: 'Schule' }])), 'Wir gehen in die Schul[extra:l]e');
  assert.equal(show(slipSegs('Er fahrt nach Munchen', [{ start: 3, end: 8, expected: 'fährt' }, { start: 14, end: 21, expected: 'München' }])), 'Er f[fix:ä]hrt nach M[fix:ü]nchen');
  assert.equal(show(slipSegs('abc', [])), 'abc');
});

test('firstDiffWord: the retype locus, case aside', () => {
  assert.equal(firstDiffWord('ich habe gestern lange gearbeitet', 'Ich habe gestern lange gearbeitet.'), -1);
  assert.equal(firstDiffWord('Ich habe gesten lange gearbeitet', 'Ich habe gestern lange gearbeitet.'), 2);
  assert.equal(firstDiffWord('Ich habe gestern', 'Ich habe gestern lange gearbeitet.'), 3);
  assert.equal(firstDiffWord('Ich habe sehr gestern lange gearbeitet', 'Ich habe gestern lange gearbeitet.'), -1);
});

// Round 8 fix pass: the German review's findings (S1 to S4) and its probes, and the code review's S4 (cost).
test('German S1: gern for gerne is a right form, nothing to fix either way', () => {
  for (const [a, b] of [['Ich spiele gern Tennis.', 'Ich spiele gerne Tennis.'], ['Ich spiele gerne Tennis.', 'Ich spiele gern Tennis.']]) {
    const d = answerDiff(a, b);
    assert.equal(show(d.typed), a);
    assert.equal(show(d.right), b);
  }
  // a spelling the pack counts as the same is still one to fix
  assert.equal(show(answerDiff('Ich glaube, daß er kommt.', 'Ich glaube, dass er kommt.').right), 'Ich glaube, da[fix:ss] er kommt.');
});

test('German S2: ae/oe/ue and ss count as no edit, so a missing ending next to them still gets letters', () => {
  const d = answerDiff('Ich habe einen schoene Tag.', 'Ich habe einen schönen Tag.');
  assert.equal(d.mode, 'letters');
  assert.equal(show(d.typed), 'Ich habe einen schoene[ghost:n] Tag.');
  assert.equal(show(d.right), 'Ich habe einen sch[fix:ö]ne[miss:n] Tag.');
  const m = answerDiff('Die Maedchn spielen.', 'Die Mädchen spielen.');
  assert.equal(show(m.typed), 'Die Maedch[ghost:e]n spielen.');
  assert.equal(show(m.right), 'Die M[fix:ä]dch[miss:e]n spielen.');
  // a dropped umlaut is still a letter to correct (red)
  assert.equal(show(answerDiff('Ich mochte zahlen.', 'Ich möchte zahlen.').right), 'Ich m[miss:ö]chte zahlen.');
});

test('German S3: the retype locus uses the retype check\'s key (moechte, weiss and gern are not the miss)', () => {
  assert.equal(firstDiffWord('Ich moechte zahln', 'Ich möchte zahlen'), 2);
  assert.equal(firstDiffWord('ich spiele gern tennis', 'Ich spiele gerne Tennis'), -1);
  assert.equal(firstDiffWord('Ich weiss es nich', 'Ich weiß es nicht'), 3);
});

test('German S4: a near pair marks no capital the grader did not list, a sentence start included', () => {
  const s = answerDiff('ihc gehe nach Hause.', 'Ich gehe nach Hause.');
  assert.equal(show(s.typed), 'i[wrong:hc] gehe nach Hause.');
  assert.equal(show(s.right), 'I[miss:ch] gehe nach Hause.');
  const f = answerDiff('Ich sehe die frauen.', 'Ich sehe die Frau.');
  assert.equal(show(f.typed), 'Ich sehe die frau[extra:en].');
  assert.equal(show(f.right), 'Ich sehe die Frau.');
  // a listed capital is marked, as a letter to fix (accent), the same as on a word that counts
  assert.equal(show(answerDiff('Ich sehe die frauen.', 'Ich sehe die Frau.', { capMiss: [{ typed: 'frauen' }] }).right), 'Ich sehe die [fix:F]rau.');
});

test('German review probes: every real error shows, nothing right is red', () => {
  /** [typed, right, mode, his line, right line, caption part] */
  const cases = [
    ['Ich möchte zahlen.', 'Ich möchte zahlen.', 'words', 'Ich möchte zahlen.', 'Ich möchte zahlen.', null],
    ['Ich moechte zahlen.', 'Ich möchte zahlen.', 'letters', 'Ich moechte zahlen.', 'Ich m[fix:ö]chte zahlen.', null],
    ['Ich gehe die Strasse entlang.', 'Ich gehe die Straße entlang.', 'letters', 'Ich gehe die Strasse entlang.', 'Ich gehe die Stra[fix:ß]e entlang.', null],
    ['Ich glaube, das er kommt.', 'Ich glaube, dass er kommt.', 'letters', 'Ich glaube, das[ghost:s] er kommt.', 'Ich glaube, das[miss:s] er kommt.', 's'],
    ['Ich weis es.', 'Ich weiß es.', 'letters', 'Ich wei[wrong:s] es.', 'Ich wei[miss:ß] es.', null],
    ['Ich habe keine zeit.', 'Ich habe keine Zeit.', 'words', 'Ich habe keine zeit.', 'Ich habe keine Zeit.', null],
    ['Ich anrufe dich morgen.', 'Ich rufe dich morgen an.', 'letters', 'Ich [extra:an]rufe dich morgen.', 'Ich rufe dich morgen [missW:an].', null],
    ['Ich rufe an dich morgen.', 'Ich rufe dich morgen an.', 'words', 'Ich rufe [wrongW:an] dich morgen.', 'Ich rufe dich morgen [missW:an].', null],
    ['Ich mache meine Haus Aufgaben.', 'Ich mache meine Hausaufgaben.', 'words', 'Ich mache meine [wrongW:Haus] [wrongW:Aufgaben].', 'Ich mache meine [missW:Hausaufgaben].', null],
    ['Ich warte am Bahnhofs.', 'Ich warte am Bahnhof.', 'letters', 'Ich warte am Bahnhof[extra:s].', 'Ich warte am Bahnhof.', null],
    ['Ich helfe dem Mann.', 'Ich helfe den Mann.', 'letters', 'Ich helfe de[wrong:m] Mann.', 'Ich helfe de[miss:n] Mann.', null],
    ['Ich gebe dem Frau das Buch.', 'Ich gebe der Frau das Buch.', 'letters', 'Ich gebe de[wrong:m] Frau das Buch.', 'Ich gebe de[miss:r] Frau das Buch.', null],
    ['Ich sehe ihm.', 'Ich sehe ihn.', 'letters', 'Ich sehe ih[wrong:m].', 'Ich sehe ih[miss:n].', null],
    ['Ich wohne in einen Haus.', 'Ich wohne in einem Haus.', 'letters', 'Ich wohne in eine[wrong:n] Haus.', 'Ich wohne in eine[miss:m] Haus.', null],
    ['Ich trinke der Milch.', 'Ich trinke die Milch.', 'words', 'Ich trinke [wrongW:der] Milch.', 'Ich trinke [missW:die] Milch.', null],
    ['Ich kaufe ein kleine Auto.', 'Ich kaufe ein kleinen Auto.', 'letters', 'Ich kaufe ein kleine[ghost:n] Auto.', 'Ich kaufe ein kleine[miss:n] Auto.', 'n'],
    ['Er hat einen gute Freund.', 'Er hat einen guter Freund.', 'letters', 'Er hat einen gute[ghost:r] Freund.', 'Er hat einen gute[miss:r] Freund.', 'r'],
    ['Ich weiß, dass er kommt morgen.', 'Ich weiß, dass er morgen kommt.', 'words', 'Ich weiß, dass er [wrongW:kommt] morgen.', 'Ich weiß, dass er morgen [missW:kommt].', null],
    ['Morgen ich fahre nach Berlin.', 'Morgen fahre ich nach Berlin.', 'words', 'Morgen [wrongW:ich] fahre nach Berlin.', 'Morgen fahre [missW:ich] nach Berlin.', null],
    ['Ich habe gegessen Brot.', 'Ich habe Brot gegessen.', 'words', 'Ich habe [wrongW:gegessen] Brot.', 'Ich habe Brot [missW:gegessen].', null],
    ['Ich habe nach Berlin gefahren.', 'Ich bin nach Berlin gefahren.', 'words', 'Ich [wrongW:habe] nach Berlin gefahren.', 'Ich [missW:bin] nach Berlin gefahren.', null],
    ['Ich schreibe eine Email.', 'Ich schreibe eine E-Mail.', 'letters', 'Ich schreibe eine E[ghost:-]mail.', 'Ich schreibe eine E[miss:-]Mail.', null],
    ['ICH GEHE DIE STRASSE ENTLANG.', 'ICH GEHE DIE STRAẞE ENTLANG.', 'letters', 'ICH GEHE DIE STRASSE ENTLANG.', 'ICH GEHE DIE STRA[fix:ẞ]E ENTLANG.', null],
    ['Ich bin zuhause geblieben.', 'Ich bin zu Hause geblieben.', 'letters', 'Ich bin [extra:zu]hause geblieben.', 'Ich bin [missW:zu] Hause geblieben.', null],
    ['Apfel', 'Äpfel', 'letters', '[wrong:A]pfel', '[miss:Ä]pfel', null],
    ['Aepfel', 'Äpfel', 'letters', 'Aepfel', '[fix:Ä]pfel', null],
    ['Ich bin nach Berlin gefahrt.', 'Ich bin nach Berlin gefahren.', 'letters', 'Ich bin nach Berlin gefahr[wrong:t].', 'Ich bin nach Berlin gefahr[miss:en].', null],
    ['Du komm morgen.', 'Du kommst morgen.', 'letters', 'Du komm[ghost:st] morgen.', 'Du komm[miss:st] morgen.', 'st'],
    ['Ich schla vor, dass wir gehen.', 'Ich schlage vor, dass wir gehen.', 'letters', 'Ich schla[ghost:ge] vor, dass wir gehen.', 'Ich schla[miss:ge] vor, dass wir gehen.', 'ge'],
  ];
  for (const [a, b, mode, you, right, part] of cases) {
    const d = answerDiff(a, b);
    assert.deepEqual([d.mode, show(d.typed), show(d.right), describe(d)?.part ?? null], [mode, you, right, part], `${a} / ${b}`);
    assert.equal(join(d.right), b.normalize('NFC'));
  }
  assert.equal(show(slipSegs('Ich gehe die Strasse entlang.', [{ start: 13, end: 20, expected: 'Straße' }])), 'Ich gehe die Stra[fix:ß]e entlang.');
  assert.equal(show(slipSegs('Ich mochte zahlen.', [{ start: 4, end: 10, expected: 'möchte' }])), 'Ich m[fix:ö]chte zahlen.');
});

test('code S4: a pasted 6,000-character answer is drawn in linear time, plain or by words', () => {
  const ms = (/** @type {() => unknown} */ f) => { const t0 = performance.now(); f(); return performance.now() - t0; };
  const one = 'abcdefghij'.repeat(600), other = 'abcdefghik'.repeat(600);   // one word each, no spaces
  const words = Array.from({ length: 1000 }, (_, i) => `wort${i % 50}x`).join(' ').slice(0, 6000).trim();
  const close = Array.from({ length: 1000 }, (_, i) => `wrot${i % 50}y`).join(' ').slice(0, 6000).trim();
  assert.equal(one.length, 6000);
  for (const [a, b] of [[one, other], [words, close], [one, close]]) {
    let d;
    assert.ok(ms(() => { d = answerDiff(a, b); }) < 250, 'answerDiff stays fast');
    assert.equal(/** @type {any} */ (d).mode, 'plain');
    assert.equal(join(/** @type {any} */ (d).right), b);
    assert.ok(ms(() => rangeDiff(a, b, [{ start: 0, end: a.length }], [{ start: 0, end: b.length }])) < 250, 'rangeDiff stays fast');
    assert.ok(ms(() => firstDiffWord(a, b)) < 250, 'firstDiffWord stays fast');
    assert.ok(ms(() => slipSegs(a, [{ start: 0, end: a.length, expected: b }])) < 250, 'slipSegs stays fast');
  }
  // just under the plain limit, every word a near miss: still letters, still fast
  let d;
  assert.ok(ms(() => { d = answerDiff(words.slice(0, 990), close.slice(0, 990)); }) < 250);
  assert.notEqual(/** @type {any} */ (d).mode, 'plain');
  assert.ok(ms(() => assert.ok(!near(one, other))) < 250, 'near() is banded');
  assert.ok(near(one, one.slice(0, -1)), 'a 6,000-letter word one letter short is close');
  // the banded closeness agrees with the full distance on short words
  for (const [a, b] of [['dem', 'den'], ['gearbeit', 'gearbeitet'], ['Geshcenk', 'Geschenk'], ['der', 'die'], ['ihm', 'im'], ['abcdef', 'badcfe'], ['Kafee', 'Kaffee'], ['ausgezeichent', 'ausgezeichnet']]) {
    const dd = distance(a, b);
    assert.equal(near(a, b), dd > 0 && dd <= Math.min(2, Math.ceil(graphemes(b).length / 3)) && Math.max(graphemes(a).length, graphemes(b).length) >= 3, `${a}/${b}`);
  }
});
test('display only: letterdiff.js and ui/answer-diff.js never import the grader', () => {
  const GRADING = ['domain/match.js', 'features/shared/grade.js', 'domain/detect.js', 'domain/notes.js', 'domain/punct.js'];
  for (const f of ['domain/letterdiff.js', 'ui/answer-diff.js'].filter(x => existsSync(path.join(ROOT, 'src', x)))) {
    const src = readFileSync(path.join(ROOT, 'src', f), 'utf8');
    const seen = new Set(), todo = [f];
    while (todo.length) {   // the whole import graph, not just the first level
      const cur = /** @type {string} */ (todo.pop());
      if (seen.has(cur)) continue;
      seen.add(cur);
      let s = '';
      try { s = cur === f ? src : readFileSync(path.join(ROOT, 'src', cur), 'utf8'); } catch { continue; }
      todo.push(...importsOf(cur, s).filter(p => p.endsWith('.js')));
    }
    for (const g of GRADING) assert.ok(!seen.has(g), `${f} reaches ${g}`);
  }
});
