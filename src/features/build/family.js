/* Word family (#/practice/build/family/<root>[?w=<form>][&by=root|prefix|ending][&p=<prefix>][&e=<ending>][&from=…]):
   one root and every form built from it (round 7, WORDGAMES-DESIGN §4). The head and the ring sit over the tree on a
   phone; from 900 px they are a sticky column beside it.
     - the ring: the root in the middle, its verbs at their compass places (Word building's compass: auf up, ab down,
       ein forward, aus back …), the rest between; a solid spoke splits off, a dotted one never splits; a tile's ink is
       his knowledge (the Atlas encodings: ink known, ink-3 shaky, an open box not known, dotted not seen), the bar
       under it how the meaning comes (solid literal, hatched picture, outlined with a dot a word to learn), and the
       small squares outside are the nouns and adjectives grown from it. Every tile is a button with its full name.
     - the tree: Splits off / Never splits / From the root itself, each form with its joint or weld, stress dot,
       article, meaning, level, frequency, derivability mark and knowledge square. It is the list version of the ring
       and complete on its own. A tap opens the form's card and builds the word in front of him: the prefix arrives
       on an arc and lands with its joint (or the weld draws), the parent's -en leaves and the ending snaps on, the
       word type rolls Verb to Noun, the article drops on a dotted arc from its ending, the stress dot pops.
     - browse by Prefix (every verb with that prefix across roots) or by Ending (every word made with it).
   Opens as a page, or inside a sheet over a round (boot.js) so a look never ends the round. Knowledge comes from the
   one knowledge score (data/knowledge.js); nothing here writes a card. Each group of the tree runs by level (A1 first),
   then by frequency. */
import { h, replace, announce } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { langAttr, dirAttr } from '../../core/lang.js';
import { freq } from '../../domain/wordcard.js';
import { kidsOf, piecesOf, TILE_ENDINGS } from '../../domain/wordbuild-family.js';
import { familiesFor, allFamilies, loadedFamilies, familyRoots, warmFamilies, stateOf, todayOf, todayBoard, reportWord, unreportWord, reportsOf } from './family-data.js';
import { loadContent, knowledge } from './data.js';
import { formWord, stressed, stressedAt, stressPlace } from './fword.js';
import { play, css, reduced, wait, finishAll } from './fx.js';

/** @typedef {import('../../domain/wordbuild-family.js').Form} Form */
/** @typedef {import('../../domain/wordbuild-family.js').Family} Family */

const SVG = 'http://www.w3.org/2000/svg';
/** @param {string} tag @param {Record<string, any>} [attrs] @param {...Element} kids */
function s(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) el.setAttribute(k, String(v));
  for (const k of kids) if (k) el.append(k);
  return el;
}
/** Compass places of the separable prefixes (degrees, 0 = forward/right, -90 = up). */
const ANG = /** @type {Record<string, number>} */ ({ auf: -90, vor: -45, ein: 0, an: 45, ab: 90, nach: 135, aus: 180, zu: -135 });
const W = 360, H = 344, CX = 180, CY = 172;
/** The ring is taller than wide (1.3), so a tile and the derivability bar under it clear the tile below at 360 px. */
const RY = 1.3;
/** …and a little wider than the base radius, so a long prefix beside the root (zusammen) clears it in any font. */
const RX = 1.12;
/** The ring's other places: beside the side compass points, where labels clear their neighbours at 360 px (e2e
   family.spec measures every root). 8 compass places + these 4 = at most 12 verbs on the ring. */
const BETWEEN = [-22.5, 157.5, 22.5, -157.5];

/**
 * One tab stop for a group of buttons (a toolbar): the arrow keys move the focus, Home and End go to the ends,
 * Enter or Space presses. The stop follows the last focused button, else the pressed one, else the first.
 * @param {HTMLElement} group @param {string} sel
 */
export function roving(group, sel) {
  const all = () => /** @type {HTMLElement[]} */ ([...group.querySelectorAll(sel)]);
  const set = (/** @type {HTMLElement} */ on) => { for (const b of all()) b.tabIndex = b === on ? 0 : -1; };
  const first = all().find(b => b.getAttribute('aria-pressed') === 'true') || all()[0];
  if (first) set(first);
  group.addEventListener('focusin', e => { const b = /** @type {HTMLElement} */ (e.target); if (b.matches(sel)) set(b); });
  group.addEventListener('keydown', e => {
    const bs = all();
    const i = bs.indexOf(/** @type {HTMLElement} */ (document.activeElement));
    if (i < 0 || e.altKey || e.ctrlKey || e.metaKey) return;
    const n = bs.length;
    const to = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? (i + 1) % n : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? (i - 1 + n) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    bs[to].focus();
  });
}

/**
 * @param {HTMLElement} el @param {import('../contract.js').ViewCtx} ctx @param {string | undefined} rootArg
 * @param {{sheet?: boolean, close?: () => void}} [o] sheet: inside a sheet over a round (no links that leave)
 */
export async function mountFamily(el, ctx, rootArg, { sheet = false, close } = {}) {
  const { t, store } = ctx;
  const q = ctx.query || new URLSearchParams();
  const from = q.get('from') || '';
  let by = /** @type {'root'|'prefix'|'ending'} */ (['prefix', 'ending'].includes(String(q.get('by'))) ? q.get('by') : 'root');
  let pre = q.get('p') || '', end = q.get('e') || 'ung';
  let openId = q.get('w') || null;
  let alive = true;
  const back = () => {
    if (sheet) return null;
    const [href, label] = from === 'map' ? [`#/lookup/map/family/${encodeURIComponent(rootArg || '')}`, t('build.family.onMap')]
      : from === 'today' ? ['#/practice/build/today', t('build.today.title')]
      : from === 'lookup' || from === 'read' ? ['javascript-back', t(from === 'read' ? 'build.family.backRead' : 'lookup.title')]
      : ['#/practice/build', t('build.title')];
    if (href === 'javascript-back') return h('button', { type: 'button', class: 'pr-backlink pressable', onclick: () => history.back() }, icon('prev', { size: 16 }), label);
    return h('a', { class: 'pr-backlink pressable', href }, icon('prev', { size: 16 }), label);
  };
  replace(el, h('div', { class: ['wb', 'fv', sheet && 'fv-sheet'] }, back(), h('p', { class: 'label' }, t('build.family.label')), h('h1', { lang: langAttr(), dir: dirAttr() }, rootArg || t('build.family.title')), h('p', { class: 'caption' }, t('build.loading'))));
  /** @type {any} */
  let d;
  /** @type {Map<string, Family>} */
  let fams;
  /** @type {any} */
  let k;
  /** @type {any} */ let today = null;
  let root = '';
  try {
    // the content (the index says which roots exist), today's board, then only this root's family file
    [d, k] = await Promise.all([loadContent(ctx), knowledge(ctx).catch(() => null)]);
    const roots = familyRoots(ctx, d);
    today = sheet ? null : await todayBoard(ctx, d, k).catch(() => null);
    root = rootArg && roots.includes(rootArg) ? rootArg : today ? today.root : /** @type {string} */ (roots[0]);
    fams = await familiesFor(ctx, d, [root]);
    if (!fams.has(root)) throw new Error('family file');
    fams = loadedFamilies(d);
  } catch {
    replace(el, h('div', { class: 'wb fv' }, back(), h('h1', null, t('build.family.title')), h('p', null, t('build.loadFailed'))));
    return () => {};
  }
  if (!alive) return () => {};
  /** Load roots' files (a chip, Browse by prefix or ending), then draw; a file that fails leaves the page as it is. @param {string[] | null} roots null: every root */
  const need = async (/** @type {string[] | null} */ roots) => {
    await (roots ? familiesFor(ctx, d, roots) : allFamilies(ctx, d)).catch(() => null);
    fams = loadedFamilies(d);
    if (alive) draw();
  };
  // the map's family groups (content/clusters/de.json): "On the map" only where the group exists
  /** @type {Set<string>} */ let mapGroups = new Set();
  ctx.content.load('clusters.de').then((/** @type {any} */ c) => { mapGroups = new Set((c.families || []).map((/** @type {any} */ f) => f.id)); if (alive && !sheet) draw(); }).catch(() => {});
  const st = (/** @type {Form} */ f) => stateOf(d, k, f);
  const P = new Map(d.c.prefixes.map((/** @type {any} */ p) => [p.id, p]));
  const S = new Map(d.c.suffixes.map((/** @type {any} */ x) => [x.id, x]));

  /** Keep the address in step without a remount (a sheet has no address of its own). */
  const setAddress = () => {
    if (sheet) return;
    const sp = new URLSearchParams();
    if (openId && by === 'root') sp.set('w', openId);
    if (by !== 'root') sp.set('by', by);
    if (by === 'prefix' && pre) sp.set('p', pre);
    if (by === 'ending' && end) sp.set('e', end);
    if (from) sp.set('from', from);
    const qs = sp.toString();
    history.replaceState(history.state, '', `#/practice/build/family/${encodeURIComponent(root)}${qs ? `?${qs}` : ''}`);
  };

  /* ---------------- marks ---------------- */
  const STATE = (/** @type {string} */ x) => t(`build.family.state.${x}`);
  const stateSq = (/** @type {string} */ x, /** @type {boolean} */ now = false) => h('span', { class: ['fv-sq', `is-${x}`, now && 'is-today'], role: 'img', 'aria-label': now ? `${STATE(x)}, ${t('build.family.state.today')}` : STATE(x) });
  const gradeMark = (/** @type {string | undefined} */ g) => (g ? h('span', { class: ['fv-gr', `is-${g}`], role: 'img', 'aria-label': t(`build.family.legend.${g}`) }) : null);
  const freqEl = (/** @type {number | null | undefined} */ z) => {
    const f = freq(z ?? NaN);
    return f ? h('span', { class: 'fv-freq', role: 'img', 'aria-label': t('word.freq.aria', { band: t(`word.freq.${f.band}`) }) }, [1, 2, 3, 4, 5].map(i => h('i', { class: i <= f.bars ? 'is-on' : null }))) : null;
  };
  const typeName = (/** @type {string} */ cls) => t(`build.family.type.${cls}`);

  /* ---------------- the ring ---------------- */
  /** @param {Family} fam */
  function ring(fam) {
    const verbs = kidsOf(fam, fam.forms[0].id).filter(f => f.cls === 'verb');
    /** @type {Map<string, number>} */ const place = new Map();
    const used = new Set();
    // the compass places first: the separable verb of each compass prefix, the most common when there are two
    for (const v of [...verbs].sort((a, b) => (b.zipf || 0) - (a.zipf || 0))) if (ANG[v.pre[0]] != null && v.join === 's' && !used.has(ANG[v.pre[0]])) { place.set(v.id, ANG[v.pre[0]]); used.add(ANG[v.pre[0]]); }
    // then the four places beside the side compass points (between them and the top or bottom the labels collide at
    // 360 px), then compass places left free: separable verbs first, the most common first. A family with more verbs
    // than places keeps the rest as chips under the ring, the most common first (review round 7: labels overlapped
    // and one fell under the tab bar)
    const COMPASS = Object.values(ANG);
    const slots = [...BETWEEN, ...COMPASS.filter(a => !used.has(a))];
    const rest = verbs.filter(v => !place.has(v.id)).sort((a, b) => (a.join === 's' ? 0 : 1) - (b.join === 's' ? 0 : 1) || (b.zipf || 0) - (a.zipf || 0));
    rest.slice(0, slots.length).forEach((v, i) => place.set(v.id, slots[i]));
    const more = rest.slice(slots.length).sort((a, b) => (b.zipf || 0) - (a.zipf || 0));
    const dense = more.length > 0;
    const onRing = verbs.filter(v => place.has(v.id));
    // a prefix twice on the ring (a dual verb: umstellen splits, umstellen stays): each tile carries its joint or weld
    /** @type {Map<string, number>} */ const preCount = new Map();
    for (const v of verbs) preCount.set(v.pre[0] || '', (preCount.get(v.pre[0] || '') || 0) + 1);
    const r = 110;
    const svg = s('svg', { class: 'fv-ring-svg', viewBox: `0 0 ${W} ${H}`, 'aria-hidden': 'true', focusable: 'false' });
    const wrap = h('div', { class: 'fv-ring', role: 'group', 'aria-label': t(dense ? 'build.family.ringNameDense' : 'build.family.ringName', { root: fam.root, n: verbs.length, k: onRing.length }) }, svg);
    const pos = (/** @type {number} */ a, /** @type {number} */ rad, k2 = 1) => ({ x: CX + rad * Math.cos(a), y: CY + rad * k2 * Math.sin(a) });
    // compass order for the keyboard: clockwise from the top
    const order = [...onRing].sort((a, b) => (((/** @type {number} */ (place.get(a.id)) + 90) + 360) % 360) - (((/** @type {number} */ (place.get(b.id)) + 90) + 360) % 360));
    /** @type {{btn: HTMLElement, p: {x: number, y: number}, a: number, rects: Element[]}[]} */ const squares = [];
    for (const v of order) {
      const a = /** @type {number} */ (place.get(v.id)) * Math.PI / 180;
      const p = { x: CX + r * RX * Math.cos(a), y: CY + r * RY * Math.sin(a) };
      const c0 = pos(a, 50, 0.5);
      svg.append(s('line', { class: ['fv-spoke', v.join === 'i' && 'is-i'].filter(Boolean).join(' '), x1: c0.x, y1: c0.y, x2: p.x - 22 * Math.cos(a), y2: p.y - 14 * Math.sin(a) }));
      const ks = kidsOf(fam, v.id);
      // the nouns and adjectives grown from it: a short row of squares just outside the tile's box, across the spoke,
      // so none touches the tile or another square. Placed first from the label's length, then again from the tile's
      // measured size once it is on the page (fonts differ)
      const rects = ks.map(kf => s('rect', { class: `fv-kid is-${st(kf)}`, width: 8, height: 8, rx: 1.5 }));
      rects.forEach(x => svg.append(x));
      const btn = verbButton(v, (preCount.get(v.pre[0] || '') || 0) > 1, { class: 'fv-node', style: { left: `${(p.x / W) * 100}%`, top: `${(p.y / H) * 100}%` } });
      wrap.append(btn);
      const item = { btn, p, a, rects };
      squares.push(item);
      placeSquares(item, Math.max(20, ((v.pre[0] || v.word).length * 8 + 12) / 2), 13);
    }
    wrap.append(h('span', { class: 'fv-node-root', lang: langAttr(), dir: dirAttr(), 'aria-hidden': 'true', style: { left: '50%', top: `${(CY / H) * 100}%` } }, fam.root));
    roving(wrap, '.fv-node');
    // and again whenever a tile changes size (the web font arriving, a zoom)
    const measure = () => { const k = wrap.clientWidth / W; if (k) for (const it of squares) placeSquares(it, it.btn.offsetWidth / 2 / k, it.btn.offsetHeight / 2 / k); };
    if (typeof ResizeObserver === 'function') { const ro = new ResizeObserver(() => { if (!wrap.isConnected) { ro.disconnect(); return; } measure(); }); ro.observe(wrap); squares.forEach(it => ro.observe(it.btn)); }
    else requestAnimationFrame(measure);
    if (!more.length) return wrap;
    const chips = h('div', { class: 'fv-more-chips', role: 'group', 'aria-labelledby': 'fv-more-h' },
      more.map(v => verbButton(v, (preCount.get(v.pre[0] || '') || 0) > 1, { class: 'fv-vchip' })));
    roving(chips, '.fv-vchip');
    return h('div', { class: 'fv-ring-wrap' }, wrap,
      h('div', { class: 'fv-more' }, h('p', { class: 'fv-more-h', id: 'fv-more-h' }, t('build.family.moreVerbs', { n: more.length })), chips));
  }

  /**
   * The squares of a ring tile's nouns, outside its box: hw and hh are the tile's half width and height in the ring's
   * units; the derivability bar takes 10 more under it. A row across the top, bottom and diagonals, a column at the sides.
   * @param {{p: {x: number, y: number}, a: number, rects: Element[]}} it @param {number} hw @param {number} hh
   */
  function placeSquares({ p, a, rects }, hw, hh) {
    const ca = Math.cos(a), sa = Math.sin(a);
    const w = hw + 6, hgt = hh + 14;
    const reach = Math.min(Math.abs(ca) > 1e-3 ? w / Math.abs(ca) : Infinity, Math.abs(sa) > 1e-3 ? hgt / Math.abs(sa) : Infinity) + 4;
    const across = Math.abs(sa) > 0.5;
    rects.forEach((r, i) => {
      const off = (i - (rects.length - 1) / 2) * 11;
      const kx = across ? p.x + off : p.x + ca * reach, ky = across ? p.y + Math.sign(sa) * (hgt + 4) : p.y + off;
      r.setAttribute('x', String(kx - 4)); r.setAttribute('y', String(ky - 4));
    });
  }

  /**
   * A verb on the ring or among the chips under it: its prefix (the word, without one), the knowledge encodings, the
   * derivability bar. Its name starts with the text it shows (WCAG 2.5.3: "auf, aufstellen: set up …"). A dual verb's
   * two readings carry a joint (splits) or a weld (never splits), so the two tiles differ.
   * @param {Form} v @param {boolean} dual @param {{class: string, style?: Record<string, string>}} o
   */
  function verbButton(v, dual, o) {
    const ss = st(v);
    const shown = v.pre[0] || v.word;
    const rest = t('build.family.nodeName', { word: v.word, en: v.en, join: t(v.join === 's' ? 'build.family.legend.split' : 'build.family.legend.stay'), grade: v.grade ? t(`build.family.legend.${v.grade}`) : '', state: STATE(ss) }).replace(/\s+\.\s/g, '. ');
    const name = v.pre[0] ? `${shown}, ${rest}` : rest;
    return h('button', { type: 'button', class: [o.class, `is-${ss}`, todayOf(d, k, v) && 'is-today', dual && (v.join === 's' ? 'is-dual-s' : 'is-dual-i'), 'pressable'], lang: langAttr(), dir: dirAttr(), 'aria-label': name, 'data-id': v.id,
      style: o.style || null, onclick: () => toggle(v.id, true) },
    h('span', { class: 'fv-node-t' }, shown), v.grade ? h('span', { class: ['fv-gr', `is-${v.grade}`], 'aria-hidden': 'true' }) : null);
  }
  /** @param {Family} fam */
  function summary(fam) {
    /** @type {Record<string, number>} */ const c = { known: 0, shaky: 0, unknown: 0, unseen: 0 };
    for (const f of fam.forms) c[st(f)]++;
    const bar = h('span', { class: 'fv-bar', 'aria-hidden': 'true' }, ['known', 'shaky', 'unknown', 'unseen'].filter(x => c[x]).map(x => h('i', { class: `is-${x}`, style: { flexGrow: String(c[x]) } })));
    return h('p', { class: 'fv-sum' }, h('span', { class: 'tnum' }, t('build.family.known', { n: c.known, total: fam.forms.length })), bar);
  }
  const legend = () => h('div', { class: 'fv-legend' },
    ['T', 'M', 'O'].map(g => h('span', null, h('span', { class: ['fv-gr', `is-${g}`], 'aria-hidden': 'true' }), t(`build.family.legend.${g}`))),
    h('span', null, h('i', { class: 'fv-line', 'aria-hidden': 'true' }), t('build.family.legend.split')),
    h('span', null, h('i', { class: 'fv-line is-i', 'aria-hidden': 'true' }), t('build.family.legend.stay')),
    ['known', 'shaky', 'unknown', 'unseen'].map(x => h('span', null, h('span', { class: ['fv-sq', `is-${x}`], 'aria-hidden': 'true' }), t(`build.family.legend.${x}`))));

  /* ---------------- the tree ---------------- */
  /** @param {Family} fam @param {Form} f @param {number} depth */
  function row(fam, f, depth) {
    const ss = st(f);
    const f2 = freqEl(f.zipf);
    const reported = reportsOf(store).some(r => r.form === f.id);
    const btn = h('button', { type: 'button', class: 'fv-rowbtn', 'aria-expanded': 'false', 'aria-controls': `fv-d-${cssId(f.id)}`, onclick: () => toggle(f.id) },
      stateSq(ss, todayOf(d, k, f)),
      h('span', { class: ['fv-w', ss === 'unseen' && 'is-unseen'] }, formWord(f, { t }), f.rare ? h('span', { class: 'caption fv-tag' }, t('build.family.rare')) : null, reported ? h('span', { class: 'caption fv-tag' }, t('build.family.reportedTag')) : null),
      h('span', { class: 'fv-r' }, h('span', { class: 'tnum' }, f.level || ''), h('span', { class: 'fv-r-marks' }, f2, gradeMark(f.grade))),
      h('span', { class: 'fv-m' }, f.en));
    const det = h('div', { class: 'fv-detail', id: `fv-d-${cssId(f.id)}` }, h('div', { inert: true }));
    return h('li', { class: ['fv-row', depth && 'is-kid', depth > 1 && 'is-k2'], 'data-id': f.id }, btn, det);
  }
  /** @param {Family} fam */
  function sections(fam) {
    /** @type {HTMLElement[]} */ const out = [];
    const walk = (/** @type {Form} */ f, /** @type {number} */ dep, /** @type {HTMLElement} */ ul) => { ul.append(row(fam, f, dep)); for (const kf of byLevel(kidsOf(fam, f.id))) walk(kf, dep + 1, ul); };
    const sec = (/** @type {string} */ id, /** @type {string} */ title, /** @type {string} */ rule, /** @type {Form[]} */ items) => {
      if (!items.length) return;
      const ul = h('ul', { class: 'fv-list' });
      byLevel(items).forEach(f => walk(f, 0, ul));
      out.push(h('section', { class: 'fv-sec', 'aria-labelledby': `fv-h-${id}` }, h('h2', { id: `fv-h-${id}` }, title), h('p', { class: 'fv-rule' }, rule), ul));
    };
    const kids = kidsOf(fam, fam.forms[0].id);
    sec('s', t('build.family.splitsOff'), t('build.family.splitsRule'), kids.filter(f => f.cls === 'verb' && f.join === 's'));
    sec('i', t('build.family.neverSplits'), t('build.family.neverRule'), kids.filter(f => f.cls === 'verb' && f.join !== 's'));
    sec('r', t('build.family.fromRoot', { root: fam.root }), t('build.family.fromRule'), kids.filter(f => f.cls !== 'verb'));
    return out;
  }

  /* ---------------- a form's card and the build ---------------- */
  /** @param {Family} fam @param {Form} f */
  function card(fam, f) {
    const stage = h('div', { class: 'fv-stage', 'aria-hidden': 'true' });
    const parent = f.parent ? fam.byId.get(f.parent) : null;
    const ss = st(f);
    const how = f.grade ? h('p', { class: 'fv-how' }, gradeMark(f.grade), h('span', null, h('b', null, `${t(`build.family.legend.${f.grade}`)}. `), f.why || f.note || ''))
      : f.note ? h('p', { class: 'fv-how' }, h('span', null, f.note)) : null;
    const f2 = freq(f.zipf ?? NaN);
    const facts = h('p', { class: 'fv-facts' },
      h('span', null, typeName(f.cls)), f.level ? h('span', { class: 'tnum' }, f.level) : null,
      f2 ? h('span', { class: 'fv-fq' }, freqEl(f.zipf), t(`word.freq.${f2.band}`)) : null,
      f.pp ? h('span', null, t('build.family.perfekt'), ' ', h('span', { lang: langAttr(), dir: dirAttr() }, `${String(f.aux || 'hat').replace('/', ' / ')} ${f.pp}`)) : null,
      f.cls === 'verb' && f.join ? h('span', null, t(f.join === 's' ? 'build.family.legend.split' : 'build.family.legend.stay')) : null,
      parent ? h('span', null, t('build.family.from'), ' ', h('span', { class: 'fv-de', lang: langAttr(), dir: dirAttr() }, parent.word)) : null,
      h('span', { class: 'fv-fq' }, stateSq(ss, todayOf(d, k, f)), STATE(ss)));
    const replay = h('button', { type: 'button', class: 'btn btn-quiet pressable', onclick: () => build(stage, fam, f) }, t('build.family.again'));
    const reportBtn = h('button', { type: 'button', class: 'btn btn-quiet pressable fv-report', onclick: () => {
      reportWord(store, { form: f.id, root: fam.root, word: `${f.art ? `${f.art} ` : ''}${f.word}`, day: ctx.clock.today() });
      ctx.toast(t('build.family.reported'), { action: t('build.family.undo'), onAction: () => { unreportWord(store, f.id); draw(); } });
      draw();
    } }, t('build.family.report'));
    const practise = f.card && !sheet ? h('a', { class: 'btn pressable', href: `#/practice/build/round?kind=pick&ids=${encodeURIComponent(f.card)}` }, t('build.family.practise')) : null;
    return h('div', { class: 'fv-card' }, stage,
      h('p', { class: 'fv-what' }, f.en),
      how, f.ex ? example(fam, f) : null, f.ex && f.exEn ? h('p', { class: 'fv-exen' }, f.exEn) : null, facts,
      h('div', { class: 'fv-acts' }, practise, replay, reportBtn));
  }

  /** The authored example with the word (the stem and a split-off particle) underlined. @param {Family} fam @param {Form} f */
  function example(fam, f) {
    const p = h('p', { class: 'fv-ex', lang: langAttr(), dir: dirAttr() });
    const pc = piecesOf(f);
    const sepPre = f.cls === 'verb' && f.join === 's' ? (pc.pre[pc.pre.length - 1] || '').toLowerCase() : null;
    const toks = String(f.ex).split(/(\s+|[.,!?;:])/).filter(x => x !== '');
    const lastPre = sepPre ? toks.map((x, i) => (x.toLowerCase() === sepPre ? i : -1)).filter(i => i >= 0).pop() : -1;
    const stem = fam.stem.toLowerCase(), word = f.word.toLowerCase();
    toks.forEach((x, i) => {
      const lw = x.toLowerCase();
      const hit = i === lastPre || (x.length > 2 && (f.cls === 'verb' ? (lw.startsWith(stem) || lw.startsWith(word.slice(0, -2)) || (pc.pre.length && lw.startsWith(`${pc.pre.join('').toLowerCase()}ge${stem}`))) : lw.startsWith(word.slice(0, Math.max(3, word.length - 2)))));
      p.append(hit ? h('u', null, x) : x);
    });
    return p;
  }

  /**
   * The build: the parent word stands; the new piece arrives (a prefix from the left on an 18 px arc, an ending
   * snapping on from the right as the parent's -en leaves); the joint shows or the weld draws; the word type rolls;
   * the stress dot pops; the article drops on a dotted arc from its ending. Reduced motion: the finished word.
   * @param {HTMLElement} stage @param {Family} fam @param {Form} f
   */
  async function build(stage, fam, f) {
    finishAll();
    const pc = piecesOf(f);
    const step = f.side === 'pre' ? 'pre' : f.side === 'suf' ? 'suf' : null;
    const verb = f.cls === 'verb';
    const sep = verb && f.join === 's' && pc.pre.length > 0, weldOn = verb && f.join === 'i' && pc.pre.length > 0;
    const preText = pc.pre.join('');
    const sp = stressPlace(f, preText);
    const onPre = sp.onPre;
    const art = f.art ? h('span', { class: 'fv-artp' }, f.art) : null;
    // the dot goes into the prefix piece that holds the stressed vowel (the content's index), else the last one
    let off = sp.at ?? -1, dotIn = pc.pre.length - 1;
    if (onPre && sp.at != null) { let acc = 0; for (let i = 0; i < pc.pre.length; i++) { if (sp.at < acc + pc.pre[i].length) { dotIn = i; off = sp.at - acc; break; } acc += pc.pre[i].length; } }
    const preEls = pc.pre.map((x, i) => h('span', { class: ['fv-pc', 'is-pre', i === pc.pre.length - 1 && step === 'pre' && 'is-add'] }, onPre && i === dotIn ? (off >= 0 ? stressedAt(x, off) : stressed(x)) : x,
      i === pc.pre.length - 1 && sep ? h('span', { class: 'fv-joint' }) : null));
    const rest = pc.base + pc.tail;
    const baseEl = h('span', { class: 'fv-pc is-base' }, onPre ? rest : sp.at != null && sp.at < rest.length ? stressedAt(rest, sp.at) : stressed(rest));
    const sufEls = pc.suf.map((x, i) => h('span', { class: ['fv-pc', 'is-suf', i === pc.suf.length - 1 && step === 'suf' && 'is-add'] }, x));
    const weld = weldOn ? h('span', { class: 'fv-weld' }) : null;
    const big = h('span', { class: 'fv-big', lang: langAttr(), dir: dirAttr() }, art, h('span', { class: 'fv-big-w' }, preEls, baseEl, sufEls, weld));
    const parent = f.parent ? fam.byId.get(f.parent) : null;
    const cls = h('span', { class: 'fv-cls' }, h('span', null, typeName(f.cls)));
    replace(stage, big, cls);
    if (reduced() || !step) return;
    const add = /** @type {HTMLElement | null} */ (big.querySelector('.is-add'));
    const dot = /** @type {HTMLElement | null} */ (big.querySelector('.fw-dot'));
    const joint = /** @type {HTMLElement | null} */ (big.querySelector('.fv-joint'));
    const hide = /** @type {(HTMLElement | null)[]} */ ([dot, joint, weld, art, add]);
    hide.forEach(x => { if (x) x.style.opacity = '0'; });
    let ghost = null;
    // a noun from a verb takes its capital when its ending lands (a frame read "Ausstellen" before -ung came)
    /** @type {Text | null} */ let capText = null; let capWas = '';
    if (step === 'suf' && f.cls === 'noun' && parent && parent.cls !== 'noun') {
      const first = /** @type {HTMLElement} */ (preEls[0] || baseEl);
      const walker = document.createTreeWalker(first, NodeFilter.SHOW_TEXT);
      capText = /** @type {Text | null} */ (walker.nextNode());
      if (capText && capText.data) { capWas = capText.data; capText.data = capWas.charAt(0).toLowerCase() + capWas.slice(1); }
    }
    if (step === 'suf' && parent && parent.cls === 'verb' && add) {
      // the parent's -en leaves as the ending comes
      ghost = h('span', { class: 'fv-pc fv-ghost', 'aria-hidden': 'true' }, parent.word.endsWith('n') ? parent.word.slice(-2) : '');
      add.before(ghost);
    }
    await wait(220);
    if (!alive || !stage.isConnected) return;
    if (ghost) { const g = ghost; play(g, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-10px)' }], { duration: 160, easing: css('--ease-in'), fill: 'forwards' }).then(() => g.remove()); await wait(120); }
    if (add) {
      add.style.opacity = '';
      if (step === 'pre') await play(add, [{ transform: 'translate(-46px, 0)', opacity: 0 }, { transform: 'translate(-22px, -18px)', opacity: 1, offset: 0.5 }, { transform: 'none', opacity: 1 }], { duration: 520, easing: css('--ease-out') });
      else await play(add, [{ transform: 'translateX(18px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 420, easing: css('--spring-snappy') });
    }
    if (capText && capWas) capText.data = capWas;
    if (joint) { joint.style.opacity = ''; play(joint, [{ transform: 'scaleY(0)' }, { transform: 'scaleY(1)' }], { duration: 240, easing: css('--spring-snappy') }); play(preEls[preEls.length - 1], [{ transform: 'translateY(-3px)' }, { transform: 'none' }], { duration: 240, easing: css('--spring-snappy') }); }
    if (weld) { weld.style.opacity = ''; play(weld, [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: 260, delay: 120, easing: css('--ease-out') }); }
    if (parent && parent.cls !== f.cls) {
      const old = h('span', null, typeName(parent.cls));
      cls.prepend(old);
      play(/** @type {HTMLElement} */ (cls.lastElementChild), [{ transform: 'translateY(18px)' }, { transform: 'none' }], { duration: 380, delay: 60, easing: css('--spring-snappy') });
      play(old, [{ transform: 'none' }, { transform: 'translateY(-18px)' }], { duration: 160, easing: css('--ease-in'), fill: 'forwards' }).then(() => old.remove());
    }
    if (dot) { dot.style.opacity = ''; play(dot, [{ transform: 'scale(0)' }, { transform: 'scale(1)' }], { duration: 420, delay: 260, easing: css('--spring-pop') }); }
    if (art) {
      await wait(320);
      if (!stage.isConnected) return;
      const last = sufEls[sufEls.length - 1];
      if (last) {
        const bw = big.offsetWidth;
        const x1 = last.offsetLeft + last.offsetWidth / 2 + /** @type {HTMLElement} */ (last.parentElement).offsetLeft, x2 = art.offsetLeft + art.offsetWidth / 2;
        const path = s('path', { d: `M ${x1} 30 C ${x1} 2, ${x2} 2, ${x2} 22` });
        const arc = s('svg', { class: 'fv-arc', width: bw, height: 40, viewBox: `0 0 ${bw} 40`, 'aria-hidden': 'true' }, path);
        big.append(arc);
        const L = /** @type {SVGPathElement} */ (path).getTotalLength();
        play(path, [{ strokeDasharray: `${L}`, strokeDashoffset: L }, { strokeDasharray: `${L}`, strokeDashoffset: 0 }], { duration: 320, easing: css('--ease-out') })
          .then(() => play(arc, [{ opacity: 1 }, { opacity: 0 }], { duration: 400, delay: 500, fill: 'forwards' })).then(() => arc.remove());
      }
      art.style.opacity = '';
      await play(art, [{ transform: 'translateY(-22px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 560, delay: 200, easing: css('--spring-pop') });
    }
  }

  /** Open a form's card (closing the open one at once, so the eye stays on the new one) and build the word. @param {string} id @param {boolean} [scroll] */
  async function toggle(id, scroll = false) {
    const li = /** @type {HTMLElement | null} */ (el.querySelector(`.fv-row[data-id="${CSS.escape(id)}"]`));
    if (!li) return;
    const det = /** @type {HTMLElement} */ (li.querySelector('.fv-detail')), btn = /** @type {HTMLElement} */ (li.querySelector('.fv-rowbtn'));
    const wasOpen = det.classList.contains('is-open');
    for (const o of /** @type {HTMLElement[]} */ ([...el.querySelectorAll('.fv-detail.is-open')])) {
      o.style.transition = 'none'; o.classList.remove('is-open'); /** @type {HTMLElement} */ (o.firstElementChild).inert = true;
      o.previousElementSibling?.setAttribute('aria-expanded', 'false'); o.parentElement?.removeAttribute('aria-current');
      void o.offsetHeight; o.style.transition = '';
    }
    if (wasOpen) { openId = null; setAddress(); return; }
    const fam = /** @type {Family} */ (fams.get(root));
    const f = /** @type {Form} */ (fam.byId.get(id));
    replace(/** @type {HTMLElement} */ (det.firstElementChild), card(fam, f));
    if (reduced()) { det.style.transition = 'none'; requestAnimationFrame(() => { det.style.transition = ''; }); }
    det.classList.add('is-open'); /** @type {HTMLElement} */ (det.firstElementChild).inert = false;
    btn.setAttribute('aria-expanded', 'true'); li.setAttribute('aria-current', 'true');
    openId = id; setAddress();
    if (scroll) { li.scrollIntoView({ block: 'start', behavior: reduced() ? 'instant' : 'smooth' }); btn.focus({ preventScroll: true }); }
    announce(`${f.art ? `${f.art} ` : ''}${f.word}: ${f.en}`);
    await wait(scroll ? 380 : 140);
    if (alive) build(/** @type {HTMLElement} */ (det.querySelector('.fv-stage')), fam, f);
  }

  /* ---------------- browse by prefix or ending ---------------- */
  /** Every verb made with a prefix, across the families. @param {string} p */
  function byPrefix(p) {
    const pp = P.get(p) || { id: p, core: '', kind: 's' };
    /** @type {{fam: Family, f: Form}[]} */ const rows = [];
    for (const fam of fams.values()) for (const f of fam.forms) if (f.cls === 'verb' && f.pre.length === 1 && f.pre[0] === p) rows.push({ fam, f });
    rows.sort((a, b) => (b.f.zipf || 0) - (a.f.zipf || 0));
    const nOf = (/** @type {string} */ g) => rows.filter(x => x.f.grade === g).length;
    return [h('div', { class: 'fv-head' }, h('h2', { lang: langAttr(), dir: dirAttr() }, `${p}-`), h('p', null, `${pp.core}. ${t(`build.family.kind.${pp.kind || 's'}`)}`),
      h('p', { class: 'caption' }, t('build.family.prefixCounts', { n: rows.length, t: nOf('T'), m: nOf('M'), o: nOf('O') }))),
    h('ul', { class: 'fv-list fv-browse-list' }, rows.map(({ fam, f }) => h('li', { class: 'fv-row' }, linkRow(fam, f, `${fam.root}: ${fam.en} → ${f.en}`))))];
  }
  /** Every word made with an ending. @param {string} e */
  function byEnding(e) {
    const sx = S.get(e);
    /** @type {{fam: Family, f: Form}[]} */ const rows = [];
    for (const fam of fams.values()) for (const f of fam.forms) if (f.suf[f.suf.length - 1] === e && !rows.some(x => x.f.word === f.word)) rows.push({ fam, f });
    return [h('div', { class: 'fv-head' }, h('h2', { lang: langAttr(), dir: dirAttr() }, sx ? sx.label : `-${e}`), sx ? h('p', null, sx.rule) : null,
      h('p', { class: 'caption' }, t('build.family.endingCount', { n: rows.length }))),
    h('ul', { class: 'fv-list fv-browse-list' }, rows.map(({ fam, f }) => { const par = f.parent ? fam.byId.get(f.parent) : null; return h('li', { class: 'fv-row' }, linkRow(fam, f, `${par ? par.word : fam.root} + ${sx ? sx.label : `-${e}`}: ${f.en}`)); }))];
  }
  /** A row that opens the form in its family. @param {Family} fam @param {Form} f @param {string} meaning */
  function linkRow(fam, f, meaning) {
    const go = () => { root = fam.root; by = 'root'; openId = f.id; draw(); requestAnimationFrame(() => toggle(f.id, true)); };
    return h('button', { type: 'button', class: 'fv-rowbtn', onclick: go },
      gradeMark(f.grade) || h('span', { class: 'fv-gr is-none', 'aria-hidden': 'true' }),
      h('span', { class: 'fv-w' }, formWord(f, { t })),
      h('span', { class: 'fv-r' }, h('span', { class: 'tnum' }, f.level || ''), h('span', { class: 'fv-r-marks' }, freqEl(f.zipf))),
      h('span', { class: 'fv-m' }, h('span', { lang: langAttr(), dir: dirAttr() }, meaning)));
  }

  /* ---------------- the page ---------------- */
  function chipRow(/** @type {string} */ label, /** @type {[string, string][]} */ items, /** @type {string} */ cur, /** @type {(v: string) => void} */ pick, lang = true) {
    // one tab stop: the arrow keys move along the row (40 roots were 40 tab stops before the first word)
    const row = h('div', { class: 'fv-chips', role: 'toolbar', 'aria-label': label }, items.map(([v, text]) =>
      h('button', { type: 'button', class: 'chip pressable', lang: lang ? langAttr() : null, dir: lang ? dirAttr() : null, 'aria-pressed': String(v === cur), onclick: () => pick(v) }, text)));
    roving(row, '.chip');
    return row;
  }
  function draw() {
    if (!alive) return;
    const side = h('div', { class: 'fv-side' });
    const main = h('div', { class: 'fv-main' });
    const seg = h('div', { class: 'seg fv-seg', role: 'group', 'aria-label': t('build.family.by') },
      /** @type {const} */ (['root', 'prefix', 'ending']).map(x => h('button', { type: 'button', 'aria-pressed': String(by === x), onclick: () => { by = x; openId = null; draw(); if (x !== 'root' && fams.size < familyRoots(ctx, d).length) need(null); } }, t(`build.family.by.${x}`))));
    if (by === 'root') {
      const fam = /** @type {Family} */ (fams.get(root));
      const r0 = fam.forms[0];
      const rc = d.c.roots.find((/** @type {any} */ x) => x.id === root) || fam.info || null;
      if (r0.level == null && fam.info && fam.info.level) r0.level = fam.info.level;
      if (r0.zipf == null && fam.info && fam.info.zipf != null) r0.zipf = fam.info.zipf;
      const f0 = freq(r0.zipf ?? NaN);
      side.append(h('p', { class: 'label' }, t('build.family.label')),
        h('div', { class: 'fv-h1' }, h('h1', { lang: langAttr(), dir: dirAttr() }, root), h('span', { class: 'fv-en' }, fam.en)),
        h('p', { class: 'fv-meta' }, h('span', null, typeName('verb')), r0.level ? h('span', { class: 'tnum' }, r0.level) : null,
          f0 ? h('span', { class: 'fv-fq' }, freqEl(r0.zipf), t(`word.freq.${f0.band}`)) : null,
          rc ? h('span', { lang: langAttr(), dir: dirAttr() }, `${rc.pres3} · ${rc.pret} · ${rc.aux} ${rc.pp}`) : null,
          // the Map's group of this family, in view at the top (it was only at the end of the tree)
          !sheet && mapGroups.has(root) ? h('a', { class: 'fv-maplink pressable', href: `#/lookup/map/family/${encodeURIComponent(root)}` }, t('build.family.onMap'), icon('next', { size: 14 })) : null),
        seg,
        chipRow(t('build.family.roots'), familyRoots(ctx, d).map(x => [x, x]), root, v => { if (fams.has(v)) { root = v; openId = null; draw(); } else need([v]).then(() => { if (alive && fams.has(v)) { root = v; openId = null; draw(); } }); }),
        h('div', { class: 'fv-ring-card' }, ring(fam), summary(fam), legend()));
      main.append(...sections(fam));
      const cta = [];
      if (today && today.root === root && !sheet) cta.push(h('div', { class: 'fv-cta' }, h('p', null, t('build.family.todayIs', { root })), h('a', { class: 'btn btn-primary pressable', href: '#/practice/build/today' }, t('build.family.play'))));
      else if (today && !sheet) cta.push(h('p', { class: 'fv-cta-line' }, h('a', { class: 'pressable', href: '#/practice/build/today' }, t('build.family.todayOther', { root: today.root }))));
      if (!sheet && mapGroups.has(root)) cta.push(h('p', { class: 'fv-cta-line' }, h('a', { class: 'btn btn-quiet pressable', href: `#/lookup/map/family/${encodeURIComponent(root)}` }, icon('next', { size: 16 }), t('build.family.onMap'))));
      main.append(...cta);
    } else if (by === 'prefix') {
      const list = [...new Set([...d.c.prefixes.map((/** @type {any} */ p) => p.id), ...[...fams.values()].flatMap((/** @type {Family} */ f) => f.forms.filter((/** @type {Form} */ x) => x.cls === 'verb' && x.pre.length === 1).map((/** @type {Form} */ x) => x.pre[0]))])];
      if (!pre || !list.includes(pre)) pre = list.includes('aus') ? 'aus' : list[0];
      side.append(h('p', { class: 'label' }, t('build.family.labelMany')), h('div', { class: 'fv-h1' }, h('h1', null, t('build.family.byPrefix'))), seg,
        chipRow(t('build.family.prefixes'), list.map(p => [p, `${p}-`]), pre, v => { pre = v; draw(); }));
      main.append(...byPrefix(pre));
    } else {
      const list = TILE_ENDINGS.filter(e => [...fams.values()].some((/** @type {Family} */ f) => f.forms.some((/** @type {Form} */ x) => x.suf[x.suf.length - 1] === e)));
      if (!list.includes(end)) end = list[0];
      side.append(h('p', { class: 'label' }, t('build.family.labelMany')), h('div', { class: 'fv-h1' }, h('h1', null, t('build.family.byEnding'))), seg,
        chipRow(t('build.family.endings'), list.map(e => [e, (S.get(e) || { label: `-${e}` }).label]), end, v => { end = v; draw(); }));
      main.append(...byEnding(end));
    }
    // a skip link past the head, the chips and the ring to the first word (keyboard)
    const skip = h('a', { class: 'skip-link fv-skip', href: '#', onclick: (/** @type {Event} */ e) => { e.preventDefault(); /** @type {HTMLElement | null} */ (main.querySelector('.fv-rowbtn'))?.focus(); } }, t('build.family.skip'));
    replace(el, h('div', { class: ['wb', 'fv', sheet && 'fv-sheet'] }, back(), skip, h('div', { class: 'fv-grid' }, side, main)));
    setAddress();
    // the chip of the current root in view
    requestAnimationFrame(() => /** @type {HTMLElement | null} */ (el.querySelector('.fv-chips [aria-pressed="true"]'))?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'instant' }));
  }

  draw();
  if (openId && by === 'root') { const id = openId; requestAnimationFrame(() => toggle(id, true)); }
  // the other roots' files after the first paint, in idle moments (offline later; Browse needs them)
  if (!sheet) warmFamilies(ctx, d);
  // in a sheet, Esc is the dialog's own (it closes after the round's key handlers have seen the dialog open)
  return () => { alive = false; finishAll(); };
}

const LEVEL_ORDER = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
/** The tree's order: by level (A1 first, a form without one last), then the most common first. @param {Form[]} list */
export const byLevel = list => [...list].sort((a, b) => levelRank(a) - levelRank(b) || (b.zipf || 0) - (a.zipf || 0));
/** @param {Form} f */
const levelRank = f => { const i = LEVEL_ORDER.indexOf(String(f.level || '')); return i < 0 ? LEVEL_ORDER.length : i; };

/** An id safe in an element id. @param {string} id */
const cssId = id => String(id).replace(/[^\w-]/g, '_');
