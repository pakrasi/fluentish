# Brief: write data/<lang>.json for one language

You are filling one language's content for a static language-learning website called "Doors and Glue". The site has one language-neutral master file, `data/framework.json`, and one file per language. Your job is the language file. Read the master first: `cat data/framework.json` (it is ~60KB; read it all).

## The framework in one paragraph

A **door** is a verb frame with one open slot ("I want to ___"). A **turn** rotates a door through time, polarity and mood. **Glue** is connectors and prepositions plus the word-order rule each triggers. **Slot grammar** is what happens inside the slot (pronouns, articles, gender, case, agreement). **Functions** are what you are doing (decline, suggest, complain). **Chunks** are fixed phrases with no slot. **Lexicon** is topic vocabulary. **Sound** is pronunciation and listening. A CEFR level is a slice through all layers. A **scenario** is a situation plus a task; the learner must produce one or two sentences, then compares with a model answer that is broken into colour-coded blocks by layer.

## Output file

Write `data/<lang>.json` (lang id from `framework.json.languages[].id`). UTF-8, valid JSON. Shape:

```json
{
  "lang": "german",
  "name": "German",
  "native": "Deutsch",
  "notes": {
    "variety": "Which variety and register this file teaches, and why (2-4 sentences).",
    "turns": "How this language carries tense and aspect compared with English: which cells of the turn grid exist, which are missing, what substitutes for them (4-8 sentences).",
    "wordOrder": "The word-order rules a learner must know, especially what doors and glue do to it (3-6 sentences).",
    "slotGrammar": "Gender, case, articles, agreement, in the order a learner meets them (3-6 sentences).",
    "sound": "The 3-5 sounds or prosodic features an English speaker gets wrong, and the script if non-Latin (3-6 sentences).",
    "register": "Formal vs informal address (tu/vous, du/Sie, आप/तुम etc.) and how it changes chunks (2-4 sentences)."
  },
  "turnGrid": [
    {"time": "past", "aspect": "simple", "form": "ich ging / ich bin gegangen", "translit": "", "gloss": "I went", "note": "Spoken German uses the Perfekt; the Präteritum is written."}
    // exactly 9 cells: time in past|present|future x aspect in simple|progressive|perfect, all for the GO door, first person singular.
    // If a cell does not exist as a form, put the substitute in "form" and say so in "note". Never leave form empty.
  ],
  "items": [
    {
      "id": "D-WANT",                       // every id in framework.items, no extras, no omissions
      "target": "ich will ___ / ich möchte ___",   // the chunk in the target language; keep ___ for the slot
      "translit": "",                       // required for hindi, bengali, arabic; omit or "" for latin-script languages
      "gloss": "I want ___ / I would like ___",    // literal English
      "example": {"target": "Ich möchte Deutsch lernen.", "translit": "", "gloss": "I would like to learn German."},
      "note": "wollen is a modal: no zu, infinitive goes to the end of the clause. möchte is the polite default.",
      "star": true                          // true for the 30-70 items a learner should memorise first (weight towards A1-B1 doors, chunks, glue)
    }
  ],
  "scenarios": [
    {
      "id": "SC-A2-01",                     // every id in framework.scenarios
      "model": {"target": "Danke, aber ich kann leider nicht kommen, weil ich arbeiten muss.", "translit": "", "gloss": "Thanks, but unfortunately I can't come, because I have to work."},
      "breakdown": [                         // the model split into blocks; texts joined (ignoring spaces) must equal model.target exactly
        {"text": "Danke, aber", "layer": "chunk", "id": "C-THANKS-BUT", "label": "C-THANKS-BUT"},
        {"text": "ich kann leider nicht", "layer": "door", "id": "D-CAN", "label": "D-CAN · pres · neg"},
        {"text": "kommen,", "layer": "filler", "label": "slot: V"},
        {"text": "weil", "layer": "glue", "id": "G-BECAUSE", "label": "G-BECAUSE · verb-final"},
        {"text": "ich arbeiten", "layer": "filler", "label": "slot: V"},
        {"text": "muss.", "layer": "door", "id": "D-HAVE-TO", "label": "D-HAVE-TO · closes clause"}
      ],
      "keys": ["kann", "nicht", "weil", "muss"],   // 2-5 substrings the learner's attempt should contain; each must appear verbatim in model.target
      "alt": "Das ist lieb, aber Freitag geht leider nicht. Ich muss länger arbeiten.",   // a second natural answer, different structure
      "tip": "One sentence on the trap: e.g. weil sends the conjugated verb to the end; denn would not."
    }
  ]
}
```

### Layer-specific rules for `items`
- **door / chunk / glue**: `target` is the chunk with `___` for the slot. `example` is a full natural sentence using it. `note` says the word-order or case rule and the most common learner error. Put verb+preposition and case information in `note`.
- **turn**: `target` is the form pattern (e.g. "haben/sein + Partizip II"), `example` one sentence, `note` what the tense actually means in this language if it differs from English.
- **slot**: `target` is the paradigm in compact form (e.g. "ich, du, er/sie/es, wir, ihr, sie/Sie"), `example` one sentence, `note` the rule. If the feature does not exist (e.g. gender in Khasi is different, articles in Hindi), say so in `target` ("not applicable: ...") and use `example` to show what the language does instead.
- **function**: `target` is the 1-2 most useful chunks for that function, separated by " / ". `example` one exchange or sentence. `note` which items (by id) the recipe usually uses.
- **lexicon**: `target` is a comma-separated list of 12-16 core words for that topic with gloss in parentheses each, e.g. "der Bahnhof (station), die Fahrkarte (ticket), ...". No example needed. `gloss` can be the topic name.
- **sound**: `target` names the features, `gloss` explains for an English speaker, no example needed.
- Register: where the language has formal/informal address, show the informal form first and the formal after " / " when the chunk differs.

### Scenarios
- Model answers must be natural, spoken-register, level-appropriate, and must use the recipe items listed in the framework for that scenario (at least the doors and glue). One to three sentences.
- Breakdown blocks: use layer `door`, `glue`, `chunk`, `turn` for pieces that correspond to framework items (set `id`); use layer `filler` for slot contents and other words (no `id`). Punctuation attaches to the neighbouring block. The concatenation check is strict: copy the text exactly.
- `label` is short: the id plus optional turn annotation like "· past · neg".
- For non-Latin scripts, `translit` on model is required; breakdown text stays in native script.

### Length limits (the site shows cards at a glance; long text is a bug)
- `note`: at most 2 short sentences, under 220 characters. One rule or one trap, not both.
- `example.target`: one sentence, under 90 characters. `gloss` under 90 characters.
- `target` chunk: under 70 characters; give at most two alternatives separated by " / ".
- Scenario `model.target`: one or two sentences, under 160 characters. `tip`: one sentence.
- `notes.*`: keep to the sentence counts given above.

### Quality bar
- Write as a native-speaker teacher would. No machine-translation stiffness. Prefer what people actually say over textbook forms, and say so in notes when they differ (e.g. Hindi spoken forms, Arabic MSA vs Levantine, Brazilian vs European Portuguese).
- Every note must teach something: a rule, a trap, or a contrast with English. No filler like "This is commonly used."
- Non-Latin scripts: translit is for reading aloud, not scholarly. Hindi/Bengali: simple roman with long vowels marked by doubling or macron consistently. Arabic: standard chat-style or DIN-like, consistent within the file.
- Arabic: forms in MSA; in `note` give the Levantine spoken equivalent when it differs (e.g. "بدي" for "أريد"). Mark "rtl" is handled by the site, do nothing special.
- Khasi: this is a low-resource language. Use the standard Sohra-based written Khasi (as in Khasi textbooks and the Bible translation orthography). Be conservative: prefer forms you are confident are correct; for advanced C1 rhetorical doors that Khasi expresses differently, describe the Khasi strategy in `target` and give a real sentence. Gender markers (u/ka/i/ki) are central to slot grammar; treat them carefully.
- Do not invent items or scenarios. Cover all 284 items and all 30 scenarios.

## Validate before you finish
Run `python3 tools/validate.py data/<lang>.json` and fix every reported problem. Repeat until it prints OK. Do not report done until it prints OK. Then reply with: the validator's OK line, the star count, and 3-5 sentences on any judgement calls (variety, register, items where the language has no direct equivalent).

Write the file with a single Write call if possible (it will be 80-150KB). If you must build it in parts, assemble with a small Python script and delete the parts.
