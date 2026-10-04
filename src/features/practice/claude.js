/* Practice: "My answer is right". Claude checks one answer the matcher refused (never one a trap detector flagged).
   Uses the learner's own key from the store (secrets.anthropicKey), sent only to api.anthropic.com. The prompt says
   nothing about the learner. Ported from Igloo's b1.js claudeCheck(). */
import { config } from '../../core/config.js';

/** The anthropic-version header. Exam's branch moves this into config.anthropic.version; read it from there when present. */
const API_VERSION = /** @type {any} */ (config.anthropic).version || '2023-06-01';   // date-gate: api-version (the anthropic-version header)

/** The prompt for one answer. Pure; tested in node. @param {any} it @param {string} answer */
export function checkPrompt(it, answer) {
  const task = it.kind === 'topic' || it.kind === 'reply'
    ? `Situation (Goethe B1 Sprechen ${it.teil}): ${it.partner ? `the partner says „${it.partner}“. ` : ''}${it.prompt}`
    : `Task: ${it.task ? it.task + ' ' : ''}${it.prompt}${it.hl ? ` (the graded part: "${it.hl}")` : ''}${it.prefill ? ` The answer starts with: ${it.prefill}` : ''}`;
  return `You check one answer in a German B1 exam trainer. ${task}\nExample answers: ${[it.model, ...(it.accept || []).slice(0, 4)].filter(Boolean).join(' | ')}\nThe learner wrote: ${answer}\n`
    + 'Is the learner\'s answer correct, natural B1 German that does the same job? The listed answers are examples, not the only correct ones. Judge grammar strictly (word order, verb position, articles, endings, capitals).\n'
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

/** @param {string} key @param {any} item @param {string} answer @param {typeof fetch} [f] */
export async function claudeCheck(key, item, answer, f = (...a) => fetch(...a)) {
  const r = await f(config.anthropic.api, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': API_VERSION, 'anthropic-dangerous-direct-browser-access': 'true' },
    body: JSON.stringify({ model: config.anthropic.models.check, max_tokens: 200, messages: [{ role: 'user', content: checkPrompt(item, answer) }] }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  return parseVerdict((j.content || []).map((/** @type {any} */ c) => c.text || '').join(''));
}
