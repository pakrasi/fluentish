/* Prefix pictograms: one small side-view scene per prefix (you face right, up is up). The path is always drawn (a
   dashed ink-3 line with an arrow head), so the diagram teaches with motion off; with motion on, the root's object
   travels the path once (a 20-line rAF loop that runs only while moving), then the scene's extra plays (the door
   shuts for zu-, the flag fills for er-, brackets close on the target for be-, the object fades off course for ver-,
   shards for zer-). Reduced motion: the scene is drawn in its end state. viewBox 0 0 200 110, ground at y 92.
   The object is the root's: stellen stands, legen lies, setzen sits (a real German distinction). */
import { reduced } from './fx.js';

const NS = 'http://www.w3.org/2000/svg';
const G = 92;
/** @param {string} n @param {Record<string, string | number>} [a] @param {Element} [parent] */
const el = (n, a = {}, parent) => { const e = document.createElementNS(NS, n); for (const k in a) e.setAttribute(k, String(a[k])); if (parent) parent.appendChild(e); return /** @type {SVGElement} */ (e); };

/** The thing a root moves. @param {string} kind @param {Element} parent */
function object(kind, parent) {
  const g = el('g', { class: 'pg-obj' }, parent);
  if (kind === 'upright') el('rect', { x: -6, y: -26, width: 12, height: 26, rx: 2 }, g);
  else if (kind === 'flat') el('rect', { x: -15, y: -9, width: 30, height: 9, rx: 2 }, g);
  else if (kind === 'seated') el('rect', { x: -8, y: -16, width: 16, height: 16, rx: 2 }, g);
  else if (kind === 'signal') for (let i = 0; i < 3; i++) el('rect', { x: -12, y: -18 + i * 6, width: i === 2 ? 14 : 24, height: 3, rx: 1.5 }, g);
  else if (kind === 'hand') el('rect', { x: -8, y: -16, width: 16, height: 16, rx: 6 }, g);
  else el('circle', { cx: 0, cy: -8, r: 8 }, g);
  return g;
}

/** @typedef {{start: [number, number], d: string, props: (g: Element) => void, lead?: [number, number][], twin?: boolean, door?: boolean, flag?: boolean, socket?: boolean, still?: boolean, brackets?: [number, number], fade?: boolean, tip?: boolean, shatter?: boolean, end?: (g: Element) => Element}} Scene */
const ground = (/** @type {Element} */ g, x1 = 20, x2 = 180) => el('line', { x1, y1: G, x2, y2: G, class: 'pg-ground' }, g);
/** @type {Record<string, Scene>} */
export const SCENES = {
  up: { start: [100, G], d: `M100 ${G} L100 ${G - 44}`, props: g => ground(g, 60, 140) },
  down: { start: [86, 44], d: `M86 44 C 118 44, 130 60, 130 ${G}`, props: g => { ground(g, 40, 170); el('line', { x1: 56, y1: 44, x2: 104, y2: 44, class: 'pg-prop' }, g); } },
  in: { start: [44, G], d: `M44 ${G} C 70 ${G - 50}, 130 ${G - 56}, 152 ${G - 2}`, props: g => { ground(g, 20, 120); el('path', { d: `M126 50 L126 ${G} L178 ${G} L178 50`, class: 'pg-prop' }, g); } },
  out: { start: [86, G - 2], d: `M86 ${G - 2} C 70 ${G - 60}, 30 ${G - 50}, 24 ${G}`, props: g => { el('path', { d: `M62 50 L62 ${G} L112 ${G} L112 50`, class: 'pg-prop' }, g); ground(g, 112, 180); ground(g, 10, 62); } },
  // the post has a head with a nose, so "in front" and "behind" read: it faces right
  front: { start: [62, G], d: `M62 ${G} L146 ${G}`, props: g => { ground(g); el('line', { x1: 104, y1: G - 34, x2: 104, y2: G, class: 'pg-prop' }, g); el('circle', { cx: 104, cy: G - 42, r: 7, class: 'pg-prop' }, g); el('path', { d: `M112 ${G - 45} l6 3 l-6 3 z`, class: 'pg-propfill' }, g); } },
  behind: { start: [40, G], d: `M40 ${G} L112 ${G}`, lead: [[76, G], [150, G]], props: g => ground(g) },
  touch: { start: [52, G], d: `M52 ${G} L140 ${G}`, props: g => { ground(g, 20, 150); el('line', { x1: 152, y1: 30, x2: 152, y2: G, class: 'pg-prop' }, g); },
    end: g => { const t = el('g', { class: 'pg-tick' }, g); el('line', { x1: 158, y1: G - 30, x2: 166, y2: G - 34 }, t); el('line', { x1: 158, y1: G - 20, x2: 168, y2: G - 20 }, t); el('line', { x1: 158, y1: G - 10, x2: 166, y2: G - 6 }, t); return t; } },
  shut: { start: [50, G], d: `M50 ${G} L128 ${G}`, door: true, props: g => { ground(g); el('line', { x1: 146, y1: 18, x2: 146, y2: G - 50, class: 'pg-prop' }, g); el('circle', { cx: 146, cy: G - 50, r: 2.5, class: 'pg-propfill' }, g); } },
  along: { start: [44, G], d: `M44 ${G} L128 ${G}`, twin: true, props: g => ground(g) },
  around: { start: [100, G - 6], d: `M100 ${G - 6} C 160 ${G - 6}, 160 ${G - 70}, 100 ${G - 70} C 40 ${G - 70}, 40 ${G - 6}, 96 ${G - 6}`, props: g => { el('circle', { cx: 100, cy: G - 38, r: 6, class: 'pg-propfill' }, g); } },
  turn: { start: [100, G], d: `M100 ${G} L100 ${G}`, tip: true, props: g => ground(g, 40, 160) },
  over: { start: [48, G], d: `M48 ${G} C 70 ${G - 80}, 130 ${G - 80}, 152 ${G}`, props: g => { ground(g); el('rect', { x: 94, y: G - 30, width: 12, height: 30, class: 'pg-propfill' }, g); } },
  under: { start: [40, G], d: `M40 ${G} L160 ${G}`, props: g => { ground(g); el('line', { x1: 70, y1: G - 36, x2: 130, y2: G - 36, class: 'pg-prop' }, g); el('line', { x1: 72, y1: G - 36, x2: 72, y2: 20, class: 'pg-prop' }, g); el('line', { x1: 128, y1: G - 36, x2: 128, y2: 20, class: 'pg-prop' }, g); } },
  through: { start: [40, G], d: `M40 ${G} L164 ${G}`, props: g => { ground(g); el('line', { x1: 102, y1: 20, x2: 102, y2: G - 34, class: 'pg-prop' }, g); el('line', { x1: 102, y1: G - 34, x2: 102, y2: G, class: 'pg-gap' }, g); } },
  target: { start: [46, G], d: `M58 ${G - 10} L128 ${G - 10}`, still: true, brackets: [150, G - 10], props: g => { ground(g); el('circle', { cx: 150, cy: G - 10, r: 10, class: 'pg-prop' }, g); } },
  deflect: { start: [40, G - 40], d: `M40 ${G - 40} L100 ${G - 40} C 128 ${G - 40}, 140 ${G - 20}, 150 ${G}`, fade: true, props: g => { el('circle', { cx: 170, cy: G - 40, r: 9, class: 'pg-prop' }, g); el('line', { x1: 100, y1: G - 40, x2: 158, y2: G - 40, class: 'pg-ghost' }, g); } },
  remove: { start: [100, G], d: `M100 ${G} C 100 ${G - 40}, 130 ${G - 56}, 160 ${G - 60}`, socket: true, props: g => ground(g, 40, 160) },
  reach: { start: [36, G], d: `M36 ${G} L150 ${G}`, flag: true, props: g => { ground(g); el('line', { x1: 164, y1: G, x2: 164, y2: G - 52, class: 'pg-prop' }, g); } },
  shatter: { start: [100, G], d: `M100 ${G} L100 ${G}`, shatter: true, props: g => ground(g, 40, 160) },
  miss: { start: [40, G - 40], d: `M40 ${G - 40} C 110 ${G - 40}, 150 ${G - 70}, 180 ${G - 72}`, props: g => el('circle', { cx: 150, cy: G - 40, r: 9, class: 'pg-prop' }, g) },
  none: { start: [100, G], d: `M100 ${G} L100 ${G}`, props: g => ground(g, 60, 140) },
};

const ease = (/** @type {number} */ t) => 1 - Math.pow(1 - t, 3);
const easeInOut = (/** @type {number} */ t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
/** @param {number} ms @param {(t: number) => void} f @param {{stop: boolean}} tok */
const tween = (ms, f, tok) => new Promise(res => {
  const t0 = performance.now();
  const step = (/** @type {number} */ now) => { if (tok.stop) { f(1); res(undefined); return; } const t = Math.min(1, (now - t0) / ms); f(t); if (t < 1) requestAnimationFrame(step); else res(undefined); };
  requestAnimationFrame(step);
});
const pause = (/** @type {number} */ ms, /** @type {{stop: boolean}} */ tok) => new Promise(r => { if (tok.stop) r(undefined); else setTimeout(r, ms); });

/**
 * Draw a scene into an <svg>. Returns { play(), final(), stop() }: play runs the motion once (the end state under
 * reduced motion); stop jumps a running play to its end.
 * @param {SVGSVGElement} svg @param {string} glyph @param {string} objKind @param {{label?: string}} [o]
 */
export function scene(svg, glyph, objKind, { label = '' } = {}) {
  while (svg.firstChild) svg.firstChild.remove();
  svg.setAttribute('viewBox', '0 0 200 110');
  if (label) { const t = el('title', {}, svg); t.textContent = label; }
  const s = SCENES[glyph] || SCENES.none;
  const g = el('g', {}, svg);
  s.props(g);
  const path = /** @type {SVGPathElement} */ (/** @type {unknown} */ (el('path', { d: s.d, class: 'pg-path' }, g)));
  const len = path.getTotalLength();
  if (len > 2) {
    const a = path.getPointAtLength(len), b = path.getPointAtLength(Math.max(0, len - 6));
    const ang = Math.atan2(a.y - b.y, a.x - b.x) * 180 / Math.PI;
    el('path', { d: 'M0 0 L-7 -4 L-7 4 Z', class: 'pg-head', transform: `translate(${a.x} ${a.y}) rotate(${ang})` }, g);
  }
  const lead = s.lead ? el('circle', { cx: 0, cy: -6, r: 6, class: 'pg-propfill' }, g) : null;
  const twin = s.twin ? object(objKind, g) : null;
  if (twin) twin.classList.add('pg-twin');
  if (s.socket) el('rect', { x: 88, y: G - 28, width: 24, height: 28, rx: 3, class: 'pg-socket' }, g);
  const door = s.door ? el('line', { x1: 146, y1: G - 50, x2: 146, y2: G, class: 'pg-prop pg-door' }, g) : null;
  const flag = s.flag ? el('path', { d: `M164 ${G - 52} L184 ${G - 45} L164 ${G - 38} Z`, class: 'pg-flag' }, g) : null;
  const obj = object(objKind, g);
  const place = (/** @type {number} */ x, /** @type {number} */ y, extra = '') => obj.setAttribute('transform', `translate(${x} ${y}) ${extra}`);
  const end = path.getPointAtLength(len);
  const doorAt = (/** @type {number} */ deg) => { if (!door) return; const r = deg * Math.PI / 180; door.setAttribute('x2', String(146 + 50 * Math.sin(r))); door.setAttribute('y2', String(G - 50 + 50 * Math.cos(r))); };
  const clear = () => g.querySelectorAll('.pg-tick, .pg-brackets, .pg-shard').forEach(e => e.remove());
  const final = () => {
    clear();
    if (s.still) place(...s.start); else place(end.x, end.y);
    if (lead && s.lead) lead.setAttribute('transform', `translate(${s.lead[1][0]} ${s.lead[1][1]})`);
    if (twin) twin.setAttribute('transform', `translate(${end.x} ${end.y - 30})`);
    obj.style.opacity = s.fade ? '0.45' : '1';
    doorAt(0);
    if (flag) flag.classList.add('on');
    if (s.tip) place(100, G, 'rotate(90) translate(-8 -6)');
    if (s.end) s.end(g);
    if (s.brackets) brackets(g, s.brackets, 1, 1);
    if (s.shatter) { obj.style.opacity = '0'; shards(g, 1); }
  };
  const start = () => {
    clear();
    place(...s.start); obj.style.opacity = '1';
    if (lead && s.lead) lead.setAttribute('transform', `translate(${s.lead[0][0]} ${s.lead[0][1]})`);
    if (twin) twin.setAttribute('transform', `translate(${s.start[0]} ${s.start[1] - 30})`);
    if (flag) flag.classList.remove('on');
    doorAt(60);
  };
  let tok = { stop: false };
  if (glyph === 'none') { final(); return { play: async () => {}, final, stop() {} }; }
  start();

  async function play({ ms = 900 } = {}) {
    tok.stop = true;
    const me = tok = { stop: false };
    if (reduced()) { final(); return; }
    start();
    if (s.still && s.brackets) { await pause(120, me); const b = brackets(g, s.brackets, 1.8, 0); await tween(380, t => { const e = ease(t); b.setAttribute('transform', `translate(${s.brackets?.[0]} ${s.brackets?.[1]}) scale(${1.8 - 0.8 * e})`); b.style.opacity = String(e); }, me); return; }
    if (s.tip) { await tween(ms * 0.7, t => { const e = ease(t); place(100, G, `rotate(${90 * e}) translate(${-8 * e} ${-6 * e})`); }, me); return; }
    if (s.shatter) { await pause(200, me); obj.style.opacity = '0'; const ps = shards(g, 0); await tween(560, t => { const e = ease(t); ps.forEach(p => p.el.setAttribute('transform', `translate(${100 + p.dx * e} ${G - 13 + p.dy * e}) rotate(${p.r * e})`)); }, me); return; }
    await tween(ms, t => {
      const e = easeInOut(t), p = path.getPointAtLength(len * e);
      place(p.x, p.y);
      if (lead && s.lead) lead.setAttribute('transform', `translate(${s.lead[0][0] + (s.lead[1][0] - s.lead[0][0]) * e} ${s.lead[0][1]})`);
      if (twin) twin.setAttribute('transform', `translate(${p.x} ${p.y - 30})`);
      if (s.fade) obj.style.opacity = String(1 - 0.55 * Math.max(0, (e - 0.5) * 2));
    }, me);
    if (door) await tween(320, t => doorAt(60 * (1 - ease(t))), me);
    if (flag) flag.classList.add('on');
    if (s.end && !me.stop) { const t = s.end(g); t.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160 }); }
  }
  return { play, final, stop() { tok.stop = true; } };
}

/** @param {Element} g @param {[number, number]} c @param {number} scale @param {number} opacity */
function brackets(g, [cx, cy], scale, opacity) {
  const b = el('g', { class: 'pg-brackets' }, g);
  const r = 16, k = 6;
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) el('path', { d: `M${sx * r} ${sy * (r - k)} L${sx * r} ${sy * r} L${sx * (r - k)} ${sy * r}` }, b);
  b.setAttribute('transform', `translate(${cx} ${cy}) scale(${scale})`); b.style.opacity = String(opacity);
  return b;
}
/** @param {Element} g @param {number} at 0 together, 1 apart */
function shards(g, at) {
  return [[-5, -5, -14, -10, -18], [5, -5, 14, -14, 14], [-5, 5, -16, 8, 10], [5, 5, 15, 6, -12]].map(([x, y, dx, dy, r]) => {
    const p = el('rect', { x: x - 5, y: y - 6, width: 10, height: 12, rx: 1.5, class: 'pg-shard' }, g);
    p.setAttribute('transform', `translate(${100 + dx * at} ${G - 13 + dy * at}) rotate(${r * at})`);
    return { el: p, dx, dy, r };
  });
}

/** The scene of a prefix for a reading: um- splits to turn over, stays on to go around. @param {{id: string, glyph: string} | undefined} p @param {'s'|'i'|null} kind */
export const glyphFor = (p, kind) => (!p ? 'none' : p.id === 'um' ? (kind === 's' ? 'turn' : 'around') : p.glyph);
