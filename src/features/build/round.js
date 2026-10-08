/* Word building rounds (#/practice/build/round?kind=review|prefixes|verbs|sentences|suffixes|drill|pick&ids=…[&from=today]).
   Full screen (no app chrome), one study card at a time, all card types of deck 'build' in one mixed round:
     PX:<p>.see   "Which prefix?": the motion plays on a plain compass, tap the prefix (first try right Good, else Again)
     PX:<p>.say   the prefix → say what it does and whether it splits, then its card; self-graded
     PD:<verb>    root + prefix → predict the meaning and how derivable it is, then the reveal; self-graded ("Did you
                  know what it means?"); the derivability guess is logged, never graded
     PV:<verb>    English → type the infinitive (strict, domain/wordbuild-grade.js)
     PS:<f>.<x>   the sentence with gaps → type the verb pieces; the machine then plays the answer from the infinitive
     SX:<s>       a noun ending → tap der, die or das; an adjective ending → say what it makes, self-graded
     PW:<word>    parent + ending → type the word (a noun with its article)
     PF:<form>    a family form (round 7): its meaning → type the word (a noun with its article)
   A new card shows first as a study card and comes back later in the round (a learning step), as in every round.
   Scheduling is FSRS (domain/fsrs.js) through data.js saveAnswer: right first try Good (3), a slip Hard (2), wrong
   or shown Again (1); a miss or a learning step comes back +4 then +10 cards, at most three showings. The round
   segments are the cards planned at the start and never re-divide. Esc or End leaves (the round is kept for the day). */
import { h, replace, announce } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { swap, segments, correct as fxCorrect, wrong as fxWrong, resetAnswer, haptic, countTo } from '../../core/motion.js';
import { FORMS, gapped, pieces, pwPrompt, pwAnswer, sentenceOf, bare } from '../../domain/wordbuild.js';
import { composeRound } from '../../domain/wordbuild-plan.js';
import { gradeTyped, typedRating, pvAccept } from '../../domain/wordbuild-grade.js';
import { loadContent, knowledge, today as todayOf, dueFns, saveAnswer, whenFor, logCalib, cardsOf, addActivity, countRound, KV } from './data.js';
import { compassStage, prefixCard, verbReveal } from './compass.js';
import { scene, glyphFor } from './picto.js';
import { wordNode, joinFrom, weld, exampleNode } from './word.js';
import { gradeRow } from './grade4.js';
import { buildLine, swapLine, tray, fromTray, ruleNode, tileLegend } from './machine.js';
import { drawTree, landArticle } from './chain.js';
import { play, css, nudge, pop, reduced, finishAll } from './fx.js';
import { langAttr, dirAttr } from '../../core/lang.js';
import { fitToKeyboard, keep, reveal as revealEl, fitPrompt } from '../../core/keyboard.js';
import { familiesOf } from './family-data.js';
import { formWord } from './fword.js';
import { familyLink } from '../shared/family-link.js';

const KINDS = ['review', 'prefixes', 'verbs', 'sentences', 'suffixes', 'drill', 'pick'];
const SIX_HOURS = 6 * 3600e3;

/** @param {HTMLElement} el @param {import('../contract.js').ViewCtx} ctx */
export async function mountRound(el, ctx) {
  const { t, store } = ctx;
  const kind = /** @type {any} */ (KINDS.includes(String(ctx.query.get('kind'))) ? ctx.query.get('kind') : 'review');
  const backTo = ctx.query.get('from') === 'today' ? '/today' : kind === 'drill' ? '/practice/build/prefixes' : kind === 'sentences' ? '/practice/build/machine' : '/practice/build';
  document.body.dataset.chrome = 'off';
  document.body.classList.add('wb-in-round');
  const restore = () => { document.body.dataset.chrome = 'on'; document.body.classList.remove('wb-in-round'); };
  replace(el, h('div', { class: 'wb wb-round' }, h('h1', { class: 'sr-only' }, t('build.round')), h('p', { class: 'caption' }, t('build.loading'))));
  /** @type {any} */
  let d;
  /** @type {any} */
  let k;
  try { [d, k] = await Promise.all([loadContent(ctx), knowledge(ctx).catch(() => null)]); } catch {
    replace(el, h('div', { class: 'wb stack page-pad' }, h('h1', null, t('build.round')), h('p', null, t('build.loadFailed')), h('a', { class: 'btn pressable', href: '#/practice/build' }, t('build.back'))));
    return restore;
  }
  const st = todayOf(ctx, d, k);
  const c = st.c;
  // a round in progress today (same kind, within 6 hours) resumes
  const slot = kind === 'pick' ? `pick:${ctx.query.get('ids') || ''}` : kind;
  const saved = (store.get(KV, {}) || {}).round;
  /** @type {any} */ let round = saved && saved.slot === slot && saved.day === c.today && Date.now() - saved.startedAt < SIX_HOURS && saved.i < saved.queue.length ? structuredClone(saved) : null;
  if (!round) {
    const ids = composeRound({ kind, content: d.c, cards: st.cards, today: c.today, ...dueFns(c), newLeft: st.budget.newLeft, open: st.open, ids: String(ctx.query.get('ids') || '').split(',').filter(Boolean) });
    if (!ids.length) { drawNothing(); return restore; }
    round = { slot, kind, day: c.today, startedAt: Date.now(), queue: ids.map(id => ({ id })), i: 0, results: [], planned: ids.length };
  }
  const saveRound = () => store.update(KV, (/** @type {any} */ s) => ({ ...(s || {}), round }), {});
  saveRound();
  const t0 = performance.now();

  // ---------- layout ----------
  const segs = h('div', { class: 'segments wb-segs', style: { '--n': String(round.planned) }, 'aria-hidden': 'true' });
  const count = h('span', { class: 'caption tnum' });
  const endBtn = h('button', { type: 'button', class: 'btn btn-quiet pressable wb-end', onpointerdown: keep, onclick: () => end() }, t('build.end'), h('kbd', null, 'Esc'));
  const top = h('div', { class: 'wb-rtop' }, segs, h('div', { class: 'wb-rtop-row' }, count, endBtn));
  // the typed cards share ONE field for the whole round (DESIGN.md, Study card): only the prompt changes, so the
  // focus and the iPhone keyboard stay up from one typed card to the next. The card is its body (replaced per card),
  // the field, and the tail (a typed card's note and its reveal).
  const input = /** @type {HTMLInputElement} */ (h('input', { class: 'answer-input', type: 'text', lang: langAttr(), dir: dirAttr(), autocapitalize: 'off', autocomplete: 'off', spellcheck: 'false', enterkeyhint: 'go', 'aria-label': t('build.answer') }));
  input.setAttribute('autocorrect', 'off');
  const checkSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  checkSvg.setAttribute('class', 'check'); checkSvg.setAttribute('viewBox', '0 0 24 24'); checkSvg.setAttribute('fill', 'none'); checkSvg.setAttribute('stroke', 'currentColor'); checkSvg.setAttribute('stroke-width', '2.2'); checkSvg.setAttribute('aria-hidden', 'true');
  const checkPath = document.createElementNS(checkSvg.namespaceURI, 'path'); checkPath.setAttribute('d', 'M5 12.5l4.5 4.5L19 7.5'); checkSvg.append(checkPath);
  const answerEl = h('div', { class: 'answer wb-answer kb-flip', hidden: true }, input, checkSvg);
  const cbody = h('div', { class: 'wb-cbody' });
  const tail = h('div', { class: 'wb-ctail' });
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); cur?.enter?.(); } });
  const card = h('article', { class: 'card wb-rcard' }, cbody, answerEl, tail);
  const actions = h('div', { class: 'wb-ractions' });
  const scroll = h('div', { class: 'wb-rscroll' }, card);
  const box = h('div', { class: 'wb wb-round', role: 'region', 'aria-label': t('build.round') }, h('h1', { class: 'sr-only' }, t('build.round')), top, scroll, actions);
  replace(el, box);
  const unfit = fitToKeyboard(box);   // the action row sits on the keyboard (core/keyboard.js)
  let alive = true, typedNow = false;
  /** @type {any} */ let cur = null;   // the current card's handlers: { key(e), primary() }

  function progress(answered = false) {
    /** @type {string[]} */ const planned = [];
    /** @type {Map<string, number>} */ const seenN = new Map();
    round.queue.forEach((/** @type {any} */ q, /** @type {number} */ i) => {
      if (q.re) return;
      const j = seenN.get(q.id) || 0; seenN.set(q.id, j + 1);
      if (i === round.i && !answered) planned.push('now');
      else if (i <= round.i) { const r = round.results.filter((/** @type {any} */ x) => x.id === q.id && x.first)[0]; planned.push(r ? (r.ok ? 'done' : 'miss') : ''); }
      else planned.push('');
    });
    segments(segs, planned);
    const k2 = planned.filter(Boolean).length;
    const q = round.queue[round.i];
    count.textContent = q && q.re ? t('build.countAgain', { n: Math.min(k2, round.planned), total: round.planned }) : t('build.count', { n: Math.min(k2, round.planned), total: round.planned });
  }

  /** Record an answer: schedule, reinsert, log. A study card of a new item (intro) is shown, not answered. @param {1|2|3|4} g @param {{ms?: number, flags?: string, mode?: string, intro?: boolean}} [o] */
  function record(g, o = {}) {
    const q = round.queue[round.i];
    const res = saveAnswer(ctx, { id: q.id, g, ms: o.ms ?? performance.now() - cardT0, flags: o.flags || '', mode: o.mode || 't' });
    const times = round.queue.filter((/** @type {any} */ x) => x.id === q.id).length;
    if (res.reinsert && times < 3) {
      const at = Math.min(round.queue.length, round.i + 1 + (times === 1 ? 4 : 10));
      round.queue.splice(Math.max(round.i + 1, at), 0, { id: q.id, re: true });
    }
    round.results.push({ id: q.id, g, ok: g >= 3 || !!o.intro, first: !q.re, isNew: !res.before || !res.before.reps, ...(o.intro ? { intro: true } : {}) });
    saveRound();
    progress(true);
    return res;
  }
  let cardT0 = performance.now();

  function setActions(/** @type {any[]} */ ...btns) { replace(actions, btns.filter(Boolean)); }
  const nextBtn = (label = t('build.next')) => h('button', { type: 'button', class: 'btn btn-primary pressable wb-next', onpointerdown: keep, onclick: () => next() }, label, h('kbd', null, '↵'));

  async function draw(first = false) {
    finishAll();
    const q = round.queue[round.i];
    if (!q) { finish(); return; }
    const fill = () => {
      cardT0 = performance.now();
      progress(false);
      const rec = cardsOf(store)[q.id];
      const isNew = !rec || !rec.reps;
      typedNow = false;
      cur = renderCard(q.id, isNew && !q.re);
      if (!typedNow) { answerEl.hidden = true; replace(tail); }   // the field stays put (and focused) between typed cards
      if (!cur) { round.i++; saveRound(); draw(); }
    };
    if (first) fill(); else await swap(fill, { kind: 'forward', fallbackEl: card });
    scroll.scrollTop = 0;
    cur?.focus?.();
  }
  function next() { if (!alive) return; round.i++; saveRound(); if (round.i >= round.queue.length) finish(); else draw(); }

  // ---------- the card types ----------
  /** @param {string} id @param {boolean} isNew */
  function renderCard(id, isNew) {
    let m;
    if ((m = /^PX:([^.]+)\.(see|say)$/.exec(id)) && d.P.has(m[1])) return m[2] === 'see' ? pxSee(d.P.get(m[1]), isNew) : pxSay(d.P.get(m[1]));
    if ((m = /^PD:(.+)$/.exec(id)) && d.V.has(m[1])) return pd(d.V.get(m[1]));
    if ((m = /^PV:(.+)$/.exec(id)) && d.V.has(m[1])) return typed({ kind: 'pv', v: d.V.get(m[1]) }, isNew);
    if ((m = /^PS:(.+)\.(\w+)$/.exec(id)) && d.F.has(m[1]) && FORMS.includes(/** @type {any} */ (m[2]))) return typed({ kind: 'ps', f: d.F.get(m[1]), form: m[2] }, isNew);
    if ((m = /^SX:(.+)$/.exec(id)) && d.S.has(m[1])) return sx(d.S.get(m[1]), isNew);
    if ((m = /^PW:(.+)$/.exec(id))) { const hit = pwNode(m[1]); if (hit) return typed({ kind: 'pw', ...hit }, isNew); }
    if ((m = /^PF:(.+)$/.exec(id))) { const hit = pfForm(id); if (hit) return typed({ kind: 'pf', ...hit }, isNew); }
    return null;
  }
  /** A family form by its PF: card (round 7). @param {string} id */
  function pfForm(id) {
    for (const fam of familiesOf(d).values()) { const f = fam.byCard.get(id); if (f) return { f, fam }; }
    return null;
  }
  const meta = (/** @type {boolean} */ isNew, /** @type {string} */ what) => h('div', { class: 'card-meta' }, h('span', { class: 'label' }, isNew ? h('span', { class: 'wb-newtag' }, t('build.new')) : t('build.review'), ` · ${what}`));
  const rootOf = (/** @type {string} */ pre) => { const vs = d.c.verbs.filter((/** @type {any} */ v) => v.pre === pre); const v = vs.find((/** @type {any} */ x) => x.root === 'stellen') || vs[0]; return v ? v.root : 'stellen'; };

  // PX see: the motion plays, tap the prefix
  function pxSee(/** @type {any} */ p, /** @type {boolean} */ isNew) {
    const root = rootOf(p.id);
    const kind = p.kind === 'd' ? 'i' : p.kind;
    let answered = false;
    const cs = compassStage({ d, t, root, plain: true, onPick: (pre, btn) => answer(pre, btn) });
    const sc = scene(cs.picto, glyphFor(p, kind), d.R.get(root).obj, { label: isNew ? p.alt : t('build.see.motion') });
    replace(cs.slot, wordNode({ stem: root, t, big: true }));
    const say = h('div', { class: 'wb-seeline', 'aria-live': 'polite' });
    if (isNew) {
      // study first: the prefix joins the root and its card shows; the question comes later in the round
      replace(cbody, meta(true, t('build.where.prefix')), h('p', { class: 'wb-dq' }, t('build.see.learn', { p: `${p.id}-` })), cs.stage, prefixCard(d, p, root, t));
      cs.press(p.id);
      const w = wordNode({ pre: p.id, stem: root, kind, t, big: true });
      replace(cs.slot, w);
      setTimeout(() => { if (!alive) return; sc.play(); joinFrom(cs.chips.get(p.id) || null, w); }, reduced() ? 0 : 200);
      announce(p.alt);
      setActions(h('button', { type: 'button', class: 'btn btn-primary pressable wb-next', onclick: () => { record(1, { flags: 'r', intro: true }); next(); } }, t('build.gotIt'), h('kbd', null, '↵')));
      return { primary: () => { record(1, { flags: 'r', intro: true }); next(); } };
    }
    replace(cbody, meta(false, t('build.where.prefix')), h('p', { class: 'wb-dq' }, t('build.see.ask')), say, cs.stage, cs.rows);
    setTimeout(() => { if (alive && !answered) sc.play(); }, reduced() ? 0 : 200);
    const again = h('button', { type: 'button', class: 'btn btn-quiet pressable', onclick: () => sc.play() }, icon('replay', { size: 16 }), t('build.see.again'));
    setActions(again);
    function answer(/** @type {string} */ pre, /** @type {HTMLElement} */ btn) {
      if (answered) return;
      answered = true;
      const ok = pre === p.id;
      record(ok ? 3 : 1);
      if (ok) {
        haptic();
        btn.classList.add('is-right');
        pop(btn, btn.classList.contains('wb-pchip') ? 'translate(-50%, -50%)' : '');
        const w = wordNode({ pre: p.id, stem: root, kind, t, big: true });
        replace(cs.slot, w);
        joinFrom(btn, w);
        replace(say, h('p', { class: 'wb-res is-ok' }, h('span', { lang: langAttr(), dir: dirAttr() }, `${p.id}-`), `: ${p.short}.`));
      } else {
        btn.classList.add('is-wrongpick'); nudge(btn);
        const right = cs.chips.get(p.id); right?.classList.add('is-answer');
        sc.play();
        const q = d.P.get(pre);
        replace(say, h('p', { class: 'wb-res is-bad' }, t('build.see.was', { p: `${p.id}-` }), ' ', p.short, '.'), h('p', { class: 'caption' }, h('span', { lang: langAttr(), dir: dirAttr() }, `${pre}-`), ` ${q ? q.short : ''}.`));
      }
      announce(`${ok ? t('build.right') : t('build.wrong')} ${p.id}-: ${p.short}`);
      setActions(again, nextBtn());
    }
    return { primary: () => { if (answered) next(); }, focus: () => cs.chips.values().next().value?.focus({ preventScroll: true }) };
  }

  // PX say: what does it do, does it split?
  function pxSay(/** @type {any} */ p) {
    const root = rootOf(p.id);
    const show = h('button', { type: 'button', class: 'btn btn-primary pressable wb-next', onclick: () => reveal() }, t('build.show'), h('kbd', null, '↵'));
    replace(cbody, meta(false, t('build.where.prefix')), h('p', { class: 'wb-big', lang: langAttr(), dir: dirAttr() }, `${p.id}-`), h('p', { class: 'prompt-hint' }, t('build.say.ask')));
    setActions(show);
    let shown = false;
    function reveal() {
      if (shown) return; shown = true;
      const rec = cardsOf(store)[`PX:${p.id}.say`];
      const row = gradeRow({ t, label: t('build.say.grade'), when: whenFor(ctx, rec, t), onGrade: g => { record(g, { mode: 's' }); setActions(nextBtn()); } });
      cbody.append(prefixCard(d, p, root, t), row.el);
      setActions();
      cur.key = (/** @type {KeyboardEvent} */ e) => row.key(e);
      row.focus();
    }
    return { primary: () => (shown ? null : reveal()), key: () => false };
  }

  // PD: predict, then the reveal
  function pd(/** @type {any} */ v) {
    const p = d.P.get(v.pre), r = d.R.get(v.root);
    let guess = /** @type {string | null} */ (null), shown = false;
    const chips = h('div', { class: 'wb-guess', role: 'group', 'aria-label': t('build.predict.can') }, [['T', 'build.predict.yes'], ['M', 'build.predict.partly'], ['O', 'build.predict.no']].map(([g, key]) => {
      const b = h('button', { type: 'button', class: 'chip pressable', 'aria-pressed': 'false', onclick: () => { guess = g; chips.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); } }, t(key));
      return b;
    }));
    const word = wordNode({ pre: v.pre, stem: bare(v.inf).slice(v.pre.length), kind: v.kind, t, big: true });
    const calib = h('div', { class: 'wb-calib' }, h('p', { class: 'label' }, t('build.predict.ask')), chips);
    replace(cbody, meta(!cardsOf(store)[`PD:${v.id}`]?.reps, t('build.where.verb')), h('p', { class: 'wb-vq' }, word, h('span', { 'aria-hidden': 'true' }, '?')),
      h('p', { class: 'wb-vsum' }, h('span', { lang: langAttr(), dir: dirAttr() }, `${v.pre}-`), ` ${p.short}  +  `, h('span', { lang: langAttr(), dir: dirAttr() }, r.id), ` ${r.en}`), calib);
    if (v.kind === 's') play(word.querySelector('.wb-dot'), [{ opacity: 0, transform: 'scale(0)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 420, easing: css('--spring-pop') }); else weld(word);
    const show = h('button', { type: 'button', class: 'btn btn-primary pressable wb-next', onclick: () => reveal() }, t('build.predict.show'), h('kbd', null, '↵'));
    setActions(show);
    function reveal() {
      if (shown) return; shown = true;
      const id = `PD:${v.id}`;
      if (guess) logCalib(store, { id, guess, truth: v.grade, day: c.today });
      calib.remove();
      const row = gradeRow({ t, label: t('build.grade.know'), when: whenFor(ctx, cardsOf(store)[id] || null, t), onGrade: g => { record(g, { mode: 's' }); setActions(nextBtn()); } });
      cbody.append(verbReveal({ d, v, guess, t, ctx }), row.el);
      setActions();
      cur.key = (/** @type {KeyboardEvent} */ e) => row.key(e);
      row.focus();
    }
    return { primary: () => (shown ? null : reveal()), key: () => false };
  }

  // SX: the article an ending gives (nouns), or what it makes (adjectives, self-graded)
  function sx(/** @type {any} */ s, /** @type {boolean} */ isNew) {
    const examples = d.c.chains.flatMap((/** @type {any} */ ch) => ch.nodes.filter((/** @type {any} */ n) => n.add === s.id && n.side === 'suf')).slice(0, 3);
    const exLine = h('p', { class: 'wb-ex', lang: langAttr(), dir: dirAttr() }, examples.map((/** @type {any} */ n, /** @type {number} */ i) => [i ? ' · ' : '', h('span', { class: 'wb-nw' }, pwAnswer(n))]));
    const ruleBox = () => h('div', { class: 'wb-rulebox' }, h('p', { class: 'wb-rule' }, h('b', { lang: langAttr(), dir: dirAttr() }, `${s.label}: `), s.rule), examples.length ? exLine : null);
    if (s.cls === 'adj' || !s.art) {
      replace(cbody, meta(isNew, t('build.where.suffix')), h('p', { class: 'wb-big', lang: langAttr(), dir: dirAttr() }, s.label), h('p', { class: 'prompt-hint' }, t('build.sx.adjAsk')));
      let shown = false;
      const reveal = () => {
        if (shown) return; shown = true;
        const row = gradeRow({ t, label: t('build.say.grade'), when: whenFor(ctx, cardsOf(store)[`SX:${s.id}`] || null, t), onGrade: g => { record(g, { mode: 's' }); setActions(nextBtn()); } });
        cbody.append(ruleBox(), row.el); setActions(); cur.key = (/** @type {KeyboardEvent} */ e) => row.key(e); row.focus();
      };
      setActions(h('button', { type: 'button', class: 'btn btn-primary pressable wb-next', onclick: reveal }, t('build.show'), h('kbd', null, '↵')));
      return { primary: () => (shown ? null : reveal()), key: () => false };
    }
    let answered = false;
    const res = h('div', { 'aria-live': 'polite' });
    const btns = h('div', { class: 'wb-artguess is-big', role: 'group', 'aria-label': t('build.sx.ask') }, ['der', 'die', 'das'].map(a => h('button', { type: 'button', class: 'pressable', lang: langAttr(), dir: dirAttr(), onclick: (/** @type {Event} */ e) => pick(a, /** @type {HTMLElement} */ (e.currentTarget)) }, a)));
    replace(cbody, meta(isNew, t('build.where.suffix')), h('p', { class: 'wb-big', lang: langAttr(), dir: dirAttr() }, s.label), h('p', { class: 'prompt-hint' }, t(isNew ? 'build.sx.askNew' : 'build.sx.ask')), btns, res);
    function pick(/** @type {string} */ a, /** @type {HTMLElement} */ btn) {
      if (answered) return; answered = true;
      const ok = a === s.art;
      record(ok ? 3 : 1);
      btns.querySelectorAll('button').forEach(b => { if (b.textContent === s.art) b.classList.add('is-right'); });
      if (ok) { haptic(); pop(btn); } else { btn.classList.add('is-bad'); nudge(btn); }
      replace(res, h('p', { class: ['wb-res', ok ? 'is-ok' : 'is-bad'] }, ok ? t('build.right') : t('build.sx.was', { art: s.art })), ruleBox());
      announce(`${ok ? t('build.right') : t('build.wrong')} ${s.label}: ${s.art}. ${s.rule}`);
      setActions(nextBtn());
    }
    setActions();
    return { primary: () => { if (answered) next(); }, key: (/** @type {KeyboardEvent} */ e) => { const i = ['1', '2', '3'].indexOf(e.key); if (i < 0 || answered) return false; e.preventDefault(); pick(['der', 'die', 'das'][i], /** @type {HTMLElement} */ (btns.children[i])); return true; } };
  }

  /** A PW word's node, its chain and its parent. @param {string} word */
  function pwNode(word) {
    for (const ch of d.c.chains) { const n = ch.nodes.find((/** @type {any} */ x) => x.word === word && x.side === 'suf' && x.from); if (n) return { n, chain: ch, parent: ch.nodes.find((/** @type {any} */ x) => x.id === n.from) }; }
    return null;
  }

  // PV, PS, PW: type it
  function typed(/** @type {any} */ o, /** @type {boolean} */ isNew) {
    let accept = /** @type {string[]} */ ([]), noun = false;
    const kids = [];
    if (o.kind === 'pv') {
      const v = o.v;
      accept = pvAccept(v);
      kids.push(meta(isNew, t('build.where.typeVerb')), h('p', { class: 'prompt' }, v.en),
        h('p', { class: 'prompt-hint' }, t(v.kind === 's' ? 'build.pv.hintS' : 'build.pv.hintI', { root: d.R.get(v.root).id })));
    } else if (o.kind === 'ps') {
      const g = gapped(o.f, o.form);
      accept = [g.answer];
      kids.push(meta(isNew, t('build.where.sentence')),
        h('p', { class: 'prompt wb-gapped', lang: langAttr(), dir: dirAttr() }, g.parts.map((/** @type {any} */ x, /** @type {number} */ i) => [i && !(x.text === '.' || x.text === '!' || x.text === '?') ? ' ' : '', x.gap ? h('span', { class: 'wb-gap', 'aria-label': t('build.gap') }, ' ') : x.text])),
        h('p', { class: 'prompt-hint' }, h('span', { lang: langAttr(), dir: dirAttr() }, o.f.inf), ` (${o.f.en}) · ${t(`build.form.${o.form}`)}`));
    } else if (o.kind === 'pf') {
      const f = o.f;
      accept = [`${f.art ? `${f.art} ` : ''}${f.word}`, ...(f.inf && f.inf !== f.word ? [f.inf] : [])]; noun = !!f.art;
      kids.push(meta(isNew, t('build.where.family')), h('p', { class: 'prompt' }, f.clue), h('p', { class: 'prompt-hint' }, t('build.pf.hint', { root: o.fam.root })));
    } else {
      const { n, parent } = o;
      accept = [pwAnswer(n)]; noun = !!n.art;
      kids.push(meta(isNew, t('build.where.word')), h('p', { class: 'prompt', lang: langAttr(), dir: dirAttr() }, pwPrompt(n, parent, d.S.get(n.add))), h('p', { class: 'prompt-hint' }, n.en));
    }
    typedNow = true;
    input.placeholder = o.kind === 'ps' ? t('build.ph.pieces') : o.kind === 'pv' || (o.kind === 'pf' && o.f.cls === 'verb') ? t('build.ph.verb') : noun ? t('build.ph.noun') : t('build.ph.word');
    input.value = '';
    const fb = h('div', { class: 'wb-fb', 'aria-live': 'polite' });
    const reveal = h('div', { class: 'reveal-answer' }, h('div', null, fb));
    replace(cbody, kids);
    fitPrompt(cbody.querySelector('.prompt'));   // a short prompt uses the band above the field (keyboard mode)
    replace(tail, o.kind === 'ps' ? h('p', { class: 'caption kb-hide' }, t('build.ps.howTo')) : null, reveal);
    answerEl.hidden = false;
    resetAnswer(answerEl, reveal);
    let done = false;
    const show = h('button', { type: 'button', class: 'btn btn-quiet pressable', onpointerdown: keep, onclick: () => submit(true) }, t(isNew ? 'build.showMe' : 'build.show'));
    const checkBtn = h('button', { type: 'button', class: 'btn btn-primary pressable wb-next', onpointerdown: keep, onclick: () => submit(false) }, t('build.check'), h('kbd', null, '↵'));
    setActions(show, checkBtn);
    async function submit(/** @type {boolean} */ shown) {
      if (done) return;
      const val = input.value.trim();
      if (!shown && !val) { input.focus({ preventScroll: true }); return; }
      done = true;
      const g = gradeTyped(shown ? '' : val, { accept, noun, lexicon: d.lex });
      const rating = typedRating(g, shown);
      record(/** @type {1|2|3} */ (rating), { flags: g.slip ? 'u' : shown ? 'r' : '', intro: shown && isNew });
      const right = g.right;
      /** @type {any[]} */ const out = [];
      if (g.ok) {
        out.push(h('p', { class: ['wb-res', g.slip ? 'is-warn' : 'is-ok'] }, g.slip ? t('build.typed.slip', { list: g.slips.map(x => x.expected).join(', ') }) : t('build.right')));
        if (g.slip) out.push(h('p', { class: 'answer-key', lang: langAttr(), dir: dirAttr() }, right));
      } else {
        out.push(h('p', { class: 'wb-res is-bad' }, shown ? t('build.typed.shown') : g.articleMiss ? t('build.typed.article') : t('build.wrong')));
        out.push(h('p', { class: 'answer-key', lang: langAttr(), dir: dirAttr() }, h('span', { class: 'caption' }, t('build.rightIs')), ' ', right));
      }
      replace(fb, out, explain(o));
      reveal.classList.add('is-open');
      if (g.ok) fxCorrect(answerEl, { hold: 0 }); else fxWrong(answerEl, { revealEl: reveal, haptics: !shown });
      announce(`${g.ok ? t('build.right') : t('build.wrong')} ${right}`);
      replace(actions, nextBtn());
      afterReveal(o, fb);
      // the answer opened above the field: into view
      const into = () => { if (alive && fb.isConnected) revealEl(fb, { block: 'nearest', avoid: answerEl }); };
      requestAnimationFrame(into); setTimeout(into, 320);
    }
    return { primary: () => (done ? next() : submit(false)), enter: () => { if (done) next(); else if (input.value.trim()) submit(false); },
      focus: () => input.focus({ preventScroll: true }), key: () => false };
  }
  /** What the reveal of a typed card shows under the answer. @param {any} o */
  function explain(o) {
    if (o.kind === 'pv') {
      const v = o.v;
      return h('div', { class: 'wb-explain' }, h('p', { class: 'wb-vq' }, wordNode({ pre: v.pre, stem: bare(v.inf).slice(v.pre.length), kind: v.kind, t, big: true })), exampleNode(v), h('p', { class: 'caption' }, v.exEn, ' · ', h('span', { lang: langAttr(), dir: dirAttr() }, `${v.aux} ${v.pp}`)),
        familyLink(ctx, v.lemma, { inRound: true, keep }));
    }
    if (o.kind === 'pf') {
      const f = o.f;
      return h('div', { class: 'wb-explain' }, h('p', { class: 'wb-vq' }, formWord(f, { t, cls: 'is-big' })), f.ex ? h('p', { class: 'wb-ex', lang: langAttr(), dir: dirAttr() }, f.ex) : null,
        f.exEn ? h('p', { class: 'caption' }, f.exEn) : null, familyLink(ctx, f.lemma, { inRound: true, keep }));
    }
    if (o.kind === 'ps') {
      const tr = tray(o.f, t);
      const stage = h('div', { class: 'wb-mstage is-inline' }, tr.el);
      return h('div', { class: 'wb-explain' }, stage, ruleNode(o.f, o.form, t), tileLegend(t));
    }
    const box = h('div', { class: 'wb-tree is-inline' });
    return h('div', { class: 'wb-explain' }, box, familyLink(ctx, o.n.lemma, { inRound: true, keep }));
  }
  /** Motion after the reveal: the machine plays the answer from the infinitive; the chain grows the word. @param {any} o @param {HTMLElement} fb */
  function afterReveal(o, fb) {
    if (o.kind === 'ps') {
      const stage = /** @type {HTMLElement | null} */ (fb.querySelector('.wb-mstage'));
      const inf = /** @type {HTMLElement | null} */ (fb.querySelector('.wb-inf'));
      if (stage && inf) requestAnimationFrame(() => fromTray(stage, o.f, o.form, inf, t));
    } else if (o.kind === 'pw') {
      const box = /** @type {HTMLElement | null} */ (fb.querySelector('.wb-tree'));
      if (!box) return;
      const ids = new Set();
      for (let x = o.n; x; x = o.chain.nodes.find((/** @type {any} */ y) => y.id === x.from)) ids.add(x.id);
      drawTree({ d, t, chain: o.chain, shown: ids, answered: new Map(), guess: false, box, fresh: o.n.id, interactive: false });
    } else if (o.kind === 'pv') {
      const w = /** @type {HTMLElement | null} */ (fb.querySelector('.wb-word'));
      if (w && o.v.kind === 'i') weld(w); else if (w) play(w.querySelector('.wb-dot'), [{ opacity: 0, transform: 'scale(0)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 420, easing: css('--spring-pop') });
    }
  }

  // ---------- keys ----------
  const onKey = (/** @type {KeyboardEvent} */ e) => {
    if (!alive) return;
    if (document.querySelector('dialog[open]')) return;   // a sheet over the round (a word's family) has the keys
    if (e.key === 'Escape') { e.preventDefault(); end(); return; }
    if (cur && cur.key && cur.key(e)) return;
    const tag = /** @type {HTMLElement} */ (e.target).tagName;
    if (e.key === 'Enter' && !(tag === 'INPUT' && (/** @type {HTMLElement} */ (e.target)).classList.contains('answer-input')) && tag !== 'A' && !e.isComposing) {
      const nb = /** @type {HTMLButtonElement | null} */ (actions.querySelector('.wb-next'));
      // Enter on a chip or an unpicked grade is that button's own click; anywhere else it is the main action
      const own = tag === 'BUTTON' && e.target !== nb && !(/** @type {HTMLButtonElement} */ (e.target)).disabled && !(/** @type {HTMLElement} */ (e.target)).classList.contains('is-picked');
      if (own) return;
      e.preventDefault();
      if (nb) nb.click(); else cur?.primary?.();
    }
  };
  document.addEventListener('keydown', onKey);

  function minutes() { return Math.min(30, (performance.now() - t0) / 60000); }
  function cleanup() { alive = false; finishAll(); document.removeEventListener('keydown', onKey); unfit(); }
  function end() {
    if (!alive) return;
    cleanup();
    addActivity(store, c.today, { minutes: minutes(), kind: 'build' });
    const done = round.results.filter((/** @type {any} */ r) => r.first).length;
    ctx.go(backTo);
    setTimeout(() => ctx.toast(t('build.saved.round', { n: done, total: round.planned })), 60);
  }
  function finish() {
    cleanup();
    store.update(KV, (/** @type {any} */ s) => ({ ...(s || {}), round: null }), {});
    addActivity(store, c.today, { minutes: minutes(), rounds: 1, kind: 'build' });
    countRound(store, c.today);
    restore();
    // each card's first real answer (a new card's study view is not an answer)
    /** @type {Map<string, any>} */ const firstOf = new Map();
    for (const r of round.results) if (!r.intro && !firstOf.has(r.id)) firstOf.set(r.id, r);
    const firsts = [...firstOf.values()];
    const right = firsts.filter((/** @type {any} */ r) => r.ok).length;
    const missed = [...new Set(firsts.filter((/** @type {any} */ r) => !r.ok).map((/** @type {any} */ r) => r.id))];
    const later = todayOf(ctx, d, k);
    const more = later.dueIds.length + later.budget.newLeft > 0;
    const fig = h('p', { class: 'wb-figure tnum' }, '0');
    const done = h('div', { class: 'wb stack wb-done' },
      h('p', { class: 'label' }, t('build.roundDone')), h('h1', { class: 'sr-only' }, t('build.roundDone')),
      h('div', { class: 'wb-donefig' }, fig, h('p', { class: 'caption' }, t('build.ofRight', { n: firsts.length }))),
      missed.length ? h('section', { class: 'wb-missed' }, h('h2', null, t('build.missed')), h('ul', { class: 'list' }, missed.map(id => h('li', { class: 'list-item', lang: langAttr(), dir: dirAttr() }, label(id))))) : null,
      h('p', { class: 'caption' }, more ? t('build.more', { due: later.dueIds.length, n: later.budget.newLeft }) : t('build.allDone')),
      h('div', { class: 'wb-done-actions' }, more ? h('a', { class: 'btn btn-primary pressable', href: `#/practice/build/round?kind=${kind === 'pick' || kind === 'drill' ? 'review' : kind}&r=${Date.now()}` }, t('build.another')) : null,
        h('a', { class: ['btn', 'pressable', !more && 'btn-primary'], href: `#${backTo}` }, backTo === '/today' ? t('build.toToday') : t('build.toHub'))));
    replace(el, done);
    countTo(fig, right, { from: 0 });
    done.querySelector('h1')?.focus({ preventScroll: true });
  }
  /** A card id as a line of German for the done screen. @param {string} id */
  function label(id) {
    let m;
    if ((m = /^PX:([^.]+)/.exec(id))) return `${m[1]}-`;
    if ((m = /^P[DV]:(.+)$/.exec(id))) return d.V.get(m[1])?.inf || id;
    if ((m = /^PS:(.+)\.(\w+)$/.exec(id))) { const f = d.F.get(m[1]); return f ? sentenceOf(f.forms[m[2]] || [], f.kind) : id; }
    if ((m = /^SX:(.+)$/.exec(id))) return d.S.get(m[1])?.label || id;
    if ((m = /^PW:(.+)$/.exec(id))) { const hit = pwNode(m[1]); return hit ? pwAnswer(hit.n) : m[1]; }
    if (/^PF:/.test(id)) { const hit = pfForm(id); return hit ? `${hit.f.art ? `${hit.f.art} ` : ''}${hit.f.word}` : id.slice(3); }
    return id;
  }
  function drawNothing() {
    restore();
    replace(el, h('div', { class: 'wb stack wb-done' }, h('p', { class: 'label' }, t('build.round')), h('h1', null, t('build.nothing')),
      h('p', { class: 'lead' }, st.budget.newPerDay === 0 ? t('build.nothing.noNew') : t('build.nothing.detail')),
      h('div', { class: 'wb-done-actions' }, h('a', { class: 'btn btn-primary pressable', href: '#/practice/build' }, t('build.toHub')))));
  }

  // test hook (localhost only)
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) /** @type {any} */ (window).__build = { get round() { return round; }, get cur() { return cur; } };
  await draw(true);
  return () => { cleanup(); restore(); };
}

export { buildLine, swapLine, ruleNode, landArticle, pieces, scene, joinFrom };
