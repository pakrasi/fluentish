/* German word formation and articles for the content checks and the map (moved unchanged from domain/clusters.js and
   domain/atlas.js, Wave C2). */
// @ts-check

/** The definite articles in content order: the map's word types and the atlas file's article column (index + 1). */
export const CITATION = ['der', 'die', 'das'];
/** Prefixes that never separate. */
export const INSEPARABLE = new Set(['be', 'emp', 'ent', 'er', 'ge', 'miss', 'ver', 'zer']);
/** Every prefix morph may use (verb particles, inseparable prefixes and the noun and adjective prefixes). */
export const PREFIX_SET = new Set([...INSEPARABLE, 'ab', 'an', 'auf', 'aus', 'bei', 'dar', 'durch', 'ein', 'fern', 'fest', 'fort', 'frei', 'gegen', 'heran', 'heraus',
  'her', 'hin', 'hinter', 'kennen', 'mit', 'nach', 'nieder', 'rück', 'sitzen', 'statt', 'teil', 'über', 'um', 'un', 'unter', 'ur', 'voll', 'vor', 'voran', 'vorbei',
  'vorweg', 'weg', 'wider', 'wieder', 'zu', 'zurecht', 'zurück', 'zusammen']);
/** The cases a preposition note may name (null: none). */
export const PREP_CASES = new Set(['dat', 'akk', 'gen', 'two-way', null]);
/** Words that must never head a family (heuristic errors the Explore prototype made). */
export const NOT_HEADS = ['das_Mittel', 'statt.prep', 'zumal.conj'];
/** Known false families, as [word, family] pairs: kept out as regression checks. */
export const NOT_IN = /** @type {[string, string][]} */ ([['die_Zeitung', 'zeit'], ['die_Gefahr', 'fahren'], ['gehören.verb', 'holen'], ['das_Beispiel', 'spielen'], ['der_Reis', 'reisen'], ['der_Wein', 'weinen']]);
