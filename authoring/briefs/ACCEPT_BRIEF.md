# Accepted answers brief: typed phrase test

Igloo's Test view shows an English sentence with one phrase highlighted. The learner types German and is graded **only on the highlighted phrase**. Today the check compares the whole sentence against one stored translation, so correct answers in a different register or wording fail. You write the list of German patterns that count as correct for each phrase.

Repo: `<repo>`.

## Inputs
- `data/chunks/en.json`: English phrases (`chunk`, `natural_example`, `category`, `pragmatic_function`, `level`).
- `data/chunks/<lang>.json`: this language's translations. `t` is the phrase, with variants separated by " / " and slot names in brackets. `ex` is a translated example sentence, and `n` a note.

## Output
Write `data/chunks/accept/<lang>/<part>.json` as an object keyed by phrase id:

```json
{
  "ENG_CHUNK_1017": {
    "core_en": "could you say that again?",
    "accept": [
      "(entschuldigung) könnten sie das (bitte) (noch mal) wiederholen",
      "können sie das (bitte) (noch mal) wiederholen",
      "kannst du das (bitte) (noch mal) wiederholen",
      "kannst du das (bitte) noch mal sagen",
      "wie bitte",
      "noch mal bitte"
    ]
  }
}
```

- **`core_en`** is the exact span of the English `natural_example` that the phrase covers, copied verbatim (case can differ). It gets highlighted, so it must be a substring of the example. For "I was wondering if you could [base-verb]" with the example "I was wondering if you could give me a hand with this.", core_en is "I was wondering if you could". Leave the slot filler outside the span unless the phrase is meaningless without it. For fixed phrases, it's the whole phrase as it appears.
- **`accept`**: 2–8 German patterns. Any one appearing anywhere in the learner's answer counts as correct. Answer text outside the pattern isn't graded.

## Pattern syntax
- **Case and punctuation are ignored**, and ae/oe/ue/ss equal ä/ö/ü/ß. So write patterns lowercase without punctuation, or with it; either works. Typos are tolerated word by word by the checker, so **don't** add misspellings.
- **`(word)`** marks optional words. Use it for fillers a speaker may drop or add: bitte, mal, noch mal, denn, doch, eigentlich, vielleicht, gerne/gern, einfach, kurz, das (as object), ja, schon, auch.
- **`[anything]`** marks a slot, which matches 1–6 words. Use it where the English has a slot. Keep slots out of pattern edges when a fixed word must follow, and never write a pattern that is only a slot.
- A pattern must keep the words that carry the phrase's meaning. Don't reduce it to one generic word that would accept almost anything ("ja", "gut", "das").

## What to accept
1. **Both registers.** Add du **and** Sie versions (and ihr where natural) of every phrase addressed to someone. The only exception is phrases where the situation fixes the register (formal letters, "Sehr geehrte …", addressing an official): accept just that register, but still add the other if a native speaker might write it.
2. **Common real alternatives**: the variants in `t`, plus the other ways native speakers say it at a similar level, with near-equal meaning and the same function. E.g. "Mach's gut" / "Pass auf dich auf" / "Bis dann". Don't add something with a different function.
3. **Word order variants** where German allows them (a fronted adverb, Nebensatz vs Hauptsatz where both are natural).
4. **Colloquial spoken forms** that are standard in speech: "hab" for habe, "noch mal"/"nochmal", "'s" for es, "gibt's", "kannste" (no dialect beyond that).
5. **The translated example `ex` must match at least one pattern.** The validator checks this. If it fails, add the pattern that covers it. Don't edit the translation file.
6. Put the pattern that best matches `t` **first**. It's shown as the model answer if the learner is wrong.

## Check
Run `python3 tools/validate_accept.py <lang> <part>` until there are 0 errors. Write each part with a small Python script in batches (e.g. 50 ids at a time), not by hand-editing one big file.

Reply with the phrase count, the average number of patterns per phrase, and any phrases where one clear correct set was hard to pin down.
