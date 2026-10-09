// Fluentish motion helpers. ES module, no dependencies. About 5 kB gzipped.
// Every export works under reduced motion: movement is dropped, state still changes. Haptics: services/haptics.js.
import { tap } from '../services/haptics.js';
import { log } from './log.js';
import { clamp01, countAt, dash, ringGeometry } from '../domain/meter.js';

const root = document.documentElement;
root.classList.add('js');
const mq = matchMedia('(prefers-reduced-motion: reduce)');

/** True when motion should be reduced (system setting or html[data-motion="reduce"]). */
export function reduced() {
  const m = root.dataset.motion;
  if (m === 'reduce') return true;
  if (m === 'full') return false;
  return mq.matches;
}

/** A duration token in ms. @param {string} name @param {number} fallback */
const cssMs = (name, fallback) => {
  const v = getComputedStyle(root).getPropertyValue(name).trim();
  return v ? parseFloat(v) : fallback;
};
/** @param {number} ms @returns {Promise<void>} */
const wait = ms => new Promise(r => setTimeout(r, ms));
/** @returns {Promise<number>} */
const raf = () => new Promise(r => requestAnimationFrame(r));

/* ------------------------------------------------------------------ */
/* Easing for the Web Animations API                                    */
/* ------------------------------------------------------------------ */

/** The kit's ease-out curve: what every spring falls back to. */
export const EASE_OUT = 'cubic-bezier(0.22, 1, 0.36, 1)';

/**
 * Choose an easing WAAPI will take: the value itself when `accepts` says so, else the fallback (pure; tested in node).
 * @param {string | null | undefined} value @param {(v: string) => boolean} accepts @param {string} [fallback]
 */
export function pickEasing(value, accepts, fallback = EASE_OUT) {
  const v = String(value || '').trim();
  return v && accepts(v) ? v : fallback;
}

/** @type {Map<string, boolean>} */ const takes = new Map();
/** Whether element.animate() takes this easing here (WebKit throws on linear() in WAAPI while CSS takes it). @param {string} v */
function waapiTakes(v) {
  if (takes.has(v)) return /** @type {boolean} */ (takes.get(v));
  let ok = true;
  try { const a = document.createElement('div').animate([{ opacity: 1 }, { opacity: 1 }], { duration: 1, easing: v }); a.cancel(); } catch { ok = false; }
  takes.set(v, ok);
  return ok;
}

/**
 * A kit easing for element.animate(): a token name ('--spring-pop', 'var(--spring-pop)') or a curve. Springs are
 * linear() curves, which WAAPI in WebKit rejects with a TypeError: there they become the ease-out curve, so an
 * animation never throws and never stops a flow. Use this for every easing passed to element.animate().
 * @param {string} nameOrValue @param {string} [fallback]
 */
export function easing(nameOrValue, fallback = EASE_OUT) {
  let v = String(nameOrValue || '').trim();
  const m = /^var\((--[\w-]+)\)$/.exec(v);
  if (m) v = m[1];
  if (v.startsWith('--')) v = getComputedStyle(root).getPropertyValue(v).trim();
  return pickEasing(v, waapiTakes, fallback);
}

/**
 * element.animate() with a safe easing (easing() above); returns the Animation, or null when the element cannot
 * animate. Movement only: callers check reduced() themselves.
 * @param {Element | null | undefined} el @param {Keyframe[]} frames @param {KeyframeAnimationOptions} [o]
 */
export function animate(el, frames, o = {}) {
  if (!el || !(/** @type {any} */ (el).animate)) return null;
  const opts = o.easing ? { ...o, easing: easing(String(o.easing)) } : o;
  try { return el.animate(frames, opts); } catch { return el.animate(frames, { ...opts, easing: EASE_OUT }); }
}

/* ------------------------------------------------------------------ */
/* Tracked moves: play, finishAll, nudge, pop (from build/fx.js)        */
/* ------------------------------------------------------------------ */

/** Moves started by play() that are still running, so a new moment can finish the last one at once. @type {Set<Animation>} */
const running = new Set();

/**
 * Animate unless motion is reduced, through animate() (safe easing); resolves when the move is done, finished or
 * cancelled, or at once under reduced motion. `fill` defaults to 'backwards'. Every move is tracked for finishAll().
 * DESIGN.md: keyframes are transform and opacity only.
 * @param {Element | null | undefined} el @param {Keyframe[]} frames @param {KeyframeAnimationOptions} [o]
 * @returns {Promise<void>}
 */
export function play(el, frames, o = {}) {
  if (!el || reduced()) return Promise.resolve();
  const a = animate(el, frames, { fill: 'backwards', ...o });
  if (!a) return Promise.resolve();
  running.add(a);
  return a.finished.then(() => { running.delete(a); }, () => { running.delete(a); });
}

/** Jump every move play() started to its end (a tap during a flight, Enter to skip, an unmount). */
export function finishAll() { for (const a of [...running]) { try { a.finish(); } catch { /* already gone */ } } running.clear(); }

/** The damped nudge of a wrong pick: -7, 5, -2, 0 px over 300 ms; nothing under reduced motion. @param {Element | null | undefined} el */
export const nudge = el => play(el, [{ transform: 'translateX(0)' }, { transform: 'translateX(-7px)' }, { transform: 'translateX(5px)' }, { transform: 'translateX(-2px)' }, { transform: 'none' }], { duration: 300 });

/**
 * The pop of a right pick: 1 → 1.12 → 1 on the pop spring (420 ms); nothing under reduced motion.
 * @param {Element | null | undefined} el @param {string} [base] the element's own transform, kept under the scale
 */
export const pop = (el, base = '') => play(el, [{ transform: `${base} scale(1)` }, { transform: `${base} scale(1.12)` }, { transform: `${base} scale(1)` }], { duration: 420, easing: '--spring-pop' });

/* ------------------------------------------------------------------ */
/* Choreography: sequence()                                             */
/* ------------------------------------------------------------------ */

/**
 * When a step starts: ms from the start of the sequence, '<' with the previous step, '>' when the previous step ends
 * (its start + dur), '+=n' / '-=n' n ms after / before the previous step ends. Default '>'.
 * @typedef {number | '<' | '>' | `+=${number}` | `-=${number}`} SeqAt
 */
/**
 * What a step's run() may hand back: an Animation (or several) that finish() jumps to its end, or nothing.
 * @typedef {Animation | null | undefined | void | Promise<unknown> | (Animation | null | undefined)[]} SeqResult
 */
/**
 * One step. run(instant) does the step's work; with instant true (finish(), reduced motion) it must set the step's end
 * state with no motion. dur (ms, default 0) only places the next '>' or '+=n' step; it does not stop anything.
 * @typedef {{ at?: SeqAt, dur?: number, run: (instant: boolean) => SeqResult }} SeqStep
 */
/**
 * The handle sequence() returns. finish(): every step not run yet runs now with instant = true, in order, and the
 * Animations steps handed back jump to their end. cancel(): no further step runs (what already runs is left alone).
 * Both are idempotent, and neither does anything once the sequence is over. done resolves true once every step has
 * run (on time or through finish()), false when cancelled.
 * @typedef {{ finish: () => void, cancel: () => void, done: Promise<boolean> }} Sequence
 */

/**
 * The start time of each step in ms (pure; tested in node). Throws a TypeError on an `at` it does not know.
 * @param {readonly Pick<SeqStep, 'at' | 'dur'>[]} steps @returns {number[]}
 */
export function seqTimes(steps) {
  /** @type {number[]} */ const out = [];
  let prevStart = 0, prevEnd = 0;
  for (const s of steps) {
    const at = s.at ?? '>';
    let start;
    if (typeof at === 'number' && Number.isFinite(at)) start = at;
    else if (at === '<') start = prevStart;
    else if (at === '>') start = prevEnd;
    else {
      const m = typeof at === 'string' ? /^([+-])=(\d+(?:\.\d+)?)$/.exec(at) : null;
      if (!m) throw new TypeError(`sequence: unknown at ${String(at)}`);
      start = prevEnd + (m[1] === '-' ? -1 : 1) * Number(m[2]);
    }
    start = Math.max(0, start);
    out.push(start);
    prevStart = start;
    prevEnd = start + Math.max(0, s.dur ?? 0);
  }
  return out;
}

/**
 * A skippable timeline of steps (GSAP's position parameter, without the library). Steps at 0 run at once, inside
 * this call; the others on timers, steps with the same start in their order. Under reduced motion every step runs at
 * once with instant = true. A step that throws is logged and the others still run.
 * signal (the view's ctx.signal): when it aborts the sequence is cancelled, so nothing runs after an unmount.
 * Use finish() for Enter-to-skip, and cancel() (or the signal) when the elements are gone.
 * @param {readonly SeqStep[]} steps @param {{ signal?: AbortSignal }} [o] @returns {Sequence}
 */
export function sequence(steps, { signal } = {}) {
  const times = seqTimes(steps);
  const ran = steps.map(() => false);
  /** @type {Animation[]} */ const anims = [];
  /** @type {ReturnType<typeof setTimeout>[]} */ const timers = [];
  let over = false;
  /** @type {(v: boolean) => void} */ let settle = () => {};
  /** @type {Promise<boolean>} */ const done = new Promise(r => { settle = r; });
  const onAbort = () => cancel();

  /** @param {boolean} ok */
  const end = ok => {
    if (over) return;
    over = true;
    for (const t of timers) clearTimeout(t);
    signal?.removeEventListener('abort', onAbort);
    settle(ok);
  };
  /** @param {number} i @param {boolean} instant */
  const runStep = (i, instant) => {
    if (ran[i]) return;
    ran[i] = true;
    /** @type {SeqResult} */ let r;
    try { r = steps[i].run(instant); } catch (e) { log('motion.sequence', e); }
    if (r instanceof Promise) r.catch(e => log('motion.sequence', e));
    for (const a of Array.isArray(r) ? r : [r]) if (a && typeof (/** @type {Animation} */ (a)).finish === 'function') anims.push(/** @type {Animation} */ (a));
  };
  function finish() {
    if (over) return;
    for (const t of timers) clearTimeout(t);
    const order = steps.map((_, i) => i).sort((a, b) => times[a] - times[b] || a - b);
    for (const i of order) runStep(i, true);
    for (const a of anims) { try { a.finish(); } catch { /* gone, or infinite */ } }
    end(true);
  }
  function cancel() { end(false); }

  /** @type {Sequence} */ const handle = { finish, cancel, done };
  if (signal?.aborted) { end(false); return handle; }
  signal?.addEventListener('abort', onAbort, { once: true });
  if (reduced()) { finish(); return handle; }
  /** @type {Map<number, number[]>} */ const at = new Map();
  steps.forEach((_, i) => at.set(times[i], [...(at.get(times[i]) || []), i]));
  for (const [ms, idx] of [...at].sort((a, b) => a[0] - b[0])) {
    if (over) break;   // a step at 0 aborted the signal or cancelled
    const fire = () => {
      for (const i of idx) { if (over) return; runStep(i, false); }
      if (!over && ran.every(Boolean)) end(true);
    };
    if (ms === 0) fire(); else timers.push(setTimeout(fire, ms));
  }
  if (!steps.length) end(true);
  return handle;
}

/* ------------------------------------------------------------------ */
/* One-shot attention: pulse()                                          */
/* ------------------------------------------------------------------ */

/**
 * The pulses styles/ui.css defines (section core/pulse):
 *   'locus' an accent underline draws under the element, start to end (240 ms ease-out), holds, and goes (1.44 s in
 *           all): where a retype differs. Reduced motion: it appears at once and still holds 1.2 s (it is information).
 *   'look'  the element swells once, 1 → 1.06 → 1 (420 ms, eased in and out), on the `scale` property so the
 *           element's own transform is kept: a clue, a landing. Reduced motion: no swell.
 * @typedef {'locus' | 'look'} PulseKind
 */

/** The running pulse per element: ends it early. @type {WeakMap<HTMLElement, () => void>} */
const pulsing = new WeakMap();

/** Total length in ms of the animations a computed style lists (delay + duration × iterations, the longest). @param {CSSStyleDeclaration} cs */
function animationMs(cs) {
  const list = (/** @type {string} */ v) => String(v || '').split(',').map(x => x.trim());
  const ms = (/** @type {string} */ v) => (v.endsWith('ms') ? parseFloat(v) : parseFloat(v) * 1000) || 0;
  const names = list(cs.animationName), durs = list(cs.animationDuration), delays = list(cs.animationDelay), its = list(cs.animationIterationCount);
  let total = 0;
  names.forEach((n, i) => {
    if (!n || n === 'none') return;
    const it = its[i % its.length] === 'infinite' ? 1 : parseFloat(its[i % its.length]) || 1;
    total = Math.max(total, ms(delays[i % delays.length] || '0s') + ms(durs[i % durs.length] || '0s') * it);
  });
  return total;
}

/**
 * A one-shot "look here": sets data-pulse=<kind> on the element and takes it off when the pulse's animation ends
 * (or at once when the style gives it none). A new pulse on the same element ends the running one first. Resolves
 * when the pulse is over, or at once when signal (the view's) aborts, which also takes the pulse off.
 * @param {HTMLElement | null | undefined} el @param {PulseKind} kind @param {{ signal?: AbortSignal }} [o]
 * @returns {Promise<void>}
 */
export function pulse(el, kind, { signal } = {}) {
  if (!el || signal?.aborted) return Promise.resolve();
  const again = pulsing.has(el) || !!el.dataset.pulse;
  pulsing.get(el)?.();
  if (again) { delete el.dataset.pulse; void el.offsetWidth; }   // off for one style pass, so the same pulse restarts
  el.dataset.pulse = kind;
  const total = animationMs(getComputedStyle(el));
  return new Promise(resolve => {
    /** @type {ReturnType<typeof setTimeout> | undefined} */ let timer;
    /** @param {AnimationEvent} e */
    const onEnd = e => { if (e.target === el && e.animationName.startsWith(`pulse-${kind}`)) stop(); };
    function stop() {
      if (pulsing.get(/** @type {HTMLElement} */ (el)) !== stop) return;
      pulsing.delete(/** @type {HTMLElement} */ (el));
      clearTimeout(timer);
      el?.removeEventListener('animationend', onEnd);
      signal?.removeEventListener('abort', stop);
      if (el?.dataset.pulse === kind) delete el.dataset.pulse;
      resolve();
    }
    pulsing.set(el, stop);
    if (!total) { stop(); return; }
    el.addEventListener('animationend', onEnd);
    signal?.addEventListener('abort', stop, { once: true });
    timer = setTimeout(stop, total + 100);   // animationend never comes for an element that left the page
  });
}

/* ------------------------------------------------------------------ */
/* Transitions                                                          */
/* ------------------------------------------------------------------ */

/**
 * Swap content with a choreographed transition.
 * update: sync or async function that changes the DOM.
 * kind: 'forward' | 'back' (study card, element needs view-transition-name: fx-card)
 *       'lift' (the study card lifts away and the next rises into its place: "I know this")
 *       'view' (route/tab change, element needs view-transition-name: fx-view)
 * fallbackEl: element to animate with WAAPI-by-class when View Transitions are missing.
 * Resolves when the new state is on screen (not when the animation ends), so input is never blocked.
 * @param {() => unknown} update
 * @param {{ kind?: 'forward' | 'back' | 'lift' | 'view', fallbackEl?: HTMLElement | null }} [o]
 */
export async function swap(update, { kind = 'forward', fallbackEl = null } = {}) {
  if (reduced() || !document.startViewTransition) {
    if (reduced() || !fallbackEl) { await update(); if (fallbackEl && reduced()) crossfade(fallbackEl); return; }
    const outCls = kind === 'back' ? 'fx-out-right' : kind === 'view' ? null : kind === 'lift' ? 'fx-out-up' : 'fx-out-left';
    if (outCls) { fallbackEl.classList.add(outCls); await wait(kind === 'lift' ? 260 : cssMs('--dur-quick', 160)); fallbackEl.classList.remove(outCls); }
    await update();
    const inCls = kind === 'back' ? 'fx-in-left' : kind === 'view' ? 'fx-rise' : kind === 'lift' ? 'fx-in-up' : 'fx-in-right';
    fallbackEl.classList.add(inCls);
    const el = fallbackEl;
    el.addEventListener('animationend', () => el.classList.remove(inCls), { once: true });
    return;
  }
  // A route change can start while the last transition is still running (a tap right after arriving). Each swap
  // takes a generation number, and only the newest one may take data-vt and the handoff names off again: the old
  // transition's late `finished` would otherwise strip them from the new one, which then falls back to the browser's
  // default crossfade. The old one is skipped first, so it cannot finish late at all. A skipped transition rejects
  // `ready`; that is expected, so it is caught here instead of surfacing as an unhandled rejection.
  const gen = ++vtGen;
  try { lastVT?.skipTransition(); } catch { /* already finished */ }
  root.dataset.vt = kind;
  const t = document.startViewTransition(update);
  lastVT = t;
  t.ready.catch(() => {});
  t.finished.catch(() => {}).finally(() => {
    if (gen !== vtGen) return;
    delete root.dataset.vt;
    handing.clear();
    lastVT = null;
  });
  await t.updateCallbackDone;
}
/** Generation of the newest swap() view transition (see swap()). */
let vtGen = 0;

/* A shared element across a route change: the old view names one element (handoff) and the new view names the
   element it becomes (receive); the route's view transition then moves and resizes the one into the other (a map
   group's disc expanding into its page header). Only inside a view transition: reduced motion or a browser without
   View Transitions gets the route's usual change, and the names are taken off again when the transition ends. */
/** @type {ViewTransition | null} */ let lastVT = null;
/** @type {Set<string>} */ const handing = new Set();
/**
 * Name the element the next route's view transition starts from. Returns false when nothing will move.
 * @param {HTMLElement | null} el @param {string} name
 */
export function handoff(el, name) {
  if (!el || reduced() || !document.startViewTransition) return false;
  el.style.viewTransitionName = name;
  handing.add(name);
  return true;
}
/**
 * In the new view, name the element a handoff() of the same name lands in (call during mount). Does nothing when no
 * handoff is pending.
 * @param {HTMLElement | null} el @param {string} name
 */
export function receive(el, name) {
  if (!el || !handing.has(name)) return;
  handing.delete(name);
  el.style.viewTransitionName = name;
  const clear = () => { el.style.viewTransitionName = ''; };
  if (lastVT) lastVT.finished.finally(clear); else requestAnimationFrame(clear);
}

/**
 * Send a copy of an element flying into another on a short arc (Quick sort: a word into its Know or Learn stack). The
 * copy is fixed, moves by transform and opacity only, shrinks into the target, and the target then lands with the
 * pop spring. The element itself is free at once, so the caller can put the next word in it while the copy flies.
 * Reduced motion: no flight; the target only changes state. Resolves when the copy has landed.
 * @param {HTMLElement | null | undefined} el @param {HTMLElement | null | undefined} toEl @param {{ duration?: number }} [o]
 * @returns {Promise<void>}
 */
export function fling(el, toEl, { duration = 440 } = {}) {
  if (reduced() || !el || !toEl || !el.animate) return Promise.resolve();
  const a = el.getBoundingClientRect(), b = toEl.getBoundingClientRect();
  if (!a.width || !b.width) return Promise.resolve();
  const cs = getComputedStyle(el);
  const ghost = /** @type {HTMLElement} */ (el.cloneNode(true));
  ghost.removeAttribute('id');
  ghost.setAttribute('aria-hidden', 'true');
  for (const k of /** @type {const} */ (['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'color', 'textAlign', 'whiteSpace'])) ghost.style[k] = cs[k];
  Object.assign(ghost.style, { position: 'fixed', left: `${a.left}px`, top: `${a.top}px`, width: `${a.width}px`, height: `${a.height}px`, margin: '0',
    pointerEvents: 'none', zIndex: '80', transformOrigin: '50% 50%', willChange: 'transform, opacity' });
  document.body.append(ghost);
  const dx = b.left + b.width / 2 - (a.left + a.width / 2), dy = b.top + b.height / 2 - (a.top + a.height / 2);
  const s = Math.max(0.12, Math.min(0.4, b.height / Math.max(1, a.height)));
  const tilt = dx < 0 ? -6 : 6;
  const anim = ghost.animate([
    { transform: 'none', opacity: 1 },
    { transform: `translate(${dx * 0.42}px, ${dy * 0.38 - 26}px) scale(0.72) rotate(${tilt * 0.6}deg)`, opacity: 0.95, offset: 0.42 },
    { transform: `translate(${dx}px, ${dy}px) scale(${s}) rotate(${tilt}deg)`, opacity: 0.2 },
  ], { duration, easing: 'cubic-bezier(0.45, 0, 0.25, 1)', fill: 'forwards' });
  return anim.finished.catch(() => {}).then(() => {
    ghost.remove();
    const pop = easing('--spring-pop');
    toEl.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.1)', offset: 0.35 }, { transform: 'scale(1)' }], { duration: 360, easing: pop });
  });
}

/** @param {Element} el */
function crossfade(el) {
  el.animate([{ opacity: 0.4 }, { opacity: 1 }], { duration: 140, easing: 'ease-out' });
}

/**
 * FLIP: animate elements from their old box to their new box after mutate() runs.
 * Use for list reorders, a chip moving into a sentence, a tile snapping into a slot.
 * @param {Iterable<Element>} items @param {() => unknown} mutate @param {{ duration?: number, easing?: string }} [o]
 */
export async function flip(items, mutate, { duration, easing: curve = 'var(--spring-snappy)' } = {}) {
  const els = [...items];
  const first = new Map(els.map(el => [el, el.getBoundingClientRect()]));
  await mutate();
  if (reduced()) return;
  const dur = duration ?? cssMs('--dur-card', 380);
  const ease = easing(curve);
  for (const el of els) {
    const a = /** @type {DOMRect} */ (first.get(el)), b = el.getBoundingClientRect();
    const dx = a.left - b.left, dy = a.top - b.top, sx = a.width / (b.width || 1), sy = a.height / (b.height || 1);
    if (!dx && !dy && sx === 1 && sy === 1) continue;
    el.animate([
      { transformOrigin: '0 0', transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
      { transformOrigin: '0 0', transform: 'none' },
    ], { duration: dur, easing: ease });
  }
}

/**
 * Keyboard mode on or off (core/keyboard.js): apply() toggles body.kb, the chrome collapses or comes back, and what
 * stays on screen and marked .kb-flip (a prompt, the answer field) slides from its old place to its new one on the
 * snappy spring in 200 ms, translation only. Hints that come back fade in. Only this toggle animates, never the
 * per-frame viewport events. Reduced motion: the swap is instant.
 * @param {() => void} apply
 */
export async function kbShift(apply) {
  if (reduced() || typeof document === 'undefined') { apply(); return; }
  const els = [...document.querySelectorAll('.kb-flip')].filter(el => el.getClientRects().length > 0);
  const first = new Map(els.map(el => [el, el.getBoundingClientRect().top]));
  apply();
  const ease = easing('--spring-snappy');
  for (const el of els) {
    if (!el.getClientRects().length) continue;
    const dy = /** @type {number} */ (first.get(el)) - el.getBoundingClientRect().top;
    if (Math.abs(dy) < 1) continue;
    el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 200, easing: ease });
  }
  if (!document.body.classList.contains('kb')) {
    for (const el of document.querySelectorAll('.kb-fade')) {
      if (el.getClientRects().length) el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'ease-out' });
    }
  }
}

/**
 * Open or close a disclosure: the panel (.reveal-answer, one child) grows from 0fr to 1fr rows and fades in, the
 * same layout animation as the answer reveal; with reduced motion it switches at once. The trigger's aria-expanded
 * follows, and a closed panel is inert (out of the tab order and the accessibility tree).
 * @param {HTMLElement} trigger @param {HTMLElement} panel @param {boolean} open
 */
export function disclose(trigger, panel, open) {
  trigger.setAttribute('aria-expanded', String(open));
  panel.inert = !open;
  if (reduced()) {
    panel.style.transition = 'none';
    panel.classList.toggle('is-open', open);
    void panel.offsetHeight;
    panel.style.transition = '';
    return;
  }
  panel.classList.toggle('is-open', open);
}

/**
 * Reveal elements marked [data-reveal] as they enter the viewport. Siblings stagger by --i
 * (set automatically per container, capped at 8). Returns a disconnect function.
 * @param {ParentNode} [scope] @returns {() => void}
 */
export function reveal(scope = document) {
  const els = [...scope.querySelectorAll(/** @type {'div'} */ ('[data-reveal]:not(.is-in)'))];
  if (reduced() || !('IntersectionObserver' in window)) { els.forEach(el => el.classList.add('is-in')); return () => {}; }
  /** @type {Map<Element | null, number>} */ const groups = new Map();
  els.forEach(el => {
    const k = el.parentElement; const n = groups.get(k) || 0; groups.set(k, n + 1);
    el.style.setProperty('--i', String(Math.min(n, 8)));
  });
  const io = new IntersectionObserver(entries => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });
  els.forEach(el => io.observe(el));
  return () => io.disconnect();
}

/* ------------------------------------------------------------------ */
/* Answer feedback                                                      */
/* ------------------------------------------------------------------ */

/**
 * Mark an .answer as correct: underline sweeps in green, the check draws, a light haptic.
 * Resolves after `hold` ms (default 420), or sooner on skip(), so the caller can auto-advance.
 * The input stays usable.
 * @param {HTMLElement} answerEl @param {{ hold?: number, haptics?: boolean }} [o]
 */
export async function correct(answerEl, { hold = 420, haptics = true } = {}) {
  answerEl.classList.remove('is-wrong');
  answerEl.classList.add('is-correct');
  answerEl.setAttribute('data-state', 'correct');
  if (haptics) haptic();
  await new Promise(r => { skipHold = () => r(undefined); setTimeout(r, reduced() ? Math.min(hold, 300) : hold); });
  skipHold = () => {};
}

/** End the hold of a pending correct() early (e.g. the user pressed Enter again). */
let skipHold = () => {};
export function skip() { skipHold(); }

/**
 * Mark an .answer as wrong: underline sweeps in red, the input nudges once (not a shake).
 * Pass revealEl (.reveal-answer) to open the correct answer underneath.
 * @param {HTMLElement} answerEl @param {{ revealEl?: HTMLElement | null, haptics?: boolean }} [o]
 */
export function wrong(answerEl, { revealEl = null, haptics = true } = {}) {
  answerEl.classList.remove('is-correct', 'is-wrong');
  void answerEl.offsetWidth; // restart the nudge if wrong twice
  answerEl.classList.add('is-wrong');
  answerEl.setAttribute('data-state', 'wrong');
  if (revealEl) revealEl.classList.add('is-open');
  if (haptics) haptic();
}

/** Clear correct/wrong state (call before rendering the next card into the same answer field). @param {HTMLElement} answerEl @param {HTMLElement | null} [revealEl] */
export function resetAnswer(answerEl, revealEl) {
  answerEl.classList.remove('is-correct', 'is-wrong');
  answerEl.removeAttribute('data-state');
  revealEl?.classList.remove('is-open');
}

/** Light haptic tap (services/haptics.js: the web hack or the native shell's). Call it from a user gesture on iOS. */
export function haptic() { tap(); }

/* ------------------------------------------------------------------ */
/* Numbers                                                              */
/* ------------------------------------------------------------------ */

/**
 * Count a number up/down in place (rAF, ease-out quart: domain/meter.js countAt). For small numbers next to text.
 * format: (n) => string. Writes the final value immediately under reduced motion. Destroy-safe: `signal` aborting (the
 * view unmounting) stops the frames and resolves the promise, leaving the text where it was. A new countTo on the same
 * element takes over from the running one, whose promise then stays pending as before (textview waits on it for the
 * noun). The element keeps the target in data-value, so the next count starts from it.
 * @param {HTMLElement} el @param {number} to
 * @param {{ from?: number, duration?: number, decimals?: number, format?: (n: number) => string, signal?: AbortSignal }} [o]
 * @returns {Promise<void>}
 */
export function countTo(el, to, { from, duration = 700, decimals = 0, format, signal } = {}) {
  const fmt = format || ((/** @type {number} */ n) => n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }));
  const start = from ?? (parseFloat(String(el.dataset.value ?? el.textContent).replace(/[^\d.-]/g, '')) || 0);
  counting.get(el)?.stop(false);
  el.dataset.value = String(to);
  if (reduced() || start === to || signal?.aborted || !(duration > 0)) { el.textContent = fmt(to); return Promise.resolve(); }
  return new Promise(resolve => {
    const t0 = performance.now();
    let id = 0;
    const end = (settle = true) => {
      cancelAnimationFrame(id); signal?.removeEventListener('abort', onAbort);
      if (counting.get(el) === run) counting.delete(el);
      if (settle) resolve();
    };
    const onAbort = () => end();
    const run = { stop: end };
    const tick = (/** @type {number} */ now) => {
      const k = (now - t0) / duration;
      el.textContent = fmt(countAt(start, to, k, decimals + 2));
      if (k < 1) id = requestAnimationFrame(tick); else end();
    };
    counting.set(el, run);
    signal?.addEventListener('abort', onAbort, { once: true });
    id = requestAnimationFrame(tick);
  });
}
/** The running countTo() per element: stop(settle) cancels its frames and, with settle, resolves its promise. @type {WeakMap<HTMLElement, { stop: (settle?: boolean) => void }>} */
const counting = new WeakMap();

/**
 * Odometer: each digit rolls on its own column with the snappy spring.
 * For the one big numeral per screen (days left, readiness). Keeps an accessible label.
 * from: the number the columns start at before they roll to value (the day ticking over: from N + 1 to N, so only
 * the columns that change move). Digits line up from the right; a column from has no digit for starts at 0. Without
 * from, existing columns roll from where they are and new ones from 0. Reduced motion: value at once, no roll.
 * @param {HTMLElement} el @param {number | string} value @param {{ label?: string, from?: number | string }} [o]
 */
export function odometer(el, value, { label, from } = {}) {
  const str = String(value);
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', label ?? str);
  if (!el.classList.contains('odo')) el.classList.add('odo');
  const cols = [...el.children];
  // Rebuild when the digit count changes; otherwise roll existing columns.
  if (cols.length !== str.length) {
    el.textContent = '';
    [...str].forEach((ch, i) => {
      if (!/\d/.test(ch)) { const s = document.createElement('span'); s.className = 'odo-sep'; s.textContent = ch; s.setAttribute('aria-hidden', 'true'); el.append(s); return; }
      const col = document.createElement('span');
      col.className = 'odo-col'; col.setAttribute('aria-hidden', 'true');
      col.style.setProperty('--i', String(str.length - 1 - i));
      for (let d = 0; d <= 9; d++) { const s = document.createElement('span'); s.textContent = String(d); col.append(s); }
      // start from 0 so the first render rolls up
      col.style.transform = 'translateY(0)';
      el.append(col);
    });
  }
  const kids = () => /** @type {HTMLElement[]} */ ([...el.children]);
  const set = () => kids().forEach((col, i) => {
    if (col.classList.contains('odo-col')) col.style.transform = `translateY(${-Number(str[i])}em)`;
  });
  if (reduced()) { kids().forEach(c => c.style.transition = 'none'); set(); return; }
  if (from != null) {
    const cols = kids().filter(c => c.classList.contains('odo-col'));
    const start = String(from).replace(/\D/g, '').slice(-cols.length).padStart(cols.length, '0');
    cols.forEach((c, i) => { c.style.transition = 'none'; c.style.transform = `translateY(${-Number(start[i])}em)`; });
    void el.offsetWidth;   // the columns stand at `from` before the transition comes back
  }
  kids().forEach(c => c.style.transition = '');
  requestAnimationFrame(() => requestAnimationFrame(set));
}

/* ------------------------------------------------------------------ */
/* Progress                                                             */
/* ------------------------------------------------------------------ */

/** Set a .track .fill (or any .fill) to p in 0..1. The spring does the rest. @param {HTMLElement} el @param {number} p */
export function fill(el, p) {
  const f = /** @type {HTMLElement} */ (el.classList.contains('fill') ? el : el.querySelector('.fill'));
  f.style.setProperty('--p', String(Math.max(0, Math.min(1, p))));
  // aria-valuenow only where it is allowed: on a progressbar (axe aria-allowed-attr; the Today and Exam module bars are
  // plain tracks inside a labelled link)
  if (el.getAttribute?.('role') === 'progressbar') el.setAttribute('aria-valuenow', String(Math.round(p * 100)));
}

/**
 * Round progress: n segments; states is an array of 'done' | 'miss' | 'now' | ''.
 * Builds the segments on first call.
 * @param {HTMLElement} el @param {string[]} states
 */
export function segments(el, states) {
  if (el.children.length !== states.length) {
    el.textContent = '';
    el.style.setProperty('--n', String(states.length));
    states.forEach(() => el.append(document.createElement('i')));
  }
  [...el.children].forEach((seg, i) => {
    seg.className = states[i] ? `is-${states[i]}` : '';
  });
  const done = states.filter(s => s === 'done' || s === 'miss' || s === 'seen').length;
  el.setAttribute('role', 'progressbar');
  el.setAttribute('aria-valuemin', '0'); el.setAttribute('aria-valuemax', String(states.length)); el.setAttribute('aria-valuenow', String(done));
}

/**
 * Readiness ring (the kit API; src/ui/meter.js mountRing is the component, with the same drawing rules from
 * domain/meter.js). arcs: [{ value: 0..1, today: 0..1 (optional gain shown in accent) }]. One arc per module with gaps
 * between, all from one SVG. Returns an update(arcs) function. core cannot import src/ui, so this stays a small
 * drawing of its own over the shared geometry.
 * @typedef {{ value: number, today?: number }} RingArc
 * @param {Element} el @param {RingArc[]} arcs @param {{ stroke?: number, gapDeg?: number }} [o]
 * @returns {(next: RingArc[]) => void}
 */
export function ring(el, arcs, { stroke = 5.5, gapDeg = 5 } = {}) {
  const ns = 'http://www.w3.org/2000/svg';
  const g = ringGeometry({ stroke, arcs: arcs.length, gapDeg });
  let svg = el.querySelector('svg');
  if (!svg) {
    svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 100 100'); svg.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < arcs.length; i++) {
      for (const cls of ['ring-track', 'ring-arc today', 'ring-arc main']) {
        const c = document.createElementNS(ns, 'circle');
        for (const [k, v] of [['cx', '50'], ['cy', '50'], ['r', String(g.r)], ['fill', 'none'], ['stroke-width', String(stroke)], ['stroke-linecap', 'butt'], ['class', cls]]) c.setAttribute(k, v);
        c.style.strokeDashoffset = String(g.offset(i));
        c.style.strokeDasharray = dash(cls === 'ring-track' ? 1 : 0, g.seg, g.C);
        if (cls !== 'ring-track') c.style.opacity = '0';
        svg.append(c);
      }
    }
    el.prepend(svg);
  }
  const circles = [...svg.querySelectorAll('circle')];
  /** @param {RingArc[]} next */
  const update = next => next.forEach((a, i) => {
    const today = circles[i * 3 + 1], main = circles[i * 3 + 2];
    if (!today || !main) return;
    const total = clamp01(a.value), base = clamp01((a.value || 0) - (a.today || 0));
    main.style.strokeDasharray = dash(base, g.seg, g.C); main.style.opacity = base > 0 ? '1' : '0';
    today.style.strokeDasharray = dash(total, g.seg, g.C); today.style.opacity = total > base ? '1' : '0';
  });
  if (reduced()) update(arcs); else requestAnimationFrame(() => requestAnimationFrame(() => update(arcs)));
  return update;
}

/* ------------------------------------------------------------------ */
/* Segmented control thumb                                              */
/* ------------------------------------------------------------------ */

/**
 * Wire a .seg: moves the thumb under the pressed button. Calls onChange(value).
 * Only a press slides the thumb (transform, on the CSS transition). Its width and every placement that is not a press
 * (mount, fonts arriving, a resize) are set with the transition off, so the control never moves by itself.
 * @param {HTMLElement} el @param {(value: string) => void} [onChange] @returns {ResizeObserver}
 */
export function segmented(el, onChange) {
  let has = /** @type {HTMLElement | null} */ (el.querySelector('.seg-thumb'));
  if (!has) { has = document.createElement('span'); has.className = 'seg-thumb'; el.prepend(has); }
  const thumb = has;
  let pressedAt = -Infinity;
  /** @param {HTMLElement} btn @param {boolean} [slide] */
  const place = (btn, slide = false) => {
    const at = `translateX(${btn.offsetLeft}px)`, w = btn.offsetWidth + 'px';
    if (slide) { thumb.style.width = w; thumb.style.transform = at; return; }
    if (thumb.style.width === w && thumb.style.transform === at) return;
    thumb.style.transition = 'none'; thumb.style.width = w; thumb.style.transform = at;
    void thumb.offsetWidth; thumb.style.transition = '';
  };
  const btns = [...el.querySelectorAll('button')];
  const current = () => btns.find(b => b.getAttribute('aria-pressed') === 'true') || btns[0];
  btns.forEach(b => b.addEventListener('click', () => {
    btns.forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    pressedAt = performance.now();
    place(b, true); onChange?.(b.value || (b.textContent || '').trim());
  }));
  place(current());
  // the control is rebuilt on every settings change: stop observing once it has left the page. A resize during a
  // press's slide (within the base duration) lets the slide finish to the new place instead of jumping.
  const ro = new ResizeObserver(() => {
    if (!el.isConnected) { ro.disconnect(); return; }
    place(current(), performance.now() - pressedAt < cssMs('--dur-base', 240));
  });
  ro.observe(el);
  return ro;
}

/* ------------------------------------------------------------------ */
/* Toast                                                                */
/* ------------------------------------------------------------------ */

// The toast lives in src/ui/toast.js since round 8 (design C §9: a queue of one, swipe-away, a choice of live region);
// this re-export keeps every motion.toast(text, { action, onAction, ms }) call as it was.
export { toast } from '../ui/toast.js';

export { wait, raf };
