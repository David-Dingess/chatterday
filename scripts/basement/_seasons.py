"""The seasons out of doors, for the outdoor fit-outs (backyard.py, outside.py, lake.py) and their kits (a file starting
with _ is not a fit-out: the basement script skips it).

Each of those scenes is drawn once a season, as the yard round the house is (yard_art in scripts/make-clubhouse.py):
scripts/make-basement.py sets mc.SEASON before each drawing and writes base-<season>.png and over-<season>.png beside the
summer pair (base.png, over.png). The page picks the set for the date (client/src/season.tsx sceneArt):

    summer  June to August           as the scenes were first drawn
    spring  March to May             the yard's spring colours: fresh greens, the dogwoods in pink and white flower
    fall    September to November    the yard's fall colours: oaks brown, maples red and orange, birches yellow; the lawn
                                     tired and browner, leaves lying on it; ferns and long grass turning
    winter  December to February     the deciduous trees bare (an oak keeping a few brown leaves), the lawn dormant
                                     straw, ferns and long grass dead; the pines, the boxwoods and the like stay green
    snow    while it is snowing      winter under snow: white ground, snow along the top of everything

Nothing that can be walked into, sat on or clicked moves from one season to the next: the layout written to the
fit-out's .gen.ts is the summer one, and make-basement.py checks every other season's matches it. A tree's bare
branches stay inside the shape of its summer head, so the pieces drawn in front of people keep their places too.

    import: spec_from_file_location on this file. Everything here takes mc (scripts/make-clubhouse.py) and reads the
    season from it."""
import math

import numpy as np

DECIDUOUS = ('oak', 'maple', 'birch', 'dogwood')


def season(mc):
    return getattr(mc, 'SEASON', 'summer')


def cold(mc):
    """Winter, with or without snow."""
    return season(mc) in ('winter', 'snow')


# the lawn and the grass in each season: GREENS (darkest to lightest), DRY (the parched patches), and the long grass of
# the backyard's lawn, longer and darker than the rest
LAWN = dict(
    winter=dict(greens=('#8a7f50', '#968a58', '#a29462', '#ae9e6a', '#bcac78'), dry='#c4b07e',
                tall=('#76693f', '#807246', '#8a7c4e', '#958656', '#a2925e')),
    snow=dict(greens=('#b9c8dc', '#d2deec', '#e6eef7', '#f4f8fc', '#ffffff'), dry='#d6e0ee',
              tall=('#a8b8cc', '#c4d2e2', '#dce6f2', '#eef3fa', '#ffffff')),
)
TALL = dict(summer=('#245e2a', '#2d6a34', '#347a37', '#3f8a3c', '#4f9e47'),
            spring=('#26683a', '#2f7a3a', '#3c8e40', '#4fa64c', '#62bc58'),
            fall=('#46592a', '#566e2e', '#687e34', '#7e903c', '#94a246'))


def begin(mc):
    """Puts the season's colours in place (mc.GREENS, mc.DRY, mc.LEAF) before a scene is drawn. Spring and fall are the
    yard's own (mc.SEASONS); winter is dormant, not the yard's snow-laden look."""
    s = season(mc)
    mc.set_season('summer')                               # (the first call notes summer's colours; then back to them)
    if s in ('spring', 'fall'):
        mc.set_season(s)
    if s == 'spring':                                     # (out in the woods the pinks are dimmed with the rest: a deeper pink holds up)
        mc.LEAF['dog'] = [mc.rgb(c) for c in ('#a83a64', '#cc5a86', '#e888ac', '#f6b4cc', '#ffe0ec')]
    elif s in LAWN:
        mc.GREENS[:] = [mc.rgb(c) for c in LAWN[s]['greens']]
        mc.DRY = mc.rgb(LAWN[s]['dry'])


def end(mc):
    mc.set_season('summer')


def tall_grass(mc):
    s = season(mc)
    return [mc.rgb(c) for c in (LAWN[s]['tall'] if s in LAWN else TALL.get(s, TALL['summer']))]


# ── turning green things the season's colour ──

def _hsv(a):
    rgb = a[..., :3].astype(np.float32) / 255
    mx, mn = rgb.max(-1), rgb.min(-1)
    d = mx - mn
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    h = np.zeros_like(mx)
    nz = d > 1e-6
    rm = nz & (mx == r)
    gm = nz & (mx == g) & ~rm
    bm = nz & ~rm & ~gm
    h[rm] = ((g - b)[rm] / d[rm]) % 6
    h[gm] = (b - r)[gm] / d[gm] + 2
    h[bm] = (r - g)[bm] / d[bm] + 4
    h *= 60
    s = np.where(mx > 0, d / np.maximum(mx, 1e-6), 0)
    return h, s, mx


def _rgb(h, s, v):
    h = (h % 360) / 60
    i = np.floor(h).astype(int) % 6
    f = h - np.floor(h)
    p, q, t = v * (1 - s), v * (1 - s * f), v * (1 - s * (1 - f))
    out = np.stack([np.choose(i, [v, q, p, p, t, v]), np.choose(i, [t, v, v, q, p, p]), np.choose(i, [p, p, t, v, v, q])], -1)
    return np.clip(out * 255 + 0.5, 0, 255).astype(np.uint8)


def turn(a, to_hue, sat=0.8, val=1.0, k=1.0, seed=0):
    """Turns the green dots of a picture (an RGBA array, changed in place) toward another hue: k of the way (1: all of
    them; less: a dot here and there stays green, picked by its place, so a fern is green going gold)."""
    h, s, v = _hsv(a)
    green = (a[..., 3] > 0) & (h > 60) & (h < 175) & (s > 0.18)
    if k < 1:
        ys, xs = np.mgrid[0:a.shape[0], 0:a.shape[1]]
        green &= ((xs * 7 + ys * 13 + seed * 5) % 17) / 17 < k
    nh = np.full_like(h, to_hue)
    a[green, :3] = _rgb(nh[green], np.clip(s[green] * sat, 0, 1), np.clip(v[green] * val, 0, 1))
    return a


def wither(mc, c, seed=0, kind='plant'):
    """A fern, a tuft of long grass, a reed bed, undergrowth: as it is in the season (the canvas, changed in place).
    Summer and spring: as drawn. Fall: going gold and bronze. Winter: dead, straw and brown."""
    s = season(mc)
    if s == 'fall':
        if kind == 'bush':                                 # (sumac red or gold, bush by bush)
            turn(c.a, (8, 34, 18)[seed % 3], 1.25, 1.12, 0.9, seed)
        else:
            turn(c.a, 38, 0.95, 0.98, 0.75, seed)
    elif s in ('winter', 'snow'):
        if kind == 'bush':                                 # (scrub holding its dead leaves: russet, not grey)
            turn(c.a, 24, 0.8, 0.82, 1.0, seed)
        else:
            turn(c.a, 34, 0.45, 0.88, 1.0, seed)
    return c


# ── trees ──

# where each kind's trunk is in mc.tree's canvas: the middle of the trunk (x), where the head sits (y), its foot, how
# wide, and how big its head is (half across, half down)
TRUNKS = dict(oak=(74, 62, 125, 12, 60, 46), maple=(48, 38, 91, 8, 42, 34), birch=(30, 30, 95, 5, 24, 34), dogwood=(30, 22, 61, 4, 26, 20))


def tree(mc, kind, var=0):
    """A tree as it is in the season: (canvas, shadow size, fine), where fine is None or a canvas of twigs (and an oak's
    last leaves) to lay over it after its outline is on, so they stay fine. The canvas is the same size as mc.tree's
    and the trunk's foot in the same place, so the tree stands exactly where its summer self stands."""
    s = season(mc)
    c, sh = mc.tree(kind, var)
    if kind == 'dogwood' and s == 'fall':                 # its flowers long gone: red berries among the red leaves
        a = c.a
        white = (a[..., 3] > 0) & (a[..., 0] == 253) & (a[..., 1] == 251) & (a[..., 2] == 244)
        eye = (a[..., 3] > 0) & (a[..., 0] == 242) & (a[..., 1] == 210) & (a[..., 2] == 74)
        a[white, :3] = mc.LEAF['dog'][3]
        a[eye, :3] = (200, 30, 40)
    if s not in ('winter', 'snow') or kind not in DECIDUOUS:
        return c, sh, None
    bare_, fine = bare(mc, kind, var, c)
    return bare_, sh, fine


def bare(mc, kind, var, full):
    """The tree with its leaves down: the trunk carried on up into the head, limbs forking out from it and forking
    again, down to twigs, and a haze of the finest twigs over the whole head, all inside the shape its head has in
    summer. Returns the limbs (to be outlined) and the twigs (laid on after, so they stay fine)."""
    rgb, hsh = mc.rgb, mc.hsh
    cx, cy, foot, tw, rx, ry = TRUNKS[kind]
    head = full.a[..., 3] > 0
    c, fine = mc.Cv(full.w, full.h), mc.Cv(full.w, full.h)
    birch = kind == 'birch'
    bark = mc.BIRCH_BARK if birch else mc.BARK
    twig = rgb('#4a3a34') if not birch else rgb('#5a3a30')
    twig2 = rgb('#6e5a4c') if not birch else rgb('#7a5444')
    top = int(cy + ry * 0.15)
    mc.trunk(c, cx, top, foot, tw, bark, marks=birch)
    seed = var * 31 + len(kind)
    tips = []

    def inside(x, y):
        xi, yi = int(round(x)), int(round(y))
        return 0 <= xi < c.w and 0 <= yi < c.h and head[yi, xi]

    def paint(x, y, wd, i):
        xi, yi = int(round(x)), int(round(y))
        if wd >= 1.6:                                            # a limb: on the canvas that gets the outline
            n = int(round(wd))
            for dx in range(n):
                col = bark[2] if dx == 0 and n > 1 else bark[0] if dx == n - 1 and n > 2 else bark[1]
                c.px(xi - n // 2 + dx, yi, col)
        else:                                                    # a twig: fine, no outline
            fine.px(xi, yi, twig if i % 3 else twig2)

    def grow(x, y, ang, length, width, depth, k):
        bend = ((hsh(k, depth, seed) % 7) - 3) * 0.01
        for i in range(max(1, int(length))):
            ang = min(-0.2, max(-math.pi + 0.2, ang + bend))
            nx, ny = x + math.cos(ang), y + math.sin(ang)
            if not inside(nx, ny):
                tips.append((x, y, ang))
                return
            x, y = nx, ny
            paint(x, y, width * (1 - 0.25 * i / max(1, length)), i + k)
        if depth == 0 or width < 0.6:
            tips.append((x, y, ang))
            return
        n = 3 if hsh(depth, k, seed + 1) % 3 == 0 else 2
        spread = 0.42 + (hsh(depth, k, seed + 2) % 5) * 0.05
        for j in range(n):
            a = ang + spread * (j - (n - 1) / 2) + ((hsh(j, k, seed + 3) % 7) - 3) * 0.04
            grow(x, y, a, length * (0.66 + (hsh(j, k, seed + 4) % 5) * 0.03), width * 0.66, depth - 1, k * 4 + j + 1)

    reach = (rx + ry) * 0.5
    mains = dict(oak=5, maple=4, birch=5, dogwood=4)[kind]
    fan = dict(oak=2.3, maple=2.0, birch=1.7, dogwood=2.2)[kind]
    for j in range(mains):
        u = j / (mains - 1) - 0.5
        ang = -math.pi / 2 + u * fan + ((hsh(j, 1, seed) % 5) - 2) * 0.05
        grow(cx + u * tw * 0.5, top + 1, ang, reach * 0.36, max(1.7, tw * 0.42), 5, j + 1)
    # the haze of the finest twigs all over the head: short strokes, pointing out from the middle
    for y in range(c.h):
        for x in range(c.w):
            if not head[y, x] or y > top or hsh(x, y, seed + 9) % 100 >= 9 or c.get(x, y):
                continue
            dx, dy = x - cx, y - cy
            d = math.hypot(dx, dy) or 1
            fine.px(x, y, twig2 if hsh(x, y, seed + 10) & 1 else twig)
            ox, oy = x + round(dx / d), y + round(dy / d)
            if 0 <= ox < c.w and 0 <= oy < c.h and head[oy, ox]:
                fine.px(ox, oy, twig2)
    if kind == 'oak' and season(mc) == 'winter':                 # an oak holds on to some of its dead leaves all winter
        dead = [rgb('#8a5a2a'), rgb('#a87038'), rgb('#6a4220')]
        for k, (x, y, ang) in enumerate(tips):
            if hsh(k, 5, seed) % 3:
                continue
            xi, yi = int(round(x)), int(round(y))
            fine.px(xi, yi, dead[k % 3]); fine.px(xi + 1, yi, dead[(k + 1) % 3]); fine.px(xi, yi + 1, dead[2])
    return c, fine


def snow(mc, a):
    """Snow along the tops of a scene-sized picture (mc.snow_on), but not along the scene's own top edge, where what
    runs off it is cut, not topped."""
    top = a[0].copy()
    a = mc.snow_on(a)
    a[0] = top
    return a


def lay(mc, a, fine, ox, oy):
    """Lays a tree's fine twigs (a canvas, its top-left corner at ox, oy) over an outlined scene-sized picture `a`."""
    if fine is None:
        return
    fa = fine.a
    h, w = fa.shape[:2]
    H, W = a.shape[:2]
    x0, y0 = max(0, ox), max(0, oy)
    x1, y1 = min(W, ox + w), min(H, oy + h)
    if x0 >= x1 or y0 >= y1:
        return
    part = fa[y0 - oy:y1 - oy, x0 - ox:x1 - ox]
    m = part[..., 3] > 0
    a[y0:y1, x0:x1][m] = part[m]


# ── what lies on the ground ──

def litter(mc, base, ok, seed=0):
    """Leaves lying on the grass in the fall (and a few brown ones in winter), petals in the spring: on the dots `ok`
    (x, y) says are grass."""
    s = season(mc)
    rgb, hsh, noise = mc.rgb, mc.hsh, mc.noise
    if s == 'fall':
        cols, thin, thick = [rgb(c) for c in ('#c8461c', '#e26a24', '#f29a3a', '#eac83a', '#9c5a1e', '#a02c18')], 0.012, 0.07
    elif s == 'winter':
        cols, thin, thick = [rgb(c) for c in ('#7a5a36', '#8a6a42', '#5f4630')], 0.004, 0.02
    elif s == 'spring':
        cols, thin, thick = [rgb(c) for c in ('#ff9ac2', '#fdfbf4', '#f6d21c', '#b48ae6')], 0.003, 0.01
    else:
        return
    H, W = base.a.shape[:2]
    for y in range(H):
        for x in range(W):
            h = hsh(x, y, 61 + seed)
            much = thick if noise(x, y, 26, 62 + seed) > 0.3 else thin
            if h / 65535 < much and ok(x, y):
                col = cols[(h >> 4) % len(cols)]
                base.px(x, y, col)
                if s == 'fall' and h & 1 and ok(x + 1, y):
                    base.px(x + 1, y, mc.mix(col, (40, 20, 10), 0.25))
