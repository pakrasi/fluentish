#!/usr/bin/env python3
"""Builds the 3D map's text atlas: a signed distance field (SDF) of every glyph of the map font, regular and italic,
in one 8-bit grey PNG, plus a JSON table of where each glyph sits. The 3D view (src/features/explore/palace/) draws
every word as instanced quads that sample this field, so type stays crisp at any angle and distance.

  python3 tools/build_palace_atlas.py            # writes src/vendor/palace-sdf/atlas.png and atlas.json
  python3 tools/build_palace_atlas.py --check    # fails when the committed files differ from a fresh build

The distances are exact: each glyph's outline is read from the vendored WOFF2 (src/vendor/newsreader-map/), its
quadratic curves flattened to short segments, and every pixel's distance to the nearest segment measured, with the
sign from the nonzero winding rule. No rasteriser is involved, so the output is the same on every machine.
Encoding (the TinySDF convention): value = 1 - (d / RADIUS + CUTOFF), d in pixels, positive outside; the outline is at
0.75. Needs fonttools, brotli and numpy (pip install fonttools brotli numpy)."""
import hashlib, json, os, struct, sys, zlib
import numpy as np
from fontTools.ttLib import TTFont
from fontTools.pens.basePen import BasePen

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONT = os.path.join(ROOT, 'src', 'vendor', 'newsreader-map')
OUT = os.path.join(ROOT, 'src', 'vendor', 'palace-sdf')
EM = 40          # pixels per em in the atlas
RADIUS = 8.0     # distance (px) that spans the field's range
CUTOFF = 0.25
BUF = 6          # empty pixels around each glyph
WIDTH = 1024
STEPS = 8        # segments per curve


class Flatten(BasePen):
    def __init__(self, glyphset):
        super().__init__(glyphset)
        self.segs, self.start, self.cur = [], None, None

    def _moveTo(self, p):
        self.start = self.cur = p

    def _lineTo(self, p):
        self.segs.append((*self.cur, *p))
        self.cur = p

    def _qCurveToOne(self, p1, p2):
        p0 = self.cur
        for k in range(1, STEPS + 1):
            t = k / STEPS
            q = ((1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0], (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1])
            self._lineTo(q)

    def _curveToOne(self, p1, p2, p3):
        p0 = self.cur
        for k in range(1, STEPS + 1):
            t = k / STEPS
            a, b, c, d = (1 - t) ** 3, 3 * (1 - t) ** 2 * t, 3 * (1 - t) * t * t, t ** 3
            self._lineTo((a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]))

    def _closePath(self):
        if self.cur != self.start:
            self._lineTo(self.start)
        self.cur = self.start


def field(segs, xs, ys):
    """Signed distance (px, positive outside) at pixel centres xs × ys (px coordinates, y up)."""
    X, Y = np.meshgrid(xs, ys)
    P = np.stack([X.ravel(), Y.ravel()], 1)
    if not len(segs):
        return np.full(X.shape, 1e9)
    S = np.array(segs, dtype=np.float64)
    x0, y0, x1, y1 = S[:, 0], S[:, 1], S[:, 2], S[:, 3]
    dx, dy = x1 - x0, y1 - y0
    L2 = np.maximum(dx * dx + dy * dy, 1e-12)
    px, py = P[:, :1], P[:, 1:]
    t = np.clip(((px - x0) * dx + (py - y0) * dy) / L2, 0, 1)
    ex, ey = x0 + t * dx - px, y0 + t * dy - py
    d = np.sqrt((ex * ex + ey * ey).min(1))
    left = dx * (py - y0) - (px - x0) * dy
    up = (y0 <= py) & (y1 > py) & (left > 0)
    down = (y1 <= py) & (y0 > py) & (left < 0)
    wind = up.sum(1) - down.sum(1)
    d = np.where(wind != 0, -d, d)
    return d.reshape(X.shape)


def glyphs(style):
    font = TTFont(os.path.join(FONT, f'map-{style}.woff2'))
    upm = font['head'].unitsPerEm
    cmap = font.getBestCmap()
    gs = font.getGlyphSet()
    s = EM / upm
    out = []
    for cp in sorted(cmap):
        ch = chr(cp)
        if ch.isspace():
            continue
        pen = Flatten(gs)
        gs[cmap[cp]].draw(pen)
        segs = [(a * s, b * s, c * s, d * s) for a, b, c, d in pen.segs]
        if segs:
            xs_ = [v for sg in segs for v in (sg[0], sg[2])]
            ys_ = [v for sg in segs for v in (sg[1], sg[3])]
            x0, x1, y0, y1 = int(np.floor(min(xs_))) - BUF, int(np.ceil(max(xs_))) + BUF, int(np.floor(min(ys_))) - BUF, int(np.ceil(max(ys_))) + BUF
        else:
            x0, x1, y0, y1 = -BUF, BUF, -BUF, BUF
        xs = np.arange(x0, x1) + 0.5
        ys = np.arange(y1, y0, -1) - 0.5          # rows top to bottom
        d = field(segs, xs, ys)
        v = np.clip(1 - (d / RADIUS + CUTOFF), 0, 1)
        img = np.round(v * 255).astype(np.uint8)
        # plane bounds of the cell in em units (y up): left, bottom, right, top
        out.append({'ch': ch, 'img': img, 'q': [x0 / EM, y0 / EM, x1 / EM, y1 / EM]})
    return out


def png(gray, path):
    h, w = gray.shape
    raw = b''.join(b'\x00' + gray[j].tobytes() for j in range(h))
    chunk = lambda t, b: struct.pack('>I', len(b)) + t + b + struct.pack('>I', zlib.crc32(t + b) & 0xffffffff)
    data = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 0, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(data)
    return data


def build():
    items = [('r', g) for g in glyphs('regular')] + [('i', g) for g in glyphs('italic')]
    order = sorted(range(len(items)), key=lambda k: (-items[k][1]['img'].shape[0], items[k][0], items[k][1]['ch']))
    x = y = row = 0
    place = {}
    for k in order:
        gh, gw = items[k][1]['img'].shape
        if x + gw > WIDTH:
            x, y, row = 0, y + row + 1, 0
        place[k] = (x, y)
        x += gw + 1
        row = max(row, gh)
    H = (y + row + 1 + 3) // 4 * 4
    atlas = np.zeros((H, WIDTH), np.uint8)
    table = {'r': {}, 'i': {}}
    for k, (st, g) in enumerate(items):
        gh, gw = g['img'].shape
        px, py = place[k]
        atlas[py:py + gh, px:px + gw] = g['img']
        # x, y, w, h in atlas pixels (y from the top), then the plane bounds in em
        table[st][g['ch']] = [px, py, gw, gh, *[round(v, 4) for v in g['q']]]
    meta = {'note': 'built by tools/build_palace_atlas.py from src/vendor/newsreader-map; see VENDOR.md', 'em': EM, 'radius': RADIUS, 'cutoff': CUTOFF,
            'edge': 1 - CUTOFF, 'width': WIDTH, 'height': H, 'glyphs': table}
    return atlas, meta


def main():
    atlas, meta = build()
    os.makedirs(OUT, exist_ok=True)
    js = json.dumps(meta, ensure_ascii=False, separators=(',', ':'), sort_keys=True) + '\n'
    if '--check' in sys.argv:
        tmp = os.path.join(OUT, '.check.png')
        data = png(atlas, tmp)
        os.remove(tmp)
        same = open(os.path.join(OUT, 'atlas.png'), 'rb').read() == data and open(os.path.join(OUT, 'atlas.json'), encoding='utf8').read() == js
        print('palace atlas: ' + ('current' if same else 'OUT OF DATE (run python3 tools/build_palace_atlas.py)'))
        sys.exit(0 if same else 1)
    data = png(atlas, os.path.join(OUT, 'atlas.png'))
    with open(os.path.join(OUT, 'atlas.json'), 'w', encoding='utf8') as f:
        f.write(js)
    n = sum(len(v) for v in meta['glyphs'].values())
    print(f"palace atlas: {n} glyphs, {WIDTH}x{meta['height']}, png {len(data)} B sha256 {hashlib.sha256(data).hexdigest()}, "
          f"json sha256 {hashlib.sha256(js.encode()).hexdigest()}")


if __name__ == '__main__':
    main()
