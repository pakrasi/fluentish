/* Today › Progress: the numbers behind the page, from the progress log (domain/progress.js, docs/SCHEMA.md › Progress
   log) and the study hours file. Pure: no DOM, no storage, no clock reads (today is passed in). Tested in node
   (tests/unit/progress-view.test.mjs).

   points()       one point per recorded day: words and phrases known (all kinds, the map's count), known and pool
                  by level, what the day added (learnt, missed, new, reviews), minutes in all, by kind and by device
   weeks()        Monday-to-Sunday weeks over a range: minutes, study days, learnt, missed, minutes by kind group
   calendar()     every day of a range with its minutes, for the study days field (no runs, no streaks)
   milestones()   dated facts: a count first reached on an exact day; never dated by an estimate
   levelEta()     the level goal's range: the weekly gain in that level's known items over the last 8 full weeks,
                  resampled (bootstrap), gives the 10th to 90th percentile date at which 80% would be known
   hoursWeeks()   the study hours file's entries for one language, by week. These hours are never added to the app's
                  minutes: the file already includes the time spent in Fluentish. */
import * as D8 from '../../../domain/days.js';
import { LEVELS, total } from '../../../domain/progress.js';
import { weekday } from '../../../domain/week.js';

/** @typedef {[string, any]} Entry  [day, progress record] */
/**
 * @typedef {object} Point
 * @property {string} day
 * @property {number} known      words, phrases and grammar concepts known (the map's count)
 * @property {number} of         the pool that day
 * @property {number[]} lk       known by level, A1 … C2
 * @property {number[]} ln       the pool by level, A1 … C2
 * @property {number[]} lg       grammar concepts known by level, A1 … C2
 * @property {boolean} est       counts estimated from answer history (before the backup's first snapshot)
 * @property {number} jump       known items Igloo's placement added on this day (0 on other days)
 * @property {number} learnt @property {number} missed @property {number} fresh  new items answered
 * @property {number} reviews
 * @property {number} min        minutes, every device summed
 * @property {Record<string, number> | null} by   minutes by kind (null: the day's minutes were not split by kind)
 * @property {string[]} devs     the devices with minutes that day (named ones)
 * @property {string | null} atlas
 */

/** Kinds of study grouped for the minutes charts: reviews, new items, practice (writing, speaking, reading,
 * conversation, word building, scripts) and mock exams. */
export const GROUPS = /** @type {const} */ (['review', 'new', 'practice', 'exam']);
/** @type {Record<string, typeof GROUPS[number]>} */
const GROUP_OF = { review: 'review', new: 'new', write: 'practice', speak: 'practice', read: 'practice', talk: 'practice', build: 'practice', script: 'practice', exam: 'exam' };

/** @param {any} x */
const num = x => (Number.isFinite(Number(x)) ? Number(x) : 0);
const tenth = (/** @type {number} */ x) => Math.round(x * 10) / 10;

/** Known (or pool) at a level, every kind. @param {any} c @param {number} i */
const atLevel = (c, i) => num(c?.w?.[i]) + num(c?.p?.[i]) + num(c?.g?.[i]);

/**
 * One point per recorded day, in day order.
 * @param {Entry[]} entries @returns {Point[]}
 */
export function points(entries) {
  return entries.filter(([d, r]) => D8.isDay(d) && r && typeof r === 'object').map(([day, r]) => {
    const m = r.min || {};
    const by = m.by && typeof m.by === 'object' ? /** @type {Record<string, number>} */ (m.by) : null;
    return {
      day,
      known: total(r.known), of: total(r.of),
      lk: LEVELS.map((_, i) => atLevel(r.known, i)), ln: LEVELS.map((_, i) => atLevel(r.of, i)), lg: LEVELS.map((_, i) => num(r.known?.g?.[i])),
      est: !!r.estimated, jump: num(r.jump?.known),
      learnt: num(r.day?.learnt), missed: num(r.day?.missed), fresh: num(r.day?.new), reviews: num(r.day?.reviews),
      min: tenth(num(m.total)), by,
      devs: Object.entries(m.dev || {}).filter(([id, d]) => id !== '_' && num(/** @type {any} */ (d)?.m) > 0).map(([id]) => id),
      atlas: typeof r.atlas === 'string' ? r.atlas : null,
    };
  });
}

/** The Monday of a day's week. @param {string} day */
export const monday = day => D8.add(day, -weekday(day));

/** The ranges of the page. */
export const RANGES = /** @type {const} */ (['12w', '6m', 'all']);
/** @typedef {typeof RANGES[number]} Range */

/**
 * The first day of a range: 12 weeks or about 6 months back to a Monday, or the first recorded day's Monday.
 * @param {Range} range @param {string} today @param {string | null} first the first recorded day
 */
export function rangeStart(range, today, first) {
  const start = range === '12w' ? D8.add(monday(today), -77) : range === '6m' ? monday(D8.add(today, -182)) : monday(first || today);
  return first && range !== 'all' && start < monday(first) ? monday(first) : start;
}

/** Minutes of a point by group; minutes not split by kind are 'other'. @param {Point} p */
export function groupsOf(p) {
  /** @type {Record<string, number>} */ const g = { review: 0, new: 0, practice: 0, exam: 0, other: 0 };
  let split = 0;
  for (const [k, v] of Object.entries(p.by || {})) { const grp = GROUP_OF[k]; if (!grp) continue; g[grp] += num(v); split += num(v); }
  g.other = Math.max(0, p.min - split);
  for (const k of Object.keys(g)) g[k] = tenth(g[k]);
  return g;
}

/**
 * @typedef {object} Week
 * @property {string} mon @property {string} sun
 * @property {boolean} partial      the week of today (not over yet)
 * @property {number} min           minutes, every device summed
 * @property {number} days          study days (a day with a record)
 * @property {number} learnt @property {number} missed
 * @property {Record<string, number>} groups   minutes by group, plus 'other' (not split by kind)
 * @property {Record<string, number>} kinds    minutes by kind
 * @property {number} devices       devices with minutes that week
 * @property {number | null} known  known at the end of the week (the last record up to its Sunday)
 * @property {boolean} est          some of its days are estimates
 */

/**
 * Weeks from the Monday of `from` to the week of `today`, oldest first; a week without study has zero minutes.
 * @param {Point[]} ps @param {string} from @param {string} today @returns {Week[]}
 */
export function weeks(ps, from, today) {
  /** @type {Week[]} */ const out = [];
  let i = 0, last = /** @type {Point | null} */ (null);
  const end = monday(today);
  for (let mon = monday(from); mon <= end; mon = D8.add(mon, 7)) {
    const sun = D8.add(mon, 6);
    /** @type {Week} */ const w = { mon, sun, partial: today <= sun, min: 0, days: 0, learnt: 0, missed: 0, groups: { review: 0, new: 0, practice: 0, exam: 0, other: 0 }, kinds: {}, devices: 0, known: null, est: false };
    /** @type {Set<string>} */ const devs = new Set();
    while (i < ps.length && ps[i].day < mon) last = ps[i++];
    while (i < ps.length && ps[i].day <= sun) {
      const p = ps[i++];
      last = p;
      w.min += p.min; w.days++; w.learnt += p.learnt; w.missed += p.missed;
      if (p.est) w.est = true;
      const g = groupsOf(p);
      for (const k of Object.keys(g)) w.groups[k] += g[k];
      for (const [k, v] of Object.entries(p.by || {})) w.kinds[k] = tenth((w.kinds[k] || 0) + num(v));
      for (const d of p.devs) devs.add(d);
    }
    w.min = tenth(w.min);
    for (const k of Object.keys(w.groups)) w.groups[k] = tenth(w.groups[k]);
    w.devices = devs.size;
    w.known = last ? last.known : null;
    out.push(w);
  }
  return out;
}

/**
 * The summary of a range: known at its end and the change over it, learnt, minutes.
 * @param {Point[]} ps @param {string} from
 */
export function summary(ps, from) {
  const before = ps.filter(p => p.day < from).at(-1) || null;
  const inside = ps.filter(p => p.day >= from);
  const last = inside.at(-1) || before;
  const base = before || inside[0] || null;
  return {
    known: last ? last.known : 0, of: last ? last.of : 0,
    net: last && base ? last.known - base.known : 0,
    learnt: inside.reduce((n, p) => n + p.learnt, 0),
    missed: inside.reduce((n, p) => n + p.missed, 0),
    min: tenth(inside.reduce((n, p) => n + p.min, 0)),
    days: inside.length,
  };
}

/** The study-days field's step of a day: 0 none, 1 under 15 min (or minutes not recorded), 2 under 45, 3 45 or more. @param {number} min @param {boolean} studied */
export const step = (min, studied) => (!studied ? 0 : min < 15 ? 1 : min < 45 ? 2 : 3);

/**
 * Every day from the Monday of `from` to today, for the study days field.
 * @param {Point[]} ps @param {string} from @param {string} today
 * @returns {{days: {day: string, min: number, studied: boolean, step: number, before: boolean}[], studied: number, total: number, first: string | null}}
 */
export function calendar(ps, from, today) {
  const by = new Map(ps.map(p => [p.day, p]));
  const first = ps[0]?.day || null;
  /** @type {{day: string, min: number, studied: boolean, step: number, before: boolean}[]} */ const days = [];
  let studied = 0, all = 0;
  for (let d = monday(from); d <= today; d = D8.add(d, 1)) {
    const p = by.get(d), before = !first || d < first || d < from;
    const s = !!p;
    if (!before) { all++; if (s) studied++; }
    days.push({ day: d, min: p ? p.min : 0, studied: s, step: step(p ? p.min : 0, s), before });
  }
  return { days, studied, total: all, first };
}

/**
 * Study days a week on average over the last n full weeks (the week of today left out), or null with fewer weeks of log.
 * @param {Point[]} ps @param {string} today @param {number} n
 */
export function daysPerWeek(ps, today, n) {
  const end = D8.add(monday(today), -1), start = D8.add(monday(today), -7 * n);
  if (!ps.length || ps[0].day > start) return null;
  return Math.round((ps.filter(p => p.day >= start && p.day <= end).length / n) * 10) / 10;
}

/* ---------- milestones ---------- */

const KNOWN_STEPS = [100, 250, 500, 1000, 1500, 2000, 2500, 3000, 4000, 5000, 6000, 7500, 10000, 12500, 15000];
const HOUR_STEPS = [10, 25, 50, 100, 150, 200, 300, 400, 500, 750, 1000];

/**
 * @typedef {object} Milestone
 * @property {string} id
 * @property {string} key      the i18n key of its text (pg.ms.*)
 * @property {Record<string, string | number>} vars
 * @property {string | null} on    the first day it held, on an exact day (null: not reached, or only on estimated days)
 * @property {'exact' | 'estimated' | 'igloo' | null} how   estimated: first held on a day whose counts are estimated,
 *   so it is not dated; igloo: reached on the day Igloo's results came in
 * @property {number} have @property {number} need   how far along (now)
 */

/**
 * Milestones, from the whole log. A count first reached on an estimated day is listed as reached, undated. A count can
 * fall again (recall decays); the date stays.
 * @param {Point[]} ps @returns {Milestone[]}
 */
export function milestones(ps) {
  if (!ps.length) return [];
  const last = ps[ps.length - 1];
  /** @type {{id: string, key: string, vars: Record<string, string | number>, need: number, value: (p: Point, h: number) => number}[]} */
  const defs = [];
  const maxOf = Math.max(...ps.map(p => p.of));
  for (const n of KNOWN_STEPS) if (n <= maxOf) defs.push({ id: `known-${n}`, key: 'pg.ms.known', vars: { n }, need: n, value: p => p.known });
  LEVELS.forEach((L, i) => {
    const n = last.ln[i];
    if (n < 20) return;
    defs.push({ id: `level-${L}-50`, key: 'pg.ms.levelHalf', vars: { level: L, n }, need: Math.ceil(n * 0.5), value: p => p.lk[i] });
    defs.push({ id: `level-${L}-90`, key: 'pg.ms.level90', vars: { level: L, n }, need: Math.ceil(n * 0.9), value: p => p.lk[i] });
    if (i >= 2) defs.push({ id: `grammar-${L}`, key: 'pg.ms.firstGrammar', vars: { level: L }, need: 1, value: p => p.lg[i] });
  });
  for (const n of HOUR_STEPS) defs.push({ id: `hours-${n}`, key: 'pg.ms.hours', vars: { n }, need: n * 60, value: (_, h) => h });
  /** @type {Milestone[]} */ const out = [];
  for (const d of defs) {
    let minutes = 0;
    /** @type {Milestone} */ const m = { id: d.id, key: d.key, vars: d.vars, on: null, how: null, have: 0, need: d.need };
    for (const p of ps) {
      minutes += p.min;
      const v = d.value(p, minutes);
      if (v >= d.need) {
        const hours = d.id.startsWith('hours-');
        m.how = hours ? 'exact' : p.est ? 'estimated' : p.jump ? 'igloo' : 'exact';
        m.on = m.how === 'estimated' ? null : p.day;
        break;
      }
    }
    m.have = d.value(last, minutes);
    if (m.have > m.need && !m.how) m.have = m.need;
    out.push(m);
  }
  return out;
}

/**
 * The milestones to list: reached ones newest first (undated estimated ones after the dated), and the two nearest
 * not reached yet. @param {Milestone[]} all
 */
export function milestoneList(all) {
  const reached = all.filter(m => m.how).sort((a, b) => (a.on && b.on ? (a.on < b.on ? 1 : a.on > b.on ? -1 : 0) : a.on ? -1 : b.on ? 1 : 0));
  const next = all.filter(m => !m.how && m.need > 0).sort((a, b) => b.have / b.need - a.have / a.need).slice(0, 2);
  return { reached, next };
}

/* ---------- the level goal's range ---------- */

export const ETA_WEEKS = 8;
export const ETA_SHARE = 0.8;
const SAMPLES = 2000;

/**
 * When the level goal's 80% could be reached at the pace of the last 8 full weeks: the 10th and 90th percentile of a
 * bootstrap over the 8 weekly gains (exact records only). Hidden (state other than 'ok') when the log has fewer than
 * 8 full weeks of exact records, when the level's known items did not grow, or when 80% is reached.
 * @param {Point[]} ps @param {string} level 'B2' @param {string} today
 * @returns {{state: 'young', weeks: number} | {state: 'flat' | 'reached' | 'none', have: number, need: number, n: number} |
 *   {state: 'ok', have: number, need: number, n: number, pace: number, from: string, mid: string, to: string | null}}
 */
export function levelEta(ps, level, today) {
  const li = LEVELS.indexOf(level);
  const exact = ps.filter(p => !p.est);
  if (li < 0 || !exact.length) return { state: 'young', weeks: 0 };
  const last = exact[exact.length - 1];
  const n = last.ln[li], have = last.lk[li], need = Math.ceil(n * ETA_SHARE);
  if (!n) return { state: 'none', have, need, n };
  if (have >= need) return { state: 'reached', have, need, n };
  const end = D8.add(monday(today), -1);   // the Sunday of the last full week
  const ends = Array.from({ length: ETA_WEEKS + 1 }, (_, k) => D8.add(end, -7 * (ETA_WEEKS - k)));
  const firstExact = exact[0].day;
  if (ends[0] < firstExact) return { state: 'young', weeks: Math.max(0, Math.floor(D8.diff(firstExact, end) / 7)) };
  const at = (/** @type {string} */ d) => { let v = 0; for (const p of exact) { if (p.day > d) break; v = p.lk[li]; } return v; };
  const vals = ends.map(at);
  const gains = vals.slice(1).map((v, k) => v - vals[k]);
  const pace = gains.reduce((a, b) => a + b, 0) / gains.length;
  if (pace <= 0) return { state: 'flat', have, need, n };
  const r = mulberry(0x5eed + li);
  /** @type {number[]} */ const wk = [];
  for (let s = 0; s < SAMPLES; s++) {
    let sum = 0;
    for (let k = 0; k < gains.length; k++) sum += gains[Math.floor(r() * gains.length)];
    const m = sum / gains.length;
    wk.push(m > 0 ? (need - have) / m : Infinity);
  }
  wk.sort((a, b) => a - b);
  const q = (/** @type {number} */ f) => wk[Math.min(wk.length - 1, Math.floor(f * wk.length))];
  const dateIn = (/** @type {number} */ w) => (Number.isFinite(w) && w < 52 * 30 ? D8.add(today, Math.ceil(w * 7)) : null);
  const from = dateIn(q(0.1)), mid = dateIn(q(0.5));
  if (!from || !mid) return { state: 'flat', have, need, n };
  return { state: 'ok', have, need, n, pace: Math.round(pace * 10) / 10, from, mid, to: dateIn(q(0.9)) };
}

/** A seeded generator, so the range does not change between two opens of the page. @param {number} seed */
function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/* ---------- the study hours file (hours-json@1) ---------- */

/** @typedef {{repo: string, path: string, lang?: string | null}} HoursSource */

/**
 * The URL of a study hours file in a GitHub Pages site: owner/name and a path → https://owner.github.io/name/path.
 * Null for a malformed source. @param {HoursSource | null | undefined} src
 */
export function hoursUrl(src) {
  if (!src || typeof src.repo !== 'string' || typeof src.path !== 'string') return null;
  const m = /^([A-Za-z0-9-]+)\/([A-Za-z0-9_.-]+)$/.exec(src.repo.trim());
  const path = src.path.trim().replace(/^\/+/, '');
  if (!m || !path || path.split('/').some(s => s === '..' || s === '.') || /[?#\s]/.test(path)) return null;
  return `https://${m[1].toLowerCase()}.github.io/${m[2]}/${path.split('/').map(encodeURIComponent).join('/')}`;
}

/**
 * The hours of one language by day from a study hours file. Entries without a usable date or hours are left out.
 * @param {any} file {entries: [{date, hours, lang?}]} @param {string | null} lang
 * @returns {Map<string, number>} day → hours
 */
export function hoursByDay(file, lang) {
  /** @type {Map<string, number>} */ const out = new Map();
  const want = lang ? String(lang).toLowerCase() : null;
  for (const e of Array.isArray(file?.entries) ? file.entries : []) {
    if (!e || !D8.isDay(e.date)) continue;
    const h = Number(e.hours);
    if (!Number.isFinite(h) || h < 0 || h > 24) continue;
    if (want && e.lang != null && String(e.lang).toLowerCase() !== want) continue;
    out.set(e.date, (out.get(e.date) || 0) + h);
  }
  return out;
}

/**
 * The file's hours by week over the same weeks as the app's minutes (minutes, to compare scales; never summed with them).
 * @param {Map<string, number>} byDay @param {string} from @param {string} today
 * @returns {{mon: string, sun: string, partial: boolean, min: number, days: number}[]}
 */
export function hoursWeeks(byDay, from, today) {
  /** @type {{mon: string, sun: string, partial: boolean, min: number, days: number}[]} */ const out = [];
  for (let mon = monday(from); mon <= monday(today); mon = D8.add(mon, 7)) {
    const sun = D8.add(mon, 6);
    let min = 0, days = 0;
    for (let d = mon; d <= sun; d = D8.add(d, 1)) { const hh = byDay.get(d); if (hh) { min += hh * 60; days++; } }
    out.push({ mon, sun, partial: today <= sun, min: Math.round(min), days });
  }
  return out;
}

/** The average of the last n full weeks (the week of today left out), in minutes; null with fewer weeks. @param {{min: number, partial: boolean}[]} ws @param {number} n */
export function weeklyAverage(ws, n) {
  const full = ws.filter(w => !w.partial);
  if (full.length < n) return null;
  return Math.round(full.slice(-n).reduce((s, w) => s + w.min, 0) / n);
}

/** Map releases inside the log: the days the pool changed size, with the change. @param {Point[]} ps */
export function poolChanges(ps) {
  /** @type {{day: string, delta: number}[]} */ const out = [];
  for (let i = 1; i < ps.length; i++) if (ps[i].of !== ps[i - 1].of && ps[i].atlas !== ps[i - 1].atlas) out.push({ day: ps[i].day, delta: ps[i].of - ps[i - 1].of });
  return out;
}
