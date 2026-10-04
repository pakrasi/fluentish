/* Schreiben: three tasks, 60 minutes, word counts, no spell check. Every keystroke is saved on the device. */
import { h, replace } from '../../core/dom.js';
import { wordCount } from '../../domain/grade.js';
import { draft, saveDraft, submitAttempt, writingsOf } from './data.js';
import { clockBar, backLink, confirmPanel } from './parts.js';
import { fmt } from './timer.js';

const KEYS = ['aufgabe1', 'aufgabe2', 'aufgabe3'];

/** @param {HTMLElement} el @param {any} ctx @param {{ exam: any, n: number, ex: any, def: any }} o */
export function runSchreiben(el, ctx, { exam, n, ex, def }) {
  const { store, t } = ctx;
  document.body.dataset.chrome = 'off';
  const S = ex.schreiben;
  /** @type {Record<string, string>} */ const texts = { ...(draft(store, n, 'schreiben')?.answers || {}) };
  const cover = h('div', { class: 'ex-cover', hidden: true });
  const over = h('p', { class: 'ex-over', hidden: true, role: 'status' });
  const body = h('div');
  const confirmSlot = h('div');
  /** @type {Record<string, HTMLElement>} */ const jumps = {};
  /** @type {Record<string, HTMLElement>} */ const counts = {};
  const upd = (/** @type {string} */ k) => {
    const c = wordCount(texts[k]), target = S[k].words, met = c >= target * 0.85;
    counts[k].textContent = t('exam.de.words', { n: c, target });
    counts[k].classList.toggle('is-met', met);
    jumps[k].textContent = `Aufgabe ${k.slice(-1)} · ${c}/${target}`;
    jumps[k].classList.toggle('is-met', met);
  };
  let saveT = /** @type {any} */ (null);
  const area = (/** @type {string} */ k) => {
    const ta = /** @type {HTMLTextAreaElement} */ (h('textarea', {
      class: 'ex-write', 'aria-label': `Text für Aufgabe ${k.slice(-1)}`, spellcheck: 'false', autocorrect: 'off', autocapitalize: 'sentences', autocomplete: 'off', lang: 'de',
      oninput: (/** @type {Event} */ e) => {
        texts[k] = /** @type {HTMLTextAreaElement} */ (e.target).value;
        upd(k);
        clearTimeout(saveT);                       // at most every 300 ms while typing; always on blur and pagehide
        saveT = setTimeout(() => saveDraft(store, n, 'schreiben', { answers: { ...texts } }), 300);
      },
      onblur: () => { clearTimeout(saveT); saveDraft(store, n, 'schreiben', { answers: { ...texts } }); },
    }));
    ta.value = texts[k] || '';
    counts[k] = h('p', { class: 'ex-wc caption tnum', 'aria-live': 'off' });
    return h('div', null, ta, counts[k]);
  };
  const task = (/** @type {string} */ k, /** @type {number} */ i, /** @type {any[]} */ ...parts) => h('section', { class: 'ex-block', id: `aufgabe${i}` },
    h('p', { class: 'label' }, `Aufgabe ${i} · ${S[k].minutes} Minuten, ca. ${S[k].words} Wörter`), ...parts, area(k));
  for (const k of KEYS) jumps[k] = h('button', { type: 'button', class: 'chip pressable', onclick: () => document.getElementById(`aufgabe${k.slice(-1)}`)?.scrollIntoView({ block: 'start' }) });
  replace(body,
    h('p', { class: 'ex-instr' }, t('exam.de.schreibenIntro')),
    h('div', { class: 'ex-jumps chips' }, KEYS.map(k => jumps[k])),
    task('aufgabe1', 1, h('p', null, S.aufgabe1.situation), h('ul', { class: 'ex-points' }, S.aufgabe1.points.map((/** @type {string} */ p) => h('li', null, p))), h('p', { class: 'caption' }, t('exam.de.a1hint'))),
    task('aufgabe2', 2, h('p', null, S.aufgabe2.situation), h('blockquote', { class: 'ex-quote' }, S.aufgabe2.quote), h('p', null, S.aufgabe2.instruction)),
    task('aufgabe3', 3, h('p', null, S.aufgabe3.situation), h('p', { class: 'caption' }, `An: ${S.aufgabe3.addressee}`)),
    h('div', { class: 'ex-nav' }, h('span', { class: 'ex-nav-grow' }), h('button', { type: 'button', class: 'btn btn-primary pressable', onclick: () => askSubmit() }, t('exam.de.submit'))),
    confirmSlot);
  KEYS.forEach(upd);
  const clock = clockBar({
    ctx, n, module: 'schreiben', minutes: def.minutes,
    onChange: (p, leftMs) => {
      cover.hidden = !p; body.hidden = p;
      if (p) replace(cover, h('div', { class: 'ex-cover-card' }, h('h2', null, t('exam.de.paused')),
        h('p', { class: 'caption tnum' }, leftMs > 0 ? t('exam.de.left', { t: fmt(leftMs / 1000) }) : t('exam.de.timeUp')),
        h('button', { type: 'button', class: 'btn btn-primary pressable', onclick: () => clock.resume() }, t('exam.de.continue'))));
      if (leftMs < 0) { over.hidden = false; over.textContent = t('exam.de.overtime', { t: fmt(-leftMs / 1000) }); }
    },
  });
  let submitting = false;
  const askSubmit = () => {
    saveDraft(store, n, 'schreiben', { answers: { ...texts } });
    const leftMs = clock.left();
    replace(confirmSlot, confirmPanel({
      lang: 'de', title: t('exam.de.submitQ', { module: 'Schreiben' }),
      lines: [...KEYS.map((k, i) => t('exam.de.taskWords', { i: i + 1, n: wordCount(texts[k]), target: S[k].words })), leftMs > 0 ? t('exam.de.left', { t: fmt(leftMs / 1000) }) : t('exam.de.timeUp'), t('exam.de.final')],
      yes: t('exam.de.submit'), no: t('exam.de.keepGoing'), onNo: () => replace(confirmSlot),
      onYes: async () => {
        if (submitting) return;
        submitting = true;
        try {
          const c = clock.clock;
          const rec = await submitAttempt(ctx, { exam, n, module: 'schreiben', clock: c, score: null, maxScore: 100, writings: writingsOf(texts) });
          clock.stop(false);   // only once the attempt is stored
          ctx.go(`/exam/${n}/schreiben/review/${rec.id}`, { replace: true });
        } catch (e) { submitting = false; console.error(e); ctx.toast(t('exam.submitFailed')); }
      },
    }));
    confirmSlot.scrollIntoView({ block: 'nearest' });
  };
  const flushText = () => { clearTimeout(saveT); if (!submitting) saveDraft(store, n, 'schreiben', { answers: { ...texts } }); };
  const onVis = () => { if (document.visibilityState === 'hidden') flushText(); };
  addEventListener('pagehide', flushText);
  document.addEventListener('visibilitychange', onVis);
  replace(el, h('div', { class: 'ex-run', lang: 'de' },
    h('header', { class: 'ex-runhead' }, backLink(`#/exam/${n}`, t('exam.backTest', { n })),
      h('div', { class: 'ex-runhead-end' }, clock.el, h('button', { type: 'button', class: 'btn btn-primary pressable ex-submit-top', onclick: () => askSubmit() }, t('exam.de.submit')))),
    over, h('h1', { class: 'ex-run-title' }, 'Schreiben', h('span', { class: 'caption' }, ` · ${ex.topic}`)), cover, body));
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
