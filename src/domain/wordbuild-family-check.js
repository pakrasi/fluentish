/* Word families (round 7): the rules of content/build/FAMILY-SCHEMA.md that a JSON Schema cannot say. Pure; called by
   wordbuild.js validateBuild (so tools/build-wordbuild.mjs and tools/validate-content.mjs run it) and tested in
   tests/unit/build-family.test.mjs.

   The rules that matter most for the learner:
   - a form is spelled by its parts (seg), its prefixes are the tree's, its root stem is one of the family's stems;
   - a noun's article agrees with its ending's rule, or the form says why not (note) or the rule lists it (except);
   - a verb splits as its prefix does (and as the word list says), and its example shows that;
   - every board clue is unique inside its family;
   - a word is called "not a German word" only when it is in no lexicon the build knows (the word list, the cluster
     morphology, every build word) and the recorded checks found it neither in DWDS nor in wordfreq. */

import { tileKey } from './wordbuild-family.js';

const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
const INSEP = new Set(['be', 'emp', 'ent', 'er', 'ge', 'miss', 'ver', 'zer']);
const UNSTRESSED = new Set(['be', 'ge', 'er', 'ver', 'zer', 'ent', 'emp']);
const DASH = /[–—]/;
const VOWEL = /[aeiouäöüy]/i;
/** Ending ids a family form may use beyond suffixes[] (Partizip II and I, the bare stem, the infinitive noun …). */
export const FAMILY_ENDINGS = ['pp', 'ppr', 'stem', 'inf', 'isch', 'los', 's', 'ling'];
/** A checked non-word has at most this many hits in the DWDS corpora (about 53 billion tokens: noise, typos). */
export const NONE_MAX_HITS = 10;
/** Board sizes by level (§5.3) and the Light-day board. */
export const BOARD_SIZE = /** @type {Record<string, number>} */ ({ A2: 6, B1: 10, B2: 12 });
export const LIGHT_SIZE = 6;
/** The highest form level each board may hold (one level above the learner's). */
const BOARD_MAX = /** @type {Record<string, string>} */ ({ A2: 'B1', B1: 'B2', B2: 'C1' });

/** The card ids the families add (PF:<form>; PV/PW forms keep their existing cards). @param {any} c */
export function familyCardIds(c) {
  /** @type {string[]} */ const out = [];
  for (const fam of c.families || []) for (const f of fam.forms || []) if (typeof f.card === 'string' && f.card.startsWith('PF:')) out.push(f.card);
  return [...new Set(out)];
}

/** The tokens of a sentence, lower case. @param {string} s */
const toks = s => String(s).toLowerCase().split(/[^\p{L}]+/u).filter(Boolean);
/** Umlauts folded, so a plural with an umlaut holds its noun (Grundsätze holds Grundsatz). @param {string} s */
const fold = s => s.replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/äu/g, 'au');

/**
 * Does the example hold the form? Nouns: the word (or a plural/case form of it); adjectives: an inflected form; verbs:
 * the welded verb, or for a separable verb the particle on its own (… stellt … her.) or the infinitive / zu / Perfekt.
 * @param {any} f @param {string[]} stems
 */
export function exampleHolds(f, stems) {
  const ex = String(f.ex || ''), t = toks(ex), w = f.word.toLowerCase();
  if (f.cls === 'noun') {
    const base = f.adjNoun ? w.replace(/e$/, '') : w;
    return t.some(x => x === base || (fold(x).startsWith(fold(base)) && x.length - base.length <= 3)) || (f.pl && t.some(x => w.startsWith(x) && w.length - x.length <= 2));
  }
  if (f.cls === 'adj' || f.cls === 'adv' || f.cls === 'conj' || f.cls === 'prep') return t.some(x => x === w || (x.startsWith(w) && x.length - w.length <= 3));
  // verbs
  const pre = (f.pre || []).join('');
  const st = stems.map(s => s.toLowerCase());
  if (!pre) return t.some(x => st.some(s => x.startsWith(s) || x.startsWith(`ge${s}`)));
  if (t.some(x => x === w || x === String(f.pp || '').toLowerCase() || x === `${pre}zu${w.slice(pre.length)}`)) return true;
  if (f.kind === 'i') return t.some(x => st.some(s => x.startsWith(pre + s)));
  // separable: the particle stands alone at a clause end and a form of the stem is in the sentence
  const outer = String(f.pre[0]);
  const inner = f.pre.slice(1).join('');
  const parted = new RegExp(`(^|\\s)${outer}[.!?,;:]`, 'iu').test(ex);
  return parted && t.some(x => st.some(s => x.startsWith(inner + s)));
}

/**
 * @param {any} c the built content (prefixes, suffixes, verbs, chains, particles, families)
 * @param {{words?: any[], morph?: Record<string, any>}} [ctx]
 * @returns {string[]}
 */
export function validateFamilies(c, { words = [], morph = {} } = {}) {
  /** @type {string[]} */ const out = [];
  const bad = (/** @type {string} */ m) => { if (out.length < 300) out.push(m); };
  const english = (/** @type {string} */ at, /** @type {any} */ s) => { if (typeof s === 'string' && DASH.test(s)) bad(`${at}: no en or em dashes in English text`); };
  const byId = new Map(words.map(w => [w.id, w]));
  /** @type {Map<string, any[]>} */ const byW = new Map();
  for (const w of words) byW.set(String(w.w).toLowerCase(), [...(byW.get(String(w.w).toLowerCase()) || []), w]);
  // prefixes the families may use
  /** @type {Map<string, any>} */ const P = new Map((c.prefixes || []).map((/** @type {any} */ p) => [p.id, p]));
  for (const p of c.particles || []) {
    const at = `particle ${p.id}`;
    if (P.has(p.id)) bad(`${at}: already a prefix`);
    P.set(p.id, p);
    if (!['s', 'i', 'd'].includes(p.kind)) bad(`${at}: kind ${p.kind}`);
    if (p.kind === 'd' && (!p.sep || !p.insep)) bad(`${at}: a dual particle needs both readings (sep, insep)`);
    if (!p.core || !p.short) bad(`${at}: core and short are required`);
    for (const k of ['core', 'short', 'sep', 'insep', 'word']) english(`${at} ${k}`, p[k]);
    for (const s of p.senses || []) english(`${at} sense`, s.en);
  }
  /** @type {Map<string, any>} */ const S = new Map((c.suffixes || []).map((/** @type {any} */ s) => [s.id, s]));
  // every word the build knows (no "none" word may be one of them)
  const known = new Set();
  for (const v of c.verbs || []) known.add(String(v.inf).replace(/^sich\s+/, '').toLowerCase());
  for (const ch of c.chains || []) for (const n of ch.nodes) known.add(String(n.word).toLowerCase());
  for (const fam of c.families || []) for (const f of fam.forms || []) known.add(String(f.word).toLowerCase());
  for (const w of words) known.add(String(w.w).toLowerCase());
  const morphWords = new Set(Object.keys(morph).map(id => id.replace(/\.\w+$/, '').replace(/^(der|die|das)_/, '').replace(/^sich_/, '').replace(/_/g, ' ').toLowerCase()));

  /** @type {Map<string, string>} */ const cardOwner = new Map();
  /** @type {Map<string, string>} */ const wordOwner = new Map();
  const roots = new Set();
  for (const fam of c.families || []) {
    const at = `family ${fam.root}`;
    if (roots.has(fam.root)) bad(`${at}: twice`);
    roots.add(fam.root);
    for (const k of ['lemma', 'en', 'pres3', 'pret', 'aux', 'pp']) if (!fam[k]) bad(`${at}: ${k} is required`);
    english(`${at} en`, fam.en);
    if (!Array.isArray(fam.stems) || !fam.stems.length) { bad(`${at}: stems are required`); continue; }
    if (!Array.isArray(fam.forms) || fam.forms.length < 2) { bad(`${at}: no forms`); continue; }
    if (!('reviewedBy' in fam) !== !('reviewedAt' in fam)) bad(`${at}: reviewedBy and reviewedAt go together`);
    const stems = fam.stems.map((/** @type {string} */ s) => s.toLowerCase());
    /** @type {Map<string, any>} */ const F = new Map();
    /** @type {Map<string, string>} */ const clues = new Map();
    const first = fam.forms[0];
    if (first.parent !== null || first.word !== fam.root || first.cls !== 'verb') bad(`${at}: the first form is the root verb itself (parent null)`);
    for (const f of fam.forms) {
      const fa = `${at} ${f.id}`;
      if (F.has(f.id)) bad(`${fa}: twice`);
      if (!/^[\p{L}_.-]+$/u.test(f.id)) bad(`${fa}: id`);
      const parent = f.parent == null ? null : F.get(f.parent);
      if (f.parent != null && !parent) bad(`${fa}: parent ${f.parent} is not an earlier form`);
      F.set(f.id, f);
      // the card: one per form, and one form per card across every family
      if (f.parent == null) { if (f.card !== null) bad(`${fa}: the root has no card`); }
      else if (!/^P[VWF]:./.test(String(f.card))) bad(`${fa}: card ${f.card}`);
      else {
        if (cardOwner.has(f.card)) bad(`${fa}: card ${f.card} is also in ${cardOwner.get(f.card)}`);
        cardOwner.set(f.card, fam.root);
        if (f.card.startsWith('PF:') && f.card !== `PF:${f.id}`) bad(`${fa}: a new form's card is PF:<id>`);
      }
      // a word belongs to one family (the two readings of a dual verb are two forms of the same family)
      const wk = `${f.cls}:${f.word}:${f.art || ''}`;
      if (f.parent != null && wordOwner.has(wk) && wordOwner.get(wk) !== fam.root) bad(`${fa}: ${f.word} is also a form of ${wordOwner.get(wk)}`);
      if (f.parent != null) wordOwner.set(wk, fam.root);
      // word, class, article
      if (!['verb', 'noun', 'adj', 'adv', 'conj', 'prep'].includes(f.cls)) bad(`${fa}: cls ${f.cls}`);
      if (!/^[\p{L}]+$/u.test(f.word)) bad(`${fa}: word ${f.word}`);
      if (f.cls === 'noun' ? !/^\p{Lu}/u.test(f.word) : /^\p{Lu}/u.test(f.word)) bad(`${fa}: ${f.cls === 'noun' ? 'nouns take a capital' : 'only nouns take a capital'}`);
      if (f.cls === 'noun' && !['der', 'die', 'das'].includes(f.art)) bad(`${fa}: a noun needs der, die or das`);
      if (f.cls !== 'noun' && f.art) bad(`${fa}: only nouns have an article`);
      if ((f.adjNoun || f.pl) && f.cls !== 'noun') bad(`${fa}: adjNoun and pl are for nouns`);
      // the tree
      if (parent) {
        if (!['pre', 'suf', 'cmp'].includes(f.side)) bad(`${fa}: side ${f.side}`);
        if (!f.add) bad(`${fa}: add is required`);
        if (f.side === 'pre') {
          if (!(P.has(f.add) || f.add === 'un')) bad(`${fa}: unknown prefix ${f.add}`);
          if (!f.word.toLowerCase().startsWith(f.add)) bad(`${fa}: does not start with ${f.add}`);
        }
        if (f.side === 'suf' && !(S.has(f.add) || FAMILY_ENDINGS.includes(f.add))) bad(`${fa}: unknown ending ${f.add}`);
        if (f.side === 'cmp' && !f.word.toLowerCase().includes(String(f.add).toLowerCase())) bad(`${fa}: does not hold ${f.add}`);
      }
      for (const p of f.pre || []) if (!(P.has(p) || p === 'un')) bad(`${fa}: unknown prefix ${p}`);
      for (const s of f.suf || []) if (!(S.has(s) || FAMILY_ENDINGS.includes(s))) bad(`${fa}: unknown ending ${s}`);
      if (f.side !== 'cmp' && f.key !== `${(f.pre || []).join('+')}|${(f.suf || []).join('+')}`) bad(`${fa}: key ${f.key}`);
      // the written parts spell the word; the prefixes are the tree's; the stem is the family's
      if (!Array.isArray(f.seg) || !f.seg.length) bad(`${fa}: no seg`);
      else {
        if (f.seg.map((/** @type {string[]} */ s) => s[1]).join('').toLowerCase() !== f.word.toLowerCase()) bad(`${fa}: seg does not spell ${f.word}`);
        for (const [k] of f.seg) if (!['p', 'r', 's', 'i', 'c', 'l'].includes(k)) bad(`${fa}: seg kind ${k}`);
        const rs = f.seg.filter((/** @type {string[]} */ s) => s[0] === 'r');
        if (rs.length !== 1) bad(`${fa}: seg needs one root part`);
        else if (!stems.includes(rs[0][1].toLowerCase())) bad(`${fa}: root part ${rs[0][1]} is not one of the stems ${fam.stems.join(', ')}`);
        if (f.side !== 'cmp' && f.seg[0][0] !== 'c') {
          const ps = f.seg.filter((/** @type {string[]} */ s) => s[0] === 'p').map((/** @type {string[]} */ s) => s[1].toLowerCase());
          if (ps.join('+') !== (f.pre || []).join('+')) bad(`${fa}: the prefix parts ${ps.join('+')} are not ${(f.pre || []).join('+')}`);
        }
        // stress: on a vowel, in a prefix, root or compound part
        if (!Number.isInteger(f.stress) || !VOWEL.test(f.word[f.stress] || '')) bad(`${fa}: stress ${f.stress} is not on a vowel`);
        else {
          let pos = 0, kind = '', text = '';
          for (const [k, t] of f.seg) { if (f.stress >= pos && f.stress < pos + t.length) { kind = k; text = t.toLowerCase(); } pos += t.length; }
          if (!['p', 'r', 'c'].includes(kind)) bad(`${fa}: stress on a ${kind} part`);
          if (f.cls === 'verb' && f.kind === 's' && kind !== 'p' && kind !== 'c') bad(`${fa}: a separable verb is stressed on its particle`);
          if (f.cls === 'verb' && kind === 'p' && UNSTRESSED.has(text)) bad(`${fa}: ${text}- is never stressed`);
          if (f.cls === 'verb' && f.kind === 'i' && kind === 'p' && text === f.pre[0] && f.pre.length === 1) bad(`${fa}: an inseparable verb is stressed on its stem`);
        }
      }
      // verbs: split or not, helper and participle
      if (f.cls === 'verb' && parent) {
        const outer = f.pre[0];
        if (f.side === 'pre' || (f.pre || []).length) {
          if (f.kind !== 's' && f.kind !== 'i') bad(`${fa}: a prefixed verb needs kind s or i`);
          const p = P.get(outer);
          if (outer && INSEP.has(outer) && f.kind !== 'i') bad(`${fa}: ${outer}- never splits`);
          if (p && p.kind === 's' && f.kind !== 's') bad(`${fa}: ${outer}- always splits`);
          if (p && p.kind === 'i' && f.kind !== 'i') bad(`${fa}: ${outer}- never splits`);
          const m = f.lemma ? morph[f.lemma] : null;
          if (m && typeof m.sep === 'boolean' && m.sep !== (f.kind === 's')) bad(`${fa}: the word list says ${f.lemma} ${m.sep ? 'splits' : 'stays on'}`);
        }
        if (!['hat', 'ist', 'hat/ist'].includes(f.aux)) bad(`${fa}: aux ${f.aux}`);
        if (!f.pp || !/^[a-zäöüß]+$/.test(f.pp)) bad(`${fa}: pp ${f.pp}`);
        else if (!outer) { /* a compound verb (blaumachen): no prefix to check */ }
        else if (f.kind === 's' && !f.pp.startsWith(outer)) bad(`${fa}: participle ${f.pp} does not start with ${outer}`);
        else if (f.kind === 'i' && !f.pp.startsWith(outer)) bad(`${fa}: participle ${f.pp} does not start with ${outer}`);
        else if (f.kind === 'i' && f.pre.length === 1 && /^ge/.test(f.pp.slice(outer.length)) && !/^ge/.test(fam.root)) bad(`${fa}: an inseparable verb takes no ge-: ${f.pp}`);
        else if (f.kind === 's' && f.pre.length === 1 && parent.parent == null && !f.ppWhy && f.pp !== outer + fam.pp) bad(`${fa}: participle ${f.pp}, expected ${outer + fam.pp}`);
      }
      // the word list agrees
      if (f.lemma) {
        const w = byId.get(f.lemma);
        if (!w) bad(`${fa}: lemma ${f.lemma} is not in the word list`);
        else {
          if (String(w.w).replace(/^sich\s+/, '') !== f.word && !(f.pl && w.w === f.word)) bad(`${fa}: lemma ${f.lemma} is ${w.w}`);
          if (f.cls === 'noun' && w.art && w.art !== f.art) bad(`${fa}: the word list says ${w.art} ${w.w}`);
          if (w.pos && f.cls !== w.pos && !(f.cls === 'adj' && w.pos === 'adv') && !(f.cls === 'adv' && w.pos === 'adj') && !(f.cls === 'adv' && w.pos === 'conj') && !(f.cls === 'prep' && ['adv', 'prep'].includes(w.pos))) bad(`${fa}: the word list says ${w.pos}`);
        }
      } else if (f.cls === 'noun') {
        for (const w of byW.get(f.word.toLowerCase()) || []) if (w.pos === 'noun' && w.w === f.word && w.art && w.art !== f.art && !f.note) bad(`${fa}: the word list has ${w.art} ${w.w} (say why in note)`);
      }
      // the article rule of its ending
      // a compound takes the article of its last part, which is not a family ending (das Fundbüro)
      const compound = f.side === 'cmp' || (Array.isArray(f.seg) && f.seg.some((/** @type {string[]} */ s) => s[0] === 'c'));
      if (f.cls === 'noun' && !f.adjNoun && !compound) {
        const last = [...(f.suf || [])].reverse().find((/** @type {string} */ s) => S.has(s) && S.get(s).cls === 'noun');
        const rule = last ? S.get(last) : null;
        if (rule && rule.art && rule.art !== f.art && !(rule.except || []).includes(f.word) && !(f.note && f.note.includes(`${f.art} ${f.word}`)))
          bad(`${fa}: is ${f.art}, but -${last} gives ${rule.art} (a note must name "${f.art} ${f.word}")`);
      }
      // meaning, clue, example
      for (const k of ['en', 'ex', 'exEn']) if (!f[k]) bad(`${fa}: ${k} is required`);
      for (const k of ['en', 'clue', 'exEn', 'why', 'note']) english(`${fa} ${k}`, f[k]);
      if (f.ex && !/[.!?]$/.test(f.ex)) bad(`${fa}: the example has no final punctuation`);
      if (f.ex && DASH.test(f.ex)) bad(`${fa}: a dash in the example`);
      if (f.ex && !exampleHolds(f, stems)) bad(`${fa}: the example does not hold ${f.word}${f.kind === 's' ? ' (separable: the particle at the end)' : ''}`);
      if (parent) {
        if (!f.clue) bad(`${fa}: a clue is required`);
        else {
          const k = f.clue.trim().toLowerCase();
          if (clues.has(k)) bad(`${fa}: clue "${f.clue}" is also ${clues.get(k)}'s`);
          clues.set(k, f.id);
          if (f.cls === 'verb' && !/^to /.test(f.clue)) bad(`${fa}: a verb clue starts with "to "`);
          if (f.cls === 'noun' && !/^(the|a|an) /.test(f.clue)) bad(`${fa}: a noun clue starts with "the", "a" or "an"`);
          if (toks(f.clue).includes(f.word.toLowerCase())) bad(`${fa}: the clue gives the word away`);
          if (f.clue.length > 64) bad(`${fa}: clue longer than 64 characters`);
        }
      }
      if (!['T', 'M', 'O'].includes(f.grade)) bad(`${fa}: grade ${f.grade}`);
      if ({ T: 'lit', M: 'pic', O: 'word' }[String(f.grade)] !== f.how && !(f.grade === 'M' && f.how === 'hist')) bad(`${fa}: how ${f.how} with grade ${f.grade}`);
      if (f.how === 'hist' && !f.src) bad(`${fa}: history needs a source (src)`);
      if (f.grade === 'O' && f.why && !/learn/i.test(f.why)) bad(`${fa}: a word to learn (O) has no why that claims the parts give the meaning`);
      if (!LEVELS.includes(f.level)) bad(`${fa}: level ${f.level}`);
      if (f.zipf != null && typeof f.zipf !== 'number') bad(`${fa}: zipf`);
      if (!Array.isArray(f.lex) || !(f.lex.includes('list') || f.lex.includes('dwds') || f.lex.includes('corpus'))) bad(`${fa}: found in no lexicon (the word list, a DWDS entry, or the DWDS corpora)`);
      // a board form must be one the tiles build: the game's rule (wordbuild-family.js tileKey), so the content's
      // boards and the live boards agree (un- and one prefix, a chain of endings; no verb with an ending)
      if (f.board && tileKey(f) !== f.key) bad(`${fa}: on a board, but the tiles cannot build ${f.key}`);
      if (f.board && (f.adjNoun || f.pl || f.side === 'cmp' || f.cls === 'adv' || f.cls === 'conj' || f.cls === 'prep' || (f.pre || []).filter((/** @type {string} */ p) => p !== 'un').length > 1)) bad(`${fa}: cannot be on a board`);
    }
    // keys of board forms: one form per key, but a dual verb's two readings share one
    /** @type {Map<string, any>} */ const keyed = new Map();
    for (const f of fam.forms) {
      if (!f.board) continue;
      const o = keyed.get(f.key);
      if (o && !(o.word === f.word && o.cls === 'verb' && o.kind !== f.kind)) bad(`${at}: ${f.id} and ${o.id} are both built ${f.key}`);
      keyed.set(f.key, f);
    }
    // non-words: checked, and in no lexicon
    const formKeys = new Set(fam.forms.map((/** @type {any} */ f) => f.key));
    const noneKeys = new Set();
    for (const n of fam.none || []) {
      const na = `${at} none ${n.word}`;
      if (!/^[a-zäöü]+(\+[a-zäöü]+)*\|[a-z+]*$/.test(String(n.key))) bad(`${na}: key ${n.key}`);
      if (formKeys.has(n.key)) bad(`${na}: ${n.key} is a form of the family`);
      noneKeys.add(n.key);
      const lw = String(n.word).toLowerCase();
      if (known.has(lw)) bad(`${na}: is a word the content knows`);
      if (morphWords.has(lw)) bad(`${na}: is in the word list's morphology`);
      if (!n.chk || n.chk.dwds !== false || n.chk.wf !== 0 || !(typeof n.chk.hits === 'number' && n.chk.hits <= NONE_MAX_HITS)) bad(`${na}: needs the recorded check (DWDS: no entry and at most ${NONE_MAX_HITS} corpus hits; wordfreq: 0 for every form)`);
    }
    const formWords = new Set(fam.forms.map((/** @type {any} */ f) => String(f.word)));
    for (const r of fam.rare || []) {
      if (noneKeys.has(r.key)) bad(`${at} rare ${r.word}: also in none`);
      // rare is "not in this family's list": a form is in it
      if (formKeys.has(r.key) || formWords.has(String(r.word))) bad(`${at} rare ${r.word}: is a form of the family (${r.key})`);
      if (!r.why) bad(`${at} rare ${r.word}: why is required`);
      english(`${at} rare ${r.word}`, r.en); english(`${at} rare ${r.word}`, r.why);
    }
    // boards (B1 and B2 in every shipped family, tests/unit/build-family.test.mjs; A2 when the family has 6 forms at A1 to B1)
    for (const [lv, b] of Object.entries(fam.boards || {})) {
      const ba = `${at} board ${lv}`;
      if (!BOARD_SIZE[lv]) { bad(`${ba}: unknown level`); continue; }
      const ids = b.words || [];
      if (ids.length !== BOARD_SIZE[lv]) bad(`${ba}: ${ids.length} words, expected ${BOARD_SIZE[lv]}`);
      if (new Set(ids).size !== ids.length) bad(`${ba}: a word twice`);
      if (!Array.isArray(b.light) || b.light.length !== Math.min(LIGHT_SIZE, ids.length) || b.light.some((/** @type {string} */ x) => !ids.includes(x))) bad(`${ba}: light is ${LIGHT_SIZE} of the board's words`);
      const tp = new Set((b.tiles && b.tiles.pre) || []), ts = new Set((b.tiles && b.tiles.suf) || []);
      if (tp.size > 12) bad(`${ba}: ${tp.size} prefix tiles (at most 12)`);
      for (const id of ids) {
        const f = F.get(id);
        if (!f) { bad(`${ba}: no form ${id}`); continue; }
        if (!f.board) bad(`${ba}: ${id} is not a board form`);
        if (LEVELS.indexOf(f.level) > LEVELS.indexOf(BOARD_MAX[lv])) bad(`${ba}: ${id} is ${f.level}`);
        if (f.rare && lv !== 'B2') bad(`${ba}: ${id} is rare`);
        for (const p of f.pre) if (!tp.has(p)) bad(`${ba}: no tile for ${p}- (${id})`);
        for (const s of f.suf) if (!ts.has(s)) bad(`${ba}: no tile for -${s} (${id})`);
      }
      const onBoard = new Set(ids.map((/** @type {string} */ id) => (F.get(id) || { pre: [] }).pre[0]));
      let nNone = 0;
      for (const d of b.distract || []) {
        if (!tp.has(d.pre)) bad(`${ba}: distractor ${d.pre} is not a tile`);
        if (onBoard.has(d.pre)) bad(`${ba}: distractor ${d.pre} is on the board`);
        if (d.is === 'none') { nNone++; if (!noneKeys.has(`${d.pre}|`)) bad(`${ba}: distractor ${d.pre}: ${d.pre}|${fam.root} is not a checked non-word`); }
        else if (d.is === 'extra') { if (!fam.forms.some((/** @type {any} */ f) => f.key === `${d.pre}|`)) bad(`${ba}: distractor ${d.pre}: no form ${d.pre}|`); }
        else bad(`${ba}: distractor ${d.pre}: is ${d.is}`);
      }
      const nd = (b.distract || []).length;
      if (lv === 'A2' && nd < 1) bad(`${ba}: one distractor`);
      if (lv === 'B1' && nNone < 1) bad(`${ba}: one checked non-word distractor`);
      if (lv === 'B2' && (nd < 2 || nNone < 1)) bad(`${ba}: two distractors, one a checked non-word`);
    }
  }
  return out;
}
