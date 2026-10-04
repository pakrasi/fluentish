#!/usr/bin/env node
// Date gate: the exam date is a user setting (core/clock.js + settings), so no calendar date may be hard-coded in src/.
// Fails on any "20NN-" date literal in src/**, the shell HTML and the styles. Tests and fixtures may use dates freely.
//   node tools/check-dates.mjs            every tracked file under the checked paths
//   node tools/check-dates.mjs --staged   the staged versions (pre-commit)
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECKED = /^(src\/(?!vendor\/)|styles\/|index\.html$|404\.html$)/;
const DATE = /\b20\d\d-(0[1-9]|1[0-2])\b/;
const staged = process.argv.includes('--staged');
const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 });
const list = staged ? git('diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z') : git('ls-files', '-z');
const bad = [];
for (const p of list.split('\0').filter(f => f && CHECKED.test(f))) {
  const text = staged ? git('show', `:${p}`) : readFileSync(path.join(ROOT, p), 'utf8');
  text.split('\n').forEach((l, i) => { if (DATE.test(l)) bad.push(`${p}:${i + 1}: ${l.trim().slice(0, 100)}`); });
}
if (bad.length) {
  console.error(`check-dates: ${bad.length} hard-coded date(s); read dates from core/clock.js instead:`);
  bad.forEach(b => console.error('  ' + b));
  process.exit(1);
}
console.log('check-dates: no hard-coded dates in src');
