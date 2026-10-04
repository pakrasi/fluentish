/* One-time, read-only move of progress from the two legacy apps (Igloo and the B1 exam app share this origin's
   localStorage) into this app's store.

   readLegacy(storage)       copies the known legacy keys out of localStorage (getItem/key/length only; it never writes)
   planMigration(snap, o)    pure: legacy snapshot → profile settings, cards, attempts, collections and a summary
   applyMigration(...)       writes the plan through the adapter and records the migration on the device
   summaryText(summary, t)   "Imported 412 cards from Igloo, 7 exam attempts…"

   Scope (review A4): the B1 trainer's FSRS cards and session, the exam app's attempts, drafts, training texts,
   voice-note list, feedback and saved words, the exam date, the keys and the theme. Igloo's SM-2 collections
   (doors.srs.v1, doors.know.v1, doors.progress.v1, doors.days.v1, doors.today.v1) stay owned by Igloo until Drill
   and Test move here; they are only counted. Caches (doors.b1.words.v1, tr:*, doors.b1.backup.v1) are rebuilt.
   A missing exam date stays missing: the user sets it in Profile (no date is ever assumed). */
import { uuidv7, isoWithOffset, fnv1a } from './ids.js';
import { normalizeSettings, defaultPrefs } from './settings.js';
import { today as studyDay } from '../core/clock.js';

/** Exact legacy keys this migration reads. */
export const LEGACY_KEYS = [
  'examDate', 'anthropic:key', 'doors.apikey', 'gh:token', 'practice:size', 'coach:effort', 'export:cfg', 'export:last',
  'doors.prefs.v2', 'doors.b1.fsrs.v1', 'doors.b1.settings.v1', 'doors.b1.round.v1', 'doors.b1.day.v1', 'doors.b1.days.v1',
  'doors.b1.variants.v1', 'doors.b1.cal.v1', 'doors.b1.teil2.v1', 'doors.b1.seeded', 'doors.b1.firstRun', 'doors.b1.device',
  'doors.todayStrip.v1', 'doors.prismSeen', 'woerter:by', 'woerter:day', 'blitz:best',
  'remote:attempts', 'remote:voice', 'remote:seen', 'remote:feedback-local', 'remote:vocab', 'remote:vocab-events', 'training:last',
  // counted only (owned by Igloo until phase 3)
  'doors.srs.v1', 'doors.know.v1', 'doors.progress.v1', 'doors.days.v1', 'doors.today.v1',
];
/** Key prefixes this migration reads. */
export const LEGACY_PREFIXES = ['draft:', 'plays:', 'training:'];

/**
 * Copy the legacy keys out of a Storage. Read-only: only length, key() and getItem() are used.
 * @param {Pick<Storage, 'length' | 'key' | 'getItem'>} storage
 * @returns {Record<string, string>}
 */
export function readLegacy(storage) {
  /** @type {Record<string, string>} */
  const out = {};
  try {
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k == null) continue;
      if (LEGACY_KEYS.includes(k) || LEGACY_PREFIXES.some(p => k.startsWith(p))) {
        const v = storage.getItem(k);
        if (v != null) out[k] = v;
      }
    }
  } catch { /* storage blocked: nothing to move */ }
  return out;
}

/** True when the snapshot holds progress worth moving (not only a theme). @param {Record<string, string>} snap */
export function hasLegacyProgress(snap) {
  return ['doors.b1.fsrs.v1', 'remote:attempts', 'examDate', 'remote:vocab', 'doors.srs.v1'].some(k => k in snap)
    || Object.keys(snap).some(k => k.startsWith('draft:'));
}

/** @param {string | undefined} raw @param {any} [fallback] */
function json(raw, fallback = null) {
  if (raw == null) return fallback;
  try { const v = JSON.parse(raw); return v == null ? fallback : v; } catch { return fallback; }
}

const isDay = (/** @type {unknown} */ s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const MODULES = new Set(['lesen', 'hoeren', 'schreiben', 'sprechen']);

/** A legacy FSRS record is usable when it has numbers and dates where fsrs.js needs them. @param {any} r */
const validCard = r => r && typeof r === 'object' && Number.isFinite(r.S) && r.S > 0 && Number.isFinite(r.D) && isDay(r.due) && Number.isInteger(r.reps);

/**
 * Build everything the migration will write. Pure: the caller passes ids, time and the random source.
 * @param {Record<string, string>} snap  legacy key → raw string, from readLegacy()
 * @param {{profileId: string, deviceId: string, now: Date, uuid?: (ms: number) => string}} o
 */
export function planMigration(snap, { profileId, deviceId, now, uuid = ms => uuidv7(ms) }) {
  const at = isoWithOffset(now);
  /** @type {Record<string, any>} */ const kv = {};
  const summary = { cards: 0, cardsSkipped: 0, attempts: 0, attemptsUnsent: 0, drafts: 0, trainingTexts: 0, words: 0, wordsUnsent: 0,
    voiceNotes: 0, feedback: 0, examDate: /** @type {string|null} */ (null), keys: /** @type {string[]} */ ([]), theme: null,
    iglooCards: 0, legacyKeys: Object.keys(snap).length, newPerDay: /** @type {number | null} */ (null) };

  // ---- settings: the goal comes from what the legacy apps were used for ----
  const settings = normalizeSettings(null);
  const examDate = json(snap.examDate);
  const fsrs = json(snap['doors.b1.fsrs.v1'], {});
  const rawAttempts = json(snap['remote:attempts'], []);
  const usedB1 = Object.keys(fsrs).length > 0 || (Array.isArray(rawAttempts) && rawAttempts.length > 0) || isDay(examDate);
  if (usedB1) {
    settings.language = 'german';
    settings.level = 'B1';
    settings.exam.type = 'goethe-b1';
  }
  if (isDay(examDate)) { settings.exam.date = examDate; summary.examDate = examDate; }
  const b1s = json(snap['doors.b1.settings.v1'], {});
  // Igloo's "new items per day" is not carried over: here Auto paces new items to the exam date and the minutes. The
  // old number is kept in the summary and shown once in the import notice.
  if (Number.isInteger(b1s.newPerDay)) summary.newPerDay = Math.max(0, Math.min(200, b1s.newPerDay));
  if (typeof b1s.claude === 'boolean') settings.practice.claudeCheck = b1s.claude;
  if (b1s.layout && b1s.layout !== 'docked') settings.practice.simpleInput = true;
  const iglooPrefs = json(snap['doors.prefs.v2'], {});
  if (typeof iglooPrefs.drillAudio === 'boolean') settings.practice.readAloud = iglooPrefs.drillAudio;
  settings.onboarded = at;   // a returning learner skips onboarding
  for (const k of ['language', 'level', 'exam.type', 'exam.date', 'onboarded']) settings.rev[k] = `${String(now.getTime()).padStart(13, '0')}-0000-${deviceId}`;
  kv.settings = settings;

  // ---- device prefs and secrets ----
  const prefs = defaultPrefs();
  if (iglooPrefs.theme === 'light' || iglooPrefs.theme === 'dark') { prefs.theme = iglooPrefs.theme; summary.theme = iglooPrefs.theme; }
  const secrets = { anthropicKey: /** @type {string | null} */ (null), githubToken: /** @type {string | null} */ (null) };
  const ak = json(snap['anthropic:key']) || (snap['doors.apikey'] || '').trim() || null;   // doors.apikey is a raw string
  if (typeof ak === 'string' && ak) { secrets.anthropicKey = ak; summary.keys.push('claude'); }
  const gt = json(snap['gh:token']);
  if (typeof gt === 'string' && gt) { secrets.githubToken = gt; summary.keys.push('github'); }

  // ---- B1 FSRS cards ----
  /** @type {[string, any][]} */ const cards = [];
  for (const [id, rec] of Object.entries(fsrs)) {
    if (validCard(rec)) cards.push([id, rec]); else summary.cardsSkipped++;
  }
  summary.cards = cards.length;

  // ---- B1 session state (rounds, day log, variants) ----
  kv['b1.session'] = Object.fromEntries(Object.entries({
    round: json(snap['doors.b1.round.v1']), day: json(snap['doors.b1.day.v1']), days: json(snap['doors.b1.days.v1'], []),
    variants: json(snap['doors.b1.variants.v1']), cal: json(snap['doors.b1.cal.v1']), teil2: json(snap['doors.b1.teil2.v1']),
    seeded: json(snap['doors.b1.seeded']), firstRun: json(snap['doors.b1.firstRun']),
  }).filter(([, v]) => v != null));

  // ---- exam attempts (b1-exam shape, plus the record fields) ----
  const attempts = [];
  for (const a of Array.isArray(rawAttempts) ? rawAttempts : []) {
    if (!a || !Number.isInteger(a.day) || !MODULES.has(a.module)) continue;
    const ms = Number.isFinite(a.id) ? a.id : Date.parse(a.submitted_at) || now.getTime();
    const { synced, _path, id, ...rest } = a;
    attempts.push({
      ...rest, responses: rest.responses || [], writings: rest.writings || [], max_score: rest.max_score ?? (a.module === 'lesen' || a.module === 'hoeren' ? 30 : 100),
      score: rest.score ?? null, id: uuid(ms), profileId, deviceId, createdAt: rest.submitted_at || at, examId: 'goethe-b1', contentVersion: null,
      legacy: { id, path: _path || null }, synced: synced !== false,
    });
    if (synced === false) summary.attemptsUnsent++;
  }
  summary.attempts = attempts.length;

  // ---- drafts: draft:N:M (+ :start :pause :seen :tab :meta, sprechen:prep:start) and plays:N:id ----
  /** @type {Record<string, any>} */ const drafts = {};
  for (const [k, raw] of Object.entries(snap)) {
    let m = /^draft:(\d+):([a-z]+)(?::(.+))?$/.exec(k);
    if (m) {
      const d = (drafts[`${m[1]}:${m[2]}`] ||= {});
      const sub = m[3] || 'answers';
      d[sub === 'prep:start' ? 'prepStart' : sub] = json(raw, raw);
      continue;
    }
    m = /^plays:(\d+):(.+)$/.exec(k);
    if (m) ((drafts[`plays:${m[1]}`] ||= {})[m[2]] = json(raw, raw));
  }
  kv['exams.drafts'] = drafts;
  summary.drafts = Object.keys(drafts).filter(k => !k.startsWith('plays:') && drafts[k].answers != null).length;

  // ---- untimed Schreiben training texts ----
  /** @type {Record<string, any>} */ const training = {};
  for (const [k, raw] of Object.entries(snap)) {
    const m = /^training:(.+)$/.exec(k);
    if (m) training[m[1]] = json(raw, raw);
  }
  kv['exams.training'] = training;
  summary.trainingTexts = Object.keys(training).filter(k => k !== 'last').length;

  // ---- feedback, voice notes, saved words: copied with their synced flags so the outbox re-sends them ----
  const voice = json(snap['remote:voice'], []);
  const fb = json(snap['remote:feedback-local'], []);
  const vocab = json(snap['remote:vocab'], []);
  const vocabEvents = json(snap['remote:vocab-events'], []);
  kv['exams.voice'] = voice;
  kv['exams.seen'] = json(snap['remote:seen'], []);
  kv['exams.feedbackLocal'] = fb;
  kv['vocab.local'] = vocab;
  kv['vocab.events'] = vocabEvents;
  summary.voiceNotes = Array.isArray(voice) ? voice.length : 0;
  summary.feedback = Array.isArray(fb) ? fb.length : 0;
  summary.words = Array.isArray(vocab) ? vocab.length : 0;
  summary.wordsUnsent = Array.isArray(vocab) ? vocab.filter((/** @type {any} */ w) => w && w.synced === false).length : 0;

  // ---- small UI state and old app options ----
  kv.ui = Object.fromEntries(Object.entries({
    todayStrip: json(snap['doors.todayStrip.v1']), prismSeen: json(snap['doors.prismSeen']), woerterBy: json(snap['woerter:by']),
    woerterDay: json(snap['woerter:day']), blitzBest: json(snap['blitz:best']), practiceSize: json(snap['practice:size']),
    coachEffort: json(snap['coach:effort']), exportCfg: json(snap['export:cfg']),
  }).filter(([, v]) => v != null));

  // ---- activity per study day: B1 rounds (≈ 4 min each) and exam modules (their real duration) ----
  /** @type {Record<string, {minutes: number, rounds: number}>} */ const activity = {};
  const b1days = [...(json(snap['doors.b1.days.v1'], []) || []), json(snap['doors.b1.day.v1'])].filter(Boolean);
  for (const d of b1days) {
    if (!isDay(d.day) || !(d.rounds > 0)) continue;
    const x = (activity[d.day] ||= { minutes: 0, rounds: 0 });
    x.rounds = Math.max(x.rounds, d.rounds);
    x.minutes = Math.max(x.minutes, d.rounds * 4);
  }
  for (const a of attempts) {
    const t = Date.parse(a.submitted_at || '');
    if (!Number.isFinite(t) || !(a.duration_s > 0)) continue;
    const day = studyDay(new Date(t));
    const x = (activity[day] ||= { minutes: 0, rounds: 0 });
    x.minutes += Math.round(a.duration_s / 60);
  }
  kv.activity = activity;

  // ---- Igloo SM-2 deck: counted, not moved ----
  summary.iglooCards = Object.keys(json(snap['doors.srs.v1'], {})).length;

  // ---- record of the move, with a fingerprint per key for the later delta re-merge (review B2) ----
  kv.meta = {
    migratedAt: at,
    legacyDeviceId: json(snap['doors.b1.device']),
    fingerprint: Object.fromEntries(Object.entries(snap).map(([k, v]) => [k, fnv1a(v)])),
    summary,
  };

  return { kv, prefs, secrets, cards, attempts, summary };
}

/**
 * Write a plan for a new profile. The legacy keys are not touched.
 * @param {any} adapter @param {ReturnType<typeof planMigration>} plan @param {{id: string}} profile
 */
export async function applyMigration(adapter, plan, profile) {
  for (const [name, value] of Object.entries(plan.kv)) await adapter.putKV(profile.id, name, value);
  await adapter.putKV('device', 'prefs', plan.prefs);
  await adapter.putKV('device', 'secrets', plan.secrets);
  if (plan.cards.length) await adapter.putCards(profile.id, 'b1', plan.cards);
  if (plan.attempts.length) await adapter.putAttempts(profile.id, plan.attempts);
}

/**
 * The one-line summary shown once on Today and kept in Profile > Data.
 * @param {ReturnType<typeof planMigration>['summary']} s
 * @param {((key: string, vars?: Record<string, any>) => string) & {list?: (items: string[]) => string}} t
 */
export function summaryText(s, t) {
  const parts = [];
  if (s.cards) parts.push(t('import.cards', { n: s.cards }));
  if (s.attempts) parts.push(t('import.attempts', { n: s.attempts }));
  if (s.drafts) parts.push(t('import.drafts', { n: s.drafts }));
  if (s.words) parts.push(t('import.words', { n: s.words }));
  if (s.trainingTexts) parts.push(t('import.training', { n: s.trainingTexts }));
  if (!parts.length) parts.push(t('import.settingsOnly'));
  return t('import.lead', { list: t.list ? t.list(parts) : parts.join(', ') });
}
