/* Item ids for the one review schedule (UX §3.3). Every card in deck 'b1' is keyed by an item id whose prefix names
   the kind of item, so any feature can tell what a card is without loading content. The prefixes are the ones the
   B1 trainer already wrote (the migrated cards keep their ids); 'F:' is new for mistakes from corrections.

     BP:<slug>        B1 phrase (Sprechen, Schreiben letters)        area speaking
     BL:<slug>        B1 Lesen phrase or paraphrase pair             area reading
     BG:<slug>        B1 grammar item                                area grammar
     BT:<slug>        B1 situation: topic match                       area speaking
     BR:<slug>        B1 situation: reply to your partner             area speaking
     BS:a<n>-<slug>   Goethe B1 Schreiben phrase (Aufgabe n)          area writing
     K:<chunk id>     phrase from the chunk bank                     area speaking
     G:<item id>      grammar item from the Igloo grammar set        area grammar
     W:<word id>      exam word that is in the German word list      area words
     BW:<slug>        exam word that is not in the word list         area words
     F:<attempt>-<n>  a mistake from a Schreiben/Sprechen correction area mistakes
     SS:<fn>-<nn>     a speaking situation (self-graded), deck 'speak' area situations
     CO:<a>~<b>       cluster study: given word a, type its opposite b  deck 'clusters'
     CF:<word id>     cluster study: a word family's stem and a meaning, type the word  deck 'clusters'
     CP:<gap id>      cluster study: a preposition gap sentence          deck 'clusters'
     PX:<p>.see|say   Word building: a prefix (its motion; what it does)  deck 'build'
     PD:<verb>        Word building: predict a prefixed verb's meaning     deck 'build'
     PV:<verb>        Word building: English → type the prefixed verb      deck 'build'
     PS:<frame>.<form> Word building: the verb pieces in a sentence frame  deck 'build'
     SX:<suffix>      Word building: an ending and the article it gives   deck 'build'
     PW:<word>        Word building: parent word + ending → the new word  deck 'build'
   Cluster study also schedules W:<word id> (meaning → word) in deck 'clusters'. Script mode keeps SR: (section
   rehearsals) and SW:<slug> (script words not in the list) in deck 'script'.
   Reading (round 4) saves to deck '<lang>:read': W:<word id> for a listed word, and
     RW:<slug>        a word read and saved that is not in the word list   area words
     RP:<slug>        a phrase read and saved (not in the chunk bank)       area speaking

   Pure; tested in node (tests/unit/practice-ids.test.mjs). */

/** @typedef {'phrase'|'reading'|'grammar'|'situation'|'reply'|'word'|'mistake'|'sim'|'opposite'|'family'|'prep'|'prefix'|'pverb'|'frame'|'suffix'|'pword'} ItemKind */

/** @type {Record<string, {kind: ItemKind, area: string}>} */
export const TAGS = {
  BP: { kind: 'phrase', area: 'speaking' },
  BL: { kind: 'reading', area: 'reading' },
  BG: { kind: 'grammar', area: 'grammar' },
  BT: { kind: 'situation', area: 'speaking' },
  BR: { kind: 'reply', area: 'speaking' },
  BS: { kind: 'phrase', area: 'writing' },
  K: { kind: 'phrase', area: 'speaking' },
  G: { kind: 'grammar', area: 'grammar' },
  W: { kind: 'word', area: 'words' },
  BW: { kind: 'word', area: 'words' },
  F: { kind: 'mistake', area: 'mistakes' },
  SS: { kind: 'sim', area: 'situations' },
  CO: { kind: 'opposite', area: 'clusters' },
  CF: { kind: 'family', area: 'clusters' },
  CP: { kind: 'prep', area: 'clusters' },
  PX: { kind: 'prefix', area: 'build' },
  PD: { kind: 'pverb', area: 'build' },
  PV: { kind: 'pverb', area: 'build' },
  PS: { kind: 'frame', area: 'build' },
  SX: { kind: 'suffix', area: 'build' },
  PW: { kind: 'pword', area: 'build' },
  RW: { kind: 'word', area: 'words' },
  RP: { kind: 'phrase', area: 'speaking' },
};

/** The prefix of an item id ('BP', 'F', …) or null. @param {string} id */
export function tagOf(id) {
  const m = /^([A-Z]{1,2}):./.exec(String(id || ''));
  return m && TAGS[m[1]] ? m[1] : null;
}

/**
 * A Schreiben card: a BS: phrase, or one of the B1 trainer's letter items (BP:w1-…, BP:w2-…, BP:w3-…), which the
 * Schreiben content files under its functions (content b1/schreiben.json linked) and the pool puts in area writing.
 * @param {string} id
 */
export const isWriting = id => /^(BS:|BP:w[123]-)/.test(String(id || ''));

/** What kind of item an id names, or null for an unknown prefix. @param {string} id */
export function kindOf(id) {
  const tag = tagOf(id);
  return tag ? { tag, ...TAGS[tag] } : null;
}

/** ASCII slug for ids: umlauts spelled out, everything else to '-'. @param {string} s */
export const slug = s => String(s).normalize('NFC').toLowerCase()
  .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/**
 * The card id of an exam word: 'W:<word id>' when the lemma is in the word map (content b1/wordmap.json:
 * lemma → [word id, level]), else 'BW:<slug>'. Look up uses the same id to show a word's schedule.
 * The map's keys keep their case ('Zeit', and both 'Essen' and 'essen'): the exact lemma wins, then its lower-case
 * form, then the capitalised form, so a noun captured as 'zeit' finds 'Zeit'. Ids are never re-keyed: when the
 * match is new (a word added to the list, or a capitalised match) and a card already exists under the old 'BW:' id
 * (has), that card keeps its id.
 * @param {string} lemma @param {Record<string, [string, string]>} [wordmap] @param {((id: string) => boolean) | null} [has]
 */
export function wordId(lemma, wordmap = {}, has = null) {
  const l = String(lemma).trim();
  const legacy = `BW:${slug(l)}`;
  const wm = wordmap[l] || wordmap[l.toLowerCase()];
  // a word added to the word list later (the cluster words) keeps the BW: card it already has
  if (wm) return has && has(legacy) ? legacy : `W:${wm[0]}`;
  const cap = wordmap[l.charAt(0).toUpperCase() + l.slice(1)];
  if (cap) return has && has(legacy) ? legacy : `W:${cap[0]}`;
  return legacy;
}

/** The card id of the n-th mistake (1-based) of an exam attempt. @param {string} attemptId @param {number} n */
export const mistakeId = (attemptId, n) => `F:${attemptId}-${n}`;

/** @typedef {'exam'|'speech'|'practice'|'lookup'|'script'|'test'|'self'|'read'|'conversation'} Origin */
/** Every Origin (read and conversation since round 4: reading and conversation practice). */
export const ORIGINS = /** @type {Origin[]} */ (['exam', 'speech', 'practice', 'lookup', 'script', 'test', 'self', 'read', 'conversation']);
/**
 * Where an item was first met, from its card id and deck, for cards that have no recorded src (every card made before
 * src was recorded) and as the src of new cards: deck 'speak' → speech, 'script' → script, a reading deck ('read', the
 * name of '<lang>:read') → read; in deck 'b1' a mistake
 * from a correction (F:) and a Lesen phrase (BL:) → exam, a Sprechen phrase or situation (BP:, BT:, BR:) → speech,
 * an exam word (W:, BW: in the exam word list, isExam) → exam; everything else → practice.
 * @param {string} id @param {string} deck @param {(id: string) => boolean} [isExam]
 * @returns {Origin}
 */
export function origin(id, deck, isExam = () => false) {
  if (deck === 'speak') return 'speech';
  if (deck === 'script') return 'script';
  if (deck === 'read') return 'read';
  if (deck !== 'b1') return 'practice';
  const tag = tagOf(id);
  if (tag === 'F' || tag === 'BL') return 'exam';
  if (tag === 'BP' || tag === 'BT' || tag === 'BR') return 'speech';
  if ((tag === 'W' || tag === 'BW') && isExam(id)) return 'exam';
  return 'practice';
}

/* Item ids per language (round 3, C3a). The same content id can name an item in two languages (the chunk bank's
   'K:ENG_CHUNK_0001' is a German phrase and a French one), so an item id says its language:
     German        unscoped, as it always was: 'K:ENG_CHUNK_0001', 'W:haus.n' (never re-keyed, never prefixed)
     any other     '<lang>:<item id>': 'fr:K:ENG_CHUNK_0001', 'fr:W:maison.n'
   Card ids inside a course's namespaced decks ('fr:core') stay plain ('K:ENG_CHUNK_0001'): the deck already scopes the
   card (IndexedDB key [profileId, deck, id]); knowledge scopes the item it resolves to by the deck's language
   (domain/knowledge.js), and a feature that keys anything by item id (Look up's seen, exam words) uses scopeItem with
   its course's language. */

/** The language whose item ids carry no scope. */
export const UNSCOPED_LANG = 'de';

/**
 * An item id in a language's scope: unchanged for German (or no language), '<lang>:<id>' otherwise; idempotent.
 * @param {string | null | undefined} lang @param {string} id @returns {string}
 */
export function scopeItem(lang, id) {
  if (!id || !lang || lang === UNSCOPED_LANG) return id;
  return id.startsWith(`${lang}:`) ? id : `${lang}:${id}`;
}

/**
 * An item id's language and its id inside that language ('fr:K:x' → {lang: 'fr', id: 'K:x'}; 'K:x' → German).
 * @param {string} id @returns {{lang: string, id: string}}
 */
export function splitItem(id) {
  const m = /^([a-z]{2,3}):(.+)$/.exec(String(id || ''));
  return m ? { lang: m[1], id: m[2] } : { lang: UNSCOPED_LANG, id: String(id || '') };
}
