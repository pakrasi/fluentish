// Conversation's privacy (round 4, lane L4; PLAN-REVIEW gates "sentinel" and B5/B6): a conversation whose turns and
// own topic hold a unique token goes through what the feature stores (session, transcript, feedback, a carded mistake,
// the evidence, the month's spend, an error that carries a sentence) and the token must be found only in the
// device-only collections (conv.transcripts, conv.feedback): never in conv.sessions, a snapshot, the backed-up events,
// the uploaded error log or an export. Mistakes are learning items and ARE backed up (B5). Synthetic text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../../src/data/store.js';
import { createMemoryAdapter } from '../../src/data/adapters/memory.js';
import { log, entries, resetLog } from '../../src/core/log.js';
import * as B from '../../src/data/sync/backup.js';
import { exportBundle } from '../../src/data/transfer.js';
import { addMistakes } from '../../src/data/mistakes.js';
import * as C from '../../src/domain/conversation.js';
import * as D from '../../src/features/practice-conversation/data.js';

const PID = '0192a3b4-c5d6-7e8f-9a0b-00000000c0a0';
const DAY = '2026-10-20';
const SENTINEL = 'Quorxelbrandt';
const SID = '0192f0aa-7c3b-7d1e-9a00-000000000042';
const quiet = (/** @type {() => any} */ fn) => { const e = console.error; console.error = () => {}; try { return fn(); } finally { console.error = e; } };

async function session() {
  const store = await Store.open({ adapter: createMemoryAdapter(), profile: { id: PID, name: '', kind: 'local' }, device: { deviceId: 'dev', seq: 0 }, clock: { today: () => DAY } });
  store.set('settings', { v: 1, language: 'german', level: 'B1', exam: { type: null, date: null, modules: [] }, minutesPerDay: 60, newPerDay: null, practice: {}, onboarded: '2026-10-01T09:00:00.000+02:00', rev: {} });
  return store;
}

/** @param {any} store */
function places(store) {
  /** @type {Record<string, string>} */ const out = {};
  for (const [name, v] of Object.entries(store.kv)) out[`kv:${name}`] = JSON.stringify(v);
  for (const [deck, recs] of Object.entries(store.cardsByDeck)) out[`cards:${deck}`] = JSON.stringify(recs);
  out.events = JSON.stringify([...store.events.values()]);
  return out;
}

test('a conversation never leaves the device-only collections; its numbers and his chosen cards are backed up', async () => {
  resetLog();
  const store = await session();
  // his own topic holds the token: the title lives in the transcript only
  D.putSession(store, { id: SID, v: 1, mode: 'free', topic: { kind: 'own', ref: null }, level: 'B1', partnerLevel: 'B2', register: 'du', day: DAY, startedAt: 1, endedAt: null,
    turns: 0, words: 0, minutes: 0, slower: false, toldSlower: false, models: { turn: 'claude-sonnet-5-5', feedback: 'claude-opus-5-5' },
    promptVersions: { turn: 'conversation-turn@1', session: 'conversation-free@1', feedback: 'conversation-feedback@1' }, usage: C.noUsage(), costUsd: 0, closing: false, counted: false, cards: 0, status: 'open', deletedAt: null });
  /** @type {any} */ let tr = { id: SID, title: `Die Firma ${SENTINEL}`, messages: [], turns: [], system: { base: 'b', session: `Topic: Die Firma ${SENTINEL}`, interests: [] } };
  tr = C.commit(tr, { user: null, content: [{ type: 'text', text: 'Hallo!' }], reply: 'Hallo!', at: 2 });
  const his = `Ich arbeite bei der Firma ${SENTINEL} seit zwei Jahren.`;
  tr = C.commit(tr, { user: his, content: [{ type: 'thinking', thinking: '', signature: 's' }, { type: 'text', text: 'Seit zwei Jahren?' }], reply: 'Seit zwei Jahren?', at: 3 });
  D.putTranscript(store, tr);
  D.charge(store, SID, DAY, 'claude-sonnet-5-5', { in: 100, cacheRead: 900, cacheWrite: 50, out: 40 });
  D.patchSession(store, SID, { status: 'ended', turns: 1, words: C.wordsIn(his), minutes: 3, counted: true });
  D.putFeedback(store, { id: 'f1', v: 1, sessionId: SID, model: 'claude-opus-5-5', promptVersion: 'conversation-feedback@1', createdAt: '', raw: { used_well: [{ turn: 1, text: his }] }, dropped: [], added: [] });
  // a carded mistake: a learning item, backed up with the other mistakes (it holds no token here)
  const added = addMistakes(store, { attemptId: `C-${SID}`, test: null, module: 'conversation', label: 'Conversation · your own topic', items: [{ wrong: 'Ich arbeite seit zwei Jahren bei ihr gearbeitet.', right: 'Ich arbeite seit zwei Jahren bei ihr.', rule: 'r' }] });
  assert.equal(added[0], `F:C-${SID}-1`);
  store.update(D.USED, (/** @type {any} */ u) => C.addEvidence(u || {}, ['W:arbeiten.v'], DAY), {});
  // an error that carries his sentence
  quiet(() => log('conversation', new Error(`could not send ${his}`)));

  const where = Object.entries(places(store)).filter(([, s]) => s.includes(SENTINEL)).map(([k]) => k).sort();
  assert.deepEqual(where, ['kv:conv.feedback', 'kv:conv.transcripts']);

  // conv.sessions: numbers, ids and fixed words only (B6)
  const s = D.getSession(store, SID);
  const strings = JSON.stringify(s).match(/"(?:[^"\\]|\\.)*"/g) || [];
  for (const str of strings) assert.match(str.slice(1, -1), /^([a-zA-Z.@-]*\d*[a-zA-Z.@-]*|[0-9a-f-]{36}|\d{4}-\d\d-\d\d|claude-[a-z0-9-]+|conversation-[a-z]+@\d+)$/, `no free text in conv.sessions: ${str}`);

  // the snapshot carries the sessions, the evidence and the mistakes; never the transcript, the feedback or the spend
  const snap = B.snapshotOf(store, { now: Date.now() });
  assert.ok(snap.kv['conv.sessions'] && snap.kv['conv.used'] && snap.kv.mistakes);
  for (const name of ['conv.transcripts', 'conv.feedback', 'conv.spend']) assert.ok(!(name in snap.kv), name);
  assert.ok(!JSON.stringify(snap).includes(SENTINEL));
  assert.equal(B.leakIn(JSON.stringify(snap)), null);
  const lines = [...store.events.values()].filter(B.backupable).map(B.lineOf).join('\n');
  assert.ok(!lines.includes(SENTINEL));

  // the error log upload replaces the line (three words in a row of a transcript)
  /** @type {Map<string, string>} */ const files = new Map();
  const target = {
    read: async (/** @type {string} */ p) => (files.has(p) ? { bytes: new TextEncoder().encode(files.get(p)), sha: 's' } : null),
    write: async (/** @type {string} */ p, /** @type {string} */ text) => { files.set(p, text); return 's'; },
  };
  assert.equal(await B.uploadLog(store, /** @type {any} */ (target), { entries: entries(), now: () => Date.now(), secrets: {} }), 1);
  const up = [...files.values()].join('\n');
  assert.ok(up.includes('[removed: script text]') && !up.includes(SENTINEL), up);

  // an export (his own file) leaves the transcripts and the feedback on the device
  const ex = exportBundle(store, { profile: { id: PID, name: '', createdAt: '' }, includeScripts: true, includeReads: true });
  assert.ok(!JSON.stringify(ex).includes(SENTINEL));
  assert.ok(ex.kv['conv.sessions'], 'the numbers are exported');
  resetLog();
});

test('deleting a conversation removes its text; its numbers and cards stay', async () => {
  const store = await session();
  D.putSession(store, /** @type {any} */ ({ id: SID, v: 1, mode: 'free', topic: { kind: 'own', ref: null }, startedAt: 1, status: 'ended', deletedAt: null }));
  D.putTranscript(store, { id: SID, title: SENTINEL, messages: [], turns: [] });
  D.putFeedback(store, { sessionId: SID, raw: { summary: SENTINEL } });
  addMistakes(store, { attemptId: `C-${SID}`, module: 'conversation', label: 'x', items: [{ wrong: 'a b', right: 'b a' }] });
  D.deleteConversation(store, SID);
  assert.deepEqual(Object.entries(places(store)).filter(([, s]) => s.includes(SENTINEL)).map(([k]) => k), []);
  assert.ok(D.getSession(store, SID)?.deletedAt);
  assert.equal(Object.keys(store.get('mistakes')).length, 1);
});
