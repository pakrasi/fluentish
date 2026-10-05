/* The Explore map (the Atlas): pure layout, grouping and encodings. Tested in node (tests/unit/explore-atlas.test.mjs);
   used by tools/build-atlas.mjs (which writes content/atlas/de.json) and by the Explore view (src/features/explore/).

   Every item is set as a word of type in one round paragraph per group ("disc"), in a fixed order, and groups sit on a
   fixed spiral, largest first. World units: the map's base font is 16 units, a line is 26 units. Widths come from the
   vendored font's advance table (src/vendor/newsreader-map/metrics.json, a font without kerning or ligatures), so the
   build and every device agree on every line break.

   Stability (DESIGN.md, Explore): a position is a function of the content only, never of what the learner knows.
     - knowledge is not an input to anything here except encode() and the group summaries;
     - a rebuild with the previous map keeps every existing item where it was: new items go on new lines at the end of
       their group's paragraph, inside the headroom each disc keeps (HEAD); a group that outgrows its disc, or a new
       width table, needs an explicit repack (tools/build-atlas.mjs --repack), which is a map release.
   The Source mode depends on where the learner met each item, so it is laid out on the device (layoutGroups) with the
   same widths; its groups grow in the order items were first met, so it too only appends. */

export const FS = 16;          // base font size, world units
export const LH = 26;          // line height
export const GAP = 10;         // space between words
export const PAIR_IN = 22;     // space inside an opposite pair (a hairline is drawn in it)
export const PAIR_GAP = 34;    // space between pairs: more than inside, so pairs read as pairs
export const ART = 0.72;       // article size relative to the word
export const HEAD = 1.06;      // disc radius over the radius the paragraph needs: headroom for new items
export const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
export const ARTICLES = ['', 'der', 'die', 'das'];
/** Item kinds: w word, c chunk (phrase), g grammar concept. */
export const KINDS = ['w', 'c', 'g'];
export const MODES = /** @type {const} */ (['topic', 'family', 'opp', 'level', 'type', 'source']);
/** @typedef {'topic'|'family'|'opp'|'level'|'type'|'source'} Mode */
/** Modes whose layout ships in content/atlas (Source is laid out on the device). */
export const BUILT_MODES = /** @type {const} */ (['topic', 'family', 'opp', 'level', 'type']);
/** Word-type groups in map order. */
export const TYPE_GROUPS = ['der', 'die', 'das', 'verb', 'adj', 'adv', 'prep', 'conj', 'setphrase', 'other', 'phrase', 'grammar'];
/** Source groups in map order (knowledge.js Origin values); an item sits in the first one it has. */
export const SOURCE_GROUPS = ['exam', 'script', 'speech', 'practice', 'test', 'lookup'];

/**
 * @typedef {object} Item
 * @property {string} id      'W:<word id>' | 'K:<chunk id>' | 'GC:<concept id>'
 * @property {string} t       the text drawn (a chunk's first form with its slots as …)
 * @property {string} a       the article for a noun ('' otherwise)
 * @property {'w'|'c'|'g'} k
 * @property {string} L       level
 * @property {string} p       part of speech ('phrase' for chunks, 'grammar' for concepts)
 * @property {number} f       frequency weight: a word's zipf, a chunk 5/4/3 by priority 1/2/3, a concept 4
 * @property {number} r       content rank (word list rank, chunk number, concept order)
 * @property {string} [topic] the topic id (words and chunks)
 */

/* ---------------------------------------------------------------- widths */

/**
 * A width function from the vendored advance table. Missing characters throw, so the build fails rather than guess.
 * @param {{styles: {regular: {unitsPerEm: number, advance: Record<string, number>}}}} metrics
 * @returns {(text: string, size?: number) => number}
 */
export function widthOf(metrics) {
  const st = metrics.styles.regular, adv = st.advance, upm = st.unitsPerEm;
  return (text, size = FS) => {
    let u = 0;
    for (const ch of text) {
      const a = adv[ch];
      if (a == null) throw new Error(`map font has no glyph for ${JSON.stringify(ch)} (U+${ch.codePointAt(0)?.toString(16)}) in ${JSON.stringify(text)}`);
      u += a;
    }
    return (u * size) / upm;
  };
}

/** Round to tenths, the precision the map ships (w10). @param {number} x */
const tenth = x => Math.round(x * 10);

/**
 * Article and total widths of an item, in tenths of a unit (integers, as content/atlas stores them).
 * @param {(text: string, size?: number) => number} width @param {{t: string, a: string}} it
 */
export function itemWidths(width, it) {
  const aw = it.a ? tenth(width(`${it.a} `, FS * ART)) : 0;
  return { aw, w: aw + tenth(width(it.t)) };
}

/* ---------------------------------------------------------------- items from content */

/** A chunk's display form: its first variant, slots as …. @param {string} t */
export function chunkText(t) {
  let s = String(t).split(' / ')[0];
  s = s.replace(/\[[^\]]*\]/g, '…').replace(/(…\s*)+/g, '… ').trim();
  return s.replace(/\s+([?.!,])/g, '$1');
}

/**
 * The map's items from the content: the word list, the phrases (chunks) and the grammar concepts.
 * @param {{words: any[], chunks: Record<string, {t: string}>, chunksEn: any[], prio?: Record<string, any>, concepts: any[], clusters: any}} c
 * @returns {Item[]}
 */
export function itemsFrom({ words, chunks, chunksEn, prio = {}, concepts, clusters }) {
  /** @type {Item[]} */ const out = [];
  const core = clusters?.topics?.core || {}, chunkTopic = clusters?.topics?.chunks || {};
  for (const w of words) {
    out.push({ id: `W:${w.id}`, t: w.w, a: w.pos === 'noun' && ARTICLES.includes(w.art) ? w.art : '', k: 'w', L: w.level, p: w.pos, f: w.zipf || 0, r: w.rank || 0,
      topic: core[w.id] || (w.theme && w.theme !== 'core' ? w.theme : undefined) });
  }
  const en = new Map(chunksEn.map(c => [c.id, c]));
  const ids = Object.keys(chunks).sort();
  for (const id of ids) {
    const e = en.get(id) || {};
    const p = prio[id], pr = typeof p === 'object' && p ? p.prio : p;
    out.push({ id: `K:${id}`, t: chunkText(chunks[id].t), a: '', k: 'c', L: e.cefr_level || e.level || 'B1', p: 'phrase', f: pr === 1 ? 5 : pr === 2 ? 4 : 3,
      r: Number(String(id).split('_').pop()) || 0, topic: chunkTopic[id] });
  }
  concepts.forEach((g, i) => out.push({ id: `GC:${g.id}`, t: g.name, a: '', k: 'g', L: g.level, p: 'grammar', f: 4, r: i + 1 }));
  return out;
}

/* ---------------------------------------------------------------- grouping */

const lvl = (/** @type {string} */ L) => { const i = LEVELS.indexOf(L); return i < 0 ? 9 : i; };
/** The paragraph order: level, then words before phrases before grammar, then frequency, then rank and id. */
export const seqCompare = (/** @type {Item} */ x, /** @type {Item} */ y) =>
  lvl(x.L) - lvl(y.L) || KINDS.indexOf(x.k) - KINDS.indexOf(y.k) || y.f - x.f || x.r - y.r || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0);

/** The word-type group of an item. @param {Item} it */
export function typeOf(it) {
  if (it.k === 'c') return 'phrase';
  if (it.k === 'g') return 'grammar';
  if (it.p === 'noun') return it.a || 'other';
  if (['verb', 'adj', 'adv', 'prep', 'conj'].includes(it.p)) return it.p;
  if (it.p === 'phrase') return 'setphrase';
  return 'other';
}

/**
 * @typedef {object} GroupSpec
 * @property {string} key       'topic:food', 'family:fallen', 'opp:place', 'level:B1', 'type:der', 'source:exam'
 * @property {string} label     a content label (topics, families, opposites); others are named by the view (t())
 * @property {string | null} cluster   the Practice cluster key with the same words ('topic:food'), or null
 * @property {string[][]} units item ids: one per word, two per opposite pair
 */

/**
 * The groups of a built mode, from the items and the clusters content. One place per item per mode; an item that has
 * no group in a mode is not on that map.
 * @param {Exclude<Mode, 'source'>} mode @param {Item[]} items @param {any} clusters
 * @returns {GroupSpec[]}
 */
export function groupsFor(mode, items, clusters) {
  const byId = new Map(items.map(it => [it.id, it]));
  const sorted = (/** @type {string[]} */ ids) => ids.filter(id => byId.has(id)).sort((a, b) => seqCompare(/** @type {Item} */ (byId.get(a)), /** @type {Item} */ (byId.get(b))));
  const one = (/** @type {string[]} */ ids) => ids.map(id => [id]);
  if (mode === 'topic') {
    /** @type {Map<string, string[]>} */ const m = new Map();
    for (const it of items) { const k = it.k === 'g' ? 'grammar' : it.topic; if (!k) continue; if (!m.has(k)) m.set(k, []); /** @type {string[]} */ (m.get(k)).push(it.id); }
    const list = [...(clusters?.topics?.list || []).map((/** @type {any} */ t) => ({ id: t.id, label: t.label })), { id: 'grammar', label: 'Grammar' }];
    return list.filter(t => m.has(t.id)).map(t => ({ key: `topic:${t.id}`, label: t.label, cluster: t.id === 'grammar' ? null : `topic:${t.id}`, units: one(sorted(/** @type {string[]} */ (m.get(t.id)))) }));
  }
  if (mode === 'family') {
    return (clusters?.families || []).map((/** @type {any} */ f) => {
      const rest = sorted(f.members.filter((/** @type {string} */ m) => m !== f.head).map((/** @type {string} */ m) => `W:${m}`));
      return { key: `family:${f.id}`, label: f.label, cluster: `family:${f.id}`, units: one([`W:${f.head}`, ...rest].filter(id => byId.has(id))) };
    }).filter((/** @type {GroupSpec} */ g) => g.units.length).sort((/** @type {GroupSpec} */ a, /** @type {GroupSpec} */ b) => b.units.length - a.units.length || (a.key < b.key ? -1 : 1));
  }
  if (mode === 'opp') {
    const pairs = (clusters?.opposites?.pairs || []).filter((/** @type {any} */ p) => p.primary && byId.has(`W:${p.a}`) && byId.has(`W:${p.b}`));
    return (clusters?.opposites?.groups || []).map((/** @type {any} */ g) => ({ key: `opp:${g.id}`, label: g.label, cluster: `opp:${g.id}`,
      units: pairs.filter((/** @type {any} */ p) => p.group === g.id).map((/** @type {any} */ p) => [`W:${p.a}`, `W:${p.b}`]) })).filter((/** @type {GroupSpec} */ g) => g.units.length);
  }
  if (mode === 'level') {
    return LEVELS.map(L => ({ key: `level:${L}`, label: L, cluster: null, units: one(sorted(items.filter(it => it.L === L).map(it => it.id))) })).filter(g => g.units.length);
  }
  if (mode === 'type') {
    return TYPE_GROUPS.map(k => ({ key: `type:${k}`, label: k, cluster: null, units: one(sorted(items.filter(it => typeOf(it) === k).map(it => it.id))) })).filter(g => g.units.length);
  }
  throw new Error(`no built groups for mode ${mode}`);
}

/**
 * The Source groups: each item that has been met sits in its first source (SOURCE_GROUPS order); inside a group,
 * items in the order they were first met (then the paragraph order), so a group only grows at its end.
 * @param {Item[]} items @param {(id: string) => {sources: string[]}} scoreOf @param {(id: string) => string} [firstOf] first-met day, '' unknown
 * @returns {GroupSpec[]}
 */
export function sourceGroups(items, scoreOf, firstOf = () => '') {
  /** @type {Map<string, Item[]>} */ const m = new Map(SOURCE_GROUPS.map(s => [s, []]));
  for (const it of items) {
    const src = scoreOf(it.id).sources || [];
    const g = SOURCE_GROUPS.find(s => src.includes(s));
    if (g) /** @type {Item[]} */ (m.get(g)).push(it);
  }
  return SOURCE_GROUPS.filter(s => /** @type {Item[]} */ (m.get(s)).length).map(s => {
    const list = /** @type {Item[]} */ (m.get(s)).map(it => ({ it, d: firstOf(it.id) || '9999' }));
    list.sort((x, y) => (x.d < y.d ? -1 : x.d > y.d ? 1 : seqCompare(x.it, y.it)));
    return { key: `source:${s}`, label: s, cluster: null, units: list.map(x => [x.it.id]) };
  });
}

/* ---------------------------------------------------------------- setting a paragraph in a disc */

/**
 * @typedef {object} Placed
 * @property {string} key
 * @property {string} label
 * @property {string | null} cluster
 * @property {number} x        disc centre (world units, integer)
 * @property {number} y
 * @property {number} r        disc radius (integer)
 * @property {number} y0       baseline of the first line, relative to the centre
 * @property {string[]} ids    items in paragraph order
 * @property {number[]} ix     each item's left edge relative to the centre, in tenths of a unit
 * @property {number[]} ln     each item's line (0 = the first)
 * @property {number[]} pair   index (in ids) of the item's pair partner, -1 for none
 */

/**
 * Set units in a disc of radius R, lines from the top. Returns null when they do not fit.
 * @param {number[][]} unitsW unit widths (tenths): [w] or [w1, w2] @param {number} R @param {number} [startLine] first free line (appending)
 * @param {number} [yTop] baseline of line 0 (relative to the centre)
 */
function setLines(unitsW, R, startLine = 0, yTop = -R + LH * 0.7) {
  /** @type {{line: number, x: number[]}[]} */ const out = [];
  let k = 0;
  for (let li = startLine; k < unitsW.length; li++) {
    const y = yTop + li * LH - FS * 0.32;             // the middle of the x-height
    if (y > R - LH * 0.3) return null;
    const yy = Math.abs(y) + FS * 0.35;               // the glyphs' edge farther from the centre
    const avail = 2 * (Math.sqrt(Math.max(0, R * R - yy * yy)) - 6) * 10;
    /** @type {number[][]} */ const line = []; let w = 0;
    while (k < unitsW.length) {
      const u = unitsW[k], uw = unitW(u), g = line.length ? gapOf(u) : 0;
      if (line.length && w + g + uw > avail) break;
      if (!line.length && uw > avail) break;
      w += g + uw; line.push(u); k++;
    }
    if (!line.length) continue;
    // centre the line; x per item (left edge, tenths)
    let x = -w / 2; const xs = [];
    for (let j = 0; j < line.length; j++) {
      const u = line[j];
      if (j) x += gapOf(u);
      xs.push(Math.round(x)); if (u.length === 2) xs.push(Math.round(x + u[0] + PAIR_IN * 10));
      x += unitW(u);
    }
    out.push({ line: li, x: xs });
  }
  return out;
}
/** @param {number[]} u */ const unitW = u => (u.length === 2 ? u[0] + PAIR_IN * 10 + u[1] : u[0]);
/** @param {number[]} u */ const gapOf = u => (u.length === 2 ? PAIR_GAP : GAP) * 10;

/**
 * Lay out one group in a fresh disc: the smallest radius (3 % steps) its paragraph fits in, the lines centred
 * vertically, then HEAD headroom on the radius.
 * @param {number[][]} unitsW
 */
function freshDisc(unitsW) {
  let area = 0; for (const u of unitsW) area += ((unitW(u) + gapOf(u)) / 10) * LH;
  let R = Math.max(44, Math.sqrt(area / Math.PI) * 1.04);
  for (let tries = 0; tries < 80; tries++, R *= 1.03) {
    const lines = setLines(unitsW, R);
    if (!lines) continue;
    const span = lines[lines.length - 1].line - lines[0].line;
    // centre the block: the first baseline such that the block's middle is the disc's middle
    const y0 = Math.round(-(span * LH) / 2 + FS * 0.32);
    const again = setLines(unitsW, R, 0, y0);
    if (!again) continue;
    return { r: Math.ceil(R * HEAD), y0, lines: again };
  }
  throw new Error('a group did not fit in its disc');
}

/**
 * Lay out groups: set each paragraph in its disc and place the discs on the spiral. With `previous` (the last map of
 * this mode), every item and disc already there stays put; new items take new lines at the end of their paragraph and
 * new groups take free places on the spiral. Throws when an existing group no longer fits its disc (repack needed).
 * @param {GroupSpec[]} groups @param {Map<string, number>} widthById  item id → width (tenths)
 * @param {{previous?: Placed[] | null}} [o]
 * @returns {Placed[]}
 */
export function layoutGroups(groups, widthById, { previous = null } = {}) {
  const prev = new Map((previous || []).map(g => [g.key, g]));
  const W = (/** @type {string} */ id) => { const w = widthById.get(id); if (w == null) throw new Error(`no width for ${id}`); return w; };
  /** @type {Placed[]} */ const out = [];
  for (const g of groups) {
    const p = prev.get(g.key);
    if (p) { out.push(extend(p, g, W)); continue; }
    const unitsW = g.units.map(u => u.map(W));
    const d = freshDisc(unitsW);
    out.push(fromLines({ key: g.key, label: g.label, cluster: g.cluster, x: 0, y: 0, r: d.r, y0: d.y0 }, g.units, d.lines));
  }
  pack(out, new Set(prev.keys()));
  return out;
}

/**
 * @param {{key: string, label: string, cluster: string | null, x: number, y: number, r: number, y0: number}} base
 * @param {string[][]} units @param {{line: number, x: number[]}[]} lines
 * @returns {Placed}
 */
function fromLines(base, units, lines) {
  /** @type {string[]} */ const ids = []; /** @type {number[]} */ const ix = [], ln = [], pair = [];
  let u = 0;
  for (const l of lines) {
    let j = 0;
    while (j < l.x.length) {
      const unit = units[u++];
      for (let q = 0; q < unit.length; q++) { ids.push(unit[q]); ix.push(l.x[j + q]); ln.push(l.line); pair.push(unit.length === 2 ? ids.length - 1 + (q ? -1 : 1) : -1); }
      j += unit.length;
    }
  }
  return { ...base, ids, ix, ln, pair };
}

/**
 * Lay out the Source groups on the device. Each disc's radius is a step of a fixed ladder (60 units x 1.25^n) big
 * enough for its paragraph, and lines run from the top, so an item met later only extends the last lines: nothing
 * moves until a group crosses to the next step (then that map is laid out again, a rare event).
 * @param {GroupSpec[]} groups @param {Map<string, number>} widthById
 * @returns {Placed[]}
 */
export function layoutSource(groups, widthById) {
  const W = (/** @type {string} */ id) => { const w = widthById.get(id); if (w == null) throw new Error(`no width for ${id}`); return w; };
  /** @type {Placed[]} */ const out = [];
  for (const g of groups) {
    const unitsW = g.units.map(u => u.map(W));
    let area = 0; for (const u of unitsW) area += ((unitW(u) + gapOf(u)) / 10) * LH;
    let step = Math.max(0, Math.ceil(Math.log((Math.sqrt(area / Math.PI) * 1.12) / 60) / Math.log(1.25)));
    for (;; step++) {
      const R = Math.round(60 * 1.25 ** step), y0 = Math.round(-R + LH * 1.2);
      const lines = setLines(unitsW, R, 0, y0);
      if (lines) { out.push(fromLines({ key: g.key, label: g.label, cluster: g.cluster, x: 0, y: 0, r: R, y0 }, g.units, lines)); break; }
    }
  }
  pack(out, new Set());
  return out;
}

/**
 * Keep a group's existing items where they are; append new ones on new lines. Units whose items are all gone are
 * dropped (their places stay empty until a repack).
 * @param {Placed} p @param {GroupSpec} g @param {(id: string) => number} W
 */
function extend(p, g, W) {
  const have = new Set(p.ids);
  const still = new Set(g.units.flat());
  const keep = { ids: /** @type {string[]} */ ([]), ix: /** @type {number[]} */ ([]), ln: /** @type {number[]} */ ([]), pair: /** @type {number[]} */ ([]) };
  const remap = new Map();
  p.ids.forEach((id, i) => { if (still.has(id)) { remap.set(i, keep.ids.length); keep.ids.push(id); keep.ix.push(p.ix[i]); keep.ln.push(p.ln[i]); keep.pair.push(p.pair[i]); } });
  keep.pair = keep.pair.map(j => (j >= 0 && remap.has(j) ? /** @type {number} */ (remap.get(j)) : -1));
  const fresh = g.units.filter(u => u.every(id => !have.has(id)));
  const base = { key: p.key, label: g.label, cluster: g.cluster, x: p.x, y: p.y, r: p.r, y0: p.y0 };
  if (!fresh.length) return { ...base, ...keep };
  const next = keep.ln.length ? Math.max(...keep.ln) + 1 : 0;
  const lines = setLines(fresh.map(u => u.map(W)), p.r, next, p.y0);
  if (!lines) throw new Error(`group ${p.key} has no room for ${fresh.length} new item(s): repack the map (node tools/build-atlas.mjs --repack)`);
  const add = fromLines({ ...base }, fresh, lines);
  const off = keep.ids.length;
  return { ...base, ids: [...keep.ids, ...add.ids], ix: [...keep.ix, ...add.ix], ln: [...keep.ln, ...add.ln], pair: [...keep.pair, ...add.pair.map(j => (j >= 0 ? j + off : -1))] };
}

/**
 * Place discs on an Archimedean spiral, largest first (ties: list order), each at the first point clear of the others.
 * Discs whose key is in `fixed` keep their place.
 * @param {Placed[]} discs @param {Set<string>} fixed
 */
function pack(discs, fixed) {
  /** @type {Placed[]} */ const placed = discs.filter(d => fixed.has(d.key));
  const order = discs.map((d, i) => i).filter(i => !fixed.has(discs[i].key)).sort((a, b) => discs[b].r - discs[a].r || a - b);
  for (const i of order) {
    const d = discs[i];
    if (!placed.length) { d.x = 0; d.y = 0; placed.push(d); continue; }
    for (let t = 0; ; t += 0.05) {
      const s = 14 * t, x = Math.round(s * Math.cos(t)), y = Math.round(s * Math.sin(t));
      if (placed.every(p => Math.hypot(p.x - x, p.y - y) >= p.r + d.r + margin(p.r, d.r))) { d.x = x; d.y = y; placed.push(d); break; }
    }
  }
}
/** Space between two discs: grows with their size, so big neighbours keep their rings apart. @param {number} a @param {number} b */
export const margin = (a, b) => Math.min(110, 26 + 0.22 * (a + b));

/* ---------------------------------------------------------------- the shipped file */

/**
 * Serialise a built map (content/atlas/<lang>.json): the item table (columns) and, per mode, the placed groups with
 * item indices into the table. Positions are integers: ix in tenths of a unit.
 * @param {{items: Item[], widths: Map<string, {w: number, aw: number}>, modes: Record<string, Placed[]>, font: any}} m
 */
export function serialise({ items, widths, modes, font }) {
  const index = new Map(items.map((it, i) => [it.id, i]));
  const cols = { id: /** @type {string[]} */ ([]), t: /** @type {string[]} */ ([]), a: /** @type {number[]} */ ([]), k: /** @type {number[]} */ ([]), L: /** @type {number[]} */ ([]),
    p: /** @type {string[]} */ ([]), f: /** @type {number[]} */ ([]), w: /** @type {number[]} */ ([]), aw: /** @type {number[]} */ ([]) };
  for (const it of items) {
    const wd = /** @type {{w: number, aw: number}} */ (widths.get(it.id));
    cols.id.push(it.id); cols.t.push(textFromId(it.id) === it.t ? '' : it.t); cols.a.push(ARTICLES.indexOf(it.a)); cols.k.push(KINDS.indexOf(it.k)); cols.L.push(lvl(it.L));
    cols.p.push(it.p); cols.f.push(Math.round(it.f * 100)); cols.w.push(wd.w); cols.aw.push(wd.aw);
  }
  /** @type {Record<string, any[]>} */ const out = {};
  for (const [mode, groups] of Object.entries(modes)) {
    out[mode] = groups.map(g => ({ key: g.key, label: g.label, cluster: g.cluster, x: g.x, y: g.y, r: g.r, y0: g.y0,
      items: g.ids.map(id => /** @type {number} */ (index.get(id))), dx: deltas(g.ids.map(id => /** @type {{w: number}} */ (widths.get(id)).w), g.ix, g.ln), ln: g.ln,
      pair: g.pair.some(p => p >= 0) ? g.pair : undefined }));
  }
  const body = { version: 1, font, unit: { fs: FS, lh: LH, art: ART }, items: cols, modes: out };
  // one group per line, so a map release reads as a diff of the groups that changed
  const lines = [`{"version":1,"font":${JSON.stringify(font)},"unit":${JSON.stringify(body.unit)},`, `"items":{`];
  lines.push(Object.entries(cols).map(([k, v]) => `${JSON.stringify(k)}:${JSON.stringify(v)}`).join(',\n'));
  lines.push('},"modes":{');
  lines.push(Object.entries(out).map(([mode, gs]) => `${JSON.stringify(mode)}:[\n${gs.map(g => JSON.stringify(g)).join(',\n')}\n]`).join(',\n'));
  lines.push('}}');
  return `${lines.join('\n')}\n`;
}

/**
 * x positions as the file stores them: the first item of a line absolute, every other one as its distance from the
 * end of the item before it (the gap, which repeats, so the file compresses well). @param {number[]} w @param {number[]} ix @param {number[]} ln
 */
function deltas(w, ix, ln) {
  return ix.map((x, j) => (j && ln[j] === ln[j - 1] ? x - (ix[j - 1] + w[j - 1]) : x));
}
/** @param {number[]} w @param {number[]} dx @param {number[]} ln */
function undelta(w, dx, ln) {
  /** @type {number[]} */ const ix = [];
  dx.forEach((d, j) => ix.push(j && ln[j] === ln[j - 1] ? ix[j - 1] + w[j - 1] + d : d));
  return ix;
}

/** A word's text from its id when the file leaves it out ('W:die_Zeitung' → 'Zeitung', 'W:sein.verb' → 'sein'). @param {string} id */
export function textFromId(id) {
  if (!id.startsWith('W:')) return null;
  const s = id.slice(2);
  return s.includes('_') && !s.includes('.') ? s.slice(s.indexOf('_') + 1) : s.replace(/\.[a-z]+$/, '');
}

/**
 * Decode a map file: the item table (texts filled in) and each mode's groups with absolute item x (tenths).
 * @param {any} file
 */
export function decode(file) {
  const I = file.items;
  const t = I.t.map((/** @type {string} */ s, /** @type {number} */ i) => s || textFromId(I.id[i]) || '');
  /** @type {Record<string, any[]>} */ const modes = {};
  for (const [mode, gs] of Object.entries(file.modes || {})) {
    modes[mode] = /** @type {any[]} */ (gs).map(g => ({ ...g, ix: undelta(g.items.map((/** @type {number} */ i) => I.w[i]), g.dx, g.ln) }));
  }
  return { ...file, items: { ...I, t }, modes };
}

/**
 * Read a serialised map back into Placed groups (ids instead of indices), for a rebuild that keeps positions.
 * @param {any} file @returns {Record<string, Placed[]>}
 */
export function placedFrom(file) {
  const d = decode(file), ids = d.items.id;
  /** @type {Record<string, Placed[]>} */ const out = {};
  for (const [mode, gs] of Object.entries(d.modes)) {
    out[mode] = gs.map((/** @type {any} */ g) => ({ key: g.key, label: g.label, cluster: g.cluster, x: g.x, y: g.y, r: g.r, y0: g.y0,
      ids: g.items.map((/** @type {number} */ i) => ids[i]), ix: g.ix, ln: g.ln, pair: g.pair || g.items.map(() => -1) }));
  }
  return out;
}

/**
 * World positions for a mode: per item index, left edge x and baseline y (NaN when the item is not in this mode), its
 * group index, and its pair partner (item index, -1). Allocation-light: called once per mode.
 * @param {{x: number, y: number, y0: number, items: number[], ix: number[], ln: number[], pair?: number[]}[]} groups
 * @param {number} n number of items
 */
export function positions(groups, n) {
  const X = new Float32Array(n).fill(NaN), Y = new Float32Array(n).fill(NaN), G = new Int32Array(n).fill(-1), P = new Int32Array(n).fill(-1);
  groups.forEach((g, gi) => {
    for (let j = 0; j < g.items.length; j++) {
      const i = g.items[j];
      X[i] = g.x + g.ix[j] / 10; Y[i] = g.y + g.y0 + g.ln[j] * LH; G[i] = gi;
      if (g.pair && g.pair[j] >= 0) P[i] = g.items[g.pair[j]];
    }
  });
  return { X, Y, G, P };
}

/** Bounds of a mode's discs. @param {{x: number, y: number, r: number}[]} groups */
export function bounds(groups) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const g of groups) { x0 = Math.min(x0, g.x - g.r); x1 = Math.max(x1, g.x + g.r); y0 = Math.min(y0, g.y - g.r); y1 = Math.max(y1, g.y + g.r); }
  return groups.length ? { x0, y0, x1, y1 } : { x0: -100, y0: -100, x1: 100, y1: 100 };
}

/* ---------------------------------------------------------------- encodings */

/** @typedef {'known'|'shaky'|'unknown'|'unseen'} State */
/**
 * How a state is drawn (DESIGN.md, Explore). Ink is the scale and shape is the second channel: nothing depends on hue.
 *   ink     the colour token for the text and the bar
 *   italic  text set in italic (not seen)
 *   box     an open box around the text, an outlined bar at far zoom (not known: the slot still to be filled)
 *   under   a hairline under the word (practised today, so the accent is never the only signal)
 *   bar     'fill' | 'outline' | 'faint' at far zoom
 * @param {State} state @param {boolean} [today]
 */
export function encode(state, today = false) {
  if (today) return { state, today: true, ink: 'x-today', italic: false, box: false, under: true, bar: 'fill', label: 'today' };
  switch (state) {
    case 'known': return { state, today: false, ink: 'x-known', italic: false, box: false, under: false, bar: 'fill', label: 'known' };
    case 'shaky': return { state, today: false, ink: 'x-shaky', italic: false, box: false, under: false, bar: 'fill', label: 'shaky' };
    case 'unknown': return { state, today: false, ink: 'x-unknown', italic: false, box: true, under: false, bar: 'outline', label: 'unknown' };
    default: return { state: 'unseen', today: false, ink: 'x-new', italic: true, box: false, under: false, bar: 'faint', label: 'unseen' };
  }
}
/** Drawing order for state batches (one font and colour per batch): faint first, the accent last. */
export const STATE_ORDER = /** @type {const} */ (['unseen', 'unknown', 'shaky', 'known']);
/** A state as a small integer, for typed arrays. */
export const STATE_CODE = /** @type {Record<State, number>} */ ({ unseen: 0, unknown: 1, shaky: 2, known: 3 });

/* ---------------------------------------------------------------- group numbers */

/**
 * Counts and the frequency-weighted share known (the "study next" weight, like readiness.gaps()): known counts 1,
 * shaky 0.5.
 * @param {string[]} ids @param {(id: string) => {state: State, today?: boolean}} get @param {(id: string) => number} weight
 */
export function summarise(ids, get, weight) {
  const s = { n: ids.length, known: 0, shaky: 0, unknown: 0, unseen: 0, today: 0, score: 0 };
  let W = 0, got = 0;
  for (const id of ids) {
    const x = get(id); s[x.state]++; if (x.today) s.today++;
    const w = weight(id) || 1; W += w; got += w * (x.state === 'known' ? 1 : x.state === 'shaky' ? 0.5 : 0);
  }
  s.score = W ? got / W : 0;
  return s;
}

/**
 * What to study next in a group: items not known, not known first, then shaky, then not seen, each by frequency.
 * @param {string[]} ids @param {(id: string) => {state: State}} get @param {(id: string) => number} weight @param {number} [n]
 */
export function nextUp(ids, get, weight, n = 10) {
  const tier = /** @type {Record<State, number>} */ ({ unknown: 0, shaky: 1, unseen: 2, known: 9 });
  return ids.map((id, i) => ({ id, i, t: tier[get(id).state] })).filter(x => x.t < 9)
    .sort((a, b) => a.t - b.t || weight(b.id) - weight(a.id) || a.i - b.i).slice(0, n).map(x => x.id);
}
