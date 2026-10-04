// Look up: the search index (fold, ranking, umlauts, highlights) and its speed on the real public content.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fold, foldText, terms, buildIndex, search, matchRanges, countByTab } from '../../src/features/lookup/search.js';
import { phraseRows, dictRows, layerRows, topicRows, frameGroups, phraseDocs, dictDocs, layerDocs, topicDocs, frameDocs } from '../../src/features/lookup/sources.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const json = p => JSON.parse(readFileSync(path.join(ROOT, 'content', p), 'utf8'));

test('fold: lower case, umlauts and accents dropped, ß → ss, map back to the original', () => {
  assert.equal(foldText('Übung'), 'ubung');
  assert.equal(foldText('Straße'), 'strasse');
  assert.equal(foldText('Café'), 'cafe');
  const { f, map } = fold('Fußball');
  assert.equal(f, 'fussball');
  assert.deepEqual(map.slice(0, 5), [0, 1, 2, 2, 3]);
  assert.equal(foldText(null), '');
});

test('terms: words of the query, with the ue/ae/oe spelling as an alternative', () => {
  assert.deepEqual(terms('  Gute  Idee '), [['gute'], ['idee']]);
  assert.deepEqual(terms('Uebung'), [['uebung', 'ubung']]);
  assert.deepEqual(terms('„dass“,'), [['dass']]);
  assert.deepEqual(terms(''), []);
});

const docs = buildIndex([
  { id: 'a', tab: 'words', title: 'die Übung', sub: 'exercise', rank: 5 },
  { id: 'b', tab: 'words', title: 'üben', sub: 'to practise', rank: 2 },
  { id: 'c', tab: 'phrases', title: 'Ich übe jeden Tag.', sub: 'I practise every day', rank: 1 },
  { id: 'd', tab: 'phrases', title: 'Zum Beispiel', sub: 'for example', extra: 'Zum Beispiel übe ich abends.', rank: 0 },
  { id: 'e', tab: 'grammar', title: 'Verb at the end: dass, weil', sub: 'After dass the verb goes to the end', rank: 1 },
  { id: 'f', tab: 'words', title: 'die Straße', sub: 'street', rank: 9 },
]);

test('search: every query word must match; folded and ue-spelled queries find umlauts', () => {
  assert.deepEqual(search(docs, 'ubung').map(d => d.id), ['a']);
  assert.deepEqual(search(docs, 'uebung').map(d => d.id), ['a']);
  assert.deepEqual(search(docs, 'Übung').map(d => d.id), ['a']);
  assert.deepEqual(search(docs, 'strasse').map(d => d.id), ['f']);
  assert.deepEqual(search(docs, 'übe tag').map(d => d.id), ['c']);
  assert.deepEqual(search(docs, 'nothing here'), []);
  assert.deepEqual(search(docs, '   '), []);
});

test('search: ranking is exact, starts with, word start, contains, other fields; then rank', () => {
  assert.deepEqual(search(docs, 'üben').map(d => d.id), ['b']);
  // "ub": üben starts with it, die Übung starts with it after the article, "Ich übe" has it at a word start, "Zum Beispiel" only in extra
  assert.deepEqual(search(docs, 'üb').map(d => d.id), ['b', 'a', 'c', 'd']);
  // English matches come after German title matches
  const r = search(docs, 'practise').map(d => d.id);
  assert.deepEqual(r, ['c', 'b']);
  assert.deepEqual(search(docs, 'dass', { tab: 'grammar' }).map(d => d.id), ['e']);
  assert.equal(search(docs, 'e', { limit: 2 }).length, 2);
});

test('matchRanges: positions in the text as written, merged, for every query word', () => {
  assert.deepEqual(matchRanges('Die Übung', 'ubung'), [[4, 9]]);
  assert.deepEqual(matchRanges('Die Übung', 'uebung'), [[4, 9]]);
  assert.deepEqual(matchRanges('Fußball', 'ssb'), [[2, 4]]);
  assert.deepEqual(matchRanges('weil, dass, weil', 'weil'), [[0, 4], [12, 16]]);
  assert.deepEqual(matchRanges('Gute Idee', 'gute idee'), [[0, 4], [5, 9]]);
  assert.deepEqual(matchRanges('abc', 'ab bc'), [[0, 3]]);
  assert.deepEqual(matchRanges('abc', ''), []);
});

test('countByTab', () => {
  assert.deepEqual(countByTab([{ tab: 'words' }, { tab: 'words' }, { tab: 'frames' }]), { words: 2, frames: 1 });
});

test('the real German content indexes once and searches in a few milliseconds', () => {
  const t0 = performance.now();
  const plan = json('b1/plan.json');
  const all = buildIndex([
    ...dictDocs(dictRows(json('igloo/words/de.json'))),
    ...phraseDocs(phraseRows(json('igloo/chunks/en.json'), json('igloo/chunks/german.json'), json('igloo/chunks/priority_de.json'))),
    ...layerDocs(layerRows(json('igloo/framework.json'), json('igloo/lang/german.json'))),
    ...topicDocs(topicRows(plan, json('b1/grammar.json'))),
    ...frameDocs(frameGroups(json('b1/frames.json'), plan)),
  ]);
  const built = performance.now() - t0;
  assert.ok(all.length > 5500, `docs: ${all.length}`);
  const counts = countByTab(all);
  assert.ok(counts.words >= 4000 && counts.phrases >= 1400 && counts.grammar > 100 && counts.frames > 100, JSON.stringify(counts));
  const qs = ['ich', 'weil', 'uebernachtung', 'gute idee', 'termin', 'zeit', 'dass', 'meinung', 'xyzzy', 'ich finde'];
  const t1 = performance.now();
  for (let i = 0; i < 5; i++) for (const q of qs) search(all, q);
  const per = (performance.now() - t1) / (qs.length * 5);
  assert.ok(per < 25, `search took ${per.toFixed(1)} ms per query`);
  assert.ok(built < 3000, `index took ${built.toFixed(0)} ms`);
  // sensible top hits
  assert.equal(search(all, 'zeit', { tab: 'words' })[0].title, 'die Zeit');
  assert.ok(search(all, 'weil', { tab: 'grammar' }).length > 0);
});
