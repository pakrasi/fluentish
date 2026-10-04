/* Speak (#/practice/speak, UX §4.9): the Teil 2 talk, Say it aloud and the mic check. Ported from Igloo's b1more.js.
   Every microphone, recogniser and voice call goes through speech.js, so the iOS app can swap the implementation. */
import { h, replace, announce } from '../../core/dom.js';
import { linkRow, notice } from '../../core/ui.js';
import { icon } from '../../core/icons.js';
import { correct as fxCorrect, wrong as fxWrong, fill, reduced } from '../../core/motion.js';
import * as Sp from '../../domain/speech.js';
import * as T from '../../domain/timer.js';
import * as S from './session.js';
import { gradeAnswer } from './grade.js';
import { loadData, session, saveAnswer, forecaster, tz } from './data.js';
import { speech } from './speech.js';

const FOLIEN = /** @type {[string, string[]][]} */ ([['Thema vorstellen', ['t2_open']], ['Eigene Erfahrung', ['t2_experience']], ['In meinem Heimatland', ['t2_home']],
  ['Vor- und Nachteile, Meinung', ['t2_proscons', 't2_conclude']], ['Abschluss', ['t2_close']]]);
const ENDS = [20, 60, 100, 160, 180];   // run 1, seconds: Folie k ends at ENDS[k]
const RUNS = [180, 135, 90];
const mmss = (/** @type {number} */ s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const norm = (/** @type {string} */ s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** @param {any} store @param {(s: any) => any} fn */
const updSession = (store, fn) => store.update('b1.session', (/** @type {any} */ s) => fn(s || {}), {});

/** The microphone button and its line. @param {() => void} onTap @param {(k: string, v?: any) => string} t */
function micButton(onTap, t) {
  const lab = h('p', { class: 'caption pr-mic-l', 'aria-live': 'polite' }, t('practice.speak.tap'));
  const btn = h('button', { type: 'button', class: 'pr-mic pressable', 'aria-label': t('practice.speak.mic'), onclick: onTap }, icon('mic', { size: 30 }));
  const el = h('div', { class: 'pr-micbox' }, btn, lab);
  return { el, btn, set(/** @type {string} */ state, /** @type {string} */ text) { btn.dataset.state = state; btn.setAttribute('aria-pressed', String(state === 'listening')); lab.textContent = text; } };
}

/** @param {string | null} err @param {(k: string) => string} t */
function errorText(err, t) {
  if (err === 'not-allowed' || err === 'service-not-allowed') return t('practice.speak.err.blocked');
  if (err === 'network') return t('practice.speak.err.network');
  if (err === 'no-speech' || err === 'aborted' || !err) return t('practice.speak.err.none');
  return t('practice.speak.err.other');
}

const back = (/** @type {string} */ href, /** @type {string} */ text) => h('a', { class: 'pr-backlink pressable', href }, icon('prev', { size: 16 }), text);

/** @param {HTMLElement} el @param {import('../contract.js').ViewCtx} ctx @param {string[]} parts rest after 'speak' */
export async function mountSpeak(el, ctx, parts) {
  const { t } = ctx;
  const sp = speech();
  const [what, sub] = parts;
  /** @type {(() => void)[]} */ const offs = [];
  const cleanup = () => { offs.forEach(f => f()); sp.cancel(); };
  if (what === 'aloud') { await drawAloud(sub); return cleanup; }
  if (what === 'teil2') { await drawTeil2(); return cleanup; }
  // the list
  const cal = session(ctx.store).cal;
  replace(el, h('div', { class: 'practice stack' },
    back('#/practice', t('practice.title')),
    h('div', { class: 'page-head' }, h('h1', null, t('practice.speak.title'))),
    h('p', { class: 'lead' }, t('practice.speak.lead')),
    h('nav', { class: 'pr-rows' },
      linkRow({ href: '#/practice/speak/teil2', title: t('practice.speak.teil2'), detail: t('practice.speak.teil2.detail') }),
      linkRow({ href: '#/practice/speak/aloud', title: t('practice.speak.aloud'), detail: t('practice.speak.aloud.detail') }),
      linkRow({ href: '#/practice/speak/aloud/check', title: t('practice.speak.check'), detail: cal ? t('practice.speak.check.done') : t('practice.speak.check.never') })),
    sp.canListen() ? null : notice({ children: [h('p', null, t('practice.speak.noRecogniser'))] })));
  return cleanup;

  // ---------- Say it aloud ----------
  async function drawAloud(/** @type {string | undefined} */ step) {
    if (!sp.canListen()) {
      replace(el, h('div', { class: 'practice stack' }, back('#/practice/speak', t('practice.speak.title')), h('div', { class: 'page-head' }, h('h1', null, t('practice.speak.aloud'))),
        h('p', null, t('practice.speak.safari')), h('p', { class: 'caption' }, t('practice.speak.typedInstead')),
        h('a', { class: 'btn pressable', href: '#/practice/round' }, t('practice.speak.typedRound'))));
      return;
    }
    const cal = session(ctx.store).cal;
    if (step === 'check') return micCheck();
    if (!cal && step !== 'go') {
      replace(el, h('div', { class: 'practice stack' }, back('#/practice/speak', t('practice.speak.title')),
        h('div', { class: 'page-head' }, h('h1', null, t('practice.speak.aloud'))),
        h('p', null, t('practice.speak.aloud.what')),
        h('ul', { class: 'pr-bullets' }, h('li', null, t('practice.speak.aloud.c1')), h('li', null, t('practice.speak.aloud.c2')), h('li', null, t('practice.speak.aloud.c3'))),
        h('p', null, t('practice.speak.aloud.not')),
        h('p', null, t('practice.speak.aloud.check')),
        h('div', { class: 'pr-done-actions' }, h('a', { class: 'btn btn-primary pressable', href: '#/practice/speak/aloud/check' }, t('practice.speak.check.start')),
          h('a', { class: 'btn pressable', href: '#/practice/speak/aloud/go' }, t('practice.speak.check.skip')))));
      return;
    }
    const data = await loadData(ctx);
    speakRound(data, cal);
  }

  function micCheck() {
    const C = Sp.CANARY, results = /** @type {{i: number, said: string}[]} */ ([]);
    let i = 0; /** @type {any} */ let live = null;
    const meta = h('p', { class: 'caption tnum' }), sent = h('p', { class: 'prompt', lang: 'de' }), heard = h('p', { class: 'pr-heard', lang: 'de' });
    const mic = micButton(() => tap(), t);
    replace(el, h('div', { class: 'practice stack pr-speak' }, back('#/practice/speak/aloud', t('practice.speak.aloud')),
      h('div', { class: 'page-head' }, h('h1', null, t('practice.speak.check'))), h('p', { class: 'caption' }, t('practice.speak.check.how')),
      h('div', { class: 'card pr-card' }, meta, sent, heard), mic.el));
    const show = () => { meta.textContent = t('practice.count', { n: i + 1, total: C.length }); sent.textContent = C[i].de; heard.textContent = ''; mic.set('idle', t('practice.speak.tapRead')); };
    async function tap() {
      if (live) { live.stop(); return; }
      mic.set('listening', t('practice.speak.listening'));
      live = sp.listen({ onInterim: (/** @type {string} */ x) => { heard.textContent = x; } });
      const res = await live.done; live = null;
      if (res.error && !res.text) { mic.set(sp.blocked() ? 'error' : 'idle', errorText(res.error, t)); return; }
      results.push({ i, said: res.text });
      if (++i < C.length) show(); else finish();
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
        h('div', { class: 'pr-done-actions' }, h('a', { class: 'btn btn-primary pressable', href: '#/practice/speak/aloud/go' }, t('practice.speak.aloud.start')))));
    }
    show();
    offs.push(() => live?.stop());
  }

  /** @param {any} data @param {any} cal */
  function speakRound(data, cal) {
    const cards = ctx.store.cards('b1');
    const said = data.pool.filter((/** @type {any} */ it) => it.area === 'speaking' && it.kind === 'phrase');
    const items = [...said.filter((/** @type {any} */ it) => cards[it.id]?.reps).sort((/** @type {any} */ a, /** @type {any} */ b) => (cards[a.id].due || '').localeCompare(cards[b.id].due || '')),
      ...said.filter((/** @type {any} */ it) => !cards[it.id]?.reps && it.star)].slice(0, 10);
    if (!items.length) {
      replace(el, h('div', { class: 'practice stack' }, back('#/practice/speak', t('practice.speak.title')), h('div', { class: 'page-head' }, h('h1', null, t('practice.speak.aloud'))),
        h('p', null, t('practice.speak.none')), h('a', { class: 'btn btn-primary pressable', href: '#/practice/round' }, t('practice.speak.typedRound'))));
      return;
    }
    let k = 0, t0 = 0; /** @type {any} */ let live = null;
    /** @type {{id: string, ok: boolean}[]} */ const results = [];
    const meta = h('p', { class: 'label' }), promptEl = h('div', { class: 'pr-promptbox' }), heard = h('p', { class: 'pr-heard', lang: 'de' });
    const res = h('div', { class: 'pr-fb', 'aria-live': 'polite' }), below = h('div', { class: 'pr-done-actions' });
    const answerEl = h('div', { class: 'answer pr-spoken' }, heard);
    const mic = micButton(() => tap(), t);
    const typeInput = /** @type {HTMLInputElement} */ (h('input', { type: 'text', class: 'input', lang: 'de', autocapitalize: 'off', autocomplete: 'off', spellcheck: 'false', placeholder: t('practice.ph.german'), 'aria-label': t('practice.answerLabel') }));
    const typeBox = h('form', { class: 'pr-typein', hidden: true, onsubmit: (/** @type {Event} */ e) => { e.preventDefault(); const v = typeInput.value.trim(); if (v) gradeIt(v, true); } },
      typeInput, h('button', { class: 'btn pressable', type: 'submit' }, t('practice.check')));
    const typeLink = h('button', { type: 'button', class: 'btn btn-quiet pressable', onclick: () => openType() }, t('practice.speak.typeInstead'));
    replace(el, h('div', { class: 'practice stack pr-speak' },
      h('div', { class: 'pr-top-row' }, h('h1', { class: 'label' }, t('practice.speak.aloud')), h('a', { class: 'btn btn-quiet pressable', href: '#/practice/speak' }, t('practice.end'))),
      h('div', { class: 'card pr-card' }, meta, promptEl, answerEl, h('div', { class: 'reveal-answer is-open' }, h('div', null, res))),
      mic.el, typeBox, below));
    const openType = () => { typeBox.hidden = false; typeInput.focus(); };
    function show() {
      const it = items[k];
      meta.textContent = `${t('practice.count', { n: k + 1, total: items.length })} · ${it.teil ? `Sprechen ${it.teil.replace('S', 'Teil ')}` : t('practice.speak.opinion')}`;
      replace(promptEl, h('p', { class: 'prompt' }, it.prompt), it.hl && norm(it.hl) !== norm(it.prompt) ? h('p', { class: 'prompt-hint' }, t('practice.speak.sayFor'), ' ', h('mark', { class: 'pr-hl' }, it.hl)) : null);
      heard.textContent = ''; replace(res); replace(below, typeLink); typeBox.hidden = true; typeInput.value = '';
      answerEl.classList.remove('is-correct', 'is-wrong');
      mic.el.hidden = false; mic.set('idle', t('practice.speak.tap')); t0 = performance.now();
    }
    async function tap() {
      if (live) { live.stop(); mic.set('checking', t('practice.speak.checking')); return; }
      if (sp.blocked()) { mic.set('error', errorText('not-allowed', t)); openType(); return; }
      mic.set('listening', t('practice.speak.listening'));
      live = sp.listen({ onInterim: (/** @type {string} */ x) => { heard.textContent = x; } });
      const r = await live.done; live = null;
      if (!r.text) { mic.set('idle', errorText(r.error, t)); if (r.error === 'network' || sp.blocked()) openType(); return; }
      gradeIt(r.text, false);
    }
    function gradeIt(/** @type {string} */ text, /** @type {boolean} */ typed) {
      const it = items[k], ms = performance.now() - t0;
      const g = gradeAnswer(it, text, null, data);
      const spk = Sp.grade(text, it, cal, { match: () => g.matchOk });
      const ok = typed ? g.ok : spk.ok;
      const cardsNow = ctx.store.cards('b1'), rec = cardsNow[it.id];
      const limit = T.limit(it, { stage: rec?.stage || 0, spoken: true });
      const out = S.spoken({ item: it, rec, o: { ok, ms, limit }, c: ctx.clock.ctx(), forecast: forecaster(cardsNow, ctx.clock.ctx().today), now: Date.now(), tz: tz() });
      saveAnswer(ctx.store, it.id, out.rec, out.event, {});
      results.push({ id: it.id, ok });
      mic.el.hidden = true; typeBox.hidden = true;
      const CHECK = /** @type {Record<string, string>} */ ({ true: t('practice.speak.ok'), false: t('practice.speak.bad'), 'not-in': t('practice.speak.notIn'), off: t('practice.speak.off') });
      const row = (/** @type {string} */ name, /** @type {any} */ v) => h('tr', null, h('td', null, name), h('td', { class: v === true ? 'is-ok' : v === false ? 'is-bad' : 'caption' }, CHECK[String(v)] || String(v)));
      heard.textContent = `„${spk.text}“`;
      replace(res,
        h('p', { class: 'caption' }, typed ? t('practice.speak.youTyped') : t('practice.speak.youSaid')),
        typed ? null : h('table', { class: 'pr-checks' }, h('tbody', null, row(t('practice.speak.c.phrase'), spk.chunk), row(t('practice.speak.c.verbFinalShort'), spk.verbFinal), row(t('practice.speak.c.fuerVor'), spk.fuerVor),
          row(t('practice.speak.c.articlesEndings'), t('practice.speak.notChecked')), row(t('practice.speak.c.pron'), t('practice.speak.notChecked')))),
        ok ? h('p', { class: 'pr-res is-ok' }, t('practice.right.time', { s: `${(ms / 1000).toFixed(1)} s` }))
          : [h('p', { class: 'pr-res is-bad' }, t('practice.wrong')), h('p', { class: 'answer-key', lang: 'de' }, g.right)],
        !ok && (g.detRule || it.rule) ? h('p', { class: 'pr-rule' }, g.detRule || it.rule) : null);
      if (ok) fxCorrect(answerEl, { hold: 0 }); else fxWrong(answerEl);
      announce(ok ? t('practice.speak.ok') : `${t('practice.wrong')}. ${g.right}`);
      const nextBtn = h('button', { type: 'button', class: 'btn btn-primary pressable', onclick: () => next() }, k + 1 < items.length ? t('practice.next') : t('practice.speak.finish'));
      replace(below, typed ? null : h('button', { type: 'button', class: 'btn pressable', onclick: () => { results.pop(); openType(); replace(res, h('p', { class: 'caption' }, t('practice.speak.typeMeant'))); } }, t('practice.speak.notWhatISaid')), nextBtn);
      nextBtn.focus({ preventScroll: true });
    }
    function next() { if (++k < items.length) show(); else done(); }
    function done() {
      const right = results.filter(r => r.ok).length;
      replace(el, h('div', { class: 'practice pr-done stack' }, h('p', { class: 'label' }, t('practice.speak.aloud')),
        h('h1', null, h('span', { class: 'figure tnum' }, String(right)), ' ', h('span', { class: 'pr-done-of' }, t('practice.speak.ofRight', { n: results.length }))),
        h('p', { class: 'lead' }, t('practice.speak.aloud.after')),
        h('div', { class: 'pr-done-actions' }, h('a', { class: 'btn btn-primary pressable', href: '#/practice/round' }, t('practice.speak.typedRound')), h('a', { class: 'btn pressable', href: '#/practice' }, t('practice.done')),
          h('a', { class: 'btn btn-quiet pressable', href: '#/practice/speak/aloud/check' }, t('practice.speak.check.redo')))));
      /** @type {HTMLElement | null} */ (el.querySelector('h1'))?.focus({ preventScroll: true });
    }
    const onKey = (/** @type {KeyboardEvent} */ e) => {
      if (e.key === 'Tab' && typeBox.hidden && !mic.el.hidden) { e.preventDefault(); openType(); }
      if (e.key === 'Escape') ctx.go('/practice/speak');
    };
    document.addEventListener('keydown', onKey);
    offs.push(() => document.removeEventListener('keydown', onKey), () => live?.stop());
    show();
  }

  // ---------- Teil 2 talk ----------
  async function drawTeil2() {
    const data = await loadData(ctx);
    const topics = data.plan.scenarios?.teil2 || ['Homeoffice'];
    let topic = topics.includes(session(ctx.store).teil2?.topic) ? session(ctx.store).teil2.topic : topics[0];
    const cues = FOLIEN.map(([, fns]) => data.pool.filter((/** @type {any} */ it) => it.kind === 'phrase' && it.group === 'S2' && fns.includes(it.fn) && it.star).slice(0, 2).map((/** @type {any} */ it) => it.model));
    let run = 0; /** @type {string | null} */ let audioUrl = null;
    /** @type {{secs: number, nw: number, sps: number | null}[]} */ const runs = [];
    offs.push(() => { if (audioUrl) URL.revokeObjectURL(audioUrl); });
    intro();
    function intro() {
      const tEl = h('b', { lang: 'de' }, topic);
      replace(el, h('div', { class: 'practice stack' }, back('#/practice/speak', t('practice.speak.title')),
        h('div', { class: 'page-head' }, h('h1', null, t('practice.speak.teil2'))),
        h('p', { class: 'lead' }, t('practice.speak.teil2.lead')),
        h('p', { class: 'pr-topic' }, h('span', { class: 'label' }, t('practice.speak.topic')), ' ', tEl, ' ',
          h('button', { type: 'button', class: 'btn btn-quiet pressable', onclick: () => { topic = topics[(topics.indexOf(topic) + 1) % topics.length]; updSession(ctx.store, s => ({ ...s, teil2: { topic } })); tEl.textContent = topic; } }, t('practice.speak.change'))),
        h('ol', { class: 'pr-folien' }, FOLIEN.map(([name], k) => h('li', null, h('span', { class: 'row-title', lang: 'de' }, name), h('span', { class: 'caption tnum' }, ` ${t('practice.speak.until', { t: mmss(ENDS[k]) })}`),
          cues[k].length ? h('span', { class: 'caption pr-cue', lang: 'de' }, cues[k].join(' · ')) : null))),
        sp.canListen() ? null : h('p', { class: 'caption' }, t('practice.speak.noRate')),
        h('div', { class: 'pr-done-actions' }, h('button', { type: 'button', class: 'btn btn-primary pressable', onclick: () => start() }, t('practice.speak.start', { t: mmss(RUNS[run]) })))));
    }
    async function start() {
      const total = RUNS[run], scale = total / 180;
      if (audioUrl) { URL.revokeObjectURL(audioUrl); audioUrl = null; }
      /** @type {any} */ let rec = null;
      if (sp.canRecord()) { try { rec = await sp.record(); } catch { rec = null; } }
      let words = '', heardMs = 0, stopped = false; /** @type {any} */ let live = null;
      const t0 = performance.now();
      if (sp.canListen()) {
        const go = () => { if (stopped) return; const s0 = performance.now(); live = sp.listen({ continuous: true });
          live.done.then((/** @type {any} */ r) => { if (r.text) { words += ` ${r.text}`; heardMs += performance.now() - s0; } go(); }); };
        go();
      }
      const clock = h('p', { class: 'numeral tnum pr-clock' }), folie = h('p', { class: 'pr-folie', lang: 'de' }), cue = h('p', { class: 'caption', lang: 'de' });
      const prog = h('div', { class: 'track pr-runbar' }, h('span', { class: 'fill' }));
      replace(el, h('div', { class: 'practice stack pr-run' }, h('h1', { class: 'label' }, t('practice.speak.run', { n: run + 1, topic, t: mmss(total) })), clock, folie, cue, prog,
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
        const blob = rec ? await rec.stop() : null;
        if (blob) audioUrl = URL.createObjectURL(blob);
        const text = words.trim(), nw = text ? text.split(/\s+/).length : 0, syl = Sp.syllables(text);
        const full = sp.canListen() && heardMs / 1000 >= 0.8 * secs && nw > 0;
        runs[run] = { secs, nw, sps: full ? syl / secs : null };
        after(full);
      }
    }
    function after(/** @type {boolean} */ full) {
      const r = runs[run];
      const nextRun = run + 1 < RUNS.length;
      replace(el, h('div', { class: 'practice stack' }, back('#/practice/speak', t('practice.speak.title')),
        h('div', { class: 'page-head' }, h('h1', null, t('practice.speak.runDone', { n: run + 1, t: mmss(r.secs) }))),
        full && r.sps ? h('p', { class: 'lead' }, t('practice.speak.rate', { words: r.nw, sps: r.sps.toFixed(1) })) : null,
        full ? h('p', { class: 'caption' }, t('practice.speak.rateRef')) : h('p', { class: 'caption' }, sp.canListen() ? t('practice.speak.rateNeeds') : t('practice.speak.timeOnly')),
        audioUrl ? h('audio', { controls: true, src: audioUrl, class: 'pr-audio' }) : h('p', { class: 'caption' }, t('practice.speak.noRecording')),
        runs.length > 1 ? h('ul', { class: 'list' }, runs.map((x, i) => h('li', { class: 'list-item tnum' }, t('practice.speak.runLine', { n: i + 1, t: mmss(x.secs) }), x.sps ? h('span', { class: 'caption' }, t('practice.speak.sps', { sps: x.sps.toFixed(1) })) : null))) : null,
        h('div', { class: 'pr-done-actions' },
          nextRun ? h('button', { type: 'button', class: 'btn btn-primary pressable', onclick: () => { run++; start(); } }, t('practice.speak.nextRun', { t: mmss(RUNS[run + 1]) })) : h('a', { class: 'btn btn-primary pressable', href: '#/practice' }, t('practice.done')),
          h('button', { type: 'button', class: 'btn pressable', onclick: () => start() }, t('practice.speak.again')))));
      /** @type {HTMLElement | null} */ (el.querySelector('h1'))?.focus({ preventScroll: true });
    }
  }
}
