/* Script mode: the dictionary form of a word in his script, guessed locally from the German word list
   (content igloo.words.de: w, art, pl, pos, forms, en, level). Pure; tested in node.

   Order: the word list (lemma, plural, verb forms, alternatives) → regular endings (nouns, adjectives, verbs,
   participles, comparatives with the umlaut taken back) → a separable prefix in front of a listed verb
   ("angestoßen" → anstoßen, "überträgt" → übertragen) → a compound whose last part is a listed noun
   ("Scheibenbremsen" → Scheibenbremse). Anything else keeps its own spelling and is marked as a guess. The word sheet
   lets him change the lemma, because a local guess can be wrong. */

/**
 * @typedef {object} Word
 * @property {string} id @property {string} w @property {string} [art] @property {string | null} [pl] @property {string} pos
 * @property {string[]} [en] @property {string} level @property {string} [forms] @property {string[]} [alt] @property {number} [zipf]
 */
/**
 * @typedef {object} Lemma
 * @property {string} lemma           dictionary form ('Schnittstelle', 'anstoßen')
 * @property {Word | null} entry      the word-list entry when the lemma is listed
 * @property {'list' | 'form' | 'rule' | 'prefix' | 'compound' | 'guess'} how
 * @property {Word | null} [part]     for a compound: its listed last part
 * @property {boolean} [guess]       a local guess he should confirm before a card is made (unknown word, an
 *                                   adjective ending stripped, or a listed word that is also a verb form)
 */

const PREFIXES = ['zusammen', 'zurück', 'weiter', 'wieder', 'durch', 'heraus', 'herein', 'herum', 'hinaus', 'vorbei', 'entgegen', 'fest', 'fort', 'nach',
  'über', 'unter', 'ab', 'an', 'auf', 'aus', 'bei', 'ein', 'her', 'hin', 'los', 'mit', 'vor', 'weg', 'zu', 'um', 'be', 'ge', 'er', 'ver', 'zer', 'ent', 'emp', 'miss'];
const UNUMLAUT = (/** @type {string} */ s) => s.replace(/ä(?=[^äöü]*$)/, 'a').replace(/ö(?=[^äöü]*$)/, 'o').replace(/ü(?=[^äöü]*$)/, 'u');

/**
 * Index the word list by every written form it lists.
 * @param {Word[]} words
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

/** @typedef {ReturnType<typeof buildIndex>} Index */

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

/** "die Schnittstelle, -n" style head for a word sheet. @param {Word | null} e @param {string} lemma */
export function headOf(e, lemma) {
  if (!e) return lemma;
  if (e.pos === 'noun' && e.art) return `${e.art} ${lemma}${e.pl && e.pl !== lemma ? `, ${e.pl}` : ''}`;
  return lemma;
}

/** The meaning from the list, or null. @param {Word | null} e */
export const glossOf = e => (e && e.en && e.en.length ? e.en.slice(0, 3).join(', ') : null);
