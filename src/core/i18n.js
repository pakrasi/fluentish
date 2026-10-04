/* Interface strings. Every piece of chrome goes through t('key', vars), so German chrome and the iOS app are a
   translation job (review A15). Catalogs are plain modules in src/i18n/; a key missing from the active locale falls
   back to English, and a key missing everywhere shows itself so it is easy to spot.

   Plurals: a key whose value is an object { one, other } is chosen with Intl.PluralRules on vars.n.
   Interpolation: {name} is replaced by vars.name. Values are text only; t() never returns markup. */
import en from '../i18n/en.js';
import de from '../i18n/de.js';

/** @type {Record<string, Record<string, any>>} */
const CATALOGS = { en, de };
let locale = 'en';
/** @type {Intl.PluralRules} */
let rules = new Intl.PluralRules('en');

/** @param {string} l */
export function setLocale(l) {
  locale = CATALOGS[l] ? l : 'en';
  rules = new Intl.PluralRules(locale);
  if (typeof document !== 'undefined') document.documentElement.lang = locale;
}
export const getLocale = () => locale;

/**
 * @param {string} key
 * @param {Record<string, any>} [vars]
 * @returns {string}
 */
export function t(key, vars = {}) {
  let v = CATALOGS[locale][key] ?? CATALOGS.en[key];
  if (v == null) return key;
  if (typeof v === 'object') v = v[rules.select(Number(vars.n ?? 0))] ?? v.other;
  return String(v).replace(/\{(\w+)\}/g, (m, k) => (vars[k] == null ? m : String(vars[k])));
}

/** "a, b and c" in the active locale. @param {string[]} items */
t.list = items => new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(items);

/** Number with grouping in the active locale. @param {number} n */
export const num = n => new Intl.NumberFormat(locale).format(n);

/** Every key of a catalog (tests check that de has no keys en lacks). @param {string} l */
export const keys = l => Object.keys(CATALOGS[l] || {});
