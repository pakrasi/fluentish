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
import { countTo, reduced, swap, haptic } from '../../../core/motion.js';
import { gradeRow } from '../selfgrade.js';
import { progressOf, drawProgress, againRow } from '../progress.js';
import { doneHero, againLink } from '../done-hero.js';
import { Field } from '../../../core/brand.js';
import { TYPES } from '../../../domain/clusters.js';
import { roundMinutes } from '../../../domain/today.js';
import * as S from '../sim.js';
import { forecaster, tz, addActivity } from '../data.js';
import { loadClusters, loadKnowledge, countsOf, cellsOf, dueCards, recallOf, state, update, dayOf, DECK } from './data.js';
import { cardIds, itemFor, compose, roundWords, partOf } from './items.js';
import { isDue } from '../../../domain/b1ready.js';
import { marked } from '../../../data/known.js';
import { skipsNew } from '../../../domain/known.js';
import { knowButton, isKnowKey, knowCard, knownResult } from '../iknow.js';

const back = (/** @type {string} */ href, /** @type {string} */ text) => h('a', { class: 'pr-backlink pressable', href }, icon('prev', { size: 16 }), text);
const STATE_CLS = /** @type {Record<string, string>} */ ({ known: 'is-known', shaky: 'is-shaky', unknown: 'is-unknown', unseen: 'is-unseen' });

/** @param {HTMLElement} el @param {import('../../contract.js').ViewCtx} ctx @param {string[]} rest */
export function mountClusters(el, ctx, rest) {
  const [type, id, sub] = rest;
  if (type && id && sub === 'say') return mountSay(el, ctx, `${type}:${id}`);
  if (type && id) return mountCluster(el, ctx, `${type}:${id}`);
  return mountPicker(el, ctx, /** @type {any} */ (TYPES.includes(/** @type {any} */ (type)) ? type : ORDER[0]));
}

/** The cluster types in the order of the Explore map's modes (Topic, Word family, Opposites …). */
const ORDER = ['topic', 'family', 'opp', 'prefix', 'suffix', 'prep'].filter(x => TYPES.includes(/** @type {any} */ (x)));
const B1_LEVELS = new Set(['A1', 'A2', 'B1']);

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
    ORDER.map(ty => h('a', { class: 'chip pressable', href: `#/practice/clusters/${ty}`, 'aria-current': ty === type ? 'page' : null, 'aria-pressed': String(ty === type) }, t(`practice.clusters.types.${ty}`))));
  const list = data.ix.byType[type] || [];
  // "Start with": the five groups with the most words up to B1 he does not know yet
  const open = (/** @type {any} */ cl) => cl.items.filter((/** @type {string} */ id) => B1_LEVELS.has(data.ix.word(id)?.level) && k.get(`W:${id}`).state !== 'known').length;
  const best = [...list].map(cl => ({ cl, n: open(cl) })).filter(x => x.n > 0).sort((a, b) => b.n - a.n).slice(0, 5).map(x => x.cl);
  const rowOf = (/** @type {any} */ cl) => {
    const n = countsOf(cl, k);
    // the strip of cells reads as data only with a few words; under six it would look like a loading bar
    const canvas = cl.items.length >= 6 ? h('canvas', { class: 'field cl-mini' }) : null;
    const row = h('a', { class: 'cl-row pressable', href: `#/practice/clusters/${cl.type}/${cl.id}`, 'aria-label': t('practice.clusters.rowLabel', { name: cl.label, known: n.known, n: n.n }) },
      h('span', { class: 'cl-row-top' }, h('span', { class: 'row-title', lang: cl.type === 'family' || cl.type === 'prefix' || cl.type === 'suffix' ? 'de' : null }, cl.label),
        h('span', { class: 'row-trail tnum' }, t('practice.clusters.of', { known: n.known, n: n.n }))),
      canvas);
    return { row, canvas, cells: cellsOf(cl, k) };
  };
  const rows = list.map(rowOf);
  const firstRows = list.length > 8 ? best.map(rowOf) : [];
  const view = h('div', { class: 'practice cl stack' }, head(),
    h('p', { class: 'lead' }, t(`practice.clusters.about.${type}`)),
    typeChips,
    due ? h('a', { class: 'btn btn-primary pressable cl-due', href: '#/practice/round?kind=cluster%3Adue' }, t('practice.clusters.due', { n: due, min: roundMinutes(Math.min(12, due)) })) : null,
    firstRows.length ? h('section', { class: 'cl-first' }, h('h2', { class: 'label' }, t('practice.clusters.startWith')),
      h('nav', { class: 'cl-list', 'aria-label': t('practice.clusters.startWith') }, firstRows.map(r => r.row))) : null,
    firstRows.length ? h('h2', { class: 'label cl-all' }, t('practice.clusters.all', { n: list.length })) : null,
    h('nav', { class: 'cl-list', 'aria-label': t(`practice.clusters.types.${type}`) }, rows.map(r => r.row)));
  replace(el, view);
  fields = [...firstRows, ...rows].filter(r => r.canvas).map(r => new Field(/** @type {HTMLCanvasElement} */ (r.canvas), r.cells, { cell: 5, gap: 1, label: null }));
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
 * Move a layout from the state before a round to now (DESIGN.md motion.earned.pair-snap): each pair or word that
 * changed lands in turn, 140 ms apart, on the pop spring; a snapped pair's link draws in and a soft accent plate fades
 * under it (the clusters' version of the field ripple). The count starts ticking when the first one lands, and a
 * haptic tick marks each of the first three. Reduced motion: the final state at once.
 * @param {any} lay clusterLayout() built with `before` @param {any} after @param {HTMLElement | null} countEl @param {number} to
 */
export async function settle(lay, after, countEl, to) {
  if (reduced()) { lay.place(after); if (countEl) countTo(countEl, to); return; }
  const all = /** @type {HTMLElement[]} */ ([...lay.el.querySelectorAll('.cl-w, .cl-pair, .cl-link')]);
  const snap = () => new Map(all.map(x => [x, { cls: x.className, r: x.getBoundingClientRect() }]));
  const before = snap();
  lay.place(after);
  const now = snap();
  const B = (/** @type {HTMLElement} */ x) => /** @type {{cls: string, r: DOMRect}} */ (before.get(x)), N = (/** @type {HTMLElement} */ x) => /** @type {{cls: string, r: DOMRect}} */ (now.get(x));
  const isPair = (/** @type {HTMLElement} */ x) => x.classList.contains('cl-pair');
  const turned = (/** @type {HTMLElement} */ x) => B(x).cls !== N(x).cls;
  // the units that land one by one: a pair that snapped, or a word whose state changed (outside a snapped pair)
  const units = all.filter(x => !x.classList.contains('cl-link') && turned(x) && !(x.parentElement && isPair(x.parentElement) && turned(x.parentElement)));
  const ease = getComputedStyle(document.documentElement).getPropertyValue('--spring-pop').trim() || 'ease-out';
  const soft = getComputedStyle(document.documentElement).getPropertyValue('--spring-soft').trim() || 'ease-out';
  const parts = (/** @type {HTMLElement} */ u) => (isPair(u) ? [u, .../** @type {HTMLElement[]} */ ([...u.querySelectorAll('.cl-w, .cl-link')])] : [u]);
  // hold every unit in its old look and place until its turn
  for (const u of units) for (const x of parts(u)) x.className = B(x).cls;
  const held = new Map(units.filter(u => !isPair(u)).map(u => { const a = B(u).r, b = u.getBoundingClientRect(); return [u, `translate(${a.left - b.left}px, ${a.top - b.top}px)`]; }));
  held.forEach((tr, u) => { u.style.transform = tr; });
  // what only moved aside (the tray closing up) settles at once
  for (const x of all) {
    if (units.some(u => parts(u).includes(x)) || x.classList.contains('cl-link')) continue;
    const a = B(x).r, b = x.getBoundingClientRect();
    if (Math.abs(a.left - b.left) > 0.5 || Math.abs(a.top - b.top) > 0.5) x.animate([{ transform: `translate(${a.left - b.left}px, ${a.top - b.top}px)` }, { transform: 'none' }], { duration: 380, easing: soft });
  }
  if (!units.length) { if (countEl) countTo(countEl, to, { duration: 700 }); return; }
  await Promise.all(units.map((u, n) => new Promise(resolve => setTimeout(() => {
    if (n < 3) haptic();
    if (n === 0 && countEl) countTo(countEl, to, { duration: 700 });
    const ps = parts(u);
    const r0 = new Map(ps.map(x => [x, x.getBoundingClientRect()]));
    const tr = held.get(u);
    if (tr) u.style.transform = '';
    for (const x of ps) x.className = N(x).cls;
    const anims = ps.map(x => {
      if (x === u && tr) return x.animate([{ transform: tr }, { transform: 'none' }], { duration: 560, easing: ease });
      const a = /** @type {DOMRect} */ (r0.get(x)), b = x.getBoundingClientRect();
      if (x.classList.contains('cl-link')) return b.width ? x.animate([{ transform: `translateX(${a.left - b.left}px) scaleX(${a.width / b.width})` }, { transform: 'none' }], { duration: 560, easing: ease }) : null;
      return Math.abs(a.left - b.left) > 0.5 ? x.animate([{ transform: `translateX(${a.left - b.left}px)` }, { transform: 'none' }], { duration: 560, easing: ease }) : null;
    }).filter(Boolean);
    // the soft accent plate under what just landed, fading over 1.3 s (as Explore's "learned today")
    u.classList.add('is-landing');
    setTimeout(() => u.classList.remove('is-landing'), 1300);
    Promise.all(anims.map(a => /** @type {Animation} */ (a).finished.catch(() => {}))).then(resolve);
  }, n * 140))));
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
  const mk = marked(store);
  const plan = compose({ ids, cards, c, isDue: rec => isDue(rec, c.today, c), recall: recallOf(c), skip: x => skipsNew(mk, x) });
  const startN = plan.ids.length;
  const typed = startN ? h('a', { class: 'btn btn-primary pressable', href: `#/practice/round?kind=${encodeURIComponent(`cluster:${key}`)}` },
    plan.extra ? t('practice.clusters.ahead', { n: startN }) : t('practice.clusters.typed', { n: startN, min: roundMinutes(startN) })) : null;
  const say = startN ? h('a', { class: 'btn pressable', href: `#/practice/clusters/${type}/${cl.id}/say` }, t('practice.clusters.say')) : null;
  const head = cl.type === 'family' ? h('p', { class: 'lead' }, t('practice.clusters.familyLead', { note: cl.note || '' }))
    : cl.note ? h('p', { class: 'lead cl-note' }, cl.note) : null;
  const view = h('div', { class: ['practice', 'cl', 'cl-page', 'stack', startN && 'has-dock'] }, backLink,
    h('p', { class: 'label cl-eyebrow' }, t(`practice.clusters.types.${cl.type}`)),
    h('div', { class: 'page-head' }, h('h1', { lang: cl.type === 'family' ? 'de' : null }, cl.label)),
    head,
    h('p', { class: 'cl-count' }, countEl, h('span', { class: 'label' }, t('practice.clusters.knownOf', { n: n.n }))),
    h('p', { class: 'caption cl-legend' }, h('span', { class: 'cl-w is-known' }, t('practice.clusters.legend.known')), ' ', h('span', { class: 'cl-w is-shaky' }, t('practice.clusters.legend.shaky')), ' ',
      h('span', { class: 'cl-w is-unknown' }, t('practice.clusters.legend.unknown')), ' ', h('span', { class: 'cl-w is-unseen' }, t('practice.clusters.legend.unseen'))),
    lay.el,
    h('p', { class: 'cl-links' }, n.known < n.n ? h('a', { class: 'btn btn-quiet pressable cl-map', href: `#/practice/sort?cluster=${encodeURIComponent(key)}&from=cluster` }, t('practice.clusters.sort')) : null,
      h('a', { class: 'btn btn-quiet pressable cl-map', href: `#/lookup/map?cluster=${encodeURIComponent(key)}` }, icon('next', { size: 16 }), t('practice.clusters.onMap'))),
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
 * The done screen of a cluster round (typed or said). Its data object is this round's words, landing where they now
 * belong, and the whole cluster as a compact field with one count line ("7 of 223 known in Describing words"); never
 * the whole cluster as type, which on a big cluster pushed the buttons off the page.
 * @param {HTMLElement} el @param {import('../../contract.js').ViewCtx} ctx
 * @param {{key: string | null, right: number, total: number, prev: Record<string, any>, again: string, fromMap?: boolean, known?: number}} o
 *   key: the cluster ('<type>:<id>'), null for a due round; prev: the cards before the round (id → record or null);
 *   known: cards marked "I know this" in the round
 */
export async function drawClusterDone(el, ctx, { key, right, total, prev, again, fromMap = false, known = 0 }) {
  const { t, store } = ctx;
  const [data, after, before] = await Promise.all([loadClusters(ctx), loadKnowledge(ctx), loadKnowledge(ctx, { patch: { [DECK]: prev } })]);
  const cl = key ? data.ix.byKey.get(key) : null;
  const backHref = fromMap ? '#/lookup/map' : cl ? `#/practice/clusters/${cl.type}/${cl.id}` : '#/practice/clusters';
  const n0 = cl ? countsOf(cl, before).known : 0, n1 = cl ? countsOf(cl, after).known : 0;
  const countEl = h('span', { class: 'tnum' }, String(n0));
  // this round's words, in the cluster's own layout when there is one (a due round mixes clusters: a block of words)
  const words = roundWords(prev, cl, data.c).filter(w => data.ix.word(w));
  const part = words.length ? (cl ? partOf(cl, words) : { type: 'topic', items: words }) : null;
  const lay = part ? clusterLayout(part, data.ix, data.c, before, t) : null;
  if (lay) lay.place(before);
  const fieldEl = cl && cl.items.length >= 6 ? h('canvas', { class: 'field cl-done-field' }) : null;
  const hero = doneHero({ label: t('practice.roundDone'), figure: right, of: t('practice.ofRight', { n: total }),
    lines: [known ? t('practice.know.inRound', { n: known }) : null],
    data: h('div', { class: 'cl-done-data' },
      lay ? h('section', { class: 'cl-done-words', 'aria-label': t('practice.clusters.roundWords') }, h('h2', { class: 'label' }, t('practice.clusters.roundWords')), lay.el) : null,
      cl ? h('div', { class: 'cl-done-all' }, h('p', { class: 'cl-count cl-count-line' }, countEl, ' ', h('span', null, t('practice.clusters.knownIn', { n: countsOf(cl, after).n, name: cl.label }))), fieldEl) : null) });
  replace(el, h('div', { class: 'practice pr-done cl stack' },
    hero.el,
    h('div', { class: 'pr-done-actions' },
      againLink(ctx, again, t('practice.clusters.another'), { id: 'pr-again' }),
      h('a', { class: 'btn pressable', href: backHref, id: 'pr-done' }, t('practice.done')))));
  const stop = hero.start();
  /** @type {Field | null} */ let field = null;
  if (cl && fieldEl) {
    // the whole cluster: the cells this round moved start where they were and land one after another
    const a = cellsOf(cl, after), b = cellsOf(cl, before);
    field = new Field(/** @type {HTMLCanvasElement} */ (fieldEl), b.map((x, i) => Math.min(x, a[i])), { cell: 5, gap: 1, label: null });
    const moved = a.map((x, i) => (x !== b[i] ? i : -1)).filter(i => i >= 0);
    moved.slice(0, 24).forEach((i, k) => setTimeout(() => field?.ripple(i, { state: a[i] }), reduced() ? 0 : 640 + k * 90));
    moved.slice(24).forEach(i => field?.set(i, a[i]));
  }
  addEventListener('hashchange', () => { stop(); field?.destroy(); }, { once: true });
  if (cl) update(store, s => ({ ...s, shown: { ...(s.shown || {}), [cl.key]: n1 } }));
  if (lay) setTimeout(() => settle(lay, after, countEl, n1), reduced() ? 0 : 520);
  else if (cl) countTo(countEl, n1, { duration: 700 });
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
  const mk = marked(store);
  const plan = compose({ ids: cardIds(cl, data.ix), cards: store.cards(DECK) || {}, c, isDue: rec => isDue(rec, c.today, c), recall: recallOf(c), skip: x => skipsNew(mk, x) });
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
  const grades = gradeRow({ t, label: t('practice.sim.how'), onGrade: g => grade(g) });
  const again = againRow();
  const knowBtn = knowButton(t, () => knowThis());
  const box = h('div', { class: 'pr-round sim-round is-docked', role: 'region', 'aria-label': t('practice.clusters.sayTitle') },
    h('div', { class: 'pr-top' }, segs, again, h('div', { class: 'pr-top-row' }, count, endBtn)), h('div', { class: 'pr-scroll' }, card), h('div', { class: 'card-actions pr-actions sim-actions' }, knowBtn, showBtn, grades.el));
  replace(el, h('h1', { class: 'sr-only' }, t('practice.clusters.sayTitle')), box);
  const vv = window.visualViewport;
  const fit = () => { box.style.height = `${vv ? vv.height : innerHeight}px`; };
  vv?.addEventListener('resize', fit); addEventListener('resize', fit); fit();

  let st = 'think', busy = false, t0 = 0, alive = true;
  /** @type {any} */ let it = null;
  const top = (answered = false) => {
    const p = progressOf(round, answered, r => r.g > 1);
    drawProgress(segs, again, p);
    count.textContent = p.onAgain ? t('practice.countAgain', { n: p.k, total: p.n }) : t('practice.count', { n: p.k, total: p.n });
  };
  function fill() {
    it = items.get(round.queue[round.i].id) || itemFor(round.queue[round.i].id, data.ix, data.c, { t });
    meta.textContent = t(`practice.clusters.types.${cl.type}`);
    task.textContent = it.task || '';
    prompt.lang = it.promptLang === 'de' ? 'de' : 'en';
    prompt.textContent = it.gap ? it.prompt.replace('___', '…') : it.prompt;
    answer.textContent = it.gap ? it.model : (it.card ? it.card.head : it.model);
    replace(extra, it.usage ? h('p', { class: 'pr-rule' }, it.usage) : null, it.card && it.card.ex ? h('p', { class: 'caption' }, h('span', { lang: 'de' }, it.card.ex), it.card.exEn ? ` (${it.card.exEn})` : null) : null);
    reveal.classList.remove('is-open'); sayHint.hidden = false;
    showBtn.hidden = false; grades.reset();
    const cards = store.cards(DECK) || {};
    grades.set(S.preview(cards[it.id] || null, c, Date.now(), forecaster(cards, c)).map(w => (w == null ? t('practice.sim.inRound') : t('practice.sim.days', { n: w }))));
    knowBtn.hidden = !!(cards[it.id]?.reps || round.queue[round.i].re);
    top();
    st = 'think'; t0 = performance.now();
  }
  function doReveal() {
    if (st !== 'think') return;
    st = 'revealed'; reveal.classList.add('is-open'); sayHint.hidden = true; showBtn.hidden = true; knowBtn.hidden = true; grades.show();
    announce(answer.textContent || '');
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
    top(true);
    setTimeout(next, reduced() ? 120 : 260);
  }
  /** "I know this" on a new card (iknow.js): marked known, the card lifts away. */
  function knowThis() {
    if (st !== 'think' || busy || knowBtn.hidden) return;
    busy = true; st = 'graded';
    const id = it.id;
    const cards = store.cards(DECK) || {};
    if (!(id in prev)) prev[id] = cards[id] ? structuredClone(cards[id]) : null;
    knowCard(ctx, { deck: DECK, id });
    round.results.push(knownResult(id));
    top(true);
    announce(t('practice.know.announce'));
    next('lift');
  }
  async function next(kind = 'forward') {
    if (!alive) return;
    if (!S.advance(round)) return finish(false);
    await swap(() => fill(), { kind, fallbackEl: card });
    busy = false;
    showBtn.focus({ preventScroll: true });
    announce(`${task.textContent || ''} ${prompt.textContent || ''}`.trim());
  }
  function finish(/** @type {boolean} */ early) {
    if (!alive) return;
    alive = false; cleanup();
    addActivity(store, c.today, { minutes: Math.min(30, (performance.now() - t0r) / 60000), rounds: early ? 0 : 1 });
    if (!early) update(store, s => { const d = dayOf(store, c.today); return { ...s, day: { ...d, rounds: d.rounds + 1 } }; });
    const firsts = round.results.filter((/** @type {any} */ r) => r.first && !r.known);
    const known = round.results.filter((/** @type {any} */ r) => r.known).length;
    if (early && !firsts.length && !known) { ctx.go(`/practice/clusters/${type}/${cid}`); return; }
    restore();
    drawClusterDone(el, ctx, { key, right: firsts.filter((/** @type {any} */ r) => r.g >= 3).length, total: firsts.length, prev, again: `#/practice/clusters/${type}/${cid}/say`, known });
  }
  const onKey = (/** @type {KeyboardEvent} */ e) => {
    if (e.key === 'Escape') { e.preventDefault(); finish(true); return; }
    if (st === 'think' && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); doReveal(); return; }
    if (st === 'revealed' && grades.key(e)) return;
    if (st === 'think' && isKnowKey(e, false) && !knowBtn.hidden) { e.preventDefault(); knowThis(); return; }
    if (st === 'revealed' && (e.key === ' ' || e.key === 'Enter') && !(e.target instanceof HTMLElement && e.target.closest('button'))) { e.preventDefault(); grades.pick(grades.suggested); }
  };
  document.addEventListener('keydown', onKey);
  const cleanup = () => { document.removeEventListener('keydown', onKey); vv?.removeEventListener('resize', fit); removeEventListener('resize', fit); };
  fill();
  return () => { if (alive) { alive = false; cleanup(); } restore(); };
}
