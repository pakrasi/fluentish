/* Word families: the index in content/build/de.json (round 7, second pass; content/build/FAMILY-SCHEMA.md "Where the
   families live"). The families live in one file per root (content/build/family/<root>.json); de.json keeps
   `familyIndex`, enough to answer without loading a family: which roots exist, every form's card, lemma and level,
   which forms can be on a board, the typed-answer lexicon and the rare words. Pure; built by tools/build-wordbuild.mjs
   and checked against the merged families by tests/unit/build-family-files.test.mjs. */

import { familyModel } from './wordbuild-family.js';

// Today's root from the index alone, and the board rules (defined beside boardFor, which uses them)
export { pickRoot, rootEntryOf, BOARD_RULES, boardRule, learnsArticle } from './wordbuild-family.js';

/** A root's file name: ASCII (hören → hoeren, schließen → schliessen), so paths and manifest ids stay plain. @param {string} root */
export const familySlug = root => root.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');
/** The manifest id of a root's family file (content/build/family/<slug>.json). @param {string} root */
export const familyFileId = root => `build.family.${familySlug(root)}`;

/**
 * @typedef {[string, string | null, string | null, string, string]} IndexForm  [id, card, lemma, level, flags]
 *   flags: b = a board form the game can build (card, tile key, board, clue), r = rare
 * @typedef {{root: string, file: string, lemma: string, en: string, level: string, zipf?: number | null, boards: string[],
 *   forms: IndexForm[], words: string[], rare: string[]}} IndexRoot
 * @typedef {{roots: IndexRoot[]}} FamilyIndex
 */

/**
 * The index of the families (in their order).
 * @param {{prefixes?: any[], families: any[]}} c the built content with its families
 * @returns {FamilyIndex}
 */
export function indexOf(c) {
  // the game's own view of each form (the tile key it can build), so the board flag is boardFor's
  const model = familyModel(/** @type {any} */ ({ prefixes: c.prefixes || [], roots: [], verbs: [], chains: [], families: c.families }));
  return {
    roots: c.families.map(fam => {
      const m = model.get(fam.root);
      const words = [];
      for (const f of fam.forms) { words.push(f.word); if (f.pp) words.push(f.pp); }
      return {
        root: fam.root, file: familyFileId(fam.root), lemma: fam.lemma, en: fam.en, level: fam.level, ...(fam.zipf != null ? { zipf: fam.zipf } : {}),
        boards: Object.keys(fam.boards || {}),
        // in the family file's order (the card ids familyModel lists, byCard, come in this order too)
        forms: fam.forms.map((/** @type {any} */ f) => {
          const g = m && m.byId.get(f.id);
          const b = !!(g && g.card && g.key && g.board !== false && g.clue);
          return /** @type {IndexForm} */ ([f.id, f.card ?? null, f.lemma ?? null, f.level, `${b ? 'b' : ''}${f.rare ? 'r' : ''}`]);
        }),
        words: [...new Set(words)],
        rare: (fam.rare || []).map((/** @type {any} */ r) => String(r.word)),
      };
    }),
  };
}

/**
 * An index form as the form fields the plan reads (id, card, lemma, level, rare, board), for knowledge and due checks.
 * @param {IndexForm} x
 */
export const indexForm = x => ({ id: x[0], card: x[1], lemma: x[2], level: x[3], board: x[4].includes('b'), rare: x[4].includes('r') });

/** The index's roots as pickRoot reads them: pickRoot({ roots: rootEntries(c.familyIndex), … }). @param {{roots: IndexRoot[]}} index */
export const rootEntries = index => index.roots.map(r => ({ root: r.root, forms: r.forms.map(indexForm) }));

/**
 * Word id → its family ({root, form}), from the index alone: what wordbuild-family.js familyIndex gives from the
 * families (a form's lemma, first in the model's order; then a member of the root's word cluster).
 * @param {{roots: IndexRoot[]}} index @param {{id: string, members?: string[]}[]} [clusterFamilies]
 * @returns {Map<string, {root: string, form: string | null}>}
 */
export function lemmaIndexOf(index, clusterFamilies = []) {
  /** @type {Map<string, {root: string, form: string | null}>} */ const out = new Map();
  for (const r of index.roots) for (const [id, , lemma] of r.forms) if (lemma && !out.has(lemma)) out.set(lemma, { root: r.root, form: id });
  const roots = new Set(index.roots.map(r => r.root));
  for (const cf of clusterFamilies) if (roots.has(cf.id)) for (const m of cf.members || []) if (!out.has(m) && !/\.phrase$/.test(m)) out.set(m, { root: cf.id, form: null });
  return out;
}
