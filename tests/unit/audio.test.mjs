// Word audio (src/services/audio.js): the recordings manifest is fetched from the exam's media origin, and the page
// CSP allows that origin for the fetch (connect-src) and the files (media-src). No network: fetch is a mock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { audioManifest, audioUrl, audioKey } from '../../src/services/audio.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const manifest = JSON.parse(readFileSync(path.join(ROOT, 'content/manifest.json'), 'utf8'));
const csp = /Content-Security-Policy" content="([^"]+)"/.exec(readFileSync(path.join(ROOT, 'index.html'), 'utf8'))[1];
const directive = name => (csp.split(';').map(s => s.trim()).find(s => s.startsWith(name + ' ')) || '').split(/\s+/).slice(1);

test('the CSP allows the media origin for the manifest fetch and the recordings', () => {
  const media = manifest.exams.find(e => e.media).media;
  const origin = new URL(media).origin;
  assert.ok(directive('connect-src').includes(origin), `connect-src has ${origin}`);
  assert.ok(directive('media-src').includes(origin), `media-src has ${origin}`);
});

test('manifest fetched once from <media>/vocab/, keys normalised', async () => {
  const calls = [];
  const f = async url => { calls.push(url); return new Response(JSON.stringify({ 'Ich habe einen Termin.': 'ab12.mp3' }), { status: 200 }); };
  const content = { manifest: async () => manifest };
  await audioManifest(content, f);
  const media = manifest.exams.find(e => e.media).media;
  assert.deepEqual(calls, [new URL('vocab/manifest.json', media).href]);
  assert.equal(await audioUrl(content, 'a)  Ich habe  einen Termin.'), new URL('vocab/ab12.mp3', media).href);
  assert.equal(await audioUrl(content, 'Nicht da.'), null);
  assert.equal(calls.length, 1);
  assert.equal(audioKey('b) Guten  Tag '), 'Guten Tag');
});
