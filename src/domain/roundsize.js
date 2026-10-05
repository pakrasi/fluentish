/* How many items a Practice round takes: the round size picker's three choices (features/practice/picker.js). Pure;
   tested in node (tests/unit/roundsize.test.mjs).

     Recommended  what the list's own composer makes: due items first, then new ones within today's allowance
                  (domain/budget.js through the composer). One round.
     Custom       n of the N items in the list (1 ≤ n ≤ N)
     All          all N

   A custom or "all" round takes, in this order: the due items (weakest first), the new items today's allowance still
   has room for, the items already seen that are not due (weakest first: practising them early adds no new load), and
   only then new items beyond the allowance. Those come in like any new item: shown, answered and scheduled by FSRS,
   counted as shown today, so Today's plan reads the real load afterwards (no new items left, their learning steps
   due). The picker says so before the round starts ("This adds 11 new items beyond today's 4"). */

/**
 * @typedef {object} Buckets  a list's items, by what a round would do with them
 * @property {string[]} due     due now, weakest first
 * @property {string[]} fresh   never seen, in the order they are introduced
 * @property {string[]} rest    seen, not due, weakest first
 * @property {number} newLeft   new items today's allowance still has room for in this list (Infinity: no daily cap)
 * @property {boolean} daily    the allowance is the day's (domain/budget.js); false: the composer's own per-round number
 */

/** Size choices: 'rec' (Recommended), 'all', or a number. @param {string | null | undefined} s @returns {'rec' | 'all' | number | null} */
export function parseSize(s) {
  if (s === 'rec' || s === 'all') return s;
  const n = Number(s);
  return Number.isInteger(n) && n > 0 && n < 10000 ? n : null;
}

/** The address value for a size. @param {'rec' | 'all' | number} size */
export const sizeKey = size => String(size);

/** Items in the list. @param {Buckets} b */
export const total = b => b.due.length + b.fresh.length + b.rest.length;

/** A number clamped to 1 … N. @param {number} n @param {number} N */
export const clamp = (n, N) => Math.max(1, Math.min(Math.max(1, N), Math.round(Number(n) || 1)));

/**
 * The ids of a custom or "all" round, and what they are.
 * @param {Buckets} b @param {'all' | number} size
 * @returns {{ids: string[], due: number, fresh: number, early: number, over: number}}
 *   fresh: new items within the allowance; over: new items beyond it; early: seen items practised before they are due
 */
export function pick(b, size) {
  const N = total(b);
  const n = size === 'all' ? N : clamp(size, N);
  const allow = Math.max(0, Math.min(b.fresh.length, Number.isFinite(b.newLeft) ? b.newLeft : b.fresh.length));
  const order = [
    ...b.due.map(id => ({ id, k: 'due' })),
    ...b.fresh.slice(0, allow).map(id => ({ id, k: 'fresh' })),
    ...b.rest.map(id => ({ id, k: 'early' })),
    ...b.fresh.slice(allow).map(id => ({ id, k: 'over' })),
  ];
  const seen = new Set(), chosen = [];
  for (const x of order) { if (chosen.length >= n) break; if (!seen.has(x.id)) { seen.add(x.id); chosen.push(x); } }
  const count = (/** @type {string} */ k) => chosen.filter(x => x.k === k).length;
  // new items between reviews (r r n r r n …), so a long round never front-loads all its new items
  const olds = chosen.filter(x => x.k === 'due' || x.k === 'early').map(x => x.id), news = chosen.filter(x => x.k === 'fresh' || x.k === 'over').map(x => x.id);
  const ids = [];
  while (olds.length || news.length) { if (olds.length) ids.push(/** @type {string} */ (olds.shift())); if (olds.length) ids.push(/** @type {string} */ (olds.shift())); if (news.length) ids.push(/** @type {string} */ (news.shift())); }
  return { ids, due: count('due'), fresh: count('fresh'), early: count('early'), over: count('over') };
}

/**
 * What Recommended is: its ids as the composer made them, split into due, new and early (practised ahead when
 * nothing is due).
 * @param {Buckets} b @param {string[]} rec the composer's round
 */
export function recommended(b, rec) {
  const due = new Set(b.due), fresh = new Set(b.fresh);
  const d = rec.filter(id => due.has(id)).length, f = rec.filter(id => fresh.has(id)).length;
  return { ids: rec, n: rec.length, due: d, fresh: f, early: rec.length - d - f };
}

/**
 * The three choices for the sheet: Recommended's counts, the list's N, and for any n what it adds beyond today's
 * allowance.
 * @param {Buckets} b @param {string[]} rec
 */
export function options(b, rec) {
  const N = total(b);
  return { N, rec: recommended(b, rec), all: pick(b, 'all'), custom: (/** @type {number} */ n) => pick(b, clamp(n, N)) };
}

/**
 * The remembered choice of a list type, as the sheet opens with it: Recommended when there is one, else the last
 * custom number (clamped to this list) or All.
 * @param {{mode?: string, n?: number} | null | undefined} last @param {number} N @param {number} recN
 * @returns {{mode: 'rec' | 'custom' | 'all', n: number}}
 */
export function initial(last, N, recN) {
  const n = clamp(last && last.n ? last.n : Math.max(recN, Math.min(N, 12)), N);
  if (last && last.mode === 'all') return { mode: 'all', n };
  if (last && last.mode === 'custom') return { mode: 'custom', n };
  return { mode: recN ? 'rec' : 'custom', n };
}
