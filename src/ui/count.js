// Count-up number (round 8, design C §3): numbers that change because of what he did tick; numbers that did not change
// stand still. mountCount(el, opts) fills the caller's element with a ticking span and a visually hidden final value.
//
// Motion: core/motion.js countTo (ease-out quart, domain/meter.js countAt), default 700 ms, from `from` on the first
// draw (no `from`: the value stands at once) and from the value shown on every update. While it ticks the root has
// is-ticking (tabular figures, so the width does not jitter); at the end it goes back to the context's figures. With
// emphasis, a rise in value lands with one pop on the number (1 → 1.06 → 1, 360 ms spring-pop). destroy() stops the
// frames and the pop. Reduced motion: the final value at once, no pop.
//
// Accessibility: the ticking span is aria-hidden; a visually hidden sibling holds the final text (prefix + formatted
// value) from the start, so a screen reader never reads a number mid-count.
import { countTo, play } from '../core/motion.js';

/**
 * @typedef {{ value: number, from?: number, format?: (n: number) => string, prefix?: string, decimals?: number,
 *   duration?: number, emphasis?: boolean, signal?: AbortSignal }} CountOpts
 */

/**
 * @param {HTMLElement} el @param {CountOpts} opts
 * @returns {import('./index.js').UiHandle<CountOpts> & { done: () => Promise<void> }}
 */
export function mountCount(el, opts) {
  /** @type {CountOpts} */ let o = { duration: 700, emphasis: false, prefix: '', decimals: 0, ...opts };
  const nf = () => new Intl.NumberFormat(undefined, { minimumFractionDigits: o.decimals, maximumFractionDigits: o.decimals });
  let fmtNum = nf();
  /** The number on screen now (mid-count too), so an update during a count carries on from it. */
  let cur = o.from ?? o.value;
  const label = (/** @type {number} */ n) => `${o.prefix ?? ''}${o.format ? o.format(n) : fmtNum.format(n)}`;
  const text = (/** @type {number} */ n) => { cur = n; return label(n); };
  el.classList.add('ui-count');
  const num = document.createElement('span'), sr = document.createElement('span');
  num.className = 'ui-count-num'; num.setAttribute('aria-hidden', 'true');
  sr.className = 'sr-only';
  el.replaceChildren(num, sr);

  let alive = true;
  const ctl = new AbortController();
  /** @type {Promise<void>} */ let last = Promise.resolve();

  /** @param {number} from @param {number} to */
  const run = (from, to) => {
    sr.textContent = label(to);
    if (from === to) { el.classList.remove('is-ticking'); return countTo(num, to, { duration: 0, format: text }); }
    el.classList.add('is-ticking');
    const rise = to > from;
    const p = countTo(num, to, { from, duration: o.duration, decimals: o.decimals, format: text, signal: ctl.signal }).then(() => {
      if (!alive) return;
      el.classList.remove('is-ticking');
      if (num.dataset.value === String(to) && rise && o.emphasis) return play(num, [{ transform: 'scale(1)' }, { transform: 'scale(1.06)' }, { transform: 'scale(1)' }], { duration: 360, easing: '--spring-pop', fill: 'none' });
    });
    return p;
  };
  last = run(cur, o.value);

  const destroy = () => {
    if (!alive) return;
    alive = false;
    ctl.abort();
    num.getAnimations?.().forEach(a => a.cancel());
    el.classList.remove('is-ticking');
    o.signal?.removeEventListener('abort', destroy);
  };
  o.signal?.addEventListener('abort', destroy, { once: true });
  return {
    update(next) {
      if (!alive) return;
      const from = next.from ?? cur;
      o = { ...o, ...next };
      if ('decimals' in next) fmtNum = nf();
      last = run(from, o.value);
    },
    destroy,
    /** Resolves when the running count (and its pop) is over. */
    done: () => last,
  };
}
