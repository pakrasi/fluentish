// The per-strand level gate (round 4, lane L1b): domain/levels.js, the B2 layer (features/shared/pool.js b2Layer)
// and the composer's use of both. The B1 numbers must not move: with the layer built, the B1 pool, its readiness, its
// ★/trap pace, the lexicon and (without a B2 goal, or inside a B1 exam window) the new-item order and the rounds are
// exactly what they were (PLAN-REVIEW B7). Content is the repo's; cards are synthetic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as L from '../../src/domain/levels.js';
import { buildPool } from '../../src/features/shared/pool.js';
import * as C from '../../src/features/shared/compose.js';
import * as RD from '../../src/domain/b1ready.js';
import * as S from '../../src/data/settings.js';
import { context } from '../../src/core/clock.js';
import * as D8 from '../../src/domain/days.js';

const J = (/** @type {string} */ p) => JSON.parse(readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8'));
const B1 = { items: J('content/b1/items.json'), grammar: J('content/b1/grammar.json'), bank: J('content/b1/bank.json'), plan: J('content/b1/plan.json'),
  nouns: J('content/b1/nouns.json'), schreiben: J('content/b1/schreiben.json') };
const SRC = { grammar: J('content/igloo/grammar/items_de.json'), concepts: J('content/igloo/grammar/concepts_de.json'), annot: J('content/b1/annot.json'),
  en: J('content/igloo/chunks/en.json'), de: J('content/igloo/chunks/german.json').chunks, accept: J('content/igloo/chunks/accept_german.json') };
const OLD = buildPool(B1);
const NEW = buildPool({ ...B1, b2: SRC });
const TODAY = '2026-11-02';

/** mulberry32 @param {number} seed */
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const rec = (/** @type {string} */ due, last = D8.add(due, -4)) => ({ S: 6, D: 5, due, reps: 2, lapses: 0, last, first: last, stage: 1, streak: 0, learn: null, relearn: false, u: 1, hist: [[last, 3, 900, 't', '']] });
/** Random cards over a share of the pool's items (some of the B2 layer too). @param {() => number} r @param {number} share */
function cardsFor(r, share, b2share = 0) {
  /** @type {Record<string, any>} */ const cards = {};
  for (const it of NEW.pool) if (!it.mine && r() < share) cards[it.id] = rec(D8.add(TODAY, Math.floor(r() * 20) - 8));
  for (const it of NEW.b2) if (r() < b2share) cards[it.id] = rec(D8.add(TODAY, Math.floor(r() * 20) - 8));
  return cards;
}
/** Normalised German settings with a level goal and an exam. @param {string | null} level @param {string} exam @param {string | null} date */
function settings(level, exam = 'goethe-b1', date = null) {
  const s = S.normalizeSettings({ v: 1, language: 'german', level: 'B1', exam: { type: exam, date }, minutesPerDay: 60, newPerDay: null, rev: {} });
  s.courses[0].goal = { exam, date, ...(level ? { level } : {}) };
  return s;
}
/** A composer state. @param {any} data @param {Record<string, any>} cards @param {any} c @param {any} st */
function state(data, cards, c, st) {
  const s = /** @type {any} */ ({ data, cards, day: C.newDay(c.today), c, newPerDay: 20, writingNew: 4, mistakesNew: 0, marked: new Set(), level: 'B1', fresh: false });
  s.gate = C.gateFor(s, st);
  return s;
}

/* ---------------- the gate ---------------- */

test('gate: closed under 50 % of a strand seen, 1 in 4 from 50 %, open from 80 %; a strand without B1 items is open', () => {
  assert.equal(L.strandState(0, 10), 'closed');
  assert.equal(L.strandState(4, 10), 'closed');
  assert.equal(L.strandState(5, 10), 'mix');
  assert.equal(L.strandState(7, 10), 'mix');
  assert.equal(L.strandState(8, 10), 'open');
  assert.equal(L.strandState(0, 0), 'open');
  const counts = { g: { n: 100, seen: 49 }, p: { n: 100, seen: 50 }, w: { n: 10, seen: 8 } };
  const g = L.levelGate({ goal: 'B2', phase: 'none', counts });
  assert.deepEqual(Object.fromEntries(L.STRANDS.map(k => [k, g.strands[k].state])), { g: 'closed', p: 'mix', w: 'open' });
  assert.deepEqual(g.strands.g, { state: 'closed', n: 100, seen: 49, share: 0.49 });
  assert.equal(g.level, 'B2');
  assert.equal(g.reason, null);
});

test('gate: shut without a B2 goal; paused in a B1 exam window only; a B2 exam or a B2 course level never pauses it', () => {
  const counts = { g: { n: 10, seen: 10 }, p: { n: 10, seen: 10 }, w: { n: 10, seen: 10 } };
  const states = (/** @type {any} */ g) => L.STRANDS.map(k => g.strands[k].state).join(',');
  for (const goal of [null, undefined, '', 'A2', 'B1', 'x']) {
    const g = L.levelGate({ goal, phase: 'none', counts });
    assert.equal(states(g), 'closed,closed,closed', String(goal));
    assert.equal(g.reason, 'noGoal');
  }
  for (const goal of ['B2', 'C1', 'C2', 'b2']) assert.equal(states(L.levelGate({ goal, phase: 'none', counts })), 'open,open,open', goal);
  for (const phase of ['week', 'lastNew', 'eve', 'day']) {
    const g = L.levelGate({ goal: 'B2', exam: 'goethe-b1', phase, counts });
    assert.equal(states(g), 'closed,closed,closed', phase);
    assert.equal(g.paused, true);
    assert.equal(g.reason, 'examWindow');
    assert.equal(states(L.levelGate({ goal: 'B2', exam: 'goethe-b2', phase, counts })), 'open,open,open', `B2 exam, ${phase}`);
  }
  for (const phase of ['none', 'after']) assert.equal(states(L.levelGate({ goal: 'B2', exam: 'goethe-b1', phase, counts })), 'open,open,open', phase);
  const low = { g: { n: 10, seen: 0 }, p: { n: 10, seen: 0 }, w: { n: 10, seen: 0 } };
  assert.equal(states(L.levelGate({ goal: 'B2', level: 'B2', phase: 'none', counts: low })), 'open,open,open', 'B2 is his level');
  assert.deepEqual(['goethe-b1', 'telc-b2', 'delf.c1', 'b1', 'goethe-b12', null].map(L.examLevel), ['B1', 'B2', 'C1', 'B1', null, null]);
});

test('mixLayers: closed leaves the B1 order; mix puts a B2 item 4th, 8th …; open puts B2 first with a B1 item every 3rd', () => {
  const b1 = Array.from({ length: 9 }, (_, i) => ({ id: `g${i}`, area: 'grammar' }));
  const b2 = Array.from({ length: 9 }, (_, i) => ({ id: `G${i}`, area: 'grammar' }));
  const other = { id: 'r', area: 'reading', kind: 'text' };
  const gate = (/** @type {string} */ state) => /** @type {any} */ ({ strands: { g: { state }, p: { state: 'closed' }, w: { state: 'closed' } } });
  assert.equal(L.mixLayers(b1, b2, gate('closed')), b1);
  assert.equal(L.mixLayers(b1, b2, null), b1);
  assert.deepEqual(L.mixLayers([...b1.slice(0, 6), other], b2, gate('mix')).map(x => x.id).join(' '), 'g0 g1 g2 G0 g3 g4 g5 r G1 G2 G3 G4 G5 G6 G7 G8');
  assert.deepEqual(L.mixLayers(b1.slice(0, 3), b2.slice(0, 5), gate('open')).map(x => x.id).join(' '), 'G0 G1 g0 G2 G3 g1 G4 g2');
  // a strand's B2 items never go into another strand's places
  const p = [{ id: 'p0', kind: 'phrase', area: 'speaking' }, { id: 'p1', kind: 'phrase', area: 'speaking' }];
  assert.deepEqual(L.mixLayers(p, b2.slice(0, 2), gate('open')).map(x => x.id).join(' '), 'p0 p1 G0 G1');
});

/* ---------------- the B2 layer ---------------- */

test('layer: B2 grammar of the trainer-less concepts and B2 bank phrases with accept lists, each tagged layer b2, beside the pool', () => {
  assert.ok(NEW.b2.length > 200, `${NEW.b2.length} items`);
  assert.ok(NEW.b2.every(it => it.layer === 'b2' && it.level === 'B2' && !it.star));
  assert.ok(NEW.b2.every(it => /^(G|K):/.test(it.id) && NEW.byId.get(it.id) === it));
  assert.ok(NEW.b2.every(it => !OLD.byId.has(it.id)), 'no id the B1 pool has');
  assert.equal(new Set(NEW.b2.map(it => it.id)).size, NEW.b2.length);
  assert.ok(!NEW.b2.some(it => it.id === 'G:konnektoren-advanced.01'), 'b1.annot skips are skipped');
  const g = NEW.b2.filter(it => it.area === 'grammar'), p = NEW.b2.filter(it => it.kind === 'phrase');
  assert.ok(g.length >= 60 && p.length >= 150, `${g.length} grammar, ${p.length} phrases`);
  assert.ok(g.every(it => it.accept.length && it.model && it.group && it.rank >= 100));
  assert.ok(p.every(it => it.accept.length && it.model && it.prompt && it.area === 'speaking'));
  assert.deepEqual(buildPool(B1).b2, [], 'without the sources there is no layer');
  // the ledger has every id the layer creates (tools/shipped-ids.mjs --write)
  const ledger = new Set(readFileSync(new URL('../fixtures/shipped-ids.txt', import.meta.url), 'utf8').split('\n'));
  assert.deepEqual(NEW.b2.filter(it => !ledger.has(it.id)).map(it => it.id), []);
});

test('B1 byte-equal: pool, readiness, ★/trap pace and lexicon are what they were with the layer built (and B2 cards held)', () => {
  assert.equal(JSON.stringify(NEW.pool), JSON.stringify(OLD.pool));
  assert.deepEqual([...NEW.lexicon].sort(), [...OLD.lexicon].sort());
  const r = rng(0xb7);
  for (let n = 0; n < 30; n++) {
    const cards = cardsFor(r, r(), r() * 0.5);
    for (const phase of ['none', 'week', 'after']) {
      const c = { today: TODAY, exam: phase === 'none' ? null : phase === 'week' ? D8.add(TODAY, 8) : D8.add(TODAY, -3), phase };
      // readiness: the callers hand it the B1 pool; an item of the layer handed in by mistake is not counted either
      const a = RD.compute({ pool: OLD.pool, store: cards, ...c });
      assert.equal(JSON.stringify(RD.compute({ pool: NEW.pool, store: cards, ...c })), JSON.stringify(a));
      assert.equal(JSON.stringify(RD.compute({ pool: [...NEW.pool, ...NEW.b2], store: cards, ...c })), JSON.stringify(a));
    }
    const ctx = context({ today: TODAY, exam: null });
    for (const st of [settings(null), settings('B2')]) {
      const sOld = state(OLD, cards, ctx, st), sNew = state(NEW, cards, ctx, st);
      assert.equal(C.priorityLeft(sNew), C.priorityLeft(sOld));
    }
  }
});

test('B1 byte-equal: without a B2 goal, or in a B1 exam window, the new-item order, the rounds and the open count are unchanged', () => {
  const r = rng(0x1b2);
  for (let n = 0; n < 40; n++) {
    const cards = cardsFor(r, 0.5 + r() * 0.5, r() * 0.3);
    const window = r() < 0.5;
    const ctx = context({ today: TODAY, exam: window ? D8.add(TODAY, 1 + Math.floor(r() * 13)) : null });
    const st = window ? settings('B2', 'goethe-b1', ctx.exam) : settings(null);
    const sOld = state(OLD, cards, ctx, st), sNew = state(NEW, cards, ctx, st);
    assert.ok(!L.gateOpen(sNew.gate));
    const ids = (/** @type {any[]} */ xs) => xs.map(x => x.id).join(' ');
    assert.equal(ids(C.newOrder(sNew, C.roundItems(sNew))), ids(C.newOrder(sOld, C.roundItems(sOld))));
    assert.equal(C.layerOpen(sNew), 0);
    // the daily round: the same, unless a B2 card is due (its reviews always come in)
    const b2due = NEW.b2.some(it => C.due(sNew, it));
    if (!b2due) for (const kind of ['today', 'area:grammar', 'topic:konj2']) assert.deepEqual(C.compose(sNew, C.parseKind(kind)), C.compose(sOld, C.parseKind(kind)), kind);
  }
});

test('B2 reviews are never gated: a due B2 card comes in the daily round with the gate shut', () => {
  const cards = { [NEW.b2[0].id]: rec(D8.add(TODAY, -2)) };
  const ctx = context({ today: TODAY, exam: D8.add(TODAY, 5) });
  const s = state(NEW, cards, ctx, settings('B2', 'goethe-b1', ctx.exam));
  assert.equal(s.gate.reason, 'examWindow');
  assert.ok(C.compose(s).includes(NEW.b2[0].id));
});

test('gate opening: with a B2 goal and enough of a strand seen, B2 items join the new items at that strand\'s rate', () => {
  const ctx = context({ today: TODAY, exam: null });
  const eligible = NEW.pool.filter(it => !it.mine && C.eligible(it));
  const strand = (/** @type {string} */ k) => eligible.filter(it => L.strandOf(it) === k);
  /** cards for a share of each strand's eligible B1 items, the first ones of each @param {Record<string, number>} share */
  const seen = share => Object.fromEntries(L.STRANDS.flatMap(k => { const xs = strand(k); return xs.slice(0, Math.ceil(xs.length * share[k])).map(it => [it.id, rec(D8.add(TODAY, 30))]); }));
  // grammar 30 % (closed), phrases 60 % (mix), words 0 (closed unless there are none)
  const cards = seen({ g: 0.3, p: 0.6, w: 0 });
  const s = state(NEW, cards, ctx, settings('B2'));
  assert.equal(s.gate.strands.g.state, 'closed');
  assert.equal(s.gate.strands.p.state, 'mix');
  const order = C.newOrder(s, C.roundItems(s));
  assert.ok(!order.some(it => it.layer === 'b2' && it.area === 'grammar'), 'no B2 grammar while grammar is closed');
  const phr = order.filter(it => L.strandOf(it) === 'p');
  const firstB1 = phr.findIndex(it => it.layer !== 'b2');
  const head = phr.slice(firstB1, firstB1 + 12).map(it => (it.layer === 'b2' ? 'B' : 'b')).join('');
  assert.equal(head, 'bbbBbbbBbbbB', 'every 4th phrase is a B2 one');
  assert.ok(C.layerOpen(s) > 0 && C.layerOpen(s) === NEW.b2.filter(it => it.kind === 'phrase').length);
  // 85 % of grammar: open, B2 first
  const open = state(NEW, seen({ g: 0.85, p: 0.6, w: 0 }), ctx, settings('B2'));
  assert.equal(open.gate.strands.g.state, 'open');
  const gr = C.newOrder(open, C.roundItems(open)).filter(it => L.strandOf(it) === 'g').slice(0, 6).map(it => (it.layer === 'b2' ? 'B' : 'b')).join('');
  assert.equal(gr, 'BBbBBb');
  // the same learner inside a B1 exam window: none
  const win = context({ today: TODAY, exam: D8.add(TODAY, 6) });
  const paused = state(NEW, seen({ g: 0.85, p: 0.9, w: 1 }), win, settings('B2', 'goethe-b1', win.exam));
  assert.ok(!C.newOrder(paused, C.roundItems(paused)).some(it => it.layer === 'b2'));
  // a B2 exam in its window: open
  const b2exam = state(NEW, seen({ g: 0.85, p: 0.9, w: 1 }), win, settings('B2', 'goethe-b2', win.exam));
  assert.ok(C.newOrder(b2exam, C.roundItems(b2exam)).some(it => it.layer === 'b2'));
});

test('property: B2 new items appear only when the gate has an open strand, never in a B1 exam window (seeded)', () => {
  const r = rng(0x9a7e);
  for (let n = 0; n < 60; n++) {
    const cards = cardsFor(r, r(), r() * 0.2);
    const kind = Math.floor(r() * 4);   // no goal, B2 goal, B2 goal in a B1 window, B2 goal in a B2 window
    const ctx = context({ today: TODAY, exam: kind >= 2 ? D8.add(TODAY, Math.floor(r() * 15)) : null });
    const st = kind === 0 ? settings(null) : settings('B2', kind === 3 ? 'goethe-b2' : 'goethe-b1', ctx.exam);
    const s = state(NEW, cards, ctx, st);
    const order = C.newOrder(s, C.roundItems(s));
    const b2 = order.filter(it => it.layer === 'b2');
    for (const it of b2) assert.notEqual(s.gate.strands[/** @type {any} */ (L.strandOf(it))].state, 'closed');
    if (kind === 0 || kind === 2) assert.equal(b2.length, 0, `kind ${kind}`);
    if (L.gateOpen(s.gate)) assert.ok(kind === 1 || kind === 3);
  }
});

test('layer: an item the content tags layer b2 joins it; one marked dupOf is left out (only the item it duplicates is scheduled)', () => {
  const concepts = [{ id: 'kx', level: 'B2', rank: 3 }];
  const grammar = [
    { id: 'kx.01', concept: 'kx', level: 'B1', layer: 'b2', kind: 'gap', task: 't', prompt: 'Er ___ .', answer: ['kam'] },
    { id: 'kx.02', concept: 'kx', level: 'B2', kind: 'gap', task: 't', prompt: 'Er ___ .', answer: ['ging'], dupOf: 'kx.01' },
  ];
  const en = [{ id: 'C1', level: 'B1', natural_example: 'I take it into account.' }, { id: 'C2', level: 'B2', natural_example: 'I take it into account.' }];
  const de = { C1: { t: 'x', ex: 'Ich ziehe es in Betracht.', layer: 'b2' }, C2: { t: 'x', ex: 'Ich ziehe es in Betracht.', dupOf: 'C1' } };
  const accept = { C1: { core_en: 'take it into account', accept: ['ich ziehe es in betracht'] }, C2: { core_en: 'take it into account', accept: ['ich ziehe es in betracht'] } };
  const out = buildPool({ ...B1, b2: { grammar, concepts, en, de, accept } }).b2;
  assert.deepEqual(out.map(it => it.id), ['G:kx.01', 'K:C1']);
  assert.equal(out[0].rank, 103, 'the concept rank from the content');
});
