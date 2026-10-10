#!/usr/bin/env node
// The deploy build: writes the publishable site to _site/. Deterministic and dependency-free (review S1, A11).
//
//   node tools/stamp.mjs [--out _site] [--sha <commit>] [--keep <sha,sha>] [--live <url of the live version.json>] [--sw on|off]
//
// The service worker switch comes from --sw, else the FLUENTISH_SW environment variable, else "on". deploy.yml sets
// FLUENTISH_SW from its "sw" input or the repository variable FLUENTISH_SW, so the kill switch is a workflow run or a
// variable, never a code change:
//   on    the normal worker; a new version waits and takes over from Today
//   now   the normal worker, but it takes over as soon as it is installed (a fix for a deploy that broke the page;
//         use it as the input of one run, never as the variable)
//   off   version.json says "sw": "off" (the page unregisters the worker) and sw.js is killSw(), a worker that takes
//         over at once, deletes this app's caches and unregisters itself, which works even when the page can't run
//
// Layout (the app root is /fluentish/ on Pages):
//   index.html             loads v/<sha>/src/main.js, with modulepreload for the static import graph, and names the
//                          content manifest's hash (meta fluentish-manifest); the worker serves its own copy at once
//   404.html               deep paths → #/<path>
//   sw.js                  stamped with the version and the precache list
//   version.json           { sha, content, kept, sw } — the update check and the kill switch ("sw": "off")
//   assets/  content/      unversioned; content files are fetched as path?h=<sha256[:8]> from the manifest, and the
//                          manifest itself as manifest.json?h=<sha256[:8]> (the hash index.html names)
//   v/<sha>/src, v/<sha>/styles   this commit's code, immutable
//   v/<old>/src, v/<old>/styles   the two previously deployed versions, so a cached old index.html still finds its
//                                 modules within Pages' 10-minute cache window
// Only these are published; tools/, tests/, authoring/, docs/, schemas/ never are.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as buildManifest } from './build-manifest.mjs';
import { config } from '../src/core/config.js';
import { connectHost } from '../src/data/account/config.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = '/fluentish/';
const git = (/** @type {string[]} */ ...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 }).trim();

/**
 * Content precached on install (C3a): the shared files plus the active course's language pack (manifest packs[lang]),
 * never another language's. sw.js holds the shared list in PRECACHE and each pack's list in PACKS, and installs the
 * packs its registration URL names (sw.js?packs=fr; none named is German, the language of every registration made
 * before courses). A lazy file (the word families, one per root) is in its pack but not precached. Everything else in
 * content/ is cached the first time it is used.
 * @param {{packs: Record<string, string[]>, files: {id: string, path: string, sha256: string, lazy?: boolean}[]}} manifest
 * @returns {{shared: string[], packs: Record<string, string[]>}} content URLs (path?h=<sha8>)
 */
export function contentPrecache(manifest) {
  const url = new Map(manifest.files.map(f => [f.id, `content/${f.path}?h=${f.sha256.slice(0, 8)}`]));
  const lazy = new Set(manifest.files.filter(f => f.lazy).map(f => f.id));
  const list = (/** @type {string[]} */ ids) => ids.filter(id => !lazy.has(id)).map(id => /** @type {string} */ (url.get(id)));
  const { shared = [], ...langs } = manifest.packs;
  return { shared: list(shared), packs: Object.fromEntries(Object.entries(langs).map(([k, ids]) => [k, list(ids)])) };
}
/** What goes under v/<sha>/: code and styles, without notes and type declarations. */
const CODE_DIRS = ['src', 'styles'];
const skipCode = (/** @type {string} */ p) => /\.(md|d\.ts)$/.test(p);

/** Files under a directory, as paths relative to it with forward slashes. @param {string} dir */
export function walk(dir) {
  /** @type {string[]} */ const out = [];
  const go = (/** @type {string} */ d) => { for (const n of readdirSync(d).sort()) { const p = path.join(d, n); statSync(p).isDirectory() ? go(p) : out.push(path.relative(dir, p).split(path.sep).join('/')); } };
  go(dir);
  return out;
}

/** Static import graph of an ES module (relative specifiers only; dynamic import() is left to load on demand). */
export function importGraph(/** @type {string} */ entry, /** @type {(p: string) => string} */ read) {
  const seen = new Set(), queue = [entry];
  const re = /(?:^|[;\s])(?:import|export)\s+(?:[\w*{}\s,$]+?\s+from\s+)?['"](\.{1,2}\/[^'"]+)['"]/g;
  while (queue.length) {
    const f = /** @type {string} */ (queue.shift());
    if (seen.has(f)) continue;
    seen.add(f);
    const src = read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const m of src.matchAll(re)) queue.push(path.posix.normalize(path.posix.join(path.posix.dirname(f), m[1])));
  }
  return [...seen];
}

/** index.html with every src/ and styles/ reference moved under v/<sha>/, and modulepreload for the boot graph. */
export function stampIndex(/** @type {string} */ html, /** @type {string} */ sha, /** @type {string[]} */ graph) {
  const v = `v/${sha}/`;
  let out = html.replace(/<link rel="modulepreload"[^>]*>\n?/g, '');
  out = out.replace(/(\s(?:src|href)=")((?:src|styles)\/)/g, `$1${v}$2`);
  const preload = graph.map(f => `<link rel="modulepreload" href="${v}${f}">`).join('\n');
  out = out.replace(/(<script type="module" src="[^"]+"><\/script>)/, `${preload}\n$1`);
  const left = /\s(?:src|href)="(?:src|styles)\//.exec(out);
  if (left) throw new Error(`index.html: unversioned reference left at ${left.index}`);
  return out;
}

/**
 * index.html with the accounts project added to connect-src, only when config.accounts could turn accounts on
 * (data/account/config.js connectHost; docs/ACCOUNTS.md). Off, the page is returned unchanged. No wss: (no Realtime)
 * and no script, frame or image host: the client is plain fetch.
 * @param {string} html @param {any} accounts config.accounts
 */
export function withConnectSrc(html, accounts) {
  const host = connectHost(accounts);
  if (!host) return html;
  const re = /(<meta http-equiv="Content-Security-Policy" content="[^"]*?\bconnect-src [^;"]*)/;
  if (!re.test(html)) throw new Error('index.html: connect-src not found in the CSP');
  return html.replace(re, `$1 ${host}`);
}

/** sw.js with its VERSION, PRECACHE and PACKS lines filled in. */
export function stampSw(/** @type {string} */ js, /** @type {string} */ sha, /** @type {string[]} */ precache, /** @type {Record<string, string[]>} */ packs = {}) {
  const lines = /** @type {const} */ ([['VERSION', `'${sha.slice(0, 12)}'`, 'version'], ['PRECACHE', JSON.stringify(precache), 'precache'], ['PACKS', JSON.stringify(packs), 'packs']]);
  let out = js;
  for (const [name, value, mark] of lines) {
    const re = new RegExp(`^const ${name} = .*// stamp:${mark}$`, 'm');
    if (!re.test(out)) throw new Error(`sw.js: stamp marker ${mark} not found`);
    out = out.replace(re, () => `const ${name} = ${value}; // stamp:${mark}`);
  }
  return out;
}

/** Up to two earlier deployable versions to keep beside this one: the live site's, then its kept ones, then git parents. */
export function pickKept(/** @type {string} */ sha, /** @type {string[]} */ candidates, /** @type {(s: string) => boolean} */ deployable) {
  /** @type {string[]} */ const out = [];
  for (const c of candidates) {
    if (out.length === 2) break;
    if (!c || c === sha || out.includes(c) || !deployable(c)) continue;
    out.push(c);
  }
  return out;
}

async function liveVersion(/** @type {string | undefined} */ url) {
  if (!url) return null;
  try {
    const r = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

/**
 * The "sw" value of version.json: --sw, else FLUENTISH_SW, else 'on'. Anything but on/now/off is an error, so a typo can
 * never switch the worker off (or fail to).
 * @param {string | undefined} flag @param {string | undefined} env @returns {'on' | 'off' | 'now'}
 */
export function swSetting(flag, env) {
  const v = String(flag || env || 'on').trim().toLowerCase();
  if (v !== 'on' && v !== 'off' && v !== 'now') throw new Error(`sw must be "on", "now" or "off", not "${flag || env}"`);
  return v;
}

/** sw.js with its TAKEOVER line filled in: 'now' (sw=now) takes over once installed, else 'today'. */
export function stampTakeover(/** @type {string} */ js, /** @type {'on' | 'now' | 'off'} */ sw) {
  const re = /^const TAKEOVER = .*\/\/ stamp:takeover$/m;
  if (!re.test(js)) throw new Error('sw.js: stamp marker takeover not found');
  return js.replace(re, `const TAKEOVER = '${sw === 'now' ? 'now' : 'today'}'; // stamp:takeover`);
}

/**
 * The sw.js a deploy with sw=off publishes, instead of the real worker. The browser checks sw.js on every launch (and
 * the page asks again when it becomes visible), so this reaches a device even when the page itself is broken. It takes
 * over at once, deletes this app's caches (fluentish-*, never another app's) and unregisters itself; it has no fetch
 * handler, so until the next launch every request goes to the network, and after it there is no worker at all. The page
 * reads "sw": "off" in version.json and does not register again until a deploy turns the switch back on.
 */
export function killSw() {
  return `/* Fluentish service worker, switched off by a deploy with sw=off (tools/stamp.mjs killSw; docs/ARCHITECTURE.md §7). */
self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('fluentish-')) await caches.delete(k);
    await self.registration.unregister();
  })());
});
`;
}

/** index.html naming the content manifest's hash, which the page fetches as content/manifest.json?h=<hash>. */
export function withManifestHash(/** @type {string} */ html, /** @type {string} */ hash) {
  if (!/^[0-9a-f]{8}$/.test(hash)) throw new Error(`manifest hash ${hash}: not 8 hex digits`);
  const re = /(<meta charset="utf-8">\n)/;
  if (!re.test(html)) throw new Error('index.html: <meta charset="utf-8"> not found');
  return html.replace(re, `$1<meta name="fluentish-manifest" content="${hash}">\n`);
}

function opts() {
  const a = process.argv.slice(2), get = (/** @type {string} */ k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
  return { out: path.resolve(ROOT, get('--out') || '_site'), sha: get('--sha'), keep: (get('--keep') || '').split(',').filter(Boolean), live: get('--live'),
    sw: swSetting(get('--sw'), process.env.FLUENTISH_SW) };
}

async function main() {
  const o = opts();
  const sha = git('rev-parse', o.sha || 'HEAD');
  if (git('rev-parse', 'HEAD') !== sha) throw new Error(`the working tree is at ${git('rev-parse', 'HEAD')}, not ${sha}: check out ${sha} first`);
  if (git('status', '--porcelain', '--untracked-files=no', '--', ...CODE_DIRS, 'index.html', '404.html', 'sw.js', 'content', 'assets')) {
    console.warn('stamp: warning: uncommitted changes are built under the commit sha');
  }
  const manifest = buildManifest();
  const onDisk = JSON.parse(readFileSync(path.join(ROOT, 'content/manifest.json'), 'utf8'));
  if (onDisk.version !== manifest.version) throw new Error('content/manifest.json is out of date: run node tools/build-manifest.mjs');

  rmSync(o.out, { recursive: true, force: true });
  mkdirSync(o.out, { recursive: true });
  const v = `v/${sha}`;
  for (const d of CODE_DIRS) {
    for (const f of walk(path.join(ROOT, d))) if (!skipCode(f)) cpSync(path.join(ROOT, d, f), path.join(o.out, v, d, f));
  }
  cpSync(path.join(ROOT, 'assets'), path.join(o.out, 'assets'), { recursive: true });
  for (const f of walk(path.join(ROOT, 'content'))) if (f.endsWith('.json')) cpSync(path.join(ROOT, 'content', f), path.join(o.out, 'content', f));

  const graph = importGraph('src/main.js', p => readFileSync(path.join(ROOT, p), 'utf8'));
  writeFileSync(path.join(o.out, 'index.html'), withConnectSrc(stampIndex(readFileSync(path.join(ROOT, 'index.html'), 'utf8'), sha, graph), config.accounts));
  const nf = readFileSync(path.join(ROOT, '404.html'), 'utf8').replace(`${BASE}src/`, `${BASE}${v}/src/`);
  if (!nf.includes(`${BASE}${v}/src/redirect-404.js`)) throw new Error('404.html: redirect script reference not found');
  writeFileSync(path.join(o.out, '404.html'), nf);

  const content = contentPrecache(manifest);
  // the manifest by hash: index.html names it, the page fetches manifest.json?h=, the worker keeps it cache first
  const manifestHash = createHash('sha256').update(readFileSync(path.join(o.out, 'content/manifest.json'))).digest('hex').slice(0, 8);
  const shell = path.join(o.out, 'index.html');
  writeFileSync(shell, withManifestHash(readFileSync(shell, 'utf8'), manifestHash));
  const precache = [
    './',
    // code, styles and the vendored map font (the map's layout was built with its widths, so it must be there offline),
    // with its metrics and the 3D view's text atlas
    ...walk(path.join(o.out, v)).filter(f => /\.(js|css|woff2)$/.test(f) || /^src\/vendor\/(newsreader-map|palace-sdf)\/[^/]+\.(json|png)$/.test(f)).map(f => `${v}/${f}`),
    ...walk(path.join(o.out, 'assets')).map(f => `assets/${f}`),
    `content/manifest.json?h=${manifestHash}`,
    ...content.shared,
  ];
  writeFileSync(path.join(o.out, 'sw.js'), o.sw === 'off' ? killSw()
    : stampTakeover(stampSw(readFileSync(path.join(ROOT, 'sw.js'), 'utf8'), sha, precache, content.packs), o.sw));

  // earlier versions, so an index.html still in a browser or CDN cache finds its own modules
  const live = await liveVersion(o.live);
  const parents = git('rev-list', '--max-count=3', sha).split('\n').slice(1);
  const deployable = (/** @type {string} */ c) => {
    try { execFileSync('git', ['cat-file', '-e', `${c}:tools/stamp.mjs`], { cwd: ROOT, stdio: 'ignore' }); return true; } catch { return false; }
  };
  const kept = pickKept(sha, [...o.keep, live?.sha, ...(live?.kept || []), ...parents], deployable);
  for (const k of kept) {
    mkdirSync(path.join(o.out, 'v', k), { recursive: true });
    execFileSync('sh', ['-c', `git archive ${k} ${CODE_DIRS.join(' ')} | tar -x -C "${path.join(o.out, 'v', k)}"`], { cwd: ROOT });
  }

  const version = {
    app: 'fluentish', sha, committed: git('show', '-s', '--format=%cI', sha), content: manifest.version, kept, sw: o.sw,
  };
  writeFileSync(path.join(o.out, 'version.json'), JSON.stringify(version, null, 1) + '\n');

  for (const banned of ['tools', 'tests', 'authoring', 'docs', 'schemas', 'node_modules', '.github', 'src', 'styles']) {
    if (existsSync(path.join(o.out, banned))) throw new Error(`${banned}/ must not be published`);
  }
  const bytes = (/** @type {string[]} */ fs) => fs.reduce((n, f) => n + statSync(path.join(o.out, f.split('?')[0] === './' ? 'index.html' : f.split('?')[0])).size, 0);
  const all = walk(o.out);
  console.log(`stamp: ${path.relative(ROOT, o.out) || o.out} ← ${sha.slice(0, 12)}: ${all.length} files, ${(bytes(all) / 1048576).toFixed(1)} MB; `
    + `precache ${precache.length} files, ${(bytes(precache) / 1048576).toFixed(1)} MB + de ${content.packs.de?.length ?? 0} files, ${(bytes(content.packs.de || []) / 1048576).toFixed(1)} MB; modulepreload ${graph.length}; kept ${kept.map(k => k.slice(0, 7)).join(', ') || 'none'}; sw ${o.sw}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error(`stamp: ${e.message}`); process.exit(1); });
}
