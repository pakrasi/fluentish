/* Deck names and the language each deck belongs to (Arch #12, round 3 wave C).

   A deck made from now on is named '<lang>:<name>' ('fr:core', 'de:verbs'): the language is part of the name, so two
   courses never share a deck and a card's language can be read from where it lives. The decks that existed before
   courses keep their names for ever; they are German, through the fixed LEGACY_DECK_LANG below. Card ids and the
   IndexedDB keys [profileId, deck, itemId] never change: a legacy deck is never renamed or copied into 'de:…'.

   Pure; tested in node (tests/unit/courses.test.mjs). */

/** The decks from before courses, and their language. Fixed: never add to it (a new deck is '<lang>:<name>'). */
export const LEGACY_DECK_LANG = Object.freeze(/** @type {Record<string, string>} */ ({ b1: 'de', speak: 'de', script: 'de', clusters: 'de', build: 'de' }));

/** The legacy decks, in the order the app has always read them. */
export const LEGACY_DECKS = Object.freeze(Object.keys(LEGACY_DECK_LANG));

const LANG = /^[a-z]{2,3}$/;
const NAME = /^[a-z0-9][a-z0-9._-]*$/;

/**
 * A new deck's name: '<lang>:<name>'. Throws on a malformed part, and on a legacy name (those stay as they are).
 * @param {string} lang 'fr' @param {string} name 'core'
 */
export function deckId(lang, name) {
  if (!LANG.test(String(lang)) || !NAME.test(String(name))) throw new Error(`deck: bad name ${lang}:${name}`);
  return `${lang}:${name}`;
}

/**
 * The language of a deck: the prefix of a namespaced deck, LEGACY_DECK_LANG for an old one, else null.
 * @param {string} deck @returns {string | null}
 */
export function deckLang(deck) {
  const s = String(deck || '');
  const i = s.indexOf(':');
  if (i > 0) { const l = s.slice(0, i); return LANG.test(l) ? l : null; }
  return Object.prototype.hasOwnProperty.call(LEGACY_DECK_LANG, s) ? LEGACY_DECK_LANG[s] : null;
}

/**
 * The deck's name without its language ('fr:core' → 'core', 'b1' → 'b1'): what rules that depend on the kind of deck
 * (knowledge's resolver, a card's origin) read.
 * @param {string} deck
 */
export function deckName(deck) {
  const s = String(deck || '');
  const i = s.indexOf(':');
  return i > 0 && LANG.test(s.slice(0, i)) ? s.slice(i + 1) : s;
}

/**
 * Whether a deck belongs to a language's course.
 * @param {string} deck @param {string | null | undefined} lang
 */
export const inLang = (deck, lang) => !!lang && deckLang(deck) === lang;

/**
 * The decks of a course that a reader should look at, out of the deck names it knows: those in the course's language.
 * With no course (a profile before onboarding, or a caller that passes none) every known deck is kept, which is how
 * the app read them before courses.
 * @param {readonly string[]} known @param {{lang: string} | null | undefined} course
 */
export function decksOf(known, course) {
  return course ? known.filter(d => inLang(d, course.lang)) : [...known];
}

/**
 * The language of normalised settings' active course ('de'), or null when there is none. Domain code reads it from the
 * settings object it is given (data/settings.js owns the model).
 * @param {any} settings
 * @returns {string | null}
 */
export function courseLang(settings) {
  if (!settings || !Array.isArray(settings.courses)) return null;
  const c = settings.courses.find((/** @type {any} */ x) => x && x.id === settings.activeCourse);
  return c && typeof c.lang === 'string' ? c.lang : null;
}
