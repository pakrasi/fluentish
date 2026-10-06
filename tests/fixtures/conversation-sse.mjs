// A canned Messages API event stream (server-sent events), as the API sends a streamed reply: message_start with the
// usage, an empty thinking block with its signature (display "omitted"), the text in small pieces, message_delta with
// the stop reason and the output usage, message_stop. Used by the unit tests (tests/unit/conversation-stream.test.mjs)
// and the e2e mock of api.anthropic.com (tests/e2e/conversation.spec.mjs). Synthetic.

/**
 * @param {string} text the reply
 * @param {{model?: string, usage?: {in?: number, cacheRead?: number, cacheWrite?: number, out?: number}, stop?: string, thinking?: boolean, piece?: number, crlf?: boolean, error?: string | null, cut?: boolean}} [o]
 *   piece: characters per text_delta; error: an SSE error event's type instead of the end; cut: the stream stops before message_stop
 * @returns {string}
 */
export function sse(text, { model = 'claude-sonnet-5-5', usage = {}, stop = 'end_turn', thinking = true, piece = 7, crlf = false, error = null, cut = false } = {}) {
  const u = { in: 40, cacheRead: 900, cacheWrite: 120, out: 60, ...usage };
  /** @type {[string, any][]} */ const ev = [];
  ev.push(['message_start', { type: 'message_start', message: { id: 'msg_e2e', type: 'message', role: 'assistant', model, content: [], stop_reason: null,
    usage: { input_tokens: u.in, cache_read_input_tokens: u.cacheRead, cache_creation_input_tokens: u.cacheWrite, output_tokens: 1 } } }]);
  let i = 0;
  if (thinking) {
    ev.push(['content_block_start', { type: 'content_block_start', index: i, content_block: { type: 'thinking', thinking: '', signature: '' } }]);
    ev.push(['content_block_delta', { type: 'content_block_delta', index: i, delta: { type: 'signature_delta', signature: 'c2lnLWUyZQ==' } }]);
    ev.push(['content_block_stop', { type: 'content_block_stop', index: i }]);
    i++;
  }
  ev.push(['ping', { type: 'ping' }]);
  ev.push(['content_block_start', { type: 'content_block_start', index: i, content_block: { type: 'text', text: '' } }]);
  for (let k = 0; k < text.length; k += piece) ev.push(['content_block_delta', { type: 'content_block_delta', index: i, delta: { type: 'text_delta', text: text.slice(k, k + piece) } }]);
  if (error) ev.push(['error', { type: 'error', error: { type: error, message: 'synthetic' } }]);
  else if (!cut) {
    ev.push(['content_block_stop', { type: 'content_block_stop', index: i }]);
    ev.push(['message_delta', { type: 'message_delta', delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: u.out } }]);
    ev.push(['message_stop', { type: 'message_stop' }]);
  }
  const nl = crlf ? '\r\n' : '\n';
  return ev.map(([name, data]) => `event: ${name}${nl}data: ${JSON.stringify(data)}${nl}${nl}`).join('');
}
