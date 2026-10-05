/* Leaving shadow mode while keeping the preview's work (docs/CUTOVER.md, "Preview profiles are kept").

   A device that opened the live preview has a shadow profile with real study work in it: exam modules, recordings,
   corrections, reviews. On the first boot with deployShadow: false, data/session.js runs keepPreview():

     1. start     the real (local) profile is kept, or made and filled by the one-time legacy import (read-only on the
                  legacy keys). Device prefs and keys are merged, not overwritten (deviceMerge below).
     2. imported  each preview profile is merged into it (planPreviewMerge, pure), written, and read back.
     3. merged    only after the read-back matched, the preview is archived (archivedAt, archivedInto), never deleted
                  at once. purgeArchived() removes it 30 days later.

   The step is recorded on the device record (device.cutover) before anything is written, so a boot that was cut off
   resumes where it stopped, and every write is a put of a merged value, so running a step twice changes nothing.

   Merge rules (newest per item, in both directions, since the old apps may have been used during the preview too):
     cards        per id, the record whose last review is newer wins (u, else last); the review logs (hist) are united
     attempts     by id; a preview copy of an old-app attempt (legacy.id) defers to the fresh import of that attempt
     events       the preview outbox is united by id with its original id, time, seq and file path, unsent
     settings     per field by rev; a field the legacy import stamped goes to the preview unless the old app changed
                  that legacy key since the preview read it (meta.fingerprint)
     collections  by id or key; on a conflict the newer record wins, and on a tie the preview's for its own work, the
                  import's for records copied from the old apps; a "sent" flag is never undone
     caches       (exams.remote, exams.syncStatus, exams.vocabAudio, words.exam) are not merged; the next sync refills them */
import { fnv1a } from './ids.js';
import { mergeSettings, normalizeSettings, defaultPrefs, adoptMirror } from './settings.js';
import { pathFor, attemptFile, TYPES } from './sync/github-b1exam.js';

/** Days an archived preview profile is kept before it is purged. */
export const ARCHIVE_DAYS = 30;

/** Collections that are caches of the results repository: refilled by the next sync, never merged. */
const CACHES = new Set(['exams.remote', 'exams.syncStatus', 'exams.vocabAudio', 'words.exam']);
/** ui flags that record the learner's consent on this profile: never carried over from the preview. */
const CONSENT = new Set(['importSeen', 'sendLegacy', 'previewSeen']);
/** Settings fields the legacy import stamps, and the legacy keys they come from. */
const MIGRATED_FIELDS = /** @type {Record<string, string[]>} */ ({ 'exam.date': ['examDate'], language: [], level: [], 'exam.type': [], onboarded: [] });
/** b1.session fields copied from a legacy key. */
const SESSION_KEYS = /** @type {Record<string, string>} */ ({
  variants: 'doors.b1.variants.v1', cal: 'doors.b1.cal.v1', teil2: 'doors.b1.teil2.v1', seeded: 'doors.b1.seeded', firstRun: 'doors.b1.firstRun',
});

/** Stable JSON (sorted keys), for comparing records. @param {any} v @returns {string} */
export function canon(v) {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`;
  return JSON.stringify(v) ?? 'null';
}
const same = (/** @type {any} */ a, /** @type {any} */ b) => canon(a) === canon(b);

/** ms of an ISO time or a ms number; 0 when unknown. @param {any} v */
const ms = v => (typeof v === 'number' && Number.isFinite(v) ? v : (typeof v === 'string' && Date.parse(v)) || 0);

/**
 * Whether the old apps changed a legacy key after the preview read it. Without a fingerprint (the preview started
 * from nothing) the preview counts as newer.
 * @param {Record<string, string> | null | undefined} fp the preview's meta.fingerprint
 * @param {Record<string, string>} snap the legacy keys now
 * @returns {(key: string) => boolean}
 */
export function legacyChangedSince(fp, snap) {
  return key => {
    if (!fp) return false;
    if (key in fp) return !(key in snap) || fnv1a(snap[key]) !== fp[key];
    return key in snap;
  };
}

/* ---------- cards ---------- */

/** When a card was last reviewed: u (ms of the last write), else its last review day. @param {any} r */
const cardTime = r => (r && Number.isFinite(r.u) ? r.u : r && typeof r.last === 'string' ? Date.parse(r.last) || 0 : 0);

/**
 * The newer record of a card, with both review logs united (dated entries, oldest first, the last 12 the app keeps).
 * @param {any} real @param {any} prev @returns {{rec: any, previewWon: boolean}}
 */
export function mergeCard(real, prev) {
  if (!real) return { rec: prev, previewWon: true };
  if (!prev) return { rec: real, previewWon: false };
  const previewWon = cardTime(prev) > cardTime(real);
  const win = previewWon ? prev : real, lose = previewWon ? real : prev;
  const have = new Set((win.hist || []).map(canon));
  const extra = (lose.hist || []).filter((/** @type {any} */ h) => !have.has(canon(h)));
  if (!extra.length) return { rec: win, previewWon };
  // the loser's entries first, so on the same day the winner's stay last (the app reads the last one)
  const hist = [...extra, ...(win.hist || [])].map((h, i) => ({ h, i })).sort((a, b) => String(a.h[0]).localeCompare(String(b.h[0])) || a.i - b.i).map(x => x.h).slice(-12);
  return { rec: { ...win, hist }, previewWon };
}

/* ---------- records with ids ---------- */

/** Last change of a collection record. @param {any} r */
const recTime = r => Math.max(ms(r?.updated_at), ms(r?.updatedAt), ms(r?.deletedAt), ms(r?.created_at), ms(r?.createdAt), ms(r?.at));

/**
 * One record on both sides: the newer one, or on a tie the preferred side; a record the old app already sent
 * stays sent (with its file path), so nothing is sent twice under another name.
 * @param {any} r @param {any} p @param {boolean} tiePreview
 */
function pick(r, p, tiePreview) {
  if (r == null) return p;
  if (p == null || same(r, p)) return r;
  const tr = recTime(r), tp = recTime(p);
  let out = tp > tr || (tp === tr && tiePreview) ? p : r;
  if (typeof r === 'object' && typeof p === 'object' && (r.synced === true || p.synced === true) && out.synced !== true) {
    const sent = r.synced === true ? r : p;
    out = { ...out, synced: true, ...(sent._path ? { _path: sent._path } : {}) };
  }
  return out;
}

/**
 * Unite two lists by a key. The real list's order is kept; preview-only records follow in their order.
 * @param {any[]} real @param {any[]} prev @param {(x: any) => string} key @param {(x: any) => boolean} tiePreview
 */
function uniteList(real, prev, key, tiePreview) {
  const out = (Array.isArray(real) ? real : []).slice();
  const at = new Map(out.map((x, i) => [x && key(x), i]));
  for (const p of Array.isArray(prev) ? prev : []) {
    if (!p) continue;
    const k = key(p), i = at.get(k);
    if (i == null) { at.set(k, out.length); out.push(p); } else out[i] = pick(out[i], p, tiePreview(p));
  }
  return out;
}

/** Unite two maps by key. @param {any} real @param {any} prev @param {(k: string, r: any, p: any) => any} choose */
function uniteMap(real, prev, choose) {
  /** @type {Record<string, any>} */ const out = { ...(real && typeof real === 'object' ? real : {}) };
  for (const [k, p] of Object.entries(prev && typeof prev === 'object' ? prev : {})) out[k] = k in out ? choose(k, out[k], p) : p;
  return out;
}

/* ---------- the preview summary ---------- */

/**
 * What the preview holds that was made in it (not copied from the old apps): the notice counts these.
 * @param {{attempts: any[], outbox: any[], kv: Record<string, any>}} preview
 */
export function previewCounts(preview) {
  const ev = (/** @type {string} */ type) => preview.outbox.filter(e => e && e.type === type).length;
  return {
    modules: preview.attempts.filter(a => a && !a.legacy && !a.deletedAt).length,
    recordings: ev('exam.voice'),
    corrections: ev('feedback.created'),
    reviews: ev('card.reviewed'),
    mistakes: Object.values(preview.kv.mistakes || {}).filter((/** @type {any} */ m) => m && !m.deletedAt).length,
    cards: 0,
    toSend: preview.outbox.filter(e => e && TYPES.has(e.type) && e.path && !e.synced).length,
  };
}

/* ---------- the plan ---------- */

/**
 * @typedef {{cards: Record<string, Record<string, any>>, attempts: any[], outbox: any[], kv: Record<string, any>}} ProfileData
 */

/**
 * Merge one preview profile into the real one. Pure: returns only what changes, and the summary.
 * @param {object} o
 * @param {ProfileData} o.real
 * @param {ProfileData} o.preview
 * @param {string} o.realId
 * @param {(key: string) => boolean} o.legacyChanged  legacyChangedSince(preview meta.fingerprint, legacy keys now)
 * @param {string | null} o.migrationStamp  the rev the legacy import gave its settings fields, or null
 * @param {() => number} o.nextSeq  a new device seq for an event the preview never queued
 * @returns {{cards: Record<string, [string, any][]>, attempts: any[], events: any[], kv: Record<string, any>, counts: ReturnType<typeof previewCounts>}}
 */
export function planPreviewMerge({ real, preview, realId, legacyChanged, migrationStamp, nextSeq }) {
  const counts = previewCounts(preview);

  // ---- cards ----
  /** @type {Record<string, [string, any][]>} */ const cards = {};
  for (const [deck, recs] of Object.entries(preview.cards || {})) {
    const cur = real.cards[deck] || {};
    for (const [id, p] of Object.entries(recs || {})) {
      if (!p || typeof p !== 'object') continue;
      const { rec, previewWon } = mergeCard(cur[id], p);
      if (previewWon && cur[id]) counts.cards++;
      if (!same(rec, cur[id])) (cards[deck] ||= []).push([id, rec]);
    }
  }

  // ---- attempts ----
  const realById = new Map(real.attempts.map(a => [a.id, a]));
  const realLegacy = new Set(real.attempts.filter(a => a && a.legacy && a.legacy.id != null).map(a => String(a.legacy.id)));
  /** @type {any[]} */ const attempts = [];
  for (const p of preview.attempts) {
    if (!p || !p.id) continue;
    const r = realById.get(p.id);
    if (!r && p.legacy && p.legacy.id != null && realLegacy.has(String(p.legacy.id))) continue;   // the import has it, fresher
    const next = { ...pick(r, p, !p.legacy), profileId: realId };
    if (!same(next, r)) attempts.push(next);
  }

  // ---- events: the preview outbox with its ids, times, seqs and paths; unsent ----
  const realEvents = new Set(real.outbox.map(e => e.id));
  const prevEvents = new Set(preview.outbox.map(e => e.id));
  /** @type {any[]} */ const events = [];
  for (const e of [...preview.outbox].sort((a, b) => (a.seq || 0) - (b.seq || 0))) {
    if (!e || !e.id || realEvents.has(e.id)) continue;
    events.push({ ...e, profileId: realId });
  }
  // a record made in the preview whose event is missing gets one, at its own time, under a fixed id
  for (const a of preview.attempts) {
    if (!a || a.legacy || a.deletedAt || a.synced === true || (a.eventId && prevEvents.has(a.eventId))) continue;
    const id = `cutover-attempt-${a.id}`;
    if (realEvents.has(id) || events.some(e => e.id === id)) continue;
    const at = ms(a.submitted_at) || ms(a.createdAt);
    const file = attemptFile(a);
    events.push({ id, v: 1, profileId: realId, deviceId: a.deviceId || null, seq: nextSeq(), at: a.submitted_at || a.createdAt, day: String(a.submitted_at || '').slice(0, 10),
      type: 'exam.attempt', payload: { attemptId: a.id, file }, synced: false, path: a.path || pathFor('exam.attempt', { file }, at) });
  }
  for (const f of Array.isArray(preview.kv['exams.feedbackLocal']) ? preview.kv['exams.feedbackLocal'] : []) {
    if (!f || 'synced' in f || !f.eventId || prevEvents.has(f.eventId)) continue;   // 'synced' marks one from the old app
    const id = `cutover-fb-${f.id}`;
    if (realEvents.has(id) || events.some(e => e.id === id)) continue;
    const payload = { day: f.day, module: f.module, attempt_id: f.attempt_id, attempt_file: f.attempt_file, body: f.body, created_at: f.created_at, model: f.model ?? null };
    events.push({ id, v: 1, profileId: realId, deviceId: null, seq: nextSeq(), at: f.created_at, day: String(f.created_at || '').slice(0, 10),
      type: 'feedback.created', payload, synced: false, path: pathFor('feedback.created', payload, ms(f.created_at)) });
  }
  counts.toSend += events.filter(e => String(e.id).startsWith('cutover-')).length;

  // ---- key-value collections ----
  /** @type {Record<string, any>} */ const kv = {};
  const put = (/** @type {string} */ name, /** @type {any} */ value) => { if (!same(value, real.kv[name])) kv[name] = value; };
  for (const [name, p] of Object.entries(preview.kv)) {
    if (CACHES.has(name) || p === undefined) continue;
    const r = real.kv[name];
    switch (name) {
      case 'settings': put(name, mergeSettingsFromPreview(r, p, legacyChanged, migrationStamp)); break;
      case 'meta': break;   // the preview's own import record stays with it; the summary is added by the caller
      case 'ui': {
        const keep = Object.fromEntries(Object.entries(p || {}).filter(([k]) => !CONSENT.has(k)));
        put(name, { ...(r || {}), ...keep, ...Object.fromEntries(Object.entries(r || {}).filter(([k]) => CONSENT.has(k))) });
        break;
      }
      case 'activity': put(name, uniteMap(r, p, (_, x, y) => ({ ...x, ...y, minutes: Math.max(x?.minutes || 0, y?.minutes || 0), rounds: Math.max(x?.rounds || 0, y?.rounds || 0) }))); break;
      case 'b1.session': put(name, mergeSession(r, p, legacyChanged)); break;
      case 'exams.drafts': put(name, mergeDrafts(r, p, legacyChanged)); break;
      case 'exams.training': put(name, uniteMap(r, p, (k, x, y) => (same(x, y) ? x : legacyChanged(`training:${k}`) ? x : y))); break;
      case 'exams.seen': put(name, [...new Set([...(Array.isArray(r) ? r : []), ...(Array.isArray(p) ? p : [])])]); break;
      case 'exams.voice': put(name, uniteList(r, p, x => String(x.id), () => false)); break;
      case 'exams.feedbackLocal': put(name, uniteList(r, p, x => String(x.id), x => !('synced' in x))); break;
      case 'vocab.local': put(name, uniteList(r, p, x => String(x.id), () => false)); break;
      case 'vocab.events': put(name, uniteList(r, p, x => `${x.day}|${x.word}|${x.at}`, () => false)); break;
      case 'mistakes': put(name, uniteMap(r, p, (_, x, y) => pick(x, y, true))); break;
      case 'exams.takeInProgress': if (r == null && p != null) put(name, p); break;
      case 'exams.learnerNotes': if (typeof p === 'string' && p.trim()) put(name, p); break;
      default: if (r === undefined) put(name, p);   // anything else: filled when the real profile has none
    }
  }
  return { cards, attempts, events, kv, counts };
}

/**
 * Settings: per field by rev; a field the legacy import stamped goes to the preview's value unless the old app
 * changed its key since the preview read it.
 * @param {any} real @param {any} prev @param {(key: string) => boolean} legacyChanged @param {string | null} stamp
 */
export function mergeSettingsFromPreview(real, prev, legacyChanged, stamp) {
  if (real == null) return prev;
  const out = mergeSettings(real, prev);
  const r = normalizeSettings(real), p = normalizeSettings(prev);
  const get = (/** @type {any} */ o, /** @type {string} */ path) => path.split('.').reduce((/** @type {any} */ x, k) => (x == null ? x : x[k]), o);
  const set = (/** @type {string} */ path, /** @type {any} */ val, /** @type {string} */ rev) => {
    if (path === 'exam.date') out.exam = { ...out.exam, date: val }; else if (path === 'exam.type') out.exam = { ...out.exam, type: val }; else out[path] = val;
    out.rev[path] = rev;
  };
  for (const [path, keys] of Object.entries(MIGRATED_FIELDS)) {
    if (!stamp || r.rev[path] !== stamp) continue;   // not from this import: the rev decided above
    // the old app changed that key after the preview read it: the import is newer; else the preview's value stands
    if (keys.some(k => legacyChanged(k))) set(path, get(r, path), r.rev[path]);
    else if (p.rev[path]) set(path, get(p, path), p.rev[path]);
  }
  return adoptMirror(out);   // the course takes the fields decided above (data/settings.js, round 3 courses)
}

/** b1.session: day logs united by day, the active rounds by start time, legacy-fed fields by the fingerprint. @param {any} real @param {any} prev @param {(key: string) => boolean} legacyChanged */
function mergeSession(real, prev, legacyChanged) {
  if (real == null) return prev;
  if (prev == null) return real;
  const out = { ...real };
  const more = (/** @type {any} */ x, /** @type {any} */ y) => (!x ? y : !y ? x : (y.rounds || 0) >= (x.rounds || 0) ? y : x);
  // the history of days (plus a "today" log that is older than the other side's today)
  /** @type {Map<string, any>} */ const days = new Map();
  for (const d of [...(real.days || []), ...(prev.days || [])]) if (d && d.day) days.set(d.day, more(days.get(d.day), d));
  let day = real.day;
  if (prev.day && prev.day.day) {
    if (!day || !day.day || prev.day.day > day.day) { if (day && day.day) days.set(day.day, more(days.get(day.day), day)); day = prev.day; }
    else if (prev.day.day === day.day) day = more(day, prev.day);
    else days.set(prev.day.day, more(days.get(prev.day.day), prev.day));
  }
  if (day && day.day) days.delete(day.day);
  out.day = day;
  out.days = [...days.values()].sort((a, b) => String(a.day).localeCompare(String(b.day))).slice(-40);
  const later = (/** @type {any} */ x, /** @type {any} */ y) => (!x ? y : !y ? x : (y.startedAt || 0) >= (x.startedAt || 0) ? y : x);
  if ('round' in prev) out.round = later(real.round, prev.round);
  if (prev.rounds) out.rounds = uniteMap(real.rounds, prev.rounds, (_, x, y) => later(x, y));
  for (const [k, legacyKey] of Object.entries(SESSION_KEYS)) if (k in prev && !(k in real && legacyChanged(legacyKey))) out[k] = prev[k];
  for (const k of Object.keys(prev)) if (!(k in out)) out[k] = prev[k];
  return out;
}

/** When a draft was last worked on (its clock). @param {any} d */
const draftTime = d => Math.max(ms(d?.start ?? d?.prepStart), ms(d?.seen ?? d?.['prep:seen']), ms((d?.pause ?? d?.['prep:pause'])?.pausedAt));

/** exams.drafts: per module the newer draft; play counts per recording, the higher. @param {any} real @param {any} prev @param {(key: string) => boolean} legacyChanged */
function mergeDrafts(real, prev, legacyChanged) {
  return uniteMap(real, prev, (k, x, y) => {
    if (same(x, y)) return x;
    if (k.startsWith('plays:')) return uniteMap(x, y, (_, a, b) => ({ ...a, ...b, used: Math.max(a?.used || 0, b?.used || 0) }));
    const tx = draftTime(x), ty = draftTime(y);
    if (tx !== ty) return ty > tx ? y : x;
    return legacyChanged(`draft:${k}`) ? x : y;
  });
}

/* ---------- device prefs and keys ---------- */

/**
 * Device prefs and keys after the legacy import: what this device has stays (the preview may have changed the theme
 * or linked the device) unless the old app changed that legacy key since the preview read it.
 * @param {{prefs: any, secrets: any}} cur @param {{prefs: any, secrets: any}} plan @param {(key: string) => boolean} legacyChanged
 */
export function deviceMerge(cur, plan, legacyChanged) {
  const prefs = cur.prefs ? { ...defaultPrefs(), ...cur.prefs } : plan.prefs;
  if (cur.prefs && legacyChanged('doors.prefs.v2') && plan.prefs.theme !== defaultPrefs().theme) prefs.theme = plan.prefs.theme;
  const s = cur.secrets || {}, l = plan.secrets || {};
  const keep = (/** @type {string} */ f, /** @type {string[]} */ keys) => (s[f] && !keys.some(k => legacyChanged(k)) ? s[f] : l[f] || s[f] || null);
  return { prefs, secrets: { ...s, anthropicKey: keep('anthropicKey', ['anthropic:key', 'doors.apikey']), githubToken: keep('githubToken', ['gh:token']) } };
}

/* ---------- archive ---------- */

/**
 * Purge preview profiles archived more than ARCHIVE_DAYS ago. A recording is deleted only when no other profile
 * still points at it (the merged events share the preview's blobs).
 * @param {any} adapter @param {any[]} profiles @param {Date} now @returns {Promise<any[]>} the profiles left
 */
export async function purgeArchived(adapter, profiles, now) {
  const old = profiles.filter(p => p.archivedAt && now.getTime() - ms(p.archivedAt) > ARCHIVE_DAYS * 864e5);
  if (!old.length) return profiles;
  const left = profiles.filter(p => !old.includes(p));
  /** @type {Set<string>} */ const used = new Set();
  for (const p of left) {
    const { outbox } = await adapter.loadProfile(p.id);
    for (const e of outbox) if (e && e.type === 'exam.voice') used.add(e.payload?.blobRef || e.id);
    const take = (await adapter.loadScope(p.id))['exams.takeInProgress'];
    if (take?.id) used.add(`take:${take.id}`);
  }
  for (const p of old) {
    const { outbox } = await adapter.loadProfile(p.id);
    for (const e of outbox) {
      const b = e && e.type === 'exam.voice' ? e.payload?.blobRef || e.id : null;
      if (b && !used.has(b)) await adapter.deleteBlob(b).catch(() => {});
    }
    await adapter.deleteProfile(p.id);
  }
  return left;
}

/**
 * The one-line notice part for the preview: "Kept from the preview: 2 exam modules, 1 recording, 64 reviews."
 * @param {ReturnType<typeof previewCounts>} c
 * @param {((key: string, vars?: Record<string, any>) => string) & {list?: (items: string[]) => string}} t
 */
export function previewText(c, t) {
  const parts = [];
  if (c.modules) parts.push(t('preview.kept.modules', { n: c.modules }));
  if (c.recordings) parts.push(t('preview.kept.recordings', { n: c.recordings }));
  if (c.corrections) parts.push(t('preview.kept.corrections', { n: c.corrections }));
  if (c.reviews) parts.push(t('preview.kept.reviews', { n: c.reviews }));
  if (c.mistakes) parts.push(t('preview.kept.mistakes', { n: c.mistakes }));
  if (!parts.length) parts.push(t('preview.kept.settings'));
  return t('preview.kept', { list: t.list ? t.list(parts) : parts.join(', ') });
}
