/* Prefixes › Table (#/practice/build/table[?col=<p>|row=<root>&lens=know]): the root × prefix grid, a real <table>.
   Two lenses: "How derivable" (shape: solid literal, hatched picture, outlined with a dot word to learn, a small dot
   no common verb) and "What I know" (Explore's ink encoding). Tap a prefix header: the other columns fade to 18 %,
   the column's cells pop in on a stagger (380 ms spring-pop, 28 ms apart, at most 14), and a card lists the column's
   verbs from literal to word to learn. Tap a root: its row. Tap a cell: it opens on the compass. On a phone the grid
   scrolls sideways with the root column sticky. Reduced motion: the dim is instant, nothing pops. */
import { h, replace } from '../../core/dom.js';
import { backLink, viewSwitch, legend } from './compass.js';
import { play, css } from './fx.js';
import { loadContent, knowledge } from './data.js';
import { langAttr } from '../../core/lang.js';

const COLS = /** @type {[string, string[]][]} */ ([
  ['build.table.splits', ['ab', 'an', 'auf', 'aus', 'ein', 'mit', 'nach', 'vor', 'zu']],
  ['build.table.both', ['um', 'über', 'unter', 'durch']],
  ['build.table.stays', ['be', 'ver', 'ent', 'er', 'zer', 'ge']],
]);
const ORDER = /** @type {Record<string, number>} */ ({ known: 0, shaky: 1, unknown: 2, unseen: 3 });

/** @param {HTMLElement} el @param {import('../contract.js').ViewCtx} ctx */
export async function mountTable(el, ctx) {
  const { t } = ctx;
  let alive = true;
  replace(el, h('div', { class: 'wb stack' }, backLink('#/practice/build', t('build.title')), h('div', { class: 'page-head' }, h('h1', null, t('build.prefixes'))), h('p', { class: 'caption' }, t('build.loading'))));
  const [d, k] = await Promise.all([loadContent(ctx), knowledge(ctx).catch(() => null)]);
  if (!alive) return () => {};
  const q = ctx.query;
  let lens = q.get('lens') === 'know' ? 'know' : 'grade';
  /** @type {{col?: string, row?: string} | null} */ let focus = q.get('col') ? { col: /** @type {string} */ (q.get('col')) } : q.get('row') ? { row: /** @type {string} */ (q.get('row')) } : null;
  const state = (/** @type {string} */ itemId) => (k ? k.get(itemId).state : 'unseen');
  const rootState = (/** @type {any} */ r) => state(`W:${r.lemma}`);
  const roots = [...d.c.roots].sort((a, b) => ORDER[rootState(a)] - ORDER[rootState(b)] || d.c.roots.indexOf(a) - d.c.roots.indexOf(b));
  const verbItem = (/** @type {any} */ v) => d.resolve(`PD:${v.id}`);
  const box = h('div', { class: 'wb-table' });
  replace(el, h('div', { class: 'wb stack' }, backLink('#/practice/build', t('build.title')), h('div', { class: 'page-head' }, h('h1', null, t('build.prefixes'))), viewSwitch(t, 'table'), box));
  const url = () => { const p = new URLSearchParams(); if (focus?.col) p.set('col', focus.col); if (focus?.row) p.set('row', focus.row); if (lens === 'know') p.set('lens', 'know'); history.replaceState(history.state, '', `#/practice/build/table${p.toString() ? `?${p}` : ''}`); };

  function draw(animate = false) {
    const lensSeg = h('div', { class: 'seg wb-lens', role: 'group', 'aria-label': t('build.table.lens') }, [['grade', t('build.table.grade')], ['know', t('build.table.know')]].map(([v, text]) =>
      h('button', { type: 'button', class: 'pressable', 'aria-pressed': String(lens === v), onclick: () => { lens = v; url(); draw(); } }, text)));
    const keyEl = lens === 'grade' ? legend(t) : h('div', { class: 'wb-legend', 'aria-hidden': 'true' }, ['known', 'shaky', 'unknown', 'unseen'].map(s => h('span', null, h('i', { class: `wb-k is-${s}` }), t(`build.state.${s}`))));
    const head1 = h('tr', null, h('th', { class: 'wb-thgrp', scope: 'col' }, h('span', { class: 'sr-only' }, t('build.table.root'))),
      COLS.map(([key, cols], i) => h('th', { class: ['wb-thgrp', i && 'wb-gap'], colspan: String(cols.length), scope: 'colgroup' }, t(key))));
    const head2 = h('tr', null, h('td', null), COLS.flatMap(([, cols], i) => cols.map((c, j) => h('th', { scope: 'col', class: [i && !j && 'wb-gap', focus?.col === c && 'is-hl'] },
      h('button', { type: 'button', class: 'pressable', lang: langAttr(), 'aria-pressed': String(focus?.col === c), onclick: () => { focus = focus?.col === c ? null : { col: c }; url(); draw(true); } }, c)))));
    const body = h('tbody');
    for (const r of roots) {
      const tr = h('tr', null, h('th', { scope: 'row', class: focus?.row === r.id ? 'is-hl' : null },
        h('button', { type: 'button', class: 'pressable', lang: langAttr(), 'aria-pressed': String(focus?.row === r.id), onclick: () => { focus = focus?.row === r.id ? null : { row: r.id }; url(); draw(true); } }, r.id)));
      COLS.forEach(([, cols], i) => cols.forEach((c, j) => {
        const vs = d.c.verbs.filter((/** @type {any} */ v) => v.root === r.id && v.pre === c);
        const v = vs[0];
        const st = v ? state(/** @type {string} */ (verbItem(v))) : 'none';
        const cls = !v ? 'wb-cell is-none' : lens === 'grade' ? `wb-cell is-${v.grade}` : `wb-cell wb-k is-${st}`;
        const dim = !!focus && ((focus.col && focus.col !== c) || (focus.row && focus.row !== r.id));
        const label = v ? `${vs.map((/** @type {any} */ x) => x.inf).join(' / ')}: ${v.en}. ${lens === 'grade' ? t(`build.grade.${v.grade}`) : t(`build.state.${st}`)}` : t('build.compass.none', { word: `${c}${r.id}` });
        tr.append(h('td', { class: [i && !j && 'wb-gap', dim && 'is-dim'] }, v
          ? h('a', { class: cls, href: `#/practice/build/prefixes?root=${encodeURIComponent(r.id)}&pre=${encodeURIComponent(c)}`, 'aria-label': label, title: label })
          : h('span', { class: cls, role: 'img', 'aria-label': label, title: label })));
      }));
      body.append(tr);
    }
    const table = h('table', { class: 'wb-pt' }, h('caption', { class: 'sr-only' }, t('build.table.caption')), h('thead', null, head1, head2), body);
    replace(box, h('div', { class: 'wb-tlens' }, lensSeg), keyEl, h('div', { class: 'wb-tscroll', tabindex: '0', role: 'region', 'aria-label': t('build.table.caption') }, table), sheet());
    if (animate && focus) [...table.querySelectorAll('td:not(.is-dim) .wb-cell')].forEach((b, n) => play(b, [{ transform: 'scale(0.7)', opacity: 0.4 }, { transform: 'scale(1)', opacity: 1 }], { duration: 380, delay: Math.min(n, 14) * 28, easing: css('--spring-pop') }));
  }

  function sheet() {
    if (!focus) return h('p', { class: 'caption' }, t('build.table.hint'));
    const row = (/** @type {any} */ v) => h('a', { class: 'wb-vrow pressable', href: `#/practice/build/prefixes?root=${encodeURIComponent(v.root)}&pre=${encodeURIComponent(v.pre)}&v=${encodeURIComponent(v.id)}` },
      h('i', { class: `wb-cell is-${v.grade}`, 'aria-hidden': 'true' }), h('span', null, h('b', { lang: langAttr() }, v.inf), ' ', h('span', null, v.en)));
    if (focus.col) {
      const p = d.P.get(focus.col);
      const vs = d.c.verbs.filter((/** @type {any} */ v) => v.pre === focus?.col);
      const n = (/** @type {string} */ g) => vs.filter((/** @type {any} */ v) => v.grade === g).length;
      return h('div', { class: 'wb-card wb-tsheet' }, h('p', { class: 'label', lang: langAttr() }, t('build.table.across', { p: `${p.id}-`, n: new Set(vs.map((/** @type {any} */ v) => v.root)).size })),
        h('p', { class: 'wb-core-line' }, p.core), h('p', { class: 'caption' }, t('build.table.counts', { t: n('T'), m: n('M'), o: n('O') })),
        h('div', { class: 'wb-vlist' }, ['T', 'M', 'O'].flatMap(g => vs.filter((/** @type {any} */ v) => v.grade === g).map(row))));
    }
    const vs = d.c.verbs.filter((/** @type {any} */ v) => v.root === focus?.row);
    return h('div', { class: 'wb-card wb-tsheet' }, h('p', { class: 'label', lang: langAttr() }, t('build.table.row', { root: focus.row, n: vs.length })), h('div', { class: 'wb-vlist' }, vs.map(row)));
  }
  draw(!!focus);
  return () => { alive = false; };
}
