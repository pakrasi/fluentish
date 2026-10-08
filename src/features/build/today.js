/* Today's family (placeholder until the puzzle lands in the next commit). */
import { h, replace } from '../../core/dom.js';
/** @param {HTMLElement} el @param {any} ctx */
export async function mountToday(el, ctx) { replace(el, h('div', { class: 'wb' }, h('h1', null, ctx.t('build.today.title')))); }
