/* Conversation practice (round 4, lane L4): open conversations in the study language with Claude, written, with
   feedback at the end that turns his real mistakes into review cards. Owns
     #/practice/conversation                    setup: mode, topic or scenario, what is sent, the month's spend (setup.js)
     #/practice/conversation/c/<id>             the conversation (chat.js), full screen
     #/practice/conversation/c/<id>/feedback    the feedback card (feedback.js)
   Pure rules: domain/conversation.js and domain/conversation-feedback.js. Prompts: services/prompts/conversation.js.
   Storage: data.js. Transcripts stay on this device. */
import { h, replace } from '../../core/dom.js';
import { backLink } from '../../core/ui.js';
import { practicePage, restParts } from '../shared/page.js';
import { closeSheets } from '../shared/textview.js';
import { getSession, getTranscript } from './data.js';

/** @param {HTMLElement} el @param {import('../contract.js').ViewCtx} ctx */
export function mount(el, ctx) {
  return practicePage(el, ctx, { list: false }, async () => {
    const res = await view(el, ctx, restParts(ctx));
    return {
      unmount() { closeSheets(); if (typeof res === 'function') res(); else res?.unmount?.(); },
      canLeave: typeof res?.canLeave === 'function' ? () => res.canLeave() : undefined,
    };
  });
}

/** @param {HTMLElement} el @param {import('../contract.js').ViewCtx} ctx @param {string[]} parts @returns {Promise<any>} */
async function view(el, ctx, parts) {
  const [a, id, b] = parts;
  if (!a) return (await import('./setup.js')).mountSetup(el, ctx);
  const s = a === 'c' && id ? getSession(ctx.store, id) : null;
  if (!s || s.deletedAt || (!getTranscript(ctx.store, id) && b !== 'feedback')) {
    replace(el, h('div', { class: 'practice stack cv' },
      backLink({ href: '#/practice/conversation', label: ctx.t('conv.title') }),
      h('div', { class: 'page-head' }, h('h1', null, ctx.t('conv.gone'))),
      h('a', { class: 'btn pressable', href: '#/practice/conversation' }, ctx.t('conv.toSetup'))));
    return undefined;
  }
  if (b === 'feedback') return (await import('./feedback.js')).mountFeedback(el, ctx, s);
  return (await import('./chat.js')).mountChat(el, ctx, s);
}
