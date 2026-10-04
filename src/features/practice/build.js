/* Practice › Schreiben › Build an email: the pure part (tested in node). A task (content b1/schreiben.json tasks[])
   is a mock Schreiben task taken apart into parts: the greeting, one line per point built on a frame with a
   connector, the closing line and the sign-off. Each part is graded like a round item (grade.js gradeAnswer): a fixed
   part on its formula and the rest of its sentence, a free part on its frame (as a situation: the frame must be
   there and right, the words around it are checked for German forms and detectors). The lines he got right make his
   email; the models make the model email.

   Nothing here is scheduled: building is practice of the whole text. The phrases themselves are in the Schreiben
   rounds (FSRS). */
import { gradeAnswer } from './grade.js';
import { lowerStart } from '../../domain/punct.js';

/** Connectors coloured in an email (the grammar layer's glue role), longest first. */
export const CONNECTORS = ['zum beispiel', 'einerseits', 'andererseits', 'außerdem', 'deshalb', 'deswegen', 'trotzdem', 'allerdings', 'obwohl',
  'übrigens', 'zuerst', 'danach', 'darum', 'dass', 'weil', 'denn', 'wenn', 'zwar', 'aber', 'dann', 'ob', 'in zukunft'];

/** A part as a gradable item. @param {any} task @param {any} part */
export function partItem(task, part) {
  const free = part.kind === 'free';
  const cue = String(part.cue || '');
  return {
    id: `BX:${task.id}-${part.key}`, kind: free ? 'topic' : 'phrase', area: 'writing', group: `W${String(task.aufgabe).slice(1)}`,
    teil: `W${String(task.aufgabe).slice(1)}`, fn: null, star: true, trap: part.trap || null, focus: part.focus || ['chunk'], strict: part.strict || [],
    plan: free ? 'choice' : 'recall', task: null, prompt: cue, promptLang: 'en', hl: free ? null : cue.replace(/\s*\([^()]*\)\s*$/, '').replace(/[.?!]+$/, ''),
    partner: null, prefill: null, accept: part.accept, anywhere: true, model: part.model, wrong: part.wrong || [], rule: part.rule || '',
    punct: part.punct || [], gap: false, mine: false, src: 'build',
  };
}

/** The line a part puts into the email: the model, made small after the greeting when the part says so. @param {any} part */
export const modelLine = part => (part.lower ? lowerStart(part.model) : part.model);

/**
 * Check one part. ok: the frame (or formula) is right and no detector fired; slips (capitals, umlauts, punctuation,
 * a word form around the frame) show but do not stop the part.
 * @param {any} task @param {any} part @param {string} input @param {any} [data] pool data (nouns, traps, lexicon)
 */
export function checkPart(task, part, input, data = {}) {
  const it = partItem(task, part);
  const g = gradeAnswer(it, String(input || ''), null, data);
  return { g, ok: g.ok, partial: !!g.partial, punctMiss: g.punctMiss || [], glue: connectorsIn(input) };
}

/**
 * Connectors in a text, as ranges, for colouring. Word-bounded, case-insensitive; "zum Beispiel" before "zum".
 * @param {string} text @returns {{start: number, end: number, word: string}[]}
 */
export function connectorsIn(text) {
  const s = String(text || ''), low = s.toLowerCase();
  /** @type {{start: number, end: number, word: string}[]} */ const out = [];
  for (const c of CONNECTORS) {
    let i = 0;
    while ((i = low.indexOf(c, i)) >= 0) {
      const end = i + c.length;
      const before = i === 0 || !/[\p{L}\p{N}]/u.test(low[i - 1]), after = end >= low.length || !/[\p{L}\p{N}]/u.test(low[end]);
      if (before && after && !out.some(r => i < r.end && end > r.start)) out.push({ start: i, end, word: s.slice(i, end) });
      i = end;
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Word count as the exam counts it (words with letters or digits). @param {string} text */
export const wordCount = text => (String(text || '').match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;

/**
 * The email as lines: the greeting, a blank line, one body line per part, a blank line, the sign-off and the name.
 * A forum post (Aufgabe 2) is body lines only.
 * @param {any} task @param {Record<string, string>} lines part key → text
 * @param {{name?: string}} [o]
 * @returns {{key: string, text: string}[]}
 */
export function assemble(task, lines, { name = '' } = {}) {
  /** @type {{key: string, text: string}[]} */ const out = [];
  for (const p of task.parts) {
    const text = lines[p.key];
    if (text == null) continue;
    if (p.key === 'sign') out.push({ key: '', text: '' });
    out.push({ key: p.key, text });
    if (p.key === 'open') out.push({ key: '', text: '' });
  }
  if (name && lines.sign != null) out.push({ key: 'name', text: name });
  return out;
}

/** The model email. @param {any} task */
export const modelEmail = task => assemble(task, Object.fromEntries(task.parts.map((/** @type {any} */ p) => [p.key, modelLine(p)])));

/** Plain text of assembled lines. @param {{text: string}[]} lines */
export const asText = lines => lines.map(l => l.text).join('\n').replace(/\n{3,}/g, '\n\n').trim();

/**
 * A build's result for the list and the done screen: parts right first time.
 * @param {Record<string, {first: boolean, ok: boolean}>} results
 */
export function score(results) {
  const r = Object.values(results || {});
  return { right: r.filter(x => x.first && x.ok).length, total: r.length };
}
