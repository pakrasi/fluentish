/* A small JSON Schema (2020-12 subset) validator. Pure, no dependencies; the content gate (tools/validate-content.mjs)
   and the import of export bundles both use it, so the browser and CI apply the same rules.

   Supported: $ref (local "#/$defs/…"), type, enum, const, properties, required, additionalProperties,
   patternProperties, propertyNames, items, prefixItems, minItems, maxItems, uniqueItems, minLength, maxLength,
   pattern, minimum, maximum, minProperties, anyOf, oneOf, allOf, not, format "date" and "date-time".
   Anything else is ignored, so keep schemas within this list (tests/unit/schema.test.mjs checks the keywords used). */

export const KEYWORDS = new Set(['$schema', '$id', '$ref', '$defs', '$comment', 'title', 'description', 'examples', 'default',
  'type', 'enum', 'const', 'properties', 'required', 'additionalProperties', 'patternProperties', 'propertyNames', 'items',
  'prefixItems', 'minItems', 'maxItems', 'uniqueItems', 'minLength', 'maxLength', 'pattern', 'minimum', 'maximum',
  'minProperties', 'anyOf', 'oneOf', 'allOf', 'not', 'format']);

/** @param {unknown} v @returns {string} */
const typeOf = v => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);
/** @param {string} want @param {unknown} v */
const isType = (want, v) => { const t = typeOf(v); return t === want || (want === 'number' && t === 'integer'); };
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
/** @type {Map<string, RegExp>} */
const reCache = new Map();
/** @param {string} p */
const re = p => { let r = reCache.get(p); if (!r) { r = new RegExp(p, 'u'); reCache.set(p, r); } return r; };

/**
 * Validate a value. Returns a list of errors (empty when valid), each "path: message".
 * @param {any} schema @param {unknown} value @param {{max?: number}} [o]
 * @returns {string[]}
 */
export function validate(schema, value, { max = 20 } = {}) {
  /** @type {string[]} */
  const errors = [];
  const root = schema;
  /** @param {any} s @param {any} v @param {string} at @returns {boolean} */
  function check(s, v, at) {
    if (errors.length >= max) return false;
    if (s === true || s == null) return true;
    if (s === false) { errors.push(`${at || '/'}: not allowed`); return false; }
    const before = errors.length;
    const err = (/** @type {string} */ m) => { errors.push(`${at || '/'}: ${m}`); };
    if (s.$ref) {
      const m = /^#\/\$defs\/(.+)$/.exec(s.$ref);
      if (!m || !root.$defs || !(m[1] in root.$defs)) err(`unknown $ref ${s.$ref}`);
      else check(root.$defs[m[1]], v, at);
    }
    if (s.type) {
      const ts = Array.isArray(s.type) ? s.type : [s.type];
      if (!ts.some((/** @type {string} */ t) => isType(t, v))) { err(`expected ${ts.join(' or ')}, got ${typeOf(v)}`); return false; }
    }
    if (s.enum && !s.enum.some((/** @type {unknown} */ e) => JSON.stringify(e) === JSON.stringify(v))) err(`must be one of ${JSON.stringify(s.enum).slice(0, 120)}`);
    if ('const' in s && JSON.stringify(s.const) !== JSON.stringify(v)) err(`must be ${JSON.stringify(s.const)}`);
    if (typeof v === 'string') {
      if (s.minLength != null && v.length < s.minLength) err(`shorter than ${s.minLength}`);
      if (s.maxLength != null && v.length > s.maxLength) err(`longer than ${s.maxLength}`);
      if (s.pattern && !re(s.pattern).test(v)) err(`does not match ${s.pattern}`);
      if (s.format === 'date' && !DATE.test(v)) err('not a YYYY-MM-DD date');
      if (s.format === 'date-time' && !DATETIME.test(v)) err('not an ISO date-time with offset');
    }
    if (typeof v === 'number') {
      if (s.minimum != null && v < s.minimum) err(`below ${s.minimum}`);
      if (s.maximum != null && v > s.maximum) err(`above ${s.maximum}`);
    }
    if (Array.isArray(v)) {
      if (s.minItems != null && v.length < s.minItems) err(`needs at least ${s.minItems} items, has ${v.length}`);
      if (s.maxItems != null && v.length > s.maxItems) err(`allows at most ${s.maxItems} items, has ${v.length}`);
      if (s.uniqueItems && new Set(v.map(x => JSON.stringify(x))).size !== v.length) err('items must be unique');
      const pre = s.prefixItems || [];
      v.forEach((x, i) => { if (i < pre.length) check(pre[i], x, `${at}/${i}`); else if (s.items !== undefined) check(s.items, x, `${at}/${i}`); });
    }
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const o = /** @type {Record<string, unknown>} */ (v);
      const keys = Object.keys(o);
      if (s.minProperties != null && keys.length < s.minProperties) err(`needs at least ${s.minProperties} properties`);
      for (const k of s.required || []) if (!(k in o)) err(`missing ${k}`);
      for (const k of keys) {
        const sub = `${at}/${k}`;
        let matched = false;
        if (s.properties && k in s.properties) { matched = true; check(s.properties[k], o[k], sub); }
        if (s.patternProperties) for (const [p, ps] of Object.entries(s.patternProperties)) if (re(p).test(k)) { matched = true; check(ps, o[k], sub); }
        if (s.propertyNames) check(s.propertyNames, k, `${sub}#name`);
        if (!matched && s.additionalProperties !== undefined) {
          if (s.additionalProperties === false) err(`unexpected property ${k}`);
          else check(s.additionalProperties, o[k], sub);
        }
      }
    }
    const trial = (/** @type {any} */ sub) => { const saved = errors.length; const ok = check(sub, v, at) && errors.length === saved; errors.length = saved; return ok; };
    if (s.allOf) for (const sub of s.allOf) check(sub, v, at);
    if (s.anyOf && !s.anyOf.some(trial)) err('matches none of anyOf');
    if (s.oneOf) { const n = s.oneOf.filter(trial).length; if (n !== 1) err(`matches ${n} of oneOf, needs exactly 1`); }
    if (s.not && trial(s.not)) err('matches a schema it must not');
    return errors.length === before;
  }
  check(schema, value, '');
  return errors;
}

/** Every keyword a schema uses that this validator ignores (a schema-lint helper). @param {any} s @returns {string[]} */
export function unsupported(s, at = '') {
  if (!s || typeof s !== 'object') return [];
  /** @type {string[]} */
  const out = [];
  for (const [k, v] of Object.entries(s)) {
    if (!KEYWORDS.has(k)) out.push(`${at}/${k}`);
    if (k === 'properties' || k === 'patternProperties' || k === '$defs') for (const [n, sub] of Object.entries(v)) out.push(...unsupported(sub, `${at}/${k}/${n}`));
    else if (k === 'items' || k === 'additionalProperties' || k === 'propertyNames' || k === 'not') out.push(...unsupported(v, `${at}/${k}`));
    else if (k === 'anyOf' || k === 'oneOf' || k === 'allOf' || k === 'prefixItems') v.forEach((/** @type {any} */ x, /** @type {number} */ i) => out.push(...unsupported(x, `${at}/${k}/${i}`)));
  }
  return out;
}
