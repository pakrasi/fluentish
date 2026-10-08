// Word families and Today's family (round 7): domain/wordbuild-family.js. The model from a synthetic build content
// (two roots, their verbs and chains, and a families key in the content lane's shape), the board (deterministic,
// due first, new words inside the allowance, no write on a known word that is not due), judging a build, the grades,
// the merge of two devices' logs, PF: ids and the resolver. All data synthetic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as F from '../../src/domain/wordbuild-family.js';
import { cardIds, itemResolver, lemmaMaps, pfIds } from '../../src/domain/wordbuild.js';
import { shownToday, streamOf, composeRound } from '../../src/domain/wordbuild-plan.js';
import { tagOf, kindOf } from '../../src/domain/itemids.js';

const V = (/** @type {string} */ root, /** @type {string} */ pre, /** @type {'s'|'i'} */ kind, /** @type {any} */ o = {}) => ({
  id: pre + root, root, pre, inf: pre + root, kind, grade: 'T', how: 'lit', en: `${pre}-${root}`, why: 'x', ex: 'x.', exEn: 'x', aux: 'hat', pp: 'x', lemma: `${pre}${root}.verb`, level: 'B1', ...o });
/** @returns {any} */
const content = () => ({
  version: 1,
  prefixes: ['auf', 'aus', 'ein', 'vor', 'ab', 'an', 'zu', 'be', 'ver', 'er', 'zer', 'um'].map(id => ({ id, kind: ['be', 'ver', 'er', 'zer'].includes(id) ? 'i' : id === 'um' ? 'd' : 's' })),
  roots: [{ id: 'stellen', lemma: 'stellen.verb', en: 'put, place', pres3: 'stellt', pret: 'stellte', aux: 'hat', pp: 'gestellt' },
    { id: 'legen', lemma: 'legen.verb', en: 'lay', pres3: 'legt', pret: 'legte', aux: 'hat', pp: 'gelegt' }],
  verbs: [
    V('stellen', 'aus', 's', { en: 'exhibit', zipf: 3.5 }), V('stellen', 'ein', 's', { en: 'hire', grade: 'M', how: 'pic' }), V('stellen', 'vor', 's', { en: 'introduce', level: 'A2' }),
    V('stellen', 'auf', 's', { en: 'set up' }), V('stellen', 'ab', 's', { en: 'park' }), V('stellen', 'an', 's', { en: 'employ' }), V('stellen', 'zu', 's', { en: 'deliver', level: 'B2' }),
    V('stellen', 'be', 'i', { en: 'order', grade: 'O', how: 'word', level: 'A1' }), V('stellen', 'ver', 'i', { en: 'adjust wrongly', level: 'B2' }), V('stellen', 'er', 'i', { en: 'create' }),
    V('legen', 'aus', 's', { en: 'lay out' }), V('legen', 'auf', 's', { en: 'hang up' }), V('legen', 'ein', 's', { en: 'insert' }), V('legen', 'vor', 's', { en: 'present' }),
    V('legen', 'ab', 's', { en: 'take off' }), V('legen', 'an', 's', { en: 'invest' }), V('legen', 'zu', 's', { en: 'put on weight' }), V('legen', 'be', 'i', { en: 'prove' }),
  ],
  frames: [], suffixes: [{ id: 'ung', cls: 'noun', art: 'die' }, { id: 'er', cls: 'noun', art: 'der' }, { id: 'bar', cls: 'adj', art: null }],
  chains: [{ id: 'stellen', title: 'stellen', nodes: [
    { id: 'n0', word: 'stellen', cls: 'verb', en: 'put' },
    { id: 'n1', from: 'n0', add: 'aus', side: 'pre', word: 'ausstellen', cls: 'verb', en: 'exhibit' },
    { id: 'n2', from: 'n1', add: 'ung', side: 'suf', word: 'Ausstellung', art: 'die', cls: 'noun', en: 'exhibition', lemma: 'die_Ausstellung' },
    { id: 'n3', from: 'n1', add: 'er', side: 'suf', word: 'Aussteller', art: 'der', cls: 'noun', en: 'exhibitor' },
    { id: 'n4', from: 'n0', add: 'be', side: 'pre', word: 'bestellen', cls: 'verb', en: 'order' },
    { id: 'n5', from: 'n4', add: 'ung', side: 'suf', word: 'Bestellung', art: 'die', cls: 'noun', en: 'order' },
  ] }, { id: 'vorstellen', title: 'vorstellen', nodes: [
    { id: 'n0', word: 'vorstellen', cls: 'verb', en: 'introduce' },
    { id: 'n1', from: 'n0', add: 'ung', side: 'suf', word: 'Vorstellung', art: 'die', cls: 'noun', en: 'performance' },
    { id: 'n2', from: 'n0', add: 'bar', side: 'suf', word: 'vorstellbar', cls: 'adj', en: 'imaginable' },
    { id: 'n3', from: 'n2', add: 'un', side: 'pre', word: 'unvorstellbar', cls: 'adj', en: 'unimaginable' },
  ] }],
});
/** The content lane's families key (FAMILY-SCHEMA shape): new forms, a clue for a form the model has, a non-word. */
const families = () => [{ root: 'stellen', forms: [
  { id: 'herstellen.verb', parent: 'root', add: 'her', side: 'pre', word: 'herstellen', cls: 'verb', kind: 's', grade: 'M', en: 'manufacture', clue: 'to manufacture', level: 'B1', lemma: 'herstellen.verb' },
  { id: 'der_Hersteller', parent: 'herstellen.verb', add: 'er', side: 'suf', word: 'Hersteller', art: 'der', cls: 'noun', grade: 'T', en: 'manufacturer', clue: 'the manufacturer', level: 'B2', lemma: 'der_Hersteller' },
  { id: 'die_Bestellung', word: 'Bestellung', cls: 'noun', parent: 'bestellen', clue: 'the order (you placed)', ex: 'Die Bestellung kommt morgen.' },
], none: ['zerstellen'] }];
const withFamilies = () => ({ ...content(), families: families() });
const DAY = '2026-10-08';
const isDue = (/** @type {any} */ r) => r.due <= DAY;
/** A card record: answered before, due on `due`. @param {string} due */
const rec = (due, o = {}) => ({ S: 5, D: 5, reps: 3, lapses: 0, last: '2026-10-01', first: '2026-09-20', due, learn: null, relearn: false, stage: 0, streak: 0, hist: [['2026-10-01', 3, 2000, 't', '']], ...o });

test('the model: a root, its verbs, the chains that grow from it, and the families key', () => {
  const m = F.familyModel(withFamilies());
  const st = /** @type {F.Family} */ (m.get('stellen'));
  assert.equal(st.stem, 'stell');
  assert.equal(st.forms[0].id, 'stellen', 'the root first');
  const by = (/** @type {string} */ id) => /** @type {F.Form} */ (st.byId.get(id));
  assert.equal(by('ausstellen').card, 'PV:ausstellen');
  assert.equal(by('die_Ausstellung').card, 'PW:Ausstellung');
  assert.equal(by('die_Ausstellung').parent, 'ausstellen', 'a chain word hangs under its verb');
  assert.equal(by('die_Ausstellung').key, 'aus|ung');
  assert.equal(by('die_Vorstellung').parent, 'vorstellen', 'a chain that starts at a verb of the root joins under it');
  assert.equal(by('unvorstellbar').key, null, 'two prefixes: not on a board');
  assert.equal(by('unvorstellbar').card, null, 'no card of its own');
  assert.deepEqual(F.piecesOf(by('unvorstellbar')).pre, ['un', 'vor'], 'pieces read from the front');
  // families: a new form gets PF: (its authored id), a form that has a card only gains fields
  assert.equal(by('der_Hersteller').card, 'PF:der_Hersteller');
  assert.equal(by('herstellen.verb').card, 'PF:herstellen.verb');
  assert.equal(by('der_Hersteller').parent, 'herstellen.verb');
  assert.equal(by('die_Bestellung').card, 'PW:Bestellung', 'a PW card exists: no PF card for it');
  assert.equal(by('die_Bestellung').clue, 'the order (you placed)');
  assert.deepEqual(st.none, ['zerstellen']);
  // joints and stress
  assert.equal(by('ausstellen').join, 's'); assert.equal(by('ausstellen').stress, 'pre');
  assert.equal(by('bestellen').join, 'i'); assert.equal(by('bestellen').stress, 'stem');
  assert.equal(by('die_Ausstellung').stress, 'pre', 'a noun from a separable verb keeps the stress on the prefix');
  assert.equal(by('die_Bestellung').stress, 'stem');
  assert.deepEqual(F.piecesOf(by('die_Ausstellung')), { pre: ['Aus'], base: 'stell', tail: '', suf: ['ung'] });
  assert.deepEqual(F.piecesOf(by('ausstellen')), { pre: ['aus'], base: 'stell', tail: 'en', suf: [] });
});

test('PF: ids: tag, stream, resolver, the ledger; nothing changes without a families key', () => {
  assert.equal(tagOf('PF:der_Hersteller'), 'PF');
  assert.equal(kindOf('PF:der_Hersteller')?.area, 'build');
  assert.equal(streamOf('PF:der_Hersteller'), 'sx');
  assert.deepEqual(pfIds(content()), [], 'the existing content creates no PF card');
  assert.deepEqual(cardIds(content()), cardIds({ ...content(), families: [] }), 'and its card ids are the same');
  // PF ids are listed apart (familyCardIds / pfIds, the ledger adds them); cardIds stays the PX…PW cards
  const ids = pfIds(withFamilies());
  assert.ok(ids.includes('PF:der_Hersteller') && ids.includes('PF:herstellen.verb'));
  assert.ok(!ids.some(id => id === 'PF:die_Bestellung'), 'one item, one build card');
  // id stability: the same content gives the same ids in the same order, and ids are the authored form ids
  assert.deepEqual(pfIds(withFamilies()), ids);
  assert.ok(!cardIds(withFamilies()).some(id => id.startsWith('PF:')));
  const r = itemResolver(lemmaMaps(withFamilies()));
  assert.equal(r('PF:der_Hersteller'), 'W:der_Hersteller');
  assert.equal(r('PF:unlisted_form'), 'PF:unlisted_form');
  assert.equal(r('PW:Ausstellung'), 'W:die_Ausstellung');
});

test('the shipped content: every root has a family and a board; PF ids only from a families key', async () => {
  const c = JSON.parse(readFileSync(new URL('../../content/build/de.json', import.meta.url), 'utf8'));
  const m = F.familyModel(c);
  assert.ok(m.size >= c.roots.length, 'a family for every build root (and the families key\'s own roots)');
  for (const r of c.roots) assert.ok(m.has(r.id), r.id);
  for (const fam of m.values()) {
    assert.ok(fam.forms.filter(f => f.card && f.key).length >= 6, `${fam.root} has a board`);
    for (const f of fam.forms) if (f.card) assert.match(f.card, /^P[VWF]:/);
  }
  const { familyCardIds } = await import('../../src/domain/wordbuild.js');
  assert.deepEqual(new Set(pfIds(c)), new Set(familyCardIds(c)), 'the model\'s PF cards are the content\'s');
  const b = F.boardFor({ families: m, cards: {}, day: DAY, level: 'B1', newLeft: 3, isDue });
  assert.ok(b && b.cards.length >= 6);
  // every family has a board at every level, and every board word can be built from the tiles
  for (const level of ['A2', 'B1', 'B2']) for (const fam of m.values()) {
    const x = F.boardFor({ families: m, cards: {}, day: DAY, level, newLeft: 3, isDue, root: fam.root });
    assert.ok(x && x.cards.length >= 6, `${level} ${fam.root}`);
    for (const id of x.cards) { const f = /** @type {F.Form} */ (fam.byCard.get(id)); assert.ok(f.key, id); if (f.pre[0]) assert.ok(x.tiles.pre.includes(f.pre[0]), `${fam.root} ${id}`); if (f.suf[0]) assert.ok(x.tiles.suf.includes(f.suf[0]), `${fam.root} ${id}`); }
    assert.ok(x.tiles.pre.length <= 10);
  }
});

test('the board is the same for the same day and inputs, and the root changes with the day', () => {
  const m = F.familyModel(withFamilies());
  const o = { families: m, cards: {}, level: 'B1', newLeft: 3, isDue };
  const a = F.boardFor({ ...o, day: DAY }), b = F.boardFor({ ...o, day: DAY });
  assert.deepEqual(a, b);
  const known = { ...o, state: () => 'known' };   // nothing due, nothing new: a hash of the day decides
  const roots = new Set(['2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13'].map(day => F.boardFor({ ...known, day })?.root));
  assert.equal(roots.size, 2, 'on a tie the day picks the root');
  assert.notEqual(F.boardFor({ ...o, day: DAY, recent: [/** @type {any} */ (a).root] })?.root, /** @type {any} */ (a).root, 'not the root of the last 14 days');
  // sizes: 6 at A2 and on a Light day, 10 at B1, 12 from B2 (or as many as the family has)
  assert.equal(F.boardSize('A2'), 6); assert.equal(F.boardSize('B1'), 10); assert.equal(F.boardSize('B2'), 12); assert.equal(F.boardSize('B1', true), 6);
  assert.equal(F.boardFor({ ...o, day: DAY, light: true, root: 'stellen' })?.cards.length, 6);
});

test('due reviews of the root come first and are never dropped; new words ≤ min(allowance, 3); known words write nothing', () => {
  const m = F.familyModel(withFamilies());
  const cards = { 'PV:ausstellen': rec(DAY), 'PW:Ausstellung': rec('2026-10-07'), 'PV:vorstellen': rec('2026-10-20'), 'PV:bestellen': rec('2026-10-30'), 'PV:auflegen': rec(DAY) };
  const b = /** @type {F.Board} */ (F.boardFor({ families: m, cards, day: DAY, level: 'B1', newLeft: 2, isDue, state: f => (cards[/** @type {keyof cards} */ (f.card)] ? 'known' : 'unseen') }));
  assert.equal(b.root, 'stellen', 'the root with the most due forms');
  for (const id of ['PV:ausstellen', 'PW:Ausstellung']) assert.ok(b.cards.includes(id) && b.writes.includes(id), `${id}: due, on the board, writes`);
  for (const id of ['PV:vorstellen', 'PV:bestellen']) assert.ok(b.cards.includes(id) && !b.writes.includes(id), `${id}: known and not due: on the board, logged only`);
  assert.equal(b.fresh.length, 2, 'new words: the allowance left (2), at most 3');
  assert.deepEqual(b.writes.filter(id => !cards[/** @type {keyof cards} */ (id)]).sort(), [...b.fresh].sort(), 'the only new words that write are the allowance ones');
  const many = F.boardFor({ families: m, cards: {}, day: DAY, level: 'B1', newLeft: 20, isDue, root: 'stellen' });
  assert.equal(many?.fresh.length, F.BOARD_NEW);
  const paused = F.boardFor({ families: m, cards, day: DAY, level: 'B1', newLeft: 0, paused: true, isDue, root: 'stellen' });
  assert.equal(paused, null, 'new items paused and fewer than 6 seen forms: no board (the row hides)');
  // a report pauses a form from the board
  const rep = F.boardFor({ families: m, cards, day: DAY, level: 'B1', newLeft: 2, isDue, reported: new Set(['ausstellen']) });
  assert.ok(rep && !rep.cards.includes('PV:ausstellen'));
});

test('tiles: the board\'s prefixes and endings, a real distractor and a checked non-word at B1; one dual reading below B2', () => {
  const m = F.familyModel(withFamilies());
  const b = /** @type {F.Board} */ (F.boardFor({ families: m, cards: {}, day: DAY, level: 'B1', newLeft: 3, isDue, root: 'stellen' }));
  const st = /** @type {F.Family} */ (m.get('stellen'));
  const forms = b.cards.map(id => /** @type {F.Form} */ (st.byCard.get(id)));
  for (const f of forms) { if (f.pre[0]) assert.ok(b.tiles.pre.includes(f.pre[0])); if (f.suf[0]) assert.ok(b.tiles.suf.includes(f.suf[0])); }
  assert.ok(b.tiles.pre.includes('zer'), 'the checked non-word zerstellen gives a distractor');
  assert.ok(b.tiles.pre.length <= 10);
  assert.equal(new Set(forms.map(f => f.key)).size, forms.length, 'below B2 no two clues on the same tiles');
  assert.deepEqual(b.cards.map(id => st.forms.indexOf(/** @type {F.Form} */ (st.byCard.get(id)))), [...b.cards.map(id => st.forms.indexOf(/** @type {F.Form} */ (st.byCard.get(id))))].sort((x, y) => x - y), 'clues in the family\'s order');
});

test('judge: right, the article, another clue, found, an extra word, a non-word, a miss; each part flips', () => {
  const st = /** @type {F.Family} */ (F.familyModel(withFamilies()).get('stellen'));
  const cards = ['PV:ausstellen', 'PW:Ausstellung', 'PV:bestellen', 'PF:der_Hersteller'];
  const j = (/** @type {number} */ i, /** @type {any} */ pick, done = {}) => F.judge({ fam: st, cards, i, done, pick });
  assert.equal(j(0, { pre: 'aus' }).outcome, 'right');
  assert.equal(j(1, { pre: 'aus', suf: 'ung', art: 'die' }).outcome, 'right');
  const art = j(1, { pre: 'aus', suf: 'ung', art: 'der' });
  assert.equal(art.outcome, 'article'); assert.deepEqual(art.states, { art: 'no', pre: 'ok', suf: 'ok' });
  assert.deepEqual(j(0, { pre: 'be' }), { outcome: 'other', target: 2, form: st.byId.get('bestellen'), states: { art: null, pre: null, suf: null } }, 'another open clue: filled instead, no try');
  assert.equal(j(2, { pre: 'aus' }, { 'PV:ausstellen': 'f1' }).outcome, 'found');
  const extra = j(0, { pre: 'ein' });
  assert.equal(extra.outcome, 'extra'); assert.equal(extra.form?.id, 'einstellen');
  assert.equal(extra.states.pre, 'near', 'einstellen is a word, with another meaning');
  const non = j(0, { pre: 'zer' });
  assert.equal(non.outcome, 'nonword'); assert.equal(non.states.pre, 'no');
  assert.equal(j(0, { pre: 'miss' }).outcome, 'miss', 'not in the list: never called wrong German');
  assert.equal(j(0, {}).outcome, 'empty');
  assert.deepEqual(j(1, { pre: 'aus', suf: 'er', art: 'die' }).states, { art: 'ok', pre: 'ok', suf: 'no' });
});

test('typed words parse into parts against the family', () => {
  const st = /** @type {F.Family} */ (F.familyModel(withFamilies()).get('stellen'));
  assert.deepEqual(F.parseTyped(st, 'die Ausstellung'), { art: 'die', pre: 'aus', suf: 'ung', form: st.byId.get('die_Ausstellung') });
  assert.deepEqual(F.parseTyped(st, 'ausstellen')?.pre, 'aus');
  assert.deepEqual(F.parseTyped(st, 'zerstellen'), { art: null, pre: 'zer', suf: null, form: null });
  assert.equal(F.parseTyped(st, 'Haus'), null);
});

test('grades: tiles cap at Good; later tries, a wrong article, a missed split are Hard; shown is a study step on a never-answered card', () => {
  assert.deepEqual(F.gradeFor({ tries: 0 }), { g: 3, study: false, flags: '' });
  for (const o of [{ tries: 1 }, { tries: 2 }, { tries: 0, splitMiss: true }, { tries: 0, artMiss: true }]) assert.equal(F.gradeFor(o).g, 2, JSON.stringify(o));
  assert.deepEqual(F.gradeFor({ tries: 0, slip: true }), { g: 2, study: false, flags: 'u' });
  assert.deepEqual(F.gradeFor({ tries: 3, shown: true, rec: null }), { g: 1, study: true, flags: 'v' }, 'never seen: a study step');
  assert.deepEqual(F.gradeFor({ tries: 3, shown: true, rec: rec(DAY) }), { g: 1, study: false, flags: 'r' }, 'answered before: Again');
  assert.deepEqual(F.gradeFor({ tries: 3, shown: true, rec: rec(DAY, { hist: [[DAY, 1, 0, 't', 'v']] }) }).study, true, 'only ever shown: still a study step');
  assert.equal(F.doneOf({ tries: 0 }), 'f1'); assert.equal(F.doneOf({ tries: 2 }), 'f2'); assert.equal(F.doneOf({ tries: 3, shown: true }), 'shown');
  assert.equal(F.pointsOf(0, false), 3); assert.equal(F.pointsOf(1, false), 2); assert.equal(F.pointsOf(2, false), 1); assert.equal(F.pointsOf(0, false, true), 2); assert.equal(F.pointsOf(3, true), 0);
  assert.equal(F.foundCount({ cards: ['a', 'b', 'c'] }, { a: 'f1', b: 'shown', c: 'f2' }), 2, 'count only: shown is not found');
});

test('new board words are new items of deck build: the allowance sees them (shownToday), PF included', () => {
  const cards = { 'PF:der_Hersteller': { reps: 1, first: DAY }, 'PW:Ausstellung': { reps: 1, first: DAY }, 'PV:bestellen': { reps: 4, first: '2026-09-01' } };
  const s = shownToday(cards, DAY);
  assert.equal(s.all, 2); assert.equal(s.sx, 2);
});

test('a due PF card is in Word building\'s review round', () => {
  const c = withFamilies();
  const ids = composeRound({ kind: 'review', content: c, cards: { 'PF:der_Hersteller': rec(DAY) }, today: DAY, isDue, recall: () => 0.5, newLeft: 0 });
  assert.deepEqual(ids, ['PF:der_Hersteller']);
});

test('the log: one entry a day, resumable; two devices merge by day (union of found, most tries)', () => {
  const m = F.familyModel(withFamilies());
  const b = /** @type {F.Board} */ (F.boardFor({ families: m, cards: {}, day: DAY, level: 'B1', newLeft: 3, isDue, root: 'stellen' }));
  const d = F.newDay(b);
  let log = F.putDay(null, d);
  assert.deepEqual(F.dayOf(log, DAY)?.cards, b.cards);
  assert.deepEqual(log.recent, ['stellen']);
  log = F.putDay(log, { ...d, done: { [b.cards[0]]: 'f1' } });
  assert.equal(log.days.length, 1, 'replaced, not added');
  const phone = F.putDay(null, { ...d, done: { [b.cards[0]]: 'f2', [b.cards[1]]: 'shown' }, tries: { [b.cards[1]]: 3 }, extras: ['anstellen'] });
  const mac = F.putDay(null, { ...d, done: { [b.cards[0]]: 'f1', [b.cards[2]]: 'f2' }, tries: { [b.cards[1]]: 1 }, extras: ['aufstellen'], split: { [b.cards[0]]: false } });
  const j = F.dayOf(F.joinFamily(phone, mac), DAY);
  assert.deepEqual(j?.done, { [b.cards[0]]: 'f1', [b.cards[1]]: 'shown', [b.cards[2]]: 'f2' });
  assert.equal(j?.tries[b.cards[1]], 3);
  assert.deepEqual(j?.extras.sort(), ['anstellen', 'aufstellen']);
  assert.deepEqual(F.joinFamily(phone, mac), F.joinFamily(F.joinFamily(phone, mac), mac), 'idempotent');
  // a missed split puts the verb's sentence cards first (the recentMisses path)
  const diff = (/** @type {string} */ a, /** @type {string} */ z) => (Date.parse(z) - Date.parse(a)) / 864e5;
  const miss = F.putDay(null, { ...d, split: { 'PV:ausstellen': false, 'PV:bestellen': true } });
  assert.deepEqual(F.splitMisses(miss, DAY, diff), ['ausstellen']);
  assert.deepEqual(F.splitMisses(miss, '2026-10-20', diff), [], 'only the last three days');
});

test('word sheets find their family: a form\'s lemma, or a member of the root\'s word cluster', () => {
  const m = F.familyModel(withFamilies());
  const ix = F.familyIndex(m, [{ id: 'stellen', members: ['stellen.verb', 'die_Stelle', 'stellung_nehmen.phrase'] }, { id: 'kennen', members: ['kennen.verb'] }]);
  assert.deepEqual(ix.get('die_Ausstellung'), { root: 'stellen', form: 'die_Ausstellung' });
  assert.deepEqual(ix.get('die_Stelle'), { root: 'stellen', form: null });
  assert.equal(ix.get('stellung_nehmen.phrase'), undefined, 'phrases are not forms');
  assert.equal(ix.get('kennen.verb'), undefined, 'no family data for kennen');
});

/* ---------------- the content lane's full shape (content/build/FAMILY-SCHEMA.md) ---------------- */
const FF = (/** @type {any} */ o) => ({ kind: undefined, side: 'pre', pre: [], suf: [], key: null, seg: [], stress: 0, en: 'x', clue: undefined, ex: 'x.', exEn: 'x', grade: 'T', how: 'lit', level: 'B1', lemma: null, lex: ['list'], board: true, ...o });
const fullFamily = () => ({ root: 'stellen', lemma: 'stellen.verb', en: 'put, place', pres3: 'stellt', pret: 'stellte', aux: 'hat', pp: 'gestellt', level: 'A1', zipf: 4.9, stems: ['stell'],
  forms: [
    FF({ id: 'stellen.verb', card: null, word: 'stellen', cls: 'verb', parent: null, side: undefined, key: null, seg: [['r', 'stell'], ['i', 'en']], stress: 1, board: false }),
    FF({ id: 'ausstellen.verb', card: 'PV:ausstellen', word: 'ausstellen', cls: 'verb', kind: 's', parent: 'stellen.verb', add: 'aus', pre: ['aus'], key: 'aus|', seg: [['p', 'aus'], ['r', 'stell'], ['i', 'en']], stress: 1, clue: 'to exhibit' }),
    FF({ id: 'die_Ausstellung', card: 'PW:Ausstellung', word: 'Ausstellung', art: 'die', cls: 'noun', parent: 'ausstellen.verb', add: 'ung', side: 'suf', pre: ['aus'], suf: ['ung'], key: 'aus|ung', seg: [['p', 'Aus'], ['r', 'stell'], ['s', 'ung']], stress: 1, clue: 'the exhibition', lemma: 'die_Ausstellung' }),
    FF({ id: 'herstellen.verb', card: 'PF:herstellen.verb', word: 'herstellen', cls: 'verb', kind: 's', parent: 'stellen.verb', add: 'her', pre: ['her'], key: 'her|', seg: [['p', 'her'], ['r', 'stell'], ['i', 'en']], stress: 1, clue: 'to manufacture', lemma: 'herstellen.verb' }),
    FF({ id: 'der_Hersteller', card: 'PF:der_Hersteller', word: 'Hersteller', art: 'der', cls: 'noun', parent: 'herstellen.verb', add: 'er', side: 'suf', pre: ['her'], suf: ['er'], key: 'her|er', seg: [['p', 'Her'], ['r', 'stell'], ['s', 'er']], stress: 1, clue: 'the manufacturer' }),
    FF({ id: 'bestellen.verb', card: 'PV:bestellen', word: 'bestellen', cls: 'verb', kind: 'i', parent: 'stellen.verb', add: 'be', pre: ['be'], key: 'be|', seg: [['p', 'be'], ['r', 'stell'], ['i', 'en']], stress: 3, clue: 'to order (food)' }),
    FF({ id: 'die_Bestellung', card: 'PW:Bestellung', word: 'Bestellung', art: 'die', cls: 'noun', parent: 'bestellen.verb', add: 'ung', side: 'suf', pre: ['be'], suf: ['ung'], key: 'be|ung', seg: [['p', 'Be'], ['r', 'stell'], ['s', 'ung']], stress: 3, clue: 'the order you placed' }),
    FF({ id: 'einstellen.verb', card: 'PV:einstellen', word: 'einstellen', cls: 'verb', kind: 's', parent: 'stellen.verb', add: 'ein', pre: ['ein'], key: 'ein|', seg: [['p', 'ein'], ['r', 'stell'], ['i', 'en']], stress: 1, clue: 'to hire' }),
    FF({ id: 'unvorstellbar.adj', card: 'PF:unvorstellbar.adj', word: 'unvorstellbar', cls: 'adj', parent: 'ausstellen.verb', add: 'un', pre: ['un', 'vor'], suf: ['bar'], key: 'un+vor|bar', seg: [['p', 'un'], ['p', 'vor'], ['r', 'stell'], ['s', 'bar']], stress: 0, clue: 'unimaginable', board: true }),
    FF({ id: 'die_Angestellte', card: 'PF:die_Angestellte', word: 'Angestellte', art: 'die', cls: 'noun', adjNoun: true, parent: 'einstellen.verb', add: 'pp', side: 'suf', pre: ['an'], suf: ['pp'], key: 'an|pp', seg: [['p', 'An'], ['i', 'ge'], ['r', 'stell'], ['i', 't'], ['i', 'e']], stress: 0, clue: 'an employee', board: false }),
    FF({ id: 'entstellen.verb', card: 'PV:entstellen', word: 'entstellen', cls: 'verb', kind: 'i', parent: 'stellen.verb', add: 'ent', pre: ['ent'], key: 'ent|', seg: [['p', 'ent'], ['r', 'stell'], ['i', 'en']], stress: 3, clue: 'to disfigure', rare: true, level: 'C1' }),
  ],
  boards: {}, none: [{ key: 'zer|', word: 'zerstellen', chk: { dwds: false, wf: 0, hits: 0 } }], rare: [{ key: 'ent|', word: 'entstellen', why: 'exists' }], reviewedBy: 'model-2pass', reviewedAt: '2026-10-08' });

test('the full shape is read as it is: cards, keys, written parts, stress index, board flags', async () => {
  const { familyCardIds } = await import('../../src/domain/wordbuild.js');
  const c = { ...content(), families: [fullFamily()] };
  const st = /** @type {F.Family} */ (F.familyModel(c).get('stellen'));
  assert.deepEqual(st.forms.map(f => f.id).slice(0, 2), ['stellen.verb', 'ausstellen.verb'], 'the content\'s forms, root first');
  assert.equal(st.byCard.get('PF:der_Hersteller')?.parent, 'herstellen.verb');
  assert.deepEqual(pfIds(c).sort(), familyCardIds(c).sort(), 'PF ids are the content\'s');
  const by = (/** @type {string} */ id) => /** @type {F.Form} */ (st.byId.get(id));
  assert.deepEqual(by('unvorstellbar.adj').pre, ['vor', 'un'], 'nearest the root first');
  assert.equal(by('unvorstellbar.adj').key, null, 'two prefixes: no tile key');
  assert.deepEqual(F.piecesOf(by('die_Ausstellung')), { pre: ['Aus'], base: 'stell', tail: '', suf: ['ung'] });
  assert.deepEqual(F.piecesOf(by('herstellen.verb')), { pre: ['her'], base: 'stell', tail: 'en', suf: [] });
  assert.equal(by('herstellen.verb').stress, 'pre'); assert.equal(by('herstellen.verb').stressIdx, 1);
  assert.equal(by('bestellen.verb').stress, 'stem');
  assert.equal(by('die_Angestellte').board, false, 'an adjective noun is never on a board');
  const b = /** @type {F.Board} */ (F.boardFor({ families: F.familyModel(c), cards: {}, day: DAY, level: 'B1', newLeft: 3, isDue, root: 'stellen' }));
  assert.ok(b.cards.length >= 6);
  assert.ok(!b.cards.includes('PV:entstellen'), 'a rare form is not on a B1 board');
  assert.ok(!b.cards.includes('PF:die_Angestellte'));
  assert.ok(b.tiles.pre.includes('zer'), 'the checked non-word\'s key gives the distractor');
  assert.equal(F.judge({ fam: st, cards: b.cards, i: 0, done: {}, pick: { pre: 'zer' } }).outcome, 'nonword');
  assert.equal(F.judge({ fam: st, cards: b.cards, i: 0, done: {}, pick: { pre: 'ent' } }).outcome, 'extra', 'rare is real: an extra word, never "not a word"');
});
