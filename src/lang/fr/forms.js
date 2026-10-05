/* French word forms for a word card (the French pack's forms model; domain/forms.js hands every call to the active
   pack). The same functions as the German model (src/lang/de/forms.js), so a word card is built the same way for
   either language. Source: the French word list (content/igloo/words/fr.json, lexicon@1 with French fields):
     noun       art (le, la, l'), g (m, f; the gender the elided l' hides), pl
     verb       forms "il va · il est allé · il allait · il ira" (présent, passé composé, imparfait, futur, 3rd person),
                aux (avoir, être), pp (the participle), note (e.g. passer: avoir with an object)
     adjective  fem (the feminine), before (goes before the noun)
   What a card shows:
     noun       "la maison (f)", or for an elided article "l'école (f) · une école": the article hides the gender, so the
                card names it and gives the indefinite article; the plural "les maisons". Typing the noun with its
                definite or indefinite article of the right gender is right (la maison, une maison; l'école, une
                école); the wrong gender is wrong (un école).
     verb       "aller · il va · il est allé · il allait · il ira", and with être "With être the participle agrees: elle
                est allée, ils sont allés."
     adjective  "grand · grande", and "Goes before the noun." when it does
   The middle dots are the content's own separators; the grammar words (f, m) are French dictionary abbreviations. */
// @ts-check

const POS = /** @type {Record<string, string>} */ ({ verb: 'verb', noun: 'noun', adj: 'adjective', adv: 'adverb', prep: 'preposition', conj: 'conjunction',
  pron: 'pronoun', det: 'determiner', num: 'number', phrase: 'phrase', interj: 'interjection' });

/** The word type in English ('verb', 'noun', …) for a part-of-speech tag of the word list. @param {string | null | undefined} pos */
export const wordType = pos => POS[String(pos || '')] || null;

/** "se lever" → "lever", "s'appeler" → "appeler", "penser à" → "penser". @param {string} w */
export const verbBase = w => String(w).trim().replace(/^(se\s+|s')/, '').replace(/\s+\S+$/, '');

/**
 * @typedef {import('../de/forms.js').Forms} Forms
 */

/**
 * The lookup tables. @param {any[]} words the word list @param {any} [_forms] no extra forms file for French
 * @returns {{verbs: Map<string, {w: string, forms: string}>, nouns: Map<string, {art: string, pl: string, known: boolean}>, adj: Map<string, [string, string]>, byId: Map<string, any>, examples: Map<string, {de: string, en: string}>}}
 */
export function formsIndex(words, _forms) {
  const verbs = new Map(), nouns = new Map(), adj = new Map(), byId = new Map(), examples = new Map();
  for (const w of words || []) {
    if (!w || !w.w) continue;
    byId.set(w.id, w);
    if (w.pos === 'verb' && w.forms) { const k = verbBase(w.w); if (!verbs.has(k)) verbs.set(k, { w: w.w, forms: w.forms }); }
    if (w.pos === 'noun' && w.art && !nouns.has(w.w)) nouns.set(w.w, { art: w.art, pl: w.pl || '', known: false });
    if (w.pos === 'adj' && w.fem) adj.set(w.w, /** @type {[string, string]} */ ([w.fem, w.before ? 'before' : '']));
  }
  return { verbs, nouns, adj, byId, examples };
}

/** The regular 3rd person present: "parler" → "parle", "finir" → "finit", "vendre" → "vend". @param {string} inf */
export function regularThird(inf) {
  const v = String(inf);
  return v.endsWith('er') ? v.slice(0, -1).replace(/r$/, '') : v.endsWith('ir') ? `${v.slice(0, -2)}it` : v.endsWith('re') ? v.slice(0, -2) : v;
}

/** Split "il va · il est allé · il allait · il ira": past is the passé composé, perf the same (the German names). @param {string} f */
export function verbParts(f) {
  const [pres = '', pc = '', imp = '', fut = ''] = String(f).split('·').map(s => s.trim());
  return { pres, past: pc, perf: pc, pc, imp, fut };
}

const strip = (/** @type {string} */ s) => String(s).replace(/^(il|elle|on)\s+/, '').replace(/^(se\s+|s'|ne\s+|n')/, '');
/** The words of a form that are the verb itself ("il s'est levé" → ["levé"], "il va" → ["va"]); aux: drop the auxiliary. @param {string} form */
const verbWords = (form, aux = false) => String(form).split(/\s+/).map(x => x.replace(/^(s'|n')/, '')).filter(x => x && !/^(il|elle|on|se|ne)$/.test(x) && !(aux && /^(est|a)$/.test(x)));
// the present of the three verbs whose forms no rule gives
const IRREGULAR = /** @type {Record<string, string[]>} */ ({ 'être': ['suis', 'es', 'est', 'sommes', 'êtes', 'sont'], avoir: ['ai', 'as', 'a', 'avons', 'avez', 'ont'], aller: ['vais', 'vas', 'va', 'allons', 'allez', 'vont'] });
/**
 * Forms the verb takes in a sentence, to find it in an example (never to grade): the four listed forms, the je/tu forms
 * of the il form (vient → viens, peut → peux, connaît → connais), nous/vous from the imparfait's stem (venait → venons,
 * venez; remplissait → remplissez), the conditional from the future's stem (voudra → voudrais), the participle's four
 * spellings. @param {string} bare @param {ReturnType<typeof verbParts>} p @param {string} pp
 */
function verbSurface(bare, p, pp) {
  const out = [bare, ...(IRREGULAR[bare] || [])];
  for (const x of verbWords(p.pres)) {
    out.push(x, `${x}s`);
    if (/ît$/.test(x)) out.push(x.replace(/ît$/, 'is'));
    else if (/ut$/.test(x)) out.push(x.replace(/t$/, 'x'));
    else if (/t$/.test(x)) out.push(x.replace(/t$/, 's'));
    if (/e$/.test(x)) out.push(`${x}nt`);
  }
  for (const x of verbWords(p.imp)) { const st = x.replace(/ait$/, ''); out.push(x, `${st}ais`, `${st}aient`, `${st}ions`, `${st}iez`, `${st}ons`, `${st}ez`, `${st}ent`); }
  for (const x of verbWords(p.fut)) { const st = x.replace(/a$/, ''); out.push(x, `${st}ai`, `${st}as`, `${st}ons`, `${st}ez`, `${st}ont`, `${st}ais`, `${st}ait`, `${st}ions`, `${st}iez`, `${st}aient`); }
  out.push(...verbWords(p.pc, true));
  if (pp) out.push(pp, `${pp}e`, `${pp}s`, `${pp}es`);
  return out.filter(x => x && x.length > 1);
}

/**
 * Forms of a verb from its word-list entry.
 * @param {string} w the infinitive as listed ("aller", "se lever") @param {string} f its forms @param {{aux?: string, pp?: string, note?: string}} [x]
 * @returns {Forms}
 */
export function verbForms(w, f, x = {}) {
  const p = verbParts(f);
  const inf = String(w).trim();
  const bare = inf.replace(/^(se\s+|s')/, '');
  const refl = bare !== inf;
  const accept = refl ? [inf] : [bare];
  const pp = x.pp || (p.pc.split(/\s+/).pop() || '');
  return { type: 'verb', head: inf, accept: [...new Set(accept)], line: [inf, p.pres, p.pc, p.imp, p.fut].filter(Boolean).join(' · '),
    pres: null, plural: null, pluralNote: null, surface: [...new Set(verbSurface(bare, p, pp).map(strip))] };
}

/** "une" or "un" for a gender. @param {string | null | undefined} g */
const indef = g => (g === 'f' ? 'une' : 'un');

/**
 * Forms for a word: the dictionary form, what to accept and the key forms.
 * @param {ReturnType<typeof formsIndex>} ix
 * @param {{lemma: string, pos?: string | null, id?: string | null}} w  id: the card id (W:<word list id>)
 * @returns {Forms | null}
 */
export function formsOf(ix, { lemma, pos, id = null }) {
  const type = wordType(pos) || 'word';
  const l = String(lemma || '').trim();
  const listed = id && /^W:/.test(id) ? ix.byId.get(id.slice(2)) : ix.byId.get(`${l}.${pos}`) || null;
  if (type === 'verb') {
    const hit = listed && listed.pos === 'verb' && listed.forms ? listed : null;
    return hit ? verbForms(hit.w, hit.forms, hit) : null;
  }
  if (type === 'noun') {
    const n = listed && listed.pos === 'noun' && listed.art ? listed : null;
    if (!n) return null;
    const g = n.g === 'f' || (n.art === 'la' && n.g !== 'm') ? 'f' : 'm';
    const elided = n.art === "l'";
    const head = elided ? `l'${n.w}` : `${n.art} ${n.w}`;
    const pl = n.pl || null;
    return { type, head, accept: [head, `${indef(g)} ${n.w}`], line: elided ? `${head} (${g}) · ${indef(g)} ${n.w}` : `${head} (${g})`,
      pres: null, plural: pl ? `les ${pl}` : null, pluralNote: null, surface: [n.w, pl || ''].filter(Boolean) };
  }
  if (type === 'adjective') {
    const a = listed && listed.pos === 'adj' ? listed : null;
    const fem = a && a.fem ? a.fem : null;
    return { type, head: l, accept: [l], line: fem && fem !== l ? `${l} · ${fem}` : null, pres: null, plural: null, pluralNote: null,
      surface: [l, `${l}s`, fem || '', fem ? `${fem}s` : '', l.endsWith('x') ? `${l.slice(0, -1)}se` : ''].filter(Boolean) };
  }
  return { type, head: l, accept: [l], line: null, pres: null, plural: null, pluralNote: null, surface: [l] };
}

/**
 * The note under a word's forms: the participle agreement of an être verb, the avoir use of passer/monter …, an
 * adjective placed before the noun. English chrome around French examples. @param {any} w a word-list entry
 * @returns {string | null}
 */
export function formNote(w) {
  if (!w) return null;
  if (w.pos === 'verb' && w.aux === 'être') {
    const pp = String(w.pp || '');
    const agree = pp ? `With être the participle agrees: elle ${/^s'|^se /.test(w.w) ? "s'est" : 'est'} ${pp}e, ils ${/^s'|^se /.test(w.w) ? 'se sont' : 'sont'} ${pp}s.` : null;
    return [agree, w.note || null].filter(Boolean).join(' ') || null;
  }
  if (w.pos === 'adj' && w.before) return 'Goes before the noun.';
  return w.note || null;
}

/**
 * Where a form of the word is in a text: the first whole-word match of any surface form (case-insensitive).
 * @param {string} text @param {string[]} forms @returns {{start: number, end: number} | null}
 */
export function findForm(text, forms) {
  const s = String(text);
  const list = [...new Set(forms.filter(Boolean))].sort((a, b) => b.length - a.length);
  for (const f of list) {
    const esc = f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(^|[^\\p{L}])(${esc})(?![\\p{L}])`, 'iu');
    const m = re.exec(s);
    if (m && m.index != null) return { start: m.index + m[1].length, end: m.index + m[1].length + m[2].length };
  }
  return null;
}

/**
 * The sentence that holds the word, as the card's example: a whole sentence of at most 16 words (French examples in
 * the word list are written for the card), else null.
 * @param {string} sentence @param {string} form @param {{verbs?: Set<string> | null}} [_o]
 * @returns {{text: string, start: number, end: number} | null}
 */
export function exampleClause(sentence, form, _o = {}) {
  const s = String(sentence || '').replace(/\s+/g, ' ').trim();
  const at = findForm(s, [form]);
  if (!at || s.split(' ').length > 16 || s.split(' ').length < 2) return null;
  return { text: s, start: at.start, end: at.end };
}

/** Verb forms a sentence can hold, lower case. @param {ReturnType<typeof formsIndex>} ix */
export function verbSet(ix) {
  const out = new Set('est sont était étaient a ont avait avaient va vont fait peut veut doit faut'.split(' '));
  for (const v of ix.verbs.values()) for (const x of verbForms(v.w, v.forms).surface) out.add(String(x).toLowerCase());
  return out;
}

const VOWEL_START = /^[aeiouyàâäéèêëîïôöùûüœæh]/i;
// nouns with an aspirated h: le/la, never l'
const H_ASPIRE = new Set(['héros', 'hausse', 'haricot', 'hasard', 'hall', 'handicap', 'hamburger', 'hauteur', 'hibou', 'hockey', 'honte', 'huit', 'haine', 'hangar', 'hache', 'haie', 'hêtre', 'housse', 'hublot', 'hurlement', 'hutte']);

/**
 * The rules a schema cannot say: every noun has art and g; l' only before a vowel or a mute h, le/la never there
 * (unless an aspirated h); every verb has its four forms, its auxiliary and participle, the passé composé built with
 * that auxiliary and participle; an adjective has its feminine.
 * @param {any} _forms unused (no extra forms file) @param {any[]} words the word list @returns {string[]}
 */
export function validateForms(_forms, words) {
  const out = [];
  const ids = new Set();
  for (const w of words || []) {
    if (ids.has(w.id)) out.push(`words ${w.id}: a duplicate id`);
    ids.add(w.id);
    if (w.pos === 'noun') {
      if (!['le', 'la', "l'"].includes(w.art)) out.push(`words ${w.id}: a noun has le, la or l'`);
      if (w.g !== 'm' && w.g !== 'f') out.push(`words ${w.id}: a noun has a gender (m or f)`);
      if (w.art === 'le' && w.g === 'f') out.push(`words ${w.id}: le with a feminine noun`);
      if (w.art === 'la' && w.g === 'm') out.push(`words ${w.id}: la with a masculine noun`);
      const vowel = VOWEL_START.test(w.w) && !H_ASPIRE.has(w.w);
      if (w.art === "l'" && !vowel) out.push(`words ${w.id}: l' before a consonant or an aspirated h`);
      if ((w.art === 'le' || w.art === 'la') && vowel) out.push(`words ${w.id}: ${w.art} before a vowel (l')`);
      if (!w.pl) out.push(`words ${w.id}: a noun has a plural`);
    }
    if (w.pos === 'verb') {
      const p = verbParts(w.forms || '');
      if (!p.pres || !p.pc || !p.imp || !p.fut) { out.push(`words ${w.id}: forms "${w.forms}" need four parts`); continue; }
      if (w.aux !== 'avoir' && w.aux !== 'être') out.push(`words ${w.id}: aux is avoir or être`);
      const refl = /^(se\s|s')/.test(w.w);
      if (refl && w.aux !== 'être') out.push(`words ${w.id}: a pronominal verb takes être`);
      const auxRe = w.aux === 'être' ? (refl ? /^il s'est\s/ : /^il est\s/) : /^il (a|y a)\s/;
      if (!auxRe.test(p.pc) && !(w.aux === 'avoir' && /^il a\s/.test(p.pc))) out.push(`words ${w.id}: passé composé "${p.pc}" does not use ${w.aux}`);
      if (w.pp && !p.pc.endsWith(` ${w.pp}`)) out.push(`words ${w.id}: passé composé "${p.pc}" does not end with the participle ${w.pp}`);
      if (!/^il\s/.test(p.pres) || !/^il\s/.test(p.imp) || !/^il\s/.test(p.fut)) out.push(`words ${w.id}: forms are written with il`);
    }
    if (w.pos === 'adj' && !w.fem) out.push(`words ${w.id}: an adjective has its feminine`);
  }
  return out;
}

export const SEPARABLE = /** @type {string[]} */ ([]);

/**
 * The one example a word card shows: the word list's sentence (or a fallback) that holds a form of the word.
 * @param {{sent?: string | null, form?: string | null, src?: string | null, fallbacks?: ({de: string, en?: string | null} | null)[], verbs?: Set<string> | null}} o
 * @param {Forms | null} f
 * @returns {{text: string, start: number, end: number, src: string | null, en: string | null} | null}
 */
export function pickExample({ sent = null, form = null, src = null, fallbacks = [], verbs = null }, f) {
  const surface = f ? f.surface : [];
  const inText = (/** @type {string} */ s) => { const at = findForm(s, form ? [form, ...surface] : surface); return at ? s.slice(at.start, at.end) : null; };
  if (sent) {
    const hit = inText(sent);
    const c = hit && exampleClause(sent, hit, { verbs });
    if (c) return { ...c, src, en: null };
  }
  for (const fb of fallbacks) {
    if (!fb || !fb.de) continue;
    const hit = inText(fb.de);
    const c = hit && exampleClause(fb.de, hit, { verbs });
    if (c) return { ...c, src: null, en: fb.en || null };
  }
  return null;
}
