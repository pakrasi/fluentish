// Privacy through the real backup (round 4, audit P1-4/5/6, coordinator ruling 1): a device linked with a FAKE GitHub
// token runs the app's own sync (data/sync/index.js sync: learning events, the gzip snapshot and the error log, to a
// mocked GitHub Contents API); every uploaded file is decoded and, when gzip, decompressed before it is searched.
//   - a phrase marked in a private text (and its meaning) never reaches a card id, an event or the snapshot;
//   - a phrase saved before the fix keeps its id, and its words leave read.words (moved to read.ctx, additive);
//   - deleting a text, or a conversation, before the day's log upload purges its sentences from the error log;
//   - the words he used in a conversation go up as ids only (the real usedIds over the real word list).
// All data is synthetic; the token is not real.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from '../../src/data/store.js';
import { createMemoryAdapter } from '../../src/data/adapters/memory.js';
import { log, resetLog, entries } from '../../src/core/log.js';
import { resetThrottle } from '../../src/data/sync/github-b1exam.js';
import { sync } from '../../src/data/sync/index.js';
import { config } from '../../src/core/config.js';
import { exportBundle } from '../../src/data/transfer.js';
import * as R from '../../src/features/shared/read-data.js';
import * as L from '../../src/features/practice-read/logic.js';
import * as S from '../../src/features/shared/session.js';
import { newDay } from '../../src/features/shared/compose.js';
import * as C from '../../src/domain/conversation.js';
import * as D from '../../src/features/practice-conversation/data.js';
import { usedIds } from '../../src/features/practice-conversation/lang.js';
import de from '../../src/lang/de/index.js';
import { mockGithubFor } from './sync-harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PID = '0192a3b4-c5d6-7e8f-9a0b-00000000p1a0';
const TOKEN = 'test-token-not-real-0042';
const DAY = '2026-10-20';
const SENTINEL = 'Quorxelbrandt';
const TEXT = `Die Arbeitswoche wird kürzer.\n\nIn der Firma ${SENTINEL} arbeiten alle nur noch vier Tage, und die Branche schaut genau hin.\n\nDie Ergebnisse sind gut.`;
const C0 = { today: DAY, exam: null, phase: 'none', daysLeft: null, lastNewDay: null, capDay: null, newItems: true, mocks: false };
const quiet = fn => { const e = console.error; console.error = () => {}; try { return fn(); } finally { console.error = e; } };

async function device() {
  resetLog();
  const store = await Store.open({ adapter: createMemoryAdapter(), profile: { id: PID, name: '', kind: 'local' }, device: { deviceId: 'dev1', seq: 0 }, clock: { today: () => DAY } });
  store.set('settings', { v: 1, language: 'german', level: 'B1', exam: { type: null, date: null, modules: [] }, minutesPerDay: 60, newPerDay: null, practice: {}, onboarded: '2026-10-01T09:00:00.000+02:00', rev: {} });
  store.set('secrets', { githubToken: TOKEN });
  // a card, so the snapshot is written (a profile without cards writes none)
  store.putCards('b1', [['W:Haus.n', { S: 3, D: 5, due: '2026-10-25', reps: 1, lapses: 0, last: DAY, first: DAY, stage: 1, streak: 0, learn: null, relearn: false, u: 1, hist: [] }]]);
  await store.flush();
  return store;
}

/** Run the app's sync ("Back up now") against the mock; every uploaded file as text, gzip decompressed. */
async function upload(store, gh) {
  resetThrottle();
  const res = await sync(store, { fetch: gh.fetch, pull: false, backupNow: true });
  assert.equal(res.backup?.error ?? res.error ?? null, null, 'the backup ran');
  /** @type {Map<string, string>} */ const out = new Map();
  for (const [p, b64] of gh.files) {
    const buf = Buffer.from(b64, 'base64');
    out.set(p, (buf[0] === 0x1f && buf[1] === 0x8b ? zlib.gunzipSync(buf) : buf).toString('utf8'));
  }
  return out;
}

/** The uploaded files that hold the token in any case, or its slug. */
const holding = (files, token = SENTINEL) => [...files].filter(([, text]) => text.toLowerCase().includes(token.toLowerCase())).map(([p]) => p);

/** A review of a reading card, as the reading round saves it (the card and its card.reviewed event). */
function review(store, deck, id) {
  const round = S.startRound([id], { kind: 'read' }, DAY, Date.now());
  round.deck = deck;
  const entry = S.current(round, new Map([[id, { id, kind: 'word', area: 'words', origin: 'read', prompt: 'x', accept: ['x'] }]]), store.cards(deck));
  const res = S.answer({ round, entry, o: { ok: true, ms: 1500 }, cards: store.cards(deck), day: newDay(DAY), c: C0, now: Date.now() });
  store.putCards(deck, [[id, res.rec]]);
  store.append('card.reviewed', res.event);
}

test('a phrase marked in a private text, its meaning, a review of it and an error quoting the text: nothing of the text is uploaded', async () => {
  const store = await device();
  const gh = mockGithubFor(config.resultsRepo);
  const deck = R.readDeck('de');
  const read = L.makeRead({ raw: TEXT, title: 'Vier Tage', id: 'r1', lang: 'de', now: '2026-10-20T08:00:00Z', untitled: 'x' });
  R.putRead(store, read);
  const sent = L.sentencesOf(read).find(s => s.de.includes(SENTINEL));
  // mark a phrase, as the reader's Save phrase does (reader.js markPhrase → saveItem), with a meaning he typed
  const text = `Firma ${SENTINEL} arbeiten`;
  const cardId = L.itemFor({ kind: 'phrase', lemma: text, entry: null });
  R.saveWord(store, { cardId, today: DAY, entry: { lemma: text, head: text, gloss: `the firm ${SENTINEL} works`, from: 'me', level: null, zipf: null, kind: 'phrase', home: deck, ref: false },
    ctx: { readId: read.id, sentenceId: sent.id, de: sent.de, surface: text } });
  // and a listed word from the same sentence
  R.saveWord(store, { cardId: 'W:Branche.n', today: DAY, entry: { lemma: 'Branche', head: 'die Branche', gloss: 'sector', from: 'list', level: 'B2', zipf: 4.1, kind: 'word', home: deck, ref: false },
    ctx: { readId: read.id, sentenceId: sent.id, de: sent.de, surface: 'Branche' } });
  // on this device the phrase is whole: the tray and the round read it
  assert.equal(R.savedWords(store)[cardId].head, text);
  assert.equal(R.savedWords(store)[cardId].gloss, `the firm ${SENTINEL} works`);
  assert.ok(R.inRound(R.savedWords(store)[cardId], deck), 'it is in the reading round');
  // a meaning he changes later stays on the device too
  R.patchWord(store, cardId, { gloss: `at ${SENTINEL}`, from: 'me' });
  assert.equal(R.savedWords(store)[cardId].gloss, `at ${SENTINEL}`);
  review(store, deck, cardId);
  quiet(() => log('read', new Error(`could not read ${sent.de}`)));

  const files = await upload(store, gh);
  const kinds = [...files.keys()].map(p => p.split('/')[1]).sort();
  assert.ok(kinds.includes('events') && kinds.includes('snapshots') && kinds.includes('logs'), `events, a snapshot and the log went up: ${kinds}`);
  assert.ok([...files.keys()].some(p => p.endsWith('.json.gz')), 'the snapshot is gzip (decompressed here)');
  assert.deepEqual(holding(files), [], 'the token is in no uploaded file');
  assert.deepEqual(holding(files, 'Firma'), [], 'nor a word of the phrase');
  const snap = JSON.parse([...files].find(([p]) => p.includes('/snapshots/'))[1]);
  assert.ok(snap.cards[deck][cardId], 'the phrase\'s card went up, under its hash id');
  assert.match(cardId, /^RP:h[0-9a-z]{11}$/);
  assert.deepEqual({ lemma: snap.kv['read.words'][cardId].lemma, head: snap.kv['read.words'][cardId].head, gloss: snap.kv['read.words'][cardId].gloss }, { lemma: '', head: '', gloss: null }, 'the entry, without its words');
  assert.equal(snap.kv['read.words']['W:Branche.n'].head, 'die Branche', 'a listed word is backed up as before');
  // an export without "Include reading texts" leaves the phrase out too; with it, read.ctx carries it
  assert.ok(!JSON.stringify(exportBundle(store, { profile: { id: PID }, includeReads: false })).includes(SENTINEL));
  assert.ok(JSON.stringify(exportBundle(store, { profile: { id: PID }, includeReads: true })).includes(SENTINEL));
});

test('a phrase saved before the fix: its id stays, its words move to read.ctx (additive, idempotent), the snapshot carries none', async () => {
  const store = await device();
  const gh = mockGithubFor(config.resultsRepo);
  const deck = R.readDeck('de');
  const legacy = 'RP:auf-dem-schirm-haben';   // an id from before the fix (the slug of a public phrase here)
  store.set(R.WORDS, { [legacy]: { lemma: 'auf dem Schirm haben', head: 'auf dem Schirm haben', gloss: `notice ${SENTINEL}`, from: 'me', level: null, zipf: null, kind: 'phrase', home: deck, ref: false, first: DAY, last: DAY, n: 1 } });
  store.set(R.CTX, { [legacy]: [{ readId: 'r9', sentenceId: 's1', de: 'Wir haben das auf dem Schirm.', surface: 'auf dem Schirm haben' }] });
  store.putCards(deck, [[legacy, { S: 2, D: 5, due: '2026-10-22', reps: 1, lapses: 0, last: DAY, first: DAY, stage: 1, streak: 0, learn: null, relearn: false, u: 5, hist: [] }]]);
  const before = R.savedWords(store)[legacy];
  // even before the move, a snapshot leaves the words out
  let files = await upload(store, gh);
  assert.deepEqual(holding(files), [], 'the meaning is not uploaded');
  // the move (practice-read/boot.js runs it at start and whenever read.words changes)
  assert.equal(R.migratePhrases(store), 1);
  assert.equal(R.migratePhrases(store), 0, 'idempotent');
  assert.deepEqual(store.get(R.WORDS)[legacy], { ...before, lemma: '', head: '', gloss: null }, 'the entry keeps every other field');
  assert.deepEqual(R.savedWords(store)[legacy], before, 'the screens read the same entry');
  assert.deepEqual(R.contextOf(store, legacy).map(x => x.de), ['Wir haben das auf dem Schirm.'], 'the sentence stays');
  assert.ok(store.cards(deck)[legacy], 'the card keeps its id (no re-keying)');
  // a text deleted later: the phrase keeps its words in an entry without a sentence
  store.update(R.READS, m => ({ ...(m || {}), r9: { id: 'r9', title: 't', sections: [{ sentences: [{ id: 's1', de: 'Wir haben das auf dem Schirm.' }] }] } }), {});
  R.deleteRead(store, 'r9');
  assert.deepEqual(R.contextOf(store, legacy), [], 'no sentence left');
  assert.equal(R.savedWords(store)[legacy].head, 'auf dem Schirm haben', 'the words are still on the device');
  files = await upload(store, gh);
  const snap = JSON.parse([...files].find(([p]) => p.includes('/snapshots/'))[1]);
  assert.equal(snap.kv['read.words'][legacy].gloss, null);
  assert.ok(snap.cards[deck][legacy], 'the card is backed up under its old id');
});

test('delete a text, then the day\'s log upload: the error log carries none of its sentences', async () => {
  const store = await device();
  const gh = mockGithubFor(config.resultsRepo);
  const read = L.makeRead({ raw: 'Mein Chef Herr Quorxelbrandt hat mich heute gekündigt.', title: 'x', id: 'r1', lang: 'de', now: '', untitled: 'x' });
  R.putRead(store, read);
  quiet(() => log('read', new Error('could not read Mein Chef Herr Quorxelbrandt hat mich heute gekündigt.')));
  quiet(() => log('net', new Error('fetch failed')));
  R.deleteRead(store, 'r1');
  assert.ok(!entries().some(e => e.message.includes('Chef Herr')), 'gone from the ring at once');
  const files = await upload(store, gh);
  const logFile = [...files].find(([p]) => p.includes('/logs/'));
  assert.ok(logFile, 'the log went up');
  assert.ok(logFile[1].includes('fetch failed'), 'other lines stay');
  assert.ok(!logFile[1].includes('Chef Herr'), 'the deleted text\'s sentence is not in it');
});

test('delete a conversation, then the day\'s log upload: its lines are gone; the words he used go up as ids only', async () => {
  const store = await device();
  const gh = mockGithubFor(config.resultsRepo);
  const SID = '0192f0aa-7c3b-7d1e-9a00-0000000000aa';
  const his = `Ich arbeite bei der Firma ${SENTINEL} seit zwei Jahren.`;
  D.putSession(store, { id: SID, v: 1, mode: 'free', topic: { kind: 'own', ref: null }, level: 'B1', partnerLevel: 'B2', register: 'du', day: DAY, startedAt: 1, endedAt: null,
    turns: 1, words: 8, minutes: 3, slower: false, toldSlower: false, models: { turn: 'claude-sonnet-5-5', feedback: 'claude-opus-5-5' },
    promptVersions: { turn: 'conversation-turn@1', session: 'conversation-free@1', feedback: 'conversation-feedback@1' }, usage: C.noUsage(), costUsd: 0, closing: false, counted: true, cards: 0, status: 'ended', deletedAt: null });
  let tr = { id: SID, title: `Mein Tag bei ${SENTINEL}`, messages: [], turns: [] };
  tr = C.commit(tr, { user: null, content: [{ type: 'text', text: 'Hallo!' }], reply: 'Hallo!', at: 2 });
  tr = C.commit(tr, { user: his, content: [{ type: 'text', text: 'Seit zwei Jahren schon?' }], reply: 'Seit zwei Jahren schon?', at: 3 });
  D.putTranscript(store, tr);
  // the real evidence path: the word list on this device, the pack's lookup
  const manifest = JSON.parse(readFileSync(path.join(ROOT, 'content/manifest.json'), 'utf8'));
  const words = JSON.parse(readFileSync(path.join(ROOT, 'content', manifest.files.find(f => f.id === 'igloo.words.de').path), 'utf8'));
  const lang = { pack: de, idx: de.grammar.morphology.index(words) };
  const ids = usedIds(lang, [his]);
  assert.ok(ids.length >= 1 && ids.every(id => /^W:/.test(id)), `listed words as ids: ${ids}`);
  store.update(D.USED, u => C.addEvidence(u || {}, ids, DAY), {});
  quiet(() => log('conversation', new Error(`could not send ${his}`)));
  quiet(() => log('net', new Error('fetch failed')));
  D.deleteConversation(store, SID);
  const files = await upload(store, gh);
  assert.deepEqual(holding(files), [], 'the token is in no uploaded file');
  const logFile = [...files].find(([p]) => p.includes('/logs/'));
  assert.ok(logFile[1].includes('fetch failed') && !logFile[1].includes('arbeite bei der'), 'the conversation\'s line was dropped, the others went up');
  const snap = JSON.parse([...files].find(([p]) => p.includes('/snapshots/'))[1]);
  assert.deepEqual(Object.keys(snap.kv['conv.used']).sort(), [...new Set(ids)].sort(), 'conv.used: item ids');
});

test('device-only collections never go into an export: exam.window, today.anyway, conv.spend (and back in, never read)', async () => {
  const store = await device();
  store.set('exam.window', { recapped: '2026-10-13' });
  store.set('today.anyway', { day: DAY });
  store.set('conv.spend', { month: '2026-10', usd: 1.2 });
  const b = exportBundle(store, { profile: { id: PID } });
  for (const k of ['exam.window', 'today.anyway', 'conv.spend', 'secrets', 'backup']) assert.ok(!(k in b.kv), k);
});
