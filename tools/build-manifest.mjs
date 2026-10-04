#!/usr/bin/env node
// Writes content/manifest.json: the single entry point to the public content, for the web app and later the iOS app.
// Every file under content/ is listed with an id, its schema, size and sha256; the version is a digest of all of them,
// so the manifest is deterministic (no timestamps) and CI can check that it is current.
//   node tools/build-manifest.mjs           write it
//   node tools/build-manifest.mjs --check   exit 1 if the file on disk is out of date
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONTENT = path.join(ROOT, 'content');

/** path pattern → [id template, schema id]. The first match wins. */
export const MAP = [
  [/^igloo\/framework\.json$/, () => 'igloo.framework', 'igloo-framework@1'],
  [/^igloo\/turns\.json$/, () => 'igloo.turns', 'igloo-turns@1'],
  [/^igloo\/lang\/(\w+)\.json$/, m => `igloo.lang.${m[1]}`, 'igloo-lang@1'],
  [/^igloo\/sentences\/en\.json$/, () => 'igloo.sentences.en', 'igloo-sentences-en@1'],
  [/^igloo\/sentences\/(\w+)\.json$/, m => `igloo.sentences.${m[1]}`, 'igloo-sentences@1'],
  [/^igloo\/chunks\/en\.json$/, () => 'igloo.chunks.en', 'igloo-chunks-en@1'],
  [/^igloo\/chunks\/accept_(\w+)\.json$/, m => `igloo.chunks.accept.${m[1]}`, 'igloo-chunks-accept@1'],
  [/^igloo\/chunks\/priority_(\w+)\.json$/, m => `igloo.chunks.priority.${m[1]}`, 'igloo-chunks-priority@1'],
  [/^igloo\/chunks\/(\w+)\.json$/, m => `igloo.chunks.${m[1]}`, 'igloo-chunks@1'],
  [/^igloo\/words\/themes\.json$/, () => 'igloo.words.themes', 'igloo-word-themes@1'],
  [/^igloo\/words\/(\w+)\.json$/, m => `igloo.words.${m[1]}`, 'igloo-words@1'],
  [/^igloo\/grammar\/items_(\w+)\.json$/, m => `igloo.grammar.items.${m[1]}`, 'igloo-grammar-items@1'],
  [/^igloo\/grammar\/concepts_(\w+)\.json$/, m => `igloo.grammar.concepts.${m[1]}`, 'igloo-grammar-concepts@1'],
  [/^b1\/(items|annot|grammar|bank|nouns|frames|wordmap|plan|schreiben)\.json$/, m => `b1.${m[1]}`, null],
  [/^speak\/situations\.json$/, () => 'speak.situations', 'speak-situations@1'],
  [/^exams\/([\w-]+)\/why\/day(\d+)\.json$/, m => `exam.${m[1]}.why.${m[2]}`, '%s-why@1'],
  [/^exams\/([\w-]+)\/day(\d+)\.json$/, m => `exam.${m[1]}.${m[2]}`, '%s-exam@1'],
];

/** Mock exams the content offers. Module limits follow the official format; pass = 60 %. */
export const EXAMS = [{
  id: 'goethe-b1', name: 'Goethe-Zertifikat B1', short: 'Goethe B1', language: 'german', level: 'B1',
  modules: [
    { id: 'lesen', name: 'Lesen', minutes: 65, max: 30, pass: 18 },
    { id: 'hoeren', name: 'Hören', minutes: 40, max: 30, pass: 18 },
    { id: 'schreiben', name: 'Schreiben', minutes: 60, max: 100, pass: 60 },
    { id: 'sprechen', name: 'Sprechen', minutes: 15, max: 100, pass: 60 },
  ],
  media: 'https://pakrasi.github.io/b1-exam/audio/',
  note: 'Practice in the format of the Goethe-Zertifikat B1. Not affiliated with the Goethe-Institut.',
}];

const walk = d => readdirSync(d).flatMap(n => { const p = path.join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
const sha = buf => createHash('sha256').update(buf).digest('hex');

/** Languages with practice, exam and Look up content in this app. */
const CONTENT_LANGS = ['german'];

export function build() {
  const files = walk(CONTENT).map(p => path.relative(CONTENT, p).split(path.sep).join('/'))
    .filter(p => p.endsWith('.json') && p !== 'manifest.json').sort();
  const out = [], unmapped = [];
  for (const p of files) {
    const hit = MAP.find(([re]) => re.test(p));
    if (!hit) { unmapped.push(p); continue; }
    const m = hit[0].exec(p);
    const buf = readFileSync(path.join(CONTENT, p));
    let schema = hit[2] ?? `b1-${m[1]}@1`;
    if (schema.includes('%s')) schema = schema.replace('%s', m[1]);
    out.push({ id: hit[1](m), path: p, schema, bytes: buf.length, sha256: sha(buf) });
  }
  if (unmapped.length) throw new Error(`content files with no manifest rule: ${unmapped.join(', ')}`);
  const fw = JSON.parse(readFileSync(path.join(CONTENT, 'igloo/framework.json'), 'utf8'));
  const exams = EXAMS.map(e => ({ ...e, tests: out.filter(f => f.id.startsWith(`exam.${e.id}.`) && !f.id.includes('.why.')).map(f => Number(f.id.split('.').pop())) }));
  return {
    schema: 'fluentish-content@1',
    version: sha(out.map(f => `${f.id}:${f.sha256}`).join('\n')).slice(0, 12),
    // content: the language has practice content in this app (phase 1: German only); the others are listed as later
    languages: fw.languages.map(({ id, name, native, script, rtl, full }) => ({ id, name, native, script, rtl, full, content: CONTENT_LANGS.includes(id) })),
    exams,
    files: out,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const text = JSON.stringify(build(), null, 1) + '\n';
  const target = path.join(CONTENT, 'manifest.json');
  if (process.argv.includes('--check')) {
    let cur = '';
    try { cur = readFileSync(target, 'utf8'); } catch {}
    if (cur !== text) { console.error('content/manifest.json is out of date: run node tools/build-manifest.mjs'); process.exit(1); }
    console.log('manifest: current');
  } else {
    writeFileSync(target, text);
    console.log(`wrote content/manifest.json (${JSON.parse(text).files.length} files)`);
  }
}
