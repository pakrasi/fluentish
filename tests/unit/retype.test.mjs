// "Type it once" after a miss: the sentence shown is always a whole right sentence, and typing exactly that
// sentence always passes. Three real cases from Sprechen Teil 2 phrase cards, then every item in the content.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPool } from '../../src/features/shared/pool.js';
import { gradeAnswer, retypeOk } from '../../src/features/shared/grade.js';
import * as Match from '../../src/domain/match.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const J = p => JSON.parse(readFileSync(path.join(ROOT, p), 'utf8'));
const data = buildPool({ items: J('content/b1/items.json'), grammar: J('content/b1/grammar.json'), bank: J('content/b1/bank.json'), plan: J('content/b1/plan.json'),
  nouns: J('content/b1/nouns.json'), schreiben: J('content/b1/schreiben.json'), lexWords: J('content/igloo/words/de.json') });
const item = prompt => { const it = data.pool.find(x => String(x.prompt).startsWith(prompt)); assert.ok(it, prompt); return it; };
const plain = s => s.toLowerCase().replace(/[.,!?;:]/g, '');

test('A: the target is the whole model sentence, with its capitals and comma', () => {
  const it = item('One argument in favour is that you can learn from anywhere');
  for (const a of ['Ein vorteil ist, dass man nicht lernt', 'Ein Argument dafür ist dass man lernen kann', '-']) {
    const g = gradeAnswer(it, a, null, data);
    assert.equal(g.target, it.model, a);
    assert.ok(retypeOk(it, g.target, g.target));
    assert.ok(retypeOk(it, plain(g.target), g.target), 'case and commas do not count');
    assert.ok(!retypeOk(it, 'Ein argument dafür ist dass man lernen kann', g.target), 'a pattern with its optional word dropped is not the target');
  }
  const g = gradeAnswer(it, 'Ein vorteil ist, dass man nicht lernt', null, data);
  assert.equal(g.right, it.model, 'the wrong answer shows the sentence he types');
});

test('B: typing exactly the shown sentence passes', () => {
  const it = item('There are buses, admittedly, but they are often late');
  const g = gradeAnswer(it, 'Es gibt Busse aber die sind spät', null, data);
  assert.equal(g.target, 'Es gibt zwar Busse, aber sie kommen oft zu spät.');
  assert.equal(g.right, g.target);
  assert.ok(retypeOk(it, g.target, g.target));
  assert.ok(retypeOk(it, 'Es gibt zwar Busse aber sie kommen oft zu spät', g.target));
  assert.ok(!retypeOk(it, 'Es gibt zwar Busse aber sie sind zu spät', g.target));
  // a partial answer (studyCard on a new card): the target is still the model, never the assembled rest
  const p = gradeAnswer(it, 'Es gibt zwar Busse aber sie sind zu spät', null, data);
  assert.ok(p.partial);
  assert.equal(p.target, it.model);
});

test('C: the rest of the sentence has no doubled word and keeps the comma before dass', () => {
  const it = item("In my home country it's like this: people usually eat dinner very late");
  const g = gradeAnswer(it, 'In meinem Heimatland ist es so dass man normalaweise sehr spät isst', null, data);
  assert.ok(g.partial);
  assert.ok(!/spät spät/.test(g.rest.ref), g.rest.ref);
  assert.match(g.rest.ref, /so, dass/);
  assert.equal(g.target, it.model);
  assert.ok(retypeOk(it, it.model, g.target));
});

test('retypeOk: strict capitals count, a gap word alone counts as its sentence', () => {
  const it = { strict: ['Ihnen'], model: 'Ich danke Ihnen im Voraus.' };
  assert.ok(retypeOk(it, 'ich danke Ihnen im voraus', it.model));
  assert.ok(!retypeOk(it, 'Ich danke ihnen im Voraus.', it.model));
  assert.ok(retypeOk(it, 'Ich danke Ihnen im Vorause'.replace('Vorause', 'Voraus'), it.model));
  const gap = { gap: true, prompt: 'Viele Leute haben Angst ___ Zukunft. (die)', model: 'Viele Leute haben Angst vor der Zukunft.' };
  assert.ok(retypeOk(gap, 'vor der', gap.model));
  assert.ok(!retypeOk(gap, 'für die', gap.model));
});

test('every item: the retype target is a whole model sentence, and typing it back passes', () => {
  let n = 0;
  const bad = [];
  for (const it0 of data.pool) {
    const moves = it0.kind === 'reply' ? it0.moves || [] : [null];
    for (const mv of moves) {
      const it = mv ? { ...it0, model: mv.model, accept: mv.accept } : it0;
      const whole = [it.sentence, it.model].filter(s => s && !/…/.test(s));
      if (!whole.length) continue;
      const answers = ['-', ...(it.wrong || []), ...(it.accept || []).map(p => Match.renderPattern(p, it.model))];
      for (const a of answers) {
        const g = gradeAnswer(it0, a, mv, data);
        n++;
        const target = g.target;
        if (!(it.gap || it.literal ? target === it.model : whole.includes(target))) bad.push(`${it0.id}: ${a} → ${target}`);
        else if (/…|\[x\]/.test(target)) bad.push(`${it0.id}: open slot in ${target}`);
        else if (!retypeOk(it, target, target) || !retypeOk(it, (it.strict || []).length ? target.replace(/[.,!?;:]/g, '') : plain(target), target)) bad.push(`${it0.id}: retyping fails: ${target}`);
      }
    }
  }
  assert.deepEqual(bad.slice(0, 10), []);
  assert.ok(n > 3000, `${n} answers`);
});
