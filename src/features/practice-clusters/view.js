/* Word clusters in Practice:
     #/practice/clusters[/<type>]            pick a type (families, opposites, prefixes, suffixes, topics, prepositions)
                                             and a cluster: each row shows known of total and a mini field
     #/practice/clusters/<type>/<id>         goes to the cluster's group page, #/lookup/map/<type>/<id> (round 3: one page
                                             for a map group and a word cluster, features/explore/group.js)
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
import { wordMeta, wordPanel } from '../../core/wordpanel.js';
import { h, replace, announce } from '../../core/dom.js';
import { notice } from '../../core/ui.js';
import { icon } from '../../core/icons.js';
import { countTo, reduced, swap, haptic } from '../../core/motion.js';
import { gradeRow } from '../shared/selfgrade.js';
import { progressOf, drawProgress, againRow } from '../shared/progress.js';
import { doneHero, againLink } from '../shared/done-hero.js';
import { Field } from '../../core/brand.js';
import { TYPES } from '../../domain/clusters.js';
import { roundMinutes } from '../../domain/today.js';
import * as S from '../../domain/sim.js';
import { forecaster, tz, addActivity, loadData } from '../shared/data.js';
import { typeCheck } from '../shared/typecheck.js';
import { loadClusters, loadKnowledge, countsOf, cellsOf, dueCards, recallOf, state, update, dayOf, DECK } from '../shared/cluster-data.js';
import { cardIds, itemFor, compose, zipfOf } from '../shared/cluster-items.js';
import { isDue, sideCap } from '../../domain/b1ready.js';
import { marked } from '../../data/known.js';
import { skipsNew } from '../../domain/known.js';
import { knowButton, isKnowKey, knowCard, knownResult } from '../shared/iknow.js';
import { drawClusterDone } from '../shared/cluster-layout.js';
import { langAttr, dirAttr } from '../../core/lang.js';
import { fitToKeyboard, reveal as revealEl } from '../../core/keyboard.js';

const back = (/** @type {string} */ href, /** @type {string} */ text) => h('a', { class: 'pr-backlink pressable', href }, icon('prev', { size: 16 }), text);

/** @param {HTMLElement} el @param {import('../contract.js').ViewCtx} ctx @param {string[]} rest */
export function mountClusters(el, ctx, rest) {
  const [type, id, sub] = rest;
  if (type && id && sub === 'say') return mountSay(el, ctx, `${type}:${id}`);
  // one cluster is the group page under Look up › Map (features/explore/group.js), the same page the map opens
  if (type && id) { ctx.go(`/lookup/map/${type}/${encodeURIComponent(id)}`, { replace: true }); return undefined; }
  return mountPicker(el, ctx, /** @type {any} */ (TYPES.includes(/** @type {any} */ (type)) ? type : ORDER[0]));
}

/** The cluster types in the order of the Explore map's modes (Topic, Word family, Opposites …). */
const ORDER = ['topic', 'family', 'opp', 'prefix', 'suffix', 'prep'].filter(x => TYPES.includes(/** @type {any} */ (x)));
const B1_LEVELS = new Set(['A1', 'A2', 'B1']);

/* ------------------------------------------------------------------ */
/* Picker                                                              */
/* ------------------------------------------------------------------ */

/** @param {HTMLElement} el @param {import('../contract.js').ViewCtx} ctx @param {string} type */
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
    const row = h('a', { class: 'cl-row pressable', href: `#/lookup/map/${cl.type}/${encodeURIComponent(cl.id)}`, 'aria-label': t('practice.clusters.rowLabel', { name: cl.label, known: n.known, n: n.n }) },
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
/* Say it: self-graded                                                 */
/* ------------------------------------------------------------------ */

/** @param {HTMLElement} el @param {import('../contract.js').ViewCtx} ctx @param {string} key */
async function mountSay(el, ctx, key) {
  const { t, store } = ctx;
  document.body.dataset.chrome = 'off';
  document.body.classList.add('pr-in-round');
  const restore = () => { document.body.dataset.chrome = 'on'; document.body.classList.remove('pr-in-round'); };
  const [type, cid] = key.split(':');
  const backTo = `#/lookup/map/${type}/${encodeURIComponent(cid)}`;
  let data;
  try { data = await loadClusters(ctx); } catch { ctx.go(backTo.slice(1), { replace: true }); return restore; }
  const cl = data.ix.byKey.get(key);
  if (!cl) { ctx.go('/practice/clusters', { replace: true }); return restore; }
  let c = ctx.clock.ctx();
  const mk = marked(store);
  const plan = compose({ ids: cardIds(cl, data.ix), cards: store.cards(DECK) || {}, c, isDue: rec => isDue(rec, c.today, sideCap(c)), recall: recallOf(c), skip: x => skipsNew(mk, x), zipf: zipfOf(data.ix) });
  if (!plan.ids.length) { ctx.go(backTo.slice(1), { replace: true }); return restore; }
  const round = { queue: plan.ids.map(id => ({ id })), i: 0, results: /** @type {any[]} */ ([]), planned: plan.ids.length };
  /** @type {Record<string, any>} */ const prev = {};
  const t0r = performance.now();
  const items = new Map(plan.ids.map(id => [id, itemFor(id, data.ix, data.c, { t, fx: data.fx })]));

  const segs = h('div', { class: 'segments', 'aria-label': t('practice.progress') });
  const count = h('span', { class: 'caption tnum' });
  const endBtn = h('button', { type: 'button', class: 'btn btn-quiet pressable pr-end', onclick: () => finish(true) }, t('practice.end'), h('kbd', null, 'Esc'));
  const meta = h('span', { class: 'label' });
  const task = h('p', { class: 'pr-task' });
  const prompt = h('p', { class: 'prompt' });
  const wmeta = h('div', { class: 'cl-wmeta' });
  const sayHint = h('p', { class: 'caption sim-say' }, t('practice.clusters.sayHint'));
  const answer = h('p', { class: 'answer-key', lang: langAttr(), dir: dirAttr() });
  const extra = h('div', { class: 'cl-say-extra' });
  const reveal = h('div', { class: 'reveal-answer' }, h('div', null, answer, extra));
  const card = h('article', { class: 'card pr-card' }, h('div', { class: 'card-meta' }, meta), wmeta, task, prompt, sayHint, reveal);
  const showBtn = h('button', { type: 'button', class: 'btn btn-primary pressable pr-primary', onclick: () => doReveal() }, t('practice.sim.show'), h('kbd', null, 'Space'));
  const grades = gradeRow({ t, label: t('practice.sim.how'), onGrade: g => grade(g) });
  const again = againRow();
  const knowBtn = knowButton(t, () => knowThis());
  const box = h('div', { class: 'pr-round sim-round is-docked', role: 'region', 'aria-label': t('practice.clusters.sayTitle') },
    h('div', { class: 'pr-top' }, segs, again, h('div', { class: 'pr-top-row' }, count, endBtn)), h('div', { class: 'pr-scroll' }, card), h('div', { class: 'card-actions pr-actions sim-actions' }, knowBtn, showBtn, grades.el));
  replace(el, h('h1', { class: 'sr-only' }, t('practice.clusters.sayTitle')), box);
  const unfit = fitToKeyboard(box);   // Check by typing's row sits on the keyboard (core/keyboard.js)

  let st = 'think', busy = false, t0 = 0, alive = true;
  /** @type {any} */ let it = null;
  const top = (answered = false) => {
    const p = progressOf(round, answered, r => r.g > 1);
    drawProgress(segs, again, p);
    count.textContent = p.onAgain ? t('practice.countAgain', { n: p.k, total: p.n }) : t('practice.count', { n: p.k, total: p.n });
  };
  function fill() {
    it = items.get(round.queue[round.i].id) || itemFor(round.queue[round.i].id, data.ix, data.c, { t, fx: data.fx });
    meta.textContent = t(`practice.clusters.types.${cl.type}`);
    task.textContent = it.task || '';
    prompt.lang = it.promptLang === 'de' ? langAttr() : 'en'; prompt.dir = it.promptLang === 'de' ? dirAttr() : 'ltr';
    prompt.textContent = it.gap ? it.prompt.replace('___', '…') : it.prompt;
    answer.textContent = it.gap ? it.model : (it.card ? it.card.head : it.model);
    replace(wmeta, it.card?.type ? wordMeta(it.card) : null);
    replace(extra, it.usage ? h('p', { class: 'pr-rule' }, it.usage) : null, it.card?.type ? wordPanel(it.card, { head: false })
      : it.card && it.card.ex ? h('p', { class: 'caption' }, h('span', { lang: langAttr(), dir: dirAttr() }, it.card.ex), it.card.exEn ? ` (${it.card.exEn})` : null) : null);
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
  /** @type {HTMLElement | null} */ let checkEl = null;
  /** "I know this" on a new card: Check by typing first (shared/typecheck.js), then marked known and the card lifts away. */
  function knowThis() {
    if (st !== 'think' || busy || knowBtn.hidden) return;
    st = 'typing';
    knowBtn.hidden = true; showBtn.hidden = true; sayHint.hidden = true;
    const panel = typeCheck({ ctx, deck: DECK, id: it.id, item: it, data: () => loadData(ctx),
      onKnown: () => { checkEl?.remove(); checkEl = null; st = 'think'; markKnown(); },
      onClose: () => { checkEl?.remove(); checkEl = null; st = 'think'; knowBtn.hidden = false; showBtn.hidden = false; sayHint.hidden = false; showBtn.focus({ preventScroll: true }); } });
    checkEl = panel.el;
    card.append(checkEl);
    panel.focus();
    revealEl(prompt, { avoid: checkEl });
  }
  function markKnown() {
    if (st !== 'think' || busy) return;
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
    addActivity(store, c.today, { minutes: Math.min(30, (performance.now() - t0r) / 60000), rounds: early ? 0 : 1, kind: 'review' });
    if (!early) update(store, s => { const d = dayOf(store, c.today); return { ...s, day: { ...d, rounds: d.rounds + 1 } }; });
    const firsts = round.results.filter((/** @type {any} */ r) => r.first && !r.known);
    const known = round.results.filter((/** @type {any} */ r) => r.known).length;
    if (early && !firsts.length && !known) { ctx.go(backTo.slice(1)); return; }
    restore();
    drawClusterDone(el, ctx, { key, right: firsts.filter((/** @type {any} */ r) => r.g >= 3).length, total: firsts.length, prev, again: `#/practice/clusters/${type}/${cid}/say`, back: backTo, known });
  }
  const onKey = (/** @type {KeyboardEvent} */ e) => {
    if (st === 'typing') return;   // the Check by typing panel has its own keys
    if (e.key === 'Escape') { e.preventDefault(); finish(true); return; }
    if (st === 'think' && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); doReveal(); return; }
    if (st === 'revealed' && grades.key(e)) return;
    if (st === 'think' && isKnowKey(e, false) && !knowBtn.hidden) { e.preventDefault(); knowThis(); return; }
    if (st === 'revealed' && (e.key === ' ' || e.key === 'Enter') && !(e.target instanceof HTMLElement && e.target.closest('button'))) { e.preventDefault(); grades.pick(grades.suggested); }
  };
  document.addEventListener('keydown', onKey);
  const cleanup = () => { document.removeEventListener('keydown', onKey); unfit(); };
  fill();
  return () => { if (alive) { alive = false; cleanup(); } restore(); };
}
