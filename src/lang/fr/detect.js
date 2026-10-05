/* French sticky-error detectors (the pack's grammar.detectors; domain/detect.js runs them on every typed answer,
   accepted or not, and the first hit is the answer's sticky error). Each one fires only on a form that is never right,
   so a correct sentence never trips it: tests/unit/lang-fr.test.mjs runs all of them over every French sentence the
   content has (the chunk models and examples, the sentence bank, the framework items, the word list) and expects no
   hit.
     aux-etre   avoir with a verb that takes être in the passé composé: *j'ai allé, *il a venu, *je n'ai pas parti,
                *je m'ai levé, *il s'a trompé (only the participles that never take avoir: allé venu arrivé parti né
                mort resté tombé devenu revenu parvenu intervenu; monter, sortir, passer … take avoir with an object)
     ne-pas     pas in the wrong place: *je ne pas parle (pas between ne and a conjugated verb), *je ne suis allé pas
                (pas after the participle instead of after the auxiliary)
     agree-etre a participle of an être verb without the feminine e after elle(s): *elle est allé, *elles sont parti
     elision    a word that elides, written whole before a vowel or a mute h: *je aime, *parce que il, *le ami, *de
                accord, *si il (le/la stay before an aspirated h and before onze, oui, a y: le héros, le onze, le yaourt) */
// @ts-check
/** @typedef {import('../types.js').Detector} Detector */
/** @typedef {import('../types.js').DetectContext} DetectContext */

/** Lower case, NFC, one apostrophe, elision split off, punctuation out: the words, space-separated. @param {unknown} s */
export const norm = s => String(s == null ? '' : s).normalize('NFC').toLowerCase().replace(/[‘’ʼ]/g, "'")
  .replace(/(^|[^\p{L}'])(jusqu|lorsqu|puisqu|quoiqu|qu|[cdjlmnst])'(?=\p{L})/gu, "$1$2' ")
  .replace(/[^\p{L}\p{N}\s'-]/gu, ' ').split(/\s+/).filter(Boolean).join(' ');
const words = (/** @type {string} */ s) => norm(s).split(' ').filter(Boolean);
const set = (/** @type {string} */ s) => new Set(s.split(/\s+/).filter(Boolean));

const AVOIR = set('ai as a avons avez ont avais avait avions aviez avaient aurai auras aura aurons aurez auront aurais aurait aurions auriez auraient');
// participles of verbs that take être and have no transitive use with avoir
const ETRE_PP = /^(all|ven|arriv|part|n|mort|rest|tomb|deven|reven|parven|interven|décéd)(é|u|i|e|ée|ue|ie|és|us|is|ées|ues|ies|s|es)?$/;
const ETRE_PP_LIST = set(`allé allée allés allées venu venue venus venues arrivé arrivée arrivés arrivées parti partie partis parties né née nés nées
  mort morte morts mortes resté restée restés restées tombé tombée tombés tombées devenu devenue devenus devenues revenu revenue revenus revenues
  parvenu parvenue parvenus parvenues intervenu intervenue intervenus intervenues décédé décédée décédés décédées`);
// words that may stand between the auxiliary and the participle
const BETWEEN = set("ne n' pas jamais déjà bien vite encore toujours souvent plus rien vraiment enfin aussi même tous toutes peut-être y en");
const SUBJ = set("je j' tu il elle on nous vous ils elles");
const ETRE = set('suis es est sommes êtes sont étais était étions étiez étaient serai sera serons serez seront serais serait');
const ETRE3 = set('est sont était étaient sera seront serait seraient');
const MASC_PP = set('allé allés venu venus arrivé arrivés parti partis resté restés tombé tombés devenu devenus revenu revenus né nés mort morts entré entrés sorti sortis rentré rentrés retourné retournés');
// past participles (for the ne … pas order): the être verbs and the common avoir verbs at A2-B1
const PP = /^(\p{L}+(é|ée|és|ées)|\p{L}*(fini|choisi|parti|sorti|dormi|servi|senti|menti|réussi|compris|pris|appris|mis|permis|promis|dit|écrit|fait|lu|vu|eu|bu|su|pu|dû|voulu|venu|tenu|devenu|revenu|connu|reçu|cru|vécu|perdu|attendu|entendu|répondu|vendu|rendu|descendu|mort|né|ouvert|offert|été))$/u;
// a conjugated verb is anything not an infinitive, a participle or a closed word: the ne-pas rule only looks at
// what follows "ne pas", where an infinitive is right (pour ne pas oublier)
const INF = /(er|ir|re|oir)$/;
const NONVERB = set("le la les l' un une des du de d' au aux me m' te t' se s' nous vous lui leur y en à dans");

// words that start with a vowel sound for elision: a vowel or a mute h; not an aspirated h, nor onze, oui, ouate, a y
const VOWEL = /^[aeiouàâäéèêëîïôöùûüœæ]/;
const H_ASPIRE = /^(hache|haie|haine|haïr|hall|hamburger|hamac|handicap|hangar|hanter|harceler|haricots?|harpe|hasard|hâte|hausse|haut|hauteur|haute|hautes|hauts|héros|hêtre|hibou|hic|hiérarchie|hockey|hollande|homard|honte|hors|housse|hublot|huit|huitième|hurler|hurlement|hutte|hongrie|hongrois|hip-hop)$/;
const NO_ELISION = /^(onze|onzième|oui|ouate|ouistiti|uhlan)$/;
const ELIDES = set('je me te se le la ne de que ce jusque lorsque puisque');
/** @param {string} w */
const vowelSound = w => (VOWEL.test(w) && !NO_ELISION.test(w)) || (/^h/.test(w) && !H_ASPIRE.test(w));

/** @type {Detector[]} */
export const DETECTORS = [
  { cls: 'aux-etre', find: ({ text }) => {
    const w = words(text);
    for (let i = 0; i < w.length; i++) {
      // je m'ai, il s'a, ils s'ont, nous nous avons, vous vous avez: a pronominal verb takes être
      if ((w[i] === "m'" && w[i - 1] === 'je' && w[i + 1] === 'ai') || (w[i] === "s'" && (w[i + 1] === 'a' || w[i + 1] === 'ont') && SUBJ.has(w[i - 1] || ''))
        || (w[i] === 'nous' && w[i - 1] === 'nous' && w[i + 1] === 'avons') || (w[i] === 'vous' && w[i - 1] === 'vous' && w[i + 1] === 'avez' && ETRE_PP_LIST.has(w[i + 2] || '')))
        return { word: w[i + 1], hint: 'Check the helper verb: a reflexive verb takes être in the passé composé.' };
      if (!AVOIR.has(w[i])) continue;
      // "a" right after à-less spellings is too risky: only after a subject, a pronoun or ne
      const prev = w[i - 1] || '';
      if (!(SUBJ.has(prev) || prev === "n'" || prev === 'ne' || prev === 'y' || prev === 'en')) continue;
      let k = i + 1;
      while (k < w.length && k - i <= 3 && BETWEEN.has(w[k])) k++;
      const pp = w[k] || '';
      if (ETRE_PP_LIST.has(pp) && ETRE_PP.test(pp)) return { word: pp, hint: `Check the helper verb before ${pp}.` };
    }
    return null;
  } },
  { cls: 'ne-pas', find: ({ text }) => {
    const w = words(text);
    for (let i = 0; i < w.length - 2; i++) {
      if (w[i] !== 'ne' && w[i] !== "n'") continue;
      // ne pas + a conjugated verb, after a subject: *je ne pas parle (ne pas + an infinitive is right)
      if (w[i + 1] === 'pas' && SUBJ.has(w[i - 1] || '') && w[i + 2] && !INF.test(w[i + 2]) && !NONVERB.has(w[i + 2]) && !PP.test(w[i + 2]))
        return { word: 'pas', hint: 'Check where pas goes.' };
      // ne + auxiliary + participle + pas: *je ne suis allé pas, *il n'a fini pas
      if ((AVOIR.has(w[i + 1]) || ETRE.has(w[i + 1])) && w[i + 2] && PP.test(w[i + 2]) && w[i + 3] === 'pas')
        return { word: 'pas', hint: 'Check where pas goes.' };
    }
    return null;
  } },
  { cls: 'elision', find: ({ text }) => {
    const w = words(text);
    for (let i = 0; i < w.length - 1; i++) {
      const a = w[i], b = w[i + 1];
      // si elides only before il and ils (s'il), never before elle or on
      if ((ELIDES.has(a) && vowelSound(b)) || (a === 'si' && (b === 'il' || b === 'ils'))) {
        // le and la as objects after an imperative are written with a hyphen (prends-le): one word here, never seen
        return { word: a, hint: `Check the elision: ${a === 'si' ? "s'il" : `${a.slice(0, -1)}'${b}`}.` };
      }
    }
    return null;
  } },
  { cls: 'agree-etre', find: ({ text }) => {
    const w = words(text);
    for (let i = 0; i < w.length - 2; i++) {
      // elle(s) as the only subject: "Paul et elle sont partis" agrees with both (masculine plural is right)
      if ((w[i] !== 'elle' && w[i] !== 'elles') || w[i - 1] === 'et' || w[i - 1] === 'ou' || w[i + 1] === 'et' || w[i + 1] === 'ou') continue;
      let k = i + 1;
      if (w[k] === 'ne' || w[k] === "n'") k++;
      if (w[k] === 'se' || w[k] === "s'") k++;
      if (!ETRE3.has(w[k] || '')) continue;
      k++;
      while (k < w.length && k - i <= 6 && BETWEEN.has(w[k])) k++;
      const pp = w[k] || '';
      if (MASC_PP.has(pp)) return { word: pp, hint: `Check the ending of ${pp} after ${w[i]}.` };
    }
    return null;
  } },
];
