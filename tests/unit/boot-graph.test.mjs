// The boot graph: every module src/main.js reaches through static imports. tools/stamp.mjs puts each of them in a
// modulepreload link, so all of it downloads and compiles before the first screen draws on the phone. Code that boot
// rarely needs (restore, migration, cutover, the progress log, the grader, the word-family engine) is loaded with
// import() where it is used, and this test keeps it that way: a budget for the graph's size, and a list of modules
// it must not reach. A change that raises the budget says why in its commit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { importGraph } from '../../tools/stamp.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (/** @type {string} */ p) => readFileSync(path.join(ROOT, p));

// ceilings (9 Oct 2026, before round 8 P1: 81 modules, 1,116 KB raw, 378 KB gzip)
const BUDGET = { modules: 81, rawKB: 1117, gzipKB: 379 };

const graph = () => importGraph('src/main.js', p => read(p).toString('utf8'));

test('the boot graph stays within its budget', () => {
  const g = graph();
  let raw = 0, gz = 0;
  for (const f of g) { const b = read(f); raw += b.length; gz += gzipSync(b, { level: 6 }).length; }
  const now = { modules: g.length, rawKB: Math.ceil(raw / 1024), gzipKB: Math.ceil(gz / 1024) };
  assert.ok(now.modules <= BUDGET.modules, `boot graph has ${now.modules} modules, budget ${BUDGET.modules}`);
  assert.ok(now.rawKB <= BUDGET.rawKB, `boot graph is ${now.rawKB} KB raw, budget ${BUDGET.rawKB} KB`);
  assert.ok(now.gzipKB <= BUDGET.gzipKB, `boot graph is ${now.gzipKB} KB gzip, budget ${BUDGET.gzipKB} KB`);
});
