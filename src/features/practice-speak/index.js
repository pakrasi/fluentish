/* Sprechen: one page for speaking (speak.js) and speaking situations (sim-view.js).
     #/practice/speak[/teil2|/aloud[/check|/go]]           Sprechen: situations, the Teil 2 talk, the mic check
     #/practice/situations[/round?pick=…]                  situations: the picker, and a round full screen
     #/practice/teil2                                      an old link: the Teil 2 talk */
import { practicePage, restParts } from '../shared/page.js';
import { mountSpeak } from './speak.js';
import { mountSim } from './sim-view.js';

/** @param {HTMLElement} el @param {import('../contract.js').ViewCtx} ctx */
export function mount(el, ctx) {
  const parts = restParts(ctx);
  if (ctx.route === '/practice/teil2') { ctx.go('/practice/speak/teil2', { replace: true }); return undefined; }
  if (ctx.route.startsWith('/practice/situations')) return practicePage(el, ctx, { list: parts[0] !== 'round' }, () => mountSim(el, ctx, parts));
  return practicePage(el, ctx, { list: true }, () => mountSpeak(el, ctx, parts));
}
