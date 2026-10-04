// Look up › My words: reading data/vocab.json through a mocked GitHub API (never a real token), merging captures
// made on this device, grouping by lemma and the exam-week triage. Plus the Look up routes and content rows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchVocab, VocabError, mergeVocab, lemmaGroups, byImportance, triage, headword, examples, details, freqBand, sources, wordKey, frequent } from '../../src/features/lookup/words.js';
import { parseRoute, hashFor } from '../../src/features/lookup/route.js';
import { phraseRows, layerRows, topicRows, frameGroups, modelSentence, tenseGrid, roleOf, langFor } from '../../src/features/lookup/sources.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const fixture = JSON.parse(readFileSync(path.join(ROOT, 'tests/fixtures/lookup-words-synthetic.json'), 'utf8'));
const content = p => JSON.parse(readFileSync(path.join(ROOT, 'content', p), 'utf8'));
const FAKE = 'test-token-not-real';

/** A fetch that answers like the GitHub contents API and records what it was asked. */
function mockGitHub(status, body) {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url, init });
    if (status === 'throw') throw new TypeError('Failed to fetch');
    return { ok: status >= 200 && status < 300, status, json: async () => (typeof body === 'string' ? JSON.parse(body) : body) };
  };
  return { f, calls };
}

test('fetchVocab: raw contents request with the token, words returned', async () => {
  const { f, calls } = mockGitHub(200, { generated_at: 'x', words: fixture.words });
  const words = await fetchVocab({ token: FAKE, repo: 'owner/repo', api: 'https://api.github.com', fetch: f });
  assert.equal(words.length, 5);
  assert.equal(calls[0].url, 'https://api.github.com/repos/owner/repo/contents/data/vocab.json');
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${FAKE}`);
  assert.equal(calls[0].init.headers.Accept, 'application/vnd.github.raw+json');
  assert.equal(calls[0].init.cache, 'no-store');
});

test('fetchVocab: 404 is an empty list, 401/403 an auth error, network and 5xx errors keep their code', async () => {
  assert.deepEqual(await fetchVocab({ token: FAKE, repo: 'o/r', api: 'a', fetch: mockGitHub(404, {}).f }), []);
  for (const [status, code] of [[401, 'auth'], [403, 'auth'], [500, 'http'], ['throw', 'net']]) {
    await assert.rejects(fetchVocab({ token: FAKE, repo: 'o/r', api: 'a', fetch: mockGitHub(status, {}).f }), e => e instanceof VocabError && e.code === code, String(status));
  }
  await assert.rejects(fetchVocab({ token: FAKE, repo: 'o/r', api: 'a', fetch: mockGitHub(200, 'not json').f }), e => e.code === 'http');
});

test('mergeVocab: remote first, local captures added once, deletes and deleted rows dropped', () => {
  const local = [{ day: 1, word: 'Nachbarn', synced: true }, { day: 3, word: 'Termin', synced: false }, { day: 3, word: 'absagen' }];
  const events = [{ day: 3, word: 'absagen', action: 'delete' }, { day: 1, word: 'Nachbarn', known: true }];
  const m = mergeVocab(fixture.words, local, events);
  const keys = m.map(w => `${w.day}:${wordKey(w.word)}`).sort();
  assert.deepEqual(keys, ['1:nachbarn', '1:übernachtung', '2:nachbar', '2:zufällig', '3:termin']);
  assert.equal(m.find(w => w.word === 'Termin').local, true);
  assert.equal(m.find(w => w.word === 'Nachbarn').local, undefined);
  assert.deepEqual(mergeVocab(undefined, undefined, undefined), []);
});

test('lemmaGroups: forms of one lemma merge; first non-empty fields win; days collected', () => {
  const gs = lemmaGroups(mergeVocab(fixture.words));
  const n = gs.find(g => g.key === 'nachbar');
  assert.deepEqual(n.forms, ['Nachbarn']);
  assert.deepEqual(n.days, [1, 2]);
  assert.equal(n.gloss, 'neighbour');
  assert.equal(headword(n), 'der Nachbar');
  assert.equal(headword(gs.find(g => g.key === 'zufällig')), 'zufällig');
  assert.deepEqual(byImportance(gs).map(g => g.key), ['nachbar', 'zufällig', 'übernachtung']);
});

test('examples, details, sources, frequency band', () => {
  const n = lemmaGroups(mergeVocab(fixture.words)).find(g => g.key === 'nachbar');
  const ex = examples(n);
  assert.equal(ex[0].exam, true);
  assert.equal(ex[0].form, 'Nachbarn');
  assert.equal(ex[1].de, 'Mein Nachbar hilft mir oft.');
  assert.equal(details(n).usage, 'Common in everyday talk.');
  assert.deepEqual(details({ details: '{broken' }), {});
  assert.deepEqual(sources(n, d => `Test ${d}`), ['Test 1 · Lesen Teil 1', 'Test 2 · Hören Teil 2']);
  assert.deepEqual([5.2, 4.5, 3.6, 2, null].map(freqBand), ['very', 'common', 'mid', 'rare', null]);
});

test('triage: no meaning waits; in an exam week only frequent words go in the queue', () => {
  const gs = lemmaGroups(mergeVocab(fixture.words));
  const by = k => gs.find(g => g.key === k);
  assert.equal(triage(by('zufällig'), 'week'), 'waiting');
  assert.equal(triage(by('nachbar'), 'week'), 'queue');
  assert.equal(triage(by('übernachtung'), 'week'), 'later');
  assert.equal(triage(by('übernachtung'), 'eve'), 'later');
  // outside an exam week: rare, in one test and not on the word list → reference only; on the list → queue
  assert.equal(triage(by('übernachtung'), 'none'), 'reference');
  assert.equal(triage(by('übernachtung'), 'after', { 'Übernachtung': ['uebernachtung.noun', 'B1'] }), 'queue');
  assert.equal(frequent({ zipf: 3, exam_days: 3 }), true);
  assert.equal(frequent({ zipf: 3.9, exam_days: 2 }), false);
});

test('routes: sections, word sheets, query and options round-trip', () => {
  const q = s => new URLSearchParams(s);
  assert.deepEqual(parseRoute('', q('')), { tab: null, id: null, q: '', opts: {} });
  assert.deepEqual(parseRoute('phrases', q('q=gute+Idee&cat=collocation')), { tab: 'phrases', id: null, q: 'gute Idee', opts: { cat: 'collocation' } });
  assert.deepEqual(parseRoute('words/die_Zeit', q('')), { tab: 'words', id: 'die_Zeit', q: '', opts: {} });
  assert.equal(parseRoute('nonsense/x', q('')).tab, null);
  assert.equal(parseRoute('grammar', q('g=linking&lang=german&bogus=1')).opts.g, 'linking');
  assert.equal(parseRoute('grammar', q('bogus=1')).opts.bogus, undefined);
  assert.equal(hashFor({ tab: 'phrases', q: 'gute Idee' }), '#/lookup/phrases?q=gute+Idee');
  assert.equal(hashFor({ tab: 'all', q: 'weil' }), '#/lookup?q=weil');
  assert.equal(hashFor({ tab: 'words', id: 'Übung' }), '#/lookup/words/%C3%9Cbung');
  assert.equal(hashFor({ tab: 'words', opts: { w: 'all', level: '' } }), '#/lookup/words?w=all');
  assert.equal(hashFor({}), '#/lookup');
  assert.equal(langFor('klingon'), 'german');
  assert.equal(langFor('german'), 'german');
});

test('content rows: phrases German-first and exam phrases first, layers with role colours, topics and frames', () => {
  const ph = phraseRows(content('igloo/chunks/en.json'), content('igloo/chunks/german.json'), content('igloo/chunks/priority_de.json'));
  assert.ok(ph.length > 1400);
  assert.equal(ph[0].prio, 1);
  assert.ok(ph.every(r => r.de && r.en));
  const layers = layerRows(content('igloo/framework.json'), content('igloo/lang/german.json'));
  assert.ok(layers.some(r => r.layer === 'glue' && r.role === 'glue'));
  assert.ok(layers.some(r => r.layer === 'door' && r.role === 'door'));
  assert.equal(roleOf('function'), 'fn');
  assert.equal(roleOf('lexicon'), 'plain');
  const plan = content('b1/plan.json');
  const topics = topicRows(plan, content('b1/grammar.json'));
  assert.equal(topics[0].id, 'verb-final');
  assert.ok(topics[0].trap && topics[0].rules.length > 0);
  assert.ok(topics.every(t => t.rules.every(r => r.de && !r.de.includes('___'))));
  const frames = frameGroups(content('b1/frames.json'), plan);
  assert.deepEqual(frames.map(f => f.teil), ['S1', 'S2', 'S3']);
  assert.ok(frames[0].groups[0].en.length > 3);
  assert.equal(modelSentence({ prompt: 'Ich kaufe ___ Tisch. (der)', answer: ['den'] }), 'Ich kaufe den Tisch.');
  assert.equal(modelSentence({ prompt: 'Ich glaube. Er kommt. (dass)', answer: ['Ich glaube, dass er kommt.'] }), 'Ich glaube, dass er kommt.');
  const grid = tenseGrid(content('igloo/turns.json'), 'german');
  assert.equal(grid.length, 3);
  assert.ok(grid[2].cells[0].marks.length > 0);
  assert.equal(tenseGrid(content('igloo/turns.json'), 'klingon'), null);
});
