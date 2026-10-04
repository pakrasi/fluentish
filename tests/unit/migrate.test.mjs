// The one-time legacy migration, against the SYNTHETIC fixture (tools/make-fixtures.mjs). Read-only on localStorage,
// counts and records as the plan says, idempotent per device.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readLegacy, hasLegacyProgress, planMigration, summaryText } from '../../src/data/migrate.js';
import { openSession, deleteProfile } from '../../src/data/session.js';
import { createMemoryAdapter } from '../../src/data/adapters/memory.js';
import { validate } from '../../src/core/schema.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const J = p => JSON.parse(readFileSync(path.join(ROOT, p), 'utf8'));
const fixture = J('tests/fixtures/legacy-synthetic.json');
assert.equal(fixture.synthetic, true, 'fixtures are synthetic');

/** A Storage that throws on any write: proves the migration is read-only. */
function readOnlyStorage(data) {
  const keys = Object.keys(data);
  const writes = [];
  const s = {
    get length() { return keys.length; },
    key: i => keys[i] ?? null,
    getItem: k => (k in data ? data[k] : null),
    setItem: k => { writes.push(k); throw new Error(`write to ${k}`); },
    removeItem: k => { writes.push(k); throw new Error(`remove ${k}`); },
    clear: () => { writes.push('*'); throw new Error('clear'); },
  };
  return { s, writes };
}
const clock = { today: () => '2026-10-03' };
const NOW = new Date(2026, 9, 3, 9, 30);
const PID = '0192a3b4-c5d6-7e8f-9a0b-000000000001';

test('readLegacy takes the known keys and prefixes only', () => {
  const { s, writes } = readOnlyStorage(fixture.localStorage);
  const snap = readLegacy(s);
  assert.ok('doors.b1.fsrs.v1' in snap && 'remote:attempts' in snap && 'draft:3:lesen' in snap && 'plays:2:H1-1' in snap);
  assert.ok(!('another-app:setting' in snap), 'foreign keys are ignored');
  assert.ok(!('doors.b1.words.v1' in snap) && !('tr:somehash' in snap), 'caches are not read');
  assert.equal(writes.length, 0);
  assert.equal(hasLegacyProgress(snap), true);
  assert.equal(hasLegacyProgress({ 'doors.prefs.v2': '{}' }), false, 'a theme alone is not progress');
});

test('planMigration: settings, keys, cards, attempts, drafts and the summary', () => {
  const snap = readLegacy(readOnlyStorage(fixture.localStorage).s);
  let n = 0;
  const plan = planMigration(snap, { profileId: PID, deviceId: 'd1', now: NOW, uuid: () => `0192a3b4-c5d6-7e8f-9a0b-${String(++n).padStart(12, '0')}` });
  const s = plan.summary;
  // settings: the goal follows what the old apps were used for; the date is the stored one, never a default
  assert.equal(plan.kv.settings.language, 'german');
  assert.equal(plan.kv.settings.level, 'B1');
  assert.equal(plan.kv.settings.exam.type, 'goethe-b1');
  assert.equal(plan.kv.settings.exam.date, '2026-10-09');
  assert.equal(plan.kv.settings.newPerDay, null, 'Igloo\'s number becomes Auto');
  assert.equal(plan.summary.newPerDay, 30, 'and is shown once in the import notice');
  assert.equal(plan.kv.settings.practice.claudeCheck, false);
  assert.equal(plan.kv.settings.practice.readAloud, true);
  assert.ok(plan.kv.settings.onboarded, 'a migrated learner skips onboarding');
  assert.deepEqual(validate(J('schemas/records/settings.schema.json'), plan.kv.settings), []);
  // device prefs and secrets: raw doors.apikey, JSON gh:token
  assert.equal(plan.prefs.theme, 'dark');
  assert.equal(plan.secrets.anthropicKey, 'sk-ant-FAKE-KEY');
  assert.equal(plan.secrets.githubToken, 'github_pat_FAKE');
  // cards: valid records move unchanged, broken ones are counted
  const src = JSON.parse(fixture.localStorage['doors.b1.fsrs.v1']);
  assert.equal(s.cards, 40); assert.equal(s.cardsSkipped, 2);
  for (const [id, rec] of plan.cards) assert.deepEqual(rec, src[id], `card ${id} is identical`);
  const cardSchema = J('schemas/records/card-fsrs.schema.json');
  for (const [, rec] of plan.cards) assert.deepEqual(validate(cardSchema, rec), []);
  // attempts: record fields added, legacy id and path kept, synced flags kept, bad ones dropped
  assert.equal(s.attempts, 5); assert.equal(s.attemptsUnsent, 1);
  const a0 = plan.attempts[0];
  assert.equal(a0.legacy.id, 1790000100000); assert.equal(a0.legacy.path, 'data/attempts/20260927T190200-day01-lesen.json');
  assert.equal(a0.examId, 'goethe-b1'); assert.equal(a0.profileId, PID); assert.equal(a0.synced, true);
  assert.ok(!('_path' in a0) && !('synced' in a0 && a0.synced === undefined));
  assert.equal(plan.attempts.find(a => a.module === 'schreiben' && a.day === 2).synced, false, 'unsent stays unsent');
  const attemptSchema = J('schemas/records/exam-attempt.schema.json');
  for (const a of plan.attempts) assert.deepEqual(validate(attemptSchema, { ...a, createdAt: '2026-09-27T19:02:00+02:00' }), []);
  // drafts folded per module, plays per test
  assert.deepEqual(plan.kv['exams.drafts']['3:lesen'].answers, { 'L1-1': true, 'L2-1': 2 });
  assert.equal(plan.kv['exams.drafts']['3:lesen'].start, 1790000800000);
  assert.equal(plan.kv['exams.drafts']['4:sprechen'].prepStart, 1790000900000);
  assert.deepEqual(plan.kv['exams.drafts']['plays:2'], { 'H1-1': { used: 1, extra: 0 } });
  assert.equal(s.drafts, 2);
  assert.equal(plan.kv['exams.training']['1-aufgabe1'], 'Lieber Max, ich freue mich auf das Wochenende.');
  // saved words keep their flags; Igloo's SM-2 deck is only counted
  assert.equal(s.words, 3); assert.equal(s.wordsUnsent, 1);
  assert.equal(s.iglooCards, 10);
  // activity: B1 rounds at 4 min, exam modules at their real length
  assert.equal(plan.kv.activity['2026-10-03'].minutes, 12);
  assert.ok(plan.kv.activity['2026-09-27'].minutes >= 62 + 38 + 58);
  // fingerprint for the later delta re-merge
  assert.equal(Object.keys(plan.kv.meta.fingerprint).length, Object.keys(snap).length);
});

test('without an exam date the date stays empty', () => {
  const snap = { 'doors.b1.fsrs.v1': fixture.localStorage['doors.b1.fsrs.v1'] };
  const plan = planMigration(snap, { profileId: 'p1', deviceId: 'd1', now: NOW });
  assert.equal(plan.kv.settings.exam.date, null);
  assert.equal(plan.kv.settings.exam.type, 'goethe-b1');
  assert.equal(plan.summary.examDate, null);
});

test('summary text', () => {
  const t = (k, v = {}) => ({ 'import.lead': `Imported ${v.list}.`, 'import.cards': `${v.n} cards from Igloo`, 'import.attempts': `${v.n} exam attempts`,
    'import.drafts': `${v.n} unfinished drafts`, 'import.words': `${v.n} saved words`, 'import.training': `${v.n} training texts`, 'import.settingsOnly': 'your settings' }[k]);
  assert.equal(summaryText({ cards: 412, attempts: 7, drafts: 0, words: 0, trainingTexts: 0 }, t), 'Imported 412 cards from Igloo, 7 exam attempts.');
  assert.equal(summaryText({ cards: 0, attempts: 0, drafts: 0, words: 0, trainingTexts: 0 }, t), 'Imported your settings.');
});

test('openSession migrates once per device, read-only, and opens the store', async () => {
  const adapter = createMemoryAdapter();
  const { s, writes } = readOnlyStorage(fixture.localStorage);
  const a = await openSession({ adapter, legacyStorage: s, clock, now: () => NOW });
  assert.equal(writes.length, 0, 'legacy keys are never written');
  assert.equal(a.migration.cards, 40);
  assert.equal(Object.keys(a.store.cards('b1')).length, 40);
  assert.equal(a.store.attempts().length, 5);
  assert.equal(a.store.get('settings').exam.date, '2026-10-09');
  assert.equal(a.store.get('prefs').theme, 'dark');
  assert.equal(a.store.get('secrets').githubToken, 'github_pat_FAKE');
  assert.equal(a.device.legacyDeviceId, 'fx7k2q9a');
  assert.equal(a.store.pending()[0].type, 'legacy.imported');
  await a.store.flush();
  // second boot: same profile, no second migration
  const b = await openSession({ adapter, legacyStorage: s, clock, now: () => NOW });
  assert.equal(b.migration, null);
  assert.equal(b.profile.id, a.profile.id);
  assert.equal(Object.keys(b.store.cards('b1')).length, 40);
  // after "Delete all" the legacy data does not come back: a fresh profile goes to onboarding
  await deleteProfile(adapter, b.device, b.profile);
  const c = await openSession({ adapter, legacyStorage: s, clock, now: () => NOW });
  assert.equal(c.migration, null);
  assert.notEqual(c.profile.id, a.profile.id);
  assert.equal(Object.keys(c.store.cards('b1')).length, 0);
  assert.equal(c.store.get('settings'), undefined, 'empty profile: onboarding');
  assert.equal(c.store.get('secrets'), undefined, 'secrets are gone too');
  assert.equal(writes.length, 0);
});

test('a device with no legacy data gets an empty profile', async () => {
  const adapter = createMemoryAdapter();
  const { s } = readOnlyStorage({ 'doors.prefs.v2': JSON.stringify({ theme: 'light' }) });
  const x = await openSession({ adapter, legacyStorage: s, clock, now: () => NOW });
  assert.equal(x.migration, null);
  assert.equal(x.store.get('settings'), undefined);
});
