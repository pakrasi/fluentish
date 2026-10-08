// Today's family grades German right (round 7 fix, after the independent German review): every word on every board
// can be built with the tiles; every form typed for its own clue is right; every OTHER real word typed for a clue is
// not (another form of the family, or a lexicon neighbour such as vertraglich for verträglich), and a wrong article
// is reported only when the noun is right. The review's probes (round7/german/work/probe-cross.mjs and the
// buildability check of probe-family.mjs) made permanent, on the shipped content, through the game's own paths:
// boardFor + tapTile + judge for tiles, judgeTyped with the game's lexicon (familyLexicon) for typed words.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as F from '../../src/domain/wordbuild-family.js';
import { gradeTyped } from '../../src/domain/wordbuild-grade.js';
import { readBuild } from '../../tools/family-files.mjs';

const J = (/** @type {string} */ p) => JSON.parse(readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8'));
const C = readBuild();
const WORDS = J('content/igloo/words/de.json');
const fams = F.familyModel(C);
const LEX = F.familyLexicon(C, WORDS);
const CHAINS = F.endingChains(fams.values());
const ARTS = ['der', 'die', 'das'];
const DAYS = ['2026-10-08', '2026-10-09', '2026-10-10'];
const isDue = () => false;
const name = (/** @type {F.Form} */ f) => `${f.art ? `${f.art} ` : ''}${f.word}`;
/** The forms that can be a clue: the live board's rule (a card, a tile key, a board form, a clue). */
const clues = (/** @type {F.Family} */ fam) => fam.forms.filter(f => f.card && f.key && f.board !== false && f.clue);
/** Build a form tile by tile, as he taps them (prefixes outermost first, endings innermost first). @param {F.Form} f */
function tap(f) {
  let b = /** @type {{art: string | null, pre: string | null, suf: string | null}} */ ({ art: null, pre: null, suf: null });
  for (const p of [...f.pre].reverse()) b = F.tapTile(b, 'pre', p, CHAINS);
  for (const s of f.suf) b = F.tapTile(b, 'suf', s, CHAINS);
  if (f.art) b = F.tapTile(b, 'art', f.art, CHAINS);
  return b;
}
/** Two forms that are one word (the two readings of a dual verb: umstellen). @param {F.Form} a @param {F.Form} b */
const sameWord = (a, b) => a.word === b.word && a.cls === b.cls && (a.art || null) === (b.art || null);

test('every board word can be built with the tiles: the content\'s boards and the live boards', () => {
  const bad = [];
  let n = 0;
  for (const fam of fams.values()) {
    // the content's default boards (boardFor's fallback uses them)
    for (const [lv, b] of Object.entries(fam.boards || {})) {
      const ids = /** @type {any} */ (b).words;
      const cards = ids.map((/** @type {string} */ id) => fam.byId.get(id)?.card);
      ids.forEach((/** @type {string} */ id, /** @type {number} */ i) => {
        n++;
        const f = fam.byId.get(id);
        if (!f || !f.key) { bad.push(`${fam.root}/${lv}: ${id} has no tile key`); return; }
        for (const p of f.pre) if (!/** @type {any} */ (b).tiles.pre.includes(p)) bad.push(`${fam.root}/${lv}: no tile ${p}- for ${f.word}`);
        for (const s of f.suf) if (!/** @type {any} */ (b).tiles.suf.includes(s)) bad.push(`${fam.root}/${lv}: no tile -${s} for ${f.word}`);
        const r = F.judge({ fam, cards, i, done: {}, pick: tap(f) });
        if (r.outcome !== 'right') bad.push(`${fam.root}/${lv}: ${name(f)} built from its tiles is ${r.outcome}`);
      });
    }
    // the live boards: every level, Light days, three days
    for (const level of ['A2', 'B1', 'B2', 'C1']) for (const light of [false, true]) for (const day of DAYS) {
      const b = F.boardFor({ families: fams, cards: {}, day, level, light, newLeft: 3, isDue, root: fam.root });
      if (!b) { bad.push(`${fam.root} ${level}${light ? ' light' : ''}: no board`); continue; }
      b.cards.forEach((id, i) => {
        n++;
        const f = /** @type {F.Form} */ (fam.byCard.get(id));
        if (!f.key) { bad.push(`${fam.root} ${level}: ${f.word} has no tile key`); return; }
        for (const p of f.pre) if (!b.tiles.pre.includes(p)) bad.push(`${fam.root} ${level}: no tile ${p}- for ${f.word}`);
        for (const s of f.suf) if (!b.tiles.suf.includes(s)) bad.push(`${fam.root} ${level}: no tile -${s} for ${f.word}`);
        const r = F.judge({ fam, cards: b.cards, i, done: {}, pick: tap(f) });
        if (r.outcome !== 'right') bad.push(`${fam.root} ${level}: ${name(f)} built from its tiles is ${r.outcome}`);
        // the bare stem writes no letters before another ending: zu + -ig is zufällig too, unless it is another word
        if (f.suf[0] === 'stem' && f.suf.length > 1) {
          const short = { ...tap(f), suf: f.suf.slice(1).join('+') };
          const r2 = F.judge({ fam, cards: b.cards, i, done: {}, pick: short });
          const other = fam.forms.some(g => g.key === `${short.pre || ''}|${short.suf}`);
          if (!other && r2.outcome !== 'right') bad.push(`${fam.root} ${level}: ${name(f)} built without the bare stem is ${r2.outcome}`);
          if (other && r2.outcome === 'right') bad.push(`${fam.root} ${level}: ${name(f)} built without the bare stem is right, but that is another word`);
        }
      });
      if (b.tiles.pre.length > 10) bad.push(`${fam.root} ${level}: ${b.tiles.pre.length} prefix tiles`);
    }
  }
  assert.deepEqual([...new Set(bad)], []);
  assert.ok(n > 3000, `${n} board slots checked`);
});

test('the words of the review that could not be built now can, and appear on live boards', () => {
  const words = ['Unfall', 'Vergangenheit', 'zufällig', 'beruflich', 'schriftlich', 'unterschiedlich', 'zuständig', 'Verkäuferin', 'unverständlich', 'Zuständigkeit'];
  const live = new Set();
  for (const fam of fams.values()) for (const level of ['A2', 'B1', 'B2']) for (const day of DAYS) {
    const b = F.boardFor({ families: fams, cards: {}, day, level, newLeft: 3, isDue, root: fam.root });
    for (const id of b?.cards || []) live.add(/** @type {F.Form} */ (fam.byCard.get(id)).word);
  }
  for (const w of words) {
    const f = [...fams.values()].flatMap(x => x.forms).find(x => x.word === w);
    assert.ok(f && f.key, `${w} has a tile key`);
  }
  assert.ok(words.filter(w => live.has(w)).length >= 6, `on live boards: ${words.filter(w => live.has(w)).join(', ')}`);
});

test('every form typed for its own clue is right; a wrong or missing article is the article; a small letter is a slip', () => {
  const bad = [];
  let n = 0;
  for (const fam of fams.values()) {
    const cs = clues(fam);
    const cards = cs.map(f => /** @type {string} */ (f.card));
    cs.forEach((f, i) => {
      const j = (/** @type {string} */ input) => F.judgeTyped({ fam, cards, i, done: {}, input, lexicon: LEX });
      n++;
      const typed = `${f.art ? `${f.art} ` : ''}${f.inf || f.word}`;
      let r = j(typed);
      if (r?.outcome !== 'right' || r.slip) bad.push(`${fam.root}: "${typed}" is ${r?.outcome}${r?.slip ? ' (slip)' : ''}`);
      if (f.inf && f.inf !== f.word) { r = j(f.word); if (r?.outcome !== 'right') bad.push(`${fam.root}: "${f.word}" without sich is ${r?.outcome}`); }
      if (f.art) {
        for (const a of ARTS.filter(a => a !== f.art)) { n++; r = j(`${a} ${f.word}`); if (r?.outcome !== 'article') bad.push(`${fam.root}: "${a} ${f.word}" is ${r?.outcome}`); }
        r = j(f.word); if (r?.outcome !== 'article') bad.push(`${fam.root}: "${f.word}" with no article is ${r?.outcome}`);
        r = j(`${f.art} ${f.word.toLowerCase()}`); if (r?.outcome !== 'right' || !r.slip) bad.push(`${fam.root}: "${f.art} ${f.word.toLowerCase()}" is ${r?.outcome}${r?.slip ? '' : ' with no slip'}`);
      } else {
        n++; r = j(`die ${f.word}`);
        if (r?.outcome === 'right') bad.push(`${fam.root}: "die ${f.word}" (an article on a ${f.cls}) is right`);
      }
    });
  }
  assert.deepEqual(bad, []);
  assert.ok(n > 1500, `${n} cases`);
});

test('every OTHER real word typed for a clue is not right: the family\'s other forms and the lexicon\'s umlaut neighbours', () => {
  const bad = [];
  let pairs = 0, neighbours = 0, slips = 0;
  for (const fam of fams.values()) {
    const cs = clues(fam);
    const cards = cs.map(f => /** @type {string} */ (f.card));
    cs.forEach((cur, i) => {
      const j = (/** @type {string} */ input) => F.judgeTyped({ fam, cards, i, done: {}, input, lexicon: LEX });
      // the family's other forms, typed as written (with their article), and without their article
      for (const g of fam.forms) {
        if (!g.parent || sameWord(g, cur)) continue;
        for (const input of [name(g), g.word]) {
          pairs++;
          const r = j(input);
          if (r && (r.outcome === 'right' || r.outcome === 'article')) bad.push(`${fam.root}: "${input}" for the clue of ${name(cur)} ("${cur.clue}") is ${r.outcome}`);
        }
      }
      // the family's other forms built with the tiles: never this clue's word (a dual verb's readings share tiles)
      for (const g of fam.forms) {
        if (!g.key || g.key === cur.key || sameWord(g, cur)) continue;
        pairs++;
        const r = F.judge({ fam, cards, i, done: {}, pick: tap(g) });
        if (r.outcome === 'right' || r.outcome === 'article') bad.push(`${fam.root}: ${name(g)} built with the tiles for the clue of ${name(cur)} is ${r.outcome}`);
      }
      // umlaut neighbours of the clue's word: one umlaut dropped or added. A neighbour that is a real word is a miss
      // (vertraglich, Gebot aside); a dropped umlaut that spells no word is the clue's word with a slip
      const w = cur.word;
      for (let k = 0; k < w.length; k++) {
        const ch = w[k], drop = /** @type {Record<string, string>} */ ({ ä: 'a', ö: 'o', ü: 'u', Ä: 'A', Ö: 'O', Ü: 'U' })[ch], add = /** @type {Record<string, string>} */ ({ a: 'ä', o: 'ö', u: 'ü', A: 'Ä', O: 'Ö', U: 'Ü' })[ch];
        const v = drop || add;
        if (!v) continue;
        const other = w.slice(0, k) + v + w.slice(k + 1);
        const input = `${cur.art ? `${cur.art} ` : ''}${other}`;
        const r = j(input);
        const real = LEX.has(other.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss'));
        // the round's typed cards are the measure: a dropped umlaut is a slip there only when the plain spelling is no
        // word and every umlaut of the word is dropped (überhoren is a miss)
        const round = gradeTyped(input, { accept: [name(cur)], noun: !!cur.art, lexicon: LEX });
        if (add || real || !round.ok) {
          neighbours++;
          if (r && (r.outcome === 'right' || r.outcome === 'article')) bad.push(`${fam.root}: "${input}" (${add ? 'an umlaut added' : real ? 'another word' : 'a miss in the round'}) for ${name(cur)} is ${r.outcome}`);
        } else {
          slips++;
          if (!r || r.outcome !== 'right' || !r.slip) bad.push(`${fam.root}: "${input}" (a dropped umlaut) for ${name(cur)} is ${r?.outcome}${r?.slip ? '' : ' with no slip'}`);
        }
      }
    });
  }
  assert.deepEqual(bad, []);
  assert.ok(pairs > 40000 && neighbours > 100 && slips > 100, `${pairs} pairs, ${neighbours} neighbours, ${slips} slips`);
});

test('the review\'s cases: the word typed is the word judged', () => {
  const at = (/** @type {string} */ root, /** @type {string} */ id) => {
    const fam = /** @type {F.Family} */ (fams.get(root));
    const cs = clues(fam);
    const i = cs.findIndex(f => f.id === id);
    assert.ok(i >= 0, `${id} is a clue`);
    return (/** @type {string} */ input) => F.judgeTyped({ fam, cards: cs.map(f => /** @type {string} */ (f.card)), i, done: {}, input, lexicon: LEX });
  };
  assert.notEqual(at('tragen', 'verträglich.adj')('vertraglich')?.outcome, 'right', 'vertraglich is another word');
  assert.notEqual(at('bieten', 'das_Gebiet')('das Gebot')?.outcome, 'right', 'das Gebot is another word');
  const schloss = at('schließen', 'der_Schluss')('das Schloss');
  assert.ok(schloss && !['right', 'article'].includes(schloss.outcome), `das Schloss for der Schluss: ${schloss?.outcome}`);
  assert.equal(at('schließen', 'der_Schluss')('das Schluss')?.outcome, 'article', 'the noun is right: the article is the miss');
  // a nominalised infinitive and its verb: capital and article say which
  assert.equal(at('halten', 'das_Verhalten')('das Verhalten')?.outcome, 'right');
  assert.equal(at('halten', 'das_Verhalten')('der Verhalten')?.outcome, 'article');
  assert.notEqual(at('halten', 'sich_verhalten.verb')('das Verhalten')?.outcome, 'right', 'the noun for the verb\'s clue');
  assert.equal(at('halten', 'sich_verhalten.verb')('sich verhalten')?.outcome, 'right');
  assert.equal(at('sehen', 'das_Fernsehen')('das Fernsehen')?.outcome, 'right');
  assert.notEqual(at('sehen', 'fernsehen.verb')('das Fernsehen')?.outcome, 'right');
  // the rare list is "not in this family's list", never a non-word and never right
  for (const fam of fams.values()) {
    const cs = clues(fam);
    for (const w of fam.rare || []) {
      const r = F.judgeTyped({ fam, cards: cs.map(f => /** @type {string} */ (f.card)), i: 0, done: {}, input: w, lexicon: LEX });
      assert.ok(!r || !['right', 'article', 'nonword'].includes(r.outcome), `${fam.root}: rare ${w} is ${r?.outcome}`);
    }
    for (const w of fam.none) {
      const r = F.judgeTyped({ fam, cards: cs.map(f => /** @type {string} */ (f.card)), i: 0, done: {}, input: w, lexicon: LEX });
      assert.equal(r?.outcome, 'nonword', `${fam.root}: ${w}`);
    }
  }
});

test('tiles: un- goes in front of one prefix, a second ending chains only where German chains it', () => {
  const b0 = { art: null, pre: null, suf: null };
  let b = F.tapTile(b0, 'pre', 'ver', CHAINS);
  b = F.tapTile(b, 'pre', 'un', CHAINS);
  assert.equal(b.pre, 'un+ver');
  assert.equal(F.tapTile(b, 'pre', 'be', CHAINS).pre, 'un+be', 'another prefix replaces the inner one');
  assert.equal(F.tapTile(b, 'pre', 'un', CHAINS).pre, 'ver', 'un- tapped again comes off');
  b = F.tapTile(b, 'suf', 'lich', CHAINS);
  b = F.tapTile(b, 'suf', 'keit', CHAINS);
  assert.equal(b.suf, 'lich+keit');
  assert.equal(F.tapTile(b, 'suf', 'lich', CHAINS).suf, null, 'an ending tapped again comes off with the ones after it');
  assert.equal(F.tapTile({ ...b0, suf: 'ung' }, 'suf', 'er', CHAINS).suf, 'er', 'no chain -ung -er: replaced');
  assert.deepEqual(F.dropLast({ art: 'die', pre: 'un+ver', suf: 'lich+keit' }), { art: 'die', pre: 'un+ver', suf: 'lich' });
  assert.deepEqual(F.dropLast({ art: 'die', pre: 'un+ver', suf: null }), { art: 'die', pre: 'un', suf: null });
  const fall = /** @type {F.Family} */ (fams.get('fallen'));
  assert.equal(F.spell(fall, { pre: 'un', suf: 'stem' }), 'Unfall');
  assert.equal(F.spell(fall, { pre: 'zu', suf: 'stem+ig' }), 'zufällig');
});
