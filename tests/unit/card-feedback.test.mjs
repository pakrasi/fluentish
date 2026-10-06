// Round 5, card bugs found on the phone: the feedback names his own errors, never echoes them as right, never strikes
// a word he got right, never shows a rule about an error he did not make; and a mistake card says what to do and gives
// what he needs to do it. The phrase cards are the real content; the mistake records are synthetic, shaped like the
// ones that broke (a case-only correction after a greeting, a fragment inside a weil-clause, a comma-only correction).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildPool, mistakeItem } from '../../src/features/shared/pool.js';
import { gradeAnswer, retypeOk } from '../../src/features/shared/grade.js';
import { answerNotes, ruleApplies } from '../../src/domain/notes.js';
import { mistakeKinds, mistakeFixes, fixMissed, mistakeContext } from '../../src/domain/mistake.js';
import { planMistakes, planBackfill, freeWriteMistakes } from '../../src/data/mistakes.js';
import * as Match from '../../src/domain/match.js';

const J = (/** @type {string} */ p) => JSON.parse(readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8'));
const data = buildPool({ items: J('content/b1/items.json'), grammar: J('content/b1/grammar.json'), bank: J('content/b1/bank.json'), plan: J('content/b1/plan.json'),
  nouns: J('content/b1/nouns.json'), schreiben: J('content/b1/schreiben.json'), lexWords: J('content/igloo/words/de.json') });
const grade = (/** @type {string} */ id, /** @type {string} */ text) => gradeAnswer(data.byId.get(id), text, null, data);
const codes = (/** @type {any} */ g) => g.notes.map((/** @type {any} */ n) => n.code);

test('screenshot 1: "is right" shows the phrase written right; only the wrong word of the rest is struck; his comma and capital are named', () => {
  const g = grade('BP:s2-folie4-ein-nachteil-allerdings', 'Ein Nachteil ist, allerdings, dass man mit ihrem Kollegen weniger kontakt hat');
  assert.ok(g.ok && g.partial);
  // before: "Ein Nachteil ist, allerdings, dass man … kontakt hat is right." (his commas and his small k)
  assert.equal(g.phrase, 'Ein Nachteil ist allerdings, dass man … Kontakt hat');
  // before: "mit ihrem Kollegen" all struck; mit Kollegen is right German (Kontakt mit, the content's sentences)
  assert.deepEqual(g.rest.wrong.map((/** @type {any} */ w) => w.word), ['ihrem']);
  assert.deepEqual(codes(g), ['comma-extra', 'item', 'cap-up']);
  assert.match(g.notes[1].text, /seinen Kollegen/);
  // the capital in the graded phrase is a slip (Hard), never silent and never right first time
  assert.deepEqual(g.capMiss.map((/** @type {any} */ c) => c.expected), ['Kontakt']);
  assert.equal(g.rule, null, 'the dass rule is not about his errors: his verb is at the end');
  // the content's other sentences are right, not Hard
  for (const s of ['Ein Nachteil ist allerdings, dass man mit Kollegen weniger Kontakt hat.', 'Ein Nachteil ist allerdings, dass man weniger Kontakt mit Kollegen hat.']) {
    const r = grade('BP:s2-folie4-ein-nachteil-allerdings', s);
    assert.ok(r.ok && !r.partial, s);
  }
});

test('screenshot 2: his accepted Danach is kept, the hints name his errors, erzählen is no collocation for Meinung', () => {
  const id = 'BP:s2-folie1-dann-am-ende';
  const g = grade(id, 'Danach, nenne ich die Vor- und Nachteile, und am ende erzäle ich meine Meinung');
  assert.ok(!g.ok);
  // before: Right: Dann nenne ich … with Danach struck
  assert.equal(g.target, 'Danach nenne ich die Vor- und Nachteile, und am Ende sage ich meine Meinung.');
  assert.ok(!Match.diffWords(g.input, g.target).wrong.some((/** @type {any} */ w) => w.word === 'Danach'));
  assert.deepEqual(codes(g), ['comma-extra', 'cap-up', 'unknown', 'item']);
  assert.deepEqual([g.notes[0].a, g.notes[0].b, g.notes[1].word, g.notes[2].word], ['Danach', 'nenne', 'Ende', 'erzäle']);
  assert.match(g.notes[3].text, /sagen/);
  // before: "After Am Ende, the verb comes next …" although his word order there was right
  assert.equal(g.rule, null);
  // the v2 rule shows when he does break it
  const v2 = grade(id, 'Dann nenne ich die Vor- und Nachteile, und am Ende ich sage meine Meinung');
  assert.match(String(v2.rule), /After Am Ende/);
  // Danach is right; erzählen is not (it was accepted before)
  assert.ok(grade(id, 'Danach nenne ich die Vor- und Nachteile, und am Ende sage ich meine Meinung.').ok);
  assert.ok(!grade(id, 'Dann nenne ich die Vor- und Nachteile, und am Ende erzähle ich meine Meinung.').ok);
});

/** @param {string} wrong @param {string} right @param {any} [extra] */
const record = (wrong, right, extra = {}) => ({ id: 'F:syn-1', v: 1, wrong, right, rule: 'r', source: { attemptId: 'syn', test: null, module: 'schreiben', label: 'L' }, createdAt: '2026-10-01T10:00:00Z', deletedAt: null, ...extra });
const TEXT = 'Liebe Anna,\n\nVielen Dank für deine Nachricht! Ich hoffe dass, es dir gut geht. Mein Urlaub war schön, weil das Wetter gut war und meine Hotel hat einen Pool. Trotz war das Essen Gut.\n\nViele Grüße\nTom';
const CORR = [
  { wrong: 'Vielen Dank für deine Nachricht!', right: 'vielen Dank für deine Nachricht!' },
  { wrong: 'Ich hoffe dass, es', right: 'Ich hoffe, dass es' },
  { wrong: 'meine Hotel hat einen Pool', right: 'mein Hotel einen Pool hat' },
  { wrong: 'Trotz war das Essen Gut.', right: 'Trotzdem war das Essen gut.' },
];

test('screenshot 3: a case-only correction after a greeting: the greeting is shown, typing his own sentence back is wrong', () => {
  const m = record(CORR[0].wrong, CORR[0].right, { context: mistakeContext(CORR[0].wrong, TEXT, CORR) });
  assert.deepEqual(m.context, { before: 'Liebe Anna,', after: '' });
  const it = mistakeItem(m);
  assert.equal(it.prompt, CORR[0].wrong, 'the prompt is his sentence');
  assert.deepEqual(it.kinds, ['case']);
  // before: "Vielen Dank …" typed back was graded right (the matcher ignores a first capital)
  const back = gradeAnswer(it, 'Vielen Dank für deine Nachricht!', null, data);
  assert.ok(!back.ok);
  assert.deepEqual(back.notes.map((/** @type {any} */ n) => [n.code, n.word]), [['cap-down', 'vielen']]);
  assert.ok(gradeAnswer(it, 'vielen Dank für deine Nachricht!', null, data).ok);
  assert.ok(!retypeOk(it, 'Vielen Dank für deine Nachricht!', it.model));
  assert.ok(retypeOk(it, 'vielen Dank für deine Nachricht', it.model));
});

test('screenshot 4: a fragment inside a weil-clause: the clause around it (his other mistakes corrected) and the kinds of change', () => {
  const ctx = mistakeContext(CORR[2].wrong, TEXT, CORR);
  assert.deepEqual(ctx, { before: 'Mein Urlaub war schön, weil das Wetter gut war und', after: '.' });
  const it = mistakeItem(record(CORR[2].wrong, CORR[2].right, { context: ctx }));
  assert.deepEqual(it.kinds, ['ending', 'order']);
  assert.equal(it.prompt, 'meine Hotel hat einen Pool');
});

test('mistake kinds, fixes and contexts', () => {
  assert.deepEqual(mistakeKinds('Ich hoffe dass, es', 'Ich hoffe, dass es'), ['comma']);
  assert.deepEqual(mistakeKinds('Trotz am Abend, alles war Gut.', 'Trotzdem war am Abend alles gut.'), ['word', 'comma', 'order', 'case']);
  assert.deepEqual(mistakeKinds('habe ich nach Berlin gefahren', 'bin ich nach Berlin gefahren'), ['verb']);
  assert.deepEqual(mistakeKinds('dir für meine Geburstagsfeier einladen', 'dich zu meiner Geburtstagsfeier einladen'), ['pronoun', 'preposition', 'ending', 'spelling']);
  assert.deepEqual(mistakeKinds('Meine Urlab', 'Mein Urlaub'), ['ending', 'spelling']);
  const f = mistakeFixes('Ich hoffe dass, es', 'Ich hoffe, dass es');
  assert.deepEqual(fixMissed('Ich hoffe dass, es', f).map(x => x.code), ['comma-missing', 'comma-extra']);
  assert.deepEqual(fixMissed('Ich hoffe, dass es', f), []);
  // a comma-only card: his own sentence typed back is wrong
  const it = mistakeItem(record('Ich hoffe dass, es dir gut geht.', 'Ich hoffe, dass es dir gut geht.'));
  assert.ok(!gradeAnswer(it, 'Ich hoffe dass, es dir gut geht.', null, data).ok);
  assert.ok(gradeAnswer(it, 'Ich hoffe, dass es dir gut geht.', null, data).ok);
  // a whole sentence: the sentence before it, corrected (its last 14 words)
  assert.deepEqual(mistakeContext(CORR[3].wrong, TEXT, CORR), { before: '… Urlaub war schön, weil das Wetter gut war und mein Hotel einen Pool hat.', after: '' });
  // a fragment that opens a sentence: the rest of it
  assert.deepEqual(mistakeContext(CORR[1].wrong, TEXT, CORR), { before: '', after: 'dir gut geht.' });
  assert.equal(mistakeContext('nicht im Text', TEXT, CORR), null);
});

test('records: context is an added field, written when there is one and backfilled once; ids and wrong/right never change', () => {
  const body = CORR.map(c => `~~${c.wrong}~~ → ==${c.right}==\n_r_`).join('\n\n');
  const o = freeWriteMistakes({ taskId: 'a1', at: 5, label: 'L', body, text: TEXT });
  const { next } = planMistakes({}, o, '2026-10-01T10:00:00Z');
  const recs = Object.values(next);
  assert.equal(recs.length, 4);
  assert.deepEqual(recs.map(r => r.id), ['F:W-a1-5-1', 'F:W-a1-5-2', 'F:W-a1-5-3', 'F:W-a1-5-4']);
  assert.ok(recs.every(r => r.context));
  // an older record without context: planBackfill adds it from the saved text, and nothing else
  const old = { 'F:W-a1-5-3': { ...next['F:W-a1-5-3'] } };
  delete old['F:W-a1-5-3'].context;
  const b = /** @type {any} */ (planBackfill(old, () => ({ body, texts: [TEXT] })));
  assert.deepEqual(b['F:W-a1-5-3'].context, next['F:W-a1-5-3'].context);
  const { context, ...rest } = b['F:W-a1-5-3'];
  assert.deepEqual(rest, old['F:W-a1-5-3']);
  assert.equal(planBackfill(b, () => ({ body, texts: [TEXT] })), null, 'once');
  assert.equal(planBackfill(old, () => null), null, 'no source, no write');
});

test('notes: only his errors; the item rule only when it is about one of them', () => {
  const r = answerNotes('Am Ende ich sage meine Meinung', 'Am Ende sage ich meine Meinung.');
  assert.ok(r.order);
  assert.ok(ruleApplies({ trap: 'v2', rule: 'x' }, r, { subjects: new Set(['ich']) }));
  assert.ok(!ruleApplies({ trap: 'v2', rule: 'x' }, answerNotes('Am Ende sage ich meine Meinungen', 'Am Ende sage ich meine Meinung.'), { subjects: new Set(['ich']) }));
  assert.deepEqual(answerNotes('Ich wohne in einer kleinen Wohnnung', 'Ich wohne in einer kleinen Wohnung.').notes, [{ code: 'spelling', word: 'Wohnnung', fix: 'Wohnung' }]);
  // no comma notes when he writes no commas at all
  assert.deepEqual(answerNotes('Ich hoffe dass es dir gut geht', 'Ich hoffe, dass es dir gut geht.').notes, []);
});

test('content: every item sentence is graded right with nothing flagged; a note is on a word no accepted answer has', () => {
  const items = J('content/b1/items.json');
  let n = 0;
  for (const it of items) {
    for (const s of it.sentences || []) {
      const g = grade(it.id, s);
      assert.ok(g.ok && !g.partial, `${it.id}: ${s}`);
      n++;
    }
    for (const w of Object.keys(it.notes || {})) {
      const okWords = new Set(Match.words([...it.accept, it.model, ...(it.sentences || [])].join(' ').replace(/\[[^\]]*\]/g, ' ')).map((/** @type {any} */ x) => x.n));
      assert.ok(!okWords.has(Match.words(w)[0].n), `${it.id}: note on an accepted word ${w}`);
    }
  }
  assert.ok(n >= 4);
});
