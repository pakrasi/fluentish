/* Igloo level readiness. Pure functions over plain objects; no DOM, no storage. Used by app.js and tests/unit/readiness.test.mjs.

   Pools (build with Readiness.pools(...)):
     words:    [{id:'W:<id>', level, w: zipf || 1, group: theme}]
     chunks:   [{id:'K:<id>', level, w: 3|2|1 for prio 1|2|3, group: function}]
     concepts: [{id, level, name, sticky, items:['G:<itemId>', ...]}]   (only concepts that have items)
   Context: {know, srs, lang, today}. know/srs are the stores keyed "<lang>|<id>" (doors.know.v1, doors.srs.v1).

   readiness(L) = 0.35·words + 0.35·chunks + 0.30·grammar. A pool with no items at L drops out and the other
   weights are rescaled, so a missing word list doesn't cap the score at 65%. */
const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
const WEIGHTS = { words: 0.35, chunks: 0.35, grammar: 0.30 };
const Z80 = 1.2816;   // two-sided 80% interval
const CREDIT = { solid: 1, known: 1, shaky: 0.5, unknown: 0 };

// State of one item: 'solid' | 'known' | 'shaky' | 'unknown', or null when never tested.
// solid = SRS interval of 21+ days. Items drilled before the test existed count from their SRS record alone.
function itemState(rec, s) {
  if (s && s.reps && s.ivl >= 21) return 'solid';
  if (rec && rec.s) return rec.s;
  if (s && s.reps && s.ivl >= 7) return 'known';
  return null;
}
const credit = st => CREDIT[st] || 0;

// Grammar concept: known at >= 80% correct over >= 8 attempts with >= 2 in the last 30 days; shaky at >= 50%.
function conceptState(recs, today) {
  let n = 0, ok = 0, recent = 0;
  for (const r of recs) {
    if (!r) continue;
    for (const [day, good] of r.hist || []) { n++; if (good) ok++; if (today - day <= 30) recent++; }
  }
  if (!n) return { state: null, n, ok, pct: 0 };
  const pct = ok / n;
  const state = pct >= 0.8 && n >= 8 && recent >= 2 ? 'known' : pct >= 0.5 ? 'shaky' : 'unknown';
  return { state, n, ok, pct };
}

function wilson(p, n, z = Z80) {
  if (!n) return [0, 1];
  const z2 = z * z, d = 1 + z2 / n;
  const mid = (p + z2 / (2 * n)) / d;
  const half = (z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n))) / d;
  return [Math.max(0, mid - half), Math.min(1, mid + half)];
}

const get = (ctx, id) => ({ rec: ctx.know?.[`${ctx.lang}|${id}`], s: ctx.srs?.[`${ctx.lang}|${id}`] });

// One pool at one level: plain score (untested = 0), weighted coverage, tested-sample mean and an estimate range.
// units: [{w, credit, tested, count}] where count is how many items the unit stands for (1 for words/chunks).
function poolStats(units) {
  let W = 0, Wt = 0, got = 0, gotT = 0, nT = 0, items = 0, itemsT = 0;
  for (const u of units) {
    W += u.w; items += u.count;
    if (u.tested) { Wt += u.w; got += u.w * u.credit; gotT += u.w * u.credit; nT++; itemsT += u.testedCount ?? u.count; }
  }
  if (!W) return null;
  const score = got / W, cov = Wt / W, mean = Wt ? gotT / Wt : 0;
  const [wl, wh] = wilson(mean, nT);
  // untested items are assumed to go like the tested ones, within the interval
  const lo = score + (1 - cov) * wl, hi = score + (1 - cov) * wh;
  return { score, coverage: cov, mean, tested: itemsT, total: items, units: units.length, unitsTested: nT, lo, hi };
}

function wordUnits(pools, L, ctx) {
  return pools.words.filter(x => x.level === L).map(x => { const { rec, s } = get(ctx, x.id); const st = itemState(rec, s); return { id: x.id, group: x.group, w: x.w || 1, credit: credit(st), tested: st != null, count: 1, state: st }; });
}
function chunkUnits(pools, L, ctx) {
  return pools.chunks.filter(x => x.level === L).map(x => { const { rec, s } = get(ctx, x.id); const st = itemState(rec, s); return { id: x.id, group: x.group, w: x.w || 1, credit: credit(st), tested: st != null, count: 1, state: st }; });
}
function conceptUnits(pools, L, ctx) {
  return pools.concepts.filter(c => c.level === L && c.items.length).map(c => {
    const recs = c.items.map(id => get(ctx, id).rec);
    const cs = conceptState(recs, ctx.today);
    return { id: c.id, group: c.id, name: c.name, w: 1, credit: credit(cs.state), tested: cs.state != null, count: c.items.length, testedCount: recs.filter(Boolean).length, state: cs.state, attempts: cs.n, pct: cs.pct };
  });
}

function level(pools, L, ctx) {
  const parts = { words: poolStats(wordUnits(pools, L, ctx)), chunks: poolStats(chunkUnits(pools, L, ctx)), grammar: poolStats(conceptUnits(pools, L, ctx)) };
  const live = Object.keys(parts).filter(k => parts[k]);
  const wsum = live.reduce((a, k) => a + WEIGHTS[k], 0);
  if (!wsum) return { level: L, empty: true, score: 0, coverage: 0, estimate: { lo: 0, hi: 0 }, parts, tested: 0, total: 0 };
  let score = 0, lo = 0, hi = 0, tested = 0, total = 0;
  for (const k of live) {
    const f = WEIGHTS[k] / wsum, p = parts[k];
    score += f * p.score; lo += f * p.lo; hi += f * p.hi; tested += p.tested; total += p.total;
  }
  return { level: L, empty: false, score, coverage: total ? tested / total : 0, estimate: { lo, hi }, parts, tested, total };
}

// All levels, plus `reachable`: every lower level at 80% or more (the low end of its estimate, which equals the
// score once everything is tested). Levels with no items are skipped in that check.
function all(pools, ctx, levels = LEVELS) {
  const out = {};
  for (const L of levels) out[L] = level(pools, L, ctx);
  levels.forEach((L, i) => {
    out[L].reachable = levels.slice(0, i).every(lower => out[lower].empty || out[lower].estimate.lo >= 0.8);
  });
  return out;
}

// The 3 lowest-scoring word themes, grammar concepts or chunk functions at L that have 5+ items and at least one
// tested. Score = weighted credit over the group's items (untested = 0).
function gaps(pools, L, ctx, n = 3) {
  const groups = [];
  const add = (kind, units) => {
    const by = new Map();
    for (const u of units) { if (!by.has(u.group)) by.set(u.group, []); by.get(u.group).push(u); }
    for (const [g, us] of by) {
      if (g == null || g === '') continue;
      const W = us.reduce((a, u) => a + u.w, 0);
      const tested = us.filter(u => u.tested).length;
      if (us.length < 5 || !tested) continue;
      groups.push({ kind, id: g, n: us.length, tested, score: us.reduce((a, u) => a + u.w * u.credit, 0) / W, ids: us.map(u => u.id) });
    }
  };
  add('words', wordUnits(pools, L, ctx));
  add('chunks', chunkUnits(pools, L, ctx));
  // concepts: one group each, over its items
  for (const c of pools.concepts.filter(c => c.level === L && c.items.length >= 5)) {
    const units = c.items.map(id => { const { rec, s } = get(ctx, id); const st = itemState(rec, s); return { w: 1, credit: credit(st), tested: st != null }; });
    const tested = units.filter(u => u.tested).length;
    if (!tested) continue;
    groups.push({ kind: 'grammar', id: c.id, name: c.name, n: units.length, tested, score: units.reduce((a, u) => a + u.credit, 0) / units.length, ids: c.items.slice() });
  }
  return groups.sort((a, b) => a.score - b.score || b.n - a.n).slice(0, n);
}

// Build pools from the raw data files. Any argument may be missing.
//  words: content/igloo/words/de.json; chunksEn: content/igloo/chunks/en.json; chunksDe: content/igloo/chunks/german.json .chunks;
//  priority: content/igloo/chunks/priority_de.json; concepts: content/igloo/grammar/concepts_de.json; items: content/igloo/grammar/items_de.json
function pools({ words = [], chunksEn = [], chunksDe = {}, priority = null, concepts = [], items = [] } = {}) {
  const prio = (priority && priority.prio) || {};
  const fnOf = functionMap(priority);
  const P = id => { const v = prio[id]; const n = typeof v === 'object' && v ? v.prio : v; return n === 1 || n === 2 ? n : 3; };
  const byConcept = new Map();
  for (const it of items || []) { if (!it || !it.concept) continue; if (!byConcept.has(it.concept)) byConcept.set(it.concept, []); byConcept.get(it.concept).push('G:' + it.id); }
  return {
    words: (words || []).filter(w => w && w.id && LEVELS.includes(w.level)).map(w => ({ id: 'W:' + w.id, level: w.level, w: w.zipf > 0 ? w.zipf : 1, group: w.theme || '' })),
    chunks: (chunksEn || []).filter(c => c && chunksDe && chunksDe[c.id] && LEVELS.includes(c.level || c.cefr_level)).map(c => {
      const pr = P(c.id);
      return { id: 'K:' + c.id, level: c.level || c.cefr_level, w: 4 - pr, prio: pr, group: fnOf[c.id] || c.category || '' };
    }),
    concepts: (concepts || []).filter(c => c && LEVELS.includes(c.level)).map(c => ({ id: c.id, level: c.level, name: c.name, sticky: !!c.sticky, items: byConcept.get(c.id) || [] })),
  };
}
// priority_de.json "functions" may be [{id, en|name, chunk_ids|ids: [...]}] or {name: [...]}; prio entries may carry {fn}.
function functionMap(priority) {
  const out = {};
  if (!priority) return out;
  const f = priority.functions;
  if (Array.isArray(f)) for (const x of f) {
    if (!x || typeof x !== 'object') continue;
    const name = x.name || x.label || x.en || x.id; const ids = x.ids || x.chunk_ids || x.chunks || x.members || [];
    for (const id of ids) out[id] = name;
  } else if (f && typeof f === 'object') for (const [name, ids] of Object.entries(f)) if (Array.isArray(ids)) for (const id of ids) out[id] = name;
  for (const [id, v] of Object.entries(priority.prio || {})) if (v && typeof v === 'object' && (v.fn || v.function)) out[id] = v.fn || v.function;
  return out;
}

const api = { LEVELS, WEIGHTS, CREDIT, itemState, credit, conceptState, wilson, level, all, gaps, pools, functionMap };
export default api;
export { LEVELS, WEIGHTS, CREDIT, itemState, credit, conceptState, wilson, level, all, gaps, pools, functionMap };
