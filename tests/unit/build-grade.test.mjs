// Word building: the typed cards' grader (domain/wordbuild-grade.js). Strict: the exact form is the point.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gradeTyped, typedRating, pvAccept, lexiconOf } from '../../src/domain/wordbuild-grade.js';
import { readBuild } from '../../tools/family-files.mjs';

const C = readBuild();
const lexicon = lexiconOf(C);
const ok = (input, accept, o = {}) => gradeTyped(input, { accept, lexicon, ...o });

test('PV: the infinitive, exactly', () => {
  assert.ok(ok('aufstellen', ['aufstellen']).ok);
  assert.ok(ok('Aufstellen', ['aufstellen']).ok);
  for (const wrong of ['ausstellen', 'aufstelen', 'auf stellen', 'stellen', 'aufgestellt', 'aufstellt']) assert.equal(ok(wrong, ['aufstellen']).ok, false, wrong);
  assert.deepEqual(pvAccept({ inf: 'sich verhalten' }), ['sich verhalten', 'verhalten']);
  assert.ok(ok('verhalten', pvAccept({ inf: 'sich verhalten' })).ok);
});

test('a dropped umlaut is a slip (Hard); the umlaut word of another word is wrong', () => {
  const g = ok('ubersetzen', ['übersetzen']);
  assert.ok(g.ok && g.slip);
  assert.equal(typedRating(g), 2);
  assert.ok(ok('uebersetzen', ['übersetzen']).ok && !ok('uebersetzen', ['übersetzen']).slip);
});

test('PS: the pieces in order; ge- and zu in the right place', () => {
  assert.ok(ok('habe angerufen', ['habe angerufen']).ok);
  assert.ok(ok('habe angerufen.', ['habe angerufen']).ok);
  for (const wrong of ['angerufen habe', 'habe an gerufen', 'habe geanrufen', 'habe angeruft', 'bin angerufen', 'habeangerufen', 'habe', 'habe angerufen dich'])
    assert.equal(ok(wrong, ['habe angerufen']).ok, false, wrong);
  assert.ok(ok('zu bestellen', ['zu bestellen']).ok);
  for (const wrong of ['zubestellen', 'bezustellen', 'bestellen']) assert.equal(ok(wrong, ['zu bestellen']).ok, false, wrong);
  assert.ok(ok('aufzustehen', ['aufzustehen']).ok);
  for (const wrong of ['zu aufstehen', 'auf zu stehen', 'aufstehen']) assert.equal(ok(wrong, ['aufzustehen']).ok, false, wrong);
  assert.ok(ok('habe bestellt', ['habe bestellt']).ok);
  assert.equal(ok('habe gebestellt', ['habe bestellt']).ok, false);
  assert.equal(ok('habe vorgebereitet', ['habe vorbereitet']).ok, false);
});

test('PW: the article counts; a lower-case noun is a slip', () => {
  assert.ok(ok('die Vorstellung', ['die Vorstellung'], { noun: true }).ok);
  const a = ok('der Vorstellung', ['die Vorstellung'], { noun: true });
  assert.ok(!a.ok && a.articleMiss);
  assert.equal(ok('Vorstellung', ['die Vorstellung'], { noun: true }).ok, false);
  const low = ok('die vorstellung', ['die Vorstellung'], { noun: true });
  assert.ok(low.ok && low.slip);
  assert.equal(ok('die Vorstelung', ['die Vorstellung'], { noun: true }).ok, false);
  assert.ok(ok('vorstellbar', ['vorstellbar']).ok);
  assert.equal(ok('vorstellbär', ['vorstellbar']).ok, false);
});

test('shown or wrong is Again, right is Good', () => {
  assert.equal(typedRating(ok('aufstellen', ['aufstellen'])), 3);
  assert.equal(typedRating(ok('aufstellen', ['aufstellen']), true), 1);
  assert.equal(typedRating(ok('x', ['aufstellen'])), 1);
});
