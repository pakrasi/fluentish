/* Word clusters and marking what you know.
     #/practice/clusters[/<type>[/<id>[/say]]]          word clusters (view.js); kind=cluster:… rounds run in practice-round
     #/practice/sort?cluster=…|level=…|ids=…            Quick sort: Know / Learn, one word at a time (sort.js)
     #/practice/known/<A1|A2>                           mark a level's words known after a spot check (check.js) */
import { practicePage, restParts } from '../shared/page.js';

/** @param {HTMLElement} el @param {import('../contract.js').ViewCtx} ctx */
export function mount(el, ctx) {
  const parts = restParts(ctx);
  if (ctx.route.startsWith('/practice/sort')) return practicePage(el, ctx, { list: false }, async () => (await import('./sort.js')).mountSort(el, ctx));
  if (ctx.route.startsWith('/practice/known')) return practicePage(el, ctx, { list: false }, async () => (await import('./check.js')).mountCheck(el, ctx, parts[0] || 'A1'));
  return practicePage(el, ctx, { list: true }, async () => (await import('./view.js')).mountClusters(el, ctx, parts));
}
