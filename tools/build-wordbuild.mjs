#!/usr/bin/env node
// Builds content/build/de.json (Practice › Word building) from authoring/build/:
//   prefixes.de.json   the prefix model: kind, compass ring and position, pictogram, senses, opposites, both readings
//   roots.de.json      the root verbs (stellen, legen …) with their forms
//   verbs.de.json      root × prefix verbs: grade (literal, picture, word to learn), the "how" line, example, participle
//   frames.de.json     the sentence machine: one sentence per verb in five forms, written as tiles ("S:Ich | R:stehe | …")
//   suffixes.de.json   the endings and the article (or word type) each one gives
//   chains.de.json     word chains as trees
// The word families go to one file per root, content/build/family/<root>.json, and de.json keeps their index
// (content/build/FAMILY-SCHEMA.md "Where the families live"). build() returns the merged content (with `families`);
// outputs() splits it into the files.
// The build parses the frames, fills each verb's level from its word-list entry (a verb without one carries its own)
// and links chain words to the word list. The rules are in src/domain/wordbuild.js validateBuild (run by
// tools/validate-content.mjs).
//   node tools/build-wordbuild.mjs           write the file
//   node tools/build-wordbuild.mjs --check   exit 1 if the file is not what the sources build
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseForm, lemmaFor, validateBuild } from '../src/domain/wordbuild.js';
import { readFamilies, buildFamilies } from './family-build.mjs';
import { indexOf, familySlug } from '../src/domain/wordbuild-family-index.js';
import { familyDir } from './family-files.mjs';

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
  const roots = read('roots.de.json');
  /** @type {any} */ const out = { version: 1, prefixes: read('prefixes.de.json'), roots, verbs, frames, suffixes: read('suffixes.de.json'), chains };
  // word families (round 7, content/build/FAMILY-SCHEMA.md)
  const authored = readFamilies(path.join(SRC, 'families'), ONLY);
  if (authored.length) {
    const lexcheck = existsSync(path.join(SRC, 'family-lexcheck.de.json')) ? read('family-lexcheck.de.json') : { words: {} };
    const { families, problems } = buildFamilies(authored, { words, verbs, chains, roots, lexcheck });
    if (problems.length) throw new Error(`families: ${problems.length} problem(s)\n  ${problems.slice(0, 60).join('\n  ')}`);
    for (const fam of families) {
      fam.none = fam.none.map((/** @type {any} */ n) => ({ ...n, chk: noneCheck(n.word, lexcheck) }));
    }
    out.particles = read('particles.de.json');
    out.families = families;
  }
  return out;
}

/** The recorded lexicon check of a non-word (tools/family_lexcheck.py): DWDS entry, and the highest wordfreq Zipf of its forms. @param {string} w @param {any} lexcheck */
function noneCheck(w, lexcheck) {
  const e = (lexcheck.words || {})[String(w).toLowerCase()];
  return e ? { dwds: !!e.dwds, wf: Math.max(e.wf || 0, ...Object.values(e.forms || {}).map(Number)), hits: e.hits ?? null } : null;
}
/** --only stellen,legen: build and check these families alone (authoring; never written). */
const ONLY = (() => { const i = process.argv.indexOf('--only'); return i > 0 ? String(process.argv[i + 1] || '').split(',').filter(Boolean) : []; })();

/** A family as written: its head on one line, one form per line. @param {any} f @param {string} [pad] */
const famText = (f, pad = '  ') => {
  const { forms, ...head } = f;
  const h = JSON.stringify(head);
  return `${pad}${h.slice(0, -1)},"forms":[\n${forms.map((/** @type {any} */ x) => `${pad} ${JSON.stringify(x)}`).join(',\n')}]}`;
};

/** One entry per line: readable diffs. @param {any} data */
export function serialise(data) {
  return `{\n${Object.entries(data).map(([k, v]) => Array.isArray(v)
    ? ` ${JSON.stringify(k)}: [\n${v.map(x => (k === 'families' ? famText(x) : `  ${JSON.stringify(x)}`)).join(',\n')}\n ]`
    : k === 'familyIndex'
      ? ` ${JSON.stringify(k)}: {"roots":[\n${v.roots.map((/** @type {any} */ r) => `  ${JSON.stringify(r)}`).join(',\n')}\n ]}`
      : ` ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n')}\n}\n`;
}

/**
 * The files the build writes: content/build/de.json (without `families`, with `familyIndex`) and one file per root.
 * @param {any} data build() @returns {{main: string, files: Map<string, string>}} files: file name (familySlug) → text
 */
export function outputs(data) {
  if (!data.families) return { main: serialise(data), files: new Map() };
  const { families, ...rest } = data;
  const main = serialise({ ...rest, familyIndex: indexOf(data) });
  return { main, files: new Map(families.map((/** @type {any} */ f) => [familySlug(f.root), `${famText(f, '')}\n`])) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const check = process.argv.includes('--check');
  const words = JSON.parse(readFileSync(path.join(ROOT, 'content/igloo/words/de.json'), 'utf8'));
  const data = build(words);
  const { main, files } = outputs(data);
  const clusters = JSON.parse(readFileSync(path.join(ROOT, 'content/clusters/de.json'), 'utf8'));
  const errs = validateBuild(data, { words, morph: clusters.morph, clusterSuffixes: clusters.suffixes });
  if (errs.length) { console.error(`build-wordbuild: ${errs.length} problem(s)`); errs.slice(0, 80).forEach(e => console.error(`  ${e}`)); process.exit(1); }
  if (ONLY.length) { console.log(`build-wordbuild: ${ONLY.join(', ')}: no problems (nothing written)`); process.exit(0); }
  const dir = familyDir(ROOT);
  const onDisk = existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)) : [];
  const read = (/** @type {string} */ p) => { try { return readFileSync(p, 'utf8'); } catch { return null; } };
  if (check) {
    const stale = [];
    if (read(OUT) !== main) stale.push('content/build/de.json');
    for (const [r, text] of files) if (read(path.join(dir, `${r}.json`)) !== text) stale.push(`content/build/family/${r}.json`);
    for (const r of onDisk) if (!files.has(r)) stale.push(`content/build/family/${r}.json (no such family)`);
    if (stale.length) { console.error(`build-wordbuild: out of date (run node tools/build-wordbuild.mjs): ${stale.slice(0, 10).join(', ')}`); process.exit(1); }
    console.log('build-wordbuild: current');
  } else {
    mkdirSync(dir, { recursive: true });
    writeFileSync(OUT, main);
    for (const [r, text] of files) writeFileSync(path.join(dir, `${r}.json`), text);
    for (const r of onDisk) if (!files.has(r)) unlinkSync(path.join(dir, `${r}.json`));
    const fb = [...files.values()].reduce((n, t) => n + t.length, 0);
    console.log(`build-wordbuild: ${data.prefixes.length} prefixes, ${data.roots.length} roots, ${data.verbs.length} verbs, ${data.frames.length} frames, ${data.suffixes.length} suffixes, ${data.chains.length} chains; de.json ${main.length} bytes; ${files.size} family files, ${fb} bytes`);
  }
}
