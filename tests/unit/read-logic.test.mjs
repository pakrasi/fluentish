// Reading's pure parts (src/features/practice-read/logic.js, features/shared/read-data.js): paste cleaning, phrase
// bands and separable verbs on the real word list, one card per item, triage, the questions check, the round's gap,
// and the level estimator's calibration against graded texts (PLAN-REVIEW gate: within one level). Synthetic texts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import de from '../../src/lang/de/index.js';
import { tokenize } from '../../src/domain/text/tokens.js';
import { resolver } from '../../src/domain/knowledge.js';
import { deckName } from '../../src/domain/decks.js';
import { levelRank } from '../../src/domain/text/estimate.js';
import * as L from '../../src/features/practice-read/logic.js';
import * as R from '../../src/features/shared/read-data.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const json = (/** @type {string} */ p) => JSON.parse(readFileSync(path.join(ROOT, p), 'utf8'));
const WORDS = json('content/igloo/words/de.json');
const idx = /** @type {any} */ (de.grammar.morphology).index(WORDS);
const DAY = '2026-10-20';

test('paste: subtitles and a YouTube transcript lose their numbers and times; plain text is kept', () => {
  const srt = '1\n00:00:01,000 --> 00:00:03,500\nGuten Abend und\nwillkommen.\n\n2\n00:00:03,600 --> 00:00:06,000\n<i>Heute geht es um Arbeit.</i>\n';
  assert.deepEqual(L.cleanPaste(srt), { text: 'Guten Abend und willkommen. Heute geht es um Arbeit.', format: 'srt' });
  const vtt = 'WEBVTT\n\n00:01.000 --> 00:03.000\nDas ist ein Satz.\n\n00:03.000 --> 00:05.000\nDas ist ein Satz.\n\n00:05.000 --> 00:07.000\nUnd noch einer.';
  assert.deepEqual(L.cleanPaste(vtt), { text: 'Das ist ein Satz. Und noch einer.', format: 'vtt' }, 'a rolling caption is not repeated');
  const yt = '0:00\nhallo zusammen\n0:03\nheute sprechen wir\n0:06\nüber das Wetter\n1:02:03\nTschüss';
  assert.equal(L.cleanPaste(yt).format, 'yt');
  assert.equal(L.cleanPaste(yt).text, 'hallo zusammen heute sprechen wir über das Wetter Tschüss');
  assert.deepEqual(L.cleanPaste('Ein Satz. Noch einer.'), { text: 'Ein Satz. Noch einer.', format: 'de' });
  const r = L.makeRead({ raw: '# Teil eins\n\nErster Satz. Zweiter Satz.\n\nDritter Satz.', title: '', note: ' Radio ', id: 'r', lang: 'de', now: 'n', untitled: 'Untitled' });
  assert.equal(L.sentencesOf(r).length, 3);
  assert.equal(r.source.label, 'Radio');
  assert.ok(r.title && r.title !== 'Untitled', 'a text without a title is named from its start');
  assert.equal(L.wordsIn(r), 6);
});

test('phrase bands: the word list\'s multi-word items, found across a sentence by their lemmas', () => {
  const phrases = L.phraseIndex(WORDS, de, idx);
  const bands = (/** @type {string} */ s) => {
    const toks = tokenize(s);
    return L.phrasesIn(toks.map((t, i) => (t.w && !t.num ? L.lemmasAt(de, idx, toks, i).map(x => x.toLowerCase()) : [])), phrases).map(h => [h.phrase.w, h.at.map(k => toks[k].t).join(' ')]);
  };
  assert.deepEqual(bands('Das Geld spielt dabei eine wichtige Rolle.'), [['eine Rolle spielen', 'spielt Rolle']]);
  assert.deepEqual(bands('Sie ziehen auch andere Modelle in Betracht.'), [['in Betracht ziehen', 'ziehen in Betracht']]);
  assert.deepEqual(bands('Das Wetter ist heute schön.'), []);
  assert.ok(phrases.every(p => p.keys.length >= 2), 'a phrase has two keys at least');
});

test('a separable verb: both halves belong to one word, and the joined verb is its lemma', () => {
  const toks = tokenize('Er fängt morgen mit der Arbeit an.');
  const i = toks.findIndex(t => t.t === 'fängt');
  const p = L.partners(de, idx, toks, i);
  assert.equal(p.lemma, 'anfangen');
  assert.deepEqual(p.at.map(k => toks[k].t), ['fängt', 'an']);
  const plain = tokenize('Er arbeitet morgen.');
  assert.deepEqual(L.partners(de, idx, plain, 1).at, [1], 'a verb that is not split stays one token');
});

test('one card per item: a word with a card in another deck keeps it; saving only adds the sentence', () => {
  const resolve = resolver({ words: WORDS });
  const decks = {
    b1: { 'W:Branche.n': { reps: 2 }, 'BW:dagegenhalten': { reps: 1 } },
    clusters: { 'CF:Ergebnis.n': { reps: 1 } },
    script: { 'SW:pilotprojekt': { reps: 3 } },
    build: {},
  };
  const home = (/** @type {string} */ cardId, /** @type {string} */ lemma) => L.homeOf(cardId, lemma, decks, resolve, deckName);
  assert.equal(home('W:Branche.n', 'Branche'), 'b1', 'the same W: card in b1');
  assert.equal(home('W:Ergebnis.n', 'Ergebnis'), 'clusters', 'a cluster family card for the word');
  assert.equal(home('RW:dagegenhalten', 'dagegenhalten'), 'b1', 'an exam word saved as BW:<slug> before');
  assert.equal(home('RW:pilotprojekt', 'Pilotprojekt'), 'script', 'a script word of the same lemma');
  assert.equal(home('W:Rolle.n', 'Rolle'), null, 'no card anywhere: the reading deck');
  assert.equal(home('W:Branche.n', 'Branche') && decks.b1['W:Branche.n'].reps, 2);
  // a never-reviewed card elsewhere is not a home
  assert.equal(L.homeOf('W:Rolle.n', 'Rolle', { b1: { 'W:Rolle.n': { reps: 0 } } }, resolve, deckName), null);
});

test('saving: one entry per item (n counts), at most three sentences, cut to 240 characters; no card is made', () => {
  /** @type {Record<string, any>} */ const kv = {};
  /** @type {Record<string, any>} */ const cards = {};
  const store = { get: (/** @type {string} */ n, /** @type {any} */ d) => (n in kv ? kv[n] : d), set: (/** @type {string} */ n, /** @type {any} */ v) => { kv[n] = v; },
    update: (/** @type {string} */ n, /** @type {(v: any) => any} */ fn, /** @type {any} */ d) => { kv[n] = fn(n in kv ? kv[n] : d); return kv[n]; }, cards: (/** @type {string} */ d) => cards[d] || (cards[d] = {}) };
  const entry = { lemma: 'Branche', head: 'die Branche', gloss: 'sector', from: /** @type {const} */ ('list'), level: 'B2', zipf: 4.1, kind: /** @type {const} */ ('word'), home: 'de:read', ref: false };
  for (let i = 0; i < 5; i++) R.saveWord(store, { cardId: 'W:Branche.n', entry, today: DAY, ctx: { readId: 'r1', sentenceId: `s${i}`, de: `${'x'.repeat(300)} ${i}`, surface: 'Branche' } });
  R.saveWord(store, { cardId: 'W:Branche.n', entry, today: DAY, ctx: { readId: 'r1', sentenceId: 's4', de: 'again', surface: 'Branche' } });
  assert.equal(Object.keys(R.savedWords(store)).length, 1);
  assert.equal(R.savedWords(store)['W:Branche.n'].n, 6);
  const ctx = R.contextOf(store, 'W:Branche.n');
  assert.equal(ctx.length, 3);
  assert.deepEqual(ctx.map(x => x.sentenceId), ['s4', 's3', 's2'], 'newest first; the same sentence is kept once');
  assert.ok(ctx.every(x => x.de.length <= R.CTX_CHARS));
  assert.deepEqual(cards, {}, 'saving makes no card: the round makes it on the first review');
  // the round's lists: only items whose card lives in the reading deck, with a meaning, not reference
  R.saveWord(store, { cardId: 'W:Ergebnis.n', entry: { ...entry, lemma: 'Ergebnis', home: 'clusters' }, today: DAY, ctx: null });
  R.saveWord(store, { cardId: 'RW:quaxel', entry: { ...entry, lemma: 'quaxel', gloss: null }, today: DAY, ctx: null });
  R.saveWord(store, { cardId: 'W:Rarität.n', entry: { ...entry, lemma: 'Rarität', ref: true }, today: DAY, ctx: null });
  const b = R.readBuckets(store, { today: DAY }, 'de:read', 6);
  assert.deepEqual(b, { due: [], fresh: ['W:Branche.n'], rest: [], newLeft: 6, daily: true });
});

test('new reading items a day: the allowance\'s share once it has one, else practice.readNew; none when new items stop', () => {
  const c = { newItems: true };
  assert.equal(R.readNewLeft(/** @type {any} */ ({ decks: { read: { want: 0, newLeft: 0, paused: false } } }), {}, c, 2), 4, 'C0: want.read is 0, his own 6 a day');
  assert.equal(R.readNewLeft(/** @type {any} */ ({ decks: { read: { want: 0, newLeft: 0, paused: false } } }), { practice: { readNew: 3 } }, c, 1), 2);
  assert.equal(R.readNewLeft(/** @type {any} */ ({ decks: { read: { want: 5, newLeft: 3, paused: false } } }), {}, c, 2), 3, 'the allowance decides once it has a share');
  assert.equal(R.readNewLeft(/** @type {any} */ ({ decks: { read: { want: 5, newLeft: 3, paused: true } } }), {}, c, 0), 0, 'paused in an exam\'s last week');
  assert.equal(R.readNewLeft(null, {}, { newItems: false }, 0), 0, 'the eve and the day of an exam');
});

test('triage: rare words above his level are kept for reference; common ones, phrases and unknown ones are reviewed', () => {
  assert.equal(L.triage({ zipf: 2.1, level: 'C2', kind: 'word' }, 'B1'), 'ref');
  assert.equal(L.triage({ zipf: 2.1, level: 'B2', kind: 'word' }, 'B1'), 'review', 'one level up is his next level');
  assert.equal(L.triage({ zipf: 3.4, level: 'C1', kind: 'word' }, 'B1'), 'review', 'common enough');
  assert.equal(L.triage({ zipf: null, level: null, kind: 'word' }, 'B1'), 'review', 'off the list');
  assert.equal(L.triage({ zipf: 1, level: 'C2', kind: 'phrase' }, 'B1'), 'review');
  assert.equal(L.itemFor({ kind: 'word', lemma: 'Quaxelei', entry: null }), 'RW:quaxelei');
  assert.equal(L.itemFor({ kind: 'phrase', lemma: 'auf dem Schirm haben', entry: null }), 'RP:auf-dem-schirm-haben');
  assert.equal(L.itemFor({ kind: 'phrase', lemma: 'x', entry: /** @type {any} */ ({ id: 'eine_Rolle_spielen.phrase' }) }), 'W:eine_Rolle_spielen.phrase');
});

test('questions: only items with an answer in range, distinct options and evidence quoted from the text', () => {
  const text = 'Seit einigen Jahren wird über die Vier-Tage-Woche diskutiert. Befürworter sagen, dass ausgeruhte Menschen besser arbeiten.';
  const good = { type: 'mc', skill: 'global', q: 'Worüber wird diskutiert?', options: ['Über die Vier-Tage-Woche', 'Über das Wetter', 'Über Urlaub'], answer: 0, evidence: 'wird über die Vier-Tage-Woche diskutiert' };
  const reply = JSON.stringify({ questions: [
    good,
    { ...good, q: 'Was sagen Befürworter?', evidence: 'dass ausgeruhte  Menschen besser arbeiten' },   // spacing differs: still verbatim
    { ...good, answer: 3 },
    { ...good, options: ['a', 'A', 'b'] },
    { ...good, evidence: 'steht nicht im Text so drin' },
    { ...good, type: 'tf', options: ['richtig', 'falsch'], answer: 1, q: 'Niemand diskutiert.', evidence: 'Seit einigen Jahren wird über' },
    { ...good, q: '<b>x</b>' },
  ] });
  const qs = L.checkQuestions(reply, text);
  assert.deepEqual(qs.map(q => q.q), ['Worüber wird diskutiert?', 'Was sagen Befürworter?', 'Niemand diskutiert.']);
  assert.deepEqual(qs.map(q => q.id), ['q1', 'q2', 'q3']);
  assert.deepEqual(L.checkQuestions('not json', text), []);
  assert.deepEqual(L.checkQuestions(reply, text, () => false), [], 'a question in the wrong language is dropped');
  const sents = [{ id: 'a', de: 'Seit einigen Jahren wird über die Vier-Tage-Woche diskutiert.' }, { id: 'b', de: 'Befürworter sagen das.' }];
  assert.equal(L.sentenceOfQuote(sents, 'über die Vier-Tage-Woche')?.id, 'a');
});

test('the round: his sentence with the word gapped, every other review from the second the meaning alone', () => {
  const ctx = { de: 'Die Branche schaut genau hin.', surface: 'Branche' };
  assert.deepEqual(L.gapIn(ctx, 0), { gapped: 'Die ___ schaut genau hin.', at: 4, len: 7 });
  assert.ok(L.gapIn(ctx, 1));
  assert.equal(L.gapIn(ctx, 2), null);
  assert.ok(L.gapIn(ctx, 3));
  assert.equal(L.gapIn({ de: 'Er fängt morgen an.', surface: 'fängt … an' }, 0), null, 'a separable verb: by its meaning');
  assert.equal(L.gapIn({ de: 'Die Branchen wachsen.', surface: 'Branche' }, 0), null, 'not a word of the sentence');
  assert.equal(L.gapIn(null, 0), null);
});

test('estimator calibration: the graded texts\' levels, within one level', () => {
  const texts = [...json('tests/fixtures/readers-synthetic.json').texts, ...json('tests/fixtures/read-calibration.json').texts];
  assert.ok(texts.length >= 4);
  /** @type {string[]} */ const rows = [];
  for (const x of texts) {
    const an = L.analyse(L.sentencesOf({ sections: L.gradedSections(x) }), { pack: de, idx, suggest: false });
    const got = L.textLevel(an, de, idx);
    rows.push(`${x.id} ${x.level} → ${got}`);
    assert.ok(Math.abs(levelRank(got) - levelRank(x.level)) <= 1, rows.join('\n'));
  }
  // and in order: a harder text never estimates easier than an easier one by more than a level
  const lv = texts.map(x => levelRank(L.textLevel(L.analyse(L.sentencesOf({ sections: L.gradedSections(x) }), { pack: de, idx, suggest: false }), de, idx)));
  const b2 = texts.findIndex(x => x.level === 'B2'), a2 = texts.findIndex(x => x.level === 'A2');
  assert.ok(lv[b2] > lv[a2], rows.join('\n'));
});

test('estimate: his coverage puts a text in a band; the estimator has a version', () => {
  const x = json('tests/fixtures/read-calibration.json').texts.find((/** @type {any} */ t) => t.level === 'B2');
  const an = L.analyse(L.sentencesOf({ sections: L.gradedSections(x) }), { pack: de, idx, suggest: false });
  const none = L.estimate(an, { pack: de, idx, view: { get: () => ({ state: 'unseen' }) }, level: 'B1' });
  const all = L.estimate(an, { pack: de, idx, view: { get: () => ({ state: 'known' }) }, level: 'B1' });
  assert.equal(none.ver, L.ESTIMATE_VER);
  assert.ok(all.coverage > none.coverage);
  assert.equal(all.level, none.level, 'the level is the text\'s, his knowledge is the coverage');
  assert.equal(L.oneIn(0.909), 11);
  assert.equal(L.oneIn(1), 0);
});

test('prompt templates fill with the language and the text only', async () => {
  const { TEMPLATES } = await import('../../src/services/prompts/read.js');
  const { fill } = await import('../../src/services/prompts/index.js');
  const q = fill(TEMPLATES['read-questions@1'], { n: 5, language: 'German', true: 'richtig', false: 'falsch', text: 'Ein Text.' });
  assert.match(q, /5 comprehension questions in German/);
  assert.match(q, /\["richtig", "falsch"\]/);
  assert.ok(q.endsWith('Ein Text.'));
  assert.throws(() => fill(TEMPLATES['read-translate@1'], { language: 'German' }), /sentence/);
});
