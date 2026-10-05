/* Script mode: the choices that are the learner's to make (SCRIPT-UX §13), as constants in one place so a later
   setting can replace each one without hunting through the code. */

/** A new section is said word for word (Talk); a section can be switched to Retell (say it in your own words). */
export const DEFAULT_SECTION_KIND = /** @type {'talk' | 'retell'} */ ('talk');

/** The audience form is stored and shown, never enforced: 'informal' (ihr), 'formal' (Sie) or 'both'. */
export const DEFAULT_REGISTER = /** @type {'informal' | 'formal' | 'both'} */ ('both');
export const ENFORCE_REGISTER = false;

/** Share of the daily minutes scripts may take once no exam is ahead, and the most a near deadline may take. */
export const MINUTES_SHARE = 0.25;
export const MINUTES_SHARE_MAX = 0.5;

/** Full runs and script reviews never go to the results repository. */
export const SYNC_RUNS = false;

/** Scripts come in by paste only (no vault import). */
export const IMPORT = 'paste';

/** The "Parts" step before Letters: say each part of a sentence, then the whole sentence (his Bausteine method). */
export const PARTS_STEP = true;

/** Limits and thresholds. */
export const MAX_CHARS = 20000;
export const LONG_SCRIPT_WORDS = 2500;
export const MIN_WORDS = 20;
export const LONG_SENTENCE = 25;          // words: flagged as long, offered a split
export const SECTION_MAX = 220;           // words in a run with no break before it is split
export const SECTION_SPLIT_AT = 150;
export const WPM = 110;                   // speaking speed for the full-run target
export const KNOWN_R = 0.9;               // expected recall that counts as known / ready
export const NEW_WORDS_PER_DAY = 8;       // per script
export const NO_NEW_DAYS = 3;             // no new words in the last 3 days before delivery
export const MAX_ACTIVE = 2;
export const TAKES_KEPT = 3;
