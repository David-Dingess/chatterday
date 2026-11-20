"""Outside: not a basement at all, but the woods out past the house's east wall, through the door on the right of the room
upstairs. A campsite in a clearing: a campfire in a ring of stones with logs, stumps and the white Adirondack chairs from
the yard round it, two tents, sleeping bags, a cooler or two, a woodpile with an axe in the chopping block, a camp table
with the marshmallows and a lantern on it, and trees all round. The house's wall runs down the left edge with the door in
it: that is the way back in (this fit-out's EXIT, which the page treats as its stairs).

Drawn with the yard's own tools from scripts/make-clubhouse.py (its grass, trees, stumps, chairs and fire), at the same
scale as the room. The fire itself is not in the picture: it burns, dies down and goes out (server/basement/outside.ts),
so the page draws it from fire.png (flames at three sizes, and embers) and logs.png (none to five logs in the ring).
door.png is the door in the room upstairs, laid over the room's east wall where things['door'] says, and doorview.png the
grass seen through it (dimmed by the page at night).

SHELL = False tells scripts/make-basement.py to skip the basement's walls, stairs and concrete."""
import math

import numpy as np

TITLE = 'Outside'
BLURB = 'The campfire, out past the east door'
ORDER = 999
SHELL = False
VIGNETTE = 0.16
GROUND = (16, 86, 472, 306)                      # where feet may go: x0, y0, x1, y1 (the woods all round)
FIRE = (272, 198)                                # the middle of the fire's bed
DOOR_Y0, DOOR_Y1 = 164, 190                      # the doorway in the house's wall, down the left edge
EXIT = dict(rect=[0, 154, 28, 44], foot=dict(x=36, y=178), face='left')
UP_DOOR = (197, 217)                             # the same doorway in the room upstairs, in its east wall (rows): below the theatre's rug, above the lamp by the sofa
POSTS = ((138, 128), (402, 130))                # the cedar posts the string of bulbs hangs from (their feet)
TELESCOPE = (278, 114)                           # the telescope's tripod (its feet)
LAKE_PATH = (296, 96)                            # where the path down to the lake leaves the clearing, behind the telescope
                                                 # (scripts/basement/lake.py: things['back']['foot'] is this point)
SEASONS = ('spring', 'fall', 'winter', 'snow')  # drawn once a season as well (scripts/basement/_seasons.py; summer is base.png)
SEASONAL_EXTRA = ('doorview',)                   # (the strip of grass seen through the door upstairs goes with them)


def lake_path_x(y):
    """The path to the lake's middle, at row y: it wanders a little as it goes up into the trees."""
    return LAKE_PATH[0] + 5 * math.sin(y / 14.0) - (LAKE_PATH[1] - y) * 0.08
RADIO = (202, 212)                               # the radio, left of the stump west of the fire
CH_LEFT, CH_RIGHT, CH_Y = (26, 58), (274, 306), 288   # cornhole: each board's x from end to end, and the line down their middles
FW, FH = 34, 44                                  # one cell of fire.png
LW, LH = 40, 20                                  # one cell of logs.png
EXTRA = {}

# the campsite's kit, drawn in a file of its own (scripts/basement/_camp_art.py: the underscore keeps it off the list of fit-outs)
import importlib.util as _iu
import os as _os
_s = _iu.spec_from_file_location('camp_art', _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), '_camp_art.py'))
art = _iu.module_from_spec(_s)
_s.loader.exec_module(art)


def fire_sheet(mc):
    """The campfire's flames: rows big, middling and small, four frames each, then a row of embers (no flames, the coals
    glowing and going dull in turn). Each cell FW x FH, its bed on the bottom row, in the middle. Drawn as the yard's fire
    pit's fire is (make-clubhouse.py fire_frames), at three sizes."""
    rgb, Cv = mc.rgb, mc.Cv
    c = Cv(FW * 4, FH * 4)
    cols = [rgb(x) for x in ('#d83a1c', '#f2701e', '#ffb22e', '#ffe46a', '#fff6c8')]
    for row, k in enumerate((1.45, 1.0, 0.6)):
        for f in range(4):
            ox, oy = f * FW + FW // 2, row * FH
            tongues = ((0, (21 + (f * 3) % 5) * k, 6.0 * min(1.25, k)), (-4 * k, (13 + (f * 5 + 2) % 6) * k, 3.6 * min(1.2, k)),
                       (4 * k, (14 + (f * 7 + 1) % 6) * k, 3.8 * min(1.2, k)))
            if k > 1:
                tongues += ((-8, 10 + f % 3 * 2, 2.6), (8, 9 + (f + 1) % 3 * 2, 2.6))
            depth = {}
            for dx, tall, wide in tongues:
                for j in range(int(tall)):
                    t = j / tall
                    half = wide * (1 - t ** 1.4)
                    sway = math.sin(j / 3.2 + f * 1.7 + dx) * (1.6 * t)
                    for i in range(int(round(-half * 2)), int(round(half * 2)) + 1):
                        x, y = dx + sway + i / 2, FH - 3 - j
                        inner = (1 - abs(i / 2) / max(0.6, half)) * (1 - t * 0.85)
                        key = (int(round(x)), y)
                        depth[key] = max(depth.get(key, 0), inner)
            for (x, y), v in depth.items():
                if 0 <= y < FH and abs(x) < FW // 2:
                    c.px(ox + x, oy + y, cols[4] if v > 0.82 else cols[3] if v > 0.62 else cols[2] if v > 0.4 else cols[1] if v > 0.18 else cols[0])
            for s in range(2 + row % 2):                                          # sparks
                c.px(ox - 6 + (f * 3 + s * 5) % 13, oy + 1 + int((f * 5 + s * 3) % 9 * (1 + (2 - row) * 0.6)), cols[2 + s % 2])
            for i in range(-int(7 * k), int(7 * k) + 1):                          # the glowing bed
                c.px(ox + i, oy + FH - 2, cols[1] if (i + f) % 3 else cols[3])
                if abs(i) < 6 * k:
                    c.px(ox + i, oy + FH - 1, cols[0])
    for f in range(4):                                                            # embers: coals, glowing in turn
        ox, oy = f * FW + FW // 2, 3 * FH
        for i in range(-9, 10):
            for j in range(3):
                if abs(i) > 9 - j * 2:
                    continue
                h = mc.hsh(i + 20, j, f + 400) % 10
                col = rgb('#2a2220') if h < 4 else rgb('#7a1e10') if h < 6 else rgb('#d8461c') if h < 8 else rgb('#ff9a3a')
                c.px(ox + i, oy + FH - 1 - j, col)
    return c.a


TW, TH = 16, 9                                   # the log thrown on the fire (toss.png)


def toss_log(mc):
    """The log somebody throws on the fire, for the page to tumble through the air: a split length of pine, its bark in
    ridges, lit along the top and dark underneath, a knot, and the pale cut end on the right showing its rings."""
    rgb, Cv, Mat = mc.rgb, mc.Cv, mc.Mat
    c = Cv(TW, TH)
    bark = Mat('#6a4a30', hi='#9a7448', lo='#3a2418')
    c.part(mc.rows(1, 2, 12, 6) + [(1, 2, 11), (7, 2, 11)], bark, hi='t', lo='b')
    for x in range(2, 12):
        if mc.hsh(x, 1, 500) % 3 == 0:
            c.px(x, 4, bark.lo)                                            # ridges in the bark
        if mc.hsh(x, 2, 500) % 4 == 0:
            c.px(x, 3, rgb('#7d5c3c'))
    c.rect(5, 5, 6, 5, rgb('#2a1a10')); c.px(5, 4, rgb('#4a3020'))         # a knot
    c.part(mc.ellipse(13, 4, 2.4, 3.2), Mat('#d9b98a', hi='#ecd3a8', lo='#b08e5e'), hi='tl', lo='rb')   # the cut end
    c.px(13, 4, rgb('#9a7a50')); c.px(13, 2, rgb('#c4a070')); c.px(12, 5, rgb('#c4a070')); c.px(14, 6, rgb('#c4a070'))   # its rings
    return mc.outline(np.pad(c.a, ((1, 1), (1, 1), (0, 0))))[1:-1, 1:-1]


def logs_sheet(mc):
    """The wood in the ring: cell n has n logs (none to five), split pine leaned together and crossed, the bark dark, the
    cut ends pale, the ends that have burnt black. Cell 0 is cold ash with two charred stubs in it."""
    rgb, Cv, Mat = mc.rgb, mc.Cv, mc.Mat
    c = Cv(LW * 6, LH)
    bark = [rgb('#3a2418'), rgb('#5a3a24'), rgb('#7d5c3c')]
    char = [rgb('#1d1a18'), rgb('#2a2622'), rgb('#3a3632')]
    # each log: from (x0, y0) to (x1, y1), in cell dots
    lay = [(6, 15, 33, 11), (8, 9, 32, 16), (12, 17, 28, 7), (4, 12, 24, 15), (16, 8, 36, 14)]

    def log(ox, x0, y0, x1, y1, burnt):
        n = max(abs(x1 - x0), abs(y1 - y0))
        for s in range(n + 1):
            t = s / n
            x, y = round(x0 + (x1 - x0) * t), round(y0 + (y1 - y0) * t)
            end = t < 0.12 or t > 0.88
            for w in range(3):
                col = (char if burnt or end else bark)[min(2, 2 - w)]
                c.px(ox + x, y + w - 1, col)
            if not burnt and hsh(s, x0, 3) % 5 == 0:
                c.px(ox + x, y, rgb('#2a1a10'))                              # a crack in the bark
        for (x, y) in ((x0, y0), (x1, y1)):
            if not burnt:
                c.px(ox + x, y, rgb('#d9b98a')); c.px(ox + x, y - 1, rgb('#ecd3a8'))   # the pale cut end
    hsh = mc.hsh
    for n in range(6):
        ox = n * LW
        if n == 0:
            log(ox, 9, 14, 18, 12, True)
            log(ox, 24, 15, 31, 13, True)
            continue
        for k in range(n):
            log(ox, *lay[k], False)
    return c.a


def draw(mc, L):
    rgb, mix, shade, tint, Mat, Cv, base = mc.rgb, mc.mix, mc.shade, mc.tint, mc.Mat, mc.Cv, mc.base
    W, H, hsh, noise = mc.W, mc.H, mc.hsh, mc.noise
    L['outdoors'] = True
    L['view'] = [0, 0, W, H]
    fx, fy = FIRE
    art.setup(mc)
    S = art.S                                                              # what the season does to it (_seasons.py)
    S.begin(mc)
    snowy = S.season(mc) == 'snow'

    def contact(cv, ox, oy):
        """A soft contact shadow round something lying flat (cv, its top-left corner at ox, oy): a dot or two all round
        its outline, heavier on the side away from the light (right and below), none cast beyond."""
        m = cv.a[..., 3] > 0
        hh, ww = m.shape
        for y in range(-3, hh + 3):
            for x in range(-3, ww + 3):
                if 0 <= y < hh and 0 <= x < ww and m[y, x]:
                    continue
                near = lambda dx, dy: 0 <= y + dy < hh and 0 <= x + dx < ww and m[y + dy, x + dx]
                k = 0.0
                if near(-1, 0) or near(0, -1) or near(-1, -1):
                    k = 0.34                                               # just right of it, or below: in its shade
                elif near(1, 0) or near(0, 1):
                    k = 0.16                                               # the lit side: barely
                elif near(-2, 0) or near(0, -2) or near(-2, -2) or near(-1, -2) or near(-2, -1):
                    k = 0.14 if (x + y) % 2 else 0.1                        # soft, dithered, one more dot out
                if k and base.get(ox + x, oy + y):
                    base.px(ox + x, oy + y, mix(base.get(ox + x, oy + y), (14, 20, 40), k))

    def edge(x, y):
        """How far out from the middle of the clearing a dot is: under 1 in the clearing, 1 at the woods' edge, more in
        the woods (a squarish oval: the house's wall on the left, the trees on the other three sides)."""
        dx = (x - 250) / (250 if x < 250 else 215)
        dy = (y - 200) / (118 if y < 200 else 112)
        return (dx ** 4 + dy ** 4) ** 0.25

    # ── the ground: the yard's lawn, gone long and shaggy; forest floor under the trees; a clearing trodden bare ──
    tile = mc.grass_tile()
    G = mc.GREENS
    dirt = [rgb('#8a6a46'), rgb('#775a3a'), rgb('#a18358'), rgb('#6a5034')]
    needles = [rgb('#5a4a2e'), rgb('#4a3c26'), rgb('#6e5a36'), rgb('#3c3220')]
    for y in range(H):
        for x in range(W):
            i = tile[y % 32][x % 32]
            n = noise(x, y, 40, 7)
            if n > 0.3 and i == 2 and (x * 3 + y) % 4 < 2:
                i = 1
            col = G[i]
            if n < -0.45 and i >= 2 and (x + y * 3) % 5 < 2:
                col = mc.DRY
            # the forest floor: needles and leaf litter along the top, and in the corners
            wood = (78 - y) / 26 + noise(x, y, 18, 9) * 0.5
            if x > W - 40:
                wood = max(wood, (x - (W - 40)) / 30 + noise(x, y, 18, 10) * 0.4)
            if wood > 0.55 or (wood > 0.25 and hsh(x, y, 70) % 3 == 0):
                col = needles[hsh(x, y // 2, 71) % 4]
            # the clearing round the fire, worn to earth near it, patchy further out
            d = ((x - fx) / 112) ** 2 + ((y - fy - 4) / 64) ** 2 + noise(x, y, 12, 11) * 0.25
            if d < 0.55 or (d < 0.9 and hsh(x, y, 72) % 100 < (0.9 - d) * 230):
                h = hsh(x, y, 73) % 20
                col = dirt[0] if h < 11 else dirt[1] if h < 15 else dirt[2] if h < 18 else dirt[3]
                if hsh(x, y, 74) % 37 == 0:
                    col = rgb('#b9ae98')                                       # a pebble
            # the track from the door to the fire
            ty = 178 + 6 * math.sin(x / 40.0)
            if 10 < x < fx - 60 and abs(y - ty) < 5 + noise(x, y, 7, 12) * 2.5:
                h = hsh(x, y, 75) % 20
                col = dirt[0] if h < 12 else dirt[1] if h < 17 else dirt[2]
            # the path to the lake: from behind the telescope up into the woods, narrowing as it goes
            if y < LAKE_PATH[1] + 6 and abs(x - lake_path_x(y)) < 3 + y / 22 + noise(x, y, 6, 13) * 1.5:
                h = hsh(x, y, 76) % 20
                col = dirt[0] if h < 12 else dirt[1] if h < 17 else dirt[2]
            base.px(x, y, col)
    # leaves lying about in the fall, petals in the spring (on the grass)
    grass = set(G) | {mc.DRY}
    S.litter(mc, base, lambda x, y: base.get(x, y) in grass, seed=3)

    def put(draw, over=None, shadow=False, fine=None, snow=True):
        """mc.put / mc.put_over, for a scene with no walls: what runs off one edge must not have its outline come back in
        at the other (the outline is rolled round), so it is outlined on a canvas one dot bigger all round. Under snow,
        snow lies along its tops; `fine` (a bare tree's twigs) is laid on after the outline."""
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
        """A drawing for put: the canvas cv stood with the middle of its bottom row at (x, y)."""
        return lambda c: c.paste(cv, x - cv.w // 2, y - cv.h + 1)

    def shadow(cx, cy, rx, ry, k=0.32, seed=1):
        for y in range(int(cy - ry), int(cy + ry) + 1):
            for x in range(int(cx - rx), int(cx + rx) + 1):
                d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 + noise(x, y, 9, seed) * 0.25
                if d <= 1 and (d < 0.74 or (x + y) % 2 == 0) and 0 <= x < W and 0 <= y < H and base.get(x, y):
                    base.px(x, y, mix(base.get(x, y), (14, 34, 30), k))

    # ── the woods all round: three rows of trees along the top, overlapping, the furthest the darkest (deep(), at the
    #    end); trees down the right; undergrowth, ferns and long grass between them, thinning out into the clearing;
    #    bushes and ferns along the bottom. The clearing reads as cut out of the forest. ──
    def plant(kind, x, y, var, over=None):
        t, sh, fine = S.tree(mc, kind, var)
        shadow(x + 6, y + 2, sh * 0.8, sh * 0.3, 0.4 if fine is None else 0.2, seed=var)      # (a bare tree's shade is thin)
        put(at(t, x, y), over=over, fine=fine and (lambda a: S.lay(mc, a, fine, x - t.w // 2, y - t.h + 1)))
    kinds = ('pine', 'oak', 'pine', 'maple', 'pine', 'oak', 'pine', 'maple')
    for k, x in enumerate(range(-14, 560, 30)):                           # the far row: their trunks and lower boughs
        plant(kinds[k % 8], x, 20 + hsh(k, 1, 400) % 12, k + 40)
    on_path = lambda x, w: abs(x - LAKE_PATH[0]) < w                       # (the way to the lake is left open)
    for k, x in enumerate(range(2, 548, 38)):                              # the middle row
        if on_path(x + hsh(k, 2, 400) % 9, 22):
            continue
        plant(kinds[(k + 3) % 8], x + hsh(k, 2, 400) % 9, 44 + hsh(k, 3, 400) % 14, k + 70)
    for k in range(26):                                                    # undergrowth along the foot of the trees
        x = 6 + k * 21 + hsh(k, 4, 400) % 9
        if on_path(x, 16):
            continue
        put(at(art.bush(7 + hsh(k, 5, 400) % 5, seed=k), x, 70 + hsh(k, 6, 400) % 8))
    for k, x in enumerate(range(26, 520, 64)):                             # the near row: saplings and young birches at the edge
        kind = ('birch', 'dogwood', 'pine', 'birch', 'maple', 'dogwood', 'birch', 'pine')[k % 8]
        if on_path(x + hsh(k, 7, 400) % 17, 24):
            continue
        plant(kind, x + hsh(k, 7, 400) % 17, 76 + hsh(k, 8, 400) % 6, k + 100)
    # a signpost where the path goes into the trees: LAKE on a board, an arrow pointing up the path
    def lake_sign(c):
        sx, sy = LAKE_PATH[0] + 14, LAKE_PATH[1] - 2
        post = Mat('#6a4a30', hi='#8a6644', lo='#4a3020')
        c.part(mc.rows(sx - 1, sy - 16, sx + 1, sy), post, hi='l', lo='r')
        # (the board is wide enough for the word and the arrow side by side: the arrow used to sit on the E)
        c.part(mc.rows(sx - 16, sy - 25, sx + 16, sy - 15), Mat('#c49a62', hi='#e0bb82', lo='#8a6a3e'), hi='t', lo='rb')
        c.rect(sx - 15, sy - 16, sx + 15, sy - 16, rgb('#a07c4a'))           # its bottom edge, in shadow
        ink = rgb('#3a2414')
        mc.sign(c, sx - 13, sy - 23, 'LAKE', 1, ink)
        ax = sx + 13                                                       # the arrow, up the path
        for i in range(3):
            c.rect(ax - i, sy - 23 + i, ax + i, sy - 23 + i, ink)
        c.rect(ax, sy - 20, ax, sy - 17, ink)
    put(lake_sign, over=LAKE_PATH[1] - 2)
    # down the right: two staggered columns, the inner one clear of the sleeping bags' tarp
    right = [(530, 96, 'pine'), (508, 120, 'pine'), (532, 168, 'pine'), (514, 214, 'pine'), (534, 252, 'pine'), (500, 262, 'pine'),
             (528, 296, 'pine'), (504, 318, 'pine'), (520, 340, 'pine')]
    for k, (x, y, kind) in enumerate(right):
        plant(kind, x, y, k + 130, over=y)
        mc.block(x - 4, y - 4, x + 4, y)
    for k, (x, y) in enumerate(((488, 150), (500, 236), (486, 290), (478, 330), (506, 194))):
        put(at(art.bush(8 + k % 3, seed=40 + k), x, y), over=y)
    # along the bottom: bushes and ferns, and a young tree in each corner, in front of anybody near the edge
    for k, x in enumerate(range(20, 520, 26)):
        y = 330 + hsh(k, 9, 400) % 6
        if k % 3 == 0:
            put(at(art.bush(9 + hsh(k, 10, 400) % 4, seed=60 + k), x, y), over=400)
        else:
            put(at(art.fern(1.0 + (hsh(k, 11, 400) % 3) * 0.12, seed=k), x, y), over=400)
    plant('birch', 338, 346, 150, over=400)
    plant('pine', 470, 352, 151, over=400)
    # ferns among the trees, and at the corners of the clearing
    for k, (x, y) in enumerate(((22, 94), (60, 88), (176, 84), (232, 90), (322, 92), (356, 92), (418, 80), (474, 90), (484, 130),
                                (490, 210), (476, 270), (100, 322), (136, 322), (444, 312), (22, 230))):
        put(at(art.fern(0.9 + (k % 3) * 0.12, seed=k + 20), x, y))
    # long grass: thick at the woods' edge, thinning into the clearing
    for k in range(1600):
        x, y = hsh(k, 1, 410) % W, 60 + hsh(k, 2, 410) % (H - 56)
        e = edge(x, y)
        if e < 0.62 or hsh(k, 3, 410) % 100 > (e - 0.62) * 260:
            continue
        if y < LAKE_PATH[1] + 10 and abs(x - lake_path_x(y)) < 10:
            continue                                                       # (none on the path to the lake)
        if snowy and k % 3:
            continue                                                       # (under snow only the tallest show)
        tuft = art.grass_tuft(k, tall=7 + hsh(k, 4, 410) % 7)
        base.paste(tuft, x - 6, y - tuft.h + 1)
    rock = Cv(14, 8)
    rock.part(mc.ellipse(6.5, 4.5, 6.5, 3.5), Mat('#9a978e', hi='#c4c0b6', lo='#68655e'), hi='tl', lo='rb')
    rock.px(4, 3, rgb('#d8d4ca')); rock.px(9, 5, rgb('#6a8a4a')); rock.px(10, 5, rgb('#6a8a4a'))    # lichen
    for x, y in ((186, 100), (452, 220), (196, 322), (360, 300)):
        put(at(rock, x, y))
    # ── the house: its east wall down the left edge, with the door in it, a stoop and the porch light ──
    dark, lit = rgb('#1b1c26'), rgb('#3a3d50')

    def house(c):
        c.rect(0, 0, 7, H - 1, dark)
        c.rect(8, 0, 8, H - 1, lit)                                        # the top of the wall catches the light
        c.rect(0, DOOR_Y0, 8, DOOR_Y1, rgb('#8a5a3c'))                     # the sill, oak, across the wall
        for y in range(DOOR_Y0, DOOR_Y1 + 1):
            for x in range(0, 9):
                if (y - DOOR_Y0) % 6 == 5:
                    c.px(x, y, rgb('#6a4430'))
                elif x == 0:
                    c.px(x, y, rgb('#4a3020'))
        c.rect(0, DOOR_Y0 - 3, 9, DOOR_Y0 - 1, rgb('#e9e4d8')); c.rect(0, DOOR_Y1 + 1, 9, DOOR_Y1 + 3, rgb('#e9e4d8'))   # the white door frame
        c.rect(0, DOOR_Y0 - 1, 9, DOOR_Y0 - 1, rgb('#b9b3a3')); c.rect(0, DOOR_Y1 + 3, 9, DOOR_Y1 + 3, rgb('#b9b3a3'))
        # the door, open against the wall outside, painted a deep green with a brass knob
        c.part(mc.rows(9, DOOR_Y0 - 30, 12, DOOR_Y0 - 4), Mat('#2f5a44', hi='#4a7a5e', lo='#1d3a2c'), hi='tl', lo='rb')
        c.px(11, DOOR_Y0 - 8, rgb('#e2c36a'))
        # the stoop: boards of decking carrying straight on from the sill's (the same width and the same seams, so the
        # floor runs out through the doorway unbroken), and a step down
        deck = Mat('#a37747', hi='#c79a66', lo='#6f4d2c')
        c.part(mc.rows(9, DOOR_Y0, 24, DOOR_Y1), deck, hi='t', lo='rb')
        for y in range(DOOR_Y0 + 5, DOOR_Y1 + 1, 6):
            c.rect(9, y, 24, y, deck.lo)
        c.part(mc.rows(25, DOOR_Y0 + 2, 28, DOOR_Y1 - 2), Mat('#8a6440', hi='#b08454', lo='#5f4026'), hi='t', lo='rb')
        # the porch light on the wall above the door: a black lantern
        c.rect(9, DOOR_Y0 - 16, 13, DOOR_Y0 - 9, rgb('#22222a')); c.rect(10, DOOR_Y0 - 15, 12, DOOR_Y0 - 11, rgb('#ffe9a8'))
        c.px(11, DOOR_Y0 - 14, rgb('#fffbe8'))
        # a downspout further along, and its splash block
        c.rect(9, 280, 11, 300, rgb('#c9c4b8')); c.rect(9, 300, 15, 302, rgb('#a9a397'))
    put(house, shadow=False)
    for y in range(0, H):                                                  # the house's shadow on the ground beside it
        for x in range(9, 13):
            if not (DOOR_Y0 - 30 <= y <= DOOR_Y1 + 3 and x < 29):
                base.px(x, y, mix(base.get(x, y), (14, 34, 30), 0.3 - 0.07 * (x - 9)))
    mc.block(0, 0, 8, H - 1)
    mc.block(9, DOOR_Y0 - 30, 12, DOOR_Y0 - 4)
    L['things']['porch'] = [11, DOOR_Y0 - 12]

    # ── the fire ring: stones round a bed of ash (the wood and the fire are the page's: logs.png, fire.png) ──
    def ring(c):
        cx, rx, ry = fx + 0.5, 22, 11
        side, rim = [rgb(x) for x in ('#6f6a62', '#8a857b', '#a39e93')], [rgb(x) for x in ('#a39e93', '#bdb8ad', '#d6d2c8')]
        for y, x0, x1 in mc.ellipse(cx, fy + 4, rx, ry):                   # the wall of the ring
            for x in range(x0, x1 + 1):
                c.px(x, y, side[(x // 5 + (x // 5) % 2) % 2] if x % 5 else side[0])
        for y, x0, x1 in mc.ellipse(cx, fy, rx, ry):                       # the tops of the stones
            for x in range(x0, x1 + 1):
                a = math.atan2((y - fy) / ry, (x - cx) / rx)
                k = int((a + math.pi) / (2 * math.pi) * 18)
                edge = abs(((a + math.pi) / (2 * math.pi) * 18) % 1 - 0.5) > 0.42
                c.px(x, y, rim[0] if edge else rim[1 + k % 2])
        for y, x0, x1 in mc.ellipse(cx, fy, rx - 6, ry - 4.5):             # the ash inside, scorched
            for x in range(x0, x1 + 1):
                c.px(x, y, rgb('#2e2a28') if hsh(x, y, 200) % 4 else rgb('#55504a'))
    shadow(fx + 2, fy + 10, 28, 6, 0.3, seed=5)
    put(ring)
    for y in range(fy - 40, fy + 40):                                       # the ground round it scorched and trodden
        for x in range(fx - 46, fx + 47):
            d = ((x - fx) / 46) ** 2 + ((y - fy) / 26) ** 2
            if 0.5 < d < 1 and hsh(x, y, 210) % 3 == 0 and base.get(x, y) in [tuple(int(v) for v in q) for q in dirt]:
                base.px(x, y, shade(base.get(x, y), 0.12))
    mc.block(fx - 22, fy - 10, fx + 22, fy + 10)
    L['things']['fire'] = [fx, fy]
    L['things']['firebox'] = [fx - 24, fy - 30, 49, 46]                     # a click here is on the fire
    L['things']['ring'] = []                                                # the seats round it (the rest are not by the fire)

    ring_seat = lambda: L['things']['ring'].append(len(L['seats']))

    # ── round it: a log behind the fire and one in front, a stump each side, and the yard's Adirondack chairs ──
    log_mat = Mat('#6a4a30', hi='#8a6644', lo='#4a3020')

    def long_log(c, x0, x1, y, end_left=True):
        """A felled log lying across: bark in ridges along it, the cut end showing its rings."""
        c.part(mc.rows(x0, y, x1, y + 8), log_mat, hi='t', lo='b')
        for x in range(x0 + 2, x1 - 1):
            for yy in (y + 2, y + 5):
                if hsh(x // 3, yy, 220) % 3 == 0:
                    c.px(x, yy, log_mat.lo)
            if hsh(x, y, 221) % 11 == 0:
                c.px(x, y + 1, rgb('#9a7a50'))
        ex = x0 if end_left else x1
        c.part(mc.ellipse(ex, y + 4, 3, 4.5), Mat('#d9b98a', hi='#ecd3a8', lo='#b08e5e'), hi='t', lo='b')
        c.px(ex, y + 4, rgb('#9a7a50')); c.px(ex, y + 2, rgb('#b08e5e')); c.px(ex, y + 6, rgb('#b08e5e'))
        c.px(x0 + 12, y - 1, rgb('#3f8a3c')); c.px(x0 + 13, y - 2, rgb('#5dae4f')); c.px(x1 - 9, y - 1, rgb('#5dae4f'))   # moss

    # One ring round the pit, every seat as close as sitting allows (a stick reaches the flames from each), none on top
    # of another: the two Adirondack chairs facing us behind the fire, a stump each side, a log in front with two on it
    # (backs to us), and the other two chairs in front at the corners (backs to us). Seats 0-7, in that order.
    stump = Cv(16, 13)
    stump.part(mc.rows(0, 4, 15, 12), log_mat, hi='l', lo='rb')
    for x in (3, 7, 11, 13):
        stump.rect(x, 7, x, 11, rgb('#4a3020'))
    stump.part(mc.ellipse(7.5, 4, 7.5, 3.4), Mat('#d9b98a', hi='#ecd3a8', lo='#b08e5e'), hi='t', lo='b')
    stump.rect(5, 4, 10, 4, rgb('#b08e5e')); stump.px(7, 3, rgb('#b08e5e')); stump.px(8, 5, rgb('#9a7a50'))
    for cx in (fx - 20, fx + 20):                                           # behind: chairs facing us
        cy = 176
        put(at(art.adirondack('front'), cx, cy + 1), shadow=True)
        mc.block(cx - 16, cy - 26, cx + 16, cy - 4)
        ring_seat()
        L['seats'].append(dict(x=cx, y=cy, ax=cx, ay=cy - 38, pose='front', flip=False, hit=[cx - 14, cy - 38, 28, 40]))
    for sx, faces_right in ((fx - 46, True), (fx + 46, False)):             # the sides: stumps, sat on side on
        sy2 = 206
        put(at(stump, sx + (2 if faces_right else -2), sy2 - 1), shadow=True)
        mc.block(sx - 6, sy2 - 10, sx + 6, sy2 - 2)
        ring_seat()
        L['seats'].append(dict(x=sx, y=sy2, ax=sx + (-16 if faces_right else 16), ay=sy2 + 2, pose='side', flip=faces_right, hit=[sx - 12, sy2 - 36, 24, 40]))
    sy = 238                                                                # in front: the log, two on it, in front of their legs
    put(lambda c: long_log(c, fx - 27, fx + 27, sy - 6, end_left=False), over=sy + 3)
    shadow(fx, sy + 4, 29, 3, 0.3, seed=6)
    mc.block(fx - 27, sy - 6, fx + 27, sy + 2)
    for dx in (-14, 14):
        ring_seat()
        L['seats'].append(dict(x=fx + dx, y=sy, ax=fx + dx, ay=sy - 16, pose='back', flip=False, hit=[fx + dx - 11, sy - 40, 22, 44]))
    for cx in (fx - 50, fx + 50):                                           # the front corners: chairs, backs to us
        cy = 240
        put(at(art.adirondack('back'), cx, cy + 2), over=cy + 3)
        shadow(cx + 1, cy + 3, 15, 3, 0.3, seed=7)
        mc.block(cx - 16, cy - 20, cx + 16, cy + 2)
        ring_seat()
        L['seats'].append(dict(x=cx, y=cy, ax=cx + (-6 if cx < fx else 6), ay=cy - 28, pose='back', flip=False, hit=[cx - 14, cy - 42, 28, 46]))

    # ── the woodpile, west of the fire, under its tarp, with the chopping block ──
    wp = art.woodpile()
    wx, wy = 145, 248                                                      # the middle of its foot
    shadow(wx - 6, wy - 1, 44, 4, 0.32, seed=8)
    put(at(wp, wx, wy), over=wy - 2)
    x0, y0 = wx - wp.w // 2, wy - wp.h + 1
    mc.block(x0 + 2, wy - 12, x0 + 78, wy - 2)
    L['things']['woodpile'] = [x0, y0, wp.w, wp.h]
    L['things']['woodFrom'] = [x0 + 28, y0 + 14]

    # ── tents: an orange ridge tent up on the left, a green dome on the right ──
    rt = art.ridge_tent()
    art.guys(base, rt, 98, 132)
    put(at(rt, 98, 132), over=124)
    shadow(100, 126, 36, 5, 0.35, seed=9)
    mc.block(64, 86, 132, 124)
    put(at(art.rolled_bag('#3a7a5a'), 146, 146), over=146, shadow=True)
    dt = art.dome_tent()
    art.guys(base, dt, 440, 134)
    put(at(dt, 440, 134), over=130)
    shadow(446, 131, 40, 5, 0.35, seed=10)
    mc.block(406, 92, 474, 130)

    # ── sleeping bags out on a tarp in front of the dome: sat on, facing us ──
    def tarp(c):
        t = art.tones('#3a5a8a', 0.15)
        for y in range(138, 207):
            for x in range(392, 487):
                k = 2
                if (x + 2 * y) % 23 == 0 or (x - y) % 31 == 0:
                    k = 1                                                  # creases where it was folded
                if y == 138 or x == 392:
                    k = 3
                if y == 206 or x == 486:
                    k = 0
                c.px(x, y, t[k])
        for x in range(396, 486, 12):
            c.px(x, 140, rgb('#c9ced6')); c.px(x, 141, rgb('#6a6e76'))    # its grommets
    put(tarp, shadow=True)
    for k, (bx, col) in enumerate(((410, '#c23b3b'), (440, '#2f62d8'), (470, '#d8a020'))):
        bag = art.sleeping_bag(col, lining=('#e9dcb8', '#c8d8e8', '#e8c8a8')[k])
        contact(bag, bx - bag.w // 2, 186 - bag.h + 1)                     # lying flat: a soft shadow hugging it all round
        put(at(bag, bx, 186))
        L['seats'].append(dict(x=bx, y=196, ax=bx, ay=208, pose='front', flip=False, hit=[bx - 9, 138, 18, 60]))
    mc.block(398, 142, 482, 186)

    # ── coolers: a red one by the fire, a blue one by the ridge tent ──
    for body, x, y in (('#c23b3b', 362, 272), ('#2f62d8', 170, 140)):
        cl = art.cooler(body)
        shadow(x + 1, y + 1, 13, 2, 0.32, seed=x)
        put(at(cl, x, y), over=y)
        mc.block(x - 12, y - 10, x + 12, y)

    # ── the camp table: marshmallows, graham crackers, chocolate, the sticks, a mug, and the lantern ──
    tb = art.camp_table()
    tx, ty = 372, 166
    shadow(tx + 1, ty + 1, 22, 3, 0.3, seed=13)
    put(at(tb, tx, ty), over=ty)
    t0x, t0y = tx - tb.w // 2, ty - tb.h + 1
    mc.block(t0x + 2, t0y + 18, t0x + 42, ty)
    L['things']['lantern'] = [t0x + 33, t0y + 8]

    # ── camp lights round the edge: tiki torches along the path from the deck and round the clearing, lanterns on a
    #    shepherd's hook, on the coolers and on a stump, a string of bulbs between the tents, and the lantern lit inside
    #    the dome. Each has its glow (mc.light: the page lights them up after dark); the torches' flames are the page's. ──
    WARM, TORCH = '#ffcf80', '#ffa850'
    L['things']['torches'] = []
    for x, y in ((62, 164), (120, 198), (184, 162), (226, 104), (330, 104), (40, 252), (452, 266), (380, 302)):
        tk = art.tiki_torch()
        shadow(x + 1, y + 1, 4, 1.5, 0.3, seed=x)
        put(at(tk, x, y), over=y)
        mc.block(x - 1, y - 2, x + 1, y)
        fxx, fyy = x - tk.w // 2 + tk.flame[0], y - tk.h + 1 + tk.flame[1]
        L['things']['torches'].append([fxx, fyy])
        mc.light(fxx, fyy - 3, 30, 22, TORCH, 0.2)
    hook, glass = art.shepherd_hook()
    for x, y in ((156, 112), (480, 228)):
        put(at(hook, x, y), over=y)
        mc.block(x - 5, y - 2, x - 3, y)
        mc.light(x - hook.w // 2 + glass[0], y - hook.h + 1 + glass[1], 28, 20, WARM, 0.2)
    lt = art.lantern()
    for x, y in ((362, 256), (170, 124)):                                  # on the lids of the two coolers
        put(at(lt, x + 6, y), over=y + 17)
        mc.light(x + 6, y - 7, 26, 18, WARM, 0.18)
    sl = art.stump_lantern()
    shadow(424, 285, 8, 2, 0.3, seed=77)
    put(at(sl, 422, 284), over=284)
    mc.block(415, 276, 429, 284)
    mc.light(422, 268, 26, 18, WARM, 0.18)
    # the string of bulbs, tied to the eyes of two cedar posts beside the tents (in front of anybody walking behind them)
    lp = art.light_post()
    eyes = []
    for x, y in POSTS:
        shadow(x + 2, y + 1, 4, 1.5, 0.3, seed=x + 1)
        put(at(lp, x, y), over=y)
        mc.block(x - 2, y - 2, x + 2, y)
        eyes.append((x - lp.w // 2 + lp.eye[0], y - lp.h + 1 + lp.eye[1]))
    (ex0, ey0), (ex1, ey1) = eyes
    cord = Cv(W, H)
    lit_bulbs = art.bulb_string(cord, ex0, ey0, ex1 - 2, ey1, 18, every=14)
    for cx0 in range(ex0 - 2, ex1 + 2, 96):                                # (in pieces: the atlas is only so wide)
        cx1 = min(ex1 + 2, cx0 + 96)
        piece = cord.a[ey0 - 1:ey1 + 26, cx0:cx1].copy()
        if (piece[..., 3] > 0).any():
            mc.occluders.append((piece, dict(x=cx0, y=ey0 - 1, w=cx1 - cx0, h=ey1 + 27 - ey0, z=POSTS[0][1] + 1)))
    for bx, by in lit_bulbs:
        if (bx // 14) % 2 == 0:
            mc.light(bx, by, 14, 10, '#ffd890', 0.14)
    mc.light(443, 120, 22, 16, WARM, 0.22)                                # the lantern inside the dome
    L['things']['lantern'] = [t0x + 33, t0y + 8]
    mc.light(t0x + 33, t0y + 8, 28, 20, WARM, 0.2)
    mc.light(11, DOOR_Y0 - 12, 26, 26, WARM, 0.18)                        # the porch light

    # ── the telescope, top middle, behind the bulbs: stood at by its eyepiece, looking up at the sky ──
    ts = art.telescope()
    tx_, ty_ = TELESCOPE
    shadow(tx_ + 2, ty_ + 1, 12, 2, 0.3, seed=88)
    put(at(ts, tx_, ty_), over=ty_)
    mc.block(tx_ - 8, ty_ - 3, tx_ + 8, ty_)
    L['things']['telescope'] = len(L['seats'])
    L['things']['telescopeAt'] = [tx_ - ts.w // 2, ty_ - ts.h + 1, ts.w, ts.h]
    L['seats'].append(dict(x=tx_ - 16, y=ty_ + 4, ax=tx_ - 16, ay=ty_ + 4, pose='stand', flip=False, face='right', only=True, hit=[tx_ - 26, ty_ - 36, 42, 42]))

    # ── the radio, on the ground to the left of the stump west of the fire ──
    rd = art.radio()
    rx_, ry_ = RADIO
    shadow(rx_ + 1, ry_ + 1, 8, 1.5, 0.3, seed=89)
    put(at(rd, rx_, ry_), over=ry_)
    mc.block(rx_ - 7, ry_ - 3, rx_ + 6, ry_)
    L['things']['radio'] = [rx_ - rd.w // 2, ry_ - rd.h + 1, rd.w, rd.h]

    # ── cornhole down the bottom left: two regulation boards, 2 feet by 4, their front edges 27 feet apart (216 dots),
    #    the left one's back to the house, the right one's back toward the fire; a pitcher's box beside each board,
    #    above it (red) and below it (blue). The bags are the page's (client/src/basement/cornhole.tsx). ──
    for back_left, x0 in ((True, CH_LEFT[0]), (False, CH_RIGHT[0])):
        bd = art.cornhole_board(back_left)
        ox, oy = x0 - 1, CH_Y + 8 - 24
        shadow(x0 + 16, CH_Y + 9, 18, 2.5, 0.32, seed=90 + x0)
        put(lambda c, bd=bd, ox=ox, oy=oy: c.paste(bd, ox, oy), over=CH_Y + 8)
        mc.block(x0, CH_Y - 7, x0 + 31, CH_Y + 7)
    L['things']['cornhole'] = dict(left=list(CH_LEFT), right=list(CH_RIGHT), y=CH_Y, spots=[])
    for x, y, face in ((CH_LEFT[1] - 8, CH_Y - 12, 'right'), (CH_LEFT[1] - 8, CH_Y + 17, 'right'),
                       (CH_RIGHT[0] + 8, CH_Y - 12, 'left'), (CH_RIGHT[0] + 8, CH_Y + 17, 'left')):
        L['things']['cornhole']['spots'].append(len(L['seats']))
        L['seats'].append(dict(x=x, y=y, ax=x, ay=y, pose='stand', flip=False, face=face, only=True, hit=[x - 8, y - 38, 16, 40]))

    # the coolers: a drink from either (the drink menu, as the fridge in the game room)
    L['spots'] = [['cooler', x - 14, y - 20, 28, 21] for x, y in ((362, 272), (170, 140))]

    # ── where people stand about when the seats are taken ──
    L['stands'] += [dict(x=190, y=236, face='right'), dict(x=354, y=236, face='left'), dict(x=250, y=266, face='up'), dict(x=230, y=272, face='up'),
                    dict(x=316, y=272, face='up'), dict(x=100, y=200, face='right'), dict(x=420, y=230, face='left')]

    # ── the door in the room upstairs: drawn here, laid over that room's east wall by the page (things['door']) ──
    d0, d1 = UP_DOOR

    # It is set into the room's east wall, so it is made of that wall: the gold trim and the bronze of its face (the
    # room's own colours there), a dark jamb where the wall's thickness shows, and an oak sill. No mat. The frame is
    # drawn as the room is (lit the same day and night); the strip of grass seen through it is a picture of its own
    # (doorview.png) that the page dims with the hour, as the back window's view is, and the daylight it lets in across
    # the carpet is the page's too (things['door'].sun), there only by day.
    TRIM, FACE = rgb('#fbe59a'), rgb('#8a6420')

    def up_door(c):
        oak = Mat('#8a5a3c', hi='#b07a52', lo='#5f3c27')
        for y0_, y1_ in ((d0 - 3, d0 - 1), (d1 + 1, d1 + 3)):           # the casing above and below, in the wall's trim
            c.rect(518, y0_, 527, y1_, FACE)
            c.rect(518, y0_, 521, y1_, TRIM)
        c.rect(518, d0 - 1, 527, d0 - 1, shade(FACE, 0.35))               # its shadow on the opening
        c.rect(518, d1 + 1, 527, d1 + 1, tint(FACE, 0.15))
        c.rect(518, d0, 521, d1, oak.base)                                # the sill across the wall's thickness
        for y in range(d0, d1 + 1):
            if (y - d0) % 6 == 5:
                c.rect(518, y, 521, y, oak.lo)
        c.rect(518, d0, 518, d1, oak.hi)
        c.rect(522, d0, 522, d1, shade(FACE, 0.55))                       # the jamb: the inside of the wall, in shadow

    def up_view(c):                                                       # the grass beyond the door (dimmed by the page at night)
        c.rect(523, d0, 527, d1, G[1])                                   # (in the season's own green: _seasons.py)
        for y in range(d0, d1 + 1):
            if y % 4 == 0:
                c.px(523 + (y // 4) % 4, y, G[3])
            if y % 5 == 2:
                c.px(526 - (y // 5) % 3, y, mix(G[0], (20, 14, 40), 0.1) if G[0] != rgb('#347a37') else rgb('#2f6e30'))
        c.rect(523, d0, 523, d1, mix(G[0], (20, 14, 40), 0.3) if G[0] != rgb('#347a37') else rgb('#2a5a2a'))   # the wall's shadow falling on it
    up = Cv(W, H)
    up_door(up)
    view = Cv(W, H)
    up_view(view)
    both = np.maximum(up.a[..., 3], view.a[..., 3])
    ys, xs = np.nonzero(both)
    x0, y0, x1, y1 = int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())
    EXTRA['door'] = up.a[y0:y1 + 1, x0:x1 + 1].copy()
    EXTRA['doorview'] = view.a[y0:y1 + 1, x0:x1 + 1].copy()
    L['things']['door'] = dict(at=[x0, y0, x1 - x0 + 1, y1 - y0 + 1], hit=[504, d0 - 6, 24, d1 - d0 + 12], foot=dict(x=500, y=(d0 + d1) // 2),
                               sun=[484, d0 - 2, 34, d1 - d0 + 5])
    EXTRA['fire'] = fire_sheet(mc)
    EXTRA['logs'] = logs_sheet(mc)
    EXTRA['toss'] = toss_log(mc)
    L['things']['sheets'] = dict(fire=[FW, FH], logs=[LW, LH], toss=[TW, TH])
    # the deep woods past the edges, for the panel round the scene
    # ── deeper into the woods, darker: the ground, and the trees and undergrowth standing in front ──
    def deep(arr, ox, oy):
        h, w = arr.shape[:2]
        ys, xs = np.mgrid[oy:oy + h, ox:ox + w].astype(np.float32)
        dx = (xs - 250) / np.where(xs < 250, 250, 215)
        dy = (ys - 200) / np.where(ys < 200, 118, 112)
        m = (dx ** 4 + dy ** 4) ** 0.25
        k = np.clip((m - 0.95) / 0.42, 0, 1) * 0.55
        rgbf = arr[..., :3].astype(np.float32)
        arr[..., :3] = (rgbf * (1 - k[..., None]) + np.array([8, 22, 16], np.float32) * k[..., None]).astype(np.uint8)
    deep(base.a, 0, 0)
    for crop, e in mc.occluders:
        deep(crop, e['x'], e['y'])
    L['things']['bg'] = 'var(--outside-bg, #0d1a12)'                     # (the page darkens it with the night: outside.tsx)
    S.end(mc)
