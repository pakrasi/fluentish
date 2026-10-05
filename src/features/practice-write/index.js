/* Schreiben (#/practice/write, write.js): the Schreiben phrases' queue, the three Aufgaben and Build an email.
     #/practice/write                         the Schreiben page
     #/practice/write/build/<task>[/free]     Build an email, then write it yourself */
import { practicePage, restParts } from '../shared/page.js';
import { mountWrite } from './write.js';

/** @param {HTMLElement} el @param {import('../contract.js').ViewCtx} ctx */
export function mount(el, ctx) {
  return practicePage(el, ctx, { list: true }, () => mountWrite(el, ctx, restParts(ctx)));
}
