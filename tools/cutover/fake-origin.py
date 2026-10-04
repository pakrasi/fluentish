"""Cutover test server, a stand-in for pakrasi.github.io: /language-doors/, /b1-exam/ and /fluentish/ under one origin, old or new per site.
GET /__set?ld=old|new&b1=old|new switches; GET /__state shows it. Any path ending in __sw-test.js is a no-op SW."""
import json, os, sys, posixpath
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs, unquote
W = os.environ['CUTOVER_WORK']   # run.sh fills it: ld-old/, ld-new/, b1-old/docs, b1-new/docs, fluentish/
ROOTS = {'ld': {'old': os.path.join(W, 'ld-old'), 'new': os.path.join(W, 'ld-new')},
         'b1': {'old': os.path.join(W, 'b1-old', 'docs'), 'new': os.path.join(W, 'b1-new', 'docs')}}
state = {'ld': 'old', 'b1': 'old'}
SW = b"self.addEventListener('install',e=>self.skipWaiting());self.addEventListener('activate',e=>e.waitUntil(clients.claim()));self.addEventListener('fetch',()=>{});"
class H(SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache'); super().end_headers()
    def do_GET(self):
        u = urlparse(self.path)
        if u.path == '/__set':
            for k, v in parse_qs(u.query).items(): state[k] = v[0]
        if u.path in ('/__set', '/__state'):
            b = json.dumps(state).encode(); self.send_response(200); self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b); return
        if u.path.endswith('__sw-test.js'):
            self.send_response(200); self.send_header('Content-Type', 'text/javascript'); self.send_header('Content-Length', str(len(SW))); self.end_headers(); self.wfile.write(SW); return
        return super().do_GET()
    def translate_path(self, path):
        p = unquote(urlparse(path).path)
        for prefix, key in (('/language-doors', 'ld'), ('/b1-exam', 'b1')):
            if p == prefix or p.startswith(prefix + '/'):
                root, rest = ROOTS[key][state[key]], p[len(prefix):]
                break
        else:
            if p.startswith('/fluentish'): root, rest = W, p
            else: root, rest = os.path.join(W, '_none'), p
        out = root
        for part in posixpath.normpath(rest).split('/'):
            if part and part not in ('.', '..'): out = os.path.join(out, part)
        return out
class S(ThreadingHTTPServer):
    request_queue_size = 128
    daemon_threads = True
S(('127.0.0.1', int(sys.argv[1])), H).serve_forever()
