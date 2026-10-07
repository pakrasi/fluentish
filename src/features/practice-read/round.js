/* Reading: the review round of the items he saved while reading (#/practice/round?kind=read). Full screen, Practice's
   round layout and its runner (features/shared/session.js: queue, reinsertion of misses, FSRS through domain/fsrs.js)
   and grader (shared/grade.js over match.js), so the grading corpus rules hold. A word is learnt in the sentence he
   met it in: his sentence with the word gapped and the meaning as the hint; from the second review on, every other
   time the meaning alone (type the word; a noun with its article). A separable verb or a phrase is asked by its
   meaning. Its size: Recommended (due first, then new items within today's share), or the round size picker's
   choice (?size=). Cards live in the reading deck ('de:read'); a review appends card.reviewed like every deck. */
import { h, replace, announce } from '../../core/dom.js';
import { correct as fxCorrect, wrong as fxWrong, resetAnswer, segments, skip as skipHold, haptic } from '../../core/motion.js';
import { langAttr, dirAttr } from '../../core/lang.js';
import * as RS from '../../domain/roundsize.js';
import { todayBudget } from '../../domain/allowance.js';
import { gradeAnswer } from '../shared/grade.js';
import * as S from '../shared/session.js';
import { newDay } from '../shared/compose.js';
import { tz } from '../shared/data.js';
import { addActivity } from '../shared/data.js';
import { doneHero } from '../shared/done-hero.js';
import { checkMark } from '../shared/check-mark.js';
import * as R from '../shared/read-data.js';
import * as L from './logic.js';
import { language } from './load.js';
import { keep, fitToKeyboard } from '../../core/keyboard.js';


/** @param {HTMLElement} el @param {import('../contract.js').ViewCtx} ctx */
export async function mountRound(el, ctx) {
  const { t, store } = ctx;
  document.body.dataset.chrome = 'off';
  document.body.classList.add('pr-in-round');
  const restore = () => { document.body.dataset.chrome = 'on'; document.body.classList.remove('pr-in-round'); };
  const Lg = await language(ctx);
  const deck = Lg.deck;
  const c = ctx.clock.ctx();
  const settings = ctx.settings();
  const backTo = '#/practice/read';
  let b = null;
  try { b = todayBudget({ store, c, settings }); } catch { b = null; }
  const newLeft = R.readNewLeft(/** @type {any} */ (b));
  const bk = R.readBuckets(store, c, deck, newLeft);
  const sized = RS.parseSize(ctx.query.get('size'));
  const ids = c.phase === 'day' ? [] : sized && sized !== 'rec' ? RS.pick(bk, sized).ids : [...bk.due, ...bk.fresh.slice(0, newLeft)].slice(0, R.ROUND);
  if (!ids.length) {
    replace(el, h('div', { class: 'practice pr-done stack' }, h('p', { class: 'label' }, t('read.round.title')),
      h('h1', null, t('read.round.none')), h('div', { class: 'pr-done-actions' }, h('a', { class: 'btn btn-primary pressable', href: backTo }, t('read.toLibrary')))));
    return restore;
  }
  const ws = R.savedWords(store);
  const cards = () => store.cards(deck) || {};

  /** The round item of a saved entry. @param {string} id */
  function itemFor(id) {
    const w = ws[id];
    const cx = R.contextOf(store, id)[0] || null;
    const reps = cards()[id]?.reps || 0;
    const g = L.gapIn(cx, reps);
    const head = w.head || w.lemma;
    const art = /^(der|die|das)\s/i.exec(head)?.[1]?.toLowerCase() || null;
    if (g && cx) {
      const surface = cx.de.slice(g.at, g.at + g.len);
      return { id, kind: 'word', area: 'words', origin: 'read', prompt: g.gapped, promptLang: Lg.lang, gap: true, literal: true, loose: true, anywhere: false, strict: [], accept: [surface],
        model: cx.de, gloss: w.gloss, head, task: null, answer: surface };
    }
    const accept = [head];
    return { id, kind: 'word', area: 'words', origin: 'read', prompt: w.gloss || head, promptLang: 'en', gap: false, literal: true, anywhere: false, strict: [], accept, model: head, gloss: null, head,
      task: art ? t('read.round.withArticle') : w.kind === 'phrase' ? t('read.round.phrase') : t('read.round.type'), answer: head };
  }
  /** @type {Map<string, any>} */ const byId = new Map(ids.map(id => [id, itemFor(id)]));
  const round = /** @type {any} */ (S.startRound(ids, { kind: 'read' }, c.today, Date.now()));
  round.deck = deck;
  const day = newDay(c.today);
  const t0 = performance.now();

  // ---------- layout (Practice's round classes) ----------
  const segs = h('div', { class: 'segments', 'aria-label': t('practice.progress') });
  const count = h('span', { class: 'caption tnum' });
  const endBtn = h('button', { type: 'button', class: 'btn btn-quiet pressable pr-end', onpointerdown: keep, onclick: () => end() }, t('practice.end'));
  const meta = h('span', { class: 'label' });
  const promptBox = h('div', { class: 'pr-promptbox' });
  const input = /** @type {HTMLTextAreaElement} */ (h('textarea', { class: 'answer-input', rows: 1, lang: langAttr(), dir: dirAttr(), autocapitalize: 'off', autocomplete: 'off', spellcheck: 'false', enterkeyhint: 'go', 'aria-label': t('practice.answerLabel') }));
  input.setAttribute('autocorrect', 'off');
  const answerEl = h('div', { class: 'answer' }, input, checkMark());
  const fb = h('div', { class: 'pr-fb', 'aria-live': 'polite' });
  const reveal = h('div', { class: 'reveal-answer' }, h('div', null, fb));
  const cardEl = h('article', { class: 'card pr-card' }, h('div', { class: 'card-meta' }, meta), promptBox, answerEl, reveal);
  const secondary = h('button', { type: 'button', class: 'btn btn-quiet pressable', onpointerdown: keep, onclick: () => showMe() }, t('practice.showMe'));
  const primary = h('button', { type: 'button', class: 'btn btn-primary pressable pr-primary', onpointerdown: keep, onclick: () => onReturn() });
  // docked like every round (the actions sit on the keyboard), unless he chose the simple input layout
  const docked = !ctx.settings().practice.simpleInput;
  const box = h('div', { class: ['pr-round', docked ? 'is-docked' : 'is-flow'], role: 'region', 'aria-label': t('read.round.title'), 'data-title': t('read.title') },
    h('div', { class: 'pr-top' }, segs, h('div', { class: 'pr-top-row' }, count, endBtn)), h('div', { class: 'pr-scroll' }, cardEl), h('div', { class: 'card-actions pr-actions' }, secondary, primary));
  replace(el, h('h1', { class: 'sr-only' }, t('read.round.title')), box);
  const unfit = docked ? fitToKeyboard(box) : () => {};
  // the router focuses the page's h1 after mount; in a round the answer field keeps the focus (and the keyboard)
  el.querySelector('h1')?.addEventListener('focus', () => input.focus({ preventScroll: true }));

  let state = 'answer', revealed = false, cardT0 = 0, holding = false;
  /** @type {any} */ let entry = null;

  function draw() {
    entry = S.current(round, byId, cards());
    if (!entry) { finish(); return; }
    const it = entry.item;
    state = 'answer'; revealed = false; cardT0 = performance.now();
    resetAnswer(answerEl, reveal); replace(fb);
    replace(meta, entry.isNew ? h('span', { class: 'pr-newtag' }, t('practice.new')) : t('practice.review'), ` · ${t('read.round.from')}`);
    const gapAt = String(it.prompt).indexOf('___');
    replace(promptBox,
      it.task ? h('p', { class: 'pr-task' }, it.task) : null,
      h('p', { class: 'prompt', lang: it.promptLang === 'en' ? 'en' : langAttr() }, gapAt >= 0 ? [it.prompt.slice(0, gapAt), h('span', { class: 'pr-gap' }, h('span', { class: 'sr-only' }, t('read.round.gap'))), it.prompt.slice(gapAt + 3)] : it.prompt),
      it.gloss ? h('p', { class: 'prompt-hint' }, it.gloss) : null);
    input.value = ''; input.placeholder = it.gap ? t('practice.ph.gap') : t('practice.ph.german');
    secondary.hidden = false;
    primary.textContent = t('practice.check');
    segments(segs, S.dots(round));
    count.textContent = t('practice.count', { n: Math.min(round.i + 1, round.queue.length), total: round.queue.length });
    input.focus({ preventScroll: true });
  }
  function onReturn() {
    if (holding) { skipHold(); return; }
    if (state === 'feedback') { next(); return; }
    const typed = input.value.trim();
    if (!typed) return;
    const g = gradeAnswer(entry.item, typed, null, { nouns: Lg.nouns, lexicon: Lg.lexicon });
    record({ ok: g.ok && !g.partial, umlaut: !!g.umlautMiss?.length, capSlip: !!g.capMiss?.length, typo: !!g.typos?.length, partial: !!g.partial });
    if (g.ok) {
      state = 'feedback';
      primary.textContent = t('practice.next');
      secondary.hidden = true;
      if (g.umlautMiss.length || g.capMiss.length || g.typos.length) { replace(fb, h('p', { class: 'pr-res is-warn' }, t('practice.right.typo')), h('p', { class: 'answer-key', lang: langAttr(), dir: dirAttr() }, entry.item.answer)); reveal.classList.add('is-open'); }
      holding = true;
      fxCorrect(answerEl, { hold: 420 }).then(() => { holding = false; if (state === 'feedback' && !fb.childNodes.length) next(); });
    } else showRight(typed);
  }
  function showMe() { if (state !== 'answer') return; revealed = true; record({ ok: false, revealed: true }); showRight(''); }
  /** @param {string} typed */
  function showRight(typed) {
    const it = entry.item;
    state = 'feedback';
    replace(fb, typed ? h('p', { class: 'pr-res is-bad' }, t('practice.wrong')) : null,
      h('p', { class: 'answer-key', lang: langAttr(), dir: dirAttr() }, it.answer),
      it.gap ? h('p', { class: 'caption', lang: langAttr(), dir: dirAttr() }, it.model) : null,
      it.head !== it.answer ? h('p', { class: 'caption', lang: langAttr(), dir: dirAttr() }, it.head) : null);
    if (typed) fxWrong(answerEl, /** @type {any} */ ({ revealEl: reveal })); else reveal.classList.add('is-open');
    primary.textContent = t('practice.next');
    secondary.hidden = true;
    announce(`${t('practice.rightIs')} ${it.answer}`);
  }
  /** Schedule the answer (the runner) and save the card and its event. @param {{ok: boolean, revealed?: boolean, umlaut?: boolean, capSlip?: boolean, typo?: boolean, partial?: boolean}} o */
  function record(o) {
    const ms = performance.now() - cardT0;
    const res = S.answer({ round, entry, o: { ...o, ms, revealed: !!o.revealed || revealed }, cards: cards(), day, c, forecast: () => 0, now: Date.now(), tz: tz() });
    if (res.rec) {
      store.putCards(deck, [[entry.item.id, res.rec]]);
      if (res.event) store.append('card.reviewed', res.event);
    }
    segments(segs, S.dots(round, true));
    if (o.ok) haptic();
  }
  function next() {
    if (!S.advance(round)) { finish(); return; }
    draw();
  }
  function finish() {
    cleanup();
    const sum = S.summary(round, byId);
    const news = round.results.filter((/** @type {any} */ r) => r.isNew && r.first).length;
    addActivity(store, c.today, { minutes: Math.min(30, (performance.now() - t0) / 60000), rounds: 0, split: { review: Math.max(0, sum.total - news), new: news } });
    R.writeStats(store, deck, c.today, Math.max(0, R.readBuckets(store, c, deck, Infinity).fresh.length));
    const list = h('ul', { class: 'sc-wdone rd-wdone', lang: langAttr(), dir: dirAttr() }, [...new Set(round.results.filter((/** @type {any} */ r) => r.first).map((/** @type {any} */ r) => r.id))].map((id, k) => {
      const ok = round.results.find((/** @type {any} */ r) => r.id === id && r.first)?.ok;
      return h('li', { class: ['sc-wdone-w', ok ? 'is-ok' : 'is-miss'], style: { '--i': String(Math.min(k, 12)) } }, byId.get(id)?.head || id,
        h('span', { class: 'sr-only' }, ok ? ` (${t('read.round.gotIt')})` : ` (${t('read.round.again')})`));
    }));
    const hero = doneHero({ label: t('read.round.title'), figure: sum.right, of: t('practice.ofRight', { n: sum.total }), lines: [t('read.round.after')], data: list });
    replace(el, h('div', { class: 'practice pr-done stack', 'data-title': t('read.title') }, hero.el,
      h('div', { class: 'pr-done-actions' }, h('a', { class: 'btn btn-primary pressable', href: backTo }, t('read.toLibrary')))));
    const stopHero = hero.start();
    requestAnimationFrame(() => list.classList.add('is-in'));
    addEventListener('hashchange', stopHero, { once: true });
  }
  function end() { cleanup(); location.hash = backTo; }
  const onKey = (/** @type {KeyboardEvent} */ e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); onReturn(); }
    else if (e.key === 'Escape') { e.preventDefault(); end(); }
  };
  input.addEventListener('keydown', onKey);
  function cleanup() { input.removeEventListener('keydown', onKey); unfit(); }
  draw();
  return () => { cleanup(); restore(); };
}
