/* Every study language, and the active language pack (Wave C2).
   LANGUAGES: the ten languages of content/manifest.json `languages` (tests/unit/lang-registry.test.mjs keeps the two in
   step): their BCP-47 tag, script, direction, fonts and voices, so the UI can list them. Only German has a full pack in
   this build; the others are metadata only (full: false) until their pack ships.
   The active pack is what the language-neutral engines (domain/match.js, detect.js, punct.js, forms.js) use when a
   call names none. core/lang.js sets it from settings.language; a language without a full pack keeps German. */
// @ts-check
import de from './de/index.js';
/** @typedef {import('./types.js').LanguagePack} LanguagePack */
/** @typedef {import('./types.js').LanguageMeta} LanguageMeta */
/** @typedef {import('./types.js').LangId} LangId */
/** @typedef {import('./types.js').Script} Script */

const UI = 'var(--font-ui)', DISPLAY = 'var(--font-display)';
/**
 * @param {LangId} id @param {string} legacyId @param {string} name @param {string} native @param {string} bcp47
 * @param {Script} script @param {{dir?: 'ltr'|'rtl', font?: string, asr?: string | null, prefer?: RegExp | null}} [o]
 * @returns {LanguageMeta}
 */
const meta = (id, legacyId, name, native, bcp47, script, o = {}) => ({
  id, legacyId, name, native, bcp47, script, dir: o.dir || 'ltr', full: false,
  fonts: { prompt: o.font || DISPLAY, ui: o.font || UI },
  speech: { tts: { locales: [bcp47], prefer: o.prefer || null, avoid: null }, asr: o.asr === null ? null : { locale: o.asr || bcp47 } },
});

/** @type {LanguageMeta[]} */
export const LANGUAGES = [
  de,
  meta('fr', 'french', 'French', 'Français', 'fr-FR', 'Latn'),
  meta('es', 'spanish', 'Spanish', 'Español', 'es-ES', 'Latn'),
  meta('it', 'italian', 'Italian', 'Italiano', 'it-IT', 'Latn'),
  meta('pt', 'portuguese', 'Portuguese', 'Português', 'pt-PT', 'Latn'),
  meta('gsw', 'swissgerman', 'Swiss German', 'Schwiizerdütsch', 'gsw-CH', 'Latn', { asr: 'de-CH' }),
  meta('hi', 'hindi', 'Hindi', 'हिन्दी', 'hi-IN', 'Deva', { font: 'var(--font-devanagari)' }),
  meta('bn', 'bengali', 'Bengali', 'বাংলা', 'bn-IN', 'Beng', { font: 'var(--font-bengali)' }),
  // no speech recogniser has Khasi
  meta('kha', 'khasi', 'Khasi', 'Ka Ktien Khasi', 'kha-IN', 'Latn', { asr: null }),
  meta('ar', 'arabic', 'Arabic', 'العربية', 'ar-SA', 'Arab', { dir: 'rtl', font: 'var(--font-arabic)' }),
];

/** The full packs of this build. @type {Partial<Record<LangId, LanguagePack>>} */
export const PACKS = { de };

/** The pack used when none is active or named. */
export const DEFAULT_PACK = de;

/** A language's metadata by its id ('de') or its settings id ('german'), or null. @param {string | null | undefined} id */
export const languageMeta = id => LANGUAGES.find(l => l.id === id || l.legacyId === id) || null;

/** The full pack for an id or settings id, or null (unknown, or metadata only). @param {string | null | undefined} id */
export function packFor(id) {
  const m = languageMeta(id);
  return (m && PACKS[m.id]) || null;
}

/** @type {LanguagePack} */ let active = DEFAULT_PACK;
/** The active pack: what the engines use when a call names none. */
export const activePack = () => active;
/**
 * Make a language's pack active; one without a full pack (or an unknown id, or null) makes German active. Returns the
 * pack now active. @param {string | null | undefined} id
 */
export function setActivePack(id) {
  active = packFor(id) || DEFAULT_PACK;
  return active;
}
