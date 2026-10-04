/* Look up (stage B builds it): My words, Phrases, Grammar, Verb frames, one search (UX §4.10).
   Owns #/lookup and everything under it: words[/<lemma>], phrases, grammar, frames, ?q=.
   Stage A placeholder. */
import { h, replace } from '../../core/dom.js';
import { notice } from '../../core/ui.js';

/** @param {HTMLElement} el @param {import('../contract.js').ViewCtx} ctx */
export function mount(el, ctx) {
  const { t } = ctx;
  const sub = ctx.params.rest ? `/lookup/${ctx.params.rest}` : null;
  replace(el, h('div', { class: 'stack placeholder' },
    h('h1', null, t('tab.lookup')),
    notice({ children: [h('p', null, sub ? t('placeholder.page', { path: sub }) : t('placeholder.lookup'))] }),
    h('a', { class: 'btn pressable', href: '#/today' }, t('placeholder.back'))));
}
