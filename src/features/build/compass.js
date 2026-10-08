/* Prefixes: the compass (#/practice/build/prefixes[?root=<root>&pre=<p>]).
   A side view (you face right, up is up). The eight directions sit on the ring with opposites across: auf up / ab
   down, ein forward / aus back, vor forward diagonal / nach back diagonal, zu / an the other diagonals ("toward
   something"); his sketch put vor at the top, the owner chose this layout (auf up, vor on the forward diagonal).
   The dual prefixes are paths (stressed splits, unstressed stays); the inseparable ones are welded on and change how
   the verb works. Tap a prefix: the root's object travels the prefix's path in the pictogram while the prefix flies
   onto the root and joins it (joint or weld). Below: the prefix card (what it does, the mechanics on a real verb, its
   senses) and the verb card (predict the meaning, say whether it can be worked out, then the reveal).
   Keyboard: the ring is a group with a roving tab stop; arrow keys move around it by angle. */
import { h, replace, announce } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { scene, glyphFor } from './picto.js';
import { wordNode, joinFrom, weld, exampleNode } from './word.js';
import { gradeRow } from './grade4.js';
import { play, css, reduced, finishAll } from './fx.js';
import { loadContent, knowledge, verbsFor, saveAnswer, whenFor, logCalib, cardsOf, bare } from './data.js';
import { play as playAudio } from '../../services/audio.js';
import { langAttr, dirAttr } from '../../core/lang.js';

const W = 358, H = 330, CX = W / 2, CY = H / 2 - 4, RX = 142, RY = 128;
const GRADE_KEY = /** @type {Record<string, string>} */ ({ T: 'build.grade.T', M: 'build.grade.M', O: 'build.grade.O' });
const ORDER = /** @type {Record<string, number>} */ ({ known: 0, shaky: 1, unknown: 2, unseen: 3 });

export const backLink = (/** @type {string} */ href, /** @type {string} */ text) => h('a', { class: 'wb-back pressable', href }, icon('prev', { size: 16 }), text);

/** The view switch of the Prefixes screen (links, so each view has its own address). @param {any} t @param {'compass'|'drill'|'table'} cur */
export function viewSwitch(t, cur) {
  const items = /** @type {[string, string, string][]} */ ([['compass', '#/practice/build/prefixes', t('build.view.compass')], ['drill', '#/practice/build/round?kind=drill', t('build.view.drill')], ['table', '#/practice/build/table', t('build.view.table')]]);
  return h('nav', { class: 'wb-views', 'aria-label': t('build.view.label') }, items.map(([id, href, text]) => h('a', { class: 'pressable', href, 'aria-current': id === cur ? 'page' : null }, text)));
}

/** A grade mark for a chip: solid literal, hatched picture, outline word to learn, nothing for no verb. @param {string} g */
const gm = g => h('span', { class: `wb-gm is-${g}`, 'aria-hidden': 'true' });

/**
 * The compass stage and the prefix rows. plain: the drill (no marks, names give the prefix only).
 * @param {{d: any, t: any, root: string, plain?: boolean, onPick: (pre: string, btn: HTMLElement) => void}} o
 */
export function compassStage({ d, t, root, plain = false, onPick }) {
  const axis = d.c.prefixes.filter((/** @type {any} */ p) => p.ring === 'axis');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'wb-axes'); svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('aria-hidden', 'true');
  const e = document.createElementNS(svg.namespaceURI, 'ellipse');
  for (const [k, v] of Object.entries({ cx: CX, cy: CY, rx: RX - 30, ry: RY - 30 })) e.setAttribute(k, String(v));
  svg.append(e);
  for (const p of axis) {
    const a = p.pos * Math.PI / 180, l = document.createElementNS(svg.namespaceURI, 'line');
    for (const [k, v] of Object.entries({ x1: CX + Math.sin(a) * (RX - 60), y1: CY - Math.cos(a) * (RY - 60), x2: CX + Math.sin(a) * (RX - 26), y2: CY - Math.cos(a) * (RY - 26) })) l.setAttribute(k, String(v));
    svg.append(l);
  }
  const picto = /** @type {SVGSVGElement} */ (/** @type {unknown} */ (document.createElementNS(svg.namespaceURI, 'svg')));
  picto.setAttribute('class', 'wb-picto'); picto.setAttribute('role', 'img');
  const slot = h('div', { class: 'wb-wordslot' });
  /** @type {Map<string, HTMLButtonElement>} */ const chips = new Map();
  const gradeOf = (/** @type {string} */ pre) => { const v = verbsFor(d, root, pre)[0]; return v ? v.grade : 'none'; };
  const name = (/** @type {any} */ p) => {
    if (plain) return `${p.id}-`;
    const g = gradeOf(p.id);
    return `${p.id}-: ${p.short}. ${g === 'none' ? t('build.compass.noVerb', { root }) : t(GRADE_KEY[g])}`;
  };
  const chip = (/** @type {any} */ p, /** @type {string} */ cls) => {
    const g = plain ? 'none' : gradeOf(p.id);
    const b = /** @type {HTMLButtonElement} */ (h('button', { type: 'button', class: [cls, 'pressable', !plain && g === 'none' && 'is-none'], lang: langAttr(), dir: dirAttr(), 'data-p': p.id, 'aria-pressed': 'false', 'aria-label': name(p), tabindex: '-1',
      onclick: () => onPick(p.id, b) }, h('span', { class: 'wb-chip-t' }, p.id), plain ? null : gm(g)));
    chips.set(p.id, b);
    return b;
  };
  const ring = h('div', { class: 'wb-ring', role: 'group', 'aria-label': t('build.compass.ring') }, axis.map((/** @type {any} */ p) => {
    const b = chip(p, 'wb-pchip');
    const a = p.pos * Math.PI / 180;
    b.style.left = `${(CX + Math.sin(a) * RX) / W * 100}%`; b.style.top = `${(CY - Math.cos(a) * RY) / H * 100}%`;
    return b;
  }));
  const row = (/** @type {string} */ ringId, /** @type {string} */ label) => {
    const list = d.c.prefixes.filter((/** @type {any} */ p) => p.ring === ringId);
    const id = `wb-row-${ringId}`;
    return h('div', { class: 'wb-lrow' }, h('span', { class: 'caption', id }, label), h('div', { class: 'wb-lchips', role: 'group', 'aria-labelledby': id }, list.map((/** @type {any} */ p) => chip(p, 'wb-lchip'))));
  };
  const rows = h('div', { class: 'wb-rows' }, row('path', t('build.compass.paths')), row('lens', t('build.compass.lenses')), row('extra', t('build.compass.extra')));
  const stage = h('div', { class: 'wb-stage wb-card' }, svg, ring, h('div', { class: 'wb-core' }, picto, slot));
  // roving tab stops: one per group; arrows move by angle on the ring, along the row elsewhere
  for (const grp of [ring, ...rows.querySelectorAll('.wb-lchips')]) {
    const bs = /** @type {HTMLButtonElement[]} */ ([...grp.querySelectorAll('button')]);
    if (bs[0]) bs[0].tabIndex = 0;
    grp.addEventListener('keydown', (/** @type {KeyboardEvent} */ ev) => {
      const k = bs.indexOf(/** @type {HTMLButtonElement} */ (document.activeElement));
      if (k < 0) return;
      const step = ev.key === 'ArrowRight' || ev.key === 'ArrowDown' ? 1 : ev.key === 'ArrowLeft' || ev.key === 'ArrowUp' ? -1 : 0;
      if (!step) return;
      ev.preventDefault();
      const n = bs[(k + step + bs.length) % bs.length];
      bs.forEach(b => { b.tabIndex = b === n ? 0 : -1; });
      n.focus();
    });
  }
  return {
    stage, rows, chips, picto, slot,
    /** Mark the chosen chip. @param {string | null} pre */
    press(pre) { for (const [id, b] of chips) b.setAttribute('aria-pressed', String(id === pre)); },
  };
}

/** The mechanics of a prefix shown on a real verb (authored forms only). @param {any} d @param {any} p @param {string} root @param {any} t */
export function mechLine(d, p, root, t) {
  if (p.kind === 'd') return h('p', { class: 'wb-mech' }, h('b', null, t('build.mech.dualSep')), ' ', p.sep, '.', h('br'), h('b', null, t('build.mech.dualInsep')), ' ', p.insep, '.');
  const v = verbsFor(d, root, p.id)[0] || d.c.verbs.find((/** @type {any} */ x) => x.pre === p.id && x.kind === p.kind);
  if (!v) return h('p', { class: 'wb-mech' }, t(p.kind === 's' ? 'build.mech.sepPlain' : 'build.mech.insepPlain'));
  const r = d.R.get(v.root);
  if (p.kind === 's') return h('p', { class: 'wb-mech' }, h('b', null, t('build.mech.sep')), ' ', h('span', { lang: langAttr(), dir: dirAttr() }, `er ${r.pres3} … `, h('b', null, p.id)), '. ',
    h('b', null, t('build.mech.geIn')), ' ', h('span', { lang: langAttr(), dir: dirAttr() }, v.pp), '.');
  return h('p', { class: 'wb-mech' }, h('b', null, t('build.mech.insep')), ' ', h('span', { lang: langAttr(), dir: dirAttr() }, `er ${p.id}${r.pres3}`), '. ', h('b', null, t('build.mech.noGe')), ' ', h('span', { lang: langAttr(), dir: dirAttr() }, v.pp), '.');
}

/** The prefix card. @param {any} d @param {any} p @param {string} root @param {any} t */
export function prefixCard(d, p, root, t) {
  const tag = t(p.kind === 's' ? 'build.kind.s' : p.kind === 'i' ? 'build.kind.i' : 'build.kind.d');
  return h('div', { class: 'wb-card wb-pcard' },
    h('div', { class: 'wb-ptitle' }, h('span', { class: 'wb-pname', lang: langAttr(), dir: dirAttr() }, `${p.id}-`), h('span', { class: 'wb-tag' }, tag)),
    h('p', { class: 'wb-core-line' }, p.core),
    mechLine(d, p, root, t),
    p.senses.length ? h('ul', { class: 'wb-senses' }, p.senses.map((/** @type {any} */ s) => h('li', null, h('span', null, s.en), h('span', { lang: langAttr(), dir: dirAttr() }, s.ex.join(', '))))) : null,
    p.opp && p.opp.length ? h('p', { class: 'caption' }, t('build.opposites'), ' ', p.opp.map((/** @type {any} */ [o, x], /** @type {number} */ i) => [i ? ' · ' : '', h('span', { lang: langAttr(), dir: dirAttr() }, `${o}-`), ` (${x})`])) : null,
    p.word ? h('p', { class: 'caption' }, p.word) : null);
}

/**
 * The verb card's reveal: the meaning, the derivability ladder (his guess slides to the truth), the "how" line, the
 * example with the split-off particle underlined, the participle. Shared by the compass and the PD round card.
 * @param {{d: any, v: any, guess: string | null, t: any, ctx: any}} o
 */
export function verbReveal({ d, v, guess, t, ctx }) {
  const idx = /** @type {Record<string, number>} */ ({ T: 0, M: 1, O: 2 });
  const pin = h('i', { class: 'wb-pin', 'aria-hidden': 'true' });
  const lad = h('div', { class: 'wb-ladder', role: 'img', 'aria-label': t('build.reveal.ladder', { grade: t(GRADE_KEY[v.grade]) }) },
    ['T', 'M', 'O'].map(g => h('span', { class: g === v.grade ? 'is-on' : null }, t(GRADE_KEY[g]))), pin);
  const at = (/** @type {string} */ g) => `calc(${(idx[g] * 100) / 3}% + ${100 / 6}% - 1px)`;
  pin.style.left = at(guess || v.grade);
  if (guess && guess !== v.grade) requestAnimationFrame(() => requestAnimationFrame(() => { pin.style.left = at(v.grade); }));
  let cal = '';
  if (guess) cal = guess === v.grade ? t('build.reveal.calRight') : v.grade === 'O' ? t('build.reveal.calWord') : guess === 'O' ? t('build.reveal.calCould') : guess === 'T' ? t('build.reveal.calStep') : t('build.reveal.calCloser');
  const r = d.R.get(v.root);
  const dual = !!v.dual;
  const say = dual ? null : h('button', { type: 'button', class: 'wb-play pressable', 'aria-label': t('build.play'), onclick: () => playAudio(ctx.content, v.ex, ctx.store) }, icon('play', { size: 16 }));
  return h('div', { class: 'wb-reveal' },
    h('p', { class: 'wb-meaning' }, v.en),
    lad,
    cal ? h('p', { class: 'wb-calnote' }, cal) : null,
    h('p', { class: 'wb-how' }, h('b', null, `${t(`build.how.${v.how}`)}: `), v.why),
    h('div', { class: 'wb-exrow' }, say, exampleNode(v)),
    h('p', { class: 'caption' }, v.exEn, ' · ', h('span', { lang: langAttr(), dir: dirAttr() }, `${v.aux.replace('/', ' / ')} ${v.pp}`), r ? null : null),
    dual ? h('p', { class: 'caption wb-noaudio' }, t('build.reveal.noAudio')) : null);
}

/** @param {HTMLElement} el @param {import('../contract.js').ViewCtx} ctx */
export async function mountCompass(el, ctx) {
  const { t } = ctx;
  let alive = true;
  replace(el, h('div', { class: 'wb stack' }, backLink('#/practice/build', t('build.title')), h('div', { class: 'page-head' }, h('h1', null, t('build.prefixes'))), h('p', { class: 'caption' }, t('build.loading'))));
  const [d, k] = await Promise.all([loadContent(ctx), knowledge(ctx).catch(() => null)]);
  if (!alive) return () => {};
  const rootState = (/** @type {any} */ r) => (k ? k.get(`W:${r.lemma}`).state : 'unseen');
  const roots = [...d.c.roots].sort((a, b) => ORDER[rootState(a)] - ORDER[rootState(b)] || d.c.roots.indexOf(a) - d.c.roots.indexOf(b));
  const q = ctx.query;
  const st = { root: d.R.has(q.get('root')) ? /** @type {string} */ (q.get('root')) : roots[0].id, pre: d.P.has(q.get('pre')) ? /** @type {string | null} */ (q.get('pre')) : null, alt: /** @type {string | null} */ (q.get('v')) };
  const panel = h('div', { class: 'wb-panel', 'aria-live': 'polite' });
  const rootRow = h('div', { class: 'wb-roots', role: 'group', 'aria-label': t('build.compass.roots') });
  let cs = /** @type {ReturnType<typeof compassStage> | null} */ (null);
  let sc = /** @type {any} */ (null);
  const holder = h('div', { class: 'wb-compass' });
  const view = h('div', { class: 'wb stack' },
    backLink('#/practice/build', t('build.title')),
    h('div', { class: 'page-head' }, h('h1', null, t('build.prefixes'))),
    viewSwitch(t, 'compass'),
    h('div', { class: 'wb-field' }, h('p', { class: 'label' }, t('build.compass.roots')), rootRow),
    holder, panel);
  replace(el, view);

  const url = () => { const p = new URLSearchParams({ root: st.root }); if (st.pre) p.set('pre', st.pre); if (st.alt) p.set('v', st.alt); history.replaceState(history.state, '', `#/practice/build/prefixes?${p}`); };
  const kindOf = (/** @type {string} */ pre) => { const vs = verbsFor(d, st.root, pre); const v = vs.find((/** @type {any} */ x) => x.id === st.alt) || vs[0]; const p = d.P.get(pre); return v ? v.kind : p.kind === 'd' ? 's' : p.kind; };

  function drawRoots() {
    replace(rootRow, roots.map(r => h('button', { type: 'button', class: 'chip pressable', lang: langAttr(), dir: dirAttr(), 'aria-pressed': String(r.id === st.root),
      onclick: () => { st.root = r.id; st.pre = null; st.alt = null; drawRoots(); drawAll(); url(); } },
      h('span', { class: `wb-sq is-${rootState(r)}`, 'aria-hidden': 'true' }), r.id, h('span', { class: 'sr-only' }, ` (${t(`build.state.${rootState(r)}`)})`))));
  }
  function drawAll() {
    finishAll();
    cs = compassStage({ d, t, root: st.root, onPick: (pre, btn) => pick(pre, btn) });
    replace(holder, cs.stage, cs.rows);
    cs.press(st.pre);
    if (st.pre) {
      const kind = kindOf(st.pre);
      const w = wordNode({ pre: st.pre, stem: st.root, kind, t, big: true });
      replace(cs.slot, w);
      sc = scene(cs.picto, glyphFor(d.P.get(st.pre), kind), d.R.get(st.root).obj, { label: d.P.get(st.pre).alt });
      sc.final();
    } else {
      replace(cs.slot, wordNode({ stem: st.root, t, big: true }));
      sc = scene(cs.picto, 'none', d.R.get(st.root).obj, { label: d.R.get(st.root).en });
    }
    drawPanel();
  }
  async function pick(/** @type {string} */ pre, /** @type {HTMLElement} */ btn) {
    if (!cs) return;
    finishAll();
    st.pre = pre; st.alt = null; url();
    cs.press(pre);
    const kind = kindOf(pre);
    const p = d.P.get(pre);
    sc = scene(cs.picto, glyphFor(p, kind), d.R.get(st.root).obj, { label: p.alt });
    const w = wordNode({ pre, stem: st.root, kind, t, big: true });
    replace(cs.slot, w);
    drawPanel();
    announce(p.alt);
    // one moment: the path plays while the chip flies; the flight ends after the path's midpoint
    sc.play();
    await joinFrom(btn, w);
  }
  function drawPanel() {
    const r = d.R.get(st.root);
    if (!st.pre) {
      replace(panel, h('div', { class: 'wb-card wb-pcard' },
        h('div', { class: 'wb-ptitle' }, h('span', { class: 'wb-pname', lang: langAttr(), dir: dirAttr() }, r.id), h('span', { class: 'wb-tag' }, t('build.root'))),
        h('p', { class: 'wb-core-line' }, r.en), h('p', { class: 'caption', lang: langAttr(), dir: dirAttr() }, `${r.pres3} · ${r.pret} · ${r.aux.replace('/', ' / ')} ${r.pp}`),
        h('p', { class: 'caption' }, t('build.compass.tap')),
        legend(t)));
      return;
    }
    const p = d.P.get(st.pre);
    const all = verbsFor(d, st.root, st.pre);
    const v = all.find((/** @type {any} */ x) => x.id === st.alt) || all[0];
    replace(panel, prefixCard(d, p, st.root, t), v ? verbCard(v, all) : h('div', { class: 'wb-card' }, h('p', { class: 'wb-empty' }, t('build.compass.none', { word: `${p.id}${st.root}` }))));
  }
  function verbCard(/** @type {any} */ v, /** @type {any[]} */ all) {
    const p = d.P.get(v.pre), r = d.R.get(v.root);
    const card = h('div', { class: 'wb-card wb-vcard' });
    const sw = all.length > 1 ? h('div', { class: 'seg wb-readings', role: 'group', 'aria-label': t('build.reading') }, all.map(x => h('button', { type: 'button', class: 'pressable', 'aria-pressed': String(x === v),
      onclick: () => { st.alt = x.id; url(); drawPanel(); if (cs) { cs.press(x.pre); sc = scene(cs.picto, glyphFor(p, x.kind), r.obj, { label: p.alt }); sc.play(); const w = wordNode({ pre: x.pre, stem: st.root, kind: x.kind, t, big: true }); replace(cs.slot, w); joinFrom(cs.chips.get(x.pre) || null, w); } } },
      t(x.kind === 's' ? 'build.reading.s' : 'build.reading.i')))) : null;
    let guess = /** @type {string | null} */ (null);
    const chips = h('div', { class: 'wb-guess', role: 'group', 'aria-label': t('build.predict.can') }, [['T', 'build.predict.yes'], ['M', 'build.predict.partly'], ['O', 'build.predict.no']].map(([g, key]) => {
      const b = h('button', { type: 'button', class: 'chip pressable', 'aria-pressed': 'false', onclick: () => { guess = g; chips.querySelectorAll('button').forEach(c => c.setAttribute('aria-pressed', String(c === b))); } }, t(key));
      return b;
    }));
    const show = h('button', { type: 'button', class: 'btn btn-primary pressable', onclick: () => reveal() }, t('build.predict.show'));
    const pre = h('div', { class: 'wb-calib' }, h('p', { class: 'label' }, t('build.predict.ask')), chips, h('div', { class: 'row-actions' }, show));
    card.append(...[sw, h('p', { class: 'wb-vq', lang: langAttr(), dir: dirAttr() }, `${v.inf}?`),
      h('p', { class: 'wb-vsum' }, h('span', { lang: langAttr(), dir: dirAttr() }, `${v.pre}-`), ` ${p.short}  +  `, h('span', { lang: langAttr(), dir: dirAttr() }, r.id), ` ${r.en}`), pre].filter(Boolean));
    function reveal() {
      pre.remove();
      const id = `PD:${v.id}`;
      const rec = cardsOf(ctx.store)[id] || null;
      if (guess) logCalib(ctx.store, { id, guess, truth: v.grade, day: ctx.clock.ctx().today });
      const out = h('p', { class: 'caption wb-saved', 'aria-live': 'polite' });
      const row = gradeRow({ t, label: t('build.grade.know'), when: whenFor(ctx, rec, t), onGrade: g => {
        const res = saveAnswer(ctx, { id, g, mode: 's' });
        const when = res.rec ? whenFor(ctx, res.before, t)[g - 1] : '';
        out.textContent = t('build.saved', { when });
      } });
      card.append(verbReveal({ d, v, guess, t, ctx }), row.el, out);
      row.focus();
    }
    return card;
  }
  drawRoots();
  drawAll();
  if (st.pre && cs) { const b = cs.chips.get(st.pre); if (b) b.tabIndex = 0; }
  return () => { alive = false; finishAll(); if (sc) sc.stop(); };
}

/** The mark legend under the root card. @param {any} t */
export function legend(t) {
  return h('div', { class: 'wb-legend', 'aria-hidden': 'true' },
    h('span', null, h('i', { class: 'wb-gm is-T' }), t('build.grade.T')), h('span', null, h('i', { class: 'wb-gm is-M' }), t('build.grade.M')),
    h('span', null, h('i', { class: 'wb-gm is-O' }), t('build.grade.O')), h('span', null, h('i', { class: 'wb-gm is-none' }), t('build.grade.none')));
}

export { bare, weld, play, css, reduced };
