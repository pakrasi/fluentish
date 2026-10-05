/* Script mode: the words round (#/practice/round?kind=script:<id>, SCRIPT-UX §3.10). Full screen, Practice's round
   layout. A word he marked is learnt in the sentence he will say it in: his sentence with the word gapped and its
   meaning as the hint; from the second review on, every other time the meaning alone (type the word, a noun with its
   article). Grading is Practice's (grade.js over match.js), so the grading corpus rules hold. Scheduling is FSRS:
   list words he already had stay in deck 'b1' under their W: id; the rest live in deck 'script', device-only.
   kind=script:words reviews the words of deleted scripts (meaning only). */
import { h, replace, announce } from '../../../core/dom.js';
import { correct as fxCorrect, wrong as fxWrong, resetAnswer, segments, skip as skipHold, haptic } from '../../../core/motion.js';
import * as FS from '../../../domain/fsrs.js';
import * as RD from '../../../domain/b1ready.js';
import { gradeAnswer } from '../grade.js';
import * as St from './store.js';
import { lexicon } from './lexicon.js';
import { words as wordState, fsCtx, newAllowed, wordBuckets } from './plan.js';
import * as RS from '../../../domain/roundsize.js';
import { tokenize } from './parse.js';
import { checkMark } from './ui.js';
import { addActivity } from '../data.js';
import { todayBudget } from '../plan.js';
import { doneHero } from '../done-hero.js';
import { swap } from '../../../core/motion.js';
import { knowButton, isKnowKey, knowCard } from '../iknow.js';

const ROUND = 12;
const keep = (/** @type {Event} */ e) => e.preventDefault();

/** @param {HTMLElement} el @param {import('../../contract.js').ViewCtx} ctx */
export async function mountWords(el, ctx) {
  const { t, store } = ctx;
  const kind = String(ctx.query.get('kind') || '');
  const sid = kind.slice('script:'.length);
  const orphans = sid === 'words';
  const script = orphans ? null : St.get(store, sid);
  const backTo = script ? `#/practice/scripts/${script.id}` : '#/practice/scripts';
  document.body.dataset.chrome = 'off';
  document.body.classList.add('pr-in-round');
  const restore = () => { document.body.dataset.chrome = 'on'; document.body.classList.remove('pr-in-round'); };
  if (!orphans && !script) { ctx.go('/practice/scripts', { replace: true }); return restore; }
  const L = await lexicon(ctx);
  const c = ctx.clock.ctx();
  const cards = St.cardOf(store);

  // ---------- the queue ----------
  /** @type {Map<string, any>} */ const info = new Map();
  if (script) {
    const sents = new Map(script.sections.flatMap((/** @type {any} */ s) => s.sentences.map((/** @type {any} */ x) => [x.id, { x, s }])));
    for (const m of script.marks || []) if (m.gloss && !info.has(m.cardId)) { const w = sents.get(m.sentenceId); info.set(m.cardId, { ...m, sentence: w?.x.de || '', section: w?.s.title || '' }); }
  } else {
    for (const [id, w] of Object.entries(store.get(St.WORDS, {}) || {})) info.set(id, { ...w, cardId: id, sentence: '', surface: w.lemma });
  }
  let ids;
  if (script) {
    const ws = wordState(script, cards, c);
    // new script words share the B1 day's new items and stop when the clock allows none (audit P1-6)
    let dayLeft = Infinity;
    try { dayLeft = todayBudget({ store, c, settings: ctx.settings() }).newLeft; } catch { /* no budget: the per-script cap holds */ }
    const allowed = newAllowed(script, St.progress(store, script.id), c.today, { newItems: c.newItems !== false, dayLeft });
    // the round size picker's choice (picker.js, domain/roundsize.js): a custom size or all of the script's words
    const sized = RS.parseSize(ctx.query.get('size'));
    ids = sized && sized !== 'rec' ? RS.pick(wordBuckets(script, cards, c, allowed), sized).ids
      : [...ws.due.sort((a, b) => String(cards(a)?.rec?.due).localeCompare(String(cards(b)?.rec?.due))), ...ws.fresh.slice(0, allowed)].slice(0, ROUND);
  } else {
    ids = [...info.keys()].filter(id => { const r = cards(id)?.rec; return r && r.reps && RD.isDue(r, c.today, c); }).slice(0, ROUND);
  }
  if (!ids.length) {
    replace(el, h('div', { class: 'practice pr-done stack' }, h('p', { class: 'label' }, t('practice.script.words.title')),
      h('h1', null, t('practice.script.words.none')), h('div', { class: 'pr-done-actions' }, h('a', { class: 'btn btn-primary pressable', href: backTo }, t('practice.script.back')))));
    return restore;
  }
  /** @type {{id: string, again: number}[]} */ const queue = ids.map(id => ({ id, again: 0 }));
  let i = 0, right = 0, firstTotal = ids.length;
  /** @type {Record<string, boolean>} */ const firstOk = {};
  const t0 = performance.now();

  // ---------- layout (Practice's round classes) ----------
  const segs = h('div', { class: 'segments', 'aria-label': t('practice.progress') });
  const count = h('span', { class: 'caption tnum' });
  const endBtn = h('button', { type: 'button', class: 'btn btn-quiet pressable pr-end', onpointerdown: keep, onclick: () => end() }, t('practice.end'));
  const meta = h('span', { class: 'label' });
  const promptBox = h('div', { class: 'pr-promptbox' });
  const input = /** @type {HTMLTextAreaElement} */ (h('textarea', { class: 'answer-input', rows: 1, lang: 'de', autocapitalize: 'off', autocomplete: 'off', spellcheck: 'false', enterkeyhint: 'go', 'aria-label': t('practice.answerLabel') }));
  input.setAttribute('autocorrect', 'off');
  const answerEl = h('div', { class: 'answer' }, input, checkMark());
  const fb = h('div', { class: 'pr-fb', 'aria-live': 'polite' });
  const reveal = h('div', { class: 'reveal-answer' }, h('div', null, fb));
  const card = h('article', { class: 'card pr-card' }, h('div', { class: 'card-meta' }, meta), promptBox, answerEl, reveal);
  const secondary = h('button', { type: 'button', class: 'btn btn-quiet pressable', onpointerdown: keep, onclick: () => showMe() }, t('practice.showMe'));
  const primary = h('button', { type: 'button', class: 'btn btn-primary pressable pr-primary', onpointerdown: keep, onclick: () => onReturn() });
  const knowBtn = knowButton(t, () => knowThis(), { typed: true });
  const box = h('div', { class: 'pr-round is-flow', role: 'region', 'aria-label': t('practice.script.words.title'), 'data-title': t('practice.script.title') },
    h('div', { class: 'pr-top' }, segs, h('div', { class: 'pr-top-row' }, count, endBtn)), h('div', { class: 'pr-scroll' }, card), h('div', { class: 'card-actions pr-actions' }, knowBtn, secondary, primary));
  /** @type {Set<string>} */ const knownIds = new Set();
  replace(el, h('h1', { class: 'sr-only' }, t('practice.script.words.title')), box);

  let state = 'answer', revealed = false, cardT0 = 0, holding = false;
  /** @type {any} */ let item = null, cur = /** @type {any} */ (null);
  /** @type {string[]} */ const states = queue.map(() => '');

  /** The card for one word: his sentence with the gap, or (every other review from the second on) the meaning alone. @param {string} id */
  function itemFor(id) {
    const w = info.get(id);
    const rec = cards(id)?.rec;
    const art = /^(der|die|das)\s/i.exec(w.head || '')?.[1]?.toLowerCase() || null;
    const meaningOnly = !w.sentence || (rec && rec.reps >= 2 && rec.reps % 2 === 0);
    if (!meaningOnly) {
      const toks = tokenize(w.sentence);
      let pos = 0, at = -1;
      for (const tk of toks) { const k = w.sentence.indexOf(tk.t, pos); if (tk.w && tk.k === w.start && tk.t === w.surface) { at = k; break; } pos = k + tk.t.length; }
      if (at < 0) at = w.sentence.indexOf(w.surface);
      if (at >= 0) {
        const prompt = `${w.sentence.slice(0, at)}___${w.sentence.slice(at + w.surface.length)}`;
        return { id, kind: 'word', area: 'words', prompt, promptLang: 'de', gap: true, literal: true, loose: true, anywhere: false, strict: [], accept: [w.surface], model: w.sentence, gloss: w.gloss, head: w.head || w.lemma, task: null };
      }
    }
    const accept = art ? [`${art} ${w.lemma}`] : [w.lemma];
    return { id, kind: 'word', area: 'words', prompt: w.gloss, promptLang: 'en', gap: false, literal: true, anywhere: false, strict: [], accept, model: accept[0], gloss: null, head: w.head || w.lemma,
      task: art ? t('practice.script.words.withArticle') : t('practice.script.words.type') };
  }
  function draw() {
    cur = queue[i];
    item = itemFor(cur.id);
    state = 'answer'; revealed = false; cardT0 = performance.now();
    resetAnswer(answerEl, reveal); replace(fb);
    const rec = cards(cur.id)?.rec;
    const w = info.get(cur.id);
    replace(meta, !rec || !rec.reps ? h('span', { class: 'pr-newtag' }, t('practice.new')) : t('practice.review'), script ? ` · ${script.title}` : '');
    knowBtn.hidden = !!(rec && rec.reps) || cur.again > 0;
    const gapAt = String(item.prompt).indexOf('___');
    replace(promptBox,
      item.task ? h('p', { class: 'pr-task' }, item.task) : null,
      h('p', { class: 'prompt', lang: item.promptLang }, gapAt >= 0 ? [item.prompt.slice(0, gapAt), h('span', { class: 'pr-gap', 'aria-label': 'gap' }, ' '), item.prompt.slice(gapAt + 3)] : item.prompt),
      item.gloss ? h('p', { class: 'prompt-hint' }, item.gloss) : null,
      w.section ? h('p', { class: 'caption pr-source' }, w.section) : null);
    input.value = ''; input.placeholder = item.gap ? t('practice.ph.gap') : t('practice.ph.german');
    secondary.hidden = false;
    primary.textContent = t('practice.check');
    // progress only moves forward: the segments are the words planned at the start; a word that comes back again is
    // counted on the last segment's side as "again", never as a new segment (design P0-1)
    if (i < firstTotal) { states[i] = 'now'; segments(segs, states); }
    count.textContent = i < firstTotal ? t('practice.count', { n: i + 1, total: firstTotal }) : t('practice.script.words.againOf', { n: i - firstTotal + 1, total: queue.length - firstTotal });
    input.focus({ preventScroll: true });
  }
  function onReturn() {
    if (holding) { skipHold(); return; }
    if (state === 'feedback') { next(); return; }
    const typed = input.value.trim();
    if (!typed) return;
    const g = gradeAnswer(item, typed, null, { nouns: L.nouns, lexicon: L.lexicon });
    record(g.ok && !g.partial, g);
    if (g.ok) {
      state = 'feedback';
      primary.textContent = t('practice.next');
      secondary.hidden = true;
      if (g.umlautMiss.length || g.capMiss.length || g.typos.length) { replace(fb, h('p', { class: 'pr-res is-warn' }, t('practice.right.typo')), h('p', { class: 'answer-key', lang: 'de' }, item.model)); reveal.classList.add('is-open'); }
      holding = true;
      fxCorrect(answerEl, { hold: 420 }).then(() => { holding = false; if (state === 'feedback' && !fb.childNodes.length) next(); });
    } else showRight(typed);
  }
  /** "I know this" on a new word (iknow.js): marked known in its deck, the card lifts away, the round goes on. */
  function knowThis() {
    if (state !== 'answer' || holding || knowBtn.hidden) return;
    const x = cards(cur.id);
    knowCard(ctx, { deck: x?.deck || St.DECK, id: cur.id });
    knownIds.add(cur.id);
    state = 'known';
    if (i < firstTotal) { states[i] = 'done'; segments(segs, states); }
    announce(t('practice.know.announce'));
    if (i + 1 >= queue.length) { finish(); return; }
    i++;
    swap(() => draw(), { kind: 'lift', fallbackEl: card });
  }
  function showMe() { if (state !== 'answer') return; revealed = true; record(false, null); showRight(''); }
  /** @param {string} typed */
  function showRight(typed) {
    state = 'feedback';
    replace(fb, typed ? h('p', { class: 'pr-res is-bad' }, t('practice.wrong')) : null,
      h('p', { class: 'answer-key', lang: 'de' }, item.gap ? item.accept[0] : item.model),
      item.gap ? h('p', { class: 'caption', lang: 'de' }, item.model) : null,
      h('p', { class: 'caption' }, item.head !== item.accept[0] ? item.head : ''));
    if (typed) fxWrong(answerEl, { revealEl: reveal }); else reveal.classList.add('is-open');
    primary.textContent = t('practice.next');
    secondary.hidden = true;
    announce(`${t('practice.rightIs')} ${item.gap ? item.accept[0] : item.model}`);
  }
  /** Schedule the answer. @param {boolean} ok @param {any} g */
  function record(ok, g) {
    const x = cards(cur.id);
    const deck = x?.deck || St.DECK;
    const prev = x?.rec || null;
    const sc = deck === 'b1' ? c : (script ? fsCtx(script, c.today) : c);
    const rating = FS.rate({ ok, revealed, limit: null, umlaut: !!g?.umlautMiss?.length, capSlip: !!g?.capMiss?.length, partial: !!g?.partial });
    const ms = performance.now() - cardT0;
    const res = FS.schedule(prev, { g: rating, ms, mode: 't', flags: revealed ? 'r' : '', src: 'script' }, { ...sc, forecast: () => 0 }, Date.now());
    if (res.rec) St.saveReview(store, { id: cur.id, rec: res.rec, prev, deck, g: rating, ms, mode: 't', flags: revealed ? 'r' : '', ctx: sc, scriptId: script ? script.id : 'words' });
    if (script && (!prev || !prev.reps)) St.countNew(store, script.id, c.today);
    if (!(cur.id in firstOk)) { firstOk[cur.id] = ok; if (ok) right++; }
    if (i < firstTotal) { states[i] = ok ? 'done' : 'miss'; segments(segs, states); }
    if (res.reinsert && cur.again < 2) queue.push({ id: cur.id, again: cur.again + 1 });
    if (ok) haptic();
  }
  function next() {
    if (i + 1 >= queue.length) return finish();
    i++; draw();
  }
  function finish() {
    cleanup();
    addActivity(store, c.today, { minutes: Math.min(30, (performance.now() - t0) / 60000), rounds: 0 });
    // the done hero; its data object is the round's words, each in the state it ended in
    const list = h('ul', { class: 'sc-wdone', lang: 'de' }, Object.entries(firstOk).map(([id, ok], k) => h('li', { class: ['sc-wdone-w', ok ? 'is-ok' : 'is-miss'], style: { '--i': String(Math.min(k, 12)) } },
      info.get(id)?.head || info.get(id)?.lemma || id, h('span', { class: 'sr-only' }, ok ? ` (${t('practice.script.words.gotIt')})` : ` (${t('practice.script.words.again')})`))));
    const hero = doneHero({ label: t('practice.script.words.title'), figure: right, of: t('practice.ofRight', { n: firstTotal - knownIds.size }),
      lines: [t('practice.script.words.after'), knownIds.size ? t('practice.know.inRound', { n: knownIds.size }) : null], data: list });
    replace(el, h('div', { class: 'practice pr-done stack', 'data-title': t('practice.script.title') }, hero.el,
      h('div', { class: 'pr-done-actions' }, h('a', { class: 'btn btn-primary pressable', href: backTo }, script ? t('practice.script.toOverview') : t('practice.script.toLibrary')))));
    const stopHero = hero.start();
    requestAnimationFrame(() => list.classList.add('is-in'));
    addEventListener('hashchange', stopHero, { once: true });
  }
  function end() { cleanup(); location.hash = backTo; }
  const onKey = (/** @type {KeyboardEvent} */ e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); onReturn(); }
    else if (e.key === 'Escape') { e.preventDefault(); end(); }
    else if (isKnowKey(e, true) && !knowBtn.hidden) { e.preventDefault(); knowThis(); }
  };
  input.addEventListener('keydown', onKey);
  function cleanup() { input.removeEventListener('keydown', onKey); }
  draw();
  return () => { cleanup(); restore(); };
}
