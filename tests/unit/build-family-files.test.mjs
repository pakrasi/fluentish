// Word families in per-root files (round 7, second pass; content/build/FAMILY-SCHEMA.md "Where the families live"):
// the files merged back are the families the build makes, deep-equal and in order; the index in de.json is what the
// families say; the app's loader (data/build-content.js) gives the same merged content as the node tools; and every
// pure function that reads families answers the same from the merged content as from the build's own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { build } from '../../tools/build-wordbuild.mjs';
import { readBuild, familyDir } from '../../tools/family-files.mjs';
import { indexOf, familySlug, familyFileId, lemmaIndexOf } from '../../src/domain/wordbuild-family-index.js';
import { loadBuild } from '../../src/data/build-content.js';
import * as F from '../../src/domain/wordbuild-family.js';
import { lemmaMaps, cardIds, pfIds } from '../../src/domain/wordbuild.js';
import { lexiconOf } from '../../src/domain/wordbuild-grade.js';
import { contentPrecache } from '../../tools/stamp.mjs';

const J = (/** @type {string} */ p) => JSON.parse(readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8'));
const WORDS = J('content/igloo/words/de.json');
const MAIN = J('content/build/de.json');
const MERGED = readBuild();
const BUILT = build(WORDS);
const MANIFEST = J('content/manifest.json');

test('de.json ships no families, only the index; the merged files are the families the build makes', () => {
  assert.equal(MAIN.families, undefined);
  assert.ok(MAIN.familyIndex && MAIN.familyIndex.roots.length === 40);
  assert.deepEqual(MERGED.families, BUILT.families);
  const { familyIndex, families, ...rest } = MERGED;
  const { families: _f, ...builtRest } = BUILT;
  assert.deepEqual(rest, builtRest);
  assert.deepEqual(familyIndex, indexOf(BUILT));
  // one file per family, named by its ASCII slug, nothing else in the directory
  assert.deepEqual(readdirSync(familyDir()).sort(), BUILT.families.map((/** @type {any} */ f) => `${familySlug(f.root)}.json`).sort());
  assert.equal(familySlug('hören'), 'hoeren');
  assert.equal(familySlug('schließen'), 'schliessen');
});

test('every family file is a lazy manifest file in the German pack, and out of the install precache', () => {
  const lazy = MANIFEST.files.filter((/** @type {any} */ f) => f.lazy);
  assert.deepEqual(lazy.map((/** @type {any} */ f) => f.id).sort(), MAIN.familyIndex.roots.map((/** @type {any} */ r) => r.file).sort());
  for (const r of MAIN.familyIndex.roots) assert.equal(r.file, familyFileId(r.root));
  for (const f of lazy) {
    assert.ok(MANIFEST.packs.de.includes(f.id), `${f.id} in pack de`);
    assert.equal(f.schema, 'build-family@1');
  }
  const pre = contentPrecache(MANIFEST);
  assert.ok(pre.packs.de.some(u => u.startsWith('content/build/de.json?h=')), 'de.json is still precached');
  assert.ok(!pre.packs.de.some(u => u.startsWith('content/build/family/')), 'no family file is precached');
});

test('the app\'s loader merges the same families as the node tools, and a missing file costs only that family', async () => {
  const files = new Map(MANIFEST.files.map((/** @type {any} */ f) => [f.id, f.path]));
  const content = { load: async (/** @type {string} */ id) => J(`content/${files.get(id)}`) };
  assert.deepEqual(await loadBuild(content), MERGED);
  const broken = { load: async (/** @type {string} */ id) => { if (id === 'build.family.stellen') throw new Error('offline'); return J(`content/${files.get(id)}`); } };
  const c = await loadBuild(broken);
  assert.equal(c.families.length, 39);
  assert.ok(!c.families.some((/** @type {any} */ f) => f.root === 'stellen'));
});

test('the pure functions answer the same from the merged files as from the build', () => {
  const info = () => null;
  const a = F.familyModel(MERGED, { info }), b = F.familyModel(BUILT, { info });
  assert.deepEqual([...a.keys()], [...b.keys()]);
  for (const [k, fam] of a) assert.deepEqual(fam.forms, /** @type {any} */ (b.get(k)).forms);
  assert.deepEqual(lemmaMaps(MERGED), lemmaMaps(BUILT));
  assert.deepEqual(cardIds(MERGED), cardIds(BUILT));
  assert.deepEqual(pfIds(MERGED), pfIds(BUILT));
  assert.deepEqual([...lexiconOf(MERGED)].sort(), [...lexiconOf(BUILT)].sort());
  assert.deepEqual([...F.familyLexicon(MERGED, WORDS)].sort(), [...F.familyLexicon(BUILT, WORDS)].sort());
});

test('de.json alone (the index, no family file) answers what Today, the round and word pages read before a family loads', () => {
  // the same answers as with every family loaded: card lemmas, PF ids in the same order, the typed-answer lexicons,
  // a word's family (word pages), the roots
  assert.deepEqual(lemmaMaps(MAIN), lemmaMaps(MERGED));
  assert.deepEqual(pfIds(MAIN), pfIds(MERGED));
  assert.deepEqual(cardIds(MAIN), cardIds(MERGED));
  assert.deepEqual([...lexiconOf(MAIN)].sort(), [...lexiconOf(MERGED)].sort());
  assert.deepEqual([...F.familyLexicon(MAIN, WORDS)].sort(), [...F.familyLexicon(MERGED, WORDS)].sort());
  const clusters = J('content/clusters/de.json').families;
  assert.deepEqual(lemmaIndexOf(MAIN.familyIndex, clusters), F.familyIndex(F.familyModel(MERGED), clusters));
});

test('the index lists every form in the file\'s order with its card, lemma, level, board and rare flags', () => {
  const ix = MAIN.familyIndex.roots;
  assert.deepEqual(ix.flatMap((/** @type {any} */ r) => r.rare), MERGED.families.flatMap((/** @type {any} */ f) => f.rare.map((/** @type {any} */ x) => x.word)));
  const model = F.familyModel(MERGED);
  for (const r of ix) {
    const fam = /** @type {F.Family} */ (model.get(r.root));
    assert.deepEqual(r.forms.map((/** @type {any[]} */ x) => x[0]), MERGED.families.find((/** @type {any} */ x) => x.root === r.root).forms.map((/** @type {any} */ f) => f.id), r.root);
    for (const [id, card, lemma, level, flags] of r.forms) {
      const f = /** @type {F.Form} */ (fam.byId.get(id));
      assert.equal(card, f.card, id); assert.equal(lemma, f.lemma, id); assert.equal(level, f.level, id);
      assert.equal(flags.includes('b'), !!(f.card && f.key && f.board !== false && f.clue), `${id} board`);
      assert.equal(flags.includes('r'), !!f.rare, `${id} rare`);
    }
  }
});
