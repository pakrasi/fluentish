/* A mistake card (round 5, "card bugs"): what a correction changed, what the card must check, and where the sentence
   stood in his text. Pure; tested in node (tests/unit/card-feedback.test.mjs).

     mistakeKinds(wrong, right)        → ['ending', 'order', …]  the kinds of change, one per changed place, in his order:
                                          case (a capital or small letter), comma, order (word order), ending (the same
                                          word with another ending: keine → keinen), pronoun (dir → dich), preposition
                                          (für → zu), verb (another helper verb: habe → bin), spelling (Urlab → Urlaub),
                                          word (another word: Trotz → Trotzdem)
     mistakeFixes(wrong, right)        → {caseWords, commas}  the changes a typed answer is checked on beyond the
                                          matcher, which ignores both: a word whose capital changed (Vielen → vielen) and a
                                          comma that came or went between two words (hoffe dass, → hoffe, dass)
     fixMissed(input, fixes)           → [{code, word|a,b}]  the fixes his answer leaves undone (domain/notes.js codes)
     mistakeContext(wrong, text, others) → {before, after} | null  the words around it in his text, his other mistakes
                                          there corrected: the sentence before it, and the greeting line when it opens
                                          the text after "Liebe Anna," (its small letter depends on that comma)

   Language-neutral: words, folding and the closed-class families come from the pack through domain/match.js. */
// @ts-check
import * as Match from './match.js';
import { activePack } from '../lang/registry.js';

/** @typedef {'case'|'comma'|'order'|'ending'|'pronoun'|'preposition'|'verb'|'spelling'|'word'} Kind */

/** LCS pairs of two word lists by folded form. @param {any[]} A @param {any[]} B @returns {[number, number][]} */
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

const COMMA = /[,;]/;
/** The family of a closed-class word (der/den/dem …, ich/mich/mir …), or -1. @param {string} n */
const family = n => activePack().grading.paradigms.findIndex(re => re.test(n));
/** @param {string} a @param {string} b */
const commonPrefix = (a, b) => { let p = 0; while (p < a.length && p < b.length && a[p] === b[p]) p++; return p; };

/**
 * The kind of one word changed into another. @param {string} a folded, his @param {string} b folded, right @returns {Kind}
 */
function swapKind(a, b) {
  const P = activePack();
  const preps = P.grammar.slots && P.grammar.slots.prepositions;
  if (preps && preps.has(a) && preps.has(b)) return 'preposition';
  const fa = family(a), fb = family(b);
  const subj = P.grammar.slots && P.grammar.slots.subjects;
  const pron = (/** @type {string} */ w) => /^(ich|mich|mir|du|dich|dir|er|ihn|ihm|sie|ihr|ihnen|es|wir|uns|euch|sich)$/.test(w) || !!(subj && subj.has(w));
  if (pron(a) && pron(b)) return 'pronoun';
  // one family: another ending of the same word (den → dem, habe → hat), or another verb of it (habe → bin)
  if (fa >= 0 && fa === fb) return a[0] === b[0] ? 'ending' : 'verb';
  const p = commonPrefix(a, b), short = Math.min(a.length, b.length);
  // the same word up to its last letters: another ending (keine → keinen, meine → meiner, Meine → Mein)
  if (p >= 3 && p === short && Math.abs(a.length - b.length) <= 2) return 'ending';
  if (p >= 3 && p >= short - 2 && Math.max(a.length, b.length) - p <= 2 && Math.abs(a.length - b.length) <= 1 && Match.dl(a, b, 3) <= 2 && !/^(ge)/.test(b.slice(p))) {
    // a changed last letter or two of the same length: an ending when both look like endings, else a spelling
    const ea = a.slice(p), eb = b.slice(p);
    if (/^(e|en|em|er|es|n|s|r|m)?$/.test(ea) && /^(e|en|em|er|es|n|s|r|m)?$/.test(eb)) return 'ending';
  }
  const long = Math.max(a.length, b.length);
  if (short >= 4 && Match.dl(a, b, 4) <= (long >= 12 ? 3 : long >= 8 ? 2 : 1)) return 'spelling';
  return 'word';
}

/**
 * The kinds of change from his sentence to the corrected one, one per changed place, in the order they come in his.
 * @param {string} wrong @param {string} right @returns {Kind[]}
 */
export function mistakeKinds(wrong, right) {
  const a = String(wrong || '').normalize('NFC'), b = String(right || '').normalize('NFC');
  const A = Match.words(a), B = Match.words(b);
  if (!A.length || !B.length) return [];
  const P = pairs(A, B);
  /** @type {{at: number, kind: Kind}[]} */ const out = [];
  // capitals and commas between words both keep
  for (const [i, j] of P) if (A[i].raw !== B[j].raw && A[i].raw.toLowerCase() === B[j].raw.toLowerCase()) out.push({ at: i, kind: 'case' });
  for (let k = 0; k + 1 < P.length; k++) {
    const [i, j] = P[k], [i2, j2] = P[k + 1];
    if (i2 !== i + 1 || j2 !== j + 1) continue;
    if (COMMA.test(a.slice(A[i].end, A[i2].start)) !== COMMA.test(b.slice(B[j].end, B[j2].start))) out.push({ at: i + 0.5, kind: 'comma' });
  }
  // the words between the kept ones: moved (the same word elsewhere), swapped one for one, added or dropped
  const inA = new Set(P.map(p => p[0])), inB = new Set(P.map(p => p[1]));
  const loneA = A.map((_, i) => i).filter(i => !inA.has(i)), loneB = B.map((_, j) => j).filter(j => !inB.has(j));
  const moved = loneA.filter(i => loneB.some(j => B[j].n === A[i].n));
  if (moved.length) out.push({ at: moved[0], kind: 'order' });
  const restA = loneA.filter(i => !moved.includes(i)), restB = loneB.filter(j => !moved.some(i => A[i].n === B[j].n));
  // pair the rest in order where they stand between the same kept words
  const gapOf = (/** @type {number} */ i, /** @type {'a'|'b'} */ side) => { let g = 0; for (const p of P) if ((side === 'a' ? p[0] : p[1]) < i) g++; return g; };
  const usedB = new Set();
  for (const i of restA) {
    const j = restB.find(j2 => !usedB.has(j2) && gapOf(j2, 'b') === gapOf(i, 'a'));
    if (j == null) { out.push({ at: i, kind: 'word' }); continue; }
    usedB.add(j);
    out.push({ at: i, kind: swapKind(A[i].n, B[j].n) });
  }
  for (const j of restB) if (!usedB.has(j)) {
    // a word added: where it stands in his sentence
    const g = gapOf(j, 'b'), at = g ? P[g - 1][0] + 0.5 : -0.5;
    out.push({ at, kind: 'word' });
  }
  out.sort((x, y) => x.at - y.at);
  // a comma moved by one word (hoffe dass, → hoffe, dass) is one change
  return out.filter((x, k) => !(x.kind === 'comma' && k > 0 && out[k - 1].kind === 'comma' && x.at - out[k - 1].at <= 1)).map(x => x.kind);
}

/**
 * What a typed answer is checked on beyond the matcher: the words whose capital the correction changed, and the commas
 * it put in or took out between two words.
 * @param {string} wrong @param {string} right
 * @returns {{caseWords: {n: string, raw: string}[], commas: {a: string, b: string, want: boolean}[]}}
 */
export function mistakeFixes(wrong, right) {
  const a = String(wrong || '').normalize('NFC'), b = String(right || '').normalize('NFC');
  const A = Match.words(a), B = Match.words(b), P = pairs(A, B);
  const caseWords = [], commas = [];
  for (const [i, j] of P) if (A[i].raw !== B[j].raw && A[i].raw.toLowerCase() === B[j].raw.toLowerCase()) caseWords.push({ n: B[j].n, raw: B[j].raw });
  for (let k = 0; k + 1 < P.length; k++) {
    const [i, j] = P[k], [i2, j2] = P[k + 1];
    if (i2 !== i + 1 || j2 !== j + 1) continue;
    const ca = COMMA.test(a.slice(A[i].end, A[i2].start)), cb = COMMA.test(b.slice(B[j].end, B[j2].start));
    if (ca !== cb) commas.push({ a: B[j].n, b: B[j2].n, want: cb, ra: B[j].raw, rb: B[j2].raw });
  }
  return { caseWords, commas };
}

/**
 * The fixes his answer leaves undone: a word still in the wrong case, a comma still missing or still there.
 * @param {string} input @param {ReturnType<typeof mistakeFixes> | null | undefined} fixes
 * @returns {{code: string, word?: string, a?: string, b?: string}[]}
 */
export function fixMissed(input, fixes) {
  if (!fixes) return [];
  const s = String(input || '').normalize('NFC'), W = Match.words(s);
  const out = [];
  for (const c of fixes.caseWords || []) {
    const w = W.find(x => x.n === c.n);
    if (w && w.raw !== c.raw) out.push({ code: /^\p{Lu}/u.test(c.raw) ? 'cap-up' : 'cap-down', word: c.raw });
  }
  for (const c of /** @type {any[]} */ (fixes.commas || [])) {
    const k = W.findIndex((x, i) => x.n === c.a && W[i + 1] && W[i + 1].n === c.b);
    if (k < 0) continue;
    const has = COMMA.test(s.slice(W[k].end, W[k + 1].start));
    if (has !== c.want) out.push({ code: c.want ? 'comma-missing' : 'comma-extra', a: c.ra || c.a, b: c.rb || c.b });
  }
  return out;
}

const MAX_BEFORE = 14, MAX_AFTER = 10;
/** A run of text cut to its last (or first) n words, with … where words were left out. @param {string} t @param {number} n @param {boolean} tail */
function clip(t, n, tail) {
  const W = Match.words(t);
  if (W.length <= n) return t;
  return tail ? `… ${t.slice(W[W.length - n].start)}` : `${t.slice(0, W[n - 1].end)} …`;
}

/**
 * Where a corrected part stood in his text: the words before it in its sentence (or the greeting line when it opens the
 * text after one), and the words after it to the end of the sentence. His other corrected mistakes in those words are
 * shown corrected. null when the text does not hold it.
 * @param {string} wrong @param {string | null | undefined} text
 * @param {{wrong: string, right: string}[]} [others] the other corrections of the same text
 * @returns {{before: string, after: string} | null}
 */
export function mistakeContext(wrong, text, others = []) {
  const w = String(wrong || '').normalize('NFC').replace(/\s+/g, ' ').trim();
  const t = String(text || '').normalize('NFC').replace(/\r\n?/g, '\n');
  if (!w || !t) return null;
  // find it: as written, else with any spacing and case
  let at = t.indexOf(w), len = w.length;
  if (at < 0) {
    const esc = w.split(' ').map(x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
    const m = new RegExp(esc, 'iu').exec(t);
    if (!m) return null;
    at = m.index; len = m[0].length;
  }
  // the sentence it stands in: back to the last end mark or line break, on to the next one
  let s0 = at;
  while (s0 > 0 && t[s0 - 1] !== '\n' && !(/[.!?]/.test(t[s0 - 1]) && /\s/.test(t[s0] || ' ') && !/\d/.test(t[s0 - 2] || ''))) s0--;
  let before = t.slice(s0, at).replace(/\s+/g, ' ').trim();
  // nothing before it in its line, and the text before ends with a comma (Liebe Anna,): that line; a whole sentence:
  // the sentence before it (Trotzdem … refers to it)
  if (!before) {
    const prev = t.slice(0, s0).replace(/\s+$/, '');
    if (/,$/.test(prev)) before = prev.slice(prev.lastIndexOf('\n') + 1).trim();
    else if (/[.!?]$/.test(w) && /[.!?]$/.test(prev)) {
      const line = prev.slice(prev.lastIndexOf('\n') + 1);
      const cut = [...line.slice(0, -1).matchAll(/[.!?](?=\s)/g)].pop();
      before = (cut ? line.slice(/** @type {number} */ (cut.index) + 1) : line).trim();
    }
  }
  // after it: to the end of its line, then up to and with the first end mark (none when it ends its own sentence)
  const nl = t.indexOf('\n', at + len);
  let after = t.slice(at + len, nl < 0 ? t.length : nl);
  const em = /[.!?](?=\s|$)/.exec(after);
  if (/[.!?]$/.test(w)) after = '';
  else if (em) after = after.slice(0, em.index + 1);
  after = after.replace(/\s+/g, ' ').trim();
  // his other mistakes in these words, corrected
  for (const o of others || []) {
    const ow = String(o.wrong || '').normalize('NFC').trim(), or = String(o.right || '').normalize('NFC').trim();
    if (!ow || !or || ow === w) continue;
    before = before.split(ow).join(or);
    after = after.split(ow).join(or);
  }
  if (!before && !after) return null;
  return { before: clip(before, MAX_BEFORE, true), after: /^[.!?]$/.test(after) ? after : clip(after, MAX_AFTER, false) };
}
