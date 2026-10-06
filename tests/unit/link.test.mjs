// The device link in a URL (core/link.js): b1-token.py opens Fluentish with the token in the fragment. The token is
// taken out of the address at once and never stays there. All tokens here are synthetic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { splitLinkHash, takeLinkToken } from '../../src/core/link.js';

const TOK = 'synthetic_link_token_0123456789abcdef';

test('both link forms give the token and an address without it', () => {
  assert.deepEqual(splitLinkHash(`#token=${TOK}`), { token: TOK, hash: '#/profile' });
  assert.deepEqual(splitLinkHash(`#/profile?token=${TOK}`), { token: TOK, hash: '#/profile' });
  assert.deepEqual(splitLinkHash(`#/profile?a=1&token=${TOK}&b=2`), { token: TOK, hash: '#/profile?a=1&b=2' });
  assert.deepEqual(splitLinkHash(`#/today?token=${TOK}`), { token: TOK, hash: '#/today' });
  assert.equal(splitLinkHash('#/profile'), null);
  assert.equal(splitLinkHash('#/lookup?q=tokenize'), null);
  assert.equal(splitLinkHash(''), null);
});

/** A location and history pair that records what replaceState did. */
function fakeNav(hash) {
  const loc = { pathname: '/fluentish/', search: '', hash };
  const calls = [];
  const hist = { state: { k: 1 }, replaceState(state, _u, url) { calls.push({ state, url }); const i = url.indexOf('#'); loc.hash = i < 0 ? '' : url.slice(i); } };
  return { loc, hist, calls };
}

test('takeLinkToken: the address is rewritten in place (no new history entry) and the token returned', () => {
  const n = fakeNav(`#token=${TOK}`);
  assert.equal(takeLinkToken(n.loc, n.hist), TOK);
  assert.deepEqual(n.calls, [{ state: { k: 1 }, url: '/fluentish/#/profile' }]);
  assert.ok(!n.loc.hash.includes(TOK));
  assert.equal(takeLinkToken(n.loc, n.hist), null, 'one link links once: nothing is left to take');
});

test('takeLinkToken: a token that does not look like one is scrubbed too, and reported as empty', () => {
  for (const bad of ['#token=', '#token=short', '#/profile?token=has%20space%20in%20it%20and%20more']) {
    const n = fakeNav(bad);
    assert.equal(takeLinkToken(n.loc, n.hist), '', bad);
    assert.equal(n.calls.length, 1);
    assert.ok(!n.loc.hash.includes('token'), bad);
  }
  const none = fakeNav('#/today');
  assert.equal(takeLinkToken(none.loc, none.hist), null);
  assert.equal(none.calls.length, 0, 'an ordinary address is left alone');
});

test('main.js takes the token before anything else runs (the error log, the router, storage)', () => {
  const src = readFileSync(new URL('../../src/main.js', import.meta.url), 'utf8');
  const body = src.replace(/^import[^;]+;\s*$/gm, '').replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').trim();
  assert.match(body, /^const link = takeLink\(\);/, 'the first statement');
  assert.ok(!/log\([^)]*link\b/.test(src), 'never logged');
});
