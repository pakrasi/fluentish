/* "Mark all A1 as known" (#/practice/known/<A1|A2>[?from=map]): a spot check, then one bulk mark.
   The words are the level's words he has not studied anywhere (knowledge 'unseen'; words in his rounds keep their
   own schedule) and that have no gap. First 10 of them at random, typed: the English meaning, the German word (a
   noun with its article), graded by Practice's grader (grade.js over match.js, the grading corpus rules). Nothing in
   the check is scheduled.
   2 misses or fewer: every one of the words except the ones he missed is marked known through data/known.js (one check
   each in about 60 days, spread at most about 20 a day), with Undo. More than 2: nothing is marked and the page
   offers a Quick sort of the level instead (#/practice/sort?level=…). */
import { h, replace, announce } from '../../../core/dom.js';
import { correct as fxCorrect, wrong as fxWrong, resetAnswer, swap, segments as drawSegs } from '../../../core/motion.js';
import { doneHero, leaveRound } from '../done-hero.js';
import { loadClusters, loadKnowledge } from '../clusters/data.js';
import { itemFor } from '../clusters/items.js';
import { levelWords, sample, passes, CHECK_N } from './pick.js';
import { gradeAnswer } from '../grade.js';
import { loadData } from '../data.js';
import { markWords, unmarkCards } from '../../../data/known.js';

const LEVELS = ['A1', 'A2'];
const keep = (/** @type {Event} */ e) => e.preventDefault();

/** @param {HTMLElement} el @param {import('../../contract.js').ViewCtx} ctx @param {string} level */
export async function mountCheck(el, ctx, level) {
  const { t } = ctx;
  const lv = LEVELS.includes(level) ? level : 'A1';
  const backTo = ctx.query.get('from') === 'map' ? '#/lookup/map' : '#/lookup/words?w=all';
  const page = (/** @type {any[]} */ ...kids) => h('div', { class: 'practice pr-done stack qs-check' }, ...kids);
  replace(el, page(h('h1', null, t('practice.check.title', { level: lv })), h('p', { class: 'caption' }, t('practice.sort.loading'))));
  let clusters, k, data;
  try { [clusters, k, data] = await Promise.all([loadClusters(ctx), loadKnowledge(ctx), loadData(ctx)]); } catch {
    replace(el, page(h('h1', null, t('practice.check.title', { level: lv })), h('p', null, t('practice.sort.loadFailed')),
      h('div', { class: 'pr-done-actions' }, h('a', { class: 'btn pressable', href: backTo }, t('practice.done')))));
    return;
  }
  const ids = levelWords(clusters.words, lv, id => k.get(id));
  if (!ids.length) {
    replace(el, page(h('p', { class: 'label' }, t('practice.check.label', { level: lv })), h('h1', null, t('practice.sort.none')), h('p', { class: 'lead' }, t('practice.check.none', { level: lv })),
      h('div', { class: 'pr-done-actions' }, h('a', { class: 'btn btn-primary pressable', href: backTo }, t('practice.done')))));
    return;
  }
  const n = Math.min(CHECK_N, ids.length);
  replace(el, page(
    h('p', { class: 'label' }, t('practice.check.label', { level: lv })),
    h('h1', null, t('practice.check.title', { level: lv })),
    h('p', { class: 'lead' }, t('practice.check.lead', { n: ids.length, level: lv })),
    h('p', null, t('practice.check.how', { k: n })),
    h('div', { class: 'pr-done-actions' },
      h('button', { type: 'button', class: 'btn btn-primary pressable', id: 'qc-start', onclick: () => run() }, t('practice.check.start')),
      h('a', { class: 'btn pressable', href: backTo }, t('practice.check.back')))));

  /** @type {(() => void) | null} */ let stopRun = null;
  function run() {
    const pick = sample(ids, n);
    const items = pick.map(id => itemFor(`W:${id}`, clusters.ix, clusters.c, { t, fx: clusters.fx }));
    document.body.dataset.chrome = 'off';
    document.body.classList.add('pr-in-round');
    /** @type {string[]} */ const missed = [];
    let i = 0, state = 'answer', alive = true;
    const segs = h('div', { class: 'segments', 'aria-label': t('practice.progress') });
    const count = h('span', { class: 'caption tnum' });
    const meta = h('span', { class: 'label' }, t('practice.check.label', { level: lv }));
    const task = h('p', { class: 'pr-task' });
    const prompt = h('p', { class: 'prompt', lang: 'en' });
    const input = /** @type {HTMLTextAreaElement} */ (h('textarea', { class: 'answer-input', rows: 1, lang: 'de', autocapitalize: 'off', autocomplete: 'off', spellcheck: 'false', enterkeyhint: 'go', 'aria-label': t('practice.answerLabel'), placeholder: t('practice.ph.german') }));
    input.setAttribute('autocorrect', 'off');
    const answerEl = h('div', { class: 'answer' }, input);
    const fb = h('div', { class: 'pr-fb', 'aria-live': 'polite' });
    const reveal = h('div', { class: 'reveal-answer' }, h('div', null, fb));
    const card = h('article', { class: 'card pr-card' }, h('div', { class: 'card-meta' }, meta, count), task, prompt, answerEl, reveal);
    const primary = h('button', { type: 'button', class: 'btn btn-primary pressable pr-primary', onpointerdown: keep, onclick: () => onReturn() });
    const box = h('div', { class: 'pr-round is-docked', role: 'region', 'aria-label': t('practice.check.label', { level: lv }) },
      h('div', { class: 'pr-top' }, segs, h('div', { class: 'pr-top-row' }, h('span', { class: 'caption' }), h('button', { type: 'button', class: 'btn btn-quiet pressable pr-end', onpointerdown: keep, onclick: () => quit() }, t('practice.end'), h('kbd', null, 'Esc')))),
      h('div', { class: 'pr-scroll' }, card), h('div', { class: 'card-actions pr-actions' }, primary));
    replace(el, h('h1', { class: 'sr-only' }, t('practice.check.title', { level: lv })), box);
    const vv = window.visualViewport;
    const fit = () => { box.style.height = `${vv ? vv.height : innerHeight}px`; };
    vv?.addEventListener('resize', fit); addEventListener('resize', fit); fit();
    /** @type {string[]} */ const states = pick.map(() => '');
    const segments = () => drawSegs(segs, states.map((s, j) => s || (j === i ? 'now' : '')));
    function draw() {
      const it = items[i];
      state = 'answer';
      resetAnswer(answerEl, reveal); replace(fb);
      task.textContent = it.task || '';
      prompt.textContent = it.prompt;
      count.textContent = t('practice.count', { n: i + 1, total: n });
      replace(primary, t('practice.check'), h('kbd', null, 'Enter'));
      input.value = ''; input.focus({ preventScroll: true });
      segments();
    }
    function onReturn() {
      if (state === 'feedback') { next(); return; }
      const typed = input.value.trim();
      if (!typed) return;
      const it = items[i];
      const g = gradeAnswer(it, typed, null, data);
      const ok = !!g.ok && !g.partial;
      state = 'feedback';
      states[i] = ok ? 'done' : 'miss';
      if (!ok) missed.push(pick[i]);
      replace(fb, ok ? h('p', { class: 'pr-res is-ok' }, t('practice.check.right')) : h('p', { class: 'pr-res is-bad' }, t('practice.wrong')),
        ok ? null : h('p', { class: 'pr-diff answer-key', lang: 'de' }, h('span', { class: 'caption' }, t('practice.rightIs')), ' ', it.model));
      if (ok) fxCorrect(answerEl, { hold: 0 }); else fxWrong(answerEl, { revealEl: reveal });
      reveal.classList.add('is-open');
      replace(primary, t('practice.check.next'), h('kbd', null, '↵'));
      segments();
      announce(ok ? t('practice.check.right') : `${t('practice.wrong')}. ${t('practice.rightIs')} ${it.model}`);
    }
    async function next() {
      if (!alive) return;
      i++;
      if (i >= n) { finish(); return; }
      await swap(() => draw(), { kind: 'forward', fallbackEl: card });
    }
    const onKey = (/** @type {KeyboardEvent} */ e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); onReturn(); }
      else if (e.key === 'Escape') { e.preventDefault(); quit(); }
    };
    function quit() { cleanup(); leaveRound(); ctx.go(backTo.slice(1)); }
    input.addEventListener('keydown', onKey);
    function cleanup() { if (!alive) return; alive = false; input.removeEventListener('keydown', onKey); vv?.removeEventListener('resize', fit); removeEventListener('resize', fit); }
    stopRun = cleanup;
    function finish() {
      cleanup();
      const right = n - missed.length;
      if (passes(missed.length)) {
        const res = markWords(ctx, ids.filter(id => !missed.includes(id)));
        const undo = h('button', { type: 'button', class: 'btn btn-quiet pressable', onclick: () => { const m = unmarkCards(ctx, res.entries); undo.remove(); ctx.toast(t('practice.check.undone', { n: m })); } }, t('practice.check.undo'));
        const hero = doneHero({ label: t('practice.check.label', { level: lv }), figure: res.n, of: t('practice.check.marked', { n: res.n, level: lv }),
          lines: [t('practice.check.markedLine', { right, n })] });
        replace(el, h('div', { class: 'practice pr-done stack qs-check' }, hero.el,
          h('div', { class: 'pr-done-actions' }, h('a', { class: 'btn btn-primary pressable', href: backTo, id: 'qc-done' }, t('practice.done')), undo)));
        const stop = hero.start();
        addEventListener('hashchange', stop, { once: true });
        return;
      }
      const hero = doneHero({ label: t('practice.check.failed'), figure: right, of: t('practice.check.of', { n }),
        lines: [t('practice.check.failedLead', { right, n, level: lv }), t('practice.check.sortInstead', { level: lv, n: ids.length })], atmo: false });
      replace(el, h('div', { class: 'practice pr-done stack qs-check' }, hero.el,
        h('div', { class: 'pr-done-actions' },
          h('a', { class: 'btn btn-primary pressable', href: `#/practice/sort?level=${lv}&from=${ctx.query.get('from') === 'map' ? 'map' : 'lookup'}`, id: 'qc-sort' }, t('practice.check.sort', { level: lv })),
          h('a', { class: 'btn pressable', href: backTo }, t('practice.done')))));
      const stop = hero.start();
      addEventListener('hashchange', stop, { once: true });
    }
    // test hook (localhost only): the browser checks read the current card
    if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) /** @type {any} */ (window).__check = { get model() { return items[i]?.model; } };
    draw();
  }
  return () => { stopRun?.(); document.body.dataset.chrome = 'on'; document.body.classList.remove('pr-in-round'); };
}
