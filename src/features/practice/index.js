/* Practice (stage B builds it): the one review queue plus focused practice (UX §4.2–4.3, §4.8–4.9).
   Owns #/practice and everything under it: round, round?kind=…, write[/id], speak[/teil2|/aloud].
   Stage A placeholder: shows the queue size from the store and names the page that was asked for. */
import { h, replace } from '../../core/dom.js';
import { notice } from '../../core/ui.js';
import { isDue } from '../../domain/b1ready.js';

/** @param {HTMLElement} el @param {import('../contract.js').ViewCtx} ctx */
export function mount(el, ctx) {
  const { t, store } = ctx;
  const c = ctx.clock.ctx();
  const due = Object.values(store.cards('b1')).filter(r => isDue(r, c.today)).length;
  const sub = ctx.params.rest ? `/practice/${ctx.params.rest}${ctx.query.toString() ? `?${ctx.query}` : ''}` : null;
  replace(el, h('div', { class: 'stack placeholder' },
    h('h1', null, t('tab.practice')),
    h('p', { class: 'lead' }, t('practice.queue', { n: due })),
    notice({ children: [h('p', null, sub ? t('placeholder.page', { path: sub }) : t('placeholder.practice'))] }),
    h('a', { class: 'btn pressable', href: '#/today' }, t('placeholder.back'))));
}
