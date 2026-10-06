/* The sheets of conversation practice, on the shared bottom sheet (features/shared/textview.js sheet()):
     sentSheet   "What is sent": what goes to Anthropic, what stays on this device, what it costs
     glossSheet  a word of Claude's reply: from the word list on this device first; a word the list does not have can be
                 asked of Claude (Haiku 4.5, one short request) after a tap */
import { h } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { langAttr, dirAttr, bcp47 } from '../../core/lang.js';
import { wordMeta, wordPanel } from '../../core/wordpanel.js';
import { say, canSay } from '../../services/voice.js';
import { ask, ClaudeError } from '../../services/claude.js';
import { config } from '../../core/config.js';
import { sheet, quote } from '../shared/textview.js';
import { tokenize } from '../../domain/text/tokens.js';
import { headOf, glossOf } from '../../domain/text/suggest.js';
import * as C from '../../domain/conversation.js';
import { glossPrompt, IDS } from './prompts.js';
import { claudeKey, charge, money, monthSpent, convSettings, USED } from './data.js';
import * as R from '../shared/read-data.js';
import { knowledgeDecks } from '../../data/knowledge.js';

/**
 * @param {import('../contract.js').ViewCtx} ctx
 * @param {{interests: string[], cap: number, spent: number}} o
 */
export function sentSheet(ctx, { interests, cap, spent }) {
  const { t } = ctx;
  const li = (/** @type {string} */ k, /** @type {any} */ v = {}) => h('li', null, t(k, v));
  return sheet({
    title: t('conv.sent.title'),
    cls: 'cv-sheet',
    children: [
      h('h3', { class: 'cv-sheet-h' }, t('conv.sent.goes')),
      h('ul', { class: 'cv-list' }, li('conv.sent.goes.messages'), li('conv.sent.goes.replies'), li('conv.sent.goes.level'),
        interests.length ? li('conv.sent.goes.interests', { list: interests.join(', ') }) : li('conv.sent.goes.noInterests'), li('conv.sent.goes.gloss')),
      h('p', { class: 'caption' }, t('conv.sent.anthropic')),
      h('h3', { class: 'cv-sheet-h' }, t('conv.sent.never')),
      h('ul', { class: 'cv-list' }, li('conv.sent.never.profile'), li('conv.sent.never.cards')),
      h('h3', { class: 'cv-sheet-h' }, t('conv.sent.stays')),
      h('ul', { class: 'cv-list' }, li('conv.sent.stays.transcript'), li('conv.sent.stays.backup'), li('conv.sent.stays.voice')),
      h('h3', { class: 'cv-sheet-h' }, t('conv.sent.cost')),
      h('p', null, t('conv.sent.costLine', { spent: money(spent), cap: money(cap) })),
    ],
  });
}

/**
 * The sheet for one word of a reply.
 * @param {import('../contract.js').ViewCtx} ctx
 * @param {{word: string, sentence: string, lang: any, sessionId: string}} o  lang: the loaded word list (load.js)
 */
export function glossSheet(ctx, { word, sentence, lang, sessionId }) {
  const { t, store } = ctx;
  const toks = tokenize(sentence);
  const at = toks.findIndex(x => x.w && x.t === word);
  const M = lang.pack.grammar?.morphology;
  const cands = M?.lemma && at >= 0 ? M.lemma(toks[at], toks, at, lang.idx) : [];
  const look = M?.lookup ? M.lookup(word, lang.idx, { start: toks.filter(x => x.w)[0] === toks[at], prev: '' }) : { lemma: word, entry: null };
  /** @type {any} */ let entry = null;
  for (const c of cands) { entry = (lang.idx.lemmas.get(String(c).toLowerCase()) || [])[0] || null; if (entry) break; }
  entry = entry || look.entry || null;
  const lemma = entry ? String(entry.w).replace(/^(der|die|das)\s+/i, '') : (cands[0] || look.lemma || word);
  const wc = entry && lang.card ? lang.card(entry, lemma) : null;
  const head = wc ? wc.card.head : entry ? headOf(entry, lemma) : lemma;
  const gloss = entry ? glossOf(entry) : null;
  const itemId = entry && entry.id ? `W:${entry.id}` : null;
  // "Add to review" means what it means in the Reader (UX review #9): the item joins the saved words of the reading
  // deck with Claude's sentence (device-only, removed when the conversation is deleted), and an item with a card in
  // another deck keeps that card. It also counts as met in a conversation.
  const saved = () => !!(itemId && R.savedWords(store)[itemId]);
  const out = h('div', { class: 'cv-gloss-out', 'aria-live': 'polite' });
  const save = /** @type {HTMLButtonElement} */ (h('button', { type: 'button', class: 'btn btn-primary pressable', disabled: !itemId || saved(), onclick: () => {
    if (!itemId) return;
    const day = ctx.clock.ctx().today;
    store.update(USED, (/** @type {any} */ u) => C.addEvidence(u || {}, [itemId], day), {});
    const deck = R.readDeck(lang.pack?.id || 'de');
    const home = knowledgeDecks(store).find(d => d !== deck && (store.cards(d) || {})[itemId]?.reps) || deck;
    R.saveWord(store, { cardId: itemId, today: day, entry: { lemma, head, gloss, from: gloss ? 'list' : null, level: entry.level || null, zipf: entry.zipf ?? null, kind: entry.pos === 'phrase' ? 'phrase' : 'word', home, ref: false },
      ctx: { readId: `conv:${sessionId}`, sentenceId: `t${Math.abs(hashOf(sentence))}`, de: sentence, surface: word } });
    save.disabled = true;
    save.textContent = t('conv.gloss.saved');
    ctx.toast(t('conv.gloss.savedToast', { word: head }));
  } }, saved() ? t('conv.gloss.saved') : t('conv.gloss.save')));
  const playable = canSay(bcp47(), { localOnly: true });
  const play = playable ? h('button', { type: 'button', class: 'btn pressable', onclick: () => { say(head, bcp47(), { localOnly: true }); } }, icon('speaker', { size: 18 }), t('conv.play')) : null;
  /** @type {HTMLButtonElement | null} */ let askBtn = null;
  const today = ctx.clock.ctx().today;
  const monthOver = C.monthLoad(monthSpent(store, today), convSettings(ctx.settings()).monthlyCapUsd).over;
  if (!entry && claudeKey(store) && monthOver) out.replaceChildren(h('p', { class: 'caption' }, t('conv.gloss.month')));
  else if (!entry && claudeKey(store)) {
    const b = /** @type {HTMLButtonElement} */ (h('button', { type: 'button', class: 'btn pressable' }, t('conv.gloss.ask')));
    b.onclick = async () => {
      b.disabled = true;
      out.replaceChildren(h('p', { class: 'caption' }, t('conv.gloss.asking')));
      try {
        const r = await ask({ key: claudeKey(store), user: glossPrompt(lang.conv, word, sentence), model: config.anthropic.models.check, maxTokens: 300, effort: null, fallback: false,
          format: { type: 'json_schema', schema: GLOSS_SCHEMA } });
        charge(store, sessionId, ctx.clock.ctx().today, config.anthropic.models.check, C.usageOf(r.usage));
        const j = JSON.parse(r.text);
        out.replaceChildren(
          h('p', { class: 'cv-gloss-lemma', lang: langAttr(), dir: dirAttr() }, String(j.lemma || word)),
          h('p', { class: 'cv-gloss-en' }, String(j.gloss || '')),
          h('p', { class: 'caption' }, t('conv.gloss.fromClaude')));
        b.remove();
      } catch (e) {
        if (e instanceof ClaudeError && e.usage) charge(store, sessionId, ctx.clock.ctx().today, config.anthropic.models.check, e.usage);
        b.disabled = false;
        out.replaceChildren(h('p', { class: 'caption' }, t(`conv.err.${e instanceof ClaudeError ? e.code : 'other'}`)));
      }
    };
    askBtn = b;
  }
  return sheet({
    title: head,
    titleLang: true,
    cls: 'cv-sheet cv-gloss',
    children: [
      entry ? h('div', { class: 'cv-gloss-meta' }, wordMeta({ type: wc ? wc.card.type : 'word', level: entry.level || null, zipf: entry.zipf ?? null })) : null,
      gloss ? h('p', { class: 'cv-gloss-en' }, gloss) : h('p', { class: 'caption' }, t('conv.gloss.notListed')),
      wc && wc.card.forms ? wordPanel({ ...wc.card, ex: null }, { head: false }) : null,
      at >= 0 ? quote(toks, [at]) : null,
      entry ? h('p', { class: 'caption' }, t('conv.gloss.fromList')) : null,
      out,
      h('div', { class: 'cv-sheet-actions' }, play, entry ? save : askBtn),
    ],
  });
}

/** A short number for a sentence (its id among a conversation's sentences). @param {string} s */
const hashOf = s => { let x = 0; for (let i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) | 0; return x; };

/** The gloss reply (structured output; every object closed). */
export const GLOSS_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['lemma', 'pos', 'gloss'],
  properties: { lemma: { type: 'string' }, pos: { type: 'string', enum: ['noun', 'verb', 'adjective', 'adverb', 'other'] }, gloss: { type: 'string' } },
};

export { IDS };
