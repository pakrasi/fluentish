/* Look up: small view builders shared by the sections (rows, highlights, the paged list, the speaker button). */
import { h } from '../../core/dom.js';
import { matchRanges } from './search.js';

const NS = 'http://www.w3.org/2000/svg';
/* Phosphor Icons 2.1.1 regular (MIT), as path data like core/icons.js: speaker-high, magnifying-glass, x-circle, caret-down. */
const PATHS = /** @type {Record<string, string>} */ ({
  speaker: 'M155.51,24.81a8,8,0,0,0-8.42.88L77.25,80H32A16,16,0,0,0,16,96v64a16,16,0,0,0,16,16H77.25l69.84,54.31A8,8,0,0,0,160,224V32A8,8,0,0,0,155.51,24.81ZM32,96H72v64H32ZM144,207.64,88,164.09V91.91l56-43.55Zm54-106.08a40,40,0,0,1,0,52.88,8,8,0,0,1-12-10.58,24,24,0,0,0,0-31.72,8,8,0,0,1,12-10.58ZM248,128a79.9,79.9,0,0,1-20.37,53.34,8,8,0,0,1-11.92-10.67,64,64,0,0,0,0-85.33,8,8,0,1,1,11.92-10.67A79.83,79.83,0,0,1,248,128Z',
  search: 'M229.66,218.34l-50.07-50.06a88.11,88.11,0,1,0-11.31,11.31l50.06,50.07a8,8,0,0,0,11.32-11.32ZM40,112a72,72,0,1,1,72,72A72.08,72.08,0,0,1,40,112Z',
  clear: 'M165.66,101.66,139.31,128l26.35,26.34a8,8,0,0,1-11.32,11.32L128,139.31l-26.34,26.35a8,8,0,0,1-11.32-11.32L116.69,128,90.34,101.66a8,8,0,0,1,11.32-11.32L128,116.69l26.34-26.35a8,8,0,0,1,11.32,11.32ZM232,128A104,104,0,1,1,128,24,104.11,104.11,0,0,1,232,128Zm-16,0a88,88,0,1,0-88,88A88.1,88.1,0,0,0,216,128Z',
  caret: 'M213.66,101.66l-80,80a8,8,0,0,1-11.32,0l-80-80A8,8,0,0,1,53.66,90.34L128,164.69l74.34-74.35a8,8,0,0,1,11.32,11.32Z',
});

/** @param {string} name @param {number} [size] */
export function glyph(name, size = 20) {
  const svg = /** @type {SVGSVGElement} */ (document.createElementNS(NS, 'svg'));
  svg.setAttribute('viewBox', '0 0 256 256'); svg.setAttribute('fill', 'currentColor');
  svg.setAttribute('width', String(size)); svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true'); svg.classList.add('icon');
  const p = document.createElementNS(NS, 'path'); p.setAttribute('d', PATHS[name]); svg.append(p);
  return svg;
}

/**
 * Text with the query's words in <mark>. @param {string} text @param {string} q
 * @returns {(string | HTMLElement)[] | string}
 */
export function hl(text, q) {
  const s = String(text ?? '');
  if (!q) return s;
  const rs = matchRanges(s, q);
  if (!rs.length) return s;
  /** @type {(string | HTMLElement)[]} */ const out = [];
  let i = 0;
  for (const [a, b] of rs) { if (a > i) out.push(s.slice(i, a)); out.push(h('mark', { class: 'hl' }, s.slice(a, b))); i = b; }
  if (i < s.length) out.push(s.slice(i));
  return out;
}

/** The word as written in a sentence, in bold. @param {string} text @param {string} form */
export function markForm(text, form) {
  const s = String(text || ''), f = String(form || '');
  const i = f ? s.toLowerCase().indexOf(f.toLowerCase()) : -1;
  return i < 0 ? [s] : [s.slice(0, i), h('b', null, s.slice(i, i + f.length)), s.slice(i + f.length)];
}

/**
 * A list that renders `page` rows at a time: more rows load as the end comes into view, and a button does the same
 * for keyboards and screen readers. Long sections (1,450 phrases, 4,096 words) stay quick on a phone.
 * @param {any[]} items @param {(item: any, i: number) => Node} row
 * @param {{page?: number, more: (n: number, left: number) => string, tag?: string, cls?: string}} o
 * @returns {{el: HTMLElement, stop: () => void}}
 */
export function paged(items, row, { page = 40, more, tag = 'ul', cls = 'lk-list' }) {
  const list = h(tag, { class: cls });
  const btn = /** @type {HTMLButtonElement} */ (h('button', { type: 'button', class: 'btn lk-more pressable' }));
  const wrap = h('div', { class: 'lk-paged' }, list, btn);
  let shown = 0;
  /** @type {IntersectionObserver | null} */ let io = null;
  const step = () => {
    const end = Math.min(items.length, shown + page);
    const frag = document.createDocumentFragment();
    for (let i = shown; i < end; i++) frag.append(row(items[i], i));
    list.append(frag);
    shown = end;
    const left = items.length - shown;
    btn.hidden = left <= 0;
    btn.textContent = left > 0 ? more(Math.min(page, left), left) : '';
    if (left <= 0) io?.disconnect();
  };
  btn.addEventListener('click', () => {
    const start = shown;
    step();
    /** @type {HTMLElement | null | undefined} */ (list.children[start]?.querySelector('a, button'))?.focus({ preventScroll: true });
  });
  step();
  if (typeof IntersectionObserver !== 'undefined' && shown < items.length) {
    io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) step(); }, { rootMargin: '800px 0px' });
    io.observe(btn);
  }
  return { el: wrap, stop: () => io?.disconnect() };
}

/** A small caption with numbers. @param {...any} c */
export const caption = (...c) => h('p', { class: 'caption lk-count' }, ...c);
