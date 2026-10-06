/* "Recheck by typing": the words he sorted to Learn in Quick sort (kv known.checks, domain/checks.js recheckList) that
   are not known or marked known now and have no passing typed check since. Quick sort's summary and Look up › Words
   offer them; the recheck itself is Quick sort in Produce mode (#/practice/sort?recheck=1). Reads only. */
import { recheckList } from '../../domain/checks.js';
import { checksOf } from '../../data/checks.js';
import { loadClusters, loadKnowledge } from './cluster-data.js';

/**
 * The word ids (no W:) to recheck, latest Learn first.
 * @param {any} store @param {{get: (id: string) => any}} k the knowledge scores @param {(id: string) => any} word
 * @returns {string[]}
 */
export function recheckWords(store, k, word) {
  return recheckList(checksOf(store), id => k.get(id)).filter(id => id.startsWith('W:')).map(id => id.slice(2)).filter(id => word(id));
}

/**
 * How many words he can recheck now, loading the scores only when there is a Learn pick at all.
 * @param {any} ctx a view ctx @returns {Promise<number>}
 */
export async function recheckCount(ctx) {
  const kv = checksOf(ctx.store);
  if (!Object.values(kv).some(e => e && e.learn)) return 0;
  const [data, k] = await Promise.all([loadClusters(ctx), loadKnowledge(ctx)]);
  return recheckWords(ctx.store, k, (/** @type {string} */ id) => data.ix.word(id)).length;
}
