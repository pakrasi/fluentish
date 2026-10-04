# Word-list brief: German, levelled A1–C2

You are writing one slice of Igloo's German word list. It feeds a typed test: the learner sees the English word, a part-of-speech hint and the theme, and has **10 seconds** to type the German, **with the article** for nouns. Words he gets right count as "known", and the counts per level feed a readiness score. So the list must be accurate, ranked by usefulness, and levelled the way a Goethe/telc exam and a good textbook would level it.

Repo: `<repo>`. Themes: `data/words/themes.json` (use the `id`s).

## Your slice
The task message gives you a slice name (A1, A2, B1a, B1b, B2a, B2b, C1 or C2), its level, the themes you may use, and a target count. Write a JSON array to `data/words/parts/de/<slice>.json`.

## Each entry

```json
{"w": "Tisch", "art": "der", "pl": "Tische", "pos": "noun", "en": ["table"], "alt": [],
 "level": "A1", "theme": "home", "ex": "Der Schlüssel liegt auf dem Tisch.", "exen": "The key is on the table."}
```

- `w`: the lemma. Nouns are capitalized, with no article. Verbs are in the infinitive, with reflexive "sich" first ("sich freuen"). For phrases, use the fixed form.
- `art`: "der", "die" or "das" for nouns; "" for everything else. For nouns used mainly in the plural ("die Eltern", "die Leute"), set `art` to "die", `w` to the plural form, and `pl` to "".
- `pl`: the full plural form without the article ("Tische", "Häuser", "Autos"). Use "" if there is no plural (Milch, Obst). Use `null` for non-nouns.
- `pos`: noun, verb, adj, adv, prep, conj, pron, num, det, interj or phrase.
- `en`: 1–3 English glosses. The **first** is the prompt the learner sees, so make it unambiguous: "to lie (be lying down)" vs "to lie (tell lies)", "(the) bank (money)" vs "(the) bench". Don't start with "the" or "to" except where needed to disambiguate. Put that in brackets instead.
- `alt`: other German answers that are just as correct for the first gloss. That means true synonyms at the same level ("Samstag" / "Sonnabend", "Fahrrad" / "Rad", "bekommen" / "kriegen"), and Swiss or Austrian standard forms in common use ("Velo" is Swiss for Fahrrad). Nouns use the same shape as `w`, with their article as a prefix: `"alt": ["das Rad"]`. Keep it empty unless a native speaker would say the prompt equally well with the alternative.
- `forms` (optional, verbs only): principal parts, "geht · ging · ist gegangen", for strong, irregular and separable verbs.
- `level`, `theme`: as given for your slice. Pick the one best theme per word. Use "core" for function words and very general verbs, adjectives and adverbs (haben, gut, oft, weil).
- `ex` / `exen`: one short, natural sentence of 12 words or fewer that contains the word (an inflected form is fine), plus its English translation. Keep it everyday and neutral.

## Levelling and choice
- Use the level where a learner **should** be able to produce the word. The Goethe-Zertifikat Wortlisten (A1 ~650, A2 ~1,300, B1 ~2,400 cumulative) are the reference. Frequency matters, but exam topics matter too (Wohnungssuche, Arbeit, Gesundheit, Behörden at B1).
- **Rank within your slice**: order the array by usefulness, most useful first. A script later mixes in corpus frequency.
- **Spread across themes.** Every allowed theme should get words in proportion to how much that level needs it (A1 is heavy on people, food, time and core; B2 is heavy on work, society and abstract). Don't pad a theme with rare words.
- **No words that belong clearly at a lower level.** Other agents are writing those levels at the same time. If you're unsure, pick the lower level for common words and leave them out of your slice.
- **Include his words.** `data/words/seed_de.json` lists words from his Anki decks, his B1 exam app and the site's existing lexicon (with `theme_hint`). Every seed word that belongs to your level and one of your themes **must** be in your slice, and the article must match the seed's `art`. The checker enforces the article, and the final build reports any seed word nobody placed. Don't invent entries for seed words that belong to other levels.
- Standard German spelling (ß, ä/ö/ü, current reform spelling). No compound nouns that are just transparent sums unless they're high-frequency ("Hausaufgabe" yes, "Küchentischbein" no).

## Check
Run `python3 tools/check_word_part.py data/words/parts/de/<slice>.json` from the repo root. Fix every ERROR. For "also in <slice>" warnings, keep the word only if your level is right for it. Then re-run until you get 0 errors.

Work in sections (for example 100–200 words at a time, theme by theme), appending with a small Python script. That keeps you from losing track, and saves you from hand-editing one huge JSON file.

**Reply** with the path, the count and per-theme counts, how many seed words you included, and anything you're unsure about (a disputed gender, a disputed level), one line each.
