/* Round progress that only moves forward (DESIGN.md components.round-progress). The segments are the cards planned
   when the round started, with fixed widths; a card that comes back (Again, a learning step) never adds a segment or
   re-divides the bar: it adds a small "again" tick in a thin row under the segments, which lands with the kit's pop.
   The count reads "3 of 8" against the planned cards, and "Again · 8 of 8" while a returning card is up.
   Shared by the B1 rounds (round.js), Speaking situations (sim-view.js) and Word clusters (say it aloud). */
import { h, replace } from '../../core/dom.js';
import { segments } from '../../core/motion.js';

/**
 * @param {{queue: {id: string, re?: boolean}[], i: number, results: any[], planned?: number}} round
 * @param {boolean} answered the current card has its result
 * @param {(r: any) => boolean} ok a result counts as right (B1: r.ok; self-graded: r.g > 1)
 */
export function progressOf(round, answered, ok) {
  /** @type {string[]} */ const planned = [], again = [];
  /** @type {Map<string, number>} */ const seen = new Map();
  /** @type {Map<string, any[]>} */ const byId = new Map();
  for (const r of round.results) { const l = byId.get(r.id) || []; l.push(r); byId.set(r.id, l); }
  round.queue.forEach((q, k) => {
    const j = seen.get(q.id) || 0; seen.set(q.id, j + 1);
    let st = '';
    if (k === round.i && !answered) st = 'now';
    else if (k <= round.i) { const r = (byId.get(q.id) || [])[j]; st = r ? (ok(r) ? 'done' : 'miss') : ''; }
    (q.re ? again : planned).push(st);
  });
  const cur = round.queue[round.i];
  return { planned, again, k: planned.filter(Boolean).length, n: planned.length, onAgain: !!(cur && cur.re) };
}

/**
 * The header's progress: segments for the planned cards, again ticks under them.
 * @param {HTMLElement} segs .segments @param {HTMLElement} againEl .pr-again @param {ReturnType<typeof progressOf>} p
 */
export function drawProgress(segs, againEl, p) {
  segments(segs, p.planned);
  const had = againEl.children.length;
  if (had > p.again.length) replace(againEl);
  p.again.forEach((st, k) => {
    let tick = /** @type {HTMLElement | undefined} */ (againEl.children[k]);
    if (!tick) { tick = h('i', { class: 'land' }); againEl.append(tick); }
    tick.className = [k >= had ? 'land' : '', st ? `is-${st}` : ''].filter(Boolean).join(' ');
  });
  againEl.hidden = !p.again.length;
}

/** The thin row of again ticks (aria-hidden: the count says it). */
export const againRow = () => h('div', { class: 'pr-again', 'aria-hidden': 'true', hidden: true });
