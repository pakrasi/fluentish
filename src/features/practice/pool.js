/* Practice: the item pool for the one review queue. Pure: content and private lists in, items out; tested in node.
   Ported from Igloo's b1.js build(): B1 items (content b1/items.json), chunk-bank phrases (b1/bank.json, those
   without a B1 twin), Igloo grammar (b1/grammar.json, ranked by plan topics), exam words (words.js) and mistakes
   from corrections (data/mistakes.js). Ids keep their kind prefix (domain/itemids.js). */
import * as Match from '../../domain/match.js';

const TEIL_GROUP = /** @type {Record<string, [string, string]>} */ ({ 'Sprechen T1': ['S1', 'S1'], 'Sprechen T2': ['S2', 'S2'], 'Sprechen T3': ['S3', 'S3'], Forum: ['opinion', 'S3'] });
const PLAN_OF_KIND = /** @type {Record<string, string>} */ ({ transform: 'transform', join: 'transform', order: 'transform', gap: 'recall', 'choose-article': 'recall', translate: 'recall' });

/**
 * A mistake record → a round item: his sentence, rewrite it correctly.
 * @param {import('../../data/mistakes.js').Mistake} m
 */
export function mistakeItem(m) {
  const mod = m.source.module ? m.source.module[0].toUpperCase() + m.source.module.slice(1).replace('oe', 'ö') : null;
  return {
    id: m.id, kind: 'mistake', area: 'mistakes', group: m.source.module || 'mistakes', teil: null, fn: null, star: true, trap: null,
    focus: [], strict: [], plan: 'transform', task: 'Rewrite this sentence correctly.', prompt: m.wrong, promptLang: 'de', hl: null,
    partner: null, prefill: null, accept: [m.right], anywhere: false, literal: true, loose: false, model: m.right, wrong: [m.wrong],
    rule: m.rule || '', src: 'mistake', level: 'B1', mine: true,
    source: m.source.label || [mod, m.source.test ? `Test ${m.source.test}` : null].filter(Boolean).join(' '),
  };
}

/**
 * @param {{items?: any[], grammar?: any[], bank?: Record<string, any>, plan: any, nouns?: Record<string, string>, words?: any[], mistakes?: any[]}} o
 *   words: round items from words.js toItem(); mistakes: mistake records
 */
export function buildPool({ items = [], grammar = [], bank = {}, plan, nouns = {}, words = [], mistakes = [] }) {
  const topics = new Map(plan.topics.map((/** @type {any} */ t) => [t.id, t]));
  /** @type {Map<string, any>} */ const byId = new Map();
  /** @type {any[]} */ const pool = [];
  const add = (/** @type {any} */ it) => { if (!byId.has(it.id)) { byId.set(it.id, it); pool.push(it); } };
  const twins = new Set(items.map(i => i.chunk).filter(Boolean));
  // mistakes from corrections first, so they win any id clash and sit early in the pool order
  for (const m of mistakes) if (m && !m.deletedAt) add(mistakeItem(m));
  for (const a of items) add({ ...a, promptLang: a.prompt_lang, gap: String(a.prompt).includes('___'), mine: false });
  for (const [cid, b] of Object.entries(bank)) {
    if (twins.has(cid)) continue;
    const [group, teil] = TEIL_GROUP[b.part] || ['opinion', 'S3'];
    add({ id: 'K:' + cid, kind: 'phrase', area: 'speaking', group, teil, fn: b.fn, star: b.prio === 1, trap: null, focus: ['chunk'], strict: [], plan: 'recall',
      task: null, prompt: b.en, promptLang: 'en', hl: b.hl, partner: null, prefill: null, accept: b.accept, anywhere: true,
      model: b.ex && Match.matches(b.ex, b.accept[0]) ? b.ex : Match.renderPattern(b.accept[0], b.ex), wrong: [], rule: b.n || '', src: 'bank', level: b.level, bank: true });
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
  return { pool, byId, plan, topics, traps, fnInfo, nouns };
}

/** Add items to a built pool (exam words that arrive after a fetch). Returns how many were new. @param {ReturnType<typeof buildPool>} data @param {any[]} list */
export function addItems(data, list) {
  let n = 0;
  for (const it of list) if (!data.byId.has(it.id)) { data.byId.set(it.id, it); data.pool.push(it); n++; }
  return n;
}
