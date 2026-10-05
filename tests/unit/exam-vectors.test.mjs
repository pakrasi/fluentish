// Golden vectors for the mock exams (round 3, lane C2b), captured from the Goethe-only code BEFORE exams became data:
//   tests/vectors/exam.goethe-b1.json         domain/grade.js over all 14 tests, both objective modules, 11 answer sheets
//   tests/vectors/exam-results.b1-exam.json   the result files sync.py imports (names, bodies, commit messages)
// The generic engine (exam-def@1) must give exactly these bytes. A change that alters them on purpose writes them again
// in a commit of its own and lists every changed entry with its reason.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { make as makeGrade } from '../vectors/generate-exam.mjs';
import { make as makeResults } from '../vectors/generate-exam-results.mjs';

/** @param {string} name @param {string} got */
function same(name, got) {
  const want = readFileSync(new URL(`../vectors/${name}`, import.meta.url), 'utf8');
  if (got === want) return;
  const a = want.split('\n'), b = got.split('\n');
  const diff = [];
  for (let i = 0; i < Math.max(a.length, b.length) && diff.length < 8; i++) if (a[i] !== b[i]) diff.push(`line ${i + 1}\n  was ${(a[i] ?? '(none)').slice(0, 300)}\n  now ${(b[i] ?? '(none)').slice(0, 300)}`);
  assert.fail(`${name}: ${a.filter((l, i) => l !== b[i]).length} line(s) differ.\n${diff.join('\n')}`);
}

test('golden vectors: exam.goethe-b1.json (grading) is unchanged', async () => same('exam.goethe-b1.json', await makeGrade(true)));
test('golden vectors: exam-results.b1-exam.json (result files, through the sync target) is unchanged', async () => same('exam-results.b1-exam.json', await makeResults()));
