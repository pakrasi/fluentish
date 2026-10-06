/* Reading: the pure parts (tested in node: tests/unit/read-*.test.mjs). Language-neutral: every rule about the
   language comes from its pack (pack.text, pack.reading, pack.grammar.morphology); nothing here knows German.

     cleanPaste     pasted text, subtitles (SRT, VTT) or a copied YouTube transcript → plain text
     makeRead       a pasted text → a read@1 record (Scripts' section and sentence shape, domain/script/parse.js)
     analyse        each sentence's tokens, classified (domain/text/suggest.js), with the strongest unknown words dotted
     textLevel      the CEFR level of a text from the word list (the level whose words cover 95 % of its running words)
     estimate       level, his personal coverage and its band (domain/text/estimate.js)
     phraseIndex /
     phrasesIn      multi-word items of the word list (eine Rolle spielen, in Betracht ziehen) found in a sentence
     partners       the other half of a separable verb ("halten … dagegen")
     itemFor        the card id of a saved word or phrase
     homeOf         one card per item: the deck that already has a card for it
     triage         a saved item is reviewed or kept for reference
     questions      Claude's comprehension questions, checked (answer in range, distinct options, evidence verbatim) */
import { parseScript, idMaker } from '../../domain/script/parse.js';
import { tokenize, splitSentences } from '../../domain/text/tokens.js';
import { classify, capSuggest } from '../../domain/text/suggest.js';
import { personalCoverage, levelRank, LEVELS, bandOf } from '../../domain/text/estimate.js';
import { slug, phraseKey } from '../../domain/itemids.js';
import { fnv1a } from '../../data/ids.js';

/** @typedef {import('../../lang/types.js').LanguagePack} LanguagePack */
/** @typedef {import('../../lang/types.js').WordEntry} Word */
/** @typedef {import('../../lang/types.js').WordIndex} Index */
/** @typedef {import('../../domain/text/tokens.js').Token} Token */
/** @typedef {import('../../domain/text/suggest.js').Classified} Classified */

/** The estimator's version: a stored estimate from another version is made again. */
export const ESTIMATE_VER = 3;   // 3: words assumed from his level and words read without a look-up count (round 4)
/** The share of listed content words a level's word list must cover for the text to be at that level (calibrated on
    the graded texts: tests/unit/read-logic.test.mjs). */
export const LEVEL_COVER = 0.92;
/** Longest text he can paste (characters): a long article. */
export const MAX_CHARS = 60000;

/* ---------- paste ---------- */

const SRT_TIME = /^\d{1,2}:\d\d:\d\d[,.]\d{1,3}\s*-->\s*\d{1,2}:\d\d:\d\d[,.]\d{1,3}.*$/;
const VTT_TIME = /^(\d{1,2}:)?\d\d:\d\d\.\d{3}\s*-->\s*(\d{1,2}:)?\d\d:\d\d\.\d{3}.*$/;
const YT_TIME = /^\d{1,2}(:\d\d){1,2}$/;

/**
 * Plain text from what he pasted: subtitles lose their numbers, times and tags; a copied YouTube transcript loses its
 * time lines; the cue lines join into running text.
 * @param {string} raw @returns {{text: string, format: 'de' | 'srt' | 'vtt' | 'yt'}}
 */
export function cleanPaste(raw) {
  const s = String(raw || '').replace(/\r\n?/g, '\n').slice(0, MAX_CHARS);
  const lines = s.split('\n');
  const timed = (/** @type {RegExp} */ re) => lines.filter(l => re.test(l.trim())).length;
  /** @type {'de' | 'srt' | 'vtt' | 'yt'} */ let format = 'de';
  if (/^\uFEFF?WEBVTT/.test(s.trim()) || timed(VTT_TIME) >= 2) format = timed(SRT_TIME) >= 2 && !/^\uFEFF?WEBVTT/.test(s.trim()) ? 'srt' : 'vtt';
  else if (timed(SRT_TIME) >= 2) format = 'srt';
  else if (timed(YT_TIME) >= 3 && timed(YT_TIME) >= lines.filter(l => l.trim()).length / 3) format = 'yt';
  if (format === 'de') return { text: s.trim(), format };
  /** @type {string[]} */ const keep = [];
  for (const l0 of lines) {
    const l = l0.trim();
    if (!l || /^\uFEFF?WEBVTT/.test(l) || /^(NOTE|STYLE|REGION)\b/.test(l) || SRT_TIME.test(l) || VTT_TIME.test(l) || YT_TIME.test(l)) continue;
    if (format !== 'yt' && /^\d+$/.test(l)) continue;
    const text = l.replace(/<[^>]*>/g, '').replace(/\{\\[^}]*\}/g, '').replace(/^\[[^\]]*\]$/, '').trim();
    if (text) keep.push(text);
  }
  // cue lines run on: join them, and drop a line that repeats the one before (rolling captions)
  const out = keep.filter((l, i) => l !== keep[i - 1]).join(' ').replace(/\s+/g, ' ').trim();
  return { text: out, format };
}

/**
 * A pasted text as a read@1 record. Paragraphs and headings keep Scripts' parser's sections and sentence ids.
 * @param {{raw: string, title: string, note?: string | null, id: string, lang: string, profileId?: string | null, now: string, untitled: string}} o
 */
export function makeRead({ raw, title, note = null, id, lang, profileId = null, now, untitled }) {
  const { text, format } = cleanPaste(raw);
  const p = parseScript(text, { format: 'de', id: idMaker() });
  const sections = p.sections.map(s => ({ id: s.id, title: s.title, sentences: s.sentences.map(x => ({ id: x.id, de: x.de, ...(x.p ? { p: true } : {}) })) }));
  return { id, v: 1, profileId, lang, title: String(title || '').trim().slice(0, 120) || p.title || p.sections[0]?.title || untitled, source: { kind: 'paste', label: note ? String(note).trim().slice(0, 120) || null : null },
    format, mode: /** @type {'intensive' | 'extensive'} */ ('intensive'), sections, estimate: null, progress: {}, createdAt: now, opened: Date.now(), deletedAt: null };
}

/**
 * A graded text (content readers@1) in the reader's shape.
 * @param {any} text a readers@1 text
 */
export function gradedSections(text) {
  return (text.sections || []).map((/** @type {any} */ s) => ({ id: s.id, title: s.title || '', sentences: (s.sentences || []).map((/** @type {any} */ x) => ({ id: x.id, de: x.text, en: x.en || null })) }));
}

/** The sentences of a text, in order. @param {{sections: any[]}} r @returns {{id: string, de: string, p?: boolean, section: string}[]} */
export const sentencesOf = r => (r.sections || []).flatMap((/** @type {any} */ s, /** @type {number} */ k) => (s.sentences || []).map((/** @type {any} */ x, /** @type {number} */ i) => ({ ...x, p: !!x.p || (i === 0 && k > 0), section: s.id })));

/** Running words in a text. @param {{sections: any[]}} r */
export const wordsIn = r => sentencesOf(r).reduce((n, x) => n + tokenize(x.de).filter(t => t.w && !t.num).length, 0);

/** A text's fingerprint, for caches made from it. @param {{sections: any[]}} r */
export const textHash = r => fnv1a(sentencesOf(r).map(x => x.de).join('\n'));

/** The text as one string. @param {{sections: any[]}} r */
export const plainText = r => sentencesOf(r).map(x => x.de).join(' ');

/* ---------- analysis ---------- */

/**
 * Each sentence's tokens and their classification. In intensive mode the strongest unknown words are suggested
 * (at most 12 % of the words; capSuggest), in extensive mode none.
 * @param {{id: string, de: string}[]} sentences
 * @param {Omit<Parameters<typeof classify>[1], 'pack' | 'idx'> & {pack: LanguagePack, idx: Index, suggest?: boolean}} o
 * @returns {{toks: Token[], cls: Classified[]}[]}
 */
export function analyse(sentences, o) {
  const toks = sentences.map(s => tokenize(s.de));
  const cls = toks.map(t => classify(t, o));
  if (o.suggest === false) for (const s of cls) for (const x of s) x.suggest = false;
  else capSuggest(cls);
  return toks.map((t, i) => ({ toks: t, cls: cls[i] }));
}

/**
 * The text's level from the word list: the lowest CEFR level whose words cover LEVEL_COVER of its listed content
 * words (function words and words off the list are left out); one level higher when the pack's harder
 * constructions come more than twice per 100 words or the sentences are long (over 22 words on average).
 * @param {{toks: Token[], cls: Classified[]}[]} an @param {LanguagePack} pack @param {Index} [idx]
 * @returns {string}
 */
export function textLevel(an, pack, idx) {
  const stop = pack.reading?.stop || new Set();
  const look = pack.grammar?.morphology?.lookup || null;
  const fold = (/** @type {string} */ s) => pack.text.fold(s.toLowerCase());
  const by = LEVELS.map(() => 0);
  let n = 0, all = 0;
  for (const { cls } of an) for (const x of cls) {
    if (!x || x.type !== 'word') continue;
    n++; all++;
    let e = x.entry;
    if (!e && x.how === 'compound' && look && idx) e = look(x.lemma, idx).part || null;
    // function words and words off the list say nothing about the level (every text has the first; the list is not
    // every word): only the listed content words are measured
    if (stop.has(fold(x.lemma)) || !e || !e.level) n--;
    else by[levelRank(e.level)]++;
  }
  if (!n) return LEVELS[0];
  let at = LEVELS.length - 1, sum = 0;
  for (let i = 0; i < LEVELS.length; i++) { sum += by[i]; if (sum / n >= LEVEL_COVER - 1e-9) { at = i; break; } }
  const cons = pack.reading?.constructions || [];
  const hits = an.reduce((k, s) => k + cons.filter(c => { try { return c.test(s.toks); } catch { return false; } }).length, 0);
  const mean = all / Math.max(1, an.length);
  if ((all >= 50 && (hits * 100) / all > 2) || mean > 22) at = Math.min(LEVELS.length - 1, at + 1);
  return LEVELS[at];
}

/**
 * The estimate shown with a text: its level, his coverage and the band.
 * @param {{toks: Token[], cls: Classified[]}[]} an
 * @param {{pack: LanguagePack, idx: Index, view: {get: (id: string) => {state: any}}, level?: string, known?: Set<string>, met?: Set<string>}} o
 */
export function estimate(an, { pack, idx, view, level = 'B1', known, met }) {
  const cov = personalCoverage(an.map(s => s.cls), { pack, view, level, idx, known, met });
  return { level: textLevel(an, pack, idx), coverage: Math.round(cov.coverage * 1000) / 1000, band: cov.band, words: cov.words, known: cov.known, unknown: cov.unknown.slice(0, 40), by: cov.by, ver: ESTIMATE_VER };
}

export { bandOf };

/** "1 new word in 11" from a coverage. @param {number} coverage */
export const oneIn = coverage => (coverage >= 1 ? 0 : Math.max(2, Math.round(1 / Math.max(1e-6, 1 - coverage))));

/* ---------- lemmas, separable verbs and phrases ---------- */

/**
 * The dictionary forms of the word at token i in its sentence, best first: the pack's clause-aware lemma (a
 * separable verb joined across the clause), else the word-list lookup.
 * @param {LanguagePack} pack @param {Index} idx @param {Token[]} toks @param {number} i
 * @returns {string[]}
 */
export function lemmasAt(pack, idx, toks, i) {
  const M = pack.grammar?.morphology;
  const t = toks[i];
  if (!t || !t.w) return [];
  if (M?.lemma) { try { const l = M.lemma(t, toks, i, idx); if (l.length) return l; } catch { /* the lookup below */ } }
  const words = toks.filter(x => x.w);
  const L = M?.lookup ? M.lookup(t.t, idx, { start: t === words[0] }) : { lemma: t.t.toLowerCase() };
  return [L.lemma];
}

/**
 * The tokens that belong with token i as one word: the other half of a separable verb ("Kritiker halten … dagegen"
 * → both). The pack's lemma gives the joined verb for both halves; a word whose own lookup is that verb is not split.
 * @param {LanguagePack} pack @param {Index} idx @param {Token[]} toks @param {number} i
 * @returns {{lemma: string, at: number[]}}  at: token indices, i first
 */
export function partners(pack, idx, toks, i) {
  const first = lemmasAt(pack, idx, toks, i)[0] || '';
  const at = [i];
  const look = pack.grammar?.morphology?.lookup;
  const own = look ? look(toks[i].t, idx, {}).lemma : toks[i].t;
  if (!first || first.toLowerCase() === String(own).toLowerCase()) return { lemma: first, at };
  toks.forEach((t, j) => { if (j !== i && t.w && !t.num && (lemmasAt(pack, idx, toks, j)[0] || '').toLowerCase() === first.toLowerCase()) at.push(j); });
  return { lemma: first, at };
}

/**
 * @typedef {object} Phrase
 * @property {string} id       the word list's id ("eine_Rolle_spielen.phrase")
 * @property {string} w        as listed
 * @property {string[]} keys   the lemmas that must all be in the sentence (lower case, articles and fillers left out)
 * @property {Word} entry
 */

// placeholders and the articles a phrase may take in any case
const FILL = /^(etw\.?|jdn\.?|jdm\.?|jds\.?|sich|etwas|jemand|jemanden|jemandem|qch|qn|\.\.\.|…)$/i;

/**
 * The multi-word items of the word list, keyed by their lemmas, for finding them in running text. A phrase needs two
 * keys at least, and one that is not a function word.
 * @param {Word[]} words @param {LanguagePack} pack @param {Index} idx @returns {Phrase[]}
 */
export function phraseIndex(words, pack, idx) {
  const stop = pack.reading?.stop || new Set();
  const arts = new Set(Object.values(pack.grammar?.gender?.articles || {}).flat().map(a => a.toLowerCase()));
  const fold = (/** @type {string} */ s) => pack.text.fold(s.toLowerCase());
  const look = pack.grammar?.morphology?.lookup;
  /** @type {Phrase[]} */ const out = [];
  for (const e of words || []) {
    if (!e || !e.id || !/\s/.test(String(e.w).trim()) || /[?!]$/.test(String(e.w).trim())) continue;
    const toks = tokenize(String(e.w)).filter(t => t.w && !t.num && !FILL.test(t.t) && !arts.has(t.t.toLowerCase()));
    if (toks.length < 2 || toks.length > 5) continue;
    const keys = toks.map((t, i) => (look ? look(t.t, idx, { start: i === 0 && !/^\p{Lu}/u.test(t.t) }).lemma : t.t).toLowerCase());
    if (keys.every(k => stop.has(fold(k)))) continue;
    out.push({ id: e.id, w: e.w, keys, entry: e });
  }
  return out;
}

/**
 * The phrases of the index in one sentence: every key among the sentence's lemmas, within 12 words. Longer phrases
 * first; a token belongs to one phrase at most.
 * @param {string[][]} lemmas  per token: its lemma candidates in lower case ([] for punctuation)
 * @param {Phrase[]} phrases
 * @returns {{phrase: Phrase, at: number[]}[]}
 */
export function phrasesIn(lemmas, phrases) {
  /** @type {Map<string, number[]>} */ const where = new Map();
  lemmas.forEach((ls, j) => { for (const l of ls) { const a = where.get(l) || []; if (!a.includes(j)) a.push(j); where.set(l, a); } });
  /** @type {{phrase: Phrase, at: number[]}[]} */ const hits = [];
  for (const p of phrases) {
    if (!p.keys.every(k => where.has(k))) continue;
    // the nearest tokens for each key, one token per key
    const used = new Set(); const at = [];
    for (const k of p.keys) { const j = /** @type {number[]} */ (where.get(k)).find(x => !used.has(x)); if (j == null) { at.length = 0; break; } used.add(j); at.push(j); }
    if (at.length !== p.keys.length) continue;
    const span = Math.max(...at) - Math.min(...at);
    if (span > 12 * 2) continue;   // tokens include punctuation: about 12 words
    hits.push({ phrase: p, at: at.sort((a, b) => a - b) });
  }
  hits.sort((a, b) => b.at.length - a.at.length);
  const taken = new Set();
  return hits.filter(h => { if (h.at.some(j => taken.has(j))) return false; h.at.forEach(j => taken.add(j)); return true; });
}

/* ---------- saving ---------- */

/**
 * The card id of a saved item: the word list's W: id for a listed word or phrase (the same card everywhere), RW:<slug>
 * for a word off the list, RP:h<hash> for a phrase he marked (domain/itemids.js phraseKey: the id holds no words of
 * the text; the phrase itself stays in device-only read.ctx, features/shared/read-data.js).
 * @param {{kind: 'word' | 'phrase', lemma: string, entry: Word | null}} o
 */
export function itemFor({ kind, lemma, entry }) {
  if (entry && entry.id) return `W:${entry.id}`;
  return kind === 'phrase' ? `RP:${phraseKey(lemma)}` : `RW:${slug(lemma)}`;
}

/**
 * One card per item: the deck (other than the reading deck) that already has a reviewed card for the same item, or
 * null. The item is what knowledge.js resolves the card to (a W: word, BW:<slug> for a word off the list, as an exam
 * word's card), so an exam word, a cluster word or a script word he saves while reading keeps its own card.
 * @param {string} cardId @param {string} lemma
 * @param {Record<string, Record<string, any>>} decks  deck → its cards (the course's decks, not the reading deck)
 * @param {(id: string, deck?: string) => string | null} resolve  knowledge.js resolver
 * @param {(deck: string) => string} [kindOf]  the deck's kind for the resolver ('fr:core' → 'core')
 * @returns {string | null}
 */
export function homeOf(cardId, lemma, decks, resolve, kindOf = d => d) {
  const items = new Set([resolve(cardId, 'read'), cardId, `BW:${slug(lemma)}`, resolve(`BW:${slug(lemma)}`, 'b1')].filter(Boolean));
  for (const [deck, cards] of Object.entries(decks)) {
    if (cards[cardId] && cards[cardId].reps) return deck;
    for (const [id, rec] of Object.entries(cards || {})) {
      if (!rec || !rec.reps) continue;
      const it = resolve(id, kindOf(deck));
      if (it && items.has(it)) return deck;
    }
  }
  return null;
}

/**
 * Reviewed or kept for reference: a saved word is reviewed when it is common (zipf 3 or more) or at most one level
 * above his; a rarer word above that is kept for reference (visible, never scheduled), so a rare word in a novel does
 * not cost reviews for years. A phrase he marked, and a word the list does not know, are reviewed.
 * @param {{zipf: number | null, level: string | null, kind: 'word' | 'phrase'}} w @param {string} mine his level
 */
export function triage(w, mine) {
  if (w.kind === 'phrase' || !w.level) return 'review';
  if ((w.zipf ?? 0) >= 3) return 'review';
  return levelRank(w.level) <= levelRank(mine) + 1 ? 'review' : 'ref';
}

/* ---------- questions ---------- */

/** Normalised text for the evidence check: lower case, one space, typographic quotes and dashes plain. @param {string} s */
export const norm = s => String(s || '').toLowerCase().replace(/[„“”«»"]/g, '"').replace(/[‚‘’]/g, "'").replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();

/**
 * @typedef {object} Question
 * @property {string} id
 * @property {'mc' | 'tf'} type
 * @property {'global' | 'detail' | 'inference' | 'attitude'} skill
 * @property {string} q
 * @property {string[]} options
 * @property {number} answer
 * @property {string} evidence  a quote from the text, verbatim
 */

/** The JSON schema the questions call asks for (services/claude.js ask({format})). */
export const QUESTIONS_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['questions'],
  properties: { questions: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['type', 'skill', 'q', 'options', 'answer', 'evidence'],
    properties: { type: { type: 'string', enum: ['mc', 'tf'] }, skill: { type: 'string', enum: ['global', 'detail', 'inference', 'attitude'] }, q: { type: 'string' },
      options: { type: 'array', items: { type: 'string' } }, answer: { type: 'integer' }, evidence: { type: 'string' } } } } },
};

/**
 * Claude's questions, checked: the reply parses; each answer is in range; options are distinct; the evidence is in
 * the text word for word; the question is in the text's language (inLang). Items that fail are dropped.
 * @param {string} reply @param {string} text the whole text @param {(s: string) => boolean} [inLang]
 * @returns {Question[]}
 */
export function checkQuestions(reply, text, inLang = () => true) {
  /** @type {any} */ let j = null;
  const m = String(reply || '').match(/\{[\s\S]*\}/);
  try { j = JSON.parse(m ? m[0] : String(reply || '')); } catch { return []; }
  const list = Array.isArray(j) ? j : Array.isArray(j?.questions) ? j.questions : [];
  const hay = norm(text);
  /** @type {Question[]} */ const out = [];
  for (const x of list) {
    if (!x || typeof x.q !== 'string' || !Array.isArray(x.options) || typeof x.evidence !== 'string') continue;
    const type = x.type === 'tf' ? 'tf' : 'mc';
    const options = x.options.map((/** @type {any} */ o) => String(o ?? '').replace(/\s+/g, ' ').trim().slice(0, 200));
    const q = x.q.replace(/\s+/g, ' ').trim().slice(0, 300);
    const ev = x.evidence.replace(/\s+/g, ' ').trim();
    if (!q || options.length < 2 || options.length > 5 || options.some((/** @type {string} */ o) => !o)) continue;
    if (new Set(options.map(norm)).size !== options.length) continue;
    if (!Number.isInteger(x.answer) || x.answer < 0 || x.answer >= options.length) continue;
    if (ev.length < 8 || !hay.includes(norm(ev))) continue;
    if (!inLang(q)) continue;
    if ([q, ...options, ev].some(s => /[<>{}]/.test(s))) continue;
    out.push({ id: `q${out.length + 1}`, type, skill: ['global', 'detail', 'inference', 'attitude'].includes(x.skill) ? x.skill : 'detail', q, options, answer: x.answer, evidence: ev });
  }
  return out.slice(0, 6);
}

/** Questions are kept when at least this many pass the checks. */
export const MIN_QUESTIONS = 3;

/** The sentence that holds a quote, or null. @param {{id: string, de: string}[]} sentences @param {string} quote */
export function sentenceOfQuote(sentences, quote) {
  const q = norm(quote);
  return sentences.find(s => norm(s.de).includes(q)) || sentences.find(s => q.includes(norm(s.de))) || null;
}

/* ---------- the round ---------- */

/**
 * The prompt of a saved word in the review round: his sentence with the word gapped (when one is kept and the word
 * is in it), else the meaning alone. From the second review on, every other time the meaning alone.
 * @param {{surface: string, de: string} | null} ctx @param {number} reps
 * @returns {{gapped: string, at: number, len: number} | null}
 */
export function gapIn(ctx, reps) {
  if (!ctx || !ctx.de || !ctx.surface || ctx.surface.includes('…')) return null;   // a separable verb: the meaning alone
  if (reps >= 2 && reps % 2 === 0) return null;
  const surfaces = ctx.surface.split(/\s*…\s*|\s+/).filter(Boolean);
  const first = surfaces[0];
  const re = new RegExp(`(^|[^\\p{L}\\p{N}])(${first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?=$|[^\\p{L}\\p{N}])`, 'u');
  const m = re.exec(ctx.de);
  if (!m) return null;
  const at = m.index + m[1].length;
  return { gapped: `${ctx.de.slice(0, at)}___${ctx.de.slice(at + first.length)}`, at, len: first.length };
}

/** Split sentences for a check (re-exported so tests need one import). */
export { splitSentences };
