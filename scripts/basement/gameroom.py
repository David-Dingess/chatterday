"""The game room: the basement as a bar with games in it. Walnut wainscot and deep green walls, a burgundy carpet with a
gold lattice. Along the back wall a dartboard in its cabinet, a rack of cues, a jukebox, and the bar (shelves of bottles
under a neon sign, a counter, nine stools); the darts have a rubber throwing mat of their own from the wall to the oche.
Below the bar a pool table under its lamp, and a sofa and two armchairs round a low table; in the bottom left a six-seat
poker table, and in the middle at the bottom a shuffleboard table, each with clear floor round it. The whole right side
is a bowling lane: the pinsetter's housing on the back wall, the lane, the approach, the ball return, a scorer's console
and the bowlers' bench. (Mini golf's green is out for now: client/src/basement/minigolf.tsx is kept, but not shown.)

Drawn to the people's scale, about 8 dots to a foot (the stairs are 30 dots, about four feet): the pool table is 8 feet by
4 and a half, the shuffleboard 11 feet by 20 inches (half its old length), the lane 42 inches between its gutters (its length is shortened).

The games: pool and darts are client/src/basement/gameroom.tsx and server/basement/gameroom.ts; shuffleboard, bowling,
mini golf and Texas hold'em have modules of their own (shuffle, bowling, minigolf, holdem), drawn in this room. `things` says where everything is."""
import math

TITLE = 'Game room'
BLURB = 'A bar: pool, darts, poker, shuffleboard, bowling'
ORDER = 10

FELT = (111, 185, 56, 28)           # the pool table's playing surface: x, y, width, height (2:1)
BOARD = (74, 52, 6)                 # the dartboard: centre x, y and radius, on the back wall
SHUFFLE = (246, 272, 88, 14)        # the shuffleboard's top: x, y, length, width
LANE = dict(x0=466, x1=494, top=112, foul=262, gutter=6)        # the bowling lane: its edges, the end of the pin deck, the foul line
STAIRS = (6, 154, 42, 225)
RUG, RUG_Y = (145, 89), 158         # the pool table's rug and the lounge's: the same size, their tops on the same row
POKER = (76, 264, 132, 284)         # the poker table, rail to rail: x0, y0, x1, y1 (about 7 feet by 2 and a half), bottom left, clear of the stairs' foot


def box3(mc, c, x0, top, x1, bot, depth, top_mat, front_mat, anchor=None):
    """A box seen from above and in front: its top, then its front face down to the floor, the edge between them lit and
    a line of shade under it."""
    c.part(mc.rows(x0, top, x1, top + depth - 1), top_mat, hi='tl', lo='r', anchor=anchor)
    c.part(mc.rows(x0, top + depth, x1, bot), front_mat, hi='l', lo='rb', anchor=anchor)
    c.rect(x0 + 1, top + depth - 1, x1 - 1, top + depth - 1, top_mat.hi)
    c.rect(x0 + 1, top + depth, x1 - 1, top + depth, front_mat.lo)


def ball(mc, c, cx, cy, r, col):
    """A shiny ball: lit from the top left, a white glint, shade round its lower right."""
    rgb, mix, shade, tint = mc.rgb, mc.mix, mc.shade, mc.tint
    col = rgb(col)
    for y in range(int(cy - r), int(cy + r) + 1):
        for x in range(int(cx - r), int(cx + r) + 1):
            d = math.hypot(x - cx, y - cy)
            if d > r + 0.2:
                continue
            lit = -((x - cx) + (y - cy)) / (2 * r)                       # +0.7 at the top left, -0.7 at the lower right
            c.px(x, y, tint(col, 0.35 * lit) if lit > 0.15 else shade(col, -0.45 * lit) if lit < -0.15 else col)
    c.px(int(cx - r / 2), int(cy - r / 2), rgb('#ffffff'))


def draw(mc, L):
    rgb, mix, shade, tint, Mat, base = mc.rgb, mc.mix, mc.shade, mc.tint, mc.Mat, mc.base
    WALL = mc.WALL
    walnut = Mat('#5a3620', hi='#7a4a2c', lo='#3a2214')
    walnut_g = Mat('#5a3620', hi='#7a4a2c', lo='#3a2214', pat=mc.grain(1))
    brass = Mat('#c9a13a', hi='#f0d27a', lo='#7a5a12')
    leather = Mat('#7a3428', hi='#9a4a3a', lo='#4a1a12')
    dark = Mat('#2a1a10', hi='#4a3020', lo='#140a04')
    chrome = Mat('#aeb8c6', hi='#eef2f6', lo='#5f6a7a')
    neon_cols = ['#ff4fd8', '#4fe0ff', '#c8ff4f', '#ffb84f']

    # ── walls: green damask above, walnut wainscot in raised panels below, a dado rail between ──
    g1, g2 = rgb('#1f4a3a'), rgb('#22503e')
    for y in range(4, WALL):
        for x in range(6, 522):
            if y < 56:
                c = g1 if (x // 4) % 2 else g2
                u, v = (x - 6) % 24, (y - 4) % 28                       # a damask figure in a slightly paler green
                du, dv = abs(u - 12), abs(v - 14)
                if (du * 2 + dv == 10) or (du + dv * 2 == 9 and dv < 4) or (du == 0 and dv < 3):
                    c = mix(c, rgb('#3a7a5a'), 0.35)
                if y < 14:
                    c = shade(c, 0.4 - 0.035 * (y - 4))
                elif y > 52:
                    c = shade(c, 0.1 * (y - 52))                       # the rail's shadow on the paper
            elif y < 59:
                c = tint(walnut.hi, 0.15) if y == 56 else walnut.base if y == 57 else walnut.lo
            else:
                panel = (x - 6) % 32
                c = walnut.base
                if mc.grain(2, depth=0.08, knots=False)(x, y, c, walnut) != c:
                    c = shade(c, 0.06)
                if WALL - 5 <= y:
                    c = shade(walnut.base, 0.25) if y > WALL - 5 else tint(walnut.hi, 0.1)       # the skirting board
                elif y in (59, 60) or panel in (0, 1, 30, 31):
                    c = walnut.lo if y == 59 or panel == 31 else walnut.base   # the stiles and rails round each panel
                elif y == 61 or panel == 2:
                    c = shade(walnut.lo, 0.2)                                # the panel's bevel, in shade at its top and left
                elif y == WALL - 7 or panel == 29:
                    c = walnut.hi                                            # and lit at its foot and right
                elif y == 62 or panel == 3:
                    c = shade(walnut.base, 0.1)
            base.px(x, y, c)
    base.rect(6, 4, 521, 5, rgb('#2a1a10'))
    for x in range(6, 522):                                              # a crown moulding at the ceiling
        base.px(x, 6, walnut.hi); base.px(x, 7, walnut.lo); base.px(x, 8, shade(base.get(x, 8), 0.3))

    # ── the carpet: burgundy pile with a gold lattice ──
    for y in range(WALL, mc.FLOOR_END + 1):
        for x in range(6, 522):
            if STAIRS[0] <= x <= STAIRS[2] and STAIRS[1] <= y <= STAIRS[3]:
                continue
            u, v = (x + y) % 16, (x - y) % 16
            if (u == 0 and v == 0) or (u == 8 and v == 8):
                col = rgb('#b8943e')
            elif (u == 0 and v in (1, 15)) or (v == 0 and u in (1, 15)) or (u == 8 and v in (7, 9)) or (v == 8 and u in (7, 9)):
                col = rgb('#7a3a2a')
            elif u == 0 or v == 0:
                col = rgb('#4c1724')
            else:
                col = rgb('#5e1f2c')
            c = mc.pile(x, y, col, 31)
            if y < WALL + 5:
                c = shade(c, 0.34 - 0.065 * (y - WALL))
            base.px(x, y, c)

    # ── the dartboard in its cabinet, and the oche ──
    cx, cy, r = BOARD

    # a rubber throwing mat from the wall under the board out past the oche, so the line on it plainly belongs to the
    # darts: black ribbed rubber, a green and red edge like the board's rings, distance ticks down both sides, and the
    # board's own bull printed at its foot
    MX0, MX1, MY1 = cx - 19, cx + 19, 146
    for y in range(WALL, MY1 + 1):
        for x in range(MX0, MX1 + 1):
            ex, ey = min(x - MX0, MX1 - x), MY1 - y
            col = rgb('#26262b') if y % 2 else rgb('#2e2e34')                    # the ribs across it
            if mc.hsh(x, y, 77) % 23 == 0:
                col = tint(col, 0.12)
            if ex == 0 or ey == 0:
                col = rgb('#101013')                                              # its bevelled edge
            elif ex == 1 or ey == 1:
                col = rgb('#1f8a4a') if ((x + y) // 4) % 2 else rgb('#c8202a')   # the board's colours round it
            elif ex == 2 and (MY1 - y) % 8 == 4 and y > 128:
                col = rgb('#d8d8d0')                                              # distance ticks
            if y < WALL + 5:
                col = shade(col, 0.3 - 0.06 * (y - WALL))                          # in the wainscot's shadow
            base.px(x, y, col)
    for x in range(MX0 + 1, MX1 + 2):                                            # its shadow on the carpet
        base.px(x, MY1 + 1, shade(base.get(x, MY1 + 1), 0.35))
    for y in range(WALL + 1, MY1 + 2):
        base.px(MX1 + 1, y, shade(base.get(MX1 + 1, y), 0.3))
    for y in range(137, 144):                                                    # the bull, printed behind the oche
        for x in range(cx - 4, cx + 5):
            d = math.hypot(x - cx, (y - 140) * 1.3)
            if d <= 4.2:
                base.px(x, y, rgb('#c8202a') if d < 1.6 else rgb('#1f8a4a') if d < 3 else rgb('#d8d8d0'))

    def darts(c):
        c.part(mc.rows(cx - 15, cy - 11, cx + 15, cy + 11), walnut_g, hi='tl', lo='rb', anchor=(0, 0))
        c.rect(cx - 14, cy - 10, cx + 14, cy - 10, tint(walnut.hi, 0.2))
        for x0 in (cx - 14, cx + 9):                                     # the open doors, chalkboards inside
            c.part(mc.rows(x0, cy - 9, x0 + 5, cy + 9), Mat('#1c1c1c', hi='#2c2c2c', lo='#0c0c0c'))
            for k in range(4):
                c.rect(x0 + 1, cy - 6 + k * 4, x0 + 1 + (k * 2) % 3 + 1, cy - 6 + k * 4, rgb('#c8c8c0'))
            c.px(x0 + 4, cy - 6, rgb('#8a8a84'))
        c.part(mc.rows(cx - 8, cy - 9, cx + 8, cy + 9), Mat('#2a1a10'))
        for y in range(cy - r - 1, cy + r + 2):
            for x in range(cx - r - 1, cx + r + 2):
                d = math.hypot(x - cx, y - cy)
                if d > r + 1.3:
                    continue
                if d > r + 0.3:
                    c.px(x, y, rgb('#141414') if (x + y) % 3 else rgb('#d8d8d0'))      # the number ring
                    continue
                seg = int(((math.degrees(math.atan2(x - cx, cy - y)) + 9) % 360) // 18)
                f = d / r
                col = rgb('#1a1a1a') if seg % 2 == 0 else rgb('#e8dcb8')
                if 0.82 < f or 0.48 < f < 0.6:
                    col = rgb('#c8202a') if seg % 2 == 0 else rgb('#1f8a4a')    # the double and treble rings
                if f < 0.2:
                    col = rgb('#c8202a') if f < 0.1 else rgb('#1f8a4a')
                if x < cx and y < cy and f > 0.5:
                    col = tint(col, 0.1)
                c.px(x, y, col)
        c.px(cx + 3, cy - 2, rgb('#e8e8e8')); c.px(cx + 4, cy - 3, rgb('#c23b3b'))      # a dart left in it
    mc.put(base, darts)
    base.rect(cx - 15, 127, cx + 15, 127, tint(brass.hi, 0.3))                   # the oche: a raised brass bar across the mat
    base.rect(cx - 15, 128, cx + 15, 128, brass.hi)
    base.rect(cx - 15, 129, cx + 15, 129, brass.lo)
    base.rect(cx - 15, 130, cx + 15, 130, shade(base.get(cx, 130), 0.4))
    L['things']['board'] = list(BOARD)
    L['things']['dartSpot'] = [cx, 138]

    # ── a rack of cues: 57 inches ──
    def cues(c):
        c.part(mc.rows(100, 44, 124, 47), walnut_g, hi='t', lo='b', anchor=(0, 0))
        c.part(mc.rows(100, 84, 124, 87), walnut_g, hi='t', lo='b', anchor=(0, 0))
        for x in range(102, 124, 5):
            c.px(x, 85, shade(walnut.base, 0.4))                         # the cups the butts sit in
        for k in range(4):
            x = 104 + k * 5
            c.rect(x, 47, x, 70, rgb('#ecd8a8')); c.rect(x + 1, 49, x + 1, 70, rgb('#b8a070'))      # the maple shaft, lit and shaded
            c.rect(x, 70, x + 1, 72, rgb('#f0f0e8'))                                                 # the joint ring
            c.rect(x, 73, x + 1, 84, rgb(('#2a1a10', '#4a1a2a', '#1a2a3a', '#2a1a10')[k]))           # the butt
            c.rect(x, 76, x + 1, 79, rgb('#3a3a3a')); c.px(x, 77, rgb('#5a5a5a'))                    # the wrap
            c.px(x, 46, rgb('#4a90d0')); c.px(x, 47, rgb('#f0f0e8'))                                 # chalked tip, ferrule
        c.part(mc.rows(101, 40, 123, 43), Mat('#1c1c1c', hi='#3a3a3a', lo='#0a0a0a'))
        c.rect(104, 41, 120, 41, rgb('#c9a13a'))
        for x in range(101, 124):
            c.px(x, 88, shade(rgb('#5a3620'), 0.5))
    mc.put(base, cues)

    # ── the jukebox ──
    # a 1940s jukebox, x 132-158, y 56-106: a walnut cabinet under a round arch of glowing amber and red tubes, the record
    # turning behind glass under the arch, the title strips and their chrome buttons, a chrome-latticed speaker with a gold
    # crest, glowing pilasters down both sides with bubbles rising in them, on a plinth with a chrome kick plate
    JX0, JX1, JCX, JTOP, JBOT = 132, 158, 145, 56, 104
    ARCH_CY, ARCH_R = 70, 13

    def jukebox(c):
        cab = Mat('#5a2a14', hi='#8a4a24', lo='#2e1408', pat=mc.grain(4, along='y', depth=0.12))
        tubes = [rgb('#ff3a1a'), rgb('#ff7a1a'), rgb('#ffb21a'), rgb('#ffe05a')]          # the arch's lit bands, outside in
        for y in range(JTOP, JBOT + 1):
            for x in range(JX0, JX1 + 1):
                if y < ARCH_CY:                                                  # the arch
                    d = math.hypot(x - JCX, y - ARCH_CY)
                    if d > ARCH_R + 0.4:
                        continue
                    if d > ARCH_R - 1.2:
                        col = cab.hi if x < JCX else cab.lo                      # its wooden rim
                    elif d > ARCH_R - 5.2:
                        band = int(ARCH_R - 1.2 - d)                             # four tubes of light round it
                        col = tubes[min(3, band)]
                        if (x + y) % 5 == 0:
                            col = tint(col, 0.4)
                        if x > JCX + 4:
                            col = shade(col, 0.12)
                    elif d > ARCH_R - 6.4:
                        col = chrome.hi if y < ARCH_CY - 4 else chrome.base      # a chrome ring inside the light
                    else:
                        col = rgb('#1a1026')                                     # the glass dome, dark
                elif x <= JX0 + 4 or x >= JX1 - 4:                               # the pilasters
                    t = (y - ARCH_CY) / (JBOT - 6 - ARCH_CY)
                    col = mix(rgb('#ffb21a'), rgb('#e0301a'), t) if JX0 + 1 <= x <= JX0 + 3 or JX1 - 3 <= x <= JX1 - 1 else cab.lo if x in (JX0, JX1) else chrome.base
                    if y >= JBOT - 6:
                        col = cab.base
                else:
                    col = None
                if col is not None:
                    c.px(x, y, col)
        # the cabinet's face between the pilasters
        c.part(mc.rows(JX0 + 5, ARCH_CY, JX1 - 5, JBOT - 6), cab, hi='l', lo='r', anchor=(0, 0))
        # the record turning under the dome: a black disc seen edge-on, its red label, and the tone arm
        c.part(mc.ellipse(JCX, ARCH_CY - 3, 6, 2), Mat('#101010', hi='#3a3a3a', lo='#050505'), hi='t', lo='b')
        c.px(JCX, ARCH_CY - 3, rgb('#d83a2a')); c.px(JCX + 1, ARCH_CY - 3, rgb('#d83a2a'))
        c.rect(JCX + 4, ARCH_CY - 7, JCX + 4, ARCH_CY - 4, chrome.hi); c.px(JCX + 3, ARCH_CY - 4, chrome.hi)
        c.px(JCX - 3, ARCH_CY - 9, rgb('#8a7aaa')); c.px(JCX - 2, ARCH_CY - 10, rgb('#8a7aaa'))        # the dome's glint
        # the title strips behind glass, two columns, and a row of chrome buttons under them
        c.rect(JX0 + 6, ARCH_CY + 1, JX1 - 6, ARCH_CY + 10, chrome.lo)
        c.rect(JX0 + 7, ARCH_CY + 2, JX1 - 7, ARCH_CY + 9, rgb('#f2e6c0'))
        for k in range(4):
            y = ARCH_CY + 3 + k * 2
            c.rect(JX0 + 8, y, JCX - 2, y, rgb('#8a5a3a') if k % 2 else rgb('#c23b3b'))
            c.rect(JCX + 1, y, JX1 - 8, y, rgb('#c23b3b') if k % 2 else rgb('#8a5a3a'))
        c.rect(JCX - 1, ARCH_CY + 2, JCX, ARCH_CY + 9, chrome.lo)
        c.rect(JX0 + 7, ARCH_CY + 2, JX0 + 7, ARCH_CY + 9, rgb('#ffffff'))
        for x in range(JX0 + 7, JX1 - 6, 2):
            c.px(x, ARCH_CY + 12, chrome.hi); c.px(x, ARCH_CY + 13, chrome.lo)
        # the speaker: a chrome lattice over dark cloth, a gold crest in its middle
        sy0, sy1 = ARCH_CY + 15, JBOT - 8
        for y in range(sy0, sy1 + 1):
            for x in range(JX0 + 6, JX1 - 5):
                lat = (x + y) % 4 == 0 or (x - y) % 4 == 0
                c.px(x, y, (chrome.hi if (x + y) % 8 == 0 else chrome.base) if lat else rgb('#2a0e14'))
        c.rect(JX0 + 6, sy0 - 1, JX1 - 6, sy0 - 1, chrome.hi); c.rect(JX0 + 6, sy1 + 1, JX1 - 6, sy1 + 1, chrome.lo)
        c.part(mc.ellipse(JCX, (sy0 + sy1) // 2, 3, 2.5), brass, hi='tl', lo='rb')
        c.px(JCX - 1, (sy0 + sy1) // 2 - 1, rgb('#fff4c0'))
        # bubbles rising in the pilasters' tubes
        for x in (JX0 + 2, JX1 - 2):
            for y in range(ARCH_CY + 3 + (x % 3), JBOT - 7, 5):
                c.px(x, y, rgb('#fff8e0'))
        # the plinth, its chrome kick plate and feet
        c.part(mc.rows(JX0, JBOT - 5, JX1, JBOT - 1), Mat('#3a1a0a', hi='#5a2a14', lo='#1a0a04'), hi='t', lo='b')
        c.rect(JX0 + 3, JBOT - 3, JX1 - 3, JBOT - 3, chrome.hi); c.rect(JX0 + 3, JBOT - 2, JX1 - 3, JBOT - 2, chrome.lo)
        c.rect(JX0 + 1, JBOT, JX0 + 3, JBOT + 1, rgb('#1a0a04')); c.rect(JX1 - 3, JBOT, JX1 - 1, JBOT + 1, rgb('#1a0a04'))
    mc.pool(JCX, JBOT + 3, 24, 7, '#ffb050', 0.3)                                 # its glow on the carpet
    mc.put(base, jukebox, shadow=True)
    mc.block(JX0, 96, JX1, JBOT)
    mc.light(JCX, ARCH_CY, 26, 24, '#ff9a40', 0.34)
    L['things']['jukebox'] = [JX0, JTOP, JX1 - JX0 + 1, JBOT - JTOP + 2]

    # ── the bar: the neon sign over shelves of bottles, a counter, nine stools ──
    BX0, BX1 = 172, 432

    def neon(c):
        sx = (BX0 + BX1) // 2 - mc.sign_width('GAME ROOM', 2) // 2 + 10
        c.part(mc.ellipse(sx - 14, 15, 6, 6), Mat('#1a1a1a', hi='#3a3a3a', lo='#0a0a0a'))
        for a in range(0, 360, 6):
            c.px(int(round(sx - 14 + 7 * math.cos(math.radians(a)))), int(round(15 + 7 * math.sin(math.radians(a)))), rgb('#4fe0ff'))
        c.part(mc.ellipse(sx - 14, 15, 2.5, 2.5), Mat('#f4f1e6'))
        mc.sign(c, sx, 9, 'GAME ROOM', 2, rgb('#ff4fa8'), rgb('#ffd8ee'), rgb('#6a0e40'))
    # the sign's glow on the wallpaper round it
    mc.pool((BX0 + BX1) // 2 + 4, 16, 90, 14, '#ff4fa8', 0.22)
    mc.put(base, neon, edge=False)
    mc.light((BX0 + BX1) // 2, 16, 70, 14, '#ff4fa8', 0.28)

    # two TVs on the wall above the bar, either side of the sign: the page puts on them what the projector upstairs
    # shows (somebody's shared screen, or what is in the Player)
    tvs = []
    for tx0 in (BX0 + 12, BX1 - 46):
        def tv(c, tx0=tx0):
            c.part(mc.rows(tx0, 6, tx0 + 34, 27), Mat('#1a1a1e', hi='#3a3a42', lo='#0a0a0c'), hi='tl', lo='rb')    # the bezel
            c.rect(tx0 + 2, 8, tx0 + 32, 25, rgb('#0c1018'))
            c.rect(tx0 + 16, 27, tx0 + 18, 29, rgb('#2a2a30'))                               # its wall mount
            c.px(tx0 + 31, 26, rgb('#e04040'))                                               # standby light
        mc.put(base, tv)
        tvs.append([tx0 + 2, 8, 31, 18])
    L['things']['tvs'] = tvs

    def backbar(c):
        c.part(mc.rows(BX0 + 6, 30, BX1 - 6, 86), Mat('#2a1a10', hi='#4a3020', lo='#140a04'), hi='tl', lo='rb')
        c.rect(BX0 + 6, 30, BX1 - 6, 31, walnut.hi); c.rect(BX0 + 4, 28, BX1 - 4, 29, walnut.base)     # its cornice
        c.rect(BX0 + 4, 28, BX1 - 4, 28, tint(walnut.hi, 0.2))
        for y in range(34, 53):                                                    # the mirror, with the room's light sliding across it
            for x in range(BX0 + 10, BX1 - 9):
                t = (y - 34) / 18
                col = mix(rgb('#9aaab8'), rgb('#5a6a78'), t)
                k = (x - y * 2) % 46
                if k < 3:
                    col = tint(col, 0.35)
                elif k < 5 or (x - y * 2) % 23 == 0:
                    col = tint(col, 0.15)
                c.px(x, y, col)
        for y in (52, 70):
            c.part(mc.rows(BX0 + 6, y, BX1 - 6, y + 1), walnut, hi='t', lo='b')
            c.rect(BX0 + 7, y + 2, BX1 - 7, y + 2, rgb('#140a04'))
        cols = ['#3a7a3a', '#a85a1a', '#d8c070', '#6a1a1a', '#2a4a8a', '#c8c8c8', '#8a3a6a', '#d89030']
        for row, y in enumerate((52, 70)):
            for k in range((BX1 - BX0 - 24) // 5):
                x = BX0 + 12 + k * 5
                h = 6 + (k * 7 + row * 3) % 3
                col = rgb(cols[(k * 3 + row) % len(cols)])
                c.rect(x, y - h, x + 2, y - 1, col)
                c.rect(x + 2, y - h, x + 2, y - 1, shade(col, 0.3))               # its shaded side
                c.rect(x + 1, y - h - 2, x + 1, y - h, shade(col, 0.3))
                c.px(x + 1, y - h - 3, rgb('#c9a13a') if k % 3 == 0 else rgb('#2a2a2a'))   # the cap
                c.px(x, y - h + 1, tint(col, 0.6))
                if k % 2:
                    c.rect(x, y - h + 3, x + 2, y - h + 4, rgb('#f0e8d0'))         # a label
        c.rect(BX0 + 10, 74, BX1 - 10, 84, rgb('#1a120a'))
        for k in range(8):                                                        # cupboard doors, each panelled with a pull
            x = BX0 + 10 + k * 30
            c.part(mc.rows(x + 1, 74, x + 29, 84), Mat('#3a2214', hi='#5a3620', lo='#1a0c04'), hi='tl', lo='rb')
            c.rect(x + 4, 77, x + 26, 81, shade(walnut.base, 0.25))
            c.rect(x + 14, 78, x + 15, 79, brass.hi)
    mc.put(base, backbar)

    def counter(c):
        top = Mat('#3a2214', hi='#6a4228', lo='#24140a', pat=mc.grain(6, depth=0.12))
        box3(mc, c, BX0, 100, BX1, 118, 6, top, walnut_g, anchor=(0, 0))
        c.rect(BX0, 100, BX1, 100, brass.hi)
        c.rect(BX0 + 1, 101, BX1 - 1, 101, tint(rgb('#6a4228'), 0.15))
        for x in range(BX0 + 10, BX1 - 23, 24):                                   # raised panels down the front
            c.rect(x + 2, 108, x + 21, 108, walnut.lo); c.rect(x + 2, 109, x + 2, 114, walnut.lo)
            c.rect(x + 3, 114, x + 21, 114, walnut.hi); c.rect(x + 21, 109, x + 21, 113, walnut.hi)
            c.rect(x + 3, 109, x + 20, 109, shade(walnut.base, 0.12))
        c.rect(BX0, 116, BX1, 116, brass.base); c.rect(BX0, 115, BX1, 115, brass.hi)      # the foot rail
        c.rect(BX0, 117, BX1, 117, brass.lo)
        for x in range(BX0 + 12, BX1, 48):
            c.rect(x, 112, x + 1, 114, brass.lo)                                   # its brackets
        # on the counter: three beer taps, glasses, a bowl of nuts, a bar mat
        for k, tx in enumerate((BX0 + 120, BX0 + 128, BX0 + 136)):
            c.rect(tx - 1, 94, tx + 1, 94, rgb(('#e8b030', '#2a2a2a', '#c23b3b')[k]))
            c.rect(tx, 95, tx, 101, chrome.hi); c.rect(tx + 1, 96, tx + 1, 101, chrome.lo)
        c.rect(BX0 + 116, 102, BX0 + 140, 103, rgb('#1a1a1a'))
        for gx in (BX0 + 30, BX0 + 34, BX0 + 200, BX0 + 236):
            c.rect(gx, 98, gx + 2, 101, rgb('#e8b040') if gx % 3 else rgb('#cfe6f0'))
            c.px(gx, 98, rgb('#ffffff')); c.rect(gx, 97, gx + 2, 97, rgb('#f8f4e8') if gx % 3 else rgb('#cfe6f0'))
        c.part(mc.ellipse(BX0 + 70, 101, 4, 1.5), Mat('#c8c0a8', hi='#ffffff', lo='#8a8270'))
        c.rect(BX0 + 68, 100, BX0 + 72, 100, rgb('#b8843a'))
    mc.drop(BX0 + 1, BX1 - 1, 119, 0.35, 2)
    mc.put(base, counter, shadow=True)
    mc.block(BX0, 98, BX1, 118)
    mc.pool((BX0 + BX1) // 2, 104, 140, 12, '#ffd08a', 0.1)
    mc.light((BX0 + BX1) // 2, 60, 120, 26, '#ffd08a', 0.22)
    L['spots'] = [['fridge', BX0, 94, BX1 - BX0 + 1, 25]]

    for k in range(9):
        x = BX0 + 18 + k * 28

        # Seen from behind its sitter: their butt sits on the seat, its near rim across the bottom of their shorts, and
        # the pole runs down in front of their legs to a foot nearer to us than their feet. Pulled right up to the bar
        # (their knees under its overhang). The sitter's body is an even number of dots across, its middle between x-1
        # and x, so the stool is too: 12 across, the pole 2.
        SY = 128                                                                 # the sitter's feet
        def stool(c, x=x):
            red = Mat('#7a2a22', hi='#b85a4a', lo='#4a1612')
            for y, a, b in ((SY - 5, -4, 3), (SY - 4, -5, 4), (SY - 3, -6, 5), (SY - 2, -6, 5)):      # the cushion's top, flat across its crown
                for xx in range(x + a, x + b + 1):
                    col = red.hi if y == SY - 5 else red.base if y < SY - 2 else red.lo
                    if xx in (x + a, x + b) and y > SY - 5:
                        col = shade(col, 0.2)
                    c.px(xx, y, col)
            c.rect(x - 4, SY - 4, x - 2, SY - 4, tint(red.hi, 0.2))                 # its sheen
            for y in (SY - 1, SY):                                                 # its side, in shade
                c.rect(x - 5, y, x + 4, y, shade(red.lo, 0.3 if y == SY else 0.1))
            c.rect(x - 4, SY + 1, x + 3, SY + 1, chrome.lo)                         # the chrome ring under it
            c.rect(x - 1, SY + 2, x - 1, SY + 10, chrome.hi); c.rect(x, SY + 2, x, SY + 10, chrome.lo)
            c.rect(x - 4, SY + 6, x + 3, SY + 6, chrome.base); c.rect(x - 3, SY + 5, x + 2, SY + 5, chrome.hi)   # the foot ring
            c.rect(x - 3, SY + 11, x + 2, SY + 11, dark.base); c.rect(x - 4, SY + 12, x + 3, SY + 12, dark.lo)    # its foot on the floor
        mc.drop(x - 4, x + 3, SY + 13, 0.3, 2)
        mc.put_over(stool, SY + 12, shadow=True)    # (over its sitter, whose feet are at SY, and anyone further up the room)
        mc.block(x - 5, SY - 6, x + 4, SY + 9)
        L['seats'].append(dict(x=x, y=SY, ax=x, ay=SY + 20, pose='back', flip=False, hit=[x - 10, 100, 20, SY + 14 - 100]))

    # ── the pool table, in the middle of its rug (no lamp over it any more, 2026-11-19) ──
    fx, fy, fw, fh = FELT
    wood = Mat('#4a2414', hi='#7a3e22', lo='#2a120a', pat=mc.grain(8, depth=0.12))

    # a rug under it, unlike the lounge's: a modern one, charcoal in a big checkerboard, bound with one gold line and no
    # fringe. The same size as the lounge's rug (RUG) and on the same line across the room; the table stands in its
    # middle (rails to legs: x fx-4 to fx+fw+3, y fy-4 to fy+fh+10)
    rx0, ry0 = fx + fw // 2 - RUG[0] // 2, RUG_Y
    checker = lambda x, y: 1 if ((x - rx0 - 6) // 11 + (y - ry0 - 6) // 11) % 2 else 0
    mc.rug(rx0, ry0, rx0 + RUG[0] - 1, ry0 + RUG[1] - 1, rgb('#26272e'), rgb('#c9a13a'), rgb('#26272e'), checker, 33, kind='modern')

    def table(c):
        c.part(mc.rows(fx - 4, fy - 4, fx + fw + 3, fy + fh + 3), wood, hi='tl', lo='rb', anchor=(0, 0))
        c.rect(fx - 3, fy - 4, fx + fw + 2, fy - 4, tint(rgb('#7a3e22'), 0.2))
        apron = Mat('#3a1a0e', hi='#5a2a16', lo='#1a0804', pat=mc.grain(9, depth=0.12))
        c.part(mc.rows(fx - 3, fy + fh + 4, fx + fw + 2, fy + fh + 8), apron, hi='l', lo='rb', anchor=(0, 0))
        c.rect(fx - 3, fy + fh + 4, fx + fw + 2, fy + fh + 4, shade(rgb('#3a1a0e'), 0.3))
        c.rect(fx + fw // 2 - 4, fy + fh + 6, fx + fw // 2 + 4, fy + fh + 6, brass.base)     # the ball return's brass plate
        for lx in (fx - 2, fx + fw - 1):                                         # turned legs
            c.rect(lx, fy + fh + 8, lx + 2, fy + fh + 10, rgb('#1a0804')); c.px(lx, fy + fh + 8, rgb('#5a2a16'))
        for y in range(fy, fy + fh):                                             # the felt: the nap, and a sheen in its middle
            for x in range(fx, fx + fw):
                col = rgb('#1f7a4a') if (x + y) % 5 else rgb('#1d744a')
                d = ((x - fx - fw / 2) / (fw / 2)) ** 2 + ((y - fy - fh / 2) / (fh / 2)) ** 2
                col = tint(col, 0.14 * max(0, 1 - d)) if d < 1 else shade(col, 0.1 * min(1, d - 1))
                c.px(x, y, col)
        c.px(fx + fw // 4, fy + fh // 2, rgb('#e8f0e8'))                          # the head spot
        c.rect(fx - 1, fy - 1, fx + fw, fy - 1, rgb('#2a9a5a'))                  # the cushions: lit on the far side
        c.rect(fx - 1, fy + fh, fx + fw, fy + fh, rgb('#14502f'))
        c.rect(fx - 1, fy, fx - 1, fy + fh - 1, rgb('#239058'))
        c.rect(fx + fw, fy, fx + fw, fy + fh - 1, rgb('#14502f'))
        c.rect(fx, fy, fx + fw - 1, fy, rgb('#15603a'))                         # their shadow on the felt
        for k in (1, 2, 3):
            c.px(fx + fw * k // 4, fy - 3, rgb('#f0e8d0')); c.px(fx + fw * k // 4, fy + fh + 2, rgb('#f0e8d0'))
        for k in (1,):
            c.px(fx - 3, fy + fh // 2, rgb('#f0e8d0')); c.px(fx + fw + 2, fy + fh // 2, rgb('#f0e8d0'))
        for px, py in ((fx - 1, fy - 1), (fx + fw // 2, fy - 2), (fx + fw, fy - 1), (fx - 1, fy + fh), (fx + fw // 2, fy + fh + 1), (fx + fw, fy + fh)):
            c.rect(px - 1, py - 1, px + 1, py + 1, rgb('#0a0a0a'))
            c.px(px - 1, py - 1, rgb('#3a2a1a'))                                   # the pocket's leather lip
        for px, py in ((fx - 4, fy - 4), (fx + fw + 2, fy - 4), (fx - 4, fy + fh + 2), (fx + fw + 2, fy + fh + 2)):
            c.rect(px, py, px + 1, py + 1, brass.base); c.px(px, py, brass.hi)    # brass corner caps
    mc.drop(fx - 4, fx + fw + 3, fy + fh + 11, 0.35, 3)
    mc.put(base, table, shadow=True)
    mc.block(fx - 4, fy - 4, fx + fw + 3, fy + fh + 10)
    L['things']['felt'] = list(FELT)
    L['things']['poolSpots'] = [[fx - 16, fy + fh // 2 + 6], [fx + fw + 16, fy + fh // 2 + 6]]


    # ── the lounge: a sofa facing down the room and an armchair either side of a low table ──
    # a rug under it all, navy with a gold lattice (it was under the poker table)
    diamond = lambda x, y: 2 if (x + y) % 10 == 0 and (x - y) % 10 == 0 else 1 if (x + y) % 10 == 0 or (x - y) % 10 == 0 else 0
    mc.rug(278, RUG_Y, 278 + RUG[0] - 1, RUG_Y + RUG[1] - 1, rgb('#1c2440'), rgb('#c9a13a'), rgb('#10162a'), diamond, 71)
    LY = 18                                                          # (moved down from the bar, 2026-11-19: the holiday pieces on its table in client/src/holidays/rooms.ts moved with it)
    sw = mc.sofa(318, 150 + LY, 2, leather, nails='#c9a13a')
    mc.side_chair(290, 188 + LY, True, leather)
    mc.side_chair(318 + sw + 4, 188 + LY, False, leather)

    TY = LY                                                          # (three cells of the walking grid, so its walkways stay as they were)
    def low_table(c):
        box3(mc, c, 326, 198 + TY, 368, 210 + TY, 5, walnut_g, Mat('#2a1a10', hi='#4a3020', lo='#140a04', pat=mc.grain(10, depth=0.1)), anchor=(0, 0))
        c.rect(327, 198 + TY, 367, 198 + TY, tint(walnut.hi, 0.25))
        c.rect(334, 199 + TY, 340, 202 + TY, rgb('#e8e0c8')); c.rect(335, 200 + TY, 339, 200 + TY, rgb('#c23b3b')); c.rect(334, 202 + TY, 340, 202 + TY, rgb('#b8b0a0'))   # a magazine
        c.rect(358, 199 + TY, 360, 202 + TY, rgb('#d89030')); c.px(358, 199 + TY, rgb('#ffe0a0'))                    # a pint
        c.part(mc.ellipse(349, 200 + TY, 3, 1.5), Mat('#c8c0a8', hi='#ffffff', lo='#8a8270'))               # a bowl of crisps
        c.px(348, 200 + TY, rgb('#e8b040')); c.px(350, 199 + TY, rgb('#e8b040'))
        for x in (328, 365):
            c.rect(x, 208 + TY, x + 1, 210 + TY, rgb('#140a04'))
        c.rect(331, 205 + TY, 363, 205 + TY, shade(rgb('#2a1a10'), 0.3))                 # the shelf under it
    mc.drop(327, 368, 211 + TY, 0.3, 2)
    mc.put_over(low_table, 210 + TY)
    mc.block(326, 198 + TY, 368, 210 + TY)

    # ── the shuffleboard table: 11 feet by 20 inches ──
    sx, sy, sl, sw2 = SHUFFLE

    def shuffle(c):
        box3(mc, c, sx - 2, sy - 3, sx + sl + 1, sy + sw2 + 9, sw2 + 5, Mat('#5a3418', hi='#7a4a28', lo='#3a1e0c', pat=mc.grain(11)), Mat('#3a2010', hi='#5a3418', lo='#24140a', pat=mc.grain(12, depth=0.12)), anchor=(0, 0))
        for y in range(sy, sy + sw2):                                            # the playfield: polished, sanded, a sheen down it
            for x in range(sx, sx + sl):
                col = rgb('#e2c48e') if (x // 3 + y) % 5 else rgb('#dabb84')
                if (y - sy) in (2, 3) and (x // 7) % 4 != 3:
                    col = tint(col, 0.25)
                if mc.hsh(x, y, 40) % 29 == 0:
                    col = tint(col, 0.35)                                        # grains of shuffleboard wax
                c.px(x, y, col)
        c.rect(sx, sy, sx + sl - 1, sy, rgb('#f8e8c0'))
        c.rect(sx, sy + sw2 - 1, sx + sl - 1, sy + sw2 - 1, rgb('#c0a070'))
        for at, col in ((72, '#3a2a1a'), (264 - 72, '#8a2a1a'), (264 - 24, '#8a2a1a'), (264 - 6, '#8a2a1a')):
            x = sx + at * sl // 264
            c.rect(x, sy, x, sy + sw2 - 1, rgb(col))
        for gy in (sy - 2, sy + sw2):                                             # the gutters either side, lit along one lip
            c.rect(sx, gy, sx + sl - 1, gy + 1, rgb('#2a1608')); c.rect(sx, gy + (1 if gy < sy else 0), sx + sl - 1, gy + (1 if gy < sy else 0), rgb('#1a0c04'))
        for k in range(3):                                                        # the scoring numbers at the far end
            c.px(sx + sl - 20 + k * 6, sy + sw2 // 2, rgb('#6a2a1a'))
        c.rect(sx - 1, sy + sw2 + 4, sx + sl, sy + sw2 + 4, rgb('#c9a13a'))      # a brass strip along the cabinet
        for lx in (sx + 6, sx + sl // 2, sx + sl - 8):
            c.rect(lx, sy + sw2 + 9, lx + 2, sy + sw2 + 12, rgb('#1a0c04')); c.px(lx, sy + sw2 + 9, rgb('#5a3418'))
    mc.drop(sx - 2, sx + sl + 1, sy + sw2 + 13, 0.35, 3)
    mc.put(base, shuffle, shadow=True)
    mc.block(sx - 2, sy - 3, sx + sl + 1, sy + sw2 + 12)
    L['things']['shuffle'] = [sx, sy, sl, sw2]
    L['things']['shuffleSpot'] = [sx - 12, sy + sw2 // 2 + 4]

    # ── the bowling lane, the whole right side: pins at the back wall, the approach at the front ──
    ln = LANE
    lx0, lx1, top, foul, g = ln['x0'], ln['x1'], ln['top'], ln['foul'], ln['gutter']
    maple = [rgb('#e0b878'), rgb('#d8ae6c'), rgb('#e6c084')]

    def lane(c):
        for y in range(WALL, foul + 1):                                       # the capping either side, with neon strips
            for x in list(range(lx0 - g - 6, lx0 - g)) + list(range(lx1 + g + 1, lx1 + g + 7)):
                edge = x in (lx0 - g - 6, lx1 + g + 6)
                col = rgb('#1e1a30') if edge else rgb('#2a2440') if (x + y // 2) % 3 else rgb('#2e2846')
                if x in (lx0 - g - 2, lx1 + g + 2):
                    col = rgb(neon_cols[1]) if (y // 6) % 2 else mix(rgb(neon_cols[1]), rgb('#2a2440'), 0.4)
                c.px(x, y, col)
        for y in range(top, foul + 1):
            for x in range(lx0, lx1 + 1):
                col = maple[(x - lx0) % 3]
                if (x - lx0) % 4 == 3:
                    col = shade(col, 0.07)
                if (y * 3 + (x - lx0) * 41) % 97 == 0:
                    col = shade(col, 0.1)                                     # the end of a board
                if y < top + 20:
                    col = tint(col, 0.12)                                     # the pin deck
                t = (x - lx0) / (lx1 - lx0)                                   # the oil's sheen down the middle
                if 0.35 < t < 0.6 and y > top + 20:
                    col = tint(col, 0.12 * (1 - abs(t - 0.47) * 8) * (0.5 + 0.5 * (y - top) / (foul - top)))
                c.px(x, y, col)
            for gx in list(range(lx0 - g, lx0)) + list(range(lx1 + 1, lx1 + g + 1)):
                d = min(abs(gx - (lx0 - g // 2 - 1)), abs(gx - (lx1 + g // 2 + 1)))
                col = shade(rgb('#5a6070'), 0.12 * d)
                if gx in (lx0 - 1, lx1 + 1):
                    col = rgb('#8a90a0')                                      # the gutter's lip, lit
                c.px(gx, y, col)
        for k in range(top + 22, foul - 40, 30):                              # the range finders, and the dots
            c.px((lx0 + lx1) // 2, k, rgb('#5a3a1a'))
        for bx in (-9, -6, -3, 0, 3, 6, 9):                                   # the arrows
            ax_, ay_ = (lx0 + lx1) // 2 + bx, foul - 36 - abs(bx)
            c.px(ax_, ay_, rgb('#3a2a1a')); c.px(ax_, ay_ - 1, rgb('#6a4a2a'))
        c.rect(lx0 - g, WALL, lx1 + g, top - 1, rgb('#08060e'))                 # the pit
        c.rect(lx0 - g, top - 3, lx1 + g, top - 1, rgb('#14121e'))
        for y in range(foul + 1, foul + 22):                                   # the approach
            for x in range(lx0 - g - 6, lx1 + g + 7):
                col = mix(maple[(x // 3) % 3], rgb('#f0d8a8'), 0.3)
                if (x // 3) % 4 == 3:
                    col = shade(col, 0.05)
                c.px(x, y, col)
        c.rect(lx0 - g - 6, foul + 1, lx1 + g + 6, foul + 1, rgb('#e04040'))
        c.rect(lx0 - g - 6, foul + 2, lx1 + g + 6, foul + 2, rgb('#ff8080'))
        for dx in (-8, -4, 0, 4, 8):
            c.px((lx0 + lx1) // 2 + dx, foul + 12, rgb('#3a2a1a'))
            c.px((lx0 + lx1) // 2 + dx, foul + 18, rgb('#3a2a1a'))
        for x in range(lx0 - g - 6, lx1 + g + 7):
            c.px(x, foul + 21, shade(c.get(x, foul + 21), 0.25))
    mc.put(base, lane, edge=False)
    mc.block(lx0 - g - 6, WALL, lx1 + g + 6, foul)

    def masking(c):                                                      # the pinsetter's housing on the back wall
        c.part(mc.rows(lx0 - g - 10, 30, lx1 + g + 10, WALL - 2), Mat('#1a1a2a', hi='#2a2a44', lo='#0a0a14'), hi='tl', lo='rb')
        for y in range(34, WALL - 8):                                         # a cosmic swirl on the masking panel, faint
            for x in range(lx0 - g - 8, lx1 + g + 9):
                if (x * 3 + y * 5 + int(6 * math.sin(x / 6.0))) % 37 == 0:
                    c.px(x, y, rgb('#3a2a5a'))
                elif mc.hsh(x, y, 55) % 61 == 0:
                    c.px(x, y, rgb('#d8d8ff'))                                 # a star
        for k in range(5):
            col = rgb(neon_cols[k % 4])
            c.rect(lx0 - 4 + k * 7, 38, lx0 - 1 + k * 7, 41, col)
            c.rect(lx0 - 4 + k * 7, 38, lx0 - 1 + k * 7, 38, tint(col, 0.5))
        mc.sign(c, (lx0 + lx1) // 2 - mc.sign_width('BOWL', 1) // 2, 50, 'BOWL', 1, rgb('#ff4fd8'))
        mc.sign(c, (lx0 + lx1) // 2 - mc.sign_width('STRIKE', 1) // 2, 62, 'STRIKE', 1, rgb('#ffb84f'))
        c.rect(lx0 - g - 10, WALL - 6, lx1 + g + 10, WALL - 2, rgb('#4fe0ff'))
        c.rect(lx0 - g - 10, WALL - 6, lx1 + g + 10, WALL - 6, rgb('#c8f8ff'))
        c.rect(lx0 - g - 10, WALL - 2, lx1 + g + 10, WALL - 2, rgb('#2a9ab8'))
        c.rect((lx0 + lx1) // 2, 6, (lx0 + lx1) // 2, 12, rgb('#3a3a4a'))       # its scoring monitor, hanging
        c.part(mc.rows((lx0 + lx1) // 2 - 22, 12, (lx0 + lx1) // 2 + 22, 28), Mat('#1a1a1a', hi='#3a3a3a', lo='#0a0a0a'), hi='tl', lo='rb')
        c.rect((lx0 + lx1) // 2 - 20, 14, (lx0 + lx1) // 2 + 20, 26, rgb('#0a1430'))
    mc.put(base, masking)
    L['things']['scoreboard'] = [(lx0 + lx1) // 2 - 19, 14, 39, 13]
    mc.light((lx0 + lx1) // 2, top + 10, 18, 14, '#ffffff', 0.2)
    mc.light((lx0 + lx1) // 2, 64, 30, 22, '#4fe0ff', 0.18)
    L['things']['bowl'] = dict(x0=lx0, x1=lx1, top=top - 2, foul=foul, gutter=g)
    L['things']['bowlerSpot'] = [(lx0 + lx1) // 2, foul + 12]

    def ball_return(c):                                                  # the ball return, beside the approach
        rx = lx0 - g - 22
        c.part(mc.rows(rx, foul - 6, rx + 14, foul + 26), Mat('#2a2a3a', hi='#4a4a62', lo='#14141e'), hi='tl', lo='rb')
        c.rect(rx + 1, foul - 5, rx + 13, foul - 5, rgb('#5a5a78'))
        c.part(mc.ellipse(rx + 7, foul - 3, 6, 3), Mat('#1a1a24', hi='#2a2a3a'))
        c.rect(rx + 1, foul + 3, rx + 13, foul + 22, rgb('#1a1a26'))            # the rack the balls sit on
        c.rect(rx + 1, foul + 22, rx + 13, foul + 22, chrome.base)
        for k, col in enumerate(('#e04040', '#4f9cf0', '#c8ff4f', '#ffb84f')):
            ball(mc, c, rx + 4 + (k % 2) * 6, foul + 8 + (k // 2) * 7, 3, col)
        c.rect(rx + 2, foul + 24, rx + 12, foul + 24, rgb('#4fe0ff'))
        c.rect(rx + 3, foul + 25, rx + 11, foul + 25, rgb('#2a8aa8'))
    mc.drop(lx0 - g - 22, lx0 - g - 8, foul + 27, 0.3, 2)
    mc.put(base, ball_return, shadow=True)
    mc.block(lx0 - g - 22, foul - 6, lx0 - g - 8, foul + 26)

    def console(c):                                                      # the scorer's console, behind the approach
        box3(mc, c, lx0 - 4, foul + 26, lx1 + 4, foul + 36, 4, Mat('#2a2a3a', hi='#4a4a62', lo='#14141e'), Mat('#1a1a24', hi='#2a2a3a', lo='#0a0a10'))
        c.rect(lx0 + 2, foul + 23, lx1 - 2, foul + 26, rgb('#0a1430')); c.rect(lx0 + 4, foul + 24, lx0 + 12, foul + 24, rgb('#4fe0ff'))
        c.rect(lx0 + 2, foul + 23, lx1 - 2, foul + 23, rgb('#2a3a6a'))
        for k in range(5):
            c.px(lx0 + 2 + k * 5, foul + 32, rgb(neon_cols[k % 4]))           # its buttons
    mc.drop(lx0 - 4, lx1 + 4, foul + 37, 0.3, 2)
    mc.put(base, console, shadow=True)
    mc.block(lx0 - 4, foul + 23, lx1 + 4, foul + 36)
    mc.back_bench(lx0 - 12, foul + 54, 2, Mat('#3a1a5a', hi='#5a2a8a', lo='#220e36'))      # the bowlers' bench

    # ── a fern by the bar ──
    def plant(c):
        c.part(mc.rows(442, 141, 450, 150), Mat('#8a4a2a', hi='#b87a4a', lo='#5a2a14'), hi='l', lo='r')
        c.part(mc.rows(441, 139, 451, 141), Mat('#9a5a32', hi='#c88a5a', lo='#6a3a1a'), hi='t', lo='b')     # the pot's rim
        c.rect(442, 145, 450, 145, rgb('#6a3418'))
        c.rect(443, 139, 449, 139, rgb('#2a1a10'))                               # the soil
        for a in range(-170, 10, 14):                                            # fronds arching up and out, lit at the top
            ra = math.radians(a)
            for t in range(1, 12):
                droop = (t / 11) ** 2 * 4
                x_ = int(round(446 + t * math.cos(ra) * 1.1))
                y_ = int(round(138 + t * math.sin(ra) * 0.8 + droop))
                col = rgb('#5aaa4a') if t < 5 else rgb('#3a8a3a') if t < 9 else rgb('#2a6a2a')
                c.px(x_, y_, col)
                if t % 2 == 0 and 2 < t < 10:                                     # the leaflets
                    c.px(x_, y_ - 1, rgb('#6aba5a')); c.px(x_ + (1 if math.cos(ra) > 0 else -1), y_ + 1, rgb('#2a6a2a'))
    mc.drop(441, 451, 151, 0.3, 2)
    mc.put(base, plant, shadow=True)
    mc.block(440, 136, 452, 150)

    # ── the poker table, between the stairs and the pool table: a six-seat racetrack, about 7 feet by 3 and a half ──
    px0, py0, px1, py1 = POKER
    pcx = (px0 + px1) // 2
    rail = Mat('#2a1a16', hi='#5a3a30', lo='#120806')                # the padded rail: oxblood leather gone nearly black
    trim = Mat('#7a4a28', hi='#b07a48', lo='#4a2a14')                # the walnut racetrack inside it
    pad = Mat('#6a1e1a', hi='#9a3a2e', lo='#3a0e0a', pat=mc.weave(17, 0.05))      # the chairs' leather

    def racetrack(c0, r0, c1, r1, inset):
        """The rows of a stadium (a rectangle with round ends) from (c0, r0) to (c1, r1), shrunk by `inset` all round."""
        rr = (r1 - r0) / 2 - inset
        cy_ = (r0 + r1) / 2
        out = []
        for y in range(int(round(cy_ - rr)), int(round(cy_ + rr)) + 1):
            dx = math.sqrt(max(0.0, rr * rr - (y - cy_) ** 2))
            out.append((y, int(round(c0 + (r1 - r0) / 2 - dx)), int(round(c1 - (r1 - r0) / 2 + dx))))
        return out

    def poker_stool(c, x, y):
        """A club stool seen from in front and above, its seat's middle at (x, y): a buttoned oxblood cushion, its side
        band with a row of brass nails, a chrome column and a round black foot. 11 wide, 12 tall."""
        c.part(mc.ellipse(x, y + 9, 4, 1.2), Mat('#1a1414', hi='#3a3232', lo='#0a0606'), hi='t', lo='b')     # the foot
        c.rect(x - 1, y + 3, x - 1, y + 8, chrome.hi); c.rect(x, y + 3, x, y + 8, chrome.base); c.rect(x + 1, y + 3, x + 1, y + 8, chrome.lo)
        c.part(mc.rows(x - 5, y, x + 5, y + 3), Mat(pad.lo, hi=pad.base, lo=shade(pad.lo, 0.3)), hi='l', lo='rb')   # the cushion's side
        for k in range(x - 4, x + 5, 2):
            c.px(k, y + 2, brass.hi)                                       # its nails
        c.part(mc.ellipse(x, y, 5, 2), pad, hi='tl', lo='rb')               # its top
        c.px(x, y, shade(pad.lo, 0.2)); c.px(x - 2, y - 1, tint(pad.hi, 0.3)); c.px(x - 3, y, tint(pad.hi, 0.15))

    # (no rug under it: the navy one is under the lounge's sofa and chairs now)

    seat_at = []
    for x in (pcx - 14, pcx + 14):                                       # the far side: stools behind the table, which is in front of them
        mc.put(base, lambda c, x=x: poker_stool(c, x, py0 - 6), shadow=True)
        seat_at.append(len(L['seats']))
        L['seats'].append(dict(x=x, y=py0 + 5, ax=x, ay=py0 - 11, pose='front', flip=False, hit=[x - 9, py0 - 20, 18, 26]))

    def poker(c):                                                        # drawn in front of whoever sits on the far side
        rows_ = racetrack(px0, py0, px1, py1, 0)
        bot = max(y for y, _, _ in rows_)
        # the apron under the rail, its face seen from in front, and the pedestal under that
        face = Mat('#3a2214', hi='#5a3620', lo='#1a0c04', pat=mc.grain(31, depth=0.12))
        c.part([(y + 4, a, b) for y, a, b in rows_ if y >= (py0 + py1) // 2] + [(bot + k, rows_[-1][1] + 2 + k, rows_[-1][2] - 2 - k) for k in range(1, 5)], face, hi='l', lo='rb', anchor=(0, 0))
        c.part(mc.rows(pcx - 7, bot + 5, pcx + 7, bot + 9), Mat('#1a1008', hi='#3a2414', lo='#0a0604'), hi='l', lo='r')
        c.part(mc.ellipse(pcx, bot + 10, 13, 2), Mat('#24160c', hi='#4a3020', lo='#0a0604'), hi='t', lo='b')
        # the padded rail: lit along its top edge, a sheen down its far stretch, its stitched seam
        c.part(rows_, rail, hi='tl', lo='rb')
        for y, a, b in rows_[1:3]:
            c.rect(a + 6, y, b - 6, y, tint(rail.hi, 0.15) if y == rows_[1][0] else rail.hi)
        # the walnut racetrack, then the felt inside it
        c.part(racetrack(px0, py0, px1, py1, 4), trim, hi='tl', lo='rb')
        felt_rows = racetrack(px0, py0, px1, py1, 6)
        fy0, fy1 = felt_rows[0][0], felt_rows[-1][0]
        for y, a, b in felt_rows:
            for x in range(a, b + 1):
                col = rgb('#1e6a48') if (x * 3 + y) % 5 else rgb('#1c6444')
                d = ((x - pcx) / ((px1 - px0) / 2 - 6)) ** 2 + ((y - (fy0 + fy1) / 2) / ((fy1 - fy0) / 2 + 1)) ** 2
                col = tint(col, 0.16 * max(0, 1 - d)) if d < 1 else shade(col, 0.12 * min(1, d - 1))
                if x == a or x == b or y == fy0:
                    col = shade(col, 0.35)                               # the trim's shadow on the felt
                c.px(x, y, col)
        for y, a, b in racetrack(px0, py0, px1, py1, 9):                  # the betting line, a fine gold ring
            if y in (fy0 + 3, fy1 - 3):
                for x in range(a + 2, b - 1, 2):
                    c.px(x, y, rgb('#b89a4a'))
            else:
                c.px(a, y, rgb('#b89a4a')); c.px(b, y, rgb('#b89a4a'))
        for k in range(6):                                               # the cup holders let into the rail
            hx = px0 + 9 + k * (px1 - px0 - 18) // 5
            hy = py0 + 1 if k in (1, 2, 3, 4) else py1 - 2
            if k in (0, 5):
                hx = px0 + 2 if k == 0 else px1 - 2
                hy = (py0 + py1) // 2
            if k in (1, 4):
                continue
            c.px(hx, hy, rgb('#0a0604')); c.px(hx + 1, hy, rgb('#5a5a60'))
    mc.drop(px0 + 4, px1 - 4, py1 + 10, 0.4, 3)
    # (drawn over the far side's sitters only: whoever sits at its ends or on the near side is in front of it)
    mc.put_over(poker, py0 + 8)
    mc.block(px0, py0, px1, py1 + 9)
    mc.light(pcx, (py0 + py1) // 2, 44, 24, '#ffd890', 0.24)

    near = []
    for x in (pcx - 14, pcx + 14):                                       # the near side: stools, the sitters' backs to us
        near.append(len(L['seats']))
        L['seats'].append(dict(x=x, y=py1 + 13, ax=x, ay=py1 + 26, pose='back', flip=False, hit=[x - 9, py1 + 2, 18, 22]))
        mc.drop(x - 4, x + 4, py1 + 19, 0.3, 1)
        mc.put_over(lambda c, x=x: poker_stool(c, x, py1 + 8), py1 + 12)              # (in front of the table, behind its sitter)
        mc.block(x - 5, py1 + 9, x + 5, py1 + 15)
    ends = []
    for x, flip in ((px0 - 8, True), (px1 + 8, False)):                  # one at each end, side on
        mc.drop(x - 4, x + 4, py1 + 7, 0.3, 1)
        mc.put(base, lambda c, x=x: poker_stool(c, x, py1 - 3), shadow=True)
        mc.block(x - 5, py1 - 2, x + 5, py1 + 4)
        ends.append(len(L['seats']))
        L['seats'].append(dict(x=x, y=py1 + 3, ax=x + (-12 if flip else 12), ay=py1 + 12, pose='side', flip=flip, hit=[x - 8, py0 - 4, 16, py1 - py0 + 12]))
    # the game's seats, clockwise from the near left (as the big table is drawn): near left, left end, far left, far
    # right, right end, near right. `seats` are their numbers among the room's seats; the page draws the chips and
    # cards on the felt (`felt`), just over the table (z)
    fr = racetrack(px0, py0, px1, py1, 6)
    L['things']['holdem'] = dict(table=[px0, py0, px1 - px0 + 1, py1 - py0 + 1], felt=[px0 + 6, fr[0][0], px1 - px0 - 11, fr[-1][0] - fr[0][0] + 1],
                                 z=py0 + 9, seats=[near[0], ends[0], seat_at[0], seat_at[1], ends[1], near[1]])

    L['stands'] += [dict(x=150, y=152, face='right'), dict(x=100, y=228, face='right'), dict(x=286, y=244, face='left'),
                    dict(x=410, y=240, face='left'), dict(x=196, y=244, face='down'), dict(x=400, y=150, face='down')]

    # ── where the games put people: standing spots (seats with pose 'stand', `only`: nobody is put in one but by a game,
    #    and a click on the room never lands on one, its hit being empty), added last so the seats before keep their
    #    numbers (people's places are kept by number). things['gameSpots'] says which is which; the pages pick from them
    #    (client/src/basement/spots.ts): the player whose go it is, the other players, and whoever is watching. ──
    def spot(x, y, face, ax=None, ay=None):
        L['seats'].append(dict(x=x, y=y, ax=x if ax is None else ax, ay=y if ay is None else ay, pose='stand', flip=False, face=face, only=True, hit=[x, y, 0, 0]))
        return len(L['seats']) - 1
    bx, by_ = BOARD[0], 136
    fx, fy, fw, fh = FELT
    sx, sy, sl, sw2 = SHUFFLE
    lx0, lx1, foul = LANE['x0'], LANE['x1'], LANE['foul']
    bench = [k for k, q in enumerate(L['seats']) if q['y'] == foul + 56 and q['pose'] == 'back']       # the bowlers' bench (two)
    L['things']['gameSpots'] = dict(
        # darts: whoever is throwing on the oche, the others just behind it, watchers off to the sides; all face the board
        darts=dict(go=spot(bx, by_, 'up'), wait=[spot(bx - 18, by_ + 8, 'up'), spot(bx + 18, by_ + 8, 'up'), spot(bx + 32, by_ + 4, 'up')],
                   watch=[spot(bx + 50, by_ + 6, 'up'), spot(bx - 34, by_ + 6, 'up'), spot(bx + 64, by_ + 2, 'left'), spot(bx + 52, by_ + 14, 'left')]),
        # pool: cue 1 at the left end, cue 2 at the right, each facing the table; watchers round the rug
        pool=dict(play=[spot(fx - 22, fy + fh // 2 + 4, 'right'), spot(fx + fw + 16, fy + fh // 2 + 4, 'left')],
                  watch=[spot(fx + 8, fy + fh + 22, 'up'), spot(fx + fw - 8, fy + fh + 22, 'up'), spot(fx + fw // 2, fy + fh + 24, 'up'),
                         spot(fx + 10, fy - 16, 'down'), spot(fx + fw - 10, fy - 16, 'down')]),
        # shuffleboard: both players at the end it is thrown from, facing down the table, the one throwing at the end
        # itself; watchers along its far end and below it
        shuffle=dict(go=spot(sx - 16, sy + sw2 // 2 + 2, 'right'), wait=[spot(sx - 32, sy + sw2 + 14, 'right'), spot(sx - 32, sy - 12, 'right')],
                     watch=[spot(sx + sl - 30, sy + sw2 + 20, 'up'), spot(sx + sl - 60, sy + sw2 + 20, 'up'), spot(sx + sl // 2, sy + sw2 + 20, 'up')]),
        # bowling: the bowler on the approach facing the pins (stepping up onto it from in front of the console, the
        # approach being walled in by the ball return and the console); the others on the bench, then standing by it
        bowling=dict(go=spot((lx0 + lx1) // 2, foul + 12, 'up', (lx0 + lx1) // 2, foul + 40), wait=bench + [spot(lx0 - 28, foul + 44, 'right'), spot(lx0 - 28, foul + 58, 'right')],
                     watch=[spot(lx0 - 40, foul + 44, 'right'), spot(lx0 - 40, foul + 58, 'right'), spot(lx0 - 52, foul + 51, 'right')]),
        # hold'em: the players are in its chairs; watchers stand round the rug
        holdem=dict(watch=[spot(POKER[2] + 32, POKER[1] + 4, 'left'), spot(POKER[2] + 32, POKER[3] + 8, 'left'),
                           spot(POKER[0] - 6, POKER[3] + 30, 'up'), spot(POKER[2] + 6, POKER[3] + 32, 'up')]),
    )
