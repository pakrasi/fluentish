/* Word clusters (content clusters.de, built by tools/build-clusters.mjs from authoring/clusters/): the groups the
   learner thinks in. Pure; tested in node (tests/unit/clusters.test.mjs) and run by the content gate.

   The content file:
     morph      { wordId: { pre?: string[], stem, suf?: string[], sep?: boolean, family? } } for EVERY word in the word
                list. pre: prefixes in order (aus-fallen → ['aus']), sep: a verb's first prefix separates (er fällt aus).
                family: the one word family the word belongs to (absent: the word stands alone).
     families   [{ id, head, label, note, members }]   curated: real word formation only, 3+ members, one family a word
     prefixes   [{ id, label, kind, note, ex }]        be-, ver-, ab- …; members come from morph (index())
     suffixes   [{ id, label, pos, art, note, except }]   -ung, -heit …; a noun suffix with art has a gender rule, and
                every member with another article must be listed in except
     opposites  { groups: [{id, label}], pairs: [{ a, b, group, primary? }] }   primary pairs place each word once
     topics     { list: [{id, label}], core: { wordId: topic }, chunks: { chunkId: topic } }; a word's topic is its
                word-list theme, or its core split (Everyday verbs, Describing words …) when the theme is 'core'
     preps      { groups: [{id, label, note, members}], notes: { wordId: {case, note, ex: [[de, en]]} },
                  gaps: [{ id, prep, de: '… ___ …', answer: [..], en, note }] }

   Cluster ids are '<type>:<id>' (family:fallen, opp:place, prefix:be, suffix:ung, topic:travel, prep:twoway). */

export const TYPES = /** @type {const} */ (['family', 'opp', 'prefix', 'suffix', 'topic', 'prep']);
/** @typedef {'family'|'opp'|'prefix'|'suffix'|'topic'|'prep'} ClusterType */
/** Words that must never head a family (heuristic errors the Explore prototype made). */
export const NOT_HEADS = ['das_Mittel', 'statt.prep', 'zumal.conj'];
/** Known false families, as [word, family] pairs: kept out as regression checks. */
export const NOT_IN = [['die_Zeitung', 'zeit'], ['die_Gefahr', 'fahren'], ['gehören.verb', 'holen'], ['das_Beispiel', 'spielen'], ['der_Reis', 'reisen'], ['der_Wein', 'weinen']];
const LEVEL_ORDER = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
const CASES = new Set(['dat', 'akk', 'gen', 'two-way', null]);

/**
 * Everything the content must satisfy beyond its JSON Schema.
 * @param {any} c the clusters file
 * @param {{words: any[], chunkIds?: Set<string> | null, themes?: string[]}} ctx  words: the word list (igloo.words.de)
 * @returns {string[]} problems, empty when the file is valid
 */
export function validateClusters(c, { words, chunkIds = null, themes = [] }) {
  /** @type {string[]} */ const out = [];
  const bad = (/** @type {string} */ m) => { if (out.length < 200) out.push(m); };
  const byId = new Map(words.map(w => [w.id, w]));
  const morph = c.morph || {};
  for (const w of words) if (!morph[w.id]) bad(`morph: ${w.id} has no entry`);
  for (const id of Object.keys(morph)) if (!byId.has(id)) bad(`morph: ${id} is not in the word list`);
  const prefixes = new Map((c.prefixes || []).map((/** @type {any} */ p) => [p.id, p]));
  const suffixes = new Map((c.suffixes || []).map((/** @type {any} */ s) => [s.id, s]));
  const famIds = new Set((c.families || []).map((/** @type {any} */ f) => f.id));
  /** @type {Map<string, string>} */ const memberOf = new Map();
  for (const f of c.families || []) {
    if (!f.members || f.members.length < 3) bad(`family ${f.id}: fewer than 3 members`);
    if (!f.members?.includes(f.head)) bad(`family ${f.id}: the head ${f.head} is not a member`);
    if (NOT_HEADS.includes(f.head)) bad(`family ${f.id}: ${f.head} must not head a family`);
    for (const m of f.members || []) {
      if (!byId.has(m)) bad(`family ${f.id}: ${m} is not in the word list`);
      if (memberOf.has(m)) bad(`family ${f.id}: ${m} is already in family ${memberOf.get(m)}`);
      memberOf.set(m, f.id);
    }
  }
  for (const [w, f] of NOT_IN) if (memberOf.get(w) === f) bad(`family ${f}: ${w} does not belong to it`);
  for (const [id, m] of Object.entries(morph)) {
    if (typeof m.stem !== 'string' || !m.stem) bad(`morph ${id}: no stem`);
    if ((m.family || null) !== (memberOf.get(id) || null)) bad(`morph ${id}: family ${m.family} but listed in ${memberOf.get(id) || 'none'}`);
    if (m.family && !famIds.has(m.family)) bad(`morph ${id}: unknown family ${m.family}`);
    for (const p of m.pre || []) if (!PREFIX_SET.has(p)) bad(`morph ${id}: unknown prefix ${p}`);
    const w = byId.get(id);
    if (w && w.pos === 'verb' && (m.pre || []).length && typeof m.sep !== 'boolean') bad(`morph ${id}: a prefixed verb needs sep`);
    if (w && w.pos !== 'verb' && 'sep' in m) bad(`morph ${id}: sep is for verbs`);
    if (w && m.sep === true && INSEPARABLE.has((m.pre || [])[0])) bad(`morph ${id}: ${m.pre[0]}- never separates`);
    for (const s of m.suf || []) {
      const rule = suffixes.get(s);
      if (!rule) continue;
      if (rule.pos === 'noun' && w && w.pos === 'noun' && rule.art && w.art !== rule.art && !rule.except.includes(id)) bad(`suffix -${s}: ${id} is ${w.art}, not ${rule.art} (add it to except)`);
    }
  }
  for (const s of suffixes.values()) for (const e of s.except || []) if (!(morph[e]?.suf || []).includes(s.id)) bad(`suffix -${s.id}: except ${e} does not have the suffix`);
  for (const p of prefixes.values()) if (!PREFIX_SET.has(p.id)) bad(`prefix ${p.id}: not in the prefix inventory`);
  // opposites
  const groups = new Set((c.opposites?.groups || []).map((/** @type {any} */ g) => g.id));
  const seenPair = new Set(); const placed = new Map();
  for (const p of c.opposites?.pairs || []) {
    const k = [p.a, p.b].sort().join('|');
    if (p.a === p.b) bad(`opposites: ${p.a} paired with itself`);
    if (seenPair.has(k)) bad(`opposites: ${k} twice`); seenPair.add(k);
    for (const x of [p.a, p.b]) if (!byId.has(x)) bad(`opposites: ${x} is not in the word list`);
    if (!groups.has(p.group)) bad(`opposites: ${k} has unknown group ${p.group}`);
    if (p.primary) for (const x of [p.a, p.b]) { if (placed.has(x)) bad(`opposites: ${x} is in two primary pairs`); placed.set(x, k); }
  }
  // topics
  const topicIds = new Set((c.topics?.list || []).map((/** @type {any} */ t) => t.id));
  for (const t of themes) if (t !== 'core' && !topicIds.has(t)) bad(`topics: theme ${t} is not in the list`);
  for (const w of words) { const t = topicOf(c, w); if (!t || !topicIds.has(t)) bad(`topics: ${w.id} has no topic (${t})`); }
  for (const [k, t] of Object.entries(c.topics?.chunks || {})) if (!topicIds.has(/** @type {string} */ (t))) bad(`topics: chunk ${k} has unknown topic ${t}`);
  if (chunkIds) for (const k of chunkIds) if (!(c.topics?.chunks || {})[k]) bad(`topics: chunk ${k} has no topic`);
  // prepositions
  const notes = c.preps?.notes || {};
  for (const [id, n] of Object.entries(notes)) {
    if (!byId.has(id)) bad(`preps: ${id} is not in the word list`);
    if (!CASES.has(/** @type {any} */ (n).case)) bad(`preps: ${id} has unknown case`);
    if (!/** @type {any} */ (n).note || /[—–]/.test(/** @type {any} */ (n).note)) bad(`preps: ${id} note is empty or has a dash`);
  }
  for (const g of c.preps?.groups || []) for (const m of g.members) if (!byId.has(m)) bad(`preps group ${g.id}: ${m} is not in the word list`);
  const gapIds = new Set();
  for (const g of c.preps?.gaps || []) {
    if (gapIds.has(g.id)) bad(`preps gap ${g.id}: duplicate id`); gapIds.add(g.id);
    if ((String(g.de).match(/___/g) || []).length !== 1) bad(`preps gap ${g.id}: needs exactly one ___`);
    if (!g.answer?.length || g.answer.some((/** @type {string} */ a) => !a.trim())) bad(`preps gap ${g.id}: no answer`);
    if (!notes[g.prep]) bad(`preps gap ${g.id}: ${g.prep} has no note`);
    if (!g.note || !g.en) bad(`preps gap ${g.id}: note and en are required`);
  }
  return out;
}

export const INSEPARABLE = new Set(['be', 'emp', 'ent', 'er', 'ge', 'miss', 'ver', 'zer']);
/** Every prefix morph may use (verb particles, inseparable prefixes and the noun and adjective prefixes). */
export const PREFIX_SET = new Set([...INSEPARABLE, 'ab', 'an', 'auf', 'aus', 'bei', 'dar', 'durch', 'ein', 'fern', 'fest', 'fort', 'frei', 'gegen', 'heran', 'heraus',
  'her', 'hin', 'hinter', 'kennen', 'mit', 'nach', 'nieder', 'rück', 'sitzen', 'statt', 'teil', 'über', 'um', 'un', 'unter', 'ur', 'voll', 'vor', 'voran', 'vorbei',
  'vorweg', 'weg', 'wider', 'wieder', 'zu', 'zurecht', 'zurück', 'zusammen']);

/** A word's topic: its core split when its theme is 'core', else its theme. @param {any} c @param {any} w */
export function topicOf(c, w) {
  if (!w) return null;
  return (c.topics?.core || {})[w.id] || (w.theme && w.theme !== 'core' ? w.theme : null);
}

/**
 * @typedef {object} Cluster
 * @property {string} key       'family:fallen'
 * @property {ClusterType} type
 * @property {string} id
 * @property {string} label
 * @property {string} [note]
 * @property {string[]} items  word ids, in study order (A1 first, then by frequency)
 * @property {string} [head]   a family's head word
 * @property {any[]} [pairs]   opposites: the group's pairs
 * @property {any[]} [gaps]    prepositions: the group's gap sentences
 */

/**
 * The study clusters of every type, from the content and the word list. Families, prefixes and suffixes need 3+
 * words; topics keep the words up to B2 (the topic map in Explore has them all).
 * @param {any} c @param {any[]} words
 * @returns {{all: Cluster[], byKey: Map<string, Cluster>, byType: Record<string, Cluster[]>, opposites: (id: string) => string[], word: (id: string) => any}}
 */
export function index(c, words) {
  const byId = new Map(words.map(w => [w.id, w]));
  const order = (/** @type {string[]} */ ids) => [...new Set(ids)].filter(id => byId.has(id)).sort((a, b) => {
    const x = byId.get(a), y = byId.get(b);
    return LEVEL_ORDER.indexOf(x.level) - LEVEL_ORDER.indexOf(y.level) || (y.zipf || 0) - (x.zipf || 0) || a.localeCompare(b);
  });
  /** @type {Cluster[]} */ const all = [];
  for (const f of c.families || []) all.push({ key: `family:${f.id}`, type: 'family', id: f.id, label: f.label, note: f.note, head: f.head, items: [f.head, ...order(f.members.filter((/** @type {string} */ m) => m !== f.head))] });
  for (const g of c.opposites?.groups || []) {
    const pairs = (c.opposites.pairs || []).filter((/** @type {any} */ p) => p.group === g.id);
    all.push({ key: `opp:${g.id}`, type: 'opp', id: g.id, label: g.label, pairs, items: [...new Set(pairs.flatMap((/** @type {any} */ p) => [p.a, p.b]))] });
  }
  const pre = new Map(), suf = new Map();
  for (const [id, m] of Object.entries(c.morph || {})) {
    const p = (m.pre || [])[0];
    if (p) { if (!pre.has(p)) pre.set(p, []); pre.get(p).push(id); }
    for (const s of m.suf || []) { if (!suf.has(s)) suf.set(s, []); suf.get(s).push(id); }
  }
  for (const p of c.prefixes || []) { const items = order(pre.get(p.id) || []); if (items.length >= 3) all.push({ key: `prefix:${p.id}`, type: 'prefix', id: p.id, label: p.label, note: p.note, items }); }
  for (const s of c.suffixes || []) {
    const items = order((suf.get(s.id) || []).filter((/** @type {string} */ id) => byId.get(id)?.pos === s.pos || (s.pos === 'adj' && byId.get(id)?.pos === 'adv')));
    if (items.length >= 3) all.push({ key: `suffix:${s.id}`, type: 'suffix', id: s.id, label: s.label, note: s.note, items });
  }
  const byTopic = new Map();
  for (const w of words) { const t = topicOf(c, w); if (!t || LEVEL_ORDER.indexOf(w.level) > 3) continue; if (!byTopic.has(t)) byTopic.set(t, []); byTopic.get(t).push(w.id); }
  for (const t of c.topics?.list || []) { const items = order(byTopic.get(t.id) || []); if (items.length) all.push({ key: `topic:${t.id}`, type: 'topic', id: t.id, label: t.label, items }); }
  for (const g of c.preps?.groups || []) {
    const gaps = (c.preps.gaps || []).filter((/** @type {any} */ x) => g.members.includes(x.prep));
    all.push({ key: `prep:${g.id}`, type: 'prep', id: g.id, label: g.label, note: g.note, gaps, items: g.members.filter((/** @type {string} */ m) => byId.has(m)) });
  }
  /** @type {Map<string, string[]>} */ const opp = new Map();
  for (const p of c.opposites?.pairs || []) {
    if (!opp.has(p.a)) opp.set(p.a, []); if (!opp.has(p.b)) opp.set(p.b, []);
    opp.get(p.a).push(p.b); opp.get(p.b).push(p.a);
  }
  /** @type {Record<string, Cluster[]>} */ const byType = {};
  for (const t of TYPES) byType[t] = all.filter(x => x.type === t);
  return { all, byKey: new Map(all.map(x => [x.key, x])), byType, opposites: id => opp.get(id) || [], word: id => byId.get(id) };
}

/**
 * Mark the primary opposite pairs, the ones a map lays out: in list order, a pair is primary when neither word is in
 * a primary pair yet, so every word sits in at most one. A word whose partners are all placed already (jung, after
 * alt–neu) has no primary pair; it shows as a link from its partner. Pure; the build uses it.
 * @param {{a: string, b: string}[]} pairs
 */
export function primaryPairs(pairs) {
  const placed = new Set();
  const out = pairs.map(p => ({ ...p, primary: false }));
  for (const p of out) if (!placed.has(p.a) && !placed.has(p.b)) { p.primary = true; placed.add(p.a); placed.add(p.b); }
  return out;
}
