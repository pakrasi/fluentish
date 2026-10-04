// Script mode: privacy and storage (script/store.js, data/transfer.js), Today's wiring (practice/plan.js with
// script/today.js), the meanings reply parser, and marks surviving a sentence split. Synthetic bicycle talk only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Store } from '../../src/data/store.js';
import { createMemoryAdapter } from '../../src/data/adapters/memory.js';
import { createBus } from '../../src/core/bus.js';
import { context } from '../../src/core/clock.js';
import { exportBundle } from '../../src/data/transfer.js';
import { pendingEvents } from '../../src/data/sync/github-b1exam.js';
import { planItems } from '../../src/features/practice/plan.js';
import { scriptNewShown } from '../../src/features/practice/script/today.js';
import * as St from '../../src/features/practice/script/store.js';
import * as P from '../../src/features/practice/script/parse.js';
import * as Lad from '../../src/features/practice/script/ladder.js';
import { applyEdit } from '../../src/features/practice/script/align.js';
import { parseMeanings, meaningsPrompt } from '../../src/features/practice/script/meanings.js';

const PID = '0192a3b4-c5d6-7e8f-9a0b-000000000002';
const de = fs.readFileSync(new URL('../fixtures/script-bicycle.md', import.meta.url), 'utf8');
const t = (k, v = {}) => `${k}${Object.keys(v).length ? ' ' + JSON.stringify(v) : ''}`;

async function fresh(today = '2026-10-20') {
  const store = await Store.open({ adapter: createMemoryAdapter(), profile: { id: PID, name: '', kind: 'local' }, device: { deviceId: 'dev1', seq: 0 }, clock: { today: () => today }, bus: createBus() });
  const p = P.parseScript(de, { id: P.counterIds('s') });
  const sent = p.sections[0].sentences[1];
  const k = P.tokenize(sent.de).find(x => x.t === 'Rahmen').k;
  const script = { id: 'bike01', v: 1, title: 'Bike', register: 'both', deliverOn: null, status: 'active', sections: p.sections, flagged: [], createdAt: 'x',
    marks: [{ id: 'm1', kind: 'word', sentenceId: sent.id, start: k, end: k, surface: 'Rahmen', lemma: 'Rahmen', head: 'der Rahmen', gloss: 'frame', glossFrom: 'list', cardId: 'SW:rahmen' }] };
  St.put(store, script);
  return { store, script };
}

test('privacy: scripts, the script deck and local reviews stay out of the export unless included, and never reach the sync', async () => {
  const { store, script } = await fresh();
  const ctx = { today: '2026-10-20', exam: null, phase: 'none' };
  const r = Lad.rate(null, 3, ctx).rec;
  St.saveReview(store, { id: Lad.srId(script.id, script.sections[0].id), rec: r, prev: null, deck: St.DECK, g: 3, mode: 's', ctx, scriptId: script.id });
  St.updateProgress(store, script.id, p => ({ ...p, runs: [{ day: '2026-10-20', ms: 60000 }] }));
  const ev = [...store.events.values()].find(e => e.type === 'card.reviewed');
  assert.equal(ev.payload.local, true, 'reviews of script cards are marked local');
  assert.deepEqual(ev.payload.post.origin, ['script:bike01']);
  assert.equal(pendingEvents(store).length, 0, 'the results sync never sends them');
  const out = exportBundle(store, { profile: { id: PID, name: '' } });
  const text = JSON.stringify(out);
  assert.ok(!('scripts' in out.kv) && !('scripts.progress' in out.kv) && !('script' in out.cards));
  assert.ok(!text.includes('Fahrrad'), 'no script text anywhere in the file');
  assert.ok(!out.events.some(e => e.payload?.local));
  const all = exportBundle(store, { profile: { id: PID, name: '' }, includeScripts: true });
  assert.ok('scripts' in all.kv && 'script' in all.cards && all.events.some(e => e.payload?.local));
});

test('delete: the text goes, a tombstone stays, words stay reviewable unless dropped', async () => {
  const { store, script } = await fresh();
  const ctx = { today: '2026-10-20', exam: null, phase: 'none' };
  St.saveReview(store, { id: 'SW:rahmen', rec: Lad.rate(null, 3, ctx).rec, prev: null, deck: St.DECK, g: 3, ctx, scriptId: script.id });
  St.saveReview(store, { id: Lad.srId(script.id, script.sections[0].id), rec: Lad.rate(null, 3, ctx).rec, prev: null, deck: St.DECK, g: 3, ctx, scriptId: script.id });
  St.purge(store, script.id, { at: 'T' });
  assert.equal(St.get(store, script.id), null);
  assert.deepEqual(St.all(store)[script.id], { id: 'bike01', deletedAt: 'T', rev: St.all(store)[script.id].rev });
  assert.ok(store.cards('script')['SW:rahmen'], 'the word card stays');
  assert.ok(!store.cards('script')[Lad.srId(script.id, script.sections[0].id)], 'section cards go');
  assert.equal(store.get(St.WORDS).SW_rahmen, undefined);
  assert.equal(store.get(St.WORDS)['SW:rahmen'].gloss, 'frame');
  const two = await fresh();
  St.saveReview(two.store, { id: 'SW:rahmen', rec: Lad.rate(null, 3, ctx).rec, prev: null, deck: St.DECK, g: 3, ctx, scriptId: 'bike01' });
  St.purge(two.store, 'bike01', { at: 'T', dropWords: true });
  assert.ok(!two.store.cards('script')['SW:rahmen'], 'dropped: the word only this script made');
});

test('cardOf: a list word he already had stays in deck b1', async () => {
  const { store } = await fresh();
  store.putCards('b1', [['W:der_Rahmen', { reps: 2, S: 5 }]]);
  assert.equal(St.cardOf(store)('W:der_Rahmen').deck, 'b1');
  assert.equal(St.cardOf(store)('SW:x'), null);
});

test('Today: a script row after the exam, none before; script new words count in the B1 budget', async () => {
  const { store, script } = await fresh();
  St.updateProgress(store, script.id, p => ({ ...p, sections: Object.fromEntries(script.sections.map(s => [s.id, { marked: 'x' }])), newBy: { '2026-10-20': 6 } }));
  const settings = { language: 'german', exam: { type: 'goethe-b1', date: '2026-10-09', modules: [] }, minutesPerDay: 60, newPerDay: null };
  const before = planItems({ store, c: context({ today: '2026-10-05', exam: '2026-10-09' }), settings, t, exam: null });
  assert.ok(!before.some(r => r.id.startsWith('script.')));
  const c = context({ today: '2026-10-20', exam: '2026-10-09' });
  const after = planItems({ store, c, settings, t, exam: null });
  const row = after.find(r => r.id === 'script.bike01');
  assert.ok(row && row.kind === 'speak' && row.minutes <= 15);
  assert.equal(scriptNewShown(store, '2026-10-20'), 6);
  // the B1 review round's new items: 6 fewer than without the script words
  const round = after.find(r => r.id === 'practice.round');
  const plain = planItems({ store: { ...store, get: (n, f) => (n === St.PROGRESS ? {} : store.get(n, f)), cards: d => store.cards(d) }, c, settings, t, exam: null }).find(r => r.id === 'practice.round');
  const fresh1 = Number(/"n":(\d+)/.exec(round.detail)?.[1] ?? /"fresh":(\d+)/.exec(round.detail)?.[1]);
  const fresh2 = Number(/"n":(\d+)/.exec(plain.detail)?.[1] ?? /"fresh":(\d+)/.exec(plain.detail)?.[1]);
  assert.equal(fresh2 - fresh1, 6, `${round.detail} vs ${plain.detail}`);
});

test('meanings: the prompt names no learner; the reply is validated', () => {
  const p = meaningsPrompt([{ surface: 'überträgt', lemma: 'übertragen', sentence: 'Die Kette überträgt die Kraft.' }]);
  assert.match(p, /JSON only/); assert.match(p, /überträgt/);
  const m = parseMeanings('Here: [{"n":1,"lemma":"die Gangschaltung","en":"gears"},{"n":2,"lemma":"<b>x</b>","en":"y"},{"n":9,"lemma":"a","en":"b"}]', 2);
  assert.deepEqual(m.get(1), { lemma: 'Gangschaltung', art: 'die', en: 'gears' });
  assert.ok(!m.has(2) && !m.has(9));
  assert.equal(parseMeanings('no json', 1).size, 0);
});

test('a split sentence keeps its marks', async () => {
  const { script } = await fresh();
  const long = script.sections[0].sentences[1];
  const parts = ['Das Herz jedes Fahrrads.', 'Es ist der Rahmen.'];
  const edits = script.sections.map(s => ({ id: s.id, title: s.title, de: s.sentences.map(x => (x.id === long.id ? parts.join(' ') : x.de)).join(' ') }));
  let n = 0;
  const r = applyEdit(script, edits, { id: () => `n${n++}`, at: 'T' });
  assert.equal(r.marksRemoved.length, 0);
  const m = r.script.marks[0];
  const s = r.script.sections[0].sentences.find(x => x.id === m.sentenceId);
  assert.equal(P.tokenize(s.de).find(x => x.k === m.start).t, 'Rahmen');
});
