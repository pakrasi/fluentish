// The persisted error log (src/core/log.js) and its daily upload with the backup (src/data/sync/backup.js
// uploadLog): a ring of 500 in IndexedDB, scrubbed of tokens, keys and quoted text when logged, script text replaced
// before upload, once a study day. Synthetic data; a mock GitHub with a synthetic token.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { log, entries, scrub, attachLogStore, resetLog, RING } from '../../src/core/log.js';
import { Store } from '../../src/data/store.js';
import { createMemoryAdapter } from '../../src/data/adapters/memory.js';
import { sync } from '../../src/data/sync/index.js';
import { resetThrottle } from '../../src/data/sync/github-b1exam.js';
import * as B from '../../src/data/sync/backup.js';
import { config } from '../../src/core/config.js';
import { mockGithubFor } from './sync-harness.mjs';

const TOKEN = 'test-token-not-real-0004';
const quiet = fn => { const e = console.error; console.error = () => {}; try { return fn(); } finally { console.error = e; } };
const wait = ms => new Promise(r => setTimeout(r, ms));

test('scrub: tokens, keys, authorization values, URL queries and quoted text never reach the log', () => {
  const pat = ['github', 'pat', '11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz'].join('_');
  const ant = ['sk', 'ant', 'api03-abcdefghijklmnopqrstuvwxyz0123'].join('-');
  const s = scrub(`fetch failed ${pat} with Bearer ${'x'.repeat(30)} and {"x-api-key": "${ant}"} at https://api.github.com/repos/a/b?ref=secret#frag: "Ich habe gestern meinen Nachbarn getroffen" 'kurz'`);
  for (const bad of [pat, ant, 'x'.repeat(30), 'ref=secret', 'Nachbarn']) assert.ok(!s.includes(bad), `${bad} in ${s}`);
  assert.match(s, /\[removed\]/);
  assert.match(s, /https:\/\/api\.github\.com\/repos\/a\/b\?\[removed\]/);
  assert.match(s, /'kurz'/, 'a word or two in quotes stays (an error names a field)');
  assert.ok(scrub('y'.repeat(1000)).length <= 300);
  assert.equal(scrub('The GitHub token is invalid or expired'), 'The GitHub token is invalid or expired');
});

test('the ring keeps the last 500, survives a reload through IndexedDB, and saves what came before storage opened', async () => {
  resetLog();
  quiet(() => { log('boot', new Error('before storage')); });
  const adapter = createMemoryAdapter();
  await adapter.putKV('device', 'log', [{ at: '2026-10-04T08:00:00.000Z', where: 'old', message: 'from last time' }]);
  await attachLogStore(adapter);
  assert.deepEqual(entries().map(e => e.where), ['old', 'boot']);
  quiet(() => { for (let i = 0; i < RING + 20; i++) log('loop', `n${i}`); });
  assert.equal(entries().length, RING);
  assert.equal(entries().at(-1).message, `n${RING + 19}`);
  await wait(1100);
  const saved = (await adapter.loadScope('device')).log;
  assert.equal(saved.length, RING);
  // a reload: the next session reads it back
  resetLog();
  await attachLogStore(adapter);
  assert.equal(entries().length, RING);
  resetLog();
});

test('uploaded once a study day with the backup: only new entries, script text replaced, nothing private', async () => {
  resetLog();
  const adapter = createMemoryAdapter();
  let day = '2026-10-04';
  const store = await Store.open({ adapter, profile: { id: '0192a3b4-c5d6-7e8f-9a0b-0000000000d1', name: '', kind: 'local' }, device: { deviceId: 'dev1', seq: 0 }, clock: { today: () => day } });
  store.set('secrets', { githubToken: TOKEN });
  store.set('scripts', { s1: { id: 's1', title: 'Fahrradladen', sections: [{ id: 'a', title: 'Anfang', sentences: [{ id: 'x', de: 'Die Kette überträgt die Kraft auf das Hinterrad.' }] }] } });
  await attachLogStore(adapter);
  quiet(() => {
    log('route', new Error('could not render die Kette überträgt die Kraft'));   // three words of a script, not in quotes
    log('script', 'Fahrradladen: parse failed');
    log('sync', new Error('GitHub 500: server error'));
  });
  const gh = mockGithubFor(config.resultsRepo);
  resetThrottle();
  await sync(store, { fetch: gh.fetch, pull: false, backupNow: true });
  const p = 'data/logs/dev1/2026-10-04.ndjson';
  assert.ok(gh.files.has(p), [...gh.files.keys()].join(','));
  const lines = gh.text(p).trim().split('\n').map(l => JSON.parse(l));
  assert.deepEqual(lines.map(l => l.where), ['route', 'script', 'sync']);
  assert.equal(lines[0].message, '[removed: script text]');
  assert.equal(lines[1].message, '[removed: script text]');
  assert.equal(lines[2].message, 'Error: GitHub 500: server error');
  const text = gh.text(p);
  for (const bad of ['Kette', 'Fahrradladen', 'Hinterrad', TOKEN]) assert.ok(!text.includes(bad), bad);
  // once a study day: a later flush the same day sends nothing
  quiet(() => log('sync', 'later the same day'));
  resetThrottle();
  await sync(store, { fetch: gh.fetch, pull: false, backupNow: true });
  assert.equal(gh.text(p).trim().split('\n').length, 3);
  // the next day: only what is new
  day = '2026-10-05';
  resetThrottle();
  await sync(store, { fetch: gh.fetch, pull: false, backupNow: true });
  const next = gh.text('data/logs/dev1/2026-10-05.ndjson').trim().split('\n').map(l => JSON.parse(l));
  assert.deepEqual(next.map(l => l.message), ['later the same day']);
  assert.equal(B.state(store).logDay, '2026-10-05');
  resetLog();
});
