// Word building: the unlock order, today's new items, rounds, the deck's own daily cap (composed in domain/budget.js
// without touching the B1 allowance) and Split or stay (domain/wordbuild-plan.js). Synthetic card records only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { context } from '../../src/core/clock.js';
import { dayBudget, buildBudget, buildNewPerDay } from '../../src/domain/budget.js';
import * as P from '../../src/domain/wordbuild-plan.js';
import { CORE } from '../../src/domain/wordbuild.js';
import * as D8 from '../../src/domain/days.js';

const C = JSON.parse(readFileSync(new URL('../../content/build/de.json', import.meta.url), 'utf8'));
const TODAY = '2026-10-12';
const good = (day = TODAY) => ({ S: 3, D: 5, reps: 2, lapses: 0, first: day, last: day, due: D8.add(day, 1), learn: null, hist: [[day, 3, 1000, 's', '']] });
const learning = (day = TODAY) => ({ S: 1, D: 5, reps: 1, lapses: 0, first: day, last: day, due: day, learn: 0, hist: [[day, 1, 1000, 't', 'r']] });
const open = cards => P.openNew({ content: C, cards, today: TODAY });

test('a fresh deck opens only the core prefixes, in order', () => {
  const o = open({});
  assert.deepEqual(o.px, CORE.map(p => `PX:${p}.see`));
  assert.deepEqual(o.verbs, []); assert.deepEqual(o.ps, []); assert.deepEqual(o.sx, []);
});

test("a prefix's say card and its verbs open after its motion card's first Good", () => {
  const seenOnly = open({ 'PX:auf.see': learning() });
  assert.ok(!seenOnly.px.includes('PX:auf.say'));
  assert.ok(!seenOnly.verbs.some(id => /^PD:auf/.test(id)));
  const o = open({ 'PX:auf.see': good() });
  assert.ok(o.px.includes('PX:auf.say'));
  assert.ok(o.verbs.length && o.verbs.every(id => /^PD:auf/.test(id)), o.verbs.join());
  // literal before picture before word to learn (aufhören-type verbs last)
  const grades = o.verbs.map(id => C.verbs.find(v => `PD:${v.id}` === id).grade);
  assert.deepEqual(grades, [...grades].sort((a, b) => 'TMO'.indexOf(a) - 'TMO'.indexOf(b)));
});

test('the other prefixes open after six core prefixes', () => {
  const five = Object.fromEntries(CORE.slice(0, 5).map(p => [`PX:${p}.see`, good()]));
  assert.ok(!open(five).px.some(id => id.startsWith('PX:um.')));
  const six = Object.fromEntries(CORE.slice(0, 6).map(p => [`PX:${p}.see`, good()]));
  assert.ok(open(six).px.includes('PX:um.see'));
  assert.ok(open(six).px.includes('PX:ge.say'));   // no picture for ge-: only its say card
});

test('verbs interleave: never two of one root in a row, never three of one prefix', () => {
  const cards = Object.fromEntries(CORE.map(p => [`PX:${p}.see`, good()]));
  const ids = open(cards).verbs;
  const vs = ids.map(id => C.verbs.find(v => `PD:${v.id}` === id));
  let roots = 0, pres = 0;
  for (let i = 1; i < vs.length; i++) if (vs[i].root === vs[i - 1].root) roots++;
  for (let i = 2; i < vs.length; i++) if (vs[i].pre === vs[i - 1].pre && vs[i].pre === vs[i - 2].pre) pres++;
  // the tail can run out of other roots; the head never repeats
  assert.equal(vs.slice(0, 30).filter((v, i, a) => i && v.root === a[i - 1].root).length, 0);
  assert.ok(roots < vs.length / 4 && pres < vs.length / 4);
  assert.deepEqual(P.interleave([{ root: 'a', pre: 'x' }, { root: 'a', pre: 'y' }, { root: 'b', pre: 'x' }]).map(v => v.root), ['a', 'b', 'a']);
});

test('the typing card (PV) opens the day after its PD card first went right', () => {
  const pd = { 'PX:ab.see': good(), 'PD:abstellen': good(TODAY) };
  assert.ok(!open(pd).verbs.includes('PV:abstellen'));
  const earlier = { 'PX:ab.see': good(), 'PD:abstellen': good('2026-10-11') };
  assert.equal(open(earlier).verbs[0], 'PV:abstellen');
});

test('sentence frames open per kind after six verbs; the present first; missed game verbs first', () => {
  const sep = C.verbs.filter(v => v.kind === 's').slice(0, 6);
  const five = Object.fromEntries(sep.slice(0, 5).map(v => [`PD:${v.id}`, good()]));
  assert.deepEqual(open(five).ps, []);
  const six = Object.fromEntries(sep.map(v => [`PD:${v.id}`, good()]));
  const ps = open(six).ps;
  assert.ok(ps.length && ps.every(id => /\.pres$/.test(id)));
  assert.ok(ps.every(id => C.frames.find(f => id.startsWith(`PS:${f.id}.`)).kind === 's'));
  const missed = P.openNew({ content: C, cards: six, today: TODAY, missed: ['umziehen'] }).ps;
  assert.equal(missed[0], 'PS:umziehen.pres');
  const withPres = { ...six, 'PS:aufstehen.pres': good() };
  assert.ok(open(withPres).ps.includes('PS:aufstehen.perf'));
});

test('suffixes open after twelve verbs; a rule\'s words after its rule card', () => {
  const v12 = Object.fromEntries(C.verbs.slice(0, 12).map(v => [`PD:${v.id}`, good()]));
  const o = open(v12);
  assert.ok(o.sx.includes('SX:ung') && !o.sx.includes('PW:Vorstellung'));
  assert.ok(open({ ...v12, 'SX:ung': good() }).sx.includes('PW:Vorstellung'));
  assert.deepEqual(open(Object.fromEntries(C.verbs.slice(0, 11).map(v => [`PD:${v.id}`, good()]))).sx, []);
});

test('new items: the streams in turn, at most three prefix cards a day', () => {
  const o = { px: ['PX:a.see', 'PX:b.see', 'PX:c.see', 'PX:d.see'], verbs: ['PD:x', 'PD:y'], ps: [], sx: ['SX:ung'] };
  assert.deepEqual(P.pickNew(o, 5), ['PX:a.see', 'PD:x', 'SX:ung', 'PX:b.see', 'PD:y']);
  assert.deepEqual(P.pickNew(o, 9, { pxShown: 2 }), ['PX:a.see', 'PD:x', 'SX:ung', 'PD:y']);
  assert.deepEqual(P.pickNew(o, 3, { only: 'px' }), ['PX:a.see', 'PX:b.see', 'PX:c.see']);
});

test('a review round: due first by lowest recall, new ones between them, the cap respected', () => {
  const cards = { 'PD:abstellen': { ...good('2026-10-01'), due: '2026-10-05' }, 'PX:ab.see': { ...good('2026-10-01'), due: '2026-10-06' } };
  const isDue = r => r.due <= TODAY, recall = r => (r.due === '2026-10-05' ? 0.5 : 0.8);
  const ids = P.composeRound({ kind: 'review', content: C, cards, today: TODAY, isDue, recall, newLeft: 2 });
  assert.deepEqual(ids.slice(0, 2), ['PD:abstellen', 'PX:ab.see']);
  assert.equal(ids.length, 4);
  assert.equal(P.composeRound({ kind: 'review', content: C, cards, today: TODAY, isDue, recall, newLeft: 0 }).length, 2);
  assert.deepEqual(P.composeRound({ kind: 'pick', content: C, cards, today: TODAY, isDue, recall, newLeft: 0, ids: ['PD:abstellen', 'XX:nope'] }), ['PD:abstellen']);
});

test('budget: its own cap, default 5, none from the eve, never out of the B1 allowance', () => {
  const exam = '2026-10-20';
  const week = context({ today: TODAY, exam }), eve = context({ today: '2026-10-19', exam });
  const s = { language: 'german', minutesPerDay: 60, newPerDay: null, practice: {}, exam: { type: 'goethe-b1', date: exam, modules: [] } };
  assert.equal(buildNewPerDay(s), 5);
  assert.equal(buildNewPerDay({ practice: { buildNew: 8 } }), 8);
  assert.equal(buildNewPerDay({ practice: { buildNew: 99 } }), 20);
  const b = buildBudget({ c: week, settings: s, dueN: 6, newShown: 2 });
  assert.deepEqual([b.newPerDay, b.newLeft, b.n], [5, 3, 9]);
  assert.equal(buildBudget({ c: eve, settings: s, dueN: 6 }).newLeft, 0);
  assert.equal(buildBudget({ c: week, settings: s, dueN: 0, unseen: 1 }).newLeft, 1);
  // the B1 day budget is the same whatever the Word building cap is
  const b1 = dayBudget({ c: week, settings: s, dueN: 30, priorityLeft: 80 });
  const b1b = dayBudget({ c: week, settings: { ...s, practice: { buildNew: 20 } }, dueN: 30, priorityLeft: 80 });
  assert.deepEqual(b1, b1b);
});

test('Split or stay: every verb once per deck, the reading decides, no card is written', () => {
  let x = 0.42; const rand = () => (x = (x * 9301 + 49297) % 233280 / 233280);
  const deck = P.gameDeck(C, rand);
  assert.equal(deck.length, C.verbs.length);
  assert.equal(new Set(deck.map(d => d.id)).size, deck.length);
  const s = deck.find(d => d.id === 'umfahren-s'), i = deck.find(d => d.id === 'umfahren-i');
  assert.ok(P.gameRight(s, true) && !P.gameRight(s, false) && P.gameRight(i, false));
  assert.notEqual(s.meaning, i.meaning);
  let log = null;
  for (let n = 0; n < 65; n++) log = P.logGame(log, { day: TODAY, n: 10, right: 8, missed: n === 64 ? ['umziehen'] : [], timed: true });
  assert.equal(log.games.length, 60);
  assert.deepEqual(P.recentMisses(log, TODAY, D8.diff), ['umziehen']);
  assert.deepEqual(P.recentMisses(log, '2026-10-20', D8.diff), []);
  assert.ok(P.playedToday(log, TODAY));
});

test("Today: Word building's rows (its own cap; the game every day but the exam day)", async () => {
  const { planItems } = await import('../../src/features/build/plan.js');
  const t = (k, v = {}) => `${k}${Object.keys(v).length ? ' ' + JSON.stringify(v) : ''}`;
  const exam = '2026-10-20';
  const settings = { language: 'german', minutesPerDay: 60, newPerDay: null, practice: {}, exam: { type: 'goethe-b1', date: exam, modules: [] } };
  const mk = (cards, kv = {}) => ({ cards: d => (d === 'build' ? cards : {}), get: (k, dflt) => (k in kv ? kv[k] : dflt) });
  const week = context({ today: TODAY, exam });
  // not started: only the game
  assert.deepEqual(planItems({ store: mk({}), c: week, settings, t }).map(r => r.id), ['build.game']);
  // started: 1 due, 4 open new cards → 1 due + 4 new (cap 5)
  const cards = { 'PX:auf.see': { ...good('2026-10-01'), due: '2026-10-05' } };
  const rows = planItems({ store: mk(cards, { build: { stats: { day: TODAY, open: 4 } } }), c: week, settings, t });
  const r = rows.find(x => x.id === 'build.round');
  assert.equal(r.priority, 56); assert.ok(r.noCut); assert.match(r.detail, /"due":1,"n":4/);
  // the exam day: nothing
  assert.deepEqual(planItems({ store: mk(cards), c: context({ today: exam, exam }), settings, t }), []);
  // played today: the game row shows done
  const log = { games: [{ day: TODAY, n: 10, right: 7, missed: [], timed: true }] };
  assert.ok(planItems({ store: mk({}, { 'build.game': log }), c: week, settings, t })[0].done);
});
