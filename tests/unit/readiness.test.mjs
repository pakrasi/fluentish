// readiness.js. Ported from the legacy node script with the assertions unchanged; run with `node --test tests/unit`.
import { test } from 'node:test';
import R from '../../src/domain/readiness.js';
import assert from 'node:assert/strict';

const near = (a, b, msg, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${msg}: ${a} != ${b}`);
const today = 20000;

let chunksDe, words, chunksEn, priority, concepts, items, P, hist, ctx, lv, k, k2, k3, kg, noGrammar, ks, kf, everything, lvls, kgap, g;

test('sample data: A1 and A2 each with 10 words, 4 chunks, 1 concept of 8 items', () => {
  words = [];
  for (const L of ['A1', 'A2']) for (let i = 0; i < 10; i++) words.push({ id: `${L}_${i}`, level: L, zipf: i < 5 ? 6 : 2, theme: i < 5 ? 'food' : 'home' });
  chunksEn = [], chunksDe = {};
  for (const L of ['A1', 'A2']) for (let i = 0; i < 4; i++) { const id = `C_${L}_${i}`; chunksEn.push({ id, level: L, category: 'collocation' }); chunksDe[id] = { t: 'x' }; }
  chunksEn.push({ id: 'C_nogerman', level: 'A1' });   // no German: not in the pool
  priority = { prio: { C_A1_0: 1, C_A1_1: 2 }, functions: [{ name: 'Plans', ids: ['C_A1_0'] }] };
  concepts = [{ id: 'perfekt', level: 'A1', name: 'Perfekt' }, { id: 'dass', level: 'A2', name: 'dass', sticky: true }, { id: 'empty', level: 'A2', name: 'No items' }];
  items = [];
  for (const c of ['perfekt', 'dass']) for (let i = 0; i < 8; i++) items.push({ id: `${c}_${i}`, concept: c });

  P = R.pools({ words, chunksEn, chunksDe, priority, concepts, items });
  assert.equal(P.words.length, 20);
  assert.equal(P.chunks.length, 8, 'chunks without German are dropped');
  assert.equal(P.chunks.find(c => c.id === 'K:C_A1_0').w, 3, 'prio 1 weighs 3');
  assert.equal(P.chunks.find(c => c.id === 'K:C_A1_1').w, 2, 'prio 2 weighs 2');
  assert.equal(P.chunks.find(c => c.id === 'K:C_A1_2').w, 1, 'missing prio = 3, weighs 1');
  assert.equal(P.chunks.find(c => c.id === 'K:C_A1_0').group, 'Plans');
  assert.equal(P.words[0].w, 6, 'word weight = zipf');
  assert.equal(P.concepts.find(c => c.id === 'dass').items.length, 8);
});

test('states and credit', () => {
  assert.equal(R.itemState(null, null), null);
  assert.equal(R.itemState({ s: 'shaky' }, null), 'shaky');
  assert.equal(R.itemState({ s: 'known' }, { reps: 3, ivl: 25 }), 'solid');
  assert.equal(R.itemState(null, { reps: 2, ivl: 8 }), 'known', 'SRS-only history counts');
  assert.equal(R.credit('solid'), 1); assert.equal(R.credit('known'), 1); assert.equal(R.credit('shaky'), 0.5); assert.equal(R.credit('unknown'), 0); assert.equal(R.credit(null), 0);

  // grammar concept rules
  hist = (n, ok, day = today) => ({ s: ok === n ? 'known' : 'unknown', hist: Array.from({ length: n }, (_, i) => [day, i < ok ? 1 : 0, 3000]) });
  assert.equal(R.conceptState([hist(8, 7)], today).state, 'known', '7/8 = 88%, 8 attempts, recent');
  assert.equal(R.conceptState([hist(8, 7, today - 40)], today).state, 'shaky', 'no recent attempts');
  assert.equal(R.conceptState([hist(5, 5)], today).state, 'shaky', 'too few attempts');
  assert.equal(R.conceptState([hist(10, 6)], today).state, 'shaky', '60%');
  assert.equal(R.conceptState([hist(10, 4)], today).state, 'unknown', '40%');
  assert.equal(R.conceptState([null], today).state, null);
});

test('empty store', () => {
  ctx = know => ({ know, srs: {}, lang: 'de', today });
  lv = R.level(P, 'A1', ctx({}));
  assert.equal(lv.score, 0); assert.equal(lv.coverage, 0);
  near(lv.estimate.lo, 0, 'no data: lo 0'); near(lv.estimate.hi, 1, 'no data: hi 1');
});

test('weights: all A1 words known, nothing else', () => {
  k = {};
  for (let i = 0; i < 10; i++) k[`de|W:A1_${i}`] = { s: 'known' };
  lv = R.level(P, 'A1', ctx(k));
  near(lv.parts.words.score, 1, 'words pool full');
  near(lv.score, 0.35, 'words weigh 0.35');
  near(lv.coverage, 10 / (10 + 4 + 8), 'coverage = tested items / all items');

  // zipf weighting: only the high-zipf half known
  k2 = {};
  for (let i = 0; i < 5; i++) k2[`de|W:A1_${i}`] = { s: 'known' };
  lv = R.level(P, 'A1', ctx(k2));
  near(lv.parts.words.score, 30 / 40, 'zipf-weighted words score');
  // shaky = half credit
  k3 = {}; for (let i = 0; i < 10; i++) k3[`de|W:A1_${i}`] = { s: 'shaky' };
  near(R.level(P, 'A1', ctx(k3)).parts.words.score, 0.5, 'shaky is half');

  // chunk prio weighting: only the prio-1 chunk known -> 3 / (3+2+1+1)
  lv = R.level(P, 'A1', ctx({ 'de|K:C_A1_0': { s: 'known' } }));
  near(lv.parts.chunks.score, 3 / 7, 'prio-weighted chunk score');
  near(lv.score, 0.35 * 3 / 7, 'chunks weigh 0.35');

  // grammar from items
  kg = {}; for (let i = 0; i < 8; i++) kg[`de|G:perfekt_${i}`] = hist(1, 1);
  lv = R.level(P, 'A1', ctx(kg));
  near(lv.parts.grammar.score, 1, 'concept known'); near(lv.score, 0.30, 'grammar weighs 0.30');

  // a pool with nothing at that level drops out and the rest are rescaled
  noGrammar = R.pools({ words, chunksEn, chunksDe, priority, concepts, items: [] });
  lv = R.level(noGrammar, 'A1', ctx(k));
  near(lv.score, 0.35 / 0.70, 'rescaled without grammar');
  lv = R.level(R.pools({ chunksEn, chunksDe, concepts, items }), 'A1', ctx({}));
  assert.equal(lv.parts.words, null, 'no word list');
});

test('estimate bounds', () => {
  ks = {}; for (let i = 0; i < 10; i += 2) ks[`de|W:A1_${i}`] = { s: 'known' }; for (let i = 1; i < 10; i += 2) ks[`de|W:A1_${i}`] = { s: 'unknown' };
  ks['de|K:C_A1_0'] = { s: 'known' };
  lv = R.level(P, 'A1', ctx(ks));
  assert.ok(lv.estimate.lo >= lv.score - 1e-12, 'estimate never below the plain score');
  assert.ok(lv.estimate.hi <= 1 + 1e-12, 'estimate at most 1');
  assert.ok(lv.estimate.lo < lv.estimate.hi, 'a range while untested items remain');
  const [wl, wh] = R.wilson(0.5, 10);
  assert.ok(wl > 0.28 && wl < 0.5 && wh > 0.5 && wh < 0.72, `wilson 80%: ${wl} ${wh}`);
  near(R.wilson(1, 10)[1], 1, 'wilson upper clamps at 1');
  // fully tested: the range closes on the score
  kf = {};
  for (let i = 0; i < 10; i++) kf[`de|W:A1_${i}`] = { s: i < 7 ? 'known' : 'unknown' };
  for (let i = 0; i < 4; i++) kf[`de|K:C_A1_${i}`] = { s: 'shaky' };
  for (let i = 0; i < 8; i++) kf[`de|G:perfekt_${i}`] = hist(1, 1);
  lv = R.level(P, 'A1', ctx(kf));
  near(lv.coverage, 1, 'all tested'); near(lv.estimate.lo, lv.score, 'lo = score'); near(lv.estimate.hi, lv.score, 'hi = score');
});

test('reachable', () => {
  everything = {};
  for (const w of P.words.filter(w => w.level === 'A1')) everything[`de|${w.id}`] = { s: 'known' };
  for (const c of P.chunks.filter(c => c.level === 'A1')) everything[`de|${c.id}`] = { s: 'known' };
  for (let i = 0; i < 8; i++) everything[`de|G:perfekt_${i}`] = hist(1, 1);
  lvls = R.all(P, ctx(everything));
  assert.equal(lvls.A1.reachable, true, 'A1 always reachable');
  near(lvls.A1.score, 1, 'A1 full');
  assert.equal(lvls.A2.reachable, true, 'A2 reachable when A1 >= 80%');
  assert.equal(lvls.B1.reachable, false, 'B1 needs A2 too');
  assert.ok(lvls.B1.empty, 'no B1 items in the sample');
  lvls = R.all(P, ctx(kf));   // A1 at ~ 0.35*.7+.35*.5+.3 = 0.72
  assert.ok(lvls.A1.score < 0.8);
  assert.equal(lvls.A2.reachable, false, 'A2 not reachable below 80%');
});

test('gaps', () => {
  kgap = {};
  for (let i = 0; i < 5; i++) kgap[`de|W:A1_${i}`] = { s: 'unknown' };   // food: 0
  kgap['de|W:A1_5'] = { s: 'known' };                                     // home: 1 of 5 tested
  g = R.gaps(P, 'A1', ctx(kgap));
  assert.equal(g[0].kind, 'words'); assert.equal(g[0].id, 'food'); near(g[0].score, 0, 'food gap');
  assert.equal(g[1].id, 'home');
  assert.ok(!g.some(x => x.kind === 'chunks'), 'untested groups are not gaps');
  assert.ok(g.every(x => x.n >= 5), 'groups of 5+ only');
  // the 1-chunk "Plans" function never shows (too small); collocation group has 3 chunks here, also too small
  kgap['de|K:C_A1_0'] = { s: 'unknown' }; kgap['de|K:C_A1_2'] = { s: 'unknown' };
  g = R.gaps(P, 'A1', ctx(kgap));
  assert.ok(!g.some(x => x.kind === 'chunks'));
  for (let i = 0; i < 8; i++) kgap[`de|G:perfekt_${i}`] = hist(1, 0);
  g = R.gaps(P, 'A1', ctx(kgap));
  assert.ok(g.some(x => x.kind === 'grammar' && x.id === 'perfekt'), 'weak concept shows');
  assert.equal(g.length, 3);
});
