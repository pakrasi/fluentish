/* Item ids for the one review schedule (UX §3.3). Every card in deck 'b1' is keyed by an item id whose prefix names
   the kind of item, so any feature can tell what a card is without loading content. The prefixes are the ones the
   B1 trainer already wrote (the migrated cards keep their ids); 'F:' is new for mistakes from corrections.

     BP:<slug>        B1 phrase (Sprechen, Schreiben letters)        area speaking
     BL:<slug>        B1 Lesen phrase or paraphrase pair             area reading
     BG:<slug>        B1 grammar item                                area grammar
     BT:<slug>        B1 situation: topic match                       area speaking
     BR:<slug>        B1 situation: reply to your partner             area speaking
     K:<chunk id>     phrase from the chunk bank                     area speaking
     G:<item id>      grammar item from the Igloo grammar set        area grammar
     W:<word id>      exam word that is in the German word list      area words
     BW:<slug>        exam word that is not in the word list         area words
     F:<attempt>-<n>  a mistake from a Schreiben/Sprechen correction area mistakes

   Pure; tested in node (tests/unit/practice-ids.test.mjs). */

/** @typedef {'phrase'|'reading'|'grammar'|'situation'|'reply'|'word'|'mistake'} ItemKind */

/** @type {Record<string, {kind: ItemKind, area: string}>} */
export const TAGS = {
  BP: { kind: 'phrase', area: 'speaking' },
  BL: { kind: 'reading', area: 'reading' },
  BG: { kind: 'grammar', area: 'grammar' },
  BT: { kind: 'situation', area: 'speaking' },
  BR: { kind: 'reply', area: 'speaking' },
  K: { kind: 'phrase', area: 'speaking' },
  G: { kind: 'grammar', area: 'grammar' },
  W: { kind: 'word', area: 'words' },
  BW: { kind: 'word', area: 'words' },
  F: { kind: 'mistake', area: 'mistakes' },
};

/** The prefix of an item id ('BP', 'F', …) or null. @param {string} id */
export function tagOf(id) {
  const m = /^([A-Z]{1,2}):./.exec(String(id || ''));
  return m && TAGS[m[1]] ? m[1] : null;
}

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
 * @param {string} lemma @param {Record<string, [string, string]>} [wordmap]
 */
export function wordId(lemma, wordmap = {}) {
  const l = String(lemma).trim();
  const wm = wordmap[l] || wordmap[l.toLowerCase()];
  return wm ? `W:${wm[0]}` : `BW:${slug(l)}`;
}

/** The card id of the n-th mistake (1-based) of an exam attempt. @param {string} attemptId @param {number} n */
export const mistakeId = (attemptId, n) => `F:${attemptId}-${n}`;
