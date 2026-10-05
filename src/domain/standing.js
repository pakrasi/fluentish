/* Where you stand: one picture of what he knows, per exam module plus words and phrases. Pure (no storage, no clock
   reads); tested in node (tests/unit/standing.test.mjs). Documented in docs/ARCHITECTURE.md › Where you stand.

   One definition of "known" everywhere: domain/knowledge.js state 'known' (predicted recall now ≥ 0.90 and no lapse
   in the last 7 days, a lapse counting from the next study day). The map's known count (Explore) and the words and
   phrases line here count the same items with the same score, so they always agree.

   Per exam module (the modules of his exam goal):
     score      the latest mock score and its pass line (domain/modules.js moduleScores; Schreiben and Sprechen from the
                correction's score line), or none
     items      the module's practice items known, of all of them: Lesen = the Lesen phrases and the grammar items,
                Schreiben = the Schreiben phrases and his mistakes from corrections, Sprechen = the Sprechen phrases and
                situations, Hören = none (it is trained by mock parts and listening)
     status     'pass' (latest score at or over the pass line), 'below', or 'none' (no score yet)
   The next action for each module is the Today feature's (features/today/standing.js), from the plan it composed.

   Because "known" only rises with study on the day itself (a miss today is relearnt in the round and counts as a lapse
   from tomorrow), every count here is the same or higher after a round than before it. Readiness as a percentage
   (b1ready.js compute) stays the B1 pool's expected recall, used for Practice's area bars only. */

/** @typedef {'lesen'|'hoeren'|'schreiben'|'sprechen'} ModuleId */
/** Which pool areas train which module. */
export const MODULE_AREAS = /** @type {Record<ModuleId, string[]>} */ ({ lesen: ['reading', 'grammar'], hoeren: [], schreiben: ['writing', 'mistakes'], sprechen: ['speaking'] });
export const MODULE_ORDER = /** @type {ModuleId[]} */ (['lesen', 'hoeren', 'schreiben', 'sprechen']);

/**
 * @typedef {object} ModuleStanding
 * @property {ModuleId} id
 * @property {string} name
 * @property {number | null} score    latest mock score (points) or null
 * @property {number} max
 * @property {number} pass
 * @property {'pass'|'below'|'none'} status
 * @property {{known: number, n: number}} items   practice items of the module known, of all
 */

/**
 * Count known items. @param {string[]} ids @param {(id: string) => {state: string}} get
 * @returns {{known: number, n: number}}
 */
export function knownOf(ids, get) {
  let known = 0;
  for (const id of ids) if (get(id).state === 'known') known++;
  return { known, n: ids.length };
}

/**
 * The module lines.
 * @param {object} o
 * @param {{id: string, name: string, score: number | null, max: number, pass: number}[]} o.modules  the exam goal's modules with their latest score
 * @param {{id: string, area: string}[]} o.pool   practice items (the B1 pool, mistakes included)
 * @param {(id: string) => {state: string}} o.get  the knowledge score of a pool item
 * @returns {ModuleStanding[]}
 */
export function modulesStanding({ modules, pool, get }) {
  return MODULE_ORDER.map(id => modules.find(m => m.id === id)).filter(Boolean).map(m => {
    const mm = /** @type {{id: ModuleId, name: string, score: number | null, max: number, pass: number}} */ (m);
    const areas = MODULE_AREAS[mm.id] || [];
    const ids = pool.filter(it => areas.includes(it.area)).map(it => it.id);
    const status = mm.score == null ? 'none' : mm.score >= mm.pass ? 'pass' : 'below';
    return { id: mm.id, name: mm.name, score: mm.score, max: mm.max, pass: mm.pass, status: /** @type {'pass'|'below'|'none'} */ (status), items: knownOf(ids, get) };
  });
}

/**
 * The module to work on: no score before a score under the pass line before the lowest share of its maximum; the
 * productive modules first on a tie (Schreiben, Sprechen, Hören, Lesen). Null without modules.
 * @param {ModuleStanding[]} ms @returns {ModuleId | null}
 */
export function weakest(ms) {
  const rank = { none: 0, below: 1, pass: 2 };
  const tie = ['schreiben', 'sprechen', 'hoeren', 'lesen'];
  const list = [...ms].sort((a, b) => rank[a.status] - rank[b.status] || ((a.score ?? 0) / (a.max || 1)) - ((b.score ?? 0) / (b.max || 1)) || tie.indexOf(a.id) - tie.indexOf(b.id));
  return list.length ? list[0].id : null;
}

/**
 * This week's change, for a learner with no exam ahead: items learnt (first graduated in the last 7 days) and items
 * lapsed (a real miss on a graduated card in the last 7 days, before today). Reads card records of every deck.
 * @param {Record<string, Record<string, any>>} decks @param {string} today @param {(a: string, b: string) => number} diff days from a to b
 */
export function week(decks, today, diff) {
  let learnt = 0, lapsed = 0;
  for (const cards of Object.values(decks)) {
    for (const [id, r] of Object.entries(cards || {})) {
      if (!r || !r.reps || /^SR:/.test(id)) continue;
      const h = r.hist || [];
      const first = r.first ? diff(r.first, today) : 99;
      // learnt: first answered in this app in the last 7 days (a card imported or marked known has no answer that day)
      if (first >= 0 && first < 7 && r.learn == null && h.some((/** @type {any[]} */ x) => x[0] === r.first && !String(x[4] || '').includes('l'))) learnt++;
      if (h.some((/** @type {any[]} */ x) => x[1] === 1 && !String(x[4] || '').includes('v') && x[0] !== r.first && diff(x[0], today) >= 1 && diff(x[0], today) < 7)) lapsed++;
    }
  }
  return { learnt, lapsed };
}
