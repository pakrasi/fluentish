/* Every URL, endpoint and fixed limit the app uses, in one place (review S16: no '../' cross-repo URLs in src).
   Values that come with the content (exam module limits, media base) live in content/manifest.json instead. */

const here = new URL('.', import.meta.url);
/* The deploy publishes code under an immutable v/<sha>/ directory (tools/stamp.mjs), while index.html, sw.js, content/
   and assets/ stay at the app root. Both layouts resolve to the same root: …/src/core/ or …/v/<sha>/src/core/. */
const VERSIONED = /\/v\/([0-9a-f]{7,40})\/src\/core\/$/;
const root = new URL(here.href.replace(VERSIONED, '/').replace(/\/src\/core\/$/, '/'));

export const config = {
  name: 'Fluentish',
  /** The app root (/fluentish/ when deployed): index.html, sw.js, version.json, content/ and assets/ live here. */
  root: root.href,
  /** The deployed commit, read from this module's own v/<sha>/ path; null on a dev server. */
  build: VERSIONED.exec(here.href)?.[1] ?? null,
  /** Base of the public content pack; every file is found through manifest.json. */
  contentBase: new URL('content/', root).href,
  /** Shadow mode (review A3): until the cutover, a deployed site creates preview profiles that never sync, so nothing
     done here reaches the b1-exam repo the old apps read. The cutover sets this to false. Dev servers create local
     profiles as before. */
  deployShadow: true,
  /** Private repository the results sync writes to (stage C); the device link stores a token for it. */
  resultsRepo: 'pakrasi/b1-exam',
  github: {
    api: 'https://api.github.com',
    newTokenUrl: 'https://github.com/settings/personal-access-tokens/new',
  },
  anthropic: {
    api: 'https://api.anthropic.com/v1/messages',
    /** Carried over from the two legacy apps (review N6); the Claude service (stage B) reads them from here. */
    models: { check: 'claude-haiku-4-5', coach: 'claude-opus-5', grade: 'claude-opus-5-5' },
    version: '2023-06-01',                              // date-gate: api-version (the anthropic-version header)
    fallbackBeta: 'server-side-fallback-2026-07-01',    // date-gate: api-version (refusal fallback, fallbacks: 'default')
  },
  defaults: { minutesPerDay: 60, cutoffHour: 4 },
  /** Options offered in onboarding and Profile. */
  minutesOptions: [15, 30, 60, 90],
  levels: ['A1', 'A2', 'B1', 'B2', 'C1'],
  /** localStorage keys this app owns (it never writes the legacy keys). */
  keys: { migrated: 'fluentish.migrated', boot: 'fluentish.boot' },
};

/** True on a local dev server: enables ?today= and other dev-only switches. A phone link must never fake the date. */
export const isDev = () => typeof location !== 'undefined' && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
