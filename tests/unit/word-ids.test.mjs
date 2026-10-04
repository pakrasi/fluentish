// Exam words: Practice (features/practice/words.js trimWords) and Look up (features/lookup/words.js cardId) must name
// the same review card for the same lemma, so a word practised in a round shows its schedule on the word sheet.
// Both go through wordId() in domain/itemids.js. Synthetic vocab rows; the real public word map.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { trimWords } from '../../src/features/practice/words.js';
import { mergeVocab, lemmaGroups, cardId } from '../../src/features/lookup/words.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const wordmap = JSON.parse(readFileSync(path.join(ROOT, 'content/b1/wordmap.json'), 'utf8'));
const fixture = JSON.parse(readFileSync(path.join(ROOT, 'tests/fixtures/lookup-words-synthetic.json'), 'utf8'));

const rows = [
  { word: 'Zeit', lemma: 'Zeit', gloss: 'time', sentence: 'Ich habe keine Zeit.', day: 2, exam_days: 9, zipf: 6 },
  { word: 'Zeiten', lemma: 'Zeit', gloss: 'time', sentence: 'In diesen Zeiten.', day: 4 },
  { word: 'abgesagt', lemma: 'absagen', gloss: 'cancel', sentence: 'Sie hat abgesagt.', day: 1, exam_days: 1, zipf: 3.2 },
  { word: 'Übernachtungsmöglichkeit', lemma: 'Übernachtungsmöglichkeit', gloss: 'place to stay', sentence: 'Gibt es eine Übernachtungsmöglichkeit?', day: 3 },
  ...fixture.words.filter(w => w.gloss && w.sentence && !w.deleted),
];

test('the same lemma is the same card in Practice and Look up', () => {
  const practice = new Map(trimWords(rows, wordmap).map(w => [w.lemma.toLowerCase(), w.id]));
  const groups = lemmaGroups(mergeVocab(rows, [], []));
  assert.ok(practice.size >= 4);
  for (const g of groups) {
    if (!practice.has(g.key)) continue;              // Practice keeps only glossed words with a sentence
    assert.equal(cardId(g, wordmap), practice.get(g.key), g.lemma);
  }
  const zeit = groups.find(g => g.key === 'zeit');
  assert.match(cardId(zeit, wordmap), /^W:/, 'a lemma in the word map is a W: card');
  assert.equal(cardId(groups.find(g => g.key === 'übernachtungsmöglichkeit'), wordmap), 'BW:uebernachtungsmoeglichkeit');
  assert.ok(!groups.some(g => cardId(g, wordmap).startsWith('x:')));
});

test('a schedule Practice wrote is the one Look up reads', () => {
  const [w] = trimWords(rows.slice(0, 1), wordmap);
  const cards = { [w.id]: { reps: 2, due: 20000 } };
  const g = lemmaGroups(mergeVocab(rows.slice(0, 2), [], []))[0];
  assert.deepEqual(cards[cardId(g, wordmap)], { reps: 2, due: 20000 });
});
