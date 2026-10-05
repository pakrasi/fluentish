// Word audio (src/services/audio.js). The index that maps a text to a recording comes from, in order: the private
// copy pulled by the results sync (exams.vocabAudio), the public <media>/vocab/manifest.json, or nothing (then the
// device's German voice). The page CSP allows the media origin for the public fetch (connect-src) and the files
// (media-src). No network: fetch, Audio and speechSynthesis are mocks. All data is synthetic.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { audioManifest, audioUrl, audioKey, play, resetAudio, VOCAB_AUDIO_KV } from '../../src/services/audio.js';
import { Store } from '../../src/data/store.js';
import { createMemoryAdapter } from '../../src/data/adapters/memory.js';
import { syncResults, resetThrottle, PULLED } from '../../src/data/sync/github-b1exam.js';
import { exportBundle } from '../../src/data/transfer.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const manifest = JSON.parse(readFileSync(path.join(ROOT, 'content/manifest.json'), 'utf8'));
const csp = /Content-Security-Policy" content="([^"]+)"/.exec(readFileSync(path.join(ROOT, 'index.html'), 'utf8'))[1];
const directive = name => (csp.split(';').map(s => s.trim()).find(s => s.startsWith(name + ' ')) || '').split(/\s+/).slice(1);
const media = manifest.exams.find(e => e.media).media;
const content = { manifest: async () => manifest };
const PUBLIC = new URL('vocab/manifest.json', media).href;

/** fetch mock: the public index, or a 404 once the privacy fix removed it. */
function publicFetch(index) {
  const calls = [];
  const f = async url => { calls.push(url); return index ? new Response(JSON.stringify(index), { status: 200 }) : new Response('Not Found', { status: 404 }); };
  return { f, calls };
}
const storeWith = index => ({ get: (k, d) => (k === VOCAB_AUDIO_KV && index !== undefined ? index : d) });

/** Browser audio mocks: records what play() did. */
function mockBrowser({ germanVoice = true } = {}) {
  const did = { audio: [], spoken: [] };
  globalThis.Audio = class { constructor(src) { this.src = src; did.audio.push(src); } play() { return Promise.resolve(); } pause() {} addEventListener() {} };
  globalThis.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  globalThis.speechSynthesis = {
    getVoices: () => (germanVoice ? [{ lang: 'de-DE', name: 'Anna' }] : [{ lang: 'en-US', name: 'Samantha' }]),
    speak: u => did.spoken.push(u.text), cancel: () => {},
  };
  return did;
}

beforeEach(() => resetAudio());

test('the CSP allows the media origin for the public index and the recordings', () => {
  const origin = new URL(media).origin;
  assert.ok(directive('connect-src').includes(origin), `connect-src has ${origin}`);
  assert.ok(directive('media-src').includes(origin), `media-src has ${origin}`);
});

test('1. private index: read from the store, the public file is never fetched', async () => {
  const { f, calls } = publicFetch({ 'Ich habe einen Termin.': 'public.mp3' });
  const store = storeWith({ 'Ich habe einen Termin.': 'ab12.mp3' });
  const m = await audioManifest(content, { store, fetch: f });
  assert.equal(m.source, 'private');
  assert.equal(await audioUrl(content, 'a)  Ich habe  einen Termin.', { store, fetch: f }), new URL('vocab/ab12.mp3', media).href);
  assert.equal(await audioUrl(content, 'Nicht da.', { store, fetch: f }), null);
  assert.deepEqual(calls, [], 'no public fetch');
  const did = mockBrowser();
  assert.equal(await play(content, 'Ich habe einen Termin.', store), true);
  assert.deepEqual(did.audio, [new URL('vocab/ab12.mp3', media).href]);
  assert.deepEqual(did.spoken, []);
});

test('2. no private copy yet (no token, preview profile, not pulled): the public index, fetched once', async () => {
  const { f, calls } = publicFetch({ 'Ich habe einen Termin.': 'ab12.mp3' });
  for (const store of [null, storeWith(undefined), storeWith(null), storeWith({})]) {
    const m = await audioManifest(content, { store, fetch: f });
    assert.equal(m.source, 'public');
  }
  assert.deepEqual(calls, [PUBLIC], 'fetched once per session');
  assert.equal(await audioUrl(content, 'b) Ich habe einen Termin.', { fetch: f }), new URL('vocab/ab12.mp3', media).href);
  // a private copy that arrives with a later sync takes over at once
  assert.equal((await audioManifest(content, { store: storeWith({ x: 'y.mp3' }), fetch: f })).source, 'private');
});

test('3. no private copy and no public index (404, offline): the device voice, or nothing', async () => {
  const { f } = publicFetch(null);
  const m = await audioManifest(content, { store: storeWith(null), fetch: f });
  assert.deepEqual([m.source, m.files], ['none', {}]);
  // play() uses the global fetch: point it at the 404
  const real = globalThis.fetch;
  globalThis.fetch = f;
  try {
    resetAudio();
    let did = mockBrowser();
    assert.equal(await play(content, 'Guten Tag', storeWith(null)), true);
    assert.deepEqual(did.audio, []);
    assert.deepEqual(did.spoken, ['Guten Tag'], 'the device voice speaks');
    resetAudio();
    globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
    did = mockBrowser();
    assert.equal(await play(content, 'Guten Tag'), true, 'offline: the device voice too');
    assert.deepEqual(did.spoken, ['Guten Tag']);
  } finally { globalThis.fetch = real; }
});

test('audioKey drops the list prefix and extra spaces', () => {
  assert.equal(audioKey('b) Guten  Tag '), 'Guten Tag');
});

/* ---------- the results sync pulls data/vocab-audio.json with the token ---------- */

const REPO = 'someone/results';
const PID = '0192a3b4-c5d6-7e8f-9a0b-000000000001';

test('the sync pulls the private index into its own store key, sent with the token; not exported', async () => {
  assert.ok(PULLED.includes('vocab-audio'));
  resetThrottle();
  const store = await Store.open({ adapter: createMemoryAdapter(), profile: { id: PID, name: '', kind: 'local' }, device: { deviceId: 'dev1', seq: 0 }, clock: { today: () => '2026-10-03' } });
  store.set('secrets', { githubToken: 'test-token-not-real' });
  const reads = { 'data/feedback.json': { feedback: [] }, 'data/vocab-audio.json': { 'Ich habe einen Termin.': 'ab12.mp3' } };
  const calls = [];
  const f = async (url, init = {}) => {
    const p = decodeURIComponent(new URL(url).pathname.replace(`/repos/${REPO}/contents/`, ''));
    calls.push({ path: p, auth: init.headers?.Authorization || init.headers?.authorization || '' });
    if (p === 'data') return new Response(JSON.stringify(Object.keys(reads).map(k => ({ type: 'file', name: k.slice(5), sha: `s-${k}` }))), { status: 200, headers: { etag: '"e1"' } });
    return reads[p] ? new Response(JSON.stringify(reads[p]), { status: 200 }) : new Response('{}', { status: 404 });
  };
  // a cursor from before 'vocab-audio' was pulled: the listing is read again despite the old ETag
  store.set('exams.remote', { cursor: { etag: '"e1"', shas: { feedback: 's-data/feedback.json' } } });
  const r = await syncResults(store, { repo: REPO, fetch: f, force: true });
  assert.equal(r.error, null);
  const got = calls.find(c => c.path === 'data/vocab-audio.json');
  assert.ok(got, 'fetched');
  assert.match(got.auth, /test-token-not-real/, 'with the token');
  assert.deepEqual(store.get(VOCAB_AUDIO_KV), { 'Ich habe einen Termin.': 'ab12.mp3' });
  assert.equal(store.get('exams.remote')['vocab-audio'], undefined, 'not inside exams.remote');
  assert.equal(await audioUrl(content, 'Ich habe einen Termin.', { store, fetch: publicFetch(null).f }), new URL('vocab/ab12.mp3', media).href);
  assert.ok(!(VOCAB_AUDIO_KV in exportBundle(store, { profile: { id: PID, name: '', kind: 'local' } }).kv), 'a cache, not exported');
  // a preview profile never syncs, so it never reads the private file
  resetThrottle();
  const shadow = await Store.open({ adapter: createMemoryAdapter(), profile: { id: PID, name: '', kind: 'shadow' }, device: { deviceId: 'dev2', seq: 0 }, clock: { today: () => '2026-10-03' } });
  shadow.set('secrets', { githubToken: 'test-token-not-real' });
  const n = calls.length;
  assert.equal((await syncResults(shadow, { repo: REPO, fetch: f, force: true })).skipped, true);
  assert.equal(calls.length, n);
});
