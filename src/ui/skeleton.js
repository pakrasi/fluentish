// Skeleton (design C §8, F10): still blocks in the shape of what is loading, so nothing jumps when it lands.
//   createSkeleton({ shape: 'rows' | 'card' | 'tiles' | 'chart', count, wait, signal }) → { el, update, destroy }
// Nothing shows for the first `wait` ms (150 by default: most loads are done by then), then the blocks; from 400 ms
// one band sweeps them until destroy(). All of that is CSS (styles/ui.css ui/skeleton), so a fast load costs no timer.
// The skeleton is aria-hidden: the caller keeps its "Loading" status text and sets aria-busy on the region it fills.

/** @typedef {'rows' | 'card' | 'tiles' | 'chart'} SkelShape */
/** @typedef {{ shape?: SkelShape, count?: number, wait?: number, signal?: AbortSignal }} SkelOpts */
/** One block: its kind and, for a line, its width in %. @typedef {{ kind: 'line' | 'title' | 'card' | 'chart' | 'tile', w?: number }} SkelBlock */

const LIMIT = { rows: 8, card: 3, tiles: 24, chart: 2 };

/**
 * The blocks of a shape, in groups (a row, a card with its lines, the tile grid). Pure.
 * rows: a title line and a detail line per row, widths varied so it does not read as a grid of bars.
 * @param {SkelShape} shape @param {number} [count]
 * @returns {SkelBlock[][]}
 */
export function skelPlan(shape, count) {
  const max = LIMIT[shape] ?? LIMIT.rows;
  const n = Math.max(1, Math.min(max, Math.round(Number(count) || (shape === 'tiles' ? 12 : shape === 'rows' ? 4 : 1))));
  const W = [72, 58, 66, 50];
  const D = [40, 32, 46, 28];
  switch (shape) {
    case 'card': return Array.from({ length: n }, (_, i) => [{ kind: 'card' }, { kind: 'line', w: D[i % 4] + 20 }]);
    case 'tiles': return [Array.from({ length: n }, () => ({ kind: /** @type {const} */ ('tile') }))];
    case 'chart': return Array.from({ length: n }, () => [{ kind: 'line', w: 30 }, { kind: 'chart' }]);
    default: return Array.from({ length: n }, (_, i) => [{ kind: 'title', w: W[i % 4] }, { kind: 'line', w: D[i % 4] }]);
  }
}

/**
 * @param {SkelOpts} [opts]
 * @returns {import('./index.js').UiCreated<SkelOpts>}
 */
export function createSkeleton(opts = {}) {
  const el = document.createElement('div');
  el.className = 'ui-skel';
  el.setAttribute('aria-hidden', 'true');
  let cur = { shape: opts.shape || 'rows', count: opts.count, wait: opts.wait };
  function draw() {
    el.style.setProperty('--ui-skel-wait', `${Math.max(0, Number(cur.wait ?? 150))}ms`);
    const groups = skelPlan(cur.shape, cur.count);
    el.replaceChildren(...groups.map(g => {
      const box = document.createElement('div');
      box.className = cur.shape === 'tiles' ? 'ui-skel-tiles' : 'ui-skel-row';
      for (const b of g) {
        const d = document.createElement('div');
        d.className = `ui-skel-block ui-skel-${b.kind === 'title' ? 'line is-title' : b.kind}`;
        if (b.w) d.style.width = `${b.w}%`;
        box.append(d);
      }
      return box;
    }));
  }
  draw();
  let gone = false;
  const destroy = () => { if (gone) return; gone = true; el.remove(); };
  opts.signal?.addEventListener('abort', destroy, { once: true });
  return {
    el,
    update(next) {
      const n = { ...cur, ...next };
      if (n.shape === cur.shape && n.count === cur.count && n.wait === cur.wait) return;
      cur = { shape: n.shape || 'rows', count: n.count, wait: n.wait };
      draw();
    },
    destroy,
  };
}
