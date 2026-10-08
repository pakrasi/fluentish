/* Word families, one file per root (round 7 review, Performance): content/build/de.json can carry a small index of
   the families instead of all of them, and each root's family is its own manifest file, fetched when it is needed and
   cached by the service worker (content files are fetched as path?h=<hash>, so sw.js keeps them as immutable).

   Two shapes are read, so the app works before and after the content lane splits the file:
     inline   c.families: [Family, …]                         (FAMILY-SCHEMA.md, round 7)
     split    c.familiesIndex: [{ root, id?, path?, … }, …]  and one manifest file per root
              id: the file's manifest id (default `build.family.<root>`); the file holds the Family object itself, or
              { family: Family }, or { families: [Family] }
   Nothing here knows the network: `load` is the content service's load(id) (data/content.js), so node tests inject
   their own. Every family is loaded once a session; a failed load is forgotten so a later call tries again. The family
   view draws from its root's file and asks for the rest after its first paint (family-data.js loadFamilies). */

/** @param {{load: (id: string) => Promise<any>}} o */
export function createFamilyFiles({ load }) {
  /** @type {Map<string, Promise<any>>} */ const memo = new Map();

  /** The index entries: the split index, or the inline families' roots. @param {any} c */
  const index = c => (Array.isArray(c.familiesIndex) ? c.familiesIndex : (c.families || []).map((/** @type {any} */ f) => ({ root: f.root })));
  /** @param {any} c */
  const split = c => !Array.isArray(c.families) && Array.isArray(c.familiesIndex);
  /** A file's manifest id. @param {any} e an index entry */
  const fileId = e => String(e.id || `build.family.${e.root}`);

  /** One root's family, or null when the content has no such root. @param {any} c @param {string} root */
  function one(c, root) {
    if (!split(c)) return Promise.resolve((c.families || []).find((/** @type {any} */ f) => f.root === root) || null);
    const e = index(c).find((/** @type {any} */ x) => x.root === root);
    if (!e) return Promise.resolve(null);
    const id = fileId(e);
    let p = memo.get(id);
    if (!p) {
      p = load(id).then(unwrap(root));
      p.catch(() => memo.delete(id));
      memo.set(id, p);
    }
    return p;
  }

  /** Several roots' families, in the order asked (missing ones left out). @param {any} c @param {string[]} roots */
  async function some(c, roots) {
    const got = await Promise.all(roots.map(r => one(c, r)));
    return got.filter(Boolean);
  }

  /** Every family, in the index's order. @param {any} c */
  function all(c) {
    if (!split(c)) return Promise.resolve(c.families || []);
    return some(c, index(c).map((/** @type {any} */ e) => String(e.root)));
  }

  /** Whether a root's file is loaded already (or the families are inline). @param {any} c @param {string} root */
  const has = (c, root) => !split(c) || memo.has(fileId(index(c).find((/** @type {any} */ x) => x.root === root) || { root }));

  return { split, index, fileId, one, some, all, has };
}

/** A family file's Family, whichever wrapper it has. @param {string} root */
const unwrap = root => (/** @type {any} */ file) => {
  if (!file) return null;
  if (Array.isArray(file.families)) return file.families.find((/** @type {any} */ f) => f.root === root) || file.families[0] || null;
  if (file.family) return file.family;
  return file.root ? file : null;
};
