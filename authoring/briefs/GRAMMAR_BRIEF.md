# Grammar pool brief

How to build the typed grammar test pool for one language. German (`de`) is the reference.

## Files

- `data/grammar/concepts_<lang>.json`: array of concepts.
  `{"id","name","category","level","description","fritz","sticky"?}`
  - `id` is kebab-case ASCII (`konjunktiv-2-wuerde`). Never rename an existing id.
  - `level` is one of A1, A2, B1, B2, C1. No "?".
  - `fritz` is the learner's evidence from Fritz, or `null` for concepts added by hand.
  - `"sticky": true` marks the learner's persistent errors.
- `data/grammar/items_<lang>.json`: array of typed items.
- `tools/validate_grammar.py <lang>`: must print OK before shipping.

## Item shape

```json
{"id":"praeteritum.01","concept":"praeteritum","level":"B1","kind":"transform",
 "task":"Rewrite in the Präteritum.","prompt":"Ich habe keine Zeit.",
 "answer":["Ich hatte keine Zeit."],"note":"haben → hatte.","strict_case":false}
```

- `id` = `<concept>.<NN>`, two digits, unique.
- `level` equals the concept's level.
- `kind`: `transform`, `gap`, `join`, `choose-article`, `order`, `translate`. Use a mix.
- `task`: short English instruction naming the operation ("Rewrite in the Perfekt.", "Join the two sentences with the word in brackets. Keep the order."). Never name the rule ("verb goes to the end").
- `prompt`: target-language text. Words to inflect go in brackets: `Ich warte ___ den Bus.`, `mit ___ Kollegin (die)`.
- `answer`: non-empty list of distinct strings.
- `note`: one line shown after answering; this is where the rule goes.
- `strict_case`: true only for capitalization items.

## Counts

| Level | Items per concept |
| --- | --- |
| A1–B1 | 8–12 |
| A1–B1, sticky | 14–16 |
| B2 | 12 or more (round 4: `B2_BRIEF.md`) |
| C1 | exactly 8 |

A concept counts as known at 80% or more correct across at least 8 items, so every concept needs 8 or more.

## Answers

- Gap: only the missing word(s). Transform, join, order: the full sentence.
- The checker ignores case (unless `strict_case`), extra spaces, final punctuation, and ae/oe/ue/ss for ä/ö/ü/ß. Do not list variants that differ only in those.
- List every variant a native speaker would accept, including word-order variants and synonyms that fit (`deshalb/deswegen/darum/daher`). Never list wrong answers.
- Keep the accepted set small by constraining the prompt instead: give the first words for order items ("Start with „Morgen“."), say "Keep the order" for joins, name the modal or connector to use, restrict gap choices in the task ("Fill the gap with „für“ or „vor“.").
- Translate items: short, concrete sentences with few possible renderings. List du/Sie/ihr versions when the English "you" is open.

## Content

- Everyday, neutral topics. Natural sentences. Vocabulary at or below the item's level for A1–B1.
- No grammar hints inside prompts (no "(Verb ans Ende)"). Brackets only for the word to inflect or the connector to use.
- Sticky errors get extra items and recur in related concepts (German: dass-clause verb-final order, für vs vor, noun capitalization, neuter -ma nouns and nominalised verbs).

## Workflow

Write items concept by concept with a small script that replaces that concept's items in the JSON (so re-running is safe), then run the validator until it prints OK.
