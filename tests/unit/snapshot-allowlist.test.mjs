// What a backup snapshot may carry (round 4, C0; PLAN-REVIEW B5): privacy is enforced by the snapshot's KEYS, not by
// scanning bodies. SNAPSHOT_KV must be exactly this list (with its merge rules) and the pattern-named collections
// exactly these patterns; the private collections below must never be among them or match a pattern.
// Lanes: a new backed-up collection adds one line to ALLOWED (and SNAPSHOT_KV); a new device-only one adds one line
// to DENIED. Never move a name from DENIED to ALLOWED without the owner's say.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SNAPSHOT_KV, SNAPSHOT_PREFIX, prefixRule, snapshotOf, PRIVATE_DECKS } from '../../src/data/sync/backup.js';

/** Every kv collection a snapshot carries, with its merge rule (data/restore.js). */
const ALLOWED = {
  settings: 'settings',
  activity: 'activity',
  mistakes: 'mistakes',
  'lookup.seen': 'seen',
  known: 'fill',
  'b1.session': 'fill',
  'speak.sim': 'fill',
  clusters: 'fill',
  'practice.write': 'fill',
  'exams.feedbackLocal': 'fill',
  'exams.seen': 'fill',
  'exams.learnerNotes': 'fill',
  'vocab.local': 'fill',
  'vocab.events': 'fill',
  'fr.session': 'fill',
  'read.words': 'fill',   // saved reading words: lemma, meaning, level, first/last/n; no sentence, no title (lane L2b)
};

/** Collections found by pattern, and their rule. */
const PATTERNS = [['^progress\\.([a-z0-9-]+)\\.(\\d{4}-\\d\\d)$', 'progressDays']];

/** Device-only collections: personal text or outside data. Never in a snapshot, never matched by a pattern. */
const DENIED = [
  'reads',              // pasted reading texts (lane L2)
  'read.ctx',           // the sentences around saved reading words (lane L2)
  'read.cache',         // Claude's glosses, translations and questions for a text (lane L2)
  'conv.transcripts',   // conversation transcripts (lane L4)
  'conv.feedback',      // conversation feedback with quotes from the transcript (lane L4)
  'hours.external',     // study hours read from an outside file (lane L5)
  'exam.window',        // the exam window record (lane L1a): device-only, a restored device starts its own
  'today.anyway',       // "Study anyway" on an Off day (lane L1b): one day, this device
  'scripts',            // Script mode's scripts (round 2)
  'secrets',
];

test('SNAPSHOT_KV is exactly the allowed list, with the same merge rules', () => {
  assert.deepEqual(SNAPSHOT_KV, ALLOWED);
  assert.deepEqual(Object.keys(SNAPSHOT_KV), Object.keys(ALLOWED), 'and in the same order');
});

test('collections named by pattern: exactly the progress log months', () => {
  assert.deepEqual(SNAPSHOT_PREFIX.map(([re, rule]) => [re.source, rule]), PATTERNS);
  assert.equal(prefixRule('progress.de.2026-10'), 'progressDays');
  for (const name of ['progress.device', 'progress.de.frames.2026-10', 'progress.de.2026-1', 'xprogress.de.2026-10']) assert.equal(prefixRule(name), null, name);
});

test('the denied collections are never in a snapshot', () => {
  for (const name of DENIED) {
    assert.ok(!(name in SNAPSHOT_KV), `${name} is in SNAPSHOT_KV`);
    assert.equal(prefixRule(name), null, `${name} matches a snapshot pattern`);
  }
  // a store that holds every one of them: the snapshot carries only allowed names, and none of their text
  const SENTINEL = 'zz-sentinel-c0-7f3a';
  /** @type {Record<string, any>} */ const kv = { settings: { v: 1 }, 'progress.de.2026-10': { days: {} } };
  for (const name of DENIED) kv[name] = { x: { text: SENTINEL } };
  const store = { cardsByDeck: { b1: { 'W:a': { reps: 1 } }, script: { 'SW:x': { reps: 1, note: SENTINEL } } }, kv, get: (/** @type {string} */ n) => kv[n],
    device: { deviceId: 'dev1', seq: 0 }, profile: { id: 'p1' }, clock: { today: () => '2026-10-05' } };
  const snap = snapshotOf(store, { now: 0 });
  assert.deepEqual(Object.keys(snap.kv).sort(), ['progress.de.2026-10', 'settings']);
  assert.ok(!JSON.stringify(snap).includes(SENTINEL), 'no private text in the snapshot');
  assert.ok(PRIVATE_DECKS.has('script'));
});
