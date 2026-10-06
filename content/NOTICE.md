# Content sources and licences

What the content in this folder is made from, and under which terms. Everything not listed here was written for this
app (the phrase bank, grammar items, word glosses and examples, Schreiben material, the B2 layer and the graded texts
marked `"licence": "own"`) and is part of this repository.

## Word frequencies (`zipf` in `igloo/words/*.json`)

The `zipf` value of a German word is its frequency on the Zipf scale as computed by
[wordfreq](https://github.com/rspeer/wordfreq) by Robyn Speer (version 3.x; for a phrase, the lowest value of its
words). The values were computed for Igloo's word list (its `scripts/build_words_de.py`) and carried over to this app;
the round 4 B2 words were computed the same way.

- wordfreq's code is licensed under the Apache License 2.0.
- wordfreq's data is licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). It is built from
  many corpora (among them Wikipedia, film and TV subtitles, news, books and web text), listed with their own terms in
  wordfreq's README.
- This app uses only the numbers (one value per word), rounded to two decimals, to order and level words. Credit:
  "Word frequencies from wordfreq by Robyn Speer, CC BY-SA 4.0." No wordfreq word list or text is copied. If the numbers
  are redistributed as a data set of their own, CC BY-SA 4.0 applies to that set.

## Graded reading texts (`read/<lang>.json`)

Each text names its licence; the validator accepts only these:

- `own`: written for this app.
- `PD`: in the public domain. The German texts by Franz Kafka (1883–1924) come from *Ein Landarzt. Kleine Erzählungen*
  (Kurt Wolff Verlag, 1919/1920), transcribed by Project Gutenberg (eBook #21989,
  https://www.gutenberg.org/ebooks/21989). The text is reproduced unchanged, in its original spelling. The English
  sentences beside it are this app's own translations; no published translation was used.
- `CC-BY-4.0`: a text under Creative Commons Attribution 4.0, with its author and source named in the text's `source`.

## References used for checking only

The Goethe-Institut and telc word lists for B1 and B2, *Profile deutsch*, Duden and DWDS were used to check levels,
genders, plurals, verb forms and usage. Nothing was copied from them.

## Audio

No synthesised audio is published for the graded texts. The app reads them with the device's own voice.
