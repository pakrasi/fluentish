/* The error log: the last RING entries, kept in IndexedDB (device-scope kv 'log') so they survive a reload, shown in
   Profile › Diagnostics, and uploaded once a day with the progress backup (data/sync/backup.js uploadLog), roadmap
   item 7. Every message is scrubbed when it is logged: tokens and keys, Authorization values, URL query strings and
   quoted text (which could be a sentence he wrote) never reach the ring. Script text is checked again before upload.

   attachLogStore(adapter) is called once storage is open; entries logged before that are kept and saved then. */

export const RING = 500;
const MAX_MESSAGE = 300;

/** @typedef {{at: string, where: string, message: string}} LogEntry */

/** @type {LogEntry[]} */
let ring = [];
/** @type {{loadScope: (s: string) => Promise<Record<string, any>>, putKV: (s: string, n: string, v: any) => Promise<void>} | null} */
let sink = null;
/** @type {ReturnType<typeof setTimeout> | null} */
let timer = null;

// accounts (round 8): Supabase secret keys, JWTs (session tokens, legacy keys) and the session's token fields too, and
// an Authorization value's token after its scheme
const SECRET = /github_pat_[A-Za-z0-9_]+|\bgh[opsur]_[A-Za-z0-9]+|sk-ant-[A-Za-z0-9_-]+|sb_secret_[A-Za-z0-9_-]+|\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*|\b(Bearer|token)\s+[A-Za-z0-9._~+/=-]{8,}|("?(x-api-key|authorization|apikey|api_key|githubToken|anthropicKey|access_token|refresh_token|accessToken|refreshToken)"?\s*[:=]\s*)((?:Bearer|token)\s+\S+|"[^"]*"|'[^']*'|\S+)/gi;

/**
 * A message with nothing private left in it: keys and tokens, URL queries, quoted text longer than a word or two.
 * @param {string} text
 */
export function scrub(text) {
  return String(text ?? '')
    .replace(SECRET, (m, _a, prefix) => (prefix ? `${prefix}[removed]` : '[removed]'))
    .replace(/(https?:\/\/[^\s?#"']+)[?#][^\s"']*/g, '$1?[removed]')
    // a quote opens after a space or a bracket and closes before one, so two strings never pair up across a gap
    .replace(/(^|[\s:(\[{,=])(?:"[^"\n]{13,}"|'[^'\n]{13,}'|„[^“\n]{13,}“|«[^»\n]{13,}»)(?=$|[\s,.;:)\]}!?])/g, '$1"[text]"')
    .replace(/\s+/g, ' ').trim().slice(0, MAX_MESSAGE);
}

/** @param {string} where @param {unknown} err */
export function log(where, err) {
  const message = scrub(err instanceof Error ? `${err.name}: ${err.message}` : String(err));
  ring.push({ at: new Date().toISOString(), where: scrub(where).slice(0, 40), message });
  if (ring.length > RING) ring = ring.slice(-RING);
  save();
  console.error(`[${where}]`, err);
}

export const entries = () => [...ring];

/**
 * Drop every entry whose message or place matches (a deleted reading text or conversation: its sentences must not
 * stay in the ring, which is uploaded once a day). Saved at once. @param {(text: string) => boolean} match
 * @returns {number} entries dropped
 */
export function forget(match) {
  const before = ring.length;
  ring = ring.filter(e => !match(e.message) && !match(e.where));
  const n = before - ring.length;
  if (n && sink) { if (timer) clearTimeout(timer); timer = null; sink.putKV('device', 'log', ring).catch(() => { /* storage is gone: the log stays in memory */ }); }
  return n;
}

/** Write the ring a second after the last entry (errors come in bursts). */
function save() {
  if (!sink) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { timer = null; sink?.putKV('device', 'log', ring).catch(() => { /* storage is gone: the log stays in memory */ }); }, 1000);
}

/**
 * Keep the log in IndexedDB from now on: what an earlier session saved comes first, then what was logged since start.
 * @param {{loadScope: (s: string) => Promise<Record<string, any>>, putKV: (s: string, n: string, v: any) => Promise<void>}} adapter
 */
export async function attachLogStore(adapter) {
  try {
    const saved = (await adapter.loadScope('device')).log;
    const before = Array.isArray(saved) ? saved.filter(e => e && typeof e.at === 'string') : [];
    ring = [...before, ...ring].slice(-RING);
    sink = adapter;
    if (ring.length > before.length) save();
  } catch { /* storage is gone: the log stays in memory */ }
}

/** For tests: start over. */
export function resetLog() { ring = []; sink = null; if (timer) clearTimeout(timer); timer = null; }

export function installErrorLog() {
  addEventListener('error', e => {
    // a benign browser notice (a resize observer that settled a frame later), not an error of the app
    if (/ResizeObserver loop/.test(String(e.message || ''))) return;
    log('error', e.error || e.message);
  });
  addEventListener('unhandledrejection', e => log('promise', e.reason));
}
