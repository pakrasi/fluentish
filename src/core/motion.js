// Fluentish motion helpers. ES module, no dependencies. About 5 kB gzipped.
// Every export works under reduced motion: movement is dropped, state still changes. Haptics: services/haptics.js.
import { tap } from '../services/haptics.js';

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

const cssMs = (name, fallback) => {
  const v = getComputedStyle(root).getPropertyValue(name).trim();
  return v ? parseFloat(v) : fallback;
};
const wait = ms => new Promise(r => setTimeout(r, ms));
const raf = () => new Promise(r => requestAnimationFrame(r));

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
 */
export async function swap(update, { kind = 'forward', fallbackEl = null } = {}) {
  if (reduced() || !document.startViewTransition) {
    if (reduced() || !fallbackEl) { await update(); if (fallbackEl && reduced()) crossfade(fallbackEl); return; }
    const outCls = kind === 'back' ? 'fx-out-right' : kind === 'view' ? null : kind === 'lift' ? 'fx-out-up' : 'fx-out-left';
    if (outCls) { fallbackEl.classList.add(outCls); await wait(kind === 'lift' ? 260 : cssMs('--dur-quick', 160)); fallbackEl.classList.remove(outCls); }
    await update();
    const inCls = kind === 'back' ? 'fx-in-left' : kind === 'view' ? 'fx-rise' : kind === 'lift' ? 'fx-in-up' : 'fx-in-right';
    fallbackEl.classList.add(inCls);
    fallbackEl.addEventListener('animationend', () => fallbackEl.classList.remove(inCls), { once: true });
    return;
  }
  root.dataset.vt = kind;
  const t = document.startViewTransition(update);
  lastVT = t;
  t.finished.finally(() => { if (root.dataset.vt === kind) delete root.dataset.vt; handing.clear(); });
  await t.updateCallbackDone;
}

/* A shared element across a route change: the old view names one element (handoff) and the new view names the
   element it becomes (receive); the route's view transition then moves and resizes the one into the other (a map
   group's disc expanding into its page header). Only inside a view transition: reduced motion or a browser without
   View Transitions gets the route's usual change, and the names are taken off again when the transition ends. */
/** @type {ViewTransition | null} */ let lastVT = null;
const handing = new Set();
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
 */
export function fling(el, toEl, { duration = 440 } = {}) {
  if (reduced() || !el || !toEl || !el.animate) return Promise.resolve();
  const a = el.getBoundingClientRect(), b = toEl.getBoundingClientRect();
  if (!a.width || !b.width) return Promise.resolve();
  const cs = getComputedStyle(el);
  const ghost = el.cloneNode(true);
  ghost.removeAttribute('id');
  ghost.setAttribute('aria-hidden', 'true');
  for (const k of ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'color', 'textAlign', 'whiteSpace']) ghost.style[k] = cs[k];
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
    const pop = getComputedStyle(root).getPropertyValue('--spring-pop').trim() || 'ease-out';
    toEl.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.1)', offset: 0.35 }, { transform: 'scale(1)' }], { duration: 360, easing: pop });
  });
}

function crossfade(el) {
  el.animate([{ opacity: 0.4 }, { opacity: 1 }], { duration: 140, easing: 'ease-out' });
}

/**
 * FLIP: animate elements from their old box to their new box after mutate() runs.
 * Use for list reorders, a chip moving into a sentence, a tile snapping into a slot.
 */
export async function flip(els, mutate, { duration, easing = 'var(--spring-snappy)' } = {}) {
  els = [...els];
  const first = new Map(els.map(el => [el, el.getBoundingClientRect()]));
  await mutate();
  if (reduced()) return;
  const dur = duration ?? cssMs('--dur-card', 380);
  const ease = easing.startsWith('var(') ? getComputedStyle(root).getPropertyValue(easing.slice(4, -1)).trim() || 'ease-out' : easing;
  for (const el of els) {
    const a = first.get(el), b = el.getBoundingClientRect();
    const dx = a.left - b.left, dy = a.top - b.top, sx = a.width / (b.width || 1), sy = a.height / (b.height || 1);
    if (!dx && !dy && sx === 1 && sy === 1) continue;
    el.animate([
      { transformOrigin: '0 0', transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
      { transformOrigin: '0 0', transform: 'none' },
    ], { duration: dur, easing: ease });
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
 */
export function reveal(scope = document) {
  const els = [...scope.querySelectorAll('[data-reveal]:not(.is-in)')];
  if (reduced() || !('IntersectionObserver' in window)) { els.forEach(el => el.classList.add('is-in')); return () => {}; }
  const groups = new Map();
  els.forEach(el => {
    const k = el.parentElement; const n = groups.get(k) || 0; groups.set(k, n + 1);
    el.style.setProperty('--i', Math.min(n, 8));
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
 */
export async function correct(answerEl, { hold = 420, haptics = true } = {}) {
  answerEl.classList.remove('is-wrong');
  answerEl.classList.add('is-correct');
  answerEl.setAttribute('data-state', 'correct');
  if (haptics) haptic();
  await new Promise(r => { skipHold = r; setTimeout(r, reduced() ? Math.min(hold, 300) : hold); });
  skipHold = () => {};
}

/** End the hold of a pending correct() early (e.g. the user pressed Enter again). */
let skipHold = () => {};
export function skip() { skipHold(); }

/**
 * Mark an .answer as wrong: underline sweeps in red, the input nudges once (not a shake).
 * Pass revealEl (.reveal-answer) to open the correct answer underneath.
 */
export function wrong(answerEl, { revealEl = null, haptics = true } = {}) {
  answerEl.classList.remove('is-correct', 'is-wrong');
  void answerEl.offsetWidth; // restart the nudge if wrong twice
  answerEl.classList.add('is-wrong');
  answerEl.setAttribute('data-state', 'wrong');
  if (revealEl) revealEl.classList.add('is-open');
  if (haptics) haptic();
}

/** Clear correct/wrong state (call before rendering the next card into the same answer field). */
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
 * Count a number up/down in place (rAF, ease-out). For small numbers next to text.
 * format: (n) => string. Writes the final value immediately under reduced motion.
 */
export function countTo(el, to, { from, duration = 700, decimals = 0, format } = {}) {
  const fmt = format || (n => n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }));
  const start = from ?? (parseFloat(String(el.dataset.value ?? el.textContent).replace(/[^\d.-]/g, '')) || 0);
  el.dataset.value = to;
  if (reduced() || start === to) { el.textContent = fmt(to); return Promise.resolve(); }
  cancelAnimationFrame(el._count);
  return new Promise(resolve => {
    const t0 = performance.now();
    const tick = now => {
      const k = Math.min(1, (now - t0) / duration), e = 1 - Math.pow(1 - k, 4);
      el.textContent = fmt(start + (to - start) * e);
      if (k < 1) el._count = requestAnimationFrame(tick); else resolve();
    };
    el._count = requestAnimationFrame(tick);
  });
}

/**
 * Odometer: each digit rolls on its own column with the snappy spring.
 * For the one big numeral per screen (days left, readiness). Keeps an accessible label.
 */
export function odometer(el, value, { label } = {}) {
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
      col.style.setProperty('--i', str.length - 1 - i);
      for (let d = 0; d <= 9; d++) { const s = document.createElement('span'); s.textContent = d; col.append(s); }
      // start from 0 so the first render rolls up
      col.style.transform = 'translateY(0)';
      el.append(col);
    });
  }
  const set = () => [...el.children].forEach((col, i) => {
    if (col.classList.contains('odo-col')) col.style.transform = `translateY(${-Number(str[i])}em)`;
  });
  if (reduced()) { [...el.children].forEach(c => c.style.transition = 'none'); set(); return; }
  [...el.children].forEach(c => c.style.transition = '');
  requestAnimationFrame(() => requestAnimationFrame(set));
}

/* ------------------------------------------------------------------ */
/* Progress                                                             */
/* ------------------------------------------------------------------ */

/** Set a .track .fill (or any .fill) to p in 0..1. The spring does the rest. */
export function fill(el, p) {
  const f = el.classList.contains('fill') ? el : el.querySelector('.fill');
  f.style.setProperty('--p', Math.max(0, Math.min(1, p)));
  // aria-valuenow only where it is allowed: on a progressbar (axe aria-allowed-attr; the Today and Exam module bars are
  // plain tracks inside a labelled link)
  if (el.getAttribute?.('role') === 'progressbar') el.setAttribute('aria-valuenow', Math.round(p * 100));
}

/**
 * Round progress: n segments; states is an array of 'done' | 'miss' | 'now' | ''.
 * Builds the segments on first call.
 */
export function segments(el, states) {
  if (el.children.length !== states.length) {
    el.textContent = '';
    el.style.setProperty('--n', states.length);
    states.forEach(() => el.append(document.createElement('i')));
  }
  [...el.children].forEach((seg, i) => {
    seg.className = states[i] ? `is-${states[i]}` : '';
  });
  const done = states.filter(s => s === 'done' || s === 'miss' || s === 'seen').length;
  el.setAttribute('role', 'progressbar');
  el.setAttribute('aria-valuemin', 0); el.setAttribute('aria-valuemax', states.length); el.setAttribute('aria-valuenow', done);
}

/**
 * Readiness ring. arcs: [{ value: 0..1, today: 0..1 (optional gain shown in accent) }].
 * Draws one arc per module with gaps between, all from one SVG. Returns an update(arcs) function.
 */
export function ring(el, arcs, { stroke = 5.5, gapDeg = 5 } = {}) {
  const ns = 'http://www.w3.org/2000/svg';
  const r = 50 - stroke / 2, C = 2 * Math.PI * r;
  const n = arcs.length, gap = n > 1 ? (gapDeg / 360) * C : 0, seg = C / n - gap;
  const inner = seg;                                   // butt caps: arcs end exactly at the gaps
  const start = i => -(i * (seg + gap));
  let svg = el.querySelector('svg');
  if (!svg) {
    svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 100 100'); svg.setAttribute('aria-hidden', 'true');
    arcs.forEach((_, i) => {
      for (const cls of ['ring-track', 'ring-arc today', 'ring-arc main']) {
        const c = document.createElementNS(ns, 'circle');
        c.setAttribute('cx', 50); c.setAttribute('cy', 50); c.setAttribute('r', r);
        c.setAttribute('fill', 'none'); c.setAttribute('stroke-width', stroke); c.setAttribute('stroke-linecap', 'butt');
        c.setAttribute('class', cls);
        c.style.strokeDashoffset = start(i);
        c.style.strokeDasharray = cls === 'ring-track' ? `${inner} ${C}` : `0 ${C}`;
        if (cls !== 'ring-track') c.style.opacity = 0;
        svg.append(c);
      }
    });
    el.prepend(svg);
  }
  const clamp = v => Math.max(0, Math.min(1, v || 0));
  const update = next => {
    const circles = [...svg.querySelectorAll('circle')];
    next.forEach((a, i) => {
      const today = circles[i * 3 + 1], main = circles[i * 3 + 2];
      const total = clamp(a.value), base = clamp(a.value - (a.today || 0));
      main.style.strokeDasharray = `${base * inner} ${C}`; main.style.opacity = base > 0 ? 1 : 0;
      today.style.strokeDasharray = `${total * inner} ${C}`; today.style.opacity = total > base ? 1 : 0;
    });
  };
  if (reduced()) update(arcs); else requestAnimationFrame(() => requestAnimationFrame(() => update(arcs)));
  return update;
}

/* ------------------------------------------------------------------ */
/* Segmented control thumb                                              */
/* ------------------------------------------------------------------ */

/** Wire a .seg: moves the thumb under the pressed button. Calls onChange(value). */
export function segmented(el, onChange) {
  let thumb = el.querySelector('.seg-thumb');
  if (!thumb) { thumb = document.createElement('span'); thumb.className = 'seg-thumb'; el.prepend(thumb); }
  const place = btn => { thumb.style.width = btn.offsetWidth + 'px'; thumb.style.transform = `translateX(${btn.offsetLeft}px)`; };
  const btns = [...el.querySelectorAll('button')];
  btns.forEach(b => b.addEventListener('click', () => {
    btns.forEach(x => x.setAttribute('aria-pressed', x === b));
    place(b); onChange?.(b.value || b.textContent.trim());
  }));
  const cur = btns.find(b => b.getAttribute('aria-pressed') === 'true') || btns[0];
  thumb.style.transition = 'none'; place(cur); void thumb.offsetWidth; thumb.style.transition = '';
  // the control is rebuilt on every settings change: stop observing once it has left the page
  const ro = new ResizeObserver(() => { if (!el.isConnected) { ro.disconnect(); return; } place(btns.find(b => b.getAttribute('aria-pressed') === 'true') || btns[0]); });
  ro.observe(el);
  return ro;
}

/* ------------------------------------------------------------------ */
/* Toast                                                                */
/* ------------------------------------------------------------------ */

/** Show a toast with optional action. Returns a close function. Auto-closes after `ms`. */
export function toast(text, { action, onAction, ms = 4000 } = {}) {
  const t = document.createElement('div');
  t.className = 'toast'; t.setAttribute('role', 'status');
  t.append(Object.assign(document.createElement('span'), { textContent: text }));
  // a status node inserted with its text is often skipped by VoiceOver: say it through the shell's live region too
  const live = document.getElementById('live');
  if (live) { live.textContent = ''; requestAnimationFrame(() => { live.textContent = text; }); }
  if (action) {
    const b = Object.assign(document.createElement('button'), { className: 'btn pressable', textContent: action });
    b.addEventListener('click', () => { onAction?.(); close(); });
    t.append(b);
  }
  document.body.append(t);
  requestAnimationFrame(() => requestAnimationFrame(() => t.classList.add('is-in')));
  let timer = setTimeout(close, ms);
  function close() {
    clearTimeout(timer); t.classList.remove('is-in');
    setTimeout(() => t.remove(), reduced() ? 0 : 300);
  }
  return close;
}

export { wait, raf };
