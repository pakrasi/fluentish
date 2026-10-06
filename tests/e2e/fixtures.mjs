// Shared by every e2e spec (tests/e2e/*.spec.mjs). All data here is synthetic.
//
// What every test gets, automatically:
//   - the network sealed: a catch-all route on the browser context answers every request. The app's own origin
//     (127.0.0.1) goes through; GitHub, Anthropic, Google Fonts and the media host (pakrasi.github.io) are answered by
//     the mocks below and never reach the internet; ANY other host is aborted and fails the test (externalGuard).
//     Service workers are blocked in the config (serviceWorkers: 'block'), so nothing can fetch around these routes;
//     the one offline spec that turns the worker on checks it serves only this origin.
//   - a mock GitHub Contents API for the results repository, held in memory per test (gh.files), that only answers the
//     fake token below. A request with any other token is a 401 and fails the test: no token, real or fake, can reach
//     api.github.com.
//   - console errors and uncaught page errors collected and asserted empty after the test.
//   - axe on demand (checkA11y), serious and critical findings fail.
//   - a Trusted Types tripwire: the shell's CSP gains require-trusted-types-for 'script', so an HTML string written into
//     the DOM anywhere fails the test (the unit lint bans innerHTML in src/; this also covers vendored code at runtime).
import { test as base, expect } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../_site');
/** The stamped commit: code lives under /fluentish/v/<sha>/. */
export const SHA = JSON.parse(readFileSync(path.join(SITE, 'version.json'), 'utf8')).sha;
export const APP = '/fluentish/';
export const REPO = 'pakrasi/b1-exam';
/** The only token the GitHub mock accepts. Obviously fake; never valid anywhere. */
export const FAKE_TOKEN = 'e2e-fake-token-answered-only-by-the-mock';

const LOCAL = new Set(['127.0.0.1', 'localhost']);
/** Hosts the app may talk to, each answered by a mock here. */
const MOCKED = new Set(['api.github.com', 'api.anthropic.com', 'pakrasi.github.io', 'fonts.googleapis.com', 'fonts.gstatic.com']);

/** A short silent WAV: every audio file the app asks for (exam audio, word audio, situation lines). */
const SILENT = (() => {
  const n = 800, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24); b.writeUInt32LE(16000, 28); b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  return b;
})();
const AUDIO = /\.(mp3|m4a|aac|wav|ogg|opus|webm)(\?|$)/i;

/**
 * @typedef {{status: number, contentType?: string, headers?: Record<string, string>, body?: string | Buffer}} Answer
 * @typedef {{files: Map<string, string>, calls: {method: string, path: string}[], badTokens: number, notFound: number,
 *   answer: (req: import('@playwright/test').Request) => Answer}} GithubMock
 * @typedef {{replies: any[], calls: any[]}} ClaudeMock
 * @typedef {{gh: GithubMock, claude: ClaudeMock, externalGuard: string[], consoleErrors: string[]}} E2EFixtures
 */

/** The GitHub mock: the Contents API over an in-memory repository, like tests/unit/sync-harness.mjs. @returns {GithubMock} */
function githubMock() {
  /** @type {Map<string, string>} path → base64 */ const files = new Map();
  /** @type {{method: string, path: string}[]} */ const calls = [];
  /** @type {GithubMock} */ const gh = { files, calls, badTokens: 0, notFound: 0, answer: () => ({ status: 500 }) };
  const shaOf = (/** @type {string} */ b64) => createHash('sha1').update(b64).digest('hex');
  const json = (/** @type {any} */ body, status = 200, /** @type {Record<string, string>} */ headers = {}) => { if (status === 404) gh.notFound++; return { status, contentType: 'application/json', headers, body: JSON.stringify(body) }; };
  /** @param {import('@playwright/test').Request} req */
  gh.answer = req => {
    const u = new URL(req.url());
    const method = req.method();
    if (method === 'OPTIONS') return { status: 204, headers: cors(req) };
    const auth = req.headers()['authorization'] || '';
    if (auth !== `Bearer ${FAKE_TOKEN}` && auth !== `token ${FAKE_TOKEN}`) { gh.badTokens++; return json({ message: 'Bad credentials (e2e mock: only the fake token is answered)' }, 401); }
    if (u.pathname === `/repos/${REPO}`) return json({ full_name: REPO, private: true, permissions: { push: true } }, 200, { 'github-authentication-token-expiration': '2099-01-01 00:00:00 UTC' });
    const prefix = `/repos/${REPO}/contents/`;
    if (!u.pathname.startsWith(prefix)) return json({ message: 'Not Found' }, 404);
    const p = decodeURIComponent(u.pathname.slice(prefix.length));
    calls.push({ method, path: p });
    if (method === 'PUT') {
      const body = JSON.parse(req.postData() || '{}');
      if (files.has(p)) {
        if (!body.sha) return json({ message: 'Invalid request.\n\n"sha" wasn\'t supplied.' }, 422);
        if (body.sha !== shaOf(/** @type {string} */ (files.get(p)))) return json({ message: `${p} does not match ${body.sha}` }, 409);
      } else if (body.sha) return json({ message: 'Not Found' }, 404);
      const existed = files.has(p);
      files.set(p, body.content);
      return json({ content: { path: p, sha: shaOf(body.content) } }, existed ? 200 : 201);
    }
    if (files.has(p)) {
      const b64 = /** @type {string} */ (files.get(p));
      const raw = Buffer.from(b64, 'base64');
      if (/raw/.test(req.headers()['accept'] || '')) return { status: 200, body: raw, headers: { 'content-type': 'application/octet-stream' } };
      return json({ type: 'file', name: p.split('/').pop(), path: p, sha: shaOf(b64), size: raw.length, encoding: 'base64', content: b64.replace(/(.{60})/g, '$1\n') });
    }
    /** @type {Map<string, any>} */ const kids = new Map();
    for (const [k, v] of files) {
      if (!k.startsWith(p + '/')) continue;
      const rest = k.slice(p.length + 1), name = rest.split('/')[0];
      kids.set(name, rest.includes('/') ? { type: 'dir', name, path: `${p}/${name}`, sha: 'dir', size: 0 }
        : { type: 'file', name, path: k, sha: shaOf(v), size: Buffer.from(v, 'base64').length });
    }
    if (kids.size) return json([...kids.values()]);
    return json({ message: 'Not Found' }, 404);
  };
  return gh;
}

/** @param {import('@playwright/test').Request} req */
const cors = req => ({ 'access-control-allow-origin': req.headers()['origin'] || '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, PUT, POST, OPTIONS',
  'access-control-expose-headers': 'etag, github-authentication-token-expiration' });

/** Console lines that are not the app's: Playwright's own injected caret style hitting the CSP in WebKit. */
const NOT_OURS = [/Refused to apply a stylesheet because its hash, its nonce, or 'unsafe-inline'/,
  // the browser's own benign notice when a ResizeObserver callback changes layout (WebKit reports it as an error)
  /^ResizeObserver loop completed with undelivered notifications/];

/** @type {import('@playwright/test').Fixtures<E2EFixtures, {}, import('@playwright/test').PlaywrightTestArgs & import('@playwright/test').PlaywrightTestOptions, import('@playwright/test').PlaywrightWorkerArgs & import('@playwright/test').PlaywrightWorkerOptions>} */
const fixtures = {
  /** The GitHub mock of this test. */
  gh: async ({}, use) => { await use(githubMock()); },

  /** Anthropic answers: a spec may push canned replies; by default every call is a 503 the app handles. */
  claude: async ({}, use) => { await use({ replies: /** @type {any[]} */ ([]), calls: /** @type {any[]} */ ([]) }); },

  /** Requests to hosts that are neither this origin nor mocked. Must stay empty. */
  externalGuard: [async ({ context, gh, claude }, use) => {
    /** @type {string[]} */ const violations = [];
    // the tripwire's default policy: the one script URL the app sets (the service worker, same origin) passes; an HTML
    // string (other than clearing with '') or a script string is reported and refused
    await context.addInitScript(() => {
      const tt = /** @type {any} */ (globalThis).trustedTypes;
      if (!tt || tt.defaultPolicy) return;
      tt.createPolicy('default', {
        createHTML: (/** @type {string} */ v) => { if (v === '') return v; console.error(`Trusted Types tripwire: an HTML string reached the DOM: ${String(v).slice(0, 80)}`); return null; },
        createScript: (/** @type {string} */ v) => { console.error(`Trusted Types tripwire: a script string: ${String(v).slice(0, 80)}`); return null; },
        createScriptURL: (/** @type {string} */ v) => {
          if (new URL(v, location.href).origin === location.origin) return v;
          console.error(`Trusted Types tripwire: a script from another origin: ${v}`); return null;
        },
      });
    });
    await context.route('**/*', async route => {
      const req = route.request();
      const u = new URL(req.url());
      if (u.protocol === 'data:' || u.protocol === 'blob:') return route.continue();
      if (LOCAL.has(u.hostname)) {
        // the dev-only media folder the app tries first on localhost (sim-audio.js): a silent clip
        if (u.pathname.startsWith(`${APP}media/`)) return route.fulfill({ status: 200, contentType: 'audio/wav', body: SILENT });
        // the Trusted Types tripwire: the shell is served with require-trusted-types-for 'script' added to its CSP, so
        // any HTML string written into the DOM (innerHTML, insertAdjacentHTML, document.write …) by the app or a
        // vendored library throws and logs a CSP violation, which fails the test
        if (req.isNavigationRequest() && (u.pathname === APP || u.pathname === `${APP}index.html`)) {
          const res = await route.fetch().catch(() => null);
          if (!res) return route.continue();   // the server is gone (the offline spec): the service worker answers
          const html = (await res.text()).replace(/(http-equiv="Content-Security-Policy" content="[^"]*)"/, "$1; require-trusted-types-for 'script'\"");
          if (!html.includes("require-trusted-types-for 'script'")) throw new Error('index.html: CSP meta not found for the Trusted Types tripwire');
          return route.fulfill({ response: res, body: html });
        }
        return route.continue();
      }
      if (!MOCKED.has(u.hostname)) { violations.push(`${req.method()} ${u.origin}${u.pathname}`); return route.abort('blockedbyclient'); }
      const headers = cors(req);
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      if (u.hostname === 'api.github.com') { const r = gh.answer(req); return route.fulfill({ ...r, headers: { ...headers, ...(r.headers || {}) } }); }
      if (u.hostname === 'api.anthropic.com') {
        claude.calls.push(JSON.parse(req.postData() || '{}'));
        const next = claude.replies.shift();
        if (next) return route.fulfill({ status: 200, contentType: 'application/json', headers, body: JSON.stringify(next) });
        return route.fulfill({ status: 503, contentType: 'application/json', headers, body: JSON.stringify({ type: 'error', error: { type: 'overloaded_error', message: 'e2e mock' } }) });
      }
      if (u.hostname === 'fonts.googleapis.com') return route.fulfill({ status: 200, contentType: 'text/css', headers, body: '/* e2e: no web fonts */' });
      if (u.hostname === 'fonts.gstatic.com') return route.fulfill({ status: 204, headers });
      // pakrasi.github.io: the published exam and word audio, and the situation lines
      if (AUDIO.test(u.pathname)) return route.fulfill({ status: 200, contentType: 'audio/wav', headers, body: SILENT });
      if (u.pathname.endsWith('.json')) return route.fulfill({ status: 200, contentType: 'application/json', headers, body: '{}' });
      return route.fulfill({ status: 204, headers });
    });
    // belt and braces: a request seen anywhere in the context (a worker, a preload) that is not ours and not mocked
    context.on('request', req => {
      const u = new URL(req.url());
      if (/^(https?|wss?):$/.test(u.protocol) && !LOCAL.has(u.hostname) && !MOCKED.has(u.hostname)) violations.push(`${req.method()} ${u.origin}${u.pathname} (seen)`);
    });
    await use(violations);
    expect(violations, 'requests to a real external host').toEqual([]);
    expect(gh.badTokens, 'GitHub calls with a token other than the fake one').toBe(0);
  }, { auto: true }],

  /** Console errors and uncaught exceptions. Must stay empty unless a spec clears what it expects. */
  consoleErrors: [async ({ page, gh }, use) => {
    /** @type {string[]} */ const errors = [];
    page.on('console', m => { if (m.type() === 'error' && !NOT_OURS.some(re => re.test(m.text()))) errors.push(`console: ${m.text()}`); });
    // which file a "Failed to load resource" line was about
    page.on('response', r => { if (r.status() >= 400 && LOCAL.has(new URL(r.url()).hostname)) errors.push(`http ${r.status()}: ${new URL(r.url()).pathname}`); });
    page.on('pageerror', e => { if (!NOT_OURS.some(re => re.test(e.message))) errors.push(`pageerror: ${e.message}`); });
    await use(errors);
    // the browser logs every 404, and "no such file yet" is a normal answer of the Contents API (a backup's first
    // write of the day reads the file first): as many of those lines as the GitHub mock answered 404 are expected
    for (let n = gh.notFound; n > 0; n--) {
      const i = errors.findIndex(e => /^console: Failed to load resource: the server responded with a status of 404/.test(e));
      if (i < 0) break;
      errors.splice(i, 1);
    }
    expect(errors, 'console errors').toEqual([]);
  }, { auto: true }],
};

export const test = base.extend(fixtures);

export { expect };

/**
 * A synthetic learner: one local profile, onboarded, German B1 with a Goethe B1 goal `examInDays` away, written into
 * IndexedDB through the app's own data layer (the stamped modules), before the app boots.
 * @param {import('@playwright/test').Page} page
 * @param {{examInDays?: number | null, examType?: string, level?: string, minutes?: number, token?: boolean, motion?: 'reduce' | 'full' | 'system', cards?: Record<string, Record<string, any>>, kv?: Record<string, any>, origin?: string, veteran?: boolean}} [o]
 *   examType: the exam goal (a date-only one such as 'goethe-b2' has no mocks); origin: another e2e server than the
 *   config's (the offline spec); veteran: he started studying a month ago (past
 *   the first week, whose plan is level-fit with few decks: domain/budget.js mode 'start')
 */
export async function seed(page, { examInDays = 60, examType = 'goethe-b1', level = 'B1', minutes = 60, token = false, motion = 'reduce', cards = {}, kv = {}, origin = '', veteran = false } = {}) {
  await leaveQuietly(page);
  await page.goto(`${origin}${APP}version.json`);
  await page.evaluate(async ({ sha, examInDays, examType, level, minutes, token, fake, motion, cards, kv, veteran }) => {
    const v = `/fluentish/v/${sha}/src/`;
    const [{ createIdbAdapter }, { openSession }, { setSetting }, clockM] = await Promise.all([
      import(v + 'data/adapters/idb.js'), import(v + 'data/session.js'), import(v + 'data/settings.js'), import(v + 'core/clock.js')]);
    const adapter = await createIdbAdapter();
    const clock = clockM.createClock({ exam: () => null, now: () => new Date() });
    const s = await openSession({ adapter, legacyStorage: null, clock, kind: 'local' });
    const app = { store: s.store, hlc: s.hlc };
    setSetting(app, 'language', 'german');
    setSetting(app, 'level', level);
    setSetting(app, 'exam.type', examInDays == null ? null : examType);
    setSetting(app, 'exam.modules', ['lesen', 'hoeren', 'schreiben', 'sprechen']);
    setSetting(app, 'minutesPerDay', minutes);
    if (examInDays != null) setSetting(app, 'exam.date', clockM.add(clock.today(), examInDays));
    setSetting(app, 'onboarded', new Date().toISOString());
    // motion off by default: the tests wait for content, not for animations (one spec turns it on)
    s.store.set('prefs', { theme: 'light', motion, locale: 'en' });
    if (token) s.store.set('secrets', { anthropicKey: null, githubToken: fake });
    if (veteran) s.store.set('activity', { [clockM.add(clock.today(), -30)]: { minutes: 30, rounds: 2 } });
    for (const [name, value] of Object.entries(kv)) s.store.set(name, value);
    for (const [deck, recs] of Object.entries(cards)) s.store.putCards(deck, Object.entries(recs));
    await s.store.flush();
    s.store.close();
    adapter.close?.();
  }, { sha: SHA, examInDays, examType, level, minutes, token, fake: FAKE_TOKEN, motion, cards, kv, veteran });
}

/**
 * Before a full navigation away from the app: let the view that is mounting finish (a lazy view module still
 * importing when the page goes would log an aborted import, which is the test's doing, not the app's).
 * @param {import('@playwright/test').Page} page
 */
async function leaveQuietly(page) {
  if (!page.url().includes(APP) || page.url().endsWith('version.json')) return;
  await expect(page.locator('#view h1').first()).toBeVisible();
  await page.waitForLoadState('networkidle');
  await settle(page);
}

/** Open a route of the app and wait until the view has rendered its heading. @param {import('@playwright/test').Page} page @param {string} [hash] */
export async function open(page, hash = '#/today') {
  await leaveQuietly(page);
  await page.goto(`${APP}${hash}`);
  await expect(page.locator('html.booted')).toHaveCount(1);
  await expect(page.locator('#view h1').first()).toBeVisible();
}

/** Wait until running animations (view transitions, reveals) have finished, so axe never measures a half-faded frame. @param {import('@playwright/test').Page} page */
export async function settle(page) {
  // quiet for 300 ms in a row (views render in steps after their data loads, each step may start a short fade), at most 5 s
  await page.evaluate(() => new Promise(resolve => {
    const t0 = performance.now();
    let quietSince = performance.now();
    const tick = () => {
      const busy = document.getAnimations().some(a => a.playState === 'running' && a.effect?.getComputedTiming().iterations !== Infinity);
      const now = performance.now();
      if (busy) quietSince = now;
      if (now - quietSince >= 300 || now - t0 > 5000) resolve(null); else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }));
}

/**
 * axe on the current page; serious and critical findings fail the test (minor and moderate are reported only).
 * @param {import('@playwright/test').Page} page @param {string} where
 */
export async function checkA11y(page, where) {
  await settle(page);
  // preload off: axe would fetch the cross-origin font stylesheet itself, which the app's CSP (rightly) refuses
  const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).options({ preload: false }).analyze();
  const blocking = res.violations.filter(v => v.impact === 'serious' || v.impact === 'critical')
    .map(v => `${where}: ${v.id} (${v.impact}): ${v.help} — ${v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | ')}`);
  expect(blocking, `axe serious/critical on ${where}`).toEqual([]);
}

/**
 * The card records in IndexedDB (what survives a reload), read straight from the database.
 * @param {import('@playwright/test').Page} page @param {string} deck
 * @returns {Promise<Record<string, any>>} id → record
 */
export async function storedCards(page, deck) {
  return page.evaluate(deck => new Promise((resolve, reject) => {
    const r = indexedDB.open('fluentish');
    r.onerror = () => reject(r.error);
    r.onsuccess = () => {
      const db = r.result, out = /** @type {Record<string, any>} */ ({});
      const q = db.transaction('cards').objectStore('cards').openCursor();
      q.onsuccess = () => {
        const c = q.result;
        if (!c) { db.close(); resolve(out); return; }
        const k = /** @type {any[]} */ (c.key);
        if (k[1] === deck) out[k[2]] = c.value;
        c.continue();
      };
      q.onerror = () => reject(q.error);
    };
  }), deck);
}
