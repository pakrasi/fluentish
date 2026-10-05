/* The exam runner's strings (exam-locale@1, content/exams/<id>/locale.<lang>.json): the exam speaks its own language
   (Goethe B1: German with Sie) while the chrome around it stays in the app's locale (core/i18n.js). Same rules as
   t(): {name} is filled in; an object {one, other} is a plural chosen on vars.n with the exam language's rules; a key
   the catalog lacks shows itself, so it is easy to spot. */

/**
 * @typedef {((key: string, vars?: Record<string, any>) => string) & { has: (key: string) => boolean, lang: string }} ExamT
 */

/**
 * A translator over one catalog.
 * @param {{ lang: string, strings: Record<string, string | Record<string, string>> }} catalog
 * @returns {ExamT}
 */
export function createTx(catalog) {
  const strings = catalog?.strings || {};
  const lang = catalog?.lang || 'en';
  const rules = new Intl.PluralRules(lang);
  const tx = /** @type {ExamT} */ ((key, vars = {}) => {
    let v = strings[key];
    if (v == null) return key;
    if (typeof v === 'object') v = v[rules.select(Number(vars.n ?? 0))] ?? v.other;
    return String(v).replace(/\{(\w+)\}/g, (m, k) => (vars[k] == null ? m : String(vars[k])));
  });
  tx.has = key => strings[key] != null;
  tx.lang = lang;
  return tx;
}
