/* Reading an exam definition (exam-def@1, content/exams/<id>/exam.json) against one of its tests: sections, parts,
   the items of a part in exam order, an item's type, its correct value and its printed number. Pure: no DOM, no
   clock, no storage. domain/grade.js grades through it and src/features/exam renders through it, so a new exam is
   a definition and a locale, never engine code (docs/ARCHITECTURE.md, "Exams as data"). */

/** @typedef {'tf' | 'mc' | 'match' | 'yn' | 'who-said' | 'writing' | 'speaking'} ItemType */
/**
 * One objective item of a test, in exam order.
 * @typedef {{ id: string, item: any, type: ItemType, part: any, section: any, group: any, gi: number, nr: number }} ExamItem
 */

/**
 * The value at a dot path ('lesen.teil2.texts') of an object, or undefined.
 * @param {any} obj @param {string | undefined} p
 */
export function at(obj, p) {
  if (!p) return obj;
  let v = obj;
  for (const k of p.split('.')) { if (v == null) return undefined; v = v[k]; }
  return v;
}

/** A section (module) of the definition by id, or null. @param {any} def @param {string} id */
export const section = (def, id) => (def?.sections || []).find((/** @type {any} */ s) => s.id === id) || null;

/** The ids of the objective sections ('lesen', 'hoeren'). @param {any} def @returns {string[]} */
export const objectiveIds = def => (def?.sections || []).filter((/** @type {any} */ s) => s.kind === 'objective').map((/** @type {any} */ s) => s.id);

/** "{nn}" → the two-digit test number, "{n}" → the number. @param {string} tpl @param {number} n */
export const testPath = (tpl, n) => String(tpl).replace(/\{nn\}/g, String(n).padStart(2, '0')).replace(/\{n\}/g, String(n));

/** "{field}" → that field of `vars`. @param {string} tpl @param {Record<string, any>} vars */
export const fill = (tpl, vars) => String(tpl).replace(/\{([\w-]+)\}/g, (m, k) => (vars[k] == null ? m : String(vars[k])));

/**
 * The groups a part repeats over (Lesen Teil 2's two texts, Hören Teil 1's five), or the one group it has.
 * @param {any} ex a test @param {any} part @returns {any[]}
 */
export const groupsOf = (ex, part) => (part.groups ? at(ex, part.groups) || [] : [at(ex, part.group)]);

/** An item's type within its part: the part's type, or the item's own field mapped. @param {any} part @param {any} item @returns {ItemType} */
export function typeOf(part, item) {
  const t = part.type;
  if (typeof t === 'string') return /** @type {ItemType} */ (t);
  return /** @type {ItemType} */ (t.map[item?.[t.field]] ?? t.default);
}

/**
 * The items of one part in exam order, with their printed numbers.
 * @param {any} def @param {any} ex @param {any} sec @param {any} part @returns {ExamItem[]}
 */
export function partItems(def, ex, sec, part) {
  /** @type {ExamItem[]} */ const out = [];
  groupsOf(ex, part).forEach((g, gi) => {
    for (const item of at(g, part.items) || []) out.push({ id: item.id, item, type: typeOf(part, item), part, section: sec, group: g, gi, nr: part.first + out.length });
  });
  return out;
}

/**
 * Every objective item of a test, section by section, part by part.
 * @param {any} def @param {any} ex @param {string} [only] one section id @returns {ExamItem[]}
 */
export function objectiveItems(def, ex, only) {
  return (def.sections || []).filter((/** @type {any} */ s) => s.kind === 'objective' && (!only || s.id === only))
    .flatMap((/** @type {any} */ s) => s.parts.flatMap((/** @type {any} */ p) => partItems(def, ex, s, p)));
}

/**
 * The correct value of an item as the result rows store it, from its type's key rule.
 * @param {any} def @param {ItemType} type @param {any} item @returns {string}
 */
export function correctValue(def, type, item) {
  const k = def.itemTypes[type]?.key;
  if (!k) throw new Error(`exam-def ${def.id}: item type ${type} has no key rule`);
  if (k.from === 'bool') return item.answer ? k.true : k.false;
  if (k.from === 'index') return k.values[item.answer];
  return k.none != null ? item.answer || k.none : item.answer;
}

/**
 * The values an item can be given, in the order they are offered (match: the part's choices after the "none" value).
 * @param {any} def @param {ExamItem} it @returns {string[]}
 */
export function valuesOf(def, it) {
  const k = def.itemTypes[it.type]?.key || {};
  if (k.from === 'bool') return [k.true, k.false];
  if (k.from === 'index') return (it.item.options || []).map((/** @type {any} */ _, /** @type {number} */ i) => k.values[i]);
  if (it.part.choices) return [...(k.none != null ? [k.none] : []), ...(at(it.group, it.part.choices.from) || []).map((/** @type {any} */ c) => c[it.part.choices.value])];
  return k.values || [];
}

/** The text of an item for lists and reviews, from its type's template. @param {any} def @param {ExamItem} it */
export const itemText = (def, it) => fill(def.itemTypes[it.type]?.text || '', it.item);
