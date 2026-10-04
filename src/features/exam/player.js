/* Hören audio with the exam's play limits: no seeking, a play counts once playback has actually started, the count
   is saved on the device (a reload does not give a play back), one recording at a time, reading time before Teil 2
   and 3, and the second hearing of Teil 1 and 4 starting by itself after 5 seconds. While something plays, the Teil
   tabs and Back/Next are locked (group.onBusy). Audio comes from the exam's media base. */
import { h, replace, announce } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { fmt } from './timer.js';
import { plays, usePlay } from './data.js';

/** One runner's players. @param {(busy: boolean) => void} onBusy */
export function playerGroup(onBusy) {
  /** @type {Set<{refresh: () => void, stop: () => void}>} */ const all = new Set();
  /** @type {any} */ let owner = null;
  /** @type {number[]} */ const timers = [];
  const g = {
    get owner() { return owner; },
    /** @param {any} p */ take(p) { owner = p; onBusy(true); all.forEach(x => x.refresh()); },
    /** @param {any} p */ release(p) { if (owner === p) { owner = null; onBusy(false); all.forEach(x => x.refresh()); } },
    /** @param {any} p */ add(p) { all.add(p); },
    /** @param {number} id */ timer(id) { timers.push(id); },
    stop() { timers.forEach(clearInterval); all.forEach(p => p.stop()); owner = null; onBusy(false); },
  };
  return g;
}

/**
 * @param {{ group: ReturnType<typeof playerGroup>, store: any, n: number, id: string, url: string, limit: number,
 *           readSeconds?: number, autoSecond?: boolean, t: (k: string, v?: any) => string, toast: (s: string) => void }} o
 */
export function player({ group, store, n, id, url, limit, readSeconds = 0, autoSecond = false, t, toast }) {
  const audio = new Audio();
  audio.preload = 'none';
  audio.src = url;
  const btn = h('button', { type: 'button', class: 'btn pressable ex-play' });
  const left = h('span', { class: 'ex-plays caption tnum', 'aria-live': 'polite' });
  const bar = h('i');
  const time = h('span', { class: 'caption tnum' });
  const note = h('p', { class: 'caption ex-play-note', lang: 'de' });
  let playing = false, starting = false, broken = false;
  /** @type {number | null} */ let countdown = null;
  const used = () => plays(store, n)[id]?.used || 0;
  const remaining = () => Math.max(0, limit - used());
  const me = {
    refresh() {
      const busyElsewhere = group.owner && group.owner !== me;
      replace(btn, icon(playing ? 'speaker' : remaining() > 0 ? 'play' : 'check', { size: 18 }),
        h('span', { lang: 'de' }, playing ? t('exam.de.playing') : countdown ? t('exam.de.reading') : remaining() > 0 ? t('exam.de.play') : t('exam.de.noPlays')));
      btn.disabled = broken || playing || starting || !!countdown || remaining() <= 0 || !!busyElsewhere;
      left.textContent = broken ? t('exam.audioMissing') : remaining() > 0 ? t('exam.playsLeft', { n: remaining() }) : t('exam.playsDone');
      time.textContent = audio.duration && Number.isFinite(audio.duration) ? `${fmt(audio.currentTime)} / ${fmt(audio.duration)}` : '';
    },
    stop() { try { audio.pause(); } catch { /* not started */ } if (countdown) clearInterval(countdown); countdown = null; },
  };
  group.add(me);
  const playNow = () => {
    if (remaining() <= 0 || starting || (group.owner && group.owner !== me)) return;
    starting = true; group.take(me);
    audio.preload = 'auto';
    try { audio.currentTime = 0; } catch { /* before metadata */ }
    audio.play().then(() => {
      usePlay(store, n, id);
      playing = true; starting = false; note.textContent = '';
      announce(t('exam.playsLeft', { n: remaining() }));
      me.refresh();
    }).catch(() => { starting = false; group.release(me); me.refresh(); toast(t('exam.audioBlocked')); });
  };
  btn.onclick = () => {
    if (!readSeconds || used() > 0) return playNow();
    let s = readSeconds;
    group.take(me);
    const skip = h('button', { type: 'button', class: 'btn btn-quiet pressable', lang: 'de', onclick: () => go() }, t('exam.de.skipReading'));
    const draw = () => replace(note, t('exam.de.readingLeft', { n: s }), ' ', skip);
    const go = () => { if (countdown) clearInterval(countdown); countdown = null; note.textContent = ''; group.release(me); playNow(); };
    countdown = /** @type {any} */ (setInterval(() => { s--; if (s <= 0) go(); else draw(); }, 1000));
    group.timer(/** @type {number} */ (countdown));
    draw(); me.refresh();
  };
  audio.addEventListener('timeupdate', () => { bar.style.width = audio.duration ? `${(100 * audio.currentTime) / audio.duration}%` : '0'; me.refresh(); });
  audio.addEventListener('ended', () => {
    playing = false; group.release(me); me.refresh();
    if (autoSecond && remaining() > 0) {
      let s = 5;
      note.textContent = t('exam.de.secondIn', { n: s });
      const iv = /** @type {any} */ (setInterval(() => {
        s--;
        if (s <= 0) { clearInterval(iv); note.textContent = ''; if (!group.owner) playNow(); }
        else note.textContent = t('exam.de.secondIn', { n: s });
      }, 1000));
      group.timer(iv);
    }
  });
  audio.addEventListener('pause', () => { if (playing && !audio.ended) { playing = false; group.release(me); me.refresh(); } });
  audio.addEventListener('loadedmetadata', () => me.refresh());
  audio.addEventListener('error', () => { if (!audio.src) return; broken = true; playing = false; group.release(me); me.refresh(); });
  me.refresh();
  return h('div', { class: 'ex-player' }, h('div', { class: 'ex-player-row' }, btn, left), h('div', { class: 'ex-player-bar' }, bar), time, note);
}

/** After submitting: a plain player, as often as wanted. @param {string} url */
export const reviewAudio = url => h('audio', { class: 'ex-raudio', controls: true, preload: 'none', src: url });
