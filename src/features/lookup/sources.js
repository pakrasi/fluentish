/* Look up: content files → rows for each section and docs for the search index. Pure, tested in node.

   Sections (UX §4.10): words (My words + the word list), phrases (the chunk bank), grammar (B1 topics, then Igloo's
   grammar layer: linking words, tenses, cases, set phrases, vocabulary, sound, tasks, and the notes), frames
   (Sprechen frames from the B1 trainer, and Igloo's verb frames).

   LANGS lists what each study language has. Phase 1 is German only; the `lang` parameter is kept so the
   ten-language picker can come later without changing the routes. */

/** Content ids per language. @type {Record<string, {code: string, chunks: string, lang: string, words?: string, b1?: boolean, priority?: string}>} */
export const LANGS = {
  german: { code: 'de', chunks: 'igloo.chunks.german', lang: 'igloo.lang.german', words: 'igloo.words.de', b1: true, priority: 'igloo.chunks.priority.de' },
};
export const DEFAULT_LANG = 'german';
/** @param {string | null | undefined} id */
export const langFor = id => (id && LANGS[id] ? id : DEFAULT_LANG);

export const TABS = ['words', 'phrases', 'grammar', 'frames'];

/** Phrase kinds (chunk categories). */
export const PHRASE_CATS = ['sentence_frame', 'collocation', 'gambit_filler', 'fixed_formula', 'discourse_connector'];

/** Grammar sub-sections: id, framework layer (null = not a layer). */
export const GRAMMAR_SUBS = /** @type {[string, string | null][]} */ ([
  ['topics', null], ['linking', 'glue'], ['tenses', 'turn'], ['cases', 'slot'], ['set', 'chunk'], ['vocab', 'lexicon'], ['sound', 'sound'], ['tasks', 'function'], ['notes', null],
]);
export const FRAME_SUBS = ['sprechen', 'verbs'];

/** Word-tile role for a framework layer (DESIGN.md: role colours belong to the grammar layer only). @param {string} layer */
export const roleOf = layer => (/** @type {Record<string, string>} */ ({ glue: 'glue', turn: 'turn', slot: 'slot', function: 'fn', door: 'door' }))[layer] || 'plain';

const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1'];
const lvl = (/** @type {string} */ l) => { const i = LEVELS.indexOf(l); return i < 0 ? 9 : i; };

/**
 * @param {any[]} en       igloo.chunks.en (the English master list, in order)
 * @param {any} target     igloo.chunks.<lang> ({chunks: {id: {t, ex, n, tr?}}})
 * @param {any} [priority] igloo.chunks.priority.de ({prio: {id: 1 | 2}})
 */
export function phraseRows(en, target, priority = null) {
  const map = (target && target.chunks) || {};
  const prio = (priority && priority.prio) || {};
  const rows = [];
  (en || []).forEach((c, i) => {
    const r = map[c.id];
    if (!r || !r.t) return;
    rows.push({ id: c.id, de: r.t, ex: r.ex || null, note: r.n || null, en: c.chunk, enEx: c.natural_example || null, fn: c.pragmatic_function || null,
      cat: c.category, level: c.level || c.cefr_level || null, register: c.register && c.register !== 'neutral' ? c.register : null, prio: prio[c.id] || 3, i });
  });
  rows.sort((a, b) => a.prio - b.prio || a.i - b.i);
  return rows;
}

/** @param {any[]} words igloo.words.<code> */
export function dictRows(words) {
  return (words || []).map(w => ({ id: w.id, w: w.w, art: w.art || '', pl: w.pl || null, pos: w.pos || null, en: w.en || [], alt: w.alt || [], level: w.level || null,
    theme: w.theme || null, rank: w.rank ?? 1e6, zipf: w.zipf ?? null, ex: w.ex || null, exen: w.exen || null, forms: w.forms || null }))
    .sort((a, b) => a.rank - b.rank);
}
/** "der Tisch" @param {{art?: string, w: string}} r */
export const dictHead = r => [r.art, r.w].filter(Boolean).join(' ');

/**
 * Igloo's framework items in one language: {id, layer, role, level, en, de, gloss, example, note, star}.
 * @param {any} fw igloo.framework @param {any} lang igloo.lang.<lang>
 */
export function layerRows(fw, lang) {
  const by = new Map(((lang && lang.items) || []).map((/** @type {any} */ i) => [i.id, i]));
  const rows = [];
  for (const m of (fw && fw.items) || []) {
    const it = by.get(m.id);
    if (!it || !it.target) continue;
    rows.push({ id: m.id, layer: m.layer, role: roleOf(m.layer), level: m.level, en: m.en, de: it.target, gloss: it.gloss || null,
      example: it.example && it.example.target ? { de: it.example.target, en: it.example.gloss || null } : null,
      about: m.note || null, note: it.note || null, star: !!it.star, slot: m.slot && m.slot !== '-' ? m.slot : null });
  }
  rows.sort((a, b) => lvl(a.level) - lvl(b.level));
  return rows;
}

/** A grammar item's model sentence: the gap filled, the hint in brackets dropped. @param {any} g */
export function modelSentence(g) {
  const ans = [].concat(g.answer || [])[0] || '';
  const p = String(g.prompt || '');
  if (p.includes('___')) return p.replace(/\s*\([^)]*\)\s*$/, '').replace('___', ans);
  return ans;
}

/**
 * The B1 trainer's grammar topics in rank order, each with its rules and one model sentence per rule.
 * @param {any} plan b1.plan @param {any[]} items b1.grammar
 * @returns {{id: string, rank: number, name: string, trap: any, confusable: string[], rules: {rule: string, de: string, wrong: string | null, level: string}[], n: number}[]}
 */
export function topicRows(plan, items) {
  const traps = new Map(((plan && plan.traps) || []).map((/** @type {any} */ t) => [t.id, t]));
  const byTopic = new Map();
  for (const g of items || []) {
    if (!byTopic.has(g.topic)) byTopic.set(g.topic, []);
    byTopic.get(g.topic).push(g);
  }
  return ((plan && plan.topics) || []).filter((/** @type {any} */ t) => byTopic.has(t.id)).map((/** @type {any} */ t) => {
    const its = byTopic.get(t.id);
    const seen = new Map();
    for (const g of its) {
      const rule = String(g.rule || g.note || '').trim();
      if (!rule || seen.has(rule) || g.kind === 'translate') continue;
      seen.set(rule, { rule, de: modelSentence(g), wrong: (g.wrong || []).find((/** @type {string} */ w) => w.split(' ').length > 1) || null, level: g.level });
    }
    return { id: t.id, rank: t.rank, name: t.name, trap: t.trap ? traps.get(t.trap) || null : null, confusable: t.confusable || [], rules: [...seen.values()], n: its.length };
  });
}

/**
 * Sprechen frames grouped by Teil and job. @param {any[]} frames b1.frames @param {any} plan b1.plan
 * @returns {{teil: string, name: string, groups: {fn: string, en: string, rows: {id: string, de: string}[]}[]}[]}
 */
export function frameGroups(frames, plan) {
  const fns = new Map(((plan && plan.functions) || []).map((/** @type {any} */ f) => [f.id, f]));
  const teile = (plan && plan.teile) || {};
  /** @type {Map<string, Map<string, any[]>>} */ const out = new Map();
  for (const f of frames || []) {
    if (!out.has(f.teil)) out.set(f.teil, new Map());
    const g = /** @type {Map<string, any[]>} */ (out.get(f.teil));
    if (!g.has(f.fn)) g.set(f.fn, []);
    /** @type {any[]} */ (g.get(f.fn)).push({ id: f.id, de: f.de });
  }
  return [...out].sort((a, b) => a[0].localeCompare(b[0])).map(([teil, g]) => ({ teil, name: teile[teil] || teil,
    groups: [...g].map(([fn, rows]) => ({ fn, en: fns.get(fn)?.en || fn, rows })) }));
}

/** Notes sections in order: key, i18n key suffix. */
export const NOTE_KEYS = ['variety', 'turns', 'wordOrder', 'slotGrammar', 'sound', 'register'];

/**
 * "Go" through nine tenses: rows of {aspect, cells: [{tense, de, marker ranges, en, status}]}.
 * @param {any} turns igloo.turns @param {string} lang
 */
export function tenseGrid(turns, lang) {
  const L = turns && turns.languages && turns.languages[lang];
  if (!L) return null;
  const T = ['past', 'present', 'future'], A = ['simple', 'progressive', 'perfect'];
  return A.map(a => ({ aspect: a, cells: T.map(t => {
    const k = `${t}.${a}`, c = L.cells[k] || {};
    const form = String(c.form || '');
    /** @type {[number, number][]} */ const marks = [];
    if (k !== 'present.simple') for (const m of c.marker || []) { const i = form.indexOf(m); if (i >= 0) marks.push([i, i + m.length]); }
    return { tense: t, de: form, marks, en: turns.english?.[k]?.form || '', status: c.status || 'form', note: c.note || null };
  }) }));
}

/* ---------- search docs ---------- */

/** @param {any[]} groups My words groups (words.js lemmaGroups) @param {(g: any) => string} head */
export const myWordDocs = (groups, head) => groups.map(g => ({ id: `mine:${g.key}`, tab: 'words', title: head(g), sub: g.gloss || '',
  extra: [g.lemma, ...(g.forms || []), g.note, g.plural].filter(Boolean).join(' '), rank: -100 + Math.round(-(g.zipf ?? 3) * 10) / 1000, ref: { kind: 'mine', g } }));
/** @param {ReturnType<typeof dictRows>} rows */
export const dictDocs = rows => rows.map(r => ({ id: `dict:${r.id}`, tab: 'words', title: dictHead(r), sub: r.en.join(', '), extra: [r.w, ...r.alt, r.pl].filter(Boolean).join(' '), rank: r.rank, ref: { kind: 'dict', r } }));
/** @param {ReturnType<typeof phraseRows>} rows */
export const phraseDocs = rows => rows.map((r, i) => ({ id: `phrase:${r.id}`, tab: 'phrases', title: r.de, sub: [r.en, r.fn].filter(Boolean).join(' · '), extra: [r.ex, r.enEx].filter(Boolean).join(' '), rank: i, ref: { kind: 'phrase', r } }));
/** @param {ReturnType<typeof layerRows>} rows */
export const layerDocs = rows => rows.map((r, i) => ({ id: `layer:${r.id}`, tab: r.layer === 'door' ? 'frames' : 'grammar', title: r.de, sub: [r.en, r.gloss].filter(Boolean).join(' · '),
  extra: [r.example?.de, r.note].filter(Boolean).join(' '), rank: 1000 + i, ref: { kind: 'layer', r } }));
/** @param {ReturnType<typeof topicRows>} rows */
export const topicDocs = rows => rows.map(t => ({ id: `topic:${t.id}`, tab: 'grammar', title: t.name, sub: t.rules.map(r => r.rule).join(' '),
  extra: t.rules.map(r => r.de).join(' '), rank: t.rank, ref: { kind: 'topic', t } }));
/** @param {ReturnType<typeof frameGroups>} groups */
export const frameDocs = groups => groups.flatMap(T => T.groups.flatMap(g => g.rows.map((r, i) => ({ id: `frame:${r.id}`, tab: 'frames', title: r.de, sub: g.en, extra: T.name, rank: i, ref: { kind: 'frame', r, g, T } }))));
