// Speaking situations (src/domain/sim.js): the bank validator, the level unlocks, the round composer and
// the scheduling of self-grades through the shared FSRS, plus the budget and Today's row. Synthetic data only, except
// the public bank itself (content/speak/situations.json), which must validate.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { context } from '../../src/core/clock.js';
import * as S from '../../src/domain/sim.js';
import { allowance } from '../../src/domain/budget.js';
import { kindOf } from '../../src/domain/itemids.js';
import { planItems, simToday } from './practice-rows.mjs';
import { build, serialise, SRC, VOICES } from '../../tools/build-speak.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = p => JSON.parse(readFileSync(path.join(ROOT, p), 'utf8'));
const BANK = read('content/speak/situations.json');
const CHUNKS = new Set(Object.keys(read('content/igloo/chunks/german.json').chunks));
const FRAMES = new Set(read('content/b1/frames.json').map(f => f.id));
const EXAM = '2026-10-09';
const md5 = s => createHash('md5').update(s).digest('hex');

/* ---------- the bank ---------- */

test('bank: the public bank validates, is built from its source, and has depth at A2 and B1', () => {
  assert.deepEqual(S.validateBank(BANK, { chunkIds: CHUNKS, frameIds: FRAMES }), []);
  assert.equal(serialise(build(JSON.parse(readFileSync(SRC, 'utf8')))), readFileSync(path.join(ROOT, 'content/speak/situations.json'), 'utf8'), 'run node tools/build-speak.mjs');
  const n = lv => BANK.items.filter(it => it.lv === lv).length;
  assert.ok(BANK.items.length >= 150 && BANK.items.length <= 250, `${BANK.items.length} items`);
  assert.ok(n('A2') + n('B1') >= 0.6 * BANK.items.length, 'most items are A2 or B1');
  for (const lv of S.LEVELS) assert.ok(n(lv) > 0, `items at ${lv}`);
  for (const fn of ['greet', 'order', 'way', 'disagree', 'decline', 'plans', 'complain', 'help', 'advice', 'proscons', 'opinion', 'interrupt', 'repeat', 'agreebut', 'apologise', 'persuade'])
    assert.ok(BANK.items.some(it => it.fn === fn), `function ${fn}`);
});

test('bank: audio names are md5(voice|text), other voices differ from the answer voice', () => {
  for (const it of BANK.items) {
    assert.equal(it.other.audio, `${md5(`${it.other.voice}|${it.other.de}`)}.mp3`);
    assert.ok(VOICES.other.includes(it.other.voice));
    for (const a of it.answers) assert.equal(a.audio, `${md5(`${VOICES.answer}|${a.de}`)}.mp3`);
  }
  assert.ok(!VOICES.other.includes(VOICES.answer));
  assert.ok([...VOICES.other, VOICES.answer].every(v => /^de-DE-\w+Neural$/.test(v) && !/Multilingual/.test(v)), 'monolingual German voices only');
});

test('parseMarked: one bracketed span, offsets into the plain sentence', () => {
  assert.deepEqual(S.parseMarked('Am Mittwoch kann ich nicht. [Wie wäre es mit] Donnerstag?'),
    { de: 'Am Mittwoch kann ich nicht. Wie wäre es mit Donnerstag?', chunk: [28, 43] });
  assert.deepEqual(S.chunkParts({ de: 'Ja, gern.', chunk: [0, 2], audio: '' }), ['', 'Ja', ', gern.']);
  assert.equal(S.parseMarked('No brackets.'), null);
  assert.equal(S.parseMarked('[Two] [spans].'), null);
  assert.equal(S.parseMarked('A [ padded] span.'), null);
});

/** A minimal valid bank to break one rule at a time. */
function tiny() {
  const a = (de, chunk) => ({ de, chunk, audio: `${'a'.repeat(32)}.mp3` });
  const it = (id, fn, lv, reg, other, ans) => ({ id, fn, lv, freq: 1, reg, setup: 'A friend, at a café', goal: 'Say it', other: { de: other, voice: 'de-DE-KatjaNeural', audio: `${'b'.repeat(32)}.mp3` }, answers: [ans], src: 'new' });
  return {
    voices: { other: ['de-DE-KatjaNeural'], answer: 'de-DE-KillianNeural' },
    functions: { greet: 'Greeting', decline: 'Declining' },
    items: [
      it('SS:greet-01', 'greet', 'A1', 'Sie', 'Wie geht es Ihnen?', a('Gut, und Ihnen?', [5, 15])),
      it('SS:greet-02', 'greet', 'A2', 'du', 'Wie findest du sie?', a('Sie ist nett.', [0, 3])),
      it('SS:decline-01', 'decline', 'B1', 'du', 'Hast du Zeit?', a('Leider nicht.', [0, 6])),
      it('SS:decline-02', 'decline', 'B2', 'Sie', 'Passt es Ihnen?', a('Das wird knapp.', [9, 14])),
    ],
  };
}

test('validateBank: a clean bank passes; "Sie" at a sentence start in a du item is she/they, not formal', () => {
  assert.deepEqual(S.validateBank(tiny()), []);
});

test('validateBank: flags ids, functions, levels, chunks, registers, voices, links and missing levels', () => {
  const cases = [
    [b => { b.items[0].id = 'greet-01'; }, /id must look like/],
    [b => { b.items[1].id = 'SS:greet-01'; }, /duplicate id/],
    [b => { b.items[2].id = 'SS:greet-09'; }, /does not match its function/],
    [b => { b.items[0].fn = 'dance'; }, /unknown function/],
    [b => { b.items[0].lv = 'C1'; }, /unknown level/],
    [b => { b.items[0].freq = 4; }, /freq/],
    [b => { b.items[0].answers[0].chunk = [5, 99]; }, /chunk is outside/],
    [b => { b.items[0].answers[0].chunk = [4, 15]; }, /starts or ends with a space/],
    [b => { b.items[0].answers = []; }, /no model answer/],
    [b => { b.items[2].answers[0].de = 'Können Sie das wiederholen?'; }, /uses Sie in a du situation/],
    [b => { b.items[0].answers[0].de = 'Gut, und dir?'; }, /uses du in a Sie situation/],
    [b => { b.items[3].other.de = 'Hast du Zeit?'; }, /other line uses du in a Sie situation/],
    [b => { b.items[0].goal = 'Say it — now'; }, /goal has a dash/],
    [b => { b.items[0].other.audio = 'x.mp3'; }, /other.audio/],
    [b => { b.voices.answer = 'de-DE-KatjaNeural'; }, /answer voice must differ/],
    [b => { b.items[3].lv = 'B1'; }, /no items at B2/],
    [b => { b.items[0].ck = 'ENG_CHUNK_9999'; }, /unknown chunk/],
    [b => { b.items[0].frame = 'BP:nope'; }, /unknown frame/],
  ];
  for (const [mutate, re] of cases) {
    const b = tiny(); mutate(b);
    const errs = S.validateBank(b, { chunkIds: new Set(['ENG_CHUNK_0001']), frameIds: new Set(['BP:s1-gute-idee']) });
    assert.ok(errs.some(e => re.test(e)), `${re}: got ${JSON.stringify(errs)}`);
  }
});

/* ---------- levels ---------- */

const item = (id, lv, fn = 'greet', freq = 1) => ({ id, fn, lv, freq, reg: 'du', setup: '', goal: '', other: { de: '', audio: '', voice: '' }, answers: [], src: 'new' });
const learntRec = (o = {}) => ({ S: 5, D: 5, reps: 3, lapses: 0, last: '2026-10-01', first: '2026-09-28', due: '2026-10-06', stage: 1, streak: 0, learn: null, relearn: false, hist: [], ...o });
const LV = [
  ...Array.from({ length: 5 }, (_, i) => item(`SS:a-0${i}`, 'A1')),
  ...Array.from({ length: 5 }, (_, i) => item(`SS:b-0${i}`, 'A2')),
  ...Array.from({ length: 5 }, (_, i) => item(`SS:c-0${i}`, 'B1')),
  ...Array.from({ length: 5 }, (_, i) => item(`SS:d-0${i}`, 'B2')),
];
const cardsFor = (ids, o) => Object.fromEntries(ids.map(id => [id, learntRec(o)]));
const openOf = (cards, start) => [...S.openLevels(S.levelStates(LV, cards, start))];

test('unlock: A1 opens first; the next level opens at 60 % of the level before learnt', () => {
  assert.deepEqual(openOf({}, null), ['A1']);
  assert.deepEqual(openOf(cardsFor(['SS:a-00', 'SS:a-01'], {}), null), ['A1'], '40 % is not steady');
  assert.deepEqual(openOf(cardsFor(['SS:a-00', 'SS:a-01', 'SS:a-02'], {}), null), ['A1', 'A2'], '60 % opens A2');
  const st = S.levelStates(LV, cardsFor(['SS:a-00', 'SS:a-01', 'SS:a-02'], {}), null);
  assert.deepEqual(st.map(x => [x.lv, x.n, x.learnt, x.steady, x.open]), [['A1', 5, 3, true, true], ['A2', 5, 0, false, true], ['B1', 5, 0, false, false], ['B2', 5, 0, false, false]]);
});

test('unlock: learning steps and lapses do not count as learnt; a lapse can close the next level again', () => {
  const ids = ['SS:a-00', 'SS:a-01', 'SS:a-02'];
  assert.deepEqual(openOf({ ...cardsFor(ids.slice(0, 2), {}), 'SS:a-02': learntRec({ learn: 1 }) }, null), ['A1']);
  assert.deepEqual(openOf({ ...cardsFor(ids.slice(0, 2), {}), 'SS:a-02': learntRec({ relearn: true }) }, null), ['A1']);
});

test('unlock: choosing a start level opens everything up to it; B2 still waits for B1', () => {
  assert.deepEqual(openOf({}, 'B1'), ['A1', 'A2', 'B1']);
  assert.deepEqual(openOf(cardsFor(['SS:c-00', 'SS:c-01', 'SS:c-02'], {}), 'B1'), ['A1', 'A2', 'B1', 'B2']);
  // a chosen level stays open even when the levels below it are not steady
  assert.ok(S.levelStates(LV, {}, 'A2')[1].open);
});

test('new order after a jump: the start level first, then above it, then the easier levels', () => {
  const cards = cardsFor(['SS:c-00', 'SS:c-01', 'SS:c-02'], {});
  const order = S.newOrder(LV, cards, 'B1', S.openLevels(S.levelStates(LV, cards, 'B1'))).map(it => it.lv);
  assert.deepEqual([...new Set(order)], ['B1', 'B2', 'A2', 'A1']);
  assert.ok(!S.newOrder(LV, cards, 'B1', new Set(['B1'])).some(it => cards[it.id]), 'seen items are never new');
});

/* ---------- composing a round ---------- */

const c = context({ today: '2026-10-04', exam: EXAM });

test('compose: due first (oldest first), then new within the budget, the same function never twice in a row', () => {
  const items = [item('SS:x-01', 'A1', 'greet'), item('SS:x-02', 'A1', 'greet'), item('SS:x-03', 'A1', 'order'), item('SS:x-04', 'A1', 'order'), item('SS:x-05', 'A1', 'way')];
  const cards = { 'SS:x-01': learntRec({ due: '2026-10-04' }), 'SS:x-02': learntRec({ due: '2026-10-02' }) };
  const r = S.compose({ items, cards, c, pick: { kind: 'mixed' }, start: 'A1', newLeft: 2 });
  assert.equal(r.due, 2); assert.equal(r.fresh, 2); assert.equal(r.extra, false);
  assert.equal(r.ids[0], 'SS:x-02', 'the oldest due comes first');
  assert.deepEqual(new Set(r.ids), new Set(['SS:x-01', 'SS:x-02', 'SS:x-03', 'SS:x-04']));
  for (let k = 1; k < r.ids.length; k++) {
    const f = id => items.find(it => it.id === id).fn;
    assert.notEqual(f(r.ids[k]), f(r.ids[k - 1]), 'interleaved');
  }
});

test('compose: picks by level and function, new capped per pick, none when the clock allows no new items', () => {
  const r = S.compose({ items: LV, cards: {}, c, pick: { kind: 'level', lv: 'A1' }, start: 'A1', newLeft: 0 });
  assert.equal(r.fresh, 5, 'a pick ignores the mixed budget, up to PICK_NEW');
  assert.equal(S.compose({ items: LV, cards: {}, c, pick: { kind: 'level', lv: 'B1' }, start: 'A1', newLeft: 10 }).ids.length, 0, 'a closed level has nothing new');
  const fn = S.compose({ items: [...LV, item('SS:z-01', 'A1', 'decline')], cards: {}, c, pick: { kind: 'fn', fn: 'decline' }, start: 'A1', newLeft: 0 });
  assert.deepEqual(fn.ids, ['SS:z-01']);
  const eve = context({ today: '2026-10-08', exam: EXAM });
  assert.equal(S.compose({ items: LV, cards: {}, c: eve, pick: { kind: 'mixed' }, start: 'A1', newLeft: 10 }).ids.length, 0);
});

test('compose: with nothing due or new, practise ahead on the least known items not seen today', () => {
  const cards = { 'SS:a-00': learntRec({ due: '2026-10-20', S: 30 }), 'SS:a-01': learntRec({ due: '2026-10-07', S: 2 }), 'SS:a-02': learntRec({ due: '2026-10-07', last: '2026-10-04' }) };
  const r = S.compose({ items: LV.slice(0, 3), cards, c, pick: { kind: 'mixed' }, start: 'A1', newLeft: 0 });
  assert.equal(r.extra, true);
  assert.deepEqual(r.ids, ['SS:a-01', 'SS:a-00'], 'least known first; reviewed today left out');
  assert.deepEqual(S.parsePick('level:B1'), { kind: 'level', lv: 'B1' });
  assert.deepEqual(S.parsePick('fn:decline'), { kind: 'fn', fn: 'decline' });
  assert.deepEqual(S.parsePick('nonsense'), { kind: 'mixed' });
  assert.equal(S.pickKey(S.parsePick('level:A2')), 'level:A2');
});

/* ---------- scheduling ---------- */

const NOW = Date.UTC(2026, 9, 4, 10);

test('grade: a new card learns in two steps; Easy graduates it at once; Again comes back in the round', () => {
  const g3 = S.gradeCard({ rec: null, g: 3, c, now: NOW });
  assert.equal(g3.reinsert, 'learn'); assert.equal(g3.rec.learn, 1); assert.equal(g3.rec.due, '2026-10-04');
  const again = S.gradeCard({ rec: g3.rec, g: 3, c, now: NOW });
  assert.equal(again.reinsert, null); assert.equal(again.rec.learn, null); assert.equal(again.rec.due, '2026-10-05', 'graduated to tomorrow');
  const easy = S.gradeCard({ rec: null, g: 4, c, now: NOW });
  assert.equal(easy.reinsert, null); assert.equal(easy.rec.learn, null);
  assert.ok(easy.rec.due > '2026-10-05', `Easy skips ahead: due ${easy.rec.due}`);
  const miss = S.gradeCard({ rec: null, g: 1, c, now: NOW });
  assert.equal(miss.reinsert, 'learn'); assert.equal(miss.rec.learn, 0);
  assert.equal(easy.rec.hist.at(-1)[3], 's', 'logged as spoken');
});

test('grade: a review lapse relearns in the round; Good on a review moves it out; the exam day writes nothing', () => {
  const rec = learntRec({ due: '2026-10-04', last: '2026-09-30' });
  const lapse = S.gradeCard({ rec, g: 1, c, now: NOW });
  assert.equal(lapse.reinsert, 'lapse'); assert.equal(lapse.rec.relearn, true); assert.equal(lapse.rec.lapses, 1);
  const good = S.gradeCard({ rec, g: 3, c, now: NOW });
  assert.ok(good.rec.due > '2026-10-04');
  // a weak card due after the exam is pulled before it (the exam cap of the shared scheduler)
  const weak = S.gradeCard({ rec: learntRec({ S: 1, due: '2026-10-04', last: '2026-10-02' }), g: 2, c, now: NOW });
  assert.ok(weak.rec.due <= '2026-10-08', `weak card due ${weak.rec.due}`);
  const day = context({ today: EXAM, exam: EXAM });
  assert.equal(S.gradeCard({ rec: null, g: 3, c: day, now: NOW }).rec, null);
  assert.equal(S.gradeCard({ rec, g: 3, c: day, now: NOW }).wrote, false);
});

test('preview: captions under the buttons (null = this round, else days)', () => {
  const p = S.preview(null, c, NOW);
  assert.equal(p[0], null); assert.equal(p[1], null); assert.equal(p[2], null);
  assert.ok(p[3] >= 2, 'Easy on a new card skips ahead');
  const r = S.preview(learntRec({ due: '2026-10-04', last: '2026-09-30' }), c, NOW);
  assert.equal(r[0], null); assert.ok(r[2] >= 1 && r[3] >= r[2]);
});

test('round: reinsertions at +3 then +6, three showings at most; dots, streak and summary', () => {
  const round = S.startRound(['SS:a-00', 'SS:a-01', 'SS:a-02', 'SS:a-03', 'SS:a-04', 'SS:b-00', 'SS:b-01'], { kind: 'mixed' }, '2026-10-04', NOW);
  assert.equal(S.record(round, { id: 'SS:a-00', g: 1, isNew: true, ms: 9000, reinsert: 'learn' }), true);
  assert.deepEqual(round.queue.slice(0, 5).map(q => q.id), ['SS:a-00', 'SS:a-01', 'SS:a-02', 'SS:a-03', 'SS:a-00']);
  assert.deepEqual(S.dots(round, true).slice(0, 2), ['miss', '']);
  for (const id of ['SS:a-01', 'SS:a-02', 'SS:a-03']) { S.advance(round); S.record(round, { id, g: 3, isNew: true, ms: 8000, reinsert: null }); }
  assert.equal(S.streak(round), 3);
  S.advance(round);
  assert.equal(round.queue[round.i].re, true);
  assert.equal(S.record(round, { id: 'SS:a-00', g: 1, isNew: true, ms: 7000, reinsert: 'learn' }), true, 'second miss: +6');
  assert.equal(round.queue.findLastIndex(q => q.id === 'SS:a-00'), Math.min(round.queue.length - 1, round.i + 6));
  assert.equal(S.streak(round), 0);
  // a third showing is the last
  const k = round.queue.findLastIndex(q => q.id === 'SS:a-00');
  round.i = k;
  assert.equal(S.record(round, { id: 'SS:a-00', g: 1, isNew: false, ms: 5000, reinsert: 'learn' }), false);
  const byId = new Map(LV.map(it => [it.id, it]));
  const sum = S.summary(round, byId);
  assert.equal(sum.total, 4); assert.deepEqual(sum.counts, { again: 1, hard: 0, good: 3, easy: 0 });
  assert.equal(sum.fresh, 4, 'only first showings count as new');
  assert.equal(S.resumable(round, '2026-10-04', NOW + 1000), round.i < round.queue.length);
  assert.equal(S.resumable(round, '2026-10-05', NOW + 1000), false);
});

/* ---------- budget, Today and ids ---------- */

const settings = { language: 'german', exam: { type: 'goethe-b1', date: EXAM, modules: ['sprechen'] }, minutesPerDay: 60, newPerDay: null };
const t = (k, v = {}) => `${k}${Object.keys(v).length ? ' ' + JSON.stringify(v) : ''}`;
/** A store with decks (the plan reads cards('b1') and cards('speak')). */
const store = ({ b1 = {}, speak = {}, kv = {} } = {}) => ({ cards: deck => (deck === 'speak' ? speak : deck === 'b1' ? b1 : {}), get: (n, f) => (n in kv ? kv[n] : f) });

test('situations: their share of the one allowance scales with the minutes, none on the eve; a new card counts twice', () => {
  // round 3: simBudget is gone; situations are the speak deck's share of the one allowance (domain/budget.js).
  const sp = (/** @type {any} */ o, cc = c, st = settings) => allowance({ c: cc, settings: st, decks: { speak: o } }).decks.speak;
  const x = sp({ due: 3 });
  assert.deepEqual([x.newPerDay, x.newLeft, x.due + 2 * x.newLeft, x.minutes], [10, 10, 23, 5]);
  assert.equal(sp({ due: 0 }, c, { ...settings, minutesPerDay: 15 }).newPerDay, 4);
  assert.equal(sp({ due: 0, shown: 8, open: 1 }).newLeft, 1);
  const eve = context({ today: '2026-10-08', exam: EXAM });
  const e = sp({ due: 0 }, eve);
  assert.deepEqual([e.newPerDay, e.newLeft, e.minutes], [0, 0, 0]);
});

test('Today: a situations row from deck speak, kept out of the B1 review count; done after a round', () => {
  const speak = { 'SS:greet-01': learntRec({ due: '2026-10-03' }), 'SS:greet-02': learntRec({ due: '2026-10-09' }) };
  const s = store({ speak, kv: { 'speak.sim': { stats: { day: '2026-10-04', unseen: 3, total: 5 } } } });
  const rows = planItems({ store: s, c, settings, exam: null, t });
  const row = rows.find(r => r.id === 'practice.situations');
  assert.equal(row.kind, 'speak'); assert.equal(row.priority, 48);
  assert.match(row.detail, /"due":1,"fresh":3/);
  assert.equal(row.introducesNew, false);
  const review = rows.find(r => r.id === 'practice.round');
  assert.ok(!review || review.kind === 'new', 'situations never count as B1 reviews');
  // (round 3: the day's share is never more than what is open, so newPerDay is 3 here, not the minutes' 10)
  assert.deepEqual(simToday({ store: s, c, settings }), { newPerDay: 3, newLeft: 3, cards: 7, minutes: 2, due: 1, roundsToday: 0 });
  // nothing left after a round today: the row shows done
  const done = store({ speak: { 'SS:greet-01': learntRec({ due: '2026-10-06' }) }, kv: { 'speak.sim': { stats: { day: '2026-10-04', unseen: 0 }, day: { day: '2026-10-04', newShown: 3, rounds: 1 } } } });
  assert.equal(planItems({ store: done, c, settings, exam: null, t }).find(r => r.id === 'practice.situations').done, true);
  // the eve: reviews only. Hotfix: situations are a side deck, so the one due on the exam day stays there (it is no
  // longer pulled onto the eve); the eve has the one due before it
  const eve = planItems({ store: store({ speak }), c: context({ today: '2026-10-08', exam: EXAM }), settings, exam: null, t }).find(r => r.id === 'practice.situations');
  assert.match(eve.detail, /plan.sim.detail \{"n":1\}/);
});

test('ids: SS: names a speaking situation', () => {
  assert.deepEqual(kindOf('SS:decline-01'), { tag: 'SS', kind: 'sim', area: 'situations' });
  for (const it of BANK.items) assert.equal(kindOf(it.id).tag, 'SS');
});

test('Check with the mic: the chunk heard in a row, the Say it aloud checks, and a suggested grade (journey #10)', () => {
  const mk = (/** @type {string[]} */ ...marked) => ({ answers: marked.map(m => ({ ...S.parseMarked(m), audio: 'x.mp3' })) });
  const time = mk('Am Mittwoch kann ich nicht. [Wie wäre es mit] Donnerstag?', '[Geht es auch] am Donnerstag?');
  assert.equal(S.saidChunk('am Mittwoch nicht, wie waere es mit Donnerstag', time), true);   // umlaut spelt out
  assert.equal(S.saidChunk('Geht es auch am Donnerstag', time), true);                         // the second answer's chunk
  assert.equal(S.saidChunk('wie es wäre mit Donnerstag', time), false);                       // words out of order
  assert.equal(S.micCheck('Wie wäre es mit Donnerstag?', time).suggest, 3);
  assert.equal(S.micCheck('Donnerstag vielleicht?', time).suggest, 1);
  const opinion = mk('[Ich glaube, dass] das eine gute Idee ist.');
  const wrongOrder = S.micCheck('ich glaube dass das ist eine gute Idee', opinion);
  assert.equal(wrongOrder.chunk, true);
  assert.equal(wrongOrder.verbFinal, false);
  assert.equal(wrongOrder.suggest, 2);
  // a phone that fixes word order (the mic check said so) never fails the verb check
  assert.equal(S.micCheck('ich glaube dass das ist eine gute Idee', opinion, { asr: { verbFinal: false } }).suggest, 3);
});

test('Check with the mic outdoors: every alternative checked, and audio the phone was unsure of is never marked wrong', () => {
  const mk = (/** @type {string[]} */ ...marked) => ({ answers: marked.map(m => ({ ...S.parseMarked(m), audio: 'x.mp3' })) });
  const time = mk('Am Mittwoch kann ich nicht. [Wie wäre es mit] Donnerstag?');
  const alt = (text, confidence = 0.8) => ({ text, confidence });
  // the best guess misses the chunk, the second alternative has it: the second counts
  const two = S.micCheckHeard({ alts: [alt('wie wäre es mit Donnerstag', 0.8), alt('wie wäre es mit Donnerstag', 0.6)].map((a, i) => i ? a : alt('wir wären es mit Donnerstag')) }, time);
  assert.equal(two.chunk, true); assert.equal(two.alt, 1); assert.equal(two.suggest, 3); assert.equal(two.unsure, false);
  // clean, confident and wrong: still Again
  const wrong = S.micCheckHeard({ alts: [alt('Am Mittwoch kann ich nicht, vielleicht Freitag', 0.92)] }, time);
  assert.equal(wrong.chunk, false); assert.equal(wrong.suggest, 1); assert.equal(wrong.unsure, false);
  // low confidence: the failed check is unsure, the suggestion is Good (he grades himself)
  const low = S.micCheckHeard({ alts: [alt('Am Mittwoch kann ich nicht, vielleicht Freitag', 0.3)] }, time);
  assert.equal(low.chunk, 'unsure'); assert.equal(low.suggest, 3); assert.equal(low.unsure, true); assert.deepEqual(low.why, ['confidence']);
  // garbled, and a loud room where little came through
  assert.equal(S.micCheckHeard({ alts: [alt('ja', 0.9)] }, time).unsure, true);
  const loud = { db: -35, peak: -30, loud: true, gusty: false, noisy: true };
  const street = S.micCheckHeard({ alts: [alt('Mittwoch nicht Freitag', 0.9)], ambient: loud }, time);
  assert.equal(street.unsure, true); assert.equal(street.suggest, 3); assert.notEqual(street.chunk, false);
  // heard right in the noise: Right, as in a quiet room
  const fine = S.micCheckHeard({ alts: [alt('Am Mittwoch kann ich nicht, wie wäre es mit Donnerstag', 0.9)], ambient: loud }, time);
  assert.equal(fine.chunk, true); assert.equal(fine.unsure, false); assert.equal(fine.suggest, 3);
  // a wrong word order heard unsure is never a Hard either
  const opinion = mk('[Ich glaube, dass] das eine gute Idee ist.');
  const order = S.micCheckHeard({ alts: [alt('ich glaube dass das ist eine gute Idee', 0.2)] }, opinion);
  assert.equal(order.verbFinal, 'unsure'); assert.equal(order.suggest, 3);
  // the old shape (text only) still works: typed answers are checked the same way
  assert.equal(S.micCheckHeard({ text: 'Wie wäre es mit Donnerstag?' }, time).suggest, 3);
});
