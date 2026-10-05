/* French knowledge of the typo policy (domain/match.js typoOk and the mark slip): the closed-class words, the
   inflectional endings, the stem changes that are forms, the sound-alike words, the accent slip and the words whose
   accent carries meaning, and the closed-class families. Every word list holds keys (Token.n: lower case, accents
   kept, œ → oe) unless it says otherwise.

   Accents (the owner's rule for the French pilot): a dropped accent is a slip (the answer is right, rated Hard, the
   result lists it like a dropped umlaut), except where the plain spelling is another word or form:
     - the meaning pairs (ou/où, a/à, la/là, du/dû, sur/sûr, des/dès …: MINIMAL_PAIRS, as typed);
     - a final é or és (parlé → parle, mangés → manges): without its accent a past participle of an -er verb is its
       present tense, so it is an error; the common nouns and adjectives in -é (vérité, santé, café, côté …) are
       listed apart (NOT_PARTICIPLE) and keep the slip. -ée and -ées (arrivée → arrivee) make no other word: a slip;
     - any word the content knows (the round's lexicon): typing it is that word.
   An accent typed where there is none, or another accent (é for è), is always an error. */
// @ts-check
import { fold } from './text.js';
/** @typedef {import('../types.js').Token} Token */

const keys = (/** @type {string} */ s) => s.split(/\s+/).filter(Boolean).map(w => fold(w.toLowerCase()));

// What may stand before a noun: a wrong or missing one is articleMiss (de la is two words: de, la).
export const ARTICLES = keys("le la les l' un une des du de d' au aux");

// Closed-class words: another word from this list is a grammar mistake, never a typo, and these words get 0 edits.
export const CLOSED = new Set(keys(`le la les l' un une des du de d' au aux
  je j' me m' moi tu te t' toi il elle on nous vous ils elles se s' soi lui leur leurs eux y en
  mon ma mes ton ta tes son sa ses notre nos votre vos ce c' cet cette ces ça cela ceci celui celle ceux celles
  à dans en sur sous chez avec sans pour par entre vers depuis pendant avant après contre devant derrière jusqu' jusque
  que qu' qui où dont quand si et ou mais donc car ni comme ne n' pas plus
  suis es est sommes êtes sont ai as a avons avez ont étais était étions étiez étaient avais avait avions aviez avaient
  vais vas va allons allez vont`));

// inflectional endings, longest first; the stem keeps at least 3 letters (match.js ending())
export const ENDINGS = keys('aient eront erons erez ions iez ent ons ais ait ées era ez er ir re és ée es é e s x t');

const STEM_DOUBLE = /^[lt]$/;
/**
 * The single edit between two stems is a French spelling change of the verb, not a slip of the finger:
 * appelle/appelons and jette/jetons (a doubled l or t), paie/paye and envoie/envoyons (i/y), mangeons (the e after g).
 * Accent changes (achète/achetons, préfère/préférons) differ only in marks and never reach this rule.
 * @param {string} s @param {string} t
 */
export function formChange(s, t) {
  let p = 0; while (p < s.length && p < t.length && s[p] === t[p]) p++;
  let q = 0; while (q < s.length - p && q < t.length - p && s[s.length - 1 - q] === t[t.length - 1 - q]) q++;
  const ds = s.slice(p, s.length - q), dt = t.slice(p, t.length - q);
  if (ds.length === 1 && dt.length === 1) return (ds === 'i' && dt === 'y') || (ds === 'y' && dt === 'i');
  if (ds.length + dt.length === 1) {
    const c = ds || dt, long = ds ? s : t;
    if (STEM_DOUBLE.test(c) && (long[p - 1] === c || long[p + 1] === c)) return true;   // appelle / appele
    if (c === 'e' && long[p - 1] === 'g') return true;                                  // mangeons / mangons
  }
  return false;
}

// Real words that sound like another word (ces/ses, vers/vert, peu/peut, foi/fois): typing one is that word, never a
// typo, even without the lexicon.
export const SOUNDS = new Set(keys(`ces ses mes met mets sait peu peut peux vers vert verre ver cours court cour foi fois foie voie voix vois voit
  sans cent sang sent fin faim pain pin seau saut sot mer mère maire compte conte comte temps tant tend thym dent cœur chœur
  père paire pair pere air aire ère hère sel selle celle cela verts vertes chant champ pois poids poing point ton thon
  sain saint sein seing cinq vingt vin vint vain coup coût cou cout`));

/** Every spelling of a marked letter as one plain letter, lower case (é è ê ë → e, ç → c; œ → oe). @param {unknown} s */
export const base = s => fold(String(s).toLowerCase()).normalize('NFD').replace(/\p{M}/gu, '');

// Nouns and adjectives in -é/-és that are not past participles of an -er verb: a dropped final accent there is a slip.
const NOT_PARTICIPLE = new Set(keys(`café cafés télé thé thés clé clés été santé société sociétés liberté libertés qualité qualités quantité
  réalité réalités spécialité spécialités université universités vérité vérités activité activités difficulté difficultés possibilité
  possibilités nationalité électricité publicité curiosité beauté fierté volonté côté côtés marché marchés degré degrés comité
  comités bébé bébés lycée musée pré gré dé blé né nés communauté propriété propriétés sécurité identité majorité priorité
  équipe-santé moitié amitié pitié`));
/**
 * Typed is the expected word with one or more of its accents left out (and nothing else changed). A participle's final
 * é is not one of them: parle for parlé is the present tense (see the head of this file).
 * @param {string} typed @param {string} expected  both lower case
 */
export function marksDropped(typed, expected) {
  const a = fold(typed), b = fold(expected);
  if (a === b || a.length !== b.length) return false;
  for (let i = 0; i < b.length; i++) if (a[i] !== b[i] && a[i] !== base(b[i])) return false;
  // a final é or és left out: parle for parlé (see the head of this file)
  if (/é(s?)$/.test(b) && !NOT_PARTICIPLE.has(b)) {
    const at = b.lastIndexOf('é');
    if (a[at] !== b[at]) return false;
  }
  return true;
}

// Words that exist without the accent and mean something else (as typed, lower case): typing them is a miss, never a
// slip. The pairs a learner meets at A2-B1.
export const MINIMAL_PAIRS = new Set(keys(`ou a la du sur sure surs sures mur murs mure mures des cote cotes tache taches jeune jeunes
  peche peches pecheur pecheurs foret forets mais sale sales marche marches mat mats roder cru crus boite boites notre votre
  chasse`));

// Words written either way: none in French (case counts only for proper nouns, through the case reference).
/** @param {Token[]} _toks @param {number} _i */
export const eitherCase = (_toks, _i) => false;

// the closed-class families: another member is the same word in another form (je/me/moi, le/la/les, mon/ma/mes)
export const FAMILY = [/^(le|la|les|l')$/, /^(un|une|des)$/, /^(du|de|des|d'|au|aux)$/, /^(mon|ma|mes)$/, /^(ton|ta|tes)$/, /^(son|sa|ses)$/,
  /^(notre|nos)$/, /^(votre|vos)$/, /^(leur|leurs)$/, /^(ce|cet|cette|ces)$/, /^(je|j'|me|m'|moi)$/, /^(tu|te|t'|toi)$/, /^(il|lui|se|s')$/,
  /^(elle|elles)$/, /^(ils|eux)$/, /^(celui|celle|ceux|celles)$/,
  /^(suis|es|est|sommes|êtes|sont)$/, /^(ai|as|a|avons|avez|ont)$/, /^(vais|vas|va|allons|allez|vont)$/,
  /^(étais|était|étions|étiez|étaient)$/, /^(avais|avait|avions|aviez|avaient)$/];
