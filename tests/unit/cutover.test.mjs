// Leaving shadow mode while keeping the preview's work (src/data/cutover.js, src/data/session.js keepPreview).
// SYNTHETIC data only: the legacy fixture (tools/make-fixtures.mjs) and made-up preview work.
//   - a preview with exam modules, a recording, a correction, cards newer and older than the old apps' copies
//   - the outbox it leaves for the results sync: original ids, times and file names, and what the real sync.py does
//   - a second boot changes nothing; a boot killed at any write resumes to the same result
//   - the legacy keys are only read (a storage stub that throws on any write)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openSession } from '../../src/data/session.js';
import { createMemoryAdapter } from '../../src/data/adapters/memory.js';
import { planMigration, readLegacy, summaryText } from '../../src/data/migrate.js';
import { appendResult, attemptFile, pathFor, stamp, syncResults, resetThrottle, legacyJobs, allowLegacy, TYPES } from '../../src/data/sync/github-b1exam.js';
import { setSetting } from '../../src/data/settings.js';
import { addMistakes } from '../../src/data/mistakes.js';
import { canon, previewText, mergeCard, legacyChangedSince, ARCHIVE_DAYS } from '../../src/data/cutover.js';
import { fnv1a } from '../../src/data/ids.js';
import { mockGithubFor, haveSyncPy, syncPyWorkspace } from './sync-harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const fixture = JSON.parse(readFileSync(path.join(ROOT, 'tests/fixtures/legacy-synthetic.json'), 'utf8'));
assert.equal(fixture.synthetic, true, 'fixtures are synthetic');
const LEGACY_CARDS = JSON.parse(fixture.localStorage['doors.b1.fsrs.v1']);
const [A, B] = Object.keys(LEGACY_CARDS);    // A: the preview reviewed it last · B: the old app reviewed it after the preview
const C = 'BW:synthetic-preview-only';        // first seen in the preview

const PREVIEW_NOW = new Date(Date.UTC(2026, 9, 1, 16, 0, 0));
const CUT_NOW = new Date(Date.UTC(2026, 9, 4, 8, 0, 0));
const at = (/** @type {number} */ min) => new Date(PREVIEW_NOW.getTime() + min * 60000);
const previewClock = { today: () => '2026-10-01' };
const clock = { today: () => '2026-10-04' };
const REPO = 'someone/results';

/** A Storage that throws on any write: proves the legacy keys are only read. */
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

/** Legacy keys on the day the preview first opened: fewer cards and attempts than in exam week. */
function previewDayLegacy() {
  const d = { ...fixture.localStorage };
  d['doors.b1.fsrs.v1'] = JSON.stringify(Object.fromEntries(Object.entries(LEGACY_CARDS).slice(0, 10)));
  d['remote:attempts'] = JSON.stringify(JSON.parse(d['remote:attempts']).slice(0, 2));
  return d;
}

/** Legacy keys in exam week: the old apps were used after the preview opened, too. */
function examWeekLegacy({ examDate } = {}) {
  const d = { ...fixture.localStorage };
  const cards = { ...LEGACY_CARDS };
  cards[B] = { ...cards[B], u: Date.UTC(2026, 9, 2, 18, 0, 0), last: '2026-10-02', reps: cards[B].reps + 1, hist: [...cards[B].hist, ['2026-10-02', 1, 5100, 't', '']] };
  d['doors.b1.fsrs.v1'] = JSON.stringify(cards);
  const atts = JSON.parse(d['remote:attempts']);
  atts.push({ id: 1790100000000, day: 3, module: 'hoeren', started_at: '2026-10-02T18:00:00', submitted_at: '2026-10-02T18:40:00', duration_s: 2400, score: 21, max_score: 30, meta: { source: 'remote' }, responses: [], synced: true, _path: 'data/attempts/20261002T164000-day03-hoeren.json' });
  d['remote:attempts'] = JSON.stringify(atts);
  // the old app sent a word that was still unsent when the preview read the keys
  d['remote:vocab'] = JSON.stringify(JSON.parse(d['remote:vocab']).map(w => (w.id === '1:absagen' ? { ...w, synced: true, _path: 'data/vocab/20261002T100000-absagen.json' } : w)));
  if (examDate) d.examDate = JSON.stringify(examDate);
  return d;
}

const card = (base = {}, u, day, g) => ({ S: 2, D: 5, due: day, ...base, u, last: day, reps: (base.reps || 0) + 1, hist: [...(base.hist || []), [day, g, 3000, 't', '']] });

/** The preview: a shadow profile migrated from preview-day keys, then real work in it. */
async function seedPreview(adapter, { local = false } = {}) {
  const pre = readOnlyStorage(previewDayLegacy());
  if (local) { const l = await openSession({ adapter, legacyStorage: pre.s, clock: previewClock, now: () => PREVIEW_NOW }); await l.store.flush(); const d = await adapter.getDevice(); d.activeProfile = null; await adapter.putDevice(d); }
  const p = await openSession({ adapter, legacyStorage: local ? null : pre.s, clock: previewClock, now: () => PREVIEW_NOW, kind: 'shadow' });
  if (local) {   // a device with a local profile whose active profile is a preview
    const sh = { id: '0192a3b4-c5d6-7e8f-9a0b-0000000000ff', name: '', kind: 'shadow', createdAt: '2026-10-01T18:00:00.000+02:00', remoteId: null };
    await adapter.putProfile(sh);
    const d = await adapter.getDevice(); d.activeProfile = sh.id; await adapter.putDevice(d);
    return seedPreview2(adapter, pre);
  }
  return seedWork(p, adapter, pre);
}
async function seedPreview2(adapter, pre) {
  const p = await openSession({ adapter, legacyStorage: null, clock: previewClock, now: () => PREVIEW_NOW, kind: 'shadow' });
  return seedWork(p, adapter, pre);
}

async function seedWork(p, adapter, pre) {
  const { store } = p;
  assert.equal(p.profile.kind, 'shadow');
  const exam = { id: 'goethe-b1' };
  const mk = (id, n, module, t, extra = {}) => ({
    id, profileId: p.profile.id, deviceId: p.device.deviceId, createdAt: t.toISOString(), examId: exam.id, contentVersion: 'v1',
    day: n, module, started_at: new Date(t.getTime() - 3000e3).toISOString(), submitted_at: t.toISOString(), duration_s: 3000,
    score: module === 'lesen' ? 24 : null, max_score: module === 'lesen' ? 30 : 100, meta: { pauses: { count: 0, seconds: 0 } },
    responses: module === 'lesen' ? [{ item_id: 'L1-1', teil: 'L1', skill: 'detail', given: 'r', correct: 'r', is_correct: 1 }] : [],
    writings: module === 'schreiben' ? [{ aufgabe: 'aufgabe1', text: 'Liebe Anna, ich komme gern.', word_count: 5 }] : [], synced: false, ...extra,
  });
  const saved = [];
  for (const [id, n, module, t] of [['0192a3b4-c5d6-7e8f-9a0b-0000000000c1', 4, 'lesen', at(5)], ['0192a3b4-c5d6-7e8f-9a0b-0000000000c2', 4, 'schreiben', at(65)]]) {
    const rec = mk(id, n, module, t);
    const e = appendResult(store, 'exam.attempt', { attemptId: rec.id, file: attemptFile(rec) }, t);
    saved.push({ ...rec, eventId: e.id, path: e.path });
  }
  store.putAttempts(saved);
  // a recording: the blob first, then its event (features/exam/data.js saveRecording)
  await adapter.putBlob('blob-preview-1', new Blob([new Uint8Array(1024).fill(5)], { type: 'audio/mp4' }));
  const voice = appendResult(store, 'exam.voice', { day: 4, module: 'sprechen', part: 'teil2', label: 'Thema', mime: 'audio/mp4', bytes: 1024, created_at: at(130).toISOString(), blobRef: 'blob-preview-1', ext: 'm4a' }, at(130));
  // a one-click correction of the Schreiben attempt
  const fbAt = at(140);
  const fb = appendResult(store, 'feedback.created', { day: 4, module: 'schreiben', attempt_id: saved[1].id, attempt_file: saved[1].path, body: '! circa 58 / 100\n~~gern~~ → ==gerne==', created_at: fbAt.toISOString(), model: 'test-model' }, fbAt);
  store.update('exams.feedbackLocal', xs => [...(xs || []), { id: 'local-preview-1', day: 4, module: 'schreiben', attempt_id: saved[1].id, attempt_file: saved[1].path, body: '! circa 58 / 100', created_at: fbAt.toISOString(), model: 'test-model', source: 'fritz-app', eventId: fb.id }], []);
  addMistakes(store, { attemptId: saved[1].id, test: 4, module: 'schreiben', label: 'Aufgabe 1', items: [{ wrong: 'ich komme gern', right: 'ich komme gerne', rule: 'gerne' }] });
  // cards: A and B reviewed in the preview, C seen for the first time
  const tA = at(20).getTime(), tB = at(21).getTime(), tC = at(22).getTime();
  store.putCards('b1', [[A, card(store.cards('b1')[A], tA, '2026-10-01', 3)], [B, card(store.cards('b1')[B], tB, '2026-10-01', 3)],
    [C, { S: 0.49, D: 6.4, due: '2026-10-02', reps: 1, lapses: 0, last: '2026-10-01', first: '2026-10-01', stage: 0, streak: 0, learn: 1, relearn: false, u: tC, hist: [['2026-10-01', 3, 2800, 't', '']] }]]);
  for (const [i, id] of [A, B, C].entries()) store.append('card.reviewed', { deck: 'b1', itemId: id, g: 3, ms: 3000 }, { at: at(20 + i) });
  // settings he changed in the preview: the exam date, the minutes, the theme
  setSetting({ store, hlc: p.hlc }, 'exam.date', '2026-10-10');
  setSetting({ store, hlc: p.hlc }, 'minutesPerDay', 90);
  store.set('prefs', { ...(store.get('prefs') || {}), theme: 'light' });
  store.update('activity', a => ({ ...(a || {}), '2026-10-01': { minutes: 75, rounds: 3 } }), {});
  store.set('b1.session', { ...(store.get('b1.session') || {}), day: { day: '2026-10-01', rounds: 3, newShown: 5, newBy: {}, firstTry: [9, 12], pred: [0, 0], shown: [] } });
  store.update('ui', u => ({ ...(u || {}), importSeen: true, fieldIntro: true }), {});
  // a Sprechen take that was cut off
  await adapter.putBlob('take:t9', new Blob([new Uint8Array(64)], { type: 'audio/mp4' }));
  store.set('exams.takeInProgress', { id: 't9', n: 4, part: 'teil3', label: 'Teil 3', startedAt: at(150).getTime(), touchedAt: at(151).getTime(), mime: 'audio/mp4' });
  await store.flush();
  return { previewId: p.profile.id, attempts: saved, voice, fb, pre, tA, tB, tC };
}

/** Everything a memory adapter holds, for "nothing changed" checks and to restore a seeded state. */
async function dump(adapter, blobIds = ['blob-preview-1', 'take:t9']) {
  const profiles = await adapter.listProfiles();
  const out = { device: await adapter.getDevice(), deviceKV: await adapter.loadScope('device'), profiles: {}, blobs: {} };
  for (const p of profiles) out.profiles[p.id] = { rec: p, kv: await adapter.loadScope(p.id), ...(await adapter.loadProfile(p.id)) };
  for (const b of blobIds) { const x = await adapter.getBlob(b); out.blobs[b] = x ? x.size : null; }
  return out;
}
async function restore(d, blobs) {
  const a = createMemoryAdapter();
  await a.putDevice(d.device);
  for (const [k, v] of Object.entries(d.deviceKV)) await a.putKV('device', k, v);
  for (const [id, p] of Object.entries(d.profiles)) {
    await a.putProfile(p.rec);
    for (const [k, v] of Object.entries(p.kv)) await a.putKV(id, k, v);
    for (const [deck, recs] of Object.entries(p.cards)) await a.putCards(id, deck, Object.entries(recs));
    await a.putAttempts(id, p.attempts);
    await a.putEvents(id, p.outbox);
  }
  for (const [id, b] of Object.entries(blobs)) await a.putBlob(id, b);
  return a;
}

/** The facts a cutover must produce, from the boot's result. */
async function checkKept(adapter, c, seed, { legacy }) {
  const real = c.profile;
  assert.equal(real.kind, 'local');
  const profiles = await adapter.listProfiles();
  const prev = profiles.find(p => p.id === seed.previewId);
  assert.ok(prev, 'the preview profile is not deleted');
  assert.ok(prev.archivedAt, 'it is archived');
  assert.equal(prev.archivedInto, real.id);
  assert.deepEqual(profiles.filter(p => !p.archivedAt).map(p => p.id), [real.id], 'one profile to open');
  assert.equal((await adapter.getDevice()).activeProfile, real.id);
  assert.equal((await adapter.getDevice()).cutover, undefined, 'the cutover finished');
  const pv = await adapter.loadProfile(seed.previewId);
  assert.ok(pv.outbox.length && pv.attempts.length, 'the archived preview keeps its data for 30 days');

  // cards: newest per card, review logs united
  const cards = c.store.cards('b1');
  assert.equal(Object.keys(cards).length, Object.keys(LEGACY_CARDS).length - 2 + 1, 'every usable legacy card and the preview-only one');
  assert.equal(cards[A].u, seed.tA, 'A: the preview reviewed it last, the preview wins');
  assert.equal(cards[B].u, Date.UTC(2026, 9, 2, 18, 0, 0), 'B: the old app reviewed it after the preview, the old app wins');
  assert.deepEqual(cards[B].hist.map(h => h[0]), ['2026-09-26', '2026-10-01', '2026-10-02'], 'B keeps the preview review in its log');
  assert.equal(cards[B].hist.at(-1)[1], 1, 'the winner\'s last answer stays last');
  assert.equal(cards[C].u, seed.tC, 'C: first seen in the preview, kept');

  // attempts: the import's (each once) plus the two made in the preview, with their records intact
  const atts = c.store.attempts();
  const legacyIds = atts.filter(a => a.legacy).map(a => a.legacy.id).sort();
  assert.deepEqual(legacyIds, [...new Set(legacyIds)], 'no old-app attempt twice');
  assert.equal(legacyIds.length, legacy.attempts);
  for (const s of seed.attempts) {
    const a = atts.find(x => x.id === s.id);
    assert.ok(a, `preview attempt ${s.module} kept`);
    assert.equal(a.profileId, real.id);
    assert.equal(a.path, s.path);
    assert.equal(a.submitted_at, s.submitted_at, 'original time');
    assert.equal(a.synced, false);
  }

  // outbox: every preview event, with its id, time and file name, unsent
  const pending = c.store.pending().filter(e => TYPES.has(e.type));
  const want = [...seed.attempts.map(a => a.eventId), seed.voice.id, seed.fb.id];
  assert.deepEqual(pending.map(e => e.id).sort(), [...want].sort());
  for (const e of pending) {
    const orig = pv.outbox.find(x => x.id === e.id);
    assert.equal(e.at, orig.at, 'the original time');
    assert.equal(e.path, orig.path, 'the original file name');
    assert.equal(e.seq, orig.seq);
    assert.equal(e.profileId, real.id);
    assert.equal(e.synced, false);
    assert.ok(e.path.includes(stamp(Date.parse(e.at))), `${e.path} is stamped with the original time ${e.at}`);
  }
  assert.equal(c.store.pending().filter(e => e.type === 'card.reviewed').length, 3, 'review events united');
  assert.ok(await adapter.getBlob('blob-preview-1'), 'the recording\'s bytes stay');
  assert.ok(await adapter.getBlob('take:t9'), 'the cut-off take stays');
  assert.equal(c.store.get('exams.takeInProgress').id, 't9', 'and is recovered in the real profile');

  // collections
  assert.ok(c.store.get('exams.feedbackLocal').some(f => f.id === 'local-preview-1'));
  assert.equal(Object.values(c.store.get('mistakes')).filter(m => !m.deletedAt).length, 1);
  assert.equal(c.store.get('vocab.local').find(w => w.id === '1:absagen').synced, true, 'a word the old app sent stays sent');
  assert.equal(c.store.get('activity')['2026-10-01'].minutes, 75);
  assert.equal(c.store.get('b1.session').day.day, '2026-10-03', 'the newer day log is today\'s');
  assert.ok(c.store.get('b1.session').days.some(d => d.day === '2026-10-01' && d.rounds === 3), 'the preview day is in the history');
  // consent stays with the real profile: the notice shows, nothing is sent before it
  assert.ok(!c.store.get('ui').importSeen);
  assert.equal(c.store.get('ui').fieldIntro, true);
  return { real, pending };
}

test('cutover keeps the preview: newest card wins both ways, attempts, recording, outbox, settings', async () => {
  const adapter = createMemoryAdapter();
  const seed = await seedPreview(adapter);
  const week = readOnlyStorage(examWeekLegacy());
  const legacy = planMigration(readLegacy(week.s), { profileId: 'x', deviceId: 'd', now: CUT_NOW }).summary;
  const c = await openSession({ adapter, legacyStorage: week.s, clock, now: () => CUT_NOW, kind: 'local' });
  assert.equal(c.cutoverError, null);
  await checkKept(adapter, c, seed, { legacy });
  assert.deepEqual(c.migration, legacy, 'the import is the same as a first run on exam-week data');
  // settings: the preview's exam date and minutes (the old app never changed the date), the preview's theme
  const s = c.store.get('settings');
  assert.equal(s.exam.date, '2026-10-10');
  assert.equal(s.minutesPerDay, 90);
  assert.equal(c.store.get('prefs').theme, 'light');
  assert.equal(c.store.get('secrets').githubToken, 'github_pat_FAKE');
  // the notice
  assert.deepEqual({ ...c.previewKept }, { modules: 2, recordings: 1, corrections: 1, reviews: 3, mistakes: 1, cards: 1, toSend: 4 });
  const t = (k, v = {}) => ({
    'preview.kept': `Kept from the preview: ${v.list}.`, 'preview.kept.modules': `${v.n} exam modules`, 'preview.kept.recordings': `${v.n} recording`,
    'preview.kept.corrections': `${v.n} correction`, 'preview.kept.reviews': `${v.n} reviews`, 'preview.kept.mistakes': `${v.n} mistake to practise`,
    'import.leadOld': `Imported from the old apps: ${v.list}.`, 'import.cards': `${v.n} cards from Igloo`, 'import.attempts': `${v.n} exam attempts`,
    'import.drafts': `${v.n} unfinished drafts`, 'import.words': `${v.n} saved words`, 'import.training': `${v.n} writing texts`,
  }[k]);
  const meta = c.store.get('meta');
  assert.equal(previewText(meta.preview, t), 'Kept from the preview: 2 exam modules, 1 recording, 1 correction, 3 reviews, 1 mistake to practise.');
  assert.equal(summaryText(meta.summary, t, { afterPreview: true }), 'Imported from the old apps: 40 cards from Igloo, 6 exam attempts, 2 unfinished drafts, 3 saved words, 1 writing texts.');
  assert.equal(week.writes.length + seed.pre.writes.length, 0, 'legacy keys are never written');
});

test('the old app changed the exam date after the preview: its date wins', async () => {
  const adapter = createMemoryAdapter();
  await seedPreview(adapter);
  const week = readOnlyStorage(examWeekLegacy({ examDate: '2026-10-08' }));
  const c = await openSession({ adapter, legacyStorage: week.s, clock, now: () => CUT_NOW, kind: 'local' });
  assert.equal(c.store.get('settings').exam.date, '2026-10-08');
  assert.equal(c.store.get('settings').minutesPerDay, 90, 'fields the old app never had still come from the preview');
  assert.equal(week.writes.length, 0);
});

test('a second boot changes nothing', async () => {
  const adapter = createMemoryAdapter();
  await seedPreview(adapter);
  const week = readOnlyStorage(examWeekLegacy());
  const c = await openSession({ adapter, legacyStorage: week.s, clock, now: () => CUT_NOW, kind: 'local' });
  await c.store.flush();
  const before = canon(await dump(adapter));
  const d = await openSession({ adapter, legacyStorage: week.s, clock, now: () => new Date(CUT_NOW.getTime() + 3600e3), kind: 'local' });
  await d.store.flush();
  assert.equal(d.profile.id, c.profile.id);
  assert.equal(d.migration, null);
  assert.equal(d.previewKept, null);
  assert.equal(canon(await dump(adapter)), before, 'not one record changed');
  assert.equal(week.writes.length, 0);
});

test('a boot killed at any write resumes to the same result', async () => {
  const seeded = createMemoryAdapter();
  const seed = await seedPreview(seeded);
  const state = await dump(seeded);
  const blobs = { 'blob-preview-1': await seeded.getBlob('blob-preview-1'), 'take:t9': await seeded.getBlob('take:t9') };
  const week = readOnlyStorage(examWeekLegacy());
  const legacy = planMigration(readLegacy(week.s), { profileId: 'x', deviceId: 'd', now: CUT_NOW }).summary;
  const WRITES = new Set(['putDevice', 'putProfile', 'deleteProfile', 'putKV', 'putCards', 'putAttempts', 'putEvents', 'putBlob', 'deleteBlob']);
  const killable = (real, k) => { let n = 0; return new Proxy(real, { get: (t, name) => (typeof t[name] !== 'function' ? t[name] : async (...a) => { if (WRITES.has(name) && ++n > k) throw new Error('killed'); return t[name](...a); }) }); };
  /** what must be equal between a clean run and a resumed one (profile ids and new uuids taken out) */
  const shape = async (adapter, c) => {
    const d = await dump(adapter);
    const real = d.profiles[c.profile.id];
    const kv = { ...real.kv, meta: { ...real.kv.meta } };
    return canon({
      cards: real.cards, kv,
      attempts: real.attempts.map(a => ({ ...a, id: a.legacy ? `legacy:${a.legacy.id}` : a.id })).sort((x, y) => x.id.localeCompare(y.id)),
      outbox: real.outbox.filter(e => e.type !== 'legacy.imported').sort((x, y) => x.id.localeCompare(y.id)),
      deviceKV: d.deviceKV, blobs: d.blobs,
      profiles: Object.values(d.profiles).map(p => ({ kind: p.rec.kind, archived: !!p.rec.archivedAt })).sort((x, y) => canon(x).localeCompare(canon(y))),
    }).replaceAll(c.profile.id, 'REAL');
  };
  const clean = await restore(state, blobs);
  const ref = await openSession({ adapter: clean, legacyStorage: week.s, clock, now: () => CUT_NOW, kind: 'local' });
  await ref.store.flush();
  const want = await shape(clean, ref);
  // count the writes of a clean cutover, then kill a boot after each of them
  let total = 0;
  { const counted = new Proxy(await restore(state, blobs), { get: (t, name) => (typeof t[name] !== 'function' ? t[name] : (...a) => { if (WRITES.has(name)) total++; return t[name](...a); }) });
    const x = await openSession({ adapter: counted, legacyStorage: week.s, clock, now: () => CUT_NOW, kind: 'local' }); await x.store.flush(); }
  assert.ok(total > 10, `a cutover writes ${total} times`);
  const err = console.error; console.error = () => {};
  try {
    for (let k = 0; k < total; k++) {
      const adapter = await restore(state, blobs);
      try { const x = await openSession({ adapter: killable(adapter, k), legacyStorage: week.s, clock, now: () => CUT_NOW, kind: 'local' }); await x.store.flush(); } catch { /* killed */ }
      const c = await openSession({ adapter, legacyStorage: week.s, clock, now: () => CUT_NOW, kind: 'local' });
      await c.store.flush();
      assert.equal(c.cutoverError, null, `kill after write ${k}`);
      await checkKept(adapter, c, seed, { legacy });
      assert.equal(await shape(adapter, c), want, `kill after write ${k}: the same result as a clean run`);
      const own = new Set(state.profiles[seed.previewId].outbox.map(e => e.id));
      assert.ok(c.store.pending().filter(e => e.type === 'legacy.imported' && !own.has(e.id)).length <= 1, 'one import record at most');
    }
  } finally { console.error = err; }
  assert.equal(week.writes.length, 0);
});

test('a merge that does not read back keeps the preview, opens the real profile, and is tried again', async () => {
  const adapter = createMemoryAdapter();
  const seed = await seedPreview(adapter);
  const week = readOnlyStorage(examWeekLegacy());
  let lie = true;   // a disk that drops one outbox write without an error
  const flaky = { ...adapter, putEvents: async (p, list) => (lie && p !== seed.previewId ? adapter.putEvents(p, list.slice(1)) : adapter.putEvents(p, list)) };
  const err = console.error; console.error = () => {};
  const a = await openSession({ adapter: flaky, legacyStorage: week.s, clock, now: () => CUT_NOW, kind: 'local' }).finally(() => { console.error = err; });
  assert.match(a.cutoverError, /read-back differs/);
  assert.equal(a.profile.kind, 'local', 'work goes on in the real profile');
  const prev = (await adapter.listProfiles()).find(p => p.id === seed.previewId);
  assert.ok(!prev.archivedAt, 'the preview is not archived');
  await a.store.flush();
  lie = false;
  const b = await openSession({ adapter: flaky, legacyStorage: week.s, clock, now: () => CUT_NOW, kind: 'local' });
  assert.equal(b.cutoverError, null);
  assert.equal(b.profile.id, a.profile.id);
  await checkKept(adapter, b, seed, { legacy: planMigration(readLegacy(week.s), { profileId: 'x', deviceId: 'd', now: CUT_NOW }).summary });
});

test('a local profile that exists is kept and the preview is merged into it, without a second import', async () => {
  const adapter = createMemoryAdapter();
  const seed = await seedPreview(adapter, { local: true });
  const local = (await adapter.listProfiles()).find(p => p.kind === 'local');
  const week = readOnlyStorage(examWeekLegacy());
  const c = await openSession({ adapter, legacyStorage: week.s, clock, now: () => CUT_NOW, kind: 'local' });
  assert.equal(c.profile.id, local.id);
  assert.equal(c.migration, null);
  assert.equal(c.store.attempts().filter(a => a.legacy).length, 2, 'the import it had, once');
  assert.equal(c.store.pending().filter(e => TYPES.has(e.type)).length, 4);
  assert.equal(c.store.cards('b1')[C].u, seed.tC);
  assert.equal(week.writes.length, 0);
});

test('archived previews are purged after 30 days; a recording still waiting to be sent stays', async () => {
  const adapter = createMemoryAdapter();
  const seed = await seedPreview(adapter);
  const week = readOnlyStorage(examWeekLegacy());
  const c = await openSession({ adapter, legacyStorage: week.s, clock, now: () => CUT_NOW, kind: 'local' });
  await c.store.flush();
  const later = (days) => new Date(CUT_NOW.getTime() + days * 864e5);
  await openSession({ adapter, legacyStorage: week.s, clock, now: () => later(ARCHIVE_DAYS - 1), kind: 'local' });
  assert.ok((await adapter.listProfiles()).some(p => p.id === seed.previewId), 'kept for 30 days');
  const d = await openSession({ adapter, legacyStorage: week.s, clock, now: () => later(ARCHIVE_DAYS + 1), kind: 'local' });
  assert.deepEqual((await adapter.listProfiles()).map(p => p.id), [c.profile.id], 'then purged');
  assert.ok(await adapter.getBlob('blob-preview-1'), 'the unsent recording is still referenced by the real profile');
  assert.equal(d.profile.id, c.profile.id);
});

test('the preview outbox reaches the results repo with its own file names; the real sync.py imports it once', async () => {
  resetThrottle();
  const adapter = createMemoryAdapter();
  const seed = await seedPreview(adapter);
  const week = readOnlyStorage(examWeekLegacy());
  const c = await openSession({ adapter, legacyStorage: week.s, clock, now: () => CUT_NOW, kind: 'local' });
  const store = c.store;
  const gh = mockGithubFor(REPO);
  let r = await syncResults(store, { repo: REPO, fetch: gh.fetch, force: true, pull: false });
  assert.equal(gh.calls.filter(x => x.method === 'PUT').length, 0, 'nothing is sent before the notice was seen');
  store.update('ui', u => ({ ...(u || {}), importSeen: true, previewSeen: true }), {});
  resetThrottle();
  r = await syncResults(store, { repo: REPO, fetch: gh.fetch, force: true, pull: false });
  assert.equal(r.ok, 4); assert.equal(r.error, null);
  const expected = [
    ...seed.attempts.map(a => a.path),
    seed.voice.path.replace(/\.m4a$/, '.json'), seed.voice.path, seed.fb.path,
  ].sort();
  const backupFiles = [...gh.files.keys()].filter(k => /^data\/(events|snapshots)\//.test(k));
  assert.deepEqual([...gh.files.keys()].filter(k => !backupFiles.includes(k)).sort(), expected, 'exactly the results the preview would have sent');
  // the progress backup goes in the same flush, in folders sync.py never reads (its half below runs over all of them)
  assert.ok(backupFiles.some(k => k.startsWith(`data/events/${store.device.deviceId}/`)) && backupFiles.some(k => k.startsWith(`data/snapshots/${store.device.deviceId}/`)), backupFiles.join(', '));
  assert.equal(seed.attempts[0].path, pathFor('exam.attempt', { file: { day: 4, module: 'lesen' } }, at(5)), 'named by the time it was submitted');
  assert.equal(seed.voice.path, 'data/voice/day04/20261001T181000-sprechen-teil2.m4a');
  assert.equal(gh.json(seed.attempts[0].path).submitted_at, seed.attempts[0].submitted_at, 'the original time inside the file');
  assert.equal(JSON.parse(gh.text(seed.voice.path.replace(/\.m4a$/, '.json'))).created_at, at(130).toISOString());
  assert.equal(await adapter.getBlob('blob-preview-1'), null, 'the recording leaves the device once both files are up');
  assert.ok(store.attempts().filter(a => seed.attempts.some(s => s.id === a.id)).every(a => a.synced === true));
  // old unsent items wait for their own tap, as on any migration
  assert.ok(legacyJobs(store).length > 0);
  allowLegacy(store); resetThrottle();
  r = await syncResults(store, { repo: REPO, fetch: gh.fetch, force: true, pull: false });
  assert.equal(r.error, null);
  // a second flush sends nothing again
  resetThrottle();
  const n = gh.calls.length;
  r = await syncResults(store, { repo: REPO, fetch: gh.fetch, force: true, pull: false });
  assert.equal(r.ok, 0); assert.equal(gh.calls.length, n);

  if (!haveSyncPy) return;   // the contract half needs the B1 exam app's scripts/sync.py on this machine
  const ws = syncPyWorkspace();
  try {
    ws.write(gh.files);
    const out1 = ws.run();
    const m = /imported (\d+),/.exec(out1);
    assert.ok(m, out1);
    const atts = ws.q('SELECT day, module, meta FROM attempts ORDER BY id');
    for (const s of seed.attempts) assert.equal(atts.filter(a => JSON.parse(a.meta).file === s.path).length, 1, `${s.path} imported once`);
    assert.deepEqual(ws.q('SELECT day, module, part, bytes FROM voice_notes WHERE day = 4'), [{ day: 4, module: 'sprechen', part: 'teil2', bytes: 1024 }]);
    assert.equal(ws.q("SELECT COUNT(*) n FROM feedback WHERE source = 'fritz-app'")[0].n >= 1, true);
    assert.match(ws.run(), /imported 0,/, 'a second sync.py run imports nothing');
  } finally { ws.done(); }
});

test('unit rules: card times, the legacy fingerprint', () => {
  const r = { u: 10, hist: [['2026-10-01', 3, 1, 't', '']] }, p = { u: 20, hist: [['2026-09-30', 4, 1, 't', '']] };
  assert.equal(mergeCard(r, p).rec.u, 20);
  assert.deepEqual(mergeCard(r, p).rec.hist.map(h => h[0]), ['2026-09-30', '2026-10-01']);
  assert.equal(mergeCard(p, r).rec.u, 20, 'both ways');
  assert.equal(mergeCard({ last: '2026-10-02' }, { last: '2026-10-01' }).previewWon, false, 'without u, the last review day');
  const changed = legacyChangedSince({ examDate: fnv1a('"2026-10-09"') }, { examDate: '"2026-10-08"', 'gh:token': '"x"' });
  assert.equal(changed('examDate'), true);
  assert.equal(changed('gh:token'), true, 'a key that appeared since');
  assert.equal(changed('doors.prefs.v2'), false);
  assert.equal(legacyChangedSince(null, { examDate: '"x"' })('examDate'), false, 'no fingerprint: the preview counts as newer');
});
