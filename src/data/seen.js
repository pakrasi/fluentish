/* Look up views as "seen" (domain/knowledge.js): every word sheet and phrase he opens in Look up is recorded once a
   day in the profile's key-value collection 'lookup.seen' { [item id]: { first, last, n } } (n: days it was opened).
   Private like the rest of the profile; nothing here schedules a card. Only this module writes the collection. */

export const COLLECTION = 'lookup.seen';

/**
 * Pure: the next collection value after a view of one item on a day (n counts days, not taps).
 * @param {Record<string, {first: string, last: string, n: number}>} cur @param {string} itemId @param {string} day
 */
export function planSeen(cur, itemId, day) {
  const prev = cur[itemId];
  if (prev && prev.last === day) return cur;
  return { ...cur, [itemId]: { first: prev ? prev.first : day, last: day, n: (prev ? prev.n : 0) + 1 } };
}

/**
 * Record that he opened an item in Look up today. Never throws.
 * @param {{update: (name: string, fn: (v: any) => any, fallback?: any) => any}} store @param {string | null | undefined} itemId @param {string} day
 */
export function markSeen(store, itemId, day) {
  if (!itemId || !day) return;
  try { store.update(COLLECTION, (/** @type {any} */ m) => planSeen(m || {}, itemId, day), {}); } catch { /* storage blocked: a view is not worth an error */ }
}
