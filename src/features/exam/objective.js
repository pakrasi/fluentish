/* Lesen and Hören: the timed runner and the review (UX 4.6, 4.7). Task text stays German as in the exam; the frame
   around it (back link, review summary, feedback heading) is English. While the clock runs there is no app chrome. */
import { h, replace } from '../../core/dom.js';
import { answerKey, grade, teilIds, answeredIn, weakSkills, byTeil, passes } from '../../domain/grade.js';
import { draft, saveDraft, submitAttempt, loadWhy, mediaUrl, feedbackFor, markSeen } from './data.js';
import { clockBar, backLink, option, num, confirmPanel } from './parts.js';
import { playerGroup, player, reviewAudio } from './player.js';
import { fmt } from './timer.js';
import { feedbackBlock, nextCard, reviewHead } from './review.js';

const SKILL_DE = /** @type {Record<string, string>} */ ({ detail: 'Detail', global: 'Hauptaussage', paraphrase: 'Umschreibung', negation: 'Negation',
  'number-time': 'Zahlen und Zeiten', attitude: 'Meinung', inference: 'Schlussfolgerung', matching: 'Zuordnung' });

/** Surname of "Dr. Eva Brandt (Ärztin)". @param {string} full */
const surname = full => full.split(' (')[0].trim().split(' ').pop() || full;

/**
 * Render the Teile of a module. answers: the draft (run) or the given answers (review).
 * @param {{ ex: any, module: 'lesen' | 'hoeren', n: number, answers: Record<string, any>, review: boolean, key: Record<string, any> | null,
 *           onPick: (id: string, v: string) => void, t: any, audio: (file: string, id: string, limit: number, o?: any) => any }} o
 */
function renderParts({ ex, module, answers, review, key, onPick, t, audio }) {
  const correct = (/** @type {string} */ id) => (key ? key[id] : null);
  const opt = (/** @type {string} */ id, /** @type {string} */ v, /** @type {any} */ label, /** @type {string} */ badge = '') =>
    option({ name: id, value: v, label, badge, answers, review, correct: correct(id), onPick: x => onPick(id, x), t });
  const rf = (/** @type {string} */ id, /** @type {number} */ nr, /** @type {string} */ text) => h('div', { class: 'ex-item', dataset: { item: id } },
    h('p', { class: 'ex-q' }, num(nr), text),
    h('div', { class: 'ex-opts ex-opts-2', role: 'radiogroup', 'aria-label': `${nr}` }, opt(id, 'r', t('exam.de.true')), opt(id, 'f', t('exam.de.false'))));
  const mc = (/** @type {any} */ it, /** @type {number} */ nr, /** @type {string} */ q) => h('div', { class: 'ex-item', dataset: { item: it.id } },
    h('p', { class: 'ex-q' }, num(nr), q),
    h('div', { class: 'ex-opts', role: 'radiogroup', 'aria-label': `${nr}` }, it.options.map((/** @type {string} */ o, /** @type {number} */ i) => opt(it.id, 'abc'[i], o, 'abc'[i]))));
  const instr = (/** @type {any[]} */ ...c) => h('p', { class: 'ex-instr' }, ...c);
  const textCard = (/** @type {any} */ x, /** @type {string | null} */ label = null) => h('article', { class: 'ex-text' },
    label ? h('p', { class: 'label' }, label) : null, x.title ? h('h3', null, x.title) : null, h('div', { class: 'ex-prose' }, String(x.text).split(/\n\n+/).map(p => h('p', null, p))));
  const parts = [];
  if (module === 'lesen') {
    const L = ex.lesen;
    parts.push(h('div', null, instr(t('exam.de.l1')), h('div', { class: 'ex-split' }, textCard(L.teil1, L.teil1.source), h('div', { class: 'ex-items' }, L.teil1.items.map((/** @type {any} */ it, /** @type {number} */ i) => rf(it.id, 1 + i, it.statement))))));
    parts.push(h('div', null, instr(t('exam.de.l2')), L.teil2.texts.map((/** @type {any} */ tx, /** @type {number} */ ti) => h('div', { class: 'ex-split' }, textCard(tx, tx.source),
      h('div', { class: 'ex-items' }, tx.items.map((/** @type {any} */ it, /** @type {number} */ i) => mc(it, 7 + ti * 3 + i, it.question)))))));
    const letters = ['0', ...L.teil3.ads.map((/** @type {any} */ a) => a.letter)];
    const sit = h('div', { class: 'ex-items', id: 'l3-sit' }, L.teil3.situations.map((/** @type {any} */ s, /** @type {number} */ i) => {
      const mine = String(answers[s.id] ?? '').toUpperCase();
      const right = review ? String(correct(s.id) || '0').toUpperCase() : null;
      return h('div', { class: 'ex-item', dataset: { item: s.id } }, h('p', { class: 'ex-q' }, num(13 + i), s.text),
        h('div', { class: 'ex-letters', role: 'radiogroup', 'aria-label': `${13 + i}` }, letters.map(l => {
          const on = mine === l;
          return h('button', { type: 'button', role: 'radio', 'aria-checked': String(on), disabled: review, class: ['ex-letter', on && 'is-on', review && l === right && 'is-right', review && on && l !== right && 'is-wrong'],
            onclick: (/** @type {Event} */ e) => {
              const g = /** @type {HTMLElement} */ (e.currentTarget).parentElement;
              g?.querySelectorAll('button').forEach(b => { b.setAttribute('aria-checked', String(b === e.currentTarget)); b.classList.toggle('is-on', b === e.currentTarget); });
              onPick(s.id, l);
            } }, l);
        })),
        review ? h('p', { class: ['ex-mark', mine === right ? 'is-right' : 'is-wrong'] }, mine === right ? t('exam.de.markRight') : t('exam.de.markWrong', { right })) : null);
    }));
    const ads = h('div', { class: 'ex-ads', id: 'l3-ads' }, L.teil3.ads.map((/** @type {any} */ a) => h('div', { class: 'ex-ad' }, h('p', { class: 'ex-ad-t' }, h('b', { class: 'ex-ad-l' }, a.letter), ' ', a.title), h('p', null, a.text))));
    parts.push(h('div', null, instr(t('exam.de.l3'), ' ', L.teil3.intro.replace(/Situationen 1\s*[–-]\s*7/, 'Situationen 13–19')),
      h('div', { class: 'ex-l3' }, sit, h('div', null, h('h3', { class: 'ex-sub' }, t('exam.de.ads')), ads))));
    parts.push(h('div', null, instr(t('exam.de.l4'), ' ', h('b', null, L.teil4.question)),
      h('div', { class: 'ex-items' }, L.teil4.comments.map((/** @type {any} */ c, /** @type {number} */ i) => h('div', { class: 'ex-item', dataset: { item: c.id } },
        h('p', { class: 'ex-q' }, num(20 + i), h('b', null, c.author)), h('p', { class: 'ex-prose ex-comment' }, c.text),
        h('div', { class: 'ex-opts ex-opts-2', role: 'radiogroup', 'aria-label': `${20 + i}` }, opt(c.id, 'ja', t('exam.de.yes')), opt(c.id, 'nein', t('exam.de.no'))))))));
    parts.push(h('div', null, instr(t('exam.de.l5')), h('div', { class: 'ex-split' }, textCard(L.teil5), h('div', { class: 'ex-items' }, L.teil5.items.map((/** @type {any} */ it, /** @type {number} */ i) => mc(it, 27 + i, it.question))))));
    return parts;
  }
  const H = ex.hoeren;
  const script = (/** @type {any[]} */ segs, /** @type {Record<string, string> | null} */ names = null) => (review && segs ? h('details', { class: 'ex-script' }, h('summary', null, t('exam.transcript')),
    segs.map(s => h('p', null, names && names[s.speaker] ? h('b', null, `${names[s.speaker]} `) : null, s.text))) : null);
  parts.push(h('div', null, instr(t('exam.de.h1')), H.teil1.texts.map((/** @type {any} */ tx, /** @type {number} */ i) => h('section', { class: 'ex-block' },
    h('p', { class: 'label' }, `Text ${i + 1} · ${tx.kind}`), audio(`h1-${i + 1}.mp3`, `h1-${i + 1}`, 2, { autoSecond: true }),
    rf(tx.items[0].id, 1 + i * 2, tx.items[0].statement), mc(tx.items[1], 2 + i * 2, tx.items[1].question), script(tx.script)))));
  parts.push(h('div', null, instr(t('exam.de.h2')), h('section', { class: 'ex-block' }, h('p', { class: 'caption' }, H.teil2.setting), audio('h2.mp3', 'h2', 1, { readSeconds: 60 }),
    H.teil2.items.map((/** @type {any} */ it, /** @type {number} */ i) => mc(it, 11 + i, it.question)), script(H.teil2.script))));
  parts.push(h('div', null, instr(t('exam.de.h3')), h('section', { class: 'ex-block' }, h('p', { class: 'caption' }, H.teil3.setting), audio('h3.mp3', 'h3', 1, { readSeconds: 30 }),
    H.teil3.items.map((/** @type {any} */ it, /** @type {number} */ i) => rf(it.id, 16 + i, it.statement)), script(H.teil3.script))));
  const sp = H.teil4.speakers;
  parts.push(h('div', null, instr(t('exam.de.h4')), h('section', { class: 'ex-block' }, h('p', { class: 'caption' }, H.teil4.setting),
    h('ul', { class: 'ex-speakers' }, ['mod', 'a', 'b'].map(k => h('li', null, sp[k]))), audio('h4.mp3', 'h4', 2, { autoSecond: true }),
    H.teil4.items.map((/** @type {any} */ it, /** @type {number} */ i) => h('div', { class: 'ex-item', dataset: { item: it.id } }, h('p', { class: 'ex-q' }, num(23 + i), it.statement),
      h('div', { class: 'ex-opts ex-opts-3', role: 'radiogroup', 'aria-label': `${23 + i}` }, ['mod', 'a', 'b'].map(k => opt(it.id, k, surname(sp[k])))))), script(H.teil4.script, sp))));
  return parts;
}

/** The "Warum?" explanation under each item of a review; open for the ones answered wrong. @param {HTMLElement} root @param {any} why @param {Set<string>} wrong @param {any} t */
function attachWhy(root, why, wrong, t) {
  root.querySelectorAll('[data-item]').forEach(node => {
    const el = /** @type {HTMLElement} */ (node);
    const w = why[el.dataset.item || ''];
    if (!w || el.querySelector('.ex-why')) return;
    if (w.question_en) el.querySelector('.ex-q')?.append(h('span', { class: 'ex-en', lang: 'en' }, w.question_en));
    const opts = el.querySelectorAll('.ex-opt .ex-opt-text');
    if (w.options_en && opts.length === w.options_en.length) opts.forEach((o, i) => o.append(h('span', { class: 'ex-en', lang: 'en' }, w.options_en[i])));
    el.append(h('details', { class: 'ex-why', open: wrong.has(el.dataset.item || '') },
      h('summary', { lang: 'de' }, t('exam.de.why')),
      w.evidence ? h('blockquote', null, `„${w.evidence}“`, w.evidence_en ? h('span', { class: 'ex-en', lang: 'en' }, w.evidence_en) : null) : null,
      h('p', null, w.why, w.why_en ? h('span', { class: 'ex-en', lang: 'en' }, w.why_en) : null),
      w.trap ? h('p', null, h('b', null, `${t('exam.de.trap')} `), w.trap, w.trap_en ? h('span', { class: 'ex-en', lang: 'en' }, w.trap_en) : null) : null));
  });
}

/**
 * The timed runner. Returns the view handle ({unmount}).
 * @param {HTMLElement} el @param {any} ctx @param {{ exam: any, n: number, module: 'lesen' | 'hoeren', ex: any, def: any }} o
 */
export function runObjective(el, ctx, { exam, n, module, ex, def }) {
  const { store, t } = ctx;
  document.body.dataset.chrome = 'off';
  const d = draft(store, n, module);
  /** @type {Record<string, any>} */ const answers = { ...(d?.answers || {}) };
  const ids = teilIds(ex, module);
  const all = ids.flat();
  const names = ids.map((_, i) => `Teil ${i + 1}`);
  let active = Math.min(d?.tab || 0, ids.length - 1);
  let busy = false;
  const tabs = h('div', { class: 'ex-tabs', role: 'tablist', 'aria-label': 'Teile', lang: 'de' });
  const body = h('div', { id: 'ex-panel', role: 'tabpanel' });
  const nav = h('div', { class: 'ex-nav' });
  const cover = h('div', { class: 'ex-cover', hidden: true });
  const over = h('p', { class: 'ex-over', hidden: true, role: 'status' });
  const confirmSlot = h('div');
  const group = playerGroup(b => { busy = b; drawTabs(); drawNav(); });
  const audio = (/** @type {string} */ file, /** @type {string} */ id, /** @type {number} */ limit, /** @type {any} */ o = {}) =>
    player({ group, store, n, id, url: mediaUrl(exam, n, file), limit, ...o, t, toast: ctx.toast });
  const onPick = (/** @type {string} */ id, /** @type {string} */ v) => { answers[id] = v; saveDraft(store, n, module, { answers: { ...answers } }); drawTabs(); drawNav(); };
  const parts = renderParts({ ex, module, n, answers, review: false, key: null, onPick, t, audio });
  const clock = clockBar({
    ctx, n, module, minutes: def.minutes, countUp: module === 'hoeren',
    onChange: (p, leftMs) => {
      cover.hidden = !p;
      body.hidden = p;
      if (p) replace(cover, h('div', { class: 'ex-cover-card' }, h('h2', { lang: 'de' }, t('exam.de.paused')),
        h('p', { class: 'caption tnum', lang: 'de' }, module === 'hoeren' ? t('exam.de.used', { t: fmt(clock ? clock.elapsed() / 1000 : 0) }) : leftMs > 0 ? t('exam.de.left', { t: fmt(leftMs / 1000) }) : t('exam.de.timeUp')),
        h('button', { type: 'button', class: 'btn btn-primary pressable', lang: 'de', onclick: () => clock.resume() }, t('exam.de.continue'))));
      if (module !== 'hoeren' && leftMs < 0) { over.hidden = false; over.textContent = t('exam.de.overtime', { t: fmt(-leftMs / 1000) }); }
    },
  });
  const drawTabs = () => replace(tabs, names.map((nm, j) => h('button', {
    type: 'button', role: 'tab', id: `ex-tab-${j}`, 'aria-controls': 'ex-panel', 'aria-selected': String(j === active), disabled: busy && j !== active,
    class: ['ex-tab pressable', answeredIn(ids[j], answers) === ids[j].length && 'is-full'], onclick: () => show(j),
  }, nm, h('span', { class: 'ex-tab-n tnum' }, `${answeredIn(ids[j], answers)}/${ids[j].length}`))));
  const drawNav = () => replace(nav,
    active > 0 ? h('button', { type: 'button', class: 'btn pressable', lang: 'de', disabled: busy, onclick: () => show(active - 1) }, t('exam.de.back')) : null,
    active < parts.length - 1 ? h('button', { type: 'button', class: 'btn pressable', lang: 'de', disabled: busy, onclick: () => show(active + 1) }, t('exam.de.next')) : null,
    h('span', { class: 'ex-nav-grow caption tnum', lang: 'de' }, t('exam.de.answered', { n: answeredIn(all, answers), of: all.length })),
    h('button', { type: 'button', class: ['btn pressable', active === parts.length - 1 && 'btn-primary'], lang: 'de', disabled: busy, onclick: askSubmit }, t('exam.de.submit')));
  const show = (/** @type {number} */ i) => {
    active = i;
    saveDraft(store, n, module, { tab: i });
    drawTabs(); drawNav();
    replace(body, parts[i]);
    body.setAttribute('aria-labelledby', `ex-tab-${i}`);
    scrollTo({ top: 0 });
  };
  let submitting = false;
  function askSubmit() {
    if (busy) return;
    const leftMs = clock.left();
    replace(confirmSlot, confirmPanel({
      lang: 'de',
      title: t('exam.de.submitQ', { module: def.name }),
      lines: [t('exam.de.answered', { n: answeredIn(all, answers), of: all.length }), names.map((nm, j) => `${nm}: ${answeredIn(ids[j], answers)}/${ids[j].length}`).join(' · '),
        module === 'hoeren' ? '' : leftMs > 0 ? t('exam.de.left', { t: fmt(leftMs / 1000) }) : t('exam.de.timeUp'), t('exam.de.final')].filter(Boolean),
      yes: t('exam.de.submit'), no: t('exam.de.keepGoing'),
      onNo: () => replace(confirmSlot),
      onYes: async () => {
        if (submitting) return;
        submitting = true;
        try {
          const g = grade(answerKey(ex), module, answers);
          const c = clock.clock;
          const rec = await submitAttempt(ctx, { exam, n, module, clock: c, score: g.score, maxScore: g.max_score, responses: g.results, meta: {} });
          // the clock stops only once the attempt is stored: a failed submit leaves it running and paused on leave
          clock.stop(false);
          group.stop();
          ctx.go(`/exam/${n}/${module}/review/${rec.id}`, { replace: true });
        } catch (e) {
          submitting = false;
          console.error(e);
          ctx.toast(t('exam.submitFailed'));
        }
      },
    }));
    confirmSlot.scrollIntoView({ block: 'nearest' });
  }
  const head = h('header', { class: 'ex-runhead' },
    backLink(`#/exam/${n}`, t('exam.backTest', { n })),
    h('div', { class: 'ex-runhead-end' }, clock.el, h('button', { type: 'button', class: 'btn btn-primary pressable ex-submit-top', lang: 'de', onclick: askSubmit }, t('exam.de.submit'))));
  replace(el, h('div', { class: 'ex-run', lang: 'de' },
    head, over,
    h('h1', { class: 'ex-run-title' }, def.name, h('span', { class: 'caption' }, ` · ${ex.topic}`)),
    tabs, cover, body, nav, confirmSlot));
  show(active);
  return {
    unmount() { clock.stop(true); group.stop(); document.body.dataset.chrome = 'on'; },
  };
}

/**
 * The review of a submitted Lesen/Hören attempt.
 * @param {HTMLElement} el @param {any} ctx @param {{ exam: any, n: number, module: 'lesen' | 'hoeren', ex: any, def: any, attempt: any, focusItem?: string | null }} o
 */
export async function reviewObjective(el, ctx, { exam, n, module, ex, def, attempt, focusItem = null }) {
  const { store, t } = ctx;
  /** @type {Record<string, any>} */ const answers = {}, key = {};
  for (const r of attempt.responses || []) { answers[r.item_id] = r.given; key[r.item_id] = r.correct; }
  const audio = (/** @type {string} */ file) => reviewAudio(mediaUrl(exam, n, file));
  const parts = renderParts({ ex, module, n, answers, review: true, key, onPick: () => {}, t, audio });
  const why = await loadWhy(ctx, exam, n);
  const wrong = new Set((attempt.responses || []).filter((/** @type {any} */ r) => !r.is_correct).map((/** @type {any} */ r) => r.item_id));
  const holder = h('div', null, parts);
  attachWhy(holder, why, wrong, t);
  const ids = teilIds(ex, module);
  const bt = byTeil(attempt.responses || []);
  const prefix = module === 'lesen' ? 'L' : 'H';
  let active = Math.max(0, focusItem ? ids.findIndex(xs => xs.includes(focusItem)) : 0);
  const tabs = h('div', { class: 'ex-tabs', role: 'tablist', 'aria-label': 'Teile', lang: 'de' });
  const body = h('div', { id: 'ex-panel', role: 'tabpanel' });
  const show = (/** @type {number} */ i) => {
    active = i;
    replace(tabs, ids.map((_, j) => {
      const x = bt[`${prefix}${j + 1}`];
      return h('button', { type: 'button', role: 'tab', id: `ex-tab-${j}`, 'aria-controls': 'ex-panel', 'aria-selected': String(j === active), class: 'ex-tab pressable', onclick: () => show(j) },
        `Teil ${j + 1}`, x ? h('span', { class: 'ex-tab-n tnum' }, `${x[0]}/${x[1]}`) : null);
    }));
    replace(body, parts[i]);
    body.setAttribute('aria-labelledby', `ex-tab-${i}`);
  };
  const weak = weakSkills(attempt.responses || []);
  const fb = feedbackFor(store, exam.id, attempt);
  markSeen(store, fb.cur.filter(f => !f.seen).map(f => f.id));
  replace(el, h('div', { class: 'ex-review' },
    reviewHead({ ctx, n, def, attempt, score: attempt.score, max: attempt.max_score, pass: passes(attempt.score, attempt.max_score), topic: ex.topic }),
    h('p', { class: 'caption ex-skills', lang: 'de' }, weak.length ? `${t('exam.de.bySkill')} ${weak.map(([k, v]) => `${SKILL_DE[k] || k} ${v[0]}/${v[1]}`).join(' · ')}` : t('exam.de.allRight')),
    feedbackBlock({ ctx, exam, attempt, fb }),
    h('p', { class: 'caption' }, module === 'hoeren' ? t('exam.review.hoerenHint') : t('exam.review.lesenHint')),
    tabs, body,
    await nextCard(ctx, exam, n)));
  show(Math.min(active, parts.length - 1));
  if (focusItem) setTimeout(() => {
    const it = /** @type {HTMLElement | null} */ (body.querySelector(`[data-item="${CSS.escape(focusItem)}"]`));
    if (it) { it.querySelector('details')?.setAttribute('open', ''); it.scrollIntoView({ block: 'center' }); it.classList.add('is-flash'); }
  }, 80);
  return () => {};
}

