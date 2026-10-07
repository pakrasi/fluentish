/* "Check by typing" before "I know this" on a card he only says aloud (Word clusters said aloud, speaking
   situations). "I know this" there opens this panel on the card: he types the German and Practice's grader
   (grade.js) decides.
     right                  → the caller marks the card known (iknow.js knowCard), as "I know this" always did
     wrong                  → the answer shows; nothing is marked and the card goes on as a normal new card;
                              "I knew it, typo" marks it known after all
     Mark without typing    → the old one tap, still there
     Back                   → the card as it was
   Every typed check is recorded through data/checks.js (kv known.checks, event card.checked from 'know'); a wrong one
   never touches a card. In typed rounds "I know this" needs no panel: the round's own answer is the production. */
import { h, replace, announce } from '../../core/dom.js';
import { correct as fxCorrect, wrong as fxWrong } from '../../core/motion.js';
import { langAttr, dirAttr } from '../../core/lang.js';
import { gradeAnswer } from './grade.js';
import { recordCheck } from '../../data/checks.js';
import { itemOf } from '../../domain/known.js';
export { typedItem as situationItem } from '../../domain/sim.js';
import { keep } from '../../core/keyboard.js';


/**
 * The panel. grade: the grader's data (shared/data.js loadData), loaded by the caller.
 * @param {{ctx: any, deck: string, id: string, item: any, data: () => Promise<any>,
 *   onKnown: (o: {typo: boolean, typed: boolean}) => void, onClose: () => void}} o
 *   onKnown: mark the card known (right, typo override, or without typing); onClose: back to the card, nothing marked
 */
export function typeCheck({ ctx, deck, id, item, data, onKnown, onClose }) {
  const { t } = ctx;
  let state = 'answer', alive = true;
  const input = /** @type {HTMLTextAreaElement} */ (h('textarea', { class: 'answer-input', rows: 1, lang: langAttr(), dir: dirAttr(), autocapitalize: 'off', autocomplete: 'off', spellcheck: 'false', enterkeyhint: 'go', 'aria-label': t('practice.answerLabel'), placeholder: t('practice.ph.german') }));
  input.setAttribute('autocorrect', 'off');
  const answerEl = h('div', { class: 'answer' }, input);
  const fb = h('div', { class: 'pr-fb', 'aria-live': 'polite' });
  const checkBtn = h('button', { type: 'button', class: 'btn btn-primary pressable', onpointerdown: keep, onclick: () => check() }, t('practice.typecheck.check'), h('kbd', null, 'Enter'));
  const typoBtn = h('button', { type: 'button', class: 'btn btn-quiet pressable', onpointerdown: keep, onclick: () => typo(), hidden: true }, t('practice.sort.typo'));
  const plainBtn = h('button', { type: 'button', class: 'btn btn-quiet pressable', onpointerdown: keep, onclick: () => done(false, false), 'aria-label': t('practice.typecheck.plain') },
    h('span', { class: 'kb-long' }, t('practice.typecheck.plain')), h('span', { class: 'kb-short' }, t('practice.typecheck.plainShort')));
  const backBtn = h('button', { type: 'button', class: 'btn btn-quiet pressable', onpointerdown: keep, onclick: () => close() }, t('practice.typecheck.back'), h('kbd', null, 'Esc'));
  const el = h('section', { class: 'pr-typecheck', 'aria-label': t('practice.typecheck.title') },
    h('p', { class: 'label' }, t('practice.typecheck.title')), h('p', { class: 'caption' }, t('practice.typecheck.lead')),
    answerEl, fb, h('div', { class: 'pr-typecheck-actions' }, checkBtn, typoBtn, plainBtn, backBtn));
  const itemId = itemOf(id);
  const record = (/** @type {boolean} */ ok, /** @type {boolean} */ typo) => recordCheck(ctx, { itemId, deck, mode: 'produce', ok, from: 'know', typed: true, typo });

  /** @param {boolean} typo @param {boolean} typed */
  function done(typo, typed) { if (!alive) return; alive = false; input.removeEventListener('keydown', onKey); onKnown({ typo, typed }); }
  function close() { if (!alive) return; alive = false; input.removeEventListener('keydown', onKey); onClose(); }
  async function check() {
    if (state !== 'answer' || !input.value.trim()) return;
    state = 'busy';
    let d = {};
    try { d = await data(); } catch { /* the grader works without the extras */ }
    if (!alive) return;
    const g = gradeAnswer(item, input.value, null, d);
    const ok = !!g.ok && !g.partial;
    record(ok, false);
    if (ok) {
      void fxCorrect(answerEl, { hold: 0 });
      replace(fb, h('p', { class: 'pr-res is-ok' }, t('practice.check.right')));
      announce(t('practice.typecheck.right'));
      done(false, true);
      return;
    }
    state = 'wrong';   // the field stays writable and focused, so the keyboard stays up; Enter goes on
    fxWrong(answerEl);
    replace(fb, h('p', { class: 'pr-res is-bad' }, t('practice.wrong')),
      h('p', { class: 'pr-diff answer-key', lang: langAttr(), dir: dirAttr() }, h('span', { class: 'caption' }, t('practice.rightIs')), ' ', g.right || item.model),
      h('p', { class: 'caption' }, t('practice.typecheck.notMarked')));
    checkBtn.hidden = true; plainBtn.hidden = true; typoBtn.hidden = false;
    replace(backBtn, t('practice.typecheck.goOn'), h('kbd', null, 'Enter'));
    announce(`${t('practice.wrong')}. ${t('practice.rightIs')} ${g.right || item.model}. ${t('practice.typecheck.notMarked')}`);
  }
  function typo() {
    if (state !== 'wrong') return;
    record(true, true);
    done(true, true);
  }
  /** @param {KeyboardEvent} e */
  function onKey(e) {
    e.stopPropagation();   // the card's own keys (Space, K, 1 to 4) stay out of the answer
    if (e.isComposing) return;
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (state === 'wrong') close(); else void check(); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.altKey && e.code === 'KeyT') { e.preventDefault(); typo(); }
  }
  input.addEventListener('keydown', onKey);
  return { el, focus: () => input.focus({ preventScroll: true }) };
}
