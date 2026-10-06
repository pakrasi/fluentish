/* Profile: the one settings page, opened from the avatar (UX §4.11).
   Courses (one per language; the active one is what Today and Practice are about) · Goals and week of the active
   course (its own page, #/profile/goal and #/profile/week: profile/goals.js; the exam date's single source) ·
   Practice · Connections (Claude key, results sync device link) · Appearance (theme, motion) · Data (export, import,
   the import summary, delete) · Diagnostics. #/profile/<section> scrolls to that section. */
import { h, replace } from '../../core/dom.js';
import { shareFile } from '../../services/share.js';
import { label } from '../../core/clock.js';
import { config } from '../../core/config.js';
import { icon } from '../../core/icons.js';
import { section, seg, field, switchRow, notice, avatar, nextId, linkRow } from '../../core/ui.js';
import { entries as logEntries } from '../../core/log.js';
import { setSetting, setActiveCourse, addCourse, langCode, examDate, defaultPrefs } from '../../data/settings.js';
import { summaryText } from '../../data/migrate.js';
import { previewText } from '../../data/cutover.js';
import { exportBundle, importFile } from '../../data/transfer.js';
import { deleteProfile } from '../../data/session.js';
import { results } from '../../data/sync/index.js';
import { connectionState, resultsRepo, validRepo, connect, disconnectDevice, forgetRepo, CHECK_KV } from '../../data/connection.js';
import { checkToken, keepCheck, lastCheck, recheck } from '../../data/sync/token-check.js';
import { backupBlock } from './backup.js';
import { goalsPage } from './goals.js';
import { courseWeek, weekMinutes } from '../../domain/week.js';
import { courseGoal } from '../../domain/levels.js';
import { summary as progressSummary } from '../../data/progress.js';
import { activeCourse } from '../../data/settings.js';
import { newPerDayChosen, buildShare, steadyFor } from '../../domain/budget.js';
import * as Conv from '../../domain/conversation.js';

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

  function render() {
    // Goals and week is its own page (#/profile/goal, #/profile/week scrolls to the week plan)
    if (ctx.params.rest === 'goal' || ctx.params.rest === 'week') {
      replace(el, goalsPage(ctx, { exams, languages, render }));
      if (ctx.params.rest === 'week') requestAnimationFrame(() => document.getElementById('profile-week')?.scrollIntoView({ block: 'start' }));
      return;
    }
    const s = ctx.settings();
    const page = h('div', { class: 'profile stack' },
      h('header', { class: 'profile-head' },
        avatar(app.profile, ''),
        h('div', null, h('h1', null, t('profile.title')), h('p', { class: 'caption' }, goalLine(s)))),
      nameField(),
      courses(s), goalRow(s), practice(s), connections(), appearance(), data(), diagnostics());
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

  /* ---------- goals and week: a row to its own page ---------- */
  /** @param {any} s */
  function goalRow(s) {
    const sec = section(t('profile.goal'));
    sec.id = 'profile-goals';
    const g = courseGoal(s), week = courseWeek(s);
    const exam = s.exam.type ? (exams.find((/** @type {any} */ x) => x.id === s.exam.type)?.short || (s.exam.type === 'other' ? t('goal.exam.other') : t(`goals.exam.short.${s.exam.type}`))) : null;
    const date = examDate(s);
    const detail = [g.goal ? t('goals.level.what', { level: g.goal }) : null, exam ? (date ? `${exam} ${label(date)}` : exam) : null,
      week ? t('goals.time.week', { t: fmtWeek(weekMinutes(week)) }) : t('goals.time.day', { t: t('unit.min', { n: s.minutesPerDay }) })].filter(Boolean).join(' · ');
    sec.append(h('ul', { class: 'list' }, h('li', null, linkRow({ href: '#/profile/goal', title: t('goals.row'), detail }))));
    return sec;
  }
  /** @param {number} n */
  const fmtWeek = n => (n < 60 ? t('unit.min', { n }) : n % 60 ? t('unit.hm', { h: Math.floor(n / 60), m: String(n % 60).padStart(2, '0') }) : t('unit.h', { h: n / 60 }));

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
      h('p', { class: 'field-hint' }, t('practice.newPerDay.hint')),
      // the sustainable rate next to the number (a chosen number is never capped by it)
      h('p', { class: 'field-hint', id: 'profile-steady' }, t('practice.newPerDay.steady', { n: steadyFor(s) })));
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
      switchRow({ label: t('practice.simpleInput'), hint: t('practice.simpleInput.hint'), checked: s.practice.simpleInput, onChange: v => write('practice.simpleInput', v) }),
      conversation(s));
    return sec;
  }

  /** Conversation practice (round 4, lane L4): his interests for topic suggestions, and the monthly limit. @param {any} s */
  function conversation(s) {
    const cv = s.conversation || {};
    const interests = Array.isArray(cv.interests) ? cv.interests : [];
    const cap = Number.isFinite(cv.monthlyCapUsd) && cv.monthlyCapUsd > 0 ? cv.monthlyCapUsd : Conv.MONTHLY_CAP;
    const input = /** @type {HTMLInputElement} */ (h('input', { class: 'input', id: 'profile-interests', autocomplete: 'off', value: interests.join(', '), maxlength: '400',
      onchange: () => { const next = Conv.parseInterests(input.value); write('conversation.interests', next); input.value = next.join(', '); } }));
    const opts = [...new Set([...Conv.CAP_OPTIONS, cap])].sort((a, b) => a - b);
    return h('div', { class: 'stack', id: 'profile-conversation' },
      h('h3', null, t('conv.profile')),
      field({ label: t('conv.profile.interests'), input, hint: t('conv.profile.interests.hint') }),
      h('div', { class: 'form-field' }, h('p', { class: 'field-label' }, t('conv.profile.cap')),
        seg({ label: t('conv.profile.cap'), value: String(cap), options: opts.map(n => /** @type {[string, string]} */ ([String(n), `$${n}`])), onChange: v => write('conversation.monthlyCapUsd', Number(v)) }),
        h('p', { class: 'field-hint' }, t('conv.profile.cap.hint'))));
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

    sec.append(keyBox, syncBox(), h('p', { class: 'caption' }, t('conn.device')));
    return sec;
  }

  /* ---------- results sync: the profile's own repository and this device's token (data/connection.js) ---------- */
  function syncBox() {
    const a = appCtx();
    const state = connectionState(store);
    const repo = resultsRepo(store);
    const redraw = () => swapSection(connections());
    // connecting or disconnecting changes Data too (the backup block): the whole page is drawn again, focus on this box
    const redrawAll = () => { render(); /** @type {HTMLElement | null} */ (document.querySelector('#profile-sync button, #profile-sync summary'))?.focus({ preventScroll: true }); };
    const status = h('p', { class: 'caption status', 'aria-live': 'polite' });
    const err = (/** @type {any} */ f, /** @type {string} */ key, /** @type {Record<string, any>} */ p = {}) => { f.setError(t(key, p)); };

    // the token field (never shows a token: a password field, emptied after use, nothing saved goes back into it)
    const tokIn = /** @type {HTMLInputElement} */ (h('input', { class: 'input', type: 'password', name: 'gh-token', autocomplete: 'off', spellcheck: 'false', placeholder: 'github_pat_…' }));
    const tokField = field({ label: t('conn.token'), input: tokIn, hint: h('span', null, t('conn.token.hintOwn'), ' ', h('a', { href: config.github.newTokenUrl, target: '_blank', rel: 'noopener noreferrer' }, t('conn.token.create'))) });
    const repoIn = /** @type {HTMLInputElement} */ (h('input', { class: 'input', type: 'text', name: 'gh-repo', value: repo || '', placeholder: 'owner/name', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' }));
    const repoField = field({ label: t('conn.repo'), input: repoIn, hint: t('conn.repo.hint') });

    /** Check the token with GitHub, then keep both. @param {HTMLElement} btn */
    const connectNow = async btn => {
      const r = state === 'none' ? repoIn.value.trim() : /** @type {string} */ (repo);
      const tok = tokIn.value.trim();
      if (!validRepo(r)) { err(repoField, 'conn.repo.bad'); return; }
      if (!tok) { err(tokField, 'conn.token.empty'); return; }
      btn.setAttribute('disabled', '');
      status.textContent = t('conn.sync.checking');
      const c = await checkToken({ token: tok, repo: r, api: config.github.api });
      btn.removeAttribute('disabled');
      if (c.status !== 'ok') { tokIn.value = ''; status.textContent = ''; err(tokField, `conn.check.${c.status}`, { repo: r }); return; }
      connect(a, r, tok);
      tokIn.value = '';
      await keepCheck(store, tok, c, ctx.clock.today());
      ctx.toast(t('conn.sync.savedToast'));
      redrawAll();
      bus.emit('sync:request', { force: true });
    };

    /** @type {any[]} */ const parts = [h('h3', null, t('conn.sync'))];
    if (state === 'none') {
      status.textContent = t('conn.sync.none');
      const btn = h('button', { type: 'button', class: 'btn pressable', onclick: () => connectNow(btn) }, t('conn.connect'));
      parts.push(status, h('p', { class: 'field-hint' }, t('conn.sync.aboutNone')),
        h('details', { class: 'conn-setup' }, h('summary', null, t('conn.setup')), repoField, tokField, h('div', { class: 'row-actions' }, btn)));
      return h('div', { class: 'conn', id: 'profile-sync' }, parts);
    }

    const c = lastCheck(store);
    const lines = [];
    if (state === 'connected') {
      lines.push(t('conn.sync.connected', { repo }));
      if (c && c.status === 'ok') lines.push(c.expires ? t('conn.sync.expires', { date: c.expires }) : '');
      if (c && c.status === 'denied') lines.push(t('conn.check.deniedNow', { repo }));
    } else {
      lines.push(t('conn.sync.deviceOff', { repo }));
      if (c && c.status === 'refused') lines.push(t('conn.check.removed'));
    }
    status.textContent = lines.filter(Boolean).join(' ');
    const warnings = state === 'connected' && c && c.status === 'ok' ? c.warnings.map(w => h('p', { class: 'field-error conn-warn' }, t(`conn.warn.${w}`, { repo }))) : [];

    const check = h('button', { type: 'button', class: 'btn btn-quiet pressable', onclick: async () => {
      check.setAttribute('disabled', '');
      status.textContent = t('conn.sync.checking');
      const r = await recheck(store, { api: config.github.api, today: ctx.clock.today(), force: true }).catch(() => null);
      if (r?.status === 'refused') ctx.toast(t('conn.check.removedToast'));
      else if (r?.status === 'offline') ctx.toast(t('conn.sync.offline'));
      redraw();
    } }, t('conn.check'));
    const tokenForm = h('div', { class: 'conn-token', hidden: state === 'connected' }, tokField,
      h('div', { class: 'row-actions' }, h('button', { type: 'button', class: 'btn pressable', onclick: (/** @type {Event} */ e) => connectNow(/** @type {HTMLElement} */ (e.currentTarget)) }, state === 'connected' ? t('conn.replaceSave') : t('conn.connectDevice'))));
    const replaceBtn = h('button', { type: 'button', class: 'btn btn-quiet pressable', 'aria-expanded': 'false', onclick: () => {
      tokenForm.hidden = false; replaceBtn.hidden = true; replaceBtn.setAttribute('aria-expanded', 'true'); tokIn.focus();
    } }, t('conn.replace'));
    const confirmBox = h('div', { class: 'confirm', hidden: true, role: 'alertdialog', 'aria-modal': 'false', 'aria-labelledby': 'disc-q' },
      h('p', { id: 'disc-q' }, t('conn.disconnect.confirm', { repo })),
      h('div', { class: 'row-actions' },
        h('button', { type: 'button', class: 'btn btn-danger pressable', onclick: () => { disconnectDevice(store); ctx.toast(t('conn.disconnect.done')); redrawAll(); } }, t('conn.disconnect.yes')),
        h('button', { type: 'button', class: 'btn btn-quiet pressable', onclick: () => { confirmBox.hidden = true; disc.setAttribute('aria-expanded', 'false'); disc.focus(); } }, t('data.delete.no'))));
    const disc = h('button', { type: 'button', class: 'btn btn-quiet danger pressable', 'aria-expanded': 'false', onclick: () => {
      confirmBox.hidden = false; disc.setAttribute('aria-expanded', 'true');
      /** @type {HTMLElement | null} */ (confirmBox.querySelector('button'))?.focus();
    } }, t('conn.disconnect'));
    const forget = h('button', { type: 'button', class: 'btn btn-quiet pressable', onclick: () => { forgetRepo(a); ctx.toast(t('conn.forget.done')); redrawAll(); } }, t('conn.forget'));
    const pending = results(store).notSent();   // results-sync events only, the same count as the Exam tab
    parts.push(
      h('p', { class: 'field-hint' }, t('conn.sync.about')),
      status, ...warnings,
      tokenForm,
      h('div', { class: 'row-actions wrap' }, state === 'connected' ? [check, replaceBtn, disc] : [forget]),
      confirmBox,
      state === 'connected' ? h('p', { class: 'caption' }, pending ? t('conn.sync.pending', { n: pending }) : t('conn.sync.nonePending')) : null,
      h('p', { class: 'caption' }, t('conn.lost'), ' ', h('a', { href: config.github.tokensUrl, target: '_blank', rel: 'noopener noreferrer' }, t('conn.lost.link'))));
    return h('div', { class: 'conn', id: 'profile-sync' }, parts);
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
    let includeReads = false;     // so are reading texts (practice-read, round 4)
    // DOM append writes a null as the text "null": the optional parts are left out instead
    sec.append(...[
      meta.preview && !meta.summary ? h('div', { class: 'import-summary' }, h('h3', null, t('data.moved')), h('p', null, previewText(meta.preview, t))) : null,
      meta.summary ? h('div', { class: 'import-summary' },
        h('h3', null, t('data.moved')),
        h('p', null, t('data.movedOn', { date: label(String(meta.migratedAt).slice(0, 10)) })),
        meta.preview ? h('p', null, previewText(meta.preview, t)) : null,
        h('p', null, summaryText(meta.summary, t, { afterPreview: !!meta.preview })),
        meta.summary.iglooCards ? h('p', { class: 'caption' }, t('data.iglooStays', { n: meta.summary.iglooCards })) : null,
        meta.summary.cardsSkipped ? h('p', { class: 'caption' }, t('data.skipped', { n: meta.summary.cardsSkipped })) : null) : null,
      Object.keys(store.get('scripts', {}) || {}).length ? switchRow({ label: t('data.includeScripts'), hint: t('data.includeScripts.hint'), checked: includeScripts, onChange: v => { includeScripts = v; } }) : null,
      Object.keys(store.get('reads', {}) || {}).length ? switchRow({ label: t('read.export'), hint: t('read.export.hint'), checked: includeReads, onChange: v => { includeReads = v; } }) : null,
      h('div', { class: 'row-actions wrap' },
        h('button', { type: 'button', class: 'btn pressable', onclick: async () => {
          const archived = await store.archived().catch(() => []);   // the outbox archive (data/archive.js)
          const b = exportBundle(store, { profile: app.profile, includeScripts, includeReads, archived });
          await shareFile(new Blob([JSON.stringify(b, null, 1)], { type: 'application/json' }), `fluentish-${ctx.clock.today()}.json`);
        } }, icon('download', { size: 18 }), t('data.export')),
        h('button', { type: 'button', class: 'btn pressable', onclick: () => fileIn.click() }, icon('upload', { size: 18 }), t('data.import')), fileIn,
        deleteBtn),
      h('p', { class: 'field-hint' }, t('data.hint')),
      result, confirm,
      // a local-only profile (no results repository): where its progress lives and how to keep it; no backup block
      connectionState(store) === 'none' ? localBlock() : backupBlock(ctx, () => swapSection(data()))].filter(x => x != null));
    return sec;
  }

  /** Profile › Data for a profile without a repository: progress stays in this browser; export to keep a copy. */
  function localBlock() {
    return h('div', { class: 'conn local-data', id: 'profile-local' },
      h('h3', null, t('local.title')),
      h('p', null, t('local.here')),
      h('p', null, t('local.export')),
      h('p', { class: 'caption' }, t('local.accounts')));
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
    const log = progressSummary(store, activeCourse(store.get('settings'))?.id || null);
    sec.append(h('p', { class: 'field-hint' }, t('diag.safari')));
    const det = h('details', { class: 'diag-details' }, h('summary', null, t('diag.show')));
    sec.append(det);
    det.append(h('dl', { class: 'diag' },
      h('dt', null, t('diag.content')), h('dd', { class: 'mono' }, manifest ? manifest.version : t('diag.notLoaded')),
      h('dt', null, t('diag.storage')), storage,
      h('dt', null, t('diag.device')), h('dd', { class: 'mono' }, app.device.deviceId),
      h('dt', null, t('diag.events')), h('dd', null, t('diag.eventsVal', { n: store.pending().length })),
      h('dt', null, t('diag.progress')), h('dd', null, t('diag.progressVal', { n: log.days, m: log.estimated })),
      h('dt', null, t('diag.errors')), h('dd', null, errs.length ? errs.slice(-3).map(e => h('span', { class: 'mono block' }, `${e.where}: ${e.message}`)) : t('diag.none'))));
    return sec;
  }

  render();
  // the start's token check (main.js) may finish after this page is drawn: its expiry and warnings show when it does
  const off = store.subscribe(CHECK_KV, () => { if (document.getElementById('profile-sync')) swapSection(connections()); });
  return { unmount: off };
}
