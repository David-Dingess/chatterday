#!/usr/bin/env python3
"""Draws the screens the room shows for a game somebody is sharing: one picture per kind of game, in the room's dots.

    python scripts/make-game-screens.py

Writes into client/public/clubhouse/games/, for each kind in KINDS:
  <kind>.png          136x77, the projector upstairs
  <kind>-31x18.png    the TVs over the bar in the game room
and art/game-screens-preview.png, all of them enlarged, to look at before shipping a change.

Every picture is drawn here from scratch (no screenshots, no real game's art or names): a genre, not a game.
client/src/games.ts picks the kind from the game's name, and anything it does not recognise gets 'arcade'.
"""
import math
import os
import random

from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
OUT = os.path.join(ROOT, 'client', 'public', 'clubhouse', 'games')
SIZES = [(136, 77), (31, 18)]          # the projector (clubhouse.gen.ts "screen"), the bar TVs (gameroom.gen.ts "tvs")
KINDS = ['arcade', 'shooter', 'racing', 'cards', 'rpg', 'sports', 'blocks']


def rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def mix(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


class Pic:
    def __init__(self, w, h, bg='#000000'):
        self.w, self.h = w, h
        self.im = Image.new('RGB', (w, h), rgb(bg))
        self.px = self.im.load()

    def dot(self, x, y, c):
        x, y = int(round(x)), int(round(y))
        if 0 <= x < self.w and 0 <= y < self.h:
            self.px[x, y] = rgb(c) if isinstance(c, str) else c

    def rect(self, x0, y0, x1, y1, c):
        """Filled, both corners included, in dots (fractions of the picture are rounded)."""
        for y in range(int(round(y0)), int(round(y1)) + 1):
            for x in range(int(round(x0)), int(round(x1)) + 1):
                self.dot(x, y, c)

    def vgrad(self, y0, y1, top, bottom):
        top, bottom = rgb(top), rgb(bottom)
        for y in range(int(y0), int(y1) + 1):
            t = (y - y0) / max(1, y1 - y0)
            for x in range(self.w):
                self.dot(x, y, mix(top, bottom, t))

    def disc(self, cx, cy, r, c):
        for y in range(int(cy - r) - 1, int(cy + r) + 2):
            for x in range(int(cx - r) - 1, int(cx + r) + 2):
                if (x - cx) ** 2 + (y - cy) ** 2 <= r * r:
                    self.dot(x, y, c)


# A 3x5 font for the few words on the big screen.
FONT = {k: ''.join(v.split()) for k, v in {
    'A': '.#. #.# ### #.# #.#', 'E': '### #.. ##. #.. ###', 'G': '.## #.. #.# #.# .##', 'M': '#.# ### ### #.# #.#',
    'N': '##. #.# #.# #.# #.#', 'O': '.#. #.# #.# #.# .#.', 'P': '##. #.# ##. #.. #..', 'U': '#.# #.# #.# #.# ###',
    'L': '#.. #.. #.. #.. ###', '1': '.#. ##. .#. .#. ###', '0': '.#. #.# #.# #.# .#.', ' ': '... ... ... ... ...',
}.items()}


def text(p, x, y, s, c):
    for ch in s:
        g = FONT.get(ch, FONT[' '])
        for i, b in enumerate(g):
            if b == '#':
                p.dot(x + i % 3, y + i // 3, c)
        x += 4


def bar(p, x, y, w, frac, full, empty='#2a2a34'):
    p.rect(x, y, x + w - 1, y, empty)
    p.rect(x, y, x + max(0, round(w * frac) - 1), y, full)


# ───────── the kinds ─────────
def arcade(w, h):
    """Stars, a little ship, invaders in rows, a score: any game at all."""
    p = Pic(w, h, '#0a0820')
    rnd = random.Random(7)
    for _ in range(w * h // 40):
        p.dot(rnd.randrange(w), rnd.randrange(h), rnd.choice(['#4a4a78', '#8080b0', '#d8d8ff']))
    s = max(1, w // 60)
    cols, rows = (7, 3) if w > 60 else (4, 2)
    for r in range(rows):
        for k in range(cols):
            x = w * 0.18 + k * (w * 0.64) / (cols - 1)
            y = h * 0.16 + r * h * 0.13
            c = ['#ff5a8a', '#ffd23f', '#5ae0ff'][r % 3]
            p.rect(x - s, y, x + s, y + s, c)
            p.dot(x - s - 1, y + s, c); p.dot(x + s + 1, y + s, c)
    sx, sy = w * 0.5, h * 0.84
    p.rect(sx - 2 * s, sy, sx + 2 * s, sy + s, '#7dff7a')
    p.rect(sx - s // 2, sy - s, sx + s // 2, sy, '#7dff7a')
    p.rect(sx, h * 0.55, sx, h * 0.55 + s * 2, '#ffffff')
    if w > 60:
        text(p, 3, 2, '1UP', '#ff5a8a')
        text(p, w - 4 * 4 - 2, 2, '0100', '#ffffff')
        text(p, w // 2 - 14, h // 2 - 2, 'GAME ON', '#ffd23f')
    return p


def shooter(w, h):
    """A corridor seen down the barrel: walls, a doorway, a crosshair, the gun at the bottom, health and ammo."""
    p = Pic(w, h, '#1c2026')
    vx, vy = w * 0.5, h * 0.45
    p.vgrad(0, int(vy), '#3a4250', '#566272')
    p.vgrad(int(vy), h - 1, '#4a4238', '#2a2620')
    for y in range(h):                                     # the walls narrowing to the doorway
        t = abs(y - vy) / max(1, h - vy)
        edge = w * 0.12 + (w * 0.5 - w * 0.12) * (1 - min(1, t)) * 0.55
        for x in range(int(edge)):
            p.dot(x, y, mix(rgb('#2c3440'), rgb('#4c5868'), x / max(1, edge)))
            p.dot(w - 1 - x, y, mix(rgb('#2c3440'), rgb('#4c5868'), x / max(1, edge)))
    p.rect(vx - w * 0.08, vy - h * 0.18, vx + w * 0.08, vy + h * 0.1, '#0e1016')        # the doorway
    p.rect(vx - w * 0.08, vy - h * 0.18, vx + w * 0.08, vy - h * 0.18, '#ffb347')
    c = '#7dff7a'
    a = max(2, w // 34)
    p.rect(vx - a * 2, vy, vx - a, vy, c); p.rect(vx + a, vy, vx + a * 2, vy, c)
    p.rect(vx, vy - a * 2, vx, vy - a, c); p.rect(vx, vy + a, vx, vy + a * 2, c)
    gx = w * 0.66
    p.rect(gx, h * 0.72, gx + w * 0.14, h - 1, '#2a2c30')                            # the gun, from the right
    p.rect(gx + w * 0.02, h * 0.68, gx + w * 0.1, h * 0.74, '#45484e')
    p.rect(gx + w * 0.05, h * 0.86, gx + w * 0.14, h - 1, '#c08a5a')
    if w > 60:
        bar(p, 3, h - 4, 30, 0.7, '#ff4a4a'); bar(p, 3, h - 6, 30, 0.45, '#4ab0ff')
    return p


def racing(w, h):
    """A road running away to the hills, its stripes, a car from behind, a lap bar."""
    p = Pic(w, h)
    hz = int(h * 0.42)
    p.vgrad(0, hz, '#4a8ae0', '#bfe0ff')
    for x in range(w):                                     # the hills
        y = hz - (math.sin(x / w * 6.3) * 0.5 + 0.5) * h * 0.1
        p.rect(x, y, x, hz, '#5a8a5a')
    for y in range(hz, h):
        t = (y - hz) / max(1, h - hz)
        half = w * (0.04 + 0.46 * t)
        cx = w * 0.5 + (1 - t) ** 2 * w * 0.08
        for x in range(w):
            if abs(x - cx) <= half:
                stripe = (abs(x - cx) > half * 0.92)
                c = ('#e8e8e8' if int(t * 14) % 2 else '#e03030') if stripe else '#5a5a62'
                if abs(x - cx) < max(1, half * 0.03) and int(t * 10) % 2 == 0:
                    c = '#f0f0f0'
            else:
                c = '#4a9a3a' if int(t * 12) % 2 else '#3e8a32'
            p.dot(x, y, c)
    cw, ch = w * 0.16, h * 0.14
    cx, cy = w * 0.5, h * 0.8
    p.rect(cx - cw / 2, cy - ch / 2, cx + cw / 2, cy + ch / 2, '#e8402a')
    p.rect(cx - cw / 3, cy - ch / 2 - ch * 0.4, cx + cw / 3, cy - ch / 2, '#a02a1c')
    p.rect(cx - cw / 2, cy + ch / 2, cx - cw / 3, cy + ch / 2 + ch * 0.3, '#141414')
    p.rect(cx + cw / 3, cy + ch / 2, cx + cw / 2, cy + ch / 2 + ch * 0.3, '#141414')
    if w > 60:
        text(p, 3, 2, 'L1', '#ffffff')
        bar(p, w - 34, 3, 30, 0.6, '#ffd23f')
    return p


def cards(w, h):
    """A card game on green felt: a hand fanned out at the bottom, cards in play, a deck."""
    p = Pic(w, h, '#1e6a3a')
    for y in range(h):
        for x in range(w):
            if (x + y) % 7 == 0:
                p.dot(x, y, '#226e3e')
    cw, ch = max(3, w // 13), max(4, round(w / 13 * 1.4))
    suits = ['#d02a2a', '#1a1a1a', '#d02a2a', '#1a1a1a', '#1a1a1a']
    n = 5 if w > 60 else 3
    for k in range(n):
        x = w * 0.5 + (k - (n - 1) / 2) * cw * 1.1 - cw / 2
        y = h - ch - 1 + abs(k - (n - 1) / 2) * max(1, h // 40)
        p.rect(x - 1, y - 1, x + cw, y + ch, '#0e3a1e')
        p.rect(x, y, x + cw - 1, y + ch - 1, '#f4f0e6')
        p.rect(x + cw / 2 - 1, y + ch / 2 - 1, x + cw / 2, y + ch / 2, suits[k])
    for k in range(min(3, n)):                             # in play, in the middle
        x = w * 0.36 + k * cw * 1.3
        y = h * 0.28
        p.rect(x, y, x + cw - 1, y + ch - 1, '#f4f0e6')
        p.rect(x + cw / 2 - 1, y + ch / 2 - 1, x + cw / 2, y + ch / 2, suits[k + 1])
    dx, dy = w * 0.1, h * 0.22                             # the deck, face down
    for k in range(3):
        p.rect(dx + k, dy - k, dx + cw - 1 + k, dy + ch - 1 - k, '#3a4ab0' if k < 2 else '#5a6ad0')
    if w > 60:
        text(p, w - 22, 3, '010', '#ffd23f')
    return p


def rpg(w, h):
    """A fantasy field: mountains, a castle, a hero with a sword, a slime, health and mana bars."""
    p = Pic(w, h)
    hz = int(h * 0.55)
    p.vgrad(0, hz, '#6a5ad0', '#f0a070')
    for x in range(w):
        y = hz - abs(((x * 3) % (w // 2 or 1)) - w / 4) / (w / 4) * h * 0.22 - h * 0.05
        p.rect(x, y, x, hz, '#4a3a6a')
        if y < hz - h * 0.2:
            p.dot(x, y, '#ffffff')
    p.vgrad(hz, h - 1, '#4a9a4a', '#2a6a2a')
    bx = w * 0.72                                          # the castle
    p.rect(bx, hz - h * 0.2, bx + w * 0.14, hz, '#8a8aa0')
    for k in range(4):
        p.rect(bx + k * w * 0.04, hz - h * 0.24, bx + k * w * 0.04 + w * 0.015, hz - h * 0.2, '#8a8aa0')
    p.rect(bx + w * 0.055, hz - h * 0.08, bx + w * 0.085, hz, '#3a2a2a')
    s = max(1, w // 45)
    hx, hy = w * 0.3, h * 0.78                             # the hero
    p.rect(hx - s, hy - 4 * s, hx + s, hy - 2 * s, '#f0c8a0')
    p.rect(hx - s * 1.5, hy - 2 * s, hx + s * 1.5, hy + s, '#3a6ad0')
    p.rect(hx - s, hy + s, hx + s, hy + 3 * s, '#5a3a2a')
    p.rect(hx + 2 * s, hy - 5 * s, hx + 2 * s, hy, '#e0e0f0')
    p.disc(w * 0.5, h * 0.84, 2.2 * s, '#5ad05a')          # the slime
    p.dot(w * 0.5 - s, h * 0.83, '#102010'); p.dot(w * 0.5 + s, h * 0.83, '#102010')
    if w > 60:
        p.rect(2, 2, 40, 9, '#1a1430')
        bar(p, 4, 4, 34, 0.8, '#ff4a6a'); bar(p, 4, 6, 34, 0.5, '#4a8aff')
    return p


def sports(w, h):
    """A pitch from the stands: stripes in the grass, the lines, two teams and the ball."""
    p = Pic(w, h)
    top = int(h * 0.18)
    p.vgrad(0, top, '#2a2a3a', '#4a4a5a')
    rnd = random.Random(3)
    for y in range(top):
        for x in range(0, w, 2):
            if rnd.random() < 0.35:
                p.dot(x + (y % 2), y, rnd.choice(['#d04040', '#4060d0', '#e0e0e0', '#e0c040']))
    for y in range(top, h):
        for x in range(w):
            p.dot(x, y, '#3a9a3a' if (x // max(2, w // 10)) % 2 else '#348a34')
    p.rect(1, top + 1, w - 2, top + 1, '#e8f0e8'); p.rect(1, h - 2, w - 2, h - 2, '#e8f0e8')
    p.rect(1, top + 1, 1, h - 2, '#e8f0e8'); p.rect(w - 2, top + 1, w - 2, h - 2, '#e8f0e8')
    p.rect(w // 2, top + 1, w // 2, h - 2, '#e8f0e8')
    r = (h - top) * 0.22
    for a in range(0, 360, 6):
        p.dot(w / 2 + math.cos(math.radians(a)) * r, (top + h) / 2 + math.sin(math.radians(a)) * r, '#e8f0e8')
    s = max(1, w // 60)
    rnd = random.Random(11)
    n = 5 if w > 60 else 2
    for team, c in (('a', '#e04040'), ('b', '#4070e0')):
        for _ in range(n):
            x = rnd.uniform(w * (0.1 if team == 'a' else 0.5), w * (0.5 if team == 'a' else 0.9))
            y = rnd.uniform(top + 4, h - 5)
            p.rect(x - s, y - s, x + s, y + s, c)
            p.dot(x, y - s - 1, '#f0c8a0')
    p.disc(w * 0.56, h * 0.6, max(0.8, s * 0.9), '#ffffff')
    if w > 60:
        p.rect(2, 1, 28, 7, '#101018'); text(p, 4, 2, '1 0', '#ffffff')
    return p


def blocks(w, h):
    """A world of blocks: sky, a sun, layered ground with a cave, trees."""
    p = Pic(w, h)
    b = max(2, w // 17)                                    # a block's size
    p.vgrad(0, h - 1, '#6ab0ff', '#b8dcff')
    p.rect(w * 0.78, h * 0.1, w * 0.78 + b * 1.5, h * 0.1 + b * 1.5, '#fff0a0')
    rnd = random.Random(5)
    ground = [int(h * 0.55 + rnd.choice([-1, 0, 0, 1]) * b) for _ in range(w // b + 2)]
    for k, g in enumerate(ground):
        x0 = k * b
        for y in range(g, h, b):
            c = '#5ab03a' if y == g else ('#8a5a3a' if y < g + 3 * b else '#7a7a82')
            p.rect(x0, y, x0 + b - 1, y + b - 1, c)
            p.rect(x0, y, x0 + b - 1, y, mix(rgb(c), (255, 255, 255), 0.2))
        if k % 5 == 2 and g > h * 0.4:                     # a tree
            p.rect(x0, g - 2 * b, x0 + b - 1, g - 1, '#6a4a2a')
            p.rect(x0 - b, g - 4 * b, x0 + 2 * b - 1, g - 2 * b - 1, '#2a8a2a')
    p.rect(w * 0.35, h * 0.78, w * 0.35 + 2 * b, h * 0.78 + b, '#1a1a20')     # a cave mouth
    if w > 60:
        p.rect(w / 2, h / 2 - 2, w / 2, h / 2 + 2, '#ffffff'); p.rect(w / 2 - 2, h / 2, w / 2 + 2, h / 2, '#ffffff')
    return p


DRAW = {'arcade': arcade, 'shooter': shooter, 'racing': racing, 'cards': cards, 'rpg': rpg, 'sports': sports, 'blocks': blocks}


def main():
    os.makedirs(OUT, exist_ok=True)
    shown = []
    for kind in KINDS:
        for (w, h) in SIZES:
            pic = DRAW[kind](w, h).im
            name = f'{kind}.png' if (w, h) == SIZES[0] else f'{kind}-{w}x{h}.png'
            pic.save(os.path.join(OUT, name), optimize=True)
            shown.append(pic)
    big = 4
    W, H = SIZES[0][0] * big, SIZES[0][1] * big
    sheet = Image.new('RGB', (W + SIZES[1][0] * big + 24, len(KINDS) * (H + 8) + 8), (40, 42, 54))
    for k in range(len(KINDS)):
        a, b = shown[k * 2], shown[k * 2 + 1]
        y = 8 + k * (H + 8)
        sheet.paste(a.resize((a.width * big, a.height * big), Image.NEAREST), (8, y))
        sheet.paste(b.resize((b.width * big, b.height * big), Image.NEAREST), (W + 16, y))
    sheet.save(os.path.join(ROOT, 'art', 'game-screens-preview.png'), optimize=True)
    print('wrote', len(shown), 'screens to', OUT)


if __name__ == '__main__':
    main()
