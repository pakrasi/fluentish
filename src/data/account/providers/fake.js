/* The fake provider: an in-memory "server" for development and the e2e suite, never the network. config.js picks it
   only on localhost with ?accounts=fake. The code is always FAKE_CODE; tokens are plain strings that look nothing like
   real ones. A session kept from an earlier page load refreshes, since any fake refresh token is accepted. */
import { fnv1a } from '../../ids.js';

/** @typedef {import('../types.js').Provider} Provider @typedef {import('../types.js').Tokens} Tokens */

/** The one code the fake server accepts. */
export const FAKE_CODE = '123456';
const HOUR = 3600e3;

/** @param {{now?: () => number}} [o] @returns {Provider} */
export function fakeProvider({ now = Date.now } = {}) {
  /** @type {Set<string>} */ const asked = new Set();
  let n = 0;
  /** @param {string} email @returns {Tokens} */
  const issue = email => {
    n++;
    return { accessToken: `fake-access-${n}`, refreshToken: `fake-refresh-${n}`, expiresAt: now() + HOUR, userId: `fake-user-${fnv1a(email)}`, email };
  };
  return Object.freeze({
    id: /** @type {const} */ ('fake'),
    network: false,
    async requestCode({ email }) { asked.add(email); return { ok: /** @type {const} */ (true) }; },
    async verifyCode({ email, code }) {
      if (!asked.has(email) || code !== FAKE_CODE) return { error: /** @type {const} */ ('badCode') };
      asked.delete(email);
      return { tokens: issue(email) };
    },
    async refresh(refreshToken) {
      if (!refreshToken.startsWith('fake-refresh-')) return { error: /** @type {const} */ ('signedOut') };
      return { tokens: { ...issue(''), email: null, userId: '' } };
    },
    async logout() {},
    async fetchAuthed(_path, _init, accessToken) {
      const ok = accessToken.startsWith('fake-access-');
      return new Response(ok ? '[]' : '{"message":"JWT expired"}', { status: ok ? 200 : 401, headers: { 'content-type': 'application/json' } });
    },
  });
}
