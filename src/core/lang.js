/* The study language, in one place (Arch #8; Wave C2 moved its table into the language packs, src/lang/).
   Everything that depends on which language he studies asks here instead of writing 'de' or 'de-DE':
     langAttr()    the lang attribute of target-language text ('de')
     dirAttr()     its writing direction ('ltr')
     bcp47()       the tag for voices and Intl ('de-DE')
     asrLocale()   the speech recogniser's locale ('de-DE')
     voicePrefs()  how services/voice.js picks a voice: names to prefer, names to avoid
     pack()        the active language pack (src/lang/types.js LanguagePack): the grader's, the detectors' and the word
                   cards' rules; languages() lists every language the UI can offer (full packs and metadata only)
   The active language follows settings.language (main.js calls setLanguage on boot and when it changes). Only a
   language whose content ships in this build can become active; any other falls back to German, so a profile that
   picked a language without content still gets correct lang attributes for the German content it is shown.
   The table comes from lang/registry.js (one entry per language of content/manifest.json, plus English). */
import { LANGUAGES, activePack, setActivePack, packFor as registryPack } from '../lang/registry.js';

/**
 * @typedef {{ id: string, code: string, bcp47: string, asr: string, dir: 'ltr' | 'rtl',
 *   voice: { prefer: RegExp | null, avoid: RegExp | null }, content: boolean }} LangPack
 */

/** Voices that read several languages with one accent ("Multilingual") are never used for study audio. */
export const MULTILINGUAL = /multilingual/i;

/** @param {string} id @param {string} code @param {string} tag @param {Partial<LangPack>} [o] @returns {LangPack} */
const entry = (id, code, tag, o = {}) => ({ id, code, bcp47: tag, asr: tag, dir: 'ltr', voice: { prefer: null, avoid: null }, content: false, ...o });

/** @type {Record<string, LangPack>} */
export const LANGS = {
  // the study languages: one table, the registry's (a full pack is a language with content in this build)
  ...Object.fromEntries(LANGUAGES.map(l => [l.legacyId, entry(l.legacyId, l.id, l.bcp47, {
    asr: l.speech.asr ? l.speech.asr.locale : l.bcp47, dir: l.dir, content: l.full, voice: { prefer: l.speech.tts.prefer, avoid: l.speech.tts.avoid } })])),
  english: entry('english', 'en', 'en-GB'),
};

const FALLBACK = LANGS.german;
/** @type {LangPack} */ let active = FALLBACK;

/**
 * Make a language active. One without content in this build (or an unknown id, or null before onboarding) keeps
 * German. Returns the pack now active.
 * @param {string | null | undefined} id
 */
export function setLanguage(id) {
  const p = id ? LANGS[id] : null;
  active = p && p.content ? p : FALLBACK;
  setActivePack(active.id);
  return active;
}

/** The active study language. */
export const language = () => active;
/** The pack for a language id (also one without content, e.g. for its name's lang attribute), or null. @param {string} id */
export const langPack = id => LANGS[id] || null;
/** The lang attribute of study-language text. */
export const langAttr = () => active.code;
/** The writing direction of study-language text. */
export const dirAttr = () => active.dir;
/** The BCP-47 tag for voices and Intl. */
export const bcp47 = () => active.bcp47;
/** The speech recogniser's locale. */
export const asrLocale = () => active.asr;
/** How a voice is chosen for the active language. */
export const voicePrefs = () => ({ prefer: active.voice.prefer, avoid: active.voice.avoid });
/** The voice preferences for any BCP-47 tag (the pack whose tag or code matches; none for an unknown tag). @param {string} tag */
export function voicePrefsFor(tag) {
  const base = String(tag || '').toLowerCase().split(/[-_]/)[0];
  const p = Object.values(LANGS).find(x => x.bcp47.toLowerCase() === String(tag).toLowerCase()) || Object.values(LANGS).find(x => x.code === base);
  return p ? { prefer: p.voice.prefer, avoid: p.voice.avoid } : { prefer: null, avoid: null };
}

/** The active language pack: the rules the grader, the detectors and the word cards use. */
export const pack = () => activePack();
/** The full pack for a language id ('de' or 'german'), or null (unknown, or metadata only). @param {string} id */
export const packFor = id => registryPack(id);
/** Every study language (full packs and metadata only), for the UI to list. */
export const languages = () => LANGUAGES;
/** A language's English name by its code or settings id ('fr' → 'French'); the code itself when unknown. @param {string} id */
export const languageName = id => (LANGUAGES.find(l => l.id === id || l.legacyId === id) || { name: id }).name;
