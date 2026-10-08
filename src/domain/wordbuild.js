/* Word building (Practice › Word building, src/features/build/): the content model, its validation, the card ids of
   deck 'build', word chains as trees and the sentence cards' gaps. Pure: no DOM, storage or clock; tested in node
   (tests/unit/build-*.test.mjs) and run by the content gate (tools/validate-content.mjs).

   The content file (content/build/de.json, built by tools/build-wordbuild.mjs from authoring/build/):
     prefixes  [{ id, kind: 's'|'i'|'d', ring: 'axis'|'path'|'lens'|'extra', pos?, glyph, alt, core, short, senses: [{en, ex}],
                  opp?, sep?, insep?, word? }]        s separable, i inseparable, d dual (both readings exist)
     roots     [{ id, lemma, en, obj, pres3, pret, aux, pp }]   the root verbs (stellen, legen …)
     verbs     [{ id, root, pre, inf, kind: 's'|'i', grade: 'T'|'M'|'O', how: 'lit'|'pic'|'hist'|'word', en, why, ex, exEn,
                  aux, pp, lemma, dual?, level, src? }]
               id: the infinitive without "sich", plus -s / -i for the two readings of a dual verb. Ids never change.
               grade T literal (prefix sense + root sense), M one figurative step (a picture, or documented history),
               O a word to learn. lemma: the word-list id, or null when the list has no entry for this reading.
     frames    [{ id, verb, inf, pre, inner?, kind, en, aux, pp, note?, stress?, pair?, forms: { pres|perf|sub|modal|zu: Tile[] } }]
               Tile = [key, text]; keys keep a tile's identity across forms, so a piece can move between frames:
               S subject, X finite helper (haben, sein, a modal, the verb of the main clause), O object, A adverbial,
               N nicht, C a weil/dass lead, R the verb (stem or the welded verb), P separable prefix, G ge-, Z zu,
               '.' the full stop.
     suffixes  [{ id, cls: 'noun'|'adj', art, from, label, rule, short, ex, except }]
     chains    [{ id, title, nodes: [{ id, from?, add?, side?: 'pre'|'suf', word, cls, art?, en, note?, rare?, lemma? }] }]
               a chain is a tree: every node grows from its parent by one prefix or one ending (or the Partizip II, 'pp').

   Card ids (deck 'build'; listed in tests/fixtures/shipped-ids.txt, never renamed):
     PX:<p>.see   the motion plays, tap the prefix                     item PX:<p>
     PX:<p>.say   say what the prefix does and whether it splits       item PX:<p>
     PD:<verb>    root + prefix → predict the meaning (self-graded)    item W:<lemma>, else PV:<verb>
     PV:<verb>    English → type the infinitive                        item W:<lemma>, else PV:<verb>
     PS:<frame>.<form>  type the verb pieces into the sentence         item as is
     SX:<suffix>  the ending → its article (or what it makes)          item as is
     PW:<word>    parent + ending → type the word (with its article)   item W:<id> when listed, else as is */

/** @typedef {'s'|'i'|'d'} PrefixKind */
/** @typedef {[string, string]} Tile */
/**
 * @typedef {object} Prefix
 * @property {string} id @property {PrefixKind} kind @property {'axis'|'path'|'lens'|'extra'} ring @property {number} [pos]
 * @property {string} glyph @property {string} alt @property {string} core @property {string} short
 * @property {{en: string, ex: string[]}[]} senses @property {[string, string][]} [opp] @property {string} [sep] @property {string} [insep] @property {string} [word]
 */
/** @typedef {{id: string, lemma: string, en: string, obj: string, pres3: string, pret: string, aux: string, pp: string}} Root */
/**
 * @typedef {object} Verb
 * @property {string} id @property {string} root @property {string} pre @property {string} inf @property {'s'|'i'} kind
 * @property {'T'|'M'|'O'} grade @property {'lit'|'pic'|'hist'|'word'} how @property {string} en @property {string} why
 * @property {string} ex @property {string} exEn @property {string} aux @property {string} pp @property {string | null} lemma
 * @property {string} [dual] @property {string} level @property {string} [src]
 */
/**
 * @typedef {object} Frame
 * @property {string} id @property {string | null} verb @property {string} inf @property {string} pre @property {string} [inner]
 * @property {'s'|'i'} kind @property {string} en @property {string} aux @property {string} pp @property {string} [note]
 * @property {string} [stress] @property {string} [pair] @property {Partial<Record<FormId, Tile[]>>} forms
 */
/** @typedef {'pres'|'perf'|'sub'|'modal'|'zu'} FormId */
/** @typedef {{id: string, cls: 'noun'|'adj', art: string | null, from: string, label: string, rule: string, short: string, ex: string, except: string[]}} Suffix */
/**
 * @typedef {object} ChainNode
 * @property {string} id @property {string} [from] @property {string} [add] @property {'pre'|'suf'} [side] @property {string} word
 * @property {'verb'|'noun'|'adj'} cls @property {string} [art] @property {string} en @property {string} [note] @property {boolean} [rare] @property {string | null} [lemma]
 * @property {string} [ex] @property {string} [exEn]
 */
/** @typedef {{id: string, title: string, nodes: ChainNode[]}} Chain */
/** @typedef {{version: number, prefixes: Prefix[], roots: Root[], verbs: Verb[], frames: Frame[], suffixes: Suffix[], chains: Chain[], particles?: any[], families?: any[]}} BuildContent */

import { validateFamilies, familyCardIds } from './wordbuild-family-check.js';
export { familyCardIds };

export const DECK = 'build';
/** The sentence frames, in teaching order. */
export const FORMS = /** @type {FormId[]} */ (['pres', 'perf', 'sub', 'modal', 'zu']);
/** Pictogram scenes (features/build/picto.js draws each). */
export const GLYPHS = ['up', 'down', 'in', 'out', 'front', 'behind', 'touch', 'shut', 'along', 'around', 'turn', 'over', 'under', 'through', 'target', 'deflect', 'remove', 'reach', 'shatter', 'miss', 'none'];
/** The prefixes learnt first, in order (opposites together); the rest open after them (wordbuild-plan.js). */
export const CORE = ['auf', 'ab', 'ein', 'aus', 'vor', 'nach', 'an', 'zu', 'be', 'ver'];
const TILE_KEYS = new Set(['S', 'X', 'O', 'A', 'N', 'C', 'R', 'P', 'G', 'Z', '.']);
const AUX_FORMS = /** @type {Record<string, string[]>} */ ({ hat: ['habe', 'hast', 'hat', 'haben', 'habt'], ist: ['bin', 'bist', 'ist', 'sind', 'seid'] });
const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
const INSEP = new Set(['be', 'emp', 'ent', 'er', 'ge', 'miss', 'ver', 'zer', 'wider']);
const DUAL = new Set(['durch', 'über', 'um', 'unter', 'wider', 'wieder']);
const DASH = /[–—]/;

/** The infinitive without "sich ". @param {string} inf */
export const bare = inf => String(inf).replace(/^sich\s+/, '');
/** Whether the verb is reflexive (its infinitive carries "sich"). @param {{inf: string}} v */
export const isReflexive = v => /^sich\s/.test(v.inf);

/**
 * One frame form as authored ("S:Ich | R:stehe | A:um sieben | P:auf | .") → tiles.
 * @param {string} s @returns {Tile[]}
 */
export function parseForm(s) {
  return String(s).split('|').map(x => x.trim()).filter(Boolean).map(x => {
    if (/^[.!?]$/.test(x)) return /** @type {Tile} */ (['.', x]);
    const m = /^([A-Z]):(.+)$/.exec(x);
    if (!m) throw new Error(`frame tile "${x}" has no key`);
    return /** @type {Tile} */ ([m[1], m[2].trim()]);
  });
}

/** The sentence a form spells, with German spacing. @param {Tile[]} tiles @param {'s'|'i'} kind */
export function sentenceOf(tiles, kind) {
  let out = '';
  tiles.forEach(([k, text], i) => {
    const prev = tiles[i - 1];
    const glue = !prev || k === '.' || (kind === 's' && VERBISH.has(k) && VERBISH.has(prev[0]) && k !== 'P');
    out += (glue ? '' : ' ') + text;
  });
  return out;
}
const VERBISH = new Set(['R', 'P', 'G', 'Z']);

/**
 * The sentence card of a form: the sentence with gaps where the verb pieces go, and the answer typed into them, in
 * order. Perfekt also asks for the helper (haben or sein); the other forms ask for the verb pieces. Pieces of one
 * separable verb that touch are one gap (auf|ge|standen → "aufgestanden").
 * @param {Frame} f @param {FormId} form
 * @returns {{parts: ({gap: true} | {text: string})[], answer: string, pieces: string[]}}
 */
export function gapped(f, form) {
  const toks = f.forms[form] || [];
  const gapKeys = new Set(form === 'perf' ? ['X', 'R', 'P', 'G'] : ['R', 'P', 'G', 'Z']);
  /** @type {({gap: true} | {text: string})[]} */ const parts = [];
  /** @type {string[][]} */ const answer = [];
  /** @type {string[] | null} */ let cur = null;
  toks.forEach(([k, text], i) => {
    if (gapKeys.has(k)) {
      const prev = toks[i - 1];
      const glue = f.kind === 's' && cur && VERBISH.has(k) && prev && VERBISH.has(prev[0]) && k !== 'P';
      if (cur && glue) cur.push(text);
      else if (cur && prev && gapKeys.has(prev[0])) { cur.push(` ${text}`); }
      else { cur = [text]; parts.push({ gap: true }); answer.push(cur); }
    } else { cur = null; parts.push({ text }); }
  });
  const pieces = answer.map(a => a.join('').trim());
  return { parts, answer: pieces.join(' '), pieces };
}

/** Card ids of the content, in the order the deck introduces them by kind. @param {BuildContent} c */
export function cardIds(c) {
  /** @type {string[]} */ const out = [];
  for (const p of c.prefixes) { if (hasSee(p)) out.push(`PX:${p.id}.see`); out.push(`PX:${p.id}.say`); }
  for (const v of c.verbs) out.push(`PD:${v.id}`, `PV:${v.id}`);
  for (const f of c.frames) for (const form of FORMS) if (f.forms[form]) out.push(`PS:${f.id}.${form}`);
  for (const s of c.suffixes) out.push(`SX:${s.id}`);
  for (const w of pwNodes(c)) out.push(`PW:${w.word}`);
  return [...new Set(out)];
}

/** A prefix has a motion card when it sits on the compass and has a picture. @param {Prefix} p */
export const hasSee = p => p.ring !== 'extra' && p.glyph !== 'none';

/** Chain nodes that are PW cards: everything grown by an ending (one card per word). @param {BuildContent} c */
export function pwNodes(c) {
  /** @type {Map<string, ChainNode & {chain: string}>} */ const by = new Map();
  for (const ch of c.chains) for (const n of ch.nodes) if (n.from && n.side === 'suf' && !by.has(n.word)) by.set(n.word, { ...n, chain: ch.id });
  return [...by.values()];
}

/**
 * Card id → knowledge item id for deck 'build' (data/knowledge.js passes this to domain/knowledge.js resolver()).
 * @param {{verbLemma?: Record<string, string>, wordLemma?: Record<string, string>}} maps verb id → word id, PW word → word id
 * @returns {(id: string) => string | null}
 */
export function itemResolver({ verbLemma = {}, wordLemma = {} } = {}) {
  return id => {
    const s = String(id || '');
    let m = /^PX:([^.]+)\.(see|say)$/.exec(s);
    if (m) return `PX:${m[1]}`;
    m = /^P[DV]:(.+)$/.exec(s);
    if (m) return verbLemma[m[1]] ? `W:${verbLemma[m[1]]}` : `PV:${m[1]}`;
    m = /^PW:(.+)$/.exec(s);
    if (m) return wordLemma[m[1]] ? `W:${wordLemma[m[1]]}` : s;
    if (/^(PS|SX):./.test(s)) return s;
    return null;
  };
}

/** The resolver maps of the content. @param {BuildContent} c */
export function lemmaMaps(c) {
  /** @type {Record<string, string>} */ const verbLemma = {};
  /** @type {Record<string, string>} */ const wordLemma = {};
  for (const v of c.verbs) if (v.lemma) verbLemma[v.id] = v.lemma;
  for (const n of pwNodes(c)) if (n.lemma) wordLemma[n.word] = n.lemma;
  return { verbLemma, wordLemma };
}

/**
 * The items of a prefix's concept score (knowledge.concept): its prefix card and its verbs.
 * @param {BuildContent} c @param {string} p @param {(id: string) => string | null} resolve
 */
export function conceptItems(c, p, resolve) {
  return [`PX:${p}`, ...c.verbs.filter(v => v.pre === p).map(v => resolve(`PD:${v.id}`)).filter(/** @returns {x is string} */ x => !!x)];
}

/* ------------------------------------------------------------------ chains as trees */

/**
 * @typedef {object} TreeNode
 * @property {ChainNode} node @property {number} depth @property {TreeNode[]} kids @property {TreeNode | null} parent
 */
/**
 * The chain as a tree, depth first (each node, then its children in content order). Throws on a broken chain (a node
 * whose parent is missing or comes later, two roots, a cycle): validateBuild reports those first.
 * @param {Chain} chain @returns {{root: TreeNode, order: TreeNode[], byId: Map<string, TreeNode>}}
 */
export function chainTree(chain) {
  /** @type {Map<string, TreeNode>} */ const byId = new Map();
  /** @type {TreeNode | null} */ let root = null;
  for (const n of chain.nodes) {
    if (byId.has(n.id)) throw new Error(`chain ${chain.id}: node ${n.id} twice`);
    const parent = n.from ? byId.get(n.from) : null;
    if (n.from && !parent) throw new Error(`chain ${chain.id}: ${n.id} grows from ${n.from}, which is not before it`);
    if (!n.from && root) throw new Error(`chain ${chain.id}: two roots`);
    const t = { node: n, depth: parent ? parent.depth + 1 : 0, kids: /** @type {TreeNode[]} */ ([]), parent: parent || null };
    if (parent) parent.kids.push(t); else root = t;
    byId.set(n.id, t);
  }
  if (!root) throw new Error(`chain ${chain.id}: no root`);
  /** @type {TreeNode[]} */ const order = [];
  const walk = (/** @type {TreeNode} */ t) => { order.push(t); t.kids.forEach(walk); };
  walk(root);
  return { root, order, byId };
}

/**
 * The word split into the parent part and the piece this node added, for drawing ("Vorstell" + "ung", "un" +
 * "vorstellbar"). A stem noun, an infinitive noun or a participle has no single added piece: the whole word.
 * @param {ChainNode} n @returns {{before: string, add: string, after: string}}
 */
export function pieces(n) {
  const w = n.word;
  if (!n.add || !n.side) return { before: w, add: '', after: '' };
  if (n.side === 'pre') return w.toLowerCase().startsWith(n.add.toLowerCase()) ? { before: '', add: w.slice(0, n.add.length), after: w.slice(n.add.length) } : { before: w, add: '', after: '' };
  const end = SUFFIX_TEXT[n.add];
  if (!end) return { before: w, add: '', after: '' };
  const hit = end.find(e => w.toLowerCase().endsWith(e));
  return hit ? { before: w.slice(0, w.length - hit.length), add: w.slice(w.length - hit.length), after: '' } : { before: w, add: '', after: '' };
}
/** The written endings of each suffix rule (for pieces() and the validator). */
export const SUFFIX_TEXT = /** @type {Record<string, string[]>} */ ({ ung: ['ung'], heit: ['heit'], keit: ['keit'], schaft: ['schaft'], nis: ['nis'], er: ['er'], in: ['in'],
  e: ['e'], t: ['ft', 't'], bar: ['bar'], lich: ['lich'], sam: ['sam'], ig: ['ig'] });

/** What a node's card asks: "vorstellen + -ung". @param {ChainNode} n @param {ChainNode} parent @param {Suffix | undefined} rule */
export function pwPrompt(n, parent, rule) {
  const label = n.add === 'pp' ? 'Partizip II' : rule ? rule.label : `-${n.add}`;
  return `${parent.art ? `${parent.art} ` : ''}${parent.word} + ${label}`;
}
/** The answer of a PW card: the noun with its article, or the word. @param {ChainNode} n */
export const pwAnswer = n => (n.art ? `${n.art} ${n.word}` : n.word);

/* ------------------------------------------------------------------ validation */

/**
 * Everything the content must satisfy beyond its JSON Schema (the rules of PREFIX-DESIGN §4-7).
 * @param {BuildContent} c
 * @param {{words?: any[], morph?: Record<string, any>, clusterSuffixes?: {id: string, art?: string | null}[]}} [ctx]
 *   words: the German word list; morph: clusters.de morph (sep of listed verbs); clusterSuffixes: clusters.de suffixes
 * @returns {string[]} problems, empty when valid
 */
export function validateBuild(c, { words = [], morph = {}, clusterSuffixes = [] } = {}) {
  /** @type {string[]} */ const out = [];
  const bad = (/** @type {string} */ m) => { if (out.length < 300) out.push(m); };
  const byWord = new Map(words.map(w => [w.id, w]));
  const english = (/** @type {string} */ where, /** @type {any} */ s) => { if (typeof s === 'string' && DASH.test(s)) bad(`${where}: no en or em dashes in English text`); };
  // prefixes
  const P = new Map();
  for (const p of c.prefixes || []) {
    if (P.has(p.id)) bad(`prefix ${p.id}: twice`);
    P.set(p.id, p);
    if (!['s', 'i', 'd'].includes(p.kind)) bad(`prefix ${p.id}: kind ${p.kind}`);
    if (p.kind === 's' && INSEP.has(p.id)) bad(`prefix ${p.id}: ${p.id}- never separates`);
    if (p.kind === 'i' && !INSEP.has(p.id)) bad(`prefix ${p.id}: marked inseparable`);
    if (p.kind === 'd' && !DUAL.has(p.id)) bad(`prefix ${p.id}: not a dual prefix`);
    if (p.kind === 'd' && (!p.sep || !p.insep)) bad(`prefix ${p.id}: a dual prefix needs both readings (sep, insep)`);
    if (!['axis', 'path', 'lens', 'extra'].includes(p.ring)) bad(`prefix ${p.id}: ring ${p.ring}`);
    if (p.ring === 'axis' && !(Number.isInteger(p.pos) && /** @type {number} */ (p.pos) % 45 === 0)) bad(`prefix ${p.id}: an axis prefix needs pos (a multiple of 45)`);
    if (!GLYPHS.includes(p.glyph)) bad(`prefix ${p.id}: unknown glyph ${p.glyph}`);
    if (!p.alt) bad(`prefix ${p.id}: no alt text for its motion`);
    if (!p.core || !p.short) bad(`prefix ${p.id}: core and short are required`);
    for (const k of /** @type {const} */ (['core', 'short', 'alt', 'sep', 'insep', 'word'])) english(`prefix ${p.id} ${k}`, p[k]);
    for (const s of p.senses || []) english(`prefix ${p.id} sense`, s.en);
    for (const [o] of p.opp || []) if (!(c.prefixes || []).some(q => q.id === o)) bad(`prefix ${p.id}: opposite ${o} is not a prefix`);
  }
  const axis = (c.prefixes || []).filter(p => p.ring === 'axis').map(p => p.pos);
  if (new Set(axis).size !== axis.length) bad('prefixes: two axis prefixes share a compass position');
  // roots
  const R = new Map();
  for (const r of c.roots || []) {
    if (R.has(r.id)) bad(`root ${r.id}: twice`);
    R.set(r.id, r);
    if (words.length && !byWord.has(r.lemma)) bad(`root ${r.id}: lemma ${r.lemma} is not in the word list`);
    if (!['hat', 'ist', 'hat/ist'].includes(r.aux)) bad(`root ${r.id}: aux ${r.aux}`);
    if (!/^ge/.test(r.pp)) bad(`root ${r.id}: participle ${r.pp} has no ge-`);
  }
  // verbs
  const V = new Map();
  for (const v of c.verbs || []) {
    const at = `verb ${v.id}`;
    if (V.has(v.id)) bad(`${at}: twice`);
    V.set(v.id, v);
    const r = R.get(v.root), p = P.get(v.pre);
    if (!r) { bad(`${at}: unknown root ${v.root}`); continue; }
    if (!p) { bad(`${at}: unknown prefix ${v.pre}`); continue; }
    if (bare(v.inf) !== v.pre + v.root) bad(`${at}: ${v.inf} is not ${v.pre} + ${v.root}`);
    const idBase = v.id.replace(/-[si]$/, '');
    if (idBase !== bare(v.inf)) bad(`${at}: the id must be the infinitive (without sich), plus -s/-i for a dual reading`);
    if (v.kind !== 's' && v.kind !== 'i') bad(`${at}: kind ${v.kind}`);
    if (p.kind === 's' && v.kind !== 's') bad(`${at}: ${v.pre}- always splits`);
    if (p.kind === 'i' && v.kind !== 'i') bad(`${at}: ${v.pre}- never splits`);
    if (!['T', 'M', 'O'].includes(v.grade)) bad(`${at}: grade ${v.grade}`);
    if (!['lit', 'pic', 'hist', 'word'].includes(v.how)) bad(`${at}: how ${v.how}`);
    if (v.grade === 'O' && v.how !== 'word') bad(`${at}: a word to learn (O) has how: word`);
    if (v.grade === 'T' && v.how !== 'lit') bad(`${at}: a literal verb (T) has how: lit`);
    if (v.grade === 'M' && v.how !== 'pic' && v.how !== 'hist') bad(`${at}: a picture verb (M) has how: pic or hist`);
    if (v.how === 'hist' && !v.src) bad(`${at}: history needs a source (src)`);
    // the participle: separable → prefix + the root's participle (auf + gestanden); inseparable → no ge-
    // (be + stellt; ver + geben; ge + fallen)
    const want = v.kind === 's' ? v.pre + r.pp : v.pre + r.pp.replace(/^ge/, '');
    if (v.pp !== want) bad(`${at}: participle ${v.pp}, expected ${want}`);
    if (!['hat', 'ist'].includes(v.aux)) bad(`${at}: aux ${v.aux}`);
    if (!LEVELS.includes(v.level)) bad(`${at}: level ${v.level}`);
    for (const k of /** @type {const} */ (['en', 'why', 'exEn'])) { if (!v[k]) bad(`${at}: ${k} is required`); english(`${at} ${k}`, v[k]); }
    // the example: a separable verb shows its particle on its own (Ich stelle … ab.), an inseparable one never splits
    if (v.kind === 's' && !splitIn(v.ex, v)) bad(`${at}: the example does not show ${v.pre} split off or as one infinitive`);
    if (v.kind === 'i' && !new RegExp(`(^|[^\\p{L}])${v.pre}\\p{L}`, 'iu').test(v.ex)) bad(`${at}: the example does not use the welded verb`);
    if (!/[.!?]$/.test(v.ex)) bad(`${at}: the example has no final punctuation`);
    if (v.lemma != null) {
      const w = byWord.get(v.lemma);
      if (words.length && !w) bad(`${at}: lemma ${v.lemma} is not in the word list`);
      if (w && w.pos !== 'verb') bad(`${at}: lemma ${v.lemma} is not a verb`);
      if (w && bare(w.w) !== bare(v.inf)) bad(`${at}: lemma ${v.lemma} is ${w.w}`);
      const m = morph[v.lemma];
      if (m && typeof m.sep === 'boolean' && m.sep !== (v.kind === 's')) bad(`${at}: the word list says ${v.lemma} ${m.sep ? 'splits' : 'stays on'}`);
    }
  }
  for (const v of c.verbs || []) {
    const d = v.dual ? V.get(v.dual) : null;
    if (v.dual && !d) bad(`verb ${v.id}: its other reading ${v.dual} is missing`);
    if (d && (d.dual !== v.id || d.kind === v.kind || d.inf !== v.inf)) bad(`verb ${v.id}: ${v.dual} must be the other reading of the same verb`);
    if (/-[si]$/.test(v.id) && !v.dual) bad(`verb ${v.id}: a reading id without its pair`);
    if (v.dual && !new RegExp(`-${v.kind}$`).test(v.id)) bad(`verb ${v.id}: the reading id ends in -${v.kind}`);
  }
  // frames
  const F = new Set();
  for (const f of c.frames || []) {
    const at = `frame ${f.id}`;
    if (F.has(f.id)) bad(`${at}: twice`);
    F.add(f.id);
    if (!f.forms || !f.forms.pres) bad(`${at}: no present`);
    if (!f.forms || !f.forms.perf) bad(`${at}: no Perfekt`);
    const v = f.verb ? V.get(f.verb) : null;
    if (f.verb && !v) bad(`${at}: unknown verb ${f.verb}`);
    if (v && (v.kind !== f.kind || v.pp !== f.pp || v.aux !== f.aux || bare(v.inf) !== bare(f.inf))) bad(`${at}: does not agree with verb ${v.id}`);
    if (f.pair && !(c.frames || []).some(g => g.id === f.pair && g.pair === f.id)) bad(`${at}: pair ${f.pair} does not point back`);
    const inf = bare(f.inf);
    if (!inf.startsWith(f.pre)) bad(`${at}: ${inf} does not start with ${f.pre}`);
    const rest = inf.slice(f.pre.length);
    for (const form of /** @type {FormId[]} */ (Object.keys(f.forms || {}))) {
      const tiles = /** @type {Tile[]} */ (f.forms[form]), fa = `${at} ${form}`;
      if (!FORMS.includes(form)) { bad(`${fa}: unknown form`); continue; }
      const keys = tiles.map(t => t[0]);
      for (const k of keys) if (!TILE_KEYS.has(k)) bad(`${fa}: unknown tile key ${k}`);
      if (new Set(keys).size !== keys.length) bad(`${fa}: a tile key twice (tiles keep their identity)`);
      if (keys[keys.length - 1] !== '.') bad(`${fa}: no final punctuation`);
      const get = (/** @type {string} */ k) => (tiles.find(t => t[0] === k) || [k, ''])[1];
      if (!keys.includes('R')) { bad(`${fa}: no verb`); continue; }
      if (f.kind === 's') {
        if (!keys.includes('P')) bad(`${fa}: a separable frame shows its prefix`);
        if (get('P') !== f.pre) bad(`${fa}: the prefix tile is ${get('P')}`);
        if (keys.includes('G') !== (form === 'perf' && !f.inner)) bad(`${fa}: ge- only in the Perfekt, and never after a welded inner prefix`);
      } else {
        if (keys.includes('P') || keys.includes('G')) bad(`${fa}: an inseparable verb never splits and has no ge-`);
        if (!get('R').toLowerCase().startsWith(f.pre)) bad(`${fa}: the verb is not welded to ${f.pre}-`);
      }
      if (f.inner && !get('R').startsWith(f.inner)) bad(`${fa}: the inner prefix ${f.inner}- stays on the stem`);
      if (keys.includes('Z') !== (form === 'zu')) bad(`${fa}: zu only in the zu form`);
      const joined = f.kind === 's' ? get('P') + get('G') + get('R') : get('R');
      if (form === 'perf') {
        if (joined !== f.pp) bad(`${fa}: the participle reads ${joined}, expected ${f.pp}`);
        const aux = get('X').split(/\s+/)[0].replace(/,$/, '');
        if (!(AUX_FORMS[f.aux] || []).includes(aux)) bad(`${fa}: helper ${aux} is not a form of ${f.aux === 'ist' ? 'sein' : 'haben'}`);
      }
      if (form === 'modal' && joined !== inf) bad(`${fa}: the infinitive reads ${joined}`);
      if (form === 'zu') {
        const zu = f.kind === 's' ? get('P') + get('Z') + get('R') : `${get('Z')} ${get('R')}`;
        const want = f.kind === 's' ? `${f.pre}zu${rest}` : `zu ${inf}`;
        if (zu !== want) bad(`${fa}: reads ${zu}, expected ${want}`);
      }
      if (form === 'sub' || form === 'zu') {
        const last = keys.filter(k => k !== '.').pop();
        if (last !== 'R') bad(`${fa}: the verb goes to the end`);
      }
      if (form === 'sub' && keys[0] !== 'C') bad(`${fa}: starts with weil or dass`);
      if (form === 'pres' && f.kind === 's' && keys.filter(k => k !== '.').pop() !== 'P') bad(`${fa}: the prefix goes to the end`);
      if ((form === 'pres') && keys.indexOf('R') !== 1) bad(`${fa}: the verb is in position 2`);
      if ((form === 'perf' || form === 'modal') && keys.indexOf('X') !== 1) bad(`${fa}: the helper is in position 2`);
      for (const [, text] of tiles) if (DASH.test(text)) bad(`${fa}: a dash in German text`);
    }
    if (f.forms && f.forms.pres && f.forms.sub && f.kind === 's') {
      const get = (/** @type {Tile[]} */ t, /** @type {string} */ k) => (t.find(x => x[0] === k) || [k, ''])[1];
      const p = f.forms.pres, s = f.forms.sub;
      if (get(s, 'P') + get(s, 'R') !== f.pre + get(p, 'R')) bad(`${at} sub: the verb reads ${get(s, 'P') + get(s, 'R')}, expected ${f.pre + get(p, 'R')}`);
    }
    english(`${at} en`, f.en); english(`${at} note`, f.note);
  }
  // suffixes
  const S = new Map();
  const cs = new Map(clusterSuffixes.map(s => [s.id, s]));
  for (const s of c.suffixes || []) {
    if (S.has(s.id)) bad(`suffix ${s.id}: twice`);
    S.set(s.id, s);
    if (s.cls === 'noun' && !['der', 'die', 'das'].includes(String(s.art))) bad(`suffix ${s.id}: a noun ending needs der, die or das`);
    if (s.cls === 'adj' && s.art != null) bad(`suffix ${s.id}: an adjective ending has no article`);
    const other = cs.get(s.id);
    if (other && other.art && s.art && other.art !== s.art) bad(`suffix ${s.id}: clusters.de says ${other.art}`);
    for (const k of /** @type {const} */ (['rule', 'short', 'label', 'from'])) { if (!s[k]) bad(`suffix ${s.id}: ${k} is required`); english(`suffix ${s.id} ${k}`, s[k]); }
  }
  // chains
  /** @type {Map<string, ChainNode>} */ const seenWord = new Map();
  const Cids = new Set();
  for (const ch of c.chains || []) {
    const at = `chain ${ch.id}`;
    if (Cids.has(ch.id)) bad(`${at}: twice`);
    Cids.add(ch.id);
    let tree;
    try { tree = chainTree(ch); } catch (e) { bad(/** @type {Error} */ (e).message); continue; }
    if (ch.nodes.length < 2) bad(`${at}: a chain needs at least one step`);
    for (const t of tree.order) {
      const n = t.node, na = `${at} ${n.id} ${n.word}`;
      english(`${na} en`, n.en); english(`${na} note`, n.note);
      if (n.cls === 'noun' ? !/^\p{Lu}/u.test(n.word) : /^\p{Lu}/u.test(n.word)) bad(`${na}: ${n.cls === 'noun' ? 'nouns take a capital' : 'only nouns take a capital'}`);
      if (n.cls === 'noun' && !['der', 'die', 'das'].includes(String(n.art))) bad(`${na}: a noun needs its article`);
      if (n.cls !== 'noun' && n.art) bad(`${na}: only nouns have an article`);
      if (!t.parent) continue;
      // every grown word has an example (round 7: the family view and the game show it)
      if (!n.ex || !n.exEn) bad(`${na}: an example (ex, exEn) is required`);
      else { if (!/[.!?]$/.test(n.ex)) bad(`${na}: the example has no final punctuation`); if (DASH.test(n.ex)) bad(`${na}: a dash in the example`); english(`${na} exEn`, n.exEn); }
      if (n.side === 'pre') {
        if (!(P.has(n.add) || n.add === 'un')) bad(`${na}: unknown prefix ${n.add}`);
        if (!n.word.toLowerCase().startsWith(String(n.add)) || n.word.toLowerCase() !== String(n.add) + t.parent.node.word.toLowerCase()) bad(`${na}: is not ${n.add} + ${t.parent.node.word}`);
        if (n.cls !== t.parent.node.cls) bad(`${na}: a prefix keeps the word type`);
      } else if (n.side === 'suf') {
        if (n.add === 'pp') { if (n.cls !== 'adj') bad(`${na}: a participle used as an adjective`); continue; }
        const rule = S.get(n.add);
        if (!rule) { bad(`${na}: unknown ending ${n.add}`); continue; }
        if (rule.cls !== n.cls) bad(`${na}: -${n.add} makes a ${rule.cls}`);
        if (n.art && rule.art && n.art !== rule.art && !rule.except.includes(n.word)) bad(`${na}: is ${n.art}, but -${n.add} gives ${rule.art} (add it to except)`);
        if (n.art && rule.except.includes(n.word) && n.art === rule.art) bad(`${na}: listed as an exception but follows the rule`);
        const ends = SUFFIX_TEXT[String(n.add)];
        if (ends && !ends.some(e => n.word.toLowerCase().endsWith(e))) bad(`${na}: does not end in -${n.add}`);
        if (n.add === 'inf' && n.word !== t.parent.node.word.charAt(0).toUpperCase() + t.parent.node.word.slice(1)) bad(`${na}: the infinitive noun is the verb with a capital`);
      } else bad(`${na}: side must be pre or suf`);
      const prev = seenWord.get(n.word);
      if (prev && (prev.art !== n.art || prev.cls !== n.cls)) bad(`${na}: differs from the same word in another chain`);
      seenWord.set(n.word, n);
      if (n.lemma && words.length) {
        const w = byWord.get(n.lemma);
        if (!w) bad(`${na}: lemma ${n.lemma} is not in the word list`);
        else if (w.w !== n.word || (n.art && w.art !== n.art)) bad(`${na}: lemma ${n.lemma} is ${w.art ? `${w.art} ` : ''}${w.w}`);
      }
    }
  }
  // a word in the word list with the same spelling and another article (die Vorstellung vs der …)
  if (words.length) for (const n of pwNodes(c)) for (const w of words) if (w.pos === 'noun' && w.w === n.word && n.art && w.art !== n.art) bad(`chain word ${n.word}: the word list says ${w.art}`);
  // word families (round 7, content/build/FAMILY-SCHEMA.md)
  if (c.families || c.particles) for (const e of validateFamilies(c, { words, morph })) bad(e);
  return out;
}

/** A separable example splits the particle off (… stelle das Rad ab.) or keeps it as one infinitive or zu form. @param {string} ex @param {Verb} v */
function splitIn(ex, v) {
  const p = v.pre;
  if (new RegExp(`(^|\\s)${p}[.!?,]`, 'u').test(ex)) return true;
  const inf = bare(v.inf), rest = inf.slice(p.length);
  return new RegExp(`(^|\\s)(${inf}|${p}zu${rest}|${v.pp})[.!?,\\s]`, 'u').test(ex);
}

/**
 * Fill a node's word-list id (PW → W:) where the list has the same word (and article): the build tool stores it.
 * @param {ChainNode} n @param {Map<string, any[]>} byW word-list entries by their written form
 */
export function lemmaFor(n, byW) {
  const hits = (byW.get(n.word) || []).filter(w => (n.cls === 'noun' ? w.pos === 'noun' && w.art === n.art : n.cls === 'adj' ? w.pos === 'adj' || w.pos === 'adv' : w.pos === 'verb'));
  return hits.length === 1 ? hits[0].id : null;
}
