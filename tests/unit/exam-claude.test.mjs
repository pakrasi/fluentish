// The Claude service (src/services/claude.js): the grader prompt is generic, private notes fill a slot at run time,
// and the request has the shape the Messages API expects. No network: fetch is a mock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GRADER_TEMPLATE, graderSystem, graderMessage, ask, correctSchreiben, ClaudeError } from '../../src/services/claude.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ex = JSON.parse(readFileSync(path.join(ROOT, 'content/exams/goethe-b1/day01.json'), 'utf8'));

test('the grader prompt describes the exam, not a learner', () => {
  const src = readFileSync(path.join(ROOT, 'src/services/claude.js'), 'utf8');
  // built from parts so this test does not itself trip the privacy gate's grader-profile rule
  for (const term of [new RegExp('Produkt' + 'manager'), /New York/, new RegExp('bekannten ' + 'Schw', 'i'), /Fritz/, /englischer Muttersprachler/]) {
    assert.doesNotMatch(src, term);
    assert.doesNotMatch(GRADER_TEMPLATE, term);
  }
  assert.match(GRADER_TEMPLATE, /\{learner_profile\}/);
  assert.doesNotMatch(graderSystem(null), /\{learner_profile\}|Hinweise zum Lerner/);
  assert.match(graderSystem('Erstsprache: Spanisch.'), /Hinweise zum Lerner:\nErstsprache: Spanisch\./);
});

test('the user message carries all three tasks and texts', () => {
  const m = graderMessage(ex, { aufgabe1: 'Liebe Anna', aufgabe3: '  ' });
  assert.match(m, /<text nr="1">Liebe Anna<\/text>/);
  assert.match(m, /<text nr="2">\(nicht geschrieben\)<\/text>/);
  assert.match(m, /<text nr="3">\(nicht geschrieben\)<\/text>/);
  assert.match(m, /Leitpunkte:\n- /);
});

test('request shape, the score line, and errors', async () => {
  let seen = null;
  const ok = async (url, init) => { seen = { url, init, body: JSON.parse(init.body) }; return new Response(JSON.stringify({ model: 'm', stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: 'Gut gemacht.' }] }), { status: 200 }); };
  const r = await correctSchreiben({ key: 'k', ex, texts: { aufgabe1: 'x' }, learnerNotes: 'N', fetch: ok });
  assert.equal(r.body, '! Korrektur\nGut gemacht.');
  assert.equal(seen.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(seen.init.headers['x-api-key'], 'k');
  assert.equal(seen.init.headers['anthropic-dangerous-direct-browser-access'], 'true');
  assert.ok(seen.init.headers['anthropic-version']);
  assert.equal(seen.body.model, 'claude-opus-5-5');
  assert.equal(seen.body.fallbacks, 'default');
  assert.equal(seen.body.system[0].cache_control.type, 'ephemeral');
  assert.match(seen.body.system[0].text, /Hinweise zum Lerner:\nN/);

  const fail = (status, body) => async () => new Response(JSON.stringify(body), { status });
  await assert.rejects(ask({ key: 'k', system: 's', user: 'u', fetch: fail(401, { error: { message: 'invalid x-api-key' } }) }), e => e instanceof ClaudeError && e.code === 'key');
  await assert.rejects(ask({ key: 'k', system: 's', user: 'u', fetch: fail(529, {}) }), e => e.code === 'overloaded');
  await assert.rejects(ask({ key: 'k', system: 's', user: 'u', fetch: fail(200, { stop_reason: 'refusal', content: [] }) }), e => e.code === 'refusal');
  await assert.rejects(ask({ key: 'k', system: 's', user: 'u', fetch: async () => { throw new TypeError('Load failed'); } }), e => e.code === 'offline');
  await assert.rejects(ask({ key: '', system: 's', user: 'u' }), e => e.code === 'nokey');
});
