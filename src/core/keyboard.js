/* The on-screen keyboard: one source of truth (round 6). Started once from main.js.

   On iOS Safari the layout viewport keeps its height when the keyboard opens; only window.visualViewport shrinks (and
   pans, offsetTop > 0, to show a caret low on the page). Pages size themselves from three CSS variables on <html>:
     --vv-h   the visual viewport's height (px)
     --vv-top its offsetTop (px)
     --kb     the part of the layout viewport under the keyboard (innerHeight - vv.height - vv.offsetTop, >= 0)
   and body.kb is set while a text field has the focus AND the keyboard is up (more than 120 px tall, so a hardware
   keyboard or an iPad's split view never trips it). In a browser that shrinks the layout viewport instead, the drop
   from the tallest height seen at this width counts as the keyboard.
   body.kb hides the app's chrome (bar, tab bar, docks, hints) and compacts round headers (styles/app.css "Keyboard
   mode"). The class toggle is the only thing that animates (motion.js kbShift); the per-frame viewport events only
   write the variables.

   fitToKeyboard(box) sizes a fixed full-screen box to the visual viewport, so its last row sits on the keyboard.
   keepFocus(btn) stops a button from taking the focus from the field (the keyboard stays up between cards).
   reveal(el) scrolls an element into the visible part of the screen, through every scroll container.
   No other module reads visualViewport or writes its own keep-focus handler (tests/unit/keyboard-lint.test.mjs). */
import { reduced, kbShift } from './motion.js';

/** Keyboards shorter than this are not keyboards (a hardware keyboard's bar, the iPad's floating one). */
export const MIN_KB = 120;
const TEXT_TYPES = new Set(['', 'text', 'search', 'email', 'number', 'password', 'tel', 'url']);

/** A field that opens the on-screen keyboard. @param {Element | null} el */
export function isTextField(el) {
  if (!el || !(/** @type {any} */ (el).tagName)) return false;
  const tag = /** @type {HTMLElement} */ (el).tagName;
  if (tag === 'TEXTAREA') return !(/** @type {HTMLTextAreaElement} */ (el).disabled);
  if (tag === 'INPUT') return TEXT_TYPES.has(String(/** @type {HTMLInputElement} */ (el).getAttribute('type') || '').toLowerCase()) && !(/** @type {HTMLInputElement} */ (el).disabled);
  return /** @type {HTMLElement} */ (el).isContentEditable === true;
}

/**
 * The keyboard from the viewport numbers (pure).
 * @param {{innerHeight: number, base: number, vv: {height: number, offsetTop: number, scale?: number} | null}} o
 *   base: the tallest innerHeight seen at this width (a browser that shrinks the layout viewport)
 * @returns {{h: number, top: number, kb: number, screen: number}} screen: the keyboard's height on the screen
 */
export function measure({ innerHeight, base, vv }) {
  const h = vv ? vv.height : innerHeight;
  const top = vv ? Math.max(0, vv.offsetTop) : 0;
  const zoomed = !!vv && (vv.scale ?? 1) > 1.05;   // a pinch zoom shrinks the visual viewport too: not a keyboard
  const kb = Math.max(0, Math.round(innerHeight - h - top));
  const screen = zoomed ? 0 : Math.max(0, Math.round(Math.max(base, innerHeight) - h));
  return { h: Math.round(h), top: Math.round(top), kb, screen };
}

/** Keyboard mode: a text field has the focus and a real keyboard is up. @param {boolean} typing @param {number} screen */
export const isOpen = (typing, screen) => typing && screen > MIN_KB;

/**
 * How far a scroller must move so a box shows inside [top, bot] (pure). Positive scrolls down.
 * @param {{top: number, bottom: number}} r @param {number} top @param {number} bot @param {'nearest'|'start'|'end'} block
 */
export function revealDelta(r, top, bot, block = 'nearest') {
  if (block === 'start') return r.top - top;
  if (block === 'end') return r.bottom - bot;
  if (r.bottom - r.top > bot - top) return r.top - top;   // taller than the room: its start
  if (r.top < top) return r.top - top;
  if (r.bottom > bot) return r.bottom - bot;
  return 0;
}

let started = false;
let isKb = false;
/** @type {{emit: (name: string, data?: any) => void} | null} */ let theBus = null;

/** True while keyboard mode is on. */
export const keyboardOpen = () => isKb;

/**
 * Start following the keyboard (once). Writes --vv-h, --vv-top and --kb on <html>, toggles body.kb, emits bus 'kb'
 * {open, h, top}.
 * @param {{bus?: {emit: (name: string, data?: any) => void}}} [o]
 */
export function startKeyboard({ bus } = {}) {
  theBus = bus || theBus;
  if (started) return;
  started = true;
  const root = document.documentElement;
  const vv = window.visualViewport || null;
  let base = innerHeight, width = innerWidth, frame = 0, last = '';
  const update = () => {
    frame = 0;
    if (innerWidth !== width) { width = innerWidth; base = innerHeight; }   // turned: a new tallest height
    const typing = isTextField(document.activeElement);
    base = Math.max(base, innerHeight);   // a keyboard only ever lowers it
    const m = measure({ innerHeight, base, vv });
    const key = `${m.h}|${m.top}|${m.kb}`;
    if (key !== last) {
      last = key;
      root.style.setProperty('--vv-h', `${m.h}px`);
      root.style.setProperty('--vv-top', `${m.top}px`);
      root.style.setProperty('--kb', `${m.kb}px`);
    }
    const open = isOpen(typing, m.screen);
    if (open !== isKb) {
      isKb = open;
      // the one animated moment: chrome gives way (or comes back) on the snappy spring; reduced motion: at once
      void kbShift(() => { document.body.classList.toggle('kb', open); });
      theBus?.emit('kb', { open, h: m.h, top: m.top });
    }
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
  vv?.addEventListener('resize', schedule);
  vv?.addEventListener('scroll', schedule);
  addEventListener('resize', schedule);
  // focus moves between fields without the keyboard closing: wait a frame, so focusout+focusin is one change
  document.addEventListener('focusin', schedule);
  document.addEventListener('focusout', schedule);
  // a prompt clamped to three lines in keyboard mode (.kb-clamp) shows all of it on a tap
  document.addEventListener('click', e => {
    const c = /** @type {HTMLElement | null} */ (/** @type {any} */ (e.target)?.closest?.('.kb-clamp'));
    if (c && isKb) c.classList.toggle('is-full');
  });
  update();
}

/**
 * Size a fixed full-screen box to the visual viewport: its height is --vv-h and it follows --vv-top, so its last row
 * sits on the keyboard (CSS: .kb-fit in styles/app.css). Returns a function that undoes it.
 * @param {HTMLElement} box
 */
export function fitToKeyboard(box) {
  box.classList.add('kb-fit');
  return () => box.classList.remove('kb-fit');
}

/** @param {Event} e */
const keepHandler = e => e.preventDefault();
/**
 * A button that never takes the focus from the text field (pointerdown default prevented), so tapping it keeps the
 * iPhone keyboard up. Keyboard activation and click still work. Returns the element.
 * @template {Element} T @param {T} el
 */
export function keepFocus(el) {
  el.addEventListener('pointerdown', keepHandler);
  return el;
}
/** The handler itself, for a builder that takes an onpointerdown option. */
export const keep = keepHandler;

/**
 * Scroll an element into the visible part of the screen (the visual viewport), through every scroll container
 * around it and then the page. Smooth unless motion is reduced.
 * avoid: an element pinned over the bottom of the scroller (a sticky answer field), whose height is kept clear.
 * @param {Element | null | undefined} el @param {{block?: 'nearest'|'start'|'end', margin?: number, avoid?: Element | null}} [o]
 */
export function reveal(el, { block = 'nearest', margin = 8, avoid = null } = {}) {
  if (!el || !el.isConnected) return;
  const vv = window.visualViewport;
  const vTop = vv ? vv.offsetTop : 0, vBot = vTop + (vv ? vv.height : innerHeight);
  const behavior = reduced() ? 'auto' : 'smooth';
  let shift = 0;   // what the inner scrollers already moved (smooth scrolling has not happened yet when we measure on)
  const r0 = el.getBoundingClientRect();
  /** @type {Element[]} */ const scrollers = [];
  for (let a = el.parentElement; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
    const cs = getComputedStyle(a);
    if (/(auto|scroll)/.test(cs.overflowY) && a.scrollHeight > a.clientHeight + 1) scrollers.push(a);
  }
  for (const a of scrollers) {
    const ar = a.getBoundingClientRect();
    const cover = avoid && a.contains(avoid) && !avoid.contains(el) ? avoid.getBoundingClientRect().height : 0;
    const top = Math.max(ar.top, vTop) + margin, bot = Math.min(ar.bottom, vBot) - margin - cover;
    if (bot <= top) continue;
    const d = revealDelta({ top: r0.top - shift, bottom: r0.bottom - shift }, top, bot, block);
    const to = Math.max(0, Math.min(a.scrollHeight - a.clientHeight, a.scrollTop + d));
    const moved = to - a.scrollTop;
    if (moved) { a.scrollTo({ top: to, behavior }); shift += moved; }
  }
  const doc = document.scrollingElement;
  if (doc && doc.scrollHeight > innerHeight + 1 && getComputedStyle(document.body).overflowY !== 'hidden') {
    const d = revealDelta({ top: r0.top - shift, bottom: r0.bottom - shift }, vTop + margin, vBot - margin, block);
    if (d) window.scrollTo({ top: Math.max(0, scrollY + d), behavior });
  }
}
