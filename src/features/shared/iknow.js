/* "I know this" on a new card, in every round type: B1 and Schreiben rounds, exam words and word clusters (round.js),
   clusters said aloud (clusters/view.js), speaking situations (sim-view.js) and script words (script/words.js).
   One tap (or K; ⌥K in a typed round, where K is a letter of the answer) marks the card known through
   data/known.js, the card lifts away (motion.js swap 'lift') and the round moves on. The toast offers Undo; the
   result in the round is {known: true}, which the done screens count apart from right answers. */
import { h } from '../../core/dom.js';
import { markCards } from '../../data/known.js';
import { keep } from '../../core/keyboard.js';


/**
 * The button. typed: the round has an answer field, so the key is ⌥K.
 * @param {(k: string, v?: any) => string} t @param {() => void} onClick @param {{typed?: boolean}} [o]
 */
export function knowButton(t, onClick, { typed = false } = {}) {
  return h('button', { type: 'button', class: 'btn btn-quiet pressable pr-know', hidden: true, onpointerdown: keep, onclick: onClick, 'aria-keyshortcuts': typed ? 'Alt+K' : 'K' },
    t('practice.know.btn'), h('kbd', null, typed ? '⌥K' : 'K'));
}

/**
 * The key for "I know this": K, or ⌥K in a typed round (the answer field has the focus there).
 * @param {KeyboardEvent} e @param {boolean} typed
 */
export function isKnowKey(e, typed) {
  if (e.metaKey || e.ctrlKey || e.isComposing) return false;
  const k = e.code === 'KeyK' || e.key === 'k' || e.key === 'K';
  return k && (typed ? e.altKey : !e.altKey);
}

/**
 * Mark one card known and show the toast with Undo.
 * @param {any} ctx a view ctx @param {{deck: string, id: string}} entry @param {{onUndo?: () => void}} [o]
 */
export function knowCard(ctx, entry, { onUndo } = {}) {
  const res = markCards(ctx, [entry], { spread: false });
  ctx.toast(ctx.t('practice.know.toast'), { action: ctx.t('practice.know.undo'), onAction: () => { res.undo(); onUndo?.(); ctx.toast(ctx.t('practice.know.undone')); } });
  return res;
}

/** A round result for a card marked known (counted apart from answers). @param {string} id */
export const knownResult = id => ({ id, g: 4, ok: true, first: true, ms: 0, isNew: true, known: true });
