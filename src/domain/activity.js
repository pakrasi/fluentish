/* Study minutes per day, per device and per kind (kv 'activity'). Pure; tested in node (tests/unit/activity.test.mjs).

   The record, one per study day (additive on the shape from before round 4):
     activity[day] = { minutes, rounds,                     the day's totals: the sums over dev (read by Today, the
                                                            allowance and the runway, as before)
                       by?:   { [kind]: minutes },          the sums over dev, by kind of study
                       lang?: { [lang]: minutes },          the sums over dev, by course language
                       dev?:  { [deviceId]: DevDay } }      what each device studied: { minutes, rounds, by?, lang? }
   Kinds: exactly KINDS (review, new, write, speak, read, talk, build, script, exam), the contract every feature writes
   through (features/shared/data.js addActivity). Minutes of any other kind count in the totals without a kind.

   Merging two devices' records (data/restore.js, the backup) unites the devices: for each device the larger of each
   number (a device's own numbers only grow), and the day's totals are the sums. Two devices that studied on the same
   day therefore add up; before round 4 the merge took the larger day, which counted one device only.
   A day from before `dev` (or minutes written by an older version of the app on top of a day with `dev`) holds
   minutes no device is named for: they are kept under LEGACY ('_'), and two records' LEGACY parts merge by the larger,
   the old rule, since the same minutes may have been copied to both. */

/** The kinds of study minutes. */
export const KINDS = Object.freeze(['review', 'new', 'write', 'speak', 'read', 'talk', 'build', 'script', 'exam']);
const KIND = new Set(KINDS);

/** The device id that holds minutes recorded before devices were named. */
export const LEGACY = '_';

/** @typedef {{minutes?: number, rounds?: number, by?: Record<string, number>, lang?: Record<string, number>}} DevDay */
/** @typedef {{minutes: number, rounds: number, by?: Record<string, number>, lang?: Record<string, number>, dev?: Record<string, DevDay>, [k: string]: any}} Day */

/** @param {any} x */
const num = x => (Number.isFinite(Number(x)) ? Number(x) : 0);
/** Minutes to a tenth. @param {number} x */
const tenth = x => Math.round(x * 10) / 10;

/** @param {Record<string, number> | undefined} a @param {Record<string, number> | undefined} b @param {(x: number, y: number) => number} f */
function combine(a, b, f) {
  if (!a && !b) return undefined;
  /** @type {Record<string, number>} */ const out = {};
  for (const k of new Set([...Object.keys(a || {}), ...Object.keys(b || {})])) out[k] = tenth(f(num(a?.[k]), num(b?.[k])));
  return out;
}

/**
 * The devices of a day, every minute named: a day without `dev` is all LEGACY; minutes over the devices' sum (written
 * by an older version of the app) go to LEGACY too.
 * @param {any} day @returns {Record<string, DevDay>}
 */
export function devices(day) {
  if (!day || typeof day !== 'object') return {};
  /** @type {Record<string, DevDay>} */ const out = {};
  for (const [id, d] of Object.entries(day.dev && typeof day.dev === 'object' ? day.dev : {})) if (d && typeof d === 'object') out[id] = d;
  const named = Object.entries(out).filter(([id]) => id !== LEGACY);
  const m = named.reduce((t, [, d]) => t + num(d.minutes), 0), r = named.reduce((t, [, d]) => t + num(d.rounds), 0);
  const restM = tenth(num(day.minutes) - m), restR = num(day.rounds) - r;
  const leg = out[LEGACY] || {};
  if (restM > num(leg.minutes) || restR > num(leg.rounds)) {
    out[LEGACY] = { ...leg, minutes: Math.max(num(leg.minutes), restM, 0), rounds: Math.max(num(leg.rounds), restR, 0) };
    if (!day.dev) {   // a day from before devices: its kinds and languages, when it had any, are the legacy part's
      if (day.by) out[LEGACY].by = { ...day.by };
      if (day.lang) out[LEGACY].lang = { ...day.lang };
    }
  }
  return out;
}

/**
 * A day from its devices: the totals are the sums. Fields other than the counted ones are kept from `rest`.
 * @param {Record<string, DevDay>} dev @param {Record<string, any>} [rest] @returns {Day}
 */
export function fromDevices(dev, rest = {}) {
  const ids = Object.keys(dev).sort();
  /** @type {Record<string, DevDay>} */ const d = {};
  let by, lang;
  let minutes = 0, rounds = 0;
  for (const id of ids) {
    const x = dev[id];
    /** @type {DevDay} */ const y = { minutes: tenth(num(x.minutes)), rounds: num(x.rounds) };
    if (x.by && Object.keys(x.by).length) y.by = combine(x.by, undefined, a => a);
    if (x.lang && Object.keys(x.lang).length) y.lang = combine(x.lang, undefined, a => a);
    d[id] = y;
    minutes += num(y.minutes); rounds += num(y.rounds);
    by = y.by ? combine(by, y.by, (a, b) => a + b) : by;
    lang = y.lang ? combine(lang, y.lang, (a, b) => a + b) : lang;
  }
  const { minutes: _m, rounds: _r, by: _b, lang: _l, dev: _d, ...keep } = rest;
  /** @type {Day} */ const out = { ...keep, minutes: tenth(minutes), rounds };
  if (by) out.by = by;
  if (lang) out.lang = lang;
  // a day of legacy minutes only keeps the shape from before devices
  if (ids.length && !(ids.length === 1 && ids[0] === LEGACY)) out.dev = d;
  return out;
}

/**
 * Add study to a day, for one device. A mixed review round passes `split` ({review: n, new: m}): its minutes are
 * shared out by item count. Returns a new activity record.
 * @param {Record<string, any> | null | undefined} activity
 * @param {string} day
 * @param {{minutes: number, rounds?: number, kind?: string | null, split?: Record<string, number> | null, lang?: string | null, deviceId?: string | null}} o
 * @returns {Record<string, any>}
 */
export function addStudy(activity, day, { minutes, rounds = 0, kind = null, split = null, lang = null, deviceId = null }) {
  const a = activity && typeof activity === 'object' ? activity : {};
  const dev = devices(a[day]);
  const id = deviceId || LEGACY;
  const cur = dev[id] || {};
  const m = Math.max(0, num(minutes));
  /** @type {Record<string, number>} */ let kinds = {};
  const parts = split ? Object.entries(split).filter(([k, n]) => KIND.has(k) && num(n) > 0) : [];
  const total = parts.reduce((t, [, n]) => t + num(n), 0);
  if (total > 0) for (const [k, n] of parts) kinds[k] = (m * num(n)) / total;
  else if (kind && KIND.has(kind)) kinds = { [kind]: m };
  /** @type {DevDay} */ const next = { ...cur, minutes: tenth(num(cur.minutes) + m), rounds: num(cur.rounds) + num(rounds) };
  if (Object.keys(kinds).length) next.by = combine(cur.by, kinds, (x, y) => x + y);
  if (lang) next.lang = combine(cur.lang, { [lang]: m }, (x, y) => x + y);
  return { ...a, [day]: fromDevices({ ...dev, [id]: next }, a[day] || {}) };
}

/**
 * Two records of one day merged: each device's larger numbers; the totals are the sums.
 * @param {any} x @param {any} y @returns {Day}
 */
export function joinDay(x, y) {
  if (!x) return y;
  if (!y) return x;
  const a = devices(x), b = devices(y);
  /** @type {Record<string, DevDay>} */ const dev = {};
  for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const p = a[id], q = b[id];
    if (!p || !q) { dev[id] = /** @type {DevDay} */ (p || q); continue; }
    /** @type {DevDay} */ const d = { minutes: Math.max(num(p.minutes), num(q.minutes)), rounds: Math.max(num(p.rounds), num(q.rounds)) };
    const by = combine(p.by, q.by, Math.max), lang = combine(p.lang, q.lang, Math.max);
    if (by) d.by = by;
    if (lang) d.lang = lang;
    dev[id] = d;
  }
  return fromDevices(dev, { ...y, ...x });
}

/**
 * Two activity records merged day by day (commutative and idempotent).
 * @param {Record<string, any> | null | undefined} a @param {Record<string, any> | null | undefined} b
 * @returns {Record<string, any>}
 */
export function joinActivity(a, b) {
  /** @type {Record<string, any>} */ const out = { ...(a || {}) };
  for (const [day, y] of Object.entries(b || {})) out[day] = out[day] ? joinDay(out[day], y) : y;
  return out;
}

/**
 * A day's minutes for one course language: the devices' `lang` part, and minutes recorded without a language count
 * for `legacyLang` (the profile's first course: before courses every minute was German).
 * @param {any} day @param {string} lang @param {string | null} legacyLang
 * @returns {{total: number, rounds: number, dev: Record<string, number>, by?: Record<string, number>}}
 */
export function minutesFor(day, lang, legacyLang) {
  const dev = devices(day);
  /** @type {Record<string, number>} */ const per = {};
  let total = 0, only = true;
  /** @type {Record<string, number> | undefined} */ let by;
  for (const [id, d] of Object.entries(dev)) {
    const m = d.lang ? num(d.lang[lang]) : lang === legacyLang ? num(d.minutes) : 0;
    const other = d.lang ? Object.entries(d.lang).some(([k, v]) => k !== lang && num(v) > 0) : lang !== legacyLang && num(d.minutes) > 0;
    if (other) only = false;
    if (m > 0) { per[id] = tenth(m); total += m; }
    if (d.by && m > 0) by = combine(by, d.by, (x, y) => x + y);
  }
  /** @type {{total: number, rounds: number, dev: Record<string, number>, by?: Record<string, number>}} */
  const out = { total: tenth(total), rounds: only ? num(day && day.rounds) : 0, dev: per };
  // kinds are recorded per device, not per language: they are given only when the day's study was all this course's
  if (by && only) out.by = by;
  return out;
}
