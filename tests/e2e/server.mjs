#!/usr/bin/env node
// The e2e server: the STAMPED build (_site/, from `node tools/stamp.mjs --out _site`) served the way Pages serves it,
// under /fluentish/, with Pages' 404 page for unknown paths. Never the repo root: the tests run what the deploy ships.
//   node tests/e2e/server.mjs [port]      default 8471
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ROOT = path.join(REPO, '_site');
const BASE = '/fluentish/';
const PORT = Number(process.argv[2] ?? 8471);   // 0: any free port (the offline spec starts its own server)
/** @type {Record<string, string>} */
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

const server = createServer(async (req, res) => {
  const p = decodeURIComponent(new URL(req.url || '/', 'http://x').pathname);
  if (p === '/' || p === '/fluentish') { res.writeHead(302, { Location: BASE }).end(); return; }
  try {
    if (!p.startsWith(BASE)) throw new Error('outside the app');
    let rel = p.slice(BASE.length);
    if (rel === '' || rel.endsWith('/')) rel += 'index.html';
    // the record schemas are never published, but the tests serve them next to the site: on a local origin the app
    // then checks every record it writes against them (src/data/records.js), and a mismatch fails the test
    const from = rel.startsWith('schemas/records/') ? REPO : ROOT;
    const file = path.join(from, path.normalize(rel));
    if (!file.startsWith(from)) throw new Error('outside the site');
    const s = await stat(file);
    if (!s.isFile()) throw new Error('not a file');
    // like Pages: short caching for the shell, the update check and the worker; the tests reload offline with the SW
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(await readFile(file));
  } catch {
    try { res.writeHead(404, { 'Content-Type': TYPES['.html'] }).end(await readFile(path.join(ROOT, '404.html'))); }
    catch { res.writeHead(404).end('not found (run node tools/stamp.mjs --out _site first)'); }
  }
});
server.listen(PORT, '127.0.0.1', () => console.log(`fluentish e2e: http://127.0.0.1:${/** @type {any} */ (server.address()).port}${BASE} ← _site/`));
