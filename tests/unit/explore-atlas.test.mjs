// Explore map (src/domain/atlas.js, tools/build-atlas.mjs): the layout is deterministic, a position never depends on
// knowledge, new content only appends, the modes group items as documented, and the encodings never rely on hue.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build, sources, OUT, METRICS } from '../../tools/build-atlas.mjs';
import * as A from '../../src/domain/atlas.js';

const metrics = JSON.parse(readFileSync(METRICS, 'utf8'));
const src = sources();
const shipped = readFileSync(OUT, 'utf8');
const map = A.decode(JSON.parse(shipped));
const N = map.items.id.length;

/** Every item's place in every mode: 'mode|id' → 'x,y'. @param {any} m decoded map */
function places(m) {
  /** @type {Map<string, string>} */ const out = new Map();
  for (const [mode, gs] of Object.entries(m.modes)) {
    const P = A.positions(/** @type {any[]} */ (gs), m.items.id.length);
    for (let i = 0; i < m.items.id.length; i++) if (!Number.isNaN(P.X[i])) out.set(`${mode}|${m.items.id[i]}`, `${P.X[i]},${P.Y[i]}`);
  }
  return out;
}

test('the same content builds the same map, byte for byte, fresh or from the shipped map', () => {
  const a = build(src, metrics, null), b = build(src, metrics, null);
  assert.equal(a, b);
  assert.equal(build(src, metrics, JSON.parse(shipped)), shipped, 'content/atlas/de.json is current');
});

test('positions take no knowledge: the decoded map is the same before and after a word is learnt', () => {
  // the only inputs are the content and the font's widths; knowledge reaches the map only through encode() and summarise()
  assert.equal(A.positions.length, 2);
  const before = places(map);
  const learnt = new Map([['W:der_Apfel', { state: 'known', today: true }]]);
  void learnt;   // nothing to pass: there is no parameter that could carry it
  assert.deepEqual(places(A.decode(JSON.parse(shipped))), before);
});

test('a new word in the content moves nothing: it takes a new line at the end of its groups', () => {
  const words = [...src.words, { id: 'der_Testapfel', w: 'Testapfel', art: 'der', pl: null, pos: 'noun', en: ['test apple'], alt: [], level: 'A2', theme: 'food', rank: 99999, zipf: 1.2 }];
  const clusters = { ...src.clusters, morph: { ...src.clusters.morph, der_Testapfel: { stem: 'testapfel' } } };
  const next = A.decode(JSON.parse(build({ ...src, words, clusters }, metrics, JSON.parse(shipped))));
  const before = places(map), after = places(next);
  for (const [k, v] of before) assert.equal(after.get(k), v, `${k} moved`);
  const added = [...after.keys()].filter(k => !before.has(k));
  assert.deepEqual(added.sort(), ['level|W:der_Testapfel', 'topic|W:der_Testapfel', 'type|W:der_Testapfel']);
  // it sits on a line below every other item of its topic
  const g = next.modes.topic.find((/** @type {any} */ x) => x.key === 'topic:food');
  const j = g.items.indexOf(next.items.id.indexOf('W:der_Testapfel'));
  assert.equal(j, g.items.length - 1);
  assert.ok(g.ln[j] > Math.max(...g.ln.slice(0, j)));
});

test('a group without room asks for a repack instead of moving words', () => {
  const many = Array.from({ length: 400 }, (_, i) => ({ id: `das_Testwort${i}`, w: `Testwort${i}`, art: 'das', pl: null, pos: 'noun', en: ['x'], alt: [], level: 'C2', theme: 'food', rank: 90000 + i, zipf: 1 }));
  const morph = { ...src.clusters.morph }; for (const w of many) morph[w.id] = { stem: 'x' };
  assert.throws(() => build({ ...src, words: [...src.words, ...many], clusters: { ...src.clusters, morph } }, metrics, JSON.parse(shipped)), /repack/);
});

test('one place per item per mode; the big modes hold every item', () => {
  for (const [mode, gs] of Object.entries(map.modes)) {
    const seen = new Set();
    for (const g of /** @type {any[]} */ (gs)) for (const i of g.items) { assert.ok(!seen.has(i), `${mode}: ${map.items.id[i]} twice`); seen.add(i); }
    if (['topic', 'level', 'type'].includes(mode)) assert.equal(seen.size, N, `${mode} holds every item`);
  }
});

test('discs do not overlap, words stay inside their disc and never overlap on a line', () => {
  for (const [mode, gs] of Object.entries(map.modes)) {
    const G = /** @type {any[]} */ (gs);
    for (let a = 0; a < G.length; a++) for (let b = a + 1; b < G.length; b++) {
      assert.ok(Math.hypot(G[a].x - G[b].x, G[a].y - G[b].y) >= G[a].r + G[b].r, `${mode}: ${G[a].key} overlaps ${G[b].key}`);
    }
    const P = A.positions(G, N);
    for (const g of G) {
      for (let j = 0; j < g.items.length; j++) {
        const i = g.items[j], x0 = P.X[i] - g.x, x1 = x0 + map.items.w[i] / 10, yb = P.Y[i] - g.y;
        for (const [x, y] of [[x0, yb - A.FS * 0.75], [x1, yb - A.FS * 0.75], [x0, yb + 4], [x1, yb + 4]]) assert.ok(Math.hypot(x, y) <= g.r, `${mode} ${g.key}: ${map.items.id[i]} leaves its disc`);
        if (j && g.ln[j] === g.ln[j - 1]) assert.ok(g.ix[j] >= g.ix[j - 1] + map.items.w[g.items[j - 1]] + A.GAP * 10 - 2, `${mode}: ${map.items.id[i]} overlaps its neighbour`);
      }
    }
  }
});

test('topic: every word and phrase in its topic, the grammar concepts in Grammar', () => {
  const byKey = new Map(map.modes.topic.map((/** @type {any} */ g) => [g.key, g]));
  const at = (/** @type {string} */ id) => map.modes.topic.find((/** @type {any} */ g) => g.items.includes(map.items.id.indexOf(id)))?.key;
  assert.equal(at('W:der_Apfel'), 'topic:food');
  const chunk = /** @type {[string, string]} */ (Object.entries(src.clusters.topics.chunks).find(([, t]) => t !== 'communication'));
  assert.equal(at(`K:${chunk[0]}`), `topic:${chunk[1]}`);
  // phrases about talking and writing are grouped by their kind
  const talk = /** @type {[string, string]} */ (Object.entries(src.clusters.topics.chunks).find(([, t]) => t === 'communication'));
  const cat = src.chunksEn.find((/** @type {any} */ e) => e.id === talk[0]).category;
  assert.equal(at(`K:${talk[0]}`), `topic:phrases-${cat.replace(/_/g, '-')}`);
  assert.equal(byKey.get(`topic:phrases-${cat.replace(/_/g, '-')}`).cluster, null);
  assert.equal(at('GC:akkusativ'), 'topic:grammar');
  assert.equal(byKey.get('topic:food').cluster, 'topic:food');
  assert.equal(byKey.get('topic:grammar').cluster, null);
});

test('word type: der, die and das nouns apart, phrases and grammar in their own groups; articles on every noun', () => {
  const I = map.items;
  for (const g of map.modes.type) {
    const kind = g.key.slice(5);
    for (const i of g.items) {
      if (['der', 'die', 'das'].includes(kind)) { assert.equal(I.p[i], 'noun'); assert.equal(A.ARTICLES[I.a[i]], kind); }
      if (kind === 'phrase') assert.equal(I.k[i], 1);
      if (kind === 'grammar') assert.equal(I.k[i], 2);
    }
  }
  for (let i = 0; i < N; i++) if (I.p[i] === 'noun' && I.k[i] === 0) assert.ok(I.a[i] > 0 && I.aw[i] > 0, `${I.id[i]} has an article`);
});

test('opposites: primary pairs only, side by side on one line with their partner', () => {
  const pairs = src.clusters.opposites.pairs.filter((/** @type {any} */ p) => p.primary);
  const P = A.positions(map.modes.opp, N);
  let n = 0;
  for (const p of pairs) {
    const a = map.items.id.indexOf(`W:${p.a}`), b = map.items.id.indexOf(`W:${p.b}`);
    if (a < 0 || b < 0) continue;
    n++;
    assert.equal(P.P[a], b); assert.equal(P.P[b], a);
    assert.equal(P.Y[a], P.Y[b]);
    assert.ok(P.X[b] > P.X[a]);
  }
  assert.ok(n > 100);
});

test('family: the head first, then its members; level: one group per level in order', () => {
  const f = src.clusters.families[0];
  const g = map.modes.family.find((/** @type {any} */ x) => x.key === `family:${f.id}`);
  assert.equal(map.items.id[g.items[0]], `W:${f.head}`);
  assert.deepEqual(new Set(g.items.map((/** @type {number} */ i) => map.items.id[i])), new Set(f.members.map((/** @type {string} */ m) => `W:${m}`)));
  assert.deepEqual(map.modes.level.map((/** @type {any} */ x) => x.key), A.LEVELS.map(L => `level:${L}`));
  for (const x of map.modes.level) for (const i of x.items) assert.equal(A.LEVELS[map.items.L[i]], x.key.slice(6));
});

test('source: the first source wins, items in the order first met, so a group grows at its end', () => {
  const items = A.itemsFrom(src).slice(0, 400);
  const w = new Map(items.map(it => [it.id, A.itemWidths(A.widthOf(metrics), it).w]));
  /** @type {Record<string, string[]>} */ const src1 = { 'W:um.prep': ['lookup', 'practice'], 'W:sein.verb': ['exam'], 'W:haben.verb': ['practice'] };
  const first = (/** @type {string} */ id) => ({ 'W:haben.verb': '2026-01-02', 'W:um.prep': '2026-01-01' })[id] || '';
  const g1 = A.sourceGroups(items, id => ({ sources: src1[id] || [] }), first);
  assert.deepEqual(g1.map(g => g.key), ['source:exam', 'source:practice']);
  assert.deepEqual(g1[1].units.flat(), ['W:um.prep', 'W:haben.verb']);
  const src2 = { ...src1, 'W:werden.verb': ['practice'] };
  const l2 = A.layoutSource(A.sourceGroups(items, id => ({ sources: src2[id] || [] }), first), w);
  assert.deepEqual(l2[1].ids, ['W:um.prep', 'W:haben.verb', 'W:werden.verb']);
  // the same set lays out the same way
  assert.deepEqual(A.layoutSource(A.sourceGroups(items, id => ({ sources: src2[id] || [] }), first), w), l2);
});

test('encodings: ink plus shape, never hue alone', () => {
  const sig = (/** @type {ReturnType<typeof A.encode>} */ e) => `${e.italic}|${e.box}|${e.under}|${e.bar}`;
  const known = A.encode('known'), shaky = A.encode('shaky'), unknown = A.encode('unknown'), unseen = A.encode('unseen'), today = A.encode('known', true);
  // every state but shaky has a shape of its own; shaky differs from known by ink strength (ink-3 against ink)
  const shapes = [known, unknown, unseen, today].map(sig);
  assert.equal(new Set(shapes).size, 4);
  assert.equal(sig(shaky), sig(known)); assert.notEqual(shaky.ink, known.ink);
  assert.ok(unknown.box && unknown.bar === 'outline');
  assert.ok(unseen.italic && unseen.bar === 'faint');
  assert.ok(today.under && today.ink === 'x-today');
  for (const e of [known, shaky, unknown, unseen, today]) assert.match(e.ink, /^x-/, 'map colours come from the x-* tokens, never role, ok or bad');
  assert.deepEqual(A.STATE_ORDER, ['unseen', 'unknown', 'shaky', 'known']);
});

test('group numbers: counts, the weighted share and what to study next', () => {
  /** @type {Record<string, any>} */ const st = { a: 'known', b: 'shaky', c: 'unknown', d: 'unseen', e: 'unknown' };
  const get = (/** @type {string} */ id) => ({ state: st[id], today: id === 'a' });
  const wt = (/** @type {string} */ id) => ({ a: 5, b: 1, c: 1, d: 3, e: 4 })[id] || 1;
  const s = A.summarise(Object.keys(st), get, wt);
  assert.deepEqual([s.n, s.known, s.shaky, s.unknown, s.unseen, s.today], [5, 1, 1, 2, 1, 1]);
  assert.ok(Math.abs(s.score - (5 + 0.5) / 14) < 1e-9);
  assert.deepEqual(A.nextUp(Object.keys(st), get, wt), ['e', 'c', 'b', 'd']);
});

test('widths come from the vendored advance table; a missing glyph stops the build', () => {
  const w = A.widthOf(metrics);
  assert.ok(Math.abs(w('Wasser') - w('W') - w('asser')) < 1e-9);
  assert.ok(w('die Zitrone') > w('Zitrone'));
  assert.throws(() => w('日本'), /no glyph/);
  assert.equal(A.chunkText('Könnten Sie vielleicht [Infinitiv]? / Ich wollte fragen, ob Sie [Satz]'), 'Könnten Sie vielleicht …?');
});
