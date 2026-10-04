/* Speaking situations (#/practice/situations[/round?pick=…], features/practice/sim.js for the rules).
     #/practice/situations                      the picker: today's round, levels, situations by function
     #/practice/situations/round?pick=mixed|level:B1|fn:decline[&from=today]   a round, full screen

   A card, about 10 to 15 seconds: the situation lands and the other person's line plays (it appears word by word in
   a speech bubble, a small waveform moves while it plays); he answers out loud, to himself (no typing, no mic);
   Show answer (Space) unfolds the model answer with its chunk marked and plays it in a second voice; he grades
   himself with four big buttons (keys 1 to 4, Enter or Space = Good) and the card is scheduled in deck 'speak'.
   Good and Easy land the item's cell in the round strip in accent; three or more in a row send a ripple back
   through the strip. The done screen lays out the round's chunks as chat bubbles.

   Motion is the kit's: swap() between cards, the .reveal-answer unfold, segments(), Field ripples, haptic(); the
   rest is CSS on the kit's tokens, so reduced motion turns every move into a fade or a jump. */
import { h, replace, announce } from '../../core/dom.js';
import { notice, section } from '../../core/ui.js';
import { icon } from '../../core/icons.js';
import { segments, swap, reduced, haptic, countTo } from '../../core/motion.js';
import { Field } from '../../core/brand.js';
import * as S from './sim.js';
import { loadBank, simState, simCards, setStart, saveGrade, saveRound, finishRound, refreshSimStats } from './sim-data.js';
import { playLine, stopLine } from './sim-audio.js';
import { simToday } from './plan.js';
import { forecaster, tz } from './data.js';
import { recallBar } from './hub.js';

const pct = (/** @type {number} */ x) => new Intl.NumberFormat('en-GB', { style: 'percent', maximumFractionDigits: 0 }).format(x || 0);
const back = (/** @type {string} */ href, /** @type {string} */ text) => h('a', { class: 'pr-backlink pressable', href }, icon('prev', { size: 16 }), text);
const roundMin = (/** @type {number} */ n) => Math.max(1, Math.ceil(n * 0.2));
const fnName = (/** @type {any} */ bank, /** @type {string} */ fn) => bank.functions?.[fn] || fn;

/** @param {HTMLElement} el @param {import('../contract.js').ViewCtx} ctx @param {string[]} rest */
export function mountSim(el, ctx, rest) {
  return rest[0] === 'round' ? mountRound(el, ctx) : mountPicker(el, ctx);
}

/* ------------------------------------------------------------------ */
/* Picker                                                              */
/* ------------------------------------------------------------------ */

/** @param {HTMLElement} el @param {import('../contract.js').ViewCtx} ctx */
async function mountPicker(el, ctx) {
  const { t, store } = ctx;
  let alive = true, pending = /** @type {Promise<void> | null} */ (null);
  const head = () => [back('#/practice', t('practice.title')), h('div', { class: 'page-head' }, h('h1', null, t('practice.sim')))];
  replace(el, h('div', { class: 'practice sim stack' }, head(), h('p', { class: 'caption' }, t('practice.loading'))));

  async function render() {
    let b;
    try { b = await loadBank(ctx); } catch {
      if (alive) replace(el, h('div', { class: 'practice sim stack' }, head(), notice({ kind: 'warning', children: [h('p', null, t('practice.sim.loadFailed'))] })));
      return;
    }
    if (!alive) return;
    const c = ctx.clock.ctx(), settings = ctx.settings();
    const cards = simCards(store), sim = simState(store);
    const states = S.levelStates(b.items, cards, sim.start);
    const open = S.openLevels(states);
    const today = simToday({ store, c, settings });
    const saved = S.resumable(sim.round, c.today, Date.now()) ? sim.round : null;
    const comp = S.compose({ items: b.items, cards, c, pick: { kind: 'mixed' }, start: sim.start, newLeft: today.newLeft });

    // ---- today's round ----
    const dueEl = h('span', { class: 'figure tnum' }, String(today.due));
    const left = saved ? saved.queue.length - saved.i : 0;
    const label = saved ? t('practice.finish', { n: left })
      : comp.ids.length ? (comp.extra ? t('practice.sim.ahead', { n: comp.ids.length }) : t('practice.sim.start', { n: comp.ids.length, min: roundMin(comp.ids.length + comp.fresh) })) : null;
    const startHref = saved ? `#/practice/situations/round?pick=${encodeURIComponent(saved.pick)}` : '#/practice/situations/round?pick=mixed';
    const startBtn = label ? h('a', { class: 'btn btn-primary btn-wide pressable', href: startHref, id: 'sim-start' }, label) : null;
    const queue = h('div', { class: 'pr-queue' },
      h('div', { class: 'pr-queue-top' },
        h('p', { class: 'pr-due' }, dueEl, h('span', { class: 'label' }, t('practice.dueToday', { n: today.due }))),
        h('p', { class: 'label pr-new' }, c.newItems ? t('practice.sim.newLeft', { n: today.newLeft }) : t('practice.sim.noNew'))),
      comp.ids.length || saved ? null : h('p', { class: 'pr-empty' }, t('practice.sim.nothingPick')),
      startBtn ? h('div', { class: 'pr-queue-btn' }, startBtn) : null);

    // ---- your level ----
    const lvIdx = S.LEVELS.indexOf(/** @type {any} */ (settings.level));
    const startIdx = S.LEVELS.indexOf(/** @type {any} */ (sim.start || 'A1'));
    const suggest = lvIdx > 0 && lvIdx > startIdx && !states[lvIdx]?.open
      ? notice({ children: [h('p', null, t('practice.sim.suggest', { lv: settings.level })),
        h('p', null, h('button', { type: 'button', class: 'btn pressable', onclick: () => choose(/** @type {string} */ (settings.level)) }, t('practice.sim.level.startHere', { lv: settings.level })))] })
      : null;

    // ---- levels ----
    const levelRows = states.map((x, i) => {
      const name = `${x.lv} · ${t('practice.sim.level.items', { n: x.n })}`;
      const trail = t('practice.sim.level.learnt', { n: x.learnt, total: x.n });
      if (x.open) {
        return h('a', { class: 'pr-area pressable', href: `#/practice/situations/round?pick=level:${x.lv}`, 'aria-label': `${name}, ${trail}` },
          h('span', { class: 'pr-area-top' }, h('span', { class: 'row-title' }, name), h('span', { class: 'row-trail tnum' }, trail)),
          recallBar(x.n ? x.learnt / x.n : 0, x.n ? x.seen / x.n : 0, t('practice.sim.level.bar', { lv: x.lv, learnt: x.learnt, n: x.n })), icon('next', { size: 16 }));
      }
      return h('div', { class: 'pr-area sim-locked' },
        h('span', { class: 'pr-area-top' }, h('span', { class: 'row-title' }, name),
          h('span', { class: 'row-trail caption' }, t('practice.sim.level.locked', { prev: states[i - 1]?.lv || '', pct: pct(S.STEADY) }))),
        h('button', { type: 'button', class: 'btn btn-quiet pressable sim-jump', onclick: () => choose(x.lv) }, t('practice.sim.level.startHere', { lv: x.lv })));
    });

    // ---- by function ----
    const fns = Object.keys(b.bank.functions || {});
    const tiles = fns.map(fn => {
      const mine = b.items.filter(it => it.fn === fn);
      const avail = mine.filter(it => open.has(it.lv) || cards[it.id]?.reps);
      const due = S.dueCount(Object.fromEntries(mine.map(it => [it.id, cards[it.id]]).filter(([, r]) => r)), c);
      const sub = avail.length ? (due ? t('practice.sim.fn.due', { n: due }) : t('practice.sim.fn.count', { n: avail.length })) : t('practice.sim.fn.locked');
      return avail.length
        ? h('a', { class: 'sim-fn pressable', href: `#/practice/situations/round?pick=fn:${fn}` }, h('span', { class: 'sim-fn-name' }, fnName(b.bank, fn)), h('span', { class: 'caption tnum' }, sub))
        : h('span', { class: 'sim-fn is-locked' }, h('span', { class: 'sim-fn-name' }, fnName(b.bank, fn)), h('span', { class: 'caption' }, sub));
    });

    const view = h('div', { class: ['practice', 'sim', 'stack', startBtn && 'has-dock'] },
      head(), h('p', { class: 'lead sim-lead' }, t('practice.sim.lead')),
      queue, suggest,
      section(t('practice.sim.levels'), h('div', { class: 'pr-areas' }, levelRows)),
      section(t('practice.sim.functions'), h('div', { class: 'sim-fns' }, tiles)));
    const hadFocus = document.activeElement === el.querySelector('h1');
    replace(el, view);
    if (hadFocus) view.querySelector('h1')?.focus({ preventScroll: true });
    countTo(dueEl, today.due, { from: 0, duration: 600 });
  }

  /** @param {string} lv */
  function choose(lv) {
    setStart(store, lv);
    refreshSimStats(ctx);
    announce(t('practice.sim.level.started', { lv }));
  }

  const rerender = () => { if (!pending) pending = render().finally(() => { pending = null; }); };
  await render();
  refreshSimStats(ctx);
  const offs = [store.subscribe(`cards:${S.DECK}`, rerender), store.subscribe(S.KV, rerender), ctx.bus.on('settings:changed', rerender)];
  return () => { alive = false; offs.forEach(f => f()); };
}

/* ------------------------------------------------------------------ */
/* Round                                                               */
/* ------------------------------------------------------------------ */

/** The waveform: five bars that move while a line plays (CSS, .is-playing). */
const wave = () => h('span', { class: 'sim-wave', 'aria-hidden': 'true' }, [0, 1, 2, 3, 4].map(i => h('i', { style: { '--i': String(i) } })));

/** Words of a line as spans, so the line can appear word by word. @param {string} text */
function wordSpans(text) {
  const words = String(text).split(/(\s+)/);
  let k = 0;
  return words.map(w => (/^\s+$/.test(w) ? w : h('span', { class: 'sim-w', style: { '--i': String(k++) } }, w)));
}

/** @param {HTMLElement} el @param {import('../contract.js').ViewCtx} ctx */
async function mountRound(el, ctx) {
  const { t, store } = ctx;
  document.body.dataset.chrome = 'off';
  document.body.classList.add('pr-in-round');
  const restore = () => { document.body.dataset.chrome = 'on'; document.body.classList.remove('pr-in-round'); };
  const backTo = ctx.query.get('from') === 'today' ? '/today' : '/practice/situations';
  let b;
  try { b = await loadBank(ctx); } catch {
    replace(el, h('div', { class: 'practice stack page-pad' }, h('h1', null, t('practice.sim')), h('p', null, t('practice.sim.loadFailed')), h('a', { class: 'btn pressable', href: '#/practice/situations' }, t('practice.back'))));
    return restore;
  }
  const bank = b.bank, byId = b.byId;
  const pick = S.parsePick(ctx.query.get('pick'));
  let c = ctx.clock.ctx();
  const settings = ctx.settings();
  const sim = simState(store);
  /** @type {any} */ let round = S.resumable(sim.round, c.today, Date.now()) && sim.round.pick === S.pickKey(pick) ? structuredClone(sim.round) : null;
  if (!round) {
    const comp = S.compose({ items: b.items, cards: simCards(store), c, pick, start: sim.start, newLeft: simToday({ store, c, settings }).newLeft });
    if (!comp.ids.length) return drawEmpty();
    round = S.startRound(comp.ids, pick, c.today, Date.now());
    saveRound(store, round);
  }
  const roundT0 = performance.now();

  // ---------- layout ----------
  const segs = h('div', { class: 'segments', 'aria-label': t('practice.sim.progress') });
  const count = h('span', { class: 'caption tnum' });
  const endBtn = h('button', { type: 'button', class: 'btn btn-quiet pressable pr-end', onclick: () => end() }, t('practice.sim.end'), h('kbd', null, 'Esc'));
  const stripIds = [...new Set(round.queue.map((/** @type {any} */ q) => q.id))];
  const stripEl = h('canvas', { class: 'field pr-strip', style: { '--w': `${Math.min(stripIds.length, 24) * 8 - 2}px` } });
  const top = h('div', { class: 'pr-top' }, segs, h('div', { class: 'pr-top-row' }, count, stripEl, endBtn));

  const meta = h('span', { class: 'label' });
  const setup = h('p', { class: 'sim-setup' });
  const line = h('p', { class: 'sim-line', lang: 'de' });
  const playBtn = h('button', { type: 'button', class: 'sim-play pressable', 'aria-label': t('practice.sim.play'), onclick: () => playOther() }, wave());
  const them = h('div', { class: 'sim-bubble sim-them' }, playBtn, line);
  const status = h('p', { class: 'caption sim-status', 'aria-live': 'polite' });
  const goal = h('p', { class: 'sim-goal' });
  const say = h('p', { class: 'caption sim-say' }, t('practice.sim.say'));
  const answerLine = h('p', { class: 'sim-line', lang: 'de' });
  const ansPlay = h('button', { type: 'button', class: 'sim-play pressable', 'aria-label': t('practice.sim.playAnswer'), onclick: () => playAnswer() }, wave());
  const you = h('div', { class: 'sim-bubble sim-you' }, answerLine, ansPlay);
  const also = h('div', { class: 'sim-also' });
  const reveal = h('div', { class: 'reveal-answer sim-reveal' }, h('div', null, h('p', { class: 'label sim-model' }, t('practice.sim.model')), you, also));
  const card = h('article', { class: 'card pr-card sim-card' }, h('div', { class: 'card-meta' }, meta), setup, them, status, goal, say, reveal);

  const showBtn = h('button', { type: 'button', class: 'btn btn-primary pressable pr-primary sim-show', onclick: () => doReveal() }, t('practice.sim.show'), h('kbd', null, 'Space'));
  const gradeBtns = /** @type {HTMLButtonElement[]} */ ([1, 2, 3, 4].map(g => /** @type {HTMLButtonElement} */ (h('button', { type: 'button', class: ['sim-g', 'pressable', g === 3 && 'is-main'], style: { '--i': String(g - 1) }, onclick: () => grade(/** @type {1|2|3|4} */ (g)) },
    h('span', { class: 'sim-g-name' }, t(`practice.sim.g${g}`)), h('span', { class: 'sim-g-when caption tnum' }), h('kbd', null, String(g))))));
  const grades = h('div', { class: 'sim-grades', role: 'group', 'aria-label': t('practice.sim.how'), hidden: true }, gradeBtns);
  const actions = h('div', { class: 'card-actions pr-actions sim-actions' }, showBtn, grades);
  const scroll = h('div', { class: 'pr-scroll' }, card);
  const box = h('div', { class: 'pr-round sim-round is-docked', role: 'region', 'aria-label': t('practice.sim.round') }, top, scroll, actions);
  const h1 = h('h1', { class: 'sr-only' }, t('practice.sim.round'));
  replace(el, h1, box);

  const vv = window.visualViewport;
  function fit() { const H = vv ? vv.height : innerHeight; box.style.height = `${H}px`; }
  vv?.addEventListener('resize', fit); addEventListener('resize', fit); fit();

  // the strip: one cell per situation of the round; answers already given in a resumed round show
  const firstG = new Map();
  for (const r of round.results) if (r.first && !firstG.has(r.id)) firstG.set(r.id, r.g);
  const cellFor = (/** @type {number} */ g) => (g >= 3 ? 3 : g === 2 ? 2 : 1);
  const strip = new Field(/** @type {HTMLCanvasElement} */ (stripEl), stripIds.map(id => (firstG.has(id) ? cellFor(firstG.get(id)) : 0)), { cell: 6, gap: 2, label: null });

  // ---------- per card ----------
  /** @type {S.Item | null} */ let item = null;
  let state = 'think', t0 = 0, alive = true, busy = false;
  /** @type {(number|null)[]} */ let when = [];

  function updateTop(answered = false) {
    segments(segs, S.dots(round, answered));
    count.textContent = t('practice.sim.of', { k: Math.min(round.i + 1, round.queue.length), n: round.queue.length });
  }

  function fillCard() {
    const q = round.queue[round.i];
    item = /** @type {S.Item} */ (byId.get(q.id));
    meta.textContent = `${item.lv} · ${fnName(bank, item.fn)}`;
    setup.textContent = item.setup;
    replace(line, ...wordSpans(item.other.de));
    const words = line.querySelectorAll('.sim-w').length || 1;
    line.style.setProperty('--wstep', `${Math.round(Math.max(45, Math.min(110, 1500 / words)))}ms`);
    line.classList.remove('is-typed'); void line.offsetWidth; line.classList.add('is-typed');
    them.classList.remove('is-playing');
    status.textContent = '';
    replace(goal, h('span', { class: 'label' }, t('practice.sim.goal')), ' ', item.goal);
    const [a0, ...more] = item.answers;
    const [pre, chunk, post] = S.chunkParts(a0);
    replace(answerLine, pre, h('mark', { class: 'sim-chunk' }, chunk), post);
    replace(also, ...(more.length ? [h('p', { class: 'label' }, t('practice.sim.also')), ...more.map(a => {
      const [p1, c1, p2] = S.chunkParts(a);
      return h('p', { class: 'sim-alt', lang: 'de' }, p1, h('mark', { class: 'sim-chunk' }, c1), p2);
    })] : []));
    reveal.classList.remove('is-open');
    say.hidden = false;
    state = 'think';
    showBtn.hidden = false; grades.hidden = true; grades.classList.remove('is-in');
    gradeBtns.forEach(bt => { bt.classList.remove('is-picked', 'is-other'); bt.disabled = false; });
    const cards = simCards(store);
    when = S.preview(cards[item.id] || null, c, Date.now(), forecaster(cards, c));
    gradeBtns.forEach((bt, k) => {
      const w = when[k];
      const txt = w == null ? t('practice.sim.inRound') : t('practice.sim.days', { n: w });
      /** @type {HTMLElement} */ (bt.querySelector('.sim-g-when')).textContent = txt;
      bt.setAttribute('aria-label', t('practice.sim.gradeLabel', { grade: t(`practice.sim.g${k + 1}`), when: txt }));
    });
    updateTop();
    t0 = performance.now();
  }

  async function playOther() {
    if (!item) return;
    const res = await playLine({ content: ctx.content, file: item.other.audio, text: item.other.de,
      onStart: () => them.classList.add('is-playing'), onEnd: () => them.classList.remove('is-playing') });
    if (!alive) return;
    status.textContent = res === 'blocked' ? t('practice.sim.tapToPlay') : res === 'none' ? t('practice.sim.noAudio') : '';
  }
  async function playAnswer() {
    if (!item) return;
    const a = item.answers[0];
    await playLine({ content: ctx.content, file: a.audio, text: a.de, onStart: () => you.classList.add('is-playing'), onEnd: () => you.classList.remove('is-playing') });
  }

  function doReveal() {
    if (state !== 'think' || busy) return;
    state = 'revealed';
    reveal.classList.add('is-open');
    say.hidden = true;
    showBtn.hidden = true; grades.hidden = false;
    requestAnimationFrame(() => grades.classList.add('is-in'));
    announce(item ? item.answers[0].de : '');
    playAnswer();
  }

  /** @param {1|2|3|4} g */
  function grade(g) {
    if (state !== 'revealed' || busy || !item) return;
    busy = true; state = 'graded';
    const ms = performance.now() - t0;
    const q = round.queue[round.i];
    const cards = simCards(store);
    const before = cards[item.id] ? structuredClone(cards[item.id]) : null;
    const isNew = !before || !before.reps;
    c = ctx.clock.ctx();
    const res = S.gradeCard({ rec: before, g, c, now: Date.now(), ms, forecast: forecaster(cards, c) });
    S.record(round, { id: item.id, g, isNew: isNew && !q.re, ms, reinsert: res.reinsert });
    saveGrade(store, { id: item.id, before, rec: res.rec, g, ms, c, tz: tz(), round, isNew: isNew && !q.re });
    haptic();
    // the button answers with a spring; the others step back
    gradeBtns.forEach((bt, k) => { bt.classList.toggle('is-picked', k === g - 1); bt.classList.toggle('is-other', k !== g - 1); bt.disabled = true; });
    updateTop(true);
    // the strip: Good and Easy land in accent; a run of three or more sends a ripple back through the cells
    const k = stripIds.indexOf(item.id);
    if (k >= 0) {
      if (g >= 3) strip.ripple(k, { state: 3 }); else if (!q.re || g === 1) strip.set(k, cellFor(g));
      const run = S.streak(round);
      if (g >= 3 && run >= 3 && !reduced()) {
        const cells = [...new Set(round.results.slice(-run).map((/** @type {any} */ r) => stripIds.indexOf(r.id)))].filter(x => x >= 0 && x !== k).reverse().slice(0, 6);
        cells.forEach((ci, n) => setTimeout(() => { if (alive) strip.ripple(ci, { state: 3 }); }, 90 * (n + 1)));
        box.classList.remove('is-streak'); void box.offsetWidth; box.classList.add('is-streak');
      }
    }
    stopLine();
    setTimeout(next, reduced() ? 120 : 260);
  }

  async function next() {
    if (!alive) return;
    if (!S.advance(round)) { finish(); return; }
    saveRound(store, round);
    await swap(() => { fillCard(); }, { kind: 'forward', fallbackEl: card });
    scroll.scrollTop = 0;
    busy = false;
    playOther();
  }

  function minutes() { return Math.min(30, (performance.now() - roundT0) / 60000); }
  function end() {
    cleanup();
    const n = round.results.length;
    saveRound(store, round.i < round.queue.length ? round : null);
    if (n) setTimeout(() => ctx.toast(t('practice.sim.saved', { n: new Set(round.results.map((/** @type {any} */ r) => r.id)).size })), 60);
    ctx.go(backTo);
  }
  function finish() {
    cleanup(false);   // the done screen stays full screen, as a B1 round's does
    finishRound(store, round.day, minutes());
    drawDone(el, ctx, bank, byId, round, backTo, pick);
  }

  /** @param {KeyboardEvent} e */
  function onKey(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const onButton = e.target instanceof HTMLElement && e.target.closest('button, a');
    if (e.key === 'Escape') { e.preventDefault(); end(); return; }
    if ((e.key === ' ' || e.key === 'Enter') && !onButton) {
      e.preventDefault();
      if (state === 'think') doReveal(); else if (state === 'revealed') grade(3);
      return;
    }
    if (/^[1-4]$/.test(e.key) && state === 'revealed') { e.preventDefault(); grade(/** @type {1|2|3|4} */ (Number(e.key))); return; }
    if ((e.key === 'r' || e.key === 'R') && state !== 'graded') { e.preventDefault(); if (state === 'revealed') playAnswer(); else playOther(); }
  }
  document.addEventListener('keydown', onKey);

  function cleanup(chrome = true) {
    if (!alive) return;
    alive = false;
    stopLine();
    strip.destroy();
    document.removeEventListener('keydown', onKey);
    vv?.removeEventListener('resize', fit); removeEventListener('resize', fit);
    if (chrome) restore();
  }

  fillCard();
  playOther();
  return { unmount() { if (alive) { saveRound(store, round.i < round.queue.length ? round : null); cleanup(); } restore(); } };

  function drawEmpty() {
    replace(el, h('div', { class: 'practice pr-done stack' },
      h('h1', null, t('practice.sim')), h('p', null, pick.kind === 'mixed' ? t('practice.sim.nothing') : t('practice.sim.empty')),
      h('div', { class: 'pr-done-actions' }, h('a', { class: 'btn btn-primary pressable', href: '#/practice/situations' }, t('practice.sim.backTo')))));
    return restore;
  }
}

/* ------------------------------------------------------------------ */
/* Done                                                                */
/* ------------------------------------------------------------------ */

/**
 * The round's situations as a little map of chat bubbles: one per situation, its chunk in German, grouped by the
 * order they came, alternating sides; Good/Easy outlined in accent, Hard in ink, Again dashed.
 * @param {HTMLElement} el @param {import('../contract.js').ViewCtx} ctx @param {any} bank @param {Map<string, S.Item>} byId
 * @param {any} round @param {string} backTo @param {S.Pick} pick
 */
function drawDone(el, ctx, bank, byId, round, backTo, pick) {
  const { t, store } = ctx;
  const sum = S.summary(round, byId);
  const c = ctx.clock.ctx();
  const nextComp = S.compose({ items: [...byId.values()], cards: simCards(store), c, pick, start: simState(store).start, newLeft: simToday({ store, c, settings: ctx.settings() }).newLeft });
  const fig = h('span', { class: 'figure tnum' }, String(sum.total));
  const bubbles = sum.list.map((x, i) => {
    const title = fnName(bank, x.item.fn);
    const a = x.item.answers[0];
    const tone = x.g >= 3 ? 'is-good' : x.g === 2 ? 'is-hard' : 'is-again';
    return h('li', { class: ['sim-map-b', tone, i % 2 ? 'is-right' : 'is-left'], style: { '--i': String(Math.min(i, 16)) }, title },
      h('span', { class: 'sim-map-chunk', lang: 'de' }, S.chunkParts(a)[1]),
      h('span', { class: 'caption' }, t(`practice.sim.g${x.g}`)));
  });
  const good = sum.counts.good + sum.counts.easy;
  replace(el, h('div', { class: 'practice pr-done sim-done stack' },
    h('h1', null, fig, ' ', h('span', { class: 'pr-done-of' }, t('practice.sim.done.title', { n: sum.total }))),
    h('p', { class: 'caption tnum' }, `${t('practice.sim.done.counts', { good, hard: sum.counts.hard, again: sum.counts.again })} · ${t('practice.sim.done.time', { min: Math.max(1, Math.round(sum.ms / 60000)) })}`),
    h('section', { class: 'sim-map-wrap', 'aria-label': t('practice.sim.done.map') }, h('ul', { class: 'sim-map' }, bubbles)),
    h('div', { class: 'pr-done-actions' },
      nextComp.ids.length ? h('a', { class: 'btn btn-primary pressable', href: `#/practice/situations/round?pick=${encodeURIComponent(S.pickKey(pick))}${backTo === '/today' ? '&from=today' : ''}&r=${round.id}`, id: 'sim-again' }, t('practice.sim.another')) : null,
      h('a', { class: ['btn', 'pressable', !nextComp.ids.length && 'btn-primary'], href: `#${backTo}` }, t('practice.done')))));
  countTo(fig, sum.total, { from: 0, duration: 600 });
  requestAnimationFrame(() => el.querySelector('.sim-map')?.classList.add('is-in'));
  /** @type {HTMLElement | null} */ (el.querySelector('h1'))?.focus({ preventScroll: true });
}
