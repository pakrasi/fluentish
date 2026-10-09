/* Today's family (#/practice/build/today[?from=today]): the daily word-building puzzle (round 7, WORDGAMES-DESIGN §5
   with the owner's decisions of 8 Oct: tiles first, typing as an option, the count only).
   Full screen like a round. The root sits in the middle, its prefix tiles round it, endings and articles under it,
   and a board of meanings (10 at B1, 6 at A2 and on a Light day, 12 from B2) to build. He taps a prefix, and for a
   noun an ending and an article (or types the word), and checks: each part flips (right · a real word with another
   meaning · not part of it; the root is given and never flips). A verb with the right prefix asks one more thing:
   Splits or Stays, and the word splits ("stellt … aus") or the weld draws. Another word on the board is named with its
   meaning and fills nothing (no try spent, no grade: tapping tiles must not clear the board); a real family word not on the board is an extra word, never a miss; three tries, then the
   word is shown, a study step. Progress is "7 of 10 found" and nothing else: no ranks, streaks or sharing.
   One board a day per device (family-data.js todayBoard, deterministic from the day), resumable after a reload.
   Grades and writes: family-data.js answerClue (only due words and new words inside the allowance write; tiles cap
   at Good). Keys: letters type, Enter checks, Backspace deletes, Esc clears, ↑ ↓ change the meaning, 1 2 3 der die
   das, ← → Splits / Stays. */
import { h, replace, announce } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { langAttr, dirAttr } from '../../core/lang.js';
import { countTo } from '../../core/motion.js';
import { fitToKeyboard, keep, reveal as revealEl } from '../../core/keyboard.js';
import { ARTICLES, TRIES, judge, judgeTyped, doneOf, pointsOf, foundCount, piecesOf, spell, partsOf, tapTile, dropLast, endingChains, buildOf } from '../../domain/wordbuild-family.js';
import { familiesFor, todayBoard, saveDay, answerClue, stateOf, tomorrowRoot, warmFamilies } from './family-data.js';
import { loadContent, knowledge, cardsOf, addActivity } from './data.js';
import { formWord } from './fword.js';
import { play, css, reduced, wait, nudge, finishAll } from './fx.js';
import { sheet as openSheet } from '../shared/textview.js';

/** From this many prefix tiles the hive is three rows round the root instead of a ring. */
const ROWS_FROM = 10;

/**
 * Three rows round the root: the four shortest prefixes beside it (two each side), the rest above and below, in the
 * tiles' order. @param {string[]} pre @returns {{top: string[], left: string[], right: string[], bottom: string[]}}
 */
export function rowGroups(pre) {
  const side = [...pre].sort((a, b) => a.length - b.length).slice(0, Math.min(4, Math.max(0, pre.length - 2)));
  const rest = pre.filter(p => !side.includes(p));
  const top = rest.slice(0, Math.ceil(rest.length / 2)), bottom = rest.slice(top.length);
  const mid = pre.filter(p => side.includes(p));
  return { top, left: mid.slice(0, Math.ceil(mid.length / 2)), right: mid.slice(Math.ceil(mid.length / 2)), bottom };
}

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
  /** @type {Map<string, Family>} */ let fams = new Map();
  /** @type {any} */ let k;
  /** @type {any} */ let found0;
  // the content and the day's board; then only the day's root's family file (family-data.js)
  try {
    [d, k] = await Promise.all([loadContent(ctx), knowledge(ctx).catch(() => null)]);
    found0 = await todayBoard(ctx, d, k);
    fams = found0 ? await familiesFor(ctx, d, [found0.root]) : new Map();
  } catch { found0 = undefined; }
  if (found0 === undefined || (found0 && !fams.has(found0.root))) {
    replace(el, h('div', { class: 'wb stack page-pad' }, backLink(), h('h1', null, t('build.today.title')), h('p', null, t('build.loadFailed'))));
    return restore;
  }
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
    busy: false, splitting: false, typing: false, learning: false, t0: performance.now(), over: false };
  // time on each clue: the time since he came to it, plus the time spent on it before (moving away keeps it)
  /** @type {Record<number, number>} */ const spent = {};
  const clueMs = () => (spent[S.idx] || 0) + performance.now() - S.t0;
  if (S.idx < 0) S.idx = 0;
  let alive = true;
  const nouns = forms.some(f => !!f.art);
  const STEM = fam.stem;
  // endings German chains (-lich then -keit, -er then -in): a second ending tile chains on only there
  const CHAINS = endingChains(fams.values());

  /* ---------------- layout ---------------- */
  const msg = h('p', { class: 'pz-msg', role: 'status', 'aria-live': 'polite' });
  // a long line can push the thumb row under the screen's edge on a small phone: the column then scrolls just enough
  // to keep Check in view (the head goes first; the meaning stays)
  const say = (/** @type {any[]} */ ...parts) => {
    replace(msg, ...parts);
    if (!parts.length || S.typing) return;
    requestAnimationFrame(() => { const r = acts.getBoundingClientRect(); if (alive && r.height && r.bottom > innerHeight) box.scrollBy({ top: r.bottom - innerHeight, behavior: 'instant' }); });
  };
  const de = (/** @type {string} */ s) => h('span', { class: 'pz-de', lang: langAttr(), dir: dirAttr() }, s);
  const countEl = h('span', { class: 'tnum pz-count-n' }, String(foundCount(day, day.done)));
  // one square per meaning under the root and the count; a tap on them opens the board too (the count is the button)
  const squares = h('span', { class: 'pz-sqs', 'aria-hidden': 'true', onclick: () => boardSheet() }, forms.map(() => h('i')));
  const prog = h('button', { type: 'button', class: 'pz-prog pressable', 'aria-haspopup': 'dialog', onpointerdown: keep, onclick: () => boardSheet() },
    h('span', { class: 'pz-count' }, countEl, ` ${t('build.today.found', { n: '', total: N }).trim()}`), h('span', { class: 'pz-chev', 'aria-hidden': 'true' }, '›'));
  const meaning = h('p', { class: 'pz-meaning' });
  const meta = h('p', { class: 'pz-meta' });
  const build = h('div', { class: 'pz-build', lang: langAttr(), dir: dirAttr() });
  const navBtn = (/** @type {number} */ dir) => h('button', { type: 'button', class: 'pz-nav pressable', 'aria-label': t(dir < 0 ? 'build.today.prev' : 'build.today.next'), onpointerdown: keep, onclick: () => go(S.idx + dir) }, icon(dir < 0 ? 'prev' : 'next', { size: 16 }));
  const clue = h('section', { class: 'pz-clue', 'aria-label': t('build.today.clueRegion') }, h('div', { class: 'pz-clue-top' }, navBtn(-1), h('div', { class: 'pz-clue-mid' }, meaning, meta), navBtn(1)), build, msg);
  const hive = h('div', { class: 'pz-hive', role: 'group', 'aria-label': t('build.today.prefixes') });
  const ends = h('div', { class: 'pz-ends', role: 'group', 'aria-label': t('build.today.endings') });
  const playArea = h('div', { class: 'pz-play' }, hive, ends);
  const learn = h('div', { class: 'pz-learn', hidden: true });
  const input = /** @type {HTMLInputElement} */ (h('input', { class: 'pz-type', type: 'text', lang: langAttr(), dir: dirAttr(), autocapitalize: 'off', autocomplete: 'off', spellcheck: 'false', enterkeyhint: 'go', 'aria-label': t('build.today.typeField'), hidden: true }));
  input.setAttribute('autocorrect', 'off');
  const typeBtn = h('button', { type: 'button', class: 'btn pressable', 'aria-pressed': 'false', onpointerdown: keep, onclick: () => setTyping(!S.typing) }, t('build.today.type'));
  const delBtn = h('button', { type: 'button', class: 'btn pressable', onpointerdown: keep, onclick: () => del() }, t('build.today.delete'), h('kbd', null, '⌫'));
  const checkBtn = h('button', { type: 'button', class: 'btn btn-primary pressable pz-check', onpointerdown: keep, onclick: () => check() }, t('build.today.check'), h('kbd', null, '↵'));
  const acts = h('div', { class: 'pz-acts' }, input, delBtn, typeBtn, checkBtn);
  const help = h('button', { type: 'button', class: 'pz-help pressable', 'aria-label': t('build.today.help'), onpointerdown: keep, onclick: () => say(t('build.today.helpText')) }, icon('info', { size: 20 }));
  const head = h('div', { class: 'pz-head' }, backLink(), h('h1', null, t('build.today.title')), help);
  // the root and its meaning share a row with the count (it was a row of its own: B2 boards pushed Check off a phone);
  // the root opens the family view, so the family is one tap from the game
  const famHref = `#/practice/build/family/${encodeURIComponent(fam.root)}?from=today`;
  const rootLine = h('div', { class: 'pz-top' },
    h('a', { class: 'pz-root pressable', href: famHref, onpointerdown: keep }, h('span', { class: 'pz-root-w', lang: langAttr(), dir: dirAttr() }, fam.root), h('span', { class: 'pz-root-en' }, fam.en),
      h('span', { class: 'sr-only' }, `, ${t('build.today.seeFamily')}`)),
    prog);
  // the status line sits in the clue card under the word it is about, and takes room only when it says something
  const main = h('div', { class: 'pz-main' }, head, rootLine, squares, clue, playArea, learn, acts);
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
    // up to 9 short prefixes on a ring round the root. From 10 (B2, some B1 boards), with a long prefix (wieder,
    // zurück), or when the endings take two rows: three rows round the root, laid out by the browser, so no tile
    // overlaps another at any width and the hive is 44 px shorter (the ring overlapped 4 pairs at B2 and pushed Check
    // off a 664 px phone). The shortest prefixes sit beside the root.
    const rows = n >= ROWS_FROM || pre.some(p => p.length > 4) || (n >= 6 && day.tiles.suf.length > 2 && nouns);
    hive.classList.toggle('is-rows', rows);
    const tile = (/** @type {string} */ p, /** @type {Record<string, string> | null} */ style) => {
      const b = h('button', { type: 'button', class: 'hx pressable', lang: langAttr(), dir: dirAttr(), 'aria-pressed': 'false', 'aria-label': t('build.today.prefixTile', { p }), onpointerdown: keep, onclick: () => pick('pre', p, b), style }, p);
      tileEls.set(tileKey('pre', p), b);
      return b;
    };
    const centre = h('div', { class: 'hx is-centre', lang: langAttr(), dir: dirAttr(), role: 'img', 'aria-label': t('build.today.rootTile', { root: fam.root }) }, STEM, h('small', null, fam.root));
    if (rows) {
      const g = rowGroups(pre);
      hive.append(h('div', { class: 'pz-hrow' }, g.top.map(p => tile(p, null))),
        h('div', { class: 'pz-hrow' }, g.left.map(p => tile(p, null)), centre, g.right.map(p => tile(p, null))),
        h('div', { class: 'pz-hrow' }, g.bottom.map(p => tile(p, null))));
    } else {
      pre.forEach((p, i) => {
        const a = -Math.PI / 2 + i * (2 * Math.PI / Math.max(1, n));
        hive.append(tile(p, { left: `${50 + 40 * Math.cos(a)}%`, top: `${50 + 38 * Math.sin(a)}%` }));
      });
      hive.append(centre);
    }
    replace(ends);
    const sufRow = h('div', { class: 'pz-ends-row' }), artRow = h('div', { class: 'pz-ends-row' });
    for (const x of day.tiles.suf) { const b = h('button', { type: 'button', class: 'hx pressable', lang: langAttr(), dir: dirAttr(), 'aria-pressed': 'false', 'aria-label': t('build.today.endingTile', { s: endLabel(x) }), 'data-suf': x, onpointerdown: keep, onclick: () => pick('suf', x, b) }, endLabel(x)); tileEls.set(tileKey('suf', x), b); sufRow.append(b); }
    if (nouns) ARTICLES.forEach((x, i) => { const b = h('button', { type: 'button', class: 'hx is-art pressable', lang: langAttr(), dir: dirAttr(), 'aria-pressed': 'false', 'aria-label': t('build.today.articleTile', { a: x }), onpointerdown: keep, onclick: () => pick('art', x, b) }, x, h('kbd', null, String(i + 1))); tileEls.set(tileKey('art', x), b); artRow.append(b); });
    // two endings and the articles share a row with a rule between them; more endings take a row of their own, so
    // nothing wraps on its own (the rule ended up alone at the end of a line)
    const two = day.tiles.suf.length > 2 && nouns;
    ends.classList.toggle('is-two', two);
    if (two) ends.append(sufRow, artRow);
    else ends.append(...sufRow.childNodes, ...(day.tiles.suf.length && nouns ? [h('span', { class: 'pz-sep', 'aria-hidden': 'true' })] : []), ...artRow.childNodes);
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
    return x === 'pp' ? t('build.today.pp') : x === 'ppr' ? t('build.today.ppr') : x === 'inf' ? t('build.today.inf') : sx && /^-/.test(sx.label) ? sx.label.split(',')[0] : sx ? sx.label : `-${x}`;
  }
  function syncTiles() {
    for (const [key, b] of tileEls) { const [part, v] = key.split(':'); b.setAttribute('aria-pressed', String(part === 'art' ? S.b.art === v : partsOf(S.b[/** @type {Part} */ (part)]).includes(v))); }
  }

  /* ---------------- the clue ---------------- */
  const cur = () => forms[S.idx];
  const card = () => day.cards[S.idx];
  function drawClue({ keepBuild = false } = {}) {
    const f = cur(), id = card();
    meaning.textContent = f.clue;
    // a long meaning is set a size smaller, so three lines still leave Check on a 664 px phone
    meaning.classList.toggle('is-long', f.clue.length > 38);
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
    // typing: the field holds the word, so the card keeps its empty slots (it showed the word twice)
    const B = S.typing ? { art: null, pre: null, suf: null } : S.b;
    const noun = !!f.art;
    /** @type {any[]} */ const parts = [];
    const slot = (/** @type {Part} */ part, /** @type {string | null} */ v, /** @type {string} */ shown) => {
      const st = states[part];
      if (!v) {
        // the hint is the whole first part: un + ver of unverständlich
        const hint = part === 'pre' && easy && (day.tries[id] || 0) > 0 && f.pre.length ? partsOf(buildOf(f).pre).join('') : null;
        return h('span', { class: ['pt', 'is-empty', hint && 'is-hint'], 'data-part': part }, hint || t(`build.today.slot.${part}`));
      }
      return h('span', { class: ['pt', `is-${part}`, st && `is-${st}`], 'data-part': part, 'data-v': v }, shown);
    };
    if (noun || B.art) parts.push(slot('art', B.art, B.art || ''));
    // one piece per tile: un + ver, -lich + -keit
    const pres = partsOf(B.pre), ends = partsOf(B.suf);
    const nounEnd = ends.length > 0 && nounEnding(ends[ends.length - 1]);
    const cap = (/** @type {string} */ x) => x.charAt(0).toUpperCase() + x.slice(1);
    if (!pres.length) parts.push(slot('pre', null, ''));
    pres.forEach((p, k) => parts.push(slot('pre', p, k === 0 && nounEnd ? cap(p) : p)));
    const rootText = !pres.length && nounEnd ? cap(STEM) : STEM;
    parts.push(h('span', { class: ['pt', 'is-root', pres.length && 'is-joined-s', ends.length && 'is-joined-e'], 'data-part': 'root' }, rootText, ends.length ? null : h('span', { class: 'pt-tail' }, fam.root.slice(STEM.length))));
    if (noun && !ends.length) parts.push(slot('suf', null, ''));
    for (const x of ends) parts.push(slot('suf', x, endLabel(x).replace(/^-/, '')));
    replace(build, parts);
    if (S.typing) { build.setAttribute('aria-label', input.value ? t('build.today.yourWord', { w: input.value }) : t('build.today.yourWordNone')); return; }
    const spelled = B.pre || B.suf ? `${B.art ? `${B.art} ` : ''}${spell(fam, B)}` : '';
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
        h('span', { class: ['pz-bsq', dn && `is-${dn}`], role: dn ? 'img' : null, 'aria-label': dn ? t(`build.today.sq.${dn}`) : null, 'aria-hidden': dn ? null : 'true' }),
        h('span', { class: 'pz-bm' }, w, h('span', { class: 'pz-bclue' }, f.clue)),
        h('span', { class: 'caption' }, t(`build.family.type.${f.cls}`).toLowerCase())));
    }));
    return [h('h2', null, t('build.today.board')), h('p', { class: 'caption' }, t('build.today.boardMeta', { root: fam.root, n: N, level })), list,
      h('p', { class: 'pz-extra' }, day.extras.length ? t('build.today.extras', { list: day.extras.map(x => formName(x)).join(', ') }) : t('build.today.extrasNone')),
      h('p', { class: 'pz-key' }, ['f1', 'f2', 'shown', 'open'].map(x => h('span', null, h('span', { class: ['pz-bsq', `is-${x}`], 'aria-hidden': 'true' }), t(`build.today.key.${x}`))))];
  }
  const formName = (/** @type {string} */ id) => { const f = fam.byId.get(id); return f ? `${f.art ? `${f.art} ` : ''}${f.word}` : id; };
  function drawBoard() { replace(aside, boardNodes(false)); if (sh) sh.set(...boardNodes(true).slice(1)); }   // the sheet has its own title
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
    S.b = tapTile(S.b, part, v, CHAINS);
    drawBuild(); syncTiles();
    const on = part === 'art' ? S.b.art === v : partsOf(S.b[part]).includes(v);
    if (!on || !from || reduced()) return;
    const to = /** @type {HTMLElement | null} */ (build.querySelector(`[data-part="${part}"][data-v="${v}"]`));
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
    S.b = dropLast(S.b);
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
    if (day.done[id]) { advance(); return; }
    let slip = false, typed = false, typedWord = '';
    /** @type {import('../../domain/wordbuild-family.js').Judged | null} */ let tres = null;
    const raw = S.typing ? input.value.trim() : null;
    if (raw != null) {
      if (!raw) { input.focus({ preventScroll: true }); return; }
      // a typed word is judged as a word (domain judgeTyped): right only when it is the clue's own word, graded as the
      // round grades it; another word of the family is that word, never this one
      const r = judgeTyped({ fam, cards: day.cards, i: S.idx, done: day.done, input: raw, lexicon: d.flex });
      if (!r) { say(t('build.today.useRoot', { stem: STEM })); nudge(build); return; }
      typed = true; tres = r; slip = r.slip;
      typedWord = raw.replace(/^(der|die|das)\s+/i, '');
      S.b = { ...r.pick };
      if (S.typing) setTyping(false);
      drawBuild(); syncTiles();
    }
    const res = tres || judge({ fam, cards: day.cards, i: S.idx, done: day.done, pick: S.b });
    const tries = () => day.tries[id] || 0;
    if (res.outcome === 'empty') { say(t('build.today.tapFirst')); nudge(build); return; }
    if (res.outcome === 'other' && res.target != null) {
      // another meaning on the board: he is told which, no try is spent, and nothing is filled or graded (the
      // meaning was never read; tapping tiles and Check must not clear the board)
      const of = forms[res.target];
      const w = `${of.art ? `${of.art} ` : ''}${of.word}`;
      say(...splitText(t('build.today.onBoard', { word: w, en: of.clue }), w));
      nudge(build);
      return;
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
    if (res.outcome === 'article' && res.noArticle) say(t('build.today.noArticle'));
    else if (res.outcome === 'article') {
      const sx = d.c.suffixes.find((/** @type {any} */ x) => x.id === f.suf[f.suf.length - 1]);
      say(t('build.today.article', { rule: f.note || (sx ? `${sx.label}: ${sx.rule}` : '') }));
    } else if (res.outcome === 'nonword') say(`${t('build.today.nonword', { word: typed ? typedWord : spell(fam, S.b) })} ${nearPre}`.trim());
    // a word of the rare list may be German: it is never called wrong, only not this family's
    else say(`${t(res.rare ? 'build.today.missRare' : 'build.today.miss', { word: typed ? typedWord : spell(fam, S.b) })} ${nearPre}`.trim());
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
    const yes = h('button', { type: 'button', class: 'btn pressable pz-split', onpointerdown: keep, onclick: () => answerSplit(true, o) }, h('span', null, t('build.game.splits'), ' ', h('kbd', null, '←')), h('small', null, t('build.game.splitsHint')));
    const no = h('button', { type: 'button', class: 'btn pressable pz-split', onpointerdown: keep, onclick: () => answerSplit(false, o) }, h('span', null, t('build.game.stays'), ' ', h('kbd', null, '→')), h('small', null, t('build.game.staysHint')));
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
        // the stem moves in front as the verb's present form (stellt … ab), never the infinitive (stellen ab)
        root.textContent = (fam.info && fam.info.pres3) || `${STEM}t`;
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

  /* ---------------- a word found, or shown: what its parts mean ---------------- */
  /** @param {{slip?: boolean, typed?: boolean, splitMiss?: boolean}} o */
  async function finish(o) {
    const f = cur(), id = card();
    const tries = day.tries[id] || 0;
    const artMiss = !!day.art[id];
    if (o.slip) day.slip[id] = true;
    day.done[id] = doneOf({ tries, splitMiss: !!o.splitMiss, artMiss });
    day.points = (day.points || 0) + pointsOf(tries, false, !!o.splitMiss);
    const ms = clueMs();
    day.ms = (day.ms || 0) + Math.round(ms);
    saveDay(store, day);
    answerClue(ctx, day, id, { tries, splitMiss: !!o.splitMiss, artMiss, slip: !!o.slip, typed: !!o.typed, ms });
    say();
    drawClue();
    // the word settles where it was built and its square fills (the word no longer flies across the meaning)
    play(build.querySelector('.fw'), [{ transform: 'scale(1.06)' }, { transform: 'none' }], { duration: 420, easing: css('--spring-pop') });
    const sq = /** @type {HTMLElement | undefined} */ (squares.children[S.idx]);
    if (sq) play(sq, [{ transform: 'scaleY(0.4)', opacity: 0.4 }, { transform: 'none', opacity: 1 }], { duration: 560, delay: 120, easing: css('--spring-pop') });
    const lesson = teach(f, { splitMiss: !!o.splitMiss });
    announce(`${f.art ? `${f.art} ` : ''}${f.word}. ${t('build.today.found', { n: foundCount(day, day.done), total: N })}. ${lesson}`);
  }
  async function show() {
    const f = cur(), id = card();
    day.done[id] = 'shown';
    saveDay(store, day);
    answerClue(ctx, day, id, { tries: day.tries[id] || TRIES, shown: true, ms: clueMs() });
    say(t('build.today.shown', { word: `${f.art ? `${f.art} ` : ''}${f.word}`, why: '' }));
    drawClue();
    teach(f, { shown: true });
  }
  const allDone = () => day.cards.every(id => day.done[id]);
  /** After a found or shown word: the next open meaning, or the done screen. */
  function advance() { if (allDone()) { hideLearn(); done(); } else nextOpen(); }

  /* the lesson of a word, in place of the tiles until he moves on (Next, Enter, ‹ ›, a letter typed): its parts with
     what each means (aus- out, stell put, -ung die), the content's line on how the parts give the meaning, the change
     (splits off or never splits with the authored Perfekt; a noun's article from its ending), the example. No timer. */
  const PX = new Map([...d.c.prefixes, ...(d.c.particles || [])].map((/** @type {any} */ p) => [p.id, p]));
  const SX = new Map(d.c.suffixes.map((/** @type {any} */ x) => [x.id, x]));
  /** @param {string} p */
  const preSense = p => (p === 'un' ? t('build.today.learn.un') : (PX.get(p) || {}).short || (PX.get(p) || {}).core || '');
  /** @param {string} x */
  const endSense = x => {
    const sx = SX.get(x);
    if (sx && sx.cls === 'noun') return t('build.today.learn.nounEnd', { art: sx.art, short: sx.short });
    if (sx) return sx.short || '';
    return ['pp', 'ppr', 's', 'los', 'isch'].includes(x) ? t(`build.today.learn.end.${x}`) : '';
  };
  /** The parts of a word with their meanings, outermost prefix first. @param {Form} f */
  function partsRow(f) {
    const pc = piecesOf(f);
    const ids = [...f.pre].reverse();
    /** @type {any[]} */ const out = [];
    const part = (/** @type {string} */ kind, /** @type {string} */ text, /** @type {string} */ sense) => h('span', { class: ['pz-part', `is-${kind}`] },
      h('span', { class: 'pz-part-de', lang: langAttr(), dir: dirAttr() }, text), sense ? h('span', { class: 'pz-part-en' }, sense) : null);
    // the prefix as a prefix (aus-, not the Aus- of a noun's spelling)
    pc.pre.forEach((x, i) => { const id = ids[i] || x.toLowerCase(); out.push(part('pre', `${id}-`, preSense(id))); });
    out.push(part('root', pc.base, String(fam.en).split(/[,;]/)[0].trim()));
    pc.suf.forEach((x, i) => { out.push(part('suf', `-${x}`, endSense(f.suf[i] || x))); });
    return h('p', { class: 'pz-parts' }, out.flatMap((x, i) => (i ? [h('span', { class: 'pz-plus', 'aria-hidden': 'true' }, '+'), x] : [x])));
  }
  /** The content's line on how the parts give the meaning, without the "aus = out:" the parts already say. @param {Form} f @returns {string} */
  function whyLine(f) {
    if (f.grade === 'O' && !f.why) return t('build.today.learnWhy').trim();
    // a noun or adjective without its own line has its verb's first sentence (the verb's other senses are not the
    // noun's): die Ausstellung, from ausstellen: put things out where people can see them.
    const parent = !f.why && f.parent ? fam.byId.get(f.parent) : null;
    if (parent && parent.why && parent.cls === 'verb') { const pw = /** @type {string} */ (whyLine(parent)).split(/(?<=\.)\s+/)[0]; return pw ? t('build.today.learn.from', { word: parent.word, why: pw.charAt(0).toLowerCase() + pw.slice(1) }) : ''; }
    const w = String(f.why || '');
    const p = f.pre.length ? [...f.pre].reverse()[f.pre.length - 1] : '';
    const m = p ? new RegExp(`^${p}-? = [^:]+:\\s*`, 'i').exec(w) : null;
    const rest = m ? w.slice(m[0].length) : w;
    return rest ? rest.charAt(0).toUpperCase() + rest.slice(1) : '';
  }
  /** Splits off or never splits with the Perfekt; a noun's article and the rule of its ending; the derivability. @param {Form} f */
  function changeRow(f) {
    /** @type {any[]} */ const bits = [];
    if (f.cls === 'verb' && f.join) {
      bits.push(h('span', { class: ['pz-tag', f.join === 's' ? 'is-s' : 'is-i'] }, t(f.join === 's' ? 'build.family.legend.split' : 'build.family.legend.stay')));
      if (f.pp) bits.push(h('span', null, t('build.family.perfekt'), ' ', h('span', { class: 'pz-de', lang: langAttr(), dir: dirAttr() }, `${String(f.aux || 'hat').replace('/', ' / ')} ${f.pp}`)));
    } else if (f.cls === 'noun' && f.art) {
      const sx = SX.get(f.suf[f.suf.length - 1]);
      bits.push(h('span', { class: 'pz-tag is-art', lang: langAttr(), dir: dirAttr() }, f.art));
      const rule = f.note || (sx ? `${sx.label}: ${String(sx.rule).split('. ')[0].replace(/\.$/, '')}.` : '');
      if (rule) bits.push(h('span', null, rule));
    } else if (f.note) bits.push(h('span', null, f.note));
    if (f.grade) bits.push(h('span', { class: 'pz-grade' }, h('span', { class: ['fv-gr', `is-${f.grade}`], 'aria-hidden': 'true' }), t(`build.family.legend.${f.grade}`)));
    return bits.length ? h('p', { class: 'pz-change' }, bits) : null;
  }
  /**
   * Show the lesson in place of the tiles; returns its text for the announcement.
   * @param {Form} f @param {{splitMiss?: boolean, shown?: boolean}} o
   */
  function teach(f, o) {
    const why = whyLine(f);
    const miss = o.splitMiss ? h('p', { class: 'pz-learn-miss' }, t(f.join === 's' ? 'build.today.splitWrong.s' : 'build.today.splitWrong.i')) : null;
    replace(learn, miss, partsRow(f), why ? h('p', { class: 'pz-why' }, why) : null, changeRow(f),
      f.ex ? h('p', { class: 'pz-learn-ex' }, exampleLine(f)) : null, f.ex && f.exEn ? h('p', { class: 'pz-exen' }, f.exEn) : null);
    // the lesson takes the tiles' place at their height, so nothing below moves
    const hgt = playArea.offsetHeight;
    if (hgt) learn.style.minHeight = `${hgt}px`;
    playArea.hidden = true; learn.hidden = false; S.learning = true;
    box.classList.add('is-learning');
    setNext(allDone() ? 'finish' : 'next');
    if (!reduced()) [...learn.children].forEach((x, i) => play(x, [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 320, delay: 60 + i * 50, easing: css('--ease-out') }));
    return [o.splitMiss ? t(f.join === 's' ? 'build.today.splitWrong.s' : 'build.today.splitWrong.i') : '', why].filter(Boolean).join(' ');
  }
  function hideLearn() {
    if (!S.learning) return;
    S.learning = false;
    learn.hidden = true; replace(learn); playArea.hidden = false;
    box.classList.remove('is-learning');
    setNext(null);
  }
  /** The thumb row's last button: Check, or Next (and Finish on the last word) while a lesson shows. @param {'next' | 'finish' | null} m */
  function setNext(m) {
    acts.classList.toggle('is-next', !!m);
    replace(checkBtn, t(m === 'finish' ? 'build.today.finish' : m ? 'build.today.nextBtn' : 'build.today.check'), h('kbd', null, '↵'));
  }

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

  /* ---------------- navigation ---------------- */
  /** @param {number} i @param {{keepBuild?: boolean}} [o] */
  async function go(i, { keepBuild = false } = {}) {
    if (S.splitting || S.over) return;
    const n = ((i % N) + N) % N;
    if (n === S.idx) { if (!keepBuild) drawClue(); return; }
    hideLearn();
    if (box.scrollTop && !S.typing) box.scrollTo({ top: 0, behavior: 'instant' });
    const dir = n > S.idx ? 1 : -1;
    // the new meaning is current at once: a tile tapped while the card slides counts for it (input is never blocked)
    spent[S.idx] = clueMs();
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
    // the reason to come back: tomorrow's root, named now and kept (family-data.js tomorrowRoot); count only, no streak
    const next = tomorrowRoot(ctx, d, k);
    const nextFam = next ? ((d.c.familyIndex && d.c.familyIndex.roots.find((/** @type {any} */ r) => r.root === next)) || fams.get(next) || null) : null;
    const famLink = (/** @type {Form} */ f) => `#/practice/build/family/${encodeURIComponent(fam.root)}?w=${encodeURIComponent(f.id)}&from=today`;
    /** A word of the board (or an extra word): its state, the word, its meaning; a link to its card in the family. @param {Form} f @param {string | null} dn */
    const wordRow = (f, dn) => h('li', null, h('a', { class: 'pz-dw pressable', href: famLink(f) },
      h('span', { class: ['pz-bsq', dn && `is-${dn}`], 'aria-hidden': 'true' }),
      h('span', { class: 'pz-dw-w', lang: langAttr(), dir: dirAttr() }, f.art ? h('span', { class: 'fw-art' }, `${f.art} `) : null, f.word),
      h('span', { class: 'pz-dw-en' }, f.clue || f.en),
      h('span', { class: 'pz-dw-st caption' }, dn === 'shown' ? t('build.today.doneShown') : dn ? t('build.today.doneFound') : t('build.today.doneExtra'))));
    // the board's prefixes and endings with what each means (the parts its words were built from)
    const preIds = [...new Set(forms.flatMap(f => [...f.pre].reverse()))];
    const sufIds = [...new Set(forms.flatMap(f => f.suf))];
    const partRow = (/** @type {string} */ text, /** @type {string} */ sense) => h('li', { class: 'pz-dp' }, h('span', { class: 'pz-dp-de', lang: langAttr(), dir: dirAttr() }, text), h('span', { class: 'pz-dp-en' }, sense || ''));
    const extras = day.extras.map(id => fam.byId.get(id)).filter(Boolean);
    const sec = h('section', { class: 'pz-done', 'aria-labelledby': 'pz-done-h' },
      h('h2', { id: 'pz-done-h', tabindex: '-1' }, t('build.today.doneTitle')),
      fig, h('p', { class: 'pz-done-of' }, t('build.today.doneOf', { n: N })), grid,
      next ? h('p', { class: 'pz-next' }, t('build.today.doneTomorrowRoot', { root: '\u0000' }).split('\u0000').flatMap((x, i) => (i ? [h('span', { class: 'pz-next-root', lang: langAttr(), dir: dirAttr() }, next), x] : [x])).filter(x => x !== ''),
        nextFam ? h('span', { class: 'pz-next-en' }, ` ${String(nextFam.en).split(/[,;]/)[0].trim()}`) : null) : h('p', { class: 'pz-next' }, t('build.today.doneTomorrow')),
      h('p', { class: 'caption pz-done-line' }, [day.extras.length ? t('build.today.doneExtras', { n: day.extras.length }) : null,
        counted.length ? t('build.today.doneCounted', { words: counted.join(' and ') }) : t('build.today.doneNothing')].filter(Boolean).join(' ')),
      h('section', { class: 'pz-dsec', 'aria-labelledby': 'pz-dparts-h' }, h('h3', { id: 'pz-dparts-h' }, t('build.today.doneParts')),
        h('ul', { class: 'pz-dparts' }, preIds.map(p => partRow(`${p}-`, preSense(p))), sufIds.map(x => partRow(endLabel(x), endSense(x))))),
      h('section', { class: 'pz-dsec', 'aria-labelledby': 'pz-dwords-h' }, h('h3', { id: 'pz-dwords-h' }, t('build.today.doneWords')),
        h('ul', { class: 'pz-dwords' }, forms.map((f, i) => wordRow(f, day.done[day.cards[i]] || null)), extras.map(f => wordRow(/** @type {Form} */ (f), null)))),
      // One word (WORDGAMES-DESIGN §5.2, phase 3) goes here: a second, typed round on one form of the root
      h('div', { class: 'pz-done-acts' },
        h('a', { class: 'btn btn-primary pressable', href: `#/practice/build/family/${encodeURIComponent(fam.root)}?from=today` }, t('build.today.seeFamily')),
        h('a', { class: 'btn pressable', href: '#/today' }, t('build.today.toToday'))));
    replace(main, head, rootLine, squares, sec);
    drawProgress();
    drawBoard();
    countTo(fig, n, { duration: 700 });
    if (!reduced()) {
      [...grid.children].forEach((x, i) => play(x, [{ transform: 'scale(0.4)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 560, delay: 200 + i * 40, easing: css('--spring-pop') }));
      const after = 200 + grid.children.length * 40;
      [...sec.querySelectorAll('.pz-next, .pz-dsec, .pz-done-acts')].forEach((x, i) => play(x, [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 380, delay: after + i * 70, easing: css('--ease-out') }));
    }
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
    if (/^[a-zäöüß]$/i.test(e.key) && !S.over) { e.preventDefault(); if (S.learning) { if (allDone()) return; nextOpen(); } setTyping(true, e.key); }
  }
  document.addEventListener('keydown', onKey);

  drawTiles();
  if (allDone()) done(); else drawClue();
  warmFamilies(ctx, d);   // the other roots' files, after the first paint (offline later)
  // test hook (localhost only)
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) /** @type {any} */ (window).__family = { get day() { return day; }, get forms() { return forms; }, get idx() { return S.idx; } };
  return () => { alive = false; finishAll(); document.removeEventListener('keydown', onKey); unfit(); sh?.close?.(); restore(); };
}
