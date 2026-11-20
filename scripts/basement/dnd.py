"""The DnD room: a fantasy war room. Rough stone walls with crimson banners, torches in iron sconces, a bookshelf of old
tomes, a fireplace and a rack of arms (on the right wall); flagstones underfoot; and in the middle a long oak table with a battle map spread
on it and high-backed chairs all round (five each side and one at each end; the DM's end has a screen). A suit of armour
stands in the corner and a chest sits by the wall.

The tabletop itself (the map, the tokens, the dice, initiative and the sheets) is a panel beside the room:
client/src/basement/dnd.tsx and server/basement/dnd.ts. The map on the table in the room is drawn by the page, from the
same map (`things.table`). Three battle maps of our own are drawn here too (`map-*.png`): a tavern, a dungeon and a
forest road, at 24 dots a square, 32 squares across."""
import math
import os
import random

import numpy as np
from PIL import Image

TITLE = 'DnD room'
BLURB = 'A small war room: maps, tokens, dice, sheets'
ORDER = 40

STAIRS = (6, 154, 42, 225)
TABLE = (96, 184, 160, 208)                  # the table top: x0, y0, x1, y1 (about 8 feet by 3)
CHAMBER = (206, 300)                         # the chamber: its right wall and its near wall (the rest of the basement is rock)
SQ = 24


def draw(mc, L):
    rgb, mix, shade, tint, Mat, base = mc.rgb, mc.mix, mc.shade, mc.tint, mc.Mat, mc.base
    WALL = mc.WALL
    oak = Mat('#7a4a28', hi='#a06838', lo='#4a2a14')
    oak_g = Mat('#7a4a28', hi='#a06838', lo='#4a2a14', pat=mc.grain(21))
    iron = Mat('#3a3a40', hi='#5a5a62', lo='#1a1a1e')
    gold = Mat('#d8b040', hi='#f8e088', lo='#8a6a18')
    crimson = Mat('#8a1c22', hi='#b02a30', lo='#5a0e12')
    X1, Y1 = CHAMBER                                                     # the chamber's right and near edges

    # ── outside the chamber: solid rock (not shown: the room is cropped to the chamber) ──
    base.rect(X1, 0, mc.W - 1, mc.H - 1, rgb('#0a0810'))
    base.rect(0, Y1, mc.W - 1, mc.H - 1, rgb('#0a0810'))

    # ── stone walls: dressed blocks, each its own grey, lit along its top and left, shaded along its bottom and right ──
    for y in range(4, WALL):
        for x in range(6, X1):
            row = (y - 4) // 11
            off = (row * 13) % 26
            bx, by = (x + off) % 26, (y - 4) % 11
            n = ((x + off) // 26 * 37 + row * 91) % 7
            c = mix(rgb('#4a4440'), rgb('#5c544c'), n / 7)
            lump = mc.noise(x, y, 5, 70 + n)
            c = tint(c, 0.06 * lump) if lump > 0 else shade(c, -0.08 * lump)
            if bx == 0 or by == 0:
                c = rgb('#24201c')
            elif bx == 1 or by == 1:
                c = tint(c, 0.14)
            elif bx == 25 or by == 10:
                c = shade(c, 0.18)
            elif mc.hsh(x, y, 71) % 37 == 0:
                c = shade(c, 0.2)                                       # a chip out of the stone
            if by == 10 and mc.hsh(x // 3, row, 72) % 4 == 0:
                c = mix(c, rgb('#3a5a2a'), 0.4)                         # moss in the joint
            if y < 16:
                c = shade(c, 0.45 - 0.035 * (y - 4))
            if y >= WALL - 4:
                c = shade(c, 0.35)
            base.px(x, y, c)
    base.rect(6, 4, X1 - 1, 6, rgb('#1a1612'))
    for x in range(6, X1):                                              # oak beams across the ceiling, end on
        base.px(x, 7, shade(base.get(x, 7), 0.4))
    for x in range(20, X1 - 4, 46):
        base.part(mc.rows(x, 4, x + 7, 9), Mat('#5a3418', hi='#7a4a28', lo='#2a160a'), hi='tl', lo='rb')
        base.px(x + 3, 6, rgb('#3a1e0c'))

    # ── flagstones: each stone a little domed, lit on its top edge, worn, with moss and grit between them ──
    for y in range(WALL, Y1):
        for x in range(6, X1):
            if STAIRS[0] <= x <= STAIRS[2] and STAIRS[1] <= y <= STAIRS[3]:
                continue
            row = (y - WALL) // 14
            off = (row * 13) % 24
            sx, sy = (x + off) % 24, (y - WALL) % 14
            k = ((x + off) // 24 * 53 + row * 29) % 9
            c = mix(rgb('#5a5650'), rgb('#706a60'), k / 9)
            lump = mc.noise(x, y, 6, 80 + k)
            c = tint(c, 0.07 * lump) if lump > 0 else shade(c, -0.09 * lump)
            if sx == 0 or sy == 0:
                c = rgb('#2a2622')
                if mc.hsh(x, y, 81) % 3 == 0:
                    c = rgb('#3a4a2a')                                  # moss between the stones
            elif sy == 1 or sx == 1:
                c = tint(c, 0.12)
            elif sy == 13 or sx == 23:
                c = shade(c, 0.2)
            elif sy == 12 or sx == 22:
                c = shade(c, 0.08)
            elif mc.hsh(x, y, 82) % 29 == 0:
                c = shade(c, 0.18)
            elif (x * 7 + y * 13) % 41 == 0:
                c = mix(c, rgb('#4a6a3a'), 0.5)
            if y < WALL + 5:
                c = shade(c, 0.4 - 0.07 * (y - WALL))
            base.px(x, y, c)
    # the chamber's right and near walls, seen from above: thick stone, its top in blocks
    for y in range(4, Y1 + 8):
        for x in range(X1, X1 + 8):
            c = rgb('#4a4440') if (y // 7) % 2 == (1 if x < X1 + 4 else 0) else rgb('#524b45')
            if x == X1 or y % 7 == 0:
                c = rgb('#2e2a26')
            elif x == X1 + 1:
                c = rgb('#6a625a')
            elif x == X1 + 7:
                c = rgb('#24201c')
            base.px(x, y, c)
    for y in range(Y1, Y1 + 8):
        for x in range(6, X1 + 1):
            c = rgb('#4a4440') if (x // 9) % 2 == (1 if y < Y1 + 4 else 0) else rgb('#524b45')
            if y == Y1 or x % 9 == 0:
                c = rgb('#2e2a26')
            elif y == Y1 + 1:
                c = rgb('#6a625a')
            elif y == Y1 + 7:
                c = rgb('#24201c')
            base.px(x, y, c)
    for y in range(WALL, Y1):                                          # their shadow on the floor
        for k in range(3):
            base.px(X1 - 1 - k, y, shade(base.get(X1 - 1 - k, y), 0.3 - 0.1 * k))
    mc.block(X1, 4, mc.W - 1, mc.H - 1)
    mc.block(0, Y1, mc.W - 1, mc.H - 1)
    L['view'] = [0, 0, X1 + 10, Y1 + 10]

    # ── on the walls: a fireplace, torches, banners, a bookshelf, a rack of arms ──
    def fireplace(c):
        stone = Mat('#6a625a', hi='#8a8278', lo='#3a3430')
        c.part(mc.rows(12, 40, 52, 46), stone, hi='tl', lo='rb')                          # the mantel
        c.rect(13, 40, 51, 40, rgb('#a09888'))
        for x in (12, 44):                                                                 # the jambs, in blocks
            for k, y in enumerate(range(47, 96, 7)):
                c.part(mc.rows(x + (k % 2), y, x + 7 + (k % 2) - 1, y + 6), stone, hi='tl', lo='rb')
        for y in range(47, 96):                                                            # the firebox, sooty and deep
            for x in range(20, 44):
                t = (y - 47) / 48
                c.px(x, y, mix(rgb('#0c0808'), rgb('#3a1a0c'), t * t))
        for x in range(20, 44):
            c.px(x, 47, rgb('#000000'))
        for k in range(3):                                                                 # logs on the irons
            c.part(mc.rows(23 + k * 6, 88 - k % 2 * 2, 30 + k * 6, 91 - k % 2 * 2), Mat('#5a3418', hi='#8a5a30', lo='#2a160a'), hi='t', lo='b')
        c.rect(20, 92, 43, 95, rgb('#e86a20'))
        for x in range(21, 43, 3):
            c.px(x, 93, rgb('#ffd060'))                                                    # embers
        c.part(mc.rows(8, 96, 56, 101), Mat('#5a524a', hi='#7a7268', lo='#2e2a26'), hi='t', lo='b')   # the hearthstone
        for x in (24, 39):
            c.rect(x, 82, x, 92, iron.hi)                                                  # the andirons
        c.part(mc.rows(16, 34, 22, 39), Mat('#c8c0b0', hi='#f0e8d8', lo='#8a8270'), hi='tl', lo='rb')     # on the mantel: a skull
        c.rect(17, 36, 18, 36, rgb('#2a2622')); c.rect(20, 36, 21, 36, rgb('#2a2622'))
        c.rect(42, 33, 43, 39, rgb('#f0e8d0')); c.px(42, 32, rgb('#ffd060'))              # and a candle
        c.rect(30, 36, 36, 39, rgb('#2a5a3a')); c.rect(30, 36, 36, 36, rgb('#4a8a5a'))    # and a potion
    mc.pool(32, 104, 34, 16, '#ff9040', 0.28)
    mc.put(base, fireplace)
    mc.block(8, 92, 56, 101)
    mc.light(32, 84, 34, 28, '#ff8030', 0.34)
    L['things']['flames'] = [dict(x=21, y=64, w=22, h=28, kind='hearth')]      # (the page draws the fire, flickering)

    for tx in (60, 176):
        def torch(c, tx=tx):
            c.part(mc.rows(tx - 1, 44, tx + 1, 58), iron, hi='l', lo='r')               # the bracket
            c.rect(tx - 3, 54, tx + 3, 55, iron.lo); c.px(tx - 3, 54, iron.hi)
            c.part([(40, tx - 3, tx + 3), (41, tx - 3, tx + 3), (42, tx - 2, tx + 2), (43, tx - 2, tx + 2)], iron, hi='tl', lo='rb')   # the cup
            c.rect(tx - 2, 37, tx + 2, 39, rgb('#5a3418'))                               # the pitch-soaked head
        for y in range(10, 30):                                          # its soot on the wall
            for x in range(tx - 5, tx + 6):
                k = 0.3 * max(0, 1 - abs(x - tx) / 6) * (1 - (y - 10) / 20 * 0.5)
                base.px(x, y, shade(base.get(x, y), k))
        mc.pool(tx, 36, 22, 20, '#ffa040', 0.2)                          # its light on the stone round it
        mc.put(base, torch)
        mc.light(tx, 40, 30, 26, '#ffa040', 0.32)
        L['things']['flames'].append(dict(x=tx - 4, y=25, w=9, h=13, kind='torch'))
    for bx in (78, 142):
        def banner(c, bx=bx):
            c.rect(bx - 3, 10, bx + 19, 11, rgb('#8a6a2a')); c.rect(bx - 3, 10, bx + 19, 10, rgb('#c8a050'))      # the rod
            c.part(mc.ellipse(bx - 4, 10.5, 1.5, 1.5), gold); c.part(mc.ellipse(bx + 20, 10.5, 1.5, 1.5), gold)     # its finials
            c.part(mc.rows(bx, 12, bx + 16, 52), crimson, hi='l', lo='r')
            for k in range(9):
                c.rect(bx + k, 52, bx + k, 52 + (9 - k) // 2, crimson.base)
                c.rect(bx + 16 - k, 52, bx + 16 - k, 52 + (9 - k) // 2, crimson.base)
            for x in range(bx + 1, bx + 16):                             # folds hanging down it
                f = (x - bx) % 6
                for y in range(12, 53 + (9 - min(x - bx, bx + 16 - x)) // 2):
                    cur = c.get(x, y)
                    if cur and y > 12:
                        c.px(x, y, tint(cur, 0.12) if f == 1 else shade(cur, 0.18) if f == 4 else cur)
            for y in range(13, 60):                                      # a gold border down each side and along the points
                for x in (bx + 1, bx + 15):
                    if c.get(x, y) and y < 52:
                        c.px(x, y, gold.base if y % 3 else gold.lo)
            for k in range(8):
                c.px(bx + 1 + k, 52 + (9 - k) // 2 - 1, gold.base); c.px(bx + 15 - k, 52 + (9 - k) // 2 - 1, gold.base)
            c.part(mc.ellipse(bx + 8, 28, 5, 6), gold, hi='tl', lo='rb')
            c.part(mc.ellipse(bx + 8, 28, 3, 4), Mat('#c09830', hi='#e8c860', lo='#8a6a18'))
            c.rect(bx + 8, 20, bx + 8, 38, rgb('#e8e8f0')); c.rect(bx + 9, 21, bx + 9, 37, rgb('#9a9aa8'))      # a sword through it
            c.rect(bx + 5, 33, bx + 11, 33, rgb('#e8e8f0')); c.rect(bx + 5, 34, bx + 11, 34, rgb('#7a7a88'))
            c.px(bx + 8, 39, gold.hi)
        mc.put(base, banner)

    def shelf(c):
        c.part(mc.rows(100, 40, 136, 98), oak_g, hi='tl', lo='rb', anchor=(0, 0))
        c.part(mc.rows(98, 37, 138, 40), oak, hi='t', lo='b')                              # its cornice
        c.rect(103, 43, 133, 95, rgb('#24160a'))
        cols = ['#7a2a2a', '#2a4a7a', '#4a6a2a', '#7a5a2a', '#5a2a5a', '#2a5a5a', '#8a7a4a']
        for r, y in enumerate((43, 61, 79)):
            c.rect(103, y, 133, y + 1, rgb('#120a04'))                                     # the shadow under the shelf above
            c.part(mc.rows(101, y + 16, 135, y + 17), oak, hi='t', lo='b')
            x, k = 104, r * 3
            while x < 131:
                w = 2 + (k * 7) % 2
                h = 10 + (k * 5) % 5
                col = rgb(cols[k % len(cols)])
                if k % 9 == 4 and x < 128:                                                  # one leaning over
                    for t in range(h - 1):
                        c.rect(x + t * 3 // h, y + 15 - t, x + t * 3 // h + w - 1, y + 15 - t, col)
                    x += w + 3
                    k += 1
                    continue
                c.rect(x, y + 16 - h, x + w - 1, y + 15, col)
                c.rect(x, y + 16 - h, x, y + 15, tint(col, 0.25))                           # the spine's lit edge
                c.rect(x, y + 16 - h + 2, x + w - 1, y + 16 - h + 2, rgb('#d8b040'))         # gilt bands on the spine
                if h > 11:
                    c.rect(x, y + 13, x + w - 1, y + 13, rgb('#b8902a'))
                x += w + 1
                k += 1
        c.part(mc.ellipse(129, 76, 2, 2), Mat('#c8c0b0', hi='#f0e8d8', lo='#8a8270'))       # a skull on the middle shelf
        c.part(mc.rows(126, 92, 132, 95), Mat('#4a3a6a', hi='#6a5a9a', lo='#2a1a3a'))       # a little chest of scrolls
    mc.drop(100, 136, 99, 0.35, 2)
    mc.put(base, shelf)
    mc.block(100, 96, 136, 100)

    def arms(c):                                                         # a rack of arms on the right wall
        c.part(mc.rows(182, 44, 202, 47), oak_g, hi='t', lo='b', anchor=(0, 0))
        c.part(mc.rows(182, 84, 202, 87), oak_g, hi='t', lo='b', anchor=(0, 0))
        c.rect(185, 22, 185, 84, rgb('#6a4a2a')); c.part([(18, 184, 186), (19, 183, 187), (20, 184, 186), (21, 185, 185)], Mat('#c8ccd4', hi='#ffffff', lo='#7a7e88'))   # a spear
        c.rect(192, 30, 192, 84, rgb('#c8ccd4')); c.rect(193, 30, 193, 82, rgb('#7a7e88')); c.px(192, 29, rgb('#ffffff'))  # a sword
        c.rect(189, 70, 196, 71, gold.base); c.rect(192, 72, 193, 78, rgb('#4a2a14')); c.px(192, 79, gold.hi)
        c.rect(199, 36, 199, 84, rgb('#6a4a2a'))                                           # an axe
        c.part([(36, 196, 202), (37, 195, 202), (38, 195, 201), (39, 195, 201), (40, 196, 202), (41, 196, 202)], Mat('#a8acb8', hi='#e0e2ea', lo='#5a5e68'), hi='l', lo='r')
        c.part(mc.ellipse(192, 58, 5, 7), Mat('#8a1c22', hi='#b02a30', lo='#5a0e12'), hi='tl', lo='rb')    # a round shield, hung over the sword
        c.part(mc.ellipse(192, 58, 2, 3), gold, hi='tl', lo='rb')
        c.rect(187, 58, 197, 58, gold.lo)
    mc.put(base, arms)

    # ── a rug, and the table: about 8 feet by 3, two chairs a side and one at each end ──
    x0, y0, x1, y1 = TABLE
    knot = lambda x, y: 2 if (x - y) % 16 == 0 and (x + y) % 16 == 0 else 1 if (x - y) % 16 == 0 or (x + y) % 16 == 0 else 0
    mc.rug(x0 - 28, y0 - 30, x1 + 28, y1 + 35, rgb('#6a1a1e'), rgb('#c8a040'), rgb('#3a0e10'), knot, 41)
    mc.pool((x0 + x1) // 2, (y0 + y1) // 2 + 4, 70, 46, '#ffc070', 0.14)        # the candles' light on the rug

    def chair_back(c, x, y):
        c.part(mc.rows(x - 7, y, x + 7, y + 16), oak_g, hi='tl', lo='rb', anchor=(0, 0))
        c.part(mc.rows(x - 4, y + 3, x + 4, y + 13), Mat('#6a1a1a', hi='#9a2a2a', lo='#3a0a0a'), hi='tl', lo='rb')   # the padded panel
        c.px(x, y + 8, rgb('#d8b040'))                                                     # a brass stud in it
        for k in (-3, 3):
            c.px(x + k, y + 5, rgb('#3a0a0a')); c.px(x + k, y + 11, rgb('#3a0a0a'))
        c.part(mc.rows(x - 8, y - 2, x + 8, y), oak, hi='t', lo='b')
        for k in (-8, 8):
            c.part(mc.rows(x + k - (1 if k > 0 else 0), y - 4, x + k + (1 if k < 0 else 0), y - 2), oak, hi='t', lo='rb')   # carved finials
        c.rect(x - 7, y + 16, x + 7, y + 16, oak.lo)
    seats_x = [x0 + 18, x1 - 18]
    for x in seats_x:                                                    # the far side: their chairs behind them, the table in front
        mc.put(base, lambda c, x=x: chair_back(c, x, y0 - 22), shadow=True)
        L['seats'].append(dict(x=x, y=y0 + 6, ax=x, ay=y0 - 12, pose='front', flip=False, hit=[x - 10, y0 - 26, 20, 30]))

    def table(c):                                                        # drawn in front of whoever sits on the far side
        top = Mat('#7a4a28', hi='#a06838', lo='#4a2a14', pat=mc.grain(22, depth=0.12))
        c.part(mc.rows(x0, y0, x1, y1), top, hi='tl', lo='rb', anchor=(0, 0))
        for y in (y0 + 8, y0 + 16):
            c.rect(x0 + 1, y, x1 - 1, y, shade(oak.base, 0.3))                             # the joins between its planks
        c.part(mc.rows(x0, y1 + 1, x1, y1 + 6), Mat('#5a3418', hi='#7a4a28', lo='#3a1e0c', pat=mc.grain(23, depth=0.1)), hi='l', lo='b', anchor=(0, 0))
        c.rect(x0, y1 + 1, x1, y1 + 1, tint(oak.hi, 0.1))
        for kx in range(x0 + 8, x1 - 4, 12):                                               # carving along the apron
            c.rect(kx, y1 + 3, kx + 3, y1 + 3, rgb('#3a1e0c')); c.px(kx + 1, y1 + 4, rgb('#8a5a30'))
        for lx in (x0 + 2, x1 - 5):
            c.rect(lx, y1 + 6, lx + 3, y1 + 9, rgb('#3a1e0c')); c.rect(lx, y1 + 6, lx, y1 + 9, rgb('#6a3e1e'))
        c.rect(x0 + 4, y0 + 3, x1 - 4, y1 - 3, rgb('#d8c49a'))                              # the map's parchment (the page draws the map on it)
        c.rect(x0 + 4, y1 - 3, x1 - 4, y1 - 3, rgb('#b8a478'))
        c.part(mc.rows(x1 - 9, y0 + 6, x1 - 4, y1 - 6), Mat('#5a1a1a', hi='#8a2a2a', lo='#3a0a0a'), hi='tl', lo='rb')   # the DM's screen
        c.rect(x1 - 8, y0 + 12, x1 - 5, y0 + 12, rgb('#d8b040'))
    mc.drop(x0, x1, y1 + 10, 0.4, 3)
    mc.put_over(table, y1 + 9)
    mc.block(x0, y0, x1, y1 + 9)
    mc.light((x0 + x1) // 2, (y0 + y1) // 2, 60, 34, '#ffd890', 0.2)
    L['things']['table'] = [x0 + 4, y0 + 3, x1 - x0 - 8, y1 - y0 - 6]
    L['things']['tableZ'] = y1 + 10

    for x in seats_x:                                                    # the near side: chair backs in front of the sitters
        L['seats'].append(dict(x=x, y=y1 + 14, ax=x, ay=y1 + 30, pose='back', flip=False, hit=[x - 10, y1 + 2, 20, 28]))
        mc.drop(x - 7, x + 7, y1 + 33, 0.3, 2)
        mc.put_over(lambda c, x=x: chair_back(c, x, y1 + 16), y1 + 32)
        mc.block(x - 7, y1 + 16, x + 7, y1 + 32)
    # the two ends: a chair each, side on; the DM's at the right
    for x, flip in ((x0 - 11, True), (x1 + 13, False)):                  # (the DM sits a little further out, clear of the screen)
        def end_chair(c, x=x, flip=flip):
            bx = x - 9 if flip else x + 6
            c.part(mc.rows(bx, y0 - 4, bx + 3, y1 + 6), oak_g, hi='l', lo='r', anchor=(0, 0))
            c.part(mc.rows(bx - 1, y0 - 7, bx + 4, y0 - 4), oak, hi='t', lo='b')          # its carved crest
            c.px(bx + 1, y0 - 8, oak.hi); c.px(bx + 2, y0 - 8, oak.base)
            c.rect(bx + 1, y0, bx + 2, y1 - 4, rgb('#6a1a1a')); c.rect(bx + 1, y0, bx + 1, y1 - 4, rgb('#9a2a2a'))   # the padded back, side on
            c.part(mc.rows(min(bx, x - 6), y1 - 3, max(bx + 3, x + 6), y1 + 1), Mat('#6a1a1a', hi='#9a2a2a', lo='#3a0a0a'), hi='t', lo='b')   # the seat cushion
            c.rect(min(bx, x - 6), y1 + 1, max(bx + 3, x + 6), y1 + 1, oak.base)
            for lx in (x - 6, x + 5):
                c.rect(lx, y1 + 2, lx, y1 + 8, oak.lo); c.px(lx, y1 + 2, oak.hi)
        mc.drop(x - 7, x + 7, y1 + 9, 0.3, 2)
        mc.put(base, end_chair, shadow=True)
        L['seats'].append(dict(x=x, y=y1 + 4, ax=x + (-14 if flip else 14), ay=y1 + 16, pose='side', flip=flip, hit=[x - 10, y0 - 6, 20, y1 - y0 + 14]))
    L['things']['dmSeat'] = len(L['seats']) - 1

    # ── candelabras at the table's far corners ──
    for cx_ in (x0 - 18, x1 + 18):
        def candelabra(c, cx_=cx_):
            cy_ = y0 - 6
            c.rect(cx_, cy_ - 26, cx_, cy_, iron.base); c.px(cx_, cy_ - 25, iron.hi)
            for k in range(cy_ - 20, cy_, 6):
                c.rect(cx_ - 1, k, cx_ + 1, k, iron.hi)                                     # knops down the stem
            c.part([(cy_, cx_ - 2, cx_ + 2), (cy_ + 1, cx_ - 3, cx_ + 3), (cy_ + 2, cx_ - 4, cx_ + 4)], iron, hi='t', lo='b')
            c.rect(cx_ - 4, cy_ - 26, cx_ + 4, cy_ - 26, iron.hi); c.rect(cx_ - 4, cy_ - 25, cx_ + 4, cy_ - 25, iron.lo)
            for dx in (-4, 0, 4):
                c.rect(cx_ + dx, cy_ - 30, cx_ + dx, cy_ - 27, rgb('#f0e8d0'))
                c.px(cx_ + dx, cy_ - 28, rgb('#c8c0a8'))                                    # wax dripping down it
                c.px(cx_ + dx, cy_ - 31, rgb('#ffd060')); c.px(cx_ + dx, cy_ - 32, rgb('#fff4c0'))
        mc.drop(cx_ - 4, cx_ + 4, y0 - 3, 0.3, 1)
        mc.put_over(candelabra, y0 - 4)
        mc.block(cx_ - 3, y0 - 8, cx_ + 3, y0 - 4)
        mc.light(cx_, y0 - 36, 22, 18, '#ffc060', 0.25)

    # ── a suit of armour in the corner, a chest by the stairs ──
    def armour(c):
        steel = Mat('#a8acb8', hi='#e0e2ea', lo='#5a5e68')
        cx = X1 - 16                                                                       # its middle
        c.part(mc.rows(cx - 10, 146, cx + 10, 150), Mat('#4a4440', hi='#6a625a', lo='#2a2622'), hi='t', lo='b')   # its stone plinth
        for lx in (cx - 6, cx + 1):                                                        # short legs in greaves, sabatons
            mc.cyl(c, lx, 138, lx + 5, 144, steel)
            c.part(mc.rows(lx - 1, 144, lx + 5, 145), steel, hi='t', lo='b')
        mc.cyl(c, cx - 7, 124, cx + 7, 137, steel)                                         # a stocky breastplate
        c.rect(cx, 125, cx, 136, steel.lo)
        for y in range(133, 138, 2):                                                       # the tassets
            c.rect(cx - 7, y, cx + 7, y, steel.lo)
        c.rect(cx - 7, 131, cx + 7, 131, rgb('#5a3418')); c.rect(cx - 1, 131, cx + 1, 131, gold.base)     # its belt and buckle
        for ax in (cx - 10, cx + 8):                                                       # the arms at its sides, gauntlets
            mc.cyl(c, ax, 125, ax + 2, 135, steel)
            c.part(mc.rows(ax, 135, ax + 2, 137), Mat('#8a8e98', hi='#c0c4cc', lo='#5a5e68'))
        c.part(mc.rows(cx - 10, 122, cx + 10, 126), steel, hi='t', lo='b')                 # broad pauldrons
        c.part(mc.ellipse(cx, 115, 7, 7), steel, hi='tl', lo='rb')                         # the great helm: as big as anybody's head
        c.rect(cx - 5, 115, cx + 5, 116, rgb('#1a1a1e')); c.px(cx - 3, 114, steel.hi)      # its visor slit
        for k in range(-3, 4, 2):
            c.px(cx + k, 119, rgb('#3a3a40'))                                              # breaths
        c.rect(cx, 106, cx, 108, rgb('#b02a30')); c.rect(cx - 1, 107, cx + 1, 107, rgb('#d83a40'))   # its plume
        c.rect(cx + 12, 112, cx + 12, 146, rgb('#d8dce2')); c.rect(cx + 13, 113, cx + 13, 146, rgb('#7a7e88'))   # a greatsword at its side, point down
        c.rect(cx + 10, 120, cx + 15, 120, gold.base); c.rect(cx + 12, 108, cx + 13, 111, rgb('#5a3418'))
    mc.drop(X1 - 24, X1 - 5, 151, 0.35, 2)
    mc.put_over(armour, 150, shadow=True)
    mc.block(X1 - 24, 138, X1 - 6, 150)

    def chest(c):
        c.part(mc.rows(16, Y1 - 22, 40, Y1 - 8), oak_g, hi='tl', lo='rb', anchor=(0, 0))
        for y in (Y1 - 17, Y1 - 12):
            c.rect(17, y, 39, y, oak.lo)                                                   # its planks
        c.part([(Y1 - 28, 18, 38), (Y1 - 27, 17, 39)] + mc.rows(16, Y1 - 26, 40, Y1 - 21), Mat('#8a5a30', hi='#b07840', lo='#5a3418'), hi='t', lo='b')   # the domed lid
        c.rect(16, Y1 - 21, 40, Y1 - 21, rgb('#3a1e0c'))
        for x in (19, 36):
            c.rect(x, Y1 - 28, x + 1, Y1 - 8, iron.base); c.rect(x, Y1 - 28, x, Y1 - 8, iron.hi)   # iron bands
            for y in range(Y1 - 25, Y1 - 8, 4):
                c.px(x + 1, y, rgb('#c9a13a'))                                             # rivets
        c.part(mc.rows(26, Y1 - 21, 30, Y1 - 16), gold, hi='tl', lo='rb')                  # the lock
        c.px(28, Y1 - 18, rgb('#2a1a0a'))
    mc.drop(16, 41, Y1 - 7, 0.35, 2)
    mc.put(base, chest, shadow=True)
    mc.block(16, Y1 - 27, 40, Y1 - 8)

    L['stands'] += [dict(x=70, y=130, face='right'), dict(x=170, y=130, face='left'), dict(x=70, y=260, face='right'), dict(x=170, y=268, face='left')]

    maps(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'client', 'public', 'basement', 'dnd'))


# ───────────────────────── the battle maps ─────────────────────────

def maps(folder):
    os.makedirs(folder, exist_ok=True)
    COLS, ROWS = 32, 22
    W, H = COLS * SQ, ROWS * SQ

    def noise(h, w, seed, scale):
        r = np.random.default_rng(seed)
        small = r.random((h // scale + 2, w // scale + 2))
        big = np.kron(small, np.ones((scale, scale)))[:h, :w]
        return (big + r.random((h, w)) * 0.35) / 1.35

    def grid(a, col=(0, 0, 0), alpha=0.18):
        for x in range(0, W, SQ):
            a[:, x] = a[:, x] * (1 - alpha) + np.array(col) * alpha
        for y in range(0, H, SQ):
            a[y, :] = a[y, :] * (1 - alpha) + np.array(col) * alpha

    def rect(a, x0, y0, x1, y1, col):
        a[y0:y1, x0:x1] = col

    def disc(a, cx, cy, r, col):
        yy, xx = np.ogrid[:H, :W]
        a[(xx - cx) ** 2 + (yy - cy) ** 2 <= r * r] = col

    def save(a, name):
        Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), 'RGB').save(os.path.join(folder, name), optimize=True)

    # the tavern: planks, stone walls, a bar, round tables, a hearth
    a = np.zeros((H, W, 3))
    n = noise(H, W, 1, 6)
    yy, xx = np.mgrid[:H, :W]
    plank = ((yy // 8) * 7 + (xx + (yy // 8) * 37) // 64) % 3
    a[...] = np.array([138, 96, 58]) * (0.85 + 0.1 * plank[..., None] / 2 + 0.1 * n[..., None])
    a[(yy % 8) == 0] *= 0.7
    S = SQ
    for (x0, y0, x1, y1) in ((0, 0, W, S), (0, H - S, W, H), (0, 0, S, H), (W - S, 0, W, H), (12 * S, 13 * S, 13 * S, H)):
        rect(a, x0, y0, x1, y1, (92, 86, 80))
    rect(a, 12 * S, 16 * S, 13 * S, 18 * S, (138, 96, 58))                        # a doorway through the inner wall
    rect(a, 2 * S, 2 * S, 14 * S, 3 * S + 8, (92, 52, 28))                      # the bar
    rect(a, 2 * S, 1 * S, 14 * S, 2 * S, (60, 40, 24))
    for k in range(10):
        disc(a, 2 * S + 20 + k * 26, 1 * S + 12, 5, [(160, 60, 40), (60, 120, 60), (200, 180, 90)][k % 3])
    for (cx, cy) in ((6, 8), (11, 8), (20, 6), (25, 10), (20, 15), (6, 15)):     # round tables and their stools
        disc(a, cx * S, cy * S, 26, (110, 70, 40)); disc(a, cx * S, cy * S, 20, (128, 84, 48))
        for ang in range(0, 360, 72):
            disc(a, cx * S + int(40 * math.cos(math.radians(ang))), cy * S + int(40 * math.sin(math.radians(ang))), 8, (80, 50, 28))
    rect(a, 27 * S, 1 * S, 31 * S, 3 * S, (70, 66, 62)); rect(a, 28 * S, 1 * S + 6, 30 * S, 2 * S + 12, (230, 110, 30))   # the hearth
    rect(a, 25 * S, 14 * S, 30 * S, 19 * S, (120, 40, 40)); rect(a, 25 * S + 6, 14 * S + 6, 30 * S - 6, 19 * S - 6, (150, 60, 50))   # a rug
    rect(a, 14 * S, H - S, 16 * S, H, (110, 70, 40))                             # the front door
    grid(a)
    save(a, 'map-tavern.png')

    # the dungeon: rooms of flagstone in black rock, corridors, pillars, a pool
    a = np.zeros((H, W, 3)) + np.array([22, 20, 24]) * (0.8 + 0.4 * noise(H, W, 2, 4)[..., None])
    floor = np.zeros((H, W), bool)
    for (x0, y0, x1, y1) in ((2, 2, 11, 9), (15, 2, 29, 8), (3, 13, 12, 20), (16, 12, 30, 20), (6, 9, 8, 13), (11, 4, 15, 6), (21, 8, 23, 12), (12, 16, 16, 18)):
        floor[y0 * S:y1 * S, x0 * S:x1 * S] = True
    stone = np.array([96, 92, 88]) * (0.8 + 0.3 * noise(H, W, 3, 6)[..., None])
    a[floor] = stone[floor]
    edge = floor & ~(np.roll(floor, 2, 0) & np.roll(floor, -2, 0) & np.roll(floor, 2, 1) & np.roll(floor, -2, 1))
    a[edge] = (50, 46, 44)
    for (cx, cy) in ((18, 4), (26, 4), (18, 6), (26, 6)):
        disc(a, cx * S + 12, cy * S + 12, 9, (60, 58, 56)); disc(a, cx * S + 10, cy * S + 10, 7, (130, 126, 120))
    disc(a, 23 * S, 16 * S, 50, (30, 60, 90)); disc(a, 23 * S, 16 * S, 40, (40, 80, 120))     # a pool
    rect(a, 5 * S, 15 * S, 8 * S, 18 * S, (10, 8, 10))                                      # a pit
    for (x, y) in ((8 * S, 5 * S), (27 * S, 17 * S), (4 * S, 18 * S)):
        for k in range(6):
            disc(a, x + (k * 13) % 30, y + (k * 7) % 20, 4, (70, 66, 60))                    # rubble
    grid(a, alpha=0.22)
    save(a, 'map-dungeon.png')

    # the forest road: grass, a winding dirt road, trees, a stream and a bridge
    g = noise(H, W, 4, 8)
    a = np.zeros((H, W, 3)) + np.array([58, 110, 52]) * (0.8 + 0.35 * g[..., None])
    road = np.abs(yy - (H / 2 + 70 * np.sin(xx / 140.0))) < 34
    a[road] = (np.array([150, 120, 80]) * (0.85 + 0.25 * noise(H, W, 5, 3)[..., None]))[road]
    stream = np.abs(xx - (W * 0.62 + 30 * np.sin(yy / 60.0))) < 18
    a[stream] = (40, 100, 170)
    bridge = stream & (np.abs(yy - (H / 2 + 70 * np.sin(xx / 140.0))) < 30)
    a[bridge] = (130, 90, 50)
    rnd = random.Random(9)
    for _ in range(26):
        cx, cy = rnd.randrange(20, W - 20), rnd.randrange(20, H - 20)
        if abs(cy - (H / 2 + 70 * math.sin(cx / 140.0))) < 60 or abs(cx - (W * 0.62 + 30 * math.sin(cy / 60.0))) < 40:
            continue
        r = rnd.randrange(22, 40)
        disc(a, cx + 4, cy + 6, r, (30, 60, 30)); disc(a, cx, cy, r, (40, 92, 40)); disc(a, cx - r // 4, cy - r // 4, r // 2, (60, 120, 52))
    for _ in range(8):
        cx, cy = rnd.randrange(20, W - 20), rnd.randrange(20, H - 20)
        disc(a, cx, cy, rnd.randrange(6, 12), (120, 118, 112))
    grid(a, alpha=0.15)
    save(a, 'map-forest.png')
