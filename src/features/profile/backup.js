/* Profile › Data › Backup: the progress backup's state on this device, its switch and "Back up now"; Restore from
   backup (the devices and days found, a preview of the counts, then restore, with undo); and the one-time opt-in to
   merge the other devices automatically (data/sync/backup.js and data/restore.js through the sync seam). */
import { h, replace } from '../../core/dom.js';
import { label } from '../../core/clock.js';
import { switchRow } from '../../core/ui.js';
import { num } from '../../core/i18n.js';
import { backup, sync, restore } from '../../data/sync/index.js';

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
  const r = restore(store);
  const panel = h('div', { class: 'restore-panel', 'aria-live': 'polite', hidden: true });
  const lastLine = h('div', { class: 'restore-last' });
  const findBtn = h('button', { type: 'button', class: 'btn pressable', 'aria-expanded': 'false', onclick: () => find() }, t('restore.find'));

  /** Read the backup and show what a restore would do. */
  async function find() {
    findBtn.setAttribute('disabled', '');
    findBtn.setAttribute('aria-expanded', 'true');
    panel.hidden = false;
    replace(panel, h('p', { class: 'caption' }, t('restore.reading')));
    let found;
    try {
      found = await r.find((done, total) => { if (total) replace(panel, h('p', { class: 'caption' }, t('restore.readingN', { done, total }))); });
    } catch (e) {
      replace(panel, h('p', { class: 'field-error' }, t('restore.readFailed', { why: e instanceof Error ? e.message : String(e) })), closeRow());
      findBtn.removeAttribute('disabled');
      return;
    }
    const { devices, data, plan } = found;
    if (!devices.length) { replace(panel, h('p', null, t('restore.none', { repo: b.repo })), closeRow()); return; }
    const c = plan.counts;
    const dev = ctx.app?.device || {};
    const deviceName = (/** @type {string} */ id) => id === dev.deviceId ? t('restore.thisDevice', { id }) : (dev.previousDeviceIds || []).includes(id) ? t('restore.thisDeviceBefore', { id }) : t('restore.device', { id });
    const extra = [
      c.settings ? t('restore.countSettings', { n: c.settings }) : null,
      c.mistakes ? t('restore.countMistakes', { n: c.mistakes }) : null,
      c.days ? t('restore.countDays', { n: c.days }) : null,
    ].filter(Boolean);
    const restoreBtn = h('button', { type: 'button', class: 'btn btn-primary pressable', onclick: async () => {
      restoreBtn.setAttribute('disabled', '');
      try {
        const res = await r.apply(data, devices.map(d => d.deviceId));
        ctx.toast(res.applied ? t('restore.doneToast') : t('restore.nothingToast'));
        redraw();
      } catch (e) {
        replace(panel, h('p', { class: 'field-error' }, t('restore.applyFailed', { why: e instanceof Error ? e.message : String(e) })), closeRow());
      }
    } }, t('restore.apply'));
    replace(panel,
      h('h4', null, t('restore.foundTitle', { repo: b.repo })),
      h('ul', { class: 'restore-devices' }, devices.map(d => {
        const sp = r.span(d);
        return h('li', null, h('span', { class: 'restore-device' }, deviceName(d.deviceId)), ' ',
          h('span', { class: 'caption' }, [
            sp.first && sp.last ? (sp.first === sp.last ? label(sp.first) : t('restore.span', { first: label(sp.first), last: label(sp.last) })) : '',
            t('restore.eventDays', { n: sp.eventDays }),
            sp.snapshot ? t('restore.copyFrom', { date: label(sp.snapshot) }) : t('restore.noCopy'),
          ].filter(Boolean).join(' · ')));
      })),
      plan.empty
        ? h('p', null, t('restore.nothing'))
        : h('div', { class: 'restore-preview' },
          h('p', null, t('restore.preview', { added: num(c.added), updated: num(c.updated), unchanged: num(c.unchanged) })),
          c.removed ? h('p', null, t('restore.removed', { n: c.removed })) : null,
          extra.length ? h('p', null, extra.join(' ')) : null,
          h('p', { class: 'field-hint' }, t('restore.undoable'))),
      data.failed.length ? h('p', { class: 'field-error' }, t('restore.unreadable', { n: data.failed.length })) : null,
      h('div', { class: 'row-actions wrap' }, plan.empty ? null : restoreBtn, h('button', { type: 'button', class: 'btn btn-quiet pressable', onclick: close }, plan.empty ? t('restore.close') : t('restore.cancel'))));
    /** @type {HTMLElement | null} */ (panel.querySelector('h4'))?.focus?.();
  }
  function close() { panel.hidden = true; replace(panel); findBtn.removeAttribute('disabled'); findBtn.setAttribute('aria-expanded', 'false'); findBtn.focus(); }
  const closeRow = () => h('div', { class: 'row-actions' }, h('button', { type: 'button', class: 'btn btn-quiet pressable', onclick: close }, t('restore.close')));

  // the last restore or merge on this device, with undo
  r.last().then(j => {
    if (!j) return;
    const c = j.counts || {};
    const what = t('restore.lastCounts', { added: num(c.added || 0), updated: num(c.updated || 0) });
    const line = j.stage === 'done' ? t(j.kind === 'merge' ? 'restore.lastMerge' : 'restore.last', { when: when(j.at), what })
      : j.stage === 'undone' ? t('restore.lastUndone', { when: when(j.at) })
      : j.stage === 'rolledBack' ? t('restore.lastRolledBack', { when: when(j.at) }) : '';
    if (!line) return;
    const undo = j.canUndo ? h('button', { type: 'button', class: 'btn btn-quiet pressable', onclick: async () => {
      undo.setAttribute('disabled', '');
      const n = await r.undo();
      ctx.toast(t('restore.undoneToast', { n }));
      redraw();
    } }, j.kind === 'merge' ? t('restore.undoMerge') : t('restore.undo')) : null;
    replace(lastLine, h('p', { class: 'caption' }, line), undo ? h('div', { class: 'row-actions' }, undo) : null);
  }).catch(() => {});

  const restoreBox = b.linked() ? h('div', { class: 'restore' },
    h('h4', null, t('restore.title')),
    h('p', { class: 'field-hint' }, t('restore.about')),
    h('div', { class: 'row-actions wrap' }, findBtn),
    panel, lastLine,
    switchRow({ label: t('restore.auto'), hint: t('restore.autoHint'), checked: r.autoMergeOn(), onChange: v => {
      r.setAutoMerge(v);
      ctx.toast(v ? t('restore.autoOn') : t('restore.autoOff'));
      if (v) r.merge({ force: true }).then(res => { if (res?.applied) { ctx.toast(t('restore.merged', { n: res.counts.added + res.counts.updated + res.counts.removed })); redraw(); } }).catch(() => {});
    } })) : null;

  return h('div', { class: 'conn backup', id: 'profile-backup' },
    h('h3', null, t('backup.title')),
    h('p', { class: 'field-hint' }, t('backup.about', { repo: b.repo })),
    status,
    b.linked() ? switchRow({ label: t('backup.switch'), checked: b.on(), onChange: v => { b.setOn(v); redraw(); } }) : null,
    !b.linked() ? h('div', { class: 'row-actions' }, h('a', { class: 'btn pressable', href: '#/profile/connections' }, t('backup.link'))) : null,
    b.linked() && b.on() && b.allowed() ? h('div', { class: 'row-actions wrap' }, now) : null,
    restoreBox);
}
