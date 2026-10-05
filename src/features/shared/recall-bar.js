/* A recall bar (DESIGN.md components): seen (quiet) under expected recall (ink), filled with the kit's motion. Practice's
   hub rows, the Schreiben page, speaking situations and a round's done screen draw it. */
import { h } from '../../core/dom.js';
import { fill } from '../../core/motion.js';

/** A recall bar: seen (quiet) under recall (ink). @param {number} recall @param {number} coverage @param {string} name */
export function recallBar(recall, coverage, name) {
  const r = Math.max(0, Math.min(1, recall || 0)), c = Math.max(r, Math.min(1, coverage || 0));
  const el = h('span', { class: 'track pr-bar', role: 'img', 'aria-label': name },
    h('span', { class: 'pr-seen', style: { '--p': String(c) } }), h('span', { class: 'fill' }));
  requestAnimationFrame(() => fill(el, r));
  return el;
}
