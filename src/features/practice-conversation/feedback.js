/* The feedback card (#/practice/conversation/c/<id>/feedback): one review of the whole conversation by the feedback
   model (structured output, domain/conversation-feedback.js schema), validated before anything is shown. His numbers,
   a two-line summary, the mistakes (at most 5; the ones that may become cards ticked, at most 3), better phrases, and
   what he used well. "Add N cards and finish" hands the ticked mistakes to data/mistakes.js (F:C-<session>-<n>, deck
   b1); running the feedback again never removes a card he already added. The sections unfold one after another
   (motion.js reveal; at once with reduced motion). */
import { h, replace } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { backLink } from '../../core/ui.js';
import { reveal, countTo, reduced } from '../../core/motion.js';
import { langAttr, dirAttr } from '../../core/lang.js';
import { ask, ClaudeError } from '../../services/claude.js';
import { addMistakes, listMistakes } from '../../data/mistakes.js';
import { uuidv7 } from '../../data/ids.js';
import * as C from '../../domain/conversation.js';
import * as F from '../../domain/conversation-feedback.js';
import * as D from './data.js';
import { feedbackSystem, IDS } from './prompts.js';
import { claude } from '../../data/credentials.js';

/** Sessions whose feedback request is out now: one at a time per conversation (a reopened page waits for it). */
const inflight = new Set();

/** Words of b that are not in a's longest common run (the changed words of a correction). @param {string} a @param {string} b */
export function changed(a, b) {
  const x = a.split(/\s+/).filter(Boolean), y = b.split(/\s+/).filter(Boolean);
  const k = (/** @type {string} */ w) => C.fold(w);
  const L = Array.from({ length: x.length + 1 }, () => new Array(y.length + 1).fill(0));
  for (let i = x.length - 1; i >= 0; i--) for (let j = y.length - 1; j >= 0; j--) L[i][j] = k(x[i]) === k(y[j]) ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  /** @type {boolean[]} */ const out = new Array(y.length).fill(true);
  let i = 0, j = 0;
  while (i < x.length && j < y.length) {
    if (k(x[i]) === k(y[j])) { out[j] = false; i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) i++; else j++;
  }
  return y.map((w, n) => ({ w, on: out[n] }));
}

/**
 * @param {HTMLElement} el @param {import('../contract.js').ViewCtx} ctx @param {D.Session} s0
 */
export async function mountFeedback(el, ctx, s0) {
  const { t, store } = ctx;
  const id = s0.id;
  const attemptId = `C-${id}`;
  let alive = true;
  const content = await D.loadTopics(ctx);
  const { conv } = D.convPack(ctx.settings());
  const back = ctx.query.get('from') === 'today' ? '#/today' : '#/practice';

  const frame = (/** @type {any[]} */ ...kids) => h('div', { class: 'practice stack cv cv-fb' },
    backLink({ href: '#/practice/conversation', label: t('conv.title') }),
    ...kids);

  /** Ask for the review (once; again on "Try again"). */
  async function run() {
    const tr = D.getTranscript(store, id);
    const cred = claude(store);
    if (!tr || !conv) { drawError('gone'); return; }
    if (!cred) { drawError('nokey'); return; }
    const today = ctx.clock.ctx().today;
    const month = C.monthLoad(D.monthSpent(store, today), D.convSettings(ctx.settings()).monthlyCapUsd);
    const tries = D.getSession(store, id)?.feedbackTries || 0;
    const gate = C.feedbackGate({ tries, running: inflight.has(id), monthOver: month.over });
    if (gate === 'month') { drawError('month', { cap: D.money(month.cap) }); return; }
    if (gate === 'running') { drawWait(); waitFor(); return; }
    inflight.add(id);
    drawWait();
    // a try counts once it was billed (a request never sent costs nothing and does not use up the try past the cap)
    const billed = (/** @type {string} */ model, /** @type {C.Usage} */ usage) => {
      D.charge(store, id, today, model, usage);
      D.patchSession(store, id, { feedbackTries: (D.getSession(store, id)?.feedbackTries || 0) + 1 });
    };
    const s = /** @type {D.Session} */ (D.getSession(store, id));
    try {
      const r = await ask({ cred, system: feedbackSystem(conv, s.level, s.partnerLevel), user: C.feedbackTranscript(tr.turns), model: s.models.feedback, maxTokens: 16000, effort: 'medium',
        format: { type: 'json_schema', schema: F.feedbackSchema() } });
      billed(r.model || s.models.feedback, C.usageOf(r.usage));
      /** @type {any} */ let raw;
      try { raw = JSON.parse(r.text); } catch { throw new ClaudeError('format'); }
      const live = listMistakes(store).filter(m => m.source.attemptId !== attemptId);
      const checked = F.checkFeedback(raw, { turns: tr.turns, live });
      D.putFeedback(store, { id: uuidv7(), v: 1, sessionId: id, model: r.model || s.models.feedback, promptVersion: IDS.feedback, createdAt: new Date().toISOString(),
        raw, dropped: checked.dropped, added: (D.getFeedback(store, id)?.added) || [] });
      if (alive) draw();
    } catch (e) {
      // a cut-off, refused or empty reply was billed: count it (it carries its usage)
      if (e instanceof ClaudeError && e.usage) billed(s.models.feedback, e.usage);
      if (alive) drawError(e instanceof ClaudeError ? e.code : 'other');
    } finally {
      inflight.delete(id);
    }
  }

  /** Another page of this conversation asked first: draw what it gets. */
  async function waitFor() {
    while (alive && inflight.has(id)) await new Promise(r => setTimeout(r, 500));
    if (!alive) return;
    if (D.getFeedback(store, id)) draw(); else drawError('other');
  }

  function drawWait() {
    replace(el, frame(h('div', { class: 'page-head' }, h('h1', null, t('conv.fb.title'))),
      h('p', { class: 'cv-wait', role: 'status' }, h('span', { class: 'cv-typing', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')), ' ', t('conv.fb.writing'))));
  }

  /** @param {string} code @param {Record<string, any>} [vars] */
  function drawError(code, vars = {}) {
    replace(el, frame(h('div', { class: 'page-head' }, h('h1', null, t('conv.fb.title'))),
      h('p', { class: 'cv-error', role: 'alert' }, t(`conv.err.${code}`, vars)),
      h('p', { class: 'caption' }, t('conv.fb.kept')),
      h('div', { class: 'row-actions wrap' },
        ['key', 'nokey', 'credit', 'forbidden'].includes(code) ? h('a', { class: 'btn pressable', href: '#/profile/connections' }, t('conv.noKey.link'))
          : code !== 'gone' && code !== 'month' ? h('button', { type: 'button', class: 'btn btn-primary pressable', onclick: () => run() }, t('conv.tryAgain')) : null,
        h('button', { type: 'button', class: 'btn btn-quiet pressable', onclick: () => finish([]) }, t('conv.fb.finishNone')))));
  }

  /** The topic's title for the mistake's source line: a content title (public) or a plain label for his own topic. @param {D.Session} s */
  function sourceLabel(s) {
    const items = s.topic.kind === 'scenario' ? content?.scenarios : s.topic.kind === 'topic' ? content?.topics : null;
    const x = items ? items.find((/** @type {any} */ y) => y.id === s.topic.ref) : null;
    const title = x ? (x.de || x.title) : t('conv.ownTopic');
    return t('conv.cardLabel', { title });
  }

  /** @param {{wrong: string, right: string, rule: string}[]} chosen */
  function finish(chosen) {
    const s = /** @type {D.Session} */ (D.getSession(store, id));
    const existing = listMistakes(store).filter(m => m.source.attemptId === attemptId).map(m => ({ wrong: m.wrong, right: m.right, rule: m.rule }));
    const items = F.cardItems(existing, chosen);
    const added = items.length > existing.length ? addMistakes(store, { attemptId, test: null, module: 'conversation', label: sourceLabel(s), items }) : [];
    const fb = D.getFeedback(store, id);
    if (fb && added.length) D.putFeedback(store, { ...fb, added: [...(fb.added || []), ...added] });
    D.patchSession(store, id, { status: 'finished', cards: (s.cards || 0) + added.length, endedAt: s.endedAt || Date.now() });
    if (added.length) ctx.toast(t('conv.fb.added', { n: added.length }));
    ctx.go(back.slice(1));
  }

  function draw() {
    const s = /** @type {D.Session} */ (D.getSession(store, id));
    const tr = D.getTranscript(store, id);
    const fb = D.getFeedback(store, id);
    if (!fb || !tr) { run(); return; }
    const mine = listMistakes(store).filter(m => m.source.attemptId === attemptId);
    const live = listMistakes(store).filter(m => m.source.attemptId !== attemptId);
    const v = F.checkFeedback(fb.raw, { turns: tr.turns, live });
    const isMine = (/** @type {F.Checked} */ m) => mine.some(x => C.fold(x.wrong) === C.fold(m.wrong) && C.fold(x.right) === C.fold(m.right));
    const st = C.stats(tr.turns, s.startedAt, s.endedAt || undefined);
    const finished = s.status === 'finished';
    /** @type {Set<F.Checked>} */ const ticked = new Set(v.mistakes.filter(m => m.checked && !isMine(m)));
    const room = () => Math.max(0, F.MAX_CARDS - mine.length);
    const primary = /** @type {HTMLButtonElement} */ (h('button', { type: 'button', class: 'btn btn-primary btn-wide pressable', onclick: () => finish([...ticked]) }));
    const boxes = /** @type {HTMLInputElement[]} */ ([]);
    const sync = () => {
      const n = Math.min(ticked.size, room());
      primary.textContent = finished ? t('conv.fb.done') : n ? t('conv.fb.addFinish', { n }) : t('conv.fb.finish');
      for (const b of boxes) if (!b.checked) b.disabled = ticked.size >= room();
    };

    const mistakeRow = (/** @type {F.Checked} */ m) => {
      const already = isMine(m);
      /** @type {HTMLElement | null} */ let ctl = null;
      if (already) ctl = h('span', { class: 'cv-added' }, icon('check', { size: 16 }), t('conv.fb.isAdded'));
      else if (m.cardable && !finished) {
        const box = /** @type {HTMLInputElement} */ (h('input', { type: 'checkbox', checked: ticked.has(m), onchange: () => { if (box.checked) ticked.add(m); else ticked.delete(m); sync(); } }));
        boxes.push(box);
        ctl = h('label', { class: 'cv-add pressable' }, box, t('conv.fb.add'));
      } else ctl = h('span', { class: 'caption' }, t(`conv.fb.why.${m.why || 'cap'}`));
      return h('div', { class: 'cv-item' },
        h('p', { class: 'cv-wrong', lang: langAttr(), dir: dirAttr() }, h('s', null, m.wrong)),
        h('p', { class: 'cv-right', lang: langAttr(), dir: dirAttr() }, changed(m.wrong, m.right).map((x, i) => [i ? ' ' : '', x.on ? h('em', null, x.w) : x.w])),
        m.rule ? h('p', { class: 'cv-rule' }, m.rule) : null,
        h('div', { class: 'cv-irow' }, h('span', { class: 'cv-tag' }, icon('pencil', { size: 13 }), t('conv.typed')), ctl));
    };

    const lang = conv?.language || '';
    // the done hero (DESIGN.md components.done-hero, drawn here without its atmosphere: this page is mostly text): the
    // topic as the label, one figure (the words he wrote), its line, and the data object, this conversation's bubbles
    // in miniature (his outlined in accent, Claude's surface-2, a 2 px tick under a turn with a mistake)
    const fig = h('span', { class: 'figure tnum' }, String(st.words));
    const missed = new Set(v.mistakes.map(m => m.turn));
    const strip = h('div', { class: 'cv-strip-mini', role: 'img', 'aria-label': t('conv.fb.stripAria', { n: tr.turns.length, k: missed.size }) },
      tr.turns.map((/** @type {any} */ x) => h('span', { class: ['cv-mini', x.who === 'learner' ? 'is-you' : 'is-them', x.who === 'learner' && missed.has(x.i) && 'has-miss'],
        style: { '--w': String(Math.max(0.18, Math.min(1, C.wordsIn(x.text || '') / 24))) } })));
    const h1 = h('h1', { tabindex: '-1' }, fig, ' ', h('span', { class: 'pr-done-of' }, t('conv.fb.words', { n: st.words })));
    const view = frame(
      h('div', { class: 'pr-done-top cv-fb-top' },
        h('section', { class: 'hero pr-done-hero cv-fb-hero' },
          h('p', { class: 'label' }, h('span', { lang: langAttr(), dir: dirAttr() }, tr.title)),
          h1,
          h('p', { class: 'caption tnum' }, t('conv.fb.line', { n: st.turns, min: st.minutes, lang }))),
        h('div', { class: 'pr-done-data' }, strip)),
      v.summary ? h('p', { class: 'cv-summary', 'data-reveal': '' }, v.summary) : null,
      h('section', { class: 'cv-sec', 'data-reveal': '', 'aria-labelledby': 'cv-s-m' },
        h('h2', { class: 'cv-sec-h', id: 'cv-s-m' }, t('conv.fb.mistakes'), h('span', { class: 'tnum' }, String(v.mistakes.length))),
        v.mistakes.length ? v.mistakes.map(mistakeRow) : h('p', { class: 'caption' }, t('conv.fb.noMistakes')),
        v.mistakes.length ? h('p', { class: 'caption cv-foot' }, t('conv.fb.mistakes.foot')) : null),
      v.better.length ? h('section', { class: 'cv-sec', 'data-reveal': '', 'aria-labelledby': 'cv-s-b' },
        h('h2', { class: 'cv-sec-h', id: 'cv-s-b' }, t('conv.fb.better'), h('span', { class: 'tnum' }, String(v.better.length))),
        v.better.map(b => h('div', { class: 'cv-item' }, h('p', { class: 'cv-said', lang: langAttr(), dir: dirAttr() }, b.said),
          h('p', { class: 'cv-better', lang: langAttr(), dir: dirAttr() }, b.better), b.why ? h('p', { class: 'cv-why' }, b.why) : null))) : null,
      v.usedWell.length ? h('section', { class: 'cv-sec', 'data-reveal': '', 'aria-labelledby': 'cv-s-u' },
        h('h2', { class: 'cv-sec-h', id: 'cv-s-u' }, t('conv.fb.used'), h('span', { class: 'tnum' }, String(v.usedWell.length))),
        v.usedWell.map(u => h('div', { class: 'cv-item' }, h('p', { class: 'cv-better', lang: langAttr(), dir: dirAttr() }, u.text), u.why ? h('p', { class: 'cv-why' }, u.why) : null)),
        h('p', { class: 'caption cv-foot' }, t('conv.fb.used.foot'))) : null,
      h('p', { class: 'caption cv-cost', 'data-reveal': '' }, t('conv.fb.cost', { usd: D.money(s.costUsd || 0) })),
      h('div', { class: 'cv-dock' }, h('div', { class: 'cv-wrap cv-dock-row' }, primary,
        !finished ? h('button', { type: 'button', class: 'btn btn-quiet pressable', onclick: () => finish([]) }, t('conv.fb.finishNone')) : null)),
      h('div', { class: 'cv-tail' },
        h('button', { type: 'button', class: 'btn btn-quiet pressable cv-delete', onclick: (/** @type {Event} */ e) => {
          const b = /** @type {HTMLButtonElement} */ (e.currentTarget);
          if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = t('conv.delete.sure'); return; }
          D.deleteConversation(store, id);
          ctx.toast(t('conv.delete.done'));
          ctx.go('/practice/conversation');
        } }, icon('trash', { size: 16 }), t('conv.delete'))));
    if (finished) primary.onclick = () => ctx.go(back.slice(1));
    sync();
    replace(el, view);
    if (!reduced()) countTo(fig, st.words, /** @type {any} */ ({ from: 0, duration: 640 }));
    h1.focus({ preventScroll: true });
    reveal(/** @type {any} */ (view));
  }

  if (D.getFeedback(store, id)) draw(); else run();
  return () => { alive = false; };
}
