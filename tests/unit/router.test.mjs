// Router: hash parsing, route matching and the legacy link map. Plus a source check that nothing in src turns
// strings into markup.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHash, matchRoute, mapLegacy } from '../../src/core/router.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('parseHash', () => {
  assert.deepEqual(parseHash('').path, '/');
  assert.deepEqual(parseHash('#/').path, '/');
  assert.equal(parseHash('#/exam/3/lesen/').path, '/exam/3/lesen');
  const p = parseHash('#/practice/round?kind=area:words');
  assert.equal(p.path, '/practice/round'); assert.equal(p.query.get('kind'), 'area:words');
});

test('matchRoute: params and rest', () => {
  const routes = [{ path: '/today' }, { path: '/exam/:test/:module' }, { path: '/exam/:test' }, { path: '/practice/*' }, { path: '/profile/*' }];
  assert.equal(matchRoute(routes, '/today').route.path, '/today');
  assert.deepEqual(matchRoute(routes, '/exam/3/lesen').params, { test: '3', module: 'lesen' });
  assert.deepEqual(matchRoute(routes, '/exam/3').params, { test: '3' });
  assert.deepEqual(matchRoute(routes, '/practice/round').params, { rest: 'round' });
  assert.deepEqual(matchRoute(routes, '/practice').params, {});
  assert.deepEqual(matchRoute(routes, '/profile/data').params, { rest: 'data' });
  assert.equal(matchRoute(routes, '/nope'), null);
});

test('legacy links: Igloo', () => {
  const cases = {
    '#b1': '#/practice', '#b1/round': '#/practice/round', '#b1/missed': '#/practice/round?kind=missed',
    '#b1/words': '#/practice/round?kind=area:words', '#b1/words/round': '#/practice/round?kind=area:words',
    '#b1/sprechen': '#/practice/round?kind=area:speaking', '#b1/lesen': '#/practice/round?kind=area:reading',
    '#b1/grammar': '#/practice/round?kind=area:grammar', '#b1/grammar/v2': '#/practice/round?kind=topic:v2',
    '#b1/aloud': '#/practice/speak/aloud', '#b1/teil2': '#/practice/speak/teil2', '#b1/frames': '#/lookup/frames',
    '#b1/situations/round': '#/practice/round?kind=area:speaking',
    '#drill': '#/practice', '#drill/start': '#/practice', '#test/placement': '#/practice',
    '#write/SC-03': '#/practice/write/SC-03', '#write': '#/practice/write',
    '#lookup/phrases': '#/lookup/phrases', '#lookup/linking': '#/lookup/grammar?g=linking', '#lookup/notes': '#/lookup/grammar?g=notes', '#lookup/frames': '#/lookup/frames?f=verbs', '#lookup': '#/lookup',
    '#how': '#/today', '#chunks/german': '#/lookup',
  };
  for (const [from, to] of Object.entries(cases)) assert.equal(mapLegacy(from), to, from);
});

test('legacy links: B1 exam app', () => {
  const cases = {
    '#/tag/3': '#/exam/3', '#/tag/3/lesen': '#/exam/3/lesen', '#/tag/12/schreiben?review=1790000300000': '#/exam/12/schreiben/review/1790000300000',
    '#/woerter': '#/lookup/words', '#/woerter/ueben': '#/lookup/words', '#/woerter?tag=2': '#/lookup/words?test=2', '#/training/1-aufgabe1': '#/practice/write',
    '#/fortschritt': '#/exam', '#/einstellungen': '#/profile', '#/export': '#/profile/data',
    '#/settings': '#/profile', '#/library/words': '#/lookup/words', '#/exams/3': '#/exam/3',
  };
  for (const [from, to] of Object.entries(cases)) assert.equal(mapLegacy(from), to, from);
});

test('current routes are not treated as legacy', () => {
  for (const h of ['#/today', '#/practice', '#/exam/3/lesen', '#/lookup/words', '#/profile/data', '#/welcome', '#/', '']) assert.equal(mapLegacy(h), null, h);
});

test('no markup sinks in src (outside the vendored shaders)', () => {
  const walk = d => readdirSync(d).flatMap(n => { const p = path.join(d, n); return statSync(p).isDirectory() ? (n === 'vendor' ? [] : walk(p)) : [p]; });
  const bad = [];
  for (const f of walk(path.join(ROOT, 'src')).filter(f => f.endsWith('.js'))) {
    readFileSync(f, 'utf8').split('\n').forEach((l, i) => {
      if (/\.(innerHTML|outerHTML)\s*=|insertAdjacentHTML|document\.write\(|new Function\(|\beval\(/.test(l)) bad.push(`${path.relative(ROOT, f)}:${i + 1}`);
    });
  }
  assert.deepEqual(bad, []);
});
