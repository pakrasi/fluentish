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
import { LANGUAGES } from '../src/lang/registry.js';

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
  [/^b1\/(items|annot|grammar|bank|nouns|frames|wordmap|plan|schreiben|forms)\.json$/, m => `b1.${m[1]}`, null],
  [/^speak\/situations\.json$/, () => 'speak.situations', 'speak-situations@1'],
  [/^course\/(\w+)\.json$/, m => `course.${m[1]}`, 'course@1'],
  [/^clusters\/(\w+)\.json$/, m => `clusters.${m[1]}`, 'clusters@1'],
  [/^build\/(\w+)\.json$/, m => `build.${m[1]}`, 'build@1'],
  [/^atlas\/(\w+)\.json$/, m => `atlas.${m[1]}`, 'atlas@1'],
  [/^read\/(\w+)\.json$/, m => `read.${m[1]}`, 'readers@1'],
  [/^exams\/([\w-]+)\/exam\.json$/, m => `exam.${m[1]}.def`, 'exam-def@1'],
  [/^exams\/([\w-]+)\/locale\.([\w-]+)\.json$/, m => `exam.${m[1]}.locale.${m[2]}`, 'exam-locale@1'],
  [/^exams\/([\w-]+)\/why\/day(\d+)\.json$/, m => `exam.${m[1]}.why.${m[2]}`, '%s-why@1'],
  [/^exams\/([\w-]+)\/day(\d+)\.json$/, m => `exam.${m[1]}.${m[2]}`, '%s-exam@1'],
];

/**
 * Mock exams the content offers, from their definitions (content/exams/<id>/exam.json, exam-def@1): the summary the
 * app's chrome and Today read (modules with limits and pass lines, media base, note). The runner loads the whole
 * definition by its id (`def`) and the runner strings by `locale`.
 */
export function examEntries() {
  const dir = path.join(CONTENT, 'exams');
  return readdirSync(dir).filter(id => { try { return statSync(path.join(dir, id, 'exam.json')).isFile(); } catch { return false; } }).sort().map(id => {
    const d = JSON.parse(readFileSync(path.join(dir, id, 'exam.json'), 'utf8'));
    return {
      id: d.id, name: d.name, short: d.short, language: d.language, level: d.level,
      modules: d.sections.map((/** @type {any} */ s) => ({ id: s.id, name: s.name, minutes: s.minutes, max: s.max, pass: s.pass,
        ...(s.prepMinutes ? { prepMinutes: s.prepMinutes } : {}), ...(s.planMinutes ? { planMinutes: s.planMinutes } : {}) })),
      media: d.media.base, note: d.note,
      def: `exam.${d.id}.def`, locale: `exam.${d.id}.locale.${d.locale}`,
    };
  });
}

/** Old schema id → its generic id (schemas/content-ids.json): the manifest names the generic one. */
export const ALIASES = /** @type {Record<string, string>} */ (JSON.parse(readFileSync(path.join(ROOT, 'schemas/content-ids.json'), 'utf8')).aliases);
/** The generic id of a schema id (itself when it has no alias). @param {string} id */
export const canonical = id => ALIASES[id] || id;

/** Content that belongs to no one language (the English sources, the framework, GO's tenses in every language). */
export const SHARED = new Set(['igloo.framework', 'igloo.turns', 'igloo.chunks.en', 'igloo.sentences.en', 'igloo.words.themes']);
/** Pack ids (src/lang registry: 'de', 'fr' …) by the language's own id or its settings id ('german'). */
const PACK = new Map(LANGUAGES.flatMap(l => [[l.id, l.id], [l.legacyId, l.id]]));

/**
 * The language pack a content file belongs to ('de', 'fr' …), or 'shared'. By id: a file named for a language
 * (igloo.chunks.french, igloo.lang.german, clusters.de, igloo.chunks.accept.german); the B1 trainer (b1.*) and the
 * speaking situations are German; an exam's files are its language's (exams[].language).
 * @param {string} id @param {{id: string, language: string}[]} exams
 */
export function packOf(id, exams) {
  if (SHARED.has(id)) return 'shared';
  if (/^(b1|speak)\./.test(id)) return 'de';
  const ex = exams.find(e => id.startsWith(`exam.${e.id}.`));
  if (ex) { const p = PACK.get(ex.language); if (p) return p; }
  const last = id.split('.').pop() || '';
  const p = PACK.get(last);
  if (p) return p;
  throw new Error(`content file ${id}: no language pack (name it for its language, or list it in SHARED)`);
}

/**
 * packs: 'shared' then each language's file ids (registry order), only languages with files.
 * @param {{id: string}[]} files @param {{id: string, language: string}[]} exams @returns {Record<string, string[]>}
 */
export function packsOf(files, exams) {
  /** @type {Record<string, string[]>} */ const by = {};
  for (const f of files) (by[packOf(f.id, exams)] ||= []).push(f.id);
  return Object.fromEntries(['shared', ...LANGUAGES.map(l => l.id)].filter(k => by[k]).map(k => [k, by[k]]));
}

/**
 * Native review (C3a): reviewedBy and reviewedAt come together, on the file (an object) or on an entry (an array item,
 * a phrase, a sentence variant). The schemas say their shape; this says they are a pair.
 * @param {any} data @returns {string[]}
 */
export function reviewErrors(data) {
  const out = [];
  const one = (/** @type {any} */ o, /** @type {string} */ at) => {
    if (!o || typeof o !== 'object' || Array.isArray(o)) return;
    if (('reviewedBy' in o) !== ('reviewedAt' in o)) out.push(`${at}: reviewedBy and reviewedAt go together`);
  };
  one(data, '/');
  const entries = Array.isArray(data) ? data.map((x, i) => [`/${i}`, x])
    : data && typeof data === 'object' ? ['chunks', 'variants'].flatMap(k => (data[k] && typeof data[k] === 'object' ? Object.entries(data[k]).map(([id, x]) => [`/${k}/${id}`, x]) : [])) : [];
  for (const [at, x] of entries) one(x, at);
  return out;
}

const walk = d => readdirSync(d).flatMap(n => { const p = path.join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
const sha = buf => createHash('sha256').update(buf).digest('hex');

/** Languages with practice, exam and Look up content in this app. */
const CONTENT_LANGS = ['german', 'french'];

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
    out.push({ id: hit[1](m), path: p, schema: canonical(schema), bytes: buf.length, sha256: sha(buf) });
  }
  if (unmapped.length) throw new Error(`content files with no manifest rule: ${unmapped.join(', ')}`);
  const fw = JSON.parse(readFileSync(path.join(CONTENT, 'igloo/framework.json'), 'utf8'));
  const exams = examEntries().map(e => ({ ...e, tests: out.filter(f => /^\d+$/.test(f.id.slice(`exam.${e.id}.`.length)) && f.id.startsWith(`exam.${e.id}.`)).map(f => Number(f.id.split('.').pop())) }));
  return {
    schema: 'fluentish-content@1',
    version: sha(out.map(f => `${f.id}:${f.sha256}`).join('\n')).slice(0, 12),
    // content: the language has practice content in this app (German, and French since C3b); the others are listed as later
    languages: fw.languages.map(({ id, name, native, script, rtl, full }) => ({ id, name, native, script, rtl, full, content: CONTENT_LANGS.includes(id) })),
    exams,
    // each language pack's file ids (C3a): what a course needs, what the service worker precaches for it, and what
    // tools/validate-packs.mjs checks per language
    packs: packsOf(out, exams),
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
