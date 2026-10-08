#!/usr/bin/env node
// The content's default boards of the word families (content/build/FAMILY-SCHEMA.md "Board" and "Board rules"),
// composed by the game's own rule: boardFor for a new learner on that root (no cards, three new words), so a default
// board and a live board follow the same mix (verbs, article nouns, exceptions) and the same tiles. Light is six of
// the board's words, by the same rule. A2 only where the family has six board forms at A1 to B1.
//
//   node tools/family-boards.mjs            rewrite the boards of authoring/build/families/*.json
//   node tools/family-boards.mjs --check    exit 1 if a family's boards are not what the rule composes
//   node tools/family-boards.mjs --only stellen,legen
//
// Then node tools/build-wordbuild.mjs. The validator (src/domain/wordbuild-family-check.js) holds the boards to the
// rules whatever wrote them.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from './build-wordbuild.mjs';
import { familyModel, boardFor } from '../src/domain/wordbuild-family.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'authoring/build/families');
/** A day for the tie-breaks (a forced root uses none; kept fixed so the output is stable). */
const DAY = '2026-10-08';
const LEVELS = /** @type {const} */ (['A2', 'B1', 'B2']);

/**
 * The default boards of one family, by level.
 * @param {import('../src/domain/wordbuild-family.js').Family} fam @param {Map<string, any>} fams the model
 * @returns {Record<string, {words: string[], light: string[], tiles: {pre: string[], suf: string[]}, distract: {pre: string[], is: string}[]}>}
 */
export function boardsOf(fam, fams) {
  /** @type {Record<string, any>} */ const out = {};
  const base = { families: fams, cards: {}, day: DAY, newLeft: 3, isDue: () => false, root: fam.root };
  for (const level of LEVELS) {
    const b = boardFor({ ...base, level });
    if (!b || b.level !== level) continue;   // A2: fewer than six board forms at A1 to B1 (the game uses B1's forms)
    const forms = b.cards.map(c => /** @type {any} */ (fam.byCard.get(c)));
    const words = forms.map(f => f.id);
    // light: six of these words by the same rule (every other form is out of play)
    const out6 = new Set(fam.forms.filter(f => !words.includes(f.id)).map(f => f.id));
    const lb = boardFor({ ...base, level, light: true, reported: out6 });
    const light = lb ? lb.cards.map(c => /** @type {any} */ (fam.byCard.get(c)).id) : words.slice(0, 6);
    const onBoard = new Set(forms.flatMap(f => f.pre));
    const noneKeys = new Set(fam.noneKeys || []);
    const distract = b.tiles.pre.filter(p => !onBoard.has(p)).map(p => ({ pre: p, is: noneKeys.has(`${p}|`) ? 'none' : 'extra' }));
    out[level] = { words, light, tiles: { pre: b.tiles.pre, suf: b.tiles.suf }, distract };
  }
  return out;
}

/** The boards block of an authoring file, one level per line (the files' style). @param {Record<string, any>} boards */
const boardsText = boards => ` "boards": {\n${Object.entries(boards).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v).replace(/,"/g, ', "').replace(/":/g, '": ').replace(/,\{/g, ', {')}`).join(',\n')}\n },`;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  const i = process.argv.indexOf('--only');
  const only = i > 0 ? String(process.argv[i + 1] || '').split(',') : [];
  const words = JSON.parse(readFileSync(path.join(ROOT, 'content/igloo/words/de.json'), 'utf8'));
  const data = build(words);
  // the model without the content's boards, so the composition never falls back on the boards it replaces
  const fams = familyModel({ ...data, families: data.families.map((/** @type {any} */ f) => ({ ...f, boards: {} })) });
  const stale = [];
  for (const file of readdirSync(DIR).filter(f => f.endsWith('.json')).sort()) {
    const p = path.join(DIR, file);
    const text = readFileSync(p, 'utf8');
    const a = JSON.parse(text);
    if (only.length && !only.includes(a.root)) continue;
    const fam = fams.get(a.root);
    if (!fam) continue;
    const boards = boardsOf(fam, fams);
    if (JSON.stringify(boards) === JSON.stringify(a.boards || {})) continue;
    stale.push(a.root);
    if (!check) {
      const m = /^ "boards": \{[\s\S]*?\n \},$/m.exec(text);
      if (!m) throw new Error(`${file}: no boards block to replace`);
      writeFileSync(p, text.replace(m[0], boardsText(boards)));
      if (JSON.stringify(JSON.parse(readFileSync(p, 'utf8')).boards) !== JSON.stringify(boards)) throw new Error(`${file}: boards did not round-trip`);
    }
  }
  if (check && stale.length) { console.error(`family-boards: ${stale.length} famil${stale.length === 1 ? 'y' : 'ies'} out of date: ${stale.join(', ')} (run node tools/family-boards.mjs)`); process.exit(1); }
  console.log(check ? 'family-boards: current' : `family-boards: ${stale.length} rewritten${stale.length ? `: ${stale.join(', ')}` : ''}`);
}
