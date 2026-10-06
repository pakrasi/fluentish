// Typed production checks (round 5): domain/checks.js, data/checks.js and Quick sort's session
// (features/practice-clusters/session.js) with the real grader, the real word list and the real writers on a store
// that checks every record against its schema. Produce grading, the typo override, skip, undo, the Recheck list, the
// backup and restore of the new collection, and the preservation rule: an existing store is byte-identical after the
// upgrade, and after he acts only the additive records (kv known.checks, card.checked events, the mark he chose) differ.
// Synthetic ids and records only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as CK from '../../src/domain/checks.js';
import { recordCheck, undoChecks, checksOf } from '../../src/data/checks.js';
import { markWords, unmarkCards } from '../../src/data/known.js';
import { sortSession } from '../../src/features/practice-clusters/session.js';
import { gradeProduce, sortList } from '../../src/features/practice-clusters/pick.js';
import { itemFor, typable } from '../../src/features/shared/cluster-items.js';
import { gradeAnswer } from '../../src/features/shared/grade.js';
import { buildLexicon } from '../../src/features/shared/pool.js';
import { index } from '../../src/domain/clusters.js';
import { itemsOf, mergeCards } from '../../src/domain/cardmerge.js';
import { Store } from '../../src/data/store.js';
import { createMemoryAdapter } from '../../src/data/adapters/memory.js';
import { RECORD_SCHEMAS, recordChecker } from '../../src/data/records.js';
import * as B from '../../src/data/sync/backup.js';
import { planRestore } from '../../src/data/restore.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (/** @type {string} */ p) => JSON.parse(readFileSync(path.join(ROOT, p), 'utf8'));
const schemas = Object.fromEntries(RECORD_SCHEMAS.map(n => [n, read(`schemas/records/${n}.schema.json`)]));
const C = read('content/clusters/de.json');
const words = read('content/igloo/words/de.json');
const ix = index(C, words);
const nouns = read('content/b1/nouns.json');
const gdata = { nouns, lexicon: buildLexicon({ nouns, lexWords: words }) };
const t = (/** @type {string} */ k, /** @type {any} */ v) => `${k}${v ? JSON.stringify(v) : ''}`;
const TODAY = '2026-10-05';
const PID = '0192a3b4-c5d6-7e8f-9a0b-0000000000c5';

// a few real A1 words with no gap: two nouns (der / die) and a verb
const a1 = words.filter((/** @type {any} */ w) => w.level === 'A1' && typable(w) && ix.word(w.id));
const NOUN = a1.find((/** @type {any} */ w) => w.pos === 'noun' && w.art === 'der').id;
const NOUN2 = a1.find((/** @type {any} */ w) => w.pos === 'noun' && w.art === 'die').id;
const VERB = a1.find((/** @type {any} */ w) => w.pos === 'verb' && !/^sich /.test(w.w)).id;
const OTHER = a1.filter((/** @type {any} */ w) => ![NOUN, NOUN2, VERB].includes(w.id)).slice(0, 3).map((/** @type {any} */ w) => w.id);
const itemOf = (/** @type {string} */ id) => itemFor(`W:${id}`, ix, C, { t });
const modelOf = (/** @type {string} */ id) => itemOf(id).model;

/** A store on a memory adapter whose every record is checked against its schema (a mismatch throws). */
async function freshStore() {
  const adapter = createMemoryAdapter();
  const store = await Store.open({ adapter, profile: { id: PID, name: '', kind: 'local' }, device: { deviceId: 'dev1', seq: 0 }, clock: { today: () => TODAY } });
  store.check = recordChecker(schemas, m => { throw new Error(m); });
  const ctx = { store, clock: { ctx: () => ({ today: TODAY, exam: null, phase: 'none' }) } };
  return { adapter, store, ctx };
}

/** Quick sort's session over a store, with the writers the view uses. */
function session(ctx, list, mode, recheck = false) {
  return sortSession({ list, mode, recheck, deps: {
    mark: id => markWords(ctx, [id], { batch: list.length }),
    unmark: res => unmarkCards(ctx, res.entries),
    check: x => recordCheck(ctx, x),
    uncheck: tokens => undoChecks(ctx, tokens),
    grade: (id, typed) => gradeProduce(itemOf(id), typed, gdata, gradeAnswer),
  } });
}
const cardsJSON = (/** @type {any} */ store) => JSON.stringify(Object.fromEntries(['b1', 'clusters', 'speak', 'script', 'build'].map(d => [d, store.cards(d)])));
const checkEvents = (/** @type {any} */ store) => [...store.events.values()].filter(e => e.type === 'card.checked').map(e => e.payload);

/* ---------- the grader decides ---------- */

test('Produce grading is the real grader: the model is right, a wrong article, a wrong word and an English answer are not', () => {
  const it = itemOf(NOUN);
  assert.match(it.task, /noun/, 'a noun asks for its article');
  assert.equal(it.promptLang, 'en');
  assert.equal(gradeProduce(it, it.model, gdata, gradeAnswer).ok, true);
  const bare = it.model.replace(/^(der|die|das) /, '');
  for (const wrong of [`die ${bare}`, `das ${bare}`, bare, 'Haus', it.prompt]) {
    assert.equal(gradeProduce(it, wrong, gdata, gradeAnswer).ok, false, `"${wrong}" is not right for ${it.model}`);
  }
  const miss = gradeProduce(it, `die ${bare}`, gdata, gradeAnswer);
  assert.equal(miss.right, it.model, 'a miss shows the right answer');
  assert.equal(gradeProduce(itemOf(VERB), modelOf(VERB), gdata, gradeAnswer).ok, true);
});

/* ---------- the session ---------- */

test('Produce: right first time marks the word known and records the check; the card is the mark of data/known.js', async () => {
  const { store, ctx } = await freshStore();
  const S = session(ctx, [NOUN, VERB], 'produce');
  assert.equal(S.submit('   '), null, 'an empty answer checks nothing');
  const v = S.submit(modelOf(NOUN));
  assert.equal(v?.ok, true);
  const rec = store.cards('clusters')[`W:${NOUN}`];
  assert.equal(rec.known.by, 'self');
  assert.equal(rec.S, 60);
  assert.deepEqual(checksOf(store)[`W:${NOUN}`].prod, { on: TODAY, at: checksOf(store)[`W:${NOUN}`].prod.at, ok: true, from: 'sort' });
  assert.deepEqual(checkEvents(store).map(p => [p.itemId, p.mode, p.ok, p.from, !!p.learn]), [[`W:${NOUN}`, 'produce', true, 'sort', false]]);
  assert.equal(S.next(), true);
  assert.equal(S.id, VERB);
  assert.deepEqual(S.counts(), { know: 1, learn: 0, skip: 0, stay: 0, left: 1, typed: 1 });
});

test('Produce: a wrong answer goes to Learn and touches no card; "I knew it, typo" marks it known; undo takes both back', async () => {
  const { store, ctx } = await freshStore();
  const before = cardsJSON(store);
  const S = session(ctx, [NOUN, VERB], 'produce');
  const v = S.submit('die ' + modelOf(NOUN).replace(/^\S+ /, ''));
  assert.equal(v?.ok, false);
  assert.equal(v?.right, modelOf(NOUN));
  assert.equal(cardsJSON(store), before, 'a miss writes no card');
  const e = checksOf(store)[`W:${NOUN}`];
  assert.equal(e.learn.mode, 'produce');
  assert.equal(e.prod.ok, false);
  assert.deepEqual(S.counts().learn, 1);
  // the override
  assert.equal(S.typo(), true);
  assert.equal(store.cards('clusters')[`W:${NOUN}`].known.by, 'self');
  assert.equal(checksOf(store)[`W:${NOUN}`].prod.typo, true);
  assert.deepEqual(S.counts(), { know: 1, learn: 0, skip: 0, stay: 0, left: 1, typed: 1 });
  assert.equal(S.typo(), false, 'once');
  // undo: the mark and both check entries go back; the events say so
  const p = S.undo();
  assert.equal(p?.id, NOUN);
  assert.equal(S.id, NOUN);
  assert.equal(S.phase, 'answer');
  assert.equal(cardsJSON(store), before, 'the card is gone again (it had none)');
  assert.equal(checksOf(store)[`W:${NOUN}`], undefined, 'the entry is as it was (none)');
  assert.deepEqual(checkEvents(store).map(x => [x.ok, !!x.learn, !!x.typo, !!x.undo]), [[false, true, false, false], [true, false, true, false], [true, false, true, true], [false, true, false, true]]);
});

test('Skip writes nothing; Learn without typing records only the Learn pick; Recognise keeps today\'s Know and Learn', async () => {
  const { store, ctx } = await freshStore();
  const before = cardsJSON(store);
  const S = session(ctx, [NOUN, VERB, NOUN2], 'produce');
  assert.equal(S.skip(), true);
  assert.equal(cardsJSON(store), before);
  assert.deepEqual(checksOf(store), {});
  assert.equal(checkEvents(store).length, 0);
  assert.equal(S.learn(), 'learn');
  assert.equal(cardsJSON(store), before);
  assert.equal(checksOf(store)[`W:${VERB}`].learn.mode, 'produce');
  assert.equal(checksOf(store)[`W:${VERB}`].prod, undefined, 'no typed check');
  S.setMode('recognise');
  assert.equal(S.mode, 'recognise');
  assert.equal(S.know(), 'know');
  assert.equal(store.cards('clusters')[`W:${NOUN2}`].known.by, 'self');
  assert.equal(S.done, true);
  assert.deepEqual(S.counts(), { know: 1, learn: 1, skip: 1, stay: 0, left: 0, typed: 0 });
  // undo all three, newest first: back to the store as it was, entries removed
  S.undo(); S.undo(); S.undo();
  assert.equal(cardsJSON(store), before);
  assert.deepEqual(checksOf(store), {});
  assert.equal(S.i, 0);
});

test('Recheck: a wrong answer changes nothing but the check record; a right one marks it known and takes it off the list', async () => {
  const { store, ctx } = await freshStore();
  // an earlier Recognise sort: two words to Learn
  const S0 = session(ctx, [NOUN, VERB], 'recognise');
  S0.learn(); S0.learn();
  const score = () => ({ state: 'unseen', marked: null });
  assert.deepEqual(CK.recheckList(checksOf(store), score), [`W:${VERB}`, `W:${NOUN}`].sort((a, b) => (checksOf(store)[b].learn.at - checksOf(store)[a].learn.at) || (a < b ? -1 : 1)));
  const learn0 = structuredClone(checksOf(store));
  const before = cardsJSON(store);
  const R = session(ctx, [NOUN, VERB], 'recognise', true);
  assert.equal(R.mode, 'produce', 'a recheck is typed');
  assert.equal(R.setMode('recognise'), 'produce');
  assert.equal(R.submit('falsch')?.ok, false);
  assert.equal(cardsJSON(store), before, 'wrong: every card as it was');
  assert.deepEqual(checksOf(store)[`W:${NOUN}`].learn, learn0[`W:${NOUN}`].learn, 'the Learn pick is kept');
  assert.equal(checksOf(store)[`W:${NOUN}`].prod.ok, false);
  assert.equal(CK.recheckList(checksOf(store), score).includes(`W:${NOUN}`), true, 'still on the list');
  assert.deepEqual(R.counts().stay, 1);
  R.next();
  assert.equal(R.submit(modelOf(VERB))?.ok, true);
  assert.equal(store.cards('clusters')[`W:${VERB}`].known.by, 'self');
  assert.deepEqual(CK.recheckList(checksOf(store), score), [`W:${NOUN}`]);
  assert.ok(checkEvents(store).filter(p => p.from === 'recheck').every(p => !p.learn), 'a recheck never adds a Learn pick');
});

/* ---------- the domain rules ---------- */

test('recheckList: Learn picks only, not known or marked now, no passing typed check since', () => {
  const kv = {
    'W:a': { learn: { on: TODAY, at: 3, mode: 'recognise', from: 'sort' } },
    'W:b': { learn: { on: TODAY, at: 2, mode: 'produce', from: 'sort' }, prod: { on: TODAY, at: 2, ok: false, from: 'sort' } },
    'W:c': { learn: { on: TODAY, at: 1, mode: 'recognise', from: 'sort' }, prod: { on: TODAY, at: 5, ok: true, from: 'recheck' } },
    'W:d': { prod: { on: TODAY, at: 1, ok: true, from: 'know' } },
    'W:e': { learn: { on: TODAY, at: 4, mode: 'recognise', from: 'sort' } },
    'W:f': { learn: { on: TODAY, at: 5, mode: 'recognise', from: 'sort' } },
  };
  const score = (/** @type {string} */ id) => (id === 'W:e' ? { state: 'known' } : id === 'W:f' ? { state: 'unknown', marked: 'self' } : { state: 'unknown' });
  assert.deepEqual(CK.recheckList(kv, score), ['W:a', 'W:b']);
});

test('startMode: the remembered mode wins; else Produce while a word has no right typed answer', () => {
  assert.equal(CK.startMode('recognise', [false]), 'recognise');
  assert.equal(CK.startMode('produce', [true]), 'produce');
  assert.equal(CK.startMode(null, [true, false]), 'produce');
  assert.equal(CK.startMode('junk', [true, true]), 'recognise');
  assert.equal(CK.typedOk({ hist: [['2026-10-01', 3, 900, 't', '']] }), true);
  assert.equal(CK.typedOk({ hist: [['2026-10-01', 1, 900, 't', 'v'], ['2026-10-01', 3, 900, 's', '']] }), false, 'a study step and a said answer are no typed production');
  assert.equal(CK.produced({ 'W:x': { prod: { on: TODAY, at: 1, ok: true, from: 'sort' } } }, 'W:x', []), true);
});

test('joinChecks: per item and field the later record; a restore merges the collection by that rule', async () => {
  const a = { 'W:a': { learn: { on: TODAY, at: 1, mode: 'recognise', from: 'sort' } }, 'W:b': { prod: { on: TODAY, at: 9, ok: true, from: 'sort' } } };
  const b = { 'W:a': { prod: { on: TODAY, at: 2, ok: false, from: 'sort' } }, 'W:b': { prod: { on: TODAY, at: 3, ok: false, from: 'sort' } }, 'W:c': { learn: { on: TODAY, at: 4, mode: 'produce', from: 'sort' } } };
  const j = CK.joinChecks(a, b);
  assert.deepEqual(j, { 'W:a': { learn: a['W:a'].learn, prod: b['W:a'].prod }, 'W:b': a['W:b'], 'W:c': b['W:c'] });
  assert.deepEqual(CK.joinChecks(b, a), j, 'order-independent');
  const { store } = await freshStore();
  store.set(CK.KV, a);
  const plan = planRestore(store, { snapshots: [{ deviceId: 'dev2', cards: {}, kv: { [CK.KV]: b } }], events: [] });
  assert.deepEqual(plan.kv[CK.KV], j);
});

test('card.checked is backed up, carries no card, and a merge of the cards passes it by', async () => {
  const { store, ctx } = await freshStore();
  recordCheck(ctx, { itemId: `W:${NOUN}`, mode: 'produce', ok: false, from: 'sort', learn: true, typed: true });
  const e = [...store.events.values()].find(x => x.type === 'card.checked');
  assert.ok(B.backupable(e));
  assert.equal(B.SNAPSHOT_KV[CK.KV], 'checks');
  assert.deepEqual(itemsOf(e), []);
  const local = { clusters: { 'W:x': { S: 1, D: 5, due: TODAY, reps: 1, u: 1 } } };
  assert.deepEqual(mergeCards({ local, snapshots: [], events: [e] }).cards, local);
  assert.equal(e.lang, 'de', 'the deck names the language like any card event');
  assert.equal(B.snapshotOf(store).kv[CK.KV][`W:${NOUN}`].learn.mode, 'produce');
});

/* ---------- preservation ---------- */

test('preservation: the upgrade changes no byte of an existing store; acting adds only what he chose', async () => {
  const { adapter, store, ctx } = await freshStore();
  // a store from before round 5: learning and long-known cards, two marks waiting for their check, the known kv
  const learning = { S: 2.3, D: 5, reps: 1, lapses: 0, last: TODAY, first: TODAY, due: '2026-10-06', learn: 1, relearn: false, stage: 0, streak: 0, u: 1700000000001, hist: [['2026-10-05', 3, 4000, 't', '']] };
  const review = { S: 12.5, D: 4.4, reps: 4, lapses: 1, last: '2026-09-30', first: '2026-09-01', due: '2026-10-12', learn: null, relearn: false, stage: 2, streak: 2, u: 1700000000002, hist: [['2026-09-30', 3, 3000, 't', 'y']] };
  store.putCards('b1', [['BP:synthetic-phrase', review], [`W:${OTHER[0]}`, learning]]);
  store.putCards('clusters', [[`W:${OTHER[1]}`, review], [`CO:${OTHER[1]}~${OTHER[2]}`, learning]]);
  markWords(ctx, [OTHER[2], NOUN2], { batch: 2 });   // existing marks (Quick sort Know, earlier)
  store.set('known', { placement: '2026-10-01', placed: 0 });
  store.set('clusters', { day: { day: TODAY, rounds: 1, newShown: 3 } });
  await store.flush();
  const dump = async () => JSON.stringify({ cards: (await adapter.loadProfile(PID)).cards, kv: await adapter.loadScope(PID) });
  const snap = () => { const s = B.snapshotOf(store, { now: 0 }); return JSON.stringify({ cards: s.cards, kv: s.kv }); };
  const before = { db: await dump(), snap: snap(), cards: cardsJSON(store), events: store.events.size };

  // the upgrade: every new read path runs (the mode, the recheck list, the sort list); nothing is migrated
  const k = { get: () => ({ state: 'unseen', marked: null }) };
  const list = sortList([NOUN, VERB, ...OTHER], id => ix.word(id), id => k.get(id));
  CK.startMode(null, list.map(id => CK.produced(checksOf(store), `W:${id}`, [store.cards('clusters')[`W:${id}`]].filter(Boolean))));
  CK.recheckList(checksOf(store), id => k.get(id));
  await store.flush();
  assert.equal(await dump(), before.db, 'the database is byte-identical after the upgrade');
  assert.equal(snap(), before.snap, 'the backup snapshot is byte-identical');
  assert.equal(store.events.size, before.events, 'no event');

  // he acts: a wrong typed answer (Learn), a skip, and Learn in Recognise
  const S = session(ctx, [NOUN, VERB, OTHER[0]], 'produce');
  S.submit('ganz falsch'); S.next(); S.skip();
  S.setMode('recognise'); S.learn();
  await store.flush();
  const after = JSON.parse(await dump()), was = JSON.parse(before.db);
  assert.equal(JSON.stringify(after.cards), JSON.stringify(was.cards), 'no card record, id, stability or due date changed');
  const { [CK.KV]: added, ...kvRest } = after.kv;
  assert.equal(JSON.stringify(kvRest), JSON.stringify(was.kv), 'every other collection is as it was');
  assert.deepEqual(Object.keys(added).sort(), [`W:${NOUN}`, `W:${OTHER[0]}`].sort(), 'only the words he acted on');
  assert.equal(store.cards('b1')[`W:${OTHER[0]}`].due, learning.due, 'the Learn item stays scheduled as it was');
  assert.deepEqual([...store.events.values()].slice(before.events).map(e => e.type), ['card.checked', 'card.checked']);
  // the existing marks stay
  assert.equal(store.cards('clusters')[`W:${NOUN2}`].known.by, 'self');
  assert.equal(store.cards('clusters')[`W:${OTHER[2]}`]?.known?.by ?? store.cards('clusters')[`CO:${OTHER[1]}~${OTHER[2]}`]?.known?.by, 'self');

  // a right typed answer: exactly one card changes, the one he marked
  const S2 = session(ctx, [VERB], 'produce');
  const cards0 = JSON.parse(cardsJSON(store));
  assert.equal(S2.submit(modelOf(VERB))?.ok, true);
  const cards1 = JSON.parse(cardsJSON(store));
  const changed = Object.entries(cards1).flatMap(([d, recs]) => Object.keys(/** @type {any} */ (recs)).filter(id => JSON.stringify(/** @type {any} */ (recs)[id]) !== JSON.stringify(cards0[d]?.[id])).map(id => `${d}/${id}`));
  assert.deepEqual(changed, [`clusters/W:${VERB}`]);
});


/* ---------- "Check by typing" before "I know this" on a card said aloud ---------- */

test('Check by typing on a situation: the grader takes its model answer and its chunk anywhere; a sentence without the chunk is wrong', async () => {
  const { typedItem: situationItem } = await import('../../src/domain/sim.js');
  const bank = read('content/speak/situations.json');
  let n = 0;
  for (const sim of bank.items.slice(0, 40)) {
    const it = situationItem(sim);
    assert.ok(it.accept.length, sim.id);
    assert.equal(gradeAnswer(it, sim.answers[0].de, null, gdata).ok, true, `${sim.id}: its model answer is right`);
    const chunk = it.accept[0];
    assert.equal(gradeAnswer(it, `Ja, ${chunk}.`, null, gdata).ok || gradeAnswer(it, chunk, null, gdata).ok, true, `${sim.id}: the chunk is what counts`);
    assert.equal(gradeAnswer(it, 'Das weiß ich nicht.', null, gdata).ok, false, `${sim.id}: no chunk, not right`);
    n++;
  }
  assert.ok(n >= 20);
});

test('Check by typing records the typed check from "know" without touching a card; a wrong one marks nothing', async () => {
  const { store, ctx } = await freshStore();
  const before = cardsJSON(store);
  recordCheck(ctx, { itemId: `W:${NOUN}`, deck: 'clusters', mode: 'produce', ok: false, from: 'know', typed: true });
  assert.equal(cardsJSON(store), before);
  assert.deepEqual(checksOf(store)[`W:${NOUN}`], { prod: { on: TODAY, at: checksOf(store)[`W:${NOUN}`].prod.at, ok: false, from: 'know' } });
  assert.deepEqual(CK.recheckList(checksOf(store), () => ({ state: 'unseen' })), [], 'a check from a card is no Learn pick');
});
