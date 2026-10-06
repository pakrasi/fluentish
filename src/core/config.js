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
  /** Shadow mode (review A3): a deployed site that creates preview profiles that never sync. Off since the cutover:
     the first start of a device that opened the preview merges that work into its real profile (data/session.js
     keepPreview). Dev servers create local profiles either way. */
  deployShadow: false,
  /* No repository is named here (docs/SHARING.md): the results repository and the study hours file are a profile's
     own connections (settings.connections.results and .hours, data/connection.js). A new profile has neither. */
  github: {
    api: 'https://api.github.com',
    newTokenUrl: 'https://github.com/settings/personal-access-tokens/new',
    /** Where a token is revoked (Profile › Connections › Lost a device?). */
    tokensUrl: 'https://github.com/settings/personal-access-tokens',
  },
  anthropic: {
    api: 'https://api.anthropic.com/v1/messages',
    /** Carried over from the two legacy apps (review N6); the Claude service (stage B) reads them from here. */
    models: { check: 'claude-haiku-4-5', coach: 'claude-opus-5', grade: 'claude-opus-5-5',
      // conversation practice (round 4): the partner's turns (streamed, cached, effort low) and the end feedback
      converse: 'claude-sonnet-5-5', converseFeedback: 'claude-opus-5-5' },
    version: '2023-06-01',                              // date-gate: api-version (the anthropic-version header)
    fallbackBeta: 'server-side-fallback-2026-07-01',    // date-gate: api-version (refusal fallback, fallbacks: 'default')
    /** US dollars per million tokens: input, output, 5-minute cache write, cache read. What a conversation costs is
       computed from the API's usage with these (domain/conversation.js costOf). From the API's price list on the day
       below; check it again when a model or price changes. */
    pricesAsOf: '2026-09-25',                           // date-gate: api-version (the price list these come from)
    prices: /** @type {Record<string, {in: number, out: number, cacheWrite: number, cacheRead: number}>} */ ({
      'claude-sonnet-5-5': { in: 2, out: 10, cacheWrite: 2.5, cacheRead: 0.2 },
      'claude-opus-5-5': { in: 4, out: 20, cacheWrite: 5, cacheRead: 0.2 },
      'claude-haiku-4-5': { in: 1, out: 5, cacheWrite: 1.25, cacheRead: 0.1 },
    }),
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
