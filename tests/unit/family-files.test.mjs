// Word families one file per root (src/features/build/family-files.js, content/build/FAMILY-SCHEMA.md): a root's file
// is fetched once a session by the index's manifest id, a failed load is tried again, the warm-up fetches only what is
// missing, inline families are read without fetching, and the shipped files read this way give the merged model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createFamilyFiles } from '../../src/features/build/family-files.js';
import { familyModel } from '../../src/domain/wordbuild-family.js';
import { familyFileId } from '../../src/domain/wordbuild-family-index.js';
import { readBuild, familyPath } from '../../tools/family-files.mjs';

const fam = (/** @type {string} */ root) => ({ root, en: `${root} meaning`, forms: [] });
const now = (/** @type {() => void} */ fn) => fn();

/** A loader over these files that counts its calls. @param {Record<string, any>} files @param {Set<string>} [fail] ids that fail once */
function loader(files, fail = new Set()) {
  /** @type {string[]} */ const calls = [];
  const load = async (/** @type {string} */ id) => { calls.push(id); if (fail.has(id)) { fail.delete(id); throw new Error('offline'); } if (!(id in files)) throw new Error(`no ${id}`); return structuredClone(files[id]); };
  return { calls, ff: createFamilyFiles({ load, idle: now }) };
}
const index = (/** @type {string[]} */ roots) => ({ familyIndex: { roots: roots.map(root => ({ root, file: familyFileId(root) })) } });

test('inline families are read from build.de and nothing is fetched', async () => {
  const { calls, ff } = loader({});
  const c = { families: [fam('stellen'), fam('legen')] };
  assert.equal(ff.split(c), false);
  assert.deepEqual(ff.index(c).map(e => e.root), ['stellen', 'legen']);
  assert.equal((await ff.one(c, 'legen'))?.root, 'legen');
  assert.equal(await ff.one(c, 'gehen'), null);
  assert.deepEqual((await ff.all(c)).map(f => f.root), ['stellen', 'legen']);
  assert.equal(ff.has(c, 'legen'), true);
  assert.equal(await ff.warm(c), 0);
  assert.deepEqual(calls, []);
});

test('one root, one file: fetched by the index id, once a session', async () => {
  const { calls, ff } = loader({ 'build.family.stellen': fam('stellen'), 'build.family.hoeren': fam('hören'), 'build.family.legen': fam('legen') });
  const c = index(['stellen', 'hören', 'legen']);
  assert.equal(ff.split(c), true);
  assert.equal(ff.has(c, 'stellen'), false);
  assert.equal((await ff.one(c, 'stellen'))?.root, 'stellen');
  assert.equal((await ff.one(c, 'stellen'))?.root, 'stellen');
  assert.deepEqual(calls, ['build.family.stellen']);
  assert.equal(ff.has(c, 'stellen'), true);
  // an ASCII file id for hören; roots asked in order, unknown ones left out
  assert.deepEqual((await ff.some(c, ['hören', 'nope'])).map(f => f.root), ['hören']);
  assert.deepEqual(calls, ['build.family.stellen', 'build.family.hoeren']);
  assert.equal(await ff.one(c, 'nope'), null);
});

test('a failed file is left out and tried again later; the warm-up fetches only what is missing', async () => {
  const { calls, ff } = loader({ 'build.family.stellen': fam('stellen'), 'build.family.legen': fam('legen'), 'build.family.gehen': fam('gehen') }, new Set(['build.family.legen']));
  const c = index(['stellen', 'legen', 'gehen']);
  await ff.one(c, 'stellen');
  assert.deepEqual((await ff.some(c, ['legen', 'stellen'])).map(f => f.root), ['stellen']);
  assert.equal(ff.has(c, 'legen'), false);
  assert.equal(await ff.warm(c), 2);   // legen again, and gehen; stellen is not fetched twice
  assert.deepEqual(calls, ['build.family.stellen', 'build.family.legen', 'build.family.legen', 'build.family.gehen']);
  assert.equal(await ff.warm(c), 0);
  assert.equal(await ff.warm(index(['x']), { saveData: true }), 0);
});

test('the shipped files, one root at a time, give the merged model', async () => {
  const build = JSON.parse(readFileSync(new URL('../../content/build/de.json', import.meta.url), 'utf8'));
  assert.equal(build.families, undefined, 'build.de holds the index, not the families');
  const files = Object.fromEntries(build.familyIndex.roots.map((/** @type {any} */ r) => [r.file, JSON.parse(readFileSync(familyPath(r.root), 'utf8'))]));
  const { ff } = loader(files);
  const merged = familyModel(readBuild());
  for (const r of build.familyIndex.roots) {
    const raw = await ff.one(build, r.root);
    const one = familyModel({ ...build, families: [raw], roots: (build.roots || []).filter((/** @type {any} */ x) => x.id === r.root) }).get(r.root);
    const want = /** @type {any} */ (merged.get(r.root));
    assert.deepEqual(one?.forms.map(f => [f.id, f.card, f.key, f.join, f.board]), want.forms.map((/** @type {any} */ f) => [f.id, f.card, f.key, f.join, f.board]), r.root);
  }
});
