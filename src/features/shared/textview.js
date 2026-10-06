/* A text to read, with every word a tap target (round 4, reading; conversation can use it for its transcripts). A
   library: it draws and animates, and the caller decides what a tap does.

     textView(o)     the text in Newsreader: one button per word (44 px on touch), suggested words dotted, phrase bands
                     under multi-word items, saved words underlined, names and numbers plain text. One tab stop for the
                     whole text (arrows move between words). light(si, at) lights the tokens of one word across its
                     sentence (both halves of a separable verb), clear() puts them out.
     sheet(o)        a bottom sheet (<dialog>, modal): Esc, the backdrop and Close dismiss it; a route change removes it
     tray(o)         the dock's line of saved words: a count and the newest few. lift(btn) sends a copy of a word into
                     it (core/motion.js fling); reduced motion: no flight, the count just changes
     hairline()      a 2 px progress line under the top edge that follows how far down the text he is

   Built with h(), styles in styles/features/read.css (tv-*). Study-language text carries langAttr()/dirAttr(). */
import { h, replace } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { fling, reduced, countTo } from '../../core/motion.js';
import { t as tr } from '../../core/i18n.js';
import { langAttr, dirAttr } from '../../core/lang.js';

/** @typedef {import('../../domain/text/tokens.js').Token} Token */
/** @typedef {import('../../domain/text/suggest.js').Classified} Classified */

/**
 * @typedef {object} ViewSentence
 * @property {string} id
 * @property {boolean} [p]      starts a paragraph
 * @property {Token[]} toks
 * @property {Classified[]} cls
 * @property {{id: string, at: number[]}[]} [bands]  phrase bands: token indices of each
 */

/**
 * @param {{sentences: ViewSentence[], marks?: boolean, saved?: (lemma: string, si: number, ti: number) => boolean,
 *   onWord: (si: number, ti: number, btn: HTMLElement) => void, label?: string}} o
 *   marks: dotted suggestions and phrase bands (Study mode); saved: a word already saved shows its underline
 */
export function textView({ sentences, marks = true, saved = () => false, onWord, label }) {
  const el = h('div', { class: ['tv-text', !marks && 'is-plain'], lang: langAttr(), dir: dirAttr(), role: 'group', 'aria-label': label || null });
  /** @type {HTMLElement[]} */ let all = [];
  /** @type {Map<string, HTMLElement>} */ const at = new Map();
  /** @type {HTMLElement[]} */ let lit = [];

  function draw() {
    all = []; at.clear();
    /** @type {any[][]} */ const paras = [];
    /** @type {any[]} */ let para = [];
    sentences.forEach((s, si) => {
      if (s.p && para.length) { paras.push(para); para = []; }
      const band = new Map();
      for (const b of s.bands || []) for (const k of b.at) band.set(k, b.id);
      const kids = s.toks.map((tok, ti) => {
        const x = s.cls[ti];
        const space = tok.sp ? ' ' : '';
        if (!x || x.type === 'skip') return space + tok.t;
        if (x.type === 'name') return [space, h('span', { class: 'tv-name' }, tok.t)];
        const inBand = marks && band.has(ti);
        const b = h('button', { type: 'button', tabindex: '-1', class: ['tv-w', marks && x.suggest && 'is-sug', inBand && 'is-band', saved(x.lemma, si, ti) && 'is-saved'],
          dataset: { s: String(si), k: String(ti), band: inBand ? band.get(ti) : null }, onclick: () => onWord(si, ti, b) }, tok.t);
        all.push(b); at.set(`${si}:${ti}`, b);
        return [space, b];
      });
      para.push(h('span', { class: 'tv-sent', dataset: { s: String(si) } }, kids), ' ');
    });
    if (para.length) paras.push(para);
    replace(el, paras.map(p => h('p', { class: 'tv-para' }, p)));
    if (all[0]) all[0].tabIndex = 0;
  }
  el.addEventListener('keydown', e => {
    const i = all.indexOf(/** @type {HTMLElement} */ (e.target));
    if (i < 0) return;
    const to = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? i + 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? all.length - 1 : -2;
    if (to === -2) return;
    e.preventDefault();
    const b = all[Math.max(0, Math.min(all.length - 1, to))];
    all[i].tabIndex = -1; b.tabIndex = 0; b.focus();
  });
  el.addEventListener('focusin', e => {
    const b = /** @type {HTMLElement} */ (e.target);
    if (!all.includes(b)) return;
    for (const x of all) x.tabIndex = x === b ? 0 : -1;
  });
  draw();
  return {
    el,
    redraw: draw,
    /** The button of a token. @param {number} si @param {number} ti */
    button: (si, ti) => at.get(`${si}:${ti}`) || null,
    /** Light the tokens of one word (a separable verb's two halves) or phrase. @param {number} si @param {number[]} ks */
    light(si, ks) { this.clear(); lit = ks.map(k => at.get(`${si}:${k}`)).filter(/** @returns {b is HTMLElement} */ b => !!b); lit.forEach(b => b.classList.add('is-lit')); },
    clear() { lit.forEach(b => b.classList.remove('is-lit')); lit = []; },
    /** Mark the tokens of a lemma as saved, everywhere in the text. @param {(si: number, ti: number) => boolean} test */
    markSaved(test) { for (const b of all) if (test(Number(b.dataset.s), Number(b.dataset.k))) { b.classList.add('is-saved'); b.classList.remove('is-sug'); } },
  };
}

/** The sheets open now (modal dialogs on <body>, outside the view). */
const open = new Set();
/** Close every open sheet at once (the view is going away). */
export function closeSheets() { for (const s of [...open]) s.dismiss(); }

/**
 * A bottom sheet. Focus returns to the opener when it closes.
 * @param {{title: string, titleLang?: boolean, children: any[], onClose?: () => void, cls?: string}} o
 *   titleLang: the title is study-language text
 */
export function sheet({ title, titleLang = false, children, onClose, cls }) {
  const opener = /** @type {HTMLElement | null} */ (document.activeElement);
  const head = h('div', { class: 'tv-sheet-head' }, h('h2', { class: 'tv-sheet-title', lang: titleLang ? langAttr() : null, dir: titleLang ? dirAttr() : null }, title),
    h('button', { type: 'button', class: 'btn btn-quiet pressable tv-sheet-x', 'aria-label': tr('read.close'), onclick: () => close() }, icon('close', { size: 18 })));
  const body = h('div', { class: 'tv-sheet-body' }, children);
  const d = /** @type {HTMLDialogElement} */ (h('dialog', { class: ['tv-sheet', cls], 'aria-label': title }, h('span', { class: 'tv-grab', 'aria-hidden': 'true' }), head, body));
  document.body.append(d);
  let live = true;
  const entry = { dismiss };
  const remove = () => { open.delete(entry); removeEventListener('hashchange', dismiss); try { d.close(); } catch { /* closed */ } d.remove(); };
  function dismiss() { if (!live) return; live = false; remove(); }
  function close() {
    if (!live) return; live = false;
    d.classList.remove('is-in');
    const gone = () => { remove(); opener?.focus?.({ preventScroll: true }); onClose?.(); };
    if (reduced()) gone(); else setTimeout(gone, 160);
  }
  open.add(entry);
  addEventListener('hashchange', dismiss);
  d.addEventListener('cancel', e => { e.preventDefault(); close(); });
  d.addEventListener('click', e => { if (e.target === d) close(); });
  d.showModal();
  requestAnimationFrame(() => d.classList.add('is-in'));
  return { el: d, body, close, set: (/** @type {any[]} */ ...kids) => replace(body, ...kids) };
}

/**
 * The dock's tray: "2 words to review · beibehalten · Branche". A tap opens the list (onOpen).
 * @param {{onOpen: () => void}} o
 */
export function tray({ onOpen }) {
  const countEl = h('b', { class: 'tnum tv-tray-n' }, '0');
  const what = h('span', { class: 'tv-tray-label' });
  const list = h('span', { class: 'tv-tray-list', lang: langAttr(), dir: dirAttr() });
  const el = h('button', { type: 'button', class: 'tv-tray pressable', 'aria-haspopup': 'dialog', onclick: onOpen },
    h('span', { class: 'tv-tray-top' }, countEl, ' ', what), list);
  let n = 0;
  return {
    el,
    /** @param {string[]} lemmas newest first @param {{animate?: boolean}} [o] */
    set(lemmas, { animate = false } = {}) {
      const was = n;
      n = lemmas.length;
      if (animate && !reduced() && n !== was) countTo(countEl, n, { duration: 420 }); else { countEl.textContent = String(n); countEl.dataset.value = String(n); }
      what.textContent = tr('read.tray.label', { n });
      replace(list, lemmas.slice(0, 3).join(' · '));
      el.setAttribute('aria-label', `${tr('read.tray.words', { n })}${n ? `: ${lemmas.slice(0, 3).join(', ')}` : ''}`);
    },
    /** A copy of the word flies into the count. @param {HTMLElement | null} from */
    lift(from) { return from ? fling(from, countEl, { duration: 420 }) : Promise.resolve(); },
  };
}

/**
 * The reading progress line: a fixed 2 px line at the top that fills as the text scrolls by. Returns the element,
 * update() (the share read, 0 to 1, from the text's box), and stop().
 * @param {HTMLElement} textEl @param {(share: number) => void} [onMove]
 */
export function hairline(textEl, onMove) {
  const fill = h('span', { class: 'tv-hair-fill' });
  const el = h('div', { class: 'tv-hair', role: 'progressbar', 'aria-label': tr('read.progress'), 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0' }, fill);
  let share = 0, raf = 0;
  const update = () => {
    raf = 0;
    const r = textEl.getBoundingClientRect();
    const seen = Math.min(r.height, Math.max(0, innerHeight * 0.85 - r.top));
    const s = r.height > 0 ? Math.max(0, Math.min(1, seen / r.height)) : 0;
    if (Math.abs(s - share) < 0.002) return;
    share = s;
    fill.style.transform = `scaleX(${s.toFixed(4)})`;
    el.setAttribute('aria-valuenow', String(Math.round(s * 100)));
    onMove?.(s);
  };
  const onScroll = () => { if (!raf) raf = requestAnimationFrame(update); };
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', onScroll);
  requestAnimationFrame(update);
  return { el, update, share: () => share, stop() { removeEventListener('scroll', onScroll); removeEventListener('resize', onScroll); if (raf) cancelAnimationFrame(raf); } };
}

/**
 * A sentence with some of its tokens marked (the sheet's quote: the word, or both halves of a separable verb).
 * @param {Token[]} toks @param {number[]} at
 */
export function quote(toks, at) {
  const on = new Set(at);
  return h('blockquote', { class: 'tv-quote', lang: langAttr(), dir: dirAttr() }, toks.map((tok, i) => [tok.sp ? ' ' : '', on.has(i) ? h('mark', { class: 'tv-hl' }, tok.t) : tok.t]));
}
