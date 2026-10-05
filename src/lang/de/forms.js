/* German word forms for a word card (the German pack's forms model; moved unchanged from domain/forms.js, Wave C2,
   which now hands every call to the active pack): the dictionary form to type and the key forms to show after the
   answer. Pure; tested in node (tests/unit/forms.test.mjs) and checked over the content by tools/validate-content.mjs.

   Sources, both validated content:
     - the word list (content/igloo/words/de.json): nouns with article and plural, verbs with
       forms "3rd person present · Präteritum · Perfekt" ("fährt ab · fuhr ab · ist abgefahren")
     - content/b1/forms.json for words outside the word list (same verb format; nouns as [article, plural]) and the
       adjectives with an irregular comparison ([comparative, superlative])

   What a card shows:
     verb       "ziehen – zog – hat/ist gezogen", and "er fährt" when the 3rd person present is not the regular one
                (a stem vowel change: fahren, nehmen, laufen; or an irregular verb: haben, wissen, können)
     noun       "der Rauch" and its plural ("die Zäune", "no plural", "plural only")
     adjective  "gut – besser – am besten" when the comparison is irregular, else the base form
     other      the word itself
   The dashes between the principal parts are the dictionary convention for German forms; they are German content,
   not interface copy. */

const CONTRACT = /** @type {Record<string, string[]>} */ ({ zu: ['zum', 'zur'], an: ['am', 'ans'], in: ['im', 'ins'], von: ['vom'], bei: ['beim'], auf: ['aufs'] });
const PHRASE_SKIP = new Set('sich der die das den dem des ein eine einen einem zum zur auf aus für mit von bei nach über unter vor ins im am an in um zu es etwas jemand jemandem jemanden'.split(' '));
const SEPARABLE = ['zurück', 'zusammen', 'weiter', 'vorbei', 'bereit', 'heraus', 'herein', 'hinaus', 'mit', 'ab', 'an', 'auf', 'aus', 'ein', 'los', 'nach', 'vor', 'weg', 'zu', 'fest', 'her', 'hin', 'um', 'unter', 'über', 'durch', 'wieder', 'statt', 'teil', 'kennen', 'kaputt', 'frei', 'fertig', 'bekannt', 'Staub'];
const INSEPARABLE = /^(be|emp|ent|er|ge|miss|ver|zer|hinter|wider)/;
/** Verbs that start like a prefix but have none (gebellt, geerbt) or end like -ieren but are not (gefroren). */
const NOT_PREFIXED = new Set(['bellen', 'beißen', 'beten', 'betteln', 'bergen', 'bersten', 'erben', 'ernten']);
const NOT_IEREN = new Set(['frieren', 'schmieren']);
const POS = /** @type {Record<string, string>} */ ({ Verb: 'verb', verb: 'verb', Nomen: 'noun', noun: 'noun', Adjektiv: 'adjective', adj: 'adjective', Adverb: 'adverb', adv: 'adverb',
  Präposition: 'preposition', prep: 'preposition', Zahl: 'number', num: 'number', Konjunktion: 'conjunction', conj: 'conjunction', Pronomen: 'pronoun', pron: 'pronoun',
  phrase: 'phrase', Phrase: 'phrase', Ausdruck: 'phrase', det: 'determiner', Artikel: 'determiner', interj: 'interjection' });

/** The word type in English ('verb', 'noun', …) for a part-of-speech tag from the exam list or the word list. @param {string | null | undefined} pos */
export const wordType = pos => POS[String(pos || '')] || null;

/** "sich bewerben um" → "bewerben"; "denken an" → "denken". @param {string} w */
export const verbBase = w => String(w).trim().replace(/^sich\s+/, '').replace(/\s+\S+$/, '');

/**
 * @typedef {object} Forms
 * @property {string} type       'verb' | 'noun' | 'adjective' | 'adverb' | … | 'word'
 * @property {string} head       the dictionary form: "ziehen", "sich bewerben", "der Rauch", "gut"
 * @property {string[]} accept   what counts as the dictionary form when typed
 * @property {string | null} line   the key forms on one line: "ziehen – zog – hat/ist gezogen", "gut – besser – am besten"
 * @property {string | null} pres  the 3rd person present when it is not the regular one: "er fährt"
 * @property {string | null} plural  "die Zäune", or null (none, or not known)
 * @property {'none' | 'only' | null} pluralNote  'none': no plural; 'only': a plural-only noun
 * @property {string[]} surface  forms the word can take in a sentence, to find it in an example
 */

/**
 * The lookup tables. @param {any[]} words the word list @param {any} forms content b1.forms (or null)
 * @returns {{verbs: Map<string, {w: string, forms: string}>, nouns: Map<string, {art: string, pl: string, known: boolean}>, adj: Map<string, [string, string]>, byId: Map<string, any>, examples: Map<string, {de: string, en: string}>}}
 */
export function formsIndex(words, forms) {
  const verbs = new Map(), nouns = new Map(), adj = new Map(), byId = new Map(), examples = new Map();
  for (const [k, v] of Object.entries((forms && forms.examples) || {})) examples.set(k, { de: /** @type {any} */ (v)[0], en: /** @type {any} */ (v)[1] });
  for (const w of words || []) {
    if (!w || !w.w) continue;
    byId.set(w.id, w);
    if (w.pos === 'verb' && w.forms) { const k = verbBase(w.w); if (!verbs.has(k)) verbs.set(k, { w: w.w, forms: w.forms }); }
    if (w.pos === 'noun' && w.art && !nouns.has(w.w)) nouns.set(w.w, { art: w.art, pl: w.pl || '', known: false });
  }
  for (const [k, v] of Object.entries((forms && forms.verbs) || {})) { const b = verbBase(k); if (!verbs.has(b)) verbs.set(b, { w: k, forms: /** @type {string} */ (v) }); }
  for (const [k, v] of Object.entries((forms && forms.nouns) || {})) if (!nouns.has(k)) nouns.set(k, { art: /** @type {any} */ (v)[0], pl: /** @type {any} */ (v)[1], known: true });
  for (const [k, v] of Object.entries((forms && forms.adj) || {})) adj.set(k, /** @type {[string, string]} */ (v));
  return { verbs, nouns, adj, byId, examples };
}

/** The regular 3rd person present of a simple verb: "machen" → "macht", "arbeiten" → "arbeitet". @param {string} inf */
export function regularThird(inf) {
  const v = String(inf);
  const stem = /(el|er)n$/.test(v) ? v.slice(0, -1) : v.endsWith('en') ? v.slice(0, -2) : v.slice(0, -1);
  if (/[sßzx]$/.test(stem)) return `${stem}t`;
  const e = /[dt]$/.test(stem) || (/[^lrmnaeiouäöü][mn]$/.test(stem) && !/[aeiouäöü]h[mn]$/.test(stem)) ? 'e' : '';
  return `${stem}${e}t`;
}

/** Split "fährt ab · fuhr ab · ist abgefahren" into its parts. @param {string} f */
export function verbParts(f) {
  const [pres = '', past = '', perf = ''] = String(f).split('·').map(s => s.trim());
  return { pres, past, perf };
}

/** The separable particle of a present form ("fährt ab" → "ab", "bewirbt sich" → null). @param {string} pres */
const particle = pres => { const t = String(pres).split(/\s+/).filter(x => x !== 'sich'); return t.length > 1 ? t[t.length - 1] : null; };

/**
 * Forms of a verb from its word-list or forms.json entry.
 * @param {string} w the infinitive as listed ("sich bewerben", "zurückziehen") @param {string} f its forms
 * @returns {Forms}
 */
export function verbForms(w, f) {
  const p = verbParts(f);
  const inf = String(w).replace(/\s+(an|auf|aus|für|mit|über|um|von|zu|mit|bei|nach|vor)$/, '');
  const refl = /^sich\s/.test(inf);
  const bare = inf.replace(/^sich\s+/, '');
  const part = particle(p.pres);
  const finite = p.pres.split(/\s+/)[0];
  const base = part && bare.startsWith(part) ? bare.slice(part.length) : bare;
  const regular = regularThird(base);
  const pres = finite && finite !== regular ? `er ${p.pres}` : null;
  const accept = refl ? [inf, bare] : [bare];
  const pp = p.perf.split(/\s+/).pop() || '';
  const pastStem = p.past.split(/\s+/)[0] || '';
  // the forms the verb takes in a sentence: present (ich, du, er, wir), Präteritum, Partizip, zu-infinitive
  const stem = /(el|er)n$/.test(base) ? base.slice(0, -1) : base.replace(/e?n$/, '');
  const e = regular.endsWith('et') ? 'e' : '';
  const elStem = /eln$/.test(base) ? base.slice(0, -3) + 'l' : null;   // zweifeln: ich zweifle
  const du = finite.endsWith('t') ? [`${finite.slice(0, -1)}st`, /[sßzx]t$/.test(finite) ? finite : ''] : [];
  const surface = [bare, base, stem, `${stem}e`, `${stem}${e}st`, `${stem}${e}t`, `${stem}en`, `${stem}n`, elStem ? `${elStem}e` : '', finite, ...du,
    pastStem, pastStem.endsWith('e') ? `${pastStem}n` : `${pastStem}en`, `${pastStem}${pastStem.endsWith('e') ? '' : 'e'}st`, `${pastStem}${pastStem.endsWith('e') ? '' : 'e'}t`,
    pp, pp && part ? pp.slice(part.length) : '', part ? `${part}zu${base}` : ''].filter(Boolean);
  return { type: 'verb', head: inf, accept: [...new Set(accept)], line: `${inf} – ${p.past} – ${p.perf}`, pres, plural: null, pluralNote: null, surface: [...new Set(surface)] };
}

/**
 * Forms for a word: the dictionary form, what to accept and the key forms.
 * @param {ReturnType<typeof formsIndex>} ix
 * @param {{lemma: string, pos?: string | null, id?: string | null, art?: string | null}} w  id: the card id (W:<word list id> or BW:…)
 * @returns {Forms | null} null when the content has no forms for this word (a verb or noun outside both lists)
 */
export function formsOf(ix, { lemma, pos, id = null }) {
  const type = wordType(pos) || 'word';
  const l = String(lemma || '').trim();
  const listed = id && /^W:/.test(id) ? ix.byId.get(id.slice(2)) : null;
  if (type === 'verb') {
    const hit = listed && listed.pos === 'verb' && listed.forms ? { w: listed.w, forms: listed.forms } : ix.verbs.get(verbBase(l));
    return hit ? verbForms(hit.w, hit.forms) : null;
  }
  if (type === 'noun') {
    const hit = listed && listed.pos === 'noun' && listed.art ? { art: listed.art, pl: listed.pl || '', known: false } : ix.nouns.get(l);
    if (!hit) return null;
    return nounForms(listed ? listed.w : l, hit);
  }
  if (type === 'adjective') {
    const c = ix.adj.get(l);
    const st = /e[lr]$/.test(l) && l.length > 4 ? l.replace(/e([lr])$/, '$1') : l;   // flexibel: flexible, teuer: teure
    return { type, head: l, accept: [l], line: c ? `${l} – ${c[0]} – ${c[1]}` : null, pres: null, plural: null, pluralNote: null,
      surface: [l, ...['e', 'en', 'em', 'er', 'es'].flatMap(x => [`${l}${x}`, `${st}${x}`, `${l}st${x}`, `${l}est${x}`]), ...(c ? [c[0], c[1].replace(/^am\s+/, '').replace(/n$/, '')] : [])] };
  }
  if (type === 'determiner' || type === 'number') {   // ein: eine, einen …; jeder: jede, jeden …; erste: ersten …
    const st = l.replace(/(er|e)$/, '');
    return { type, head: l, accept: [l], line: null, pres: null, plural: null, pluralNote: null, surface: [l, ...['e', 'en', 'em', 'er', 'es'].map(x => `${st}${x}`)] };
  }
  if (type === 'preposition' && CONTRACT[l]) return { type, head: l, accept: [l], line: null, pres: null, plural: null, pluralNote: null, surface: [l, ...CONTRACT[l]] };
  // a phrase ("Rücksicht nehmen"): its words, a verb in it with its forms, so the example can mark it
  const toks = l.split(/\s+/).map(x => x.replace(/[^\p{L}-]/gu, '')).filter(x => x.length > 2 && !PHRASE_SKIP.has(x.toLowerCase()));
  const surface = [l, ...toks, ...toks.flatMap(x => { const v = ix.verbs.get(x); return v ? verbForms(v.w, v.forms).surface : []; })];
  return { type, head: l, accept: [l], line: null, pres: null, plural: null, pluralNote: null, surface: [...new Set(surface)] };
}

/** @param {string} w @param {{art: string, pl: string, known: boolean}} n */
function nounForms(w, n) {
  const plOnly = n.art === 'pl', none = n.art === '-';
  const arts = n.art === 'der/die' ? ['der', 'die'] : plOnly ? ['die'] : none ? [] : [n.art];
  const head = none ? w : `${plOnly ? 'die' : n.art} ${w}`;
  const plural = !plOnly && !none && n.pl ? `die ${n.pl}` : null;
  /** @type {'none' | 'only' | null} */
  const pluralNote = plOnly ? 'only' : !none && !n.pl && n.known ? 'none' : null;
  const pl = n.pl || '';
  return { type: 'noun', head, accept: none ? [w] : arts.map(a => `${a} ${w}`), line: null, pres: null, plural, pluralNote,
    surface: [w, `${w}n`, `${w}s`, `${w}es`, `${w}r`, pl, pl && `${pl}n`].filter(Boolean) };
}

/* ------------------------------------------------------------------ */
/* The example: his exam sentence cut to the one clause with the word  */
/* ------------------------------------------------------------------ */

const SUBORD = new Set('weil dass ob wenn als obwohl damit bevor nachdem während da falls sodass seit seitdem bis indem wie was wo wer wohin woher warum wann sobald solange ehe um ohne statt anstatt worüber wofür womit wovon woran worauf'.split(' '));
const AMBIG = new Set('bis seit während um ohne statt anstatt da'.split(' '));
const OBJ = new Set('dass ob wie was warum wann wohin woher wo wer'.split(' '));
const PRON = new Set('ich du er sie es wir ihr man'.split(' '));
const COORD = new Set('und aber oder denn sondern doch'.split(' '));
const SUBJ = new Set('ich du er sie es wir ihr man der die das den dem des ein eine einen einem einer eines kein keine mein meine dein deine sein seine ihre unser unsere euer eure dieser diese dieses jeder jede jedes alle viele manche einige beide mehrere'.split(' '));
const REL = new Set('der die das dem den deren dessen denen'.split(' '));
const PREP = new Set('in im ins an am ans auf aufs aus bei beim mit nach seit von vom zu zum zur durch für gegen ohne um bis hinter neben über unter vor zwischen wegen trotz während innerhalb außerhalb entlang gegenüber'.split(' '));
const DET = new Set('der die das den dem des ein eine einen einem einer eines kein keine keinen keinem keiner mein meine meinen meinem meiner dein deine sein seine seinen seinem seiner ihr ihre ihren ihrem ihrer unser unsere unseren unserem euer eure dieser diese dieses diesen diesem jeder jede jedes jeden jedem'.split(' '));
const ADJ_END = /(e|en|em|er|es)$/;
const words = (/** @type {string} */ s) => s.split(/\s+/).filter(Boolean);
const bare = (/** @type {string} */ w) => w.replace(/^[„"'(»«‚]+|[“"'),.;:!?»«‘…]+$/g, '');
const isCap = (/** @type {string} */ w) => /^[A-ZÄÖÜ]/.test(bare(w));

/**
 * Where a form of the word is in a text: the first whole-word match of any surface form (case-insensitive for the
 * first letter). @param {string} text @param {string[]} forms
 * @returns {{start: number, end: number} | null}
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
 * The one clause of a sentence that holds the word, as a sentence of its own, or null when that clause cannot stand
 * alone (a subordinate or relative clause, a fragment, a clause that starts with its verb). Commas, semicolons,
 * colons, dashes and sentence ends split clauses. A long clause loses trailing prepositional phrases after the
 * phrase that follows the word ("Der Rauch zog in die Wohnung von Herrn Lange im ersten Stock." → "Der Rauch zog in
 * die Wohnung.").
 * The clause must hold a finite verb when a verb set is given (a heading such as "Die gelbe Tonne." is not an example),
 * and a clause whose sentence goes on with its object ("…, dass …", "…, zu kommen") is not used.
 * @param {string} sentence @param {string} form the word as it appears in the sentence
 * @param {{verbs?: Set<string> | null}} [o] verbs: folded verb forms (verbSet()), to require a verb in the clause
 * @returns {{text: string, start: number, end: number} | null}  start/end: the form inside text
 */
export function exampleClause(sentence, form, { verbs = null } = {}) {
  const s = String(sentence || '').replace(/\s+/g, ' ').trim();
  const at = findForm(s, [form]);
  if (!at) return null;
  // the clause around the form
  const cut = /[,;:()]|\s[–—-]\s|(?<!\b\d{1,2})[.!?…]+(?=\s|$|[A-ZÄÖÜ„"“”»«])/g;   // "12. Jahrhundert" is one clause
  let a = 0, b = s.length, m;
  while ((m = cut.exec(s))) { if (m.index < at.start) a = m.index + m[0].length; else { b = m.index; break; } }
  const before = s.slice(0, a).trim();
  const sentenceStart = !before || /[.!?…]["“”»«]?$/.test(before);
  // the sentence goes on with this clause's object: an object clause or an infinitive with zu
  const next = s.slice(b).replace(/^[,;:]\s*/, '');
  const nextWords = words(next.split(/[,;:.!?]/)[0] || '');
  if (s[b] === ',' && nextWords.length && (OBJ.has(bare(nextWords[0]).toLowerCase()) || /^(zu|\S+zu\S+en)$/.test(bare(nextWords[nextWords.length - 1] || '')) || bare(nextWords[nextWords.length - 2] || '') === 'zu')) return null;
  let raw = s.slice(a, b);
  const lead = raw.length - raw.trimStart().length;
  raw = raw.trim();
  let start = at.start - a - lead;
  let ws = words(raw);
  if (ws.length < 3) return null;
  if (ws.some(w => /[a-zäöüß][A-ZÄÖÜ]|^[A-ZÄÖÜ]{2}[a-zäöüß]/.test(bare(w)))) return null;   // words run together in the source
  // a coordinating conjunction goes when a subject follows it
  if (COORD.has(bare(ws[0]).toLowerCase())) {
    if (!(SUBJ.has(bare(ws[1]).toLowerCase()) || isCap(ws[1]))) return null;
    const drop = raw.indexOf(ws[1]);
    raw = raw.slice(drop); start -= drop; ws = words(raw);
  }
  const f0l = bare(ws[0]).toLowerCase();
  if (f0l === 'zu' && !isCap(ws[0])) return null;
  // a subordinate clause; a preposition that can also be a conjunction (bis, seit, während …) only counts as one
  // when a subject follows it and the clause ends in a lower-case verb
  const question = isCap(ws[0]) && s[b] === '?';
  if (SUBORD.has(f0l) && !question && (!AMBIG.has(f0l) || (SUBJ.has(bare(ws[1] || '').toLowerCase()) && !isCap(ws[ws.length - 1])))) return null;
  if (!isCap(ws[0])) {
    // lower case: a clause after a comma; it must open with its subject (an article, a pronoun), not a verb or a
    // relative pronoun ("der Rauch zog …" yes, "die ich gekauft habe" no)
    if (!SUBJ.has(f0l)) return null;
    if (REL.has(f0l) && ws[1] && !isCap(ws[1]) && !ADJ_END.test(bare(ws[1]))) return null;
    if (sentenceStart) return null;   // the sentence itself starts in lower case: a fragment
  }
  // an infinitive with zu on its own ("Ein Zimmer zu finden.") or a clause left hanging on "es"
  const last = bare(ws[ws.length - 1]).toLowerCase();
  const hasVerb = (/** @type {string[]} */ list) => !verbs || list.some((w, i) => verbs.has(fold(bare(w))) || /^ge\p{Ll}{3,}(t|en)$/u.test(bare(w))
    || (i > 0 && !isCap(w) && PRON.has(bare(list[i + 1] || '').toLowerCase()) && !DET.has(bare(w).toLowerCase()) && !PREP.has(bare(w).toLowerCase())));
  if ((bare(ws[ws.length - 2] || '').toLowerCase() === 'zu' && !hasVerb(ws.slice(0, -1))) || (last === 'es' && s[b] === ',')) return null;
  if (!hasVerb(ws)) return null;
  // trim trailing prepositional phrases from a long clause
  if (ws.length > 8) {
    const toks = [...raw.matchAll(/\S+/g)].map(x => ({ w: x[0], i: /** @type {number} */ (x.index) }));
    const wi = toks.findIndex(x => x.i + x.w.length > start);
    const k = toks.findIndex((x, i) => i > wi && isCap(x.w));
    if (wi >= 0 && k > wi && k < toks.length - 1) {
      const tail = toks.slice(k + 1);
      const ok = PREP.has(bare(tail[0].w).toLowerCase()) && isCap(tail[tail.length - 1].w)
        && tail.every(x => isCap(x.w) || PREP.has(bare(x.w).toLowerCase()) || DET.has(bare(x.w).toLowerCase()) || ADJ_END.test(bare(x.w)) || /^\d+$/.test(bare(x.w)));
      if (ok && k + 1 >= 3) raw = raw.slice(0, toks[k].i + toks[k].w.length);
    }
  }
  raw = raw.replace(/[„“”"»«]/g, '').replace(/\s+([,.!?])/g, '$1').replace(/[.!?…]+$/, '').trim();
  // the form's place may have moved with removed quotes: find it again in the clause
  const again = findForm(raw, [s.slice(at.start, at.end)]);
  if (!again) return null;
  const ends = /[!?]/.test(s[b] || '') ? s[b] : '.';
  const text = raw.charAt(0).toUpperCase() + raw.slice(1) + ends;
  if (words(text).length < 3) return null;
  return { text, start: again.start, end: again.end };
}

/** Folded word: lower case. @param {string} w */
const fold = w => String(w).toLowerCase();

/**
 * Verb forms a clause can hold as its finite verb or its participle, from every verb with forms (and the auxiliaries
 * and modals), folded. @param {ReturnType<typeof formsIndex>} ix
 */
export function verbSet(ix) {
  const out = new Set('ist sind war waren bin bist seid wäre wären hat haben hatte hatten habe hast habt hätte hätten wird werden wurde wurden würde würden kann können konnte konnten könnte muss müssen musste mussten soll sollen sollte sollten darf dürfen durfte durften will wollen wollte wollten möchte möchten mag gibt gab geht ging'.split(' '));
  for (const v of ix.verbs.values()) for (const x of verbForms(v.w, v.forms).surface) out.add(fold(x));
  return out;
}

/* ------------------------------------------------------------------ */
/* Validation (tools/validate-content.mjs)                             */
/* ------------------------------------------------------------------ */

/**
 * The rules a schema cannot say: every verb of the word list has forms; a verb's parts agree with each other
 * (a separable particle at the end of the present and the past and at the front of the participle, sich in all three
 * of a reflexive verb, no ge- for -ieren and inseparable verbs); forms.json never repeats a word of the word list
 * (one source per word); plurals are capitalised nouns.
 * @param {any} forms content/b1/forms.json @param {any[]} words the word list
 * @returns {string[]}
 */
export function validateForms(forms, words) {
  const out = [];
  const verbsIn = new Set(), nounsIn = new Set();
  for (const w of words) {
    if (w.pos === 'verb') {
      verbsIn.add(verbBase(w.w));
      if (!w.forms) out.push(`words ${w.id}: a verb without forms`);
      else out.push(...verbErrors(w.w, w.forms).map(e => `words ${w.id}: ${e}`));
    }
    if (w.pos === 'noun') nounsIn.add(w.w);
  }
  for (const [k, f] of Object.entries(forms.verbs || {})) {
    if (verbsIn.has(verbBase(k))) out.push(`forms verbs ${k}: also in the word list; keep one source`);
    out.push(...verbErrors(k, /** @type {string} */ (f)).map(e => `forms verbs ${k}: ${e}`));
  }
  for (const [k, v] of Object.entries(forms.nouns || {})) {
    const [art, pl] = /** @type {[string, string]} */ (v);
    if (nounsIn.has(k)) out.push(`forms nouns ${k}: also in the word list; keep one source`);
    if (!/^[A-ZÄÖÜ]/.test(k) && art !== '-') out.push(`forms nouns ${k}: a noun starts with a capital`);
    if (pl && !/^[A-ZÄÖÜ]/.test(pl)) out.push(`forms nouns ${k}: plural ${pl} is not a noun`);
    if ((art === 'pl' || art === '-') && pl) out.push(`forms nouns ${k}: a plural-only or article-less noun lists no plural`);
  }
  const ids = new Set(words.map(w => w.id));
  for (const k of Object.keys(forms.examples || {})) if (!ids.has(k)) out.push(`forms examples ${k}: not a word of the word list`);
  for (const [k, v] of Object.entries(forms.adj || {})) {
    const [c, s] = /** @type {[string, string]} */ (v);
    if (!/(er|mehr)$/.test(c) || !/^am \S+(sten|ten)$/.test(s)) out.push(`forms adj ${k}: ${c}, ${s} is not a comparison`);
  }
  return out;
}

/** @param {string} w @param {string} f */
function verbErrors(w, f) {
  const out = [];
  const p = verbParts(f);
  if (!p.pres || !p.past || !p.perf) return [`forms "${f}" need three parts`];
  if (!/^(hat|ist|hat\/ist) /.test(p.perf)) out.push(`Perfekt "${p.perf}" starts with hat, ist or hat/ist`);
  const inf = verbBase(w);
  const refl = /^sich\s/.test(w);
  if (refl && !/\bsich\b/.test(p.past + ' ' + p.perf)) out.push('a reflexive verb keeps sich in its forms');
  const multi = /\s/.test(String(w).replace(/^sich\s+/, ''));   // "zugrunde liegen", "sich scheiden lassen": no particle checks
  const part = multi ? null : particle(p.pres);
  const pp = p.perf.split(/\s+/).pop() || '';
  if (part) {
    if (!inf.startsWith(part)) out.push(`particle ${part} is not the start of ${inf}`);
    if (!p.past.endsWith(` ${part}`)) out.push(`Präteritum "${p.past}" ends with ${part}`);
    if (!pp.startsWith(part)) out.push(`Partizip "${pp}" starts with ${part}`);
  }
  const core = part && inf.startsWith(part) ? inf.slice(part.length) : inf;
  if (multi) return out;
  if (/ieren$/.test(core) && !NOT_IEREN.has(core) && /^ge/.test(part ? pp.slice(part.length) : pp)) out.push(`an -ieren verb has no ge- in "${pp}"`);
  if (INSEPARABLE.test(core) && !/^ge/.test(core) && part == null && /^ge/.test(pp) && !NOT_PREFIXED.has(core)) out.push(`an inseparable verb has no ge- in "${pp}"`);
  return out;
}

export { SEPARABLE };

/**
 * The one example a word card shows: his exam sentence cut to the clause with the word (with its source), else the
 * first fallback (the word list's example, then the exam list's) that holds a form of the word, cut the same way.
 * @param {{sent?: string | null, form?: string | null, src?: string | null, fallbacks?: ({de: string, en?: string | null} | null)[], verbs?: Set<string> | null}} o
 * @param {Forms | null} f the word's forms (surface forms find the word when the saved form is not in the sentence)
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
    if (!hit) continue;
    const c = exampleClause(fb.de, hit, { verbs });
    if (c) return { ...c, src: null, en: c.text.length >= fb.de.trim().length - 1 ? fb.en || null : null };
  }
  // a short fallback sentence whose word needs the rest of it ("Beeil dich, sonst verpassen wir den Bus."): whole
  for (const fb of fallbacks) {
    if (!fb || !fb.de) continue;
    const text = fb.de.replace(/\s+/g, ' ').trim();
    const hit = inText(text);
    // one sentence; a phrase may keep the short exchange it answers ("Um acht? – Passt!")
    if (!hit || words(text).length > 14 || (/[.!?…]\s+\S/.test(text) && !(f && (f.type === 'phrase' || f.type === 'adverb' || f.type === 'interjection')))) continue;
    const at = /** @type {{start: number, end: number}} */ (findForm(text, [hit]));
    return { text, start: at.start, end: at.end, src: null, en: fb.en || null };
  }
  return null;
}
