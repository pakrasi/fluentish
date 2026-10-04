// Grading for the Goethe B1 mock exams (src/domain/grade.js). Answers are synthetic; the tests themselves are the
// public content in content/exams. When the B1 exam app's server.py is on this machine, its answer_key is the
// reference for all 14 tests (skipped in CI).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  answerKey, grade, teilIds, answeredIn, itemInfo, wordCount, weakSkills, byTeil, passes, scoreLine, scoreNum,
  fbSplit, corrections, latestByTestModule, stampMs, normAnswer,
} from '../../src/domain/grade.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const exam = n => JSON.parse(readFileSync(path.join(ROOT, `content/exams/goethe-b1/day${String(n).padStart(2, '0')}.json`), 'utf8'));

test('answer key: 30 Lesen and 30 Hören items with the B1 exam app values', () => {
  const key = answerKey(exam(1));
  const ids = Object.keys(key);
  assert.equal(ids.filter(i => i.startsWith('L')).length, 30);
  assert.equal(ids.filter(i => i.startsWith('H')).length, 30);
  for (const [id, [v, teil]] of Object.entries(key)) {
    assert.equal(teil, id.slice(0, 2));
    const allowed = { L1: /^[rf]$/, L2: /^[abc]$/, L3: /^[A-J0]$/, L4: /^(ja|nein)$/, L5: /^[abc]$/, H1: /^[rfabc]$/, H2: /^[abc]$/, H3: /^[rf]$/, H4: /^(mod|a|b)$/ }[teil];
    assert.match(v, allowed, `${id} = ${v}`);
  }
  assert.equal(Object.values(key).filter(([v, t]) => t === 'L3' && v === '0').length, 1, 'exactly one Lesen Teil 3 situation has no ad');
});

test('grade: all correct, all blank, case and spaces, one wrong', () => {
  const key = answerKey(exam(2));
  const right = Object.fromEntries(Object.entries(key).map(([id, [v]]) => [id, v]));
  const full = grade(key, 'lesen', right);
  assert.equal(full.score, 30); assert.equal(full.max_score, 30);
  assert.deepEqual(Object.keys(full.by_teil), ['L1', 'L2', 'L3', 'L4', 'L5']);
  assert.equal(full.by_teil.L1.max, 6); assert.equal(full.by_teil.L3.max, 7);

  const blank = grade(key, 'hoeren', {});
  assert.equal(blank.score, 0); assert.equal(blank.max_score, 30);
  assert.ok(blank.results.every(r => r.given === null && r.is_correct === 0));

  // the ad letter is given upper case in the runner and stored lower case; the key is upper case
  const l3 = Object.keys(key).find(id => id.startsWith('L3') && key[id][0] !== '0');
  const messy = { ...right, [l3]: ` ${key[l3][0].toLowerCase()} ` };
  const firstL1 = Object.keys(key).find(id => id.startsWith('L1'));
  messy[firstL1] = key[firstL1][0] === 'r' ? 'f' : 'r';
  const g = grade(key, 'lesen', messy);
  assert.equal(g.score, 29);
  const row = g.results.find(r => r.item_id === l3);
  assert.equal(row.given, key[l3][0].toLowerCase()); assert.equal(row.is_correct, 1);
  assert.deepEqual(Object.keys(g.results[0]).sort(), ['correct', 'given', 'is_correct', 'item_id', 'skill', 'teil']);
});

test('teil ids, answered counts and printed item numbers', () => {
  const ex = exam(3);
  const L = teilIds(ex, 'lesen'), H = teilIds(ex, 'hoeren');
  assert.deepEqual(L.map(x => x.length), [6, 6, 7, 7, 4]);
  assert.deepEqual(H.map(x => x.length), [10, 5, 7, 8]);
  assert.equal(answeredIn(L[0], { [L[0][0]]: 'r', [L[0][1]]: '', [L[0][2]]: null }), 1);
  const info = itemInfo(ex);
  assert.equal(info[L[0][0]].nr, 1); assert.equal(info[L[2][0]].nr, 13); assert.equal(info[L[4][3]].nr, 30);
  assert.equal(info[H[0][1]].nr, 2); assert.equal(info[H[3][7]].nr, 30);
});

test('small helpers: words, skills, pass line, score lines, stamps', () => {
  assert.equal(wordCount('  Liebe  Anna,\nwie geht es dir? '), 6);
  assert.equal(wordCount(''), 0);
  const rs = [{ skill: 'detail', is_correct: 1 }, { skill: 'detail', is_correct: 0 }, { skill: 'global', is_correct: 0 }, { skill: 'matching', is_correct: 1 }];
  assert.deepEqual(weakSkills(rs).map(([k]) => k), ['global', 'detail']);
  assert.deepEqual(byTeil([{ teil: 'L1', is_correct: 1 }, { teil: 'L1', is_correct: 0 }]), { L1: [1, 2] });
  assert.equal(passes(18, 30), true); assert.equal(passes(17, 30), false); assert.equal(passes(null, 30), false);
  assert.equal(scoreLine('Intro\n! circa 62 / 100 · bestanden\n## Aufgabe 1'), 'circa 62 / 100 · bestanden');
  assert.equal(scoreNum('circa 62 / 100 · bestanden'), 62); assert.equal(scoreNum(null), null);
  assert.equal(stampMs('2026-09-30T20:00:00', true), Date.UTC(2026, 8, 30, 20));
  assert.equal(stampMs('2026-09-30T20:00:00-04:00'), Date.UTC(2026, 9, 1, 0));
  assert.equal(normAnswer(' D '), 'd'); assert.equal(normAnswer(''), null);
});

test('feedback belongs to its attempt: by id, legacy id, Mac alias, or by time when it has no id', () => {
  const a1 = { id: 'u1', legacy: { id: 1001 }, module: 'schreiben', submitted_at: '2026-09-27T20:00:00-04:00' };
  const a2 = { id: 'u2', alias: 17, module: 'schreiben', submitted_at: '2026-09-30T20:00:00-04:00' };
  const fb = [
    { id: 1, module: 'schreiben', attempt_id: 1001, body: 'old', created_at: '2026-09-28T09:00:00' },
    { id: 2, module: 'schreiben', attempt_id: 17, body: 'new', created_at: '2026-10-01T09:00:00' },
    { id: 3, module: 'schreiben', body: 'loose', created_at: '2026-10-02T09:00:00' },
    { id: 4, module: 'lesen', attempt_id: 'u2', body: 'other module', created_at: '2026-10-02T09:00:00' },
  ];
  const s2 = fbSplit(fb, 'schreiben', a2, [a1, a2]);
  assert.deepEqual(s2.cur.map(f => f.id), [3, 2]);
  const s1 = fbSplit(fb, 'schreiben', a1, [a1, a2]);
  assert.deepEqual(s1.cur.map(f => f.id), [1]);
  assert.deepEqual(s1.older.map(f => f.id), [3, 2]);
});

test('corrections become practice items: wrong, right and the rule line', () => {
  const body = [
    '! circa 55 / 100 · knapp unter 60',
    '## Aufgabe 1 · Einladung · circa 24 / 40',
    '~~weil ich habe keine Zeit~~ → ==weil ich keine Zeit habe==',
    '_Nach „weil“ steht das Verb am Ende (verb-final clause)._',
    '~~das Thema ist intressant~~ → ==das Thema ist interessant==',
    '- **Wortstellung:** …',
  ].join('\n');
  assert.deepEqual(corrections(body), [
    { wrong: 'weil ich habe keine Zeit', right: 'weil ich keine Zeit habe', rule: 'Nach „weil“ steht das Verb am Ende (verb-final clause).' },
    { wrong: 'das Thema ist intressant', right: 'das Thema ist interessant', rule: '' },
  ]);
});

test('latest attempt per test and module: the newer submission wins', () => {
  const m = latestByTestModule([
    { day: 1, module: 'lesen', score: 20, submitted_at: '2026-09-27T20:00:00-04:00' },
    { day: 1, module: 'lesen', score: 26, submitted_at: '2026-09-29T20:00:00-04:00' },
    { day: 2, module: 'lesen', score: 24, submitted_at: '2026-09-30T20:00:00-04:00' },
  ]);
  assert.equal(m.get('1:lesen').score, 26);
  assert.equal(m.size, 2);
});

const SERVER = path.join(os.homedir(), 'pakrasi-lab/b1-exam/server.py');
test('answer key matches the B1 exam app server.py for all 14 tests', { skip: !existsSync(SERVER) && 'server.py not on this machine' }, () => {
  const py = `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("srv", sys.argv[1]); srv = importlib.util.module_from_spec(spec); spec.loader.exec_module(srv)
out = {}
for n in range(1, 15):
    ex = json.load(open(sys.argv[2] % n, encoding="utf-8"))
    out[n] = {k: list(v) for k, v in srv.answer_key(ex).items()}
print(json.dumps(out))`;
  const ref = JSON.parse(execFileSync('python3', ['-c', py, SERVER, path.join(ROOT, 'content/exams/goethe-b1/day%02d.json')], { encoding: 'utf8' }));
  for (let n = 1; n <= 14; n++) assert.deepEqual(answerKey(exam(n)), ref[n], `test ${n}`);
});
