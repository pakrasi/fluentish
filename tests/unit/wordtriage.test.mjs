// The shared exam-word triage (src/domain/wordtriage.js, UX §3.3) and its two callers: Practice's inQueue (what
// enters rounds) and Look up's triage (the state on My words). Synthetic words only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wordTriage, wordLevel, frequent, EXAM_WEEK } from '../../src/domain/wordtriage.js';
import { trimWords, inQueue } from '../../src/features/shared/words.js';
import { mergeVocab, lemmaGroups, triage } from '../../src/features/lookup/words.js';

test('the rule', () => {
  const w = (o) => ({ glossed: true, zipf: 3, examDays: 1, level: '', ...o });
  assert.equal(wordTriage(w({ glossed: false, zipf: 6 }), 'week'), 'waiting');
  for (const p of EXAM_WEEK) {
    assert.equal(wordTriage(w({ zipf: 4 }), p), 'queue');
    assert.equal(wordTriage(w({ examDays: 3 }), p), 'queue');
    assert.equal(wordTriage(w({ level: 'A1', examDays: 2 }), p), 'later', 'the list does not count in an exam week');
  }
  for (const p of ['none', 'after']) {
    assert.equal(wordTriage(w({ level: 'B1' }), p), 'queue');
    assert.equal(wordTriage(w({ examDays: 2 }), p), 'queue');
    assert.equal(wordTriage(w({ zipf: 4.2 }), p), 'queue', 'frequent words are never stricter outside an exam week');
    assert.equal(wordTriage(w({ level: 'B2' }), p), 'reference');
  }
  assert.equal(frequent({ zipf: 3.9, examDays: 2 }), false);
  assert.equal(wordLevel('zeit', { Zeit: ['zeit.noun', 'A1'], zeit: ['zeit.x', 'A2'] }), 'A2');
  assert.equal(wordLevel('Haus', {}), '');
});

test('Practice and Look up give every word the same answer in every phase', () => {
  const wordmap = { Termin: ['termin.noun', 'A2'], absagen: ['absagen.verb', 'B1'] };
  const rows = [
    { word: 'Termin', lemma: 'Termin', gloss: 'appointment', sentence: 'Ich habe einen Termin.', day: 2, exam_days: 1, zipf: 3.5 },
    { word: 'abgesagt', lemma: 'absagen', gloss: 'cancel', sentence: 'Sie hat abgesagt.', day: 1, exam_days: 1, zipf: 3.2 },
    { word: 'Nachbarschaft', lemma: 'Nachbarschaft', gloss: 'neighbourhood', sentence: 'Die Nachbarschaft ist ruhig.', day: 3, exam_days: 1, zipf: 3.1 },
    { word: 'Wohnung', lemma: 'Wohnung', gloss: 'flat', sentence: 'Die Wohnung ist klein.', day: 3, exam_days: 2, zipf: 3.9 },
    { word: 'Leute', lemma: 'Leute', gloss: 'people', sentence: 'Viele Leute kommen.', day: 4, exam_days: 1, zipf: 5.1 },
    { word: 'Rhabarber', lemma: 'Rhabarber', gloss: 'rhubarb', sentence: 'Der Rhabarber ist sauer.', day: 5, exam_days: 4, zipf: 2 },
  ];
  const words = trimWords(rows, wordmap);
  const groups = lemmaGroups(mergeVocab(rows, [], []));
  for (const phase of ['none', 'week', 'lastNew', 'eve', 'day', 'after']) {
    for (const w of words) {
      const g = groups.find(x => x.lemma === w.lemma);
      assert.equal(inQueue(w, phase), triage(g, phase, wordmap) === 'queue', `${w.lemma} in ${phase}`);
    }
  }
  assert.deepEqual(words.filter(w => inQueue(w, 'week')).map(w => w.lemma).sort(), ['Leute', 'Rhabarber']);
  assert.deepEqual(words.filter(w => inQueue(w, 'none')).map(w => w.lemma).sort(), ['Leute', 'Rhabarber', 'Termin', 'Wohnung', 'absagen']);
});
