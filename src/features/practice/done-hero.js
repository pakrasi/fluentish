/* The one done screen (DESIGN.md components.done-hero): a label, one Newsreader figure with its "of N …" line, the
   atmosphere breathing once behind it, and one data object below that is the feature's own (the field strip for a
   round, the letter for Build an email, the section row of the ready meter for a script, the snapped pairs for a
   cluster, the chat bubbles for situations). One big number per screen: anything else is a caption or title size.

   Used by rounds, Schreiben (Build an email), Speaking situations, Word clusters and Scripts. */
import { h } from '../../core/dom.js';
import { countTo } from '../../core/motion.js';
import { atmosphere } from '../../core/brand.js';

/**
 * @param {{label: string, figure: number, of: string, lines?: any[], data?: Node | null, atmo?: boolean, cls?: string, level?: 'h1' | 'h2'}} o
 *   level: h2 when the hero sits inside a view that has its own h1 (a script step's done)
 * @returns {{el: HTMLElement, start: () => () => void}}
 */
export function doneHero({ label, figure, of, lines = [], data = null, atmo = true, cls, level = 'h1' }) {
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
      /** @type {any} */ let a = null, gone = false;
      countTo(fig, figure, { from: 0, duration: 640 });
      if (atmoEl) atmosphere(atmoEl).then(x => { if (gone) { x.destroy(); return; } a = x; x.breathe(); }).catch(() => {});
      h1.focus({ preventScroll: true });
      return () => { gone = true; a?.destroy(); };
    },
  };
}
