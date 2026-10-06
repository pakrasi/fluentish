/* Conversation practice: its storage. Only this feature writes these collections.

     kv 'conv.sessions'     { [id]: conv-session@1 }  profile, BACKED UP (data/sync/backup.js SNAPSHOT_KV): numbers and ids
                            only, no free text (PLAN-REVIEW B6): mode, topic {kind, ref} (a content id, or null for his
                            own topic), levels, minutes, turns, words, usage, cost, how many cards it added
     kv 'conv.transcripts'  { [id]: Transcript }  DEVICE-ONLY: the title as shown (his own topic stays here), the Messages
                            API history exactly as sent and the turns. Never in a backup, a log upload or an export
     kv 'conv.feedback'     { [id]: conv-feedback@1 }  DEVICE-ONLY: the validated review, which quotes his sentences
     kv 'conv.used'         { [itemId]: {first, last, n} }  profile, backed up: words he used in typed turns or saved
                            from a reply; knowledge.js reads it as the source 'conversation' (it never makes an item known)
     kv 'conv.spend'        {month, usd, sessions}  device: what this device spent on his key this month

   His mistakes become cards through data/mistakes.js (deck b1, F:C-<session id>-<n>), like Schreiben's; they are
   learning items and are backed up with the other mistakes (PLAN-REVIEW B5). */
import { uuidv7 } from '../../data/ids.js';
import { packFor } from '../../core/lang.js';
import { langCode } from '../../data/settings.js';
import * as C from '../../domain/conversation.js';
import { config } from '../../core/config.js';
import { forget } from '../../core/log.js';
import { scriptText } from '../../data/sync/backup.js';
import { dropContext } from '../shared/read-data.js';

export const SESSIONS = 'conv.sessions';
export const TRANSCRIPTS = 'conv.transcripts';
export const FEEDBACK = 'conv.feedback';
export const USED = 'conv.used';
export const SPEND = 'conv.spend';

/** @typedef {import('../../domain/conversation.js').Transcript} Transcript */
/** @typedef {import('../../domain/conversation.js').Usage} Usage */

/**
 * @typedef {object} Session  conv-session@1 (no free text)
 * @property {string} id
 * @property {1} v
 * @property {'free' | 'roleplay'} mode
 * @property {{kind: 'topic' | 'scenario' | 'own', ref: string | null}} topic
 * @property {string} level
 * @property {string} partnerLevel
 * @property {'du' | 'sie'} register
 * @property {string} day           the study day it started
 * @property {number} startedAt     ms
 * @property {number | null} endedAt
 * @property {number} turns         his messages
 * @property {number} words
 * @property {number} minutes
 * @property {boolean} slower      "Slower" is on
 * @property {boolean} toldSlower  what Claude was last told (a note goes with his next message when the two differ)
 * @property {{turn: string, feedback: string}} models
 * @property {{turn: string, session: string, feedback: string}} promptVersions
 * @property {Usage} usage
 * @property {number} costUsd
 * @property {boolean} closing      the closing note has been sent
 * @property {boolean} counted      its minutes went into the activity log
 * @property {number} cards         mistakes added as cards
 * @property {number} [feedbackTries] feedback requests billed (round 4: past the monthly cap, no second one)
 * @property {'open' | 'ended' | 'finished'} status
 * @property {string | null} deletedAt
 */

/** @param {any} store @returns {Record<string, Session>} */
export const sessions = store => store.get(SESSIONS, {}) || {};
/** @param {any} store @returns {Session[]} newest first */
export const listSessions = store => Object.values(sessions(store)).filter(s => s && !s.deletedAt).sort((a, b) => b.startedAt - a.startedAt);
/** @param {any} store @param {string} id @returns {Session | null} */
export const getSession = (store, id) => sessions(store)[id] || null;
/** @param {any} store @param {Session} s */
export const putSession = (store, s) => store.update(SESSIONS, (/** @type {any} */ all) => ({ ...(all || {}), [s.id]: s }), {});
/** @param {any} store @param {string} id @param {Partial<Session>} patch */
export const patchSession = (store, id, patch) => store.update(SESSIONS, (/** @type {any} */ all) => (all && all[id] ? { ...all, [id]: { ...all[id], ...patch } } : all), {});

/** @param {any} store @param {string} id @returns {Transcript | null} */
export const getTranscript = (store, id) => (store.get(TRANSCRIPTS, {}) || {})[id] || null;
/** @param {any} store @param {Transcript} tr */
export const putTranscript = (store, tr) => store.update(TRANSCRIPTS, (/** @type {any} */ all) => ({ ...(all || {}), [tr.id]: tr }), {});

/** @param {any} store @param {string} id */
export const getFeedback = (store, id) => (store.get(FEEDBACK, {}) || {})[id] || null;
/** @param {any} store @param {any} fb */
export const putFeedback = (store, fb) => store.update(FEEDBACK, (/** @type {any} */ all) => ({ ...(all || {}), [fb.sessionId]: fb }), {});

/**
 * Delete a conversation: its transcript and feedback go; the session's numbers stay, marked deleted; its cards stay.
 * The error log forgets every line that quotes it (core/log.js forget), so the next log upload cannot carry it.
 * @param {any} store @param {string} id
 */
export function deleteConversation(store, id) {
  const tr = getTranscript(store, id);
  const fb = getFeedback(store, id);
  if (tr || fb) {
    const quoted = [...(tr && Array.isArray(tr.turns) ? tr.turns.map((/** @type {any} */ x) => String(x && x.text || '').replace(/<\/?r\b[^>]*>/g, '')) : []),
      ...(fb ? JSON.stringify(fb.raw || {}).match(/"(?:[^"\\]|\\.){12,}"/g) || [] : []).map(q => q.slice(1, -1))];
    forget(scriptText({ [`conv:${id}`]: { title: tr && typeof tr.title === 'string' ? tr.title : null, sections: [{ sentences: quoted.map(de => ({ de })) }] } }));
  }
  store.update(TRANSCRIPTS, (/** @type {any} */ all) => { const n = { ...(all || {}) }; delete n[id]; return n; }, {});
  store.update(FEEDBACK, (/** @type {any} */ all) => { const n = { ...(all || {}) }; delete n[id]; return n; }, {});
  dropContext(store, `conv:${id}`);   // the sentences of words added to review from its replies (sheets.js glossSheet)
  patchSession(store, id, { deletedAt: new Date().toISOString() });
}

/* ---------- money ---------- */

/** This month's spend on this device. @param {any} store @param {string} today */
export const monthSpent = (store, today) => C.spentIn(store.get(SPEND, null), C.monthOf(today));

/**
 * Add a request's cost to the session and the month. @param {any} store @param {string} id @param {string} today
 * @param {string} model @param {Usage} usage @returns {number} the cost in US dollars
 */
export function charge(store, id, today, model, usage) {
  const usd = C.costOf(usage, config.anthropic.prices[model]);
  store.update(SPEND, (/** @type {any} */ sp) => C.addSpend(sp, C.monthOf(today), usd), null);
  store.update(SESSIONS, (/** @type {any} */ all) => {
    const s = all && all[id];
    return s ? { ...all, [id]: { ...s, usage: C.addUsage(s.usage || C.noUsage(), usage), costUsd: Math.round(((s.costUsd || 0) + usd) * 1e6) / 1e6 } } : all;
  }, {});
  return usd;
}

/** Dollars as text: $0.11, $3.00. @param {number} usd */
export const money = usd => `$${(Math.round(usd * 100) / 100).toFixed(2)}`;

/* ---------- settings ---------- */

/**
 * The conversation settings with their defaults (settings@1 conversation{…}, written only through data/settings.js).
 * @param {any} settings
 * @returns {{interests: string[], showRecasts: boolean, monthlyCapUsd: number}}
 */
export function convSettings(settings) {
  const c = (settings && settings.conversation) || {};
  return {
    interests: Array.isArray(c.interests) ? c.interests.filter((/** @type {any} */ x) => typeof x === 'string' && x.trim()).slice(0, 8) : [],
    showRecasts: c.showRecasts !== false,
    monthlyCapUsd: Number.isFinite(c.monthlyCapUsd) && c.monthlyCapUsd > 0 ? c.monthlyCapUsd : C.MONTHLY_CAP,
  };
}


/* ---------- the language ---------- */

/** The study language's pack and its conversation part (null when the pack has none). @param {any} settings */
export function convPack(settings) {
  const code = langCode(settings.language) || 'de';
  const pack = /** @type {import('../../lang/types.js').LanguagePack | null} */ (packFor(code));
  return { code, pack, conv: pack && pack.conversation ? pack.conversation : null, contentId: pack?.content?.conversation || null };
}

/** The pack's topics and scenarios (content conversation.<lang>), or null. @param {any} ctx */
export async function loadTopics(ctx) {
  const { contentId } = convPack(ctx.settings());
  if (!contentId) return null;
  try { return await ctx.content.load(contentId); } catch { return null; }
}

/** The Claude key on this device, or null. @param {any} store */
export const claudeKey = store => (store.get('secrets', {}) || {}).anthropicKey || null;

/** A new session id (UUIDv7). */
export const newId = () => uuidv7();
