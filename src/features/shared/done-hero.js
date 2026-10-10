/* The one done screen (DESIGN.md components.done-hero): a label, one Newsreader figure with its "of N …" line, the
   atmosphere breathing once behind it, and one data object below that is the feature's own (the field strip for a
   round, the letter for Build an email, the section row of the ready meter for a script, the snapped pairs for a
   cluster, the chat bubbles for situations). One big number per screen: anything else is a caption or title size.

   Used by rounds, Schreiben (Build an email), Speaking situations, Word clusters and Scripts.

   A done screen is an ordinary page: start() calls leaveRound(), so the app's bars come back and the page scrolls
   again (a round hides them and locks the page to the round box). A done screen that only fills a step inside a
   full-screen flow with its own way out (a script rehearsal step) passes inFlow. The actions row (.pr-done-actions)
   follows the hero, before any long list, and stays on screen above the tab bar while the page scrolls
   (tests/unit/done-screens.test.mjs checks every done screen keeps to this).

   The arrival is one timeline (core/motion.js sequence(); design A3), in ms from the moment the page is on screen:
     0    the page is there: a round's own arrival (arrive()) lifts the card away while the hero rises and the bars
          slide back; the actions row is on screen from the start and never waits on motion
     120  the figure rolls on its odometer (from 0, ones place first) and the atmosphere breathes with it (or as soon as
          its shader lands, when that is later)
     ...  the caller's own steps (a round's field ripples and its "+N")
   A tap anywhere on the done page skips to the end state (finish()); reduced motion shows the end state at once. */
import { h } from '../../core/dom.js';
import { odometer, sequence, swap } from '../../core/motion.js';
import { atmosphere } from '../../core/brand.js';

/**
 * The round is over: the header and the tab bar come back and the page scrolls again, from the top.
 */
export function leaveRound() {
  document.body.dataset.chrome = 'on';
  document.body.classList.remove('pr-in-round', 'sc-full');
  scrollTo(0, 0);
}

/** When the figure rolls and the atmosphere breathes, in ms after the done page is on screen. */
export const ROLL_AT = 120;
/** @type {ReturnType<typeof setTimeout> | undefined} */ let arriving;
/**
 * A round's done page arrives (design A3): update() draws it inside the route's view transition, so the round card
 * lifts away (practice.css, html[data-arrive="done"]), the done page rises in its place and the app's bars slide back
 * on their own layers (fx-bar, fx-tabs) instead of popping in one frame. Reduced motion or no View Transitions: the
 * route's usual change. Resolves when the new page is in the DOM; its timeline (start()) begins then.
 * @param {() => void} update @param {HTMLElement | null} [fallbackEl]
 */
export async function arrive(update, fallbackEl = null) {
  const root = document.documentElement;
  clearTimeout(arriving);
  root.dataset.arrive = 'done';
  try {
    await swap(() => { update(); leaveRound(); }, { kind: 'view', fallbackEl });
  } finally {
    // the transition's longest layer (the page's rise) is over by then; the next route change has its own names
    arriving = setTimeout(() => { if (root.dataset.arrive === 'done') delete root.dataset.arrive; }, 900);
  }
}

/**
 * A done screen's link to another round. The round's address is often the one already showing (a round started from
 * its cluster page or the hub), where a plain link changes nothing: then it mounts the round again.
 * @param {{go: (path: string) => any}} ctx @param {string} href @param {any} text @param {Record<string, any>} [attrs]
 */
export function againLink(ctx, href, text, attrs = {}) {
  return h('a', { class: 'btn btn-primary pressable', ...attrs, href, onclick: (/** @type {MouseEvent} */ e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || location.hash !== href) return;
    e.preventDefault();
    ctx.go(href.slice(1));
  } }, text);
}

/**
 * @param {{label: string, figure: number, of: string, lines?: any[], data?: Node | null, atmo?: boolean, cls?: string, level?: 'h1' | 'h2', inFlow?: boolean}} o
 *   level: h2 when the hero sits inside a view that has its own h1 (a script step's done); inFlow: the hero is a step
 *   inside a full-screen flow, which keeps its own chrome (no leaveRound())
 * @returns {{el: HTMLElement, start: (o?: { steps?: import('../../core/motion.js').SeqStep[], signal?: AbortSignal }) => () => void, finish: () => void}}
 */
export function doneHero({ label, figure, of, lines = [], data = null, atmo = true, cls, level = 'h1', inFlow = false }) {
  // the figure is an odometer (DESIGN motion rule 10); until it rolls its columns stand at 0 ("00" for a two-digit
  // figure), and a screen reader always hears the real number
  const text = figure.toLocaleString();
  const fig = h('span', { class: 'figure tnum' });
  odometer(fig, text.replace(/\d/g, '0'), { label: text });
  const atmoEl = atmo ? h('div', { class: 'atmo', 'aria-hidden': 'true' }) : null;
  const h1 = h(level, { tabindex: '-1', class: level === 'h2' ? 'pr-done-h' : null }, fig, ' ', h('span', { class: 'pr-done-of' }, of));
  // the atmosphere sits behind the figure only; the data object follows below it, on the page (never text on the
  // gradient)
  const el = h('div', { class: ['pr-done-top', cls] },
    h('section', { class: 'hero pr-done-hero' }, atmoEl,
      h('p', { class: 'label' }, label), h1,
      lines.filter(Boolean).map(x => (typeof x === 'string' ? h('p', { class: 'caption tnum' }, x) : x))),
    data ? h('div', { class: 'pr-done-data' }, data) : null);
  /** @type {import('../../core/motion.js').Sequence | null} */ let seq = null;
  let skipped = false;
  /** The figure at its number now, with no roll (a skip, or a roll already under way). */
  const settle = () => odometer(fig, text, { label: text, from: text });
  return {
    el,
    /**
     * The arrival's timeline: the figure rolls and the atmosphere breathes at ROLL_AT, then the caller's steps (ms
     * from now; their run(instant) sets the end state when instant). Focuses the heading. Returns the cleanup, which
     * also runs once when signal aborts (pass the view's ctx.signal: a done page left for the same address, "Another
     * round", gets no hashchange, and its atmosphere's WebGL context would stay alive).
     * @param {{ steps?: import('../../core/motion.js').SeqStep[], signal?: AbortSignal }} [o]
     */
    start({ steps = [], signal } = {}) {
      if (!inFlow) leaveRound();
      /** @type {any} */ let a = null, gone = false, rolled = false, breathed = false;
      const breathe = () => { if (a && rolled && !skipped && !breathed) { breathed = true; a.breathe(); } };
      if (atmoEl) atmosphere(atmoEl).then(x => { if (gone) { x.destroy(); return; } a = x; breathe(); }).catch(() => {});
      seq = sequence([
        { at: ROLL_AT, run: instant => {
          rolled = true;
          if (instant) { skipped = true; settle(); return; }
          odometer(fig, text, { label: text });
          breathe();
        } },
        ...steps,
      ]);
      // a tap anywhere on the done page skips to the end state (links and buttons still do their own thing)
      const page = /** @type {HTMLElement} */ (el.parentElement || el);
      const skip = () => finish();
      page.addEventListener('pointerdown', skip);
      h1.focus({ preventScroll: true });
      const stop = () => {
        if (gone) return;
        gone = true; seq?.cancel(); page.removeEventListener('pointerdown', skip); a?.destroy();
        signal?.removeEventListener('abort', stop);
      };
      if (signal?.aborted) stop(); else signal?.addEventListener('abort', stop, { once: true });
      return stop;
    },
    /** Every step of the arrival at its end state now (a tap; a test). */
    finish,
  };
  function finish() {
    if (!seq) return;
    skipped = true;   // a breath that has not started stays still
    seq.finish();
    settle();
  }
}
