#!/usr/bin/env node
// Builds content/clusters/de.json (word families, prefixes, suffixes, opposites, topics, prepositions) from
// authoring/clusters/, and adds the words the clusters need to the German word list:
//   words-added.de.json   new word-list entries (level, gloss, example); appended to content/igloo/words/de.json
//   morph.de.json         prefix, stem, suffix and (for verbs) separability for every word
//   families.de.json      curated word families: head, label, note, members (one family a word)
//   affixes.de.json       prefix and suffix notes, with the gender rule and its exceptions
//   opposites.de.json     groups and pairs; the build marks the primary pairs (domain/clusters.js primaryPairs)
//   topics.de.json        the core split for 'core' words, and a topic for every chunk
//   preps.de.json         preposition groups, usage notes with examples, gap sentences
// The rules the content must follow are in src/domain/clusters.js validateClusters (run by validate-content.mjs).
//   node tools/build-clusters.mjs           write both files
//   node tools/build-clusters.mjs --check   exit 1 if either file is not what the sources build
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { primaryPairs } from '../src/domain/clusters.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'authoring/clusters');
export const OUT = path.join(ROOT, 'content/clusters/de.json');
export const WORDS = path.join(ROOT, 'content/igloo/words/de.json');
const read = (/** @type {string} */ f) => JSON.parse(readFileSync(path.join(SRC, f), 'utf8'));

/**
 * The word list with the added words appended (as text, so the existing file keeps its exact bytes).
 * @param {string} text the current word list @param {any[]} added
 */
export function withAdded(text, added) {
  const list = JSON.parse(text);
  const have = new Map(list.map((/** @type {any} */ w) => [w.id, w]));
  const missing = [];
  for (const a of added) {
    const cur = have.get(a.id);
    if (!cur) missing.push(a);
    else if (JSON.stringify(cur) !== JSON.stringify(a)) throw new Error(`word ${a.id} differs from authoring/clusters/words-added.de.json: edit both`);
  }
  if (!missing.length) return text;
  const end = text.lastIndexOf(']');
  return `${text.slice(0, end)},${missing.map(a => JSON.stringify(a)).join(',')}${text.slice(end)}`;
}

/** @param {any[]} words the full word list */
export function build(words) {
  const morph = read('morph.de.json'), families = read('families.de.json'), affixes = read('affixes.de.json');
  const opp = read('opposites.de.json'), topics = read('topics.de.json'), preps = read('preps.de.json');
  const themes = JSON.parse(readFileSync(path.join(ROOT, 'content/igloo/words/themes.json'), 'utf8'));
  /** @type {Record<string, string>} */ const famOf = {};
  for (const f of families) for (const m of f.members) famOf[m] = f.id;
  /** @type {Record<string, any>} */ const m2 = {};
  for (const w of words) {
    const m = morph[w.id];
    if (!m) throw new Error(`no morphology for ${w.id} in authoring/clusters/morph.de.json`);
    m2[w.id] = { ...(m.pre.length ? { pre: m.pre } : {}), stem: m.stem, ...(m.suf.length ? { suf: m.suf } : {}), ...('sep' in m ? { sep: m.sep } : {}), ...(famOf[w.id] ? { family: famOf[w.id] } : {}) };
  }
  const list = [...themes.filter((/** @type {any} */ t) => t.id !== 'core').map((/** @type {any} */ t) => ({ id: t.id, label: t.en })), ...topics.split];
  const { groups, gaps, ...rest } = preps;
  return {
    version: 1,
    morph: m2,
    families,
    prefixes: affixes.prefixes,
    suffixes: affixes.suffixes,
    opposites: { groups: opp.groups, pairs: primaryPairs(opp.pairs) },
    topics: { list, core: topics.core, chunks: topics.chunks },
    preps: { groups, notes: rest.preps, gaps },
  };
}

/** One line per entry (a word, a family, a pair, a gap …), two levels deep: readable diffs, a small file. @param {any} data */
export function serialise(data) {
  const pad = (/** @type {number} */ n) => ' '.repeat(n);
  /** @param {any} v @param {number} depth @param {number} ind @returns {string} */
  const fmt = (v, depth, ind) => {
    if (depth === 0 || v === null || typeof v !== 'object') return JSON.stringify(v);
    const arr = Array.isArray(v);
    const parts = arr ? v.map(x => pad(ind + 1) + fmt(x, depth - 1, ind + 1)) : Object.entries(v).map(([k, x]) => `${pad(ind + 1)}${JSON.stringify(k)}: ${fmt(x, depth - 1, ind + 1)}`);
    if (!parts.length) return arr ? '[]' : '{}';
    return `${arr ? '[' : '{'}\n${parts.join(',\n')}\n${pad(ind)}${arr ? ']' : '}'}`;
  };
  const depth = (/** @type {string} */ k) => (k === 'opposites' || k === 'topics' || k === 'preps' ? 2 : 1);
  return `{\n${Object.entries(data).map(([k, v]) => ` ${JSON.stringify(k)}: ${fmt(v, depth(k), 1)}`).join(',\n')}\n}\n`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const check = process.argv.includes('--check');
  const text = readFileSync(WORDS, 'utf8');
  const next = withAdded(text, read('words-added.de.json'));
  const out = serialise(build(JSON.parse(next)));
  let cur = null;
  try { cur = readFileSync(OUT, 'utf8'); } catch { /* first build */ }
  if (check) {
    const bad = [next !== text && 'content/igloo/words/de.json', cur !== out && 'content/clusters/de.json'].filter(Boolean);
    if (bad.length) { console.error(`build-clusters: out of date: ${bad.join(', ')} (run node tools/build-clusters.mjs)`); process.exit(1); }
    console.log('build-clusters: current');
  } else {
    if (next !== text) writeFileSync(WORDS, next);
    mkdirSync(path.dirname(OUT), { recursive: true });
    writeFileSync(OUT, out);
    console.log(`build-clusters: ${Object.keys(JSON.parse(out).morph).length} words, ${out.length} bytes`);
  }
}
