/* Exam (stage B builds it): the mock-test library, start panel, runner and reviews (UX §4.4–4.7).
   Owns #/exam and everything under it: <test>, <test>/<module>, <test>/<module>/review/<attempt>.
   Stage A placeholder: the module summary from the attempts in the store, and the page that was asked for. */
import { h, replace } from '../../core/dom.js';
import { label } from '../../core/clock.js';
import { notice } from '../../core/ui.js';

/** @param {HTMLElement} el @param {import('../contract.js').ViewCtx} ctx */
export async function mount(el, ctx) {
  const { t, store } = ctx;
  const s = ctx.settings();
  const exam = await ctx.content.exam(s.exam.type).catch(() => null);
  const sub = ctx.params.rest ? `/exam/${ctx.params.rest}` : null;
  const attempts = store.attempts().filter(a => exam && a.examId === exam.id);
  replace(el, h('div', { class: 'stack placeholder' },
    h('h1', null, t('tab.exam')),
    h('p', { class: 'lead' }, [exam ? exam.name : t('exam.generic'), s.exam.date ? label(s.exam.date) : null].filter(Boolean).join(' · ')),
    exam ? h('p', null, t('exam.summary', { tests: exam.tests.length, done: attempts.length })) : null,
    notice({ children: [h('p', null, sub ? t('placeholder.page', { path: sub }) : t('placeholder.exam'))] }),
    h('a', { class: 'btn pressable', href: '#/today' }, t('placeholder.back'))));
}
