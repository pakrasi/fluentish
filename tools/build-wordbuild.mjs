#!/usr/bin/env node
// Builds content/build/de.json (Practice › Word building) from authoring/build/:
//   prefixes.de.json   the prefix model: kind, compass ring and position, pictogram, senses, opposites, both readings
//   roots.de.json      the root verbs (stellen, legen …) with their forms
//   verbs.de.json      root × prefix verbs: grade (literal, picture, word to learn), the "how" line, example, participle
//   frames.de.json     the sentence machine: one sentence per verb in five forms, written as tiles ("S:Ich | R:stehe | …")
//   suffixes.de.json   the endings and the article (or word type) each one gives
//   chains.de.json     word chains as trees
// The build parses the frames, fills each verb's level from its word-list entry (a verb without one carries its own)
// and links chain words to the word list. The rules are in src/domain/wordbuild.js validateBuild (run by
// tools/validate-content.mjs).
//   node tools/build-wordbuild.mjs           write the file
//   node tools/build-wordbuild.mjs --check   exit 1 if the file is not what the sources build
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseForm, lemmaFor, validateBuild } from '../src/domain/wordbuild.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'authoring/build');
export const OUT = path.join(ROOT, 'content/build/de.json');
const read = (/** @type {string} */ f) => JSON.parse(readFileSync(path.join(SRC, f), 'utf8'));

/** @param {any[]} words the German word list */
export function build(words) {
  const byId = new Map(words.map(w => [w.id, w]));
  /** @type {Map<string, any[]>} */ const byW = new Map();
  for (const w of words) byW.set(w.w, [...(byW.get(w.w) || []), w]);
  const verbs = read('verbs.de.json').map((/** @type {any} */ v) => {
    const w = v.lemma ? byId.get(v.lemma) : null;
    const level = v.level || (w && w.level);
    if (!level) throw new Error(`verb ${v.id}: no level (no word-list entry: give it one)`);
    const { level: _l, ...rest } = v;
    return { ...rest, level };
  });
  const frames = read('frames.de.json').map((/** @type {any} */ f) => ({ ...f, forms: Object.fromEntries(Object.entries(f.forms).map(([k, s]) => [k, parseForm(/** @type {string} */ (s))])) }));
  const chains = read('chains.de.json').map((/** @type {any} */ ch) => ({ ...ch, nodes: ch.nodes.map((/** @type {any} */ n) => {
    if (!n.from) return n;
    const lemma = 'lemma' in n ? n.lemma : lemmaFor(n, byW);
    return lemma ? { ...n, lemma } : n;
  }) }));
  return { version: 1, prefixes: read('prefixes.de.json'), roots: read('roots.de.json'), verbs, frames, suffixes: read('suffixes.de.json'), chains };
}

/** One entry per line: readable diffs. @param {any} data */
export function serialise(data) {
  return `{\n${Object.entries(data).map(([k, v]) => Array.isArray(v)
    ? ` ${JSON.stringify(k)}: [\n${v.map(x => `  ${JSON.stringify(x)}`).join(',\n')}\n ]`
    : ` ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n')}\n}\n`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const check = process.argv.includes('--check');
  const words = JSON.parse(readFileSync(path.join(ROOT, 'content/igloo/words/de.json'), 'utf8'));
  const data = build(words);
  const out = serialise(data);
  let cur = null;
  try { cur = readFileSync(OUT, 'utf8'); } catch { /* first build */ }
  const clusters = JSON.parse(readFileSync(path.join(ROOT, 'content/clusters/de.json'), 'utf8'));
  const errs = validateBuild(data, { words, morph: clusters.morph, clusterSuffixes: clusters.suffixes });
  if (errs.length) { console.error(`build-wordbuild: ${errs.length} problem(s)`); errs.slice(0, 80).forEach(e => console.error(`  ${e}`)); process.exit(1); }
  if (check) {
    if (cur !== out) { console.error('build-wordbuild: content/build/de.json is out of date (run node tools/build-wordbuild.mjs)'); process.exit(1); }
    console.log('build-wordbuild: current');
  } else {
    mkdirSync(path.dirname(OUT), { recursive: true });
    writeFileSync(OUT, out);
    console.log(`build-wordbuild: ${data.prefixes.length} prefixes, ${data.roots.length} roots, ${data.verbs.length} verbs, ${data.frames.length} frames, ${data.suffixes.length} suffixes, ${data.chains.length} chains; ${out.length} bytes`);
  }
}
