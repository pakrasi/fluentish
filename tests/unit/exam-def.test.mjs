// Exams as data (round 3, C2b): the Goethe B1 definition (content/exams/goethe-b1/exam.json, exam-def@1), its
// exam-locale catalog, the manifest summary built from it, the result-file adapters, and a synthetic second exam
// (tests/fixtures/exam-synthetic) graded by the same engine with no code of its own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate } from '../../src/core/schema.js';
import { answerKey, grade, teilIds, itemInfo, passes } from '../../src/domain/grade.js';
import { objectiveItems, valuesOf, testPath, section } from '../../src/domain/examdef.js';
import { adapterFor, ADAPTERS } from '../../src/domain/exam-results.js';
import { createTx } from '../../src/features/exam/locale.js';
import { examEntries } from '../../tools/build-manifest.mjs';
import en from '../../src/i18n/en.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const json = (/** @type {string} */ p) => JSON.parse(readFileSync(path.join(ROOT, p), 'utf8'));
const DEF = json('content/exams/goethe-b1/exam.json');
const LOCALE = json('content/exams/goethe-b1/locale.de.json');
const SCHEMA = json('schemas/content/exam-def.schema.json');
const LOCALE_SCHEMA = json('schemas/content/exam-locale.schema.json');

test('the Goethe B1 definition and its locale validate', () => {
  assert.deepEqual(validate(SCHEMA, DEF), []);
  assert.deepEqual(validate(LOCALE_SCHEMA, LOCALE), []);
  assert.equal(LOCALE.lang, DEF.locale);
  assert.equal(LOCALE.exam, DEF.id);
});

test('the manifest summary built from the definition is the one the app read before (plus def, locale and plan minutes)', () => {
  const [e] = examEntries();
  assert.deepEqual(e, {
    id: 'goethe-b1', name: 'Goethe-Zertifikat B1', short: 'Goethe B1', language: 'german', level: 'B1',
    modules: [
      { id: 'lesen', name: 'Lesen', minutes: 65, max: 30, pass: 18 },
      { id: 'hoeren', name: 'Hören', minutes: 40, max: 30, pass: 18 },
      { id: 'schreiben', name: 'Schreiben', minutes: 60, max: 100, pass: 60 },
      { id: 'sprechen', name: 'Sprechen', minutes: 15, max: 100, pass: 60, prepMinutes: 15, planMinutes: 30 },
    ],
    media: 'https://pakrasi.github.io/b1-exam/audio/',
    note: 'Practice in the format of the Goethe-Zertifikat B1. Not affiliated with the Goethe-Institut.',
    def: 'exam.goethe-b1.def', locale: 'exam.goethe-b1.locale.de',
  });
});

test('Goethe B1 timings, play limits, reading times and replays come from the definition', () => {
  const L = section(DEF, 'lesen'), H = section(DEF, 'hoeren');
  assert.deepEqual(L.parts.map((/** @type {any} */ p) => p.minutes), [10, 20, 10, 15, 10]);
  assert.equal(L.parts.reduce((/** @type {number} */ s, /** @type {any} */ p) => s + p.minutes, 0), L.minutes);
  assert.deepEqual(H.parts.map((/** @type {any} */ p) => [p.audio.plays, p.audio.readSeconds ?? 0, p.audio.replayAfter ?? 0]), [[2, 0, 5], [1, 60, 0], [1, 30, 0], [2, 0, 5]]);
  assert.equal(H.clock, 'up');
  assert.deepEqual(DEF.sections.map((/** @type {any} */ s) => s.id), ['lesen', 'hoeren', 'schreiben', 'sprechen']);
  assert.equal(testPath(DEF.media.test, 3), 'day03/');
  // play-count keys stored in drafts ('plays:N' → {h1-1 … h4}) never change
  const ids = H.parts.flatMap((/** @type {any} */ p) => (p.groups ? [1, 2, 3, 4, 5].map(i => p.audio.id.replace('{i}', String(i))) : [p.audio.id]));
  assert.deepEqual(ids, ['h1-1', 'h1-2', 'h1-3', 'h1-4', 'h1-5', 'h2', 'h3', 'h4']);
});

test('every runner string the definition and the exam screens name is in the locale, and none is left in en.js', () => {
  const keys = new Set(Object.keys(LOCALE.strings));
  /** @type {string[]} */ const named = [];
  for (const s of DEF.sections) {
    for (const k of ['rules', 'intro']) if (s[k]) named.push(s[k]);
    for (const p of s.parts) {
      for (const k of ['instruction', 'summary', 'hint', 'recordHint', 'reviewLabel', 'groupLabel']) if (p[k]) named.push(p[k]);
      if (p.choices?.heading) named.push(p.choices.heading);
    }
  }
  for (const t of Object.values(DEF.itemTypes)) if (Array.isArray(/** @type {any} */ (t).labels)) named.push(.../** @type {any} */ (t).labels);
  const dir = path.join(ROOT, 'src/features/exam');
  for (const f of readdirSync(dir).filter(f => f.endsWith('.js'))) {
    const src = readFileSync(path.join(dir, f), 'utf8');
    // tx('key' …), and t('key' …) inside player.js and option(), which are handed the exam's strings as t
    for (const m of src.matchAll(/\btx\('([\w.-]+)'/g)) named.push(m[1]);
    if (f === 'player.js') for (const m of src.matchAll(/\bt\('([\w.-]+)'/g)) named.push(m[1]);
  }
  for (const m of readFileSync(path.join(dir, 'parts.js'), 'utf8').matchAll(/\bt\('(yourRight|solution|yourWrong)'/g)) named.push(m[1]);
  const missing = [...new Set(named)].filter(k => !keys.has(k));
  assert.deepEqual(missing, [], 'keys named but not in locale.de.json');
  assert.ok(named.length > 100);
  assert.deepEqual(Object.keys(en).filter(k => k.startsWith('exam.de.')), [], 'German runner strings left in src/i18n/en.js');
});

test('createTx: interpolation, plurals in the exam language, a missing key shows itself', () => {
  const tx = createTx(LOCALE);
  assert.equal(tx('submit'), 'Abgeben');
  assert.equal(tx('answered', { n: 3, of: 30 }), '3 von 30 beantwortet');
  assert.equal(tx('playsLeft', { n: 1 }), 'Noch 1 Wiedergabe');
  assert.equal(tx('playsLeft', { n: 2 }), 'Noch 2 Wiedergaben');
  assert.equal(tx('no.such.key'), 'no.such.key');
  assert.equal(tx.has('submit'), true);
  assert.equal(tx.lang, 'de');
});

test('result-file adapters: the definition names one; an unknown id is refused', () => {
  assert.equal(adapterFor(DEF), ADAPTERS['b1-exam-sync@1']);
  assert.throws(() => adapterFor({ id: 'x', results: { adapter: 'nope@1' } }), /no result-file adapter/);
  const ad = adapterFor(DEF);
  assert.equal(ad.attemptName({ day: 7, module: 'lesen' }, '20261003T180405'), 'data/attempts/20261003T180405-day07-lesen.json');
  assert.equal(ad.voiceStem({ day: 12, module: 'sprechen', part: 'teil2' }, '20261003T180405'), 'data/voice/day12/20261003T180405-sprechen-teil2');
  assert.equal(ad.feedbackName({ day: 2, module: 'schreiben' }, '20261003T180405'), 'data/feedback-ai/20261003T180405-day02-schreiben.json');
});

test('a second exam is a definition, not code: the synthetic exam grades through the same engine', () => {
  const def = json('tests/fixtures/exam-synthetic/exam.json');
  const ex = json('tests/fixtures/exam-synthetic/t01.json');
  assert.deepEqual(validate(SCHEMA, def), []);
  const key = answerKey(ex, def);
  assert.deepEqual(key, {
    'co-1': ['c', 'CO1', 'detail'], 'co-2': ['a', 'CO1', 'number-time'], 'co-3': ['d', 'CO1', 'detail'],
    'ce-1': ['v', 'CE1', 'detail'], 'ce-2': ['f', 'CE1', 'negation'], 'ce-3': ['f', 'CE1', 'detail'],
    'ce-4': ['B', 'CE2', 'matching'], 'ce-5': ['x', 'CE2', 'matching'],
  });
  const co = grade(key, 'co', { 'co-1': ' C ', 'co-2': 'b' }, def);
  assert.deepEqual([co.score, co.max_score, co.by_teil], [1, 3, { CO1: { score: 1, max: 3 } }]);
  const ce = grade(key, 'ce', { 'ce-1': 'v', 'ce-2': 'f', 'ce-3': 'v', 'ce-4': 'b', 'ce-5': 'X' }, def);
  assert.deepEqual([ce.score, ce.max_score], [4, 5]);
  assert.deepEqual(ce.results.map(r => r.teil), ['CE1', 'CE1', 'CE1', 'CE2', 'CE2']);
  assert.equal(passes(ce.score, ce.max_score, def.scoring.passShare), true);
  assert.equal(passes(2, 5, def.scoring.passShare), false);
  assert.deepEqual(teilIds(ex, 'ce', def), [['ce-1', 'ce-2', 'ce-3'], ['ce-4', 'ce-5']]);
  assert.deepEqual(Object.values(itemInfo(ex, def)).map(i => i.nr), [1, 2, 3, 1, 2, 3, 4, 5]);
  assert.equal(itemInfo(ex, def)['co-3'].text, 'Qui ?');
  const items = objectiveItems(def, ex, 'ce');
  assert.deepEqual(valuesOf(def, items[0]), ['v', 'f']);
  assert.deepEqual(valuesOf(def, items[3]), ['x', 'A', 'B']);
  assert.deepEqual(valuesOf(def, objectiveItems(def, ex, 'co')[0]), ['a', 'b', 'c', 'd']);
  assert.equal(adapterFor(def).id, 'b1-exam-sync@1');
});
