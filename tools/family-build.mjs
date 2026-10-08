// Word families (round 7, content/build/FAMILY-SCHEMA.md): builds `particles` and `families` of content/build/de.json
// from authoring/build/particles.de.json and authoring/build/families/<root>.json. Called by tools/build-wordbuild.mjs.
//
// An authored form is either a pointer to content that already exists, which the build fills in so the two can never
// disagree:
//   { "id": "abstellen.verb", "verb": "abstellen", "clue": "…" }            a verbs[] verb (card PV:abstellen)
//   { "id": "die_Ausstellung", "chain": "stellen/n2", "clue": "…" }         a chain node (card PW:Ausstellung for an ending)
// or a new form with its own fields (card PF:<id>). The build derives what a rule gives: pre/suf from the tree, key,
// seg (the written parts), stress (the stressed vowel), how (from grade), zipf and level from the word list, lex (where
// the form was found: the word list, and DWDS and wordfreq from authoring/build/family-lexcheck.de.json).
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { SUFFIX_TEXT, bare } from '../src/domain/wordbuild.js';

/** Unstressed inseparable prefixes (never carry the stress of a verb). */
const UNSTRESSED = new Set(['be', 'ge', 'er', 'ver', 'zer', 'ent', 'emp']);
/** Prefixes that are stressed in a noun made from the bare stem (der Missbrauch, der Unterschied) but not in their verb. */
const VERB_ONLY_UNSTRESSED = new Set(['miss', 'über', 'unter', 'um', 'durch', 'wider', 'wieder', 'hinter', 'voll']);
/** Where the stress sits inside a particle of more than one syllable. */
const PARTICLE_STRESS = /** @type {Record<string, string>} */ ({
  heraus: 'aus', herein: 'ein', hervor: 'vor', herab: 'ab', herauf: 'auf', heran: 'an', herunter: 'un', herüber: 'ü', herbei: 'bei',
  hinaus: 'aus', hinein: 'ein', hinweg: 'weg', hinzu: 'zu', hinunter: 'un', hinauf: 'auf', zurück: 'rück', zusammen: 'sam',
  voraus: 'aus', vorbei: 'bei', voran: 'an', vorweg: 'weg', entgegen: 'ge', zurecht: 'recht', überein: 'ein', wieder: 'wie',
  hinter: 'hin', über: 'ü', unter: 'un', wider: 'wi', weiter: 'wei', durch: 'durch', empor: 'por', nieder: 'nie', davon: 'von',
  dazu: 'zu', daran: 'an', darauf: 'auf', vorüber: 'ü', umher: 'her', zuvor: 'vor', vorher: 'her',
});
const VOWEL = /[aeiouäöüy]/i;
/** Endings that are not in suffixes[] but appear in family words. */
export const EXTRA_SUFFIX_TEXT = /** @type {Record<string, string[]>} */ ({ ppr: ['end'], isch: ['isch'], los: ['los'], s: ['s'], ling: ['ling'] });
const SUFFIX_IDS_ALL = () => ({ ...SUFFIX_TEXT, ...EXTRA_SUFFIX_TEXT });

/** The first vowel at or after i (a diphthong is marked at its first letter). @param {string} w @param {number} i */
const vowelFrom = (w, i) => { for (let k = i; k < w.length; k++) if (VOWEL.test(w[k])) return k; return -1; };

/**
 * The written parts of a word ([kind, text]; kinds p prefix, r root stem, s ending, i inflection, c compound, l link).
 * Null when the rule cannot split it (the author then writes seg).
 * @param {{word: string, cls: string, pre: string[], suf: string[], adjNoun?: boolean, pl?: boolean, side?: string}} f
 * @param {string[]} stems
 * @returns {[string, string][] | null}
 */
export function segOf(f, stems) {
  if (f.side === 'cmp') return null;
  const w = f.word, low = w.toLowerCase(), st = stems.map(s => s.toLowerCase());
  /** @type {[string, string][]} */ const head = [];
  let pos = 0;
  for (const p of f.pre) {
    if (!low.startsWith(p, pos)) return null;
    head.push(['p', w.slice(pos, pos + p.length)]); pos += p.length;
  }
  let end = low.length;
  /** @type {[string, string][]} */ const tail = [];
  const take = (/** @type {string} */ kind, /** @type {string} */ t) => { tail.unshift([kind, w.slice(end - t.length, end)]); end -= t.length; };
  const ends = (/** @type {string} */ t) => end - t.length >= pos && low.slice(end - t.length, end) === t;
  if (f.cls === 'verb') { if (ends('en')) take('i', 'en'); else if (ends('n')) take('i', 'n'); else return null; }
  if (f.pl) { if (ends('en')) take('i', 'en'); else if (ends('n')) take('i', 'n'); }
  if (f.adjNoun && ends('e')) take('i', 'e');
  let fused = null;
  const T = SUFFIX_IDS_ALL();
  for (const s of [...f.suf].reverse()) {
    if (s === 'stem') continue;
    if (s === 'pp') { if (ends('en')) take('i', 'en'); else if (ends('t')) take('i', 't'); else return null; continue; }
    if (s === 'inf') { if (ends('en')) take('s', 'en'); else if (ends('n')) take('s', 'n'); else return null; continue; }
    const t = (T[s] || []).find(ends);
    if (!t) return null;
    take('s', t);
    fused = t;
  }
  // a participle keeps its ge- after a separable prefix or on a simple verb (an|ge|stell|t)
  if (f.suf.includes('pp') && low.startsWith('ge', pos) && !st.includes(low.slice(pos, end))) { head.push(['i', w.slice(pos, pos + 2)]); pos += 2; }
  const mid = low.slice(pos, end);
  if (st.includes(mid)) return [...head, ['r', w.slice(pos, end)], ...tail];
  // an ending fused with the stem (die Ansicht: an + sicht, the stem of sehen with -t)
  if (fused && tail.length && tail[0][0] === 's' && st.includes(mid + tail[0][1].toLowerCase())) {
    const [, t] = tail.shift() || ['', ''];
    return [...head, ['r', w.slice(pos, end) + t], ...tail];
  }
  return null;
}

/**
 * The index in the word of the stressed vowel, by rule (FAMILY-SCHEMA: stress).
 * @param {any} f the form (word, cls, pre, suf, kind, side, seg) @param {any} parent the parent form (built), or null
 * @returns {number}
 */
export function stressOf(f, parent) {
  const seg = /** @type {[string, string][]} */ (f.seg);
  const starts = []; let at = 0;
  for (const [, t] of seg) { starts.push(at); at += t.length; }
  const inSeg = (/** @type {number} */ i) => {
    const [k, t] = seg[i], s = starts[i];
    if (k === 'p') {
      const sub = PARTICLE_STRESS[t.toLowerCase()];
      if (sub && t.toLowerCase().indexOf(sub) >= 0) return vowelFrom(f.word, s + t.toLowerCase().indexOf(sub));
    }
    return vowelFrom(f.word, s);
  };
  const root = () => seg.findIndex(([k]) => k === 'r');
  const ps = seg.map(([k], i) => (k === 'p' ? i : -1)).filter(i => i >= 0);
  if (f.side === 'cmp' || seg[0][0] === 'c') return vowelFrom(f.word, 0);
  // un- on an adjective or a noun is stressed (unmöglich, die Unsicherheit)
  if (f.pre[0] === 'un') return inSeg(ps[0]);
  if (!ps.length) return root() >= 0 ? inSeg(root()) : vowelFrom(f.word, 0);
  // a word made by an ending that keeps its parent's stress (Vorstellung from vorstellen, verständlich from verstehen)
  const lastSuf = f.suf[f.suf.length - 1];
  const keeps = f.side === 'suf' && parent && !['stem', 'e', 't'].includes(lastSuf);
  if (keeps && parent.seg && typeof parent.stress === 'number') {
    // the same part as in the parent: its n-th prefix or its root
    let ps0 = 0; const pstarts = []; for (const [, t] of parent.seg) { pstarts.push(ps0); ps0 += t.length; }
    const pi = pstarts.findIndex((s, i) => parent.stress >= s && parent.stress < s + parent.seg[i][1].length);
    if (pi >= 0) {
      const [pk] = parent.seg[pi];
      const nth = parent.seg.slice(0, pi).filter(([k]) => k === pk).length;
      const mine = seg.map(([k], i) => (k === pk ? i : -1)).filter(i => i >= 0)[nth];
      if (mine != null) {
        const off = parent.stress - pstarts[pi];
        if (seg[mine][1].length > off && VOWEL.test(f.word[starts[mine] + off])) return starts[mine] + off;
        return inSeg(mine);
      }
    }
  }
  const nounish = f.cls !== 'verb';
  for (const i of ps) {
    const p = seg[i][1].toLowerCase();
    if (UNSTRESSED.has(p)) continue;
    if (!nounish && VERB_ONLY_UNSTRESSED.has(p) && f.kind === 'i' && i === ps[0]) continue;
    if (!nounish && p === 'miss') continue;
    return inSeg(i);
  }
  return root() >= 0 ? inSeg(root()) : vowelFrom(f.word, 0);
}

/** The word with its stressed vowel in capitals, for review sheets (beSTELlen → "bestEllen"). @param {string} w @param {number} i */
export const showStress = (w, i) => (i >= 0 ? `${w.slice(0, i)}${w[i].toUpperCase()}${w.slice(i + 1)}` : w);

/** Read the authored families (only some roots: other files are not even parsed). @param {string} dir @param {string[]} [only] */
export function readFamilies(dir, only = []) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(f => f.endsWith('.json') && (!only.length || only.includes(f.slice(0, -5)))).sort().map(f => ({ file: f, ...JSON.parse(readFileSync(path.join(dir, f), 'utf8')) }));
}

/** DWDS corpus hits that count as attested (a rare but real word: die Vorstellbarkeit has 341). */
export const CORPUS_MIN = 200;
const HOW = /** @type {Record<string, string>} */ ({ T: 'lit', M: 'pic', O: 'word' });
/** Key order of a built form (readable diffs, stable output). */
const ORDER = ['id', 'card', 'word', 'cls', 'art', 'adjNoun', 'pl', 'kind', 'refl', 'aux', 'pp', 'parent', 'add', 'side', 'pre', 'suf', 'key', 'seg', 'stress',
  'en', 'clue', 'ex', 'exEn', 'why', 'note', 'grade', 'how', 'level', 'zipf', 'rare', 'board', 'lemma', 'lex', 'src'];
const ordered = (/** @type {any} */ o) => Object.fromEntries(ORDER.filter(k => o[k] !== undefined).map(k => [k, o[k]]));

/**
 * Build the families.
 * @param {any[]} authored readFamilies() @param {{words: any[], verbs: any[], chains: any[], roots: any[], lexcheck: any}} ctx
 * @returns {{families: any[], problems: string[]}}
 */
export function buildFamilies(authored, { words, verbs, chains, roots, lexcheck }) {
  const byId = new Map(words.map(w => [w.id, w]));
  const V = new Map(verbs.map(v => [v.id, v]));
  const lx = (lexcheck && lexcheck.words) || {};
  /** @type {string[]} */ const problems = [];
  const fams = [];
  const order = [...roots.map(r => r.id)];
  const sorted = [...authored].sort((a, b) => (order.indexOf(a.root) < 0 ? 99 : order.indexOf(a.root)) - (order.indexOf(b.root) < 0 ? 99 : order.indexOf(b.root)) || 0);
  for (const a of sorted) {
    const at = `family ${a.root}`;
    const rootRow = roots.find(r => r.id === a.root);
    const head = rootRow ? { lemma: rootRow.lemma, en: rootRow.en, pres3: rootRow.pres3, pret: rootRow.pret, aux: rootRow.aux, pp: rootRow.pp } : a.head;
    if (!head) { problems.push(`${at}: no head (a root outside roots[] needs head)`); continue; }
    const hw = byId.get(head.lemma);
    /** @type {Map<string, any>} */ const F = new Map();
    const forms = [];
    for (const raw of a.forms) {
      let f = { ...raw };
      const fa = `${at} ${f.id}`;
      if (f.verb) {
        const v = V.get(f.verb);
        if (!v) { problems.push(`${fa}: no verb ${f.verb}`); continue; }
        if (v.root !== a.root) problems.push(`${fa}: verb ${v.id} is of root ${v.root}`);
        f = { word: bare(v.inf), cls: 'verb', kind: v.kind, refl: /^sich /.test(v.inf) || undefined, aux: v.aux, pp: v.pp, parent: head.lemma, add: v.pre, side: 'pre',
          en: v.en, ex: v.ex, exEn: v.exEn, why: v.why, grade: v.grade, how: v.how, level: v.level, lemma: v.lemma, card: `PV:${v.id}`, src: v.src, ...f };
        delete f.verb;
      } else if (f.chain) {
        const [cid, nid] = String(f.chain).split('/');
        const ch = chains.find(c => c.id === cid), n = ch && ch.nodes.find((/** @type {any} */ x) => x.id === nid);
        if (!n || !n.from) { problems.push(`${fa}: no chain node ${f.chain}`); continue; }
        const p = ch.nodes.find((/** @type {any} */ x) => x.id === n.from);
        const parent = forms.find(x => x.word === p.word && x.cls === p.cls);
        if (!parent) { problems.push(`${fa}: its chain parent ${p.word} is not an earlier form`); continue; }
        f = { word: n.word, cls: n.cls, art: n.art, parent: parent.id, add: n.add, side: n.side, en: n.en, note: n.note, rare: n.rare, ex: n.ex, exEn: n.exEn,
          lemma: n.lemma ?? null, card: n.side === 'suf' ? `PW:${n.word}` : undefined, ...f };
        delete f.chain;
      }
      if (f.parent === undefined) f.parent = null;
      if (f.parent === null && !f.cls) Object.assign(f, { word: f.word || a.root, cls: 'verb', en: f.en || head.en });
      const parent = f.parent ? F.get(f.parent) : null;
      if (f.parent && !parent) { problems.push(`${fa}: parent ${f.parent} is not an earlier form`); continue; }
      // the tree gives the parts
      f.pre = parent ? (f.side === 'pre' ? [f.add, ...parent.pre] : [...parent.pre]) : [];
      f.suf = parent ? (f.side === 'suf' ? [...parent.suf, f.add] : [...parent.suf]) : [];
      if (raw.pre) f.pre = raw.pre;
      if (raw.suf) f.suf = raw.suf;
      if (f.side === 'cmp') f.key = null;
      else f.key = `${f.pre.join('+')}|${f.suf.join('+')}`;
      // the word list fills level, zipf and the example of a listed word; lemma when the form id is a list id
      if (f.lemma === undefined) f.lemma = byId.has(f.id) ? f.id : null;
      const w = f.lemma ? byId.get(f.lemma) : null;
      if (f.lemma && !w) problems.push(`${fa}: lemma ${f.lemma} is not in the word list`);
      if (w) {
        if (f.level == null) f.level = w.level;
        if (f.zipf == null && typeof w.zipf === 'number') f.zipf = w.zipf;
        if (f.cls === 'verb' && !f.aux && w.forms) { const m = /((?:hat\/ist)|hat|ist)\s+(\S+)$/.exec(w.forms); if (m) { f.aux = m[1]; f.pp = m[2]; } }
      }
      if (f.parent === null) {
        if (f.level == null && hw) f.level = hw.level;
        if (f.aux == null) f.aux = head.aux;
        if (f.pp == null) f.pp = head.pp;
      }
      const lw = lx[f.word.toLowerCase()];
      if (f.zipf == null && lw && typeof lw.wf === 'number') f.zipf = lw.wf;
      f.lex = [...(w ? ['list'] : []), ...(lw && lw.dwds ? ['dwds'] : []), ...(lw && lw.hits >= CORPUS_MIN ? ['corpus'] : []), ...(lw && lw.wf > 0 ? ['wf'] : [])];
      if (!f.grade && f.parent === null) f.grade = 'T';
      if (!f.grade && (f.side === 'suf' || f.add === 'un')) f.grade = 'T';
      if (f.grade && !f.how) f.how = HOW[f.grade];
      if (!f.seg) {
        const s = segOf(f, a.stems || []);
        if (s) f.seg = s; else problems.push(`${fa}: the rule cannot split ${f.word} (write seg, or add its stem to stems)`);
      }
      if (f.seg && typeof raw.stress !== 'number') f.stress = stressOf(f, parent);
      if (f.parent !== null && !f.card) f.card = `PF:${f.id}`;
      if (f.parent === null) f.card = null;
      if (f.board === undefined) f.board = f.parent !== null && f.cls !== 'adv' && f.cls !== 'conj' && f.cls !== 'prep' && f.side !== 'cmp' && !f.pl && !f.adjNoun && !f.rare
        && (f.pre.filter((/** @type {string} */ p) => p !== 'un').length <= 1);
      const built = ordered(f);
      F.set(f.id, built);
      forms.push(built);
    }
    fams.push({
      root: a.root, lemma: head.lemma, en: head.en, pres3: head.pres3, pret: head.pret, aux: head.aux, pp: head.pp,
      level: hw ? hw.level : a.level, zipf: hw && typeof hw.zipf === 'number' ? hw.zipf : (lx[a.root] || {}).wf,
      stems: a.stems, forms, boards: a.boards || {}, none: a.none || [], rare: a.rare || [],
      ...(a.reviewedBy ? { reviewedBy: a.reviewedBy, reviewedAt: a.reviewedAt } : {}),
    });
  }
  return { families: fams, problems };
}
