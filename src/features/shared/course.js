/* Practice for a course in another language than German (round 3, C3b; French first): its review round's items and
   where they live. Pure: content in, items out; tested in node (tests/unit/course-fr.test.mjs).

   German keeps everything it had: deck 'b1', the session kv 'b1.session', the B1 trainer's pool (pool.js). A course in
   another language reads its own files and writes its own deck and session, so the two schedules never touch:
     deck      '<lang>:core'   one FSRS record per item, card ids plain ('K:ENG_CHUNK_0001', 'W:maison.noun'); the deck
                               scopes them (domain/decks.js), so a French K: card never meets the German one
     session   '<lang>.session' the same shape as 'b1.session' (round, rounds, day, days, variants)
     stats     'deck.stats'[deck] {day, open, next}: what the allowance (domain/allowance.js) and Today read without
                               loading content
   The items:
     phrase cards (content course.<lang>, course@1): an English sentence with its phrase highlighted, typed in the
       language, graded on the phrase through the language's pack (anywhere in the answer), the rest of the sentence
       against the model sentence, as the German bank phrases are
     word cards (content igloo.words.<lang>, lexicon@1): the English meaning, typed as the dictionary form (a noun with
       its article: the definite or the indefinite one of the right gender; l'école and une école), then the word
       panel: gender, the verb's forms with its auxiliary, the agreement note, one example
   New items come in level order, two phrases to a word. */

/** The languages whose round is the German B1 trainer's. */
const TRAINER = new Set(['de']);

/**
 * Where a course's round lives. German (and no course yet) is the B1 trainer's deck and session, as always.
 * @param {string | null | undefined} lang the course's language code ('fr'), from settings
 * @returns {{lang: string, deck: string, kv: string, trainer: boolean}}
 */
export function courseRound(lang) {
  const l = lang || 'de';
  return TRAINER.has(l) ? { lang: 'de', deck: 'b1', kv: 'b1.session', trainer: true } : { lang: l, deck: `${l}:core`, kv: `${l}.session`, trainer: false };
}

/** Task lines of a word card, per word type (i18n keys). */
const TASK = /** @type {Record<string, string>} */ ({ noun: 'course.task.noun', verb: 'course.task.verb', adjective: 'course.task.adjective' });

/**
 * A word-list entry → a round item that asks for the word (null when the pack has no forms for it).
 * @param {any} w a lexicon@1 entry @param {any} F the pack's forms model @param {any} ix F.formsIndex(words)
 * @param {(k: string, v?: any) => string} t @param {string} lang
 */
export function wordItem(w, F, ix, t, lang) {
  const id = `W:${w.id}`;
  const f = F.formsOf(ix, { lemma: w.w, pos: w.pos, id });
  if (!f) return null;
  const type = f.type || 'word';
  const at = w.ex ? F.findForm(w.ex, [w.w, ...f.surface]) : null;
  const card = { type, head: f.head, forms: f.line, pres: null, plural: f.plural, pluralNote: null, level: w.level || null, zipf: Number.isFinite(w.zipf) ? w.zipf : null,
    ex: w.ex || null, exAt: at ? [at.start, at.end] : null, exSrc: null, exEn: w.exen || null, conf: typeof F.formNote === 'function' ? F.formNote(w) : null };
  return { id, kind: 'word', area: 'words', group: w.theme || 'words', teil: null, fn: null, star: false, trap: null, focus: ['word'], strict: [], plan: 'recall',
    task: t(TASK[type] || 'course.task.word'), prompt: (w.en || []).join(', '), promptLang: 'en', hl: null, partner: null, prefill: null, gap: false, showGap: false,
    accept: f.accept, anywhere: false, literal: true, loose: false, model: f.head, wrong: [], rule: '', src: 'course', level: w.level || 'B1', gloss: null,
    zipf: card.zipf, card, origin: 'practice', newTier: 7, course: lang,
    // ordered with the phrases (compose.js newOrder puts bank items after others of a tier): the pool's order interleaves them
    bank: true };
}

/**
 * A course@1 phrase → a phrase card: the English sentence with its phrase highlighted.
 * @param {string} cid @param {any} p @param {string} lang
 */
export function phraseItem(cid, p, lang) {
  return { id: `K:${cid}`, kind: 'phrase', area: 'speaking', group: p.cat || 'phrases', teil: null, fn: p.fn || null, star: false, trap: null, focus: ['chunk'], strict: [],
    plan: 'recall', task: null, prompt: p.en, promptLang: 'en', hl: p.hl, partner: null, prefill: null, accept: p.accept, anywhere: true, model: p.ex, wrong: [],
    rule: p.n || '', src: 'bank', level: p.level || 'B1', bank: true, sentence: p.ex, origin: 'practice', newTier: 7, course: lang };
}

/**
 * The words of a language's content (folded keys of the pack's tokenizer): the grader's lexicon, so a typed word
 * that is a word of the language is that word, never a typo or a slip of another (parle for parlé).
 * @param {(s: string) => any[]} tokenize @param {string[]} texts
 */
export function lexiconOf(tokenize, texts) {
  /** @type {Set<string>} */ const L = new Set();
  for (const s of texts) if (s) for (const w of tokenize(String(s).replace(/\[[^\]]*\]|[()]/g, ' '))) if (w.len > 1) L.add(w.n);
  return L;
}

/**
 * The pool of a course: phrase cards and word cards in the order they are introduced (level, then two phrases to a
 * word), and what the round, the composer and the grader read beside it (the same shape as pool.js buildPool).
 * @param {{course: any, words: any[] | null, pack: any, t: (k: string, v?: any) => string, lang: string, texts?: string[]}} o
 */
export function buildCoursePool({ course, words, pack, t, lang, texts = [] }) {
  const LV = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
  const lv = (/** @type {string} */ l) => { const i = LV.indexOf(l); return i < 0 ? 2 : i; };
  const phrases = Object.entries((course && course.phrases) || {}).filter(([, p]) => p && !p.weak).map(([cid, p]) => phraseItem(cid, p, lang));
  const F = pack.grammar.forms;
  const list = Array.isArray(words) ? words : [];
  const ix = F.formsIndex(list, null);
  const wordsI = list.map(w => wordItem(w, F, ix, t, lang)).filter(Boolean);
  /** @type {any[]} */ const pool = [];
  for (const level of LV) {
    const ph = phrases.filter(p => lv(p.level) === LV.indexOf(level)), wd = wordsI.filter(w => lv(/** @type {any} */ (w).level) === LV.indexOf(level));
    while (ph.length || wd.length) { for (let k = 0; k < 2 && ph.length; k++) pool.push(ph.shift()); if (wd.length) pool.push(wd.shift()); }
  }
  const byId = new Map(pool.map(it => [it.id, it]));
  const lexicon = lexiconOf(s => pack.text.tokenize(pack.text.normalize(s)), [
    ...phrases.flatMap(p => [p.model, ...p.accept]), ...list.flatMap(w => [w.w, w.pl, w.ex, w.forms, w.fem]), ...texts]);
  return { pool, byId, plan: { topics: [], traps: [], functions: [] }, topics: new Map(), traps: new Map(), fnInfo: new Map(), nouns: {}, writing: null, verbs: null, lexicon,
    wordmap: {}, course: lang };
}

