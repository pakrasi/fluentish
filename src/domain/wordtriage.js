/* Exam-word triage (UX §3.3), the one rule Practice and Look up share. A word saved in a mock test enters the review
   queue only once it has a meaning. In an exam week (phases week, lastNew, eve, day) only frequent words go in:
   zipf ≥ 4 or seen in 3 or more tests; the rest wait in Look up, marked "after the exam". Outside an exam week the
   bar is lower: frequent, or on the B1 word list (A1 to B1), or in 2 or more tests. Anything else is reference only.

   Practice: wordItems() rounds use the 'queue' words. Look up: My words shows each word's state from the same call.
   Pure; tested in node (tests/unit/wordtriage.test.mjs). */

/** Clock phases that count as an exam week. */
export const EXAM_WEEK = new Set(['week', 'lastNew', 'eve', 'day']);

const LIST_LEVELS = new Set(['A1', 'A2', 'B1']);

/**
 * @typedef {object} TriageInput
 * @property {boolean} glossed        it has a meaning
 * @property {number | null} [zipf]   word frequency (Zipf scale)
 * @property {number | null} [examDays] in how many mock tests it appears
 * @property {string | null} [level]  CEFR level from the B1 word map, '' or null when not on it
 */

/** Frequent enough for the queue in an exam week. @param {{zipf?: number | null, examDays?: number | null}} w */
export const frequent = w => (w.zipf ?? 0) >= 4 || (w.examDays ?? 0) >= 3;

/**
 * @param {TriageInput} w @param {string} phase clock phase
 * @returns {'waiting' | 'later' | 'queue' | 'reference'}
 *   waiting: no meaning yet · later: an exam week and not frequent · queue: in the review queue · reference: Look up only
 */
export function wordTriage(w, phase) {
  if (!w.glossed) return 'waiting';
  if (EXAM_WEEK.has(phase)) return frequent(w) ? 'queue' : 'later';
  return frequent(w) || LIST_LEVELS.has(String(w.level || '')) || (w.examDays ?? 0) >= 2 ? 'queue' : 'reference';
}

/** The word-map level of a lemma, looked up the way wordId() looks up its id. @param {string} lemma @param {Record<string, [string, string]>} [wordmap] */
export function wordLevel(lemma, wordmap = {}) {
  const l = String(lemma).trim();
  const wm = wordmap[l] || wordmap[l.toLowerCase()];
  return wm ? wm[1] : '';
}
