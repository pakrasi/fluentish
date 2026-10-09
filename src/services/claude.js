/* The one Anthropic caller (ARCHITECTURE §2, review A9/N6). Browser-direct with the learner's own key, which stays on
   this device (secrets). This origin loads no third-party JavaScript (review B6), so the SDK is not used; the
   request is the plain Messages API.

   The Schreiben grader prompt is a PUBLIC TEMPLATE. It describes the exam and the output format only and says
   nothing about any particular learner. Notes about the learner (first language, what to watch for) are private:
   they come at run time from a private setting or the private results repository's data/learner.json and fill the
   {learner_profile} slot. Nothing personal is written in this file. */
import { config } from '../core/config.js';

/** The grader instructions. German, because the feedback is German exam feedback. */
export const GRADER_TEMPLATE = [
  'Du bist ein erfahrener Prüfer und Tutor für das Goethe-Zertifikat B1 (Modul Schreiben). Der Lerner bereitet sich auf die B1-Prüfung vor.',
  '{learner_profile}',
  'Korrigiere die drei Texte nach den Goethe-Kriterien und schreibe die Rückmeldung in diesem Markdown-Format (die App zeigt genau diese Zeichen an):',
  '- Erste Zeile: `! circa NN / 100 · bestanden` oder `! circa NN / 100 · knapp unter 60` bzw. `· nicht bestanden` (bestanden ab 60).',
  '- Danach 1–2 Sätze Gesamteindruck. Wenn viel zu wenig Zeit gebraucht oder zu wenige Wörter geschrieben wurden, sag es in einer Zeile mit `→ `.',
  '- Pro Aufgabe: `## Aufgabe N · Kurztitel · circa X / 40` (Aufgabe 3: `/ 20`), darunter `_Erfüllung x · Kohärenz x · Wortschatz x · Strukturen x_` (Aufgabe 1 und 2 je 0–10; Aufgabe 3: Erfüllung 0–4, Kohärenz 0–4, Wortschatz 0–6, Strukturen 0–6), dann 1–2 Sätze: Sind alle Leitpunkte erfüllt? Passt das Register (Anrede, Gruß, du/Sie)?',
  '- Dann jede Korrektur als eigene Zeile `~~Original~~ → ==Korrektur==` und direkt darunter eine Zeile `_kurze Erklärung_`. Nur echte Fehler, die wichtigsten zuerst, höchstens 10 pro Aufgabe. Fasse kleine Fehler in einem Satz zusammen, statt sie zu wiederholen.',
  '- Wenn etwas gut gelungen ist: eine Zeile `→ Gut: …`.',
  '- Zum Schluss `## Drei Muster` mit genau drei Aufzählungspunkten `- **Stichwort:** …`: die drei wichtigsten wiederkehrenden Fehlertypen mit je einem richtigen Beispielsatz.',
  'Schreibe auf Deutsch in einfachen Sätzen (B1-Niveau); Grammatikbegriffe darfst du in Klammern auf Englisch erklären. Bewerte streng, aber fair, so wie ein echter Goethe-Prüfer. Keine Einleitung, kein Lob, keine Wiederholung des Aufgabentexts.',
].join('\n');

/**
 * The versions of the prompts in this file. A change to a prompt's text bumps its version (tests/unit/exam-claude.test.mjs
 * pins a hash of each), so every stored correction says which prompt wrote it (feedback@1 promptVersion).
 */
export const PROMPTS = /** @type {const} */ ({ schreibenExam: 'schreiben-exam@1', schreibenTask: 'schreiben-task@1' });

/**
 * The system prompt with the private learner notes in their slot (or nothing there).
 * @param {string | null | undefined} learnerNotes
 */
export function graderSystem(learnerNotes) {
  const notes = String(learnerNotes || '').trim().slice(0, 2000);
  return GRADER_TEMPLATE.replace('{learner_profile}', notes ? `Hinweise zum Lerner:\n${notes}` : '').replace(/\n{2,}/g, '\n');
}

/**
 * The user message: each task and the text written for it.
 * @param {any} ex the test (goethe-b1-exam@1) @param {Record<string, string>} texts aufgabe1..3 → text
 */
export function graderMessage(ex, texts) {
  const S = ex.schreiben;
  const t = (/** @type {string} */ k) => String(texts[k] || '').trim() || '(nicht geschrieben)';
  return [
    `<aufgabe nr="1" woerter="${S.aufgabe1.words}">${S.aufgabe1.situation}\nLeitpunkte:\n${S.aufgabe1.points.map((/** @type {string} */ p) => `- ${p}`).join('\n')}</aufgabe>`, `<text nr="1">${t('aufgabe1')}</text>`,
    `<aufgabe nr="2" woerter="${S.aufgabe2.words}">${S.aufgabe2.situation}\nZitat: ${S.aufgabe2.quote}</aufgabe>`, `<text nr="2">${t('aufgabe2')}</text>`,
    `<aufgabe nr="3" woerter="${S.aufgabe3.words}">${S.aufgabe3.situation}\nEmpfänger: ${S.aufgabe3.addressee}</aufgabe>`, `<text nr="3">${t('aufgabe3')}</text>`,
  ].join('\n');
}

export class ClaudeError extends Error {
  /**
   * @param {string} code a short code the UI turns into a sentence @param {string} [detail]
   * @param {Usage | null} [usage] what the request was billed when it failed after the API took it (a reply cut off,
   *   refused or empty, a stream that broke or was stopped): the API's own numbers, or a conservative estimate
   *   (billedEstimate) where they never arrived. null: nothing was billed (an HTTP error, a request never sent).
   */
  constructor(code, detail = '', usage = null) { super(detail || code); this.code = code; this.usage = usage; }
}

/* ---------- what a failed request cost ----------
   Every request the API took is billed, whether or not a reply arrives. A failed call carries its usage on the
   ClaudeError so the caller can count it (conversation practice: data.js charge). Where the API's numbers never
   arrived, the estimate errs high: input at 3 characters a token of the whole request body (cache reads counted as
   full input), output at 3 characters a token of what arrived plus LOST_OUT_MARGIN (the server goes on writing until
   it sees the connection close), and a request whose response never came at all, after LOST_MS, at its max_tokens. */

/** A request out this long before it failed was taken by the API (counted); a quicker failure was never sent. */
export const LOST_MS = 1500;
/** Output tokens added to an estimate from the text that arrived. */
export const LOST_OUT_MARGIN = 50;
/** Tokens of a text, estimated high (German averages about 4 characters a token). @param {number} chars */
export const tokensOf = chars => Math.ceil(Math.max(0, chars) / 3);

/** The API's usage object as a Usage. @param {any} u @returns {Usage} */
export const apiUsage = u => ({ in: u?.input_tokens || 0, cacheRead: u?.cache_read_input_tokens || 0, cacheWrite: u?.cache_creation_input_tokens || 0, out: u?.output_tokens || 0 });

/**
 * The usage of a request whose response never arrived: its whole body as input, max_tokens as output.
 * @param {Record<string, any>} body @returns {Usage}
 */
export const billedEstimate = body => ({ in: tokensOf(JSON.stringify(body || {}).length), cacheRead: 0, cacheWrite: 0, out: Number(body?.max_tokens) || 0 });

/** HTTP status and message → a ClaudeError code. @param {number} status @param {string} msg */
export function errorCode(status, msg) {
  if (status === 401) return 'key';
  if (status === 403) return 'forbidden';
  if (status === 400 && /credit|balance|billing/i.test(msg)) return 'credit';
  if (status === 429) return 'rate';
  if (status === 529 || (status >= 500 && status < 600)) return 'overloaded';
  return 'other';
}

/* ---------- the credential (data/credentials.js) ----------
   Every call takes `cred`, what data/credentials.js claude(store) returned. A key credential posts to the Messages API
   from the browser with the key in x-api-key; a proxy credential (accounts, later) posts the same body to its own url
   through its own fetch, which adds the session, so no key or token is ever handled here. `key` is the older form of
   a key credential, kept for the callers' unit tests only. */

/** @typedef {import('../data/credentials.js').ClaudeCredential} ClaudeCredential */
/** @typedef {{cred?: ClaudeCredential | null, key?: string | null, fetch?: typeof fetch}} Auth */

/**
 * Where a request goes and how: the url, the auth headers and the transport. Throws ClaudeError 'nokey' without one.
 * @param {Auth} o @returns {{url: string, headers: Record<string, string>, send: typeof fetch}}
 */
export function endpoint({ cred = null, key = null, fetch: f }) {
  const c = cred || (key ? { mode: /** @type {const} */ ('key'), key } : null);
  if (c?.mode === 'proxy' && c.url && typeof c.fetch === 'function') return { url: c.url, headers: {}, send: f || c.fetch };
  if (c?.mode === 'key' && c.key) {
    return {
      url: config.anthropic.api,
      headers: { 'x-api-key': c.key, 'anthropic-dangerous-direct-browser-access': 'true' },
      send: f || ((...a) => fetch(...a)),
    };
  }
  throw new ClaudeError('nokey');
}

/**
 * A structured-output format (output_config.format): the reply is JSON that matches the schema. Every object in the
 * schema needs additionalProperties: false. The text ask() returns is that JSON; the caller parses and validates it.
 * @typedef {{type: 'json_schema', schema: Record<string, any>}} OutputFormat
 */

/**
 * One Messages API call; returns the text. Refusals and cut-off answers are errors.
 * `effort` and `fallback` apply to the Opus line (the grader). Claude Haiku 4.5 (the answer check) rejects effort and
 * has no server-side fallback, so that caller passes `effort: null, fallback: false`. An empty `system` is left out.
 * `format` (round 4, C0) asks for structured output: it is passed through as output_config.format, beside effort;
 * without it the request is exactly what it was before.
 * @param {Auth & { system?: string, user: string, model?: string, maxTokens?: number, effort?: string | null, fallback?: boolean, format?: OutputFormat | null, fetch?: typeof fetch }} o
 * @returns {Promise<{ text: string, model: string, usage: any }>}
 */
export async function ask({ cred, key, system = '', user, model = config.anthropic.models.grade, maxTokens = 16000, effort = 'medium', fallback = true, format = null, fetch: f }) {
  const to = endpoint({ cred, key, fetch: f });
  /** @type {Record<string, string>} */
  const headers = {
    'content-type': 'application/json',
    ...to.headers,
    'anthropic-version': config.anthropic.version,
  };
  if (fallback) headers['anthropic-beta'] = config.anthropic.fallbackBeta;
  /** @type {Record<string, any>} */
  const body = { model, max_tokens: maxTokens, messages: [{ role: 'user', content: user }] };
  if (system) body.system = [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }];
  if (effort) body.output_config = { effort };
  if (format) body.output_config = { ...(body.output_config || {}), format };
  if (fallback) body.fallbacks = 'default';
  let r;
  const t0 = Date.now();
  try {
    r = await to.send(to.url, { method: 'POST', headers, body: JSON.stringify(body) });
  } catch (e) { throw new ClaudeError('offline', '', Date.now() - t0 >= LOST_MS ? billedEstimate(body) : null); }
  /** @type {any} */ let j = null;
  try { j = await r.json(); } catch { /* not json */ }
  if (!r.ok) throw new ClaudeError(errorCode(r.status, j?.error?.message || ''), j?.error?.message || r.statusText);
  // from here the request was billed: a failure carries what it cost
  const usage = j?.usage ? apiUsage(j.usage) : billedEstimate(body);
  if (j?.stop_reason === 'refusal') throw new ClaudeError('refusal', '', usage);
  if (j?.stop_reason === 'max_tokens') throw new ClaudeError('cut', '', usage);
  const text = (j?.content || []).filter((/** @type {any} */ b) => b.type === 'text').map((/** @type {any} */ b) => b.text).join('').trim();
  if (!text) throw new ClaudeError('empty', '', usage);
  return { text, model: j.model || model, usage: j.usage || null };
}

/* ---------- streaming (round 4, conversation practice) ----------
   stream() posts a Messages API body with stream: true and reads the server-sent events as they arrive, so a reply
   shows word by word. The SSE parser and the message builder are pure (tested in node with chunks split anywhere):
     sseParser()      push(text chunk) → complete events; end() → the last one if the stream ended without a blank line
     accumulate()     event by event, the message as the API would have returned it: every content block in order
                      (thinking blocks with their signature, unchanged, so the history can be sent back as it came),
                      the stop reason and the usage (input, cache reads and writes, output). */

/** @typedef {{in: number, cacheRead: number, cacheWrite: number, out: number}} Usage */
/** @typedef {{type: string, data: any}} SSEvent */

/** An SSE reader: lines may be split anywhere between chunks. Events whose data is not JSON are skipped. */
export function sseParser() {
  let buf = '';
  /** @type {string | null} */ let ev = null;
  /** @type {string[]} */ let data = [];
  /** @param {SSEvent[]} out */
  const flush = out => {
    if (data.length) {
      const raw = data.join('\n');
      try { const d = JSON.parse(raw); out.push({ type: ev || d?.type || 'message', data: d }); } catch { /* not JSON: skip */ }
    }
    ev = null; data = [];
  };
  /** @param {string} line @param {SSEvent[]} out */
  const line = (line, out) => {
    if (line === '') { flush(out); return; }
    if (line.startsWith(':')) return;
    const i = line.indexOf(':');
    const field = i < 0 ? line : line.slice(0, i);
    let value = i < 0 ? '' : line.slice(i + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') ev = value;
    else if (field === 'data') data.push(value);
  };
  return {
    /** @param {string} chunk @returns {SSEvent[]} */
    push(chunk) {
      /** @type {SSEvent[]} */ const out = [];
      buf += chunk;
      let k;
      while ((k = buf.search(/\r\n|\r|\n/)) >= 0) {
        const nl = buf[k] === '\r' && buf[k + 1] === '\n' ? 2 : 1;
        if (buf[k] === '\r' && k + 1 === buf.length) break;   // a \r at the end may be the first half of \r\n
        line(buf.slice(0, k), out);
        buf = buf.slice(k + nl);
      }
      return out;
    },
    /** @returns {SSEvent[]} */
    end() {
      /** @type {SSEvent[]} */ const out = [];
      if (buf) { line(buf, out); buf = ''; }
      flush(out);
      return out;
    },
  };
}

/**
 * The message being streamed, built event by event.
 * @returns {{apply: (e: SSEvent) => void, content: any[], text: () => string, stop: () => string | null, stopDetails: () => any,
 *   usage: () => Usage, seen: () => {start: boolean, delta: boolean}, model: () => string | null, error: () => {type: string, message: string} | null, done: () => boolean}}
 */
export function accumulate() {
  /** @type {any[]} */ const content = [];
  /** @type {string | null} */ let stop = null;
  /** @type {any} */ let stopDetails = null;
  /** @type {string | null} */ let model = null;
  /** @type {{type: string, message: string} | null} */ let error = null;
  let done = false;
  /** @type {Usage} */ const usage = { in: 0, cacheRead: 0, cacheWrite: 0, out: 0 };
  const seen = { start: false, delta: false };
  /** @param {any} u */
  const take = u => {
    if (!u) return;
    if (Number.isFinite(u.input_tokens)) usage.in = u.input_tokens;
    if (Number.isFinite(u.cache_read_input_tokens)) usage.cacheRead = u.cache_read_input_tokens;
    if (Number.isFinite(u.cache_creation_input_tokens)) usage.cacheWrite = u.cache_creation_input_tokens;
    if (Number.isFinite(u.output_tokens)) usage.out = u.output_tokens;
  };
  return {
    content,
    apply({ type, data }) {
      const d = data || {};
      if (type === 'message_start') { model = d.message?.model || null; take(d.message?.usage); seen.start = !!d.message?.usage; }
      else if (type === 'content_block_start' && Number.isInteger(d.index)) content[d.index] = structuredClone(d.content_block || {});
      else if (type === 'content_block_delta' && Number.isInteger(d.index)) {
        const b = content[d.index] || (content[d.index] = { type: 'text', text: '' });
        const x = d.delta || {};
        if (x.type === 'text_delta') b.text = (b.text || '') + (x.text || '');
        else if (x.type === 'thinking_delta') b.thinking = (b.thinking || '') + (x.thinking || '');
        else if (x.type === 'signature_delta') b.signature = (b.signature || '') + (x.signature || '');
        else if (x.type === 'citations_delta') (b.citations ||= []).push(x.citation);
        else if (x.type === 'input_json_delta') b.partial_json = (b.partial_json || '') + (x.partial_json || '');
      } else if (type === 'message_delta') {
        if (d.delta && 'stop_reason' in d.delta) stop = d.delta.stop_reason;
        if (d.delta && d.delta.stop_details) stopDetails = d.delta.stop_details;
        take(d.usage);
        if (d.usage && Number.isFinite(d.usage.output_tokens)) seen.delta = true;
      } else if (type === 'message_stop') done = true;
      else if (type === 'error') error = { type: d.error?.type || 'error', message: d.error?.message || '' };
    },
    text: () => content.filter(b => b && b.type === 'text').map(b => b.text || '').join(''),
    stop: () => stop,
    stopDetails: () => stopDetails,
    usage: () => ({ ...usage }),
    seen: () => ({ ...seen }),
    model: () => model,
    error: () => error,
    done: () => done,
  };
}

/** An SSE error event's type → a ClaudeError code. @param {string} type */
const streamErrorCode = type => (type === 'overloaded_error' || type === 'api_error' ? 'overloaded' : type === 'rate_limit_error' ? 'rate'
  : type === 'authentication_error' ? 'key' : type === 'permission_error' ? 'forbidden' : 'other');

/**
 * Stream one Messages API request. `body` is the whole request (domain/conversation.js builds it); stream: true is set
 * here. onText gets the reply's text so far after each piece. Throws a ClaudeError: the HTTP codes of ask(), 'aborted'
 * when the signal fired, 'stream' when the connection ended before the message did, and the SSE error event's code.
 * A refusal or a cut-off reply is returned (stop), not thrown: the caller decides what the conversation does.
 * @param {Auth & {body: Record<string, any>, beta?: string | null, signal?: AbortSignal, onText?: (text: string) => void, fetch?: typeof fetch}} o
 * @returns {Promise<{content: any[], text: string, stop: string | null, stopDetails: any, usage: Usage, model: string}>}
 */
export async function stream({ cred, key, body, beta = null, signal, onText, fetch: f }) {
  const to = endpoint({ cred, key, fetch: f });
  /** @type {Record<string, string>} */
  const headers = {
    'content-type': 'application/json',
    accept: 'text/event-stream',
    ...to.headers,
    'anthropic-version': config.anthropic.version,
  };
  if (beta) headers['anthropic-beta'] = beta;
  let r;
  const t0 = Date.now();
  try {
    r = await to.send(to.url, { method: 'POST', headers, body: JSON.stringify({ ...body, stream: true }), signal });
  } catch (e) {
    throw new ClaudeError(signal?.aborted ? 'aborted' : 'offline', '', Date.now() - t0 >= LOST_MS ? billedEstimate(body) : null);
  }
  if (!r.ok) {
    /** @type {any} */ let j = null;
    try { j = await r.json(); } catch { /* not json */ }
    throw new ClaudeError(errorCode(r.status, j?.error?.message || ''), j?.error?.message || r.statusText);
  }
  const parse = sseParser();
  const msg = accumulate();
  const dec = new TextDecoder();
  let last = '';
  /**
   * What the request has been billed so far: the API's numbers (message_start's input, message_delta's output), with
   * what never arrived estimated high (see LOST_MS above). Billed from the moment the response began.
   * @returns {Usage}
   */
  const billed = () => {
    const u = msg.usage(), seen = msg.seen();
    if (!seen.start) { const est = billedEstimate(body); u.in = Math.max(u.in, est.in); }
    if (!seen.delta) {
      const chars = msg.content.reduce((n, b) => n + String((b && (b.text || b.thinking || b.partial_json)) || '').length, 0);
      u.out = Math.max(u.out, tokensOf(chars) + LOST_OUT_MARGIN);
    }
    return u;
  };
  /** @param {SSEvent[]} evs */
  const feed = evs => {
    for (const e of evs) msg.apply(e);
    const err = msg.error();
    if (err) throw new ClaudeError(streamErrorCode(err.type), err.message, billed());
    const now = msg.text();
    if (now !== last) { last = now; onText?.(now); }
  };
  const reader = r.body?.getReader();
  if (!reader) throw new ClaudeError('stream', '', billed());
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      feed(parse.push(dec.decode(value, { stream: true })));
    }
    feed(parse.push(dec.decode()));
    feed(parse.end());
  } catch (e) {
    if (e instanceof ClaudeError) throw e;
    throw new ClaudeError(signal?.aborted ? 'aborted' : 'stream', '', billed());
  } finally {
    try { reader.releaseLock(); } catch { /* released */ }
  }
  if (!msg.done()) throw new ClaudeError(signal?.aborted ? 'aborted' : 'stream', '', billed());
  return { content: msg.content.filter(Boolean), text: msg.text(), stop: msg.stop(), stopDetails: msg.stopDetails(), usage: msg.usage(), model: msg.model() || String(body.model || '') };
}

/**
 * Whether a reply has the shape of a correction: the score line ("! circa NN / 100 · …") and at least one task
 * section ("## Aufgabe N"). Anything else (JSON, a refusal in prose, half an answer) is not saved as a correction.
 * @param {string} text
 */
export function isCorrection(text) {
  const s = String(text || '').trim();
  return /^!\s*[^\n]*\d+\s*\/\s*100/.test(s) && /^##\s*Aufgabe\s*\d/m.test(s);
}

/**
 * Correct one Schreiben attempt. Throws ClaudeError('format') when the reply is not a correction, so the attempt
 * stays "not corrected" and the learner can try again.
 * @param {Auth & { ex: any, texts: Record<string, string>, learnerNotes?: string | null, fetch?: typeof fetch }} o
 */
export async function correctSchreiben({ cred, key, ex, texts, learnerNotes, fetch: f }) {
  const res = await ask({ cred, key, system: graderSystem(learnerNotes), user: graderMessage(ex, texts), fetch: f });
  const body = res.text.replace(/^```[a-z]*\n?|\n?```$/g, '').trim();
  if (!isCorrection(body)) throw new ClaudeError('format');   // never the reply itself: it can quote his writing, and errors reach the log
  return { body, model: res.model, promptVersion: PROMPTS.schreibenExam };
}

/* Practice: one Schreiben text written in Practice (Build an email, then "Write it yourself"). The same public,
   generic grader as the mock exam, for one task; it has no learner slot at all, so nothing personal is ever sent. */

/** The grader instructions for one task. German, like the exam feedback. */
export const TASK_GRADER = [
  'Du bist ein erfahrener Prüfer und Tutor für das Goethe-Zertifikat B1 (Modul Schreiben).',
  'Korrigiere einen Übungstext zu einer Aufgabe nach den Goethe-Kriterien und schreibe die Rückmeldung in diesem Markdown-Format (die App zeigt genau diese Zeichen an):',
  '- Erste Zeile: `! circa X / 40` bei Aufgabe 1 und 2, `! circa X / 20` bei Aufgabe 3.',
  '- Zweite Zeile: `_Erfüllung x · Kohärenz x · Wortschatz x · Strukturen x_` (Aufgabe 1 und 2 je 0–10; Aufgabe 3: Erfüllung 0–4, Kohärenz 0–4, Wortschatz 0–6, Strukturen 0–6).',
  '- Dann 1–2 Sätze: Sind alle Leitpunkte erfüllt? Passt das Register (Anrede, Gruß, du/Sie)? Passt die Länge?',
  '- Dann jede Korrektur als eigene Zeile `~~Original~~ → ==Korrektur==` und direkt darunter eine Zeile `_kurze Erklärung_`. Nur echte Fehler, die wichtigsten zuerst, höchstens 10.',
  '- Wenn etwas gut gelungen ist: eine Zeile `→ Gut: …`.',
  'Schreibe auf Deutsch in einfachen Sätzen (B1-Niveau); Grammatikbegriffe darfst du in Klammern auf Englisch erklären. Bewerte streng, aber fair, so wie ein echter Goethe-Prüfer. Keine Einleitung, keine Wiederholung des Aufgabentexts.',
].join('\n');

/**
 * The user message for one practice task (b1-schreiben@1 tasks[]) and the text written for it.
 * @param {{aufgabe: string, situation: string, quote?: string, points: string[]}} task @param {string} text @param {number} words the word target
 */
export function taskMessage(task, text, words) {
  const nr = String(task.aufgabe).replace(/^A/, '');
  return [
    `<aufgabe nr="${nr}" woerter="${words}">${task.situation}${task.quote ? `\nZitat: ${task.quote}` : ''}\nLeitpunkte:\n${task.points.map(p => `- ${p}`).join('\n')}</aufgabe>`,
    `<text>${String(text || '').trim() || '(nicht geschrieben)'}</text>`,
  ].join('\n');
}

/** Whether a reply has the shape of a one-task correction ("! circa NN / 40" or "/ 20"). @param {string} text */
export function isTaskCorrection(text) {
  return /^!\s*[^\n]*\d+\s*\/\s*(40|20)\b/.test(String(text || '').trim());
}

/**
 * Correct one practice text. Throws ClaudeError('format') when the reply is not a correction.
 * @param {Auth & { task: any, text: string, words: number, fetch?: typeof fetch }} o
 */
export async function correctTask({ cred, key, task, text, words, fetch: f }) {
  const res = await ask({ cred, key, system: TASK_GRADER, user: taskMessage(task, text, words), maxTokens: 6000, fetch: f });
  const body = res.text.replace(/^```[a-z]*\n?|\n?```$/g, '').trim();
  if (!isTaskCorrection(body)) throw new ClaudeError('format');
  return { body, model: res.model, promptVersion: PROMPTS.schreibenTask };
}

/* Practice: "My answer is right". Claude checks one answer the matcher refused (never one a trap detector flagged).
   The prompt says nothing about the learner. Ported from Igloo's b1.js claudeCheck(). */

/** The prompt for one answer. Pure; tested in node. @param {any} it @param {string} answer */
export function checkPrompt(it, answer) {
  const task = it.kind === 'topic' || it.kind === 'reply'
    ? `Situation (Goethe B1 Sprechen ${it.teil}): ${it.partner ? `the partner says „${it.partner}“. ` : ''}${it.prompt}`
    : `Task: ${it.task ? it.task + ' ' : ''}${it.prompt}${it.hl ? ` (the graded part: "${it.hl}")` : ''}${it.prefill ? ` The answer starts with: ${it.prefill}` : ''}`;
  return `You check one answer in a German B1 exam trainer. ${task}\nExample answers: ${[it.model, ...(it.accept || []).slice(0, 4)].filter(Boolean).join(' | ')}\nThe learner wrote: ${answer}\n`
    + 'Is the learner\'s whole answer correct, natural B1 German that does the same job? The listed answers are examples, not the only correct ones. '
    + 'Judge every word, including the words outside the graded part, and judge grammar strictly: word order, verb position, case, articles, gender, adjective and verb endings, plurals, capitals.\n'
    + '"minor" means only a spelling slip in an otherwise right answer: a typo inside a word, a missing umlaut or a lower-case noun. '
    + 'Any wrong ending, case, article, gender, verb form, plural or word order makes it "wrong", however small.\n'
    + 'Reply with JSON only: {"verdict":"correct"|"minor"|"wrong","note":"one short sentence in English"}';
}

/** Parse Claude's reply. Pure. @param {string} text @returns {{verdict: 'correct'|'minor'|'wrong', note: string}} */
export function parseVerdict(text) {
  const m = String(text || '').match(/\{[\s\S]*\}/);
  let j = { verdict: 'wrong', note: '' };
  try { if (m) j = JSON.parse(m[0]); } catch { /* not JSON */ }
  const v = ['correct', 'minor', 'wrong'].includes(j.verdict) ? j.verdict : 'wrong';
  return { verdict: /** @type {any} */ (v), note: typeof j.note === 'string' ? j.note : '' };
}

/**
 * Check one typed answer with the small model. Errors are ClaudeErrors (code: key, offline, rate, …).
 * @param {Auth & { item: any, answer: string, fetch?: typeof fetch }} o
 */
export async function checkAnswer({ cred, key, item, answer, fetch: f }) {
  const res = await ask({ cred, key, user: checkPrompt(item, answer), model: config.anthropic.models.check, maxTokens: 200, effort: null, fallback: false, fetch: f });
  return parseVerdict(res.text);
}
