/* What every Practice page does when it mounts, whichever Practice feature owns it (practice, practice-round,
   practice-write, practice-speak, practice-script, practice-clusters): the German-only notice for another language,
   the device voices warmed for read-aloud, and on list pages the round size picker in front of round links
   (picker.js). Rounds and Quick sort open straight away. */
import { h, replace } from '../../core/dom.js';
import { notice } from '../../core/ui.js';
import { warm as warmVoices } from '../../services/voice.js';
import { pickerLinks } from './picker.js';

/**
 * @param {HTMLElement} el @param {import('../contract.js').ViewCtx} ctx
 * @param {{list?: boolean}} o list: a page of rows whose round links open the size picker first
 * @param {() => any} draw mounts the page; may return a cleanup or {unmount, canLeave}
 * @returns {Promise<any>}
 */
export async function practicePage(el, ctx, { list = true }, draw) {
  const lang = ctx.settings().language;
  if (lang && lang !== 'german') {   // phase 1: the practice items are German; another language never gets them
    replace(el, h('div', { class: 'practice stack' }, h('div', { class: 'page-head' }, h('h1', null, ctx.t('practice.title'))),
      notice({ children: [h('p', null, ctx.t('practice.langLater')), h('p', null, h('a', { href: '#/profile/goal' }, ctx.t('practice.langChange')))] })));
    return undefined;
  }
  warmVoices();
  if (!list) return draw();
  const off = pickerLinks(ctx, el);
  const res = await draw();
  return {
    unmount() { off(); if (typeof res === 'function') res(); else if (res && typeof res.unmount === 'function') res.unmount(); },
    canLeave: res && typeof res.canLeave === 'function' ? () => res.canLeave() : undefined,
  };
}

/** The parts of the sub-path under the feature's route. @param {import('../contract.js').ViewCtx} ctx */
export const restParts = ctx => (ctx.params.rest || '').split('/').filter(Boolean);
