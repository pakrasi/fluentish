/* Runtime checks of stored records against schemas/records (review "Fix schema drift and validate in tests", arch #6).

   Only in development and tests: the deployed app never loads a schema (schemas/ is not published). A dev server, the
   e2e server and the node tests give the store a checker (store.check); every store.set of a checked collection and
   every store.append is validated before it is written, and a record that does not match its schema is reported:
   console.error in a browser (the e2e suite fails on any console error), an exception in node tests.

   What is checked, and against which schema:
     event      every appended event                         event@1
     kv         settings                                      settings@1
                prefs                                         prefs@1
                exams.feedbackLocal (a list)                  feedback@1 per item
                progress.<course>.<YYYY-MM> (by name pattern)  progress@1
     profile    a profile record written to the adapter       profile@1
   Pure apart from loadRecordSchemas (a fetch); the validator is core/schema.js, the same one CI uses for content. */
import { validate } from '../core/schema.js';
import { MONTH_KEY } from '../domain/progress-key.js';

/** Schema files under schemas/records/, by the name the checker uses. */
export const RECORD_SCHEMAS = /** @type {const} */ (['event', 'settings', 'prefs', 'profile', 'feedback', 'progress']);

/** Which schema checks which key-value collection; `list` collections are arrays of that record. */
export const KV_SCHEMAS = /** @type {Record<string, {schema: string, list?: boolean}>} */ ({
  settings: { schema: 'settings' },
  prefs: { schema: 'prefs' },
  'exams.feedbackLocal': { schema: 'feedback', list: true },
});

/** Collections checked by name pattern: the progress log's months (domain/progress.js MONTH_KEY). */
export const KV_PATTERNS = /** @type {[RegExp, {schema: string}][]} */ ([[MONTH_KEY, { schema: 'progress' }]]);

/**
 * The errors of one record. kind 'kv' looks the schema up by collection name; others by kind.
 * @param {Record<string, any>} schemas name → JSON Schema @param {'event' | 'kv' | 'profile'} kind @param {string} name @param {any} value
 * @returns {string[]}
 */
export function recordErrors(schemas, kind, name, value) {
  if (kind === 'kv') {
    const m = KV_SCHEMAS[name] || (KV_PATTERNS.find(([re]) => re.test(name)) || [])[1];
    if (!m || value === undefined || !schemas[m.schema]) return [];
    if (!m.list) return validate(schemas[m.schema], value);
    if (!Array.isArray(value)) return [`/: ${name} must be a list`];
    return value.flatMap((x, i) => validate(schemas[m.schema], x).map(e => `/${i}${e.slice(1)}`));
  }
  const s = schemas[kind];
  return s ? validate(s, value) : [];
}

/**
 * A checker for store.check / the profile writes: validates and hands every mismatch to onInvalid.
 * @param {Record<string, any>} schemas
 * @param {(message: string, detail: {kind: string, name: string, errors: string[]}) => void} [onInvalid]
 * @returns {(kind: 'event' | 'kv' | 'profile', name: string, value: any) => void}
 */
export function recordChecker(schemas, onInvalid = (m) => console.error(m)) {
  return (kind, name, value) => {
    const errors = recordErrors(schemas, kind, name, value);
    if (errors.length) onInvalid(`schema: ${kind} ${name} does not match schemas/records: ${errors.slice(0, 3).join('; ')}`, { kind, name, errors });
  };
}

/**
 * The record schemas, fetched from <root>schemas/records/ (a dev server serves the repository; the e2e server serves
 * them next to the stamped site). null when they cannot be read: then nothing is checked.
 * @param {string} root the app root URL @param {typeof fetch} [f]
 * @returns {Promise<Record<string, any> | null>}
 */
export async function loadRecordSchemas(root, f = (...a) => fetch(...a)) {
  try {
    const got = await Promise.all(RECORD_SCHEMAS.map(async n => {
      const r = await f(new URL(`schemas/records/${n}.schema.json`, root).href, { cache: 'no-store' });
      if (!r.ok) throw new Error(`${n}: HTTP ${r.status}`);
      return [n, await r.json()];
    }));
    return Object.fromEntries(got);
  } catch {
    return null;
  }
}
