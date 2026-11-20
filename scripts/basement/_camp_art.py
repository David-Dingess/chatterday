"""The campsite's furniture and kit, for scripts/basement/outside.py (a file starting with _ is not a fit-out: the
basement script skips it). Each function returns a canvas of its own (mc.Cv), drawn in the house style: lit from the top
left, a lit edge and a shaded one on every part, texture in the material, the outline put on when it is placed.

    import: spec_from_file_location on this file, then art.setup(mc) once before using anything here."""
import importlib.util as _iu
import math
import os as _os

_s = _iu.spec_from_file_location('seasons', _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), '_seasons.py'))
S = _iu.module_from_spec(_s)
_s.loader.exec_module(S)

mc = rgb = mix = shade = tint = Mat = Cv = rows = ellipse = hsh = noise = None


def setup(m):
    global mc, rgb, mix, shade, tint, Mat, Cv, rows, ellipse, hsh, noise
    mc = m
    rgb, mix, shade, tint, Mat, Cv, rows, ellipse, hsh, noise = m.rgb, m.mix, m.shade, m.tint, m.Mat, m.Cv, m.rows, m.ellipse, m.hsh, m.noise


def inside(pts, x, y):
    """Whether (x, y) (a dot's middle) is inside the polygon pts."""
    px, py, hit = x + 0.5, y + 0.5, False
    for i in range(len(pts)):
        (x0, y0), (x1, y1) = pts[i], pts[(i + 1) % len(pts)]
        if (y0 > py) != (y1 > py) and px < x0 + (py - y0) * (x1 - x0) / (y1 - y0):
            hit = not hit
    return hit


def poly(c, pts, paint):
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    for y in range(int(min(ys)), int(max(ys)) + 1):
        for x in range(int(min(xs)), int(max(xs)) + 1):
            if inside(pts, x, y):
                col = paint(x, y)
                if col is not None:
                    c.px(x, y, col)


def line(c, x0, y0, x1, y1, col, every=1):
    n = max(abs(x1 - x0), abs(y1 - y0), 1)
    for i in range(0, int(n) + 1, every):
        c.px(round(x0 + (x1 - x0) * i / n), round(y0 + (y1 - y0) * i / n), col)


def tones(base, k=0.16):
    """Five tones of one colour, darkest first."""
    b = rgb(base) if isinstance(base, str) else base
    return [shade(b, 2.4 * k), shade(b, k), b, tint(b, k), tint(b, 2.2 * k)]


# ───────────────────────── the yard's Adirondack chair, one size for every view ─────────────────────────

ADI_W, ADI_H = 34, 34


def adirondack(view):
    """The yard's white Adirondack chair (make-clubhouse.py adirondack()), drawn at the people's scale, the same size and
    shape whichever way it faces: a fan of eight slats (tallest in the middle), broad flat arms out past them, a slatted
    seat, chunky legs. front: facing us (whoever sits in it in front of the slats, the arms either side); back: from
    behind, the back of the fan and its two battens across it in front of whoever sits in it."""
    m = Mat('#efe8d8', hi='#ffffff', lo='#b5ac98')
    lo2 = shade(m.lo, 0.18)
    c = Cv(ADI_W, ADI_H)
    tops = (7, 4, 1, 0, 0, 1, 4, 7)
    bottom = 22 if view == 'front' else 26
    # the rail the slats are fixed to, showing in the gaps between them
    c.rect(5, 11, 28, 12, lo2)
    if view == 'front':
        c.rect(5, 19, 28, 20, lo2)
    for k, top in enumerate(tops):
        x = 5 + 3 * k
        sm = Mat(mix(m.base, m.lo, k / 14), hi=m.hi, lo=m.lo)              # (the fan turns away from the light, left to right)
        c.part(rows(x, top, x + 1, bottom), sm, hi='tl', lo='r')
        c.px(x, top, m.hi)
        if hsh(k, 3, 50) % 3 == 0:
            c.px(x + 1, top + 6 + k % 4, m.lo)                               # a knot showing through the paint
    if view == 'back':
        for y in (9, 21):                                                   # the battens across the back of the fan
            c.part(rows(4, y, 29, y + 1), Mat(m.lo, hi=m.base, lo=lo2), hi='t', lo='b')
            c.px(6, y, rgb('#8a8478')); c.px(27, y, rgb('#8a8478'))         # the screws
    # the arms: broad flat boards, out past the fan, rounded at the front
    for ax in (0, 27):
        c.part([(18, ax + 1, ax + 5), (19, ax, ax + 6), (20, ax, ax + 6), (21, ax + 1, ax + 5)], m, hi='t', lo='b')
        c.rect(ax + 1, 18, ax + 5, 18, m.hi)
    if view == 'front':
        for y in (23, 25, 27):                                              # the seat's slats, sloping back into the fan
            c.part(rows(5, y, 28, y), m, hi='t', lo='')
            c.rect(5, y + 1, 28, y + 1, lo2)
        for lx in (1, 28):                                                  # the front legs, under the arms, and the back ones
            c.part(rows(lx, 22, lx + 3, 33), m, hi='l', lo='rb')
        c.rect(7, 29, 8, 32, lo2); c.rect(25, 29, 26, 32, lo2)
    else:
        c.rect(5, 27, 28, 28, lo2)                                          # the seat's back edge under the fan
        for lx in (4, 26):
            c.part(rows(lx, 27, lx + 3, 33), m, hi='l', lo='rb')
        for lx in (1, 29):
            c.part(rows(lx, 22, lx + 2, 31), Mat(m.lo, hi=m.base, lo=lo2), hi='l', lo='rb')
    return c


# ───────────────────────── tents ─────────────────────────

def ridge_tent():
    """An orange ridge tent, its front to us: the rain fly over a ridge pole, the lit slope on the left and the one in
    shade on the right, creased from the ridge to the pegs, a seam along each slope; the door unzipped and its flaps
    rolled back and tied, showing the dark inside and a sleeping bag; the bathtub floor; guy lines out to the pegs."""
    W, H = 76, 62
    c = Cv(W, H)
    fly = tones('#e8742c', 0.14)
    A, B = (38, 16), (38, 3)                                                # the front apex, the back of the ridge
    FL, FR, BL, BR = (6, 52), (70, 52), (8, 39), (68, 39)
    # the slopes
    def slope(left):
        def paint(x, y):
            # how far down the slope (0 at the ridge, 1 at the eave), and a crease or two fanning from the ridge
            ry = 3 + (16 - 3) * (y - 3) / 49 if False else 0
            t = abs(x - 38) / 32
            k = 3 if left else 1
            if t > 0.92:
                k -= 1                                                      # the eave turns under
            ang = math.atan2(y - 10, (x - 38) * (1 if left else -1) - 0.01)
            if left and abs(((ang * 6) % 1) - 0.5) < 0.07 and t > 0.25:
                k -= 1                                                      # creases pulled out to the pegs
            if not left and abs(((ang * 6) % 1) - 0.5) < 0.07 and t > 0.25:
                k -= 1
            if abs(t - 0.55) < 0.02:
                k = max(0, k - 1)                                           # the seam across the panels
            if left and t < 0.08:
                k = 4                                                       # the ridge, lit
            return fly[max(0, k)]
        return paint
    poly(c, [B, A, FL, BL], slope(True))
    poly(c, [B, A, FR, BR], slope(False))
    line(c, B[0], B[1], A[0], A[1], fly[4])
    c.rect(36, 3, 40, 5, rgb('#c85a1c')); c.rect(36, 3, 40, 3, fly[4])     # the vent cap on the ridge
    # the front: the fly's gable, a door in it
    def gable(x, y):
        t = (y - A[1]) / (FL[1] - A[1])
        col = mix(fly[3], fly[2], t)
        if abs(x - 38) == 0 and y < 28:
            return rgb('#9a3a10')                                           # the zip down from the apex
        return col
    poly(c, [A, (FL[0] + 3, FL[1]), (FR[0] - 3, FR[1])], gable)
    line(c, A[0], A[1], FL[0] + 3, FL[1], fly[1]); line(c, A[0], A[1], FR[0] - 3, FR[1], fly[0])    # the hem along its edges
    # the door: unzipped, the inner tent's mesh and its dark inside, a blue sleeping bag on the floor
    D = [(38, 27), (25, 51), (51, 51)]
    def door(x, y):
        t = (y - 27) / 24
        col = mix(rgb('#160e0c'), rgb('#3a2418'), t * 0.8)
        if y >= 45 and 30 <= x <= 44:
            col = rgb('#2f62d8') if y > 46 else rgb('#6a96f0')               # the sleeping bag inside
            if x in (34, 38, 42) and y > 46:
                col = rgb('#1d3a8a')
        return col
    poly(c, D, door)
    for side in (-1, 1):                                                    # the flaps, rolled back and tied either side
        for i in range(19):
            y = 30 + i
            x = 38 + side * (2 + round(i * 13 / 24)) + side * 1
            c.px(x, y, fly[3] if side < 0 else fly[2]); c.px(x + side, y, fly[2] if side < 0 else fly[1]); c.px(x + 2 * side, y, fly[1])
        c.rect(38 + side * 9 - 1, 42, 38 + side * 9 + 1, 42, rgb('#2a1a10'))    # the tie round each roll
    # the bathtub floor, grey, along the front, and the fly's hem over it
    c.rect(FL[0] + 4, FL[1] + 1, FR[0] - 4, FL[1] + 2, rgb('#5a5e66')); c.rect(FL[0] + 4, FL[1] + 1, FR[0] - 4, FL[1] + 1, rgb('#8a8e96'))
    # guy lines out to the pegs: from the apex, the corners and the middle of each slope
    rope = rgb('#e8e2cc')
    for (x0, y0), (x1, y1) in (((38, 16), (38, 60)), ((6, 52), (1, 58)), ((70, 52), (74, 58)), ((20, 26), (1, 30)), ((56, 26), (74, 30))):
        c.rect(x1 - 1, y1 - 1, x1, y1 + 1, rgb('#9aa0a8')); c.px(x1 - 1, y1 - 1, rgb('#d8dce2'))     # the peg
    # the guy lines themselves: thin, so they are laid on the ground after the outline (guys(), below)
    c.guys = [(x0, y0, x1, y1) for (x0, y0), (x1, y1) in (((38, 16), (38, 59)), ((6, 52), (1, 57)), ((70, 52), (74, 57)), ((20, 26), (1, 29)), ((56, 26), (74, 29)))]
    return c


def dome_tent():
    """A green dome tent: the fly shaded round the dome, two poles in their sleeves crossing over it, a seam, a little
    awning over the vent at the top; the door unzipped round its edge and rolled to one side, a sleeping pad and a
    pillow inside in the dark; the groundsheet's edge; guy lines to the pegs."""
    W, H = 84, 56
    c = Cv(W, H)
    cx, by, rx, ry = 42, 48, 36, 40
    fly = tones('#3f8a5c', 0.15)
    for y in range(by - ry, by + 4):
        for x in range(cx - rx, cx + rx + 1):
            nx = (x + 0.5 - cx) / rx
            if y <= by:
                ny = (y + 0.5 - by) / ry
                if nx * nx + ny * ny > 1:
                    continue
            else:
                if nx * nx + ((y - by) / 4) ** 2 > 1:
                    continue
                ny = 0
            nz = math.sqrt(max(0.0, 1 - nx * nx - ny * ny))
            light = -0.55 * nx - 0.45 * ny + 0.45 * nz
            k = 4 if light > 0.62 else 3 if light > 0.38 else 2 if light > 0.08 else 1 if light > -0.25 else 0
            if hsh(x // 3, y // 2, 61) % 11 == 0 and 0 < k < 4:
                k -= 1                                                      # the fabric's slight sag between the poles
            c.px(x, y, fly[k])
    # the two poles in their sleeves, crossing over the top
    for s in (-1, 1):
        prev = None
        for i in range(61):
            a = math.pi * i / 60
            x = cx + s * (rx - 2) * math.cos(a) * 0.98 - s * 8 * math.sin(a)
            y = by - (ry - 2) * math.sin(a) + 3 * math.sin(a) * s
            p = (round(x), round(y))
            if p != prev:
                c.px(p[0], p[1], fly[4] if (s < 0 or a > 1.4) else fly[3]); c.px(p[0], p[1] + 1, fly[0])
                prev = p
    line(c, cx, by - ry + 1, cx, by - ry + 9, fly[1])                       # a seam down from the top
    c.part([(by - ry - 1, cx - 7, cx + 7), (by - ry, cx - 8, cx + 8), (by - ry + 1, cx - 8, cx + 8)], Mat(fly[3], hi=fly[4], lo=fly[0]), hi='t', lo='b')   # the vent's awning
    c.rect(cx - 6, by - ry + 2, cx + 6, by - ry + 2, shade(fly[0], 0.3))
    # the door: a half moon, unzipped round its edge, the panel rolled to the right and tied
    for y in range(by - 25, by + 1):
        for x in range(cx - 16, cx + 17):
            if ((x + 0.5 - cx) / 15) ** 2 + ((y + 0.5 - by) / 25) ** 2 <= 1:
                t = (y - (by - 25)) / 25
                col = mix(rgb('#0c1410'), rgb('#22301e'), t)
                glow = max(0.0, 1 - math.hypot(x - (cx + 3), (y - (by - 12)) * 1.3) / 15)
                col = mix(col, rgb('#d89a4a'), 0.75 * glow)                 # lit from inside by a lantern
                if y >= by - 5 and cx - 12 <= x <= cx + 8:
                    col = rgb('#c8b47a') if y == by - 5 else rgb('#a8945a')        # a sleeping pad on the floor inside
                if y in (by - 9, by - 8) and cx - 10 <= x <= cx - 3:
                    col = rgb('#e8e2d0') if y == by - 9 else rgb('#c8c0aa')        # and a pillow
                c.px(x, y, col)
    lx, ly = cx + 3, by - 15                                                # the lantern inside, hung from the roof
    line(c, lx, by - 25, lx, ly - 3, rgb('#3a3020'))
    c.rect(lx - 1, ly - 2, lx + 1, ly + 2, rgb('#fff2c0')); c.px(lx, ly, rgb('#ffffff')); c.rect(lx - 1, ly + 3, lx + 1, ly + 3, rgb('#2f5a44'))
    for i in range(41):                                                     # the zip round the door
        a = math.pi * i / 40
        c.px(round(cx - 16 * math.cos(a)), round(by - 26 * math.sin(a)), rgb('#d9dde4'))
    roll = Mat(fly[3], hi=fly[4], lo=fly[1])
    c.part([(y, cx + 11, cx + 15) for y in range(by - 18, by + 1)], roll, hi='l', lo='r')     # the rolled door panel
    for y in range(by - 17, by, 3):
        c.px(cx + 12, y, fly[1]); c.px(cx + 14, y + 1, fly[4])              # its turns
    for y in (by - 14, by - 5):
        c.rect(cx + 10, y, cx + 16, y, rgb('#2a2a2a'))                       # the toggles round it
    # the groundsheet, a darker lip at the foot
    c.rect(cx - rx + 2, by + 3, cx + rx - 2, by + 4, rgb('#2a4a36')); c.rect(cx - rx + 2, by + 3, cx + rx - 2, by + 3, rgb('#3a5e46'))
    rope = rgb('#e8e2cc')
    for (x0, y0), (x1, y1) in (((cx - 30, by - 22), (2, by - 10)), ((cx + 30, by - 22), (W - 3, by - 10)), ((cx - 33, by + 1), (3, by + 6)), ((cx + 33, by + 1), (W - 4, by + 6))):
        c.rect(x1 - 1, y1 - 1, x1, y1 + 1, rgb('#9aa0a8')); c.px(x1 - 1, y1 - 1, rgb('#d8dce2'))
    c.guys = [(x0, y0, x1, y1 - 1) for (x0, y0), (x1, y1) in (((cx - 30, by - 22), (2, by - 10)), ((cx + 30, by - 22), (W - 3, by - 10)), ((cx - 33, by + 1), (3, by + 6)), ((cx + 33, by + 1), (W - 4, by + 6)))]
    return c


def guys(base, tent, x, y):
    """A tent's guy lines, laid on the ground with no outline (a dark edge would make a cord look like a pole): the tent
    stood with the middle of its bottom row at (x, y). A light cord, a dot of shade beside it."""
    ox, oy = x - tent.w // 2, y - tent.h + 1
    for x0, y0, x1, y1 in tent.guys:
        n = max(abs(x1 - x0), abs(y1 - y0), 1)
        for i in range(n + 1):
            px, py = round(ox + x0 + (x1 - x0) * i / n), round(oy + y0 + (y1 - y0) * i / n)
            if base.get(px, py + 1) and not tent.get(px - ox, py + 1 - oy):
                base.px(px, py + 1, shade(base.get(px, py + 1), 0.25))
            if not tent.get(px - ox, py - oy):
                base.px(px, py, rgb('#ece6d2'))


# ───────────────────────── sleeping bags ─────────────────────────

def sleeping_bag(colour, lining='#e9dcb8'):
    """A mummy bag laid out, its hood to the top: puffy quilted channels that bow round its curve (lit on the left,
    falling into shade on the right), the hood's opening with a flannel lining and a pillow in it, the drawstring's
    toggles, a zip down the right side with its pull, and the rounded foot box."""
    W, H = 20, 46
    c = Cv(W, H)
    t = tones(colour, 0.15)
    cx = 9.5

    def half(y):                                                           # how wide it is on each row
        if y < 3:
            return 5 + y * 1.4
        if y < 14:
            return 8.6 + min(1, (y - 3) / 6) * 0.9
        if y < 38:
            return 9.5 - (y - 14) * 0.13
        return max(2.0, 6.4 - (y - 38) ** 1.5 * 0.55)                     # the foot box, rounded
    for y in range(H - 1):
        hw = half(y)
        for x in range(W):
            u = (x + 0.5 - cx) / hw
            if abs(u) > 1:
                continue
            k = 3 if u < -0.55 else 2 if u < 0.25 else 1 if u < 0.75 else 0
            if y >= 12:
                bow = round(2.2 * u * u)
                r = (y - 12 + bow) % 4
                if r == 0:
                    k = max(0, k - 1) if k > 0 else 0                       # the stitched line between two channels
                elif r == 1 and k < 4:
                    k += 1                                                  # each channel puffed up just below it
            if abs(u) > 0.9:
                k = max(0, k - 1)
            c.px(x, y, t[min(4, k)])
    # the hood's opening: the lining, a pillow inside it, the drawstring
    lin = Mat(lining, hi=tint(rgb(lining), 0.3), lo=shade(rgb(lining), 0.25))
    c.part(ellipse(9.5, 7.5, 5.5, 5), lin, hi='b', lo='t')
    c.part(ellipse(9.5, 6.5, 4, 3), Mat('#f6f2e6', hi='#ffffff', lo='#c8c0aa'), hi='tl', lo='rb')   # the pillow
    c.rect(7, 6, 12, 6, rgb('#d8d0bc'))
    c.px(7, 13, rgb('#2a2a2a')); c.px(12, 13, rgb('#2a2a2a'))               # the drawstring's toggles
    c.rect(4, 12, 15, 12, t[0])
    # the zip down the right side, and its pull
    for y in range(13, 37):
        x = round(cx + half(y) * 0.62)
        c.px(x, y, rgb('#d9dde4') if y % 2 else rgb('#9aa0a8'))
    zx = round(cx + half(30) * 0.62)
    c.rect(zx, 30, zx + 1, 32, rgb('#3a3d44')); c.px(zx, 30, rgb('#c9ced6'))
    return c


def rolled_bag(colour):
    """A sleeping bag rolled up in its straps: a fat roll lying across, the spiral of its end showing on the left."""
    c = Cv(26, 13)
    t = tones(colour, 0.15)
    for y in range(13):
        v = (y - 6) / 6.2
        k = 4 if v < -0.6 else 3 if v < -0.15 else 2 if v < 0.45 else 1 if v < 0.8 else 0
        for x in range(4, 25):
            c.px(x, y, t[k])
    c.part(ellipse(4.5, 6, 4.2, 6), Mat(t[2], hi=t[3], lo=t[0]), hi='tl', lo='rb')
    for r, col in ((3, t[1]), (2, t[3]), (1, t[0])):                        # the spiral of the roll's end
        for a in range(0, 360, 20):
            c.px(round(4.5 + r * math.cos(math.radians(a))), round(6 + r * 1.3 * math.sin(math.radians(a))), col)
    for sx in (11, 19):
        c.rect(sx, 0, sx + 1, 12, rgb('#2a2a2e')); c.px(sx, 0, rgb('#5a5a62')); c.rect(sx - 1, 5, sx + 2, 7, rgb('#8a8e96'))   # the straps and their buckles
    return c


def pillow():
    c = Cv(14, 8)
    c.part([(0, 2, 11)] + rows(0, 1, 13, 6) + [(7, 2, 11)], Mat('#e9e4d8', hi='#ffffff', lo='#b9b3a3'), hi='tl', lo='rb')
    c.rect(3, 3, 10, 3, rgb('#d8d2c2')); c.px(2, 1, rgb('#ffffff'))
    return c


# ───────────────────────── coolers, the camp table, the woodpile ─────────────────────────

def cooler(body, w=24):
    """A cooler, seen from above and in front: a white lid (lit along its top, a recess for the hand in the middle, the
    hinge line at the back), a coloured body rounded at the corners, a badge, the drain plug, a rope handle each end."""
    c = Cv(w + 4, 20)
    b = tones(body, 0.16)
    lid = tones('#eeeee8', 0.12)
    x0, x1 = 2, w + 1
    c.part([(0, x0 + 2, x1 - 2), (1, x0 + 1, x1 - 1)] + rows(x0, 2, x1, 6), Mat(lid[2], hi=lid[4], lo=lid[1]), hi='tl', lo='rb')
    c.rect(x0 + 1, 1, x1 - 2, 1, lid[4])
    c.rect(x0 + 6, 3, x1 - 6, 4, lid[1]); c.rect(x0 + 6, 3, x1 - 6, 3, lid[0])   # the recess for a hand
    c.rect(x0 + 2, 7, x1 - 2, 7, lid[0])                                    # the lid's front edge, overhanging
    for y in range(8, 18):
        for x in range(x0, x1 + 1):
            u = (x - x0) / (x1 - x0)
            k = 3 if u < 0.12 else 1 if u > 0.86 else 2
            if y == 8:
                k = min(4, k + 1)
            if y >= 16:
                k = max(0, k - 1)
            if (x in (x0, x1)) and y in (8, 17):
                continue                                                    # its rounded corners
            c.px(x, y, b[k])
    c.rect(x0 + 3, 10, x0 + 9, 13, lid[3]); c.rect(x0 + 4, 11, x0 + 8, 11, b[0]); c.rect(x0 + 4, 12, x0 + 6, 12, b[0])   # the badge
    c.px(x0 + 2, 16, rgb('#5a5e66'))                                         # the drain plug
    for hx in (x0 - 2, x1 + 1):                                             # a rope handle each end
        c.rect(hx, 9, hx + 1, 9, rgb('#3a3a40')); c.rect(hx, 10, hx, 12, rgb('#5a5a62')); c.rect(hx, 12, hx + 1, 12, rgb('#3a3a40'))
    c.rect(x0 + 1, 18, x0 + 3, 19, b[0]); c.rect(x1 - 3, 18, x1 - 1, 19, b[0])   # its feet
    return c


def camp_table():
    """A folding camp table: a roll-up top of aluminium slats on a frame, X legs; on it the bag of marshmallows (puffy,
    its top crimped), a box of graham crackers, two bars of chocolate, the toasting sticks with their wire tines, a mug,
    and the lantern (a green base, the glass with the mantle bright in it, the bail over the top)."""
    W, H = 44, 40
    c = Cv(W, H)
    alu = Mat('#c9ced6', hi='#eef1f5', lo='#8d939c')
    y0 = 16                                                                 # the top's back edge
    for k in range(8):                                                      # the slats
        x = 3 + k * 5
        c.part(rows(x, y0, x + 4, y0 + 10), Mat('#d8c8a0', hi='#efe2c0', lo='#a8946a'), hi='tl', lo='rb')
    c.rect(2, y0 - 1, 43, y0 - 1, alu.hi); c.rect(2, y0 + 11, 43, y0 + 12, alu.base); c.rect(2, y0 + 12, 43, y0 + 12, alu.lo)    # the frame
    for lx0, lx1 in ((5, 13), (31, 39)):                                    # the X legs
        line(c, lx0, y0 + 13, lx1, H - 1, alu.lo); line(c, lx1, y0 + 13, lx0, H - 1, alu.base)
        line(c, lx0 + 1, y0 + 13, lx1 + 1, H - 1, alu.hi)
        c.px((lx0 + lx1) // 2, y0 + 13 + (H - y0 - 14) // 2, rgb('#3a3d44'))
    c.rect(4, H - 1, 6, H - 1, rgb('#2a2a2e')); c.rect(38, H - 1, 40, H - 1, rgb('#2a2a2e'))
    # the marshmallows: a puffy white bag, its top crimped, blue lettering, two loose on the table
    c.part([(y0 - 9, 6, 13), (y0 - 8, 5, 14)] + rows(4, y0 - 7, 15, y0 + 4), Mat('#f6f6f2', hi='#ffffff', lo='#c8c8c0'), hi='tl', lo='rb')
    c.rect(6, y0 - 10, 13, y0 - 10, rgb('#d8d8d0')); c.rect(7, y0 - 11, 12, y0 - 11, rgb('#3a6ad8'))     # the crimp, the twist tie
    c.rect(6, y0 - 3, 13, y0 - 1, rgb('#3a6ad8')); c.rect(7, y0 - 2, 12, y0 - 2, rgb('#f6f6f2'))
    for mx in (5, 9, 12):
        c.px(mx, y0 + 1, rgb('#e8e8e0'))                                   # the marshmallows showing through it
    for mx, my in ((17, y0 + 6), (20, y0 + 7)):
        c.part([(my, mx, mx + 1), (my + 1, mx, mx + 1)], Mat('#ffffff', hi='#ffffff', lo='#d8d4c8'), hi='', lo='rb')
    # the graham crackers, and two bars of chocolate
    c.part(rows(17, y0 - 6, 25, y0 + 2), Mat('#c8742c', hi='#e8944c', lo='#8a4a1a'), hi='tl', lo='rb')
    c.rect(18, y0 - 3, 24, y0 - 2, rgb('#f2c860')); c.px(19, y0 - 5, rgb('#7a2a10')); c.px(23, y0 - 5, rgb('#7a2a10'))
    for k, bx in enumerate((26, 26)):
        yy = y0 + 1 + k * 3
        c.part(rows(bx, yy, bx + 8, yy + 2), Mat('#5a2e1a', hi='#7a4428', lo='#3a1a10'), hi='t', lo='b')
        c.rect(bx + 5, yy, bx + 8, yy + 2, rgb('#c9ced6')); c.px(bx + 5, yy, rgb('#eef1f5'))     # the foil, peeled back
    # the toasting sticks, laid across the front, their wire tines
    for k in range(3):
        y = y0 + 8 + k
        c.rect(3, y, 33, y, rgb('#9a7448') if k != 1 else rgb('#c9a06a'))
        c.rect(34, y, 38, y, rgb('#c9ced6'))
    # a tin mug
    c.part(rows(36, y0 - 3, 40, y0 + 2), Mat('#4a7ac8', hi='#7aa2e8', lo='#2a4a8a'), hi='tl', lo='rb')
    c.rect(36, y0 - 3, 40, y0 - 3, rgb('#eef1f5')); c.rect(41, y0 - 1, 41, y0 + 1, rgb('#2a4a8a'))
    # the lantern, on the right-hand end
    lx = 33
    c.part([(y0 - 2, lx - 3, lx + 3), (y0 - 1, lx - 4, lx + 4), (y0, lx - 4, lx + 4)], Mat('#2f5a44', hi='#4a7a5e', lo='#1d3a2c'), hi='t', lo='b')
    c.part(rows(lx - 3, y0 - 13, lx + 3, y0 - 3), Mat('#ffe9a8', hi='#fffbe8', lo='#e8c070'), hi='l', lo='r')
    c.rect(lx - 1, y0 - 10, lx + 1, y0 - 6, rgb('#fffef6'))                 # the mantle
    for y in (y0 - 12, y0 - 4):
        c.rect(lx - 3, y, lx + 3, y, rgb('#2f5a44'))                        # its guard wires
    c.part([(y0 - 15, lx - 2, lx + 2), (y0 - 14, lx - 3, lx + 3)], Mat('#2f5a44', hi='#4a7a5e', lo='#1d3a2c'), hi='t', lo='b')
    for i in range(7):                                                      # the bail, arched over the top
        a = math.pi * i / 6
        c.px(round(lx - 3 * math.cos(a)), round(y0 - 15 - 3 * math.sin(a)), rgb('#22222a'))
    return c


def woodpile():
    """Split firewood stacked between pairs of stakes on two rails, the ends of every piece facing us (the pale heart, a
    ring or two, a dark rind of bark, cracks), a green tarp thrown over the top in folds and tied; the chopping block
    beside it with the axe bitten in, chips round it, and a couple of pieces dropped in front."""
    W, H = 86, 40
    c = Cv(W, H)
    stake = Mat('#5a3e28', hi='#7a5a3c', lo='#3a281a')
    by = H - 4
    for x0 in (2, 50):
        c.part(rows(x0, by - 1, x0 + 2, by + 1), stake, hi='t', lo='b')
    c.part(rows(2, by - 1, 52, by), Mat('#4a3020', hi='#6a4a30', lo='#2a1a10'), hi='t', lo='b')    # the rails
    for row in range(5):
        n = 9 if row % 2 == 0 else 8
        for k in range(n):
            x = 7 + k * 5 + (row % 2) * 2.5 + (hsh(k, row, 236) % 3 - 1) * 0.4
            y = by - 4 - row * 5
            r = 2.2 + (hsh(k, row, 237) % 3) * 0.25
            split = hsh(k, row, 238) % 3                                    # half rounds, quarters and whole rounds
            pts = ellipse(x, y, r + 0.3, r)
            c.part(pts, Mat('#5a3a24', hi='#7a5a3c', lo='#3a2418'), hi='tl', lo='rb')     # the bark rind
            for yy, a, b in ellipse(x, y, r - 0.7, r - 0.9):
                for xx in range(a, b + 1):
                    d = math.hypot(xx - x, (yy - y) * 1.1)
                    col = rgb('#ecd3a8') if d < 0.8 else rgb('#d9b98a') if d < r * 0.55 else rgb('#c4a070')
                    if abs(d - r * 0.45) < 0.4:
                        col = rgb('#b08e5e')                                # a ring
                    c.px(xx, yy, col)
            if split == 1:
                line(c, round(x - r + 1), round(y), round(x + r - 1), round(y), rgb('#8a6644'))        # split across
            elif split == 2:
                c.px(round(x), round(y - 1), rgb('#8a6644')); c.px(round(x + 1), round(y), rgb('#8a6644'))   # a check in it
    for x0 in (2, 50):                                                      # the stakes, in front of the ends of the rows
        c.part(rows(x0, by - 28, x0 + 2, by), stake, hi='l', lo='r')
        c.px(x0 + 1, by - 28, stake.hi)
    # the tarp over the top: green, falling in folds over the front of the top row, a rope over it
    tarp = tones('#3f7a4a', 0.16)
    for x in range(1, 56):
        top = by - 30 + round(1.5 * math.sin(x / 5.0))
        hang = 4 + round(2.5 * (0.5 + 0.5 * math.sin(x / 3.1 + 1.3)))
        for y in range(top, top + hang + 1):
            f = math.sin(x / 3.1 + 1.3)
            k = 3 if f > 0.5 else 2 if f > -0.3 else 1
            if y == top:
                k = 4
            if y == top + hang:
                k = 0
            c.px(x, y, tarp[k])
    line(c, 0, by - 27, 56, by - 25, rgb('#e8e2cc'))
    # the chopping block, the axe in it, chips about
    bx = 62
    c.part(rows(bx, by - 10, bx + 15, by + 2), Mat('#6a4a30', hi='#8a6644', lo='#4a3020'), hi='l', lo='rb')
    for x in (bx + 3, bx + 7, bx + 12):
        c.rect(x, by - 6, x, by + 1, rgb('#4a3020'))
    c.part(ellipse(bx + 7.5, by - 10, 8, 3.2), Mat('#d9b98a', hi='#ecd3a8', lo='#b08e5e'), hi='t', lo='b')
    for a in range(0, 360, 30):
        c.px(round(bx + 7.5 + 4 * math.cos(math.radians(a))), round(by - 10 + 1.6 * math.sin(math.radians(a))), rgb('#c4a070'))
    c.part(rows(bx + 8, by - 27, bx + 9, by - 12), Mat('#c9a06a', hi='#e0bb82', lo='#9a7448'), hi='l', lo='r')     # the axe's handle
    c.part([(by - 14, bx + 3, bx + 12), (by - 13, bx + 2, bx + 12), (by - 12, bx + 3, bx + 12)], Mat('#8d939c', hi='#c9ced6', lo='#5d636b'), hi='t', lo='b')
    c.rect(bx + 2, by - 13, bx + 3, by - 13, rgb('#eef2f6'))                # its edge, bright
    for k in range(9):
        c.px(bx - 6 + hsh(k, 1, 231) % 26, by + 1 + hsh(k, 2, 231) % 3, rgb('#d9b98a') if k % 3 else rgb('#ecd3a8'))
    for x0, y0 in ((30, by + 2), (42, by + 1)):                             # two pieces dropped in front
        c.part(rows(x0, y0, x0 + 8, y0 + 2), Mat('#7a5a3c', hi='#9a7a50', lo='#4a3020'), hi='t', lo='b')
        c.part(ellipse(x0 + 8, y0 + 1, 1.2, 1.5), Mat('#d9b98a', hi='#ecd3a8', lo='#b08e5e'), hi='t', lo='b')
    return c


# ───────────────────────── the woods' edge ─────────────────────────

def fern(size=1.0, seed=0, dark=0.0):
    """A fern: fronds arching out from the middle, each a stem with leaflets down both sides, lighter at the tips."""
    w, h = int(30 * size), int(18 * size)
    c = Cv(w, h)
    g = [shade(rgb(x), dark) for x in ('#1f4a26', '#2d6a34', '#3f8a3c', '#5dae4f', '#86c66c')]
    cx = w / 2
    for k, ang in enumerate((-2.5, -1.9, -1.3, -0.6, 0.6, 1.3, 1.9, 2.5)):
        L = (10 + hsh(k, seed, 81) % 5) * size
        for i in range(int(L)):
            t = i / L
            x = cx + math.sin(ang * 0.55) * i * 1.15
            y = h - 1 - i * math.cos(ang * 0.55) * 0.85 + t * t * 5 * size
            col = g[1 + min(3, int(t * 3.5))]
            c.px(round(x), round(y), col)
            if i % 2 == 0 and 0.15 < t < 0.92:
                leaf = max(1, round((1 - t) * 3 * size))
                for j in range(1, leaf + 1):
                    c.px(round(x - j * math.cos(ang * 0.55) * 0.7), round(y - j * 0.5), g[2 + (j == 1)])
                    c.px(round(x + j * math.cos(ang * 0.55) * 0.7), round(y - j * 0.5 + 1), g[1])
    return S.wither(mc, c, seed)                                           # (gold in the fall, dead brown in winter)


def bush(r=10, seed=0, dark=0.0, evergreen=False):
    """Undergrowth: a low leafy bush, a dark underside. Turning in the fall and brown in winter, unless it is evergreen
    (a hedge)."""
    c = Cv(2 * r + 4, int(1.5 * r) + 4)
    leaf = [shade(x, dark) for x in mc.LEAF['box']]
    mc.clump(c, r + 2, int(0.85 * r) + 2, r, r * 0.8, leaf, 300 + seed)
    return c if evergreen else S.wither(mc, c, seed, 'bush')


def grass_tuft(seed, tall=10, dark=0.0):
    """Long grass at the woods' edge: a tuft of blades of different lengths, leaning, lighter at their tips, the odd
    seed head."""
    c = Cv(13, tall + 2)
    g = [shade(rgb(x), dark) for x in ('#2d6a34', '#4f9e47', '#74c45e', '#9ccc6a', '#d2dd96')]
    for k in range(7):
        lean = (hsh(k, seed, 91) % 9 - 4) * 0.6
        L = tall * (0.5 + (hsh(k, seed, 92) % 50) / 100)
        for i in range(int(L)):
            t = i / L
            x = 6 + round(lean * t * t * 1.6) + (k - 3) // 2
            c.px(x, tall + 1 - i, g[min(4, 1 + int(t * 3.2))] if k % 3 else g[min(3, int(t * 3))])
        if hsh(k, seed, 93) % 4 == 0:
            x = 6 + round(lean * 1.6) + (k - 3) // 2
            c.px(x, tall + 1 - int(L), rgb('#e8dca8')); c.px(x, tall - int(L), rgb('#f6ecc8'))
    return S.wither(mc, c, seed)


# ───────────────────────── camp lights ─────────────────────────

def lantern():
    """A camp lantern, lit: a green base and cap, the glass glowing with the bright mantle in it, the wire bail."""
    c = Cv(9, 14)
    g = Mat('#2f5a44', hi='#4a7a5e', lo='#1d3a2c')
    c.part([(3, 2, 6), (4, 1, 7)], g, hi='t', lo='b')                       # the cap
    c.part(rows(1, 5, 7, 10), Mat('#ffe9a8', hi='#fffbe8', lo='#e8c070'), hi='l', lo='r')
    c.rect(3, 6, 5, 9, rgb('#fffef6'))                                      # the mantle
    c.rect(1, 8, 7, 8, g.lo)                                                # a guard wire
    c.part([(11, 1, 7), (12, 1, 7), (13, 2, 6)], g, hi='t', lo='b')         # the base
    for i in range(5):                                                      # the bail
        a = math.pi * i / 4
        c.px(round(4 - 3 * math.cos(a)), round(2 - 2 * math.sin(a)), rgb('#22222a'))
    return c


def shepherd_hook():
    """A black iron shepherd's hook stuck in the ground, a lantern hanging from its crook. Returns it, and where the
    lantern's glass is (from its top-left corner)."""
    c = Cv(16, 48)
    iron = Mat('#2a2a30', hi='#5a5a66', lo='#141418')
    c.part(rows(3, 6, 4, 47), iron, hi='l', lo='r')                         # the post
    for i in range(9):                                                      # the crook, curling over
        a = math.pi * i / 8
        c.rect(round(8 - 4.5 * math.cos(a)), round(6 - 4 * math.sin(a)), round(8 - 4.5 * math.cos(a)) + 1, round(6 - 4 * math.sin(a)), iron.base)
    c.rect(12, 6, 12, 9, iron.base)
    c.rect(1, 44, 6, 44, iron.lo)                                           # the foot bar
    c.paste(lantern(), 8, 9)
    return c, (12, 17)


def tiki_torch():
    """A tiki torch: a bamboo pole (nodes every so often, lit down its left side), a woven cup at the top and the wick in
    it. The flame is the page's (it flickers): its foot is at `flame` (from the top-left corner)."""
    c = Cv(9, 40)
    cane = Mat('#c8a060', hi='#e8c888', lo='#8a6a38')
    c.part(rows(3, 7, 5, 39), cane, hi='l', lo='r')
    for y in range(13, 39, 7):                                              # the nodes
        c.rect(3, y, 5, y, cane.lo); c.rect(2, y + 1, 6, y + 1, cane.hi); c.px(6, y + 1, cane.lo)
    weave = Mat('#7a5a30', hi='#a07a44', lo='#4a3418')
    c.part([(2, 1, 7), (3, 1, 7), (4, 1, 7), (5, 2, 6), (6, 2, 6)], weave, hi='t', lo='rb')   # the cup
    for x in range(1, 8, 2):
        c.px(x, 3, weave.lo); c.px(x + 1, 4, weave.lo)
    c.rect(3, 1, 5, 1, rgb('#2a1a10')); c.px(4, 0, rgb('#3a3020'))         # the wick in its collar
    c.flame = (4, 1)
    return c


def stump_lantern():
    """A short sawn stump with a lantern stood on it."""
    c = Cv(16, 24)
    log = Mat('#6a4a30', hi='#8a6644', lo='#4a3020')
    c.part(rows(1, 15, 14, 23), log, hi='l', lo='rb')
    for x in (4, 8, 12):
        c.rect(x, 18, x, 22, rgb('#4a3020'))
    c.part(ellipse(7.5, 15, 7, 2.6), Mat('#d9b98a', hi='#ecd3a8', lo='#b08e5e'), hi='t', lo='b')
    c.paste(lantern(), 4, 2)
    return c


def bulbs(base, x0, y0, x1, y1, sag, every=12):
    """A string of party bulbs between two points, sagging in the middle: a dark cord, a warm bulb hanging every so
    often (laid on the ground layer with no outline). Returns where each bulb is."""
    out = []
    n = max(1, abs(x1 - x0))
    prev = None
    for i in range(n + 1):
        t = i / n
        x = x0 + (x1 - x0) * t
        y = y0 + (y1 - y0) * t + sag * 4 * t * (1 - t)
        p = (round(x), round(y))
        if p != prev:
            base.px(p[0], p[1], rgb('#1a1a1e'))
            prev = p
        if i % every == every // 2:
            bx, by = p
            base.px(bx, by + 1, rgb('#3a3a40'))
            for (dx, dy, col) in ((0, 2, '#ffe9a8'), (-1, 3, '#ffd070'), (0, 3, '#fffbe8'), (1, 3, '#ffd070'), (0, 4, '#f2b050')):
                base.px(bx + dx, by + dy, rgb(col))
            out.append((bx, by + 3))
    return out


def light_post(h=52):
    """A cedar four-by-four sunk in the ground, for a string of bulbs: lit down its left face, the grain in streaks, a
    sloped cap on top and an eye screwed in under it for the cord. Returns it and where the eye is (from its top-left)."""
    c = Cv(9, h)
    wood = Mat('#8a6440', hi='#b08454', lo='#5f4026')
    c.part(rows(2, 3, 6, h - 1), wood, hi='l', lo='r')
    for y in range(6, h - 2):
        if hsh(y, 3, 610) % 5 == 0:
            c.px(3 + hsh(y, 4, 610) % 3, y, wood.lo)                        # the grain
    c.part([(0, 3, 5), (1, 2, 6), (2, 1, 7)], Mat('#6a4a30', hi='#8a6644', lo='#3a2418'), hi='t', lo='b')   # the cap
    c.rect(2, h - 3, 6, h - 1, shade(wood.base, 0.3))                     # damp where it goes into the ground
    c.px(7, 5, rgb('#9a9aa2')); c.px(8, 5, rgb('#5a5a62'))                  # the eye the cord is tied to
    c.eye = (8, 5)
    return c


def bulb_string(c, x0, y0, x1, y1, sag, every=12):
    """art.bulbs, onto a canvas of its own (to be put in front of whoever walks behind the posts)."""
    return bulbs(c, x0, y0, x1, y1, sag, every)


def telescope():
    """A refractor on a wooden tripod, pointed up at the sky to the right: a white tube with a black dew shield and
    brass bands, a little finder scope on top, the tripod's three legs splayed with a tray between them. Its eyepiece
    is at the tube's low end, at the eye of somebody standing to its left (feet on the same line, 10 dots to the left of
    its middle): a black barrel and a rubber eyecup, at the height of a standing person's eye (30 dots up)."""
    c = Cv(32, 44)
    leg = Mat('#a37747', hi='#c79a66', lo='#6f4d2c')
    for (x0, y0, x1, y1) in ((17, 17, 7, 43), (18, 17, 27, 43), (17, 17, 18, 41)):
        line(c, x0, y0, x1, y1, leg.base); line(c, x0 + 1, y0, x1 + 1, y1, leg.lo)
    c.rect(11, 32, 23, 32, leg.lo); c.rect(12, 31, 22, 31, leg.hi)          # the tray
    c.rect(15, 13, 19, 17, rgb('#2a2a30')); c.px(15, 13, rgb('#5a5a66'))     # the mount
    tube = Mat('#eeeee8', hi='#ffffff', lo='#b8b8b0')
    for i in range(22):                                                     # the tube, tilted up to the right
        x, y = 11 + i, 14 - i * 0.5
        for w in range(-2, 3):
            col = tube.hi if w == -2 else tube.lo if w >= 1 else tube.base
            if i >= 17:
                col = rgb('#1a1a1e') if w > -2 else rgb('#4a4a52')          # the dew shield
            if i in (5, 12):
                col = rgb('#c9a24a') if w < 1 else rgb('#8a6a28')           # brass bands
            if 0 <= x < 32:
                c.px(x, math.floor(y + w + 0.5), col)
    c.rect(30, 1, 31, 6, rgb('#6a6a72'))                                    # the lens's rim, catching the light
    for i in range(7):                                                      # the finder scope on top
        c.px(15 + i, math.floor(10 - i * 0.5 + 0.5), rgb('#2a2a30'))
    c.rect(11, 13, 12, 16, rgb('#2a2a30'))                                  # the focuser
    c.rect(9, 13, 10, 15, rgb('#121216')); c.px(9, 13, rgb('#4a4a56'))      # the eyepiece's barrel and eyecup, at the eye
    c.eye = (9, 14)
    return c


def radio():
    """A little vintage portable radio: a cream case with a chrome handle over the top, the speaker grille in rows on
    the left, a dial window on the right with its needle, two knobs, and a chrome aerial pulled up at an angle."""
    c = Cv(18, 22)
    case = Mat('#d8c8a0', hi='#efe2c0', lo='#a8946a')
    c.part(rows(1, 10, 16, 20), case, hi='tl', lo='rb')
    c.rect(1, 18, 16, 18, rgb('#9a2a24')); c.rect(1, 19, 16, 20, rgb('#7a1e1a'))   # a red band round the foot
    for y in range(12, 17, 2):                                              # the grille
        c.rect(3, y, 8, y, rgb('#6a5a3a'))
    c.rect(10, 12, 15, 15, rgb('#2a2218')); c.rect(11, 13, 14, 14, rgb('#e8c070'))   # the dial window, lit
    c.px(12, 13, rgb('#c23b3b')); c.px(12, 14, rgb('#c23b3b'))              # its needle
    c.px(11, 17, rgb('#3a3a40')); c.px(14, 17, rgb('#3a3a40'))              # the knobs
    chrome = rgb('#c9ced6')
    c.rect(4, 7, 13, 7, chrome); c.rect(4, 8, 4, 9, chrome); c.rect(13, 8, 13, 9, chrome)   # the handle
    line(c, 15, 9, 17, 0, rgb('#e8ecf0'))                                  # the aerial
    c.px(17, 0, rgb('#ffffff'))
    return c


def cornhole_board(back_left):
    """A regulation cornhole board, 2 feet by 4 (32 by 16 dots at 8 to a foot), lying along the ground with its long
    side to us: the deck rises from 2.5 inches at the front to 12 at the back (2 dots to 8), so its top is lifted that
    much and its side shows as a wedge under it, its back legs in shadow. The deck is sanded birch with a painted
    border and a pine tree; the hole, 6 inches across, has its middle 9 inches in from the back. back_left: the back
    (the high end) on the left. Returns a canvas 34 wide, 26 high, its ground line (the bottom of the deck's near edge
    at the front) at row 24, the board's ends at x 1 and 32."""
    c = Cv(34, 26)
    deck = tones('#d9b98a', 0.1)
    paint = tones('#2f5a44', 0.15)
    side = Mat('#8a6440', hi='#a37747', lo='#5f4026')

    def lift(u):                                                            # u: 0 at the back end to 32 at the front
        return 8 - 6 * u / 32

    for u in range(32):
        x = 1 + (u if back_left else 31 - u)
        L = lift(u)
        for v in range(16):
            y = round(24 - 16 + v - L) + 1
            edge = v < 1 or v > 14 or u < 1 or u > 30
            col = paint[2] if edge else deck[2]
            if v == 0:
                col = paint[3]
            elif v == 15:
                col = paint[1]
            if not edge and v in (5, 10) and (u + v) % 9 < 6:
                col = mix(deck[2], deck[1], 0.5)                            # the birch's grain, faint, along the board
            if not edge and (v == 1 or u == 1 or u == 30):
                col = deck[3]                                               # the deck's sanded edge, catching the light
            c.px(x, y, col)
        for k in range(round(L)):                                           # the side under the near edge
            c.px(x, 25 - round(L) + k, side.lo if u < 3 and back_left or u < 3 and not back_left else side.base if k else side.hi)
    # a pine painted on the deck, toward the front
    fx = 1 + (20 if back_left else 11)
    for i, w in enumerate((0, 1, 1, 2, 2, 3)):
        Lf = lift(20)
        y = round(24 - 16 + 4 + i - Lf) + 1
        for d in range(-w, w + 1):
            c.px(fx + d, y, paint[2])
    # the hole: middle 6 dots in from the back, 4 across
    hu = 6
    hx = 1 + (hu if back_left else 31 - hu)
    Lh = lift(hu)
    hy = round(24 - 16 + 8 - Lh) + 1
    for (dx, dy) in ((-1, -2), (0, -2), (-2, -1), (-1, -1), (0, -1), (1, -1), (-2, 0), (-1, 0), (0, 0), (1, 0), (-1, 1), (0, 1)):
        c.px(hx + dx, hy + dy, rgb('#120c08'))
    c.px(hx - 2, hy - 1, rgb('#3a2a1a')); c.px(hx - 1, hy - 2, rgb('#3a2a1a'))
    c.hole = (hx, hy)
    return c
