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

   Pure; tested in node (tests/unit/practice-ids.test.mjs). */

/** @typedef {'phrase'|'reading'|'grammar'|'situation'|'reply'|'word'|'mistake'} ItemKind */

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
 * capitalised match is new and a card already exists under the old 'BW:' id (has), that card keeps its id.
 * @param {string} lemma @param {Record<string, [string, string]>} [wordmap] @param {((id: string) => boolean) | null} [has]
 */
export function wordId(lemma, wordmap = {}, has = null) {
  const l = String(lemma).trim();
  const wm = wordmap[l] || wordmap[l.toLowerCase()];
  if (wm) return `W:${wm[0]}`;
  const legacy = `BW:${slug(l)}`;
  const cap = wordmap[l.charAt(0).toUpperCase() + l.slice(1)];
  if (cap) return has && has(legacy) ? legacy : `W:${cap[0]}`;
  return legacy;
}

/** The card id of the n-th mistake (1-based) of an exam attempt. @param {string} attemptId @param {number} n */
export const mistakeId = (attemptId, n) => `F:${attemptId}-${n}`;
