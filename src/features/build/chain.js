/* Suffixes: word chains (#/practice/build/suffixes[/<chain>]).
   Grow a word one piece at a time: a prefix slides on from the left, an ending from the right, the word type rolls
   over (Verb → Noun), and for a noun the article lands with a dotted arc from the ending that decides it. A chain is
   a tree, not a line: vorstellbar comes from vorstellen, not from die Vorstellung, so the tree branches. The chart
   below shows the endings that decide the article; the one just used underlines in accent for 1.3 s ("you, now").

   Motion (PREFIX-DESIGN §8): the new row rises 8 px (300 ms); the edge draws from the parent (240 ms); the piece
   slides on (420 ms, spring-snappy, delay 180); the type label rolls (out 160 ms at 420, in 380 ms at 470); the
   article drops (560 ms, spring-pop) and its arc draws (320 ms, delay 200). Reduced motion: the row appears complete,
   no underline pulse. */
import { h, replace, announce } from '../../core/dom.js';
import { chainTree, pieces } from '../../domain/wordbuild.js';
import { backLink } from './compass.js';
import { play, css, reduced, nudge } from './fx.js';
import { haptic } from '../../core/motion.js';
import { loadContent } from './data.js';

const NS = 'http://www.w3.org/2000/svg';
const INDENT = 22;

/** The chain's tree with some nodes shown. @param {any} chain */
function treeOf(chain) { return chainTree(chain); }

/** A grow label: "-ung", "un-", "bare stem". @param {any} n @param {any} d @param {any} t */
const growLabel = (n, d, t) => (n.side === 'pre' ? `${n.add}-` : n.add === 'pp' ? t('build.chain.pp') : (d.S.get(n.add)?.label || `-${n.add}`));

/**
 * Draw a chain tree into a box.
 * @param {{d: any, t: any, chain: any, shown: Set<string>, answered: Map<string, string>, guess: boolean, box: HTMLElement,
 *   onGrow?: (n: any) => void, onAnswer?: (n: any, art: string, btn: HTMLElement) => void, fresh?: string | null, interactive?: boolean}} o
 */
export function drawTree({ d, t, chain, shown, answered, guess, box, onGrow, onAnswer, fresh = null, interactive = true }) {
  const tree = treeOf(chain);
  replace(box);
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'wb-edges'); svg.setAttribute('aria-hidden', 'true');
  box.append(svg);
  const walk = (/** @type {any} */ tn) => {
    if (!shown.has(tn.node.id)) return;
    box.append(nodeRow(tn));
    tn.kids.forEach(walk);
    const hidden = tn.kids.filter((/** @type {any} */ k) => !shown.has(k.node.id));
    if (hidden.length && interactive && onGrow) {
      const g = h('div', { class: 'wb-grow' }, hidden.map((/** @type {any} */ k) => h('button', { type: 'button', class: 'pressable', lang: 'de',
        'aria-label': t('build.chain.add', { piece: growLabel(k.node, d, t), word: tn.node.word }), onclick: () => onGrow(k.node) }, `${tn.node.word} + ${growLabel(k.node, d, t)}`)));
      g.style.paddingLeft = `${(tn.depth + 1) * INDENT}px`;
      box.append(g);
    }
  };
  function nodeRow(/** @type {any} */ tn) {
    const n = tn.node;
    const pc = pieces(n);
    const word = h('span', { class: 'wb-w', lang: 'de' });
    if (n.side === 'pre' && pc.add) word.append(h('span', { class: 'wb-add' }, pc.add), pc.after);
    else word.append(pc.before, pc.add ? h('span', { class: 'wb-add' }, pc.add) : '');
    const asked = n.art && guess && !answered.has(n.id) && interactive;
    const art = n.art ? (asked ? h('span', { class: 'wb-art is-ask', 'aria-label': t('build.chain.artUnset') }, '?') : h('span', { class: 'wb-art', lang: 'de' }, n.art)) : null;
    const cls = h('span', { class: 'wb-cls' }, h('span', null, t(`build.cls.${n.cls}`)));
    const body = h('div', { class: 'wb-wbody' },
      h('div', { class: 'wb-wline' }, art, word, cls, n.rare ? h('span', { class: 'caption' }, t('build.chain.rare')) : null),
      h('span', { class: 'wb-wen' }, n.en),
      n.note && !asked ? h('span', { class: 'wb-wnote' }, n.note) : null,
      asked ? h('div', { class: 'wb-artguess', role: 'group', 'aria-label': t('build.chain.artFor', { word: n.word }) },
        ['der', 'die', 'das'].map(a => h('button', { type: 'button', class: 'pressable', lang: 'de', onclick: (/** @type {Event} */ e) => onAnswer && onAnswer(n, a, /** @type {HTMLElement} */ (e.currentTarget)) }, a))) : null);
    body.style.paddingLeft = `${tn.depth * INDENT}px`;
    return h('div', { class: ['wb-node', n.art && 'is-noun', fresh === n.id && 'is-fresh'], 'data-id': n.id, 'data-parent': n.from || '' }, body);
  }
  walk(tree.root);
  requestAnimationFrame(() => {
    drawEdges(svg, box, chain);
    const f = /** @type {HTMLElement | null} */ (fresh ? box.querySelector(`.wb-node[data-id="${fresh}"]`) : null);
    if (f) animateFresh(f, svg, chain, guess, t);
  });
  return { svg };
}

/** Edges in the indent gutter, and the dotted arc from an ending to its article. @param {SVGSVGElement} svg @param {HTMLElement} box @param {any} chain */
export function drawEdges(svg, box, chain) {
  while (svg.firstChild) svg.firstChild.remove();
  const tr = box.getBoundingClientRect();
  svg.setAttribute('viewBox', `0 0 ${tr.width} ${tr.height}`);
  for (const row of box.querySelectorAll('.wb-node')) {
    const pid = /** @type {HTMLElement} */ (row).dataset.parent; if (!pid) continue;
    const prow = box.querySelector(`.wb-node[data-id="${pid}"]`); if (!prow) continue;
    const pl = /** @type {HTMLElement} */ (prow.querySelector('.wb-wline')).getBoundingClientRect();
    const pb = /** @type {HTMLElement} */ (prow.querySelector('.wb-wnote') || prow.querySelector('.wb-artguess') || prow.querySelector('.wb-wen')).getBoundingClientRect();
    const cw = /** @type {HTMLElement} */ (row.querySelector('.wb-wline')).getBoundingClientRect();
    const x0 = pl.left - tr.left + 8, y0 = pb.bottom - tr.top + 4, x1 = cw.left - tr.left - 5, y1 = cw.top - tr.top + cw.height / 2;
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', `M${x0} ${y0} L${x0} ${y1 - 6} Q${x0} ${y1} ${x0 + 6} ${y1} L${x1} ${y1}`);
    p.dataset.to = /** @type {HTMLElement} */ (row).dataset.id || '';
    svg.append(p);
  }
  for (const row of box.querySelectorAll('.wb-node')) {
    const art = row.querySelector('.wb-art:not(.is-ask)'), add = row.querySelector('.wb-w .wb-add');
    const n = chain.nodes.find((/** @type {any} */ x) => x.id === /** @type {HTMLElement} */ (row).dataset.id);
    if (!art || !add || !n || n.side === 'pre') continue;
    const ar = art.getBoundingClientRect(), dr = add.getBoundingClientRect();
    const ax = ar.left - tr.left + ar.width / 2, ay = ar.top - tr.top + 2, dx = dr.left - tr.left + dr.width / 2, dy = dr.top - tr.top + 4;
    const top = Math.min(ay, dy) - 12;
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('class', 'wb-rulearc');
    p.setAttribute('d', `M${dx} ${dy} C ${dx} ${top}, ${ax} ${top}, ${ax} ${ay}`);
    p.dataset.rule = /** @type {HTMLElement} */ (row).dataset.id || '';
    svg.append(p);
  }
}

/** @param {HTMLElement} row @param {SVGSVGElement} svg @param {any} chain @param {boolean} guess @param {any} t */
function animateFresh(row, svg, chain, guess, t) {
  if (reduced()) return;
  const id = row.dataset.id, n = chain.nodes.find((/** @type {any} */ x) => x.id === id);
  play(row, [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 300, easing: css('--ease-out') });
  const edge = /** @type {SVGPathElement | null} */ (svg.querySelector(`path[data-to="${id}"]`));
  if (edge) { const L = edge.getTotalLength(); edge.style.strokeDasharray = String(L); play(edge, [{ strokeDashoffset: L }, { strokeDashoffset: 0 }], { duration: 240, easing: css('--ease-out') }); }
  const add = row.querySelector('.wb-w .wb-add');
  if (add) play(add, [{ transform: `translateX(${n.side === 'pre' ? -22 : 22}px)`, opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 420, delay: 180, easing: css('--spring-snappy') });
  const parent = chain.nodes.find((/** @type {any} */ x) => x.id === n.from);
  const cls = row.querySelector('.wb-cls');
  if (cls && parent && parent.cls !== n.cls) {
    const old = h('span', null, t(`build.cls.${parent.cls}`)); cls.prepend(old);
    play(old, [{ transform: 'none', opacity: 1 }, { transform: 'translateY(-100%)', opacity: 0 }], { duration: 160, delay: 420, easing: css('--ease-in'), fill: 'both' }).then(() => old.remove());
    play(cls.lastElementChild, [{ transform: 'translateY(100%)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 380, delay: 470, easing: css('--spring-snappy') });
  }
  if (n.art && !guess) landArticle(row, 600);
}

/** The article drops into place and its arc draws from the ending. @param {HTMLElement} row @param {number} [delay] */
export function landArticle(row, delay = 0) {
  const art = row.querySelector('.wb-art');
  play(art, [{ transform: 'translateY(-18px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 560, delay, easing: css('--spring-pop') });
  const box = row.parentElement;
  const rule = /** @type {SVGPathElement | null} */ (box ? box.querySelector(`path[data-rule="${row.dataset.id}"]`) : null);
  if (rule) { const L = rule.getTotalLength(); play(rule, [{ strokeDasharray: `0 ${L}` }, { strokeDasharray: `${L} 0` }], { duration: 320, delay: delay + 200, easing: css('--ease-out') }); }
}

/** The article chart and the adjective endings. @param {any} d @param {any} t */
export function ruleChart(d, t) {
  const col = (/** @type {string} */ art) => h('div', { class: 'wb-col' }, h('h3', { lang: 'de' }, art),
    d.c.suffixes.filter((/** @type {any} */ s) => s.art === art).map((/** @type {any} */ s) => h('div', { class: 'wb-sitem' },
      h('span', { class: 'wb-sfx', 'data-s': s.id, lang: 'de' }, s.label), h('p', { lang: 'de', class: 'wb-sx' }, s.ex.split(' → ')[1]), h('p', null, s.short))));
  return h('section', { class: 'wb-rules stack' }, h('h2', null, t('build.chain.chart')), h('div', { class: 'wb-chart' }, col('der'), col('die'), col('das')),
    h('h2', null, t('build.chain.adj')),
    h('div', { class: 'wb-adjs' }, d.c.suffixes.filter((/** @type {any} */ s) => s.cls === 'adj').map((/** @type {any} */ s) =>
      h('div', { class: 'wb-adjrow' }, h('b', { lang: 'de', class: 'wb-sfx', 'data-s': s.id }, s.label), h('span', null, s.rule), h('span', { lang: 'de', class: 'wb-sx' }, s.ex)))));
}

/** Underline an ending in the chart for 1.3 s (accent: you, now). @param {HTMLElement} root @param {string} id */
export function hot(root, id) {
  if (reduced()) return;
  const e = root.querySelector(`.wb-sfx[data-s="${id}"]`); if (!e) return;
  e.classList.add('is-hot'); setTimeout(() => e.classList.remove('is-hot'), 1300);
}

/** @param {HTMLElement} el @param {import('../contract.js').ViewCtx} ctx @param {string | undefined} chainId */
export async function mountChains(el, ctx, chainId) {
  const { t } = ctx;
  let alive = true;
  replace(el, h('div', { class: 'wb stack' }, backLink('#/practice/build', t('build.title')), h('div', { class: 'page-head' }, h('h1', null, t('build.suffixes'))), h('p', { class: 'caption' }, t('build.loading'))));
  const d = await loadContent(ctx);
  if (!alive) return () => {};
  const chains = d.c.chains;
  const st = { id: chains.some((/** @type {any} */ c) => c.id === chainId) ? chainId : chains[0].id, shown: new Set(['n0']), answered: new Map(), guess: true, streak: 0 };
  const chainOf = () => chains.find((/** @type {any} */ c) => c.id === st.id);
  if (ctx.query.get('all')) chainOf().nodes.forEach((/** @type {any} */ n) => { st.shown.add(n.id); if (n.art) st.answered.set(n.id, n.art); });
  const box = h('section', { class: 'wb-card wb-tree', 'aria-live': 'polite', 'aria-label': t('build.chain.tree') });
  const chips = h('div', { class: 'wb-chips', role: 'group', 'aria-label': t('build.chain.words') });
  const toggle = h('label', { class: 'wb-toggle' }, h('input', { type: 'checkbox', checked: true, onchange: (/** @type {Event} */ e) => { st.guess = /** @type {HTMLInputElement} */ (e.target).checked; draw(); } }), t('build.chain.guess'));
  const chart = ruleChart(d, t);
  replace(el, h('div', { class: 'wb stack' }, backLink('#/practice/build', t('build.title')),
    h('div', { class: 'page-head' }, h('h1', null, t('build.suffixes'))), h('p', { class: 'wb-lead' }, t('build.chain.lead')),
    chips, toggle, box, chart));
  const url = () => history.replaceState(history.state, '', `#/practice/build/suffixes/${encodeURIComponent(st.id)}`);
  function drawChips() {
    replace(chips, chains.map((/** @type {any} */ c) => h('button', { type: 'button', class: 'chip pressable', lang: 'de', 'aria-pressed': String(c.id === st.id),
      onclick: () => { st.id = c.id; st.shown = new Set(['n0']); st.answered = new Map(); url(); drawChips(); draw(); } }, c.title)));
  }
  function draw(/** @type {string | null} */ fresh = null) {
    drawTree({ d, t, chain: chainOf(), shown: st.shown, answered: st.answered, guess: st.guess, box, fresh, onGrow: n => { st.shown.add(n.id); draw(n.id); announce(`${n.art && !st.guess ? `${n.art} ` : ''}${n.word}. ${n.en}`); },
      onAnswer: (n, a, btn) => {
        const ok = a === n.art;
        if (!ok) {
          btn.classList.add('is-bad'); nudge(btn); st.streak = 0;
          setTimeout(() => finish(n, false), reduced() ? 0 : 700);
          return;
        }
        if (st.streak++ < 3) haptic();
        finish(n, true);
      } });
  }
  function finish(/** @type {any} */ n, /** @type {boolean} */ ok) {
    st.answered.set(n.id, n.art);
    draw();
    announce(`${ok ? t('build.chain.right') : t('build.chain.wrong')} ${n.art} ${n.word}. ${n.note || ''}`);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const row = /** @type {HTMLElement | null} */ (box.querySelector(`.wb-node[data-id="${n.id}"]`));
      if (row) landArticle(row);
      hot(chart, n.add);
    }));
  }
  const onResize = () => { const svg = /** @type {SVGSVGElement | null} */ (box.querySelector('.wb-edges')); if (svg) drawEdges(svg, box, chainOf()); };
  addEventListener('resize', onResize);
  drawChips(); draw();
  return () => { alive = false; removeEventListener('resize', onResize); };
}
