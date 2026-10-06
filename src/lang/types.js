/* The language pack: everything the grader, the detectors and the word cards know about one study language, behind
   one interface (round 3, Wave C2; ARCH-ASSESSMENT §6 "Recommended language-pack interface"). Types only; no code.

   The engines are language-neutral and take a pack:
     domain/match.js    alignment, Damerau-Levenshtein, slots, diffs and the typo policy; every word list and rule it
                        needs is the pack's (text.tokenize, grading.*, grammar.clauses / slots / lines / punctuation)
     domain/detect.js   runs pack.grammar.detectors in order; the first hit is the answer's sticky error
     domain/punct.js    the punctuation rules a Schreiben item names, with the pack's exceptions
     domain/forms.js    the word card's forms and example, from pack.grammar.forms
   lang/registry.js lists every language (full packs and metadata only) and holds the active pack; core/lang.js sets
   it from settings.language and exposes it to the app.

   Designed against German (the full pack, src/lang/de/) and checked on paper against French (elision, accents that
   carry meaning: ou/où), Hindi (Devanagari conjuncts, virama, nukta, typing in Latin) and Arabic (RTL, harakat,
   tatweel, alef variants): tests/unit/lang-contract.test.mjs holds the tokenizer and normaliser contract for all four,
   with the text-only stubs src/lang/{fr,hi,ar}/text.js. */
// @ts-check

/** @typedef {'de'|'fr'|'hi'|'kha'|'gsw'|'bn'|'es'|'it'|'pt'|'ar'} LangId  BCP-47 primary language subtag */
/** @typedef {'Latn'|'Deva'|'Beng'|'Arab'} Script  ISO 15924 */

/**
 * One typed word. The matcher compares `n` only; offsets point into the string tokenize() was given.
 * @typedef {object} Token
 * @property {string} raw    as written
 * @property {string} low    lower case (raw for a script without case)
 * @property {string} n      the comparison key: lower case, folded, marks that never carry meaning removed, spelling
 *                           variants merged (de: ä → ae, Café → cafe, gerne → gern; ar: no harakat or tatweel, one alef;
 *                           fr: accents KEPT, they carry meaning: ou ≠ où; œ → oe)
 * @property {number} len    letters (marks and digits not counted; the typo budget depends on it)
 * @property {number} start  offset of the first code unit
 * @property {number} end    offset after the last code unit
 */

/**
 * Text: what a word is and which spellings are the same.
 * Contract (tests/unit/lang-contract.test.mjs): normalize is idempotent and returns NFC; tokenize(normalize(s)) gives
 * tokens in logical order (RTL too) with s.slice(start, end) === raw, never splitting a grapheme cluster (a Devanagari
 * conjunct with virama, ZWJ or ZWNJ, a letter with its marks); script punctuation (। ، ؟ « ») is never part of a token;
 * fold is idempotent.
 * @typedef {object} TextRules
 * @property {(s: unknown) => string} normalize   NFC and one apostrophe (’ ʼ → '); fr: no-break spaces; hi: nukta forms
 * @property {(s: unknown, offset?: number) => Token[]} tokenize   the words of a normalised string; fr: elision splits
 *                                                 (l'ami → l' ami, qu'il → qu' il; aujourd'hui is one word)
 * @property {(s: unknown) => string} fold         the language's own transcription of letters a keyboard may lack,
 *                                                 keeping case (de: ä → ae, ß → ss; fr: œ → oe; hi/ar: none)
 * @property {RegExp} wordRe                       one word, global (what tokenize matches), for String.replace
 */

/**
 * Typing in another script (Hindi, Bengali and Arabic learners type Latin).
 * @typedef {object} InputRules
 * @property {boolean} acceptsTransliteration
 * @property {(latin: string) => string[]} [transliterate]   candidate spellings in the pack's script ('kya' → ['क्या'])
 */

/**
 * A letter that is the same letter with or without a mark (de: ä/a/ae; fr: é/e). Typing the plain letter is a slip
 * (the answer is right, rated Hard; the result lists it in umlautMiss) unless the plain spelling is another word
 * (grading.minimalPairs, or a word of the lexicon). Typing a mark that is not there is always a miss.
 * @typedef {object} MarkSlip
 * @property {(s: string) => string} base                       every spelling of a marked letter as one plain letter
 * @property {(typed: string, expected: string) => boolean} dropped   typed is expected with its marks left out
 */

/**
 * The typo policy's language knowledge (domain/match.js). Every word is a lower-case folded key (Token.n), except
 * minimalPairs (lower case, as typed).
 * @typedef {object} GradingRules
 * @property {ReadonlySet<string>} closedClass       articles, pronouns, prepositions, auxiliaries: another one is a
 *                                                   grammar mistake, never a typo; they get 0 edits
 * @property {readonly string[]} articles           what may stand before a noun (a wrong or missing one: articleMiss)
 * @property {readonly string[]} endings            inflectional suffixes, longest first: a typo keeps them identical
 * @property {(a: string, b: string) => boolean} isFormChange   one edit between two stems that is a grammatical form
 *                                                   (de: ablaut, e→i, ie/e, ie/ei), never a typo
 * @property {ReadonlySet<string>} soundAlikes       real words that sound like another (de: wider/wieder): never a typo
 * @property {ReadonlySet<string>} minimalPairs      words whose mark-less spelling is another word (de: konnte/könnte;
 *                                                   fr: ou/où, a/à): a dropped mark there is a miss
 * @property {{marks: MarkSlip | null}} slips        the slips a pack forgives as Hard (de: the umlaut)
 * @property {'nouns'|'none'|'proper'} caseSensitive  which capitals count (de: nouns; hi, ar: none)
 * @property {RegExp} [sentenceStart]                what ends the text before a sentence's first word, whose capital is
 *                                                   free (default: . ! ? : and one opening quote; fr: « » between)
 * @property {(toks: Token[], i: number) => boolean} eitherCase   a word written either way (de: recht/Recht haben)
 * @property {readonly RegExp[]} paradigms           closed-class families (der/den/dem …): another member is the same
 *                                                   word in another form (formCheck)
 * @property {(typed: string, want: string) => boolean} [prefixSwap]  keys: the typed word is the pattern word with
 *                                                   another prefix (de: gedroht for bedroht), never a typo
 */

/** @typedef {{clause: string, order: string, sein: boolean, haben: boolean}} Shape  a pattern's clause structure */
/**
 * Clause structure: which accepted patterns are interchangeable in a sentence (restCheck, alsoLines).
 * @typedef {object} ClauseRules
 * @property {ReadonlySet<string>} subordinators     words that open a subordinate clause
 * @property {(keys: string[]) => Shape} shape       the shape of a pattern's words (Token.n)
 * @property {(a: Shape, b: Shape) => boolean} same  two patterns may stand in for each other
 */
/**
 * Which slot words may move between patterns (restCheck).
 * @typedef {object} SlotRules
 * @property {ReadonlySet<string>} helpers       verbs that do not govern the slot's words (modals, werden, zu)
 * @property {ReadonlySet<string>} prepositions
 * @property {ReadonlySet<string>} adverbs       stand anywhere in a clause
 * @property {RegExp} timePhrase                 a time phrase (folded): moves freely
 * @property {ReadonlySet<string>} particles     words that only add emphasis: may be added, dropped or swapped in a slot
 */
/**
 * When an "also correct" line cannot be written faithfully from the model (alsoLines).
 * @typedef {object} LineRules
 * @property {ReadonlySet<string>} questionStarts   a line starting with one is a question
 * @property {ReadonlySet<string>} determinerLike   after one, an unknown word may be a noun in lower case
 * @property {ReadonlySet<string>} openers          a standalone line starting with one starts a sentence
 * @property {ReadonlySet<string>} polite           polite or not is known only from the model (de: Sie/sie)
 * @property {ReadonlySet<string>} interjections    run into the next word, they need a comma
 * @property {ReadonlySet<string>} contractions     a word after one is a noun (de: fürs Zuhören)
 * @property {string} contrast                      a word that needs a comma before it inside a line (de: aber)
 */
/**
 * Punctuation: the comma rules the grader writes into "also correct" lines, and the Schreiben rules' exceptions.
 * @typedef {object} PunctRules
 * @property {ReadonlySet<string>} commaWords    clause words that take the model's comma before them (folded)
 * @property {(text: string) => string} clauseCommas   commas before a main clause after an opinion verb, or an infinitive group
 * @property {(text: string) => string} subCommas      commas before a subordinate clause
 * @property {ReadonlySet<string>} beforeOk     words after which a subordinator needs no comma (und weil, so dass)
 * @property {ReadonlySet<string>} politeCaps   capitalised forms that may start a line in lower-case position (Sie)
 * @property {(w: string) => string} nounKey    a word's key in a noun table (lower case, folded)
 */

/** @typedef {{cls: string, word: string}} OrderHit */
/**
 * What a detector sees. memo: shared work between the detectors of one run (de: the word-order pass).
 * @typedef {object} DetectContext
 * @property {string} text  @property {string} model  @property {any} item  @property {any} r  the Match.check result
 * @property {Set<string> | null} verbs  finite verb forms from the word list
 * @property {Conj | null} [conj]  the verb forms index (VerbRules.build), when the caller has one
 * @property {Map<string, any>} memo
 */
/**
 * A sticky-error detector (pluggable, optional). The runner returns the first hit, in pack order.
 * @typedef {object} Detector
 * @property {string} cls
 * @property {(ctx: DetectContext) => {word: string, hint: string} | null} find   (word: the word to name; de fuer-vor: null at the start)
 */
/**
 * The word-order checks a reference implementation mirrors (de: tools/validate_b1.py detect()).
 * @typedef {object} WordOrderRules
 * @property {(text: unknown, model: unknown) => string[]} classes   sorted classes, for the parity test
 * @property {(s: unknown) => string} norm
 * @property {(words: any[] | null | undefined) => Set<string>} verbForms   finite verb forms of a word list
 * @property {() => string[]} fronted          @property {(list: string[]) => void} setFronted
 */

/**
 * Grammatical gender, when the language has it.
 * @typedef {object} GenderRules
 * @property {string[]} values                      'm', 'f', 'n'
 * @property {Record<string, string[]>} articles   gender → its articles in citation form (m: der, ein)
 * @property {string[]} citation                   the definite articles in content order (der, die, das): word types
 *                                                 on the map and the atlas's article column
 * @property {(s: string) => string} toIndefinite  "der Tisch" → "ein Tisch"
 * @property {string[]} [elided]                   fr: l'
 */

/**
 * Word formation for content checks (domain/clusters.js) and the map.
 * @typedef {object} MorphologyRules
 * @property {ReadonlySet<string>} inseparable     prefixes that never separate
 * @property {ReadonlySet<string>} prefixes        every prefix a morph entry may use
 * @property {ReadonlySet<string | null>} prepCases  the cases a preposition note may name
 * @property {string[]} notHeads                   word ids that must never head a family
 * @property {[string, string][]} notIn            known false families [word id, family]
 * @property {LemmaFn} [lemma]                     a token's dictionary form in its sentence (round 4, optional; de:
 *                                                 separable particles joined across the clause, participles,
 *                                                 compounds). Readers check for it and fall back to the token's key
 * @property {(words: WordEntry[]) => WordIndex} [index]   the word list indexed for lemma() and lookup() (de: forms,
 *                                                 plurals and verb forms; articles stripped)
 * @property {LookupFn} [lookup]                   one word against the word list, with its entry (Scripts' lemma:
 *                                                 the word sheet, suggestions and card ids)
 */

/**
 * A token of running text (domain/text/tokens.js): words and the punctuation between them.
 * @typedef {object} TextToken
 * @property {string} t      the text as written (with its punctuation for non-word tokens)
 * @property {boolean} w     a word (letters or digits)
 * @property {number} k      word index in the sentence (-1 for punctuation)
 * @property {boolean} [num] a number
 * @property {boolean} [sp]  a space comes before it
 */

/**
 * One entry of a word list (content igloo.words.<lang>).
 * @typedef {object} WordEntry
 * @property {string} id @property {string} w @property {string} [art] @property {string | null} [pl] @property {string} pos
 * @property {string[]} [en] @property {string} level @property {string} [forms] @property {string[]} [alt] @property {number} [zipf]
 */
/**
 * A word list indexed by every written form it lists (lower case).
 * @typedef {{forms: Map<string, WordEntry[]>, lemmas: Map<string, WordEntry[]>, words: WordEntry[]}} WordIndex
 */
/**
 * A word's lemma against the word list.
 * @typedef {object} LemmaInfo
 * @property {string} lemma           dictionary form ('Schnittstelle', 'anstoßen')
 * @property {WordEntry | null} entry the word-list entry when the lemma is listed
 * @property {'list' | 'form' | 'rule' | 'prefix' | 'compound' | 'guess'} how
 * @property {WordEntry | null} [part]  for a compound: its listed last part
 * @property {boolean} [guess]       a local guess to confirm before a card is made (unknown word, an adjective ending
 *                                   stripped, or a listed word that is also a verb form)
 */
/**
 * One word against the word list. start: the word starts its sentence (its capital says nothing); prev: the word
 * before it, lower case.
 * @typedef {(surface: string, idx: WordIndex, o?: {start?: boolean, prev?: string}) => LemmaInfo} LookupFn
 */

/**
 * A token's lemma candidates in context, best first ([] when unknown). index: the token's place in sentence. idx:
 * the word list (morphology.index); without it only the rules that need no list apply.
 * @typedef {(token: TextToken, sentence: TextToken[], index: number, idx?: WordIndex) => string[]} LemmaFn
 */

/**
 * What reading needs to know about a language (round 4, optional; domain/text/ engines take it per call).
 * @typedef {object} ReadingRules
 * @property {ReadonlySet<string>} stop              function words a reader never offers to save (folded keys)
 * @property {RegExp | null} cognate                 a word that is the same in English (shown, not suggested)
 * @property {Record<string, string>} spelling       older spellings → modern (de: daß → dass), for public-domain texts
 * @property {{id: string, concept: string | null, test: (sentence: TextToken[]) => boolean}[]} constructions
 *                                                   constructions the level estimate looks for (de: Konjunktiv I …)
 * @property {(token: TextToken, sentence: TextToken[], index: number) => boolean} [foreign]   a word from another
 *                                                   language (de: English letter patterns and English function words)
 * @property {ReadonlySet<string>} [foreignWords]    lower-case function words of that language that are not words of
 *                                                   this one: a capitalised unknown word beside one is part of a name
 * @property {ReadonlySet<string>} [abbreviations]   lower-case abbreviations a full stop does not end a sentence after
 */

/**
 * What conversation practice needs from a language (round 4, optional). Prompts are English with slots; these fill them.
 * @typedef {object} ConversationRules
 * @property {string} language                       the language's English name in prompts ('German')
 * @property {Record<string, string>} register       register id → how to address the learner ({du: 'du', sie: 'Sie'})
 * @property {string[]} connectors                   connectors debate practice uses and invites
 * @property {string[]} chips                        helper phrases offered under the composer ('Wie sagt man …?')
 * @property {string} [example]                      one example line in the language for the system prompt
 */

/**
 * The word card's forms (the assessment's VerbFormModel; de: src/lang/de/forms.js). Shapes as domain/forms.js documents.
 * @typedef {typeof import('./de/forms.js')} FormsModel
 */

/**
 * @typedef {object} GrammarRules
 * @property {GenderRules | null} gender
 * @property {string[] | null} cases
 * @property {FormsModel} forms
 * @property {Detector[]} detectors
 * @property {WordOrderRules | null} wordOrder
 * @property {PunctRules} punctuation
 * @property {ClauseRules} clauses
 * @property {SlotRules} slots
 * @property {LineRules} lines
 * @property {MorphologyRules | null} morphology
 * @property {VerbRules} [verbs]   the verb forms of a word list and the frames that decide them (de: src/lang/de/conj.js)
 */

/**
 * Verb forms (round 4): an index of every verb's forms by slot, built from a word list, and where a typed sentence puts
 * the model's verb in a form the model's frame does not allow.
 * @typedef {object} VerbRules
 * @property {(words: any[] | null | undefined, table?: any, extra?: Iterable<string>) => Conj} build
 * @property {(A: Token[], B: Token[], textB: string, conj: Conj | null | undefined) => {a: number, b: number, kind: string}[]} clashes
 * @property {(texts: Iterable<string>, skip: (n: string) => boolean) => Set<string>} infinitives
 * @property {(text: string, T: Token[], conj: Conj) => {lemmas: Set<string>, slots: Set<string>}[]} frameSlots   each
 *   word's lemmas and the slots its sentence gives it
 * @property {ReadonlySet<string>} frameOpt   optional pattern words the sentence decides, kept as the model has them
 *   (de: zu in "bedarf ([x]) (zu) decken")
 */
/**
 * @typedef {object} Conj
 * @property {(n: string) => {lemma: string, slot: string, strong: boolean}[]} lookup   a key's analyses
 * @property {(n: string) => boolean} misbuilt   a non-word made from a strong verb with the regular endings (fallten)
 * @property {() => IterableIterator<string>} forms   every key of the index
 * @property {Map<string, any>} lemmas
 */

/**
 * @typedef {object} SpeechRules
 * @property {{locales: string[], prefer: RegExp | null, avoid: RegExp | null}} tts   monolingual voices only
 * @property {{locale: string} | null} asr          null: no recognition (Khasi)
 */

/**
 * What every language has, full pack or not (lang/registry.js; checked against content/manifest.json languages).
 * @typedef {object} LanguageMeta
 * @property {LangId} id
 * @property {string} legacyId      settings.language and the manifest's id ('german')
 * @property {string} name          @property {string} native
 * @property {string} bcp47         @property {Script} script   @property {'ltr'|'rtl'} dir
 * @property {{prompt: string, ui: string}} fonts   CSS font stacks (styles/tokens.css)
 * @property {SpeechRules} speech
 * @property {boolean} full         a full pack: this build can grade the language
 */

/**
 * A pack's content ids (content/manifest.json). read and conversation (round 4) are optional: graded texts
 * (readers@1, 'read.<lang>') and conversation topics and scenarios ('conversation.<lang>').
 * @typedef {Record<string, string> & {read?: string, conversation?: string}} PackContent
 */

/**
 * A full language pack. reading and conversation (round 4) are optional: a feature that needs one checks for it and
 * offers nothing for a language without it (tests/unit/lang-contract.test.mjs: a pack is valid without them).
 * @typedef {LanguageMeta & {
 *   text: TextRules, input: InputRules, grading: GradingRules, grammar: GrammarRules,
 *   reading?: ReadingRules, conversation?: ConversationRules,
 *   exams: string[], content: PackContent
 * }} LanguagePack
 */

export {};
