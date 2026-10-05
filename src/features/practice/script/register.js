/* Script mode: register "Both" (owner decision 10: ihr AND Sie are both practised). A script is written in one form of
   address; with Both, each section can also be rehearsed at Cue in the other form. The other version is made once per
   section with Claude (his key, after the disclosure line), checked against the forms of address, and kept on this
   device as an added field of the script record (script.variants[sectionId] = {form, sentences, src, at}). Without a
   key the box says so plainly. A grade in the other form is recorded on the section's progress (variant: {form, done,
   g}); it moves neither the ladder nor the section's card.

   Pure helpers (formOf, variantPrompt, parseVariant, checkVariant) are tested in node; variantBox is the view piece. */
import { h, replace, announce } from '../../../core/dom.js';
import { ask } from '../../../services/claude.js';
import { config } from '../../../core/config.js';
import * as St from './store.js';

/** Informal plural address (ihr) and formal address (Sie) markers. */
const INFORMAL = /\b(ihr|euch|euer|eure[nmrs]?)\b/g;
const FORMAL_MID = /(?<![.!?:]\s*|^\s*)\b(Sie|Ihnen|Ihr|Ihre[nmrs]?)\b/g;

/**
 * The form of address a text uses: 'informal' (ihr), 'formal' (Sie) or null when it addresses nobody.
 * @param {string[]} sentences
 * @returns {'informal' | 'formal' | null}
 */
export function formOf(sentences) {
  let inf = 0, fo = 0;
  for (const s of sentences) {
    inf += (String(s).match(INFORMAL) || []).length;
    fo += (String(s).match(FORMAL_MID) || []).length;
    if (/^\s*(Sie|Ihnen)\b/.test(s) && /\b(haben|sind|können|wissen|sehen|werden|möchten|müssen|dürfen|sollten|würden)\s+Sie\b|^\s*Sie\s+(haben|sind|können|wissen|sehen|werden|möchten|müssen|dürfen|sollten|würden)\b/.test(s)) fo++;
  }
  if (!inf && !fo) return null;
  return inf >= fo ? 'informal' : 'formal';
}

/** The text a key and fingerprint is made from. @param {any} section */
export const sourceOf = section => section.sentences.map((/** @type {any} */ x) => x.de).join('\n');

/**
 * @param {string[]} sentences @param {'informal' | 'formal'} to
 */
export function variantPrompt(sentences, to) {
  const from = to === 'formal' ? 'ihr' : 'Sie';
  const into = to === 'formal' ? 'Sie' : 'ihr';
  const list = sentences.map((s, i) => `${i + 1}. ${s}`).join('\n');
  return `A speaker will say the German text below to an audience. It addresses the audience with "${from}". Rewrite each sentence so it `
    + `addresses the audience with "${into}" instead. Change only the forms of address and the verb forms that go with them `
    + '(ihr seid / Sie sind; habt ihr / haben Sie; euch / Sie (accusative) and Ihnen (dative); euer, eure, euren / Ihr, Ihre, Ihren with a capital I; '
    + 'Schaut mal! / Schauen Sie mal!; Wisst ihr …? / Wissen Sie …?). Keep every other word, the word order and the punctuation. '
    + 'Keep one output sentence per input sentence, in order.\n'
    + `${list}\n`
    + 'Reply with JSON only: an array of strings, one per sentence.';
}

/**
 * The reply as sentences, or null when it is not one string per sentence.
 * @param {string} text @param {number} count
 * @returns {string[] | null}
 */
export function parseVariant(text, count) {
  const m = String(text || '').match(/\[[\s\S]*\]/);
  if (!m) return null;
  /** @type {any} */ let j = null;
  try { j = JSON.parse(m[0]); } catch { return null; }
  if (!Array.isArray(j) || j.length !== count || !j.every(x => typeof x === 'string' && x.trim() && x.length < 600 && !/[<>{}]/.test(x))) return null;
  return j.map(x => x.replace(/\s+/g, ' ').trim());
}

/**
 * The other version uses the form it should (the German review's ihr/Sie table): no ihr, euch, euer in a Sie version,
 * no Ihnen or a capitalised Sie mid-sentence in an ihr version.
 * @param {string[]} sentences @param {'informal' | 'formal'} to
 */
export function checkVariant(sentences, to) {
  const text = sentences.join(' ');
  if (to === 'formal') return !/\b(euch|euer|eure[nmrs]?)\b/.test(text) && !/(?<![.!?]\s*|^)\bihr\b/.test(text.replace(/\b(mit|von|zu|bei|nach|aus|seit|gegenüber)\s+ihr\b/g, ''));
  return !/\bIhnen\b/.test(text) && !(text.match(FORMAL_MID) || []).length;
}

/**
 * The box above the text in Cue: the switch between the two forms, or how to make the other version.
 * @param {{ctx: import('../../contract.js').ViewCtx, script: any, section: any, onChange: () => void}} o
 */
export function variantBox({ ctx, script, section, onChange }) {
  const { t, store } = ctx;
  const el = h('div', { class: 'sc-variant', hidden: true });
  const both = (script.register || 'both') === 'both';
  const base = formOf(section.sentences.map((/** @type {any} */ x) => x.de)) || 'informal';
  const other = base === 'formal' ? 'informal' : 'formal';
  const name = (/** @type {string} */ f) => (f === 'formal' ? 'Sie' : 'ihr');
  let showOther = false, alive = true, step = '';

  const cached = () => {
    const v = (St.get(store, script.id) || script).variants?.[section.id];
    return v && v.src === sourceOf(section) && v.form === other && Array.isArray(v.sentences) && v.sentences.length === section.sentences.length ? v : null;
  };

  function draw() {
    el.hidden = !both || step !== 'cue';
    if (el.hidden) return;
    const v = cached();
    const key = (store.get('secrets', {}) || {}).anthropicKey;
    if (v) {
      const btn = (/** @type {string} */ f) => h('button', { type: 'button', class: 'chip pressable', 'aria-pressed': String((f === other) === showOther),
        onclick: () => { showOther = f === other; draw(); onChange(); announce(t('practice.script.variant.now', { form: name(f) })); } }, name(f));
      replace(el, h('div', { class: 'sc-variant-row', role: 'group', 'aria-label': t('practice.script.variant.label') },
        h('span', { class: 'label' }, t('practice.script.variant.label')), btn(base), btn(other)),
      showOther ? h('p', { class: 'caption' }, t('practice.script.variant.hint', { form: name(other) })) : null);
      return;
    }
    if (!key) { replace(el, h('p', { class: 'caption' }, t('practice.script.variant.noKey', { form: name(other) }))); return; }
    const status = h('p', { class: 'caption', 'aria-live': 'polite' });
    const go = /** @type {HTMLButtonElement} */ (h('button', { type: 'button', class: 'btn pressable', onclick: () => make(go, status) }, t('practice.script.variant.make', { form: name(other) })));
    replace(el, h('p', { class: 'caption' }, t('practice.script.variant.sent')), go, status);
  }

  /** @param {HTMLButtonElement} b @param {HTMLElement} status */
  async function make(b, status) {
    b.disabled = true; b.textContent = t('practice.script.variant.making');
    try {
      const src = section.sentences.map((/** @type {any} */ x) => x.de);
      const res = await ask({ key: store.get('secrets', {}).anthropicKey, user: variantPrompt(src, other), model: config.anthropic.models.check,
        maxTokens: 200 + 60 * src.length, effort: null, fallback: false });
      const out = parseVariant(res.text, src.length);
      if (!out || !checkVariant(out, other)) throw Object.assign(new Error('bad'), { code: 'variant' });
      const s = St.get(store, script.id); if (!s || !alive) return;
      St.put(store, { ...s, variants: { ...(s.variants || {}), [section.id]: { form: other, sentences: out, src: sourceOf(section), at: new Date().toISOString() } } });
      showOther = true;
      draw(); onChange();
      announce(t('practice.script.variant.ready', { form: name(other) }));
    } catch (err) {
      if (!alive) return;
      b.disabled = false; b.textContent = t('practice.script.variant.make', { form: name(other) });
      const code = /** @type {any} */ (err)?.code;
      status.textContent = code && code !== 'other' && code !== 'variant' ? t(`practice.script.err.${code}`) : t('practice.script.variant.failed');
    }
  }

  return {
    el,
    /** Which step is on screen: the box shows in Cue only. @param {string} s */
    setStep(s) { step = s; if (s !== 'cue') showOther = false; draw(); },
    /** The sentences to show, when the other version is switched on. */
    sentences() {
      const v = showOther && step === 'cue' ? cached() : null;
      return v ? v.sentences.map((/** @type {string} */ de, /** @type {number} */ i) => ({ id: '', de, en: section.sentences[i]?.en || null, p: section.sentences[i]?.p })) : null;
    },
    on: () => showOther && step === 'cue' && !!cached(),
    formName: () => name(other),
    /** @param {number} g @param {string} today */
    graded(g, today) {
      St.updateProgress(store, script.id, p => ({ ...p, sections: { ...p.sections, [section.id]: { ...(p.sections[section.id] || {}), variant: { form: other, done: today, g } } } }));
    },
    destroy() { alive = false; },
  };
}
