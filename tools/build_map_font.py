#!/usr/bin/env python3
"""Builds the Explore map's font: Newsreader as two static instances (regular and italic, weight 400, optical size 16),
subset to Latin-1 and German punctuation, with NO layout features (no kerning, no ligatures). Without features a
word's drawn width is exactly the sum of its glyphs' advance widths, so the advance table this script writes
(metrics.json) is the width table tools/build-atlas.mjs lays the map out with, and every device breaks the same lines.

  python3 tools/build_map_font.py <Newsreader[opsz,wght].ttf> <Newsreader-Italic[opsz,wght].ttf>

Needs fonttools and brotli (pip install fonttools brotli). The sources are the variable fonts from
github.com/google/fonts (ofl/newsreader), SIL Open Font License 1.1. Output: src/vendor/newsreader-map/."""
import hashlib, json, os, sys
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools import subset

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'src', 'vendor', 'newsreader-map')
OPSZ, WGHT = 16, 400
CHARS = [*range(0x20, 0x7F), *range(0xA0, 0x100), 0x2013, 0x2014, 0x2018, 0x2019, 0x201A, 0x201C, 0x201D, 0x201E, 0x2026, 0x20AC]
FAMILY = 'Fluentish Map'


def build(src, style):
    font = TTFont(src)
    font = instancer.instantiateVariableFont(font, {'wght': WGHT, 'opsz': OPSZ})
    opts = subset.Options()
    opts.layout_features = []          # no kern, no liga: width = sum of advances
    opts.name_IDs = [0, 1, 2, 3, 4, 5, 6, 13, 14]
    opts.hinting = False
    opts.desubroutinize = True
    opts.notdef_outline = True
    opts.flavor = 'woff2'
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=CHARS)
    sub.subset(font)
    for rec in font['name'].names:     # a family name of its own, so the map never picks up the Google Fonts variable face
        if rec.nameID in (1, 16):
            rec.string = FAMILY
        elif rec.nameID in (4,):
            rec.string = f'{FAMILY} {style.title()}'
        elif rec.nameID == 6:
            rec.string = f'FluentishMap-{style.title()}'
    cmap = font.getBestCmap()
    hmtx = font['hmtx']
    upm = font['head'].unitsPerEm
    adv = {chr(c): hmtx[g][0] for c, g in sorted(cmap.items()) if c in CHARS}
    name = f'map-{style}.woff2'
    path = os.path.join(OUT, name)
    font.save(path)
    with open(path, 'rb') as f:
        digest = hashlib.sha256(f.read()).hexdigest()
    return name, digest, upm, adv


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    os.makedirs(OUT, exist_ok=True)
    out = {'family': FAMILY, 'source': 'Newsreader (google/fonts ofl/newsreader), OFL-1.1', 'opsz': OPSZ, 'wght': WGHT, 'features': 'none', 'styles': {}}
    for src, style in ((sys.argv[1], 'regular'), (sys.argv[2], 'italic')):
        name, digest, upm, adv = build(src, style)
        out['styles'][style] = {'file': name, 'sha256': digest, 'unitsPerEm': upm, 'advance': adv}
        print(style, name, digest[:12], len(adv), 'glyphs')
    with open(os.path.join(OUT, 'metrics.json'), 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
        f.write('\n')


if __name__ == '__main__':
    main()
