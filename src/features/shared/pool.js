/* Practice: the item pool for the one review queue. Pure: content and private lists in, items out; tested in node.
   Ported from Igloo's b1.js build(): B1 items (content b1/items.json), chunk-bank phrases (b1/bank.json, those
   without a B1 twin), Igloo grammar (b1/grammar.json, ranked by plan topics), exam words (words.js) and mistakes
   from corrections (data/mistakes.js). Ids keep their kind prefix (domain/itemids.js).
   Schreiben (b1/schreiben.json): the BS: phrases, and the trainer's letter items it links, go in area writing, grouped
   by Aufgabe (W1, W2, W3) and function (wfn), introduced in the content's rank order.
   The B2 layer (round 4, lane L1b; domain/levels.js): the pack's grammar items of B2 concepts that the B1 trainer
   does not have (igloo.grammar.items.de, topic = their concept, skipped as b1.annot says) and the chunk bank's B2
   phrases with an accept list (igloo.chunks.en/german/accept.german), leaving out what the content marks dupOf (a
   duplicate of another item, which alone is scheduled), built by b2Layer() into data.b2, never into
   data.pool. Each carries layer: 'b2'. data.pool, its readiness, its ★/trap pace and the lexicon are what they were;
   the composer mixes the layer in through the level gate, and a B2 card's reviews come due like any card's
   (data.byId has every item). */
import * as Match from '../../domain/match.js';
import { verbForms } from '../../domain/detect.js';

const TEIL_GROUP = /** @type {Record<string, [string, string]>} */ ({ 'Sprechen T1': ['S1', 'S1'], 'Sprechen T2': ['S2', 'S2'], 'Sprechen T3': ['S3', 'S3'], Forum: ['opinion', 'S3'] });
const PLAN_OF_KIND = /** @type {Record<string, string>} */ ({ transform: 'transform', join: 'transform', order: 'transform', gap: 'recall', 'choose-article': 'recall', translate: 'recall' });

/**
 * A mistake record → a round item: his sentence, rewrite it correctly.
 * @param {import('../../data/mistakes.js').Mistake} m
 */
export function mistakeItem(m) {
  const mod = m.source.module ? m.source.module[0].toUpperCase() + m.source.module.slice(1).replace('oe', 'ö') : null;
  // the corrected words are the point of the card: they must be typed exactly (no typo tolerance, so retyping
  // "Wohnnung" for "Wohnung" or "Freunde" for "Freund" is a miss)
  const inWrong = new Set(Match.words(m.wrong).map((/** @type {any} */ w) => w.n));
  const fixed = [...new Set(Match.words(m.right).filter((/** @type {any} */ w) => !inWrong.has(w.n)).map((/** @type {any} */ w) => w.raw))];
  return {
    id: m.id, kind: 'mistake', area: 'mistakes', group: m.source.module || 'mistakes', teil: null, fn: null, star: true, trap: null,
    focus: [], strict: fixed, plan: 'transform', task: 'Rewrite this sentence correctly.', prompt: m.wrong, promptLang: 'de', hl: null,
    partner: null, prefill: null, accept: [m.right], anywhere: false, literal: true, loose: false, model: m.right, wrong: [m.wrong],
    rule: m.rule || '', src: 'mistake', level: 'B1', mine: true,
    source: m.source.label || [mod, m.source.test ? `Test ${m.source.test}` : null].filter(Boolean).join(' '),
  };
}

const POLITE = new Set(['Sie', 'Ihnen', 'Ihr', 'Ihre', 'Ihren', 'Ihrem', 'Ihrer', 'Ihres']);
/** Polite forms in a sentence, not counting a sentence's first word. @param {string} s */
export const politeIn = s => String(s || '').split(/(?<=[.!?:])\s+/).flatMap(sent => (sent.match(/[\p{L}]+/gu) || []).slice(1).filter(w => POLITE.has(w)));

/**
 * Folded German word forms the content writes: models and accepted answers, grammar answers, the noun list (with
 * plurals) and, when loaded, the word list with its plurals, forms and examples. The matcher treats a typed word that
 * is one of these as that word, never as a typo of another (vieles is not a typo of vielen, Mutter not of Mütter).
 * @param {{items?: any[], grammar?: any[], bank?: Record<string, any>, nouns?: Record<string, string>, lexWords?: any[] | null, lexTexts?: string[] | null}} o
 *   lexTexts: more right German sentences (the chunk examples)
 */
export function buildLexicon({ items = [], grammar = [], bank = {}, nouns = {}, lexWords = null, lexTexts = null, schreiben = null }) {
  /** @type {Set<string>} */ const L = new Set();
  const add = (/** @type {any} */ s) => { if (s) for (const w of Match.words(String(s).replace(/\[[^\]]*\]/g, ' '))) if (w.len > 1) L.add(w.n); };
  for (const k of Object.keys(nouns)) add(k);
  for (const it of items) { add(it.model); (it.accept || []).forEach(add); for (const m of it.moves || []) { add(m.model); (m.accept || []).forEach(add); } }
  for (const g of grammar) [].concat(g.answer).forEach(add);
  for (const b of Object.values(bank)) { add(b.ex); (b.accept || []).forEach(add); }
  for (const w of lexWords || []) { add(w.w); add(w.pl); (w.alt || []).forEach(add); add(w.ex); add(w.forms); }
  for (const t of lexTexts || []) add(t);
  for (const it of (schreiben && schreiben.items) || []) { add(it.model); (it.accept || []).forEach(add); }
  for (const t of (schreiben && schreiben.tasks) || []) for (const p of t.parts) { add(p.model); (p.accept || []).forEach(add); }
  return L;
}

/**
 * @param {{items?: any[], grammar?: any[], bank?: Record<string, any>, plan: any, nouns?: Record<string, string>, words?: any[], mistakes?: any[], lexWords?: any[] | null, lexTexts?: string[] | null, schreiben?: any, b2?: Parameters<typeof b2Layer>[0] | null}} o
 *   words: round items from words.js toItem(); mistakes: mistake records; lexWords: the German word list (igloo.words.de)
 *   and lexTexts: the chunk examples (igloo.chunks.german), both optional, for the grader's lexicon; schreiben: the
 *   Schreiben content (b1-schreiben@1), optional; b2: the B2 layer's sources (b2Layer), optional: data.b2 is empty
 *   without them
 */
export function buildPool({ items = [], grammar = [], bank = {}, plan, nouns = {}, words = [], mistakes = [], lexWords = null, lexTexts = null, schreiben = null, b2 = null }) {
  const topics = new Map(plan.topics.map((/** @type {any} */ t) => [t.id, t]));
  /** @type {Map<string, any>} */ const byId = new Map();
  /** @type {any[]} */ const pool = [];
  const add = (/** @type {any} */ it) => { if (!byId.has(it.id)) { byId.set(it.id, it); pool.push(it); } };
  const twins = new Set(items.map(i => i.chunk).filter(Boolean));
  // mistakes from corrections first, so they win any id clash and sit early in the pool order
  for (const m of mistakes) if (m && !m.deletedAt) add(mistakeItem(m));
  const linked = (schreiben && schreiben.linked) || {};
  for (const a of items) {
    const ln = linked[a.id];
    // a letter item filed under Schreiben: its polite Sie, Ihnen, Ihr … must be typed with the capital (in lower
    // case it is another word), as the Schreiben items have it
    add({ ...a, promptLang: a.prompt_lang, gap: String(a.prompt).includes('___'), mine: false,
      ...(ln ? { area: 'writing', group: a.teil, wfn: ln.fn, rank: ln.rank, tier: 1, aufgabe: `A${String(a.teil).slice(1)}`,
        strict: [...new Set([...(a.strict || []), ...politeIn(a.model)])] } : {}) });
  }
  for (const a of (schreiben && schreiben.items) || []) add({ ...a, promptLang: a.prompt_lang, gap: false, mine: false, wfn: a.fn });
  for (const [cid, b] of Object.entries(bank)) {
    if (twins.has(cid)) continue;
    const [group, teil] = TEIL_GROUP[b.part] || ['opinion', 'S3'];
    add({ id: 'K:' + cid, kind: 'phrase', area: 'speaking', group, teil, fn: b.fn, star: b.prio === 1, trap: null, focus: ['chunk'], strict: [], plan: 'recall',
      task: null, prompt: b.en, promptLang: 'en', hl: b.hl, partner: null, prefill: null, accept: b.accept, anywhere: true,
      model: b.ex && Match.matches(b.ex, b.accept[0]) ? b.ex : Match.renderPattern(b.accept[0], b.ex), wrong: [], rule: b.n || '', src: 'bank', level: b.level, bank: true,
      // the whole German sentence for the English one (the rest of the answer is checked against it)
      sentence: b.ex && b.accept.some((/** @type {string} */ p) => Match.matches(b.ex, p)) ? b.ex : null });
  }
  for (const g of grammar) {
    const t = topics.get(g.topic); if (!t) continue;
    const ans = [].concat(g.answer), gap = String(g.prompt).includes('___');
    const lead = (String(g.prompt).match(/→\s*(.+?)\s*…\s*$/) || [])[1];
    const short = lead ? ans.filter((/** @type {string} */ a) => a.startsWith(lead)).map((/** @type {string} */ a) => a.slice(lead.length).trim()).filter(Boolean) : [];
    add({ id: 'G:' + g.id, kind: 'grammar', area: 'grammar', group: g.topic, teil: null, fn: null, star: !!t.trap, trap: g.trap || null, focus: g.focus || [],
      strict: g.strict || [], plan: PLAN_OF_KIND[g.kind] || 'recall', task: g.task, prompt: g.prompt, promptLang: g.kind === 'translate' ? 'en' : 'de', hl: null,
      partner: null, prefill: null, accept: [...ans, ...short], anywhere: false, literal: true, gap, loose: gap || g.kind !== 'translate',
      model: gap ? (Match.gapFill(g.prompt, ans[0])?.text || ans[0]) : ans[0], wrong: g.wrong || [], rule: g.rule || g.note || '', src: 'igloo', level: g.level,
      strictCase: !!g.strict_case, rank: t.rank });
  }
  for (const it of pool) if (it.area === 'grammar' && it.rank == null) it.rank = topics.get(it.group)?.rank ?? 99;
  for (const w of words) add(w);
  const traps = new Map(plan.traps.map((/** @type {any} */ t) => [t.id, t]));
  const fnInfo = new Map(plan.functions.map((/** @type {any} */ f) => [f.id, f]));
  const writing = schreiben ? { aufgaben: schreiben.aufgaben || [], functions: schreiben.functions || [], tasks: schreiben.tasks || [] } : null;
  // the B2 layer: beside the pool, never in it (readiness, pace and the lexicon read the pool only)
  const layer = b2 ? b2Layer(b2, id => byId.has(id), new Set([...twins].map(String))) : [];
  for (const it of layer) byId.set(it.id, it);
  return { pool, b2: layer, byId, plan, topics, traps, fnInfo, nouns, writing, verbs: lexWords ? verbForms(lexWords) : null, lexicon: buildLexicon({ items, grammar, bank, nouns, lexWords, lexTexts, schreiben }) };
}

/**
 * The B2 layer (see the header): items with layer 'b2', grammar first in concept order, then phrases in bank order.
 * Ids already in the B1 pool (`has`) are left to it.
 * @param {{grammar?: any[] | null, concepts?: any[] | null, annot?: Record<string, any> | null, en?: any[] | null, de?: Record<string, any> | null, accept?: Record<string, any> | null}} src
 * @param {(id: string) => boolean} [has] @param {Set<string>} [twins] chunk ids that are B1 items' twins
 */
export function b2Layer({ grammar = null, concepts = null, annot = null, en = null, de = null, accept = null }, has = () => false, twins = new Set()) {
  /** @type {any[]} */ const out = [];
  const seen = new Set();
  const push = (/** @type {any} */ it) => { if (!has(it.id) && !seen.has(it.id)) { seen.add(it.id); out.push(it); } };
  const level = (/** @type {any} */ x) => String(x || '').toUpperCase();
  const b2c = (concepts || []).filter(c => c && level(c.level) === 'B2');
  // a concept's rank inside the level when the content gives one (round 4 content), else its place in the file
  const rank = new Map(b2c.map((c, i) => [c.id, 100 + (Number.isFinite(c.rank) ? c.rank : i)]));
  const byConcept = new Map(b2c.map(c => [c.id, /** @type {any[]} */ ([])]));
  // an item the content tags layer 'b2', or a B2 item, of a B2 concept
  for (const g of grammar || []) if (g && (g.layer === 'b2' || level(g.level) === 'B2') && byConcept.has(g.concept)) /** @type {any[]} */ (byConcept.get(g.concept)).push(g);
  for (const [cid, list] of byConcept) {
    for (const g of list) {
      const a = (annot || {})['G:' + g.id] || {};
      if (a.skip || g.dupOf) continue;   // dupOf: the content marks a duplicate of another item; only that one is scheduled
      const ans = /** @type {string[]} */ ([].concat(g.answer)), gap = String(g.prompt).includes('___');
      push({ id: 'G:' + g.id, kind: 'grammar', area: 'grammar', group: cid, teil: null, fn: null, star: false, trap: a.trap || null, focus: a.focus || [],
        strict: a.strict || [], plan: PLAN_OF_KIND[g.kind] || 'recall', task: g.task, prompt: g.prompt, promptLang: g.kind === 'translate' ? 'en' : 'de', hl: null,
        partner: null, prefill: null, accept: ans, anywhere: false, literal: true, gap, loose: gap || g.kind !== 'translate',
        model: gap ? (Match.gapFill(g.prompt, ans[0])?.text || ans[0]) : ans[0], wrong: a.wrong || [], rule: a.rule || g.note || '', src: 'igloo', level: 'B2',
        strictCase: !!g.strict_case, rank: rank.get(cid), layer: 'b2' });
    }
  }
  for (const c of en || []) {
    const d = (de || {})[c.id], a = (accept || {})[c.id];
    if (!c || !(level(c.level) === 'B2' || (d && d.layer === 'b2')) || twins.has(c.id)) continue;
    if (!d || !a || !Array.isArray(a.accept) || !a.accept.length || a.weak || d.dupOf || c.dupOf) continue;
    if (!a.core_en || !String(c.natural_example || '').toLowerCase().includes(String(a.core_en).toLowerCase())) continue;
    push({ id: 'K:' + c.id, kind: 'phrase', area: 'speaking', group: 'b2', teil: null, fn: null, star: false, trap: null, focus: ['chunk'], strict: [], plan: 'recall',
      task: null, prompt: c.natural_example, promptLang: 'en', hl: a.core_en, partner: null, prefill: null, accept: a.accept, anywhere: true,
      model: d.ex && Match.matches(d.ex, a.accept[0]) ? d.ex : Match.renderPattern(a.accept[0], d.ex), wrong: [], rule: d.n || '', src: 'bank', level: 'B2', bank: true,
      sentence: d.ex && a.accept.some((/** @type {string} */ p) => Match.matches(d.ex, p)) ? d.ex : null, layer: 'b2' });
  }
  return out;
}

/** Add items to a built pool (exam words that arrive after a fetch). Returns how many were new. @param {ReturnType<typeof buildPool>} data @param {any[]} list */
export function addItems(data, list) {
  let n = 0;
  for (const it of list) if (!data.byId.has(it.id)) { data.byId.set(it.id, it); data.pool.push(it); n++; }
  return n;
}
