/* Today's family (#/practice/build/today[?from=today]): the daily word-building puzzle (round 7, WORDGAMES-DESIGN §5
   with the owner's decisions of 8 Oct: tiles first, typing as an option, the count only).
   Full screen like a round. The root sits in the middle, its prefix tiles round it, endings and articles under it,
   and a board of meanings (10 at B1, 6 at A2 and on a Light day, 12 from B2) to build. He taps a prefix, and for a
   noun an ending and an article (or types the word), and checks: each part flips (right · a real word with another
   meaning · not part of it; the root is given and never flips). A verb with the right prefix asks one more thing:
   Splits or Stays, and the word splits ("stellt … aus") or the weld draws. Another word on the board fills that one
   instead (no try spent); a real family word not on the board is an extra word, never a miss; three tries, then the
   word is shown, a study step. Progress is "7 of 10 found" and nothing else: no ranks, streaks or sharing.
   One board a day per device (family-data.js todayBoard, deterministic from the day), resumable after a reload.
   Grades and writes: family-data.js answerClue (only due words and new words inside the allowance write; tiles cap
   at Good). Keys: letters type, Enter checks, Backspace deletes, Esc clears, ↑ ↓ change the meaning, 1 2 3 der die
   das, ← → Splits / Stays. */
import { h, replace, announce } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { langAttr, dirAttr } from '../../core/lang.js';
import { fling, countTo } from '../../core/motion.js';
import { fitToKeyboard, keep, reveal as revealEl } from '../../core/keyboard.js';
import { ARTICLES, TRIES, judge, parseTyped, doneOf, pointsOf, foundCount, piecesOf, spell } from '../../domain/wordbuild-family.js';
import { gradeTyped } from '../../domain/wordbuild-grade.js';
import { loadFamilies, todayBoard, saveDay, answerClue, stateOf } from './family-data.js';
import { knowledge, cardsOf, addActivity } from './data.js';
import { formWord } from './fword.js';
import { play, css, reduced, wait, nudge, finishAll } from './fx.js';
import { sheet as openSheet } from '../shared/textview.js';

/** @typedef {import('../../domain/wordbuild-family.js').Form} Form */
/** @typedef {import('../../domain/wordbuild-family.js').Family} Family */
/** @typedef {'art'|'pre'|'suf'} Part */

/** @param {HTMLElement} el @param {import('../contract.js').ViewCtx} ctx */
export async function mountToday(el, ctx) {
  const { t, store } = ctx;
  const fromToday = ctx.query.get('from') === 'today';
  const backHref = fromToday ? '#/today' : '#/practice/build';
  const backText = fromToday ? t('build.today.back') : t('build.title');
  document.body.dataset.chrome = 'off';
  document.body.classList.add('wb-in-round');
  const restore = () => { document.body.dataset.chrome = 'on'; document.body.classList.remove('wb-in-round'); };
  const backLink = () => h('a', { class: 'pz-back pressable', href: backHref, onpointerdown: keep }, icon('prev', { size: 16 }), backText);
  replace(el, h('div', { class: 'pz' }, h('div', { class: 'pz-main' }, h('div', { class: 'pz-head' }, backLink(), h('h1', null, t('build.today.title'))), h('p', { class: 'caption' }, t('build.loading')))));
  /** @type {any} */ let d;
  /** @type {Map<string, Family>} */ let fams;
  /** @type {any} */ let k;
  try { const [x, kk] = await Promise.all([loadFamilies(ctx), knowledge(ctx).catch(() => null)]); d = x.d; fams = x.fams; k = kk; } catch {
    replace(el, h('div', { class: 'wb stack page-pad' }, backLink(), h('h1', null, t('build.today.title')), h('p', null, t('build.loadFailed'))));
    return restore;
  }
  const found0 = todayBoard(ctx, d, fams, k);
  const famOf = found0 ? fams.get(found0.root) : null;
  if (!found0 || !famOf) {
    restore();
    replace(el, h('div', { class: 'wb stack' }, h('a', { class: 'pr-backlink pressable', href: backHref }, icon('prev', { size: 16 }), backText),
      h('div', { class: 'page-head' }, h('h1', null, t('build.today.none'))), h('p', { class: 'lead' }, t('build.today.noneDetail')),
      h('a', { class: 'btn pressable', href: '#/practice/build/family' }, t('build.today.seeFamily'))));
    return () => {};
  }
  const fam = /** @type {Family} */ (famOf);
  /** @type {import('../../domain/wordbuild-family.js').DayLog & {art: Record<string, boolean>, slip: Record<string, boolean>, counted?: boolean}} */
  const day = { art: {}, slip: {}, ...structuredClone(found0) };
  day.cards = day.cards.filter(id => fam.byCard.has(id));
  const forms = day.cards.map(id => /** @type {Form} */ (fam.byCard.get(id)));
  const N = forms.length;
  const level = day.level || 'B1';
  const easy = level === 'A1' || level === 'A2';
  const S = { idx: Math.max(0, day.cards.findIndex(id => !day.done[id])), b: /** @type {{art: string | null, pre: string | null, suf: string | null}} */ ({ art: null, pre: null, suf: null }),
    busy: false, splitting: false, typing: false, t0: performance.now(), over: false };
  if (S.idx < 0) S.idx = 0;
  let alive = true;
  const nouns = forms.some(f => !!f.art);
  const STEM = fam.stem;

  /* ---------------- layout ---------------- */
  const msg = h('p', { class: 'pz-msg', role: 'status', 'aria-live': 'polite' });
  const say = (/** @type {any[]} */ ...parts) => { replace(msg, ...parts); };
  const de = (/** @type {string} */ s) => h('span', { class: 'pz-de', lang: langAttr(), dir: dirAttr() }, s);
  const countEl = h('span', { class: 'tnum pz-count-n' }, String(foundCount(day, day.done)));
  const squares = h('span', { class: 'pz-sqs', 'aria-hidden': 'true' }, forms.map(() => h('i')));
  const prog = h('button', { type: 'button', class: 'pz-prog pressable', 'aria-haspopup': 'dialog', onpointerdown: keep, onclick: () => boardSheet() },
    h('span', { class: 'pz-prog-top' }, h('span', { class: 'pz-count' }, countEl, ` ${t('build.today.found', { n: '', total: N }).trim()}`), h('span', { class: 'pz-chev', 'aria-hidden': 'true' }, '›')), squares);
  const meaning = h('p', { class: 'pz-meaning' });
  const meta = h('p', { class: 'pz-meta' });
  const build = h('div', { class: 'pz-build', lang: langAttr(), dir: dirAttr() });
  const navBtn = (/** @type {number} */ dir) => h('button', { type: 'button', class: 'pz-nav pressable', 'aria-label': t(dir < 0 ? 'build.today.prev' : 'build.today.next'), onpointerdown: keep, onclick: () => go(S.idx + dir) }, icon(dir < 0 ? 'prev' : 'next', { size: 16 }));
  const clue = h('section', { class: 'pz-clue', 'aria-label': t('build.today.clueRegion') }, h('div', { class: 'pz-clue-top' }, navBtn(-1), h('div', { class: 'pz-clue-mid' }, meaning, meta), navBtn(1)), build);
  const hive = h('div', { class: 'pz-hive', role: 'group', 'aria-label': t('build.today.prefixes') });
  const ends = h('div', { class: 'pz-ends', role: 'group', 'aria-label': t('build.today.endings') });
  const playArea = h('div', { class: 'pz-play' }, hive, ends);
  const input = /** @type {HTMLInputElement} */ (h('input', { class: 'pz-type', type: 'text', lang: langAttr(), dir: dirAttr(), autocapitalize: 'off', autocomplete: 'off', spellcheck: 'false', enterkeyhint: 'go', 'aria-label': t('build.today.typeField'), hidden: true }));
  input.setAttribute('autocorrect', 'off');
  const typeBtn = h('button', { type: 'button', class: 'btn pressable', 'aria-pressed': 'false', onpointerdown: keep, onclick: () => setTyping(!S.typing) }, t('build.today.type'));
  const delBtn = h('button', { type: 'button', class: 'btn pressable', onpointerdown: keep, onclick: () => del() }, t('build.today.delete'), h('kbd', null, '⌫'));
  const checkBtn = h('button', { type: 'button', class: 'btn btn-primary pressable pz-check', onpointerdown: keep, onclick: () => check() }, t('build.today.check'), h('kbd', null, '↵'));
  const acts = h('div', { class: 'pz-acts' }, input, delBtn, typeBtn, checkBtn);
  const help = h('button', { type: 'button', class: 'pz-help pressable', 'aria-label': t('build.today.help'), onpointerdown: keep, onclick: () => say(t('build.today.helpText')) }, icon('info', { size: 20 }));
  const head = h('div', { class: 'pz-head' }, backLink(), h('h1', null, t('build.today.title')), help);
  const rootLine = h('p', { class: 'pz-root' }, h('span', { class: 'pz-root-w', lang: langAttr(), dir: dirAttr() }, fam.root), h('span', { class: 'pz-root-en' }, fam.en));
  const main = h('div', { class: 'pz-main' }, head, rootLine, prog, clue, msg, playArea, acts);
  const aside = h('aside', { class: 'pz-board', 'aria-label': t('build.today.board') });
  const box = h('div', { class: 'pz', role: 'region', 'aria-label': t('build.today.title') }, main, aside);
  replace(el, box);
  const unfit = fitToKeyboard(box);

  /* ---------------- the tiles ---------------- */
  /** @type {Map<string, HTMLElement>} */ const tileEls = new Map();
  const tileKey = (/** @type {Part} */ part, /** @type {string} */ v) => `${part}:${v}`;
  function drawTiles() {
    const pre = day.tiles.pre;
    const n = pre.length;
    replace(hive);
    pre.forEach((p, i) => {
      const a = -Math.PI / 2 + i * (2 * Math.PI / Math.max(1, n));
      const b = h('button', { type: 'button', class: 'hx pressable', lang: langAttr(), dir: dirAttr(), 'aria-pressed': 'false', 'aria-label': t('build.today.prefixTile', { p }), onpointerdown: keep, onclick: () => pick('pre', p, b),
        style: { left: `${50 + 40 * Math.cos(a)}%`, top: `${50 + 38 * Math.sin(a)}%` } }, p);
      tileEls.set(tileKey('pre', p), b);
      hive.append(b);
    });
    hive.append(h('div', { class: 'hx is-centre', lang: langAttr(), dir: dirAttr(), role: 'img', 'aria-label': t('build.today.rootTile', { root: fam.root }) }, STEM, h('small', null, fam.root)),
      h('div', { class: 'hx-ripple', 'aria-hidden': 'true' }));
    replace(ends);
    for (const x of day.tiles.suf) { const b = h('button', { type: 'button', class: 'hx pressable', lang: langAttr(), dir: dirAttr(), 'aria-pressed': 'false', 'aria-label': t('build.today.endingTile', { s: endLabel(x) }), 'data-suf': x, onpointerdown: keep, onclick: () => pick('suf', x, b) }, endLabel(x)); tileEls.set(tileKey('suf', x), b); ends.append(b); }
    if (nouns) {
      if (day.tiles.suf.length) ends.append(h('span', { class: 'pz-sep', 'aria-hidden': 'true' }));
      ARTICLES.forEach((x, i) => { const b = h('button', { type: 'button', class: 'hx is-art pressable', lang: langAttr(), dir: dirAttr(), 'aria-pressed': 'false', 'aria-label': t('build.today.articleTile', { a: x }), onpointerdown: keep, onclick: () => pick('art', x, b) }, x, h('kbd', null, String(i + 1))); tileEls.set(tileKey('art', x), b); ends.append(b); });
    }
    ends.hidden = !ends.children.length;
  }
  /** An ending that makes a noun (the build content's rule, the bare stem, the infinitive noun, -ling). @param {string} x */
  function nounEnding(x) {
    const sx = d.c.suffixes.find((/** @type {any} */ s) => s.id === x);
    return sx ? sx.cls === 'noun' : ['stem', 'inf', 'ling'].includes(x);
  }
  /** An ending's tile: "-ung", "bare stem", "Partizip II" (the build content's labels). @param {string} x */
  function endLabel(x) {
    const sx = d.c.suffixes.find((/** @type {any} */ s) => s.id === x);
    return x === 'pp' ? 'Partizip II' : x === 'ppr' ? 'Partizip I' : sx && /^-/.test(sx.label) ? sx.label.split(',')[0] : sx ? sx.label : `-${x}`;
  }
  function syncTiles() {
    for (const [key, b] of tileEls) { const [part, v] = key.split(':'); b.setAttribute('aria-pressed', String(S.b[/** @type {Part} */ (part)] === v)); }
  }

  /* ---------------- the clue ---------------- */
  const cur = () => forms[S.idx];
  const card = () => day.cards[S.idx];
  function drawClue({ keepBuild = false } = {}) {
    const f = cur(), id = card();
    meaning.textContent = f.clue;
    const ss = stateOf(d, k, f);
    const tries = day.tries[id] || 0;
    /** @type {any[]} */ const bits = [h('span', { class: 'tnum' }, t('build.today.clueOf', { n: S.idx + 1, total: N })), h('span', null, t(`build.family.type.${f.cls}`).toLowerCase()), f.level ? h('span', { class: 'tnum' }, f.level) : null];
    if (f.grade === 'O') bits.push(h('span', { class: 'pz-o' }, h('span', { class: 'fv-gr is-O', 'aria-hidden': 'true' }), t('build.today.learnWord')));
    if (ss === 'unseen' && !day.done[id]) bits.push(h('span', { class: 'pz-new' }, t('build.today.new')));
    if (!day.done[id]) bits.push(h('span', { class: 'pz-tries', role: 'img', 'aria-label': t('build.today.triesLeft', { n: TRIES - tries }) }, [0, 1, 2].map(i => h('i', { class: i < tries ? 'is-used' : null }))));
    replace(meta, bits);
    if (!keepBuild) S.b = { art: null, pre: null, suf: null };
    drawBuild();
    syncTiles();
    drawProgress();
    drawBoard();
  }

  /** The build row: the parts he picked, in word order; empty slots say what may go there. @param {Partial<Record<Part | 'root', string | null>>} [states] */
  function drawBuild(states = {}) {
    const f = cur(), id = card();
    if (day.done[id]) {
      replace(build, formWord(f, { t, cls: 'pz-done-word' }), day.done[id] === 'shown' ? h('span', { class: 'caption pz-shown' }, t('build.today.sq.shown')) : null);
      build.setAttribute('aria-label', t('build.today.yourWord', { w: `${f.art ? `${f.art} ` : ''}${f.word}` }));
      return;
    }
    if (S.typing) {
      replace(build, h('span', { class: 'pz-typed' }, input.value || ' ', h('span', { class: 'pz-caret', 'aria-hidden': 'true' })));
      build.setAttribute('aria-label', input.value ? t('build.today.yourWord', { w: input.value }) : t('build.today.yourWordNone'));
      return;
    }
    const noun = !!f.art;
    /** @type {any[]} */ const parts = [];
    const slot = (/** @type {Part} */ part, /** @type {string | null} */ v, /** @type {string} */ shown) => {
      const st = states[part];
      if (!v) {
        const hint = part === 'pre' && easy && (day.tries[id] || 0) > 0 && f.pre[0] ? f.pre[0] : null;
        return h('span', { class: ['pt', 'is-empty', hint && 'is-hint'], 'data-part': part }, hint || t(`build.today.slot.${part}`));
      }
      return h('span', { class: ['pt', `is-${part}`, st && `is-${st}`], 'data-part': part }, shown);
    };
    if (noun || S.b.art) parts.push(slot('art', S.b.art, S.b.art || ''));
    const nounEnd = !!S.b.suf && nounEnding(S.b.suf);
    const preText = S.b.pre ? (nounEnd ? S.b.pre.charAt(0).toUpperCase() + S.b.pre.slice(1) : S.b.pre) : null;
    parts.push(slot('pre', S.b.pre, preText || ''));
    const rootText = !S.b.pre && nounEnd ? STEM.charAt(0).toUpperCase() + STEM.slice(1) : STEM;
    parts.push(h('span', { class: ['pt', 'is-root', S.b.pre && 'is-joined-s', S.b.suf && 'is-joined-e'], 'data-part': 'root' }, rootText, S.b.suf ? null : h('span', { class: 'pt-tail' }, fam.root.slice(STEM.length))));
    if (noun || S.b.suf) parts.push(slot('suf', S.b.suf, S.b.suf ? endLabel(S.b.suf).replace(/^-/, '') : ''));
    replace(build, parts);
    const spelled = S.b.pre || S.b.suf ? `${S.b.art ? `${S.b.art} ` : ''}${spell(fam, S.b)}` : '';
    build.setAttribute('aria-label', spelled ? t('build.today.yourWord', { w: spelled }) : t('build.today.yourWordNone'));
  }

  function drawProgress() {
    const n = foundCount(day, day.done);
    if (countEl.textContent !== String(n)) countTo(countEl, n, { duration: 500 });
    prog.setAttribute('aria-label', t('build.today.foundAria', { n, total: N }));
    [...squares.children].forEach((sq, i) => { sq.className = [day.done[day.cards[i]] ? `is-${day.done[day.cards[i]]}` : '', i === S.idx && !S.over ? 'is-now' : ''].filter(Boolean).join(' '); });
  }

  /* ---------------- the board (desktop column, phone sheet) ---------------- */
  function boardNodes(inSheet = false) {
    const list = h('ol', { class: 'pz-blist' }, forms.map((f, i) => {
      const dn = day.done[day.cards[i]];
      const w = dn ? h('span', { class: 'pz-bw', lang: langAttr(), dir: dirAttr() }, f.art ? h('span', { class: 'fw-art' }, f.art) : null, f.word) : h('span', { class: 'pz-bw is-open' }, t('build.today.notFound'));
      return h('li', { class: i === S.idx ? 'is-cur' : null }, h('button', { type: 'button', class: 'pz-brow', onclick: () => { go(i); if (inSheet && sh) sh.close(); } },
        h('span', { class: ['pz-bsq', dn && `is-${dn}`], role: 'img', 'aria-label': t(`build.today.sq.${dn || 'open'}`) }),
        h('span', { class: 'pz-bm' }, w, h('span', { class: 'pz-bclue' }, f.clue)),
        h('span', { class: 'caption' }, t(`build.family.type.${f.cls}`).toLowerCase())));
    }));
    return [h('h2', null, t('build.today.board')), h('p', { class: 'caption' }, t('build.today.boardMeta', { root: fam.root, n: N, level })), list,
      h('p', { class: 'pz-extra' }, day.extras.length ? t('build.today.extras', { list: day.extras.map(x => formName(x)).join(', ') }) : t('build.today.extrasNone')),
      h('p', { class: 'pz-key' }, ['f1', 'f2', 'shown'].map(x => h('span', null, h('span', { class: ['pz-bsq', `is-${x}`], 'aria-hidden': 'true' }), t(`build.today.key.${x}`))))];
  }
  const formName = (/** @type {string} */ id) => { const f = fam.byId.get(id); return f ? `${f.art ? `${f.art} ` : ''}${f.word}` : id; };
  function drawBoard() { replace(aside, boardNodes(false)); if (sh) sh.set(...boardNodes(true)); }
  /** @type {any} */ let sh = null;
  function boardSheet() {
    if (matchMedia('(min-width: 900px)').matches) { /** @type {HTMLElement | null} */ (aside.querySelector('h2'))?.focus(); return; }
    sh = openSheet({ title: t('build.today.board'), children: boardNodes(true).slice(1), onClose: () => { sh = null; } });
  }

  /* ---------------- input ---------------- */
  /** @param {Part} part @param {string} v @param {HTMLElement | null} from */
  async function pick(part, v, from) {
    if (S.splitting || S.over) return;
    finishAll();
    if (day.done[card()]) { if (!nextOpen()) return; }
    if (S.typing) setTyping(false);
    S.b[part] = S.b[part] === v ? null : v;
    drawBuild(); syncTiles();
    if (!S.b[part] || !from || reduced()) return;
    const to = /** @type {HTMLElement | null} */ (build.querySelector(`[data-part="${part}"]`));
    if (!to) return;
    // a copy of the tile flies to its slot on a 14 px arc; a prefix settles against the stem, an ending snaps on
    const a = from.getBoundingClientRect(), b2 = to.getBoundingClientRect();
    const ghost = h('span', { class: 'pz-fly', 'aria-hidden': 'true', lang: langAttr(), dir: dirAttr(), style: { left: `${a.left}px`, top: `${a.top}px`, width: `${a.width}px`, height: `${a.height}px` } }, from.firstChild?.textContent || v);
    document.body.append(ghost);
    to.style.opacity = '0';
    const dx = b2.left + b2.width / 2 - (a.left + a.width / 2), dy = b2.top + b2.height / 2 - (a.top + a.height / 2);
    await play(ghost, [{ transform: 'none' }, { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 14}px)`, offset: 0.55 }, { transform: `translate(${dx}px, ${dy}px)` }], { duration: 300, easing: css('--ease-out') });
    ghost.remove(); to.style.opacity = '';
    play(to, part === 'suf' ? [{ transform: 'translateX(10px)' }, { transform: 'none' }] : [{ transform: 'translateY(-3px)' }, { transform: 'none' }], { duration: 260, easing: css('--spring-snappy') });
  }
  function del() {
    if (S.splitting || S.over) return;
    if (S.typing) { input.value = input.value.slice(0, -1); drawBuild(); return; }
    if (S.b.suf) S.b.suf = null; else if (S.b.pre) S.b.pre = null; else S.b.art = null;
    drawBuild(); syncTiles();
  }
  function clear() { S.b = { art: null, pre: null, suf: null }; input.value = ''; drawBuild(); syncTiles(); }
  /** @param {boolean} on @param {string} [first] a letter typed on a hardware keyboard */
  function setTyping(on, first = '') {
    S.typing = on;
    typeBtn.setAttribute('aria-pressed', String(on));
    typeBtn.textContent = on ? t('build.today.tiles') : t('build.today.type');
    input.hidden = !on;
    box.classList.toggle('is-typing', on);
    if (on) { input.value = first; input.focus({ preventScroll: true }); requestAnimationFrame(() => revealEl(input, { block: 'nearest' })); } else { input.value = ''; input.blur(); }
    drawBuild();
  }
  input.addEventListener('input', () => drawBuild());
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); check(); }
    else if (e.key === 'Escape') { e.preventDefault(); setTyping(false); }
  });

  /* ---------------- check ---------------- */
  async function check() {
    if (S.busy || S.splitting || S.over) return;
    finishAll();
    const id = card(), f = cur();
    if (day.done[id]) { nextOpen(); return; }
    let slip = false, typed = false;
    if (S.typing) {
      const raw = input.value.trim();
      if (!raw) { input.focus({ preventScroll: true }); return; }
      const p = parseTyped(fam, raw);
      if (!p) { say(t('build.today.useRoot', { stem: STEM })); nudge(build); return; }
      typed = true;
      S.b = { art: p.art, pre: p.pre, suf: p.suf };
      // the typed word is graded strictly against the clue's word (articles, umlauts, a noun's capital)
      if (p.form && p.form === f) {
        const g = gradeTyped(raw, { accept: [`${f.art ? `${f.art} ` : ''}${f.word}`, ...(f.inf && f.inf !== f.word ? [f.inf] : [])], noun: !!f.art, lexicon: d.lex });
        slip = g.ok && g.slip;
      }
      setTyping(false);
      drawBuild(); syncTiles();
    }
    const res = judge({ fam, cards: day.cards, i: S.idx, done: day.done, pick: S.b });
    const tries = () => day.tries[id] || 0;
    if (res.outcome === 'empty') { say(t('build.today.tapFirst')); nudge(build); return; }
    if (res.outcome === 'other' && res.target != null) {
      // another meaning on the board: it is filled instead, no try spent here
      const keepB = { ...S.b };
      say(t('build.today.onBoard', { en: forms[res.target].clue }));
      await go(res.target, { keepBuild: true });
      S.b = keepB; drawBuild(); syncTiles();
      await wait(400);
      return check();
    }
    S.busy = true;
    if (res.outcome === 'found' && res.form) {
      await flip(res.states);
      say(t('build.today.already', { word: `${res.form.art ? `${res.form.art} ` : ''}${res.form.word}`, en: res.form.clue }));
      S.busy = false; return;
    }
    if (res.outcome === 'extra' && res.form) {
      await flip(res.states);
      const name = `${res.form.art && S.b.art === res.form.art ? `${res.form.art} ` : ''}${res.form.word}`;
      if (day.extras.includes(res.form.id)) say(t('build.today.extraAgain', { word: name }));
      else { day.extras.push(res.form.id); saveDay(store, day); say(...splitText(t('build.today.extra', { word: name, en: res.form.en.split(';')[0].trim() }), name)); drawBoard(); }
      S.busy = false; return;
    }
    if (res.outcome === 'right') {
      await flip(res.states);
      S.busy = false;
      if (f.cls === 'verb' && f.join) return askSplit({ slip, typed });
      return finish({ slip, typed });
    }
    // a try is spent: the article, a checked non-word, a miss
    day.tries[id] = tries() + 1;
    if (res.outcome === 'article') day.art[id] = true;
    saveDay(store, day);
    await flip(res.states);
    nudge(build);
    const nearPre = res.states.pre === 'near' && S.b.pre ? t('build.today.near', { word: spell(fam, { pre: S.b.pre }) }) : '';
    if (res.outcome === 'article') {
      const sx = d.c.suffixes.find((/** @type {any} */ x) => x.id === f.suf[f.suf.length - 1]);
      say(t('build.today.article', { rule: f.note || (sx ? `${sx.label}: ${sx.rule}` : '') }));
    } else if (res.outcome === 'nonword') say(`${t('build.today.nonword', { word: spell(fam, S.b) })} ${nearPre}`.trim());
    else say(`${t('build.today.miss')} ${nearPre}`.trim());
    announce(partsSpoken(res.states));
    S.busy = false;
    drawClue({ keepBuild: true }); drawBuild(res.states);
    const fresh = stateOf(d, k, f) === 'unseen' && !(cardsOf(store)[id]?.reps);
    if ((f.grade === 'O' && fresh) || tries() >= TRIES) return show();
  }

  /** Each part says its state in words, for a screen reader. @param {Record<string, string | null>} states */
  function partsSpoken(states) {
    const words = /** @type {Record<string, string>} */ ({ ok: t('build.today.part.ok'), near: t('build.today.part.near'), no: t('build.today.part.no') });
    /** @type {string[]} */ const out = [];
    if (states.art && S.b.art) out.push(`${S.b.art}: ${words[states.art]}`);
    if (states.pre && S.b.pre) out.push(`${S.b.pre}: ${words[states.pre]}`);
    if (states.suf && S.b.suf) out.push(`${S.b.suf}: ${words[states.suf]}`);
    return out.join(', ');
  }

  /** The parts flip one after another (rotateX to 90°, the state, back): right, a real word with another meaning, not part of it. @param {Record<string, string | null>} states */
  async function flip(states) {
    drawBuild();
    // only the parts he picked flip; an empty slot and the root never do
    const parts = /** @type {HTMLElement[]} */ ([...build.querySelectorAll('.pt[data-part]:not(.is-empty)')]).filter(p => p.dataset.part !== 'root' && states[/** @type {string} */ (p.dataset.part)]);
    await Promise.all(parts.map(async (p, i) => {
      const st = states[/** @type {string} */ (p.dataset.part)];
      if (reduced()) { p.classList.add(`is-${st}`); return; }
      await play(p, [{ transform: 'rotateX(0)' }, { transform: 'rotateX(90deg)' }], { duration: 130, delay: i * 110, easing: css('--ease-in'), fill: 'forwards' });
      p.classList.add(`is-${st}`);
      p.getAnimations().forEach(a => a.cancel());
      await play(p, [{ transform: 'rotateX(-90deg)' }, { transform: 'rotateX(0)' }], { duration: 240, easing: css('--spring-snappy') });
    }));
  }

  /* ---------------- splits or stays ---------------- */
  /** @param {{slip: boolean, typed: boolean}} o */
  function askSplit(o) {
    const f = cur();
    S.splitting = true;
    const yes = h('button', { type: 'button', class: 'btn pressable pz-split', onpointerdown: keep, onclick: () => answerSplit(true, o) }, h('span', null, t('build.game.splits'), ' ', h('kbd', null, '←')), h('small', { lang: langAttr(), dir: dirAttr() }, 'ich stelle … auf'));
    const no = h('button', { type: 'button', class: 'btn pressable pz-split', onpointerdown: keep, onclick: () => answerSplit(false, o) }, h('span', null, t('build.game.stays'), ' ', h('kbd', null, '→')), h('small', { lang: langAttr(), dir: dirAttr() }, 'ich bestelle'));
    const group = h('div', { class: 'pz-splitq', role: 'group', 'aria-label': t('build.today.splitGroup') }, yes, no);
    say(de(f.word), '. ', t('build.today.splitAsk', { pre: f.pre[0] }));
    acts.hidden = true; playArea.classList.add('is-dim');
    acts.after(group);
    yes.focus({ preventScroll: true });
  }
  /** @param {boolean} splits @param {{slip: boolean, typed: boolean}} o */
  async function answerSplit(splits, o) {
    if (!S.splitting) return;
    const f = cur(), id = card();
    const right = splits === (f.join === 's');
    day.split[id] = right;
    box.querySelector('.pz-splitq')?.remove(); S.splitting = false; acts.hidden = false; playArea.classList.remove('is-dim');
    // the word splits (the stem goes to the front, the particle hops to the end) or the weld draws
    const pre = /** @type {HTMLElement | null} */ (build.querySelector('[data-part="pre"]')), root = /** @type {HTMLElement | null} */ (build.querySelector('[data-part="root"]'));
    if (pre && root && !reduced()) {
      if (f.join === 's') {
        const pw = pre.offsetWidth, rw = root.offsetWidth;
        await Promise.all([
          play(root, [{ transform: 'none' }, { transform: `translateX(${-pw}px)` }], { duration: 460, easing: css('--ease-inout'), fill: 'forwards' }),
          play(pre, [{ transform: 'none' }, { transform: `translate(${rw * 0.5}px, -16px)`, offset: 0.45 }, { transform: `translateX(${rw + 14}px)` }], { duration: 540, easing: css('--ease-inout'), fill: 'forwards' }),
        ]);
      } else {
        const line = h('span', { class: 'pz-weld', 'aria-hidden': 'true' });
        build.append(line);
        await play(line, [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: 260, easing: css('--ease-out'), fill: 'forwards' });
      }
      await wait(300);
    }
    finish({ ...o, splitMiss: !right });
  }

  /* ---------------- a word found, or shown ---------------- */
  /** @param {{slip?: boolean, typed?: boolean, splitMiss?: boolean}} o */
  async function finish(o) {
    const f = cur(), id = card();
    const tries = day.tries[id] || 0;
    const artMiss = !!day.art[id];
    if (o.slip) day.slip[id] = true;
    day.done[id] = doneOf({ tries, splitMiss: !!o.splitMiss, artMiss });
    day.points = (day.points || 0) + pointsOf(tries, false, !!o.splitMiss);
    const ms = performance.now() - S.t0;
    day.ms = (day.ms || 0) + Math.round(ms);
    saveDay(store, day);
    answerClue(ctx, day, id, { tries, splitMiss: !!o.splitMiss, artMiss, slip: !!o.slip, typed: !!o.typed, ms });
    const line = [];
    if (o.splitMiss) line.push(t(f.join === 's' ? 'build.today.splitWrong.s' : 'build.today.splitWrong.i'), ' ');
    if (f.ex) line.push(exampleLine(f)); else if (f.note) line.push(f.note);
    say(...line);
    drawClue();
    pulse();
    const wEl = /** @type {HTMLElement | null} */ (build.querySelector('.fw'));
    if (wEl && !matchMedia('(min-width: 900px)').matches) fling(wEl, countEl, { duration: 560 });
    const sq = /** @type {HTMLElement | undefined} */ (squares.children[S.idx]);
    if (sq) play(sq, [{ transform: 'scale(0.4)' }, { transform: 'scale(1)' }], { duration: 560, delay: 200, easing: css('--spring-pop') });
    announce(`${f.art ? `${f.art} ` : ''}${f.word}. ${t('build.today.found', { n: foundCount(day, day.done), total: N })}`);
    if (allDone()) { await hold(1500); return done(); }
    // the example stays long enough to read, with or without motion
    await hold(o.splitMiss ? 2200 : 1500);
    if (alive && card() === id && !S.splitting) nextOpen();
  }
  async function show() {
    const f = cur(), id = card();
    day.done[id] = 'shown';
    saveDay(store, day);
    answerClue(ctx, day, id, { tries: day.tries[id] || TRIES, shown: true, ms: performance.now() - S.t0 });
    const why = f.grade === 'O' ? t('build.today.learnWhy') : f.note ? `${f.note} ` : '';
    say(t('build.today.shown', { word: `${f.art ? `${f.art} ` : ''}${f.word}`, why }));
    drawClue();
    if (allDone()) { await hold(2000); return done(); }
  }
  const allDone = () => day.cards.every(id => day.done[id]);
  /** Holds are the same with reduced motion (the example must be readable). @param {number} ms */
  const hold = ms => new Promise(r => setTimeout(r, ms));

  /** The authored example with the verb's stem and its split-off particle underlined. @param {Form} f */
  function exampleLine(f) {
    const p = h('span', { class: 'pz-ex', lang: langAttr(), dir: dirAttr() });
    const pc = piecesOf(f);
    const sepPre = f.cls === 'verb' && f.join === 's' ? (f.pre[0] || '') : null;
    const toks = String(f.ex).split(/(\s+|[.,!?;:])/).filter(x => x !== '');
    const lastPre = sepPre ? toks.map((x, i) => (x.toLowerCase() === sepPre ? i : -1)).filter(i => i >= 0).pop() : -1;
    const stem = STEM.toLowerCase(), word = f.word.toLowerCase();
    toks.forEach((x, i) => {
      const lw = x.toLowerCase();
      const hit = i === lastPre || (x.length > 2 && (f.cls === 'verb' ? lw.startsWith(stem) || lw.startsWith(word.slice(0, -2)) || (pc.pre.length > 0 && lw.startsWith(`${pc.pre.join('').toLowerCase()}ge${stem}`)) : lw.startsWith(word.slice(0, Math.max(3, word.length - 2)))));
      p.append(hit ? h('u', null, x) : x);
    });
    return p;
  }
  /** A line with one German word in it set as German. @param {string} text @param {string} word */
  function splitText(text, word) {
    const i = text.indexOf(word);
    return i < 0 ? [text] : [text.slice(0, i), de(word), text.slice(i + word.length)];
  }

  /** The hive answers once: each tile scales 1.07 in turn round the ring, and one accent ring leaves the root. */
  function pulse() {
    if (reduced()) return;
    [...hive.querySelectorAll('.hx:not(.is-centre)')].forEach((x, i) => play(x, [{ transform: 'translate(-50%, -50%) scale(1)' }, { transform: 'translate(-50%, -50%) scale(1.07)' }, { transform: 'translate(-50%, -50%) scale(1)' }], { duration: 380, delay: i * 28, easing: css('--ease-out') }));
    play(hive.querySelector('.hx-ripple'), [{ opacity: 0.8, transform: 'translate(-50%, -50%) scale(0.95)' }, { opacity: 0, transform: 'translate(-50%, -50%) scale(1.9, 2.3)' }], { duration: 720, easing: css('--ease-out') });
  }

  /* ---------------- navigation ---------------- */
  /** @param {number} i @param {{keepBuild?: boolean}} [o] */
  async function go(i, { keepBuild = false } = {}) {
    if (S.splitting || S.over) return;
    const n = ((i % N) + N) % N;
    if (n === S.idx) { if (!keepBuild) drawClue(); return; }
    const dir = n > S.idx ? 1 : -1;
    // the new meaning is current at once: a tile tapped while the card slides counts for it (input is never blocked)
    S.idx = n; S.t0 = performance.now();
    if (!keepBuild) { S.b = { art: null, pre: null, suf: null }; syncTiles(); if (S.typing) input.value = ''; }
    if (!reduced()) await play(clue, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: `translateX(${-24 * dir}px)` }], { duration: 140, easing: css('--ease-in'), fill: 'forwards' });
    clue.getAnimations().forEach(a => a.cancel());
    drawClue({ keepBuild: true });
    if (!keepBuild) say();
    play(clue, [{ opacity: 0, transform: `translateX(${32 * dir}px)` }, { opacity: 1, transform: 'none' }], { duration: 380, easing: css('--spring-snappy') });
  }
  function nextOpen() {
    for (let j = 1; j <= N; j++) { const i = (S.idx + j) % N; if (!day.done[day.cards[i]]) { go(i); return true; } }
    return false;
  }

  /* ---------------- done ---------------- */
  function done() {
    if (!alive) return;
    S.over = true;
    const n = foundCount(day, day.done);
    const c = (/** @type {string} */ x) => day.cards.filter(id => day.done[id] === x).length;
    const cardsNow = cardsOf(store);
    const wrote = day.cards.filter(id => day.writes.includes(id) && cardsNow[id]?.last === ctx.clock.today());
    const nNew = wrote.filter(id => day.fresh.includes(id)).length, nRev = wrote.length - nNew;
    const counted = [nNew ? t('build.today.doneNew', { n: nNew }) : null, nRev ? t('build.today.doneReviews', { n: nRev }) : null].filter(Boolean);
    const grid = h('div', { class: 'pz-grid', role: 'img', 'aria-label': t('build.today.doneGrid', { f1: c('f1'), f2: c('f2'), shown: c('shown') }) }, day.cards.map(id => h('i', { class: `is-${day.done[id]}` })));
    const fig = h('span', { class: 'figure tnum pz-fig' }, '0');
    const sec = h('section', { class: 'pz-done', 'aria-labelledby': 'pz-done-h' },
      h('h2', { id: 'pz-done-h', tabindex: '-1' }, t('build.today.doneTitle')),
      fig, h('p', { class: 'pz-done-of' }, t('build.today.doneOf', { n: N })), grid,
      h('p', { class: 'caption pz-done-line' }, [day.extras.length ? t('build.today.doneExtras', { n: day.extras.length }) : null,
        counted.length ? t('build.today.doneCounted', { words: counted.join(' and ') }) : t('build.today.doneNothing'), t('build.today.doneTomorrow')].filter(Boolean).join(' ')),
      // One word (WORDGAMES-DESIGN §5.2, phase 3) goes here: a second, typed round on one form of the root
      h('div', { class: 'pz-done-acts' },
        h('a', { class: 'btn btn-primary pressable', href: `#/practice/build/family/${encodeURIComponent(fam.root)}?from=today` }, t('build.today.seeFamily')),
        h('a', { class: 'btn pressable', href: '#/today' }, t('build.today.toToday'))));
    replace(main, head, rootLine, prog, sec);
    drawProgress();
    drawBoard();
    countTo(fig, n, { duration: 700 });
    if (!reduced()) [...grid.children].forEach((x, i) => play(x, [{ transform: 'scale(0.4)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 560, delay: 200 + i * 40, easing: css('--spring-pop') }));
    /** @type {HTMLElement | null} */ (sec.querySelector('h2'))?.focus({ preventScroll: true });
    if (!day.counted) { day.counted = true; saveDay(store, day); addActivity(store, ctx.clock.today(), { minutes: Math.max(1, Math.round((day.ms || 0) / 60000)), rounds: 1, kind: 'build' }); }
  }

  /* ---------------- keys ---------------- */
  /** @param {KeyboardEvent} e */
  function onKey(e) {
    if (e.metaKey || e.ctrlKey || e.altKey || !alive) return;
    if (document.querySelector('dialog[open]')) return;
    if (S.splitting) {
      if (e.key === 'ArrowLeft') { e.preventDefault(); /** @type {HTMLElement | null} */ (box.querySelector('.pz-split'))?.click(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); /** @type {HTMLElement | null} */ (box.querySelectorAll('.pz-split')[1])?.click(); }
      return;
    }
    if (e.target === input) return;
    const tag = /** @type {HTMLElement} */ (e.target)?.tagName;
    if (e.key === 'Enter' && tag !== 'BUTTON' && tag !== 'A') { e.preventDefault(); check(); return; }
    if (e.key === 'Backspace') { e.preventDefault(); del(); return; }
    if (e.key === 'Escape') { if (S.over) return; e.preventDefault(); clear(); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); go(S.idx - 1); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); go(S.idx + 1); return; }
    if (/^[1-3]$/.test(e.key) && nouns && !S.over) { const a = ARTICLES[Number(e.key) - 1]; pick('art', a, tileEls.get(tileKey('art', a)) || null); return; }
    if (/^[a-zäöüß]$/i.test(e.key) && !S.over) { e.preventDefault(); setTyping(true, e.key); }
  }
  document.addEventListener('keydown', onKey);

  drawTiles();
  if (allDone()) done(); else drawClue();
  // test hook (localhost only)
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) /** @type {any} */ (window).__family = { get day() { return day; }, get forms() { return forms; }, get idx() { return S.idx; } };
  return () => { alive = false; finishAll(); document.removeEventListener('keydown', onKey); unfit(); sh?.close?.(); restore(); };
}
