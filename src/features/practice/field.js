/* Readiness as the brand field (DESIGN.md Components › Readiness field): one cell per item of the B1 pool (mistakes
   from corrections excluded, as in the readiness number), in the order items are introduced, so the field fills like
   a line of text being written. Cells: 0 not started, 1 learning, 2 known (recalled with 90 % or more on the day
   readiness is measured on), 3 known and practised today (accent). The number next to it is the same readiness as
   Practice shows (domain/b1ready.js compute), so the two tabs always agree. */
import * as RD from '../../domain/b1ready.js';
import * as FS from '../../domain/fsrs.js';
import * as C from './compose.js';

export const KNOWN_R = 0.9;

/**
 * Cells in introduction order: seen items by the day they were first met, then the rest in the order they will come.
 * @param {import('./compose.js').State} s
 * @returns {{ ids: string[], states: number[] }}
 */
export function fieldStates(s) {
  const pool = s.data.pool.filter((/** @type {any} */ it) => it.area !== 'mistakes');
  const day = RD.recallDay(s.c), today = s.c.today;
  const index = new Map(pool.map((/** @type {any} */ it, /** @type {number} */ i) => [it.id, i]));
  const seen = pool.filter((/** @type {any} */ it) => s.cards[it.id]?.reps)
    .sort((/** @type {any} */ a, /** @type {any} */ b) => String(s.cards[a.id].first || '').localeCompare(String(s.cards[b.id].first || '')) || /** @type {number} */ (index.get(a.id)) - /** @type {number} */ (index.get(b.id)));
  const next = C.newOrder(s, pool, true);
  const placed = new Set([...seen, ...next].map((/** @type {any} */ it) => it.id));
  const rest = pool.filter((/** @type {any} */ it) => !placed.has(it.id));
  const order = [...seen, ...next, ...rest];
  const states = order.map((/** @type {any} */ it) => {
    const rec = s.cards[it.id];
    if (!rec || !rec.reps) return 0;
    if (rec.learn != null || rec.relearn || FS.Ron(rec, day) < KNOWN_R) return 1;
    return rec.last === today ? 3 : 2;
  });
  return { ids: order.map((/** @type {any} */ it) => it.id), states };
}

/**
 * Everything the readiness section shows.
 * @param {import('./compose.js').State} s
 */
export function readinessView(s) {
  const pool = s.data.pool.filter((/** @type {any} */ it) => it.area !== 'mistakes');
  const rd = RD.compute({ pool, store: s.cards, today: s.c.today, exam: s.c.exam, phase: s.c.phase });
  const f = fieldStates(s);
  return { ...f, recall: rd.overall.recall, coverage: rd.overall.coverage, seen: rd.overall.seen, n: rd.overall.n, day: rd.day,
    knownToday: f.states.filter(x => x === 3).length };
}

/** Today's readiness from the cached content (loads it once a session). Null when the content is not there. @param {any} ctx */
export async function readinessFor(ctx) {
  try {
    const { loadData, stateFor } = await import('./data.js');
    if (!ctx.settings().language) return null;
    return readinessView(stateFor(ctx, await loadData(ctx)));
  } catch { return null; }
}
