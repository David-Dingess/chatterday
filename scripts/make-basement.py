#!/usr/bin/env python3
"""Draws the basement: one room under the clubhouse, fitted out several ways.

    python scripts/make-basement.py            (every fit-out)
    python scripts/make-basement.py gameroom   (just that one)

The basement is one shell: the house's own footprint (528 x 334, the same as the room upstairs), bare block walls,
pipes along the back wall, and the stairs coming down in exactly the place they go down upstairs (CLUB.stairs), so the
group arrives where it left. What is in it changes: each fit-out is a module of its own in scripts/basement/
(`unfinished.py`, `gameroom.py`, ...), which draws its furniture over the shell and says where people can sit and stand.
A new fit-out is a new module there and nothing else: this script finds it.

A fit-out module has:
    TITLE = 'Game room'                 what the stairs' menu calls it
    BLURB = 'Pool, darts and a bar'     a line under that
    ORDER = 20                          where it comes in the menu (lowest first)
    def draw(mc, L): ...                draws it, with the clubhouse script's own tools (mc: put, put_over, block, light,
                                        Mat, rgb, shade, tint, rows, ellipse...), on mc.base (the floor and what stands
                                        against the walls) and with mc.put_over (pieces people pass behind). It fills in
                                        L['seats'] and L['stands'] (below), and anything of its own in L['things'].

Each fit-out is written to client/public/basement/<id>/base.png and over.png, and its layout (seats, where to stand, which
floor cells can be walked on, its lights, the pieces drawn in front of people) to client/src/basement/<id>.gen.ts. The
page finds every layout there by itself. A preview with nobody in it goes to art/basement-<id>.png.

Seats: dict(x, y, ax, ay, pose, flip, hit), where (x, y) is where the sitter's feet are drawn, (ax, ay) the open floor
they walk to before they sit, pose 'front' (facing us), 'back' (facing the back wall), 'side' (facing left; flip faces
right) or 'stand' (standing there, facing `face`: 'up', 'down', 'left' or 'right'), and hit the box a click on it means.
Stands: dict(x, y, face): open floor where people stand about when there is no seat for them.
"""
import importlib.util
import json
import os
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..')
spec = importlib.util.spec_from_file_location('mc', os.path.join(HERE, 'make-clubhouse.py'))
mc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mc)

W, H, WALL, CELL, FLOOR_END = mc.W, mc.H, mc.WALL, mc.CELL, mc.FLOOR_END
rgb, mix, shade, tint, Mat = mc.rgb, mc.mix, mc.shade, mc.tint, mc.Mat

# The stairs: the same flight as upstairs (see stairs() in make-clubhouse.py), seen from below.
SX0, SX1, STOP, SSTEP, SN = 7, 36, 160, 6, 11
SBOT = STOP + SSTEP * SN - 1
FOOT = dict(x=SX0 + 15, y=SBOT + 8)          # where one stands at the foot of the stairs (to go up, or having come down)

BLOCKW = Mat('#8d8a84', hi='#a9a59e', lo='#6c6964')     # painted cinder block
CONCRETE = rgb('#9c9993')


def hsh(x, y, s=0):
    return ((x * 73856093) ^ (y * 19349663) ^ (s * 83492791)) & 0xffff


def concrete(x, y):
    """Sealed concrete: a pale grey, trowelled (slow lumps of light and shade), flecked with aggregate, a few hairline
    cracks, and a saw-cut joint every 88 dots across and every 77 down whose near lip catches the light."""
    c = CONCRETE
    lump = mc.noise(x, y, 26, 4) * 0.6 + mc.noise(x, y, 9, 6) * 0.4
    c = tint(c, 0.07 * lump) if lump > 0 else shade(c, -0.09 * lump)
    n = hsh(x, y, 3) % 100
    if n < 5:
        c = shade(c, 0.14)
    elif n > 96:
        c = tint(c, 0.16)
    elif n == 50:
        c = mix(c, rgb('#8a7a66'), 0.4)                    # a fleck of brown stone
    if (x - y // 3 + int(4 * mc.noise(x, y, 11, 8))) % 97 == 0 and hsh(x // 20, y // 20, 9) % 5 == 0:
        c = shade(c, 0.14)                                 # a hairline crack, here and there
    jx, jy = (x - 6) % 88, (y - WALL) % 77
    if jx == 0 or jy == 0:
        c = shade(c, 0.3)
    elif jx == 1 or jy == 1:
        c = tint(c, 0.1)
    elif jx == 87 or jy == 76:
        c = shade(c, 0.08)
    return c


def shell_floor():
    for y in range(WALL, FLOOR_END + 1):
        for x in range(6, 522):
            c = concrete(x, y)
            if y < WALL + 6:
                c = shade(c, 0.34 - 0.06 * (y - WALL))
            if x < 10 or x > 517:
                c = shade(c, 0.2 - 0.05 * (x - 6 if x < 10 else 521 - x))
            mc.base.px(x, y, c)


def shell_walls():
    """Painted cinder block: each block a slightly different grey, its top and left lit, its right and bottom in shade,
    pocked; the joists' shadow at the top, the slab's at the foot. Along the top, the sill plate and the ends of the
    joists, a copper water line and a galvanised duct on their hangers."""
    dark = rgb('#17151f')
    b = mc.base
    for y in range(4, WALL):
        for x in range(6, 522):
            row = (y - 4) // 8
            off = 8 if row % 2 else 0
            bx, by = (x + off) % 16, (y - 4) % 8
            mortar = by == 7 or bx == 15
            blk = hsh((x + off) // 16, row, 2) % 5
            body = shade(BLOCKW.base, 0.025 * blk) if blk < 3 else tint(BLOCKW.base, 0.03 * (blk - 2))
            if mortar:
                c = rgb('#6a6762')
            elif by == 0 or bx == 0:
                c = tint(body, 0.14)
            elif by == 6 or bx == 14:
                c = shade(body, 0.12)
            else:
                c = body
                if hsh(x, y, 4) % 19 == 0:
                    c = shade(c, 0.12)                     # a pock in the block
            if y < 16:
                c = shade(c, 0.4 - 0.025 * (y - 4))        # in the shadow of the joists
            if y >= WALL - 5:
                c = shade(c, 0.12 + 0.06 * (y - WALL + 5))  # where the wall meets the slab
            b.px(x, y, c)
    # the sill plate, and the ends of the joists over it
    for x in range(6, 522):
        b.px(x, 4, rgb('#8a6a48')); b.px(x, 5, rgb('#6b4d32')); b.px(x, 6, rgb('#5a3e28')); b.px(x, 7, rgb('#3a281a'))
        b.px(x, 8, shade(b.get(x, 8), 0.3))
    for x in range(14, 522, 32):
        b.rect(x, 4, x + 3, 6, rgb('#7a5a3c')); b.px(x, 4, rgb('#a07a52')); b.rect(x + 3, 4, x + 3, 7, rgb('#3a281a'))
    # pipes along the back wall: a copper water line and a grey duct, on hangers
    for x in range(6, 522):
        b.px(x, 16, rgb('#f2c08a')); b.px(x, 17, rgb('#e09a5a')); b.px(x, 18, rgb('#b8743c')); b.px(x, 19, rgb('#7a4a22'))
        b.px(x, 20, shade(b.get(x, 20), 0.25))
        for y in range(22, 31):
            col = rgb('#dfe3e8') if y == 22 else rgb('#c3c7cc') if y == 23 else rgb('#7f848b') if y == 29 else rgb('#5f646b') if y == 30 else rgb('#a8adb4')
            if y in (25, 26) and (x // 3) % 7 == 0:
                col = tint(col, 0.2)                       # a sheen down the galvanised steel
            if x % 48 == 0:
                col = shade(col, 0.35)                     # a seam in the duct
            elif x % 48 in (1, 47):
                col = tint(col, 0.12) if x % 48 == 1 else shade(col, 0.12)
            b.px(x, y, col)
        b.px(x, 31, shade(b.get(x, 31), 0.3)); b.px(x, 32, shade(b.get(x, 32), 0.15))
    for x in range(30, 522, 64):
        b.rect(x, 8, x, 21, rgb('#3a3a40')); b.px(x, 15, rgb('#6a6a72'))
        b.rect(x - 1, 21, x + 1, 21, rgb('#2a2a30'))
    # the outer walls, as upstairs
    b.rect(0, 0, W - 1, 3, dark)
    b.rect(0, 0, 5, H - 1, dark)
    b.rect(W - 6, 0, W - 1, H - 1, dark)
    b.rect(0, FLOOR_END + 1, W - 1, H - 1, dark)
    for x in range(6, W - 6):
        b.px(x, FLOOR_END + 1, rgb('#2c2a36'))


# ── shared helpers for the fit-outs (mc.grain, mc.weave, mc.drop, mc.pool) ──

def grain(seed=0, along='x', depth=0.16, knots=True):
    """A Mat pattern (Mat(..., pat=grain())) for wood: wavy lines of darker grain running along the boards, the odd
    lighter streak, and now and then a knot. Pass anchor=(x0, y0) to part() for it to show."""
    import math

    def pat(x, y, col, mat):
        r, s = (y, x) if along == 'x' else (x, y)
        w = math.sin(s / 11.0 + r * 1.3 + seed) * 1.2 + math.sin(s / 4.3 + seed * 2) * 0.4
        k = int(r * 1.5 + w + seed) % 4
        if knots and hsh(s // 14, r // 5, seed + 30) % 23 == 0 and (s % 14 - 7) ** 2 + ((r % 5) - 2) ** 2 * 3 < 6:
            return shade(col, depth * 1.6)
        if k == 0:
            return shade(col, depth)
        if k == 2 and hsh(s // 5, r, seed) % 3 == 0:
            return tint(col, depth * 0.5)
        return col
    return pat


def weave(seed=0, depth=0.07):
    """A Mat pattern for upholstery: a fine weave and soft lumps where it has been sat on."""
    def pat(x, y, col, mat):
        c = shade(col, depth) if (x + y) % 2 else col
        lump = mc.noise(x, y, 7, seed)
        return tint(c, 0.06 * lump) if lump > 0 else shade(c, -0.1 * lump)
    return pat


def drop(x0, x1, y, t=0.3, rows=2):
    """A soft shadow on the floor under a piece: `rows` lines of it from y down, fading, and fading at the ends."""
    for r in range(rows):
        for x in range(x0 + r, x1 + 1 - r):
            if 0 <= x < W and 0 <= y + r < H and mc.base.get(x, y + r):
                k = t * (1 - r / rows)
                if x - x0 < 2 or x1 - x < 2:
                    k *= 0.6
                mc.base.px(x, y + r, shade(mc.base.get(x, y + r), k))


def pool(cx, cy, rx, ry, colour, strength):
    """Light falling on the floor (and whatever is drawn on it so far): brightest in the middle, gone at the edge."""
    col = rgb(colour)
    for y in range(int(cy - ry), int(cy + ry) + 1):
        for x in range(int(cx - rx), int(cx + rx) + 1):
            d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2
            if d < 1 and 6 <= x < 522 and 4 <= y <= FLOOR_END:
                cur = mc.base.get(x, y)
                if cur:
                    k = strength * (1 - d) ** 1.5
                    # dithered at the faint edge, so the falloff is soft without banding
                    if k < 0.03 and (x + y) % 2:
                        continue
                    mc.base.px(x, y, mix(cur, col, k))


def cyl(c, x0, y0, x1, y1, mat, edge_lo=True):
    """A standing cylinder (a column, a tank, a bucket) seen from the front: lit a third of the way across from the left,
    falling into shade round to the right, with a glint up the lit side."""
    w = max(1, x1 - x0)
    for x in range(x0, x1 + 1):
        t = (x - x0) / w
        if t < 0.12:
            col = mat.base
        elif t < 0.4:
            col = mat.hi if 0.22 <= t < 0.32 else mix(mat.base, mat.hi, 0.5)
        elif t < 0.75:
            col = mat.base
        else:
            col = mix(mat.base, mat.lo, (t - 0.75) / 0.25 * (1 if edge_lo else 0.6))
        for y in range(y0, y1 + 1):
            c.px(x, y, col)


def shell_stairs():
    """The flight coming down: plain pine treads (the oak is upstairs), the top ones lit from the doorway above, each lower
    one in a little more shadow; a stringer down the wall side, a pine handrail down the open side on 2x2 balusters, and the
    dark stairwell at the top that the light falls through."""
    pine = Mat('#c49a62', hi='#e0bb82', lo='#8a6a3e')
    riser = rgb('#8a6a46')                     # the risers: pine too, but upright, out of the light
    rail = Mat('#a67c48', hi='#cf9f68', lo='#6d4f2c')
    well = rgb('#141018')

    def flight(c):
        for y in range(STOP - 10, STOP):                               # the stairwell: the opening up to the room above
            for x in range(SX0, SX1 + 7):
                t = (y - STOP + 10) / 10
                c.px(x, y, mix(well, rgb('#2a2018'), t))
        for y in range(STOP - 4, STOP):                                # light from the doorway, falling on the top step
            for x in range(SX0 + 3, SX1 - 2):
                c.px(x, y, mix(rgb('#f2c886'), rgb('#ffe6b0'), (y - STOP + 4) / 4))
        for k in range(SN):
            y0 = STOP + k * SSTEP
            glow = max(0.0, 0.28 - 0.07 * k)
            dark = 0.04 * k
            for r in range(SSTEP):
                y = y0 + r
                for x in range(SX0, SX1 + 1):
                    if r < 3:
                        col = pine.lo if (x - SX0) % 10 == 9 else pine.base
                        if r == 0:
                            col = shade(col, 0.12)                                  # under the nosing of the step above
                        elif (x * 3 + k * 7 + r * 5) % 11 == 0 or hsh(x // 4, k * 3 + r, 12) % 7 == 0:
                            col = shade(col, 0.1)                                   # the grain in the pine
                    elif r == 3:
                        col = tint(pine.hi, 0.2) if (x - SX0) % 6 else tint(pine.hi, 0.4)     # the nosing, worn pale here and there
                    else:
                        col = shade(riser, 0.12) if r == 4 else shade(riser, 0.42)  # the riser, darkest at its foot
                        if r == 4 and (x + k) % 9 == 0:
                            col = shade(col, 0.1)
                    if x < SX0 + 3:
                        col = rgb('#4a3420') if x == SX0 else rgb('#7a5a38') if x == SX0 + 1 else shade(col, 0.3)   # the stringer, and the wall's shade
                    elif x > SX1 - 3:
                        col = shade(col, 0.18)
                    c.px(x, y, shade(tint(col, glow), dark))
        for y in range(STOP - 8, SBOT + 1):
            c.px(SX1 + 1, y, rail.lo)
            if (y - STOP) % 6 == 0:
                c.rect(SX1 + 1, y, SX1 + 2, y + 3, rail.base)                       # the balusters
            c.px(SX1 + 3, y, rail.hi); c.px(SX1 + 4, y, rail.base); c.px(SX1 + 5, y, rail.lo)
        c.part(mc.rows(SX1 + 1, SBOT - 3, SX1 + 6, SBOT + 2), rail, hi='tl', lo='rb')      # the post at the foot
        c.part(mc.rows(SX1 + 1, STOP - 12, SX1 + 6, STOP - 7), rail, hi='tl', lo='rb')      # and at the top
    mc.put(mc.base, flight)
    drop(SX0, SX1 + 6, SBOT + 2, 0.35, 3)                             # the flight's shadow on the floor at its foot
    for y in range(STOP - 6, SBOT + 4):                                # the rail's shadow on the floor beside it
        for x in range(SX1 + 7, SX1 + 10):
            if 0 <= x < W:
                mc.base.px(x, y, shade(mc.base.get(x, y), 0.25 - 0.07 * (x - SX1 - 7)))
    mc.block(SX0 - 1, STOP - 6, SX1 + 6, SBOT)


# Lettering for signs, five dots by seven: what the rooms write on their walls (mc.sign, for the fit-outs).
SIGN_FONT = {
    'A': '01110 10001 10001 11111 10001 10001 10001', 'B': '11110 10001 10001 11110 10001 10001 11110',
    'C': '01110 10001 10000 10000 10000 10001 01110', 'D': '11110 10001 10001 10001 10001 10001 11110',
    'E': '11111 10000 10000 11110 10000 10000 11111', 'F': '11111 10000 10000 11110 10000 10000 10000',
    'G': '01110 10001 10000 10111 10001 10001 01111', 'H': '10001 10001 10001 11111 10001 10001 10001',
    'I': '01110 00100 00100 00100 00100 00100 01110', 'K': '10001 10010 10100 11000 10100 10010 10001',
    'L': '10000 10000 10000 10000 10000 10000 11111', 'M': '10001 11011 10101 10101 10001 10001 10001',
    'N': '10001 11001 10101 10011 10001 10001 10001', 'O': '01110 10001 10001 10001 10001 10001 01110',
    'P': '11110 10001 10001 11110 10000 10000 10000', 'R': '11110 10001 10001 11110 10100 10010 10001',
    'S': '01111 10000 10000 01110 00001 00001 11110', 'T': '11111 00100 00100 00100 00100 00100 00100',
    'U': '10001 10001 10001 10001 10001 10001 01110', 'W': '10001 10001 10001 10101 10101 11011 10001',
    'Y': '10001 10001 01010 00100 00100 00100 00100', '8': '01110 10001 10001 01110 10001 10001 01110',
    '1': '00100 01100 00100 00100 00100 00100 01110', '2': '01110 10001 00001 00110 01000 10000 11111',
    '3': '11110 00001 00001 01110 00001 00001 11110', '4': '10010 10010 10010 11111 00010 00010 00010',
    '5': '11111 10000 11110 00001 00001 10001 01110', '6': '01110 10000 10000 11110 10001 10001 01110',
    "'": '00100 00100 01000 00000 00000 00000 00000', '-': '00000 00000 00000 11111 00000 00000 00000',
    ' ': '000 000 000 000 000 000 000',
}


def sign_width(text, k=1):
    return sum((len(SIGN_FONT[ch].split()[0]) + 1) * k for ch in text) - k


def sign(c, x, y, text, k, col, core=None, edge=None):
    """Writes `text` at (x, y), each dot of the font k by k: in `col`, with a paler `core` along the top of each stroke
    (a neon tube, or paint catching the light) and a dark `edge` round it if asked."""
    for pass_ in ('edge', 'fill'):
        cx = x
        for ch in text:
            rows = SIGN_FONT[ch].split()
            for r, line in enumerate(rows):
                for i, bit in enumerate(line):
                    if bit != '1':
                        continue
                    px, py = cx + i * k, y + r * k
                    if pass_ == 'edge' and edge is not None:
                        c.rect(px - 1, py - 1, px + k, py + k, edge)
                    elif pass_ == 'fill':
                        c.rect(px, py, px + k - 1, py + k - 1, col)
                        if core is not None and k > 1:
                            c.rect(px, py, px + k - 2, py, core)
            cx += (len(rows[0]) + 1) * k


def vignette(strength=0.22):
    """The room's edges and corners a little darker than its middle, so the eye sits in the room."""
    ys, xs = np.mgrid[0:H, 0:W]
    dx = np.minimum(xs - 6, 521 - xs) / 90.0
    dy = np.minimum(ys - 4, FLOOR_END - ys) / 70.0
    d = np.clip(np.minimum(dx, dy), 0, 1)
    k = (1 - d) ** 2 * strength
    a = mc.base.a.astype(np.float32)
    a[..., :3] *= (1 - k[..., None])
    mc.base.a[...] = a.astype(np.uint8)


# ── seats, built the way the room upstairs builds them, so whoever sits in one sits in it ──
# (the fit-outs reach these as mc.sofa, mc.side_chair and mc.back_bench)

def sofa(L, x0, y, n, mat, cushion=None, nails=None):
    """A sofa facing us, for n: 31 dots tall (its back 14, the seat cushions under that, a skirt), 24 a seat between rolled
    arms 8 wide. Whoever sits on it has their feet 29 below its top: seat on the front of the cushion, back against the
    back, shins down over the skirt. Returns its width. Shaded as the sofa upstairs is: buttoned back cushions, plump seat
    cushions piped along the front, the arms' rolls catching the light, a weave in the cloth, its feet and its shadow."""
    cushion = cushion or Mat(tint(mat.base, 0.12), hi=tint(mat.base, 0.3), lo=mat.base)
    w = 16 + 24 * n
    plump = tint(mat.hi, 0.25)
    deep = shade(mat.lo, 0.35)
    wv = weave(7, 0.04)

    def f(c):
        c.part([(y, x0 + 8, x0 + w - 9), (y + 1, x0 + 6, x0 + w - 7)] + mc.rows(x0 + 5, y + 2, x0 + w - 6, y + 13), Mat(mat.base, hi=mat.hi, lo=mat.lo, pat=wv), hi='t', lo='', anchor=(0, 0))
        for k in range(n):
            cx = x0 + 8 + 24 * k
            c.part([(y + 2, cx + 3, cx + 20), (y + 3, cx + 2, cx + 21)] + mc.rows(cx + 1, y + 4, cx + 22, y + 13), Mat(cushion.base, hi=cushion.hi, lo=cushion.lo, pat=wv), hi='t', lo='rb', anchor=(0, 0))
            c.rect(cx + 4, y + 4, cx + 9, y + 4, tint(cushion.hi, 0.2))                # the light along its top
            c.rect(cx + 11, y + 8, cx + 12, y + 8, cushion.lo)                         # buttoned in the middle
            for dx in (-3, 3):
                c.px(cx + 11 + dx + (dx > 0), y + 7, cushion.lo); c.px(cx + 11 + dx + (dx > 0), y + 9, cushion.lo)
            c.part(mc.rows(cx, y + 14, cx + 23, y + 24), Mat(mat.base, hi=mat.hi, lo=mat.lo, pat=wv), hi='t', lo='rb', anchor=(0, 0))
            c.rect(cx + 2, y + 15, cx + 12, y + 15, plump)                             # the sheen on the seat cushion
            c.rect(cx + 2, y + 22, cx + 21, y + 22, mat.hi)                            # the piping along its front
            c.rect(cx + 2, y + 23, cx + 21, y + 23, mat.lo)
            if k:
                c.rect(cx, y + 15, cx, y + 23, shade(mat.base, 0.25))                  # the crease between cushions
        c.part(mc.rows(x0 + 8, y + 25, x0 + w - 9, y + 30), Mat(mat.lo, hi=mat.base, lo=deep), hi='t', lo='b')
        for x in range(x0 + 10, x0 + w - 9, 4):                                       # pleats in the skirt
            c.rect(x, y + 27, x, y + 29, shade(mat.lo, 0.18))
        if nails:
            for x in range(x0 + 9, x0 + w - 9, 2):
                c.px(x, y + 25, rgb(nails))
        for ax in (x0, x0 + w - 8):
            c.part([(y + 6, ax + 2, ax + 5), (y + 7, ax + 1, ax + 6)] + mc.rows(ax, y + 8, ax + 7, y + 30), mat, hi='tl', lo='rb')
            c.rect(ax + 2, y + 8, ax + 5, y + 9, plump)                                # the roll of the arm, lit
            c.rect(ax + 1, y + 13, ax + 6, y + 13, mat.lo)
            c.rect(ax + 1, y + 14, ax + 6, y + 14, tint(mat.base, 0.08))
            ex = ax + 6 if ax == x0 else ax + 1                                        # the arm's inner edge, in shade
            c.rect(ex, y + 15, ex, y + 29, shade(mat.base, 0.15))
        for fx in (x0 + 2, x0 + w - 5):
            c.rect(fx, y + 31, fx + 2, y + 32, rgb('#2a1a10')); c.px(fx, y + 31, rgb('#5a3a22'))
    drop(x0 + 1, x0 + w - 2, y + 32, 0.32, 3)
    mc.put(mc.base, f, shadow=True)
    mc.block(x0, y, x0 + w - 1, y + 31)
    for k in range(n):
        sx = x0 + 20 + 24 * k
        L['seats'].append(dict(x=sx, y=y + 29, ax=sx, ay=y + 46, pose='front', flip=False, hit=[x0 + (8 + 24 * k if k else 0), y, 24 + (8 if k in (0, n - 1) else 0), 32]))
    return w


def side_chair(L, ax, y, faces_right, mat, frame=None, nails='#e2c36a'):
    """An armchair seen from the side, 24 wide and 30 tall, in two layers with its sitter between them: the back and the
    seat behind, the near arm and side in front. Their back against the chair's, their knees at the front of the seat, their
    shins and feet down on the floor in front of it. Buttoned up the back, the seat's cushion bulging and lit, a fat
    rolled arm with a scroll at its front, nails along the foot of the side, turned legs."""
    frame = frame or Mat('#3a2214', hi='#5a3620', lo='#24140a')
    bx = ax if faces_right else ax + 17                     # the back, on the side away from where it faces
    sx0, sx1 = (ax + 7, ax + 16) if faces_right else (ax + 7, ax + 16)
    sheen = tint(mat.hi, 0.3)
    deep = shade(mat.lo, 0.4)
    wv = weave(11, 0.05)

    def behind(c):
        c.part([(y - 2, bx + 1, bx + 4), (y - 1, bx, bx + 5)] + mc.rows(bx, y, bx + 6, y + 24), Mat(mat.base, hi=mat.hi, lo=mat.lo, pat=wv), hi='tl', lo='rb', anchor=(0, 0))
        for by in (y + 3, y + 8, y + 13):                   # buttoned
            c.rect(bx + 2, by, bx + 3, by, mat.lo); c.px(bx + 2, by - 1, mat.hi)
        c.part([(y + 15, sx0, sx1 - 1)] + mc.rows(sx0, y + 16, sx1, y + 19), Mat(mat.hi, hi=sheen, lo=mat.base), hi='t', lo='rb')
        c.rect(sx0 + 1, y + 16, sx0 + 4, y + 16, tint(sheen, 0.3))
        c.part(mc.rows(sx0, y + 20, sx1 - 1, y + 24), Mat(mat.lo, lo=deep), hi='', lo='b')
        for lx in (ax + 2, ax + 20):
            c.rect(lx, y + 25, lx + 1, y + 28, frame.lo)
    drop(ax + 1, ax + 22, y + 29, 0.3, 2)
    mc.put(mc.base, behind, shadow=True)

    def near(c):
        c.part([(y + 8, ax + 4, ax + 19), (y + 9, ax + 3, ax + 20)] + mc.rows(ax + 2, y + 10, ax + 21, y + 13) + [(y + 14, ax + 3, ax + 20)], mat, hi='t', lo='b')
        c.rect(ax + 4, y + 9, ax + 19, y + 9, sheen)
        c.rect(ax + 5, y + 10, ax + 12, y + 10, tint(mat.base, 0.12))
        fx = ax + 18 if faces_right else ax + 4                                       # the scroll at the front of the arm
        c.rect(fx, y + 11, fx + 1, y + 12, mat.lo); c.px(fx, y + 11, mat.hi)
        c.part(mc.rows(ax + 2, y + 15, ax + 21, y + 24), Mat(mat.lo, hi=mat.base, lo=deep, pat=wv), hi='t', lo='rb', anchor=(0, 0))
        if nails:
            for x in range(ax + 3, ax + 21, 2):                                       # nails along the foot of the side
                c.px(x, y + 23, rgb(nails))
        for lx in (ax + 3, ax + 19):
            c.rect(lx, y + 25, lx + 1, y + 28, frame.base); c.px(lx, y + 25, frame.hi); c.rect(lx + 1, y + 26, lx + 1, y + 28, frame.lo)
    mc.put_over(near, y + 31)
    mc.block(ax, y + 4, ax + 23, y + 28)
    x = ax + (8 if faces_right else 15)
    L['seats'].append(dict(x=x, y=y + 29, ax=ax + 12 + (24 if faces_right else -24), ay=y + 30, pose='side', flip=faces_right, hit=[ax, y, 24, 30]))


def back_bench(L, x0, y, n, mat, gap=24):
    """A bench or a couch seen from behind, its sitters facing up the room, away from us: the seat (behind them), then its
    back in front of them, as the cinema's seats upstairs. Their feet are at the back's foot. A cushion for each on the
    seat, lit along its top; the back tufted, stitched along a seam, on short legs."""
    w = gap * n + 6
    wv = weave(5, 0.06)

    def seat(c):
        c.part(mc.rows(x0, y - 10, x0 + w - 1, y - 2), Mat(mat.hi, hi=tint(mat.hi, 0.2), lo=mat.base, pat=wv), hi='t', lo='b', anchor=(0, 0))
        for k in range(1, n):
            c.rect(x0 + 3 + gap * k, y - 9, x0 + 3 + gap * k, y - 3, mat.base)       # where one cushion meets the next
        c.rect(x0 + 2, y - 9, x0 + w - 3, y - 9, tint(mat.hi, 0.35))
    mc.put(mc.base, seat, shadow=True)

    def back(c):
        c.part(mc.rows(x0, y - 2, x0 + w - 1, y + 10), Mat(mat.base, hi=mat.hi, lo=mat.lo, pat=wv), hi='t', lo='b', anchor=(0, 0))
        c.rect(x0 + 1, y - 1, x0 + w - 2, y - 1, tint(mat.hi, 0.2))
        c.rect(x0 + 1, y + 3, x0 + w - 2, y + 3, mat.lo)
        c.rect(x0 + 1, y + 4, x0 + w - 2, y + 4, tint(mat.base, 0.1))
        for x in range(x0 + 4, x0 + w - 3, 6):                                        # tufted, in two rows
            c.px(x, y + 1, mat.lo); c.px(x, y, mat.hi); c.px(x + 3, y + 7, mat.lo); c.px(x + 3, y + 6, mat.hi)
        c.rect(x0 + 1, y + 9, x0 + w - 2, y + 9, shade(mat.lo, 0.15))
        for lx in (x0 + 2, x0 + w - 4):
            c.rect(lx, y + 11, lx + 1, y + 14, rgb('#1a1008')); c.px(lx, y + 11, rgb('#4a3020'))
    mc.put_over(back, y + 14)
    drop(x0 + 1, x0 + w - 2, y + 15, 0.3, 2)
    mc.block(x0, y - 10, x0 + w - 1, y + 14)
    for k in range(n):
        sx = x0 + 3 + gap // 2 + gap * k
        L['seats'].append(dict(x=sx, y=y + 2, ax=sx, ay=y - 20, pose='back', flip=False, hit=[sx - gap // 2, y - 30, gap, 44]))
    return w


def open_grid(x0, y0, x1, y1):
    """The walking grid for a fit-out with no shell: ground from (x0, y0) to (x1, y1), less what stands on it (padded by
    half a body, as upstairs)."""
    import math
    out = []
    for r in range(math.ceil(H / CELL)):
        line = ''
        for c in range(W // CELL):
            x, y = c * CELL + CELL // 2, r * CELL + CELL // 2
            ok = x0 <= x <= x1 and y0 <= y <= y1 and not any(bx0 - 9 <= x <= bx1 + 9 and by0 - 1 <= y <= by1 + 4 for bx0, by0, bx1, by1 in mc.blocked)
            line += '.' if ok else '#'
        out.append(line)
    return out


def check_reach(L):
    """Every seat and place to stand must be reachable on foot from the foot of the stairs."""
    g = L['grid']
    cols, nrows = len(g[0]), len(g)

    def nearest(p):
        c0, r0 = int(p['x']) // CELL, int(p['y']) // CELL
        for d in range(20):
            for r in range(r0 - d, r0 + d + 1):
                for c in range(c0 - d, c0 + d + 1):
                    if max(abs(r - r0), abs(c - c0)) == d and 0 <= r < nrows and 0 <= c < cols and g[r][c] == '.':
                        return c, r
        raise SystemExit('%s: nowhere to stand near %r' % (L['id'], p))
    seen = {nearest(L['stairs']['foot'])}
    todo = list(seen)
    while todo:
        c, r = todo.pop()
        for dc, dr in ((0, 1), (1, 0), (0, -1), (-1, 0)):
            n = (c + dc, r + dr)
            if 0 <= n[1] < nrows and 0 <= n[0] < cols and g[n[1]][n[0]] == '.' and n not in seen:
                seen.add(n); todo.append(n)
    spots = [('seat%d' % k, dict(x=s['ax'], y=s['ay'])) for k, s in enumerate(L['seats'])] + [('stand%d' % k, s) for k, s in enumerate(L['stands'])]
    cut = [name for name, s in spots if nearest(s) not in seen]
    if cut:
        raise SystemExit('%s: cannot be walked to from the stairs: %s' % (L['id'], ', '.join(cut)))


def seasonal(L, summer):
    """An outdoor fit-out drawn for another season (mod.SEASONS, see scripts/basement/_seasons.py) must be the summer one
    in everything but its colours: the same seats, ground, lights, and the pieces in front of people in the same places
    and sizes (each is cut to its summer box, so the page's layout fits every season's over.png)."""
    if len(mc.occluders) != len(summer['over']):
        raise SystemExit('%s: %d pieces in %s, %d in summer' % (L['id'], len(mc.occluders), mc.SEASON, len(summer['over'])))
    fixed = []
    for (crop, e), s in zip(mc.occluders, summer['over']):
        if e['z'] != s['z']:
            raise SystemExit('%s: a piece sorts at %s in %s, %s in summer' % (L['id'], e['z'], mc.SEASON, s['z']))
        out = np.zeros((s['h'], s['w'], 4), np.uint8)
        dx, dy = e['x'] - s['x'], e['y'] - s['y']
        x0, y0, x1, y1 = max(0, dx), max(0, dy), min(s['w'], dx + e['w']), min(s['h'], dy + e['h'])
        if x0 < x1 and y0 < y1:
            out[y0:y1, x0:x1] = crop[y0 - dy:y1 - dy, x0 - dx:x1 - dx]
        fixed.append((out, dict(x=s['x'], y=s['y'], w=s['w'], h=s['h'], z=s['z'])))
    mc.occluders[:] = fixed


def build(fid, mod, season=None, summer=None):
    """Draws one fit-out (for an outdoor one, in one season: base-<season>.png and over-<season>.png; the layout is
    written for summer only, and each other season's is checked against it)."""
    mc.SEASON = season or 'summer'
    sfx = '-' + season if season else ''
    mc.base = mc.Cv(W, H)
    mc.occluders.clear()
    mc.blocked.clear()
    mc.LIGHTS.clear()
    L = dict(id=fid, title=mod.TITLE, blurb=getattr(mod, 'BLURB', ''), order=getattr(mod, 'ORDER', 50), w=W, h=H, cell=CELL,
             seats=[], stands=[], things={})
    mc.L = L
    shell = getattr(mod, 'SHELL', True)          # False: not a basement at all (the outside): it draws its own ground, edges and way back
    if shell:
        shell_floor()
        shell_walls()
        shell_stairs()
    mc.sign, mc.sign_width = sign, sign_width
    mc.sofa, mc.side_chair, mc.back_bench = (lambda *a, **k: sofa(L, *a, **k)), (lambda *a, **k: side_chair(L, *a, **k)), (lambda *a, **k: back_bench(L, *a, **k))
    mc.grain, mc.weave, mc.drop, mc.pool, mc.cyl = grain, weave, drop, pool, cyl
    mod.draw(mc, L)
    vignette(getattr(mod, 'VIGNETTE', 0.22))
    if shell:
        L['stairs'] = dict(rect=[SX0, STOP - 6, SX1 - SX0 + 7, SBOT - STOP + 7], foot=FOOT)
        L['grid'] = mc.grid()
    else:                                        # its way back is mod.EXIT (the same shape as the stairs), its ground mod.GROUND
        L['stairs'] = dict(mod.EXIT)
        L['grid'] = open_grid(*mod.GROUND)
    check_reach(L)
    L['lights'] = list(mc.LIGHTS)
    L['blocks'] = [list(b) for b in mc.blocked]
    L['floor'] = [10, WALL + 4, 517, FLOOR_END - 1] if shell else list(mod.GROUND)
    if summer:
        seasonal(L, summer)
    sheet = mc.pack() if mc.occluders else np.zeros((1, 1, 4), np.uint8)
    L['atlas'] = [int(sheet.shape[1]), int(sheet.shape[0])]
    L['over'] = [e for _, e in mc.occluders]
    if getattr(mod, 'SEASONS', ()):
        L['seasons'] = list(mod.SEASONS)
    if summer:
        for key in set(L) | set(summer):
            if json.dumps(L.get(key)) != json.dumps(summer.get(key)):
                raise SystemExit('%s: %s differs in %s from summer' % (fid, key, season))

    pub = os.path.join(ROOT, 'client', 'public', 'basement', fid)
    os.makedirs(pub, exist_ok=True)
    mc.big(mc.base.a).save(os.path.join(pub, 'base%s.png' % sfx))
    mc.big(sheet).save(os.path.join(pub, 'over%s.png' % sfx))
    for extra, art in getattr(mod, 'EXTRA', {}).items():        # any further pictures the fit-out's game needs
        if not summer or extra in getattr(mod, 'SEASONAL_EXTRA', ()):    # (in another season: only those that change with it)
            mc.big(art).save(os.path.join(pub, extra + sfx + '.png'))

    preview = mc.base.a.copy()
    for crop, e in mc.occluders:
        m = crop[..., 3] > 0
        preview[e['y']:e['y'] + e['h'], e['x']:e['x'] + e['w']][m] = crop[m]
    Image.fromarray(preview, 'RGBA').resize((W * 2, H * 2), Image.NEAREST).save(os.path.join(ROOT, 'art', 'basement-%s%s.png' % (fid, sfx)))
    mc.SEASON = 'summer'
    if summer:
        print('basement %s (%s) written' % (fid, season))
        return L

    gen = os.path.join(ROOT, 'client', 'src', 'basement')
    os.makedirs(gen, exist_ok=True)
    with open(os.path.join(gen, fid + '.gen.ts'), 'w', newline='\n') as f:
        f.write('// Written by scripts/make-basement.py from scripts/basement/%s.py: do not edit.\n' % fid)
        f.write('export const LAYOUT = %s;\n' % json.dumps(L))
    print('basement %s written: %d pieces, %d seats, %d places to stand' % (fid, len(L['over']), len(L['seats']), len(L['stands'])))
    return L


def main():
    folder = os.path.join(HERE, 'basement')
    want = sys.argv[1:]
    for name in sorted(os.listdir(folder)):
        if not name.endswith('.py') or name.startswith('_'):
            continue
        fid = name[:-3]
        if want and fid not in want:
            continue
        s = importlib.util.spec_from_file_location('fit_' + fid, os.path.join(folder, name))
        mod = importlib.util.module_from_spec(s)
        s.loader.exec_module(mod)
        summer = build(fid, mod)
        for season in getattr(mod, 'SEASONS', ()):             # an outdoor scene: the same again in each other season
            build(fid, mod, season, summer)


if __name__ == '__main__':
    main()
