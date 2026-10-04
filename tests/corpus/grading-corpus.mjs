// Adversarial grading corpus, built from the real public content (content/b1/*.json) plus a few synthetic exam words
// and corrections. For each item it makes typical B1 learner errors (wrong answers that must NOT come back as right)
// and correct variants (answers that must not be marked wrong), runs every one through the app's grading path
// (features/practice/grade.js gradeAnswer, the same call the round makes) and counts false positives and false
// negatives per item type.
//
//   node tests/corpus/grading-corpus.mjs [--root <repo>] [--list fp|fn|soft] [--type <type>]
//
// --root grades with another checkout's code (the "before" numbers come from the commit before the fix).
// tests/unit/grading-corpus.test.mjs runs it as a regression test.
//
// The error generators only make changes that are wrong in context; each one is described next to its code.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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
  ['W:corpus-Mutter', 'Muetter', 'full'],
  ['W:corpus-Mutter', 'Viele Muetter arbeiten heute Teilzeit.', 'full'],
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
  // right
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

/* ---------- the corpus ---------- */
const typeOf = it => {
  if (it.src === 'build') return 'schreiben email line';
  if (it.area === 'writing') return 'schreiben phrase';
  if (it.area === 'mistakes') return 'mistake';
  if (it.area === 'words') return it.showGap ? 'word-article' : 'word-gap';
  if (it.kind === 'phrase') return it.bank ? 'phrase (bank)' : 'phrase';
  if (it.kind === 'topic' || it.kind === 'reply') return 'situation';
  if (it.kind === 'reading') return 'reading';
  if (it.kind === 'grammar' && it.id.startsWith('G:')) return it.gap ? 'grammar gap' : `grammar ${it.plan === 'transform' ? 'transform' : 'translate/order'}`;
  if (it.kind === 'grammar') return it.anywhere ? 'grammar (say it)' : it.gap ? 'grammar gap' : 'grammar transform';
  return it.kind;
};

/** The item pool as the code under codeRoot builds it (with the synthetic exam words and corrections). */
export async function buildData({ root = ROOT, codeRoot = ROOT } = {}) {
  const { buildPool } = await import(pathToFileURL(path.join(codeRoot, 'src/features/practice/pool.js')).href);
  const W = await import(pathToFileURL(path.join(codeRoot, 'src/features/practice/words.js')).href);
  const content = { items: J(root, 'content/b1/items.json'), grammar: J(root, 'content/b1/grammar.json'), bank: J(root, 'content/b1/bank.json'), plan: J(root, 'content/b1/plan.json'), nouns: J(root, 'content/b1/nouns.json') };
  const mistakes = SYN_MISTAKES.map(([wrong, right], i) => ({ id: `F:corpus-${i}`, v: 1, wrong, right, rule: '', source: { attemptId: 'corpus', test: 1, module: 'schreiben', label: null }, createdAt: '2026-10-01T10:00:00Z', deletedAt: null }));
  const words = SYN_WORDS.map(w => W.toItem({ id: `W:corpus-${w.lemma}`, lemma: w.lemma, art: w.art, pl: null, pos: w.pos, gloss: ['x'], sent: w.sent, form: w.form, ex: null, cluster: null, day: 1, module: 'lesen', teil: null, examDays: 1, level: 'B1', conf: null, zipf: 3 })).filter(Boolean);
  let schreiben = null;
  try { schreiben = J(root, 'content/b1/schreiben.json'); } catch { /* a checkout from before the Schreiben content */ }
  const data = buildPool({ ...content, mistakes, words, schreiben, lexWords: J(root, 'content/igloo/words/de.json'), lexTexts: Object.values(J(root, 'content/igloo/chunks/german.json').chunks).map(c => c.ex).filter(Boolean) });
  // Build an email: every line of every task as the item the builder grades (features/practice/build.js partItem)
  /** @type {any[]} */ const parts = [];
  if (schreiben) {
    try {
      const B = await import(pathToFileURL(path.join(codeRoot, 'src/features/practice/build.js')).href);
      for (const t of schreiben.tasks) for (const p of t.parts) { const it = { ...B.partItem(t, p), model: B.modelLine(p), lower: p.lower }; parts.push(it); data.byId.set(it.id, it); }
    } catch { /* code from before the builder */ }
  }
  return Object.assign(data, { parts });
}

/** Build the corpus with this checkout's helpers: [{id, type, cls, text, want: 'wrong'|'right', move?}] */
export async function buildCorpus({ root = ROOT } = {}) {
  const lex = lexicon(root);
  const Match = await import(pathToFileURL(path.join(ROOT, 'src/domain/match.js')).href);
  garbage = p => { const r = Match.renderPattern(p); return r.includes('…') ? r.replace('…', 'blorf quazz') : null; };
  const data = await buildData({ root });
  const out = [];
  const add = (it, cls, text, want, move = null) => { if (text && text.trim()) out.push({ id: it.id, type: typeOf(it), cls, text, want, move }); };
  for (const it of [...data.pool, ...(data.parts || [])]) {
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
    const model = it.model;
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
        for (const n of Object.values(J(root, 'content/b1/nouns.json'))) if (!cased.has(n.toLowerCase())) cased.set(n.toLowerCase(), n);
        // a phrase that ends in aber/denn (tut mir leid, aber) keeps the normal order after it: it cannot stand
        // where an inverting adverb stood (Leider sind wir … → not "Tut mir leid, aber sind wir …")
        const coord = (/** @type {string} */ p) => /\b(aber|denn|und|oder|sondern)$/.test(p.trim());
        for (const q of plain.filter(q => q !== own && Match.sameShape(Match.shapeOf(q), Match.shapeOf(own)) && coord(q) === coord(own)).slice(0, 3)) {
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
      if (it.showGap) { for (const a of OTHER_ART[w.art] || []) add(it, 'word-article', `${a} ${w.lemma}`, 'wrong'); add(it, 'word-article-right', `${w.art} ${w.lemma}`, 'right'); }
      else for (const x of w.wrongs) { add(it, 'word-form', x, 'wrong'); add(it, 'word-form-sentence', w.sent.replace(w.form, x), 'wrong'); }
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
  for (const [id, text, kind] of CURATED_RIGHT) { const it = data.byId.get(id); if (it) add(it, `curated-${kind}`, text, 'right'); }
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
export async function evaluate({ root = ROOT, codeRoot = root } = {}) {
  // the corpus is always made with this checkout's helpers; the items and the grading come from the code under test
  const { corpus } = await buildCorpus({ root });
  const data = await buildData({ root, codeRoot });
  const { gradeAnswer } = await import(pathToFileURL(path.join(codeRoot, 'src/features/practice/grade.js')).href);
  const opts = { ...data, nouns: data.nouns, traps: data.traps };
  for (const c of corpus) {
    const it = data.byId.get(c.id);
    const move = c.move ? it.moves.find(m => m.key === c.move) : null;
    const g = gradeAnswer(it, c.text, move, opts);
    c.verdict = !g.ok ? 'wrong' : g.rest && g.rest.status === 'differs' ? 'partial' : 'right';
    c.fp = c.want === 'wrong' && c.verdict === 'right';
    c.fn = c.want === 'right' && c.verdict === 'wrong';
    c.soft = c.want === 'right' && c.verdict === 'partial';
    c.slips = [...(g.typos || []), ...(g.umlautMiss || [])].map(t => `${t.typed}→${t.expected}`);
  }
  return corpus;
}

export function table(corpus) {
  const by = new Map();
  for (const c of corpus) {
    const r = by.get(c.type) || { wrong: 0, fp: 0, right: 0, fn: 0, soft: 0 };
    if (c.want === 'wrong') { r.wrong++; if (c.fp) r.fp++; } else { r.right++; if (c.fn) r.fn++; if (c.soft) r.soft++; }
    by.set(c.type, r);
  }
  const all = [...by.values()].reduce((a, r) => ({ wrong: a.wrong + r.wrong, fp: a.fp + r.fp, right: a.right + r.right, fn: a.fn + r.fn, soft: a.soft + r.soft }), { wrong: 0, fp: 0, right: 0, fn: 0, soft: 0 });
  return { rows: [...by.entries()].sort(), all };
}

const pct = (a, b) => (b ? `${(100 * a / b).toFixed(1)}%` : '-');
export function report(corpus) {
  const { rows, all } = table(corpus);
  const lines = ['type | wrong answers | false positives | right answers | false negatives | right, flagged Hard', '---|---:|---:|---:|---:|---:'];
  for (const [t, r] of [...rows, ['ALL', all]]) lines.push(`${t} | ${r.wrong} | ${r.fp} (${pct(r.fp, r.wrong)}) | ${r.right} | ${r.fn} (${pct(r.fn, r.right)}) | ${r.soft} (${pct(r.soft, r.right)})`);
  const cls = new Map();
  for (const c of corpus.filter(c => c.want === 'wrong')) { const r = cls.get(c.cls) || [0, 0]; r[0]++; if (c.fp) r[1]++; cls.set(c.cls, r); }
  lines.push('', 'error class | wrong answers | false positives', '---|---:|---:');
  for (const [k, [n, f]] of [...cls.entries()].sort()) lines.push(`${k} | ${n} | ${f} (${pct(f, n)})`);
  return lines.join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
  const codeRoot = path.resolve(arg('--root') || ROOT);
  const corpus = await evaluate({ root: ROOT, codeRoot });
  console.log(report(corpus));
  const list = arg('--list'), type = arg('--type'), cl = arg('--cls');
  if (list) for (const c of corpus.filter(c => c[list] && (!type || c.type === type) && (!cl || c.cls === cl))) console.log(`${c.type} | ${c.cls} | ${c.id}${c.move ? '/' + c.move : ''} | ${c.text}${c.slips.length ? ' | slips ' + c.slips.join(', ') : ''}`);
}
