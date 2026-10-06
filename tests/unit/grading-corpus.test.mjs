// The adversarial grading corpus (tests/corpus/grading-corpus.mjs) as a regression test: typical B1 errors made in the
// real content's sentences must never come back as right, and right variants must not be marked wrong.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, table } from '../corpus/grading-corpus.mjs';

// right answers the grader still marks wrong, each for a reason outside the grader: the item's accepted answers do not
// list that wording, a capital the noun list asks for, or a missing full stop between two sentences
const KNOWN_FN = new Set([
  'BP:w1-anrede-liebe-clara|Meine liebe Clara,',                                   // Liebe is a noun in the noun list
  'BP:s3-wenn-ich-sie-richtig-verstehe|Wenn ich Sie richtig verstehe meinen Sie dass die Reise zu teuer ist',   // no commas
  'K:ENG_CHUNK_0803|Ich kann verstehen dass du sauer bist Das war echt unfair',    // no full stop
  'BP:w3-termin-verschieben-dienstag|Könnten wir den Termin bitte auf Dienstag um 10 Uhr verschieben?',   // bitte not in the accepted phrase
  'BG:vf-obwohl-krank|Ich gehe zu der Arbeit, obwohl ich krank bin.',              // zu der not accepted
]);

// right answers the journey review (round 3) found rejected or struck in red; each must now be graded right
const JOURNEY_RIGHT = [
  ['BS:a1-schreib-mir-bald', 'Schreibe mir bald!'],
  ['BS:a1-trotzdem', 'Die Wohnung ist klein. Dennoch fühle ich mich dort wohl.'],
  ['BS:a1-deshalb', 'Die Wohnung liegt im Zentrum, daher kann ich überall zu Fuß gehen.'],
  ['BS:a1-obwohl', 'Die Wohnung gefällt mir sehr gut, obwohl sie klein ist.'],
  ['BS:a3-in-zukunft', 'In Zukunft gebe ich Ihnen vorher Bescheid.'],
  ['BS:a3-wuerde-ihnen-passen', 'Passt es Ihnen am Dienstag um 10 Uhr?'],
  ['BS:a2-als-ich-student-war', 'Als ich Student war, arbeitete ich am Wochenende.'],
  ['BS:a1-dank-deine-email', 'Herzlichen Dank für deine liebe E-Mail.'],
  ['BS:a1-gruesse-familie', 'Schöne Grüße an deine Familie!'],
  ['BS:a1-hoffe-es-geht-dir-gut', 'Ich hoffe, es geht dir gut.'],
  ['BP:s3-mir-hat-besonders-gefallen-dass', 'Mir hat besonders gefallen, dass du von deiner Erfahrung gesprochen hast.'],
];

test('grading corpus: no wrong German is right, right German is not wrong', async () => {
  const corpus = await evaluate();
  const { rows, all } = table(corpus);
  assert.ok(all.wrong > 2500 && all.right > 2500, `corpus size ${all.wrong} wrong, ${all.right} right`);
  // every typed item type is in the corpus: a missing content file (content/b1/schreiben.json) must fail, not shrink it
  const types = new Set(rows.map(([type]) => type));
  for (const type of ['schreiben phrase', 'schreiben email line', 'situation', 'cluster word', 'cluster family', 'cluster opposite', 'cluster prep', 'script word gap', 'script word meaning', 'word building verb', 'word building sentence', 'word building word'])
    assert.ok(types.has(type), `no ${type} answers in the corpus`);
  const fp = corpus.filter(c => c.fp).map(c => `${c.type} ${c.cls} ${c.id}: ${c.text}`);
  assert.deepEqual(fp, [], 'false positives');
  // a B2 model typed without its commas: the clause rules read clauses by their commas (nachdem … war zogen wir ein), as
  // for the B1 sentences in KNOWN_FN; at most the 21 there were when the B2 layer joined the corpus (round 4)
  const b2NoComma = corpus.filter(c => c.fn && !c.variant && c.cls === 'no-punctuation' && /^B2 /.test(c.type));
  assert.ok(b2NoComma.length <= 21, `${b2NoComma.length} B2 models without punctuation graded wrong (was 21)`);
  const fn = corpus.filter(c => c.fn && !c.variant && !b2NoComma.includes(c)).map(c => `${c.id}|${c.text}`).filter(k => !KNOWN_FN.has(k));
  assert.deepEqual(fn, [], 'false negatives');
  // right answers flagged Hard because their rest differs from every sentence the grader knows (other wordings); the
  // round 4 review's hand-written right answers are counted apart (34 Hard when its fixes went in: may only fall)
  const soft = (/** @type {(c: any) => boolean} */ f) => corpus.filter(c => c.soft && !c.variant && f(c)).length;
  assert.ok(soft(c => !/^B2 |review 4/.test(c.type)) <= 8, `${soft(c => !/^B2 |review 4/.test(c.type))} right answers flagged as partial`);
  assert.ok(soft(c => /^B2 /.test(c.type)) <= 5, `${soft(c => /^B2 /.test(c.type))} right B2 answers flagged as partial`);
  assert.ok(soft(c => /review 4/.test(c.type)) <= 34, `${soft(c => /review 4/.test(c.type))} of the review's right answers flagged as partial`);
  // the morphology classes (round 4: infinitive for participle, zu, strong verbs with regular endings, prefix swaps,
  // agreement, the polite Sie in lower case): never right, on every set, and each class keeps its size
  const MIN = { 'inf-for-pp': 400, 'pp-for-inf': 450, 'zu-dropped': 80, 'zu-added': 350, 'strong-weak': 330, 'prefix-swap': 280, agreement: 650, 'formal-lowercase': 45 };
  for (const [k, n] of Object.entries(MIN)) {
    const of = corpus.filter(c => c.cls === k && c.verdict !== 'missing');
    assert.ok(of.length >= n, `${k}: ${of.length} wrong answers (at least ${n})`);
    assert.deepEqual(of.filter(c => c.fp).map(c => `${c.id}: ${c.text}`), [], `${k} graded right`);
  }
  for (const set of ['B1 phrases', 'B1 grammar', 'B2 Redemittel', 'B2 collocations', 'B2 grammar'])
    assert.ok(corpus.some(c => c.set === set && MIN[c.cls]), `no morphology errors made on ${set}`);
  // the right variants (tests/corpus/right-variants.mjs, round 3): graded wrong or flagged Hard may only fall. Before
  // round 3: 94 of 379 wrong (24.8%), 111 Hard (29.3%); Schreiben phrases 25.5% and 34.1%, email lines 22.2% and 4.2%.
  assert.ok(all.vFn <= 7, `${all.vFn} right variants graded wrong (was at most 7): ${corpus.filter(c => c.variant && c.fn).map(c => `${c.id}|${c.text}`).join('; ')}`);
  assert.ok(all.vSoft <= 60, `${all.vSoft} right variants flagged Hard (was at most 60)`);
  // the journey review's cases (round 3, §7.2 and p1-07): right, with nothing struck
  for (const [id, text] of JOURNEY_RIGHT) {
    const c = corpus.find(x => x.id === id && x.text === text);
    assert.ok(c, `${id}: ${text} is in the corpus`);
    assert.equal(c.verdict, 'right', `${id}: ${text}`);
  }
  // his answer
  const his = corpus.find(c => c.cls === 'his-answer');
  assert.equal(his.verdict, 'partial');
  console.log(`grading corpus: ${all.wrong} wrong answers, ${all.fp} right; ${all.right} right answers, ${all.fn} wrong, ${all.soft} Hard (${rows.length} item types)`);
});
