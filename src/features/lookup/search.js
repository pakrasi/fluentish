/* Look up: the search index. Pure (no DOM), tested in node (tests/unit/lookup-search.test.mjs).

   fold(text)                 lower case, accents and umlauts dropped (ä → a), ß → ss, with a map back to the original
                              positions so a match can be highlighted in the text as written
   buildIndex(docs)           folds every doc once; docs are {id, tab, title, sub?, extra?, rank?, ref?}
   search(index, q, o)        every word of the query must match; ranked: exact title, title starts with, a title word
                              starts with, title contains, other fields; then by doc.rank. "ue"/"ae"/"oe" typed for
                              ü/ä/ö also match ("uebung" finds "Übung").
   matchRanges(text, q)       [start, end) ranges of the query words in `text`, merged, for <mark>
   countByTab(hits)           { tab: n } */

/**
 * @typedef {object} Doc
 * @property {string} id
 * @property {string} tab        'words' | 'phrases' | 'grammar' | 'frames'
 * @property {string} title      the German text (what the row shows first)
 * @property {string} [sub]      the English meaning
 * @property {string} [extra]    notes, examples, other forms
 * @property {number} [rank]     lower first among equal matches
 * @property {any} [ref]         the row the doc came from
 */
/** @typedef {Doc & {_t: string, _s: string}} IndexedDoc */

/**
 * @param {string} text
 * @returns {{f: string, map: number[]}} the folded text and, for each of its code units, the index in `text`
 */
export function fold(text) {
  const s = String(text ?? '');
  let f = '';
  /** @type {number[]} */ const map = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    let d;
    if (c === 'ß' || c === 'ẞ') d = 'ss';
    else {
      d = c.toLowerCase();
      if (d.charCodeAt(0) > 127) d = d.normalize('NFD').replace(/\p{M}/gu, '');
    }
    for (let j = 0; j < d.length; j++) { f += d[j]; map.push(i); }
  }
  return { f, map };
}

/** Folded text only. @param {string} text */
export const foldText = text => fold(text).f;

/** The query's words, folded, each with its alternative spelling (ue → u). @param {string} q @returns {string[][]} */
export function terms(q) {
  return foldText(q).split(/[\s,;:!?.()"„“«»]+/).filter(Boolean).map(w => {
    const alt = w.replace(/ae/g, 'a').replace(/oe/g, 'o').replace(/ue/g, 'u');
    return alt !== w ? [w, alt] : [w];
  });
}

/** @param {Doc[]} docs @returns {IndexedDoc[]} */
export function buildIndex(docs) {
  return docs.map(d => ({ ...d, _t: foldText(d.title), _s: foldText([d.sub, d.extra].filter(Boolean).join(' · ')) }));
}

const isBoundary = (/** @type {string} */ s, /** @type {number} */ i) => i === 0 || !/[\p{L}\p{N}]/u.test(s[i - 1]);

/** First boundary index of `w` in `s`, or -1. @param {string} s @param {string} w */
function wordStart(s, w) {
  let i = s.indexOf(w);
  while (i >= 0) { if (isBoundary(s, i)) return i; i = s.indexOf(w, i + 1); }
  return -1;
}

/**
 * @param {IndexedDoc[]} index
 * @param {string} q
 * @param {{tab?: string | null, limit?: number}} [o]
 * @returns {IndexedDoc[]}
 */
export function search(index, q, { tab = null, limit = Infinity } = {}) {
  const ts = terms(q);
  if (!ts.length) return [];
  const whole = ts.map(v => v[0]).join(' ');
  /** @type {[number, IndexedDoc][]} */ const hits = [];
  for (const d of index) {
    if (tab && d.tab !== tab) continue;
    let inTitle = true, ok = true;
    for (const vs of ts) {
      const t = vs.some(v => d._t.includes(v));
      if (!t) { inTitle = false; if (!vs.some(v => d._s.includes(v))) { ok = false; break; } }
    }
    if (!ok) continue;
    let score = 4;
    if (inTitle) {
      const t = d._t.replace(/^(der|die|das)\s+/, '');
      if (d._t === whole || t === whole) score = 0;
      else if (d._t.startsWith(whole) || t.startsWith(whole)) score = 1;
      else if (ts.every(vs => vs.some(v => wordStart(d._t, v) >= 0))) score = 2;
      else score = 3;
    }
    hits.push([score, d]);
  }
  hits.sort((a, b) => a[0] - b[0] || (a[1].rank ?? 1e9) - (b[1].rank ?? 1e9));
  const out = [];
  for (const [, d] of hits) { out.push(d); if (out.length >= limit) break; }
  return out;
}

/**
 * Where the query's words occur in `text` (as written), for highlighting.
 * @param {string} text @param {string} q
 * @returns {[number, number][]}
 */
export function matchRanges(text, q) {
  const s = String(text ?? '');
  const ts = terms(q);
  if (!ts.length || !s) return [];
  const { f, map } = fold(s);
  /** @type {[number, number][]} */ const out = [];
  for (const vs of ts) {
    for (const v of vs) {
      let i = f.indexOf(v);
      while (i >= 0) {
        out.push([map[i], map[i + v.length - 1] + 1]);
        i = f.indexOf(v, i + v.length);
      }
    }
  }
  out.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  /** @type {[number, number][]} */ const merged = [];
  for (const r of out) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  return merged;
}

/** @param {{tab: string}[]} hits @returns {Record<string, number>} */
export function countByTab(hits) {
  /** @type {Record<string, number>} */ const n = {};
  for (const d of hits) n[d.tab] = (n[d.tab] || 0) + 1;
  return n;
}
