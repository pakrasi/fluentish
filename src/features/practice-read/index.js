/* Reading (round 4): real texts to read and understand, and the words he did not know turned into reviews. Owns
     #/practice/read                         the library (library.js)
     #/practice/read/new                     paste a text (paste.js)
     #/practice/read/<id>                    the reader (reader.js): Study (intensive) or Read on (extensive)
     #/practice/read/<id>/questions          comprehension questions (questions.js)
     #/practice/read/<id>/done               the finish screen (done.js)
     #/practice/read/lib/<slug>              a graded text from the content (readers@1), opened in the reader
   and the review round #/practice/round?kind=read (round.js): the registry gives this feature that route ahead of
   practice-round.
   Pure logic: logic.js (tested in node). Storage: features/shared/read-data.js. The texts stay on this device. */
import { h, replace } from '../../core/dom.js';
import { practicePage, restParts } from '../shared/page.js';
import { closeSheets } from '../shared/textview.js';
import { getRead } from '../shared/read-data.js';
import { back } from './ui.js';

/** @param {HTMLElement} el @param {import('../contract.js').ViewCtx} ctx */
export function mount(el, ctx) {
  if (ctx.route === '/practice/round') return practicePage(el, ctx, { list: false }, async () => (await import('./round.js')).mountRound(el, ctx));
  return practicePage(el, ctx, { list: true }, async () => {
    const res = await view(el, ctx, restParts(ctx));
    return {
      unmount() { closeSheets(); if (typeof res === 'function') res(); else res?.unmount?.(); },
      canLeave: typeof res?.canLeave === 'function' ? () => res.canLeave() : undefined,
    };
  });
}

/** @param {HTMLElement} el @param {import('../contract.js').ViewCtx} ctx @param {string[]} parts @returns {Promise<any>} */
async function view(el, ctx, parts) {
  const [a, b] = parts;
  if (!a) return (await import('./library.js')).mountLibrary(el, ctx);
  if (a === 'new') return (await import('./paste.js')).mountPaste(el, ctx);
  if (a === 'lib' && b) return (await import('./reader.js')).mountGraded(el, ctx, decodeURIComponent(b));
  const read = getRead(ctx.store, a);
  if (!read) {
    replace(el, h('div', { class: 'practice stack' }, back('#/practice/read', ctx.t('read.title')),
      h('div', { class: 'page-head' }, h('h1', null, ctx.t('read.gone'))),
      h('a', { class: 'btn pressable', href: '#/practice/read' }, ctx.t('read.toLibrary'))));
    return;
  }
  if (!b) return (await import('./reader.js')).mountReader(el, ctx, read);
  if (b === 'questions') return (await import('./questions.js')).mountQuestions(el, ctx, read);
  if (b === 'done') return (await import('./done.js')).mountDone(el, ctx, read);
  ctx.go(`/practice/read/${read.id}`, { replace: true });
}
