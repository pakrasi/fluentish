// readers@1 (round 4, C0): the graded-text schema, its validator (domain/readers.js) and the synthetic fixture that
// lanes L2 (the reader) and L3 (the texts) both build against.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate, unsupported } from '../../src/core/schema.js';
import { readersErrors } from '../../src/domain/readers.js';
import de from '../../src/lang/de/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const J = (/** @type {string} */ p) => JSON.parse(readFileSync(path.join(ROOT, p), 'utf8'));
const SCHEMA = J('schemas/content/readers.schema.json');
const FIX = J('tests/fixtures/readers-synthetic.json');

test('readers@1: the schema uses only supported keywords and the fixture matches it and its rules', () => {
  assert.equal(SCHEMA.$id, 'readers@1');
  assert.deepEqual(unsupported(SCHEMA), []);
  assert.deepEqual(validate(SCHEMA, FIX), []);
  assert.deepEqual(readersErrors(FIX, de.text), []);
  assert.deepEqual(readersErrors(FIX), [], 'without a language\'s rules (no word count check)');
});

test('readers@1: a card-shaped id, a missing licence or an unknown field fails the schema', () => {
  const t = FIX.texts[0];
  assert.ok(validate(SCHEMA, { ...FIX, texts: [{ ...t, id: 'R:b2-umwelt-01' }] }).length, 'R: looks like a card id');
  assert.ok(validate(SCHEMA, { ...FIX, texts: [{ ...t, licence: 'unknown' }] }).length);
  assert.ok(validate(SCHEMA, { ...FIX, texts: [{ ...t, extra: 1 }] }).length);
});

test('readers@1 rules: ids, word count, licence and source, questions and their evidence', () => {
  const t = FIX.texts[0];
  const errs = (/** @type {any} */ x) => readersErrors({ ...FIX, texts: [{ ...t, ...x }] }, de.text);
  assert.match(readersErrors({ ...FIX, texts: [t, t] }, de.text).join('\n'), /id used twice/);
  assert.match(errs({ id: 'read/fr/x' }).join(), /must start with read\/de\//);
  assert.match(errs({ words: 80 }).join(), /words 80, but the text has 36/);
  assert.deepEqual(errs({ words: 38 }), [], 'within 10 %');
  assert.match(errs({ licence: 'PD' }).join(), /needs its source/);
  assert.deepEqual(errs({ licence: 'PD', source: { author: 'A', work: 'W', year: 1811 } }), []);
  assert.match(errs({ source: { author: 'A', work: 'W' } }).join(), /own text has no source/);
  const q = t.questions[0];
  assert.match(errs({ questions: [{ ...q, answer: 3 }] }).join(), /answer 3 is not an option/);
  assert.match(errs({ questions: [{ ...q, options: ['a', 'a', 'b'] }] }).join(), /options repeat/);
  assert.match(errs({ questions: [{ ...q, evidence: 'Jeden Sonntag' }] }).join(), /evidence not found/);
  assert.deepEqual(errs({ questions: [{ ...q, evidence: 'Jeden  Samstag\ntreffen' }] }), [], 'spaces folded');
  assert.match(errs({ questions: [{ ...t.questions[1], options: ['richtig', 'falsch', 'vielleicht'] }] }).join(), /two options/);
  assert.match(errs({ sections: [{ id: 's1', sentences: [{ id: 'a1', text: 'Ein Satz.' }, { id: 'a1', text: 'Noch einer.' }] }], questions: [], words: 4 }).join(), /sentence a1 used twice/);
});
