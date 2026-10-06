// Prompt templates are pinned to their text (round 4, C0): every template in src/services/prompts/<file>.js
// (export TEMPLATES = {'<name>@<n>': text}) has a pin here, and every pin a template. Changing a template's text means a
// new version id and a new pin, so a stored output always says which prompt wrote it (feedback@1 promptVersion).
// Lanes: add pins only inside your own file's block below (sha256 of the text, first 12 hex characters).
// The Schreiben grader's pins stay in records.test.mjs (its templates live in services/claude.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fill, TEMPLATE_ID } from '../../src/services/prompts/index.js';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/services/prompts');
const h = (/** @type {string} */ s) => createHash('sha256').update(s).digest('hex').slice(0, 12);

/** file → template id → pin. @type {Record<string, Record<string, string>>} */
const PINS = {
  // ---- read.js (lane L2: read-gloss, read-translate, read-questions) ----
  'read.js': {
    'read-questions@1': 'a35ee1e4234e',
    'read-translate@1': 'cf1b2a97d64a',
    'read-gloss@1': '0e2cdf13b3f3',
  },
  // ---- conversation.js (lane L4: conversation-turn, conversation-feedback, conversation-gloss) ----
  'conversation.js': {
  },
};

test('every prompt template is pinned to its text, and every pin has its template', async () => {
  const files = readdirSync(DIR).filter(f => f.endsWith('.js') && f !== 'index.js').sort();
  for (const f of files) {
    const mod = await import(pathToFileURL(path.join(DIR, f)).href);
    assert.ok(mod.TEMPLATES && typeof mod.TEMPLATES === 'object', `${f}: exports TEMPLATES`);
    assert.ok(PINS[f], `${f}: add a block for it to PINS`);
    for (const [id, text] of Object.entries(mod.TEMPLATES)) {
      assert.match(id, TEMPLATE_ID, `${f}: ${id} is '<name>@<n>'`);
      assert.equal(typeof text, 'string');
      assert.equal(h(/** @type {string} */ (text)), PINS[f][id], `${f}: ${id} changed (or is new): bump its version and pin ${h(/** @type {string} */ (text))}`);
    }
    for (const id of Object.keys(PINS[f])) assert.ok(id in mod.TEMPLATES, `${f}: pin ${id} has no template`);
  }
  // a block for a file that does not exist yet stays empty
  for (const [f, pins] of Object.entries(PINS)) if (!files.includes(f)) assert.deepEqual(pins, {}, `${f} is missing but has pins`);
  // ids are unique across files
  const ids = Object.values(PINS).flatMap(p => Object.keys(p));
  assert.equal(new Set(ids).size, ids.length, 'a template id is pinned twice');
});

test('fill: every slot needs a value; values are text; text without slots is unchanged', () => {
  assert.equal(fill('Level {level}, topic "{topic.title}".', { level: 'B2', 'topic.title': 'Umwelt' }), 'Level B2, topic "Umwelt".');
  assert.equal(fill('{n} items', { n: 5 }), '5 items');
  assert.throws(() => fill('Hello {name}', {}), /no value for \{name\}/);
  assert.equal(fill('JSON: {"a": 1}', {}), 'JSON: {"a": 1}', 'braces that are not a slot stay');
  assert.ok(TEMPLATE_ID.test('read-gloss@1') && !TEMPLATE_ID.test('read-gloss') && !TEMPLATE_ID.test('Read@1'));
});
