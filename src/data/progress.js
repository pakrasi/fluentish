/* The progress log's writer (round 4, phase 0): one record per study day per course, in kv
   'progress.<course>.<YYYY-MM>' (domain/progress.js holds the format and every rule; docs/SCHEMA.md › Progress log).

   When it writes:
     today        recordToday(): when the app opens, and 20 s after study (activity or cards changed); src 'live'
     missed days  catchUp(): when the app opens and when a new study day starts, every study day of the last
                  CATCH_UP_DAYS whose record is missing or was written before the day ended is computed again from
                  the cards and this device's learning events (domain/progress.js cardsAt), marked fin
     the past     backfill(): once per device, from the first day any card was answered to yesterday. With the
                  progress backup readable (a linked device; his token stays in the app), every snapshot of every
                  device and every event file are read through data/restore.js, so each day from the first snapshot
                  on is exact; days before it are rebuilt from the events here and the cards' answer history and are
                  flagged `estimated`. Igloo's placement results count from the day they were imported (kv
                  'known'.placement), which carries the labelled jump. Running it again changes nothing; the device
                  kv 'progress.device' records that it ran ({profileId, at, from, exactFrom, withBackup, days,
                  estimated}); it runs once more when the backup becomes readable after a run without it.
   The counts use domain/knowledge.js, the definition Where you stand and the map use, over the course's pool: the
   map's items for a language with a map (atlas.<lang>), else its course file's phrases and its word list. */
import { knowledge, conceptItems } from '../domain/knowledge.js';
import { LEGACY_DECKS, LEGACY_DECK_LANG, decksOf } from '../domain/decks.js';
import { KINDS as ATLAS_KINDS, LEVELS as ATLAS_LEVELS } from '../domain/atlas.js';
import * as P from '../domain/progress.js';
import { minutesFor, devices } from '../domain/activity.js';
import * as D8 from '../domain/days.js';
import { itemMaps, legacy, evidenceOf } from './knowledge.js';
import { normalizeSettings, langIdOf } from './settings.js';
import { fnv1a } from './ids.js';
import * as B from './sync/backup.js';
import * as R from './restore.js';

/** Device-scope kv with the backfill's record (store.js DEVICE_SCOPE): never exported or uploaded. */
export const DEVICE_KV = 'progress.device';
export const CATCH_UP_DAYS = 60;
export const AFTER_STUDY_MS = 20e3;

/** @typedef {{store: any, content: {load: (id: string) => Promise<any>, manifest: () => Promise<any>}, clock: {today: () => string}}} Ctx */
/** @typedef {{pool: P.PoolItem[], atlas: string | null, concepts: boolean}} Pool */

const isoNow = () => new Date().toISOString();

/** The courses of the profile. @param {any} store */
const coursesOf = store => /** @type {{id: string, lang: string}[]} */ (normalizeSettings(store.get('settings')).courses || []);

/** The decks of a course, with their cards. @param {any} store @param {{lang: string}} course */
export function courseDecks(store, course) {
  const named = Object.keys(store.cardsByDeck || {}).filter(d => d.includes(':') && !LEGACY_DECKS.includes(d));
  /** @type {Record<string, Record<string, any>>} */ const out = {};
  for (const d of decksOf([...LEGACY_DECKS, ...named.sort()], course)) out[d] = store.cards(d) || {};
  return out;
}
/** @param {{lang: string}} course @returns {(deck: string) => boolean} */
const keepFor = course => { const ds = new Set(decksOf([...LEGACY_DECKS], course)); return deck => typeof deck === 'string' && (ds.has(deck) || deck.startsWith(`${course.lang}:`)); };

/** @type {Map<string, Promise<Pool>>} */ const pools = new Map();

/**
 * A course's pool: the map's items (words, phrases, grammar concepts with their levels) when the language has a map,
 * else its course phrases and word list. atlas: a hash of the files it came from.
 * @param {Ctx} ctx @param {{lang: string}} course @returns {Promise<Pool>}
 */
export function poolOf(ctx, course) {
  const lang = course.lang;
  let p = pools.get(lang);
  if (!p) {
    p = ctx.content.manifest().then(async (/** @type {any} */ m) => {
      const entry = (/** @type {string} */ id) => (m.files || []).find((/** @type {any} */ f) => f.id === id) || null;
      const map = entry(`atlas.${lang}`);
      if (map) {
        const I = (await ctx.content.load(map.id)).items;
        /** @type {P.PoolItem[]} */ const pool = I.id.map((/** @type {string} */ id, /** @type {number} */ i) => {
          const k = ATLAS_KINDS[I.k[i]];
          return { id, kind: /** @type {P.Kind} */ (k === 'c' ? 'p' : k === 'g' ? 'g' : 'w'), level: ATLAS_LEVELS[I.L[i]] || '' };
        });
        return { pool, atlas: String(map.sha256).slice(0, 8), concepts: true };
      }
      const cf = entry(`course.${lang}`), wf = entry(`igloo.words.${lang}`);
      const [cfile, words] = await Promise.all([cf ? ctx.content.load(cf.id) : null, wf ? ctx.content.load(wf.id) : null]);
      /** @type {P.PoolItem[]} */ const pool = [];
      for (const [cid, ph] of Object.entries((cfile && cfile.phrases) || {})) pool.push({ id: `${lang}:K:${cid}`, kind: 'p', level: /** @type {any} */ (ph).level || '' });
      for (const w of words || []) pool.push({ id: `${lang}:W:${w.id}`, kind: 'w', level: w.level || '' });
      return { pool, atlas: cf || wf ? fnv1a(`${cf ? cf.sha256 : ''}|${wf ? wf.sha256 : ''}`) : null, concepts: false };
    });
    p.catch(() => pools.delete(lang));
    pools.set(lang, p);
  }
  return p;
}

/**
 * What deciding which days to count reads: the store only, no content (lane P2: a profile with nothing to count loads
 * no content and reads no events).
 * @param {any} store
 */
function basics(store) {
  const meta = store.get('meta', {}) || {};
  const migrated = !!meta.migratedAt;
  const placement = (store.get('known', {}) || {}).placement || null;
  // Igloo's results join the picture on the day they were imported (the placement), else the migration's day
  const jumpDay = migrated ? (D8.isDay(placement) ? placement : typeof meta.migratedAt === 'string' && D8.isDay(meta.migratedAt.slice(0, 10)) ? meta.migratedAt.slice(0, 10) : null) : null;
  return { migrated, jumpDay, activity: /** @type {Record<string, any>} */ (store.get('activity', {}) || {}), legacyLang: LEGACY_DECK_LANG.b1, deviceId: /** @type {string} */ (store.device.deviceId) };
}
/** @typedef {ReturnType<typeof basics>} Basics */

/**
 * What the counts read besides the cards, once a run, only when a day is counted: the basics plus the item maps
 * (content), the exam words, the legacy results and the evidence without a card.
 * @param {Ctx} ctx @param {Basics} [base]
 */
async function environment(ctx, base = basics(ctx.store)) {
  const store = ctx.store;
  const maps = await itemMaps(/** @type {any} */ (ctx.content));
  const wc = store.get('words.exam', null);
  const examWords = wc && Array.isArray(wc.words) ? wc.words.map((/** @type {any} */ w) => maps.resolve(w.id, 'b1')).filter(Boolean) : [];
  return { ...base, maps, know: base.migrated ? legacy('doors.know.v1') : {}, srs: base.migrated ? legacy('doors.srs.v1') : {}, examWords,
    evidence: /** @type {Record<string, Record<string, any>>} */ (evidenceOf(store)) };
}
/** @typedef {Awaited<ReturnType<typeof environment>>} Env */

/** The environment loaded on first use and shared after. @param {Ctx} ctx @param {Basics} base @returns {() => Promise<Env>} */
const lazyEnv = (ctx, base) => { /** @type {Promise<Env> | null} */ let p = null; return () => (p ||= environment(ctx, base)); };

/**
 * Count one day: the pool's states from the cards as they were at its end.
 * @param {Env} env @param {Pool} pool @param {{id: string, lang: string}} course @param {string} day
 * @param {Record<string, Record<string, any>>} decks @param {boolean} igloo  Igloo's legacy results count
 */
function states(env, pool, course, day, decks, igloo) {
  // evidence without a card (Look up views, and any origin data/knowledge.js EVIDENCE_KV lists) as it was that day
  /** @type {Record<string, Record<string, any>>} */ const evidence = {};
  for (const [o, m] of Object.entries(env.evidence)) {
    evidence[o] = {};
    for (const [id, v] of Object.entries(m || {})) if (v && v.first && v.first <= day) evidence[o][id] = v;
  }
  const k = knowledge({ today: day, epoch: P.epochOf(day), decks, resolve: env.maps.resolve, know: igloo ? env.know : {}, srs: igloo ? env.srs : {},
    lang: langIdOf(course.lang) || 'german', itemLang: course.lang, examWords: env.examWords, evidence });
  const concepts = /** @type {Record<string, string[]>} */ (env.maps.concepts || {});
  return (/** @type {P.PoolItem} */ it) => (pool.concepts && it.kind === 'g' ? k.concept(it.id.slice(3), concepts[it.id.slice(3)] || []).state : k.get(it.id).state);
}

/**
 * The record of one day of one course, from that day's cards.
 * @param {Env} env @param {Pool} pool @param {{id: string, lang: string}} course @param {string} day
 * @param {Record<string, Record<string, any>>} decks @param {{src: 'live' | 'replay', fin: boolean, estimated?: number}} o
 */
export function computeDay(env, pool, course, day, decks, o) {
  const igloo = !!env.jumpDay && day >= env.jumpDay;
  const stateOf = states(env, pool, course, day, decks, igloo);
  let jump = null;
  if (env.jumpDay === day) {
    // the day Igloo's results came in: what they added, counted against the same day without them
    /** @type {Record<string, Record<string, any>>} */ const without = {};
    for (const [deck, cards] of Object.entries(decks)) {
      without[deck] = Object.fromEntries(Object.entries(cards).filter(([, r]) => !(r && r.known && r.known.by === 'igloo' && !(r.hist || []).some((/** @type {any[]} */ h) => h[0] <= day))));
    }
    const before = P.countPool(pool.pool, states(env, pool, course, day, without, false));
    const after = P.countPool(pool.pool, stateOf);
    jump = { from: 'igloo', known: P.total(after.known) - P.total(before.known) };
  }
  const a = env.activity[day];
  const min = P.minutesRecord(minutesFor(a, course.lang, env.legacyLang), devices(a));
  return P.dayRecord({ day, at: isoNow(), dev: env.deviceId, src: o.src, fin: o.fin, estimatedCards: o.estimated || 0, atlas: pool.atlas, pool: pool.pool, stateOf, decks, min, jump });
}

/**
 * Write a day's record, merged with what is there (domain/progress.js mergeDay). Nothing is written when the picture
 * is the same, so running again changes nothing. @param {any} store @param {string} course @param {string} day @param {any} rec
 * @returns {boolean} written
 */
export function writeDay(store, course, day, rec) {
  const key = P.monthKey(course, day);
  const cur = store.get(key, {}) || {};
  const prev = cur[day];
  const next = prev ? P.mergeDay(prev, rec) : rec;
  if (prev && P.sameDay(prev, next)) return false;
  store.set(key, P.mergeMonth(cur, { [day]: next }));
  return true;
}

/** The days a course has a record for. @param {any} store @param {string} course */
export const recorded = (store, course) => P.records(store.kv, course);

/**
 * Whether a day was a study day for a course: minutes in its language, or a card of it answered or marked.
 * @param {Basics} env @param {{lang: string}} course @param {Record<string, Record<string, any>>} decks @param {string} day
 * @param {Set<string>} [cardDays] the days a card was answered or marked (P.studyDays({}, decks)), when known
 */
function studied(env, course, decks, day, cardDays) {
  if (minutesFor(env.activity[day], course.lang, env.legacyLang).total > 0) return true;
  return cardDays ? cardDays.has(day) : cardOn(decks, day);
}

/**
 * Whether a card was answered or marked on a day: P.studyDays({}, decks).includes(day), without parsing every answer's
 * date (lane P2: that was 220 ms of a boot at 4x CPU). @param {Record<string, Record<string, any>>} decks @param {string} day
 */
export function cardOn(decks, day) {
  if (!D8.isDay(day)) return false;
  for (const cards of Object.values(decks || {})) {
    for (const rec of Object.values(cards || {})) {
      if (!rec) continue;
      for (const h of rec.hist || []) if (h[0] === day) return true;
      if (rec.known && rec.known.on === day) return true;
    }
  }
  return false;
}

/**
 * The study days in [from, to): P.studyDays(activity, decks) filtered to the window, with only the answers inside the
 * window checked as dates (the rest are compared as strings and dropped). Sorted.
 * @param {Record<string, any>} activity @param {Record<string, Record<string, any>>} decks @param {string} from @param {string} to
 * @returns {{all: string[], cards: Set<string>}} all: the study days; cards: the days a card was answered or marked
 */
export function studyDaysIn(activity, decks, from, to) {
  const inside = (/** @type {unknown} */ d) => typeof d === 'string' && d >= from && d < to && D8.isDay(d);
  /** @type {Set<string>} */ const cards = new Set();
  for (const recs of Object.values(decks || {})) {
    for (const rec of Object.values(recs || {})) {
      if (!rec) continue;
      for (const h of rec.hist || []) if (inside(h[0])) cards.add(h[0]);
      if (rec.known && inside(rec.known.on)) cards.add(rec.known.on);
    }
  }
  /** @type {Record<string, any>} */ const act = {};
  for (const [d, a] of Object.entries(activity || {})) if (inside(d)) act[d] = a;
  return { all: [...new Set([...P.studyDays(act, {}), ...cards])].sort(), cards };
}

/** Work this long, then let the page breathe (a backfill of a year runs on the main thread). */
export const BUDGET_MS = 12;
/** A function that yields to the page once BUDGET_MS of work has passed since the last yield. */
function breather() {
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  let last = now();
  return async () => { if (now() - last >= BUDGET_MS) { await new Promise(r => setTimeout(r, 0)); last = now(); } };
}

/**
 * @typedef {{day: string, deviceId: string, load: () => Promise<{cards: any} | null>}} SnapRef  a backup snapshot,
 *   read when the walk reaches its day
 */

/**
 * Today's record of every course studied today (src live).
 * @param {Ctx} ctx @returns {Promise<number>} records written
 */
export async function recordToday(ctx) {
  const store = ctx.store, day = ctx.clock.today();
  const base = basics(store), envOf = lazyEnv(ctx, base);
  let n = 0;
  for (const course of coursesOf(store)) {
    const decks = courseDecks(store, course);
    if (!studied(base, course, decks, day)) continue;
    const env = await envOf();   // content only once a day is counted
    const pool = await poolOf(ctx, course);
    if (writeDay(store, course.id, day, computeDay(env, pool, course, day, decks, { src: 'live', fin: false }))) n++;
  }
  return n;
}

/** This device's learning events: the outbox and its archive. @param {any} store */
async function localEvents(store) {
  /** @type {Map<string, any>} */ const byId = new Map();
  for (const e of [...(await store.archived().catch(() => [])), ...store.events.values()]) if (e && e.id && B.backupable(e)) byId.set(e.id, e);
  return [...byId.values()];
}

/**
 * Rebuild days of every course from the cards, the learning events and the snapshots, and write them (fin). One walk
 * forward per course (domain/progress.js walkDays): linear in the days, each snapshot read when the walk reaches its
 * day and let go after, a pause for the page every BUDGET_MS. resume: per course, the last day already done (the
 * walk starts there from each device's newest snapshot up to it); onDay runs after each day written (the checkpoint).
 * The environment (content) is loaded only when a course has a day to count.
 * @param {Ctx} ctx @param {() => Promise<Env>} envOf
 * @param {{events: any[], snapshots: SnapRef[], days: (course: any, decks: any) => string[], resume?: Record<string, string>,
 *   onDay?: (course: {id: string}, day: string, totals: {written: number, estimated: number, first: string | null, total: number, failed: number}) => void}} src
 */
async function rebuild(ctx, envOf, { events, snapshots, days, resume = {}, onDay }) {
  const store = ctx.store;
  const breathe = breather();
  const snaps = [...snapshots].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  const totals = { written: 0, estimated: 0, first: /** @type {string | null} */ (null), total: 0, failed: 0 };
  for (const course of coursesOf(store)) {
    const decks = courseDecks(store, course), keep = keepFor(course);
    const list = days(course, decks);
    if (!list.length) continue;
    const env = await envOf();
    const pool = await poolOf(ctx, course);
    const walk = P.walkDays({ decks, events, keep, jumpDay: env.jumpDay });
    let si = 0;
    const done = resume[course.id] || null;
    /** @param {SnapRef} ref */
    const load = async ref => { const snap = await ref.load().catch(() => null); if (!snap) totals.failed++; return snap; };
    if (done) {
      // resume: the state of the last day done, from each device's newest snapshot up to it
      /** @type {Map<string, SnapRef>} */ const newest = new Map();
      for (; si < snaps.length && snaps[si].day <= done; si++) newest.set(snaps[si].deviceId, snaps[si]);
      const anchors = [];
      for (const ref of newest.values()) { const snap = await load(ref); if (snap) anchors.push(snap); }
      walk.step(done, anchors);
    }
    for (const day of list) {
      if (done && day <= done) continue;
      const anchors = [];
      for (; si < snaps.length && snaps[si].day <= day; si++) { const snap = await load(snaps[si]); if (snap) anchors.push(snap); }
      const at = walk.step(day, anchors);
      const rec = computeDay(env, pool, course, day, at.decks, { src: 'replay', fin: true, estimated: at.estimated });
      if (writeDay(store, course.id, day, rec)) totals.written++;
      if (rec.estimated) totals.estimated++;
      if (!totals.first || day < totals.first) totals.first = day;
      totals.total++;
      onDay?.(course, day, totals);
      await breathe();   // in steps, so the app stays responsive
    }
  }
  return totals;
}

/**
 * Missed days: study days of the last CATCH_UP_DAYS before today with no record, or one written before the day ended.
 * The days are worked out first, from the cards, the activity and the log; with none missing (most opens) it returns
 * before reading the event archive or any content (lane P2). With a day missing it reads the whole archive, not only
 * the window: the walk replays every earlier event, and a card answered before the window and again after the day is
 * known on that day only through its old events (a time slice would turn exact days into estimates; see
 * tests/unit/progress-io-equivalence.test.mjs).
 * @param {Ctx} ctx @returns {Promise<number>} records written
 */
export async function catchUp(ctx) {
  const store = ctx.store, today = ctx.clock.today(), from = D8.add(today, -CATCH_UP_DAYS);
  const base = basics(store);
  /** @param {{id: string, lang: string}} course @param {Record<string, Record<string, any>>} decks */
  const days = (course, decks) => {
    const have = new Map(recorded(store, course.id));
    const { all, cards } = studyDaysIn(base.activity, decks, from, today);
    return all.filter(d => !have.get(d)?.fin && studied(base, course, decks, d, cards));
  };
  if (!coursesOf(store).some(course => days(course, courseDecks(store, course)).length)) return 0;
  const events = await localEvents(store);
  const res = await rebuild(ctx, lazyEnv(ctx, base), { events, snapshots: [], days });
  return res.written;
}

/** @param {any} store */
export const deviceState = store => { const s = store.get(DEVICE_KV, null); return s && s.profileId === store.profile.id ? s : null; };

/**
 * The one-time backfill (see the header). files: the backup's files when the device is linked, else null.
 * Resumable: after each day the device record holds a checkpoint ({partial: true, cursor: {course: last day done},
 * and the counts so far}), so a closed tab or a killed app goes on from there next time instead of from the start
 * (one with the backup readable never resumes one without, which had no snapshots). The record without `partial` is
 * written when every day is done, as before.
 * @param {Ctx} ctx @param {{files?: B.Files | null, force?: boolean}} [o]
 * @returns {Promise<any>} the device record, or null when it had run already
 */
export async function backfill(ctx, { files = null, force = false } = {}) {
  const store = ctx.store, today = ctx.clock.today();
  const st = deviceState(store);
  if (!force && st && !st.partial && (st.withBackup || !files)) return null;
  let events = await localEvents(store);
  /** @type {SnapRef[]} */ let snapshots = [];
  let withBackup = false;
  if (files) {
    try {
      const devices = await R.listBackups(files);
      // the event files now; each snapshot only when the walk reaches its day (rebuild)
      const data = await R.readBackups(files, devices, { snapshots: false });
      /** @type {Map<string, any>} */ const byId = new Map(events.map(e => [e.id, e]));
      for (const e of data.events) if (e && e.id && !byId.has(e.id)) byId.set(e.id, e);
      events = [...byId.values()];
      for (const d of devices) for (const f of d.snapshots) if (D8.isDay(f.day)) snapshots.push({ day: f.day, deviceId: d.deviceId, load: () => R.readSnapshot(/** @type {B.Files} */ (files), f) });
      withBackup = !data.failed.length;
    } catch { /* offline or no access: this device's events only, and again once the backup can be read */ }
  }
  const basis = basics(store);
  const exactFrom = snapshots.map(s => s.day).sort()[0] || null;
  const resumed = !force && st && st.partial && !!st.withBackup === withBackup && st.cursor && typeof st.cursor === 'object' ? st : null;
  const base = resumed ? { estimated: Number(resumed.estimated) || 0, total: Number(resumed.days) || 0, first: resumed.from || null } : { estimated: 0, total: 0, first: null };
  const startedAt = resumed?.startedAt || isoNow();
  /** @type {Record<string, string>} */ const cursor = { ...(resumed ? resumed.cursor : {}) };
  /** @param {{estimated: number, total: number, first: string | null}} r */
  const sums = r => ({ from: [base.first, r.first].filter(Boolean).sort()[0] || null, days: base.total + r.total, estimated: base.estimated + r.estimated });
  const res = await rebuild(ctx, lazyEnv(ctx, basis), { events, snapshots, resume: cursor, days: (course, decks) => {
    const keep = keepFor(course);
    const evDays = new Set(events.filter(e => e.day && e.payload && keep(e.payload.deck)).map(e => e.day));
    const cardDays = new Set(P.studyDays({}, decks));
    const all = [...new Set([...P.studyDays(basis.activity, decks), ...evDays])].filter(d => d < today && (evDays.has(d) || studied(basis, course, decks, d, cardDays)));
    return all.sort();
  }, onDay: (course, day, totals) => {
    cursor[course.id] = day;
    store.set(DEVICE_KV, { profileId: store.profile.id, at: isoNow(), partial: true, startedAt, cursor: { ...cursor }, exactFrom, jumpDay: basis.jumpDay, withBackup, ...sums(totals) });
  } });
  // a snapshot that could not be read leaves the run without the backup (it runs again when the backup can be read)
  if (res.failed) withBackup = false;
  const rec = { profileId: store.profile.id, at: isoNow(), exactFrom, jumpDay: basis.jumpDay, withBackup, ...sums(res) };
  store.set(DEVICE_KV, rec);
  return rec;
}

/**
 * Days recorded and how many are estimates, for a course (Profile › Diagnostics).
 * @param {any} store @param {string | null} course
 */
export function summary(store, course) {
  if (!course) return { days: 0, estimated: 0 };
  const list = recorded(store, course);
  return { days: list.length, estimated: list.filter(([, r]) => r.estimated).length };
}

/** How long a failure waits before it is logged (startProgress). */
export const LOG_DELAY_MS = 1000;

/**
 * Start recording: the backfill when it has not run, the missed days, today; then today again after study and on the
 * first open of a new day. One tab at a time (Web Locks where the browser has them).
 * @param {Ctx & {bus: {on: (t: string, f: (d: any) => void) => any}, files?: () => B.Files | null, log?: (where: string, e: any) => void}} ctx
 */
export function startProgress(ctx) {
  const log = ctx.log || (() => {});
  /** @template T @param {() => Promise<T>} fn @returns {Promise<T>} */
  const locked = fn => (typeof navigator !== 'undefined' && /** @type {any} */ (navigator).locks?.request
    ? /** @type {Promise<T>} */ (/** @type {any} */ (navigator).locks.request('progress-log', fn)) : fn());
  let day = '';
  /** @type {ReturnType<typeof setTimeout> | null} */ let timer = null;
  const run = () => locked(async () => {
    if (ctx.store.profile?.kind === 'shadow' || ctx.store.deleted) return;
    if (day !== ctx.clock.today()) {
      day = ctx.clock.today();
      await backfill(ctx, { files: ctx.files ? ctx.files() : null });
      await catchUp(ctx);
    }
    await recordToday(ctx);
    // logged a moment later (LOG_DELAY_MS): a reload or a navigation while this still loads content cancels the fetch
    // ("TypeError: Load failed"), and the leaving page's timers never run, so only a failure on a page that stays is
    // logged. Nothing is lost: the next open runs it again
  }).catch(e => { setTimeout(() => log('progress', e), LOG_DELAY_MS); });
  ctx.bus.on('store:changed', ({ name } = {}) => {
    if (name !== 'activity' && !String(name || '').startsWith('cards:')) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; run(); }, AFTER_STUDY_MS);
  });
  return run();
}
