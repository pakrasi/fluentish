/* Word clusters in Practice:
     #/practice/clusters[/<type>]            pick a type (families, opposites, prefixes, suffixes, topics, prepositions)
                                             and a cluster: each row shows known of total and a mini field
     #/practice/clusters/<type>/<id>         the cluster: its words laid out as they are known, the note, and the rounds
     #/practice/clusters/<type>/<id>/say     the same cards said aloud and graded by himself (Again / Hard / Good / Easy)
     #/practice/round?kind=cluster:<type>:<id> | cluster:due   the typed round (round.js, graded by grade.js)

   The layouts move only through the kit (core/motion.js flip and countTo, core/brand.js Field), so reduced motion
   gets the final state at once:
     families    the head word on top and a branch for each prefix under it; a word joins its branch once known, the
                 rest wait in a tray below. After a round, the words he now knows fly from the tray to their branch.
     opposites   each pair on one line; a known pair sits together, a pair still to learn is held apart, and a pair
                 learnt in the round snaps together.
     the rest    the words as a block of type: known in ink, shaky grey, not known boxed, not seen pale italic
                 (Explore's encoding), and the known count ticks up from the last one shown. */
import { h, replace, announce } from '../../../core/dom.js';
import { notice } from '../../../core/ui.js';
import { icon } from '../../../core/icons.js';
import { flip, countTo, reduced, segments, swap, haptic } from '../../../core/motion.js';
import { Field } from '../../../core/brand.js';
import { TYPES } from '../../../domain/clusters.js';
import { roundMinutes } from '../../../domain/today.js';
import * as S from '../sim.js';
import { forecaster, tz, addActivity } from '../data.js';
import { loadClusters, loadKnowledge, countsOf, cellsOf, dueCards, recallOf, state, update, dayOf, DECK } from './data.js';
import { cardIds, itemFor, compose } from './items.js';
import { isDue } from '../../../domain/b1ready.js';

const back = (/** @type {string} */ href, /** @type {string} */ text) => h('a', { class: 'pr-backlink pressable', href }, icon('prev', { size: 16 }), text);
const STATE_CLS = /** @type {Record<string, string>} */ ({ known: 'is-known', shaky: 'is-shaky', unknown: 'is-unknown', unseen: 'is-unseen' });

/** @param {HTMLElement} el @param {import('../../contract.js').ViewCtx} ctx @param {string[]} rest */
export function mountClusters(el, ctx, rest) {
  const [type, id, sub] = rest;
  if (type && id && sub === 'say') return mountSay(el, ctx, `${type}:${id}`);
  if (type && id) return mountCluster(el, ctx, `${type}:${id}`);
  return mountPicker(el, ctx, /** @type {any} */ (TYPES.includes(/** @type {any} */ (type)) ? type : 'family'));
}

/** A word as type, in its knowledge state. @param {any} w @param {any} s a knowledge score */
function wordChip(w, s) {
  const art = w.pos === 'noun' && /^(der|die|das)$/.test(w.art) ? h('span', { class: 'cl-art' }, w.art, ' ') : null;
  return h('span', { class: ['cl-w', STATE_CLS[s.state], s.today && 'is-today'], lang: 'de', 'data-id': w.id }, art, w.w);
}

/* ------------------------------------------------------------------ */
/* Picker                                                              */
/* ------------------------------------------------------------------ */

/** @param {HTMLElement} el @param {import('../../contract.js').ViewCtx} ctx @param {string} type */
async function mountPicker(el, ctx, type) {
  const { t, store } = ctx;
  let alive = true;
  /** @type {Field[]} */ let fields = [];
  const head = () => [back('#/practice', t('practice.title')), h('div', { class: 'page-head' }, h('h1', null, t('practice.clusters.title')))];
  replace(el, h('div', { class: 'practice cl stack' }, head(), h('p', { class: 'caption' }, t('practice.loading'))));
  let data, k;
  try { [data, k] = await Promise.all([loadClusters(ctx), loadKnowledge(ctx)]); } catch {
    if (alive) replace(el, h('div', { class: 'practice cl stack' }, head(), notice({ kind: 'warning', children: [h('p', null, t('practice.clusters.loadFailed'))] })));
    return () => { alive = false; };
  }
  if (!alive) return;
  const c = ctx.clock.ctx();
  const due = dueCards(store, c).length;
  const typeChips = h('div', { class: 'chips cl-types', role: 'group', 'aria-label': t('practice.clusters.type') },
    TYPES.map(ty => h('a', { class: 'chip pressable', href: `#/practice/clusters/${ty}`, 'aria-current': ty === type ? 'page' : null, 'aria-pressed': String(ty === type) }, t(`practice.clusters.types.${ty}`))));
  const list = data.ix.byType[type] || [];
  const rows = list.map(cl => {
    const n = countsOf(cl, k);
    const canvas = h('canvas', { class: 'field cl-mini' });
    const row = h('a', { class: 'cl-row pressable', href: `#/practice/clusters/${cl.type}/${cl.id}`, 'aria-label': t('practice.clusters.rowLabel', { name: cl.label, known: n.known, n: n.n }) },
      h('span', { class: 'cl-row-top' }, h('span', { class: 'row-title', lang: cl.type === 'family' || cl.type === 'prefix' || cl.type === 'suffix' ? 'de' : null }, cl.label),
        h('span', { class: 'row-trail tnum' }, t('practice.clusters.of', { known: n.known, n: n.n }))),
      canvas);
    return { row, canvas, cells: cellsOf(cl, k) };
  });
  const view = h('div', { class: 'practice cl stack' }, head(),
    h('p', { class: 'lead' }, t(`practice.clusters.about.${type}`)),
    typeChips,
    due ? h('a', { class: 'btn btn-primary pressable cl-due', href: '#/practice/round?kind=cluster%3Adue' }, t('practice.clusters.due', { n: due, min: roundMinutes(Math.min(12, due)) })) : null,
    h('nav', { class: 'cl-list', 'aria-label': t(`practice.clusters.types.${type}`) }, rows.map(r => r.row)));
  replace(el, view);
  fields = rows.map(r => new Field(/** @type {HTMLCanvasElement} */ (r.canvas), r.cells, { cell: 5, gap: 1, label: null }));
  return () => { alive = false; fields.forEach(f => f.destroy()); };
}

/* ------------------------------------------------------------------ */
/* One cluster                                                         */
/* ------------------------------------------------------------------ */

/**
 * The layout of a cluster's words. before: the knowledge before a round (the words then move to where they are now).
 * @param {any} cl @param {any} ix @param {any} content @param {any} k @param {(k: string, v?: any) => string} t
 */
export function clusterLayout(cl, ix, content, k, t) {
  const W = (/** @type {string} */ id) => ix.word(id);
  const sc = (/** @type {string} */ id) => k.get(`W:${id}`);
  if (cl.type === 'family') {
    const head = W(cl.head);
    /** @type {Map<string, string[]>} */ const branches = new Map();
    for (const id of cl.items) {
      if (id === cl.head) continue;
      const p = (content.morph[id]?.pre || [])[0] || '';
      if (!branches.has(p)) branches.set(p, []);
      /** @type {string[]} */ (branches.get(p)).push(id);
    }
    const tray = h('div', { class: 'cl-tray', 'aria-label': t('practice.clusters.toLearn') });
    const slots = new Map();
    const tree = h('div', { class: 'cl-tree' },
      h('p', { class: 'cl-head' }, wordChip(head, sc(cl.head))),
      h('div', { class: 'cl-branches' }, [...branches.entries()].sort((a, b) => (a[0] ? 1 : 0) - (b[0] ? 1 : 0) || a[0].localeCompare(b[0])).map(([p, ids]) => {
        const slot = h('span', { class: 'cl-leaves' });
        for (const id of ids) slots.set(id, slot);
        return h('div', { class: 'cl-branch', hidden: true }, h('span', { class: 'cl-pre', lang: 'de' }, p ? `${p}-` : t('practice.clusters.noPrefix')), slot);
      })),
      h('p', { class: 'caption cl-empty' }, t('practice.clusters.treeEmpty')));
    /** Place each word: known in its branch, the rest in the tray. @param {any} kk */
    const place = kk => {
      const old = new Map([...tree.querySelectorAll('.cl-leaves .cl-w'), ...tray.querySelectorAll('.cl-w')].map(ch => [/** @type {HTMLElement} */ (ch).dataset.id, ch]));
      for (const id of cl.items) {
        if (id === cl.head) continue;
        const s = kk.get(`W:${id}`);
        // the same element moves (so flip() can animate it); its class follows the state
        const chip = old.get(id) || wordChip(W(id), s);
        chip.className = ['cl-w', STATE_CLS[s.state], s.today ? 'is-today' : ''].join(' ').trim();
        (s.state === 'known' ? slots.get(id) : tray).append(chip);
      }
      const hs = kk.get(`W:${cl.head}`), hc = /** @type {HTMLElement} */ (tree.querySelector('.cl-head .cl-w'));
      hc.className = ['cl-w', STATE_CLS[hs.state], hs.today ? 'is-today' : ''].join(' ').trim();
      // a branch shows once it has a word he knows
      let any = false;
      tree.querySelectorAll('.cl-branch').forEach(b => { const has = !!b.querySelector('.cl-w'); /** @type {HTMLElement} */ (b).hidden = !has; any = any || has; });
      /** @type {HTMLElement} */ (tree.querySelector('.cl-empty')).hidden = any;
    };
    return { el: h('div', { class: 'cl-family' }, tree, h('p', { class: 'label cl-tray-label' }, t('practice.clusters.toLearn')), tray), place, tree, tray };
  }
  if (cl.type === 'opp') {
    const rows = (cl.pairs || []).map((/** @type {any} */ p) => {
      const a = W(p.a), b = W(p.b);
      return h('li', { class: 'cl-pair', 'data-a': p.a, 'data-b': p.b }, wordChip(a, sc(p.a)), h('span', { class: 'cl-link', 'aria-hidden': 'true' }), wordChip(b, sc(p.b)));
    });
    /** @param {any} kk */
    const place = kk => {
      for (const r of rows) {
        const both = [r.dataset.a, r.dataset.b].every(id => kk.get(`W:${id}`).state === 'known');
        r.classList.toggle('is-snapped', both);
        r.querySelectorAll('.cl-w').forEach(ch => { const s = kk.get(`W:${/** @type {HTMLElement} */ (ch).dataset.id}`); ch.className = ['cl-w', STATE_CLS[s.state], s.today ? 'is-today' : ''].join(' ').trim(); });
      }
    };
    return { el: h('ul', { class: 'cl-pairs', role: 'list' }, rows), place };
  }
  if (cl.type === 'prep') {
    const notes = cl.items.map((/** @type {string} */ id) => {
      const n = content.preps.notes[id]; const w = W(id);
      return h('li', { class: 'cl-prep' }, h('p', { class: 'cl-prep-head' }, wordChip(w, sc(id)), n && n.case ? h('span', { class: 'caption' }, t(`practice.clusters.case.${n.case}`)) : null),
        n ? h('p', { class: 'cl-prep-note' }, n.note) : null,
        n ? n.ex.map((/** @type {[string, string]} */ [de, en]) => h('p', { class: 'cl-prep-ex' }, h('span', { lang: 'de' }, de), h('span', { class: 'caption' }, ` ${en}`))) : null);
    });
    /** @param {any} kk */
    const place = kk => { el.querySelectorAll('.cl-w').forEach(ch => { const s = kk.get(`W:${/** @type {HTMLElement} */ (ch).dataset.id}`); ch.className = ['cl-w', STATE_CLS[s.state]].join(' '); }); };
    const el = h('ul', { class: 'cl-preps', role: 'list' }, notes);
    return { el, place };
  }
  const block = h('p', { class: 'cl-block' }, cl.items.map((/** @type {string} */ id) => [wordChip(W(id), sc(id)), ' ']));
  /** @param {any} kk */
  const place = kk => { block.querySelectorAll('.cl-w').forEach(ch => { const s = kk.get(`W:${/** @type {HTMLElement} */ (ch).dataset.id}`); ch.className = ['cl-w', STATE_CLS[s.state], s.today ? 'is-today' : ''].join(' ').trim(); }); };
  return { el: block, place };
}

/**
 * Move a layout from the state before a round to now: known words fly to their branch, pairs snap, the count ticks.
 * @param {any} lay clusterLayout() built with `before` @param {any} after @param {HTMLElement | null} countEl @param {number} to
 */
export async function settle(lay, after, countEl, to) {
  const chips = [...lay.el.querySelectorAll('.cl-w, .cl-pair')];
  await flip(chips, () => lay.place(after), { easing: 'var(--spring-soft)' });
  if (countEl) countTo(countEl, to, { duration: 700 });
}

/** @param {HTMLElement} el @param {import('../../contract.js').ViewCtx} ctx @param {string} key */
async function mountCluster(el, ctx, key) {
  const { t, store } = ctx;
  let alive = true;
  const [type] = key.split(':');
  const backLink = back(`#/practice/clusters/${type}`, t('practice.clusters.title'));
  replace(el, h('div', { class: 'practice cl stack' }, backLink, h('p', { class: 'caption' }, t('practice.loading'))));
  let data, k;
  try { [data, k] = await Promise.all([loadClusters(ctx), loadKnowledge(ctx)]); } catch {
    if (alive) replace(el, h('div', { class: 'practice cl stack' }, backLink, notice({ kind: 'warning', children: [h('p', null, t('practice.clusters.loadFailed'))] })));
    return () => { alive = false; };
  }
  if (!alive) return;
  const cl = data.ix.byKey.get(key);
  if (!cl) { replace(el, h('div', { class: 'practice cl stack' }, backLink, h('h1', null, t('error.notFound')))); return; }
  const c = ctx.clock.ctx();
  const n = countsOf(cl, k);
  const shown = (state(store).shown || {})[key];
  const countEl = h('span', { class: 'figure tnum' }, String(shown ?? n.known));
  const lay = clusterLayout(cl, data.ix, data.c, k, t);
  lay.place(k);
  const ids = cardIds(cl, data.ix);
  const cards = store.cards(DECK) || {};
  const plan = compose({ ids, cards, c, isDue: rec => isDue(rec, c.today, c), recall: recallOf(c) });
  const startN = plan.ids.length;
  const typed = startN ? h('a', { class: 'btn btn-primary pressable', href: `#/practice/round?kind=${encodeURIComponent(`cluster:${key}`)}` },
    plan.extra ? t('practice.clusters.ahead', { n: startN }) : t('practice.clusters.typed', { n: startN, min: roundMinutes(startN) })) : null;
  const say = startN ? h('a', { class: 'btn pressable', href: `#/practice/clusters/${type}/${cl.id}/say` }, t('practice.clusters.say')) : null;
  const head = cl.type === 'family' ? h('p', { class: 'lead' }, t('practice.clusters.familyLead', { note: cl.note || '' }))
    : cl.note ? h('p', { class: 'lead cl-note' }, cl.note) : null;
  const view = h('div', { class: ['practice', 'cl', 'stack', startN && 'has-dock'] }, backLink,
    h('p', { class: 'label cl-eyebrow' }, t(`practice.clusters.types.${cl.type}`)),
    h('div', { class: 'page-head' }, h('h1', { lang: cl.type === 'family' ? 'de' : null }, cl.label)),
    head,
    h('p', { class: 'cl-count' }, countEl, h('span', { class: 'label' }, t('practice.clusters.knownOf', { n: n.n }))),
    h('p', { class: 'caption cl-legend' }, h('span', { class: 'cl-w is-known' }, t('practice.clusters.legend.known')), ' ', h('span', { class: 'cl-w is-shaky' }, t('practice.clusters.legend.shaky')), ' ',
      h('span', { class: 'cl-w is-unknown' }, t('practice.clusters.legend.unknown')), ' ', h('span', { class: 'cl-w is-unseen' }, t('practice.clusters.legend.unseen'))),
    lay.el,
    startN ? h('div', { class: 'cl-dock pr-queue-btn' }, typed, say) : h('p', { class: 'pr-empty' }, t('practice.clusters.nothing')));
  replace(el, view);
  update(store, s => ({ ...s, last: key, shown: { ...(s.shown || {}), [key]: n.known } }));
  if (shown != null && shown !== n.known) countTo(countEl, n.known, { from: shown, duration: 700 });
  return () => { alive = false; };
}

/* ------------------------------------------------------------------ */
/* The done screen of a cluster round (typed or said)                  */
/* ------------------------------------------------------------------ */

/**
 * @param {HTMLElement} el @param {import('../../contract.js').ViewCtx} ctx
 * @param {{key: string | null, right: number, total: number, prev: Record<string, any>, again: string}} o
 *   key: the cluster ('<type>:<id>'), null for a due round; prev: the cards before the round (id → record or null)
 */
export async function drawClusterDone(el, ctx, { key, right, total, prev, again }) {
  const { t, store } = ctx;
  const [data, after, before] = await Promise.all([loadClusters(ctx), loadKnowledge(ctx), loadKnowledge(ctx, { patch: { [DECK]: prev } })]);
  const cl = key ? data.ix.byKey.get(key) : null;
  const backHref = cl ? `#/practice/clusters/${cl.type}/${cl.id}` : '#/practice/clusters';
  const n0 = cl ? countsOf(cl, before).known : 0, n1 = cl ? countsOf(cl, after).known : 0;
  const countEl = h('span', { class: 'figure tnum' }, String(n0));
  const lay = cl ? clusterLayout(cl, data.ix, data.c, before, t) : null;
  if (lay) lay.place(before);
  replace(el, h('div', { class: 'practice pr-done cl stack' },
    h('section', { class: 'hero pr-done-hero' },
      h('p', { class: 'label' }, t('practice.roundDone')),
      h('h1', null, h('span', { class: 'figure tnum' }, String(right)), ' ', h('span', { class: 'pr-done-of' }, t('practice.ofRight', { n: total })))),
    cl ? h('p', { class: 'cl-count' }, countEl, h('span', { class: 'label' }, t('practice.clusters.knownIn', { n: countsOf(cl, after).n, name: cl.label }))) : null,
    lay ? lay.el : null,
    h('div', { class: 'pr-done-actions' },
      h('a', { class: 'btn btn-primary pressable', href: again, id: 'pr-again' }, t('practice.clusters.another')),
      h('a', { class: 'btn pressable', href: backHref }, cl ? t('practice.clusters.backTo', { name: cl.label }) : t('practice.clusters.title')))));
  if (cl) update(store, s => ({ ...s, shown: { ...(s.shown || {}), [cl.key]: n1 } }));
  el.querySelector('h1')?.setAttribute('tabindex', '-1');
  /** @type {HTMLElement | null} */ (el.querySelector('h1'))?.focus({ preventScroll: true });
  if (lay) setTimeout(() => settle(lay, after, countEl, n1), reduced() ? 0 : 420);
  if (n1 > n0) announce(t('practice.clusters.nowKnown', { n: n1 - n0 }));
}

/* ------------------------------------------------------------------ */
/* Say it: self-graded                                                 */
/* ------------------------------------------------------------------ */

/** @param {HTMLElement} el @param {import('../../contract.js').ViewCtx} ctx @param {string} key */
async function mountSay(el, ctx, key) {
  const { t, store } = ctx;
  document.body.dataset.chrome = 'off';
  document.body.classList.add('pr-in-round');
  const restore = () => { document.body.dataset.chrome = 'on'; document.body.classList.remove('pr-in-round'); };
  const [type, cid] = key.split(':');
  const backTo = `#/practice/clusters/${type}/${cid}`;
  let data;
  try { data = await loadClusters(ctx); } catch { ctx.go(`/practice/clusters/${type}/${cid}`, { replace: true }); return restore; }
  const cl = data.ix.byKey.get(key);
  if (!cl) { ctx.go('/practice/clusters', { replace: true }); return restore; }
  let c = ctx.clock.ctx();
  const plan = compose({ ids: cardIds(cl, data.ix), cards: store.cards(DECK) || {}, c, isDue: rec => isDue(rec, c.today, c), recall: recallOf(c) });
  if (!plan.ids.length) { ctx.go(`/practice/clusters/${type}/${cid}`, { replace: true }); return restore; }
  const round = { queue: plan.ids.map(id => ({ id })), i: 0, results: /** @type {any[]} */ ([]), planned: plan.ids.length };
  /** @type {Record<string, any>} */ const prev = {};
  const t0r = performance.now();
  const items = new Map(plan.ids.map(id => [id, itemFor(id, data.ix, data.c, { t })]));

  const segs = h('div', { class: 'segments', 'aria-label': t('practice.progress') });
  const count = h('span', { class: 'caption tnum' });
  const endBtn = h('button', { type: 'button', class: 'btn btn-quiet pressable pr-end', onclick: () => finish(true) }, t('practice.end'), h('kbd', null, 'Esc'));
  const meta = h('span', { class: 'label' });
  const task = h('p', { class: 'pr-task' });
  const prompt = h('p', { class: 'prompt' });
  const sayHint = h('p', { class: 'caption sim-say' }, t('practice.clusters.sayHint'));
  const answer = h('p', { class: 'answer-key', lang: 'de' });
  const extra = h('div', { class: 'cl-say-extra' });
  const reveal = h('div', { class: 'reveal-answer' }, h('div', null, answer, extra));
  const card = h('article', { class: 'card pr-card' }, h('div', { class: 'card-meta' }, meta), task, prompt, sayHint, reveal);
  const showBtn = h('button', { type: 'button', class: 'btn btn-primary pressable pr-primary', onclick: () => doReveal() }, t('practice.sim.show'), h('kbd', null, 'Space'));
  const gradeBtns = /** @type {HTMLButtonElement[]} */ ([1, 2, 3, 4].map(g => h('button', { type: 'button', class: ['sim-g', 'pressable', g === 3 && 'is-main'], style: { '--i': String(g - 1) }, onclick: () => grade(/** @type {1|2|3|4} */ (g)) },
    h('span', { class: 'sim-g-name' }, t(`practice.sim.g${g}`)), h('kbd', null, String(g)))));
  const grades = h('div', { class: 'sim-grades', role: 'group', 'aria-label': t('practice.sim.how'), hidden: true }, gradeBtns);
  const box = h('div', { class: 'pr-round sim-round is-docked', role: 'region', 'aria-label': t('practice.clusters.sayTitle') },
    h('div', { class: 'pr-top' }, segs, h('div', { class: 'pr-top-row' }, count, endBtn)), h('div', { class: 'pr-scroll' }, card), h('div', { class: 'card-actions pr-actions sim-actions' }, showBtn, grades));
  replace(el, h('h1', { class: 'sr-only' }, t('practice.clusters.sayTitle')), box);
  const vv = window.visualViewport;
  const fit = () => { box.style.height = `${vv ? vv.height : innerHeight}px`; };
  vv?.addEventListener('resize', fit); addEventListener('resize', fit); fit();

  let st = 'think', busy = false, t0 = 0, alive = true;
  /** @type {any} */ let it = null;
  const dots = (answered = false) => round.queue.map((_, i) => (i === round.i && !answered ? 'now' : i > round.i || !round.results[i] ? '' : round.results[i].g === 1 ? 'miss' : 'done'));
  function fill() {
    it = items.get(round.queue[round.i].id) || itemFor(round.queue[round.i].id, data.ix, data.c, { t });
    meta.textContent = t(`practice.clusters.types.${cl.type}`);
    task.textContent = it.task || '';
    prompt.lang = it.promptLang === 'de' ? 'de' : 'en';
    prompt.textContent = it.gap ? it.prompt.replace('___', '…') : it.prompt;
    answer.textContent = it.gap ? it.model : (it.card ? it.card.head : it.model);
    replace(extra, it.usage ? h('p', { class: 'pr-rule' }, it.usage) : null, it.card && it.card.ex ? h('p', { class: 'caption' }, h('span', { lang: 'de' }, it.card.ex), it.card.exEn ? ` (${it.card.exEn})` : null) : null);
    reveal.classList.remove('is-open'); sayHint.hidden = false;
    showBtn.hidden = false; grades.hidden = true; grades.classList.remove('is-in');
    gradeBtns.forEach(b => { b.classList.remove('is-picked', 'is-other'); b.disabled = false; });
    segments(segs, dots()); count.textContent = t('practice.count', { n: round.i + 1, total: round.queue.length });
    st = 'think'; t0 = performance.now();
  }
  function doReveal() {
    if (st !== 'think') return;
    st = 'revealed'; reveal.classList.add('is-open'); sayHint.hidden = true; showBtn.hidden = true; grades.hidden = false;
    requestAnimationFrame(() => grades.classList.add('is-in'));
    announce(answer.textContent || '');
    gradeBtns[2].focus({ preventScroll: true });
  }
  /** @param {1|2|3|4} g */
  function grade(g) {
    if (st !== 'revealed' || busy) return;
    busy = true; st = 'graded';
    const id = it.id;
    const cards = store.cards(DECK) || {};
    const before = cards[id] ? structuredClone(cards[id]) : null;
    if (!(id in prev)) prev[id] = before;
    c = ctx.clock.ctx();
    const res = S.gradeCard({ rec: before, g, c, now: Date.now(), ms: performance.now() - t0, forecast: forecaster(cards, c), src: 'practice' });
    if (res.rec) {
      store.putCards(DECK, [[id, res.rec]]);
      store.append('card.reviewed', { deck: DECK, itemId: id, g, ms: Math.round(performance.now() - t0), flags: '', mode: 's', ctx: { exam: c.exam, phase: c.phase, tz: tz() },
        base: before ? { u: before.u ?? null, reps: before.reps ?? 0 } : null, post: res.rec });
    }
    if (!before || !before.reps) update(store, s => { const d = dayOf(store, c.today); return { ...s, day: { ...d, newShown: d.newShown + 1 } }; });
    S.record(round, { id, g, isNew: !before || !before.reps, ms: performance.now() - t0, reinsert: res.reinsert });
    haptic();
    gradeBtns.forEach((b, k) => { b.classList.toggle('is-picked', k === g - 1); b.classList.toggle('is-other', k !== g - 1); b.disabled = true; });
    segments(segs, dots(true));
    setTimeout(next, reduced() ? 120 : 260);
  }
  async function next() {
    if (!alive) return;
    if (!S.advance(round)) return finish(false);
    await swap(() => fill(), { kind: 'forward', fallbackEl: card });
    busy = false;
  }
  function finish(/** @type {boolean} */ early) {
    if (!alive) return;
    alive = false; cleanup();
    addActivity(store, c.today, { minutes: Math.min(30, (performance.now() - t0r) / 60000), rounds: early ? 0 : 1 });
    if (!early) update(store, s => { const d = dayOf(store, c.today); return { ...s, day: { ...d, rounds: d.rounds + 1 } }; });
    const firsts = round.results.filter((/** @type {any} */ r) => r.first);
    if (early && !firsts.length) { ctx.go(`/practice/clusters/${type}/${cid}`); return; }
    restore();
    drawClusterDone(el, ctx, { key, right: firsts.filter((/** @type {any} */ r) => r.g >= 3).length, total: firsts.length, prev, again: `#/practice/clusters/${type}/${cid}/say` });
  }
  const onKey = (/** @type {KeyboardEvent} */ e) => {
    if (e.key === 'Escape') { e.preventDefault(); finish(true); return; }
    if (st === 'think' && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); doReveal(); return; }
    if (st === 'revealed' && ['1', '2', '3', '4'].includes(e.key)) { e.preventDefault(); grade(/** @type {1|2|3|4} */ (Number(e.key))); return; }
    if (st === 'revealed' && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); grade(3); }
  };
  document.addEventListener('keydown', onKey);
  const cleanup = () => { document.removeEventListener('keydown', onKey); vv?.removeEventListener('resize', fit); removeEventListener('resize', fit); };
  fill();
  return () => { if (alive) { alive = false; cleanup(); } restore(); };
}
