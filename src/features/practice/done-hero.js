/* The one done screen (DESIGN.md components.done-hero): a label, one Newsreader figure with its "of N …" line, the
   atmosphere breathing once behind it, and one data object below that is the feature's own (the field strip for a
   round, the letter for Build an email, the section row of the ready meter for a script, the snapped pairs for a
   cluster, the chat bubbles for situations). One big number per screen: anything else is a caption or title size.

   Used by rounds, Schreiben (Build an email), Speaking situations, Word clusters and Scripts.

   A done screen is an ordinary page: start() calls leaveRound(), so the app's bars come back and the page scrolls
   again (a round hides them and locks the page to the round box). A done screen that only fills a step inside a
   full-screen flow with its own way out (a script rehearsal step) passes inFlow. The actions row (.pr-done-actions)
   follows the hero, before any long list, and stays on screen above the tab bar while the page scrolls
   (tests/unit/done-screens.test.mjs checks every done screen keeps to this). */
import { h } from '../../core/dom.js';
import { countTo } from '../../core/motion.js';
import { atmosphere } from '../../core/brand.js';

/**
 * The round is over: the header and the tab bar come back and the page scrolls again, from the top.
 */
export function leaveRound() {
  document.body.dataset.chrome = 'on';
  document.body.classList.remove('pr-in-round', 'sc-full');
  scrollTo(0, 0);
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
 * @returns {{el: HTMLElement, start: () => () => void}}
 */
export function doneHero({ label, figure, of, lines = [], data = null, atmo = true, cls, level = 'h1', inFlow = false }) {
  const fig = h('span', { class: 'figure tnum' }, String(figure));
  const atmoEl = atmo ? h('div', { class: 'atmo', 'aria-hidden': 'true' }) : null;
  const h1 = h(level, { tabindex: '-1', class: level === 'h2' ? 'pr-done-h' : null }, fig, ' ', h('span', { class: 'pr-done-of' }, of));
  // the atmosphere sits behind the figure only; the data object follows below it, on the page (never text on the
  // gradient)
  const el = h('div', { class: ['pr-done-top', cls] },
    h('section', { class: 'hero pr-done-hero' }, atmoEl,
      h('p', { class: 'label' }, label), h1,
      lines.filter(Boolean).map(x => (typeof x === 'string' ? h('p', { class: 'caption tnum' }, x) : x))),
    data ? h('div', { class: 'pr-done-data' }, data) : null);
  return {
    el,
    /** Count the figure up, breathe once, focus the heading. Returns the cleanup. */
    start() {
      if (!inFlow) leaveRound();
      /** @type {any} */ let a = null, gone = false;
      countTo(fig, figure, { from: 0, duration: 640 });
      if (atmoEl) atmosphere(atmoEl).then(x => { if (gone) { x.destroy(); return; } a = x; x.breathe(); }).catch(() => {});
      h1.focus({ preventScroll: true });
      return () => { gone = true; a?.destroy(); };
    },
  };
}
