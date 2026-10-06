/* German lemmas: the dictionary form of a word, guessed locally from the German word list (content igloo.words.de:
   w, art, pl, pos, forms, en, level). Pure; tested in node. Moved unchanged from features/practice-script/lemma.js
   (round 4, L2a): Scripts reads lemmaOf() through the pack (grammar.morphology.lookup) exactly as before, and the
   reader and conversation get lemma() (grammar.morphology.lemma), which adds the sentence around the word.

   lemmaOf(surface, idx, {start, prev}), one word:
   the word list (lemma, plural, verb forms, alternatives) → regular endings (nouns, adjectives, verbs, participles,
   comparatives with the umlaut taken back) → a separable prefix in front of a listed verb ("angestoßen" → anstoßen,
   "überträgt" → übertragen) → a compound whose last part is a listed noun ("Scheibenbremsen" → Scheibenbremse).
   Anything else keeps its own spelling and is marked as a guess. The word sheet lets him change the lemma, because a
   local guess can be wrong.

   lemma(token, sentence, i, idx), one word in its sentence, candidates best first:
   a separable particle at the end of its clause joins the clause's verb ("Ich rufe dich morgen an": rufe and an →
   anrufen; not after sein, werden or a modal, and not in a clause that opens with a subordinator), a zu-infinitive
   loses its zu (anzurufen → anrufen), a compound offers its last part second, and a few Konjunktiv II forms and
   adjective stems that lemmaOf does not reach (bräuchte, dunkle, teure) are mapped. Everything else is lemmaOf. */
// @ts-check

/** @typedef {import('../types.js').WordEntry} Word */
/** @typedef {import('../types.js').LemmaInfo} Lemma */
/** @typedef {import('../types.js').TextToken} TextToken */

const PREFIXES = ['zusammen', 'zurück', 'weiter', 'wieder', 'durch', 'heraus', 'herein', 'herum', 'hinaus', 'vorbei', 'entgegen', 'fest', 'fort', 'nach',
  'über', 'unter', 'ab', 'an', 'auf', 'aus', 'bei', 'ein', 'her', 'hin', 'los', 'mit', 'vor', 'weg', 'zu', 'um', 'be', 'ge', 'er', 'ver', 'zer', 'ent', 'emp', 'miss'];
const UNUMLAUT = (/** @type {string} */ s) => s.replace(/ä(?=[^äöü]*$)/, 'a').replace(/ö(?=[^äöü]*$)/, 'o').replace(/ü(?=[^äöü]*$)/, 'u');

/**
 * Index the word list by every written form it lists.
 * @param {Word[]} words
 * @returns {Index}
 */
export function buildIndex(words) {
  /** @type {Map<string, Word[]>} */ const forms = new Map();
  /** @type {Map<string, Word[]>} */ const lemmas = new Map();
  const put = (/** @type {Map<string, Word[]>} */ m, /** @type {string} */ k, /** @type {Word} */ e) => {
    if (!k) return;
    const key = k.toLowerCase();
    const list = m.get(key);
    if (!list) m.set(key, [e]); else if (!list.includes(e)) list.push(e);
  };
  for (const e of words || []) {
    if (!e || !e.w || e.pos === 'phrase') continue;
    const w = e.w.replace(/^(der|die|das)\s+/i, '').replace(/[!?.]+$/, '').trim();
    put(lemmas, w, e); put(forms, w, e);
    if (e.pl) put(forms, String(e.pl).replace(/^(die)\s+/i, ''), e);
    for (const seg of String(e.forms || '').split(/[·,;/]/)) {
      const ws = seg.trim().split(/\s+/).filter(Boolean);
      if (ws.length) put(forms, ws[ws.length - 1], e);
      if (ws.length === 1) put(forms, ws[0], e);
    }
  }
  return { forms, lemmas, words };
}

/** @typedef {import('../types.js').WordIndex} Index */

/** Pick the entry that fits the token: a capitalised token mid-sentence is a noun. @param {Word[]} list @param {boolean} noun */
function pick(list, noun) {
  if (!list || !list.length) return null;
  return list.find(e => (e.pos === 'noun') === noun) || list[0];
}

/** Candidate lemmas by regular endings, most likely first. @param {string} low */
function candidates(low) {
  /** @type {string[]} */ const out = [];
  const add = (/** @type {string} */ s) => { if (s && s.length >= 2 && !out.includes(s)) out.push(s); };
  // participles: ge…t, ge…en
  let m = /^ge(.+?)(et|t)$/.exec(low); if (m) { add(`${m[1]}en`); add(`${m[1]}n`); }
  m = /^ge(.+)en$/.exec(low); if (m) add(`${m[1]}en`);
  // verbs: present and simple past endings
  for (const [suf, rep] of [['test', 'en'], ['tet', 'en'], ['ten', 'en'], ['te', 'en'], ['est', 'en'], ['et', 'en'], ['st', 'en'], ['t', 'en'], ['e', 'en'], ['en', 'en'], ['t', 'n'], ['e', 'n']]) {
    if (low.endsWith(suf) && low.length > suf.length + 1) add(low.slice(0, -suf.length) + rep);
  }
  // adjectives and nouns: inflection endings
  for (const suf of ['sten', 'ster', 'stes', 'stem', 'ste', 'eren', 'erer', 'eres', 'erem', 'ere', 'er', 'en', 'em', 'es', 'e', 'n', 's']) {
    if (low.endsWith(suf) && low.length > suf.length + 2) { const base = low.slice(0, -suf.length); add(base); if (/^(st|er|ere|eren|erer|eres|erem|sten|ster|stes|stem|ste)$/.test(suf)) add(UNUMLAUT(base)); }
  }
  add(UNUMLAUT(low));
  return out;
}

/* Closed classes, checked before the word list and the ending rules (German review round 2): the possessives with
   their endings ("seine" is never sein, to be), the forms of sein, haben and werden, and the common Konjunktiv II
   forms, which the ending rules cannot reach (gäbe, wäre, hätte, könnte, würde …). */
const POSS = /** @type {Record<string, [string, string]>} */ ({ mein: ['mein', 'my'], dein: ['dein', 'your (informal)'], sein: ['sein', 'his, its'], ihr: ['ihr', 'her, their; your (formal: Ihr)'],
  unser: ['unser', 'our'], euer: ['euer', 'your (informal, plural)'], eur: ['euer', 'your (informal, plural)'] });
const IRREG = /** @type {Record<string, string>} */ ({});
for (const [verb, forms] of /** @type {[string, string][]} */ ([
  ['sein', 'bin bist ist sind seid war warst waren wart gewesen wäre wärst wären wärt sei seist seien'],
  ['haben', 'habe hast hat habt hatte hattest hatten hattet gehabt hätte hättest hätten hättet'],
  ['werden', 'werde wirst wird werdet wurde wurdest wurden wurdet geworden worden würde würdest würden würdet'],
  ['geben', 'gäbe gäbest gäben'], ['kommen', 'käme kämest kämen'], ['gehen', 'ginge gingen'], ['wissen', 'wüsste wüsstest wüssten'],
  ['können', 'könnte könntest könnten könntet'], ['müssen', 'müsste müsstest müssten müsstet'], ['dürfen', 'dürfte dürftest dürften dürftet'],
  ['sollen', 'sollte solltest sollten solltet'], ['wollen', 'wollte wolltest wollten wolltet'], ['tun', 'täte täten'], ['bleiben', 'bliebe blieben'],
  ['lassen', 'ließe ließen'], ['halten', 'hielte hielten'], ['finden', 'fände fänden'], ['stehen', 'stünde stünden stände'], ['liegen', 'läge lägen'],
  ['sehen', 'sähe sähen'], ['nehmen', 'nähme nähmen'], ['bringen', 'brächte brächten'], ['denken', 'dächte dächten'],
])) for (const f of forms.split(' ')) IRREG[f] = verb;
// a lower-case word after one of these is a verb when the word list also has it as a verb form ("ich weiß")
const SUBJ = new Set(['ich', 'du', 'er', 'sie', 'es', 'man', 'wir', 'ihr', 'wer', 'jemand', 'niemand']);
// an adjective ending on an adjective-looking stem that is not listed: strip it, as a guess ("winzige", "Erstaunliches")
const ADJ = /^(.{3,}(?:ig|lich|isch|bar|sam|haft|los|voll|ell|al|iv|ent|ant|end))(e|en|er|es|em)$/;

/**
 * The lemma of one token.
 * @param {string} surface the word as written
 * @param {Index} idx
 * @param {{start?: boolean, prev?: string}} [o] start: the token starts its sentence (its capital says nothing about
 *   nounhood); prev: the word before it, lower case
 * @returns {Lemma}
 */
export function lemmaOf(surface, idx, { start = false, prev = '' } = {}) {
  const word = String(surface).replace(/^[^\p{L}\d]+|[^\p{L}\d]+$/gu, '');
  const low = word.toLowerCase();
  const cap = /^\p{Lu}/u.test(word);
  const noun = cap && !start;
  const own = (/** @type {Word} */ e) => e.w.replace(/^(der|die|das)\s+/i, '').trim();
  const verbOf = (/** @type {string} */ v) => (idx.lemmas.get(v) || []).find(x => x.pos === 'verb') || null;
  // 0. closed classes
  if (!noun || start) {
    if (IRREG[low]) { const e0 = verbOf(IRREG[low]); return { lemma: e0 ? own(e0) : IRREG[low], entry: e0, how: 'form' }; }
    const pm = /^(mein|dein|sein|ihr|unser|euer|eur)(e|en|em|er|es)?$/.exec(low);
    const asVerbForm = pm && SUBJ.has(prev) && !!verbOf(low.replace(/e$/, 'en'));   // "ich meine": meinen
    if (pm && !asVerbForm && !(pm[1] === 'sein' && !pm[2]) && !(pm[1] === 'ihr' && !pm[2])) {
      const [lemma, en] = POSS[pm[1]];
      const listed = (idx.lemmas.get(lemma) || []).find(x => x.pos === 'det') || null;
      return { lemma, entry: listed || { id: '', w: lemma, pos: 'det', en: [en], level: 'A1' }, how: 'list' };
    }
  }
  // 1. a listed lemma, then a listed form
  // a capital mid-sentence means a noun: a verb or adjective entry does not fit it ("zu den Bremsen"); a lower-case
  // word mid-sentence is never a noun ("würde" is not die Würde)
  const fits = (/** @type {Word | null} */ x) => !!x && (noun ? x.pos === 'noun' : (x.pos !== 'noun' || start));
  let e = pick(idx.lemmas.get(low) || [], noun);
  if (fits(e)) {
    // a listed lemma that is also a form of a listed verb ("weiß": white, or ich weiß): after a subject, the verb
    const asVerb = !noun ? (idx.forms.get(low) || []).find(x => x.pos === 'verb' && x !== e) : null;
    if (asVerb && /** @type {Word} */ (e).pos !== 'verb') {
      if (SUBJ.has(prev)) return { lemma: own(asVerb), entry: asVerb, how: 'form' };
      return { lemma: own(/** @type {Word} */ (e)), entry: e, how: 'list', guess: true };
    }
    return { lemma: own(/** @type {Word} */ (e)), entry: e, how: 'list' };
  }
  e = pick((idx.forms.get(low) || []).filter(x => fits(x)), noun);
  if (fits(e)) return { lemma: own(/** @type {Word} */ (e)), entry: e, how: 'form' };
  // 2. regular endings
  for (const c of candidates(low)) {
    const hit = pick(idx.lemmas.get(c) || [], noun) || pick(idx.forms.get(c) || [], noun);
    if (hit && (noun ? hit.pos === 'noun' : (hit.pos !== 'noun' || start))) return { lemma: own(hit), entry: hit, how: 'rule' };
  }
  // 3. a separable or inseparable prefix in front of a listed verb
  if (!noun) {
    for (const p of PREFIXES) {
      if (!low.startsWith(p) || low.length - p.length < 3) continue;
      const rest = low.slice(p.length);
      for (const c of [rest, ...candidates(rest), rest.replace(/^ge/, '')]) {
        const hit = (idx.lemmas.get(c) || idx.forms.get(c) || []).find(x => x.pos === 'verb');
        if (hit) {
          const lemma = p + own(hit);
          const listed = (idx.lemmas.get(lemma) || []).find(x => x.pos === 'verb') || null;
          return { lemma: listed ? own(listed) : lemma, entry: listed, how: listed ? 'rule' : 'prefix' };
        }
      }
    }
  }
  // 4. a compound noun ending in a listed noun
  if (cap && low.length >= 7) {
    for (let i = 2; i <= low.length - 4; i++) {
      const tail = low.slice(i);
      const hit = (idx.lemmas.get(tail) || idx.forms.get(tail) || []).find(x => x.pos === 'noun')
        || candidates(tail).map(c => (idx.lemmas.get(c) || idx.forms.get(c) || []).find(x => x.pos === 'noun')).find(Boolean);
      if (hit) {
        const head = word.slice(0, i);
        const lemma = head + own(hit).toLowerCase();
        return { lemma: lemma.charAt(0).toUpperCase() + lemma.slice(1), entry: null, how: 'compound', part: hit };
      }
    }
  }
  // 5. an adjective ending on an adjective-looking stem (also a capitalised one after etwas, viel, nichts)
  const am = ADJ.exec(low);
  if (am && (!noun || /^(etwas|viel|nichts|wenig|alles)$/.test(prev) || /(lich|ig|isch)(es|e|en)$/.test(low))) return { lemma: am[1], entry: null, how: 'guess', guess: true };
  return { lemma: noun ? word : low, entry: null, how: 'guess', guess: true };
}


/* ------------------------------------------------------------------ */
/* lemma(): one word in its sentence (the pack's morphology.lemma)      */
/* ------------------------------------------------------------------ */

// particles that stand at the end of a main clause when the verb is finite ("Ich rufe dich an")
const SEP = new Set(['ab', 'an', 'auf', 'aus', 'bei', 'dar', 'ein', 'fern', 'fest', 'fort', 'frei', 'her', 'heraus', 'herein', 'herum', 'herunter',
  'hin', 'hinaus', 'hinein', 'hoch', 'kennen', 'los', 'mit', 'nach', 'nieder', 'statt', 'teil', 'vor', 'voran', 'vorbei', 'weg', 'weiter', 'zu',
  'zurecht', 'zurück', 'zusammen']);
// particles that are also inseparable prefixes or plain adverbs: joined only when the word list has the verb
const DUAL = new Set(['durch', 'über', 'um', 'unter', 'wider', 'wieder', 'hinter', 'voll']);
// a particle never joins these verbs ("Was ist los?", "Ich muss los")
const NO_JOIN = new Set(['sein', 'werden', 'können', 'müssen', 'dürfen', 'sollen', 'wollen', 'mögen', 'möchten']);
// words that open a clause with the verb at its end: a particle there is a preposition. SUBORD always; AFTER_COMMA
// only after a comma (a question word, a relative pronoun, or a word that is also a preposition: "Wo kommst du her?",
// "Der Zug kommt an", "Während des Films schläft er ein")
const SUBORD = new Set(['dass', 'weil', 'ob', 'wenn', 'obwohl', 'damit', 'sobald', 'bevor', 'nachdem', 'falls', 'seitdem', 'als', 'indem', 'sodass']);
const AFTER_COMMA = new Set(['während', 'seit', 'bis', 'wie', 'wo', 'wohin', 'woher', 'warum', 'wer', 'was', 'der', 'die', 'das', 'dem', 'den',
  'deren', 'dessen', 'denen', 'welche', 'welcher', 'welches', 'welchem', 'welchen']);
// coordinators: a clause boundary, unless the part after it has no verb of its own ("Er ruft Anna und Paul an")
const COORD = new Set(['und', 'oder', 'aber', 'sondern', 'denn', 'sowie']);
// Konjunktiv II forms whose stem is not the simple past with an umlaut, or that lemmaOf does not reach
const KII = /** @type {Record<string, string[]>} */ ({ möchte: ['möchten', 'mögen'], möchtest: ['möchten', 'mögen'], möchten: ['möchten', 'mögen'], möchtet: ['möchten', 'mögen'] });
for (const [verb, forms] of /** @type {[string, string][]} */ ([['sterben', 'stürbe stürben'], ['helfen', 'hülfe hülfen'], ['werfen', 'würfe würfen'],
  ['beginnen', 'begönne begönnen'], ['gewinnen', 'gewönne gewönnen']])) for (const f of forms.split(' ')) KII[f] = [verb];
// a Konjunktiv II from the simple past with an umlaut (zöge: zog, läse: las); führe stays führen
const KII_NOT = new Set(['führ']);
// adjectives whose stem changes: comparatives, superlatives and hoch
const ADJ_IRREG = /** @type {[RegExp, string][]} */ ([[/^(hoh|höher|höchst)(e|en|er|es|em)?$/, 'hoch'], [/^(besser|best)(e|en|er|es|em)$/, 'gut'],
  [/^besten$/, 'gut'], [/^meist(e|en|er|es|em)$/, 'viel'], [/^größ(er|t)(e|en|er|es|em)?$/, 'groß'], [/^näher(e|en|er|es|em)?$/, 'nah']]);

/** @param {TextToken | import('../types.js').Token | string} tok */
const textOf = tok => (typeof tok === 'string' ? tok : 'raw' in tok ? tok.raw : tok.t);
/** @param {TextToken | import('../types.js').Token | string} tok a word (a lang Token is always one) */
const isWord = tok => typeof tok === 'string' || !('w' in tok) || tok.w !== false;
/** A non-word token that ends a clause (a comma, a full stop, a dash, a quote). @param {string} t */
const isStop = t => /[,;:.!?…–—()[\]"„“”«»]/.test(t);
/** @param {string} s */
const clean = s => String(s).replace(/^[^\p{L}\d]+|[^\p{L}\d]+$/gu, '');

/**
 * Infinitives a present-tense form with a changed stem may come from, most likely first: fängt → fangen, gibst → geben,
 * liest → lesen, tritt → treten.
 * @param {string} low @returns {string[]}
 */
function stemChanges(low) {
  /** @type {string[]} */ const out = [];
  const m = /^(\p{L}{2,}?)(st|t)$/u.exec(low);
  const stems = m ? [m[1], low] : [low];
  for (const st of stems) {
    out.push(`${UNUMLAUT(st)}en`);
    if (/ie[^aeiouäöü]+$/.test(st)) out.push(`${st.replace(/ie([^aeiouäöü]+)$/, 'e$1')}en`);
    if (/i[^aeiouäöüe]+$/.test(st)) out.push(`${st.replace(/i([^aeiouäöü]+)$/, 'e$1')}en`);
    if (/tt$/.test(st)) out.push(`${st.slice(0, -1)}en`, `${st.slice(0, -2).replace(/i$/, 'e')}ten`);
  }
  return [...new Set(out)].filter(c => c !== low);
}

/**
 * One word against the word list, with the rules lemmaOf does not have (a zu-infinitive, an imperative, Konjunktiv II
 * from the simple past, adjective stems that change). Scripts keep lemmaOf as it is.
 * @param {string} surface @param {Index} idx @param {{start?: boolean, prev?: string, imperative?: boolean}} [o]
 * @returns {Lemma}
 */
export function analyse(surface, idx, o = {}) {
  const word = clean(surface), low = word.toLowerCase();
  const verb = (/** @type {string} */ v) => (idx.lemmas.get(v) || []).find(x => x.pos === 'verb') || null;
  const own = (/** @type {Word} */ e) => e.w.replace(/^(der|die|das)\s+/i, '').trim();
  const lower = !/^\p{Lu}/u.test(word) || !!o.start;
  // a zu-infinitive of a separable verb: anzurufen → anrufen, kennenzulernen → kennenlernen
  const zm = lower ? /^(\p{L}+?)zu(\p{L}{3,}n)$/u.exec(low) : null;
  if (zm && SEP.has(zm[1])) {
    const e = verb(zm[1] + zm[2]);
    if (e) return { lemma: own(e), entry: e, how: 'rule' };
  }
  const L = lemmaOf(surface, idx, o);
  if (!lower && L.how === 'guess' && word.length >= 7) {
    // a compound whose last part is a listed noun or a listed noun's plural (Scheibenbremsen: die Bremsen)
    for (let i = 2; i <= low.length - 4; i++) {
      const tail = low.slice(i);
      const hit = [tail, ...candidates(tail)].map(c => (idx.forms.get(c) || []).find(x => x.pos === 'noun')).find(Boolean);
      if (hit) {
        const lemma = word.slice(0, i) + own(hit).toLowerCase();
        return { lemma: lemma.charAt(0).toUpperCase() + lemma.slice(1), entry: null, how: 'compound', part: hit };
      }
    }
  }
  if (!lower || (L.how !== 'guess' && !(L.entry?.pos === 'noun' && o.imperative))) return L;
  if (KII[low]) { const e = verb(KII[low][0]); return { lemma: e ? own(e) : KII[low][0], entry: e, how: 'form' }; }
  // an imperative: hör, mach, komm (at the start of a sentence ending in "!", a capital says nothing)
  for (const c of [`${low}en`, `${low}n`, low.replace(/e$/, 'en')]) {
    const e = verb(c);
    if (e && (L.how === 'guess' || o.imperative)) return { lemma: own(e), entry: e, how: 'rule' };
  }
  if (L.how !== 'guess') return L;
  for (const c of stemChanges(low)) { const e = verb(c); if (e) return { lemma: own(e), entry: e, how: 'rule' }; }
  const kk = KII[low.replace(/(st|t)$/, '')];
  if (kk && /(st|t)$/.test(low)) { const e = verb(kk[0]); return { lemma: e ? own(e) : kk[0], entry: e, how: 'form' }; }
  const km = /^(\p{L}*[äöü]\p{L}*?)(e|est|en|et)$/u.exec(low);
  if (km && !KII_NOT.has(km[1])) {
    const past = UNUMLAUT(km[1]);
    const e = (idx.forms.get(past) || []).find(x => x.pos === 'verb' && x.w !== past);
    if (e) return { lemma: own(e), entry: e, how: 'form' };
  }
  for (const [re, adj] of ADJ_IRREG) if (re.test(low)) { const e = (idx.lemmas.get(adj) || []).find(x => x.pos === 'adj') || null; return { lemma: adj, entry: e, how: 'rule' }; }
  // an adjective stem that drops its e before an ending: dunkle → dunkel, teure → teuer
  const am = /^(\p{L}{2,}?)([lr])(e|en|er|es|em)$/u.exec(low);
  if (am) {
    const e = (idx.lemmas.get(`${am[1]}e${am[2]}`) || []).find(x => x.pos === 'adj');
    if (e) return { lemma: own(e), entry: e, how: 'rule' };
  }
  return L;
}

/**
 * The clause around word i: [from, to] token indices, and whether it opens with a subordinator. A coordinator ends a
 * clause only when the words after it have a verb of their own.
 * @param {(TextToken | import('../types.js').Token)[]} toks @param {number} i @param {(j: number) => boolean} hasVerb
 */
function clauseOf(toks, i, hasVerb) {
  /** @type {{from: number, to: number, soft: boolean}[]} */ const parts = [];
  let from = 0;
  const close = (/** @type {number} */ to, /** @type {boolean} */ soft) => { if (to >= from) parts.push({ from, to, soft }); };
  for (let j = 0; j < toks.length; j++) {
    const t = toks[j];
    if (!isWord(t)) { if (isStop(textOf(t))) { close(j - 1, false); from = j + 1; } continue; }
    if (COORD.has(textOf(t).toLowerCase()) && j > from) { close(j - 1, false); from = j; parts.push({ from: -1, to: -1, soft: true }); }
  }
  close(toks.length - 1, false);
  // merge a part after a coordinator that has no verb into the part before it
  /** @type {{from: number, to: number}[]} */ const out = [];
  for (let k = 0; k < parts.length; k++) {
    const p = parts[k];
    if (p.from < 0) continue;
    const afterCoord = k > 0 && parts[k - 1].from < 0;
    let verbIn = false;
    for (let j = p.from; j <= p.to; j++) if (hasVerb(j)) { verbIn = true; break; }
    if (afterCoord && !verbIn && out.length) out[out.length - 1].to = p.to;
    else out.push({ from: p.from, to: p.to });
  }
  return out.find(p => i >= p.from && i <= p.to) || { from: i, to: i };
}

/**
 * The pack's lemma: a word's dictionary form in its sentence, candidates best first. A separable particle at the end
 * of a main clause and the clause's verb both give the joined verb first; a compound gives its listed last part second.
 * @type {import('../types.js').LemmaFn}
 */
export function lemma(token, sentence, i, idx = EMPTY) {
  if (!token || !isWord(token) || !clean(textOf(token))) return [];
  const toks = sentence && sentence[i] === token ? sentence : [token];
  const at = toks === sentence ? i : 0;
  const words = toks.map((t, j) => (isWord(t) ? j : -1)).filter(j => j >= 0);
  const first = words[0];
  const last = toks.length ? textOf(toks[toks.length - 1]) : '';
  /** @type {Map<number, Lemma>} */ const memo = new Map();
  const an = (/** @type {number} */ j) => {
    let r = memo.get(j);
    if (!r) {
      const w = words.indexOf(j);
      r = analyse(textOf(toks[j]), idx, { start: j === first, prev: w > 0 ? clean(textOf(toks[words[w - 1]])).toLowerCase() : '', imperative: j === first && /!/.test(last) });
      memo.set(j, r);
    }
    return r;
  };
  const low = (/** @type {number} */ j) => clean(textOf(toks[j])).toLowerCase();
  const isParticle = (/** @type {number} */ j) => (SEP.has(low(j)) || DUAL.has(low(j))) && !/^\p{Lu}/u.test(clean(textOf(toks[j])));
  const isVerb = (/** @type {number} */ j) => isWord(toks[j]) && !isParticle(j) && an(j).entry?.pos === 'verb';
  const base = an(at);
  /** @type {string[]} */ const out = [base.lemma];
  if (base.how === 'compound' && base.part) {
    // the last part, when what comes before it is a word too (Apfel|baum, Geburtstag-s|kuchen; not Gangsc|haltung)
    const part = base.part.w.replace(/^(der|die|das)\s+/i, '').trim();
    const head = base.lemma.slice(0, base.lemma.length - part.length).toLowerCase();
    const listed = (/** @type {string} */ w) => w.length >= 2 && (idx.lemmas.has(w) || idx.forms.has(w));
    if ([head, head.replace(/(es|s|en|n|er|e)$/, ''), `${head}en`, `${head}e`].some(listed)) out.push(part);
  }
  const cl = clauseOf(toks, at, isVerb);
  const inClause = words.filter(j => j >= cl.from && j <= cl.to);
  // the clause's last word, before an infinitive group with zu ("Er hört auf zu rauchen")
  let end = inClause.length - 1;
  if (end >= 2 && low(inClause[end - 1]) === 'zu' && /n$/.test(low(inClause[end])) && !/^\p{Lu}/u.test(textOf(toks[inClause[end]]))) end -= 2;
  const p = end >= 1 ? inClause[end] : -1;
  const opener = inClause.length ? low(inClause[0]) : '';
  const prevTok = inClause.length && inClause[0] > 0 ? textOf(toks[inClause[0] - 1]) : '';
  const sub = SUBORD.has(opener) || (AFTER_COMMA.has(opener) && /,/.test(prevTok));
  if (p >= 0 && isParticle(p) && !sub) {
    const before = inClause.slice(0, end).filter(j => !isParticle(j) && (j === first || !/^\p{Lu}/u.test(clean(textOf(toks[j])))));
    const pairs = pairsOf(idx);
    const verbOf = (/** @type {string} */ v) => (idx.lemmas.get(v) || []).find(x => x.pos === 'verb') || null;
    /** @type {[number, string] | null} */ let hit = null;
    // the word list's own forms first ("fängt an"), then a listed verb in the clause, then any word whose verb stem
    // with the particle is a listed verb ("laden … ein")
    for (const j of before) { const e = pairs.get(`${low(j)} ${low(p)}`); if (e) { hit = [j, e.w]; break; } }
    if (!hit) {
      const v = before.find(isVerb);
      if (v != null) {
        const vl = an(v).lemma, joined = low(p) + vl, listed = verbOf(joined);
        if (!NO_JOIN.has(vl) && (listed || SEP.has(low(p)))) hit = [v, listed ? listed.w : joined];
      }
    }
    if (!hit) {
      for (const j of before) {
        if (an(j).how !== 'guess') continue;
        const c = [low(j), ...stemChanges(low(j)), ...candidates(low(j))].find(x => verbOf(low(p) + x));
        if (c) { hit = [j, /** @type {Word} */ (verbOf(low(p) + c)).w]; break; }
      }
    }
    if (hit && (at === p || at === hit[0])) out.unshift(hit[1]);
  }
  if (KII[low(at)]) for (const k of KII[low(at)]) out.push(k);
  return [...new Set(out.filter(Boolean))];
}

/** @type {WeakMap<Index, Map<string, Word>>} */ const PAIRS = new WeakMap();
/** A separable verb's two-word forms in the word list ("fängt an" → anfangen), by "<verb form> <particle>". @param {Index} idx */
function pairsOf(idx) {
  let m = PAIRS.get(idx);
  if (!m) {
    m = new Map();
    for (const e of idx.words || []) {
      if (!e || e.pos !== 'verb') continue;
      for (const seg of String(e.forms || '').split(/[·,;/]/)) {
        const ws = seg.trim().toLowerCase().split(/\s+/).filter(Boolean);
        if (ws.length === 2 && (SEP.has(ws[1]) || DUAL.has(ws[1])) && !m.has(ws.join(' '))) m.set(ws.join(' '), e);
      }
    }
    PAIRS.set(idx, m);
  }
  return m;
}

/** @type {Index} */
const EMPTY = { forms: new Map(), lemmas: new Map(), words: [] };
