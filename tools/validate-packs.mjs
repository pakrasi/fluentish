#!/usr/bin/env node
// Every language pack's content checks, in one step (round 3, C3a; Arch #15). CI runs this once; adding a language is
// data: its files land in content/, the manifest lists them under packs[<lang>], and the checks below run for them.
//
//   node tools/validate-packs.mjs            every pack
//   node tools/validate-packs.mjs de fr      these packs (and shared)
//
// Per file kind (the same validators for every language; each takes the language and reads its rules from
// tools/langrules.py):
//   igloo.lang.<lang>             validate.py               the framework's items and scenarios
//   igloo.sentences.<lang>        validate_sentences.py     the sentence bank against the English one
//   igloo.chunks.<lang>           validate_chunks.py        the phrase translations (when their authoring parts exist)
//   igloo.chunks.accept.<lang>    validate_accept.py        accepted answers, each example matches a pattern
//   igloo.grammar.items.<lang>    validate_grammar.py       grammar items against their concepts
// Per pack, its plugins (PLUGINS): the checks of content only that language has (German: the B1 trainer, the word
// clusters, Word building, the Schreiben sources), and per exam its own validators (EXAM_PLUGINS).
// tools/validate-content.mjs stays the schema gate for every file (schemas, sha256, packs, native review pairs).
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const py = (/** @type {string[]} */ ...a) => ['python3', ...a];
const node = (/** @type {string[]} */ ...a) => [process.execPath, ...a];

/** Checks that only one language's content has. pack id → commands. */
export const PLUGINS = /** @type {Record<string, string[][]>} */ ({
  shared: [py('tools/validate_levels.py')],
  de: [
    py('tools/validate_b1.py', '--all'),
    node('tools/build-clusters.mjs', '--check'),
    node('tools/build-wordbuild.mjs', '--check'),
    py('tools/build_schreiben.py', '--check'),
  ],
});

/** An exam's own validators (its test files' shapes are its own). exam id → commands. */
export const EXAM_PLUGINS = /** @type {Record<string, (dir: string) => string[][]>} */ ({
  'goethe-b1': dir => [
    py('tools/validate_exam.py', ...glob(dir, /^day\d+\.json$/)),
    py('tools/validate_exam_why.py', ...glob(`${dir}/why`, /^day\d+\.json$/)),
  ],
});

/** Files of a content directory whose names match, as repo paths. @param {string} dir @param {RegExp} re */
const glob = (dir, re) => readdirSync(path.join(ROOT, dir)).filter(n => re.test(n)).sort().map(n => `${dir}/${n}`);

/**
 * The commands that check one pack, from its file ids.
 * @param {string} pack @param {string[]} ids @param {any[]} exams manifest.exams @param {any[]} files manifest.files
 * @returns {string[][]}
 */
export function checksFor(pack, ids, exams, files) {
  const byId = new Map(files.map(f => [f.id, f]));
  /** @type {string[][]} */ const out = [];
  for (const id of ids) {
    const f = byId.get(id); if (!f) continue;
    let m;
    if ((m = /^igloo\.lang\.(\w+)$/.exec(id))) out.push(py('tools/validate.py', `content/${f.path}`));
    else if ((m = /^igloo\.sentences\.(\w+)$/.exec(id)) && m[1] !== 'en') out.push(py('tools/validate_sentences.py', `content/${f.path}`));
    else if ((m = /^igloo\.chunks\.accept\.(\w+)$/.exec(id))) { if (existsSync(path.join(ROOT, 'authoring/chunks/accept', m[1]))) out.push(py('tools/validate_accept.py', m[1])); }
    else if ((m = /^igloo\.chunks\.(\w+)$/.exec(id)) && m[1] !== 'en') { if (existsSync(path.join(ROOT, 'authoring/chunks/parts', m[1]))) out.push(py('tools/validate_chunks.py', m[1])); }
    else if ((m = /^igloo\.grammar\.items\.(\w+)$/.exec(id))) out.push(py('tools/validate_grammar.py', m[1]));
  }
  out.push(...(PLUGINS[pack] || []));
  for (const e of exams) if (ids.includes(e.def) && EXAM_PLUGINS[e.id]) out.push(...EXAM_PLUGINS[e.id](`content/exams/${e.id}`));
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const manifest = JSON.parse(readFileSync(path.join(ROOT, 'content/manifest.json'), 'utf8'));
  const want = process.argv.slice(2);
  let failed = 0, ran = 0;
  for (const [pack, ids] of Object.entries(/** @type {Record<string, string[]>} */ (manifest.packs))) {
    if (want.length && pack !== 'shared' && !want.includes(pack)) continue;
    const checks = checksFor(pack, ids, manifest.exams, manifest.files);
    const bad = [];
    for (const cmd of checks) {
      ran++;
      const r = spawnSync(cmd[0], cmd.slice(1), { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 });
      if (r.status !== 0) { bad.push(cmd.slice(1).join(' ')); console.error(`\n[${pack}] FAILED: ${cmd.slice(1).join(' ')}\n${(r.stdout || '') + (r.stderr || '')}`.trimEnd()); }
    }
    failed += bad.length;
    console.log(`${pack}: ${ids.length} files, ${checks.length} checks${bad.length ? `, ${bad.length} FAILED` : ', all passed'}`);
  }
  if (failed) { console.error(`validate-packs: ${failed} check(s) failed`); process.exit(1); }
  console.log(`validate-packs: ${ran} checks passed`);
}
