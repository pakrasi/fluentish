/* The study language, in one place (Arch #8, the seam before the language pack of Wave C).
   Everything that depends on which language he studies asks here instead of writing 'de' or 'de-DE':
     langAttr()    the lang attribute of target-language text ('de')
     dirAttr()     its writing direction ('ltr')
     bcp47()       the tag for voices and Intl ('de-DE')
     asrLocale()   the speech recogniser's locale ('de-DE')
     voicePrefs()  how services/voice.js picks a voice: names to prefer, names to avoid
   The active language follows settings.language (main.js calls setLanguage on boot and when it changes). Only a
   language whose content ships in this build can become active; any other falls back to German, so a profile that
   picked a language without content still gets correct lang attributes for the German content it is shown.
   The table is data: Wave C moves it into the language pack. */

/**
 * @typedef {{ id: string, code: string, bcp47: string, asr: string, dir: 'ltr' | 'rtl',
 *   voice: { prefer: RegExp | null, avoid: RegExp | null }, content: boolean }} LangPack
 */

/** Voices that read several languages with one accent ("Multilingual") are never used for study audio. */
export const MULTILINGUAL = /multilingual/i;

/** @param {string} id @param {string} code @param {string} tag @param {Partial<LangPack>} [o] @returns {LangPack} */
const pack = (id, code, tag, o = {}) => ({ id, code, bcp47: tag, asr: tag, dir: 'ltr', voice: { prefer: null, avoid: null }, content: false, ...o });

/** @type {Record<string, LangPack>} */
export const LANGS = {
  german: pack('german', 'de', 'de-DE', { content: true, voice: { prefer: /Anna|Helena|Petra|Markus|Google Deutsch/i, avoid: null } }),
  english: pack('english', 'en', 'en-GB'),
  french: pack('french', 'fr', 'fr-FR'),
  spanish: pack('spanish', 'es', 'es-ES'),
  italian: pack('italian', 'it', 'it-IT'),
  portuguese: pack('portuguese', 'pt', 'pt-PT'),
  swissgerman: pack('swissgerman', 'gsw', 'gsw-CH', { asr: 'de-CH' }),
  hindi: pack('hindi', 'hi', 'hi-IN'),
  bengali: pack('bengali', 'bn', 'bn-IN'),
  khasi: pack('khasi', 'kha', 'kha-IN'),
  arabic: pack('arabic', 'ar', 'ar-SA', { dir: 'rtl' }),
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
