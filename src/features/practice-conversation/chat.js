/* The conversation (#/practice/conversation/c/<id>), full screen. He writes; Claude's reply streams in word by word.
   A reply may pick up one of his mistakes and say it right (a recast): those words get a dotted underline that draws in
   once the reply is complete, and a tap shows what he wrote. Any other word of a reply opens its gloss (the word list
   on this device first). "Slower" asks Claude to speak at his own level from his next message on.

   The history is append-only (domain/conversation.js commit): an exchange is saved only when the reply is complete, so
   a failed or stopped reply leaves his text in the field and nothing in the history. The system prompt is fixed when
   the conversation starts (kept in the transcript), so every turn reads the conversation so far from the prompt cache.
   Limits: each request is capped (max_tokens), his message at 600 characters; the session at 30 messages, 25 minutes
   and its tokens (80 %: Claude is asked to close the conversation; 100 %: the composer closes); the month at his cap. */
import { h, replace, announce } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { reduced, haptic } from '../../core/motion.js';
import { fitToKeyboard, keep, reveal as revealEl } from '../../core/keyboard.js';
import { langAttr, dirAttr, bcp47 } from '../../core/lang.js';
import { setSetting } from '../../data/settings.js';
import { say, hush, canSay } from '../../services/voice.js';
import { stream, ClaudeError } from '../../services/claude.js';
import { splitSentences, tokenize } from '../../domain/text/tokens.js';
import * as C from '../../domain/conversation.js';
import * as D from './data.js';
import { language, usedIds } from './lang.js';
import { addActivity } from '../shared/data.js';
import { baseSystem, sessionSystem, levelNote, closingNote } from './prompts.js';
import { glossSheet, sentSheet } from './sheets.js';
import { claude, canAskClaude } from '../../data/credentials.js';

/** Waits before retrying a request that failed for a passing reason (rate, overloaded, offline, a broken stream). */
const RETRY_MS = [1000, 3000, 8000];
const PASSING = new Set(['rate', 'overloaded', 'offline', 'stream']);
/** A tap on Stop this soon after Send is the second half of a double tap, not a stop (the request is billed either way). */
const STOP_GRACE_MS = 400;

/**
 * @param {HTMLElement} el @param {import('../contract.js').ViewCtx} ctx @param {D.Session} s0
 */
export async function mountChat(el, ctx, s0) {
  const { t, store } = ctx;
  if (s0.status !== 'open') { ctx.go(`/practice/conversation/c/${s0.id}/feedback`, { replace: true }); return undefined; }
  document.body.dataset.chrome = 'off';
  document.body.classList.add('cv-in-chat');
  let alive = true;
  /** @type {AbortController | null} */ let ctl = null;
  let busy = false;
  let sentAt = 0;
  /** @type {string | null | undefined} */ let lastWhy;   // the composer's last closed state (undefined: not drawn yet)
  const id = s0.id;
  const sess = () => /** @type {D.Session} */ (D.getSession(store, id));
  let tr = /** @type {C.Transcript} */ (D.getTranscript(store, id));
  const lang = await language(ctx).catch(() => null);
  const content = await D.loadTopics(ctx);
  const conv = lang?.conv || D.convPack(ctx.settings()).conv;
  const app = { store, hlc: ctx.app.hlc, bus: ctx.bus };
  const voiceOk = canSay(bcp47(), { localOnly: true });

  // the system prompt is fixed for the whole conversation (kept in the device-only transcript): a change of interests
  // or an app update mid-conversation must not change the cached prefix or the history the API checks
  if (!tr.system && conv) {
    const s = sess();
    const scenario = s.mode === 'roleplay' ? (content?.scenarios || []).find((/** @type {any} */ x) => x.id === s.topic.ref) || null : null;
    const interests = s.mode === 'free' ? D.convSettings(ctx.settings()).interests : [];
    tr = { ...tr, system: { base: baseSystem(conv), session: sessionSystem(conv, { mode: s.mode, level: s.level, partnerLevel: s.partnerLevel, register: s.register, title: tr.title,
      interests, scenario }), interests } };
    D.putTranscript(store, tr);
  }

  // ---------- layout ----------
  const endBtn = h('button', { type: 'button', class: 'btn btn-quiet pressable cv-end', onclick: () => end() }, t('conv.end'));
  const meta = h('p', { class: 'cv-meta tnum' });
  const slowerChip = h('button', { type: 'button', class: 'chip pressable', 'aria-pressed': String(!!s0.slower), onclick: () => toggleSlower() }, t('conv.slower'));
  const recastChip = h('button', { type: 'button', class: 'chip pressable', 'aria-pressed': String(D.convSettings(ctx.settings()).showRecasts), onclick: () => toggleRecasts() }, t('conv.recasts'));
  const log = h('ol', { class: 'cv-log', 'aria-label': t('conv.log') });
  const status = h('div', { class: 'cv-status', role: 'status' });
  const field = /** @type {HTMLTextAreaElement} */ (h('textarea', { class: 'cv-input', rows: '1', lang: langAttr(), dir: dirAttr(), maxlength: String(C.LIMITS.inputChars), autocomplete: 'off',
    autocapitalize: 'sentences', spellcheck: 'false', enterkeyhint: 'send', 'aria-label': t('conv.input', { lang: conv?.language || '' }), placeholder: t('conv.input.ph', { lang: conv?.language || '' }), oninput: () => fit(), onkeydown: (/** @type {KeyboardEvent} */ e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendTyped(); }
    } }));
  const count = h('span', { class: 'caption tnum cv-count', 'aria-live': 'polite' });
  // Send and the helper phrases keep the focus in the field, so the keyboard stays up from one message to the next
  const sendBtn = h('button', { type: 'button', class: 'cv-send pressable', 'aria-label': t('conv.send'), onpointerdown: keep, onclick: () => (busy ? stopTap() : sendTyped()) }, icon('next', { size: 20 }));
  const chips = h('div', { class: 'cv-helpers', role: 'group', 'aria-label': t('conv.helpers') },
    (conv?.chips || []).map((/** @type {string} */ c) => h('button', { type: 'button', class: 'chip pressable cv-helper', lang: langAttr(), dir: dirAttr(), onpointerdown: keep, onclick: () => insert(c) }, c)));
  const closedBox = h('div', { class: 'cv-closed', hidden: true });
  const composer = h('div', { class: 'cv-composer' }, h('div', { class: 'cv-wrap' }, chips, closedBox, h('div', { class: 'cv-field' }, field, sendBtn), count));
  const view = h('div', { class: 'cv cv-chat' },
    h('header', { class: 'cv-bar' }, h('div', { class: 'cv-wrap cv-bar-row' },
      h('a', { class: 'btn btn-quiet pressable cv-back', href: '#/practice/conversation' }, icon('back', { size: 18 }), t('conv.back')),
      h('h1', { class: 'cv-bar-title', tabindex: '-1' }, t('conv.chat')), endBtn)),
    // a column sized to the visible screen (core/keyboard.js): the bar, the conversation (the one scroller) and the
    // composer, which sits on the keyboard. iOS has nothing to pan, so the bar never leaves the screen.
    h('main', { class: 'cv-main' }, h('div', { class: 'cv-wrap' },
      h('div', { class: 'cv-strip' },
        h('p', { class: 'label' }, t(`conv.mode.${s0.mode}`)),
        h('p', { class: 'cv-topic', lang: langAttr(), dir: dirAttr() }, tr.title),
        meta,
        h('div', { class: 'chips cv-chips' }, slowerChip, recastChip),
        h('p', { class: 'cv-disclose-line' }, t('conv.disclose.short'), ' ',
          h('button', { type: 'button', class: 'cv-inline-link', 'aria-haspopup': 'dialog', onclick: () => {
            const c = ctx.clock.ctx();
            const cs = D.convSettings(ctx.settings());
            sentSheet(ctx, { interests: tr.system?.interests || [], cap: cs.monthlyCapUsd, spent: D.monthSpent(store, c.today) });
          } }, t('conv.sent.open')))),
      log, status)),
    composer);
  replace(el, view);
  const unfit = fitToKeyboard(view);

  // ---------- drawing ----------
  function drawMeta() {
    const s = sess();
    meta.textContent = t('conv.meta', { level: s.level, partner: C.partnerLevel(s.level, !!s.slower), n: s.turns, max: C.LIMITS.turns });
  }

  /** A partner reply as words to tap, with its recast. @param {C.Turn} turn @param {string | null} lastLearner @param {{fresh?: boolean}} [o] */
  function partnerBubble(turn, lastLearner, { fresh = false } = {}) {
    const showRecasts = D.convSettings(ctx.settings()).showRecasts;
    const r = C.parseReply(turn.text, lastLearner);
    const line = h('p', { class: 'cv-line', lang: langAttr(), dir: dirAttr(), role: 'group', 'aria-label': t('conv.reply') });
    /** @type {HTMLElement[]} */ const words = [];
    const noteId = `cv-note-${turn.i}`;
    const note = r.recast && showRecasts ? h('p', { class: 'cv-note', id: noteId, hidden: true }, h('span', { class: 'cv-note-k' }, t('conv.youWrote')), ' ',
      h('span', { class: 'cv-note-de', lang: langAttr(), dir: dirAttr() }, `„${r.recast.was}“`)) : null;
    for (const part of r.parts) {
      if (part.recast && note) {
        const b = h('button', { type: 'button', class: ['cv-recast', !fresh && 'is-drawn', !fresh && 'no-anim'], 'aria-expanded': 'false', 'aria-controls': noteId, tabindex: '-1',
          'aria-label': t('conv.recast.label', { text: part.text }), onclick: () => { const open = note.hidden; note.hidden = !open; b.setAttribute('aria-expanded', String(open)); } }, part.text);
        words.push(b);
        line.append(' ', b, ' ');
        continue;
      }
      // a word and the punctuation stuck to it stay on one line ("Ausstellung?" never breaks before the "?")
      /** @type {HTMLElement | null} */ let unit = null;
      for (const tok of tokenize(part.text)) {
        if (tok.sp || !unit) { if (tok.sp) line.append(' '); unit = h('span', { class: 'cv-tok' }); line.append(unit); }
        if (!tok.w || tok.num) { unit.append(tok.t); continue; }
        const b = h('button', { type: 'button', class: 'cv-w', tabindex: '-1', onclick: () => gloss(tok.t, r.plain) }, tok.t);
        words.push(b);
        unit.append(b);
      }
    }
    if (words[0]) words[0].tabIndex = 0;
    line.addEventListener('keydown', e => {
      const i = words.indexOf(/** @type {HTMLElement} */ (e.target));
      if (i < 0) return;
      const to = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? i + 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? words.length - 1 : null;
      if (to == null) return;
      e.preventDefault();
      const b = words[Math.max(0, Math.min(words.length - 1, to))];
      for (const x of words) x.tabIndex = x === b ? 0 : -1;
      b.focus();
    });
    const play = voiceOk ? h('button', { type: 'button', class: 'cv-icon pressable', 'aria-label': t('conv.playReply'), onclick: () => { hush(); say(r.plain, bcp47(), { localOnly: true }); } }, icon('speaker', { size: 18 })) : null;
    const li = h('li', { class: ['cv-msg', 'cv-them', fresh && 'is-new'] },
      h('div', { class: 'cv-bubble' }, line, note, h('div', { class: 'cv-bfoot' }, play,
        r.recast && note && fresh ? h('span', { class: 'cv-how' }, t('conv.recast.hint')) : null)));
    return { li, recast: line.querySelector('.cv-recast') };
  }

  /** @param {C.Turn} turn @param {{fresh?: boolean}} [o] */
  const learnerBubble = (turn, { fresh = false } = {}) => h('li', { class: ['cv-msg', 'cv-you', fresh && 'is-new'] },
    h('div', { class: 'cv-bubble' }, h('p', { class: 'cv-line', lang: langAttr(), dir: dirAttr() }, turn.text),
      h('div', { class: 'cv-bfoot' }, h('span', { class: 'cv-how' }, icon('pencil', { size: 13 }), t('conv.typed')))));

  function drawLog() {
    /** @type {HTMLElement[]} */ const items = [];
    let last = /** @type {string | null} */ (null);
    for (const turn of tr.turns) {
      if (turn.who === 'learner') { items.push(learnerBubble(turn)); last = turn.text; } else items.push(partnerBubble(turn, last).li);
    }
    replace(log, items);
  }

  function fit() {
    field.style.height = 'auto';
    field.style.height = `${Math.min(120, field.scrollHeight)}px`;
    const n = field.value.length;
    count.textContent = n > C.LIMITS.inputChars - 100 ? t('conv.count', { n, max: C.LIMITS.inputChars }) : '';
  }

  /** @param {string} chip a helper phrase; "…" marks where his word goes */
  function insert(chip) {
    const i = chip.indexOf('…');
    const before = i >= 0 ? chip.slice(0, i) : chip, after = i >= 0 ? chip.slice(i + 1) : '';
    const v = field.value.trim();
    field.value = (v ? `${v} ` : '') + before + after;
    const at = (v ? v.length + 1 : 0) + before.length;
    field.focus({ preventScroll: true });
    field.setSelectionRange(at, at);
    fit();
  }

  // the newest message to the bottom of the conversation; kept there when the keyboard opens (core/keyboard.js)
  const scrollEnd = (/** @type {Element} */ x) => revealEl(x, { block: 'end' });

  /**
   * The composer's state: closed at a limit, or for a missing key. say: a reply to announce first (one announcement,
   * so the closing line never cuts the reply off).
   * @param {string} [say]
   */
  function drawComposer(say = '') {
    const s = sess();
    const c = ctx.clock.ctx();
    const load = C.sessionLoad({ turns: s.turns, startedAt: s.startedAt, usage: s.usage }, Date.now());
    const month = C.monthLoad(D.monthSpent(store, c.today), D.convSettings(ctx.settings()).monthlyCapUsd);
    const why = !canAskClaude(store) ? 'key' : load.closed ? 'session' : month.over ? 'month' : null;
    const hadFocus = document.activeElement === field;
    const closing = !!why && why !== lastWhy && lastWhy !== undefined;
    lastWhy = why;
    composer.classList.toggle('is-closed', !!why);
    field.disabled = !!why;
    sendBtn.toggleAttribute('disabled', !!why && !busy);
    chips.hidden = !!why;
    closedBox.hidden = !why;
    if (why) {
      replace(closedBox, h('p', null, why === 'key' ? t('conv.closed.key') : why === 'month' ? t('conv.closed.month', { cap: D.money(month.cap) }) : t('conv.closed.session')),
        why === 'key' ? h('a', { class: 'btn pressable', href: '#/profile/connections' }, t('conv.noKey.link'))
          : h('button', { type: 'button', class: 'btn btn-primary pressable', onclick: () => end() }, t('conv.feedback.get')));
      // the field just closed under him: say why (a screen reader hears it) and give focus to the way on (audit P1-13)
      if (closing) say = [say, /** @type {HTMLElement} */ (closedBox.firstChild).textContent || ''].filter(Boolean).join(' ');
      if (hadFocus || (closing && document.activeElement === document.body)) /** @type {HTMLElement | null} */ (closedBox.querySelector('a, button'))?.focus();
    } else if (load.warn) {
      status.replaceChildren(h('p', { class: 'caption' }, t('conv.nearEnd')));
    }
    if (say) announce(say);
    return why;
  }

  // ---------- talking ----------
  function sendTyped() {
    const text = C.cleanInput(field.value);
    if (!text || busy) return;
    send(text);
  }

  /**
   * One exchange: his message (null: the opening), Claude's reply streamed in, then saved.
   * @param {string | null} user
   */
  async function send(user) {
    if (busy || !alive) return;
    const cred = claude(store);
    if (!tr.system || !conv) { status.replaceChildren(h('p', { class: 'caption' }, t('conv.noPack'))); return; }
    // closed at a limit: no request at all, the opening's "Try again" included (audit P1-3)
    if (drawComposer()) return;
    if (!cred) return;
    const s = sess();
    const load = C.sessionLoad({ turns: s.turns, startedAt: s.startedAt, usage: s.usage }, Date.now());
    /** @type {string[]} */ const systems = [];
    const slower = !!s.slower;
    const levelSent = user != null && slower !== !!s.toldSlower;
    if (levelSent) systems.push(levelNote(slower, C.partnerLevel(s.level, slower)));
    if (user != null && load.warn && !s.closing) systems.push(closingNote());
    const body = C.turnRequest({ model: s.models.turn, base: tr.system.base, session: tr.system.session, messages: C.nextMessages(tr, user, systems) });
    busy = true;
    sentAt = Date.now();
    hush();
    status.replaceChildren();
    sendBtn.setAttribute('aria-label', t('conv.stop'));
    replace(sendBtn, icon('stop', { size: 18 }));
    composer.classList.add('is-busy');
    const mine = user != null ? learnerBubble({ i: tr.turns.length, who: 'learner', text: user, at: Date.now(), input: 'typed' }, { fresh: true }) : null;
    if (mine) { log.append(mine); field.value = ''; fit(); }
    const lineEl = h('p', { class: 'cv-line is-streaming', lang: langAttr(), dir: dirAttr() }, h('span', { class: 'cv-typing', 'aria-label': t('conv.writing') }, h('i'), h('i'), h('i')));
    const pending = h('li', { class: 'cv-msg cv-them is-new' }, h('div', { class: 'cv-bubble' }, lineEl));
    log.append(pending);
    scrollEnd(pending);
    /** @type {any} */ let res = null;
    /** @type {string | null} */ let failed = null;
    for (let attempt = 0; ; attempt++) {
      ctl = new AbortController();
      try {
        res = await stream({ cred, body, signal: ctl.signal, onText: text => { lineEl.textContent = C.visibleText(text); } });
        break;
      } catch (e) {
        // a request the API took is billed even when it failed, was stopped or the page was left: count it now
        if (e instanceof ClaudeError && e.usage) D.charge(store, id, ctx.clock.ctx().today, s.models.turn, e.usage);
        const code = e instanceof ClaudeError ? e.code : 'other';
        if (code === 'aborted' || !alive) { failed = 'aborted'; break; }
        if (PASSING.has(code) && attempt < RETRY_MS.length) {
          replace(lineEl, h('span', { class: 'cv-typing', 'aria-label': t('conv.writing') }, h('i'), h('i'), h('i')));
          status.replaceChildren(h('p', { class: 'caption' }, t('conv.retrying')));
          await new Promise(r => setTimeout(r, RETRY_MS[attempt]));
          if (!alive || ctl.signal.aborted) { failed = 'aborted'; break; }
          continue;
        }
        failed = code;
        break;
      }
    }
    ctl = null;
    busy = false;
    // counted before anything else, so leaving the page mid-reply never loses a charge
    if (res) D.charge(store, id, ctx.clock.ctx().today, res.model || s.models.turn, res.usage);
    composer.classList.remove('is-busy');
    sendBtn.setAttribute('aria-label', t('conv.send'));
    replace(sendBtn, icon('next', { size: 20 }));
    if (!alive) return;
    status.replaceChildren();
    const text = res ? String(res.text || '').trim() : '';
    const cut = res && res.stop === 'max_tokens' && !/[.!?…]["“”»]?$/.test(text);
    if (failed || !res || res.stop === 'refusal' || !text || cut) {
      // nothing is saved: his message goes back into the field, the history is as it was
      pending.remove();
      mine?.remove();
      if (user != null && !field.value) { field.value = user; fit(); }
      const code = failed === 'aborted' ? null : res && res.stop === 'refusal' ? 'refusal' : cut ? 'cut' : failed || 'empty';
      if (code) {
        status.replaceChildren(h('p', { class: 'cv-error' }, t(`conv.err.${code}`)),
          ['key', 'credit', 'nokey', 'forbidden'].includes(code) ? h('a', { class: 'btn pressable', href: '#/profile/connections' }, t('conv.noKey.link'))
            : h('button', { type: 'button', class: 'btn pressable', onclick: () => { if (user == null) send(null); else sendTyped(); } }, t('conv.tryAgain')));
      }
      drawComposer();
      return;
    }
    const lastLearner = user != null ? user : (tr.turns.filter(x => x.who === 'learner').pop()?.text || null);
    tr = /** @type {any} */ ({ ...C.commit(tr, { user, systems, content: res.content, reply: text, at: Date.now() }), system: tr.system });
    D.putTranscript(store, tr);
    const cur = sess();
    D.patchSession(store, id, { turns: cur.turns + (user != null ? 1 : 0), words: cur.words + (user != null ? C.wordsIn(user) : 0),
      closing: cur.closing || systems.includes(closingNote()), toldSlower: levelSent ? slower : !!cur.toldSlower });
    const turn = tr.turns[tr.turns.length - 1];
    const b = partnerBubble(turn, lastLearner, { fresh: true });
    pending.replaceWith(b.li);
    if (b.recast) requestAnimationFrame(() => requestAnimationFrame(() => b.recast?.classList.add('is-drawn')));
    haptic();
    scrollEnd(b.li);
    drawMeta();
    drawComposer(C.parseReply(text, lastLearner).plain);
  }

  function stop() { ctl?.abort(); }
  /** The send button while a reply streams: Stop, but not in the first STOP_GRACE_MS (a quick second tap on Send). */
  function stopTap() { if (Date.now() - sentAt >= STOP_GRACE_MS) stop(); }

  function toggleSlower() {
    const s = sess();
    D.patchSession(store, id, { slower: !s.slower });
    slowerChip.setAttribute('aria-pressed', String(!s.slower));
    drawMeta();
    status.replaceChildren(h('p', { class: 'caption' }, t(!s.slower ? 'conv.slower.on' : 'conv.slower.off')));
  }

  function toggleRecasts() {
    const on = !D.convSettings(ctx.settings()).showRecasts;
    setSetting(app, 'conversation.showRecasts', on);
    recastChip.setAttribute('aria-pressed', String(on));
    drawLog();
  }

  /** @param {string} word @param {string} plain the reply */
  function gloss(word, plain) {
    if (!lang) return;
    const sentence = splitSentences(plain, lang.pack).find(x => tokenize(x).some(tk => tk.w && tk.t === word)) || plain;
    glossSheet(ctx, { word, sentence, lang, sessionId: id });
  }

  function end() {
    stop();
    const s = sess();
    if (!s.turns) {
      // nothing of his to review: the conversation is put away and setup opens
      D.patchSession(store, id, { status: 'ended', endedAt: Date.now() });
      ctx.go('/practice/conversation');
      return;
    }
    const st = C.stats(tr.turns, s.startedAt, Date.now());
    const day = ctx.clock.ctx().today;
    if (!s.counted) addActivity(store, s.day || day, { minutes: st.minutes, kind: 'talk' });
    if (lang) store.update(D.USED, (/** @type {any} */ u) => C.addEvidence(u || {}, usedIds(lang, tr.turns.filter(x => x.who === 'learner').map(x => x.text)), day), {});
    D.patchSession(store, id, { status: 'ended', endedAt: Date.now(), minutes: st.minutes, turns: st.turns, words: st.words, counted: true });
    ctx.go(`/practice/conversation/c/${id}/feedback${ctx.query.get('from') === 'today' ? '?from=today' : ''}`);
  }

  // ---------- start ----------
  drawMeta();
  drawLog();
  fit();
  if (!drawComposer() && !tr.turns.length) send(null);
  const lastEl = log.lastElementChild;
  if (lastEl) scrollEnd(lastEl);
  const onNet = () => { if (navigator.onLine) status.replaceChildren(); };
  addEventListener('online', onNet);

  return {
    unmount() {
      alive = false;
      ctl?.abort();
      hush();
      removeEventListener('online', onNet);
      unfit();
      document.body.dataset.chrome = 'on';
      document.body.classList.remove('cv-in-chat');
    },
  };
}
