/* Reading: small view pieces the screens share. */
import { h } from '../../core/dom.js';
import { icon } from '../../core/icons.js';

/** "‹ Reading". @param {string} href @param {string} text */
export const back = (href, text) => h('a', { class: 'pr-backlink pressable', href }, icon('prev', { size: 16 }), text);

/** 0.906 → "90.6", 0.96 → "96". @param {number} x */
export const pct = x => { const v = Math.round(x * 1000) / 10; return Number.isInteger(v) ? String(v) : v.toFixed(1); };

/** "About B2 · 96 % known · Right for study". @param {any} est @param {(k: string, v?: any) => string} t */
export function levelLine(est, t) {
  if (!est) return null;
  return t('read.level.line', { level: est.level, pct: pct(est.coverage), band: t(`read.band.${est.band}`) });
}

/** A Claude error's line (services/claude.js ClaudeError codes). @param {any} err @param {(k: string, v?: any) => string} t @param {string} fallback */
export function errLine(err, t, fallback) {
  const code = err && err.code;
  return code && code !== 'other' ? t(`read.err.${code}`) : fallback;
}
