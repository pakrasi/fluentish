// Practice: pool, grading, the round composer, a round in progress, exam words. The B1 content is public course
// content; every learner record here is synthetic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { context, add } from '../../src/core/clock.js';
import FS from '../../src/domain/fsrs.js';
import { kindOf } from '../../src/domain/itemids.js';
import { buildPool, mistakeItem } from '../../src/features/practice/pool.js';
import { gradeAnswer } from '../../src/features/practice/grade.js';
import * as C from '../../src/features/practice/compose.js';
import * as S from '../../src/features/practice/session.js';
import * as W from '../../src/features/practice/words.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const J = p => JSON.parse(readFileSync(path.join(ROOT, p), 'utf8'));
const content = { items: J('content/b1/items.json'), grammar: J('content/b1/grammar.json'), bank: J('content/b1/bank.json'), plan: J('content/b1/plan.json'), nouns: J('content/b1/nouns.json') };
const EXAM = '2026-10-09';
const mistakes = [
  { id: 'F:att-1-1', v: 1, wrong: 'Ich komme nicht, weil ich habe keine Zeit.', right: 'Ich komme nicht, weil ich keine Zeit habe.', rule: 'Verb at the end after weil.', source: { attemptId: 'att-1', test: 2, module: 'schreiben', label: null }, createdAt: '2026-10-01T10:00:00Z', deletedAt: null },
  { id: 'F:att-1-2', v: 1, wrong: 'Ich freue mich für das Treffen.', right: 'Ich freue mich auf das Treffen.', rule: '', source: { attemptId: 'att-1', test: 2, module: 'schreiben', label: null }, createdAt: '2026-10-01T10:00:00Z', deletedAt: null },
  { id: 'F:att-1-3', v: 1, wrong: 'x', right: 'y', rule: '', source: { attemptId: 'att-1', test: 2, module: 'schreiben', label: null }, createdAt: '2026-10-01T10:00:00Z', deletedAt: '2026-10-02T10:00:00Z' },
];
const data = buildPool({ ...content, mistakes });
const state = (today, cards = {}, o = {}) => ({ data, cards, day: C.newDay(today), c: context({ today, exam: o.exam === undefined ? EXAM : o.exam }), newPerDay: o.newPerDay ?? 40 });
const seen = (S0, due, o = {}) => ({ S: S0, D: 5, reps: 3, lapses: 0, last: add(due, -3), first: add(due, -10), due, stage: 1, streak: 0, learn: null, relearn: false, u: 1, hist: [[add(due, -3), 3, 3000, 't', '']], ...o });

test('pool: every item is tagged in its id, mistakes become items', () => {
  assert.ok(data.pool.length > 800, `pool has ${data.pool.length} items`);
  for (const it of data.pool) assert.ok(kindOf(it.id), `untagged id ${it.id}`);
  assert.ok(data.byId.has('F:att-1-1') && !data.byId.has('F:att-1-3'), 'deleted mistakes stay out');
  const m = data.byId.get('F:att-1-1');
  assert.equal(m.task, 'Rewrite this sentence correctly.');
  assert.equal(m.source, 'Schreiben Test 2');
  assert.equal(mistakeItem({ ...mistakes[0], source: { ...mistakes[0].source, module: 'hoeren', label: null } }).source, 'Hören Test 2');
});

test('grading: models pass, wrong answers fail, detectors and slips', () => {
  const opts = { nouns: data.nouns, traps: data.traps };
  let checked = 0;
  for (const it of data.pool.filter(x => x.kind !== 'reply' && x.model && !x.model.includes('…') && x.area !== 'mistakes')) {
    const typed = it.model;
    const g = gradeAnswer(it, typed, null, opts);
    assert.ok(g.matchOk, `${it.id}: model "${typed}" should match`);
    checked++;
  }
  assert.ok(checked > 500);
  const m = data.byId.get('F:att-1-1');
  assert.equal(gradeAnswer(m, 'Ich komme nicht, weil ich keine Zeit habe.', null, opts).ok, true);
  const bad = gradeAnswer(m, 'Ich komme nicht, weil ich habe keine Zeit.', null, opts);
  assert.equal(bad.ok, false);
  assert.equal(bad.right, m.model);
  // a verb-final trap in a free slot is caught by the detector even when the matcher accepts it
  const vf = data.pool.find(it => it.trap === 'verb-final' && it.wrong?.length && it.kind !== 'reply');
  if (vf) assert.equal(gradeAnswer(vf, vf.wrong[0], null, opts).ok, false, `${vf.id}: wrong answer passes`);
  // umlaut spelled out is accepted with a slip
  const uml = data.pool.find(it => it.kind === 'phrase' && /ä|ö|ü/.test(it.model) && !it.gap && it.area === 'speaking');
  const g = gradeAnswer(uml, uml.model.replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue'), null, opts);
  assert.ok(g.ok, `${uml.id}: ae/oe/ue spelling`);
});

test('composer: first round, due first, new caps, traps, fix last', () => {
  const s0 = state('2026-10-03');
  const first = C.compose(s0);
  assert.equal(first.length, 8, 'the very first round is 8 new items');
  assert.ok(first.includes('F:att-1-1'), 'mistakes from corrections come in early');
  assert.equal(new Set(first).size, first.length);
  // with 30 due cards: due first by lowest recall, at most 4 new, size 12
  const today = '2026-10-04';
  const dueIds = data.pool.filter(it => it.area === 'speaking' && it.kind === 'phrase').slice(0, 30).map(it => it.id);
  const cards = Object.fromEntries(dueIds.map((id, i) => [id, seen(1 + i, today)]));
  const s1 = state(today, cards);
  const ids = C.compose(s1);
  assert.equal(ids.length, 12);
  const nNew = ids.filter(id => !cards[id]).length;
  assert.ok(nNew <= 4, `${nNew} new`);
  assert.ok(ids.slice(0, 2).every(id => cards[id]), 'warm-ups are due items');
  // the fix: an item relearning today goes last
  const fixId = dueIds[5];
  const s2 = state(today, { ...cards, [fixId]: seen(2, today, { relearn: true, last: today, hist: [[today, 1, 4000, 't', '']] }) });
  assert.equal(C.compose(s2).at(-1), fixId);
  // eve: no new items; exam day: a warm-up of known items, 9 at most, nothing new
  const eve = C.compose(state('2026-10-08', cards, { newPerDay: 0 }));
  assert.ok(eve.every(id => cards[id]), 'no new items on the eve');
  const day = C.compose(state('2026-10-09', cards));
  assert.ok(day.length <= 9 && day.every(id => cards[id]));
  // missed: rated 1 in the last 3 days, latest first
  const missedCards = { [dueIds[0]]: seen(2, '2026-10-06', { hist: [['2026-10-02', 1, 3000, 't', '']] }), [dueIds[1]]: seen(2, '2026-10-06', { hist: [['2026-10-03', 1, 3000, 't', '']] }), [dueIds[2]]: seen(2, '2026-10-06', { hist: [['2026-09-20', 1, 3000, 't', '']] }) };
  assert.deepEqual(C.compose(state(today, missedCards), { kind: 'missed' }), [dueIds[1], dueIds[0]]);
  // mistakes round: unseen mistakes, no quota
  assert.deepEqual(C.compose(state(today, {}, { newPerDay: 0 }), { kind: 'mistakes' }), ['F:att-1-1', 'F:att-1-2']);
  assert.deepEqual(C.compose(state('2026-10-08', {}), { kind: 'mistakes' }), [], 'no unseen mistakes on the eve');
  // an area round keeps to its area
  const g = C.compose(state(today, cards), { kind: 'area', area: 'grammar' });
  assert.ok(g.length && g.every(id => data.byId.get(id).area === 'grammar'));
  assert.deepEqual(C.parseKind('area:words'), { kind: 'area', area: 'words' });
  assert.deepEqual(C.parseKind('topic:verb-final'), { kind: 'topic', area: 'grammar', topic: 'verb-final' });
  assert.deepEqual(C.parseKind('area:nope'), { kind: 'today' });
});

test('new items a day follow the exam date and the minutes', () => {
  const settings = { newPerDay: null, minutesPerDay: 60, exam: { type: 'goethe-b1' } };
  assert.equal(C.dailyNew({ c: context({ today: '2026-10-08', exam: EXAM }), settings, dueN: 10, priorityLeft: 100 }), 0, 'eve');
  assert.equal(C.dailyNew({ c: context({ today: '2026-10-03', exam: EXAM }), settings: { ...settings, newPerDay: 25 }, dueN: 10, priorityLeft: 100 }), 25);
  // 6 days left, 5 new-days (to exam−2): pace = ceil(100 / 5) = 20; minutes fit (30 − 10/3)/0.75 = 35
  assert.equal(C.dailyNew({ c: context({ today: '2026-10-03', exam: EXAM }), settings, dueN: 10, priorityLeft: 100 }), 20);
  assert.equal(C.dailyNew({ c: context({ today: '2026-10-03', exam: EXAM }), settings, dueN: 10, priorityLeft: 1000 }), 35, 'minutes win');
  assert.equal(C.dailyNew({ c: context({ today: '2026-10-03', exam: null }), settings: { ...settings, exam: { type: null } }, dueN: 0, priorityLeft: 1000 }), 20, 'no date: a steady trickle');
  // quota split 40 : 15
  const s = state('2026-10-03', {}, { newPerDay: 55 });
  assert.equal(C.quota(s, 'p'), 40); assert.equal(C.quota(s, 'g'), 15);
  s.day.newBy = { p: 38 };
  assert.equal(C.newLeft(s), 17);
});

test('a round in progress: reinsertion, ratings, dots, summary, override', () => {
  const today = '2026-10-04', c = context({ today, exam: EXAM });
  const a = data.pool.find(it => it.id.startsWith('BP:')), b = data.pool.filter(it => it.id.startsWith('BP:'))[1];
  const ids = [a.id, b.id, ...data.pool.filter(it => it.id.startsWith('BG:')).slice(0, 8).map(it => it.id)];
  const cards = { [b.id]: seen(5, today) };
  const day = C.newDay(today);
  const round = S.startRound(ids, { kind: 'today' }, today, 1000);
  assert.ok(S.resumable(round, today, 2000));
  assert.ok(!S.resumable(round, add(today, 1), 2000));
  // a new item answered right: a learning step, comes back +4
  let e = S.current(round, data.byId, cards);
  assert.equal(e.isNew, true); assert.equal(e.limit, null);
  let r = S.answer({ round, entry: e, o: { ok: true, ms: 4000 }, cards, day, c, now: 5000 });
  cards[a.id] = r.rec;
  assert.equal(r.g, 3); assert.equal(round.queue[5].id, a.id); assert.equal(round.queue[5].re, true);
  assert.equal(day.newBy.p, 1); assert.equal(day.newShown, 1);
  assert.equal(r.event.deck, 'b1'); assert.equal(r.event.base, null); assert.deepEqual(r.event.ctx, { exam: EXAM, phase: 'week', tz: 'UTC' });
  // a due item missed: a lapse, comes back
  S.advance(round);
  e = S.current(round, data.byId, cards);
  assert.equal(e.isNew, false); assert.ok(e.limit > 0);
  r = S.answer({ round, entry: e, o: { ok: false, ms: 9000 }, cards, day, c, now: 6000 });
  cards[b.id] = r.rec;
  assert.equal(r.g, 1); assert.equal(cards[b.id].lapses, 1);
  assert.equal(round.queue.filter(q => q.id === b.id).length, 2);
  assert.deepEqual(r.event.base, { u: 1, reps: 3 });
  assert.equal(day.firstTry[1], 1, 'honesty counts first tries of reviews');
  assert.deepEqual(S.dots(round).slice(0, 3), ['done', 'now', '']);
  S.advance(round);
  assert.deepEqual(S.dots(round).slice(0, 3), ['done', 'miss', 'now']);
  // Claude override: the miss becomes Hard, the reinsertion goes
  round.i = 1;
  const ov = S.override({ round, entry: e, ms: 9000, c, now: 7000 });
  assert.equal(ov.rec.lapses, 0); assert.equal(round.queue.filter(q => q.id === b.id).length, 1);
  assert.equal(round.results.at(-1).g, 2);
  const sum = S.summary(round, data.byId);
  assert.equal(sum.total, 2); assert.equal(sum.right, 2); assert.equal(sum.news.length, 1);
  // a "missed" round re-answering an item reviewed today only logs
  const mr = S.startRound([b.id], { kind: 'missed' }, today, 1000);
  const me = S.current(mr, data.byId, cards);
  const before = { ...cards[b.id] };
  const lr = S.answer({ round: mr, entry: me, o: { ok: true, ms: 3000 }, cards, day, c, now: 8000 });
  assert.equal(lr.rec.S, before.S); assert.ok(lr.rec.hist.at(-1)[4].includes('l'));
});

test('spoken answers: traps get at most Hard, unseen items only log', () => {
  const c = context({ today: '2026-10-04', exam: EXAM });
  const trap = data.pool.find(it => it.trap === 'verb-final' && it.kind === 'phrase') || data.pool.find(it => it.trap === 'verb-final');
  const r1 = S.spoken({ item: trap, rec: seen(5, '2026-10-04'), o: { ok: true, ms: 2000, limit: 10 }, c, now: 1 });
  assert.equal(r1.g, 2); assert.equal(r1.event.mode, 's');
  const r2 = S.spoken({ item: data.pool[5], rec: null, o: { ok: true, ms: 2000, limit: 10 }, c, now: 1 });
  assert.equal(r2.rec, null, 'speech never starts a schedule');
});

test('exam words: trim, triage, items, fetch', async () => {
  const wordmap = { termin: ['termin.noun', 'A2'], absagen: ['absagen.verb', 'B1'] };
  const rows = [
    { word: 'Termin', lemma: 'Termin', gloss: 'appointment', sentence: 'Ich habe morgen einen Termin beim Arzt.', pos: 'Nomen', gender: '(der)', plural: 'Termine', day: 2, module: 'lesen', exam_days: 3, zipf: 4.6 },
    { word: 'Termin', lemma: 'Termin', gloss: 'appointment', sentence: 'Später.', day: 5 },
    { word: 'abgesagt', lemma: 'absagen', gloss: 'cancel', sentence: 'Sie hat das Treffen abgesagt.', pos: 'Verb', day: 1, module: 'hoeren', exam_days: 1, zipf: 3.2 },
    { word: 'Nachbarschaft', lemma: 'Nachbarschaft', gloss: 'neighbourhood', sentence: 'Nachbarschaft ist wichtig.', pos: 'Nomen', gender: 'die', day: 3, exam_days: 1, zipf: 3.1 },
    { word: 'ohne', gloss: '', sentence: 'x' },
    { word: 'weg', gloss: 'away', sentence: 'x', deleted: true },
  ];
  const words = W.trimWords(rows, wordmap);
  assert.deepEqual(words.map(w => w.id), ['W:termin.noun', 'W:absagen.verb', 'BW:nachbarschaft']);
  assert.equal(words[0].sent, 'Ich habe morgen einen Termin beim Arzt.', 'earliest test wins');
  // triage: exam weeks keep frequent words only; otherwise the B1 list or 2+ tests
  assert.deepEqual(words.filter(w => W.inQueue(w, 'week')).map(w => w.lemma), ['Termin']);
  assert.deepEqual(words.filter(w => W.inQueue(w, 'after')).map(w => w.lemma), ['Termin', 'absagen']);
  const t = W.toItem(words[0]);
  assert.equal(t.prompt, 'Ich habe morgen einen ___ beim Arzt.'); assert.equal(t.gap, true);
  assert.equal(t.source, 'From Test 2 · Lesen'); assert.equal(t.card.head, 'der Termin, Termine');
  const n = W.toItem(words[2]);
  assert.equal(n.task, 'Type the noun with der, die or das.'); assert.deepEqual(n.accept, ['die Nachbarschaft']);
  assert.equal(gradeAnswer(t, 'Termin').ok, true);
  assert.equal(gradeAnswer(n, 'die Nachbarschaft').ok, true);
  assert.equal(gradeAnswer(n, 'der Nachbarschaft').ok, false);
  // fetch: no token, rate limit, 304, ok with added words, error keeps the cache
  const url = 'https://example.test/vocab.json';
  const resp = (status, body, etag = 'e1') => ({ status, ok: status >= 200 && status < 300, json: async () => body, headers: { get: () => etag } });
  assert.equal((await W.fetchWords({ token: null, cached: null, wordmap, url, fetch: async () => resp(200, []), now: 0 })).state, 'no-token');
  let calls = 0; let sent;
  const f = async (_u, o) => { calls++; sent = o.headers; return resp(200, { words: rows }); };
  const r1 = await W.fetchWords({ token: 'tok', cached: null, wordmap, url, fetch: f, now: 1000 });
  assert.equal(r1.state, 'ok'); assert.equal(r1.cache.words.length, 3); assert.equal(r1.cache.total, 5); assert.equal(sent.Authorization, 'Bearer tok');
  const r2 = await W.fetchWords({ token: 'tok', cached: r1.cache, wordmap, url, fetch: f, now: 2000 });
  assert.equal(r2.state, 'cached'); assert.equal(calls, 1, 'one request per 10 minutes');
  const r3 = await W.fetchWords({ token: 'tok', cached: r1.cache, wordmap, url, fetch: async (_u, o) => { assert.equal(o.headers['If-None-Match'], 'e1'); return resp(304, null); }, now: 1000 + W.REFRESH_MS + 1 });
  assert.equal(r3.state, 'ok'); assert.equal(r3.cache.words.length, 3);
  const more = [...rows, { word: 'Umzug', gloss: 'move', sentence: 'Der Umzug war anstrengend.', pos: 'Nomen', gender: 'der', day: 6, exam_days: 4, zipf: 4.1 }];
  const r4 = await W.fetchWords({ token: 'tok', cached: r1.cache, wordmap, url, fetch: async () => resp(200, more), now: 1000, force: true });
  assert.deepEqual(r4.added, ['BW:umzug']); assert.equal(r4.cache.addedTest, 6);
  const r5 = await W.fetchWords({ token: 'tok', cached: r1.cache, wordmap, url, fetch: async () => resp(401, null), now: 1000, force: true });
  assert.equal(r5.state, 'error'); assert.equal(r5.cache, r1.cache);
});

test('rollDay keeps 40 days and starts a fresh log', () => {
  const r = C.rollDay({ day: { ...C.newDay('2026-10-02'), rounds: 3 }, days: [] }, '2026-10-03');
  assert.equal(r.rolled, true); assert.equal(r.day.day, '2026-10-03'); assert.equal(r.days[0].rounds, 3);
  assert.equal(C.rollDay({ day: r.day, days: r.days }, '2026-10-03').rolled, false);
  void FS;
});
