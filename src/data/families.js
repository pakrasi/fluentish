/* Word families for word sheets anywhere (round 7): which root's family a word belongs to, so a word sheet can offer
   "Family: stellen ›". Built once a session from the Word building content and the word clusters' families
   (domain/wordbuild-family.js familyIndex); a missing file only loses the links. */
import { familyModel, familyIndex } from '../domain/wordbuild-family.js';

/** @type {Promise<Map<string, {root: string, form: string | null}>> | null} */ let memo = null;

/**
 * Word id → its family ({root, form}); a form's lemma, or a member of the root's word cluster.
 * @param {{load: (id: string) => Promise<any>}} content
 * @returns {Promise<Map<string, {root: string, form: string | null}>>}
 */
export function familyIndexOf(content) {
  if (!memo) {
    memo = Promise.all([content.load('build.de'), content.load('clusters.de').catch(() => null)])
      .then(([build, clusters]) => familyIndex(familyModel(build), clusters && Array.isArray(clusters.families) ? clusters.families : []));
    memo.catch(() => { memo = null; });
  }
  return memo;
}

/** @type {Promise<Set<string>> | null} */ let roots = null;
/** The roots with family data (the Map's family groups link to their family view). @param {{load: (id: string) => Promise<any>}} content */
export function familyRootsOf(content) {
  if (!roots) {
    roots = content.load('build.de').then(b => new Set([...familyModel(b).keys()]));
    roots.catch(() => { roots = null; });
  }
  return roots;
}

/** The family view's address for a hit. @param {{root: string, form: string | null}} hit @param {string} [from] */
export function familyHref(hit, from = '') {
  const q = new URLSearchParams();
  if (hit.form) q.set('w', hit.form);
  if (from) q.set('from', from);
  const s = q.toString();
  return `#/practice/build/family/${encodeURIComponent(hit.root)}${s ? `?${s}` : ''}`;
}
