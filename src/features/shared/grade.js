/* Practice: grading one typed answer. Pure; tested in node. Ported from Igloo's b1.js gradeAnswer(): match.js with
   the B1 options (endings, umlauts, strict words, capitals from the noun list, the lexicon of German forms), then the
   sticky-error detectors (detect.js), then the rest of the sentence, then the answer to show and the other accepted
   answers.

   The rest of the sentence (owner's rule: a phrase card is scheduled on its phrase): `ok` stays the phrase's verdict.
   g.rest says whether the rest is right too. On a phrase card (an English sentence with a highlighted phrase) the
   whole answer is checked against the model sentence with his phrase in it, or a variant Claude confirmed
   (Match.restCheck); on a situation, against the model's words in the same places (Match.formCheck: einen anderes,
   bei mich), and slot words that are no German at all. rest.status 'differs' → the round shows "<phrase> is right"
   and the rest with its differences, never "Right first time", and the answer counts as Hard (session.js). */
import * as Match from '../../domain/match.js';
import * as Detect from '../../domain/detect.js';
import { punctCheck } from '../../domain/punct.js';

/** @param {string} s */
export const norm = s => Match.fold(String(s).toLowerCase()).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** Noun capitalisation reference: the noun list plus every non-initial word of the model answers. */
function caseRef(/** @type {any} */ it, /** @type {Record<string, string>} */ nouns) {
  const m = new Map(Object.entries(nouns || {}).map(([k, v]) => [Match.fold(k), v]));
  for (const s of [it.model, ...(it.moves || []).map((/** @type {any} */ x) => x.model)].filter(Boolean)) {
    String(s).normalize('NFC').split(/(?<=[.!?:])\s+/).forEach(sent => Match.words(sent).forEach((/** @type {any} */ w, /** @type {number} */ i) => { if (i) m.set(w.n, w.raw); }));
  }
  return m;
}
const refCache = new WeakMap();

/**
 * @typedef {object} Grade
 * @property {boolean} ok          accepted and no detector fired
 * @property {boolean} matchOk     accepted by the matcher (detectors aside)
 * @property {{cls: string, hint: string, word?: string} | null} det
 * @property {string} input
 * @property {any[]} typos @property {any[]} capMiss @property {any[]} umlautMiss
 * @property {string} right        the answer to show (closest accepted when wrong)
 * @property {string} target       the sentence to type once after a miss: always a whole right sentence (the model,
 *   or the variant Claude confirmed that is closest to the answer), never a pattern with its optional words dropped
 * @property {string[]} alsoCorrect
 * @property {boolean} primary     exactly the first accepted answer
 * @property {string | null} detRule
 * @property {string | null} pattern  for situations: the accepted pattern that was checked (the phrase that does the job)
 * @property {Rest | null} rest      the rest of the sentence (phrase cards and situations; null elsewhere)
 * @property {boolean} partial       the phrase is right, the rest is not: shown as such and counted as Hard
 * @property {string | null} phrase  the phrase he typed (slot words as …)
 * @property {import('../../domain/punct.js').PunctMiss[]} punctMiss  punctuation rules of a Schreiben item the right
 *                                   answer breaks (a slip: shown and rated Hard)
 */

/**
 * @typedef {object} Rest
 * @property {'ok'|'differs'|'na'} status  'na': nothing to compare the rest with
 * @property {string} ref                 the sentence compared with (the closest one when it differs)
 * @property {{start: number, end: number}[]} marks   ranges of ref to mark
 * @property {{start: number, end: number}[]} wrong   ranges of the answer that differ
 * @property {boolean} [frag]             he typed a part of the sentence
 * @property {boolean} [junk]             slot words that are no German
 * @property {import('../../domain/match.js').Slip[]} [typos]       slips in the rest (status 'ok')
 * @property {import('../../domain/match.js').Slip[]} [umlautMiss]
 */

/** A phrase card: an English sentence to say in German, graded on its highlighted phrase. @param {any} it */
export const isPhraseCard = it => !!(it.anywhere && it.hl && (it.promptLang || it.prompt_lang) === 'en' && it.kind !== 'topic' && it.kind !== 'reply');
/** A situation: a free answer, graded on one phrase. @param {any} it */
export const isSituation = it => it.kind === 'topic' || it.kind === 'reply';

/**
 * @param {any} item
 * @param {string} input
 * @param {any} [move]    for reply items: the move the learner picked
 * @param {{nouns?: Record<string, string>, traps?: Map<string, any>, lexicon?: Set<string>, variants?: Map<string, string[]>, verbs?: Set<string> | null, pool?: any[], conj?: any}} [data]
 *   lexicon: folded German word forms (pool.js buildLexicon); variants: item id → whole answers Claude confirmed right;
 *   verbs: finite verb forms of the word list (detect.js verbForms), for the word-order detectors; conj: the verb forms
 *   index (pool.js verbIndex): misbuilt forms are no typos, and the model's verb keeps the form its sentence needs
 * @returns {Grade}
 */
export function gradeAnswer(item, input, move = null, data = {}) {
  const it = move ? { ...item, accept: move.accept, model: move.model, anywhere: true, fn: move.fn } : item;
  const accepted = it.gap ? Match.acceptedForGap(it.prompt, it.accept) : it.accept;
  let ref = refCache.get(it);
  if (!ref) { ref = caseRef(it, data.nouns || {}); refCache.set(it, ref); }
  /** @type {any} */
  const o = { anywhere: !!it.anywhere, slotMax: 10, endings: true, umlaut: true, strict: it.strict || [], caseRef: ref, strictCase: !!it.strictCase,
    lexicon: data.lexicon || null, never: neverWords(it, accepted), conj: data.conj || null };
  if (it.loose || it.gap) {
    o.loose = Match.gapLoose(it.prompt);
    // the gap word itself is never a carried-over word, even when the sentence uses it elsewhere too
    if (it.gap) { const own = new Set(Match.words((it.accept || []).join(' ')).map((/** @type {any} */ w) => w.n)); o.loose = o.loose.filter((/** @type {string} */ w) => !own.has(w)); }
  }
  // a gap answered with the word alone is graded in its sentence, so capitals count where they would in the sentence
  // (Vielen Dank für ihre E-Mail: ihre is not sentence-initial there)
  const alone = it.gap && wordsIn(input) && wordsIn(input) <= Math.max(...(it.accept || ['']).map(wordsIn)) && Match.gapFill(it.prompt, input.trim());
  const r = Match.check(alone ? alone.text : input, accepted, o);
  // a polite form of the model typed in lower case outside the graded phrase (da kann ich ihnen nicht helfen): wrong
  // too, as inside it (strict)
  if (r.ok && it.strict && it.strict.length) {
    const pm = politeMiss(r.input, it.sentence || it.model, it.strict);
    if (pm.length) { r.focusMiss = [...(r.focusMiss || []), ...pm]; r.ok = false; r.exact = false; }
  }
  const det = Detect.run(input, it, r, { verbs: data.verbs || null, conj: data.conj || null });
  /** @type {Rest | null} */ let rest = null;
  if (r.ok && !det) {
    if (isPhraseCard(it)) {
      const v = data.variants && typeof data.variants.get === 'function' ? data.variants.get(it.id) || [] : [];
      rest = Match.restCheck(r.input, it.sentence || it.model, accepted, { ...o, anywhere: false, matched: r.matched, variants: v });
    } else if (isSituation(it)) {
      rest = junkSlots(r, data.lexicon) || (it.model ? Match.formCheck(r.input, it.model, { ...o, lone: it.src === 'build' }) : null);
    } else if (it.anywhere && it.model) {
      rest = Match.formCheck(r.input, it.model, o);   // reading: "Der Material" holds "material", but not as written
    }
  }
  const own = new Set(it.accept || []);
  // a gap's answer in its sentence, with the capitals of the model and the noun list (bis sechs Uhr, beim Lernen)
  const render = (/** @type {string} */ p) => it.gap ? (own.has(p) ? casedLike(Match.gapFill(it.prompt, p)?.text || p, modelCase(it.model)) : p) : it.literal ? p : Match.renderPattern(p, it.model);
  let right = it.model;
  if (!r.ok && r.nearest != null && r.nearest > 0) right = render(accepted[r.nearest]);
  // a situation: show the answer that contains the phrase being checked, never a variant without it
  const pattern = it.anywhere ? (accepted[r.ok ? Math.max(0, accepted.indexOf(r.matched)) : Math.max(0, r.nearest ?? 0)] ?? null) : null;
  if (pattern && it.anywhere && !r.ok) {
    const fixed = Match.words(String(pattern).replace(/…/g, ' ')).map((/** @type {any} */ w) => w.n);
    const has = (/** @type {string} */ s) => { const ws = new Set(Match.words(s).map((/** @type {any} */ w) => w.n)); return fixed.every(x => ws.has(x)); };
    if (!has(right) && it.model && has(it.model)) right = it.model;
  }
  // a pattern with an open slot ("weil ich … arbeiten muss") cannot be typed back: show the full model sentence
  if (/…/.test(right) && it.model && !/…/.test(it.model)) right = it.model;
  const target = retypeTarget(it, input, data, right);
  // a wrong answer shows the sentence he will type: a pattern rendered on its own drops the optional words, the
  // capitals of nouns and the commas ("Es gibt zwar Busse aber sie sind zu spät")
  if (!r.ok && !it.gap && !it.literal) right = target;
  const shown = new Set([norm(r.ok ? r.input : right)]);
  /** @type {string[]} */ const also = [];
  // the other accepted answers, written as the model is written: its commas, capitals and slot words (Match.alsoLines).
  // A pattern that needs other commas than the model's is not shown; nothing is shown without punctuation.
  const lines = !it.gap && !it.literal && it.model && !/…/.test(it.model) ? Match.alsoLines(it.model, accepted, alsoRef(it, ref, data), lowerWords(data), isSituation(it)) : null;
  const lineOf = new Map((lines || []).map(l => [l.pattern, l.text]));
  for (const p of (it.gap ? it.accept : accepted)) {
    const s = lines ? lineOf.get(p) : it.gap || it.literal ? render(p) : null;
    // the model's own phrase (deshalb kann ich … inside its sentence) is not another answer
    if (s == null || (lines && it.model && norm(it.model).includes(norm(s)))) continue;
    const k = norm(s);
    if (shown.has(k) || (/…/.test(s) && it.kind !== 'topic' && it.kind !== 'reply' && it.anywhere === false)) continue;
    shown.add(k); also.push(s);
  }
  if (r.ok && it.model && !shown.has(norm(it.model))) also.unshift(it.model);
  const detRule = det ? data.traps?.get(det.cls)?.rule || null : null;
  const partial = !!(rest && rest.status === 'differs');
  const punctMiss = r.ok && !det && it.punct && it.punct.length ? punctCheck(input, it.punct, { nouns: data.nouns }) : [];
  // slips in the rest of the sentence show like the phrase's own
  const typos = [...(r.typos || []), ...(rest && rest.status === 'ok' ? (rest.typos || []).filter((/** @type {any} */ t) => !overlaps(t, r.typos || [])) : [])];
  const umlautMiss = [...(r.umlautMiss || []), ...(rest && rest.status === 'ok' ? (rest.umlautMiss || []).filter((/** @type {any} */ t) => !overlaps(t, r.umlautMiss || [])) : [])];
  return {
    ok: r.ok && !det, matchOk: r.ok, det, input: r.input, typos, capMiss: r.capMiss || [], umlautMiss,
    right: partial && rest && rest.ref ? rest.ref : right, target, alsoCorrect: also.slice(0, 8), primary: !!(r.ok && r.matched === accepted[0] && r.exact && !partial), detRule, pattern,
    rest, partial, phrase: r.ok ? phraseOf(r) : null, punctMiss,
  };
}

/**
 * The sentence to type once: the model (the bank's example sentence when the model has an open slot), or the variant
 * Claude confirmed for this item that shares the most words with the answer. Gap and literal items keep their answer.
 * @param {any} it @param {string} input @param {{variants?: Map<string, string[]>}} data @param {string} fallback
 */
function retypeTarget(it, input, data, fallback) {
  if (it.gap || it.literal) return it.model && !/…/.test(it.model) ? it.model : fallback;
  const whole = [it.sentence, it.model].find(s => s && !/…/.test(s));   // a bank chunk: its example sentence first
  if (!whole) return fallback;
  const v = data.variants && typeof data.variants.get === 'function' ? data.variants.get(it.id) || [] : [];
  const mine = Match.words(String(input || '')).map((/** @type {any} */ w) => w.n);
  const common = (/** @type {string} */ s) => { const ws = new Set(Match.words(s).map((/** @type {any} */ w) => w.n)); return mine.filter(w => ws.has(w)).length; };
  let best = whole, n = common(whole);
  for (const s of v) if (s && !/…/.test(s) && common(s) > n) { best = s; n = common(s); }
  return best;
}

/**
 * Is the retyped answer the target he was shown? The same words in the same order; case and punctuation do not count
 * (as in grading), except a strict word's capital (Sie, Ihnen), and ae/oe/ue/ss count as ä/ö/ü/ß.
 * @param {any} it @param {string} typed @param {string} target
 */
export function retypeOk(it, typed, target) {
  // a gap card: the missing words alone are the sentence too
  const filled = it && it.gap && Match.words(String(typed || '')).length < Match.words(String(target || '')).length ? Match.gapFill(it.prompt, String(typed).trim()) : null;
  if (filled && filled.text && retypeOk({ ...it, gap: false }, filled.text, target)) return true;
  const a = Match.words(String(typed || '')), b = Match.words(String(target || ''));
  if (!b.length || a.length !== b.length) return false;
  const strict = new Set(it && it.strict || []);
  return b.every((/** @type {any} */ w, /** @type {number} */ i) => a[i].n === w.n && (i === 0 || !strict.has(w.raw) || a[i].raw === w.raw));
}

/**
 * Capitals for the "also correct" lines: the noun list and the model's words (caseRef), the polite forms the item
 * spells strictly (Sie, Ihnen), and the nouns of every model sentence in the pool (Zeit, Vorschlag: words written with a
 * capital inside a sentence and never in lower case there).
 * @param {any} it @param {Map<string, string>} ref @param {{pool?: any[]}} data @returns {Map<string, string>}
 */
function alsoRef(it, ref, data) {
  const m = new Map(poolWords(data.pool).nouns);
  for (const [k, v] of ref) m.set(k, v);
  for (const w of it.strict || []) if (/^\p{Lu}/u.test(w)) m.set(Match.fold(String(w).toLowerCase()), w);
  return m;
}
/** Words known to be written in lower case: the pool's, and the finite verb forms of the word list. @param {any} data */
function lowerWords(data) {
  const { lower } = poolWords(data.pool);
  if (!lower) return null;
  if (!data.verbs || !data.verbs.size) return lower;
  let m = verbCache.get(data.verbs);
  if (!m) {
    const { nouns } = poolWords(data.pool), caps = new Set([...nouns.keys(), ...Object.keys(data.nouns || {}).map(k => Match.fold(k))]);
    m = new Set([...lower, ...[...data.verbs].filter(v => !caps.has(v))]);
    verbCache.set(data.verbs, m);
  }
  return m;
}
const verbCache = new WeakMap();
const wordCache = new WeakMap();
/**
 * The words of the pool's model sentences, past the first word of a sentence: nouns (written with a capital, never in
 * lower case there) and the words written in lower case. Folded.
 * @param {any[] | undefined} pool @returns {{nouns: Map<string, string>, lower: Set<string> | null}}
 */
function poolWords(pool) {
  if (!pool) return { nouns: new Map(), lower: null };
  let m = wordCache.get(pool);
  if (m) return m;
  /** @type {Map<string, string>} */ const cap = new Map();
  /** @type {Set<string>} */ const lower = new Set();
  for (const x of pool) for (const s of [x.model, ...(x.moves || []).map((/** @type {any} */ v) => v.model)]) {
    if (!s) continue;
    String(s).normalize('NFC').split(/(?<=[.!?:])\s+/).forEach(sent => Match.words(sent).forEach((/** @type {any} */ w, /** @type {number} */ i) => {
      if (!i) return;
      if (/^\p{Lu}/u.test(w.raw)) { if (!cap.has(Match.fold(w.low))) cap.set(Match.fold(w.low), w.raw); } else lower.add(Match.fold(w.low));
    }));
  }
  // a word written both ways (die Teile / ich teile, das Leben / leben) has no known case: in neither set
  m = { nouns: new Map([...cap].filter(([k]) => !lower.has(k))), lower: new Set([...lower].filter(k => !cap.has(k))) };
  wordCache.set(pool, m);
  return m;
}

/**
 * A sentence with the written form of each word that ref knows, past the first word of each sentence.
 * @param {string} text @param {Map<string, string>} ref
 */
function casedLike(text, ref) {
  return String(text).split(/(?<=[.!?]\s)/).map((sent, k) => {
    let first = true;
    return sent.replace(/[\p{L}\p{N}_'-]+/gu, w => {
      if (first) { first = false; return k ? w.charAt(0).toUpperCase() + w.slice(1) : w; }
      const c = ref.get(Match.fold(w.toLowerCase()));
      return c && c.toLowerCase() === w.toLowerCase() ? c : w;
    });
  }).join('');
}

/** The model's own spelling of its words past the first of each sentence (Uhr, Lernen). @param {string} model */
function modelCase(model) {
  /** @type {Map<string, string>} */ const m = new Map();
  String(model || '').normalize('NFC').split(/(?<=[.!?:])\s+/).forEach(sent => Match.words(sent).forEach((/** @type {any} */ w, /** @type {number} */ i) => { if (i) m.set(Match.fold(w.low), w.raw); }));
  return m;
}

/** @param {string} s */
const wordsIn = s => Match.words(String(s || '')).length;

/**
 * The model's strict capitalised words (Sie, Ihnen, Ihre …) that the answer has in lower case, matched word for word
 * (the longest common run of words), past the first word of a sentence. @param {string} input @param {string} model
 * @param {string[]} strict @returns {{typed: string, expected: string, start: number, end: number}[]}
 */
function politeMiss(input, model, strict) {
  const S = new Set(strict.filter(w => /^\p{Lu}/u.test(w)));
  if (!S.size || !model) return [];
  const A = Match.words(input), B = Match.words(model), n = A.length, m = B.length;
  const T = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) T[i][j] = A[i].n === B[j].n ? T[i + 1][j + 1] + 1 : Math.max(T[i + 1][j], T[i][j + 1]);
  const out = [];
  for (let i = 0, j = 0; i < n && j < m;) {
    if (A[i].n === B[j].n) {
      const a = A[i], b = B[j];
      const initial = !i || /[.!?:]\s*["„“]?\s*$/.test(input.slice(0, a.start));
      if (S.has(b.raw) && /^\p{Ll}/u.test(a.raw) && !initial) out.push({ typed: a.raw, expected: b.raw, start: a.start, end: a.end });
      i++; j++;
    } else if (T[i + 1][j] >= T[i][j + 1]) i++; else j++;
  }
  return out;
}

/** @param {{start: number}} t @param {{start: number}[]} list */
const overlaps = (t, list) => list.some(x => x.start === t.start);

/** The phrase he typed (slot words as …), for "<phrase> is right". @param {any} r */
function phraseOf(r) {
  if (!r.span) return null;
  let s = r.input.slice(r.span[0], r.span[1]);
  for (const f of r.fills || []) if (f) s = s.replace(f, '…');
  return s.replace(/[\s,.;:!?]+$/u, '').trim() || null;
}

/** Words from the item's known wrong answers that no accepted answer has: never a typo or slip. @param {any} it @param {string[]} accepted */
function neverWords(it, accepted) {
  if (!it.wrong || !it.wrong.length) return null;
  const okw = new Set(Match.words([...(accepted || []), it.model || ''].join(' ').replace(/\[[^\]]*\]/g, ' ')).map((/** @type {any} */ w) => w.n));
  const out = Match.words(it.wrong.join(' ')).map((/** @type {any} */ w) => w.n).filter((/** @type {string} */ n) => !okw.has(n));
  return out.length ? out : null;
}

/**
 * A situation's slot words with no German in them ("wie wäre es, wenn wir blorf quazz machen"). Needs the lexicon. @param {any} r @param {Set<string> | null | undefined} lex
 * @returns {Rest | null}
 */
function junkSlots(r, lex) {
  if (!lex || !lex.size || !r.span || !(r.fills || []).some((/** @type {string} */ f) => f)) return null;
  // his own words: the slots and anything around the phrase
  const free = [r.input.slice(0, r.span[0]), ...r.fills, r.input.slice(r.span[1])].join(' ');
  // two or more words that are no German form the content knows, and at least half of his lower-case words: junk
  // (one unknown word passes: the lexicon misses about 5 % of the words in real B1 texts)
  const lower = Match.words(free).filter((/** @type {any} */ w) => !/^\p{Lu}/u.test(w.raw) && !/\d/.test(w.raw));
  const unknown = lower.filter((/** @type {any} */ w) => !lex.has(w.n) && !Match.CLOSED.has(w.n)).length;
  if (unknown < 2 || 2 * unknown < lower.length) return null;
  const wrong = [];
  for (const f of r.fills || []) if (f) { const at = r.input.indexOf(f); wrong.push({ start: at, end: at + f.length }); }
  return { status: 'differs', ref: '', marks: [], wrong, junk: true };
}
