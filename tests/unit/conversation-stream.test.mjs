// services/claude.js stream(): the SSE reader with the stream split anywhere, the message it builds (thinking blocks
// kept for the history), and its errors. Synthetic streams (tests/fixtures/conversation-sse.mjs); no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sseParser, accumulate, stream, ClaudeError } from '../../src/services/claude.js';
import { sse } from '../fixtures/conversation-sse.mjs';

const TEXT = 'Oh, am Samstag <r was="ich bin">bist du</r> ins Kino gegangen? Was hast du gesehen? Grüße – „schön“!';

/** Every event of a stream read in the given chunks. @param {string[]} chunks */
function read(chunks) {
  const p = sseParser();
  return [...chunks.flatMap(c => p.push(c)), ...p.end()];
}

test('SSE: the same events whether the stream comes whole, split at any one point, or in random pieces', () => {
  for (const crlf of [false, true]) {
    const whole = sse(TEXT, { crlf });
    const ref = read([whole]);
    assert.ok(ref.length > 10);
    assert.deepEqual(ref.filter(e => e.type === 'ping').length, 1);
    for (let k = 0; k <= whole.length; k++) assert.deepEqual(read([whole.slice(0, k), whole.slice(k)]), ref, `split at ${k}${crlf ? ' (CRLF)' : ''}`);
    let seed = 7;
    const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
    for (let run = 0; run < 200; run++) {
      const parts = [];
      for (let i = 0; i < whole.length;) { const n = 1 + Math.floor(rnd() * 40); parts.push(whole.slice(i, i + n)); i += n; }
      assert.deepEqual(read(parts), ref);
    }
  }
});

test('SSE: comments and non-JSON data are skipped; a stream without a final blank line still gives its last event', () => {
  const evs = read([': keep-alive\n\nevent: ping\ndata: {"type":"ping"}\n\ndata: not json\n\n', 'event: message_stop\ndata: {"type":"message_stop"}']);
  assert.deepEqual(evs.map(e => e.type), ['ping', 'message_stop']);
});

test('accumulate: the content blocks in order, the thinking block with its signature, usage and stop reason', () => {
  const msg = accumulate();
  for (const e of read([sse(TEXT, { usage: { in: 12, cacheRead: 3400, cacheWrite: 210, out: 77 } })])) msg.apply(e);
  assert.ok(msg.done());
  assert.deepEqual(msg.content[0], { type: 'thinking', thinking: '', signature: 'c2lnLWUyZQ==' });
  assert.deepEqual(msg.content[1], { type: 'text', text: TEXT });
  assert.equal(msg.text(), TEXT);
  assert.equal(msg.stop(), 'end_turn');
  assert.deepEqual(msg.usage(), { in: 12, cacheRead: 3400, cacheWrite: 210, out: 77 });
  assert.equal(msg.model(), 'claude-sonnet-5-5');
});

/** A fetch that answers with a stream of the given chunks (bytes split anywhere, even inside a character). */
function fakeFetch(/** @type {string} */ body, { status = 200, json = null, split = 13 } = {}) {
  /** @type {any[]} */ const calls = [];
  const f = async (/** @type {string} */ url, /** @type {any} */ init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    if (init.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    if (status !== 200) return new Response(JSON.stringify(json || { error: { message: 'x' } }), { status });
    const bytes = new TextEncoder().encode(body);
    let i = 0;
    const rs = new ReadableStream({ pull(c) { if (i >= bytes.length) { c.close(); return; } c.enqueue(bytes.slice(i, i + split)); i += split; } });
    return new Response(rs, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
  return { f, calls };
}

test('stream(): text arrives in pieces, the whole message comes back, the request is the body plus stream: true', async () => {
  const { f, calls } = fakeFetch(sse(TEXT), { split: 5 });
  /** @type {string[]} */ const seen = [];
  const body = { model: 'claude-sonnet-5-5', max_tokens: 1200, messages: [{ role: 'user', content: '<start/>' }] };
  const r = await stream({ key: 'sk-test', body, onText: t => seen.push(t), fetch: /** @type {any} */ (f) });
  assert.equal(r.text, TEXT, 'umlauts and quotes split across chunks decode whole');
  assert.ok(seen.length > 5 && seen[seen.length - 1] === TEXT && seen.every((s, i) => !i || s.startsWith(seen[i - 1])));
  assert.equal(r.content.length, 2);
  assert.equal(r.stop, 'end_turn');
  assert.equal(calls[0].body.stream, true);
  assert.equal(calls[0].init.headers['x-api-key'], 'sk-test');
  assert.equal(calls[0].init.headers['anthropic-dangerous-direct-browser-access'], 'true');
  assert.ok(!('anthropic-beta' in calls[0].init.headers));
});

test('stream(): errors', async () => {
  const err = async (/** @type {Promise<any>} */ p) => { try { await p; return null; } catch (e) { assert.ok(e instanceof ClaudeError); return /** @type {any} */ (e).code; } };
  assert.equal(await err(stream({ key: '', body: {} })), 'nokey');
  assert.equal(await err(stream({ key: 'k', body: {}, fetch: /** @type {any} */ (fakeFetch('', { status: 401 }).f) })), 'key');
  assert.equal(await err(stream({ key: 'k', body: {}, fetch: /** @type {any} */ (fakeFetch('', { status: 529 }).f) })), 'overloaded');
  assert.equal(await err(stream({ key: 'k', body: {}, fetch: /** @type {any} */ (fakeFetch('', { status: 400, json: { error: { message: 'Your credit balance is too low' } } }).f) })), 'credit');
  assert.equal(await err(stream({ key: 'k', body: {}, fetch: /** @type {any} */ (fakeFetch(sse('Hallo', { error: 'overloaded_error' })).f) })), 'overloaded', 'an error event mid-stream');
  assert.equal(await err(stream({ key: 'k', body: {}, fetch: /** @type {any} */ (fakeFetch(sse('Hallo', { cut: true })).f) })), 'stream', 'the connection ended before message_stop');
  assert.equal(await err(stream({ key: 'k', body: {}, fetch: async () => { throw new TypeError('Failed to fetch'); } })), 'offline');
  const ac = new AbortController(); ac.abort();
  assert.equal(await err(stream({ key: 'k', body: {}, signal: ac.signal, fetch: /** @type {any} */ (fakeFetch(sse('x')).f) })), 'aborted');
  // a refusal is returned, not thrown: the conversation goes on
  const r = await stream({ key: 'k', body: {}, fetch: /** @type {any} */ (fakeFetch(sse('', { stop: 'refusal' })).f) });
  assert.equal(r.stop, 'refusal');
});
