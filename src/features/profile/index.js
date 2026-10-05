/* Profile: the one settings page, opened from the avatar (UX §4.11).
   Courses (one per language; the active one is what Today and Practice are about) · Goal of the active course (with
   the exam date: its single source) · Practice · Connections (Claude key, results sync device link) ·
   Appearance (theme, motion) · Data (export, import, the import summary, delete) · Diagnostics.
   #/profile/<section> scrolls to that section. */
import { h, replace } from '../../core/dom.js';
import { shareFile } from '../../services/share.js';
import { label } from '../../core/clock.js';
import { config } from '../../core/config.js';
import { icon } from '../../core/icons.js';
import { section, seg, field, switchRow, notice, avatar, nextId, chipChoice } from '../../core/ui.js';
import { entries as logEntries } from '../../core/log.js';
import { setSetting, setExamDate, setCourse, setActiveCourse, addCourse, langCode, examDate, MODULES, defaultPrefs } from '../../data/settings.js';
import { summaryText } from '../../data/migrate.js';
import { previewText } from '../../data/cutover.js';
import { exportBundle, importFile } from '../../data/transfer.js';
import { deleteProfile } from '../../data/session.js';
import { results } from '../../data/sync/index.js';
import { backupBlock } from './backup.js';
import { newPerDayChosen, buildShare } from '../../domain/budget.js';

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
  const renderGoal = () => { swapSection(goal(ctx.settings())); swapSection(courses(ctx.settings())); };

  function render() {
    const s = ctx.settings();
    const page = h('div', { class: 'profile stack' },
      h('header', { class: 'profile-head' },
        avatar(app.profile, ''),
        h('div', null, h('h1', null, t('profile.title')), h('p', { class: 'caption' }, goalLine(s)))),
      nameField(),
      courses(s), goal(s), practice(s), connections(), appearance(), data(), diagnostics());
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

  /* ---------- courses ---------- */
  /** @param {any} s */
  function courses(s) {
    const sec = section(t('profile.courses'));
    sec.id = 'profile-courses';
    const langOf = (/** @type {string} */ code) => languages.find((/** @type {any} */ l) => langCode(l.id) === code) || null;
    const examName = (/** @type {string | null} */ id) => (!id ? null : id === 'other' ? t('goal.exam.other') : exams.find((/** @type {any} */ x) => x.id === id)?.short || id);
    const list = h('ul', { class: 'list courses' }, s.courses.map((/** @type {any} */ c) => {
      const active = c.id === s.activeCourse;
      const name = langOf(c.lang)?.name || c.lang;
      const detail = [c.level, examName(c.goal.exam), c.goal.date ? t('courses.examOn', { date: label(c.goal.date) }) : null, active ? t('unit.min', { n: s.minutesPerDay }) : null].filter(Boolean).join(' · ');
      return h('li', { class: 'row course-row', dataset: { course: c.id } },
        h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, name), detail ? h('span', { class: 'row-detail' }, detail) : null),
        active ? h('span', { class: 'row-trail' }, t('courses.active'))
          : h('button', { type: 'button', class: 'btn btn-quiet pressable', 'aria-label': t('courses.switchTo', { lang: name }), onclick: () => {
            setActiveCourse(appCtx(), c.id);
            ctx.refreshShell();   // the Exam tab follows the course's goal
            ctx.toast(t('courses.switched', { lang: name }));
            render();
          } }, t('courses.switch')));
    }));
    // Add a course: a language whose content ships in this build can be added; the others are listed as later
    const have = new Set(s.courses.map((/** @type {any} */ c) => c.lang));
    const others = languages.filter((/** @type {any} */ l) => langCode(l.id) && !have.has(langCode(l.id))).sort((/** @type {any} */ a, /** @type {any} */ b) => a.name.localeCompare(b.name, 'en'));
    const add = h('details', { class: 'course-add' }, h('summary', null, t('courses.add')),
      h('p', { class: 'field-hint' }, t('courses.add.hint')),
      h('ul', { class: 'list' }, others.map((/** @type {any} */ l) => h('li', { class: 'row' },
        h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, l.name)),
        l.content ? h('button', { type: 'button', class: 'btn btn-quiet pressable', 'aria-label': t('courses.addLang', { lang: l.name }), onclick: () => {
          addCourse(appCtx(), { lang: /** @type {string} */ (langCode(l.id)) });
          ctx.refreshShell();
          ctx.toast(t('courses.added', { lang: l.name }));
          render();
        } }, t('courses.addShort')) : h('span', { class: 'row-trail' }, t('courses.later'))))));
    sec.append(s.courses.length ? list : h('p', { class: 'caption' }, t('profile.noLanguage')), add);
    return sec;
  }

  /* ---------- goal ---------- */
  /** @param {any} s */
  function goal(s) {
    const c = ctx.clock.ctx();
    const sec = section(t('profile.goal'));
    sec.id = 'profile-goal';
    const levelSeg = seg({ label: t('profile.level'), value: s.level || '', options: config.levels.map(l => [l, l]), onChange: v => { writeCourse({ level: v }); renderGoal(); } });
    const examOptions = [...exams.filter((/** @type {any} */ x) => x.language === s.language).map((/** @type {any} */ x) => [x.id, x.name]), ['other', t('goal.exam.other')], ['', t('goal.exam.none')]];
    const examSel = chipChoice({ label: t('goal.exam'), name: 'exam', value: s.exam.type || '', options: /** @type {any} */ (examOptions), onChange: v => {
      writeCourse({ 'goal.exam': v || null });
      if (!v && examDate(s)) setExamDate(appCtx(), null);
      renderGoal();
    } });
    const dateInput = /** @type {HTMLInputElement} */ (h('input', { class: 'input', type: 'date', name: 'exam-date', value: examDate(s) || '', min: c.today }));
    const dateField = field({ label: t('goal.date'), input: dateInput, hint: t('goal.date.hint') });
    dateInput.addEventListener('change', () => {
      const prev = examDate(s);
      const r = setExamDate(appCtx(), dateInput.value || null);
      if (!r.ok) { dateField.setError(t(/** @type {string} */ (r.error))); return; }
      dateField.setError(null);
      if (!prev && dateInput.value && !s.exam.type) writeCourse({ 'goal.exam': exams.find((/** @type {any} */ x) => x.language === s.language)?.id || 'other' });
      // no toast: the derived line under the field is live and says what the new date changes
      renderGoal();
    });
    const clearBtn = examDate(s) ? h('button', { type: 'button', class: 'btn btn-quiet pressable', onclick: () => { setExamDate(appCtx(), null); ctx.toast(t('goal.date.cleared')); renderGoal(); } }, t('goal.date.clear')) : null;
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
    // the date first: it drives the countdown, the caps and the pacing
    // (Element.append writes a null as the text "null": the fields a goal without an exam does not have are left out)
    sec.append(...[
      s.exam.type ? h('div', { class: 'date-row' }, dateField, clearBtn) : null,
      h('p', { class: 'derived', 'aria-live': 'polite' }, derived(c)),
      examSel,
      modules, minutes,
      h('div', { class: 'form-field' }, h('p', { class: 'field-label' }, t('profile.level')), levelSeg)].filter(x => x != null));
    return sec;
  }

  /** What the date controls, restated under the field so a change shows at once (UX §4.11). @param {any} c */
  function derived(c) {
    if (c.phase === 'none') return t('goal.derived.none');
    if (c.phase === 'after') return t('goal.derived.after', { date: label(c.exam) });
    if (c.phase === 'day') return t('goal.derived.day');
    if (c.phase === 'eve') return t('goal.derived.eve');
    if (c.phase === 'lastNew') return t('goal.derived.lastNew', { cap: label(c.capDay) });
    return t('goal.derived.week', { n: c.daysLeft, lastNew: label(c.lastNewDay), cap: label(c.capDay) });
  }

  const appCtx = () => ({ store, hlc: app.hlc, bus, clock: ctx.clock });
  /** The goal fields belong to the active course: written through its one writer (data/settings.js setCourse). @param {Record<string, any>} patch */
  const writeCourse = patch => { const id = ctx.settings().activeCourse; if (id) setCourse(appCtx(), id, patch); else for (const [k, v] of Object.entries(patch)) write(k === 'goal.exam' ? 'exam.type' : k, v); };

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
    // Word building's share of those new items (it was a chip row on Word building's page; one allowance, one place)
    const buildNew = h('div', { class: 'form-field', id: 'profile-build-new' }, h('p', { class: 'field-label' }, t('profile.buildNew')),
      seg({ label: t('profile.buildNew'), value: String(buildShare(s)), options: [0, 3, 5, 8, 12].map(n => /** @type {[string, string]} */ ([String(n), String(n)])),
        onChange: v => write('practice.buildNew', Number(v)) }),
      h('p', { class: 'field-hint' }, t('profile.buildNew.hint')));
    const hasKey = !!(store.get('secrets', {}) || {}).anthropicKey;
    sec.append(
      perDay, buildNew,
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
    const pending = results(store).notSent();   // results-sync events only, the same count as the Exam tab
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
    // the visible control is a real button; the file input stays out of the tab order
    const fileIn = /** @type {HTMLInputElement} */ (h('input', { type: 'file', accept: 'application/json,.json', class: 'sr-only', id: nextId('imp'), tabindex: '-1', 'aria-hidden': 'true' }));
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
    const unsent = results(store).notSent();
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
          // replaceState, not location.hash: a hashchange would route the still-onboarded tab to Today and start
          // loading it just as the reload cancels that (an aborted import in the error log)
          history.replaceState(history.state, '', '#/welcome');
          location.reload();
        } }, unsent ? t('data.delete.yesUnsent') : t('data.delete.yes')),
        h('button', { type: 'button', class: 'btn btn-quiet pressable', onclick: () => { confirm.hidden = true; deleteBtn.setAttribute('aria-expanded', 'false'); deleteBtn.focus(); } }, t('data.delete.no'))));
    let includeScripts = false;   // scripts are private to the device (practice/script): out of the file unless ticked
    sec.append(
      meta.preview && !meta.summary ? h('div', { class: 'import-summary' }, h('h3', null, t('data.moved')), h('p', null, previewText(meta.preview, t))) : null,
      meta.summary ? h('div', { class: 'import-summary' },
        h('h3', null, t('data.moved')),
        h('p', null, t('data.movedOn', { date: label(String(meta.migratedAt).slice(0, 10)) })),
        meta.preview ? h('p', null, previewText(meta.preview, t)) : null,
        h('p', null, summaryText(meta.summary, t, { afterPreview: !!meta.preview })),
        meta.summary.iglooCards ? h('p', { class: 'caption' }, t('data.iglooStays', { n: meta.summary.iglooCards })) : null,
        meta.summary.cardsSkipped ? h('p', { class: 'caption' }, t('data.skipped', { n: meta.summary.cardsSkipped })) : null) : null,
      Object.keys(store.get('scripts', {}) || {}).length ? switchRow({ label: t('data.includeScripts'), hint: t('data.includeScripts.hint'), checked: includeScripts, onChange: v => { includeScripts = v; } }) : null,
      h('div', { class: 'row-actions wrap' },
        h('button', { type: 'button', class: 'btn pressable', onclick: async () => {
          const archived = await store.archived().catch(() => []);   // the outbox archive (data/archive.js)
          const b = exportBundle(store, { profile: app.profile, includeScripts, archived });
          await shareFile(new Blob([JSON.stringify(b, null, 1)], { type: 'application/json' }), `fluentish-${ctx.clock.today()}.json`);
        } }, icon('download', { size: 18 }), t('data.export')),
        h('button', { type: 'button', class: 'btn pressable', onclick: () => fileIn.click() }, icon('upload', { size: 18 }), t('data.import')), fileIn,
        deleteBtn),
      h('p', { class: 'field-hint' }, t('data.hint')),
      result, confirm,
      backupBlock(ctx, () => swapSection(data())));
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
    sec.append(h('p', { class: 'field-hint' }, t('diag.safari')));
    const det = h('details', { class: 'diag-details' }, h('summary', null, t('diag.show')));
    sec.append(det);
    det.append(h('dl', { class: 'diag' },
      h('dt', null, t('diag.content')), h('dd', { class: 'mono' }, manifest ? manifest.version : t('diag.notLoaded')),
      h('dt', null, t('diag.storage')), storage,
      h('dt', null, t('diag.device')), h('dd', { class: 'mono' }, app.device.deviceId),
      h('dt', null, t('diag.events')), h('dd', null, t('diag.eventsVal', { n: store.pending().length })),
      h('dt', null, t('diag.errors')), h('dd', null, errs.length ? errs.slice(-3).map(e => h('span', { class: 'mono block' }, `${e.where}: ${e.message}`)) : t('diag.none'))));
    return sec;
  }

  render();
}
