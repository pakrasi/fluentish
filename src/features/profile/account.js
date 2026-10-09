/* Profile › Account (docs/ACCOUNTS.md, round 8 stage 0). Drawn only when account.available(): with LocalOnly, the
   default, Profile never calls this file and is unchanged. Sign-in is an email and a 6-digit code (no link, so it
   works the same in Safari, a Home Screen app and the iOS shell). No token ever reaches this file: it sees
   getSession() = {userId, email, expiresAt} only. */
import { h } from '../../core/dom.js';
import { section, field, notice } from '../../core/ui.js';

/** A new code can be asked for this long after the last one (Supabase sends at most one a minute per user). */
const RESEND_MS = 60e3;

/** @typedef {import('../../data/account/types.js').Account} Account */
/** @typedef {{sentAt: number}} AccountUi state kept across redraws of the section */

/**
 * @param {{t: (k: string, v?: Record<string, any>) => string, toast: (msg: string) => void}} ctx
 * @param {Account} account @param {AccountUi} ui
 * @returns {HTMLElement}
 */
export function accountSection(ctx, account, ui) {
  const { t } = ctx;
  const sec = section(t('account.title'));
  sec.id = 'profile-account';
  const st = account.state();
  const session = account.getSession();
  const status = h('p', { class: 'caption status', 'aria-live': 'polite' });
  if (account.provider() === 'fake') sec.append(h('p', { class: 'field-hint' }, t('account.fake')));

  /** Run a call with its button disabled; a returned error shows in the field. @param {HTMLButtonElement} btn @param {() => Promise<any>} fn @param {any} [f] */
  const busy = async (btn, fn, f) => {
    btn.disabled = true;
    try {
      const r = await fn();
      if (r && r.error) { if (f) f.setError(t(`account.err.${r.error}`)); else status.textContent = t(`account.err.${r.error}`); }
      return r;
    } finally { if (btn.isConnected) btn.disabled = false; }
  };

  if (st === 'signedIn' || st === 'offline') {
    const out = /** @type {HTMLButtonElement} */ (h('button', { type: 'button', class: 'btn pressable', name: 'account-signout', onclick: async () => {
      await busy(out, () => account.signOut());
      ctx.toast(t('account.signedOutToast'));
    } }, t('account.signOut')));
    const all = /** @type {HTMLButtonElement} */ (h('button', { type: 'button', class: 'btn btn-quiet pressable', name: 'account-signout-all', onclick: async () => {
      await busy(all, () => account.signOut({ everywhere: true }));
      ctx.toast(t('account.signedOutToast'));
    } }, t('account.signOutAll')));
    sec.append(
      h('p', null, t('account.signedIn', { email: session?.email || '' })),
      st === 'offline' ? notice({ kind: 'warning', children: [h('p', null, t('account.offline'))] }) : null,
      h('div', { class: 'row-actions' }, out, all), status);
    return sec;
  }

  if (st === 'codeSent') {
    const codeIn = /** @type {HTMLInputElement} */ (h('input', { class: 'input', type: 'text', name: 'account-code', inputmode: 'numeric',
      autocomplete: 'one-time-code', pattern: '[0-9 ]*', maxlength: '7', spellcheck: 'false', enterkeyhint: 'go' }));
    const codeField = field({ label: t('account.code'), input: codeIn });
    const signIn = /** @type {HTMLButtonElement} */ (h('button', { type: 'submit', class: 'btn pressable', name: 'account-signin' }, t('account.signIn')));
    const resend = /** @type {HTMLButtonElement} */ (h('button', { type: 'button', class: 'btn btn-quiet pressable', name: 'account-resend', onclick: async () => {
      const email = account.pendingEmail();
      if (!email) return;
      const r = await busy(resend, () => account.signIn({ email }), codeField);
      if (r && !r.error) { ui.sentAt = Date.now(); waitResend(); }
    } }, t('account.resend')));
    const other = h('button', { type: 'button', class: 'btn btn-quiet pressable', name: 'account-other', onclick: () => account.restart() }, t('account.otherEmail'));
    // the resend button waits a minute after each code
    const waitResend = () => {
      const left = ui.sentAt + RESEND_MS - Date.now();
      if (left <= 0) return;
      resend.disabled = true;
      setTimeout(() => { if (resend.isConnected) resend.disabled = false; }, left);
    };
    waitResend();
    sec.append(h('form', { class: 'conn', novalidate: true, onsubmit: async (/** @type {Event} */ e) => {
      e.preventDefault();
      codeField.setError(null);
      await busy(signIn, () => account.verify({ code: codeIn.value }), codeField);
    } },
    h('p', null, t('account.codeSent', { email: account.pendingEmail() || '' })),
    codeField,
    h('div', { class: 'row-actions' }, signIn, resend, other)), status);
    return sec;
  }

  // signed out
  const emailIn = /** @type {HTMLInputElement} */ (h('input', { class: 'input', type: 'email', name: 'account-email', autocomplete: 'email',
    autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'send', value: account.pendingEmail() || '' }));
  const emailField = field({ label: t('account.email'), input: emailIn, hint: t('account.email.hint') });
  const send = /** @type {HTMLButtonElement} */ (h('button', { type: 'submit', class: 'btn pressable', name: 'account-send' }, t('account.sendCode')));
  // novalidate: the app's own message, the same in every browser
  sec.append(h('form', { class: 'conn', novalidate: true, onsubmit: async (/** @type {Event} */ e) => {
    e.preventDefault();
    emailField.setError(null);
    // set before the call: the section is drawn again for the code inside signIn()
    ui.sentAt = Date.now();
    const r = await busy(send, () => account.signIn({ email: emailIn.value }), emailField);
    if (!r || r.error) ui.sentAt = 0;
  } }, emailField, h('div', { class: 'row-actions' }, send)), status);
  return sec;
}

/**
 * The Diagnostics line, or null when accounts are simply not configured (the default: Diagnostics is unchanged).
 * @param {(k: string, v?: Record<string, any>) => string} t
 * @param {{provider: string, reason: string}} status
 * @returns {HTMLElement[] | null}
 */
export function accountsDiagnostics(t, status) {
  if (status.provider === 'local' && status.reason === 'notConfigured') return null;
  const text = status.provider === 'local'
    ? t('diag.accounts.off', { why: t(`accounts.why.${status.reason}`) })
    : t('diag.accounts.on', { provider: t(`accounts.provider.${status.provider}`) });
  return [h('dt', null, t('diag.accounts')), h('dd', null, text)];
}
