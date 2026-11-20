"""The mini golf's three scenes, out past the backyard's gate (scripts/basement/minigolf.py, minigolf2.py, minigolf3.py:
holes 1 to 3, 4 to 6 and 7 to 9). Each scene is a summer garden with three holes laid out in it, and a footpath on to
the next one at its left edge (the first scene's way back is the path at its bottom right, down to the backyard; the
others' is the path at their right edge, back to the scene before).

The holes are the nine of client/src/basement/golf-courses.json, each in its own 600 x 300 space (the physics,
client/src/basement/golf.ts, plays every putt there), drawn here into the scene at SC dots a unit with its top-left corner
at PLACE[n]: the turf, the rails round it and inside it (lit along the top, a face and a shadow below), water, sand,
slopes and mounds shaded by the way they lie (with faint chevrons down a slope), the cup, a rubber tee mat, the rubber
posts, the pipes' mouths, a ramp, the one-way flaps and the windmill's building. What moves (the windmill's sails, the
sliding doors, the sweepers), the balls and the flags are the page's (client/src/basement/minigolf.tsx), which reads
things['golf'] for where each hole is.

The underscore keeps this file off the list of fit-outs."""
import json
import math
import os

import numpy as np

SC = 0.4                                         # scene dots per unit of a hole's own space
# each hole's scene and the scene dot its (0, 0) is drawn at
PLACE = {0: ('minigolf', 30, 40), 1: ('minigolf', 276, 46), 2: ('minigolf', 30, 186),
         3: ('minigolf2', 30, 40), 4: ('minigolf2', 276, 40), 5: ('minigolf2', 30, 186),
         6: ('minigolf3', 30, 40), 7: ('minigolf3', 276, 40), 8: ('minigolf3', 30, 186)}
SCENES = ['minigolf', 'minigolf2', 'minigolf3']
LANE = 172                                       # the row the footpath runs along between the holes, edge to edge
GROUND = (8, 50, 520, 330)
BALL_R, CUP_R, PIPE_R = 5, 8, 11
PIPE_RING = ['#c8783a', '#3a9ec8', '#d8b43a', '#a85ac8']

HERE = os.path.dirname(os.path.abspath(__file__))
HOLES = json.load(open(os.path.join(HERE, '..', '..', 'client', 'src', 'basement', 'golf-courses.json'), encoding='utf-8'))

# rails, one kind to a scene: cedar, fieldstone, brick
RAILS = {
    'minigolf': dict(top='#e2b47a', mid='#b07a46', face='#764a28', dark='#3e2412', grain='#946238'),
    'minigolf2': dict(top='#e4e0d4', mid='#b2aea2', face='#7a766c', dark='#3a3834', grain='#9a968a'),
    'minigolf3': dict(top='#ec9a78', mid='#b8563c', face='#7c3222', dark='#3e160e', grain='#d8c8b0'),
}
DIGITS = {'0': '111 101 101 101 111', '1': '010 110 010 010 111', '2': '111 001 111 100 111', '3': '111 001 111 001 111',
          '4': '101 101 111 001 001', '5': '111 100 111 001 111', '6': '111 100 111 101 111', '7': '111 001 010 010 010',
          '8': '111 101 111 101 111', '9': '111 101 111 001 111', 'P': '110 101 110 100 100', 'A': '010 101 111 101 101',
          'R': '110 101 110 101 101', ' ': '0 0 0 0 0'}


def X(n, hx):
    return PLACE[n][1] + hx * SC


def Y(n, hy):
    return PLACE[n][2] + hy * SC


def inside(p, poly):
    c = False
    j = len(poly) - 1
    for i in range(len(poly)):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if (yi > p[1]) != (yj > p[1]) and p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi:
            c = not c
        j = i
    return c


def seg_d(p, a, b):
    ex, ey = b[0] - a[0], b[1] - a[1]
    l2 = ex * ex + ey * ey or 1
    t = max(0.0, min(1.0, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ey) / l2))
    return math.hypot(p[0] - a[0] - ex * t, p[1] - a[1] - ey * t)


def poly_d(p, poly):
    return min(seg_d(p, poly[i], poly[(i + 1) % len(poly)]) for i in range(len(poly)))


def lean(h, x, y):
    """As golf.ts lean(), without the ramps (drawn as ramps): the push the ground gives a ball at (x, y)."""
    ax = ay = 0.0
    for sx, sy, w, hh, px, py in h['slopes']:
        if sx <= x <= sx + w and sy <= y <= sy + hh:
            ax += px; ay += py
    for m in h.get('mounds') or []:
        mx, my, r, push = m[:4]
        flat = m[4] if len(m) > 4 else 0
        dx, dy = x - mx, y - my
        d = math.hypot(dx, dy)
        if d <= flat or d >= r or d == 0:
            continue
        k = push * math.sin(math.pi * (d - flat) / (r - flat))
        ax += dx / d * k; ay += dy / d * k
    return ax, ay


def draw_hole(mc, n, scene):
    """Hole n, onto mc.base, in its place in the scene."""
    rgb, mix, shade, tint, hsh, noise, base = mc.rgb, mc.mix, mc.shade, mc.tint, mc.hsh, mc.noise, mc.base
    h = HOLES[n]
    R = {k: rgb(v) for k, v in RAILS[scene].items()}
    _, ox, oy = PLACE[n]
    xs = [p[0] for p in h['fairway']]
    ys = [p[1] for p in h['fairway']]
    x0, x1 = int(ox + min(xs) * SC) - 5, int(ox + max(xs) * SC) + 6
    y0, y1 = int(oy + min(ys) * SC) - 5, int(oy + max(ys) * SC) + 7
    W, H = x1 - x0 + 1, y1 - y0 + 1
    hx = lambda x: (x + 0.5 - ox) / SC
    hy = lambda y: (y + 0.5 - oy) / SC
    # what each dot is: 0 not the hole's, 1 turf, 2 rail
    kind = np.zeros((H, W), np.int8)
    for y in range(H):
        for x in range(W):
            p = (hx(x0 + x), hy(y0 + y))
            if inside(p, h['fairway']):
                kind[y, x] = 1
                if any(seg_d(p, a, b) * SC < 1.15 for a, b in h['walls']):
                    kind[y, x] = 2
            elif poly_d(p, h['fairway']) * SC < 3.2:
                kind[y, x] = 2
    rail = kind == 2
    # the turf: a fine green carpet, faint stripes down its length, darker where it meets a rail
    turf = [rgb(c) for c in ('#2f8a40', '#379a48', '#3fa650', '#48b058')]
    sand = [rgb(c) for c in ('#e2cc94', '#d4bc82', '#ecdaa8', '#c8ae72')]
    water = (rgb('#5ab4d6'), rgb('#2e7cb0'), rgb('#1e5a8e'))
    for y in range(H):
        for x in range(W):
            if kind[y, x] != 1:
                continue
            X_, Y_ = x0 + x, y0 + y
            p = (hx(X_), hy(Y_))
            if any(inside(p, w) for w in h['water']):
                d = min(poly_d(p, w) for w in h['water'] if inside(p, w)) * SC
                col = mix(water[0], water[1], min(1, d / 5)) if d < 5 else mix(water[1], water[2], min(1, (d - 5) / 10))
                if d < 1.0:
                    col = rgb('#d8eef6')                                   # the lap at the edge
                elif (Y_ * 5 + (X_ // 4) * 3) % 9 == 0 and hsh(X_ // 4, Y_, 901) % 3 == 0:
                    col = tint(col, 0.25)
                base.px(X_, Y_, col)
                continue
            if any(inside(p, s) for s in h['sand']):
                d = min(poly_d(p, s) for s in h['sand'] if inside(p, s)) * SC
                col = sand[hsh(X_, Y_, 902) % 4]
                if d < 1:
                    col = shade(col, 0.2)
                elif hsh(X_, Y_, 903) % 23 == 0:
                    col = rgb('#a89060')
                base.px(X_, Y_, col)
                continue
            i = 1 + (hsh(X_, Y_, 904) % 5 == 0) - (hsh(X_, Y_, 905) % 7 == 0)
            col = turf[i]
            if (int(p[0]) // 45) % 2:
                col = tint(col, 0.04)                                     # the stripes, the long way
            ax, ay = lean(h, *p)
            # a volcano (a great hill): bare brown rock toward its top, a dark crater, the glow of lava round its rim
            for m in h.get('mounds') or []:
                if m[3] < 100:
                    continue
                r = math.hypot(p[0] - m[0], p[1] - m[1])
                flat = m[4] if len(m) > 4 else 0
                if r < flat:
                    col = rgb('#3a2018') if hsh(X_, Y_, 909) % 5 else rgb('#5a2a18')
                    if r > flat - 4:
                        col = rgb('#ff8a2a') if hsh(X_, Y_, 910) % 3 else rgb('#ffd060')
                elif r < m[2] * 0.75:
                    u = (r - flat) / (m[2] * 0.75 - flat)
                    rock = [rgb('#7a4a2e'), rgb('#8a5a3a'), rgb('#6a3a24')][hsh(X_ // 2, Y_ // 2, 911) % 3]
                    col = mix(rock, col, max(0, u - 0.35) / 0.65) if u > 0.35 else rock
                    if u < 0.3 and hsh(X_, Y_, 912) % 17 == 0:
                        col = rgb('#ff7a2a')                                # a trickle of lava
            if ax or ay:
                mag = math.hypot(ax, ay)
                ux, uy = ax / mag, ay / mag
                # the lie of the land: lit where it faces the sun (up and to the left), in shade where it falls away
                k = (ax * 0.6 + ay * 0.8) / 280
                col = shade(col, min(0.24, k)) if k > 0 else tint(col, min(0.18, -k * 0.8))
                in_slope = [q for q in h['slopes'] if q[0] <= p[0] <= q[0] + q[2] and q[1] <= p[1] <= q[1] + q[3]]
                if in_slope:
                    # and higher at its top end than its foot: lighter going up it, darker coming down
                    q = in_slope[0]
                    span = abs(ux) * q[2] + abs(uy) * q[3] or 1
                    along = ((p[0] - (q[0] if ux >= 0 else q[0] + q[2])) * ux + (p[1] - (q[1] if uy >= 0 else q[1] + q[3])) * uy) / span
                    col = tint(col, 0.1 * (0.5 - along)) if along < 0.5 else shade(col, 0.12 * (along - 0.5))
                    # chevrons down it, pointing the way a still ball would roll
                    gx, gy = (X_ - x0) % 12 - 6, (Y_ - y0) % 12 - 6
                    a_, c_ = gx * ux + gy * uy, -gx * uy + gy * ux
                    if abs(a_ + abs(c_) * 0.9) < 0.7 and abs(c_) <= 3:
                        col = tint(col, 0.16 + min(0.14, mag / 600))
                    elif abs(a_ + 1 + abs(c_) * 0.9) < 0.7 and abs(c_) <= 3:
                        col = shade(col, 0.1)
                else:
                    for m in h.get('mounds') or []:
                        r = math.hypot(p[0] - m[0], p[1] - m[1])
                        if r < m[2] and int(r * SC) % 4 == 0 and int((r - 1 / SC) * SC) % 4 != 0:
                            col = shade(col, 0.1) if m[3] > 0 else tint(col, 0.08)    # its contour rings
            # darker into the corners, where the rails shade it
            near = 0
            for dy, dx in ((-1, 0), (0, -1), (-2, 0), (0, -2)):
                yy, xx = y + dy, x + dx
                if 0 <= yy < H and 0 <= xx < W and rail[yy, xx]:
                    near = max(near, 0.3 if abs(dx + dy) == 1 else 0.16)
            if near:
                col = shade(col, near)
            base.px(X_, Y_, col)
    # the rails: lit along the top, a face below, the grain in streaks, and a shadow on the grass outside
    for y in range(H):
        for x in range(W):
            if not rail[y, x]:
                continue
            X_, Y_ = x0 + x, y0 + y
            up = y > 0 and rail[y - 1, x]
            down = y < H - 1 and rail[y + 1, x]
            col = R['mid']
            if not up:
                col = R['top']
            elif not down:
                col = R['face']
            elif hsh(X_ // 3, Y_, 906) % 7 == 0 or (scene == 'minigolf3' and (X_ + (Y_ // 2) * 2) % 5 == 0):
                col = R['grain']
            if scene == 'minigolf2' and up and down and hsh(X_ // 3, Y_ // 2, 907) % 4 == 0:
                col = shade(col, 0.12)                                     # the fieldstone's joints
            if x > 0 and not rail[y, x - 1] and up:
                col = tint(col, 0.08)
            base.px(X_, Y_, col)
            if not down and Y_ + 1 < mc.H:
                base.px(X_, Y_ + 1, R['dark'])                             # the foot of its face
            if not down and kind[min(H - 1, y + 1), x] == 0 and Y_ + 2 < mc.H:
                base.px(X_, Y_ + 2, mix(base.get(X_, Y_ + 2), (14, 34, 30), 0.35))     # its shadow, outside
    # the cup: a dark hole with the white of its liner showing round the far side
    cx, cy = X(n, h['cup'][0]), Y(n, h['cup'][1])
    r = CUP_R * SC
    for y in range(int(cy - r - 2), int(cy + r + 3)):
        for x in range(int(cx - r - 2), int(cx + r + 3)):
            d = math.hypot(x + 0.5 - cx, (y + 0.5 - cy) * 1.15)
            if d < r - 0.6:
                base.px(x, y, rgb('#0c140c') if y + 0.5 > cy - r * 0.2 else rgb('#f2f0e8') if y + 0.5 < cy - r * 0.55 else rgb('#a8a49a'))
            elif d < r + 0.5:
                base.px(x, y, shade(base.get(x, y), 0.35) if y + 0.5 < cy else tint(base.get(x, y), 0.18))
    # the tee: a black rubber mat, a lighter rim, a white spot
    tx, ty = X(n, h['tee'][0]), Y(n, h['tee'][1])
    for y in range(int(ty - 5), int(ty + 6)):
        for x in range(int(tx - 7), int(tx + 8)):
            edge = y in (int(ty - 5), int(ty + 5)) or x in (int(tx - 7), int(tx + 7))
            base.px(x, y, rgb('#4a524a') if edge else rgb('#262c28') if hsh(x, y, 908) % 6 else rgb('#323a34'))
        base.px(int(tx + 8), y, shade(base.get(int(tx + 8), y), 0.3))
    for x in range(int(tx - 6), int(tx + 9)):
        base.px(x, int(ty + 6), shade(base.get(x, int(ty + 6)), 0.3))
    base.px(int(tx), int(ty), rgb('#e8e6dc'))
    # the rubber posts (the page lights one when it is struck)
    for bx, by, br in h['bumpers']:
        draw_post(mc, X(n, bx), Y(n, by), br * SC)
    # the pipes' mouths: a dark hole in a ring of colour, the same colour in and out
    for k, pp in enumerate(h.get('pipes') or []):
        ring = rgb(PIPE_RING[k % 4])
        for mouth in (pp['a'], pp['b']):
            mx, my = X(n, mouth[0]), Y(n, mouth[1])
            pr = PIPE_R * SC
            for y in range(int(my - pr - 2), int(my + pr + 3)):
                for x in range(int(mx - pr - 2), int(mx + pr + 3)):
                    d = math.hypot(x + 0.5 - mx, y + 0.5 - my)
                    if d < pr - 1.6:
                        base.px(x, y, rgb('#0a0c10') if y + 0.5 > my - 1 else rgb('#20242c'))
                    elif d < pr:
                        base.px(x, y, tint(ring, 0.3) if y + 0.5 < my else shade(ring, 0.15))
                    elif d < pr + 0.9 and y + 0.5 > my:
                        base.px(x, y, shade(base.get(x, y), 0.3))
    # a ramp: planks across the way it rises, lit toward its top edge, a shadow off the top
    for rx, ry, rw, rh, dirn in h.get('ramps') or []:
        ax0, ay0, ax1, ay1 = int(X(n, rx)), int(Y(n, ry)), int(X(n, rx + rw)), int(Y(n, ry + rh))
        for y in range(ay0, ay1 + 1):
            for x in range(ax0, ax1 + 1):
                u = (x - ax0) / max(1, ax1 - ax0) if dirn in (0, 180) else (y - ay0) / max(1, ay1 - ay0)
                if dirn in (180, 270):
                    u = 1 - u
                along = (x - ax0) if dirn in (0, 180) else (y - ay0)
                col = mix(rgb('#8a5a32'), rgb('#e0a868'), u)
                if along % 4 == 0:
                    col = shade(col, 0.25)
                if y == ay0:
                    col = tint(col, 0.2)
                base.px(x, y, col)
        top = ax1 + 1 if dirn == 0 else ax0 - 1
        if dirn in (0, 180):
            for y in range(ay0, ay1 + 1):
                base.px(top, y, rgb('#1e1408'))
    # the one-way flaps: a white plank on a hinge post; painted on the turf through it, an arrow the way it lets a ball
    # go, and the arc it swings open through on that side (golf.ts: open to a ball from the left of a→b, going right)
    for a, b in h.get('gates') or []:
        ax_, ay_, bx_, by_ = X(n, a[0]), Y(n, a[1]), X(n, b[0]), Y(n, b[1])
        ln = math.hypot(bx_ - ax_, by_ - ay_) or 1
        ex, ey = (bx_ - ax_) / ln, (by_ - ay_) / ln
        nx, ny = -ey, ex
        paint = lambda x, y, k=0.8: base.px(round(x), round(y), mix(base.get(round(x), round(y)), rgb('#fbf6e2'), k))
        for i in range(2, 40):                                                 # the swing, dotted
            t = i / 40 * 1.35
            if i % 3 == 0:
                continue
            paint(ax_ + ln * (math.cos(t) * ex + math.sin(t) * nx), ay_ + ln * (math.cos(t) * ey + math.sin(t) * ny), 0.45)
        mx, my = (ax_ + bx_) / 2, (ay_ + by_) / 2
        for i in range(-12, 11):                                              # the arrow's shaft, two dots wide
            for w in (0, 1):
                paint(mx + nx * i + ex * (w - 0.5), my + ny * i + ey * (w - 0.5))
        for j in range(1, 7):                                                 # its head
            for sgn in (-1, 1):
                for w in (0, 1):
                    paint(mx + nx * (10 - j - w) + ex * sgn * j, my + ny * (10 - j - w) + ey * sgn * j)
        steps = int(max(abs(bx_ - ax_), abs(by_ - ay_))) + 1
        for i in range(steps + 1):
            t = i / steps
            x, y = round(ax_ + (bx_ - ax_) * t), round(ay_ + (by_ - ay_) * t)
            base.px(x, y, rgb('#f2ead2')); base.px(x + 1, y, rgb('#b8a880')); base.px(x + 1, y + 1, shade(base.get(x + 1, y + 1), 0.3))
        base.px(round(ax_), round(ay_), rgb('#3a3a40')); base.px(round(ax_), round(ay_) - 1, rgb('#9a9aa6'))


def draw_post(mc, x, y, r):
    """A round red rubber post, lit at its top left, with its shadow."""
    rgb, shade, base = mc.rgb, mc.shade, mc.base
    for yy in range(int(y - r - 2), int(y + r + 4)):
        for xx in range(int(x - r - 2), int(x + r + 4)):
            d = math.hypot(xx + 0.5 - x, yy + 0.5 - y)
            ds = math.hypot(xx + 0.5 - x - 1.2, yy + 0.5 - y - 1.6)
            if d <= r:
                hl = math.hypot(xx + 0.5 - x + r * 0.35, yy + 0.5 - y + r * 0.4)
                col = rgb('#ffb0a0') if hl < r * 0.3 else rgb('#e8443a') if hl < r * 0.75 else rgb('#a8202a')
                if d > r - 0.8:
                    col = rgb('#4a0a10')
                base.px(xx, yy, col)
            elif ds <= r:
                base.px(xx, yy, shade(base.get(xx, yy), 0.3))


def windmill(mc, n):
    """The windmill on its hole: a red board tower on a stone footing, tapering, white trim, the arched way through at
    its foot (where the ball goes), a little window, a grey cap. Returns the canvas (its foot is the hole's mill.y, its
    middle mill.x) and where the sails' hub is on it."""
    rgb, shade, tint, Mat, Cv = mc.rgb, mc.shade, mc.tint, mc.Mat, mc.Cv
    m = HOLES[n]['windmill']
    bw = int(round(m['w'] * SC)) + 4
    tall = 46
    c = Cv(bw, tall)
    cx = bw / 2
    red = [rgb(v) for v in ('#c84a36', '#a83a2a', '#e06a50', '#7a2a1e')]
    for y in range(8, tall):
        r = tall - 1 - y                                                  # rows up from the foot
        half = bw / 2 - 1 - r * 0.16
        for x in range(bw):
            if abs(x + 0.5 - cx) > half:
                continue
            u = (x + 0.5 - cx + half) / (2 * half)
            col = red[2] if u < 0.18 else red[0] if u < 0.7 else red[1] if u < 0.9 else red[3]
            if (x - int(cx)) % 4 == 0:
                col = shade(col, 0.2)                                     # the boards
            if r < 4:
                col = [rgb('#b8b2a4'), rgb('#948e80'), rgb('#cfc9ba')][(x // 3 + r) % 3] if r > 0 else rgb('#6a665c')
            elif r == 4:
                col = rgb('#f2ece0')                                       # a white band over the footing
            c.px(x, y, col)
    # the cap: a grey shingled dome, a white rim under it
    for y in range(0, 10):
        half = (bw / 2 - 1 - (tall - 9) * 0.16) * math.sqrt(max(0, 1 - ((9 - y) / 10) ** 2)) + 1
        for x in range(bw):
            if abs(x + 0.5 - cx) <= half:
                col = rgb('#6a6e78') if x + 0.5 < cx - half * 0.3 else rgb('#4a4e58') if x + 0.5 < cx + half * 0.5 else rgb('#33363e')
                if (y + (x // 3)) % 3 == 0:
                    col = shade(col, 0.15)
                c.px(x, y, col)
    for x in range(bw):
        half = bw / 2 - 1 - (tall - 10) * 0.16
        if abs(x + 0.5 - cx) <= half + 1:
            c.px(x, 9, rgb('#f2ece0')); c.px(x, 10, rgb('#b8b2a4'))
    # the way through at the foot: an arch as wide as the door, dark inside
    dw = int(round(m['door'] * SC)) + 2
    for y in range(tall - 11, tall):
        for x in range(int(cx - dw / 2), int(cx + dw / 2) + 1):
            dy = tall - 11 + dw / 2 - y
            if dy > 0 and math.hypot(x + 0.5 - cx, dy) > dw / 2 + 0.3:
                continue
            c.px(x, y, rgb('#140c0a') if y > tall - 9 else rgb('#24140e'))
    for y in range(tall - 10, tall):
        c.px(int(cx - dw / 2) - 1, y, rgb('#f2ece0')); c.px(int(cx + dw / 2) + 1, y, rgb('#f2ece0'))
    # a window under the cap, lit warm
    wx, wy = int(cx) - 2, 12
    c.rect(wx - 1, wy - 1, wx + 4, wy + 5, rgb('#f2ece0'))
    c.rect(wx, wy, wx + 3, wy + 4, rgb('#ffe2a0'))
    c.rect(wx + 1, wy, wx + 2, wy + 4, rgb('#f2ece0')); c.rect(wx, wy + 2, wx + 3, wy + 2, rgb('#f2ece0'))
    c.hub = (int(cx), tall - 25)
    return c


def draw_number_sign(mc, put, at, n):
    """A little green board on a post: the hole's number large, and under it PAR and the par."""
    rgb, Mat, Cv = mc.rgb, mc.Mat, mc.Cv
    h = HOLES[n]
    c = Cv(17, 28)
    c.part(mc.rows(7, 18, 9, 27), Mat('#6a4a30', hi='#8a6644', lo='#4a3020'), hi='l', lo='r')
    c.part(mc.rows(0, 0, 16, 19), Mat('#1e5a32', hi='#3a8a52', lo='#123a20'), hi='t', lo='rb')
    c.rect(1, 1, 15, 1, rgb('#f2ece0'))
    write(c, 5, 3, str(n + 1), rgb('#f6f0d8'), k=2)
    write(c, 1, 14, 'PAR' + str(h['par']), rgb('#f2d260'))
    return c


def write(c, x, y, text, col, k=1):
    """The little 3 x 5 figures (the hole signs and the kiosk's prices)."""
    for ch in text:
        rows = DIGITS[ch].split()
        for r, line in enumerate(rows):
            for i, bit in enumerate(line):
                if bit == '1':
                    c.rect(x + i * k, y + r * k, x + i * k + k - 1, y + r * k + k - 1, col)
        x += (len(rows[0]) + 1) * k


def kiosk(mc):
    """The kiosk where the round starts: a little white clapboard hut with a red and white striped awning over its
    window, putters in a barrel and buckets of coloured balls on the counter, a MINI GOLF board along its roof."""
    rgb, mix, shade, tint, Mat, Cv = mc.rgb, mc.mix, mc.shade, mc.tint, mc.Mat, mc.Cv
    w, h = 76, 64
    c = Cv(w, h)
    # the roof: dark green, a ridge, seen from the front and a little above
    for y in range(12, 24):
        inset = (23 - y) // 3
        for x in range(2 + inset, w - 2 - inset):
            col = rgb('#2e6a46') if (x + y) % 5 else rgb('#24563a')
            if y == 23:
                col = rgb('#173c28')
            elif y == 12 + 0:
                col = rgb('#4a8a62')
            c.px(x, y, col)
    # the board along the roof
    c.part(mc.rows(10, 0, w - 11, 12), Mat('#f2ece0', hi='#ffffff', lo='#b8b0a0'), hi='t', lo='rb')
    c.rect(11, 1, w - 12, 1, rgb('#ffffff'))
    tw = mc.sign_width('MINI GOLF')
    mc.sign(c, w // 2 - tw // 2, 3, 'MINI GOLF', 1, rgb('#c83a2e'))
    c.rect(9, 12, 10, 14, rgb('#6a4a30')); c.rect(w - 11, 12, w - 10, 14, rgb('#6a4a30'))
    # the walls: white clapboard, lit on the left
    for y in range(24, h):
        for x in range(4, w - 4):
            col = rgb('#ece6d8') if (y - 24) % 4 else rgb('#c4bcac')
            if x < 7:
                col = tint(col, 0.1)
            elif x > w - 8:
                col = shade(col, 0.14)
            c.px(x, y, col)
    # the window and the counter
    c.rect(14, 30, w - 15, 48, rgb('#3a2a20'))
    c.rect(15, 31, w - 16, 47, rgb('#5a4030'))
    for x in range(16, w - 16):                                          # inside: the shelves behind, in shadow
        c.px(x, 36, rgb('#7a5a40')); c.px(x, 42, rgb('#7a5a40'))
    for k, col in enumerate(('#ff5a4a', '#4aa8ff', '#ffd23a', '#6ad06a', '#e070e0', '#ffffff')):
        c.rect(18 + k * 7, 33, 19 + k * 7, 35, rgb(col))                  # balls on the top shelf
        c.rect(19 + k * 7, 39, 20 + k * 7, 41, rgb(('#e8e2d0', '#c8c0b0')[k % 2]))   # scorecards
    c.part(mc.rows(12, 48, w - 13, 51), Mat('#a8703e', hi='#d6a46a', lo='#6e4424'), hi='t', lo='rb')
    # a bucket of balls and a pencil cup on the counter
    c.part(mc.rows(20, 44, 27, 48), Mat('#c8c8d0', hi='#ececf2', lo='#8a8a96'), hi='l', lo='r')
    for k, col in enumerate(('#ff5a4a', '#ffd23a', '#4aa8ff', '#6ad06a')):
        c.px(21 + k * 2, 43, rgb(col)); c.px(22 + k * 2, 44 - k % 2, rgb(col))
    c.rect(w - 26, 45, w - 23, 48, rgb('#3a7a5a')); c.px(w - 25, 43, rgb('#f2d260')); c.px(w - 24, 42, rgb('#f2d260'))
    # the awning: red and white stripes, scalloped along its front
    for y in range(25, 31):
        for x in range(10, w - 10):
            stripe = ((x - 10) // 5) % 2
            col = rgb('#d83a2e') if stripe else rgb('#f6f0e2')
            if y == 25:
                col = tint(col, 0.15)
            c.px(x, y, col)
    for x in range(10, w - 10):
        if (x - 10) % 5 in (1, 2, 3):
            c.px(x, 31, rgb('#d83a2e') if ((x - 10) // 5) % 2 else rgb('#f6f0e2'))
    for x in range(10, w - 10):
        c.px(x, 32 if (x - 10) % 5 in (1, 2, 3) else 31, shade(c.get(x, 33) or rgb('#3a2a20'), 0.25))
    # the putters in a barrel by the door (left)
    c.part(mc.rows(0, h - 14, 8, h - 1), Mat('#8a5a32', hi='#b07a46', lo='#5a3a20'), hi='l', lo='r')
    c.rect(0, h - 11, 8, h - 11, rgb('#3a3a40')); c.rect(0, h - 5, 8, h - 5, rgb('#3a3a40'))
    for k in range(4):
        x = 1 + k * 2
        c.rect(x, h - 26 + (k % 2) * 2, x, h - 14, rgb('#b8bcc6'))
        c.rect(x, h - 27 + (k % 2) * 2, x, h - 24 + (k % 2) * 2, rgb(('#2a2a30', '#c83a2e', '#2a2a30', '#3a6aa8')[k]))
    return c



# ───────────────────────── a whole scene ─────────────────────────

def _load(name):
    import importlib.util as iu
    s = iu.spec_from_file_location(name, os.path.join(HERE, '_%s.py' % name))
    m = iu.module_from_spec(s)
    s.loader.exec_module(m)
    return m


camp = _load('camp_art')
yard = _load('yard_art')
S = _load('seasons')

# the footpath through each scene (lines of points), and its way out: the first scene's down to the backyard at its
# bottom right, the others' at their right edge back to the scene before; the next scene is off the left edge
PATHS = {
    'minigolf': [[(-4, LANE), (474, LANE), (474, 340)]],
    'minigolf2': [[(-4, LANE), (532, LANE)]],
    'minigolf3': [[(532, LANE), (262, LANE)], [(404, LANE), (404, 236)]],
}
EXITS = {
    'minigolf': dict(rect=[454, 312, 42, 22], foot=dict(x=474, y=326), face='down'),
    'minigolf2': dict(rect=[504, LANE - 20, 24, 40], foot=dict(x=514, y=LANE), face='right'),
    'minigolf3': dict(rect=[504, LANE - 20, 24, 40], foot=dict(x=514, y=LANE), face='right'),
}
BACK = {
    'minigolf': dict(to='backyard', foot=dict(x=34, y=70), face='up', say='Back to the backyard'),
    'minigolf2': dict(to='minigolf', foot=dict(x=12, y=LANE), face='left', say='Back to holes 1 to 3'),
    'minigolf3': dict(to='minigolf2', foot=dict(x=12, y=LANE), face='left', say='Back to holes 4 to 6'),
}
NEXT = {'minigolf': 'minigolf2', 'minigolf2': 'minigolf3'}


def scene(mc, L, sid):
    rgb, mix, shade, tint, Mat, Cv, base = mc.rgb, mc.mix, mc.shade, mc.tint, mc.Mat, mc.Cv, mc.base
    W, H, hsh, noise = mc.W, mc.H, mc.hsh, mc.noise
    L['outdoors'] = True
    L['view'] = [0, 0, W, H]
    camp.setup(mc)
    yard.setup(mc)
    S.begin(mc)
    snowy = S.season(mc) == 'snow'
    here = [n for n in range(9) if PLACE[n][0] == sid]

    def put(draw, over=None, shadow=False, fine=None, snow=True):
        t = Cv(W, H)
        draw(t)
        a = mc.outline(np.pad(t.a, ((1, 1), (1, 1), (0, 0))))[1:-1, 1:-1]
        if snowy and snow:
            a = S.snow(mc, a)
        if fine:
            fine(a)
        m = a[..., 3] > 0
        if not m.any():
            if over is not None:                                           # (bare in winter: an empty piece, so every
                mc.occluders.append((np.zeros((1, 1, 4), np.uint8), dict(x=0, y=0, w=1, h=1, z=over)))   # season has the same ones)
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
        return lambda c: c.paste(cv, int(x - cv.w // 2), int(y - cv.h + 1))

    def shadow(cx, cy, rx, ry, k=0.32, seed=1):
        for y in range(int(cy - ry), int(cy + ry) + 1):
            for x in range(int(cx - rx), int(cx + rx) + 1):
                d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 + noise(x, y, 9, seed) * 0.25
                if d <= 1 and (d < 0.74 or (x + y) % 2 == 0) and 0 <= x < W and 0 <= y < H and base.get(x, y):
                    base.px(x, y, mix(base.get(x, y), (14, 34, 30), k))

    def stand(cv, x, y, over=None, sh=True, block=True):
        if sh:
            shadow(x + 2, y + 1, cv.w * 0.45, 2.2, 0.3, seed=x + y)
        put(at(cv, x, y), over=y if over is None else over)
        if block:
            mc.block(x - cv.w // 2 + 1, y - 3, x + cv.w // 2 - 1, y)

    def plant(kind, x, y, var, over=None):
        t, sh, fine = S.tree(mc, kind, var)
        put(at(t, x, y), over=y if over is None else over, fine=fine and (lambda a: S.lay(mc, a, fine, x - t.w // 2, y - t.h + 1)))

    # ── the ground: grass, darker under the trees at the top ──
    tile = mc.grass_tile()
    G = mc.GREENS
    for y in range(H):
        for x in range(W):
            i = tile[y % 32][x % 32]
            col = G[max(0, i - 1)] if noise(x, y, 30, 3) > 0.42 or y < 46 else G[i]
            if y < 50:
                col = shade(col, 0.18 * (50 - y) / 50)
            base.px(x, y, col)
    # ── the footpath: warm brick pavers in a running bond, edged in darker brick ──
    bricks = [rgb(c) for c in ('#b8806a', '#c8907a', '#a8705a', '#d0a088', '#9a6450')]
    on_path = np.zeros((H, W), bool)
    for line in PATHS[sid]:
        for (ax, ay), (bx, by) in zip(line, line[1:]):
            for y in range(max(0, int(min(ay, by)) - 12), min(H, int(max(ay, by)) + 12)):
                for x in range(max(0, int(min(ax, bx)) - 12), min(W, int(max(ax, bx)) + 12)):
                    if seg_d((x + 0.5, y + 0.5), (ax, ay), (bx, by)) < 8 + noise(x, y, 7, 15) * 0.8:
                        on_path[y, x] = True

    def paver(x, y, seed=920):
        row = y // 4
        bx_, by_ = (x + (4 if row % 2 else 0)) % 8, y % 4
        if bx_ == 0 or by_ == 0:
            return rgb('#8a6a5a')
        col = bricks[hsh((x + (4 if row % 2 else 0)) // 8, row, seed) % 5]
        return tint(col, 0.08) if by_ == 1 else col
    for y in range(H):
        for x in range(W):
            if not on_path[y, x]:
                continue
            edge = not (on_path[max(0, y - 1), x] and on_path[min(H - 1, y + 1), x] and on_path[y, max(0, x - 1)] and on_path[y, min(W - 1, x + 1)])
            base.px(x, y, rgb('#6a4232') if edge else paver(x, y))
    grass = set(G)
    S.litter(mc, base, lambda x, y: base.get(x, y) in grass, seed=sum(map(ord, sid)))

    # ── what each scene has of its own, on the ground (under the holes' signs and the people) ──
    if sid == 'minigolf3':
        fcx, fcy = 404, 270
        for y in range(fcy - 46, fcy + 50):
            for x in range(fcx - 92, fcx + 92):
                d = ((x - fcx) / 88) ** 2 + ((y - fcy) / 46) ** 2
                if d < 1:
                    base.px(x, y, rgb('#6a4232') if d > 0.93 else paver(x, y, 921))

    # ── the holes ──
    for n in here:
        draw_hole(mc, n, sid)
        h = HOLES[n]
        xs = [p[0] for p in h['fairway']]
        sx, sy = int(X(n, min(xs))) - 12, int(Y(n, h['tee'][1])) + 10
        stand(draw_number_sign(mc, put, at, n), sx, sy)
    mill = None
    for n in here:
        m = HOLES[n].get('windmill')
        if not m:
            continue
        cv = windmill(mc, n)
        fx, fy = round(X(n, m['x'])), round(Y(n, m['y']))
        put(at(cv, fx, fy), over=fy)
        mc.block(int(X(n, m['x'] - m['w'] / 2)), int(Y(n, m['y'] - m['d'])), int(X(n, m['x'] + m['w'] / 2)), fy)
        mill = dict(n=n, hub=[fx - cv.w // 2 + cv.hub[0], fy - cv.h + 1 + cv.hub[1]], len=24, z=fy)

    # ── the woods along the top, hedges down the sides (open where the path goes through), bushes along the bottom ──
    kinds = ('oak', 'maple', 'pine', 'birch', 'oak', 'dogwood', 'maple', 'pine')
    for k, x in enumerate(range(-14, W + 30, 40)):
        plant(kinds[(k + len(sid)) % 8], x + hsh(k, 1, 930 + len(sid)) % 16, 30 + hsh(k, 2, 930) % 10, k + 500 + 20 * len(sid))
    for k, x in enumerate(range(6, W, 22)):
        bu = camp.bush(r=9 + hsh(k, 3, 931) % 4, seed=k + 40, dark=0.15, evergreen=k % 3 == 0)
        put(at(bu, x + hsh(k, 4, 931) % 8, 50), over=50)
    mc.block(0, 0, W - 1, 50)
    left_open = sid in NEXT
    right_open = sid != 'minigolf'
    for side, open_ in ((0, left_open), (1, right_open)):
        for k, y in enumerate(range(58, H + 12, 16)):
            if open_ and abs(y - LANE) < 24:
                continue
            x = 2 + hsh(k, 5, 932 + side) % 4 if side == 0 else W - 3 - hsh(k, 5, 932 + side) % 4
            bu = camp.bush(r=8 + hsh(k, 6, 933) % 3, seed=k * 3 + side + 70, dark=0.1, evergreen=True)
            put(at(bu, x, y), over=y)
        x0 = 0 if side == 0 else W - 9
        if open_:
            mc.block(x0, 50, x0 + 8, LANE - 22); mc.block(x0, LANE + 22, x0 + 8, H - 1)
        else:
            mc.block(x0, 50, x0 + 8, H - 1)
    for k, x in enumerate(range(16, W - 10, 26)):
        if sid == 'minigolf' and 444 < x < 504:
            continue
        bu = camp.bush(r=8 + hsh(k, 7, 934) % 4, seed=k * 5 + 90, dark=0.05)
        put(at(bu, x + hsh(k, 8, 934) % 8, H + 4), over=H + 4)
    if sid == 'minigolf':
        mc.block(0, H - 4, 450, H - 1); mc.block(500, H - 4, W - 1, H - 1)
    else:
        mc.block(0, H - 4, W - 1, H - 1)

    # ── lamp posts along the path, lit at night ──
    def lamp(c, x, y):
        post = Mat('#2a2a30', hi='#4a4a56', lo='#141418')
        c.part(mc.rows(x - 1, y - 30, x, y), post, hi='l', lo='r')
        c.rect(x - 2, y - 2, x + 1, y, rgb('#1e1e24'))
        c.rect(x - 3, y - 39, x + 2, y - 31, rgb('#1a1a20'))
        c.rect(x - 2, y - 38, x + 1, y - 32, rgb('#ffe2a0'))
        c.rect(x - 1, y - 37, x, y - 33, rgb('#fff6d8'))
        c.rect(x - 4, y - 41, x + 3, y - 40, rgb('#2a2a30')); c.px(x - 1, y - 42, rgb('#2a2a30')); c.px(x, y - 42, rgb('#2a2a30'))
    lamps = {'minigolf': [(270, LANE + 18), (448, LANE + 18)],
             'minigolf2': [(270, LANE + 18), (500, LANE + 18)],
             'minigolf3': [(270, LANE + 18), (386, 230)]}[sid]
    for x, y in lamps:
        shadow(x + 2, y + 1, 4, 1.4, 0.3, seed=x)
        put(lambda c, x=x, y=y: lamp(c, x, y), over=y)
        mc.block(x - 2, y - 2, x + 2, y)
        mc.light(x, y - 34, 40, 30, '#ffcf80', 0.24)

    # ── gardens in the open grass, clear of the holes, the paths and where people stand ──
    keep_out = [(x0, y0, x1, y1) for x0, y0, x1, y1 in mc.blocked]
    keep_out += [(0, 0, W, 66), (0, LANE - 30, W, LANE + 30), (0, H - 20, W, H), (0, 0, 24, H), (W - 24, 0, W, H)]
    keep_out += {'minigolf': [(280, 180, 520, H)], 'minigolf2': [(270, 196, 520, H)], 'minigolf3': [(270, 196, 520, H)]}[sid]
    shapes = [[(X(n, q[0]), Y(n, q[1])) for q in HOLES[n]['fairway']] for n in here]
    placed = []

    def clear(x, y, r):
        if any(x0 - r <= x <= x1 + r and y0 - r <= y <= y1 + r for x0, y0, x1, y1 in keep_out):
            return False
        if any(on_path[max(0, min(H - 1, y + dy)), max(0, min(W - 1, x + dx))] for dy in (-r, 0, r) for dx in (-r, 0, r)):
            return False
        if any(inside((x, y), sh) or poly_d((x, y), sh) < r + 4 for sh in shapes):
            return False
        return all(math.hypot(x - px_, y - py_) >= 24 for px_, py_ in placed)
    for gy in range(70, H - 20, 18):
        for gx in range(28, W - 24, 18):
            x, y = gx + hsh(gx, gy, 950) % 9 - 4, gy + hsh(gx, gy, 951) % 7 - 3
            roll = hsh(gx, gy, 952 + len(sid)) % 100
            big = roll < 18 and clear(x, y, 20)
            if not big and not clear(x, y, 12):
                continue
            placed.append((x, y))
            if big:
                plant(('maple', 'dogwood', 'birch', 'oak')[hsh(x, y, 953) % 4], x, y, x + y)
                mc.block(x - 4, y - 3, x + 4, y)
            elif roll < 62:
                hy = yard.hydrangea(seed=x + y, colour=('#7a8ae8', '#f0a0c0', '#f2efe6', '#b8a0f0')[hsh(x, y, 954) % 4])
                put(at(hy, x, y), over=y)
                mc.block(x - 8, y - 3, x + 8, y)
            else:
                bu = camp.bush(r=8 + hsh(x, y, 955) % 3, seed=x * 7 + y, dark=0.05)
                put(at(bu, x, y), over=y)
                mc.block(x - 7, y - 3, x + 7, y)

    L['things']['golf'] = dict(sc=SC, holes=[dict(n=n, ox=PLACE[n][1], oy=PLACE[n][2]) for n in here], mill=mill)
    L['things']['back'] = BACK[sid]
    if sid in NEXT:
        L['things']['next'] = dict(to=NEXT[sid], rect=[0, LANE - 22, 22, 44], say='On to holes %d to %d' % (here[-1] + 2, here[-1] + 4))

    def chair(cx, cy):
        put(at(camp.adirondack('front'), cx, cy + 1), shadow=True)
        mc.block(cx - 12, cy - 22, cx + 12, cy - 4)
        L['seats'].append(dict(x=cx, y=cy, ax=cx, ay=cy + 8, pose='front', flip=False, hit=[cx - 14, cy - 38, 28, 40]))

    def beds(x0, y0, x1, seeds):
        for k, x in enumerate(range(x0, x1, 26)):
            hy = yard.hydrangea(seed=seeds + k, colour=('#7a8ae8', '#f0a0c0', '#f2efe6', '#b8a0f0')[(k + seeds) % 4])
            put(at(hy, x, y0), over=y0)

    if sid == 'minigolf':
        kc = kiosk(mc)
        kx, ky = 340, 268
        shadow(kx + 3, ky + 1, 40, 3, 0.34, seed=9)
        put(at(kc, kx, ky), over=ky)
        mc.block(kx - 37, ky - 30, kx + 37, ky)
        L['things']['golf']['booth'] = [kx - kc.w // 2, ky - kc.h + 1, kc.w, kc.h]
        L['things']['golf']['lobby'] = [[300, 288], [326, 292], [352, 292], [378, 288], [404, 280], [430, 276]]
        chair(404, 316); chair(430, 316)
        beds(296, 322, 380, 3)
    elif sid == 'minigolf2':
        # a pond: dark water under lily pads, stones round it, reeds along its far side
        pcx, pcy, prx, pry = 404, 268, 84, 38
        for y in range(pcy - pry - 3, pcy + pry + 4):
            for x in range(pcx - prx - 3, pcx + prx + 4):
                d = ((x - pcx) / prx) ** 2 + ((y - pcy) / pry) ** 2 + noise(x, y, 14, 21) * 0.12
                if d < 1:
                    t = min(1, (1 - d) * 2.5)
                    col = mix(rgb('#4a8c8a'), rgb('#1f4a6a'), t)
                    if (y * 7 + (x // 5) * 3) % 11 == 0 and hsh(x // 5, y, 940) % 4 == 0:
                        col = tint(col, 0.2)
                    base.px(x, y, col)
                elif d < 1.14:
                    base.px(x, y, [rgb('#8a8678'), rgb('#a8a494'), rgb('#6a665a')][hsh(x // 3, y // 2, 941) % 3])
        for k, (lx, ly) in enumerate(((360, 262), (372, 274), (440, 256), (452, 282), (420, 290), (346, 280))):
            for y in range(ly - 2, ly + 3):
                for x in range(lx - 4, lx + 5):
                    if ((x - lx) / 4.5) ** 2 + ((y - ly) / 2.4) ** 2 < 1 and not (x > lx and abs(y - ly) < 1):
                        base.px(x, y, rgb('#4a9a44') if y < ly else rgb('#2e7a34'))
            if k % 2 == 0:
                base.px(lx - 1, ly - 1, rgb('#f6e0f0')); base.px(lx, ly - 2, rgb('#f0a0c8')); base.px(lx + 1, ly - 1, rgb('#f6e0f0'))
        mc.block(pcx - prx, pcy - pry + 4, pcx + prx, pcy + pry)
        for k, x in enumerate(range(pcx - prx + 10, pcx + prx - 8, 9)):
            if 380 < x < 430:
                continue
            tu = camp.grass_tuft(seed=k + 7, tall=12, dark=0.1)
            yy = pcy - round(pry * math.sqrt(max(0, 1 - ((x - pcx) / prx) ** 2))) + 3
            put(at(tu, x, yy), over=yy)
        L['things']['golf']['pond'] = [pcx, pcy, prx, pry]
        chair(296, 232); chair(324, 232)
        beds(300, 324, 520, 11)
    else:
        rx, ry = 36, 16
        for y in range(fcy - ry - 2, fcy + ry + 6):
            for x in range(fcx - rx - 2, fcx + rx + 3):
                d = ((x - fcx) / rx) ** 2 + ((y - fcy) / ry) ** 2
                if d < 0.72:
                    col = mix(rgb('#6ac0dc'), rgb('#2e7cb0'), min(1, (0.72 - d) * 2))
                    if (y * 5 + (x // 4) * 3) % 9 == 0 and hsh(x // 4, y, 943) % 3 == 0:
                        col = tint(col, 0.3)
                    base.px(x, y, col)
                elif d < 1:
                    base.px(x, y, rgb('#e2ddd0') if y < fcy - ry * 0.5 else rgb('#c4beb0') if y < fcy + ry * 0.6 else rgb('#9a9486'))
                elif d < 1.3 and y > fcy:
                    base.px(x, y, rgb('#8a8478') if d < 1.16 else shade(base.get(x, y), 0.3))

        def pillar(c):
            c.part(mc.rows(fcx - 3, fcy - 26, fcx + 3, fcy), Mat('#d8d2c4', hi='#f2ece0', lo='#9a9486'), hi='l', lo='r')
            c.part(mc.ellipse(fcx, fcy - 27, 9, 3), Mat('#e2ddd0', hi='#ffffff', lo='#a8a294'), hi='t', lo='b')
            c.rect(fcx - 7, fcy - 28, fcx + 7, fcy - 27, rgb('#6ac0dc'))
            c.part(mc.ellipse(fcx, fcy - 32, 2, 3), Mat('#d8d2c4', hi='#f2ece0', lo='#9a9486'), hi='l', lo='r')
        put(pillar, over=fcy)
        mc.block(fcx - rx, fcy - ry, fcx + rx, fcy + ry)
        L['things']['golf']['fountain'] = [fcx, fcy - 34, fcy - 27, rx, ry]
        chair(300, 232); chair(328, 232)
        beds(292, 324, 360, 17); beds(456, 324, 520, 23)
    # stands along the path for anybody about
    L['stands'] += [dict(x=x, y=LANE, face='down') for x in (60, 120, 180, 330, 390)]
