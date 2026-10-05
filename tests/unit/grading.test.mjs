// Grading never says "right" to wrong German: typo tolerance stops at grammar, a phrase card checks the rest of its
// sentence, situations check the model's words in their places. Every German sentence here was checked by hand: the
// "right" ones are correct German, the "wrong" ones each have the one error named next to them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as M from '../../src/domain/match.js';
import FS from '../../src/domain/fsrs.js';
import Sp from '../../src/domain/speech.js';
import { context } from '../../src/core/clock.js';
import { buildPool, buildLexicon, mistakeItem } from '../../src/features/shared/pool.js';
import { gradeAnswer } from '../../src/features/shared/grade.js';
import * as S from '../../src/features/shared/session.js';
import { checkPrompt } from '../../src/services/claude.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const J = p => JSON.parse(readFileSync(path.join(ROOT, p), 'utf8'));
const content = { items: J('content/b1/items.json'), grammar: J('content/b1/grammar.json'), bank: J('content/b1/bank.json'), plan: J('content/b1/plan.json'), nouns: J('content/b1/nouns.json') };
const data = buildPool({ ...content, lexWords: J('content/igloo/words/de.json'), lexTexts: Object.values(J('content/igloo/chunks/german.json').chunks).map(c => c.ex).filter(Boolean) });
const B = { anywhere: false, slotMax: 10, endings: true, umlaut: true };
const ok = (typed, want, o = B) => M.check(typed, [want], o).ok;

test('typos: an inflectional ending is never a typo', () => {
  // adjective endings, determiners, nouns: one letter, but another form
  assert.equal(ok('die vieles Cafés', 'die vielen Cafés'), false, 'vieles ≠ vielen');
  assert.equal(ok('ein kleiner Haus', 'ein kleines Haus'), false, 'kleiner ≠ kleines');
  assert.equal(ok('mit jedem Kind', 'mit jeden Kind'), false);
  assert.equal(ok('den Kindern', 'den Kinder'), false, 'Kinder ≠ Kindern');
  // verb endings: -t / -st / -e / -en
  assert.equal(ok('du macht das', 'du machst das'), false, 'macht ≠ machst');
  assert.equal(ok('er arbeitest', 'er arbeitet'), false, 'arbeitest ≠ arbeitet');
  assert.equal(ok('ich arbeitet', 'ich arbeite'), false);
  assert.equal(ok('wir müsst', 'wir müssen'), false, 'müsst ≠ müssen');
  assert.equal(ok('was meint du', 'was meinst du'), false);
  // the same in Igloo Test mode (no B1 options)
  assert.equal(ok('die vieles Cafés', 'die vielen Cafés', {}), false);
  assert.equal(ok('du macht das', 'du machst das', {}), false);
  assert.equal(ok('Interessanten', 'Interessantes', {}), false, '2 edits for 8+ letters, but not in the ending');
});

test('typos: umlauts, vowel changes and real words are never typos', () => {
  // only umlauts differ: Mütter/Mutter, fährt/fahrt, gewöhnt/gewohnt (another word or form) are misses
  const lex = data.lexicon;
  assert.equal(ok('die Mutter', 'die Mütter', { ...B, lexicon: lex }), false, 'Mutter (singular) for Mütter');
  assert.equal(ok('die Mütter', 'die Mutter', B), false, 'an umlaut that is not there');
  assert.equal(ok('er fahrt', 'er fährt', { ...B, lexicon: lex }), false, 'fahrt for fährt');
  assert.equal(ok('ich habe mich daran gewohnt', 'ich habe mich daran gewöhnt', { ...B, lexicon: lex }), false);
  assert.equal(ok('mein Bruder ist alter', 'mein Bruder ist älter', { ...B, lexicon: lex }), false, 'alter for älter');
  // a dropped umlaut that makes no other word stays a slip (Hard), as before
  const u = M.check('wir mussen gehen', ['wir müssen gehen'], { ...B, lexicon: lex });
  assert.ok(u.ok); assert.deepEqual(u.umlautMiss.map(t => t.expected), ['müssen']);
  assert.ok(M.check('Koennten Sie das wiederholen', ['könnten sie das wiederholen'], B).ok, 'oe spelling');
  // vowel changes are forms: sieht/seht, spricht/sprecht, gibst/gebst, schrieb/schreib
  assert.equal(ok('er seht', 'er sieht'), false);
  assert.equal(ok('er sprecht', 'er spricht'), false);
  assert.equal(ok('du gebst', 'du gibst'), false);
  assert.equal(ok('er schreib', 'er schrieb'), false);
  // a typed real word is that word: Staat/Stadt, wider/wieder, fiel/viel; and the lexicon's forms
  assert.equal(ok('in die Staat', 'in die Stadt'), false);
  assert.equal(ok('schon wider', 'schon wieder'), false);
  assert.equal(ok('das kostet fiel', 'das kostet viel'), false);
  assert.equal(ok('sie arbeiten', 'sie arbeitern', { ...B, lexicon: new Set(['arbeiten']) }), false);
  // never: words from the item's known wrong answers
  assert.equal(M.check('Ich wohne in einer Wohnnung', ['ich wohne in einer wohnung'], { ...B, never: ['Wohnnung'] }).ok, false);
});

test('typos: real typos in a stem still pass', () => {
  const typo = (typed, want, o = B) => { const r = M.check(typed, [want], o); assert.ok(r.ok, `${typed} should pass as a typo of ${want}`); assert.ok(r.typos.length === 1, typed); };
  typo('Bahnhfo', 'Bahnhof');
  typo('Wohcenende', 'Wochenende');
  typo('Präsentaton', 'Präsentation');
  typo('Entschuldgung', 'Entschuldigung');
  typo('Vorausseztung', 'Voraussetzung');
  typo('interessatnes', 'interessantes');
  typo('Bahnhoff', 'Bahnhof', {});
  typo('widerholen', 'wiederholen', {});   // a spelling slip, not another word
  assert.ok(M.check('Cafes', ['Cafés'], B).ok && M.check('Cafes', ['Cafés'], B).exact === false, 'other accents are ignored');
});

test('restCheck: the rest of a phrase card\'s sentence', () => {
  const acc = ['vor allem', 'besonders', 'vor allen dingen', 'insbesondere'], base = 'Mir gefällt die Stadt, vor allem die vielen Cafés.';
  const rc = (typed) => { const r = M.check(typed, acc, { ...B, anywhere: true }); return M.restCheck(typed, base, acc, { ...B, matched: r.matched }); };
  // his answer: besonders is right, the rest is not
  let x = rc('Ich mag die Stadt, besonders die vieles Kaffes');
  assert.equal(x.status, 'differs');
  assert.equal(x.ref, 'Mir gefällt die Stadt, besonders die vielen Cafés.', 'the closest sentence uses his phrase');
  assert.deepEqual(x.marks.map(m => x.ref.slice(m.start, m.end)), ['Mir', 'gefällt', 'en', 'Cafés'], 'viel[en]: the ending is marked');
  assert.deepEqual(x.wrong.map(w => w.word), ['Ich', 'mag', 'vieles', 'Kaffes']);
  // right: the model, another phrase in it, a part of the sentence with the phrase, the phrase alone, typos and spellings
  for (const a of ['Mir gefällt die Stadt, vor allem die vielen Cafés.', 'Mir gefällt die Stadt, besonders die vielen Cafés', 'mir gefaellt die stadt insbesondere die vielen cafes',
    'vor allem die vielen Cafés', 'besonders', 'Mir gefällt die Stadt, vor allem die vielen Caffés.']) assert.equal(rc(a).status, 'ok', a);
  assert.equal(rc('besonders').frag, true);
  // wrong in the rest: case, ending, article, a missing word inside the part he typed
  for (const a of ['Mich gefällt die Stadt, vor allem die vielen Cafés.', 'Mir gefällt die Stadt, vor allem die viele Cafés.', 'Mir gefällt der Stadt, vor allem die vielen Cafés.',
    'Mir gefällt die Stadt, vor allem vielen Cafés.']) assert.equal(rc(a).status, 'differs', a);
  // a variant Claude confirmed counts
  assert.equal(M.restCheck('Ich mag die Stadt, besonders die vielen Cafés.', base, acc, { ...B, matched: 'besonders', variants: ['Ich mag die Stadt, besonders die vielen Cafés.'] }).status, 'ok');
  // slots take the model's words: garbage or a wrong form in a slot is not the rest of the sentence
  const sacc = ['ich schlage vor dass wir [x] kaufen', 'ich würde vorschlagen dass wir [x] kaufen', 'ich schlage vor wir kaufen', 'lass uns [x] kaufen'];
  const sbase = 'Ich schlage vor, dass wir das Geschenk zusammen kaufen.';
  const src = typed => M.restCheck(typed, sbase, sacc, { ...B, matched: M.check(typed, sacc, { ...B, anywhere: true }).matched });
  assert.equal(src('Ich würde vorschlagen, dass wir das Geschenk zusammen kaufen.').status, 'ok', 'another phrase, the model\'s slot words');
  assert.equal(src('Ich schlage vor, dass wir der Geschenk zusammen kaufen.').status, 'differs', 'der Geschenk');
  assert.equal(src('Ich schlage vor, dass wir blorf quazz kaufen.').status, 'differs', 'junk in the slot');
  // a phrase of another shape is not put into the model sentence: "früher bin ich" does not go with "gespielt"
  const facc = ['früher habe ich', 'früher', 'früher bin ich'], fbase = 'Früher habe ich jedes Wochenende Fußball gespielt.';
  assert.equal(M.restCheck('Früher bin ich jedes Wochenende Fußball gespielt.', fbase, facc, { ...B, matched: 'früher bin ich' }).status, 'differs');
  assert.equal(M.restCheck('Früher habe ich jedes Wochenende Fußball gespielt.', fbase, facc, { ...B, matched: 'früher habe ich' }).status, 'ok');
  // nothing to compare with
  assert.equal(M.restCheck('Gute Idee!', 'Gute Idee!', [], B).status, 'na');
});

test('formCheck: a situation\'s words against the model, in the same places', () => {
  const fc = (a, m) => M.formCheck(a, m, { lexicon: data.lexicon }).status;
  assert.equal(fc('Ich schlage vor, dass wir bei mich feiern.', 'Ich schlage vor, dass wir bei mir feiern.'), 'differs', 'mich/mir');
  assert.equal(fc('Ich hätte einen anderes Vorschlag.', 'Ich hätte einen anderen Vorschlag.'), 'differs', 'anderes/anderen');
  assert.equal(fc('Ich hatte einen anderen Vorschlag.', 'Ich hätte einen anderen Vorschlag.'), 'differs', 'hatte/hätte');
  assert.equal(fc('Zusammenfassend kann man sagen, das beide Seiten Vorteile haben.', 'Zusammenfassend kann man sagen, dass beide Seiten Vorteile haben.'), 'differs', 'das/dass');
  assert.equal(fc('Was meinst du, wohin sollen wir fahrt?', 'Was meinst du, wohin sollen wir fahren?'), 'differs', 'last word');
  assert.equal(fc('Ein Vorteil ist, dass man viel Geld spart.', 'Ein Vorteil ist, dass man viel Zeit spart.'), 'ok', 'another word is his choice');
  assert.equal(fc('Ich würde lieber zu Hause feiern.', 'Ich hätte einen anderen Vorschlag: Wir könnten bei mir feiern.'), 'ok', 'another wording');
  assert.equal(fc('Ein Nachteil ist alledrings, dass Haustiere viel Geld kosten.', 'Ein Nachteil ist allerdings, dass Haustiere viel Geld kosten.'), 'ok', 'a typo');
});

test('gradeAnswer: his card, and every kind of card', () => {
  const his = data.byId.get('BP:s2-glue-vor-allem');
  let g = gradeAnswer(his, 'Ich mag die Stadt, besonders die vieles Kaffes', null, data);
  assert.equal(g.ok, true, 'the phrase is right (scheduled on the phrase)');
  assert.equal(g.partial, true, 'but the rest is not');
  assert.equal(g.phrase, 'besonders');
  assert.equal(g.right, 'Mir gefällt die Stadt, besonders die vielen Cafés.');
  assert.equal(g.primary, false);
  g = gradeAnswer(his, 'Mir gefällt die Stadt, vor allem die vielen Cafés.', null, data);
  assert.ok(g.ok && !g.partial && g.primary);
  g = gradeAnswer(his, 'besonders', null, data);
  assert.ok(g.ok && !g.partial, 'the phrase alone is fine');
  g = gradeAnswer(his, 'Ich mag die Stadt, besonders die vielen Cafés.', null, { ...data, variants: new Map([[his.id, ['Ich mag die Stadt, besonders die vielen Cafés.']]]) });
  assert.ok(g.ok && !g.partial, 'a confirmed variant');
  // a situation: the model's words in their places, junk in a slot
  const reply = data.byId.get('BR:t1-reply-01'), other = reply.moves.find(m => m.key === 'other');
  assert.equal(gradeAnswer(reply, 'Ich hätte einen anderes Vorschlag: Wir könnten im Jugendzentrum feiern.', other, data).partial, true);
  assert.equal(gradeAnswer(reply, other.model, other, data).partial, false);
  const topic = data.byId.get('BT:t1-counter-03');
  assert.ok(topic.accept.some(p => p.includes('[x]')));
  const junk = gradeAnswer(topic, 'Wie wäre es, wenn wir blorf quazz machen?', null, data);
  assert.ok(!junk.ok || junk.partial, 'junk in a slot is never right');
  // a gap word typed alone is graded in its sentence: Ihre keeps its capital
  const ihre = data.byId.get('G:register-formal-email.08');
  assert.equal(gradeAnswer(ihre, 'ihre', null, data).ok, false);
  assert.equal(gradeAnswer(ihre, 'Ihre', null, data).ok, true);
  assert.equal(gradeAnswer(ihre, 'Vielen Dank für Ihre E-Mail.', null, data).ok, true);
  // reading: the accepted words, but not as written
  assert.equal(gradeAnswer(data.byId.get('BL:signal-allerdings'), 'Der Material', null, data).partial, true);
  assert.equal(gradeAnswer(data.byId.get('BL:signal-allerdings'), 'Das Material', null, data).partial, false);
  // a correction: the corrected word must be typed exactly, retyping the mistake is wrong
  const mk = mistakeItem({ id: 'F:t-1', v: 1, wrong: 'Ich wohne in einer kleinen Wohnnung.', right: 'Ich wohne in einer kleinen Wohnung.', rule: '', source: { attemptId: 't', test: 1, module: 'schreiben', label: null }, createdAt: '2026-10-01T10:00:00Z', deletedAt: null });
  assert.deepEqual(mk.strict, ['Wohnung']);
  assert.equal(gradeAnswer(mk, 'Ich wohne in einer kleinen Wohnnung.', null, data).ok, false);
  assert.equal(gradeAnswer(mk, 'Ich wohne in einer kleinen Wohnung.', null, data).ok, true);
  assert.equal(gradeAnswer(mk, 'Ich wohne in einer kleinen Wonhung.', null, data).ok, false, 'no typos on the corrected word');
  // the lexicon holds the content's forms
  const lex = buildLexicon({ items: [{ model: 'Die vielen Cafés.', accept: ['vor allem [x]'] }], nouns: { muetter: 'Mütter' } });
  assert.ok(lex.has('vielen') && lex.has('cafes') && lex.has('muetter') && lex.has('allem') && !lex.has('x'));
});

test('scheduling: a partial answer counts as Hard, flagged p, never as late', () => {
  assert.equal(FS.rate({ ok: true, ms: 3000, limit: 12, partial: true }), 2);
  assert.equal(FS.rate({ ok: true, ms: 3000, limit: 12 }), 3);
  const today = '2026-10-04', c = context({ today, exam: '2026-10-09' });
  const it = data.byId.get('BP:s2-glue-vor-allem');
  const round = S.startRound([it.id], { kind: 'today' }, today, Date.now());
  const entry = S.current(round, data.byId, {});
  const day = { pred: [0, 0], firstTry: [0, 0], newShown: 0, shown: [] };
  const res = S.answer({ round, entry, o: { ok: true, ms: 4000, partial: true }, cards: {}, day, c, now: Date.now() });
  assert.equal(res.g, 2);
  assert.ok(res.event.flags.includes('p'));
  const sum = S.summary(round, data.byId);
  assert.equal(sum.right, 1); assert.equal(sum.partial, 1); assert.equal(sum.late, 0);
  // spoken: Hard at most
  const sp = S.spoken({ item: it, rec: { S: 5, D: 5, reps: 3, last: '2026-10-01', due: today, stage: 1, learn: null, hist: [] }, o: { ok: true, ms: 2000, limit: 12, partial: true }, c, now: Date.now() });
  assert.equal(sp.g, 2); assert.equal(sp.event.flags, 'sp');
});

test('speech: the rest of the sentence counts only when the phone keeps ending mistakes', () => {
  const it = data.byId.get('BP:s2-glue-vor-allem');
  const kept = { asr: { verbFinal: true, fuerVor: true, articles: true, endings: true } };
  const fixes = { asr: { verbFinal: true, fuerVor: true, articles: false, endings: false } };
  let r = Sp.grade('Ich mag die Stadt, besonders die vieles Cafés', it, kept, { match: () => true, rest: 'differs' });
  assert.equal(r.rest, false); assert.equal(r.partial, true); assert.equal(r.ok, true);
  r = Sp.grade('Ich mag die Stadt, besonders die vieles Cafés', it, fixes, { match: () => true, rest: 'differs' });
  assert.equal(r.rest, 'off'); assert.equal(r.partial, false);
  r = Sp.grade('Mir gefällt die Stadt, vor allem die vielen Cafés', it, kept, { match: () => true, rest: 'ok' });
  assert.equal(r.rest, true); assert.equal(r.partial, false);
});

test('Claude check: judges the whole answer, "minor" is a spelling slip only', () => {
  const p = checkPrompt({ kind: 'phrase', task: null, prompt: 'I like the city, especially the many cafés.', hl: 'especially', model: 'Mir gefällt die Stadt, vor allem die vielen Cafés.', accept: ['vor allem'] }, 'Ich mag die Stadt, besonders die vieles Kaffes');
  assert.match(p, /including the words outside the graded part/);
  assert.match(p, /Any wrong ending, case, article, gender, verb form, plural or word order makes it "wrong"/);
});
