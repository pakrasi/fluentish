/* Practice (UX §4.2): the hub of the one review queue, and the exam words page. Owns #/practice and whatever no
   other Practice feature owns:
     #/practice                        the hub (hub.js): what to do now, then three groups (exam modules, words, your material)
     #/practice/words                  exam words from the private results repository (exam-words.js)
     #/practice/<anything else>        not found
   The pages around it are sibling features (features/registry.js), each with its own routes and Today rows:
     practice-round     #/practice/round[?kind=…]                   the typed round
     practice-write     #/practice/write[/…]                         Schreiben and Build an email
     practice-speak     #/practice/speak[/…], #/practice/situations[/…]   Sprechen and speaking situations
     practice-script    #/practice/scripts[/…], #/practice/round?kind=script:<id>
     practice-clusters  #/practice/clusters[/…], #/practice/sort, #/practice/known/<level>
     build              #/practice/build[/…]                         Word building
   They share the practice runtime in features/shared/ (the pool, the round state, grading, the done hero) and the
   day's numbers in domain/allowance.js, and never import one another. */
import { h, replace } from '../../core/dom.js';
import { practicePage, restParts } from '../shared/page.js';
import { mountHub } from './hub.js';
import { mountWords } from './exam-words.js';

/** @param {HTMLElement} el @param {import('../contract.js').ViewCtx} ctx */
export function mount(el, ctx) {
  const parts = restParts(ctx);
  if (parts[0] && parts[0] !== 'words') {
    replace(el, h('div', { class: 'practice stack' }, h('div', { class: 'page-head' }, h('h1', null, ctx.t('error.notFound'))), h('a', { class: 'btn pressable', href: '#/practice' }, ctx.t('practice.back'))));
    return undefined;
  }
  return practicePage(el, ctx, { list: true }, () => (parts[0] === 'words' ? mountWords(el, ctx) : mountHub(el, ctx)));
}
