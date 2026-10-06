/* Reading: comprehension questions (#/practice/read/<id>/questions). A graded text brings its own reviewed questions.
   For a text he pasted, Claude writes them with his key, after the line that says the text is sent: five questions
   in the text's language (2 on the main idea, 2 on details, 1 inference), each checked before it is shown (logic.js
   checkQuestions: answer in range, distinct options, the evidence quoted word for word from the text). They are kept
   on this device (read.cache, with the prompt version and the text's fingerprint), so opening them again costs
   nothing. Answers are checked here; a wrong one shows the sentence that answers it. Not cards: the score goes on the
   text. */
import { h, replace, announce } from '../../core/dom.js';
import { langAttr, dirAttr } from '../../core/lang.js';
import { haptic } from '../../core/motion.js';
import { ask } from '../../services/claude.js';
import { fill } from '../../services/prompts/index.js';
import { TEMPLATES } from '../../services/prompts/read.js';
import { config } from '../../core/config.js';
import { langOf as textLang } from '../../domain/script/parse.js';
import * as R from '../shared/read-data.js';
import * as L from './logic.js';
import { language, sectionsFor } from './load.js';
import { back, errLine } from './ui.js';

const PROMPT = 'read-questions@1';
/** True and false in the text's language, for the true-or-false items. */
const TF = /** @type {Record<string, [string, string]>} */ ({ de: ['richtig', 'falsch'], fr: ['vrai', 'faux'] });

/** @param {HTMLElement} el @param {import('../contract.js').ViewCtx} ctx @param {any} read */
export async function mountQuestions(el, ctx, read) {
  const { t, store } = ctx;
  const { sections, graded } = await sectionsFor(ctx, read);
  const Lg = await language(ctx);
  const sentences = L.sentencesOf({ sections });
  const text = sentences.map(x => x.de).join(' ');
  const hash = L.textHash({ sections });
  const key = () => (store.get('secrets', {}) || {}).anthropicKey || null;
  const cached = () => {
    const q = ((store.get(R.CACHE, {}) || {})[read.id] || {}).q;
    return q && q.promptVersion === PROMPT && q.textHash === hash && Array.isArray(q.items) && q.items.length >= L.MIN_QUESTIONS ? q.items : null;
  };
  /** @type {L.Question[] | null} */
  const fromContent = graded && Array.isArray(graded.questions) && graded.questions.length
    ? graded.questions.map((/** @type {any} */ q, /** @type {number} */ i) => ({ id: q.id || `q${i + 1}`, type: q.type, skill: q.skill, q: q.q, options: q.options, answer: q.answer, evidence: q.evidence })) : null;
  const body = h('div', { class: 'rd-qs stack' });
  replace(el, h('div', { class: 'practice stack rd-questions', 'data-title': t('read.title') },
    back(`#/practice/read/${read.id}`, read.title),
    h('div', { class: 'page-head' }, h('h1', null, t('read.q.title'))),
    body));

  function start() {
    const items = fromContent || cached();
    if (items) { drawQuestions(items); return; }
    if (!key()) {
      replace(body, h('p', { class: 'lead' }, t('read.q.noKey')), h('a', { class: 'btn btn-primary pressable', href: `#/practice/read/${read.id}/done` }, t('read.finish')));
      return;
    }
    const st = h('p', { class: 'caption', 'aria-live': 'polite' });
    const go = /** @type {HTMLButtonElement} */ (h('button', { type: 'button', class: 'btn btn-primary pressable', onclick: () => write(go, st) }, t('read.q.write')));
    replace(body, h('p', null, t('read.q.intro')), h('p', { class: 'caption' }, t('read.sent.text')), h('div', { class: 'rd-actions' }, go), st,
      h('a', { class: 'btn btn-quiet pressable', href: `#/practice/read/${read.id}/done` }, t('read.q.skip')));
  }

  /** @param {HTMLButtonElement} b @param {HTMLElement} st */
  async function write(b, st) {
    b.disabled = true; b.textContent = t('read.q.writing');
    const tf = TF[Lg.lang] || ['true', 'false'];
    const user = fill(TEMPLATES[PROMPT], { n: 5, language: Lg.pack.name, true: tf[0], false: tf[1], text });
    const inLang = Lg.lang === 'de' ? (/** @type {string} */ s) => textLang(s) !== 'en' : () => true;
    try {
      /** @type {L.Question[]} */ let items = [];
      let model = '';
      for (let tries = 0; tries < 2 && items.length < L.MIN_QUESTIONS; tries++) {
        const res = await ask({ key: key(), user, model: config.anthropic.models.grade, maxTokens: 3000, effort: 'low', fallback: false, format: { type: 'json_schema', schema: L.QUESTIONS_SCHEMA } });
        items = L.checkQuestions(res.text, text, inLang);
        model = res.model;
      }
      if (items.length < L.MIN_QUESTIONS) { b.disabled = false; b.textContent = t('read.q.write'); st.textContent = t('read.q.failed'); return; }
      store.update(R.CACHE, (/** @type {any} */ m) => { const cur = (m || {})[read.id] || {}; return { ...(m || {}), [read.id]: { ...cur, q: { promptVersion: PROMPT, model, textHash: hash, items } } }; }, {});
      drawQuestions(items);
    } catch (err) {
      b.disabled = false; b.textContent = t('read.q.write');
      st.textContent = errLine(err, t, t('read.err.other'));
    }
  }

  /** @param {L.Question[]} items */
  function drawQuestions(items) {
    /** @type {Record<string, number>} */ const picked = {};
    const score = h('p', { class: 'lead rd-qscore', 'aria-live': 'polite' });
    const doneBtn = h('a', { class: 'btn btn-primary pressable', href: `#/practice/read/${read.id}/done`, hidden: true }, t('read.finish'));
    const card = (/** @type {L.Question} */ q, /** @type {number} */ k) => {
      const fb = h('div', { class: 'rd-qfb' });
      const opts = h('div', { class: 'rd-opts', role: 'group', 'aria-label': t('read.q.n', { n: k + 1 }) }, q.options.map((o, i) =>
        h('button', { type: 'button', class: 'rd-opt pressable', lang: langAttr(), dir: dirAttr(), onclick: (/** @type {Event} */ e) => pick(q, i, /** @type {HTMLElement} */ (e.currentTarget).parentElement, fb) }, o)));
      return h('section', { class: 'card rd-q' }, h('p', { class: 'label' }, t('read.q.n', { n: k + 1 })), h('p', { class: 'rd-qtext', lang: langAttr(), dir: dirAttr() }, q.q), opts, fb);
    };
    /** @param {L.Question} q @param {number} i @param {HTMLElement | null} group @param {HTMLElement} fb */
    function pick(q, i, group, fb) {
      if (q.id in picked || !group) return;
      picked[q.id] = i;
      const ok = i === q.answer;
      [...group.querySelectorAll('button')].forEach((b, j) => { b.setAttribute('disabled', ''); if (j === q.answer) b.classList.add('is-right'); else if (j === i) b.classList.add('is-wrong'); });
      if (ok) haptic();
      const ev = L.sentenceOfQuote(sentences, q.evidence);
      replace(fb, h('p', { class: ['rd-res', ok ? 'is-ok' : 'is-bad'] }, ok ? t('read.q.right') : t('read.q.wrong')),
        ok ? null : h('blockquote', { class: 'tv-quote', lang: langAttr(), dir: dirAttr() }, ev ? ev.de : q.evidence));
      announce(ok ? t('read.q.right') : `${t('read.q.wrong')} ${q.options[q.answer]}`);
      if (Object.keys(picked).length === items.length) {
        const right = items.filter(x => picked[x.id] === x.answer).length;
        score.textContent = t('read.q.score', { n: right, of: items.length });
        doneBtn.hidden = false;
        R.updateProgress(store, read.id, p => ({ ...p, q: { right, of: items.length, at: ctx.clock.today() } }));
      }
    }
    replace(body, items.map(card), score, doneBtn);
  }
  start();
}
