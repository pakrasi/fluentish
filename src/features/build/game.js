/* Split or stay (#/practice/build/game[?from=today]): 60 seconds, one verb at a time. Does the prefix split off in a
   main clause? Two big buttons (keys ← and →). A dual verb shows its meaning, which tells the reading: "umfahren:
   knock over" splits, "umfahren: drive around" stays.

   Right, separable: the joint opens, the stem slides to the front and the prefix hops to the end ("fahren … um"),
   as in a sentence. Right, inseparable: the weld line draws under the word. Then the example sentence shows for
   650 ms. Wrong: a 300 ms nudge and the example for 1.5 s. The timer starts with the first answer; it is a 2 px
   hairline bar (never accent) with a progressbar role. "Untimed" (WCAG 2.2.1) makes it 20 verbs with no timer.
   No card is written (a speeded guess is noisy evidence): the game logs to kv 'build.game', and the verbs he missed
   move their sentence cards to the front of the next new items (domain/wordbuild-plan.js). Reduced motion: final
   states only, the holds unchanged. */
import { h, replace, announce } from '../../core/dom.js';
import { haptic } from '../../core/motion.js';
import { gameDeck, gameRight, logGame } from '../../domain/wordbuild-plan.js';
import { backLink } from './compass.js';
import { play, css, reduced, nudge } from './fx.js';
import { loadContent, GAME, addActivity } from './data.js';
import { langAttr, dirAttr } from '../../core/lang.js';

const LIMIT = 60_000;
const UNTIMED_N = 20;

/** @param {HTMLElement} el @param {import('../contract.js').ViewCtx} ctx */
export async function mountGame(el, ctx) {
  const { t, store } = ctx;
  const back = ctx.query.get('from') === 'today' ? '#/today' : '#/practice/build';
  let alive = true;
  replace(el, h('div', { class: 'wb stack' }, backLink(back, ctx.query.get('from') === 'today' ? t('build.toToday') : t('build.title')), h('div', { class: 'page-head' }, h('h1', null, t('build.game.title'))), h('p', { class: 'caption' }, t('build.loading'))));
  const d = await loadContent(ctx);
  if (!alive) return () => {};
  /** @type {any} */ let timer = 0;
  /** @type {any} */ let hold = 0;
  let raf = 0;
  const stopAll = () => { cancelAnimationFrame(raf); clearTimeout(hold); clearTimeout(timer); };

  function start() {
    stopAll();
    const untimed = !!(store.get(GAME, {}) || {}).untimed;
    const deck = gameDeck(d.c, Math.random);
    let k = 0, score = 0, n = 0, busy = false, over = false, streak = 0, t0 = 0;
    /** @type {any[]} */ const misses = [];
    /** @type {any} */ let cur = null;
    const fill = h('i');
    const bar = h('div', { class: 'wb-timer', role: 'progressbar', 'aria-label': t('build.game.left'), 'aria-valuemin': '0', 'aria-valuemax': '60', 'aria-valuenow': '60', hidden: untimed }, fill);
    const scoreEl = h('b', { class: 'tnum' }, '0');
    const word = h('div', { class: 'wb-gword', lang: langAttr(), dir: dirAttr() });
    const meaning = h('p', { class: 'wb-gmeaning' });
    const ex = h('p', { class: 'wb-gex', lang: langAttr(), dir: dirAttr(), 'aria-live': 'polite' });
    const card = h('div', { class: 'wb-card wb-gcard' }, word, meaning, ex);
    const bS = h('button', { type: 'button', class: 'btn pressable', onclick: () => answer(true) }, t('build.game.splits'), h('small', { lang: langAttr(), dir: dirAttr() }, 'ich stelle … auf'), h('kbd', null, '←'));
    const bI = h('button', { type: 'button', class: 'btn pressable', onclick: () => answer(false) }, t('build.game.stays'), h('small', { lang: langAttr(), dir: dirAttr() }, 'ich bestelle'), h('kbd', null, '→'));
    const untimedBox = h('label', { class: 'wb-toggle' }, h('input', { type: 'checkbox', checked: untimed, onchange: (/** @type {Event} */ e) => {
      store.update(GAME, (/** @type {any} */ s) => ({ ...(s || {}), untimed: /** @type {HTMLInputElement} */ (e.target).checked }), {}); start();
    } }), t('build.game.untimed'));
    const body = h('div', { class: 'wb stack wb-game' },
      backLink(back, ctx.query.get('from') === 'today' ? t('build.toToday') : t('build.title')),
      h('div', { class: 'page-head' }, h('h1', null, t('build.game.title'))),
      h('div', { class: 'wb-gtop' }, bar, h('div', { class: 'wb-gscore' }, h('span', { class: 'caption' }, t('build.game.ask')), h('span', null, scoreEl, h('span', { class: 'caption' }, ` ${t('build.game.right')}`)))),
      card, h('div', { class: 'wb-gbtns' }, bS, bI), untimedBox,
      h('p', { class: 'caption' }, untimed ? t('build.game.ruleUntimed', { n: UNTIMED_N }) : t('build.game.rule')));
    replace(el, body);

    const show = () => {
      cur = deck[k++ % deck.length];
      replace(word, h('span', { class: 'wb-gp' }, cur.pre), h('span', { class: 'wb-gs' }, cur.stem), h('span', { class: 'wb-gw', 'aria-hidden': 'true' }), h('span', { class: 'wb-gj', 'aria-hidden': 'true' }));
      word.setAttribute('aria-label', cur.word);
      meaning.textContent = cur.meaning;
      ex.textContent = '';
      play(word, [{ opacity: 0, transform: 'translateX(24px)' }, { opacity: 1, transform: 'none' }], { duration: 300, easing: css('--spring-snappy') });
    };
    const tick = () => {
      const left = Math.max(0, 1 - (performance.now() - t0) / LIMIT);
      fill.style.transform = `scaleX(${left})`;
      bar.setAttribute('aria-valuenow', String(Math.round(left * 60)));
      if (left <= 0) { end(); return; }
      raf = requestAnimationFrame(tick);
    };
    async function answer(/** @type {boolean} */ splits) {
      if (busy || over || !cur || !alive) return;
      busy = true;
      if (!t0 && !untimed) { t0 = performance.now(); tick(); }
      const ok = gameRight(cur, splits); n++;
      if (ok) { score++; scoreEl.textContent = String(score); if (streak++ < 3) haptic(); } else { misses.push(cur); streak = 0; }
      const gp = /** @type {HTMLElement} */ (word.querySelector('.wb-gp')), gs = /** @type {HTMLElement} */ (word.querySelector('.wb-gs'));
      const gw = /** @type {HTMLElement} */ (word.querySelector('.wb-gw')), gj = /** @type {HTMLElement} */ (word.querySelector('.wb-gj'));
      gj.style.left = `${gp.offsetWidth + 1}px`;
      if (cur.kind === 's') {
        const pw = gp.offsetWidth, sw = gs.offsetWidth;
        // the stem moves to the front and the prefix hops to the end: "fahren … um"
        if (reduced()) { gs.style.transform = `translateX(${-pw}px)`; gp.style.transform = `translateX(${sw + 18}px)`; }
        else {
          play(gj, [{ opacity: 0 }, { opacity: 1 }, { opacity: 0 }], { duration: 300, fill: 'forwards' });
          play(gs, [{ transform: 'none' }, { transform: `translateX(${-pw}px)` }], { duration: 460, delay: 80, easing: css('--ease-inout'), fill: 'forwards' });
          await play(gp, [{ transform: 'none' }, { transform: `translate(${sw * 0.5}px, -16px)`, offset: 0.45 }, { transform: `translateX(${sw + 18}px)` }], { duration: 540, easing: css('--ease-inout'), fill: 'forwards' });
        }
      } else if (reduced()) gw.style.transform = 'scaleX(1)';
      else await play(gw, [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: 220, easing: css('--ease-out'), fill: 'forwards' });
      ex.textContent = cur.ex;
      announce(`${ok ? t('build.right') : t('build.wrong')} ${cur.word}: ${t(cur.kind === 's' ? 'build.game.isSplit' : 'build.game.isStay')}. ${cur.ex}`);
      if (!ok) nudge(card);
      hold = setTimeout(() => {
        busy = false;
        if (!alive || over) return;
        if (untimed && n >= UNTIMED_N) { end(); return; }
        show();
      }, ok ? 650 : 1500);
    }
    function end() {
      if (over) return;
      over = true; stopAll();
      const c = ctx.clock.ctx();
      store.update(GAME, (/** @type {any} */ log) => logGame(log, { day: c.today, n, right: score, missed: [...new Set(misses.map(m => m.id))], timed: !untimed }), {});
      addActivity(store, c.today, { minutes: untimed ? 2 : 1, kind: 'build' });
      const fig = h('p', { class: 'wb-figure tnum' }, String(score));
      replace(el, h('div', { class: 'wb stack wb-game' },
        backLink(back, ctx.query.get('from') === 'today' ? t('build.toToday') : t('build.title')),
        h('div', { class: 'page-head' }, h('h1', null, t('build.game.title'))),
        h('div', { class: 'wb-donefig' }, fig, h('p', { class: 'caption' }, untimed ? t('build.game.ofUntimed', { n }) : t('build.game.of', { n }))),
        misses.length ? h('section', { class: 'wb-missed' }, h('h2', null, t('build.missed')), h('div', { class: 'wb-misslist' }, misses.map(m => h('p', { lang: langAttr(), dir: dirAttr() }, m.ex,
          h('span', null, `${m.word}: ${t(m.kind === 's' ? 'build.game.isSplit' : 'build.game.isStay')}`))))) : null,
        misses.length ? h('p', { class: 'caption' }, t('build.game.feeds')) : null,
        h('div', { class: 'wb-done-actions' }, h('button', { type: 'button', class: 'btn btn-primary pressable', onclick: start }, t('build.game.again')),
          h('a', { class: 'btn pressable', href: back }, ctx.query.get('from') === 'today' ? t('build.toToday') : t('build.toHub')))));
      el.querySelector('h1')?.focus({ preventScroll: true });
    }
    onKey = (/** @type {KeyboardEvent} */ e) => { if (over || e.metaKey || e.ctrlKey || e.altKey) return; if (e.key === 'ArrowLeft') { e.preventDefault(); answer(true); } if (e.key === 'ArrowRight') { e.preventDefault(); answer(false); } };
    show();
    if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) /** @type {any} */ (window).__game = { answer, end, get cur() { return cur; } };
  }
  /** @type {(e: KeyboardEvent) => void} */ let onKey = () => {};
  const keys = (/** @type {KeyboardEvent} */ e) => onKey(e);
  document.addEventListener('keydown', keys);
  start();
  return () => { alive = false; stopAll(); document.removeEventListener('keydown', keys); };
}
