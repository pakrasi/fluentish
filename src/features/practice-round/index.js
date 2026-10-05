/* Practice round (#/practice/round[?kind=…], UX §4.3): a typed round, full screen (round.js). kind: missed,
   mistakes, warmup, write, area:<speaking|reading|grammar|words>, topic:<grammar topic>, cluster:<type>:<id> |
   cluster:due, pick:<ids>. A script's words round (kind=script:<id>) is the practice-script feature's: the registry
   matches it on the query before this route. */
import { practicePage } from '../shared/page.js';
import { mountRound } from './round.js';

/** @param {HTMLElement} el @param {import('../contract.js').ViewCtx} ctx */
export function mount(el, ctx) {
  return practicePage(el, ctx, { list: false }, () => mountRound(el, ctx));
}
