// One content pipeline (round 3, C3a; Arch #15): language packs in the manifest, generic schema ids with the old ids
// as aliases, per-language precache in the service worker, language-parameterised validators and native review.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALIASES, canonical, packOf, packsOf, reviewErrors, build } from '../../tools/build-manifest.mjs';
import { contentPrecache, stampSw } from '../../tools/stamp.mjs';
import { checksFor } from '../../tools/validate-packs.mjs';
import { createSw } from '../../src/services/sw.js';
import { LANGUAGES } from '../../src/lang/registry.js';
import { validate } from '../../src/core/schema.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const J = (/** @type {string} */ p) => JSON.parse(readFileSync(path.join(ROOT, p), 'utf8'));
const manifest = J('content/manifest.json');

test('packs: every content file is in exactly one pack, named for its language', () => {
  const all = Object.values(manifest.packs).flat();
  assert.equal(all.length, manifest.files.length);
  assert.deepEqual(new Set(all), new Set(manifest.files.map((/** @type {any} */ f) => f.id)));
  assert.deepEqual(Object.keys(manifest.packs)[0], 'shared');
  for (const k of Object.keys(manifest.packs)) assert.ok(k === 'shared' || LANGUAGES.some(l => l.id === k), k);
  assert.deepEqual(manifest.packs.shared, ['igloo.chunks.en', 'igloo.framework', 'igloo.sentences.en', 'igloo.turns', 'igloo.words.themes']);
  // French (C3b): Igloo's files plus the course, its accepted answers and its word list
  assert.deepEqual(manifest.packs.fr, ['course.fr', 'igloo.chunks.accept.french', 'igloo.chunks.french', 'igloo.lang.french', 'igloo.sentences.french', 'igloo.words.fr']);
  for (const id of ['b1.items', 'speak.situations', 'exam.goethe-b1.def', 'exam.goethe-b1.why.03', 'clusters.de', 'igloo.chunks.accept.german', 'igloo.grammar.items.de']) assert.ok(manifest.packs.de.includes(id), id);
  assert.equal(packOf('igloo.chunks.arabic', manifest.exams), 'ar');
  assert.equal(packOf('exam.delf-b1.01', [{ id: 'delf-b1', language: 'french' }]), 'fr');
  assert.throws(() => packOf('mystery.file', []), /no language pack/);
  // a French course's files land in the fr pack by name alone: adding a language is data
  assert.deepEqual(packsOf([{ id: 'phrases.fr' }, { id: 'igloo.framework' }, { id: 'lexicon.fr' }], []), { shared: ['igloo.framework'], fr: ['phrases.fr', 'lexicon.fr'] });
});

test('the German precache is what it was before packs, plus the two small shared files', () => {
  const OLD = /^(b1|exam|speak)\.|^igloo\.(framework|turns|chunks\.en)$|\.(german|de)$/;   // stamp.mjs CORE_CONTENT before C3a
  const old = new Set(manifest.files.filter((/** @type {any} */ f) => OLD.test(f.id)).map((/** @type {any} */ f) => f.id));
  const now = new Set([...manifest.packs.shared, ...manifest.packs.de]);
  assert.deepEqual([...old].filter(id => !now.has(id)), [], 'nothing German is dropped');
  assert.deepEqual([...now].filter(id => !old.has(id)).sort(), ['igloo.sentences.en', 'igloo.words.themes']);
});

test('generic schema ids: the manifest names them, every old id is an alias of a schema that exists', () => {
  const ids = new Set(readdirSync(path.join(ROOT, 'schemas/content')).map(f => J(`schemas/content/${f}`).$id));
  for (const [old, id] of Object.entries(ALIASES)) { assert.ok(ids.has(id), `${old} → ${id}`); assert.ok(!ids.has(old), `${old} is only an alias now`); }
  for (const id of ['lexicon@1', 'phrases@1', 'grammar@1', 'exam-def@1']) assert.ok(ids.has(id), id);
  for (const f of manifest.files) { assert.equal(canonical(f.schema), f.schema, f.id); assert.ok(ids.has(f.schema), `${f.id}: ${f.schema}`); }
  assert.equal(manifest.files.find((/** @type {any} */ f) => f.id === 'igloo.words.de').schema, 'lexicon@1');
  assert.equal(manifest.files.find((/** @type {any} */ f) => f.id === 'b1.items').schema, 'trainer-items@1');
  assert.equal(manifest.files.find((/** @type {any} */ f) => f.id === 'exam.goethe-b1.01').schema, 'goethe-b1-exam@1', 'an exam keeps its own test schema');
  // the manifest is deterministic and its version did not move (file ids and hashes only)
  assert.deepEqual(build(), manifest);
});

test('native review: reviewedBy and reviewedAt are optional, typed by the schemas, and come as a pair', () => {
  const phrases = J('schemas/content/igloo-chunks.schema.json');
  const ok = { lang: 'french', reviewedBy: 'native-fr-1', reviewedAt: '2026-10-20', chunks: { ENG_CHUNK_0001: { t: 'bonjour', reviewedBy: 'native-fr-1', reviewedAt: '2026-10-20' } } };
  assert.deepEqual(validate(phrases, ok), []);
  assert.deepEqual(reviewErrors(ok), []);
  assert.ok(validate(phrases, { ...ok, reviewedAt: '20 Oct' }).length, 'a date is YYYY-MM-DD');
  assert.ok(validate(phrases, { ...ok, reviewedBy: 'Jean Dupont' }).length, 'a handle, never a name');
  assert.deepEqual(reviewErrors({ lang: 'x', chunks: { ENG_CHUNK_0001: { t: 'a', reviewedBy: 'r' } } }), ['/chunks/ENG_CHUNK_0001: reviewedBy and reviewedAt go together']);
  assert.deepEqual(reviewErrors([{ id: 'a', reviewedAt: '2026-10-20' }]), ['/0: reviewedBy and reviewedAt go together']);
  const lexicon = J('schemas/content/igloo-words.schema.json');
  assert.deepEqual(validate(lexicon, [{ id: 'x', w: 'maison', pos: 'noun', en: ['house'], level: 'A1', reviewedBy: 'native-fr-1', reviewedAt: '2026-10-20' }]), []);
});

/** sw.js stamped with two packs, in a sandbox registered at `script`. */
function loadSw(/** @type {string} */ script) {
  const js = stampSw(readFileSync(path.join(ROOT, 'sw.js'), 'utf8'), 'a'.repeat(40), ['./', 'content/manifest.json', 'content/igloo/framework.json?h=1'],
    { de: ['content/b1/items.json?h=2'], fr: ['content/igloo/chunks/french.json?h=3'] });
  /** @type {Record<string, any>} */ const listeners = {};
  const ctx = /** @type {any} */ ({ URL, Headers, setTimeout, Promise, location: new URL(script), addEventListener: (/** @type {string} */ t, /** @type {any} */ f) => { listeners[t] = f; } });
  ctx.self = ctx;
  vm.runInNewContext(js, ctx);
  return { ctx, listeners };
}

test('the service worker precaches the shared files and only the packs its URL names (German without a name)', async () => {
  const base = 'https://pakrasi.github.io/fluentish/sw.js';
  assert.deepEqual([...loadSw(base).ctx.precacheList(base)], ['./', 'content/manifest.json', 'content/igloo/framework.json?h=1', 'content/b1/items.json?h=2']);
  assert.deepEqual([...loadSw(`${base}?packs=fr`).ctx.precacheList(`${base}?packs=fr`)], ['./', 'content/manifest.json', 'content/igloo/framework.json?h=1', 'content/igloo/chunks/french.json?h=3']);
  assert.deepEqual([...loadSw(base).ctx.packsOf(`${base}?packs=fr,de`)], ['fr', 'de']);
  assert.deepEqual([...loadSw(base).ctx.packsOf(`${base}?packs=<bad>`)], ['de'], 'a malformed name is German');
  // install fetches exactly that list
  const { ctx, listeners } = loadSw(`${base}?packs=fr`);
  /** @type {string[]} */ const fetched = [];
  ctx.caches = { open: async () => ({ put: async () => {} }), match: async () => null };
  ctx.fetch = async (/** @type {string} */ href) => { fetched.push(href.replace('https://pakrasi.github.io/fluentish/', '')); return { ok: true }; };
  /** @type {Promise<any> | null} */ let done = null;
  listeners.install({ waitUntil: (/** @type {Promise<any>} */ p) => { done = p; } });
  await done;
  assert.deepEqual(fetched.sort(), ['', 'content/igloo/chunks/french.json?h=3', 'content/igloo/framework.json?h=1', 'content/manifest.json']);
});

test('the stamped site gives every language its pack list (German as before)', () => {
  const { shared, packs } = contentPrecache(manifest);
  assert.equal(shared.length, manifest.packs.shared.length);
  for (const [k, ids] of Object.entries(manifest.packs)) if (k !== 'shared') assert.equal(packs[k].length, /** @type {string[]} */ (ids).length, k);
  assert.ok(packs.de.every(u => !/french|spanish|arabic/.test(u)));
  assert.ok(packs.fr.every(u => /french|\/fr\.json/.test(u)));
});

/** A fake service worker container: one registration of this app, running `script`. */
function env(/** @type {string | null} */ script) {
  const root = 'https://pakrasi.github.io/fluentish/';
  /** @type {string[]} */ const registered = [];
  let updates = 0;
  const reg = { scope: root, active: script ? { scriptURL: root + script } : null, waiting: null, installing: null, update: async () => { updates++; }, addEventListener: () => {} };
  const container = {
    controller: {}, getRegistrations: async () => (script ? [reg] : []), getRegistration: async () => (script ? reg : undefined),
    register: async (/** @type {string} */ url) => { registered.push(url.replace(root, '')); reg.active = { scriptURL: url }; script = url; return reg; },
    addEventListener: () => {},
  };
  const win = { fetch: async () => ({ ok: true, json: async () => ({ sha: 'x', sw: 'on' }) }), location: { href: root, reload: () => {} }, document: { addEventListener: () => {} } };
  return { root, nav: { serviceWorker: container }, win, registered, updates: () => updates };
}
const tick = () => new Promise(r => setTimeout(r, 0));

test('the page registers the active course pack: German keeps plain sw.js, another language its own URL', async () => {
  // his registration, German: never re-registered, only updated
  let e = env('sw.js');
  let sw = createSw({ root: e.root, dev: false, nav: e.nav, win: e.win, pack: () => 'de' });
  sw.start(); await tick(); await tick();
  assert.deepEqual(e.registered, []);
  assert.equal(e.updates(), 1);
  // a first visit, German
  e = env(null);
  sw = createSw({ root: e.root, dev: false, nav: e.nav, win: e.win, pack: () => 'de' });
  sw.start(); await tick(); await tick();
  assert.deepEqual(e.registered, ['sw.js']);
  // switching to a French course installs the French pack; switching back, German again
  let lang = 'de';
  e = env('sw.js');
  sw = createSw({ root: e.root, dev: false, nav: e.nav, win: e.win, pack: () => lang });
  sw.start(); await tick(); await tick();
  lang = 'fr'; sw.repack(); await tick(); await tick();
  assert.deepEqual(e.registered, ['sw.js?packs=fr']);
  sw.repack(); await tick(); await tick();
  assert.deepEqual(e.registered, ['sw.js?packs=fr'], 'already on the French pack: no new install');
  lang = 'de'; sw.repack(); await tick(); await tick();
  assert.deepEqual(e.registered, ['sw.js?packs=fr', 'sw.js']);
});

test('one step validates every pack: the checks per language come from its files and plugins', () => {
  const de = checksFor('de', manifest.packs.de, manifest.exams, manifest.files).map(c => c.slice(1).join(' '));
  for (const c of ['tools/validate.py content/igloo/lang/german.json', 'tools/validate_sentences.py content/igloo/sentences/german.json', 'tools/validate_chunks.py german',
    'tools/validate_accept.py german', 'tools/validate_grammar.py de', 'tools/validate_b1.py --all', 'tools/build_schreiben.py --check']) assert.ok(de.includes(c), c);
  assert.ok(de.some(c => c.startsWith('tools/validate_exam.py content/exams/goethe-b1/day01.json')));
  const fr = checksFor('fr', manifest.packs.fr, manifest.exams, manifest.files).map(c => c.slice(1).join(' '));
  assert.deepEqual(fr, ['tools/validate_accept.py french', 'tools/validate_chunks.py french', 'tools/validate.py content/igloo/lang/french.json',
    'tools/validate_sentences.py content/igloo/sentences/french.json', 'tools/build-course.mjs fr --check']);
  const ci = readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8');
  assert.match(ci, /run: node tools\/validate-packs\.mjs/);
});

const python = (/** @type {string} */ code) => {
  const r = spawnSync('python3', ['-c', `import sys, json\nsys.path.insert(0, ${JSON.stringify(path.join(ROOT, 'tools'))})\n${code}`], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr);
  return JSON.parse(r.stdout);
};

test('per-language rule plugins: German folds as before, French keeps its accents, the table matches the registry', () => {
  const out = python(`from langrules import lang, CODES
from validate_accept import matches
de, fr, hi, ar = lang('german'), lang('fr'), lang('hindi'), lang('ar')
print(json.dumps({
  'codes': CODES,
  'de': [matches('fuer dich', 'für [x]'), matches('fur dich', 'für [x]'), sorted(de.grammar_kinds), de.translit, de.code],
  'fr': [matches('ou est la gare', 'où est [x]', fold=fr.fold), matches('où est la gare', 'où est [x]', fold=fr.fold), matches('oeuvre', 'œuvre', fold=fr.fold), 'choose-article' in fr.grammar_kinds],
  'translit': [hi.translit, ar.translit, fr.translit],
  'ar': ar.fold('أَحْمَد'),
}))`);
  assert.deepEqual(out.codes, Object.fromEntries(LANGUAGES.map(l => [l.id, l.legacyId])));
  assert.deepEqual(out.de, [true, false, ['choose-article', 'gap', 'join', 'order', 'transform', 'translate'], false, 'de']);
  assert.deepEqual(out.fr, [false, true, true, true]);
  assert.deepEqual(out.translit, [true, true, false]);
  assert.equal(out.ar, 'احمد');
});
