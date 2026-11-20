"""The backyard's furniture and kit, for scripts/basement/backyard.py (a file starting with _ is not a fit-out: the
basement script skips it). Each function returns a canvas of its own (mc.Cv), drawn in the house style: lit from the top
left, a lit edge and a shaded one on every part, texture in the material, the outline put on when it is placed.

    import: spec_from_file_location on this file, then art.setup(mc) once before using anything here."""
import math

mc = rgb = mix = shade = tint = Mat = Cv = rows = ellipse = hsh = noise = None


def setup(m):
    global mc, rgb, mix, shade, tint, Mat, Cv, rows, ellipse, hsh, noise
    mc = m
    rgb, mix, shade, tint, Mat, Cv, rows, ellipse, hsh, noise = m.rgb, m.mix, m.shade, m.tint, m.Mat, m.Cv, m.rows, m.ellipse, m.hsh, m.noise


def line(c, x0, y0, x1, y1, col, every=1):
    n = max(abs(x1 - x0), abs(y1 - y0), 1)
    for i in range(0, int(n) + 1, every):
        c.px(round(x0 + (x1 - x0) * i / n), round(y0 + (y1 - y0) * i / n), col)


class Shift:
    """A canvas drawn on with every y moved down by dy (to draw above row 0 of a piece without working it all out again)."""
    def __init__(self, c, dy):
        self.c, self.dy = c, dy

    def px(self, x, y, col):
        self.c.px(x, y + self.dy, col)

    def rect(self, x0, y0, x1, y1, col):
        self.c.rect(x0, y0 + self.dy, x1, y1 + self.dy, col)

    def part(self, spans, mat, hi='t', lo='rb'):
        return self.c.part([(y + self.dy, a, b) for y, a, b in spans], mat, hi=hi, lo=lo)


def tones(base, k=0.16):
    """Five tones of one colour, darkest first."""
    b = rgb(base) if isinstance(base, str) else base
    return [shade(b, 2 * k), shade(b, k), b, tint(b, k), tint(b, 2 * k)]


# ───────────────────────── the shed ─────────────────────────

def shed():
    """A little garden shed for the mower, barn-shaped: a grey-green shingled gambrel roof seen from the front and above,
    board-and-batten walls painted sage, white trim, double doors with a white X brace, a window with a flower box, and a
    lantern over the doors."""
    w, h = 54, 64
    c = Cv(w, h)
    roof = tones('#5a6470', 0.14)
    for y in range(0, 26):                                                 # the roof: shingles in courses, the ridge lit
        inset = max(0, 6 - y // 2) if y < 12 else 0
        for x in range(inset, w - inset):
            course = y // 3
            k = 3 if y < 2 else 2 if y < 12 else 1
            if (x + course * 3) % 7 == 0 or y % 3 == 2:
                k -= 1
            c.px(x, y, roof[max(0, k)])
    c.rect(0, 26, w - 1, 27, rgb('#f2efe6'))                               # the white fascia
    c.rect(0, 28, w - 1, 28, rgb('#b9b3a3'))
    sage = Mat('#8aa088', hi='#a8bca4', lo='#64786a')
    c.part(rows(2, 29, w - 3, h - 1), sage, hi='l', lo='r')
    for x in range(5, w - 4, 5):                                           # the battens
        c.rect(x, 29, x, h - 2, sage.lo)
        c.rect(x - 1, 29, x - 1, h - 2, sage.hi)
    for x in (2, w - 3):                                                   # the corner boards
        c.rect(x, 29, x + 1, h - 1, rgb('#ece8dc'))
    # the double doors: white frames with a white X across each
    dx0, dx1, dy0 = 15, 38, 36
    c.rect(dx0 - 1, dy0 - 1, dx1 + 1, h - 1, rgb('#f2efe6'))
    door = Mat('#6e8670', hi='#88a088', lo='#506252')
    c.part(rows(dx0, dy0, dx1, h - 1), door, hi='tl', lo='rb')
    mid = (dx0 + dx1) // 2
    c.rect(mid, dy0, mid, h - 1, rgb('#3a4a3c'))
    for x0, x1 in ((dx0, mid - 1), (mid + 1, dx1)):
        c.rect(x0, dy0, x1, dy0 + 1, rgb('#f2efe6')); c.rect(x0, h - 3, x1, h - 2, rgb('#f2efe6'))
        c.rect(x0, dy0, x0, h - 2, rgb('#f2efe6')); c.rect(x1, dy0, x1, h - 2, rgb('#f2efe6'))
        line(c, x0, dy0 + 1, x1, h - 3, rgb('#f2efe6')); line(c, x1, dy0 + 1, x0, h - 3, rgb('#f2efe6'))
    c.px(mid - 2, 50, rgb('#c9a13a')); c.px(mid + 2, 50, rgb('#c9a13a'))  # the handles
    # a window on the left wall with a flower box under it
    c.rect(4, 33, 12, 41, rgb('#f2efe6'))
    c.rect(5, 34, 11, 40, rgb('#2a3442')); c.rect(5, 34, 7, 36, rgb('#6a8aa8'))
    c.rect(8, 34, 8, 40, rgb('#f2efe6')); c.rect(5, 37, 11, 37, rgb('#f2efe6'))
    c.part(rows(3, 42, 13, 45), Mat('#8a5a3c', hi='#b07a52', lo='#5f3c27'), hi='t', lo='b')
    for x in range(3, 14):
        col = ('#e8506a', '#ffd23a', '#f2efe6', '#b85ad8')[hsh(x, 1, 900) % 4]
        if hsh(x, 2, 900) % 3:
            c.px(x, 41, rgb(col))
        c.px(x, 40 + hsh(x, 3, 900) % 2, rgb('#3f8a3c') if x % 2 else rgb('#5dae4f'))
    # a lantern over the doors
    c.rect(mid - 1, 30, mid + 1, 34, rgb('#22222a')); c.px(mid, 32, rgb('#ffe9a8')); c.px(mid, 33, rgb('#ffd070'))
    return c


# ───────────────────────── the patio ─────────────────────────

def patio_chair(view):
    """A wrought-iron patio chair with a thick cushion: front (facing us: the cushion on the seat and the curled back
    rising behind) or back (from behind: the back's scrolls in front of whoever sits in it)."""
    iron = Mat('#2a2a30', hi='#5a5a66', lo='#141418')
    cush = Mat('#3a7ab8', hi='#5a9ad0', lo='#2a5a8a')
    c = Cv(22, 30)
    if view == 'front':
        c.part(rows(3, 0, 18, 16), iron, hi='tl', lo='r')                   # the back, a frame
        c.part(rows(5, 2, 16, 14), Mat('#3a3a44', hi='#4a4a56', lo='#22222a'))
        for x in (8, 11, 14):
            c.rect(x, 3, x, 13, rgb('#5a5a66'))                            # its bars
        c.part(rows(4, 3, 17, 13), cush, hi='t', lo='b')                    # a cushion against it
        c.rect(10, 7, 11, 8, cush.lo)                                       # the button
        c.part(rows(1, 17, 20, 22), cush, hi='t', lo='b')                   # the seat cushion
        c.rect(1, 23, 20, 23, iron.lo)
        for x in (1, 19):
            c.part(rows(x, 23, x + 1, 29), iron, hi='l', lo='r')
        for x in (5, 15):
            c.part(rows(x, 23, x + 1, 27), Mat('#22222a'), hi='', lo='')
        c.part(rows(0, 14, 2, 15), iron, hi='t', lo='b'); c.part(rows(19, 14, 21, 15), iron, hi='t', lo='b')   # the arms
    else:
        c.part(rows(1, 17, 20, 21), cush, hi='t', lo='b')                   # the seat, seen past the back
        c.part(rows(3, 2, 18, 22), iron, hi='tl', lo='r')                   # the back of the back
        c.part(rows(5, 4, 16, 20), Mat('#22222a', hi='#3a3a44', lo='#141418'))
        for k, y in enumerate((7, 12, 17)):                                 # scrolls across it
            for x in range(6, 16):
                if (x + k) % 4 == 0:
                    c.px(x, y, rgb('#5a5a66')); c.px(x + 1, y - 1, rgb('#5a5a66'))
        for x in (1, 19):
            c.part(rows(x, 20, x + 1, 29), iron, hi='l', lo='r')
        for x in (5, 15):
            c.part(rows(x, 23, x + 1, 27), Mat('#22222a'), hi='', lo='')
    return c


def patio_table():
    """A round glass-topped patio table on an iron frame, a citronella candle in a bucket in the middle."""
    c = Cv(40, 30)
    iron = Mat('#2a2a30', hi='#5a5a66', lo='#141418')
    for x in (8, 30):
        c.part(rows(x, 14, x + 1, 29), iron, hi='l', lo='r')
    c.part(rows(19, 16, 20, 29), iron, hi='l', lo='r')
    c.part(mc.ellipse(19.5, 12, 19.5, 9), Mat('#9ac8c8', hi='#d6f0ee', lo='#6a9a9c'), hi='tl', lo='rb')
    for y, x0, x1 in mc.ellipse(19.5, 12, 19.5, 9):
        c.px(x0, y, iron.base); c.px(x1, y, iron.base)
    for x in range(1, 39):
        c.px(x, 12, rgb('#b8dede') if x % 3 else rgb('#86b4b4'))           # the glass's ribbing
    c.rect(8, 8, 12, 8, rgb('#ffffff'))                                     # the glare
    c.part(rows(16, 5, 23, 11), Mat('#c9a13a', hi='#f0d27a', lo='#7a5a12'), hi='tl', lo='rb')   # the candle bucket
    c.rect(17, 5, 22, 6, rgb('#f2e8c8'))
    c.px(19, 3, rgb('#ffd070')); c.px(19, 2, rgb('#fff6c8')); c.px(20, 3, rgb('#f2701e'))   # its flame
    c.flame = (19, 2)
    return c


def smoke_table():
    """A little teak side table, and on it everything the page's menu offers: at the back a pipe rack with a corncob pipe
    and a calabash standing in it, a cigar box with its lid up, a bottle of bubble mixture with its wand; in front a
    pack of cigarettes and a lighter, a heavy glass ashtray and a mini fan lying on its side. Returns it, with where the
    table is (x, y, w, h) to click."""
    out = Cv(34, 30)
    c = Shift(out, 8)
    teak = Mat('#a07040', hi='#c8945a', lo='#6a4424')
    c.part(rows(0, 3, 33, 11), teak, hi='tl', lo='b')
    for y in (5, 8):
        for x in range(1, 33):
            if hsh(x, y, 940) % 4 == 0:
                c.px(x, y, teak.lo)
    c.rect(0, 12, 33, 13, shade(teak.base, 0.3))
    for x in (1, 30):
        c.part(rows(x, 13, x + 2, 21), teak, hi='l', lo='r')
    # the pipe rack: a low block of dark walnut, two pipes standing bowl up in it
    walnut = Mat('#5a3420', hi='#7a4c30', lo='#3a2014')
    # the corncob: a tall pale cob of a bowl, stippled, on a straight wooden stem
    cob = Mat('#e2c060', hi='#f6e08e', lo='#b08c34')
    c.rect(4, -2, 4, 3, rgb('#c09050')); c.px(4, 0, rgb('#7a5228'))
    c.part(rows(2, -8, 5, -3), cob, hi='l', lo='rb')
    for (x, y) in ((2, -6), (4, -7), (3, -5), (5, -5), (2, -4), (4, -4), (3, -3)):
        c.px(x, y, rgb('#a07c2c'))
    c.rect(3, -8, 4, -8, rgb('#3a2414'))                                      # the dark of the bowl
    # the calabash: the gourd swelling up from a black stem and turning in to its white meerschaum cup
    gourd = Mat('#c87a2a', hi='#eaa458', lo='#8a4a18')
    c.rect(8, 0, 8, 3, rgb('#1c1a20')); c.px(8, -1, rgb('#3c3a44'))
    c.part([(-2, 8, 9), (-3, 7, 10), (-4, 7, 11), (-5, 7, 11), (-6, 8, 11)], gourd, hi='l', lo='rb')
    c.part(rows(8, -8, 11, -7), Mat('#f6f0de', hi='#ffffff', lo='#cfc4a6'), hi='t', lo='b')
    c.rect(9, -8, 10, -8, rgb('#3a2414'))
    c.part(rows(1, 3, 11, 5), walnut, hi='t', lo='b')
    c.px(4, 3, walnut.lo); c.px(8, 3, walnut.lo)                              # the holes they stand in
    # the cigar box: a cedar box, lid up behind it, three cigars inside, a gold band on each
    c.part(rows(19, -1, 26, 2), Mat('#8a4a28', hi='#b06838', lo='#5a2a14'), hi='tl', lo='rb')
    c.rect(20, 0, 25, 1, rgb('#e8c070'))                                    # the label inside the lid
    c.part(rows(19, 3, 26, 8), Mat('#8a4a28', hi='#b06838', lo='#5a2a14'), hi='tl', lo='rb')
    for k in range(3):
        c.rect(20, 4 + k * 1, 25, 4 + k * 1, rgb('#6a3a1a') if k % 2 else rgb('#7a4a24'))
        c.px(22, 4 + k, rgb('#e8c070'))
    # the bubble mixture: a pink bottle, its wand leaning in it
    c.part(rows(28, 3, 32, 9), Mat('#f07ab0', hi='#ffa8d0', lo='#b84a80'), hi='tl', lo='rb')
    c.rect(29, 1, 31, 2, rgb('#f2efe6'))
    line(c, 30, 1, 32, -3, rgb('#7ad0e8'))
    c.part(mc.ellipse(32.5, -4.5, 1.5, 1.5), Mat('#7ad0e8'), hi='', lo='')
    c.px(32, -4, rgb('#ffffff'))
    # the cigarette pack: red and white, two filters poking out, the lighter beside it
    c.part(rows(12, 2, 16, 8), Mat('#f2efe6', hi='#ffffff', lo='#c9c4b8'), hi='tl', lo='rb')
    c.rect(12, 2, 16, 4, rgb('#c23b3b')); c.px(13, 1, rgb('#e8b070')); c.px(15, 1, rgb('#e8b070'))
    c.rect(17, 6, 18, 9, rgb('#2f62d8')); c.px(17, 5, rgb('#c9ced6'))
    # the ashtray: a heavy round glass dish in front of the rack, a stub in it
    c.part(mc.ellipse(6, 9, 3.5, 1.6), Mat('#b8d8e0', hi='#e8f6fa', lo='#7aa0aa'), hi='tl', lo='rb')
    c.px(5, 9, rgb('#3a3632')); c.px(6, 9, rgb('#e8dcc0'))
    # the mini fan, lying on its side: a mint handle, a round guard with its blades in it
    c.part(rows(24, 9, 28, 10), Mat('#8ee0c0', hi='#b8f0dc', lo='#3f9e7c'), hi='t', lo='b')
    c.part(mc.ellipse(21.5, 9.5, 2.6, 2.1), Mat('#7c8496', hi='#a8b0c0', lo='#4a5060'), hi='tl', lo='rb')
    for (x, y) in ((20, 9), (21, 9), (22, 10), (23, 10), (21, 10), (22, 9)):
        c.px(x, y, rgb('#eef6fa') if (x + y) % 2 else rgb('#b8e4f4'))
    out.things = dict(table=(0, 0, 34, 22))
    return out


def grill():
    """A black kettle grill on its legs, lid on with the vent and the handle, and a side shelf with tongs."""
    c = Cv(26, 30)
    k = Mat('#26262c', hi='#50505c', lo='#121216')
    c.part(mc.ellipse(12.5, 10, 9.5, 8), k, hi='tl', lo='rb')
    c.rect(5, 3, 8, 4, rgb('#6a6a76'))                                      # the lid's shine
    c.rect(11, 2, 14, 2, rgb('#9a9aa2'))                                    # the vent
    c.rect(10, 0, 15, 1, rgb('#8a5a3c'))                                    # the handle
    c.rect(3, 10, 22, 10, rgb('#9a9aa2'))                                   # the rim
    for x, y0 in ((5, 15), (19, 15), (12, 17)):
        line(c, 12, 17, x, 29, rgb('#3a3a40'))
    c.part(rows(20, 13, 25, 15), Mat('#8a5a3c', hi='#b07a52', lo='#5f3c27'), hi='t', lo='b')
    c.px(22, 12, rgb('#c9ced6')); c.px(23, 12, rgb('#c9ced6'))
    c.part(mc.ellipse(5, 28, 2, 1.2), Mat('#3a3a40'), hi='', lo='')
    return c


def lounger():
    """A white chaise longue seen from the foot: the slatted back raised at the top, the long seat, a striped towel
    laid over it, little wheels."""
    c = Cv(24, 52)
    wh = Mat('#efe8d8', hi='#ffffff', lo='#b5ac98')
    c.part(rows(2, 0, 21, 16), wh, hi='tl', lo='rb')                       # the raised back
    for x in range(4, 21, 3):
        c.rect(x, 2, x, 15, wh.lo)
    c.part(rows(2, 17, 21, 47), wh, hi='l', lo='rb')                        # the seat
    for y in range(19, 47, 3):
        c.rect(3, y, 20, y, wh.lo)
    stripes = ('#e8506a', '#f2efe6', '#2f9ad8', '#f2efe6')
    for y in range(4, 40):                                                  # the towel over it
        for x in range(5, 19):
            c.px(x, y, rgb(stripes[(y // 3) % 4]) if x not in (5, 18) else shade(rgb(stripes[(y // 3) % 4]), 0.2))
    for x in (2, 19):
        c.part(rows(x, 48, x + 2, 51), Mat('#5a5a62'), hi='', lo='')
    return c


def diving_board():
    """The diving board, from above: its stand bolted to the deck (chrome rails and a blue base) and the white board,
    textured for grip, running out over the water to the right."""
    c = Cv(48, 16)
    base = Mat('#2f62d8', hi='#5a8ae8', lo='#1a3a8a')
    c.part(rows(0, 3, 13, 14), base, hi='tl', lo='rb')                     # the stand
    c.rect(2, 2, 11, 2, rgb('#c9ced6')); c.rect(2, 15, 11, 15, rgb('#8a9098'))
    board = Mat('#f2efe6', hi='#ffffff', lo='#b9b3a3')
    c.part(rows(4, 6, 47, 10), board, hi='t', lo='b')
    for x in range(6, 46, 2):
        c.px(x, 8, rgb('#d6d0c0'))
    c.rect(4, 11, 47, 11, rgb('#3a4a6a'))                                   # its shadow edge
    return c


def ladder():
    """A pool ladder from above: two chrome rails curving over the coping and down into the water, the treads under it."""
    c = Cv(12, 16)
    ch = rgb('#e8ecf0')
    for x in (1, 10):
        c.rect(x, 0, x, 3, ch); c.px(x, 4, rgb('#c9ced6'))
        c.rect(x, 5, x, 15, rgb('#a8c8d8'))
    for y in (8, 12):
        c.rect(2, y, 9, y, rgb('#7aa8c8'))
    return c


def flamingo():
    """A pink plastic lawn flamingo on its two wire legs."""
    c = Cv(12, 22)
    p = Mat('#f07ab0', hi='#ffa8d0', lo='#b84a80')
    c.part(mc.ellipse(5, 10, 4.5, 3), p, hi='tl', lo='rb')                  # the body
    line(c, 8, 9, 9, 3, p.base); line(c, 9, 9, 10, 3, p.lo)                 # the neck
    c.part(rows(8, 1, 10, 3), p, hi='t', lo='b')                            # the head
    c.px(11, 3, rgb('#22222a')); c.px(11, 2, rgb('#f2efe6'))                # the beak
    c.px(9, 2, rgb('#22222a'))
    c.rect(4, 13, 4, 21, rgb('#3a3a40')); c.rect(6, 13, 6, 21, rgb('#3a3a40'))
    return c


def gnome():
    """A garden gnome: red pointed hat, white beard, blue coat, a little shovel."""
    c = Cv(10, 16)
    c.part([(0, 4, 5), (1, 4, 5), (2, 3, 6), (3, 3, 6), (4, 2, 7)], Mat('#d83a2c', hi='#f06a50', lo='#9a2018'), hi='l', lo='r')
    c.rect(3, 5, 6, 6, rgb('#f2d0b0')); c.px(4, 5, rgb('#22222a')); c.px(6, 5, rgb('#22222a'))
    c.part(rows(2, 7, 7, 10), Mat('#f2efe6', hi='#ffffff', lo='#c9c4b8'), hi='t', lo='b')
    c.part(rows(2, 11, 7, 14), Mat('#2f62d8', hi='#5a8ae8', lo='#1a3a8a'), hi='l', lo='rb')
    c.rect(2, 15, 7, 15, rgb('#5a3a24'))
    line(c, 8, 6, 8, 14, rgb('#8a5a3c')); c.rect(8, 14, 9, 15, rgb('#9a9aa2'))
    return c


def birdbath():
    """A stone birdbath: a pedestal and a shallow bowl of water, a bird on the rim."""
    c = Cv(18, 22)
    st = Mat('#b9b3a3', hi='#e0dace', lo='#857f70')
    c.part(rows(7, 8, 10, 19), st, hi='l', lo='r')
    c.part(rows(4, 19, 13, 21), st, hi='t', lo='b')
    c.part(mc.ellipse(8.5, 6, 8.5, 3.5), st, hi='tl', lo='rb')
    c.part(mc.ellipse(8.5, 5.5, 6.5, 2.2), Mat('#7ab8d8', hi='#bce0f0', lo='#4a88a8'), hi='tl', lo='rb')
    c.rect(13, 1, 15, 2, rgb('#8a5a3c')); c.px(16, 1, rgb('#e8a040')); c.px(14, 0, rgb('#8a5a3c')); c.px(15, 1, rgb('#22222a'))
    return c


def hydrangea(seed=0, colour='#7a8ae8'):
    """A hydrangea bush: dark leaves under big round heads of flowers, blue, pink or white. In the fall its heads fade
    to an antique rose and its leaves turn; in winter it is a clump of bare stems holding up dried, papery heads."""
    season = getattr(mc, 'SEASON', 'summer')
    c = Cv(26, 20)
    leaf = [rgb(x) for x in ('#1f4a26', '#2d6a34', '#3f8a3c', '#4f9e47')]
    if season in ('winter', 'snow'):
        for k in range(9):                                                  # the stems, fanning up from the crown
            x0 = 13 + (k - 4) * 0.6
            for i in range(14):
                c.px(round(x0 + (k - 4) * i * 0.32), 19 - i, rgb('#5a4232') if i % 3 else rgb('#7a5a42'))
        colour = '#b89a72'
    else:
        mc.clump(c, 13, 12, 12, 8, mc.LEAF['box'], 700 + seed)
    if season == 'fall':
        _turn(c, 22, 0.9, 0.95)
        colour = '#' + ''.join('%02x' % v for v in mix(rgb(colour), rgb('#9a5a5a'), 0.6))
    fl = tones(colour, 0.14)
    for k in range(6):
        hx, hy = 4 + hsh(k, seed, 710) % 18, 3 + hsh(k, seed, 711) % 9
        for y, x0, x1 in mc.ellipse(hx, hy, 3, 2.5):
            for x in range(x0, x1 + 1):
                h = hsh(x, y, 712 + seed) % 6
                c.px(x, y, fl[1 + (h > 1) + (h > 3) + (y < hy and x < hx)])
    del leaf
    return c


def _turn(c, hue, sat=0.8, val=1.0):
    """The green of a canvas turned another colour (its leaves in the fall)."""
    import colorsys
    a = c.a
    for y in range(a.shape[0]):
        for x in range(a.shape[1]):
            if a[y, x, 3]:
                r, g, b = (int(v) / 255 for v in a[y, x, :3])
                h, s_, v = colorsys.rgb_to_hsv(r, g, b)
                if 60 / 360 < h < 175 / 360 and s_ > 0.18:
                    rr, gg, bb = colorsys.hsv_to_rgb(hue / 360, min(1, s_ * sat), min(1, v * val))
                    a[y, x, :3] = (round(rr * 255), round(gg * 255), round(bb * 255))


def flowers(w, seed=0):
    """A strip of bedding flowers for the front of a bed: tulips, marigolds and petunias, in clumps (in the spring tulips
    and daffodils, in the fall mums, in winter low pansies)."""
    season = getattr(mc, 'SEASON', 'summer')
    c = Cv(w, 9)
    cols = dict(spring=('#e8506a', '#ffd23a', '#fdfbf4', '#f08aa8', '#ffd23a', '#e8506a'),
                fall=('#e8761e', '#f2b81e', '#9a2a3a', '#c8461c', '#f2b81e', '#b85a2a'),
                winter=('#7a4ac8', '#f2d21e', '#f2efe6', '#5a3aa8', '#e8a0d8', '#7a4ac8')).get(season, ('#e8506a', '#ffd23a', '#f2efe6', '#b85ad8', '#ff8a3a', '#e8506a'))
    if season == 'snow':
        cols = ('#7a4ac8', '#f2d21e', '#f2efe6', '#5a3aa8', '#e8a0d8', '#7a4ac8')
    low = season in ('winter', 'snow')
    for x in range(0, w):
        top = 2 + hsh(x, seed, 720) % 4 + (2 if low else 0)
        c.rect(x, top + 1, x, 8, rgb('#3f8a3c') if (x + seed) % 3 else rgb('#2d6a34'))
        if hsh(x, seed, 721) % 3 == 0:
            col = rgb(cols[(x // 5 + seed) % len(cols)])
            c.px(x, top, col); c.px(x, top - 1, tint(col, 0.25))
            if x + 1 < w:
                c.px(x + 1, top, shade(col, 0.15))
    return c


def potted_plant(seed=0, kind='palm'):
    """A big terracotta pot by the house: a little palm (fronds fanning out) or a round boxwood."""
    c = Cv(22, 30)
    pot = Mat('#c86a3a', hi='#e88a58', lo='#8a4424')
    c.part([(y, 5 + (y - 20) // 4, 16 - (y - 20) // 4) for y in range(20, 30)], pot, hi='tl', lo='rb')
    c.rect(4, 19, 17, 20, pot.hi); c.rect(4, 21, 17, 21, pot.lo)
    if kind == 'palm':
        g = [rgb(x) for x in ('#1f4a26', '#2d6a34', '#3f8a3c', '#5dae4f', '#86c66c')]
        for k, ang in enumerate((-1.3, -0.8, -0.35, 0.1, 0.55, 1.0, 1.4)):
            L = 11 + hsh(k, seed, 730) % 4
            for i in range(L):
                t = i / L
                x = 11 + math.sin(ang) * i
                y = 19 - math.cos(ang) * i + t * t * 6
                c.px(round(x), round(y), g[1 + int(t * 3)])
                if i % 2 and t > 0.2:
                    c.px(round(x - math.cos(ang)), round(y - math.sin(ang) * 0.5), g[3])
                    c.px(round(x + math.cos(ang)), round(y + math.sin(ang) * 0.5 + 1), g[2])
    else:
        mc.clump(c, 11, 12, 9, 8, mc.LEAF['box'], 740 + seed)
    return c


def path_light():
    """A little black solar path light: a post and a lamp head with a frosted lens."""
    c = Cv(5, 10)
    c.rect(2, 4, 2, 9, rgb('#22222a'))
    c.part(rows(0, 0, 4, 3), Mat('#2a2a30', hi='#5a5a66', lo='#141418'), hi='t', lo='b')
    c.rect(1, 2, 3, 3, rgb('#fff2c0'))
    return c


# ───────────────────────── the mower ─────────────────────────

MOW_W, MOW_H = 36, 56
# where the one pushing it stands in each cell (their feet), so the page can put the cell where they are: down, up,
# left, right (the way they face)
MOW_FOOT = {'down': (18, 9), 'up': (18, 55), 'left': (30, 27), 'right': (5, 27)}


def mower_sheet():
    """The push mower, four ways round (cells MOW_W x MOW_H, in the order down, up, left, right: the way the one pushing
    it faces): a red deck on four black wheels, the grey engine on top with its black shroud and yellow fuel cap, the
    grass bag at the back, and the handle running back up to the hands. Shown pushed away from us (up) we see its
    back and bag over the top of them; pushed toward us (down), its front and the handle rising behind it to them."""
    sheet = Cv(MOW_W * 4, MOW_H)
    red = Mat('#d8342a', hi='#f2604a', lo='#8a1a14')
    eng = Mat('#8a8e96', hi='#c0c4cc', lo='#5a5e66')
    blk = rgb('#1a1a1e')
    bag = Mat('#4a5a4a', hi='#6a7a6a', lo='#2e3a2e')
    bar = rgb('#c9ced6')

    def wheel(c, x, y, w=3, h=4):
        c.rect(x, y, x + w - 1, y + h - 1, blk)
        c.px(x + w // 2, y + h // 2, rgb('#8a8a90'))

    # ── down: the person stands behind it (above in the cell), it runs toward us ──
    c = Cv(MOW_W, MOW_H)
    fx, fy = MOW_FOOT['down']
    # the handle, from the hands down to the back of the deck (drawn first: the deck is in front of its foot)
    for sx in (-6, 6):
        line(c, fx + sx, fy - 18, fx + sx, fy + 6, bar)
    c.rect(fx - 6, fy - 18, fx + 6, fy - 18, bar)                            # the crossbar at the hands
    c.rect(fx - 5, fy - 16, fx + 5, fy - 16, rgb('#1a1a1e'))                 # the bail lever
    c.part(rows(fx - 5, fy + 1, fx + 5, fy + 6), bag, hi='t', lo='b')        # the bag, behind the engine
    wheel(c, fx - 10, fy + 6); wheel(c, fx + 8, fy + 6)
    wheel(c, fx - 10, fy + 19); wheel(c, fx + 8, fy + 19)
    c.part(rows(fx - 9, fy + 6, fx + 9, fy + 22), red, hi='tl', lo='rb')     # the deck
    c.rect(fx - 8, fy + 21, fx + 8, fy + 22, red.lo)
    c.rect(fx - 7, fy + 23, fx + 7, fy + 23, rgb('#3a3a40'))                 # the front skirt
    c.part(mc.ellipse(fx, fy + 13, 5, 4), eng, hi='tl', lo='rb')             # the engine
    c.part(mc.ellipse(fx, fy + 12, 3, 2.5), Mat('#26262c', hi='#4a4a56', lo='#121216'), hi='tl', lo='rb')
    c.px(fx + 4, fy + 10, rgb('#ffd23a'))                                    # the fuel cap
    c.rect(fx - 9, fy + 15, fx - 8, fy + 16, rgb('#9a9aa2'))                 # the height lever
    sheet.paste(c, 0, 0)

    # ── up: pushed away from us, the person in front of it (below in the cell); it is out ahead of them, over their
    #    head, the long handle running back down past it to their hands ──
    c = Cv(MOW_W, MOW_H)
    fx, fy = MOW_FOOT['up']
    for sx in (-7, 7):                                                       # the handle, down to the hands
        line(c, fx + sx, fy - 37, fx + sx, fy - 20, bar)
    c.rect(fx - 7, fy - 20, fx + 7, fy - 20, bar)
    wheel(c, fx - 11, fy - 53); wheel(c, fx + 9, fy - 53)
    wheel(c, fx - 11, fy - 41); wheel(c, fx + 9, fy - 41)
    c.part(rows(fx - 10, fy - 53, fx + 10, fy - 39), red, hi='tl', lo='rb')
    c.part(mc.ellipse(fx, fy - 46, 5, 4), eng, hi='tl', lo='rb')
    c.part(mc.ellipse(fx, fy - 47, 3, 2.5), Mat('#26262c', hi='#4a4a56', lo='#121216'), hi='tl', lo='rb')
    c.px(fx + 3, fy - 49, rgb('#ffd23a'))
    c.part(rows(fx - 6, fy - 40, fx + 6, fy - 35), bag, hi='t', lo='b')      # the bag at the back, toward us
    for x in range(fx - 5, fx + 6, 3):
        c.px(x, fy - 37, bag.lo)
    sheet.paste(c, MOW_W, 0)

    # ── left and right: side on, the deck out to the side and the handle rising back to the hands ──
    for k, way in enumerate(('left', 'right')):
        c = Cv(MOW_W, MOW_H)
        fx, fy = MOW_FOOT[way]
        s = -1 if way == 'left' else 1
        x_back, x_front = fx + s * 5, fx + s * 24                            # the deck from its back to its front
        xa, xb = min(x_back, x_front), max(x_back, x_front)
        line(c, fx + s * 2, fy - 18, x_back + s * 1, fy - 4, bar)            # the handle
        c.rect(fx + s * 1, fy - 19, fx + s * 3, fy - 18, bar) if s > 0 else c.rect(fx - 3, fy - 19, fx - 1, fy - 18, bar)
        bx0, bx1 = (x_back - 6, x_back) if s > 0 else (x_back, x_back + 6)  # the bag, behind the deck
        c.part(rows(bx0, fy - 9, bx1, fy - 2), bag, hi='t', lo='b')
        c.part(rows(xa + (0 if s > 0 else 0), fy - 8, xb, fy), red, hi='tl', lo='rb')
        c.rect(xa, fy - 1, xb, fy, red.lo)
        wheel(c, xa + 1, fy - 2, 4, 4); wheel(c, xb - 4, fy - 2, 4, 4)
        ex = (xa + xb) // 2
        c.part(rows(ex - 4, fy - 14, ex + 4, fy - 8), eng, hi='tl', lo='rb')
        c.part(rows(ex - 3, fy - 16, ex + 3, fy - 14), Mat('#26262c', hi='#4a4a56', lo='#121216'), hi='t', lo='b')
        c.px(ex + s * 3, fy - 16, rgb('#ffd23a'))
        sheet.paste(c, MOW_W * (2 + k), 0)
    return sheet
