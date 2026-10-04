/* Public content, found through content/manifest.json. Files are fetched by manifest id, with ?h=<sha8> so a changed
   file is never served from an old cache, and kept in memory for the session. The fetch is injectable so node tests
   and a future iOS shell (files on disk) can supply their own. */

/**
 * @param {{ base: string, fetch?: typeof fetch }} o
 */
export function createContent({ base, fetch: f = (...a) => fetch(...a) }) {
  /** @type {Promise<any> | null} */ let manifestP = null;
  /** @type {Map<string, Promise<any>>} */ const files = new Map();

  async function getJson(/** @type {string} */ url) {
    const r = await f(url, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    return r.json();
  }

  const api = {
    /** @returns {Promise<any>} */
    manifest() {
      if (!manifestP) manifestP = getJson(new URL('manifest.json', base).href).catch(e => { manifestP = null; throw e; });
      return manifestP;
    },
    /** Load one file by manifest id. @param {string} id */
    async load(id) {
      let p = files.get(id);
      if (!p) {
        p = api.manifest().then(m => {
          const entry = m.files.find((/** @type {any} */ x) => x.id === id);
          if (!entry) throw new Error(`content: no file with id ${id}`);
          return getJson(new URL(`${entry.path}?h=${entry.sha256.slice(0, 8)}`, base).href);
        });
        p.catch(() => files.delete(id));
        files.set(id, p);
      }
      return p;
    },
    /** The exam definition (modules, limits, tests) for an exam id, or null. @param {string | null} id */
    async exam(id) {
      if (!id) return null;
      const m = await api.manifest();
      return m.exams.find((/** @type {any} */ e) => e.id === id) || null;
    },
  };
  return api;
}
