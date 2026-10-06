// The language-pack text contract (src/lang/types.js TextRules), as specs: German and French (the full packs; French
// since C3b: elision, accents that carry meaning) and the text-only stubs for Hindi (Devanagari conjuncts, nukta, typing in Latin) and
// Arabic (RTL, harakat, tatweel, alef variants). A pack for one of these languages must pass its cases unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import de from '../../src/lang/de/index.js';
import frPack from '../../src/lang/fr/index.js';
import * as hi from '../../src/lang/hi/text.js';
import * as ar from '../../src/lang/ar/text.js';
import { languageMeta } from '../../src/lang/registry.js';

const TEXT = {
  de: de.text,
  fr: frPack.text,
  hi: { normalize: hi.normalize, tokenize: hi.tokenize, fold: hi.fold, wordRe: hi.WORD_RE },
  ar: { normalize: ar.normalize, tokenize: ar.tokenize, fold: ar.fold, wordRe: ar.WORD_RE },
};
const raws = (/** @type {any} */ T, /** @type {string} */ s) => T.tokenize(T.normalize(s)).map((/** @type {any} */ t) => t.raw);
const keys = (/** @type {any} */ T, /** @type {string} */ s) => T.tokenize(T.normalize(s)).map((/** @type {any} */ t) => t.n);

// sentences every pack's contract runs on (its own script, punctuation and marks)
const SAMPLES = {
  de: ['Liebe Grüße, Straße!', '„Geht’s dir gut?“, fragte sie.', 'Ich möchte gerne ein Café-Besuch – 3x.'],
  fr: ['L’ami de Zoé ? Il est là !', 'Jusqu’à demain, d’accord ; aujourd’hui c’est « fermé ».', 'Le cœur où il habite.'],
  hi: ['क्या आप ठीक हैं?', 'मैं ठीक हूँ। आप?', 'क़िला और क़लम', 'क्‍ष और क्‌ष'],
  ar: ['مرحبا، كيف حالك؟', 'كَتَبَ الطالبُ الدرسَ.', 'أنا أحب Berlin جدًا ٣ مرات؛ نعم'],
};

/* ---- the universal contract ---- */
for (const [id, T] of Object.entries(TEXT)) {
  test(`text contract (${id}): normalize is NFC and idempotent; tokens are offsets into the input, in order`, () => {
    for (const s of SAMPLES[/** @type {keyof typeof SAMPLES} */ (id)]) {
      const n = T.normalize(s);
      assert.equal(n, n.normalize('NFC'), 'NFC');
      assert.equal(T.normalize(n), n, 'idempotent');
      assert.equal(T.normalize(s.normalize('NFD')), n, 'the same text decomposed normalises to the same string');
      const toks = T.tokenize(n);
      assert.ok(toks.length > 0);
      let end = -1;
      for (const t of toks) {
        assert.equal(n.slice(t.start, t.end), t.raw, `offsets of ${t.raw}`);
        assert.ok(t.start >= end, 'in logical order, never overlapping');
        end = t.end;
        assert.ok(!/^[\p{M}‌‍]/u.test(t.raw), `${t.raw}: never starts with a mark (a split grapheme)`);
        assert.ok(!/^[\p{M}‌‍]/u.test(n.slice(t.end)), `${t.raw}: never ends before its own mark`);
        assert.ok(!/[.,;:!?…«»„“”"।॥،؛؟–]/u.test(t.raw), `${t.raw}: no punctuation inside a word`);
        assert.equal(typeof t.n, 'string'); assert.ok(t.len > 0);
      }
      // offset shifts every token
      assert.deepEqual(T.tokenize(n, 10).map((/** @type {any} */ t) => t.start), toks.map((/** @type {any} */ t) => t.start + 10));
      // wordRe matches what tokenize returns
      assert.deepEqual([...n.matchAll(T.wordRe)].map(m => m[0]), toks.map((/** @type {any} */ t) => t.raw));
      // fold is idempotent; the key does not depend on how the input was composed
      assert.equal(T.fold(T.fold(n)), T.fold(n));
      assert.deepEqual(keys(T, s.normalize('NFD')), keys(T, s));
    }
  });
}

/* ---- German: the full pack ---- */
test('de: umlauts and ß fold to ae/oe/ue/ss; other accents are ignored; gern = gerne; case is kept by fold', () => {
  const T = TEXT.de;
  assert.deepEqual(keys(T, 'Grüße Straße Café gerne Gern'), ['gruesse', 'strasse', 'cafe', 'gern', 'gern']);
  assert.equal(T.fold('Äpfel'), 'Aepfel');
  assert.deepEqual(raws(T, "Geht’s dir gut? E-Mail"), ["Geht's", 'dir', 'gut', 'E-Mail']);
  const m = languageMeta('de');
  assert.deepEqual([m?.script, m?.dir, de.grading.caseSensitive], ['Latn', 'ltr', 'nouns']);
});

/* ---- French (the full pack, C3b): elision, accents that carry meaning ---- */
test('fr: elision splits off the article or pronoun; a lexicalised apostrophe stays one word', () => {
  assert.deepEqual(raws(TEXT.fr, "L’ami qu’il voit"), ["L'", 'ami', "qu'", 'il', 'voit']);
  assert.deepEqual(raws(TEXT.fr, "jusqu’à d’accord c’est s’il"), ["jusqu'", 'à', "d'", 'accord', "c'", 'est', "s'", 'il']);
  assert.deepEqual(raws(TEXT.fr, "aujourd’hui quelqu’un"), ["aujourd'hui", "quelqu'un"]);
});
test('fr: accents are part of the key (ou ≠ où, a ≠ à); œ is typed oe; typographic spaces are plain spaces', () => {
  const [ou, ou2, a, a2] = keys(TEXT.fr, 'ou où a à');
  assert.notEqual(ou, ou2); assert.notEqual(a, a2);
  assert.deepEqual(keys(TEXT.fr, 'cœur Été'), keys(TEXT.fr, 'coeur été'));
  assert.equal(TEXT.fr.normalize('Ça va ?'), 'Ça va ?');
  assert.deepEqual(raws(TEXT.fr, '« Oui »'), ['Oui']);
  const m = languageMeta('fr');
  assert.deepEqual([m?.script, m?.dir, m?.full, frPack.grading.caseSensitive], ['Latn', 'ltr', true, 'proper']);
});

/* ---- Hindi (stub): Devanagari, nukta, transliteration ---- */
test('hi: conjuncts, nasal marks and ZWJ/ZWNJ stay inside a word; the danda is punctuation', () => {
  assert.deepEqual(raws(TEXT.hi, 'क्या आप ठीक हैं?'), ['क्या', 'आप', 'ठीक', 'हैं']);
  assert.deepEqual(raws(TEXT.hi, 'मैं ठीक हूँ। आप?'), ['मैं', 'ठीक', 'हूँ', 'आप']);
  assert.deepEqual(raws(TEXT.hi, 'क्‍ष'), ['क्‍ष'], 'ZWJ inside a conjunct');
  assert.deepEqual(keys(TEXT.hi, 'क्‍ष'), keys(TEXT.hi, 'क्ष'), 'the key drops ZWJ');
});
test('hi: a nukta letter is one spelling, precomposed or not', () => {
  assert.deepEqual(keys(TEXT.hi, 'क़िला'), keys(TEXT.hi, 'क़िला'));
});
test('hi: typing in Latin gives Devanagari candidates; the script has no case', () => {
  assert.deepEqual(hi.transliterate('kya'), ['क्या']);
  assert.ok(hi.transliterate('main').includes('मैं'));
  assert.deepEqual(hi.transliterate('xyzzy'), []);
  for (const c of [...hi.transliterate('hain'), ...hi.transliterate('theek')]) assert.ok(/^[ऀ-ॿ]+$/u.test(c));
  const m = languageMeta('hindi');
  assert.deepEqual([m?.id, m?.script, m?.dir, m?.fonts.ui], ['hi', 'Deva', 'ltr', 'var(--font-devanagari)']);
});

/* ---- Arabic (stub): RTL, harakat, tatweel, alef variants ---- */
test('ar: harakat and tatweel are not part of the key; alef variants and alef maqsura are one letter', () => {
  assert.deepEqual(keys(TEXT.ar, 'كَتَبَ'), keys(TEXT.ar, 'كتب'));
  assert.deepEqual(keys(TEXT.ar, 'كـتـب'), keys(TEXT.ar, 'كتب'));
  assert.deepEqual(keys(TEXT.ar, 'أحمد إلى آخر'), keys(TEXT.ar, 'احمد الي اخر'));
  assert.deepEqual(raws(TEXT.ar, 'كَتَبَ'), ['كَتَبَ'], 'the word as written keeps its marks');
});
test('ar: Arabic punctuation splits words; text stays in logical order with a Latin word inside; RTL is metadata', () => {
  assert.deepEqual(raws(TEXT.ar, 'مرحبا، كيف حالك؟'), ['مرحبا', 'كيف', 'حالك']);
  assert.deepEqual(raws(TEXT.ar, 'أنا أحب Berlin ٣ مرات؛ نعم'), ['أنا', 'أحب', 'Berlin', '٣', 'مرات', 'نعم']);
  assert.deepEqual(raws(TEXT.ar, 'والكتاب'), ['والكتاب'], 'clitics stay attached');
  const m = languageMeta('arabic');
  assert.deepEqual([m?.id, m?.script, m?.dir, m?.speech.tts.locales[0]], ['ar', 'Arab', 'rtl', 'ar-SA']);
});

/* ---- optional parts (round 4, C0): a pack is valid without them; when it has one, it has the documented shape ---- */
import { PACKS } from '../../src/lang/registry.js';
/** Checks of the optional parts of a pack (src/lang/types.js): absent is valid; present must have the shape. @param {any} p */
function optionalPartErrors(p) {
  const out = [];
  const lemma = p.grammar?.morphology?.lemma;
  if (lemma !== undefined && typeof lemma !== 'function') out.push('grammar.morphology.lemma: not a function');
  if (p.reading !== undefined) {
    const r = p.reading;
    if (!(r && r.stop instanceof Set)) out.push('reading.stop: not a Set');
    if (!(r && (r.cognate === null || r.cognate instanceof RegExp))) out.push('reading.cognate: not a RegExp or null');
    if (!(r && r.spelling && typeof r.spelling === 'object')) out.push('reading.spelling: not an object');
    if (!(r && Array.isArray(r.constructions) && r.constructions.every((/** @type {any} */ c) => c && typeof c.id === 'string' && typeof c.test === 'function'))) out.push('reading.constructions: not a list of {id, test}');
  }
  if (p.conversation !== undefined) {
    const c = p.conversation;
    if (!(c && typeof c.language === 'string' && c.language)) out.push('conversation.language: missing');
    if (!(c && c.register && typeof c.register === 'object')) out.push('conversation.register: missing');
    if (!(c && Array.isArray(c.connectors) && Array.isArray(c.chips))) out.push('conversation.connectors/chips: not lists');
  }
  for (const k of ['read', 'conversation']) if (p.content?.[k] !== undefined && typeof p.content[k] !== 'string') out.push(`content.${k}: not a content id`);
  return out;
}

for (const [id, pack] of Object.entries(PACKS)) {
  test(`optional pack parts (${id}): the pack is valid as it is, and without reading, conversation and lemma`, () => {
    assert.deepEqual(optionalPartErrors(pack), []);
    const bare = { ...pack, reading: undefined, conversation: undefined, content: { ...pack.content },
      grammar: { ...pack.grammar, morphology: pack.grammar.morphology ? { ...pack.grammar.morphology, lemma: undefined } : null } };
    delete bare.content.read; delete bare.content.conversation;
    assert.deepEqual(optionalPartErrors(bare), [], 'absent is valid');
    // the engines do not need them: text and grading work on the bare pack
    assert.ok(bare.text.tokenize(bare.text.normalize('a b')).length >= 1);
  });
}
test('optional pack parts: a malformed part is reported', () => {
  const bad = { ...de, reading: { stop: [], cognate: 'x', spelling: null, constructions: [{}] }, conversation: { language: '' }, content: { ...de.content, read: 3 },
    grammar: { ...de.grammar, morphology: { ...de.grammar.morphology, lemma: 'no' } } };
  assert.equal(optionalPartErrors(bad).length, 9);
});
