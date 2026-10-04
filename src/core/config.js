/* Every URL, endpoint and fixed limit the app uses, in one place (review S16: no '../' cross-repo URLs in src).
   Values that come with the content (exam module limits, media base) live in content/manifest.json instead. */

const here = new URL('.', import.meta.url);

export const config = {
  name: 'Fluentish',
  /** Base of the public content pack; every file is found through manifest.json. */
  contentBase: new URL('../../content/', here).href,
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
