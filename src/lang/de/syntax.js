/* German sentence knowledge the matcher and the punctuation rules use (moved unchanged from domain/match.js and
   domain/punct.js, Wave C2): clause shapes, which slot words may move, which "also correct" lines can be written from
   the model, the commas the grader writes, and the Schreiben rules' exceptions. Word lists are folded keys (Token.n)
   unless said otherwise. */
// @ts-check
import { tokenize as words } from './text.js';
import { CLOSED } from './grading.js';
/** @typedef {import('../types.js').Shape} Shape */

/* ---- clause shapes (restCheck, alsoLines) ---- */
export const VERB_LAST = new Set(['dass', 'weil', 'ob', 'wenn', 'obwohl', 'damit', 'sobald', 'bevor', 'nachdem', 'waehrend', 'falls', 'seitdem']);
const INVERT = new Set(['deshalb', 'deswegen', 'darum', 'daher', 'trotzdem', 'dann', 'danach', 'ausserdem', 'also', 'sonst', 'dennoch', 'denn']);
const AUX_SEIN = /^(bin|bist|ist|sind|seid)$/, AUX_HABEN = /^(hab|habe|hast|hat|haben|habt)$/;
/** @param {string[]} ws a pattern's words (keys), slots removed @returns {Shape} */
export function shape(ws) {
  const sub = ws.filter(w => VERB_LAST.has(w)), inv = ws.filter(w => INVERT.has(w));
  return { clause: [sub.slice().sort().join('+'), inv.slice().sort().join('+')].join('|'),
    // the word order they make: any subordinator sends the verb to the end, any of these adverbs (not denn) puts it
    // before the subject (deshalb, deswegen, daher, darum, trotzdem, dennoch … are interchangeable)
    order: [sub.map(() => 'sub').join('+'), inv.map(w => w === 'denn' ? 'denn' : 'inv').sort().join('+')].join('|'),
    sein: ws.some(w => AUX_SEIN.test(w)), haben: ws.some(w => AUX_HABEN.test(w)) };
}
// the same word order, and not sein in one where the other has haben
export const sameShape = (/** @type {Shape} */ a, /** @type {Shape} */ b) => a.order === b.order && !((a.sein && !a.haben && b.haben && !b.sein) || (a.haben && !a.sein && b.sein && !b.haben));

/* ---- slot words (restCheck borrowable) ---- */
// a time phrase (am Samstag, um 10 Uhr, nächste Woche): no verb governs it, so it moves freely
export const TIME_RE = /^(am|um|im|ab|bis|seit|vor|nach|naechste|naechsten|letzte|letzten|diese|diesen|jeden|jede)( \S+)* (montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|wochenende|uhr|morgen|abend|nachmittag|vormittag|mittag|woche|monat|jahr|januar|februar|maerz|april|mai|juni|juli|august|september|oktober|november|dezember|sommer|winter|fruehling|herbst)$/;
// adverbs that stand in the middle of a clause whatever its verb (du solltest [unbedingt] …, nimm [unbedingt] … mit)
export const ADVERBS = new Set(`unbedingt vorher nachher kurz oft immer heute morgen jetzt bald spaeter frueher wirklich gemeinsam zusammen wieder
  bestimmt sicher ueberall dort hier endlich schnell gleich sofort lieber gern`.split(/\s+/).filter(Boolean));
// modal verbs, würde, werden and zu: they do not decide the case of the words in a slot (sein and haben do: als ich [ein
// Kind] war is not früher hatte ich [ein Kind])
export const HELPERS = new Set(`zu kann kannst koennen konnte konnten koennte koennten muss musst muessen musste mussten muesste will willst wollen
  wollte wollten soll sollst sollen sollte sollten darf darfst duerfen durfte moechte moechtest moechten wuerde wuerdest wuerden werde wirst wird
  werden`.split(/\s+/).filter(Boolean));
export const PREPS = new Set(`an am ans auf aufs aus bei beim bis durch durchs fuer fuers gegen hinter hinterm im in ins mit nach neben ohne seit
  ueber uebers um ums unter unterm von vom vor vorm waehrend wegen zu zum zur zwischen trotz statt ab ausser gegenueber`.split(/\s+/).filter(Boolean));
// Words that never change form and add only emphasis or a nuance: he may add them, or use another one, where an accepted
// pattern has a slot (ich stimme Rainer [nur] teilweise zu, der Umzug ist [echt] gut gelaufen). Folded.
// Only words that sit in front of a verb phrase as well as an adjective: an intensifier (sehr, ganz, so, ziemlich) needs
// an adjective after it (*macht mir sehr Spaß, *ganz nicht), so it is not one of them.
export const PARTICLES = new Set(['wirklich', 'echt', 'nur', 'auch', 'dann', 'schon', 'noch', 'ja', 'doch', 'eigentlich', 'leider', 'natuerlich',
  'einfach', 'vielleicht', 'uebrigens', 'stattdessen']);

/* ---- commas the grader writes ---- */
// patterns carry no commas: put back the base sentence's comma before a clause word it has one before (so, dass …)
export const COMMA_WORDS = new Set(['dass', 'weil', 'wenn', 'ob', 'obwohl', 'damit', 'aber', 'denn', 'sondern', 'bevor', 'nachdem', 'waehrend', 'falls', 'sodass', 'als', 'wie', 'wo', 'was']);
// A comma before a subordinate clause (dass, weil, obwohl, wenn, ob, falls …) inside a sentence; not after und/oder
// or where it belongs before the word in front (auch wenn, als ob, so dass, nur wenn, selbst wenn)
const SUB_COMMA = new Set(['dass', 'weil', 'obwohl', 'wenn', 'ob', 'falls', 'sobald', 'bevor', 'nachdem', 'seitdem', 'sodass', 'sondern']);
const SUB_LEAD = new Set(['und', 'oder', 'auch', 'als', 'nur', 'selbst', 'ausser', 'gerade', 'sogar']);
// A comma after an opinion verb before a main clause (Ich finde, das ist …; Ich hoffe, es geht dir gut), and before an
// infinitive group after a word that announces it (Wäre es möglich, den Termin … zu verschieben; Ich freue mich darauf,
// von dir zu hören)
const OPINION = new Set(['finde', 'denke', 'glaube', 'meine', 'hoffe', 'weiss', 'sage', 'vor', 'finden', 'glauben', 'denken', 'meint', 'findet', 'glaubt', 'denkt']);
const SUBJECTS = new Set(['das', 'es', 'die', 'der', 'er', 'sie', 'wir', 'ich', 'du', 'man', 'dir', 'mir', 'ihr', 'viele', 'alle', 'jeder']);
const FINITE_WORDS = new Set(['ist', 'sind', 'war', 'waren', 'hat', 'haben', 'habe', 'kann', 'koennen', 'muss', 'muessen', 'will', 'soll', 'sollte',
  'sollten', 'wird', 'werden', 'wuerde', 'gibt', 'geht', 'kommt', 'macht', 'passt', 'treffen', 'probieren', 'arbeiten', 'arbeitet']);
const ZU_NOUN = new Set(['lust', 'zeit', 'idee']);
const ZU_LEAD = new Set(['moeglich', 'lust', 'zeit', 'idee', 'vorschlag', 'darauf', 'darueber', 'dafuer', 'daran', 'davon', 'dazu', 'vor', 'wichtig', 'schwer', 'leicht']);
/** @param {string} text */
export function clauseCommas(text) {
  const T = words(text);
  /** @type {number[]} */ const at = [];
  T.forEach((w, i) => {
    const nx = T[i + 1];
    if (!nx || /^\s*[,;:.!?]/.test(text.slice(w.end))) return;
    // opinion verb + a subject + a finite verb within the next words (no dass)
    if (OPINION.has(w.n) && SUBJECTS.has(nx.n) && T.slice(i + 2, i + 6).some(x => FINITE_WORDS.has(x.n)) && !T.slice(i + 1, i + 6).some(x => SUB_COMMA.has(x.n))) at.push(w.end);
    // a word that announces an infinitive group + at least one word + zu + the verb at the end of the line
    const z = T.findIndex((x, k) => k > i && x.n === 'zu' && k === T.length - 2 && /(en|ern|eln)$/.test(T[k + 1].n) && !/^\p{Lu}/u.test(T[k + 1].raw));
    if (ZU_LEAD.has(w.n) && z > i && (nx.n !== 'zu' || ZU_NOUN.has(w.n))) at.push(w.end);
  });
  let out = text;
  for (const k of at.sort((a, b) => b - a)) out = out.slice(0, k) + ',' + out.slice(k);
  return out;
}
/** @param {string} text */
export function subCommas(text) {
  const T = words(text);
  let out = text;
  for (let i = T.length - 1; i > 0; i--) {
    const w = T[i], prev = T[i - 1];
    const lead = SUB_LEAD.has(prev.n) && i > 1 ? T[i - 2] : null;   // auch wenn: the comma goes before auch
    if (!SUB_COMMA.has(w.n) || (SUB_LEAD.has(prev.n) && !lead) || ['und', 'oder'].includes(prev.n)) continue;
    const at = lead ? prev : w, before = lead || prev;
    if (/[,;:.!?(]\s*$/.test(out.slice(0, at.start))) continue;
    out = out.slice(0, before.end) + ',' + out.slice(before.end);
  }
  return out;
}

/* ---- "also correct" lines (alsoLines) ---- */
// a line that starts with one of these is a question (the model's ? stays); otherwise a statement takes a full stop
export const QUESTION = new Set(`kann kannst koennen koennt koennte koenntest koennten wuerde wuerdest wuerden haette haettest haetten habe hast hat
  haben habt ist bist sind seid waere waerst waeren war warst waren passt passen wollen willst wollt sollen soll sollte darf darfst duerfen
  moechtest moechten magst gibt geht gehst kommst kommt hilfst weisst wisst was wie wo wann warum wer wen wem wessen welche welcher welches
  welchen wohin woher womit wofuer worueber wozu wieso weshalb`.split(/\s+/).filter(Boolean));
export const DETLIKE = new Set([...[...CLOSED].filter(w => !/^(ich|mich|mir|du|dich|dir|er|ihn|ihm|sie|es|wir|uns|euch|man|sich|bin|bist|ist|sind|seid|war|warst|waren|wart|habe|hab|hast|hat|habt|haben|hatte|werde|wirst|wird|werden|werdet|wurde|dass|ob|wenn|als|wie|wer|wen|wem)$/.test(w)),
  'zwei', 'drei', 'vier', 'fuenf', 'sechs', 'sieben', 'acht', 'neun', 'zehn', 'viele', 'vielen', 'wenige', 'einige', 'alle', 'jede', 'jeden', 'jeder', 'jedes']);
export const OPENERS = new Set(['ich', 'du', 'das', 'es', 'wir', 'da', 'man', 'er', 'mir', 'dir', 'dem', 'den', 'die', 'der', 'stimme', 'finde', 'sehe', 'bin', 'geht', 'klingt', 'gute', 'kein', 'keine']);
export const POLITE = new Set(['sie', 'ihnen', 'ihr', 'ihre', 'ihren', 'ihrem', 'ihrer', 'ihres']);
export const INTERJ = new Set(['okay', 'ok', 'ja', 'nein', 'gut', 'klar', 'prima', 'genau', 'entschuldigung', 'super', 'toll']);
// a verb after fürs, beim, zum … is a noun there (fürs Zuhören): its capital is not known
export const CONTRACTIONS = new Set(['fuers', 'beim', 'zum', 'vom', 'ins', 'am']);

/* ---- articles ---- */
/** @type {Record<string, string>} */
const INDEF = { der: 'ein', das: 'ein', die: 'eine' };
export const toIndef = (/** @type {string} */ s) => { const m = String(s).match(/^(der|die|das)\s+(.+)$/i); return m ? `${INDEF[m[1].toLowerCase()]} ${m[2]}` : s; };

/* ---- the Schreiben punctuation rules' exceptions (domain/punct.js) ---- */
// "…, und weil", "so dass", "auch wenn", "als ob": no comma right before the subordinator (lower case, as written)
export const BEFORE_OK = new Set(['und', 'oder', 'aber', 'sondern', 'so', 'ohne', 'als', 'anstatt', 'statt', 'auch', 'nur', 'erst', 'selbst', 'gerade', 'allem', 'besonders', 'vor', 'bis', 'außer']);
// the polite pronoun keeps its capital where a line starts small (as written)
export const POLITE_CAPS = new Set(['Sie', 'Ihnen', 'Ihr', 'Ihre', 'Ihren', 'Ihrem', 'Ihrer', 'Ihres']);
/** A word's key in a noun table: lower case, umlauts folded. @param {string} w */
export const nounKey = w => w.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');

