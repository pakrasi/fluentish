// The credentials seam (src/data/credentials.js, arch F4) and how services/claude.js uses what it returns: a key on
// this device, none, a proxy credential (the accounts shape, not produced yet), and that the key never shows when the
// credential is spread, serialised, cloned or printed. Every key and token here is synthetic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspect } from 'node:util';
import { readFileSync } from 'node:fs';
import { claude, canAskClaude, github, keyCredential } from '../../src/data/credentials.js';
import { ask, stream, endpoint, ClaudeError } from '../../src/services/claude.js';
import { config } from '../../src/core/config.js';

const KEY = 'test-key-not-real-credentials-0001';
const TOKEN = 'github_pat_synthetic_not_real_0002';
const store = (/** @type {any} */ kv = {}) => ({ get: (/** @type {string} */ n, /** @type {any} */ d) => kv[n] ?? d });
const REPO = { settings: { connections: { results: 'someone/results' } } };

/** A fetch that records each request and answers one text reply. */
function recorder(text = 'ok') {
  /** @type {{url: string, init: any}[]} */ const calls = [];
  const f = /** @type {any} */ (async (/** @type {string} */ url, /** @type {any} */ init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text }], model: 'm', usage: { input_tokens: 1, output_tokens: 1 } }) };
  });
  return { f, calls };
}

test('a key on this device is a key credential; none, empty or not a string is null', () => {
  const c = claude(store({ secrets: { anthropicKey: KEY, githubToken: null } }));
  assert.equal(c?.mode, 'key');
  assert.equal(c?.mode === 'key' && c.key, KEY);
  assert.equal(canAskClaude(store({ secrets: { anthropicKey: KEY } })), true);
  for (const kv of [{}, { secrets: null }, { secrets: {} }, { secrets: { anthropicKey: null } }, { secrets: { anthropicKey: '' } }, { secrets: { anthropicKey: 42 } }]) {
    assert.equal(claude(store(kv)), null, JSON.stringify(kv));
    assert.equal(canAskClaude(store(kv)), false);
  }
  assert.equal(claude(undefined), null, 'no store: no credential');
});

test('the key never shows when the credential is spread, serialised, cloned or printed', () => {
  const c = keyCredential(KEY);
  assert.ok(Object.isFrozen(c));
  assert.deepEqual(Object.keys(c), ['mode']);
  assert.equal(JSON.stringify(c), '{"mode":"key"}');
  assert.equal(JSON.stringify({ c }), '{"c":{"mode":"key"}}');
  assert.ok(!JSON.stringify({ ...c }).includes(KEY));
  assert.ok(!JSON.stringify(structuredClone(c)).includes(KEY));
  assert.ok(!inspect(c).includes(KEY), 'console.log of the object');
  assert.ok(!String(c).includes(KEY));
  assert.ok(!`${JSON.stringify([c])}`.includes(KEY));
  assert.throws(() => { /** @type {any} */ (c).key = 'other'; }, TypeError, 'frozen: a caller cannot swap the key');
});

test('credentials.js never logs and never writes the secrets', () => {
  const src = readFileSync(new URL('../../src/data/credentials.js', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/console\.|\blog\(|logError|toast/.test(src), 'no logging');
  assert.ok(!/\.set\(/.test(src), 'read only');
});

test('github() is the connected repository token: none without a repository', () => {
  assert.equal(github(store({ ...REPO, secrets: { githubToken: TOKEN } })), TOKEN);
  assert.equal(github(store({ secrets: { githubToken: TOKEN } })), null, 'a token without a repository is never used');
  assert.equal(github(store(REPO)), null);
});

test('services/claude.js: a key credential sends the same request a key did', async () => {
  const a = recorder(), b = recorder();
  await ask({ cred: keyCredential(KEY), system: 's', user: 'u', fetch: a.f });
  await ask({ key: KEY, system: 's', user: 'u', fetch: b.f });
  assert.equal(a.calls[0].url, config.anthropic.api);
  assert.deepEqual(a.calls[0].init.headers, b.calls[0].init.headers);
  assert.equal(a.calls[0].init.body, b.calls[0].init.body);
  assert.equal(a.calls[0].init.headers['x-api-key'], KEY);
  assert.equal(a.calls[0].init.headers['anthropic-dangerous-direct-browser-access'], 'true');
});

test('services/claude.js: no credential is ClaudeError nokey, and nothing is sent', async () => {
  const r = recorder();
  for (const cred of [null, undefined]) {
    await assert.rejects(ask({ cred, user: 'u', fetch: r.f }), e => e instanceof ClaudeError && e.code === 'nokey');
    await assert.rejects(stream({ cred, body: {}, fetch: r.f }), e => e instanceof ClaudeError && e.code === 'nokey');
  }
  assert.throws(() => endpoint({ cred: /** @type {any} */ ({ mode: 'proxy', url: '' }) }), ClaudeError, 'a proxy without url and fetch');
  assert.equal(r.calls.length, 0);
});

test('services/claude.js: a proxy credential posts to its url through its fetch, with no key header', async () => {
  const r = recorder('hallo');
  const cred = /** @type {const} */ ({ mode: 'proxy', url: 'https://proxy.example.test/claude', fetch: r.f });
  const res = await ask({ cred, system: 's', user: 'u' });
  assert.equal(res.text, 'hallo');
  assert.equal(r.calls[0].url, cred.url);
  const h = r.calls[0].init.headers;
  assert.equal(h['x-api-key'], undefined);
  assert.equal(h['anthropic-dangerous-direct-browser-access'], undefined);
  assert.equal(h['anthropic-version'], config.anthropic.version);
  assert.equal(JSON.parse(r.calls[0].init.body).messages[0].content, 'u');
});
