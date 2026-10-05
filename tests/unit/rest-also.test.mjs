// Round 3 (journey #7): the rest of the sentence is never struck when the answer is an accepted sentence, words the
// model's slot holds are not borrowed where another verb governs them, and "Also correct" lines are written with the
// model's commas and capitals, or not shown.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { restCheck, alsoLines } from '../../src/domain/match.js';
import { buildPool } from '../../src/features/practice/pool.js';
import { gradeAnswer } from '../../src/features/practice/grade.js';

const J = (/** @type {string} */ p) => JSON.parse(readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8'));
const data = buildPool({ items: J('content/b1/items.json'), grammar: J('content/b1/grammar.json'), bank: J('content/b1/bank.json'), plan: J('content/b1/plan.json'),
  nouns: J('content/b1/nouns.json'), schreiben: J('content/b1/schreiben.json'), lexWords: J('content/igloo/words/de.json') });
const grade = (/** @type {string} */ id, /** @type {string} */ text) => gradeAnswer(data.byId.get(id), text, null, data);
const verdict = (/** @type {any} */ g) => (!g.ok ? 'wrong' : g.rest && g.rest.status === 'differs' ? 'partial' : 'right');

test('an answer that is another accepted sentence is right, with nothing struck', () => {
  const hope = ['ich hoffe dass es dir ([x]) gut geht', 'ich hoffe es geht dir ([x]) gut', 'hoffentlich geht es dir ([x]) gut'];
  for (const a of ['Ich hoffe, es geht dir gut.', 'Hoffentlich geht es dir gut.']) {
    const r = restCheck(a, 'Ich hoffe, dass es dir gut geht.', hope, { matched: hope[1] });
    assert.equal(r.status, 'ok', a);
    assert.deepEqual(r.wrong, []);
  }
  // the model's slot words moved into another accepted pattern whose verb is in the pattern (rainer meint ([x]) sind faul)
  assert.equal(verdict(grade('BS:a2-rainer-schreibt-dass', 'Rainer meint, Menschen mit einer Vier-Tage-Woche sind faul.')), 'right');
  assert.equal(verdict(grade('BP:s3-mir-hat-besonders-gefallen-dass', 'Mir hat besonders gefallen, dass du von deiner Erfahrung gesprochen hast.')), 'right');
});

test('particles in a slot, never intensifiers on their own, never outside a slot', () => {
  assert.equal(verdict(grade('BS:a2-stimme-teilweise-zu', 'Ich stimme Rainer nur teilweise zu.')), 'right');
  assert.equal(verdict(grade('BS:a1-umzug-gut-gelaufen', 'Der Umzug ist echt gut gelaufen.')), 'right');
  assert.notEqual(verdict(grade('BS:a1-kurs-macht-spass', 'Der Kurs macht mir sehr Spaß.')), 'right', '*sehr Spaß');
  assert.equal(verdict(grade('BS:a2-stimme-teilweise-zu', 'Ich nur stimme Rainer teilweise zu.')), 'wrong');
});

test('the model\'s slot words are not borrowed under another verb, and an empty slot keeps the model\'s meaning', () => {
  assert.notEqual(verdict(grade('BS:a3-tut-mir-leid-aber', 'Es tut mir sehr leid, aber ich kann nicht zum Gespräch teilnehmen.')), 'right');
  const buses = data.pool.find(x => String(x.prompt).startsWith('There are buses, admittedly'));
  assert.equal(verdict(gradeAnswer(buses, 'Es gibt zwar Busse aber sie sind zu spät', null, data)), 'partial', 'oft left out');
});

test('"Also correct" lines carry the model\'s commas, capitals and end mark', () => {
  const lines = alsoLines('Ich schlage vor, dass wir uns am Bahnhof treffen.', ['ich schlage vor dass wir uns ([x]) treffen', 'ich würde vorschlagen dass wir uns [x] treffen', 'ich schlage vor wir treffen uns ([x])']);
  assert.ok(lines);
  assert.deepEqual(lines.map(l => l.text), ['Ich schlage vor, dass wir uns am Bahnhof treffen.', 'Ich würde vorschlagen, dass wir uns am Bahnhof treffen.'],
    'the pattern without dass needs a comma the model does not have: not shown');
  // optional words the model does not have are left out (etwas | was are alternatives)
  const p = alsoLines('Darf ich einen Vorschlag machen?', ['darf ich einen vorschlag machen', 'darf ich (etwas) (was) vorschlagen']);
  assert.ok(p && !p.some(l => /etwas was/.test(l.text)));
  // a statement after a question model takes a full stop
  const q = alsoLines('Könnten Sie mir außerdem mitteilen, wie viel der Kurs kostet?', ['könnten sie mir außerdem mitteilen wie viel der kurs kostet', 'außerdem möchte ich wissen wie viel der kurs kostet'], new Map([['sie', 'Sie']]));
  assert.ok(q && q.some(l => l.text === 'Außerdem möchte ich wissen, wie viel der Kurs kostet.'), JSON.stringify(q));
});

test('every "Also correct" line in the content: a comma before each subordinate clause, no polite sie in lower case', () => {
  let n = 0;
  for (const it of data.pool) {
    if (!it.model || it.kind === 'reply' || it.gap) continue;
    const g = gradeAnswer(it, it.model, null, data);
    for (const line of g.alsoCorrect) {
      n++;
      for (const m of line.matchAll(/(\S+)\s+(dass|weil|obwohl|ob)\b/gu)) {
        if (/^(und|oder|als|auch|so|nur|selbst)$/i.test(m[1]) || m.index === 0) continue;
        assert.match(m[1], /[,;:]$/, `${it.id}: ${line}`);
      }
      assert.ok(!/\b(Ich|ich) (finde|glaube|denke|hoffe) (das|es|die|der) \S+ (ist|sind)\b/.test(line), `${it.id}: ${line}`);
    }
  }
  assert.ok(n > 500, `${n} lines`);
});
