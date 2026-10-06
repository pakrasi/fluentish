/* German verb forms for the grader (round 4, the B2 grader review): every verb of the word list and the forms table
   with all its forms, each tagged with the slot a sentence gives it, and the checks built on them.

   The grader used to know a verb only as a word: "hat … Steuern hinterziehen" passed where the Perfekt needs
   hinterzogen, "um den Bedarf decken" where um … zu needs the zu, "Die Stadt treffen" where the subject is singular,
   and fallten, geratet and gedroht counted as typos. What this module adds:

     build(words, extra)   the index: folded form → [{lemma, slot}], from the word list's "3rd · Präteritum · Perfekt"
                           forms (fährt ab · fuhr ab · ist abgefahren) and the forms table, with every person and
                           number, both tenses, Konjunktiv II of the strong verbs, the participle and the zu-infinitive.
                           A prefixed verb the lists lack is built from its base verb (hinterziehen from ziehen,
                           zurückweisen from weisen); extra names more infinitives to build (the collocations' verbs).
     slots                 inf (infinitive), zu (zu-infinitive in one word: abzubauen), pp (participle), and the
                           persons 1s 2s 3s 1p 2p of a finite form (present, Präteritum or Konjunktiv II alike)
     conj.misbuilt(n)      a word made from a strong or irregular verb with the regular endings (fallten, geratet,
                           getragt): no German word, and never a typo of the right form
     clashes(A, B, conj)   where a typed sentence A uses another form of the model B's verb in a frame that decides the
                           form: the participle after haben, sein or werden, the infinitive after a modal or werden,
                           zu before the infinitive (and none after a modal), the person and number of the subject. A
                           form clash counts only where the words that decide it are the model's: the same helper verb,
                           modal or zu in the same clause, and for person and number the whole clause as in the model.
   All keys are the pack's comparison keys (Token.n: lower case, ä → ae, ß → ss). */
// @ts-check
import { tokenize, fold } from './text.js';
/** @typedef {import('../types.js').Token} Token */
/** @typedef {'inf'|'zu'|'pp'|'1s'|'2s'|'3s'|'1p'|'2p'} Slot */
/** @typedef {{lemma: string, slot: Slot, strong: boolean}} Analysis */
/** @typedef {{lookup: (n: string) => Analysis[], misbuilt: (n: string) => boolean, forms: () => IterableIterator<string>, lemmas: Map<string, any>}} Conj */

const key = (/** @type {string} */ s) => fold(String(s).toLowerCase());
const FINITE = new Set(['1s', '2s', '3s', '1p', '2p']);
// separable particles and inseparable prefixes, longest first where it matters (a prefixed verb from its base verb)
const SEP = ['zurück', 'zusammen', 'voran', 'vorbei', 'heraus', 'herein', 'hinaus', 'herunter', 'weiter', 'statt', 'teil', 'fest', 'frei', 'fort', 'nach', 'weg',
  'auf', 'aus', 'bei', 'ein', 'mit', 'vor', 'her', 'hin', 'los', 'ab', 'an', 'zu', 'um', 'dar'];
const INSEP = ['hinter', 'wider', 'unter', 'über', 'durch', 'miss', 'emp', 'ent', 'zer', 'ver', 'be', 'er', 'ge'];
const PREFIXES = [...new Set([...SEP, ...INSEP])].sort((a, b) => b.length - a.length);
// über, unter, durch, um: either kind; a verb the lists lack is taken as inseparable with these (unterziehen,
// übernehmen), except um (umziehen, umsetzen)
const sepOf = (/** @type {string} */ p) => SEP.includes(p) && !INSEP.includes(p);

// verbs with a strong and a weak form side by side (hing / hängte, sandte / sendete): their regular forms are words
const DUAL = new Set(['hängen', 'senden', 'wenden', 'schaffen', 'bewegen', 'erschrecken', 'backen', 'melken', 'saugen', 'schleifen', 'wiegen', 'weichen', 'löschen',
  'stecken', 'gären', 'schmelzen', 'quellen', 'schwellen', 'sieden', 'glimmen', 'triefen', 'hauen', 'winken', 'fragen', 'erlöschen', 'schallen', 'scheren', 'weben']);
const stemOf = (/** @type {string} */ inf) => (/(el|er)n$/.test(inf) ? inf.slice(0, -1) : inf.replace(/e?n$/, ''));
const needsE = (/** @type {string} */ st) => /[dt]$/.test(st) || /[^lrmnaeiouäöüh][mn]$/.test(st);
/** The regular 3rd person present (machen → macht, arbeiten → arbeitet, raten → ratet). @param {string} inf */
export const regularThird = inf => { const st = stemOf(inf); return /[sßzx]$/.test(st) ? `${st}t` : `${st}${needsE(st) ? 'e' : ''}t`; };
const UML = /** @type {Record<string, string>} */ ({ a: 'ä', o: 'ö', u: 'ü', au: 'äu' });
const umlaut = (/** @type {string} */ s) => s.replace(/(au|a|o|u)(?=[^aou]*$)/, m => UML[m] || m);

// Strong and irregular base verbs the word list may lack (befehlen … wringen), in its format: a prefixed verb is built
// from them (begleichen from gleichen, unterstreichen from streichen). The word list and the forms table come first.
const STRONG = `befehlen|befiehlt|befahl|hat befohlen  bergen|birgt|barg|hat geborgen  bersten|birst|barst|ist geborsten  biegen|biegt|bog|hat gebogen
  binden|bindet|band|hat gebunden  blasen|bläst|blies|hat geblasen  brechen|bricht|brach|hat gebrochen  brennen|brennt|brannte|hat gebrannt
  dringen|dringt|drang|ist gedrungen  fangen|fängt|fing|hat gefangen  fechten|ficht|focht|hat gefochten  flechten|flicht|flocht|hat geflochten
  fliehen|flieht|floh|ist geflohen  fressen|frisst|fraß|hat gefressen  gebären|gebärt|gebar|hat geboren  gedeihen|gedeiht|gedieh|ist gediehen
  geschehen|geschieht|geschah|ist geschehen  gleichen|gleicht|glich|hat geglichen  gleiten|gleitet|glitt|ist geglitten  kneifen|kneift|kniff|hat gekniffen
  kriechen|kriecht|kroch|ist gekrochen  laden|lädt|lud|hat geladen  lügen|lügt|log|hat gelogen  meiden|meidet|mied|hat gemieden
  misslingen|misslingt|misslang|ist misslungen  nennen|nennt|nannte|hat genannt  pfeifen|pfeift|pfiff|hat gepfiffen  preisen|preist|pries|hat gepriesen
  reiben|reibt|rieb|hat gerieben  reißen|reißt|riss|hat gerissen  rennen|rennt|rannte|ist gerannt  ringen|ringt|rang|hat gerungen
  rinnen|rinnt|rann|ist geronnen  saufen|säuft|soff|hat gesoffen  scheiden|scheidet|schied|hat geschieden  schelten|schilt|schalt|hat gescholten
  schlagen|schlägt|schlug|hat geschlagen  schleichen|schleicht|schlich|ist geschlichen  schlingen|schlingt|schlang|hat geschlungen
  schmeißen|schmeißt|schmiss|hat geschmissen  schreien|schreit|schrie|hat geschrien  schreiten|schreitet|schritt|ist geschritten
  schwinden|schwindet|schwand|ist geschwunden  schwingen|schwingt|schwang|hat geschwungen  schwören|schwört|schwor|hat geschworen
  sinnen|sinnt|sann|hat gesonnen  speien|speit|spie|hat gespien  spinnen|spinnt|spann|hat gesponnen  springen|springt|sprang|ist gesprungen
  stechen|sticht|stach|hat gestochen  treiben|treibt|trieb|hat getrieben  verderben|verdirbt|verdarb|hat verdorben  wägen|wägt|wog|hat gewogen
  winden|windet|wand|hat gewunden  wringen|wringt|wrang|hat gewrungen  streichen|streicht|strich|hat gestrichen  streiten|streitet|stritt|hat gestritten
  werben|wirbt|warb|hat geworben  weisen|weist|wies|hat gewiesen  leiden|leidet|litt|hat gelitten  greifen|greift|griff|hat gegriffen
  schieben|schiebt|schob|hat geschoben  heben|hebt|hob|hat gehoben  stoßen|stößt|stieß|hat gestoßen  ziehen|zieht|zog|hat gezogen
  fallen|fällt|fiel|ist gefallen  raten|rät|riet|hat geraten  tragen|trägt|trug|hat getragen  treten|tritt|trat|ist getreten
  liegen|liegt|lag|hat gelegen  schließen|schließt|schloss|hat geschlossen  gießen|gießt|goss|hat gegossen  fließen|fließt|floss|ist geflossen
  wiegen|wiegt|wog|hat gewogen  weichen|weicht|wich|ist gewichen  stehlen|stiehlt|stahl|hat gestohlen  sterben|stirbt|starb|ist gestorben
  werfen|wirft|warf|hat geworfen  helfen|hilft|half|hat geholfen  gelten|gilt|galt|hat gegolten  bitten|bittet|bat|hat gebeten
  sitzen|sitzt|saß|hat gesessen  messen|misst|maß|hat gemessen  sinken|sinkt|sank|ist gesunken  stinken|stinkt|stank|hat gestunken`
  .trim().split(/\s{2,}|\n\s*/).map(x => x.split('|'));
/** @type {Record<string, Partial<Record<Slot, string[]>> & {k2?: string}>} */
const IRREG = {
  sein: { '1s': ['bin'], '2s': ['bist'], '3s': ['ist'], '1p': ['sind'], '2p': ['seid'], k2: 'wäre' },
  haben: { '1s': ['habe', 'hab'], '2s': ['hast'], '3s': ['hat'], '1p': ['haben'], '2p': ['habt'], k2: 'hätte' },
  werden: { '1s': ['werde'], '2s': ['wirst'], '3s': ['wird'], '1p': ['werden'], '2p': ['werdet'], k2: 'würde' },
  wissen: { '1s': ['weiß'], '2s': ['weißt'], '3s': ['weiß'], '1p': ['wissen'], '2p': ['wisst'], k2: 'wüsste' },
  tun: { '1s': ['tue', 'tu'], '2s': ['tust'], '3s': ['tut'], '1p': ['tun'], '2p': ['tut'], k2: 'täte' },
  können: { '1s': ['kann'], '2s': ['kannst'], '3s': ['kann'], '1p': ['können'], '2p': ['könnt'], k2: 'könnte' },
  müssen: { '1s': ['muss'], '2s': ['musst'], '3s': ['muss'], '1p': ['müssen'], '2p': ['müsst'], k2: 'müsste' },
  dürfen: { '1s': ['darf'], '2s': ['darfst'], '3s': ['darf'], '1p': ['dürfen'], '2p': ['dürft'], k2: 'dürfte' },
  sollen: { '1s': ['soll'], '2s': ['sollst'], '3s': ['soll'], '1p': ['sollen'], '2p': ['sollt'], k2: 'sollte' },
  wollen: { '1s': ['will'], '2s': ['willst'], '3s': ['will'], '1p': ['wollen'], '2p': ['wollt'], k2: 'wollte' },
  mögen: { '1s': ['mag'], '2s': ['magst'], '3s': ['mag'], '1p': ['mögen'], '2p': ['mögt'], k2: 'möchte' },
  möchten: { '1s': ['möchte'], '2s': ['möchtest'], '3s': ['möchte'], '1p': ['möchten'], '2p': ['möchtet'] },
};

/**
 * One verb's forms by slot. inf: as listed (zurückweisen); forms: "weist zurück · wies zurück · hat zurückgewiesen".
 * @param {string} inf @param {string} forms
 */
function paradigm(inf, forms) {
  const [p0 = '', p1 = '', p2 = ''] = String(forms).split('·').map(x => x.replace(/\bsich\b/g, ' ').replace(/\s+/g, ' ').trim());
  const t0 = p0.split(' '), t1 = p1.split(' ');
  const part = t0.length > 1 ? t0[t0.length - 1] : null;
  const base = part && inf.startsWith(part) ? inf.slice(part.length) : inf;
  const pres3 = t0[0], past = t1[0], pp = p2.split(' ').pop() || '';
  const st = stemOf(base), e = needsE(st) ? 'e' : '';
  const strong = !/te$/.test(past) || /en$/.test(pp);
  /** @type {Record<Slot, string[]>} */
  const f = { inf: [inf], zu: [], pp: [pp], '1s': [], '2s': [], '3s': [], '1p': [], '2p': [] };
  const irr = IRREG[base];
  const push = (/** @type {Slot} */ s, /** @type {string[]} */ xs) => { for (const x of xs) if (x && !f[s].includes(x)) f[s].push(x); };
  if (irr) for (const s of /** @type {Slot[]} */ (['1s', '2s', '3s', '1p', '2p'])) push(s, irr[s] || []);
  else {
    push('1s', [`${st}e`]); push('3s', [pres3]); push('1p', [base]); push('2p', [`${st}${e}t`]);
    push('2s', [/[sßzx]t$/.test(pres3) ? pres3 : /dt$/.test(pres3) ? `${pres3.slice(0, -1)}st` : /[dt]$/.test(st) && !/et$/.test(pres3) ? `${pres3}st` : `${pres3.slice(0, -1)}st`]);
    if (/(el|er)n$/.test(base) && /el$/.test(st)) push('1s', [`${st.slice(0, -2)}le`]);   // ich zweifle
  }
  // Präteritum: ich/er fiel, du fielst, wir fielen, ihr fielt
  const pe = /[dt]$/.test(past) && !/te$/.test(past) ? 'e' : '';
  push('1s', [past]); push('3s', [past]); push('2s', [`${past}${pe || (/[sßz]$/.test(past) ? 'e' : '')}st`]);
  push('1p', [/e$/.test(past) ? `${past}n` : `${past}en`]); push('2p', [/e$/.test(past) ? `${past}t` : `${past}${pe}t`]);
  // Konjunktiv II: the modal and helper forms, and a strong verb's (fiele, käme, geriete)
  const k2 = irr && irr.k2 ? irr.k2 : strong && !/te$/.test(past) ? `${umlaut(past)}${/e$/.test(past) ? '' : 'e'}` : null;
  if (k2) { push('1s', [k2]); push('3s', [k2]); push('2s', [`${k2}st`]); push('1p', [`${k2}n`]); push('2p', [`${k2}t`]); }
  if (part) {
    // a verb-final clause joins the particle (weil er es zurückweist); zu goes between (zurückzuweisen)
    for (const s of /** @type {Slot[]} */ (['1s', '2s', '3s', '1p', '2p'])) push(s, f[s].map(x => part + x));
    push('zu', [`${part}zu${base}`]);
  }
  // irregular: any principal part that is not the regular one (fallen, denken, bringen; not machen)
  const regPp = `${INSEP.some(q => base.startsWith(q) && base.length - q.length >= 4) || /ieren$/.test(base) ? '' : 'ge'}${st}${e}t`;
  const irregular = past !== `${st}${e}te` || pp.replace(new RegExp(`^${part || ''}`), '') !== regPp || pres3 !== regularThird(base);
  return { inf, base, part, pres3, past, pp, strong, irregular, f };
}

/**
 * The verb index of a word list ({w, pos: 'verb', forms}) and the forms table ({verbs: {inf: forms}}).
 * @param {any[] | null | undefined} words @param {{verbs?: Record<string, string>} | null} [table] @param {Iterable<string>} [extra]
 * @returns {Conj}
 */
export function build(words, table = null, extra = []) {
  /** @type {Map<string, ReturnType<typeof paradigm>>} */ const lemmas = new Map();
  /** @type {Map<string, Analysis[]>} */ const byForm = new Map();
  const index = (/** @type {string} */ lemma, /** @type {ReturnType<typeof paradigm>} */ P) => {
    for (const [s, xs] of Object.entries(P.f)) for (const x of xs) {
      const k = key(x);
      let a = byForm.get(k);
      if (!a) { a = []; byForm.set(k, a); }
      if (!a.some(y => y.lemma === lemma && y.slot === s)) a.push({ lemma, slot: /** @type {Slot} */ (s), strong: P.strong });
    }
  };
  const add = (/** @type {string} */ w, /** @type {string} */ forms) => {
    // "denken an": the preposition goes; a phrase ("sich selbstständig machen") is not one verb
    const inf = String(w).trim().replace(/^sich\s+/, '').replace(/\s+(an|auf|aus|bei|für|gegen|in|mit|nach|über|um|unter|von|vor|zu)$/, '');
    if (!inf || /\s/.test(inf) || lemmas.has(inf) || String(forms).split('·').length !== 3) return;
    const P = paradigm(inf, forms);
    lemmas.set(inf, P); index(inf, P);
  };
  for (const w of words || []) if (w && w.pos === 'verb' && w.w && w.forms) add(w.w, w.forms);
  for (const [k, v] of Object.entries((table && table.verbs) || {})) add(k, v);
  for (const [inf, p3, past, perf] of STRONG) add(inf, `${p3} · ${past} · ${perf}`);
  /** A verb the lists lack, from its base verb (hinterziehen from ziehen). @param {string} inf */
  const derive = inf => {
    if (lemmas.has(inf)) return true;
    for (const p of PREFIXES) {
      if (!inf.startsWith(p) || inf.length - p.length < 4) continue;
      const b = lemmas.get(inf.slice(p.length));
      if (!b || b.part || INSEP.some(q => b.base.startsWith(q) && b.base.length - q.length >= 4 && !/^ge/.test(b.pp))) continue;
      const sep = sepOf(p) || (p === 'um');
      const pp = sep ? p + b.pp : p + b.pp.replace(/^ge/, '');
      const aux = 'hat';
      add(inf, sep ? `${b.pres3} ${p} · ${b.past} ${p} · ${aux} ${pp}` : `${p}${b.pres3} · ${p}${b.past} · ${aux} ${pp}`);
      return true;
    }
    // no base verb known: a regular (weak) verb, which a strong one never is here (its base is in STRONG or the lists)
    if (!/^[a-zäöüß]{5,}(en|ern|eln)$/.test(inf)) return false;
    const p = PREFIXES.find(q => inf.startsWith(q) && inf.length - q.length >= 4 && (sepOf(q) || q === 'um') && /(en|ern|eln)$/.test(inf.slice(q.length)));
    const base = p ? inf.slice(p.length) : inf, st = stemOf(base), e = needsE(st) ? 'e' : '';
    const ge = INSEP.some(q => base.startsWith(q) && base.length - q.length >= 4) || /ieren$/.test(base) ? '' : 'ge';
    add(inf, p ? `${regularThird(base)} ${p} · ${st}${e}te ${p} · hat ${p}${ge}${st}${e}t` : `${regularThird(base)} · ${st}${e}te · hat ${ge}${st}${e}t`);
    return true;
  };
  // an extra word that is already a form of a listed verb (gezogen, the last word of "zum opfer ([x]) gezogen") is no
  // infinitive of its own
  for (const x of extra) { const inf = String(x).trim().replace(/^sich\s+/, ''); if (!lemmas.has(inf) && !byForm.has(key(inf))) derive(inf); }
  // stems of the strong and irregular verbs, for misbuilt(): present and past stems, umlauts folded
  /** @type {Set<string>} */ const strongStems = new Set();
  const plain = (/** @type {string} */ s) => key(s).replace(/ae/g, 'a').replace(/oe/g, 'o').replace(/ue/g, 'u');
  for (const P of lemmas.values()) if (P.irregular) {
    if (IRREG[P.base] || DUAL.has(P.base)) continue;
    for (const s of [stemOf(P.base), P.past.replace(/e$/, '')]) { strongStems.add(plain(s)); if (P.part) strongStems.add(plain(P.part + s)); }
  }
  return {
    lemmas,
    lookup: n => byForm.get(n) || [],
    forms: () => byForm.keys(),
    misbuilt(n) {
      if (byForm.has(n)) return false;
      const w = plain(n);
      for (const [pre, ends] of /** @type {[string, string[]][]} */ ([['', ['etest', 'etet', 'eten', 'ete', 'test', 'tet', 'ten', 'te', 'est', 'et', 'st', 't']], ['ge', ['et', 't']]])) {
        for (const pfx of ['', ...SEP]) {
          const head = pfx + pre;
          if (!w.startsWith(head)) continue;
          for (const end of ends) {
            if (!w.endsWith(end) || w.length - head.length - end.length < 3) continue;
            const stem = w.slice(head.length, w.length - end.length);
            if (strongStems.has(stem) || (pfx && strongStems.has(pfx + stem))) return true;
          }
        }
      }
      return false;
    },
  };
}

/**
 * The infinitives a content's sentences and accepted patterns show: a word after zu, a zu-infinitive in one word
 * (abzubauen → abbauen) and the last word of a pattern (eine einigung erzielen), lower case, in -en, -ern or -eln. Words
 * in skip (nouns, adjective forms, closed-class words) are not verbs.
 * @param {Iterable<string>} texts @param {(n: string) => boolean} skip  by key
 */
export function infinitivesIn(texts, skip) {
  /** @type {Set<string>} */ const out = new Set();
  const ok = (/** @type {string} */ w) => /^[a-zäöüß]{5,}(en|ern|eln)$/.test(w) && !skip(key(w));
  for (const t of texts) {
    const ws = String(t || '').replace(/\[[^\]]*\]|\([^)]*\)/g, ' ').split(/[^\p{L}]+/u).filter(Boolean);
    ws.forEach((w, i) => {
      if (i && ws[i - 1].toLowerCase() === 'zu' && ok(w)) out.add(w);
      const z = SEP.find(p => w.startsWith(`${p}zu`) && w.length - p.length - 2 >= 4);
      if (z && ok(w) && ok(z + w.slice(z.length + 2))) out.add(z + w.slice(z.length + 2));
    });
    const last = ws[ws.length - 1];
    if (last && /\S\s+\S/.test(String(t)) && !/[.!?]\s*$/.test(String(t)) && ok(last)) out.add(last);
  }
  return out;
}

/* ---- the frames that decide a verb's form ---- */
const AUX = new Set(['hab', 'habe', 'hast', 'hat', 'haben', 'habt', 'hatte', 'hattest', 'hatten', 'hattet', 'haette', 'haettest', 'haetten', 'haettet', 'bin', 'bist', 'ist', 'sind',
  'seid', 'war', 'warst', 'waren', 'wart', 'waere', 'waerst', 'waeren', 'waeret', 'werde', 'wirst', 'wird', 'werden', 'werdet', 'wurde', 'wurdest', 'wurden', 'wurdet',
  'wuerde', 'wuerdest', 'wuerden', 'wuerdet', 'worden', 'gewesen', 'sein']);
const MODAL = new Set(`kann kannst koennen koennt konnte konntest konnten koennte koenntest koennten muss musst muessen muesst musste mussten muesste muessten darf darfst
  duerfen duerft durfte durften duerfte duerften soll sollst sollen sollt sollte solltest sollten will willst wollen wollt wollte wollten mag magst moegen moechte
  moechtest moechten werde wirst wird werden werdet wuerde wuerdest wuerden wuerdet lassen laesst lasst liess liessen`.split(/\s+/).filter(Boolean));
// words that take zu-infinitives and bare ones (er hilft mir aufräumen / aufzuräumen; du brauchst nicht kommen): their
// zu is never checked
const EITHER_ZU = /^(brauch|helf|hilf|half|lern|lehr)/;
const GOVERN_ZU = new Set(['um', 'ohne', 'statt', 'anstatt']);
// words that change a clause's frame when they change: subordinators and subject pronouns (dass man … abschafft /
// … abzuschaffen)
const FRAME = new Set(['dass', 'weil', 'ob', 'wenn', 'obwohl', 'damit', 'bevor', 'nachdem', 'waehrend', 'falls', 'als', 'seit', 'seitdem', 'sobald', 'indem', 'sodass',
  'ich', 'du', 'er', 'sie', 'es', 'wir', 'ihr', 'man']);
// sein and haben with a zu-infinitive are a frame of their own (es ist nicht auszuschliessen, er hat viel zu tun)
const SEIN_HABEN = new Set(['bin', 'bist', 'ist', 'sind', 'seid', 'war', 'warst', 'waren', 'wart', 'sein', 'hab', 'habe', 'hast', 'hat', 'haben', 'habt', 'hatte', 'hatten']);

/** @param {Token[]} T @returns {number[][]} the clauses: token indexes between , ; : . ! ? (a digit's full stop is no end) */
function clausesOf(/** @type {string} */ text, T) {
  /** @type {number[][]} */ const out = []; /** @type {number[]} */ let cur = [];
  T.forEach((t, k) => {
    cur.push(k);
    const gap = text.slice(t.end, T[k + 1] ? T[k + 1].start : text.length);
    if (/[,;:!?]/.test(gap) || (/\./.test(gap) && !/^\d+$/.test(t.raw))) { out.push(cur); cur = []; }
  });
  if (cur.length) out.push(cur);
  return out;
}

/**
 * The slots the model's word k has in its sentence: a participle after haben, sein or werden, an infinitive after a
 * modal or werden or zu, else its finite readings (the helper and the modal themselves are finite).
 * @param {Token[]} T @param {number} k @param {number[]} clause @param {Conj} conj @returns {Set<Slot>}
 */
function slotsIn(T, k, clause, conj) {
  const a = conj.lookup(T[k].n);
  const all = new Set(a.map(x => x.slot));
  const before = clause.filter(j => j < k);
  const cluster = clause.filter(j => j > k).every(j => conj.lookup(T[j].n).length || AUX.has(T[j].n) || MODAL.has(T[j].n));
  if (all.has('zu')) return new Set(['zu']);
  if (k > 0 && T[k - 1].n === 'zu' && before.includes(k - 1) && all.has('inf')) return new Set(['inf']);
  if (all.has('pp') && cluster && before.some(j => AUX.has(T[j].n))) return new Set(['pp']);
  if (all.has('inf') && cluster && before.some(j => MODAL.has(T[j].n))) return new Set(['inf']);
  const fin = new Set([...all].filter(s => FINITE.has(s)));
  return fin.size ? fin : all;
}

/**
 * The slots each word of a right sentence has there (slotsIn), and its lemmas: the words a phrase put in its place must
 * keep (restCheck, alsoLines). @param {string} text @param {Token[]} T @param {Conj} conj
 * @returns {{lemmas: Set<string>, slots: Set<string>}[]}
 */
export function frameSlots(text, T, conj) {
  const cl = clausesOf(text, T);
  return T.map((t, k) => ({ lemmas: new Set(conj.lookup(t.n).map(x => x.lemma)), slots: slotsIn(T, k, cl.find(c => c.includes(k)) || [k], conj) }));
}

/**
 * @typedef {object} Clash
 * @property {number} a  the typed word's index in A (-1 when the clash is a missing zu)
 * @property {number} b  the model word's index in B
 * @property {'form'|'number'|'zu-missing'|'zu-extra'} kind
 */
/**
 * Where the typed sentence A puts the model B's verb in a form B's frame does not allow (see the header). Words are
 * aligned by their keys (the longest common subsequence); only clauses where B's deciding words are kept are judged.
 * @param {Token[]} A @param {Token[]} B @param {string} textB the model (for its clauses) @param {Conj | null | undefined} conj
 * @returns {Clash[]}
 */
export function clashes(A, B, textB, conj) {
  if (!conj || !A.length || !B.length) return [];
  const n = A.length, m = B.length;
  const L = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i].n === B[j].n ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  /** @type {(number | null)[]} */ const pairB = new Array(m).fill(null);   // the typed word each model word kept
  /** @type {{a: number[], b: number[]}[]} */ const gaps = [];
  let i = 0, j = 0, cur = { a: /** @type {number[]} */ ([]), b: /** @type {number[]} */ ([]) };
  while (i < n || j < m) {
    if (i < n && j < m && A[i].n === B[j].n) { if (cur.a.length || cur.b.length) gaps.push(cur); cur = { a: [], b: [] }; pairB[j] = i; i++; j++; }
    else if (j >= m || (i < n && L[i + 1][j] >= L[i][j + 1])) cur.a.push(i++);
    else cur.b.push(j++);
  }
  if (cur.a.length || cur.b.length) gaps.push(cur);
  const clauses = clausesOf(textB, B);
  const clauseOf = (/** @type {number} */ k) => clauses.find(c => c.includes(k)) || [k];
  // a zu-infinitive's clause and the one before it, which holds what asks for zu (Lust, schwer, helfen …)
  const zuRegion = (/** @type {number} */ k) => { const i = clauses.findIndex(c => c.includes(k)); return i > 0 ? [...clauses[i - 1], ...clauses[i]] : clauseOf(k); };
  const verbish = (/** @type {Token} */ t) => conj.lookup(t.n).length > 0 || AUX.has(t.n) || MODAL.has(t.n) || t.n === 'zu' || GOVERN_ZU.has(t.n) || FRAME.has(t.n);
  // the gaps that touch a clause of B (by the model words in them, or the typed words between its kept words)
  const gapsIn = (/** @type {number[]} */ c) => gaps.filter(g => g.b.some(k => c.includes(k)) || (g.a.length && !g.b.length && c.some(k => pairB[k] != null && (pairB[k] === g.a[0] - 1 || pairB[k] === g.a[g.a.length - 1] + 1))));
  const lemmasOf = (/** @type {Token} */ t) => new Set(conj.lookup(t.n).map(x => x.lemma));
  /** @type {Clash[]} */ const out = [];
  for (const g of gaps) {
    // one word for one word: the model's verb in another form
    if (g.a.length === 1 && g.b.length === 1) {
      const ta = A[g.a[0]], kb = g.b[0], tb = B[kb];
      if (/^\p{Lu}/u.test(ta.raw) && g.a[0] > 0) continue;   // a noun (das Treffen)
      const la = lemmasOf(ta), lb = lemmasOf(tb);
      if (![...la].some(x => lb.has(x))) continue;
      const c = clauseOf(kb), want = slotsIn(B, kb, c, conj);
      const have = new Set(conj.lookup(ta.n).filter(x => lb.has(x.lemma)).map(x => x.slot));
      if ([...have].some(s => want.has(s))) continue;
      // participle and zu-infinitive after sein or haben: both German (es ist nicht ausgeschlossen / auszuschliessen)
      if (((want.has('pp') && have.has('zu')) || (want.has('zu') && have.has('pp'))) && c.some(q => q < kb && SEIN_HABEN.has(B[q].n))) continue;
      const zuish = want.has('zu') || have.has('zu') || (kb > 0 && B[kb - 1].n === 'zu');
      const others = gapsIn(zuish ? zuRegion(kb) : c).filter(x => x !== g);
      const number = [...want].every(s => FINITE.has(s)) && [...have].some(s => FINITE.has(s));
      if (number) { if (!others.length) out.push({ a: g.a[0], b: kb, kind: 'number' }); continue; }
      // the words that decide the form are the model's: no other verb, helper, modal or zu changed in the clause
      if (others.some(x => [...x.a.map(q => A[q]), ...x.b.map(q => B[q])].some(verbish))) continue;
      out.push({ a: g.a[0], b: kb, kind: 'form' });
      continue;
    }
    // zu left out before the model's infinitive, or put in where the model has none
    if (!g.a.length && g.b.length === 1 && B[g.b[0]].n === 'zu') {
      const kb = g.b[0], next = kb + 1;
      if (next >= m || pairB[next] == null || !conj.lookup(B[next].n).some(x => x.slot === 'inf')) continue;
      const c = zuRegion(kb);
      if (c.some(q => EITHER_ZU.test(B[q].n))) continue;
      const others = gapsIn(c).filter(x => x !== g);
      if (others.some(x => [...x.a.map(q => A[q]), ...x.b.map(q => B[q])].some(t => verbish(t) && t.n !== 'zu'))) continue;
      out.push({ a: -1, b: next, kind: 'zu-missing' });
      continue;
    }
    if (g.a.length === 1 && !g.b.length && A[g.a[0]].n === 'zu') {
      const ia = g.a[0], kb = B.findIndex((_, q) => pairB[q] === ia + 1);
      if (kb < 0 || !conj.lookup(B[kb].n).some(x => x.slot === 'inf')) continue;
      const c = clauseOf(kb);
      if (!slotsIn(B, kb, c, conj).has('inf') || c.some(q => EITHER_ZU.test(B[q].n))) continue;
      if (!c.some(q => q < kb && MODAL.has(B[q].n))) continue;
      out.push({ a: ia, b: kb, kind: 'zu-extra' });
    }
  }
  return out;
}

/**
 * A typed word that is the pattern word with its inseparable prefix swapped (gedroht for bedroht, verkauft for
 * gekauft) or ge- put before it (gebedroht): another verb, or none, never a typo. Keys.
 * @param {string} t @param {string} a
 */
export function prefixSwap(t, a) {
  const P = ['miss', 'emp', 'ent', 'zer', 'ver', 'be', 'er', 'ge'];
  if (t === `ge${a}` || a === `ge${t}`) return true;
  const pt = P.find(p => t.startsWith(p)), pa = P.find(p => a.startsWith(p));
  const rest = t.slice(pt ? pt.length : 0);
  return !!(pt && pa && pt !== pa && rest === a.slice(pa.length) && rest.length >= 3 && !SAME_ROOT.some(r => rest.startsWith(r)));
}
// roots whose prefixed and plain verbs mean the same (bezahlt / gezahlt, verändert / geändert): both right
const SAME_ROOT = ['zahl', 'aender', 'teil', 'wahr', 'misch'];

/** The forms tokenize() would give for a list of words (for the lexicon). @param {Conj} conj */
export const allForms = conj => [...conj.forms()];
export { tokenize };
