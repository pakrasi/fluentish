// The type-check ratchet. tsconfig.json lists the modules that must type-check strict with no error (npm run
// typecheck). tsconfig.legacy.json checks every module under src strict and counts the errors in the others; that
// count may only fall. Its ceiling is tsconfig.legacy.json "ratchet.max".
//
//   node tools/typecheck-ratchet.mjs           fail when the count is above max (CI)
//   node tools/typecheck-ratchet.mjs --write   set max to the current count (only lower; run it when the count fell)
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = path.join(ROOT, 'tsconfig.legacy.json');

let out = '';
try {
  out = execFileSync(process.execPath, [path.join(ROOT, 'node_modules/typescript/bin/tsc'), '-p', CONFIG, '--pretty', 'false'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 });
} catch (e) {
  out = String(/** @type {any} */ (e).stdout || '');
  if (!out.includes('error TS')) { console.error(String(/** @type {any} */ (e).stderr || e)); process.exit(2); }
}
const errors = out.split('\n').filter(l => /error TS\d+/.test(l));
/** @type {Map<string, number>} */ const byFile = new Map();
for (const l of errors) { const f = l.split('(')[0]; byFile.set(f, (byFile.get(f) || 0) + 1); }

const cfg = JSON.parse(readFileSync(CONFIG, 'utf8'));
const max = cfg.ratchet.max;
const n = errors.length;

if (process.argv.includes('--write')) {
  if (n > max) { console.error(`typecheck ratchet: ${n} errors is above the ceiling ${max}; the ceiling only goes down.`); process.exit(1); }
  cfg.ratchet.max = n;
  writeFileSync(CONFIG, JSON.stringify(cfg, null, 2) + '\n');
  console.log(`typecheck ratchet: ceiling set to ${n}`);
  process.exit(0);
}
// the strict modules (tsconfig.json) must have none; they are checked here too
const strict = JSON.parse(readFileSync(path.join(ROOT, 'tsconfig.json'), 'utf8')).include;
const inStrict = (/** @type {string} */ f) => strict.some((/** @type {string} */ g) => new RegExp('^' + g.split('**').map(s => s.split('*').map(x => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')).join('.*') + '$').test(f));
const leaked = [...byFile.keys()].filter(inStrict);
if (leaked.length) { console.error(`typecheck ratchet: strict modules with errors: ${leaked.join(', ')}`); process.exit(1); }
if (n > max) {
  console.error(`typecheck ratchet: ${n} strict errors outside tsconfig.json, above the ceiling of ${max}. New code must type-check; most errors by file:`);
  for (const [f, k] of [...byFile.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.error(`  ${k}  ${f}`);
  process.exit(1);
}
console.log(`typecheck ratchet: ${n} strict errors outside tsconfig.json (ceiling ${max})${n < max ? `; it fell, so lower the ceiling: node tools/typecheck-ratchet.mjs --write` : ''}`);
