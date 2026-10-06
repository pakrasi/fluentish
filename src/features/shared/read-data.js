/* Reading (round 4, features/practice-read): its storage and the lists its review round draws from. Here, in
   features/shared/, because the round size picker (sizes.js) and Practice's hub read them too; the reader's views
   stay in their own folder. Small and synchronous: no content is loaded here.

     kv 'reads'        { [readId]: read@1 }   device-only: the texts he pasted (title, source note, sentences), the
                       graded texts he opened (an id, no text), his mode and place in each. Never in a backup, a log or
                       an export unless he ticks "Include reading texts" (data/transfer.js).
     kv 'read.ctx'     { [cardId]: [{readId, sentenceId, de, surface}] }   device-only: the sentence each saved word or
                       phrase was met in (at most 3, each at most 240 characters). The review round gaps the word in it.
     kv 'read.cache'   { [readId]: {q: {promptVersion, model, textHash, items}, tr: {[sentenceId]: en}, gloss} }
                       device-only: what Claude wrote for a text.
     kv 'read.words'   { [cardId]: entry }   backed up (data/sync/backup.js SNAPSHOT_KV, rule fill): what he saved, with
                       no sentence and no title: {lemma, head, gloss, from, level, zipf, kind, home, ref, first, last, n}.
                       first/last/n make it the reading evidence of knowledge.js (data/knowledge.js EVIDENCE_KV.read).
     deck '<lang>:read' ('de:read')   the cards of saved items that had no card anywhere else: W:<id> (a listed word or
                       phrase), RW:<slug> (a word off the list), RP:<slug> (a phrase he marked). A record never holds
                       text; its card.reviewed events are learning progress and backed up like every other deck's.

   One card per item: an item that already has a card in another deck of the course (b1, clusters, script, build,
   speak) keeps it; saving it while reading only adds the sentence (home names that deck). */
import { deckId } from '../../domain/decks.js';
import * as RD from '../../domain/b1ready.js';
import * as FS from '../../domain/fsrs.js';

export const READS = 'reads';
export const CTX = 'read.ctx';
export const CACHE = 'read.cache';
export const WORDS = 'read.words';
/** The deck of saved reading items in a language ('de:read'). @param {string | null | undefined} lang */
export const readDeck = lang => deckId(lang || 'de', 'read');
/** Sentences kept per saved item, and the longest one kept. */
export const CTX_MAX = 3;
export const CTX_CHARS = 240;
/** practice.readNew and practice.readMin when he has set neither (C0 seam 1b). */
export const READ_NEW = 6;
export const READ_MIN = 10;
/** A reading round's questions (Recommended). */
export const ROUND = 12;

/**
 * @typedef {object} ReadWord  a saved item (kv read.words), keyed by its card id
 * @property {string} lemma
 * @property {string} head        the dictionary form shown ("die Branche", "dagegenhalten")
 * @property {string | null} gloss
 * @property {'list' | 'claude' | 'me' | null} from  where the meaning came from
 * @property {string | null} level
 * @property {number | null} zipf
 * @property {'word' | 'phrase'} kind
 * @property {string} home        the deck its card lives in ('de:read', or 'b1', 'clusters' … when it had one there)
 * @property {boolean} ref        kept for reference only: never scheduled (a rare word above his level)
 * @property {string} first       the study day it was first saved
 * @property {string} last
 * @property {number} n           times saved
 */

/** All reading records, deleted ones too. @param {any} store @returns {Record<string, any>} */
export const allReads = store => store.get(READS, {}) || {};

/** The texts in the library, last opened first. @param {any} store @returns {any[]} */
export function listReads(store) {
  return Object.values(allReads(store)).filter(r => r && !r.deletedAt && r.id).sort((a, b) => (b.opened || b.rev || 0) - (a.opened || a.rev || 0));
}

/** One text, or null. @param {any} store @param {string} id */
export const getRead = (store, id) => { const r = allReads(store)[id]; return r && !r.deletedAt ? r : null; };

/** Save a text (its rev is now). @param {any} store @param {any} read */
export function putRead(store, read) {
  store.update(READS, (/** @type {any} */ m) => ({ ...(m || {}), [read.id]: { ...read, rev: Date.now() } }), {});
}

/** Change a text's place and counts. @param {any} store @param {string} id @param {(p: any) => any} fn */
export function updateProgress(store, id, fn) {
  store.update(READS, (/** @type {any} */ m) => {
    const cur = (m || {})[id];
    if (!cur) return m || {};
    return { ...(m || {}), [id]: { ...cur, progress: fn({ ...(cur.progress || {}) }) } };
  }, {});
}

/**
 * Delete a text: its sentences go (a tombstone stays), and so do the sentences of saved words that came from it and
 * what Claude wrote for it. The saved words and their cards stay.
 * @param {any} store @param {string} id
 */
export function deleteRead(store, id) {
  store.update(READS, (/** @type {any} */ m) => ({ ...(m || {}), [id]: { id, deletedAt: new Date().toISOString(), rev: Date.now() } }), {});
  store.update(CTX, (/** @type {any} */ m) => {
    /** @type {Record<string, any[]>} */ const out = {};
    for (const [k, list] of Object.entries(m || {})) { const keep = (/** @type {any[]} */ (list) || []).filter(x => x && x.readId !== id); if (keep.length) out[k] = keep; }
    return out;
  }, {});
  store.update(CACHE, (/** @type {any} */ m) => { const n = { ...(m || {}) }; delete n[id]; return n; }, {});
}

/** The saved items. @param {any} store @returns {Record<string, ReadWord>} */
export const savedWords = store => store.get(WORDS, {}) || {};

/** The sentences an item was saved in, newest first. @param {any} store @param {string} cardId @returns {any[]} */
export const contextOf = (store, cardId) => ((store.get(CTX, {}) || {})[cardId] || []);

/**
 * Save an item while reading: its entry in read.words (first, last, n) and its sentence in read.ctx (device-only, at
 * most CTX_MAX, newest first, cut to CTX_CHARS). Returns the entry.
 * @param {any} store
 * @param {{cardId: string, entry: Omit<ReadWord, 'first' | 'last' | 'n'>, today: string, ctx: {readId: string, sentenceId: string, de: string, surface: string} | null}} o
 * @returns {ReadWord}
 */
export function saveWord(store, { cardId, entry, today, ctx }) {
  /** @type {ReadWord} */ let out = /** @type {any} */ (null);
  store.update(WORDS, (/** @type {any} */ m) => {
    const cur = (m || {})[cardId];
    out = cur
      ? { ...cur, ...entry, gloss: entry.gloss || cur.gloss, from: entry.gloss ? entry.from : cur.from, home: cur.home && cur.home !== entry.home && entry.home === '' ? cur.home : entry.home || cur.home,
        ref: cur.ref && entry.ref, first: cur.first || today, last: today, n: (cur.n || 0) + 1 }
      : { ...entry, first: today, last: today, n: 1 };
    return { ...(m || {}), [cardId]: out };
  }, {});
  if (ctx) {
    const one = { readId: ctx.readId, sentenceId: ctx.sentenceId, de: String(ctx.de || '').slice(0, CTX_CHARS), surface: String(ctx.surface || '').slice(0, 60) };
    store.update(CTX, (/** @type {any} */ m) => {
      const list = ((m || {})[cardId] || []).filter((/** @type {any} */ x) => !(x.readId === one.readId && x.sentenceId === one.sentenceId));
      return { ...(m || {}), [cardId]: [one, ...list].slice(0, CTX_MAX) };
    }, {});
  }
  return out;
}

/** Change a saved item's fields (a meaning he typed, reference or review). @param {any} store @param {string} cardId @param {Partial<ReadWord>} patch */
export function patchWord(store, cardId, patch) {
  store.update(WORDS, (/** @type {any} */ m) => ((m || {})[cardId] ? { ...(m || {}), [cardId]: { ...m[cardId], ...patch } } : (m || {})), {});
}

/**
 * Take an item out of the tray before it was ever reviewed: its entry and sentences go; a card it already has stays.
 * @param {any} store @param {string} cardId
 */
export function dropWord(store, cardId) {
  store.update(WORDS, (/** @type {any} */ m) => { const n = { ...(m || {}) }; delete n[cardId]; return n; }, {});
  store.update(CTX, (/** @type {any} */ m) => { const n = { ...(m || {}) }; delete n[cardId]; return n; }, {});
}

/** Whether an entry goes into the reading round: its card is in the reading deck, it has a meaning, it is not reference. @param {ReadWord | undefined} w @param {string} deck */
export const inRound = (w, deck) => !!w && w.home === deck && !w.ref && !!w.gloss;

/**
 * The reading round's list (domain/roundsize.js Buckets): due cards (weakest first), saved items never reviewed (in
 * the order he saved them) and reviewed ones not due.
 * @param {any} store @param {any} c clock ctx @param {string} deck @param {number} newLeft
 * @returns {{due: string[], fresh: string[], rest: string[], newLeft: number, daily: boolean}}
 */
export function readBuckets(store, c, deck, newLeft) {
  const cards = store.cards(deck) || {};
  const ws = savedWords(store);
  const ids = Object.keys(ws).filter(id => inRound(ws[id], deck));
  const R = (/** @type {string} */ id) => FS.Ron(cards[id], c.today);
  const due = ids.filter(id => cards[id]?.reps && RD.isDue(cards[id], c.today, c)).sort((a, b) => R(a) - R(b));
  const dueSet = new Set(due);
  const fresh = ids.filter(id => !cards[id]?.reps).sort((a, b) => String(ws[a].first).localeCompare(String(ws[b].first)) || 0);
  const rest = ids.filter(id => cards[id]?.reps && !dueSet.has(id)).sort((a, b) => R(a) - R(b));
  return { due, fresh, rest, newLeft, daily: true };
}

/** Items saved today that were never reviewed (the day's new reading items so far). @param {any} store @param {string} deck @param {string} today */
export function shownToday(store, deck, today) {
  return Object.values(store.cards(deck) || {}).filter((/** @type {any} */ r) => r && r.reps && r.first === today).length;
}

/**
 * New reading items left today. The allowance's share of deck read once the week plan gives it one (domain/budget.js
 * want.read, lane L1b); until then his own practice.readNew a day. None while the clock allows no new items, and none
 * while side decks are paused (an exam's last week).
 * @param {{decks: Record<string, any>}} b the day's allowance (domain/allowance.js todayBudget) @param {any} settings
 * @param {any} c clock ctx @param {number} shown
 */
export function readNewLeft(b, settings, c, shown) {
  const d = b && b.decks && b.decks.read;
  if (c.newItems === false || (d && d.paused)) return 0;
  if (d && d.want > 0) return Math.max(0, d.newLeft);
  const cap = Number.isFinite(settings?.practice?.readNew) ? settings.practice.readNew : READ_NEW;
  return Math.max(0, cap - shown);
}

/** Record how many new reading items are open today, for the allowance (kv deck.stats). @param {any} store @param {string} deck @param {string} today @param {number} open */
export function writeStats(store, deck, today, open) {
  store.update('deck.stats', (/** @type {any} */ m) => ({ ...(m || {}), [deck]: { ...((m || {})[deck] || {}), day: today, open } }), {});
}

/**
 * Practice's hub row (core/ui.js linkRow): "Reading · 3 texts · 4 saved words", or the invitation. Data only, so this
 * module stays free of the DOM (tested in node).
 * @param {any} store @param {(k: string, v?: any) => string} t @returns {{href: string, title: string, detail: string}}
 */
export function readRow(store, t) {
  const n = listReads(store).length;
  const ws = savedWords(store);
  const waiting = Object.values(ws).filter(w => w && !w.ref && w.home && w.home.endsWith(':read')).length;
  const detail = !n ? t('read.hub.empty') : waiting ? t('read.hub.words', { n, w: waiting }) : t('read.hub.n', { n });
  return { href: '#/practice/read', title: t('read.title'), detail };
}
