// Morphology error generators for the grading corpus (round 4, the B2 grader review). The first corpus never made
// these errors, so it could not see that the grader took them for right German:
//   inf-for-pp         an infinitive where the Perfekt or the passive needs the participle (hat … hinterziehen)
//   pp-for-inf         a participle where a modal, werden or zu needs the infinitive (muss … gezogen)
//   zu-dropped         a zu-infinitive without its zu (um den Bedarf decken, helfen, Vorurteile abbauen)
//   zu-added           zu after a modal or werden (muss den Bedarf zu decken)
//   strong-weak        a strong or irregular verb with the regular endings (fallten, geratet, getragt)
//   prefix-swap        an inseparable prefix swapped for ge- (gedroht for bedroht), or ge- added to it (gebedroht)
//   agreement          the verb in the other number for a subject the sentence fixes (Die Stadt treffen, Eltern trägt)
//   formal-lowercase   the polite Sie, Ihnen, Ihre … in lower case in a sentence that addresses someone formally
// Every mutation is wrong in its sentence; each generator lists what it leaves alone where the change could be right.
//
// The verb forms come from the content's word list and forms table (each verb's 3rd person, Präteritum and Perfekt),
// with prefixed verbs the list lacks built from their base verb. This is the corpus's own small conjugator, written
// apart from the grader's (src/lang/de/conj.js), so a mistake in one does not hide in the other.
import { readFileSync } from 'node:fs';
import path from 'node:path';

const J = (root, p) => JSON.parse(readFileSync(path.join(root, p), 'utf8'));
const WORD = /[\p{L}\p{N}'-]+/gu;
const toks = s => [...String(s).matchAll(WORD)].map(m => ({ w: m[0], i: m.index, e: m.index + m[0].length }));
const put = (s, t, w) => s.slice(0, t.i) + w + s.slice(t.e);
const isCap = w => /^\p{Lu}/u.test(w);
const low = w => w.toLowerCase();
const capLike = (w, like) => (isCap(like) ? w[0].toUpperCase() + w.slice(1) : w);

const SEP = ['zurück', 'zusammen', 'voran', 'vorbei', 'heraus', 'herein', 'hinaus', 'weiter', 'ab', 'an', 'auf', 'aus', 'bei', 'ein', 'fest', 'frei', 'her', 'hin', 'los',
  'mit', 'nach', 'vor', 'weg', 'zu', 'um', 'statt', 'teil', 'dar'];
const INSEP = ['hinter', 'wider', 'unter', 'über', 'durch', 'miss', 'emp', 'ent', 'zer', 'ver', 'be', 'er', 'ge'];
const UML = { a: 'ä', o: 'ö', u: 'ü', au: 'äu' };
const umlaut = s => s.replace(/(au|a|o|u)(?!.*[aou])/, m => UML[m] || m);
const stemOf = inf => (/(el|er)n$/.test(inf) ? inf.slice(0, -1) : inf.replace(/e?n$/, ''));
const needsE = stem => /[dt]$/.test(stem) || (/[^lrmnaeiouäöüh][mn]$/.test(stem));
const regularThird = inf => { const st = stemOf(inf); return /[sßzx]$/.test(st) ? `${st}t` : `${st}${needsE(st) ? 'e' : ''}t`; };
const IRREG = {
  sein: { f1s: ['bin'], f2s: ['bist'], f3s: ['ist'], f1p: ['sind', 'sein'], f2p: ['seid'], ps: ['war'], pp: ['sind', 'waren'], pp2: 'gewesen' },
  haben: { f1s: ['habe', 'hab'], f2s: ['hast'], f3s: ['hat'], f1p: ['haben'], f2p: ['habt'] },
  werden: { f1s: ['werde'], f2s: ['wirst'], f3s: ['wird'], f1p: ['werden'], f2p: ['werdet'] },
  wissen: { f1s: ['weiß'], f2s: ['weißt'], f3s: ['weiß'], f1p: ['wissen'], f2p: ['wisst'] },
  tun: { f1s: ['tue', 'tu'], f2s: ['tust'], f3s: ['tut'], f1p: ['tun'], f2p: ['tut'] },
};
const MODAL_PRES = { können: ['kann', 'kannst'], müssen: ['muss', 'musst'], dürfen: ['darf', 'darfst'], sollen: ['soll', 'sollst'], wollen: ['will', 'willst'], mögen: ['mag', 'magst'] };
// verbs with a strong and a weak form side by side (hing/hängte, sandte/sendete): their regular forms can be right
const DUAL = new Set(['hängen', 'senden', 'wenden', 'schaffen', 'bewegen', 'erschrecken', 'backen', 'melken', 'saugen', 'schleifen', 'wiegen', 'weichen', 'löschen',
  'stecken', 'gären', 'schmelzen', 'quellen', 'schwellen', 'sieden', 'glimmen', 'triefen', 'hauen', 'winken', 'fragen', 'erlöschen', 'verderben', 'schallen']);

/** One verb's forms by tag: inf, zu (glued, separable verbs), f1s f2s f3s f1p f2p (present), ps pp2 (past sg, pl), pp. */
function paradigm(inf, forms) {
  const [p0 = '', p1 = '', p2 = ''] = String(forms).split('·').map(x => x.trim().replace(/\bsich\b/g, '').replace(/\s+/g, ' ').trim());
  const t0 = p0.split(' '), t1 = p1.split(' ');
  const part = t0.length > 1 ? t0[t0.length - 1] : null;
  const base = part && inf.startsWith(part) ? inf.slice(part.length) : inf;
  const pres3 = t0[0], past = t1[0], pp = p2.split(' ').pop();
  const stem = stemOf(base), e = needsE(stem) ? 'e' : '';
  const out = { inf: [inf], zu: [], f1s: [], f2s: [], f3s: [], f1p: [], f2p: [], ps: [], pp2: [], pp: [pp], part, base, pres3, past, strong: !/te$/.test(past) && /en$/.test(pp) };
  const irr = IRREG[base];
  if (irr) for (const k of ['f1s', 'f2s', 'f3s', 'f1p', 'f2p']) out[k].push(...irr[k]);
  else if (MODAL_PRES[base] || base === 'möchten') {
    const [ich, du] = MODAL_PRES[base] || ['möchte', 'möchtest'];
    out.f1s.push(ich); out.f3s.push(ich); out.f2s.push(du); out.f1p.push(base); out.f2p.push(`${stem}t`);
  } else {
    out.f1s.push(`${stem}e`); out.f3s.push(pres3); out.f1p.push(base); out.f2p.push(`${stem}${e}t`);
    out.f2s.push(/[sßzx]t$/.test(pres3) ? pres3 : /et$/.test(pres3) ? `${pres3.slice(0, -1)}st` : `${pres3.slice(0, -1)}st`);
  }
  out.ps.push(past); out.pp2.push(/e$/.test(past) ? `${past}n` : `${past}en`);
  if (part) {   // the joined finite forms of a verb-final clause, and the zu-infinitive
    for (const k of ['f1s', 'f2s', 'f3s', 'f1p', 'f2p', 'ps', 'pp2']) out[k] = [...out[k], ...out[k].map(f => part + f)];
    out.zu.push(`${part}zu${base}`);
  }
  return out;
}

/** The verb index of the content: lemma → paradigm, and folded form → [{lemma, tag}]. */
export function verbIndex(root) {
  const lemmas = new Map();
  const add = (w, f) => { const inf = String(w).replace(/^sich\s+/, '').replace(/\s+\S+$/, ''); if (!/\s/.test(inf) && !lemmas.has(inf)) lemmas.set(inf, paradigm(inf, f)); };
  for (const w of J(root, 'content/igloo/words/de.json')) if (w.pos === 'verb' && w.forms) add(w.w, w.forms);
  for (const [k, v] of Object.entries(J(root, 'content/b1/forms.json').verbs || {})) add(k, v);
  const byForm = new Map();
  const index = (lemma, P) => { for (const tag of ['inf', 'zu', 'f1s', 'f2s', 'f3s', 'f1p', 'f2p', 'ps', 'pp2', 'pp']) for (const f of P[tag]) { const k = low(f); if (!byForm.has(k)) byForm.set(k, []); byForm.get(k).push({ lemma, tag }); } };
  for (const [l, P] of lemmas) index(l, P);
  /** A verb's paradigm, built from its base verb when the lists lack it (hinterziehen from ziehen). */
  const get = inf => {
    if (lemmas.has(inf)) return lemmas.get(inf);
    for (const p of [...SEP, ...INSEP].sort((a, b) => b.length - a.length)) {
      if (!inf.startsWith(p) || inf.length - p.length < 4) continue;
      const b = lemmas.get(inf.slice(p.length));
      if (!b || b.part) continue;
      const sep = SEP.includes(p) && !INSEP.includes(p);
      const pp = sep ? p + b.pp[0] : p + b.pp[0].replace(/^ge/, '');
      const f = sep ? `${b.pres3} ${p} · ${b.past} ${p} · hat ${pp}` : `${p}${b.pres3} · ${p}${b.past} · hat ${pp}`;
      const P = paradigm(inf, f);
      lemmas.set(inf, P); index(inf, P);
      return P;
    }
    return null;
  };
  return { lemmas, byForm, get, of: w => byForm.get(low(w)) || [] };
}

const AUX = new Set('hab habe hast hat haben habt hatte hattest hatten hattet hätte hättest hätten hättet bin bist ist sind seid war warst waren wart wäre wärst wären wäret werde wirst wird werden werdet wurde wurdest wurden wurdet würde würdest würden würdet worden gewesen sein'.split(' '));
const MODAL = new Set(`kann kannst können könnt konnte konnten könnte könntest könnten muss musst müssen müsst musste mussten müsste müssten darf darfst dürfen dürft durfte
  durften dürfte dürften soll sollst sollen sollt sollte solltest sollten will willst wollen wollt wollte wollten mag magst mögen möchte möchtest möchten werde wirst
  wird werden werdet würde würdest würden würdet`.split(/\s+/));
// verbs that take a bare infinitive and also zu, or that are not modals (lassen, sehen, helfen …): no zu-added after them
const BARE_OR_ZU = /^(brauch|helf|hilf|half|lern|lehr|hör|seh|sieh|sah|lass|läss|ließ|geh|ging|bleib|blieb|fühl|spür)/;
const PRON_SG3 = new Set(['er', 'es', 'man']), PRON_PL = new Set(['wir']), NOM_PRON = new Set(['ich', 'du', 'er', 'sie', 'es', 'wir', 'ihr', 'man']);
const DET_PL = new Set(['viele', 'mehrere', 'alle', 'beide', 'einige', 'wenige', 'manche', 'zwei', 'drei', 'vier', 'fünf', 'zehn', 'hundert', 'tausend', 'zahlreiche', 'unsere', 'meine', 'ihre']);
const DET_SG = new Set(['der', 'das', 'ein', 'eine', 'jeder', 'jede', 'jedes', 'dieser', 'dieses', 'kein', 'mein', 'unser']);
const DET_NOT_NOM = new Set(['den', 'dem', 'des', 'einen', 'einem', 'einer', 'eines', 'diesen', 'diesem', 'keinen', 'keinem', 'meinen', 'meinem']);
const NOT_SUBJ = new Set(['es', 'das', 'dies', 'was', 'wer', 'sie', 'ihr']);
// a participle swapped for ge-: pairs where both are right German with the same meaning (bezahlt / gezahlt)
const SAME_WITH_GE = new Set(['zahlen', 'ändern', 'teilen', 'wahren', 'mischen', 'brauchen', 'schließen']);
const SUB = new Set(['dass', 'weil', 'ob', 'wenn', 'obwohl', 'damit', 'bevor', 'nachdem', 'falls', 'als', 'während', 'sobald', 'seit', 'seitdem', 'indem', 'sodass', 'wie', 'wo', 'was', 'die', 'der', 'das', 'denen', 'dem', 'den']);
const POLITE = new Set(['Sie', 'Ihnen', 'Ihr', 'Ihre', 'Ihren', 'Ihrem', 'Ihrer', 'Ihres']);

/** The clauses of a sentence: token ranges between punctuation marks (a digit's full stop is no end). */
function clauses(s, T) {
  const out = []; let cur = [];
  T.forEach((t, k) => {
    cur.push(k);
    const gap = s.slice(t.e, T[k + 1] ? T[k + 1].i : s.length);
    if (/[,;:!?]/.test(gap) || (/\./.test(gap) && !/^\d+$/.test(t.w))) { out.push(cur); cur = []; }
  });
  if (cur.length) out.push(cur);
  return out;
}

/**
 * The morphology errors in a right sentence s: [{cls, text}]. ix: verbIndex(); nouns: Map(lowercase noun → {sg, pl}).
 * @param {string} s @param {{ix: any, nouns: Map<string, {sg: Set<string>, pl: Set<string>}>, polite?: boolean}} ctx
 */
export function morphErrorsIn(s, { ix, nouns }) {
  const out = [], T = toks(s);
  const tags = k => ix.of(T[k].w).filter(a => !isCap(T[k].w) || k === 0 || T[k].w === 'Sie');
  const has = (k, tag) => tags(k).some(a => a.tag === tag);
  const P = l => ix.get(l);
  const cls = clauses(s, T);
  const clauseOf = k => cls.find(c => c.includes(k)) || [];
  const verbal = k => tags(k).length > 0 || AUX.has(low(T[k].w)) || MODAL.has(low(T[k].w));
  const add = (c, text) => { if (text !== s) out.push({ cls: c, text }); };
  // ---- inf-for-pp: the participle of a clause with haben, sein or werden, at the clause's end (its verb cluster)
  T.forEach((t, k) => {
    const pp = tags(k).filter(a => a.tag === 'pp');
    if (!pp.length || isCap(t.w)) return;
    const c = clauseOf(k);
    if (!c.some(j => j !== k && j < k && AUX.has(low(T[j].w)))) return;
    if (!c.filter(j => j > k).every(j => verbal(j))) return;   // the participle stands in the verb cluster at the end
    const v = P(pp[0].lemma); if (!v || low(v.inf[0]) === low(t.w)) return;
    add('inf-for-pp', put(s, t, v.inf[0]));
  });
  // ---- pp-for-inf and zu-added: an infinitive in the final cluster after a modal or werden; zu-dropped
  T.forEach((t, k) => {
    if (isCap(t.w) || !has(k, 'inf')) return;
    const c = clauseOf(k), before = c.filter(j => j < k);
    const zuBefore = k > 0 && low(T[k - 1].w) === 'zu' && before.includes(k - 1);
    const modal = before.some(j => MODAL.has(low(T[j].w)));
    const cluster = c.filter(j => j > k).every(j => verbal(j));
    const v = P(tags(k).find(a => a.tag === 'inf').lemma); if (!v) return;
    if ((zuBefore || modal) && cluster && low(v.pp[0]) !== low(t.w)) add('pp-for-inf', put(s, t, v.pp[0]));
    if (zuBefore && !c.some(j => /^brauch/.test(low(T[j].w)))) add('zu-dropped', s.slice(0, T[k - 1].i) + s.slice(t.i));
    if (!zuBefore && modal && cluster && !c.some(j => BARE_OR_ZU.test(low(T[j].w)) && j !== k) && !BARE_OR_ZU.test(low(t.w)) && !(k > 0 && low(T[k - 1].w) === 'zu'))
      add('zu-added', v.part && low(t.w) === low(v.inf[0]) ? put(s, t, `${v.part}zu${v.base}`) : put(s, t, `zu ${t.w}`));
  });
  T.forEach((t, k) => {   // abzubauen → abbauen
    const z = tags(k).find(a => a.tag === 'zu'); if (!z || isCap(t.w)) return;
    const v = P(z.lemma); if (!v) return;
    add('zu-dropped', put(s, t, v.inf[0]));
    if (low(v.pp[0]) !== low(v.inf[0])) add('pp-for-inf', put(s, t, v.pp[0]));
  });
  // ---- strong-weak: a strong or irregular form with the regular endings
  T.forEach((t, k) => {
    if (isCap(t.w) && k > 0) return;
    for (const a of tags(k)) {
      const v = P(a.lemma); if (!v || DUAL.has(v.base) || DUAL.has(a.lemma) || IRREG[v.base] || MODAL_PRES[v.base]) continue;
      const w = low(t.w), joined = v.part && w.startsWith(v.part) && !low(v.inf[0]).startsWith(w) ? v.part : '';
      const st = stemOf(v.base);
      let bad = null;
      if (v.strong && a.tag === 'ps') bad = `${joined}${st}${needsE(st) ? 'e' : ''}te`;
      else if (v.strong && a.tag === 'pp2') bad = `${joined}${st}${needsE(st) ? 'e' : ''}ten`;
      else if (a.tag === 'f3s' && low(v.pres3) !== low(regularThird(v.base))) bad = `${joined}${regularThird(v.base)}`;
      else if (v.strong && a.tag === 'pp' && /en$/.test(w)) {
        const insep = INSEP.find(p => v.base.startsWith(p) && v.base.length - p.length >= 4 && !/^ge/.test(w.slice(v.part ? v.part.length : 0)));
        bad = `${v.part || ''}${insep ? '' : 'ge'}${st}${needsE(st) ? 'e' : ''}t`;
      }
      if (!bad) continue;
      if (ix.of(bad).some(b => b.lemma === a.lemma)) continue;   // a real form of the same verb
      add('strong-weak', put(s, t, capLike(bad, t.w)));
      break;
    }
  });
  // ---- prefix-swap: the participle of an inseparable verb with ge- for its prefix (bedroht → gedroht), or ge- added
  T.forEach((t, k) => {
    if (isCap(t.w)) return;
    const a = tags(k).find(x => x.tag === 'pp'); if (!a) return;
    const v = P(a.lemma); if (!v || v.part) return;
    const w = low(t.w), p = ['miss', 'emp', 'ent', 'zer', 'ver', 'be', 'er'].find(x => w.startsWith(x) && v.inf[0].startsWith(x));
    if (!p) return;
    const root = v.inf[0].slice(p.length);
    if (SAME_WITH_GE.has(root) || SAME_WITH_GE.has(root.replace(/^(\w)/, '$1'))) return;
    add('prefix-swap', put(s, t, `ge${w.slice(p.length)}`));
    add('prefix-swap', put(s, t, `ge${w}`));
  });
  // ---- agreement: the finite verb in the other number for a subject the clause fixes
  for (const c of cls) {
    const first = c[0];
    const fin = j => tags(j).filter(a => ['f1s', 'f2s', 'f3s', 'f1p', 'f2p', 'ps', 'pp2'].includes(a.tag));
    const swapTo = (j, want) => {   // the same verb, same tense, in number want ('sg' | 'pl')
      const a = fin(j); if (!a.length) return null;
      const w = low(T[j].w);
      for (const x of a) {
        const v = P(x.lemma); if (!v) continue;
        const joined = v.part && w.startsWith(v.part) && w !== low(v.inf[0]) ? v.part : '';
        const past = x.tag === 'ps' || x.tag === 'pp2';
        const cands = past ? (want === 'sg' ? v.ps : v.pp2) : (want === 'sg' ? v.f3s : v.f1p);
        const r = cands.find(f => (joined ? low(f).startsWith(joined) : !(v.part && low(f).startsWith(v.part) && low(f) !== low(v.inf[0]))) && low(f) !== w);
        if (r && !ix.of(r).some(b => b.lemma === x.lemma && a.some(y => y.tag === b.tag))) return capLike(r, T[j].w);
      }
      return null;
    };
    const numOf = j => { const a = fin(j).map(x => x.tag); const sg = a.some(t => ['f3s', 'ps'].includes(t)), pl = a.some(t => ['f1p', 'pp2'].includes(t)); return sg && !pl ? 'sg' : pl && !sg ? 'pl' : null; };
    // a pronoun that opens the clause, then the verb (er trifft), or the verb second and the pronoun right after it
    // (morgen trifft er); not in a subordinate clause, and not es with sein or geben (es sind viele, es gibt)
    const cc = c.filter((j, q) => !(q === 0 && /^(und|aber|oder|denn|sondern)$/.test(low(T[j].w))));
    if (cc.length >= 2 && !SUB.has(low(T[cc[0]].w))) {
      const pairs = [[cc[0], cc[1]]];
      const v2 = cc.findIndex((j, q) => q > 0 && fin(j).length);
      if (v2 > 0 && cc[v2 + 1] != null) pairs.push([cc[v2 + 1], cc[v2]]);
      for (const [pj, vj] of pairs) {
        const pw = low(T[pj].w);
        const num = PRON_SG3.has(pw) ? 'sg' : PRON_PL.has(pw) ? 'pl' : null;
        if (!num || !fin(vj).length || numOf(vj) !== num) continue;
        if (pw === 'es' && /^(gibt|gab|ist|sind|war|waren|geht|ging)$/.test(low(T[vj].w))) continue;
        const r = swapTo(vj, num === 'sg' ? 'pl' : 'sg');
        if (r) add('agreement', put(s, T[vj], r));
      }
    }
    // a noun phrase that opens the sentence, then the finite verb
    if (c !== cls[0]) continue;
    let q = 0, num = null;
    const w0 = low(T[c[0]].w);
    const det = ['die', 'der', 'das'].includes(w0) && c[1] != null && (isCap(T[c[1]].w) || (/^[a-zäöüß]+(e|en)$/.test(T[c[1]].w) && c[2] != null && isCap(T[c[2]].w)));   // das Gericht, not "Das ist"
    if ((NOT_SUBJ.has(w0) && !det) || DET_NOT_NOM.has(w0) || (SUB.has(w0) && !det)) continue;
    if (DET_PL.has(w0)) { num = 'pl'; q = 1; } else if (DET_SG.has(w0)) { num = 'sg'; q = 1; } else if (w0 === 'die') q = 1;
    while (q < c.length - 1 && !isCap(T[c[q]].w) && !verbal(c[q]) && /^[a-zäöüß]+(e|en|er|es)$/.test(low(T[c[q]].w))) q++;   // adjectives
    if (q >= c.length - 1 || !isCap(T[c[q]].w) || q > 3) continue;
    const noun = nouns.get(low(T[c[q]].w));
    if (noun) { const sg = noun.sg.has(low(T[c[q]].w)), pl = noun.pl.has(low(T[c[q]].w)); const n2 = sg && !pl ? 'sg' : pl && !sg ? 'pl' : null; if (num && n2 && num !== n2) continue; num = num || n2; }
    if (!num || (w0 === 'die' && !noun)) continue;
    const v = c[q + 1];
    if (v == null || !fin(v).length || numOf(v) !== num || (c[q + 2] != null && NOM_PRON.has(low(T[c[q + 2]].w)))) continue;
    if (/^(ist|sind|war|waren)$/.test(low(T[v].w)) && !noun) continue;
    const r = swapTo(v, num === 'sg' ? 'pl' : 'sg');
    if (r) add('agreement', put(s, T[v], r));
  }
  const seen = new Set([s]);
  return out.filter(x => !seen.has(x.text) && seen.add(x.text));
}

/** The polite pronouns of a formal sentence in lower case (not a sentence's first word). @param {string} s */
export function formalLowercase(s) {
  let first = true, changed = false;
  const text = s.replace(/[\p{L}]+|[.!?:]+/gu, m => {
    if (/^[.!?:]+$/.test(m)) { first = true; return m; }
    const was = first; first = false;
    if (!was && POLITE.has(m)) { changed = true; return m.toLowerCase(); }
    return m;
  });
  return changed ? [{ cls: 'formal-lowercase', text }] : [];
}

/** Nouns of the word list and the noun table: lowercase form → its singular and plural spellings. */
export function nounNumbers(root) {
  const m = new Map();
  const add = (k, num) => { const key = low(k); if (!m.has(key)) m.set(key, { sg: new Set(), pl: new Set() }); m.get(key)[num].add(key); };
  for (const w of J(root, 'content/igloo/words/de.json')) if (w.pos === 'noun') { add(w.w, 'sg'); if (w.pl && w.pl !== '-') add(w.pl, 'pl'); }
  return m;
}

/** The set an item belongs to, for the report. */
export function setOf(it) {
  if (it.layer === 'b2') return it.kind === 'grammar' ? 'B2 grammar' : it.b2fn === 'collocation' ? 'B2 collocations' : 'B2 Redemittel';
  if (it.kind === 'grammar') return 'B1 grammar';
  if (it.area === 'writing' || it.src === 'build') return 'B1 Schreiben';
  if (it.kind === 'topic' || it.kind === 'reply') return 'B1 situations';
  if (it.kind === 'phrase') return 'B1 phrases';
  return null;
}
export const MORPH_CLASSES = ['inf-for-pp', 'pp-for-inf', 'zu-dropped', 'zu-added', 'strong-weak', 'prefix-swap', 'agreement', 'formal-lowercase'];
