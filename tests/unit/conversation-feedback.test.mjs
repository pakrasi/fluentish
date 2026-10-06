// The end-of-conversation feedback validator (domain/conversation-feedback.js): what is shown and what may become a
// card. Example cases, then property tests over seeded random feedback for synthetic transcripts. Synthetic data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as F from '../../src/domain/conversation-feedback.js';
import { fold } from '../../src/domain/conversation.js';
import { planMistakes } from '../../src/data/mistakes.js';

const turns = /** @type {any[]} */ ([
  { i: 0, who: 'partner', text: 'Hallo! Warst du in letzter Zeit in einer Ausstellung?', at: 0 },
  { i: 1, who: 'learner', text: 'Ja! Am Samstag ich bin in eine Ausstellung gegangen.', at: 1, input: 'typed' },
  { i: 2, who: 'partner', text: 'Oh, am Samstag <r was="ich bin">bist du</r> in eine Ausstellung gegangen?', at: 2 },
  { i: 3, who: 'learner', text: 'Ein Künstler hat ein Roboter gebaut, der malt Bilder. Ich war sehr überrascht.', at: 3, input: 'typed' },
  { i: 4, who: 'partner', text: 'Und sind die Bilder gut?', at: 4 },
  { i: 5, who: 'learner', text: 'Meiner Meinung nach ist eine Kamera auch nur ein Werkzeug. Aber ich habe keinen Platz mehr an meine Wände.', at: 5, input: 'typed' },
]);

const m = (/** @type {any} */ o) => ({ rule: 'r', pattern: 'other', severity: 'grammar', ...o });

test('the schema: every object closed, the fields the validator reads', () => {
  const s = F.feedbackSchema();
  const objs = [];
  (function walk(x) { if (x && typeof x === 'object') { if (x.type === 'object') objs.push(x); Object.values(x).forEach(walk); } })(s);
  assert.ok(objs.length >= 4);
  for (const o of objs) { assert.equal(o.additionalProperties, false); assert.deepEqual(o.required, Object.keys(o.properties)); }
  assert.deepEqual(Object.keys(s.properties), ['summary', 'mistakes', 'better_phrases', 'used_well']);
});

test('a mistake is kept only when copied from his turn and corrected with a small edit', () => {
  const r = F.checkFeedback({ summary: ' Two  lines. ', mistakes: [
    m({ turn: 1, wrong: 'Am Samstag ich bin in eine Ausstellung gegangen.', right: 'Am Samstag bin ich in eine Ausstellung gegangen.', pattern: 'verb-second' }),
    m({ turn: 3, wrong: 'Ein Künstler hat ein Roboter gebaut, der malt Bilder.', right: 'Ein Künstler hat einen Roboter gebaut, der Bilder malt.', pattern: 'case' }),
    m({ turn: 2, wrong: 'bist du', right: 'bin ich' }),                                                   // the partner's turn
    m({ turn: 5, wrong: 'Ich habe keinen Platz an meine Wände.', right: 'x' }),                           // not what he wrote
    m({ turn: 5, wrong: 'an meine Wände', right: 'an meine Wände' }),                                      // no change
    m({ turn: 5, wrong: 'Aber ich habe keinen Platz mehr an meine Wände.', right: 'Leider hängen bei mir schon zu viele Bilder, deshalb kaufe ich keins.' }),   // a rewrite
  ] }, { turns });
  assert.equal(r.summary, 'Two lines.');
  assert.deepEqual(r.mistakes.map(x => x.turn), [1, 3]);
  assert.deepEqual(r.dropped.map(d => d.reason), ['turn', 'not verbatim', 'no change', 'rewrite']);
  assert.ok(r.mistakes.every(x => x.cardable && x.checked));
});

test('cards: style never, already in his mistakes never, one per pattern, at most 3; shown at most 5', () => {
  const items = [
    m({ turn: 1, wrong: 'Am Samstag ich bin', right: 'Am Samstag bin ich', pattern: 'verb-second' }),
    m({ turn: 3, wrong: 'ein Roboter gebaut', right: 'einen Roboter gebaut', pattern: 'case' }),
    m({ turn: 3, wrong: 'der malt Bilder', right: 'der Bilder malt', pattern: 'verb-final' }),
    m({ turn: 5, wrong: 'an meine Wände', right: 'an meinen Wänden', pattern: 'case' }),                    // second 'case'
    m({ turn: 5, wrong: 'Ich war sehr überrascht', right: 'Ich war total überrascht', severity: 'style' }),  // not in turn 5
    m({ turn: 3, wrong: 'Ich war sehr überrascht.', right: 'Das hat mich sehr überrascht.', severity: 'style' }),
    m({ turn: 5, wrong: 'Platz mehr an meine Wände', right: 'Platz mehr an meinen Wänden', pattern: 'word-choice' }),   // 6th valid: cap
  ];
  const r = F.checkFeedback({ mistakes: items }, { turns, live: [{ wrong: 'x', right: 'Am Samstag bin ich' }] });
  assert.equal(r.mistakes.length, F.MAX_SHOWN);
  const by = Object.fromEntries(r.mistakes.map(x => [x.wrong, x]));
  assert.equal(by['Am Samstag ich bin'].why, 'already', 'its right sentence is already one of his mistakes');
  assert.equal(by['an meine Wände'].why, 'pattern');
  assert.equal(by['Ich war sehr überrascht.'].why, 'style');
  assert.deepEqual(r.mistakes.filter(x => x.cardable).map(x => x.pattern), ['case', 'verb-final']);
  assert.ok(r.dropped.some(d => d.reason === 'cap'));
});

test('used well: copied from a typed turn; you could also say: a quote of his, ellipses allowed', () => {
  const r = F.checkFeedback({
    used_well: [{ turn: 5, text: 'Meiner Meinung nach ist eine Kamera auch nur ein Werkzeug.', why: 'Verb second.' }, { turn: 5, text: 'Ich finde Kameras toll.', why: 'x' }],
    better_phrases: [{ turn: 3, said: 'Ein Künstler hat … gebaut', better: 'Ein Künstler hat einen Roboter gebaut', why: 'y' }, { turn: 3, said: 'Er malt Bilder', better: 'x', why: 'z' }],
  }, { turns });
  assert.deepEqual(r.usedWell.map(u => u.turn), [5]);
  assert.deepEqual(r.better.map(b => b.said), ['Ein Künstler hat … gebaut']);
  assert.equal(r.dropped.length, 2);
  // a spoken turn is weak evidence: never "used well", never a ticked card
  const spoken = turns.map(t => (t.i === 5 ? { ...t, input: 'spoken' } : t));
  const s = F.checkFeedback({ used_well: [{ turn: 5, text: 'Meiner Meinung nach ist eine Kamera auch nur ein Werkzeug.', why: '' }],
    mistakes: [m({ turn: 5, wrong: 'an meine Wände', right: 'an meinen Wänden' })] }, { turns: spoken });
  assert.equal(s.usedWell.length, 0);
  assert.equal(s.mistakes[0].why, 'spoken');
  assert.equal(s.mistakes[0].checked, false);
});

test('a malformed reply gives an empty card, never an error', () => {
  for (const raw of [null, {}, { mistakes: 'x' }, { mistakes: [null, 3, { turn: 'a' }] }]) {
    const r = F.checkFeedback(raw, { turns });
    assert.deepEqual([r.mistakes.length, r.better.length, r.usedWell.length], [0, 0, 0]);
  }
});

test('Try again keeps the cards he already has: the attempt\'s list only ever grows, ids are F:C-<session>-n', () => {
  const attemptId = 'C-0192f0aa-7c3b-7d1e-9a00-000000000001';
  const first = F.cardItems([], [{ wrong: 'a b c', right: 'a c b', rule: 'r1' }, { wrong: 'd e', right: 'e d', rule: 'r2' }]);
  const one = planMistakes({}, { attemptId, module: 'conversation', label: 'Conversation', items: first }, '2026-10-05T10:00:00.000Z');
  assert.deepEqual(one.added, [`F:${attemptId}-1`, `F:${attemptId}-2`]);
  assert.equal(one.added[0].split('-').pop(), '1', 'planMistakes parses the number at the end of the id');
  // the feedback ran again (Try again) and he ticks a different mistake: the two he has stay, the new one is added
  const existing = Object.values(one.next).filter(x => !x.deletedAt).map(x => ({ wrong: x.wrong, right: x.right, rule: x.rule }));
  const second = F.cardItems(existing, [{ wrong: 'f g', right: 'g f', rule: 'r3' }, { wrong: 'a b c', right: 'a c b', rule: 'r1' }]);
  const two = planMistakes(one.next, { attemptId, module: 'conversation', label: 'Conversation', items: second }, '2026-10-05T10:05:00.000Z');
  assert.deepEqual(two.added, [`F:${attemptId}-3`]);
  assert.equal(Object.values(two.next).filter(x => x.deletedAt).length, 0, 'nothing tombstoned');
  // at most 3 in all
  assert.equal(F.cardItems(existing, [{ wrong: 'p', right: 'q', rule: '' }, { wrong: 'r', right: 's', rule: '' }]).length, 3);
  assert.equal(F.cardItems([{ wrong: 'a', right: 'b', rule: '' }, { wrong: 'c', right: 'd', rule: '' }, { wrong: 'e', right: 'f', rule: '' }, { wrong: 'g', right: 'h', rule: '' }], [{ wrong: 'p', right: 'q', rule: '' }]).length, 4,
    'more already there (an older client) are never dropped');
});

/* ---------- property tests ---------- */

/** A seeded PRNG (mulberry32). @param {number} a */
const rng = a => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const WORDS = 'ich du er wir bin bist ist sind habe hast hat gestern heute morgen in im an auf der die das den dem ein eine einen gehen gegangen Haus Stadt Arbeit gern nicht weil dass Kino Museum'.split(' ');

test('properties: over 400 random feedbacks, everything kept obeys the rules', () => {
  const R = rng(20261005);
  const pick = (/** @type {any[]} */ a) => a[Math.floor(R() * a.length)];
  for (let run = 0; run < 400; run++) {
    /** @type {any[]} */ const tt = [];
    const n = 2 + Math.floor(R() * 6);
    for (let i = 0; i < n * 2; i++) {
      const words = Array.from({ length: 3 + Math.floor(R() * 10) }, () => pick(WORDS));
      tt.push({ i, who: i % 2 ? 'learner' : 'partner', text: words.join(' ') + '.', at: i, input: i % 2 ? (R() < 0.2 ? 'spoken' : 'typed') : undefined });
    }
    const his = tt.filter(t => t.who === 'learner');
    const live = R() < 0.5 ? [{ wrong: pick(his).text, right: 'x' }] : [];
    const mk = () => {
      const t = R() < 0.85 ? pick(his) : pick(tt);
      const w = t.text.replace(/\.$/, '').split(' ');
      const a = Math.floor(R() * w.length), b = Math.min(w.length, a + 1 + Math.floor(R() * 5));
      let wrong = w.slice(a, b).join(' ');
      if (R() < 0.15) wrong = `${wrong} ${pick(WORDS)}`;                       // not verbatim, sometimes
      const r = wrong.split(' ');
      const edits = R() < 0.8 ? 1 + Math.floor(R() * 2) : 6 + Math.floor(R() * 6);
      for (let e = 0; e < edits; e++) r[Math.floor(R() * (r.length + 1))] = pick(WORDS);
      return { turn: R() < 0.95 ? t.i : 99, wrong, right: R() < 0.05 ? wrong : r.join(' '), rule: 'r',
        pattern: pick([...F.PATTERNS, 'nonsense']), severity: pick([...F.SEVERITIES, 'grammar', 'grammar']) };
    };
    const raw = { summary: 's', mistakes: Array.from({ length: Math.floor(R() * 9) }, mk),
      used_well: Array.from({ length: Math.floor(R() * 4) }, () => { const t = pick(tt); return { turn: t.i, text: R() < 0.7 ? t.text : 'nie gesagt', why: 'w' }; }) };
    const out = F.checkFeedback(raw, { turns: tt, live });
    const byI = new Map(tt.map(t => [t.i, t]));
    assert.ok(out.mistakes.length <= F.MAX_SHOWN);
    const cards = out.mistakes.filter(x => x.cardable);
    assert.ok(cards.length <= F.MAX_CARDS, 'at most 3 cards');
    assert.equal(new Set(cards.map(c => c.pattern)).size, cards.length, 'one card per pattern');
    for (const x of out.mistakes) {
      const t = byI.get(x.turn);
      assert.ok(t && t.who === 'learner', 'his turn');
      assert.ok(F.verbatim(x.wrong, t.text), 'copied from the turn');
      assert.notEqual(fold(x.wrong), fold(x.right), 'a change');
      assert.ok(F.smallEdit(x.wrong, x.right), 'a small edit');
      if (x.checked) assert.ok(x.cardable, 'only a cardable mistake is ticked');
      if (x.severity === 'style') assert.equal(x.cardable, false, 'style is never carded');
      if (t.input === 'spoken') assert.equal(x.checked, false, 'spoken turns start unticked');
      if (live.some(l => fold(l.wrong) === fold(x.wrong))) assert.equal(x.cardable, false, 'already among his mistakes');
    }
    for (const u of out.usedWell) { const t = byI.get(u.turn); assert.ok(t && t.who === 'learner' && t.input !== 'spoken' && F.verbatim(u.text, t.text)); }
    assert.equal(out.mistakes.length + out.dropped.filter(d => d.field === 'mistakes').length, raw.mistakes.length, 'every mistake is shown or logged as dropped');
  }
});
