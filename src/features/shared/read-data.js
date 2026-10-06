/* Reading (round 4, features/practice-read): its storage and the lists its review round draws from. Here, in
   features/shared/, because the round size picker (sizes.js) and Practice's hub read them too; the reader's views
   stay in their own folder. Small and synchronous: no content is loaded here.

     kv 'reads'        { [readId]: read@1 }   device-only: the texts he pasted (title, source note, sentences), the
                       graded texts he opened (an id, no text), his mode and place in each. Never in a backup, a log or
                       an export unless he ticks "Include reading texts" (data/transfer.js).
     kv 'read.ctx'     { [cardId]: [{readId, sentenceId, de, surface, item?}] }   device-only: the sentence each saved
                       word or phrase was met in (at most 3, each at most 240 characters). The review round gaps the
                       word in it. A phrase he marked (RP:) keeps its words and meaning here too, as item {lemma, head,
                       gloss} on each of its entries; when its text is deleted, one entry without a sentence keeps the
                       item (readId null, de ''), so the saved phrase can still be reviewed on this device.
     kv 'read.cache'   { [readId]: {q: {promptVersion, model, textHash, items}, tr: {[sentenceId]: en}, gloss} }
                       device-only: what Claude wrote for a text.
     kv 'read.words'   { [cardId]: entry }   backed up (data/sync/backup.js SNAPSHOT_KV, rule fill): what he saved, with
                       no sentence and no title: {lemma, head, gloss, from, level, zipf, kind, home, ref, first, last, n}.
                       first/last/n make it the reading evidence of knowledge.js (data/knowledge.js EVIDENCE_KV.read).
                       A marked phrase (RP:) is stored here with lemma '', head '' and gloss null: its words are in
                       read.ctx (savedWords() puts them back for the screens). Entries saved before that fix are moved
                       once (migratePhrases, practice-read/boot.js), keeping their ids.
     kv 'read.met'     { [item id]: {first, last, n} }   the listed words he read past in a text without looking them up
                       (round 4, UX review #4): word-list item ids only, no text. The reader's estimate counts them as
                       read for coverage (domain/text/estimate.js); they are never a card and never in a known count.
                       Not backed up.
     deck '<lang>:read' ('de:read')   the cards of saved items that had no card anywhere else: W:<id> (a listed word or
                       phrase), RW:<slug> (a word off the list), RP:h<hash> (a phrase he marked; RP:<slug> before round
                       4's privacy fix). A record never holds text; its card.reviewed events are learning progress and backed up like every other deck's.

   One card per item: an item that already has a card in another deck of the course (b1, clusters, script, build,
   speak) keeps it; saving it while reading only adds the sentence (home names that deck). */
import { deckId } from '../../domain/decks.js';
import { PRIVATE_ITEM, PRIVATE_ITEM_FIELDS, publicEntry, scriptText } from '../../data/sync/backup.js';
import { forget } from '../../core/log.js';
import * as RD from '../../domain/b1ready.js';
import * as FS from '../../domain/fsrs.js';

export const READS = 'reads';
export const CTX = 'read.ctx';
export const CACHE = 'read.cache';
export const WORDS = 'read.words';
export const MET = 'read.met';

/** The item ids read without a look-up (kv read.met). @param {any} store @returns {Set<string>} */
export const metSet = store => new Set(Object.keys(store.get(MET, {}) || {}));

/**
 * Record items read without a look-up today (one count a day per item). @param {any} store @param {string} today
 * @param {string[]} ids
 */
export function addMet(store, today, ids) {
  if (!ids.length) return;
  store.update(MET, (/** @type {any} */ m) => {
    const out = { ...(m || {}) };
    for (const id of ids) {
      const was = out[id];
      out[id] = was ? (was.last === today ? was : { ...was, last: today, n: (was.n || 1) + 1 }) : { first: today, last: today, n: 1 };
    }
    return out;
  }, {});
}
/** The deck of saved reading items in a language ('de:read'). @param {string | null | undefined} lang */
export const readDeck = lang => deckId(lang || 'de', 'read');
/** Sentences kept per saved item, and the longest one kept. */
export const CTX_MAX = 3;
export const CTX_CHARS = 240;
/** practice.readMin when he has not set it (C0 seam 1b): the Reading row's minutes on a day without a Read slot. */
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

/** Whether a saved item's words stay on this device (a phrase he marked: RP:). @param {string} cardId */
export const isPrivateItem = cardId => PRIVATE_ITEM.test(String(cardId || ''));

/** The private words of an item from its read.ctx entries, or null. @param {any[] | undefined} list @returns {{lemma: string, head: string, gloss: string | null} | null} */
const itemOf = list => ((list || []).find(x => x && x.item && typeof x.item === 'object') || {}).item || null;

/**
 * An item's read.ctx entries with its private words on each (a stub entry without a sentence when it has none).
 * @param {any[]} list @param {{lemma: string, head: string, gloss: string | null}} item
 */
const withItem = (list, item) => (list.length ? list.map(x => ({ ...x, item })) : [{ readId: null, sentenceId: null, de: '', surface: '', item }]);

/**
 * Delete a text: its sentences go (a tombstone stays), and so do the sentences of saved words that came from it and
 * what Claude wrote for it. The saved words and their cards stay (a marked phrase keeps its words in an entry without
 * a sentence). The error log forgets every line that quotes the text (core/log.js forget), so the next log upload
 * cannot carry it.
 * @param {any} store @param {string} id
 */
export function deleteRead(store, id) {
  const read = allReads(store)[id];
  const sentences = read && Array.isArray(read.sections) ? read.sections.flatMap((/** @type {any} */ s) => (s && s.sentences) || []).map((/** @type {any} */ x) => x && x.de) : [];
  const ctxs = store.get(CTX, {}) || {};
  const quoted = Object.values(ctxs).flat().filter((/** @type {any} */ x) => x && x.readId === id).map((/** @type {any} */ x) => x.de);
  forget(scriptText({ [`read:${id}`]: { title: read && read.title, sections: [{ sentences: [...sentences, ...quoted].map(de => ({ de })) }] } }));
  store.update(READS, (/** @type {any} */ m) => ({ ...(m || {}), [id]: { id, deletedAt: new Date().toISOString(), rev: Date.now() } }), {});
  store.update(CTX, (/** @type {any} */ m) => {
    /** @type {Record<string, any[]>} */ const out = {};
    for (const [k, list] of Object.entries(m || {})) {
      const all = /** @type {any[]} */ (list) || [];
      const keep = all.filter(x => x && x.readId !== id);
      const item = isPrivateItem(k) ? itemOf(all) : null;
      if (item) out[k] = withItem(keep.filter(x => x.de), item);
      else if (keep.length) out[k] = keep;
    }
    return out;
  }, {});
  store.update(CACHE, (/** @type {any} */ m) => { const n = { ...(m || {}) }; delete n[id]; return n; }, {});
}

/**
 * The saved items, as the screens read them: a marked phrase with its words from read.ctx (on this device only).
 * @param {any} store @returns {Record<string, ReadWord>}
 */
export function savedWords(store) {
  const ws = store.get(WORDS, {}) || {};
  const ctxs = store.get(CTX, {}) || {};
  /** @type {Record<string, ReadWord> | null} */ let out = null;
  for (const id of Object.keys(ws)) {
    if (!isPrivateItem(id)) continue;
    const item = itemOf(ctxs[id]);
    if (!item) continue;
    const o = out || (out = { ...ws });
    o[id] = { ...ws[id], lemma: item.lemma || ws[id].lemma || '', head: item.head || ws[id].head || '', gloss: item.gloss ?? ws[id].gloss ?? null };
  }
  return out || ws;
}

/** The sentences an item was saved in, newest first (an entry kept only for a phrase's words has none). @param {any} store @param {string} cardId @returns {any[]} */
export const contextOf = (store, cardId) => ((store.get(CTX, {}) || {})[cardId] || []).filter((/** @type {any} */ x) => x && x.de);

/**
 * Move the words of phrases saved before round 4's privacy fix out of read.words (backed up) into read.ctx (this
 * device): the card ids stay as they are (RP:<slug>, never re-keyed); words already in read.ctx are kept. Idempotent.
 * @param {any} store @returns {number} entries moved
 */
export function migratePhrases(store) {
  const ws = store.get(WORDS, {}) || {};
  const ids = Object.keys(ws).filter(id => isPrivateItem(id) && ws[id] && PRIVATE_ITEM_FIELDS.some(f => ws[id][f]));
  if (!ids.length) return 0;
  // the words reach read.ctx first, so nothing is lost if the second write never happens
  store.update(CTX, (/** @type {any} */ m) => {
    const out = { ...(m || {}) };
    for (const id of ids) {
      const w = ws[id], have = itemOf(out[id]);
      const item = { lemma: have?.lemma || w.lemma || '', head: have?.head || w.head || w.lemma || '', gloss: have?.gloss ?? w.gloss ?? null };
      out[id] = withItem(out[id] || [], item);
    }
    return out;
  }, {});
  store.update(WORDS, (/** @type {any} */ m) => {
    const out = { ...(m || {}) };
    for (const id of ids) if (out[id]) out[id] = publicEntry(out[id]);
    return out;
  }, {});
  return ids.length;
}

/**
 * Save an item while reading: its entry in read.words (first, last, n) and its sentence in read.ctx (device-only, at
 * most CTX_MAX, newest first, cut to CTX_CHARS). Returns the entry.
 * @param {any} store
 * @param {{cardId: string, entry: Omit<ReadWord, 'first' | 'last' | 'n'>, today: string, ctx: {readId: string, sentenceId: string, de: string, surface: string} | null}} o
 * @returns {ReadWord}
 */
export function saveWord(store, { cardId, entry, today, ctx }) {
  const priv = isPrivateItem(cardId);
  const cur = savedWords(store)[cardId];
  /** @type {ReadWord} */ const out = cur
    ? { ...cur, ...entry, gloss: entry.gloss || cur.gloss, from: entry.gloss ? entry.from : cur.from, home: cur.home && cur.home !== entry.home && entry.home === '' ? cur.home : entry.home || cur.home,
      ref: cur.ref && entry.ref, first: cur.first || today, last: today, n: (cur.n || 0) + 1 }
    : { ...entry, first: today, last: today, n: 1 };
  // a marked phrase: its words go to read.ctx first (this device), read.words gets the entry without them
  const one = ctx ? { readId: ctx.readId, sentenceId: ctx.sentenceId, de: String(ctx.de || '').slice(0, CTX_CHARS), surface: String(ctx.surface || '').slice(0, 60) } : null;
  if (one || priv) {
    store.update(CTX, (/** @type {any} */ m) => {
      const was = ((m || {})[cardId] || []);
      const list = one ? [one, ...was.filter((/** @type {any} */ x) => x && x.de && !(x.readId === one.readId && x.sentenceId === one.sentenceId))].slice(0, CTX_MAX) : was;
      return { ...(m || {}), [cardId]: priv ? withItem(list.filter((/** @type {any} */ x) => x && x.de), { lemma: out.lemma, head: out.head, gloss: out.gloss ?? null }) : list };
    }, {});
  }
  store.update(WORDS, (/** @type {any} */ m) => ({ ...(m || {}), [cardId]: priv ? publicEntry(out) : out }), {});
  return out;
}

/** Change a saved item's fields (a meaning he typed, reference or review); a marked phrase's words stay in read.ctx. @param {any} store @param {string} cardId @param {Partial<ReadWord>} patch */
export function patchWord(store, cardId, patch) {
  if (!(store.get(WORDS, {}) || {})[cardId]) return;
  /** @type {Record<string, any>} */ const pub = { ...patch };
  if (isPrivateItem(cardId)) {
    /** @type {Record<string, any>} */ const mine = {};
    for (const f of PRIVATE_ITEM_FIELDS) if (f in pub) { mine[f] = pub[f]; delete pub[f]; }
    if (Object.keys(mine).length) {
      const w = savedWords(store)[cardId];
      store.update(CTX, (/** @type {any} */ m) => ({ ...(m || {}), [cardId]: withItem(((m || {})[cardId] || []).filter((/** @type {any} */ x) => x && x.de),
        { lemma: w.lemma, head: w.head, gloss: w.gloss ?? null, ...mine }) }), {});
    }
  }
  store.update(WORDS, (/** @type {any} */ m) => ((m || {})[cardId] ? { ...(m || {}), [cardId]: { ...m[cardId], ...pub } } : (m || {})), {});
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
  // saved words keep their own schedule through an exam window (b1ready.sideCap)
  const due = ids.filter(id => cards[id]?.reps && RD.isDue(cards[id], c.today, RD.sideCap(c))).sort((a, b) => R(a) - R(b));
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
 * New reading items left today: the allowance's share of deck read (domain/budget.js: practice.readNew in maintenance,
 * 0 on a Light or Off day, a break, an exam's eve and day, and paused in an exam's last week).
 * @param {{decks: Record<string, any>} | null} b the day's allowance (domain/allowance.js todayBudget)
 */
export function readNewLeft(b) {
  const d = b && b.decks && b.decks.read;
  if (!d || d.paused) return 0;
  return Math.max(0, d.newLeft || 0);
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
