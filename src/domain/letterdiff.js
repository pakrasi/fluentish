// @ts-check
/* Letter diff for answer feedback (round 8, design C §1). Pure, no DOM; tested in node (tests/unit/letterdiff.test.mjs).
   Display only: it decides which letters to draw, never whether an answer is right. Grading is domain/match.js and
   features/shared/grade.js; this module imports neither (it reads words through the language pack's tokenizer).

   Three layers:
     letterDiff(a, b)      an LCS over graphemes (Intl.Segmenter when there is one, so a composed or decomposed ö is one
                           unit): equal, inserted and deleted runs.
     letterChunks(a, b)    the same as aligned pairs {a, b}: equal, or a change (b empty: extra letters, a empty: missing
                           letters, both: changed letters). Two neighbours swapped (hc / ch) are one change.
     answerDiff(typed, right)   words first (LCS on the pack's comparison key, so weiss = weiß and Mädchen = Maedchen), then
                           letters inside the word pairs that are close (Damerau distance at most 2, and at most a third of
                           the word). Returns the two lines as segments and a mode:
                             letters  a close pair, or a spelling to fix: the eye lands on the letters
                             words    only whole words differ
                             plain    more than maxMarkedShare of the right words are missing: no marks (design C F3)
   slipSegs(input, slips) is a right answer's one line: the grader's slips (typos, capitals, umlauts), each word once in
   its right spelling with the letters that changed marked. */
import { activePack } from '../lang/registry.js';

/** @typedef {{ op: 'eq' | 'ins' | 'del', text: string }} Op  ins: only in right; del: only in typed */
/** @typedef {{ a: string, b: string }} Chunk  a typed, b right; a === b is equal text */
/**
 * What a run of text is on its line.
 *   eq     plain
 *   fix    letters of the right spelling to correct, on an answer that counts (accent; never red)
 *   miss   letters (or with w, a whole word) of the right answer that his answer lacks (Right line)
 *   wrong  letters he typed that differ (with w: a whole word he typed that is not in the right answer) (You line)
 *   extra  letters he typed that the right word does not have
 *   ghost  letters he left out, shown faintly in his word (You line; decoration)
 * @typedef {'eq' | 'fix' | 'miss' | 'wrong' | 'extra' | 'ghost'} SegKind
 */
/** @typedef {{ text: string, k: SegKind, w?: boolean, word?: number }} Seg  word: the token's index on its line */
/** @typedef {'letters' | 'words' | 'plain'} DiffMode */
/**
 * @typedef {object} AnswerDiff
 * @property {Seg[]} typed     his line
 * @property {Seg[]} right     the right answer's line; its texts join to the right answer (NFC)
 * @property {DiffMode} mode
 * @property {{ near: number, missing: number, extra: number, words: number }} stats  close pairs, right words missing,
 *   typed words not in the right answer, right words in all
 */
/** A slip the grader found in his answer: offsets into the input, and the word as it should be. @typedef {{ start: number, end: number, expected: string, typed?: string }} Slip */
/** @typedef {{ raw: string, n: string, start: number, end: number }} Tok */
/** @typedef {{ text: { normalize: (s: unknown) => string, tokenize: (s: unknown, offset?: number) => Tok[] } }} PackText */

/** @type {any} */ const I = globalThis.Intl;
const SEG = I && typeof I.Segmenter === 'function' ? new I.Segmenter(undefined, { granularity: 'grapheme' }) : null;

/** The graphemes of a string, after NFC (so 'o' + U+0308 and 'ö' are the same one unit). @param {unknown} s @returns {string[]} */
export function graphemes(s) {
  const t = String(s ?? '').normalize('NFC');
  if (!SEG) return Array.from(t);
  return Array.from(/** @type {Iterable<{segment: string}>} */ (SEG.segment(t)), x => x.segment);
}

// the LCS table is n*m; two long sentences beyond this are compared as one change
const MAX_CELLS = 250000;

/** Single-grapheme ops (LCS, changes as late as an equal score allows them). @param {string[]} A @param {string[]} B @param {(x: string, y: string) => boolean} same @returns {Op[]} */
function ops1(A, B, same) {
  const n = A.length, m = B.length;
  if (n * m > MAX_CELLS) return [...A.map(text => /** @type {Op} */ ({ op: 'del', text })), ...B.map(text => /** @type {Op} */ ({ op: 'ins', text }))];
  const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = same(A[i], B[j]) ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  /** @type {Op[]} */ const out = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (same(A[i], B[j])) { out.push({ op: 'eq', text: B[j] }); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) out.push({ op: 'del', text: A[i++] });
    else out.push({ op: 'ins', text: B[j++] });
  }
  while (i < n) out.push({ op: 'del', text: A[i++] });
  while (j < m) out.push({ op: 'ins', text: B[j++] });
  return out;
}

/** Runs of the same op merged. @param {Op[]} ops @returns {Op[]} */
function merge(ops) {
  /** @type {Op[]} */ const out = [];
  for (const o of ops) {
    const last = out[out.length - 1];
    if (last && last.op === o.op) last.text += o.text; else out.push({ ...o });
  }
  return out;
}

/**
 * Letter diff of what he typed against the right text: equal, inserted (only in right) and deleted (only in typed) runs.
 * @param {unknown} typed @param {unknown} right @returns {Op[]}
 */
export function letterDiff(typed, right) {
  return merge(ops1(graphemes(typed), graphemes(right), (x, y) => x === y));
}

/**
 * The letter diff as aligned chunks: {a, b} with a === b for equal text; a change otherwise (a empty: letters he left
 * out; b empty: letters too many; both: letters that differ). A swap of two neighbours (hc for ch) is one change.
 * @param {unknown} typed @param {unknown} right @returns {Chunk[]}
 */
export function letterChunks(typed, right) {
  const o = ops1(graphemes(typed), graphemes(right), (x, y) => x === y);
  /** @type {Chunk[]} */ const out = [];
  let a = '', b = '';
  const flush = () => { if (a || b) out.push({ a, b }); a = ''; b = ''; };
  for (let k = 0; k < o.length; k++) {
    const x = o[k], y = o[k + 1], z = o[k + 2];
    // del X, eq Y, ins X (typed XY, right YX) and ins X, eq Y, del X (typed YX, right XY): one swapped pair
    if (y && z && y.op === 'eq' && x.op !== 'eq' && z.op !== 'eq' && x.op !== z.op && x.text === z.text) {
      if (x.op === 'del') { a += x.text + y.text; b += y.text + x.text; } else { a += y.text + x.text; b += x.text + y.text; }
      k += 2;
      continue;
    }
    if (x.op === 'eq') {
      flush();
      const last = out[out.length - 1];
      if (last && last.a === last.b) { last.a += x.text; last.b += x.text; } else out.push({ a: x.text, b: x.text });
    } else if (x.op === 'del') a += x.text;
    else b += x.text;
  }
  flush();
  return out;
}

/** Damerau (optimal string alignment) distance over graphemes, lower case. @param {string} a @param {string} b */
export function distance(a, b) {
  const A = graphemes(a.toLowerCase()), B = graphemes(b.toLowerCase());
  const n = A.length, m = B.length;
  if (!n || !m) return n + m;
  /** @type {number[][]} */ const d = Array.from({ length: n + 1 }, (_, i) => Array.from({ length: m + 1 }, (_, j) => (i ? (j ? 0 : i) : j)));
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
    const cost = A[i - 1] === B[j - 1] ? 0 : 1;
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
    if (i > 1 && j > 1 && A[i - 1] === B[j - 2] && A[i - 2] === B[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[n][m];
}

/**
 * Close enough for a letter diff: at most 2 edits and at most a third of the right word (dem/den, gearbeit/gearbeitet,
 * Geshcenk/Geschenk; not der/die, not ein/aus), and one of the two has 3 letters or more.
 * @param {string} typed @param {string} right
 */
export function near(typed, right) {
  const lb = graphemes(right).length;
  if (Math.max(graphemes(typed).length, lb) < 3) return false;
  const d = distance(typed, right);
  return d > 0 && d <= Math.min(2, Math.ceil(lb / 3));
}

/**
 * Close pairs between two lists of words, in order (no pair crosses another): the most pairs, then the fewest edits.
 * @param {Tok[]} A @param {Tok[]} B @param {number[]} ai indexes into A @param {number[]} bj indexes into B
 * @returns {[number, number][]} [index into A, index into B]
 */
function pairNear(A, B, ai, bj) {
  const n = ai.length, m = bj.length;
  if (!n || !m) return [];
  /** @type {(number | null)[][]} */ const dist = ai.map(i => bj.map(j => (near(A[i].raw, B[j].raw) ? distance(A[i].raw, B[j].raw) : null)));
  // best[i][j]: [pairs, -edits] over the suffixes ai[i..], bj[j..]
  /** @type {[number, number][][]} */ const best = Array.from({ length: n + 1 }, () => Array.from({ length: m + 1 }, () => /** @type {[number, number]} */ ([0, 0])));
  const better = (/** @type {[number, number]} */ x, /** @type {[number, number]} */ y) => x[0] > y[0] || (x[0] === y[0] && x[1] > y[1]);
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
    let v = better(best[i + 1][j], best[i][j + 1]) ? best[i + 1][j] : best[i][j + 1];
    const d = dist[i][j];
    if (d != null) { const w = /** @type {[number, number]} */ ([best[i + 1][j + 1][0] + 1, best[i + 1][j + 1][1] - d]); if (!better(v, w)) v = w; }
    best[i][j] = v;
  }
  /** @type {[number, number][]} */ const out = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    const d = dist[i][j];
    if (d != null) {
      const w = /** @type {[number, number]} */ ([best[i + 1][j + 1][0] + 1, best[i + 1][j + 1][1] - d]);
      if (w[0] === best[i][j][0] && w[1] === best[i][j][1]) { out.push([ai[i], bj[j]]); i++; j++; continue; }
    }
    if (best[i + 1][j][0] === best[i][j][0] && best[i + 1][j][1] === best[i][j][1]) i++; else j++;
  }
  return out;
}

/** Word LCS on the comparison key: matched [i, j] pairs. @param {Tok[]} A @param {Tok[]} B @returns {[number, number][]} */
function wordLcs(A, B) {
  const n = A.length, m = B.length;
  const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i].n === B[j].n ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  /** @type {[number, number][]} */ const out = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i].n === B[j].n) { out.push([i, j]); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) i++;
    else j++;
  }
  return out;
}

/** Push a segment, merging with the last one of the same kind and word. @param {Seg[]} out @param {Seg} s */
function push(out, s) {
  if (!s.text) return;
  const last = out[out.length - 1];
  if (last && last.k === s.k && !!last.w === !!s.w && last.word === s.word) last.text += s.text;
  else out.push(s);
}

/**
 * A line: the text between tokens plain, each token by `of`. @param {string} text @param {Tok[]} toks
 * @param {(t: Tok, i: number) => Seg[]} of @returns {Seg[]}
 */
function line(text, toks, of) {
  /** @type {Seg[]} */ const out = [];
  let p = 0;
  toks.forEach((t, i) => {
    push(out, { text: text.slice(p, t.start), k: 'eq' });
    for (const s of of(t, i)) push(out, { ...s, word: i });
    p = t.end;
  });
  push(out, { text: text.slice(p), k: 'eq' });
  return out;
}

/** True when a and b differ only in letter case. @param {string} a @param {string} b */
const caseOnly = (a, b) => a !== b && a.toLowerCase() === b.toLowerCase();

/**
 * His answer against the right one, as two lines of segments (design C §1).
 * Words the pack counts as the same (weiss/weiß, Maedchen/Mädchen, gern/gerne) are not misses: the spelling to fix is
 * marked `fix` on the Right line, and a difference of case only is marked when the grader listed that word in capMiss
 * (a sentence start is never one). Words close to each other get a letter diff; the rest are whole-word marks.
 * @param {unknown} typed @param {unknown} right
 * @param {{ pack?: PackText, maxMarkedShare?: number, capMiss?: { typed: string }[] }} [o]
 * @returns {AnswerDiff}
 */
export function answerDiff(typed, right, { pack, maxMarkedShare = 0.6, capMiss = [] } = {}) {
  const P = pack || /** @type {PackText} */ (/** @type {unknown} */ (activePack()));
  const a = P.text.normalize(typed).replace(/\s+/g, ' ').trim(), b = P.text.normalize(right).replace(/\s+/g, ' ').trim();
  const A = P.text.tokenize(a), B = P.text.tokenize(b);
  const same = wordLcs(A, B);
  /** @type {Map<number, number>} */ const sameA = new Map(), nearA = new Map();
  /** @type {Map<number, number>} */ const sameB = new Map(), nearB = new Map();
  for (const [i, j] of same) { sameA.set(i, j); sameB.set(j, i); }
  // the gaps between equal words: close pairs inside each gap only, so a pair never crosses an equal word
  const anchors = [[-1, -1], ...same, [A.length, B.length]];
  for (let k = 0; k + 1 < anchors.length; k++) {
    const [i0, j0] = anchors[k], [i1, j1] = anchors[k + 1];
    const ai = [], bj = [];
    for (let i = i0 + 1; i < i1; i++) ai.push(i);
    for (let j = j0 + 1; j < j1; j++) bj.push(j);
    for (const [i, j] of pairNear(A, B, ai, bj)) { nearA.set(i, j); nearB.set(j, i); }
  }
  const missing = B.length - sameB.size - nearB.size;
  const extra = A.length - sameA.size - nearA.size;
  const stats = { near: nearA.size, missing, extra, words: B.length };
  const caps = new Set(capMiss.map(c => String(c.typed)));
  if (!B.length || missing / B.length > maxMarkedShare) {
    return { typed: a ? [{ text: a, k: 'eq' }] : [], right: b ? [{ text: b, k: 'eq' }] : [], mode: 'plain', stats };
  }
  const typedLine = line(a, A, (t, i) => {
    if (sameA.has(i)) return [{ text: t.raw, k: 'eq' }];
    const j = nearA.get(i);
    if (j == null) return [{ text: t.raw, k: 'wrong', w: true }];
    return letterChunks(t.raw, B[j].raw).flatMap(c => /** @type {Seg[]} */ (
      c.a === c.b ? [{ text: c.a, k: 'eq' }]
      : !c.b ? [{ text: c.a, k: 'extra' }]
      : !c.a ? [{ text: c.b, k: 'ghost' }]
      : [{ text: c.a, k: 'wrong' }]));
  });
  const rightLine = line(b, B, (t, j) => {
    const i = sameB.get(j);
    if (i != null) {
      const ta = A[i].raw;
      if (ta === t.raw || (caseOnly(ta, t.raw) && !caps.has(ta))) return [{ text: t.raw, k: 'eq' }];
      return letterChunks(ta, t.raw).flatMap(c => /** @type {Seg[]} */ (
        c.a === c.b || !c.b ? [{ text: c.b, k: 'eq' }]
        : caseOnly(c.a, c.b) && !caps.has(ta) ? [{ text: c.b, k: 'eq' }]
        : [{ text: c.b, k: 'fix' }]));
    }
    const k = nearB.get(j);
    if (k == null) return [{ text: t.raw, k: 'miss', w: true }];
    return letterChunks(A[k].raw, t.raw).flatMap(c => /** @type {Seg[]} */ (c.a === c.b || !c.b ? [{ text: c.b, k: 'eq' }] : [{ text: c.b, k: 'miss' }]));
  });
  // letters: the eye can land on letters (a close pair, or a spelling to fix in a word that counts as the same)
  return { typed: typedLine, right: rightLine, mode: nearA.size || rightLine.some(s => s.k === 'fix') ? 'letters' : 'words', stats };
}

/**
 * Marks only where the grader put them (a phrase card's rest: rest.wrong ranges in his answer, rest.marks ranges in
 * the reference): the marked words of the two lines are paired when close (letter diff), the others stay whole-word
 * marks, and every other word is plain. Offsets are into the strings as given.
 * @param {string} typed @param {string} right @param {{ start: number, end: number }[]} typedRanges
 * @param {{ start: number, end: number }[]} rightRanges @param {{ pack?: PackText }} [o] @returns {AnswerDiff}
 */
export function rangeDiff(typed, right, typedRanges, rightRanges, { pack } = {}) {
  const P = pack || /** @type {PackText} */ (/** @type {unknown} */ (activePack()));
  const a = String(typed ?? ''), b = String(right ?? '');
  const A = P.text.tokenize(a), B = P.text.tokenize(b);
  const hit = (/** @type {Tok} */ t, /** @type {{ start: number, end: number }[]} */ rs) => rs.some(r => r.start < t.end && r.end > t.start);
  const ai = A.map((t, i) => (hit(t, typedRanges) ? i : -1)).filter(i => i >= 0);
  const bj = B.map((t, j) => (hit(t, rightRanges) ? j : -1)).filter(j => j >= 0);
  /** @type {Map<number, number>} */ const nearA = new Map(), nearB = new Map();
  for (const [i, j] of pairNear(A, B, ai, bj)) { nearA.set(i, j); nearB.set(j, i); }
  const onA = new Set(ai), onB = new Set(bj);
  const typedLine = line(a, A, (t, i) => {
    if (!onA.has(i)) return [{ text: t.raw, k: 'eq' }];
    const j = nearA.get(i);
    if (j == null) return [{ text: t.raw, k: 'wrong', w: true }];
    return letterChunks(t.raw, B[j].raw).flatMap(c => /** @type {Seg[]} */ (
      c.a === c.b ? [{ text: c.a, k: 'eq' }] : !c.b ? [{ text: c.a, k: 'extra' }] : !c.a ? [{ text: c.b, k: 'ghost' }] : [{ text: c.a, k: 'wrong' }]));
  });
  const rightLine = line(b, B, (t, j) => {
    if (!onB.has(j)) return [{ text: t.raw, k: 'eq' }];
    const i = nearB.get(j);
    if (i == null) return [{ text: t.raw, k: 'miss', w: true }];
    return letterChunks(A[i].raw, t.raw).flatMap(c => /** @type {Seg[]} */ (c.a === c.b || !c.b ? [{ text: c.b, k: 'eq' }] : [{ text: c.b, k: 'miss' }]));
  });
  return { typed: typedLine, right: rightLine, mode: nearA.size ? 'letters' : 'words', stats: { near: nearA.size, missing: bj.length - nearB.size, extra: ai.length - nearA.size, words: B.length } };
}

/**
 * A right answer's line: his answer with each slip the grader found (typo, capital, umlaut) written once in its right
 * spelling, the letters that changed marked `fix` and letters too many `extra`. Overlapping slips: the first wins.
 * @param {string} input the grader's input (slip offsets point into it) @param {Slip[]} slips @returns {Seg[]}
 */
export function slipSegs(input, slips) {
  const s = String(input ?? '');
  /** @type {Seg[]} */ const out = [];
  let p = 0, word = 0;
  for (const m of [...slips].sort((x, y) => x.start - y.start)) {
    if (m.start < p || m.end > s.length) continue;
    push(out, { text: s.slice(p, m.start), k: 'eq' });
    for (const c of letterChunks(s.slice(m.start, m.end), m.expected)) {
      push(out, c.a === c.b ? { text: c.b, k: 'eq', word } : !c.b ? { text: c.a, k: 'extra', word } : { text: c.b, k: 'fix', word });
    }
    word++;
    p = m.end;
  }
  push(out, { text: s.slice(p), k: 'eq' });
  return out;
}

/**
 * What a caption can say about a near miss in one line, or null: the one close word pair is the only difference, and
 * he left out the end of the right word (gearbeit / gearbeitet: part "et"; at least two letters before it are his).
 * @param {AnswerDiff} d @returns {{ kind: 'ending-missing', part: string, word: string } | null}
 */
export function describe(d) {
  if (d.mode !== 'letters' || d.stats.near !== 1 || d.stats.missing || d.stats.extra) return null;
  const marked = d.right.filter(s => s.k !== 'eq');
  if (marked.length !== 1 || marked[0].k !== 'miss') return null;
  const word = marked[0].word;
  const segs = d.right.filter(s => s.word === word);
  if (segs.length !== 2 || segs[1] !== marked[0] || graphemes(segs[0].text).length < 2) return null;
  const typed = d.typed.filter(s => s.word != null && s.k !== 'eq');
  if (typed.length !== 1 || typed[0].k !== 'ghost') return null;
  return { kind: 'ending-missing', part: marked[0].text, word: segs[0].text + marked[0].text };
}

/**
 * Where a retype first differs: the index of the first word of `right` (its tokens) that his attempt does not have as
 * written, case aside (retypes are checked case and commas aside); -1 when every word is there.
 * @param {unknown} attempt @param {unknown} right @param {{ pack?: PackText }} [o]
 */
export function firstDiffWord(attempt, right, { pack } = {}) {
  const P = pack || /** @type {PackText} */ (/** @type {unknown} */ (activePack()));
  const A = P.text.tokenize(P.text.normalize(attempt)), B = P.text.tokenize(P.text.normalize(right));
  const low = (/** @type {Tok} */ t) => t.raw.toLowerCase();
  const n = A.length, m = B.length;
  const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = low(A[i]) === low(B[j]) ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (low(A[i]) === low(B[j])) { i++; j++; continue; }
    if (L[i + 1][j] >= L[i][j + 1] && L[i + 1][j] === L[i][j]) { i++; continue; }   // a word too many in his attempt
    return j;
  }
  return j < m ? j : -1;
}
