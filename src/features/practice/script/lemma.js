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

/**
 * The lemma of one token.
 * @param {string} surface the word as written
 * @param {Index} idx
 * @param {{start?: boolean}} [o] start: the token starts its sentence (its capital says nothing about nounhood)
 * @returns {Lemma}
 */
export function lemmaOf(surface, idx, { start = false } = {}) {
  const word = String(surface).replace(/^[^\p{L}\d]+|[^\p{L}\d]+$/gu, '');
  const low = word.toLowerCase();
  const cap = /^\p{Lu}/u.test(word);
  const noun = cap && !start;
  const own = (/** @type {Word} */ e) => e.w.replace(/^(der|die|das)\s+/i, '').trim();
  // 1. a listed lemma, then a listed form
  // a capital mid-sentence means a noun: a verb or adjective entry does not fit it ("zu den Bremsen")
  const fits = (/** @type {Word | null} */ x) => !!x && (!noun || x.pos === 'noun');
  let e = pick(idx.lemmas.get(low) || [], noun);
  if (fits(e)) return { lemma: own(/** @type {Word} */ (e)), entry: e, how: 'list' };
  e = pick(idx.forms.get(low) || [], noun);
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
  return { lemma: noun ? word : low, entry: null, how: 'guess' };
}

/** "die Schnittstelle, -n" style head for a word sheet. @param {Word | null} e @param {string} lemma */
export function headOf(e, lemma) {
  if (!e) return lemma;
  if (e.pos === 'noun' && e.art) return `${e.art} ${lemma}${e.pl && e.pl !== lemma ? `, ${e.pl}` : ''}`;
  return lemma;
}

/** The meaning from the list, or null. @param {Word | null} e */
export const glossOf = e => (e && e.en && e.en.length ? e.en.slice(0, 3).join(', ') : null);
