/* Word families (round 7): one root and every form grown from it, and Today's family, the daily puzzle. Pure: no DOM,
   storage or clock reads; tested in node (tests/unit/build-family.test.mjs). Spec: WORDGAMES-DESIGN (round 7) with
   the owner's decisions of 8 Oct (count only, tiles first, Light days a board of 6).

   The model is built from the Word building content (content/build/de.json) and nothing else:
     roots     the root form of each family (stellen)
     verbs     the prefixed verbs of a root (ausstellen, bestellen …): card PV:<verb>
     chains    the words grown from a root or from one of its verbs (die Ausstellung, vorstellbar …): card PW:<word>
               for a word grown by an ending; a word grown by a prefix that is not a verb of the root has no card here
     families  (the content lane's key, content/build/FAMILY-SCHEMA.md) forms the build content lacks, and board clues,
               examples and stress for the forms it has:
                 families: [{ root, en?, lemma?, forms: [{ id, parent, add, side: 'pre'|'suf'|'pp', word, art?, cls,
                   kind?, grade?, en, clue?, ex?, exEn?, why?, note?, stress?, level?, lemma?, pp?, aux?, reviewedBy? }],
                   none: [<checked non-word>] }]
               A form whose id or word (and word type) is already in the model only adds its fields to it. Any other
               form is new and gets card PF:<form id>, unless a PV or PW card exists for it (one item, one build card).
   Card ids are append-only (tests/fixtures/shipped-ids.txt): PF:<form> uses the form's authored id, which is the
   word-list id when there is one (der_Hersteller, herstellen.verb), else the same shape (die_Bestellung).

   Today's family: a root in the middle, prefix tiles round it, endings and articles under it, and a board of 10
   meanings (6 at A2 and on a Light day, 12 from B2) to build. boardFor() picks the day's root and words; judge()
   says what a build is; gradeFor() turns a finished clue into an FSRS grade; joinFamily() merges two devices' logs. */

/** @typedef {import('./wordbuild.js').BuildContent} BuildContent */
/** @typedef {'verb'|'noun'|'adj'} Cls */
/**
 * @typedef {object} Form
 * @property {string} id   stable: the verb id, the word-list id, or `${art}_${word}` / the word
 * @property {string} word the written word (a verb without "sich")
 * @property {string} [inf] a verb's infinitive as listed (with "sich")
 * @property {string | null} [art]
 * @property {Cls} cls
 * @property {string | null} parent   the parent form's id; null for the root
 * @property {string} [add]  the prefix or ending this form added to its parent
 * @property {'pre'|'suf'|'pp'} [side]
 * @property {string[]} pre  the prefixes on the way from the root (nearest the root first)
 * @property {string[]} suf  the endings on the way from the root
 * @property {'s'|'i' | null} join   the nearest prefixed verb's joint: splits off, never splits, or none
 * @property {'pre'|'stem'} stress
 * @property {'T'|'M'|'O'} [grade] @property {string} [how]
 * @property {string} en @property {string} clue
 * @property {string} [ex] @property {string} [exEn] @property {string} [why] @property {string} [note]
 * @property {string | null} [level] @property {number | null} [zipf] @property {string | null} [lemma] @property {boolean} [rare]
 * @property {string} [pp] @property {string} [aux] @property {string} [dual] @property {'s'|'i'} [kind]
 * @property {string | null} card   PV:/PW:/PF: or null (the family view only)
 * @property {string | null} key    `${prefix}|${ending}` when one prefix tile and one ending tile build it, else null
 * @property {boolean} [added]  a form from the families key that the build content lacked
 */
/**
 * @typedef {object} Family
 * @property {string} root @property {string} stem   stell
 * @property {string} en @property {string | null} lemma
 * @property {Form[]} forms   the root first, then depth first in content order
 * @property {Map<string, Form>} byId @property {Map<string, Form>} byCard
 * @property {string[]} none  checked non-words (zerstellen): the only words called "not a German word"
 */

/** Endings that are tiles: a single written ending whose rule gives the word type (and a noun's article). */
export const TILE_ENDINGS = ['ung', 'er', 'e', 'in', 'heit', 'keit', 'schaft', 'nis', 'bar', 'lich', 'sam', 'ig'];
export const ARTICLES = ['der', 'die', 'das'];
/** Tries a clue gets before its word is shown. */
export const TRIES = 3;
/** New words a board may hold (out of Word building's share of the day's allowance). */
export const BOARD_NEW = 3;
/** Days a root waits before it can be today's root again. */
export const ROOT_REST = 14;
/** Days of puzzle log kept. */
export const KEEP_DAYS = 60;
const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
const lv = (/** @type {any} */ l) => { const i = LEVELS.indexOf(String(l || '').toUpperCase()); return i < 0 ? 9 : i; };
const GRADE = /** @type {Record<string, number>} */ ({ T: 0, M: 1, O: 2 });
const INSEP = new Set(['be', 'emp', 'ent', 'er', 'ge', 'miss', 'ver', 'zer', 'wider']);
/** Compass order for the ring (Word building's compass), then the rest in content order. */
const RING = ['auf', 'vor', 'ein', 'an', 'ab', 'nach', 'aus', 'zu', 'her', 'hin', 'dar', 'fest', 'mit', 'weg', 'um', 'über', 'unter', 'durch', 'be', 'ver', 'ent', 'er', 'zer', 'ge', 'miss', 'emp', 'wider'];

const bare = (/** @type {string} */ inf) => String(inf).replace(/^sich\s+/, '');
/** The stem of a root verb: stellen → stell, ändern → änder, sammeln → sammel. @param {string} root */
export const stemOf = root => (/(e[lr])n$/.test(root) ? root.slice(0, -1) : root.replace(/en$/, '').replace(/n$/, ''));
/** A form's id from a chain node or a word: the word-list id, else `${art}_${word}` for a noun, else the word. @param {{lemma?: string | null, art?: string | null, word: string}} n */
export const formIdOf = n => n.lemma || (n.art ? `${n.art}_${n.word}` : n.word);

/**
 * Every family of the content, by root id.
 * @param {BuildContent & {families?: any[]}} c
 * @param {{info?: (lemma: string) => ({level?: string | null, zipf?: number | null, ex?: string | null, exEn?: string | null} | null)}} [o]
 *   info: what the word list says of a lemma (level, frequency, an example), for forms the build content leaves bare
 * @returns {Map<string, Family>}
 */
export function familyModel(c, { info = () => null } = {}) {
  /** @type {Map<string, Family>} */ const out = new Map();
  const P = new Map((c.prefixes || []).map(p => [p.id, p]));
  const pwWords = new Set();
  for (const ch of c.chains || []) for (const n of ch.nodes) if (n.from && n.side === 'suf') pwWords.add(n.word);
  const famOf = new Map((/** @type {any[]} */ (c.families || [])).map(f => [f.root, f]));
  const rootIds = [...(c.roots || []).map(r => r.id), ...[...famOf.keys()].filter(id => !(c.roots || []).some(r => r.id === id))];
  for (const rid of rootIds) {
    const r = (c.roots || []).find(x => x.id === rid) || null;
    const fam = famOf.get(rid) || null;
    const en = r ? r.en : fam && fam.en;
    if (!en) continue;
    /** @type {Form[]} */ const forms = [];
    /** @type {Map<string, Form>} */ const byId = new Map();
    const add = (/** @type {Form} */ f) => { forms.push(f); byId.set(f.id, f); return f; };
    const findWord = (/** @type {string} */ word, /** @type {string} */ cls) => forms.find(f => f.word === word && f.cls === cls) || null;
    add({ id: rid, word: rid, cls: 'verb', parent: null, pre: [], suf: [], join: null, stress: 'stem', en, clue: en, lemma: r ? r.lemma : fam.lemma || null,
      pp: r ? r.pp : undefined, aux: r ? r.aux : undefined, card: null, key: null });
    // the prefixed verbs
    for (const v of (c.verbs || []).filter(x => x.root === rid)) {
      add({ id: v.id, word: bare(v.inf), inf: v.inf, cls: 'verb', parent: rid, add: v.pre, side: 'pre', pre: [v.pre], suf: [], kind: v.kind, join: v.kind, stress: v.kind === 's' ? 'pre' : 'stem',
        grade: v.grade, how: v.how, en: v.en, clue: /** @type {any} */ (v).clue || v.en, ex: v.ex, exEn: v.exEn, why: v.why, level: v.level, lemma: v.lemma, pp: v.pp, aux: v.aux,
        dual: v.dual, card: `PV:${v.id}`, key: null });
    }
    // the chains that start at the root or at one of its verbs
    for (const ch of c.chains || []) {
      const head = ch.nodes[0];
      const at = head.word === rid ? byId.get(rid) : head.cls === 'verb' ? findWord(head.word, 'verb') : null;
      if (!at) continue;
      /** @type {Map<string, Form>} */ const local = new Map([[head.id, at]]);
      for (const n of ch.nodes.slice(1)) {
        const parent = local.get(String(n.from));
        if (!parent) continue;
        const have = findWord(n.word, n.cls);
        if (have) { local.set(n.id, have); if (!have.lemma && n.lemma) have.lemma = n.lemma; continue; }
        const side = /** @type {'pre'|'suf'} */ (n.side);
        const kind = n.cls === 'verb' && side === 'pre' ? (P.get(String(n.add))?.kind === 'i' ? 'i' : P.get(String(n.add))?.kind === 's' ? 's' : undefined) : undefined;
        const f = add({ id: formIdOf(n), word: n.word, art: n.art || null, cls: n.cls, parent: parent.id, add: n.add, side, pre: [...parent.pre, ...(side === 'pre' ? [String(n.add)] : [])],
          suf: [...parent.suf, ...(side === 'suf' ? [String(n.add)] : [])], kind, join: null, stress: 'stem', en: n.en, clue: /** @type {any} */ (n).clue || n.en, note: n.note, rare: n.rare,
          // an ending on a word keeps its meaning (die Ausstellung from ausstellen): literal, unless authored otherwise
          grade: side === 'suf' ? 'T' : undefined,
          lemma: n.lemma || null, card: side === 'suf' && pwWords.has(n.word) ? `PW:${n.word}` : null, key: null });
        local.set(n.id, f);
      }
    }
    // the families key: new forms, and fields for the forms the model has
    /** @type {string[]} */ const none = [];
    if (fam) {
      for (const x of /** @type {any[]} */ (fam.forms || [])) {
        const have = byId.get(x.id) || findWord(x.word, x.cls);
        if (have) { mergeFields(have, x); continue; }
        const parent = x.parent == null || x.parent === 'root' || x.parent === rid ? byId.get(rid) : byId.get(x.parent) || forms.find(f => f.word === x.parent) || null;
        if (!parent) continue;
        const side = x.side === 'pp' ? 'pp' : x.side === 'pre' ? 'pre' : 'suf';
        const verbId = x.cls === 'verb' && (c.verbs || []).some(v => v.id === x.id) ? x.id : null;
        const f = add({ id: x.id, word: x.word, art: x.art || null, cls: x.cls, parent: parent.id, add: x.add, side, pre: [...parent.pre, ...(side === 'pre' ? [x.add] : [])],
          suf: [...parent.suf, ...(side === 'suf' ? [x.add] : [])], kind: x.kind, join: null, stress: 'stem', en: x.en, clue: x.clue || x.en, lemma: x.lemma || null,
          card: verbId ? `PV:${verbId}` : side === 'suf' && pwWords.has(x.word) ? `PW:${x.word}` : `PF:${x.id}`, key: null, added: true });
        mergeFields(f, x);
      }
      for (const w of fam.none || []) none.push(String(w));
    }
    // derived: the joint, the stress, the tile key; level, frequency and an example from the word list
    for (const f of forms) {
      const pv = nearestPrefixed(f, byId);
      f.join = pv ? (pv.kind || (INSEP.has(String(pv.add)) ? 'i' : P.get(String(pv.add))?.kind === 's' ? 's' : null)) || null : null;
      f.stress = /** @type {any} */ (f).stressAt || (f.pre.length ? (f.pre[f.pre.length - 1] === 'un' || f.join === 's' ? 'pre' : 'stem') : 'stem');
      f.key = keyOf(f);
      const w = f.lemma ? info(f.lemma) : null;
      if (w) {
        if (!f.level && w.level) f.level = w.level;
        if (f.zipf == null && w.zipf != null) f.zipf = w.zipf;
        if (!f.ex && w.ex) { f.ex = w.ex; if (!f.exEn && w.exEn) f.exEn = w.exEn; }
      }
    }
    out.set(rid, { root: rid, stem: stemOf(rid), en, lemma: forms[0].lemma || null, forms: order(forms), byId, byCard: new Map(forms.filter(f => f.card).map(f => [/** @type {string} */ (f.card), f])), none });
  }
  return out;
}

/** Fields a families entry may add to a form (never its id, card or tree). @param {Form} f @param {any} x */
function mergeFields(f, x) {
  for (const k of ['clue', 'ex', 'exEn', 'why', 'note', 'level', 'lemma', 'grade', 'how', 'pp', 'aux']) if (x[k] != null && x[k] !== '') /** @type {any} */ (f)[k] = x[k];
  if (x.stress === 'pre' || x.stress === 'stem') /** @type {any} */ (f).stressAt = x.stress;
  if (!f.en && x.en) f.en = x.en;
  if (x.kind === 's' || x.kind === 'i') f.kind = x.kind;
  if (!f.clue) f.clue = f.en;
}

/** The nearest form on the way to the root that a prefix made (itself included). @param {Form} f @param {Map<string, Form>} byId */
function nearestPrefixed(f, byId) {
  for (let x = /** @type {Form | undefined} */ (f); x; x = x.parent ? byId.get(x.parent) : undefined) if (x.side === 'pre' && x.cls === 'verb') return x;
  return null;
}

/** The tile key of a form: one prefix (or none) and one tile ending (or none). The root itself has none. @param {Form} f */
export function keyOf(f) {
  if (!f.parent || f.side === 'pp' || f.pre.length > 1 || f.suf.length > 1) return null;
  if (f.suf.length && !TILE_ENDINGS.includes(f.suf[0])) return null;
  if (f.cls === 'verb' && f.suf.length) return null;
  if (!f.pre.length && !f.suf.length) return null;
  if (f.pre[0] === 'un') return null;
  return `${f.pre[0] || ''}|${f.suf[0] || ''}`;
}

/** Depth first from the root, children in the order they were added. @param {Form[]} forms */
function order(forms) {
  /** @type {Form[]} */ const out = [];
  const walk = (/** @type {Form} */ f) => { out.push(f); for (const k of forms) if (k.parent === f.id) walk(k); };
  walk(forms[0]);
  for (const f of forms) if (!out.includes(f)) out.push(f);
  return out;
}

/** A form's children: verbs first, then by frequency, then content order. @param {Family} fam @param {string} id */
export function kidsOf(fam, id) {
  const ks = fam.forms.filter(f => f.parent === id);
  return ks.map((f, i) => ({ f, i })).sort((a, b) => (a.f.cls === 'verb' ? 0 : 1) - (b.f.cls === 'verb' ? 0 : 1) || (b.f.zipf || 0) - (a.f.zipf || 0) || a.i - b.i).map(x => x.f);
}

/** The forms on the way from the root to f (root first). @param {Family} fam @param {Form} f */
export function pathOf(fam, f) {
  /** @type {Form[]} */ const out = [];
  for (let x = /** @type {Form | undefined} */ (f); x; x = x.parent ? fam.byId.get(x.parent) : undefined) out.unshift(x);
  return out;
}

/**
 * A word in pieces, for drawing it with its joint, weld and stress dot: the prefixes, the base, a verb's -en tail and
 * the endings. A piece the spelling does not show (a vowel change) stays in the base.
 * @param {Form} f @returns {{pre: string[], base: string, tail: string, suf: string[]}}
 */
export function piecesOf(f) {
  const w = f.word, lw = w.toLowerCase();
  let start = 0; /** @type {string[]} */ const pre = [];
  for (const p of [...f.pre].reverse()) if (lw.startsWith(p, start)) { pre.push(w.slice(start, start + p.length)); start += p.length; }
  let end = w.length; /** @type {string[]} */ const suf = [];
  for (const s of [...f.suf].reverse()) {
    const text = s === 't' ? (lw.slice(0, end).endsWith('ft') ? 'ft' : 't') : s;
    if (TILE_ENDINGS.includes(s) || s === 't') { if (lw.slice(0, end).endsWith(text)) { suf.unshift(w.slice(end - text.length, end)); end -= text.length; } }
  }
  let base = w.slice(start, end), tail = '';
  if (f.cls === 'verb' && !suf.length && /e?n$/.test(base)) { const m = /(e?n)$/.exec(base); tail = m ? m[1] : ''; base = base.slice(0, base.length - tail.length); }
  return { pre, base, tail, suf };
}

/* ------------------------------------------------------------------ the board */

/** The board's size: 6 at A1 and A2 and on a Light day, 10 at B1, 12 from B2. @param {string | null | undefined} level @param {boolean} [light] */
export function boardSize(level, light = false) {
  if (light) return 6;
  const i = lv(level || 'B1');
  return i <= 1 ? 6 : i === 2 || i > 5 ? 10 : 12;
}

/** FNV-1a: a tie-break that changes by day, the same on every device. @param {string} s */
export function hashOf(s) {
  let x = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 0x01000193) >>> 0; }
  return x >>> 0;
}

/**
 * @typedef {object} Board
 * @property {string} root @property {string} day @property {string} level
 * @property {string[]} cards   the board's words, by card id, in clue order
 * @property {string[]} writes  the cards an answer may write: due today, or new within the allowance
 * @property {string[]} fresh   the new ones among them (they use the allowance)
 * @property {{pre: string[], suf: string[]}} tiles
 */

/**
 * Today's board. Pure and deterministic: the same inputs on the same day give the same board.
 * Root: an eligible family (6 or more buildable forms at or under his level + 1, none of them paused by a report)
 * not used in the last 14 days, with the most due forms, then the most unseen forms at his level, then a hash of the
 * day. Words: every due card of the root first (never dropped), then new forms (min(newLeft, 3), literal before
 * picture before word to learn, common first), then forms he has seen (shaky first, common first), then, when new
 * items are not paused, more unseen forms as practice (they write nothing).
 * @param {object} o
 * @param {Map<string, Family>} o.families @param {Record<string, any>} o.cards deck 'build'
 * @param {string} o.day @param {string | null} [o.level] @param {boolean} [o.light] a Light day
 * @param {number} o.newLeft Word building's new items left today @param {boolean} [o.paused] new items paused (exam window)
 * @param {(rec: any) => boolean} o.isDue
 * @param {(f: Form) => string} [o.state] knowledge: known | shaky | unknown | unseen
 * @param {string[]} [o.recent] roots of the last days, newest last @param {Set<string>} [o.reported] form ids paused by a report
 * @param {string | null} [o.root] force a root (the family view's "Play" on its own root is today's only)
 * @returns {Board | null}
 */
export function boardFor({ families, cards, day, level = 'B1', light = false, newLeft, paused = false, isDue, state = () => 'unseen', recent = [], reported = new Set(), root = null }) {
  const L = lv(level || 'B1');
  const size = boardSize(level, light);
  const playable = (/** @type {Family} */ fam) => fam.forms.filter(f => f.card && f.key && f.clue && !reported.has(f.id) && lv(f.level || 'B1') <= L + 1);
  const due = (/** @type {Form} */ f) => { const r = cards[/** @type {string} */ (f.card)]; return !!(r && r.reps && isDue(r)); };
  const seen = (/** @type {Form} */ f) => !!(cards[/** @type {string} */ (f.card)]?.reps) || ['known', 'shaky', 'unknown'].includes(state(f));
  const rest = new Set(recent.slice(-ROOT_REST));
  let pool = [...families.values()].filter(fam => playable(fam).length >= 6);
  if (root) pool = pool.filter(f => f.root === root);
  if (!pool.length) return null;
  const fresh = pool.filter(f => !rest.has(f.root));
  const cands = (fresh.length ? fresh : pool).map(fam => {
    const p = playable(fam);
    return { fam, due: p.filter(due).length, unseen: p.filter(f => !seen(f) && lv(f.level || 'B1') <= L).length, h: hashOf(`${day}|${fam.root}`) };
  }).sort((a, b) => b.due - a.due || b.unseen - a.unseen || a.h - b.h);
  const fam = cands[0].fam;
  const p = playable(fam);
  /** @type {Form[]} */ const pick = [];
  const keys = new Set();
  const take = (/** @type {Form} */ f) => {
    if (pick.length >= size || pick.includes(f)) return false;
    // below B2 one reading of a dual verb per board (two clues on the same tiles); the clues must differ
    if (L < 3 && keys.has(f.key)) return false;
    if (pick.some(x => x.clue === f.clue && x.cls === f.cls)) return false;
    pick.push(f); keys.add(f.key); return true;
  };
  const z = (/** @type {Form} */ f) => -(f.zipf || 0);
  // 1. due reviews of the root, lowest level first
  const dueForms = p.filter(due).sort((a, b) => lv(a.level) - lv(b.level) || z(a) - z(b));
  dueForms.forEach(take);
  // 2. new forms inside the allowance
  /** @type {Form[]} */ const fresh2 = [];
  const allowed = paused ? 0 : Math.max(0, Math.min(newLeft, BOARD_NEW));
  const unseenForms = p.filter(f => !seen(f)).sort((a, b) => (GRADE[a.grade || 'T'] ?? 0) - (GRADE[b.grade || 'T'] ?? 0) || (lv(a.level) > L ? 1 : 0) - (lv(b.level) > L ? 1 : 0) || z(a) - z(b));
  for (const f of unseenForms) { if (fresh2.length >= allowed) break; if (take(f)) fresh2.push(f); }
  // 3. forms he has seen, shaky first
  const rank = /** @type {Record<string, number>} */ ({ shaky: 0, unknown: 1, known: 2, unseen: 3 });
  p.filter(f => seen(f) && !due(f)).sort((a, b) => (rank[state(a)] ?? 3) - (rank[state(b)] ?? 3) || z(a) - z(b)).forEach(take);
  // 4. practice: more unseen forms, which write nothing (not while new items pause)
  if (!paused) unseenForms.forEach(take);
  if (pick.length < Math.min(6, size)) return null;
  // clues in the family's order: a verb and the nouns grown from it sit together
  pick.sort((a, b) => fam.forms.indexOf(a) - fam.forms.indexOf(b));
  const writes = pick.filter(f => due(f) || fresh2.includes(f)).map(f => /** @type {string} */ (f.card));
  return { root: fam.root, day, level: LEVELS[Math.min(L, 5)] || 'B1', cards: pick.map(f => /** @type {string} */ (f.card)), writes, fresh: fresh2.map(f => /** @type {string} */ (f.card)), tiles: tilesFor(fam, pick, L) };
}

/**
 * The tiles: the board's prefixes and endings and the level's distractors: real prefixes of the family whose word is
 * not on the board (they make extra words) and checked non-words. At most 10 prefixes round the root.
 * @param {Family} fam @param {Form[]} pick @param {number} L the level's index
 */
export function tilesFor(fam, pick, L) {
  const pre = new Set(pick.map(f => f.pre[0]).filter(Boolean));
  const suf = new Set(pick.map(f => f.suf[0]).filter(Boolean));
  const realPre = [...new Set(fam.forms.filter(f => f.key && f.pre.length === 1 && !pre.has(f.pre[0])).map(f => f.pre[0]))];
  const nonPre = fam.none.map(w => nonWordParts(fam, w)).filter(x => x && x.pre && !pre.has(x.pre) && !realPre.includes(x.pre)).map(x => /** @type {string} */ (x && x.pre));
  const nReal = L <= 1 ? 1 : L === 2 ? 1 : 2, nNon = L <= 1 ? 0 : L === 2 ? 1 : 2;
  for (const p of realPre.slice(0, nReal)) if (pre.size < 10) pre.add(p);
  for (const p of nonPre.slice(0, nNon)) if (pre.size < 10) pre.add(p);
  if (L >= 3) {
    const more = [...new Set(fam.forms.filter(f => f.key && f.suf.length === 1).map(f => f.suf[0]))].filter(s => !suf.has(s));
    for (const s of more) if (suf.size < 4) suf.add(s);
  }
  const ringIdx = (/** @type {string} */ p) => { const i = RING.indexOf(p); return i < 0 ? 99 : i; };
  return { pre: [...pre].sort((a, b) => ringIdx(a) - ringIdx(b) || a.localeCompare(b)), suf: TILE_ENDINGS.filter(s => suf.has(s)) };
}

/** A checked non-word in parts (zerstellen → zer + stell + en). @param {Family} fam @param {string} w */
export function nonWordParts(fam, w) {
  const lw = String(w).toLowerCase().replace(/^(der|die|das)\s+/, '');
  const i = lw.indexOf(fam.stem);
  if (i < 0) return null;
  const rest = lw.slice(i + fam.stem.length);
  return { pre: lw.slice(0, i) || null, suf: rest === 'en' || rest === 'n' || rest === '' ? null : TILE_ENDINGS.find(s => rest === s) || rest };
}

/** The word a build spells (for the line under a miss): aus + stell + en, Aus + stell + ung. @param {Family} fam @param {{pre?: string | null, suf?: string | null}} b */
export function spell(fam, { pre = null, suf = null }) {
  const verb = !suf || !['ung', 'er', 'e', 'in', 'heit', 'keit', 'schaft', 'nis'].includes(suf);
  const w = `${pre || ''}${fam.stem}${suf || (verb ? fam.root.slice(fam.stem.length) : '')}`;
  return suf && !verb ? w.charAt(0).toUpperCase() + w.slice(1) : w;
}

/* ------------------------------------------------------------------ checking a build */

/**
 * @typedef {'right'|'article'|'other'|'found'|'extra'|'nonword'|'miss'|'empty'} Outcome
 * @typedef {'ok'|'near'|'no'|null} PartState  right · a real word with another meaning · not part of it
 */

/**
 * What a build is, for the clue in hand.
 *   right    the clue's word (a noun with its article)
 *   article  the clue's word with the wrong article (a try is spent; the line says the rule)
 *   other    another open clue on the board: it is filled instead (no try spent)
 *   found    a board word found already (no try spent)
 *   extra    a real word of the family that is not on the board (an extra word, never a miss)
 *   nonword  a checked non-word: "not a German word" (a try is spent)
 *   miss     anything else: "not in this family's list" (a try is spent)
 * states: each part's flip (the root never flips).
 * @param {{fam: Family, cards: string[], i: number, done: Record<string, string>, pick: {art?: string | null, pre?: string | null, suf?: string | null}}} o
 * @returns {{outcome: Outcome, target?: number, form?: Form, states: {art: PartState, pre: PartState, suf: PartState}}}
 */
export function judge({ fam, cards, i, done, pick }) {
  const art = pick.art || null, pre = pick.pre || null, suf = pick.suf || null;
  const cur = /** @type {Form} */ (fam.byCard.get(cards[i]));
  /** @type {{art: PartState, pre: PartState, suf: PartState}} */ const none = { art: null, pre: null, suf: null };
  if (!pre && !suf) return { outcome: 'empty', states: none };
  const key = `${pre || ''}|${suf || ''}`;
  const [cp, cs] = String(cur.key).split('|');
  const ok = { art: cur.art ? (art === cur.art ? 'ok' : 'no') : (art ? 'no' : null), pre: pre ? 'ok' : null, suf: suf ? 'ok' : null };
  if (key === cur.key) {
    if (cur.art && art !== cur.art) return { outcome: 'article', form: cur, states: /** @type {any} */ ({ ...ok, art: 'no' }) };
    return { outcome: 'right', form: cur, states: /** @type {any} */ ({ ...ok, art: cur.art ? 'ok' : null }) };
  }
  const forms = cards.map(id => /** @type {Form} */ (fam.byCard.get(id)));
  const other = forms.findIndex((f, j) => j !== i && f.key === key && !done[cards[j]]);
  if (other >= 0) return { outcome: 'other', target: other, form: forms[other], states: none };
  const found = forms.findIndex((f, j) => j !== i && f.key === key && !!done[cards[j]]);
  const realPre = (/** @type {string | null} */ p) => !!p && fam.forms.some(f => f.key === `${p}|`);
  /** @type {{art: PartState, pre: PartState, suf: PartState}} */ const states = {
    art: cur.art ? (art === cur.art ? 'ok' : 'no') : (art ? 'no' : null),
    pre: pre === (cp || null) ? (pre ? 'ok' : null) : realPre(pre) ? 'near' : pre ? 'no' : null,
    suf: suf === (cs || null) ? (suf ? 'ok' : null) : suf ? 'no' : null,
  };
  if (found >= 0) return { outcome: 'found', target: found, form: forms[found], states: { art: null, pre: pre ? 'near' : null, suf: suf ? 'near' : null } };
  const extra = fam.forms.find(f => f.key === key && f.id !== cur.id);
  if (extra) return { outcome: 'extra', form: extra, states };
  const spelled = spell(fam, { pre, suf }).toLowerCase();
  if (fam.none.some(w => String(w).toLowerCase().replace(/^(der|die|das)\s+/, '') === spelled)) return { outcome: 'nonword', states };
  return { outcome: 'miss', states };
}

/**
 * A typed word in parts, against the family: "die ausstellung" → {art: die, pre: aus, suf: ung}. The word is matched
 * against the family's forms first (exact spelling, case and umlauts folded only for finding the form); otherwise
 * it is cut at the stem. Null when the root is not in it.
 * @param {Family} fam @param {string} input
 * @returns {{art: string | null, pre: string | null, suf: string | null, form: Form | null} | null}
 */
export function parseTyped(fam, input) {
  let s = String(input || '').trim().replace(/\s+/g, ' ');
  let art = null;
  const m = /^(der|die|das)\s+(.+)$/i.exec(s);
  if (m) { art = m[1].toLowerCase(); s = m[2]; }
  const low = s.toLowerCase();
  const form = fam.forms.find(f => f.key && (f.word.toLowerCase() === low || (f.inf && f.inf.toLowerCase() === low))) || null;
  if (form) return { art, pre: form.pre[0] || null, suf: form.suf[0] || null, form };
  const i = low.indexOf(fam.stem);
  if (i < 0) return null;
  const rest = low.slice(i + fam.stem.length);
  const suf = rest === '' || rest === 'en' || rest === 'n' ? null : rest;
  return { art, pre: low.slice(0, i) || null, suf, form: null };
}

/* ------------------------------------------------------------------ grades */

/** Whether a card has ever been answered (not only shown as a study step, flag v). @param {any} rec */
export const answered = rec => !!(rec && rec.reps && (rec.hist || []).some((/** @type {any[]} */ x) => !String(x[4] || '').includes('v')));

/**
 * The FSRS grade of a finished clue. Tiles never give Easy (picking from ten tiles is easier than recall): first try
 * with the split answered right is Good; a later try, a wrong article, a missed split or a typed slip is Hard; shown
 * after three tries is Again on a card he has answered, and a study step (no lapse) on one he never has.
 * @param {{tries: number, shown?: boolean, splitMiss?: boolean, artMiss?: boolean, slip?: boolean, rec?: any}} o
 * @returns {{g: 1|2|3, study: boolean, flags: string}}
 */
export function gradeFor({ tries, shown = false, splitMiss = false, artMiss = false, slip = false, rec = null }) {
  if (shown) return answered(rec) ? { g: 1, study: false, flags: 'r' } : { g: 1, study: true, flags: 'v' };
  if (tries === 0 && !splitMiss && !artMiss && !slip) return { g: 3, study: false, flags: '' };
  return { g: 2, study: false, flags: slip ? 'u' : '' };
}

/** How a clue was finished: first try, a later try, or shown. @param {{tries: number, shown?: boolean, splitMiss?: boolean, artMiss?: boolean}} o @returns {'f1'|'f2'|'shown'} */
export const doneOf = ({ tries, shown = false, splitMiss = false, artMiss = false }) => (shown ? 'shown' : tries === 0 && !splitMiss && !artMiss ? 'f1' : 'f2');

/** Points of a clue (kept in the log; the screen shows only the count): 3 first try, 2 second or a missed split, 1 third, 0 shown. @param {number} tries @param {boolean} shown @param {boolean} [splitMiss] */
export const pointsOf = (tries, shown, splitMiss = false) => (shown ? 0 : Math.max(1, 3 - tries - (splitMiss ? 1 : 0)));

/** "7 of 10 found": the clues found (not shown). @param {{cards: string[]}} b @param {Record<string, string>} done */
export const foundCount = (b, done) => b.cards.filter(id => done[id] === 'f1' || done[id] === 'f2').length;

/* ------------------------------------------------------------------ the log (kv 'build.family') */

/**
 * @typedef {object} DayLog
 * @property {string} day @property {string} root @property {string} level
 * @property {string[]} cards @property {string[]} writes @property {string[]} fresh @property {{pre: string[], suf: string[]}} tiles
 * @property {Record<string, number>} tries @property {Record<string, 'f1'|'f2'|'shown'>} done @property {Record<string, boolean>} split
 * @property {string[]} extras @property {number} points @property {number} ms
 * @typedef {{days: DayLog[], recent: string[]}} FamilyLog
 */

/** A day's log for a new board. @param {Board} b @returns {DayLog} */
export const newDay = b => ({ day: b.day, root: b.root, level: b.level, cards: b.cards, writes: b.writes, fresh: b.fresh, tiles: b.tiles, tries: {}, done: {}, split: {}, extras: [], points: 0, ms: 0 });

/** The log with a day put in (replacing that day), the last KEEP_DAYS days, and the root in recent. @param {FamilyLog | null} log @param {DayLog} d @returns {FamilyLog} */
export function putDay(log, d) {
  const days = [...((log && log.days) || []).filter(x => x.day !== d.day), d].sort((a, b) => a.day.localeCompare(b.day)).slice(-KEEP_DAYS);
  const recent = [...((log && log.recent) || []).filter(r => r !== d.root), d.root].slice(-KEEP_DAYS);
  return { ...(log || {}), days, recent };
}

/** A day's log, or null. @param {FamilyLog | null} log @param {string} day */
export const dayOf = (log, day) => ((log && log.days) || []).find(x => x.day === day) || null;

const RANK = /** @type {Record<string, number>} */ ({ f1: 3, f2: 2, shown: 1 });
/**
 * Two devices' logs, merged by day (data/restore.js rule 'family'): the same root → the union of found (the better
 * finish of a clue), the most tries, a split answered on either, the extras of both; different roots on one day →
 * the day with more found. recent: both, in day order.
 * @param {FamilyLog | null} a @param {FamilyLog | null} b @returns {FamilyLog}
 */
export function joinFamily(a, b) {
  /** @type {Map<string, DayLog>} */ const by = new Map();
  for (const d of [...((a && a.days) || []), ...((b && b.days) || [])]) {
    const cur = by.get(d.day);
    if (!cur) { by.set(d.day, structuredClone(d)); continue; }
    if (cur.root !== d.root) { if (Object.keys(d.done || {}).length > Object.keys(cur.done || {}).length) by.set(d.day, structuredClone(d)); continue; }
    for (const [k, v] of Object.entries(d.done || {})) if ((RANK[v] || 0) > (RANK[cur.done[k]] || 0)) cur.done[k] = v;
    for (const [k, v] of Object.entries(d.tries || {})) cur.tries[k] = Math.max(cur.tries[k] || 0, v);
    for (const [k, v] of Object.entries(d.split || {})) if (!(k in cur.split)) cur.split[k] = v;
    cur.extras = [...new Set([...(cur.extras || []), ...(d.extras || [])])];
    cur.points = Math.max(cur.points || 0, d.points || 0);
    cur.ms = Math.max(cur.ms || 0, d.ms || 0);
  }
  const days = [...by.values()].sort((x, y) => x.day.localeCompare(y.day)).slice(-KEEP_DAYS);
  const recent = days.map(d => d.root);
  for (const r of [...((a && a.recent) || []), ...((b && b.recent) || [])]) if (!recent.includes(r)) recent.unshift(r);
  return { ...(a || {}), ...(b || {}), days, recent: recent.slice(-KEEP_DAYS) };
}

/** Verbs whose split he missed in the last three days (newest first): their sentence cards come first. @param {FamilyLog | null} log @param {string} today @param {(a: string, b: string) => number} diff */
export function splitMisses(log, today, diff) {
  /** @type {string[]} */ const out = [];
  for (const d of [...((log && log.days) || [])].reverse()) {
    if (diff(d.day, today) > 3) continue;
    for (const [card, right] of Object.entries(d.split || {})) { const m = /^PV:(.+)$/.exec(card); if (m && right === false && !out.includes(m[1])) out.push(m[1]); }
  }
  return out;
}

/* ------------------------------------------------------------------ word sheets → the family */

/**
 * Word-list id → its family: a form's lemma (with the form), and every member of the root's word cluster
 * (content/clusters/de.json families) whose root has family data.
 * @param {Map<string, Family>} families @param {{id: string, members: string[]}[]} [clusterFamilies]
 * @returns {Map<string, {root: string, form: string | null}>}
 */
export function familyIndex(families, clusterFamilies = []) {
  /** @type {Map<string, {root: string, form: string | null}>} */ const out = new Map();
  for (const fam of families.values()) for (const f of fam.forms) if (f.lemma && !out.has(f.lemma)) out.set(f.lemma, { root: fam.root, form: f.id });
  for (const cf of clusterFamilies) if (families.has(cf.id)) for (const m of cf.members || []) if (!out.has(m) && !/\.phrase$/.test(m)) out.set(m, { root: cf.id, form: null });
  return out;
}
