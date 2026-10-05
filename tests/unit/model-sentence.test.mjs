// Look up's model sentence and the trainer's agree: one gap-filling function (domain/match.js gapFill), so a gap that
// opens a sentence is capitalised in both.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { modelSentence } from '../../src/features/lookup/sources.js';
import { gapFill } from '../../src/domain/match.js';

test('a sentence-initial gap answer gets its capital; a phrase does not; the bracket hint goes', () => {
  assert.equal(modelSentence({ prompt: '___ Kind spielt im Garten. (der/die/das)', answer: ['das'] }), 'Das Kind spielt im Garten.');
  assert.equal(modelSentence({ prompt: '___ Zeitung', answer: ['die'] }), 'die Zeitung');
  assert.equal(modelSentence({ prompt: 'Ich warte auf ___ Bus. (der)', answer: ['den'] }), 'Ich warte auf den Bus.');
  assert.equal(modelSentence({ prompt: 'Translate: the bus', answer: ['der Bus'] }), 'der Bus');
});

test('every B1 grammar item: Look up shows what the trainer shows', () => {
  const g = JSON.parse(readFileSync(new URL('../../content/b1/grammar.json', import.meta.url), 'utf8'));
  const items = (Array.isArray(g) ? g : g.items || []).filter(x => String(x.prompt || '').includes('___'));
  assert.ok(items.length > 10);
  for (const it of items) assert.equal(modelSentence(it), gapFill(it.prompt, [].concat(it.answer)[0]).text, it.id);
});
