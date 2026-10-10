/* LocalOnly: the default provider (docs/ACCOUNTS.md). Accounts are off; every call answers 'off' at once. It holds
   no reference to the network on purpose: tests/unit/account.test.mjs checks this file's source and runs every call
   with a fetch that fails the test. */

/** @typedef {import('../types.js').Provider} Provider */

/** @returns {Provider} */
export function localProvider() {
  const off = async () => /** @type {{error: 'off'}} */ ({ error: 'off' });
  return Object.freeze({
    id: /** @type {const} */ ('local'),
    network: false,
    requestCode: off,
    verifyCode: off,
    refresh: off,
    logout: async () => {},
    fetchAuthed: async () => { throw Object.assign(new Error('accounts are off'), { code: 'off' }); },
  });
}
