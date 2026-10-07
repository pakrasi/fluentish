/* A writing module (Goethe B1: Schreiben, three tasks, 60 minutes): the tasks of the exam definition with their
   word targets, no spell check. Every keystroke is saved on the device. */
import { h, replace } from '../../core/dom.js';
import { wordCount } from '../../domain/grade.js';
import { at } from '../../domain/examdef.js';
import { draft, saveDraft, submitAttempt, writingsOf, sectionOf } from './data.js';
import { clockBar, backLink, confirmPanel } from './parts.js';
import { fmt } from './timer.js';
import { langAttr, dirAttr } from '../../core/lang.js';

/** @param {HTMLElement} el @param {any} ctx @param {{ exam: any, n: number, ex: any, def: any }} o */
export function runSchreiben(el, ctx, { exam, n, ex, def }) {
  const { store, t } = ctx;
  const tx = exam.tx;
  document.body.dataset.chrome = 'off';
  const module = def.id;
  const sec = sectionOf(exam, module);
  const KEYS = sec.parts.map((/** @type {any} */ p) => p.id);
  /** @type {Record<string, any>} */ const S = Object.fromEntries(sec.parts.map((/** @type {any} */ p) => [p.id, at(ex, p.task)]));
  /** @type {Record<string, string>} */ const texts = { ...(draft(store, n, module)?.answers || {}) };
  const cover = h('div', { class: 'ex-cover', hidden: true });
  const over = h('p', { class: 'ex-over', hidden: true, role: 'status' });
  const body = h('div');
  const confirmSlot = h('div');
  /** @type {Record<string, HTMLElement>} */ const jumps = {};
  /** @type {Record<string, HTMLElement>} */ const counts = {};
  const upd = (/** @type {string} */ k) => {
    const c = wordCount(texts[k]), target = S[k].words, met = c >= target * 0.85;
    counts[k].textContent = tx('words', { n: c, target });
    counts[k].classList.toggle('is-met', met);
    jumps[k].textContent = tx('taskJump', { i: KEYS.indexOf(k) + 1, n: c, target });
    jumps[k].classList.toggle('is-met', met);
  };
  let saveT = /** @type {any} */ (null);
  // with the keyboard up the header stays at the top of the visible screen (.kb-stick) and shows the word count of
  // the task being written (its own line is under the field, behind the keyboard)
  const kbWc = h('span', { class: 'caption tnum ex-kbwc', 'aria-hidden': 'true' });
  const area = (/** @type {string} */ k) => {
    const ta = /** @type {HTMLTextAreaElement} */ (h('textarea', {
      class: 'ex-write', 'aria-label': tx('taskArea', { i: KEYS.indexOf(k) + 1 }), spellcheck: 'false', autocorrect: 'off', autocapitalize: 'sentences', autocomplete: 'off', lang: langAttr(), dir: dirAttr(),
      oninput: (/** @type {Event} */ e) => {
        texts[k] = /** @type {HTMLTextAreaElement} */ (e.target).value;
        upd(k);
        kbWc.textContent = jumps[k].textContent;
        clearTimeout(saveT);                       // at most every 300 ms while typing; always on blur and pagehide
        saveT = setTimeout(() => saveDraft(store, n, module, { answers: { ...texts } }), 300);
      },
      onfocus: () => { kbWc.textContent = jumps[k].textContent; },
      onblur: () => { clearTimeout(saveT); saveDraft(store, n, module, { answers: { ...texts } }); },
    }));
    ta.value = texts[k] || '';
    counts[k] = h('p', { class: 'ex-wc caption tnum', 'aria-live': 'off' });
    return h('div', null, ta, counts[k]);
  };
  /** The task's fields as the definition lists them, then its hint. @param {any} part */
  const fields = part => {
    const x = S[part.id];
    const one = (/** @type {string} */ f) => (f === 'situation' ? h('p', null, x.situation)
      : f === 'points' ? h('ul', { class: 'ex-points' }, (x.points || []).map((/** @type {string} */ p) => h('li', null, p)))
        : f === 'quote' ? h('blockquote', { class: 'ex-quote' }, x.quote)
          : f === 'instruction' ? h('p', null, x.instruction)
            : f === 'addressee' ? h('p', { class: 'caption' }, tx('addressee', { to: x.addressee })) : null);
    return [...(part.fields || ['situation']).map(one), part.hint ? h('p', { class: 'caption' }, tx(part.hint)) : null];
  };
  const task = (/** @type {any} */ part, /** @type {number} */ i) => h('section', { class: 'ex-block', id: part.id },
    h('p', { class: 'label' }, tx('taskLabel', { i, min: S[part.id].minutes, words: S[part.id].words })), ...fields(part), area(part.id));
  KEYS.forEach((/** @type {string} */ k) => { jumps[k] = h('button', { type: 'button', class: 'chip pressable', onclick: () => document.getElementById(k)?.scrollIntoView({ block: 'start' }) }); });
  replace(body,
    h('p', { class: 'ex-instr' }, tx(sec.intro)),
    h('div', { class: 'ex-jumps chips' }, KEYS.map((/** @type {string} */ k) => jumps[k])),
    ...sec.parts.map((/** @type {any} */ p, /** @type {number} */ i) => task(p, i + 1)),
    h('div', { class: 'ex-nav' }, h('span', { class: 'ex-nav-grow' }), h('button', { type: 'button', class: 'btn btn-primary pressable', onclick: () => askSubmit() }, tx('submit'))),
    confirmSlot);
  KEYS.forEach(upd);
  const clock = clockBar({
    ctx, tx, n, module, minutes: def.minutes,
    onChange: (p, leftMs) => {
      cover.hidden = !p; body.hidden = p;
      if (p) replace(cover, h('div', { class: 'ex-cover-card' }, h('h2', null, tx('paused')),
        h('p', { class: 'caption tnum' }, leftMs > 0 ? tx('left', { t: fmt(leftMs / 1000) }) : tx('timeUp')),
        h('button', { type: 'button', class: 'btn btn-primary pressable', onclick: () => clock.resume() }, tx('continue'))));
      if (leftMs < 0) { over.hidden = false; over.textContent = tx('overtime', { t: fmt(-leftMs / 1000) }); }
    },
  });
  let submitting = false;
  const askSubmit = () => {
    saveDraft(store, n, module, { answers: { ...texts } });
    const leftMs = clock.left();
    replace(confirmSlot, confirmPanel({
      lang: langAttr(), dir: dirAttr(), title: tx('submitQ', { module: def.name }),
      lines: [...KEYS.map((/** @type {string} */ k, /** @type {number} */ i) => tx('taskWords', { i: i + 1, n: wordCount(texts[k]), target: S[k].words })), leftMs > 0 ? tx('left', { t: fmt(leftMs / 1000) }) : tx('timeUp'), tx('final')],
      yes: tx('submit'), no: tx('keepGoing'), onNo: () => replace(confirmSlot),
      onYes: async () => {
        if (submitting) return;
        submitting = true;
        try {
          const c = clock.clock;
          const rec = await submitAttempt(ctx, { exam, n, module, clock: c, score: null, maxScore: def.max, writings: writingsOf(texts, sec) });
          clock.stop(false);   // only once the attempt is stored
          ctx.go(`/exam/${n}/${module}/review/${rec.id}`, { replace: true });
        } catch (e) { submitting = false; console.error(e); ctx.toast(tx('submitFailed')); }
      },
    }));
    confirmSlot.scrollIntoView({ block: 'nearest' });
  };
  const flushText = () => { clearTimeout(saveT); if (!submitting) saveDraft(store, n, module, { answers: { ...texts } }); };
  const onVis = () => { if (document.visibilityState === 'hidden') flushText(); };
  addEventListener('pagehide', flushText);
  document.addEventListener('visibilitychange', onVis);
  replace(el, h('div', { class: 'ex-run', lang: langAttr(), dir: dirAttr() },
    h('header', { class: 'ex-runhead kb-stick' }, backLink(`#/exam/${n}`, t('exam.backTest', { n })),
      h('div', { class: 'ex-runhead-end' }, kbWc, clock.el, h('button', { type: 'button', class: 'btn btn-primary pressable ex-submit-top', onclick: () => askSubmit() }, tx('submit')))),
    over, h('h1', { class: 'ex-run-title' }, def.name, h('span', { class: 'caption' }, ` · ${ex.topic}`)), cover, body));
  return {
    unmount() {
      flushText();
      removeEventListener('pagehide', flushText);
      document.removeEventListener('visibilitychange', onVis);
      clock.stop(true);   // a no-op after a submit (stopped there); otherwise pauses and keeps the draft
      document.body.dataset.chrome = 'on';
    },
  };
}
