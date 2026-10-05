/* Sentences: the sentence machine (#/practice/build/machine[/<frame>][?f=<form>]).
   One sentence in five frames (present, Perfekt, after weil or dass, with a modal verb, with zu). Tiles are the
   grammar tiles (DESIGN.md: the only place role colours appear): the verb pieces in role-door, the helper in
   role-turn, ge- and zu in role-slot, the weil/dass lead in role-glue, the rest plain. A tile keeps its identity
   between frames, so the separable prefix visibly travels to the end, ge- and zu drop into the gap between prefix
   and stem, and an inseparable verb stays welded (ge- tries to get in and is turned away). The two slots of the
   sentence bracket ("Position 2", "End") are labelled under the tiles.

   Motion (PREFIX-DESIGN §8): FLIP every tile by its key. The prefix is the hero: it lifts 10-28 px by distance and
   lands (620 ms, ease-in-out, translation only); other tiles move on the snappy spring (420 ms); ge- and zu drop in
   (560 ms, spring-pop, delay 260); leaving tiles fade upward (160 ms); the slot labels fade in after the move (200 ms,
   delay 460); a welded Perfekt turns a ghost ge- away (900 ms, delay 300; the stem dips 2 px). From the infinitive:
   the tray's infinitive is the FLIP origin. Reduced motion: a 140 ms crossfade of the line, no ghost; the rule line
   says "No ge-". Pieces of one verb and its full stop never wrap apart. An aria-live region reads the sentence and
   the rule after each change. */
import { h, replace } from '../../core/dom.js';
import { FORMS, sentenceOf, bare } from '../../domain/wordbuild.js';
import { backLink } from './compass.js';
import { play, css, reduced, crossfade } from './fx.js';
import { loadContent } from './data.js';

const VERBISH = new Set(['R', 'P', 'G', 'Z']);
const TILE = /** @type {Record<string, string>} */ ({ R: 'is-verb', P: 'is-part', G: 'is-slot', Z: 'is-slot', X: 'is-aux', C: 'is-conj', '.': 'is-punct' });
const VOWELS = /(äu|au|ei|eu|ie|aa|ee|oo|[aeiouäöüy])/i;

/** Text with the stressed vowel marked by a dot under it. @param {string} s */
function dotted(s) {
  const m = VOWELS.exec(s);
  return m ? [s.slice(0, m.index), h('span', { class: 'wb-sv' }, m[0], h('span', { class: 'wb-dot', 'aria-hidden': 'true' })), s.slice(m.index + m[0].length)] : [s];
}

/** A stress pattern ("um|FAH|ren") as syllables with a dot under the stressed one. @param {string} s */
export function stressPattern(s) {
  return h('span', { class: 'wb-syll', lang: 'de' }, s.split('|').map((x, i) => [i ? h('span', { class: 'wb-sylsep', 'aria-hidden': 'true' }, '·') : null,
    /\p{Lu}/u.test(x) && x.length > 0 && (x === x.toUpperCase()) ? h('span', { class: 'wb-sv wb-stressed' }, x.toLowerCase(), h('span', { class: 'wb-dot', 'aria-hidden': 'true' })) : x.toLowerCase()]));
}

/**
 * The tiles of one form.
 * @param {any} f a frame @param {string} form
 */
export function buildLine(f, form) {
  const toks = f.forms[form] || [];
  const line = h('div', { class: 'wb-line', lang: 'de' });
  let grp = /** @type {HTMLElement | null} */ (null);
  toks.forEach(([k, text], i) => {
    const prev = toks[i - 1], next = toks[i + 1];
    // pieces of a separable verb touch: P+G+R, P+Z+R, P+R. An inseparable verb's zu stays a separate word.
    const joinPrev = f.kind === 's' && VERBISH.has(k) && prev && VERBISH.has(prev[0]) && k !== 'P';
    const joinNext = f.kind === 's' && VERBISH.has(k) && next && VERBISH.has(next[0]) && next[0] !== 'P';
    const txt = h('span', { class: 'wb-ttxt' });
    if (k === 'R' && f.kind === 'i' && text.toLowerCase().startsWith(f.pre)) txt.append(h('span', { class: 'wb-wpre' }, text.slice(0, f.pre.length)), ...dotted(text.slice(f.pre.length)));
    else if (k === 'R' && f.inner && text.startsWith(f.inner)) txt.append(h('span', { class: 'wb-wpre' }, f.inner), text.slice(f.inner.length));
    else if (k === 'P') txt.append(...dotted(text));
    else txt.append(text);
    const tile = h('span', { class: ['wb-t', TILE[k], joinPrev && 'is-joinL', joinNext && 'is-joinR'], 'data-k': k }, txt);
    if (!grp || !(joinPrev || k === '.')) { grp = h('span', { class: 'wb-grp' }); line.append(grp); }
    grp.append(tile);
  });
  return line;
}

/** Label the sentence bracket under the tiles, from layout offsets (never mid-move). @param {HTMLElement} line @param {any} f @param {string} form @param {any} t */
function labelSlots(line, f, form, t) {
  line.querySelectorAll('.wb-slotlab').forEach(e => e.remove());
  const tiles = /** @type {HTMLElement[]} */ ([...line.querySelectorAll('.wb-t')]);
  const box = (/** @type {HTMLElement} */ el) => { let x = 0, y = 0; /** @type {HTMLElement | null} */ let e = el; while (e && e !== line) { x += e.offsetLeft; y += e.offsetTop; e = /** @type {HTMLElement | null} */ (e.offsetParent); } return { l: x, t: y, r: x + el.offsetWidth, b: y + el.offsetHeight }; };
  const lab = (/** @type {HTMLElement} */ a, /** @type {HTMLElement} */ b, /** @type {string} */ text) => {
    const ra = box(a), rb = box(b);
    const e = h('span', { class: 'wb-slotlab', 'aria-hidden': 'true' }, h('span', null, text));
    e.style.left = `${ra.l}px`; e.style.width = `${rb.r - ra.l}px`; e.style.top = `${Math.max(ra.b, rb.b) + 8}px`;
    line.append(e);
    play(e, [{ opacity: 0 }, { opacity: 1 }], { duration: 200, delay: 460 });
  };
  if (form !== 'sub' && form !== 'zu' && tiles[1]) lab(tiles[1], tiles[1], t('build.machine.pos2'));
  const vs = tiles.filter(x => VERBISH.has(String(x.dataset.k)) && !(form === 'pres' && x.dataset.k === 'R'));
  if (vs.length && !(f.kind === 'i' && form === 'pres')) lab(vs[0], vs[vs.length - 1], t('build.machine.end'));
}

/** The rule line under the stage. @param {any} f @param {string} form @param {any} t */
export function ruleNode(f, form, t) {
  const key = f.inner && form === 'perf' ? 'build.rule.inner' : `build.rule.${f.kind}.${form}`;
  const [a, b] = t(key, { inner: f.inner || '', pp: f.pp }).split('|');
  return h('p', { class: 'wb-rule' }, h('b', null, a), b || '');
}

/** @param {HTMLElement} root */
const rects = root => { /** @type {Map<string, DOMRect>} */ const m = new Map(); root.querySelectorAll('[data-k]').forEach(x => m.set(/** @type {HTMLElement} */ (x).dataset.k || '', x.getBoundingClientRect())); return m; };

/**
 * Move the stage to a form: FLIP the tiles from where they were (or from the tray's infinitive).
 * @param {HTMLElement} stage @param {any} f @param {string} form @param {any} t @param {{from?: Map<string, DOMRect> | null}} [o]
 */
export function swapLine(stage, f, form, t, { from = null } = {}) {
  const old = /** @type {HTMLElement | null} */ (stage.querySelector('.wb-line'));
  const before = from || (old ? rects(old) : new Map());
  /** @type {Map<string, HTMLElement>} */ const oldTiles = new Map();
  old?.querySelectorAll('[data-k]').forEach(x => oldTiles.set(/** @type {HTMLElement} */ (x).dataset.k || '', /** @type {HTMLElement} */ (x)));
  const line = buildLine(f, form);
  if (old) old.replaceWith(line); else stage.append(line);
  requestAnimationFrame(() => labelSlots(line, f, form, t));
  if (reduced()) { crossfade(line); return; }
  const sr = stage.getBoundingClientRect();
  for (const [k, tile] of oldTiles) {
    if (line.querySelector(`[data-k="${CSS.escape(k)}"]`)) continue;
    const r = before.get(k); if (!r) continue;
    const g = /** @type {HTMLElement} */ (tile.cloneNode(true));
    g.classList.add('wb-ghost'); g.setAttribute('aria-hidden', 'true');
    g.style.left = `${r.left - sr.left}px`; g.style.top = `${r.top - sr.top}px`;
    stage.append(g);
    play(g, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-8px)' }], { duration: 160, easing: css('--ease-in'), fill: 'forwards' }).then(() => g.remove());
  }
  line.querySelectorAll('[data-k]').forEach(x => {
    const tile = /** @type {HTMLElement} */ (x), k = tile.dataset.k || '', r0 = before.get(k), r1 = tile.getBoundingClientRect();
    if (!r0) {
      const drop = k === 'G' || k === 'Z';
      play(tile, [{ opacity: 0, transform: `translateY(${drop ? -26 : 8}px) scale(${drop ? 0.8 : 1})` }, { opacity: 1, transform: 'none' }],
        { duration: drop ? 560 : 300, delay: drop ? 260 : 120, easing: css(drop ? '--spring-pop' : '--ease-out') });
      return;
    }
    const dx = r0.left - r1.left, dy = r0.top - r1.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    if (k === 'P') {
      const lift = Math.min(28, 10 + Math.abs(dx) / 14);
      play(tile, [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: `translate(${dx * 0.45}px, ${dy * 0.45 - lift}px)`, offset: 0.45 }, { transform: 'none' }], { duration: 620, easing: css('--ease-inout') });
    } else play(tile, [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 420, easing: css('--spring-snappy') });
  });
  // a welded verb in the Perfekt: a ge- tries to get in and is turned away
  if ((f.kind === 'i' || f.inner) && form === 'perf') {
    const r = /** @type {HTMLElement | null} */ (line.querySelector('[data-k="R"]'));
    if (r) {
      const rr = r.getBoundingClientRect();
      const g = h('span', { class: 'wb-t is-slot wb-ghost', lang: 'de', 'aria-hidden': 'true' }, h('span', { class: 'wb-ttxt' }, 'ge'));
      stage.append(g);
      g.style.left = `${rr.left - sr.left - 6}px`; g.style.top = `${rr.top - sr.top - 44}px`;
      play(g, [{ transform: 'translateY(-10px)', opacity: 0 }, { transform: 'translateY(16px)', opacity: 1, offset: 0.4 }, { transform: 'translateY(4px)', opacity: 1, offset: 0.55 }, { transform: 'translateY(-14px)', opacity: 0 }],
        { duration: 900, delay: 300, easing: css('--ease-out'), fill: 'both' }).then(() => g.remove());
      play(r, [{ transform: 'none' }, { transform: 'translateY(2px)' }, { transform: 'none' }], { duration: 200, delay: 640 });
    }
  }
}

/** The tray: the infinitive, the start of every sentence. @param {any} f @param {any} t */
export function tray(f, t) {
  const word = bare(f.inf);
  const inf = h('span', { class: ['wb-t', 'is-verb', 'wb-inf'], lang: 'de' }, f.kind === 's'
    ? h('span', { class: 'wb-ttxt' }, h('b', null, f.pre), h('span', { class: 'wb-joint-t', 'aria-hidden': 'true' }, '|'), word.slice(f.pre.length))
    : h('span', { class: 'wb-ttxt' }, h('span', { class: 'wb-wpre' }, f.pre), word.slice(f.pre.length)));
  const el = h('div', { class: 'wb-tray' }, h('span', { class: 'caption' }, t('build.machine.verb')), inf, h('span', { class: 'wb-en' }, f.en), f.stress ? stressPattern(f.stress) : null);
  return { el, inf };
}

/** Play a form from the infinitive: the stem flies to its place and the prefix to the end. @param {HTMLElement} stage @param {any} f @param {string} form @param {HTMLElement} inf @param {any} t */
export function fromTray(stage, f, form, inf, t) {
  const r = inf.getBoundingClientRect();
  const half = new DOMRect(r.left + r.width * 0.55, r.top, r.width * 0.45, r.height);
  const from = new Map([['R', f.kind === 's' ? half : r], ['P', r]]);
  stage.querySelector('.wb-line')?.remove();
  swapLine(stage, f, form, t, { from });
}

/** The legend of the tile colours. @param {any} t */
export const tileLegend = t => h('div', { class: 'wb-legend', 'aria-hidden': 'true' },
  h('span', null, h('i', { class: 'wb-lg is-verb' }), t('build.machine.lgVerb')), h('span', null, h('i', { class: 'wb-lg is-aux' }), t('build.machine.lgAux')),
  h('span', null, h('i', { class: 'wb-lg is-slot' }), t('build.machine.lgSlot')), h('span', null, h('i', { class: 'wb-lg is-dot' }), t('build.machine.lgStress')));

/** @param {HTMLElement} el @param {import('../contract.js').ViewCtx} ctx @param {string | undefined} frameId */
export async function mountMachine(el, ctx, frameId) {
  const { t } = ctx;
  let alive = true;
  replace(el, h('div', { class: 'wb stack' }, backLink('#/practice/build', t('build.title')), h('div', { class: 'page-head' }, h('h1', null, t('build.sentences'))), h('p', { class: 'caption' }, t('build.loading'))));
  const d = await loadContent(ctx);
  if (!alive) return () => {};
  const st = { id: d.F.has(frameId) ? /** @type {string} */ (frameId) : d.c.frames[0].id, form: FORMS.includes(/** @type {any} */ (ctx.query.get('f'))) ? /** @type {string} */ (ctx.query.get('f')) : 'pres' };
  const live = h('p', { class: 'sr-only', 'aria-live': 'polite' });
  const body = h('div', { class: 'wb stack' });
  const views = h('nav', { class: 'wb-views', 'aria-label': t('build.view.label') },
    h('a', { class: 'pressable', href: '#/practice/build/machine', 'aria-current': 'page' }, t('build.view.machine')),
    h('a', { class: 'pressable', href: '#/practice/build/round?kind=sentences' }, t('build.view.turn')),
    h('a', { class: 'pressable', href: '#/practice/build/game' }, t('build.view.game')));
  replace(el, h('div', { class: 'wb stack' }, backLink('#/practice/build', t('build.title')), h('div', { class: 'page-head' }, h('h1', null, t('build.sentences'))), views, body, live));
  const url = () => history.replaceState(history.state, '', `#/practice/build/machine/${encodeURIComponent(st.id)}?f=${st.form}`);

  function draw() {
    const f = d.F.get(st.id);
    if (!f.forms[st.form]) st.form = 'pres';
    const label = (/** @type {any} */ x) => x.pair ? `${bare(x.inf)} (${x.en})` : bare(x.inf);
    const picks = h('div', { class: 'wb-chips', role: 'group', 'aria-label': t('build.machine.verbs') }, d.c.frames.map((/** @type {any} */ x) =>
      h('button', { type: 'button', class: 'chip pressable', lang: 'de', 'aria-pressed': String(x.id === f.id), onclick: () => { st.id = x.id; url(); draw(); } }, label(x))));
    const forms = h('div', { class: 'wb-chips is-wrap', role: 'group', 'aria-label': t('build.machine.forms') }, FORMS.filter(x => f.forms[x]).map(x =>
      h('button', { type: 'button', class: 'chip pressable', 'aria-pressed': String(x === st.form), onclick: (/** @type {Event} */ e) => {
        st.form = x; url();
        forms.querySelectorAll('.chip').forEach(c => c.setAttribute('aria-pressed', String(c === e.currentTarget)));
        swapLine(stage, f, x, t); rule.replaceWith(rule = ruleNode(f, x, t)); speak();
      } }, t(`build.form.${x}`))));
    const tr = tray(f, t);
    const stage = h('div', { class: 'wb-card wb-mstage' }, tr.el);
    let rule = ruleNode(f, st.form, t);
    const speak = () => { live.textContent = `${sentenceOf(f.forms[st.form], f.kind)} ${rule.textContent}`; };
    replace(body, picks, forms, stage, rule, f.note ? h('p', { class: 'caption' }, f.note) : null, tileLegend(t),
      h('div', { class: 'row-actions' }, h('button', { type: 'button', class: 'btn btn-quiet pressable', onclick: () => { fromTray(stage, f, st.form, tr.inf, t); speak(); } }, t('build.machine.replay'))));
    requestAnimationFrame(() => { if (alive) { fromTray(stage, f, st.form, tr.inf, t); speak(); } });
    picks.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  draw();
  return () => { alive = false; };
}
