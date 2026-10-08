/* A cluster's words laid out as they are known, the move from before a round to now, and the done screen of a
   cluster round. Shared by Word clusters (features/practice-clusters: the cluster page, said aloud) and the typed
   round (features/practice-round, kind=cluster:…). Motion only through the kit (core/motion.js, core/brand.js Field),
   so reduced motion gets the final state at once. */
import { h, replace, announce } from '../../core/dom.js';
import { countTo, reduced, haptic, easing } from '../../core/motion.js';
import { Field } from '../../core/brand.js';
import { doneHero, againLink } from './done-hero.js';
import { loadClusters, loadKnowledge, countsOf, cellsOf, update, DECK } from './cluster-data.js';
import { roundWords, partOf } from './cluster-items.js';
import { langAttr, dirAttr } from '../../core/lang.js';

const STATE_CLS = /** @type {Record<string, string>} */ ({ known: 'is-known', shaky: 'is-shaky', unknown: 'is-unknown', unseen: 'is-unseen' });

/** A word as type, in its knowledge state. @param {any} w @param {any} s a knowledge score */
export function wordChip(w, s) {
  const art = w.pos === 'noun' && /^(der|die|das)$/.test(w.art) ? h('span', { class: 'cl-art' }, w.art, ' ') : null;
  return h('span', { class: ['cl-w', STATE_CLS[s.state], s.today && 'is-today'], lang: langAttr(), dir: dirAttr(), 'data-id': w.id }, art, w.w);
}

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
        return h('div', { class: 'cl-branch', hidden: true }, h('span', { class: 'cl-pre', lang: langAttr(), dir: dirAttr() }, p ? `${p}-` : t('practice.clusters.noPrefix')), slot);
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
        n ? n.ex.map((/** @type {[string, string]} */ [de, en]) => h('p', { class: 'cl-prep-ex' }, h('span', { lang: langAttr(), dir: dirAttr() }, de), h('span', { class: 'caption' }, ` ${en}`))) : null);
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
  const ease = easing('--spring-pop');
  const soft = easing('--spring-soft');
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

/* ------------------------------------------------------------------ */
/* The done screen of a cluster round (typed or said)                  */
/* ------------------------------------------------------------------ */

/**
 * The done screen of a cluster round (typed or said). Its data object is this round's words, landing where they now
 * belong, and the whole cluster as a compact field with one count line ("7 of 223 known in Describing words"); never
 * the whole cluster as type, which on a big cluster pushed the buttons off the page.
 * @param {HTMLElement} el @param {import('../contract.js').ViewCtx} ctx
 * @param {{key: string | null, right: number, total: number, prev: Record<string, any>, again: string, back?: string | null, known?: number}} o
 *   key: the cluster ('<type>:<id>'), null for a due round; prev: the cards before the round (id → record or null);
 *   known: cards marked "I know this" in the round; back: where Done goes ('#/…'), else the cluster's group page
 */
export async function drawClusterDone(el, ctx, { key, right, total, prev, again, back = null, known = 0 }) {
  const { t, store } = ctx;
  const [data, after, before] = await Promise.all([loadClusters(ctx), loadKnowledge(ctx), loadKnowledge(ctx, { patch: { [DECK]: prev } })]);
  const cl = key ? data.ix.byKey.get(key) : null;
  const backHref = back || (cl ? `#/lookup/map/${cl.type}/${encodeURIComponent(cl.id)}` : '#/practice/clusters');
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

