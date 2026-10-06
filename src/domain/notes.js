/* What he got wrong in one answer, from his answer and the sentence he is shown for it (round 5, "card bugs"). Each
   note comes from an error he made, found by comparing the two word for word; the item's own rule is shown only when
   it is about one of them (ruleApplies). Pure; tested in node (tests/unit/card-feedback.test.mjs).

     answerNotes(typed, target, item, {lexicon}) → {notes, order, words}
       notes   [{code, …}] in the order he wrote them, at most one per word:
                 comma-extra  {a, b}      a comma between two words the right sentence writes without one (Danach, nenne)
                 comma-missing {a, b}     a comma the right sentence has between two words (only when he writes commas)
                 cap-up {word}            a word that takes a capital (ende → Ende), past the first word
                 cap-down {word}          a word that takes a small letter (Gut → gut), past the first word
                 spelling {word, fix}     his word is the right word misspelt (Wohnnung → Wohnung)
                 unknown {word}           a word no German form the content knows, in lower case (erzäle)
                 item {text}              the item's own note on a word he used (content: item.notes)
       order   a word of the right sentence that he wrote in another place (the word order differs); moved: those words
       words   the folded words that differ: his words not in the right sentence and its words he left out

   Language-neutral: words, folding and the closed-class words come from the pack through domain/match.js. */
// @ts-check
import * as Match from './match.js';

/** @typedef {{code: string, a?: string, b?: string, word?: string, fix?: string, text?: string}} Note */

const COMMA = /[,;]/;
// English words of a rule line that are German words too: never evidence that the rule is about his error
const EN_STOP = new Set(['the', 'and', 'was', 'with', 'for', 'not', 'but', 'you', 'are', 'its', 'then', 'that', 'this', 'when', 'one', 'also', 'like', 'even', 'only', 'here']);

/** The LCS pairs of two word lists. @param {any[]} A @param {any[]} B @returns {[number, number][]} */
function pairs(A, B) {
  const n = A.length, m = B.length;
  const T = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) T[i][j] = A[i].n === B[j].n ? T[i + 1][j + 1] + 1 : Math.max(T[i + 1][j], T[i][j + 1]);
  /** @type {[number, number][]} */ const out = [];
  for (let i = 0, j = 0; i < n && j < m;) {
    if (A[i].n === B[j].n) { out.push([i, j]); i++; j++; }
    else if (T[i + 1][j] >= T[i][j + 1]) i++; else j++;
  }
  return out;
}

/** Whether word k of a text starts a sentence. @param {string} text @param {any[]} W @param {number} k */
const initial = (text, W, k) => k === 0 || /[.!?:]\s*["„“]?\s*$/.test(text.slice(W[k - 1].end, W[k].start));

/**
 * @param {string} typed @param {string} target
 * @param {any} [item]   item.notes: {word: text} the item's notes on words (folded match, a near spelling counts)
 * @param {{lexicon?: Set<string> | null}} [o]
 * @returns {{notes: Note[], order: boolean, moved: string[], words: Set<string>}}
 */
export function answerNotes(typed, target, item = {}, o = {}) {
  const a = String(typed || '').normalize('NFC'), b = String(target || '').normalize('NFC');
  const A = Match.words(a), B = Match.words(b);
  /** @type {{at: number, note: Note}[]} */ const found = [];
  /** @type {Set<string>} */ const differ = new Set();
  if (!A.length || !B.length) return { notes: [], order: false, moved: [], words: differ };
  const P = pairs(A, B);
  const inA = new Set(P.map(p => p[0])), inB = new Set(P.map(p => p[1]));
  const loneA = A.map((w, i) => (inA.has(i) ? null : i)).filter(i => i != null), loneB = B.map((w, j) => (inB.has(j) ? null : j)).filter(j => j != null);
  for (const i of loneA) differ.add(A[/** @type {number} */ (i)].n);
  for (const j of loneB) differ.add(B[/** @type {number} */ (j)].n);
  // the word order: one of his words is in the right sentence, in another place
  const moved = loneA.map(i => A[/** @type {number} */ (i)]).filter(x => loneB.some(j => x.n === B[/** @type {number} */ (j)].n)).map(x => x.n);
  const order = moved.length > 0;
  // capitals, past the first word of a sentence in both
  for (const [i, j] of P) {
    const x = A[i], y = B[j];
    if (x.raw === y.raw || x.raw.toLowerCase() !== y.raw.toLowerCase() || initial(a, A, i) || initial(b, B, j)) continue;
    const up = /^\p{Lu}/u.test(y.raw);
    if (up === /^\p{Lu}/u.test(x.raw)) continue;
    found.push({ at: x.start, note: { code: up ? 'cap-up' : 'cap-down', word: y.raw } });
    differ.add(y.n);
  }
  // commas between two words that follow each other in both
  const writesCommas = COMMA.test(a);
  for (let k = 0; k + 1 < P.length; k++) {
    const [i, j] = P[k], [i2, j2] = P[k + 1];
    if (i2 !== i + 1 || j2 !== j + 1) continue;
    const ca = COMMA.test(a.slice(A[i].end, A[i2].start)), cb = COMMA.test(b.slice(B[j].end, B[j2].start));
    if (ca && !cb) found.push({ at: A[i].end, note: { code: 'comma-extra', a: B[j].raw, b: B[j2].raw } });
    else if (!ca && cb && writesCommas) found.push({ at: A[i].end, note: { code: 'comma-missing', a: B[j].raw, b: B[j2].raw } });
  }
  // his words that are not in the right sentence: a misspelling of one of its words, or no word the content knows
  const lex = o.lexicon || null;
  for (const i of loneA) {
    const x = A[/** @type {number} */ (i)];
    if (x.len < 3 || /\d/.test(x.raw)) continue;
    const near = loneB.map(j => B[/** @type {number} */ (j)]).find(y => y.n !== x.n && spelling(x.n, y.n));
    if (near) { found.push({ at: x.start, note: { code: 'spelling', word: x.raw, fix: near.raw } }); continue; }
    if (lex && lex.size && !lex.has(x.n) && !Match.CLOSED.has(x.n) && /^\p{Ll}/u.test(x.raw)) found.push({ at: x.start, note: { code: 'unknown', word: x.raw } });
  }
  // the item's notes on words he used (a near spelling counts: erzäle for erzähle)
  const own = item && item.notes && typeof item.notes === 'object' ? Object.entries(item.notes) : [];
  if (own.length) {
    const keys = own.map(([k, text]) => ({ n: Match.words(k)[0]?.n || '', text: String(text) })).filter(k => k.n);
    const used = new Set();
    for (const x of A) {
      const k = keys.find(q => q.n === x.n || (x.len >= 5 && Match.dl(q.n, x.n, 2) <= (x.len >= 7 ? 2 : 1)));
      if (k && !used.has(k.n)) { used.add(k.n); found.push({ at: x.start + 0.5, note: { code: 'item', text: k.text } }); }
    }
  }
  found.sort((p, q) => p.at - q.at);
  return { notes: found.map(f => f.note), order, moved, words: differ };
}

/**
 * Whether x is y misspelt: close in letters, and not only another ending of the same word (Freunde for Freund is a form,
 * not a spelling). @param {string} x @param {string} y folded
 */
function spelling(x, y) {
  const len = Math.max(x.length, y.length);
  if (len < 4) return false;
  const d = Match.dl(x, y, 3);
  if (d > (len >= 8 ? 2 : 1)) return false;
  // the same word up to an ending: a form of it (meine/meiner), not a spelling
  let p = 0;
  while (p < x.length && p < y.length && x[p] === y[p]) p++;
  return !(p === Math.min(x.length, y.length) && Math.abs(x.length - y.length) <= 2);
}

/**
 * Whether the item's own rule is about an error he made (round 5): a word-order rule (trap v2 or verb-final) when he
 * put a verb or a subject in another place than the right sentence has it; a capitals rule when a capital is wrong; any
 * other rule when it names a word that differs. A detector that fired always shows its rule (grade.js detRule), so this
 * is for answers no detector caught.
 * @param {any} item @param {{notes: Note[], order: boolean, moved: string[], words: Set<string>}} res
 * @param {{verbs?: Set<string> | null, subjects?: Set<string> | null}} [o]  finite verb forms (folded) and subject pronouns
 */
export function ruleApplies(item, res, o = {}) {
  if (!item || !item.rule) return false;
  if (item.trap === 'v2' || item.trap === 'verb-final') {
    const verbs = o.verbs || new Set(), subj = o.subjects || new Set();
    return res.moved.some(w => verbs.has(w) || subj.has(w));
  }
  if (item.trap === 'cap' && res.notes.some(n => n.code === 'cap-up' || n.code === 'cap-down')) return true;
  const named = new Set(Match.words(String(item.rule)).filter(w => w.len >= 3 && !EN_STOP.has(w.n)).map(w => w.n));
  return [...res.words].some(w => named.has(w));
}
