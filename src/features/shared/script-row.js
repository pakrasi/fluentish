/* Script mode on Practice's hub: one row (§3.1). Small and synchronous, so the hub imports it without the views. */
import { linkRow } from '../../core/ui.js';
import { label } from '../../core/clock.js';
import * as D8 from '../../domain/days.js';
import * as St from '../../data/scripts.js';
import { readiness } from '../../domain/script/ladder.js';

const EXAM_AHEAD = new Set(['week', 'lastNew', 'eve', 'day']);

/**
 * "Scripts · Bike talk 34% · talk in 40 days", "Scripts · 2 active", or the empty invitation.
 * @param {any} store @param {any} c clock ctx @param {(k: string, v?: any) => string} t
 */
export function hubRow(store, c, t) {
  const list = St.list(store).filter(s => s.status !== 'archived');
  const act = list.filter(s => s.status === 'active');
  let detail;
  if (!list.length) detail = t('practice.script.hub.empty');
  else if (act.length >= 2) detail = t('practice.script.hub.n', { n: act.length });
  else {
    const s = act[0] || list[0];
    const sc = St.cardOf(store);
    const r = readiness(s, St.progress(store, s.id), id => sc(id)?.rec, c.today);
    detail = s.deliverOn && s.deliverOn >= c.today ? t('practice.script.hub.one', { title: s.title, pct: r.pct, n: D8.diff(c.today, s.deliverOn) })
      : t('practice.script.hub.oneNoDate', { title: s.title, pct: r.pct });
  }
  if (list.length && c.exam && EXAM_AHEAD.has(c.phase) && !act.some(s => s.deliverOn && s.deliverOn <= c.exam)) detail = t('practice.script.hub.wait', { date: label(c.exam) });
  return linkRow({ href: '#/practice/scripts', title: t('practice.script.title'), detail });
}
