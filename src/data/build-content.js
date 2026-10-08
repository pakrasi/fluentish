/* Word building's content (content/build/de.json) with its word families merged back in. Since round 7's second pass
   the families are one file per root (content/build/family/<slug>.json, lazy in the manifest) and de.json holds
   `familyIndex` (content/build/FAMILY-SCHEMA.md). Until the lazy loader reads one family at a time, this loads every
   family file once a session and returns the merged shape the pure functions take; a family file that fails to load
   only loses that family. */

/** @type {WeakMap<object, Promise<any>>} */ const memo = new WeakMap();

/**
 * content/build/de.json with `families` (the merged shape: the old families[]).
 * @param {{load: (id: string) => Promise<any>}} content
 * @returns {Promise<any>}
 */
export function loadBuild(content) {
  let p = memo.get(content);
  if (!p) {
    p = content.load('build.de').then(async (/** @type {any} */ c) => {
      if (c.families || !c.familyIndex) return c;
      const fams = await Promise.all(c.familyIndex.roots.map((/** @type {any} */ r) => content.load(r.file).catch(() => null)));
      return { ...c, families: fams.filter(Boolean) };
    });
    p.catch(() => memo.delete(content));
    memo.set(content, p);
  }
  return p;
}
