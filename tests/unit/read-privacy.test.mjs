// Reading's privacy (round 4, lane L2b; PLAN-REVIEW gate "sentinel"): a pasted text holding a unique token goes
// through everything reading does (paste, save a word from the sentence that holds it, a review of that word, cached
// questions, a thrown error carrying the sentence) and the token must be found only in the device-only collections
// (reads, read.ctx, read.cache): never in a card record, an event, a snapshot, the uploaded error log or an export
// without the tick. The browser half (localStorage, request bodies) is tests/e2e/read.spec.mjs. Synthetic text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../../src/data/store.js';
import { createMemoryAdapter } from '../../src/data/adapters/memory.js';
import { log, entries, resetLog } from '../../src/core/log.js';
import * as B from '../../src/data/sync/backup.js';
import { exportBundle } from '../../src/data/transfer.js';
import * as R from '../../src/features/shared/read-data.js';
import * as S from '../../src/features/shared/session.js';
import { newDay } from '../../src/features/shared/compose.js';
import * as L from '../../src/features/practice-read/logic.js';

const PID = '0192a3b4-c5d6-7e8f-9a0b-00000000r0a0';
const DAY = '2026-10-20';
const clock = { today: () => DAY };
const SENTINEL = 'Quorxelbrandt';
const TEXT = `Die Arbeitswoche wird kürzer.\n\nIn der Firma ${SENTINEL} arbeiten alle nur noch vier Tage, und die Branche schaut genau hin.\n\nDie Ergebnisse sind gut.`;
const C = { today: DAY, exam: null, phase: 'none', daysLeft: null, lastNewDay: null, capDay: null, newItems: true, mocks: false };
const quiet = (/** @type {() => any} */ fn) => { const e = console.error; console.error = () => {}; try { return fn(); } finally { console.error = e; } };

async function session() {
  const store = await Store.open({ adapter: createMemoryAdapter(), profile: { id: PID, name: '', kind: 'local' }, device: { deviceId: 'dev', seq: 0 }, clock });
  store.set('settings', { v: 1, language: 'german', level: 'B1', exam: { type: null, date: null, modules: [] }, minutesPerDay: 60, newPerDay: null, practice: {}, onboarded: '2026-10-01T09:00:00.000+02:00', rev: {} });
  return store;
}

/** Everything the store holds, by where it lives. @param {any} store */
function places(store) {
  /** @type {Record<string, string>} */ const out = {};
  for (const [name, v] of Object.entries(store.kv)) out[`kv:${name}`] = JSON.stringify(v);
  for (const [deck, recs] of Object.entries(store.cardsByDeck)) out[`cards:${deck}`] = JSON.stringify(recs);
  out.events = JSON.stringify([...store.events.values()]);
  return out;
}

test('a pasted text never leaves the device-only collections', async () => {
  resetLog();
  const store = await session();
  const deck = R.readDeck('de');
  // paste
  const read = L.makeRead({ raw: TEXT, title: 'Vier Tage', id: 'r1', lang: 'de', now: '2026-10-20T08:00:00Z', untitled: 'x' });
  R.putRead(store, read);
  const sent = L.sentencesOf(read).find(s => s.de.includes(SENTINEL));
  assert.ok(sent, 'the sentinel is in a sentence of the text');
  // save "Branche" from that sentence: the entry has no sentence, the sentence goes to read.ctx
  R.saveWord(store, { cardId: 'W:Branche.n', today: DAY, entry: { lemma: 'Branche', head: 'die Branche', gloss: 'sector', from: 'list', level: 'B2', zipf: 4.1, kind: 'word', home: deck, ref: false },
    ctx: { readId: read.id, sentenceId: sent.id, de: sent.de, surface: 'Branche' } });
  // a review in the reading round: the card and its card.reviewed event
  const round = /** @type {any} */ (S.startRound(['W:Branche.n'], { kind: 'read' }, DAY, Date.now()));
  round.deck = deck;
  const byId = new Map([['W:Branche.n', { id: 'W:Branche.n', kind: 'word', area: 'words', origin: 'read', prompt: L.gapIn({ de: sent.de, surface: 'Branche' }, 0)?.gapped, accept: ['Branche'] }]]);
  const entry = S.current(round, byId, store.cards(deck));
  const res = S.answer({ round, entry, o: { ok: true, ms: 2000 }, cards: store.cards(deck), day: newDay(DAY), c: C, now: Date.now() });
  assert.ok(res.rec && res.event);
  store.putCards(deck, [['W:Branche.n', res.rec]]);
  store.append('card.reviewed', res.event);
  // Claude's questions, cached on the device
  store.update(R.CACHE, (/** @type {any} */ m) => ({ ...(m || {}), [read.id]: { q: { promptVersion: 'read-questions@1', model: 'm', textHash: L.textHash(read), items: [{ id: 'q1', q: 'Wo?', options: ['a', 'b'], answer: 0, evidence: sent.de }] }, tr: { [sent.id]: `In the company ${SENTINEL}` } } }));
  // an error that carries the sentence
  quiet(() => log('read', new Error(`could not read ${sent.de}`)));

  // where the token is: only reads, read.ctx and read.cache
  const where = Object.entries(places(store)).filter(([, s]) => s.includes(SENTINEL)).map(([k]) => k).sort();
  assert.deepEqual(where, ['kv:read.cache', 'kv:read.ctx', 'kv:reads']);
  assert.ok(!JSON.stringify(store.cards(deck)).includes('Firma'), 'a card record holds no text');
  assert.deepEqual(Object.keys(R.savedWords(store)['W:Branche.n']).sort(), ['first', 'from', 'gloss', 'head', 'home', 'kind', 'last', 'lemma', 'level', 'n', 'ref', 'zipf']);

  // the snapshot (backup) carries read.words and the reading deck, never the text
  const snap = B.snapshotOf(store, { now: Date.now() });
  assert.ok(snap.kv['read.words'] && snap.cards[deck], 'saved words and their cards are backed up');
  assert.ok(!JSON.stringify(snap).includes(SENTINEL));
  assert.equal(B.leakIn(JSON.stringify(snap)), null, 'the snapshot passes the upload check');
  // the backed-up events
  const lines = [...store.events.values()].filter(B.backupable).map(B.lineOf).join('\n');
  assert.ok(lines.includes('card.reviewed'), 'the review is backed up');
  assert.ok(!lines.includes(SENTINEL));

  // the error log upload replaces the line (it holds three words in a row of the text)
  assert.ok(entries().some(e => e.message.includes(SENTINEL)), 'the ring on this device still has the message');
  /** @type {Map<string, string>} */ const files = new Map();
  const target = {
    read: async (/** @type {string} */ p) => (files.has(p) ? { bytes: new TextEncoder().encode(files.get(p)), sha: 's' } : null),
    write: async (/** @type {string} */ p, /** @type {string} */ text) => { files.set(p, text); return 's'; },
  };
  const n = await B.uploadLog(store, /** @type {any} */ (target), { entries: entries(), now: () => Date.now(), secrets: {} });
  assert.equal(n, 1);
  const up = [...files.values()].join('\n');
  assert.ok(up.includes('[removed: script text]') && !up.includes(SENTINEL), up);

  // export: without the tick nothing of the text; with it, the texts go along
  const ex = exportBundle(store, { profile: { id: PID, name: '', createdAt: '' } });
  assert.ok(!JSON.stringify(ex).includes(SENTINEL));
  assert.ok(ex.kv['read.words'], 'the saved words are exported as progress');
  const exAll = exportBundle(store, { profile: { id: PID, name: '', createdAt: '' }, includeReads: true });
  assert.ok(JSON.stringify(exAll.kv.reads).includes(SENTINEL));
  resetLog();
});

test('deleting a text removes its sentences everywhere; the saved word and its card stay', async () => {
  const store = await session();
  const read = L.makeRead({ raw: TEXT, title: 'Vier Tage', id: 'r2', lang: 'de', now: '', untitled: 'x' });
  R.putRead(store, read);
  const sent = L.sentencesOf(read)[1];
  R.saveWord(store, { cardId: 'W:Branche.n', today: DAY, entry: { lemma: 'Branche', head: 'die Branche', gloss: 'sector', from: 'list', level: 'B2', zipf: 4.1, kind: 'word', home: 'de:read', ref: false },
    ctx: { readId: read.id, sentenceId: sent.id, de: sent.de, surface: 'Branche' } });
  store.update(R.CACHE, () => ({ [read.id]: { tr: { x: SENTINEL } } }), {});
  R.deleteRead(store, read.id);
  const where = Object.entries(places(store)).filter(([, s]) => s.includes(SENTINEL)).map(([k]) => k);
  assert.deepEqual(where, []);
  assert.ok(R.savedWords(store)['W:Branche.n']);
  assert.equal(R.getRead(store, read.id), null);
});
