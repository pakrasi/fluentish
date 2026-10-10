/* The sheet (round 8, design C "### 6", architecture F10): one bottom sheet for the whole app, built on <dialog>.

   Phone (< 720 px): a panel on the bottom edge that rises on spring-snappy (DESIGN.md sheet-open), with a grab handle.
   It follows the finger: drag the handle or the header, or the body when it is scrolled to its top (or the sheet is
   not at its top detent). Release: a flick (over 0.6 px/ms in the last 80 ms) goes on to the next detent or closes,
   carried by its speed; a slow release settles on the nearest detent and closes past a third of the lowest one's
   height (domain/sheet-drag.js). Past the top it gives a quarter of the finger's way. The backdrop follows the panel.
   From 720 px: a 440 px card in the middle (placement 'side': a 380 px card at the top end), no drag.
   Detents: ['full'] (default) or ['peek', 'full'] with `peek` as a share of the height or px; the first is where it
   opens. Keyboard up (body.kb): the panel sits on the keyboard, no taller than the visible screen, at its top detent.

   Closing: the handle (named by labels.close on a one-detent sheet; Expand/Collapse with aria-expanded on two, where
   a tap toggles), Esc, a tap on the backdrop, a drag, close(reason), or opts.signal (the router's ctx.signal: the
   sheet goes at once when the view is left). onClose(reason) runs once, after the dialog is gone and the focus is
   back on the opener. The page under it never scrolls with the sheet (touches outside the sheet's own scrolling
   body are held), and nothing is set on the page's own scroll, so nothing can stay locked.
   Reduced motion: open and close are a 140 ms fade; a drag still follows the finger and the release snaps.

     const s = createSheet({ title: 'Round size', body: [...], actions: [startBtn], opener: link,
       labels: { close: t('practice.size.close') }, signal: ctx.signal, onClose: reason => ... });
     s.update({ body: [...] }); s.setDetent('full'); await s.close('done');

   Strings come from the caller (src/ui/index.js). Motion: CSS transitions on motion.css tokens (styles/ui.css
   "ui/sheet"); this file only moves the panel's --ui-sheet-y under the finger. */
import { icon } from '../core/icons.js';
import { reduced } from '../core/motion.js';
import { addSample, velocity, follow, stops, settle, closeMs, scrimAt, FLING } from '../domain/sheet-drag.js';

const WIDE = '(min-width: 720px)';
/** Movement under this many px is still a tap. */
const SLOP = 4;
/** The slow close (DESIGN: exits on --dur-quick) and the reduced-motion fade. */
const OUT_MS = 160, FADE_MS = 140;
let count = 0;

/** @typedef {import('../domain/sheet-drag.js').Detent} Detent */
/** @typedef {Node | string | null | undefined | false} Child */
/**
 * @typedef {object} SheetOpts
 * @property {string | HTMLElement} title         text, or the caller's own heading element (kept, given an id)
 * @property {Child | Child[]} [body]
 * @property {Child | Child[]} [actions]          a row under the body that never scrolls away (the primary button)
 * @property {Detent[]} [detents]                 ['full'] or ['peek', 'full']; it opens at the first
 * @property {number} [peek]                      the peek height: a share of the full height (0 to 1) or px
 * @property {'bottom' | 'side'} [placement]      'side': from 720 px a card at the top end instead of the middle
 * @property {boolean} [modal]                    false: no backdrop, the page stays usable (show() for showModal())
 * @property {HTMLElement | (() => HTMLElement | null | undefined) | null} [opener]  gets the focus back on close
 * @property {HTMLElement | null} [focus]         takes the focus on open (default: the title, with no ring)
 * @property {{close: string, expand?: string, collapse?: string}} labels
 * @property {boolean} [closeButton]              (kept for callers) every sheet has its × now: on a phone the handle
 *                                                closes it and the × is hidden; from 720 px, where there is no handle, the × shows
 * @property {string} [className]                 the caller's class on the dialog
 * @property {(reason: string) => void} [onClose]
 * @property {AbortSignal} [signal]
 */
/**
 * @typedef {import('./index.js').UiCreated<Pick<SheetOpts, 'title' | 'body' | 'actions'>> & {
 *   panel: HTMLElement, titleEl: HTMLElement, detent: () => Detent,
 *   setDetent: (d: Detent) => void, close: (reason?: string) => Promise<void>, closed: Promise<string>
 * }} Sheet
 */

/** @param {Child | Child[]} c @returns {(Node | string)[]} */
const list = c => (Array.isArray(c) ? c : [c]).filter(/** @returns {x is Node | string} */ x => x != null && x !== false);

/**
 * A small h() (core/dom.js is not on the strict list): attributes as strings, a class list, children.
 * @param {string} tag @param {Record<string, string | false | null | undefined | (string | false | null | undefined)[]>} attrs @param {...Child} kids
 * @returns {HTMLElement}
 */
function h(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = (Array.isArray(v) ? v : [v]).filter(Boolean).join(' ');
    else if (v != null && v !== false && !Array.isArray(v)) n.setAttribute(k, v);
  }
  n.append(...list(kids));
  return n;
}

/**
 * Build the sheet and open it at once.
 * @param {SheetOpts} opts
 * @returns {Sheet}
 */
export function createSheet(opts) {
  const { detents = ['full'], peek = 0.5, placement = 'bottom', modal = true, labels, signal } = opts;
  const id = `ui-sheet-${++count}`;
  const ac = new AbortController();
  const on = { signal: ac.signal };
  const wide = matchMedia(WIDE);
  const two = detents.length > 1;

  // ---------- the parts ----------
  const titleEl = typeof opts.title === 'string' ? h('h2', {}, opts.title) : opts.title;
  titleEl.classList.add('ui-sheet-title');
  if (!titleEl.id) titleEl.id = `${id}-t`;
  titleEl.tabIndex = -1;
  const grab = h('button', { type: 'button', class: 'ui-sheet-grab', 'aria-label': labels.close }, h('span', { class: 'ui-sheet-grip', 'aria-hidden': 'true' }));
  // one close control per size: the handle on a phone, the × from 720 px (styles/ui.css)
  const x = h('button', { type: 'button', class: 'btn btn-quiet pressable ui-sheet-x', 'aria-label': labels.close }, icon('close', { size: 18 }));
  const head = h('div', { class: 'ui-sheet-head' }, titleEl, x);
  const body = h('div', { class: 'ui-sheet-body' });
  const actions = h('div', { class: 'ui-sheet-actions' });
  const panel = h('div', { class: 'ui-sheet-panel' }, grab, head, body, actions);
  const scrim = modal ? h('div', { class: 'ui-sheet-scrim', 'aria-hidden': 'true' }) : null;
  const el = /** @type {HTMLDialogElement} */ (h('dialog', {
    class: ['ui-sheet', placement === 'side' && 'is-side', !modal && 'is-modeless', two && 'is-detents', opts.className], 'aria-labelledby': titleEl.id,
  }, scrim, panel));

  /** @param {Partial<Pick<SheetOpts, 'title' | 'body' | 'actions'>>} next */
  function fill(next) {
    if (typeof next.title === 'string') titleEl.textContent = next.title;
    if ('body' in next) body.replaceChildren(...list(next.body));
    if ('actions' in next) { actions.replaceChildren(...list(next.actions)); actions.hidden = !actions.childNodes.length; }
  }
  fill(opts);

  // ---------- state ----------
  /** @type {'open' | 'closing' | 'closed'} */ let phase = 'open';
  let rm = reduced();
  let height = 0, y = 0;
  /** @type {Detent} */ let detent = detents[0] || 'full';
  /** @type {(reason: string) => void} */ let resolveClosed = () => {};
  /** @type {Promise<string>} */ const closed = new Promise(r => { resolveClosed = r; });
  let timer = /** @type {ReturnType<typeof setTimeout> | 0} */ (0);

  const canDrag = () => phase === 'open' && !wide.matches;
  const stopList = () => stops(height, two ? detents : ['full'], peek);
  /** @param {number} to @param {boolean} [instant] */
  function place(to, instant = false) {
    y = to;
    if (instant) el.classList.add('is-dragging');
    panel.style.setProperty('--ui-sheet-y', `${Math.round(to * 10) / 10}px`);
    el.style.setProperty('--ui-sheet-o', String(scrimAt(Math.max(0, to), height || 1)));
    if (instant) { void panel.offsetHeight; el.classList.remove('is-dragging'); }
  }
  function measure() {
    height = panel.offsetHeight;
    const s = stopList().find(s => s.name === detent) || stopList()[0];
    return s.y;
  }
  /** @param {Detent} d @param {boolean} [instant] */
  function setDetent(d, instant = false) {
    if (phase !== 'open' || !detents.includes(d)) return;
    detent = d;
    if (wide.matches) { place(0, instant); return; }
    place(measure(), instant);
    if (two) {
      const full = d === stopList()[0].name;
      grab.setAttribute('aria-expanded', String(full));
      grab.setAttribute('aria-label', (full ? labels.collapse : labels.expand) || labels.close);
    }
  }

  // ---------- open ----------
  document.body.append(el);
  if (modal) el.showModal(); else el.show();
  el.classList.toggle('is-rm', rm);
  setDetent(detent, true);
  void panel.offsetHeight;   // the closed position is drawn first, so the move to the detent is a transition
  el.classList.add('is-shown');
  // a tap opened it: the focus is there for Enter, with no ring on a touch screen (Safari shows one after a tap)
  (opts.focus || titleEl).focus(/** @type {any} */ ({ preventScroll: true, focusVisible: opts.focus && matchMedia('(pointer: coarse)').matches ? false : undefined }));

  // ---------- close ----------
  /**
   * Resolves once the sheet is gone, whatever ends it (its own animation, a route change or destroy()); `closed` says
   * why. An instant close during the animation (the route is left: Back right after Start) ends it at once with its
   * own reason, so the reason the animation began with ('start') never wins over the route.
   * @param {string} reason @param {{instant?: boolean, v?: number}} [o]
   * @returns {Promise<void>}
   */
  function close(reason = 'button', { instant = false, v = 0 } = {}) {
    if (phase === 'closing' && instant) finish(reason);
    if (phase !== 'open') return closed.then(() => {});
    phase = 'closing';
    rm = reduced();
    el.classList.toggle('is-rm', rm);
    const flung = !rm && v > FLING;
    const ms = instant ? 0 : rm ? FADE_MS : flung ? closeMs(height - y, v) : OUT_MS;
    el.style.setProperty('--ui-sheet-ms', `${ms}ms`);
    el.style.setProperty('--ui-sheet-ease', flung ? 'var(--ease-out)' : 'var(--ease-in)');
    el.classList.remove('is-dragging');
    el.classList.add('is-closing');
    el.classList.remove('is-shown');
    if (ms) timer = setTimeout(() => finish(reason), ms); else finish(reason);
    return closed.then(() => {});
  }
  /** @param {string} reason */
  function finish(reason) {
    if (phase === 'closed') return;
    phase = 'closed';
    clearTimeout(timer);
    ac.abort();
    kbWatch.disconnect();
    if (el.open) el.close();
    el.remove();
    if (reason !== 'route' && reason !== 'destroy') {
      const to = typeof opts.opener === 'function' ? opts.opener() : opts.opener;
      if (to?.isConnected) to.focus({ preventScroll: true });
    }
    resolveClosed(reason);
    opts.onClose?.(reason);
  }

  // the keyboard (core/keyboard.js sets body.kb): sit on it, at the top detent
  const kbWatch = new MutationObserver(() => {
    const kb = document.body.classList.contains('kb');
    if (kb === el.classList.contains('is-kb')) return;
    el.classList.toggle('is-kb', kb);
    if (phase === 'open') setDetent(kb ? stopList()[0].name : detent, true);
  });
  kbWatch.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  if (document.body.classList.contains('kb')) { el.classList.add('is-kb'); setDetent(stopList()[0].name, true); }

  // ---------- the handle, Esc, the backdrop, the route ----------
  let dragged = false;   // a mouse drag on the handle ends in a click that must not close it
  grab.addEventListener('click', () => {
    if (dragged) { dragged = false; return; }
    if (!two || wide.matches) { void close('button'); return; }
    const [top, low] = stopList();
    setDetent(detent === top.name ? low.name : top.name);
  }, on);
  x?.addEventListener('click', () => void close('button'), on);
  el.addEventListener('cancel', e => { e.preventDefault(); void close('esc'); }, on);
  el.addEventListener('close', () => finish('esc'), on);   // closed by the browser itself (a second Esc in Chrome)
  if (!modal) el.addEventListener('keydown', e => { if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); void close('esc'); } }, on);
  scrim?.addEventListener('click', () => void close('backdrop'), on);
  if (signal) {
    if (signal.aborted) finish('route');
    else signal.addEventListener('abort', () => void close('route', { instant: true }), on);
  }
  addEventListener('resize', () => { if (phase === 'open') setDetent(detent, true); }, on);

  // ---------- the drag ----------
  /** @type {{zone: 'handle' | 'body' | 'outside', x0: number, y0: number, base: number, decided: boolean, drag: boolean, samples: import('../domain/sheet-drag.js').Sample[]} | null} */
  let g = null;
  /** @param {EventTarget | null} t */
  const zoneOf = t => {
    const n = /** @type {Element | null} */ (t instanceof Element ? t : null);
    if (!n || !panel.contains(n)) return 'outside';
    if (body.contains(n)) return 'body';
    return 'handle';
  };
  /** A text field keeps its own touches (selecting, moving the caret). @param {EventTarget | null} t */
  const isField = t => t instanceof Element && !!t.closest('input, textarea, select, [contenteditable="true"]');
  /** @param {'handle' | 'body' | 'outside'} zone @param {number} cx @param {number} cy @param {number} t */
  function start(zone, cx, cy, t) {
    g = { zone, x0: cx, y0: cy, base: y, decided: false, drag: false, samples: addSample([], t, cy) };
  }
  /** Decide on the first real move whether this gesture moves the sheet. @param {number} dx @param {number} dy */
  function decide(dx, dy) {
    if (!g) return;
    g.decided = true;
    if (!canDrag() || g.zone === 'outside' || Math.abs(dx) > Math.abs(dy)) return;
    if (g.zone === 'handle') g.drag = true;
    else g.drag = y > stopList()[0].y + 1 || (body.scrollTop <= 0 && dy > 0);
    if (g.drag) { height = panel.offsetHeight; el.classList.add('is-dragging'); }
  }
  /** @param {number} cy @param {number} t */
  function move(cy, t) {
    if (!g?.drag) return;
    g.samples = addSample(g.samples, t, cy);
    place(follow(g.base + cy - g.y0, stopList()[0].y));
  }
  /** @param {number} t */
  function end(t) {
    const gg = g;
    g = null;
    if (!gg?.drag) return;
    const v = velocity(gg.samples, t);
    el.classList.remove('is-dragging');
    const r = settle({ y, v, height, stops: stopList() });
    if (r.to === 'closed') { void close('drag', { v }); return; }
    if (rm) setDetent(r.to, true); else setDetent(r.to);
  }

  // touch: Touch Events, so a move can be held (preventDefault) before the browser starts to scroll
  el.addEventListener('touchstart', e => {
    if (e.touches.length !== 1 || isField(e.target)) { g = null; return; }
    const p = e.touches[0];
    start(zoneOf(e.target), p.clientX, p.clientY, e.timeStamp);
  }, { ...on, passive: true });
  el.addEventListener('touchmove', e => {
    const p = e.touches[0];
    if (!g || !p) return;
    const dx = p.clientX - g.x0, dy = p.clientY - g.y0;
    if (!g.decided) { if (Math.hypot(dx, dy) < SLOP) { if (g.zone !== 'body' && e.cancelable) e.preventDefault(); return; } decide(dx, dy); }
    // the page never scrolls under the sheet: only the body scrolls, and only when it has something to scroll
    const scrolls = g.zone === 'body' && !g.drag && body.scrollHeight > body.clientHeight + 1;
    if (!scrolls && e.cancelable) e.preventDefault();
    move(p.clientY, e.timeStamp);
  }, { ...on, passive: false });
  el.addEventListener('touchend', e => end(e.timeStamp), on);
  el.addEventListener('touchcancel', e => end(e.timeStamp), on);

  // a mouse or a pen: the handle and the header only
  el.addEventListener('pointerdown', e => {
    if (e.pointerType === 'touch' || e.button !== 0 || zoneOf(e.target) !== 'handle' || isField(e.target)) return;
    dragged = false;
    start('handle', e.clientX, e.clientY, e.timeStamp);
  }, on);
  el.addEventListener('pointermove', e => {
    if (e.pointerType === 'touch' || !g) return;
    const dx = e.clientX - g.x0, dy = e.clientY - g.y0;
    if (!g.decided) {
      if (Math.hypot(dx, dy) < SLOP) return;
      decide(dx, dy);
      if (g.drag) { dragged = true; try { panel.setPointerCapture(e.pointerId); } catch { /* the pointer is gone */ } }
    }
    move(e.clientY, e.timeStamp);
  }, on);
  el.addEventListener('pointerup', e => { if (e.pointerType !== 'touch') end(e.timeStamp); }, on);
  el.addEventListener('pointercancel', e => { if (e.pointerType !== 'touch') end(e.timeStamp); }, on);

  return {
    el, panel, titleEl, closed,
    detent: () => detent,
    setDetent: d => setDetent(d),
    update: next => fill(next),
    close: (reason = 'button') => close(reason),
    destroy: () => { if (phase !== 'closed') finish('destroy'); },
  };
}
