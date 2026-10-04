/* B1 trainer: time limit per item (01 §b). Pure; an ES module, tested in node.
   T = clamp(m_stage · (T_read + T_plan + T_out), 5, 40) s; typed T_out = 0.40 s per character of the shortest
   accepted answer (minus the prefill; a required slot counts 8 characters, optional words and slots 0).
   Spoken: T_out = syllables / 2.5 (3.3 at stage 3) + 1 s, min 4 s. New items are untimed (null).
   k_type calibration is deferred until after the exam (review B10): k = 1. */
const M_STAGE = [1.5, 1.2, 1.0, 0.8];
const PLAN = { recall: 1.5, transform: 2.5, choice: 3.5 };
const count = s => (String(s || '').match(/[\p{L}\p{N}'-]+/gu) || []).length;
const syll = s => (String(s).toLowerCase().match(/(äu|eu|ei|ie|au|[aeiouyäöü])/g) || []).length;
// a pattern as he would type it at its shortest: optional words and slots dropped, a slot = 8 characters
const shortForm = p => String(p).replace(/\(\[[^\]]*\]\)/g, ' ').replace(/\([^)]*\)/g, ' ').replace(/\[[^\]]*\]/g, 'xxxxxxxx').replace(/\s+/g, ' ').trim();
function shortest(item) {
  const pats = item.kind === 'reply' ? (item.moves || []).flatMap(m => m.accept || []) : (item.accept || []);
  let best = pats.length ? Math.min(...pats.map(p => shortForm(p).length)) : String(item.model || '').length;
  if (item.prefill) best = Math.max(1, best - String(item.prefill).length - 1);
  return best;
}
function shortestText(item) {
  const pats = item.accept || [];
  return pats.map(shortForm).sort((a, b) => a.length - b.length)[0] || String(item.model || '');
}
function parts(item, o = {}) {
  const en = item.promptLang === 'en' || item.prompt_lang === 'en';
  const wEN = count(en ? item.prompt : '');
  const wDE = count(en ? '' : String(item.prompt).replace(/\s*\([^()]*\)\s*$/, '').replace(/_+/g, ' ')) + count(item.partner);
  const read = 1.0 + 0.25 * wEN + 0.5 * wDE;
  const plan = PLAN[item.plan] || 1.5;
  const out = o.spoken ? syll(shortestText(item)) / ((o.stage || 0) >= 3 ? 3.3 : 2.5) + 1.0 : 0.40 * shortest(item);
  return { read, plan, out };
}
// seconds (rounded to 0.5), or null for an untimed new item
function limit(item, o = {}) {
  if (o.isNew) return null;
  const p = parts(item, o);
  const m = M_STAGE[Math.max(0, Math.min(3, o.stage || 0))];
  const t = Math.min(40, Math.max(o.spoken ? 4 : 5, m * (o.k || 1) * (p.read + p.plan + p.out)));
  return Math.round(t * 2) / 2;
}

const api = { limit, parts, shortest, syll, M_STAGE };
export default api;
export { limit, parts, shortest, syll, M_STAGE };
