// Golden vectors (tests/vectors/*.json): the grader, the scheduler, the clock and the day budget must give exactly the
// outputs written there, byte for byte. A change that alters them on purpose writes them again in a commit of its own
// (node tests/vectors/generate.mjs) and lists every changed entry with its reason in the commit message.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FILES } from '../vectors/generate.mjs';

for (const [name, make] of Object.entries(FILES)) {
  test(`golden vectors: ${name} is unchanged`, async () => {
    const want = readFileSync(new URL(`../vectors/${name}`, import.meta.url), 'utf8');
    const got = await make(true);   // match.de.*.json: re-grade the answers stored in the files
    if (got === want) return;
    const a = want.split('\n'), b = got.split('\n');
    const diff = [];
    for (let i = 0; i < Math.max(a.length, b.length) && diff.length < 12; i++) if (a[i] !== b[i]) diff.push(`line ${i + 1}\n  was ${(a[i] ?? '(none)').slice(0, 400)}\n  now ${(b[i] ?? '(none)').slice(0, 400)}`);
    const n = a.filter((l, i) => l !== b[i]).length;
    assert.fail(`${name}: ${n} line(s) differ. If the change is intended, run node tests/vectors/generate.mjs in a commit of its own and list each changed entry with its reason.\n${diff.join('\n')}`);
  });
}
