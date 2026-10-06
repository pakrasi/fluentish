// German word-order detectors on B2 grammar (round 4, r4/detector-ersatzinf): three kinds of right German that the
// verb-final rule used to flag, and the wrong German next to each that it must keep flagging.
//   1. the Ersatzinfinitiv: in a subordinate clause the finite haben/werden comes BEFORE the verb cluster
//      ("weil er noch hat arbeiten müssen", "dass sie es hätte sehen können");
//   2. während as a preposition with the genitive ("Während des Fluges habe ich …"), which opens no clause;
//   3. a comparison after the clause verb ("dass Schlaf genauso wichtig ist wie Bewegung", "… billiger war als der Zug").
// Every right sentence is checked in all four ways the code runs the rules: classes() without and with the model (the
// content gates), run() with the word list's verbs (how the app grades) and without. Every wrong one must be flagged
// with its right model, by classes() and run(). validate_b1.py must agree with detect.js on all of them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import Det from '../../src/domain/detect.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const verbs = Det.verbForms(JSON.parse(readFileSync(path.join(ROOT, 'content/igloo/words/de.json'), 'utf8')));

// [wrong, right model, the class, true when run() with the word list's verbs gives no hint]. That last group is a gap
// main had before this change and still has (a finite modal or haben followed by a verb from the word list reads as a
// verb group there, "weil ich muss arbeiten"); the grader still marks these answers wrong, they only get no hint.
const ERSATZ_RIGHT = [
  'Ich weiß, dass ich früher hätte fragen sollen.',
  'Ich glaube, dass wir mehr hätten sparen müssen.',
  'Sie hat die Stelle abgelehnt, obwohl sie sie hätte bekommen können.',
  'Alle sind sich einig, dass die Brücke früher hätte saniert werden müssen.',
  'Er kam zu spät, weil er noch hat arbeiten müssen.',
  'Ich glaube, dass sie nicht hat mitkommen wollen.',
  'Sie erzählt, dass sie ihre Küche hat renovieren lassen.',
  'Ich glaube, dass sie es hätte sehen können.',
  'Ich weiß, dass ich ihn hätte anrufen sollen.',
  'Es tut mir leid, dass ich nicht habe kommen können.',
  'Sie ärgert sich, weil sie so lange hat warten müssen.',
  'Er sagt, dass er das Auto hat reparieren lassen.',
  'Ich bin sicher, dass ich ihn habe kommen sehen.',
  'Wir wissen, dass wir früher hätten anfangen müssen.',
  'Sie behauptet, dass sie ihn hat singen hören.',
  'Es ist schade, dass du nicht hast mitfahren dürfen.',
  'Ich glaube, dass er den Vertrag hätte unterschreiben sollen.',
  'Obwohl er hätte bleiben können, ist er gegangen.',
  'Er erzählt, dass er sich die Haare hat schneiden lassen.',
  'Ich frage mich, ob wir das hätten verhindern können.',
  'Sie war froh, dass sie ihm hatte helfen können.',
  'Man sagt, dass das Gebäude hätte abgerissen werden sollen.',
  'Wir bedauern, dass der Termin hat verschoben werden müssen.',
  'Ich bin enttäuscht, weil ich das Spiel nicht habe sehen dürfen.',
  'Er glaubt, dass er die Prüfung hätte bestehen können.',
  'Es ist klar, dass sie das wird machen müssen.',
  'Ich hoffe, dass wir es ihm werden erklären können.',
  'Sie meint, dass er gestern hat arbeiten müssen.',
  'Wenn ich hätte kommen können, wäre ich gekommen.',
  'Ich finde, dass man das Projekt früher hätte beenden müssen.',
  'Sie sagt, dass sie ihn hat weinen sehen.',
  'Ich denke, dass es so hätte sein sollen.',
  'Es ist möglich, dass er uns hat helfen wollen.',
  'Ich bin froh, dass ich ihr habe helfen können.',
  'Er ärgert sich, weil er die Rechnung früher hätte bezahlen müssen.',
  'Ich habe gehört, dass sie das Haus hat bauen lassen.',
];

const ERSATZ_WRONG = [
  ['Er kam zu spät, weil er hat gearbeitet.', 'Er kam zu spät, weil er gearbeitet hat.', 'verb-final'],
  ['Ich freue mich, weil er kann kommen.', 'Ich freue mich, weil er kommen kann.', 'verb-final', true],
  ['Ich komme später, weil ich muss arbeiten.', 'Ich komme später, weil ich arbeiten muss.', 'verb-final', true],
  ['Das geht nicht, weil ich muss arbeiten.', 'Das geht nicht, weil ich arbeiten muss.', 'verb-final', true],
  ['Ich glaube, dass er hat keine Zeit.', 'Ich glaube, dass er keine Zeit hat.', 'verb-final'],
  ['Ich weiß, dass ich habe ihn anrufen sollen.', 'Ich weiß, dass ich ihn habe anrufen sollen.', 'verb-final'],
  ['Sie meint, dass er hat gestern arbeiten müssen.', 'Sie meint, dass er gestern hat arbeiten müssen.', 'verb-final'],
  ['Ich glaube, dass er hat Kuchen essen wollen.', 'Ich glaube, dass er Kuchen hat essen wollen.', 'verb-final'],
  ['Ich glaube, dass wir hätten mehr sparen müssen.', 'Ich glaube, dass wir mehr hätten sparen müssen.', 'verb-final'],
  ['Sie erzählt, dass sie hat das Auto reparieren lassen.', 'Sie erzählt, dass sie das Auto hat reparieren lassen.', 'verb-final'],
  ['Er ist gegangen, obwohl er hätte es machen können.', 'Er ist gegangen, obwohl er es hätte machen können.', 'verb-final'],
  ['Ich weiß, dass er hat können kommen.', 'Ich weiß, dass er hat kommen können.', 'verb-final', true],
  ['Er ist traurig, weil er hat nicht können kommen.', 'Er ist traurig, weil er nicht hat kommen können.', 'verb-final'],
  ['Ich weiß, dass sie hat müssen arbeiten.', 'Ich weiß, dass sie hat arbeiten müssen.', 'verb-final', true],
  ['Ich konnte nicht kommen, weil ich habe keine Zeit gehabt.', 'Ich konnte nicht kommen, weil ich keine Zeit gehabt habe.', 'verb-final'],
  ['Es ist klar, dass er wird morgen kommen müssen.', 'Es ist klar, dass er morgen wird kommen müssen.', 'verb-final'],
  ['Es war laut, weil wir haben gefeiert.', 'Es war laut, weil wir gefeiert haben.', 'verb-final'],
  ['Ich weiß, dass ich hätte früher kommen sollen.', 'Ich weiß, dass ich früher hätte kommen sollen.', 'verb-final'],
  ['Es ist schade, dass sie hat es nicht sehen können.', 'Es ist schade, dass sie es nicht hat sehen können.', 'verb-final'],
  ['Er ist sauer, weil er hätte sollen anrufen.', 'Er ist sauer, weil er hätte anrufen sollen.', 'verb-final', true],
  ['Ich weiß, dass wir haben lange warten müssen.', 'Ich weiß, dass wir lange haben warten müssen.', 'verb-final', true],
  ['Sie lächelt, weil sie hat ihn singen hören.', 'Sie lächelt, weil sie ihn hat singen hören.', 'verb-final'],
  ['Er erzählt, dass er hat sich die Haare schneiden lassen.', 'Er erzählt, dass er sich die Haare hat schneiden lassen.', 'verb-final'],
  ['Alle sagen, dass die Brücke hätte früher saniert werden müssen.', 'Alle sagen, dass die Brücke früher hätte saniert werden müssen.', 'verb-final'],
  ['Ich weiß, dass er wird kommen.', 'Ich weiß, dass er kommen wird.', 'verb-final', true],
  ['Ich glaube, dass sie hat oben warten müssen.', 'Ich glaube, dass sie oben hat warten müssen.', 'verb-final'],
  ['Ich weiß, dass er hat den Bus verpassen müssen.', 'Ich weiß, dass er den Bus hat verpassen müssen.', 'verb-final'],
];

const WAEHREND_RIGHT = [
  'Während des Fluges habe ich einen Film gesehen.',
  'Während des Praktikums können Sie praktische Erfahrungen sammeln.',
  'Während des Essens haben wir viel gelacht.',
  'Während eines Gesprächs mit dem Chef habe ich das erfahren.',
  'Während meines Studiums habe ich in einem Café gearbeitet.',
  'Während seines Urlaubs hat er kaum geschlafen.',
  'Während ihres Aufenthalts in Berlin hat sie viele Museen besucht.',
  'Während unseres Besuchs war das Wetter schlecht.',
  'Während dieses Jahres habe ich viel gelernt.',
  'Während der Prüfung habe ich viel geschwitzt.',
  'Während der Vorlesung habe ich nichts verstanden.',
  'Während der Sitzung darf man nicht telefonieren.',
  'Während einer Pause habe ich mit ihr gesprochen.',
  'Während der Ferien arbeite ich in einem Hotel.',
  'Während des Fluges habe ich geschlafen, das war angenehm.',
  'Während des Gesprächs hat er kein Wort gesagt.',
  'Ich habe während des Konzerts mein Handy ausgeschaltet.',
  'Während des Winters fahren wir oft Ski.',
  'Während der Schulzeit war ich oft krank.',
  'Während des Unterrichts sollen die Handys ausgeschaltet bleiben.',
  'Während des Besuchs der Ministerin war die Straße gesperrt.',
  'Während des ersten Jahres meines Studiums habe ich bei meinen Eltern gewohnt.',
  'Während der Pause trinke ich Kaffee.',
  'Ich lese, während er schläft.',
  'Während er kocht, deckt sie den Tisch.',
  'Während der Lehrer spricht, hören alle zu.',
];

const WAEHREND_WRONG = [
  ['Ich habe gelesen, während er hat geschlafen.', 'Ich habe gelesen, während er geschlafen hat.', 'verb-final'],
  ['Während er kocht, sie deckt den Tisch.', 'Während er kocht, deckt sie den Tisch.', 'inversion'],
  ['Während der Chef redet, ich höre zu.', 'Während der Chef redet, höre ich zu.', 'inversion'],
  ['Ich koche, während sie deckt den Tisch.', 'Ich koche, während sie den Tisch deckt.', 'verb-final'],
  ['Während ich bin im Büro, trinke ich viel Kaffee.', 'Während ich im Büro bin, trinke ich viel Kaffee.', 'verb-final'],
  ['Er arbeitet, während seine Frau ist im Urlaub.', 'Er arbeitet, während seine Frau im Urlaub ist.', 'verb-final'],
  ['Während des Fluges, ich habe geschlafen.', 'Während des Fluges habe ich geschlafen.', 'inversion'],
  ['Während der Pause ich habe Kaffee getrunken.', 'Während der Pause habe ich Kaffee getrunken.', 'verb-final'],
  ['Während meines Studiums ich habe viel gearbeitet.', 'Während meines Studiums habe ich viel gearbeitet.', 'verb-final'],
  ['Während des Urlaubs, wir sind viel gewandert.', 'Während des Urlaubs sind wir viel gewandert.', 'inversion'],
  ['Während der Prüfung, ich war sehr nervös.', 'Während der Prüfung war ich sehr nervös.', 'inversion'],
  ['Ich höre Musik, während ich mache die Hausaufgaben.', 'Ich höre Musik, während ich die Hausaufgaben mache.', 'verb-final'],
  ['Während wir haben gegessen, hat es geregnet.', 'Während wir gegessen haben, hat es geregnet.', 'verb-final'],
  ['Sie telefoniert, während er ist beim Arzt.', 'Sie telefoniert, während er beim Arzt ist.', 'verb-final'],
  ['Während der Film läuft, wir essen Popcorn.', 'Während der Film läuft, essen wir Popcorn.', 'inversion'],
  ['Während eines Gesprächs, er hat mir alles erzählt.', 'Während eines Gesprächs hat er mir alles erzählt.', 'inversion'],
  ['Ich koche, während du musst arbeiten.', 'Ich koche, während du arbeiten musst.', 'verb-final', true],
  ['Während die Kinder spielen, die Eltern trinken Kaffee.', 'Während die Kinder spielen, trinken die Eltern Kaffee.', 'inversion'],
  ['Während des Spiels, wir haben viel geschrien.', 'Während des Spiels haben wir viel geschrien.', 'inversion'],
  ['Während meiner Ausbildung, ich habe wenig verdient.', 'Während meiner Ausbildung habe ich wenig verdient.', 'inversion'],
  ['Ich schlafe, während mein Mann muss arbeiten.', 'Ich schlafe, während mein Mann arbeiten muss.', 'verb-final', true],
  ['Er hat gelesen, während sie hat telefoniert.', 'Er hat gelesen, während sie telefoniert hat.', 'verb-final', true],
];

const COMPARE_RIGHT = [
  'Die Kernaussage des Textes ist, dass Schlaf genauso wichtig ist wie Bewegung.',
  'Ich finde, dass Schlaf genauso wichtig ist wie Bewegung.',
  'Ich glaube, dass er so ist wie sein Vater.',
  'Ich finde, dass Bahnfahren ebenso bequem ist wie Fliegen.',
  'Sie sagt, dass ihre Wohnung genauso groß ist wie meine.',
  'Ich glaube nicht, dass es so einfach ist wie früher.',
  'Er meint, dass das neue Handy genauso teuer ist wie das alte.',
  'Ich hoffe, dass der Urlaub so schön wird wie letztes Jahr.',
  'Es stimmt, dass Homeoffice genauso anstrengend sein kann wie das Büro.',
  'Ich weiß, dass sie so gut Deutsch spricht wie ihr Bruder.',
  'Ich finde, dass Schlaf wichtiger ist als Essen.',
  'Ich bin oft geflogen, weil der Flug billiger war als der Zug.',
  'Ich glaube, dass die Bahn schneller ist als das Auto.',
  'Viele sagen, dass das Leben in der Stadt teurer ist als auf dem Land.',
  'Ich finde, dass man im Alltag mehr lernt als im Kurs.',
  'Es ist klar, dass Kinder weniger schlafen als Erwachsene.',
  'Er sagt, dass er lieber liest als fernsieht.',
  'Ich denke, dass Busfahren besser ist als Autofahren.',
  'Sie meint, dass ihr Job interessanter ist als früher.',
  'Ich hoffe, dass es heute wärmer wird als gestern.',
  'Ich weiß, dass sie älter ist als ich.',
  'Ich glaube, dass es so ist, wie ich gedacht habe.',
  'Ich glaube, dass es genauso ist, wie du gesagt hast.',
];

const COMPARE_WRONG = [
  ['Ich finde, dass Schlaf ist genauso wichtig wie Bewegung.', 'Ich finde, dass Schlaf genauso wichtig ist wie Bewegung.', 'verb-final'],
  ['Ich glaube, dass er ist wie sein Vater.', 'Ich glaube, dass er wie sein Vater ist.', 'verb-final'],
  ['Ich finde, dass Schlaf ist wichtiger als Essen.', 'Ich finde, dass Schlaf wichtiger ist als Essen.', 'verb-final'],
  ['Ich weiß, dass er arbeitet als Lehrer.', 'Ich weiß, dass er als Lehrer arbeitet.', 'verb-final'],
  ['Ich glaube, dass die Bahn ist schneller als das Auto.', 'Ich glaube, dass die Bahn schneller ist als das Auto.', 'verb-final'],
  ['Ich bin oft geflogen, weil der Flug war billiger als der Zug.', 'Ich bin oft geflogen, weil der Flug billiger war als der Zug.', 'verb-final'],
  ['Sie sagt, dass ihre Wohnung ist so groß wie meine.', 'Sie sagt, dass ihre Wohnung so groß ist wie meine.', 'verb-final'],
  ['Ich weiß, dass sie ist älter als ich.', 'Ich weiß, dass sie älter ist als ich.', 'verb-final'],
  ['Er meint, dass das neue Handy ist genauso teuer wie das alte.', 'Er meint, dass das neue Handy genauso teuer ist wie das alte.', 'verb-final'],
  ['Ich denke, dass Busfahren ist besser als Autofahren.', 'Ich denke, dass Busfahren besser ist als Autofahren.', 'verb-final'],
  ['Ich hoffe, dass es wird wärmer als gestern.', 'Ich hoffe, dass es wärmer wird als gestern.', 'verb-final'],
  ['Ich fahre gern Zug, weil Bahnfahren ist ebenso bequem wie Fliegen.', 'Ich fahre gern Zug, weil Bahnfahren ebenso bequem ist wie Fliegen.', 'verb-final'],
  ['Ich weiß, dass er damals arbeitete als Kellner.', 'Ich weiß, dass er damals als Kellner arbeitete.', 'verb-final'],
  ['Ich weiß, dass er leider arbeitet als Kellner.', 'Ich weiß, dass er leider als Kellner arbeitet.', 'verb-final'],
  ['Ich glaube, dass er wieder ist wie früher.', 'Ich glaube, dass er wieder wie früher ist.', 'verb-final'],
  ['Ich glaube, dass Deutsch ist schwerer als Englisch.', 'Ich glaube, dass Deutsch schwerer ist als Englisch.', 'verb-final'],
  ['Er sagt, dass sein Auto ist so schnell wie meins.', 'Er sagt, dass sein Auto so schnell ist wie meins.', 'verb-final'],
  ['Ich finde, dass Kaffee ist genauso gut wie Tee.', 'Ich finde, dass Kaffee genauso gut ist wie Tee.', 'verb-final'],
  ['Ich weiß, dass Berlin ist größer als München.', 'Ich weiß, dass Berlin größer ist als München.', 'verb-final'],
  ['Sie meint, dass Lesen ist besser als Fernsehen.', 'Sie meint, dass Lesen besser ist als Fernsehen.', 'verb-final'],
  ['Viele sagen, dass das Leben ist teurer in der Stadt als auf dem Land.', 'Viele sagen, dass das Leben in der Stadt teurer ist als auf dem Land.', 'verb-final'],
];

const RIGHT = [...ERSATZ_RIGHT, ...WAEHREND_RIGHT, ...COMPARE_RIGHT];
const WRONG = [...ERSATZ_WRONG, ...WAEHREND_WRONG, ...COMPARE_WRONG];

test('B2 word order: right German is never flagged', () => {
  for (const s of RIGHT) {
    assert.deepEqual(Det.classes(s, null), [], `classes, no model: ${s}`);
    assert.deepEqual(Det.classes(s, s), [], `classes, model: ${s}`);
    assert.equal(Det.run(s, { model: s }, null, { verbs }), null, `run with the word list: ${s}`);
    assert.equal(Det.run(s, { model: s }), null, `run: ${s}`);
  }
  assert.ok(ERSATZ_RIGHT.length >= 28 && WAEHREND_RIGHT.length >= 20 && COMPARE_RIGHT.length >= 20);
});

test('B2 word order: the wrong German next to it is still flagged', () => {
  for (const [w, m, cls, verbGap] of WRONG) {
    assert.ok(Det.classes(w, m).includes(cls), `classes: ${w}`);
    assert.equal(Det.run(w, { model: m })?.cls, cls, `run: ${w}`);
    if (!verbGap) assert.equal(Det.run(w, { model: m }, null, { verbs })?.cls, cls, `run with the word list: ${w}`);
    assert.equal(Det.run(m, { model: m }, null, { verbs }), null, `its model is right: ${m}`);
  }
  // the errors the handoff names
  for (const w of ['Er kam zu spät, weil er hat gearbeitet.', 'Ich freue mich, weil er kann kommen.', 'Das geht nicht, weil ich muss arbeiten.', 'Ich glaube, dass er hat keine Zeit.'])
    assert.deepEqual(Det.classes(w, null), ['verb-final'], w);
  assert.ok(ERSATZ_WRONG.length >= 20 && WAEHREND_WRONG.length >= 20 && COMPARE_WRONG.length >= 20);
});

test('B2 word order: validate_b1.py agrees with detect.js', () => {
  const cases = [...RIGHT.flatMap(s => [[s, null], [s, s]]), ...WRONG.flatMap(([w, m]) => [[w, null], [w, m], [m, m]])];
  const py = `import json,sys\nsys.path.insert(0, ${JSON.stringify(path.join(ROOT, 'tools'))})\nfrom validate_b1 import detect\nprint(json.dumps([sorted(detect(a, m)) for a, m in json.load(sys.stdin)]))`;
  const out = spawnSync('python3', ['-c', py], { input: JSON.stringify(cases), encoding: 'utf8', timeout: 120_000, killSignal: 'SIGKILL', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
  assert.ifError(out.error);
  assert.equal(out.status, 0, out.stderr || `python3 ended by ${out.signal}`);
  const want = JSON.parse(out.stdout);
  const bad = cases.map(([a, m], i) => [a, m, Det.classes(a, m), want[i]]).filter(([, , js, p]) => JSON.stringify(js) !== JSON.stringify(p));
  assert.deepEqual(bad, [], 'detect.js and validate_b1.detect disagree');
});
