/* Practice round (#/practice/round[?kind=…], UX §4.3): full screen, no app chrome. Ported from Igloo's b1round.js.

   The answer field is ONE persistent <textarea> for the whole round: only the prompt and the feedback change between
   cards (inside a view transition), the field is never re-created, never read-only and never blurred, and every
   button keeps focus on it (pointerdown preventDefault). That keeps the iPhone keyboard up from the first card to the
   last. Return drives everything: check, check the retype, next. The round box follows the visual viewport so the
   buttons sit on the keyboard.

   Per card: soft timer (new items untimed), trap detectors with one self-repair, the kit's correct motion (underline,
   check, segment, auto-advance on a clean answer) and wrong motion (underline, strike, nudge, the answer opens below
   with the differing words marked), then "type it once". Scheduling is session.js; saving is data.js. */
import { h, replace, announce } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { correct as fxCorrect, wrong as fxWrong, resetAnswer, segments, swap, skip as skipHold, reduced, fill } from '../../core/motion.js';
import { label, add } from '../../core/clock.js';
import * as Match from '../../domain/match.js';
import * as RD from '../../domain/b1ready.js';
import { roundMinutes } from '../../domain/today.js';
import * as C from './compose.js';
import * as S from './session.js';
import { gradeAnswer, isSituation, retypeOk } from './grade.js';
import { loadData, stateFor, session, saveAnswer, saveLogs, forecaster, tz, addActivity, secrets } from './data.js';
import { checkAnswer } from '../../services/claude.js';
import { speech } from './speech.js';
import { play as playAudio, stop as stopAudio, prefetchAudio } from '../../services/audio.js';
import { recallBar } from './hub.js';
import { Field, atmosphere } from '../../core/brand.js';
import { readinessView } from './field.js';
import { parseClusterKind, itemFor as clusterItem, compose as composeCluster, cardIds as clusterCards, pickIds, typable } from './clusters/items.js';
import { loadClusters, dueCards as clusterDue, update as updateClusters, dayOf as clusterDay, recallOf, DECK as CLUSTER_DECK } from './clusters/data.js';
import { drawClusterDone } from './clusters/view.js';

const SVG = 'http://www.w3.org/2000/svg';
const TEIL = /** @type {Record<string, string>} */ ({ S1: 'Teil 1', S2: 'Teil 2', S3: 'Teil 3', W1: 'Aufgabe 1', W2: 'Aufgabe 2', W3: 'Aufgabe 3', L2: 'Teil 2', L3: 'Teil 3', L5: 'Teil 5' });
const fmtS = (/** @type {number} */ ms) => `${(ms / 1000).toFixed(1).replace(/\.0$/, '')} s`;
const keep = (/** @type {Event} */ e) => e.preventDefault();   // buttons never take focus from the answer field

/** The check mark the kit animates (a stroked path). */
export function checkMark() {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', 'check'); svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2.2'); svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round'); svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(SVG, 'path'); p.setAttribute('d', 'M5 12.5l4.5 4.5L19 7.5');
  svg.append(p);
  return svg;
}

/** ~n words around the gap, so a long Lesen sentence never pushes the gap out of view. @param {string} text */
function gapWindow(text, n = 12) {
  const w = String(text).split(/\s+/), gi = w.findIndex(x => x.includes('___'));
  if (w.length <= n + 2 || gi < 0) return String(text);
  let a = Math.max(0, gi - Math.floor(n / 2)); const b = Math.min(w.length, a + n); a = Math.max(0, b - n);
  return (a > 0 ? '… ' : '') + w.slice(a, b).join(' ') + (b < w.length ? ' …' : '');
}
/** @param {string} text */
function gapNodes(text) {
  const s = String(text), i = s.indexOf('___');
  return i < 0 ? [s] : [s.slice(0, i), h('span', { class: 'pr-gap', 'aria-label': 'gap' }, ' '), s.slice(i + 3)];
}
/** @param {string} text @param {string | null} part */
function highlight(text, part) {
  const s = String(text), i = part ? s.toLowerCase().indexOf(String(part).toLowerCase()) : -1;
  if (i < 0 || !part || part.length >= s.replace(/[.!?…\s]+$/, '').length - 1) return [s];   // the whole prompt: nothing to point at
  return [s.slice(0, i), h('mark', { class: 'pr-hl' }, s.slice(i, i + part.length)), s.slice(i + part.length)];
}
/** "You:" with wrong words boxed, "Right:" with the words he missed marked. @param {string} typed @param {string} right */
function diffLines(typed, right) {
  const d = Match.diffWords(typed, right);
  /** @type {any[]} */ const you = []; let pos = 0;
  for (const w of d.wrong) { you.push(typed.slice(pos, w.start), h('s', { class: 'pr-wrongword' }, typed.slice(w.start, w.end))); pos = w.end; }
  you.push(typed.slice(pos));
  const miss = new Set(d.missing); /** @type {any[]} */ const rt = []; let p2 = 0;
  d.right.forEach((/** @type {any} */ w, /** @type {number} */ k) => { if (!miss.has(k)) return; rt.push(right.slice(p2, w.start), h('mark', null, right.slice(w.start, w.end))); p2 = w.end; });
  rt.push(right.slice(p2));
  return { you, right: rt };
}

/** Text with ranges wrapped: marks → <mark>, struck → <s>. @param {string} text @param {{start: number, end: number}[]} ranges @param {'mark'|'s'} tag */
function wrapRanges(text, ranges, tag) {
  /** @type {any[]} */ const out = []; let p = 0;
  for (const r of [...ranges].sort((a, b) => a.start - b.start)) {
    if (r.start < p) continue;
    out.push(text.slice(p, r.start), h(tag, tag === 's' ? { class: 'pr-wrongword' } : null, text.slice(r.start, r.end))); p = r.end;
  }
  out.push(text.slice(p));
  return out;
}

/**
 * A situation's lines: what he typed, plain (only one phrase is graded), and the answer with that phrase's words marked.
 * @param {string} typed @param {string} right @param {string} pattern the accepted pattern that was checked
 */
function phraseLines(typed, right, pattern) {
  const want = new Set(Match.words(String(pattern).replace(/…/g, ' ')).map((/** @type {any} */ w) => w.n));
  /** @type {any[]} */ const rt = []; let p = 0;
  for (const w of Match.words(right)) {
    if (!want.has(w.n)) continue;
    rt.push(right.slice(p, w.start), h('mark', null, right.slice(w.start, w.end))); p = w.end;
  }
  rt.push(right.slice(p));
  return { you: [typed], right: rt };
}

/** @param {HTMLElement} el @param {import('../contract.js').ViewCtx} ctx */
export async function mountRound(el, ctx) {
  const { t, store } = ctx;
  document.body.dataset.chrome = 'off';
  document.body.classList.add('pr-in-round');
  let data;
  try { data = await loadData(ctx); } catch {
    replace(el, h('div', { class: 'practice stack page-pad' }, h('h1', null, t('practice.round')), h('p', null, t('practice.loadFailed')), h('a', { class: 'btn pressable', href: '#/practice' }, t('practice.back'))));
    return () => { document.body.dataset.chrome = 'on'; document.body.classList.remove('pr-in-round'); };
  }
  // a cluster round (kind=cluster:<type>:<id> or cluster:due): cards in deck 'clusters', items built from their ids
  const ck = parseClusterKind(ctx.query.get('kind'));
  const deck = ck ? CLUSTER_DECK : 'b1';
  /** @type {any} */ let clusters = null;
  if (ck) {
    try { clusters = await loadClusters(ctx); } catch { clusters = null; }
    if (!clusters || (ck.key && !clusters.ix.byKey.get(ck.key))) { ctx.go('/practice/clusters', { replace: true }); return () => { document.body.dataset.chrome = 'on'; document.body.classList.remove('pr-in-round'); }; }
    data = { ...data, byId: new Map(data.byId) };
  }
  // a round of words picked on the Explore map (kind=cluster:pick&ids=…): its own slot per set of words
  const picked = ck?.pick ? pickIds(ctx.query.get('ids')).filter(id => typable(clusters.ix.word(id.slice(2)))) : [];
  const spec = ck ? { kind: 'cluster', topic: ck.key || (ck.pick ? `pick:${picked.join(',')}` : 'due') } : C.parseKind(ctx.query.get('kind'));
  const slot = S.slotKey(spec);
  /** Cluster items for the ids of a round (rebuilt from the ids, so a saved round resumes). @param {string[]} ids */
  const addClusterItems = ids => { for (const id of ids) if (!data.byId.has(id)) { const it = clusterItem(id, clusters.ix, clusters.c, { t, where: t(`practice.clusters.where.${/^C[OFP]:/.test(id) ? id.slice(0, 2) : 'W'}`) }); if (it) data.byId.set(id, it); } };
  // End and Esc go back where the round was started from (Today's button adds from=today)
  const backTo = ctx.query.get('from') === 'today' ? '/today' : ctx.query.get('from') === 'map' ? '/lookup/map' : ctx.query.get('kind')?.startsWith('cluster:') ? `/practice/clusters${(/^cluster:(\w+):(.+)$/.exec(String(ctx.query.get('kind'))) || []).slice(1).map(x => `/${x}`).join('')}` : '/practice';
  let st = stateFor(ctx, data);
  const sess = session(store);
  const saved = S.savedRound(sess, slot);
  /** @type {any} */ let round = S.resumable(saved, st.c.today, Date.now()) ? structuredClone(saved) : null;
  if (!round) {
    if (st.day.traps == null && spec.kind === 'today') st.day.traps = C.trapSet(st);
    let ids;
    if (ck) {
      const c0 = st.c, cards0 = store.cards(deck) || {};
      const pool = ck.key ? clusterCards(clusters.ix.byKey.get(ck.key), clusters.ix) : ck.pick ? picked : clusterDue(store, c0);
      ids = composeCluster({ ids: pool, cards: cards0, c: c0, isDue: rec => RD.isDue(rec, c0.today, c0), recall: recallOf(c0),
        ...(ck.pick ? { size: picked.length, newCap: picked.length } : {}) }).ids;
      if (ck.due) ids = ids.filter(id => cards0[id]?.reps);
      addClusterItems(ids);
      ids = ids.filter(id => data.byId.has(id));
    } else ids = C.compose(st, spec);
    if (!ids.length) return drawNothing();
    round = S.startRound(ids, spec, st.c.today, Date.now());
    if (ck) round.deck = deck;
    saveLogs(store, { round, slot, day: st.day });
  }
  if (ck) addClusterItems(round.queue.map((/** @type {any} */ q) => q.id));
  const day = st.day;
  const settings = ctx.settings();
  const sp = speech();
  const docked = !settings.practice.simpleInput;
  const roundT0 = performance.now();

  // ---------- layout ----------
  const segs = h('div', { class: 'segments', 'aria-label': t('practice.progress') });
  const count = h('span', { class: 'caption tnum' });
  const endBtn = h('button', { type: 'button', class: 'btn btn-quiet pressable pr-end', onpointerdown: keep, onclick: () => end() }, t('practice.end'), h('kbd', null, 'Esc'));
  // the round's own strip of the readiness field: one cell per item, landing in accent on a right first answer
  const stripIds = [...new Set(round.queue.map((/** @type {any} */ q) => q.id))];
  const stripEl = h('canvas', { class: 'field pr-strip', style: { '--w': `${Math.min(stripIds.length, 24) * 8 - 2}px` } });
  const top = h('div', { class: 'pr-top' }, segs, h('div', { class: 'pr-top-row' }, count, stripEl, endBtn));
  const meta = h('span', { class: 'label' });
  const secs = h('span', { class: 'caption tnum pr-secs', 'aria-hidden': 'true' });
  const tfill = h('span', { class: 'fill' });
  const tbar = h('div', { class: 'track pr-tbar', 'aria-hidden': 'true' }, tfill);
  const promptBox = h('div', { class: 'pr-promptbox' });
  const prefill = h('span', { class: 'pr-prefill', lang: 'de', hidden: true });
  const input = /** @type {HTMLTextAreaElement} */ (h('textarea', { class: 'answer-input', id: 'pr-input', rows: 1, lang: 'de', autocapitalize: 'off', autocomplete: 'off',
    spellcheck: 'false', enterkeyhint: 'go', 'aria-label': t('practice.answerLabel') }));
  input.setAttribute('autocorrect', 'off');
  const answerEl = h('div', { class: 'answer' }, prefill, input, checkMark());
  const moves = h('div', { class: 'pr-moves', role: 'group', 'aria-label': t('practice.pickMove'), hidden: true });
  const fb = h('div', { class: 'pr-fb', 'aria-live': 'polite' });
  const reveal = h('div', { class: 'reveal-answer' }, h('div', null, fb));
  const card = h('article', { class: 'card pr-card' }, h('div', { class: 'card-meta' }, meta, secs), tbar, promptBox, answerEl, moves, reveal);
  const secondary = h('button', { type: 'button', class: 'btn btn-quiet pressable', onpointerdown: keep, onclick: () => onSecondary(), hidden: true });
  const primary = h('button', { type: 'button', class: 'btn btn-primary pressable pr-primary', onpointerdown: keep, onclick: () => onReturn() });
  const actions = h('div', { class: 'card-actions pr-actions' }, secondary, primary);
  const scroll = h('div', { class: 'pr-scroll' }, card);
  const box = h('div', { class: ['pr-round', docked ? 'is-docked' : 'is-flow'], role: 'region', 'aria-label': t('practice.round') }, top, scroll, actions);
  const h1 = h('h1', { class: 'sr-only' }, t('practice.round'));
  replace(el, h1, box);
  // the router focuses the page's h1 after mount; in a round the answer field keeps focus (and the keyboard)
  h1.addEventListener('focus', () => focusInput());

  // the round box follows the visual viewport, so the buttons sit on the keyboard
  const vv = window.visualViewport;
  function fit() {
    if (!docked) return;
    const H = vv ? vv.height : innerHeight, y = vv ? vv.offsetTop : 0;
    box.style.height = `${H}px`; box.style.transform = y ? `translateY(${y}px)` : '';
  }
  vv?.addEventListener('resize', fit); vv?.addEventListener('scroll', fit); addEventListener('resize', fit); fit();
  const grow = () => { input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 3 * 24 + 16)}px`; };
  input.addEventListener('input', () => { grow(); lastKey = performance.now(); if (state === 'retype') answerEl.classList.remove('is-shake'); });

  // ---------- per-card state ----------
  /** @type {any} */ let entry = null;
  let state = 'answer', t0 = 0, pausedAt = 0, pausedMs = 0, lastKey = 0, limitMs = /** @type {number|null} */ (null);
  /** @type {any} */ let tick = null, auto = /** @type {any} */ (null), move = /** @type {any} */ (null), outcome = /** @type {any} */ (null), det = /** @type {any} */ (null);
  let overSaid = false, showOffered = false, revealed = false, recorded = false, holding = false, alive = true;

  const elapsed = () => (pausedAt || performance.now()) - t0 - pausedMs;
  function startTimer(/** @type {number|null} */ ms) {
    clearInterval(tick); t0 = performance.now(); pausedMs = 0; pausedAt = 0; overSaid = false; showOffered = false;
    limitMs = ms;
    tbar.hidden = !ms; tbar.classList.toggle('is-repair', state === 'repair'); tbar.classList.remove('is-over');
    if (!ms) { secs.textContent = entry.isNew ? t('practice.noTimer') : ''; return; }
    tfill.style.transition = 'none'; tfill.style.setProperty('--p', '1');
    if (!reduced()) requestAnimationFrame(() => requestAnimationFrame(() => { tfill.style.transition = `transform ${ms}ms linear`; tfill.style.setProperty('--p', '0'); }));
    tick = setInterval(draw, reduced() ? 1000 : 200); draw();
  }
  const stopTimer = () => { clearInterval(tick); tick = null; const p = getComputedStyle(tfill).transform; tfill.style.transition = 'none'; if (p && p !== 'none') tfill.style.transform = p; };
  function draw() {
    if (!limitMs) return;
    const e = elapsed(), L = limitMs;
    if (pausedAt) { secs.textContent = t('practice.paused'); return; }
    tbar.classList.toggle('is-over', e > L);
    if (reduced()) tfill.style.setProperty('--p', String(Math.max(0, 1 - e / L)));
    secs.textContent = state === 'repair' ? t('practice.toFix', { n: Math.max(0, Math.ceil((L - e) / 1000)) })
      : e <= L ? `${Math.max(1, Math.ceil((L - e) / 1000))} s` : `+${Math.floor((e - L) / 1000)} s`;
    if (state === 'repair' && e > L) { stopTimer(); finishRepair(false); return; }
    if (state !== 'answer') return;
    if (e > L && !overSaid) { overSaid = true; announce(t('practice.overTime')); }
    if (e > 2 * L) {
      if (!showOffered) { showOffered = true; announce(t('practice.showAvailable')); setButtons(); }
      if (performance.now() - Math.max(lastKey, t0 + 2 * L) > 3000) { stopTimer(); showAnswer(); }
    }
  }
  const pause = () => { if (!pausedAt && tick) { pausedAt = performance.now(); tfill.style.transitionDuration = '0ms'; draw(); } };
  const resume = () => { if (pausedAt) { pausedMs += performance.now() - pausedAt; pausedAt = 0; if (limitMs && !reduced()) { const left = Math.max(0, limitMs - elapsed()); tfill.style.transition = `transform ${left}ms linear`; tfill.style.setProperty('--p', '0'); } draw(); } };
  const onVis = () => { if (document.hidden) pause(); else if (document.activeElement === input) resume(); };
  document.addEventListener('visibilitychange', onVis);
  input.addEventListener('focus', resume);
  box.addEventListener('click', e => { if (!/** @type {HTMLElement} */ (e.target).closest('button,a,summary,details')) input.focus({ preventScroll: true }); });

  const focusInput = () => { if (!moves.hidden) return; input.focus({ preventScroll: true }); };
  function setButtons() {
    const isPick = state === 'pick';
    actions.hidden = isPick;
    primary.textContent = state === 'feedback' ? t('practice.next') : t('practice.check');
    primary.append(h('kbd', null, state === 'feedback' ? '↵' : 'Enter'));
    /** @type {string | null} */ let sec = null;
    if (state === 'answer' && entry.isNew) sec = t('practice.showMe');
    else if (state === 'answer' && limitMs && elapsed() > 2 * limitMs) sec = t('practice.showAnswer');
    else if (state === 'retype') sec = t('practice.skip');
    secondary.hidden = !sec;
    if (sec) replace(secondary, sec, h('kbd', null, 'Tab'));
  }
  function updateDots() {
    segments(segs, S.dots(round, recorded));
    count.textContent = t('practice.count', { n: Math.min(round.i + 1, round.queue.length), total: round.queue.length });
  }

  // ---------- drawing a card ----------
  function where(/** @type {any} */ it) {
    if (it.area === 'clusters') return it.where || t('practice.clusters.title');
    if (it.area === 'mistakes') return t('practice.where.mistake');
    if (it.area === 'words') return t('practice.where.words');
    if (it.area === 'writing') return `Schreiben ${TEIL[it.teil] || ''}`.trim();
    if (it.kind === 'topic' || it.kind === 'reply') return t('practice.where.situation', { teil: TEIL[it.teil] || '' }).trim();
    if (/^W/.test(it.teil || '')) return `Schreiben ${TEIL[it.teil]}`;
    if (it.area === 'grammar') return t('practice.where.grammar');
    const a = it.area === 'reading' ? 'Lesen' : 'Sprechen';
    return it.teil ? `${a} ${TEIL[it.teil] || ''}`.trim() : a;
  }
  function fillCard() {
    const it = entry.item;
    state = it.kind === 'reply' ? 'pick' : 'answer';
    det = null; outcome = null; move = null; revealed = false; recorded = false;
    clearTimeout(auto);
    resetAnswer(answerEl, reveal); answerEl.classList.remove('is-retype', 'is-shake');
    replace(fb);
    replace(meta, entry.isNew ? h('span', { class: 'pr-newtag' }, t('practice.new')) : t('practice.review'), ` · ${where(it)}`);
    /** @type {any[]} */ const kids = [];
    if (it.task) kids.push(h('p', { class: 'pr-task' }, it.task));
    if (it.partner) kids.push(h('p', { class: 'caption' }, t('practice.partner')), h('p', { class: 'pr-partner', lang: 'de' }, `„${it.partner}“`));
    if (it.gap || it.showGap) kids.push(h('p', { class: 'prompt', lang: 'de' }, gapNodes(gapWindow(it.prompt, 20))));
    else kids.push(h('p', { class: 'prompt', lang: it.promptLang === 'de' ? 'de' : 'en' }, it.hl ? highlight(it.prompt, it.hl) : it.prompt));
    if (it.gloss) kids.push(h('p', { class: 'prompt-hint' }, it.gloss));
    if (it.source) kids.push(h('p', { class: 'caption pr-source' }, it.area === 'mistakes' ? t('practice.from.mistake', { src: it.source }) : it.source));
    if (entry.isNew && it.area !== 'mistakes') kids.push(h('p', { class: 'caption pr-help' }, t('practice.typeIfKnown')));
    replace(promptBox, kids);
    const pf = String(it.prefill || ''), k = pf.search(/[.!?]\s+\S[^.!?]*$/);
    prefill.hidden = !it.prefill; prefill.textContent = k >= 0 ? `… ${pf.slice(k + 1).trim()}` : pf;
    input.value = ''; grow();
    input.placeholder = it.gap ? t('practice.ph.gap') : it.area === 'mistakes' ? t('practice.ph.rewrite') : t('practice.ph.german');
    tbar.hidden = true;
    updateDots();
    if (state === 'pick') return drawPick();
    moves.hidden = true; answerEl.hidden = false;
    setButtons();
    startTimer(entry.limit ? entry.limit * 1000 : null);
  }
  async function drawCard(first = false) {
    entry = S.current(round, data.byId, store.cards(deck));
    if (!entry) return finish();
    if (first) { fillCard(); focusInput(); announce(t('practice.cardAnnounce', { n: entry.n, total: round.queue.length })); return; }
    await swap(() => fillCard(), { kind: 'forward', fallbackEl: card });
    focusInput();
    scroll.scrollTop = 0;
  }
  // reply items: pick a move first (the only time the keyboard closes in a round)
  function drawPick() {
    const it = entry.item;
    answerEl.hidden = true; moves.hidden = false; input.blur();
    replace(moves, it.moves.map((/** @type {any} */ m, /** @type {number} */ k) => h('button', { type: 'button', class: 'btn pressable pr-move', onclick: () => pick(k) }, h('kbd', null, String(k + 1)), m.label)));
    setButtons();
    startTimer(entry.limit ? entry.limit * 1000 : null);
    /** @type {HTMLElement | null} */ (moves.querySelector('button'))?.focus({ preventScroll: true });
  }
  function pick(/** @type {number} */ k) {
    move = entry.item.moves[k]; state = 'answer';
    moves.hidden = true; answerEl.hidden = false;
    replace(promptBox, ...promptBox.childNodes, h('p', { class: 'label pr-chosen' }, `${move.label}:`));
    setButtons();
    input.focus({ preventScroll: true });
  }

  // ---------- answering ----------
  const full = (/** @type {string} */ typed) => (entry.item.prefill ? `${entry.item.prefill} ` : '') + typed;
  // whole answers Claude confirmed right count as right sentences next time (the rest-of-sentence check)
  const variants = () => {
    /** @type {Map<string, string[]>} */ const m = new Map();
    for (const v of session(store).variants || []) if (v && v.verdict === 'correct' && v.id && v.answer) m.set(v.id, [...(m.get(v.id) || []), v.answer]);
    return m;
  };
  const grade = (/** @type {string} */ typed) => gradeAnswer(entry.item, full(typed), move, { ...data, variants: variants() });
  function onReturn() {
    if (holding) { skipHold(); return; }
    const typed = input.value.trim();
    if (state === 'answer') { if (typed) submit(typed); return; }
    if (state === 'repair') { if (typed) finishRepair(true); return; }
    if (state === 'retype') { if (typed) checkRetype(typed); return; }
    if (state === 'feedback') next();
  }
  function onSecondary() {
    if (state === 'answer' && entry.isNew) showMe();
    else if (state === 'answer' && limitMs && elapsed() > 2 * limitMs) showAnswer();
    else if (state === 'retype') skipRetype();
  }
  function submit(/** @type {string} */ typed) {
    const ms = elapsed();
    const g = grade(typed);
    stopTimer();
    if (g.det && !entry.isNew) {   // a trap: one self-repair at half the limit
      det = g.det; state = 'repair';
      replace(fb, h('p', { class: 'pr-hint' }, hintNodes(det.hint)));
      reveal.classList.add('is-open');
      outcome = { ms, g, typed };
      setButtons();
      startTimer(Math.max(4000, (limitMs || 12000) * 0.5));
      return;
    }
    if (entry.isNew) { if (g.ok) showRight(g, ms, true); else studyCard(g, typed); return; }
    if (g.ok) showRight(g, ms, false); else showWrong(g, typed, ms);
  }
  function finishRepair(/** @type {boolean} */ submitted) {
    stopTimer();
    const typed = input.value.trim();
    const g = submitted ? grade(typed) : null;
    if (g && g.ok) {
      record({ ok: true, ms: outcome.ms, selfRepair: true, det: det.cls, partial: g.partial });
      state = 'feedback';
      fxCorrect(answerEl, { hold: 0 });
      replace(fb, h('p', { class: 'pr-res is-ok' }, t('practice.fixedIt')), g.partial ? restLines(g) : null);
      setButtons();
      return;
    }
    showWrong(g || outcome.g, typed || outcome.typed, outcome.ms, det);
  }
  function record(/** @type {any} */ o) {
    if (recorded) return;
    recorded = true;
    const cards = store.cards(deck);
    const res = S.answer({ round, entry, o: { ...o, revealed }, cards, day, c: st.c, forecast: forecaster(cards, st.c), now: Date.now(), tz: tz() });
    saveAnswer(store, entry.item.id, res.rec, res.event, { round, slot, day }, deck);
    if (ck && entry.isNew) updateClusters(store, x => { const d = clusterDay(store, st.c.today); return { ...x, day: { ...d, newShown: d.newShown + 1 } }; });
    updateDots();
    const k = stripIds.indexOf(entry.item.id);
    if (strip && k >= 0 && !entry.reinsert) { if (o.ok) strip.ripple(k); else strip.set(k, 1); }
  }
  function hintNodes(/** @type {string} */ s) { return String(s).split(/\*([^*]+)\*/).map((x, i) => (i % 2 ? h('i', null, x) : x)); }
  function wordCard(/** @type {any} */ it) {
    const c = it && it.card; if (!c) return null;
    const ex = c.ex;
    const play = ex ? h('button', { type: 'button', class: 'pr-play pressable', 'aria-label': t('practice.word.play'), onpointerdown: keep,
      onclick: async () => { if (!(await playAudio(ctx.content, ex))) sp.say(ex, 'de'); } }, icon('play', { size: 16 })) : null;
    return h('div', { class: 'pr-word' }, h('p', { lang: 'de' }, h('b', null, c.head)),
      ex ? h('p', { class: 'caption pr-word-ex' }, play, h('span', { lang: 'de' }, ex), c.exEn ? ` (${c.exEn})` : null) : null,
      c.conf ? h('p', { class: 'caption' }, c.conf) : null);
  }
  function alsoMore(/** @type {string[]} */ list, lead = '') {
    return h('details', { class: 'pr-more' }, h('summary', { onpointerdown: keep, onclick: () => clearTimeout(auto) }, `${lead}${t('practice.more', { n: list.length })}`),
      h('p', { lang: 'de' }, list.join(' · ')));
  }
  function sayAnswer(/** @type {string} */ text) { if (settings.practice.readAloud) sp.say(text, 'de'); }
  // his answer with typo, capital and umlaut slips marked and the right spelling after each
  function markSlips(/** @type {any} */ g) {
    const s = g.input, marks = [...g.typos.map((/** @type {any} */ x) => ({ ...x, k: 'typo' })), ...g.capMiss.map((/** @type {any} */ x) => ({ ...x, k: 'cap' })), ...g.umlautMiss.map((/** @type {any} */ x) => ({ ...x, k: 'uml' }))].sort((a, b) => a.start - b.start);
    /** @type {any[]} */ const out = []; let p = 0;
    for (const m of marks) { if (m.start < p) continue; out.push(s.slice(p, m.start), h('span', { class: 'pr-slip' }, s.slice(m.start, m.end)), h('span', { class: 'pr-fix' }, ` ${m.expected}`)); p = m.end; }
    out.push(s.slice(p));
    return out;
  }

  // right
  // the phrase is right, the rest of the sentence is not: "<phrase> is right.", the rest with its differences, Hard
  function restLines(/** @type {any} */ g) {
    const r = g.rest, kids = [];
    if (r.junk) kids.push(h('p', { class: 'caption' }, t('practice.partial.junk')));
    else if (r.ref) kids.push(h('p', { class: 'pr-diff answer-key pr-rest', lang: 'de' }, h('span', { class: 'caption' }, isSituation(entry.item) ? t('practice.partial.situation') : t('practice.partial.rest')), ' ', wrapRanges(r.ref, r.marks || [], 'mark')));
    if ((r.wrong || []).length) kids.push(h('p', { class: 'pr-diff', lang: 'de' }, h('span', { class: 'caption' }, t('practice.you')), ' ', wrapRanges(g.input, r.wrong, 's')));
    kids.push(h('p', { class: 'caption' }, t('practice.partial.hard')));
    return kids;
  }
  function phraseHead(/** @type {any} */ g) {
    const [a, b] = t('practice.partial.right', { phrase: '\u0000' }).split('\u0000');
    return h('p', { class: 'pr-res is-warn' }, a, h('b', { lang: 'de' }, g.phrase || ''), b ?? '');
  }
  async function showRight(/** @type {any} */ g, /** @type {number} */ ms, /** @type {boolean} */ isNew) {
    const it = entry.item;
    const late = !isNew && limitMs && ms > limitMs, veryLate = !isNew && limitMs && ms > 2 * limitMs;
    const capSlip = g.capMiss.length > 0 && !(it.focus || []).includes('cap');
    const umlaut = g.umlautMiss.length > 0;
    const partial = !!g.partial;
    const punct = (g.punctMiss || []).length > 0;
    record({ ok: true, ms, capSlip, umlaut, typo: g.typos.length > 0, partial, punct });
    state = 'feedback';
    if (partial) return showPartial(g, ms);
    /** @type {string | null} */ let head = null;
    if (isNew) head = t('practice.right.knew');
    else if (veryLate) head = t('practice.right.veryLate');
    else if (late) head = t('practice.right.late', { s: fmtS(ms), limit: Math.round(/** @type {number} */ (limitMs) / 1000) });
    else if (umlaut) head = t('practice.right.umlaut', { list: g.umlautMiss.map((/** @type {any} */ x) => x.expected).join(', ') });
    else if (capSlip) head = t('practice.right.cap');
    else if (punct) head = t('practice.right.punct');
    else if (g.typos.length) head = t('practice.right.typo');
    const situation = it.kind === 'topic' || it.kind === 'reply';
    const clean = g.primary && !g.typos.length && !capSlip && !umlaut && !punct && !late && !isNew && !situation && it.area !== 'mistakes' && !it.usage;
    const kids = [];
    if (head) kids.push(h('p', { class: ['pr-res', (late || umlaut || capSlip || veryLate || punct) ? 'is-warn' : 'is-ok'] }, head));
    if (punct) kids.push(h('p', { class: 'pr-rule' }, (g.punctMiss || []).map((/** @type {any} */ m) => t(`practice.punct.${m.code}`, { word: m.word || '' })).join(' ')),
      h('p', { class: 'answer-key', lang: 'de' }, it.model));
    // a mistake from a correction: the rule is the point, so it shows on a right answer too
    if (it.area === 'mistakes' && it.rule) kids.push(h('p', { class: 'pr-rule' }, it.rule));
    // a preposition gap: the usage note is the point, so it shows after a right answer too
    if (it.usage) kids.push(h('p', { class: 'pr-rule' }, it.usage));
    if (g.typos.length || capSlip || umlaut) kids.push(h('p', { class: 'pr-yours', lang: 'de' }, markSlips(g)));
    if (situation) kids.push(h('p', { class: 'caption' }, t('practice.checkedPhrase')));
    const others = g.alsoCorrect || [];
    if (others.length && !clean) kids.push(h('p', { class: 'pr-also' }, h('span', { class: 'caption' }, situation ? t('practice.otherWays') : t('practice.alsoCorrect')), ' ',
      h('span', { lang: 'de' }, others.slice(0, 2).join(' · ')), others.length > 2 ? alsoMore(others.slice(2), '') : null));
    replace(fb, kids, wordCard(it));
    setButtons();
    sayAnswer(g.input);
    if (kids.length || it.card) reveal.classList.add('is-open');
    announce(head || t('practice.right.time', { s: fmtS(ms) }));
    tbar.hidden = true; secs.textContent = fmtS(ms);
    holding = true;
    await fxCorrect(answerEl, { hold: clean ? 420 : 300 });
    holding = false;
    if (clean && state === 'feedback' && alive) next();
  }
  // the phrase right, the rest not: never "Right first time"; the rest, Hard, Claude if he thinks his version is right
  function showPartial(/** @type {any} */ g, /** @type {number} */ ms) {
    const it = entry.item;
    const kids = [phraseHead(g), ...restLines(g)];
    if (it.area === 'mistakes' && it.rule) kids.push(h('p', { class: 'pr-rule' }, it.rule));
    if (claudeOk() && !g.rest?.junk) kids.push(claudeBox(input.value.trim()));
    replace(fb, kids, wordCard(it));
    setButtons();
    reveal.classList.add('is-open');
    sayAnswer(g.rest?.ref || g.right);
    announce(`${t('practice.partial.right', { phrase: g.phrase || '' })} ${g.rest?.ref ? `${t('practice.partial.rest')} ${g.rest.ref}` : t('practice.partial.junk')}`);
    tbar.hidden = true; secs.textContent = fmtS(ms);   // no check mark: the answer as a whole was not right
  }
  // wrong: the diff, the closest right answer, one rule line, then type it once
  function showWrong(/** @type {any} */ g, /** @type {string} */ typed, /** @type {number} */ ms, /** @type {any} */ d = null) {
    const it = entry.item;
    record({ ok: false, ms, det: d?.cls || null, gDet: g.det?.cls || null });
    const right = g.target || g.right;   // the whole sentence he types once, the same one shown here
    // a situation grades one phrase, not the whole sentence: only that phrase is marked, the rest is shown plain
    const situation = it.kind === 'topic' || it.kind === 'reply';
    const df = situation && g.pattern ? phraseLines(full(typed), right, g.pattern) : diffLines(full(typed), right);
    const kids = [h('p', { class: 'pr-res is-bad' }, t('practice.wrong')),
      h('p', { class: 'pr-diff', lang: 'de' }, h('span', { class: 'caption' }, t('practice.you')), ' ', df.you),
      h('p', { class: 'pr-diff answer-key', lang: 'de' }, h('span', { class: 'caption' }, t('practice.rightIs')), ' ', df.right),
      situation ? h('p', { class: 'caption' }, t('practice.checkedPhrase')) : null];
    if (g.alsoCorrect?.length) kids.push(h('p', { class: 'pr-also' }, alsoMore(g.alsoCorrect, t('practice.otherWays') + ' ')));
    // a Schreiben phrase's own rule names its sentence; elsewhere the trap's general rule comes first
    const rule = it.usage || (it.area === 'writing' && it.rule ? it.rule : (d && g.detRule) || g.detRule || it.rule);
    if (rule) kids.push(h('p', { class: 'pr-rule' }, rule));
    if (claudeOk() && !d && !g.det) kids.push(claudeBox(typed));
    replace(fb, kids, wordCard(it));
    fxWrong(answerEl, { revealEl: reveal });
    announce(`${t('practice.wrong')}. ${t('practice.rightIs')} ${right}`);
    sayAnswer(right);
    toRetype(right, 360);
  }
  const claudeOk = () => !!secrets(store).anthropicKey && settings.practice.claudeCheck && navigator.onLine;
  function claudeBox(/** @type {string} */ typed) {
    const boxEl = h('div', { class: 'pr-claude' });
    const btn = /** @type {HTMLButtonElement} */ (h('button', { type: 'button', class: 'btn pressable', onpointerdown: keep, onclick: async () => {
      btn.disabled = true; btn.textContent = t('practice.claude.checking');
      const cur = entry;
      try {
        const v = await checkAnswer({ key: secrets(store).anthropicKey, item: cur.item, answer: full(typed) });
        if (cur !== entry) return;
        if (v.verdict === 'correct' || v.verdict === 'minor') {
          const cards = store.cards(deck);
          const res = S.override({ round, entry: cur, ms: 0, c: st.c, forecast: forecaster(cards, st.c), now: Date.now(), tz: tz() });
          // only a "correct" verdict becomes a variant that later counts as a right sentence; "minor" (a slip) does not
          const saved = v.verdict === 'correct' ? [...(session(store).variants || []), { id: cur.item.id, answer: full(typed), at: Date.now(), verdict: 'correct' }].slice(-200) : undefined;
          saveAnswer(store, cur.item.id, res.rec, res.event, { round, slot, day, ...(saved ? { variants: saved } : {}) }, deck);
          updateDots();
          replace(boxEl, h('p', { class: 'pr-res is-ok' }, v.verdict === 'correct' ? t('practice.claude.correct') : t('practice.claude.minor')), v.note ? h('p', { class: 'caption' }, v.note) : null);
          state = 'feedback'; input.value = ''; answerEl.classList.remove('is-wrong', 'is-retype'); input.placeholder = t('practice.ph.next'); setButtons();
        } else replace(boxEl, h('p', { class: 'pr-res is-bad' }, t('practice.claude.wrong')), v.note ? h('p', { class: 'caption' }, v.note) : null);
      } catch (e) {
        replace(boxEl, h('p', { class: 'caption' }, navigator.onLine ? t('practice.claude.failed', { why: /** @type {Error} */ (e).message }) : t('practice.claude.offline')));
      }
      input.focus({ preventScroll: true });
    } }, t('practice.claude.ask')));
    boxEl.append(btn);
    return boxEl;
  }
  // out of time, or Show answer
  function showAnswer() {
    if (state !== 'answer') return;
    stopTimer(); revealed = true;
    const typed = input.value.trim();
    const g = grade(typed || '-');
    record({ ok: false, ms: elapsed() });
    const kids = [];
    if (typed) kids.push(h('p', { class: 'caption' }, t('practice.youHad'), ' ', h('span', { lang: 'de' }, full(typed))));
    kids.push(h('p', { class: 'pr-res' }, t('practice.oneWay')), h('p', { class: 'answer-key', lang: 'de' }, (g.target || g.right)));
    if (g.alsoCorrect?.length) kids.push(h('p', { class: 'pr-also' }, alsoMore(g.alsoCorrect, t('practice.alsoCorrect') + ' ')));
    replace(fb, kids, wordCard(entry.item));
    fxWrong(answerEl, { revealEl: reveal, haptics: false });
    sayAnswer(g.target || g.right);
    toRetype(g.target || g.right, 0);
  }
  // a new item: the study card, then type it once
  function showMe() { if (state === 'answer') studyCard(grade(input.value.trim() || '-'), input.value.trim()); }
  function studyCard(/** @type {any} */ g, /** @type {string} */ typed) {
    stopTimer(); revealed = !typed;
    record({ ok: false, ms: elapsed() });
    const kids = [];
    if (typed) {
      const df = diffLines(full(typed), (g.target || g.right));
      kids.push(h('p', { class: 'pr-diff', lang: 'de' }, h('span', { class: 'caption' }, t('practice.you')), ' ', df.you),
        h('p', { class: ['answer-key', 'pr-study', String(g.target || g.right).length > 90 && 'is-long'], lang: 'de' }, df.right));
    } else kids.push(h('p', { class: ['answer-key', 'pr-study', String(g.target || g.right).length > 90 && 'is-long'], lang: 'de' }, (g.target || g.right)));
    if (g.alsoCorrect?.length) kids.push(h('p', { class: 'pr-also' }, h('span', { class: 'caption' }, t('practice.alsoCorrect')), ' ', h('span', { lang: 'de' }, g.alsoCorrect.slice(0, 2).join(' · ')), g.alsoCorrect.length > 2 ? alsoMore(g.alsoCorrect.slice(2)) : null));
    if (entry.item.rule) kids.push(h('p', { class: 'pr-rule' }, entry.item.rule));
    replace(fb, kids, wordCard(entry.item));
    reveal.classList.add('is-open');
    if (typed) fxWrong(answerEl, { haptics: false });
    sayAnswer(g.target || g.right);
    toRetype(g.target || g.right, typed ? 360 : 0);
  }
  function toRetype(/** @type {string} */ right, /** @type {number} */ delay) {
    state = 'retype'; entry.right = right;
    tbar.hidden = true; secs.textContent = '';
    setButtons();
    const go = () => { if (state !== 'retype') return; input.value = ''; grow(); answerEl.classList.add('is-retype'); input.placeholder = t('practice.ph.retype'); focusInput(); };
    if (delay && !reduced()) setTimeout(go, delay); else go();
  }
  function checkRetype(/** @type {string} */ typed) {
    if (retypeOk(entry.item, full(typed), entry.right) || retypeOk(entry.item, typed, entry.right)) {   // exactly the sentence he was shown (case and commas aside)
      state = 'feedback';
      // the miss is fixed: no red "Not quite" next to a green check. The verdict turns, the struck line goes.
      const verdict = fb.querySelector('.pr-res.is-bad');
      if (verdict) { verdict.classList.replace('is-bad', 'is-ok'); verdict.textContent = t('practice.retypeOk'); }
      fb.querySelectorAll('.pr-diff:not(.answer-key), .pr-claude').forEach(x => x.remove());
      fb.append(h('p', { class: 'caption pr-back' }, t('practice.comesBack')));
      answerEl.classList.remove('is-wrong', 'is-retype');
      input.placeholder = t('practice.ph.next');
      setButtons();
      fxCorrect(answerEl, { hold: 0, haptics: false });
      auto = setTimeout(next, 900);
      return;
    }
    answerEl.classList.remove('is-shake'); void answerEl.offsetWidth; answerEl.classList.add('is-shake');
  }
  function skipRetype() { state = 'feedback'; next(); }
  function next() {
    clearTimeout(auto);
    if (state === 'answer' || state === 'repair' || state === 'pick') return;
    if (!S.advance(round)) { saveLogs(store, { round, slot }); return finish(); }
    saveLogs(store, { round, slot });
    drawCard();
  }

  // ---------- keys ----------
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); onReturn(); return; }
    // Tab is Skip / Show me only while that button is there; otherwise focus moves on as usual (no keyboard trap)
    if (e.key === 'Tab' && !e.shiftKey && !secondary.hidden) { e.preventDefault(); onSecondary(); return; }
    if (e.key === 'Escape') { e.preventDefault(); end(); return; }
    if (e.altKey && (e.key === 'a' || e.key === 'å')) { e.preventDefault(); fb.querySelectorAll('details').forEach(d => { d.open = !d.open; }); clearTimeout(auto); return; }
    if (state === 'feedback' && !holding && e.key.length === 1 && !e.metaKey && !e.ctrlKey) next();   // typing moves on; the key lands in the next answer
  });
  input.addEventListener('beforeinput', e => { if (/** @type {InputEvent} */ (e).inputType === 'insertLineBreak') { e.preventDefault(); onReturn(); } });
  const onDocKey = (/** @type {KeyboardEvent} */ e) => {
    if (state === 'pick' && ['1', '2', '3'].includes(e.key)) { e.preventDefault(); pick(+e.key - 1); }
    else if (e.key === 'Escape' && document.activeElement !== input) end();
  };
  document.addEventListener('keydown', onDocKey);

  function cleanup() {
    alive = false;
    strip?.destroy();
    clearInterval(tick); clearTimeout(auto);
    document.removeEventListener('visibilitychange', onVis);
    document.removeEventListener('keydown', onDocKey);
    vv?.removeEventListener('resize', fit); vv?.removeEventListener('scroll', fit); removeEventListener('resize', fit);
    sp.cancel();
  }
  function minutesSpent() { return Math.min(30, (performance.now() - roundT0) / 60000); }
  function end() {
    if (!alive) return;
    cleanup();
    const done = round.results.filter((/** @type {any} */ r) => r.first).length;
    addActivity(store, st.c.today, { minutes: minutesSpent() });
    saveLogs(store, { round, slot });
    ctx.go(backTo);
    setTimeout(() => ctx.toast(t('practice.saved', { n: done, total: round.planned })), 60);
  }
  function finish() {
    cleanup();
    if (ck) {   // a cluster round: its own day log and done screen; the B1 day log and readiness stay out of it
      saveLogs(store, { round: null, slot });
      updateClusters(store, x => { const d = clusterDay(store, st.c.today); return { ...x, day: { ...d, rounds: d.rounds + 1 } }; });
      addActivity(store, st.c.today, { minutes: minutesSpent(), rounds: 1 });
      const firsts = round.results.filter((/** @type {any} */ r) => r.first);
      drawClusterDone(el, ctx, { key: ck.key, right: firsts.filter((/** @type {any} */ r) => r.ok).length, total: firsts.length, prev: round.prev || {}, again: S.roundHref(round) });
      return;
    }
    day.rounds = (day.rounds || 0) + 1;
    if (round.kind === 'write') day.writeRounds = (day.writeRounds || 0) + 1;
    saveLogs(store, { round: null, slot, day });
    addActivity(store, st.c.today, { minutes: minutesSpent(), rounds: 1 });
    drawDone(el, ctx, data, round, backTo);
  }
  function drawNothing() {
    if (ck) { ctx.go(ck.key ? `/practice/clusters/${ck.key.replace(':', '/')}` : '/practice/clusters', { replace: true }); return () => { document.body.dataset.chrome = 'on'; document.body.classList.remove('pr-in-round'); }; }
    const c = st.c;
    const tomorrow = RD.forecast(store.cards('b1'), c.today, 2, c)[1]?.n || 0;
    replace(el, h('div', { class: 'practice pr-done stack' },
      h('p', { class: 'label' }, t('practice.round')),
      h('h1', null, spec.kind === 'missed' ? t('practice.nothing.missed') : spec.kind === 'mistakes' ? t('practice.nothing.mistakes') : t('practice.nothing.title')),
      h('p', { class: 'lead' }, spec.kind === 'missed' ? t('practice.nothing.missedSince', { date: label(add(c.today, -3)) }) : t('practice.tomorrow', { n: tomorrow, date: label(add(c.today, 1)) })),
      h('div', { class: 'pr-done-actions' }, h('a', { class: 'btn btn-primary pressable', href: '#/practice' }, t('practice.done')), h('a', { class: 'btn pressable', href: '#/practice/speak' }, t('practice.speak')))));
    return () => { document.body.dataset.chrome = 'on'; document.body.classList.remove('pr-in-round'); };
  }

  // test hook (localhost only): the browser tests read the current card and drive the round
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
    /** @type {any} */ (window).__practice = { get state() { return state; }, get entry() { return entry; }, input, onReturn, onSecondary, pick };
  }
  fit();
  // answers already given in a resumed round show in the strip
  const firstOk = new Map(round.results.filter((/** @type {any} */ r) => r.first).map((/** @type {any} */ r) => [r.id, r.ok]));
  /** @type {Field | null} */ const strip = new Field(/** @type {HTMLCanvasElement} */ (stripEl), stripIds.map(id => (firstOk.has(id) ? (firstOk.get(id) ? 3 : 1) : 0)), { cell: 6, gap: 2, label: null });
  if (round.queue.some((/** @type {any} */ e) => data.byId.get(e.id)?.card?.ex)) prefetchAudio(ctx.content);
  await drawCard(true);
  return () => { cleanup(); stopAudio(); document.body.dataset.chrome = 'on'; document.body.classList.remove('pr-in-round'); };
}

/** The done screen (UX §4.3). @param {HTMLElement} el @param {import('../contract.js').ViewCtx} ctx @param {any} data @param {any} round @param {string} backTo */
function drawDone(el, ctx, data, round, backTo) {
  const { t, store } = ctx;
  const st = stateFor(ctx, data), c = st.c;
  const sum = S.summary(round, data.byId);
  // readiness before = the same store with only this round's items rolled back
  const pool = data.pool.filter((/** @type {any} */ it) => it.area !== 'mistakes');
  const rd = (/** @type {any} */ cards) => RD.compute({ pool, store: cards, today: c.today, exam: c.exam, phase: c.phase });
  const now = store.cards('b1'), before = { ...now };
  for (const [id, r] of Object.entries(round.prev || {})) { if (r) before[id] = r; else delete before[id]; }
  const a = rd(now).overall, b = rd(before).overall;
  // a Schreiben round goes on with Schreiben phrases: their own due and new counts
  const write = round.kind === 'write';
  const wDue = write ? pool.filter((/** @type {any} */ it) => it.area === 'writing' && RD.isDue(now[it.id], c.today, c)).length : 0;
  const more = write ? wDue > 0 || C.newLeftOf(st, 'w') > 0 : st.dueN > 0 || C.newLeft(st) > 0;
  const tomorrow = RD.forecast(now, c.today, 2, c)[1]?.n || 0;
  const p1 = (/** @type {number} */ x) => (100 * (x || 0)).toFixed(1);
  const short = (/** @type {any} */ it) => it.model || it.prompt;
  const list = (/** @type {string} */ title, /** @type {any[]} */ items) => items.length ? h('section', { class: 'pr-list' }, h('h2', null, title),
    h('ul', { class: 'list' }, items.map(it => h('li', { class: 'list-item', lang: 'de' }, short(it))))) : null;
  const exam = c.exam && c.phase !== 'after' && c.phase !== 'none';
  const bar = recallBar(a.recall, a.coverage, t('practice.area.bar', { recall: `${p1(a.recall)} %`, seen: `${p1(a.coverage)} %` }));
  const anotherHref = round.kind === 'today' || round.kind === 'mistakes' || round.kind === 'missed' ? '#/practice/round' : S.roundHref(round);
  // the brand moment: the atmosphere breathes once behind the result, and the field shows the round's right answers
  // landing in the exam pool
  const view = round.kind === 'mistakes' ? null : readinessView(st);
  const fieldEl = view ? h('canvas', { class: 'field pr-done-field' }) : null;
  const atmoEl = h('div', { class: 'atmo', 'aria-hidden': 'true' });
  replace(el, h('div', { class: 'practice pr-done stack' },
    h('section', { class: 'hero pr-done-hero' }, atmoEl,
      h('p', { class: 'label' }, t('practice.roundDone')),
      h('h1', null, h('span', { class: 'figure tnum' }, String(sum.right)), ' ', h('span', { class: 'pr-done-of' }, t('practice.ofRight', { n: sum.total }))),
      sum.late ? h('p', { class: 'caption' }, t('practice.late', { n: sum.late })) : null,
      sum.partial ? h('p', { class: 'caption' }, t('practice.partialN', { n: sum.partial })) : null,
      sum.fixedLast ? h('p', { class: 'caption' }, t('practice.lastFixed')) : null,
      view ? h('div', { class: 'pr-ready' },
        h('p', { class: 'pr-ready-top' }, h('span', { class: 'label' }, exam ? t('practice.readyFor', { date: label(c.exam) }) : t('practice.readyNow')),
          h('b', { class: 'tnum' }, `${p1(b.recall)}% → ${p1(a.recall)}%`)), bar, fieldEl,
        Math.abs(a.recall - b.recall) < 0.0005 ? h('p', { class: 'caption' }, t('practice.repeats')) : null) : null),
    h('p', { class: 'pr-next' }, more ? t(write ? (wDue ? 'practice.write.nextUp' : 'practice.write.nextNew') : 'practice.nextUp', write ? { due: wDue, n: C.newLeftOf(st, 'w') } : { due: st.dueN, n: C.newLeft(st) }) : t('practice.allDone', { n: tomorrow })),
    h('div', { class: 'pr-done-actions' },
      more ? h('a', { class: 'btn btn-primary pressable', href: anotherHref, id: 'pr-again' }, t('practice.another', { min: roundMinutes(C.ROUND) })) : null,
      h('a', { class: ['btn', 'pressable', !more && 'btn-primary'], href: '#/today' }, t('practice.doneToday'))),
    sum.back.length ? h('section', { class: 'pr-list' }, h('h2', null, t('practice.list.back')), h('p', { class: 'caption' }, t('practice.list.backSub')),
      h('ul', { class: 'list' }, sum.back.map((/** @type {any} */ it) => h('li', { class: 'list-item' }, h('span', { lang: 'de' }, short(it)),
        sum.fixed.includes(it) ? h('span', { class: 'caption' }, t('practice.list.fixedTag')) : null)))) : null,
    list(t('practice.list.new'), sum.news)));
  requestAnimationFrame(() => fill(bar, b.recall));
  setTimeout(() => fill(bar, a.recall), reduced() ? 0 : 380);
  /** @type {any} */ let atmo = null;
  /** @type {Field | null} */ let field = null;
  if (view && fieldEl) {
    const rightIds = new Set(round.results.filter((/** @type {any} */ r) => r.first && r.ok).map((/** @type {any} */ r) => r.id));
    const cells = view.ids.map((id, i) => (rightIds.has(id) ? i : -1)).filter(i => i >= 0);
    // the cells answered right start in their earlier state and land one after another
    const start = view.states.map((x, i) => (rightIds.has(view.ids[i]) ? Math.min(x, 1) : x));
    field = new Field(/** @type {HTMLCanvasElement} */ (fieldEl), start, { cell: 5, gap: 1, label: null });
    cells.slice(0, 24).forEach((i, k) => setTimeout(() => field?.ripple(i, { state: Math.max(2, view.states[i]) }), reduced() ? 0 : 500 + k * 90));
    cells.slice(24).forEach(i => field?.set(i, Math.max(2, view.states[i])));
  }
  atmosphere(atmoEl).then(x => { atmo = x; x.breathe(); }).catch(() => {});
  el.querySelector('h1')?.setAttribute('tabindex', '-1');
  /** @type {HTMLElement | null} */ (el.querySelector('h1'))?.focus({ preventScroll: true });
  const onKey = (/** @type {KeyboardEvent} */ e) => {
    if (e.key === 'Enter' && more && !/** @type {HTMLElement} */ (e.target).closest('a,button')) { e.preventDefault(); location.hash = anotherHref; }
    if (e.key === 'Escape') { e.preventDefault(); ctx.go(backTo); }
  };
  document.addEventListener('keydown', onKey);
  const stop = () => { document.removeEventListener('keydown', onKey); field?.destroy(); atmo?.destroy(); };
  addEventListener('hashchange', stop, { once: true });
}
