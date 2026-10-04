// Shared by the sync tests: a mock of the GitHub Contents API, and a throwaway copy of the B1 exam app's real
// scripts/sync.py (HOME pointed into a temp directory, so the real database, voice folder and repository are never
// touched). All data in the tests is synthetic.
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const B1 = path.join(os.homedir(), 'pakrasi-lab/b1-exam');
export const haveSyncPy = existsSync(path.join(B1, 'scripts/sync.py')) && existsSync(path.join(B1, 'server.py'));

/** A mock GitHub: a Map path → base64 content; behaviour switches for failures. */
export function mockGithubFor(REPO) {
  const files = new Map();
  const calls = [];
  const gh = { files, calls, mode: 'ok', reads: {} };
  gh.fetch = async (url, init = {}) => {
    const p = decodeURIComponent(new URL(url).pathname.replace(`/repos/${REPO}/contents/`, ''));
    calls.push({ method: init.method || 'GET', path: p, headers: init.headers });
    if (gh.mode === 'offline') throw new TypeError('Failed to fetch');
    if (gh.mode === 'auth') return new Response(JSON.stringify({ message: 'Bad credentials' }), { status: 401 });
    if ((init.method || 'GET') === 'PUT') {
      if (files.has(p)) return new Response(JSON.stringify({ message: 'Invalid request.\n\n"sha" wasn\'t supplied.' }), { status: 422 });
      files.set(p, JSON.parse(init.body).content);
      return new Response('{}', { status: 201 });
    }
    if (p === 'data') {
      const listing = Object.entries(gh.reads).map(([k, v]) => ({ type: 'file', name: k.replace('data/', ''), sha: `sha-${JSON.stringify(v).length}` }));
      const tag = `"${Buffer.from(JSON.stringify(listing)).toString("base64").slice(-24)}"`;
      if (init.headers?.['If-None-Match'] === tag) return new Response(null, { status: 304 });
      return new Response(JSON.stringify(listing), { status: 200, headers: { etag: tag } });
    }
    const doc = gh.reads[p];
    if (doc === undefined) return new Response('{"message":"Not Found"}', { status: 404 });
    return new Response(JSON.stringify(doc), { status: 200 });
  };
  gh.text = p => Buffer.from(files.get(p), 'base64').toString('utf8');
  gh.json = p => JSON.parse(gh.text(p));
  return gh;
}


/**
 * A temp copy of the repo layout sync.py expects, with the files a mock GitHub holds written into it.
 * run() runs sync.py --no-push; q(sql) reads its database; done() removes everything.
 */
export function syncPyWorkspace() {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'fluentish-syncpy-'));
  mkdirSync(path.join(tmp, 'scripts'), { recursive: true });
  copyFileSync(path.join(B1, 'scripts/sync.py'), path.join(tmp, 'scripts/sync.py'));
  copyFileSync(path.join(B1, 'server.py'), path.join(tmp, 'server.py'));
  mkdirSync(path.join(tmp, 'docs/exams'), { recursive: true });
  mkdirSync(path.join(tmp, 'docs/data'), { recursive: true });
  for (const f of readdirSync(path.join(ROOT, 'content/exams/goethe-b1')).filter(f => /^day\d\d\.json$/.test(f))) copyFileSync(path.join(ROOT, 'content/exams/goethe-b1', f), path.join(tmp, 'docs/exams', f));
  const home = path.join(tmp, 'home');
  mkdirSync(home);
  const appDir = path.join(home, 'Library', 'Application Support', 'fritz');   // sync.py's APP under the temp HOME
  const db = path.join(appDir, 'b1-exam.db');
  return {
    tmp, home, appDir, db,
    /** @param {Map<string, string>} files path → base64 */
    write(files) { for (const [p, b64] of files) { mkdirSync(path.dirname(path.join(tmp, p)), { recursive: true }); writeFileSync(path.join(tmp, p), Buffer.from(b64, 'base64')); } },
    run: () => execFileSync('python3', [path.join(tmp, 'scripts/sync.py'), '--no-push'], { env: { ...process.env, HOME: home }, encoding: 'utf8' }),
    q: (/** @type {string} */ sql) => JSON.parse(execFileSync('python3', ['-c', 'import sqlite3,json,sys; c=sqlite3.connect(sys.argv[1]); c.row_factory=sqlite3.Row; print(json.dumps([dict(r) for r in c.execute(sys.argv[2])]))', db, sql], { encoding: 'utf8' })),
    done: () => rmSync(tmp, { recursive: true, force: true }),
  };
}
