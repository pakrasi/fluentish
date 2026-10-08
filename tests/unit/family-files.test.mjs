// Word families in one file per root (src/features/build/family-files.js): read inline or split, each file once a
// session, a failed load tried again, and the content the app reads is the same either way. Synthetic loader only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createFamilyFiles } from '../../src/features/build/family-files.js';
import { familyModel } from '../../src/domain/wordbuild-family.js';

const build = JSON.parse(readFileSync(new URL('../../content/build/de.json', import.meta.url), 'utf8'));
const fam = (/** @type {string} */ root) => ({ root, en: `${root} meaning`, forms: [] });

/** A split content and a loader that counts its calls. @param {Record<string, any>} files @param {{fail?: Set<string>}} [o] */
function split(files, { fail = new Set() } = {}) {
  /** @type {string[]} */ const calls = [];
  const load = async (/** @type {string} */ id) => { calls.push(id); if (fail.has(id)) { fail.delete(id); throw new Error('offline'); } if (!(id in files)) throw new Error(`no ${id}`); return structuredClone(files[id]); };
  return { calls, ff: createFamilyFiles({ load }) };
}

test('inline families are read from build.de and nothing is fetched', async () => {
  const { calls, ff } = split({});
  const c = { families: [fam('stellen'), fam('legen')] };
  assert.equal(ff.split(c), false);
  assert.deepEqual(ff.index(c).map(e => e.root), ['stellen', 'legen']);
  assert.equal((await ff.one(c, 'legen'))?.root, 'legen');
  assert.equal(await ff.one(c, 'gehen'), null);
  assert.deepEqual((await ff.all(c)).map(f => f.root), ['stellen', 'legen']);
  assert.equal(ff.has(c, 'legen'), true);
  assert.deepEqual(calls, []);
});

test('a split index: one file per root, by its manifest id, fetched once a session', async () => {
  const { calls, ff } = split({ 'build.family.stellen': fam('stellen'), 'build.family.legen': { family: fam('legen') }, 'fam-gehen': { families: [fam('gehen')] } });
  const c = { familiesIndex: [{ root: 'stellen' }, { root: 'legen' }, { root: 'gehen', id: 'fam-gehen' }] };
  assert.equal(ff.split(c), true);
  assert.equal(ff.has(c, 'stellen'), false);
  assert.equal((await ff.one(c, 'stellen'))?.root, 'stellen');
  assert.equal((await ff.one(c, 'stellen'))?.root, 'stellen');
  assert.deepEqual(calls, ['build.family.stellen']);
  assert.equal(ff.has(c, 'stellen'), true);
  // the wrappers: { family }, { families: [...] }
  assert.deepEqual((await ff.some(c, ['gehen', 'legen', 'nope'])).map(f => f.root), ['gehen', 'legen']);
  assert.deepEqual((await ff.all(c)).map(f => f.root), ['stellen', 'legen', 'gehen']);
  assert.deepEqual(calls, ['build.family.stellen', 'fam-gehen', 'build.family.legen']);
  assert.equal(await ff.one(c, 'nope'), null);
});

test('a failed load is forgotten, so the next call fetches again', async () => {
  const { calls, ff } = split({ 'build.family.stellen': fam('stellen') }, { fail: new Set(['build.family.stellen']) });
  const c = { familiesIndex: [{ root: 'stellen' }] };
  await assert.rejects(ff.one(c, 'stellen'));
  assert.equal(ff.has(c, 'stellen'), false);
  assert.equal((await ff.one(c, 'stellen'))?.root, 'stellen');
  assert.deepEqual(calls, ['build.family.stellen', 'build.family.stellen']);
});

test('the shipped families split into files and read back give the same model', async () => {
  const files = Object.fromEntries(build.families.map((/** @type {any} */ f) => [`build.family.${f.root}`, f]));
  const { families, ...rest } = build;
  const c = { ...rest, familiesIndex: families.map((/** @type {any} */ f) => ({ root: f.root })) };
  const { ff } = split(files);
  const back = { ...rest, families: await ff.all(c) };
  const a = familyModel(build), b = familyModel(back);
  assert.deepEqual([...b.keys()], [...a.keys()]);
  for (const [root, fa] of a) {
    const fb = /** @type {any} */ (b.get(root));
    assert.deepEqual(fb.forms.map((/** @type {any} */ f) => [f.id, f.card, f.key, f.join]), fa.forms.map(f => [f.id, f.card, f.key, f.join]), root);
  }
});
