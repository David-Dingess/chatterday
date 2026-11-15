#!/usr/bin/env python3
"""Draws the clubhouse: the top-down room the avatars live in.

    python scripts/make-clubhouse.py

Writes client/public/clubhouse/base.png (floor, walls, things against the walls), over.png (a sheet
of free-standing pieces, each with a depth, so people pass behind or in front of them correctly)
and client/src/clubhouse.gen.ts
(where everything is: seats, screens, lights, and which floor cells can be walked on).
The yard round the house is one fixed scene, yard.png (see yard_art), with grass.png and street.png
to carry on past its edges, fire.png for the fire pit after dark and yardfront.png for what stands in
front of the near wall.
A mock-up of the empty room goes to art/clubhouse-preview.png, the yard by day and by night to
art/yard-day.png and art/yard-night.png, and the game table to art/table-preview.png. All of it is drawn here.
"""
import importlib.util
import json
import math
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('mk', os.path.join(HERE, 'pixelkit.py'))
mk = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mk)
Cv, Mat, mix, rgb = mk.Cv, mk.Mat, mk.mix, mk.rgb

W, H, WALL, CELL = 528, 334, 96, 6
FLOOR_END = 327                      # last floor row; below it is the near wall's top edge
INK = np.array([26, 18, 40])

base = Cv(W, H)
occluders = []                       # free-standing pieces: (pixels, where it goes and the depth it sorts at)
blocked = []                         # rectangles nobody can walk through
L = dict(w=W, h=H, cell=CELL)        # the layout that goes to the client


def shade(c, t):
    return mix(c, (20, 14, 40), t)


def tint(c, t):
    return mix(c, (255, 244, 220), t)


def outline(a):
    """A dark pixel around everything drawn, tinted by what it touches."""
    out = a.copy()
    solid = a[..., 3] > 0
    for dy, dx in ((1, 0), (0, 1), (0, -1), (-1, 0)):
        nb = np.roll(a, (-dy, -dx), axis=(0, 1))
        hit = (~solid) & (nb[..., 3] > 0) & (out[..., 3] == 0)
        out[hit, :3] = (nb[hit, :3] * 0.28 + INK * 0.72).astype(np.uint8)
        out[hit, 3] = 255
    return out


def foot_shadow(m):
    """The shade under a piece that stands on the floor: one line of it, right under its foot, as under the sofa.
    Nothing round its sides or on the wall behind it: that only smears its outline. `m` is where the piece is."""
    drawn = base.a[..., 3] > 0
    ys, xs = np.nonzero(m)
    low = {}
    for y, x in zip(ys, xs):                                 # the lowest dot of it in each column
        if y > low.get(x, -1):
            low[x] = y
    floor = max(low.values()) if low else 0
    for x, y in low.items():
        if y >= floor - 3 and y + 1 < H and drawn[y + 1, x] and not m[y + 1, x]:      # (only where it meets the floor, not under a shelf of it higher up)
            base.a[y + 1, x, :3] = (base.a[y + 1, x, :3] * 0.7 + np.array([20, 14, 40]) * 0.3).astype(np.uint8)


def put(layer, draw, edge=True, shadow=False):
    t = Cv(W, H)
    draw(t)
    arr = outline(t.a) if edge else t.a
    m = arr[..., 3] > 0
    if shadow and layer is base:
        foot_shadow(m)
    layer.a[m] = arr[m]
    ys, xs = np.nonzero(m)
    return int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())


def put_over(draw, z, edge=True, shadow=False):
    """A free-standing piece. z is the y of its base: anyone standing further up the room is drawn behind it."""
    t = Cv(W, H)
    draw(t)
    arr = outline(t.a) if edge else t.a
    if shadow:
        foot_shadow(arr[..., 3] > 0)
    ys, xs = np.nonzero(arr[..., 3] > 0)
    x0, y0, x1, y1 = int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())
    entry = dict(x=x0, y=y0, w=x1 - x0 + 1, h=y1 - y0 + 1, z=z)
    occluders.append((arr[y0:y1 + 1, x0:x1 + 1].copy(), entry))
    return entry


def pack(width=256):
    """Lay the pieces out on one sheet and note where each one landed."""
    x = y = tall = 0
    for crop, e in occluders:
        if x + e['w'] > width:
            x, y, tall = 0, y + tall + 1, 0
        e['sx'], e['sy'] = x, y
        x += e['w'] + 1
        tall = max(tall, e['h'])
    sheet = np.zeros((y + tall, width, 4), np.uint8)
    for crop, e in occluders:
        sheet[e['sy']:e['sy'] + e['h'], e['sx']:e['sx'] + e['w']] = crop
    return sheet


def block(x0, y0, x1, y1):
    blocked.append((x0, y0, x1, y1))


def rows(x0, y0, x1, y1):
    return [(y, x0, x1) for y in range(y0, y1 + 1)]


def ellipse(cx, cy, rx, ry):
    out = []
    for y in range(int(cy - ry), int(cy + ry) + 1):
        t = 1 - ((y - cy) / ry) ** 2
        if t >= 0:
            dx = rx * math.sqrt(t)
            out.append((y, int(round(cx - dx)), int(round(cx + dx))))
    return out


# ───────────────────────── floors and walls ─────────────────────────

def wood(x, y, tones):
    row = (y - WALL) // 10
    off = (row * 23) % 40
    plank = (x + off) // 40 + row * 7
    col = tones[(plank * 5 + row) % 3]
    if (y - WALL) % 10 == 9 or (x + off) % 40 == 0:
        col = shade(col, 0.30)
    return col


def tiles(x, y):
    if x % 10 == 0 or y % 10 == 6:
        return rgb('#aebfd0')
    return rgb('#e6eef5') if ((x // 10) + ((y - 6) // 10)) % 2 == 0 else rgb('#d2dfea')


WOOD = [rgb('#8f6a4c'), rgb('#86624a'), rgb('#976f50')]
PC_X = (6, 349)                      # all six desks stand along this stretch of the back wall, on one floor
LOUNGE_X = (350, 521)
# The bathroom, in the near left corner. `door` is the gap in its right-hand wall (first and last row): it is in the
# upper half of that wall, because the shower stands in the corner below it.
BATH = dict(x0=6, x1=125, wall_top=230, face=234, floor=264, door=(268, 292))
# The kitchen and dining end of the room: lino from the bathroom's wall across to the lounge, level with the bathroom's
# back wall. The desks and the open floor above it are on wood.
DINER = dict(x0=132, x1=347, y0=BATH['wall_top'])       # (x1: the last column of lino; the bar to the carpet is the two after it)


def lino(x, y):
    """The kitchen's floor: cream and sea-green squares."""
    if x % 8 == 6 or y % 8 == 0:
        return rgb('#a9b3a2')
    return rgb('#ece4cf') if ((x + 2) // 8 + y // 8) % 2 == 0 else rgb('#a9c9bd')


def pile(x, y, col, seed=1):
    """Carpet seen close: a fine weave (every other dot a touch darker), slow lumps of light and shade where it has been
    walked on, and the odd bright or dark tuft."""
    c = shade(col, 0.07) if (x + y) % 2 else col
    lump = noise(x, y, 14, seed)
    c = tint(c, 0.10 * lump) if lump > 0 else shade(c, -0.14 * lump)
    h = hsh(x, y, seed)
    return tint(c, 0.12) if h % 23 == 0 else shade(c, 0.16) if h % 31 == 0 else c


def rug(x0, y0, x1, y1, field, edge, band, lattice, seed, kind='persian'):
    """A woven rug, with a pattern worked into its field. `lattice(x, y)` says what that pattern does at a dot: 0 nothing,
    1 a line of it (a shade lighter), 2 a knot of it (in the border's colour). The two kinds are finished differently:
    'persian' has a fringe at each short end and a narrow border, a row of little diamonds between two gold lines;
    'modern' has no fringe and no border to speak of, only a bound edge and one fine line set in from it, and its
    corners are rounded off."""
    cream = rgb('#e9dfc4')
    round_off = lambda x, y: kind == 'modern' and (x in (x0, x1)) and (y in (y0, y1))
    if kind == 'persian':
        for y in range(y0 + 1, y1):                          # the fringe: tassels, two dots long, every other row
            if y % 2:
                for k in (1, 2):
                    base.px(x0 - k, y, cream if k == 1 else shade(cream, 0.2)); base.px(x1 + k, y, cream if k == 1 else shade(cream, 0.2))
    for x in range(x0 + 1, x1 + 2):                          # its shadow on the carpet under it
        base.px(x, y1 + 1, shade(base.get(x, y1 + 1), 0.3))
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            if round_off(x, y):
                continue
            b = min(x - x0, x1 - x, y - y0, y1 - y)          # how far in from the edge
            along = (x - x0) if min(y - y0, y1 - y) <= min(x - x0, x1 - x) else (y - y0)
            what = lattice(x, y)
            inside = edge if what == 2 else tint(field, 0.22) if what == 1 else field
            if kind == 'modern':
                c = shade(field, 0.4) if b == 0 else shade(field, 0.2) if b == 1 else edge if b == 4 else field if b < 6 else inside
            elif b == 0:
                c = shade(field, 0.45)
            elif b in (1, 5):
                c = edge
            elif b <= 4:                                     # between the gold lines: a diamond every six dots
                k, d = along % 6, b - 3
                c = edge if abs(k - 3) + abs(d) == 0 else tint(band, 0.3) if abs(k - 3) + abs(d) == 1 else band
            elif b == 6:
                c = shade(field, 0.35)
            else:
                c = inside
            base.px(x, y, pile(x, y, c, seed) if b > 1 else shade(c, 0.08) if (x + y) % 2 else c)


def shag(x0, y0, x1, y1):
    """A big shag rug on the wood: long cream pile lying every which way, a ragged edge, round corners."""
    tones = [rgb('#f4ecd8'), rgb('#e8dcc0'), rgb('#fbf6ea'), rgb('#d6c8a6'), rgb('#efe4cb')]
    deep = rgb('#b9a882')

    def inside(x, y):
        dx, dy = min(x - x0, x1 - x), min(y - y0, y1 - y)
        if dx < 0 or dy < 0:
            return False
        if dx < 6 and dy < 6 and (6 - dx) ** 2 + (6 - dy) ** 2 > 40:            # the corners are rounded off
            return False
        return min(dx, dy) > 0 or hsh(x, y, 5) % 3 > 0                             # and the edge is ragged: a tuft missing here and there
    for y in range(y0, y1 + 3):
        for x in range(x0, x1 + 3):
            if inside(x, y):
                # each tuft is a short stroke, two or three dots long, lying down the room or a little across it
                lean = hsh(x // 3, y // 4, 7) % 3 - 1
                tuft = hsh(x + lean * ((y % 4) // 2), y // (3 + hsh(x, 0, 9) % 2), 11)
                c = tones[tuft % len(tones)]
                if hsh(x, y, 13) % 9 == 0:
                    c = deep                                                       # the dark between the tufts
                lump = noise(x, y, 18, 3)
                c = tint(c, 0.10 * lump) if lump > 0 else shade(c, -0.10 * lump)
                if not inside(x, y + 1) or not inside(x + 1, y):
                    c = shade(c, 0.22)                                             # the near and right edges, in shade
                base.px(x, y, c)
            elif inside(x - 1, y - 1) or inside(x, y - 1) or inside(x - 1, y):     # its shadow on the boards
                base.px(x, y, shade(base.get(x, y), 0.28))


def floors():
    for y in range(WALL, FLOOR_END + 1):
        for x in range(6, 522):
            if x >= LOUNGE_X[0]:
                c = pile(x, y, rgb('#3b3352'))
            else:
                c = wood(x, y, WOOD)
            if y < WALL + 4:                                # the wall's shadow on the floor
                c = shade(c, 0.22 - 0.05 * (y - WALL))
            if x < 9 or x > 518:                            # and in the corners down each side
                c = shade(c, 0.16 - 0.05 * (x - 6 if x < 9 else 521 - x))
            base.px(x, y, c)
    # Where the lounge's carpet meets the other floors, a strip across the join, running down the room from the foot of
    # the pier, so one floor is seen to end and the other to begin: dark wood where it meets the boards, and a
    # narrow bar of brushed metal where it meets the kitchen's lino (the lino is laid right up to it, further down).
    for y in range(WALL, DINER['y0']):
        for k, col in enumerate((rgb('#8a5a3c'), rgb('#5f3c27'), rgb('#3d2413'))):
            base.px(348 + k, y, shade(col, 0.25) if y < WALL + 3 else col)
    for y in range(DINER['y0'], FLOOR_END + 1):
        for x in range(DINER['x0'], DINER['x1'] + 1):
            base.px(x, y, shade(lino(x, y), 0.3) if y == DINER['y0'] else lino(x, y))      # (a dark strip where it meets the wood)
        base.px(DINER['x1'] + 1, y, rgb('#dfe3ea')); base.px(DINER['x1'] + 2, y, rgb('#8d93a3'))      # the metal bar between lino and carpet
    for y in range(BATH['floor'], FLOOR_END + 1):
        for x in range(BATH['x0'], BATH['x1'] + 1):
            c = tiles(x, y)
            base.px(x, y, shade(c, 0.2) if y < BATH['floor'] + 3 else c)
    # the theatre's: deep red, a trellis of fine lines with a gold knot where they cross
    trellis = lambda x, y: 2 if (x + y) % 14 < 2 and (x - y) % 14 < 2 else 1 if (x + y) % 14 == 0 or (x - y) % 14 == 0 else 0
    rug(358, 116, 517, 176, rgb('#7a2f3c'), rgb('#d9a441'), rgb('#3a1c2c'), trellis, 21)
    # the living room's: sea blue in a herringbone, with a cream stitch every sixteen dots
    bone = lambda x, y: 2 if (x % 16 == 0 and y % 16 == 0) or (x % 16 == 8 and y % 16 == 8) else 1 if (x + (y if (y // 6) % 2 else -y)) % 6 == 0 else 0
    rug(362, 210, 513, 300, rgb('#2f5f78'), rgb('#e8dcc0'), rgb('#1f3f52'), bone, 22, kind='modern')
    # and a big shag rug on the boards between the desks and the kitchen
    shag(62, 172, 338, 224)


def walls():
    dark = rgb('#1b1c2a')
    zones = ((PC_X, rgb('#383d55')), (LOUNGE_X, rgb('#4d4268')))
    for (x0, x1), col in zones:
        for y in range(4, WALL):
            c = shade(col, 0.16) if y < 12 else col
            if y >= WALL - 5:
                c = shade(col, 0.42)                          # skirting board
            elif y == WALL - 6:
                c = tint(col, 0.18)
            for x in range(x0, x1 + 1):
                base.px(x, y, shade(c, 0.06) if (x // 22) % 2 else c)
    # Where the desks' wall meets the lounge's: a square pier standing proud of both, lit down its left edge and dark down
    # its right, with a plinth at its foot that the two skirting boards run into. (It was four flat stripes that stopped
    # short of the floor, with nothing to say why the wall changed colour there.)
    pier = rgb('#2c3044')
    for y in range(4, WALL):
        for x in range(346, 353):
            c = tint(pier, 0.22) if x == 346 else shade(pier, 0.45) if x == 352 else shade(pier, 0.2) if x == 351 else pier
            base.px(x, y, shade(c, 0.16) if y < 12 else c)
    base.rect(345, WALL - 7, 353, WALL - 1, shade(pier, 0.38))                   # the plinth
    base.rect(345, WALL - 7, 353, WALL - 7, tint(pier, 0.25))
    base.rect(345, WALL - 7, 345, WALL - 1, tint(pier, 0.1))
    base.rect(345, 4, 353, 6, shade(pier, 0.3)); base.rect(345, 7, 353, 7, tint(pier, 0.18))      # and a cap under the ceiling
    base.rect(0, 0, W - 1, 3, dark)
    base.rect(0, 0, 5, H - 1, dark)
    base.rect(W - 6, 0, W - 1, H - 1, dark)
    base.rect(0, FLOOR_END + 1, W - 1, H - 1, dark)
    for x in range(6, W - 6):                                 # a lit edge on the near wall
        base.px(x, FLOOR_END + 1, rgb('#33354a'))
    # bathroom: tiled back wall and the wall with the door
    b = BATH
    base.rect(b['x0'], b['wall_top'], 131, b['face'] - 1, dark)
    for y in range(b['face'], b['floor']):
        for x in range(b['x0'], 126):
            c = rgb('#f1f5f8') if (x // 8 + (y - b['face']) // 8) % 2 == 0 else rgb('#dfe8ef')
            if x % 8 == 0 or (y - b['face']) % 8 == 7:
                c = rgb('#b9c8d6')
            if y >= b['floor'] - 4:
                c = rgb('#7fb2c9')                            # a band of blue tile at the bottom
            base.px(x, y, c)
    d0, d1 = b['door']
    base.rect(126, b['wall_top'], 131, d0 - 1, dark)
    base.rect(126, d1 + 1, 131, FLOOR_END, dark)
    for y in range(b['face'], d0):
        base.px(126, y, rgb('#33354a'))
    base.rect(126, d0 - 2, 131, d0 - 1, rgb('#8a5a3c'))       # door frame
    base.rect(126, d1 + 1, 131, d1 + 2, rgb('#8a5a3c'))
    # The doorway's own floor: a sill of pale stone across the thickness of the wall, with a dark line each side where
    # it meets the bathroom's tiles and the kitchen's lino. (It was a gap of bare boards between two tiled floors.)
    base.rect(126, d0, 131, d1, rgb('#d9dde4'))
    base.rect(126, d0, 126, d1, rgb('#9aa3b2')); base.rect(131, d0, 131, d1, rgb('#9aa3b2'))
    base.rect(127, d0, 127, d1, rgb('#eef1f5'))
    for y in range(d0 + 5, d1, 9):                            # a seam or two in the stone
        base.rect(127, y, 130, y, rgb('#b7bfcc'))
    block(0, b['wall_top'] - 2, 131, b['floor'] - 1)
    block(124, b['wall_top'], 133, d0 - 1)
    block(124, d1 + 1, 133, FLOOR_END)


# ───────────────────────── furniture ─────────────────────────

WOODM = Mat('#8a5a3c', hi='#b07a52', lo='#5f3c27')
SHEET = Mat('#eceaf2', hi='#ffffff', lo='#bdb9cb')
PORC = Mat('#f4f6f9', hi='#ffffff', lo='#b7c0cf')
BLANKET = Mat('#8f97ad', hi='#b3bacb', lo='#666e85')      # a made bed; whoever sleeps in it brings their own colour


def stamp(c, x, y, lines, colours):
    """A little picture from rows of letters; '.' leaves the pixel alone."""
    for j, line in enumerate(lines):
        for i, ch in enumerate(line):
            if ch != '.':
                c.px(x + i, y + j, colours[ch])


def item_ball(c, x, y):                                 # a football: white, a black patch in the middle, more round the edge (the one that is kicked round the room)
    stamp(c, x, y, ['..wwwww..',
                    '.kkwwwkk.',
                    'wkwwwwwkw',
                    'wwwwkwwww',
                    'wwwkkkwww',
                    'wwwkkkwww',
                    'kwwwwwwwk',
                    '.kwwwwwk.',
                    '..wkkkw..'], dict(w=rgb('#f4f6f9'), k=rgb('#1b1c26')))


BED_ROWS = (69, 154)                 # the rows of the room a desk, its screens and its chair take up: the bed that replaces them covers these
BED_W = 52
bed_tiles = []                       # one picture per desk: that stretch of wall and floor with a bed in it instead


BED_TOP = 97                         # where a sleeper's 48-dot frame starts, down the room: their pillow is 2 below, their blanket ends 44 below


def bed_tile(dx, clean):
    """Somebody who says they are sleeping has their desk turn into a bed. This is the picture the app lays where the
    desk was then (it leaves the desk and its chair out): a bed seen from above, its head against the wall and its
    foot out in the room, on the bare floor that was there before the desk's shade was laid on it. Above the floor
    the picture is clear, so whatever hangs on the wall behind still shows. Whoever is in the bed is drawn from their
    own sleeping-from-above frames (pillow, head, blanket), which lie exactly on the pillow and blanket painted here.

    Every bed is the same plain wooden single, made up in grey: whoever sleeps in it brings their own colour."""
    fx, T = dx + 1, BED_TOP                                               # the sleeper's frame: its left edge and its top
    B = T + 46                                                            # the foot of the mattress
    t = Cv(W, H)

    def sym(y0, y1, hw):
        """Rows y0 to y1, each `hw` dots either side of the middle."""
        return [(y, fx + 24 - hw, fx + 23 + hw) for y in range(y0, y1 + 1)]

    t.part(sym(T - 9, T - 2, 18), WOODM, hi='t', lo='b')                  # a wooden single, close round whoever is in it
    t.part(sym(T - 1, B + 1, 18), WOODM, hi='l', lo='r')
    t.part(sym(T - 1, B, 16), SHEET, hi='t', lo='rb')
    t.part(sym(B + 2, B + 4, 18), WOODM, hi='t', lo='b')
    # made up, for the moment before they get in: a pillow and a blanket just where theirs will lie
    t.part([(T + 2, fx + 11, fx + 36)] + rows(fx + 9, T + 3, fx + 38, T + 24) + [(T + 25, fx + 10, fx + 37)], Mat('#f6f5fb', hi='#ffffff', lo='#c9c5d6'), hi='t', lo='rb')
    t.part([(T + 26, fx + 12, fx + 35)] + rows(fx + 11, T + 27, fx + 36, T + 39) + rows(fx + 12, T + 40, fx + 35, T + 43) + [(T + 44, fx + 13, fx + 34)], BLANKET, hi='', lo='rb')
    t.rect(fx + 12, T + 26, fx + 35, T + 28, BLANKET.hi)
    arr = outline(t.a)
    assert not arr[:BED_ROWS[0], :, 3].any() and not arr[BED_ROWS[1] + 1:, :, 3].any() and not arr[:, :dx - 1, 3].any() and not arr[:, dx - 1 + BED_W:, 3].any(), 'the bed does not fit its tile'
    arr = arr[BED_ROWS[0]:BED_ROWS[1] + 1, dx - 1:dx - 1 + BED_W]
    tile = clean.copy()
    tile[:WALL - BED_ROWS[0]] = 0                                         # (the wall: left clear)
    m = arr[..., 3] > 0
    foot = np.zeros_like(m)                                               # a line of shade under its foot, as under the desk it replaces
    foot[-(BED_ROWS[1] - (T + 52)):, :] = True
    under = np.roll(m, 1, axis=0) & ~m & foot
    tile[under, :3] = (tile[under, :3] * 0.7 + np.array([20, 14, 40]) * 0.3).astype(np.uint8)
    tile[m] = arr[m]
    bed_tiles.append(tile)
    return dict(at=[dx - 1, BED_ROWS[0], BED_W, BED_ROWS[1] - BED_ROWS[0] + 1], x=dx + 25, y=T + 45, ax=dx + 25, ay=WALL + 64)


def desk_place(dx, dy, island=False):
    """Where a desk stands: (dx, dy) is the top-left corner of its top. The app draws the desk itself, what is on
    it and its chair (client/src/draw/desk.ts) from what the person sitting there picked, so nothing of it is painted
    here: only the shade it throws on the floor, what it shuts to feet, and where things go. `cy` is the row the
    chair is drawn from (its seat is 38 below, its feet 46): pushed right in, its back up against the desk's front.
    `back` is the depth its back sorts at. An island desk stands in the open, so people can pass behind it.
    Somebody asleep has a bed here instead (see bed_tile)."""
    clean = base.a[BED_ROWS[0]:BED_ROWS[1] + 1, dx - 1:dx - 1 + BED_W].copy()      # the wall and floor here, before anything stands on them
    cy = dy - 8
    for y in range(dy + 16, dy + 33):                                     # the floor under the desk, in its shade
        for x in range(dx + 4, dx + 46):
            base.px(x, y, shade(base.get(x, y), 0.2))
    block(dx, dy - 22, dx + 49, dy + 24)
    block(dx + 15, cy + 30, dx + 34, cy + 48)
    return dict(x=dx + 25, y=cy + 46, ax=dx + 25, ay=cy + 56, z=dy + 25 if island else 1, hit=[dx + 14, cy + 27, 22, 22],
                dx=dx, dy=dy, cy=cy, back=cy + 47, bed=bed_tile(dx, clean))


PHOTO_W, PHOTO_H = 88, 66


def placeholder(c, x0, y0, w, h):
    """What hangs in the big frame until the admin puts a picture there: a sunset over hills."""
    for j in range(h):
        t = j / (h - 1)
        sky = mix(rgb('#2b2a6b'), rgb('#f39a5b'), min(1, t * 1.5)) if t < 0.66 else mix(rgb('#f39a5b'), rgb('#ffd98a'), (t - 0.66) * 3)
        for i in range(w):
            c.px(x0 + i, y0 + j, sky)
    for y, xa, xb in ellipse(x0 + 58, y0 + 40, 9, 9):                      # the sun, low
        c.rect(xa, y, xb, y, rgb('#fff1b8'))
    for sx, sy in ((9, 6), (23, 11), (40, 4), (71, 8), (80, 15), (52, 13)):
        c.px(x0 + sx, y0 + sy, rgb('#e9e4ff'))
    for i in range(w):                                                    # far hills, then near ones
        far = 44 + int(4 * math.sin(i / 11.0) + 2 * math.sin(i / 4.0 + 1))
        near = 53 + int(5 * math.sin(i / 17.0 + 2) + 2 * math.sin(i / 6.0))
        for j in range(far, h):
            c.px(x0 + i, y0 + j, rgb('#7a4a7c'))
        for j in range(near, h):
            c.px(x0 + i, y0 + j, rgb('#3b2b55') if (i * 7 + j * 3) % 9 else rgb('#4a3868'))
    for tx in (12, 20, 76):                                               # a few trees on the near hill
        base_y = 53 + int(5 * math.sin(tx / 17.0 + 2) + 2 * math.sin(tx / 6.0))
        for k in range(7):
            c.rect(x0 + tx - k // 2, y0 + base_y - 8 + k, x0 + tx + k // 2, y0 + base_y - 8 + k, rgb('#241a3a'))


def pic_boat(c, x0, y0, w, h):
    """A sailing boat on a bright sea."""
    sea = h * 2 // 3
    for j in range(h):
        for i in range(w):
            if j < sea:
                col = mix(rgb('#7fc4ee'), rgb('#e3f4fb'), j / sea)
            else:
                col = rgb('#8fc0e6') if (i + 3 * j) % 7 == 0 else mix(rgb('#2f79bd'), rgb('#1f4f8a'), (j - sea) / (h - sea))
            c.px(x0 + i, y0 + j, col)
    for y, xa, xb in ellipse(x0 + 5, y0 + 5, 2, 2):                       # the sun
        c.rect(xa, y, xb, y, rgb('#ffe27a'))
    for cx_, cy_ in ((17, 4), (20, 8)):                                   # two small clouds
        c.rect(x0 + cx_, y0 + cy_, x0 + cx_ + 4, y0 + cy_, rgb('#ffffff')); c.rect(x0 + cx_ + 1, y0 + cy_ - 1, x0 + cx_ + 2, y0 + cy_ - 1, rgb('#ffffff'))
    mx = x0 + w // 2
    c.rect(mx, y0 + 5, mx, y0 + sea - 1, rgb('#5f3c27'))                  # the mast
    for k in range(sea - 8):                                              # the mainsail, and the jib before it
        c.rect(mx + 1, y0 + 6 + k, mx + 1 + round(k * 0.65), y0 + 6 + k, rgb('#f7f5ee') if k % 4 else rgb('#d9d4c4'))
    for k in range(sea - 10):
        c.rect(mx - 1 - round(k * 0.5), y0 + 8 + k, mx - 1, y0 + 8 + k, rgb('#ece8dc'))
    c.rect(mx - 6, y0 + sea - 1, mx + 7, y0 + sea - 1, rgb('#b9443c'))    # the hull
    c.rect(mx - 5, y0 + sea, mx + 6, y0 + sea, rgb('#8a2f2a'))
    c.rect(mx - 4, y0 + sea + 1, mx + 5, y0 + sea + 1, rgb('#6fa8d8'))    # and its wake


def pic_peaks(c, x0, y0, w, h):
    """Mountains with snow on them, over a lake and a few pines."""
    shore = h * 2 // 3
    for j in range(h):
        for i in range(w):
            c.px(x0 + i, y0 + j, mix(rgb('#9fd0ee'), rgb('#eef7fb'), j / (h - 1)))
    for px_, top, half, rock in ((27, 7, 15, '#8494b0'), (12, 4, 14, '#6f7f9e')):      # two peaks, the nearer one last
        for j in range(top, shore + 1):
            reach = round((j - top) * half / (shore - top))
            for i in range(px_ - reach, px_ + reach + 1):
                if 0 <= i < w:
                    snow = j - top < 4 + (i * 3 + j) % 3 - abs(i - px_) // 2
                    c.px(x0 + i, y0 + j, rgb('#f6f8fb') if snow else mix(rgb(rock), (30, 36, 60), 0.25) if i > px_ + 1 else rgb(rock))
    for j in range(shore, h):                                             # the lake, with the sky in it
        for i in range(w):
            c.px(x0 + i, y0 + j, rgb('#cfe6f2') if (i + 2 * j) % 9 == 0 else mix(rgb('#5f9fd0'), rgb('#3f74aa'), (j - shore) / (h - shore)))
    for i in range(w):                                                    # the near bank
        top = h - 4 + round(1.5 * math.sin(i / 5.0))
        for j in range(top, h):
            c.px(x0 + i, y0 + j, rgb('#3f8a3c') if (i + j) % 3 else rgb('#57a84a'))
    for tx, tall in ((4, 9), (9, 7), (33, 10), (37, 7)):                  # pines
        for k in range(tall):
            c.rect(x0 + tx - k // 3, y0 + h - 4 - tall + k, x0 + tx + k // 3, y0 + h - 4 - tall + k, rgb('#1f5a2a') if k % 3 else rgb('#2f7a3a'))


def pic_flowers(c, x0, y0, w, h):
    """Three flowers in a blue jug, on a table."""
    c.rect(x0, y0, x0 + w - 1, y0 + h - 1, rgb('#f1e3c4'))
    c.rect(x0, y0 + h - 5, x0 + w - 1, y0 + h - 1, rgb('#a0704a'))        # the table
    c.rect(x0, y0 + h - 5, x0 + w - 1, y0 + h - 5, rgb('#c08a5c'))
    mx = x0 + w // 2
    for sx, top in ((-4, 6), (0, 4), (4, 8)):                             # stems
        for j in range(top, h - 9):
            c.px(mx + round(sx * (h - 9 - j) / (h - 9 - top)), y0 + j, rgb('#3f8a47'))
    c.px(mx - 2, y0 + 9, rgb('#57a555')); c.px(mx + 2, y0 + 10, rgb('#57a555'))
    for sx, top, col in ((-4, 6, '#e0444c'), (0, 4, '#f2c24b'), (4, 8, '#ff8fc0')):
        for y, xa, xb in ellipse(mx + sx, y0 + top, 2, 2):
            c.rect(xa, y, xb, y, rgb(col))
        c.px(mx + sx, y0 + top, rgb('#fff6d0'))
    jug = Mat('#4f8fc0', hi='#8fc3e8', lo='#2f5f8a')
    c.part([(y0 + h - 9, mx - 2, mx + 2)] + rows(mx - 3, y0 + h - 8, mx + 3, y0 + h - 5) + [(y0 + h - 4, mx - 2, mx + 2)], jug, hi='l', lo='rb')
    c.rect(mx - 4, y0 + h - 3, mx + 4, y0 + h - 3, rgb('#7a5236'))        # its shade on the table


def pic_lighthouse(c, x0, y0, w, h):
    """A lighthouse on its rock at dusk, the lamp lit."""
    sea = h - 8
    for j in range(h):
        for i in range(w):
            if j < sea:
                col = mix(rgb('#2b2a6b'), rgb('#f39a5b'), (j / sea) ** 1.4)
            else:
                col = rgb('#6f86c0') if (i + 2 * j) % 8 == 0 else rgb('#27406b')
            c.px(x0 + i, y0 + j, col)
    for sx, sy in ((3, 3), (9, 6), (20, 2), (23, 9), (5, 12)):
        c.px(x0 + sx, y0 + sy, rgb('#e9e4ff'))
    mx = x0 + w // 2
    for k in range(9):                                                    # the beam, out to the right
        for j in range(-(k // 3), k // 3 + 1):
            cur = c.get(mx + 3 + k, y0 + 8 + j)
            if cur:
                c.px(mx + 3 + k, y0 + 8 + j, mix(cur, rgb('#fff1b8'), 0.55 - k * 0.04))
    for j in range(11, sea):                                              # the tower: white, with two red bands, a little wider at the foot
        half = 2 + (j - 11) // 9
        for i in range(-half, half + 1):
            band = (j - 11) // 4 % 3 == 1
            c.px(mx + i, y0 + j, rgb('#b9443c') if band else rgb('#c9ced9') if i == half else rgb('#f4f6f9'))
    c.rect(mx - 3, y0 + 10, mx + 3, y0 + 10, rgb('#23242e'))              # the gallery, the lamp, the cap
    c.rect(mx - 2, y0 + 7, mx + 2, y0 + 9, rgb('#ffe27a')); c.px(mx, y0 + 8, rgb('#ffffff'))
    c.rect(mx - 2, y0 + 6, mx + 2, y0 + 6, rgb('#23242e')); c.rect(mx - 1, y0 + 5, mx + 1, y0 + 5, rgb('#23242e'))
    for i in range(w):                                                    # the rock it stands on
        top = sea - 1 - max(0, 3 - abs(i - w // 2) // 3)
        for j in range(top, min(h, sea + 3 - abs(i - w // 2) // 5)):
            c.px(x0 + i, y0 + j, rgb('#2a2336') if (i + j) % 4 else rgb('#3d3350'))


# The pictures on the back wall, behind the desks. The big one in the gilded frame is the admin's to hang (Settings,
# Admin): the app shows their picture over the one painted here, at its full sharpness. The four smaller ones are
# only paintings, painted here.
#   name, where its top-left corner hangs, its size in dots, its frame, what paints it
GALLERY = [
    dict(name='photo', size=(PHOTO_W, PHOTO_H), frame='gilt', paint=placeholder),      # hung by main()
    # the four smaller ones hang together to the right of it, salon fashion: a few dots apart, no two tops level
    dict(name='boat', at=(234, 22), size=(26, 26), frame='black', paint=pic_boat),
    dict(name='peaks', at=(269, 9), size=(40, 30), frame='white', paint=pic_peaks),
    dict(name='flowers', at=(279, 48), size=(20, 20), frame='gold', paint=pic_flowers),
    dict(name='lighthouse', at=(316, 19), size=(26, 35), frame='wood', paint=pic_lighthouse),
]
FRAMES = dict(wood=Mat('#6b4226', hi='#96633c', lo='#3d2413'), white=Mat('#e9e4d8', hi='#ffffff', lo='#a9a393'),
              black=Mat('#23242e', hi='#4a4d63', lo='#0e0f14'), gold=Mat('#d9a441', hi='#fbe59a', lo='#8a6420'))


def framed_photo(g, x0, y0):
    """One picture in its frame, on the back wall. The big one is gilded and hangs in the middle, behind the third
    and fourth desks; the others are smaller, each in a plainer frame of its own. The desks stand in front of
    whatever hangs low (the app draws them over the wall, and over the admin's picture)."""
    w, h = g['size']
    x1, y1 = x0 + w - 1, y0 + h - 1
    if g['frame'] == 'gilt':                                              # where the admin's picture goes
        L['photo'] = [x0, y0, w, h]

    def gilt(c):
        gold = FRAMES['gold']
        c.part(rows(x0 - 5, y0 - 5, x1 + 5, y1 + 5), gold, hi='tl', lo='rb')
        c.rect(x0 - 3, y0 - 3, x1 + 3, y1 + 3, gold.hi)                   # the raised inner moulding
        c.rect(x0 - 2, y0 - 2, x1 + 2, y1 + 2, gold.lo)
        c.rect(x0 - 1, y0 - 1, x1 + 1, y1 + 1, rgb('#3a2a10'))
        for x in range(x0 - 4, x1 + 5, 4):                                # beading along the outer edge
            c.px(x, y0 - 4, gold.hi); c.px(x, y1 + 4, gold.lo)
        for y in range(y0 - 4, y1 + 5, 4):
            c.px(x0 - 4, y, gold.hi); c.px(x1 + 4, y, gold.lo)
        for cx, cy in ((x0 - 4, y0 - 4), (x1 + 2, y0 - 4), (x0 - 4, y1 + 2), (x1 + 2, y1 + 2)):   # corner rosettes
            c.rect(cx, cy, cx + 2, cy + 2, gold.hi)
            c.px(cx + 1, cy + 1, rgb('#fff6d0'))

    def plain(c):                                                         # three dots of moulding, and a dark line next to the picture
        mat = FRAMES[g['frame']]
        c.part(rows(x0 - 3, y0 - 3, x1 + 3, y1 + 3), mat, hi='tl', lo='rb')
        c.rect(x0 - 1, y0 - 1, x1 + 1, y1 + 1, mix(mat.lo, (0, 0, 0), 0.4))

    def d(c):
        (gilt if g['frame'] == 'gilt' else plain)(c)
        g['paint'](c, x0, y0, w, h)
    put(base, d)


def lounge():
    def screen(c):
        c.part(rows(362, 4, 509, 8), Mat('#2a2c3a', hi='#4a4d63', lo='#15161d'), hi='t', lo='b')      # only the roller's housing: the app rolls the screen out of it
        c.rect(360, 5, 361, 7, rgb('#15161d')); c.rect(510, 5, 511, 7, rgb('#15161d'))
    put(base, screen)
    # The screen hangs midway between the two speakers and comes down clear of both: the app's roll is two dots wider
    # each side than the picture, so 366..505, with the speakers' inner edges at 359 and 513. The whiteboard is on the
    # wall behind it (see decor), and is covered while something is being shown.
    L['screen'] = [368, 10, 136, 77]
    L['theatreDark'] = [LOUNGE_X[0], 4, LOUNGE_X[1] - LOUNGE_X[0] + 1, 196]
    for sx in (352, 513):                                               # each is 8 wide, one in each corner of the lounge's back wall
        def speaker(c, sx=sx):
            c.part(rows(sx, 66, sx + 7, 110), Mat('#22232d', hi='#3d3f52', lo='#12131a'), hi='tl', lo='rb')
            cone = dict(k=rgb('#0e0f15'), g=rgb('#5b5f78'), d=rgb('#2a2c3a'), h=rgb('#8d93ab'))
            stamp(c, sx + 3, 70, ['hh', 'hh'], cone)                                       # tweeter
            for cy in (76, 91):                                                            # two drivers: a dark rim, the cone, the cap in the middle
                stamp(c, sx + 1, cy, ['.kkkk.', 'kgggdk', 'kgddgk', 'kgddgk', 'kdgggk', '.kkkk.'], cone)
            c.rect(sx + 2, 104, sx + 5, 105, rgb('#0e0f15'))                               # the port at the bottom
        put(base, speaker)
        block(sx - 1, 96, sx + 8, 112)
    L['speakers'] = [[sx - 1, 65, 10, 47] for sx in (352, 513)]         # each with its outline: the app makes them thump while the screen is down

    # ── the cinema: six seats in a row, facing the screen ──
    ty = 154
    velvet = Mat('#a8323c', hi='#d0505a', lo='#6e1f27')
    arm = Mat('#3a2a2e', hi='#5a4046', lo='#22181b')
    theatre = []
    for k in range(6):
        sx = 366 + 24 * k

        def nap(x, y, col, seed):                                       # velvet: the pile catches the light unevenly
            n = hsh(x, y, seed) % 7
            return tint(col, 0.10) if n == 0 else shade(col, 0.10) if n == 1 else col

        def seat(c, sx=sx):
            # the cushion, seen from above and behind: lit along its front roll, in the arms' shade at each side, a seam down the middle
            for y in range(ty - 17, ty - 8):
                for x in range(sx + 3, sx + 19):
                    col = velvet.hi if y > ty - 17 else tint(velvet.hi, 0.25)
                    if x in (sx + 3, sx + 18) or y == ty - 9:
                        col = velvet.base
                    c.px(x, y, nap(x, y, col, 51))
            c.rect(sx + 10, ty - 15, sx + 11, ty - 10, mix(velvet.hi, velvet.base, 0.6))
            for ax in (sx, sx + 19):                                    # the arms: dark leather, a walnut cap, and a cup holder with a steel rim
                c.part(rows(ax, ty - 18, ax + 2, ty + 3), arm, hi='t', lo='rb')
                c.rect(ax, ty - 18, ax + 2, ty - 18, rgb('#8f5d38'))
                c.rect(ax, ty - 14, ax + 2, ty - 12, rgb('#9aa3b2')); c.px(ax + 1, ty - 13, rgb('#0e0f15')); c.px(ax, ty - 14, rgb('#dfe6ee'))
                c.rect(ax + 1, ty - 9, ax + 1, ty + 1, arm.hi)          # the light along the top of the arm
        put(base, seat)

        def back(c, sx=sx):
            # the back of the chair, towards us: a rounded head, a rolled rim catching the light, the headrest stitched off below it,
            # channels sewn down the back, and a brass plate with the seat's number low in the middle
            shape = [(ty - 11, sx + 6, sx + 15), (ty - 10, sx + 4, sx + 17)] + rows(sx + 3, ty - 9, sx + 18, ty + 4)
            for y, x0, x1 in shape:
                for x in range(x0, x1 + 1):
                    col = velvet.base
                    if y <= ty - 10:
                        col = velvet.hi                                 # the rim
                    elif y <= ty - 6:
                        col = mix(velvet.base, velvet.hi, 0.45)         # the headrest
                    elif y == ty - 5:
                        col = velvet.lo                                 # its stitching
                    elif y >= ty + 3:
                        col = shade(velvet.lo, 0.25)                    # the skirt, in shade
                    elif (x - sx - 3) % 4 == 3:
                        col = velvet.lo                                 # a channel
                    elif (x - sx - 3) % 4 == 0:
                        col = tint(velvet.base, 0.14)                   # and the swell beside it
                    if x == x1 and ty - 9 <= y < ty + 3:
                        col = velvet.lo
                    c.px(x, y, nap(x, y, col, 52) if ty - 4 <= y < ty + 3 and col == velvet.base else col)
            c.rect(sx + 7, ty - 11, sx + 12, ty - 11, tint(velvet.hi, 0.3))
            c.rect(sx + 10, ty + 1, sx + 11, ty + 1, rgb('#e2a93c')); c.px(sx + 10, ty + 1, rgb('#f6d27a'))
        put_over(back, ty + 3)
        theatre.append(dict(x=sx + 11, y=ty + 2, ax=sx + 11, ay=ty + 14, hit=[sx - 1, ty - 20, 24, 26]))
    block(366, ty - 20, 366 + 24 * 6 - 3, ty + 5)
    L['theatre'] = theatre

    # ── the living room: a sofa facing down the room, an armchair close in on either side, a table between them ──
    fabric = Mat('#3f8f86', hi='#63b9ad', lo='#2a625c')
    plump, deep = mix(fabric.hi, (255, 255, 255), 0.22), mix(fabric.lo, (20, 14, 40), 0.35)
    wood_foot = rgb('#4a3018')
    sx0, sy = 380, 200

    def sofa(c):
        for x in range(sx0 + 2, sx0 + 112):                              # its shadow on the rug
            base.px(x, sy + 33, shade(base.get(x, sy + 33), 0.3))
        c.part([(sy, sx0 + 8, sx0 + 103), (sy + 1, sx0 + 6, sx0 + 105)] + rows(sx0 + 5, sy + 2, sx0 + 106, sy + 13), fabric, hi='t', lo='')      # the back, one long roll
        for k in range(4):                                               # a cushion leaning on it for each seat, buttoned in the middle
            x0 = sx0 + 8 + 24 * k
            c.part([(sy + 2, x0 + 3, x0 + 20), (sy + 3, x0 + 2, x0 + 21)] + rows(x0 + 1, sy + 4, x0 + 22, sy + 13), Mat(fabric.hi, hi=plump, lo=fabric.base), hi='t', lo='rb')
            c.rect(x0 + 11, sy + 8, x0 + 12, sy + 8, fabric.lo)
            for dx in (-3, 3):
                c.px(x0 + 11 + dx + (dx > 0), sy + 7, fabric.base); c.px(x0 + 11 + dx + (dx > 0), sy + 9, fabric.base)
        for k in range(4):                                               # the seat cushions, each plump along its front
            x0 = sx0 + 8 + 24 * k
            c.part(rows(x0, sy + 14, x0 + 23, sy + 24), Mat(fabric.base, hi=fabric.hi, lo=fabric.lo), hi='t', lo='rb')
            c.rect(x0 + 2, sy + 22, x0 + 21, sy + 22, fabric.hi)
        c.part(rows(sx0 + 8, sy + 25, sx0 + 103, sy + 30), Mat(fabric.lo, hi=fabric.base, lo=deep), hi='t', lo='b')         # the skirt under them
        for x in (sx0, sx0 + 104):                                       # rolled arms
            c.part([(sy + 6, x + 2, x + 5), (sy + 7, x + 1, x + 6)] + rows(x, sy + 8, x + 7, sy + 30), fabric, hi='tl', lo='rb')
            c.rect(x + 2, sy + 8, x + 5, sy + 9, plump)
            c.rect(x + 1, sy + 13, x + 6, sy + 13, fabric.lo)
        for x in (sx0 + 2, sx0 + 107):
            c.rect(x, sy + 31, x + 2, sy + 32, wood_foot)
        for x0, col, band in ((sx0 + 9, '#e0a83a', '#fbf3d6'), (sx0 + 93, '#e0705a', '#fbe3da')):                            # a throw pillow at each end
            pm = Mat(col)
            c.part([(sy + 5, x0 + 1, x0 + 8)] + rows(x0, sy + 6, x0 + 9, sy + 13) + [(sy + 14, x0 + 1, x0 + 8)], pm, hi='tl', lo='rb')
            c.rect(x0 + 2, sy + 8, x0 + 7, sy + 8, rgb(band)); c.rect(x0 + 2, sy + 11, x0 + 7, sy + 11, rgb(band))
    put(base, sofa)
    block(sx0, sy, sx0 + 111, sy + 31)
    # (each cushion is a seat of its own; the end ones take in the sofa's arms)
    living = [dict(x=sx0 + 20 + 24 * k, y=sy + 37, ax=sx0 + 20 + 24 * k, ay=sy + 46, side=False, flip=False,
                   hit=[sx0 + (8 + 24 * k if k else 0), sy, 24 + (8 if k in (0, 3) else 0), 32]) for k in range(4)]

    # Two armchairs, seen from the side, facing each other across the table: a leather club chair on the left and a
    # mustard lounge chair on a walnut frame on the right. Each is drawn in two layers, with whoever sits in it between
    # them: the back and the seat behind, then the near arm and the near side in front. The seat is only as deep as a
    # thigh, so their shins and feet hang down in front of the chair, on the floor, as anybody's do.
    walnut = Mat('#6b4226', hi='#96633c', lo='#3d2413')
    ay = 244

    def club_chair(ax):                                                  # faces right: its back is at ax, its front edge at ax + 15
        hide = Mat('#a8582c', hi='#cf7d48', lo='#6e3518')
        sheen, dark = mix(hide.hi, (255, 255, 255), 0.3), mix(hide.lo, (20, 14, 40), 0.4)

        def behind(c):
            for x in range(ax + 2, ax + 17):                             # its shadow on the rug
                base.px(x, ay + 30, shade(base.get(x, ay + 30), 0.3))
            c.part([(ay - 2, ax + 1, ax + 4), (ay - 1, ax, ax + 5)] + rows(ax, ay, ax + 6, ay + 24), hide, hi='tl', lo='rb')      # a deep padded back, rounded over the top
            for by in (ay + 3, ay + 8, ay + 13):                         # buttoned
                c.rect(ax + 3, by, ax + 4, by, hide.lo); c.px(ax + 2, by - 1, hide.hi)
            c.part([(ay + 15, ax + 7, ax + 15)] + rows(ax + 7, ay + 16, ax + 16, ay + 19), Mat(hide.hi, hi=sheen, lo=hide.base), hi='t', lo='rb')      # the seat cushion, bulging at the front
            c.part(rows(ax + 7, ay + 20, ax + 15, ay + 24), Mat(hide.lo, lo=dark), hi='', lo='b')
            for lx in (ax + 2, ax + 13):
                c.rect(lx, ay + 25, lx + 1, ay + 28, walnut.lo)
        put(base, behind)

        def near(c):
            c.part([(ay + 8, ax + 4, ax + 12), (ay + 9, ax + 3, ax + 14)] + rows(ax + 2, ay + 10, ax + 15, ay + 13) + [(ay + 14, ax + 3, ax + 14)], hide, hi='t', lo='b')      # a fat rolled arm
            c.rect(ax + 4, ay + 9, ax + 11, ay + 9, sheen)
            c.rect(ax + 12, ay + 11, ax + 13, ay + 12, hide.lo); c.px(ax + 12, ay + 11, hide.hi)            # the scroll at the front of it
            c.part(rows(ax + 2, ay + 15, ax + 14, ay + 24), Mat(hide.lo, hi=hide.base, lo=dark), hi='t', lo='rb')
            for x in range(ax + 3, ax + 14, 2):                          # brass nails along the bottom
                c.px(x, ay + 24, rgb('#e2c36a'))
            for lx in (ax + 3, ax + 12):
                c.rect(lx, ay + 25, lx + 1, ay + 28, walnut.base); c.px(lx, ay + 25, walnut.hi)
        put_over(near, ay + 31)

    def lounge_chair(ax):                                                # faces left: its back is at ax + 23, its front edge at ax + 8
        wool = Mat('#d9a62e', hi='#f2c85a', lo='#9c7318')
        nap = mix(wool.hi, (255, 255, 255), 0.25)

        def behind(c):
            for x in range(ax + 6, ax + 23):
                base.px(x, ay + 30, shade(base.get(x, ay + 30), 0.3))
            c.rect(ax + 22, ay + 1, ax + 23, ay + 23, walnut.lo)         # the frame up the back
            c.part([(ay - 1, ax + 18, ax + 21)] + rows(ax + 17, ay, ax + 22, ay + 20), wool, hi='tl', lo='rb')      # a slim back cushion, in two pads
            c.rect(ax + 17, ay + 10, ax + 22, ay + 10, wool.lo); c.rect(ax + 17, ay + 11, ax + 21, ay + 11, wool.hi)
            c.part(rows(ax + 8, ay + 16, ax + 17, ay + 20), Mat(wool.hi, hi=nap, lo=wool.base), hi='t', lo='b')     # the seat cushion
            c.rect(ax + 8, ay + 21, ax + 22, ay + 22, walnut.base)       # the rail it rests on
            for k in range(7):                                           # the far legs, splayed
                c.px(ax + 10 - k // 3, ay + 23 + k, walnut.lo); c.px(ax + 20 + k // 3, ay + 23 + k, walnut.lo)
        put(base, behind)

        def near(c):
            c.part(rows(ax + 8, ay + 10, ax + 21, ay + 11), walnut, hi='t', lo='b')            # an open arm: a walnut rail on two posts
            c.px(ax + 8, ay + 10, walnut.hi); c.px(ax + 7, ay + 11, walnut.base)
            c.rect(ax + 9, ay + 12, ax + 10, ay + 20, walnut.base); c.rect(ax + 9, ay + 12, ax + 9, ay + 20, walnut.hi)
            c.rect(ax + 20, ay + 12, ax + 21, ay + 20, walnut.lo)
            c.part([(ay + 15, ax + 9, ax + 19)] + rows(ax + 8, ay + 16, ax + 20, ay + 20), Mat(wool.base, hi=wool.hi, lo=wool.lo), hi='t', lo='b')      # the near edge of the seat cushion, piped
            c.rect(ax + 9, ay + 19, ax + 19, ay + 19, wool.lo)
            c.part(rows(ax + 7, ay + 21, ax + 22, ay + 22), walnut, hi='t', lo='b')
            for k in range(7):                                           # the near legs, splayed and tapering
                c.rect(ax + 8 - k // 3, ay + 23 + k, ax + 9 - k // 3 - (k > 3), ay + 23 + k, walnut.base)
                c.rect(ax + 20 + k // 3 + (k > 3), ay + 23 + k, ax + 21 + k // 3, ay + 23 + k, walnut.base)
        put_over(near, ay + 31)

    for ax, flip, draw in ((364, False, club_chair), (486, True, lounge_chair)):      # the left one faces right, the right one faces left
        draw(ax)
        block(ax, ay + 4, ax + 23, ay + 28)
        x = ax + (8 if not flip else 15)                 # their back against the chair's, their knees at the front of the seat
        living.append(dict(x=x, y=ay + 29, ax=ax + 12 + (24 if not flip else -24), ay=ay + 30, side=True, flip=not flip, hit=[ax, ay, 24, 30]))
    L['living'] = living

    # The coffee table: a slab of glass, rounded like a pebble, on two curved legs of dark walnut that show through it.
    tcx, ty = 435, 257                                                  # the middle of the top, and its far edge
    GLASS, GLINT, RIM = rgb('#cfeee6'), rgb('#f6fffb'), rgb('#7fb3a6')
    # (how far the glass reaches either side of the middle, row by row: its far edge, round the middle, its near edge)
    top_rows = [14, 18, 20, 21, 22, 22, 22, 22, 21, 21, 20, 18, 15, 11]

    def table(c):
        dark = Mat('#4a3022', hi='#6e4a34', lo='#2a1a12')
        for j, hw in enumerate(top_rows):                                 # its shadow on the rug, a little down and across
            for x in range(tcx - hw + 2, tcx + hw + 3):
                if j > 3:
                    base.px(x, ty + j + 8, shade(base.get(x, ty + j + 8), 0.22))
        # the legs, under the glass: two boomerangs of walnut, one lying on the other
        c.part([(ty + 5, tcx - 13, tcx - 2), (ty + 6, tcx - 14, tcx + 2), (ty + 7, tcx - 14, tcx + 6), (ty + 8, tcx - 12, tcx + 9), (ty + 9, tcx - 6, tcx + 11)], dark, hi='t', lo='b')
        c.part([(ty + 9, tcx + 4, tcx + 13), (ty + 10, tcx + 2, tcx + 14), (ty + 11, tcx - 2, tcx + 14), (ty + 12, tcx - 6, tcx + 12)], Mat(dark.lo, hi=dark.base, lo='#1a100a'), hi='t', lo='b')
        for lx, y0, y1 in ((tcx - 13, ty + 8, ty + 19), (tcx + 12, ty + 12, ty + 19), (tcx - 3, ty + 13, ty + 20)):      # where they come down to the floor
            c.rect(lx, y0, lx + 1, y1, dark.lo)
        for j, hw in enumerate(top_rows):                                 # the glass
            y = ty + j
            for x in range(tcx - hw, tcx + hw + 1):
                edge = abs(x - tcx) >= hw - 1 or j == 0 or j == len(top_rows) - 1
                if edge:
                    c.px(x, y, RIM)
                elif c.get(x, y) is None:
                    c.px(x, y, GLINT if (x - tcx + 2 * j) % 17 in (0, 1) else GLASS)
                elif (x - tcx + 2 * j) % 17 in (0, 1):
                    c.px(x, y, mix(c.get(x, y), GLINT, 0.5))             # the gleam goes across the legs too
                else:
                    c.px(x, y, mix(c.get(x, y), GLASS, 0.3))             # (the legs, seen through it)
        # on it: a pile of books, a little tray, and a cap
        for k, (col, x0, x1) in enumerate((('#b9443c', -15, -6), ('#e9e4d8', -16, -7), ('#2f62d8', -15, -5))):
            c.rect(tcx + x0, ty + 3 + 2 * k, tcx + x1, ty + 4 + 2 * k, rgb(col))
            c.rect(tcx + x0, ty + 4 + 2 * k, tcx + x1, ty + 4 + 2 * k, mix(rgb(col), (20, 14, 40), 0.35))
        c.part(rows(tcx - 2, ty + 3, tcx + 4, ty + 5), Mat('#3a3d50', hi='#5b5f78', lo='#22242f'), hi='t', lo='b')
        c.px(tcx, ty + 3, rgb('#e2c36a')); c.px(tcx + 2, ty + 3, rgb('#f4f1e9'))
        c.part([(ty + 6, tcx + 9, tcx + 14), (ty + 7, tcx + 8, tcx + 15), (ty + 8, tcx + 8, tcx + 15)], Mat('#f4f1e9', hi='#ffffff', lo='#c9c4b4'), hi='t', lo='')      # the cap
        c.rect(tcx + 7, ty + 9, tcx + 16, ty + 9, rgb('#2f7d4a')); c.rect(tcx + 10, ty + 7, tcx + 12, ty + 7, rgb('#2f7d4a'))
    put_over(table, ty + 22, edge=False)
    crop = occluders[-1][0]                                              # the bare glass lets whoever is behind it show through
    for col, alpha in ((GLASS, 105), (GLINT, 170)):
        crop[(crop[..., :3] == np.array(col, np.uint8)).all(axis=-1), 3] = alpha
    block(tcx - 22, ty, tcx + 22, ty + 20)

    bx, by = 170, 188                                                   # the boombox: on the shag rug, beside the bean bags

    def boombox(c):
        body = Mat('#3a3d50', hi='#5b5f78', lo='#22242f')
        for x in range(bx + 5, bx + 16):                                # the handle
            c.px(x, by, rgb('#8d93ab'))
        c.px(bx + 4, by + 1, rgb('#8d93ab')); c.px(bx + 16, by + 1, rgb('#8d93ab'))
        c.px(bx + 4, by + 2, rgb('#8d93ab')); c.px(bx + 16, by + 2, rgb('#8d93ab'))
        c.part(rows(bx, by + 3, bx + 20, by + 15), body, hi='t', lo='rb')
        for cx in (bx + 4, bx + 16):                                    # speakers
            c.part(ellipse(cx, by + 10, 3, 3), Mat('#15161d', hi='#2a2c3a'), hi='', lo='')
            c.px(cx, by + 10, rgb('#8d93ab'))
        c.rect(bx + 8, by + 5, bx + 12, by + 8, rgb('#dfe3ea'))         # the tape window
        c.px(bx + 9, by + 7, rgb('#22242f')); c.px(bx + 11, by + 7, rgb('#22242f'))
        for k, col in enumerate(('#e5484d', '#f2c230', '#3fbf63')):     # buttons
            c.rect(bx + 8 + 2 * k, by + 13, bx + 8 + 2 * k, by + 13, rgb(col))
        c.rect(bx + 19, by - 3, bx + 19, by + 2, rgb('#b9c0d0'))        # the aerial
    for x in range(bx + 1, bx + 23):                                    # its shadow on the rug
        base.px(x, by + 17, shade(base.get(x, by + 17), 0.3))
    put(base, boombox)
    block(bx - 2, by + 2, bx + 22, by + 15)
    L['boombox'] = dict(x=bx, y=by, speakers=[[bx + 4, by + 10], [bx + 16, by + 10]], bars=[bx + 8, by + 10, 5, 2])


def snack():
    def fridge(c):
        x = 136
        steel = Mat('#d3dae4', hi='#f3f6fa', lo='#8b96a8')
        c.part(rows(x, 212, x + 19, 264), steel, hi='tl', lo='rb')         # the cabinet
        c.rect(x + 17, 213, x + 18, 263, mix(steel.base, steel.lo, 0.5))   # its right side, turning away from the light
        c.rect(x + 1, 229, x + 18, 229, steel.lo); c.rect(x + 1, 230, x + 18, 230, steel.hi)      # the freezer's door, over the fridge's
        for y0, y1 in ((216, 226), (234, 250)):                           # the handles, each with its shadow
            c.rect(x + 14, y0, x + 15, y1, rgb('#7c8698')); c.rect(x + 16, y0 + 1, x + 16, y1, mix(steel.base, steel.lo, 0.7))
            c.px(x + 14, y0, rgb('#aab3c2'))
        c.rect(x + 3, 236, x + 5, 238, rgb('#e0584f')); c.rect(x + 8, 241, x + 10, 243, rgb('#f2c24b')); c.rect(x + 3, 244, x + 4, 245, rgb('#3b82f6'))     # magnets
        c.rect(x + 4, 248, x + 10, 255, rgb('#fbfbf3')); c.rect(x + 5, 250, x + 9, 250, rgb('#b9c0d0')); c.rect(x + 5, 252, x + 8, 252, rgb('#b9c0d0'))    # a note
        c.rect(x + 1, 262, x + 18, 263, mix(steel.lo, (20, 14, 40), 0.35))                                                                                 # the grille at its foot
    put(base, fridge, shadow=True)

    def counter(c):
        x = 158
        stone = Mat('#e2d2b4', hi='#f6ecd8', lo='#a8946f')
        oak_ = Mat('#9a7150', hi='#b88a63', lo='#6b4b33')
        c.part(rows(x, 232, x + 37, 244), stone, hi='t', lo='')            # the worktop, seen from above
        c.rect(x, 245, x + 37, 245, stone.hi); c.rect(x, 246, x + 37, 246, stone.lo)                # its front edge, and the shade under its lip
        c.part(rows(x, 247, x + 37, 262), oak_, hi='', lo='r')             # the cupboards
        c.rect(x, 247, x + 37, 247, mix(oak_.lo, (20, 14, 40), 0.4))
        for x0, x1 in ((x + 1, x + 11), (x + 13, x + 24), (x + 26, x + 36)):                        # three doors, each a frame round a panel
            c.rect(x0, 249, x1, 260, oak_.base)
            c.rect(x0, 249, x1, 249, oak_.hi); c.rect(x0, 249, x0, 260, oak_.hi)
            c.rect(x0, 260, x1, 260, oak_.lo); c.rect(x1, 249, x1, 260, oak_.lo)
            c.rect(x0 + 2, 251, x1 - 2, 258, mix(oak_.base, oak_.lo, 0.3))
            c.rect(x1 - 3, 253, x1 - 2, 255, rgb('#e2d2b4'))
        c.rect(x, 263, x + 37, 264, mix(oak_.lo, (20, 14, 40), 0.5))       # the kick board, set back in the dark
        c.rect(x + 1, 236, x + 12, 236, stone.lo)                         # what stands on it throws its shade on the stone
        c.rect(x + 15, 237, x + 34, 237, stone.lo)
        c.part(rows(x + 2, 219, x + 11, 235), Mat('#b9443c', hi='#de6a5f', lo='#7a2a26'), hi='tl', lo='rb')      # coffee machine
        c.rect(x + 4, 228, x + 9, 234, rgb('#2a2c3a')); c.rect(x + 5, 230, x + 8, 233, rgb('#5a3a26')); c.px(x + 4, 221, rgb('#ffd84a'))
        c.part(rows(x + 16, 224, x + 33, 236), Mat('#3a3d50', hi='#5b5f78', lo='#22242f'), hi='tl', lo='rb')      # microwave
        c.rect(x + 18, 226, x + 28, 234, rgb('#12131a')); c.rect(x + 19, 227, x + 22, 228, rgb('#2a2c3a')); c.px(x + 31, 227, rgb('#59d98a'))
        c.rect(x + 30, 230, x + 31, 233, rgb('#22242f'))
        c.rect(x + 13, 238, x + 15, 241, rgb('#f4f1e9')); c.rect(x + 13, 242, x + 16, 242, stone.lo)
        # a tulip in a glass of water, at the end of the worktop
        c.rect(x + 34, 238, x + 36, 242, rgb('#d6ecf4')); c.rect(x + 34, 240, x + 36, 242, rgb('#9fd0e6')); c.px(x + 34, 238, rgb('#ffffff'))
        c.rect(x + 34, 243, x + 37, 243, stone.lo)
        c.rect(x + 35, 230, x + 35, 240, rgb('#3f9a5a')); c.px(x + 36, 234, rgb('#2f7d4a')); c.px(x + 34, 236, rgb('#57a555'))
        c.rect(x + 34, 227, x + 36, 229, rgb('#e8507a')); c.px(x + 34, 226, rgb('#e8507a')); c.px(x + 36, 226, rgb('#e8507a'))
        c.px(x + 34, 227, rgb('#ff8fae')); c.px(x + 36, 229, rgb('#b8345a'))
    put(base, counter, shadow=True)

    def kitchen_mat(c):                                                   # a runner on the lino in front of the fridge and the worktop: burnt orange, a paler band inside each edge
        x0, y0, x1, y1 = 137, 268, 195, 277
        wool = [rgb('#b8571f'), rgb('#c2622a'), rgb('#ad4f1a')]
        for y in range(y0, y1 + 1):
            for xx in range(x0, x1 + 1):
                c.px(xx, y, wool[hsh(xx, y, 77) % 3])
        c.rect(x0, y0, x1, y0, rgb('#8a3c12')); c.rect(x0, y1, x1, y1, rgb('#7a3410'))
        c.rect(x0, y0, x0, y1, rgb('#8a3c12')); c.rect(x1, y0, x1, y1, rgb('#7a3410'))
        c.rect(x0 + 3, y0 + 2, x1 - 3, y0 + 2, rgb('#e39a55')); c.rect(x0 + 3, y1 - 2, x1 - 3, y1 - 2, rgb('#e39a55'))
        for xx in range(x0 + 6, x1 - 4, 6):                               # a row of small diamonds down the middle
            c.px(xx, y0 + 4, rgb('#f0c98a')); c.px(xx, y0 + 5, rgb('#f0c98a')); c.px(xx - 1, y0 + 4, rgb('#e39a55')); c.px(xx + 1, y0 + 5, rgb('#e39a55'))
        for y in range(y0 + 1, y1, 2):                                    # the fringe at each end
            c.px(x0 - 1, y, rgb('#e8d2a8')); c.px(x1 + 1, y, rgb('#e8d2a8'))
    put(base, kitchen_mat, edge=False)
    block(134, 210, 197, 266)

    def bowls(c):                                                         # the pets' bowls, down by the plant: food and water, on a mat
        mx0, my0, mx1, my1 = 149, 315, 173, 325
        rubber = Mat('#4a5672', hi='#6d7a9a', lo='#2e3750')
        c.part([(my0, mx0 + 1, mx1 - 1)] + rows(mx0, my0 + 1, mx1, my1 - 1) + [(my1, mx0 + 1, mx1 - 1)], rubber, hi='t', lo='b')      # the mat, with a raised edge
        for x in range(mx0 + 2, mx1 - 1, 2):                              # and a line of stitching round it
            c.px(x, my0 + 1, rubber.hi); c.px(x, my1 - 1, rubber.lo)
        for dx, dy in ((0, 0), (-1, -2), (1, -2), (-2, -1), (2, -1)):     # a paw print between the bowls
            c.px(161 + dx, 322 + dy // 2 - (1 if dy else 0), rubber.hi)
        steel = Mat('#c9ced9', hi='#f6f8fb', lo='#6f7a8a')
        for cx, inside, bits in ((155, rgb('#8a5a34'), (rgb('#b07a48'), rgb('#5f3c22'))), (167, rgb('#6fb8e6'), (rgb('#d6efff'), rgb('#4a8fc4')))):
            c.part(ellipse(cx, 320, 4.4, 2.6), steel, hi='t', lo='b')      # the bowl's rim, seen from above
            c.part(ellipse(cx, 320, 3.2, 1.6), Mat(inside, hi=inside, lo=inside), hi='', lo='')
            c.px(cx - 2, 320, bits[0]); c.px(cx + 1, 319, bits[0]); c.px(cx, 321, bits[1]); c.px(cx + 2, 320, bits[1])      # kibble in one, light on the water in the other
            c.rect(cx - 3, 323, cx + 3, 323, steel.lo)                    # the foot of the bowl
    put(base, bowls, edge=False)
    # the pets: where they eat (standing to the right of the bowls, facing them) and where they like to sit or nap
    L['pets'] = dict(bowl=dict(x=175, y=323), spots=[dict(x=96, y=180), dict(x=160, y=188), dict(x=270, y=162), dict(x=150, y=300),
                                                     dict(x=228, y=270), dict(x=292, y=302), dict(x=436, y=196), dict(x=440, y=300),
                                                     dict(x=500, y=306), dict(x=366, y=190)])
    L['snack'] = [dict(x=146, y=278, face='up'), dict(x=176, y=278, face='up'), dict(x=210, y=262, face='down')]
    # where somebody working out stands: the open wood floor behind the desks
    L['gym'] = [dict(x=150, y=190), dict(x=136, y=206), dict(x=124, y=196), dict(x=138, y=180), dict(x=160, y=178), dict(x=114, y=184)]      # (on the shag rug, between the cat tree and the radio)


def cat_tree():
    """A cat tree at the left end of the shag rug: two posts bound in sisal, a carpeted base with a cubby on it, a
    shelf halfway up and a bed at the top. Pets that climb sit and sleep on it a good part of the time: `perches` are
    the places (where their feet go), and `foot` is where one stands on the floor to jump up."""
    x0, by = 70, 218                                                     # its left edge, and the bottom of its base
    fleece = Mat('#6f8fa3', hi='#93b0c2', lo='#4a6578')
    sisal, wrap = rgb('#c9a268'), rgb('#8a6638')

    def post(c, x, y_top, y_bot):                                         # five dots across: rope wound round it, lit on the left
        for y in range(y_top, y_bot + 1):
            for k in range(5):
                rope = wrap if (y + k) % 3 == 0 else sisal                # the turns of the rope run up to the right
                c.px(x + k, y, tint(rope, 0.28) if k == 0 else tint(rope, 0.12) if k == 1 else shade(rope, 0.32) if k == 4 else shade(rope, 0.12) if k == 3 else rope)

    def shelf(c, x0, x1, y):                                              # a board covered in fleece: its top, and its front edge below
        c.part(rows(x0, y, x1, y + 2), Mat(fleece.hi, hi=tint(fleece.hi, 0.3), lo=fleece.base), hi='t', lo='')
        c.part(rows(x0, y + 3, x1, y + 4), Mat(fleece.lo, lo=shade(fleece.lo, 0.3)), hi='', lo='b')
        for x in range(x0 + 1, x1, 2):                                    # the nap of it
            if hsh(x, y, 51) % 3:
                c.px(x, y + 1, fleece.base)

    def tree(c):
        for x in range(x0 + 2, x0 + 35):                                 # its shadow on the rug
            base.px(x, by + 1, shade(base.get(x, by + 1), 0.3))
        post(c, x0 + 4, by - 44, by - 6)                                 # the tall post, and the short one
        post(c, x0 + 23, by - 28, by - 6)
        shelf(c, x0 - 1, x0 + 33, by - 5)                                # the base
        c.part(rows(x0 + 15, by - 20, x0 + 33, by - 6), fleece, hi='tl', lo='rb')                            # the cubby
        for y in range(by - 19, by - 6, 2):                              # its fleece, row on row
            for x in range(x0 + 16, x0 + 33, 2):
                if hsh(x, y, 52) % 4 == 0:
                    c.px(x, y, fleece.hi)
        c.part(ellipse(x0 + 24, by - 12, 5, 4.4), Mat('#10161c', hi='#10161c', lo='#10161c'), hi='', lo='')     # its round door, dark inside
        c.part([row for row in ellipse(x0 + 24, by - 12, 5, 4.4) if row[0] >= by - 10], Mat('#1d2630', hi='#1d2630', lo='#1d2630'), hi='', lo='')     # a floor to it, catching a little light
        shelf(c, x0 + 12, x0 + 35, by - 33)                              # the shelf halfway up
        c.rect(x0 + 15, by - 28, x0 + 15, by - 23, rgb('#e9e4d8'))        # a toy mouse on a string under it
        c.part(ellipse(x0 + 15, by - 21, 2, 1.6), Mat('#9aa3b2', hi='#c9ced9', lo='#6f7a8a'), hi='t', lo='b')
        c.px(x0 + 13, by - 22, rgb('#ff8fb0')); c.px(x0 + 17, by - 20, rgb('#e9e4d8'))
        shelf(c, x0 - 4, x0 + 16, by - 47)                               # the bed at the top: a tray, with a padded rim all round
        c.part(rows(x0 - 4, by - 50, x0 - 3, by - 46), Mat(fleece.hi, lo=fleece.base), hi='tl', lo='')
        c.part(rows(x0 + 15, by - 50, x0 + 16, by - 46), Mat(fleece.lo), hi='t', lo='r')
        c.rect(x0 - 2, by - 49, x0 + 14, by - 49, fleece.lo)              # (the far rim, seen over the cushion)
    put_over(tree, by + 1)
    block(x0, by - 8, x0 + 32, by)
    L['pets']['tree'] = dict(z=by + 1, foot=dict(x=x0 + 12, y=by + 6),
                             perches=[dict(x=x0 + 6, y=by - 47), dict(x=x0 + 24, y=by - 32), dict(x=x0 + 8, y=by - 5)])


# Every lamp in the room, for the app to light: where its light falls (the middle of the pool, and how far it reaches
# each way), its colour, and how strong it is. The room is shown as it is drawn, and these glows are laid over it.
LIGHTS = []


def light(x, y, rx, ry, colour, strength):
    LIGHTS.append(dict(x=x, y=y, rx=rx, ry=ry, color=colour, a=strength))


def lamps():
    """What lights the room: a lamp on a side table by the sofa, a paper lantern on the floor by the tree, and a brass
    picture light over two of the pictures."""
    brass = Mat('#c9a13a', hi='#f0d27a', lo='#7a5a12')
    chrome = Mat('#aeb8c6', hi='#e6ecf3', lo='#6f7a8a')

    # ── by the sofa: a little round table, and a lamp with a linen shade, lit ──
    tx, ty = 494, 217

    def side_table(c):
        for x in range(tx + 1, tx + 14):                                 # its shadow on the carpet
            base.px(x, ty + 16, shade(base.get(x, ty + 16), 0.3))
        c.rect(tx + 2, ty + 4, tx + 3, ty + 14, WOODM.lo); c.rect(tx + 9, ty + 4, tx + 10, ty + 14, WOODM.lo)
        c.rect(tx + 3, ty + 10, tx + 9, ty + 10, WOODM.lo)
        c.part([(ty, tx + 1, tx + 11)] + rows(tx, ty + 1, tx + 12, ty + 3), WOODM, hi='t', lo='b')
        c.rect(tx + 5, ty - 2, tx + 7, ty, brass.lo); c.rect(tx + 6, ty - 8, tx + 6, ty - 2, brass.base)            # the lamp's foot and its stem
        glowing = Mat('#ffe2a8', hi='#fff6dc', lo='#e0a85a')
        c.part([(ty - 17, tx + 3, tx + 9), (ty - 16, tx + 3, tx + 9), (ty - 15, tx + 2, tx + 10), (ty - 14, tx + 2, tx + 10), (ty - 13, tx + 2, tx + 10),
                (ty - 12, tx + 1, tx + 11), (ty - 11, tx + 1, tx + 11), (ty - 10, tx + 1, tx + 11), (ty - 9, tx + 1, tx + 11)], glowing, hi='t', lo='b')         # the shade
        c.rect(tx + 4, ty - 13, tx + 8, ty - 11, rgb('#fffbee'))          # the bulb showing through it
        c.rect(tx + 9, ty + 1, tx + 10, ty + 1, rgb('#f4f1e9')); c.px(tx + 2, ty + 1, rgb('#b9443c'))                # a coaster, and something small
    put_over(side_table, ty + 16)
    block(tx, ty + 2, tx + 12, ty + 14)
    light(tx + 6, ty - 8, 50, 44, '#ffc878', 0.42)
    light(tx + 6, ty - 12, 12, 10, '#fff1cf', 0.5)

    # ── over the second picture and the last: a picture light, a brass tube on two little arms ──
    for g in (GALLERY[1], GALLERY[-1]):
        (gx, gy), (gw, gh) = g['at'], g['size']
        cx = gx + gw // 2

        def sconce(c, cx=cx, gy=gy):
            c.rect(cx - 4, gy - 7, cx - 4, gy - 4, brass.lo); c.rect(cx + 3, gy - 7, cx + 3, gy - 4, brass.lo)       # the arms, up from the frame
            c.part(rows(cx - 8, gy - 10, cx + 7, gy - 8), brass, hi='t', lo='')                                       # the tube
            c.rect(cx - 7, gy - 8, cx + 6, gy - 8, rgb('#fff3c4'))                                                    # and the light along the underside of it
        put(base, sconce)
        light(cx, gy + gh // 2 - 2, gw // 2 + 14, gh // 2 + 16, '#ffd58a', 0.38)
        light(cx, gy - 6, 12, 6, '#fff1cf', 0.55)

    # ── on the floor in the corner of the living room, by the tree: a paper lantern, three soft bulges of it, lit ──
    px0, py0 = 492, 325                                                 # its middle, and where it stands

    def lantern(c):
        paper = Mat('#ffe3a0', hi='#fff7dc', lo='#e9a94e')
        spans = []
        for j, hw in enumerate((2, 3, 4, 4, 3, 3, 4, 5, 5, 4, 3, 4, 5, 5, 4)):      # from the top down: three bulges, the lowest the widest
            spans.append((py0 - 15 + j, px0 - hw, px0 + hw))
        c.part(spans, paper, hi='tl', lo='rb')
        for y in (py0 - 11, py0 - 6, py0 - 3):                            # the ribs in the paper
            for x in range(px0 - 3, px0 + 4, 2):
                c.px(x, y, paper.lo)
        c.rect(px0 - 1, py0 - 10, px0 + 1, py0 - 4, rgb('#fffdf2'))       # the bulb, through it
        c.rect(px0 - 2, py0, px0 + 2, py0, rgb('#3a2a1a'))                # its little foot
    put_over(lantern, py0 + 1)
    light(px0, py0 - 8, 40, 34, '#ffbe6a', 0.46)
    light(px0, py0 - 8, 10, 10, '#fff1cf', 0.5)

    # (the neon sign's own wash on the wall round it)
    nx, ny, nw, nh = L['neon']['at']
    light(nx + nw // 2, ny + nh // 2, nw // 2 + 16, nh // 2 + 14, '#ffd9a8', 0.3)
    L['lights'] = LIGHTS


def bean_bags():
    """Three big bean bags thrown down together on the shag rug, beside the radio, each lying at its own angle: slumped sacks,
    fatter at one end and tied off at the other, creased, with a hollow in the middle. Each is a seat. Whoever is on
    one lies back in it like somebody in an inner tube: it is behind their head, their back and their waist, and
    their legs are out over the front of it."""
    long, wide = 18.0, 14.5                                              # half its length, and half its width at the middle
    bags = []
    for cx, cy, deg, col in ((214, 190, -24, '#c8453f'), (250, 198, 8, '#2f8f86'), (284, 189, 38, '#6f52b5')):
        base_col = rgb(col)
        tones = dict(hi=mix(base_col, (255, 244, 220), 0.38), mid=base_col, lo=mix(base_col, (20, 14, 40), 0.30), deep=mix(base_col, (20, 14, 40), 0.52))
        ca, sa = math.cos(math.radians(deg)), math.sin(math.radians(deg))

        def where(x, y, cx=cx, cy=cy, ca=ca, sa=sa):
            """How far out from the middle of the sack a dot is: under 1 is on it."""
            dx, dy = x - cx, y - cy
            u, v = dx * ca + dy * sa, -dx * sa + dy * ca                 # along the sack and across it
            return math.hypot(u / long, v / (wide * (1 + 0.16 * u / long)))

        def to_room(u, v, cx=cx, cy=cy, ca=ca, sa=sa):
            return round(cx + u * ca - v * sa), round(cy + u * sa + v * ca)
        for y in range(cy - 24, cy + 26):                                # its shadow on the rug, down and to the right
            for x in range(cx - 24, cx + 26):
                if where(x, y) > 1 and where(x - 1, y - 2) <= 1:
                    base.px(x, y, shade(base.get(x, y), 0.3))

        def sack(c, cx=cx, cy=cy, tones=tones, where=where, to_room=to_room):
            for y in range(cy - 24, cy + 25):
                for x in range(cx - 24, cx + 25):
                    r = where(x, y)
                    if r > 1:
                        continue
                    lx, ly = (x - cx) / 20.0, (y - cy) / 18.0             # lit from the top left, whichever way it lies
                    t = 'mid'
                    if lx * 0.7 + ly * 0.9 < -0.5 and r > 0.5:
                        t = 'hi'
                    if lx * 0.6 + ly > 0.6 or (r > 0.9 and lx + ly > 0):
                        t = 'lo'
                    if ly > 0.78 and r > 0.8:
                        t = 'deep'
                    if r < 0.44:                                          # the hollow: its far side in the rim's shadow
                        t = 'deep' if lx + ly < -0.08 else 'lo'
                    c.px(x, y, tones[t])
            for k in range(7):                                            # creases, from the hollow out to the edge
                ang = 0.3 + k * 2 * math.pi / 7
                for rr in (0.52, 0.6, 0.68, 0.76, 0.84):
                    x, y = to_room(math.cos(ang) * rr * long, math.sin(ang + 0.25 * rr) * rr * wide)
                    if c.get(x, y) is not None and c.get(x, y) != tones['deep']:
                        c.px(x, y, tones['lo'])
            kx, ky = to_room(-long * 0.9, 0)                              # tied off at the thin end
            c.rect(kx - 1, ky - 1, kx, ky, tones['deep'])
            gx, gy = to_room(long * 0.35, -wide * 0.62)                   # a gleam where the light catches the fat end
            if c.get(gx, gy) is not None:
                c.rect(gx - 1, gy, gx + 1, gy, mix(tones['hi'], (255, 255, 255), 0.45))
        put_over(sack, cy + 13)                                           # a pet or a person walking past behind it is behind it; whoever sits in it (their feet 18 below its middle) is in front
        block(cx - 10, cy - 8, cx + 10, cy + 8)
        # their feet are 18 below its middle: so it reaches from over their head to their thighs, and their shins are clear of it
        bags.append(dict(x=cx, y=cy + 18, ax=cx, ay=cy + 26, hit=[cx - 17, cy - 16, 34, 36]))
    L['bags'] = bags


def arcade():
    """An old arcade cabinet against the west wall, below the first desk, seen from the side: its back is to the
    wall and it faces into the room. A dark laminate side with gold edging down its front, the head with the
    marquee jutting out at the top (no name on it: a zigzag in red, orange and gold along the side, and the lit
    glass showing at the front), the screen leaning back under it, the control panel sticking out with its stick,
    and three stripes running down the side below. It is a picture and nothing more: nothing on it moves or
    flashes. Whoever plays stands at its front, facing it (`L['arcade']`: where their feet go, and the part of the
    picture that is the machine, to be clicked)."""
    x0, B = 6, 216                                                      # the wall it stands against, and the row its foot stands on
    T = B - 41                                                          # the top of it
    shell = Mat('#2c2634', hi='#4a4257', lo='#18141e')
    gold = Mat('#e2a93c', hi='#f6d27a', lo='#9a6c1c')
    glass = Mat('#ffdf9a', hi='#fff4d2', lo='#f0b85c')
    panel = Mat('#4a4257', hi='#6c6280', lo='#2a2433')

    def front(r):                                                       # how far out from the wall its front is, on each row down from the top
        if r < 2:
            return 17                                                   # the roof
        if r < 9:
            return 18                                                   # the head, with the marquee
        if r < 11:
            return 15                                                   # tucked in under it
        if r < 23:
            return 13 + (r - 11) // 4                                   # the screen, leaning back
        if r < 27:
            return 19                                                   # the control panel
        return 15

    def cabinet(c):
        for r in range(42):
            y, e = T + r, front(r)
            for k in range(e + 1):
                col = tint(shell.hi, 0.12) if r == 0 else shell.hi if r == 1 else shade(shell.lo, 0.35) if r >= 40 else shell.lo if k < 2 else shell.base
                c.px(x0 + k, y, col)
            if 2 <= r < 40:
                c.px(x0 + e, y, gold.base)                              # the gold edging, down the front of the side
        for r in range(3, 8):                                           # the marquee's lit glass, seen edge on
            c.px(x0 + 17, T + r, glass.base); c.px(x0 + 18, T + r, glass.hi)
        for k in range(3, 16):                                          # and along the side of the head, a zigzag: red, orange, gold
            dip = (0, 1, 2, 1)[k % 4]
            for j, col in enumerate(('#e0583a', '#f08a2c', '#e2a93c')):
                c.px(x0 + k, T + 3 + dip + j, rgb(col))
        c.rect(x0 + 2, T + 9, x0 + 15, T + 10, shell.lo)                # the shade under the head
        lit = ('#3f8f86', '#3f8f86', '#e9d9b0', '#3f8f86', '#f2c230', '#3f8f86', '#3f8f86', '#e0584f', '#3f8f86', '#d98ac0', '#3f8f86')
        for n, r in enumerate(range(12, 23)):                           # the screen: its dark surround, and the picture's light at the edge
            e = front(r)
            c.px(x0 + e - 1, T + r, rgb('#100e16')); c.px(x0 + e, T + r, rgb(lit[n]))
        c.rect(x0 + 12, T + 23, x0 + 19, T + 23, panel.hi)              # the control panel: its top catches the light
        c.rect(x0 + 12, T + 24, x0 + 19, T + 25, panel.base)
        c.rect(x0 + 2, T + 26, x0 + 19, T + 26, shell.lo)
        c.px(x0 + 19, T + 24, gold.base); c.px(x0 + 19, T + 25, gold.lo)
        c.rect(x0 + 17, T + 21, x0 + 17, T + 22, rgb('#c9ced9'))         # the stick...
        c.part(rows(x0 + 16, T + 19, x0 + 18, T + 20), Mat('#e5484d', hi='#ff8a80', lo='#9a2428'), hi='tl', lo='rb')      # ...and its ball
        for r in range(28, 39):                                         # three stripes running down across the side
            for k, col in enumerate(('#e0583a', '#f08a2c', '#e2a93c')):
                x = 1 + (r - 28) + 3 * k
                for xx in (x, x + 1):
                    if 2 <= xx <= 14:
                        c.px(x0 + xx, T + r, rgb(col))
    for x in range(x0 + 1, x0 + 18):                                    # its shadow on the floor
        base.px(x, B + 1, shade(base.get(x, B + 1), 0.3))
    put_over(cabinet, B + 1)
    block(x0, B - 8, x0 + 19, B)
    L['arcade'] = dict(x=x0 + 35, y=B + 1, ax=x0 + 42, ay=B + 2, hit=[x0, T, 21, 43])
    light(x0 + 20, T + 14, 15, 12, '#ffd58a', 0.3)                      # the marquee's and the screen's own light, steady


def trash_can():
    """A galvanised dustbin in the kitchen's near right-hand corner, its lid off: ribbed sides, a raised band near
    the top and another near the foot, a handle each side, and a rolled rim round the open mouth, with a little of
    what is already in it showing. It is what paper is thrown at: `L['trash']` says where its mouth is (the point
    on the floor under the middle of it, and how high up the rim is), how wide the mouth is, and which part of the
    picture is the bin, to be clicked."""
    x0, B = 331, 324                                                    # its left edge, and the row its foot stands on
    T, cx = B - 19, x0 + 7                                              # the top of its rim, and its middle
    steel = Mat('#aeb6c2', hi='#e6ebf0', lo='#6f7885')
    dark = shade(steel.lo, 0.35)

    def can(c):
        for y in range(T + 4, B + 1):                                   # the body: a little narrower at the foot, ribbed all the way round
            inset = 1 if y > B - 6 else 0
            for x in range(x0 + inset, x0 + 15 - inset):
                k = x - x0
                col = steel.hi if k % 3 == 0 else steel.base if k % 3 == 1 else steel.lo
                if k >= 11:                                             # its right side, turning away from the light
                    col = shade(col, 0.22 + 0.06 * (k - 11))
                c.px(x, y, col)
        for by in (T + 8, B - 4):                                       # the two raised bands
            c.rect(x0, by, x0 + 14, by, steel.hi); c.rect(x0, by + 1, x0 + 14, by + 1, steel.lo)
            c.px(x0 + 13, by, steel.base); c.px(x0 + 14, by, steel.lo)
        c.rect(x0 + 1, B, x0 + 13, B, dark)                             # the foot
        for hx in (x0 - 1, x0 + 15):                                    # a handle each side
            c.rect(hx, T + 10, hx, T + 12, steel.lo); c.px(hx, T + 10, steel.base)
        # the open mouth: a rolled rim, dark inside, with a wad or two of paper already in there
        c.part(ellipse(cx, T + 3, 7.4, 3.4), Mat(steel.hi, hi='#ffffff', lo=steel.lo), hi='t', lo='b')
        c.part(ellipse(cx, T + 3, 5.8, 2.2), Mat('#23252d', hi='#15161c', lo='#2e3039'), hi='t', lo='')
        c.rect(cx - 3, T + 4, cx - 2, T + 4, rgb('#f4f1e9')); c.px(cx - 1, T + 4, rgb('#bdb8aa')); c.px(cx + 2, T + 4, rgb('#f4f1e9')); c.px(cx + 3, T + 3, rgb('#bdb8aa'))
    for x in range(x0 + 1, x0 + 17):                                    # its shadow on the lino
        base.px(x, B + 1, shade(base.get(x, B + 1), 0.3))
    put_over(can, B + 1)
    block(x0, B - 5, x0 + 14, B)
    L['trash'] = dict(x=cx, y=B - 3, rim=13, rx=6.5, ry=3.8, hit=[x0 - 1, T - 1, 17, 22])


def wad_sheet():
    """A wad of paper, screwed up: what is thrown at the bin (in somebody's hand, in the air, and lying where it missed)."""
    t = Cv(7, 7)
    stamp(t, 1, 1, ['.www.', 'wwsww', 'wswww', 'wwwsw', '.wsw.'], dict(w=rgb('#f6f4ec'), s=rgb('#c4c0b2')))
    return outline(t.a)


def ball_sheet():
    """The football that is kicked round the room: four pictures of it side by side, each a quarter turn on from the
    last, for the app to step through as it rolls. Where it lies when the server starts: on the lounge's carpet,
    between the theatre seats and the sofa, at the left."""
    t = Cv(11, 11)
    item_ball(t, 1, 1)
    one = outline(t.a)
    L['ball'] = dict(x=380, y=178, size=11)
    return np.hstack([np.rot90(one, -k) for k in range(4)])


DRINKS = ['beer', 'coffee', 'tiki', 'water', 'coke']


def drinks_sheet():
    """What comes out of the fridge, as it looks in somebody's hand: each in a box 10 dots by 14, standing on the bottom of it, side by side in the
    order of DRINKS. A bottle of beer in amber glass, a mug of coffee steaming, a tiki mug with a paper umbrella and a
    straw, a bottle of water, and a red can that is definitely not Coke."""
    t = Cv(10 * len(DRINKS), 14)
    pics = dict(
        beer=(['...cc...', '...aa...', '...aa...', '...aa...', '..ahad..', '..ahad..', '..llll..', '..lrll..', '..ahad..', '..ahad..', '..aadd..'],      # a long-neck, in amber glass
              dict(c='#d9b24a', a='#b5651d', d='#7a3e12', h='#f0b060', l='#f1e7c8', r='#c0392b')),
        coffee=(['..s..s..', '...s..s.', '..s..s..', '........', '.wwwwww.', '.wbbbbwk', '.wwwwwwk', '.wwwwwk.', '..wwww..', '........'],
                dict(s='#cfd6e6', w='#f4f1e9', b='#5a3a26', k='#c9c2b4')),
        tiki=(['...pp...', '..pppp.g', '.pppppg.', '...k.g..', '.tttttt.', '.tetett.', '.tttttt.', '.tmmmmt.', '.tttttt.', '..tttt..'],
              dict(p='#ff6fa8', g='#59d98a', k='#3a2a1a', t='#8a5a3c', e='#2a1a10', m='#f2c24b')),
        water=(['...bb...', '...bb...', '..cccc..', '.cccccc.', '.cwcccc.', '.cwcccc.', '.llllll.', '.cwcccc.', '.cccccc.', '..cccc..'],
               dict(b='#2f62d8', c='#a9d5e6', w='#f2fbff', l='#f4f6f9')),
        coke=(['........', '..ssss..', '.rrrrrr.', '.rrrrrr.', '.rwwrrr.', '.rrwwrr.', '.rrrwwr.', '.rrrrrr.', '.rrrrrr.', '..ssss..'],
              dict(r='#d8342c', w='#fbf9f2', s='#c9ced9')),
    )
    for k, name in enumerate(DRINKS):
        lines, colours = pics[name]
        while lines and not lines[-1].strip('.'):              # each stands on the bottom of its box, whatever its height
            lines = lines[:-1]
        stamp(t, 1 + 10 * k, 13 - len(lines), lines, {ch: rgb(c) for ch, c in colours.items()})
    return outline(t.a)


def kitchen_table():
    """A tall table with stools, out in the open floor of the kitchen. People in the side room (the second voice chat) sit here."""
    top = Mat('#b98a5a', hi='#d9ab78', lo='#7d5836')
    pad = Mat('#c0392b', hi='#e0574a', lo='#8a2a20')
    steel = rgb('#3b3f4d')
    ox, oy = 34, -28                                                     # how far it stands from where it used to, by the door

    def stool(c, x, y):                                                  # x is its left edge, y the top of the seat
        c.part(rows(x, y, x + 9, y + 2), pad, hi='t', lo='b')
        c.rect(x + 1, y + 3, x + 1, y + 11, steel); c.rect(x + 8, y + 3, x + 8, y + 11, steel)
        c.rect(x + 1, y + 8, x + 8, y + 8, steel)
    for sx, sy in ((198, 293), (277, 293), (237, 308), (237, 262)):      # the last one stands behind the table: only its seat shows over the top
        put(base, lambda c, sx=sx, sy=sy: stool(c, sx + ox, sy + oy), shadow=True)

    for y in range(297 + oy, 309 + oy):                                  # the floor under the table, in its shade
        for x in range(219 + ox, 266 + ox):
            base.px(x, y, shade(base.get(x, y), 0.24))

    def table(c):
        c.part(rows(216 + ox, 270 + oy, 267 + ox, 291 + oy), top, hi='t', lo='')
        c.part(rows(216 + ox, 292 + oy, 267 + ox, 296 + oy), Mat(top.lo), hi='', lo='b')
        c.rect(219 + ox, 297 + oy, 220 + ox, 306 + oy, top.lo); c.rect(263 + ox, 297 + oy, 264 + ox, 306 + oy, top.lo)
        game_table(c, 218 + ox, 272 + oy)
    put_over(table, 300 + oy)                                            # whoever sits behind it is drawn behind it
    block(216 + ox, 280 + oy, 267 + ox, 306 + oy)
    block(198 + ox, 296 + oy, 207 + ox, 305 + oy); block(277 + ox, 296 + oy, 286 + ox, 305 + oy)
    # `hit` is the part of the picture that is that seat, for clicking: [x, y, width, height]
    seats = [dict(x=203, y=306, ax=192, ay=309, kind='side', flip=True, hit=[196, 291, 14, 16]), dict(x=281, y=306, ax=292, ay=309, kind='side', flip=False, hit=[275, 291, 14, 16]),
             dict(x=242, y=288, ax=242, ay=270, kind='front', flip=False, hit=[235, 260, 14, 10]), dict(x=242, y=322, ax=242, ay=322, kind='back', flip=False, hit=[235, 306, 14, 15])]
    L['table'] = [dict(q, x=q['x'] + ox, y=q['y'] + oy, ax=q['ax'] + ox, ay=q['ay'] + oy, hit=[q['hit'][0] + ox, q['hit'][1] + oy] + q['hit'][2:]) for q in seats]
    L['games'] = [216 + ox, 270 + oy, 52, 28]                            # the table top: click it to open the games


def game_table(c, x, y):
    """What is on the kitchen table: a chess board in the middle of a game, and a hand of cards beside it with the
    rest of the deck and some chips. (x, y) is the board's corner. The board is seen at the room's slant, so a square
    is three dots wide and two deep, and the pieces stand up from their squares."""
    light, dark, rim = rgb('#e6cc98'), rgb('#a8744a'), rgb('#33221a')
    c.rect(x, y, x + 25, y + 17, rim)
    for r in range(8):
        for f in range(8):
            c.rect(x + 1 + 3 * f, y + 1 + 2 * r, x + 3 + 3 * f, y + 2 + 2 * r, light if (r + f) % 2 == 0 else dark)
    white, white_lo, black, black_hi = rgb('#ffffff'), rgb('#a9a498'), rgb('#15131b'), rgb('#55526a')
    # (solid little men, told apart by their height and their heads: at this size anything finer is lost)
    shapes = dict(p=['.#.', '###', '###'], r=['#.#', '###', '###', '###'], b=['.#.', '.#.', '###', '###'],
                  q=['#.#', '###', '.#.', '###', '###'], k=['.#.', '###', '.#.', '###', '###'])
    # file, rank (0 is the far side), piece, and whose it is: an endgame, so every piece stands clear of the others
    for f, r, kind, mine in ((5, 1, 'k', 0), (2, 1, 'q', 0), (0, 2, 'r', 0), (6, 3, 'p', 0), (3, 3, 'p', 0),
                             (4, 5, 'b', 1), (1, 5, 'p', 1), (5, 6, 'p', 1), (2, 7, 'k', 1), (6, 7, 'r', 1)):
        lines = shapes[kind]
        px0, foot = x + 1 + 3 * f, y + 2 + 2 * r
        for j, line in enumerate(lines):
            for i, ch in enumerate(line):
                if ch == '#':
                    last = j == len(lines) - 1
                    c.px(px0 + i, foot - (len(lines) - 1) + j, (white_lo if i == 2 and j else white) if mine else (black_hi if i == 0 and j else black))
    # the cards: the deck face down, three of a hand face up, and two short stacks of chips
    cx = x + 28
    back = dict(w=rgb('#f4f1e9'), b=rgb('#2f55b0'), B=rgb('#6f8fe0'), k=rgb('#b9b3a2'))
    stamp(c, cx + 1, y, ['wwwwwww', 'wbBbBbw', 'wBbBbBw', 'wbBbBbw', 'wBbBbBw', 'wwwwwww', 'kkkkkkk', 'kkkkkkk'], back)
    for k, col in enumerate(('#d8342c', '#2f62d8')):
        for j in range(3 if k == 0 else 2):
            c.rect(cx + 11 + 5 * k, y + 5 - 2 * j, cx + 14 + 5 * k, y + 6 - 2 * j, rgb(col))
            c.rect(cx + 11 + 5 * k, y + 5 - 2 * j, cx + 14 + 5 * k, y + 5 - 2 * j, mix(rgb(col), (255, 255, 255), 0.45))
    face = dict(w=rgb('#fbf9f2'), k=rgb('#1b1c22'), r=rgb('#d8342c'), e=rgb('#b9b3a2'))
    hands = (['wwwwwww', 'wrrwrrw', 'wrrrrrw', 'wrrrrrw', 'wwrrrww', 'wwwrwww', 'eeeeeee'],        # a heart
             ['wwwwwww', 'wwwkwww', 'wwkkkww', 'wkkkkkw', 'wkwkwkw', 'wwkkkww', 'eeeeeee'],                          # a spade
             ['wwwwwww', 'wwwrwww', 'wwrrrww', 'wrrrrrw', 'wwrrrww', 'wwwrwww', 'eeeeeee'])                          # a diamond
    for k, lines in enumerate(hands):
        stamp(c, cx + 6 * k + (0 if k < 2 else 1), y + 10 + (k == 1), lines, face)


def bathroom():
    """Down the west wall: a laundry basket, then the toilet in the near corner. The sink is on the back wall and
    the shower in the near right corner, below the door."""
    for y in range(BATH['floor'], FLOOR_END + 1):                        # the floor is worn darker along the wall the fittings hang on, and under the back wall
        for x in range(BATH['x0'], BATH['x0'] + 4):
            base.px(x, y, shade(base.get(x, y), 0.20 - 0.05 * (x - BATH['x0'])))
    for y in range(BATH['floor'] + 3, BATH['floor'] + 6):
        for x in range(BATH['x0'], BATH['x1'] + 1):
            base.px(x, y, shade(base.get(x, y), 0.10))

    def hamper(c):                                                        # a wicker laundry basket against the west wall, a towel over its rim
        wicker = Mat('#c9a268', hi='#e6c890', lo='#8a6638')
        c.part([(256, 7, 18)] + rows(6, 257, 19, 272) + [(273, 7, 18)], wicker, hi='t', lo='rb')
        for y in range(259, 272, 2):                                      # the weave
            for x in range(7 + (y // 2) % 2, 19, 2):
                c.px(x, y, wicker.lo)
        c.rect(6, 264, 19, 264, wicker.hi)                                # a band round its middle
        c.part(ellipse(12, 256, 6, 2.4), Mat('#3a2a1a', hi='#5f4426', lo='#e6c890'), hi='t', lo='b')      # its open mouth
        c.part(rows(13, 253, 18, 261), Mat('#5fb3a8', hi='#8fd3c9', lo='#3a8078'), hi='t', lo='rb')     # the towel
        c.rect(13, 258, 18, 258, rgb('#f4f6f9'))
    put(base, hamper, shadow=True)

    def toilet(c):
        c.part(rows(6, 286, 17, 310), PORC, hi='t', lo='rb')                # tank on the west wall
        c.rect(9, 288, 13, 289, rgb('#b7c0cf'))
        c.rect(15, 288, 16, 289, rgb('#c9ced9'))                          # the flush, on the tank
        c.rect(6, 309, 17, 310, PORC.lo)                                  # the tank's shade on the seat
        c.part([(306, 18, 34), (307, 17, 36)] + rows(16, 308, 37, 313) + [(314, 17, 36), (315, 19, 34)], PORC, hi='t', lo='b')
        c.rect(20, 308, 33, 309, rgb('#c5d6e6'))
        c.rect(20, 308, 33, 308, rgb('#9db4c8')); c.rect(20, 310, 33, 311, rgb('#dfeaf3'))            # the water in the bowl, dark at the back
        c.part(rows(22, 316, 32, 321), PORC, hi='', lo='rb')
        c.rect(22, 316, 32, 316, PORC.lo)                                 # the foot of it, in the bowl's shade
    put(base, toilet, shadow=True)

    def sink(c):
        c.part(rows(84, 237, 105, 252), Mat('#8a5a3c'), hi='t', lo='rb')    # mirror
        c.rect(86, 239, 103, 250, rgb('#bfe0ee'))
        for i in range(5):
            c.px(89 + i, 248 - i, rgb('#f2fbff')); c.px(93 + i, 248 - i, rgb('#f2fbff'))
        c.rect(86, 253, 103, 253, rgb('#c9d6e2'))                         # a glass shelf under the mirror, with a cup and a brush on it
        c.rect(88, 250, 89, 252, rgb('#7fd0c9')); c.rect(90, 248, 90, 252, rgb('#ff8fc0'))
        c.part([(258, 85, 104)] + rows(84, 259, 105, 266) + [(267, 86, 103)], PORC, hi='t', lo='b')
        c.rect(88, 261, 101, 264, rgb('#c5d6e6'))
        c.rect(88, 261, 101, 261, rgb('#9db4c8')); c.rect(88, 261, 88, 264, rgb('#aec2d4'))          # the basin, in shade under its rim
        c.rect(94, 263, 95, 263, rgb('#6f8296'))                          # the plug hole
        c.rect(94, 254, 95, 259, rgb('#9aa3b2')); c.px(94, 254, rgb('#dfe6ee')); c.rect(92, 255, 97, 255, rgb('#9aa3b2'))      # the tap, with its two handles
        c.part(rows(91, 268, 98, 276), PORC, hi='', lo='rb')
        c.rect(91, 268, 98, 268, PORC.lo)                                 # the pedestal, in the basin's shade
    put(base, sink, shadow=True)

    def extras(c):
        c.rect(20, 292, 26, 294, rgb('#ffffff')); c.rect(22, 293, 24, 293, rgb('#c9c2b4'))      # paper roll, on the wall beside the tank
        c.rect(20, 295, 26, 299, rgb('#f4f4f4'))
        c.part(rows(112, 238, 121, 259), Mat('#5fb3a8', hi='#8fd3c9', lo='#3a8078'), hi='t', lo='rb')   # towel
        c.part(rows(64, 308, 92, 320), Mat('#6b9bd1', hi='#93b9e3', lo='#4a74a6'), hi='t', lo='b')      # bath mat, where you step out of the shower
        for x in range(68, 90, 6):
            c.rect(x, 311, x + 2, 317, rgb('#93b9e3'))
        c.rect(10, 303, 11, 321, rgb('#c59a62')); c.px(10, 303, rgb('#e2c08d')); c.px(11, 303, rgb('#e2c08d'))    # plunger: in the corner, its long wooden handle up in front of the tank
        c.part([(322, 9, 12), (323, 8, 13), (324, 7, 14), (325, 6, 15), (326, 6, 16)], Mat('#b9443c', hi='#de6a5f', lo='#7a2a26'), hi='t', lo='')
        c.rect(6, 327, 16, 327, rgb('#7a2a26'))                                                                   # the rubber cup's rim
    put(base, extras)

    def hanging(c):                                                      # a trailing plant in a pot, hung from a hook on the bare stretch of the back wall
        hx = 60
        c.px(hx, 236, rgb('#9aa3b2'))
        for i in range(7):                                               # the cords down to the pot
            c.px(hx - round(4 * i / 6), 237 + i, rgb('#d9c9a3')); c.px(hx + round(4 * i / 6), 237 + i, rgb('#d9c9a3'))
        c.part([(244, hx - 5, hx + 5), (245, hx - 5, hx + 5), (246, hx - 4, hx + 4), (247, hx - 4, hx + 4), (248, hx - 3, hx + 3), (249, hx - 2, hx + 2)],
               Mat('#e9e2cf', hi='#fffaf0', lo='#b3a88c'), hi='tl', lo='rb')
        leaf = [rgb('#2f6b3a'), rgb('#3f8a47'), rgb('#57a555')]
        for y in range(240, 245):                                        # the leaves heaped over its rim
            for x in range(hx - 6, hx + 7):
                if math.hypot((x - hx) / 6.5, (y - 244) / 4.5) < 1 and hsh(x, y, 91) % 6:
                    c.px(x, y, leaf[hsh(x, y, 92) % 3])
        for dx, n in ((-6, 11), (-3, 6), (5, 14), (7, 8), (1, 4)):       # and what trails down from it
            for i in range(n):
                x = hx + dx + round(math.sin(i / 2.0 + dx))
                c.px(x, 245 + i, leaf[(i + dx) % 3])
                if i % 3 == 1:
                    c.px(x + (1 if (i + dx) % 2 else -1), 245 + i, leaf[2])
    put(base, hanging)

    # ── the shower: a glass box in the corner, with a curtain you can just see through drawn across the front ──
    # Its floor is the tray (rows ty0 to y1); the box stands `top` high over it, and all of that is shut to feet.
    x0, x1, top, ty0, y1 = 98, 124, 284, 306, 326
    chrome = Mat('#aeb8c6', hi='#e6ecf3', lo='#6f7a8a')
    pane, glint = rgb('#bfe6f5'), rgb('#f2fbff')

    def tray(c):
        c.part(rows(x0, ty0, x1, y1), Mat('#c9d6e2', hi='#eef4f9', lo='#8fa3b5'), hi='tl', lo='rb')       # the rim
        for y in range(ty0 + 2, y1 - 1):
            for x in range(x0 + 2, x1 - 1):
                c.px(x, y, rgb('#8fc3d8') if (x // 4 + y // 4) % 2 == 0 else rgb('#a9d5e6'))
        c.rect(110, 317, 112, 318, rgb('#4a5562'))                         # the drain
    put(base, tray, shadow=True)
    for y in range(top + 3, ty0):                                         # the back pane: what is behind the box shows through it, a little blue
        for x in range(x0 + 1, x1):
            base.px(x, y, mix(base.get(x, y), glint if (x - y) % 23 in (0, 1) else pane, 0.32))

    def plumbing(c):                                                     # inside, at the back: the riser up the corner, and the head over the middle
        c.part(rows(120, top + 5, 121, ty0 + 2), chrome, hi='l', lo='r')
        c.rect(113, top + 5, 121, top + 6, chrome.base); c.rect(113, top + 5, 121, top + 5, chrome.hi)
        c.part([(top + 7, 109, 115), (top + 8, 108, 116), (top + 9, 108, 116)], chrome, hi='t', lo='b')
        for x in (109, 111, 113, 115):
            c.px(x, top + 9, rgb('#3d4654'))
        c.rect(119, 298, 122, 300, chrome.lo); c.px(120, 299, rgb('#e5484d')); c.px(121, 299, rgb('#4f9cf0'))    # the tap
    put(base, plumbing)

    def front(c):                                                        # the front of the box, which whoever is inside stands behind
        c.rect(x0, top + 3, x1, y1 - 2, pane)                             # the glass (made see-through below)
        for y in range(top + 3, y1 - 1):
            for x in range(x0 + 1, x1):
                if (x + y) % 19 in (0, 1):
                    c.px(x, y, glint)
        for y in range(top + 4, y1 - 5):                                  # the curtain: folds every four dots, and a scalloped hem
            for x in range(x0 + 1, x1):
                hem = y1 - 6 - (1 if (x - x0) % 4 in (0, 3) else 0)
                if y <= hem:
                    c.px(x, y, CURTAIN[(x - x0) % 4])
        c.part(rows(x0, top, x1, top + 2), chrome, hi='t', lo='b')        # the frame: a rail across the top, a post each side, the sill
        for x in (x0, x1):
            c.part(rows(x, top + 3, x, y1), chrome, hi='', lo='')
        c.rect(x0, y1 - 1, x1, y1, chrome.lo); c.rect(x0, y1 - 1, x1, y1 - 1, chrome.base)
        for x in range(x0 + 2, x1, 4):                                    # the curtain's rings
            c.px(x, top + 3, chrome.lo)
    CURTAIN = [rgb('#e8f4fa'), rgb('#ffffff'), rgb('#d3e6f0'), rgb('#b9d2e0')]
    put_over(front, y1 + 1, edge=False)
    crop = occluders[-1][0]                                              # glass and curtain let whoever is behind them show through
    for col, alpha in [(pane, 60), (glint, 120)] + [(c, 120 if k < 2 else 150) for k, c in enumerate(CURTAIN)]:
        crop[(crop[..., :3] == np.array(col, np.uint8)).all(axis=-1), 3] = alpha
    block(x0, top + 4, x1, y1)
    L['shower'] = dict(x=111, y=322, ax=111, ay=285, rect=[x0, top, x1 - x0 + 1, y1 - top + 1])
    L['showerWait'] = dict(x=78, y=316, ax=78, ay=316)                  # on the bath mat, when somebody else is in there

    block(4, 284, 38, 322)
    block(4, 251, 20, 275)
    block(82, 256, 107, 278)
    base.rect(123, 256, 125, 262, rgb('#f4f6f9'))                       # light switch on the wall by the door
    base.rect(124, 258, 124, 259, rgb('#3a3d50'))
    L['bath'] = dict(rect=[4, BATH['wall_top'] + 2, 124, H - 3 - BATH['wall_top'] - 2 + 1], switch=dict(x=117, y=285), plate=[123, 256, 3, 7])
    L['toilet'] = dict(x=28, y=320, ax=56, ay=314)


FONT = {
    'A': ['010', '101', '111', '101', '101'], 'C': ['011', '100', '100', '100', '011'], 'D': ['110', '101', '101', '101', '110'],
    'E': ['111', '100', '110', '100', '111'], 'F': ['111', '100', '110', '100', '100'], 'H': ['101', '101', '111', '101', '101'],
    'I': ['111', '010', '010', '010', '111'], 'M': ['10001', '11011', '10101', '10001', '10001'], 'N': ['1001', '1101', '1011', '1001', '1001'],
    'O': ['111', '101', '101', '101', '111'], 'P': ['110', '101', '110', '100', '100'], 'R': ['110', '101', '110', '101', '101'],
    'S': ['011', '100', '010', '001', '110'], 'T': ['111', '010', '010', '010', '010'], 'V': ['101', '101', '101', '101', '010'],
    'W': ['10001', '10001', '10101', '11011', '10001'], 'Y': ['101', '101', '010', '010', '010'],
    'o': ['000', '000', '111', '101', '111'], '2': ['110', '001', '010', '100', '111'], ' ': ['0', '0', '0', '0', '0'],
    'G': ['011', '100', '101', '101', '011'], 'U': ['101', '101', '101', '101', '111'], 'L': ['100', '100', '100', '100', '111'],
    'Q': ['111', '101', '101', '111', '001'],
}

def text_width(s):
    return sum(len(FONT[ch][0]) + 1 for ch in s) - 1


def text(c, x, y, s, col):
    for ch in s:
        for r, line in enumerate(FONT[ch]):
            for k, bit in enumerate(line):
                if bit == '1':
                    c.px(x + k, y + r, col)
        x += len(FONT[ch][0]) + 1


WIN = (58, 29, 84, 26)             # the window's glass: x, y, width, height. One wide window, where there used to be two small ones
WINDOWS = [(58, 29)]               # where each window's glass starts, on the back wall (the app can still show several)
SKY_KEYS = {0: ('#060a22', '#1a1840'), 4: ('#0a1030', '#2a2356'), 5: ('#1a2458', '#6b4a78'), 6: ('#3c5aa0', '#f09a6a'),
            7: ('#5a98de', '#f8cf9a'), 9: ('#4f9cf0', '#bfe3ff'), 12: ('#3f93ee', '#b4defc'), 15: ('#4a98ea', '#c4e2f6'),
            17: ('#5a7fd0', '#f4b06a'), 18: ('#3b4a9a', '#e8705a'), 19: ('#1c2260', '#7a3f78'), 20: ('#0e1440', '#3b2f63'),
            24: ('#060a22', '#1a1840')}
LIGHT = [0, 0, 0, 0, 0, 0.15, 0.45, 0.75, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0.7, 0.4, 0.15, 0, 0, 0, 0]     # how bright each hour is


def sky_colours(hour):
    keys = sorted(SKY_KEYS)
    lo = max(k for k in keys if k <= hour)
    hi = min(k for k in keys if k > hour)
    t = (hour - lo) / (hi - lo)
    return mix(rgb(SKY_KEYS[lo][0]), rgb(SKY_KEYS[hi][0]), t), mix(rgb(SKY_KEYS[lo][1]), rgb(SKY_KEYS[hi][1]), t)


def lit(col, hour):
    """A daytime colour as it looks at this hour: dimmer and bluer at night, warmer at dawn and dusk."""
    light = LIGHT[hour]
    c = tuple(round(v * (0.46 + 0.54 * light)) for v in col)
    c = mix(c, (30, 40, 96), 0.40 * (1 - light))
    if hour in (5, 6, 7, 17, 18, 19):
        c = mix(c, (255, 150, 90), 0.16)
    return c


def window_view(g, hour):
    """What the window looks out on, as it is at this hour: the patch of yard straight out from it (see yard_art), drawn
    smaller. The same oak, its head filling the top of the glass and its trunk in the middle, and under it the same
    planting from left to right, a shrub and a patch of tulips each side of the trunk; the back fence and the hills behind."""
    w, h = g.w, g.h
    hill, fence, grass = 11, 14, 17

    def at(col):
        return lit(rgb(col), hour)
    for x in range(w):                                           # hills far off
        crest = hill + int(1.5 * math.sin(x / 7.0) + math.sin(x / 3.0 + 1))
        for y in range(crest, grass + 1):
            g.px(x, y, at('#7fae9a'))
    for x in range(w):                                           # the back fence, a post now and then
        post = x % 12 == 5
        for y in range(fence - post, grass):
            g.px(x, y, at(FENCE.hi if y == fence - post else FENCE.lo if x % 3 == 2 else FENCE.base))
    tile = grass_tile()
    for y in range(grass, h):                                    # the lawn, darker where the oak shades it
        for x in range(w):
            i = tile[(y * 3) % 32][x % 32]
            d = ((x - 42) / 40) ** 2 + ((y - 23) / 5.6) ** 2
            g.px(x, y, at(GREENS[max(0, i - 2)] if d < 0.8 or (d < 1 and (x + y) % 2) else GREENS[i]))
    for y in range(6, 23):                                       # its trunk, in the middle
        half = 3 + (y > 19) + (y > 21)
        for x in range(42 - half, 42 + half):
            u = (x - (42 - half)) / (2 * half - 1)
            g.px(x, y, at(BARK[2] if u < 0.25 else BARK[0] if u > 0.7 or hsh(x, y // 3, 7) % 5 == 0 else BARK[1]))
    leaves = [at(col) for col in LEAF['oak']]
    for k, (cx, cy, rx, ry) in enumerate(((19, 1, 13, 7), (65, 1, 13, 7), (42, -1, 18, 8), (30, 4, 12, 5), (54, 4, 12, 5))):
        clump(g, cx, cy, rx, ry, leaves, 400 + k)                # and its head: the sky shows past it at either side
    bush = [at(col) for col in ('#2f6b3a', '#3f8a47', '#57a555')]
    for k, sx in enumerate((8, 65)):                             # under it: a flowering shrub out at each side...
        for y, x0, x1 in ellipse(sx + 5, 19, 6, 4):
            for x in range(x0, x1 + 1):
                g.px(x, y, bush[0] if y > 21 else bush[2] if (x * 3 + y * 5) % 7 == 0 else bush[1])
        for fx, fy in ((2, 17), (6, 16), (9, 19), (4, 20)):
            g.px(sx + fx, fy, at('#7aa2e8' if k == 0 else '#ff7fb0'))
    for k, sx in enumerate((22, 51)):                            # ...and tulips nearer the trunk
        for n in range(5):
            fx = sx + 1 + 2 * n
            g.px(fx, 22 - n % 2, at('#3f8a47')); g.px(fx, 21 - n % 2, at(('#e0444c', '#f2c230', '#fdfbf4')[(n + k) % 3]))


def window_frames():
    """The view outside for each hour of the day: a strip of skies and a strip of ground to lay over the clouds."""
    _, _, w, h = WIN
    sky = np.zeros((h, w * 24, 4), np.uint8)
    ground = np.zeros((h, w * 24, 4), np.uint8)
    stars = [((k * 37 + 5) % w, (k * 7 + k * k * 3 + 2) % 13) for k in range(max(7, w // 4))]      # scattered over the upper half, however wide the glass is
    for hour in range(24):
        light = LIGHT[hour]
        c = Cv(w, h)
        top, bot = sky_colours(hour)
        for y in range(h):
            for x in range(w):
                c.px(x, y, mix(top, bot, (y / (h - 1)) ** 1.3))
        if light < 0.3:
            for sx, sy in stars:
                c.px(sx, sy, mix(c.get(sx, sy), (255, 255, 255), 1 - light * 3))
        # the sun and the moon are not painted here: the app moves one of them across (see orbs() and Outside in Clubhouse.tsx)
        sky[:, hour * w:(hour + 1) * w] = c.a

        g = Cv(w, h)
        window_view(g, hour)
        ground[:, hour * w:(hour + 1) * w] = g.a

    clouds = Cv(60, 10)                                          # one band that slides past and wraps (the page repeats it every 60 dots)
    white = Mat('#ffffff', lo='#d5dcec')
    for cx, cy, rx in ((8, 4, 5), (14, 5, 4), (33, 3, 4), (40, 4, 6), (53, 6, 3)):
        clouds.part(ellipse(cx, cy, rx, max(2, rx * 0.5)), white, hi='', lo='b')
    return sky, ground, clouds.a


ORB = 20            # the sun and the moon are each drawn in a square this big


def orbs():
    """The moon, the midday sun and the low sun, side by side. The app shows one and moves it across the sky."""
    c = Cv(ORB * 3, ORB)
    m = ORB // 2
    c.part(ellipse(m, m, 7, 7), Mat('#fff6c9', lo='#e3d59a'), hi='', lo='rb')
    for dx, dy in ((-3, -2), (-2, -2), (2, 1), (-1, 3), (3, -3)):
        c.px(m + dx, m + dy, rgb('#e3d59a'))
    for k, (core, glow) in enumerate((('#fff3b0', '#ffe9a0'), ('#ffb36a', '#ffc68a'))):
        cx = ORB * (k + 1) + m
        c.part(ellipse(cx, m, 8, 8), Mat(glow), hi='', lo='')
        c.part(ellipse(cx, m, 6, 6), Mat(core), hi='', lo='')
    return c.a


def seasonal_art():
    """Things the room puts out by itself: pumpkins in October, a tree and fairy lights in December, and balloons and
    a cake on somebody's desk on their birthday. Returns the pieces side by side on one strip, where each one is on it,
    and a tile of lights that repeats along the top of the walls."""
    pieces = {}

    def piece(name, w, h, draw):
        c = Cv(w + 2, h + 2)
        draw(c, 1, 1)
        pieces[name] = outline(c.a)

    def pumpkin(c, x, y):
        stamp(c, x, y, ['.....g.....', '....gg.....', '..ooooooo..', '.oooOoooOo.', 'ooyyoooyyoo', 'ooyyoooyyoo', 'oooooyooooo', 'oyoyoyoyoyo', '.oyyyyyyyo.', '..ooooooo..'],
              dict(o=rgb('#f08a1e'), O=rgb('#ffb04a'), y=rgb('#ffe45a'), g=rgb('#3f8a3c')))
    piece('pumpkin', 11, 10, pumpkin)

    def tree(c, x, y):
        cx = x + 10
        green, deep = rgb('#2f8f4a'), rgb('#1f6a36')
        for t in range(3):
            for r in range(8):
                w = round(1 + r * 0.8 + t * 1.5)
                c.rect(cx - w, y + 3 + t * 7 + r, cx + w, y + 3 + t * 7 + r, deep if r == 7 else green)
        stamp(c, cx - 1, y, ['.y.', 'yyy', '.y.'], dict(y=rgb('#ffe45a')))
        for k, (bx, by) in enumerate(((-2, 7), (3, 9), (-5, 14), (1, 13), (6, 16), (-7, 21), (-1, 20), (5, 22), (9, 23), (-3, 24))):
            c.px(cx + bx, y + by, rgb(('#e5484d', '#ffd84a', '#4f9cf0', '#f4f6f9')[k % 4]))
        c.rect(cx - 1, y + 26, cx + 1, y + 28, rgb('#6b4630'))
        c.part(rows(cx - 4, y + 29, cx + 4, y + 31), Mat('#b9443c', hi='#de6a5f', lo='#7a2a26'), hi='t', lo='b')
    piece('tree', 21, 32, tree)

    def balloons(c, x, y):
        knot = (x + 7, y + 22)
        for bx, by, col in ((3, 4, '#e5484d'), (11, 3, '#ffd84a'), (7, 9, '#4f9cf0')):
            n = knot[1] - (y + by + 3)
            for i in range(n + 1):                                    # the string, from the balloon down to where they are tied
                c.px(round(x + bx + (knot[0] - (x + bx)) * i / n), y + by + 3 + i, rgb('#d9dce6'))
        for bx, by, col in ((3, 4, '#e5484d'), (11, 3, '#ffd84a'), (7, 9, '#4f9cf0')):
            c.part(ellipse(x + bx, y + by, 2.7, 3.3), Mat(col), hi='tl', lo='rb')
    piece('balloons', 15, 23, balloons)

    def cake(c, x, y):
        stamp(c, x, y, ['....y....', '....w....', '.ppppppp.', '.pwpwpwp.', '.ccccccc.', '.ccccccc.', 'bbbbbbbbb'],
              dict(y=rgb('#ffb000'), w=rgb('#f4f6f9'), p=rgb('#ff8fc6'), c=rgb('#8a5a3c'), b=rgb('#dfe3ea')))
    piece('cake', 9, 7, cake)

    wide = sum(p.shape[1] for p in pieces.values())
    tall = max(p.shape[0] for p in pieces.values())
    strip = np.zeros((tall, wide, 4), np.uint8)
    where, x = {}, 0
    for name, p in pieces.items():
        strip[:p.shape[0], x:x + p.shape[1]] = p
        where[name] = [x, int(p.shape[1]), int(p.shape[0])]
        x += p.shape[1]

    lights = Cv(24, 6)
    lights.rect(0, 0, 23, 0, rgb('#22242f'))
    for k, col in enumerate(('#e5484d', '#3fbf63', '#ffd84a', '#4f9cf0')):
        lights.px(2 + 6 * k, 1, rgb('#22242f'))
        lights.rect(1 + 6 * k, 2, 3 + 6 * k, 4, rgb(col))
        lights.px(2 + 6 * k, 5, rgb(col))
    return strip, where, lights.a


def weather_tiles():
    """Small squares that repeat across the window and slide: slanting rain, drifting snow."""
    rain = Cv(16, 16)
    for x0, y0 in ((3, 0), (11, 5), (7, 10), (15, 13)):
        for k, (dx, dy) in enumerate(((0, 0), (0, 1), (-1, 2), (-1, 3))):
            rain.px((x0 + dx) % 16, (y0 + dy) % 16, (196, 216, 255))
    snow = Cv(16, 16)
    for x, y in ((2, 1), (9, 3), (13, 8), (5, 9), (10, 13), (1, 14)):
        snow.px(x, y, (255, 255, 255))
    snow.px(6, 5, (225, 232, 245)); snow.px(14, 1, (225, 232, 245))
    return dict(rain=rain.a, snow=snow.a)


SIGN = 'Chatterday'             # the name on the neon sign
SIGN_LINES = ('Chatter', 'day')    # (as it is written there: in two lines, to fit)
NEON_MID = (97, 36)             # the middle of the sign: on the wall between the clock and the big picture
NEON_ROOM = 56                  # how wide it may be, to stand clear of both


def neon_sign():
    """The name in handwriting, in warm white neon. It is a picture of its own (neon.png), not part of the wall, so
    the app can give it its glow and its flicker."""
    tube, hot = rgb('#ffdcae'), rgb('#fff6e6')                        # warm glass: amber-white, not blue

    def written(font):
        out = []
        for word in SIGN_LINES:
            img = Image.new('1', (240, 80), 0)
            dr = ImageDraw.Draw(img)
            dr.fontmode = '1'
            dr.text((6, 6), word, 1, font=font)
            out.append(np.array(img.crop(img.getbbox()), dtype=bool))
        return out
    lines = None
    for name in ('segoescb.ttf', 'segoesc.ttf', 'LHANDW.TTF', 'BRUSHSCI.TTF'):
        for size in range(18, 9, -1):                                    # as big as fits
            try:
                tried = written(ImageFont.truetype(name, size))
            except OSError:
                break
            if max(b.shape[1] for b in tried) <= NEON_ROOM:
                lines = tried
                break
        if lines:
            break
    if not lines:                                            # no handwriting font on this PC: plain letters, doubled
        lines = []
        for word in SIGN_LINES:
            word = word.upper()
            small = np.zeros((5, text_width(word)), dtype=bool)
            x = 0
            for ch in word:
                for r, line in enumerate(FONT.get(ch, FONT['O'])):
                    for k, bit in enumerate(line):
                        small[r, x + k] = bit == '1'
                x += len(FONT.get(ch, FONT['O'])[0]) + 1
            lines.append(np.kron(small, np.ones((2, 2), dtype=bool)))
    gap = 2
    w, h = max(b.shape[1] for b in lines), sum(b.shape[0] for b in lines) + gap * (len(lines) - 1)
    bits = np.zeros((h, w), dtype=bool)
    y = 0
    for b in lines:                                          # one line under the other, each in the middle
        x = (w - b.shape[1]) // 2
        bits[y:y + b.shape[0], x:x + b.shape[1]] = b
        y += b.shape[0] + gap
    t = Cv(w, h)
    for yy in range(h):
        for xx in range(w):
            if bits[yy, xx]:
                inner = 0 < yy < h - 1 and 0 < xx < w - 1 and bits[yy - 1, xx] and bits[yy + 1, xx] and bits[yy, xx - 1] and bits[yy, xx + 1]
                t.px(xx, yy, hot if inner else tube)
    L['neon'] = dict(at=[NEON_MID[0] - w // 2, NEON_MID[1] - h // 2, w, h])
    return t.a


def ficus(px, py):
    """A weeping fig in a big round pot, in the corner of the living room: a thin trunk, and a loose head of small
    leaves with gaps of air in it. (px, py) is the middle of the pot's foot."""
    pot = Mat('#e9e2cf', hi='#fffaf0', lo='#b3a88c')
    leaf = [rgb('#2f6b3a'), rgb('#3f8a47'), rgb('#57a555'), rgb('#234f2c')]

    def d(c):
        for x in range(px - 6, px + 9):                                  # its shadow
            base.px(x, py + 1, shade(base.get(x, py + 1), 0.3))
        c.part([(py - 12, px - 6, px + 6)] + rows(px - 7, py - 11, px + 7, py - 1) + [(py, px - 6, px + 6)], pot, hi='tl', lo='rb')
        c.rect(px - 5, py - 12, px + 5, py - 12, rgb('#4a3626'))          # the soil
        for k in range(18):                                              # the trunk, leaning a little as it goes up
            x = px + round(1.6 * math.sin(k / 5.0))
            c.px(x, py - 13 - k, rgb('#6a4a30')); c.px(x + 1, py - 13 - k, rgb('#4a3020'))
        cx, cy = px, py - 36                                             # the head of leaves
        for y in range(cy - 17, cy + 15):
            for x in range(cx - 13, cx + 12):
                r = math.hypot((x - cx) / 12.0, (y - cy) / 16.0) + 0.16 * noise(x, y, 5, 4)
                if r < 1.0 and hsh(x // 2, y // 2, 6) % 7 != 0:          # (the gaps: a pair of dots missing here and there)
                    tone = hsh(x // 2 + y, y // 2, 8) % 3
                    if (x - cx) + (y - cy) > 9:
                        tone = 3 if tone == 0 else 0                     # the underside and the right, in shade
                    c.px(x, y, leaf[tone])
    put_over(d, py + 1)
    block(px - 7, py - 12, px + 7, py)


def plant(px, py, blades):
    """A snake plant: a few tall striped leaves in a clay pot."""
    def d(c):
        for bx, tall, lean in blades:
            for i in range(tall):
                wide = 3 if i < tall * 0.55 else 2 if i < tall * 0.85 else 1
                x = px + bx + round(lean * i / tall)
                for k in range(wide):
                    col = '#d5dc7a' if k == 0 else '#2f7d4a' if (i // 3) % 2 else '#3f9a5a'
                    c.px(x + k, py - 9 - i, rgb(col))
        pot = Mat('#b9643c', hi='#dd8f63', lo='#7a3f26')
        c.part(rows(px - 6, py - 9, px + 6, py - 8), Mat(pot.hi), hi='', lo='')
        c.part([(py - 7, px - 5, px + 5), (py - 6, px - 5, px + 5), (py - 5, px - 5, px + 5), (py - 4, px - 4, px + 4),
                (py - 3, px - 4, px + 4), (py - 2, px - 4, px + 4), (py - 1, px - 3, px + 3), (py, px - 3, px + 3)], pot, hi='', lo='rb')
    put_over(d, py + 1)
    block(px - 6, py - 9, px + 6, py + 1)


def big_leafy(px, py):
    """A monstera climbing a moss pole, to the left of the sofa, in a woven basket on three wooden legs: big
    heart-shaped leaves, cut in from their edges, each at its own angle on a long stalk, with two young leaves at the
    top that have not split yet. (px, py) is the middle of the floor under the basket."""
    hi, mid, lo, rib, deep, stalk = [rgb(v) for v in ('#4fa652', '#2f8540', '#1f5f30', '#8fd07a', '#143f22', '#3f8f48')]
    basket = Mat('#c9a56a', hi='#e6c990', lo='#8f6f3c')
    top = py - 14                                                        # the soil
    done = set()                                                         # the dots that are already leaf: a leaf laid over them is edged in the dark

    def leaf(c, bx, by, deg, long, wide, split=True):
        """One leaf: (bx, by) is where its stalk meets it, deg which way its tip points (0 is straight down, more is round to the right)."""
        dx, dy = math.sin(math.radians(deg)), math.cos(math.radians(deg))
        r = int(long + wide + 2)
        pts = {}
        for y in range(by - r, by + r + 1):
            for x in range(bx - r, bx + r + 1):
                u, v = (x - bx) * dx + (y - by) * dy, (x - bx) * dy - (y - by) * dx      # along the leaf from the stalk, and across it
                t = u / long
                if not -0.18 <= t <= 1:
                    continue
                h = wide * (1 - t) ** 0.45 * min(1.0, (t + 0.18) / 0.3) ** 0.5           # a heart: two lobes behind the stalk, fattest a third of the way down, a point at the tip
                if abs(v) > h or (t < 0.04 and abs(v) < 0.8):
                    continue
                if split and abs(v) > 0.38 * h and 0.12 < t < 0.9 and int(u + 100) % 3 == 0:      # the cuts in from each edge
                    continue
                pts[(x, y)] = rib if abs(v) < 0.55 and t > 0.04 else hi if v > 0 else mid
        for (x, y) in pts:
            for n in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                if n not in pts and n in done:
                    c.px(n[0], n[1], deep)
        for (x, y), col in pts.items():
            c.px(x, y, lo if col != rib and (x, y + 1) not in pts else col)              # (its underside, in shade)
            done.add((x, y))

    def to(c, x0, y0, x1, y1):                                           # a stalk, from the pole out to a leaf
        n = max(abs(x1 - x0), abs(y1 - y0), 1)
        for i in range(n + 1):
            c.px(round(x0 + (x1 - x0) * i / n), round(y0 + (y1 - y0) * i / n), stalk)

    def d(c):
        for y in range(top - 34, top + 1):                               # the moss pole
            for k in (-1, 0, 1):
                c.px(px + k, y, rgb('#6b4226') if k == 1 or hsh(px + k, y, 71) % 4 == 0 else rgb('#8f5d38'))
        to(c, px, top - 30, px - 8, top - 36); leaf(c, px - 8, top - 36, -66, 13, 5.4, split=False)      # the young ones
        to(c, px, top - 31, px + 7, top - 39); leaf(c, px + 7, top - 39, 56, 14, 4.4, split=False)
        to(c, px + 1, top - 34, px + 1, top - 46); leaf(c, px + 1, top - 46, 4, 16, 10.5)                # the big ones, from the top down
        to(c, px, top - 14, px + 6, top - 24); leaf(c, px + 6, top - 24, 62, 14, 8.6)
        to(c, px, top - 16, px - 5, top - 26); leaf(c, px - 5, top - 26, -54, 17, 10.5)
        for k, lx in enumerate((px - 4, px, px + 4)):                    # the three splayed legs
            c.rect(lx + (k - 1), py - 3, lx + (k - 1), py - 2, rgb('#c59a62')); c.rect(lx + (k - 1) * 2, py - 1, lx + (k - 1) * 2, py, rgb('#a87c48'))
        c.part(rows(px - 5, top, px + 5, py - 5) + [(py - 4, px - 4, px + 4)], basket, hi='tl', lo='rb')
        for y in range(top + 2, py - 4):                                 # the weave
            for x in range(px - 4, px + 5):
                if (x + 2 * (y % 2)) % 4 == 0:
                    c.px(x, y, basket.lo)
        c.rect(px - 4, top, px + 4, top, rgb('#4a3626'))                  # the soil
        to(c, px, top - 2, px - 2, top - 7); leaf(c, px - 2, top - 7, -12, 14, 8.4)      # and the lowest leaf, hanging down over the rim
    for x in range(px - 4, px + 7):                                      # its shadow
        base.px(x, py + 1, shade(base.get(x, py + 1), 0.3))
    put_over(d, py + 1)
    block(px - 6, py - 12, px + 6, py)


# ───────────────────────── the yard ─────────────────────────
# One fixed scene, laid out round the house in the room's own dots: the room's top-left corner is (0, 0), so the yard
# runs into negative numbers to the west and the north. The app shows as much of it as its panel has room for, and
# nothing in it ever moves. West and east of the house are the side yards (the mower and the hose; the fire pit),
# the patio is out back (north), and the front door (south) looks on to the lawn, the sidewalk and the street.
YX0, YY0, YX1, YY1 = -200, -280, 728, 560          # the scene's edges; past them the app carries on with plain lawn
YW, YH = YX1 - YX0, YY1 - YY0
STREET_Y, STREET_H, STREET_W = 396, 82, 80         # the sidewalk, the road and the far sidewalk: a band that repeats sideways
FENCE_W, FENCE_E, FENCE_N, FENCE_S = -124, 652, -112, 306
PIT = (582, 150)                                   # the middle of the fire pit
FIRE_W, FIRE_H = 22, 28                            # one frame of the fire
# The big oak stands on the back lawn straight out from the back window (WIN), with a shrub and a patch of tulips each
# side of it, so what the window shows (window_view) is what is really there: the trunk in line with the middle of the glass.
OAK = (WIN[0] + WIN[2] // 2, -24)                  # the foot of its trunk
UNDER_X, UNDER_Y = (OAK[0] - 50, OAK[0] - 28, OAK[0] + 10, OAK[0] + 32), -22       # what grows under it: each one's left edge, and where they all stand
GREENS = [rgb(c) for c in ('#347a37', '#3f8a3c', '#4f9e47', '#5dae4f', '#74c45e')]
DRY = rgb('#86b04c')


def hsh(x, y, s=0):
    """A well-mixed number from a place, the same every run."""
    h = (x * 374761393 + y * 668265263 + s * 2246822519) & 0xFFFFFFFF
    h = ((h ^ (h >> 13)) * 1274126177) & 0xFFFFFFFF
    return (h ^ (h >> 16)) & 0xFFFF


def noise(x, y, size, seed):
    """Smooth lumps about `size` dots across, from -1 to 1."""
    gx, gy = x / size, y / size
    x0, y0 = math.floor(gx), math.floor(gy)
    fx, fy = gx - x0, gy - y0
    fx, fy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
    v = [[hsh(x0 + i, y0 + j, seed) / 32767.5 - 1 for i in (0, 1)] for j in (0, 1)]
    top = v[0][0] + (v[0][1] - v[0][0]) * fx
    bot = v[1][0] + (v[1][1] - v[1][0]) * fx
    return top + (bot - top) * fy


def tones(*cols):
    return [rgb(c) for c in cols]


def grass_tile():
    """32 x 32 of lawn that repeats: which of GREENS each dot is. Mostly flat, with short strokes and little tufts."""
    t = [[2] * 32 for _ in range(32)]
    for y in range(32):
        for x in range(0, 32, 2):
            h = hsh(x // 2, y, 11) % 100
            if h < 13:                                   # a lighter stroke, two dots long
                t[y][x] = t[y][(x + 1) % 32] = 3
            elif h < 21:
                t[y][x + (h & 1)] = 1
    for k in range(13):                                  # tufts: two tips over a dark foot
        x, y = hsh(k, 3, 5) % 32, hsh(k, 7, 5) % 32
        t[y][x] = 4
        t[y][(x + 2) % 32] = 4
        t[(y + 1) % 32][(x + 1) % 32] = 4
        t[(y + 2) % 32][(x + 1) % 32] = 0
    for k in range(9):                                   # single blades
        x, y = hsh(k, 13, 6) % 32, hsh(k, 17, 6) % 32
        t[y][x] = 4
        t[(y + 1) % 32][x] = 3
        t[(y + 2) % 32][x] = 0
    return t


def street_px(x, y):
    """The colour of the sidewalk-and-road band at (x, y); y counts from the top of the band. It repeats every STREET_W."""
    x %= STREET_W
    n = hsh(x, y, 21) % 100
    walk, joint = rgb('#c9c6bd'), rgb('#a39f95')

    def slab(yy):
        if x % 20 == 0 or yy == 0:
            return joint
        c = walk
        if n < 8:
            c = rgb('#d6d3ca')
        elif n < 14:
            c = rgb('#bbb8ae')
        if (x, yy) in ((33, 4), (34, 5), (34, 6), (35, 7), (36, 7), (37, 8), (37, 9), (38, 10)):     # one crack
            c = rgb('#8f8b82')
        return c
    if y < 14:
        return slab(y)
    if y < 16:
        return rgb('#e3e0d8')                             # the curb's top
    if y < 18:
        return rgb('#8a877f')                             # and its face
    if y < 64:
        c = rgb('#4b4d57')
        if n < 10:
            c = rgb('#585a64')
        elif n < 18:
            c = rgb('#40424b')
        if y == 18:
            c = rgb('#34363e')                            # the gutter
        if 40 <= y <= 41 and x % 40 < 22:
            c = rgb('#d9c76a')                            # the dashes down the middle
        return c
    if y < 66:
        return rgb('#8a877f')
    if y < 68:
        return rgb('#e3e0d8')
    return slab(y - 68)


class Scene(Cv):
    """A canvas that is drawn on in the room's own numbers."""

    def __init__(self):
        super().__init__(YW, YH)

    def px(self, x, y, c):
        super().px(x - YX0, y - YY0, c)

    def get(self, x, y):
        return super().get(x - YX0, y - YY0)


# The yard has four looks, one a season, each drawn by the same code from its own colours: the leaves of every kind of
# tree, and the lawn. Summer is the one the colours above were chosen for. The app shows the one for the month (US
# Eastern): March to May spring, June to August summer, September to November fall, December to February winter.
SUMMER = {}                                           # summer's own colours, noted the first time a season is set (they are defined further down)
SEASONS = dict(
    spring=dict(                                          # new leaf, the dogwoods and the little maple in blossom, a lush lawn
        leaf=dict(oak=tones('#2c6a2c', '#3c8434', '#55a040', '#74bc52', '#98d86a'), maple=tones('#3a7c2c', '#4e9634', '#68b040', '#88ca52', '#aee26c'),
                  birch=tones('#5a9a3c', '#74b248', '#90c858', '#aedc6c', '#ccee88'), dog=tones('#c9789a', '#e39ab6', '#f4bcd0', '#fddbe6', '#ffffff'),
                  red=tones('#8a2a4a', '#b0406a', '#d2628a', '#ea8cac', '#f9bcd0')),
        greens=tones('#2f7a3a', '#3c8e40', '#4fa64c', '#62bc58', '#80d46c'), dry='#8cc45a'),
    fall=dict(                                            # oaks gone brown, maples red and orange, birches yellow; the lawn tired
        leaf=dict(oak=tones('#5a2e12', '#7a4218', '#9c5a1e', '#bf7a28', '#dc9a3a'), maple=tones('#7a1c14', '#a02c18', '#c8461c', '#e26a24', '#f29a3a'),
                  birch=tones('#8a6a10', '#b08c16', '#d2ac1e', '#eac83a', '#f6e06a'), dog=tones('#5a1e2a', '#7a2a30', '#9c3c36', '#b8563c', '#d47a4a'),
                  red=tones('#4a0c14', '#6e121c', '#961a22', '#c02a2a', '#e04e3a')),
        greens=tones('#566e2e', '#687e34', '#7e903c', '#94a246', '#aeb856'), dry='#b9a84e'),
    winter=dict(                                          # snow on the ground and on every bough (wherever the house is)
        leaf=dict(oak=tones('#8f98ab', '#b4bccb', '#d5dde9', '#edf2f8', '#ffffff'), maple=tones('#8f98ab', '#b4bccb', '#d5dde9', '#edf2f8', '#ffffff'),
                  birch=tones('#98a2b4', '#bcc5d3', '#dbe2ec', '#f0f4f9', '#ffffff'), dog=tones('#8f98ab', '#b4bccb', '#d5dde9', '#edf2f8', '#ffffff'),
                  red=tones('#8a8494', '#b0aab8', '#d3cfda', '#ece9f0', '#ffffff')),
        greens=tones('#b9c8dc', '#d2deec', '#e6eef7', '#f4f8fc', '#ffffff'), dry='#d6e0ee'),
)
LITTER = dict(                                            # what lies about on the lawn, and how much of it
    spring=(tones('#ff9ac2', '#fdfbf4', '#f6d21c', '#b48ae6'), 0.004, 0.012),
    fall=(tones('#c8461c', '#e26a24', '#f29a3a', '#eac83a', '#9c5a1e', '#a02c18'), 0.014, 0.085),
)


def set_season(season):
    """Puts the colours of one season in place for everything the yard is drawn from."""
    global DRY
    if not SUMMER:
        SUMMER.update(leaf={k: list(v) for k, v in LEAF.items()}, greens=list(GREENS), dry=DRY)
    want = SEASONS.get(season, {})
    LEAF.update({k: list(v) for k, v in SUMMER['leaf'].items()})
    LEAF.update(want.get('leaf', {}))
    GREENS[:] = want.get('greens', SUMMER['greens'])
    DRY = rgb(want['dry']) if 'dry' in want else SUMMER['dry']


def litter(yd, season):
    """Fallen leaves in the fall (thick in drifts, thin everywhere else); wild flowers in the spring. Only on grass."""
    if season not in LITTER:
        return
    cols, thin, thick = LITTER[season]
    lawn = set(GREENS) | {DRY}
    for y in range(YY0, YY1):
        for x in range(YX0, YX1):
            h = hsh(x, y, 61)
            much = thick if noise(x, y, 26, 62) > 0.3 else thin
            if h / 65535 < much and yd.g.get(x, y) in lawn:
                col = cols[(h >> 4) % len(cols)]
                yd.g.px(x, y, col)
                if season == 'fall' and h & 1 and yd.g.get(x + 1, y) in lawn:      # a leaf is two dots as often as one
                    yd.g.px(x + 1, y, mix(col, (40, 20, 10), 0.25))


def snow_on(a):
    """Snow lying on top of a piece (winter): along every upper edge of it, a line of white with a grey-blue lip."""
    solid = a[..., 3] > 0
    above = np.zeros_like(solid)
    above[1:] = solid[:-1]
    top = solid & ~above
    under = np.zeros_like(solid)
    under[1:] = top[:-1]
    under &= solid & ~top
    deeper = np.zeros_like(solid)
    deeper[1:] = under[:-1]
    deeper &= solid & ~top & ~under
    deeper[:, ::3] = False                                # (not an even band: thinner here and there)
    a[top, :3] = (174, 188, 207)
    a[under, :3] = (255, 255, 255)
    a[deeper, :3] = (236, 242, 250)
    return a


def snowman(scarf='#e5484d'):
    """Three balls of snow, a carrot, coal, a scarf, two sticks and a hat."""
    c = Cv(18, 25)
    snow = Mat('#f4f8fc', hi='#ffffff', lo='#bfcde0')
    for x0, y0, dx in ((2, 13, -2), (15, 13, 2)):                         # the arms: sticks
        for k in range(4):
            c.px(x0 + (dx // 2) * k, y0 - k, rgb('#5a3a26'))
    c.part(ellipse(9, 19, 6, 5), snow, hi='t', lo='rb')
    c.part(ellipse(9, 12, 4.6, 4), snow, hi='t', lo='rb')
    c.part(ellipse(9, 6, 3.4, 3), snow, hi='t', lo='rb')
    c.rect(5, 9, 12, 9, rgb(scarf)); c.rect(11, 10, 12, 12, mix(rgb(scarf), (20, 14, 40), 0.25))
    c.px(8, 5, rgb('#15131b')); c.px(11, 5, rgb('#15131b'))
    c.rect(9, 6, 12, 6, rgb('#f08a2e')); c.px(13, 6, rgb('#c8641c'))
    for y in (12, 14, 18):
        c.px(9, y, rgb('#15131b'))
    c.rect(6, 3, 12, 3, rgb('#22232d')); c.rect(7, 0, 11, 2, rgb('#22232d')); c.rect(7, 2, 11, 2, rgb('#b9443c'))
    return c


def yard_pumpkin(big_one=False):
    c = Cv(9, 7) if big_one else Cv(7, 6)
    w, h = c.w, c.h
    c.part(ellipse((w - 1) / 2, h - 3, (w - 1) / 2, 2.4), Mat('#e2701e', hi='#f7a04a', lo='#a8480f'), hi='t', lo='rb')
    c.px(w // 2, h - 6 if big_one else 0, rgb('#4a6a2a')); c.px(w // 2, 1 if not big_one else h - 5, rgb('#4a6a2a'))
    for x in (w // 2 - 2, w // 2 + 2):
        c.px(x, h - 3, rgb('#a8480f'))
    return c


class Yard:
    snow = False                                          # winter: everything stood on the ground gets snow along its top

    def __init__(self):
        self.g = Scene()                                  # the ground
        self.shadow = np.zeros((YH, YW), np.float32)      # how deep in shade each dot of it is
        self.items = []                                   # everything standing on it: (depth, left, top, pixels)

    def shade(self, cx, cy, rx, ry, s=1.0, seed=0):
        """A shadow on the ground, with a broken edge."""
        for y in range(int(cy - ry), int(cy + ry) + 1):
            for x in range(int(cx - rx), int(cx + rx) + 1):
                if not (YX0 <= x < YX1 and YY0 <= y < YY1):
                    continue
                d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2
                if seed:
                    d += noise(x, y, 9, seed) * 0.28
                if d <= 1 and (d < 0.74 or (x + y) % 2 == 0):
                    self.shadow[y - YY0, x - YX0] = max(self.shadow[y - YY0, x - YX0], s)

    def add(self, c, x, y, depth=None, edge=True, ax=None, shadow=None):
        """Stand a piece on the ground: the middle of its bottom row goes at (x, y). `shadow` is how wide a shadow it throws."""
        a = np.pad(c.a, ((1, 1), (1, 1), (0, 0)))
        if edge:
            a = outline(a)
        if self.snow and c.h > 5:                           # (not on the smallest things: a flower would be all snow)
            a = snow_on(a)
        ax = c.w // 2 if ax is None else ax
        self.items.append((y if depth is None else depth, x - ax - 1, y - c.h, a))
        if x - ax < YX0 or x - ax + c.w > YX1 or y - c.h + 1 < YY0 or y >= YY1:
            print('yard: a piece at', (x, y), 'runs off the edge of the scene')
        if shadow:
            self.shade(x + 2, y + 1, shadow, max(2, shadow * 0.36), 1.0)

    def compose(self):
        """The finished scene, and the same thing with only what stands in front of the house (to lay over the room's near wall)."""
        g = self.g.a
        dark = np.array([14, 34, 30], np.float32)
        s = self.shadow[..., None] * 0.36
        g[..., :3] = (g[..., :3] * (1 - s) + dark * s).astype(np.uint8)
        front = np.zeros_like(g)
        for depth, x, y, a in sorted(self.items, key=lambda t: t[0]):
            h, w = a.shape[:2]
            x0, y0 = x - YX0, y - YY0
            cx0, cy0, cx1, cy1 = max(0, x0), max(0, y0), min(YW, x0 + w), min(YH, y0 + h)
            if cx0 >= cx1 or cy0 >= cy1:
                continue
            part = a[cy0 - y0:cy1 - y0, cx0 - x0:cx1 - x0]
            m = part[..., 3] > 0
            g[cy0:cy1, cx0:cx1][m] = part[m]
            if depth > H:
                front[cy0:cy1, cx0:cx1][m] = part[m]
        return g, front


# ── what grows ──

LEAF = dict(
    oak=tones('#1b4d28', '#25632e', '#317a37', '#46943f', '#62ae4e'),
    maple=tones('#2a6a2c', '#3a8232', '#4f9a38', '#6db344', '#90cb58'),
    birch=tones('#3d7a34', '#55953c', '#72ad48', '#93c458', '#b9da72'),
    pine=tones('#123a30', '#1a4e3c', '#226247', '#2d7852', '#419462'),
    red=tones('#5a1420', '#7d1c28', '#a12a2e', '#c4443a', '#e2704e'),
    box=tones('#1f5a30', '#2a7038', '#388642', '#4c9e4c', '#6ab85c'),
    dog=tones('#2c6a36', '#3a8040', '#4c964a', '#66ae58', '#86c66c'),
)
BARK = tones('#4a3020', '#6a4a30', '#8a6644')
BIRCH_BARK = tones('#a9a9a2', '#e9e7df', '#ffffff')


def clump(c, cx, cy, rx, ry, t, seed=1):
    """One round mass of leaves, lit from the top left: leaves in little clusters, a dark underside."""
    for y in range(int(cy - ry) - 1, int(cy + ry) + 2):
        for x in range(int(cx - rx) - 1, int(cx + rx) + 2):
            dx, dy = (x - cx) / rx, (y - cy) / ry
            d = dx * dx + dy * dy
            if d > 1 + ((hsh(x, y, seed) & 7) - 4) * 0.022:        # a slightly ragged edge
                continue
            side = dx * 0.5 + dy * 0.82                             # -1 at the top left, 1 at the bottom right
            v = -side + ((hsh(x // 2, (y + (x // 2) % 2) // 2, seed + 1) & 15) - 7.5) / 20
            i = 0 if v < -0.62 else 1 if v < -0.2 else 2 if v < 0.28 else 3 if v < 0.72 else 4
            if d > 0.78 and side > 0.25:
                i = 0
            c.px(x, y, t[i])


def trunk(c, cx, y0, y1, w, bark=BARK, marks=False):
    """A trunk from y0 down to its foot at y1, spreading into roots at the bottom."""
    for y in range(y0, y1 + 1):
        k = y1 - y
        half = w / 2 + (2 if k < 2 else 1 if k < 5 else 0)
        x0, x1 = int(round(cx - half)), int(round(cx + half)) - 1
        for x in range(x0, x1 + 1):
            u = (x - x0) / max(1, x1 - x0)
            col = bark[2] if u < 0.22 else bark[0] if u > 0.68 else bark[1]
            if marks:
                if hsh(x // 2, y // 2, 31) % 9 == 0 and 0.2 < u < 0.9:
                    col = rgb('#2a2a2e')
            elif hsh(x, y // 3, 7) % 5 == 0:
                col = bark[0]
            c.px(x, y, col)


def tree(kind, var=0):
    """A tree on a canvas of its own, the foot of its trunk in the middle of the bottom row. Returns it and the size of its
    shadow. `var` makes one tree differ from the next of its kind: each mass of leaves a little smaller and out of place."""
    def masses(c, cx, cy, list_, leaf, seed):
        for k, (dx, dy, rx, ry) in enumerate(list_):
            if var:
                less = hsh(k, var, 3) % 4
                dx, dy = dx + hsh(k, var, 1) % (2 * less + 1) - less, dy + hsh(k, var, 2) % (less + 1)
                rx, ry = rx - less, ry - min(less, 2)
            clump(c, cx + dx, cy + dy, rx, ry, leaf, seed + k + var * 13)
    if kind == 'oak':                                    # the big one: a broad head of ten masses over a stout trunk
        c = Cv(148, 126)
        cx, cy = 74, 62
        trunk(c, cx, cy + 18, 125, 12)
        masses(c, cx, cy, ((-34, -28, 26, 20), (0, -38, 30, 22), (34, -28, 26, 20), (-50, -2, 22, 20), (50, -2, 22, 20),
                           (-22, -8, 28, 22), (22, -8, 28, 22), (0, 8, 30, 20), (-36, 16, 22, 16), (36, 16, 22, 16), (0, 22, 20, 12)), LEAF['oak'], 40)
        return c, 46
    if kind == 'maple':
        c = Cv(96, 92)
        cx, cy = 48, 38
        trunk(c, cx, cy + 14, 91, 8)
        masses(c, cx, cy, ((-20, -16, 18, 15), (16, -20, 20, 16), (-30, 4, 16, 14), (30, 4, 16, 14), (0, -2, 22, 18), (-14, 16, 18, 12), (16, 16, 18, 12)), LEAF['maple'], 60)
        return c, 30
    if kind == 'birch':                                  # slim and pale: a white trunk with dark marks, a light airy head
        c = Cv(60, 96)
        cx, cy = 30, 30
        trunk(c, cx, cy + 4, 95, 5, BIRCH_BARK, marks=True)
        masses(c, cx, cy, ((0, -16, 14, 12), (-14, -2, 13, 12), (14, 0, 13, 12), (-4, 12, 14, 11), (10, 20, 11, 9), (-14, 22, 10, 8)), LEAF['birch'], 80)
        return c, 20
    if kind == 'jmaple':                                 # a Japanese maple: low, wide and red, on a dark forked stem
        c = Cv(62, 48)
        cx = 31
        for y in range(26, 48):
            c.rect(cx - 1, y, cx + 1, y, rgb('#3a2420'))
            c.px(cx - 1, y, rgb('#5a3a30'))
        for k in range(8):
            c.px(cx - 3 - k, 30 - k, rgb('#3a2420')); c.px(cx + 3 + k, 29 - k, rgb('#3a2420'))
        for k, (dx, dy, rx, ry) in enumerate(((-16, 14, 13, 9), (16, 14, 13, 9), (0, 9, 16, 10), (-9, 20, 12, 7), (10, 21, 12, 7))):
            clump(c, cx + dx, dy, rx, ry, LEAF['red'], 90 + k)
        return c, 22
    if kind == 'dogwood':                                # a dogwood in flower: white blossoms all over a small round head
        c = Cv(60, 62)
        cx, cy = 30, 22
        trunk(c, cx, cy + 10, 61, 4)
        for k, (dx, dy, rx, ry) in enumerate(((-12, -6, 14, 12), (12, -8, 14, 12), (0, 4, 18, 13), (-16, 10, 11, 9), (16, 10, 11, 9))):
            clump(c, cx + dx, cy + dy, rx, ry, LEAF['dog'], 100 + k)
        for k in range(46):
            x, y = 6 + hsh(k, 1, 77) % 48, 5 + hsh(k, 2, 77) % 32
            if c.get(x, y) and c.get(x + 1, y) and c.get(x - 1, y) and c.get(x, y + 1) and c.get(x, y - 1):
                for ddx, ddy in ((0, -1), (-1, 0), (1, 0), (0, 1)):
                    c.px(x + ddx, y + ddy, rgb('#fdfbf4'))
                c.px(x, y, rgb('#f2d24a'))
        return c, 20
    if kind == 'pine':                                   # a pine: tiers of boughs, each wider than the one above
        c = Cv(52, 100)
        cx = 26
        trunk(c, cx, 80, 99, 5)
        t = LEAF['pine']
        for tier in range(6):
            top, tall, wide = 2 + tier * 13, 24, 7 + tier * 3.4
            for j in range(tall):
                half = 1 + wide * (j / (tall - 1)) ** 0.9
                for x in range(int(round(cx - half)), int(round(cx + half)) + 1):
                    y = top + j
                    if (j == tall - 1 and (x + tier) % 4 < 2) or (j == tall - 2 and (x + tier) % 4 == 0):
                        continue                              # the ragged ends of the boughs
                    u = (x - cx) / max(1, half)
                    v = -u * 0.8 - (j / tall) * 0.9 + 0.5 + ((hsh(x // 2, y // 2, 120 + tier + var * 7) & 7) - 3.5) / 9
                    c.px(x, y, t[0] if j >= tall - 2 else t[4] if v > 1.0 else t[3] if v > 0.55 else t[2] if v > 0.05 else t[1] if v > -0.5 else t[0])
        return c, 20
    raise ValueError(kind)


def shrub(kind, r=9, flowers=None):
    """A bush. box: clipped round; cone: an arborvitae; hydrangea: with heads of flowers; azalea: dotted with them; grass: a fountain of blades."""
    if kind == 'cone':
        c = Cv(16, 27)
        t = LEAF['pine']
        for y in range(27):
            half = 0.6 + 7 * math.sin(min(1.0, y / 21) * math.pi / 2) if y < 23 else 7 - (y - 22) * 0.9
            for x in range(int(round(8 - half)), int(round(8 + half))):
                u = (x - 8) / max(1, half)
                v = -u * 0.9 - y / 40 + ((hsh(x, y // 2, 140) & 7) - 3.5) / 8
                c.px(x, y, t[4] if v > 0.75 else t[3] if v > 0.3 else t[2] if v > -0.25 else t[1] if v > -0.7 else t[0])
        return c
    if kind == 'grass':
        c = Cv(21, 17)
        blades = tones('#7da04a', '#a9c264', '#d2dd96')
        for k, lean in enumerate((-9, -7, -5, -3, -1, 0, 1, 3, 5, 7, 9)):
            tall = 15 - abs(lean) * 0.7 + (k % 3)
            for i in range(int(tall)):
                x = 10 + round(lean * (i / tall) ** 1.6)
                c.px(x, 16 - i, blades[(k + (i > tall * 0.6)) % 3])
            if k % 3 == 1:                                    # a feathery head on some
                x = 10 + round(lean)
                c.px(x, 16 - int(tall), rgb('#ead9a8')); c.px(x, 15 - int(tall), rgb('#f6ecc8'))
        return c
    c = Cv(2 * r + 3, int(1.7 * r) + 3)
    cx, cy = r + 1, int(0.85 * r) + 1
    clump(c, cx, cy, r, r * 0.85, LEAF['box'] if kind != 'azalea' else LEAF['dog'], 150 + r)
    if kind == 'box':
        return c
    col = rgb(flowers or '#7aa2e8')
    hi, lo = mix(col, (255, 255, 255), 0.45), mix(col, (20, 14, 40), 0.3)
    if kind == 'hydrangea':                              # round heads, four or five dots across
        for k, (dx, dy) in enumerate(((-0.5, -0.45), (0.35, -0.5), (-0.1, 0.05), (0.55, 0.1), (-0.6, 0.25), (0.15, 0.5))):
            fx, fy = round(cx + dx * r), round(cy + dy * r * 0.85)
            stamp(c, fx - 2, fy - 2, ['.hh..', 'hhcc.', 'hcccl', '.ccl.'], dict(h=hi, c=col, l=lo))
    else:                                                # an azalea: small flowers all over
        for k in range(r * 3):
            x, y = cx - r + 1 + hsh(k, 3, 160 + r) % (2 * r - 1), cy - int(r * 0.85) + 1 + hsh(k, 4, 160 + r) % int(1.6 * r)
            if c.get(x, y) and c.get(x + 1, y):
                c.px(x, y, hi if k % 3 == 0 else col); c.px(x + 1, y, col)
    return c


def flower(kind, col='#e0444c'):
    """A single flower on its stem."""
    stem, leaf = rgb('#3f8a3c'), rgb('#5dae4f')
    bloom = rgb(col)
    hi = mix(bloom, (255, 255, 255), 0.4)
    if kind == 'tulip':
        c = Cv(3, 7)
        stamp(c, 0, 0, ['b.b', 'hbb', 'bbb', '.s.', 'ls.', '.sl', '.s.'], dict(b=bloom, h=hi, s=stem, l=leaf))
    elif kind == 'daisy':
        c = Cv(3, 6)
        stamp(c, 0, 0, ['.w.', 'wyw', '.w.', '.s.', 'ls.', '.s.'], dict(w=rgb('#fdfbf4'), y=rgb('#f2c230'), s=stem, l=leaf))
    elif kind == 'lavender':
        c = Cv(3, 8)
        stamp(c, 0, 0, ['.h.', '.b.', 'bh.', '.b.', '.s.', '.sl', 'ls.', '.s.'], dict(b=bloom, h=hi, s=stem, l=leaf))
    else:                                                # a sunflower, head high
        c = Cv(11, 30)
        for y in range(8, 30):
            c.px(5, y, stem); c.px(6, y, rgb('#2f7a3a'))
        stamp(c, 0, 14, ['.ll......', 'llll.....', '.lll.....'], dict(l=leaf))
        stamp(c, 6, 19, ['...ll', '.llll', 'lll..'], dict(l=leaf))
        stamp(c, 1, 0, ['..yyyyy..', '.yyYyYyy.', 'yyYkkkYyy', 'yYkkKkkYy', 'yyYkkkYyy', '.yyYyYyy.', '..yyyyy..', '....y....'],
              dict(y=rgb('#f6c21c'), Y=rgb('#ffdf5a'), k=rgb('#5a3a1c'), K=rgb('#7d5428')))
    return c


# ── what was built or left out ──

FENCE = Mat('#c49a6c', hi='#dfbb8c', lo='#9a7650')


def fence_run(x0, x1, gate=None):
    """A stretch of board fence seen from the front: pointed boards on two rails, a post every so often. `gate` is where
    one is, (from, to), counted along the run."""
    w = x1 - x0 + 1
    c = Cv(w, 19)
    rail = rgb('#7d5c3c')
    for i in range(w):
        if gate and gate[0] <= i <= gate[1]:
            continue
        if i % 32 < 4 or i >= w - 4 or (gate and (gate[0] - 4 <= i < gate[0] or gate[1] < i <= gate[1] + 4)):      # a post
            for y in range(0, 19):
                c.px(i, y, FENCE.hi if y == 0 else FENCE.lo if (i + 1) % 4 == 0 else rgb('#b98d60'))
            continue
        k = i % 4
        if k == 3:                                           # the gap between two boards: only the rails show
            for y in (7, 8, 14, 15):
                c.px(i, y, rail)
            continue
        for y in range(3 + (k != 1), 19):
            c.px(i, y, FENCE.lo if y == 18 or k == 2 else FENCE.hi if k == 0 else FENCE.base)
    if gate:                                                 # the gate: paler boards under an arched top, braced corner to corner
        g0, g1 = gate
        pale = Mat('#dcc199', hi='#f0dcb8', lo='#a98a62')
        n = g1 - g0
        for i in range(g0, g1 + 1):
            t = (i - g0) / n
            top = 1 + round(5 * (2 * t - 1) ** 2)
            for y in range(top, 18):
                col = pale.hi if y == top else pale.lo if (i - g0) % 4 == 3 else pale.base
                if y in (8, 15) or abs((16 - y) - t * 9) < 0.9:
                    col = pale.lo                            # its two rails and the brace between them
                c.px(i, y, col)
        c.rect(g1 - 3, 10, g1 - 2, 12, rgb('#22242f'))       # the latch
        c.rect(g0, 9, g0, 9, rgb('#22242f')); c.rect(g0, 14, g0, 14, rgb('#22242f'))       # and the hinges
    return c


def fence_side(yard, x, y0, y1):
    """A fence running away from us: seen end on, a narrow strip of board tops, cut into lengths so things sort against it."""
    for a in range(y0, y1 + 1, 12):
        b = min(y1, a + 11)
        c = Cv(4, b - a + 17)
        for j in range(c.h):
            y = a - 16 + j
            post = (y - y0) % 36 < 3
            c.px(0, j, FENCE.hi); c.px(1, j, FENCE.base); c.px(2, j, FENCE.base if post else FENCE.lo); c.px(3, j, FENCE.lo)
            if (y - y0) % 4 == 3 and not post:
                c.px(1, j, FENCE.lo); c.px(2, j, rgb('#7d5c3c'))
        yard.add(c, x, b, ax=1)
    for y in range(y0, y1 + 1):
        if YX0 <= x + 4 < YX1 - 3:
            yard.shadow[y - YY0, x + 3 - YX0:x + 6 - YX0] = 1.0


def patio_chair(view):
    """A teak garden chair with a cream cushion. side: facing right; front: facing us; back: seen from behind."""
    wood, cush = Mat('#a8703f', hi='#c98f58', lo='#74492a'), Mat('#efe6cf', hi='#fffaf0', lo='#c2b89e')
    if view == 'side':
        c = Cv(16, 25)
        c.part(rows(1, 0, 3, 14), wood, hi='tl', lo='r')                  # the back
        c.rect(1, 3, 3, 3, wood.lo); c.rect(1, 8, 3, 8, wood.lo)
        c.part(rows(4, 2, 5, 13), cush, hi='t', lo='r')                   # its cushion
        c.part(rows(2, 9, 13, 10), wood, hi='t', lo='')                   # the arm
        c.part(rows(4, 14, 14, 15), cush, hi='t', lo='b')                 # the seat cushion
        c.part(rows(2, 16, 14, 17), wood, hi='t', lo='b')
        c.rect(2, 18, 3, 24, wood.lo); c.rect(13, 11, 14, 24, wood.base); c.rect(14, 11, 14, 24, wood.lo)
        c.rect(4, 21, 12, 21, wood.lo)
        return c
    c = Cv(16, 25)
    if view == 'front':
        c.part(rows(1, 0, 14, 1), wood, hi='t', lo='b')
        for x in (1, 4, 7, 10, 13):
            c.part(rows(x, 2, x + 1, 12), wood, hi='l', lo='r')
        c.part(rows(3, 5, 12, 12), cush, hi='t', lo='b')
        c.part(rows(0, 10, 1, 16), wood, hi='tl', lo='r'); c.part(rows(14, 10, 15, 16), wood, hi='tl', lo='r')     # arms, end on
        c.part(rows(2, 13, 13, 16), cush, hi='t', lo='b')
        c.part(rows(1, 17, 14, 18), wood, hi='t', lo='b')
        c.rect(1, 19, 2, 24, wood.lo); c.rect(13, 19, 14, 24, wood.lo)
    else:
        c.part(rows(1, 0, 14, 1), wood, hi='t', lo='b')
        for x in (1, 4, 7, 10, 13):
            c.part(rows(x, 2, x + 1, 15), wood, hi='l', lo='r')
        c.part(rows(1, 8, 14, 9), wood, hi='t', lo='b')
        c.part(rows(0, 10, 15, 11), wood, hi='t', lo='b')
        c.part(rows(1, 16, 14, 18), wood, hi='t', lo='b')
        c.rect(1, 19, 2, 24, wood.lo); c.rect(13, 19, 14, 24, wood.lo)
    return c


def patio_table():
    """A round table under a big striped umbrella, high enough to stand under."""
    c = Cv(62, 70)
    cx = 31
    red, cream = Mat('#c8382e', hi='#e6584a', lo='#8f2420'), Mat('#f1e9d6', hi='#fffaf0', lo='#c2b89e')
    c.rect(cx - 1, 14, cx, 66, rgb('#5d6274')); c.rect(cx, 14, cx, 66, rgb('#3b3f4d'))       # the pole
    c.part(rows(cx - 5, 66, cx + 4, 68) + [(69, cx - 7, cx + 6)], Mat('#3b3f4d', hi='#5d6274', lo='#22242f'), hi='t', lo='b')   # its foot
    top = Mat('#d9d4c4', hi='#f4f1e9', lo='#a39d8d')
    c.part(ellipse(cx, 50, 17, 6), top, hi='t', lo='b')                   # the table top, about waist high
    c.part([(57, cx - 15, cx + 15), (58, cx - 12, cx + 12)], Mat(top.lo), hi='', lo='b')
    c.rect(cx - 1, 44, cx, 50, rgb('#5d6274'))
    for y in range(2, 19):                                                # the umbrella: eight panels, red and cream
        half = 30 * math.sqrt(max(0, 1 - ((18 - y) / 17) ** 2)) if y < 18 else 30
        for x in range(int(round(cx - half)), int(round(cx + half)) + 1):
            u = (x - cx) / 30
            panel = int((math.asin(max(-1, min(1, u))) / math.pi + 0.5) * 7.999)
            m = red if panel % 2 == 0 else cream
            edge = abs(x - cx) > half - 1.2
            c.px(x, y, m.lo if y == 18 or (edge and x > cx) else m.hi if y < 5 or (edge and x < cx) else m.base)
    for x in range(cx - 30, cx + 31):                                     # its scalloped edge
        u = (x - cx) / 30
        panel = int((math.asin(max(-1, min(1, u))) / math.pi + 0.5) * 7.999)
        m = red if panel % 2 == 0 else cream
        if (x - cx + 30) % 8 not in (0, 7):
            c.px(x, 19, m.lo)
        if (x - cx + 30) % 8 in (3, 4):
            c.px(x, 20, m.lo)
    c.rect(cx - 1, 0, cx, 1, rgb('#3b3f4d'))
    return c


def grill():
    """A gas grill up to the chest: a black hood with a steel handle, three red knobs, a shelf each side, the bottle underneath."""
    c = Cv(34, 28)
    black, steel = Mat('#2b2d3a', hi='#4f5368', lo='#15161d'), Mat('#b9c0cc', hi='#e6eaf0', lo='#7d8496')
    c.part([(0, 9, 24), (1, 8, 25)] + rows(7, 2, 26, 9), black, hi='tl', lo='rb')          # the hood
    c.rect(11, 5, 22, 6, steel.base); c.rect(11, 5, 22, 5, steel.hi)                       # its handle
    c.rect(16, 2, 17, 3, rgb('#e6eaf0'))                                                   # the thermometer
    c.part(rows(6, 10, 27, 13), steel, hi='t', lo='b')                                     # the front panel
    for x in (10, 16, 22):
        c.rect(x, 11, x + 1, 12, rgb('#d8342c'))
    c.part(rows(0, 9, 5, 10), steel, hi='t', lo='b'); c.part(rows(28, 9, 33, 10), steel, hi='t', lo='b')       # the shelves
    c.part(rows(7, 14, 26, 23), black, hi='', lo='rb')                                     # the cart
    c.rect(16, 15, 16, 22, rgb('#15161d'))
    c.rect(13, 18, 14, 19, steel.base); c.rect(18, 18, 19, 19, steel.base)
    c.rect(8, 24, 9, 27, rgb('#15161d')); c.rect(24, 24, 25, 25, rgb('#15161d'))
    c.part(ellipse(24, 25, 2.4, 2.4), Mat('#15161d', hi='#3b3f4d'), hi='t', lo='')         # a wheel
    return c


def ac_unit():
    """The air conditioner on its pad: a fan under a grille on top, louvres down the front."""
    c = Cv(28, 30)
    body = Mat('#cfcdc2', hi='#ecebe2', lo='#8f8d84')
    c.part(rows(0, 27, 27, 29), Mat('#b9b6ad', hi='#d6d3ca', lo='#8a877f'), hi='t', lo='b')       # the concrete pad
    c.part(rows(2, 0, 25, 9), Mat(body.hi, lo=body.base), hi='t', lo='')                           # the top
    c.part(ellipse(13.5, 4.6, 9, 3.4), Mat('#3b3f4d', hi='#5d6274', lo='#22242f'), hi='', lo='b')
    for x, y in ((9, 4), (10, 4), (17, 5), (18, 5), (13, 2), (14, 7), (13, 3), (14, 6)):
        c.px(x, y, rgb('#8d93a3'))                                                                 # the blades
    c.rect(13, 4, 14, 5, rgb('#15161d'))
    c.part(rows(2, 10, 25, 26), body, hi='', lo='rb')                                              # the front
    for y in range(12, 26, 2):
        c.rect(4, y, 23, y, rgb('#77756d'))
    c.rect(2, 10, 3, 26, body.hi); c.rect(24, 10, 25, 26, body.lo)
    c.rect(19, 22, 22, 24, rgb('#2f62d8'))                                                         # the maker's badge
    return c


def hose_coil():
    """A garden hose rolled up on the ground: three turns of green, the brass end lying loose."""
    c = Cv(26, 14)
    hi, base, lo = rgb('#6fd27a'), rgb('#3fa650'), rgb('#256e36')
    for rx, ry in ((11, 5.5), (7.5, 3.6), (4, 1.8)):
        for a in range(0, 720):
            t = a * math.pi / 360
            x, y = 12 + rx * math.cos(t), 6.5 + ry * math.sin(t)
            for dy in (0, 1):
                c.px(int(round(x)), int(round(y)) + dy, lo if dy else (hi if math.sin(t) < -0.3 else base))
    for k in range(4):
        c.px(22 + k // 2, 9 + k, base)
    c.rect(24, 12, 25, 13, rgb('#e2c36a'))                                                         # the nozzle
    return c


def bin_(col, mark):
    """A wheeled bin with its lid down."""
    c = Cv(14, 23)
    m = Mat(col)
    c.part(rows(0, 0, 13, 3), Mat(m.hi, lo=m.base), hi='t', lo='b')                                # the lid
    c.rect(5, 1, 8, 1, m.lo)
    c.part(rows(1, 4, 12, 16) + rows(2, 17, 11, 20), m, hi='l', lo='rb')
    c.rect(1, 7, 12, 7, m.lo)
    if mark:                                                                                       # the three arrows, as near as six dots get
        stamp(c, 4, 10, ['..ww..', '.w..w.', 'w....w', 'wwwwww'], dict(w=rgb('#f4f6f9')))
    c.rect(1, 20, 3, 22, rgb('#15161d')); c.rect(10, 20, 12, 22, rgb('#15161d'))
    return c


def mower():
    """A push mower: a red deck on four black wheels, the engine on top, the handle back and up to the hands."""
    c = Cv(40, 30)
    red = Mat('#d8342c', hi='#f0584c', lo='#9c221c')
    grey = rgb('#8d93a3')
    for k in range(18):                                                   # the handle, from the back of the deck up to the grip
        x, y = 24 + round(k * 0.72), 19 - k
        c.px(x, y, grey); c.px(x + 1, y, rgb('#5d6274'))
    c.rect(34, 0, 39, 2, rgb('#15161d'))
    c.part([(17, 4, 26)] + rows(2, 18, 28, 24), red, hi='t', lo='rb')     # the deck
    c.rect(4, 22, 26, 22, red.lo)
    c.part(rows(9, 10, 19, 17), Mat('#2b2d3a', hi='#4f5368', lo='#15161d'), hi='tl', lo='rb')      # the engine
    c.rect(12, 8, 16, 9, rgb('#b9c0cc')); c.rect(21, 13, 22, 14, rgb('#e2c36a'))
    for wx in (1, 23):
        c.part(ellipse(wx + 3, 25.5, 3.4, 3.4), Mat('#15161d', hi='#3b3f4d'), hi='t', lo='')
        c.px(wx + 3, 25, grey); c.px(wx + 3, 26, grey)
    return c


def adirondack(view):
    """A white-painted Adirondack chair for the fire: a tall fan of slats, broad flat arms. front: facing us; back: seen from behind."""
    m = Mat('#efe8d8', hi='#ffffff', lo='#b5ac98')
    c = Cv(24, 27)
    tops = (5, 2, 0, 0, 2, 5)
    if view == 'back':
        for k, top in enumerate(tops):
            c.part(rows(3 + 3 * k, top, 5 + 3 * k, 19), m, hi='tl', lo='r')
        c.part(rows(3, 10, 20, 11), Mat(m.lo), hi='', lo='')
        c.part(rows(0, 13, 23, 14), m, hi='t', lo='b')                    # the arms, out to each side
        c.part(rows(3, 20, 20, 21), m, hi='t', lo='b')
        c.rect(3, 22, 4, 26, m.lo); c.rect(19, 22, 20, 26, m.lo)
    else:
        for k, top in enumerate(tops):
            c.part(rows(3 + 3 * k, top, 5 + 3 * k, 15), m, hi='tl', lo='r')
        c.part(rows(0, 12, 2, 20), m, hi='tl', lo='rb'); c.part(rows(21, 12, 23, 20), m, hi='tl', lo='rb')
        for y in (16, 18, 20):
            c.part(rows(3, y, 20, y + 1), m, hi='t', lo='b')              # the seat's slats
        c.rect(3, 22, 4, 26, m.lo); c.rect(19, 22, 20, 26, m.lo)
    return c


def stump():
    c = Cv(12, 11)
    c.part(rows(0, 3, 11, 10), Mat('#6a4a30', hi='#8a6644', lo='#4a3020'), hi='l', lo='rb')
    for x in (3, 7, 9):
        c.rect(x, 6, x, 9, rgb('#4a3020'))
    c.part(ellipse(5.5, 3, 5.5, 2.6), Mat('#d9b98a', hi='#ecd3a8', lo='#b08e5e'), hi='t', lo='b')
    c.rect(4, 3, 7, 3, rgb('#b08e5e')); c.px(5, 2, rgb('#b08e5e'))
    return c


def fire_pit():
    """The pit by day: a ring of stones round cold ash and a few charred logs."""
    c = Cv(32, 20)
    cx = 15.5
    side, rim = tones('#6f6a62', '#8a857b', '#a39e93'), tones('#a39e93', '#bdb8ad', '#d6d2c8')
    for y, x0, x1 in ellipse(cx, 12, 15, 7):                              # the wall of the ring
        for x in range(x0, x1 + 1):
            c.px(x, y, side[(x // 5 + (x // 5) % 2) % 2] if x % 5 else side[0])
    for y, x0, x1 in ellipse(cx, 8, 15, 7):                               # the tops of the stones
        for x in range(x0, x1 + 1):
            a = math.atan2((y - 8) / 7, (x - cx) / 15)
            k = int((a + math.pi) / (2 * math.pi) * 14)
            edge = abs(((a + math.pi) / (2 * math.pi) * 14) % 1 - 0.5) > 0.42
            c.px(x, y, rim[0] if edge else rim[1 + k % 2])
    for y, x0, x1 in ellipse(cx, 8, 10.5, 4.2):                           # the ash inside
        for x in range(x0, x1 + 1):
            c.px(x, y, rgb('#3a3632') if hsh(x, y, 200) % 4 else rgb('#5a5650'))
    for k in range(11):                                                   # two logs, crossed, burnt black at the ends
        c.px(10 + k, 10 - round(k * 0.35), rgb('#4a3020') if 2 < k < 9 else rgb('#1d1a18'))
        c.px(10 + k, 9 - round(k * 0.35), rgb('#7d5c3c') if 2 < k < 9 else rgb('#2a2622'))
        c.px(21 - k, 10 - round(k * 0.3), rgb('#3a2418') if 2 < k < 9 else rgb('#1d1a18'))
        c.px(21 - k, 9 - round(k * 0.3), rgb('#6a4a30') if 2 < k < 9 else rgb('#2a2622'))
    return c


def fire_frames():
    """The fire, four frames side by side: red at the edge, orange, then yellow, nearly white at the heart."""
    c = Cv(FIRE_W * 4, FIRE_H)
    cols = tones('#d83a1c', '#f2701e', '#ffb22e', '#ffe46a', '#fff6c8')
    for f in range(4):
        ox = f * FIRE_W + FIRE_W // 2
        tongues = ((0, 21 + (f * 3) % 5, 6.0), (-4, 13 + (f * 5 + 2) % 6, 3.6), (4, 14 + (f * 7 + 1) % 6, 3.8))
        depth = {}
        for dx, tall, wide in tongues:
            for j in range(int(tall)):
                t = j / tall
                half = wide * (1 - t ** 1.4)
                sway = math.sin(j / 3.2 + f * 1.7 + dx) * (1.6 * t)
                for i in range(int(round(-half * 2)), int(round(half * 2)) + 1):
                    x, y = dx + sway + i / 2, FIRE_H - 3 - j
                    inner = (1 - abs(i / 2) / max(0.6, half)) * (1 - t * 0.85)
                    key = (int(round(x)), y)
                    depth[key] = max(depth.get(key, 0), inner)
        for (x, y), v in depth.items():
            c.px(ox + x, y, cols[4] if v > 0.82 else cols[3] if v > 0.62 else cols[2] if v > 0.4 else cols[1] if v > 0.18 else cols[0])
        for k in range(3):                                                # sparks
            c.px(ox - 5 + (f * 3 + k * 5) % 11, 1 + (f * 5 + k * 3) % 7, cols[2 + k % 2])
        for i in range(-6, 7):                                            # the glowing bed
            c.px(ox + i, FIRE_H - 2, cols[1] if (i + f) % 3 else cols[3])
            if abs(i) < 5:
                c.px(ox + i, FIRE_H - 1, cols[0])
    return c.a


def firewood():
    c = Cv(26, 17)
    wood = Mat('#6a4a30', hi='#8a6644', lo='#4a3020')
    c.rect(0, 2, 1, 16, wood.lo); c.rect(24, 2, 25, 16, wood.lo)
    for row in range(3):
        for k in range(5 - (row == 2)):
            x, y = 2 + k * 4.5 + (row % 2) * 2.2 + (row == 2) * 0, 12 - row * 4.2
            c.part(ellipse(x + 2, y + 2, 2.3, 2.2), Mat('#d9b98a', hi='#ecd3a8', lo='#8a6644'), hi='t', lo='rb')
            c.px(int(x + 2), int(y + 2), rgb('#b08e5e'))
    return c


def garden_bed():
    """A raised bed: a timber frame round dark soil, rows of lettuce, staked tomatoes and carrot tops."""
    c = Cv(84, 44)
    frame = Mat('#a37747', hi='#c79a66', lo='#6f4d2c')
    c.part(rows(0, 10, 83, 43), frame, hi='tl', lo='rb')
    c.rect(0, 40, 83, 43, frame.lo); c.rect(0, 40, 83, 40, frame.base)
    for y in range(13, 39):
        for x in range(3, 81):
            h = hsh(x, y, 210) % 10
            c.px(x, y, rgb('#4a3324') if h < 6 else rgb('#5c4130') if h < 9 else rgb('#3a271b'))
    for k in range(8):                                                    # tomatoes at the back, on stakes
        x = 6 + k * 10
        c.rect(x + 2, 1, x + 2, 18, rgb('#c9a56a'))
        clump(c, x + 2, 11, 4.4, 6, LEAF['box'], 220 + k)
        for dx, dy in ((0, 8), (4, 12), (1, 14), (3, 6))[:2 + k % 3]:
            c.rect(x + dx, dy, x + dx + 1, dy + 1, rgb('#e0382c')); c.px(x + dx, dy, rgb('#ff7a60'))
    for k in range(9):                                                    # lettuces
        x = 5 + k * 9
        stamp(c, x, 22, ['.lLl.', 'lLlLl', 'LlLlL', '.lll.'], dict(l=rgb('#7fca5a'), L=rgb('#b4e07a')))
    for k in range(12):                                                   # carrots: feathery tops, a shoulder of orange
        x = 5 + k * 6 + (k % 2)
        stamp(c, x, 30, ['g.g', '.g.', 'ggg', '.o.'], dict(g=rgb('#4fae4a'), o=rgb('#f08a1e')))
    return c


def bird_bath():
    c = Cv(18, 24)
    stone = Mat('#b9b6ad', hi='#dedbd2', lo='#8a877f')
    c.part(rows(6, 8, 11, 19) + rows(4, 20, 13, 21) + rows(2, 22, 15, 23), stone, hi='l', lo='rb')
    c.part(ellipse(8.5, 5, 8.5, 3.6), stone, hi='t', lo='b')
    c.part(ellipse(8.5, 4.6, 6.5, 2.2), Mat('#5fb8dc', hi='#a9e0f2', lo='#3f93b8'), hi='t', lo='')
    stamp(c, 11, 0, ['.rr.', 'krro', '.rr.'], dict(r=rgb('#d8342c'), k=rgb('#15161d'), o=rgb('#f2a01e')))      # a cardinal, having a drink
    return c


def mailbox():
    c = Cv(16, 27)
    c.part(rows(6, 9, 8, 26), Mat('#7d5c3c', hi='#a07a50', lo='#4a3020'), hi='l', lo='r')
    box = Mat('#3b4256', hi='#6a7390', lo='#22242f')
    c.part([(0, 3, 12), (1, 2, 13)] + rows(1, 2, 14, 8), box, hi='t', lo='rb')
    c.part([(2, 2, 4), (3, 2, 5)] + rows(2, 4, 5, 8), Mat(box.hi, lo=box.base), hi='tl', lo='')      # its door
    c.px(4, 6, rgb('#e2c36a'))
    c.rect(11, 0, 11, 5, rgb('#b9c0cc')); c.rect(12, 0, 14, 2, rgb('#e0382c'))                        # the flag, up
    return c


def gnome():
    c = Cv(8, 14)
    stamp(c, 0, 0, ['...rr...', '..rrr...', '..rrrr..', '.rrrrr..', '.rrrrrr.', '.ssssss.', '.swswss.', '.wwwwww.', '.wwwwww.', 'bbwwwwbb', 'bbbwwbbb', '.bbbbbb.', '.kk..kk.', 'kkk..kkk'],
          dict(r=rgb('#d8342c'), s=rgb('#f2c9a8'), w=rgb('#f8f8f4'), b=rgb('#2f62d8'), k=rgb('#3a2a20')))
    return c


def flamingo():
    c = Cv(9, 17)
    stamp(c, 0, 0, ['.kpp.....', '.k.pp....', '....p....', '....p....', '...pp....', '..pp.....', '..p......', '..ppppp..', '.ppPPppp.', '.pPPPppp.', '..ppppp..', '....l....',
                    '....l....', '....l....', '....l....', '....l....', '...ll....'],
          dict(p=rgb('#ff8fb4'), P=rgb('#ffc2d6'), k=rgb('#15161d'), l=rgb('#e0708a')))
    return c


def pot(col='#e0444c'):
    """A terracotta pot of flowers for the step."""
    c = Cv(11, 14)
    clump(c, 5, 4, 5, 4, LEAF['box'], 240)
    bloom = rgb(col)
    for x, y in ((2, 2), (5, 1), (8, 3), (3, 5), (6, 4), (8, 6), (1, 5)):
        c.px(x, y, bloom); c.px(x + 1, y, mix(bloom, (255, 255, 255), 0.4))
    c.part(rows(1, 8, 9, 9) + rows(2, 10, 8, 13), Mat('#b9643c', hi='#dd8f63', lo='#7a3f26'), hi='t', lo='rb')
    return c


def hydrant():
    c = Cv(9, 13)
    m = Mat('#e0b21e', hi='#ffe06a', lo='#a37a12')
    c.part([(0, 3, 5), (1, 2, 6)] + rows(2, 2, 6, 10) + rows(1, 11, 7, 12), m, hi='tl', lo='rb')
    c.part(rows(0, 5, 1, 7), m, hi='t', lo='b'); c.part(rows(7, 5, 8, 7), m, hi='t', lo='b')
    c.px(4, 6, m.lo)
    return c


# ── the ground itself ──

def yard_ground(yd):
    c, tile = yd.g, grass_tile()
    for y in range(YY0, YY1):
        ours_y = FENCE_N < y < STREET_Y
        for x in range(YX0, YX1):
            i = tile[y % 32][x % 32]
            if ours_y and FENCE_W < x < FENCE_E:                        # our own lawn: mown in stripes, lush here, dry there
                if ((x + y // 2) // 26) % 2 and i == 2 and (x + y) % 2:
                    i = 3
                n = noise(x, y, 44, 3)
                if n > 0.38 and i == 2 and (x * 3 + y) % 4 < 2:
                    i = 1
                if n < -0.52 and i >= 2 and (x + y * 3) % 5 < 2:
                    c.px(x, y, DRY)
                    continue
            c.px(x, y, GREENS[i])
    for y in range(STREET_H):                                            # the sidewalk and the street
        for x in range(YX0, YX1):
            c.px(x, STREET_Y + y, street_px(x, y))

    def blob(cx, cy, rx, ry, seed, paint, rough=0.34):
        """An irregular patch of some other ground, its edge broken up."""
        for y in range(int(cy - ry * 1.4), int(cy + ry * 1.4) + 1):
            for x in range(int(cx - rx * 1.4), int(cx + rx * 1.4) + 1):
                d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 + noise(x, y, 11, seed) * rough
                if d < 0.8 or (d < 1 and hsh(x, y, seed) % 3):
                    paint(x, y, d)

    def dirt(x, y, d):
        h = hsh(x, y, 300) % 20
        c.px(x, y, rgb('#8a6a46') if h < 12 else rgb('#775a3a') if h < 16 else rgb('#a18358') if h < 19 else rgb('#c2b59a'))

    def gravel(x, y, d):
        h = hsh(x, y, 301) % 12
        c.px(x, y, rgb('#a49d8f') if h < 5 else rgb('#8f887b') if h < 8 else rgb('#bfb9ab') if h < 11 else rgb('#6f695f'))

    def mulch(x, y):
        h = hsh(x, y // 2, 302) % 12
        c.px(x, y, rgb('#5f3f2a') if h < 6 else rgb('#4d3222') if h < 9 else rgb('#7a5236'))

    # bare earth where the grass has given up: under the oak, by the gates, where the mower turns
    for cx, cy, rx, ry, seed in ((-40, 118, 13, 5, 5), (-46, 286, 15, 7, 6), (566, 290, 15, 6, 7), (-56, 196, 13, 6, 8), (566, 104, 12, 5, 9),
                                 (120, 376, 12, 5, 10), (470, 372, 10, 4, 11), (330, -44, 12, 5, 12), (604, 250, 12, 5, 13)):
        blob(cx, cy, rx, ry, seed, dirt)
    for k, gx in enumerate(UNDER_X[1:3]):                                # and the two patches the tulips grow in
        blob(gx + 9, UNDER_Y + 7, 10, 4.5, 20 + k, dirt, 0.2)
    blob(PIT[0], PIT[1] + 8, 46, 31, 14, gravel, 0.16)                   # the gravel round the fire pit
    for k in range(30):                                                  # a worn track from the gate to the fire
        blob(564 + round(7 * math.sin(k / 4.0)), 282 - k * 3, 5, 3, 30 + k, dirt, 0.5)

    # the patio out back: brick pavers laid in rows, a darker course round the edge
    px0, px1, py0, py1 = 356, 563, -70, -7
    for y in range(py0, py1 + 1):
        for x in range(px0, px1 + 1):
            row = (y - py0) // 6
            col = (x - px0 + (row % 2) * 6) // 12
            edge = x - px0 < 4 or px1 - x < 4 or y - py0 < 4 or py1 - y < 4
            if (y - py0) % 6 == 5 or (x - px0 + (row % 2) * 6) % 12 == 11:
                p = rgb('#7a756c')
            else:
                h = hsh(col, row, 310) % 10
                p = rgb('#b3ada2') if h < 5 else rgb('#a39d92') if h < 8 else rgb('#c2bcb0')
                if (y - py0) % 6 == 0:
                    p = mix(p, (255, 255, 255), 0.18)
                if edge:
                    p = mix(p, rgb('#8a5a3c'), 0.45)
            c.px(x, y, p)
    for x, y in ((372, -50), (373, -49), (498, -30), (499, -30), (438, -64), (530, -52), (531, -51)):      # moss and weeds in the joints
        c.px(x, y, GREENS[3])

    # beds of bark mulch along the front of the house, edged with stones; and the bed the sunflowers stand in
    for x0, x1 in ((6, 242), (298, 523)):
        for x in range(x0, x1 + 1):
            near = min(x - x0, x1 - x)
            front = 357 + round(1.6 * math.sin(x / 13.0)) - (3 - near if near < 3 else 0)
            for y in range(338, front + 1):
                mulch(x, y)
            if x % 4 != 3:
                c.px(x, front + 1, rgb('#c4bfb6') if x % 8 < 4 else rgb('#a9a39a')); c.px(x, front + 2, rgb('#847e75'))
    for y in range(184, 292):
        for x in range(636 + (y % 37 == 0), 650):
            mulch(x, y)
        c.px(634, y, rgb('#c4bfb6') if (y // 4) % 2 else rgb('#a9a39a')); c.px(635, y, rgb('#847e75'))

    # concrete: the front step, and the stepping stones that wander from it down to the sidewalk
    def slab(x0, y0, x1, y1, face=2):
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                c.px(x, y, rgb('#8a877f') if y > y1 - face else rgb('#e3e0d8') if y == y0 or x == x0 else rgb('#cfccc3') if hsh(x, y, 320) % 9 else rgb('#bbb8ae'))
    slab(250, 338, 291, 348)
    stone = Mat('#bdb7a8', hi='#dcd7ca', lo='#857f72')
    for k in range(6):
        t = k / 5
        cx = 270 + 30 * (t * t * (3 - 2 * t)) + (3 if k % 2 else -3)
        cy = 353 + k * 7.6
        blob(round(cx), round(cy) + 1, 11, 4.6, 40 + k, dirt, 0.25)      # the earth worn bare round each one
        spans = ellipse(cx, cy, 8 + (k % 2), 3.2)
        c.part(spans, stone, hi='tl', lo='rb')
        if k % 2:
            c.px(round(cx) + 2, round(cy), stone.lo); c.px(round(cx) + 3, round(cy) + 1, stone.lo)

    # little things in the grass: clover, dandelions, a longer tuft here and there
    for k in range(520):
        x, y = FENCE_W + 6 + hsh(k, 1, 330) % (FENCE_E - FENCE_W - 12), FENCE_N + 6 + hsh(k, 2, 330) % (STREET_Y - FENCE_N - 12)
        if not all(c.get(x + dx, y + dy) in GREENS for dx, dy in ((0, 0), (1, 0), (0, 1), (-1, 0), (0, -2))) or (-8 < x < 536 and -8 < y < 344):
            continue
        kind = hsh(k, 3, 330) % 10
        if kind < 3:
            c.px(x, y, rgb('#d4ecc0')); c.px(x + 1, y + 1, rgb('#d4ecc0'))                                  # clover in flower
        elif kind < 5:
            c.px(x, y, rgb('#f6d21c')); c.px(x, y + 1, GREENS[0])                                           # a dandelion
        else:
            c.px(x - 1, y - 1, GREENS[4]); c.px(x + 1, y - 2, GREENS[4]); c.px(x, y, GREENS[4]); c.px(x, y + 1, GREENS[0])


def yard_art(season='summer'):
    """Draws the whole yard as it is in one season. Returns the pictures to publish, and writes what the app needs to
    know into L['yard'] (the same whatever the season: nothing moves)."""
    set_season(season)
    yd = Yard()
    yd.snow = season == 'winter'
    yard_ground(yd)
    litter(yd, season)
    c = yd.g

    # the house, from outside: the top of its walls, lit along the north and west, with its shadow to the south-east
    c.rect(-5, -5, W + 4, H + 4, rgb('#0c0d12'))
    c.rect(-4, -4, W + 3, H + 3, rgb('#1b1c26'))
    c.rect(-4, -4, W + 3, -4, rgb('#3a3d50')); c.rect(-4, -4, -4, H + 3, rgb('#3a3d50'))
    yd.shadow[H + 5 - YY0:H + 11 - YY0, 0 - YX0:W + 9 - YX0] = 1.0
    yd.shadow[2 - YY0:H + 11 - YY0, W + 5 - YX0:W + 9 - YX0] = 1.0

    def stand(kind, x, y, **kw):
        t, sh = tree(kind, kw.pop('var', (x * 7 + y) % 50 + 1))
        yd.add(t, x, y, **kw)
        yd.shade(x + 5, y + 2, sh, sh * 0.34, 1.0, seed=x & 255 or 1)

    # ── fences: along the back, down both sides, and across to the house at the front with a gate each side ──
    yd.add(fence_run(FENCE_W, FENCE_E), (FENCE_W + FENCE_E) // 2, FENCE_N, ax=(FENCE_E - FENCE_W) // 2)
    fence_side(yd, FENCE_W, FENCE_N + 1, FENCE_S)
    fence_side(yd, FENCE_E - 2, FENCE_N + 1, FENCE_S)
    yd.add(fence_run(FENCE_W, -6, gate=(62, 86)), (FENCE_W - 6) // 2, FENCE_S, ax=(-6 - FENCE_W) // 2)
    yd.add(fence_run(534, FENCE_E, gate=(30, 54)), (534 + FENCE_E) // 2, FENCE_S, ax=(FENCE_E - 534) // 2)
    for x0, x1, y in ((FENCE_W, FENCE_E, FENCE_N), (FENCE_W, -6, FENCE_S), (534, FENCE_E, FENCE_S)):
        yd.shadow[y + 1 - YY0:y + 4 - YY0, x0 + 2 - YX0:x1 + 3 - YX0] = 1.0

    # ── out back, straight out from the back window: the big oak, and what grows under it ──
    t, _ = tree('oak')
    yd.add(t, OAK[0], OAK[1])
    yd.shade(OAK[0] + 4, OAK[1] + 8, 78, 20, 1.0, seed=17)
    yd.add(shrub('hydrangea', 10, '#7aa2e8'), UNDER_X[0] + 9, UNDER_Y, shadow=10)
    yd.add(shrub('azalea', 9, '#ff7fb0'), UNDER_X[3] + 9, UNDER_Y, shadow=9)
    for k, gx in enumerate(UNDER_X[1:3]):
        for dx, col in ((0, '#e0444c'), (4, '#f2c230'), (8, '#e0444c'), (12, '#fdfbf4'), (16, '#f2c230')):
            yd.add(flower('tulip', col), gx + 1 + dx, UNDER_Y + 6 + ((dx + 4 * k) % 8 == 4), edge=False)

    # ── the west side: a maple where the lawn would be bare, the hose, the mower, the air conditioner, the bins ──
    stand('maple', -70, 78)
    yd.add(shrub('hydrangea', 11, '#b48ae6'), -84, 128, shadow=11)
    yd.add(hose_coil(), -22, 138, shadow=11)
    for k in range(18):                                                  # the hose runs back to the tap on the wall
        x, y = -11 + round(k * 0.34), 131 - k
        c.px(x, y, rgb('#3fa650')); c.px(x + 1, y, rgb('#256e36'))
    c.rect(-7, 110, -5, 113, rgb('#8d93a3')); c.rect(-9, 109, -7, 109, rgb('#d8342c')); c.px(-8, 110, rgb('#d8342c'))
    yd.add(mower(), -66, 182, shadow=15)
    yd.add(ac_unit(), -20, 238, shadow=14)
    c.rect(-7, 226, -5, 227, rgb('#3b3f4d'))                              # its pipe into the wall
    stand('dogwood', -76, 268)
    yd.add(shrub('azalea', 9, '#ff7fb0'), -104, 292, shadow=9)
    yd.add(bin_('#2f6a44', False), -31, 289, shadow=7)                      # the bins, kept inside the gate
    yd.add(bin_('#2f5fa8', True), -15, 290, shadow=7)

    # ── the east side: chairs round the fire pit ──
    yd.add(adirondack('front'), PIT[0], PIT[1] - 17, shadow=11)
    yd.add(fire_pit(), PIT[0], PIT[1] + 9, edge=True)
    yd.add(stump(), PIT[0] - 30, PIT[1] + 8, shadow=6)
    yd.add(stump(), PIT[0] + 31, PIT[1] + 6, shadow=6)
    yd.add(adirondack('back'), PIT[0] - 17, PIT[1] + 37, shadow=11)
    yd.add(adirondack('back'), PIT[0] + 18, PIT[1] + 38, shadow=11)
    yd.add(firewood(), 548, 230, shadow=13)
    stand('pine', 606, 50)
    for k in range(6):
        yd.add(flower('sun'), 643 - (k % 2) * 3, 200 + k * 17, shadow=4)
    yd.add(shrub('box', 8), 546, 296, shadow=8)
    yd.add(shrub('grass'), 632, 112, shadow=8)
    yd.add(shrub('hydrangea', 10, '#7aa2e8'), 560, 84, shadow=10)

    # ── out back: the patio with its table and the grill, the vegetable bed, a bird bath ──
    yd.add(patio_chair('front'), 446, -38)
    side = patio_chair('side')
    yd.add(side, 420, -22)
    yd.add(side.flipped(), 472, -22)
    yd.add(patio_table(), 446, -20, shadow=18)
    yd.add(patio_chair('back'), 446, -9)
    yd.add(grill(), 528, -14, shadow=15)
    yd.add(pot('#f2c230'), 366, -12, shadow=5)
    yd.add(garden_bed(), 240, -16, shadow=40)
    yd.add(bird_bath(), 322, -14, shadow=8)
    stand('birch', 596, -62)
    yd.add(shrub('box', 10), -100, -40, shadow=10)
    yd.add(shrub('hydrangea', 11, '#ff9ac2'), 14, -12, shadow=11)
    yd.add(shrub('box', 8), 184, -66, shadow=8)
    yd.add(shrub('grass'), 344, -74, shadow=8)
    for k in range(9):                                                   # lavender along the back of the patio
        yd.add(flower('lavender', '#9a7ae0'), 372 + k * 21 + (k % 2) * 3, -72 - (k % 3), edge=False)

    # ── the front: planting along the wall, pots by the door, the mailbox at the sidewalk ──
    row = [('cone', 15, 357), ('hydrangea', 40, 355, 11, '#7aa2e8'), ('box', 66, 354, 9), ('azalea', 92, 356, 9, '#ff7fb0'), ('grass', 116, 356),
           ('box', 140, 355, 10), ('hydrangea', 168, 356, 11, '#ff9ac2'), ('box', 194, 354, 8),
           ('box', 344, 354, 8), ('hydrangea', 370, 356, 11, '#b48ae6'), ('grass', 396, 356), ('azalea', 422, 356, 9, '#fdfbf4'),
           ('box', 448, 355, 10), ('hydrangea', 478, 355, 11, '#7aa2e8'), ('cone', 512, 357)]
    for kind, x, y, *rest in row:
        s = shrub(kind, *rest)
        yd.add(s, x, y, shadow=s.w // 2 - 1)
    for k, x in enumerate(list(range(208, 240, 5)) + list(range(302, 334, 5))):
        yd.add(flower('tulip' if k % 3 else 'daisy', ('#e0444c', '#f2c230', '#b06ae0', '#ff8f4c')[k % 4]), x, 354 + (k % 2) * 3, edge=False)
    yd.add(pot('#e0444c'), 246, 351, shadow=5)
    yd.add(pot('#e0444c'), 295, 351, shadow=5)
    yd.add(gnome(), 222, 366, shadow=4)
    yd.add(flamingo(), 100, 371, shadow=3)
    yd.add(mailbox(), 322, 394, shadow=5)
    yd.add(hydrant(), 452, 409, shadow=4)
    stand('jmaple', 150, 392)
    stand('maple', -64, 392)
    stand('birch', 604, 392)

    # ── next door, over the fences, and the trees beyond the back one ──
    stand('birch', -164, 150)
    stand('pine', -162, 330)
    stand('dogwood', 692, 250)
    stand('pine', 696, -30)
    for x, kind in ((-90, 'pine'), (-14, 'maple'), (230, 'pine'), (300, 'oak'), (470, 'maple'), (560, 'pine')):
        stand(kind, x, FENCE_N - 26 - (x % 7))
    for x, kind in ((-150, 'maple'), (130, 'pine'), (390, 'maple'), (640, 'pine')):         # and a second row behind those
        stand(kind, x, FENCE_N - 64 - (x % 5))
    for x, kind in ((-120, 'birch'), (96, 'maple'), (420, 'pine'), (660, 'maple')):         # across the street
        stand(kind, x, STREET_Y + STREET_H + 62 + (x % 9))
    yd.add(shrub('box', 9), -160, 60, shadow=9)
    yd.add(shrub('hydrangea', 10, '#ff9ac2'), 690, 110, shadow=10)
    if season == 'winter':                                               # a snowman on the front lawn, and another out back
        yd.add(snowman(), 60, 380, shadow=6)
        yd.add(snowman('#3b82f6'), -40, -58, shadow=6)
    if season == 'fall':                                                 # pumpkins by the front path, and a big one by the mailbox
        yd.add(yard_pumpkin(), 234, 368, shadow=3)
        yd.add(yard_pumpkin(), 306, 368, shadow=3)
        yd.add(yard_pumpkin(True), 336, 394, shadow=4)

    yd.shadow[-5 - YY0:H + 5 - YY0, -5 - YX0:W + 5 - YX0] = 0             # (no shadow falls on the top of the walls)
    scene, front = yd.compose()
    # what stands in front of the house and reaches up over its near wall: a strip to lay over the bottom of the room
    over = front[0 - YY0:H - YY0, 0 - YX0:W - YX0]
    ys, xs = np.nonzero(over[..., 3] > 0)
    if len(ys) and ys.min() < FLOOR_END:
        raise SystemExit('something in the front yard reaches into the room: row %d' % ys.min())
    y0 = int(ys.min()) if len(ys) else H - 1
    strip = over[y0:H].copy()

    street = Cv(STREET_W, STREET_H)
    for y in range(STREET_H):
        for x in range(STREET_W):
            street.px(x, y, street_px(x, y))
    grass, tile = Cv(32, 32), grass_tile()
    for y in range(32):
        for x in range(32):
            grass.px(x, y, GREENS[tile[y][x]])
    L['yard'] = dict(box=[YX0, YY0, YW, YH], street=[STREET_Y, STREET_H, STREET_W], front=[0, y0, W, H - y0],
                     fire=[PIT[0] - FIRE_W // 2, PIT[1] + 5 - FIRE_H, FIRE_W, FIRE_H], pit=list(PIT))
    out = dict(grass=grass.a, street=street.a, yard=scene, yardfront=strip, fire=fire_frames())
    set_season('summer')                                                 # (leave the colours as they were found)
    return out


def decor():

    bx, by, bw, bh = 373, 12, 120, 65                                   # the whiteboard's frame starts at (bx, by); its face is bw by bh

    def board(c):                                                       # a whiteboard anyone can draw on; the app paints the drawing into it
        c.part(rows(bx, by, bx + bw + 5, by + bh + 5), Mat('#b9bfcc', hi='#e3e7ef', lo='#7d8496'), hi='tl', lo='rb')      # its aluminium frame
        c.rect(bx + 2, by + 2, bx + bw + 3, by + bh + 3, rgb('#f7f6f0'))
        c.rect(bx + 14, by + bh + 6, bx + bw - 9, by + bh + 7, rgb('#8d93a3'))      # the pen tray, with four pens and an eraser
        for k, col in enumerate(('#1b1c22', '#d8342c', '#2f62d8', '#3aa845')):
            c.rect(bx + 18 + 9 * k, by + bh + 6, bx + 23 + 9 * k, by + bh + 6, rgb(col))
        c.rect(bx + 58, by + bh + 5, bx + 64, by + bh + 6, rgb('#3b3f4d'))
    put(base, board)
    L['board'] = [bx + 3, by + 3, bw, bh]                               # the app's picture is drawn to fit this, whatever its own size

    cx, cy = 20, 24                                                     # the clock: in the left corner, a little way in from the side wall, halfway up

    def clock(c):                                                       # a digital clock; the app lights the time, with the date and the weather under it
        c.part(rows(cx, cy, cx + 45, cy + 33), Mat('#2a2c3a', hi='#4a4d63', lo='#15161d'), hi='tl', lo='rb')
        c.rect(cx + 2, cy + 2, cx + 43, cy + 31, rgb('#07080c'))
        c.rect(cx + 4, cy + 14, cx + 41, cy + 14, rgb('#1b1d28'))
        c.rect(cx + 4, cy + 23, cx + 41, cy + 23, rgb('#1b1d28'))
    put(base, clock)
    L['clock'] = [cx + 2, cy + 2, 42, 12]
    L['date'] = [cx + 2, cy + 15, 42, 8]
    L['temp'] = [cx + 2, cy + 24, 42, 8]

    def mat(c):                                                        # the front door is in the near wall, by this mat: coir, in a rubber border
        x0, y0, x1, y1 = 255, 319, 286, 327
        c.rect(x0, y0, x1, y1, rgb('#2a2622'))                             # the border
        c.rect(x0, y0, x1, y0, rgb('#4a443c'))
        coir = [rgb('#b98a52'), rgb('#a57642'), rgb('#cfa468'), rgb('#8a6234')]
        for y in range(y0 + 1, y1):
            for x in range(x0 + 1, x1):
                c.px(x, y, coir[hsh(x, y * 3, 41) % 3 if hsh(x, y, 42) % 6 else 3])      # bristles: mostly three tans, the odd dark one
        for x in range(x0 + 4, x1 - 3):                                    # a darker band worked into it near each end, and a diamond in the middle
            pass
        for y in range(y0 + 2, y1 - 1):
            c.px(x0 + 3, y, rgb('#6e4a24')); c.px(x1 - 3, y, rgb('#6e4a24'))
        mid = (x0 + x1) // 2
        for dx, dy in ((0, -2), (-1, -1), (1, -1), (-2, 0), (2, 0), (-1, 1), (1, 1), (0, 2), (1, -2), (2, -1), (3, 0), (2, 1), (1, 2)):
            c.px(mid + dx, (y0 + y1) // 2 + dy, rgb('#6e4a24'))
    put(base, mat, edge=False)
    base.rect(254, 328, 287, 329, rgb('#8a5a3c'))                       # the door's threshold in the wall
    L['door'] = dict(x=270, y=324)

    plant(141, 323, ((-4, 15, -3), (-1, 22, 0), (2, 18, 3), (0, 12, -1)))
    ficus(511, 326)
    big_leafy(366, 226)                                                 # to the left of the sofa

    # places to stand when away from the keyboard
    L['wander'] = [dict(x=184, y=296, face='down'), dict(x=284, y=266, face='down'), dict(x=160, y=182, face='down'),
                   dict(x=96, y=176, face='up'), dict(x=366, y=190, face='down')]


def grid():
    """Which floor cells a person's feet may stand on. Furniture is padded by half a body, so nobody brushes through it."""
    cols, nrows = W // CELL, math.ceil(H / CELL)
    out = []
    for r in range(nrows):
        line = ''
        for c in range(cols):
            x, y = c * CELL + CELL // 2, r * CELL + CELL // 2
            ok = 6 + 9 <= x <= 521 - 9 and WALL + 6 <= y <= FLOOR_END - 1
            for x0, y0, x1, y1 in blocked:
                if x0 - 9 <= x <= x1 + 9 and y0 - 1 <= y <= y1 + 4:
                    ok = False
            line += '.' if ok else '#'
        out.append(line)
    return out


def check_walkable():
    """Every place somebody can be sent must be reachable on foot from the door: a room cut in two makes people
    (and the pets) pass straight through the furniture."""
    g = L['grid']
    cols, nrows = len(g[0]), len(g)
    cell = lambda p: (int(p['x']) // CELL, int(p['y']) // CELL)

    def nearest(p):
        c0, r0 = cell(p)
        for d in range(20):
            for r in range(r0 - d, r0 + d + 1):
                for c in range(c0 - d, c0 + d + 1):
                    if max(abs(r - r0), abs(c - c0)) == d and 0 <= r < nrows and 0 <= c < cols and g[r][c] == '.':
                        return c, r
        raise SystemExit('nowhere to stand near %r' % (p,))
    seen = {nearest(L['door'])}
    todo = list(seen)
    while todo:
        c, r = todo.pop()
        for dc, dr in ((0, 1), (1, 0), (0, -1), (-1, 0)):
            n = (c + dc, r + dr)
            if 0 <= n[1] < nrows and 0 <= n[0] < cols and g[n[1]][n[0]] == '.' and n not in seen:
                seen.add(n); todo.append(n)
    spots = {'pc%d' % i: b for i, b in enumerate(L['pcs'])}
    spots.update({'gym%d' % i: b for i, b in enumerate(L['gym'])})
    spots.update({'bag%d' % i: b for i, b in enumerate(L['bags'])})
    spots['arcade'] = L['arcade']
    spots['pet tree'] = L['pets']['tree']['foot']
    spots.update({'cinema%d' % i: b for i, b in enumerate(L['theatre'])})
    spots.update({'living%d' % i: b for i, b in enumerate(L['living'])})
    spots.update({'snack%d' % i: b for i, b in enumerate(L['snack'])})
    spots.update({'table%d' % i: b for i, b in enumerate(L['table'])})
    spots.update({'pet%d' % i: b for i, b in enumerate(L['pets']['spots'])})
    spots.update({'laptop%d' % i: b for i, b in enumerate(L['laptops'])})
    spots.update(toilet=L['toilet'], shower=L['shower'], mat=L['showerWait'], bowl=L['pets']['bowl'], switch=L['bath']['switch'])
    cut = [name for name, s in spots.items() if nearest(dict(x=s.get('ax', s['x']), y=s.get('ay', s['y']))) not in seen]
    if cut:
        raise SystemExit('cannot be walked to from the door: ' + ', '.join(cut))


def mock_desk(dx, dy, cy):
    """The mock-up's stand-in for a desk and its chair: the plain one, as the app draws it when nobody has made it
    theirs (client/src/draw/desk.ts draws the real ones). Its picture, the size of the room."""
    c = Cv(W, H)
    desk, black = Mat('#363a4e', hi='#4d5270', lo='#20222d'), rgb('#15161d')
    c.rect(dx + 2, dy + 16, dx + 3, dy + 32, desk.lo); c.rect(dx + 46, dy + 16, dx + 47, dy + 32, desk.lo)      # legs
    c.part(rows(dx + 1, dy, dx + 48, dy + 15), desk, hi='t', lo='')       # the top
    c.part(rows(dx + 1, dy + 16, dx + 48, dy + 22), Mat(desk.lo), hi='', lo='b')
    c.rect(dx + 10, dy + 3, dx + 39, dy + 14, rgb('#191b25'))             # the deskpad, the keyboard, the mouse
    c.rect(dx + 11, dy + 8, dx + 21, dy + 11, rgb('#2b2e3c'))
    c.rect(dx + 37, dy + 10, dx + 38, dy + 12, rgb('#dfe2ea'))
    c.rect(dx + 20, dy - 3, dx + 23, dy, black); c.rect(dx + 17, dy + 1, dx + 26, dy + 2, black)      # the monitor, on its stand
    c.rect(dx + 8, dy - 21, dx + 35, dy - 3, rgb('#2d3040')); c.rect(dx + 9, dy - 20, dx + 34, dy - 5, rgb('#0c0f17'))
    c.part(rows(dx + 38, dy - 16, dx + 47, dy + 3), Mat('#1d1f29', hi='#3a3d50', lo='#101117'), hi='tl', lo='rb')      # the tower
    c.rect(dx + 40, dy - 13, dx + 45, dy, rgb('#0b0c12'))
    seat = Mat('#262733', hi='#3d3f52', lo='#15161d')                     # the chair: its seat and feet, then its back
    c.part(rows(dx + 17, cy + 38, dx + 32, cy + 41), seat, hi='t', lo='b')
    c.rect(dx + 24, cy + 44, dx + 25, cy + 45, rgb('#3a3c4c'))
    c.part([(cy + 46, dx + 20, dx + 29), (cy + 47, dx + 19, dx + 30)], seat, hi='t', lo='b')
    c.part([(cy + 28, dx + 21, dx + 28), (cy + 29, dx + 19, dx + 30), (cy + 30, dx + 18, dx + 31), (cy + 31, dx + 18, dx + 31)] +
           rows(dx + 16, cy + 32, dx + 33, cy + 43), Mat('#262733', hi='#42455a', lo='#15161d'), hi='t', lo='rb')
    for x0 in (dx + 18, dx + 30):
        c.rect(x0, cy + 33, x0 + 1, cy + 42, rgb('#5b6079'))
    return outline(c.a)


def big(arr):
    """The app's copies are published four times the size, so the room can be shown at any zoom and stay even."""
    im = Image.fromarray(arr, 'RGBA')
    return im.resize((im.width * 4, im.height * 4), Image.NEAREST)


def main():
    floors()
    walls()
    L['windows'] = []       # the room has no window now. The sky and the weather are still drawn: the yard round the house shows them
    L['light'] = LIGHT
    L['orb'] = ORB
    # Six desks in one row along the back wall, a few dots apart: desk k is slot k's, from the left. Nobody's desk is
    # painted here: whoever sits at one brings their own setup, and the app draws it.
    desk_x = [10 + 57 * k for k in range(6)]
    # the big picture: in the middle of the wall, behind the third and fourth desks, halfway up; the desks go in front
    framed_photo(GALLERY[0], (desk_x[2] + desk_x[3] + 50) // 2 - PHOTO_W // 2, 17)
    for g in GALLERY[1:]:                                     # and four smaller ones beside it, each a different size
        framed_photo(g, *g['at'])
    L['pcs'] = [desk_place(x, WALL) for x in desk_x]
    L['laptops'] = [dict(x=182, y=300), dict(x=300, y=322), dict(x=218, y=324)]
    lounge()
    bean_bags()
    arcade()
    snack()
    cat_tree()              # (after snack, which lists the pets' other places)
    neon = neon_sign()
    lamps()
    kitchen_table()
    trash_can()
    bathroom()
    decor()
    L['grid'] = grid()
    check_walkable()
    sheet = pack()
    L['atlas'] = [int(sheet.shape[1]), int(sheet.shape[0])]
    L['over'] = [e for _, e in occluders]

    root = os.path.join(HERE, '..')
    pub = os.path.join(root, 'client', 'public', 'clubhouse')
    os.makedirs(pub, exist_ok=True)
    big(base.a).save(os.path.join(pub, 'base.png'))
    big(sheet).save(os.path.join(pub, 'over.png'))
    big(np.hstack(bed_tiles)).save(os.path.join(pub, 'beds.png'))          # each desk as a bed, side by side in desk order
    big(drinks_sheet()).save(os.path.join(pub, 'drinks.png'))
    big(neon).save(os.path.join(pub, 'neon.png'))
    ball = ball_sheet()
    big(ball).save(os.path.join(pub, 'ball.png'))
    big(wad_sheet()).save(os.path.join(pub, 'wad.png'))
    # What the ball bounces off: every piece of furniture and wall (the same rectangles the walking grid is made
    # from, without the half a body of padding), and the edges of the floor.
    L['blocks'] = [list(b) for b in blocked]
    L['floor'] = [10, WALL + 4, 517, FLOOR_END - 1]
    L['drinks'] = DRINKS
    sky, ground, clouds = window_frames()
    big(sky).save(os.path.join(pub, 'sky.png'))
    big(ground).save(os.path.join(pub, 'ground.png'))
    big(clouds).save(os.path.join(pub, 'clouds.png'))
    big(orbs()).save(os.path.join(pub, 'orbs.png'))
    yard = yard_art()
    for name, art in yard.items():
        big(art).save(os.path.join(pub, name + '.png'), optimize=True)
    front = L['yard']['front']
    for season in SEASONS:                                   # the other three seasons: the same scene in their colours
        other = yard_art(season)
        assert L['yard']['front'] == front, 'the front strip must be the same size in every season'
        for name in ('grass', 'yard', 'yardfront'):
            big(other[name]).save(os.path.join(pub, '%s-%s.png' % (name, season)), optimize=True)
        Image.fromarray(other['yard'], 'RGBA').save(os.path.join(root, 'art', 'yard-%s.png' % season))
    for old in ('path.png', 'patio.png'):                    # pictures the yard used before it was one scene
        if os.path.exists(os.path.join(pub, old)):
            os.remove(os.path.join(pub, old))
    # Places in the room that can be clicked to say where you are: [what it sets, x, y, width, height].
    # 'desk' asks which (gaming, working or sleeping).
    # These are the furniture itself: every seat is a place of its own (its `hit`), and open floor is somewhere to stand,
    # so none of these takes in a seat or any floor that can be walked on (the way out is the doorway, below the mat).
    # (the fridge is listed before the kitchen it stands in: the first place a click is inside is the one it means)
    L['spots'] = [['fridge', 134, 210, 23, 56], ['kitchen', 134, 210, 64, 56],
                  ['bathroom', 4, 284, 36, 40], ['showering'] + L['shower']['rect'], ['away', 254, 324, 34, 10]]
    L['spots'] += [['trash'] + L['trash']['hit']]              # the bin: grab a wad of paper to throw at it
    L['spots'] += [['desk', d['x'] - 25, WALL - 22, 50, d['y'] - WALL + 26] for d in L['pcs']]
    strip, where, lights = seasonal_art()
    big(strip).save(os.path.join(pub, 'deco.png'))
    big(lights).save(os.path.join(pub, 'lights.png'))
    # where each seasonal piece is on its strip ([x, width, height]), and where they go in the room (by their bottom-left corner)
    L['deco'] = dict(size=[int(strip.shape[1]), int(strip.shape[0])], at=where)
    L['season'] = dict(pumpkins=[[236, 327], [181, 234], [368, 314]], tree=[352, 326], lights=[6, 4, 516, 6])      # (the tree: the lounge's near left corner; the fig and the lantern have the right one)
    for name, tile in weather_tiles().items():
        big(tile).save(os.path.join(pub, name + '.png'))
    ww, wh = WIN[2], WIN[3]
    hours = Image.new('RGBA', (ww * 6 + 14, (wh + 2) * 4 + 2), (20, 20, 28, 255))      # every hour, for checking
    for hr in range(24):
        cell = Image.fromarray(sky[:, hr * ww:(hr + 1) * ww].copy(), 'RGBA')
        cl = Image.fromarray(clouds, 'RGBA').crop((hr * 9, 0, hr * 9 + ww, 30))
        cell.alpha_composite(Image.eval(cl, lambda v: v) if LIGHT[hr] > 0.5 else Image.blend(Image.new('RGBA', cl.size, (0, 0, 0, 0)), cl, 0.35), (0, 4))
        cell.alpha_composite(Image.fromarray(ground[:, hr * ww:(hr + 1) * ww].copy(), 'RGBA'))
        hours.paste(cell, (2 + (hr % 6) * (ww + 2), 2 + (hr // 6) * (wh + 2)))
    hours.resize((hours.width * 2, hours.height * 2), Image.NEAREST).save(os.path.join(root, 'art', 'window-hours.png'))
    with open(os.path.join(root, 'client', 'src', 'clubhouse.gen.ts'), 'w', encoding='utf8', newline='\n') as fh:
        fh.write('// Written by scripts/make-clubhouse.py. Do not edit by hand.\n')
        fh.write('export const CLUB = ' + json.dumps(L) + ';\n')

    # A mock-up of the room, for judging the art without running the app. Nobody is in it (the app draws the people),
    # and a plain desk stands in for each of the ones the app draws; the fifth is shown as the bed it turns into.
    img = Image.fromarray(base.a, 'RGBA')
    img.alpha_composite(Image.fromarray(neon, 'RGBA'), tuple(L['neon']['at'][:2]))
    for k, d in enumerate(L['pcs']):
        if k == 4:
            img.alpha_composite(Image.fromarray(bed_tiles[k], 'RGBA'), tuple(d['bed']['at'][:2]))
        else:
            img.alpha_composite(Image.fromarray(mock_desk(d['dx'], d['dy'], d['cy']), 'RGBA'))
    things = [(e['z'], crop, e) for crop, e in occluders]
    things.append((L['ball']['y'], ball[:, :11].copy(), dict(x=L['ball']['x'] - 5, y=L['ball']['y'] - 9)))      # the ball, where it starts
    for z, crop, e in sorted(things, key=lambda t: t[0]):
        img.alpha_composite(Image.fromarray(crop, 'RGBA'), (e['x'], e['y']))
    grid_img = img.copy()                                    # the same picture with the no-go cells marked
    px = grid_img.load()
    for r, line in enumerate(L['grid']):
        for c, ch in enumerate(line):
            if ch == '#':
                for yy in range(r * CELL + 2, min(H, r * CELL + 4)):
                    for xx in range(c * CELL + 2, c * CELL + 4):
                        px[xx, yy] = (255, 60, 60, 255)
    art = os.path.join(root, 'art')
    # the yard with the room in it, by day and by night (as the app shades it, with the fire lit)
    night = yard['yard'].astype(np.float32)
    night[..., :3] = night[..., :3] * 0.38 + np.array([6, 10, 34], np.float32) * 0.62
    fx, fy, fw, fh = L['yard']['fire']
    for yy in range(-44, 45):                                # the firelight on the ground
        for xx in range(-70, 71):
            d = math.hypot(xx / 70, yy / 44)
            if d < 1:
                dot = night[PIT[1] + yy - YY0, PIT[0] + xx - YX0]
                dot[:3] = np.minimum(255, dot[:3] + np.array([255, 150, 60]) * 0.42 * (1 - d) ** 1.3)
    flame = yard['fire'][:, :fw]
    spot = night[fy - YY0:fy - YY0 + fh, fx - YX0:fx - YX0 + fw]
    spot[flame[..., 3] > 0] = flame[flame[..., 3] > 0]
    for name, ground_ in (('yard-day.png', yard['yard']), ('yard-night.png', night.astype(np.uint8))):
        whole = Image.fromarray(ground_, 'RGBA')
        whole.alpha_composite(img, (-YX0, -YY0))
        fr = L['yard']['front']
        whole.alpha_composite(Image.fromarray(yard['yardfront'], 'RGBA'), (fr[0] - YX0, fr[1] - YY0))
        whole.resize((YW * 2, YH * 2), Image.NEAREST).save(os.path.join(art, name))
    bare = Image.fromarray(base.a, 'RGBA')
    for crop, e in sorted(occluders, key=lambda t: t[1]['z']):
        bare.alpha_composite(Image.fromarray(crop, 'RGBA'), (e['x'], e['y']))
    bare.crop((230, 222, 330, 302)).resize((800, 640), Image.NEAREST).save(os.path.join(art, 'table-preview.png'))
    gx, gy, gw, gh = WIN
    view = Image.fromarray(sky[:, 12 * gw:13 * gw].copy(), 'RGBA')                    # the window at midday...
    view.alpha_composite(Image.fromarray(ground[:, 12 * gw:13 * gw].copy(), 'RGBA'))
    wall = bare.crop((gx - 14, gy - 10, gx + gw + 14, gy + gh + 10))
    wall.paste(view, (14, 10))
    wall = wall.resize((wall.width * 8, wall.height * 8), Image.NEAREST)
    patch = Image.fromarray(yard['yard'], 'RGBA').crop((gx - 22 - YX0, -152 - YY0, gx + gw + 22 - YX0, 6 - YY0))      # ...and what stands outside it
    patch = patch.resize((patch.width * 5, patch.height * 5), Image.NEAREST)
    match = Image.new('RGBA', (wall.width + patch.width + 60, max(wall.height, patch.height) + 40), (20, 20, 28, 255))
    match.paste(wall, (20, (match.height - wall.height) // 2)); match.paste(patch, (wall.width + 40, 20))
    match.save(os.path.join(art, 'window-match.png'))
    img.resize((W * 3, H * 3), Image.NEAREST).save(os.path.join(art, 'clubhouse-preview.png'))
    grid_img.resize((W * 2, H * 2), Image.NEAREST).save(os.path.join(art, 'clubhouse-walkable.png'))
    print('clubhouse written:', len(occluders), 'pieces,', len(L['grid']), 'x', len(L['grid'][0]), 'cells')


if __name__ == '__main__':
    main()
