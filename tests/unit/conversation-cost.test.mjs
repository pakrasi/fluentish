// Conversation cost safety (round 4, audit P1-1/P1-2, coordinator ruling 2): every request the API took is counted,
// whatever happened to it. services/claude.js puts what a failed request was billed on its ClaudeError (the API's
// own numbers from message_start and message_delta, or a conservative estimate where they never arrived); the
// conversation counts it (data.js charge). The first case is the audit's repro (reviews4/audit/probe-stream.mjs):
// message_start with 9000 input tokens, then the connection breaks. Synthetic streams; no network, no real key.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stream, ask, ClaudeError, LOST_MS, LOST_OUT_MARGIN, tokensOf, billedEstimate } from '../../src/services/claude.js';
import { Store } from '../../src/data/store.js';
import { createMemoryAdapter } from '../../src/data/adapters/memory.js';
import * as C from '../../src/domain/conversation.js';
import * as D from '../../src/features/practice-conversation/data.js';
import { sse } from '../fixtures/conversation-sse.mjs';

const enc = new TextEncoder();
const BODY = { model: 'claude-sonnet-5-5', max_tokens: 1200, system: [{ type: 'text', text: 'x'.repeat(3000) }], messages: [{ role: 'user', content: 'Hallo' }] };

/** A fetch whose response streams these chunks, then breaks (error), ends, or waits for the abort. */
function fetchOf(chunks, { end = 'error' } = {}) {
  return async (_url, init) => ({
    ok: true,
    body: new ReadableStream({
      start(c) {
        for (const s of chunks) c.enqueue(enc.encode(s));
        // error() would drop what is still queued: the connection breaks once the chunks have been read
        if (end === 'error') setTimeout(() => c.error(new Error('net')), 20);
        else if (end === 'close') c.close();
        else init.signal.addEventListener('abort', () => c.error(new DOMException('aborted', 'AbortError')));
      },
    }),
  });
}

/** The events of a reply up to (not including) its end, as raw SSE chunks. @param {string} text */
const partial = (text, o = {}) => sse(text, { ...o, cut: true });

async function caught(p) {
  try { await p; } catch (e) { return e; }
  throw new Error('did not throw');
}

test('the audit\'s probe: message_start with 9000 input tokens, then the connection breaks: the error carries what was billed', async () => {
  const chunks = [
    'event: message_start\ndata: {"type":"message_start","message":{"model":"claude-sonnet-5-5","usage":{"input_tokens":9000,"output_tokens":1}}}\n\n',
    'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hallo, wie"}}\n\n',
  ];
  const e = await caught(stream({ key: 'k', body: { model: 'claude-sonnet-5-5' }, fetch: fetchOf(chunks) }));
  assert.ok(e instanceof ClaudeError);
  assert.equal(e.code, 'stream');
  assert.equal(e.usage.in, 9000, 'the input from message_start');
  assert.equal(e.usage.out, tokensOf('Hallo, wie'.length) + LOST_OUT_MARGIN, 'output estimated high from the text that arrived');
});

test('a stream cut after message_delta: the output is the API\'s own number', async () => {
  const whole = sse('Guten Tag!', { usage: { in: 50, cacheRead: 2000, cacheWrite: 0, out: 333 } });
  const noStop = whole.slice(0, whole.indexOf('event: message_stop'));
  const e = await caught(stream({ key: 'k', body: BODY, fetch: fetchOf([noStop], { end: 'close' }) }));
  assert.equal(e.code, 'stream');
  assert.deepEqual(e.usage, { in: 50, cacheRead: 2000, cacheWrite: 0, out: 333 });
});

test('Stop (the signal) mid-reply: \'aborted\', with what was billed', async () => {
  const ctl = new AbortController();
  const p = stream({ key: 'k', body: BODY, signal: ctl.signal, fetch: fetchOf([partial('Ein langer Satz, der nie endet', { usage: { in: 700, cacheRead: 4000 } })], { end: 'wait' }),
    onText: t => { if (t.length > 10) ctl.abort(); } });
  const e = await caught(p);
  assert.equal(e.code, 'aborted');
  assert.equal(e.usage.in, 700);
  assert.equal(e.usage.cacheRead, 4000);
  assert.ok(e.usage.out >= LOST_OUT_MARGIN);
});

test('an SSE error event mid-reply (overloaded): billed, carried', async () => {
  const e = await caught(stream({ key: 'k', body: BODY, fetch: fetchOf([sse('Hallo', { error: 'overloaded_error', usage: { in: 90 } })], { end: 'close' }) }));
  assert.equal(e.code, 'overloaded');
  assert.equal(e.usage.in, 90);
});

test('no response at all: a request out LOST_MS or more counts its body and max_tokens; a quick failure was never sent', async () => {
  const slow = async () => { await new Promise(r => setTimeout(r, LOST_MS + 50)); throw new TypeError('Failed to fetch'); };
  const e = await caught(stream({ key: 'k', body: BODY, fetch: slow }));
  assert.equal(e.code, 'offline');
  assert.deepEqual(e.usage, billedEstimate(BODY));
  assert.equal(e.usage.out, 1200);
  assert.ok(e.usage.in >= JSON.stringify(BODY).length / 3);
  const quick = async () => { throw new TypeError('Failed to fetch'); };
  assert.equal((await caught(stream({ key: 'k', body: BODY, fetch: quick }))).usage, null);
});

test('an HTTP error before the stream (429, 529) is not billed: no usage', async () => {
  for (const status of [429, 529]) {
    const f = async () => ({ ok: false, status, statusText: 'x', json: async () => ({ error: { message: 'busy' } }) });
    const e = await caught(stream({ key: 'k', body: BODY, fetch: f }));
    assert.equal(e.usage, null, String(status));
  }
});

test('a complete stream still returns its usage (unchanged)', async () => {
  const res = await stream({ key: 'k', body: BODY, fetch: fetchOf([sse('Hallo!', { usage: { in: 5, cacheRead: 10, cacheWrite: 20, out: 30 } })], { end: 'close' }) });
  assert.deepEqual(res.usage, { in: 5, cacheRead: 10, cacheWrite: 20, out: 30 });
});

test('ask(): a reply cut at max_tokens, a refusal, an empty reply carry their usage; an unreadable reply an estimate', async () => {
  const usage = { input_tokens: 2400, output_tokens: 16000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  const reply = j => async () => ({ ok: true, status: 200, json: async () => j });
  for (const [stop, code, content] of [['max_tokens', 'cut', [{ type: 'text', text: '{"summ' }]], ['refusal', 'refusal', []], ['end_turn', 'empty', []]]) {
    const e = await caught(ask({ key: 'k', user: 'u', model: 'claude-opus-5-5', maxTokens: 16000, fetch: reply({ stop_reason: stop, content, usage }) }));
    assert.equal(e.code, code);
    assert.deepEqual(e.usage, { in: 2400, cacheRead: 0, cacheWrite: 0, out: 16000 }, code);
  }
  const broken = async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('cut'); } });
  const e = await caught(ask({ key: 'k', user: 'u', maxTokens: 16000, fetch: broken }));
  assert.equal(e.code, 'empty');
  assert.equal(e.usage.out, 16000, 'max_tokens: the reply was lost');
});

test('counted: a failed request\'s usage goes into the session and the month like a reply\'s (data.js charge)', async () => {
  const store = await Store.open({ adapter: createMemoryAdapter(), profile: { id: 'p', name: '', kind: 'local' }, device: { deviceId: 'd', seq: 0 }, clock: { today: () => '2026-10-20' } });
  D.putSession(store, /** @type {any} */ ({ id: 's1', v: 1, usage: C.noUsage(), costUsd: 0 }));
  const e = await caught(stream({ key: 'k', body: BODY, fetch: fetchOf([partial('Hallo zusammen', { usage: { in: 9000 } })]) }));
  const usd = D.charge(store, 's1', '2026-10-20', 'claude-sonnet-5-5', e.usage);
  assert.ok(usd > 0);
  assert.equal(D.monthSpent(store, '2026-10-20'), usd);
  assert.equal(D.getSession(store, 's1').usage.in, 9000);
});

test('feedback: one request at a time; past the monthly cap, the first only', () => {
  assert.equal(C.feedbackGate({ tries: 0, running: false, monthOver: false }), 'ok');
  assert.equal(C.feedbackGate({ tries: 3, running: false, monthOver: false }), 'ok', 'under the cap, Try again works');
  assert.equal(C.feedbackGate({ tries: 0, running: true, monthOver: false }), 'running', 'a reopened page waits for the request already out');
  assert.equal(C.feedbackGate({ tries: 0, running: false, monthOver: true }), 'ok', 'the conversation that reached the cap gets its review');
  assert.equal(C.feedbackGate({ tries: 1, running: false, monthOver: true }), 'month', 'Try again past the cap: no');
});
