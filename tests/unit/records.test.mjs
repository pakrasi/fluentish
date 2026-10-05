// Records against schemas/records (src/data/records.js; arch review #6, "schema drift"). SYNTHETIC data only.
//   - profile@1 knows the fields the cutover writes (archivedAt, archivedInto), and a real cutover's profiles validate
//   - a store with the checker on: settings, prefs, events and a Schreiben correction written by the app's own code
//     paths all match their schemas, and a record that does not is reported before it is written
//   - feedback@1: a correction says who wrote it (author, model, promptVersion), additively; old records still pass
//   - the prompt versions are pinned to the prompts' text, so a prompt change bumps its version
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate } from '../../src/core/schema.js';
import { RECORD_SCHEMAS, KV_SCHEMAS, recordErrors, recordChecker, loadRecordSchemas } from '../../src/data/records.js';
import { Store } from '../../src/data/store.js';
import { openSession } from '../../src/data/session.js';
import { createMemoryAdapter } from '../../src/data/adapters/memory.js';
import { setSetting, setExamDate, defaultPrefs } from '../../src/data/settings.js';
import { markCards } from '../../src/data/known.js';
import { saveCorrection } from '../../src/features/exam/data.js';
import { filesFor } from '../../src/data/sync/github-b1exam.js';
import { PROMPTS, GRADER_TEMPLATE, TASK_GRADER } from '../../src/services/claude.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const schemas = Object.fromEntries(RECORD_SCHEMAS.map(n => [n, JSON.parse(readFileSync(path.join(ROOT, `schemas/records/${n}.schema.json`), 'utf8'))]));
const UUID = '01923f4e-5a6b-7c8d-9e0f-a1b2c3d4e5f6';
const UUID2 = '01923f4e-5a6b-7c8d-8e0f-a1b2c3d4e5f7';
const clock = { today: () => '2026-10-05' };

/** A store whose checker throws on the first record that does not match its schema. */
async function checkedStore() {
  const adapter = createMemoryAdapter();
  const s = await openSession({ adapter, legacyStorage: null, clock, kind: 'local' });
  s.store.check = recordChecker(schemas, m => { throw new Error(m); });
  return { ...s, adapter, ctx: { store: s.store, clock: { ctx: () => ({ today: '2026-10-05', exam: '2026-10-09', phase: 'week' }), today: clock.today }, hlc: s.hlc } };
}

test('every record schema the checker uses exists, and every checked collection names one of them', () => {
  for (const n of RECORD_SCHEMAS) assert.ok(schemas[n] && schemas[n].$id === `${n}@1`, n);
  for (const [name, m] of Object.entries(KV_SCHEMAS)) assert.ok(RECORD_SCHEMAS.includes(/** @type {any} */ (m.schema)), name);
});

test('profile@1: an archived preview profile (archivedAt, archivedInto) is valid; other extra fields are not', () => {
  const p = { id: UUID, name: '', kind: 'shadow', createdAt: '2026-10-01T09:00:00+02:00', remoteId: null };
  assert.deepEqual(validate(schemas.profile, p), []);
  assert.deepEqual(validate(schemas.profile, { ...p, archivedAt: '2026-10-04T10:00:00+02:00', archivedInto: UUID2 }), []);
  assert.ok(validate(schemas.profile, { ...p, archivedInto: 'nope' }).length);
  assert.ok(validate(schemas.profile, { ...p, archived: true }).length, 'still closed to fields nobody declared');
});

test('profile@1: the profiles a real cutover leaves behind (the preview archived into the real one) all validate', async () => {
  const adapter = createMemoryAdapter();
  const preview = await openSession({ adapter, legacyStorage: null, clock, kind: 'shadow' });
  setSetting({ store: preview.store, hlc: preview.hlc }, 'level', 'B1');
  await preview.store.flush();
  const real = await openSession({ adapter, legacyStorage: null, clock, kind: 'local' });
  assert.ok(real.previewKept, 'the preview was merged');
  const all = await adapter.listProfiles();
  assert.equal(all.length, 2);
  const archived = all.find(p => p.archivedAt);
  assert.equal(archived.archivedInto, real.profile.id);
  for (const p of all) assert.deepEqual(validate(schemas.profile, p), [], `${p.kind} profile`);
});

test('the checker: settings, prefs and events written by the app match their schemas', async () => {
  const { store, hlc, ctx } = await checkedStore();
  const app = { store, hlc, clock };
  setSetting(app, 'language', 'german');
  setSetting(app, 'level', 'B1');
  setSetting(app, 'exam.type', 'goethe-b1');
  setSetting(app, 'exam.modules', ['lesen', 'schreiben']);
  setSetting(app, 'minutesPerDay', 60);
  setSetting(app, 'practice.buildNew', 8);
  setSetting(app, 'onboarded', '2026-10-05T08:00:00+02:00');
  assert.equal(setExamDate(app, '2026-10-09').ok, true);
  store.set('prefs', { ...defaultPrefs(), theme: 'dark' });
  const marked = markCards(ctx, [{ deck: 'b1', id: 'BW:synthetic-word' }], { spread: false });
  assert.equal(marked.n, 1);
  marked.undo();
  const types = [...store.events.values()].map(e => e.type);
  assert.ok(types.includes('settings.changed') && types.includes('card.marked_known') && types.includes('card.unmarked_known'), types.join());
});

test('the checker reports a record that does not match, before it is written', async () => {
  const { store } = await checkedStore();
  assert.throws(() => store.set('prefs', { theme: 'sepia' }), /schema: kv prefs does not match .*theme/);
  assert.equal(store.get('prefs'), undefined, 'nothing was written');
  assert.throws(() => store.append('card.reviewed', { deck: 'b1', itemId: 'BW:x', g: 5 }), /schema: event card\.reviewed/);
  assert.throws(() => store.append('no.such.type', {}), /schema: event no\.such\.type/);
  // collections without a schema are not checked
  store.set('ui', { anything: true });
  // the reporter is replaceable: the browser logs instead of throwing
  const seen = [];
  recordChecker(schemas, m => seen.push(m))('kv', 'settings', { v: 2 });
  assert.equal(seen.length, 1);
  assert.match(seen[0], /^schema: kv settings does not match schemas\/records: /);
});

test('feedback@1: a one-click correction says who wrote it (author ai, the model, the prompt version), and it is sent with them', async () => {
  const { store, ctx } = await checkedStore();
  const attempt = { id: UUID2, day: 2, module: 'schreiben', path: 'data/attempts/x.json' };
  const f = saveCorrection({ ...ctx, bus: null }, { attempt, body: '! circa 62 / 100 · bestanden\n## Aufgabe 1 · Test · circa 25 / 40', model: 'claude-opus-5-5', promptVersion: PROMPTS.schreibenExam, now: Date.parse('2026-10-05T08:00:00Z') });
  assert.equal(f.author, 'ai');
  assert.equal(f.promptVersion, 'schreiben-exam@1');
  const [kept] = store.get('exams.feedbackLocal');
  assert.deepEqual(recordErrors(schemas, 'kv', 'exams.feedbackLocal', [kept]), []);
  const ev = [...store.events.values()].find(e => e.type === 'feedback.created');
  assert.equal(ev.payload.author, 'ai');
  assert.equal(ev.payload.model, 'claude-opus-5-5');
  assert.equal(ev.payload.promptVersion, 'schreiben-exam@1');
  const [file] = filesFor({ ...ev, path: 'data/feedback-ai/f.json' });
  const sent = JSON.parse(String(file.body));
  assert.equal(sent.author, 'ai');
  assert.equal(sent.prompt_version, 'schreiben-exam@1');
  assert.equal(sent.model, 'claude-opus-5-5');
});

test('feedback@1 is additive: corrections from before author/promptVersion, and the old app\'s, still validate and send as before', () => {
  const old = { id: 'local-1', day: 2, module: 'schreiben', attempt_id: 1790000000001, alias_id: 15, attempt_file: 'data/attempts/a.json', body: 'B', created_at: '2026-10-01T09:00:00-04:00', synced: false, _path: 'data/feedback-ai/x.json' };
  assert.deepEqual(recordErrors(schemas, 'kv', 'exams.feedbackLocal', [old]), []);
  assert.ok(recordErrors(schemas, 'kv', 'exams.feedbackLocal', [{ ...old, author: 'robot' }]).length);
  assert.ok(recordErrors(schemas, 'kv', 'exams.feedbackLocal', [{ ...old, promptVersion: 'v1' }]).length);
  const [file] = filesFor({ type: 'feedback.created', path: 'f.json', payload: { day: 3, module: 'schreiben', attempt_id: 'u1', attempt_file: null, body: 'b', created_at: 'c', model: 'm' } });
  assert.deepEqual(Object.keys(JSON.parse(String(file.body))), ['day', 'module', 'attempt_id', 'attempt_file', 'body', 'created_at', 'model']);
});

test('prompt versions are pinned to the prompt text: changing a prompt means bumping its version here and in PROMPTS', () => {
  const h = (/** @type {string} */ s) => createHash('sha256').update(s).digest('hex').slice(0, 12);
  assert.deepEqual(PROMPTS, { schreibenExam: 'schreiben-exam@1', schreibenTask: 'schreiben-task@1' });
  assert.equal(h(GRADER_TEMPLATE), PINNED.exam, 'GRADER_TEMPLATE changed: bump PROMPTS.schreibenExam and update the pin');
  assert.equal(h(TASK_GRADER), PINNED.task, 'TASK_GRADER changed: bump PROMPTS.schreibenTask and update the pin');
});
const PINNED = { exam: '040742cd3cc0', task: 'c0cea4f19ae2' };

test('loadRecordSchemas: every schema or none (a dev server without schemas checks nothing)', async () => {
  const files = /** @type {Record<string, any>} */ (Object.fromEntries(RECORD_SCHEMAS.map(n => [`http://x/app/schemas/records/${n}.schema.json`, schemas[n]])));
  const ok = await loadRecordSchemas('http://x/app/', /** @type {any} */ (async (/** @type {string} */ u) => new Response(JSON.stringify(files[u]), { status: files[u] ? 200 : 404 })));
  assert.deepEqual(Object.keys(ok || {}).sort(), [...RECORD_SCHEMAS].sort());
  const none = await loadRecordSchemas('http://x/app/', /** @type {any} */ (async () => new Response('', { status: 404 })));
  assert.equal(none, null);
});

test('the store has no checker unless one is given (the deployed app)', async () => {
  const s = new Store({ adapter: createMemoryAdapter(), profile: { id: UUID, name: '', kind: 'local' }, device: { deviceId: 'd' }, clock });
  assert.equal(s.check, null);
});
