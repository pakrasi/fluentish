// The map's metacognition (round 3, B3): the next best group (domain/atlas.js nextBestGroup), the gaps of a 3D
// district (gapsOf), and one known count for Today's Where you stand and the map's header (shared/data.js
// wordsKnown), with Igloo's placement import run before the first count. Synthetic profile and ids only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { nextBestGroup, gapsOf, STATE_CODE, NEXT_N } from '../../src/domain/atlas.js';
import { context } from '../../src/core/clock.js';

const K = STATE_CODE;

test('the next best group has the most common words he does not know, at or under his level', () => {
  // items: 0-3 group A, 4-9 group B, 10-12 group C
  const kind = ['w', 'w', 'w', 'c', 'w', 'w', 'w', 'w', 'w', 'w', 'w', 'w', 'w'];
  const level = ['A1', 'A1', 'A2', 'A1', 'A1', 'B2', 'B2', 'B2', 'A2', 'A2', 'A1', 'A1', 'B1'];
  const F = [5, 5, 4.5, 5, 5, 6, 6, 6, 3, 3, 4.2, 4.1, 4.4];
  const st = [K.unseen, K.unknown, K.unseen, K.unseen, K.unseen, K.unseen, K.unseen, K.unseen, K.unseen, K.unseen, K.shaky, K.unseen, K.unknown];
  const text = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l…', 'm'];
  const groups = [{ items: [0, 1, 2, 3] }, { items: [4, 5, 6, 7, 8, 9] }, { items: [10, 11, 12] }];
  const o = { kind, level, F, st, text };
  // B1: A has 3 (the phrase does not count), B has 1 (B2 words are above his level, 8 and 9 are rare), C has 2 (11 has a gap)
  const b1 = nextBestGroup(groups, { ...o, upTo: 'B1' });
  assert.deepEqual(b1, { gi: 0, n: 3, ids: [0, 1, 2] });
  // B2: B has 4 now
  assert.equal(nextBestGroup(groups, { ...o, upTo: 'B2' })?.gi, 1);
  // no level set means B1
  assert.equal(nextBestGroup(groups, { ...o, upTo: null })?.gi, 0);
  // A1: A has 2, C has 1 (the B1 word is above): A
  assert.deepEqual(nextBestGroup(groups, { ...o, upTo: 'A1' }), { gi: 0, n: 2, ids: [0, 1] });
  // known words never count; everything known: no suggestion
  assert.equal(nextBestGroup(groups, { ...o, st: st.map(() => K.known), upTo: 'B2' }), null);
  // a tie goes to the smaller group
  const tie = nextBestGroup([{ items: [0, 1, 3] }, { items: [10, 12] }], { ...o, st: st.map(() => K.unseen), upTo: 'B1' });
  assert.equal(tie?.gi, 1);
});

test('the next best group studies at most one round of words, the most common first', () => {
  const n = 30, items = Array.from({ length: n }, (_, i) => i);
  const r = nextBestGroup([{ items }], { kind: items.map(() => 'w'), level: items.map(() => 'A1'), F: items.map(i => 4 + i / 10), st: items.map(() => K.unseen), text: items.map(i => `w${i}`), upTo: 'B1' });
  assert.equal(r?.n, n);
  assert.equal(r?.ids.length, NEXT_N);
  assert.deepEqual(r?.ids.slice(0, 3), [29, 28, 27]);
});

test('the gaps of a district: open scaffolds first, then empty plots, never known, shaky, phrases or slots', () => {
  const kind = ['w', 'w', 'w', 'w', 'c', 'w', 'w'];
  const st = [K.known, K.unseen, K.unknown, K.shaky, K.unknown, K.unknown, K.unseen];
  const F = [6, 5, 3, 6, 6, 4, 6];
  const text = ['a', 'b', 'c', 'd', 'e', 'f', '(sich) g'];
  assert.deepEqual(gapsOf([0, 1, 2, 3, 4, 5, 6], { kind, st, F, text }), [5, 2, 1]);
});

/* ---------- one known count: Today vs the map ---------- */

const ROOT = new URL('../../', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('content/manifest.json', ROOT), 'utf8'));
const files = new Map(manifest.files.map(f => [f.id, f.path]));
const content = {
  /** @param {string} id */
  load: async id => { const p = files.get(id); if (!p) throw new Error(`no ${id}`); return JSON.parse(readFileSync(new URL(`content/${p}`, ROOT), 'utf8')); },
  manifest: async () => manifest,
};
const TODAY = '2026-10-05';
function memStore() {
  /** @type {Record<string, Record<string, any>>} */ const decks = {};
  /** @type {Record<string, any>} */ const kv = { meta: { migratedAt: 1 }, 'b1.session': {} };
  return {
    kv, decks,
    cards: (/** @type {string} */ d) => (decks[d] ||= {}),
    putCards(/** @type {string} */ d, /** @type {[string, any][]} */ list) { const c = (decks[d] ||= {}); for (const [id, r] of list) { if (r == null) delete c[id]; else c[id] = r; } },
    append() {}, attempts: () => [],
    get: (/** @type {string} */ n, /** @type {any} */ f) => (n in kv ? kv[n] : f),
    set: (/** @type {string} */ n, /** @type {any} */ v) => { kv[n] = v; },
    update: (/** @type {string} */ n, /** @type {(v: any) => any} */ fn, /** @type {any} */ f) => { kv[n] = fn(n in kv ? kv[n] : f); },
  };
}
const settings = { language: 'german', level: 'B1', minutesPerDay: 30, newPerDay: 10, rev: {}, exam: null, practice: {} };
const ctxFor = (/** @type {any} */ store) => ({ store, content, settings: () => settings, clock: { ctx: () => ({ ...context({ today: TODAY, exam: null }), today: TODAY }), epochDay: () => 20366, today: () => TODAY },
  t: (/** @type {string} */ k) => k, bus: { on: () => () => {}, emit() {} }, app: {} });

test('a migrated profile: the map\'s first count runs the placement import first and equals Today\'s', async () => {
  // Igloo's Test said he knows these common words (synthetic legacy data on this device)
  const words = JSON.parse(readFileSync(new URL('content/igloo/words/de.json', ROOT), 'utf8')).filter((/** @type {any} */ w) => !/[…()[\]]/.test(w.w)).slice(0, 60);
  const know = Object.fromEntries(words.map((/** @type {any} */ w) => [`german|W:${w.id}`, { s: 'known', last: 20300 }]));
  const ls = new Map([['doors.know.v1', JSON.stringify(know)]]);
  /** @type {any} */ (globalThis).localStorage = { getItem: (/** @type {string} */ k) => ls.get(k) ?? null, setItem: (/** @type {string} */ k, /** @type {string} */ v) => ls.set(k, v), removeItem: (/** @type {string} */ k) => ls.delete(k) };
  /** @type {any} */ (globalThis).navigator ||= { onLine: false };
  // Today's section module draws with the kit: enough of a page for it to load (nothing is drawn here)
  /** @type {any} */ (globalThis).document ||= { documentElement: { classList: { add() {} }, dataset: {}, style: {} } };
  /** @type {any} */ (globalThis).matchMedia ||= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  try {
    const { loadAtlas, scores, totals } = await import('../../src/data/atlas.js');
    const { wordsKnown, placementPending } = await import('../../src/features/shared/data.js');
    const { standingCounts } = await import('../../src/features/today/standing.js');
    // what the map counted before (no pool loaded yet): the placement marks are missing
    const store = memStore(), ctx = ctxFor(store);
    assert.equal(placementPending(store), true);
    const A = await loadAtlas(ctx);
    const before = totals(A, await scores(ctx, A));
    // the map's first count now (a fresh visit straight to the map)
    const map = await wordsKnown(ctx);
    assert.equal(placementPending(store), false, 'the import ran');
    assert.ok(map && map.known > before.known, `the first count includes the placement marks (${before.known} → ${map?.known})`);
    // Today's Where you stand, on the same profile: the same number
    const today = await standingCounts(ctx, []);
    assert.deepEqual(today?.words, map);
    // and a second profile whose first stop is Today gets the same as one whose first stop is the map
    const s2 = memStore(), c2 = ctxFor(s2);
    const t2 = await standingCounts(c2, []);
    const m2 = await wordsKnown(c2);
    assert.deepEqual(t2?.words, m2);
    assert.deepEqual(m2, map);
    // the import ran once: a second count changes nothing and marks nothing again
    const marks = Object.keys(store.cards('clusters')).length + Object.keys(store.cards('b1')).length;
    await wordsKnown(ctx);
    assert.equal(Object.keys(store.cards('clusters')).length + Object.keys(store.cards('b1')).length, marks);
  } finally { delete /** @type {any} */ (globalThis).localStorage; }
});
