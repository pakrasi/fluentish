// core/schema.js and the schemas in schemas/: the validator catches what it claims to, and the schemas only use
// keywords it supports.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate, unsupported } from '../../src/core/schema.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const J = p => JSON.parse(readFileSync(path.join(ROOT, p), 'utf8'));

test('validator: types, required, enum, patterns, counts, refs, combinators', () => {
  const s = {
    type: 'object', required: ['a'], additionalProperties: false,
    properties: {
      a: { type: 'integer', minimum: 1 }, b: { enum: ['x', 'y'] }, c: { type: 'string', pattern: '^z+$' },
      d: { type: 'array', minItems: 2, items: { $ref: '#/$defs/n' } }, e: { type: 'string', format: 'date' },
      f: { anyOf: [{ type: 'null' }, { type: 'string' }] }, g: { oneOf: [{ minimum: 0 }, { maximum: 10 }] },
    },
    $defs: { n: { type: 'number' } },
  };
  assert.deepEqual(validate(s, { a: 1, b: 'x', c: 'zz', d: [1, 2], e: '2026-10-09', f: null }), []);
  assert.match(validate(s, {})[0], /missing a/);
  assert.match(validate(s, { a: 0 })[0], /below 1/);
  assert.match(validate(s, { a: 1.5 })[0], /expected integer/);
  assert.match(validate(s, { a: 1, b: 'q' })[0], /one of/);
  assert.match(validate(s, { a: 1, c: 'zy' })[0], /does not match/);
  assert.match(validate(s, { a: 1, d: [1] })[0], /at least 2/);
  assert.match(validate(s, { a: 1, d: [1, 'x'] })[0], /\/d\/1: expected number/);
  assert.match(validate(s, { a: 1, e: '2026-13-01' })[0], /date/);
  assert.match(validate(s, { a: 1, f: 3 })[0], /anyOf/);
  assert.match(validate(s, { a: 1, g: 5 })[0], /2 of oneOf/);
  assert.match(validate(s, { a: 1, z: 1 })[0], /unexpected property z/);
  assert.deepEqual(unsupported({ type: 'object', properties: { a: { exclusiveMinimum: 1 } } }), ['/properties/a/exclusiveMinimum']);
});

test('every schema uses supported keywords only', () => {
  for (const dir of ['schemas/content', 'schemas/records']) {
    for (const f of readdirSync(path.join(ROOT, dir))) assert.deepEqual(unsupported(J(`${dir}/${f}`)), [], `${dir}/${f}`);
  }
});

test('the exam schema rejects a broken mock test', () => {
  const s = J('schemas/content/goethe-b1-exam.schema.json');
  const ok = J('content/exams/goethe-b1/day01.json');
  assert.deepEqual(validate(s, ok), []);
  const bad = structuredClone(ok);
  bad.lesen.teil1.items.pop();
  bad.hoeren.teil2.items[0].answer = 3;
  bad.schreiben.aufgabe1.minutes = 30;
  const errs = validate(s, bad);
  assert.ok(errs.some(e => e.startsWith('/lesen/teil1/items: needs at least 6')), errs.join('\n'));
  assert.ok(errs.some(e => e.startsWith('/hoeren/teil2/items/0/answer')), errs.join('\n'));
  assert.ok(errs.some(e => e.startsWith('/schreiben/aufgabe1/minutes')), errs.join('\n'));
});

test('grammar concepts carry no per-learner fields', () => {
  const s = J('schemas/content/igloo-grammar-concepts.schema.json');
  const errs = validate(s, [{ id: 'x', name: 'X', category: 'c', level: 'A1', fritz: { evidence: 4 } }]);
  assert.match(errs[0], /unexpected property fritz/);
});

test('record schemas accept well-formed records', () => {
  const id = '0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a6b';
  assert.deepEqual(validate(J('schemas/records/profile.schema.json'), { id, name: 'Sam', kind: 'local', createdAt: '2026-10-03T10:00:00+02:00', remoteId: null }), []);
  assert.deepEqual(validate(J('schemas/records/settings.schema.json'), {
    v: 1, language: 'german', level: 'B1', exam: { type: 'goethe-b1', date: '2026-10-09', modules: ['lesen'] }, minutesPerDay: 60,
    newPerDay: null, practice: { readAloud: false }, onboarded: null, rev: { 'exam.date': '1790000000000-0001-dev1' },
  }), []);
  const ev = J('schemas/records/event.schema.json');
  const base = { id, v: 1, profileId: id, deviceId: 'd1', seq: 1, at: '2026-10-03T10:00:00-04:00', day: '2026-10-03' };
  assert.deepEqual(validate(ev, { ...base, type: 'settings.changed', payload: { key: 'exam.date', value: null } }), []);
  assert.ok(validate(ev, { ...base, type: 'card.reviewed', payload: { deck: 'b1', itemId: 'x', g: 3 } }).length > 0, 'card.reviewed needs ctx, base, post');
  assert.deepEqual(validate(ev, { ...base, type: 'card.reviewed', payload: { deck: 'b1', itemId: 'x', g: 3, ctx: { exam: null, phase: 'none', tz: 'UTC' }, base: null, post: {} } }), []);
  // "I know this" (domain/known.js): one event per deck and action
  const mark = { deck: 'clusters', by: 'self', items: [{ itemId: 'W:x', base: null, post: { S: 60, D: 3.932, due: '2026-12-02', reps: 1, known: { by: 'self', on: '2026-10-03', prev: null } } }], ctx: { exam: null, phase: 'none', tz: 'UTC' } };
  assert.deepEqual(validate(ev, { ...base, type: 'card.marked_known', payload: mark }), []);
  assert.deepEqual(validate(ev, { ...base, type: 'card.unmarked_known', payload: { ...mark, items: [{ itemId: 'W:x', base: { u: 1, reps: 1 }, post: null }] } }), []);
  assert.ok(validate(ev, { ...base, type: 'card.marked_known', payload: { deck: 'b1', by: 'self', items: [] } }).length > 0, 'a mark needs its items and ctx');
  assert.deepEqual(validate(J('schemas/records/card-fsrs.schema.json'), mark.items[0].post), []);
});
