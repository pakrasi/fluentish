/* Conversation setup (#/practice/conversation): Free chat or Role-play, a topic or a scenario, what is sent, the
   month's spend against his cap, Start. Earlier conversations of this device are listed under it. */
import { h, replace } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { seg, notice, backLink } from '../../core/ui.js';
import { reduced } from '../../core/motion.js';
import { label } from '../../core/clock.js';
import { add } from '../../domain/days.js';
import { langAttr, dirAttr } from '../../core/lang.js';
import { unlock } from '../../services/voice.js';
import { config } from '../../core/config.js';
import * as C from '../../domain/conversation.js';
import * as D from './data.js';
import { sentSheet } from './sheets.js';
import { radioKeys } from '../../core/radiogroup.js';
import { IDS } from './prompts.js';

/** @param {HTMLElement} el @param {import('../contract.js').ViewCtx} ctx */
export async function mountSetup(el, ctx) {
  const { t, store } = ctx;
  const content = await D.loadTopics(ctx);
  const { conv } = D.convPack(ctx.settings());
  const ui = /** @type {{mode: 'free' | 'roleplay', pick: string | null, own: string}} */ ({ mode: 'free', pick: null, own: '' });
  const remembered = (store.get('ui', {}) || {}).convMode;
  if (remembered === 'roleplay' || remembered === 'free') ui.mode = remembered;
  let alive = true;
  /** The scene whose goal is open (it opens once, when picked). @type {string | null} */ let shownGoal = null;

  function draw() {
    if (!alive) return;
    const settings = ctx.settings();
    const cs = D.convSettings(settings);
    const c = ctx.clock.ctx();
    const level = settings.level || 'B1';
    const key = D.claudeKey(store);
    const all = D.listSessions(store);
    const spent = D.monthSpent(store, c.today);
    const month = C.monthLoad(spent, cs.monthlyCapUsd);
    const est = C.estimateNext(all);
    const topics = /** @type {C.Topic[]} */ (content?.topics || []);
    const scenarios = /** @type {C.Scenario[]} */ (content?.scenarios || []);
    const suggested = C.rankTopics(topics, { interests: cs.interests, level, recent: C.recentTopics(all, c.today, add), day: c.today, n: 3 });
    if (ui.mode === 'free' && !ui.pick && !ui.own) ui.pick = suggested[0]?.id || null;
    if (ui.mode === 'roleplay' && (!ui.pick || !scenarios.some(s => s.id === ui.pick))) ui.pick = C.rankTopics(scenarios.map(s => ({ ...s, tags: [s.fn], de: s.title })), { level, recent: C.recentTopics(all, c.today, add), day: c.today, n: 1 })[0]?.id || scenarios[0]?.id || null;

    /** A choice row (a radio in a group): the German title, the English line, the level. @param {string} id @param {string} de @param {string} en @param {string} meta */
    const choice = (id, de, en, meta) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(ui.pick === id && !ui.own), class: ['cv-choice', 'pressable', ui.pick === id && !ui.own && 'is-on'], dataset: { id },
      onclick: () => { ui.pick = id; ui.own = ''; draw(); } },
      h('span', { class: 'cv-choice-main' }, h('span', { class: 'cv-choice-de', lang: langAttr(), dir: dirAttr() }, de), h('span', { class: 'cv-choice-en' }, en)),
      h('span', { class: 'cv-choice-meta tnum' }, meta));

    const ownIn = /** @type {HTMLInputElement} */ (h('input', { class: 'input', id: 'cv-own', maxlength: '80', autocomplete: 'off', enterkeyhint: 'go', lang: langAttr(), dir: dirAttr(), value: ui.own,
      placeholder: t('conv.own.ph', { lang: conv?.language || '' }), oninput: () => {
        ui.own = ownIn.value;
        for (const b of /** @type {NodeListOf<HTMLElement>} */ (el.querySelectorAll('.cv-choice'))) { const on = !ui.own.trim() && b.dataset.id === ui.pick; b.classList.toggle('is-on', on); b.setAttribute('aria-checked', String(on)); }
        syncStart();
      } }));

    const more = topics.filter(x => !suggested.includes(x));
    const freeBlock = h('div', { class: 'cv-block' },
      h('h2', { class: 'cv-h' }, t('conv.topics')),
      // the link to Profile is a quiet 44 px button after the sentence (an inline link was 14 px tall)
      h('div', { class: 'cv-interests' },
        h('p', { class: 'caption' }, cs.interests.length ? t('conv.topics.by', { list: cs.interests.join(', ') }) : t('conv.topics.none')),
        h('a', { class: 'btn btn-quiet pressable cv-interests-btn', href: '#/profile/practice' }, cs.interests.length ? t('conv.topics.change') : t('conv.topics.add'))),
      h('div', { class: 'cv-choices', role: 'radiogroup', 'aria-label': t('conv.topics') }, suggested.map(x => choice(x.id, x.de, x.en, x.lv))),
      more.length ? h('details', { class: 'cv-more' }, h('summary', { class: 'pressable' }, t('conv.topics.more', { n: more.length })),
        h('div', { class: 'cv-choices', role: 'radiogroup', 'aria-label': t('conv.topics.all') }, more.map(x => choice(x.id, x.de, x.en, x.lv)))) : null,
      // a form, so Return (Go) starts the conversation with his own topic
      h('form', { class: 'form-field cv-own', onsubmit: (/** @type {Event} */ e) => { e.preventDefault(); if (!startBtn.disabled) start(); } },
        h('label', { class: 'field-label', for: 'cv-own' }, t('conv.own')), ownIn, h('p', { class: 'field-hint' }, t('conv.own.hint'))));

    const roleBlock = h('div', { class: 'cv-block' },
      h('h2', { class: 'cv-h' }, t('conv.scenarios')),
      h('p', { class: 'caption' }, t('conv.scenarios.lead')),
      h('div', { class: 'cv-choices', role: 'radiogroup', 'aria-label': t('conv.scenarios') },
        // the selected scene's goal opens under it (motion.js disclose), not under the whole list
        scenarios.flatMap(s => [choice(s.id, s.title, s.en, `${s.lv} · ${conv?.register?.[s.reg] || s.reg}`),
          s.id === ui.pick ? goalPanel(s) : null].filter(Boolean))));

    /** @param {C.Scenario} sc */
    function goalPanel(sc) {
      const panel = h('div', { class: 'reveal-answer cv-goal-panel', id: `cv-goal-${sc.id}` },
        h('div', null, h('p', { class: 'callout cv-goal' }, h('span', { class: 'label' }, t('conv.goal')), ' ', sc.goal)));
      if (shownGoal === sc.id) panel.classList.add('is-open');
      else { shownGoal = sc.id; requestAnimationFrame(() => requestAnimationFrame(() => { if (reduced()) { panel.style.transition = 'none'; } panel.classList.add('is-open'); })); }
      return panel;
    }

    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    const why = !conv || !content ? t('conv.noPack') : !key ? null : offline ? t('conv.offline') : month.over ? t('conv.month.over', { cap: D.money(month.cap) }) : null;
    const startBtn = /** @type {HTMLButtonElement} */ (h('button', { type: 'button', class: 'btn btn-primary btn-wide pressable cv-start', onclick: start },
      t('conv.start', { usd: D.money(est) })));
    const syncStart = () => { startBtn.disabled = !!why || !key || (ui.mode === 'free' ? !(ui.own.trim() || ui.pick) : !ui.pick); };
    syncStart();

    const earlier = all.slice(0, 5);
    const view = h('div', { class: 'practice stack cv cv-setup' },
      backLink({ href: '#/practice', label: t('practice.title') }),
      h('div', { class: 'page-head' }, h('h1', null, t('conv.title'))),
      h('p', { class: 'cv-lede' }, t('conv.lead', { lang: conv?.language || '' })),
      !key ? notice({ kind: 'warning', children: [h('p', { class: 'notice-title' }, t('conv.noKey')), h('p', null, h('a', { href: '#/profile/connections' }, t('conv.noKey.link')))] }) : null,
      seg({ label: t('conv.mode'), value: ui.mode, options: [['free', t('conv.mode.free')], ['roleplay', t('conv.mode.roleplay')]],
        onChange: v => { ui.mode = /** @type {any} */ (v); ui.pick = null; ui.own = ''; store.update('ui', (/** @type {any} */ u) => ({ ...(u || {}), convMode: v }), {}); draw(); } }),
      ui.mode === 'free' ? freeBlock : roleBlock,
      h('div', { class: 'cv-disclose' },
        h('p', null, t(cs.interests.length && ui.mode === 'free' ? 'conv.disclose.interests' : 'conv.disclose')),
        h('p', null, t('conv.invent')),
        h('button', { type: 'button', class: 'btn btn-quiet pressable cv-link', 'aria-haspopup': 'dialog', onclick: () => sentSheet(ctx, { interests: ui.mode === 'free' ? cs.interests : [], cap: month.cap, spent }) }, t('conv.sent.open'))),
      h('p', { class: ['caption', 'cv-month', month.warn && 'is-warn'] }, month.over ? t('conv.month.over', { cap: D.money(month.cap) })
        : month.warn ? t('conv.month.warn', { spent: D.money(spent), cap: D.money(month.cap) }) : t('conv.month', { spent: D.money(spent), cap: D.money(month.cap) })),
      why ? h('p', { class: 'caption cv-why', role: 'status' }, why) : null,
      // with the keyboard up (his own topic) Start sits on the keyboard (styles/app.css .kb-dock)
      h('div', { class: 'cv-startbar kb-dock' }, startBtn),
      earlier.length ? h('section', { class: 'cv-earlier' }, h('h2', { class: 'cv-h' }, t('conv.earlier')),
        h('ul', { class: 'cv-earlier-list' }, earlier.map(s => {
          const tr = D.getTranscript(store, s.id);
          const title = tr ? tr.title : t('conv.deleted');
          return h('li', null, h('a', { class: 'row pressable', href: `#/practice/conversation/c/${s.id}${s.status === 'open' ? '' : '/feedback'}` },
            h('span', { class: 'row-main' }, h('span', { class: 'row-title', lang: tr ? langAttr() : null, dir: tr ? dirAttr() : null }, title),
              h('span', { class: 'row-detail' }, t(s.status === 'open' ? 'conv.earlier.open' : 'conv.earlier.line', { mode: t(`conv.mode.${s.mode}`), date: label(s.day), min: s.minutes || 1, turns: s.turns }))),
            icon('next', { size: 16 })));
        }))) : null);
    replace(el, view);
    // the topic and scene lists: one tab stop each, arrow keys choose (core/radiogroup.js)
    for (const g of el.querySelectorAll('.cv-choices[role="radiogroup"]')) radioKeys(g, { root: el });
  }

  function start() {
    const settings = ctx.settings();
    const cs = D.convSettings(settings);
    const c = ctx.clock.ctx();
    const level = settings.level || 'B1';
    unlock();   // iOS: the device voice may only start after a tap; unlock it inside this one
    const topics = /** @type {C.Topic[]} */ (content?.topics || []);
    const scenarios = /** @type {C.Scenario[]} */ (content?.scenarios || []);
    /** @type {D.Session['topic']} */ let topic;
    let title = '', register = /** @type {'du' | 'sie'} */ ('du');
    if (ui.mode === 'roleplay') {
      const s = scenarios.find(x => x.id === ui.pick);
      if (!s) return;
      topic = { kind: 'scenario', ref: s.id }; title = s.title; register = s.reg;
    } else if (ui.own.trim()) {
      topic = { kind: 'own', ref: null }; title = ui.own.replace(/\s+/g, ' ').trim().slice(0, 80);
    } else {
      const x = topics.find(y => y.id === ui.pick);
      if (!x) return;
      topic = { kind: 'topic', ref: x.id }; title = x.de;
    }
    const id = D.newId();
    const now = Date.now();
    /** @type {D.Session} */
    const s = { id, v: 1, mode: ui.mode, topic, level, partnerLevel: C.partnerLevel(level), register, day: c.today, startedAt: now, endedAt: null, turns: 0, words: 0, minutes: 0, slower: false, toldSlower: false,
      models: { turn: config.anthropic.models.converse, feedback: config.anthropic.models.converseFeedback },
      promptVersions: { turn: IDS.turn, session: ui.mode === 'roleplay' ? IDS.roleplay : IDS.free, feedback: IDS.feedback },
      usage: C.noUsage(), costUsd: 0, closing: false, counted: false, cards: 0, status: 'open', deletedAt: null };
    D.putSession(store, s);
    D.putTranscript(store, { id, title, messages: [], turns: [] });
    ctx.go(`/practice/conversation/c/${id}${ctx.query.get('from') === 'today' ? '?from=today' : ''}`);
  }

  draw();
  const offs = [ctx.bus.on('settings:changed', draw), store.subscribe(D.SESSIONS, draw)];
  const onNet = () => draw();
  addEventListener('online', onNet); addEventListener('offline', onNet);
  return () => { alive = false; offs.forEach(f => f()); removeEventListener('online', onNet); removeEventListener('offline', onNet); };
}
