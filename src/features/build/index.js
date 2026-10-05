/* Practice › Word building: its own feature module (registry id 'build'), so Practice does not grow. Owns
   #/practice/build and below:
     #/practice/build                        hub: Prefixes, Verbs, Sentences, Suffixes, Split or stay, the daily cap, Review
     #/practice/build/prefixes[?root&pre&v]  the compass (compass.js)
     #/practice/build/table[?col|row&lens]   the root × prefix grid (table.js)
     #/practice/build/machine[/<frame>][?f]  the sentence machine (machine.js)
     #/practice/build/suffixes[/<chain>]     word chains and the article chart (chain.js)
     #/practice/build/round?kind=…           a round, full screen (round.js): review | prefixes | verbs | sentences |
                                             suffixes | drill ("Which prefix?") | pick&ids=…
     #/practice/build/game                   Split or stay, 60 seconds (game.js)
   Content: content/build/de.json (tools/build-wordbuild.mjs). Pure logic: domain/wordbuild.js, wordbuild-plan.js,
   wordbuild-grade.js and buildBudget in domain/budget.js. Storage and settings: data.js. Prototype and spec:
   PREFIX-DESIGN (round 2). */
import { h, replace } from '../../core/dom.js';

/** @param {HTMLElement} el @param {import('../contract.js').ViewCtx} ctx */
export async function mount(el, ctx) {
  const parts = (ctx.params.rest || '').split('/').filter(Boolean).map(decodeURIComponent);
  const lang = ctx.settings().language;
  if (lang && lang !== 'german') {
    replace(el, h('div', { class: 'wb stack' }, h('div', { class: 'page-head' }, h('h1', null, ctx.t('build.title'))), h('p', null, ctx.t('practice.langLater'))));
    return;
  }
  const [view, arg] = parts;
  if (!view) return (await import('./hub.js')).mountHub(el, ctx);
  if (view === 'prefixes') return (await import('./compass.js')).mountCompass(el, ctx);
  if (view === 'table') return (await import('./table.js')).mountTable(el, ctx);
  if (view === 'machine') return (await import('./machine.js')).mountMachine(el, ctx, arg);
  if (view === 'suffixes') return (await import('./chain.js')).mountChains(el, ctx, arg);
  if (view === 'round') return (await import('./round.js')).mountRound(el, ctx);
  if (view === 'game') return (await import('./game.js')).mountGame(el, ctx);
  if (view === 'drill') { ctx.go('/practice/build/round?kind=drill', { replace: true }); return; }
  replace(el, h('div', { class: 'wb stack' }, h('div', { class: 'page-head' }, h('h1', null, ctx.t('error.notFound'))), h('a', { class: 'btn pressable', href: '#/practice/build' }, ctx.t('build.back'))));
}
