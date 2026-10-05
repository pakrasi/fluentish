# The 3D map's text atlas (generated from the vendored map font)

The 3D view in Explore (`src/features/explore/palace/`) draws every word as instanced quads that sample a signed
distance field (SDF), so type stays crisp at any angle and distance. This folder holds that field, prebuilt.

- Source: the map font in `src/vendor/newsreader-map/` (Newsreader, SIL Open Font License 1.1, renamed Fluentish Map;
  see that folder's VENDOR.md and OFL.txt). This atlas is a rendering of that font and carries the same licence.
- Built by `tools/build_palace_atlas.py` (fonttools, brotli, numpy): every glyph of both styles, regular and italic
  (398 glyphs), its outline read from the WOFF2, curves flattened, and every pixel's exact distance to the outline
  measured, the sign from the nonzero winding rule. No rasteriser is involved, so a rebuild is byte-identical
  (`python3 tools/build_palace_atlas.py --check`).
- Encoding: 40 px per em, value = 1 − (d / 8 + 0.25) with d in pixels, positive outside; the outline is at 0.75.
- `atlas.json`: per style (`r`, `i`) and character: x, y, width, height in the PNG (y from the top), then the cell's
  plane bounds left, bottom, right, top in em. Advance widths are not here: the 3D view uses
  `src/vendor/newsreader-map/metrics.json`, the table the Atlas was laid out with, so type sits exactly where the 2D
  map puts it.

| File | sha256 |
|---|---|
| atlas.png | 724dadf7f76ca0fe5dce74c5285ce55c1239595e78e6afc8ca179ff8524cd871 |
| atlas.json | 0f0ea57f311527ce5b271daa14b715d3f8859f85f8d7794f9958bd888a257eb7 |

To update: change the font (a map release, see newsreader-map/VENDOR.md), run the script, update the hashes above, and
look at Explore › 3D at 390 px and 1440 px. `tests/unit/palace.test.mjs` checks the hashes and that every character
of the font is in the atlas.
