// domain/knowledge.js: one score per item from every source. Synthetic records only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { knowledge, resolver, stateOf, conceptItems, KNOWN_R } from '../../src/domain/knowledge.js';
import * as FS from '../../src/domain/fsrs.js';
import * as D8 from '../../src/domain/days.js';
import * as RD from '../../src/domain/b1ready.js';
import { origin } from '../../src/domain/itemids.js';

const today = '2026-03-10';
const words = [
  { id: 'der_Raum', w: 'Raum', zipf: 5.1 }, { id: 'groß.adj', w: 'groß', zipf: 6 }, { id: 'klein.adj', w: 'klein', zipf: 6 },
  { id: 'bei.prep', w: 'bei', zipf: 6.5 }, { id: 'laut.adj', w: 'laut', zipf: 4.5 }, { id: 'laut.prep', w: 'laut', zipf: 4 },
];
/** A graduated card last reviewed t days ago with stability S. */
const card = (t, S, extra = {}) => ({ S, D: 5, reps: 3, lapses: 0, last: D8.add(today, -t), first: D8.add(today, -30), due: D8.add(today, 1), learn: null, relearn: false, stage: 1, hist: [[D8.add(today, -t), 3, 3000, 't', '']], ...extra });
const learning = () => ({ S: 3, D: 5, reps: 1, lapses: 0, last: today, first: today, due: today, learn: 1, relearn: false, hist: [[today, 3, 3000, 't', '']] });

test('one lemma reached from three sources is one item with one score', () => {
  const resolve = resolver({ words });
  const k = knowledge({ today, resolve, examWords: ['W:der_Raum'],
    decks: { b1: { 'BW:raum': card(10, 5) }, script: { 'SW:raum': card(2, 20) }, clusters: { 'W:der_Raum': card(1, 3) } } });
  assert.equal(k.items.size, 1);
  const s = k.get('W:der_Raum');
  assert.deepEqual(s.cards.sort(), ['b1/BW:raum', 'clusters/W:der_Raum', 'script/SW:raum']);
  assert.deepEqual(s.sources, ['exam', 'practice', 'script']);
  // the best memory trace wins: the script card (2 days, S 20)
  assert.ok(Math.abs(s.recall - FS.R(2, 20)) < 1e-12);
  assert.equal(s.stability, 20);
  assert.equal(s.state, 'known');
});

test('card ids map to items: speaking situations, opposites, preposition gaps, script sections', () => {
  const r = resolver({ words, chunkOf: { 'SS:greet-01': 'ENG_CHUNK_1206', 'BP:x': 'ENG_CHUNK_0001' }, gapPrep: { 'bei-eltern': 'bei.prep' } });
  assert.equal(r('SS:greet-01', 'speak'), 'K:ENG_CHUNK_1206');
  assert.equal(r('SS:order-02', 'speak'), 'SS:order-02');
  assert.equal(r('BP:x'), 'K:ENG_CHUNK_0001');
  assert.equal(r('CO:groß.adj~klein.adj', 'clusters'), 'W:klein.adj');
  assert.equal(r('CF:der_Raum', 'clusters'), 'W:der_Raum');
  assert.equal(r('CP:bei-eltern', 'clusters'), 'W:bei.prep');
  assert.equal(r('SR:abc.s1', 'script'), null);
  assert.equal(r('BW:zeitgeist'), 'BW:zeitgeist', 'a lemma not in the list stays its own item');
  assert.equal(r('SW:zeitgeist', 'script'), 'BW:zeitgeist', 'script and exam meet on the slug');
  assert.equal(r('BW:laut'), 'W:laut.adj', 'two list words with one spelling: the more frequent');
  assert.equal(r('G:akkusativ.01'), 'G:akkusativ.01');
});

test('state thresholds: 0.90 known, 0.70 shaky, a recent lapse caps at shaky, learning is not known', () => {
  assert.equal(stateOf(KNOWN_R, true, false), 'known');
  assert.equal(stateOf(0.8999, true, false), 'shaky');
  assert.equal(stateOf(0.70, true, false), 'shaky');
  assert.equal(stateOf(0.6999, true, false), 'unknown');
  assert.equal(stateOf(0.99, true, true), 'shaky');
  assert.equal(stateOf(0.99, false, false), 'unknown');
  // R(t = S) is exactly 0.9 in FSRS-4.5
  const k = knowledge({ today, decks: { b1: {
    'G:a': card(4, 4), 'G:b': card(9, 4), 'G:c': card(60, 2),
    'G:d': card(1, 30, { hist: [[D8.add(today, -3), 1, 4000, 't', ''], [D8.add(today, -1), 3, 3000, 't', '']] }),
    'G:e': card(1, 30, { hist: [[D8.add(today, -8), 1, 4000, 't', ''], [D8.add(today, -1), 3, 3000, 't', '']] }),
    'G:f': learning(),
  } } });
  assert.equal(k.get('G:a').state, 'known');
  assert.equal(k.get('G:b').state, 'shaky');
  assert.equal(k.get('G:c').state, 'unknown');
  assert.equal(k.get('G:d').state, 'shaky', 'Again three days ago');
  assert.equal(k.get('G:e').state, 'known', 'Again eight days ago no longer caps');
  assert.equal(k.get('G:f').state, 'unknown');
  assert.ok(k.get('G:f').recall < 0.7);
  assert.equal(k.get('G:zzz').state, 'unseen');
  assert.equal(k.get('G:f').today, true);
});

test('Igloo Test results and Drill intervals, exam words and Look up views', () => {
  const epoch = 20500;
  const k = knowledge({ today, epoch, lang: 'german', examWords: ['W:groß.adj'], seen: { 'W:klein.adj': { first: today, last: today, n: 2 } },
    srs: { 'german|K:ENG_CHUNK_0001': { ivl: 21, reps: 4, last: epoch - 5 }, 'french|K:ENG_CHUNK_0001': { ivl: 1, reps: 1, last: epoch } },
    know: { 'german|W:der_Raum': { s: 'known', last: epoch - 2 }, 'german|G:x': { s: 'unknown', last: epoch - 1 }, 'german|G:y': { s: 'shaky', last: epoch - 40 } },
    decks: { b1: { 'G:x': card(20, 60) } } });
  const chunk = k.get('K:ENG_CHUNK_0001');
  assert.ok(Math.abs(chunk.recall - FS.R(5, 21)) < 1e-12);
  assert.equal(chunk.state, 'known'); assert.deepEqual(chunk.sources, ['test']);
  assert.equal(k.get('W:der_Raum').state, 'known', 'a Test "known" two days ago');
  assert.equal(k.get('G:x').state, 'shaky', 'a failed Test yesterday caps a well-scheduled card');
  assert.equal(k.get('G:y').state, 'shaky');
  const g = k.get('W:groß.adj');
  assert.equal(g.state, 'unknown'); assert.deepEqual(g.sources, ['exam']);
  const kl = k.get('W:klein.adj');
  assert.equal(kl.state, 'unknown'); assert.deepEqual(kl.sources, ['lookup']);
});

test('sources: a recorded src wins; older cards fall back on their deck and prefix', () => {
  const k = knowledge({ today, examWords: ['W:groß.adj'], decks: {
    b1: { 'W:groß.adj': card(1, 9), 'F:att-1': card(1, 9), 'BP:s1-x': card(1, 9), 'G:z': card(1, 9, { src: 'lookup' }) },
    speak: { 'SS:greet-01': card(1, 9) }, clusters: { 'W:klein.adj': card(1, 9) } } });
  assert.deepEqual(k.get('W:groß.adj').sources, ['exam']);
  assert.deepEqual(k.get('F:att-1').sources, ['exam']);
  assert.deepEqual(k.get('BP:s1-x').sources, ['speech']);
  assert.deepEqual(k.get('G:z').sources, ['lookup']);
  assert.deepEqual(k.get('SS:greet-01').sources, ['speech']);
  assert.deepEqual(k.get('W:klein.adj').sources, ['practice']);
  assert.equal(origin('SW:x', 'script'), 'script');
});

test('new cards record where they were met; existing records get no field', () => {
  const ctx = { today, exam: null, phase: 'none' };
  const fresh = FS.schedule(null, { g: 3, src: 'script' }, ctx, 1).rec;
  assert.equal(fresh?.src, 'script');
  const old = card(3, 5); delete old.src;
  const next = FS.schedule(old, { g: 3, src: 'practice' }, ctx, 1).rec;
  assert.equal(next && 'src' in next, false, 'a card made before src keeps its shape');
  const kept = FS.schedule(/** @type {any} */ (fresh), { g: 3, src: 'practice' }, ctx, 2).rec;
  assert.equal(kept?.src, 'script', 'the first source stays');
});

test('grammar concepts are scored from their items', () => {
  const items = conceptItems({ concepts: [{ id: 'perfekt' }, { id: 'dass' }, { id: 'leer' }],
    items: [{ id: 'p1', concept: 'perfekt' }, { id: 'p2', concept: 'perfekt' }, { id: 'p3', concept: 'perfekt' }, { id: 'd1', concept: 'dass' }, { id: 'd2', concept: 'dass' }],
    b1Items: [{ id: 'BG:x', group: 'verb-final' }, { id: 'BP:y', group: 'S1' }], plan: { topics: [{ id: 'verb-final', concepts: ['dass', 'nebensatz'] }] } });
  assert.deepEqual(items, { perfekt: ['G:p1', 'G:p2', 'G:p3'], dass: ['G:d1', 'G:d2', 'BG:x'], leer: [] });
  const k = knowledge({ today, decks: { b1: { 'G:p1': card(1, 30), 'G:p2': card(1, 30), 'G:d1': card(1, 30), 'BG:x': card(200, 2) } } });
  const p = k.concept('perfekt', items.perfekt);
  assert.equal(p.id, 'GC:perfekt'); assert.equal(p.state, 'known'); assert.equal(p.seen, 2); assert.equal(p.n, 3);
  assert.ok(Math.abs(p.coverage - 2 / 3) < 1e-12);
  assert.ok(Math.abs(p.recall - (2 * FS.R(1, 30)) / 3) < 1e-12, 'unseen items count 0 in the recall');
  const d = k.concept('dass', items.dass);
  assert.equal(d.state, 'unknown', 'mean of a known and a forgotten item is below 0.70');
  assert.equal(k.concept('leer', items.leer).state, 'unseen');
  const one = k.concept('perfekt', ['G:p1', 'G:x1', 'G:x2']);
  assert.equal(one.state, 'shaky', 'known items but under half seen');
});

test('cluster counts: summary over a set of items', () => {
  const k = knowledge({ today, decks: { clusters: { 'W:groß.adj': card(1, 30), 'W:klein.adj': card(9, 4) } } });
  assert.deepEqual(k.summary(['W:groß.adj', 'W:klein.adj', 'W:der_Raum']), { known: 1, shaky: 1, unknown: 0, unseen: 1, n: 3, today: 0 });
});

test('the score reads the stores and changes nothing: B1 readiness is the same before and after', () => {
  const store = { 'BP:a': card(2, 10), 'G:b': card(5, 3), 'W:groß.adj': card(1, 2) };
  const pool = [{ id: 'BP:a', area: 'speaking', group: 'S1' }, { id: 'G:b', area: 'grammar', group: 'v2' }, { id: 'W:groß.adj', area: 'words', group: 'w' }];
  const before = JSON.stringify(store);
  const rd0 = RD.compute({ pool, store, today, exam: null, phase: 'none' });
  knowledge({ today, decks: { b1: store } });
  assert.equal(JSON.stringify(store), before);
  assert.deepEqual(RD.compute({ pool, store, today, exam: null, phase: 'none' }), rd0);
});
