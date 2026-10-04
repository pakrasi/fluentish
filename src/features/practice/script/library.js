/* Script mode: the library (#/practice/scripts, SCRIPT-UX §3.2). Active scripts by delivery date, then those without a
   date, paused ones, and archived ones folded away. Each card shows its words, minutes to say it, the field as a
   strip, how much is ready and the date. */
import { h, replace } from '../../../core/dom.js';
import { icon } from '../../../core/icons.js';
import * as St from './store.js';
import { readiness } from './ladder.js';
import { runMinutes } from './plan.js';
import { scriptWords } from './parse.js';
import { back, num, scriptField, dateLine, kindLine } from './ui.js';

/** @param {HTMLElement} el @param {import('../../contract.js').ViewCtx} ctx */
export function mountLibrary(el, ctx) {
  const { t, store } = ctx;
  function render() {
    const c = ctx.clock.ctx();
    const all = St.list(store);
    const shown = all.filter(s => s.status !== 'archived'), archived = all.filter(s => s.status === 'archived');
    const sc = St.cardOf(store);
    const card = (/** @type {any} */ s) => {
      const r = readiness(s, St.progress(store, s.id), id => sc(id)?.rec, c.today);
      const words = scriptWords(s);
      return h('a', { class: ['sc-lib-card', 'pressable', s.status !== 'active' && 'is-quiet'], href: `#/practice/scripts/${s.id}` },
        h('span', { class: 'sc-lib-top' }, h('span', { class: 'row-title' }, s.title), h('span', { class: 'sc-tag' }, kindLine(s, t))),
        h('span', { class: 'caption' }, t('practice.script.lib.size', { words: num(words), min: runMinutes(s) })),
        scriptField(r, { strip: true }),
        h('span', { class: 'sc-lib-foot' },
          h('span', { class: 'label' }, s.status === 'paused' ? t('practice.script.paused') : s.status === 'archived' ? t('practice.script.archived') : dateLine(s, c.today, t)),
          h('span', { class: 'label tnum' }, t('practice.script.lib.ready', { pct: r.pct }))));
    };
    const orphans = Object.keys(store.get(St.WORDS, {}) || {}).length;
    replace(el, h('div', { class: 'practice stack sc-lib has-dock' },
      back('#/practice', t('practice.title')),
      h('div', { class: 'page-head' }, h('h1', null, t('practice.script.title'))),
      shown.length ? h('div', { class: 'sc-lib-list' }, shown.map(card))
        : h('p', { class: 'lead' }, t('practice.script.empty')),
      archived.length ? h('details', { class: 'sc-archived' }, h('summary', { class: 'row' }, h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, t('practice.script.archivedN', { n: archived.length }))), icon('next', { size: 16 })),
        h('div', { class: 'sc-lib-list' }, archived.map(card))) : null,
      orphans ? h('a', { class: 'row pressable', href: '#/practice/round?kind=script:words' }, h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, t('practice.script.orphans', { n: orphans })),
        h('span', { class: 'row-detail' }, t('practice.script.orphans.detail'))), icon('next', { size: 16 })) : null,
      h('p', { class: 'caption sc-private' }, t('practice.script.private')),
      h('div', { class: 'pr-queue-btn sc-dock' }, h('a', { class: 'btn btn-primary btn-wide pressable', href: '#/practice/scripts/new' }, t('practice.script.new')))));
  }
  render();
  const off = [ctx.store.subscribe(St.KV, render)];
  return () => off.forEach(f => f());
}
