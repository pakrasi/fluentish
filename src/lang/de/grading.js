/* German knowledge of the typo policy (moved unchanged from domain/match.js, Wave C2): the closed-class words, the
   inflectional endings, the vowel alternations that are forms, the sound-alike words, the umlaut slip and its minimal
   pairs, the words written either way, and the closed-class families. The policy itself is domain/match.js typoOk(). */
// @ts-check
import { fold } from './text.js';
/** @typedef {import('../types.js').Token} Token */

export const ARTICLES = ['der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einen', 'einem', 'einer', 'eines'];
// Closed-class words: a different word from this list is a grammar mistake, never a typo, and these words get 0 edits.
export const CLOSED = new Set(`der die das den dem des ein eine einen einem einer eines kein keine keinen keinem keiner keines
  ich mich mir du dich dir er ihn ihm sie ihr ihnen es wir uns euch man sich
  mein meine meinen meinem meiner meines dein deine deinen deinem deiner deines sein seine seinen seinem seiner seines
  ihre ihren ihrem ihrer ihres unser unsere unseren unserem unserer unseres euer eure euren eurem eurer eures
  dieser diese dieses diesen diesem jener jene jenes jenen jenem wer wen wem wessen
  an am ans auf aufs aus bei beim bis durch durchs für fürs gegen hinter hinterm im in ins mit nach neben ohne seit
  über übers um ums unter unterm von vom vor vorm während wegen zu zum zur zwischen trotz statt ab außer gegenüber
  entlang innerhalb außerhalb dass ob wenn als wie
  bin bist ist sind seid war warst waren wart habe hab hast hat habt haben hatte werde wirst wird werden werdet wurde`
  .split(/\s+/).filter(Boolean).map(w => fold(w)));

// inflectional endings, longest first; the rest of the word (the stem) keeps at least 3 letters
export const ENDINGS = ['ern', 'est', 'ens', 'en', 'em', 'er', 'es', 'et', 'st', 'e', 'n', 'm', 'r', 's', 't'];
const VOWEL = /[aeiou]/;
const KEY_NEIGHBOURS = new Set(['ui', 'iu', 'io', 'oi']);
// the single edit between two stems is a German vowel alternation (ablaut, e→i, ie/e, ie/ei), not a slip of the finger
/** @param {string} s @param {string} t */
export function formChange(s, t) {
  let p = 0; while (p < s.length && p < t.length && s[p] === t[p]) p++;
  let q = 0; while (q < s.length - p && q < t.length - p && s[s.length - 1 - q] === t[t.length - 1 - q]) q++;
  const ds = s.slice(p, s.length - q), dt = t.slice(p, t.length - q);
  if (ds.length === 1 && dt.length === 1) return VOWEL.test(ds) && VOWEL.test(dt) && !KEY_NEIGHBOURS.has(ds + dt);
  if (ds.length + dt.length === 1) {   // one letter more or less: ie/e (sieht/seht, liest/lest)
    const c = ds || dt, long = ds ? s : t;
    return c === 'i' && (long[p + 1] === 'e' || long[p - 1] === 'e');
  }
  if (ds.length === 2 && dt.length === 2 && ds[0] === dt[1] && ds[1] === dt[0]) return (ds === 'ie' || ds === 'ei');
  return false;
}
// real words that sound like another word (wider/wieder, fiel/viel, Staat/Stadt): typing one is that word, never a typo,
// even without the lexicon
export const SOUNDS = new Set('wider fiel seid wen staat meer wahr mahl lehre leere wal wahl lid leid lied stiel stil rat tod weise waise saite seite ente'.split(' '));
const unUml = (/** @type {unknown} */ s) => String(s).replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u');
// both spellings of an umlaut (ä and ae) and the plain vowel map to the same letter: words equal under deUml differ
// only in umlauts
export const deUml = (/** @type {unknown} */ s) => String(s).replace(/ä|ae/g, 'a').replace(/ö|oe/g, 'o').replace(/ü|ue/g, 'u').replace(/ß/g, 'ss');
// typed is the expected word with its umlauts typed as plain vowels (a dropped umlaut)
/** @param {string} typed @param {string} expected */
export const umlautDropped = (typed, expected) => unUml(expected).replace(/ß/g, 'ss') === typed.replace(/ß/g, 'ss') && /[äöü]/.test(expected);
// words that exist without the umlaut and mean something else: typing them is a miss, not a slip
export const UML_PAIR = new Set(`konnte konnten konntest konntet musste mussten musstest wurde wurden wurdest hatte hatten hattest
  ware waren war durfte durften durfe schon bruder mutter vater tochter apfel garten laden zahlen drucken kuchen fuhren
  uben schwul suss`.split(/\s+/).filter(Boolean));

// "recht/Recht haben", "recht/Recht geben": Duden allows both spellings, so neither case is a slip
const HABEN_GEBEN = /^(hab|habe|hast|hat|haben|habt|hatte|hattest|hatten|hattet|haette|haettest|haetten|haettet|gehabt|geb|gebe|gibst|gibt|geben|gebt|gab|gabst|gaben|gabt|gegeben|gib)$/;
const RECHT_DET = /^(das|des|dem|ein|eines|einem|kein|keines|keinem|mein|dein|sein|ihr|unser|euer|jedes|jedem|gleiche|gleiches|volle|volles|vollem|gutes|gutem)$/;
export const eitherCase = (/** @type {Token[]} */ toks, /** @type {number} */ i) => toks[i].n === 'recht' && !(i > 0 && RECHT_DET.test(toks[i - 1].n)) &&
  toks.slice(Math.max(0, i - 5), i + 6).some(t => HABEN_GEBEN.test(t.n));

// the closed-class families: another member is the same word in another form (bei mich, für einer Party)
export const FAMILY = [/^d(er|ie|as|en|em|es)$/, /^ein(e|en|em|er|es)?$/, /^kein(e|en|em|er|es)?$/, /^mein(e|en|em|er|es)?$/, /^dein(e|en|em|er|es)?$/,
  /^sein(e|en|em|er|es)?$/, /^ihr(e|en|em|er|es)$/, /^unser(e|en|em|er|es)?$/, /^eu(e)?r(e|en|em|er|es)?$/, /^dies(e|er|en|em|es)$/, /^jed(e|er|en|em|es)$/,
  /^welch(e|er|en|em|es)$/, /^(ich|mich|mir)$/, /^(du|dich|dir)$/, /^(er|ihn|ihm)$/, /^(wir|uns)$/, /^(ihnen)$/,
  /^(bin|bist|ist|sind|seid|sein|hab|habe|hast|hat|haben|habt)$/, /^(hatte|hattest|hatten|hattet|war|warst|waren|wart)$/, /^(werde|wirst|wird|werden|werdet)$/,
  /^(war|warst|waren|wart)$/, /^(wurde|wurdest|wurden|wurdet)$/];
