"""The basement as it came with the house: bare concrete, a bare bulb on a pull chain, the washer and dryer, the water
heater and furnace in the far corner, a workbench under a pegboard, steel shelving full of boxes, two red lally columns
holding the house up, and the old plaid couch nobody could get rid of, facing a tube TV on a milk crate with a GameCube
hooked up to it.

Drawn to the people's scale, about 8 dots to a foot: the couch seats three, the washer and dryer are 27 inches wide, the
TV a 20-inch tube."""
import math

TITLE = 'Unfinished basement'
BLURB = 'Bare bulb, old couch, the laundry'
ORDER = 90
VIGNETTE = 0.08

BULB = (300, 150)


def box3(mc, c, x0, top, x1, bot, depth, top_mat, front_mat, anchor=None):
    """A box seen from above and in front, as everything in the room is: its top, then its front face down to the floor,
    with the edge between them lit and a line of shade under it."""
    c.part(mc.rows(x0, top, x1, top + depth - 1), top_mat, hi='tl', lo='r', anchor=anchor)
    c.part(mc.rows(x0, top + depth, x1, bot), front_mat, hi='l', lo='rb', anchor=anchor)
    c.rect(x0 + 1, top + depth - 1, x1 - 1, top + depth - 1, top_mat.hi)
    c.rect(x0 + 1, top + depth, x1 - 1, top + depth, front_mat.lo)


def carton(mc, c, x0, y0, w, h, d, card, card_front, tape, seed=0):
    """A cardboard moving box: its top with the flaps meeting down the middle under tape, its front with the tape running
    down it, a scrawled label, the corners crushed a little."""
    rgb, shade, tint = mc.rgb, mc.shade, mc.tint
    box3(mc, c, x0, y0, x0 + w, y0 + h, d, card, card_front)
    mid = x0 + w // 2
    c.rect(mid - 1, y0, mid + 1, y0 + d - 1, tape); c.rect(mid - 1, y0, mid - 1, y0 + d - 1, tint(tape, 0.3))
    c.rect(mid, y0 + d, mid, y0 + d + 3, tape)
    c.rect(x0 + 2, y0 + d + 3, x0 + 2 + min(7, w // 2 - 3), y0 + d + 3, rgb('#3a2a1a'))      # what is in it, in marker
    c.rect(x0 + 2, y0 + d + 5, x0 + 1 + min(5, w // 2 - 4), y0 + d + 5, rgb('#3a2a1a'))
    c.px(x0 + w - 1, y0 + d + 1, shade(card_front.base, 0.2)); c.px(x0 + 1, y0 + h - 1, shade(card_front.base, 0.15))
    if seed % 2:
        c.rect(x0 + w - 5, y0 + h - 4, x0 + w - 2, y0 + h - 2, rgb('#e8e2d0'))               # a shipping label
        c.px(x0 + w - 4, y0 + h - 3, rgb('#3a3a3a'))


def draw(mc, L):
    rgb, mix, shade, tint, Mat, base = mc.rgb, mc.mix, mc.shade, mc.tint, mc.Mat, mc.base
    white = Mat('#e8e9ec', hi='#ffffff', lo='#a9adb6')
    steel = Mat('#8e949c', hi='#b9bec6', lo='#5d636b')
    card = Mat('#b98a56', hi='#d3a670', lo='#87603a')
    card_front = Mat('#a47848', hi='#bd915e', lo='#74522e')
    tape = rgb('#d9c79a')
    pine = Mat('#c49a62', hi='#e0bb82', lo='#8a6a3e', pat=mc.grain(3))

    # ── against the back wall ──
    def panel(c):                                                  # the breaker panel, at chest height, and its conduit up into the joists
        c.part(mc.rows(58, 64, 70, 82), steel, hi='tl', lo='rb')
        c.rect(59, 65, 69, 65, tint(steel.hi, 0.3))
        c.part(mc.rows(60, 67, 68, 79), Mat('#6b7178', hi='#7d838b', lo='#50555c'), hi='tl', lo='rb')
        for y in range(68, 79, 2):
            c.rect(61, y, 63, y, rgb('#2b2d33')); c.rect(65, y, 67, y, rgb('#2b2d33'))
            c.px(61, y, rgb('#d8dce2')); c.px(67, y, rgb('#d8dce2'))
        c.rect(69, 70, 69, 73, rgb('#3a3d44'))                                     # its latch
        c.rect(60, 80, 64, 81, rgb('#e8e2c8'))                                     # the label on the door
        c.rect(64, 8, 64, 63, rgb('#9aa0a8')); c.rect(65, 8, 65, 63, rgb('#6a7078')); c.rect(63, 8, 63, 63, rgb('#c8ccd2'))
        for y in (16, 32, 48):
            c.rect(62, y, 66, y, rgb('#5a5e66'))                                   # the straps holding the conduit
    mc.put(base, panel)

    def pegboard(c):
        c.part(mc.rows(84, 50, 126, 74), Mat('#a7865e', hi='#c4a27a', lo='#7a5f40'), hi='tl', lo='rb')
        c.rect(84, 50, 126, 50, rgb('#8a6a48')); c.rect(84, 74, 126, 74, rgb('#5a4430'))   # its frame of furring strip
        for y in range(52, 73, 3):
            for x in range(86, 125, 3):
                c.px(x, y, rgb('#6a5236'))
        sh = lambda x0, y0, x1, y1: [c.px(x, y, shade(c.get(x, y), 0.25)) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1) if c.get(x, y)]
        sh(90, 55, 91, 67); sh(97, 56, 97, 67); sh(103, 59, 115, 59); sh(115, 55, 115, 58)  # the tools' shadows on the board
        c.rect(89, 56, 89, 66, rgb('#c23b3b')); c.px(89, 66, rgb('#7a2020')); c.rect(88, 53, 90, 55, rgb('#5a5e66')); c.px(88, 53, rgb('#9aa0a8'))  # a hammer
        c.rect(96, 61, 96, 66, rgb('#e2b23a')); c.px(96, 61, rgb('#f8e08a')); c.rect(96, 55, 96, 60, rgb('#b8bec6'))   # a screwdriver
        c.part(mc.rows(102, 54, 114, 58), steel, hi='t', lo='b')                            # a saw
        for x in range(102, 115, 2):
            c.px(x, 58, rgb('#4a4e56'))
        c.rect(110, 54, 114, 56, rgb('#8a5a30')); c.rect(111, 55, 113, 55, rgb('#5a3418'))
        c.part(mc.ellipse(120, 64, 3, 3), Mat('#2f8a4a', hi='#4fb06a', lo='#1d5a30'))       # a coil of extension cord
        c.px(120, 64, rgb('#6a5236')); c.px(119, 62, rgb('#6fd08a'))
        c.rect(105, 64, 108, 70, rgb('#3a3d44')); c.rect(106, 65, 107, 69, rgb('#c8ccd2'))  # a tape measure
        c.rect(105, 64, 108, 64, rgb('#e2b23a'))
    mc.put(base, pegboard)

    def bench(c):
        box3(mc, c, 82, 86, 128, 106, 5, pine, Mat('#7a5a38', hi='#93704a', lo='#4f3a24', pat=mc.grain(5, depth=0.1)), anchor=(0, 0))
        for x0 in (86, 106):                                                             # two drawers with pulls
            c.part(mc.rows(x0, 93, x0 + 16, 100), Mat('#6a4c2e', hi='#8a6a48', lo='#3f2c1a'), hi='tl', lo='rb')
            c.rect(x0 + 6, 96, x0 + 10, 96, rgb('#c8ccd2')); c.rect(x0 + 6, 97, x0 + 10, 97, rgb('#5a5e66'))
        c.rect(84, 102, 126, 102, rgb('#5d4430'))
        c.part(mc.rows(88, 82, 96, 86), Mat('#3a6fb0', hi='#5a8fd0', lo='#244a7a'))         # a drill case
        c.rect(90, 84, 94, 84, rgb('#1a2a4a')); c.px(89, 83, rgb('#8ab4ee'))
        c.part(mc.rows(112, 83, 118, 86), Mat('#c7c1b2', hi='#e8e2d4', lo='#8a8476'))        # a coffee can of screws
        c.rect(112, 84, 118, 84, rgb('#c23b3b'))
        c.part(mc.rows(122, 83, 127, 86), Mat('#4a4e56', hi='#6a6e76', lo='#2a2c30'))       # the vise on its corner
        c.rect(123, 81, 126, 82, rgb('#6a6e76'))
    mc.drop(83, 127, 107, 0.3, 2)
    mc.put(base, bench, shadow=True)
    mc.block(82, 92, 128, 106)

    def shelving(c):
        for x in (148, 180):
            c.part(mc.rows(x, 46, x + 1, 106), steel, hi='l', lo='r')
            for y in range(48, 104, 3):
                c.px(x, y, rgb('#4a4e56'))                                       # the slots in the uprights
        for y in (62, 78, 94, 104):
            c.part(mc.rows(148, y, 181, y + 1), steel, hi='t', lo='b')
            c.rect(150, y + 2, 179, y + 2, shade(rgb('#8d8a84'), 0.4))            # each shelf's shadow on the wall
        for k, (x, y, w, h, kind) in enumerate(((151, 62, 12, 9, 'tub'), (165, 62, 13, 8, 'box'), (150, 78, 11, 8, 'box'),
                                                (163, 78, 15, 9, 'tub'), (152, 94, 14, 9, 'tub'), (168, 94, 10, 7, 'box'))):
            if kind == 'box':
                carton(mc, c, x, y - h, w, h - 1, 3, card, card_front, tape, k)
            else:
                c.part(mc.rows(x, y - h + 2, x + w, y - 1), Mat('#4a6a9a', hi='#6a8aba', lo='#2f4a72'), hi='tl', lo='rb')
                c.part(mc.rows(x - 1, y - h, x + w + 1, y - h + 1), Mat('#dfe4ea', hi='#ffffff', lo='#a8b0ba'), hi='t', lo='b')   # its lid
                c.rect(x + 2, y - h + 4, x + w - 2, y - h + 4, rgb('#8aa8d0'))                 # the light on the plastic
                c.rect(x + w // 2 - 2, y - h + 6, x + w // 2 + 2, y - h + 6, rgb('#2a3a5a'))  # a handle
    mc.drop(147, 183, 107, 0.3, 2)
    mc.put(base, shelving, shadow=True)
    mc.block(146, 96, 184, 106)

    def laundry(c):
        for x0, kind in ((368, 'washer'), (390, 'dryer')):
            box3(mc, c, x0, 78, x0 + 20, 106, 6, white, Mat('#dadce1', hi='#f2f3f5', lo='#9da2ab'))
            c.rect(x0 + 1, 79, x0 + 19, 80, rgb('#5a5e66'))                                  # the control strip
            c.rect(x0 + 1, 79, x0 + 19, 79, rgb('#7a7e86'))
            c.px(x0 + 4, 79, rgb('#5ad06a')); c.px(x0 + 16, 79, rgb('#e0b040'))
            c.part(mc.ellipse(x0 + 10, 80, 2, 1), Mat('#c8ccd2', hi='#ffffff'))              # the dial
            c.part(mc.ellipse(x0 + 10, 95, 6, 6), Mat('#9aa0a8', hi='#e2e6ea', lo='#5d636b'), hi='tl', lo='rb')
            c.part(mc.ellipse(x0 + 10, 95, 4, 4), Mat('#3d4a5a' if kind == 'washer' else '#2c2f36', hi='#6a8aaa' if kind == 'washer' else '#4a4e56', lo='#1a1e26'), hi='tl', lo='rb')
            c.px(x0 + 8, 93, rgb('#e8f0f8')); c.px(x0 + 9, 93, rgb('#a8c0d8')); c.px(x0 + 8, 94, rgb('#a8c0d8'))   # a glint on the glass
            if kind == 'washer':
                c.px(x0 + 11, 97, rgb('#6a8ab0')); c.px(x0 + 12, 96, rgb('#8a5a6a'))           # clothes inside
            c.rect(x0 + 2, 104, x0 + 18, 104, rgb('#b8bcc4'))                                 # the kick plate
        c.rect(398, 62, 404, 77, rgb('#b0b4ba'))                                             # the dryer's vent hose up the wall
        for y in range(62, 78, 2):
            c.rect(398, y, 404, y, rgb('#d0d4da')); c.px(404, y + 1, rgb('#80848a'))
        c.part(mc.ellipse(354, 104, 8, 5), Mat('#4a90c8', hi='#7ab4e0', lo='#2a6090'))      # a laundry basket beside them
        for x in range(348, 361, 3):
            c.rect(x, 104, x, 107, rgb('#2a6090'))
        c.part(mc.ellipse(354, 102, 6, 3), Mat('#e7e2d6', hi='#ffffff', lo='#b5ae9e'))
        c.rect(351, 101, 353, 102, rgb('#c86a6a')); c.rect(356, 102, 358, 103, rgb('#6a8ab0'))
    mc.drop(345, 412, 107, 0.3, 2)
    mc.put(base, laundry, shadow=True)
    mc.block(344, 96, 412, 108)

    def utilities(c):
        tank = Mat('#d8d4c8', hi='#f4f0e6', lo='#8e8a7e')
        mc.cyl(c, 446, 60, 462, 108, tank)                                                   # the water heater
        c.part(mc.ellipse(454, 60, 8, 3), Mat('#e4e0d4', hi='#ffffff', lo='#aaa69a'))
        c.rect(450, 36, 450, 58, rgb('#b8743c')); c.rect(449, 36, 449, 58, rgb('#e09a5a'))
        c.rect(458, 36, 458, 58, rgb('#9aa0a8')); c.rect(457, 36, 457, 58, rgb('#c8ccd2'))
        c.rect(447, 50, 451, 52, rgb('#b8743c')); c.rect(456, 44, 460, 46, rgb('#7a8088'))   # the fittings
        c.part(mc.rows(449, 70, 459, 80), Mat('#f4eedc', hi='#ffffff', lo='#c8c2b0'))       # the sticker
        for y in (72, 74, 76, 78):
            c.rect(450, y, 457 - (y % 4), y, rgb('#8a8676'))
        c.rect(451, 96, 457, 101, rgb('#3a3d44')); c.px(454, 98, rgb('#ff8a3a')); c.px(453, 98, rgb('#ffd08a'))
        c.rect(446, 107, 462, 108, rgb('#6a665a'))
        furnace = Mat('#5f6670', hi='#7d8590', lo='#3e434b')
        c.part(mc.rows(468, 52, 492, 108), furnace, hi='l', lo='r')                          # the furnace
        c.rect(469, 52, 491, 52, rgb('#8a929c'))
        for y in range(62, 76, 3):
            c.rect(471, y, 489, y, rgb('#3a3e46')); c.rect(471, y + 1, 489, y + 1, rgb('#7d8590'))   # louvres, lit along their lips
        c.part(mc.rows(471, 84, 489, 102), Mat('#4c525b', hi='#626872', lo='#363b42'), hi='tl', lo='rb')   # the burner door
        c.rect(479, 92, 481, 93, rgb('#2a2c30')); c.px(480, 90, rgb('#ff7a2a'))
        c.rect(470, 80, 476, 81, rgb('#e8e2c8'))
        mc.cyl(c, 474, 8, 486, 51, Mat('#a8adb4', hi='#dfe3e8', lo='#6f747b'))                # its duct up into the joists
        for y in (20, 38):
            c.rect(474, y, 486, y, rgb('#7f848b'))
        c.rect(474, 51, 486, 51, rgb('#5f646b'))
    mc.drop(445, 494, 109, 0.32, 2)
    mc.put(base, utilities, shadow=True)
    mc.block(444, 96, 494, 108)

    # ── the floor ──
    def drain(c):
        c.part(mc.ellipse(334, 272, 3, 2), Mat('#5a5e66', hi='#7a7e86', lo='#3a3d44'))
        for dx in (-2, 0, 2):
            c.px(334 + dx, 272, rgb('#2a2c30'))
    mc.put(base, drain, edge=False)
    for cx, cy, rx, ry in ((300, 300, 14, 5), (120, 230, 10, 4), (440, 170, 8, 3), (334, 270, 18, 7)):    # old stains on the slab
        for y, x0, x1 in mc.ellipse(cx, cy, rx, ry):
            for x in range(x0, x1 + 1):
                d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2
                if (x * 7 + y * 3) % 5 or d > 0.8:
                    base.px(x, y, shade(base.get(x, y), 0.1 if d > 0.8 else 0.06))   # darker at the tide line

    def rag_rug(c):                                                # a braided rag rug between the couch and the TV
        cols = [rgb(h) for h in ('#8a4a4a', '#5a6a8a', '#b8a070', '#6a7a5a', '#9a6a8a')]
        for y, x0, x1 in mc.ellipse(264, 220, 48, 22):
            for x in range(x0, x1 + 1):
                r = math.sqrt(((x - 264) / 48) ** 2 + ((y - 220) / 22) ** 2)
                ring = int(r * 16)
                col = cols[ring % len(cols)]
                ang = math.atan2((y - 220) * 2.2, x - 264)
                braid = (int(ang * 18 + ring * 2) % 3)                    # the braid's plaits, slanting round each ring
                col = tint(col, 0.12) if braid == 0 else shade(col, 0.16) if braid == 2 else col
                if (r * 16) % 1 < 0.18:
                    col = shade(col, 0.25)                                 # the stitching between rings
                if r > 0.93:
                    col = shade(col, 0.2)
                c.px(x, y, col)
    for y, x0, x1 in mc.ellipse(265, 222, 48, 22):                     # its shadow on the slab
        for x in range(x0, x1 + 1):
            base.px(x, y, shade(base.get(x, y), 0.25))
    mc.put(base, rag_rug, edge=False)

    # The TV: a 20-inch tube on a milk crate, facing the room, with a GameCube on the floor in front of it and two wired
    # controllers trailing back to the couch (the page draws those, and what is on the screen: unfinished.tsx).
    SCR = [255, 172, 18, 12]

    def tv(c):
        c.part(mc.rows(253, 187, 275, 198), Mat('#c23b3b', hi='#e05a5a', lo='#8a2424'), hi='tl', lo='rb')      # the crate
        for x in range(256, 274, 3):
            c.rect(x, 190, x + 1, 196, rgb('#5a1414')); c.px(x, 190, rgb('#3a0a0a'))
        c.rect(254, 188, 274, 188, rgb('#f07070'))
        c.part(mc.rows(251, 168, 277, 187), Mat('#4a4a52', hi='#6a6a74', lo='#2a2a30'), hi='tl', lo='rb')      # the set
        c.rect(252, 169, 276, 169, rgb('#7a7a86'))
        c.rect(SCR[0] - 2, SCR[1] - 2, SCR[0] + SCR[2] + 1, SCR[1] + SCR[3] + 1, rgb('#2e2e34'))
        c.rect(SCR[0] - 1, SCR[1] - 1, SCR[0] + SCR[2], SCR[1] + SCR[3], rgb('#1a1a1e'))
        c.rect(SCR[0], SCR[1], SCR[0] + SCR[2] - 1, SCR[1] + SCR[3] - 1, rgb('#20283a'))
        for y in range(172, 186, 2):
            c.rect(274, y, 276, y, rgb('#36363c'))                                                         # the speaker grille
        c.px(275, 174, rgb('#9aa0a8')); c.px(275, 177, rgb('#9aa0a8')); c.px(275, 183, rgb('#e04040'))
        c.rect(253, 185, 257, 185, rgb('#8a8a94'))                                                         # the maker's badge
        c.part(mc.rows(254, 164, 272, 167), Mat('#3a3a42', hi='#55555e', lo='#24242a'), hi='t', lo='')     # the tube's hump behind
        for x, top in ((258, 160), (268, 161)):                                                            # rabbit ears
            c.rect(x, top, x, 167, rgb('#c8ccd2')); c.px(x, top, rgb('#ffffff'))
        c.part(mc.ellipse(263, 166, 3, 1), Mat('#2a2a30', hi='#4a4a52'))
    mc.drop(252, 276, 199, 0.32, 2)
    mc.put_over(tv, 198, shadow=True)
    mc.block(251, 168, 277, 198)
    L['things']['screen'] = SCR

    indigo = Mat('#6a5acd', hi='#8f80ee', lo='#43379a')
    deep = Mat('#4a3c9e', hi='#6a5acd', lo='#2c2268')

    def console(c):                                                # the little purple cube
        c.part(mc.rows(260, 201, 268, 204), indigo, hi='tl', lo='r')
        c.part(mc.rows(260, 205, 268, 208), deep, hi='l', lo='rb')
        c.rect(261, 200, 267, 200, rgb('#2c2268'))                                                          # the handle
        c.px(264, 202, rgb('#3a2e88')); c.px(263, 202, rgb('#b8b0f0'))                                      # the disc lid
        for k in range(4):
            c.px(261 + k * 2, 207, rgb('#191430'))                                                          # the ports
        c.px(267, 205, rgb('#5ad06a'))
    mc.put(base, console, shadow=True)
    L['things']['pads'] = [dict(port=[263, 208], rest=[240, 226], color='indigo'), dict(port=[265, 208], rest=[282, 228], color='black')]

    # the old couch: a plaid of olive, with mustard and rust lines crossing
    def plaid_pat(x, y, col, mat):
        c = col
        if x % 8 in (0, 1) or y % 8 in (0, 1):
            c = mix(c, rgb('#c8a050'), 0.3)
        if x % 8 == 4 or y % 8 == 4:
            c = mix(c, rgb('#8a3a2a'), 0.35)
        if x % 8 in (0, 1) and y % 8 in (0, 1):
            c = mix(c, rgb('#d8b060'), 0.25)
        return shade(c, 0.06) if (x + y) % 2 else c
    plaid = Mat('#6a7a4a', hi='#8a9a62', lo='#4a5632', pat=plaid_pat)
    green = Mat('#5a683c', hi='#7a8a52', lo='#3c4628', pat=plaid_pat)
    cush = Mat('#76864e', hi='#94a468', lo='#56643a', pat=plaid_pat)

    def couch_seat(c):                                             # the old plaid couch, turned to face the TV: its seat...
        c.part(mc.rows(234, 240, 294, 250), plaid, hi='t', lo='b', anchor=(0, 0))
        for x0 in (236, 256, 276):
            c.part(mc.rows(x0, 241, x0 + 17, 249), cush, hi='t', lo='b', anchor=(0, 0))
            c.rect(x0 + 2, 242, x0 + 15, 242, tint(cush.hi, 0.2))
            c.rect(x0 + 6, 246, x0 + 11, 246, shade(cush.base, 0.18))                 # the dip where people sit
        c.px(262, 244, rgb('#e8c060')); c.px(281, 247, rgb('#3a3a3a'))                 # a lost coin, a lost remote
    mc.put(base, couch_seat, shadow=True)

    def couch_back(c):                                             # ...and its back, in front of whoever sits on it
        c.part(mc.rows(234, 250, 294, 262), green, hi='t', lo='b', anchor=(0, 0))
        c.rect(235, 251, 293, 251, tint(green.hi, 0.15))
        c.rect(235, 255, 293, 255, green.lo); c.rect(235, 256, 293, 256, tint(green.base, 0.1))   # the seam across the back
        c.rect(244, 258, 250, 260, shade(green.base, 0.2)); c.rect(245, 259, 249, 259, rgb('#8a7a5a'))  # a patched tear
        for x0 in (230, 294):                                       # the arms
            c.part(mc.rows(x0, 238, x0 + 5, 262), green, hi='tl', lo='rb', anchor=(0, 0))
            c.rect(x0 + 1, 239, x0 + 4, 240, tint(green.hi, 0.2))
        for lx in (232, 296):
            c.rect(lx, 262, lx + 1, 263, rgb('#2a1a10'))
    mc.put_over(couch_back, 262, shadow=True)
    mc.drop(231, 299, 264, 0.3, 2)
    mc.block(230, 240, 299, 262)
    for x in (244, 264, 284):                                       # sat well back, playing (facing the TV, a controller in hand)
        L['seats'].append(dict(x=x, y=254, ax=x, ay=232, pose='back', flip=False, game=True, hit=[x - 10, 232, 20, 32]))
    L['things']['couch'] = [0, 1, 2]

    def column(x):
        def f(c):
            mc.cyl(c, x, 186, x + 2, 260, Mat('#b8322e', hi='#f06058', lo='#7a1e1c'))
            c.part(mc.rows(x - 1, 184, x + 3, 186), Mat('#6a6e76', hi='#9aa0a8', lo='#44484e'), hi='t', lo='b')
            c.part(mc.rows(x - 2, 259, x + 4, 262), Mat('#6a6e76', hi='#9aa0a8', lo='#44484e'), hi='t', lo='b')
            c.px(x - 1, 261, rgb('#2a2c30')); c.px(x + 3, 261, rgb('#2a2c30'))                     # bolts in its foot plate
            for y in range(200, 255, 13):
                c.px(x + 2, y, rgb('#8a2420'))                                                   # chips in the paint
        return f
    for x in (150, 386):
        mc.drop(x - 2, x + 8, 263, 0.3, 2)
        mc.put_over(column(x), 262)
        mc.block(x - 2, 256, x + 4, 262)

    def camp_chair(c):                                              # a folding camp chair, facing us (clear of the column, which is drawn over anything it overlaps)
        tube = rgb('#3a3d44')
        c.part(mc.rows(161, 257, 177, 272), Mat('#2a5a8a', hi='#4a7aaa', lo='#1a3a5a'), hi='tl', lo='rb')      # its back
        for y in (262, 267):
            c.rect(163, y, 175, y, rgb('#24507a'))                                                          # sagging folds
        c.rect(165, 259, 173, 260, rgb('#e8e8e8')); c.rect(166, 259, 167, 260, rgb('#c23b3b'))               # the brand tag
        c.part(mc.rows(160, 272, 178, 280), Mat('#24507a', hi='#3a6a9a', lo='#163250'), hi='t', lo='b')        # its seat
        c.rect(162, 276, 176, 276, rgb('#1d4268'))
        c.rect(160, 257, 160, 290, tube); c.rect(178, 257, 178, 290, tube)
        c.px(160, 257, rgb('#7a7e86')); c.px(178, 257, rgb('#7a7e86'))
        for k in range(8):                                                                                  # the crossed legs
            c.px(162 + k * 2, 282 + k, tube); c.px(176 - k * 2, 282 + k, tube)
        c.part(mc.rows(179, 277, 182, 282), Mat('#2a5a8a', hi='#4a7aaa', lo='#1a3a5a'))                      # the cup holder
        c.rect(179, 274, 181, 278, rgb('#c23b3b')); c.rect(179, 274, 181, 274, rgb('#d8dce2')); c.px(179, 276, rgb('#f07070'))   # a can in it
    mc.drop(159, 183, 291, 0.3, 2)
    mc.put(base, camp_chair, shadow=True)
    mc.block(161, 270, 177, 284)
    L['seats'].append(dict(x=169, y=286, ax=169, ay=298, pose='front', flip=False, hit=[159, 266, 20, 24]))

    def bucket(c):                                                  # an upturned five-gallon bucket for a stool
        mc.cyl(c, 355, 274, 365, 288, Mat('#e07a2a', hi='#ffb070', lo='#a4521a'))
        for y in (279, 285):
            c.rect(355, y, 365, y, rgb('#c4621a'))                                                         # its ribs
        c.part(mc.ellipse(360, 274, 5, 2), Mat('#f09a4a', hi='#ffba6a', lo='#c46a2a'))
        c.rect(357, 281, 362, 283, rgb('#f8f0e0')); c.rect(358, 282, 361, 282, rgb('#e07a2a'))             # the store's label
        c.px(355, 280, rgb('#9aa0a8')); c.px(365, 280, rgb('#9aa0a8'))                                     # the handle's lugs
    mc.drop(355, 366, 289, 0.3, 2)
    mc.put(base, bucket, shadow=True)
    mc.block(355, 274, 365, 286)
    L['seats'].append(dict(x=360, y=288, ax=360, ay=300, pose='front', flip=False, hit=[352, 268, 16, 22]))

    def boxes(c):                                                   # moving boxes nobody unpacked, stacked in the corner
        for k, (x0, y0, w, h, d) in enumerate(((474, 278, 18, 20, 5), (494, 282, 18, 16, 5), (480, 262, 16, 16, 4), (300, 112, 16, 12, 4), (318, 116, 12, 9, 3))):
            carton(mc, c, x0, y0, w, h, d, card, card_front, tape, k)
    for x0, x1, y in ((474, 512, 299), (300, 330, 125)):
        mc.drop(x0, x1, y, 0.3, 2)
    mc.put(base, boxes, shadow=True)
    mc.block(474, 262, 512, 298)
    mc.block(300, 112, 330, 125)

    def clutter(c):
        box3(mc, c, 304, 236, 318, 256, 4, white, Mat('#d0d2d8', hi='#eceef2', lo='#9a9ea8'))            # a mini fridge by the couch
        c.rect(305, 244, 317, 244, rgb('#9a9ea8')); c.rect(315, 246, 315, 250, rgb('#5a5e66')); c.px(315, 246, rgb('#e8eaee'))
        c.rect(306, 252, 309, 253, rgb('#3a7ac8'))                                                          # a magnet
        c.rect(307, 233, 309, 235, rgb('#c23b3b')); c.rect(307, 233, 309, 233, rgb('#d8dce2'))              # cans on top
        c.rect(312, 233, 313, 235, rgb('#3a7a3a')); c.rect(312, 233, 313, 233, rgb('#d8dce2'))
        box3(mc, c, 418, 98, 430, 112, 3, Mat('#e0e2e8', hi='#ffffff', lo='#a0a4ac'), Mat('#c8cad2', hi='#e0e2e8', lo='#8a8e98'))   # a dehumidifier
        for y in range(103, 106):
            c.rect(420, y, 428, y, rgb('#5a5e66') if y % 2 else rgb('#8a8e98'))
        c.px(427, 107, rgb('#5ad06a'))
        for k, (x0, col) in enumerate(((54, '#b02a2a'), (74, '#2a7a3a'), (62, '#b02a2a'))):           # holiday totes, red and green
            y0 = 300 if k < 2 else 290
            cc = rgb(col)
            box3(mc, c, x0, y0, x0 + 18, y0 + 12, 4, Mat(tint(cc, 0.15), hi=tint(cc, 0.4), lo=shade(cc, 0.25)), Mat(shade(cc, 0.15), hi=cc, lo=shade(cc, 0.4)))
            c.rect(x0 + 2, y0 + 1, x0 + 16, y0 + 1, tint(cc, 0.45))
            c.rect(x0 + 6, y0 + 7, x0 + 12, y0 + 7, shade(cc, 0.4))                                       # the handle slot
        c.rect(206, 72, 206, 100, rgb('#c8a060')); c.rect(207, 72, 207, 100, rgb('#8a6a3a'))               # a broom against the wall (about shoulder high)
        c.part(mc.rows(203, 98, 210, 104), Mat('#d8c070', hi='#f0e090', lo='#a08a40'))
        for x in range(204, 210, 2):
            c.rect(x, 101, x, 104, rgb('#b09a50'))
        c.rect(203, 98, 210, 98, rgb('#c23b3b'))
    mc.put(base, clutter, shadow=True)
    mc.drop(54, 92, 313, 0.3, 2)
    mc.block(304, 236, 318, 256)
    mc.block(418, 98, 430, 112)
    mc.block(54, 290, 92, 312)
    mc.block(88, 108, 134, 126)

    def bike(c):                                                    # an old bike leaning on the bench, drawn fine (no outline)
        rim, tyre, red = rgb('#9aa0a8'), rgb('#1e1e22'), rgb('#c03030')
        for cx in (98, 124):
            for a_ in range(0, 360, 6):
                ca, sa = math.cos(math.radians(a_)), math.sin(math.radians(a_))
                c.px(int(round(cx + 8 * ca)), int(round(118 + 8 * sa)), tyre)
                c.px(int(round(cx + 7 * ca)), int(round(118 + 7 * sa)), tyre)
                c.px(int(round(cx + 6 * ca)), int(round(118 + 6 * sa)), rim)
            for a_ in range(0, 180, 30):                                   # spokes
                for t in range(-5, 6):
                    c.px(int(round(cx + t * math.cos(math.radians(a_)))), int(round(118 + t * math.sin(math.radians(a_)))), rgb('#6a6e76'))
            c.px(cx, 118, rgb('#c8ccd2'))
        for t in range(15):                                               # the frame: down tube, top tube, seat tube, stays
            c.px(98 + t * 14 // 14, 118 - t * 6 // 14, red)
        c.rect(104, 112, 116, 112, red); c.rect(104, 111, 116, 111, rgb('#e05a5a'))
        for t in range(7):
            c.px(112 - t // 3, 112 + t, red); c.px(113 + t * 11 // 7, 112 + t * 6 // 7, red)
        c.rect(110, 108, 114, 109, rgb('#2a2a2e')); c.px(110, 108, rgb('#4a4a52'))                           # the saddle
        c.rect(120, 108, 120, 112, rgb('#9aa0a8')); c.rect(118, 107, 122, 107, rgb('#2a2a2e'))               # the bars
        for t in range(6):
            c.px(120 + t * 4 // 6, 112 + t, rgb('#9aa0a8'))
    mc.put(base, bike, edge=False)
    mc.drop(89, 133, 127, 0.25, 1)

    def bulb(c):                                                    # the bare bulb, its pull chain hanging
        c.rect(BULB[0], 4, BULB[0], BULB[1] - 68, rgb('#3a3a40'))
        c.rect(BULB[0] - 1, BULB[1] - 68, BULB[0] + 1, BULB[1] - 66, rgb('#5a5a62'))
        c.part(mc.ellipse(BULB[0], BULB[1] - 63, 2, 3), Mat('#fff6d6', hi='#ffffff', lo='#f0d890'))
        c.px(BULB[0] - 1, BULB[1] - 64, rgb('#ffffff'))
        for y in range(BULB[1] - 59, BULB[1] - 50, 2):
            c.px(BULB[0] + 1, y, rgb('#c8ccd2'))
        c.px(BULB[0] + 1, BULB[1] - 50, rgb('#e8e8e8'))
    mc.put(base, bulb, edge=False)

    # It is a dim room: darker the further from the bulb, then the bulb's glow laid over that by the page.
    import numpy as np
    ys, xs = np.mgrid[0:mc.H, 0:mc.W]
    d = np.sqrt(((xs - BULB[0]) / 1.4) ** 2 + (ys - BULB[1]) ** 2)
    dim = np.clip((d - 60) / 240, 0, 1) * 0.5
    a = base.a.astype(np.float32)
    ink = np.array([18, 14, 30], np.float32)
    a[..., :3] = a[..., :3] * (1 - dim[..., None]) + ink * dim[..., None]
    base.a[...] = a.astype(np.uint8)
    for crop, e in mc.occluders:
        sub = dim[e['y']:e['y'] + e['h'], e['x']:e['x'] + e['w']][..., None]
        f = crop.astype(np.float32)
        f[..., :3] = f[..., :3] * (1 - sub) + ink * sub
        crop[...] = f.astype(np.uint8)
    mc.pool(BULB[0], BULB[1] + 40, 120, 70, '#fff0c8', 0.12)          # the bulb's light on the slab under it
    mc.light(BULB[0], BULB[1] - 50, 150, 120, '#ffe2a0', 0.34)
    mc.light(BULB[0], BULB[1] - 63, 12, 10, '#fff6d6', 0.6)
    mc.light(264, 194, 30, 22, '#7ab0ff', 0.22)                      # the TV's glow on the rug

    L['stands'] += [dict(x=110, y=160, face='down'), dict(x=340, y=170, face='down'), dict(x=200, y=310, face='up'),
                    dict(x=420, y=200, face='left'), dict(x=230, y=150, face='down'), dict(x=100, y=280, face='right'),
                    dict(x=420, y=300, face='left'), dict(x=60, y=250, face='right')]
    L['things']['bulb'] = list(BULB)
