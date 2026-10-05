// B1 trainer pure modules. Ported from the legacy node script with the assertions unchanged; run with `node --test tests/unit`.
import { test } from 'node:test';
import * as D from '../../src/core/clock.js';
import FS from '../../src/domain/fsrs.js';
import T from '../../src/domain/timer.js';
import Det from '../../src/domain/detect.js';
import RD from '../../src/domain/b1ready.js';
import Sp from '../../src/domain/speech.js';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const J = p => JSON.parse(readFileSync(path.join(ROOT, p), 'utf8'));
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`);

test('b1day: local day with a 04:00 cutoff', () => {
  assert.equal(D.today(new Date(2026, 9, 3, 1, 30)), '2026-10-02', '01:30 counts for the day before');
  assert.equal(D.today(new Date(2026, 9, 3, 4, 0)), '2026-10-03');
  assert.equal(D.add('2026-10-30', 3), '2026-11-02');
  assert.equal(D.diff('2026-10-02', '2026-10-09'), 7);
  assert.deepEqual(['2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10'].map(d => D.phase(d, '2026-10-09')), ['week', 'lastNew', 'eve', 'day', 'after']);
  assert.equal(D.label('2026-10-09'), 'Fri 9 Oct');
});

test('FSRS-4.5, hand calculation for the sequence 3, 3, 1, 3', () => {
  {
    const W = FS.W, F = 19 / 81, C = -0.5, clamp = (x, a, b) => Math.min(b, Math.max(a, x));
    const Rf = (t, S) => Math.pow(1 + F * t / S, C), D0 = g => W[4] - (g - 3) * W[5];
    let S = W[2], Dd = clamp(D0(3), 1, 10);
    const step = (g, t) => {
      const r = Rf(t, S); const Dn = clamp(W[7] * D0(3) + (1 - W[7]) * (Dd - W[6] * (g - 3)), 1, 10);
      S = g > 1 ? S * (1 + Math.exp(W[8]) * (11 - Dn) * Math.pow(S, -W[9]) * (Math.exp(W[10] * (1 - r)) - 1)) : Math.min(S, W[11] * Math.pow(Dn, -W[12]) * (Math.pow(S + 1, W[13]) - 1) * Math.exp(W[14] * (1 - r)));
      Dd = Dn;
    };
    let rec = { ...FS.init(3) };
    near(rec.S, W[2], 1e-9, 'init S'); near(rec.D, D0(3), 1e-9, 'init D');
    for (const [g, t] of [[3, 3], [1, 8], [3, 1]]) { step(g, t); const n = FS.next(rec, g, t); rec = { ...rec, ...n }; near(rec.S, S, 1e-9, `S after ${g}`); near(rec.D, Dd, 1e-9, `D after ${g}`); }
    near(FS.R(0, 5), 1, 1e-12, 'R at t=0');
    near(FS.R(5, 5), 0.9, 0.001, 'R(S) = 0.9');
    assert.equal(FS.interval(10, 0.92), Math.round(10 / F * (Math.pow(0.92, 1 / C) - 1)));
  }
  // ratings
  assert.equal(FS.rate({ ok: false }), 1);
  assert.equal(FS.rate({ ok: true, revealed: true }), 1);
  assert.equal(FS.rate({ ok: true, ms: 25000, limit: 12 }), 1, 'over 2x');
  assert.equal(FS.rate({ ok: true, ms: 13000, limit: 12 }), 2, 'late');
  assert.equal(FS.rate({ ok: true, ms: 5000, limit: 12, selfRepair: true }), 2);
  assert.equal(FS.rate({ ok: true, ms: 5000, limit: 12, capSlip: true }), 2);
  assert.equal(FS.rate({ ok: true, ms: 5000, limit: 12, umlaut: true }), 2);
  assert.equal(FS.rate({ ok: true, ms: 5000, limit: 12 }), 3);
  assert.equal(FS.rate({ ok: true, ms: 5000, limit: 12, stage: 2, prevRating: 3 }), 4);
  assert.equal(FS.rate({ ok: true, ms: 90000, limit: null }), 3, 'untimed new item');
  // schedule: learning steps, first-of-day only, cap and load balance, exam day log-only
  {
    const exam = '2026-10-09';
    const ctx = (today, extra = {}) => ({ today, exam, phase: D.phase(today, exam), ...extra });
    let { rec, reinsert } = FS.schedule(null, { g: 3, ms: 4000 }, ctx('2026-10-03'));
    assert.equal(rec.learn, 1); assert.equal(reinsert, 'learn'); assert.equal(rec.due, '2026-10-03');
    ({ rec, reinsert } = FS.schedule(rec, { g: 3, ms: 4000 }, ctx('2026-10-03')));
    assert.equal(rec.learn, null, '2 correct graduate'); assert.equal(rec.due, '2026-10-04'); assert.equal(reinsert, null);
    const before = { ...rec };
    ({ rec } = FS.schedule(rec, { g: 1, ms: 4000 }, ctx('2026-10-03')));
    assert.equal(rec.S, before.S, 'a second attempt the same day does not change S'); assert.ok(rec.hist.at(-1)[4].includes('l'));
    ({ rec, reinsert } = FS.schedule(rec, { g: 1, ms: 4000 }, ctx('2026-10-04')));
    assert.equal(rec.lapses, 1); assert.equal(reinsert, 'lapse'); assert.equal(rec.due, '2026-10-04');
    ({ rec } = FS.schedule(rec, { g: 3, ms: 4000 }, ctx('2026-10-04')));
    assert.equal(rec.relearn, false); assert.equal(rec.due, '2026-10-05', 'one correct reinsertion → tomorrow');
    // the cap: a long interval lands on exam−3 … exam−1, on the least-loaded day
    const strong = { S: 40, D: 4, reps: 5, lapses: 0, last: '2026-10-03', due: '2026-10-04', stage: 2, streak: 0, learn: null, hist: [] };
    const load = { '2026-10-06': 30, '2026-10-07': 10, '2026-10-08': 50 };
    ({ rec } = FS.schedule(strong, { g: 3, ms: 3000, onTime: true }, ctx('2026-10-04', { forecast: d => load[d] || 0 })));
    assert.ok(rec.due <= '2026-10-08' || FS.R(D.diff('2026-10-04', exam), rec.S) >= 0.95, 'capped before the exam');
    if (rec.due <= '2026-10-08') assert.equal(rec.due, '2026-10-07', 'least-loaded day');
    const weak = { S: 6, D: 6, reps: 3, lapses: 0, last: '2026-10-02', due: '2026-10-03', stage: 1, streak: 0, learn: null, hist: [] };
    for (const today of ['2026-10-03', '2026-10-05', '2026-10-07']) {
      const r = FS.schedule(weak, { g: 3, ms: 3000 }, ctx(today, { forecast: () => 0 })).rec;
      assert.ok(r.due <= '2026-10-08' || FS.R(D.diff(today, exam), r.S) >= 0.95, `due ${r.due} ≤ exam−1 unless R(exam) ≥ 0.95 (from ${today})`);
    }
    const eve = FS.schedule({ ...weak, S: 0.6, last: '2026-10-07' }, { g: 2, ms: 3000 }, ctx('2026-10-08')).rec; assert.ok(eve.due === '2026-10-09' || FS.R(1, eve.S) >= 0.95, 'eve: due on the exam day at the latest');
    const day = FS.schedule(weak, { g: 1, ms: 3000 }, ctx('2026-10-09'));
    assert.equal(day.wrote, false); assert.equal(day.rec.S, weak.S, 'exam day: log only');
    assert.equal(FS.schedule(null, { g: 3 }, ctx('2026-10-09')).rec, null, 'exam day: no new records');
    // staircase: 3 on-time correct answers move the stage up; capped at 2 before the exam, at 1 while S < 3
    let st = { S: 10, D: 5, reps: 4, lapses: 0, last: '2026-10-01', due: '2026-10-02', stage: 1, streak: 2, learn: null, hist: [] };
    st = FS.schedule(st, { g: 3, ms: 2000, onTime: true }, ctx('2026-10-02')).rec; assert.equal(st.stage, 2);
    st = { ...st, streak: 2, last: '2026-10-03' };
    st = FS.schedule(st, { g: 3, ms: 2000, onTime: true }, ctx('2026-10-04')).rec; assert.equal(st.stage, 2, 'capped at 2 before the exam');
    st = FS.schedule(st, { g: 2, ms: 2000 }, ctx('2026-10-05')).rec; assert.equal(st.stage, 1);
  }
});

test('timer: 01 §b worked table, rows A–I, review stage (×1.0) ±0.5 s', () => {
  {
    const rows = [
      ['A', { prompt: 'the topic', promptLang: 'en', plan: 'recall', accept: ['das thema'] }, 7],
      ['B', { prompt: "I'm convinced that…", promptLang: 'en', plan: 'recall', accept: ['ich bin davon überzeugt, dass'] }, 15],
      ['C', { prompt: 'Ich glaube. Das ist eine gute Idee.', promptLang: 'de', plan: 'transform', prefill: 'Ich glaube, dass', accept: ['ich glaube, dass das eine gute idee ist'] }, 16],
      ['D', { prompt: 'Ich habe Angst ___ ___ Prüfung.', promptLang: 'de', plan: 'recall', accept: ['vor der'] }, 8],
      ['E', { prompt: 'Er trifft eine Entscheidung.', promptLang: 'de', plan: 'transform', accept: ['er hat eine entscheidung getroffen.'] }, 20],
      ['H', { prompt: 'beliebig oft', promptLang: 'de', plan: 'recall', accept: ['mehrmals'] }, 7],
      ['I', { prompt: 'begann', promptLang: 'de', plan: 'recall', accept: ['beginnen'] }, 6],
    ];
    for (const [k, it, want] of rows) near(T.limit(it, { stage: 2 }), want, k === 'E' || k === 'H' ? 1 : 0.5, `timer row ${k}`);
    assert.equal(T.limit(rows[0][1], { isNew: true }), null, 'new items are untimed');
    near(T.limit(rows[0][1], { stage: 0 }), 10, 0.5, 'row A new ×1.5');
    assert.equal(T.limit({ prompt: 'x', promptLang: 'en', plan: 'recall', accept: ['a'] }, { stage: 3 }), 5, 'floor 5 s');
    assert.ok(T.limit({ prompt: 'x '.repeat(80), promptLang: 'en', plan: 'choice', accept: ['a '.repeat(80)] }, { stage: 0 }) <= 40, 'cap 40 s');
  }
});

test('detectors: JS = Python reference, and no fires on right sentences', () => {
  {
    const plan = J('content/b1/plan.json');
    const fr = plan.traps.find(t => t.id === 'v2').fronted.map(Det.norm).sort((a, b) => b.length - a.length || a.localeCompare(b));
    assert.deepEqual([...Det.FRONTED].sort((a, b) => b.length - a.length || a.localeCompare(b)), fr, 'detect.js FRONTED = plan.json traps[v2].fronted');
    const cases = [];
    const its = J('content/igloo/grammar/items_de.json');
    for (const g of its) for (const a of [].concat(g.answer)) if (String(a).split(' ').length > 2) cases.push([a, a]);
    for (const c of Object.values(J('content/igloo/chunks/german.json').chunks)) if (c.ex) cases.push([c.ex, c.ex]);
    for (const x of J('content/igloo/words/de.json')) if (x.ex) cases.push([x.ex, x.ex]);
    const nRight = cases.length;
    const itemsFile = path.join(ROOT, 'content/b1/items.json');
    const items = existsSync(itemsFile) ? JSON.parse(readFileSync(itemsFile, 'utf8')) : JSON.parse(readFileSync(path.join(ROOT, 'tests/fixtures/b1-sample-items.json'), 'utf8'));
    for (const it of items) {
      const models = it.kind === 'reply' ? it.moves.map(m => m.model) : [it.model];
      for (const m of models) cases.push([m, m]);
      for (const w of it.wrong || []) cases.push([w, models.join(' ')]);
    }
    const fixed = [
      ['Das geht leider nicht, weil ich muss arbeiten.', ''], ['Ich hoffe, dass bei dir ist alles gut.', ''], ['Ich denke, dass es hängt von der Firma ab.', ''],
      ['Am Ende, wir machen eine Party.', ''], ['Leider, ich habe einen Termin.', ''], ['Wenn ich Zeit habe, ich lerne.', ''],
      ['Ich war froh, als ich habe die Nachricht bekommen.', ''], ['Wer hat Fragen, kann mich anrufen.', ''], ['Wer hat Fragen?', ''], ['Er ist größer als ich.', ''],
      ['Wenn ich Sie richtig verstehe, meinen Sie die Kosten?', ''], ['Wir könnten grillen, was meinst du?', ''], ['Natürlich, das stimmt.', ''],
      ['Mich würde interessieren, wie sieht deine Familie das?', ''], ['Mich würde interessieren, wie deine Familie das sieht.', ''], ['Tatsächlich ich habe keine Zeit.', ''],
      ['Einerseits Online-Lernen ist praktisch.', ''], ['Am Ende der Woche war es schön.', ''], ['Heute Abend gehe ich ins Kino.', ''], ['Ich weiß nicht, wie lange du arbeitest.', ''],
      ['Wer Fragen hat, er kann mich anrufen.', ''], ['Wer Fragen hat, der kann mich anrufen.', ''], ['Wer Zeit hat, kann kommen.', ''],
      ['Natürlich, es ist wichtig.', ''], ['Natürlich ist es wichtig.', ''], ['Wenn ich Sie richtig verstehe, Sie meinen die Kosten.', ''],
      ['Wenn ich dich richtig verstehe, meinst du die Kosten.', ''], ['Wer ist er, fragt sie.', ''],
      // a main clause after a missing comma ends the subordinate clause; the verb-final error stays an error
      ['Wenn ich Zeit habe lerne ich jeden Abend.', ''], ['Ich weiß nicht ob das klappt weil ich einen Arzttermin habe.', ''],
      ['Wenn das Wetter schön ist dann fahre ich mit dem Rad.', ''], ['Nachdem wir gefrühstückt hatten gingen wir los.', ''],
      ['Obwohl er keine Lust hat kommt er mit.', ''], ['Weil ich muss arbeiten gehe ich nicht.', ''], ['Wenn ich habe Zeit lerne ich.', ''],
      // the German review, round 2: a finite verb right after ob, no inversion after a da or als clause
      ['Ich würde gern wissen, ob kann man den Kurs abends machen.', ''], ['Da Busse und Bahnen teuer sind, viele Leute fahren lieber mit dem Auto.', ''],
      ['Als ich klein war, ich habe viel gespielt.', ''], ['Da hast du recht, die Preise sind hoch.', ''], ['Da ich krank war, bin ich zu Hause geblieben.', ''],
      ['Ich weiß nicht, ob man den Kurs abends machen kann.', ''], ['Als Kind habe ich viel gespielt, die Zeit war schön.', ''],
    ];
    for (const m of ['Weil ich muss arbeiten gehe ich nicht.', 'Wenn ich habe Zeit lerne ich.', 'Ich komme nicht weil ich habe keine Zeit.'])
      assert.deepEqual(Det.classes(m, null), ['verb-final'], `must fire without the comma: ${m}`);
    const mustNot = ['Wenn ich Sie richtig verstehe, meinen Sie die Kosten?', 'Wir könnten grillen, was meinst du?', 'Natürlich, das stimmt.', 'Mich würde interessieren, wie deine Familie das sieht.',
      'Am Ende der Woche war es schön.', 'Heute Abend gehe ich ins Kino.', 'Ich weiß nicht, wie lange du arbeitest.', 'Was meinst du damit?', 'Wer hat Fragen?',
      'Wer Fragen hat, der kann mich anrufen.', 'Natürlich ist es wichtig.', 'Natürlich, das ist wichtig.', 'Wenn ich dich richtig verstehe, meinst du die Kosten.', 'Wer kommt, sie oder er?',
      'Wenn ich Zeit habe lerne ich jeden Abend.', 'Ich weiß nicht ob das klappt weil ich einen Arzttermin habe.', 'Wenn das Wetter schön ist dann fahre ich mit dem Rad.',
      'Nachdem wir gefrühstückt hatten gingen wir los.', 'Obwohl er keine Lust hat kommt er mit.', 'Wenn ich Zeit hätte würde ich mitkommen.'];
    for (const m of mustNot) assert.deepEqual(Det.classes(m, null), [], `must not fire: ${m}`);
    assert.deepEqual(Det.classes('Ich würde gern wissen, ob kann man den Kurs abends machen.', null), ['verb-final']);
    assert.deepEqual(Det.classes('Da Busse und Bahnen teuer sind, viele Leute fahren lieber mit dem Auto.', null), ['inversion']);
    assert.deepEqual(Det.classes('Als ich klein war, ich habe viel gespielt.', null), ['inversion']);
    for (const m of ['Da hast du recht, die Preise sind hoch.', 'Da ich krank war, bin ich zu Hause geblieben.', 'Als Kind habe ich viel gespielt, die Zeit war schön.',
      'Ich weiß nicht, ob man den Kurs abends machen kann.']) assert.deepEqual(Det.classes(m, null), [], `must not fire: ${m}`);
    {   // with the word list's verbs (run() in the app): a participle or an infinitive at the end hides no verb-second error
      const verbs = Det.verbForms(J('content/igloo/words/de.json'));
      for (const m of ['Es war so laut, weil wir haben gefeiert.', 'Wie wäre es, wenn wir am Sonntag gehen zusammen essen?', 'Es tut mir leid, dass es so laut war gewesen.'])
        assert.equal(Det.run(m, {}, null, { verbs })?.cls, 'verb-final', m);
      for (const m of ['Es war so laut, weil wir gefeiert haben.', 'Wie wäre es, wenn wir am Sonntag zusammen essen gehen?', 'Es tut mir leid, dass es so laut gewesen ist.'])
        assert.equal(Det.run(m, {}, null, { verbs }), null, m);
    }
    const nModels = cases.length;
    cases.push(...fixed);
    const py = `import json,sys\nsys.path.insert(0, ${JSON.stringify(path.join(ROOT, 'tools'))})\nfrom validate_b1 import detect\nprint(json.dumps([sorted(detect(a, m or None)) for a, m in json.load(sys.stdin)]))`;
    // bounded (C3b): spawnSync blocks the whole test process, so a python3 that never answers (a first-run prompt of
    // the system python, a stalled .pyc write) used to hang the suite with no message; now it fails, and says why
    const out = spawnSync('python3', ['-c', py], { input: JSON.stringify(cases), encoding: 'utf8', maxBuffer: 1 << 26, timeout: 120_000, killSignal: 'SIGKILL',
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
    assert.ifError(out.error);
    assert.equal(out.status, 0, out.stderr || `python3 ended by ${out.signal}`);
    const want = JSON.parse(out.stdout);
    const bad = cases.map(([a, m], i) => [a, m, Det.classes(a, m || null), want[i]]).filter(([, , js, py]) => JSON.stringify(js) !== JSON.stringify(py));
    assert.deepEqual(bad.slice(0, 5), [], 'detect.js and validate_b1.detect disagree');
    const fires = cases.slice(0, nRight).filter(([a, m]) => Det.classes(a, m).length);
    assert.deepEqual(fires.slice(0, 5), [], 'detectors fire on right Igloo sentences');
    const modelFires = items.flatMap(it => (it.kind === 'reply' ? it.moves.map(m => m.model) : [it.model]).filter(m => Det.classes(m, m).length).map(m => `${it.id}: ${m}`));
    assert.deepEqual(modelFires.slice(0, 5), [], 'detectors fire on B1 models');
    void nModels;
    // run(): hints and the item-level classes
    let d = Det.run('Das geht leider nicht, weil ich muss arbeiten.', { model: 'Das geht leider nicht, weil ich arbeiten muss.' });
    assert.equal(d.cls, 'verb-final'); assert.equal(d.hint, 'Check where the verb goes after *weil*.');
    d = Det.run('Am Ende, wir machen eine Party.', {}); assert.equal(d.cls, 'v2'); assert.equal(d.hint, 'Check the word order after *Am Ende*.');
    d = Det.run('Ich habe Angst für der Prüfung.', { model: 'Ich habe Angst vor der Prüfung.', focus: ['fuer-vor'] }); assert.equal(d.cls, 'fuer-vor'); assert.equal(d.word, 'Angst');
    assert.deepEqual(Det.classes('Wer Fragen hat, er kann mich anrufen.', null), ['wer-der']);
    assert.deepEqual(Det.classes('Natürlich, es ist wichtig.', null), ['v2']);
    assert.deepEqual(Det.classes('Wenn ich Sie richtig verstehe, Sie meinen die Kosten.', null), ['inversion']);
    d = Det.run('Wer Fragen hat, er kann mich anrufen.', {}); assert.equal(d.cls, 'wer-der'); assert.equal(d.hint, 'Check the word after the comma.');
    d = Det.run('Der Thema ist interessant.', { model: 'Das Thema ist interessant.' }); assert.equal(d.cls, 'neuter'); assert.equal(d.word, 'Thema');
    assert.equal(Det.run('Das Thema ist interessant.', { model: 'Das Thema ist interessant.' }), null);
    d = Det.run('das thema', { model: 'Das Thema', focus: ['cap'] }, { focusMiss: [{ expected: 'Thema' }], capMiss: [] }); assert.equal(d.cls, 'cap');
    console.log(`detectors: ${cases.length} sentences, JS = Python; 0 fires on ${nRight} right sentences`);
  }
});

test('speech: clean, grade, the mic check', () => {
  {
    assert.equal(Sp.clean('äh ich glaube ich glaube dass das gut ist'), 'ich glaube dass das gut ist');
    assert.equal(Sp.clean('dass das dass das ist gut'), 'dass das ist gut');
    const it = { model: 'Ich glaube, dass das eine gute Idee ist.' };
    let g = Sp.grade('äh ich glaube dass das ist gut', it, null, { match: () => true });
    assert.equal(g.verbFinal, false); assert.equal(g.ok, false);
    g = Sp.grade('Ich glaube, dass das eine gute Idee ist', it, null, { match: () => true }); assert.equal(g.verbFinal, true); assert.equal(g.ok, true);
    g = Sp.grade('Ich habe Angst für der Prüfung', { model: 'Ich habe Angst vor der Prüfung.' }); assert.equal(g.fuerVor, false);
    g = Sp.grade('Wir sollen eine Party für den Kurs planen', { model: 'Wir sollen eine Party für den Kurs planen.' }); assert.equal(g.fuerVor, 'not-in', 'für that is not a für/vor item');
    g = Sp.grade('ich glaube dass das ist gut', it, { asr: { verbFinal: false } }); assert.equal(g.verbFinal, 'off', 'the phone fixes it: not checked');
    assert.equal(Sp.CANARY.length, 12);
    const all = Sp.calibrate(Sp.CANARY.map((c, i) => ({ i, said: c.de })));
    assert.ok(Object.values(all).every(x => x.checked && x.kept === 3), 'every mistake kept → every class checked');
    const fixed = Sp.calibrate(Sp.CANARY.map((c, i) => ({ i, said: c.de.replace('dass das ist eine gute Idee', 'dass das eine gute Idee ist').replace(/^Der Thema/, 'Das Thema') })));
    assert.equal(fixed.verbFinal.kept, 2); assert.equal(fixed.verbFinal.checked, false); assert.equal(fixed.articles.checked, false);
    console.log('speech: clean, grade and mic check ok');
  }
});

test('readiness', () => {
  {
    const pool = [
      { id: 'a', area: 'speaking', group: 'S1', star: true }, { id: 'b', area: 'speaking', group: 'S1' },
      { id: 'c', area: 'grammar', group: 'verb-final', trap: 'verb-final' }, { id: 'd', area: 'reading', group: 'rules' },
    ];
    const base = { pool, today: '2026-10-03', exam: '2026-10-09', phase: 'week' };
    let r = RD.compute({ ...base, store: {} });
    assert.equal(r.overall.recall, 0); assert.equal(r.overall.coverage, 0); assert.deepEqual(r.overall.without, ['words', 'writing']);   // writing: the Schreiben phrases, an area since round 2
    const store = { a: { S: 100, D: 5, reps: 3, last: '2026-10-03', due: '2026-10-08', learn: null } };
    r = RD.compute({ ...base, store });
    near(r.areas.speaking.coverage, 2 / 3, 1e-9, '★ counts double');
    near(r.areas.speaking.recall, 2 * FS.R(6, 100) / 3, 1e-9, 'R at exam morning');
    const w = { speaking: 0.4, grammar: 0.3, reading: 0.15 };
    near(r.overall.recall, (0.4 * r.areas.speaking.recall) / (w.speaking + w.grammar + w.reading), 1e-9, 'rescaled without words');
    // the set never depends on the date: an earlier date changes the day, not who counts
    const sooner = RD.compute({ ...base, exam: '2026-10-05', store });
    assert.equal(sooner.overall.n, r.overall.n, 'same items whatever the date');
    near(sooner.areas.speaking.recall, 2 * FS.R(2, 100) / 3, 1e-9, 'measured on the new exam day');
    const fc = RD.forecast({ a: { reps: 1, due: '2026-10-05', last: '2026-10-03', learn: null }, b: { reps: 1, due: '2026-10-01', last: '2026-09-30', learn: null } }, '2026-10-03');
    assert.equal(fc[0].n, 1, 'overdue counts today'); assert.equal(fc[2].n, 1);
  }
});
