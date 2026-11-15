#!/usr/bin/env python3
"""The pixel kit the room is drawn with: a canvas of dots, and materials with a lit and a shaded tone.
(The characters, pets and desks are drawn by the app itself, from what each person picks: see client/src/draw.)"""
import numpy as np

FW = FH = 48

LIGHT = (255, 240, 205)
SHADE = (46, 28, 78)
INK = (26, 18, 40)
EYE = (38, 28, 46)
WHITE = (255, 255, 255)


def rgb(h):
    if not isinstance(h, str):
        return tuple(h)
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def mix(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


class Mat:
    """A material: base colour with a lit and a shaded tone."""

    def __init__(self, base, hi=None, lo=None, pat=None):
        self.base = rgb(base) if isinstance(base, str) else base
        self.hi = rgb(hi) if hi else mix(self.base, LIGHT, 0.30)
        self.lo = rgb(lo) if lo else mix(self.base, SHADE, 0.30)
        self.pat = pat


class Cv:
    def __init__(self, w=FW, h=FH):
        self.w, self.h = w, h
        self.a = np.zeros((h, w, 4), np.uint8)

    def px(self, x, y, c):
        if 0 <= x < self.w and 0 <= y < self.h:
            self.a[y, x] = (c[0], c[1], c[2], 255)

    def get(self, x, y):
        if 0 <= x < self.w and 0 <= y < self.h and self.a[y, x, 3]:
            return tuple(int(v) for v in self.a[y, x, :3])
        return None

    def tint(self, x, y, c, t):
        cur = self.get(x, y)
        if cur:
            self.px(x, y, mix(cur, c, t))

    def rect(self, x0, y0, x1, y1, c):
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                self.px(x, y, c)

    def part(self, spans, mat, hi='t', lo='rb', anchor=None):
        """Fill rows of pixels with a material and shade the edges: light from the top left."""
        pts = set()
        for y, x0, x1 in spans:
            for x in range(x0, x1 + 1):
                pts.add((x, y))
        for (x, y) in pts:
            col = mat.base
            edge = True
            if ('r' in lo and (x + 1, y) not in pts) or ('b' in lo and (x, y + 1) not in pts):
                col = mat.lo
            elif ('t' in hi and (x, y - 1) not in pts) or ('l' in hi and (x - 1, y) not in pts):
                col = mat.hi
            else:
                edge = False
            if mat.pat and anchor and not edge:
                col = mat.pat(x - anchor[0], y - anchor[1], col, mat)
            self.px(x, y, col)
        return pts

    def ascii(self, rows, tones, ox=0, oy=0):
        """Hand-placed pixels: one character per pixel, looked up in tones."""
        for y, row in enumerate(rows):
            for x, ch in enumerate(row):
                if ch in tones:
                    self.px(x + ox, y + oy, tones[ch])

    def paste(self, other, ox, oy):
        src = other.a
        for y in range(other.h):
            for x in range(other.w):
                if src[y, x, 3]:
                    self.px(x + ox, y + oy, src[y, x, :3])

    def flipped(self):
        c = Cv(self.w, self.h)
        c.a = self.a[:, ::-1].copy()
        return c

    def rotated_left(self):
        c = Cv(self.h, self.w)
        c.a = np.rot90(self.a, 1).copy()
        return c
