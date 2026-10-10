/* Sprechen (#/practice/speak, UX §4.9): speaking situations (sim-view.js), the Teil 2 talk and the mic check. The
   talk is ported from Igloo's b1more.js. Say it aloud (a mic-graded round of the B1 Sprechen phrases) folded into the
   situations as "Check with the mic" (journey #10): its old routes, #/practice/speak/aloud and …/aloud/go, open the
   situations, and the mic check keeps its route, #/practice/speak/aloud/check. No card id changed: the B1 phrase
   cards stay in the typed rounds.
   Every microphone and recogniser call goes through services/speech.js, so the iOS app can swap the implementation. */
import { h, replace, announce } from '../../core/dom.js';
import { linkRow, notice, backLink } from '../../core/ui.js';
import { icon } from '../../core/icons.js';
import { fill, reduced } from '../../core/motion.js';
import * as Sp from '../../domain/speech.js';
import { loadData, session } from '../shared/data.js';
import { speech } from '../../services/speech.js';
import { asrLocale, dirAttr } from '../../core/lang.js';
import { simToday } from '../../domain/allowance.js';
import { langAttr } from '../../core/lang.js';
import { NOISE, trust } from '../../domain/hearing.js';
import { meter, logAttempt } from './mic.js';

const FOLIEN = /** @type {[string, string[]][]} */ ([['Thema vorstellen', ['t2_open']], ['Eigene Erfahrung', ['t2_experience']], ['In meinem Heimatland', ['t2_home']],
  ['Vor- und Nachteile, Meinung', ['t2_proscons', 't2_conclude']], ['Abschluss', ['t2_close']]]);
const ENDS = [20, 60, 100, 160, 180];   // run 1, seconds: Folie k ends at ENDS[k]
const RUNS = [180, 135, 90];
const mmss = (/** @type {number} */ s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** @param {any} store @param {(s: any) => any} fn */
const updSession = (store, fn) => store.update('b1.session', (/** @type {any} */ s) => fn(s || {}), {});

/** The microphone button, its level meter, its line and the loud-room line. @param {() => void} onTap @param {(k: string, v?: any) => string} t */
function micButton(onTap, t) {
  const lab = h('p', { class: 'caption pr-mic-l', 'aria-live': 'polite' }, t('practice.speak.tap'));
  const btn = h('button', { type: 'button', class: 'pr-mic pressable', 'aria-label': t('practice.speak.mic'), onclick: onTap }, icon('mic', { size: 30 }));
  const level = meter();
  const loud = h('p', { class: 'caption pr-loud', hidden: true }, t('practice.speak.check.loud'));
  const el = h('div', { class: 'pr-micbox' }, btn, level.el, lab, loud);
  return { el, btn, level, set(/** @type {string} */ state, /** @type {string} */ text) { btn.dataset.state = state; btn.setAttribute('aria-pressed', String(state === 'listening')); lab.textContent = text; level.show(state === 'listening'); },
    loud(/** @type {any} */ a) { loud.hidden = !(a && a.noisy); } };
}

/** @param {string | null} err @param {(k: string) => string} t */
function errorText(err, t) {
  if (err === 'not-allowed' || err === 'service-not-allowed') return t('practice.speak.err.blocked');
  if (err === 'network') return t('practice.speak.err.network');
  if (err === 'no-speech' || err === 'aborted' || !err) return t('practice.speak.err.none');
  return t('practice.speak.err.other');
}

const back = (/** @type {string} */ href, /** @type {string} */ text) => backLink({ href, label: text });

/** @param {HTMLElement} el @param {import('../contract.js').ViewCtx} ctx @param {string[]} parts rest after 'speak' */
export async function mountSpeak(el, ctx, parts) {
  const { t } = ctx;
  const sp = speech();
  const [what, sub] = parts;
  /** @type {(() => void)[]} */ const offs = [];
  const cleanup = () => { offs.forEach(f => f()); sp.cancel(); document.body.dataset.chrome = 'on'; };
  if (what === 'aloud' && sub === 'check') { await drawCheck(); return cleanup; }
  if (what === 'aloud') { ctx.go('/practice/situations', { replace: true }); return cleanup; }   // Say it aloud's old link
  if (what === 'teil2') { await drawTeil2(); return cleanup; }
  // the list
  const cal = session(ctx.store).cal;
  const simDetail = () => {
    const x = simToday({ store: ctx.store, c: ctx.clock.ctx(), settings: ctx.settings() });
    return x.due && x.newLeft ? t('practice.sim.detail', { due: x.due, fresh: x.newLeft }) : x.due ? t('practice.sim.detailDue', { n: x.due })
      : x.newLeft ? t('practice.sim.detailFresh', { n: x.newLeft }) : t('practice.sim.rowIdle');
  };
  replace(el, h('div', { class: 'practice stack' },
    back('#/practice', t('practice.title')),
    h('div', { class: 'page-head' }, h('h1', null, t('practice.speak.title'))),
    h('nav', { class: 'pr-rows' },
      linkRow({ href: '#/practice/situations', title: t('practice.sim'), detail: simDetail() }),
      linkRow({ href: '#/practice/round?kind=area:speaking', title: t('practice.area.speaking'), detail: t('practice.speak.phrases.detail') }),
      linkRow({ href: '#/practice/speak/teil2', title: t('practice.speak.teil2'), detail: t('practice.speak.teil2.detail') }),
      sp.canListen() ? linkRow({ href: '#/practice/speak/aloud/check', title: t('practice.speak.check'), detail: cal ? t('practice.speak.check.done') : t('practice.speak.check.never') }) : null),
    sp.canListen() ? null : notice({ children: [h('p', null, t('practice.speak.noRecogniser'))] })));
  return cleanup;

  // ---------- the mic check (calibrates Check with the mic in the situations) ----------
  async function drawCheck() {
    if (!sp.canListen()) {
      replace(el, h('div', { class: 'practice stack' }, back('#/practice/speak', t('practice.speak.title')), h('div', { class: 'page-head' }, h('h1', null, t('practice.speak.check'))),
        h('p', null, t('practice.speak.safari')), h('p', { class: 'caption' }, t('practice.speak.typedInstead')),
        h('a', { class: 'btn pressable', href: '#/practice/situations' }, t('practice.speak.check.toSituations'))));
      return;
    }
    micCheck();
  }

  function micCheck() {
    const C = Sp.CANARY, results = /** @type {{i: number, said: string}[]} */ ([]);
    let i = 0; /** @type {any} */ let live = null;
    const meta = h('p', { class: 'caption tnum' }), sent = h('p', { class: 'prompt', lang: langAttr(), dir: dirAttr() }), heard = h('p', { class: 'pr-heard', lang: langAttr(), dir: dirAttr() });
    const mic = micButton(() => tap(), t);
    // the phone wasn't sure what it heard: read it again, or keep it (a guess would set the calibration wrong)
    const unsure = h('div', { class: 'pr-unsure', hidden: true });
    replace(el, h('div', { class: 'practice stack pr-speak' }, back('#/practice/speak', t('practice.speak.title')),
      h('div', { class: 'page-head' }, h('h1', null, t('practice.speak.check'))), h('p', { class: 'caption' }, t('practice.speak.check.how')),
      h('div', { class: 'card pr-card' }, meta, sent, heard, unsure), mic.el));
    const show = () => { meta.textContent = t('practice.count', { n: i + 1, total: C.length }); sent.textContent = C[i].de; heard.textContent = ''; unsure.hidden = true; mic.set('idle', t('practice.speak.tapRead')); };
    const keep = (/** @type {string} */ said) => { results.push({ i, said }); if (++i < C.length) show(); else finish(); };
    async function tap() {
      if (live) { live.stop(); return; }
      unsure.hidden = true;
      mic.set('listening', t('practice.speak.listening'));
      live = sp.listen({ lang: asrLocale(), check: true, onLevel: (/** @type {number} */ x) => mic.level.set(x),
        onInterim: (/** @type {string} */ x) => { heard.textContent = x; },
        onPhase: (/** @type {string} */ p, /** @type {any} */ a) => { mic.set('listening', p === 'checking' ? t('practice.speak.checkingRoom') : t('practice.speak.listening')); if (p === 'listening') mic.loud(a); } });
      const res = await live.done; live = null;
      mic.loud(res.ambient || sp.noise());
      if (res.error && !res.text) { mic.set(sp.blocked() ? 'error' : 'idle', errorText(res.error, t)); return; }
      // the mic check measures what the phone writes down, so its best guess counts, never a better alternative
      const tr = trust({ text: res.text, confidence: res.confidence, expected: C[i].de, ambient: res.ambient, restarts: res.restarts });
      logAttempt(ctx.store, { where: 'check', heard: res, unsure: tr.unsure, why: tr.why });
      if (!tr.unsure) { keep(res.text); return; }
      mic.set('idle', '');
      replace(unsure, h('p', { class: 'caption' }, t('practice.speak.check.unsure')), h('div', { class: 'pr-micopts' },
        h('button', { type: 'button', class: 'btn pressable', onclick: () => tap() }, t('practice.speak.tryAgain')),
        h('button', { type: 'button', class: 'btn btn-quiet pressable', onclick: () => keep(res.text) }, t('practice.speak.keep'))));
      unsure.hidden = false;
    }
    function finish() {
      const out = Sp.calibrate(results);
      updSession(ctx.store, s => ({ ...s, cal: { asr: Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.checked])), at: Date.now(), detail: results } }));
      const row = (/** @type {string} */ name, /** @type {string} */ k) => h('tr', null, h('td', null, name), h('td', { class: 'tnum' }, t('practice.speak.kept', { n: out[k].kept, total: out[k].n })), h('td', null, out[k].checked ? t('practice.speak.checked') : t('practice.speak.notChecked')));
      const fixed = ['verbFinal', 'fuerVor'].filter(k => !out[k].checked);
      replace(el, h('div', { class: 'practice stack' }, back('#/practice/speak', t('practice.speak.title')),
        h('div', { class: 'page-head' }, h('h1', null, t('practice.speak.check.doneTitle'))),
        h('table', { class: 'pr-checks' }, h('tbody', null, row(t('practice.speak.c.verbFinal'), 'verbFinal'), row(t('practice.speak.c.fuerVor'), 'fuerVor'), row(t('practice.speak.c.articles'), 'articles'), row(t('practice.speak.c.endings'), 'endings'))),
        h('p', { class: 'caption' }, fixed.length ? t('practice.speak.check.fixed') : t('practice.speak.check.never2')),
        h('div', { class: 'pr-done-actions' }, h('a', { class: 'btn btn-primary pressable', href: '#/practice/situations' }, t('practice.speak.check.toSituations')))));
    }
    show();
    offs.push(() => live?.stop());
  }

  // ---------- Teil 2 talk ----------
  async function drawTeil2() {
    const data = await loadData(ctx);
    const topics = data.plan.scenarios?.teil2 || ['Homeoffice'];
    let topic = topics.includes(session(ctx.store).teil2?.topic) ? session(ctx.store).teil2.topic : topics[0];
    const cues = FOLIEN.map(([, fns]) => data.pool.filter((/** @type {any} */ it) => it.kind === 'phrase' && it.group === 'S2' && fns.includes(it.fn) && it.star).slice(0, 2).map((/** @type {any} */ it) => it.model));
    let run = 0, loudRun = false; /** @type {string | null} */ let audioUrl = null;
    /** @type {{secs: number, nw: number, sps: number | null}[]} */ const runs = [];
    offs.push(() => { if (audioUrl) URL.revokeObjectURL(audioUrl); });
    intro();
    function intro() {
      const tEl = h('b', { lang: langAttr(), dir: dirAttr() }, topic);
      replace(el, h('div', { class: 'practice stack' }, back('#/practice/speak', t('practice.speak.title')),
        h('div', { class: 'page-head' }, h('h1', null, t('practice.speak.teil2'))),
        h('p', { class: 'lead' }, t('practice.speak.teil2.lead')),
        h('p', { class: 'pr-topic' }, h('span', { class: 'label' }, t('practice.speak.topic')), ' ', tEl, ' ',
          h('button', { type: 'button', class: 'btn btn-quiet pressable', onclick: () => { topic = topics[(topics.indexOf(topic) + 1) % topics.length]; updSession(ctx.store, s => ({ ...s, teil2: { topic } })); tEl.textContent = topic; } }, t('practice.speak.change'))),
        h('ol', { class: 'pr-folien' }, FOLIEN.map(([name], k) => h('li', null, h('span', { class: 'row-title', lang: langAttr(), dir: dirAttr() }, name), h('span', { class: 'caption tnum' }, ` ${t('practice.speak.until', { t: mmss(ENDS[k]) })}`),
          cues[k].length ? h('span', { class: 'caption pr-cue', lang: langAttr(), dir: dirAttr() }, cues[k].join(' · ')) : null))),
        sp.canListen() ? null : h('p', { class: 'caption' }, t('practice.speak.noRate')),
        h('div', { class: 'pr-done-actions' }, h('button', { type: 'button', class: 'btn btn-primary pressable', onclick: () => start() }, t('practice.speak.start', { t: mmss(RUNS[run]) })))));
    }
    async function start() {
      const total = RUNS[run], scale = total / 180;
      document.body.dataset.chrome = 'off';   // a timed talk is full screen, like a round
      if (audioUrl) { URL.revokeObjectURL(audioUrl); audioUrl = null; }
      /** @type {any} */ let rec = null;
      const level = meter();
      if (sp.canRecord()) { try { rec = await sp.record({ onLevel: (/** @type {number} */ x) => level.set(x) }); } catch { rec = null; } }
      level.show(!!rec);
      let words = '', heardMs = 0, stopped = false; /** @type {any} */ let live = null;
      const t0 = performance.now();
      if (sp.canListen()) {
        const go = () => { if (stopped) return; const s0 = performance.now(); live = sp.listen({ lang: asrLocale(), continuous: true });
          live.done.then((/** @type {any} */ r) => { if (r.text) { words += ` ${r.text}`; heardMs += performance.now() - s0; } go(); }); };
        go();
      }
      const clock = h('p', { class: 'numeral tnum pr-clock' }), folie = h('p', { class: 'pr-folie', lang: langAttr(), dir: dirAttr() }), cue = h('p', { class: 'caption', lang: langAttr(), dir: dirAttr() });
      const prog = h('div', { class: 'track pr-runbar' }, h('span', { class: 'fill' }));
      replace(el, h('div', { class: 'practice stack pr-run' }, h('h1', { class: 'label' }, t('practice.speak.run', { n: run + 1, topic, t: mmss(total) })), clock, folie, cue, prog, level.el,
        h('div', { class: 'pr-done-actions' }, h('button', { type: 'button', class: 'btn btn-primary pressable', onclick: () => end() }, t('practice.speak.stop')))));
      fill(prog, 0);
      let lastK = -1;
      const tick = () => {
        const s = (performance.now() - t0) / 1000, left = Math.max(0, total - s);
        const kf = ENDS.findIndex(e => s < e * scale), k = kf < 0 ? 4 : kf;
        clock.textContent = mmss(Math.ceil(left));
        if (k !== lastK) { lastK = k; folie.textContent = `Folie ${k + 1} · ${FOLIEN[k][0]}`; cue.textContent = cues[k].join(' · '); announce(folie.textContent); }
        fill(prog, Math.min(1, s / total));
        if (left <= 0) end();
      };
      const iv = setInterval(tick, reduced() ? 1000 : 250); tick();
      offs.push(() => { clearInterval(iv); stopped = true; live?.stop(); rec?.stop(); });
      async function end() {
        if (stopped) return;
        clearInterval(iv); stopped = true;
        const secs = Math.min(total, (performance.now() - t0) / 1000);
        if (live) { live.stop(); await Promise.race([live.done, new Promise(r => setTimeout(r, 1500))]); }
        const floorDb = rec ? rec.floor() : null;
        const blob = rec ? await rec.stop() : null;
        if (blob) audioUrl = URL.createObjectURL(blob);
        const text = words.trim(), nw = text ? text.split(/\s+/).length : 0, syl = Sp.syllables(text);
        // a loud run: the phone missed words, so a rate would read low; none is shown
        loudRun = floorDb != null && floorDb >= NOISE.loudDb;
        const full = sp.canListen() && heardMs / 1000 >= 0.8 * secs && nw > 0 && !loudRun;
        runs[run] = { secs, nw, sps: full ? syl / secs : null };
        after(full);
      }
    }
    function after(/** @type {boolean} */ full) {
      document.body.dataset.chrome = 'on';
      const r = runs[run];
      const nextRun = run + 1 < RUNS.length;
      replace(el, h('div', { class: 'practice stack' }, back('#/practice/speak', t('practice.speak.title')),
        h('div', { class: 'page-head' }, h('h1', null, t('practice.speak.runDone', { n: run + 1, t: mmss(r.secs) }))),
        full && r.sps ? h('p', { class: 'lead' }, t('practice.speak.rate', { words: r.nw, sps: r.sps.toFixed(1) })) : null,
        full ? h('p', { class: 'caption' }, t('practice.speak.rateRef')) : h('p', { class: 'caption' }, loudRun ? t('practice.speak.rateNoisy') : sp.canListen() ? t('practice.speak.rateNeeds') : t('practice.speak.timeOnly')),
        audioUrl ? h('audio', { controls: true, src: audioUrl, class: 'pr-audio' }) : h('p', { class: 'caption' }, t('practice.speak.noRecording')),
        runs.length > 1 ? h('ul', { class: 'list' }, runs.map((x, i) => h('li', { class: 'list-item tnum' }, t('practice.speak.runLine', { n: i + 1, t: mmss(x.secs) }), x.sps ? h('span', { class: 'caption' }, t('practice.speak.sps', { sps: x.sps.toFixed(1) })) : null))) : null,
        h('div', { class: 'pr-done-actions' },
          nextRun ? h('button', { type: 'button', class: 'btn btn-primary pressable', onclick: () => { run++; start(); } }, t('practice.speak.nextRun', { t: mmss(RUNS[run + 1]) })) : h('a', { class: 'btn btn-primary pressable', href: '#/practice' }, t('practice.done')),
          h('button', { type: 'button', class: 'btn pressable', onclick: () => start() }, t('practice.speak.again')))));
      /** @type {HTMLElement | null} */ (el.querySelector('h1'))?.focus({ preventScroll: true });
    }
  }
}
