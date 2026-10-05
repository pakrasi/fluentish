// The French grading corpus (C3b), the German corpus's model (tests/corpus/grading-corpus.mjs) for the French course:
// typical A2-B1 learner errors made in the course's own model sentences and words (answers that must NOT come back as
// right) and right variants (answers that must not be marked wrong), each run through the app's grading path
// (features/shared/grade.js gradeAnswer, the call the round makes) with the French pack active.
//
//   node tests/corpus/grading-corpus.fr.mjs [--list fp|fn|soft] [--type <type>]
//
// verdict: 'right' (green), 'partial' (the phrase is right, the rest of the sentence differs: Hard), 'wrong'.
// A false positive is a wrong answer graded 'right'. Every generator only makes changes that are wrong in context;
// each one is described next to its code.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fr from '../../src/lang/fr/index.js';
import { setActivePack } from '../../src/lang/registry.js';
import { gradeAnswer } from '../../src/features/shared/grade.js';
import { buildCoursePool } from '../../src/features/shared/course.js';
import * as Match from '../../src/domain/match.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const J = (/** @type {string} */ p) => JSON.parse(readFileSync(path.join(ROOT, p), 'utf8'));
const toks = (/** @type {string} */ s) => fr.text.tokenize(fr.text.normalize(s));
/** Replace token k of s with w. @param {string} s @param {any} t @param {string} w */
const put = (s, t, w) => s.slice(0, t.start) + w + s.slice(t.end);
/** Keep the case of the word replaced. @param {string} raw @param {string} w */
const cased = (raw, w) => (/^\p{Lu}/u.test(raw) ? w.charAt(0).toUpperCase() + w.slice(1) : w);

/** The course pool, as the app builds it (French pack active). */
export function coursePool() {
  setActivePack('fr');
  const course = J('content/course/fr.json'), words = J('content/igloo/words/fr.json'), chunks = J('content/igloo/chunks/french.json');
  return buildCoursePool({ course, words, pack: fr, t: k => k, lang: 'fr', texts: Object.values(chunks.chunks).map((/** @type {any} */ c) => c.ex).filter(Boolean) });
}

/* ---------- wrong answers: sentences ---------- */
// the article or determiner of the other gender, in a correct sentence: wrong (la maison → le maison)
const GENDER = /** @type {Record<string, string>} */ ({ le: 'la', la: 'le', un: 'une', une: 'un', mon: 'ma', ma: 'mon', ton: 'ta', ta: 'ton', son: 'sa', sa: 'son', ce: 'cette', cette: 'ce', du: 'de la', au: 'à la' });
// an accent that carries meaning, dropped or added: wrong (où → ou, à → a, là → la, sûr → sur, dû → du)
const MEANING = /** @type {Record<string, string>} */ ({ 'où': 'ou', 'à': 'a', 'là': 'la', 'sûr': 'sur', 'sûre': 'sure', 'dû': 'du', 'dès': 'des' });
// verbs that take être in the passé composé: their participles
const ETRE_PP = /^(allé|venu|arrivé|parti|né|mort|resté|tombé|devenu|revenu|rentré|sorti|entré|monté|descendu|retourné)(e?s?)$/;
const ETRE_AUX = /** @type {Record<string, string>} */ ({ suis: "ai", es: 'as', est: 'a', sommes: 'avons', 'êtes': 'avez', sont: 'ont' });
const AVOIR_AUX = /** @type {Record<string, string>} */ ({ ai: 'suis', as: 'es', a: 'est', avons: 'sommes', avez: 'êtes', ont: 'sont' });
const PP = /^\p{L}+(é|i|u|is|it|ert|ait)$/u;
const AVOIR_PP_SAFE = /^\p{L}{3,}(é)$/u;   // a regular -er participle after avoir (j'ai mangé): être makes it a passive or wrong
// the person of être and avoir after their subject: another person is wrong (je suis → je est)
const PERSON = /** @type {Record<string, [string, string]>} */ ({ je: ['suis', 'est'], tu: ['es', 'sont'], il: ['est', 'es'], elle: ['est', 'sont'], on: ['est', 'sont'], nous: ['sommes', 'sont'], vous: ['êtes', 'est'], ils: ['sont', 'est'], elles: ['sont', 'est'] });
const PERSON_AV = /** @type {Record<string, [string, string]>} */ ({ "j'": ['ai', 'a'], tu: ['as', 'a'], il: ['a', 'ont'], elle: ['a', 'ont'], on: ['a', 'ont'], nous: ['avons', 'ont'], vous: ['avez', 'a'], ils: ['ont', 'a'], elles: ['ont', 'a'] });

/** The word list's adjectives: feminine → masculine, where they differ (set by evaluate()). @type {Map<string, string>} */
const ADJ_FEM = new Map();

/**
 * The wrong versions of a correct sentence, with the class of error each one is.
 * @param {string} s @param {Set<string>} feminineNouns the word list's feminine nouns (for the agreement errors)
 * @returns {{cls: string, text: string}[]}
 */
export function wrongSentences(s, feminineNouns) {
  const out = [];
  const T = toks(s);
  for (let i = 0; i < T.length; i++) {
    const t = T[i], low = t.low, next = T[i + 1], prev = T[i - 1];
    // gender: the article or determiner before a word, swapped (an object pronoun le/la before y, en, lui, leur or a
    // participle is left alone); before a vowel the other gender would need l', mon or cet, so those are skipped
    if (GENDER[low] && next && /^\p{L}/u.test(next.raw) && !((low === 'le' || low === 'la') && (/^(lui|leur|y|en)$/.test(next.low) || PP.test(next.low)))) {
      const w = GENDER[low];
      if (!(/^[aeiouyhàâéèêîôûœ]/i.test(next.raw) && /^(le|la|ma|ta|sa|ce)$/.test(w))) out.push({ cls: 'gender', text: put(s, t, cased(t.raw, w)) });
    }
    // elision left out: l'ami → le ami, j'ai → je ai, qu'il → que il, c'est → ce est, d'accord → de accord
    if (/^(l|j|qu|c|d|n|s|m|t)'$/.test(low) && next) {
      const full = /** @type {Record<string, string>} */ ({ "l'": 'le', "j'": 'je', "qu'": 'que', "c'": 'ce', "d'": 'de', "n'": 'ne', "m'": 'me', "t'": 'te', "s'": 'se' })[low];
      out.push({ cls: 'elision', text: s.slice(0, t.start) + cased(t.raw, full) + ' ' + s.slice(next.start) });
    }
    // a meaning accent dropped or added
    if (MEANING[low]) out.push({ cls: 'meaning-accent', text: put(s, t, cased(t.raw, MEANING[low])) });
    // the auxiliary: être for avoir and avoir for être, before a participle
    if (next && ETRE_AUX[low] && ETRE_PP.test(next.low) && prev && /^(je|tu|il|elle|on|nous|vous|ils|elles)$/.test(prev.low)) {
      const aux = ETRE_AUX[low];
      out.push({ cls: 'aux', text: prev.low === 'je' ? s.slice(0, prev.start) + cased(prev.raw, "j'") + aux + s.slice(t.end) : put(s, t, aux) });
    }
    if (next && AVOIR_AUX[low] && AVOIR_PP_SAFE.test(next.low) && prev && /^(j'|tu|il|elle|on|nous|vous|ils|elles)$/.test(prev.low)) {
      const aux = AVOIR_AUX[low];
      out.push({ cls: 'aux', text: prev.low === "j'" ? s.slice(0, prev.start) + cased(prev.raw, 'je ') + aux + s.slice(t.end) : put(s, t, aux) });
    }
    // a participle's final é left out: j'ai mangé → j'ai mange (the present tense)
    if (prev && (AVOIR_AUX[prev.low] || ETRE_AUX[prev.low]) && /^\p{L}{3,}é(e?s?)$/u.test(low)) out.push({ cls: 'participle-e', text: put(s, t, t.raw.replace(/é(e?s?)$/u, 'e$1')) });
    // agreement after être: elle est allée → elle est allé; ils sont partis → ils sont parti
    if (prev && /^(est|sont)$/.test(prev.low) && ETRE_PP.test(low) && /(e|s|es)$/.test(low) && T[i - 2] && /^(elle|elles|ils)$/.test(T[i - 2].low)) {
      out.push({ cls: 'agreement', text: put(s, t, t.raw.replace(/(e|s|es)$/, '')) });
    }
    // the person of être and avoir: je suis → je est, nous avons → nous ont
    if (prev && PERSON[prev.low] && PERSON[prev.low][0] === low) out.push({ cls: 'person', text: put(s, t, PERSON[prev.low][1]) });
    if (prev && PERSON_AV[prev.low] && PERSON_AV[prev.low][0] === low) out.push({ cls: 'person', text: put(s, t, PERSON_AV[prev.low][1]) });
    // ne … pas around the verb: je ne parle pas → je ne pas parle
    if ((low === 'ne' || low === "n'") && next && T[i + 2] && T[i + 2].low === 'pas' && /^(je|j'|tu|il|elle|on|nous|vous|ils|elles)$/.test(prev ? prev.low : '') && !/^(le|la|les|l'|me|m'|te|t'|se|s'|lui|leur|y|en|nous|vous)$/.test(next.low)) {
      const verb = next, pas = T[i + 2];
      out.push({ cls: 'ne-pas', text: s.slice(0, verb.start) + 'pas ' + verb.raw + s.slice(pas.end) });
    }
    // a feminine noun's adjective left masculine: une grande maison → une grand maison, elle est contente → elle est
    // content (the word list's adjectives, after a feminine determiner, a feminine noun, or elle est)
    const masc = ADJ_FEM.get(low);
    if (masc && prev && (/^(la|une|cette|ma|ta|sa)$/.test(prev.low) || feminineNouns.has(prev.low) || (/^(est|était)$/.test(prev.low) && T[i - 2] && T[i - 2].low === 'elle'))) {
      out.push({ cls: 'agreement', text: put(s, t, cased(t.raw, masc)) });
    }
  }
  return out;
}

/* ---------- right answers: sentences ---------- */
const PLAIN = (/** @type {string} */ c) => c.normalize('NFD').replace(/\p{M}/gu, '');
/**
 * Right versions of a correct sentence: as typed on a keyboard without French accents (é è ê ç left out, a slip),
 * without the final punctuation and the guillemets, in lower case, with typographic apostrophes and no-break spaces,
 * with œ typed oe. A dropped accent that changes the word (où, à, là, a participle's final é) is not one of them.
 * @param {string} s @returns {{cls: string, text: string}[]}
 */
export function rightSentences(s) {
  const out = [{ cls: 'model', text: s }];
  out.push({ cls: 'no-final-punct', text: s.replace(/[\s.!?…»]+$/u, '') });
  out.push({ cls: 'typographic', text: s.replace(/'/g, '’').replace(/ ([?!:;»])/g, ' $1').replace(/« /g, '« ') });
  if (/œ/i.test(s)) out.push({ cls: 'oe', text: s.replace(/œ/g, 'oe').replace(/Œ/g, 'Oe') });
  // one non-meaning accent dropped per sentence (the first one that is a slip)
  const T = toks(s);
  for (const t of T) {
    if (!/[éèêëçîïôûù]/i.test(t.raw) || MEANING[t.low] || /é(e?s?)$/u.test(t.low)) continue;
    const plain = t.raw.replace(/[éèêëçîïôûù]/gi, c => PLAIN(c));
    if (fr.grading.minimalPairs.has(plain.toLowerCase())) continue;
    out.push({ cls: 'accent-slip', text: put(s, t, plain) });
    break;
  }
  return out;
}

/* ---------- word cards ---------- */
/**
 * Wrong and right answers for one word card. @param {any} it a word item (course.js wordItem) @param {any} w its word-list entry
 * @returns {{want: 'right'|'wrong', cls: string, text: string}[]}
 */
export function wordAnswers(it, w) {
  const out = [];
  if (w.pos === 'noun') {
    const g = w.g === 'f' ? 'f' : 'm';
    const def = w.art === "l'" ? `l'${w.w}` : `${w.art} ${w.w}`;
    const ind = `${g === 'f' ? 'une' : 'un'} ${w.w}`;
    out.push({ want: 'right', cls: 'noun-definite', text: def }, { want: 'right', cls: 'noun-indefinite', text: ind });
    out.push({ want: 'wrong', cls: 'noun-gender', text: `${g === 'f' ? 'un' : 'une'} ${w.w}` });
    if (w.art !== "l'") out.push({ want: 'wrong', cls: 'noun-gender', text: `${w.art === 'la' ? 'le' : 'la'} ${w.w}` });
    else out.push({ want: 'wrong', cls: 'noun-elision', text: `${g === 'f' ? 'la' : 'le'} ${w.w}` });
    out.push({ want: 'wrong', cls: 'noun-no-article', text: w.w });
    if (w.pl && w.pl !== w.w && w.pl !== `${w.w}s`) out.push({ want: 'wrong', cls: 'noun-plural', text: `les ${w.pl}` });
  } else if (w.pos === 'verb') {
    out.push({ want: 'right', cls: 'verb-infinitive', text: w.w });
    const pres = String(w.forms || '').split('·')[0].trim().replace(/^il\s+/, '');
    if (pres && pres !== w.w.replace(/^(se |s')/, '')) out.push({ want: 'wrong', cls: 'verb-conjugated', text: pres });
    if (w.pp && w.pp !== w.w) out.push({ want: 'wrong', cls: 'verb-participle', text: w.pp });
  } else if (w.pos === 'adj') {
    out.push({ want: 'right', cls: 'adj-base', text: w.w });
    if (w.fem && w.fem !== w.w && !w.fem.startsWith(`${w.w}e`) === false) out.push({ want: 'wrong', cls: 'adj-feminine', text: w.fem });
  } else {
    out.push({ want: 'right', cls: 'word', text: w.w });
  }
  // a dropped accent inside the word: a slip, right; a final é of a verb or an adjective (fatigué → fatigue, the
  // participle's form) is the other word, wrong
  if (/[éèêçîïôûù]/.test(w.w)) {
    const head = it.model, plain = head.replace(/[éèêçîïôûù]/g, (/** @type {string} */ c) => PLAIN(c));
    const finalE = /é(s?)$/.test(w.w) && (w.pos === 'verb' || w.pos === 'adj');
    if (finalE) out.push({ want: 'wrong', cls: 'final-e', text: plain });
    else if (!fr.grading.minimalPairs.has(plain.toLowerCase().split(' ').pop() || '')) out.push({ want: 'right', cls: 'word-accent-slip', text: plain });
  }
  return out;
}

/**
 * Every corpus entry, graded. @returns {any[]}
 */
export function evaluate() {
  const data = /** @type {any} */ (coursePool());
  const words = new Map(J('content/igloo/words/fr.json').map((/** @type {any} */ w) => [`W:${w.id}`, w]));
  const fem = new Set([...words.values()].filter(w => w.pos === 'noun' && w.g === 'f').map(w => w.w));
  ADJ_FEM.clear();
  for (const w of words.values()) if (w.pos === 'adj' && w.fem && w.fem !== w.w) ADJ_FEM.set(w.fem, w.w);
  /** @type {any[]} */ const corpus = [];
  for (const it of data.pool) {
    if (it.kind === 'word') {
      for (const a of wordAnswers(it, words.get(it.id))) corpus.push({ type: 'word', id: it.id, ...a });
      continue;
    }
    const seen = new Set([it.model]);
    for (const r of rightSentences(it.model)) { if (r.cls !== 'model' && seen.has(r.text)) continue; seen.add(r.text); corpus.push({ type: 'phrase', id: it.id, want: 'right', ...r }); }
    // the other accepted wordings in the model's place (variants: tu for vous, je crois for je pense …): a right answer
    // the rest may not fit (then Hard is fine, wrong is a false negative); patterns with optional words or slots are
    // written out with their optional words
    const hit = Match.check(it.model, it.accept, { anywhere: true, pack: fr });
    if (hit.ok && hit.span) {
      for (const p of it.accept) {
        if (p === hit.matched || /\[|…/.test(p)) continue;
        const before = it.model.slice(0, hit.span[0]), after = it.model.slice(hit.span[1]), mid = p.replace(/[()]/g, '').replace(/\s+/g, ' ').trim();
        // a wording that would need elision where it meets the sentence (que + ils, je + aller) is not a right answer
        const clash = (/** @type {string} */ a, /** @type {string} */ b) => /(^|\s)(je|me|te|se|le|la|ne|de|que|ce)$/i.test(a.trim()) && /^[aeiouhàâéèêîôœ]/i.test(b.trim());
        if (clash(before, mid) || clash(mid, after) || (/'$/.test(mid) !== /'$/.test(it.model.slice(hit.span[0], hit.span[1])))) continue;
        const text = (before + mid + (/^\p{L}/u.test(after) ? ' ' : '') + after).replace(/^(\P{L}*)(\p{L})/u, (_, a, b) => a + b.toUpperCase());
        if (seen.has(text)) continue; seen.add(text);
        corpus.push({ type: 'phrase', id: it.id, want: 'right', cls: 'other-wording', variant: true, text });
      }
    }
    for (const w of wrongSentences(it.model, fem)) { if (seen.has(w.text)) continue; seen.add(w.text); corpus.push({ type: 'phrase', id: it.id, want: 'wrong', ...w }); }
  }
  for (const c of corpus) {
    const it = data.byId.get(c.id);
    const g = gradeAnswer(it, c.text, null, data);
    c.verdict = !g.ok ? 'wrong' : g.rest && g.rest.status === 'differs' ? 'partial' : 'right';
    c.fp = c.want === 'wrong' && c.verdict === 'right';
    c.fn = c.want === 'right' && c.verdict === 'wrong';
    c.soft = c.want === 'right' && c.verdict === 'partial';
    c.slip = c.want === 'right' && c.verdict === 'right' && ((g.umlautMiss || []).length > 0 || (g.typos || []).length > 0);
    c.det = g.det ? g.det.cls : null;
  }
  return corpus;
}

/** Counts per class. @param {any[]} corpus */
export function table(corpus) {
  /** @type {Map<string, {want: string, n: number, fp: number, fn: number, soft: number, slip: number}>} */ const by = new Map();
  for (const c of corpus) {
    const k = `${c.want} ${c.type} ${c.cls}`;
    const r = by.get(k) || { want: c.want, n: 0, fp: 0, fn: 0, soft: 0, slip: 0 };
    r.n++; if (c.fp) r.fp++; if (c.fn) r.fn++; if (c.soft) r.soft++; if (c.slip) r.slip++;
    by.set(k, r);
  }
  const all = { wrong: corpus.filter(c => c.want === 'wrong').length, right: corpus.filter(c => c.want === 'right' && !c.variant).length,
    fp: corpus.filter(c => c.fp).length, fn: corpus.filter(c => c.fn && !c.variant).length, soft: corpus.filter(c => c.soft && !c.variant).length,
    vRight: corpus.filter(c => c.variant).length, vFn: corpus.filter(c => c.variant && c.fn).length, vSoft: corpus.filter(c => c.variant && c.soft).length };
  return { by, all };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const corpus = evaluate();
  const { by, all } = table(corpus);
  const list = process.argv.includes('--list') ? process.argv[process.argv.indexOf('--list') + 1] : null;
  const type = process.argv.includes('--type') ? process.argv[process.argv.indexOf('--type') + 1] : null;
  console.log('class | n | wrong graded right | right graded wrong | right flagged Hard | right with a slip');
  for (const [k, r] of [...by].sort()) console.log(`${k} | ${r.n} | ${r.fp} | ${r.fn} | ${r.soft} | ${r.slip}`);
  console.log(`ALL: ${all.wrong} wrong answers, ${all.fp} graded right; ${all.right} right answers, ${all.fn} graded wrong, ${all.soft} Hard; ${all.vRight} other wordings, ${all.vFn} graded wrong, ${all.vSoft} Hard`);
  if (list) for (const c of corpus.filter(x => x[list] && (!type || x.cls === type))) console.log(`${c.cls} ${c.id}: ${c.text}${c.det ? ` [${c.det}]` : ''}`);
}
