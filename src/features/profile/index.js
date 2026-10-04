/* Profile: the one settings page, opened from the avatar (UX §4.11).
   Goal (with the exam date: its single source) · Practice · Connections (Claude key, results sync device link) ·
   Appearance (theme, motion) · Data (export, import, the import summary, delete) · Diagnostics.
   #/profile/<section> scrolls to that section. */
import { h, replace, download } from '../../core/dom.js';
import { label } from '../../core/clock.js';
import { config } from '../../core/config.js';
import { icon } from '../../core/icons.js';
import { section, seg, field, switchRow, notice, avatar, nextId, chipChoice } from '../../core/ui.js';
import { entries as logEntries } from '../../core/log.js';
import { setSetting, setExamDate, MODULES, defaultPrefs } from '../../data/settings.js';
import { summaryText } from '../../data/migrate.js';
import { exportBundle, importFile } from '../../data/transfer.js';
import { deleteProfile } from '../../data/session.js';
import { notSentCount } from '../../data/sync/github-b1exam.js';
import { newPerDayChosen } from '../../domain/budget.js';

/** @param {HTMLElement} el @param {import('../contract.js').ViewCtx} ctx */
export async function mount(el, ctx) {
  const { store, t, bus, app } = ctx;
  const manifest = await ctx.content.manifest().catch(() => null);
  const languages = manifest ? manifest.languages : [];
  const exams = manifest ? manifest.exams : [];
  const write = (/** @type {string} */ path, /** @type {any} */ v) => setSetting({ store, hlc: app.hlc, bus }, path, v);

  /** Rebuild one section in place and keep keyboard focus on the same control (matched by name). @param {HTMLElement} sec */
  function swapSection(sec) {
    const key = document.activeElement?.getAttribute('name');
    document.getElementById(sec.id)?.replaceWith(sec);
    const cap = el.querySelector('.profile-head .caption');
    if (cap) cap.textContent = goalLine(ctx.settings());
    if (key) /** @type {HTMLElement | null} */ (sec.querySelector(`[name="${CSS.escape(key)}"]`))?.focus();
  }
  const renderGoal = () => swapSection(goal(ctx.settings()));

  function render() {
    const s = ctx.settings();
    const page = h('div', { class: 'profile stack' },
      h('header', { class: 'profile-head' },
        avatar(app.profile, ''),
        h('div', null, h('h1', null, t('profile.title')), h('p', { class: 'caption' }, goalLine(s)))),
      nameField(),
      goal(s), practice(s), connections(), appearance(), data(), diagnostics());
    replace(el, page);
    const target = ctx.params.rest;
    if (target) requestAnimationFrame(() => document.getElementById(`profile-${target}`)?.scrollIntoView({ block: 'start' }));
  }

  /** @param {any} s */
  function goalLine(s) {
    const lang = languages.find((/** @type {any} */ l) => l.id === s.language);
    return [lang ? lang.name : t('profile.noLanguage'), s.level].filter(Boolean).join(' · ');
  }

  function nameField() {
    const input = h('input', { class: 'input', type: 'text', value: app.profile.name || '', maxlength: '40', autocomplete: 'nickname',
      onchange: async (/** @type {Event} */ e) => {
        app.profile.name = /** @type {HTMLInputElement} */ (e.target).value.trim().slice(0, 40);
        await app.adapter.putProfile(app.profile);
        bus.emit('profile:changed', app.profile);
        el.querySelector('.profile-head .avatar')?.replaceWith(avatar(app.profile, ''));
      } });
    return field({ label: t('profile.name'), input, hint: t('profile.name.hint') });
  }

  /* ---------- goal ---------- */
  /** @param {any} s */
  function goal(s) {
    const c = ctx.clock.ctx();
    const sec = section(t('profile.goal'));
    sec.id = 'profile-goal';
    const langSel = chipChoice({ label: t('profile.language'), name: 'language', value: s.language || '',
      options: languages.map((/** @type {any} */ l) => /** @type {[string, string]} */ ([l.id, l.name])), onChange: v => {
        write('language', v);
        const ex = exams.find((/** @type {any} */ x) => x.id === s.exam.type);
        if (ex && ex.language !== v) write('exam.type', s.exam.date ? 'other' : null);
        renderGoal();
      } });
    const levelSeg = seg({ label: t('profile.level'), value: s.level || '', options: config.levels.map(l => [l, l]), onChange: v => { write('level', v); renderGoal(); } });
    const examOptions = [...exams.filter((/** @type {any} */ x) => x.language === s.language).map((/** @type {any} */ x) => [x.id, x.name]), ['other', t('goal.exam.other')], ['', t('goal.exam.none')]];
    const examSel = chipChoice({ label: t('goal.exam'), name: 'exam', value: s.exam.type || '', options: /** @type {any} */ (examOptions), onChange: v => {
      write('exam.type', v || null);
      if (!v && s.exam.date) setExamDate(appCtx(), null);
      renderGoal();
    } });
    const dateInput = /** @type {HTMLInputElement} */ (h('input', { class: 'input', type: 'date', name: 'exam-date', value: s.exam.date || '', min: c.today }));
    const dateField = field({ label: t('goal.date'), input: dateInput, hint: t('goal.date.hint') });
    dateInput.addEventListener('change', () => {
      const prev = s.exam.date;
      const r = setExamDate(appCtx(), dateInput.value || null);
      if (!r.ok) { dateField.setError(t(/** @type {string} */ (r.error))); return; }
      dateField.setError(null);
      if (!prev && dateInput.value && !s.exam.type) write('exam.type', exams.find((/** @type {any} */ x) => x.language === s.language)?.id || 'other');
      // no toast: the derived line under the field is live and says what the new date changes
      renderGoal();
    });
    const clearBtn = s.exam.date ? h('button', { type: 'button', class: 'btn btn-quiet pressable', onclick: () => { setExamDate(appCtx(), null); ctx.toast(t('goal.date.cleared')); renderGoal(); } }, t('goal.date.clear')) : null;
    const isMock = exams.some((/** @type {any} */ x) => x.id === s.exam.type);
    const modules = isMock ? h('div', { class: 'form-field' }, h('p', { class: 'field-label', id: 'mods-l' }, t('goal.modules')),
      h('div', { class: 'chips', role: 'group', 'aria-labelledby': 'mods-l' }, MODULES.map(m => {
        const def = exams.find((/** @type {any} */ x) => x.id === s.exam.type).modules.find((/** @type {any} */ x) => x.id === m);
        const on = s.exam.modules.includes(m);
        return h('button', { type: 'button', name: `module:${m}`, class: 'chip pressable', 'aria-pressed': String(on), onclick: () => {
          const next = on ? s.exam.modules.filter((/** @type {string} */ x) => x !== m) : MODULES.filter(x => x === m || s.exam.modules.includes(x));
          if (next.length) { write('exam.modules', next); renderGoal(); }
        } }, def ? def.name : m);
      }))) : null;
    const minutes = h('div', { class: 'form-field' }, h('p', { class: 'field-label' }, t('goal.minutes')),
      seg({ label: t('goal.minutes'), value: String(s.minutesPerDay), options: config.minutesOptions.map(n => [String(n), t('unit.min', { n })]), onChange: v => { write('minutesPerDay', Number(v)); renderGoal(); } }));
    sec.append(
      langSel,
      h('div', { class: 'form-field' }, h('p', { class: 'field-label' }, t('profile.level')), levelSeg),
      examSel,
      s.exam.type ? h('div', { class: 'date-row' }, dateField, clearBtn) : null,
      modules, minutes,
      h('p', { class: 'derived', 'aria-live': 'polite' }, derived(c)));
    return sec;
  }

  /** What the date controls, restated under the field so a change shows at once (UX §4.11). @param {any} c */
  function derived(c) {
    if (c.phase === 'none') return t('goal.derived.none');
    if (c.phase === 'after') return t('goal.derived.after', { date: label(c.exam) });
    if (c.phase === 'day') return t('goal.derived.day');
    if (c.phase === 'eve') return t('goal.derived.eve');
    return t('goal.derived.week', { n: c.daysLeft, lastNew: label(c.lastNewDay), cap: label(c.capDay) });
  }

  const appCtx = () => ({ store, hlc: app.hlc, bus, clock: ctx.clock });

  /* ---------- practice ---------- */
  /** @param {any} s */
  function practice(s) {
    const sec = section(t('profile.practice'));
    sec.id = 'profile-practice';
    const perDay = h('div', { class: 'form-field' }, h('p', { class: 'field-label' }, t('practice.newPerDay')),
      seg({ label: t('practice.newPerDay'), value: newPerDayChosen(s) ? String(s.newPerDay) : 'auto',
        options: [['auto', t('practice.newAuto')], ...[10, 20, 30, 40].map(n => /** @type {[string, string]} */ ([String(n), String(n)]))],
        onChange: v => write('newPerDay', v === 'auto' ? null : Number(v)) }),
      h('p', { class: 'field-hint' }, t('practice.newPerDay.hint')));
    const hasKey = !!(store.get('secrets', {}) || {}).anthropicKey;
    sec.append(
      perDay,
      switchRow({ label: t('practice.readAloud'), checked: s.practice.readAloud, onChange: v => write('practice.readAloud', v) }),
      switchRow({ label: t('practice.claudeCheck'), hint: hasKey ? undefined : t('practice.claudeCheck.needsKey'), checked: s.practice.claudeCheck, onChange: v => write('practice.claudeCheck', v) }),
      switchRow({ label: t('practice.simpleInput'), hint: t('practice.simpleInput.hint'), checked: s.practice.simpleInput, onChange: v => write('practice.simpleInput', v) }));
    return sec;
  }

  /* ---------- connections ---------- */
  function connections() {
    const sec = section(t('profile.connections'));
    sec.id = 'profile-connections';
    const secrets = () => ({ anthropicKey: null, githubToken: null, ...(store.get('secrets', {}) || {}) });
    const setSecret = (/** @type {string} */ k, /** @type {any} */ v) => { store.set('secrets', { ...secrets(), [k]: v }); swapSection(connections()); };

    // Claude API key
    const keyIn = /** @type {HTMLInputElement} */ (h('input', { class: 'input', type: 'password', autocomplete: 'off', spellcheck: 'false', placeholder: secrets().anthropicKey ? t('conn.key.saved') : 'sk-ant-…' }));
    const keyField = field({ label: t('conn.key'), input: keyIn, hint: t('conn.key.hint') });
    const keyBox = h('div', { class: 'conn' },
      h('h3', null, t('conn.claude')),
      h('p', { class: 'caption status' }, secrets().anthropicKey ? t('conn.key.status.on') : t('conn.key.status.off')),
      keyField,
      h('div', { class: 'row-actions' },
        h('button', { type: 'button', class: 'btn pressable', onclick: () => { const v = keyIn.value.trim(); if (!v) { keyField.setError(t('conn.key.empty')); return; } setSecret('anthropicKey', v); ctx.toast(t('conn.key.savedToast')); } }, t('conn.save')),
        secrets().anthropicKey ? h('button', { type: 'button', class: 'btn btn-quiet pressable', onclick: () => setSecret('anthropicKey', null) }, t('conn.remove')) : null));

    // results sync: link this device to the private results repository with a fine-grained token
    const tokIn = /** @type {HTMLInputElement} */ (h('input', { class: 'input', type: 'password', autocomplete: 'off', spellcheck: 'false', placeholder: secrets().githubToken ? t('conn.key.saved') : 'github_pat_…' }));
    const tokField = field({ label: t('conn.token'), input: tokIn, hint: h('span', null, t('conn.token.hint', { repo: config.resultsRepo }), ' ', h('a', { href: config.github.newTokenUrl, target: '_blank', rel: 'noopener noreferrer' }, t('conn.token.create'))) });
    const status = h('p', { class: 'caption status', 'aria-live': 'polite' }, secrets().githubToken ? t('conn.sync.linked', { repo: config.resultsRepo }) : t('conn.sync.notLinked'));
    const check = async () => {
      const tok = secrets().githubToken;
      if (!tok) return;
      status.textContent = t('conn.sync.checking');
      try {
        const r = await fetch(`${config.github.api}/repos/${config.resultsRepo}`, { headers: { Authorization: `Bearer ${tok}`, Accept: 'application/vnd.github+json' }, cache: 'no-store' });
        const exp = r.headers.get('github-authentication-token-expiration');
        status.textContent = r.ok ? t('conn.sync.ok', { repo: config.resultsRepo }) + (exp ? ` ${t('conn.sync.expires', { date: exp.slice(0, 10) })}` : '') : t('conn.sync.fail', { status: r.status });
      } catch { status.textContent = t('conn.sync.offline'); }
    };
    const pending = notSentCount(store);   // results-sync events only, the same count as the Exam tab
    const syncBox = h('div', { class: 'conn' },
      h('h3', null, t('conn.sync')),
      h('p', { class: 'field-hint' }, t('conn.sync.about')),
      status,
      tokField,
      h('div', { class: 'row-actions' },
        h('button', { type: 'button', class: 'btn pressable', onclick: () => { const v = tokIn.value.trim(); if (!v) { tokField.setError(t('conn.token.empty')); return; } setSecret('githubToken', v); ctx.toast(t('conn.sync.savedToast')); } }, secrets().githubToken ? t('conn.replace') : t('conn.link')),
        secrets().githubToken ? h('button', { type: 'button', class: 'btn btn-quiet pressable', onclick: check }, t('conn.check')) : null,
        secrets().githubToken ? h('button', { type: 'button', class: 'btn btn-quiet pressable', onclick: () => setSecret('githubToken', null) }, t('conn.unlink')) : null),
      h('p', { class: 'caption' }, pending ? t('conn.sync.pending', { n: pending }) : t('conn.sync.nonePending')));
    sec.append(keyBox, syncBox, h('p', { class: 'caption' }, t('conn.device')));
    return sec;
  }

  /* ---------- appearance ---------- */
  function appearance() {
    const prefs = { ...defaultPrefs(), ...(store.get('prefs', {}) || {}) };
    const setPref = (/** @type {string} */ k, /** @type {string} */ v) => { store.set('prefs', { ...prefs, ...(store.get('prefs', {}) || {}), [k]: v }); bus.emit('prefs:changed', { key: k, value: v }); };
    const sec = section(t('profile.appearance'));
    sec.id = 'profile-appearance';
    sec.append(
      h('div', { class: 'form-field' }, h('p', { class: 'field-label' }, t('appearance.theme')),
        seg({ label: t('appearance.theme'), value: prefs.theme, options: [['auto', t('appearance.auto')], ['light', t('appearance.light')], ['dark', t('appearance.dark')]], onChange: v => setPref('theme', v) })),
      h('div', { class: 'form-field' }, h('p', { class: 'field-label' }, t('appearance.motion')),
        seg({ label: t('appearance.motion'), value: prefs.motion, options: [['system', t('appearance.system')], ['reduce', t('appearance.reduce')], ['full', t('appearance.full')]], onChange: v => setPref('motion', v) }),
        h('p', { class: 'field-hint' }, t('appearance.motion.hint'))));
    return sec;
  }

  /* ---------- data ---------- */
  function data() {
    const sec = section(t('profile.data'));
    sec.id = 'profile-data';
    const meta = store.get('meta', {}) || {};
    const result = h('div', { 'aria-live': 'polite' });
    const fileIn = /** @type {HTMLInputElement} */ (h('input', { type: 'file', accept: 'application/json,.json', class: 'sr-only', id: nextId('imp') }));
    fileIn.addEventListener('change', async () => {
      const f = fileIn.files && fileIn.files[0];
      if (!f) return;
      try {
        const r = await importFile(await f.text(), { store, hlc: app.hlc, bus });
        replace(result, notice({ children: [h('p', null, t('data.imported', { cards: r.cards, attempts: r.attempts, kind: t(`data.kind.${r.kind}`) }))] }));
        ctx.toast(t('data.importedToast'));
      } catch (e) {
        replace(result, notice({ kind: 'warning', children: [h('p', null, t('data.importFailed', { why: e instanceof Error ? e.message : String(e) }))] }));
      }
      fileIn.value = '';
    });
    const unsent = notSentCount(store);
    const deleteBtn = h('button', { type: 'button', class: 'btn btn-quiet danger pressable', 'aria-expanded': 'false', onclick: () => {
      confirm.hidden = false; deleteBtn.setAttribute('aria-expanded', 'true');
      /** @type {HTMLElement | null} */ (confirm.querySelector('button'))?.focus();
    } }, t('data.delete'));
    const confirm = h('div', { class: 'confirm', hidden: true, role: 'alertdialog', 'aria-modal': 'false', 'aria-labelledby': 'del-q' },
      h('p', { id: 'del-q' }, t('data.delete.confirm')),
      unsent ? h('p', { class: 'field-error' }, t('data.delete.unsent', { n: unsent })) : null,
      h('div', { class: 'row-actions' },
        h('button', { type: 'button', class: 'btn btn-danger pressable', onclick: async () => {
          await store.flush();
          await deleteProfile(app.adapter, app.device, app.profile);
          store.deleted = true;              // this tab writes nothing more into it either
          store.post({ kind: 'deleted' });   // other open tabs reload instead of writing into the deleted profile
          location.hash = '#/welcome';
          location.reload();
        } }, unsent ? t('data.delete.yesUnsent') : t('data.delete.yes')),
        h('button', { type: 'button', class: 'btn btn-quiet pressable', onclick: () => { confirm.hidden = true; deleteBtn.setAttribute('aria-expanded', 'false'); deleteBtn.focus(); } }, t('data.delete.no'))));
    sec.append(
      meta.summary ? h('div', { class: 'import-summary' },
        h('h3', null, t('data.moved')),
        h('p', null, t('data.movedOn', { date: label(String(meta.migratedAt).slice(0, 10)) })),
        h('p', null, summaryText(meta.summary, t)),
        meta.summary.iglooCards ? h('p', { class: 'caption' }, t('data.iglooStays', { n: meta.summary.iglooCards })) : null,
        meta.summary.cardsSkipped ? h('p', { class: 'caption' }, t('data.skipped', { n: meta.summary.cardsSkipped })) : null) : null,
      h('div', { class: 'row-actions wrap' },
        h('button', { type: 'button', class: 'btn pressable', onclick: () => {
          const b = exportBundle(store, { profile: app.profile });
          download(new Blob([JSON.stringify(b, null, 1)], { type: 'application/json' }), `fluentish-${ctx.clock.today()}.json`);
        } }, icon('download', { size: 18 }), t('data.export')),
        h('label', { class: 'btn pressable', for: fileIn.id }, icon('upload', { size: 18 }), t('data.import')), fileIn,
        deleteBtn),
      h('p', { class: 'field-hint' }, t('data.hint')),
      result, confirm);
    return sec;
  }

  /* ---------- diagnostics ---------- */
  function diagnostics() {
    const sec = section(t('profile.diagnostics'));
    sec.id = 'profile-diagnostics';
    const storage = h('dd', null, '…');
    app.adapter.estimate?.().then((/** @type {any} */ e) => {
      storage.textContent = !e ? t('diag.storage.memory') : `${e.persisted ? t('diag.storage.persisted') : t('diag.storage.notPersisted')}${e.usage != null ? ` · ${Math.round(e.usage / 1024)} KB` : ''}`;
    });
    const errs = logEntries();
    sec.append(h('dl', { class: 'diag' },
      h('dt', null, t('diag.content')), h('dd', { class: 'mono' }, manifest ? manifest.version : '–'),
      h('dt', null, t('diag.storage')), storage,
      h('dt', null, t('diag.device')), h('dd', { class: 'mono' }, app.device.deviceId),
      h('dt', null, t('diag.events')), h('dd', null, t('diag.eventsVal', { n: store.pending().length })),
      h('dt', null, t('diag.errors')), h('dd', null, errs.length ? errs.slice(-3).map(e => h('span', { class: 'mono block' }, `${e.where}: ${e.message}`)) : t('diag.none'))));
    return sec;
  }

  render();
}
