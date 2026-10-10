// The boot graph: every module src/main.js reaches through static imports. tools/stamp.mjs puts each of them in a
// modulepreload link, so all of it downloads and compiles before the first screen draws on the phone. Code that boot
// rarely needs (restore, migration, cutover, the progress log, the grader, the word-family engine) is loaded with
// import() where it is used, and this test keeps it that way: a budget for the graph's size, and a list of modules
// it must not reach. A change that raises the budget says why in its commit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { importGraph } from '../../tools/stamp.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (/** @type {string} */ p) => readFileSync(path.join(ROOT, p));

// ceilings: 64 modules, 700 KB raw, 241 KB gzip after round 8 P1 (before it: 81, 1,116 KB, 378 KB), plus a little room
// for strings and small modules that later work adds. The language packs are the next large part (lang/registry.js).
// Round 8 integration: 66 modules, 742 KB raw, 256 KB gzip once F1, ACC0 and the ui lanes are in (core/motion.js
// +14 KB raw, ui/toast.js +15.5 KB through motion.js's toast re-export, domain/meter.js +4 KB through ring(), en.js
// +2.4 KB, ACC0's config/log/backup/store/idb +3 KB). Fix pass: ui/toast.js loads on the first toast (motion.js).
const BUDGET = { modules: 68, rawKB: 760, gzipKB: 262 };

// rarely needed at start, each loaded with import() where it is used
const NEVER = [
  'src/data/restore.js', 'src/data/migrate.js', 'src/data/cutover.js', 'src/data/progress.js',
  'src/domain/match.js', 'src/domain/wordbuild-family.js', 'src/domain/wordbuild-grade.js', 'src/domain/atlas.js',
  'src/domain/progress.js', 'src/domain/cardmerge.js', 'src/ui/toast.js',
];

const graph = () => importGraph('src/main.js', p => read(p).toString('utf8'));

test('the boot graph stays within its budget', () => {
  const g = graph();
  let raw = 0, gz = 0;
  for (const f of g) { const b = read(f); raw += b.length; gz += gzipSync(b, { level: 6 }).length; }
  const now = { modules: g.length, rawKB: Math.ceil(raw / 1024), gzipKB: Math.ceil(gz / 1024) };
  assert.ok(now.modules <= BUDGET.modules, `boot graph has ${now.modules} modules, budget ${BUDGET.modules}`);
  assert.ok(now.rawKB <= BUDGET.rawKB, `boot graph is ${now.rawKB} KB raw, budget ${BUDGET.rawKB} KB`);
  assert.ok(now.gzipKB <= BUDGET.gzipKB, `boot graph is ${now.gzipKB} KB gzip, budget ${BUDGET.gzipKB} KB`);
});

test('the boot graph reaches none of the modules that load on demand', () => {
  const g = new Set(graph());
  assert.deepEqual(NEVER.filter(f => g.has(f)), []);
});

/* ---------- the restore journal at start (data/restore-journal.js) ----------
   Boot reads the journal and loads data/restore.js only for a restore or an undo that was cut off. These tests load
   the data layer after a module hook is in place, so they see which modules a start really loads. */

const loaded = new Set();
const { registerHooks } = /** @type {any} */ (await import('node:module'));
registerHooks?.({ resolve(/** @type {string} */ spec, /** @type {any} */ ctx, /** @type {any} */ next) { const r = next(spec, ctx); loaded.add(r.url); return r; } });
const restoreLoaded = () => [...loaded].some(u => u.endsWith('/src/data/restore.js'));
const NO_HOOKS = registerHooks ? false : 'node:module registerHooks is missing (Node 22.15 or later)';

const DAY = '2026-10-04';
const clock = { today: () => DAY };
const card = (/** @type {number} */ u) => ({ S: 2, D: 5, due: DAY, reps: 1, lapses: 0, last: DAY, first: DAY, stage: 1, streak: 0, learn: null, relearn: false, u, hist: [] });

/** A device with one profile, card BP:a answered here (u 1) and a restore that wrote BP:a (u 2) and BP:new. */
async function restoredDevice(/** @type {'applying' | 'undoing' | 'done'} */ stage) {
  const { createMemoryAdapter } = await import('../../src/data/adapters/memory.js');
  const { openSession } = await import('../../src/data/session.js');
  const { fnv1a } = await import('../../src/data/ids.js');
  const { canon } = await import('../../src/domain/cardmerge.js');
  const { JOURNAL_KV } = await import('../../src/data/restore-journal.js');
  const hash = (/** @type {any} */ v) => fnv1a(canon(v ?? null));
  const adapter = createMemoryAdapter();
  const s0 = await openSession({ adapter, legacyStorage: null, clock });
  const pid = s0.profile.id;
  await adapter.putCards(pid, 'b1', [['BP:a', card(2)], ['BP:new', card(2)]]);
  await adapter.putKV('device', JOURNAL_KV, {
    id: `1-${s0.device.deviceId}`, at: '', kind: 'restore', profileId: pid, stage, counts: {}, sources: null,
    before: { cards: { b1: { 'BP:a': card(1), 'BP:new': null } }, kv: {} },
    after: { cards: { b1: { 'BP:a': hash(card(2)), 'BP:new': hash(card(2)) } }, kv: {} },
  });
  return { adapter, pid, openSession, JOURNAL_KV };
}

test('an everyday start (a finished restore in the journal) loads none of restore, migrate or cutover', { skip: NO_HOOKS }, async () => {
  const { adapter, openSession, JOURNAL_KV } = await restoredDevice('done');
  // the first start of restoredDevice ran the (empty) legacy import; from here on only this start counts
  loaded.clear();
  const s = await openSession({ adapter, legacyStorage: null, clock });
  assert.equal(s.restoreRecovered, null);
  assert.equal(s.store.cards('b1')['BP:a'].u, 2, 'a finished restore stays');
  assert.equal((await adapter.loadScope('device'))[JOURNAL_KV].stage, 'done');
  assert.equal(restoreLoaded(), false, 'restore.js stays out of an everyday start');
  for (const m of ['migrate.js', 'cutover.js']) assert.ok(![...loaded].some(u => u.endsWith(`/src/data/${m}`)), `${m} stays out of an everyday start`);
});

test('the module hook sees a module imported again (so the test above can see a lazy import)', { skip: NO_HOOKS }, async () => {
  await import('../../src/data/migrate.js');
  loaded.clear();
  await import('../../src/data/migrate.js');
  assert.ok([...loaded].some(u => u.endsWith('/src/data/migrate.js')));
});

test('a restore cut off mid-way (applying) is put back at the next start, through the lazy import', { skip: NO_HOOKS }, async () => {
  const { adapter, openSession, JOURNAL_KV } = await restoredDevice('applying');
  const s = await openSession({ adapter, legacyStorage: null, clock });
  assert.equal(s.restoreRecovered, 'rolledBack');
  assert.equal(restoreLoaded(), true);
  assert.equal(s.store.cards('b1')['BP:a'].u, 1, 'the card as it was before the restore');
  assert.equal(s.store.cards('b1')['BP:new'], undefined, 'what the restore added is gone');
  assert.equal((await adapter.loadScope('device'))[JOURNAL_KV].stage, 'rolledBack');
  const again = await openSession({ adapter, legacyStorage: null, clock });
  assert.equal(again.restoreRecovered, null, 'a second start finds nothing to do');
});

test('an undo cut off mid-way (undoing) is finished at the next start, keeping a card changed since', { skip: NO_HOOKS }, async () => {
  const { adapter, pid, openSession, JOURNAL_KV } = await restoredDevice('undoing');
  await adapter.putCards(pid, 'b1', [['BP:new', card(3)]]);   // answered after the restore: the undo keeps it
  const s = await openSession({ adapter, legacyStorage: null, clock });
  assert.equal(s.restoreRecovered, 'undone');
  assert.equal(s.store.cards('b1')['BP:a'].u, 1);
  assert.equal(s.store.cards('b1')['BP:new'].u, 3);
  assert.equal((await adapter.loadScope('device'))[JOURNAL_KV].stage, 'undone');
});

test('a cut-off restore whose code cannot load stops the start; nothing opens over it', async () => {
  const { recoverIfCutOff } = await import('../../src/data/restore-journal.js');
  const { adapter, pid, openSession, JOURNAL_KV } = await restoredDevice('applying');
  const offline = () => Promise.reject(new TypeError('Failed to fetch dynamically imported module'));
  await assert.rejects(recoverIfCutOff(adapter, pid, offline), (/** @type {any} */ e) => e.fatal === true);
  await assert.rejects(openSession({ adapter, legacyStorage: null, clock, recover: (a, p) => recoverIfCutOff(a, p, offline) }), /did not load/);
  assert.equal((await adapter.loadScope('device'))[JOURNAL_KV].stage, 'applying', 'left for the next start');
  // the next start with the code there recovers as usual
  const s = await openSession({ adapter, legacyStorage: null, clock });
  assert.equal(s.restoreRecovered, 'rolledBack');
  assert.equal(s.store.cards('b1')['BP:a'].u, 1);
});

test('a journal of another profile, or none, loads nothing and changes nothing', async () => {
  const { recoverIfCutOff } = await import('../../src/data/restore-journal.js');
  const { adapter, pid } = await restoredDevice('applying');
  let calls = 0;
  const load = async () => { calls++; return import('../../src/data/restore.js'); };
  assert.equal(await recoverIfCutOff(adapter, 'another-profile', load), null);
  const { createMemoryAdapter } = await import('../../src/data/adapters/memory.js');
  assert.equal(await recoverIfCutOff(createMemoryAdapter(), pid, load), null);
  assert.equal(calls, 0);
});
