/* Word building: grading the typed cards (PV infinitive, PS verb pieces, PW word with its article). Pure; tested in
   node, and every card type is in the grading corpus (tests/corpus/grading-corpus.mjs), which must stay at zero
   wrong answers graded right.

   Strict on purpose: the point of these cards is the exact form, so there is no typo tolerance at all. A different
   prefix (ausstellen for aufstellen), a missing or misplaced ge- (abgestellen, geabstellt), zu glued to an
   inseparable verb (zubestellen) or a separable one written apart (auf zu stehen), a wrong helper (habe for bin)
   and a wrong article are all wrong. Two slips count as right but Hard, as in every other round: a dropped umlaut
   (ubersetzen) when the plain spelling is not another word, and a noun typed in lower case (die vorstellung). The
   answer must have exactly the words of the answer: Match.check would otherwise accept words run together. */
import * as Match from './match.js';

/**
 * @typedef {object} TypedGrade
 * @property {boolean} ok          right (possibly with a slip)
 * @property {boolean} slip        right, with an umlaut or capital slip: Hard
 * @property {string} right        the answer to show
 * @property {string} input        what he typed, tidied
 * @property {{typed: string, expected: string, start: number, end: number}[]} slips   the slipped words (offsets into input)
 * @property {boolean} articleMiss the noun is right, its article is not
 */

/**
 * @param {string} input
 * @param {{accept: string[], noun?: boolean, lexicon?: Set<string> | null}} o
 *   accept: the right answers, the first one shown; noun: PW nouns (the article counts); lexicon: folded German words,
 *   so a dropped umlaut that spells another word is a miss
 * @returns {TypedGrade}
 */
export function gradeTyped(input, { accept, noun = false, lexicon = null }) {
  const accepted = accept.filter(Boolean);
  /** @type {Map<string, string>} */ const caseRef = new Map();
  for (const a of accepted) for (const w of Match.words(a)) if (/^\p{Lu}/u.test(w.raw)) caseRef.set(w.n, w.raw);
  const r = Match.check(String(input || ''), accepted, { typos: false, umlaut: true, caseRef, lexicon, pos: noun ? 'noun' : undefined, slots: false });
  const typed = Match.words(r.input);
  const same = !!r.matched && typed.length === Match.words(r.matched).length;
  // a capital counts only on a noun; the sentence-initial exemption in Match does not apply to a single word typed alone
  const capMiss = noun ? capSlips(r.input, caseRef) : [];
  const slips = [...(r.umlautMiss || []), ...capMiss].sort((a, b) => a.start - b.start);
  const ok = r.ok && same;
  return { ok, slip: ok && slips.length > 0, right: ok && r.matched ? r.matched : accepted[0] || '', input: r.input, slips: ok ? slips : [], articleMiss: !!r.articleMiss };
}

/** Nouns typed in lower case. @param {string} input @param {Map<string, string>} ref */
function capSlips(input, ref) {
  /** @type {{typed: string, expected: string, start: number, end: number}[]} */ const out = [];
  for (const w of Match.words(input)) {
    const want = ref.get(w.n);
    if (want && !/^\p{Lu}/u.test(w.raw)) out.push({ typed: w.raw, expected: want, start: w.start, end: w.end });
  }
  return out;
}

/** The FSRS grade of a typed answer: right 3 (Good), right with a slip 2 (Hard), wrong or shown 1. @param {TypedGrade} g @param {boolean} [shown] */
export const typedRating = (g, shown = false) => (shown || !g.ok ? 1 : g.slip ? 2 : 3);

/** The accepted answers of a PV card: the infinitive, and without "sich" for a reflexive verb. @param {{inf: string}} v */
export function pvAccept(v) {
  const bare = v.inf.replace(/^sich\s+/, '');
  return v.inf === bare ? [bare] : [v.inf, bare];
}

/**
 * Folded German word forms the build content knows (infinitives, participles, chain words): a dropped umlaut that
 * spells one of them is a miss, not a slip.
 * @param {import('./wordbuild.js').BuildContent} c @param {Iterable<string>} [extra] more words (the word list)
 */
export function lexiconOf(c, extra = []) {
  /** @type {Set<string>} */ const out = new Set();
  const add = (/** @type {string} */ s) => { for (const w of Match.words(s)) out.add(w.n); };
  for (const v of c.verbs) { add(v.inf); add(v.pp); }
  for (const f of c.frames) for (const t of Object.values(f.forms)) for (const x of t || []) add(x[1]);
  for (const ch of c.chains) for (const n of ch.nodes) add(n.word);
  for (const s of extra) add(s);
  return out;
}
