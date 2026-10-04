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
  /** @param {string} code a short code the UI turns into a sentence @param {string} [detail] */
  constructor(code, detail = '') { super(detail || code); this.code = code; }
}

/** HTTP status and message → a ClaudeError code. @param {number} status @param {string} msg */
export function errorCode(status, msg) {
  if (status === 401) return 'key';
  if (status === 403) return 'forbidden';
  if (status === 400 && /credit|balance|billing/i.test(msg)) return 'credit';
  if (status === 429) return 'rate';
  if (status === 529 || (status >= 500 && status < 600)) return 'overloaded';
  return 'other';
}

/**
 * One Messages API call; returns the text. Refusals and cut-off answers are errors.
 * `effort` and `fallback` apply to the Opus line (the grader). Claude Haiku 4.5 (the answer check) rejects effort and
 * has no server-side fallback, so that caller passes `effort: null, fallback: false`. An empty `system` is left out.
 * @param {{ key: string, system?: string, user: string, model?: string, maxTokens?: number, effort?: string | null, fallback?: boolean, fetch?: typeof fetch }} o
 * @returns {Promise<{ text: string, model: string, usage: any }>}
 */
export async function ask({ key, system = '', user, model = config.anthropic.models.grade, maxTokens = 16000, effort = 'medium', fallback = true, fetch: f = (...a) => fetch(...a) }) {
  if (!key) throw new ClaudeError('nokey');
  /** @type {Record<string, string>} */
  const headers = {
    'content-type': 'application/json',
    'x-api-key': key,
    'anthropic-version': config.anthropic.version,
    'anthropic-dangerous-direct-browser-access': 'true',
  };
  if (fallback) headers['anthropic-beta'] = config.anthropic.fallbackBeta;
  /** @type {Record<string, any>} */
  const body = { model, max_tokens: maxTokens, messages: [{ role: 'user', content: user }] };
  if (system) body.system = [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }];
  if (effort) body.output_config = { effort };
  if (fallback) body.fallbacks = 'default';
  let r;
  try {
    r = await f(config.anthropic.api, { method: 'POST', headers, body: JSON.stringify(body) });
  } catch (e) { throw new ClaudeError('offline'); }
  /** @type {any} */ let j = null;
  try { j = await r.json(); } catch { /* not json */ }
  if (!r.ok) throw new ClaudeError(errorCode(r.status, j?.error?.message || ''), j?.error?.message || r.statusText);
  if (j?.stop_reason === 'refusal') throw new ClaudeError('refusal');
  if (j?.stop_reason === 'max_tokens') throw new ClaudeError('cut');
  const text = (j?.content || []).filter((/** @type {any} */ b) => b.type === 'text').map((/** @type {any} */ b) => b.text).join('').trim();
  if (!text) throw new ClaudeError('empty');
  return { text, model: j.model || model, usage: j.usage || null };
}

/**
 * Correct one Schreiben attempt. The body always starts with a "! " score line, as the review expects.
 * @param {{ key: string, ex: any, texts: Record<string, string>, learnerNotes?: string | null, fetch?: typeof fetch }} o
 */
export async function correctSchreiben({ key, ex, texts, learnerNotes, fetch: f }) {
  const res = await ask({ key, system: graderSystem(learnerNotes), user: graderMessage(ex, texts), fetch: f });
  const body = /^! /.test(res.text) ? res.text : `! Korrektur\n${res.text}`;
  return { body, model: res.model };
}

/* Practice: "My answer is right". Claude checks one answer the matcher refused (never one a trap detector flagged).
   The prompt says nothing about the learner. Ported from Igloo's b1.js claudeCheck(). */

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

/**
 * Check one typed answer with the small model. Errors are ClaudeErrors (code: key, offline, rate, …).
 * @param {{ key: string, item: any, answer: string, fetch?: typeof fetch }} o
 */
export async function checkAnswer({ key, item, answer, fetch: f }) {
  const res = await ask({ key, user: checkPrompt(item, answer), model: config.anthropic.models.check, maxTokens: 200, effort: null, fallback: false, fetch: f });
  return parseVerdict(res.text);
}
