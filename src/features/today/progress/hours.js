/* The study hours file for Progress › Time per week › All tracked (hours-json@1: {entries: [{date, hours, lang?}]}).
   Where it is: settings.connections.hours ({repo: 'owner/name', path, lang}); without it there is no file and Progress
   shows the app's minutes only (no default: docs/SHARING.md). It is a public
   GitHub Pages file (https://owner.github.io/name/path), read directly, at most once a study day, and kept in the
   device kv 'hours.external' (a copy of a public file: never exported, uploaded or backed up). Its hours are shown on
   their own and never added to the app's minutes: the file already includes the time spent in Fluentish. */
import { hoursUrl } from './model.js';

export const HOURS_KV = 'hours.external';
const TIMEOUT_MS = 10e3;

/** @typedef {import('./model.js').HoursSource} HoursSource */
/** @typedef {{url: string, day: string, at: string, syncedAt: string | null, entries: {date: string, hours: number, lang: string | null}[]}} Cached */

/** The source the learner entered, or null (none: "All tracked" is not offered). @param {any} settings normalised settings @returns {HoursSource | null} */
export function hoursSource(settings) {
  const s = settings?.connections?.hours;
  if (s && typeof s.repo === 'string' && typeof s.path === 'string') return { repo: s.repo, path: s.path, lang: s.lang ?? null };
  return null;
}

/** The copy kept on this device, when it is of this url. @param {any} store @param {string} url @returns {Cached | null} */
export function cached(store, url) {
  const c = store.get(HOURS_KV, null);
  return c && c.url === url && Array.isArray(c.entries) ? c : null;
}

/**
 * The file, read once a study day (or now with force). On a failed read the last copy stays and the error is returned.
 * @param {{store: any, clock: {today: () => string}}} ctx @param {HoursSource} src @param {{force?: boolean, fetch?: typeof fetch}} [o]
 * @returns {Promise<{data: Cached | null, error: string | null, url: string | null}>}
 */
export async function loadHours(ctx, src, { force = false, fetch: f = globalThis.fetch } = {}) {
  const url = hoursUrl(src);
  if (!url) return { data: null, error: 'source', url: null };
  const have = cached(ctx.store, url);
  const today = ctx.clock.today();
  if (have && have.day === today && !force) return { data: have, error: null, url };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await f(url, { cache: 'no-cache', signal: ctl.signal, credentials: 'omit' });
    if (!res.ok) throw new Error(`http ${res.status}`);
    const file = await res.json();
    if (!file || !Array.isArray(file.entries)) throw new Error('not an hours file');
    /** @type {Cached} */ const data = {
      url, day: today, at: new Date().toISOString(), syncedAt: typeof file.syncedAt === 'string' ? file.syncedAt : null,
      entries: file.entries.filter((/** @type {any} */ e) => e && typeof e.date === 'string' && Number.isFinite(Number(e.hours)))
        .map((/** @type {any} */ e) => ({ date: e.date, hours: Number(e.hours), lang: typeof e.lang === 'string' ? e.lang : null })),
    };
    ctx.store.set(HOURS_KV, data);
    return { data, error: null, url };
  } catch (e) {
    return { data: have, error: String(/** @type {any} */ (e)?.message || e), url };
  } finally {
    clearTimeout(timer);
  }
}
