# Newsreader, as the Explore map's font (vendored, modified)

The typographic map in Explore (`src/features/explore/`) draws every German word on a canvas, at positions computed
at build time (`tools/build-atlas.mjs`). The positions are only stable if every device measures a word exactly as the
build did, so the map draws with its own copy of Newsreader whose widths are known in advance.

- Source: the variable fonts `Newsreader[opsz,wght].ttf` and `Newsreader-Italic[opsz,wght].ttf` from
  github.com/google/fonts, `ofl/newsreader`. SIL Open Font License 1.1 (OFL.txt in this folder).
  - sha256 `8a08d13f8a6c0d51be379a60af84f945f65369a67e509ee3c3bdcc421254d7c1` (regular)
  - sha256 `796668611f80b64d5adf182fde3b6f29ed83b4e7cbec7b96937e84ac01364792` (italic)
- Built by `tools/build_map_font.py`: static instances at weight 400 and optical size 16; subset to Latin-1 plus German
  quotes, dashes, the ellipsis and the euro sign; **all OpenType layout features removed** (no kerning, no ligatures),
  so a word's drawn width is the sum of its advance widths; hinting removed; WOFF2.
- Renamed **Fluentish Map** (a modified version under the OFL takes a name of its own), declared with `@font-face` in
  `styles/features/explore.css`. The rest of the app keeps Newsreader from Google Fonts.

| File | sha256 |
|---|---|
| map-regular.woff2 | 59c148f3d91e68f61eaa6e3c08435ff90c8e56200061a8155c4164cde698b0e4 |
| map-italic.woff2 | 756296ae0da257a80534b3657ab07ceb3caa6134c833a1bee726e4fb45ff3c27 |
| metrics.json | the advance widths (font units, `unitsPerEm` 2000) per character, read by tools/build-atlas.mjs and src/domain/atlas.js |

To update: download the two variable fonts, run the script, rebuild the map (`node tools/build-atlas.mjs --repack`),
and look at Explore at 390 px and 1440 px. A new width table moves words, so it is a map release, like a repack.
