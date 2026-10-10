/* Objective modules (Goethe B1: Lesen and Hören): the timed runner and the review (UX 4.6, 4.7), drawn from the exam
   definition (exam-def@1): its parts, their layouts, item types, numbering, recordings with play limits, reading
   times and replays. Task text and the runner's strings are in the exam's language (exam.tx, the exam-locale); the
   frame around it (back link, review summary, feedback heading) is English. While the clock runs there is no app
   chrome. */
import { h, replace } from '../../core/dom.js';
import { answerKey, grade, teilIds, answeredIn, weakSkills, byTeil, passes } from '../../domain/grade.js';
import { at, fill, groupsOf, partItems, valuesOf } from '../../domain/examdef.js';
import { draft, saveDraft, submitAttempt, loadWhy, mediaUrl, feedbackFor, markSeen, sectionOf } from './data.js';
import { clockBar, backLink, option, num, confirmPanel, arrowKeys } from './parts.js';
import { playerGroup, player, reviewAudio } from './player.js';
import { fmt } from './timer.js';
import { feedbackBlock, nextCard, reviewHead } from './review.js';
import { langAttr, dirAttr } from '../../core/lang.js';

/** Surname of "Dr. Eva Brandt (Ärztin)". @param {string} full */
const surname = full => full.split(' (')[0].trim().split(' ').pop() || full;

/**
 * Render the parts of a module. answers: the draft (run) or the given answers (review).
 * @param {{ exam: any, ex: any, module: string, answers: Record<string, any>, review: boolean, key: Record<string, any> | null,
 *           onPick: (id: string, v: string) => void, t: any, tx: import('./locale.js').ExamT,
 *           audio: (file: string, id: string, limit: number, o?: any) => any }} o
 */
function renderParts({ exam, ex, module, answers, review, key, onPick, t, tx, audio }) {
  const def = exam.def;
  const sec = sectionOf(exam, module);
  const correct = (/** @type {string} */ id) => (key ? key[id] : null);
  const opt = (/** @type {string} */ id, /** @type {string} */ v, /** @type {any} */ label, /** @type {string} */ badge = '') =>
    option({ name: id, value: v, label, badge, answers, review, correct: correct(id), onPick: x => onPick(id, x), t: tx });
  const instr = (/** @type {any[]} */ ...c) => h('p', { class: 'ex-instr' }, ...c);
  const textCard = (/** @type {any} */ x, /** @type {string | null} */ label = null) => h('article', { class: 'ex-text', tabindex: '0' },   // it scrolls by itself on a wide screen, so it takes focus
    label ? h('p', { class: 'label' }, label) : null, x.title ? h('h3', null, x.title) : null, h('div', { class: 'ex-prose' }, String(x.text).split(/\n\n+/).map(p => h('p', null, p))));
  const script = (/** @type {any[]} */ segs, /** @type {Record<string, string> | null} */ names = null) => (review && segs ? h('details', { class: 'ex-script' }, h('summary', null, t('exam.transcript')),
    segs.map(s => h('p', null, names && names[s.speaker] ? h('b', null, `${names[s.speaker]} `) : null, s.text))) : null);

  /** The answer options of one item, as its type offers them. @param {import('../../domain/examdef.js').ExamItem} it */
  const options = it => {
    const ty = def.itemTypes[it.type];
    const vals = valuesOf(def, it);
    if (ty.options === 'stack') {
      return h('div', { class: 'ex-opts', role: 'radiogroup', 'aria-label': `${it.nr}` }, it.item.options.map((/** @type {string} */ o, /** @type {number} */ i) => opt(it.id, vals[i], o, ty.badge ? vals[i] : '')));
    }
    const sp = it.part.speakers ? at(it.group, it.part.speakers) || {} : {};
    const labels = ty.labels === 'speakers' ? vals.map(k => surname(sp[k])) : (ty.labels || []).map((/** @type {string} */ k) => tx(k));
    return h('div', { class: `ex-opts ex-opts-${vals.length}`, role: 'radiogroup', 'aria-label': `${it.nr}` }, vals.map((v, i) => opt(it.id, v, labels[i])));
  };
  /** One item: its number and text (or a bold head over prose), then its options. @param {import('../../domain/examdef.js').ExamItem} it */
  const item = it => {
    const show = it.part.show;
    return h('div', { class: 'ex-item', dataset: { item: it.id } },
      ...(show
        ? [h('p', { class: 'ex-q' }, num(it.nr), h('b', null, it.item[show.bold])), h('p', { class: 'ex-prose ex-comment' }, it.item[show.prose])]
        : [h('p', { class: 'ex-q' }, num(it.nr), fill(def.itemTypes[it.type].text, it.item))]),
      options(it));
  };
  /** A matching part: the situations with letter buttons beside the list to choose from. @param {any} part @param {import('../../domain/examdef.js').ExamItem[]} items */
  const matching = (part, items) => {
    const g = items[0]?.group ?? groupsOf(ex, part)[0];
    const none = def.itemTypes[part.type]?.key?.none ?? '';
    const tag = part.id.toLowerCase();
    const sit = h('div', { class: 'ex-items', id: `${tag}-sit`, tabindex: '0' }, items.map(it => {
      const letters = valuesOf(def, it);
      const mine = String(answers[it.id] ?? '').toUpperCase();
      const right = review ? String(correct(it.id) || none).toUpperCase() : null;
      return h('div', { class: 'ex-item', dataset: { item: it.id } }, h('p', { class: 'ex-q' }, num(it.nr), fill(def.itemTypes[it.type].text, it.item)),
        h('div', { class: 'ex-letters', role: 'radiogroup', 'aria-label': `${it.nr}`, ref: (/** @type {HTMLElement} */ el) => queueMicrotask(() => arrowKeys(el)) }, letters.map(l => {
          const on = mine === l;
          return h('button', { type: 'button', role: 'radio', 'aria-checked': String(on), disabled: review, class: ['ex-letter', on && 'is-on', review && l === right && 'is-right', review && on && l !== right && 'is-wrong'],
            onclick: (/** @type {Event} */ e) => {
              const grp = /** @type {HTMLElement} */ (e.currentTarget).parentElement;
              grp?.querySelectorAll('button').forEach(b => { b.setAttribute('aria-checked', String(b === e.currentTarget)); b.classList.toggle('is-on', b === e.currentTarget); });
              onPick(it.id, l);
            } }, l);
        })),
        review ? h('p', { class: ['ex-mark', mine === right ? 'is-right' : 'is-wrong'] }, mine === right ? tx('markRight') : tx('markWrong', { right })) : null);
    }));
    const ch = part.choices;
    const list = h('div', { class: 'ex-ads', id: `${tag}-ads` }, (at(g, ch.from) || []).map((/** @type {any} */ a) => h('div', { class: 'ex-ad' }, h('p', { class: 'ex-ad-t' }, h('b', { class: 'ex-ad-l' }, a[ch.value]), ' ', a[ch.title]), h('p', null, a[ch.text]))));
    let intro = String(at(g, part.intro?.from) ?? '');
    if (part.intro?.renumber && items.length) intro = intro.replace(new RegExp(`${part.intro.renumber} 1\\s*[–-]\\s*${items.length}`), `${part.intro.renumber} ${items[0].nr}–${items[items.length - 1].nr}`);
    return h('div', null, instr(tx(part.instruction), ' ', intro), h('div', { class: 'ex-l3' }, sit, h('div', null, h('h2', { class: 'ex-sub' }, tx(ch.heading)), list)));
  };

  return sec.parts.map((/** @type {any} */ part) => {
    const items = partItems(def, ex, sec, part);
    const groups = groupsOf(ex, part);
    const of = (/** @type {number} */ gi) => items.filter(it => it.gi === gi).map(item);
    if (part.layout === 'match') return matching(part, items);
    if (part.layout === 'list') return h('div', null, instr(tx(part.instruction), ' ', h('b', null, at(groups[0], part.lead))), h('div', { class: 'ex-items' }, of(0)));
    if (part.layout === 'split') {
      return h('div', null, instr(tx(part.instruction)), groups.map((g, gi) => h('div', { class: 'ex-split' }, textCard(g, part.textLabel ? g[part.textLabel] : null), h('div', { class: 'ex-items' }, of(gi)))));
    }
    // block: a recording with its items (and in the review its transcript)
    return h('div', null, instr(tx(part.instruction)), groups.map((g, gi) => {
      const sp = part.speakers ? at(g, part.speakers) : null;
      const a = part.audio;
      const vars = { i: gi + 1 };
      return h('section', { class: 'ex-block' },
        part.groupLabel ? h('p', { class: 'label' }, tx(part.groupLabel, { i: gi + 1, kind: g.kind })) : null,
        part.caption ? h('p', { class: 'caption' }, g[part.caption]) : null,
        sp ? h('ul', { class: 'ex-speakers' }, (def.itemTypes[part.type]?.key?.values || Object.keys(sp)).map((/** @type {string} */ k) => h('li', null, sp[k]))) : null,
        a ? audio(fill(a.file, vars), fill(a.id, vars), a.plays, { ...(a.readSeconds ? { readSeconds: a.readSeconds } : {}), ...(a.replayAfter ? { replayAfter: a.replayAfter } : {}) }) : null,
        of(gi), script(part.script ? g[part.script] : null, sp));
    }));
  });
}

/** The "Warum?" explanation under each item of a review; open for the ones answered wrong. @param {HTMLElement} root @param {any} why @param {Set<string>} wrong @param {import('./locale.js').ExamT} tx */
function attachWhy(root, why, wrong, tx) {
  root.querySelectorAll('[data-item]').forEach(node => {
    const el = /** @type {HTMLElement} */ (node);
    const w = why[el.dataset.item || ''];
    if (!w || el.querySelector('.ex-why')) return;
    if (w.question_en) el.querySelector('.ex-q')?.append(h('span', { class: 'ex-en', lang: 'en', dir: 'ltr' }, w.question_en));
    const opts = el.querySelectorAll('.ex-opt .ex-opt-text');
    if (w.options_en && opts.length === w.options_en.length) opts.forEach((o, i) => o.append(h('span', { class: 'ex-en', lang: 'en', dir: 'ltr' }, w.options_en[i])));
    el.append(h('details', { class: 'ex-why', open: wrong.has(el.dataset.item || '') },
      h('summary', { lang: langAttr(), dir: dirAttr() }, tx('why')),
      w.evidence ? h('blockquote', null, `„${w.evidence}“`, w.evidence_en ? h('span', { class: 'ex-en', lang: 'en', dir: 'ltr' }, w.evidence_en) : null) : null,
      h('p', null, w.why, w.why_en ? h('span', { class: 'ex-en', lang: 'en', dir: 'ltr' }, w.why_en) : null),
      w.trap ? h('p', null, h('b', null, `${tx('trap')} `), w.trap, w.trap_en ? h('span', { class: 'ex-en', lang: 'en', dir: 'ltr' }, w.trap_en) : null) : null));
  });
}

/**
 * The timed runner. Returns the view handle ({unmount}).
 * @param {HTMLElement} el @param {any} ctx @param {{ exam: any, n: number, module: string, ex: any, def: any }} o
 */
export function runObjective(el, ctx, { exam, n, module, ex, def }) {
  const { store, t } = ctx;
  const tx = exam.tx;
  const sec = sectionOf(exam, module);
  const countUp = sec.clock === 'up';
  document.body.dataset.chrome = 'off';
  const d = draft(store, n, module);
  /** @type {Record<string, any>} */ const answers = { ...(d?.answers || {}) };
  const ids = teilIds(ex, module, exam.def);
  const all = ids.flat();
  const names = ids.map((_, i) => tx('teil', { n: i + 1 }));
  let active = Math.min(d?.tab || 0, ids.length - 1);
  let busy = false;
  const tabs = h('div', { class: 'ex-tabs', role: 'tablist', 'aria-label': tx('tabs'), lang: langAttr(), dir: dirAttr() });
  arrowKeys(tabs);
  const body = h('div', { id: 'ex-panel', role: 'tabpanel' });
  const nav = h('div', { class: 'ex-nav' });
  const cover = h('div', { class: 'ex-cover', hidden: true });
  const over = h('p', { class: 'ex-over', hidden: true, role: 'status' });
  const confirmSlot = h('div');
  const group = playerGroup(b => { busy = b; drawTabs(); drawNav(); });
  const audio = (/** @type {string} */ file, /** @type {string} */ id, /** @type {number} */ limit, /** @type {any} */ o = {}) =>
    player({ group, store, n, id, url: mediaUrl(exam, n, file), limit, ...o, t: tx, toast: ctx.toast });
  const onPick = (/** @type {string} */ id, /** @type {string} */ v) => { answers[id] = v; saveDraft(store, n, module, { answers: { ...answers } }); drawTabs(); drawNav(); };
  const parts = renderParts({ exam, ex, module, answers, review: false, key: null, onPick, t, tx, audio });
  const clock = clockBar({
    ctx, tx, n, module, minutes: def.minutes, countUp,
    onChange: (p, leftMs) => {
      cover.hidden = !p;
      body.hidden = p;
      if (p) replace(cover, h('div', { class: 'ex-cover-card' }, h('h2', { lang: langAttr(), dir: dirAttr() }, tx('paused')),
        h('p', { class: 'caption tnum', lang: langAttr(), dir: dirAttr() }, countUp ? tx('used', { t: fmt(clock ? clock.elapsed() / 1000 : 0) }) : leftMs > 0 ? tx('left', { t: fmt(leftMs / 1000) }) : tx('timeUp')),
        h('button', { type: 'button', class: 'btn btn-primary pressable', lang: langAttr(), dir: dirAttr(), onclick: () => clock.resume() }, tx('continue'))));
      if (!countUp && leftMs < 0) { over.hidden = false; over.textContent = tx('overtime', { t: fmt(-leftMs / 1000) }); }
    },
  });
  const drawTabs = () => replace(tabs, names.map((nm, j) => h('button', {
    type: 'button', role: 'tab', id: `ex-tab-${j}`, 'aria-controls': 'ex-panel', 'aria-selected': String(j === active), disabled: busy && j !== active,
    class: ['ex-tab pressable', answeredIn(ids[j], answers) === ids[j].length && 'is-full'], onclick: () => show(j),
  }, nm, h('span', { class: 'ex-tab-n tnum' }, `${answeredIn(ids[j], answers)}/${ids[j].length}`))));
  const drawNav = () => replace(nav,
    active > 0 ? h('button', { type: 'button', class: 'btn pressable', lang: langAttr(), dir: dirAttr(), disabled: busy, onclick: () => show(active - 1) }, tx('back')) : null,
    active < parts.length - 1 ? h('button', { type: 'button', class: 'btn pressable', lang: langAttr(), dir: dirAttr(), disabled: busy, onclick: () => show(active + 1) }, tx('next')) : null,
    h('span', { class: 'ex-nav-grow caption tnum', lang: langAttr(), dir: dirAttr() }, tx('answered', { n: answeredIn(all, answers), of: all.length })),
    h('button', { type: 'button', class: ['btn pressable', active === parts.length - 1 && 'btn-primary'], lang: langAttr(), dir: dirAttr(), disabled: busy, onclick: askSubmit }, tx('submit')));
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
      lang: langAttr(), dir: dirAttr(),
      title: tx('submitQ', { module: def.name }),
      lines: [tx('answered', { n: answeredIn(all, answers), of: all.length }), names.map((nm, j) => `${nm}: ${answeredIn(ids[j], answers)}/${ids[j].length}`).join(' · '),
        countUp ? '' : leftMs > 0 ? tx('left', { t: fmt(leftMs / 1000) }) : tx('timeUp'), tx('final')].filter(Boolean),
      yes: tx('submit'), no: tx('keepGoing'),
      onNo: () => replace(confirmSlot),
      onYes: async () => {
        if (submitting) return;
        submitting = true;
        try {
          const g = grade(answerKey(ex, exam.def), module, answers, exam.def);
          const c = clock.clock;
          const rec = await submitAttempt(ctx, { exam, n, module, clock: c, score: g.score, maxScore: g.max_score, responses: g.results, meta: {} });
          // the clock stops only once the attempt is stored: a failed submit leaves it running and paused on leave
          clock.stop(false);
          group.stop();
          ctx.go(`/exam/${n}/${module}/review/${rec.id}`, { replace: true });
        } catch (e) {
          submitting = false;
          console.error(e);
          ctx.toast(tx('submitFailed'));
        }
      },
    }));
    confirmSlot.scrollIntoView({ block: 'nearest' });
  }
  const head = h('header', { class: 'ex-runhead' },
    backLink(`#/exam/${n}`, t('exam.backTest', { n }), { narrow: true }),
    h('div', { class: 'ex-runhead-end' }, clock.el, h('button', { type: 'button', class: 'btn btn-primary pressable ex-submit-top', lang: langAttr(), dir: dirAttr(), onclick: askSubmit }, tx('submit'))));
  replace(el, h('div', { class: 'ex-run', lang: langAttr(), dir: dirAttr() },
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
 * @param {HTMLElement} el @param {any} ctx @param {{ exam: any, n: number, module: string, ex: any, def: any, attempt: any, focusItem?: string | null }} o
 */
export async function reviewObjective(el, ctx, { exam, n, module, ex, def, attempt, focusItem = null }) {
  const { store, t } = ctx;
  const tx = exam.tx;
  const sec = sectionOf(exam, module);
  /** @type {Record<string, any>} */ const answers = {}, key = {};
  for (const r of attempt.responses || []) { answers[r.item_id] = r.given; key[r.item_id] = r.correct; }
  const audio = (/** @type {string} */ file) => reviewAudio(mediaUrl(exam, n, file));
  const parts = renderParts({ exam, ex, module, answers, review: true, key, onPick: () => {}, t, tx, audio });
  const why = await loadWhy(ctx, exam, n);
  const wrong = new Set((attempt.responses || []).filter((/** @type {any} */ r) => !r.is_correct).map((/** @type {any} */ r) => r.item_id));
  const holder = h('div', null, parts);
  attachWhy(holder, why, wrong, tx);
  const ids = teilIds(ex, module, exam.def);
  const bt = byTeil(attempt.responses || []);
  let active = Math.max(0, focusItem ? ids.findIndex(xs => xs.includes(focusItem)) : 0);
  const tabs = h('div', { class: 'ex-tabs', role: 'tablist', 'aria-label': tx('tabs'), lang: langAttr(), dir: dirAttr() });
  arrowKeys(tabs);
  const body = h('div', { id: 'ex-panel', role: 'tabpanel' });
  const show = (/** @type {number} */ i) => {
    active = i;
    replace(tabs, ids.map((_, j) => {
      const x = bt[sec.parts[j].id];
      return h('button', { type: 'button', role: 'tab', id: `ex-tab-${j}`, 'aria-controls': 'ex-panel', 'aria-selected': String(j === active), class: 'ex-tab pressable', onclick: () => show(j) },
        tx('teil', { n: j + 1 }), x ? h('span', { class: 'ex-tab-n tnum' }, `${x[0]}/${x[1]}`) : null);
    }));
    replace(body, parts[i]);
    body.setAttribute('aria-labelledby', `ex-tab-${i}`);
  };
  const weak = weakSkills(attempt.responses || []);
  const fb = feedbackFor(store, exam.id, attempt);
  markSeen(store, fb.cur.filter(f => !f.seen).map(f => f.id));
  replace(el, h('div', { class: 'ex-review' },
    reviewHead({ ctx, n, def, attempt, score: attempt.score, max: attempt.max_score, pass: passes(attempt.score, attempt.max_score, exam.def.scoring.passShare), topic: ex.topic }),
    h('p', { class: 'caption ex-skills', lang: langAttr(), dir: dirAttr() }, weak.length ? `${tx('bySkill')} ${weak.map(([k, v]) => `${tx.has(`skill.${k}`) ? tx(`skill.${k}`) : k} ${v[0]}/${v[1]}`).join(' · ')}` : tx('allRight')),
    feedbackBlock({ ctx, exam, attempt, fb }),
    h('p', { class: 'caption' }, sec.parts.some((/** @type {any} */ p) => p.audio) ? t('exam.review.hoerenHint') : t('exam.review.lesenHint')),
    tabs, body,
    await nextCard(ctx, exam, n)));
  show(Math.min(active, parts.length - 1));
  if (focusItem) setTimeout(() => {
    const it = /** @type {HTMLElement | null} */ (body.querySelector(`[data-item="${CSS.escape(focusItem)}"]`));
    if (it) { it.querySelector('details')?.setAttribute('open', ''); it.scrollIntoView({ block: 'center' }); it.classList.add('is-flash'); }
  }, 80);
  return () => {};
}

