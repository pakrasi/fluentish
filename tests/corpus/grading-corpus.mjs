// Adversarial grading corpus, built from the real public content (content/b1/*.json) plus a few synthetic exam words
// and corrections. For each item it makes typical B1 learner errors (wrong answers that must NOT come back as right)
// and correct variants (answers that must not be marked wrong), runs every one through the app's grading path
// (features/shared/grade.js gradeAnswer, the same call the round makes) and counts false positives and false
// negatives per item type.
//
//   node tests/corpus/grading-corpus.mjs [--root <repo>] [--list fp|fn|soft] [--type <type>]
//
// --root grades with another checkout's code (the "before" numbers come from the commit before the fix).
// tests/unit/grading-corpus.test.mjs runs it as a regression test.
//
// The error generators only make changes that are wrong in context; each one is described next to its code.
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { RIGHT_VARIANTS } from './right-variants.mjs';
import { verbIndex, nounNumbers, morphErrorsIn, formalLowercase, setOf, MORPH_CLASSES } from './morph-errors.mjs';
import { REVIEW4_CASES } from './review4-cases.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '../..');

const J = (root, p) => JSON.parse(readFileSync(path.join(root, p), 'utf8'));
const WORD = /[\p{L}\p{N}'-]+/gu;
const fold = s => String(s).toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');
const toks = s => [...String(s).matchAll(WORD)].map(m => ({ w: m[0], i: m.index, e: m.index + m[0].length }));
const put = (s, t, w) => s.slice(0, t.i) + w + s.slice(t.e);
const isCap = w => /^\p{Lu}/u.test(w);

/* ---------- a lexicon of real German word forms (folded), from the public content: used only to choose mutations ---------- */
export function lexicon(root = ROOT) {
  const L = new Set();
  const addText = s => { for (const t of toks(s || '')) L.add(fold(t.w)); };
  for (const k of Object.keys(J(root, 'content/b1/nouns.json'))) L.add(fold(k));
  for (const w of J(root, 'content/igloo/words/de.json')) { addText(w.w); addText(w.pl); (w.alt || []).forEach(addText); addText(w.ex); addText(w.forms); }
  for (const it of J(root, 'content/b1/items.json')) { addText(it.model); for (const m of it.moves || []) addText(m.model); }
  for (const g of J(root, 'content/b1/grammar.json')) [].concat(g.answer).forEach(addText);
  for (const b of Object.values(J(root, 'content/b1/bank.json'))) addText(b.ex);
  return L;
}

/* ---------- paradigms: a different member of the same paradigm is wrong in a fixed, correct sentence ---------- */
// The learner's usual confusion for each form (case or gender): der→den, den→dem, dem→den, die→der, das→der, …
const ART_NEXT = { der: 'den', den: 'dem', dem: 'den', die: 'der', das: 'der', des: 'der',
  dieser: 'diesen', diesen: 'diesem', diesem: 'diesen', diese: 'dieser', dieses: 'diesem' };
for (const b of ['ein', 'kein', 'mein', 'dein', 'sein', 'unser'])   // ein→einen, einen→einem, einem→einen, eine→einer, einer→eine, eines→ein
  Object.assign(ART_NEXT, { [b]: b + 'en', [b + 'en']: b + 'em', [b + 'em']: b + 'en', [b + 'e']: b + 'er', [b + 'er']: b + 'e', [b + 'es']: b });
ART_NEXT.unseren = 'unserem'; ART_NEXT.unserem = 'unseren';
const DET = new Set([...Object.keys(ART_NEXT), 'am', 'im', 'zum', 'zur', 'vom', 'beim', 'ins', 'ihre', 'ihren', 'ihrem', 'ihrer', 'ihres']);
const ADJ_SWAP = { en: 'es', em: 'en', er: 'en', es: 'en', e: 'en' };
const PRON_CASE = { mir: 'mich', mich: 'mir', dir: 'dich', dich: 'dir', ihm: 'ihn', ihn: 'ihm' };
const PERSON = { ich: ['e', 't'], du: ['st', 't'], er: ['t', 'en'], es: ['t', 'en'], wir: ['en', 't'], ihr: ['t', 'en'] };
const NOT_VERB = new Set(`gerne gerade heute morgen gestern oben unten eben selten trotzdem dann denn wenn schon nun eigentlich vielleicht
  leider immer nie nicht noch auch sehr ganz gleich alle viele wieder mehr weniger meistens manchmal oft jetzt hier dort da erst
  einen einem einer eine keine keinen meine meinen deine deinen seine seinen unsere unseren uns euch mich dich sich mir dir ihm ihn
  bitte gern danke sicher wirklich eigentlich ziemlich lieber besser beide erste zweite letzte nächste diese diesen jeden jede gute
  allem allen selbst damit dafür dabei dazu darauf davon daran danach dagegen deshalb deswegen sondern aber oder und weil dass ob
  obwohl während nachdem bevor seit seitdem zwar endlich zusammen alleine allein später gleichzeitig unbedingt total echt etwa fast genau`.split(/\s+/).filter(Boolean));
const SUB = new Set(['dass', 'weil', 'ob', 'wenn', 'obwohl', 'damit', 'bevor', 'nachdem', 'falls']);
const PRON = new Set(['ich', 'du', 'er', 'sie', 'es', 'wir', 'ihr', 'man']);
const CLOSEDISH = new Set([...DET, ...Object.keys(PRON_CASE), ...PRON, 'uns', 'euch', 'sich', 'ihnen', 'nicht', 'kein', 'sind', 'ist', 'bin', 'bist', 'seid', 'hat', 'habe', 'hast', 'haben']);

/** Typical B1 errors in a correct sentence s. Returns [{cls, text}]. `span` (char range) excludes words inside it when given. */
export function errorsIn(s, { lex, outside = null, inside = null } = {}) {
  const out = [], T = toks(s);
  const inRange = (t, r) => r && t.i >= r[0] && t.e <= r[1];
  const ok = t => (!outside || !inRange(t, outside)) && (!inside || inRange(t, inside));
  const low = t => t.w.toLowerCase();
  // 1. wrong article / case: der→den, die→der, ein→einen … before a noun (or adjective + noun)
  T.forEach((t, k) => {
    const n = ART_NEXT[low(t)];
    if (!n || !ok(t) || !T[k + 1]) return;
    if (!(isCap(T[k + 1].w) || (T[k + 2] && isCap(T[k + 2].w) && /e[nmrs]?$/.test(T[k + 1].w)))) return;
    // den ↔ dem before a noun in -n (den Kollegen / dem Kollegen, den Kindern) can both be right: skip
    const noun = isCap(T[k + 1].w) ? T[k + 1].w : T[k + 2].w;
    if (['den', 'dem'].includes(low(t)) && /n$/.test(noun)) return;
    out.push({ cls: 'article-case', text: put(s, t, isCap(t.w) ? n[0].toUpperCase() + n.slice(1) : n) });
  });
  // 2. wrong adjective ending: determiner + adjective + Noun, the adjective's ending changed (die vielen Cafés → die vieles Cafés)
  T.forEach((t, k) => {
    if (!ok(t) || k === 0 || !T[k + 1] || isCap(t.w) || !DET.has(low(T[k - 1])) || !isCap(T[k + 1].w) || t.w.length < 4) return;
    const m = /(en|em|er|es|e)$/.exec(t.w); if (!m || CLOSEDISH.has(low(t))) return;
    out.push({ cls: 'adj-ending', text: put(s, t, t.w.slice(0, -m[1].length) + ADJ_SWAP[m[1]]) });
  });
  // 3. wrong verb ending after (or before) a subject pronoun: ich gehe → ich geht, wir haben → wir habt
  T.forEach((t, k) => {
    const p = PERSON[low(t)]; if (!p) return;
    for (const j of [k + 1, k - 1]) {
      const v = T[j]; if (!v || !ok(v) || isCap(v.w) && j !== 0) continue;
      const lw = low(v);
      if (NOT_VERB.has(lw) || CLOSEDISH.has(lw) || lw.length < 4 || !lw.endsWith(p[0]) || (p[0] === 't' && lw.endsWith('st'))) continue;
      if (j === k - 1 && !['ich', 'du', 'wir'].includes(low(t))) continue;
      const nv = v.w.slice(0, -p[0].length) + p[1];
      out.push({ cls: 'verb-ending', text: put(s, v, nv) });
      break;
    }
  });
  // 4. a dropped umlaut that makes another real German form: Mütter → Mutter, fährt → fahrt, wäre → ware
  T.forEach(t => {
    if (!ok(t) || !/[äöü]/.test(t.w)) return;
    const d = t.w.replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/Ä/g, 'A').replace(/Ö/g, 'O').replace(/Ü/g, 'U');
    if (lex && lex.has(fold(d))) out.push({ cls: 'umlaut-form', text: put(s, t, d) });
  });
  // 5. verb not at the end after dass / weil / ob / wenn …: weil ich keine Zeit habe → weil ich habe keine Zeit
  const pieces = s.split(/([,.;:!?])/);
  let off = 0;
  for (let p = 0; p < pieces.length; p++) {
    const seg = pieces[p], st = off; off += seg.length;
    if (p % 2) continue;
    const C = toks(seg);
    const k = C.findIndex(t => SUB.has(t.w.toLowerCase()));
    if (k < 0) continue;
    const cl = C.slice(k + 1);
    if (cl.length < 3) continue;
    const subjEnd = PRON.has(cl[0].w.toLowerCase()) ? 1 : DET.has(cl[0].w.toLowerCase()) && cl[1] && isCap(cl[1].w) ? 2 : 0;
    if (!subjEnd || cl.length - subjEnd < 2) continue;
    const verb = cl[cl.length - 1];
    if (isCap(verb.w) || NOT_VERB.has(verb.w.toLowerCase())) continue;
    if (outside && st + verb.i >= outside[0] && st + verb.i < outside[1] && inside == null) { /* inside the span: still a real error */ }
    const words = cl.map(t => t.w);
    const moved = [...words.slice(0, subjEnd), words[words.length - 1], ...words.slice(subjEnd, -1)];
    const a = st + cl[0].i, b = st + verb.e;
    out.push({ cls: 'verb-final', text: s.slice(0, a) + moved.join(' ') + s.slice(b) });
  }
  // 6. a pronoun in the wrong case: mir ↔ mich, dir ↔ dich, ihm ↔ ihn
  T.forEach(t => {
    const n = PRON_CASE[low(t)]; if (!n || !ok(t)) return;
    out.push({ cls: 'pron-case', text: put(s, t, isCap(t.w) ? n[0].toUpperCase() + n.slice(1) : n) });
  });
  // 7. wrong gender: der/die/das, ein/eine before a noun (das Stadt, eine Problem)
  const GENDER = { der: 'das', die: 'das', das: 'die', ein: 'eine', eine: 'ein', kein: 'keine', keine: 'kein', mein: 'meine', meine: 'mein' };
  T.forEach((t, k) => {
    const n = GENDER[low(t)]; if (!n || !ok(t) || !T[k + 1] || !isCap(T[k + 1].w)) return;
    if (low(t) === 'die' && /(en|er|e|s|n)$/.test(T[k + 1].w)) return;   // could be a plural: die Leute, die Autos
    if (['ein', 'kein', 'mein'].includes(low(t)) && !/^(ist|war|wird|gibt|hat|habe|haben)$/i.test(T[k - 1]?.w || '') && k > 0 && !isCap(T[k - 1].w)) { /* ok either way */ }
    out.push({ cls: 'gender', text: put(s, t, isCap(t.w) ? n[0].toUpperCase() + n.slice(1) : n) });
  });
  // 8. haben ↔ sein in the Perfekt (ich bin gefahren → ich habe gefahren), only with a participle in the sentence
  const AUX = { bin: 'habe', bist: 'hast', ist: 'hat', sind: 'haben', seid: 'habt', habe: 'bin', hast: 'bist', hat: 'ist', haben: 'sind', habt: 'seid' };
  if (T.some(t => /^ge\p{L}{3,}(t|en)$/u.test(t.w) || /iert$/.test(t.w))) T.forEach(t => {
    const n = AUX[low(t)]; if (!n || !ok(t)) return;
    out.push({ cls: 'perfekt-aux', text: put(s, t, isCap(t.w) ? n[0].toUpperCase() + n.slice(1) : n) });
  });
  // 9. the case after a dative preposition: mit der Bahn → mit die Bahn, zu dem → zu den
  const DAT = new Set(['mit', 'zu', 'bei', 'von', 'aus', 'nach', 'seit', 'gegenüber']);
  T.forEach((t, k) => {
    if (!ok(t) || k === 0 || !DAT.has(low(T[k - 1]))) return;
    const n = { der: 'die', dem: 'das', einer: 'eine', einem: 'ein', meiner: 'meine', meinem: 'mein' }[low(t)];
    if (n && T[k + 1] && isCap(T[k + 1].w)) out.push({ cls: 'prep-case', text: put(s, t, n) });
  });
  // 10. words that sound alike: dass/das, seit/seid, wenn/wen, wieder/wider, viel/fiel, Stadt/Staat
  const SOUND = { dass: 'das', seit: 'seid', wenn: 'wen', wieder: 'wider', viel: 'fiel', stadt: 'staat', mehr: 'meer', ende: 'ente' };
  T.forEach(t => {
    const n = SOUND[low(t)]; if (!n || !ok(t)) return;
    out.push({ cls: 'sound-alike', text: put(s, t, isCap(t.w) ? n[0].toUpperCase() + n.slice(1) : n) });
  });
  const seen = new Set([s]);
  return out.filter(x => !seen.has(x.text) && seen.add(x.text));
}

/* ---------- Schreiben: the errors a B1 letter or forum post gets marked down for ---------- */
const POLITE = ['Sie', 'Ihnen', 'Ihr', 'Ihre', 'Ihren', 'Ihrem', 'Ihrer', 'Ihres'];
// adverbs and phrases that open a sentence and take the verb next (the Schreiben items open with these)
const OPENERS = ['zum beispiel', 'meiner meinung nach', 'am ende', 'in zukunft', 'leider', 'deshalb', 'deswegen', 'trotzdem', 'außerdem',
  'übrigens', 'zuerst', 'dann', 'danach', 'jetzt', 'natürlich', 'einerseits', 'andererseits', 'zusammenfassend'];
const SUBJ = new Set(['ich', 'du', 'er', 'sie', 'es', 'wir', 'ihr', 'man']);
const UML_DROP = { 'ü': 'u', 'ä': 'a', 'ö': 'o' };

/**
 * Typical Schreiben errors in a correct model sentence. Each one is wrong in context:
 *   salutation    Liebe ↔ Lieber, geehrte ↔ geehrter (the greeting no longer agrees with the person)
 *   sie-lower     a polite Sie, Ihnen, Ihr … in lower case (it means she, they or you all)
 *   strict-umlaut a dropped umlaut in a word the item spells strictly (Grüße → Gruße, freundlichen Grüßen → Grußen)
 *   v2-swap       the subject before the verb after an opener: Leider kann ich → Leider ich kann
 *   aber-order    the verb before the subject after aber or denn: aber ich habe → aber habe ich
 *   v2-mid        the subject before the verb after a comma and deshalb, trotzdem …: deshalb kann ich → deshalb ich kann
 *   zu-missing    Lust haben / möglich sein without zu: ins Kino zu gehen → ins Kino gehen
 *   um-am         a clock time with am: um 18 Uhr → am 18 Uhr
 * @param {string} s @param {{strict?: string[], free?: boolean}} [o] free: a Build an email line (free words around a frame)
 */
export function schreibenErrorsIn(s, { strict = [], free = false } = {}) {
  const out = [], T = toks(s);
  const low = (/** @type {any} */ t) => t.w.toLowerCase();
  const sentStart = (/** @type {number} */ i) => i === 0 || /[.!?:]\s*$/.test(s.slice(0, i));
  // salutation
  let m = /^(Liebe|Lieber)(\s)/.exec(s); if (m) out.push({ cls: 'salutation', text: (m[1] === 'Liebe' ? 'Lieber' : 'Liebe') + s.slice(m[1].length) });
  m = /^Sehr (geehrte|geehrter)(\s)/.exec(s); if (m) out.push({ cls: 'salutation', text: `Sehr ${m[1] === 'geehrte' ? 'geehrter' : 'geehrte'}${s.slice(5 + m[1].length)}` });
  // polite forms in lower case
  for (const t of T) if (POLITE.includes(t.w) && !sentStart(t.i)) out.push({ cls: 'sie-lower', text: put(s, t, t.w.toLowerCase()) });
  // a dropped umlaut in a strict word
  for (const t of T) if (strict.includes(t.w) && /[äöü]/.test(t.w)) out.push({ cls: 'strict-umlaut', text: put(s, t, t.w.replace(/[äöü]/g, c => UML_DROP[c])) });
  // the verb second after an opener at the start of a sentence: swap the verb and a pronoun subject
  for (const sent of s.split(/(?<=[.!?])\s+/)) {
    const st = s.indexOf(sent), lw = sent.toLowerCase();
    const op = OPENERS.find(o => lw.startsWith(o + ' '));
    if (!op) continue;
    const ST = toks(sent), n = op.split(' ').length;
    const v = ST[n], p = ST[n + 1];
    if (v && p && SUBJ.has(p.w.toLowerCase()) && !isCap(v.w)) out.push({ cls: 'v2-swap', text: s.slice(0, st) + sent.slice(0, v.i) + p.w + ' ' + v.w + sent.slice(p.e) });
  }
  // aber / denn with the verb first; deshalb, trotzdem … after a comma with the subject first
  T.forEach((t, k) => {
    const a = T[k + 1], b = T[k + 2];
    if (!a || !b) return;
    if ((low(t) === 'aber' || low(t) === 'denn') && SUBJ.has(low(a)) && !isCap(b.w) && b.w.length > 2 && !CLOSEDISH.has(low(b)) || ((low(t) === 'aber' || low(t) === 'denn') && SUBJ.has(low(a)) && ['bin', 'ist', 'sind', 'habe', 'hat', 'haben', 'kann', 'muss', 'will'].includes(low(b))))
      out.push({ cls: 'aber-order', text: s.slice(0, a.i) + b.w + ' ' + a.w + s.slice(b.e) });
    if (['deshalb', 'deswegen', 'trotzdem', 'außerdem'].includes(low(t)) && /,\s*$/.test(s.slice(0, t.i)) && !isCap(a.w) && SUBJ.has(low(b)))
      out.push({ cls: 'v2-mid', text: s.slice(0, a.i) + b.w + ' ' + a.w + s.slice(b.e) });
  });
  // zu before the infinitive after Lust / möglich
  if (/\b(Lust|möglich)\b/.test(s)) { m = / zu (\p{Ll}+en)\b/u.exec(s); if (m) out.push({ cls: 'zu-missing', text: s.slice(0, m.index) + ' ' + m[1] + s.slice(m.index + m[0].length) }); }
  // um 18 Uhr → am 18 Uhr (in a fixed phrase; a free line's slot holds any time phrase)
  if (!free) { m = /\bum (\d+) Uhr\b/.exec(s); if (m) out.push({ cls: 'um-am', text: s.slice(0, m.index) + `am ${m[1]} Uhr` + s.slice(m.index + m[0].length) }); }
  const seen = new Set([s]);
  return out.filter(x => !seen.has(x.text) && seen.add(x.text));
}

/** A real typo in a long word's stem (never the last 2 letters, never a vowel or umlaut): drop, double or swap consonants. */
export function typoIn(s, { lex, outside = null, eligible = () => true } = {}) {
  const T = toks(s);
  const cons = c => /[bcdfghjklmnpqrstvwxz]/i.test(c);
  for (const t of T.slice().sort((a, b) => b.w.length - a.w.length)) {
    if (t.w.length < 7 || CLOSEDISH.has(t.w.toLowerCase()) || /[äöüß]/i.test(t.w) || (outside && t.i < outside[1] && t.e > outside[0]) || !eligible(t.w)) continue;
    const w = t.w;
    for (let i = 2; i < w.length - 3; i++) {
      if (!cons(w[i]) || !cons(w[i + 1]) || w[i] === w[i + 1]) continue;
      const cands = [w.slice(0, i) + w[i + 1] + w[i] + w.slice(i + 2), w.slice(0, i) + w.slice(i + 1), w.slice(0, i + 1) + w[i] + w.slice(i + 1)];
      for (const c of cands) if (!lex || !lex.has(fold(c))) return put(s, t, c);
    }
  }
  return null;
}

// a slot pattern with junk in its slot: "Wie wäre es, wenn wir blorf quazz machen" (null when the slot is optional)
let garbage = () => null;
const umlautSpelled = s => s.replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue').replace(/ß/g, 'ss');

/* ---------- synthetic exam words and corrections (no learner data) ---------- */
// Exam words: trimmed-word shapes as words.js trimWords makes them. Sentences written for this corpus.
export const SYN_WORDS = [
  { lemma: 'günstig', form: 'günstigen', pos: 'Adjektiv', art: null, sent: 'Wir suchen eine Wohnung mit günstigen Preisen.', wrongs: ['günstigem', 'günstige', 'günstiges'] },
  { lemma: 'Bahnhof', form: 'Bahnhof', pos: 'Nomen', art: 'der', sent: 'Der Zug kommt um acht am Bahnhof an.', wrongs: ['Bahnhofs', 'Bahnhöfe'] },
  { lemma: 'erledigen', form: 'erledigt', pos: 'Verb', art: null, sent: 'Er hat die Arbeit schon erledigt.', wrongs: ['erledigen', 'erledigte'] },
  { lemma: 'Kollege', form: 'Kollegen', pos: 'Nomen', art: 'der', sent: 'Ich habe meinen Kollegen gestern getroffen.', wrongs: ['Kollege', 'Kolleges'] },
  { lemma: 'wichtig', form: 'wichtiges', pos: 'Adjektiv', art: null, sent: 'Das ist ein wichtiges Thema für uns.', wrongs: ['wichtigen', 'wichtiger', 'wichtige'] },
  { lemma: 'fahren', form: 'fährt', pos: 'Verb', art: null, sent: 'Sie fährt jeden Morgen mit dem Bus.', wrongs: ['fahrt', 'fahren', 'fährst'] },
  { lemma: 'Gebühr', form: 'Gebühren', pos: 'Nomen', art: 'die', sent: 'Gebühren muss man vorher bezahlen.', wrongs: ['Gebühr'] },
  { lemma: 'Anmeldung', form: 'Anmeldung', pos: 'Nomen', art: 'die', sent: 'Anmeldung ist bis Freitag möglich.', wrongs: [] },
  { lemma: 'Ausweis', form: 'Ausweis', pos: 'Nomen', art: 'der', sent: 'Bitte zeigen Sie Ausweis und Ticket.', wrongs: [] },
  { lemma: 'Mutter', form: 'Mütter', pos: 'Nomen', art: 'die', sent: 'Viele Mütter arbeiten heute Teilzeit.', wrongs: ['Mutter', 'Muter'] },
];
// For "type the noun with der, die or das": the wrong articles
const OTHER_ART = { der: ['die', 'das', 'den'], die: ['der', 'das'], das: ['der', 'die'] };

// Corrections (mistakes): a wrong sentence and its correction, written for this corpus.
export const SYN_MISTAKES = [
  ['Ich wohne in einer kleinen Wohnnung.', 'Ich wohne in einer kleinen Wohnung.'],
  ['Ich habe mit meinem Freunde gesprochen.', 'Ich habe mit meinem Freund gesprochen.'],
  ['Wir haben über die Probleme diskutiert, weil sie sind wichtig.', 'Wir haben über die Probleme diskutiert, weil sie wichtig sind.'],
  ['Am Wochenende ich fahre zu meinen Eltern.', 'Am Wochenende fahre ich zu meinen Eltern.'],
  ['Ich interessiere mich für die deutsche Kultur und die deutsches Essen.', 'Ich interessiere mich für die deutsche Kultur und das deutsche Essen.'],
  ['Er hat mir einen schöne Brief geschrieben.', 'Er hat mir einen schönen Brief geschrieben.'],
  ['Die Kinder spielen in den Garten.', 'Die Kinder spielen in dem Garten.'],
  ['Ich freue mich für die Reise.', 'Ich freue mich auf die Reise.'],
  ['Sie arbeitet seit drei Jahre in Berlin.', 'Sie arbeitet seit drei Jahren in Berlin.'],
  ['Meine Bruder wohnt in Hamburg.', 'Mein Bruder wohnt in Hamburg.'],
];

/* ---------- correct variants written by hand (word order, du/Sie, other wordings) ---------- */
// [item id, answer, kind]: kind 'span' = the graded phrase must pass; 'full' = the whole sentence is right German for the prompt.
export const CURATED_RIGHT = [
  ['BP:s2-glue-vor-allem', 'Mir gefällt die Stadt, vor allem die vielen Cafés.', 'full'],
  ['BP:s2-glue-vor-allem', 'Mir gefällt die Stadt, besonders die vielen Cafés.', 'full'],
  ['BP:s2-glue-vor-allem', 'Mir gefällt die Stadt, insbesondere die vielen Cafés.', 'full'],
  ['BP:s2-glue-vor-allem', 'Die Stadt gefällt mir, vor allem die vielen Cafés.', 'full'],
  ['BP:s2-glue-vor-allem', 'Ich mag die Stadt, besonders die vielen Cafés.', 'full'],
  ['BP:s2-glue-vor-allem', 'besonders', 'full'],
  ['BP:s2-glue-vor-allem', 'Mir gefaellt die Stadt, vor allem die vielen Cafes.', 'full'],
  ['BP:s2-glue-vor-allem', 'Mir gefällt die Stadt, vor allem die vielen Cafés', 'full'],
  ['BP:s2-glue-vor-allem', 'vor allem die vielen Cafés', 'full'],
  ['W:corpus-Mutter', 'die Mutter', 'full'],
  ['W:corpus-Mutter', 'Die Mutter', 'full'],
];

/* ---------- a held-out set, written by hand on randomly drawn items (seed 2026) before looking at any result ---------- */
// [item id, answer, want, the error or why it is right]
export const HELD_OUT = [
  ['BP:s1-dann-machen-wir-das-so', 'Okay, dann wir machen das so.', 'wrong', 'V2 after dann'],
  ['BP:s1-dann-machen-wir-das-so', 'Okay, dann macht wir das so.', 'wrong', 'verb ending'],
  ['BP:s2-folie4-ein-nachteil-allerdings', 'Ein Nachteil ist allerdings, dass man weniger Kontakt zu Kollegen haben.', 'wrong', 'verb ending'],
  ['BP:s2-folie4-ein-nachteil-allerdings', 'Ein Nachteil ist allerdings, dass man hat weniger Kontakt zu Kollegen.', 'wrong', 'verb not at the end'],
  ['BP:w1-entschuldige-erst-jetzt', 'Entschuldige bitte, dass ich mir erst jetzt melde.', 'wrong', 'mir for mich'],
  ['BP:w1-freue-mich-deine-antwort', 'Ich freue mich auf deiner Antwort.', 'wrong', 'case after auf'],
  ['BP:w1-freue-mich-deine-antwort', 'Ich freue mich für deine Antwort.', 'wrong', 'für for auf'],
  ['BP:s1-nicht-sicher-vielleicht-lieber', 'Da bin ich mich nicht sicher. Vielleicht lieber am Sonntag?', 'wrong', 'mich for mir'],
  ['BP:s1-nicht-sicher-vielleicht-lieber', 'Da bin ich mir nicht sicher. Vielleicht lieber an Sonntag?', 'wrong', 'an for am'],
  ['BP:s3-ich-wuerde-empfehlen-weil', 'Ich würde einen kleine Hund empfehlen, weil er nicht viel Platz braucht.', 'wrong', 'adjective ending'],
  ['BP:s3-ich-wuerde-empfehlen-weil', 'Ich würde einen kleinen Hund empfehlen, weil er braucht nicht viel Platz.', 'wrong', 'verb not at the end'],
  ['BP:s3-ich-wuerde-empfehlen-weil', 'Ich würde ein kleinen Hund empfehlen, weil er nicht viel Platz braucht.', 'wrong', 'article'],
  ['BP:w3-termin-verschieben-dienstag', 'Könnten wir der Termin auf Dienstag um 10 Uhr verschieben?', 'wrong', 'der for den'],
  ['BP:op-faellt-mir-ein-beispiel-ein', 'Dazu fällt mir ein Beispiel ein: Meine Schwester hat letztes Jahr umgezogen.', 'wrong', 'haben for sein'],
  ['BP:op-faellt-mir-ein-beispiel-ein', 'Dazu fällt mich ein Beispiel ein: Meine Schwester ist letztes Jahr umgezogen.', 'wrong', 'mich for mir'],
  ['BP:w3-entschuldigen-sie-erst-jetzt', 'Entschuldigen Sie bitte, dass ich mich erst jetzt melden.', 'wrong', 'verb ending'],
  ['BP:w3-danke-ihnen-hilfe', 'Ich danke Sie für Ihre Hilfe.', 'wrong', 'Sie for Ihnen'],
  ['BP:w3-danke-ihnen-hilfe', 'Ich danke Ihnen für Ihrer Hilfe.', 'wrong', 'case after für'],
  ['BT:t3-feedback-03', 'Bei uns ist das anders: Nur wenige Familien hat ein Haustier.', 'wrong', 'verb agreement'],
  ['BT:t3-feedback-03', 'Bei uns ist das anders: Nur wenige Familie haben ein Haustier.', 'wrong', 'plural'],
  ['BT:t2-reasons-02', 'Zum Beispiel mein Freund wohnt auf dem Land und braucht ein Auto.', 'wrong', 'V2 after zum Beispiel'],
  ['BT:t2-reasons-02', 'Zum Beispiel wohnt mein Freund auf das Land und braucht ein Auto.', 'wrong', 'das for dem'],
  ['BT:t2-conclude-02', 'Zusammenfassend kann man sagen, dass beide Seiten Vorteile hat.', 'wrong', 'verb agreement'],
  ['BT:t3-clarify-01', 'Könnten Sie die Frage bitte wiederholt?', 'wrong', 'participle for infinitive'],
  ['BT:forum-weigh-03', 'Einerseits ist Online-Lernen flexibel, andererseits fehlt den Kontakt zu den anderen.', 'wrong', 'den for der'],
  ['BT:t2-conclude-01', 'Meiner Meinung nach das Homeoffice ist eine gute Sache.', 'wrong', 'V2'],
  ['BT:t2-conclude-01', 'Meine Meinung nach ist das Homeoffice eine gute Sache.', 'wrong', 'Meine for Meiner'],
  ['BG:passive-loesen', 'Das Problem lasst sich leicht lösen.', 'wrong', 'lasst (ihr) for lässt'],
  ['BG:wo-wovor-angst', 'Wovor sie hat Angst?', 'wrong', 'word order'],
  ['BG:v2-deshalb-komme-nicht', 'Deshalb ich komme heute nicht.', 'wrong', 'V2'],
  ['BG:v2-deshalb-komme-nicht', 'Deshalb kommt ich heute nicht.', 'wrong', 'verb ending'],
  ['BG:vf-dass-sehen-bald', 'Ich hoffe, dass wir uns bald sieht.', 'wrong', 'verb form'],
  ['BG:vf-obwohl-krank', 'Ich gehe zur Arbeit, obwohl ich bin krank.', 'wrong', 'verb not at the end'],
  ['BG:perfekt-bekommen', 'Ich habe eine Antwort gebekommen.', 'wrong', 'participle'],
  ['BG:perfekt-bekommen', 'Ich bin eine Antwort bekommen.', 'wrong', 'sein for haben'],
  ['BL:rules-gebuehr', 'Der Gebühr', 'wrong', 'gender'],
  ['G:fuer-vor.13', 'vor', 'wrong', 'vor for für'],
  ['G:konjunktiv-2-haette-waere.02', 'war', 'wrong', 'past for Konjunktiv'],
  ['G:konjunktiv-2-haette-waere.02', 'ware', 'wrong', 'Ware, not wäre'],
  ['G:konjunktiv-2-haette-waere.02', 'wärst', 'wrong', 'person'],
  ['G:neutrum-ma-nomen.14', 'die Thema', 'wrong', 'singular'],
  ['G:neutrum-ma-nomen.14', 'die Themas', 'wrong', 'plural'],
  ['G:neutrum-ma-nomen.14', 'der Themen', 'wrong', 'article'],
  ['G:perfekt.04', 'Sie hat das Gespräch vorbereiten.', 'wrong', 'infinitive for participle'],
  ['G:perfekt.04', 'Sie hat das Gespräch gevorbereitet.', 'wrong', 'participle'],
  ['G:obwohl-trotzdem.05', 'Obwohl er keine Lust hat, er kommt mit.', 'wrong', 'inversion'],
  ['G:trennbare-verben.02', 'Er kaufen im Supermarkt ein.', 'wrong', 'verb ending'],
  ['G:genitiv.05', 'das Haus meinen Eltern', 'wrong', 'genitive'],
  ['G:genitiv.05', 'das Haus meines Eltern', 'wrong', 'genitive plural'],
  ['K:ENG_CHUNK_0700', 'Mir haben das Essen, die Leute und vor allem die Strände gefallt.', 'wrong', 'participle'],
  ['K:ENG_CHUNK_0700', 'Mich haben das Essen, die Leute und vor allem die Strände gefallen.', 'wrong', 'Mich for Mir'],
  ['K:ENG_CHUNK_0291', 'Am Anfang fand ich den neue Job furchtbar, aber jetzt gefällt er mir richtig gut.', 'wrong', 'adjective ending'],
  ['K:ENG_CHUNK_0291', 'Am Anfang ich fand den neuen Job furchtbar, aber jetzt gefällt er mir richtig gut.', 'wrong', 'V2'],
  ['K:ENG_CHUNK_0177', 'Es ist teuer, aber es hält jahrelang. Das stimmen.', 'wrong', 'verb ending'],
  ['K:ENG_CHUNK_0432', 'Was mir an diesem Café gefällt, ist, dass es ist nie voll.', 'wrong', 'verb not at the end'],
  ['K:ENG_CHUNK_0432', 'Was mich an diesem Café gefällt, ist, dass es nie voll ist.', 'wrong', 'mich for mir'],
  ['K:ENG_CHUNK_0066', 'Ehrlich gesagt hat mir der Film nicht so gefallt.', 'wrong', 'participle'],
  ['K:ENG_CHUNK_0066', 'Ehrlich gesagt hat mich der Film nicht so gefallen.', 'wrong', 'mich for mir'],
  ['K:ENG_CHUNK_0644', 'Darf ich ein Vorschlag machen? Lass uns heute Thai bestellen.', 'wrong', 'ein for einen'],
  // right
  ['BP:s1-dann-machen-wir-das-so', 'Okay, dann machen wir es so.', 'right', 'es for das'],
  ['BP:s1-dann-machen-wir-das-so', 'Ok, dann machen wir das so.', 'right', 'Ok'],
  ['BP:w1-entschuldige-erst-jetzt', 'Entschuldige, dass ich mich erst jetzt melde.', 'right', 'without bitte'],
  ['BP:w1-freue-mich-deine-antwort', 'Ich freue mich schon auf deine Antwort.', 'right', 'with schon'],
  ['BP:w3-termin-verschieben-dienstag', 'Könnten wir den Termin bitte auf Dienstag um 10 Uhr verschieben?', 'right', 'with bitte'],
  ['BP:w3-termin-verschieben-dienstag', 'Können wir den Termin auf Dienstag um 10 Uhr verschieben?', 'right', 'können'],
  ['BP:s3-ich-wuerde-empfehlen-weil', 'Ich würde einen kleinen Hund empfehlen, denn er braucht nicht viel Platz.', 'right', 'denn + V2'],
  ['BP:w3-danke-ihnen-hilfe', 'Vielen Dank für Ihre Hilfe.', 'right', 'another wording'],
  ['BT:t3-feedback-03', 'Bei uns ist das anders: Nur wenige Familien haben Haustiere.', 'right', 'plural object'],
  ['BT:t2-conclude-01', 'Ich finde, das Homeoffice ist eine gute Sache.', 'right', 'another opener'],
  ['BG:vf-obwohl-krank', 'Ich gehe zu der Arbeit, obwohl ich krank bin.', 'right', 'zu der = zur'],
  ['BL:rules-gebuehr', 'die Gebühr', 'right', 'lower case'],
  ['G:konjunktiv-2-haette-waere.02', 'Wenn ich du wäre, würde ich das nicht machen.', 'right', 'the sentence'],
  ['G:konjunktiv-2-haette-waere.02', 'waere', 'right', 'ae'],
  ['G:neutrum-ma-nomen.14', 'die Themen', 'right', 'the plural'],
  ['G:obwohl-trotzdem.05', 'Obwohl er keine Lust hat, kommt er mit', 'right', 'no full stop'],
  ['K:ENG_CHUNK_0066', 'Ehrlich gesagt hat mir der Film nicht so gut gefallen.', 'right', 'with gut'],
  ['K:ENG_CHUNK_0644', 'Darf ich einen Vorschlag machen? Lasst uns heute Thai bestellen.', 'right', 'lasst uns (to several people)'],
  ['K:ENG_CHUNK_0700', 'Mir haben das Essen, die Leute und besonders die Strände gefallen.', 'right', 'besonders'],
];

/* ---------- Schreiben: answers written by hand, the way a B1 candidate writes them ---------- */
// [item id, answer, want, the error or why it is right]. BX: ids are Build an email lines (task-part).
export const SCHREIBEN_HELD = [
  ['BS:a3-tut-mir-leid-aber', 'Es tut mir sehr leid, aber kann ich nicht zum Gespräch kommen.', 'wrong', 'aber + verb first'],
  ['BS:a3-leider-nicht-teilnehmen', 'Leider, ich kann am Samstag nicht am Workshop teilnehmen.', 'wrong', 'comma and subject after Leider'],
  ['BS:a3-dank-ihre-email', 'Danke für ihre E-Mail.', 'wrong', 'ihre in lower case'],
  ['BS:a3-mfg', 'Mit freundlichen Grußen', 'wrong', 'umlaut in Grüßen'],
  ['BS:a3-mfg', 'Mit freundliche Grüße', 'wrong', 'ending after mit'],
  ['BS:a3-waere-es-moeglich', 'Ist es möglich, die Besprechung später haben?', 'wrong', 'no zu, no time'],
  ['BS:a1-lieber-jonas', 'Liebe Jonas,', 'wrong', 'Jonas is a man'],
  ['BS:a1-hoffe-es-geht-dir-gut', 'Ich hoffe das du gut bist.', 'wrong', 'du bist gut is English'],
  ['BS:a1-passt-dir', 'Passt dir Freitag um 18:00h?', 'wrong', '18:00h for 18 Uhr'],
  ['BS:a1-uebrigens-umgezogen', 'Übrigens bin ich in meiner neuen Wohnung gezogen.', 'wrong', 'dative after in with movement'],
  ['BS:a2-meiner-meinung-nach-v2', 'Meiner Meinung nach, die Vier-Tage-Woche ist gut für viele Menschen.', 'wrong', 'comma and V2'],
  ['BS:a2-zum-beispiel-v2', 'Zum Beispiel, viele Menschen arbeiten von zu Hause aus.', 'wrong', 'V2 after zum Beispiel'],
  ['BS:a2-am-ende-muss-jeder', 'Am Ende, jeder muss selbst entscheiden.', 'wrong', 'V2 after Am Ende'],
  ['BS:a2-es-kommt-darauf-an', 'Es ist abhängig von dem Beruf.', 'wrong', 'abhängig sein von for ankommen auf'],
  ['BX:a1-umzug-p1', 'Die Wohnung ist schön. Außerdem es gibt viele Cafés.', 'wrong', 'V2 after Außerdem'],
  ['BX:a1-umzug-p2', 'Der Umzug war anstrengend, weil wir haben keinen Aufzug.', 'wrong', 'verb not at the end'],
  ['BX:a1-umzug-p2', 'Der Umzug war anstrengend, weil wir wohnen im vierten Stock.', 'wrong', 'verb not at the end (a verb from the word list)'],
  ['BX:a1-neue-stelle-p2', 'Die Arbeit ist zwar hart, aber macht sie mir Spaß.', 'wrong', 'aber + verb first'],
  ['BX:a1-neue-stelle-p3', 'Wie wäre es, wenn wir gehen am Sonntag ins Kino?', 'wrong', 'verb not at the end'],
  ['BX:a2-vier-tage-woche-p3', 'Zum Beispiel meine Schwester arbeitet nur vier Tage.', 'wrong', 'V2 after Zum Beispiel'],
  ['BX:a2-vier-tage-woche-p5', 'Deshalb finde ich, dass wir sollten es testen.', 'wrong', 'verb not at the end'],
  ['BX:a2-wohnen-stadt-p2', 'Das Leben auf dem Land ist zwar billiger, aber gibt es dort weniger Arbeit.', 'wrong', 'aber + verb first'],
  ['BX:a3-gespraech-verschieben-p1', 'Es tut mir leid, aber kann ich nicht kommen.', 'wrong', 'aber + verb first'],
  ['BX:a3-gespraech-verschieben-p2', 'Der Grund ist, dass ich habe einen Termin in Hamburg.', 'wrong', 'verb not at the end'],
  ['BX:a3-laerm-nachbar-p3', 'In Zukunft ich informiere alle Nachbarn vorher.', 'wrong', 'V2 after In Zukunft'],
  ['BX:a3-kurs-anfrage-p2', 'Ich würde gern wissen, ob der Kurs findet abends statt.', 'wrong', 'separable verb not at the end'],
  // the German review, round 2: polite forms in lower case (ihnen = them, ihre = her, sie = she), agreement, word order
  ['BS:a3-dank-ihre-email', 'Ich danke ihnen für Ihre E-Mail.', 'wrong', 'ihnen in lower case'],
  ['BS:a3-einladung-zum-gespraech', 'Vielen Dank für ihre Einladung zum Gespräch am Montag.', 'wrong', 'ihre in lower case'],
  ['BS:a3-moechte-mich-entschuldigen', 'Ich möchte mich bei ihnen dafür entschuldigen.', 'wrong', 'ihnen in lower case'],
  ['BS:a3-interessiere-mich-kurs', 'Ich habe Interesse an ihrem Abendkurs.', 'wrong', 'ihrem in lower case'],
  ['BS:a3-wuerde-ihnen-passen', 'Hätten sie am Dienstag um 10 Uhr Zeit?', 'wrong', 'sie in lower case'],
  ['BS:a3-in-zukunft', 'In Zukunft informiere ich sie vorher.', 'wrong', 'sie in lower case'],
  ['BS:a3-dank-im-voraus', 'Ich danke ihnen im Voraus.', 'wrong', 'ihnen in lower case'],
  ['BS:a3-dank-verstaendnis', 'Ich danke ihnen für Ihr Verständnis.', 'wrong', 'ihnen in lower case'],
  ['BS:a3-dank-bisherige-hilfe', 'Ich danke ihnen für Ihre bisherige Hilfe.', 'wrong', 'ihnen in lower case'],
  ['BP:w3-danke-ihre-einladung', 'Ich danke ihnen sehr für Ihre Einladung.', 'wrong', 'ihnen in lower case'],
  ['BP:w3-hoffe-verstaendnis', 'Ich bitte sie um Verständnis.', 'wrong', 'sie in lower case'],
  ['BP:w3-freue-mich-ihre-antwort', 'Ich freue mich, von ihnen zu hören.', 'wrong', 'ihnen in lower case'],
  ['BX:a3-gespraech-verschieben-p1', 'Entschuldigen sie bitte, aber ich kann an diesem Termin nicht kommen.', 'wrong', 'sie in lower case'],
  ['BX:a3-gespraech-verschieben-p3', 'Hätten sie am Dienstag um 10 Uhr Zeit?', 'wrong', 'sie in lower case'],
  ['BX:a3-gespraech-verschieben-close', 'Ich danke ihnen für Ihr Verständnis.', 'wrong', 'ihnen in lower case'],
  ['BX:a3-kurs-anfrage-p2', 'Könnten sie mir sagen, ob der Kurs auch abends stattfindet?', 'wrong', 'sie in lower case'],
  ['BX:a3-kurs-anfrage-close', 'Ich danke ihnen im Voraus.', 'wrong', 'ihnen in lower case'],
  ['BS:a2-liegt-daran-dass', 'Das liegt daran, dass viele Menschen zu viel arbeitet.', 'wrong', 'plural subject, singular verb'],
  ['BS:a1-zuerst-dann', 'Zuerst haben wir die Kartons gepackt und dann wir haben alles getragen.', 'wrong', 'V2 after dann'],
  ['BS:a1-nicht-alles-geklappt', 'Leider lief nicht alles.', 'wrong', 'unfinished: lief nicht alles glatt'],
  ['BS:a2-da-teuer', 'Da Busse und Bahnen teuer sind, viele Leute fahren lieber mit dem Auto.', 'wrong', 'no inversion after the da clause'],
  ['BX:a2-vier-tage-woche-p1', 'Ich stimme Rainer zu.', 'wrong', 'the cue says he sees it differently'],
  ['BX:a3-laerm-nachbar-p1', 'Es tut mir leid, dass es so laut war gewesen.', 'wrong', 'verb not at the end'],
  ['BX:a3-laerm-nachbar-p2', 'Es war so laut, weil wir haben gefeiert.', 'wrong', 'haben second in a weil clause'],
  ['BX:a3-kurs-anfrage-p2', 'Ich würde gern wissen, ob kann man den Kurs abends machen.', 'wrong', 'verb right after ob'],
  ['BX:a1-neue-stelle-p3', 'Wie wäre es, wenn wir am Sonntag gehen zusammen essen?', 'wrong', 'finite verb before the infinitive in a wenn clause'],
  // round 3: wrong answers aimed at the new rest-of-sentence rules (particles in slots, another accepted sentence,
  // words borrowed from the model) and at the new accepted patterns
  ['BS:a3-tut-mir-leid-aber', 'Es tut mir sehr leid, aber ich kann nicht zum Gespräch teilnehmen.', 'wrong', 'teilnehmen an, not zu (borrowed slot words)'],
  ['BS:a2-rainer-schreibt-dass', 'Rainer meint, Menschen mit einer Vier-Tage-Woche faul sind.', 'wrong', 'verb last without dass'],
  ['BS:a1-hoffe-es-geht-dir-gut', 'Ich hoffe, es dir gut geht.', 'wrong', 'verb last without dass'],
  ['BS:a1-denn', 'Ich kann leider nicht kommen, weil ich muss arbeiten.', 'wrong', 'verb not at the end after weil'],
  ['BS:a2-stimme-teilweise-zu', 'Ich nur stimme Rainer teilweise zu.', 'wrong', 'a particle before the verb'],
  ['BS:a1-obwohl', 'Die Wohnung gefällt mir sehr gut, obwohl sie ist klein.', 'wrong', 'verb not at the end after obwohl'],
  ['BX:a3-laerm-nachbar-p1', 'Ich möchte mich für den Lärm am Samstag entschuldige.', 'wrong', 'infinitive ending'],
  ['BS:a1-hast-du-lust', 'Hast du am Samstag Lust, mit mir ins Kino gehen?', 'wrong', 'no zu'],
  ['BS:a1-einverstanden-dann', 'Einverstanden! Dann wir treffen uns um sieben.', 'wrong', 'V2 after dann'],
  ['BS:a2-deshalb-glaube-ich', 'Daher glaube ich, dass die Vier-Tage-Woche ist eine gute Idee.', 'wrong', 'verb not at the end after dass'],
  ['BS:a3-wuerde-ihnen-passen', 'Passt es Sie am Dienstag um 10 Uhr?', 'wrong', 'Sie for Ihnen'],
  ['BS:a1-dank-deine-email', 'Vielen lieben Dank für deine lieben E-Mail.', 'wrong', 'adjective ending'],
  ['BS:a2-als-ich-student-war', 'Als ich Student war, ich arbeitete am Wochenende.', 'wrong', 'no inversion after the als clause'],
  ['BS:a3-in-zukunft', 'In Zukunft gebe ich Sie vorher Bescheid.', 'wrong', 'Sie for Ihnen'],
  ['BS:a2-bin-dagegen-dass', 'Ich bin gegen die Abschaffung der Bargelds.', 'wrong', 'genitive article'],
  ['BS:a1-uebrigens-umgezogen', 'Übrigens bin ich in einer neuen Wohnung umgezogen.', 'wrong', 'dative after in with movement'],
  ['BS:a2-beispiel-dafuer', 'Mein Bruder ist ein guter Beispiel dafür.', 'wrong', 'adjective ending'],
  ['BS:a1-kann-dir-empfehlen', 'Dieses Handy kann ich dich wirklich empfehlen.', 'wrong', 'dich for dir'],
  ['BS:a1-schlage-vor-dass', 'Ich würde vorschlagen, dass wir treffen uns am Bahnhof.', 'wrong', 'verb not at the end after dass'],
  ['BS:a1-wie-du-weisst', 'Wie du weißt, ich bin letzten Monat nach Hamburg umgezogen.', 'wrong', 'no inversion after the wie clause'],
  ['BS:a1-trotzdem', 'Die Wohnung ist klein. Dennoch ich fühle mich dort wohl.', 'wrong', 'V2 after dennoch'],
  ['BS:a1-gern-kommen-aber', 'Ich würde sehr gern kommen, aber am Samstag ich habe schon etwas vor.', 'wrong', 'V2 after am Samstag'],
  ['BS:a1-du-solltest', 'Du solltest unbedingt eine warme Jacke mitnimmst.', 'wrong', 'finite verb for the infinitive'],
  // right
  // the German review, round 2: plain right answers that were graded wrong
  ['BS:a1-toll-dass-stelle', 'Toll, dass du den Job bekommen hast!', 'right', 'den Job'],
  ['BS:a1-freut-mich-zu-hoeren', 'Schön, dass du eine neue Wohnung gefunden hast.', 'right', 'Schön, dass'],
  ['BS:a1-gefreut-ueber-email', 'Ich habe mich sehr über deine Mail gefreut.', 'right', 'Mail'],
  ['BS:a1-dank-deine-email', 'Vielen Dank für deine Mail.', 'right', 'Mail'],
  ['BS:a3-dank-ihre-email', 'Vielen Dank für Ihre Mail.', 'right', 'Mail'],
  ['BS:a1-wollte-dir-erzaehlen', 'Ich wollte dir kurz erzählen, wie mein Umzug gelaufen ist.', 'right', 'mein Umzug'],
  ['BS:a1-tut-mir-leid-dass', 'Es tut mir leid, dass ich nicht zu deiner Geburtstagsparty kommen konnte.', 'right', 'Geburtstagsparty'],
  ['BS:a1-gruesse-familie', 'Grüß deine Familie!', 'right', 'without von mir'],
  ['BS:a2-bin-dagegen-dass', 'Ich bin dagegen, dass das Bargeld abgeschafft wird.', 'right', 'passive'],
  ['BS:a2-es-kommt-darauf-an', 'Es kommt auf den Job an.', 'right', 'Job'],
  ['BX:a1-absage-geburtstag-p2', 'Leider kann ich nicht kommen, weil meine Eltern zu Besuch kommen.', 'right', 'no time word'],
  ['BX:a1-absage-geburtstag-p2', 'Ich kann leider nicht kommen, weil meine Eltern zu Besuch kommen.', 'right', 'no time word'],
  ['BX:a1-umzug-intro', 'Vielen Dank für deine Mail!', 'right', 'Mail'],
  ['BX:a3-gespraech-verschieben-p3', 'Hätten Sie am Dienstag um 10 Uhr Zeit?', 'right', 'Sie with a capital'],
  ['BS:a3-mfg', 'Mit freundlichen Gruessen', 'right', 'ue and ss'],
  ['BS:a1-lieber-jonas', 'Lieber Jonas,', 'right', 'the model'],
  ['BS:a2-sehe-das-anders-als', 'Ich sehe das ganz anders als Rainer.', 'right', 'with ganz'],
  ['BS:a3-tut-mir-leid-aber', 'Es tut mir leid, aber ich kann leider nicht zum Gespräch kommen.', 'right', 'with leider'],
  ['BX:a1-umzug-p1', 'Die Wohnung ist klein, aber gemütlich. Außerdem habe ich jetzt einen Balkon.', 'right', 'other words'],
  ['BX:a1-umzug-p2', 'Der Umzug war ziemlich stressig, weil es den ganzen Tag geregnet hat.', 'right', 'other reason'],
  ['BX:a1-umzug-p2', 'Leider war der Umzug sehr teuer, denn wir haben eine Firma bezahlt.', 'right', 'denn'],
  ['BX:a1-neue-stelle-p2', 'Mein Chef ist zwar streng, aber er ist immer fair.', 'right', 'other words'],
  ['BX:a1-neue-stelle-p3', 'Wie wäre es, wenn wir am Samstag zusammen kochen?', 'right', 'other plan'],
  ['BX:a2-vier-tage-woche-p3', 'Zum Beispiel arbeitet mein Kollege seit einem Jahr nur vier Tage.', 'right', 'other example'],
  ['BX:a2-vier-tage-woche-p5', 'Deshalb finde ich, dass jede Firma die Vier-Tage-Woche testen sollte.', 'right', 'other words'],
  ['BX:a3-gespraech-verschieben-p1', 'Es tut mir sehr leid, aber ich habe an diesem Tag schon einen Termin.', 'right', 'other reason'],
  ['BX:a3-gespraech-verschieben-p2', 'Der Grund ist, dass ich an diesem Tag zum Arzt muss.', 'right', 'other reason'],
  ['BX:a3-laerm-nachbar-p2', 'Es war so laut, weil wir meinen Geburtstag gefeiert haben und viele Gäste da waren.', 'right', 'two clauses'],
  ['BX:a3-laerm-nachbar-p3', 'In Zukunft sage ich allen Nachbarn vorher Bescheid.', 'right', 'Bescheid sagen'],
];

/* ---------- right variants made from a model sentence (round 3): swaps that keep the German right ---------- */
// Each one is right wherever the model has the word: deshalb and deswegen are only ever the causal adverb (unlike
// darum, daher), trotzdem/dennoch, E-Mail/Mail, a sentence-initial Vielen/Herzlichen Dank, and the Präteritum of sein
// and haben for their Perfekt (ist … gewesen → war, hat … gehabt → hatte), which keeps the verb's place.
const PRAET = { bin: 'war', bist: 'warst', ist: 'war', sind: 'waren', seid: 'wart', habe: 'hatte', hast: 'hattest', hat: 'hatte', haben: 'hatten', habt: 'hattet' };
/** @param {string} s @returns {{cls: string, text: string}[]} */
export function variantsOf(s) {
  const out = [];
  const swap = (/** @type {RegExp} */ re, /** @type {string} */ to, /** @type {string} */ cls) => {
    if (!re.test(s)) return;
    out.push({ cls, text: s.replace(re, w => /^\p{Lu}/u.test(w) ? to[0].toUpperCase() + to.slice(1) : to) });
  };
  swap(/(?<![\p{L}-])[Dd]eshalb(?![\p{L}-])/gu, 'deswegen', 'variant (auto): deshalb → deswegen');
  swap(/(?<![\p{L}-])[Dd]eshalb(?![\p{L}-])/gu, 'daher', 'variant (auto): deshalb → daher');
  swap(/(?<![\p{L}-])[Dd]eswegen(?![\p{L}-])/gu, 'deshalb', 'variant (auto): deswegen → deshalb');
  swap(/(?<![\p{L}-])[Tt]rotzdem(?![\p{L}-])/gu, 'dennoch', 'variant (auto): trotzdem → dennoch');
  swap(/(?<![\p{L}-])E-Mail(?![\p{L}-])/gu, 'Mail', 'variant (auto): E-Mail → Mail');
  if (/^Vielen Dank\b/.test(s)) out.push({ cls: 'variant (auto): Herzlichen Dank', text: s.replace(/^Vielen Dank/, 'Herzlichen Dank') });
  // Perfekt of sein/haben → Präteritum, one clause at a time
  for (const [part, cls] of [['gewesen', 'variant (auto): ist … gewesen → war'], ['gehabt', 'variant (auto): hat … gehabt → hatte']]) {
    const T = toks(s), k = T.findIndex(t => t.w === part);
    if (k < 0) continue;
    // the auxiliary of the same clause: before the participle, after the last comma or full stop before it
    const from = Math.max(0, ...[...s.slice(0, T[k].i).matchAll(/[,.;:!?]/g)].map(m => /** @type {number} */ (m.index)));
    const aux = [...T.slice(0, k + 2)].filter(t => t.i >= from && PRAET[t.w.toLowerCase()] && (part === 'gewesen' ? /^(bin|bist|ist|sind|seid)$/i : /^(habe|hast|hat|haben|habt)$/i).test(t.w));
    if (aux.length !== 1) continue;
    const a = aux[0], p = T[k];
    const nw = PRAET[a.w.toLowerCase()], rep = /^\p{Lu}/u.test(a.w) ? nw[0].toUpperCase() + nw.slice(1) : nw;
    // the auxiliary after the participle (verb-final clause): "… krank gewesen ist" → "… krank war"
    const text = a.i > p.i ? s.slice(0, p.i) + rep + s.slice(a.e) : s.slice(0, a.i) + rep + s.slice(a.e, p.i).replace(/\s+$/, '') + s.slice(p.e);
    out.push({ cls, text });
  }
  const seen = new Set([s]);
  return out.filter(x => !seen.has(x.text) && seen.add(x.text));
}

/* ---------- the corpus ---------- */
const typeOf = it => {
  if (it.layer === 'b2') return it.kind === 'grammar' ? (it.gap ? 'B2 grammar gap' : 'B2 grammar transform') : setOf(it) === 'B2 collocations' ? 'B2 collocation' : 'B2 phrase';
  if (it.src === 'wordbuild') return `word building ${it.wb}`;
  if (it.src === 'script') return it.gap ? 'script word gap' : 'script word meaning';
  if (it.area === 'clusters') return `cluster ${it.kind}`;
  if (it.src === 'build') return 'schreiben email line';
  if (it.area === 'writing') return 'schreiben phrase';
  if (it.area === 'mistakes') return 'mistake';
  if (it.area === 'words') return it.showGap ? 'word-article' : it.gap ? 'word-gap' : 'word dictionary form';
  if (it.kind === 'phrase') return it.bank ? 'phrase (bank)' : 'phrase';
  if (it.kind === 'topic' || it.kind === 'reply') return 'situation';
  if (it.kind === 'reading') return 'reading';
  if (it.kind === 'grammar' && it.id.startsWith('G:')) return it.gap ? 'grammar gap' : `grammar ${it.plan === 'transform' ? 'transform' : 'translate/order'}`;
  if (it.kind === 'grammar') return it.anywhere ? 'grammar (say it)' : it.gap ? 'grammar gap' : 'grammar transform';
  return it.kind;
};

/** A module of the code under codeRoot: its path now, or where it was before Practice was split (round 3). @param {string} root @param {string} now @param {string} before */
const codeFile = (root, now, before) => path.join(root, existsSync(path.join(root, now)) ? now : before);

/** The item pool as the code under codeRoot builds it (with the synthetic exam words and corrections). */
export async function buildData({ root = ROOT, codeRoot = ROOT } = {}) {
  const { buildPool } = await import(pathToFileURL(codeFile(codeRoot, 'src/features/shared/pool.js', 'src/features/practice/pool.js')).href);
  const W = await import(pathToFileURL(codeFile(codeRoot, 'src/features/shared/words.js', 'src/features/practice/words.js')).href);
  const content = { items: J(root, 'content/b1/items.json'), grammar: J(root, 'content/b1/grammar.json'), bank: J(root, 'content/b1/bank.json'), plan: J(root, 'content/b1/plan.json'), nouns: J(root, 'content/b1/nouns.json') };
  const mistakes = SYN_MISTAKES.map(([wrong, right], i) => ({ id: `F:corpus-${i}`, v: 1, wrong, right, rule: '', source: { attemptId: 'corpus', test: 1, module: 'schreiben', label: null }, createdAt: '2026-10-01T10:00:00Z', deletedAt: null }));
  // exam words: the card that asks for the dictionary form (with the forms index when the code under test has one)
  let wx = {};
  try {
    const F = await import(pathToFileURL(path.join(codeRoot, 'src/domain/forms.js')).href);
    if (F.formsIndex) { const ix = F.formsIndex(J(root, 'content/igloo/words/de.json'), J(root, 'content/b1/forms.json')); wx = { ix, verbs: F.verbSet(ix) }; }
  } catch { /* code or content from before the forms table */ }
  const words = SYN_WORDS.map(w => W.toItem({ id: `W:corpus-${w.lemma}`, lemma: w.lemma, art: w.art, pl: null, pos: w.pos, gloss: ['x'], sent: w.sent, form: w.form, ex: null, cluster: null, day: 1, module: 'lesen', teil: null, examDays: 1, level: 'B1', conf: null, zipf: 3 }, wx)).filter(Boolean);
  let schreiben = null;
  try { schreiben = J(root, 'content/b1/schreiben.json'); } catch { /* a checkout from before the Schreiben content */ }
  // the B2 layer (pool.js b2Layer): its grammar items and phrases, graded as the round grades them (round 4)
  let b2 = null;
  try {
    b2 = { grammar: J(root, 'content/igloo/grammar/items_de.json'), concepts: J(root, 'content/igloo/grammar/concepts_de.json'), annot: J(root, 'content/b1/annot.json'),
      en: J(root, 'content/igloo/chunks/en.json'), de: J(root, 'content/igloo/chunks/german.json').chunks, accept: J(root, 'content/igloo/chunks/accept_german.json') };
  } catch { /* a checkout from before the B2 layer */ }
  let formsTable = null;
  try { formsTable = J(root, 'content/b1/forms.json'); } catch { /* none */ }
  const data = buildPool({ ...content, mistakes, words, schreiben, b2, forms: formsTable, lexWords: J(root, 'content/igloo/words/de.json'), lexTexts: Object.values(J(root, 'content/igloo/chunks/german.json').chunks).map(c => c.ex).filter(Boolean) });
  if (!data.b2) data.b2 = [];
  // the phrase's function group (collocation, opinion …) for the report's sets
  try { const ch = J(root, 'content/igloo/chunks/german.json').chunks; for (const it of data.b2) if (it.id.startsWith('K:')) it.b2fn = (ch[it.id.slice(2)] || {}).fn || null; } catch { /* no chunks */ }
  // Build an email: every line of every task as the item the builder grades (features/practice-write/build.js partItem)
  /** @type {any[]} */ const parts = [];
  if (schreiben) {
    try {
      const B = await import(pathToFileURL(codeFile(codeRoot, 'src/features/practice-write/build.js', 'src/features/practice/build.js')).href);
      for (const t of schreiben.tasks) for (const p of t.parts) { const it = { ...B.partItem(t, p), model: B.modelLine(p), lower: p.lower }; parts.push(it); data.byId.set(it.id, it); }
    } catch { /* code from before the builder */ }
  }
  // Word clusters: the cards of every cluster, built as the round builds them (clusters/items.js itemFor). Every
  // opposite, family and preposition card; the meaning → word cards of topics, prefixes and suffixes one in four.
  /** @type {any[]} */ const clusters = [];
  try {
    const { index } = await import(pathToFileURL(path.join(codeRoot, 'src/domain/clusters.js')).href);
    const CI = await import(pathToFileURL(codeFile(codeRoot, 'src/features/shared/cluster-items.js', 'src/features/practice/clusters/items.js')).href);
    const cc = J(root, 'content/clusters/de.json'), ix = index(cc, J(root, 'content/igloo/words/de.json'));
    let k = 0;
    const ids = new Set();
    for (const cl of ix.all) for (const id of CI.cardIds(cl, ix)) if (!id.startsWith('W:') || cl.type === 'family' || k++ % 4 === 0) ids.add(id);
    for (const id of ids) {
      const it = CI.itemFor(id, ix, cc, { t: (/** @type {string} */ key) => key });
      if (it && !data.byId.has(id)) { it.cluster = cl0(ix, id); clusters.push(it); data.byId.set(id, it); }
    }
  } catch (e) { if (!/Cannot find module|ERR_MODULE_NOT_FOUND/.test(String(e))) throw e; }
  // Script mode: synthetic script words, the two cards script/words.js makes (his sentence with a gap; the meaning)
  /** @type {any[]} */ const script = SYN_SCRIPT.map(([sentence, surface, lemma, art, gloss], i) => {
    const at = sentence.indexOf(surface);
    return { id: `SW:corpus-${i}-gap`, kind: 'word', area: 'words', src: 'script', prompt: `${sentence.slice(0, at)}___${sentence.slice(at + surface.length)}`, promptLang: 'de',
      gap: true, literal: true, loose: true, anywhere: false, strict: [], accept: [surface], model: sentence, gloss, task: null, surface, lemma, art };
  }).concat(SYN_SCRIPT.map(([, , lemma, art, gloss], i) => {
    const a = art ? `${art} ${lemma}` : lemma;
    return { id: `SW:corpus-${i}-meaning`, kind: 'word', area: 'words', src: 'script', prompt: gloss, promptLang: 'en', gap: false, literal: true, anywhere: false, strict: [],
      accept: [a], model: a, gloss: null, task: null, lemma, art };
  }));
  for (const it of script) data.byId.set(it.id, it);
  // Word building (deck 'build'): every typed card as the round grades it (domain/wordbuild-grade.js): the verb from
  // its meaning (PV), the verb pieces of every sentence frame (PS), every chain word with its article (PW)
  /** @type {any[]} */ const wordbuild = [];
  try {
    const W = await import(pathToFileURL(path.join(codeRoot, 'src/domain/wordbuild.js')).href);
    const G = await import(pathToFileURL(path.join(codeRoot, 'src/domain/wordbuild-grade.js')).href);
    const bc = J(root, 'content/build/de.json');
    for (const v of bc.verbs) wordbuild.push({ id: `PV:${v.id}`, src: 'wordbuild', wb: 'verb', accept: G.pvAccept(v), v, siblings: bc.verbs.filter(x => x.root === v.root && x.pre !== v.pre).map(x => W.bare(x.inf)) });
    for (const f of bc.frames) for (const form of W.FORMS) if (f.forms[form]) wordbuild.push({ id: `PS:${f.id}.${form}`, src: 'wordbuild', wb: 'sentence', accept: [W.gapped(f, form).answer], f, form });
    for (const n of W.pwNodes(bc)) wordbuild.push({ id: `PW:${n.word}`, src: 'wordbuild', wb: 'word', accept: [W.pwAnswer(n)], noun: !!n.art, n });
    // word families (round 7): every PF form typed from its clue; siblings are the family's other forms with the same class
    for (const fam of bc.families || []) for (const f of fam.forms) {
      if (!f.card || !f.card.startsWith('PF:')) continue;
      const answer = f.art ? `${f.art} ${f.word}` : f.word;
      wordbuild.push({ id: f.card, src: 'wordbuild', wb: 'family form', accept: [answer], noun: !!f.art, f, fam,
        siblings: fam.forms.filter((/** @type {any} */ x) => x !== f && x.cls === f.cls && x.word !== f.word).map((/** @type {any} */ x) => (x.art ? `${x.art} ${x.word}` : x.word)),
        none: (fam.none || []).map((/** @type {any} */ n) => n.word) });
    }
    for (const it of wordbuild) data.byId.set(it.id, it);
    data.wbLexicon = G.lexiconOf(bc);
  } catch (e) { if (!/Cannot find module|ERR_MODULE_NOT_FOUND|ENOENT/.test(String(e))) throw e; }
  return Object.assign(data, { parts, clusters, script, wordbuild });
}

/** The cluster a card belongs to, for wrong answers drawn from its siblings. @param {any} ix @param {string} id */
function cl0(ix, id) {
  const wid = id.replace(/^(W|CF|CO|CP):/, '').split('~')[0];
  return ix.all.find((/** @type {any} */ c) => (id.startsWith('CP:') ? c.type === 'prep' && (c.gaps || []).some((/** @type {any} */ g) => g.id === wid) : c.items.includes(wid)))?.key || null;
}

/** Synthetic script words (sentence, the word as written, lemma, article, gloss): not from any learner's script. */
export const SYN_SCRIPT = [
  ['Der Rahmen besteht aus leichtem Aluminium.', 'Rahmen', 'Rahmen', 'der', 'frame'],
  ['Wir haben die alten Reifen gestern gewechselt.', 'Reifen', 'Reifen', 'der', 'tyre'],
  ['Mit einer stabilen Kette fährt man sicherer.', 'stabilen', 'stabil', null, 'stable; sturdy'],
  ['Die Bremse quietscht bei Regen ziemlich laut.', 'quietscht', 'quietschen', null, 'to squeak'],
  ['Im Frühling pflanzen wir Tomaten im Garten.', 'pflanzen', 'pflanzen', null, 'to plant'],
  ['Die Bienen sammeln den Nektar der Blüten.', 'Nektar', 'Nektar', 'der', 'nectar'],
  ['Ohne Bestäubung gäbe es weniger Obst.', 'Bestäubung', 'Bestäubung', 'die', 'pollination'],
  ['Das Gerät misst die Temperatur genau.', 'Gerät', 'Gerät', 'das', 'device'],
];

const norm1 = (/** @type {string} */ x) => String(x).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
/** Mutations an item's accepted answers hold (listed by --list accepted-mutation; each one is checked by hand). */
export const acceptedMutations = [];

/** Build the corpus with this checkout's helpers: [{id, type, cls, text, want: 'wrong'|'right', move?}] */
export async function buildCorpus({ root = ROOT } = {}) {
  const lex = lexicon(root);
  const Match = await import(pathToFileURL(path.join(ROOT, 'src/domain/match.js')).href);
  garbage = p => { const r = Match.renderPattern(p); return r.includes('…') ? r.replace('…', 'blorf quazz') : null; };
  const data = await buildData({ root });
  const out = [];
  const add = (it, cls, text, want, move = null) => { if (text && text.trim()) out.push({ id: it.id, type: typeOf(it), set: setOf(it), cls, text, want, move }); };
  for (const it of [...data.pool, ...(data.b2 || []), ...(data.parts || [])]) {
    if (it.kind === 'reply') {
      for (const mv of it.moves) {
        add(it, 'model', mv.model, 'right', mv.key);
        for (const e of errorsIn(mv.model, { lex })) add(it, e.cls, e.text, 'wrong', mv.key);
        for (const p of mv.accept.filter(p => /\[x\]/.test(p)).slice(0, 2)) add(it, 'slot-garbage', garbage(p), 'wrong', mv.key);
      }
      for (const w of it.wrong || []) add(it, 'listed-wrong', w, 'wrong', it.wrong_move);
      continue;
    }
    if (!it.model || /…/.test(it.model)) continue;
    // a B2 phrase card's model is its phrase (Zum Opfer fallen); the sentence he types is the example
    const model = it.layer === 'b2' && it.sentence ? it.sentence : it.model;
    add(it, 'model', model, 'right');
    if (/[äöüß]/.test(model)) add(it, 'ae-oe-ue-ss', umlautSpelled(model), 'right');
    add(it, 'no-punctuation', model.replace(/[.,!?;:]/g, ''), 'right');
    // another accepted phrase in the model sentence (phrase cards): vor allem → besonders. Only phrases of the same
    // shape (same subordinators and inversion words, not sein for haben), without slots or optional words, so the
    // sentence stays right German; written with the model's capitals.
    if (it.anywhere && it.hl && it.kind === 'phrase' && fold(model).length === model.length) {
      const plain = (it.accept || []).filter(p => !/[[(]/.test(p));
      const fm = fold(model);
      const reOf = p => new RegExp(`(?<![a-z])${fold(p).split(/\s+/).join('[\\s,]+')}(?![a-z])`);
      const own = plain.find(p => reOf(p).test(fm));
      if (own) {
        const m = reOf(own).exec(fm);
        const cased = new Map(toks(model).slice(1).map(t => [t.w.toLowerCase(), t.w]));
        for (const w of it.strict || []) if (!cased.has(w.toLowerCase())) cased.set(w.toLowerCase(), w);   // the polite Ihnen of a variant
        for (const n of Object.values(J(root, 'content/b1/nouns.json'))) if (!cased.has(n.toLowerCase())) cased.set(n.toLowerCase(), n);
        // a phrase that ends in aber/denn (tut mir leid, aber) keeps the normal order after it: it cannot stand
        // where an inverting adverb stood (Leider sind wir … → not "Tut mir leid, aber sind wir …")
        const coord = (/** @type {string} */ p) => /\b(aber|denn|und|oder|sondern)$/.test(p.trim());
        // and a phrase with zu stands only where the model's has zu (um Dampf abzulassen, not *um Dampf ablassen)
        const zuOf = (/** @type {string} */ p) => /(^|\s)zu(\s|$)|\S+zu\S+en(\s|$)/.test(p.trim());
        for (const q of plain.filter(q => q !== own && Match.sameShape(Match.shapeOf(q), Match.shapeOf(own)) && coord(q) === coord(own) && zuOf(q) === zuOf(own)).slice(0, 3)) {
          let rep = q.replace(/[\p{L}-]+/gu, w => cased.get(w.toLowerCase()) || w);
          if (m.index === 0 || /[.!?:]\s*$/.test(model.slice(0, m.index))) rep = rep[0].toUpperCase() + rep.slice(1);
          add(it, 'other-phrase', model.slice(0, m.index) + rep + model.slice(m.index + m[0].length), 'right');
        }
      }
    }
    const strict = new Set((it.strict || []).map(fold));
    const carried = it.gap || it.loose ? new Set(Match.gapLoose(it.prompt)) : null;
    const eligible = w => !strict.has(fold(w)) && !Match.CLOSED.has(fold(w)) && (!carried || carried.has(fold(w)));
    const ty = typoIn(model, { lex, eligible }); if (ty) add(it, 'stem-typo', ty, 'right');
    for (const w of it.wrong || []) add(it, 'listed-wrong', w, 'wrong');
    for (const e of errorsIn(model, { lex })) add(it, e.cls, e.text, 'wrong');
    if (it.area === 'writing') for (const e of schreibenErrorsIn(model, { strict: it.strict || [], free: it.kind === 'topic' })) add(it, `schreiben: ${e.cls}`, e.text, 'wrong');
    if (it.gap) {
      // the gap word alone: right, and wrong forms of it
      for (const a0 of (it.accept || []).slice(0, 2)) {
        const at = model.toLowerCase().indexOf(a0.toLowerCase());
        if (at < 0) continue;
        const a = model.slice(at, at + a0.length);   // as written in the sentence
        add(it, 'gap-word', a, 'right');
        for (const e of errorsIn(`${a}`, { lex })) add(it, `gap-${e.cls}`, e.text, 'wrong');
        const n = ART_NEXT[a.toLowerCase()]; if (n) add(it, 'gap-article', n, 'wrong');
        const m = /(en|em|er|es|e)$/.exec(a); if (m && a.length > 4 && !ART_NEXT[a.toLowerCase()]) add(it, 'gap-ending', a.slice(0, -m[1].length) + ADJ_SWAP[m[1]], 'wrong');
      }
    }
    if (it.area === 'words') {
      const w = SYN_WORDS.find(x => `W:corpus-${x.lemma}` === it.id);
      if (it.gap || it.showGap) {   // the gap card (code from before the dictionary-form card)
        if (it.showGap) { for (const a of OTHER_ART[w.art] || []) add(it, 'word-article', `${a} ${w.lemma}`, 'wrong'); add(it, 'word-article-right', `${w.art} ${w.lemma}`, 'right'); }
        else for (const x of w.wrongs) { add(it, 'word-form', x, 'wrong'); add(it, 'word-form-sentence', w.sent.replace(w.form, x), 'wrong'); }
      } else {   // the dictionary form: right as given; an inflected form, another article or a noun without one are wrong
        const noun = !!w.art;
        add(it, 'word-dict-right', noun ? `${w.art} ${w.lemma}` : w.lemma, 'right');
        if (noun) { for (const a of OTHER_ART[w.art] || []) add(it, 'word-article', `${a} ${w.lemma}`, 'wrong'); add(it, 'word-no-article', w.lemma, 'wrong'); }
        // a dropped letter ("Muter") is a typo of the right word, graded as one; inflected forms are the misses
        const typo = (/** @type {string} */ x) => x.length === w.lemma.length - 1 && [...w.lemma].some((_, k) => w.lemma.slice(0, k) + w.lemma.slice(k + 1) === x);
        for (const x of new Set([...w.wrongs, w.form])) if (x !== w.lemma && !typo(x)) add(it, 'word-inflected', noun ? `${w.art} ${x}` : x, 'wrong');
      }
    }
    if (it.area === 'mistakes') {
      add(it, 'retype-wrong', it.wrong[0], 'wrong');
    }
    if (it.anywhere && it.kind !== 'topic') {
      // slot garbage: a slot pattern the model uses, filled with junk
      for (const p of (it.accept || []).filter(p => /\[x\]/.test(p)).slice(0, 2)) add(it, 'slot-garbage', garbage(p), 'wrong');
    }
    if (it.kind === 'topic') for (const p of (it.accept || []).filter(p => /\[x\]/.test(p)).slice(0, 2)) add(it, 'slot-garbage', garbage(p), 'wrong');
  }
  // Word clusters: the answer, its article and siblings
  const clusterOf = new Map();
  for (const it of data.clusters || []) clusterOf.set(it.cluster, [...(clusterOf.get(it.cluster) || []), it]);
  for (const it of data.clusters || []) {
    const acc = new Set(it.accept.map(fold));
    const notAccepted = (/** @type {string} */ x) => x && !acc.has(fold(x));
    if (it.kind === 'prep') {
      for (const a of it.accept) add(it, 'cluster-gap-right', a, 'right');
      add(it, 'cluster-gap-sentence', it.model, 'right');
      const others = [...new Set((clusterOf.get(it.cluster) || []).map(x => x.accept[0]))].filter(notAccepted);
      for (const o of others.slice(0, 3)) add(it, 'cluster-gap-other-prep', o, 'wrong');
      for (const a of it.accept.slice(0, 1)) { const n = ART_NEXT[a.toLowerCase()]; if (notAccepted(n)) add(it, 'cluster-gap-case', n, 'wrong'); }
      continue;
    }
    add(it, 'cluster-model', it.model, 'right');
    if (/[äöüß]/.test(it.model)) add(it, 'cluster-ae-oe-ue-ss', umlautSpelled(it.model), 'right');
    const m = /^(der|die|das) (.+)$/.exec(it.model);
    if (m) for (const a of OTHER_ART[m[1]] || []) if (notAccepted(`${a} ${m[2]}`)) add(it, 'cluster-article', `${a} ${m[2]}`, 'wrong');
    if (it.kind === 'opposite') { if (notAccepted(it.prompt)) add(it, 'cluster-opposite-same', it.prompt, 'wrong'); }
    const sib = (clusterOf.get(it.cluster) || []).map(x => x.model).filter(x => notAccepted(x) && fold(x) !== fold(it.prompt));
    for (const x of sib.slice(0, 2)) add(it, 'cluster-sibling', x, 'wrong');
  }
  // Script words: the gap word and wrong forms of it; the meaning card with a wrong article
  for (const it of data.script || []) {
    if (it.gap) {
      add(it, 'script-gap-word', it.surface, 'right');
      for (const e of errorsIn(it.model, { lex })) add(it, `script-${e.cls}`, e.text, 'wrong');
      const end = /(en|em|er|es|e)$/.exec(it.surface);
      if (end && !it.art && it.surface.length > 4) add(it, 'script-gap-ending', it.surface.slice(0, -end[1].length) + ADJ_SWAP[end[1]], 'wrong');
    } else {
      add(it, 'script-meaning', it.model, 'right');
      if (it.art) for (const a of OTHER_ART[it.art] || []) add(it, 'script-article', `${a} ${it.lemma}`, 'wrong');
    }
  }
  // Word building: the answer and its ae/oe/ue spelling are right; a sibling prefix, the participle or a split
  // infinitive, a wrong helper, ge- or zu in the wrong place, the pieces in the wrong order and a wrong article are not
  for (const it of data.wordbuild || []) {
    const a = it.accept[0];
    add(it, 'wb-answer', a, 'right');
    if (/[äöüß]/.test(a)) add(it, 'wb-ae-oe-ue-ss', umlautSpelled(a), 'right');
    if (it.wb === 'verb') {
      for (const s of it.siblings.slice(0, 3)) add(it, 'wb-sibling-prefix', s, 'wrong');
      const inf = a.replace(/^sich /, '');
      if (it.v.pp !== inf) add(it, 'wb-participle', it.v.pp, 'wrong');   // vergeben, ergeben: the participle is the infinitive
      if (it.v.kind === 's') add(it, 'wb-split', `${it.v.pre} ${inf.slice(it.v.pre.length)}`, 'wrong');
      add(it, 'wb-root-only', inf.slice(it.v.pre.length), 'wrong');
      const ty = typoIn(inf, { lex, eligible: () => true }); if (ty) add(it, 'wb-typo', ty, 'wrong');
    } else if (it.wb === 'sentence') {
      const pieces = a.split(' ');
      if (pieces.length > 1) add(it, 'wb-order', [...pieces].reverse().join(' '), 'wrong');
      if (it.form === 'perf') {
        const aux = pieces[0], swap = { habe: 'bin', bin: 'habe', hat: 'ist', ist: 'hat', haben: 'sind', sind: 'haben' }[aux];
        if (swap) add(it, 'wb-helper', [swap, ...pieces.slice(1)].join(' '), 'wrong');
        const pp = pieces[pieces.length - 1];
        if (it.f.kind === 's' && pp.startsWith(`${it.f.pre}ge`)) {
          add(it, 'wb-ge-outside', [...pieces.slice(0, -1), `ge${it.f.pre}${pp.slice(it.f.pre.length + 2)}`].join(' '), 'wrong');
          add(it, 'wb-no-ge', [...pieces.slice(0, -1), `${it.f.pre}${pp.slice(it.f.pre.length + 2)}`].join(' '), 'wrong');
        }
        if (it.f.kind === 'i' || it.f.inner) add(it, 'wb-extra-ge', [...pieces.slice(0, -1), `ge${pp}`].join(' '), 'wrong');
      }
      if (it.form === 'zu') {
        if (it.f.kind === 'i') add(it, 'wb-zu-glued', a.replace(/^zu /, 'zu'), 'wrong');
        else add(it, 'wb-zu-apart', `zu ${it.f.pre}${a.slice(it.f.pre.length + 2)}`, 'wrong');
      }
      if (it.f.kind === 's' && (it.form === 'sub' || it.form === 'modal')) add(it, 'wb-split-end', `${it.f.pre} ${a.slice(it.f.pre.length)}`, 'wrong');
      if (it.form === 'pres' && it.f.kind === 's') add(it, 'wb-unsplit', `${it.f.pre}${pieces[0]}`, 'wrong');
    } else if (it.wb === 'family form') {
      // the family's other forms of the same class (a sibling prefix or ending), its article swapped or dropped, a typo,
      // the checked non-words of its family, and a separable verb typed apart
      for (const s of it.siblings.slice(0, 4)) add(it, 'wb-family-sibling', s, 'wrong');
      const m = /^(der|die|das) (.+)$/.exec(a);
      if (m) { for (const o of OTHER_ART[m[1]] || []) add(it, 'wb-article', `${o} ${m[2]}`, 'wrong'); add(it, 'wb-no-article', m[2], 'wrong'); }
      for (const n of it.none.slice(0, 2)) add(it, 'wb-family-nonword', n, 'wrong');
      if (it.f.kind === 's' && it.f.pre.length) add(it, 'wb-split', `${it.f.pre[0]} ${it.f.word.slice(it.f.pre[0].length)}`, 'wrong');
      const w = it.f.word, ty = typoIn(w, { lex, eligible: () => true }); if (ty) add(it, 'wb-typo', m ? `${m[1]} ${ty}` : ty, 'wrong');
    } else {
      const m = /^(der|die|das) (.+)$/.exec(a);
      if (m) { for (const o of OTHER_ART[m[1]] || []) add(it, 'wb-article', `${o} ${m[2]}`, 'wrong'); add(it, 'wb-no-article', m[2], 'wrong'); }
      const w = it.n.word, ty = typoIn(w, { lex, eligible: () => true }); if (ty) add(it, 'wb-typo', m ? `${m[1]} ${ty}` : ty, 'wrong');
    }
  }
  for (const [id, text, kind] of CURATED_RIGHT) { const it = data.byId.get(id); if (it) add(it, `curated-${kind}`, text, 'right'); }
  // right variants (round 3): by hand for Schreiben, and the safe swaps on every item he composes an answer for
  for (const [id, text, why] of RIGHT_VARIANTS) {
    const it = data.byId.get(id);
    if (!it) throw new Error(`right-variants.mjs: no item ${id}`);
    out.push({ id, type: typeOf(it), cls: `variant: ${why}`, text, want: 'right', move: null, variant: true });
  }
  for (const it of [...data.pool, ...(data.parts || [])]) {
    if (!it.model || /…/.test(it.model) || it.gap || it.literal || it.kind === 'reply' || !(it.anywhere || it.src === 'build')) continue;
    for (const v of variantsOf(it.model)) out.push({ id: it.id, type: typeOf(it), cls: v.cls, text: v.text, want: 'right', move: null, variant: true });
  }
  // the morphology errors (morph-errors.mjs, round 4) on every phrase, collocation, grammar and Schreiben item, B1 and B2:
  // the model sentence (a phrase card's example sentence) and, for a grammar item, each accepted whole answer
  const ix = verbIndex(root), nouns = nounNumbers(root);
  for (const it of [...data.pool, ...(data.b2 || []), ...(data.parts || [])]) {
    if (!setOf(it)) continue;
    const bases = it.kind === 'reply' ? it.moves.map(m => [m.model, m.key]) : [[it.sentence || it.model, null]];
    if (it.kind === 'grammar' && !it.gap) for (const a of it.accept || []) if (/\s/.test(a) && !/[[(…]/.test(a)) bases.push([a, null]);
    const accepted = new Set((it.gap ? Match.acceptedForGap(it.prompt, it.accept || []) : it.literal ? it.accept || [] : []).map(norm1));
    const seen1 = new Set();
    for (const [s0, mv] of bases) {
      if (!s0 || /…/.test(s0)) continue;
      for (const e of [...morphErrorsIn(s0, { ix, nouns }), ...formalLowercase(s0)]) {
        if (seen1.has(e.text)) continue;
        seen1.add(e.text);
        // a mutation that the item lists as an accepted answer is not counted (tools: --list accepted-mutation)
        if (accepted.has(norm1(e.text))) { acceptedMutations.push(`${it.id}: ${e.cls}: ${e.text}`); continue; }
        add(it, e.cls, e.text, 'wrong', mv);
      }
    }
  }
  // the round 4 German review's hand-written cases (reviews4: 622 answers on its seeded sample, written before any fix)
  for (const [id, text, want, why] of REVIEW4_CASES) { const it = data.byId.get(id); if (it) out.push({ id, type: 'held-out (review 4)', cls: `review 4: ${why}`, text, want, move: null }); }
  for (const [id, text, want, why] of SCHREIBEN_HELD) { const it = data.byId.get(id); if (it) out.push({ id, type: 'held-out (Schreiben)', cls: `schreiben held-out: ${why}`, text, want, move: null }); }
  for (const [id, text, want, why] of HELD_OUT) { const it = data.byId.get(id); if (it) out.push({ id, type: 'held-out', cls: `held-out: ${why}`, text, want, move: null }); }
  // his answer, exactly
  const his = data.byId.get('BP:s2-glue-vor-allem');
  if (his) add(his, 'his-answer', 'Ich mag die Stadt, besonders die vieles Kaffes', 'wrong');
  // one record per (id, text, move)
  const seen = new Set();
  return { data, corpus: out.filter(c => { const k = `${c.type === 'held-out' ? 'H' : ''}|${c.id}|${c.move}|${c.text}`; return !seen.has(k) && seen.add(k); }) };
}

/** Grade every corpus entry with the code under codeRoot. verdict: 'right' (green, nothing flagged), 'partial' (the
 *  phrase is right, the rest is flagged), 'wrong'. */
export async function evaluate({ root = ROOT, codeRoot = root, dataRoot = root } = {}) {
  // the corpus is always made with this checkout's helpers; the items and the grading come from the code under test
  // (dataRoot: the content to grade with, e.g. a checkout from before an accept-list change)
  const { corpus } = await buildCorpus({ root });
  const data = await buildData({ root: dataRoot, codeRoot });
  const { gradeAnswer } = await import(pathToFileURL(codeFile(codeRoot, 'src/features/shared/grade.js', 'src/features/practice/grade.js')).href);
  let gradeTyped = null;
  try { ({ gradeTyped } = await import(pathToFileURL(path.join(codeRoot, 'src/domain/wordbuild-grade.js')).href)); } catch { /* code from before Word building */ }
  const opts = { ...data, nouns: data.nouns, traps: data.traps };
  for (const c of corpus) {
    const it = data.byId.get(c.id);
    if (!it) { c.verdict = 'missing'; c.fp = c.fn = c.soft = c.partialWrong = false; c.slips = []; continue; }
    const move = c.move ? it.moves.find(m => m.key === c.move) : null;
    const g = it.src === 'wordbuild' && gradeTyped ? { ...gradeTyped(c.text, { accept: it.accept, noun: !!it.noun, lexicon: data.wbLexicon }), rest: null, typos: [], umlautMiss: [] } : gradeAnswer(it, c.text, move, opts);
    c.verdict = !g.ok ? 'wrong' : g.rest && g.rest.status === 'differs' ? 'partial' : 'right';
    c.fp = c.want === 'wrong' && c.verdict === 'right';
    c.fn = c.want === 'right' && c.verdict === 'wrong';
    c.soft = c.want === 'right' && c.verdict === 'partial';
    c.partialWrong = c.want === 'wrong' && c.verdict === 'partial';   // a wrong answer shown as "the phrase is right"
    c.slips = [...(g.typos || []), ...(g.umlautMiss || [])].map(t => `${t.typed}→${t.expected}`);
  }
  return corpus;
}

/** Counts per item type. The right variants (c.variant) are counted apart: vRight, vFn (graded wrong), vSoft (graded
 *  "the rest differs", Hard). pw: wrong answers graded partial. */
export function table(corpus) {
  const zero = () => ({ wrong: 0, fp: 0, pw: 0, right: 0, fn: 0, soft: 0, vRight: 0, vFn: 0, vSoft: 0 });
  const by = new Map();
  for (const c of corpus) {
    if (c.verdict === 'missing') continue;
    const r = by.get(c.type) || zero();
    if (c.want === 'wrong') { r.wrong++; if (c.fp) r.fp++; if (c.partialWrong) r.pw++; }
    else if (c.variant) { r.vRight++; if (c.fn) r.vFn++; if (c.soft) r.vSoft++; }
    else { r.right++; if (c.fn) r.fn++; if (c.soft) r.soft++; }
    by.set(c.type, r);
  }
  const all = zero();
  for (const r of by.values()) for (const k of Object.keys(all)) all[k] += r[k];
  return { rows: [...by.entries()].sort(), all };
}

const pct = (a, b) => (b ? `${(100 * a / b).toFixed(1)}%` : '-');
export function report(corpus) {
  const { rows, all } = table(corpus);
  const lines = ['type | wrong answers | false positives | wrong, shown as partly right | right answers | false negatives | right, flagged Hard | right variants | variants graded wrong | variants flagged Hard', '---|---:|---:|---:|---:|---:|---:|---:|---:|---:'];
  for (const [t, r] of [...rows, ['ALL', all]]) lines.push(`${t} | ${r.wrong} | ${r.fp} (${pct(r.fp, r.wrong)}) | ${r.pw} (${pct(r.pw, r.wrong)}) | ${r.right} | ${r.fn} (${pct(r.fn, r.right)}) | ${r.soft} (${pct(r.soft, r.right)}) | ${r.vRight} | ${r.vFn} (${pct(r.vFn, r.vRight)}) | ${r.vSoft} (${pct(r.vSoft, r.vRight)})`);
  const cls = new Map();
  for (const c of corpus.filter(c => c.want === 'wrong')) { const r = cls.get(c.cls) || [0, 0]; r[0]++; if (c.fp) r[1]++; cls.set(c.cls, r); }
  // the morphology classes by set (round 4): false positives (graded right) and wrong answers graded partly right
  const sets = ['B1 phrases', 'B1 Schreiben', 'B1 situations', 'B1 grammar', 'B2 Redemittel', 'B2 collocations', 'B2 grammar'];
  const setOfType = (/** @type {any} */ c) => c.set;
  lines.push('', `morphology class | ${sets.join(' | ')} | all`, `---|${sets.map(() => '---:').join('|')}|---:`);
  for (const k of MORPH_CLASSES) {
    const cell = (/** @type {any[]} */ cs) => { const n = cs.length, f = cs.filter(c => c.fp).length; return n ? `${f}/${n} (${pct(f, n)})` : '-'; };
    const of = corpus.filter(c => c.cls === k && c.verdict !== 'missing');
    lines.push(`${k} | ${sets.map(st => cell(of.filter(c => setOfType(c) === st))).join(' | ')} | ${cell(of)}`);
  }
  lines.push('', 'error class | wrong answers | false positives', '---|---:|---:');
  for (const [k, [n, f]] of [...cls.entries()].sort()) lines.push(`${k} | ${n} | ${f} (${pct(f, n)})`);
  return lines.join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
  const codeRoot = path.resolve(arg('--root') || ROOT);
  // --data <checkout>: grade with that checkout's content too (the "before" of an accept-list change)
  const corpus = await evaluate({ root: ROOT, codeRoot, dataRoot: path.resolve(arg('--data') || ROOT) });
  console.log(report(corpus));
  const list = arg('--list'), type = arg('--type'), cl = arg('--cls');
  if (list) for (const c of corpus.filter(c => c[list] && (!type || c.type === type) && (!cl || c.cls === cl))) console.log(`${c.type} | ${c.cls} | ${c.id}${c.move ? '/' + c.move : ''} | ${c.text}${c.slips.length ? ' | slips ' + c.slips.join(', ') : ''}`);
}
