#!/usr/bin/env node
// The German B2 layer (round 4, L3): reviewed batches in authoring/de/b2/<batch>/ and what they add to content.
//
//   node tools/b2.mjs apply              write every batch into content (grammar items and concepts, phrases …), stamped
//   node tools/b2.mjs check              content agrees with the batches, and the machine gates pass (CI: check:content)
//   node tools/b2.mjs gates [batch]      the machine gates with a report (all B2-layer items, or one batch's)
//   node tools/b2.mjs tutor              write authoring/de/b2/TUTOR-CHECK.md (the keys his tutor checks)
//
// A batch directory holds:
//   source.json   {batch, about, concepts?: [concept], items?: [item + near?: [[answer, why]]]}: the authored and
//                 reconciled entries. An item with an existing id replaces it; a new id goes after its concept's items.
//   REVIEW.json   {batch, reviewedBy: 'model-2pass', reviewedAt, passes: {a, b}, ids: [...]}: the ids both review passes
//                 covered. Only these are stamped reviewedBy/reviewedAt in content.
//   review-a.json, review-b.json: each pass's log ([{id, field, before, after, severity: 'error'|'improve', why}]).
//                 Pass B is made blind to pass A's log. review-reconcile.json: what went in and why.
//
// Content rules this adds (checked here and in tools/validate_grammar.py):
//   - layer 'b2': every B2 grammar item that is not in the B1 trainer (content/b1/grammar.json) carries layer: 'b2', so
//     the B1 pool, readiness and priorityLeft never count it (PLAN-REVIEW B7).
//   - a German B2 item added in round 4 carries reviewedBy and reviewedAt (S10: the handle is model-2pass, not a person).
//   - near misses (source.json `near`) are graded wrong by the app's grader; every accepted answer is graded right; no
//     sticky-error detector fires on a model sentence (the same rules as tools/build-course.mjs).
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { tokenize: tokenizeDe } = await import(pathToFileURL(path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), 'src/lang/de/text.js')).href);
export const DIR = path.join(ROOT, 'authoring/de/b2');
const J = (/** @type {string} */ p) => JSON.parse(readFileSync(path.join(ROOT, p), 'utf8'));
const out1 = (/** @type {any} */ d) => JSON.stringify(d, null, 1) + '\n';
export const FILES = {
  items: 'content/igloo/grammar/items_de.json',
  concepts: 'content/igloo/grammar/concepts_de.json',
  german: 'content/igloo/chunks/german.json',
  accept: 'content/igloo/chunks/accept_german.json',
  en: 'content/igloo/chunks/en.json',
  priority: 'content/igloo/chunks/priority_de.json',
  read: 'content/read/de.json',
  words: 'content/igloo/words/de.json',
  morph: 'authoring/clusters/morph.de.json',
  added: 'authoring/clusters/words-added.de.json',
};
const WORD_KEYS = ['id', 'w', 'art', 'pl', 'pos', 'en', 'alt', 'level', 'theme', 'rank', 'zipf', 'ex', 'exen', 'forms', 'mine'];
const PARTS = 'authoring/chunks/parts/german', ACCEPT = 'authoring/chunks/accept/german', SRC = 'authoring/chunks/src';
const SRC_KEYS = ['id', 'chunk', 'category', 'pragmatic_function', 'register', 'natural_example', 'cefr_level'];
/** The phrase function groups (B2_BRIEF.md): id → label. The first twelve are the B2 Redemittel groups. */
export const FN = /** @type {Record<string, string>} */ ({
  opinion: 'Giving and backing an opinion', argue: 'Arguing and giving examples', hedge: 'Hedging and qualifying',
  concede: 'Conceding and countering', agree: 'Agreeing and disagreeing', probability: 'Guesses and probability',
  conclude: 'Weighing and concluding', report: 'Reporting and summarising a source', present: 'Presentations',
  discuss: 'Taking part in a discussion', figures: 'Describing graphs and figures', formal: 'Work and formal writing',
  react: 'Reacting', request: 'Requests, offers and advice', social: 'Social formulas', narrate: 'Telling and linking events',
  people: 'People and relationships', collocation: 'Collocations',
});
// Python's json.dumps(indent=0) and (indent=1): the formats of the chunk sources
const py0 = (/** @type {any} */ d) => JSON.stringify(d, null, 1).replace(/^ +/gm, '');
const py1 = (/** @type {any} */ d) => JSON.stringify(d, null, 1);
const ROW_KEYS = ['id', 't', 'tr', 'ex', 'extr', 'n', 'fn', 'fvg', 'layer', 'dupOf', 'reviewedBy', 'reviewedAt'];
/** The keys tools/validate_chunks.py --assemble keeps (keep both lists the same). */
export const ASSEMBLE_KEYS = ['t', 'tr', 'ex', 'extr', 'n', 'fn', 'fvg', 'layer', 'dupOf', 'reviewedBy', 'reviewedAt'];
const ACCEPT_KEYS = ['core_en', 'accept', 'weak', 'reviewedBy', 'reviewedAt'];
const EN_KEYS = ['id', 'chunk', 'category', 'pragmatic_function', 'register', 'variable_slots', 'natural_example', 'substitutable_examples', 'cefr_level', 'level', 'level_reason'];
/** Concepts whose keys his tutor checks (S10): Konjunktiv, passive, indirect speech. */
export const TUTOR_CATEGORIES = new Set(['konjunktiv', 'passiv']);
export const TUTOR_CONCEPTS = new Set(['indirekte-rede-ersatz', 'indirekte-rede-fragen-aufforderungen', 'ersatzinfinitiv']);

/** The batches in their order (g1, g2 …, by name). @returns {{name: string, source: any, review: any | null, dir: string}[]} */
export function batches() {
  if (!existsSync(DIR)) return [];
  const order = ['g1', 'g2', 'g3', 't1', 'p1', 'p2', 't2', 'w1'];
  return readdirSync(DIR).filter(n => existsSync(path.join(DIR, n, 'source.json')))
    .sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99) || a.localeCompare(b))
    .map(name => {
      const dir = path.join(DIR, name);
      const source = JSON.parse(readFileSync(path.join(dir, 'source.json'), 'utf8'));
      const rp = path.join(dir, 'REVIEW.json');
      return { name, dir, source, review: existsSync(rp) ? JSON.parse(readFileSync(rp, 'utf8')) : null };
    });
}

/** The B1 trainer's grammar ids (in the B1 pool today; never layer b2). */
const b1GrammarIds = () => new Set(J('content/b1/grammar.json').map((/** @type {any} */ g) => g.id));

const ITEM_KEYS = ['id', 'concept', 'level', 'kind', 'task', 'prompt', 'answer', 'note', 'strict_case'];
const CONCEPT_KEYS = ['id', 'name', 'category', 'level', 'description', 'sticky', 'rank', 'fn'];

/**
 * The grammar files with every batch applied, as text. Pure over the files on disk (the content files are read as
 * they were before any batch: a batch's entry replaces the one with its id, so applying twice changes nothing).
 * @param {ReturnType<typeof batches>} bs
 */
export function applyGrammar(bs = batches()) {
  /** @type {any[]} */ const concepts = J(FILES.concepts);
  /** @type {any[]} */ let items = J(FILES.items);
  const b1 = b1GrammarIds();
  for (const b of bs) {
    const stamp = b.review ? { reviewedBy: b.review.reviewedBy, reviewedAt: b.review.reviewedAt } : null;
    const reviewed = new Set((b.review && b.review.ids) || []);
    for (const c of b.source.concepts || []) {
      const clean = Object.fromEntries(CONCEPT_KEYS.filter(k => c[k] !== undefined).map(k => [k, c[k]]));
      const i = concepts.findIndex(x => x.id === c.id);
      if (i >= 0) concepts[i] = clean; else concepts.push(clean);
    }
    for (const it of b.source.items || []) {
      const clean = /** @type {any} */ (Object.fromEntries(ITEM_KEYS.map(k => [k, it[k]])));
      const i = items.findIndex(x => x.id === it.id);
      if (i >= 0) items[i] = clean;
      else {
        let at = -1;
        items.forEach((x, k) => { if (x.concept === it.concept) at = k; });
        if (at < 0) items.push(clean); else items.splice(at + 1, 0, clean);
      }
    }
    // stamps: the ids the review covered (new items and the existing ones it checked)
    if (stamp) items = items.map(x => (reviewed.has(`G:${x.id}`) || reviewed.has(x.id) ? { ...stripStamp(x), ...stamp } : x));
  }
  // layer: every B2 item outside the B1 trainer; a concept's level wins (a concept moved to B2 moves its items)
  const level = new Map(concepts.map(c => [c.id, c.level]));
  items = items.map(x => {
    const { layer, reviewedBy, reviewedAt, ...rest } = x;
    const lv = level.get(x.concept) || x.level;
    const y = { ...rest, level: lv };
    if (lv === 'B2' && !b1.has(x.id)) y.layer = 'b2';
    if (reviewedBy) Object.assign(y, { reviewedBy, reviewedAt });
    return y;
  });
  return { [FILES.concepts]: out1(concepts), [FILES.items]: out1(items) };
}
const stripStamp = (/** @type {any} */ x) => { const { reviewedBy, reviewedAt, ...r } = x; return r; };

/**
 * The phrase files with every batch's `phrases` applied: the German parts (t, ex, n, fn, dupOf, stamps), the accepted
 * answers (core_en, accept, stamps), new English source entries, and what is assembled from them (german.json,
 * accept_german.json, en.json, and the b2 function list in priority_de.json). A phrase entry with `en` is new.
 * @param {ReturnType<typeof batches>} bs
 */
export function applyPhrases(bs = batches()) {
  const dir = (/** @type {string} */ d) => readdirSync(path.join(ROOT, d)).filter(n => n.endsWith('.json')).sort();
  /** @type {Map<string, any[]>} */ const parts = new Map(dir(PARTS).filter(n => /^batch\d+\.json$/.test(n)).map(n => [n, J(`${PARTS}/${n}`)]));
  /** @type {Map<string, Record<string, any>>} */ const acc = new Map(dir(ACCEPT).filter(n => /^p\d+\.json$/.test(n)).map(n => [n, J(`${ACCEPT}/${n}`)]));
  /** @type {any[]} */ const en = J(FILES.en);
  /** @type {Map<string, any[]>} */ const srcs = new Map(dir(SRC).filter(n => /^batch(1[6-9]|[2-9]\d)\.json$/.test(n)).map(n => [n, J(`${SRC}/${n}`)]));
  const bank = new Set(Object.keys(J('content/b1/bank.json')));
  const rowOf = (/** @type {string} */ id) => { for (const [f, rows] of parts) { const r = rows.find(x => x.id === id); if (r) return r; } return null; };
  const accOf = (/** @type {string} */ id) => { for (const [, d] of acc) if (d[id]) return d; return null; };
  const touched = new Set();
  for (const b of bs) {
    const stamp = b.review ? { reviewedBy: b.review.reviewedBy, reviewedAt: b.review.reviewedAt } : null;
    const reviewed = new Set((b.review && b.review.ids) || []);
    for (const [id, ov] of Object.entries(b.source.phrases || {})) {
      if (ov.en) {
        // a new phrase: its English source, its German part (batch file by number) and its accept part (the batch's)
        const erow = Object.fromEntries(EN_KEYS.filter(k => ov.en[k] !== undefined || k === 'id').map(k => [k, k === 'id' ? id : ov.en[k]]));
        const ei = en.findIndex(e => e.id === id); if (ei >= 0) en[ei] = erow; else en.push(erow);
        // new phrases go into a source batch of their own (batch16 …), never into one other languages already translated
        const f = `${ov.part || b.source.part}.json`;
        if (!/^batch(1[6-9]|[2-9]\d)\.json$/.test(f)) throw new Error(`${b.name}: new phrase ${id} needs part batch16 or later (source.part)`);
        if (!parts.has(f)) parts.set(f, []);
        if (!rowOf(id)) /** @type {any[]} */ (parts.get(f)).push({ id });
        if (!srcs.has(f)) srcs.set(f, []);
        const sr = /** @type {any[]} */ (srcs.get(f));
        const srow = Object.fromEntries(SRC_KEYS.map(k => [k, k === 'id' ? id : ov.en[k]]));
        const si = sr.findIndex(x => x.id === id); if (si >= 0) sr[si] = srow; else sr.push(srow);
        const af = ov.acceptPart || b.source.acceptPart;
        if (!/^p\d+\.json$/.test(af || '')) throw new Error(`${b.name}: new phrase ${id} needs acceptPart p<N>.json (source.acceptPart)`);
        if (!accOf(id)) { if (!acc.has(af)) acc.set(af, {}); /** @type {any} */ (acc.get(af))[id] = {}; }
      }
      const r = rowOf(id), a = accOf(id);
      if (!r || !a) throw new Error(`${b.name}: phrase ${id} has no German part or accept entry`);
      for (const k of ['t', 'ex', 'n', 'fn', 'fvg', 'dupOf']) if (k in ov) { if (ov[k] == null) delete r[k]; else r[k] = ov[k]; }
      for (const k of ['core_en', 'accept', 'weak']) if (k in ov) { if (ov[k] == null) delete a[id][k]; else a[id][k] = ov[k]; }
      if (stamp && reviewed.has(`K:${id}`)) { Object.assign(r, stamp); Object.assign(a[id], stamp); }
      touched.add(id);
    }
  }
  en.sort((x, y) => x.id.localeCompare(y.id));
  const level = new Map(en.map(e => [e.id, e.level || e.cefr_level]));
  /** @type {Record<string, string>} */ const files = {};
  const chunks = /** @type {Record<string, any>} */ ({});
  for (const [f, rows] of [...parts].sort()) {
    const out = rows.map(r => {
      const { layer, ...rest } = r;
      const y = /** @type {any} */ ({ ...rest });
      if (level.get(r.id) === 'B2' && !bank.has(r.id) && r.fn) y.layer = 'b2';
      return Object.fromEntries(ROW_KEYS.filter(k => y[k] !== undefined).map(k => [k, y[k]]));
    }).sort((x, y) => x.id.localeCompare(y.id));
    files[`${PARTS}/${f}`] = py0(out);
    for (const r of out) chunks[r.id] = Object.fromEntries(ASSEMBLE_KEYS.filter(k => r[k]).map(k => [k, r[k]]));
  }
  for (const [f, rows] of srcs) files[`${SRC}/${f}`] = py0([...rows].sort((x, y) => x.id.localeCompare(y.id)));
  const merged = /** @type {Record<string, any>} */ ({});
  for (const [f, d] of [...acc].sort()) {
    const out = Object.fromEntries(Object.entries(d).sort(([x], [y]) => x.localeCompare(y)).map(([id, e]) => [id, Object.fromEntries(ACCEPT_KEYS.filter(k => e[k] !== undefined).map(k => [k, e[k]]))]));
    files[`${ACCEPT}/${f}`] = py1(out);
    Object.assign(merged, out);
  }
  // a source file keeps its trailing newline (some have one, some do not)
  for (const p of Object.keys(files)) if (existsSync(path.join(ROOT, p)) && readFileSync(path.join(ROOT, p), 'utf8').endsWith('\n')) files[p] += '\n';
  files[FILES.german] = JSON.stringify({ lang: 'german', chunks: Object.fromEntries(Object.entries(chunks).sort(([x], [y]) => x.localeCompare(y))) });
  files[FILES.accept] = JSON.stringify(Object.fromEntries(Object.entries(merged).sort(([x], [y]) => x.localeCompare(y)))) + '\n';
  files[FILES.en] = JSON.stringify(en);
  // the B2 function groups beside the B1 functions (additive; readiness.functionMap reads only `functions`)
  const prio = J(FILES.priority);
  const groups = Object.keys(FN).map(id => ({ id, en: FN[id], chunk_ids: Object.keys(chunks).filter(c => chunks[c].fn === id && !chunks[c].dupOf).sort() })).filter(g => g.chunk_ids.length);
  const { b2: _old, ...rest } = prio;
  files[FILES.priority] = py1(groups.length ? { ...rest, b2: groups } : rest) + '\n';
  return files;
}

/**
 * Graded texts: every batch's `texts`, in readers@1 shape (C0), into content/read/de.json. The authoring shape keeps a
 * sentence's German in `de` and may carry notes (type, spelling for old texts, a source's collection); readers@1 has
 * `text`, the schema's fields only, `words` counted with the pack's tokenizer, and the review stamp per text. A bridge
 * text ("B1+") is level B1 in readers@1; its id (read/de/b1p-…) keeps it apart.
 * @param {ReturnType<typeof batches>} bs @param {(s: string) => any[]} tokenize
 */
export function applyTexts(bs, tokenize) {
  /** @type {any[]} */ const texts = [];
  for (const b of bs) {
    const stamp = b.review ? { reviewedBy: b.review.reviewedBy, reviewedAt: b.review.reviewedAt } : null;
    const reviewed = new Set((b.review && b.review.ids) || []);
    for (const t of b.source.texts || []) {
      const sections = t.sections.map((/** @type {any} */ x) => ({ id: x.id, ...(x.title ? { title: x.title } : {}),
        sentences: x.sentences.map((/** @type {any} */ y) => ({ id: y.id, text: y.de ?? y.text, en: y.en ?? null })) }));
      const body = sections.flatMap(x => x.sentences.map(y => y.text)).join(' ').replace(/\s+/g, ' ').trim();
      const src = t.source ? { author: t.source.author, work: t.source.work, ...(t.source.year ? { year: t.source.year } : {}), ...(t.source.url ? { url: t.source.url } : {}) } : null;
      texts.push({ id: t.id, level: t.level === 'B1+' ? 'B1' : t.level, ...(t.dom ? { dom: t.dom } : {}), title: t.title, licence: t.licence, source: src,
        words: tokenize(body).length, sections, targets: t.targets,
        questions: t.questions.map((/** @type {any} */ q) => ({ id: q.id, type: q.type, skill: q.skill, q: q.q, options: q.options, answer: q.answer, evidence: q.evidence })),
        ...(stamp && reviewed.has(t.id) ? stamp : {}) });
    }
  }
  return texts.length ? { [FILES.read]: JSON.stringify({ lang: 'de', texts }, null, 1) + '\n' } : {};
}

/**
 * Words: a batch's `words` (new B2 entries with id and zipf computed when authored) go after the last B2 word with
 * ranks after the level's last; its `dom` ({word id: [domains]}) tags existing words; its `morph` ({word id: {pre,
 * stem, suf, sep?}}) joins authoring/clusters/morph.de.json, which tools/build-clusters.mjs reads for every word.
 * @param {ReturnType<typeof batches>} bs
 */
export function applyWords(bs) {
  if (!bs.some(b => b.source.words || b.source.dom || b.source.morph)) return {};
  /** @type {any[]} */ const words = J(FILES.words);
  /** @type {Record<string, any>} */ const morph = J(FILES.morph);
  const tidy = (/** @type {any} */ w) => {
    const out = /** @type {any} */ ({});
    for (const k of WORD_KEYS) if (w[k] !== undefined) out[k] = w[k];
    if (w.dom) out.dom = w.dom;
    if (w.reviewedBy) Object.assign(out, { reviewedBy: w.reviewedBy, reviewedAt: w.reviewedAt });
    return out;
  };
  for (const b of bs) {
    const stamp = b.review ? { reviewedBy: b.review.reviewedBy, reviewedAt: b.review.reviewedAt } : null;
    const reviewed = new Set((b.review && b.review.ids) || []);
    for (const [id, dom] of Object.entries(b.source.dom || {})) {
      const i = words.findIndex(w => w.id === id);
      if (i < 0) throw new Error(`${b.name}: dom for ${id}, which is not in the word list`);
      words[i] = tidy({ ...words[i], dom });
    }
    let last = -1, rank = 0;
    words.forEach((w, i) => { if (w.level === 'B2') { last = i; rank = Math.max(rank, w.rank || 0); } });
    const add = [];
    for (const w of b.source.words || []) {
      const cur = words.findIndex(x => x.id === w.id);
      const entry = tidy({ ...w, rank: cur >= 0 ? words[cur].rank : ++rank, alt: w.alt || [], ...(stamp && reviewed.has(`W:${w.id}`) ? stamp : {}) });
      if (cur >= 0) words[cur] = entry; else add.push(entry);
    }
    words.splice(last + 1, 0, ...add);
    for (const [id, m] of Object.entries(b.source.morph || {})) morph[id] = m;
  }
  const morphText = '{\n' + Object.entries(morph).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v).replace(/,"/g, ', "').replace(/":/g, '": ')}`).join(',\n') + '\n}\n';
  // unchanged entries keep their text as it is on disk (parts were written by Python, which spells a float 6.0)
  const raw = new Map(rawEntries(readFileSync(path.join(ROOT, FILES.words), 'utf8')).map(t => [JSON.parse(t).id, t]));
  const text = '[' + words.map(w => { const r = raw.get(w.id); return r && JSON.stringify(JSON.parse(r)) === JSON.stringify(w) ? r : JSON.stringify(w); }).join(',') + ']\n';
  // tools/build-clusters.mjs wants its added words to equal their entries in the list ("edit both")
  const byId = new Map(words.map(w => [w.id, w]));
  /** @type {any[]} */ const added = J(FILES.added);
  const addedText = JSON.stringify(added.map(a => byId.get(a.id) || a), null, 1) + '\n';
  return { [FILES.words]: text, [FILES.morph]: morphText, [FILES.added]: addedText };
}

/** The top-level entries of a JSON array of objects, as their own text. @param {string} text */
function rawEntries(text) {
  const out = []; let depth = 0, start = -1, str = false, esc = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (str) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') str = false; continue; }
    if (c === '"') str = true;
    else if (c === '{') { if (depth++ === 0) start = i; }
    else if (c === '}') { if (--depth === 0) out.push(text.slice(start, i + 1)); }
  }
  return out;
}

/** Every batch applied, as {path: text}. */
export function applyAll(bs = batches()) {
  return { ...applyGrammar(bs), ...applyPhrases(bs), ...applyTexts(bs, tokenizeDe), ...applyWords(bs) };
}

/* ---------- machine gates ---------- */

/** The app's grading data, built as the corpus builds it, with the B2 grammar items as G: pool items (topic = concept). */
export async function gradingData(files = applyAll()) {
  const imp = (/** @type {string} */ p) => import(pathToFileURL(path.join(ROOT, p)).href);
  const { buildPool } = await imp('src/features/shared/pool.js');
  const items = JSON.parse(files[FILES.items]), concepts = JSON.parse(files[FILES.concepts]);
  const b2 = items.filter((/** @type {any} */ x) => x.layer === 'b2' || x.level === 'B2');
  const plan = J('content/b1/plan.json');
  const topics = [...plan.topics, ...concepts.filter((/** @type {any} */ c) => c.level === 'B2' && !plan.topics.some((/** @type {any} */ t) => t.id === c.id))
    .map((/** @type {any} */ c, /** @type {number} */ i) => ({ id: c.id, rank: 200 + i, concepts: [c.id] }))];
  // the B2 phrases as bank phrases (K: cards), built as pool.js builds the B1 bank's
  const german = JSON.parse(files[FILES.german]).chunks, accept = JSON.parse(files[FILES.accept]), en = JSON.parse(files[FILES.en]);
  const bank = { ...J('content/b1/bank.json') };
  /** @type {string[]} */ const phrases = [];
  for (const e of en) {
    const d = german[e.id], a = accept[e.id];
    if (!d || !a || d.layer !== 'b2' || bank[e.id]) continue;
    bank[e.id] = { en: e.natural_example, hl: a.core_en, accept: a.accept, ex: d.ex, n: d.n || '', level: e.level, fn: d.fn, prio: 3 };
    phrases.push(e.id);
  }
  const data = buildPool({ items: J('content/b1/items.json'), grammar: [...J('content/b1/grammar.json'), ...b2.map((/** @type {any} */ g) => ({ ...g, topic: g.concept }))],
    bank, plan: { ...plan, topics }, nouns: J('content/b1/nouns.json'),
    lexWords: J('content/igloo/words/de.json'), lexTexts: Object.values(J('content/igloo/chunks/german.json').chunks).map((/** @type {any} */ c) => c.ex).filter(Boolean),
    schreiben: J('content/b1/schreiben.json') });
  return { data, b2, phrases, bank, german };
}

/**
 * The gates over the B2-layer grammar items: every accepted answer right, the model right with no detector, every near
 * miss wrong, and the corpus's generated errors never right. only: limit to these item ids (a batch).
 * @param {{only?: Set<string> | null}} [o]
 */
export async function gates({ only = null, bs = batches() } = {}) {
  const { gradeAnswer } = await import(pathToFileURL(path.join(ROOT, 'src/features/shared/grade.js')).href);
  const Det = (await import(pathToFileURL(path.join(ROOT, 'src/domain/detect.js')).href)).default;
  const Match = await import(pathToFileURL(path.join(ROOT, 'src/domain/match.js')).href);
  const C = await import(pathToFileURL(path.join(ROOT, 'tests/corpus/grading-corpus.mjs')).href);
  const { data, b2, phrases, bank, german } = await gradingData(applyAll(bs));
  const lex = C.lexicon(ROOT);
  const near = nearMisses(bs);
  const opts = { ...data, nouns: data.nouns, traps: data.traps };
  /** @type {{id: string, cls: string, text: string, why: string}[]} */ const problems = [];
  let rights = 0, wrongs = 0, gen = 0;
  for (const g of b2) {
    if (only && !only.has(g.id)) continue;
    const it = data.byId.get('G:' + g.id);
    if (!it) { problems.push({ id: g.id, cls: 'missing', text: '', why: 'not built into the pool' }); continue; }
    const ans = [].concat(g.answer);
    const grade = (/** @type {string} */ t) => gradeAnswer(it, t, null, opts);
    // every accepted answer, and the model sentence, are right with nothing flagged
    for (const a of ans) {
      const r = grade(a); rights++;
      if (!r.ok) problems.push({ id: g.id, cls: 'answer-wrong', text: a, why: r.det ? `detector ${r.det.cls}` : 'the grader rejects an accepted answer' });
    }
    const full = it.gap ? ans.map(a => (Match.gapFill(g.prompt, a) || {}).text).filter(Boolean) : ans;
    for (const s of full) {
      if (g.kind === 'order' && !/^\p{Lu}/u.test(s)) continue;   // an order item's short answer is a fragment
      const det = Det.run(s, { model: s }, null, { verbs: data.verbs });
      if (det) problems.push({ id: g.id, cls: 'detector-fires', text: s, why: `${det.cls}: ${det.hint}` });
    }
    // the word-order classes without the word list (tests/unit/b1.test.mjs: no fires on right Igloo sentences)
    for (const a of ans) if (String(a).split(' ').length > 2 && Det.classes(a, a).length) problems.push({ id: g.id, cls: 'classes-fire', text: a, why: Det.classes(a, a).join(',') });
    // near misses: wrong
    for (const [text, why] of near.get(g.id) || []) {
      const r = grade(text); wrongs++;
      if (r.ok) problems.push({ id: g.id, cls: 'near-miss-right', text, why });
    }
    // the corpus's error generators on every full answer (wrong article, ending, umlaut form …): never right
    for (const s of full) for (const e of C.errorsIn(s, { lex })) {
      const typed = it.gap ? gapPart(g.prompt, e.text) : e.text;
      if (typed == null || ans.some(a => norm(a) === norm(typed))) continue;
      const r = grade(typed); gen++;
      if (r.ok) problems.push({ id: g.id, cls: `generated-right:${e.cls}`, text: typed, why: 'a generated error graded right (check: really wrong here?)' });
    }
  }
  // phrases: the model sentence is right and whole (the rest of the sentence too), no detector fires on it, the English
  // example holds the highlighted span, and near misses are wrong
  const pnear = phraseNear(bs);
  let nPhrases = 0;
  for (const id of phrases) {
    if (only && !only.has(id)) continue;
    nPhrases++;
    const it = data.byId.get('K:' + id), b = bank[id];
    if (!it) { problems.push({ id, cls: 'missing', text: '', why: 'phrase not built into the pool' }); continue; }
    if (!String(b.en).toLowerCase().includes(String(b.hl).toLowerCase())) problems.push({ id, cls: 'core-en', text: b.hl, why: 'not in the English example' });
    if (!b.ex) { problems.push({ id, cls: 'no-example', text: '', why: 'no German example' }); continue; }
    // the grader treats gern and gerne as different words: a pattern with one has a twin with the other
    for (const pat of b.accept) {
      const has = (/** @type {string} */ w) => new RegExp(`(^|[\\s(])${w}([\\s)]|$)`).test(pat);
      if (has('gern') && !has('gerne') && !b.accept.includes(pat.replace(/\bgern\b/g, 'gerne'))) problems.push({ id, cls: 'gern-gerne', text: pat, why: 'add the gerne twin (or (gern) (gerne))' });
    }
    // tools/validate_chunks.py's limits
    const d = german[id] || {};
    if (String(d.t || '').length > 120) problems.push({ id, cls: 'length', text: d.t, why: 't over 120 characters' });
    if (String(d.ex || '').length > 200) problems.push({ id, cls: 'length', text: d.ex, why: 'ex over 200 characters' });
    if (d.n != null && String(d.n).length > 160) problems.push({ id, cls: 'length', text: d.n, why: 'n over 160 characters' });
    const r = gradeAnswer(it, b.ex, null, opts); rights++;
    if (!r.ok) problems.push({ id, cls: 'model-wrong', text: b.ex, why: r.det ? `detector ${r.det.cls}` : 'the example matches no accepted pattern' });
    else if (r.rest && r.rest.status === 'differs') problems.push({ id, cls: 'model-partial', text: b.ex, why: 'the rest of the example differs from itself' });
    const det = Det.run(b.ex, { model: b.ex }, null, { verbs: data.verbs });
    if (det) problems.push({ id, cls: 'detector-fires', text: b.ex, why: `${det.cls}: ${det.hint}` });
    if (Det.classes(b.ex, b.ex).length) problems.push({ id, cls: 'classes-fire', text: b.ex, why: Det.classes(b.ex, b.ex).join(',') });
    for (const [text, why] of pnear.get(id) || []) if (text.trim().split(/\s+/).length < 2 || !why.trim()) problems.push({ id, cls: 'near-shape', text, why: 'a near miss is a sentence with its reason' });
    for (const [text, why] of pnear.get(id) || []) {
      const g = gradeAnswer(it, text, null, opts); wrongs++;
      if (g.ok && !(g.rest && g.rest.status === 'differs')) problems.push({ id, cls: 'near-miss-right', text, why });
    }
  }
  // words: forms, the example holds the word, no detector on the example, a prompt no other word shows, valid domains
  let nWords = 0;
  if (bs.some(b => b.source.words || b.source.dom)) {
    const F = await import(pathToFileURL(path.join(ROOT, 'src/domain/forms.js')).href);
    const files = applyAll(bs);
    const words = JSON.parse(files[FILES.words]);
    for (const e of F.validateForms(J('content/b1/forms.json'), words)) problems.push({ id: 'forms', cls: 'forms', text: e, why: '' });
    const ix = F.formsIndex(words, J('content/b1/forms.json'));
    const shown = (/** @type {any} */ w) => (w.en || []).slice(0, 3).join('; ').trim().toLowerCase();
    const prompts = new Map(); for (const w of words) { const k = shown(w); prompts.set(k, [...(prompts.get(k) || []), w.id]); }
    const DOMS = new Set(['work', 'economy', 'news', 'politics', 'science', 'tech', 'health', 'environment', 'society', 'general']);
    const mine = new Set(bs.flatMap(b => (b.source.words || []).map((/** @type {any} */ w) => w.id)));
    for (const w of words) {
      if (w.dom && (!w.dom.length || w.dom.some((/** @type {string} */ d) => !DOMS.has(d)) || (w.dom.includes('general') && w.dom.length > 1))) problems.push({ id: w.id, cls: 'dom', text: w.dom.join(','), why: 'domains from the list; general alone' });
      if (['B2', 'C1'].includes(w.level) && !w.dom) problems.push({ id: w.id, cls: 'dom', text: '', why: 'a B2/C1 word without dom' });
      if (!mine.has(w.id) || (only && !only.has(w.id))) continue;
      nWords++;
      if (w.level !== 'B2') problems.push({ id: w.id, cls: 'level', text: w.level, why: 'new words stay at B2 (B1 numbers must not move)' });
      const f = F.formsOf(ix, { lemma: w.w, pos: w.pos, id: `W:${w.id}` });
      if (!w.ex || !F.findForm(w.ex, [w.w, ...((f && f.surface) || [])])) problems.push({ id: w.id, cls: 'example', text: w.ex, why: 'the example does not hold the word' });
      const det = w.ex ? Det.run(w.ex, { model: w.ex }, null, { verbs: data.verbs }) : null;
      if (det) problems.push({ id: w.id, cls: 'detector-fires', text: w.ex, why: det.cls });
      if ((prompts.get(shown(w)) || []).length > 1) problems.push({ id: w.id, cls: 'prompt', text: shown(w), why: `also ${prompts.get(shown(w)).filter((/** @type {string} */ x) => x !== w.id).join(', ')}` });
    }
  }
  // graded texts
  let nTexts = 0;
  for (const b of bs) {
    const texts = (b.source.texts || []).filter((/** @type {any} */ t) => !only || only.has(t.id));
    nTexts += texts.length;
    for (const e of await textErrors(texts, { verbs: data.verbs })) problems.push({ id: b.name, cls: 'text', text: e, why: '' });
  }
  return { problems, counts: { items: only ? [...only].filter(x => /^[a-z0-9-]+\.\d{2}$/.test(x)).length : b2.length, phrases: nPhrases, texts: nTexts, words: nWords, rights, nearMisses: wrongs, generated: gen } };
}
const norm = (/** @type {string} */ s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
/** The words a filled gap sentence has in the gap's place, or null when the error is outside the gap. @param {string} prompt @param {string} filled */
function gapPart(prompt, filled) {
  const [a, b] = String(prompt).split('___');
  const pre = a.replace(/\s*\([^)]*\)\s*$/, ''), post = (b || '').replace(/\s*\([^)]*\)\s*$/, '');
  if (!filled.startsWith(pre.trimEnd().slice(0, Math.max(0, pre.trimEnd().length)))) return null;
  const postT = post.trim();
  const tail = postT ? filled.lastIndexOf(postT.slice(0, Math.min(postT.length, 40))) : filled.length;
  if (tail < 0) return null;
  const mid = filled.slice(pre.length, tail).trim();
  return mid || null;
}

/** item id → [[text, why]] from every batch's source.json `near`. */
export function nearMisses(bs = batches()) {
  /** @type {Map<string, [string, string][]>} */ const m = new Map();
  for (const b of bs) for (const it of b.source.items || []) if (it.near) m.set(it.id, it.near.map((/** @type {any} */ x) => (Array.isArray(x) ? x : [x, ''])));
  return m;
}

/**
 * The review rules (S10, CONTENT-INPUT-PLAN §3.6): every batch has its REVIEW.json covering all its entries, and every
 * B2-layer grammar item and phrase in content carries reviewedBy and reviewedAt; every B2 concept has a rank and fn.
 */
export function stampErrors(bs = batches()) {
  const out = [];
  for (const b of bs) {
    if (!b.review) { out.push(`authoring/de/b2/${b.name}: no REVIEW.json`); continue; }
    if (b.review.reviewedBy !== 'model-2pass' || !/^\d{4}-\d{2}-\d{2}$/.test(b.review.reviewedAt || '')) out.push(`${b.name}/REVIEW.json: reviewedBy model-2pass and reviewedAt YYYY-MM-DD`);
    const ids = new Set(b.review.ids || []);
    for (const x of b.source.items || []) if (!ids.has(`G:${x.id}`)) out.push(`${b.name}: G:${x.id} is not in REVIEW.json ids`);
    for (const id of Object.keys(b.source.phrases || {})) if (!ids.has(`K:${id}`)) out.push(`${b.name}: K:${id} is not in REVIEW.json ids`);
    for (const t of b.source.texts || []) if (!ids.has(t.id)) out.push(`${b.name}: ${t.id} is not in REVIEW.json ids`);
  }
  for (const x of J(FILES.items)) if (x.layer === 'b2' && !x.reviewedBy) out.push(`G:${x.id}: a B2-layer item without reviewedBy`);
  for (const [id, c] of Object.entries(J(FILES.german).chunks)) if (/** @type {any} */ (c).layer === 'b2' && !/** @type {any} */ (c).reviewedBy) out.push(`K:${id}: a B2-layer phrase without reviewedBy`);
  for (const c of J(FILES.concepts)) if (c.level === 'B2' && (c.rank == null || !c.fn)) out.push(`concept ${c.id}: a B2 concept needs rank and fn`);
  return out;
}

/** Licences a graded text may carry (CONTENT-INPUT-PLAN §2.6): our own, public domain, or CC BY 4.0. */
export const LICENCES = new Set(['own', 'PD', 'CC-BY-4.0']);
const LEVEL_WORDS = /** @type {Record<string, [number, number]>} */ ({ 'B1+': [200, 300], B2: [330, 480] });
/**
 * The rules for graded texts (readers@1 shape): ids read/<lang>/<slug> (never card-like, PLAN-REVIEW N1), a licence from
 * LICENCES (PD texts name their source), unique sentence and question ids, every question's answer in range and its
 * evidence a verbatim part of the text, tf questions richtig/falsch, words in the level's range, targets that exist, and
 * no sticky-error detector firing on a sentence.
 * @param {any[]} texts @param {{verbs?: Set<string> | null}} [o]
 */
export async function textErrors(texts, { verbs = null } = {}) {
  const Det = (await import(pathToFileURL(path.join(ROOT, 'src/domain/detect.js')).href)).default;
  const words = new Set(J('content/igloo/words/de.json').map((/** @type {any} */ w) => w.id));
  const concepts = new Set(J(FILES.concepts).map((/** @type {any} */ c) => c.id));
  const out = [], ids = new Set();
  for (const t of texts) {
    const at = t.id || '?';
    if (!/^read\/de\/[a-z0-9]+(-[a-z0-9]+)*$/.test(t.id || '')) out.push(`${at}: id must be read/de/<slug>`);
    if (ids.has(t.id)) out.push(`${at}: duplicate id`); ids.add(t.id);
    if (!LICENCES.has(t.licence)) out.push(`${at}: licence ${t.licence} (own, PD or CC-BY-4.0)`);
    if (t.licence !== 'own' && !(t.source && t.source.author && t.source.work)) out.push(`${at}: a ${t.licence} text names its source (author, work)`);
    const sents = (t.sections || []).flatMap((/** @type {any} */ x) => x.sentences || []);
    const sid = new Set();
    for (const x of sents) {
      if (sid.has(x.id)) out.push(`${at}#${x.id}: duplicate sentence id`); sid.add(x.id);
      if (!x.de || !x.en) out.push(`${at}#${x.id}: de and en`);
      const det = x.de && t.licence === 'own' ? Det.run(x.de, { model: x.de }, null, { verbs }) : null;
      if (det) out.push(`${at}#${x.id}: detector ${det.cls} fires: ${x.de}`);
    }
    const full = sents.map((/** @type {any} */ x) => x.de).join(' ');
    const n = (full.match(/[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu) || []).length;
    const range = LEVEL_WORDS[t.level];
    if (t.licence === 'own' && range && (n < range[0] || n > range[1])) out.push(`${at}: ${n} words, ${t.level} wants ${range[0]}–${range[1]}`);
    const qid = new Set();
    for (const q of t.questions || []) {
      if (qid.has(q.id)) out.push(`${at}#${q.id}: duplicate question id`); qid.add(q.id);
      if (!['mc', 'tf'].includes(q.type)) out.push(`${at}#${q.id}: type mc or tf`);
      if (q.type === 'tf' && JSON.stringify(q.options) !== '["richtig","falsch"]') out.push(`${at}#${q.id}: tf options are richtig, falsch`);
      if (q.type === 'mc' && (!Array.isArray(q.options) || q.options.length < 3 || new Set(q.options).size !== q.options.length)) out.push(`${at}#${q.id}: 3+ distinct options`);
      if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= (q.options || []).length) out.push(`${at}#${q.id}: answer out of range`);
      if (!q.evidence || !full.includes(q.evidence)) out.push(`${at}#${q.id}: evidence is not verbatim in the text`);
      if (!['global', 'detail', 'inference', 'attitude'].includes(q.skill)) out.push(`${at}#${q.id}: skill`);
    }
    if ((t.questions || []).length < 5) out.push(`${at}: 5 questions`);
    for (const x of t.targets || []) {
      if (x.startsWith('W:') ? !words.has(x.slice(2)) : x.startsWith('GC:') ? !concepts.has(x.slice(3)) : !/^K:ENG_CHUNK_\d{4}$/.test(x)) out.push(`${at}: target ${x} does not exist`);
    }
  }
  return out;
}

/** phrase id → [[text, why]] from every batch's source.json phrases[id].near. */
export function phraseNear(bs = batches()) {
  /** @type {Map<string, [string, string][]>} */ const m = new Map();
  const pair = (/** @type {any} */ x) => (Array.isArray(x) ? [String(x[0]), String(x[1] || '')] : typeof x === 'string' ? [x, ''] : [String(x.text || x.answer || ''), String(x.why || '')]);
  for (const b of bs) for (const [id, p] of Object.entries(b.source.phrases || {})) {
    const n = /** @type {any} */ (p).near;
    if (n) m.set(id, /** @type {[string, string][]} */ ((Array.isArray(n) ? n : [n]).map(pair)));
  }
  return m;
}

/**
 * The keys his tutor checks (PLAN-REVIEW S10): the Konjunktiv, passive and indirect-speech items (and the Ersatzinfinitiv,
 * the same verb clusters) that round 4 wrote or changed, in content order.
 */
export function tutorItems(bs = batches()) {
  const concepts = new Map(J(FILES.concepts).map((/** @type {any} */ c) => [c.id, c]));
  const mine = new Set(bs.flatMap(b => (b.source.items || []).map((/** @type {any} */ x) => x.id)));
  return J(FILES.items).filter((/** @type {any} */ x) => mine.has(x.id) && x.layer === 'b2' && (TUTOR_CATEGORIES.has(concepts.get(x.concept)?.category) || TUTOR_CONCEPTS.has(x.concept)));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const cmd = process.argv[2] || 'check';
  if (cmd === 'apply') {
    for (const [p, text] of Object.entries(applyAll())) {
      const cur = existsSync(path.join(ROOT, p)) ? readFileSync(path.join(ROOT, p), 'utf8') : null;
      if (cur !== text) { mkdirSync(path.dirname(path.join(ROOT, p)), { recursive: true }); writeFileSync(path.join(ROOT, p), text); console.log(`wrote ${p}`); }
    }
  } else if (cmd === 'check' || cmd === 'gates') {
    const errs = [];
    if (cmd === 'check') {
      for (const [p, text] of Object.entries(applyAll())) if (!existsSync(path.join(ROOT, p)) || readFileSync(path.join(ROOT, p), 'utf8') !== text) errs.push(`${p} is out of date: run node tools/b2.mjs apply`);
      errs.push(...stampErrors());
    }
    // gates <batch>: one batch of authoring/de/b2; gates <path/source.json>: a draft outside the repo, on top of them
    const name = cmd === 'gates' ? process.argv[3] : null;
    let bs = batches(), b = null;
    if (name && name.endsWith('.json')) {
      b = { name: path.basename(path.dirname(path.resolve(name))), dir: path.dirname(path.resolve(name)), source: JSON.parse(readFileSync(path.resolve(name), 'utf8')), review: null };
      bs = [...bs.filter(x => x.name !== b.name), b];
    } else if (name) b = bs.find(x => x.name === name) || null;
    if (name && !b) { console.error(`no batch ${name}`); process.exit(2); }
    const only = b ? new Set([...(b.source.items || []).map((/** @type {any} */ x) => x.id), ...Object.keys(b.source.phrases || {}), ...(b.source.texts || []).map((/** @type {any} */ t) => t.id), ...(b.source.words || []).map((/** @type {any} */ w) => w.id)]) : null;
    const { problems, counts } = await gates({ only, bs });
    for (const p of problems) errs.push(`${p.cls} ${p.id}: ${p.text} (${p.why})`);
    for (const e of errs) console.error(e);
    console.log(`b2 ${cmd}${name ? ` ${name}` : ''}: ${counts.items} items, ${counts.phrases} phrases, ${counts.texts} texts, ${counts.words || 0} words, ${counts.rights} answers, ${counts.nearMisses} near misses, ${counts.generated} generated errors; ${errs.length} problem(s)`);
    process.exit(errs.length ? 1 : 0);
  } else if (cmd === 'packet') {
    // node tools/b2.mjs packet <batch|source.json>: the batch as reviewers read it (applied, so existing items show too)
    const arg = process.argv[3];
    let bs = batches(), b = arg && arg.endsWith('.json') ? { name: path.basename(path.dirname(path.resolve(arg))), dir: '', source: JSON.parse(readFileSync(path.resolve(arg), 'utf8')), review: null } : bs.find(x => x.name === arg);
    if (!b) { console.error(`no batch ${arg}`); process.exit(2); }
    if (arg.endsWith('.json')) bs = [...bs.filter(x => x.name !== b.name), b];
    const files = applyAll(bs);
    const items = JSON.parse(files[FILES.items]), concepts = JSON.parse(files[FILES.concepts]);
    const near = nearMisses(bs), pn = phraseNear(bs);
    const touched = new Set([...(b.source.concepts || []).map((/** @type {any} */ c) => c.id), ...(b.source.items || []).map((/** @type {any} */ x) => x.concept)]);
    const L = [];
    for (const c of concepts.filter((/** @type {any} */ c) => touched.has(c.id))) {
      L.push(`## Concept ${c.id}: ${c.name} (${c.level}, rank ${c.rank ?? '-'}, fn ${c.fn ?? '-'})`, c.description || '', '');
      for (const x of items.filter((/** @type {any} */ x) => x.concept === c.id)) {
        L.push(`### ${x.id} [${x.kind}]`, `task: ${x.task}`, `prompt: ${x.prompt}`, `answer: ${x.answer.map((/** @type {string} */ a) => `«${a}»`).join(' ')}`, `note: ${x.note}`);
        const nm = near.get(x.id); if (nm) L.push(`near (must be wrong): ${nm.map(([t, w]) => `«${t}» (${w})`).join('; ')}`);
        L.push('');
      }
    }
    const german = JSON.parse(files[FILES.german]).chunks, accept = JSON.parse(files[FILES.accept]), en = new Map(JSON.parse(files[FILES.en]).map((/** @type {any} */ e) => [e.id, e]));
    const ph = Object.keys(b.source.phrases || {});
    if (ph.length) L.push('# Phrases', '');
    for (const id of ph) {
      const e = /** @type {any} */ (en.get(id)), d = german[id], a = accept[id];
      L.push(`### ${id} (${e.level}, ${e.category}, register ${e.register || '-'}) fn: ${d.fn || '-'}`, `English: ${e.chunk} | function: ${e.pragmatic_function}`, `English example: ${e.natural_example}  [highlighted: ${a.core_en}]`,
        `t: ${d.t}`, `ex: ${d.ex}`, `n: ${d.n || ''}`, `accept: ${a.accept.map((/** @type {string} */ x) => `«${x}»`).join(' ')}${a.weak ? ' (weak)' : ''}`);
      const nm = pn.get(id); if (nm) L.push(`near (must be wrong): ${nm.map(([t, w]) => `«${t}» (${w})`).join('; ')}`);
      L.push('');
    }
    console.log(L.join('\n'));
  } else if (cmd === 'blind') {
    // the items of a batch without their answers, for a blind answerer (self-consistency, CONTENT-INPUT-PLAN §3)
    const src = JSON.parse(readFileSync(path.resolve(process.argv[3]), 'utf8'));
    console.log(JSON.stringify((src.items || []).map((/** @type {any} */ x) => ({ id: x.id, kind: x.kind, task: x.task, prompt: x.prompt })), null, 1));
  } else if (cmd === 'grade-blind') {
    // node tools/b2.mjs grade-blind <source.json> <answers.json: {id: answer}>: where the blind answer is graded wrong
    const file = path.resolve(process.argv[3]);
    const src = JSON.parse(readFileSync(file, 'utf8'));
    const b = { name: path.basename(path.dirname(file)), dir: path.dirname(file), source: src, review: null };
    const bs = [...batches().filter(x => x.name !== b.name), b];
    const { gradeAnswer } = await import(pathToFileURL(path.join(ROOT, 'src/features/shared/grade.js')).href);
    const { data } = await gradingData(applyAll(bs));
    const ans = JSON.parse(readFileSync(path.resolve(process.argv[4]), 'utf8'));
    let n = 0, bad = 0;
    for (const [id, a] of Object.entries(ans)) {
      const it = data.byId.get('G:' + id) || data.byId.get('K:' + id); if (!it) { console.log(`${id}: no item`); continue; }
      n++;
      const r = gradeAnswer(it, a, null, { ...data, nouns: data.nouns, traps: data.traps });
      if (!r.ok) { bad++; console.log(`${id}\t${a}\t(key: ${it.accept.join(' | ')})${r.det ? ` [detector ${r.det.cls}]` : ''}`); }
      else if (r.rest && r.rest.status === 'differs') console.log(`${id}\tphrase right, rest differs: ${a}`);
    }
    console.log(`blind answers: ${n}, graded wrong: ${bad}`);
  } else if (cmd === 'tutor') {
    const rows = tutorItems();
    const concepts = new Map(J(FILES.concepts).map((/** @type {any} */ c) => [c.id, c]));
    const lines = ['# B2 keys for a tutor to check', '',
      'These are the Konjunktiv II, Konjunktiv I / indirect speech and passive items of the B2 layer. Each was written and then',
      'checked by two independent model review passes (`reviewedBy: model-2pass`), not by a native speaker. A wrong key here',
      'would teach a wrong form for years, so a native teacher should read the answers once.', '',
      'How to check: read the prompt, then the accepted answers. Mark anything a native speaker would not say, and any right',
      'answer that is missing. Item ids are stable; quote the id with a correction.', ''];
    let concept = '';
    for (const x of rows) {
      if (x.concept !== concept) { concept = x.concept; lines.push(`## ${concepts.get(concept)?.name || concept} (\`${concept}\`)`, ''); }
      lines.push(`- **${x.id}** · ${x.task} · ${x.prompt.replace(/\n/g, ' ')}`, `  - ${x.answer.join(' | ')}`);
    }
    lines.push('', `${rows.length} items.`, '');
    writeFileSync(path.join(DIR, 'TUTOR-CHECK.md'), lines.join('\n'));
    console.log(`wrote authoring/de/b2/TUTOR-CHECK.md (${rows.length} items)`);
  } else { console.error('usage: node tools/b2.mjs apply|check|gates [batch]|tutor'); process.exit(2); }
}
