/* Profile settings (settings@1) and device prefs (prefs@1): defaults, field-level writes and the exam date.

   The exam date has exactly one home, settings.exam.date, and one reader, core/clock.js. setExamDate() is the only
   writer: it validates the date, records it per field on the hybrid logical clock, appends a settings.changed event,
   re-caps reviews when the date moves earlier (fsrs.recap), and publishes settings:changed so Today re-renders. */
import { recap } from '../domain/fsrs.js';
import { context, isDay } from '../core/clock.js';

export const MODULES = /** @type {const} */ (['lesen', 'hoeren', 'schreiben', 'sprechen']);

/** @returns {any} */
export const defaultSettings = () => ({
  v: 1,
  language: null,
  level: null,
  exam: { type: null, date: null, modules: [...MODULES] },
  minutesPerDay: 60,
  newPerDay: null,
  practice: { readAloud: false, claudeCheck: false, simpleInput: false },
  onboarded: null,
  rev: {},
});

export const defaultPrefs = () => ({ theme: 'auto', motion: 'system', locale: 'en' });

/** Fill missing fields from the defaults (older or partial records). @param {any} s */
export function normalizeSettings(s) {
  const d = defaultSettings();
  if (!s || typeof s !== 'object') return d;
  return { ...d, ...s, exam: { ...d.exam, ...(s.exam || {}) }, practice: { ...d.practice, ...(s.practice || {}) }, rev: { ...(s.rev || {}) } };
}

/** @param {any} o @param {string} path */
const getPath = (o, path) => path.split('.').reduce((x, k) => (x == null ? x : x[k]), o);
/** @param {any} o @param {string} path @param {any} v */
function setPath(o, path, v) {
  const ks = path.split('.');
  let x = o;
  for (const k of ks.slice(0, -1)) x = x[k] = { ...(x[k] || {}) };
  x[ks[ks.length - 1]] = v;
}

/** Fields whose value is never written into an event (none today; kept so a future secret-ish field has a place). */
const QUIET = new Set();

/**
 * Write one settings field. Returns the previous value.
 * @param {{store: any, hlc: {tick: () => string}, bus?: any}} app
 * @param {string} path  e.g. 'exam.date', 'minutesPerDay'
 * @param {any} value
 */
export function setSetting({ store, hlc, bus }, path, value) {
  const cur = normalizeSettings(store.get('settings'));
  const prev = getPath(cur, path);
  if (JSON.stringify(prev) === JSON.stringify(value)) return prev;
  const next = structuredClone(cur);
  setPath(next, path, value);
  next.rev = { ...next.rev, [path]: hlc.tick() };
  store.set('settings', next);
  store.append('settings.changed', { key: path, value: QUIET.has(path) ? null : value, rev: next.rev[path] });
  bus?.emit('settings:changed', { key: path, value, prev });
  return prev;
}

/**
 * Merge two settings records field by field: the newer rev wins (sync and import).
 * @param {any} local @param {any} remote
 */
export function mergeSettings(local, remote) {
  const a = normalizeSettings(local), b = normalizeSettings(remote);
  const out = structuredClone(a);
  for (const [path, rev] of Object.entries(b.rev)) {
    if (!a.rev[path] || /** @type {string} */ (rev) > a.rev[path]) { setPath(out, path, getPath(b, path)); out.rev[path] = rev; }
  }
  return out;
}

/**
 * Check a date the user typed for the exam. Returns an error key or null.
 * @param {string | null} date @param {string} today
 */
export function examDateError(date, today) {
  if (date == null || date === '') return null;
  if (!isDay(date)) return 'goal.date.invalid';
  if (date < today) return 'goal.date.past';
  return null;
}

/**
 * The one writer of the exam date.
 * @param {{store: any, hlc: {tick: () => string}, bus?: any, clock: {today: () => string}}} app
 * @param {string | null} date
 * @returns {{ok: boolean, error?: string, prev?: string | null, moved: number}}
 */
export function setExamDate(app, date) {
  const today = app.clock.today();
  const value = date || null;
  const error = examDateError(value, today);
  if (error) return { ok: false, error, moved: 0 };
  const prev = normalizeSettings(app.store.get('settings')).exam.date;
  if (prev === value) return { ok: true, prev, moved: 0 };
  // earlier than before (or newly set): reviews due after the new cap would miss their pre-exam review
  let moved = 0;
  if (value && (!prev || value < prev)) {
    const ctx = context({ today, exam: value });
    for (const deck of Object.keys(app.store.cardsByDeck)) {
      if (deck !== 'b1') continue;   // the FSRS deck; Igloo's SM-2 cards stay with Igloo until Drill moves here
      const out = recap(app.store.cards(deck), ctx);
      const entries = Object.entries(out).map(([id, due]) => /** @type {[string, any]} */ ([id, { ...app.store.cards(deck)[id], due }]));
      if (entries.length) { app.store.putCards(deck, entries); moved += entries.length; }
    }
  }
  setSetting(app, 'exam.date', value);
  return { ok: true, prev, moved };
}
