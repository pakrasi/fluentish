/* Restore from the progress backup, and the merge that keeps several devices on one schedule (roadmap item 1).

   Reads what data/sync/backup.js wrote to the results repository: every device's newest snapshot and its event files.
   The cards merge by the B4 rule (domain/cardmerge.js: join the snapshots and this device's cards, newest record
   wins; then replay the events, taking `post` when `base` matches and otherwise the newest review). The learning
   collections merge by their rule in SNAPSHOT_KV (settings per field by HLC, then each settings.changed event;
   activity per day, each device's minutes added up; mistakes by id with deletions kept; Look up views per item; typed
   checks per item and field, the later (domain/checks.js joinChecks); the
   rest only when this device has none), and the progress log per day (domain/progress.js: the counts of the most
   complete record of a day, every device's minutes). Script mode's deck and collections are never read or written here. Card ids and record shapes are as they
   were; nothing is deleted except what an event deleted (an undone mark).

   Applying is journaled in the device-scope kv 'backup.journal' (never exported or uploaded):
     1. the journal is written first, with the before-image of every record the merge changes (the local snapshot
        that "Undo restore" puts back) and a hash of each new value, stage 'applying'
     2. the records are written, then read back from storage and compared
     3. stage 'done'. A read-back that differs puts the before-image back at once (stage 'rolledBack').
   A start that finds stage 'applying' (the tab was closed or iOS killed it mid-way) puts the before-image back
   before the store opens (recoverRestore): a cut-off restore is rolled back, never left half-applied, and can be
   run again. Undo puts back only records still as the restore left them, so later answers are kept; a cut-off undo
   ('undoing') is finished at the next start.

   The automatic merge (after a one-time opt-in on each device, kv 'backup'.autoMerge) runs the same plan over the
   other devices' files whose sha changed since the last merge, at most every MERGE_EVERY_MS, only when the app is at
   rest (Today or Profile). */
import { mergeCards, canon } from '../domain/cardmerge.js';
import { mergeSettings, normalizeSettings, defaultSettings } from './settings.js';
import { fnv1a, isoWithOffset } from './ids.js';
import { joinActivity } from '../domain/activity.js';
import { mergeMonth } from '../domain/progress.js';
import { joinChecks } from '../domain/checks.js';
import { joinFamily } from '../domain/wordbuild-family.js';
import * as B from './sync/backup.js';
import { JOURNAL_KV, readJournal, autoMergeOn, setAutoMerge } from './restore-journal.js';

// the light half lives in restore-journal.js (boot and the Profile screen read it without loading this module)
export { JOURNAL_KV, autoMergeOn, setAutoMerge, span } from './restore-journal.js';
export const MERGE_EVERY_MS = 30 * 60e3;
const keep = (/** @type {string} */ deck) => !B.PRIVATE_DECKS.has(deck);
const hash = (/** @type {any} */ v) => fnv1a(canon(v ?? null));
const DAY_FILE = /^(\d{4}-\d\d-\d\d)\.ndjson$/;
const SNAP_FILE = /^(\d{4}-\d\d-\d\d)\.json(\.gz)?$/;

/**
 * @typedef {{day: string, path: string, sha: string, size: number}} FileRef
 * @typedef {{deviceId: string, events: FileRef[], snapshots: FileRef[]}} DeviceBackup
 * @typedef {{snapshots: any[], events: any[], read: Record<string, string>, failed: string[]}} BackupData
 * @typedef {{cards: Record<string, [string, any][]>, kv: Record<string, any>, counts: Record<string, number>, empty: boolean}} Plan
 */

/* ---------- reading ---------- */

/**
 * The devices and days found in the backup.
 * @param {B.Files} files @returns {Promise<DeviceBackup[]>}
 */
export async function listBackups(files) {
  /** @type {Map<string, DeviceBackup>} */ const devs = new Map();
  const dev = (/** @type {string} */ id) => {
    let d = devs.get(id);
    if (!d) devs.set(id, (d = { deviceId: id, events: [], snapshots: [] }));
    return d;
  };
  for (const [root, kind, re] of /** @type {const} */ ([[B.EVENTS_DIR, 'events', DAY_FILE], [B.SNAPSHOTS_DIR, 'snapshots', SNAP_FILE]])) {
    for (const d of (await files.list(root)).filter(e => e.type === 'dir')) {
      for (const f of await files.list(`${root}/${d.name}`)) {
        const m = f.type === 'file' ? re.exec(f.name) : null;
        if (m) dev(d.name)[kind].push({ day: m[1], path: f.path, sha: f.sha, size: f.size });
      }
    }
  }
  const out = [...devs.values()];
  for (const d of out) { d.events.sort((a, b) => (a.day < b.day ? -1 : 1)); d.snapshots.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.path < b.path ? 1 : -1)); }
  return out.sort((a, b) => (a.deviceId < b.deviceId ? -1 : 1));
}

/**
 * One snapshot file, read and checked, or null (missing, unreadable or not a snapshot). The progress log's backfill
 * reads each one when its walk reaches the snapshot's day (data/progress.js), so a year of them is never in memory.
 * @param {B.Files} files @param {FileRef} f @returns {Promise<any | null>}
 */
export async function readSnapshot(files, f) {
  const got = await files.read(f.path);
  if (!got) return null;
  try {
    const text = f.path.endsWith('.gz') ? await B.gunzip(got.bytes) : new TextDecoder().decode(got.bytes);
    const snap = JSON.parse(text);
    return snap && snap.schema === B.SNAPSHOT_SCHEMA && snap.cards && typeof snap.cards === 'object' ? snap : null;
  } catch { return null; }
}

/**
 * Read each device's newest snapshot and its event files. seen: path → sha already merged (those are skipped);
 * skip: a device id to leave out (this device, for the automatic merge); all: every snapshot of every day, not only
 * the newest; snapshots false: the event files only (the progress log's backfill reads the snapshots itself, one at a
 * time: readSnapshot).
 * @param {B.Files} files @param {DeviceBackup[]} devices
 * @param {{seen?: Record<string, string>, skip?: string | null, all?: boolean, snapshots?: boolean, onProgress?: (done: number, total: number) => void}} [o]
 * @returns {Promise<BackupData>}
 */
export async function readBackups(files, devices, { seen = {}, skip = null, all = false, snapshots = true, onProgress } = {}) {
  /** @type {FileRef[]} */ const jobs = [];
  for (const d of devices) {
    if (d.deviceId === skip) continue;
    for (const snap of !snapshots ? [] : all ? d.snapshots : d.snapshots.slice(-1)) if (seen[snap.path] !== snap.sha) jobs.push(snap);
    for (const f of d.events) if (seen[f.path] !== f.sha) jobs.push(f);
  }
  /** @type {BackupData} */ const out = { snapshots: [], events: [], read: {}, failed: [] };
  let done = 0;
  onProgress?.(0, jobs.length);
  const work = async (/** @type {FileRef} */ f) => {
    const got = await files.read(f.path);
    if (got) {
      if (f.path.includes(`${B.SNAPSHOTS_DIR}/`)) {
        try {
          const text = f.path.endsWith('.gz') ? await B.gunzip(got.bytes) : new TextDecoder().decode(got.bytes);
          const snap = JSON.parse(text);
          if (snap && snap.schema === B.SNAPSHOT_SCHEMA && snap.cards && typeof snap.cards === 'object') out.snapshots.push(snap);
          else out.failed.push(f.path);
        } catch { out.failed.push(f.path); }
      } else out.events.push(...B.parseLines(new TextDecoder().decode(got.bytes)).filter(B.backupable));
      out.read[f.path] = got.sha;
    }
    onProgress?.(++done, jobs.length);
  };
  // four at a time; a token or connection error stops the read
  for (let i = 0; i < jobs.length; i += 4) await Promise.all(jobs.slice(i, i + 4).map(work));
  out.snapshots.sort((a, b) => (String(a.deviceId) < String(b.deviceId) ? -1 : String(a.deviceId) > String(b.deviceId) ? 1 : String(a.day) < String(b.day) ? -1 : 1));
  return out;
}

/* ---------- the plan ---------- */

/** @param {any} v */
const isEmpty = v => v == null || (Array.isArray(v) ? !v.length : typeof v === 'object' ? !Object.keys(v).length : v === '');
/** @param {any} o @param {string} path @param {any} v */
function setPath(o, path, v) {
  const ks = path.split('.');
  let x = o;
  for (const k of ks.slice(0, -1)) x = x[k] = { ...(x[k] || {}) };
  x[ks[ks.length - 1]] = v;
  return o;
}

/** The leaf paths of a settings record ('exam.date', 'practice.readAloud', …). @param {any} o @param {string} [pre] @returns {string[]} */
const leaves = (o, pre = '') => Object.entries(o).flatMap(([k, v]) => (k === 'rev' ? [] : v && typeof v === 'object' && !Array.isArray(v) ? leaves(v, `${pre}${k}.`) : [`${pre}${k}`]));
/** @param {any} o @param {string} path */
const getPath = (o, path) => path.split('.').reduce((x, k) => (x == null ? x : x[k]), o);

/**
 * Settings fields that were never stamped (carried over from the old apps, before the HLC) have no rev to compare:
 * a field still at its default here, without a rev, takes the first backup's unstamped value that is not the default.
 * @param {any} next @param {any[]} incoming
 */
function fillUnstamped(next, incoming) {
  const d = defaultSettings();
  const out = structuredClone(next);
  for (const path of leaves(d)) {
    if (out.rev[path] || canon(getPath(out, path)) !== canon(getPath(d, path))) continue;
    const from = incoming.map(normalizeSettings).find(s => !s.rev[path] && canon(getPath(s, path)) !== canon(getPath(d, path)));
    if (from) setPath(out, path, structuredClone(getPath(from, path)));
  }
  return out;
}

/** Mistakes by id: a deleted one stays deleted, otherwise one fixed choice. @param {any} a @param {any} b */
function joinMistakes(a, b) {
  /** @type {Record<string, any>} */ const out = { ...(a || {}) };
  for (const [id, m] of Object.entries(b || {})) {
    const cur = out[id];
    if (!m || typeof m !== 'object') continue;
    if (!cur) { out[id] = m; continue; }
    const rank = (/** @type {any} */ x) => (x.deletedAt ? 1 : 0);
    if (rank(m) > rank(cur) || (rank(m) === rank(cur) && canon(m) > canon(cur))) out[id] = m;
  }
  return out;
}
/** Look up views per item: first the earliest, last the latest, n the larger. @param {any} a @param {any} b */
function joinSeen(a, b) {
  /** @type {Record<string, any>} */ const out = { ...(a || {}) };
  for (const [id, y] of Object.entries(b || {})) {
    const x = out[id];
    if (!x) { out[id] = y; continue; }
    out[id] = { first: [x.first, y.first].filter(Boolean).sort()[0] || null, last: [x.last, y.last].filter(Boolean).sort().pop() || null, n: Math.max(Number(x.n) || 0, Number(y.n) || 0) };
  }
  return out;
}

/**
 * What a merge of the backup into this store would change, and the counts the preview shows. Pure over its inputs.
 * @param {any} store @param {{snapshots: any[], events: any[]}} data
 * @returns {Plan}
 */
export function planRestore(store, { snapshots, events }) {
  /** @type {Record<string, Record<string, any>>} */ const local = {};
  for (const [deck, recs] of Object.entries(/** @type {Record<string, any>} */ (store.cardsByDeck || {}))) if (keep(deck)) local[deck] = recs;
  const learning = events.filter(B.backupable);
  const merged = mergeCards({ local, snapshots: snapshots.map(s => s.cards || {}), events: learning, keep });
  /** @type {Record<string, any>} */ const kv = {};
  const counts = { ...merged.counts, settings: 0, mistakes: 0, days: 0, collections: 0, devices: new Set(snapshots.map(s => s.deviceId).concat(learning.map(e => e.deviceId))).size, events: learning.length };
  for (const [name, rule] of Object.entries(B.SNAPSHOT_KV)) {
    const cur = store.get(name);
    const incoming = snapshots.map(s => s.kv?.[name]).filter(v => v !== undefined && v !== null);
    let next = cur;
    if (rule === 'settings') {
      next = incoming.reduce((a, b) => mergeSettings(a, b), normalizeSettings(cur));
      const changes = learning.filter(e => e.type === 'settings.changed' && e.payload && typeof e.payload.key === 'string' && typeof e.payload.rev === 'string');
      for (const e of changes) next = mergeSettings(next, { rev: { [e.payload.key]: e.payload.rev }, ...setPath({}, e.payload.key, e.payload.value) });
      next = fillUnstamped(next, incoming);
      const before = normalizeSettings(cur);
      if (canon(next) === canon(before)) continue;
      counts.settings = leaves(next).filter(k => canon(getPath(before, k)) !== canon(getPath(next, k))).length;
    } else if (rule === 'activity') next = incoming.reduce(joinActivity, cur || {});
    else if (rule === 'mistakes') next = incoming.reduce(joinMistakes, cur || {});
    else if (rule === 'seen') next = incoming.reduce(joinSeen, cur || {});
    else if (rule === 'checks') next = incoming.reduce(joinChecks, cur || {});
    else if (rule === 'family') next = incoming.reduce((a, b) => joinFamily(a, b), cur || null);
    else if (isEmpty(cur)) next = incoming.find(v => !isEmpty(v)) ?? cur;
    if (canon(next ?? null) === canon(cur ?? null) || (isEmpty(next) && isEmpty(cur))) continue;
    kv[name] = next;
    counts.collections++;
    if (rule === 'mistakes') counts.mistakes = Object.keys(next).filter(id => !(cur || {})[id]).length;
    if (rule === 'activity') counts.days = Object.keys(next).filter(d => !(cur || {})[d]).length;
  }
  // collections named by pattern (B.SNAPSHOT_PREFIX): the progress log's months, found here or in a snapshot, per day
  const names = new Set([...Object.keys(store.kv || {}), ...snapshots.flatMap(s => Object.keys(s.kv || {}))].filter(n => B.prefixRule(n) !== null));
  for (const name of [...names].sort()) {
    const rule = B.prefixRule(name);
    const cur = store.get(name);
    const incoming = snapshots.map(s => s.kv?.[name]).filter(v => v && typeof v === 'object');
    const next = rule === 'progressDays' ? incoming.reduce((a, b) => mergeMonth(a, b), cur ?? null) : cur;
    if (next == null || canon(next) === canon(cur ?? null)) continue;
    kv[name] = next;
    counts.collections++;
  }
  const empty = !Object.keys(merged.changes).length && !Object.keys(kv).length;
  return { cards: merged.changes, kv, counts, empty };
}

/* ---------- applying, with a journal ---------- */

/**
 * Write the journal's before-image back (a cut-off restore, or a failed read-back).
 * @param {any} adapter @param {any} j
 */
async function putBefore(adapter, j) {
  for (const [deck, recs] of Object.entries(/** @type {Record<string, Record<string, any>>} */ (j.before.cards))) {
    await adapter.putCards(j.profileId, deck, Object.entries(recs).map(([id, rec]) => [id, rec ?? null]));
  }
  for (const [name, v] of Object.entries(/** @type {Record<string, any>} */ (j.before.kv))) await adapter.putKV(j.profileId, name, v ?? undefined);
}

/**
 * Apply a plan. Returns the counts, or throws (with everything put back) when the result did not read back.
 * @param {any} store @param {Plan} plan @param {{kind?: 'restore' | 'merge', sources?: any, now?: () => number}} [o]
 */
export async function applyRestore(store, plan, { kind = 'restore', sources = null, now = Date.now } = {}) {
  if (plan.empty) return { applied: 0, counts: plan.counts };
  const adapter = store.adapter;
  await store.flush();
  /** @type {any} */ const j = {
    id: `${now()}-${store.device.deviceId}`, at: isoWithOffset(new Date(now())), kind, profileId: store.profile.id, stage: 'applying',
    counts: plan.counts, sources, before: { cards: {}, kv: {} }, after: { cards: {}, kv: {} },
  };
  for (const [deck, entries] of Object.entries(plan.cards)) {
    const cur = store.cards(deck);
    j.before.cards[deck] = Object.fromEntries(entries.map(([id]) => [id, cur[id] ?? null]));
    j.after.cards[deck] = Object.fromEntries(entries.map(([id, rec]) => [id, hash(rec)]));
  }
  for (const [name, v] of Object.entries(plan.kv)) { j.before.kv[name] = store.get(name) ?? null; j.after.kv[name] = hash(v); }
  await adapter.putKV('device', JOURNAL_KV, j);   // first: a cut-off apply is rolled back from it
  for (const [deck, entries] of Object.entries(plan.cards)) store.putCards(deck, entries);
  for (const [name, v] of Object.entries(plan.kv)) store.set(name, v);
  await store.flush();
  // read back: every record is in storage as planned
  const back = await adapter.loadProfile(store.profile.id);
  const kvBack = await adapter.loadScope(store.profile.id);
  const bad = [
    ...Object.entries(plan.cards).flatMap(([deck, entries]) => entries.filter(([id, rec]) => hash(back.cards[deck]?.[id]) !== hash(rec)).map(([id]) => `${deck}/${id}`)),
    ...Object.entries(plan.kv).filter(([name, v]) => hash(kvBack[name]) !== hash(v)).map(([name]) => name),
  ];
  if (bad.length) {
    await putBefore(adapter, j);
    await adapter.putKV('device', JOURNAL_KV, { ...j, stage: 'rolledBack', error: `read-back differs: ${bad.slice(0, 3).join(', ')}` });
    await store.load();
    throw new Error(`the restore did not read back (${bad.length} records); nothing was changed`);
  }
  await adapter.putKV('device', JOURNAL_KV, { ...j, stage: 'done' });
  if ('settings' in plan.kv) store.bus?.emit('settings:changed', { key: '*' });
  const applied = Object.values(plan.cards).reduce((n, e) => n + e.length, 0) + Object.keys(plan.kv).length;
  return { applied, counts: plan.counts };
}

/**
 * At start, before the store opens: a restore that was cut off is rolled back; an undo that was cut off is finished.
 * Boot reaches it through data/restore-journal.js recoverIfCutOff, which loads this module only when it is needed.
 * @param {any} adapter @param {string} profileId
 * @returns {Promise<'rolledBack' | 'undone' | null>}
 */
export async function recoverRestore(adapter, profileId) {
  const j = await readJournal(adapter);
  if (!j || j.profileId !== profileId) return null;
  if (j.stage === 'applying') {
    await putBefore(adapter, j);
    await adapter.putKV('device', JOURNAL_KV, { ...j, stage: 'rolledBack', error: 'cut off; put back at the next start' });
    return 'rolledBack';
  }
  if (j.stage === 'undoing') {
    const data = await adapter.loadProfile(profileId), kv = await adapter.loadScope(profileId);
    await undoWith(adapter, j, deck => data.cards[deck] || {}, name => kv[name]);
    await adapter.putKV('device', JOURNAL_KV, { ...j, stage: 'undone' });
    return 'undone';
  }
  return null;
}

/**
 * Put back the before-image of records that are still as the restore left them.
 * @param {any} adapter @param {any} j @param {(deck: string) => Record<string, any>} cardsOf @param {(name: string) => any} kvOf
 */
async function undoWith(adapter, j, cardsOf, kvOf) {
  let n = 0;
  for (const [deck, recs] of Object.entries(/** @type {Record<string, Record<string, any>>} */ (j.before.cards))) {
    const cur = cardsOf(deck);
    const back = Object.entries(recs).filter(([id]) => hash(cur[id]) === j.after.cards[deck]?.[id]).map(([id, rec]) => /** @type {[string, any]} */ ([id, rec ?? null]));
    if (back.length) await adapter.putCards(j.profileId, deck, back);
    n += back.length;
  }
  for (const [name, v] of Object.entries(/** @type {Record<string, any>} */ (j.before.kv))) {
    if (hash(kvOf(name)) !== j.after.kv[name]) continue;
    await adapter.putKV(j.profileId, name, v ?? undefined);
    n++;
  }
  return n;
}

/** The last restore or merge on this device and whether it can be undone. @param {any} store */
export async function lastRestore(store) {
  const j = await readJournal(store.adapter);
  if (!j || j.profileId !== store.profile.id) return null;
  return { at: j.at, kind: j.kind, stage: j.stage, counts: j.counts, error: j.error || null, canUndo: j.stage === 'done' };
}

/**
 * Undo the last restore or merge: records still as it left them go back; later changes are kept.
 * @param {any} store @returns {Promise<number>} records put back
 */
export async function undoRestore(store) {
  const adapter = store.adapter;
  const j = await readJournal(adapter);
  if (!j || j.profileId !== store.profile.id || j.stage !== 'done') return 0;
  await store.flush();
  await adapter.putKV('device', JOURNAL_KV, { ...j, stage: 'undoing' });
  const n = await undoWith(adapter, j, deck => store.cards(deck), name => store.get(name));
  await adapter.putKV('device', JOURNAL_KV, { ...j, stage: 'undone' });
  // the automatic merge would bring the other devices' cards straight back: it is turned off until chosen again
  if (autoMergeOn(store)) setAutoMerge(store, false);
  await reloadInto(store, j);
  if ('settings' in j.before.kv) store.bus?.emit('settings:changed', { key: '*' });
  return n;
}

/** Reload the store's cache for what a journal touched, and tell the views. @param {any} store @param {any} j */
async function reloadInto(store, j) {
  await store.load();
  for (const deck of Object.keys(j.before.cards)) { store.notify(`cards:${deck}`, store.cards(deck)); store.post({ kind: 'cards', name: deck }); }
  for (const name of Object.keys(j.before.kv)) { store.notify(name, store.get(name)); store.post({ kind: 'kv', name }); }
}

/* ---------- the automatic merge ---------- */

/**
 * Merge what the other devices backed up since the last merge. Only after the opt-in; at most every MERGE_EVERY_MS
 * unless forced. Returns the counts, or null when it did not run.
 * @param {any} store @param {B.Files} files @param {{now?: () => number, force?: boolean}} [o]
 */
export async function autoMerge(store, files, { now = Date.now, force = false } = {}) {
  const st = B.state(store);
  if (!st.autoMerge || store.profile?.kind === 'shadow') return null;
  if (!force && st.mergedAt && now() - (Date.parse(st.mergedAt) || 0) < MERGE_EVERY_MS) return null;
  const seen = st.mergeSeen && st.mergeSeen.profileId === store.profile.id ? st.mergeSeen.files || {} : {};
  const devices = await listBackups(files);
  const data = await readBackups(files, devices, { seen, skip: store.device.deviceId });
  const plan = planRestore(store, data);
  const res = await applyRestore(store, plan, { kind: 'merge', now, sources: devices.filter(d => d.deviceId !== store.device.deviceId).map(d => d.deviceId) });
  B.setState(store, { mergedAt: new Date(now()).toISOString(), mergeSeen: { profileId: store.profile.id, files: { ...seen, ...data.read } } });
  return res;
}
