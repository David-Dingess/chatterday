"""The lake: not a basement either, but the water out past the campsite, down the path behind the telescope. A wooden
dock runs out from the near shore to a T at its end, with six places to fish from along it (each facing the water to one
side); a green rowboat is tied up beside it; reeds stand along the shore and lily pads float off to the east; the far
shore is woods, mirrored in the water. On the bank to the west is the bait shop, a little plank shack with a tin roof,
and beside it the record board on its two legs, where the biggest catch of each kind is written up (the page shows
what is on it: client/src/basement/lake.tsx). Two Adirondack chairs look out over the water. The path at the bottom goes
back to the campsite (this fit-out's EXIT, which the page treats as its stairs).

Drawn with the campsite's tools (scripts/basement/_camp_art.py, the yard's trees and grass), at the same scale as the
room. The water is still in the picture; the page puts the life on it (glints, rings, the bobbers, the rain).

catch.png is everything that can come up on a line, one CW x CH cell each, in the order of client/src/basement/lake.ts
KINDS: the fish drawn from a few numbers each (length, depth, colours, bars, spots, a stripe, the tail), the junk by
hand.

SHELL = False tells scripts/make-basement.py to skip the basement's walls, stairs and concrete."""
import math

import numpy as np

TITLE = 'The lake'
BLURB = 'Fishing, down the path past the campsite'
ORDER = 1000
SHELL = False
VIGNETTE = 0.14
GROUND = (12, 120, 516, 326)                     # where feet may go (the water is blocked off cell by cell)
EXIT = dict(rect=[174, 312, 56, 22], foot=dict(x=202, y=314), face='down')
STEM = (290, 319, 150, 274)                      # the dock's stem: x0, x1, y0, y1 (x0 and x1 + 1 on the 6-dot cells, so two
HEAD = (242, 373, 128, 151)                      # columns of it can be walked); the T at its end: x0, x1, y0, y1
FACE = 4                                         # how deep the T's front edge shows (its beam, over the water)
BOAT = (238, 286, 212, 234)                     # the rowboat, tied up west of the stem near the shore
SHOP = (24, 120, 222, 262)                       # the bait shop's front wall: x0, x1, top, foot
BOARD = (134, 184, 234, 284)                     # the record board: x0, x1, its top, the foot of its legs
WEEDS = [[425, 184, 40], [204, 238, 28], [458, 228, 26], [104, 130, 26]]   # lily pads and reed beds: [x, y, r]
DEEP = [292, 92, 172, 44]                        # the deep middle: [cx, cy, rx, ry]
CW, CH = 40, 24                                  # one cell of catch.png
EXTRA = {}
SEASONS = ('spring', 'fall', 'winter', 'snow')  # drawn once a season as well (scripts/basement/_seasons.py; summer is base.png)

# where a person fishing stands (their feet) and which way they face: the T's two ends, and both sides of the stem
SPOTS = [(252, 146, 'left'), (364, 146, 'right'), (296, 168, 'left'), (314, 184, 'right'), (296, 196, 'left'), (314, 226, 'right')]

import importlib.util as _iu
import os as _os
_s = _iu.spec_from_file_location('camp_art', _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), '_camp_art.py'))
art = _iu.module_from_spec(_s)
_s.loader.exec_module(art)


def far_shore(x):
    """The far shore's line: the woods come down to the water here (the water is below it)."""
    return 50 + 6 * math.sin(x / 47 + 0.6) + 3 * math.sin(x / 19)


def near_shore(x):
    """The near shore's line: the water is above it. It bulges up into the lake under the bait shop, and a little to the
    east."""
    return 252 - 40 * math.exp(-((x - 60) / 90) ** 2) - 18 * math.exp(-((x - 500) / 60) ** 2) + 4 * math.sin(x / 23)


def on_dock(x, y):
    return (STEM[0] <= x <= STEM[1] and STEM[2] <= y <= STEM[3]) or (HEAD[0] <= x <= HEAD[1] and HEAD[2] <= y <= HEAD[3] + FACE)


def is_water(x, y):
    return far_shore(x) < y < near_shore(x)


# ───────────────────────── what comes up on a line (catch.png) ─────────────────────────

FISH = dict(
    # a round little sunfish: deep body, small mouth, the black ear flap, an orange breast, dusky bars
    bluegill=dict(L=20, Hh=8.5, back='#2e5258', side='#6a8e6e', belly='#f0a038', fin='#3e5e58', bars=6, ear=True, tail='square', nose=0.62,
                  dorsal=4, dorsal_at=(0.22, 0.78), anal=(0.52, 0.8, 3), shape=0.55),
    # yellow with dark saddles, orange-red lower fins, two dorsal fins
    perch=dict(L=25, Hh=5.5, back='#4e5e22', side='#e2c43e', belly='#f4ecc0', fin='#e86a2a', bars=6, tail='fork', nose=0.35,
               dorsal_at=(0.24, 0.72), notch=0.5, anal=(0.6, 0.76, 2)),
    # silvery-olive, deep and flat with a humped back, freckled all over, big matching fins top and bottom, an upturned mouth
    crappie=dict(L=22, Hh=8, back='#3e5a46', side='#c4ccb2', belly='#eef0e2', fin='#7e8e74', spots=5, spots_all=True, fin_spots=True,
                 tail='fork', nose=0.45, dorsal=5, dorsal_at=(0.46, 0.84), anal=(0.5, 0.84, 4), shape=0.4, mouth=3, upturned=True),
    # green, a ragged dark stripe down its side, and the big jaw that runs back past its eye
    bass=dict(L=30, Hh=6.5, back='#2e4a24', side='#7a9a48', belly='#ece6c8', fin='#56763a', stripe='#22321a', tail='square', nose=0.62,
              dorsal_at=(0.26, 0.76), notch=0.48, jaw=10, anal=(0.6, 0.76, 2)),
    # slate blue-grey, freckled, a broad flat head with long whiskers, one tall spine of a dorsal, a fatty fin, a deep fork
    catfish=dict(L=29, Hh=5.5, back='#3e4a5a', side='#7e8ca0', belly='#eef0f4', fin='#4a5668', spots=3, freckles=True, tail='deep',
                 nose=0.88, flat=True, dorsal=5, dorsal_at=(0.6, 0.67), adipose=0.2, anal=(0.12, 0.42, 2), barbels='long', mouth=4),
    # olive back, the pink band, black spots over the back and the tail, a small fatty fin
    trout=dict(L=29, Hh=5.5, back='#4e6228', side='#c8ccbc', belly='#f4f2ec', fin='#8a8a64', band='#e8687a', spots=5, tail_spots=True,
               tail='square', nose=0.45, dorsal_at=(0.42, 0.62), adipose=0.18, anal=(0.2, 0.32, 2)),
    # long as a log, olive-silver with dark bars, its fins far back by the tail, a flat duckbill snout full of teeth
    muskie=dict(L=31, Hh=4.5, back='#46562a', side='#aeb084', belly='#ecead8', fin='#b4562a', bars=8, tail='fork', nose=0.3, snout=True,
                dorsal=3, dorsal_at=(0.12, 0.3), anal=(0.12, 0.28, 3), mouth=7, teeth=True, TAIL=6),
    # big glassy eyes, gold-olive with dark saddles, a white tip to the tail
    walleye=dict(L=29, Hh=5.5, back='#5a5a26', side='#c8b46a', belly='#f2ead0', fin='#8a7a44', bars=5, tail='fork', nose=0.4, glass=True,
                 dorsal_at=(0.24, 0.72), notch=0.5, white_tip=True, anal=(0.2, 0.34, 2)),
    # bronze, big round scales, a long dorsal, two little whiskers
    carp=dict(L=28, Hh=7, back='#5e4a1e', side='#b88a3a', belly='#ecd28c', fin='#8a5a2a', scales=True, tail='fork', nose=0.55,
              dorsal=3, dorsal_at=(0.3, 0.8), barbels='short', anal=(0.18, 0.3, 2)),
    # a long olive body, spotted, and a beak of a snout like a needle (its fins all far back)
    gar=dict(L=27, Hh=3.5, back='#4a5a2e', side='#9aa070', belly='#e8e6cc', fin='#6a6a3a', spots=3, spots_all=True, fin_spots=True, tail='round',
             nose=0.3, needle=8, dorsal=2, dorsal_at=(0.08, 0.2), anal=(0.08, 0.2, 2), TAIL=4),
    # grey-brown, a row of bony plates down its back and side, a shark's tail, a pointed snout with whiskers under it
    sturgeon=dict(L=31, Hh=5, back='#4a4a40', side='#8a8674', belly='#e2ded0', fin='#5a5648', plates=True, tail='shark', nose=0.35,
                  dorsal=2, dorsal_at=(0.06, 0.18), anal=(0.08, 0.2, 2), barbels='short', underslung=True),
    # mythical: pale and see-through, its bones showing, glowing faintly
    ghost=dict(L=26, Hh=6.5, back='#9ad8e6', side='#c8f0f6', belly='#eefcff', fin='#b8ecf4', ghost=True, tail='veil', nose=0.5,
               dorsal=4, dorsal_at=(0.26, 0.72), anal=(0.58, 0.78, 3)),
    # a little sunfish, all orange spots and blue squiggles, a red tip to its ear flap
    pumpkinseed=dict(L=19, Hh=8, back='#5a6a3a', side='#c8a050', belly='#f4a028', fin='#7a7a40', spots=4, warm_spots=True, squiggles=True, ear=True,
                     red_ear=True, tail='square', nose=0.6, dorsal=4, dorsal_at=(0.22, 0.78), anal=(0.52, 0.8, 3), shape=0.55),
    # bronze, with faint dark bars, red eyes, a smaller jaw than its largemouth cousin
    smallmouth=dict(L=28, Hh=6, back='#5a4a22', side='#a88a48', belly='#ece2c0', fin='#7a6234', bars=9, tail='square', nose=0.55,
                    dorsal_at=(0.26, 0.76), notch=0.48, jaw=6, red_eye=True, anal=(0.6, 0.76, 2)),
    # a small brown catfish: a rounded tail, short whiskers
    bullhead=dict(L=24, Hh=5.5, back='#3e3020', side='#7a6440', belly='#e8dcb4', fin='#4e3e28', tail='square', nose=0.85, flat=True,
                  dorsal=4, dorsal_at=(0.58, 0.66), adipose=0.2, anal=(0.12, 0.4, 2), barbels='long', mouth=3),
    # a living fossil: long and olive, a fin running the length of its back, a black eyespot at the root of its tail
    bowfin=dict(L=30, Hh=5, back='#3a4a26', side='#7a8a4a', belly='#d8d8a8', fin='#4a5a2e', freckles=True, spots=2, tail='round', nose=0.5,
                dorsal=3, dorsal_at=(0.08, 0.8), eyespot=True, anal=(0.12, 0.26, 2), TAIL=5),
    # somebody's pet, let go: small, orange, a long flowing tail
    goldfish=dict(L=16, Hh=6, back='#e0581a', side='#f48a2a', belly='#ffc870', fin='#f87a30', tail='veil', nose=0.55, dorsal=3,
                  dorsal_at=(0.3, 0.7), anal=(0.6, 0.76, 2), TAIL=6),
    # an escaped koi: white, with big orange-red and black patches
    koi=dict(L=27, Hh=6.5, back='#f2ece0', side='#f6f2ea', belly='#fffcf4', fin='#f0e8dc', patches=True, tail='veil', nose=0.55,
             barbels='short', dorsal=3, dorsal_at=(0.3, 0.78), anal=(0.18, 0.3, 2)),
    # grey, sharky, and a long flat paddle of a snout
    paddlefish=dict(L=23, Hh=4.5, back='#4e5a66', side='#8a96a2', belly='#e6eaee', fin='#56626e', tail='shark', nose=0.55, paddle=7, TAIL=5,
                    dorsal=3, dorsal_at=(0.16, 0.3), anal=(0.14, 0.28, 2)),
    # legendary: steel blue with white flecks, fat lobed fins like little legs
    coelacanth=dict(L=30, Hh=6.5, back='#24406a', side='#3e6a9a', belly='#7aa0c8', fin='#2e5a8a', flecks=True, lobes=True, tail='veil', nose=0.55,
                    dorsal=4, dorsal_at=(0.36, 0.56), anal=(0.24, 0.36, 3)),
    # mythical: a fish of brass, riveted, a wind-up key in its back and a gear for an eye
    clockwork=dict(L=26, Hh=6.5, back='#8a5a1a', side='#c8962e', belly='#ecc870', fin='#a8762a', rivets=True, key=True, gear_eye=True, tail='fork',
                   nose=0.55, dorsal=3, dorsal_at=(0.22, 0.4), anal=(0.6, 0.76, 2)),
    # gold all over with glints on its scales, whiskers like a carp, long flowing fins
    golden=dict(L=26, Hh=7, back='#e0800c', side='#f6c830', belly='#fff2a8', fin='#f0a020', tail='veil', nose=0.6, barbels='short', gold=True,
                dorsal=4, dorsal_at=(0.24, 0.74), anal=(0.6, 0.78, 3)),
)


def fish_cell(mc, spec):
    """One fish, side on, its head to the right, in a CW x CH cell: a body that swells from a narrow wrist to the head,
    darker along the back and pale underneath, lit along the top; its markings; a tail, its fins top and bottom where
    its kind has them, a gill line, an eye with a glint, and its mouth (a big bass jaw, a muskie's teeth, a catfish's
    whiskers)."""
    rgb, mix, shade, tint, Cv = mc.rgb, mc.mix, mc.shade, mc.tint, mc.Cv
    hsh = mc.hsh
    c = Cv(CW, CH)
    L, Hh, TAIL = spec['L'], spec['Hh'], spec.get('TAIL', 6)
    snout = spec.get('paddle', spec.get('needle', 0))                       # (a paddle or a beak out past the head: centred with it)
    x0 = (CW - (L + TAIL + snout)) // 2 + TAIL
    mid = CH // 2 + 1
    back, side, belly, fin = rgb(spec['back']), rgb(spec['side']), rgb(spec['belly']), rgb(spec['fin'])
    dark = shade(back, 0.45)
    nose = spec.get('nose', 0.5)
    shape = spec.get('shape', 0.75)                                          # (lower: the deepest part further back)
    top, bot = {}, {}
    for x in range(x0, x0 + L):
        t = (x - x0) / (L - 1)
        u = t ** shape
        s = 0.3 + 0.7 * math.sin(math.pi * min(1.0, u * 0.98 + 0.02)) ** 0.65
        if spec.get('flat') and t > 0.55:
            s = max(s, 0.86)                                                  # the catfish's broad head, all the way to the nose
        if t > 0.82:
            s *= 1 - (t - 0.82) / 0.18 * (1 - nose)
        ht, hb = Hh * s, Hh * s * (0.78 if spec.get('flat') else 0.92)
        if spec.get('snout') and t > 0.8:
            ht *= 0.8                                                         # the muskie's long flat bill
        top[x], bot[x] = int(round(mid - ht)), int(round(mid + hb))
    # the tail
    tail = spec.get('tail', 'fork')
    for j in range(TAIL + (2 if tail == 'veil' else 0)):
        x = x0 - 1 - j
        th = 2 + j * (Hh * (0.75 if tail == 'round' else 0.9)) / TAIL
        if tail == 'round':
            th = min(th, 2 + (TAIL - 1) * 0.8 * Hh / TAIL) * (1 - max(0, j - TAIL + 2) * 0.18)
        for y in range(int(mid - th), int(mid + th) + 1):
            dy = abs(y - mid)
            if tail == 'fork' and j >= 2 and dy < (j - 1) * 0.7:
                continue
            if tail == 'deep' and j >= 1 and dy < j * 0.95:
                continue
            if tail == 'veil' and j >= 3 and dy < (j - 2) * 0.6:
                continue
            if tail == 'shark' and (y > mid + 1 + j // 3 or (j >= 2 and mid - j * 0.3 < y <= mid + 1 + j // 3 and j > 3)):
                continue                                                      # (the sturgeon's: the top lobe long, the bottom short)
            col = fin if (y + j) % 3 else shade(fin, 0.2)
            if j == TAIL - 1 or (tail == 'veil' and j >= TAIL):
                col = tint(fin, 0.18)
            if spec.get('white_tip') and j == TAIL - 1 and y > mid:
                col = rgb('#f4f2ec')
            if spec.get('tail_spots') and hsh(x, y, 11) % 5 == 0:
                col = dark
            c.px(x, y, col)
    # the dorsal fin (or two, with a notch between), along the top of the back
    dh = spec.get('dorsal', 3)
    da, db = spec.get('dorsal_at', (0.28, 0.74))
    notch = spec.get('notch')
    for x in range(x0 + int(L * da), x0 + int(L * db)):
        k = (x - x0 - L * da) / max(1, L * (db - da))
        h = dh * math.sin(math.pi * k) + (1 if x % 2 else 0)
        if notch is not None and abs(k - notch) < 0.08:
            h = 1
        elif notch is not None and k > notch:
            h *= 0.8
        for y in range(top[x] - int(round(h)), top[x]):
            col = shade(fin, 0.15) if (x % 2 == 0 and not spec.get('gold')) else fin
            if spec.get('fin_spots') and hsh(x, y, 12) % 3 == 0:
                col = dark
            c.px(x, y, col)
    if spec.get('adipose'):                                                   # a little fatty fin, back by the tail
        ax = x0 + int(L * spec['adipose'])
        c.rect(ax, top[ax] - 1, ax + 1, top[ax] - 1, shade(fin, 0.1))
    # the fins underneath: a pair behind the gills, and the anal fin (big on a crappie or a catfish)
    px_ = x0 + int(L * 0.7)
    for i in range(3):
        c.px(px_ - i, bot[px_ - i] + 1, fin)
    c.px(px_ - 2, bot[px_ - 2] + 2, shade(fin, 0.2))
    aa, ab, ah = spec.get('anal', (0.3, 0.42, 2))
    for x in range(x0 + int(L * aa), x0 + int(L * ab)):
        k = (x - x0 - L * aa) / max(1, L * (ab - aa))
        h = max(1, int(round(ah * math.sin(math.pi * min(1, k * 1.1)))))
        for y in range(bot[x] + 1, bot[x] + 1 + h):
            col = fin if (x + y) % 3 else shade(fin, 0.2)
            if spec.get('fin_spots') and hsh(x, y, 13) % 3 == 0:
                col = dark
            c.px(x, y, col)
    # the body
    for x in range(x0, x0 + L):
        t = (x - x0) / (L - 1)
        y0, y1 = top[x], bot[x]
        for y in range(y0, y1 + 1):
            v = (y - y0) / max(1, y1 - y0)
            col = back if v < 0.32 else mix(back, side, (v - 0.32) / 0.18) if v < 0.5 else side if v < 0.7 else mix(side, belly, min(1, (v - 0.7) / 0.15))
            if spec.get('bars') and v < 0.78 and 0.08 < t < 0.8:
                n = spec['bars']
                if (t * n + (0.3 if n % 2 else 0)) % 1 < 0.32 and (hsh(x, y, 5) % 5):
                    col = shade(col, 0.32)
            if spec.get('stripe') and 0.38 <= v <= 0.6 and t < 0.84:
                if hsh(x // 2, y, 6) % 4:
                    col = rgb(spec['stripe'])
            if spec.get('band') and 0.42 <= v <= 0.58 and t < 0.86:
                col = mix(col, rgb(spec['band']), 0.75)
            if spec.get('spots'):
                reach = 0.86 if spec.get('spots_all') else 0.62
                if v < reach and t < 0.84 and hsh(x, y, 7) % 13 < spec['spots']:
                    col = dark if not spec.get('gold') else tint(col, 0.6)
            if spec.get('scales') and 0.15 < v < 0.85 and t < 0.84 and ((x + 2 * (y % 2)) % 4 == 0):
                col = shade(col, 0.16)                                        # the carp's big round scales
            if spec.get('plates') and (abs(v - 0.08) < 0.1 or abs(v - 0.5) < 0.07) and x % 3 == 0 and t < 0.86:
                col = tint(col, 0.45)                                         # a sturgeon's bony plates
            if spec.get('ghost'):
                if abs(v - 0.45) < 0.07 and t < 0.84:
                    col = rgb('#ffffff')                                      # its spine, showing through
                elif x % 3 == 0 and 0.15 < v < 0.8 and 0.15 < t < 0.75:
                    col = tint(col, 0.55)                                     # and its ribs
            if spec.get('warm_spots') and v < 0.75 and t < 0.84 and hsh(x, y, 14) % 9 == 0:
                col = rgb('#f08a30')                                          # the pumpkinseed's orange spots
            if spec.get('squiggles') and t > 0.68 and t < 0.86 and 0.3 < v < 0.7 and (x + y) % 3 == 0:
                col = rgb('#4a9ac8')                                          # and the blue squiggles on its cheek
            if spec.get('patches'):
                pv = math.sin(x * 0.55 + 1.3) + math.sin(y * 0.9 + x * 0.2) + (0.8 if v < 0.45 else -0.4)
                if pv > 1.0:
                    col = rgb('#e8501e') if v > 0.15 else rgb('#f06a30')      # the koi's orange-red patches
                elif pv < -1.3 and v < 0.7:
                    col = rgb('#1e1e24')                                      # and black ones
            if spec.get('flecks') and hsh(x, y, 15) % 7 == 0 and t < 0.86:
                col = rgb('#e8f0f8')                                          # the coelacanth's white flecks
            if spec.get('rivets') and (abs(v - 0.2) < 0.08 or abs(v - 0.75) < 0.08) and x % 3 == 0 and t < 0.86:
                col = rgb('#fff0b0')                                          # rivets along its plates
            if spec.get('rivets') and x % 6 == 0 and t < 0.86:
                col = shade(col, 0.25)                                        # the seams between its plates
            if spec.get('gold') and hsh(x, y, 8) % 17 == 0:
                col = rgb('#fffbe0')                                          # a glint on a scale
            if spec.get('gold') and 0.3 < v < 0.75 and (x + (y // 2)) % 4 == 0 and t < 0.8:
                col = shade(col, 0.08)                                        # its scales, in rows
            if y == y0:
                col = tint(col, 0.28)                                         # lit along the top
            elif y == y1:
                col = shade(col, 0.22)
            c.px(x, y, col)
    # the gill cover
    gx = x0 + int(L * (0.72 if spec.get('flat') or spec.get('snout') else 0.76))
    for y in range(top[gx] + 2, bot[gx] - 1):
        c.px(gx + (1 if abs(y - mid) < 2 else 0), y, shade(side, 0.38))
    if spec.get('ear'):                                                       # the bluegill's black ear flap
        c.rect(gx - 1, mid - 2, gx, mid - 1, rgb('#141820')); c.px(gx - 2, mid - 1, rgb('#141820'))
        if spec.get('red_ear'):
            c.px(gx - 2, mid - 1, rgb('#e8302a'))                             # (the pumpkinseed's, tipped red)
    if spec.get('eyespot'):                                                   # the bowfin's false eye by its tail
        for dx, dy in ((1, -3), (2, -3), (0, -2), (3, -2), (0, -1), (3, -1), (1, 0), (2, 0)):
            c.px(x0 + 1 + dx, mid + dy, rgb('#f0c040'))
        c.rect(x0 + 2, mid - 2, x0 + 3, mid - 1, rgb('#141016'))
    if spec.get('lobes'):                                                     # the coelacanth's fat lobed fins, like little legs
        for lx, ly, d in ((x0 + int(L * 0.6), bot[x0 + int(L * 0.6)], 1), (x0 + int(L * 0.4), bot[x0 + int(L * 0.4)], 1), (x0 + int(L * 0.66), top[x0 + int(L * 0.66)], -1)):
            for i in range(4):
                c.px(lx - i // 2, ly + d * (i + 1), shade(fin, 0.1) if i < 3 else tint(fin, 0.2)); c.px(lx - i // 2 + 1, ly + d * (i + 1), fin)
    if spec.get('key'):                                                       # a wind-up key in its back
        kx = x0 + int(L * 0.55)
        c.rect(kx, top[kx] - 3, kx, top[kx] - 1, rgb('#b8bcc4'))
        c.rect(kx - 2, top[kx] - 6, kx + 2, top[kx] - 4, rgb('#d8dce2')); c.px(kx, top[kx] - 5, rgb('#7a7e86'))
    # the eye
    ex = x0 + int(L * (0.9 if spec.get('snout') else 0.86 if spec.get('flat') else 0.88))
    ey = int(round(mid - (mid - top[ex]) * (0.6 if spec.get('flat') else 0.45)))
    if spec.get('gear_eye'):                                                  # a little brass gear for an eye
        c.rect(ex - 1, ey - 1, ex + 1, ey + 1, rgb('#5a3a10')); c.px(ex, ey, rgb('#fff0b0'))
        for dx, dy in ((0, -2), (2, 0), (0, 2), (-2, 0)):
            c.px(ex + dx, ey + dy, rgb('#5a3a10'))
    elif spec.get('red_eye'):
        c.rect(ex, ey, ex + 1, ey + 1, rgb('#c8281e')); c.px(ex, ey, rgb('#ffffff')); c.px(ex + 1, ey + 1, rgb('#141016'))
    elif spec.get('glass'):                                                   # the walleye's big glassy eye
        c.rect(ex - 1, ey, ex + 1, ey + 1, rgb('#d8d0a0')); c.px(ex, ey, rgb('#ffffff')); c.px(ex + 1, ey + 1, rgb('#6a5a20'))
    elif spec.get('ghost'):
        c.rect(ex, ey, ex + 1, ey + 1, rgb('#3a8aa8')); c.px(ex, ey, rgb('#ffffff'))
    else:
        c.rect(ex, ey, ex + 1, ey + 1, rgb('#141016')); c.px(ex, ey, rgb('#ffffff'))
    c.px(ex - 1, ey, rgb('#e8d070') if not spec.get('gold') else rgb('#c86010'))
    # the mouth: a short line; a bass's jaw back past the eye; upturned on a crappie; a muskie's teeth
    nx = x0 + L - 1
    my = mid + (0 if spec.get('upturned') else 1)
    for i in range(spec.get('jaw', spec.get('mouth', 2))):
        yy = my + (1 if spec.get('jaw') and i > spec['jaw'] * 0.6 else 0)
        c.px(nx - i, yy, shade(side, 0.55))
    if spec.get('upturned'):
        c.px(nx, my - 1, shade(side, 0.55))
    if spec.get('paddle'):                                                    # the paddlefish's long flat snout, widening to a rounded end
        n = spec['paddle']
        for i in range(1, n + 1):
            w = 1 + (i * 3) // n if i < n else 2
            for d in range(-w, w + 1):
                col = tint(back, 0.12) if d < 0 else side if d > 0 else shade(back, 0.15)
                c.px(nx + i, mid - 1 + d, col)
            if i % 3 == 0:
                c.px(nx + i, mid - 1 - (w - 1), rgb('#c8d0d8'))               # (the little pores along it)
    if spec.get('needle'):                                                    # the gar's long beak
        for i in range(1, spec['needle'] + 1):
            c.px(nx + i, mid - 1, back if i < spec['needle'] - 1 else shade(back, 0.2)); c.px(nx + i, mid, shade(side, 0.1) if i % 2 else side)
    if spec.get('underslung'):
        c.px(nx - 2, bot[nx - 2] - 1, shade(side, 0.55)); c.px(nx - 3, bot[nx - 3] - 1, shade(side, 0.55))
    if spec.get('teeth'):
        for i in range(1, spec.get('mouth', 2), 2):
            c.px(nx - i, my - 1, rgb('#f4f0e0'))
    if spec.get('barbels') == 'long':                                         # whiskers: two long ones sweeping back, two short under the chin
        whisker = rgb('#262a32')
        for dx, dy in ((1, 0), (2, 1), (3, 2), (3, 3), (3, 4), (2, 5), (2, 6), (1, 7)):
            c.px(nx + dx, mid + dy, whisker)                                  # (hanging forward and down off the chin)
        for dx, dy in ((0, 3), (0, 4), (0, 5), (-1, 6), (-1, 7), (-2, 8)):
            c.px(nx + dx, mid + dy, whisker)
        for dx, dy in ((-4, 2), (-4, 3), (-6, 2), (-6, 3)):
            c.px(nx + dx, bot[nx + dx] + dy - 1, shade(belly, 0.3))
    elif spec.get('barbels'):
        for dx, dy in ((1, 2), (1, 3), (0, 4)):
            c.px(nx + dx - 1, mid + dy, shade(back, 0.3))
    return c


def long_cell(mc, kind):
    """The ones that are not fish-shaped: an eel (a long wave of a body) and the Lake Serpent (a coil of it, its head
    up, a fin down its back like a dragon's)."""
    rgb, Cv, shade, tint, mix = mc.rgb, mc.Cv, mc.shade, mc.tint, mc.mix
    c = Cv(CW, CH)
    if kind == 'eel':
        back, belly = rgb('#4a4a2a'), rgb('#c8be7a')
        pts = []
        for x in range(4, 37):
            t = (x - 4) / 32
            pts.append((x, 12 + 4 * math.sin(t * 2 * math.pi * 1.1 + 0.4) * (0.4 + 0.6 * (1 - t))))
        for i, (x, yc) in enumerate(pts):
            t = i / (len(pts) - 1)
            r = 1.2 + 1.6 * math.sin(math.pi * min(1, t * 1.15)) if t < 0.92 else 2.0
            for y in range(int(round(yc - r)), int(round(yc + r)) + 1):
                v = min(1.0, max(0.0, (y - (yc - r)) / max(1, 2 * r)))
                col = back if v < 0.55 else mix(back, belly, (v - 0.55) / 0.45)
                if y == int(round(yc - r)):
                    col = tint(col, 0.25)
                c.px(x, y, col)
            if 0.1 < t < 0.88 and i % 2 == 0:
                c.px(x, int(round(yc - r)) - 1, shade(back, 0.2))             # the fin running along its back
        hx, hy = pts[-1]
        c.rect(int(hx) - 2, int(round(hy)) - 1, int(hx) - 1, int(round(hy)), rgb('#141016')); c.px(int(hx) - 2, int(round(hy)) - 1, rgb('#ffffff'))
        c.px(int(hx), int(round(hy)) + 1, shade(back, 0.4))
    elif kind == 'crayfish':                                                  # a crayfish, side on, claws forward to the right
        shell, lo, hi = rgb('#a83a24'), rgb('#6a2214'), rgb('#e0704a')
        for i in range(6):                                                    # the tail, in segments, curling under at the end
            x = 7 + i * 2
            for y in range(13 - min(i, 3) // 2, 18 - (1 if i < 2 else 0)):
                c.px(x, y, shell if y > 13 else hi); c.px(x + 1, y, lo if y > 16 else shell)
        for y in range(16, 20):
            c.px(5, y, shell); c.px(6, y + 1, lo)                             # the tail fan
        for x in range(19, 28):                                               # the body, and its head
            for y in range(11 - (1 if 21 < x < 26 else 0), 18):
                c.px(x, y, hi if y < 12 else lo if y > 16 else shell)
        c.rect(26, 11, 26, 11, rgb('#141016'))                                # the eye on its stalk
        c.px(26, 10, rgb('#141016'))
        for dx in range(9):                                                   # the feelers, long, sweeping back over it
            c.px(28 + dx // 2, 10 - dx // 3, lo); c.px(27 - dx, 7 - dx // 4, lo) if dx < 7 else None
        for k, (cx, cy) in enumerate(((29, 13), (30, 18))):                   # two claws
            c.rect(cx, cy, cx + 5, cy + 2, shell); c.rect(cx + 3, cy - 1, cx + 7, cy, hi); c.px(cx + 7, cy + 2, lo); c.rect(cx + 5, cy + 1, cx + 6, cy + 1, rgb('#3a1008'))
        for x in (20, 22, 24):                                                # walking legs
            c.px(x, 18, lo); c.px(x - 1, 19, lo)
    elif kind == 'serpent':
        scale_, belly, fin = rgb('#2e7a6a'), rgb('#cfe6a0'), rgb('#a03a6a')
        # one long body: from the tail tip at the left in two humps, then the neck rising to the head at the right
        path = []
        for k in range(90):
            t = k / 89
            x = 2 + t * 29
            y = 19 - 4.5 * math.sin(t * math.pi * 2.2) * (0.5 + 0.5 * t) - (max(0, t - 0.78) / 0.22) ** 1.6 * 9
            path.append((x, y, t))
        for x, y, t in path:
            r = 0.6 + 2.3 * min(1, t * 1.6) * (1 - 0.25 * max(0, t - 0.8) / 0.2)
            for yy in range(int(round(y - r)), int(round(y + r)) + 1):
                v = min(1.0, max(0.0, (yy - (y - r)) / max(1, 2 * r)))
                col = scale_ if v < 0.58 else mix(scale_, belly, min(1.0, (v - 0.58) / 0.3))
                if (int(round(x)) + 2 * yy) % 4 == 0 and v < 0.58:
                    col = shade(col, 0.18)                                    # scales
                if yy == int(round(y - r)):
                    col = tint(col, 0.3)
                c.px(int(round(x)), yy, col)
        for x, y, t in path[::4]:                                             # the fin down its back, like a dragon's
            if 0.12 < t < 0.8:
                r = 0.6 + 2.3 * min(1, t * 1.6)
                h = 2 if int(t * 40) % 2 else 1
                for d in range(1, h + 1):
                    c.px(int(round(x)), int(round(y - r)) - d, fin if d == 1 else tint(fin, 0.25))
        hx, hy = int(round(path[-1][0])), int(round(path[-1][1]))
        # the head: a long snout to the right, the jaw open a little, a horn back over the neck, a glowing eye
        for dy in range(-3, 3):
            for dx in range(-1, 7 - abs(dy + 1)):
                c.px(hx + dx, hy + dy, scale_ if dy < 0 else belly if dy > 0 else tint(scale_, 0.15))
        c.rect(hx + 3, hy + 1, hx + 6, hy + 1, rgb('#3a0a1a'))                 # the mouth
        c.px(hx + 4, hy + 2, rgb('#f4f0e0')); c.px(hx + 6, hy + 2, rgb('#f4f0e0'))   # fangs
        c.rect(hx + 2, hy - 2, hx + 3, hy - 2, rgb('#ffe060')); c.px(hx + 3, hy - 2, rgb('#fff8c0'))
        for d in range(4):
            c.px(hx - 1 - d, hy - 3 - d // 2, rgb('#e8e0c8'))                 # the horn
        c.px(hx + 6, hy - 1, rgb('#141016'))                                  # a nostril
    return c


def junk_cell(mc, kind):
    rgb, Mat, Cv, shade, tint, mix = mc.rgb, mc.Mat, mc.Cv, mc.shade, mc.tint, mc.mix
    rows, ellipse, hsh = mc.rows, mc.ellipse, mc.hsh
    c = Cv(CW, CH)
    weed = rgb('#3f7a3c')
    if kind == 'boot':                                                        # an old work boot, side on, toe to the right
        leather = Mat('#7a4a28', hi='#a8703e', lo='#4a2a16')
        c.part(rows(12, 3, 20, 15), leather, hi='tl', lo='r')               # the shaft
        c.part(rows(12, 13, 30, 18) + [(12, 26, 29), (11, 27, 28)], leather, hi='t', lo='rb')   # the foot and the toe cap
        c.part(rows(11, 19, 31, 21), Mat('#2a2220', hi='#4a403a', lo='#140e0c'), hi='t', lo='b')   # the sole
        for y in range(5, 14, 2):                                             # the laces, criss-cross up the front
            c.px(20, y, rgb('#d8c8a0')); c.px(19, y + 1, rgb('#d8c8a0'))
        c.rect(12, 3, 20, 3, tint(leather.hi, 0.2))
        c.rect(13, 3, 14, 7, shade(leather.base, 0.3))                        # the dark inside, at the top
        for y in range(14, 23):                                               # weed hanging off the heel
            c.px(10 - (y - 14) // 3, y, weed)
        c.px(24, 15, rgb('#c0b090')); c.px(25, 16, rgb('#c0b090'))           # a scuff
    elif kind == 'tire':                                                      # a tire, leaning, seen a little from the side
        for y, a, b in ellipse(20, 12, 13, 10):
            for x in range(a, b + 1):
                d = ((x - 20) / 13) ** 2 + ((y - 12) / 10) ** 2
                if d < 0.22:
                    continue                                                  # the hole in the middle
                col = rgb('#2a2a2e') if d > 0.62 else rgb('#3c3c42')
                if d > 0.62 and (x + y) % 3 == 0:
                    col = rgb('#1a1a1e')                                      # the tread
                if y < 8 and d > 0.35 and d < 0.62:
                    col = rgb('#56565e')                                      # the sidewall, lit along the top
                c.px(x, y, col)
        for y, a, b in ellipse(20, 12, 6, 4.5):
            for x in range(a, b + 1):
                if ((x - 20) / 6) ** 2 + ((y - 12) / 4.5) ** 2 > 0.6:
                    c.px(x, y, rgb('#6a6a72'))                                # the bead round the hole
        for x, y in ((10, 18), (11, 19), (28, 17), (29, 18), (30, 18)):
            c.px(x, y, rgb('#5a4a2a'))                                        # lake muck
        for y in range(14, 24):
            c.px(32 + (y % 2), y, weed)
    elif kind == 'duck':                                                      # a rubber duck, facing right
        yel = Mat('#f6d02a', hi='#fff07a', lo='#d09a10')
        c.part(ellipse(17, 15, 10, 6), yel, hi='tl', lo='rb')                 # the body
        c.part(ellipse(25, 7, 5.5, 5), yel, hi='tl', lo='rb')                 # the head
        c.part(rows(29, 7, 33, 9) + [(10, 29, 32)], Mat('#f2701e', hi='#ff9a4a', lo='#c04a10'), hi='t', lo='b')   # the bill
        c.rect(26, 5, 27, 6, rgb('#141016')); c.px(26, 5, rgb('#ffffff'))
        c.part(rows(9, 11, 12, 13), Mat('#f6d02a', hi='#fff07a', lo='#d09a10'), hi='t', lo='b')   # the tail flick
        for x in range(13, 21):
            c.px(x, 13, yel.lo if x % 3 else yel.base)                        # the wing
        c.px(13, 10, rgb('#fffbe0')); c.px(22, 4, rgb('#fffbe0'))
    elif kind == 'bottle':                                                    # a green bottle, a cork, a rolled note inside
        glass = Mat('#3a8a5a', hi='#7ac89a', lo='#1e5a38')
        c.part(rows(6, 8, 28, 16), glass, hi='t', lo='b')
        c.part(rows(29, 10, 33, 14), glass, hi='t', lo='b')                   # the neck
        c.part(rows(34, 10, 36, 14), Mat('#c49a62', hi='#e0bb82', lo='#8a6a3e'), hi='t', lo='b')   # the cork
        c.part(rows(11, 10, 23, 14), Mat('#f2e8c8', hi='#fffbe8', lo='#c8b890'), hi='t', lo='b')   # the note, rolled
        c.rect(15, 10, 15, 14, rgb('#c8402a'))                                # tied with red string
        c.rect(8, 9, 26, 9, tint(glass.hi, 0.3))                              # the glint along the glass
        for x in (8, 9, 27, 28):
            c.px(x, 17, rgb('#2a4a2a'))
    elif kind == 'controller':                                                # a game controller, dark grey, dripping
        body = Mat('#3a3c46', hi='#5a5e6c', lo='#1e1f26')
        c.part(rows(8, 6, 32, 13) + rows(6, 9, 15, 18) + rows(25, 9, 34, 18), body, hi='tl', lo='rb')
        for dx, dy in ((0, -2), (0, 2), (-2, 0), (2, 0), (0, 0)):            # the d-pad
            c.px(12 + dx, 10 + dy, rgb('#141418'))
        for (dx, dy, col) in ((0, -2, '#e8c030'), (2, 0, '#d84040'), (-2, 0, '#4a8ae8'), (0, 2, '#4ac860')):
            c.px(28 + dx, 10 + dy, rgb(col)); c.px(28 + dx, 10 + dy - 1 if dy < 0 else 10 + dy, rgb(col))
        c.rect(18, 9, 19, 9, rgb('#7a7e8c')); c.rect(21, 9, 22, 9, rgb('#7a7e8c'))   # select and start
        c.part(ellipse(16, 15, 2, 1.5), Mat('#26272e'), hi='t', lo='b'); c.part(ellipse(24, 15, 2, 1.5), Mat('#26272e'), hi='t', lo='b')
        for y in range(1, 6):                                                 # the cable, out of the top
            c.px(20 + (y % 2), y, rgb('#26272e'))
        for x, y in ((9, 20), (30, 21), (31, 22)):
            c.px(x, y, rgb('#8ac8e8'))                                        # drips
    elif kind == 'chest':                                                     # a treasure chest, a little open, gold spilling
        wood = Mat('#7a4a22', hi='#a8703a', lo='#4a2a12')
        c.part(rows(8, 10, 32, 21), wood, hi='tl', lo='rb')                   # the box
        c.part(rows(8, 4, 32, 9) + [(3, 10, 30)], wood, hi='t', lo='b')       # the lid, rounded, lifted
        for x in (8, 19, 20, 31):
            c.rect(x, 4, x, 21, rgb('#c8a040'))                               # iron bands, gilded
        c.rect(8, 10, 32, 10, rgb('#2a1a0a'))                                 # the gap under the lid
        for x in range(10, 31):
            if x % 2:
                c.px(x, 10, rgb('#ffd84a'))                                   # gold, glinting in the gap
        c.part(rows(18, 12, 22, 16), Mat('#d8b040', hi='#fff0a0', lo='#8a6a10'), hi='tl', lo='rb')   # the lock
        c.px(20, 14, rgb('#2a1a0a')); c.px(20, 15, rgb('#2a1a0a'))
        for x, y in ((6, 21), (5, 22), (34, 21), (35, 22), (33, 22)):
            c.px(x, y, rgb('#ffd84a'))                                        # coins spilled
        c.px(12, 2, rgb('#fffbe0')); c.px(28, 1, rgb('#fffbe0'))
    elif kind == 'cone':                                                      # a traffic cone, on its side
        orange = Mat('#f2701e', hi='#ff9a4a', lo='#b84a10')
        for x in range(10, 33):
            r = 1.5 + (x - 10) * 0.28
            c.part([(y, x, x) for y in range(int(12 - r), int(12 + r) + 1)], orange, hi='t', lo='b')
        for x in (17, 18, 24, 25):
            for y in range(int(12 - (1.5 + (x - 10) * 0.28)), int(12 + 1.5 + (x - 10) * 0.28) + 1):
                c.px(x, y, rgb('#f4f4f0') if y > 8 else rgb('#ffffff'))       # its white bands
        c.part(rows(33, 4, 35, 21), Mat('#2a2a2e', hi='#4a4a52', lo='#141418'), hi='l', lo='r')   # the base
        for y in range(16, 23):
            c.px(8 + y % 2, y, weed)
    elif kind == 'can':                                                       # a soda can, red, dented
        red = Mat('#c8282a', hi='#f05a5a', lo='#7a1414')
        c.part(rows(14, 4, 26, 21), red, hi='l', lo='r')
        c.part(rows(14, 3, 26, 4), Mat('#b8bcc4', hi='#e8ecf2', lo='#7a7e86'), hi='t', lo='b')   # the top
        c.part(rows(14, 21, 26, 22), Mat('#b8bcc4', hi='#e8ecf2', lo='#7a7e86'), hi='t', lo='b')
        c.rect(15, 10, 25, 12, rgb('#f4f0e8'))                                # a white swoosh
        c.rect(16, 11, 22, 11, rgb('#c8282a'))
        c.rect(23, 14, 24, 17, red.lo)                                        # the dent
        c.px(19, 2, rgb('#7a7e86')); c.px(20, 2, rgb('#7a7e86'))              # the ring pull
        for x, y in ((11, 8), (29, 12), (28, 16)):
            c.px(x, y, rgb('#d8eef4'))                                        # bubbles
    elif kind == 'shades':                                                    # sunglasses, cool as ever
        frame = Mat('#1e1e24', hi='#3a3a44', lo='#0a0a0e')
        c.part(rows(6, 8, 18, 15) + rows(22, 8, 34, 15), frame, hi='t', lo='b')
        c.part(rows(7, 9, 17, 14), Mat('#2a3a5a', hi='#5a7aaa', lo='#141e30'), hi='tl', lo='rb')
        c.part(rows(23, 9, 33, 14), Mat('#2a3a5a', hi='#5a7aaa', lo='#141e30'), hi='tl', lo='rb')
        c.rect(18, 9, 22, 10, frame.base)                                     # the bridge
        c.rect(3, 8, 6, 9, frame.base); c.rect(34, 8, 37, 9, frame.base)      # the arms
        for d in range(3):
            c.px(9 + d, 10 + d, rgb('#c8dcff')); c.px(25 + d, 10 + d, rgb('#c8dcff'))   # a glint across each lens
    elif kind == 'skeleton':                                                  # a fish skeleton: head, spine, ribs and tail
        bone, dim = rgb('#ece6d0'), rgb('#b8b098')
        c.rect(7, 12, 27, 12, bone)                                           # the spine
        for x in range(9, 26, 3):
            for d in range(1, 5):
                c.px(x + d // 2, 12 - d, bone if d < 4 else dim); c.px(x + d // 2, 12 + d, bone if d < 4 else dim)
        for d in range(5):                                                    # the tail
            c.px(6 - d, 12 - d, bone); c.px(6 - d, 12 + d, bone)
        c.part(rows(27, 7, 35, 17) + [(6, 28, 33), (18, 28, 33)], Mat('#ece6d0', hi='#fffbf0', lo='#b8b098'), hi='t', lo='b')   # the skull
        c.rect(31, 10, 32, 11, rgb('#141016'))                                # the eye hole
        for x in (31, 33):
            c.px(x, 15, rgb('#4a4436'))                                       # teeth gaps
    elif kind == 'golfball':                                                  # a golf ball (from the putting green, surely)
        c.part(ellipse(20, 12, 7, 7), Mat('#f4f4f0', hi='#ffffff', lo='#b8b8b4'), hi='tl', lo='rb')
        for x, y in ((17, 9), (21, 8), (24, 11), (18, 13), (22, 14), (16, 16), (25, 15), (20, 17)):
            c.px(x, y, rgb('#c8c8c4'))                                        # its dimples
        c.px(29, 18, rgb('#5a4a2a')); c.px(30, 19, rgb('#5a4a2a')); c.px(28, 19, weed)   # a little lake muck
    elif kind == 'eightball':                                                 # the 8-ball, gone missing from the pool table
        c.part(ellipse(20, 12, 8, 8), Mat('#1e1e24', hi='#4a4a56', lo='#0a0a0e'), hi='tl', lo='rb')
        c.part(ellipse(18, 10, 4, 4), Mat('#f4f2ec', hi='#ffffff', lo='#c8c4b8'), hi='t', lo='b')
        for y, row in enumerate(('###', '#.#', '###', '#.#', '###')):
            for x, ch in enumerate(row):
                if ch == '#':
                    c.px(17 + x, 8 + y, rgb('#141016'))                       # the 8
        c.px(15, 6, rgb('#ffffff')); c.px(14, 7, rgb('#8a8a96'))
    elif kind == 'pin':                                                       # a bowling pin, lying down, its red stripes
        white = Mat('#f2f0ea', hi='#ffffff', lo='#bab6aa')
        for x in range(6, 35):
            t = (x - 6) / 28
            r = 3.6 * (0.55 + 0.45 * math.sin(math.pi * min(1, t * 1.4))) if t < 0.62 else 1.6 + 2.2 * math.sin(math.pi * (t - 0.62) / 0.38)
            c.part([(y, x, x) for y in range(int(round(12 - r)), int(round(12 + r)) + 1)], white, hi='t', lo='b')
        for x in (27, 29):
            for y in range(9, 16):
                c.px(x, y, rgb('#d8302a') if 9 < y < 15 else rgb('#a81e1a'))
    elif kind == 'gnome':                                                     # a garden gnome, red hat, white beard, smiling
        c.part([(y, 18 - (y - 1) // 2, 21 + (y - 1) // 2) for y in range(1, 10)], Mat('#d8302a', hi='#f05a4a', lo='#8a1a14'), hi='l', lo='r')   # the hat
        c.part(rows(16, 10, 23, 13), Mat('#f0c8a0', hi='#ffe0c0', lo='#c89870'), hi='t', lo='b')   # the face
        c.px(18, 11, rgb('#141016')); c.px(21, 11, rgb('#141016')); c.px(19, 12, rgb('#e07a6a'))
        c.part(rows(15, 13, 24, 18) + [(19, 17, 22)], Mat('#f4f2ec', hi='#ffffff', lo='#c8c4b8'), hi='t', lo='b')   # the beard
        c.part(rows(15, 18, 24, 21), Mat('#3a6ac8', hi='#5a8ae8', lo='#24448a'), hi='t', lo='b')   # the coat
        c.part(rows(15, 22, 18, 23) + rows(21, 22, 24, 23), Mat('#5a3a1e'), hi='t', lo='b')   # the boots
        for y in range(16, 24):
            c.px(26 + y % 2, y, weed)
    elif kind == 'sailboat':                                                  # a toy sailboat, its sail a little torn
        c.part([(y, 8 + (y - 15), 32 - (y - 15)) for y in range(15, 20)], Mat('#c8402a', hi='#f06a4a', lo='#8a2414'), hi='t', lo='b')   # the hull
        c.rect(20, 3, 20, 15, rgb('#5a3a1e'))                                 # the mast
        c.part([(y, 21, 21 + (y - 3) * 9 // 11) for y in range(3, 14)], Mat('#f4f2ec', hi='#ffffff', lo='#c8c4b8'), hi='l', lo='r')   # the sail
        c.part([(y, 19 - (y - 5) * 6 // 9, 19) for y in range(5, 14)], Mat('#e8d878', hi='#fff4a0', lo='#b8a848'), hi='r', lo='l')   # the jib
        c.px(26, 9, rgb('#3a6a8a')); c.px(27, 10, rgb('#3a6a8a'))             # the tear
        c.rect(20, 2, 22, 2, rgb('#3a6ac8'))                                  # a pennant
    elif kind == 'pizza':                                                     # a soggy pizza box, a slice still in it
        c.part(rows(5, 10, 35, 20), Mat('#c8a46a', hi='#e8c88a', lo='#8a6a3a'), hi='t', lo='b')   # the box
        c.part([(y, 7 + (9 - y) // 3, 33 + (9 - y) // 3) for y in range(1, 10)], Mat('#d8b47a', hi='#f0d098', lo='#a8844a'), hi='t', lo='b')   # its lid, open
        c.part([(y, 10 + (9 - y) // 3, 30 + (9 - y) // 3) for y in range(3, 8)], Mat('#e8c890', hi='#f8dcaa', lo='#c8a46a'))   # (the inside of it)
        c.px(20, 4, rgb('#c8a046')); c.px(24, 6, rgb('#c8a046'))             # grease spots
        c.part([(y, 12 + (y - 12) * 2, 24 - (y - 12)) for y in range(12, 18)], Mat('#e8b040', hi='#ffd060', lo='#b8801a'), hi='t', lo='b')   # the slice
        for x, y in ((15, 13), (19, 14), (17, 15)):
            c.px(x, y, rgb('#c8281e'))                                        # pepperoni
        c.rect(12, 12, 24, 12, rgb('#c88a3a'))                                # the crust
        c.rect(14, 18, 19, 18, rgb('#a8844a'))
        c.px(26, 15, rgb('#d8302a')); c.px(27, 15, rgb('#d8302a'))           # the logo, faded
    elif kind == 'flipflop':                                                  # one flip-flop, from above: a foot-shaped sole, a yellow strap
        sole = Mat('#3aa8c8', hi='#6ad0e8', lo='#1e7a96')
        pts = ellipse(12, 12, 5.5, 4.5) + ellipse(26, 12, 7.5, 5.5) + rows(14, 9, 22, 15)
        c.part(pts, sole, hi='t', lo='b')
        for x in range(9, 33):
            c.px(x, 12 + (1 if x % 5 == 0 else 0), sole.base)
        for d in range(8):                                                    # the strap, from the toe post back to both sides
            c.px(29 - d, 12 - d // 2, rgb('#f2d02a')); c.px(29 - d, 13 + d // 2, rgb('#f2d02a'))
            if d < 7:
                c.px(29 - d, 11 - d // 2, rgb('#c8a010')); c.px(29 - d, 14 + d // 2, rgb('#c8a010'))
        c.rect(29, 12, 30, 13, rgb('#f8e070'))                                # the toe post
    elif kind == 'crown':                                                     # a lost crown, gold and jewelled
        gold = Mat('#e0a82a', hi='#ffe070', lo='#9a6a10')
        c.part(rows(9, 13, 31, 20), gold, hi='t', lo='b')                     # the band
        for px_ in (9, 15, 20, 25, 31):                                       # its points
            c.part([(y, px_ - (y - 5) // 3, px_ + (y - 5) // 3) for y in range(5, 13)], gold, hi='t', lo='rb')
            c.part(ellipse(px_, 4, 1.2, 1.2), Mat('#fff0b0'), hi='t', lo='b')
        for jx, col in ((14, '#d8302a'), (20, '#3a6ae8'), (26, '#3ac860')):
            c.rect(jx, 15, jx + 1, 17, rgb(col)); c.px(jx, 15, rgb('#ffffff'))
        c.rect(9, 19, 31, 20, gold.lo)
        for y in range(18, 24):
            c.px(33 + y % 2, y, weed)
    elif kind == 'ring':                                                      # a diamond ring
        band = Mat('#e0b040', hi='#fff0a0', lo='#9a7010')
        for y, a, b in ellipse(20, 15, 7, 5):
            for x in range(a, b + 1):
                if ((x - 20) / 7) ** 2 + ((y - 15) / 5) ** 2 > 0.5:
                    c.px(x, y, band.hi if y < 13 else band.base if y < 17 else band.lo)
        c.part([(y, 20 - (y - 3), 20 + (y - 3)) for y in range(3, 7)] + [(y, 17 + (y - 7), 23 - (y - 7)) for y in range(7, 10)], Mat('#d8f4ff', hi='#ffffff', lo='#7ac0e0'), hi='tl', lo='rb')   # the diamond
        for x, y in ((15, 2), (26, 3), (13, 7), (28, 8)):
            c.px(x, y, rgb('#ffffff'))                                        # sparkle
    elif kind == 'phone':                                                     # an old candybar phone
        body = Mat('#5a6a7a', hi='#8a9aaa', lo='#34404c')
        c.part(rows(13, 3, 26, 21) + [(2, 14, 25), (22, 14, 25)], body, hi='tl', lo='rb')
        c.part(rows(15, 5, 24, 10), Mat('#9ab83a', hi='#c4dc6a', lo='#6a8a20'), hi='t', lo='b')   # the green screen
        c.rect(16, 6, 18, 6, rgb('#2a3a10')); c.rect(21, 6, 23, 6, rgb('#2a3a10'))   # the bars and the battery
        c.rect(16, 8, 21, 8, rgb('#2a3a10'))                                  # a snake
        c.px(21, 9, rgb('#2a3a10'))
        for ky in (13, 16, 19):                                               # the keypad
            for kx in (15, 19, 23):
                c.rect(kx, ky, kx + 1, ky + 1, rgb('#c8ccd4')); c.px(kx + 1, ky + 1, rgb('#7a7e88'))
        c.rect(18, 11, 21, 11, rgb('#2a2e36'))
        c.rect(26, 1, 27, 3, body.lo)                                         # the stubby aerial
    return c


def catch_sheet(mc):
    order = ['bluegill', 'perch', 'crappie', 'bass', 'catfish', 'trout', 'muskie', 'golden', 'boot', 'tire', 'duck', 'bottle', 'controller', 'phone',
             'walleye', 'carp', 'gar', 'sturgeon', 'eel', 'ghost', 'serpent', 'chest', 'cone', 'can', 'shades', 'skeleton',
             'pumpkinseed', 'smallmouth', 'bullhead', 'bowfin', 'goldfish', 'koi', 'crayfish', 'paddlefish', 'coelacanth', 'clockwork',
             'golfball', 'eightball', 'pin', 'gnome', 'sailboat', 'pizza', 'flipflop', 'crown', 'ring']
    sheet = np.zeros((CH, CW * len(order), 4), np.uint8)
    for k, kind in enumerate(order):
        cell = fish_cell(mc, FISH[kind]) if kind in FISH else long_cell(mc, kind) if kind in ('eel', 'serpent', 'crayfish') else junk_cell(mc, kind)
        a = mc.outline(np.pad(cell.a, ((1, 1), (1, 1), (0, 0))))[1:-1, 1:-1]
        sheet[:, k * CW:(k + 1) * CW] = a
    return sheet


# ───────────────────────── the scene ─────────────────────────

def draw(mc, L):
    rgb, mix, shade, tint, Mat, Cv, base = mc.rgb, mc.mix, mc.shade, mc.tint, mc.Mat, mc.Cv, mc.base
    W, H, hsh, noise = mc.W, mc.H, mc.hsh, mc.noise
    rows, ellipse = mc.rows, mc.ellipse
    L['outdoors'] = True
    L['view'] = [0, 0, W, H]
    art.setup(mc)
    S = art.S                                                              # what the season does to it (_seasons.py)
    S.begin(mc)
    snowy, cold = S.season(mc) == 'snow', S.cold(mc)

    def put(draw, over=None, shadow=False, fine=None, snow=True):
        """As the campsite's: outlined on a canvas one dot bigger all round, so nothing comes back in at the far edge.
        Under snow, snow lies along its tops; `fine` (a bare tree's twigs) is laid on after the outline."""
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

    fs = [far_shore(x) for x in range(W)]
    ns = [near_shore(x) for x in range(W)]

    # ── the ground: grass, a strip of sand and mud along the water, the forest floor up on the far shore ──
    tile = mc.grass_tile()
    G = mc.GREENS
    needles = [rgb('#5a4a2e'), rgb('#4a3c26'), rgb('#6e5a36'), rgb('#3c3220')]
    sand = [rgb('#c8b080'), rgb('#b89c6c'), rgb('#d8c498'), rgb('#a08a5e')]
    mud = rgb('#6a5a3e')
    dirt = [rgb('#8a6a46'), rgb('#775a3a'), rgb('#a18358')]
    # the water's colours, shallow to deep, and its sparkle
    shallow, mid_, deep = rgb('#4a8c8a'), rgb('#2f6a86'), rgb('#1f4a6a')
    for y in range(H):
        for x in range(W):
            f, n_ = fs[x], ns[x]
            if f < y < n_:
                d = min(y - f, n_ - y)
                t = min(1.0, d / 46)
                col = mix(shallow, mid_, t / 0.5) if t < 0.5 else mix(mid_, deep, (t - 0.5) / 0.5)
                lump = noise(x, y, 22, 31) * 0.5 + noise(x, y, 9, 32) * 0.25
                col = tint(col, 0.05 * lump) if lump > 0 else shade(col, -0.06 * lump)
                # little waves: short pale dashes, here and there, a dark one under each
                if (y * 7 + (x // 5) * 3) % 11 == 0 and hsh(x // 5, y, 33) % 4 == 0 and d > 3:
                    col = tint(col, 0.22)
                elif (y * 7 + 7 + (x // 5) * 3) % 11 == 0 and hsh(x // 5, y - 1, 33) % 4 == 0 and d > 3:
                    col = shade(col, 0.1)
                if n_ - y < 1.6:
                    col = tint(col, 0.35) if (x // 2 + y) % 3 else tint(col, 0.15)     # the lap of the water at the edge
                base.px(x, y, col)
                continue
            if y <= f:                                                     # the far shore: under the trees
                i = tile[y % 32][x % 32]
                col = needles[hsh(x, y // 2, 71) % 4] if f - y > 5 or hsh(x, y, 72) % 3 else G[max(0, i - 1)]
                if f - y < 2:
                    col = mud
                base.px(x, y, col)
                continue
            # the near shore: sand by the water, then grass
            i = tile[y % 32][x % 32]
            n = noise(x, y, 40, 7)
            if n > 0.3 and i == 2 and (x * 3 + y) % 4 < 2:
                i = 1
            col = G[i]
            if n < -0.45 and i >= 2 and (x + y * 3) % 5 < 2:
                col = mc.DRY
            band = y - n_
            edge = 5 + noise(x, y, 11, 34) * 3
            if band < 1.5:
                col = mud
            elif band < edge:
                col = sand[hsh(x, y, 35) % 4] if band > 2.5 else shade(sand[hsh(x, y, 35) % 4], 0.25)
            elif band < edge + 3 and hsh(x, y, 36) % 3 == 0:
                col = sand[hsh(x, y, 37) % 4]
            base.px(x, y, col)

    # leaves lying about in the fall, petals in the spring (on the grass of the near shore)
    grass = set(G) | {mc.DRY}
    S.litter(mc, base, lambda x, y: y > ns[min(W - 1, max(0, x))] and base.get(x, y) in grass, seed=5)
    # the path from the campsite: up from the bottom edge, curving to the foot of the dock
    for y in range(240, H):
        cxp = 202 + (306 - 202) * max(0.0, min(1.0, (300 - y) / 40)) ** 1.5 if y < 300 else 202 + 6 * math.sin(y / 9)
        half = 7 + noise(cxp, y, 7, 12) * 2
        for x in range(int(cxp - half - 2), int(cxp + half + 3)):
            if 0 <= x < W and not is_water(x, y) and y > ns[x] + 4:
                k = abs(x - cxp) / half
                if k < 1 or (k < 1.3 and hsh(x, y, 38) % 3 == 0):
                    h = hsh(x, y, 39) % 20
                    base.px(x, y, dirt[0] if h < 12 else dirt[1] if h < 17 else dirt[2])

    # ── the far shore: woods in three rows, the furthest the darkest; their reflection in the water ──
    def plant(kind, x, y, var, over=None, dark=0.0):
        t, sh, fine = S.tree(mc, kind, var)
        for cv in (t, fine):
            if dark and cv is not None:
                a = cv.a.astype(np.float32)
                a[..., :3] = a[..., :3] * (1 - dark) + np.array([8, 22, 16], np.float32) * dark
                cv.a = a.astype(np.uint8)
        put(at(t, x, y), over=over, fine=fine and (lambda a: S.lay(mc, a, fine, x - t.w // 2, y - t.h + 1)))
    kinds = ('pine', 'oak', 'pine', 'maple', 'pine', 'birch', 'pine', 'oak')
    for k, x in enumerate(range(-10, 560, 28)):
        plant(kinds[k % 8], x, 14 + hsh(k, 1, 500) % 8, k + 300, dark=0.35)
    for k, x in enumerate(range(4, 548, 36)):
        f = int(min(fs[max(0, min(W - 1, x + d))] for d in range(-6, 7)))
        plant(kinds[(k + 3) % 8], x + hsh(k, 2, 500) % 9, min(f - 6, 32 + hsh(k, 3, 500) % 8), k + 330, dark=0.15)
    for k in range(30):                                                     # bushes and long grass down to the water's edge
        x = 4 + k * 18 + hsh(k, 4, 500) % 8
        f = int(fs[min(W - 1, x)])
        put(at(art.bush(6 + hsh(k, 5, 500) % 4, seed=k + 200, dark=0.1), x, f - 1))
    # the reflection: the far shore upside down in the water, darker, broken by the ripples
    src = base.a.copy()
    for x in range(W):
        f = fs[x]
        for d in range(1, 38):
            y = int(f) + d
            if y >= H or not is_water(x, y):
                break
            if (y + hsh(x // 6, y, 40) % 3) % 4 == 0:
                continue                                                    # a ripple, between the lines of it
            sx = x + int(round(math.sin(y * 0.9) * 1.2))
            sy = int(f) - d
            if not (0 <= sx < W and 0 <= sy < H) or not src[sy, sx, 3]:
                continue
            k = 0.55 * (1 - d / 38)
            cur = base.get(x, y)
            base.px(x, y, mix(cur, shade(tuple(int(v) for v in src[sy, sx, :3]), 0.3), k))

    # ── lily pads off to the east, and a few off the west shore; reeds and cattails along the near shore ──
    def lily(c, x, y, r, seed, flower=False):
        g = Mat('#4a9a3c', hi='#7ac45a', lo='#2a6a2a') if not cold else Mat('#7a7040', hi='#9a8e58', lo='#4e4a2c')   # (gone brown in winter)
        if S.season(mc) == 'fall':
            g = Mat('#7a8a34', hi='#a2ac4a', lo='#4e5a22')
            flower = False
        if cold:
            flower = False
        notch = hsh(seed, 1, 41) % 6
        for yy, a, b in ellipse(x, y, r, r * 0.62):
            for xx in range(a, b + 1):
                ang = math.atan2((yy - y) / 0.62, xx - x)
                if abs(((ang + math.pi) / (2 * math.pi) * 6 - notch) % 6 - 0) < 0.35:
                    continue                                                # the notch cut into the pad
                d = ((xx - x) / r) ** 2 + ((yy - y) / (r * 0.62)) ** 2
                col = g.hi if (d > 0.6 and yy < y and xx < x + 1) else g.lo if (d > 0.7 and (yy > y or xx > x + 1)) else g.base
                if (xx - x) * (yy - y) == 0 and d < 0.6 and (xx + yy) % 2:
                    col = shade(g.base, 0.12)                               # its veins
                c.px(xx, yy, col)
        if flower:
            for (dx, dy, col) in ((0, -2, '#ffffff'), (-1, -1, '#f8d8e8'), (1, -1, '#f8d8e8'), (0, -1, '#f2c030'), (-2, -1, '#ffffff'), (2, -1, '#ffffff'), (0, 0, '#f0b8d0')):
                c.px(x + dx, y + dy - 1, rgb(col))

    def pads(c):
        for k in range(16):
            ang, rr = hsh(k, 2, 42) % 628 / 100, (hsh(k, 3, 42) % 100) / 100
            x = 425 + math.cos(ang) * 36 * rr ** 0.7
            y = 184 + math.sin(ang) * 20 * rr ** 0.7
            lily(c, round(x), round(y), 4 + hsh(k, 4, 42) % 3, k, flower=k % 5 == 1)
        for k in range(6):
            lily(c, 92 + hsh(k, 5, 42) % 30, 120 + hsh(k, 6, 42) % 18, 3 + hsh(k, 7, 42) % 2, k + 20, flower=k == 2)
    put(pads, snow=False)

    def reeds(c, x0, x1, ybase, n, seed):
        stalk = {'fall': ['#6a6a2a', '#8a8a3a', '#b0a04a'], 'winter': ['#6a5a3a', '#8a7650', '#a89068'],
                 'snow': ['#6a5a3a', '#8a7650', '#a89068']}.get(S.season(mc), ['#3a6a2a', '#5a8a3a', '#7aa84a'])
        stalk = [rgb(x) for x in stalk]
        for k in range(n):
            x = x0 + hsh(k, 1, seed) % max(1, x1 - x0)
            y = int(ybase(x)) + hsh(k, 2, seed) % 4
            h = 10 + hsh(k, 3, seed) % 9
            lean = (hsh(k, 4, seed) % 5 - 2) * 0.12
            for i in range(h):
                c.px(round(x + lean * i), y - i, stalk[0 if i < 3 else 1 + (i + k) % 2])
            if k % 3 == 0:                                                  # a cattail on top
                tx, ty = round(x + lean * h), y - h
                c.rect(tx - 1, ty - 4, tx, ty, rgb('#6a3a1e')); c.px(tx - 1, ty - 4, rgb('#9a5a2e')); c.px(tx, ty - 5, stalk[1])
            elif k % 3 == 1:                                                # a blade bending over
                for i in range(4):
                    c.px(round(x + lean * h) + i, y - h + i // 2, stalk[2])
    put(lambda c: reeds(c, 164, 232, lambda x: near_shore(x) - 2, 22, 43), over=250)
    put(lambda c: reeds(c, 330, 520, lambda x: near_shore(x) - 2, 40, 44), over=246)
    put(lambda c: reeds(c, 126, 150, lambda x: near_shore(x) - 1, 8, 45), over=246)
    put(lambda c: reeds(c, 0, 520, lambda x: far_shore(x) + 3, 50, 46))

    # a buoy out over the deep water, and two rocks breaking the surface. The rings of water spreading out round each are
    # the page's (lake.tsx, `wakes`: x, y and the ring's size where it starts, and the part standing up out of the water
    # that the ring's far side passes behind)
    L['things']['wakes'] = []

    def ring(x, y, rx, ry, cut=None):
        L['things']['wakes'].append([x, y, rx, ry, cut])

    def buoy(c):
        bx, by = 404, 86
        c.part(ellipse(bx, by + 3, 4, 2), Mat('#e8e4dc', hi='#ffffff', lo='#b8b4ac'), hi='t', lo='b')
        c.part(rows(bx - 3, by - 6, bx + 3, by + 2), Mat('#e8402a', hi='#ff7a5a', lo='#a82a1a'), hi='l', lo='r')
        c.rect(bx - 3, by - 3, bx + 3, by - 2, rgb('#f6f2ea'))
        c.rect(bx, by - 9, bx, by - 7, rgb('#3a3a40'))
    ring(404, 89, 6, 2.5, [400, 76, 408, 89])
    put(buoy)
    stone = Mat('#8a8780', hi='#b4b0a6', lo='#5a5750')
    for (x, y, rx, ry) in ((56, 168, 7, 4), (64, 172, 4, 2.5), (486, 118, 6, 3.5)):
        ring(x, y + 1, rx + 2, ry + 2)
        put(lambda c, x=x, y=y, rx=rx, ry=ry: c.part(ellipse(x, y, rx, ry), stone, hi='tl', lo='rb'))

    # ── the rowboat, tied up west of the stem: green paint outside, varnished wood inside, two thwarts and the oars ──
    bx0, bx1, by0, by1 = BOAT
    bcx, bcy = (bx0 + bx1) / 2, (by0 + by1) / 2

    def boat(c):
        hull = Mat('#2f6a4a', hi='#4a9a6a', lo='#1a4a30')
        wood = Mat('#b07a44', hi='#d8a468', lo='#7a5028')
        hw = (bx1 - bx0) / 2
        for x in range(bx0, bx1 + 1):
            t = (x - bx0) / (bx1 - bx0)
            half = (by1 - by0) / 2 * (math.sin(math.pi * min(1, t * 0.85 + 0.15)) ** 0.6 if t > 0.5 else min(1, 0.75 + t))   # the bow, to the right
            for y in range(int(bcy - half), int(bcy + half) + 1):
                inner = abs(y - bcy) < half - 2.5 and bx0 + 2 < x < bx1 - 4
                col = wood.base if inner else hull.hi if y < bcy else hull.lo
                if inner and (y - int(bcy)) % 3 == 0:
                    col = wood.lo                                           # the boards inside
                if not inner and y >= bcy + half - 1:
                    col = shade(hull.lo, 0.2)
                c.px(x, y, col)
        for tx in (bx0 + 12, bx0 + 28):                                     # the thwarts
            c.rect(tx, int(bcy - (by1 - by0) / 2) + 2, tx + 3, int(bcy + (by1 - by0) / 2) - 2, wood.hi)
            c.rect(tx + 3, int(bcy - (by1 - by0) / 2) + 2, tx + 3, int(bcy + (by1 - by0) / 2) - 2, wood.lo)
        for k, oy in enumerate((-3, 3)):                                    # the oars, shipped along the inside
            y = int(bcy + oy)
            c.rect(bx0 + 6, y, bx1 - 14, y, rgb('#d8b078'))
            c.rect(bx1 - 14, y - 1, bx1 - 9, y + 1, rgb('#c89a60'))
        c.rect(bx0 + 1, int(bcy) - 1, bx0 + 2, int(bcy) + 1, rgb('#1a3a28'))  # the transom
    # its shadow on the water, and a ring of ripples round the hull
    for y in range(by0 + 2, by1 + 4):
        for x in range(bx0 + 3, bx1 + 4):
            if is_water(x, y) and (((x - bcx - 3) / ((bx1 - bx0) / 2)) ** 2 + ((y - bcy - 3) / ((by1 - by0) / 2)) ** 2) < 1:
                base.px(x, y, shade(base.get(x, y), 0.25))
    put(boat)
    rope = [(bx1 - 2, int(bcy) - 2), (STEM[0] - 1, int(bcy) - 6)]

    def tie(c):
        for i in range(12):
            t = i / 11
            c.px(round(rope[0][0] + (rope[1][0] - rope[0][0]) * t), round(rope[0][1] + (rope[1][1] - rope[0][1]) * t + 2 * math.sin(math.pi * t)), rgb('#d8c8a0'))
    put(tie)

    # ── the dock: grey weathered boards across the stem and along the T, its stringers, the pilings, a ladder ──
    sx0, sx1, sy0, sy1 = STEM
    hx0, hx1, hy0, hy1 = HEAD
    board = [rgb('#a89478'), rgb('#9a8670'), rgb('#b4a084'), rgb('#8e7c66')]
    gap = rgb('#3a3024')

    # its shadow on the water, down and to the right of it (the light is from the top left)
    for y in range(hy0 + 3, sy1 + 6):
        for x in range(hx0 + 3, hx1 + 6):
            if on_dock(x - 4, y - 5) and not on_dock(x, y) and is_water(x, y):
                base.px(x, y, mix(base.get(x, y), (10, 24, 40), 0.42))

    def dock(c):
        for y in range(sy0, sy1 + 1):                                       # the stem: boards across it, 4 deep
            for x in range(sx0, sx1 + 1):
                r = (y - sy0) % 5
                col = gap if r == 4 else board[hsh(0, (y - sy0) // 5, 50) % 4]
                if r != 4:
                    if (x * 3 + y * 7) % 13 == 0 or hsh(x // 4, y, 51) % 9 == 0:
                        col = shade(col, 0.08)                              # the grain
                    if r == 0:
                        col = tint(col, 0.12)
                    if x in (sx0 + 2, sx1 - 2) and r == 2:
                        col = rgb('#4a4a50')                                # the nails, over the stringers
                if x in (sx0, sx1):
                    col = shade(col, 0.28) if x == sx1 else tint(col, 0.08)
                c.px(x, y, col)
        for y in range(hy0, hy1 + 1):                                       # the T: boards the other way, along it
            for x in range(hx0, hx1 + 1):
                r = (x - hx0) % 5
                col = gap if r == 4 else board[hsh((x - hx0) // 5, 1, 52) % 4]
                if r != 4:
                    if (x * 7 + y * 3) % 13 == 0 or hsh(x, y // 4, 53) % 9 == 0:
                        col = shade(col, 0.08)
                    if r == 0:
                        col = tint(col, 0.12)
                    if y in (hy0 + 2, hy1 - 2) and r == 2:
                        col = rgb('#4a4a50')
                if y == hy0:
                    col = tint(col, 0.15)
                c.px(x, y, col)
        beam = Mat('#6e5e4c', hi='#8a7a64', lo='#4a3e30')
        for y in range(hy1 + 1, hy1 + FACE + 1):                            # the T's front beam, over the water
            for x in range(hx0, hx1 + 1):
                if sx0 <= x <= sx1:
                    continue
                c.px(x, y, beam.hi if y == hy1 + 1 else beam.lo if y == hy1 + FACE else beam.base)
        # pilings: round tops at the corners and along the stem, and the T's front ones going down into the water
        piles = [(hx0 + 1, hy0 + 1), (hx1 - 1, hy0 + 1), (hx0 + 1, hy1), (hx1 - 1, hy1), (sx0 - 1, 196), (sx1 + 1, 196), (sx0 - 1, 240), (sx1 + 1, 240),
                 (sx0 - 1, sy1 - 6), (sx1 + 1, sy1 - 6), ((hx0 + sx0) // 2, hy1), ((hx1 + sx1) // 2, hy1)]
        pile = Mat('#5a4a38', hi='#7a6a54', lo='#3a2e22')
        for (px_, py_) in piles:
            if py_ == hy1:                                                  # down the front, into the water
                c.part(rows(px_ - 2, py_ + 1, px_ + 2, py_ + FACE + 5), pile, hi='l', lo='r')
                c.rect(px_ - 2, py_ + FACE + 5, px_ + 2, py_ + FACE + 5, shade(pile.lo, 0.3))
            c.part(ellipse(px_, py_, 2.6, 2), pile, hi='tl', lo='rb')
            c.px(px_, py_, rgb('#8a7a64'))                                  # the sawn top, its rings
        # a ladder down from the T's front, east of the stem
        lx = sx1 + 22
        for y in range(hy1 + 1, hy1 + 12):
            c.px(lx, y, rgb('#b8bcc4')); c.px(lx + 5, y, rgb('#8a8e96'))
            if (y - hy1) % 3 == 0:
                c.rect(lx, y, lx + 5, y, rgb('#d0d4dc'))
    put(dock)
    # rings round the pilings and the ladder, on the water
    for (px_, py_) in [(HEAD[0] + 1, HEAD[3] + FACE + 6), (HEAD[1] - 1, HEAD[3] + FACE + 6), ((HEAD[0] + STEM[0]) // 2, HEAD[3] + FACE + 6), ((HEAD[1] + STEM[1]) // 2, HEAD[3] + FACE + 6)]:
        for dx in range(-5, 6):
            for dy in (-1, 1):
                x, y = px_ + dx, py_ + dy + (0 if abs(dx) > 3 else dy)
                if is_water(x, y) and not on_dock(x, y) and abs(dx) > 2:
                    base.px(x, y, tint(base.get(x, y), 0.25))

    # a bait bucket and a tackle box at the foot of the dock, on the shore
    def kit(c):
        bucket = Mat('#d0d4d8', hi='#f0f2f4', lo='#9aa0a8')
        c.part(rows(sx1 + 6, 258, sx1 + 15, 268), bucket, hi='l', lo='rb')
        c.part(ellipse(sx1 + 10.5, 258, 5, 2), Mat('#3a4a3a', hi='#5a6a4a', lo='#2a3a2a'), hi='t', lo='b')   # the water in it
        c.rect(sx1 + 8, 262, sx1 + 13, 263, rgb('#3a8ae8'))                 # its label, "BAIT"
        for i in range(9):
            c.px(sx1 + 6 + i, 255 - round(2 * math.sin(math.pi * i / 8)), rgb('#5a5e66'))   # the handle
        box = Mat('#2a6ac8', hi='#5a9ae8', lo='#1a4a8a')
        c.part(rows(sx0 - 22, 260, sx0 - 6, 270), box, hi='tl', lo='rb')    # a tackle box: blue, a grey latch and handle
        c.rect(sx0 - 22, 264, sx0 - 6, 264, box.lo)
        c.rect(sx0 - 15, 263, sx0 - 13, 265, rgb('#c8ccd4'))
        c.rect(sx0 - 17, 258, sx0 - 11, 258, rgb('#3a3e46')); c.px(sx0 - 17, 259, rgb('#3a3e46')); c.px(sx0 - 11, 259, rgb('#3a3e46'))
    put(kit, over=270, shadow=True)
    mc.block(sx1 + 6, 256, sx1 + 15, 268)
    mc.block(sx0 - 22, 260, sx0 - 6, 270)

    # ── the bait shop: a plank shack with a tin roof, the door, a window with OPEN in it, BAIT over the door ──
    fx0, fx1, ftop, ffoot = SHOP

    def shop(c):
        plank = Mat('#8a6440', hi='#b08454', lo='#5f4026')
        for y in range(ftop, ffoot + 1):                                    # the front: upright boards
            for x in range(fx0, fx1 + 1):
                r = (x - fx0) % 7
                col = plank.lo if r == 6 else plank.hi if r == 0 else plank.base
                if r not in (0, 6) and hsh(x, y // 3, 60) % 7 == 0:
                    col = shade(plank.base, 0.12)
                if y > ffoot - 3:
                    col = shade(col, 0.25)                                  # damp at the foot
                c.px(x, y, col)
        tin = [rgb('#a8b0b8'), rgb('#c8d0d8'), rgb('#8a9098'), rgb('#6a7078')]
        for y in range(ftop - 26, ftop + 2):                                # the roof: corrugated, the ridge along the top
            inset = max(0, (ftop - 26 + 6) - y)
            for x in range(fx0 - 6 + inset, fx1 + 7 - inset):
                col = tin[(x // 2) % 3] if y < ftop else tin[3]
                if y == ftop - 26 + (6 - inset) and inset >= 0 and y < ftop - 19:
                    col = tint(col, 0.2)
                if hsh(x // 3, y // 4, 61) % 23 == 0:
                    col = mix(col, rgb('#9a5a2a'), 0.5)                     # rust
                c.px(x, y, col)
        c.rect(fx0 - 6, ftop + 1, fx1 + 6, ftop + 2, rgb('#4a5058'))        # the roof's edge, and its shadow
        # the door, on the right: a screen door, propped
        dx0, dx1 = fx1 - 30, fx1 - 12
        c.part(rows(dx0, ftop + 12, dx1, ffoot), Mat('#2a1e16', hi='#3a2a1e', lo='#1a120c'), hi='t', lo='')
        c.rect(dx0 - 1, ftop + 11, dx1 + 1, ftop + 11, plank.hi)
        for x in range(dx0, dx1 + 1, 2):
            for y in range(ftop + 13, ffoot - 1, 2):
                c.px(x, y, rgb('#4a4038'))                                  # the screen's mesh
        c.rect(dx1 - 3, ftop + 26, dx1 - 2, ftop + 27, rgb('#e2c36a'))
        # the window, on the left, with OPEN in it (red, lit at night by the page's light)
        wx0, wx1 = fx0 + 8, fx0 + 44
        c.part(rows(wx0, ftop + 10, wx1, ftop + 28), Mat('#e8e4d8', hi='#ffffff', lo='#b8b4a8'), hi='tl', lo='rb')
        c.part(rows(wx0 + 2, ftop + 12, wx1 - 2, ftop + 26), Mat('#2a3a4a', hi='#3a5a6a', lo='#1a2430'), hi='', lo='')
        c.rect(wx0 + 2, ftop + 13, wx0 + 8, ftop + 13, rgb('#6a8aa8'))      # a glint on the glass
        mc.sign(c, wx0 + 6, ftop + 16, 'OPEN', 1, rgb('#ff5a4a'))
        # BAIT, on a board over the door
        c.part(rows(dx0 - 8, ftop + 1, dx1 + 8, ftop + 10), Mat('#e8dcc0', hi='#fffaf0', lo='#b8a888'), hi='t', lo='rb')
        mc.sign(c, dx0 - 5, ftop + 2, 'BAIT', 1, rgb('#c03a2a'))
        # the lamp over the door
        c.rect(dx1 + 4, ftop + 12, dx1 + 7, ftop + 15, rgb('#22222a')); c.rect(dx1 + 5, ftop + 13, dx1 + 6, ftop + 14, rgb('#ffe9a8'))
        # rods leaning against the wall by the door, and a life ring hung on it
        for k, col in enumerate(('#d8402a', '#2a6ac8')):
            x = fx1 - 6 + k * 3
            for y in range(ftop - 12, ffoot + 1):
                c.px(x + (ffoot - y) // 14, y, rgb(col) if y < ffoot - 10 else rgb('#3a2a1e'))
        for yy, a, b in ellipse(fx0 + 56, ftop + 20, 6, 6):
            for xx in range(a, b + 1):
                d = math.hypot(xx - fx0 - 56, yy - ftop - 20)
                if 3 <= d <= 6.3:
                    ang = math.atan2(yy - ftop - 20, xx - fx0 - 56)
                    c.px(xx, yy, rgb('#ffffff') if int((ang + math.pi) / (math.pi / 2)) % 2 else rgb('#e8402a'))
    shadow((fx0 + fx1) / 2 + 3, ffoot + 2, (fx1 - fx0) / 2 + 6, 4, 0.32, seed=60)
    put(shop, over=ffoot)
    mc.block(fx0 - 4, ftop - 4, fx1 + 4, ffoot)
    L['things']['shop'] = [fx0, ftop - 26, fx1 - fx0 + 1, ffoot - ftop + 27]
    mc.light(fx1 - 6, ftop + 16, 34, 26, '#ffcf80', 0.2)
    mc.light(fx0 + 26, ftop + 20, 22, 14, '#ff8a6a', 0.12)                  # the OPEN sign's glow

    # ── the record board: a painted board on two legs, RECORDS across the top, three mounted fish ──
    rx0, rx1, rtop, rfoot = BOARD

    def board_(c):
        legs = Mat('#6a4a30', hi='#8a6644', lo='#4a3020')
        for lx in (rx0 + 6, rx1 - 9):
            c.part(rows(lx, rtop + 30, lx + 3, rfoot), legs, hi='l', lo='r')
        c.part(rows(rx0, rtop, rx1, rtop + 32), Mat('#5a3a22', hi='#7a5434', lo='#3a2414'), hi='tl', lo='rb')   # the frame
        green = Mat('#2a4a34', hi='#36604a', lo='#1e3626')
        c.part(rows(rx0 + 2, rtop + 2, rx1 - 2, rtop + 30), green, hi='', lo='')
        for y in range(rtop + 3, rtop + 30):                                # a chalkboard's smudges
            for x in range(rx0 + 3, rx1 - 2):
                if hsh(x // 3, y // 2, 62) % 17 == 0:
                    c.px(x, y, mix(green.base, rgb('#c8d8c8'), 0.15))
        mc.sign(c, rx0 + (rx1 - rx0 + 1 - mc.sign_width('RECORDS')) // 2, rtop + 4, 'RECORDS', 1, rgb('#f6f0d8'))
        # three fish mounted on little plaques, and chalk lines beside each
        for k, (col, fl) in enumerate((('#7a9a4a', 9), ('#8a96a4', 11), ('#e8b030', 8))):
            y = rtop + 14 + k * 5
            c.rect(rx0 + 4, y - 1, rx0 + 6 + fl, y + 2, rgb('#7a5434'))
            for i in range(fl):
                h = 1 if 1 < i < fl - 2 else 0
                c.rect(rx0 + 5 + i, y - h + (0 if i > 0 else 0), rx0 + 5 + i, y + h, rgb(col))
            c.px(rx0 + 5 + fl - 2, y, rgb('#141016'))
            for x in range(rx0 + 9 + fl, rx1 - 4):
                if hsh(x, y, 63 + k) % 4:
                    c.px(x, y, rgb('#d8e0d0'))
        c.rect(rx1 - 6, rtop - 4, rx1 - 3, rtop - 1, rgb('#22222a')); c.rect(rx1 - 5, rtop - 3, rx1 - 4, rtop - 2, rgb('#ffe9a8'))   # its lamp
    shadow((rx0 + rx1) / 2 + 2, rfoot + 1, (rx1 - rx0) / 2 + 2, 2.5, 0.3, seed=61)
    put(board_, over=rfoot)
    mc.block(rx0 + 4, rfoot - 4, rx1 - 4, rfoot)
    L['things']['board'] = [rx0 - 2, rtop - 6, rx1 - rx0 + 5, rfoot - rtop + 8]
    mc.light(rx1 - 4, rtop - 2, 24, 18, '#ffcf80', 0.16)

    # ── a lantern on a post at the foot of the T, and the path's torches ──
    lp = art.light_post(30)
    put(at(lp, sx0 - 4, hy0 + 2), over=hy0 + 2)
    lt = art.lantern()
    put(at(lt, sx0 - 2, hy0 - 26), over=hy0 + 3)
    mc.light(sx0 - 2, hy0 - 32, 44, 30, '#ffcf80', 0.22)
    mc.block(sx0 - 6, hy0 - 1, sx0 - 2, hy0 + 2)
    L['things']['torches'] = []
    for x, y in ((186, 300), (226, 304), (262, 276)):
        tk = art.tiki_torch()
        shadow(x + 1, y + 1, 4, 1.5, 0.3, seed=x)
        put(at(tk, x, y), over=y)
        mc.block(x - 1, y - 2, x + 1, y)
        fxx, fyy = x - tk.w // 2 + tk.flame[0], y - tk.h + 1 + tk.flame[1]
        L['things']['torches'].append([fxx, fyy])
        mc.light(fxx, fyy - 3, 30, 22, '#ffa850', 0.2)

    # ── two Adirondack chairs on the east shore, looking out over the water ──
    for cx in (408, 446):
        cy = 284
        put(at(art.adirondack('back'), cx, cy + 2), over=cy + 3)
        shadow(cx + 1, cy + 3, 15, 3, 0.3, seed=cx)
        mc.block(cx - 16, cy - 20, cx + 16, cy + 2)
        L['seats'].append(dict(x=cx, y=cy, ax=cx + 6, ay=cy + 22, pose='back', flip=False, hit=[cx - 14, cy - 42, 28, 46]))
    # a cooler between them (a drink, as at the campsite)
    cl = art.cooler('#2f62d8')
    put(at(cl, 474, 290), over=290)
    shadow(475, 291, 13, 2, 0.32, seed=70)
    mc.block(462, 280, 486, 290)
    L['spots'] = [['cooler', 460, 270, 28, 21]]

    # ── the near trees and bushes: a willow-ish oak on the east bank, pines in the corners, the bottom edge's ferns ──
    for (kind, x, y, var) in (('oak', 520, 268, 7), ('pine', 500, 330, 8), ('pine', 14, 346, 9), ('birch', 120, 352, 10), ('maple', 336, 360, 11)):
        t, sh, fine = S.tree(mc, kind, var)
        shadow(x + 6, y + 2, sh * 0.6, sh * 0.25, 0.35 if fine is None else 0.18, seed=var)
        # (the ones along the bottom edge stand in front of the ferns and bushes there, which are at 400)
        put(at(t, x, y), over=y if y < 320 else 420 + (y - 320), fine=fine and (lambda a, t=t, x=x, y=y, fine=fine: S.lay(mc, a, fine, x - t.w // 2, y - t.h + 1)))
        if y < H:
            mc.block(x - 5, y - 4, x + 5, y)
    for k, x in enumerate(range(10, 520, 24)):
        if 168 < x < 236:
            continue                                                        # (the path)
        y = 330 + hsh(k, 9, 500) % 6
        put(at(art.bush(8 + hsh(k, 10, 500) % 4, seed=80 + k) if k % 3 == 0 else art.fern(1.0 + (hsh(k, 11, 500) % 3) * 0.12, seed=k + 90), x, y), over=400)
    for k, (x, y) in enumerate(((140, 300), (250, 312), (360, 306), (500, 300), (16, 280), (128, 282))):
        put(at(art.fern(0.9 + (k % 3) * 0.12, seed=k + 120), x, y))
    rock = Cv(14, 8)
    rock.part(ellipse(6.5, 4.5, 6.5, 3.5), Mat('#9a978e', hi='#c4c0b6', lo='#68655e'), hi='tl', lo='rb')
    rock.px(4, 3, rgb('#d8d4ca')); rock.px(9, 5, rgb('#6a8a4a'))
    for x, y in ((156, 252), (344, 262), (488, 252)):
        put(at(rock, x, y))

    # ── the water, blocked off for walking: each 6-dot column's runs of it (the dock and the boat are not water) ──
    water_rows = []
    for y in range(H):
        runs, cur = [], None
        for x in range(W):
            w = is_water(x, y) and not on_dock(x, y)
            if w and cur is None:
                cur = x
            if not w and cur is not None:
                runs.append([cur, x - 1]); cur = None
        if cur is not None:
            runs.append([cur, W - 1])
        water_rows.append(runs)
    L['things']['water'] = water_rows
    for c0 in range(2, W, 6):                                               # (columns lined up with the dock's edges)
        xs = range(max(0, c0 - 6 if c0 == 2 else c0), min(W, c0 + 6))
        y = 0
        while y < H:
            if any(is_water(x, y) and not on_dock(x, y) for x in xs):
                y0 = y
                while y < H and any(is_water(x, y) and not on_dock(x, y) for x in xs):
                    y += 1
                mc.block(xs[0], y0, xs[-1], y - 1)
            y += 1

    # ── the places to fish from, on the dock ──
    L['things']['spots'] = []
    for (x, y, face) in SPOTS:
        L['things']['spots'].append(len(L['seats']))
        ax = 303 if STEM[0] <= x <= STEM[1] and y > HEAD[3] else x + (8 if face == 'left' else -8)
        L['seats'].append(dict(x=x, y=y, ax=ax, ay=y, pose='stand', flip=face == 'right', face=face, only=True, hit=[x - 10, y - 40, 20, 42]))
    L['things']['weeds'] = WEEDS
    L['things']['deep'] = DEEP
    L['things']['back'] = dict(to='outside', foot=dict(x=296, y=98), face='up', say='Back to the campsite')
    L['stands'] += [dict(x=250, y=290, face='up'), dict(x=362, y=280, face='up'), dict(x=150, y=300, face='up'), dict(x=96, y=290, face='down'),
                    dict(x=330, y=300, face='left'), dict(x=480, y=310, face='up')]
    EXTRA['catch'] = catch_sheet(mc)
    L['things']['sheets'] = dict(catch=[CW, CH])
    L['things']['bg'] = 'var(--lake-bg, #0d1a12)'
    S.end(mc)
