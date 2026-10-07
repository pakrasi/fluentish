/* Speaking situations (#/practice/situations[/round?pick=…], domain/sim.js for the rules).
     #/practice/situations                      the picker: today's round, levels, situations by function
     #/practice/situations/round?pick=mixed|level:B1|fn:decline[&from=today]   a round, full screen

   A card, about 10 to 15 seconds: the situation lands and the other person's line plays. It is heard first: its words
   stay behind "Show the words" (journey #10: the Hören half of a conversation is listening, not reading), and they
   show at once with reduced motion or when no audio plays; a small waveform moves while it plays. He answers out
   loud, to himself; with "Check with the mic" on (it replaced Say it aloud), a tap records the answer and the phone's
   transcript is checked for the chunk and the Say it aloud checks (sim.js micCheck), which suggest a grade;
   Show answer (Space) unfolds the model answer with its chunk marked and plays it in a second voice; he grades
   himself with four big buttons (keys 1 to 4, Enter or Space = Good) and the card is scheduled in deck 'speak'.
   Good and Easy land the item's cell in the round strip in accent; three or more in a row send a ripple back
   through the strip. The done screen lays out the round's chunks as chat bubbles.

   Motion is the kit's: swap() between cards, the .reveal-answer unfold, segments(), Field ripples, haptic(); the
   rest is CSS on the kit's tokens, so reduced motion turns every move into a fade or a jump. */
import { h, replace, announce } from '../../core/dom.js';
import { notice, section } from '../../core/ui.js';
import { icon } from '../../core/icons.js';
import { swap, reduced, countTo } from '../../core/motion.js';
import { gradeRow } from '../shared/selfgrade.js';
import { progressOf, drawProgress, againRow } from '../shared/progress.js';
import { doneHero } from '../shared/done-hero.js';
import { Field } from '../../core/brand.js';
import * as RS from '../../domain/roundsize.js';
import * as S from '../../domain/sim.js';
import { loadBank, simState, simCards, setStart, saveGrade, saveRound, finishRound, refreshSimStats, updateSim } from '../shared/sim-data.js';
import { playLine, stopLine } from './sim-audio.js';
import { simToday } from '../../domain/allowance.js';
import { forecaster, tz, loadData } from '../shared/data.js';
import { recallBar } from '../shared/recall-bar.js';
import { knowButton, isKnowKey, knowCard, knownResult } from '../shared/iknow.js';
import { typeCheck, situationItem } from '../shared/typecheck.js';
import { speech } from '../../services/speech.js';
import { asrLocale, dirAttr } from '../../core/lang.js';
import { session } from '../shared/data.js';
import { langAttr } from '../../core/lang.js';
import { meter, holdable, logAttempt } from './mic.js';
import { fitToKeyboard, keep, reveal as revealEl } from '../../core/keyboard.js';

const pct = (/** @type {number} */ x) => new Intl.NumberFormat('en-GB', { style: 'percent', maximumFractionDigits: 0 }).format(x || 0);
const back = (/** @type {string} */ href, /** @type {string} */ text) => h('a', { class: 'pr-backlink pressable', href }, icon('prev', { size: 16 }), text);
const roundMin = (/** @type {number} */ n) => Math.max(1, Math.ceil(n * 0.2));
const fnName = (/** @type {any} */ bank, /** @type {string} */ fn) => bank.functions?.[fn] || fn;

/** @param {HTMLElement} el @param {import('../contract.js').ViewCtx} ctx @param {string[]} rest */
export function mountSim(el, ctx, rest) {
  return rest[0] === 'round' ? mountRound(el, ctx) : mountPicker(el, ctx);
}

/* ------------------------------------------------------------------ */
/* Picker                                                              */
/* ------------------------------------------------------------------ */

/** @param {HTMLElement} el @param {import('../contract.js').ViewCtx} ctx */
async function mountPicker(el, ctx) {
  const { t, store } = ctx;
  let alive = true, pending = /** @type {Promise<void> | null} */ (null);
  const head = () => [back('#/practice/speak', t('practice.speak.title')), h('div', { class: 'page-head' }, h('h1', null, t('practice.sim')))];
  replace(el, h('div', { class: 'practice sim stack' }, head(), h('p', { class: 'caption' }, t('practice.loading'))));

  async function render() {
    let b;
    try { b = await loadBank(ctx); } catch {
      if (alive) replace(el, h('div', { class: 'practice sim stack' }, head(), notice({ kind: 'warning', children: [h('p', null, t('practice.sim.loadFailed'))] })));
      return;
    }
    if (!alive) return;
    const c = ctx.clock.ctx(), settings = ctx.settings();
    const cards = simCards(store), sim = simState(store);
    const start = S.startFor(sim.start, settings.level);
    const states = S.levelStates(b.items, cards, start);
    const open = S.openLevels(states);
    const today = simToday({ store, c, settings });
    const saved = S.resumable(sim.round, c.today, Date.now()) ? sim.round : null;
    const comp = S.compose({ items: b.items, cards, c, pick: { kind: 'mixed' }, start, newLeft: today.newLeft });

    // ---- today's round ----
    const dueEl = h('span', { class: 'figure tnum' }, String(today.due));
    const left = saved ? saved.queue.length - saved.i : 0;
    const label = saved ? t('practice.finish', { n: left })
      : comp.ids.length ? (comp.extra ? t('practice.sim.ahead', { n: comp.ids.length }) : t('practice.sim.start', { n: comp.ids.length, min: roundMin(comp.ids.length + comp.fresh) })) : null;
    const startHref = saved ? `#/practice/situations/round?pick=${encodeURIComponent(saved.pick)}` : '#/practice/situations/round?pick=mixed';
    const startBtn = label ? h('a', { class: 'btn btn-primary btn-wide pressable', href: startHref, id: 'sim-start' }, label) : null;
    const queue = h('div', { class: 'pr-queue' },
      h('div', { class: 'pr-queue-top' },
        h('p', { class: 'pr-due' }, dueEl, h('span', { class: 'label' }, t('practice.dueToday', { n: today.due }))),
        h('p', { class: 'label pr-new' }, c.newItems ? t('practice.sim.newLeft', { n: today.newLeft }) : t('practice.sim.noNew'))),
      comp.ids.length || saved ? null : h('p', { class: 'pr-empty' }, t('practice.sim.nothingPick')),
      comp.fresh && !saved ? h('p', { class: 'caption' }, t('practice.sim.twice')) : null,
      startBtn ? h('div', { class: 'pr-queue-btn' }, startBtn) : null);

    // ---- levels ----
    const levelRows = states.map((x, i) => {
      const name = `${x.lv} · ${t('practice.sim.level.items', { n: x.n })}`;
      const trail = t('practice.sim.level.learnt', { n: x.learnt, total: x.n });
      if (x.open) {
        return h('a', { class: 'pr-area pressable', href: `#/practice/situations/round?pick=level:${x.lv}`, 'aria-label': `${name}, ${trail}` },
          h('span', { class: 'pr-area-top' }, h('span', { class: 'row-title' }, name), h('span', { class: 'row-trail tnum' }, trail)),
          recallBar(x.n ? x.learnt / x.n : 0, x.n ? x.seen / x.n : 0, t('practice.sim.level.bar', { lv: x.lv, learnt: x.learnt, n: x.n })), icon('next', { size: 16 }));
      }
      return h('div', { class: 'pr-area sim-locked' },
        h('span', { class: 'pr-area-top' }, h('span', { class: 'row-title' }, name),
          h('span', { class: 'row-trail caption' }, t('practice.sim.level.locked', { prev: states[i - 1]?.lv || '', pct: pct(S.STEADY) }))),
        h('button', { type: 'button', class: 'btn btn-quiet pressable sim-jump', onclick: () => choose(x.lv) }, t('practice.sim.level.startHere', { lv: x.lv })));
    });

    // ---- by situation: what is open now as rows with a learnt track, what opens later as one quiet list ----
    const fns = Object.keys(b.bank.functions || {});
    const fnRows = [], later = [];
    for (const fn of fns) {
      const mine = b.items.filter(it => it.fn === fn);
      const avail = mine.filter(it => open.has(it.lv) || cards[it.id]?.reps);
      if (!avail.length) { later.push(fnName(b.bank, fn)); continue; }
      const due = S.dueCount(Object.fromEntries(mine.map(it => [it.id, cards[it.id]]).filter(([, r]) => r)), c);
      const learntN = avail.filter(it => S.learnt(cards[it.id])).length, seenN = avail.filter(it => cards[it.id]?.reps).length;
      const sub = due ? t('practice.sim.fn.due', { n: due }) : t('practice.sim.fn.learnt', { n: learntN, total: avail.length });
      fnRows.push(h('a', { class: 'pr-area pressable', href: `#/practice/situations/round?pick=fn:${fn}`, 'aria-label': `${fnName(b.bank, fn)}, ${sub}` },
        h('span', { class: 'pr-area-top' }, h('span', { class: 'row-title' }, fnName(b.bank, fn)), h('span', { class: 'row-trail tnum' }, sub)),
        recallBar(avail.length ? learntN / avail.length : 0, avail.length ? seenN / avail.length : 0, t('practice.sim.level.bar', { lv: fnName(b.bank, fn), learnt: learntN, n: avail.length })), icon('next', { size: 16 })));
    }
    const view = h('div', { class: ['practice', 'sim', 'stack', startBtn && 'has-dock'] },
      head(), h('p', { class: 'lead sim-lead' }, t('practice.sim.lead')),
      queue,
      section(t('practice.sim.functions'), h('p', { class: 'caption section-sub' }, t('practice.sim.fn.openNow', { n: fnRows.length })), h('div', { class: 'pr-areas' }, fnRows),
        later.length ? h('details', { class: 'sim-later' }, h('summary', { class: 'pressable' }, t('practice.sim.fn.later', { n: later.length })), h('p', { class: 'caption' }, later.join(' · '))) : null),
      section(t('practice.sim.levels'), h('div', { class: 'pr-areas' }, levelRows)));
    const hadFocus = document.activeElement === el.querySelector('h1');
    replace(el, view);
    if (hadFocus) view.querySelector('h1')?.focus({ preventScroll: true });
    countTo(dueEl, today.due, { from: 0, duration: 600 });
  }

  /** @param {string} lv */
  function choose(lv) {
    setStart(store, lv);
    refreshSimStats(ctx);
    announce(t('practice.sim.level.started', { lv }));
  }

  const rerender = () => { if (!pending) pending = render().finally(() => { pending = null; }); };
  await render();
  refreshSimStats(ctx);
  const offs = [store.subscribe(`cards:${S.DECK}`, rerender), store.subscribe(S.KV, rerender), ctx.bus.on('settings:changed', rerender)];
  return () => { alive = false; offs.forEach(f => f()); };
}

/* ------------------------------------------------------------------ */
/* Round                                                               */
/* ------------------------------------------------------------------ */

/** The waveform: five bars that move while a line plays (CSS, .is-playing). */
const wave = () => h('span', { class: 'sim-wave', 'aria-hidden': 'true' }, [0, 1, 2, 3, 4].map(i => h('i', { style: { '--i': String(i) } })));

/** Words of a line as spans, so the line can appear word by word. @param {string} text */
function wordSpans(text) {
  const words = String(text).split(/(\s+)/);
  let k = 0;
  return words.map(w => (/^\s+$/.test(w) ? w : h('span', { class: 'sim-w', style: { '--i': String(k++) } }, w)));
}

/** @param {HTMLElement} el @param {import('../contract.js').ViewCtx} ctx */
async function mountRound(el, ctx) {
  const { t, store } = ctx;
  document.body.dataset.chrome = 'off';
  document.body.classList.add('pr-in-round');
  const restore = () => { document.body.dataset.chrome = 'on'; document.body.classList.remove('pr-in-round'); };
  const backTo = ctx.query.get('from') === 'today' ? '/today' : '/practice/situations';
  let b;
  try { b = await loadBank(ctx); } catch {
    replace(el, h('div', { class: 'practice stack page-pad' }, h('h1', null, t('practice.sim')), h('p', null, t('practice.sim.loadFailed')), h('a', { class: 'btn pressable', href: '#/practice/situations' }, t('practice.back'))));
    return restore;
  }
  const bank = b.bank, byId = b.byId;
  const pick = S.parsePick(ctx.query.get('pick'));
  let c = ctx.clock.ctx();
  const settings = ctx.settings();
  const sim = simState(store);
  // the round size picker's choice (picker.js, domain/roundsize.js); a saved round of another size is not resumed
  const sized = RS.parseSize(ctx.query.get('size'));
  const want = sized ? RS.sizeKey(sized) : null;
  /** @type {any} */ let round = S.resumable(sim.round, c.today, Date.now()) && sim.round.pick === S.pickKey(pick) && (!want || (sim.round.size || 'rec') === want) ? structuredClone(sim.round) : null;
  if (!round) {
    const o = { items: b.items, cards: simCards(store), c, pick, start: S.startFor(sim.start, settings.level), newLeft: simToday({ store, c, settings }).newLeft };
    const ids = sized && sized !== 'rec' ? RS.pick(S.buckets(o), sized).ids : S.compose(o).ids;
    if (!ids.length) return drawEmpty();
    round = S.startRound(ids, pick, c.today, Date.now());
    if (want) round.size = want;
    saveRound(store, round);
  }
  const roundT0 = performance.now();

  // ---------- layout ----------
  const segs = h('div', { class: 'segments', 'aria-label': t('practice.sim.progress') });
  const count = h('span', { class: 'caption tnum' });
  const endBtn = h('button', { type: 'button', class: 'btn btn-quiet pressable pr-end', onclick: () => end() }, t('practice.sim.end'), h('kbd', null, 'Esc'));
  const stripIds = [...new Set(round.queue.map((/** @type {any} */ q) => q.id))];
  const stripEl = h('canvas', { class: 'field pr-strip', style: { '--w': `${Math.min(stripIds.length, 24) * 8 - 2}px` } });
  const again = againRow();
  const top = h('div', { class: 'pr-top' }, segs, again, h('div', { class: 'pr-top-row' }, count, stripEl, endBtn));

  const meta = h('span', { class: 'label' });
  const setup = h('p', { class: 'sim-setup' });
  const line = h('p', { class: 'sim-line', lang: langAttr(), dir: dirAttr(), id: 'sim-line' });
  // the line is heard first; its words wait behind this button (journey #10)
  const wordsBtn = h('button', { type: 'button', class: 'btn btn-quiet pressable sim-words', 'aria-expanded': 'false', 'aria-controls': 'sim-line', onclick: () => showWords() }, t('practice.sim.showWords'));
  const playBtn = h('button', { type: 'button', class: 'sim-play pressable', 'aria-label': t('practice.sim.play'), onclick: () => playOther() }, wave());
  const them = h('div', { class: 'sim-bubble sim-them' }, playBtn, h('div', { class: 'sim-linebox' }, line, wordsBtn));
  const status = h('p', { class: 'caption sim-status', 'aria-live': 'polite' });
  const goal = h('p', { class: 'sim-goal' });
  const say = h('p', { class: 'caption sim-say' }, t('practice.sim.say'));
  const answerLine = h('p', { class: 'sim-line', lang: langAttr(), dir: dirAttr() });
  const ansPlay = h('button', { type: 'button', class: 'sim-play pressable', 'aria-label': t('practice.sim.playAnswer'), onclick: () => playAnswer() }, wave());
  const you = h('div', { class: 'sim-bubble sim-you' }, answerLine, ansPlay);
  const also = h('div', { class: 'sim-also' });
  const heardSlot = h('div', { class: 'sim-heardslot' });
  const reveal = h('div', { class: 'reveal-answer sim-reveal' }, h('div', null, heardSlot, h('p', { class: 'label sim-model' }, t('practice.sim.model')), you, also));
  // Check with the mic (it replaced Say it aloud): a switch on the card, kept for the next rounds (kv speak.sim mic)
  const sp = speech();
  const canMic = sp.canListen();
  let micOn = canMic && !!simState(store).mic;
  /** @type {any} */ let live = null;
  // outdoors: the meter, the loud-room line, hold to talk (kv speak.sim hold), typing instead, and the unsure result
  let holdOn = canMic && !!simState(store).hold;
  const micLabel = h('p', { class: 'caption pr-mic-l', 'aria-live': 'polite' });
  const micBtn = h('button', { type: 'button', class: 'pr-mic sim-mic pressable', 'aria-label': t('practice.sim.mic.say') }, icon('mic', { size: 26 }));
  holdable(micBtn, { isHold: () => holdOn, onDown: () => listen(true), onUp: () => { if (live) live.stop(); }, onClick: () => listen(false) });
  const level = meter();
  const loudLine = h('p', { class: 'caption pr-loud', hidden: true }, t('practice.speak.loud'));
  const holdToggle = h('button', { type: 'button', class: 'btn btn-quiet pressable pr-holdtoggle', 'aria-pressed': String(holdOn), onclick: () => setHold(!holdOn) }, t('practice.speak.hold'));
  const typeBtn = h('button', { type: 'button', class: 'btn btn-quiet pressable', onclick: () => openType() }, t('practice.speak.typeInstead'));
  const typeIn = /** @type {HTMLInputElement} */ (h('input', { type: 'text', class: 'input', lang: langAttr(), dir: dirAttr(), 'aria-label': t('practice.speak.typeLabel'), autocomplete: 'off', autocapitalize: 'sentences', spellcheck: 'false' }));
  const typeForm = h('form', { class: 'pr-type', hidden: true, onsubmit: (/** @type {Event} */ e) => { e.preventDefault(); checkTyped(); } },
    typeIn, h('button', { type: 'submit', class: 'btn pressable', onpointerdown: keep }, t('practice.speak.typeCheck')));
  const unsureBox = h('div', { class: 'pr-unsure', hidden: true });
  const micBox = h('div', { class: 'pr-micbox sim-micbox', hidden: true }, micBtn, level.el, micLabel, loudLine,
    h('div', { class: 'pr-micopts' }, holdToggle, typeBtn), typeForm, unsureBox);
  const micToggle = canMic ? h('button', { type: 'button', class: 'btn btn-quiet pressable sim-mictoggle', 'aria-pressed': String(micOn), onclick: () => setMic(!micOn) },
    icon('mic', { size: 16 }), t('practice.sim.mic')) : null;
  const card = h('article', { class: 'card pr-card sim-card' }, h('div', { class: 'card-meta' }, meta, micToggle), setup, them, status, goal, say, micBox, reveal);

  const showBtn = h('button', { type: 'button', class: 'btn btn-primary pressable pr-primary sim-show', onclick: () => doReveal() }, t('practice.sim.show'), h('kbd', null, 'Space'));
  const grades = gradeRow({ t, label: t('practice.sim.how'), onGrade: g => grade(g) });
  const knowBtn = knowButton(t, () => knowThis());
  const actions = h('div', { class: 'card-actions pr-actions sim-actions' }, knowBtn, showBtn, grades.el);
  const scroll = h('div', { class: 'pr-scroll' }, card);
  const box = h('div', { class: 'pr-round sim-round is-docked', role: 'region', 'aria-label': t('practice.sim.round') }, top, scroll, actions);
  const h1 = h('h1', { class: 'sr-only' }, t('practice.sim.round'));
  replace(el, h1, box);

  const unfit = fitToKeyboard(box);   // the rows sit on the keyboard (core/keyboard.js)

  // the strip: one cell per situation of the round; answers already given in a resumed round show
  const firstG = new Map();
  for (const r of round.results) if (r.first && !firstG.has(r.id)) firstG.set(r.id, r.g);
  const cellFor = (/** @type {number} */ g) => (g >= 3 ? 3 : g === 2 ? 2 : 1);
  const strip = new Field(/** @type {HTMLCanvasElement} */ (stripEl), stripIds.map(id => (firstG.has(id) ? cellFor(firstG.get(id)) : 0)), { cell: 6, gap: 2, label: null });

  // ---------- per card ----------
  /** @type {S.Item | null} */ let item = null;
  let state = 'think', t0 = 0, alive = true, busy = false;
  /** @type {(number|null)[]} */ let when = [];

  function updateTop(answered = false) {
    const p = progressOf(round, answered, r => r.g > 1);
    drawProgress(segs, again, p);
    count.textContent = p.onAgain ? t('practice.countAgain', { n: p.k, total: p.n }) : t('practice.sim.of', { k: p.k, n: p.n });
  }

  function fillCard() {
    const q = round.queue[round.i];
    item = /** @type {S.Item} */ (byId.get(q.id));
    meta.textContent = `${item.lv} · ${fnName(bank, item.fn)}`;
    setup.textContent = item.setup;
    replace(line, ...wordSpans(item.other.de));
    const words = line.querySelectorAll('.sim-w').length || 1;
    line.style.setProperty('--wstep', `${Math.round(Math.max(45, Math.min(110, 1500 / words)))}ms`);
    line.classList.remove('is-typed');
    // heard first: the words wait behind "Show the words"; with reduced motion they are always on screen
    line.hidden = !reduced();
    wordsBtn.hidden = !line.hidden;
    wordsBtn.setAttribute('aria-expanded', String(!line.hidden));
    them.classList.remove('is-playing');
    replace(heardSlot);
    stopListening();
    status.textContent = '';
    replace(goal, h('span', { class: 'label' }, t('practice.sim.goal')), ' ', item.goal);
    const [a0, ...more] = item.answers;
    const [pre, chunk, post] = S.chunkParts(a0);
    replace(answerLine, pre, h('mark', { class: 'sim-chunk' }, chunk), post);
    replace(also, ...(more.length ? [h('p', { class: 'label' }, t('practice.sim.also')), ...more.map(a => {
      const [p1, c1, p2] = S.chunkParts(a);
      return h('p', { class: 'sim-alt', lang: langAttr(), dir: dirAttr() }, p1, h('mark', { class: 'sim-chunk' }, c1), p2);
    })] : []));
    reveal.classList.remove('is-open');
    say.hidden = false;
    state = 'think';
    drawMic();
    showBtn.hidden = false; grades.reset();
    const cards = simCards(store);
    knowBtn.hidden = !!(cards[item.id]?.reps || q.re);
    when = S.preview(cards[item.id] || null, c, Date.now(), forecaster(cards, c));
    grades.set(when.map(w => (w == null ? t('practice.sim.inRound') : t('practice.sim.days', { n: w }))));
    updateTop();
    t0 = performance.now();
  }

  async function playOther() {
    if (!item) return;
    const res = await playLine({ content: ctx.content, file: item.other.audio, text: item.other.de,
      onStart: () => them.classList.add('is-playing'), onEnd: () => them.classList.remove('is-playing') });
    if (!alive) return;
    status.textContent = res === 'blocked' ? t('practice.sim.tapToPlay') : res === 'none' ? t('practice.sim.noAudio') : '';
    if (res === 'none') showWords();   // nothing to hear: the line is read on screen
  }

  /** The other person's words on screen (word by word, the kit's timing). */
  function showWords() {
    if (!item || !line.hidden) return;
    line.hidden = false;
    wordsBtn.hidden = true;
    wordsBtn.setAttribute('aria-expanded', 'true');
    if (!reduced()) { line.classList.remove('is-typed'); void line.offsetWidth; line.classList.add('is-typed'); }
    if (document.activeElement === wordsBtn) playBtn.focus({ preventScroll: true });
  }

  // ---------- Check with the mic ----------
  /** @param {boolean} on */
  function setMic(on) {
    micOn = on;
    micToggle?.setAttribute('aria-pressed', String(on));
    updateSim(store, s => ({ ...s, mic: on }));
    if (!on) stopListening();
    drawMic();
    announce(t(on ? 'practice.sim.mic.on' : 'practice.sim.mic.off'));
  }
  function drawMic() {
    micBox.hidden = !(micOn && state === 'think');
    micBtn.dataset.state = 'idle';
    micBtn.setAttribute('aria-pressed', 'false');
    micBtn.setAttribute('aria-label', holdOn ? t('practice.speak.hold') : t('practice.sim.mic.say'));
    micLabel.textContent = sp.blocked() ? t('practice.speak.err.blocked') : holdOn ? t('practice.speak.holdHint') : t('practice.sim.mic.tap');
    level.show(false);
    showLoud(sp.noise());
    typeForm.hidden = true; typeIn.value = '';
    unsureBox.hidden = true; replace(unsureBox);
  }
  /** @param {boolean} on */
  function setHold(on) {
    holdOn = on;
    holdToggle.setAttribute('aria-pressed', String(on));
    updateSim(store, s => ({ ...s, hold: on }));
    if (!live) drawMic();
  }
  /** The loud-room line, and hold to talk offered first. @param {any} a the room (domain/hearing.js ambient) */
  function showLoud(a) {
    const noisy = !!(a && a.noisy);
    loudLine.hidden = !noisy;
    holdToggle.classList.toggle('is-offered', noisy && !holdOn);
  }
  function openType() {
    if (state !== 'think') return;
    stopListening();
    typeForm.hidden = false;
    typeIn.focus();
  }
  function checkTyped() {
    const text = typeIn.value.trim();
    if (!item || state !== 'think' || !text) return;
    // typed text is what he meant: checked as written, with no allowance for the phone
    const chk = { ...S.micCheck(text, item, null), unsure: false };
    logAttempt(store, { where: 'sim', typed: true });
    showResult(chk, true);
  }
  function stopListening() { if (live) { const l = live; live = null; l.stop(); } }
  /** @param {boolean} [hold] hold to talk: until he lets go */
  async function listen(hold = false) {
    if (!item || state !== 'think' || busy) return;
    if (live) { live.stop(); micLabel.textContent = t('practice.speak.checking'); return; }
    stopLine();
    const it = item;
    unsureBox.hidden = true; typeForm.hidden = true;
    micBtn.dataset.state = 'listening'; micBtn.setAttribute('aria-pressed', 'true');
    const listening = hold ? t('practice.speak.holding') : t('practice.speak.listening');
    micLabel.textContent = listening;
    level.show(true);
    const mine = live = sp.listen({ lang: asrLocale(), hold, check: true, onLevel: (/** @type {number} */ x) => level.set(x),
      onInterim: (/** @type {string} */ x) => { micLabel.textContent = x; },
      onPhase: (/** @type {string} */ p, /** @type {any} */ a) => { micLabel.textContent = p === 'checking' ? t('practice.speak.checkingRoom') : listening; if (p === 'listening') showLoud(a); } });
    const res = await mine.done;
    if (live === mine) live = null;
    level.show(false);
    if (!alive || item !== it || state !== 'think') return;
    showLoud(res.ambient || sp.noise());
    if (!res.text) {
      micBtn.dataset.state = sp.blocked() ? 'error' : 'idle'; micBtn.setAttribute('aria-pressed', 'false');
      micLabel.textContent = sp.blocked() ? t('practice.speak.err.blocked') : res.error === 'network' ? t('practice.speak.err.network') : t('practice.speak.err.none');
      if (!sp.blocked()) logAttempt(store, { where: 'sim', heard: res, unsure: true, why: ['none'] });
      return;
    }
    const chk = S.micCheckHeard(res, it, session(store).cal || null);
    logAttempt(store, { where: 'sim', heard: res, unsure: chk.unsure, why: chk.why });
    if (chk.unsure) { showUnsure(chk); return; }
    showResult(chk, false);
  }
  const CHECK = () => /** @type {Record<string, string>} */ ({ true: t('practice.speak.ok'), false: t('practice.speak.bad'), off: t('practice.speak.off'), unsure: t('practice.speak.notSure') });
  /** @param {any} chk */
  function checksTable(chk) {
    const row = (/** @type {string} */ name, /** @type {any} */ v) => (v === 'not-in' || v == null ? null
      : h('tr', null, h('td', null, name), h('td', { class: v === true ? 'is-ok' : v === false ? 'is-bad' : 'caption' }, CHECK()[String(v)] || String(v))));
    return h('table', { class: 'pr-checks' }, h('tbody', null, row(t('practice.speak.c.phrase'), chk.chunk), row(t('practice.speak.c.verbFinalShort'), chk.verbFinal), row(t('practice.speak.c.fuerVor'), chk.fuerVor)));
  }
  /** The phone wasn't sure: what it heard, nothing marked wrong; retry, type, or Show answer and grade it himself. @param {any} chk */
  function showUnsure(chk) {
    micBtn.dataset.state = 'idle'; micBtn.setAttribute('aria-pressed', 'false');
    micLabel.textContent = '';
    const choices = h('div', { class: 'pr-micopts', hidden: true },
      h('button', { type: 'button', class: 'btn pressable', onclick: () => listen(false) }, t('practice.speak.tryAgain')),
      h('button', { type: 'button', class: 'btn pressable', onclick: () => openType() }, t('practice.speak.typeInstead')));
    const notMe = h('button', { type: 'button', class: 'btn btn-quiet pressable', onclick: () => {
      notMe.hidden = true; choices.hidden = false; logAttempt(store, { where: 'sim', misheard: true });
      /** @type {HTMLElement} */ (choices.firstChild).focus();
    } }, t('practice.speak.notWhatISaid'));
    replace(unsureBox, h('p', { class: 'caption' }, t('practice.speak.heard')), h('p', { class: 'pr-heard', lang: langAttr(), dir: dirAttr() }, `„${chk.text}“`),
      checksTable(chk), h('p', { class: 'caption' }, t('practice.speak.unsure')), notMe, choices);
    unsureBox.hidden = false;
    // Show answer from here: the reveal keeps what it heard, unmarked
    replace(heardSlot, h('div', { class: 'sim-heard' }, h('p', { class: 'caption' }, t('practice.speak.heard')), h('p', { class: 'pr-heard', lang: langAttr(), dir: dirAttr() }, `„${chk.text}“`),
      h('p', { class: 'caption' }, t('practice.speak.setAside'))));
    announce(t('practice.speak.unsure'));
  }
  /** A result he can trust (or typed): the checks, a suggested grade, and "That's not what I said" sets them aside.
   * @param {any} chk @param {boolean} typed */
  function showResult(chk, typed) {
    unsureBox.hidden = true;
    const notMe = typed ? null : h('button', { type: 'button', class: 'btn btn-quiet pressable', onclick: () => {
      logAttempt(store, { where: 'sim', misheard: true });
      replace(heard, h('p', { class: 'caption' }, t('practice.speak.youSaid')), h('p', { class: 'pr-heard', lang: langAttr(), dir: dirAttr() }, `„${chk.text}“`),
        h('p', { class: 'caption' }, t('practice.speak.setAside')));
      grades.show({ suggest: 3 });
    } }, t('practice.speak.notWhatISaid'));
    const heard = h('div', { class: 'sim-heard' },
      h('p', { class: 'caption' }, typed ? t('practice.speak.youTyped') : t('practice.speak.youSaid')), h('p', { class: 'pr-heard', lang: langAttr(), dir: dirAttr() }, `„${chk.text}“`),
      checksTable(chk), h('p', { class: 'caption' }, t('practice.sim.mic.grade')), notMe);
    replace(heardSlot, heard);
    doReveal(chk.suggest);
  }
  async function playAnswer() {
    if (!item) return;
    const a = item.answers[0];
    await playLine({ content: ctx.content, file: a.audio, text: a.de, onStart: () => you.classList.add('is-playing'), onEnd: () => you.classList.remove('is-playing') });
  }

  /** @param {1|2|3|4} [suggest] the grade to suggest: Good, or what the mic check found */
  function doReveal(suggest = 3) {
    if (state !== 'think' || busy) return;
    state = 'revealed';
    stopListening();
    showWords();
    reveal.classList.add('is-open');
    say.hidden = true; micBox.hidden = true;
    showBtn.hidden = true; knowBtn.hidden = true; grades.show({ suggest });   // the suggestion takes the focus, so it never drops to the page
    announce(item ? item.answers[0].de : '');
    playAnswer();
  }

  /** @param {1|2|3|4} g */
  function grade(g) {
    if (state !== 'revealed' || busy || !item) return;
    busy = true; state = 'graded';
    const ms = performance.now() - t0;
    const q = round.queue[round.i];
    const cards = simCards(store);
    const before = cards[item.id] ? structuredClone(cards[item.id]) : null;
    const isNew = !before || !before.reps;
    c = ctx.clock.ctx();
    const res = S.gradeCard({ rec: before, g, c, now: Date.now(), ms, forecast: forecaster(cards, c) });
    S.record(round, { id: item.id, g, isNew: isNew && !q.re, ms, reinsert: res.reinsert });
    saveGrade(store, { id: item.id, before, rec: res.rec, g, ms, c, tz: tz(), round, isNew: isNew && !q.re });
    updateTop(true);
    // the strip: Good and Easy land in accent; a run of three or more sends a ripple back through the cells
    const k = stripIds.indexOf(item.id);
    if (k >= 0) {
      if (g >= 3) strip.ripple(k, { state: 3 }); else if (!q.re || g === 1) strip.set(k, cellFor(g));
      const run = S.streak(round);
      if (g >= 3 && run >= 3 && !reduced()) {
        const cells = [...new Set(round.results.slice(-run).map((/** @type {any} */ r) => stripIds.indexOf(r.id)))].filter(x => x >= 0 && x !== k).reverse().slice(0, 6);
        cells.forEach((ci, n) => setTimeout(() => { if (alive) strip.ripple(ci, { state: 3 }); }, 90 * (n + 1)));
        box.classList.remove('is-streak'); void box.offsetWidth; box.classList.add('is-streak');
      }
    }
    stopLine();
    setTimeout(next, reduced() ? 120 : 260);
  }

  /** @type {HTMLElement | null} */ let checkEl = null;
  /** "I know this" on a new situation: Check by typing first (shared/typecheck.js), then marked known in deck 'speak'. */
  function knowThis() {
    if (state !== 'think' || busy || !item || knowBtn.hidden) return;
    state = 'typing';
    stopListening();
    knowBtn.hidden = true; showBtn.hidden = true;
    const back = () => { checkEl?.remove(); checkEl = null; state = 'think'; };
    const panel = typeCheck({ ctx, deck: S.DECK, id: item.id, item: situationItem(item), data: () => loadData(ctx),
      onKnown: () => { back(); markKnown(); },
      onClose: () => { back(); knowBtn.hidden = false; showBtn.hidden = false; showBtn.focus({ preventScroll: true }); } });
    checkEl = panel.el;
    card.append(checkEl);
    panel.focus();
    // with the keyboard up the panel sits at the bottom of the card, over the keyboard: what he is asked to say
    // (the goal line) goes right above it
    revealEl(them, { block: 'start', avoid: checkEl, instant: true });   // the line from its start when it fits with the goal,
    revealEl(goal, { avoid: checkEl });                    // and the goal in any case
  }
  function markKnown() {
    if (state !== 'think' || busy || !item) return;
    busy = true; state = 'graded';
    const id = item.id;
    knowCard(ctx, { deck: S.DECK, id });
    round.results.push(knownResult(id));
    updateTop(true);
    const k = stripIds.indexOf(id);
    if (k >= 0) strip.set(k, 2);
    announce(t('practice.know.announce'));
    stopLine();
    next('lift');
  }

  async function next(kind = 'forward') {
    if (!alive) return;
    if (!S.advance(round)) { finish(); return; }
    saveRound(store, round);
    await swap(() => { fillCard(); }, { kind, fallbackEl: card });
    scroll.scrollTop = 0;
    busy = false;
    showBtn.focus({ preventScroll: true });
    if (item) announce(line.hidden ? item.setup : `${item.setup} ${item.other.de}`);
    playOther();
  }

  function minutes() { return Math.min(30, (performance.now() - roundT0) / 60000); }
  function end() {
    cleanup();
    const n = round.results.length;
    saveRound(store, round.i < round.queue.length ? round : null);
    if (n) setTimeout(() => ctx.toast(t('practice.sim.saved', { n: new Set(round.results.map((/** @type {any} */ r) => r.id)).size })), 60);
    ctx.go(backTo);
  }
  function finish() {
    cleanup(false);   // the done hero brings the bars back (done-hero.js leaveRound)
    finishRound(store, round.day, minutes());
    drawDone(el, ctx, bank, byId, round, backTo, pick);
  }

  /** @param {KeyboardEvent} e */
  function onKey(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const onButton = e.target instanceof HTMLElement && e.target.closest('button, a');
    if (state === 'typing') return;   // the Check by typing panel has its own keys
    if (e.key === 'Escape') { e.preventDefault(); end(); return; }
    if (e.target instanceof HTMLElement && e.target.closest('input, textarea')) return;   // typing his answer
    if ((e.key === ' ' || e.key === 'Enter') && !onButton) {
      e.preventDefault();
      if (state === 'think') doReveal(); else if (state === 'revealed') grades.pick(grades.suggested);
      return;
    }
    if (state === 'revealed' && grades.key(e)) return;
    if (state === 'think' && isKnowKey(e, false) && !knowBtn.hidden) { e.preventDefault(); knowThis(); return; }
    if ((e.key === 'm' || e.key === 'M') && state === 'think' && micOn) { e.preventDefault(); listen(); return; }
    if ((e.key === 'w' || e.key === 'W') && state === 'think' && line.hidden) { e.preventDefault(); showWords(); return; }
    if ((e.key === 'r' || e.key === 'R') && state !== 'graded') { e.preventDefault(); if (state === 'revealed') playAnswer(); else playOther(); }
  }
  document.addEventListener('keydown', onKey);

  function cleanup(chrome = true) {
    if (!alive) return;
    alive = false;
    stopLine();
    stopListening();
    strip.destroy();
    document.removeEventListener('keydown', onKey);
    unfit();
    if (chrome) restore();
  }

  fillCard();
  playOther();
  return { unmount() { if (alive) { saveRound(store, round.i < round.queue.length ? round : null); cleanup(); } restore(); } };

  function drawEmpty() {
    replace(el, h('div', { class: 'practice pr-done stack' },
      h('h1', null, t('practice.sim')), h('p', null, pick.kind === 'mixed' ? t('practice.sim.nothing') : t('practice.sim.empty')),
      h('div', { class: 'pr-done-actions' }, h('a', { class: 'btn btn-primary pressable', href: '#/practice/situations' }, t('practice.sim.backTo')))));
    return restore;
  }
}

/* ------------------------------------------------------------------ */
/* Done                                                                */
/* ------------------------------------------------------------------ */

/**
 * The round's situations as a little map of chat bubbles: one per situation, its chunk in German, grouped by the
 * order they came, alternating sides; Good/Easy outlined in accent, Hard in ink, Again dashed.
 * @param {HTMLElement} el @param {import('../contract.js').ViewCtx} ctx @param {any} bank @param {Map<string, S.Item>} byId
 * @param {any} round @param {string} backTo @param {S.Pick} pick
 */
function drawDone(el, ctx, bank, byId, round, backTo, pick) {
  const { t, store } = ctx;
  const sum = S.summary(round, byId);
  const c = ctx.clock.ctx();
  const nextComp = S.compose({ items: [...byId.values()], cards: simCards(store), c, pick, start: S.startFor(simState(store).start, ctx.settings().level), newLeft: simToday({ store, c, settings: ctx.settings() }).newLeft });
  const bubbles = sum.list.map((x, i) => {
    const title = fnName(bank, x.item.fn);
    const a = x.item.answers[0];
    const tone = x.g >= 3 ? 'is-good' : x.g === 2 ? 'is-hard' : 'is-again';
    return h('li', { class: ['sim-map-b', tone, i % 2 ? 'is-right' : 'is-left'], style: { '--i': String(Math.min(i, 16)) }, title },
      h('span', { class: 'sim-map-chunk', lang: langAttr(), dir: dirAttr() }, S.chunkParts(a)[1]),
      h('span', { class: 'caption' }, t(`practice.sim.g${x.g}`)));
  });
  const good = sum.counts.good + sum.counts.easy;
  // the done hero (one figure, the atmosphere breathes once); its data object is the round's chunks as chat bubbles
  const hero = doneHero({ label: t('practice.roundDone'), figure: sum.total, of: t('practice.sim.done.title', { n: sum.total }),
    lines: [`${t('practice.sim.done.counts', { good, hard: sum.counts.hard, again: sum.counts.again })} · ${t('practice.sim.done.time', { min: Math.max(1, Math.round(sum.ms / 60000)) })}`,
      sum.known ? t('practice.know.inRound', { n: sum.known }) : null],
    data: h('section', { class: 'sim-map-wrap', 'aria-label': t('practice.sim.done.map') }, h('ul', { class: 'sim-map' }, bubbles)) });
  replace(el, h('div', { class: 'practice pr-done sim-done stack' },
    hero.el,
    h('div', { class: 'pr-done-actions' },
      nextComp.ids.length ? h('a', { class: 'btn btn-primary pressable', href: `#/practice/situations/round?pick=${encodeURIComponent(S.pickKey(pick))}${backTo === '/today' ? '&from=today' : ''}&r=${round.id}`, id: 'sim-again' }, t('practice.sim.another')) : null,
      h('a', { class: ['btn', 'pressable', !nextComp.ids.length && 'btn-primary'], href: `#${backTo}` }, t('practice.done')))));
  const stop = hero.start();
  requestAnimationFrame(() => el.querySelector('.sim-map')?.classList.add('is-in'));
  addEventListener('hashchange', stop, { once: true });
}
