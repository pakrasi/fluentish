/* Word families, one file per root (content/build/FAMILY-SCHEMA.md, "Where the families live"): content/build/de.json
   holds `familyIndex` and each root's family is its own lazy manifest file (build.family.<slug>), fetched when a
   screen needs that root and kept by the service worker (content files are fetched as path?h=<hash>, cache first).
   Today's family loads the day's root, the family view the root it opens; Browse by prefix or ending, and the warm-up
   after a screen's first paint, the rest. A file that fails to load costs only that family, and is tried again later.

   Content that still carries `families` inline (older builds, node fixtures) is read from there: nothing is fetched.
   Nothing here knows the network: `load` is the content service's load(id) (data/content.js); node tests inject
   their own. */

/**
 * @param {{load: (id: string) => Promise<any>, idle?: (fn: () => void) => void}} o
 *   idle: runs one warm-up step when the page is idle (default: requestIdleCallback, else a 1.5 s timeout)
 */
export function createFamilyFiles({ load, idle = defaultIdle }) {
  /** @type {Map<string, Promise<any>>} */ const memo = new Map();
  /** @type {Set<string>} */ const done = new Set();

  /** @param {any} c */
  const split = c => !Array.isArray(c.families) && !!(c.familyIndex && Array.isArray(c.familyIndex.roots));
  /** The roots in content order: the index's, or the inline families'. @param {any} c @returns {{root: string, file?: string}[]} */
  const index = c => (split(c) ? c.familyIndex.roots : (c.families || []).map((/** @type {any} */ f) => ({ root: f.root })));
  /** @param {any} c @param {string} root */
  const entry = (c, root) => index(c).find(e => e.root === root) || null;

  /** One root's family (the raw content shape), or null when the content has no such root. @param {any} c @param {string} root */
  function one(c, root) {
    if (!split(c)) return Promise.resolve((c.families || []).find((/** @type {any} */ f) => f.root === root) || null);
    const e = entry(c, root);
    if (!e || !e.file) return Promise.resolve(null);
    const id = String(e.file);
    let p = memo.get(id);
    if (!p) {
      p = load(id).then(f => { done.add(id); return f && f.root ? f : null; });
      p.catch(() => memo.delete(id));
      memo.set(id, p);
    }
    return p;
  }

  /** Several roots' families, in the order asked; a root whose file fails is left out. @param {any} c @param {string[]} roots */
  async function some(c, roots) {
    const got = await Promise.all(roots.map(r => one(c, r).catch(() => null)));
    return got.filter(Boolean);
  }

  /** Every family, in content order. @param {any} c */
  const all = c => some(c, index(c).map(e => e.root));

  /** Whether a root's family is in memory (always, inline). @param {any} c @param {string} root */
  const has = (c, root) => { if (!split(c)) return true; const e = entry(c, root); return !!(e && done.has(String(e.file))); };

  /**
   * After a screen's first paint: fetch the families not loaded yet, two at a time in idle moments, so the service
   * worker holds them for offline use. Never blocks and never throws; nothing on a save-data connection. Resolves
   * with the number fetched.
   * @param {any} c @param {{saveData?: boolean}} [o]
   */
  function warm(c, { saveData = false } = {}) {
    if (!split(c) || saveData) return Promise.resolve(0);
    const todo = index(c).filter(e => !memo.has(String(e.file))).map(e => e.root);
    let n = 0;
    return new Promise(resolve => {
      const step = () => {
        const batch = todo.splice(0, 2);
        if (!batch.length) { resolve(n); return; }
        Promise.all(batch.map(r => one(c, r).then(f => { if (f) n++; }, () => {}))).then(() => idle(step));
      };
      idle(step);
    });
  }

  return { split, index, one, some, all, has, warm };
}

/** @param {() => void} fn */
function defaultIdle(fn) {
  const g = /** @type {any} */ (globalThis);
  if (typeof g.requestIdleCallback === 'function') g.requestIdleCallback(fn, { timeout: 4000 });
  else setTimeout(fn, 1500);
}
