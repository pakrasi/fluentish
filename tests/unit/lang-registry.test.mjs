// The language registry (src/lang/registry.js) and the pack seam (Wave C2): every manifest language is listed with
// its tag, script and direction; German is the one full pack; core/lang.js sets and exposes the active pack; and the
// engines read their language knowledge from the pack they are given, nothing else.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LANGUAGES, PACKS, DEFAULT_PACK, packFor, languageMeta, activePack, setActivePack } from '../../src/lang/registry.js';
import de from '../../src/lang/de/index.js';
import { setLanguage, pack, packFor as corePackFor, languages, LANGS, bcp47, dirAttr } from '../../src/core/lang.js';
import * as Match from '../../src/domain/match.js';
import Det from '../../src/domain/detect.js';
import { punctCheck } from '../../src/domain/punct.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const manifest = JSON.parse(readFileSync(path.join(ROOT, 'content/manifest.json'), 'utf8'));
const SCRIPT = { latin: 'Latn', devanagari: 'Deva', bengali: 'Beng', arabic: 'Arab' };

afterEach(() => setLanguage('german'));

test('registry: the ten manifest languages, with their tag, script and direction; German is the only full pack', () => {
  assert.deepEqual(LANGUAGES.map(l => l.legacyId).sort(), manifest.languages.map((/** @type {any} */ l) => l.id).sort());
  for (const m of manifest.languages) {
    const l = languageMeta(m.id);
    assert.ok(l, m.id);
    assert.equal(l.name, m.name); assert.equal(l.native, m.native);
    assert.equal(l.script, SCRIPT[/** @type {keyof typeof SCRIPT} */ (m.script)], `${m.id} script`);
    assert.equal(l.dir, m.rtl ? 'rtl' : 'ltr', `${m.id} direction`);
    assert.equal(l.full, m.content, `${m.id}: a full pack exactly where the manifest has content`);
    assert.match(l.bcp47, new RegExp(`^${l.id}-[A-Z]{2}$`));
    assert.ok(l.speech.tts.locales.includes(l.bcp47));
  }
  assert.equal(new Set(LANGUAGES.map(l => l.id)).size, 10);
  assert.deepEqual(Object.keys(PACKS), ['de']);
  assert.equal(DEFAULT_PACK, de);
  assert.equal(languageMeta('kha')?.speech.asr, null, 'no recogniser has Khasi');
  assert.equal(languageMeta('gsw')?.speech.asr?.locale, 'de-CH');
});

test('registry: packFor and the active pack; a language without a full pack keeps German', () => {
  assert.equal(packFor('de'), de); assert.equal(packFor('german'), de);
  assert.equal(packFor('fr'), null); assert.equal(packFor('nonsense'), null);
  assert.equal(setActivePack('arabic'), de);
  assert.equal(setActivePack(null), de);
  assert.equal(activePack(), de);
});

test('core/lang: the table comes from the registry; setLanguage sets the pack; pack() and languages() expose it', () => {
  for (const l of LANGUAGES) {
    assert.equal(LANGS[l.legacyId].bcp47, l.bcp47); assert.equal(LANGS[l.legacyId].code, l.id); assert.equal(LANGS[l.legacyId].dir, l.dir);
    assert.equal(LANGS[l.legacyId].content, l.full);
  }
  assert.equal(LANGS.arabic.dir, 'rtl'); assert.equal(LANGS.swissgerman.asr, 'de-CH'); assert.equal(LANGS.english.bcp47, 'en-GB');
  setLanguage('german');
  assert.equal(pack(), de); assert.equal(activePack(), de);
  assert.equal(corePackFor('german'), de);
  assert.equal(languages().length, 10);
  setLanguage('french');   // metadata only: German stays active everywhere
  assert.equal(pack(), de); assert.deepEqual([bcp47(), dirAttr()], ['de-DE', 'ltr']);
});

test('pack seam: naming the German pack is the same as the default, for every engine', () => {
  const acc = ['ich habe [x] keine zeit', 'leider habe ich keine zeit'];
  for (const a of ['Leider habe ich heute keine Zeit.', 'leider hab ich keine zet', 'Ich habe kein Zeit', 'Ich hatte keine Zeit']) {
    assert.deepEqual(Match.check(a, acc, { pack: de }), Match.check(a, acc));
    assert.deepEqual(Match.check(a, acc, { pack: de, endings: true, umlaut: true }), Match.check(a, acc, { endings: true, umlaut: true }));
    assert.deepEqual(Match.restCheck(a, 'Leider habe ich heute keine Zeit.', acc, { pack: de }), Match.restCheck(a, 'Leider habe ich heute keine Zeit.', acc));
    assert.deepEqual(Match.formCheck(a, 'Leider habe ich keine Zeit.', { pack: de }), Match.formCheck(a, 'Leider habe ich keine Zeit.'));
    assert.deepEqual(Det.run(a, {}, null, {}, de), Det.run(a));
  }
  assert.deepEqual(Match.alsoLines('Leider habe ich keine Zeit.', acc, null, null, false, de), Match.alsoLines('Leider habe ich keine Zeit.', acc));
  assert.deepEqual(punctCheck('Ich hoffe dass es geht.', ['comma-before:dass'], {}, de), punctCheck('Ich hoffe dass es geht.', ['comma-before:dass']));
});

test('pack seam: the engines use the pack they are given, and only for that call', () => {
  // the same rules with no closed-class words and no detectors: articles may now be typos, nothing is detected
  const bare = { ...de, id: 'xx', grading: { ...de.grading, closedClass: new Set() }, grammar: { ...de.grammar, detectors: [] } };
  const acc = ['der Ball liegt zwischen den Autos'];
  const typo = 'der Ball liegt zwichen den Autos';
  assert.equal(Match.check(typo, acc).ok, false, 'German: zwischen is closed-class, never a typo');
  assert.equal(Match.check(typo, acc, { pack: /** @type {any} */ (bare) }).ok, true, 'without closed-class words it is a typo');
  assert.equal(Match.check(typo, acc).ok, false, 'the next call is German again');
  const weil = 'Ich komme nicht, weil ich muss arbeiten.';
  assert.equal(Det.run(weil)?.cls, 'verb-final');
  assert.equal(Det.run(weil, {}, null, {}, /** @type {any} */ (bare)), null);
  // a nested call (restCheck → check) stays in the caller's pack
  assert.equal(Match.restCheck(typo, 'Der Ball liegt zwischen den Autos.', acc, { pack: /** @type {any} */ (bare) }).status, 'ok');
  assert.equal(Match.restCheck(typo, 'Der Ball liegt zwischen den Autos.', acc).status, 'differs');
});
