// Schreiben practice: the content builder, grading of the Schreiben items and email lines, the punctuation rules, the
// new word-order detectors, the day's Schreiben share, the plan row and Build an email. Synthetic data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { context } from '../../src/core/clock.js';
import { buildPool } from '../../src/features/practice/pool.js';
import { gradeAnswer } from '../../src/features/practice/grade.js';
import * as C from '../../src/features/practice/compose.js';
import * as B from '../../src/features/practice/build.js';
import { slotKey } from '../../src/features/practice/session.js';
import { planItems } from '../../src/features/practice/plan.js';
import { punctCheck, lowerStart } from '../../src/domain/punct.js';
import { allowance } from '../../src/domain/budget.js';
import { moduleScores, weakestModule, needsWork, writingFocus } from '../../src/domain/modules.js';
import { kindOf, isWriting } from '../../src/domain/itemids.js';
import Det from '../../src/domain/detect.js';
import { taskMessage, isTaskCorrection, TASK_GRADER } from '../../src/services/claude.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const J = p => JSON.parse(readFileSync(path.join(ROOT, p), 'utf8'));
const S = J('content/b1/schreiben.json');
const data = buildPool({ items: J('content/b1/items.json'), grammar: J('content/b1/grammar.json'), bank: J('content/b1/bank.json'), plan: J('content/b1/plan.json'),
  nouns: J('content/b1/nouns.json'), schreiben: S, lexWords: J('content/igloo/words/de.json') });
const EXAM = '2026-10-09';

test('content: the builder checks every source; the built file has the Aufgaben, ranks and tasks', () => {
  const out = execFileSync('python3', [path.join(ROOT, 'tools/build_schreiben.py'), '--check'], { encoding: 'utf8' });
  assert.match(out, /schreiben: \d+ items/);
  assert.ok(S.items.length >= 80 && S.items.length + Object.keys(S.linked).length <= 120, `${S.items.length} items`);
  for (const a of ['A1', 'A2', 'A3']) assert.ok(S.items.some(i => i.aufgabe === a), a);
  assert.deepEqual([...new Set(S.items.map(i => i.rank))].length, S.items.length, 'ranks are unique');
  assert.ok(S.tasks.length >= 6);
  for (const it of S.items) { assert.equal(kindOf(it.id).area, 'writing'); assert.ok(isWriting(it.id)); }
  for (const id of Object.keys(S.linked)) assert.ok(isWriting(id), id);
});

test('pool: Schreiben items and the linked letter items are in area writing, by Aufgabe and function', () => {
  const w = data.pool.filter(i => i.area === 'writing');
  assert.equal(w.length, S.items.length + Object.keys(S.linked).length);
  const clara = data.byId.get('BP:w1-anrede-liebe-clara');
  assert.equal(clara.area, 'writing'); assert.equal(clara.group, 'W1'); assert.equal(clara.wfn, 'a1_open');
  // a linked formal item has its polite forms strict
  assert.ok(data.byId.get('BP:w3-sagen-ob-plaetze').strict.includes('Sie'));
  assert.ok(data.writing.tasks.length && data.writing.functions.length);
});

test('grading: every Schreiben model is right, every listed wrong answer is wrong', () => {
  for (const it of data.pool.filter(i => i.area === 'writing')) {
    const g = gradeAnswer(it, it.model, null, data);
    assert.ok(g.ok && !g.partial && !g.punctMiss.length, `${it.id}: ${it.model}`);
    for (const w of it.wrong) assert.ok(!(gradeAnswer(it, w, null, data).ok && !gradeAnswer(it, w, null, data).partial), `${it.id}: ${w}`);
  }
  for (const t of S.tasks) for (const p of t.parts) {
    const r = B.checkPart(t, p, B.modelLine(p), data);
    assert.ok(r.ok && !r.partial && !r.punctMiss.length, `${t.id}/${p.key}`);
    for (const w of p.wrong) { const x = B.checkPart(t, p, w, data); assert.ok(!(x.ok && !x.partial), `${t.id}/${p.key}: ${w}`); }
  }
});

test('grading: the Schreiben errors that cost marks are not right', () => {
  const it = id => data.byId.get(id);
  const wrong = (id, s) => { const g = gradeAnswer(it(id), s, null, data); assert.ok(!g.ok || g.partial, `${id}: ${s}`); };
  wrong('BS:a1-lieber-jonas', 'Liebe Jonas,');
  wrong('BS:a3-mfg', 'Mit freundlichen Grußen');
  wrong('BS:a3-dank-ihre-email', 'Vielen Dank für ihre E-Mail.');
  wrong('BS:a3-tut-mir-leid-aber', 'Es tut mir sehr leid, aber kann ich nicht zum Gespräch kommen.');
  wrong('BS:a2-zum-beispiel-v2', 'Zum Beispiel viele Menschen arbeiten von zu Hause aus.');
  const t = S.tasks.find(x => x.id === 'a1-umzug'), p2 = t.parts.find(p => p.key === 'p2');
  assert.ok(!B.checkPart(t, p2, 'Der Umzug war anstrengend, weil wir wohnen im vierten Stock.', data).ok, 'a verb from the word list');
  assert.ok(B.checkPart(t, p2, 'Der Umzug war stressig, weil es den ganzen Tag geregnet hat.', data).ok, 'his own reason');
});

test('punctuation: greeting comma, no comma after the sign-off, small letter after the greeting, comma before dass', () => {
  assert.deepEqual(punctCheck('Liebe Maria,', ['comma-end']), []);
  assert.equal(punctCheck('Liebe Maria', ['comma-end'])[0].code, 'comma-end');
  assert.equal(punctCheck('Mit freundlichen Grüßen,', ['no-comma-end'])[0].code, 'no-comma-end');
  assert.equal(punctCheck('Vielen Dank für deine E-Mail!', ['lower-start'])[0].code, 'lower-start');
  assert.deepEqual(punctCheck('vielen Dank für deine E-Mail!', ['lower-start']), []);
  assert.deepEqual(punctCheck('Ihre E-Mail hat mich gefreut.', ['lower-start']), [], 'a polite Ihre keeps its capital');
  assert.equal(punctCheck('Ich hoffe dass es dir gut geht.', ['comma-before:dass'])[0].word, 'dass');
  assert.deepEqual(punctCheck('Ich hoffe, dass es dir gut geht.', ['comma-before:dass']), []);
  assert.deepEqual(punctCheck('Ich bin müde, und weil es regnet, bleibe ich.', ['comma-before:weil']), []);
  assert.equal(lowerStart('Vielen Dank!'), 'vielen Dank!');
  assert.equal(lowerStart('Ihre Mail'), 'Ihre Mail');
  // a slip, not a miss: right, with the note
  const g = gradeAnswer(data.byId.get('BS:a1-lieber-jonas'), 'Lieber Jonas', null, data);
  assert.ok(g.ok); assert.equal(g.punctMiss[0].code, 'comma-end');
});

test('detectors: aber/denn keep the order, deshalb after a comma takes the verb, verbs from the word list', () => {
  const cls = s => Det.classes(s, null);
  assert.deepEqual(cls('Die Arbeit ist hart, aber macht sie Spaß.'), ['connector-order']);
  assert.deepEqual(cls('Das ist möglich, aber könnten viele Firmen das testen.'), ['connector-order']);
  assert.deepEqual(cls('Ich komme mit, aber kannst du mich abholen?'), [], 'a question after aber');
  assert.deepEqual(cls('Das wusste keiner, aber selbst ich war überrascht.'), []);
  assert.deepEqual(cls('Es regnet, deshalb ich bleibe zu Hause.'), ['v2']);
  assert.deepEqual(cls('Ich verstehe, aber ich finde trotzdem, wir sollten warten.'), []);
  const verbs = Det.verbForms(J('content/igloo/words/de.json'));
  assert.equal(Det.run('Ich weiß, dass er wohnt in Berlin.', { model: '' }, null, { verbs })?.cls, 'verb-final');
  assert.equal(Det.run('Entschuldigung, dass du warten musstest.', { model: '' }, null, { verbs }), null);
  assert.equal(Det.run('Wenn es nicht regnen würde würden wir spazieren gehen', { model: '' }, null, { verbs }), null);
});

test('budget: Schreiben gets its share while it is the focus, and the main rounds leave it room', () => {
  // round 3: writingBudget/dayBudget are gone; the Schreiben phrases are the writing deck's share of the one
  // allowance. The same rules, read from allowance().
  const settings = { minutesPerDay: 60, exam: { type: 'goethe-b1' } };
  const c = context({ today: '2026-10-04', exam: EXAM });
  const at = (/** @type {any} */ o = {}) => allowance({ c, settings, decks: { b1: { due: 10 }, writing: { due: 0, open: 100 } }, priorityLeft: 200, focus: true, ...o });
  const f = at().decks.writing;
  assert.equal(f.newPerDay, 10, 'phrases are capped at about 8 minutes (0.75 min a phrase); the rest of the share is writing');
  assert.ok(f.minutes <= 8, 'two rounds at most');
  assert.ok(at({ fixedMin: 20 }).newPerDay <= at().newPerDay, 'the task is reserved too');
  assert.equal(at({ focus: false }).decks.writing.newPerDay, 4);
  assert.equal(allowance({ c: context({ today: '2026-10-08', exam: EXAM }), settings, decks: { writing: { due: 5, open: 100 } }, focus: true }).decks.writing.newPerDay, 0, 'no new on the eve');
  const without = allowance({ c, settings, decks: { b1: { due: 10 } }, priorityLeft: 200 });
  const withW = at();
  assert.ok(withW.decks.b1.newPerDay <= without.decks.b1.newPerDay); assert.ok(withW.decks.writing.rounds >= 1);
  assert.equal(without.decks.writing.newPerDay, 0);
});

test('modules: Schreiben under the pass line keeps the focus; an unscored Sprechen does not take it', () => {
  const scores = moduleScores({ attempts: [{ module: 'lesen', score: 25, max_score: 30, submitted_at: '2026-09-30T10:00:00Z' }, { module: 'sprechen', score: null, max_score: 100 }],
    feedback: [{ module: 'schreiben', body: '! circa 44 / 100 · nicht bestanden', created_at: '2026-10-01T10:00:00Z' }] });
  assert.equal(weakestModule(scores), 'schreiben');
  assert.ok(needsWork(scores));
  const passed = moduleScores({ attempts: [{ module: 'lesen', score: 15, max_score: 30 }], feedback: [{ module: 'schreiben', body: '! circa 75 / 100', created_at: '2026-10-01T10:00:00Z' }] });
  assert.ok(!needsWork(passed));
  const store = { get: (n, f) => f, attempts: () => [] };
  assert.ok(writingFocus({ store, c: { phase: 'week' }, settings: { exam: { type: 'goethe-b1', modules: [] } } }), 'nothing taken yet');
  assert.ok(!writingFocus({ store, c: { phase: 'after' }, settings: { exam: { type: 'goethe-b1', modules: [] } } }));
});

test('rounds: write kinds, the daily round leaves Schreiben out, a Schreiben round takes it', () => {
  assert.deepEqual(C.parseKind('write'), { kind: 'write', area: 'writing' });
  assert.deepEqual(C.parseKind('write:W3'), { kind: 'write', area: 'writing', topic: 'W3' });
  assert.equal(slotKey(C.parseKind('write:W3')), 'write:W3');
  const c = context({ today: '2026-10-04', exam: EXAM });
  const s = { data, cards: {}, day: C.newDay('2026-10-04'), c, newPerDay: 20, writingNew: 24 };
  assert.ok(!C.compose(s).some(id => isWriting(id)), 'the daily round');
  const w = C.compose(s, C.parseKind('write'));
  assert.ok(w.length >= 8 && w.every(id => isWriting(id)));
  assert.ok(C.compose(s, C.parseKind('write:W3')).every(id => data.byId.get(id).group === 'W3'));
  assert.equal(C.compose({ ...s, writingNew: 0 }, C.parseKind('write')).length, 0, 'no quota, nothing new');
});

test('plan: a Schreiben row right after the review round while it is the weakest module', () => {
  const t = (k, v = {}) => `${k}${Object.keys(v).length ? ' ' + JSON.stringify(v) : ''}`;
  const c = context({ today: '2026-10-04', exam: EXAM });
  // (round 3: the fake store keeps its card in deck b1; every deck is read now)
  const store = { cards: d => (d === 'b1' ? { 'BS:a1-lieber-jonas': { S: 3, D: 5, reps: 2, last: '2026-10-01', due: '2026-10-03', stage: 1, learn: null, hist: [] } } : {}),
    attempts: () => [], get: (n, f) => (n === 'b1.session' ? { stats: { day: '2026-10-04', priorityLeft: 50, pool: 900, unseen: 500, writing: { due: 1, unseen: 90 } } } : f) };
  const settings = { language: 'german', exam: { type: 'goethe-b1', date: EXAM, modules: ['lesen', 'hoeren', 'schreiben', 'sprechen'] }, minutesPerDay: 60, newPerDay: null };
  const rows = planItems({ store, c, settings, exam: null, t });
  const w = rows.find(r => r.id === 'practice.writing');
  assert.equal(w.priority, 22); assert.equal(w.kind, 'write'); assert.equal(w.href, '#/practice/round?kind=write');
  assert.match(w.detail, /"due":1,"fresh":10/, "phrases capped at about 8 minutes while Schreiben is the focus");
  assert.ok(!(rows.find(r => r.id === 'practice.round')?.detail || '').includes('"due":1,'), 'the Schreiben card is not in the review count');
});

test('plan: while Schreiben is the focus, a task from memory comes first; the least recently written Aufgabe', () => {
  const t = (k, v = {}) => `${k}${Object.keys(v).length ? ' ' + JSON.stringify(v) : ''}`;
  const c = context({ today: '2026-10-04', exam: EXAM });
  const tasks = [{ id: 'a1-x', a: 'A1', title: 'X', min: 20 }, { id: 'a2-y', a: 'A2', title: 'Y', min: 25 }, { id: 'a3-z', a: 'A3', title: 'Z', min: 15 }];
  const kv = { written: { 'a1-x': '2026-10-02' } };
  const get = (n, f) => (n === 'b1.session' ? { stats: { day: '2026-10-04', priorityLeft: 50, pool: 900, unseen: 500, writing: { due: 0, unseen: 90 }, tasks } } : n === 'practice.write' ? kv : f);
  const store = { cards: () => ({}), attempts: () => [], get };
  const settings = { language: 'german', exam: { type: 'goethe-b1', date: EXAM, modules: ['lesen', 'hoeren', 'schreiben', 'sprechen'] }, minutesPerDay: 60, newPerDay: null };
  const rows = planItems({ store, c, settings, exam: null, t });
  const w = rows.find(r => r.id === 'practice.schreiben');
  assert.equal(w.priority, 18); assert.equal(w.minutes, 25); assert.equal(w.href, '#/practice/write/build/a2-y/free');
  kv.written['a2-y'] = '2026-10-04';
  const done = planItems({ store, c, settings, exam: null, t }).find(r => r.id === 'practice.schreiben');
  assert.equal(done.done, true, 'written today: the row shows done');
});

test('build an email: lines assemble into the email, connectors are found, the model email', () => {
  const t = S.tasks.find(x => x.id === 'a1-umzug');
  const mail = B.assemble(t, { open: 'Liebe Maria,', intro: 'vielen Dank für deine E-Mail!', sign: 'Liebe Grüße' });
  assert.deepEqual(mail.map(l => l.key), ['open', '', 'intro', '', 'sign']);
  const model = B.asText(B.modelEmail(t));
  assert.match(model, /^Liebe Maria,\n\nvielen Dank/);
  assert.ok(B.wordCount(model) >= 70);
  assert.deepEqual(B.connectorsIn('Zum Beispiel arbeite ich, weil es Spaß macht, aber obwohl …').map(c => c.word), ['Zum Beispiel', 'weil', 'aber', 'obwohl']);
  assert.deepEqual(B.score({ a: { first: true, ok: true }, b: { first: false, ok: true } }), { right: 1, total: 2 });
});

test('correction of a practice text: a generic prompt with the task only', () => {
  const t = S.tasks.find(x => x.id === 'a3-gespraech-verschieben');
  const m = taskMessage(t, 'Sehr geehrte Frau Berger, …', 40);
  assert.match(m, /<aufgabe nr="3" woerter="40">/); assert.match(m, /- Entschuldigen Sie sich höflich\./);
  assert.ok(!/learner|Lerner/i.test(TASK_GRADER), 'no learner slot');
  assert.ok(isTaskCorrection('! circa 14 / 20\n_Erfüllung 3_')); assert.ok(!isTaskCorrection('Here is your feedback'));
});
