// Script mode: register "Both" (owner decision 10). The other form of address comes from Claude once per section; the
// app parses the reply and checks it against the German review's ihr / Sie table before keeping it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formOf, variantPrompt, parseVariant, checkVariant } from '../../src/features/practice-script/register.js';

test('formOf: ihr or Sie from the forms of address in the text', () => {
  assert.equal(formOf(['Heute zeige ich euch meinen Garten.', 'Habt ihr Fragen?']), 'informal');
  assert.equal(formOf(['Heute zeige ich Ihnen meinen Garten.', 'Haben Sie Fragen?']), 'formal');
  assert.equal(formOf(['Der Garten ist klein.']), null);
});

test('variant: one string per sentence, checked against the forms of address', () => {
  const src = ['Heute zeige ich euch meinen Garten.', 'Habt ihr Fragen?'];
  assert.match(variantPrompt(src, 'formal'), /Ihnen/);
  assert.deepEqual(parseVariant('["Heute zeige ich Ihnen meinen Garten.", "Haben Sie Fragen?"]', 2), ['Heute zeige ich Ihnen meinen Garten.', 'Haben Sie Fragen?']);
  assert.equal(parseVariant('["nur einer"]', 2), null, 'one per sentence');
  assert.equal(parseVariant('not json', 2), null);
  assert.ok(checkVariant(['Heute zeige ich Ihnen meinen Garten.', 'Haben Sie Fragen?'], 'formal'));
  assert.ok(!checkVariant(['Heute zeige ich euch meinen Garten.', 'Haben Sie Fragen?'], 'formal'), 'euch left in a Sie version');
  assert.ok(checkVariant(['Heute zeige ich euch meinen Garten.', 'Habt ihr Fragen?'], 'informal'));
  assert.ok(!checkVariant(['Heute zeige ich Ihnen meinen Garten.'], 'informal'), 'Ihnen left in an ihr version');
});
