/* The end-of-conversation feedback (round 4, lane L4): its JSON schema (sent as output_config.format and kept in
   schemas/records/conversation-feedback.schema.json for the stored record) and the validator that decides what of it
   is shown and what may become a review card. Pure; tested in node (tests/unit/conversation-feedback.test.mjs).

   A false correction turned into a card would be drilled for months, so a mistake is dropped (and logged in `dropped`)
   when: its turn is not one of his; its "wrong" is not copied from that turn (compared folded: case, quotes,
   punctuation and spaces); "right" equals "wrong"; or the change is a rewrite rather than a correction (more than
   max(3, 40 %) of the words edited). What is left is shown, at most 5. A mistake may become a card only when it is
   typed, is not "style", is not already among his mistakes (the wrong or the right sentence), and is the first of its
   pattern in this session. At most 3 cards, and only those are ticked by default. "used well" must be copied from a
   typed turn; "you could also say" must quote a turn of his (an ellipsis may stand for words left out). */
// @ts-check
import { fold } from './conversation.js';

/** Cards a session may add, and mistakes shown. */
export const MAX_CARDS = 3;
export const MAX_SHOWN = 5;
export const MAX_BETTER = 3;
export const MAX_USED = 3;

export const PATTERNS = /** @type {const} */ (['verb-second', 'verb-final', 'verb-form', 'auxiliary', 'tense', 'case', 'gender-article',
  'adjective-ending', 'preposition', 'word-choice', 'register', 'agreement', 'other']);
export const SEVERITIES = /** @type {const} */ (['meaning', 'grammar', 'style']);

/** The structured-output schema (every object closed, as the API requires). Counts are the validator's, not the schema's. */
export function feedbackSchema() {
  const str = { type: 'string' }, int = { type: 'integer' };
  /** @param {Record<string, any>} props */
  const obj = props => ({ type: 'object', additionalProperties: false, required: Object.keys(props), properties: props });
  return obj({
    summary: str,
    mistakes: { type: 'array', items: obj({ turn: int, wrong: str, right: str, rule: str, pattern: { type: 'string', enum: [...PATTERNS] }, severity: { type: 'string', enum: [...SEVERITIES] } }) },
    better_phrases: { type: 'array', items: obj({ turn: int, said: str, better: str, why: str }) },
    used_well: { type: 'array', items: obj({ turn: int, text: str, why: str }) },
  });
}

/** @typedef {import('./conversation.js').Turn} Turn */

/**
 * @typedef {object} Checked  a mistake as the feedback card shows it
 * @property {number} turn
 * @property {string} wrong
 * @property {string} right
 * @property {string} rule
 * @property {string} pattern
 * @property {string} severity
 * @property {'typed' | null} input
 * @property {boolean} cardable     may become a card
 * @property {boolean} checked      ticked by default
 * @property {null | 'style' | 'already' | 'pattern' | 'spoken' | 'cap'} why  why it may not become a card
 */

/** Words of a folded text. @param {string} s */
const toks = s => fold(s).split(' ').filter(Boolean);

/** Edit distance between two word lists. @param {string[]} a @param {string[]} b */
export function tokenEdits(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

/** Whether `right` is a correction of `wrong` (a small edit), not a rewrite. @param {string} wrong @param {string} right */
export function smallEdit(wrong, right) {
  const a = toks(wrong), b = toks(right);
  return tokenEdits(a, b) <= Math.max(3, Math.ceil(0.4 * Math.max(a.length, b.length)));
}

/** Whether `part` is in `text`, word for word (folded). @param {string} part @param {string} text */
export const verbatim = (part, text) => { const p = fold(part); return !!p && ` ${fold(text)} `.includes(` ${p} `); };

/** A quote of his that may leave words out with an ellipsis: every piece must be in the turn. @param {string} said @param {string} text */
const quoted = (said, text) => { const pieces = String(said || '').split(/…|\.\.\./).map(s => s.trim()).filter(s => fold(s)); return pieces.length > 0 && pieces.every(p => verbatim(p, text)); };

/**
 * @param {any} raw the model's JSON (already parsed)
 * @param {{turns: Turn[], live?: {wrong: string, right: string}[]}} ctx  live: his mistakes now (data/mistakes.js listMistakes)
 * @returns {{summary: string, mistakes: Checked[], better: {turn: number, said: string, better: string, why: string}[],
 *   usedWell: {turn: number, text: string, why: string}[], dropped: {field: string, index: number, reason: string}[]}}
 */
export function checkFeedback(raw, { turns, live = [] }) {
  /** @type {{field: string, index: number, reason: string}[]} */ const dropped = [];
  const his = new Map(turns.filter(t => t.who === 'learner').map(t => [t.i, t]));
  const str = (/** @type {any} */ v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
  const known = new Set(live.flatMap(m => [fold(m.wrong), fold(m.right)]).filter(Boolean));

  /** @type {Checked[]} */ const mistakes = [];
  const seen = new Set(), patterns = new Set();
  let cards = 0;
  (Array.isArray(raw?.mistakes) ? raw.mistakes : []).forEach((/** @type {any} */ m, /** @type {number} */ index) => {
    const t = his.get(m?.turn);
    const wrong = str(m?.wrong), right = str(m?.right);
    const drop = (/** @type {string} */ reason) => { dropped.push({ field: 'mistakes', index, reason }); };
    if (!t) return drop('turn');
    if (!wrong || !verbatim(wrong, t.text)) return drop('not verbatim');
    if (!right || fold(right) === fold(wrong)) return drop('no change');
    if (!smallEdit(wrong, right)) return drop('rewrite');
    if (seen.has(fold(wrong))) return drop('duplicate');
    if (mistakes.length >= MAX_SHOWN) return drop('cap');
    seen.add(fold(wrong));
    const pattern = /** @type {readonly string[]} */ (PATTERNS).includes(m.pattern) ? m.pattern : 'other';
    const severity = /** @type {readonly string[]} */ (SEVERITIES).includes(m.severity) ? m.severity : 'grammar';
    const input = t.input === 'typed' || t.input == null ? 'typed' : null;
    /** @type {Checked['why']} */ let why = null;
    if (severity === 'style') why = 'style';
    else if (known.has(fold(wrong)) || known.has(fold(right))) why = 'already';
    else if (input !== 'typed') why = 'spoken';
    else if (patterns.has(pattern)) why = 'pattern';
    else if (cards >= MAX_CARDS) why = 'cap';
    const cardable = why === null;
    if (cardable) { cards++; patterns.add(pattern); }
    mistakes.push({ turn: t.i, wrong, right, rule: str(m.rule), pattern, severity, input, cardable, checked: cardable, why });
  });

  /** @type {{turn: number, said: string, better: string, why: string}[]} */ const better = [];
  (Array.isArray(raw?.better_phrases) ? raw.better_phrases : []).forEach((/** @type {any} */ b, /** @type {number} */ index) => {
    const t = his.get(b?.turn);
    const said = str(b?.said), alt = str(b?.better);
    if (!t || !quoted(said, t.text)) { dropped.push({ field: 'better_phrases', index, reason: !t ? 'turn' : 'not verbatim' }); return; }
    if (!alt || fold(alt) === fold(said)) { dropped.push({ field: 'better_phrases', index, reason: 'no change' }); return; }
    if (better.length >= MAX_BETTER) { dropped.push({ field: 'better_phrases', index, reason: 'cap' }); return; }
    better.push({ turn: t.i, said, better: alt, why: str(b.why) });
  });

  /** @type {{turn: number, text: string, why: string}[]} */ const usedWell = [];
  (Array.isArray(raw?.used_well) ? raw.used_well : []).forEach((/** @type {any} */ u, /** @type {number} */ index) => {
    const t = his.get(u?.turn);
    const text = str(u?.text);
    if (!t || (t.input && t.input !== 'typed') || !verbatim(text, t.text)) { dropped.push({ field: 'used_well', index, reason: !t ? 'turn' : 'not verbatim' }); return; }
    if (seen.has(fold(text))) { dropped.push({ field: 'used_well', index, reason: 'also a mistake' }); return; }
    if (usedWell.length >= MAX_USED) { dropped.push({ field: 'used_well', index, reason: 'cap' }); return; }
    usedWell.push({ turn: t.i, text, why: str(u.why) });
  });

  return { summary: str(raw?.summary), mistakes, better, usedWell, dropped };
}

/**
 * What addMistakes is given when he finishes: the session's mistakes already added (kept first, so a second finish
 * after "Try again" never drops a card he has), then the ones he ticked now, at most MAX_CARDS in all unless more were
 * already there.
 * @param {{wrong: string, right: string, rule: string}[]} existing  this session's live mistakes
 * @param {{wrong: string, right: string, rule: string}[]} chosen
 */
export function cardItems(existing, chosen) {
  const key = (/** @type {{wrong: string, right: string}} */ m) => `${fold(m.wrong)}\u0000${fold(m.right)}`;
  const have = new Set(existing.map(key));
  const fresh = chosen.filter(m => !have.has(key(m)) && (have.add(key(m)), true));
  return [...existing, ...fresh.slice(0, Math.max(0, MAX_CARDS - existing.length))].map(m => ({ wrong: m.wrong, right: m.right, rule: m.rule || '' }));
}
