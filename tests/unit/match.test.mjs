// match.js. Ported from the legacy node script with the assertions unchanged; run with `node --test tests/unit`.
import { test } from 'node:test';
import M from '../../src/domain/match.js';
const { check, acceptedForWord, acceptedForChunk, acceptedForGap, gapLoose, gapFill, nounForm, nounPrompt, renderPattern, matches } = M;
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const tisch = { w: 'Tisch', art: 'der', pos: 'noun', alt: [] };
const rad = { w: 'Fahrrad', art: 'das', pos: 'noun', alt: ['das Rad'] };
const noun = (input, word) => check(input, acceptedForWord(word), { pos: 'noun' });

// accepted lists

let r, typo1, wuerde, freue, phrase, again, woher, auto, frau, eltern, milch, joghurt, indef, gap;

test('match.js', () => {
  assert.deepEqual(acceptedForWord(tisch), ['der Tisch']);
  assert.deepEqual(acceptedForWord(rad), ['das Fahrrad', 'das Rad']);
  assert.deepEqual(acceptedForWord({ w: 'schnell', art: '', pos: 'adj', alt: ['rasch'] }), ['schnell', 'rasch']);
  assert.deepEqual(acceptedForChunk('A [x] / B'), ['A [x]', 'B']);
  assert.deepEqual(acceptedForChunk('A [x] / B', 'A b c.'), ['A b c.', 'A [x]', 'B']);

  // exact, case-insensitive, punctuation and spacing
  r = noun('der Tisch', tisch); assert.ok(r.ok && r.exact); assert.equal(r.fixed, 'der Tisch');
  r = noun('  DER   tisch. ', tisch); assert.ok(r.ok && r.exact);

  // umlaut and ß spellings
  r = check('die Tuer', ['die Tür'], { pos: 'noun' }); assert.ok(r.ok); assert.equal(r.exact, false); assert.equal(r.fixed, 'die Tür');
  r = check('die Strasse', ['die Straße'], { pos: 'noun' }); assert.ok(r.ok && !r.exact); assert.equal(r.fixed, 'die Straße');
  r = check('Groesse', ['Größe']); assert.ok(r.ok); assert.equal(r.fixed, 'Größe');
  r = check('schön', ['schoen']); assert.ok(r.ok);          // either side may use the digraph
  r = check('müde', ['müde']); assert.ok(r.ok && r.exact);

  // wrong or missing article
  r = noun('die Tisch', tisch); assert.equal(r.ok, false); assert.equal(r.articleMiss, true); assert.equal(r.fixed, 'der Tisch');
  r = noun('Tisch', tisch); assert.equal(r.ok, false); assert.equal(r.articleMiss, true);
  r = noun('der Stuhl', tisch); assert.equal(r.ok, false); assert.equal(r.articleMiss, false); assert.equal(r.close, false);
  r = noun('Tich', tisch); assert.equal(r.articleMiss, true, 'missing article, word with a typo');
  r = check('Tisch', ['der Tisch']); assert.equal(r.articleMiss, false, 'article check only for nouns');

  // typos, word by word: 0 edits up to 3 letters, 1 for 4-7, 2 for 8+; ok but not exact, with the typo listed
  typo1 = (r, typed, expected) => { assert.ok(r.ok, `${typed} should pass as a typo`); assert.equal(r.exact, false); assert.deepEqual(r.typos.map(t => [t.typed, t.expected]), [[typed, expected]]); };
  r = noun('das Fahrad', rad); typo1(r, 'Fahrad', 'Fahrrad'); assert.equal(r.fixed, 'das Fahrrad');
  typo1(check('Bahnhfo', ['Bahnhof']), 'Bahnhfo', 'Bahnhof');       // transposition
  typo1(check('Bahnhoff', ['Bahnhof']), 'Bahnhoff', 'Bahnhof');     // insertion
  typo1(check('Tich', ['Tisch']), 'Tich', 'Tisch');                 // 5 letters: 1 edit
  r = check('Bahnhfoo', ['Bahnhof']); assert.equal(r.ok, false, 'two edits on 7 letters');
  typo1(check('Entschuldgung', ['Entschuldigung']), 'Entschuldgung', 'Entschuldigung');
  assert.ok(check('Entschldgung', ['Entschuldigung']).ok, '2 edits on 8+ letters');
  assert.equal(check('Entschdgung', ['Entschuldigung']).ok, false, '3 edits');
  r = check('Tuer', ['Tür']); assert.ok(r.ok && !r.typos.length, 'umlaut spelling is not a typo');
  assert.equal(check('Tur', ['Tür']).ok, false, '3 letters: no edits');
  r = noun('der Fahrad', rad); assert.equal(r.ok, false); assert.equal(r.articleMiss, true, 'wrong article, word with a typo');
  // a 2-letter word with a typo is not forgiven
  assert.equal(check('sa gut', ['so gut']).ok, false);
  assert.equal(check('Ich gehe zo Fuß', ['Ich gehe zu Fuß']).ok, false);
  // closed words: a different article, pronoun or preposition is never a typo
  assert.equal(check('Ich habe Angst für dem Hund', ['Ich habe Angst vor dem Hund']).ok, false, 'für / vor');
  assert.equal(check('Er hilft mich', ['Er hilft mir']).ok, false, 'mir / mich');
  assert.equal(check('Ich gebe ihn das Buch', ['Ich gebe ihm das Buch']).ok, false, 'ihm / ihn');
  assert.equal(check('Wir sein müde', ['Wir sind müde']).ok, false, 'sein / sind');
  assert.equal(check('Ich sehe einem Mann', ['Ich sehe einen Mann']).ok, false, 'einem / einen');
  assert.equal(check('Ich glaube das er kommt', ['Ich glaube, dass er kommt']).ok, false, 'das / dass');
  // verb-final placement stays strict
  assert.equal(check('Ich glaube dass er kommt morgen', ['Ich glaube, dass er morgen kommt.']).ok, false);
  // the wrong article on a noun stays an articleMiss
  r = noun('den Tisch', tisch); assert.equal(r.ok, false); assert.equal(r.articleMiss, true);
  // close = not ok, but half of a pattern's fixed words are there (not for nouns or one-word answers)
  assert.equal(check('Ich glaube dass er kommt morgen', ['Ich glaube, dass er morgen kommt.']).close, true);
  assert.equal(check('Keine Ahnung', ['Ich glaube, dass er morgen kommt.']).close, false);

  // alternatives and "Also correct"
  r = noun('das Rad', rad); assert.ok(r.ok); assert.equal(r.matched, 'das Rad'); assert.deepEqual(r.others, ['das Fahrrad']);

  // chunk variants with slots
  wuerde = acceptedForChunk('Würden Sie bitte [Infinitiv]? / Würde es Ihnen etwas ausmachen, [zu + Infinitiv]?', 'Würden Sie bitte das Fenster zumachen?');
  r = check('Würden Sie bitte das Fenster zumachen', wuerde); assert.ok(r.ok && r.exact); assert.equal(r.matched, wuerde[0]);
  assert.deepEqual(r.others, wuerde.slice(1));
  r = check('würden sie bitte kurz warten?', wuerde); assert.ok(r.ok); assert.equal(r.matched, 'Würden Sie bitte [Infinitiv]?'); assert.equal(r.fixed, 'Würden Sie bitte kurz warten?');
  assert.deepEqual(r.others, [wuerde[0], wuerde[2]]);
  r = check('Würde es Ihnen etwas ausmachen, das Fenster zu schliessen?', wuerde); assert.ok(r.ok); assert.equal(r.fixed, 'Würde es Ihnen etwas ausmachen, das Fenster zu schliessen?');
  r = check('Würden Sie bitte', wuerde); assert.equal(r.ok, false, 'a slot needs at least one word');
  r = check('Würden Sie bitte eins zwei drei vier fünf sechs sieben', ['Würden Sie bitte [Infinitiv]']); assert.equal(r.ok, false, 'a slot takes at most 6 words');
  r = check('Würden Sie bitte eins zwei drei vier fünf sechs', ['Würden Sie bitte [Infinitiv]']); assert.ok(r.ok);
  // optional parts and slots glued to a word
  freue = acceptedForChunk('Ich freue mich (schon) auf [Nomen]');
  assert.ok(check('Ich freue mich auf das Wochenende', freue).ok);
  assert.ok(check('ich freue mich schon auf den Urlaub!', freue).ok);
  assert.ok(check('Mein Lieblingsessen ist Pizza', acceptedForChunk('Mein Lieblings[Nomen] ist [Nomen]')).ok);
  assert.ok(check('Meine Tasche bringt mich um', acceptedForChunk('Mein(e) [Nomen] bringt mich um')).ok);
  assert.ok(check('Seit wann wohnst du hier?', acceptedForChunk('Seit wann [Verb im Präsens] du ...?')).ok);
  // slots off: brackets are literal
  assert.equal(check('Würden Sie bitte warten', ['Würden Sie bitte [Infinitiv]'], { slots: false }).ok, false);

  // grammar items: commas don't matter; strict case only when asked
  r = check('Ich glaube dass er morgen kommt', ['Ich glaube, dass er morgen kommt.']); assert.ok(r.ok); assert.equal(r.fixed, 'Ich glaube, dass er morgen kommt.');
  r = check('das thema', ['das Thema'], { strictCase: true }); assert.equal(r.ok, false); assert.equal(r.caseMiss, true); assert.equal(r.fixed, 'das Thema');
  r = check('das Thema', ['das Thema'], { strictCase: true }); assert.ok(r.ok && r.exact);
  r = check('das thema', ['das Thema']); assert.ok(r.ok);
  r = check('Das Treffen', ['das Treffen'], { strictCase: true }); assert.equal(r.ok, false);

  // empty input
  r = check('', ['der Tisch'], { pos: 'noun' }); assert.equal(r.ok, false); assert.equal(r.articleMiss, false);
});

test('phrases: accept patterns, graded on the phrase only (anywhere in the answer)', () => {
  phrase = (input, acc) => check(input, acc, { anywhere: true });
  again = ['(entschuldigung) könnten sie das (bitte) (noch mal) wiederholen', 'kannst du (das) (bitte) (noch mal) wiederholen', 'wie bitte'];
  r = phrase('enshuldigung, kannst du widerholen? es ist sehr laut.', again);
  assert.ok(r.ok, 'du form with typos'); assert.equal(r.matched, again[1]); assert.ok(r.typos.length > 0); assert.equal(r.exact, false);
  assert.deepEqual(r.typos.map(t => [t.typed, t.expected]), [['widerholen', 'wiederholen']]);
  assert.equal(r.typos[0].start, 'enshuldigung, kannst du '.length);
  r = phrase('Entschuldigung, könnten Sie das bitte wiederholen? Hier ist es so laut.', again); assert.ok(r.ok && r.exact && !r.typos.length);
  // optional words present and absent
  assert.ok(phrase('könnten sie das noch mal wiederholen', again).ok);
  assert.ok(phrase('könnten sie das wiederholen', again).ok);
  assert.ok(phrase('Entschuldigung könnten Sie das bitte noch mal wiederholen', again).ok);
  assert.equal(phrase('könnten sie wiederholen', again).ok, false, '"das" is not optional in the Sie form');
  // a slot of 1 and of 6 words (and not 7)
  woher = ['woher kennst du [x] so gut'];
  assert.ok(phrase('woher kennst du ihn so gut', woher).ok);
  assert.ok(phrase('woher kennst du eins zwei drei vier fünf sechs so gut', woher).ok);
  assert.equal(phrase('woher kennst du eins zwei drei vier fünf sechs sieben so gut', woher).ok, false);
  assert.equal(phrase('woher kennst du so gut', woher).ok, false, 'a slot needs a word');
  // a slot is whole words: no half-word matches on either side
  assert.equal(matches('füll haus', 'füll [x] aus'), false, '"[x] aus" does not match "haus"');
  assert.ok(matches('füll das Formular aus', 'füll [x] aus'));
  assert.equal(matches('woher kennst dux', 'woher kennst du [x]'), false, '"du [x]" does not match "dux"');
  assert.ok(matches('woher kennst du ihn', 'woher kennst du [x]'));
  assert.ok(matches('Warst du schonmal in Berlin', 'warst du schon (ein)mal in'), 'fixed words may be written together');
  // the pattern inside a longer answer
  r = phrase('Also, ich freue mich schon auf das Wochenende mit euch.', ['ich freue mich (schon) auf']); assert.ok(r.ok && r.exact);
  assert.equal(r.fixed, 'ich freue mich schon auf');
  assert.equal(check('Also, ich freue mich auf das Wochenende', ['ich freue mich (schon) auf']).ok, false, 'without anywhere the whole answer must match');
  // model answer rendering: optional words kept, slots as …, capitalised, case from the example
  assert.equal(renderPattern(again[0]), 'Entschuldigung könnten sie das bitte noch mal wiederholen');
  assert.equal(renderPattern(again[0], 'Entschuldigung, könnten Sie das bitte wiederholen?'), 'Entschuldigung könnten Sie das bitte noch mal wiederholen');
  assert.equal(renderPattern('woher kennst du [x]'), 'Woher kennst du …');
  assert.equal(renderPattern('mein(e) [x] ist [y]'), 'Meine … ist …');
  // close call on a phrase: half the words of one pattern
  assert.equal(phrase('kannst du sagen noch einmal', again).close, true);
});

test('nouns: "the car" / "a car"', () => {
  auto = { id: 'das_Auto', w: 'Auto', art: 'das', pl: 'Autos', pos: 'noun', en: ['car'], alt: ['der Wagen'] };
  frau = { id: 'die_Frau', w: 'Frau', art: 'die', pl: 'Frauen', pos: 'noun', en: ['woman'], alt: [] };
  eltern = { id: 'die_Eltern', w: 'Eltern', art: 'die', pl: '', pos: 'noun', en: ['parents'], alt: [] };
  milch = { id: 'die_Milch', w: 'Milch', art: 'die', pl: '', pos: 'noun', en: ['milk'], alt: [] };
  joghurt = { id: 'der_Joghurt', w: 'Joghurt', art: 'der', pl: 'Joghurts', pos: 'noun', en: ['yoghurt'], alt: ['das Joghurt'] };
  indef = (input, w) => check(input, acceptedForWord(w, 'indef'), { pos: 'noun' });
  assert.equal(nounPrompt(auto, 'indef'), 'a car'); assert.equal(nounPrompt(auto, 'def'), 'the car');
  assert.equal(nounPrompt({ ...auto, en: ['the apple'] }, 'indef'), 'an apple');
  assert.equal(nounPrompt({ ...auto, en: ['hour'] }, 'indef'), 'an hour');
  assert.equal(nounPrompt({ ...auto, en: ['university'] }, 'indef'), 'a university');
  assert.equal(nounPrompt({ ...auto, en: ['bank (money)'] }, 'indef'), 'a bank (money)');
  assert.deepEqual(acceptedForWord(auto, 'indef'), ['ein Auto', 'ein Wagen', 'das Auto', 'der Wagen']);
  r = indef('ein Auto', auto); assert.ok(r.ok && r.exact, 'a car -> ein Auto');
  r = indef('eine Auto', auto); assert.equal(r.ok, false); assert.equal(r.articleMiss, true);
  for (const wrong of ['einen Auto', 'einem Auto', 'einer Auto', 'den Auto', 'dem Auto', 'Auto']) assert.equal(indef(wrong, auto).articleMiss, true, wrong);
  assert.ok(indef('das Auto', auto).ok, 'the definite form counts for "a car"');
  assert.ok(indef('ein Wagen', auto).ok, 'alt, indefinite');
  assert.ok(indef('eine Frau', frau).ok, 'a woman -> eine Frau');
  assert.equal(indef('ein Frau', frau).articleMiss, true);
  assert.equal(nounForm(eltern), 'def'); assert.equal(nounPrompt(eltern), 'the parents'); assert.ok(noun('die Eltern', eltern).ok);
  assert.equal(nounForm(milch), 'def'); assert.equal(nounPrompt(milch), 'the milk');
  assert.equal(nounForm({ ...auto, en: ['Christmas'] }), 'def', 'proper and holiday nouns');
  assert.ok(indef('ein Joghurt', joghurt).ok && noun('das Joghurt', joghurt).ok && noun('der Joghurt', joghurt).ok && indef('der Joghurt', joghurt).ok);
  assert.equal(nounForm(auto), nounForm(auto), 'stable per id');
  { const words = JSON.parse(readFileSync(path.join(ROOT, 'content/igloo/words/de.json'), 'utf8')).filter(w => w.pos === 'noun' && w.pl && w.pl !== w.w);
    const share = words.filter(w => nounForm(w) === 'indef').length / words.length;
    assert.ok(share > 0.2 && share < 0.37, `about 30% of countable nouns are indefinite (${share.toFixed(2)})`); }
});

test('grammar gap items: the word alone or the whole phrase with the gap filled', () => {
  gap = (input, prompt, answers, strictCase = false) => check(input, acceptedForGap(prompt, answers), { loose: gapLoose(prompt), strictCase });
  for (const ok of ['Die Zeitung', 'die Zeitung', 'die', 'Die']) assert.ok(gap(ok, '___ Zeitung', ['die']).ok, ok);
  assert.equal(gap('Der Zeitung', '___ Zeitung', ['die']).ok, false);
  assert.ok(gap('ich kaufe den tisch', 'Ich kaufe ___ Tisch. (der)', ['den']).ok);
  assert.ok(gap('Ich kaufe den Tisch.', 'Ich kaufe ___ Tisch. (der)', ['den']).ok);
  assert.equal(gap('Ich kaufe der Tisch', 'Ich kaufe ___ Tisch. (der)', ['den']).ok, false);
  assert.deepEqual(acceptedForGap('Ich kaufe ___ Tisch. (der)', ['den']), ['den', 'Ich kaufe den Tisch.']);
  r = gap('Ich kaufe den Tsch', 'Ich kaufe ___ Tisch. (der)', ['den']); assert.ok(r.ok && r.typos.length === 1, 'a typo in a carried-over word is fine');
  assert.equal(gap('Wir haben gestern Fussbal gespielt', 'Wir haben gestern Fußball ___. (spielen)', ['gespielt']).ok, true);
  assert.equal(gap('Wir haben gestern Fußball gespilt', 'Wir haben gestern Fußball ___. (spielen)', ['gespielt']).ok, false, 'the gap word must be exact');
  assert.equal(gap('gespilt', 'Wir haben gestern Fußball ___. (spielen)', ['gespielt']).ok, false);
  assert.deepEqual(gapFill('___ Zeitung', 'die'), { before: '', gap: 'die', after: ' Zeitung', text: 'die Zeitung' });
  assert.equal(gapFill('___ kommst du? (wann)', 'wann').text, 'Wann kommst du?', 'sentence-initial gap is capitalised');
});

test('accept files: each German example matches one of its patterns, and JS agrees with validate_accept.py', () => {
  {
    const dir = path.join(ROOT, 'authoring/chunks/accept/german');
    const files = existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.json')).sort() : [];
    const de = JSON.parse(readFileSync(path.join(ROOT, 'content/igloo/chunks/german.json'), 'utf8')).chunks;
    const entries = [];
    for (const f of files) {
      let data; try { data = JSON.parse(readFileSync(path.join(dir, f), 'utf8')); } catch { console.log(`skip ${f}: not valid JSON yet`); continue; }
      for (const [id, e] of Object.entries(data)) {
        const ex = de[id]?.ex;
        if (ex) assert.ok(e.accept.some(p => matches(ex, p)), `${f} ${id}: the example ${JSON.stringify(ex)} matches no pattern`);
        entries.push([id, e]);
      }
    }
    if (entries.length) {
      let seed = +process.env.SEED || 725; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
      const pick = a => a[Math.floor(rnd() * a.length)];
      const filler = ['haus', 'gerne', 'morgen', 'schnell', 'der', 'den', 'ich', 'nicht', 'heute', 'wirklich', 'Straße', 'mal'];
      const gen = (p, mode) => {
        const out = []; let end = -1;
        for (const m of p.matchAll(/\[[^\]]*\]|\([^)]*\)|[^\s[\]()]+/g)) {
          const glued = m.index === end && out.length; end = m.index + m[0].length;
          let piece;
          if (m[0][0] === '[') piece = Array.from({ length: 1 + Math.floor(rnd() * (mode === 'long' ? 7 : 6)) }, () => pick(filler)).join(' ');
          else if (m[0][0] === '(') piece = rnd() < 0.5 ? m[0].slice(1, -1) : '';
          else piece = m[0];
          if (!piece) continue;
          if (glued) out[out.length - 1] += piece; else out.push(piece);
        }
        if (mode === 'drop' && out.length > 1) out.splice(Math.floor(rnd() * out.length), 1);
        if (mode === 'swap' && out.length > 1) { const i = Math.floor(rnd() * (out.length - 1)); [out[i], out[i + 1]] = [out[i + 1], out[i]]; }
        if (mode === 'replace') out[Math.floor(rnd() * out.length)] = pick(filler);
        if (rnd() < 0.3) out.unshift(pick(filler)); if (rnd() < 0.3) out.push(pick(filler) + '.');
        let s = out.join(' ');
        if (rnd() < 0.3) s = s[0].toUpperCase() + s.slice(1);
        if (rnd() < 0.2) s = s.replace(/ä/g, 'ae').replace(/ß/g, 'ss');
        return s;
      };
      const cases = [];
      for (let i = 0; i < 300; i++) {
        const [, e] = pick(entries), p = pick(e.accept);
        cases.push([gen(p, pick(['plain', 'plain', 'plain', 'long', 'drop', 'swap', 'replace'])), p]);
      }
      const py = `import json,sys\nsys.path.insert(0, ${JSON.stringify(path.join(ROOT, 'tools'))})\nfrom validate_accept import matches\nprint(json.dumps([matches(a, p) for a, p in json.load(sys.stdin)]))`;
      const out = spawnSync('python3', ['-c', py], { input: JSON.stringify(cases), encoding: 'utf8' });
      assert.equal(out.status, 0, out.stderr);
      const want = JSON.parse(out.stdout);
      const bad = cases.filter(([a, p], i) => matches(a, p) !== want[i]).map(([a, p], i) => `${JSON.stringify(a)} ~ ${JSON.stringify(p)}`);
      assert.deepEqual(bad, [], 'JS and Python disagree');
      console.log(`accept: ${files.length} file(s), ${entries.length} phrases, examples ok; ${cases.length} samples, ${want.filter(Boolean).length} matching, JS = Python`);
    } else console.log('accept: no files yet');
  }
});

test('B1 trainer options (opt-in; Test passes none of them)', () => {
  {
    const B = { anywhere: true, slotMax: 10, endings: true, umlaut: true };
    // optional slot ([x]) and slots up to 10 words
    const vor = ['ich schlage vor dass wir uns ([x]) treffen'];
    assert.ok(check('Ich schlage vor, dass wir uns treffen.', vor, B).ok, '([x]) may be empty');
    assert.ok(check('Ich schlage vor, dass wir uns am Samstag um sechs am Bahnhof treffen.', vor, B).ok);
    assert.equal(check('Ich schlage vor, dass wir treffen uns am Samstag.', vor, B).ok, false, 'verb-final stays strict');
    assert.ok(check('das ist eine sehr sehr sehr sehr sehr sehr sehr gute idee', ['das ist [x] idee'], B).ok, '8-word slot with slotMax 10');
    assert.equal(check('das ist eine sehr sehr sehr sehr sehr sehr sehr gute idee', ['das ist [x] idee'], { anywhere: true }).ok, false, 'Test keeps 6');
    assert.equal(renderPattern(vor[0]), 'Ich schlage vor dass wir uns treffen', 'an optional slot is left out of the model');
    // endings: stem typos only
    assert.ok(check('Bahnhfo', ['Bahnhof'], { endings: true }).ok, 'stem typo');
    assert.equal(check('kleinem', ['kleinen'], { endings: true }).ok, false, 'ending swap is a miss');
    assert.equal(check('mit dem Zug', ['mit den Zug'], { endings: true }).ok, false);
    assert.ok(check('Ich freue mich auf die Praesentaton', ['ich freue mich auf die präsentation'], { endings: true }).ok);
    // umlauts: a slip is Hard (umlautMiss), a minimal pair is a miss
    let u = check('Wir mussen gehen', ['wir müssen gehen'], B); assert.ok(u.ok); assert.deepEqual(u.umlautMiss.map(t => t.expected), ['müssen']);
    assert.equal(check('Konnten Sie mir helfen?', ['könnten sie mir helfen'], B).ok, false, 'konnten ≠ könnten');
    assert.equal(check('Ich wurde gern kommen', ['ich würde gern kommen'], B).ok, false, 'wurde ≠ würde');
    assert.equal(check('Das ist schon', ['das ist schön'], B).ok, false, 'schon ≠ schön');
    assert.ok(check('Konnten Sie mir helfen?', ['könnten sie mir helfen'], { anywhere: true }).ok, 'Test still forgives it as a typo');
    u = check('die Prufung', ['die prüfung'], B); assert.ok(u.ok && u.umlautMiss.length === 1);
    assert.ok(check('Koennten Sie mir helfen', ['könnten sie mir helfen'], B).ok, 'oe spelling is fine');
    // strict words: exact word, exact case
    assert.equal(check('Angst für der Prüfung', ['angst vor der prüfung'], { ...B, strict: ['vor', 'der'] }).ok, false);
    u = check('das thema', ['das thema'], { ...B, anywhere: false, strict: ['Thema'] }); assert.equal(u.ok, false); assert.deepEqual(u.focusMiss.map(t => t.expected), ['Thema']);
    assert.ok(check('das Thema', ['das thema'], { ...B, anywhere: false, strict: ['Thema'] }).ok);
    assert.ok(check('Thema', ['thema'], { ...B, anywhere: false, strict: ['Thema'] }).ok, 'sentence-initial');
    assert.equal(check('Das Tehma', ['das thema'], { ...B, anywhere: false, strict: ['Thema'] }).ok, false, 'no typo on a strict word');
    // capitals against a cased reference
    const ref = new Map([['pruefung', 'Prüfung'], ['ich', 'ich'], ['habe', 'habe'], ['angst', 'Angst'], ['party', 'Party']]);
    u = check('Ich habe Angst vor der prüfung.', ['ich habe angst vor der prüfung'], { ...B, caseRef: ref });
    assert.ok(u.ok); assert.deepEqual(u.capMiss.map(t => t.expected), ['Prüfung']);
    u = check('Prüfung habe ich keine.', ['prüfung'], { ...B, caseRef: ref }); assert.deepEqual(u.capMiss, [], 'first word exempt');
    u = check('Ich Habe Angst', ['ich habe angst'], { ...B, caseRef: ref }); assert.deepEqual(u.capMiss.map(t => t.typed), ['Habe'], 'a capital on a verb');
    u = check('Wir machen eine party am Freitag', ['wir machen eine [x] am freitag'], { ...B, caseRef: ref }); assert.deepEqual(u.capMiss.map(t => t.typed), ['party'], 'nouns in slots');
    // typo / umlaut fixes are shown in the reference's case
    u = check('Meine Prasentation besteht aus vier Teilen.', ['meine präsentation besteht aus vier teilen'], { ...B, caseRef: new Map([['praesentation', 'Präsentation']]) });
    assert.deepEqual(u.umlautMiss.map(t => t.expected), ['Präsentation']);
    u = check('Konnen wir das machen?', ['können wir das machen'], { ...B, caseRef: new Map() }); assert.deepEqual(u.umlautMiss.map(t => t.expected), ['Können'], 'capital where he typed one');
    // recht/Recht haben, recht/Recht geben: both spellings are right; das Recht auf … still needs the capital
    const rref = new Map([['recht', 'recht'], ['da', 'da'], ['hast', 'hast'], ['du', 'du']]);
    for (const s of ['Da hast du Recht.', 'Da hast du recht.', 'Da gebe ich dir Recht.', 'Da gebe ich dir recht.', 'Ich habe ja Recht.'])
      assert.deepEqual(check(s, ['da hast du recht', 'da gebe ich [x] recht', 'ich habe ja recht'], { ...B, caseRef: rref }).capMiss, [], s);
    u = check('Jeder hat das recht auf Bildung.', ['jeder hat das [x] auf bildung'], { ...B, caseRef: new Map([['recht', 'Recht']]) });
    assert.deepEqual(u.capMiss.map(t => t.typed), ['recht'], 'das Recht (noun after an article) still needs the capital');
    // nearest accepted string and the word diff
    u = check('Ich glaube, dass das ist eine gute Idee', ['ich glaube dass das eine gute idee ist', 'ich glaube das ist eine gute idee', 'keine ahnung'], { ...B, anywhere: false });
    assert.equal(u.ok, false); assert.equal(u.nearest, 0);
    const d = M.diffWords('Ich glaube, dass das ist eine gute Idee', 'Ich glaube, dass das eine gute Idee ist.');
    assert.deepEqual(d.wrong.map(w => w.word), ['ist']); assert.deepEqual(d.missing.map(k => d.right[k].raw), ['ist']);
    // JS = Python for ([x]) and slotMax 10
    const cases = [['ich schlage vor dass wir uns treffen', vor[0]], ['ich schlage vor dass wir uns am samstag treffen', vor[0]], ['ich schlage vor dass wir treffen uns', vor[0]],
      ['das ist eins zwei drei vier fünf sechs sieben acht idee', 'das ist [x] idee'], ['das ist eins zwei drei vier fünf sechs sieben acht neun zehn elf idee', 'das ist [x] idee'],
      ['wir könnten am samstag grillen', 'wir könnten (doch) ([x]) grillen'], ['wir könnten doch grillen', 'wir könnten (doch) ([x]) grillen'], ['wir könnten grillen', 'wir könnten (doch) ([x]) grillen']];
    const py = `import json,sys\nsys.path.insert(0, ${JSON.stringify(path.join(ROOT, 'tools'))})\nfrom validate_accept import matches\nprint(json.dumps([matches(a, p, 10) for a, p in json.load(sys.stdin)]))`;
    const out = spawnSync('python3', ['-c', py], { input: JSON.stringify(cases), encoding: 'utf8' });
    assert.equal(out.status, 0, out.stderr);
    const want = JSON.parse(out.stdout);
    cases.forEach(([a, p], i) => assert.equal(check(a, [p], { anywhere: true, typos: false, slotMax: 10 }).ok, want[i], `JS ≠ Python: ${a} ~ ${p}`));
    // B1 data: every model matches with B1 options, and no wrong answer does (except detector-caught topic tails and cap slips)
    const itemsFile = path.join(ROOT, 'content/b1/items.json');
    if (existsSync(itemsFile)) {
      const items = JSON.parse(readFileSync(itemsFile, 'utf8'));
      const gapB = it => String(it.prompt).includes('___');
      let n = 0;
      for (const it of items) {
        if (it.kind === 'reply') continue;
        const acc = gapB(it) ? acceptedForGap(it.prompt, it.accept) : it.accept;
        const o = { ...B, anywhere: it.anywhere, strict: it.strict, ...(gapB(it) ? { loose: gapLoose(it.prompt) } : {}) };
        const typed = it.prefill ? it.model : it.model;
        assert.ok(check(typed, acc, o).ok, `${it.id}: model fails in JS: ${it.model}`);
        if (it.kind !== 'topic' && !(it.focus || []).includes('cap')) for (const w of it.wrong || []) assert.equal(check(w, acc, o).ok, false, `${it.id}: wrong passes in JS: ${w}`);
        n++;
      }
      console.log(`B1 data: ${n} items, models match and wrongs fail in JS`);
    }
  }
});
