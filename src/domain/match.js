/* Igloo answer matcher. Pure functions, no DOM. Used by the Test view and node tests (tests/unit/match.test.mjs).
   Language-neutral since Wave C2: alignment, Damerau-Levenshtein, slots, diffs and the typo policy live here; what a
   word is, which spellings are the same and every word list the policy names (closed-class words, endings, minimal
   pairs, clause words, comma rules …) come from a language pack (src/lang/types.js; German: src/lang/de/). Every entry
   point takes {pack} (check, restCheck, formCheck: in opts; alsoLines: its last argument); without one it uses the pack
   of the call it runs inside, else the active pack (lang/registry.js, set by core/lang.js). The examples below are
   German, the only full pack.
   check(input, accepted[], {pos, strictCase, slots, anywhere, typos})
     -> {ok, exact, close, articleMiss, caseMiss, matched, others, fixed, typos: [{typed, expected, start, end}], input}
     (typo offsets point into `input`, the answer after NFC and space cleanup)
   Matching is word by word (token alignment), not a regex on the raw string:
   - Case and punctuation are ignored (case counts only with strictCase); ae/oe/ue/ss count as ä/ö/ü/ß; other accents
     are ignored (Cafe = Café).
   - Each fixed word may be a small typo away: 0 edits up to 3 letters, 1 edit for 4-7, 2 for 8+ (Damerau-Levenshtein,
     after folding). Articles, pronouns, prepositions and a few grammar words (dass, sind, ...) never count as typos.
     A match with typos is ok:true with typos.length > 0; `exact` is false when the input needed folding or typos.
   - A typo is never a grammar mistake (typoOk): the inflectional ending must be the same (vielen/vieles, macht/machst,
     kleinem/kleinen are misses), the edit must be in the stem, a vowel change (spricht/sprecht, sieht/seht, ie/ei) is a
     form, words that differ only in umlauts are never typos (Mutter/Mütter; a dropped umlaut is a slip only when the
     plain spelling is not another word, see `umlaut`), and a typed word that is a German word or form itself
     (opts.lexicon, a Set of folded words) is that word. opts.never: folded words from known wrong answers, never
     forgiven.
   - "(words)" are optional; "[slot]" and "..." match 1-6 whole words. Only in the legacy chunk strings (not accept
     patterns) may a slot be glued to a word ("Lieblings[Nomen]": the rest of that word counts).
   - anywhere:true (the accept patterns for phrases) = the pattern may appear anywhere in the answer; otherwise the whole
     answer has to match.
   - Nouns: the right word with a wrong or missing article is ok:false, articleMiss:true.
   - close: not ok, but at least half of a pattern's fixed words are in the answer (patterns of 2+ fixed words, not nouns).
   - `fixed` is the accepted string with its slots filled from the answer; `others` the accepted strings not matched.
   The pattern rules follow tools/validate_accept.py (to_regex/matches); match.test.mjs checks that both agree.

   B1 trainer options (opt-in; Igloo Test passes none of them, so its grading is unchanged):
   - slotMax (default 6): words a slot may take. "([x])" in a pattern is an optional slot (0..slotMax words).
   - endings: a typo is forgiven only on the stem: the word minus a final e/en/em/er/es/n/m/r/s, 5+ letters, 1 edit,
     with identical suffixes (kleinem ≠ kleinen; Bahnhfo = Bahnhof).
   - umlaut: a dropped umlaut is a slip (ok, listed in umlautMiss, the caller rates Hard), except in words where the
     umlaut changes the meaning (könnten/konnten, müssten/mussten, würde/wurde, hätte/hatte, schön/schon …): a miss.
   - strict: [words] that must be typed exactly, in the given case (not sentence-initially); a case slip → ok:false and
     focusMiss.
   - caseRef: Map(folded lowercase word → cased form), e.g. built from the model and a noun list. After a match, typed
     words whose capitalisation differs from the reference are listed in capMiss (sentence-initial words are exempt);
     ok stays true.
   - When not ok: `nearest` = index of the accepted string with the most fixed words found (ties → list order).
   - When ok: `span` = [start, end] of the matched pattern in `input`, `fills` = the text each slot took, in order.
   restCheck() grades the rest of a phrase card's sentence, formCheck() a situation's words against its model, markDiff()
   is the word diff the round shows (see each). */
// @ts-check
/** @typedef {import('../lang/types.js').Token} Word  a typed word; n: the pack's comparison key (de: lowercase, folded, no accents) */
/** @typedef {import('../lang/types.js').LanguagePack} LanguagePack */
/** @typedef {import('../lang/types.js').Shape} Shape */
/** @typedef {{n: string, low: string, len: number, word: string}} Alt  one spelling a pattern word accepts */
/** @typedef {{t: 'w', raw: string, alts: Alt[], tail?: string, glued?: boolean}} WEl  a fixed word */
/** @typedef {{t: 'opt', words: WEl[], raw: string, tail?: string, glued?: boolean}} OptEl  "(optional words)" */
/** @typedef {{t: 'slot', raw: string, opt?: boolean, glued?: boolean, tail?: string, prefix?: Alt}} SlotEl  "[slot]", "([optional slot])", "Lieblings[x]" */
/** @typedef {{t: 'part', raw: string, tail?: string, glued?: boolean, opt?: undefined, prefix?: undefined}} PartEl  0-3 particles (restCheck only: the pack's slots.particles) */
/** @typedef {WEl | OptEl | SlotEl | PartEl} El */
/** @typedef {{els: El[], lead?: string, src?: string}} Pattern */
/** @typedef {{endings?: boolean, umlaut?: boolean, strict?: Map<string, string> | null, never?: Set<string> | null, lex?: Set<string> | null, conj?: import('../lang/types.js').Conj | null}} WordX  word-level options (xOpts) */
/** @typedef {{cost: number, exact: boolean, a: Alt, umlaut?: boolean, ti: number, glued?: boolean}} Cost  one typed word against one pattern word */
/** @typedef {{ei: number, ti: number, len: number, n: number, x: boolean, cs?: Cost[], present?: boolean, cut?: number}} Step  one pattern element in an alignment */
/** @typedef {{n: number, exact: boolean, steps: Step[], start: number, toks?: Word[]}} Alignment */
/** @typedef {{anywhere: boolean, typos: boolean, loose: Set<string> | null, x?: WordX, slotMax?: number}} AlignOpts */
/** @typedef {{typed: string, expected: string, start: number, end: number}} Slip */
/** @typedef {{start: number, end: number, word: string}} Wrong */
/** @typedef {{start: number, end: number}} Range */
/**
 * @typedef {object} CheckOptions
 * @property {string} [pos] @property {boolean} [strictCase] @property {boolean} [slots] @property {boolean} [anywhere]
 * @property {boolean} [typos] @property {Iterable<string> | null} [loose] @property {number} [slotMax] @property {boolean} [endings]
 * @property {boolean} [umlaut] @property {string[]} [strict] @property {Map<string, string> | null} [caseRef]
 * @property {Iterable<string> | null} [never] @property {Set<string> | null} [lexicon]
 * @property {import('../lang/types.js').Conj | null} [conj]  the pack's verb forms (grammar.verbs.build): a misbuilt verb
 *   form (fallten) is never a typo, and restCheck, formCheck keep the model's verb forms
 * @property {LanguagePack | null} [pack]  the language (default: the call's, else the active pack)
 */
/**
 * @typedef {object} CheckResult
 * @property {boolean} ok @property {boolean} exact @property {boolean} close @property {boolean} articleMiss
 * @property {boolean} caseMiss @property {string | null} matched @property {string[]} others @property {string} fixed
 * @property {Slip[]} typos @property {string} input @property {Slip[]} [umlautMiss] @property {Slip[]} [capMiss]
 * @property {Slip[]} [focusMiss] @property {number | null} [nearest] @property {[number, number] | null} [span] @property {string[]} [fills]
 */
import { activePack } from '../lang/registry.js';

// The pack of the call in progress. Every exported function runs inside inPack(): it sets L for the length of the call
// (the pack named, else the enclosing call's, else the active one) and puts the previous one back. Everything is
// synchronous, so one module variable is enough.
/** @type {LanguagePack} */ let L = activePack();
let depth = 0;
/** @template T @param {LanguagePack | null | undefined} p @param {() => T} fn @returns {T} */
function inPack(p, fn) {
  const prev = L;
  L = p || (depth ? L : activePack());
  depth++;
  try { return fn(); } finally { depth--; L = prev; }
}
/** @param {unknown} s */
const fold = s => L.text.fold(s);
const nfc = (/** @type {unknown} */ s) => L.text.normalize(s);

// Legacy cleanup, kept for callers: NFC, collapse spaces, drop commas, quotes and final punctuation.
/** @param {unknown} s */
function clean(s) {
  return nfc(s).replace(/["„“”«»‚]/g, ' ').replace(/,/g, ' ')
    .replace(/\s+/g, ' ').trim().replace(/[\s.!?;:]+$/u, '').replace(/^[¿¡]+/, '').trim();
}
const tidy = (/** @type {unknown} */ s) => String(s).normalize('NFC').replace(/\s+/g, ' ').trim();

// words of a string, with offsets (the pack's tokenizer): {raw, low, n (the comparison key), len (letters), start, end}
/** @param {unknown} s @param {number} [offset] @returns {Word[]} */
const words = (s, offset = 0) => L.text.tokenize(s, offset);

// Damerau-Levenshtein (optimal string alignment) distance, or max+1 once it is over max
/** @param {string} a @param {string} b @param {number} [max] */
function dl(a, b, max = 9) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const la = a.length, lb = b.length;
  /** @type {number[] | null} */ let p2 = null, p1 = Array.from({ length: lb + 1 }, (_, j) => j);
  for (let i = 1; i <= la; i++) {
    const cur = [i]; let rowMin = i;
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(p1[j] + 1, cur[j - 1] + 1, p1[j - 1] + cost);
      if (p2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, p2[j - 2] + 1);
      cur.push(v); if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    p2 = p1; p1 = cur;
  }
  return p1[lb];
}
const dl1 = (/** @type {string} */ a, /** @type {string} */ b) => dl(a, b, 1) <= 1;
const allowedEdits = (/** @type {number} */ len) => len <= 3 ? 0 : len <= 7 ? 1 : 2;

// one pattern word against one typed word: null, or {cost: 0|1, exact}
// loose (optional Set of folded words): only these words may have typos; every other word must be exact
// x: {endings, umlaut, strict: Map, never: Set, lex: Set} (see check); typo rules in typoOk()
/** @type {WordX} */
const NOX = {};
/**
 * @param {WEl} w @param {Word} tok @param {boolean} typos @param {Set<string> | null | undefined} loose @param {WordX} [x]
 * @returns {{cost: number, exact: boolean, a: Alt, umlaut?: boolean} | null}
 */
function wcost(w, tok, typos, loose, x = NOX) {
  /** @type {{cost: number, exact: boolean, a: Alt, umlaut?: boolean} | null} */ let best = null;
  for (const a of w.alts) {
    if (tok.n === a.n) return { cost: 0, exact: tok.low === a.low, a };
    if (x.never && x.never.has(tok.n)) continue;               // a word from a known wrong answer: never a slip
    const mk = L.grading.slips.marks;
    if (mk && mk.base(tok.low) === mk.base(a.low)) {
      // the two differ only in marks (de: umlauts): never a typo. Typing the plain vowel for ä/ö/ü is a slip (B1:
      // umlautMiss, Hard) unless the plain spelling is another word or form (konnten/könnten, Mutter/Mütter,
      // fahrt/fährt): then a miss. Typing an umlaut that is not there (Mütter for Mutter, würde for wurde) is always a miss.
      const dropped = mk.dropped(tok.low, a.low);
      if (!dropped || L.grading.minimalPairs.has(tok.low) || (x.lex && x.lex.has(tok.n)) || (x.conj && x.conj.lookup(tok.n).length) || (x.strict && x.strict.has(a.n))) continue;
      if (x.umlaut) { best = { cost: 1, exact: false, a, umlaut: true }; continue; }
      if (typos && !best && !(loose && !loose.has(a.n)) && !L.grading.closedClass.has(a.n) && allowedEdits(a.len)) best = { cost: 1, exact: false, a };
      continue;
    }
    if (!typos || best || (loose && !loose.has(a.n))) continue;
    if (x.strict && x.strict.has(a.n)) continue;
    if (typoOk(tok.n, a, x)) best = { cost: 1, exact: false, a };
  }
  return best;
}
// Whether typed (folded) is a typo of the pattern word a, not a grammar mistake:
//  - articles, pronouns, prepositions and the other closed-class words get no typos at all;
//  - a typed word that is itself a German word or form (x.lex: the content's words) is that word, not a typo;
//  - the inflectional endings must be the same (vielen ≠ vieles, macht ≠ machst, kleinem ≠ kleinen): the typo is in
//    the stem, within the budget (B1 `endings`: 1 edit, 5+ letters; Test: 1 edit for 4-7 letters, 2 for 8+);
//  - a one-edit difference that is a vowel change (sprechen/sprichst, fuhr/fahr), ie/e (sieht/seht) or ie/ei
//    (schrieb/schreib) is a grammar form, not a typo. u↔i and i↔o (neighbouring keys) stay typos.
/** @param {string} t @param {{n: string, len: number}} a @param {WordX} x */
function typoOk(t, a, x) {
  const G = L.grading;
  if (G.closedClass.has(a.n) || G.closedClass.has(t)) return false;
  if (G.soundAlikes.has(t) || (x.lex && x.lex.has(t))) return false;
  // a verb form itself (gedroht, tragt), or one built with the wrong endings (fallten, geratet), or the word with another
  // prefix (gedroht for bedroht): a form, never a typo
  if (x.conj && (x.conj.lookup(t).length || x.conj.misbuilt(t))) return false;
  if (G.prefixSwap && G.prefixSwap(t, a.n)) return false;
  if (x.endings && a.len < 5) return false;
  const budget = x.endings ? 1 : allowedEdits(a.len);
  if (!budget) return false;
  const et = ending(t), ea = ending(a.n);
  if (et !== ea) return false;
  const st = t.slice(0, t.length - et.length), sa = a.n.slice(0, a.n.length - ea.length);
  const d = dl(st, sa, budget);
  return d <= budget && !(d === 1 && G.isFormChange(st, sa));
}
// the inflectional ending of a key (the pack's endings, longest first); the rest of the word (the stem) keeps at least
// 3 letters
const ending = (/** @type {string} */ n) => L.grading.endings.find(f => n.length >= f.length + 3 && n.endsWith(f)) || '';

// ---- patterns ----
// elements: {t:'w', alts:[{n, low, len, word}], raw} | {t:'opt', words:[w...], raw} | {t:'slot', raw, prefix?}
// each element keeps `raw` (as written, for display) and `tail` (punctuation after it, display only)
/** @param {string} src @param {boolean} useSlots @param {boolean} dots @returns {Pattern} */
function parse(src, useSlots, dots) {
  let s = nfc(src);
  if (useSlots && dots) s = s.replace(/\.\.\.|…/g, '[…]');
  const re = useSlots ? /\[[^\]]*\]|\([^)]*\)|[^\s[\]()]+/g : /\S+/g;
  /** @type {El[]} */ const els = []; let lead = '', prevEnd = -1, prevReal = false;
  /** @type {(wd: Word, raw: string) => WEl} */
  const lit = (wd, raw) => ({ t: 'w', raw, alts: [{ n: wd.n, low: wd.low, len: wd.len, word: wd.raw }] });
  for (const m of s.matchAll(re)) {
    const tok = m[0], at = /** @type {number} */ (m.index), glued = prevReal && prevEnd === at;
    prevEnd = at + tok.length;
    if (useSlots && tok[0] === '[') { els.push({ t: 'slot', raw: '…', glued }); prevReal = true; continue; }
    if (useSlots && /^\(\[[^\]]*\]\)$/.test(tok)) { els.push({ t: 'slot', raw: '…', opt: true, glued }); prevReal = true; continue; }
    if (useSlots && tok[0] === '(') {
      const ws = words(tok.slice(1, -1));
      if (ws.length) { els.push({ t: 'opt', words: ws.map(wd => lit(wd, wd.raw)), raw: tok.slice(1, -1).trim(), glued }); prevReal = true; }
      continue;
    }
    const ws = words(tok);
    if (!ws.length) { if (els.length) els[els.length - 1].tail = (els[els.length - 1].tail || '') + tok; else lead += tok; prevReal = false; continue; }
    ws.forEach((wd, j) => { const e = lit(wd, j ? '' : tok); e.glued = j ? false : glued; els.push(e); });
    prevReal = true;
  }
  // glue: "Mein(e)" -> mein|meine, "(un)möglich" -> möglich|unmöglich, "Lieblings[Nomen]" -> slot with a prefix
  /** @type {El[]} */ const out = [];
  for (const e of els) {
    const prev = out[out.length - 1];
    if (e.glued && prev) {
      if (e.t === 'opt' && prev.t === 'w' && e.words.length === 1 && prev.alts.length === 1) {
        const a = prev.alts[0], b = e.words[0].alts[0];
        prev.alts.push({ n: a.n + b.n, low: a.low + b.low, len: a.len + b.len, word: a.word + b.word });
        prev.raw = prev.raw + e.raw; prev.tail = e.tail; continue;
      }
      if (e.t === 'w' && prev.t === 'opt' && prev.words.length === 1 && e.alts.length === 1) {
        const a = prev.words[0].alts[0], b = e.alts[0];
        out[out.length - 1] = { t: 'w', raw: prev.raw + e.raw, tail: e.tail, alts: [b, { n: a.n + b.n, low: a.low + b.low, len: a.len + b.len, word: a.word + b.word }] };
        continue;
      }
      if (dots && e.t === 'slot' && prev.t === 'w' && prev.alts.length === 1 && !prev.tail) {   // legacy chunk strings only
        out[out.length - 1] = { t: 'slot', raw: prev.raw + '…', tail: e.tail, prefix: prev.alts[0] };
        continue;
      }
    }
    out.push(e);
  }
  return { els: out, lead, src: String(src) };
}

// Best alignment of pattern elements to typed words: fewest typos, then exact spelling, then earliest start.
// Positions are (token, offset): like validate_accept's "\s*" between words, fixed words may be written together
// ("schonmal" for "schon (ein)mal"). Such glued pieces must be spelled exactly; typos only count on whole words.
/** @typedef {{step: Step, next: StepList}} StepNode @typedef {StepNode | null} StepList @typedef {{n: number, x: boolean, steps: StepList}} Partial */
/** @param {Pattern} pat @param {Word[]} toks @param {AlignOpts} o @returns {Alignment | null} */
function align(pat, toks, { anywhere, typos, loose, x, slotMax = 6 }) {
  /** @type {Map<number, Partial | null>} */ const memo = new Map();
  /** @type {Partial} */ const END = { n: 0, x: true, steps: null };
  const els = pat.els;
  const better = (/** @type {Partial} */ a, /** @type {Partial | null} */ b) => !b || a.n < b.n || (a.n === b.n && a.x && !b.x);
  // one pattern word at (ti, off): [{ti, off, c}] ways to match it
  /** @param {WEl} w @param {number} ti @param {number} off @returns {{ti: number, off: number, c: Cost}[]} */
  function word(w, ti, off) {
    const t = toks[ti];
    /** @type {{ti: number, off: number, c: Cost}[]} */ const out = [];
    if (!t) return out;
    if (!off) { const c = wcost(w, t, typos, loose, x); if (c) out.push({ ti: ti + 1, off: 0, c: { ...c, ti } }); }
    const rest = t.n.slice(off);
    for (const a of w.alts) {
      if (!a.n || !rest.startsWith(a.n) || (!off && rest === a.n)) continue;
      out.push(rest === a.n ? { ti: ti + 1, off: 0, c: { cost: 0, exact: false, a, ti, glued: true } } : { ti, off: off + a.n.length, c: { cost: 0, exact: false, a, ti, glued: true } });
    }
    return out;
  }
  /** @param {number} ei @param {number} ti @param {number} off @returns {Partial | null} */
  function go(ei, ti, off) {
    if (ei === els.length) return !off && (anywhere || ti === toks.length) ? END : null;
    const key = (ei * 4096 + ti) * 128 + off;
    if (memo.has(key)) return /** @type {Partial | null} */ (memo.get(key));
    const e = els[ei];
    /** @type {Partial | null} */
    let best = null;
    /** @param {Partial | null} r @param {Step} step */
    const take = (r, step) => {
      if (!r) return;
      /** @type {Partial} */ const cand = { n: r.n + step.n, x: r.x && step.x, steps: { step, next: r.steps } };
      if (better(cand, best)) best = cand;
    };
    if (e.t === 'w') {
      for (const m of word(e, ti, off)) take(go(ei + 1, m.ti, m.off), { ei, ti, len: 1, n: m.c.cost, x: m.c.exact, cs: [m.c] });
    } else if (e.t === 'opt') {
      /** @type {(j: number, ti2: number, off2: number, n: number, x: boolean, cs: Cost[]) => void} */
      const chain = (j, ti2, off2, n, x, cs) => {
        if (j === e.words.length) return take(go(ei + 1, ti2, off2), { ei, ti, len: ti2 - ti, n, x, cs, present: true });
        for (const m of word(e.words[j], ti2, off2)) chain(j + 1, m.ti, m.off, n + m.c.cost, x && m.c.exact, [...cs, m.c]);
      };
      chain(0, ti, off, 0, true, []);
      take(go(ei + 1, ti, off), { ei, ti, len: 0, n: 0, x: true, present: false });
    } else if (off) {
      // a slot is always whole words, separated from its neighbours by spaces
    } else if (e.t === 'part') {
      // particles where a slot of the pattern is (restCheck): none, or up to 3 of the pack's particles
      take(go(ei + 1, ti, 0), { ei, ti, len: 0, n: 0, x: true });
      for (let k = 1; k <= 3 && ti + k <= toks.length && L.grammar.slots.particles.has(toks[ti + k - 1].n); k++) take(go(ei + 1, ti + k, 0), { ei, ti, len: k, n: 0, x: true });
    } else if (e.prefix) {
      const t = toks[ti], p = e.prefix;
      if (t && t.n.startsWith(p.n) && t.n.length > p.n.length)   // glued: the rest of this word is the slot's first word
        for (let k = 1; k <= 6 && ti + k <= toks.length; k++) take(go(ei + 1, ti + k, 0), { ei, ti, len: k, n: 0, x: t.low.startsWith(p.low), cut: p.word.length });
      if (t && t.n === p.n)                                         // written apart: "Lieblings Essen"
        for (let k = 1; k <= 6 && ti + 1 + k <= toks.length; k++) take(go(ei + 1, ti + 1 + k, 0), { ei, ti, len: 1 + k, n: 0, x: t.low === p.low, cut: -1 });
    } else {
      if (e.opt) take(go(ei + 1, ti, 0), { ei, ti, len: 0, n: 0, x: true });
      for (let k = 1; k <= slotMax && ti + k <= toks.length; k++) take(go(ei + 1, ti + k, 0), { ei, ti, len: k, n: 0, x: true });
    }
    memo.set(key, best);
    return best;
  }
  /** @type {Partial | null} */ let best = null;
  let start = 0;
  for (let s = 0; s < (anywhere ? Math.max(1, toks.length) : 1); s++) {
    const r = go(0, s, 0);
    if (r && better(r, best)) { best = r; start = s; }
    if (best && best.n === 0 && best.x) break;
  }
  if (!best) return null;
  /** @type {Step[]} */ const steps = []; for (let l = best.steps; l; l = l.next) steps.push(l.step);
  return { n: best.n, exact: best.x, steps, start };
}

// Display a pattern. fill: the alignment (slots take the typed words), or null for the model answer
// (optional words kept without their parens, slots as "…", first letter capitalised).
/** @param {Pattern} pat @param {string} input @param {Alignment | null} m @param {((e: WEl) => string | null) | null} [pick] a word with alternatives (fiel(en)): the one to show */
function display(pat, input, m, pick = null) {
  const byEl = new Map((m?.steps || []).map(s => [s.ei, s]));
  const parts = pat.lead ? [pat.lead] : [];
  pat.els.forEach((e, i) => {
    const s = byEl.get(i); let txt;
    if (e.t === 'w') txt = (pick && e.alts.length > 1 && pick(e)) || e.raw;
    else if (e.t === 'opt') txt = m && !s?.present ? '' : e.raw;
    else if (e.opt && !m) txt = '';
    else if (!m || !s) txt = e.raw;
    else if (!s.len) txt = '';
    else {
      const tk = /** @type {Word[]} */ (m.toks).slice(s.ti, s.ti + s.len);
      const typed = input.slice(tk[0].start, tk[tk.length - 1].end);
      txt = e.prefix ? (s.cut === -1 ? e.raw.slice(0, -1) + ' ' + input.slice(tk[1].start, tk[tk.length - 1].end) : e.raw.slice(0, -1) + typed.slice(s.cut)) : typed;
    }
    if (txt) parts.push(txt + (e.tail || ''));
    else if (e.tail && parts.length) parts[parts.length - 1] += e.tail;
  });
  let out = parts.join(' ').replace(/\s+([,.!?;:])/g, '$1').replace(/\s+/g, ' ').trim();
  if (!m) out = out.replace(/^(\P{L}*)(\p{L})/u, (_, a, b) => a + b.toUpperCase());
  return out;
}
/** @type {Map<string, Pattern>} */
const cache = new Map();
/** @param {string} src @param {boolean} useSlots @param {boolean} dots @returns {Pattern} */
function compile(src, useSlots, dots) {
  const k = L.id + (useSlots ? 1 : 0) + (dots ? 2 : 0) + '|' + src;
  let p = cache.get(k);
  if (!p) { p = parse(src, useSlots, dots); if (cache.size > 5000) cache.clear(); cache.set(k, p); }
  return p;
}
// "(entschuldigung) könnten sie das [x]" -> "Entschuldigung könnten sie das …"
// caseRef (optional, e.g. the German example sentence): lowercase pattern words take its capitalisation ("Sie", nouns)
/** @param {string} p @param {string | null} [caseRef] */
function renderPattern(p, caseRef) {
  let out = display(compile(p, true, false), '', null);
  if (caseRef) {
    /** @type {Map<string, string>} */ const ref = new Map();
    String(caseRef).normalize('NFC').split(/(?<=[.!?:])\s+/).forEach(sent => words(sent).forEach((w, i) => { if (i && !ref.has(w.low)) ref.set(w.low, w.raw); }));
    out = out.replace(L.text.wordRe, w => ref.get(w.toLowerCase()) || w);
    out = out.replace(/^(\P{L}*)(\p{L})/u, (_, a, b) => a + b.toUpperCase());
  }
  return out;
}

// case check for strictCase: an aligned word whose capitalisation differs
/** @param {Pattern} pat @param {Alignment} m */
function caseDiffers(pat, m) {
  for (const s of m.steps) {
    const e = pat.els[s.ei];
    if (!s.cs) continue;
    for (let j = 0; j < s.cs.length; j++) {
      if (s.cs[j].glued) continue;
      const t = /** @type {Word[]} */ (m.toks)[s.cs[j].ti], want = s.cs[j].a.word;
      if (s.cs[j].cost === 0 ? fold(t.raw) !== fold(want) : (t.raw[0] === t.raw[0].toUpperCase()) !== (want[0] === want[0].toUpperCase())) return true;
    }
    void e;
  }
  return false;
}

/** @param {string} input @param {Pattern} pat @param {AlignOpts} opts */
function run(input, pat, opts) {
  const toks = words(input);
  const m = toks.length ? align(pat, toks, opts) : null;
  if (m) m.toks = toks;
  return m;
}

// what ends the text before a word that starts a sentence (the pack's grading.sentenceStart, else this)
const SENTENCE_START = /[.!?:]\s*["„“]?\s*$/;
// B1: strict words in their exact case (focusMiss) and capitals against a reference (capMiss); sentence starts exempt,
// and words the pack lets be written either way (de: recht/Recht haben)
const eitherCase = (/** @type {Word[]} */ toks, /** @type {number} */ i) => L.grading.eitherCase(toks, i);
/** @param {CheckResult & {focusMiss: Slip[], capMiss: Slip[]}} res @param {Alignment & {toks: Word[]}} m @param {string} inp @param {WordX} x @param {Map<string, string> | null | undefined} caseRef */
function caseChecks(res, m, inp, x, caseRef) {
  const initial = (/** @type {Word} */ t) => t.start === 0 || (L.grading.sentenceStart || SENTENCE_START).test(inp.slice(0, t.start));
  const used = new Set();
  for (const s of m.steps) (s.cs || []).forEach(c => {
    if (c.glued) return;
    const t = m.toks[c.ti]; used.add(c.ti);
    if (initial(t) || eitherCase(m.toks, c.ti)) return;
    const want = x && x.strict && x.strict.get(c.a.n);
    if (want && /\p{Lu}/u.test(want[0]) !== /\p{Lu}/u.test(t.raw[0])) { res.focusMiss.push({ typed: t.raw, expected: want, start: t.start, end: t.end }); return; }
    const ref = caseRef && caseRef.get(t.n);
    if (!want && ref && /\p{Lu}/u.test(ref[0]) !== /\p{Lu}/u.test(t.raw[0])) res.capMiss.push({ typed: t.raw, expected: ref, start: t.start, end: t.end });
  });
  if (!caseRef) return;
  m.toks.forEach((t, i) => {   // words in slots and around the pattern: only nouns written in lowercase
    if (used.has(i) || initial(t) || eitherCase(m.toks, i)) return;
    const ref = caseRef.get(t.n);
    if (ref && /\p{Lu}/u.test(ref[0]) && !/\p{Lu}/u.test(t.raw[0])) res.capMiss.push({ typed: t.raw, expected: ref, start: t.start, end: t.end });
  });
  res.capMiss.sort((a, b) => a.start - b.start);
}
// Word-level diff of an answer against a right sentence (LCS on folded words): which typed words are not in the
// right one (`wrong`, offsets into a), and which words of b are not in a (`missing`, indexes into words(b)).
/** @param {string} a @param {string} b */
function diffWords(a, b) {
  const A = words(a), B = words(b), n = A.length, m = B.length;
  const L = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i].n === B[j].n ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  /** @type {Wrong[]} */ const wrong = [];
  const keepB = new Set();
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i].n === B[j].n) { keepB.add(j); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) { wrong.push({ start: A[i].start, end: A[i].end, word: A[i].raw }); i++; }
    else j++;
  }
  for (; i < n; i++) wrong.push({ start: A[i].start, end: A[i].end, word: A[i].raw });
  return { wrong, missing: B.map((w, k) => keepB.has(k) ? null : k).filter(k => k != null), right: B };
}

// the word-level options for wcost/typoOk
/** @param {CheckOptions} opts @returns {WordX} */
function xOpts(opts) {
  const set = (/** @type {Iterable<string> | null | undefined} */ v) => (v ? new Set([...v].map(w => fold(String(w).toLowerCase()))) : null);
  return {
    endings: !!opts.endings, umlaut: !!opts.umlaut,
    strict: opts.strict && opts.strict.length ? new Map(opts.strict.map(w => [fold(String(w).toLowerCase()), String(w)])) : null,
    never: set(opts.never), lex: opts.lexicon || null, conj: opts.conj || null,
  };
}

/** @param {string} input @param {string | string[]} accepted @param {CheckOptions} [opts] @returns {CheckResult} */
function check(input, accepted, opts = {}) {
  const strictCase = !!opts.strictCase, useSlots = opts.slots !== false, anywhere = !!opts.anywhere, typos = opts.typos !== false;
  const loose = opts.loose ? new Set([...opts.loose].map(w => fold(String(w).toLowerCase()))) : null;
  const list = (Array.isArray(accepted) ? accepted : [accepted]).filter(a => a != null && String(a).trim() !== '');
  const inp = nfc(input).replace(/\s+/g, ' ').trim();
  /** @type {CheckResult} */
  const res = { ok: false, exact: false, close: false, articleMiss: false, caseMiss: false, matched: null, others: list.slice(), fixed: list[0] ? tidy(list[0]) : '', typos: [], input: inp };
  const b1 = opts.endings || opts.umlaut || opts.strict || opts.caseRef || opts.slotMax;
  if (b1) Object.assign(res, { umlautMiss: [], capMiss: [], focusMiss: [], nearest: null });
  const toks = words(inp);
  if (!toks.length || !list.length) return res;
  const pats = list.map(a => compile(a, useSlots, !anywhere));
  const x = xOpts(opts);
  const aopts = { anywhere, typos, loose, x, slotMax: opts.slotMax || 6 };

  // 1. best match over all accepted strings: fewest typos, then exact spelling, then list order
  let hit = -1;
  /** @type {Alignment | null} */ let best = null;
  for (let k = 0; k < pats.length; k++) {
    const m = align(pats[k], toks, aopts);
    if (m && (!best || m.n < best.n || (m.n === best.n && m.exact && !best.exact))) { best = m; hit = k; }
  }
  if (best) {
    const b = /** @type {Alignment & {toks: Word[]}} */ (best);
    b.toks = toks;
    const p = pats[hit];
    res.matched = list[hit]; res.others = list.filter((_, k) => k !== hit); res.fixed = display(p, inp, b);
    res.typos = [];
    const umlautMiss = /** @type {Slip[]} */ (res.umlautMiss);
    for (const s of b.steps) (s.cs || []).forEach(c => {
      if (!c.cost) return;
      // the fix in its written case: the reference's capital (Präsentation), or a capital where he typed one
      const t = toks[c.ti];
      const ref = opts.caseRef && typeof opts.caseRef.get === 'function' ? opts.caseRef.get(c.a.n) : null;
      let expected = ref || c.a.word;
      if (/^\p{Lu}/u.test(t.raw)) expected = expected.charAt(0).toUpperCase() + expected.slice(1);
      const miss = { typed: t.raw, expected, start: t.start, end: t.end };
      (c.umlaut ? umlautMiss : res.typos).push(miss);
    });
    // where the pattern sits in the answer, and what each slot took (in order)
    let s0 = Infinity, e0 = -1;
    /** @type {string[]} */ const fills = [];
    for (const s of b.steps) {
      const e = p.els[s.ei];
      if (e.t === 'slot') {
        if (!s.len) { fills.push(''); continue; }
        const a = toks[s.ti], z = toks[s.ti + s.len - 1];
        fills.push(inp.slice(a.start, z.end)); s0 = Math.min(s0, a.start); e0 = Math.max(e0, z.end);
        continue;
      }
      for (const c of s.cs || []) { const t = toks[c.ti]; s0 = Math.min(s0, t.start); e0 = Math.max(e0, t.end); }
    }
    res.span = e0 >= 0 ? [s0, e0] : null; res.fills = fills;
    if (strictCase && caseDiffers(p, b)) { res.caseMiss = true; return res; }
    res.ok = true; res.exact = b.exact && !res.typos.length && !(res.umlautMiss || []).length;
    if (b1) caseChecks(/** @type {CheckResult & {focusMiss: Slip[], capMiss: Slip[]}} */ (res), b, inp, x, opts.caseRef);
    if (res.focusMiss && res.focusMiss.length) { res.ok = false; res.exact = false; }
    return res;
  }

  // 2. nouns: right word (typos allowed), wrong or missing article
  if (opts.pos === 'noun') {
    const ARTICLES = L.grading.articles;
    const rest = ARTICLES.includes(toks[0].n) ? toks.slice(1) : toks;
    for (let k = 0; k < pats.length && rest.length; k++) {
      const p = pats[k], first = p.els[0];
      if (!first || first.t !== 'w' || !ARTICLES.includes(first.alts[0].n)) continue;
      if (align({ els: p.els.slice(1) }, rest, { anywhere: false, typos, loose })) {
        res.articleMiss = true; res.matched = list[k]; res.fixed = tidy(list[k]); res.others = list.filter((_, j) => j !== k);
        return res;
      }
    }
    return res;
  }

  // 3. close: at least half of a pattern's fixed words are in the answer (typos allowed)
  for (let k = 0; k < pats.length; k++) {
    const fixedWords = /** @type {WEl[]} */ (pats[k].els.filter(e => e.t === 'w'));
    if (fixedWords.length < 2) continue;
    const found = fixedWords.filter(w => toks.some(t => wcost(w, t, typos, loose))).length;
    if (found * 2 >= fixedWords.length) { res.close = true; break; }
  }
  if (b1) {   // the accepted string closest to the answer: the most fixed words found (ties: list order)
    let bestK = 0, bestF = -1;
    pats.forEach((p, k) => {
      const fw = p.els.flatMap(e => e.t === 'w' ? [e] : e.t === 'opt' ? e.words : /** @type {WEl[]} */ ([]));
      const f = fw.filter(w => toks.some(t => wcost(w, t, typos, loose, x))).length - 0.01 * Math.max(0, fw.length - toks.length);
      if (f > bestF) { bestF = f; bestK = k; }
    });
    res.nearest = bestK;
  }
  return res;
}

// ---- the rest of the sentence on a phrase card ----
// A phrase card grades one phrase: the highlighted part of an English sentence. restCheck() grades the rest of what he
// typed: it has to be the model sentence around the phrase he used (with the same typo rules), a saved variant, or a
// part of one of them that holds the phrase ("vor allem die vielen Cafés"). The model's slot words fill the slots of
// every accepted phrase, so slot words are checked word for word too ("dass wir das Geschenk zusammen kaufen").
//   restCheck(input, base, accepted, opts) → {status: 'ok'|'differs'|'na', frag, ref, typos, umlautMiss, marks, wrong}
//     base: the model sentence. opts: check()'s B1 options, plus matched (the accepted pattern his answer matched; its
//     sentence comes first), variants (whole sentences confirmed right) and caseRef (Map: folded word → written form).
//     'na': the model does not hold an accepted phrase, so there is nothing to compare with.
//     ref: the sentence compared with (the closest one when the rest differs); marks: ranges in ref to highlight
//     (whole words, or the differing ending of a word he nearly had); wrong: ranges in the answer that differ.
const SLOT_RE = /\(\[[^\]]*\]\)|\[[^\]]*\]/g;
// the clause shape of a pattern (the pack's: which words decide the word order and the Perfekt helper)
/** @param {unknown} p @returns {Shape} */
const shapeOf = p => L.grammar.clauses.shape(words(String(p || '').replace(SLOT_RE, ' ')).map(w => w.n));
// whether two patterns may stand in for each other (de: the same word order, and not sein where the other has haben)
const sameShape = (/** @type {Shape} */ a, /** @type {Shape} */ b) => L.grammar.clauses.same(a, b);
/** @param {string} p @param {string[]} fills */
function fillSlots(p, fills) {
  const n = (String(p).match(SLOT_RE) || []).length;
  if (!n) return String(p);
  if (n !== fills.length) return null;
  let k = 0, bad = false;
  const out = String(p).replace(SLOT_RE, m => { const f = fills[k++]; if (!f && m[0] === '[') bad = true; return f ? ` ${f} ` : ' '; });
  return bad ? null : out.replace(/\s+/g, ' ').trim();
}
// Whether another pattern may take the model's slot words: each filled slot is followed by a fixed word in both, so
// the clause's verb is in the patterns, never among the words moved ("ich finde [x]" must not take "ist das eine gute
// Idee" from "meiner meinung nach [x]": *ich finde ist das …).
/** @param {string} p @param {string} own @param {string[]} fills @param {boolean} [strict] for display: the same words around the slot */
function borrowable(p, own, fills, strict = false) {
  if (p === own) return true;
  // per slot: whether a fixed word follows it, the fixed word before it, and the fixed words after it (to the next slot)
  const ctx = (/** @type {string} */ q) => {
    const els = compile(q, true, false).els;
    /** @type {{end: boolean, before: string, after: Set<string>, last: string}[]} */ const out = [];
    els.forEach((e, i) => {
      if (e.t !== 'slot') return;
      const prev = els[i - 1], after = new Set();
      let last = '';
      for (let k = i + 1; k < els.length && els[k].t !== 'slot'; k++) { const x = els[k]; if (x.t === 'w' && !L.grammar.slots.helpers.has(x.alts[0].n)) { after.add(x.alts[0].n); last = x.alts[0].n; } }
      out.push({ end: !(i + 1 < els.length && els[i + 1].t === 'w'), before: prev && prev.t === 'w' ? prev.alts[0].n : '', after, last });
    });
    return out;
  };
  const a = ctx(p), b = ctx(own);
  if (a.length !== b.length) return false;
  return fills.every((f, k) => {
    if (!words(f || '').length) return true;
    const x = a[k], y = b[k];
    // the verb is in the patterns (no slot at the end); words with a case or a preposition (die Materialien, zum
    // Gespräch) move only where the same verb governs them (teilnehmen does not take "zum Gespräch" from kommen) and the
    // same preposition stands before the slot (für/mit take other cases). Adverbs (unbedingt, mehr, kurz) move freely.
    if (y.end) return false;
    // the same words after the slot, in any order (dass [x] faul sind / [x] sind faul), or the same last word there: the
    // verb at the end of the clause (über deine E-Mail / Nachricht gefreut)
    const governed = (x.after.size === y.after.size && [...y.after].every(w => x.after.has(w))) || (!!x.last && x.last === y.last);
    if (strict) return governed && x.before === y.before;
    // a time phrase or one adverb moves freely; other words only under the same verb (das liegt daran, dass man ([x])
    // zu viel arbeitet does not take "viele Menschen", the subject of … dass ([x]) zu viel arbeiten)
    const fw = words(f), S = L.grammar.slots;
    if (S.timePhrase.test(fold(f.toLowerCase())) || (fw.length === 1 && S.adverbs.has(fw[0].n))) return true;
    return governed && (x.before === y.before || (!S.prepositions.has(x.before) && !S.prepositions.has(y.before)));
  });
}
// (the pack's slot rules: a time phrase or one adverb moves freely; helpers do not govern a slot; prepositions do)
// a pattern (slots filled) as text in the sentence: the base sentence's spelling of each word, nouns from caseRef
/** @param {string} mid @param {string} base @param {Map<string, string> | null | undefined} caseRef @param {boolean} initial @param {any} [conj] */
function renderIn(mid, base, caseRef, initial, conj = null) {
  /** @type {Map<string, string>} */ const ref = new Map();
  String(base).normalize('NFC').split(/(?<=[.!?:])\s+/).forEach(sent => words(sent).forEach((w, i) => { if (i && !ref.has(w.low)) ref.set(w.low, w.raw); }));
  // a word with alternatives (fiel(en), erzielte(n)): the model's own, else the one its verb's frame takes
  const B = words(base), fr = conj && L.grammar.verbs ? frameOf(conj, String(base)) : null;
  const pick = (/** @type {WEl} */ e) => {
    const own = e.alts.find(a => B.some(b => b.n === a.n));
    if (own) return own.word;
    if (!fr) return null;
    const fit = e.alts.find(a => { const an = conj.lookup(a.n); return fr.some(f => an.some((/** @type {any} */ x) => f.lemmas.has(x.lemma) && f.slots.has(x.slot))); });
    return fit ? fit.word : null;
  };
  let out = display(compile(mid, true, false), '', null, pick).replace(L.text.wordRe, w => ref.get(w.toLowerCase()) || (caseRef && caseRef.get(fold(w.toLowerCase()))) || w.toLowerCase());
  if (initial) out = out.replace(/^(\P{L}*)(\p{L})/u, (_, a, b) => a + b.toUpperCase());
  return out;
}
const joinText = (/** @type {string[]} */ ...parts) => parts.filter(s => s && s.trim()).join(' ').replace(/\s+([,.!?;:])/g, '$1').replace(/\s+/g, ' ').trim();
// patterns carry no commas: put back the base sentence's comma before a clause word it has one before (so, dass …;
// the pack's comma words)
/** @param {string} base @param {string} text */
function commasFrom(base, text) {
  const want = new Set([...String(base).matchAll(/,\s*([\p{L}]+)/gu)].map(m => fold(m[1].toLowerCase())).filter(w => L.grammar.punctuation.commaWords.has(w)));
  if (!want.size) return text;
  return String(text).replace(/(?<=[\p{L}\p{N}])(\s+)(\p{L}+)/gu, (all, sp, w) => want.has(fold(w.toLowerCase())) ? `,${sp}${w}` : all);
}
/**
 * Whether a sentence made by putting another phrase into the model is the model with one of its forms broken: the
 * model's verb in a form its frame does not take (the pack's clashes), or an article of the model's noun in another
 * case or gender (zu den Frage for zu der Frage: one word for one word, the same family, the noun after it kept).
 * Other wordings (was sie meinen for was du meinst) are not judged here.
 * @param {string} text @param {string} base @param {any} conj
 */
function brokenForms(text, base, conj) {
  const A = words(text), B = words(base), V = L.grammar.verbs;
  if (V && V.clashes(A, B, base, conj).length) return true;
  const G = gaps(A, B).gaps;
  return G.some(g => {
    if (g.a.length !== 1 || g.b.length !== 1) return false;
    const a = A[g.a[0]], b = B[g.b[0]], f = family(a.n);
    return f >= 0 && f === family(b.n) && a.n !== b.n && L.grading.articles.includes(b.n) && g.b[0] + 1 < B.length && A[g.a[0] + 1] && A[g.a[0] + 1].n === B[g.b[0] + 1].n && /^\p{Lu}/u.test(B[g.b[0] + 1].raw);
  });
}
/** @param {any} mr a check() result with a span */
const span0Of = mr => /** @type {[number, number]} */ (mr.span)[0];
// per verb index: each model sentence's frame (the pack's frameSlots) and which patterns keep its forms (restCheck)
/** @type {WeakMap<object, Map<string, any>>} */ const FRAMES = new WeakMap();
/** @type {WeakMap<object, Map<string, Map<string, boolean>>>} */ const FORMS_OK = new WeakMap();
/** @param {any} conj @param {string} base */
function frameOf(conj, base) {
  let m = FRAMES.get(conj);
  if (!m) { m = new Map(); FRAMES.set(conj, m); }
  let f = m.get(L.id + '|' + base);
  if (!f) { f = /** @type {any} */ (L.grammar.verbs).frameSlots(base, words(base), conj); if (m.size > 20000) m.clear(); m.set(L.id + '|' + base, f); }
  return f;
}
/** @param {any} conj @param {string} base @returns {Map<string, boolean> | null} */
function formsCache(conj, base) {
  if (!conj) return null;
  let m = FORMS_OK.get(conj);
  if (!m) { m = new Map(); FORMS_OK.set(conj, m); }
  let f = m.get(L.id + '|' + base);
  if (!f) { f = new Map(); if (m.size > 20000) m.clear(); m.set(L.id + '|' + base, f); }
  return f;
}
// a word twice in a row that the pattern does not have twice: another pattern's slot took the model's words
// ("… dass man ([x]) spät isst" with the model's "normalerweise sehr spät" gives "sehr spät spät isst")
const doubled = (/** @type {string} */ text, /** @type {string} */ p) => {
  const has = (/** @type {string} */ s) => { const ws = words(s).map(w => w.n); return ws.some((w, i) => i && w === ws[i - 1]); };
  return has(text) && !has(String(p).replace(SLOT_RE, ' '));
};

// Words that never change form and add only emphasis or a nuance (the pack's slots.particles): he may add them, or use
// another one, where an accepted pattern has a slot (ich stimme Rainer [nur] teilweise zu).
/** @type {PartEl} */
const PART = { t: 'part', raw: '' };
/**
 * A pattern with its slots filled by the model's words, for the rest check: each slot becomes [particles] fill
 * [particles], and a fill word that is a particle may be left out or swapped for another. null when a slot that must
 * hold words has none (as fillSlots).
 * @param {string} p @param {string[]} fills @returns {El[] | null}
 */
function slotParts(p, fills) {
  const els = compile(p, true, false).els;
  const n = els.filter(e => e.t === 'slot').length;
  if (n && n !== fills.length) return null;
  /** @type {El[]} */ const out = [];
  let k = 0;
  for (const e of els) {
    if (e.t !== 'slot') { out.push(e); continue; }
    const f = fills[k++];
    if (!f && !e.opt) return null;
    // a slot that must hold words keeps its words when they are all particles (wenn das Wetter [x] ist: not empty)
    const fw = words(f || ''), keep = !e.opt && fw.every(w => L.grammar.slots.particles.has(w.n));
    out.push(PART);
    for (const w of fw) {
      /** @type {WEl} */ const el = { t: 'w', raw: w.raw, alts: [{ n: w.n, low: w.low, len: w.len, word: w.raw }] };
      // a particle of the model may be left out (or swapped by the particles around it), and keeps its typo rules
      out.push(L.grammar.slots.particles.has(w.n) && !keep ? { t: 'opt', words: [el], raw: w.raw } : el);
    }
    out.push(PART);
  }
  return out;
}
/**
 * @param {Word[]} toks @param {{n: number, steps: Step[]}} m @param {RestResult} res  the slips of an alignment, into res
 */
function slipsOf(toks, m, res) {
  for (const st of m.steps) for (const cs of st.cs || []) {
    if (!cs.cost) continue;
    const t = toks[cs.ti];
    (cs.umlaut ? res.umlautMiss : res.typos).push({ typed: t.raw, expected: cs.a.word, start: t.start, end: t.end });
  }
  return res;
}

/**
 * @typedef {object} RestResult
 * @property {'ok'|'differs'|'na'} status @property {boolean} frag @property {string} ref @property {Slip[]} typos
 * @property {Slip[]} umlautMiss @property {Range[]} marks @property {Wrong[]} wrong
 */
/**
 * @param {string} input @param {string} base @param {string | string[]} accepted
 * @param {CheckOptions & {matched?: string | null, variants?: string[]}} [opts]
 * @returns {RestResult}
 */
function restCheck(input, base, accepted, opts = {}) {
  const list = (Array.isArray(accepted) ? accepted : [accepted]).filter(a => a != null && String(a).trim() !== '');
  const inp = nfc(input).replace(/\s+/g, ' ').trim();
  const toks = words(inp);
  /** @type {RestResult} */
  const out = { status: 'na', frag: false, ref: base ? tidy(base) : '', typos: [], umlautMiss: [], marks: [], wrong: [] };
  if (!base || !toks.length || !list.length) return out;
  const slotMax = opts.slotMax || 10;
  const mr = check(base, list, { anywhere: true, slotMax, typos: false });
  if (!mr.ok || !mr.span) return out;
  const pre = base.slice(0, mr.span[0]), post = base.slice(mr.span[1]), fills = /** @type {string[]} */ (mr.fills);
  const order = opts.matched != null && list.includes(opts.matched) ? [opts.matched, ...list.filter(p => p !== opts.matched)] : list;
  // the model's verbs keep their form in the sentence (the pack's verb forms, opts.conj): another phrase goes in only
  // when its form of the same verb is one the model's frame takes (treffen for trifft after "Die Stadt": no; zum opfer
  // gefallen without a helper: no), and an optional word the frame decides (zu) is kept as the model has it
  const conj = opts.conj || null, V = L.grammar.verbs || null;
  const BT = words(base), fr = conj && V ? frameOf(conj, String(base)) : null;
  // the model's verbs in its phrase whose frame is outside the phrase: a phrase that starts the verb's clause brings its
  // own frame (es ist zu befürchten → man befürchtet)
  const span0 = /** @type {[number, number]} */ (mr.span)[0];
  const clauseStart = (/** @type {number} */ k) => { let j = k; while (j > 0 && !/[,;:!?]|(?<!\d)\./.test(String(base).slice(BT[j - 1].end, BT[j].start))) j--; return BT[j].start; };
  const spanIdx = BT.flatMap((t, k) => (t.start >= span0 && t.end <= /** @type {[number, number]} */ (mr.span)[1] && clauseStart(k) < span0 ? [k] : []));
  // the model's determiner before the phrase stays: another phrase that starts with another noun would take it with the
  // wrong gender or case (um den Bedarf → *um den Nachfrage)
  const preDet = (() => { const pw = words(pre); const l = pw[pw.length - 1]; return !!l && L.grading.articles.includes(l.n) && !/[,;:.!?]\s*$/.test(pre); })();
  const spanFirst = words(base.slice(span0Of(mr), /** @type {[number, number]} */ (mr.span)[1]))[0];
  const fitsFrame = (/** @type {string} */ p) => {
    const els = compile(p, true, false).els;
    if (preDet && spanFirst && els[0] && els[0].t === 'w' && !els[0].alts.some(a => a.n === spanFirst.n)) return false;
    if (!fr || !conj) return true;
    // a phrase with its own subject (was meinen Sie for was meinst du) brings its verb's person: only the infinitive,
    // participle and zu are the frame's then
    const ownSubject = els.some(e => e.t === 'w' && L.grammar.slots.subjects && L.grammar.slots.subjects.has(e.alts[0].n));
    for (const e of els) for (const w of e.t === 'w' ? [e] : e.t === 'opt' ? e.words : []) {
      let shared = false, fits = false;
      for (const a of w.alts) {
        const an = conj.lookup(a.n);
        for (const k of spanIdx) {
          const f = fr[k], sh = an.filter(x => f.lemmas.has(x.lemma));
          if (!sh.length || !f.slots.size || (ownSubject && [...f.slots].every(x => /^[12][sp]|3s$/.test(x)))) continue;
          shared = true;
          if (sh.some(x => f.slots.has(x.slot))) fits = true;
        }
      }
      if (shared && !fits) return false;
    }
    return true;
  };
  /** @param {El[] | null} els */
  const keepFrame = els => {
    if (!els || !V) return els;
    /** @type {El[]} */ const out2 = [];
    els.forEach((e, i) => {
      if (e.t !== 'opt' || !e.words.every(w => V.frameOpt.has(w.alts[0].n))) { out2.push(e); return; }
      const next = /** @type {WEl | undefined} */ (els.slice(i + 1).find(x => x.t === 'w'));
      const at = next ? BT.findIndex(t => next.alts.some(a => a.n === t.n)) : -1;
      if (at < 0) { out2.push(e); return; }
      if (at > 0 && e.words.every((w, j) => BT[at - e.words.length + j] && BT[at - e.words.length + j].n === w.alts[0].n)) out2.push(...e.words);
    });
    return out2;
  };
  // another accepted phrase goes into the model sentence only when it has the same shape: the same subordinators and
  // inversion words (ich finde dass … / ich finde …: the verb moves) and the same Perfekt helper (früher habe ich /
  // früher bin ich: the participle decides). The model's own words fill the slots.
  const shape = shapeOf(mr.matched);
  // the sentence shown: optional words only where the model or his answer has them (never "fest" neither wrote)
  const known = new Set([...words(base), ...toks].map(w => w.n));
  // (an ending glued to a word, fiel(en), is not an optional word: renderIn picks the form)
  const shown = (/** @type {string} */ mid) => mid.replace(/(?<!\p{L})\((?!\[)([^)]*)\)/gu, (_, g) => words(g).every(w => known.has(w.n)) ? g : ' ');
  // the sentence shown is always a whole right sentence: the model itself for its own phrase, else the phrase in it
  const text = (/** @type {{pre: string, mid: string, post: string, literal?: boolean, own?: boolean}} */ c) => c.literal ? tidy(c.mid) : c.own ? tidy(base)
    : punctFrom(base, commasFrom(base, joinText(pre, renderIn(shown(c.mid), base, opts.caseRef, !/\p{L}/u.test(pre), conj), post)));
  // (cached per model sentence and pattern: it does not depend on the answer)
  const seenForms = formsCache(conj, base);
  const inBase = new Set(BT.map(w => w.n));
  const keepsForms = (/** @type {string} */ p, /** @type {string} */ mid) => {
    let v = seenForms ? seenForms.get(p) : undefined;
    if (v === undefined) {
      const m2 = mid.replace(/(?<!\p{L})\((?!\[)([^)]*)\)/gu, (_, g) => words(g).every(w => inBase.has(w.n)) ? g : ' ');
      const t2 = punctFrom(base, commasFrom(base, joinText(pre, renderIn(m2, base, opts.caseRef, !/\p{L}/u.test(pre), conj), post)));
      v = !brokenForms(t2, base, conj);
      if (seenForms) seenForms.set(p, v);
    }
    return v;
  };
  /** @type {{pre: string, mid: string, post: string, literal?: boolean, els?: El[], own?: boolean}[]} */ const cands = [];
  // A phrase of another shape still goes in, with nothing in its slots (only particles), where swapping the clause
  // cannot change the words around it: the phrase ends its sentence after a main clause or a full stop (…, denn ich muss
  // arbeiten → …, weil ich arbeiten muss), or it is a subordinate clause that opens the sentence and the other one is
  // too (Obwohl … ist, … → Auch wenn … ist, …).
  const wordsIn = (/** @type {string} */ t) => words(t).map(w => w.n);
  const ends = !/\p{L}/u.test(post) || /^\s*[.!?;:]/u.test(post);
  const after = !/\p{L}/u.test(pre) || /[.!?:]\s*$/u.test(pre) || (/,\s*$/.test(pre) && !wordsIn(pre).some(w => L.grammar.clauses.subordinators.has(w)));
  const subOnly = (/** @type {Shape} */ sh) => /^[^|]+\|$/.test(sh.clause);
  const swappable = (/** @type {Shape} */ sh) => (ends && after) || (!/\p{L}/u.test(pre) && /^\s*,/.test(post) && subOnly(sh) && subOnly(shape));
  for (const p of order) {
    if (p !== mr.matched && !fitsFrame(p)) continue;
    if (p !== mr.matched && !sameShape(shapeOf(p), shape)) {
      if (!swappable(shapeOf(p))) continue;
      const none = fills.map(() => ''), mid = fillSlots(p, none), els = keepFrame(slotParts(p, none));
      if (mid != null && els) cands.push({ pre, mid, post, els });
      continue;
    }
    if (!borrowable(p, String(mr.matched), fills)) continue;
    const mid = fillSlots(p, fills), els = keepFrame(slotParts(p, fills));
    if (mid == null || !els || doubled(mid, p)) continue;
    // the model's own phrase with the model's own words: the model sentence itself. Another phrase goes in only where the
    // sentence it makes is not the model with one of its words in another form (zu den Frage for zu der Frage; Die
    // Stadt treffen for trifft): the words around the phrase decide those forms
    if (p !== mr.matched && conj && !keepsForms(p, mid)) continue;
    cands.push({ pre, mid, post, els, own: p === mr.matched });
  }
  for (const v of opts.variants || []) if (v) cands.push({ pre: '', mid: String(v), post: '', literal: true });
  const x = xOpts({ ...opts, endings: opts.endings !== false });
  const typos = opts.typos !== false;
  /** @type {AlignOpts} */ const aopts = { anywhere: false, typos, loose: null, x, slotMax };
  const first = toks[0], last = toks[toks.length - 1];
  const fits = (/** @type {El | undefined} */ e, /** @type {Word} */ t, /** @type {boolean} */ atEnd) => !e || e.t !== 'w' || !!wcost(e, t, typos, null, x) || e.alts.some(a => a.n && (atEnd ? t.n.endsWith(a.n) : t.n.startsWith(a.n)));
  for (const c of cands) {
    const P = compile(c.pre, false, false).els, M = c.els || compile(c.mid, !c.literal, false).els, Q = compile(c.post, false, false).els;
    for (let s = 0; s <= P.length; s++) {
      const head = s < P.length ? P[s] : M[0];
      if (head && head.t === 'w' && !fits(head, first, false)) continue;
      for (let e = Q.length; e >= 0; e--) {
        const tail = e > 0 ? Q[e - 1] : M[M.length - 1];
        if (tail && tail.t === 'w' && !fits(tail, last, true)) continue;
        const m = align({ els: [...P.slice(s), ...M, ...Q.slice(0, e)] }, toks, aopts);
        if (!m) continue;
        return slipsOf(toks, m, { ...out, status: 'ok', frag: s > 0 || e < Q.length, ref: text(c), typos: [], umlautMiss: [] });
      }
    }
  }
  // the whole answer is one of the accepted sentences: an accepted pattern from his first word to his last, whose slots
  // hold nothing, only particles, or the model's own words for that slot. Borrowed words are taken only slot for slot
  // and where a fixed word follows the slot in both patterns, so the verb is never among them (rainer meint ([x]) sind
  // faul takes "Menschen mit einer Vier-Tage-Woche" from rainer schreibt dass ([x]) faul sind; ich finde [x] does not
  // take "das eine gute Idee ist" from ich finde dass [x]).
  const own = compile(mr.matched || '', true, false).els;
  const slotsOf = (/** @type {El[]} */ els) => els.flatMap((e, i) => e.t === 'slot' ? [i] : []);
  const fixedNext = (/** @type {El[]} */ els, /** @type {number} */ i) => i + 1 < els.length && els[i + 1].t === 'w';
  const content = (/** @type {Word[]} */ ws) => ws.filter(w => !L.grammar.slots.particles.has(w.n)).map(w => w.n).join(' ');
  const ownSlots = slotsOf(own);
  for (const p of order) {
    const pat = compile(p, true, false), m = align(pat, toks, aopts);
    if (!m) continue;
    const pSlots = slotsOf(pat.els);
    /** @type {string[]} */ const borrowed = [];
    let fine = true;
    for (const st of m.steps) {
      const e = pat.els[st.ei];
      if (e.t !== 'slot' || !st.len) continue;
      const said = content(toks.slice(st.ti, st.ti + st.len));
      // particles alone only in an optional slot (wenn das Wetter [x] ist needs a word)
      if (!said) { if (!e.opt) fine = false; continue; }
      if (!fixedNext(pat.els, st.ei)) { fine = false; break; }
      // words of the model sentence outside its phrase, in their order (entschuldigen Sie den Lärm | am Samstag →
      // ich möchte mich für den Lärm ([x]) entschuldigen)
      if ([pre, post].some(t => ` ${content(words(t))} `.includes(` ${said} `))) continue;
      borrowed.push(said);
    }
    // the other slot words are the model's own slot words, in the same order, split over the slots as he likes (hast du
    // ([x]) lust ([x]) ins kino zu gehen: am Samstag | mit mir); never from a model slot that ends its pattern
    const modelFill = fills.map(f => content(words(f || ''))).filter(Boolean).join(' ');
    const ownSafe = ownSlots.every((i, k) => !content(words(fills[k] || '')) || fixedNext(own, i));
    // and the words that govern them are the model's: the slots line up (borrowable), or the pattern is the model's own
    // pattern with words or slots added (hast du ([x]) lust ([x]) ins kino zu gehen)
    const fixedOf = (/** @type {El[]} */ els) => new Set(els.flatMap(e => e.t === 'w' ? [e.alts[0].n] : []));
    const ownFixed = fixedOf(own), pFixed = fixedOf(pat.els);
    const governed = borrowable(p, String(mr.matched), fills) || [...ownFixed].every(w => pFixed.has(w));
    if (fine && borrowed.length && !(ownSafe && governed && borrowed.join(' ') === modelFill)) fine = false;
    // and a slot he left empty is empty in the model too, or its words are elsewhere in his answer (es gibt zwar Busse,
    // aber sie sind ([x]) zu spät: the model has oft there, and without it the sentence says something else). A pattern
    // without slots is a whole sentence as written.
    if (fine && pSlots.length === ownSlots.length) {
      for (const st of m.steps) {
        const k = pSlots.indexOf(st.ei);
        const missing = k >= 0 && !st.len && words(fills[k] || '').some(w => !L.grammar.slots.particles.has(w.n) && !toks.some(t => t.n === w.n));
        if (missing) { fine = false; break; }
      }
    }
    if (fine) return slipsOf(toks, m, { ...out, status: 'ok', frag: false, ref: tidy(inp), typos: [], umlautMiss: [] });
  }
  // nothing fits: the closest sentence (most words in common, his phrase first on a tie) and the word diff
  // (no candidate at all is not expected: best stays null, as it always has)
  let best = /** @type {string} */ (/** @type {unknown} */ (null)), bestN = -1;
  for (const c of cands) {
    const ref = text(c), n = lcsWords(words(inp), words(ref));
    if (n > bestN) { bestN = n; best = ref; }
  }
  return { ...out, status: 'differs', ref: best, ...markDiff(inp, best) };
}
/** @param {Word[]} A @param {Word[]} B @param {(a: Word, b: Word) => boolean} [eq] */
function lcsTable(A, B, eq = (a, b) => a.n === b.n) {
  const L = Array.from({ length: A.length + 1 }, () => new Array(B.length + 1).fill(0));
  for (let i = A.length - 1; i >= 0; i--) for (let j = B.length - 1; j >= 0; j--) L[i][j] = eq(A[i], B[j]) ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  return L;
}
const lcsWords = (/** @type {Word[]} */ A, /** @type {Word[]} */ B) => lcsTable(A, B)[0][0];
// the LCS walk as gaps: [{a: [indexes in A], b: [indexes in B]}] between matched words, plus the matched pairs
/** @typedef {{a: number[], b: number[], lead: boolean, trail?: boolean}} Gap */
/** @param {Word[]} A @param {Word[]} B */
function gaps(A, B) {
  const L = lcsTable(A, B);
  /** @type {Gap[]} */ const out = [];
  /** @type {[number, number][]} */ const pairs = [];
  let i = 0, j = 0;
  /** @type {Gap} */ let cur = { a: [], b: [], lead: true };
  while (i < A.length || j < B.length) {
    if (i < A.length && j < B.length && A[i].n === B[j].n) { out.push(cur); pairs.push([i, j]); cur = { a: [], b: [], lead: false }; i++; j++; }
    else if (j >= B.length || (i < A.length && L[i + 1][j] >= L[i][j + 1])) cur.a.push(i++);
    else cur.b.push(j++);
  }
  cur.trail = true; out.push(cur);
  return { gaps: out.filter(g => g.a.length || g.b.length), pairs };
}
// he nearly had it: the same word up to its ending, or the same but for an umlaut
const nearly = (/** @type {Word} */ a, /** @type {Word} */ b) => commonPrefix(a.low, b.low) >= 3 || sameButMarks(a.low, b.low);
// the same word but for its marks (de: umlauts), by the pack's mark slip
const sameButMarks = (/** @type {string} */ a, /** @type {string} */ b) => { const mk = L.grading.slips.marks; return !!mk && mk.base(a) === mk.base(b); };
const commonPrefix = (/** @type {string} */ a, /** @type {string} */ b) => { let p = 0; while (p < a.length && p < b.length && a[p] === b[p]) p++; return p; };
// Word diff of an answer a against a right sentence b: the words of a that differ (wrong) and the parts of b to mark.
// A word he nearly had is marked from its first differing letter (from the ending when that is where it differs:
// viel[en]); others whole. Words of b before or after everything he wrote are not marked when he wrote nothing there
// (an answer that is a part of the sentence).
/** @param {string} a @param {string} b @returns {{wrong: Wrong[], marks: Range[]}} */
function markDiff(a, b) {
  const A = words(a), B = words(b), { gaps: G } = gaps(A, B);
  /** @type {Wrong[]} */ const wrong = [];
  /** @type {Range[]} */ const marks = [];
  for (const g of G) {
    if ((g.lead || g.trail) && !g.a.length) continue;
    g.a.forEach(i => wrong.push({ start: A[i].start, end: A[i].end, word: A[i].raw }));
    g.b.forEach((j, k) => {
      const w = B[j], t = g.a[k] != null ? A[g.a[k]] : null;
      let from = w.start;
      if (t && nearly(t, w)) {
        const p = commonPrefix(t.low, w.low), end = w.raw.length - ending(w.n).length;
        if (p < w.raw.length) from = w.start + Math.min(p, end);
      }
      marks.push({ start: from, end: w.end });
    });
  }
  return { wrong, marks };
}

// ---- "Also correct": the other accepted answers, written the way the model is ----
// alsoLines(model, accepted, caseRef) → [{pattern, text}] for every accepted pattern that can be written out as German
// with the model's punctuation: one with the model's clause structure (sameShape), its slots filled with the model's
// words, its words in the model's spelling and capitals (nouns from caseRef), the model's commas, colons and the like
// after the same words and before the same clause words (Ich würde vorschlagen, dass wir uns am Bahnhof treffen). A
// pattern of another clause structure (ich hoffe, es geht dir gut for ich hoffe, dass …) needs commas the model
// cannot give, so it is left out. Returns null when the model holds no accepted pattern.
/** @param {string} base @param {string} text */
function punctFrom(base, text) {
  const B = words(base);
  // the mark after a word (where the same word follows it), and a full stop, ! ? or colon before a word, in the model
  /** @type {Map<string, {mk: string, next: string}>} */ const after = new Map();
  /** @type {Map<string, string>} */ const before = new Map();
  /** @type {Set<string>} */ const twice = new Set();
  B.forEach((w, i) => {
    if (after.has(w.n)) twice.add(w.n);
    const mk = i + 1 < B.length ? (base.slice(w.end, B[i + 1].start).match(/^[,;:.!?]+/) || [''])[0] : '';
    after.set(w.n, { mk, next: i + 1 < B.length ? B[i + 1].n : '' });
    if (i + 1 < B.length && /^[.!?:]/.test(mk)) before.set(B[i + 1].n, mk);
  });
  const T = words(text);
  /** @type {Map<string, number>} */ const seen = new Map();
  for (const w of T) seen.set(w.n, (seen.get(w.n) || 0) + 1);
  const once = (/** @type {Word} */ w) => !twice.has(w.n) && seen.get(w.n) === 1;
  let out = '', at = 0;
  T.forEach((w, i) => {
    out += text.slice(at, w.end); at = w.end;
    if (i + 1 >= T.length || /^\s*[,;:.!?…]/.test(text.slice(w.end))) return;
    const nx = T[i + 1], a = once(w) ? after.get(w.n) : null;
    out += (a && a.mk && a.next === nx.n ? a.mk : '') || (once(nx) ? before.get(nx.n) || '' : '');
  });
  out += text.slice(at);
  // a capital after a full stop, ! or ?, and after a colon where the model has one (Zu deiner Frage: Der Kurs …)
  out = out.replace(/(?<!\d)([.!?]\s+)(\p{Ll})/gu, (_, sp, c) => sp + c.toUpperCase());   // not after an ordinal (vom 1. bis)
  return /:\s+\p{Lu}/u.test(base) ? out.replace(/(:\s+)(\p{Ll})/gu, (_, sp, c) => sp + c.toUpperCase()) : out;
}
// The commas the pack writes into a line: before a subordinate clause (de: dass, weil …; not after und/oder), and
// before a main clause after an opinion verb or an infinitive group (Ich finde, das ist …)
const clauseCommas = (/** @type {string} */ text) => L.grammar.punctuation.clauseCommas(text);
const subCommas = (/** @type {string} */ text) => L.grammar.punctuation.subCommas(text);
// the pack's line rules (lines.*): which words start a question, stand like a determiner, open a sentence, are polite
// or not only by the model, are interjections, are contractions before a noun, and the word that needs a comma
/**
 * @param {string} base @param {string | string[]} accepted @param {Map<string, string> | null} [caseRef]
 * @param {Set<string> | null} [lower]  folded words known to be written in lower case; with it, a line with a word whose
 *   capital is not known (not in the model, caseRef, lower or the closed words) is left out
 * @param {boolean} [standalone]  each line is a whole utterance (a situation's answer): it starts with a capital
 * @param {LanguagePack | null} [pack]  the language (default: the call's, else the active pack)
 * @returns {{pattern: string, text: string}[] | null}
 */
function alsoLines(base, accepted, caseRef = null, lower = null, standalone = false, pack = null) {
  void pack;   // read by the exported wrapper (inPack)
  const { questionStarts: QUESTION, determinerLike: DETLIKE, openers: OPENERS, polite: POLITE, interjections: INTERJ, contractions, contrast } = L.grammar.lines;
  const CLOSED = L.grading.closedClass;
  const list = (Array.isArray(accepted) ? accepted : [accepted]).filter(a => a != null && String(a).trim() !== '');
  if (!base || !list.length) return null;
  const phrase = check(base, list, { anywhere: true, slotMax: 10, typos: false });
  if (!phrase.ok || !phrase.span) return null;
  // the slot words: from the whole model when a pattern covers it (Einverstanden! Dann treffen wir uns [um sieben])
  const whole = check(base, list, { slotMax: 10, typos: false });
  const mr = whole.ok ? whole : phrase;
  const own = String(mr.matched), fills = /** @type {string[]} */ (mr.fills);
  const shape = shapeOf(own);
  const pre = base.slice(0, /** @type {[number, number]} */ (phrase.span)[0]);
  const startsUpper = /^\P{L}*\p{Lu}/u.test(base);   // a line after a greeting's comma starts in lower case
  const preWords = words(pre).map(w => w.n).filter(n => !L.grammar.slots.particles.has(n));
  const sentStart = /[.!?]\s*$/u.test(pre);   // the phrase opens a sentence of the model: a capital, no end mark of its own
  const postWords = words(base.slice(/** @type {[number, number]} */ (phrase.span)[1])).map(w => w.n);
  const inModel = new Set(words(base).map(w => w.n));
  const finalMark = (base.match(/[.!?]+\s*$/) || [''])[0].trim();
  const closes = whole.ok || !/\p{L}/u.test(base.slice(/** @type {[number, number]} */ (phrase.span)[1]));
  // marks inside the model (or inside its phrase): a line with fewer has lost a comma (du weißt ja ich bin …)
  const inner = (/** @type {string} */ t) => (t.replace(/[.!?]+\s*$/u, '').match(/[,;:.!?]/g) || []).length;
  const span = /** @type {[number, number]} */ (phrase.span);
  const marks = closes && !/\p{L}/u.test(pre) ? inner(base) : inner(base.slice(span[0], span[1]));
  // full stops, ! and ? inside: the same number as the model's (no "das? Klingt gut" from a cut sentence)
  const stops = (/** @type {string} */ t) => (t.replace(/[.!?]+\s*$/u, '').match(/[.!?](?=\s)/g) || []).length;
  const stopsIn = closes && !/\p{L}/u.test(pre) ? stops(base) : stops(base.slice(span[0], span[1]));
  // words the model has only at the start of a sentence: their capital there says nothing (Liebe Clara → meine liebe Clara)
  const initialOnly = new Set();
  const midWords = new Set();
  String(base).split(/(?<=[.!?:])\s+/).forEach(sent => words(sent).forEach((w, i) => (i ? midWords : initialOnly).add(w.n)));
  for (const n of midWords) initialOnly.delete(n);
  /** @type {{pattern: string, text: string}[]} */ const out = [];
  for (const p of list) {
    if (!sameShape(shapeOf(p), shape)) continue;
    // optional words only where the model has them: (etwas) (was) are two ways to say it, not one phrase
    // (a group that opens the pattern stays: (ich bin) anderer meinung)
    const q = p.trim().replace(/\((?!\[)([^)]*)\)/g, (m, g, at) => at === 0 || words(g).every(w => inModel.has(w.n)) ? g : ' ');
    // the model's slot words where the same words govern them (borrowable, strict), else a slot that holds words in
    // the model shows as …, and an empty one goes
    const own2 = fillSlots(q, fills);
    const nSlots = (p.match(SLOT_RE) || []).length;
    // slots that do not line up with the model's cannot be shown faithfully (zu einfach would lose its zu)
    if (nSlots !== fills.length && fills.some(f => words(f).length)) continue;
    let text0;
    if (own2 != null && borrowable(p, own, fills, true) && !doubled(own2, p)) text0 = own2;
    else {
      let k = 0;
      text0 = q.replace(SLOT_RE, m => { const f = fills[k++]; return f || m[0] === '[' ? ' [x] ' : ' '; }).replace(/\s+/g, ' ').trim();
    }
    const has = words(text0).map(w => w.n);
    if (lower && has.some(n => !inModel.has(n) && !CLOSED.has(n) && !lower.has(n) && !(caseRef && caseRef.has(n)) && !/\d/.test(n))) continue;
    // a word after an article, a number or a preposition that the model does not have and no noun list knows: it may
    // be a noun written in lower case (vier teile, das leben, eine frage, ohne kosten)
    if (has.some((n, i) => i > 0 && DETLIKE.has(has[i - 1]) && !inModel.has(n) && !CLOSED.has(n) && !(caseRef && caseRef.has(n)) && !/\d/.test(n))) continue;
    // sie, ihr, ihnen: polite (Sie) or not is known only from the model
    if (has.some(n => POLITE.has(n) && !inModel.has(n) && !(caseRef && caseRef.has(n)))) continue;
    // an interjection run into the next word needs a comma the model cannot give (Okay, machen wir das so)
    if (has.length > 1 && INTERJ.has(has[0]) && !(inModel.has(has[0]) && inModel.has(has[1]))) continue;
    // aber inside a line: a comma before it, or a particle (das ist aber schön); not known without the model
    if (has.some((n, i) => i > 0 && n === contrast) && !new RegExp(`,\\s*${contrast}\\b`, 'i').test(base)) continue;
    // a line starts the sentence when the phrase does, or when it holds the words before the phrase too (ich kann
    // leider nicht kommen, denn …); otherwise it is the phrase inside the sentence and starts in lower case (denn …)
    const first = !preWords.length || preWords.every(n => has.includes(n));
    if (has.some((n, i) => initialOnly.has(n) && (i > 0 || !first))) continue;
    // a verb after fürs, beim, zum … is a noun there (fürs Zuhören): its capital is not known
    if (has.some((n, i) => i > 0 && contractions.has(has[i - 1]) && !inModel.has(n) && !(caseRef && caseRef.has(n)))) continue;
    // a situation's line is said on its own: a capital when it starts like a sentence (Das sehe ich anders), not on a
    // bare phrase (anderer Meinung)
    const own0 = standalone && OPENERS.has(has[0] || '');
    const text = clauseCommas(commasFrom(base, subCommas(punctFrom(base, renderIn(text0, base, caseRef, (first || own0 || sentStart) && startsUpper))))).replace(/[\s,;:.!?]+$/u, '');
    if (inner(text) < marks || stops(text) !== stopsIn) continue;
    // the full stop or question mark when the line is a whole sentence: it starts the model's sentence and the phrase
    // ends it; a statement (Ich möchte wissen, ob …) takes a full stop where the model asks
    const mark = finalMark === '?' && !QUESTION.has(words(text)[0]?.n || '') ? '.' : finalMark;
    // (it ends the sentence when the phrase does, or when it holds the model's words after the phrase too)
    const ends = closes || postWords.every(n => has.includes(n));
    out.push({ pattern: p, text: first && ends && mark ? text + mark : text });
  }
  return out;
}

// Situations (Sprechen Teil 1–3): the answer is free, only the phrase is graded. formCheck() compares it with the model
// sentence and flags only a word that is the model's word in another form, in the same place: one word between the
// same neighbours, differing in its ending (einen anderes Vorschlag), an umlaut, or as another case or gender of the
// same article or pronoun (bei mich, für einer Party). Other wordings pass.
//   → {status: 'ok'|'differs', ref, marks, wrong}
// the closed-class family of a word (the pack's paradigms: der/den/dem …, ich/mich/mir …), or -1
const family = (/** @type {string} */ n) => L.grading.paradigms.findIndex(re => re.test(n));
/** @param {Word} a @param {Word} b @param {WordX} [x] */
function formPair(a, b, x = NOX) {
  if (a.n === b.n) return false;
  const CLOSED = L.grading.closedClass;
  if (sameButMarks(a.low, b.low)) return true;   // hatte/hätte, schon/schön, Mutter/Mütter
  if (CLOSED.has(a.n) && CLOSED.has(b.n)) { const f = family(a.n); if (f >= 0 && f === family(b.n)) return true; }
  // nearly the same word in the same place, and not a typo by the typo rules: das/dass, viel/fiel, Staat/Stadt, wider
  if (a.len >= 3 && dl(a.n, b.n, 1) <= 1 && !typoOk(a.n, { n: b.n, len: b.len }, { endings: true, lex: x.lex })) return true;
  // the model's verb with the regular endings (findete for fand) or another prefix (gebesprochen, geerlaubt)
  if (x.conj && x.conj.lookup(b.n).length && (x.conj.misbuilt(a.n) || (L.grading.prefixSwap && L.grading.prefixSwap(a.n, b.n)))) return true;
  if (CLOSED.has(a.n) && CLOSED.has(b.n)) return false;   // für/vor, mit/bei: another word, not another form
  // the same word up to a different ending: vieles/vielen, anderes/anderen, müsst/müssen, kannt/kannst
  const p = commonPrefix(a.n, b.n), ra = a.n.slice(p), rb = b.n.slice(p);
  const ends = endingSet();
  return p >= 3 && ra !== rb && ends.has(ra) && ends.has(rb);
}
/** @type {WeakMap<LanguagePack, Set<string>>} */ const ENDING_SETS = new WeakMap();
const endingSet = () => { let e = ENDING_SETS.get(L); if (!e) { e = new Set(['', ...L.grading.endings]); ENDING_SETS.set(L, e); } return e; };
/** @param {string} input @param {string} base @param {CheckOptions & {lone?: boolean}} [opts] */
function formCheck(input, base, opts = {}) {
  const x = xOpts({ ...opts, endings: true });
  const inp = nfc(input).replace(/\s+/g, ' ').trim();
  const A = words(inp), B = words(base || '');
  /** @type {{status: 'ok'|'differs', ref: string, marks: Range[], wrong: Wrong[]}} */
  const out = { status: 'ok', ref: base ? tidy(base) : '', marks: [], wrong: [] };
  if (!A.length || !B.length) return out;
  const G = gaps(A, B).gaps;
  // lone: his own sentence around a frame (Build an email) is compared only when it is the model with one word
  // replaced; two or more replaced stretches mean other words, where a different form is often right (wir sollten /
  // jede Firma sollte). Lines he cut short or made longer still count as one replacement.
  if (opts.lone && G.filter(g => g.a.length && g.b.length).length > 1) return out;
  for (const g of G) {
    if (g.a.length !== 1 || g.b.length !== 1) continue;
    const t = A[g.a[0]], w = B[g.b[0]];
    if (!formPair(t, w, x)) continue;
    out.status = 'differs';
    out.wrong.push({ start: t.start, end: t.end, word: t.raw });
    const p = commonPrefix(t.low, w.low), end = w.raw.length - ending(w.n).length;
    out.marks.push({ start: p >= 3 && p < w.raw.length ? w.start + Math.min(p, end) : w.start, end: w.end });
  }
  // the model's verb in a form its frame does not take (the pack's verb forms): gezogen for ziehen after a modal, zu
  // left out or put in, the other number with the model's subject
  const V = L.grammar.verbs;
  if (opts.conj && V) for (const c of V.clashes(A, B, String(base), opts.conj)) {
    const t = c.a >= 0 ? A[c.a] : null;
    if (t && out.wrong.some(w => w.start === t.start)) continue;
    out.status = 'differs';
    if (t) out.wrong.push({ start: t.start, end: t.end, word: t.raw });
    const from = c.kind === 'zu-missing' && c.b > 0 ? B[c.b - 1] : B[c.b];
    out.marks.push({ start: from.start, end: B[c.b].end });
  }
  out.marks.sort((a, b) => a.start - b.start); out.wrong.sort((a, b) => a.start - b.start);
  return out;
}

// validate_accept.matches(answer, pattern) without typo tolerance
const matches = (/** @type {string} */ answer, /** @type {string} */ pattern) => check(answer, [pattern], { anywhere: true, typos: false }).ok;

// ---- nouns: definite ("the car") or indefinite ("a car") prompts ----
const hash = (/** @type {unknown} */ s) => { let x = 2166136261; for (const c of String(s)) { x ^= /** @type {number} */ (c.codePointAt(0)); x = Math.imul(x, 16777619); } return x >>> 0; };
const stripArt = (/** @type {unknown} */ g) => String(g || '').replace(/^\s*(the|a|an)\s+/i, '').trim();
// 'indef' for about 30% of countable common nouns (stable per id); 'def' for everything else
/** @param {any} word @returns {'def'|'indef'} */
function nounForm(word) {
  if (!word || word.pos !== 'noun' || !word.art) return 'def';
  const g = stripArt((word.en || [])[0]);
  if (!word.pl || word.pl === word.w || !g) return 'def';        // plural-only or uncountable
  if (/^\P{Ll}*\p{Lu}/u.test(g)) return 'def';                     // proper nouns, holidays, languages
  return hash(word.id || word.w) % 100 < 30 ? 'indef' : 'def';
}
const anSound = (/** @type {string} */ g) => /^(hour|honest|honou?r|heir)/i.test(g) || (/^[aeiou]/i.test(g) && !/^(u[nst]i|use|usu|ur[aeiou]|eu|one\b|once)/i.test(g));
/** @param {any} word @param {'def'|'indef'} [form] */
function nounPrompt(word, form = nounForm(word)) {
  const g = stripArt((word.en || [])[0] || word.w);
  return form === 'indef' ? `${anSound(g) ? 'an' : 'a'} ${g}` : `the ${g}`;
}
// "der Tisch" → "ein Tisch" (the pack's articles; unchanged in a language without gender)
const toIndef = (/** @type {string} */ s) => { const g = L.grammar.gender; return g ? g.toIndefinite(s) : s; };

/** @param {any} word @param {'def'|'indef'} [form] @returns {string[]} */
function acceptedForWord(word, form = 'def') {
  if (!word) return [];
  const main = word.pos === 'noun' && word.art ? `${word.art} ${word.w}` : word.w;
  const def = [main];
  for (const a of word.alt || []) if (a && !def.includes(a)) def.push(a);
  if (form !== 'indef' || word.pos !== 'noun' || !word.art) return def;
  /** @type {string[]} */ const out = [];
  for (const a of def) { const i = toIndef(a); if (!out.includes(i)) out.push(i); }
  for (const a of def) if (!out.includes(a)) out.push(a);   // the definite form counts too
  return out;
}
// t: the German chunk string, variants split on " / ". ex (optional): the German example sentence, accepted first.
/** @param {unknown} t @param {string} [ex] */
function acceptedForChunk(t, ex) {
  /** @type {string[]} */ const out = [];
  if (ex) out.push(ex);
  for (const v of String(t || '').split(' / ').map(s => s.trim()).filter(Boolean)) if (!out.includes(v)) out.push(v);
  return out;
}

// Gap items ("Ich kaufe ___ Tisch. (der)"): the answer word alone, or the prompt with the gap filled, both count.
// gapLoose() lists the carried-over words, which may have typos; the gap word itself must be exact.
const GAP = '___';
const gapBase = (/** @type {unknown} */ prompt) => String(prompt || '').replace(/\s*\([^()]*\)\s*$/, '').trim();
/** @param {unknown} prompt @param {unknown} answer */
function gapFill(prompt, answer) {
  const base = gapBase(prompt), i = base.indexOf(GAP);
  let a = String(answer);
  if (i >= 0 && !/\p{L}/u.test(base.slice(0, i)) && /\p{Ll}/u.test(a[0] || '') && /[.!?]\s*$/.test(base)) a = a[0].toUpperCase() + a.slice(1);
  return i < 0 ? null : { before: base.slice(0, i), gap: a, after: base.slice(i + GAP.length), text: base.slice(0, i) + a + base.slice(i + GAP.length) };
}
/** @param {unknown} prompt @param {string | string[]} answers @returns {string[]} */
function acceptedForGap(prompt, answers) {
  const list = (Array.isArray(answers) ? answers : [answers]).filter(Boolean);
  if (!String(prompt || '').includes(GAP)) return list.slice();
  const out = list.slice();
  for (const a of list) { const f = gapFill(prompt, a); if (f && !out.includes(f.text)) out.push(f.text); }
  return out;
}
const gapLoose = (/** @type {unknown} */ prompt) => words(gapBase(prompt).split(GAP).join(' ')).map(w => w.n);

// ---- the exported API: every entry point runs in its language pack (inPack) ----
/**
 * @template {(...a: any[]) => any} F
 * @param {F} fn @param {(a: any[]) => LanguagePack | null | undefined} [packOf] the pack an argument names
 * @returns {F}
 */
const scoped = (fn, packOf = () => null) => /** @type {F} */ ((/** @type {any[]} */ ...a) => inPack(packOf(a), () => fn(...a)));
/** A pack, or null (a callback's index or array is not one). @param {unknown} p @returns {LanguagePack | null} */
const asPack = p => (p && typeof p === 'object' && 'grammar' in p ? /** @type {LanguagePack} */ (p) : null);
const optAt = (/** @type {number} */ i) => (/** @type {any[]} */ a) => asPack(a[i] && a[i].pack);
const E = {
  check: scoped(check, optAt(2)), matches: scoped(matches), diffWords: scoped(diffWords), markDiff: scoped(markDiff),
  restCheck: scoped(restCheck, optAt(3)), alsoLines: scoped(alsoLines, a => asPack(a[5])), shapeOf: scoped(shapeOf), sameShape: scoped(sameShape),
  formCheck: scoped(formCheck, optAt(2)), renderPattern: scoped(renderPattern), acceptedForWord: scoped(acceptedForWord), acceptedForChunk,
  acceptedForGap, gapFill, gapLoose: scoped(gapLoose), nounForm, nounPrompt, toIndef: scoped(toIndef), clean: scoped(clean), fold: scoped(fold),
  dl, dl1, words: scoped(words), ending: scoped(ending),
};
/** The default pack's closed-class words (kept for callers that read Match.CLOSED; a pack's own: pack.grading.closedClass). */
const CLOSED = activePack().grading.closedClass;
const api = { ...E, CLOSED };
export default api;
const {
  check: checkX, matches: matchesX, diffWords: diffWordsX, markDiff: markDiffX, restCheck: restCheckX, alsoLines: alsoLinesX, shapeOf: shapeOfX,
  sameShape: sameShapeX, formCheck: formCheckX, renderPattern: renderPatternX, acceptedForWord: acceptedForWordX, gapLoose: gapLooseX, toIndef: toIndefX,
  clean: cleanX, fold: foldX, words: wordsX, ending: endingX,
} = E;
export { checkX as check, matchesX as matches, diffWordsX as diffWords, markDiffX as markDiff, restCheckX as restCheck, alsoLinesX as alsoLines,
  shapeOfX as shapeOf, sameShapeX as sameShape, formCheckX as formCheck, renderPatternX as renderPattern, acceptedForWordX as acceptedForWord,
  acceptedForChunk, acceptedForGap, gapFill, gapLooseX as gapLoose, nounForm, nounPrompt, toIndefX as toIndef, cleanX as clean, foldX as fold, dl, dl1,
  wordsX as words, endingX as ending, CLOSED };
