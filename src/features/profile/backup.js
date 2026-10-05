/* Profile › Data › Backup: the progress backup's state on this device, its switch and "Back up now"
   (data/sync/backup.js through the sync seam). */
import { h } from '../../core/dom.js';
import { switchRow } from '../../core/ui.js';
import { num } from '../../core/i18n.js';
import { backup, sync } from '../../data/sync/index.js';

/** "5 Oct, 10:42" in the reader's time zone. @param {string | null | undefined} iso */
export function when(iso) {
  const ms = Date.parse(iso || '');
  if (!Number.isFinite(ms)) return '';
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(ms));
}

/**
 * The backup block. redraw() rebuilds the Data section (after the switch or a run).
 * @param {import('../contract.js').ViewCtx} ctx @param {() => void} redraw
 */
export function backupBlock(ctx, redraw) {
  const { store, t } = ctx;
  const b = backup(store);
  const status = h('p', { class: 'caption status', 'aria-live': 'polite' }, statusText());
  /** The state in one or two sentences. */
  function statusText() {
    if (!b.linked()) return t('backup.notLinked');
    if (!b.on()) return t('backup.off');
    if (!b.allowed()) return t('backup.held');
    const st = b.state();
    const n = b.waiting();
    const parts = [st.error ? t('backup.failed', { why: st.error.message }) : st.at ? t('backup.last', { when: when(st.at) }) : t('backup.never')];
    if (n) parts.push(t('backup.waiting', { n, count: num(n) }));
    if (st.snapshot?.at && !st.error) parts.push(t('backup.snapshot', { when: when(st.snapshot.at), n: st.snapshot.cards, count: num(st.snapshot.cards || 0) }));
    return parts.join(' ');
  }
  const now = h('button', { type: 'button', class: 'btn pressable', onclick: async () => {
    now.setAttribute('disabled', '');
    status.textContent = t('backup.working');
    const r = await sync(store, { backupNow: true, emit: (type, d) => ctx.bus.emit(type, d) }).catch(e => ({ error: String(e?.message || e), backup: null }));
    const err = r.backup?.error || (!r.backup ? r.error : null);
    ctx.toast(err ? t('backup.failedToast') : t('backup.doneToast'));
    redraw();
  } }, t('backup.now'));
  return h('div', { class: 'conn backup', id: 'profile-backup' },
    h('h3', null, t('backup.title')),
    h('p', { class: 'field-hint' }, t('backup.about', { repo: b.repo })),
    status,
    b.linked() ? switchRow({ label: t('backup.switch'), checked: b.on(), onChange: v => { b.setOn(v); redraw(); } }) : null,
    !b.linked() ? h('div', { class: 'row-actions' }, h('a', { class: 'btn pressable', href: '#/profile/connections' }, t('backup.link'))) : null,
    b.linked() && b.on() && b.allowed() ? h('div', { class: 'row-actions wrap' }, now) : null);
}
