"""The backyard: not a basement at all, but the yard out past the house's west wall, through the door above the stairs in
the room upstairs. A suburban back garden behind a cedar privacy fence: a big lawn, grown long, to mow (the mower is kept
by the gate; the grass itself is the page's, client/src/basement/backyard.tsx, since it is cut and grows back), a pool
with a diving board and a waterfall tumbling into it over rocks, a hot tub, and a patio by the house with a table and
chairs, a smoking table (cigarettes, cigars, two pipes, bubbles, a mini fan), a grill, a cooler and a radio. Flower beds, hydrangeas, a
birdbath, a flamingo and a gnome; string lights over the patio; the neighbours' trees over the fence.

The house's wall runs down the right edge with the door in it: that is the way back in (this fit-out's EXIT, which the
page treats as its stairs). door.png is the door in the room upstairs, laid over the room's west wall where
things['door'] says, and doorview.png the yard seen through it (dimmed by the page at night).

Drawn with the yard's own tools from scripts/make-clubhouse.py, at the same scale as the room. SHELL = False tells
scripts/make-basement.py to skip the basement's walls, stairs and concrete."""
import math

import numpy as np

TITLE = 'Backyard'
BLURB = 'The pool, the hot tub and the lawn, out past the west door'
ORDER = 998
SHELL = False
VIGNETTE = 0.12
GROUND = (10, 64, 506, 328)                      # where feet may go: x0, y0, x1, y1
DOOR_Y0, DOOR_Y1 = 150, 172                      # the doorway in the house's wall, down the right edge
EXIT = dict(rect=[500, 140, 28, 44], foot=dict(x=492, y=161), face='right')
UP_DOOR = (129, 149)                             # the same doorway in the room upstairs, in its west wall (rows): below the desk, above the stairs
LAWN = (14, 100, 362, 186)                       # the lawn that is mown: x0, y0, x1, y1 (the page grows and cuts it)
LCELL = 2                                        # one patch of lawn: LCELL dots square
MOWER_HOME = (80, 104)                           # where the mower is kept: beside the path to the golf (the foot of whoever pushes it)
GOLF_PATH = (34, 70)                             # where the path to the mini golf leaves the yard, by the gate in the fence's top left
GATE = (24, 46)                                  # the gateway in the fence: x0, x1 (scripts/basement/minigolf.py: things['back']['foot'] is GOLF_PATH)
POOL = (112, 214, 350, 318)                      # the pool's coping, outside edge: x0, y0, x1, y1
WATER = (116, 218, 346, 314)                     # its water
FALL = (232, 186, 300, 218)                      # the waterfall's rocks
TUB = (392, 240, 494, 308)                       # the hot tub's cedar surround
TUB_IN = (400, 248, 486, 298)                    # its water
PATIO = (368, 66, 511, 228)                      # the pavers by the house
DECK = (92, 198, 367, 330)                       # the pool's concrete deck: it runs up to the patio's left edge, and no further
PONG = (404, 104)                                # the beer pong table (client/src/basement/pong.ts): its middle line (x) and Red's end (y);
PONG_W, PONG_L = 16, 64                          #   2 feet by 8 on the ground, long way down the picture (8 dots a foot)
BOCCE_SET = (26, 194, 44, 32)                    # the bocce set (client/src/basement/bocce.tsx draws it): x, y, w, h, on the grass below the lawn
EXTRA = {}
SEASONS = ('spring', 'fall', 'winter', 'snow')  # drawn once a season as well (scripts/basement/_seasons.py; summer is base.png)
SEASONAL_EXTRA = ('doorview',)                   # (the strip of lawn seen through the door upstairs goes with them)

import importlib.util as _iu
import os as _os


def _load(name):
    s = _iu.spec_from_file_location(name, _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), '_%s.py' % name))
    m = _iu.module_from_spec(s)
    s.loader.exec_module(m)
    return m


camp = _load('camp_art')                          # the campsite's kit: the cooler, the radio, bushes, ferns, bulbs, posts
art = _load('yard_art')                           # the backyard's own
S = _load('seasons')                              # what the season does to it


def golf_path_x(y):
    """The path to the mini golf's middle, at row y: up through the gate and on up into the trees, bearing left."""
    return GOLF_PATH[0] + 3 * math.sin(y / 11.0) - max(0, 60 - y) * 0.22


def draw(mc, L):
    rgb, mix, shade, tint, Mat, Cv, base = mc.rgb, mc.mix, mc.shade, mc.tint, mc.Mat, mc.Cv, mc.base
    W, H, hsh, noise = mc.W, mc.H, mc.hsh, mc.noise
    L['outdoors'] = True
    L['view'] = [0, 0, W, H]
    camp.setup(mc)
    art.setup(mc)
    S.begin(mc)
    snowy = S.season(mc) == 'snow'

    def put(draw, over=None, shadow=False, fine=None, snow=True):
        """mc.put / mc.put_over for a scene with no walls (outlined on a canvas one dot bigger all round, so what runs
        off one edge does not come back in at the other). Under snow, snow lies along its tops; `fine` (a bare tree's
        twigs) is laid on after the outline."""
        t = Cv(W, H)
        draw(t)
        a = mc.outline(np.pad(t.a, ((1, 1), (1, 1), (0, 0))))[1:-1, 1:-1]
        if snowy and snow:
            a = S.snow(mc, a)
        if fine:
            fine(a)
        m = a[..., 3] > 0
        if not m.any():
            return
        if shadow:
            mc.foot_shadow(m)
        if over is None:
            base.a[m] = a[m]
            return
        ys, xs = np.nonzero(m)
        x0, y0, x1, y1 = int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())
        mc.occluders.append((a[y0:y1 + 1, x0:x1 + 1].copy(), dict(x=x0, y=y0, w=x1 - x0 + 1, h=y1 - y0 + 1, z=over)))

    def at(cv, x, y):
        return lambda c: c.paste(cv, x - cv.w // 2, y - cv.h + 1)

    def shadow(cx, cy, rx, ry, k=0.32, seed=1):
        for y in range(int(cy - ry), int(cy + ry) + 1):
            for x in range(int(cx - rx), int(cx + rx) + 1):
                d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 + noise(x, y, 9, seed) * 0.25
                if d <= 1 and (d < 0.74 or (x + y) % 2 == 0) and 0 <= x < W and 0 <= y < H and base.get(x, y):
                    base.px(x, y, mix(base.get(x, y), (14, 34, 30), k))

    def stand(cv, x, y, over=None, sh=True, block=True):
        """Something standing on the ground with the middle of its foot at (x, y): a shadow, and in the way."""
        if sh:
            shadow(x + 2, y + 1, cv.w * 0.45, 2.2, 0.3, seed=x + y)
        put(at(cv, x, y), over=y if over is None else over)
        if block:
            mc.block(x - cv.w // 2 + 1, y - 3, x + cv.w // 2 - 1, y)

    # ── the ground: grass everywhere (the lawn's own is the page's), a bed of mulch under the fence, concrete round the
    #    pool and pavers by the house ──
    tile = mc.grass_tile()
    G = mc.GREENS
    for y in range(H):
        for x in range(W):
            i = tile[y % 32][x % 32]
            col = G[max(0, i - 1)] if noise(x, y, 30, 3) > 0.2 else G[i]
            base.px(x, y, col)
    # the long grass of the lawn, as it is when nobody has mown it (the page lays the real one over it)
    lx0, ly0, lx1, ly1 = LAWN
    tall = S.tall_grass(mc)
    for y in range(ly0, ly1):
        for x in range(lx0, lx1):
            h = hsh(x, y, 801) % 100
            base.px(x, y, tall[0 if h < 12 else 1 if h < 38 else 2 if h < 70 else 3 if h < 92 else 4])
    # the bed of mulch along the fence, its edge a scalloped border of brick
    mulch = [rgb(c) for c in ('#4a2e1e', '#5a3a26', '#6a4430', '#3a2418')]
    for y in range(58, 98):
        for x in range(66, 368):
            if y > 92 + 2 * math.sin(x / 9):
                continue
            base.px(x, y, mulch[hsh(x, y, 810) % 4])
    for x in range(66, 368):
        y = round(93 + 2 * math.sin(x / 9))
        base.px(x, y, rgb('#a8584a') if (x // 4) % 2 else rgb('#8a4a3c')); base.px(x, y + 1, rgb('#6a3428'))
    # the pool deck: pale broom-finished concrete, in slabs
    #    (its right edge runs straight down the patio's left one, an expansion joint between them; past the patio's
    #    corner it is lawn again, so the stone and the concrete meet along one line and nowhere overlap)
    conc = [rgb(c) for c in ('#c9c2b2', '#d4cdbd', '#ddd7c8', '#bdb6a6')]
    dx0, dy0, dx1, dy1 = DECK
    for y in range(dy0, dy1):
        for x in range(dx0, dx1 + 1):
            if y < dy0 + 4 and x < dx0 + 12:
                continue
            k = 1 + (hsh(x, y, 820) % 5 == 0) - (hsh(x, y, 821) % 7 == 0)
            if (x - dx0) % 48 == 0 or (y - dy0) % 44 == 0 or x == dx1:
                k = 3
            base.px(x, y, conc[k])
    # the patio: bluestone pavers in a running bond, by the house
    px0, py0, px1, py1 = PATIO
    stone = [rgb(c) for c in ('#6a7484', '#7a8494', '#8a94a2', '#5a6272', '#848a94')]
    for y in range(py0, py1 + 1):
        for x in range(px0, px1 + 1):
            row = (y - py0) // 14
            off = 9 if row % 2 else 0
            sx, sy = (x - px0 + off) % 18, (y - py0) % 14
            if sx == 0 or sy == 0:
                base.px(x, y, rgb('#4a5060'))
                continue
            k = (row * 7 + (x - px0 + off) // 18) % 5
            col = stone[k]
            if sx == 1 or sy == 1:
                col = tint(col, 0.1)
            elif hsh(x, y, 830) % 9 == 0:
                col = shade(col, 0.06)
            base.px(x, y, col)
    # the path to the mini golf: packed earth from the top of the picture down through the gate, then flagstones set
    # in the grass down to the lawn
    dirt = [rgb(c) for c in ('#8a6a46', '#775a3a', '#a18358')]
    flag = [rgb(c) for c in ('#a8a294', '#b8b2a2', '#948e80', '#c4beae')]
    for y in range(0, 100):
        cx = golf_path_x(y)
        half = 6 + noise(cx, y, 6, 14) * 1.5 if y < 62 else 0
        if y < 62:
            for x in range(int(cx - half) - 1, int(cx + half) + 2):
                if abs(x - cx) < half:
                    h = hsh(x, y, 861) % 20
                    base.px(x, y, dirt[0] if h < 12 else dirt[1] if h < 17 else dirt[2])
    for k, y0 in enumerate(range(64, 98, 9)):                              # the stepping stones
        cx = round(golf_path_x(y0 + 3)) + (2 if k % 2 else -2)
        for y in range(y0, y0 + 6):
            for x in range(cx - 6, cx + 7):
                d = ((x - cx) / 6.5) ** 2 + ((y - y0 - 2.5) / 3.2) ** 2
                if d > 1:
                    continue
                col = flag[hsh(x // 2, y // 2, 862 + k) % 4]
                if d > 0.7 and y >= y0 + 3:
                    col = shade(col, 0.25)                                 # its near edge, in shadow
                elif y == y0 or d > 0.8:
                    col = tint(col, 0.12)
                base.px(x, y, col)
    # leaves lying about in the fall, petals in the spring (on the grass and the long grass of the lawn)
    grass = set(G) | set(tall)
    S.litter(mc, base, lambda x, y: base.get(x, y) in grass)
    # ── over the fence: the neighbours' trees ──
    def plant(kind, x, y, var, over=None):
        t, sh, fine = S.tree(mc, kind, var)
        put(at(t, x, y), over=over, fine=fine and (lambda a: S.lay(mc, a, fine, x - t.w // 2, y - t.h + 1)))
    kinds = ('oak', 'maple', 'pine', 'oak', 'birch', 'maple', 'oak', 'pine')
    for k, x in enumerate(range(-20, 560, 56)):
        tx = x + hsh(k, 1, 840) % 14
        if abs(tx - GOLF_PATH[0]) < 30:
            tx = GOLF_PATH[0] + 34                                          # (the way to the golf is left open)
        plant(kinds[k % 8], tx, 34 + hsh(k, 2, 840) % 8, k + 300)

    # ── the fence: cedar boards along the top and down the left, a rail and the posts showing ──
    cedar = [rgb(c) for c in ('#7a5236', '#8a6040', '#9a6e4a', '#aa7e56', '#b88c62')]

    def fence(c):
        for x in range(0, W):
            if GATE[0] <= x <= GATE[1]:
                continue                                                    # (the gateway to the golf)
            top = 24 + (1 if (x // 6) % 2 else 0)
            k = (x // 6 * 7) % 4 + (1 if x % 6 == 1 else 0) - (1 if x % 6 == 5 else 0)
            for y in range(top, 60):
                col = cedar[max(0, min(4, k))]
                if x % 6 == 0:
                    col = rgb('#4a3020')
                elif hsh(x, y // 3, 850) % 13 == 0:
                    col = shade(col, 0.12)
                c.px(x, y, col)
            c.px(x, top, cedar[4] if x % 6 else rgb('#4a3020'))
        for x in list(range(0, W, 48)) + [GATE[0] - 5, GATE[1] + 1]:
            c.rect(x, 20, x + 4, 60, cedar[1]); c.rect(x, 20, x + 4, 21, cedar[4]); c.rect(x + 4, 22, x + 4, 60, cedar[0])
        # the gate, swung open against the fence to the right of the gateway: its boards seen edge-on, a Z brace
        gx = GATE[1] + 6
        c.rect(gx, 26, gx + 3, 60, cedar[3]); c.rect(gx + 3, 26, gx + 3, 60, cedar[0]); c.rect(gx, 26, gx + 3, 26, cedar[4])
        c.px(gx + 1, 40, rgb('#2a2a30')); c.px(gx + 1, 52, rgb('#2a2a30'))
        for y in range(60, H):                                              # down the left side, its boards end-on
            for x in range(0, 7):
                c.px(x, y, cedar[1 + (x == 5) - (x == 0)] if (y + x) % 7 else cedar[0])
            c.px(7, y, rgb('#4a3020'))
    put(fence)
    for y in range(60, 66):                                                 # the fence's shadow on the grass
        for x in range(0, W):
            if base.get(x, y):
                base.px(x, y, mix(base.get(x, y), (14, 34, 30), 0.34 - (y - 60) * 0.05))
    mc.block(0, 0, W - 1, 62)
    mc.block(0, 0, 8, H - 1)

    # ── the house: its west wall down the right edge, the door in it, the porch light ──
    dark, lit = rgb('#1b1c26'), rgb('#3a3d50')

    def house(c):
        c.rect(W - 8, 0, W - 1, H - 1, dark)
        c.rect(W - 9, 0, W - 9, H - 1, lit)
        c.rect(W - 9, DOOR_Y0, W - 1, DOOR_Y1, rgb('#8a5a3c'))             # the sill, oak, across the wall
        for y in range(DOOR_Y0, DOOR_Y1 + 1):
            if (y - DOOR_Y0) % 6 == 5:
                c.rect(W - 9, y, W - 1, y, rgb('#6a4430'))
        c.rect(W - 10, DOOR_Y0 - 3, W - 1, DOOR_Y0 - 1, rgb('#e9e4d8')); c.rect(W - 10, DOOR_Y1 + 1, W - 1, DOOR_Y1 + 3, rgb('#e9e4d8'))
        c.rect(W - 10, DOOR_Y0 - 1, W - 1, DOOR_Y0 - 1, rgb('#b9b3a3')); c.rect(W - 10, DOOR_Y1 + 3, W - 1, DOOR_Y1 + 3, rgb('#b9b3a3'))
        # the door, open against the wall outside: a white-painted door with a window, a brass knob
        c.part(mc.rows(W - 13, DOOR_Y0 - 30, W - 10, DOOR_Y0 - 4), Mat('#e9e4d8', hi='#ffffff', lo='#b9b3a3'), hi='tl', lo='rb')
        c.rect(W - 12, DOOR_Y0 - 26, W - 11, DOOR_Y0 - 16, rgb('#7aa0c0'))
        c.px(W - 12, DOOR_Y0 - 8, rgb('#e2c36a'))
        # the porch light: a black coach lantern above the door
        c.rect(W - 14, DOOR_Y0 - 16, W - 10, DOOR_Y0 - 9, rgb('#22222a')); c.rect(W - 13, DOOR_Y0 - 15, W - 11, DOOR_Y0 - 11, rgb('#ffe9a8'))
        c.px(W - 12, DOOR_Y0 - 14, rgb('#fffbe8'))
        # a hose reel and the downspout further down
        c.rect(W - 12, 300, W - 10, 324, rgb('#c9c4b8')); c.rect(W - 16, 324, W - 10, 326, rgb('#a9a397'))
        c.part(mc.ellipse(W - 16, 238, 5, 5), Mat('#2a7a3a', hi='#4a9a5a', lo='#1a4a24'), hi='tl', lo='rb')
        for a in range(0, 360, 30):
            c.px(round(W - 16 + 3 * math.cos(math.radians(a))), round(238 + 3 * math.sin(math.radians(a))), rgb('#3aa04a'))
        c.px(W - 16, 238, rgb('#c9ced6'))
    put(house)
    for y in range(0, H):
        for x in range(W - 13, W - 9):
            if not (DOOR_Y0 - 30 <= y <= DOOR_Y1 + 3) and base.get(x, y):
                base.px(x, y, mix(base.get(x, y), (14, 34, 30), 0.3 - 0.07 * (W - 10 - x)))
    mc.block(W - 9, 0, W - 1, H - 1)
    mc.block(W - 13, DOOR_Y0 - 30, W - 10, DOOR_Y0 - 4)
    mc.block(W - 22, 232, W - 10, 244)

    # ── the top left corner: the gateway in the fence and the path up to the mini golf, a signpost beside it (MINI
    #    GOLF, an arrow up the path), the mower kept by it ──
    def golf_sign(c):
        sx, sy = GOLF_PATH[0] + 34, GOLF_PATH[1] + 26
        post = Mat('#6a4a30', hi='#8a6644', lo='#4a3020')
        c.part(mc.rows(sx - 1, sy - 16, sx + 1, sy), post, hi='l', lo='r')
        tw = mc.sign_width('MINI GOLF')
        bx0, bx1 = sx - tw // 2 - 8, sx + tw // 2 + 4
        c.part(mc.rows(bx0, sy - 25, bx1, sy - 15), Mat('#c49a62', hi='#e0bb82', lo='#8a6a3e'), hi='t', lo='rb')
        c.rect(bx0 + 1, sy - 16, bx1 - 1, sy - 16, rgb('#a07c4a'))
        ink = rgb('#3a2414')
        ax = bx0 + 4                                                       # the arrow, up and to the left (up the path)
        for i in range(3):
            c.rect(ax - i, sy - 23 + i, ax + i, sy - 23 + i, ink)
        c.rect(ax, sy - 20, ax, sy - 17, ink)
        mc.sign(c, bx0 + 8, sy - 23, 'MINI GOLF', 1, ink)
    shadow(GOLF_PATH[0] + 36, GOLF_PATH[1] + 27, 7, 1.6, 0.3, seed=2)
    put(golf_sign, over=GOLF_PATH[1] + 26)
    mc.block(GOLF_PATH[0] + 32, GOLF_PATH[1] + 23, GOLF_PATH[0] + 36, GOLF_PATH[1] + 26)
    L['things']['golfPath'] = [GATE[0] - 4, 0, GATE[1] - GATE[0] + 10, GOLF_PATH[1] + 8]
    L['things']['mowerHome'] = [MOWER_HOME[0], MOWER_HOME[1], 'down']

    # ── the bed along the fence: hydrangeas, a young maple, the birdbath, flowers along its front, the flamingo ──
    plant('maple', 214, 90, 401)
    mc.block(208, 84, 220, 90)
    for k, (x, col) in enumerate(((92, '#7a8ae8'), (138, '#f0a0c0'), (176, '#f2efe6'), (262, '#7a8ae8'), (306, '#f0a0c0'), (346, '#b8a0f0'))):
        hy = art.hydrangea(seed=k, colour=col)
        put(at(hy, x, 88))
    bb = art.birdbath()
    stand(bb, 240, 90)
    for x0 in range(70, 362, 40):
        fl = art.flowers(40, seed=x0)
        put(lambda c, fl=fl, x0=x0: c.paste(fl, x0, 84 + round(2 * math.sin(x0 / 9))))
    stand(art.flamingo(), 326, 94, sh=False)
    mc.block(66, 62, 366, 94)

    # ── the patio: a table with four chairs, the smoking table between two more facing the pool, the grill, a
    #    cooler, the radio, potted palms by the house ──
    tx, ty = 446, 128
    tb = art.patio_table()
    shadow(tx + 2, ty + 1, 20, 4, 0.3, seed=11)
    put(at(tb, tx, ty), over=ty)
    mc.block(tx - 18, ty - 14, tx + 18, ty)
    L['things']['candle'] = [tx - tb.w // 2 + tb.flame[0], ty - tb.h + 1 + tb.flame[1]]
    L['things']['patio'] = []
    for cx in (tx - 13, tx + 13):                                           # behind it: chairs facing us
        cy = ty - 22
        put(at(art.patio_chair('front'), cx, cy), over=cy - 1)
        mc.block(cx - 9, cy - 12, cx + 9, cy - 2)
        L['things']['patio'].append(len(L['seats']))
        L['seats'].append(dict(x=cx, y=cy + 1, ax=cx, ay=cy - 20, pose='front', flip=False, hit=[cx - 10, cy - 36, 20, 38]))
    for cx in (tx - 13, tx + 13):                                           # in front: backs to us
        cy = ty + 30
        put(at(art.patio_chair('back'), cx, cy), over=cy + 3)
        shadow(cx + 1, cy + 1, 10, 2, 0.3, seed=cx)
        mc.block(cx - 9, cy - 4, cx + 9, cy)
        L['things']['patio'].append(len(L['seats']))
        L['seats'].append(dict(x=cx, y=cy - 2, ax=cx, ay=cy + 12, pose='back', flip=False, hit=[cx - 10, cy - 38, 20, 40]))
    # the smoking corner, at the patio's bottom left: the table, with room to stand either side of it
    sx, sy = 414, 206
    stt = art.smoke_table()
    shadow(sx + 1, sy + 1, 16, 2, 0.3, seed=12)
    put(at(stt, sx, sy), over=sy)
    mc.block(sx - 16, sy - 6, sx + 16, sy)
    sx0, sy0 = sx - stt.w // 2, sy - stt.h + 1
    tx, ty, tw, th = stt.things['table']
    L['things']['smokeTable'] = [sx0 + tx, sy0 + ty, tw, th]
    L['things']['smokeStand'] = [sx, sy + 8]                         # where to stand to take something off it, below it
    # Two Adirondack chairs stood either side of it until 2026-11-18 (seats 4 and 5). People's saved places name seats
    # by number, so those two numbers are kept, as places to stand at the table (only for whoever was saved there: no
    # hit box, and `only`, so nobody else is put in them), and every seat after them keeps its number.
    for cx, face in ((sx - 26, 'right'), (sx + 26, 'left')):
        cy = sy + 4
        L['things']['patio'].append(len(L['seats']))
        L['seats'].append(dict(x=cx, y=cy, ax=cx, ay=cy, pose='stand', flip=False, face=face, only=True, hit=[cx, cy, 0, 0]))
    # the grill against the house, top right
    gr = art.grill()
    stand(gr, 488, 92)
    # the radio on an upturned crate at the patio's top left corner, and the cooler up beside it to the right (northeast
    # of it), against the fence
    for body, x, y in (('#2f62d8', 410, 80),):
        cl = camp.cooler(body)
        shadow(x + 1, y + 1, 13, 2, 0.32, seed=x)
        put(at(cl, x, y), over=y)
        mc.block(x - 12, y - 10, x + 12, y)
        L['spots'] = [['cooler', x - 14, y - 20, 28, 21]]
    crate = Cv(16, 10)
    crate.part(mc.rows(0, 0, 15, 9), Mat('#b08454', hi='#d0a470', lo='#7a5636'), hi='tl', lo='rb')
    for y in (3, 6):
        crate.rect(1, y, 14, y, rgb('#7a5636'))
    rd = camp.radio()
    rx, ry = 384, 92
    stand(crate, rx, ry)
    put(at(rd, rx, ry - 9), over=ry)
    L['things']['radio'] = [rx - rd.w // 2, ry - 9 - rd.h + 1, rd.w, rd.h]
    for k, (x, y, kind) in enumerate(((500, 74, 'palm'), (500, 192, 'box'), (376, 152, 'palm'))):
        pp = art.potted_plant(seed=k, kind=kind)
        stand(pp, x, y)

    # ── the string lights over the patio: from a post at each of its outside corners to the eaves of the house ──
    lp = camp.light_post(58)
    eyes = []
    for x, y in ((372, 70), (375, 240)):                                   # (the second in the grass below the patio's corner, off the deck)
        shadow(x + 2, y + 1, 4, 1.5, 0.3, seed=x + y)
        put(at(lp, x, y), over=y)
        mc.block(x - 2, y - 2, x + 2, y)
        eyes.append((x - lp.w // 2 + lp.eye[0], y - lp.h + 1 + lp.eye[1]))
    cord = Cv(W, H)
    bulbs = []
    bulbs += camp.bulb_string(cord, eyes[0][0], eyes[0][1], W - 10, 34, 10, every=12)
    bulbs += camp.bulb_string(cord, eyes[1][0], eyes[1][1], W - 10, 120, 14, every=12)
    bulbs += camp.bulb_string(cord, eyes[0][0], eyes[0][1], eyes[1][0], eyes[1][1], 8, every=14)
    for cx0 in range(eyes[0][0] - 2, W, 80):
        cx1 = min(W, cx0 + 80)
        piece = cord.a[0:H, cx0:cx1]
        ys, xs = np.nonzero(piece[..., 3] > 0)
        if not len(ys):
            continue
        y0_, y1_ = int(ys.min()), int(ys.max())
        mc.occluders.append((piece[y0_:y1_ + 1].copy(), dict(x=cx0, y=y0_, w=cx1 - cx0, h=y1_ - y0_ + 1, z=999)))
    for bx, by in bulbs:
        mc.light(bx, by, 14, 10, '#ffd890', 0.14)
    mc.light(W - 12, DOOR_Y0 - 12, 26, 26, '#ffcf80', 0.2)                 # the porch light

    # ── the pool: coping round it, tiles at the waterline, the water deep at the left and shallow at the right, steps
    #    down at the shallow end, a ladder at the deep end, the diving board ──
    ox0, oy0, ox1, oy1 = POOL
    wx0, wy0, wx1, wy1 = WATER
    coping = Mat('#e9e2d0', hi='#fbf6ea', lo='#b9b09a')

    def pool(c):
        c.part(mc.rows(ox0, oy0, ox1, oy1), coping, hi='tl', lo='rb')
        for x in range(ox0, ox1 + 1, 8):
            c.px(x, oy0, coping.lo); c.px(x, oy1, coping.lo)
        for y in range(oy0, oy1 + 1, 8):
            c.px(ox0, y, coping.lo); c.px(ox1, y, coping.lo)
        for y in range(wy0, wy1 + 1):
            for x in range(wx0, wx1 + 1):
                u = (x - wx0) / (wx1 - wx0)                                 # 0 at the deep end, 1 at the shallow
                deep = rgb('#1a6ab8'); shallow = rgb('#5ec8e8')
                col = mix(deep, shallow, min(1, max(0, (u - 0.15) / 0.7)))
                n = noise(x, y, 7, 31) + noise(x * 2, y, 4, 32) * 0.5     # the light on the bottom, in a net of lines
                if abs(n) < 0.06:
                    col = tint(col, 0.35)
                elif abs(n) < 0.12:
                    col = tint(col, 0.15)
                if y < wy0 + 5:                                            # the top wall, seen into: tiles and its shade
                    col = rgb('#1a4a7a') if y < wy0 + 2 and (x // 3 + y) % 2 else rgb('#f2efe6') if y < wy0 + 2 else shade(col, 0.25 - (y - wy0) * 0.04)
                if x < wx0 + 2:
                    col = shade(col, 0.18)
                c.px(x, y, col)
        # the lane line along the bottom, and the drain at the deep end
        for x in range(wx0 + 10, wx1 - 30):
            c.px(x, (wy0 + wy1) // 2, mix(c.get(x, (wy0 + wy1) // 2), rgb('#0e3a6a'), 0.4))
        c.rect(wx0 + 20, (wy0 + wy1) // 2 - 2, wx0 + 24, (wy0 + wy1) // 2 + 2, rgb('#3a5a7a'))
        for k in range(3):                                                  # the steps at the shallow end, white-edged
            x = wx1 - 6 - k * 7
            c.rect(x, wy0 + 8, x, wy1 - 8, rgb('#e8f6fa'))
            c.rect(x + 1, wy0 + 8, x + 6, wy1 - 8, tint(c.get(x + 2, wy0 + 20), 0.12 * (3 - k)))
    put(pool)
    L['things']['pool'] = [wx0, wy0, wx1 - wx0 + 1, wy1 - wy0 + 1]
    lad = art.ladder()
    put(lambda c: c.paste(lad, 160, oy0 - 2))
    db = art.diving_board()
    dbx, dby = 92, 258
    put(lambda c: c.paste(db, dbx, dby))
    mc.block(dbx, dby + 2, dbx + 13, dby + 15)
    # standing on the end of the board, over the water, facing along it: the place to dive from
    tip = (dbx + 40, dby + 10)
    L['things']['board'] = len(L['seats'])
    L['things']['boardAt'] = [dbx, dby - 30, 48, 44]
    L['seats'].append(dict(x=tip[0], y=tip[1], ax=dbx + 16, ay=dby + 9, pose='stand', flip=False, face='right', only=True, hit=[tip[0] - 10, tip[1] - 38, 20, 40]))
    # path lights round the deck
    for x, y in ((100, 206), (100, 324), (360, 324), (230, 324)):
        put(at(art.path_light(), x, y), over=y)
        mc.light(x, y - 8, 16, 10, '#fff2c0', 0.14)
    mc.light((wx0 + wx1) // 2, (wy0 + wy1) // 2, 120, 50, '#3ad0ff', 0.28)  # the pool's own light, underwater
    # the loungers in the bottom left, by the deep end
    for x in (32, 66):
        lg = art.lounger()
        shadow(x + 2, 318, 12, 3, 0.3, seed=x)
        put(at(lg, x, 318), over=318)
        mc.block(x - 11, 274, x + 11, 318)
        L['things']['patio'].append(len(L['seats']))
        # (the seat's y is past the lounger's foot, so whoever lies out is drawn over it, not under it; the page lifts
        # them back up onto it: backyard.tsx LOUNGE_LIFT)
        L['seats'].append(dict(x=x, y=320, ax=x, ay=258, pose='front', flip=False, hit=[x - 11, 262, 22, 56]))
    # a sun umbrella over the loungers' heads, at their top
    um = Cv(56, 40)
    for y, x0, x1 in mc.ellipse(27.5, 12, 27, 11):
        for x in range(x0, x1 + 1):
            a = math.atan2(y - 12, x - 27.5)
            k = int((a + math.pi) / (2 * math.pi) * 8) % 2
            col = rgb('#f2efe6') if k else rgb('#2f9ad8')
            if y > 12 + 6:
                col = shade(col, 0.2)
            um.px(x, y, col)
    um.rect(27, 0, 28, 1, rgb('#d8d0c0'))
    um.rect(27, 22, 28, 39, rgb('#d8d0c0'))
    put(at(um, 49, 272), over=286)

    # ── the waterfall: a heap of boulders on the pool's top edge round a channel. At the top, a little basin of water
    #    held in the rocks spills over a flat stone lip; the sheet falls down a dark wet rock face, between the boulders
    #    either side, into the pool (the page animates the water: the lip, the sheet, the foam and the ripples) ──
    fx0, fy0, fx1, fy1 = FALL
    mid = (fx0 + fx1) // 2
    cx0, cx1 = mid - 8, mid + 8                                             # the channel the sheet falls down
    lip = fy0 + 12                                                          # the stone lip it spills over
    rock = [Mat('#8a857b', hi='#b8b2a6', lo='#5a564e'), Mat('#9a9488', hi='#c4bfb2', lo='#68645a'), Mat('#7a766c', hi='#a8a296', lo='#4a4840')]
    wet = Mat('#4c4a46', hi='#6a6862', lo='#2e2c2a')

    moss = [rgb(c) for c in ('#2c5a26', '#3d7432', '#55903e', '#76ad52')]

    def boulder(c, k, cx, cy, rx, ry):
        c.part(mc.ellipse(cx, cy, rx, ry), rock[k % 3], hi='tl', lo='rb')
        c.px(cx - rx // 2, cy - ry // 2, tint(rock[k % 3].hi, 0.3))
        # moss growing on it: a patchy cushion over its top (where the damp settles), thinning down its sides, and a few
        # dots in the cracks lower down. All of it inside the stone's own outline, a dot or more in from its edge, so
        # it is the rock that shows round it and the moss never hangs off onto the grass or the deck.
        for y, x0, x1 in mc.ellipse(cx, cy, rx, ry):
            for x in range(x0, x1 + 1):
                nx, ny = (x - cx) / rx, (y - cy) / ry
                d = nx * nx + ny * ny
                if d > 0.72:
                    continue                                                # (the rim stays stone)
                cap = -0.15 + 0.32 * noise(x, y, 4, 870 + k) - 0.25 * abs(nx)
                if ny > cap:
                    continue
                edge = cap - ny < 0.16
                if edge and hsh(x, y, 871 + k) % 3:
                    continue                                                # (its lower edge ragged)
                col = moss[1] if not edge else moss[0]
                if ny < cap - 0.3 and nx < 0.25 and hsh(x, y, 872) % 4 == 0:
                    col = moss[3]                                           # lit, on its top towards the left
                elif hsh(x, y, 873 + k) % 5 == 0:
                    col = moss[2]
                elif ny > cap - 0.08:
                    col = moss[0]
                c.px(x, y, col)
        for j in range(3):                                                  # moss in the cracks
            mx, my = cx + hsh(k, j, 860) % rx - rx // 2, cy + ry // 2 - j % 2
            if ((mx - cx) / rx) ** 2 + ((my - cy) / ry) ** 2 <= 0.72:
                c.px(mx, my, moss[2] if j else moss[1])

    def rocks(c):
        boulder(c, 0, mid, fy0 + 5, 17, 7)                                  # the big one at the back, holding the basin
        # the basin: water held in the rocks, darker at its back edge, lit where it runs to the lip
        c.part([(lip - 5, mid - 6, mid + 6), (lip - 4, mid - 8, mid + 8), (lip - 3, mid - 9, mid + 9), (lip - 2, mid - 9, mid + 9)],
               Mat('#3c9cd0', hi='#7ad0ee', lo='#1e6a9e'), hi='b', lo='t')
        for x in range(mid - 6, mid + 7, 3):
            c.px(x, lip - 2, rgb('#a8e4f6'))
        # the rock face behind the sheet: dark and wet, in steps
        c.part(mc.rows(cx0 - 4, lip, cx1 + 4, fy1 - 1), wet, hi='', lo='')
        for y in range(lip + 2, fy1 - 1, 4):
            c.rect(cx0, y, cx1, y, wet.lo)
            c.rect(cx0, y - 1, cx1, y - 1, wet.hi)
        # the lip: a flat slab across the front of the basin, its edge worn smooth
        c.part(mc.rows(cx0 - 2, lip - 1, cx1 + 2, lip), Mat('#6a665e', hi='#8e8a80', lo='#3e3c38'), hi='t', lo='b')
        # the boulders either side of the channel, and the ones down at the water
        for k, (bx, by, rx, ry) in enumerate(((cx0 - 10, lip + 2, 11, 9), (cx1 + 11, lip + 1, 12, 9), (fx0 + 6, fy1 - 10, 7, 6), (fx1 - 4, fy1 - 9, 7, 6),
                                              (fx0 + 9, fy1 - 5, 10, 7), (fx1 - 9, fy1 - 5, 10, 7), (cx0 - 4, fy1 - 4, 5, 4), (cx1 + 4, fy1 - 4, 5, 4))):
            boulder(c, k + 1, bx, by, rx, ry)
    put(rocks, over=fy1 + 2)                                               # (no ferns: they hung off the rocks onto the grass)
    mc.block(fx0 - 2, fy0, fx1 + 2, fy1)
    # the sheet of water, from the lip to the pool, and the basin it comes from (the page animates them)
    L['things']['fall'] = [cx0 + 1, lip - 1, cx1 - cx0 - 1, WATER[1] - lip + 1]
    L['things']['basin'] = [mid, lip - 3, 9, 3]

    # ── the hot tub, by the patio: a cedar surround with a cap, steps up on the left, the water in it lit teal ──
    tx0, ty0, tx1, ty1 = TUB
    ix0, iy0, ix1, iy1 = TUB_IN
    wood = Mat('#9a6040', hi='#c08058', lo='#6a3e26')

    def tub_back(c):
        c.part(mc.rows(tx0, ty0, tx1, ty1), wood, hi='tl', lo='rb')
        for y in range(ty0 + 3, ty1, 4):
            c.rect(tx0 + 1, y, tx1 - 1, y, wood.lo)
        c.part(mc.rows(ix0 - 3, iy0 - 3, ix1 + 3, iy1 + 3), Mat('#c08058', hi='#e0a070', lo='#8a5a3a'), hi='tl', lo='rb')   # the cap
        for y in range(iy0, iy1 + 1):
            for x in range(ix0, ix1 + 1):
                col = mix(rgb('#2aa8b8'), rgb('#7ae0e8'), ((x - ix0) / (ix1 - ix0)) * 0.5 + noise(x, y, 5, 41) * 0.3)
                if y < iy0 + 4:
                    col = shade(rgb('#1a6a7a'), 0.1 * (y - iy0))
                c.px(x, y, col)
        for jx, jy in ((ix0 + 6, iy0 + 6), (ix1 - 6, iy0 + 6), ((ix0 + ix1) // 2, iy0 + 5)):
            c.px(jx, jy, rgb('#e8fbff')); c.px(jx + 1, jy, rgb('#bdf0f8'))
        # the control panel on the cap, top right
        c.rect(ix1 - 6, iy0 - 3, ix1, iy0 - 1, rgb('#22222a')); c.px(ix1 - 4, iy0 - 2, rgb('#3ad0ff')); c.px(ix1 - 2, iy0 - 2, rgb('#ff5a3a'))
        # steps up on the left
        c.part(mc.rows(tx0 - 12, ty0 + 26, tx0 - 1, ty0 + 46), wood, hi='tl', lo='rb')
        c.rect(tx0 - 12, ty0 + 36, tx0 - 1, ty0 + 36, wood.lo)
    put(tub_back, shadow=True)

    def tub_front(c):                                                       # the front of the cap and the cedar below, in front of those sat at the front
        c.part(mc.rows(ix0 - 3, iy1 - 3, ix1 + 3, iy1 + 3), Mat('#c08058', hi='#e0a070', lo='#8a5a3a'), hi='t', lo='b')
        c.part(mc.rows(tx0, iy1 + 4, tx1, ty1), wood, hi='l', lo='rb')
        for y in range(iy1 + 6, ty1, 4):
            c.rect(tx0 + 1, y, tx1 - 1, y, wood.lo)
    put(tub_front, over=ty1 + 1)
    mc.block(tx0 - 2, ty0, tx1 + 2, ty1)
    L['things']['tub'] = [ix0, iy0, ix1 - ix0 + 1, iy1 - iy0 + 1]
    L['things']['tubPanel'] = [ix1 - 10, iy0 - 8, 14, 10]
    L['things']['tubSeats'] = []
    step = (tx0 - 14, ty0 + 36)
    for x, y, pose, flip in (((ix0 + 16, iy0 + 30, 'front', False)), (((ix0 + ix1) // 2, iy0 + 30, 'front', False)), ((ix1 - 16, iy0 + 30, 'front', False)),
                             ((ix0 + 22, iy1 + 2, 'back', False)), ((ix1 - 22, iy1 + 2, 'back', False))):
        L['things']['tubSeats'].append(len(L['seats']))
        L['seats'].append(dict(x=x, y=y, ax=step[0], ay=step[1], pose=pose, flip=flip, hit=[x - 10, y - 30, 20, 32]))
    mc.light((ix0 + ix1) // 2, (iy0 + iy1) // 2, 50, 30, '#5ae0ff', 0.24)

    # ── the hedge along the bottom, in front of anybody at the edge; the gnome by the hot tub ──
    for k, x in enumerate(range(4, 540, 22)):
        if 92 < x < 376:
            continue                                                        # (the pool deck runs to the edge)
        put(at(camp.bush(10 + hsh(k, 1, 870) % 3, seed=80 + k, evergreen=True), x, 340 + hsh(k, 2, 870) % 4), over=400)
    stand(art.gnome(), 380, 300)

    # ── the beer pong table (pong.tsx draws it, and the cups): in the way, so nobody walks through it; its players stand
    #    at its ends, just clear of it ──
    L['things']['pong'] = [PONG[0], PONG[1], PONG_W, PONG_L]
    mc.block(PONG[0] - PONG_W // 2, PONG[1] + 1, PONG[0] + PONG_W // 2, PONG[1] + PONG_L - 1)
    # ── the bocce set on the grass below the lawn (bocce.tsx draws it, with the balls not in play) ──
    L['things']['bocceSet'] = list(BOCCE_SET)
    bx, by, bw, bh = BOCCE_SET
    shadow(bx + bw // 2 + 2, by + bh - 1, bw // 2, 2.5, 0.3, seed=5)
    mc.block(bx + 1, by + bh - 12, bx + bw - 2, by + bh - 2)

    # ── where people stand about when the seats are taken ──
    L['stands'] += [dict(x=386, y=178, face='right'), dict(x=480, y=170, face='left'), dict(x=420, y=236, face='down'),
                    dict(x=200, y=206, face='down'), dict(x=330, y=206, face='down'), dict(x=100, y=240, face='right'),
                    dict(x=440, y=316, face='up'), dict(x=180, y=324, face='up')]

    # ── the mower: its picture, four ways round ──
    EXTRA['mower'] = art.mower_sheet().a
    L['things']['lawn'] = [LAWN[0], LAWN[1], LAWN[2] - LAWN[0], LAWN[3] - LAWN[1], LCELL]
    L['things']['mower'] = dict(w=art.MOW_W, h=art.MOW_H, foot=art.MOW_FOOT)

    # ── the door in the room upstairs: drawn here, laid over that room's west wall by the page (things['door']) ──
    # The room's west wall shows only its top (dark), the oak floor starting at x 6. The opening is cut through it: a
    # casing above and below in the wall's gold trim and bronze (as the east door has), a shadowed jamb, an oak sill over
    # the wall's thickness, and beyond it the yard (doorview.png, dimmed by the page at night).
    d0, d1 = UP_DOOR
    TRIM, FACE = rgb('#fbe59a'), rgb('#8a6420')

    def up_door(c):
        oak = Mat('#8a5a3c', hi='#b07a52', lo='#5f3c27')
        for y0_, y1_ in ((d0 - 3, d0 - 1), (d1 + 1, d1 + 3)):
            c.rect(0, y0_, 9, y1_, FACE)
            c.rect(6, y0_, 9, y1_, TRIM)
        c.rect(0, d0 - 1, 9, d0 - 1, shade(FACE, 0.35))
        c.rect(0, d1 + 1, 9, d1 + 1, tint(FACE, 0.15))
        c.rect(5, d0, 8, d1, oak.base)                                    # the sill
        for y in range(d0, d1 + 1):
            if (y - d0) % 6 == 5:
                c.rect(5, y, 8, y, oak.lo)
        c.rect(8, d0, 8, d1, oak.lo)
        c.rect(4, d0, 4, d1, shade(FACE, 0.55))                            # the jamb

    def up_view(c):                                                         # the yard beyond: pavers and a strip of lawn
        c.rect(0, d0, 3, d1, rgb('#7a8494'))
        for y in range(d0, d1 + 1):
            if (y - d0) % 7 == 0:
                c.rect(0, y, 3, y, rgb('#4a5060'))
        c.rect(0, d0, 0, d1, G[1])
        c.rect(3, d0, 3, d1, rgb('#4a5060'))                                # the wall's shadow falling on it
    up = Cv(W, H)
    up_door(up)
    view = Cv(W, H)
    up_view(view)
    both = np.maximum(up.a[..., 3], view.a[..., 3])
    ys, xs = np.nonzero(both)
    x0, y0, x1, y1 = int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())
    EXTRA['door'] = up.a[y0:y1 + 1, x0:x1 + 1].copy()
    EXTRA['doorview'] = view.a[y0:y1 + 1, x0:x1 + 1].copy()
    L['things']['door'] = dict(at=[x0, y0, x1 - x0 + 1, y1 - y0 + 1], hit=[0, d0 - 6, 22, d1 - d0 + 12], foot=dict(x=16, y=(d0 + d1) // 2),
                               sun=[9, d0 - 2, 34, d1 - d0 + 5], side='west', say='Go out to the backyard')
    L['things']['bg'] = 'var(--yard-bg, #1d4a24)'
    S.end(mc)
