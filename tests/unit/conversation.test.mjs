// Conversation practice (round 4, L4): the pure rules in domain/conversation.js. Synthetic data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../../src/domain/conversation.js';
import { config } from '../../src/core/config.js';
import { add } from '../../src/domain/days.js';

const SONNET = config.anthropic.prices['claude-sonnet-5-5'];

test('partner level: one above his, C1 at most; Slower brings it to his own', () => {
  assert.equal(C.partnerLevel('A2'), 'B1');
  assert.equal(C.partnerLevel('B1'), 'B2');
  assert.equal(C.partnerLevel('B2'), 'C1');
  assert.equal(C.partnerLevel('C1'), 'C1');
  assert.equal(C.partnerLevel('B1', true), 'B1');
  assert.equal(C.partnerLevel(null), 'B2', 'no level: B1 assumed');
  assert.equal(C.partnerLevel('C2', true), 'C1');
});

test('topics: interests first, at or under the partner level, recent ones left out, stable within a day', () => {
  const topics = [
    { id: 'a', de: 'Kunst', en: 'Art', lv: 'B1', tags: ['art'] },
    { id: 'b', de: 'Roboter', en: 'Robots', lv: 'B2', tags: ['robots', 'technology'] },
    { id: 'c', de: 'Kochen', en: 'Cooking', lv: 'A2', tags: ['food'] },
    { id: 'd', de: 'Weltraum', en: 'Space', lv: 'C1', tags: ['space'] },
    { id: 'e', de: 'Sport', en: 'Sport', lv: 'A2', tags: ['sport'] },
  ];
  const r = C.rankTopics(topics, { interests: ['Robotics', 'space'], level: 'B1', day: '2026-10-05' });
  assert.equal(r[0].id, 'b', 'robotics matches robots');
  assert.ok(!r.some(t => t.id === 'd'), 'C1 is above a B1 learner\'s partner level (B2)');
  assert.equal(r.length, 3);
  assert.deepEqual(C.rankTopics(topics, { interests: ['Robotics'], level: 'B1', day: '2026-10-05' }).map(t => t.id), r.map(t => t.id));
  const later = C.rankTopics(topics, { interests: ['robots'], level: 'B1', recent: ['b'], day: '2026-10-05' });
  assert.ok(!later.some(t => t.id === 'b'), 'talked about in the last 14 days');
  // everything recent: the list still fills
  assert.equal(C.rankTopics(topics, { level: 'B1', recent: ['a', 'b', 'c', 'e'], day: 'x' }).length, 3);
  const sessions = [{ topic: { kind: 'topic', ref: 'a' }, day: '2026-09-30' }, { topic: { kind: 'topic', ref: 'c' }, day: '2026-09-01' }, { topic: { kind: 'own', ref: null }, day: '2026-10-01' }];
  assert.deepEqual(C.recentTopics(sessions, '2026-10-05', add), ['a']);
});

test('turn request: streamed body with two system blocks, the breakpoint on the session block, effort low', () => {
  const messages = [{ role: 'user', content: C.START }];
  const b = C.turnRequest({ model: 'claude-sonnet-5-5', base: 'BASE', session: 'SESSION', messages });
  assert.equal(b.model, 'claude-sonnet-5-5');
  assert.equal(b.max_tokens, C.LIMITS.maxTokens);
  assert.deepEqual(b.output_config, { effort: 'low' });
  assert.deepEqual(b.system, [{ type: 'text', text: 'BASE' }, { type: 'text', text: 'SESSION', cache_control: { type: 'ephemeral' } }]);
  assert.deepEqual(b.cache_control, { type: 'ephemeral' });
  assert.ok(!('thinking' in b), 'adaptive thinking is the default; never disabled (a 400 on Sonnet 5.5)');
  assert.ok(!('fallbacks' in b), 'no server fallback on turns: the fallback model rejects mid-conversation system messages');
  assert.ok(!JSON.stringify(b.system).match(/\d{4}-\d\d-\d\d|Date|uuid/i), 'nothing that changes per request in the cached prefix');
});

test('history is append-only: every commit keeps the earlier messages byte for byte', () => {
  /** @type {any} */ let tr = { id: 's1', title: 'T', messages: [], turns: [] };
  const think = { type: 'thinking', thinking: '', signature: 'sig-1' };
  const snapshots = [];
  tr = C.commit(tr, { user: null, content: [think, { type: 'text', text: 'Hallo! Worüber reden wir?' }], reply: 'Hallo! Worüber reden wir?', at: 1000 });
  snapshots.push(structuredClone(tr.messages));
  tr = C.commit(tr, { user: 'Über Kunst.', systems: ['From now on speak at B1.'], content: [{ type: 'text', text: 'Gern!' }], reply: 'Gern!', at: 2000 });
  snapshots.push(structuredClone(tr.messages));
  tr = C.commit(tr, { user: 'Ich mag Museen.', content: [{ type: 'text', text: 'Welche?' }], reply: 'Welche?', at: 3000 });
  for (const s of snapshots) assert.ok(C.isPrefix(s, tr.messages), 'an earlier history is a prefix of the later one');
  assert.deepEqual(tr.messages[0], { role: 'user', content: C.START });
  assert.deepEqual(tr.messages[1].content[0], think, 'thinking blocks are kept unchanged, signature and all');
  assert.deepEqual(tr.messages.map((/** @type {any} */ m) => m.role), ['user', 'assistant', 'user', 'system', 'assistant', 'user', 'assistant'],
    'a system message follows his message and comes before the reply');
  assert.deepEqual(tr.turns.map((/** @type {any} */ t) => t.who), ['partner', 'learner', 'partner', 'learner', 'partner']);
  assert.deepEqual(C.nextMessages(tr, 'Und du?', ['X']).slice(-2), [{ role: 'user', content: 'Und du?' }, { role: 'system', content: 'X' }]);
  // a failed reply commits nothing: nextMessages builds a request and never changes the transcript
  const before = JSON.stringify(tr);
  C.nextMessages(tr, 'noch was');
  assert.equal(JSON.stringify(tr), before);
  assert.ok(!C.isPrefix([{ role: 'user', content: 'edited' }], tr.messages));
});

test('his input: spaces folded, capped at 600 characters', () => {
  assert.equal(C.cleanInput('  Ich   bin\n da '), 'Ich bin da');
  assert.equal(C.cleanInput('x'.repeat(900)).length, C.LIMITS.inputChars);
});

test('recasts: one well-formed tag whose "was" he wrote is kept; anything else is shown plain', () => {
  const his = 'Ja! Am Samstag ich bin in eine Ausstellung gegangen.';
  const r = C.parseReply('Oh, am Samstag <r was="ich bin">bist du</r> in eine Ausstellung gegangen? Was hast du gesehen?', his);
  assert.deepEqual(r.recast, { to: 'bist du', was: 'ich bin' });
  assert.equal(r.plain, 'Oh, am Samstag bist du in eine Ausstellung gegangen? Was hast du gesehen?');
  assert.deepEqual(r.parts.map(p => !!p.recast), [false, true, false]);
  assert.equal(r.parts.map(p => p.text).join(' ').replace(/\s+/g, ' '), r.plain.replace(/\s+/g, ' '));
  // "was" he never wrote: no claim about what he wrote
  assert.equal(C.parseReply('Am Samstag <r was="ich war">bist du</r> dort gewesen?', his).recast, null);
  assert.equal(C.parseReply('Am Samstag <r was="ich war">bist du</r> dort gewesen?', his).plain, 'Am Samstag bist du dort gewesen?');
  // two tags, a broken tag, an unclosed tag, a correction equal to what he wrote
  for (const bad of ['<r was="ich bin">bist du</r> und <r was="eine">einer</r>', 'Am <r was="ich bin">bist du', 'Am <r>bist du</r>', 'So <r was="ich bin">ich bin</r>.']) {
    const x = C.parseReply(bad, his);
    assert.equal(x.recast, null, bad);
    assert.ok(!/<|>/.test(x.plain), `no tag shown: ${x.plain}`);
  }
  // case, punctuation and quotes do not matter for "was"
  assert.ok(C.parseReply('Klar, <r was="Ich Bin">bin ich</r>!', 'Am Samstag, ich bin…').recast);
  assert.equal(C.parseReply('Kein Tag hier.', his).plain, 'Kein Tag hier.');
  assert.equal(C.parseReply('x <r was="bin">bist</r>', null).recast, null, 'no message of his to compare with (the opening)');
});

test('while streaming: tags never show, a tag still arriving is hidden', () => {
  assert.equal(C.visibleText('Oh, am Samstag <r was="ich'), 'Oh, am Samstag ');
  assert.equal(C.visibleText('Oh, am Samstag <r was="ich bin">bist du</'), 'Oh, am Samstag bist du');
  assert.equal(C.visibleText('Oh, am Samstag <r was="ich bin">bist du</r> in'), 'Oh, am Samstag bist du in');
  assert.equal(C.visibleText('Hallo'), 'Hallo');
});

test('cost: usage × the price list; an unknown price never counts as free', () => {
  const u = { in: 1000, cacheRead: 20000, cacheWrite: 3000, out: 1800 };
  assert.ok(Math.abs(C.costOf(u, SONNET) - (1000 * 2 + 20000 * 0.2 + 3000 * 2.5 + 1800 * 10) / 1e6) < 1e-12);
  assert.ok(C.costOf(u, null) > C.costOf(u, SONNET));
  assert.deepEqual(C.addUsage(C.noUsage(), { in: 5, out: 2 }), { in: 5, cacheRead: 0, cacheWrite: 0, out: 2 });
  assert.deepEqual(C.usageOf({ input_tokens: 3, output_tokens: 4, cache_read_input_tokens: 5, cache_creation_input_tokens: 6 }), { in: 3, out: 4, cacheRead: 5, cacheWrite: 6 });
});

test('cost limit per turn: max_tokens on every request, his message capped', () => {
  const b = C.turnRequest({ model: 'm', base: 'b', session: 's', messages: [] });
  assert.equal(b.max_tokens, 1200);
  assert.equal(C.cleanInput('ä'.repeat(601)).length, 600);
});

test('cost limit per session: the largest share of turns, minutes, input and output; warn at 80 %, closed at 100 %', () => {
  const t0 = 1_000_000;
  const at = (/** @type {number} */ min) => t0 + min * 60000;
  const s = (/** @type {number} */ turns, /** @type {any} */ usage = C.noUsage()) => ({ turns, startedAt: t0, usage });
  assert.deepEqual([C.sessionLoad(s(5), at(2)).warn, C.sessionLoad(s(5), at(2)).closed], [false, false]);
  assert.equal(C.sessionLoad(s(24), at(2)).warn, true, '24 of 30 turns');
  assert.equal(C.sessionLoad(s(24), at(2)).by, 'turns');
  assert.equal(C.sessionLoad(s(23), at(2)).warn, false);
  assert.equal(C.sessionLoad(s(30), at(2)).closed, true);
  assert.equal(C.sessionLoad(s(1), at(20)).warn, true, '20 of 25 minutes');
  assert.equal(C.sessionLoad(s(1), at(25)).closed, true);
  assert.equal(C.sessionLoad(s(1), at(25)).by, 'minutes');
  assert.equal(C.sessionLoad(s(1, { in: 1000, cacheRead: 95000, cacheWrite: 0, out: 0 }), at(1)).by, 'input', 'cache reads count as input');
  assert.equal(C.sessionLoad(s(1, { in: 0, cacheRead: 0, cacheWrite: 0, out: 10000 }), at(1)).closed, true);
});

test('cost limit per month: $3 by default, 80 % warns, 100 % is over; a new month starts from zero', () => {
  let sp = C.addSpend(null, '2026-10', 0.11, { session: true });
  sp = C.addSpend(sp, '2026-10', 0.09, { session: true });
  assert.deepEqual(sp, { month: '2026-10', usd: 0.2, sessions: 2 });
  assert.equal(C.spentIn(sp, '2026-10'), 0.2);
  assert.equal(C.spentIn(sp, '2026-11'), 0, 'month rollover');
  assert.deepEqual(C.addSpend(sp, '2026-11', 0.05), { month: '2026-11', usd: 0.05, sessions: 0 });
  assert.equal(C.monthLoad(2.39, null).warn, false);
  assert.equal(C.monthLoad(2.4, null).warn, true);
  assert.equal(C.monthLoad(2.99, undefined).over, false);
  assert.equal(C.monthLoad(3, undefined).over, true);
  assert.equal(C.monthLoad(4, 5).warn, true, 'his own cap');
  assert.equal(C.monthLoad(1, 0).cap, C.MONTHLY_CAP, 'a cap of 0 is not a cap');
  // the month comes from the study day the clock gives (never a Date here)
  assert.equal(C.monthOf('2026-10-31'), '2026-10');
  assert.equal(C.monthOf(add('2026-10-31', 1)), '2026-11');
  assert.equal(C.estimateNext([]), C.DEFAULT_SESSION_USD);
  assert.ok(Math.abs(C.estimateNext([{ costUsd: 0.1, startedAt: 1 }, { costUsd: 0.2, startedAt: 2 }, { costUsd: 0, startedAt: 3 }]) - 0.15) < 1e-12);
});

test('every conversation model has a price, dated with the date-gate marker', async () => {
  const { readFileSync } = await import('node:fs');
  for (const m of [config.anthropic.models.converse, config.anthropic.models.converseFeedback, config.anthropic.models.check]) {
    const p = config.anthropic.prices[m];
    assert.ok(p && p.in > 0 && p.out > p.in && p.cacheRead < p.in && p.cacheWrite > p.in, m);
  }
  const src = readFileSync(new URL('../../src/core/config.js', import.meta.url), 'utf8');
  assert.match(src, /pricesAsOf: '\d{4}-\d\d-\d\d',\s+\/\/ date-gate: api-version/);
});

test('feedback transcript: his text escaped, the partner\'s recast tags kept', () => {
  const turns = /** @type {any[]} */ ([
    { i: 0, who: 'partner', text: 'Hallo!', at: 0 },
    { i: 1, who: 'learner', text: 'Ich <b>bin</turn> da', at: 1, input: 'typed' },
    { i: 2, who: 'partner', text: 'Du <r was="bin">bist</r> da.', at: 2 },
  ]);
  const t = C.feedbackTranscript(turns);
  assert.equal(t.split('\n').length, 3);
  assert.match(t, /<turn i="1" who="learner" input="typed">Ich ‹b›bin‹\/turn› da<\/turn>/);
  assert.match(t, /<r was="bin">bist<\/r>/);
});

test('stats and evidence', () => {
  const turns = /** @type {any[]} */ ([
    { i: 0, who: 'partner', text: 'Hallo, wie geht es dir?', at: 0 },
    { i: 1, who: 'learner', text: 'Gut, danke. Und dir?', at: 60000 },
    { i: 2, who: 'partner', text: 'Auch gut.', at: 120000 },
    { i: 3, who: 'learner', text: 'Schön.', at: 300000 },
  ]);
  assert.deepEqual(C.stats(turns, 0), { turns: 2, words: 5, perTurn: 3, minutes: 5 });
  let ev = C.addEvidence({}, ['W:a', 'W:a', 'W:b'], '2026-10-01');
  ev = C.addEvidence(ev, ['W:a'], '2026-10-03');
  assert.deepEqual(ev, { 'W:a': { first: '2026-10-01', last: '2026-10-03', n: 2 }, 'W:b': { first: '2026-10-01', last: '2026-10-01', n: 1 } });
});
