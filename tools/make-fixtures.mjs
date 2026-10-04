#!/usr/bin/env node
// Generates tests/fixtures/legacy-synthetic.json: a localStorage dump with the SHAPES of the legacy apps' keys and
// made-up values (seeded, so the file is stable). Real exports never go into this repo; for a dry run against real
// data put them in the git-ignored tests/private/.
//   node tools/make-fixtures.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let seed = 20261;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const pick = a => a[Math.floor(rnd() * a.length)];
const day = n => { const d = new Date(Date.UTC(2026, 8, 20 + n)); return d.toISOString().slice(0, 10); };
const J = v => JSON.stringify(v);

const items = JSON.parse(readFileSync(path.join(ROOT, 'content/b1/items.json'), 'utf8')).slice(0, 40).map(i => i.id);
const fsrs = {};
items.forEach((id, i) => {
  const reps = 1 + Math.floor(rnd() * 5), last = day(5 + (i % 8));
  fsrs[id] = { S: +(0.5 + rnd() * 30).toFixed(3), D: +(2 + rnd() * 6).toFixed(3), due: day(9 + (i % 9)), reps, lapses: Math.floor(rnd() * 2), last, first: day(3),
    stage: Math.min(2, Math.floor(rnd() * 3)), streak: 0, learn: null, relearn: false, u: 1790000000000 + i * 1000, hist: [[last, pick([2, 3, 3, 4]), 4200, 't', '']] };
});
fsrs['BP:broken-one'] = { S: 'x', due: 'soon' };          // not a usable record: must be skipped and counted
fsrs['BP:broken-two'] = null;

const resp = n => Array.from({ length: n }, (_, i) => ({ id: `L1-${i + 1}`, given: pick([true, false]), correct: pick([true, false]) }));
const attempts = [
  { id: 1790000100000, day: 1, module: 'lesen', started_at: '2026-09-27T18:00:00', submitted_at: '2026-09-27T19:02:00', duration_s: 3720, score: 22, max_score: 30, meta: { source: 'remote' }, responses: resp(6), writings: [], synced: true, _path: 'data/attempts/20260927T190200-day01-lesen.json' },
  { id: 1790000200000, day: 1, module: 'hoeren', started_at: '2026-09-27T19:10:00', submitted_at: '2026-09-27T19:48:00', duration_s: 2280, score: 20, max_score: 30, meta: { source: 'remote' }, responses: resp(5), writings: [], synced: true, _path: 'data/attempts/20260927T194800-day01-hoeren.json' },
  { id: 1790000300000, day: 1, module: 'schreiben', started_at: '2026-09-27T20:00:00', submitted_at: '2026-09-27T20:58:00', duration_s: 3480, score: null, max_score: 100, meta: { source: 'remote' }, responses: [],
    writings: [{ aufgabe: 'aufgabe1', text: 'Liebe Sam, vielen Dank für die Einladung. Ich komme gern am Samstag.', word_count: 12 }], synced: true, _path: 'data/attempts/20260927T205800-day01-schreiben.json' },
  { id: 1790000400000, day: 2, module: 'lesen', started_at: '2026-09-30T08:00:00', submitted_at: '2026-09-30T09:03:00', duration_s: 3780, score: 25, max_score: 30, meta: { source: 'remote' }, responses: resp(6), writings: [], synced: true, _path: 'data/attempts/20260930T090300-day02-lesen.json' },
  { id: 1790000500000, day: 2, module: 'schreiben', started_at: '2026-09-30T10:00:00', submitted_at: '2026-09-30T10:55:00', duration_s: 3300, score: null, max_score: 100, meta: { source: 'remote' }, responses: [],
    writings: [{ aufgabe: 'aufgabe3', text: 'Sehr geehrte Frau Weber, leider kann ich am Montag nicht kommen.', word_count: 11 }], synced: false },
  { id: 1790000600000, day: 99, module: 'tanzen', score: 1 },   // not a module: skipped
];

const ls = {
  examDate: J('2026-10-09'),
  'doors.prefs.v2': J({ theme: 'dark', langs: ['german', 'french'], drillAudio: true, newPerDay: 10 }),
  'doors.apikey': 'sk-ant-FAKE-KEY',
  'gh:token': J('github_pat_FAKE'),
  'doors.b1.device': J('fx7k2q9a'),
  'doors.b1.fsrs.v1': J(fsrs),
  'doors.b1.settings.v1': J({ newPerDay: 30, claude: false }),
  'doors.b1.day.v1': J({ day: day(13), rounds: 3, traps: null, newShown: 12, firstTry: [20, 26], pred: [0, 0], shown: [] }),
  'doors.b1.days.v1': J([{ day: day(11), rounds: 2 }, { day: day(12), rounds: 4 }]),
  'doors.b1.seeded': J({ at: 1790000000000, n: 4 }),
  'doors.b1.words.v1': J({ cached: true }),                    // cache: not migrated
  'remote:attempts': J(attempts),
  'remote:voice': J([{ id: '20260927T210000-day01-sprechen-teil1.webm', day: 1, part: 'teil1' }]),
  'remote:seen': J(['fb-1']),
  'remote:feedback-local': J([{ id: 'local-1790000700000', day: 1, module: 'schreiben', body: 'Synthetic feedback text.', synced: false }]),
  'remote:vocab': J([{ id: '1:termin', word: 'Termin', day: 1, synced: true }, { id: '1:absagen', word: 'absagen', day: 1, synced: false }, { id: '2:nachbar', word: 'Nachbar', day: 2 }]),
  'remote:vocab-events': J([{ day: 1, word: 'Termin', at: '2026-09-28T09:00:00Z', known: true, synced: false }]),
  'draft:3:lesen': J({ 'L1-1': true, 'L2-1': 2 }),
  'draft:3:lesen:start': J(1790000800000),
  'draft:3:lesen:pause': J({ pausedAt: null, total: 120000, count: 1 }),
  'draft:4:schreiben': J({ aufgabe1: 'Hallo Kim, danke für deine Nachricht.' }),
  'draft:4:sprechen:prep:start': J(1790000900000),
  'plays:2:H1-1': J({ used: 1, extra: 0 }),
  'training:1-aufgabe1': J('Lieber Max, ich freue mich auf das Wochenende.'),
  'training:last': J('1-aufgabe1'),
  'doors.srs.v1': J(Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`german|K:ENG_CHUNK_${String(i + 1).padStart(4, '0')}`, { reps: 2, ivl: 6, due: 20730 + i, last: 20720 }]))),
  'doors.know.v1': J({ 'german|W:der_Tisch': { s: 'known' } }),
  'tr:somehash': J('cached translation'),                    // cache: not migrated
  'another-app:setting': J(true),                            // not ours: ignored
};

const out = { synthetic: true, about: 'Generated by tools/make-fixtures.mjs: legacy localStorage key shapes with made-up values. Never a real export.', localStorage: ls };
writeFileSync(path.join(ROOT, 'tests/fixtures/legacy-synthetic.json'), JSON.stringify(out, null, 1) + '\n');
console.log(`wrote tests/fixtures/legacy-synthetic.json (${Object.keys(ls).length} keys)`);
