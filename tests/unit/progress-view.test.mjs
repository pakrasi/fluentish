// Today › Progress (round 4, lane L5): the page's numbers (src/features/today/progress/model.js), the study hours
// file (hours.js) and the chart colours (styles/features/progress.css). All data is synthetic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as M from '../../src/features/today/progress/model.js';
import { loadHours, hoursSource, HOURS_KV } from '../../src/features/today/progress/hours.js';
import * as D8 from '../../src/domain/days.js';
import { config } from '../../src/core/config.js';
import { DEVICE_SCOPE } from '../../src/data/store.js';
import { SNAPSHOT_KV } from '../../src/data/sync/backup.js';

/** A progress record (progress@1) with the given counts. */
function rec({ known = 0, b2 = 0, b2of = 100, est = false, learnt = 0, missed = 0, min = 0, by = null, dev = { mac: min }, jump = 0, atlas = 'aaaa0000', g3 = 0 } = {}) {
  const r = {
    v: 1, at: '2026-10-05T10:00:00Z', dev: 'mac', src: est ? 'estimate' : 'live', atlas,
    known: { w: [known - b2 - g3, 0, 0, b2], p: [], g: [0, 0, 0, g3] }, shaky: { w: [], p: [], g: [] }, seen: { w: [known], p: [], g: [] },
    of: { w: [400, 300, 300, b2of], p: [], g: [0, 0, 0, 5] },
    day: { new: learnt, learnt, missed, reviews: 3, again: missed },
    min: { total: min, rounds: 1, dev: Object.fromEntries(Object.entries(dev).map(([id, m]) => [id, { m }])) },
  };
  if (by) r.min.by = by;
  if (est) r.estimated = true;
  if (jump) r.jump = { from: 'igloo', known: jump };
  return r;
}

test('points: totals, levels, estimates, the Igloo jump, devices and kinds from the stored records', () => {
  const ps = M.points([
    ['2026-10-04', rec({ known: 300, est: true, jump: 120, min: 20 })],
    ['2026-10-05', rec({ known: 310, b2: 4, g3: 1, learnt: 6, min: 35, by: { review: 20, new: 10 }, dev: { mac: 20, iph: 15, _: 0 } })],
    ['bad-day', rec()],
  ]);
  assert.equal(ps.length, 2);
  assert.equal(ps[0].known, 300); assert.equal(ps[0].est, true); assert.equal(ps[0].jump, 120);
  assert.equal(ps[1].of, 1105, 'every kind at every level');
  assert.equal(ps[1].lk[3], 5, 'B2: the words and the grammar concept'); assert.equal(ps[1].lg[3], 1); assert.equal(ps[1].ln[3], 105);
  assert.deepEqual(ps[1].devs.sort(), ['iph', 'mac'], 'named devices with minutes');
  assert.deepEqual(M.groupsOf(ps[1]), { review: 20, new: 10, practice: 0, exam: 0, other: 5 }, 'minutes not split by kind are their own group');
  assert.deepEqual(M.groupsOf(ps[0]), { review: 0, new: 0, practice: 0, exam: 0, other: 20 });
});

test('weeks: Monday to Sunday, the week of today partial, empty weeks kept, devices and kinds added up', () => {
  const ps = M.points([
    ['2026-10-05', rec({ known: 100, learnt: 5, min: 30, by: { review: 20, write: 10 }, dev: { mac: 30 } })],   // Monday
    ['2026-10-11', rec({ known: 110, learnt: 4, missed: 1, min: 12, by: { exam: 12 }, dev: { iph: 12 } })],     // Sunday
    ['2026-10-26', rec({ known: 130, learnt: 2, min: 8, by: { talk: 8 } })],
  ]);
  const ws = M.weeks(ps, '2026-10-07', '2026-10-28');
  assert.deepEqual(ws.map(w => w.mon), ['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26']);
  assert.deepEqual([ws[0].min, ws[0].days, ws[0].learnt, ws[0].missed, ws[0].devices, ws[0].known], [42, 2, 9, 1, 2, 110]);
  assert.deepEqual(ws[0].groups, { review: 20, new: 0, practice: 10, exam: 12, other: 0 });
  assert.deepEqual(ws[0].kinds, { review: 20, write: 10, exam: 12 });
  assert.deepEqual([ws[1].min, ws[1].days, ws[1].known], [0, 0, 110], 'a week without study: no minutes, known carried');
  assert.equal(ws[3].partial, true); assert.equal(ws[2].partial, false);
  assert.equal(ws[3].groups.practice, 8);
});

test('summary and ranges: the net change from the last record before the range; ranges start on a Monday', () => {
  const ps = M.points([['2026-07-01', rec({ known: 50 })], ['2026-09-01', rec({ known: 200, learnt: 3, min: 10 })], ['2026-10-01', rec({ known: 260, learnt: 7, min: 20 })]]);
  const s = M.summary(ps, '2026-08-15');
  assert.deepEqual([s.net, s.learnt, s.min, s.days, s.known], [210, 10, 30, 2, 260]);
  assert.equal(D8.parse(M.rangeStart('12w', '2026-10-08', '2026-07-01')).getDay(), 1);
  assert.equal(M.rangeStart('12w', '2026-10-08', '2026-07-01'), '2026-07-20');
  assert.equal(M.rangeStart('6m', '2026-10-08', '2026-09-01'), '2026-08-31', 'never before the first record\'s week');
  assert.equal(M.rangeStart('all', '2026-10-08', '2026-07-01'), '2026-06-29');
});

test('calendar: every day from the range\'s Monday, steps by minutes, days before the log not counted, no runs', () => {
  const ps = M.points([['2026-10-06', rec({ min: 5 })], ['2026-10-07', rec({ min: 30 })], ['2026-10-09', rec({ min: 60 })], ['2026-10-10', rec({ min: 0 })]]);
  const c = M.calendar(ps, '2026-10-06', '2026-10-11');
  assert.equal(c.days[0].day, '2026-10-05'); assert.equal(c.days[0].before, true);
  assert.deepEqual(c.days.map(d => d.step), [0, 1, 2, 0, 3, 1, 0], 'studied without minutes is the first step');
  assert.deepEqual([c.studied, c.total], [4, 6]);
  assert.ok(!Object.keys(c).some(k => /streak|row|run/i.test(k)), 'no streak in the model');
});

test('milestones: dated by the first exact day; never by an estimate; the Igloo jump says so; hours count every day', () => {
  const ps = M.points([
    ['2026-09-30', rec({ known: 120, est: true, min: 300 })],
    ['2026-10-04', rec({ known: 520, jump: 380, min: 200 })],
    ['2026-10-05', rec({ known: 990, min: 100 })],
    ['2026-10-06', rec({ known: 1010, b2: 1, g3: 1, min: 30 })],
    ['2026-10-07', rec({ known: 995, min: 10 })],
  ]);
  const all = M.milestones(ps);
  const by = id => all.find(m => m.id === id);
  assert.equal(by('known-100').how, 'estimated'); assert.equal(by('known-100').on, null, 'reached on an estimated day: undated');
  assert.deepEqual([by('known-500').on, by('known-500').how], ['2026-10-04', 'igloo']);
  assert.deepEqual([by('known-1000').on, by('known-1000').how], ['2026-10-06', 'exact']);
  assert.equal(by('known-1000').have, 995, 'a count that fell again keeps its date');
  assert.deepEqual([by('grammar-B2').on, by('grammar-B2').how], ['2026-10-06', 'exact']);
  assert.equal(by('hours-10').on, '2026-10-05', 'minutes are exact on every day: 300 + 200 + 100 min');
  const { reached, next } = M.milestoneList(all);
  assert.equal(reached[0].on, '2026-10-06'); assert.equal(reached.at(-1).on, null, 'undated last');
  assert.equal(next.length, 2);
  assert.ok(!all.some(m => m.id === 'known-2000'), 'no milestone above the pool');
});

/** n weeks of daily records with B2 known growing by `perWeek` (a steady pace plus a little noise). */
function growth({ weeks, perWeek, start = '2026-10-05', est = 0, noise = 0 }) {
  /** @type {[string, any][]} */ const out = [];
  let b2 = 10;
  for (let d = 0; d < weeks * 7; d++) {
    const day = D8.add(start, d);
    if (d % 7 === 0 && d) b2 += perWeek + (noise ? ((d / 7) % 2 ? noise : -noise) : 0);
    out.push([day, rec({ known: 800 + b2, b2, b2of: 1000, est: d < est })]);
  }
  return M.points(out);
}

test('level goal: hidden until 8 full weeks of exact records, then a 10th to 90th percentile range', () => {
  const young = M.levelEta(growth({ weeks: 6, perWeek: 20 }), 'B2', D8.add('2026-10-05', 6 * 7));
  assert.equal(young.state, 'young'); assert.ok(young.weeks >= 5 && young.weeks <= 6);
  const estimated = M.levelEta(growth({ weeks: 10, perWeek: 20, est: 21 }), 'B2', D8.add('2026-10-05', 70));
  assert.equal(estimated.state, 'young', 'estimated days are not used');
  const today = D8.add('2026-10-05', 70);
  const ok = M.levelEta(growth({ weeks: 10, perWeek: 20, noise: 6 }), 'B2', today);
  assert.equal(ok.state, 'ok');
  assert.ok(ok.from <= ok.mid && ok.mid <= ok.to, 'ordered');
  // 800 needed, about 200 known: ~30 weeks at 20 a week
  const weeksTo = d => D8.diff(today, d) / 7;
  assert.ok(weeksTo(ok.mid) > 25 && weeksTo(ok.mid) < 40, `middle ${ok.mid}`);
  assert.ok(weeksTo(ok.to) - weeksTo(ok.from) > 2, 'a range, not a date');
  assert.deepEqual(M.levelEta(growth({ weeks: 10, perWeek: 20, noise: 6 }), 'B2', today), ok, 'the same on every open');
  const steady = M.levelEta(growth({ weeks: 10, perWeek: 20 }), 'B2', today);
  assert.equal(steady.from, steady.to, 'no spread without variation');
  assert.equal(M.levelEta(growth({ weeks: 10, perWeek: 0 }), 'B2', today).state, 'flat');
  assert.equal(M.levelEta(growth({ weeks: 10, perWeek: -3 }), 'B2', today).state, 'flat');
  assert.equal(M.levelEta(M.points([['2026-10-05', rec({ known: 900, b2: 850, b2of: 1000 })]]), 'B2', today).state, 'reached');
});

test('study hours file: the URL, one language by day, by week; the app\'s minutes never include it', () => {
  assert.equal(M.hoursUrl({ repo: 'Someone/lang-hours', path: '/data/hours file.json' }), null, 'no spaces');
  assert.equal(M.hoursUrl({ repo: 'Someone/lang-hours', path: '/data/hours.json' }), 'https://someone.github.io/lang-hours/data/hours.json');
  assert.equal(M.hoursUrl({ repo: 'a/b', path: '../x.json' }), null);
  assert.equal(M.hoursUrl({ repo: 'not a repo', path: 'x.json' }), null);
  const file = { entries: [
    { date: '2026-10-05', hours: 1.5, lang: 'german' }, { date: '2026-10-05', hours: 0.5, lang: 'German' },
    { date: '2026-10-06', hours: 2, lang: 'bengali' }, { date: 'yesterday', hours: 1 }, { date: '2026-10-07', hours: 99 },
    { date: '2026-10-13', hours: 1 },
  ] };
  const byDay = M.hoursByDay(file, 'german');
  assert.deepEqual([...byDay], [['2026-10-05', 2], ['2026-10-13', 1]], 'German only (an entry without a language counts), malformed left out');
  const hw = M.hoursWeeks(byDay, '2026-10-05', '2026-10-14');
  assert.deepEqual(hw.map(w => [w.mon, w.min, w.days, w.partial]), [['2026-10-05', 120, 1, false], ['2026-10-12', 60, 1, true]]);
  // the app's weeks come from the progress log alone: the same with or without a file
  const ps = M.points([['2026-10-05', rec({ min: 30 })]]);
  assert.equal(M.weeks(ps, '2026-10-05', '2026-10-14')[0].min, 30);
  assert.equal(M.weeks.length, 3, 'weeks() takes no hours');
  assert.equal(M.weeklyAverage([{ min: 60, partial: false }, { min: 120, partial: false }, { min: 999, partial: true }], 2), 90);
  assert.equal(M.weeklyAverage([{ min: 60, partial: false }], 2), null);
});

test('study hours file: read once a study day, kept on this device only, an old copy on a failed read', async () => {
  const kv = {};
  const store = { get: (k, f) => (k in kv ? kv[k] : f), set: (k, v) => { kv[k] = v; } };
  let day = '2026-10-05', calls = 0, fail = false;
  const ctx = { store, clock: { today: () => day } };
  const fetch = async url => { calls++; if (fail) throw new Error('offline'); return { ok: true, json: async () => ({ syncedAt: 'x', entries: [{ date: '2026-10-05', hours: 1, lang: 'german', note: 'class 60m' }] }), url }; };
  assert.equal(hoursSource({}), null, 'no default source: All tracked needs a file the learner entered (docs/SHARING.md)');
  assert.equal(hoursSource({ connections: { hours: null } }), null);
  const src = /** @type {any} */ (hoursSource({ connections: { hours: { repo: 'someone/hours', path: 'data/h.json', lang: 'german' } } }));
  assert.deepEqual(src, { repo: 'someone/hours', path: 'data/h.json', lang: 'german' });
  let r = await loadHours(ctx, src, { fetch });
  assert.equal(r.error, null); assert.equal(r.data.entries.length, 1); assert.equal(r.data.entries[0].note, undefined, 'only what the chart needs');
  await loadHours(ctx, src, { fetch });
  assert.equal(calls, 1, 'once a day');
  day = '2026-10-06'; fail = true;
  r = await loadHours(ctx, src, { fetch });
  assert.equal(calls, 2); assert.equal(r.error, 'offline'); assert.equal(r.data.day, '2026-10-05', 'the last copy stays');
  assert.ok(DEVICE_SCOPE.has(HOURS_KV), 'device scope'); assert.ok(!(HOURS_KV in SNAPSHOT_KV), 'never in the backup');
});

/* ---------- colours ---------- */

const lum = hex => { const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test('study days ramp: three ink steps in order, the lightest step clear of the canvas, in light and dark', () => {
  const css = readFileSync(new URL('../../styles/features/progress.css', import.meta.url), 'utf8');
  const tokens = readFileSync(new URL('../../styles/tokens.css', import.meta.url), 'utf8');
  const ramp = sel => { const m = new RegExp(`${sel}\\{[^}]*--pg-k1: (#[0-9a-f]{6}); --pg-k2: (#[0-9a-f]{6}); --pg-k3: (#[0-9a-f]{6})`, 'm').exec(css); return m.slice(1); };
  const canvas = re => re.exec(tokens)[1];
  const light = ramp('^\\.progress '), dark = ramp(':root\\[data-theme="dark"\\] \\.progress ');
  const cl = canvas(/--canvas: (#[0-9a-f]{6})/), cd = canvas(/\[data-theme="dark"\][^}]*--canvas: (#[0-9a-f]{6})/s);
  for (const [r, c, name] of [[light, cl, 'light'], [dark, cd, 'dark']]) {
    const rs = r.map(x => ratio(x, c));
    assert.ok(rs[0] >= 3, `${name}: the lightest step at ${rs[0].toFixed(2)}:1 (3:1 for a graphical object)`);
    assert.ok(rs[0] < rs[1] && rs[1] < rs[2], `${name}: steps grow away from the canvas`);
  }
  assert.ok(css.includes(':root:not([data-theme="light"]) .progress { --pg-k1: #5c5f68'), 'the dark ramp under the system setting too');
});
