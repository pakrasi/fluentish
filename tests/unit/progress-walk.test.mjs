// The progress log's walk (round 4, audit P1-8): domain/progress.js walkDays gives, day by day, the cards cardsAt
// gives for that day on its own, from one pass forward over random synthetic histories (two devices' events, marks and
// undone marks, cards changed without an event, snapshots on random days); resuming from the last day done with each
// device's newest snapshot gives the same days as an uninterrupted walk; and its cost grows with the days, not their
// square. All data is synthetic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../../src/domain/progress.js';
import * as FS from '../../src/domain/fsrs.js';
import * as D8 from '../../src/domain/days.js';
import { markRec, unmarkRec } from '../../src/domain/known.js';
import { canon } from '../../src/domain/cardmerge.js';

const START = '2026-03-02';

/** A small seeded generator (mulberry32). */
function rng(seed) {
  let a = seed >>> 0;
  const next = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return { next, int: n => Math.floor(next() * n), pick: list => list[Math.floor(next() * list.length)], chance: p => next() < p };
}

const stamp = (d, n) => Date.parse(`${d}T08:00:00Z`) + n * 60e3;

/**
 * A random history: answers on two devices (each with its card.reviewed event, except a few made by the old app
 * without one), marks and undone marks with their events, and a snapshot of one device on some days.
 */
function history(seed, days, nCards, { snapEvery = 0.3, noEvent = 0.08 } = {}) {
  const r = rng(seed);
  /** @type {Record<string, any>} */ const cards = {};
  const events = [];
  const snapshots = [];
  const ids = Array.from({ length: nCards }, (_, i) => `W:w${i}.n`);
  let seq = 0;
  const ev = (type, d, n, payload) => events.push({ id: `e${seq}`, v: 1, profileId: 'p', deviceId: r.chance(0.5) ? 'mac' : 'iph', seq: seq++, at: new Date(stamp(d, n)).toISOString(), day: d, type, payload });
  for (let i = 0; i < days; i++) {
    const d = D8.add(START, i);
    if (!r.chance(0.7)) continue;
    let n = 0;
    for (let k = 1 + r.int(Math.max(2, nCards / 10)); k > 0; k--) {
      const id = r.pick(ids);
      const prev = cards[id] || null;
      if (prev && prev.known && !prev.hist?.length && r.chance(0.3)) {
        // undo the mark of a card never answered: its record goes
        const un = unmarkRec(prev);
        if (un) { if (un.rec) cards[id] = un.rec; else delete cards[id]; ev('card.unmarked_known', d, n++, { deck: 'b1', items: [{ itemId: id, base: { u: prev.u, reps: prev.reps }, post: un.rec }] }); }
        continue;
      }
      if (!prev && r.chance(0.12)) {
        const post = markRec(null, { today: d, by: 'self', now: stamp(d, n) });
        cards[id] = post;
        ev('card.marked_known', d, n++, { deck: 'b1', by: 'self', items: [{ itemId: id, base: null, post }] });
        continue;
      }
      const { rec } = FS.schedule(prev, { g: r.pick([1, 3, 3, 3, 4]), ms: 1000, mode: 't', flags: '' }, { today: d, exam: null, phase: 'none' }, stamp(d, n));
      cards[id] = rec;
      if (r.chance(noEvent)) { n++; continue; }   // the old app: no event
      ev('card.reviewed', d, n++, { deck: 'b1', itemId: id, g: 3, base: { u: prev?.u ?? null, reps: prev?.reps ?? 0 }, post: rec });
    }
    if (r.chance(snapEvery)) snapshots.push({ day: d, deviceId: 'mac', cards: structuredClone({ b1: cards }) });
  }
  return { decks: { b1: cards }, events, snapshots };
}

test('walkDays: every day equals cardsAt for that day, on random histories', () => {
  let estimated = 0, undone = 0, gone = 0;
  for (let seed = 1; seed <= 16; seed++) {
    const h = history(seed, 40, 30);
    undone += h.events.filter(e => e.type === 'card.unmarked_known').length;
    const walk = P.walkDays({ decks: h.decks, events: h.events });
    let si = 0;
    for (let i = -1; i <= 41; i++) {
      const day = D8.add(START, i);
      const snaps = [];
      for (; si < h.snapshots.length && h.snapshots[si].day <= day; si++) snaps.push(h.snapshots[si]);
      const got = walk.step(day, snaps);
      const want = P.cardsAt({ decks: h.decks, events: h.events, snapshots: h.snapshots, day });
      assert.equal(canon(got.decks.b1 || {}), canon(want.decks.b1 || {}), `seed ${seed}, ${day}: the same cards`);
      assert.equal(got.estimated, want.estimated, `seed ${seed}, ${day}: the same estimates`);
      estimated += got.estimated;
      gone += Object.keys(h.decks.b1).filter(id => !(got.decks.b1 || {})[id]).length;
    }
  }
  // the histories exercise every path: estimated cards, undone marks, cards that did not exist yet
  assert.ok(estimated > 0 && undone > 0 && gone > 0, `estimated ${estimated}, undone ${undone}, not yet made ${gone}`);
});

test('walkDays: study days only (days skipped between steps) and events listed in any order', () => {
  for (let seed = 21; seed <= 26; seed++) {
    const h = history(seed, 30, 20);
    const shuffled = [...h.events].reverse();
    const walk = P.walkDays({ decks: h.decks, events: shuffled });
    let si = 0;
    for (let i = 0; i < 30; i += 3) {
      const day = D8.add(START, i);
      const snaps = [];
      for (; si < h.snapshots.length && h.snapshots[si].day <= day; si++) snaps.push(h.snapshots[si]);
      const got = walk.step(day, snaps);
      const want = P.cardsAt({ decks: h.decks, events: h.events, snapshots: h.snapshots, day });
      assert.equal(canon(got.decks.b1 || {}), canon(want.decks.b1 || {}), `seed ${seed}, ${day}`);
    }
  }
});

test('walkDays: resuming from the last day done (each device\'s newest snapshot up to it) gives the same days', () => {
  for (let seed = 31; seed <= 38; seed++) {
    const h = history(seed, 36, 25, { snapEvery: 0.4 });
    const cut = D8.add(START, 17);
    const full = P.walkDays({ decks: h.decks, events: h.events });
    const resumed = P.walkDays({ decks: h.decks, events: h.events });
    const newest = new Map();
    for (const s of h.snapshots) if (s.day <= cut) newest.set(s.deviceId, s);
    resumed.step(cut, [...newest.values()]);
    let si = 0, sj = h.snapshots.findIndex(s => s.day > cut);
    if (sj < 0) sj = h.snapshots.length;
    for (let i = 0; i < 36; i++) {
      const day = D8.add(START, i);
      const snaps = [];
      for (; si < h.snapshots.length && h.snapshots[si].day <= day; si++) snaps.push(h.snapshots[si]);
      const a = full.step(day, snaps);
      if (day <= cut) continue;
      const later = [];
      for (; sj < h.snapshots.length && h.snapshots[sj].day <= day; sj++) later.push(h.snapshots[sj]);
      const b = resumed.step(day, later);
      assert.equal(canon(b.decks.b1 || {}), canon(a.decks.b1 || {}), `seed ${seed}, ${day}: resumed equals uninterrupted`);
      assert.equal(b.estimated, a.estimated);
    }
  }
});

test('walkDays: the cost grows with the days, not their square (a year against a quarter)', () => {
  const run = h => {
    const t0 = performance.now();
    const walk = P.walkDays({ decks: h.decks, events: h.events });
    let si = 0;
    for (let i = 0; i < h.days; i++) {
      const day = D8.add(START, i);
      const snaps = [];
      for (; si < h.snapshots.length && h.snapshots[si].day <= day; si++) snaps.push(h.snapshots[si]);
      walk.step(day, snaps);
    }
    return performance.now() - t0;
  };
  const make = days => ({ ...history(7, days, 800, { snapEvery: 0.25, noEvent: 0 }), days });
  const hq = make(90), hy = make(360);
  run(hq); run(hy);   // warm up
  // the fastest of three, so a busy machine does not decide it
  const best = h => Math.min(run(h), run(h), run(h));
  const q = best(hq), y = best(hy);
  // linear: about 4 times; quadratic (cardsAt day by day): about 16 times
  assert.ok(y / q < 8, `a year took ${(y / q).toFixed(1)} times a quarter (${y.toFixed(0)} ms against ${q.toFixed(0)} ms)`);
});

test('walkDays: a day before the last step is refused', () => {
  const walk = P.walkDays({ decks: {}, events: [] });
  walk.step('2026-03-05');
  assert.throws(() => walk.step('2026-03-04'), /before/);
});
