// Script mode: the ladder, the ready meter, the SR self-grades, the next step, Today's row and its share of the daily
// minutes, and stable ids across edits (script/ladder.js, plan.js, align.js). Synthetic bicycle talk only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { context } from '../../src/core/clock.js';
import { composeToday } from '../../src/domain/today.js';
import * as P from '../../src/features/practice/script/parse.js';
import * as Lad from '../../src/features/practice/script/ladder.js';
import * as Pl from '../../src/features/practice/script/plan.js';
import { applyEdit, alignSentences, overlap } from '../../src/features/practice/script/align.js';
import { PARTS_STEP } from '../../src/features/practice/script/config.js';

const t = (k, v = {}) => `${k}${Object.keys(v).length ? ' ' + JSON.stringify(v) : ''}`;
const de = fs.readFileSync(new URL('../fixtures/script-bicycle.md', import.meta.url), 'utf8');
function makeScript(o = {}) {
  const s = P.parseScript(de, { id: P.counterIds('s') });
  return { id: 'bike01', v: 1, title: 'Bike', register: 'both', deliverOn: null, targetMin: null, status: 'active', source: { format: 'de' }, sections: s.sections, marks: [], flagged: [], ...o };
}
const settings = { language: 'german', exam: { type: 'goethe-b1', date: null, modules: [] }, minutesPerDay: 60 };

test('ladder: Talk steps, Good unlocks the next step tomorrow, Easy skips one, Hard repeats', () => {
  const sec = { kind: 'talk' };
  assert.deepEqual(Lad.stepsFor(sec), PARTS_STEP ? ['listen', 'parts', 'letters', 'gaps', 'cue'] : ['listen', 'letters', 'gaps', 'cue']);
  assert.deepEqual(Lad.stepsFor({ kind: 'retell' }), ['listen', 'cue']);
  let p = Lad.listened(null, sec, '2026-11-01');
  assert.equal(p.step, Lad.TALK[1]); assert.equal(p.at, '2026-11-02');
  p = Lad.graded(p, sec, 'parts', 3, '2026-11-02');
  assert.equal(p.step, 'letters');
  p = Lad.graded(p, sec, 'letters', 2, '2026-11-03');
  assert.equal(p.step, 'letters', 'Hard repeats'); assert.equal(p.at, '2026-11-04');
  p = Lad.graded(p, sec, 'letters', 4, '2026-11-04');
  assert.equal(p.step, 'cue', 'Easy on Letters skips to Cue');
  p = Lad.graded(p, sec, 'cue', 3, '2026-11-05');
  assert.equal(p.step, 'cue'); assert.equal(p.done.cue, '2026-11-05');
  p = Lad.graded(p, sec, 'cue', 1, '2026-11-08');
  assert.equal(p.step, 'gaps', 'Again on Cue sends the section back to Gaps');
  // an earlier step by choice moves nothing
  const q = Lad.graded({ ...p, step: 'cue' }, sec, 'letters', 4, '2026-11-09');
  assert.equal(q.step, 'cue');
  // Retell: Listen then Cue; Again on Cue goes back to Listen
  const r = Lad.graded(Lad.listened(null, { kind: 'retell' }, '2026-11-01'), { kind: 'retell' }, 'cue', 1, '2026-11-02');
  assert.equal(r.step, 'listen');
});

test('ladder: switching a section between Talk and Retell keeps what was reached', () => {
  assert.equal(Lad.rekind({ step: 'letters', done: { listen: 'x' } }, 'retell').step, 'cue');
  assert.equal(Lad.rekind({ step: 'listen', done: {} }, 'retell').step, 'listen');
  assert.equal(Lad.rekind({ step: 'cue', done: { listen: 'x' } }, 'talk').step, Lad.TALK[1]);
  assert.equal(Lad.rekind({ step: 'cue', done: { listen: 'x', cue: 'y' } }, 'talk').step, 'cue');
  assert.equal(Lad.textChanged({ step: 'cue', done: { cue: 'y' } }, { kind: 'talk' }).step, 'gaps');
  assert.equal(Lad.textChanged({ step: 'letters', done: {} }, { kind: 'talk' }).step, 'letters');
});

test('rate: self-grades on a section card, no same-day relearning, the delivery cap', () => {
  const ctx = { today: '2026-11-01', exam: null, phase: 'none' };
  const a = Lad.rate(null, 3, ctx, 1).rec;
  assert.equal(a.reps, 1); assert.ok(a.due > '2026-11-01'); assert.equal(a.learn, null); assert.equal(a.hist[0][3], 's');
  const again = Lad.rate(a, 1, { ...ctx, today: '2026-11-04' }, 2).rec;
  assert.equal(again.lapses, 1); assert.equal(again.due, '2026-11-05'); assert.ok(again.relearn);
  const same = Lad.rate(again, 3, { ...ctx, today: '2026-11-04' }, 3);
  assert.equal(same.wrote, false, 'a second grade the same day only logs');
  // a delivery date plays the exam date: no due date after delivery−1 unless still recalled then
  const rec0 = { S: 20, D: 5, reps: 3, lapses: 0, last: '2026-10-25', due: '2026-11-01', hist: [] };
  const free = Lad.rate(rec0, 3, ctx, 1).rec;
  assert.ok(free.due > '2026-11-19', free.due);
  const cap = { today: '2026-11-01', exam: '2026-11-20', phase: 'week' };
  const e = Lad.rate(rec0, 3, cap, 1).rec;
  assert.ok(e.due <= '2026-11-19', e.due);
  assert.equal(Lad.rate(a, 3, { ...cap, today: '2026-11-06', phase: 'day' }).wrote, false, 'nothing is written on the day');
});

test('ready: whole sections at Cue with recall ≥ 0.9 on the delivery day, by words', () => {
  const s = makeScript();
  const [a, b] = s.sections;
  const cards = { [Lad.srId(s.id, a.id)]: { S: 30, D: 5, reps: 3, last: '2026-11-10', due: '2026-12-01', relearn: false } };
  const prog = { sections: { [a.id]: { step: 'cue', done: { cue: '2026-11-10' } }, [b.id]: { step: 'gaps', done: { listen: '2026-11-08' } } } };
  const r = Lad.readiness(s, prog, id => cards[id], '2026-11-10');
  const aw = P.sectionWords(a);
  assert.equal(r.pct, Math.floor(100 * aw / P.scriptWords(s)));
  assert.deepEqual(r.rows.map(x => x.state), ['today', 'learning', 'empty']);
  assert.deepEqual(r.rows[0].cells, a.sentences.map(x => P.wordCount(x.de)));
  // the same card measured on a delivery day far ahead: not ready yet
  const far = Lad.readiness({ ...s, deliverOn: '2027-03-01' }, prog, id => cards[id], '2026-11-10');
  assert.equal(far.pct, 0); assert.equal(far.rows[0].state, 'learning');
  // a relearning card never counts
  cards[Lad.srId(s.id, a.id)].relearn = true;
  assert.equal(Lad.readiness(s, prog, id => cards[id], '2026-11-10').pct, 0);
  assert.equal(Lad.suggestGrade(0), 3); assert.equal(Lad.suggestGrade(2), 2); assert.equal(Lad.suggestGrade(5), 1);
});

test('next step: mark, words, due cue, ladder, full run; the run first in the last 3 days', () => {
  const s = makeScript({ marks: [{ id: 'm1', kind: 'word', sentenceId: 's00001', start: 4, end: 4, surface: 'Rahmen', lemma: 'Rahmen', gloss: 'frame', cardId: 'W:der_Rahmen' }] });
  const c = context({ today: '2026-11-10' });
  const none = () => null;
  const ids = s.sections.map(x => x.id);
  let prog = { sections: {} };
  assert.equal(Pl.nextStep(s, prog, none, c).kind, 'mark');
  prog = { sections: Object.fromEntries(ids.map(id => [id, { marked: '2026-11-09' }])) };
  const w = Pl.nextStep(s, prog, none, c);
  assert.equal(w.kind, 'words'); assert.equal(w.n, 1);
  const seen = (/** @type {string} */ id) => (id === 'W:der_Rahmen' ? { deck: 'b1', rec: { S: 20, D: 5, reps: 2, last: '2026-11-09', due: '2026-11-30' } } : null);
  const st = Pl.nextStep(s, prog, seen, c);
  assert.equal(st.kind, 'step'); assert.equal(st.step, 'listen'); assert.equal(st.section.id, ids[0]);
  // a step that waits until tomorrow is skipped for the next section's
  prog.sections[ids[0]] = { marked: 'x', step: 'letters', at: '2026-11-11', done: { listen: 'x' } };
  assert.equal(Pl.nextStep(s, prog, seen, c).section.id, ids[1]);
  // all at Cue: a due rehearsal first, else the full run
  for (const id of ids) prog.sections[id] = { marked: 'x', step: 'cue', done: { cue: '2026-11-01' } };
  const sr = (/** @type {string} */ id) => (id.startsWith('SR:') ? { deck: 'script', rec: { S: 5, D: 5, reps: 2, last: '2026-11-01', due: id.endsWith(ids[1]) ? '2026-11-09' : '2026-11-20' } } : seen(id));
  const cue = Pl.nextStep(s, prog, sr, c);
  assert.equal(cue.kind, 'cue'); assert.equal(cue.section.id, ids[1]);
  const run = Pl.nextStep(s, prog, (id) => (id.startsWith('SR:') ? { deck: 'script', rec: { S: 5, D: 5, reps: 2, last: '2026-11-09', due: '2026-11-20' } } : seen(id)), c);
  assert.equal(run.kind, 'run'); assert.equal(run.minutes, Math.round(P.scriptWords(s) / 110) || 1);
  // three days before delivery: the full run comes before a due cue
  const near = Pl.nextStep({ ...s, deliverOn: '2026-11-13' }, prog, sr, c);
  assert.equal(near.kind, 'run');
});

test('Today: exam first, 25 % of the daily minutes, more only for a deadline, priorities', () => {
  const s = makeScript();
  const prog = { [s.id]: { sections: Object.fromEntries(s.sections.map(x => [x.id, { marked: 'x' }])) } };
  const none = () => null;
  // a B1 exam ahead: no row, unless the talk comes first
  const before = context({ today: '2026-10-05', exam: '2026-10-09' });
  assert.deepEqual(Pl.planRows({ scripts: [s], progress: prog, cardOf: none, c: before, settings, t }), []);
  assert.equal(Pl.planRows({ scripts: [{ ...s, deliverOn: '2026-10-08' }], progress: prog, cardOf: none, c: before, settings, t }).length, 1);
  // after the exam: one row, capped at 25 % of 60 minutes
  const after = context({ today: '2026-10-20', exam: '2026-10-09' });
  const big = { ...s, sections: s.sections.map(x => ({ ...x, sentences: [...x.sentences, ...x.sentences, ...x.sentences, ...x.sentences, ...x.sentences, ...x.sentences, ...x.sentences, ...x.sentences] })) };
  let rows = Pl.planRows({ scripts: [big], progress: prog, cardOf: none, c: after, settings, t });
  assert.equal(rows.length, 1); assert.equal(rows[0].kind, 'speak'); assert.equal(rows[0].priority, 45);
  assert.ok(rows[0].minutes <= 15, `${rows[0].minutes}`);
  // a deadline in 5 days that needs more: up to 50 %
  rows = Pl.planRows({ scripts: [{ ...big, deliverOn: '2026-10-25' }], progress: prog, cardOf: none, c: after, settings: { ...settings, minutesPerDay: 20 }, t });
  assert.equal(rows[0].priority, 22, 'the last 7 days move the row up');
  assert.ok(rows[0].minutes > 5 && rows[0].minutes <= 10, `${rows[0].minutes}`);
  // paused, archived, delivered: no row; the day: a warm-up
  assert.equal(Pl.planRows({ scripts: [{ ...s, status: 'paused' }], progress: prog, cardOf: none, c: after, settings, t }).length, 0);
  assert.equal(Pl.planRows({ scripts: [{ ...s, deliverOn: '2026-10-10' }], progress: prog, cardOf: none, c: after, settings, t }).length, 0);
  const day = Pl.planRows({ scripts: [{ ...s, deliverOn: '2026-10-20' }], progress: prog, cardOf: none, c: after, settings, t });
  assert.equal(day[0].kind, 'warmup'); assert.equal(day[0].minutes, 2);
  // the composer keeps it after the review round
  const plan = composeToday({ ctx: after, budget: 60, items: [{ id: 'practice.round', source: 'practice', kind: 'review', title: 'R', minutes: 20, href: '#', priority: 20 }, ...Pl.planRows({ scripts: [s], progress: prog, cardOf: none, c: after, settings, t })] });
  assert.deepEqual(plan.rows.map(r => r.id), ['practice.round', 'script.bike01']);
});

test('new words: 8 a day per script, none in the last 3 days, counted for the B1 budget', () => {
  const s = makeScript();
  assert.equal(Pl.newAllowed(s, { newBy: { '2026-11-10': 5 } }, '2026-11-10'), 3);
  assert.equal(Pl.newAllowed(s, { newBy: { '2026-11-10': 9 } }, '2026-11-10'), 0);
  assert.equal(Pl.newAllowed({ ...s, deliverOn: '2026-11-12' }, {}, '2026-11-10'), 0);
  assert.equal(Pl.newAllowed({ ...s, deliverOn: '2026-11-13' }, {}, '2026-11-10'), 8);
  assert.equal(Pl.newShownToday({ a: { newBy: { '2026-11-10': 3 } }, b: { newBy: { '2026-11-10': 2, '2026-11-09': 8 } } }, '2026-11-10'), 5);
  assert.equal(Pl.scriptPhase('2026-11-10', null), 'none');
  assert.equal(Pl.scriptPhase('2026-11-10', '2026-11-18'), 'build');
  assert.equal(Pl.scriptPhase('2026-11-10', '2026-11-12'), 'polish');
  assert.equal(Pl.scriptPhase('2026-11-10', '2026-11-11'), 'eve');
});

test('stable ids: identical text keeps its id, an edited sentence keeps it with changedAt, new text gets new ids', () => {
  const old = [{ id: 'aaaaaa', de: 'Der Rahmen ist leicht.', en: 'The frame is light.' }, { id: 'bbbbbb', de: 'Die Kette ist geölt und läuft sehr leise.', en: null }, { id: 'cccccc', de: 'Danke.', en: null }];
  const next = [{ de: 'Der Rahmen ist leicht.' }, { de: 'Die Kette ist gut geölt und läuft sehr leise.' }, { de: 'Hier kommt ein ganz neuer Satz.' }];
  let n = 0;
  const r = alignSentences(old, next, () => `new${n++}`, 'T');
  assert.deepEqual(r.sentences.map(x => x.id), ['aaaaaa', 'bbbbbb', 'new0']);
  assert.equal(r.sentences[0].en, 'The frame is light.');
  assert.equal(r.sentences[1].changedAt, 'T'); assert.ok(!r.sentences[0].changedAt);
  assert.deepEqual(r.changed, ['bbbbbb']); assert.deepEqual(r.removed.map(x => x.id), ['cccccc']);
  assert.ok(overlap('a b c d e', 'a b c d f') >= 0.6);
  // reordering keeps ids
  const back = alignSentences(old, [{ de: 'Danke.' }, { de: 'Der Rahmen ist leicht.' }], () => 'x', 'T');
  assert.deepEqual(back.sentences.map(x => x.id).sort(), ['aaaaaa', 'cccccc']);
});

test('applyEdit: sections keep ids, marks move with their word or are named when it is gone', () => {
  const s = makeScript();
  const [a, b, c] = s.sections;
  const mk = (/** @type {any} */ sent, /** @type {string} */ w, /** @type {string} */ id) => { const k = P.tokenize(sent.de).find(x => x.t === w).k; return { id, kind: 'word', sentenceId: sent.id, start: k, end: k, surface: w, lemma: w, gloss: 'x', cardId: `SW:${w}` }; };
  s.marks = [mk(a.sentences[1], 'Rahmen', 'm1'), mk(b.sentences[1], 'Übersetzungsverhältnis', 'm2'), mk(c.sentences[1], 'Felgenbremsen', 'm3')];
  s.flagged = [c.sentences[1].id];
  const text = (/** @type {any} */ x) => x.sentences.map((/** @type {any} */ y) => y.de).join(' ');
  let n = 0;
  const edits = [
    { id: a.id, title: a.title, de: text(a).replace('Das Herz jedes Fahrrads ist der Rahmen.', 'Das Herz jedes Fahrrads ist sein Rahmen.') },
    { id: c.id, title: 'Die Bremsen', de: 'Zum Schluss noch ein Wort zu den Bremsen. Prüft eure Bremsen deshalb regelmäßig, bevor ihr losfahrt.' },
    { id: b.id, title: b.title, de: text(b) },
    { title: 'Neu', de: 'Ein ganz neuer Abschnitt.' },
  ];
  const r = applyEdit(s, edits, { id: () => `n${n++}`, at: 'T' });
  assert.deepEqual(r.script.sections.map((/** @type {any} */ x) => x.id).slice(0, 3), [a.id, c.id, b.id], 'reordered, ids kept');
  assert.equal(r.script.sections[1].title, 'Die Bremsen');
  assert.equal(r.script.sections[0].sentences[1].id, a.sentences[1].id); assert.equal(r.script.sections[0].sentences[1].changedAt, 'T');
  assert.deepEqual(r.script.marks.map((/** @type {any} */ m) => m.id), ['m1', 'm2'], 'Rahmen still there after the edit');
  assert.deepEqual(r.marksRemoved, ['Felgenbremsen']);
  assert.deepEqual(r.script.flagged, []);
  assert.ok(r.sections.find(x => x.id === a.id && x.changed === 1));
  assert.ok(!r.sections.find(x => x.id === b.id), 'untouched section: not in the summary');
  assert.equal(r.script.sections[3].sentences.length, 1);
});
