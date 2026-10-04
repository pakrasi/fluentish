// The results sync (src/data/sync/github-b1exam.js): file names and shapes, retries that never duplicate, voice
// blobs kept until both uploads succeed, unsent items from the old app, and a contract test that runs the REAL
// scripts/sync.py of the B1 exam app over the files this adapter writes, in a temp directory with HOME pointed
// there (so the real database, voice folder and repository are never touched). All data here is synthetic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, readFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from '../../src/data/store.js';
import { createMemoryAdapter } from '../../src/data/adapters/memory.js';
import {
  pathFor, stamp, filesFor, sidecarPath, appendResult, createGithubB1Exam, syncResults, resetThrottle, notSentCount,
  attemptFile, legacyJobs, wordKey, audioExt, allowLegacy,
} from '../../src/data/sync/github-b1exam.js';
import { mockGithubFor, B1, haveSyncPy } from './sync-harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PID = '0192a3b4-c5d6-7e8f-9a0b-000000000001';
const REPO = 'someone/results';
const AT = new Date(Date.UTC(2026, 9, 3, 18, 4, 5));

async function fresh(secrets = { githubToken: 'test-token-not-real' }) {
  const adapter = createMemoryAdapter();
  const store = await Store.open({ adapter, profile: { id: PID, name: '', kind: 'local' }, device: { deviceId: 'dev1', seq: 0 }, clock: { today: () => '2026-10-03' } });
  store.set('secrets', secrets);
  await store.flush();
  return { adapter, store };
}

const mockGithub = () => mockGithubFor(REPO);

const lesenAttempt = (over = {}) => ({
  id: '0192a3b4-c5d6-7e8f-9a0b-0000000000a1', day: 3, module: 'lesen', started_at: '2026-10-03T13:00:00.000-04:00',
  submitted_at: '2026-10-03T14:04:05.000-04:00', duration_s: 3700, score: 2, max_score: 3, meta: { pauses: { count: 1, seconds: 60 } },
  responses: [
    { item_id: 'L1-1', teil: 'L1', skill: 'detail', given: 'r', correct: 'r', is_correct: 1 },
    { item_id: 'L1-2', teil: 'L1', skill: 'negation', given: null, correct: 'f', is_correct: 0 },
    { item_id: 'L3-1', teil: 'L3', skill: 'matching', given: 'c', correct: 'C', is_correct: 1 },
  ],
  writings: [], ...over,
});

test('paths: UTC stamp without dashes, fixed per event, the formats sync.py reads', () => {
  assert.equal(stamp(AT), '20261003T180405');
  assert.equal(pathFor('exam.attempt', { file: { day: 3, module: 'lesen' } }, AT), 'data/attempts/20261003T180405-day03-lesen.json');
  const v = pathFor('exam.voice', { day: 12, module: 'sprechen', part: 'teil2', mime: 'audio/mp4' }, AT);
  assert.equal(v, 'data/voice/day12/20261003T180405-sprechen-teil2.m4a');
  assert.equal(sidecarPath(v), 'data/voice/day12/20261003T180405-sprechen-teil2.json');
  assert.equal(pathFor('feedback.created', { day: 2, module: 'schreiben' }, AT), 'data/feedback-ai/20261003T180405-day02-schreiben.json');
  assert.equal(pathFor('vocab.captured', { word: 'Nachbarschaft!' }, AT), 'data/vocab/20261003T180405-nachbarschaft.json');
  assert.equal(pathFor('vocab.reviewed', { batch: 'k3x9', events: [] }, AT), 'data/vocab-reviews/20261003T180405-k3x9.json');
  assert.equal(pathFor('training.logged', { task: '2-a1' }, AT), 'data/training/20261003T180405-2-a1.json');
  assert.equal(audioExt('audio/webm;codecs=opus'), 'webm');
  assert.equal(wordKey(' Größe, '), 'größe');
});

test('file bodies carry exactly the fields sync.py imports', async () => {
  const [att] = filesFor({ type: 'exam.attempt', path: 'p.json', payload: { file: attemptFile({ ...lesenAttempt(), profileId: PID, legacy: null, synced: false }) } });
  const a = JSON.parse(att.body);
  assert.deepEqual(Object.keys(a).sort(), ['day', 'duration_s', 'id', 'max_score', 'meta', 'module', 'responses', 'score', 'started_at', 'submitted_at', 'writings']);
  assert.equal(a.meta.source, 'remote');
  assert.deepEqual(Object.keys(a.responses[0]).sort(), ['correct', 'given', 'is_correct', 'item_id', 'skill', 'teil']);
  assert.equal(att.message, 'Tag 3 lesen 2/3');

  const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm' });
  const vf = filesFor({ type: 'exam.voice', path: 'data/voice/day03/x-sprechen-teil1.webm', payload: { day: 3, module: 'sprechen', part: 'teil1', label: 'L', mime: 'audio/webm', created_at: 'c', bytes: 3 } }, blob);
  assert.deepEqual(vf.map(x => x.path), ['data/voice/day03/x-sprechen-teil1.json', 'data/voice/day03/x-sprechen-teil1.webm']);
  assert.deepEqual(Object.keys(JSON.parse(vf[0].body)).sort(), ['bytes', 'created_at', 'day', 'label', 'mime', 'module', 'part']);
  assert.throws(() => filesFor({ type: 'exam.voice', path: 'x.webm', payload: {} }, null), /recording missing/);

  const [fb] = filesFor({ type: 'feedback.created', path: 'f.json', payload: { day: 3, module: 'schreiben', attempt_id: 'u1', attempt_file: 'data/attempts/x.json', body: '! circa 60 / 100', created_at: 'c', model: 'm' } });
  assert.deepEqual(Object.keys(JSON.parse(fb.body)).sort(), ['attempt_file', 'attempt_id', 'body', 'created_at', 'day', 'model', 'module']);
  const [rv] = filesFor({ type: 'vocab.reviewed', path: 'r.json', payload: { batch: 'b', events: [{ day: 1, word: 'Haus', known: true, at: 'x' }] } });
  assert.deepEqual(JSON.parse(rv.body), { events: [{ day: 1, word: 'Haus', known: true, at: 'x' }] });
});

test('a failed upload is retried to the same file; a 422 sha counts as sent; nothing is sent twice', async () => {
  resetThrottle();
  const { store, adapter } = await fresh();
  const gh = mockGithub();
  const a = lesenAttempt();
  const e = appendResult(store, 'exam.attempt', { attemptId: a.id, file: attemptFile(a) }, AT);
  store.putAttempts([{ ...a, synced: false, eventId: e.id, path: e.path }]);
  // a recording: the blob is stored before the event, under the event's blobRef
  const blob = new Blob([new Uint8Array(2048).fill(7)], { type: 'audio/webm' });
  const vp = { day: 3, module: 'sprechen', part: 'teil1', label: 'Planen', mime: 'audio/webm', bytes: blob.size, created_at: '2026-10-03T14:10:00.000-04:00', blobRef: 'blob-1' };
  await adapter.putBlob('blob-1', blob);
  appendResult(store, 'exam.voice', vp, new Date(AT.getTime() + 60000));
  assert.equal(notSentCount(store), 2);

  gh.mode = 'offline';
  let r = await syncResults(store, { repo: REPO, fetch: gh.fetch, force: true, pull: false });
  assert.equal(r.ok, 0); assert.equal(r.pending, 2); assert.match(r.error, /connection/i);
  assert.ok(await adapter.getBlob('blob-1'), 'the recording stays on the device');

  gh.mode = 'ok';
  gh.files.set(e.path, 'already-there');            // the first try did arrive, its answer was lost
  r = await syncResults(store, { repo: REPO, fetch: gh.fetch, force: true, pull: false });
  assert.equal(r.ok, 2); assert.equal(r.pending, 0); assert.equal(r.error, null);
  assert.equal(store.attempts()[0].synced, true);
  assert.equal(await adapter.getBlob('blob-1'), null, 'deleted once both files are up');
  const puts = gh.calls.filter(c => c.method === 'PUT').map(c => c.path);
  assert.deepEqual(puts.filter(p => p === e.path).length, 2, 'the retry used the same path');
  assert.ok(gh.files.has('data/voice/day03/20261003T180505-sprechen-teil1.json'));
  assert.equal(Buffer.from(gh.files.get('data/voice/day03/20261003T180505-sprechen-teil1.webm'), 'base64').length, 2048);

  const before = gh.calls.length;
  r = await syncResults(store, { repo: REPO, fetch: gh.fetch, force: true, pull: false });
  assert.equal(r.ok, 0); assert.equal(gh.calls.length, before, 'nothing left to send');
});

test('auth errors stop the flush and keep everything; no token means nothing is attempted', async () => {
  resetThrottle();
  const { store } = await fresh({ githubToken: null });
  const gh = mockGithub();
  appendResult(store, 'feedback.created', { day: 1, module: 'schreiben', attempt_id: 'u', attempt_file: null, body: 'x', created_at: 'c' }, AT);
  let r = await syncResults(store, { repo: REPO, fetch: gh.fetch, force: true });
  assert.equal(r.skipped, true); assert.equal(gh.calls.length, 0); assert.equal(r.pending, 1);
  store.set('secrets', { githubToken: 'test-token-not-real' });
  gh.mode = 'auth';
  r = await syncResults(store, { repo: REPO, fetch: gh.fetch, force: true });
  assert.match(r.error, /token/); assert.equal(r.pending, 1);
  assert.equal(store.get('exams.syncStatus').pending, 1);
});

test('unsent items moved from the old app are sent with the path it chose, then marked sent', async () => {
  resetThrottle();
  const { store } = await fresh();
  const gh = mockGithub();
  store.putAttempts([{ ...lesenAttempt({ id: '0192a3b4-c5d6-7e8f-9a0b-0000000000b2' }), legacy: { id: 1790000000000, path: 'data/attempts/20260930T235959-day03-lesen.json' }, synced: false }]);
  store.set('exams.feedbackLocal', [{ id: 'local-1', day: 2, module: 'schreiben', attempt_id: 1790000000001, alias_id: 15, attempt_file: 'data/attempts/a.json', body: 'B', created_at: '2026-10-01T09:00:00-04:00', synced: false, _path: 'data/feedback-ai/20261001T130000-day02-schreiben.json' }]);
  store.set('vocab.local', [{ id: '2:haus', day: 2, word: 'Haus', word_key: 'haus', created_at: '2026-10-01T09:00:00-04:00', synced: false }]);
  store.set('vocab.events', [{ day: 2, word: 'Haus', known: true, at: '2026-10-01T10:00:00Z', synced: false }, { day: 2, word: 'Baum', known: false, at: '2026-09-01T10:00:00Z' }]);
  assert.equal(legacyJobs(store).length, 4);
  // a migration: nothing is uploaded before the import notice was seen, and old items wait for their own tap
  store.set('meta', { summary: { cards: 1 }, migratedAt: '2026-10-02T08:00:00+02:00' });
  appendResult(store, 'feedback.created', { day: 1, module: 'schreiben', attempt_id: 'u', attempt_file: null, body: 'x', created_at: 'c' }, AT);
  let r = await syncResults(store, { repo: REPO, fetch: gh.fetch, force: true, pull: false });
  assert.equal(r.ok, 0); assert.equal(gh.calls.filter(c => c.method === 'PUT').length, 0, 'no upload before the notice');
  store.set('ui', { importSeen: true });
  resetThrottle();
  r = await syncResults(store, { repo: REPO, fetch: gh.fetch, force: true, pull: false });
  assert.equal(r.ok, 1, 'new work goes out once the notice is seen'); assert.equal(r.pending, 4, 'old items still wait');
  allowLegacy(store);
  resetThrottle();
  r = await syncResults(store, { repo: REPO, fetch: gh.fetch, force: true, pull: false });
  assert.equal(r.ok, 4); assert.equal(r.pending, 0);
  assert.equal(gh.json('data/attempts/20260930T235959-day03-lesen.json').id, 1790000000000, 'the old id is kept in the file');
  assert.equal(gh.json('data/feedback-ai/20261001T130000-day02-schreiben.json').attempt_id, 15, 'the Mac alias wins');
  assert.equal(store.get('vocab.events')[1].synced, undefined, 'entries without a flag were sent long ago');
});

test('pull lists data/ once, fetches only changed files, never asks for missing ones; 304 keeps the cache', async () => {
  resetThrottle();
  const { store } = await fresh();
  const gh = mockGithub();
  gh.reads['data/feedback.json'] = { feedback: [{ id: 1, day: 1, module: 'schreiben', attempt_id: 3, body: '! circa 61 / 100 · bestanden', created_at: 'x', source: 'tutor' }] };
  gh.reads['data/results.json'] = { days: { 1: { attempts: {}, voice: [], feedback: [] } } };
  let r = await syncResults(store, { repo: REPO, fetch: gh.fetch, force: true });
  assert.equal(r.error, null);
  const remote = store.get('exams.remote');
  assert.equal(remote.feedback.feedback.length, 1);
  assert.equal(remote.vocab, undefined, 'a missing file is not requested');
  assert.ok(!gh.calls.some(c => c.path === 'data/learner.json' || c.path === 'data/vocab.json'));
  assert.ok(remote.cursor.etag && remote.cursor.shas.feedback);
  // nothing changed: one listing request, answered 304
  resetThrottle();
  const n = gh.calls.length;
  await syncResults(store, { repo: REPO, fetch: gh.fetch, force: true });
  assert.deepEqual(gh.calls.slice(n).map(c => c.path), ['data']);
  assert.equal(gh.calls.at(-1).headers['If-None-Match'], remote.cursor.etag);
  // results changed: only results.json is fetched again
  gh.reads['data/results.json'] = { days: { 1: { attempts: {}, voice: [{ day: 1, transcript: 'Hallo' }], feedback: [] } } };
  resetThrottle();
  const m = gh.calls.length;
  await syncResults(store, { repo: REPO, fetch: gh.fetch, force: true });
  assert.deepEqual(gh.calls.slice(m).map(c => c.path), ['data', 'data/results.json']);
  assert.equal(store.get('exams.remote').results.days[1].voice[0].transcript, 'Hallo');
  assert.equal(store.get('exams.remote').feedback.feedback.length, 1, 'unchanged docs are kept');
});

/* ---------- contract test against the real sync.py ---------- */


test('the real sync.py imports every file this adapter writes, once', { skip: !haveSyncPy && 'the B1 exam app is not on this machine' }, async () => {
  resetThrottle();
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'fluentish-syncpy-'));
  try {
    // a throwaway copy of the repo layout: scripts/sync.py, server.py, docs/exams (public tests), data/
    mkdirSync(path.join(tmp, 'scripts'), { recursive: true });
    copyFileSync(path.join(B1, 'scripts/sync.py'), path.join(tmp, 'scripts/sync.py'));
    copyFileSync(path.join(B1, 'server.py'), path.join(tmp, 'server.py'));
    mkdirSync(path.join(tmp, 'docs/exams'), { recursive: true });
    mkdirSync(path.join(tmp, 'docs/data'), { recursive: true });
    for (const f of readdirSync(path.join(ROOT, 'content/exams/goethe-b1')).filter(f => /^day\d\d\.json$/.test(f))) copyFileSync(path.join(ROOT, 'content/exams/goethe-b1', f), path.join(tmp, 'docs/exams', f));
    const home = path.join(tmp, 'home');
    mkdirSync(home);

    // write through the adapter into a mock GitHub
    const { store, adapter } = await fresh();
    const gh = mockGithub();
    const a = lesenAttempt();
    const ea = appendResult(store, 'exam.attempt', { attemptId: a.id, file: attemptFile(a) }, AT);
    const s = { ...lesenAttempt({ id: '0192a3b4-c5d6-7e8f-9a0b-0000000000a2', module: 'schreiben', score: null, max_score: 100, responses: [] }), writings: [{ aufgabe: 'aufgabe1', text: 'Liebe Anna, ich komme gern.', word_count: 5 }] };
    const es = appendResult(store, 'exam.attempt', { attemptId: s.id, file: attemptFile(s) }, new Date(AT.getTime() + 1000));
    appendResult(store, 'feedback.created', { day: 3, module: 'schreiben', attempt_id: s.id, attempt_file: es.path, body: '! circa 58 / 100 · knapp unter 60\n~~ich komme gern~~ → ==ich komme gerne==', created_at: '2026-10-03T15:00:00-04:00', model: 'test-model' }, new Date(AT.getTime() + 2000));
    await adapter.putBlob('b1', new Blob([new Uint8Array(512)], { type: 'audio/mp4' }));
    appendResult(store, 'exam.voice', { day: 3, module: 'sprechen', part: 'teil2', label: 'Thema A', mime: 'audio/mp4', bytes: 512, created_at: '2026-10-03T15:10:00-04:00', blobRef: 'b1' }, new Date(AT.getTime() + 3000));
    appendResult(store, 'vocab.captured', { day: 3, module: 'lesen', teil: 'Teil 1', word: 'Nachbarschaft', sentence: 'Die Nachbarschaft ist ruhig.', created_at: '2026-10-03T15:20:00-04:00' }, new Date(AT.getTime() + 4000));
    appendResult(store, 'vocab.reviewed', { batch: 'ab12', events: [{ day: 3, word: 'Nachbarschaft', known: true, at: '2026-10-03T15:30:00-04:00' }] }, new Date(AT.getTime() + 5000));
    appendResult(store, 'training.logged', { task: '3-a1', day: 3, aufgabe: 'aufgabe1', text: 'Liebe Anna', result: { ok: true }, model: 'test-model', usage: null, at: '2026-10-03T15:40:00-04:00' }, new Date(AT.getTime() + 6000));
    const r = await syncResults(store, { repo: REPO, fetch: gh.fetch, force: true, pull: false });
    assert.equal(r.ok, 7); assert.equal(r.error, null);
    for (const [p, b64] of gh.files) { mkdirSync(path.dirname(path.join(tmp, p)), { recursive: true }); writeFileSync(path.join(tmp, p), Buffer.from(b64, 'base64')); }

    const env = { ...process.env, HOME: home };
    const run = () => execFileSync('python3', [path.join(tmp, 'scripts/sync.py'), '--no-push'], { env, encoding: 'utf8' });
    const out1 = run();
    assert.match(out1, /imported 7,/, out1);
    const appDir = path.join(home, 'Library', 'Application Support', 'fritz');   // sync.py's APP under the temp HOME
    const db = path.join(appDir, 'b1-exam.db');
    const q = sql => JSON.parse(execFileSync('python3', ['-c', 'import sqlite3,json,sys; c=sqlite3.connect(sys.argv[1]); c.row_factory=sqlite3.Row; print(json.dumps([dict(r) for r in c.execute(sys.argv[2])]))', db, sql], { encoding: 'utf8' }));
    const atts = q('SELECT id, day, module, score, max_score, meta FROM attempts ORDER BY id');
    assert.deepEqual(atts.map(x => [x.day, x.module, x.score]), [[3, 'lesen', 2], [3, 'schreiben', null]]);
    assert.equal(JSON.parse(atts[0].meta).file, ea.path);
    assert.equal(q('SELECT COUNT(*) n FROM responses')[0].n, 3);
    assert.equal(q('SELECT word_count FROM writings')[0].word_count, 5);
    const fb = q('SELECT attempt_id, source FROM feedback');
    assert.deepEqual(fb, [{ attempt_id: atts[1].id, source: 'fritz-app' }], 'the correction found its attempt by file');
    const voice = q('SELECT day, module, part, label, bytes FROM voice_notes');
    assert.deepEqual(voice, [{ day: 3, module: 'sprechen', part: 'teil2', label: 'Thema A', bytes: 512 }]);
    assert.ok(existsSync(path.join(appDir, 'b1-voice', 'day03')));
    const vocab = q('SELECT word, box, reviews FROM vocab');
    assert.deepEqual(vocab, [{ word: 'Nachbarschaft', box: 1, reviews: 1 }]);
    assert.equal(q('SELECT COUNT(*) n FROM training_checks')[0].n, 1);
    // the files sync.py writes back are what the adapter reads
    const feedbackJson = JSON.parse(readFileSync(path.join(tmp, 'data/feedback.json'), 'utf8'));
    assert.equal(feedbackJson.feedback[0].attempt_id, atts[1].id);
    const results = JSON.parse(readFileSync(path.join(tmp, 'data/results.json'), 'utf8'));
    assert.equal(results.days['3'].attempts.lesen.file, ea.path, 'results.json links the attempt to its file (the alias)');
    // idempotent: a second run imports nothing
    assert.match(run(), /imported 0,/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('an old item without a time keeps created_at null; its file name takes the migration time, never now', async () => {
  resetThrottle();
  const { store } = await fresh();
  store.set('meta', { summary: { cards: 1 }, migratedAt: '2026-10-02T08:00:00+02:00' });
  store.set('exams.feedbackLocal', [{ id: 'local-9', day: 4, module: 'schreiben', attempt_id: 7, body: 'B', synced: false }]);
  const [job] = legacyJobs(store);
  assert.equal(job.event.payload.created_at, null);
  assert.equal(job.event.path, 'data/feedback-ai/20261002T060000-day04-schreiben.json');
});
