"""The karaoke lounge: the basement as a little karaoke bar. Black acoustic panels on the back wall, a dark carpet
flecked with neon confetti, a pink neon KARAOKE sign. Up against the back wall a low stage: a big screen on the wall
behind it (the page plays the Player's video on it: things['screen']), a PA speaker at each front corner, two spot
cans on a truss over it (the page lays their pool of light on the stage floor while somebody sings), and a board
beside the screen that lists who is up next (the page writes the names: things['board']). The mic stand is the page's
too, so the mic can be in it or in the singer's hand.

By the stairs a host stand with the song book and a sign-up tablet: a click on it is the sign-up (things['booth']).
The audience sits on two long benches facing the stage, and in three armchairs down the right-hand side.

The karaoke itself is client/src/basement/karaoke.tsx and server/basement/karaoke.ts: the songs are the Player's,
each tagged with who sings it."""

TITLE = 'Karaoke lounge'
BLURB = 'A stage, a big screen, the mic: sign up and sing'
ORDER = 30

SCREEN = (200, 16, 128, 72)          # the screen on the back wall: x, y, width, height (16:9)
STAGE = (146, 382, 140)              # the stage: left, right and its front edge (it runs back to the wall)
SPOT = (268, 124)                    # where the singer stands, facing us
MIC = (257, 126)                     # the mic stand's foot, to the singer's right (our left)
BOARD = (346, 18, 76, 66)            # the line-up board on the wall: x, y, width, height
BOOTH = (62, 86, 62, 34)             # the host stand: x, y, width, height (its top at y)


def draw(mc, L):
    rgb, mix, shade, tint, Mat, base = mc.rgb, mc.mix, mc.shade, mc.tint, mc.Mat, mc.base
    WALL, FLOOR_END = mc.WALL, mc.FLOOR_END
    hsh = mc.hsh

    # ── the carpet: deep navy pile flecked with confetti in neon colours (squiggles, dots and little bars) ──
    navy = rgb('#1c1a3a')
    confetti = [rgb('#ff4fb0'), rgb('#38d6e8'), rgb('#f6d84a'), rgb('#8a6cff')]
    for y in range(WALL, FLOOR_END + 1):
        for x in range(6, 522):
            if 6 <= x <= 43 and 148 <= y <= 226:
                continue                                                   # (the stairs, as the shell drew them)
            c = mc.pile(x, y, navy, 61)
            cx, cy = x // 9, y // 9
            h = hsh(cx, cy, 62)
            if h % 3 == 0:                                                 # one fleck in a third of the 9-dot squares
                ox, oy, kind = 1 + h % 6, 1 + (h >> 3) % 6, (h >> 6) % 4
                col = confetti[(h >> 8) % 4]
                dx, dy = x - cx * 9 - ox, y - cy * 9 - oy
                hit = (kind == 0 and dy == 0 and 0 <= dx <= 2) or (kind == 1 and dx == 0 and 0 <= dy <= 2) or \
                      (kind == 2 and (dx, dy) in ((0, 0), (1, 1), (2, 0), (3, 1))) or (kind == 3 and (dx, dy) in ((0, 0), (1, 0), (0, 1), (1, 1)))
                if hit:
                    c = mix(c, col, 0.62)
            if y < WALL + 6:
                c = shade(c, 0.4 - 0.06 * (y - WALL))                     # the wall's shadow along its foot
            if x < 10 or x > 517:
                c = shade(c, 0.2)
            base.px(x, y, c)

    # ── the back wall: black ceiling, then acoustic panels (dark fabric squares in a frame), a skirting at the foot ──
    panel = Mat('#2a2446', hi='#3a3360', lo='#1a1630', pat=mc.weave(63, 0.05))
    base.rect(6, 4, 521, WALL - 1, rgb('#141022'))
    base.rect(6, 4, 521, 9, rgb('#0b0914'))
    for px0 in range(8, 520, 32):
        for py0 in (11, 52):
            mc.put(base, lambda c, px0=px0, py0=py0: c.part(mc.rows(px0, py0, min(px0 + 29, 519), py0 + 38), panel, hi='tl', lo='rb', anchor=(0, 0)), edge=False)
    base.rect(6, WALL - 4, 521, WALL - 1, rgb('#0e0c18'))
    base.rect(6, WALL - 4, 521, WALL - 4, rgb('#3a3456'))

    # ── the truss across the top, and two spot cans on it aimed at the stage ──
    def truss(c):
        steel = Mat('#8a8e98', hi='#c8ccd4', lo='#4a4e58')
        c.part(mc.rows(STAGE[0], 6, STAGE[1], 7), steel, hi='t', lo='b')
        c.part(mc.rows(STAGE[0], 12, STAGE[1], 13), steel, hi='t', lo='b')
        for x in range(STAGE[0], STAGE[1], 6):                          # its zig-zag bracing
            for k in range(5):
                c.px(x + k, 7 + k, steel.lo if k % 2 else steel.base)
        for sx in (SCREEN[0] - 18, SCREEN[0] + SCREEN[2] + 10):            # the cans, either side of the screen, tipped down at the stage
            can = Mat('#24222a', hi='#4a4852', lo='#0e0c12')
            c.part(mc.rows(sx - 4, 13, sx + 4, 22), can, hi='tl', lo='rb')
            c.rect(sx - 5, 15, sx - 5, 17, can.hi); c.rect(sx + 5, 15, sx + 5, 17, can.lo)       # the yoke
            c.rect(sx - 3, 22, sx + 3, 23, rgb('#fff4c8')); c.rect(sx - 2, 23, sx + 2, 23, rgb('#ffffff'))   # the lens

    # ── the neon sign over the host stand ──
    def neon(c):
        text = 'KARAOKE'
        w = mc.sign_width(text, 2)
        x0 = BOOTH[0] + BOOTH[2] // 2 - w // 2
        mc.sign(c, x0, 30, text, 2, rgb('#ff4fb0'), core=rgb('#ffd0ec'), edge=rgb('#3a0a2a'))
    for y in range(24, 50):                                              # its glow on the panels behind it
        for x in range(BOOTH[0] - 22, BOOTH[0] + BOOTH[2] + 22):
            d = ((x - (BOOTH[0] + BOOTH[2] / 2)) / 60) ** 2 + ((y - 37) / 14) ** 2
            if d < 1 and base.get(x, y):
                base.px(x, y, mix(base.get(x, y), rgb('#ff4fb0'), 0.22 * (1 - d)))
    mc.put(base, neon, edge=False)
    mc.light(BOOTH[0] + BOOTH[2] // 2, 40, 64, 30, '#ff4fb0', 0.22)

    # ── the big screen on the wall behind the stage (the page plays the video in it) ──
    sx, sy, sw, sh = SCREEN

    def screen(c):
        bezel = Mat('#16161c', hi='#3a3a44', lo='#08080c')
        c.part(mc.rows(sx - 4, sy - 4, sx + sw + 3, sy + sh + 3), bezel, hi='tl', lo='rb')
        for y in range(sy, sy + sh):                                     # the glass, dark, a sheen down from its top left
            for x in range(sx, sx + sw):
                t = (x - sx) / sw * 0.4 + (y - sy) / sh * 0.6
                col = mix(rgb('#1a2848'), rgb('#0a0e1c'), t)
                if x - sx + (y - sy) * 2 < 22:
                    col = tint(col, 0.08)
                c.px(x, y, col)
        c.rect(sx + sw // 2 - 3, sy + sh + 4, sx + sw // 2 + 2, sy + sh + 5, bezel.lo)          # its wall mount
    mc.put(base, screen)
    mc.put(base, truss)                                                  # (the truss hangs in front of the screen's top)
    mc.light(sx + sw // 2, sy + sh // 2, sw // 2 + 30, sh // 2 + 24, '#5aa0ff', 0.18)
    L['things']['screen'] = list(SCREEN)

    # ── the line-up board on the wall beside it: a lit black board, its header in neon (the page writes the names) ──
    bx, by, bw, bh = BOARD

    def board(c):
        frame = Mat('#3a3456', hi='#5a5480', lo='#1a1630')
        c.part(mc.rows(bx, by, bx + bw - 1, by + bh - 1), frame, hi='tl', lo='rb')
        c.rect(bx + 2, by + 2, bx + bw - 3, by + bh - 3, rgb('#0c0a16'))
        w = mc.sign_width('LINE-UP', 1)
        mc.sign(c, bx + bw // 2 - w // 2, by + 4, 'LINE-UP', 1, rgb('#38d6e8'))
        c.rect(bx + 5, by + 13, bx + bw - 6, by + 13, rgb('#1e4a58'))
    mc.put(base, board)
    L['things']['board'] = [bx + 4, by + 15, bw - 8, bh - 19]

    # ── the stage: black boards, a step up at its front edge with a strip of warm lights along the lip ──
    x0, x1, front = STAGE
    deck = Mat('#24202e', hi='#3a3446', lo='#141018', pat=mc.grain(64, depth=0.08, knots=False))

    def stage(c):
        c.part(mc.rows(x0, WALL, x1, front - 5), deck, hi='', lo='', anchor=(0, 0))
        for y in range(WALL, front - 4, 8):
            c.rect(x0, y, x1, y, rgb('#120e18'))                         # the joins between its boards
        c.rect(x0, front - 5, x1, front - 5, rgb('#5a5270'))              # the nosing, catching the light
        c.part(mc.rows(x0, front - 4, x1, front), Mat('#18141e', hi='#2a2434', lo='#0a080e'), hi='t', lo='b')
        for x in range(x0 + 3, x1 - 1, 6):                                # the light strip along the lip
            c.px(x, front - 2, rgb('#ffcf6a')); c.px(x + 1, front - 2, rgb('#ffe9b0'))
        for yy in (x0, x1):                                               # its ends
            c.rect(yy, WALL, yy, front, rgb('#0a080e'))
    mc.put(base, stage, edge=False)
    mc.drop(x0, x1, front + 1, 0.4, 3)
    mc.pool((x0 + x1) // 2, front + 4, (x1 - x0) // 2, 8, '#ffcf6a', 0.12)  # the lip's lights on the carpet in front

    # ── a PA speaker at each front corner of the stage, standing on it (people pass behind them) ──
    for kx in (x0 + 4, x1 - 22):
        def speaker(c, kx=kx):
            box = Mat('#1e1c22', hi='#3a3842', lo='#0a090c')
            top = front - 40
            c.part(mc.rows(kx, top, kx + 18, front - 6), box, hi='tl', lo='rb')
            c.rect(kx + 2, top + 2, kx + 16, front - 8, rgb('#141218'))  # the grille
            for gy in range(top + 3, front - 8, 2):
                c.rect(kx + 3, gy, kx + 15, gy, rgb('#22202a'))
            for cy, r in ((top + 9, 4), (front - 17, 6)):                # the horn and the woofer behind it
                for yy in range(cy - r, cy + r + 1):
                    for xx in range(kx + 9 - r, kx + 9 + r + 1):
                        d = (xx - kx - 9) ** 2 + (yy - cy) ** 2
                        if d <= r * r:
                            c.px(xx, yy, rgb('#3a3842') if d > (r - 1) ** 2 else rgb('#0c0b10') if d > 4 else rgb('#4a4852'))
            c.rect(kx + 7, front - 7, kx + 11, front - 6, rgb('#5a5866'))  # its badge
        mc.put_over(speaker, front - 5, shadow=True)
        mc.block(kx, front - 14, kx + 18, front - 6)

    # ── the host stand by the stairs: a podium with the song book open on it and the sign-up tablet ──
    hx, hy, hw, hh = BOOTH

    def booth(c):
        wood = Mat('#3a2440', hi='#5a3a62', lo='#20122a', pat=mc.grain(65, depth=0.1))
        c.part(mc.rows(hx, hy, hx + hw - 1, hy + 7), Mat('#4a3052', hi='#6a4a74', lo='#2a1832'), hi='tl', lo='rb')      # its top
        c.part(mc.rows(hx + 2, hy + 8, hx + hw - 3, hy + hh - 1), wood, hi='l', lo='rb', anchor=(0, 0))                  # its front
        c.rect(hx + 2, hy + 8, hx + hw - 3, hy + 8, rgb('#1a0e20'))
        c.rect(hx + 4, hy + 12, hx + hw - 5, hy + 12, rgb('#ff4fb0'))   # a neon line along its front
        w = mc.sign_width('SIGN UP', 1)
        mc.sign(c, hx + hw // 2 - w // 2, hy + 16, 'SIGN UP', 1, rgb('#f6d84a'))
        # the song book, open: two cream pages with lines of song titles, a red cover showing round them
        c.rect(hx + 6, hy + 1, hx + 31, hy + 6, rgb('#8a1c2a'))
        c.rect(hx + 7, hy + 1, hx + 18, hy + 5, rgb('#f2ead6')); c.rect(hx + 19, hy + 1, hx + 30, hy + 5, rgb('#e6dcc4'))
        for ly in (hy + 2, hy + 4):
            c.rect(hx + 8, ly, hx + 16, ly, rgb('#9a8e78')); c.rect(hx + 20, ly, hx + 28, ly, rgb('#9a8e78'))
        # the tablet on a little stand, lit
        c.rect(hx + 38, hy - 6, hx + 55, hy + 4, rgb('#101014'))
        c.rect(hx + 39, hy - 5, hx + 54, hy + 3, rgb('#2a6a8a'))
        for ly in range(hy - 4, hy + 3, 2):
            c.rect(hx + 41, ly, hx + 41 + (ly * 7) % 9 + 3, ly, rgb('#9ae0f0'))
        c.rect(hx + 45, hy + 4, hx + 48, hy + 6, rgb('#2a2a30'))
    mc.drop(hx, hx + hw - 1, hy + hh, 0.35, 3)
    mc.put(base, booth, shadow=True)
    mc.block(hx, hy, hx + hw - 1, hy + hh - 1)
    mc.light(hx + 46, hy - 1, 20, 14, '#5ac8f0', 0.16)
    L['things']['booth'] = [hx, hy - 7, hw, hh + 7]
    L['things']['boothStand'] = [hx + hw // 2, hy + hh + 10]

    # ── the audience: two long benches facing the stage, and armchairs down the right-hand side, each with a little table beside it ──
    velvet = Mat('#6a1a4a', hi='#8a2a62', lo='#40102c')
    L['things']['audience'] = []
    for by_ in (196, 262):
        n0 = len(L['seats'])
        mc.back_bench(SPOT[0] - 51, by_, 4, velvet)
        L['things']['audience'] += list(range(n0, len(L['seats'])))
    chair = Mat('#2a4a6a', hi='#3a6a8a', lo='#1a2a40')
    for cy in (150, 206, 262):
        n0 = len(L['seats'])
        mc.side_chair(464, cy, False, chair)
        L['things']['audience'] += list(range(n0, len(L['seats'])))

        def side_table(c, cy=cy):
            top = Mat('#2a2434', hi='#4a4258', lo='#141018')
            c.part(mc.ellipse(502, cy + 14, 6, 3), top, hi='tl', lo='rb')
            c.rect(501, cy + 17, 502, cy + 26, rgb('#141018'))
            c.rect(497, cy + 27, 506, cy + 28, rgb('#141018'))
            c.rect(500, cy + 11, 501, cy + 13, rgb('#e8f4ff')); c.px(500, cy + 10, rgb('#ff4fb0'))     # a drink on it
        mc.put_over(side_table, cy + 28, shadow=True)
        mc.block(496, cy + 18, 507, cy + 28)

    # ── where the singer stands (a seat nobody is put in but by the karaoke: `only`, no hit), and where to stand about ──
    L['seats'].append(dict(x=SPOT[0], y=SPOT[1], ax=SPOT[0], ay=SPOT[1] + 22, pose='stand', flip=False, face='down', only=True, hit=[SPOT[0], SPOT[1], 0, 0]))
    L['things']['stage'] = len(L['seats']) - 1
    L['things']['spot'] = list(SPOT)
    L['things']['mic'] = list(MIC)
    L['things']['pool'] = [SPOT[0] - 3, SPOT[1] + 1, 26, 9]
    L['stands'] += [dict(x=180, y=160, face='up'), dict(x=350, y=160, face='up'), dict(x=120, y=240, face='right'),
                    dict(x=400, y=300, face='up'), dict(x=160, y=300, face='up')]
    mc.light(SPOT[0], 60, 140, 70, '#8a6cff', 0.12)
