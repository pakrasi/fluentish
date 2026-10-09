// The toast (design C §9, F8): one ink pill at a time, above the tab bar, the dock and the keyboard.
//   toast(text, { action, onAction, ms, politeness }) → close      (core/motion.js re-exports it; same signature)
// - Queue, one visible: a new toast replaces the visible one once that has been up MIN_SHOW ms (Undo, then Undone,
//   never stacks; a burst of boot messages each gets a moment). Until then, and while the pointer rests on the pill or
//   the focus is inside it, the new one waits. At most MAX_PENDING wait; the oldest goes first.
// - The same text again (and the same action) restarts the visible one's timer instead of showing a second pill.
// - ms: 4000, or 6000 when there is an action (time to reach Undo with a thumb). Hover or focus inside pauses it.
// - Swipe down or sideways (> SWIPE_PX, or faster than SWIPE_V px/ms) dismisses; a short drag springs back.
// - Spoken through the shell's live regions: #live (polite, the default) or #live-assertive. The pill itself carries
//   no live role, so a screen reader hears it once.
// - Motion: enters 16 px up on spring-snappy (380 ms), leaves 8 px down, ease-in 160 ms; reduced motion: 140 ms fades,
//   swipe still works. With the keyboard up (body.kb) the pill sits at the top of the visible screen, clear of the
//   field and the keyboard's action row, and comes in from above.
// The queue (createToastQueue) is pure: time and drawing are passed in, so node tests drive it with fake timers.
import { animate, reduced } from '../core/motion.js';

export const TOAST_MS = 4000;
export const TOAST_ACTION_MS = 6000;
/** How long a toast stays up before a new one may replace it. */
export const MIN_SHOW = 1200;
export const MAX_VISIBLE = 1;
export const MAX_PENDING = 3;
export const SWIPE_PX = 40;
export const SWIPE_V = 0.5;

/** @typedef {'polite' | 'assertive'} Politeness */
/** @typedef {{ action?: string, onAction?: () => void, ms?: number, politeness?: Politeness }} ToastOpts */
/**
 * @typedef {{ id: number, text: string, action?: string, onAction?: () => void, ms: number, politeness: Politeness,
 *   shownAt: number, left: number, startedAt: number, paused: boolean }} ToastItem
 */
/** How a toast left: its time ran out, a newer one replaced it, it was swiped away, the caller or its action closed it. @typedef {'timeout' | 'replace' | 'swipe' | 'close'} ExitHow */

/** The toast's time on screen. @param {ToastOpts} [o] */
export const toastMs = (o = {}) => (Number.isFinite(o.ms) && Number(o.ms) > 0 ? Number(o.ms) : o.action ? TOAST_ACTION_MS : TOAST_MS);

/**
 * Whether a drag dismisses the toast, and which way it leaves (null: it springs back). Upward drags never dismiss
 * (the pill would fly into the content).
 * @param {number} dx @param {number} dy @param {number} dt ms
 * @returns {'down' | 'left' | 'right' | null}
 */
export function swipeOut(dx, dy, dt) {
  const side = Math.abs(dx), down = Math.max(0, dy);
  const dist = Math.max(side, down);
  if (dist < 8) return null;
  if (dist <= SWIPE_PX && dist / Math.max(1, dt) <= SWIPE_V) return null;
  if (side >= down) return dx < 0 ? 'left' : 'right';
  return 'down';
}

/**
 * The toast queue: at most one visible, the rest waiting. Pure: `now`, timers and drawing come in.
 * @param {{ now: () => number, setTimer: (f: () => void, ms: number) => any, clearTimer: (h: any) => void,
 *   show: (item: ToastItem) => void, hide: (item: ToastItem, how: ExitHow) => void }} io
 */
export function createToastQueue(io) {
  let ids = 0;
  /** @type {ToastItem | null} */ let shown = null;
  /** @type {ToastItem[]} */ const waiting = [];
  /** @type {any} */ let expire = null;
  /** @type {any} */ let next = null;

  const same = (/** @type {ToastItem} */ a, /** @type {string} */ text, /** @type {ToastOpts} */ o) => a.text === text && (a.action || '') === (o.action || '');
  const stopTimers = () => { if (expire != null) io.clearTimer(expire); if (next != null) io.clearTimer(next); expire = next = null; };
  /** Start (or restart) the visible toast's clock with what it has left. */
  function run() {
    if (expire != null) io.clearTimer(expire);
    expire = null;
    if (!shown || shown.paused) return;
    const it = shown;
    it.startedAt = io.now();
    expire = io.setTimer(() => { expire = null; if (shown === it) leave('timeout'); }, it.left);
  }
  /** @param {ExitHow} how */
  function leave(how) {
    const it = shown;
    if (!it) return;
    stopTimers();
    shown = null;
    io.hide(it, how);
    pump();
  }
  /** Show the next waiting toast when the screen is free, or when the visible one has had its moment. */
  function pump() {
    if (next != null) { io.clearTimer(next); next = null; }
    if (!waiting.length) return;
    if (shown) {
      if (shown.paused) return;   // resume() pumps again
      const wait = shown.shownAt + MIN_SHOW - io.now();
      if (wait > 0) { next = io.setTimer(() => { next = null; pump(); }, wait); return; }
      const old = shown;
      if (expire != null) io.clearTimer(expire);
      expire = null; shown = null;
      io.hide(old, 'replace');
    }
    const it = /** @type {ToastItem} */ (waiting.shift());
    shown = it;
    it.shownAt = io.now();
    io.show(it);
    run();
    if (waiting.length) pump();   // the next one waits its turn
  }

  const api = {
    /** @param {string} text @param {ToastOpts} [o] @returns {() => void} close */
    push(text, o = {}) {
      text = String(text ?? '');
      if (shown && same(shown, text, o)) {
        const it = shown;
        it.left = it.ms;
        if (o.onAction) it.onAction = o.onAction;
        run();
        return () => api.close(it.id);
      }
      const dup = waiting.find(w => same(w, text, o));
      if (dup) { if (o.onAction) dup.onAction = o.onAction; return () => api.close(dup.id); }
      const ms = toastMs(o);
      /** @type {ToastItem} */
      const it = { id: ++ids, text, action: o.action, onAction: o.onAction, ms, left: ms, politeness: o.politeness === 'assertive' ? 'assertive' : 'polite', shownAt: 0, startedAt: 0, paused: false };
      waiting.push(it);
      while (waiting.length > MAX_PENDING) waiting.shift();
      pump();
      return () => api.close(it.id);
    },
    /** Close a toast by id (visible or waiting); nothing if it is gone. @param {number} id @param {ExitHow} [how] */
    close(id, how = 'close') {
      if (shown && shown.id === id) { leave(how); return; }
      const k = waiting.findIndex(w => w.id === id);
      if (k >= 0) waiting.splice(k, 1);
    },
    /** Hold the visible toast's clock (pointer on it, focus inside, a drag). @param {number} id */
    pause(id) {
      if (!shown || shown.id !== id || shown.paused) return;
      shown.left = Math.max(0, shown.left - (io.now() - shown.startedAt));
      shown.paused = true;
      run();
      if (next != null) { io.clearTimer(next); next = null; }
    },
    /** Let it run again with the time it had left (never less than a second). @param {number} id */
    resume(id) {
      if (!shown || shown.id !== id || !shown.paused) return;
      shown.paused = false;
      shown.left = Math.max(shown.left, 1000);
      run();
      pump();
    },
    /** The visible toast and how many wait (tests). */
    state: () => ({ shown, waiting: waiting.length }),
    /** Drop everything at once (tests, a full reset). */
    clear() { stopTimers(); waiting.length = 0; const it = shown; shown = null; if (it) io.hide(it, 'close'); },
  };
  return api;
}

/* ------------------------------------------------------------------ */
/* The pill                                                             */
/* ------------------------------------------------------------------ */

const ENTER_MS = 380, EXIT_MS = 160, FADE_MS = 140;

/**
 * One toast pill: the text, the optional action button, swipe-away and pause on hover or focus. The caller (the queue
 * below) decides when it comes and goes; destroy() takes it off the page with its exit move.
 * @param {{ text: string, action?: string, onAction?: () => void, onDismiss?: (how: ExitHow) => void, onPause?: () => void,
 *   onResume?: () => void, signal?: AbortSignal }} opts
 * @returns {import('./index.js').UiCreated<{ text: string }> & { leave: (how: ExitHow) => void }}
 */
export function createToast(opts) {
  const el = document.createElement('div');
  // .toast keeps the shell's placement (components.css, app.css: tab bar, dock, wrap); .ui-toast adds the rest.
  // is-in: the old CSS transition's end state, so the moves below are the only ones.
  el.className = 'toast ui-toast is-in';
  const label = document.createElement('span');
  label.textContent = opts.text;
  el.append(label);
  const ac = new AbortController();
  const sig = { signal: ac.signal };
  opts.signal?.addEventListener('abort', () => destroy(), { once: true, signal: ac.signal });
  if (opts.action) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'btn pressable'; b.textContent = opts.action;
    b.addEventListener('click', e => {
      if (dragged) { e.preventDefault(); e.stopPropagation(); return; }
      opts.onAction?.();
      opts.onDismiss?.('close');
    }, sig);
    el.append(b);
  }

  // keyboard up: the pill moves to the top of the visible screen (styles/ui.css .ui-toast.is-kb)
  const body = document.body;
  const kb = () => el.classList.toggle('is-kb', !!body?.classList.contains('kb'));
  kb();
  if (typeof MutationObserver === 'function' && body) {
    const mo = new MutationObserver(kb);
    mo.observe(body, { attributes: true, attributeFilter: ['class'] });
    ac.signal.addEventListener('abort', () => mo.disconnect(), { once: true });
  }
  const from = () => (el.classList.contains('is-kb') ? -1 : 1);

  // pause while the pointer rests on it (a mouse) or the focus is inside
  let hovered = false, focused = false, held = false;
  const hold = () => { const h = hovered || focused || dragging; if (h === held) return; held = h; (h ? opts.onPause : opts.onResume)?.(); };
  el.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') { hovered = true; hold(); } }, sig);
  el.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') { hovered = false; hold(); } }, sig);
  el.addEventListener('focusin', () => { focused = true; hold(); }, sig);
  el.addEventListener('focusout', e => { if (!el.contains(/** @type {Node | null} */ (e.relatedTarget))) { focused = false; hold(); } }, sig);

  // swipe down or sideways
  let dragging = false, dragged = false, x0 = 0, y0 = 0, t0 = 0, dx = 0, dy = 0, pid = -1;
  el.addEventListener('pointerdown', e => {
    if (e.button !== 0 || leaving) return;
    dragging = true; dragged = false; pid = e.pointerId; x0 = e.clientX; y0 = e.clientY; t0 = e.timeStamp; dx = dy = 0;
    hold();
  }, sig);
  el.addEventListener('pointermove', e => {
    if (!dragging || e.pointerId !== pid) return;
    dx = e.clientX - x0; dy = e.clientY - y0;
    if (!dragged && Math.hypot(dx, dy) > 8) { dragged = true; try { el.setPointerCapture(pid); } catch { /* gone */ } }
    if (!dragged) return;
    // up is resisted: the pill only gives a little
    const y = dy < 0 ? dy / 4 : dy;
    el.style.translate = `${dx}px ${y}px`;
    el.style.opacity = String(Math.max(0.35, 1 - Math.max(Math.abs(dx), Math.max(0, dy)) / 160));
  }, sig);
  const up = (/** @type {PointerEvent} */ e, cancel = false) => {
    if (!dragging || e.pointerId !== pid) return;
    dragging = false;
    const way = !cancel && dragged ? swipeOut(dx, dy, e.timeStamp - t0) : null;
    if (way) { leave('swipe', way); opts.onDismiss?.('swipe'); }
    else if (dragged) {
      const at = el.style.translate || '0px 0px', op = el.style.opacity || '1';
      el.style.translate = ''; el.style.opacity = '';
      if (!reduced()) animate(el, [{ translate: at, opacity: op }, { translate: '0px 0px', opacity: 1 }], { duration: 240, easing: '--spring-snappy' });
    }
    // the click that ends a drag is not a tap on Undo
    if (dragged) setTimeout(() => { dragged = false; }, 0);
    hold();
  };
  el.addEventListener('pointerup', e => up(e), sig);
  el.addEventListener('pointercancel', e => up(e, true), sig);

  document.body.append(el);
  if (reduced()) animate(el, [{ opacity: 0 }, { opacity: 1 }], { duration: FADE_MS, easing: 'linear' });
  else animate(el, [{ opacity: 0, translate: `0px ${16 * from()}px` }, { opacity: 1, translate: '0px 0px' }], { duration: ENTER_MS, easing: '--spring-snappy' });

  let leaving = false;
  /**
   * Take the pill away with its exit move, then off the page.
   * @param {ExitHow} how @param {'down' | 'left' | 'right'} [way] a swipe's direction
   */
  function leave(how, way) {
    if (leaving) return;
    leaving = true;
    ac.abort();
    el.style.pointerEvents = 'none';
    el.setAttribute('aria-hidden', 'true');
    const at = el.style.translate || '0px 0px';
    const op = el.style.opacity || '1';
    let to = `0px ${8 * from()}px`;
    if (how === 'swipe' && way) {
      const [sx, sy] = at.split(' ').map(v => parseFloat(v) || 0);
      to = way === 'down' ? `${sx}px ${Math.max(sy, 0) + 48}px` : `${sx + (way === 'left' ? -120 : 120)}px ${sy}px`;
    }
    const a = reduced()
      ? animate(el, [{ opacity: op }, { opacity: 0 }], { duration: FADE_MS, easing: 'linear', fill: 'forwards' })
      : animate(el, [{ opacity: op, translate: at }, { opacity: 0, translate: to }], { duration: EXIT_MS, easing: 'cubic-bezier(0.55, 0, 0.75, 0.2)', fill: 'forwards' });
    const gone = () => el.remove();
    if (a) { a.finished.then(gone, gone); setTimeout(gone, 600); } else gone();
  }
  function destroy() { leave('close'); }
  return {
    el,
    leave: how => leave(how),
    update(next) { if (next.text != null && next.text !== label.textContent) label.textContent = next.text; },
    destroy,
  };
}

/* ------------------------------------------------------------------ */
/* The app's toast                                                      */
/* ------------------------------------------------------------------ */

/** Say it through the shell's live region (cleared first, then set on the next frame, so a repeat is spoken). @param {string} text @param {Politeness} p */
function announce(text, p) {
  const live = document.getElementById(p === 'assertive' ? 'live-assertive' : 'live') || document.getElementById('live');
  if (!live) return;
  live.textContent = '';
  requestAnimationFrame(() => { live.textContent = text; });
}

/** @type {Map<number, ReturnType<typeof createToast>>} */ const pills = new Map();
/** @type {ReturnType<typeof createToastQueue> | null} */ let queue = null;
function q() {
  if (queue) return queue;
  const qq = createToastQueue({
    now: () => performance.now(),
    setTimer: (f, ms) => setTimeout(f, ms),
    clearTimer: h => clearTimeout(h),
    show(it) {
      announce(it.action ? `${it.text} ${it.action}` : it.text, it.politeness);
      pills.set(it.id, createToast({
        text: it.text, action: it.action,
        onAction: () => it.onAction?.(),
        onDismiss: how => qq.close(it.id, how),
        onPause: () => qq.pause(it.id), onResume: () => qq.resume(it.id),
      }));
    },
    hide(it, how) { const p = pills.get(it.id); pills.delete(it.id); p?.leave(how); },
  });
  queue = qq;
  return qq;
}

/**
 * Show a toast with an optional action. Returns a close function. Auto-closes after `ms` (4 s, 6 s with an action).
 * @param {string} text @param {ToastOpts} [o] @returns {() => void}
 */
export function toast(text, o = {}) { return q().push(text, o); }
