/* Types of the accounts layer (docs/ACCOUNTS.md). No code. */

/** @typedef {'off' | 'signedOut' | 'codeSent' | 'signedIn' | 'offline' | 'error'} AccountState */
/** What features see of a session: never a token. @typedef {{userId: string, email: string | null, expiresAt: number}} Session */
/**
 * Why a call did not work. 'off': accounts are off on this page (LocalOnly).
 * @typedef {'off' | 'offline' | 'badEmail' | 'noAccount' | 'badCode' | 'rateLimited' | 'signedOut' | 'failed'} AccountError
 */
/** @typedef {import('./session-store.js').Tokens} Tokens */

/**
 * A provider adapter: the server calls, nothing else. index.js owns the state, the session store and the refresh lock.
 * @typedef {{
 *   id: 'local' | 'fake' | 'supabase',
 *   network: boolean,
 *   requestCode: (o: {email: string}) => Promise<{ok: true} | {error: AccountError}>,
 *   verifyCode: (o: {email: string, code: string}) => Promise<{tokens: Tokens} | {error: AccountError}>,
 *   refresh: (refreshToken: string) => Promise<{tokens: Tokens} | {error: AccountError}>,
 *   logout: (accessToken: string, scope: 'local' | 'global') => Promise<void>,
 *   fetchAuthed: (path: string, init: RequestInit, accessToken: string) => Promise<Response>,
 * }} Provider
 */

/**
 * The account, as features and data modules use it (index.js openAccount).
 * @typedef {{
 *   available: () => boolean,
 *   provider: () => 'local' | 'fake' | 'supabase',
 *   reason: () => import('./config.js').AccountsReason,
 *   state: () => AccountState,
 *   getSession: () => Session | null,
 *   pendingEmail: () => string | null,
 *   signIn: (o: {email: string}) => Promise<{step: 'code'} | {error: AccountError}>,
 *   verify: (o: {code: string, email?: string}) => Promise<{session: Session} | {error: AccountError}>,
 *   restart: () => void,
 *   signOut: (o?: {everywhere?: boolean}) => Promise<void>,
 *   authFetch: (path: string, init?: RequestInit) => Promise<Response>,
 *   onChange: (fn: (s: AccountState, session: Session | null) => void) => () => void,
 *   deleteAccount: () => Promise<{ok: boolean, error?: AccountError}>,
 * }} Account
 */
export {};
