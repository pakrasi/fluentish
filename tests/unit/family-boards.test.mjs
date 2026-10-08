// Today's family: the board rules on the shipped content (round 7, second pass; content/build/FAMILY-SCHEMA.md "Board
// rules"). Fresh learners at A2, B1 and B2 play 60 days, answering every board; every playable root comes round,
// every board holds the mix where its family allows, and the root the index alone picks is the board's root.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as F from '../../src/domain/wordbuild-family.js';
import { rootEntries } from '../../src/domain/wordbuild-family-index.js';
import { readBuild } from '../../tools/family-files.mjs';
import { readFileSync } from 'node:fs';

const C = readBuild();
const MAIN = JSON.parse(readFileSync(new URL('../../content/build/de.json', import.meta.url), 'utf8'));
const fams = F.familyModel(C);
const LV = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
const lv = (/** @type {any} */ l) => LV.indexOf(l || 'B1');
const DAY0 = Date.UTC(2026, 9, 1);
const dayOf = (/** @type {number} */ i) => new Date(DAY0 + i * 864e5).toISOString().slice(0, 10);
const ending = (/** @type {F.Form} */ f) => f.cls === 'noun' && f.artBy === 'ending';

/** 60 days of a fresh learner who answers every board (each written card is due ten days later). */
function play(/** @type {string} */ level, /** @type {boolean} */ light) {
  /** @type {string[]} */ let recent = [];
  /** @type {Record<string, any>} */ const cards = {};
  const out = [];
  for (let i = 0; i < 60; i++) {
    const day = dayOf(i);
    const isDue = (/** @type {any} */ r) => r.due <= day;
    const b = F.boardFor({ families: fams, cards, day, level, light, newLeft: 3, isDue, recent });
    assert.ok(b, `${level} ${day}: a board`);
    // the plan picks the root from de.json's index alone, without a family file (content/build/FAMILY-SCHEMA.md)
    assert.equal(F.pickRoot({ roots: rootEntries(MAIN.familyIndex), cards, day, level, isDue, recent }), b.root, `${level} ${day}: the index picks ${b.root}`);
    out.push(b);
    recent = [...recent.filter(r => r !== b.root), b.root];
    for (const c of b.writes) cards[c] = { reps: 1, due: dayOf(i + 10) };
  }
  return out;
}

const PLAYABLE = (/** @type {number} */ L) => [...fams.values()].filter(fam => fam.forms.filter(f => f.card && f.key && f.board !== false && f.clue && lv(f.level) <= L + 1 && !(f.rare && L < 3)).length >= 6).map(f => f.root);

test('rotation: a new learner meets every playable root before any comes back (38 at A2, 40 at B1 and B2)', () => {
  for (const [level, n] of /** @type {[string, number][]} */ ([['A2', 38], ['B1', 40], ['B2', 40]])) {
    assert.equal(PLAYABLE(lv(level)).length, n, `${level}: playable roots`);
    const roots = play(level, false).map(b => b.root);
    assert.equal(new Set(roots.slice(0, n)).size, n, `${level}: the first ${n} days use ${n} roots`);
    assert.deepEqual(roots.slice(n, n + 5), roots.slice(0, 5), `${level}: then the cycle starts again in the same order`);
  }
});

test('the mix: at least 40% verbs, few nouns whose ending gives the article, nouns whose article must be learnt, exceptions from B1', () => {
  const bad = [];
  const stats = [];
  for (const level of ['A2', 'B1', 'B2']) for (const light of [false, true]) {
    let v = 0, n = 0, end = 0, learn = 0, boards = 0;
    for (const b of play(level, light)) {
      const fam = /** @type {F.Family} */ (fams.get(b.root));
      const fs = b.cards.map(c => /** @type {F.Form} */ (fam.byCard.get(c)));
      const L = lv(b.level);
      const rule = F.boardRule(L, light && fs.length === 6);
      const p = fam.forms.filter(f => f.card && f.key && f.board !== false && f.clue && lv(f.level) <= L + 1 && !(f.rare && L < 3));
      const has = (/** @type {(f: F.Form) => boolean} */ fn) => fs.filter(fn).length;
      const at = `${level}${light ? ' light' : ''} ${b.day} ${b.root}`;
      if (has(f => f.cls === 'verb') < Math.min(rule.verbs, p.filter(f => f.cls === 'verb').length)) bad.push(`${at}: ${has(f => f.cls === 'verb')} verbs`);
      if (has(F.learnsArticle) < Math.min(rule.learn, p.filter(F.learnsArticle).length)) bad.push(`${at}: ${has(F.learnsArticle)} nouns whose article must be learnt`);
      if (has(f => f.artBy === 'except') < Math.min(rule.except, p.filter(f => f.artBy === 'except' && lv(f.level) <= L).length)) bad.push(`${at}: no exception`);
      // more 'ending' nouns only when the family has too few other forms to fill the board
      if (has(ending) > rule.ending && p.filter(f => !ending(f)).length >= fs.length - rule.ending) bad.push(`${at}: ${has(ending)} nouns whose ending gives the article`);
      v += has(f => f.cls === 'verb'); n += fs.length; end += has(ending); learn += has(F.learnsArticle); boards++;
    }
    stats.push(`${level}${light ? ' light' : ''}: verbs ${Math.round(100 * v / n)}%, ending nouns ${(end / boards).toFixed(1)}/board, learn-the-article nouns ${(learn / boards).toFixed(1)}/board`);
    assert.ok(v / n >= 0.42, stats.at(-1));
  }
  assert.deepEqual(bad, []);
});
