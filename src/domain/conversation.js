/* Conversation practice (round 4, lane L4): the pure rules. No storage, no network, no clock reads (times and the
   study day are passed in). Tested in node (tests/unit/conversation.test.mjs).

     levels        partnerLevel: the partner speaks one level above his (C1 stays C1); "Slower" brings it to his own
     topics        rankTopics: three suggestions from the pack's topics, by the interests he typed, the level and what
                   he talked about in the last 14 days
     requests      turnRequest: the Messages API body of one partner turn (streamed, effort low, the system prompt in two
                   blocks with the cache breakpoint on the second, automatic caching of the history)
     history       commit: one exchange appended to the transcript. The messages are exactly what was sent and what came
                   back (thinking blocks unchanged) and are only ever appended to, so the cache and the API's check of
                   earlier turns stay valid. A failed reply commits nothing.
     recasts       parseReply: the partner marks at most one correction <r was="his words">corrected words</r>; it is
                   shown only when well formed and when "was" is really in his last message, otherwise the text is shown
                   plain. visibleText: what to show while the reply is still streaming.
     limits        sessionLoad (turns, minutes, input and output tokens; 80 % closes the conversation gently, 100 % shuts
                   the composer), monthLoad (his monthly cap, default $3), costOf (usage × the price list)
     feedback      feedbackTranscript: the turns as the review prompt reads them; stats: turns, words, minutes */
// @ts-check
import { LEVELS } from './text/estimate.js';

/** @typedef {{in: number, cacheRead: number, cacheWrite: number, out: number}} Usage */
/** @typedef {{in: number, out: number, cacheWrite: number, cacheRead: number}} Price  US dollars per million tokens */
/** @typedef {'free' | 'roleplay'} Mode */

/**
 * @typedef {object} Turn  one line of the transcript as the screen shows it
 * @property {number} i                    0, 1, 2 … in order
 * @property {'learner' | 'partner'} who
 * @property {string} text                 his text, or the partner's with any recast tag kept (parseReply reads it)
 * @property {number} at                   ms since the epoch
 * @property {'typed' | null} [input]      how he answered (typed only in v1; voice later)
 */

/**
 * @typedef {object} Transcript  kv conv.transcripts[id]: device-only
 * @property {string} id
 * @property {string} title                the topic or scenario as shown (his own topic stays here, never in conv.sessions)
 * @property {any[]} messages              the Messages API history, exactly as sent, append-only
 * @property {Turn[]} turns
 * @property {{base: string, session: string, interests: string[]}} [system]  the system prompt, fixed when it starts
 */

/** Limits of one conversation. maxTokens bounds a reply (thinking included); inputChars one message of his. */
export const LIMITS = Object.freeze({ maxTokens: 1200, inputChars: 600, turns: 30, minutes: 25, inTokens: 120000, outTokens: 10000, warn: 0.8 });
/** The monthly cap when he has not set one (settings conversation.monthlyCapUsd). */
export const MONTHLY_CAP = 3;
/** What a session is assumed to cost before he has had one (the plan's measured typed case is about $0.09). */
export const DEFAULT_SESSION_USD = 0.1;
/** Days a topic stays out of the suggestions after he talked about it. */
export const RECENT_DAYS = 14;
/** The opening user message: the API needs a user turn first; the system prompt says the app sends it. */
export const START = '<start/>';

/* ---------- levels ---------- */

/**
 * The level the partner speaks at: one above his (B1 → B2), at most C1; his own level while "Slower" is on.
 * @param {string | null | undefined} level @param {boolean} [slower]
 */
export function partnerLevel(level, slower = false) {
  const found = LEVELS.indexOf(String(level || '').toUpperCase());
  const top = LEVELS.indexOf('C1');
  const i = Math.min(top, found < 0 ? LEVELS.indexOf('B1') : found);
  return LEVELS[slower ? i : Math.min(top, i + 1)];
}

/* ---------- topics ---------- */

/** @typedef {{id: string, de: string, en: string, lv: string, tags: string[]}} Topic */
/** @typedef {{id: string, title: string, en: string, fn: string, reg: 'du' | 'sie', lv: string, role: string, setup: string, goal: string, opener: string}} Scenario */

/** Words of a text for matching interests: lower case, letters only, 3 characters or more. @param {string} s */
const keyWords = s => (String(s || '').normalize('NFC').toLowerCase().match(/\p{L}{3,}/gu) || []);

/** The same word or the same stem: robots and robotics, cook and cooking (4 letters in common, at most 2 apart). @param {string} a @param {string} b */
export function near(a, b) {
  if (a === b) return true;
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  return p >= 4 && p >= Math.min(a.length, b.length) - 2;
}

/** A small stable hash (FNV-1a) for tie-breaks that change by day, not by render. @param {string} s */
export function hash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

/**
 * The topics to suggest: those at or under the partner's level, not talked about in the last 14 days, ranked by how
 * many of his interests they match (a word of an interest that is a word of a tag or of the topic's English or German
 * title, or shares its stem: near()), then by a hash of the day so the list changes from day to day.
 * @template {{id: string, lv: string, tags?: string[], en?: string, de?: string}} T
 * @param {T[]} items @param {{interests?: string[], level?: string | null, recent?: string[], day?: string, n?: number}} [o]
 * @returns {T[]}
 */
export function rankTopics(items, { interests = [], level = 'B1', recent = [], day = '', n = 3 } = {}) {
  const top = LEVELS.indexOf(partnerLevel(level));
  const used = new Set(recent);
  const want = interests.flatMap(keyWords);
  const score = (/** @type {T} */ t) => {
    const words = [...(t.tags || []).flatMap(keyWords), ...keyWords(t.en || ''), ...keyWords(t.de || '')];
    return want.filter(w => words.some(x => near(w, x))).length;
  };
  const fit = items.filter(t => LEVELS.indexOf(String(t.lv || 'B1').toUpperCase()) <= top);
  const fresh = fit.filter(t => !used.has(t.id));
  const pool = fresh.length >= n ? fresh : fit;
  return pool.map(t => ({ t, s: score(t), h: hash(`${day}|${t.id}`) }))
    .sort((a, b) => b.s - a.s || a.h - b.h || a.t.id.localeCompare(b.t.id)).slice(0, n).map(x => x.t);
}

/** Interests from what he typed: comma or line separated, at most 8 of at most 40 characters (settings conversation.interests). @param {string} text */
export const parseInterests = text => [...new Set(String(text || '').split(/[,;\n]/).map(s => s.replace(/\s+/g, ' ').trim().slice(0, 40)).filter(Boolean))].slice(0, 8);

/** Monthly caps offered in Profile, in US dollars. */
export const CAP_OPTIONS = /** @type {const} */ ([1, 3, 5, 10]);

/** The topic ids of sessions that started in the last RECENT_DAYS days. @param {any[]} sessions @param {string} today @param {(day: string, n: number) => string} addDays */
export function recentTopics(sessions, today, addDays) {
  const from = addDays(today, -RECENT_DAYS);
  return sessions.filter(s => s && !s.deletedAt && s.topic && s.topic.ref && String(s.day || '') >= from).map(s => String(s.topic.ref));
}

/* ---------- requests ---------- */

/**
 * The body of one partner turn (services/claude.js stream() adds stream: true). Adaptive thinking is the model's
 * default; effort low keeps it short and mostly skips it in chat. Block 1 is the same for every session of a language,
 * block 2 is this session's and carries the cache breakpoint; the top-level cache_control caches the history up to the
 * last block, so each turn reads the conversation so far from the cache. Nothing in the body changes between turns
 * except the appended messages.
 * @param {{model: string, base: string, session: string, messages: any[], maxTokens?: number}} o
 */
export function turnRequest({ model, base, session, messages, maxTokens = LIMITS.maxTokens }) {
  return {
    model,
    max_tokens: maxTokens,
    output_config: { effort: 'low' },
    system: [{ type: 'text', text: base }, { type: 'text', text: session, cache_control: { type: 'ephemeral' } }],
    cache_control: { type: 'ephemeral' },
    messages,
  };
}

/* ---------- history ---------- */

/**
 * One exchange appended (a new transcript; the old one is not changed). user: his text, or null for the opening;
 * systems: mid-conversation system messages that go after his message (Slower, the closing note), merged into one;
 * content: the assistant's whole content array as it came back.
 * @param {Transcript} tr
 * @param {{user: string | null, systems?: string[], content: any[], reply: string, at: number}} o
 * @returns {Transcript}
 */
export function commit(tr, { user, systems = [], content, reply, at }) {
  /** @type {any[]} */ const add = [{ role: 'user', content: user == null ? START : user }];
  if (systems.length) add.push({ role: 'system', content: systems.join('\n') });
  add.push({ role: 'assistant', content: structuredClone(content) });
  /** @type {Turn[]} */ const turns = [...tr.turns];
  if (user != null) turns.push({ i: turns.length, who: 'learner', text: user, at, input: 'typed' });
  turns.push({ i: turns.length, who: 'partner', text: reply, at });
  return { ...tr, messages: [...tr.messages, ...add], turns };
}

/**
 * The messages of the next request: the history, his message, and any system messages after it.
 * @param {Transcript} tr @param {string | null} user @param {string[]} [systems]
 */
export function nextMessages(tr, user, systems = []) {
  /** @type {any[]} */ const out = [...tr.messages, { role: 'user', content: user == null ? START : user }];
  if (systems.length) out.push({ role: 'system', content: systems.join('\n') });
  return out;
}

/** Whether `a` is an unchanged prefix of `b` (the history is append-only). @param {any[]} a @param {any[]} b */
export const isPrefix = (a, b) => a.length <= b.length && a.every((m, i) => JSON.stringify(m) === JSON.stringify(b[i]));

/** His message as it is sent: spaces folded, at most LIMITS.inputChars characters. @param {string} s */
export const cleanInput = s => String(s || '').replace(/\s+/g, ' ').trim().slice(0, LIMITS.inputChars);

/* ---------- recasts ---------- */

/** A text folded for "is this in his message": lower case, quotes and dashes plain, punctuation and spaces folded. @param {string} s */
export const fold = s => String(s || '').normalize('NFC').toLowerCase()
  .replace(/[„“”«»"‚‘’']/g, '').replace(/[.,!?;:()…–—-]/g, ' ').replace(/\s+/g, ' ').trim();

const TAG = /<r\s+was="([^"<>]*)">([^<>]*)<\/r>/;
const ANY_TAG = /<\/?r\b[^>]*>/g;

/**
 * @typedef {object} Reply
 * @property {string} plain                    the text without tags (read aloud, glossed, shown when no recast)
 * @property {{text: string, recast?: boolean}[]} parts   the text in pieces; the recast piece has recast: true
 * @property {{to: string, was: string} | null} recast    what he wrote and how the partner said it
 */

/**
 * A finished reply: one well-formed recast whose "was" is in his last message (and differs from the correction) is
 * kept; a malformed tag, a second one, or a "was" he never wrote: every tag is stripped and the text shown plain.
 * @param {string} text @param {string | null} lastLearner @returns {Reply}
 */
export function parseReply(text, lastLearner) {
  const raw = String(text || '');
  const plainOf = (/** @type {string} */ s) => s.replace(ANY_TAG, '').replace(/[ \t]{2,}/g, ' ').trim();
  const tags = raw.match(ANY_TAG) || [];
  const m = raw.match(TAG);
  const flat = { plain: plainOf(raw), parts: [{ text: plainOf(raw) }], recast: null };
  if (!m || tags.length !== 2 || raw.includes('<') && (raw.match(/</g) || []).length !== 2) return flat;
  const was = m[1].trim(), to = m[2].trim();
  if (!was || !to || !lastLearner) return flat;
  const fw = fold(was), ft = fold(to);
  if (!fw || fw === ft || !` ${fold(lastLearner)} `.includes(` ${fw} `)) return flat;
  const at = /** @type {number} */ (m.index);
  const before = raw.slice(0, at), after = raw.slice(at + m[0].length);
  return {
    plain: `${before}${to}${after}`.replace(/[ \t]{2,}/g, ' ').trim(),
    parts: [{ text: before.replace(/^\s+/, '') }, { text: to, recast: true }, { text: after.replace(/\s+$/, '') }].filter(p => p.text),
    recast: { to, was },
  };
}

/** What to show of a reply while it streams: tags removed, and a tag still arriving hidden. @param {string} text */
export function visibleText(text) {
  const s = String(text || '').replace(ANY_TAG, '');
  const open = s.lastIndexOf('<');
  return (open >= 0 && s.indexOf('>', open) < 0 ? s.slice(0, open) : s).replace(/[ \t]{2,}/g, ' ');
}

/* ---------- limits and cost ---------- */

/** Shares are compared with this slack, so 2.40 of 3.00 is 80 % (floating point says 0.7999…). */
const EPS = 1e-9;

/** @returns {Usage} */
export const noUsage = () => ({ in: 0, cacheRead: 0, cacheWrite: 0, out: 0 });

/** @param {Usage} a @param {Partial<Usage> | null | undefined} b @returns {Usage} */
export const addUsage = (a, b) => ({ in: a.in + (b?.in || 0), cacheRead: a.cacheRead + (b?.cacheRead || 0), cacheWrite: a.cacheWrite + (b?.cacheWrite || 0), out: a.out + (b?.out || 0) });

/** The usage block of a Messages API reply (non-streaming) in our shape. @param {any} u @returns {Usage} */
export const usageOf = u => ({ in: u?.input_tokens || 0, cacheRead: u?.cache_read_input_tokens || 0, cacheWrite: u?.cache_creation_input_tokens || 0, out: u?.output_tokens || 0 });

/**
 * US dollars for a usage at a price (per million tokens). An unknown price counts at Opus-like rates, so a missing
 * row never makes a session look free.
 * @param {Usage} u @param {Price | null | undefined} p
 */
export function costOf(u, p) {
  const q = p || { in: 5, out: 25, cacheWrite: 6.25, cacheRead: 0.5 };
  return (u.in * q.in + u.out * q.out + u.cacheWrite * q.cacheWrite + u.cacheRead * q.cacheRead) / 1e6;
}

/**
 * How full the session is: the largest share of any limit, and which one. warn from 80 % (the closing note goes in),
 * closed at 100 % (the composer shuts and the feedback runs).
 * @param {{turns: number, startedAt: number, usage: Usage}} s  turns: his messages so far
 * @param {number} now @param {typeof LIMITS} [limits]
 */
export function sessionLoad(s, now, limits = LIMITS) {
  const minutes = Math.max(0, (now - s.startedAt) / 60000);
  const shares = /** @type {[string, number][]} */ ([
    ['turns', s.turns / limits.turns],
    ['minutes', minutes / limits.minutes],
    ['input', (s.usage.in + s.usage.cacheRead + s.usage.cacheWrite) / limits.inTokens],
    ['output', s.usage.out / limits.outTokens],
  ]);
  const [by, share] = shares.reduce((a, b) => (b[1] > a[1] ? b : a));
  return { share, by, warn: share >= limits.warn - EPS, closed: share >= 1 - EPS, minutes };
}

/** 'YYYY-MM' of a study day. @param {string} day */
export const monthOf = day => String(day).slice(0, 7);

/** @typedef {{month: string, usd: number, sessions: number}} Spend  kv conv.spend: this device's spend on his key */

/** Dollars spent in a month (a record of an earlier month counts as nothing). @param {Spend | null | undefined} spend @param {string} month */
export const spentIn = (spend, month) => (spend && spend.month === month ? Number(spend.usd) || 0 : 0);

/**
 * The spend record after adding a cost; a new month starts from zero.
 * @param {Spend | null | undefined} spend @param {string} month @param {number} usd @param {{session?: boolean}} [o]
 * @returns {Spend}
 */
export function addSpend(spend, month, usd, { session = false } = {}) {
  const cur = spend && spend.month === month ? spend : { month, usd: 0, sessions: 0 };
  return { month, usd: Math.round((cur.usd + Math.max(0, usd)) * 1e6) / 1e6, sessions: cur.sessions + (session ? 1 : 0) };
}

/** The month against the cap: warn from 80 %, over at 100 %. @param {number} usd @param {number | null | undefined} cap */
export function monthLoad(usd, cap) {
  const c = Number.isFinite(cap) && /** @type {number} */ (cap) > 0 ? /** @type {number} */ (cap) : MONTHLY_CAP;
  const share = usd / c;
  return { cap: c, usd, share, warn: share >= LIMITS.warn - EPS, over: share >= 1 - EPS };
}

/** What the next session will probably cost: the mean of his last 10 sessions that cost something. @param {any[]} sessions */
export function estimateNext(sessions) {
  const done = sessions.filter(s => s && !s.deletedAt && Number(s.costUsd) > 0).sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0)).slice(-10);
  return done.length ? done.reduce((n, s) => n + Number(s.costUsd), 0) / done.length : DEFAULT_SESSION_USD;
}

/* ---------- feedback and numbers ---------- */

/** Words in a text (letters and digits). @param {string} s */
export const wordsIn = s => (String(s || '').match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) || []).length;

/** An XML-ish text with no tag of his own in it. @param {string} s */
const safe = s => String(s || '').replace(/</g, '‹').replace(/>/g, '›');

/**
 * The transcript as the review prompt reads it: one <turn> per line; the partner's recast tags are kept, his text is
 * escaped so it cannot close a tag.
 * @param {Turn[]} turns
 */
export function feedbackTranscript(turns) {
  return turns.map(t => t.who === 'learner'
    ? `<turn i="${t.i}" who="learner" input="${t.input || 'typed'}">${safe(t.text)}</turn>`
    : `<turn i="${t.i}" who="partner">${String(t.text || '').replace(/<(?!\/?r\b)/g, '‹')}</turn>`).join('\n');
}

/**
 * His numbers for the conversation: turns, words, words per turn, minutes (from the first to the last line).
 * @param {Turn[]} turns @param {number} startedAt @param {number} [endedAt]
 */
export function stats(turns, startedAt, endedAt) {
  const mine = turns.filter(t => t.who === 'learner');
  const words = mine.reduce((n, t) => n + wordsIn(t.text), 0);
  const last = endedAt ?? (turns.length ? turns[turns.length - 1].at : startedAt);
  return { turns: mine.length, words, perTurn: mine.length ? Math.round(words / mine.length) : 0, minutes: Math.max(1, Math.round((last - startedAt) / 60000)) };
}

/**
 * The conversation evidence after a session (kv conv.used, knowledge.js origin 'conversation'): every item id he used
 * gets first, last and n. It adds a source; it never makes an item known.
 * @param {Record<string, {first: string, last: string, n: number}>} cur @param {string[]} ids @param {string} day
 */
export function addEvidence(cur, ids, day) {
  const next = { ...cur };
  for (const id of new Set(ids)) {
    const e = next[id];
    next[id] = e ? { first: e.first || day, last: day, n: (e.n || 0) + 1 } : { first: day, last: day, n: 1 };
  }
  return next;
}
