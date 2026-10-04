#!/usr/bin/env node
// Privacy gate. This repo is public; a learner's results, recordings, vocab, mistakes and keys must never land in it.
//
//   node tools/check-privacy.mjs --staged     pre-commit: the staged version of every added or changed file
//   node tools/check-privacy.mjs --all        CI and pre-push: every tracked file
//   node tools/check-privacy.mjs --dir _site  the built site, before it is published
//
// Extra terms (names, e-mail addresses, cities) can be listed one per line in `.privacy-terms` at the repo root.
// That file is git-ignored on purpose, so the terms themselves never get committed. Known, reviewed exceptions live
// in tools/privacy-allow.json with a reason each. Exit code 1 on any finding.
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SELF = 'tools/check-privacy.mjs';
const MAX_BYTES = 5 * 1024 * 1024;

/** Paths that only private data uses. */
const PATH_RULES = [
  { id: 'private-data-path', re: /(^|\/)data\/(attempts|vocab|vocab-reviews|voice|training|feedback[^/]*|logs|content)\//, why: 'b1-exam private data folder' },
  { id: 'private-data-file', re: /(^|\/)(results|progress|feedback|vocab|learner)\.json$/, why: 'private results / vocab / learner file' },
  { id: 'backup-state', re: /igloo-state/, why: 'device backup of review state' },
  { id: 'seed-words', re: /seed_de\.json$/, why: "words one learner already knows" },
  { id: 'database', re: /\.(db|sqlite|sqlite3)$/i, why: 'database file' },
  { id: 'media', re: /\.(mp3|m4a|webm|wav|ogg|aac)$/i, why: 'audio or recording (media stays out of this repo)' },
  { id: 'private-fixture', re: /^tests\/private\//, why: 'real exports belong in the git-ignored tests/private/' },
];

/** Content rules. `fixturesOnly` rules apply to tests/fixtures/** unless the file is marked synthetic. */
const TEXT_RULES = [
  { id: 'github-token', re: /\b(ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|gho_[A-Za-z0-9]{30,})\b/, why: 'GitHub token' },
  { id: 'anthropic-key', re: /sk-ant-[A-Za-z0-9_-]{20,}/, why: 'Anthropic API key' },
  { id: 'local-path', re: /(~\/Library\/|Application Support\/|\/Users\/[a-z][\w.-]*\/)/, why: 'local file-system path' },
  { id: 'mined-item', re: /"src"\s*:\s*"mine|:mine-/, why: 'item mined from one learner\'s own exams' },
  { id: 'grader-profile', re: /(seine|ihre|deine) bekannten Schwächen/, why: 'grader prompt that describes the learner' },
  { id: 'legacy-keys-in-fixture', re: /"(remote|draft|training):[^"]*"\s*:/, why: 'legacy localStorage dump', fixturesOnly: true },
  { id: 'answers-in-fixture', re: /"(given|writings)"\s*:/, why: 'answers or texts written by a learner', fixturesOnly: true },
];

function args() {
  const a = process.argv.slice(2);
  if (a.includes('--staged')) return { mode: 'staged' };
  const i = a.indexOf('--dir');
  if (i >= 0) return { mode: 'dir', dir: path.resolve(a[i + 1] || '_site') };
  return { mode: 'all' };
}

const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });

/** @returns {{path: string, read: () => Buffer, size: () => number}[]} */
function files(opt) {
  if (opt.mode === 'staged') {
    return git('diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z').split('\0').filter(Boolean).map(p => ({
      path: p,
      read: () => execFileSync('git', ['show', `:${p}`], { cwd: ROOT, maxBuffer: 1 << 28 }),
      size: () => Number(git('cat-file', '-s', `:${p}`).trim()),
    }));
  }
  if (opt.mode === 'dir') {
    const out = [];
    const walk = d => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); e.isDirectory() ? walk(p) : out.push(p); } };
    if (existsSync(opt.dir)) walk(opt.dir);
    return out.map(p => ({ path: path.relative(opt.dir, p).split(path.sep).join('/'), read: () => readFileSync(p), size: () => statSync(p).size }));
  }
  return git('ls-files', '-z').split('\0').filter(Boolean).map(p => ({
    path: p, read: () => readFileSync(path.join(ROOT, p)), size: () => statSync(path.join(ROOT, p)).size,
  }));
}

function loadAllow() {
  const f = path.join(ROOT, 'tools/privacy-allow.json');
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')).allow : [];
}
const globRe = g => new RegExp('^' + g.split('**').map(s => s.split('*').map(x => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')).join('.*') + '$');

function loadTerms() {
  const f = path.join(ROOT, '.privacy-terms');
  if (!existsSync(f)) return [];
  return readFileSync(f, 'utf8').split('\n').map(s => s.trim()).filter(s => s && !s.startsWith('#'))
    .map(t => ({ id: 'private-term', re: new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'), why: 'term listed in .privacy-terms' }));
}

const opt = args();
const allow = loadAllow().map(a => ({ ...a, re: globRe(a.path) }));
const allowed = (p, id) => allow.some(a => a.re.test(p) && (a.rules || []).includes(id));
const rules = [...TEXT_RULES, ...loadTerms()];
const findings = [];
let n = 0;
for (const f of files(opt)) {
  if (f.path === SELF || f.path === '.privacy-terms') continue;
  n++;
  for (const r of PATH_RULES) if (r.re.test(f.path) && !allowed(f.path, r.id)) findings.push([f.path, r.id, r.why]);
  if (f.size() > MAX_BYTES && !allowed(f.path, 'size')) findings.push([f.path, 'size', `over ${MAX_BYTES / 1048576} MB`]);
  if (/\.(png|jpe?g|gif|webp|ico|woff2?|ttf|otf|pdf)$/i.test(f.path)) continue;
  const text = f.read().toString('utf8');
  const fixture = f.path.startsWith('tests/fixtures/');
  const synthetic = fixture && /"synthetic"\s*:\s*true/.test(text.slice(0, 400));
  for (const r of rules) {
    if (r.fixturesOnly && (!fixture || synthetic)) continue;
    const m = r.re.exec(text);
    if (m && !allowed(f.path, r.id)) {
      const line = text.slice(0, m.index).split('\n').length;
      findings.push([`${f.path}:${line}`, r.id, r.why]);
    }
  }
}
if (findings.length) {
  console.error(`check-privacy: ${findings.length} finding(s) in ${n} file(s):`);
  for (const [where, id, why] of findings) console.error(`  ${where}  [${id}] ${why}`);
  console.error('Fix the file, or add a reviewed exception to tools/privacy-allow.json with a reason.');
  process.exit(1);
}
console.log(`check-privacy: ${n} file(s) clean (${opt.mode})`);
