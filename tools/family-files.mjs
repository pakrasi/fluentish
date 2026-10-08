// Word families on disk (round 7, second pass; content/build/FAMILY-SCHEMA.md "Where the families live"): the families
// are content/build/family/<root>.json, one file per root, and content/build/de.json holds `familyIndex`. Node tools and
// tests read the merged content here: readBuild() is content/build/de.json with `families` put back, in the index's
// order, which is the shape every pure function (familyModel, validateFamilies, lemmaMaps …) takes.
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { familySlug } from '../src/domain/wordbuild-family-index.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** The directory of the family files (content/build/family). @param {string} [root] the repo root */
export const familyDir = (root = ROOT) => path.join(root, 'content/build/family');
/** A root's family file (an ASCII name: hören → hoeren.json). @param {string} r @param {string} [root] */
export const familyPath = (r, root = ROOT) => path.join(familyDir(root), `${familySlug(r)}.json`);

/**
 * The build content with its families merged back (the identity: the old `families[]`).
 * @param {any} c content/build/de.json @param {string} [root] the repo root
 */
export function withFamilies(c, root = ROOT) {
  if (c.families || !c.familyIndex) return c;
  const families = c.familyIndex.roots.map((/** @type {any} */ r) => {
    const p = familyPath(r.root, root);
    if (!existsSync(p)) throw new Error(`content/build/family/${familySlug(r.root)}.json is missing (run node tools/build-wordbuild.mjs)`);
    return JSON.parse(readFileSync(p, 'utf8'));
  });
  return { ...c, families };
}

/** content/build/de.json with its families. @param {string} [root] the repo root */
export const readBuild = (root = ROOT) => withFamilies(JSON.parse(readFileSync(path.join(root, 'content/build/de.json'), 'utf8')), root);
