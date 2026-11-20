#!/usr/bin/env python3
"""Draws the pixel art for the game table, so no emoji or symbol fonts are needed.

    python scripts/make-games.py

Writes into client/public/games/:
  suits.png     clubs, diamonds, spades, hearts: 11x11 each, white on clear. Used as a mask, so the page gives each
                its colour (red or black on a card, the app colour elsewhere).
  marks.png     16x16 each, white on clear, also masks: a robot head (a computer player), a hand of cards, a
                mancala board.
  chess.png     16x16 each: pawn, knight, bishop, rook, queen, king; white on the top row, black on the bottom.
  checkers.png  16x16 each: red piece, red king, white piece, white king.
  stones.png    16x16 each: the red and yellow pieces of four in a row, then a black and a white go stone.
  mahjong.png   18x24 each, in the order the server numbers them (server/games/mahjong.ts): dots 1 to 9, bamboo 1
                to 9, characters 1 to 9, the winds east south west north, the red, green and white dragons, and
                last a tile lying face down. The characters and winds carry a small 1 to 9 or E S W N in the corner,
                for anybody who does not read the Chinese on them.
and art/games-preview.png and art/mahjong-preview.png, everything enlarged on the colours it is shown on. Look at
those before shipping a change: a shape that reads at 8x can still be mush at the size it is used.
"""
import os

from PIL import Image

SUITS = {
    'C': ['....###....', '...#####...', '...#####...', '....###....', '.###.#.###.', '###########', '###########', '###########', '.###.#.###.', '.....#.....', '...#####...'],
    'D': ['.....#.....', '....###....', '...#####...', '..#######..', '.#########.', '###########', '.#########.', '..#######..', '...#####...', '....###....', '.....#.....'],
    'S': ['.....#.....', '....###....', '...#####...', '..#######..', '.#########.', '###########', '###########', '###########', '.###.#.###.', '.....#.....', '...#####...'],
    'H': ['.###...###.', '#####.#####', '###########', '###########', '###########', '.#########.', '..#######..', '...#####...', '....###....', '.....#.....', '...........'],
}

MARKS = {
    'robot': [
        '.......##.......', '.......##.......', '..############..', '..############..', '..##..####..##..', '..##..####..##..', '..############..', '..############..',
        '..###......###..', '..############..', '..############..', '....##....##....', '....##....##....', '................', '................', '................'],
    'cards': [
        '................', '..#######.......', '..#.....####....', '..#.#...#..###..', '..#.....#....#..', '..#.....#.#..#..', '..#.....#....#..', '..#.....#....#..',
        '..#.....#....#..', '..#.....#....#..', '..#...#.#....#..', '..#.....#..#.#..', '..#######....#..', '.....#.......#..', '.....#########..', '................'],
    'pits': [
        '................', '................', '................', '..############..', '.#............#.', '#..##.##.##.##.#', '#..##.##.##.##.#', '#..............#',
        '#..##.##.##.##.#', '#..##.##.##.##.#', '.#............#.', '..############..', '................', '................', '................', '................'],
}

def _drawn(*parts):
    """A 16x16 mark made of shapes rather than typed out: each part is ('fill' | 'clear', test(x, y)), applied in turn to
    the middle of each dot."""
    rows = []
    for y in range(16):
        row = ''
        for x in range(16):
            on = False
            for kind, test in parts:
                if test(x + 0.5, y + 0.5):
                    on = kind == 'fill'
            row += '#' if on else '.'
        rows.append(row)
    return rows


def _disc(cx, cy, r):
    return lambda x, y: (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def _box(x0, y0, x1, y1):
    return lambda x, y: x0 <= x <= x1 and y0 <= y <= y1


def _line(x0, y0, x1, y1, w):
    def test(x, y):
        dx, dy = x1 - x0, y1 - y0
        t = max(0.0, min(1.0, ((x - x0) * dx + (y - y0) * dy) / (dx * dx + dy * dy)))
        return (x - x0 - t * dx) ** 2 + (y - y0 - t * dy) ** 2 <= (w / 2) ** 2
    return test


def _tri(a, b, c):
    def side(p, q, x, y):
        return (q[0] - p[0]) * (y - p[1]) - (q[1] - p[1]) * (x - p[0])
    return lambda x, y: (side(a, b, x, y) >= 0) == (side(b, c, x, y) >= 0) == (side(c, a, x, y) >= 0)


# the basement's games and cornhole, for the list of games: the eight ball and a cue, a dartboard, a shuffleboard weight
# on its lane, a pin and a ball, a flag in a green, a poker chip, a cornhole board with its hole and a bag
MARKS.update({
    'pool': _drawn(('fill', _disc(9.5, 9.5, 6.2)), ('clear', _disc(9.5, 8.6, 2.6)), ('fill', _box(8.6, 7.0, 10.4, 7.6)), ('fill', _box(8.6, 9.4, 10.4, 10.0)),
                   ('fill', _line(0.8, 0.8, 4.4, 4.4, 1.6))),
    'darts': _drawn(('fill', _disc(8, 8, 7.4)), ('clear', _disc(8, 8, 5.6)), ('fill', _disc(8, 8, 4.0)), ('clear', _disc(8, 8, 2.4)), ('fill', _disc(8, 8, 1.1))),
    'shuffle': _drawn(('fill', _box(3, 0, 12.9, 15.9)), ('clear', _box(4.2, 0, 11.7, 15.9)), ('fill', _box(4.2, 10.4, 11.7, 11.0)),
                      ('fill', _disc(8, 5.5, 3.2)), ('clear', _disc(8, 5.5, 1.3))),
    'bowling': _drawn(('fill', _disc(4.6, 2.6, 1.9)), ('fill', _box(3.9, 3.6, 5.3, 6.0)), ('fill', lambda x, y: ((x - 4.6) / 2.9) ** 2 + ((y - 10.6) / 4.9) ** 2 <= 1),
                      ('fill', _disc(11.4, 11.4, 4.3)), ('clear', _disc(10.2, 9.9, 0.8)), ('clear', _disc(12.3, 9.6, 0.8)), ('clear', _disc(11.6, 11.8, 0.8))),
    'golf': _drawn(('fill', lambda x, y: ((x - 8) / 7.6) ** 2 + ((y - 13.6) / 2.4) ** 2 <= 1), ('clear', lambda x, y: ((x - 8.6) / 1.6) ** 2 + ((y - 13.4) / 0.9) ** 2 <= 1),
                   ('fill', _box(8, 0.6, 9.1, 13.6)), ('fill', _tri((9, 0.6), (15.4, 3.2), (9, 5.8))), ('fill', _disc(3.4, 11.0, 1.1))),
    'chips': _drawn(('fill', _disc(8, 8, 7.4)), ('clear', _disc(8, 8, 4.8)), ('fill', _disc(8, 8, 3.4)), ('clear', _disc(8, 8, 1.6)),
                    ('clear', _box(7.2, 0, 8.8, 1.9)), ('clear', _box(7.2, 14.1, 8.8, 16)), ('clear', _box(0, 7.2, 1.9, 8.8)), ('clear', _box(14.1, 7.2, 16, 8.8))),
    'cornhole': _drawn(('fill', _tri((4.4, 0.4), (11.6, 0.4), (15.2, 11.4))), ('fill', _tri((4.4, 0.4), (15.2, 11.4), (0.8, 11.4))), ('clear', _disc(8, 3.4, 1.6)),
                       ('clear', _box(0, 11.4, 16, 12.4)), ('fill', _box(1.0, 12.4, 15.0, 13.4)), ('fill', _box(1.6, 13.4, 2.6, 15.6)), ('fill', _box(13.4, 13.4, 14.4, 15.6)),
                       ('fill', _box(6.2, 7.0, 9.8, 9.4)), ('clear', _box(5.2, 6.2, 6.1, 10.2)), ('clear', _box(9.9, 6.2, 10.8, 10.2)), ('clear', _box(5.2, 6.0, 10.8, 6.9)), ('clear', _box(5.2, 9.5, 10.8, 10.3))),
})

# the backyard's games: ten cups racked in a triangle (beer pong), a horseshoe, two bocce balls and the pallino
def _cups():
    parts = []
    for r, n in enumerate((4, 3, 2, 1)):
        for i in range(n):
            x0, y0 = 0.5 + (4 - n) * 2 + i * 4, 1 + r * 4
            parts += [('fill', _box(x0, y0, x0 + 2.9, y0 + 2.9)), ('clear', _box(x0 + 1, y0 + 1, x0 + 1.9, y0 + 1.9))]
    return _drawn(*parts)


MARKS.update({
    'pong': _cups(),
    'shoes': _drawn(('fill', _disc(8, 7, 6.6)), ('clear', _disc(8, 7, 3.8)), ('clear', _box(4.6, 7, 11.4, 16)),
                    ('fill', _box(1.4, 7, 4.6, 14.6)), ('fill', _box(11.4, 7, 14.6, 14.6)), ('clear', _box(2.6, 7, 3.4, 13.2)), ('clear', _box(12.6, 7, 13.4, 13.2)),
                    ('clear', _disc(4.2, 3.6, 0.6)), ('clear', _disc(11.8, 3.6, 0.6)), ('clear', _disc(2.2, 7.6, 0.6)), ('clear', _disc(13.8, 7.6, 0.6))),
    'bocce': None,                                                      # (drawn further down, with _ring)
})


def _ring(cx, cy, r, half):
    """The dots within `half` of a circle's edge (a groove, or a hollow stone)."""
    return lambda x, y: abs(((x - cx) ** 2 + (y - cy) ** 2) ** 0.5 - r) <= half


def _solid(rows, holes=()):
    """One of the coloured sprites below as a plain mark: outline and body all filled, then `holes` cleared."""
    out = [''.join('#' if ch != '.' else '.' for ch in row) for row in rows]
    for x, y in holes:
        out[y] = out[y][:x] + '.' + out[y][x + 1:]
    return out


# '#' is the outline, 'o' the body. The body's left edge is lit and its right edge shaded when it is coloured in.
CHESS = {
    'p': [
        '................', '................', '................', '......####......', '.....#oooo#.....', '.....#oooo#.....', '.....#oooo#.....', '......#oo#......',
        '.....#oooo#.....', '....#oooooo#....', '.....#oooo#.....', '.....#oooo#.....', '....#oooooo#....', '...#oooooooo#...', '...#oooooooo#...', '...##########...'],
    'n': [
        '................', '......#.#.......', '.....######.....', '....#oooooo#....', '...#ooo#oooo#...', '..#ooooooooo#...', '.#ooooooooooo#..', '.#ooo##oooooo#..',
        '..###.#oooooo#..', '.....#ooooooo#..', '....#oooooooo#..', '....#ooooooo#...', '...#oooooooo#...', '..#oooooooooo#..', '..#oooooooooo#..', '..############..'],
    'b': [
        '.......##.......', '......#oo#......', '......#oo#......', '.....#oooo#.....', '....#oo#ooo#....', '....#o#oooo#....', '....#oooooo#....', '....#oooooo#....',
        '.....#oooo#.....', '......####......', '.....#oooo#.....', '.....#oooo#.....', '....#oooooo#....', '..###oooooo###..', '..#oooooooooo#..', '..############..'],
    'r': [
        '................', '................', '..###.####.###..', '..#o#.#oo#.#o#..', '..#o###oo###o#..', '..#oooooooooo#..', '..############..', '...#oooooooo#...',
        '...#oooooooo#...', '...#oooooooo#...', '...#oooooooo#...', '...#oooooooo#...', '..############..', '..#oooooooooo#..', '..#oooooooooo#..', '..############..'],
    'q': [
        '.......##.......', '..#...#oo#...#..', '.#o#..#oo#..#o#.', '.#o#.#oooo#.#o#.', '.#oo##oooo##oo#.', '.#oooooooooooo#.', '..#oooooooooo#..', '..#oooooooooo#..',
        '...#oooooooo#...', '...##########...', '...#oooooooo#...', '....#oooooo#....', '...#oooooooo#...', '..#oooooooooo#..', '..#oooooooooo#..', '..############..'],
    'k': [
        '.......##.......', '.....######.....', '.......##.......', '....##.##.##....', '...#oo####oo#...', '..#oooo##oooo#..', '..#oooo##oooo#..', '..#oooooooooo#..',
        '...#oooooooo#...', '...##########...', '...#oooooooo#...', '....#oooooo#....', '...#oooooooo#...', '..#oooooooooo#..', '..#oooooooooo#..', '..############..'],
}
CHESS_ORDER = 'pnbrqk'
# body, lit edge, shaded edge, outline
CHESS_INK = {'w': ((244, 241, 228), (255, 255, 255), (186, 180, 160), (20, 21, 26)), 'b': ((58, 61, 74), (110, 115, 134), (30, 32, 40), (0, 0, 0))}

# '+' is the groove round the top, 'k' the crown
DISC = [
    '................', '.....######.....', '...##oooooo##...', '..#oooooooooo#..', '.#oooo++++oooo#.', '.#ooo+oooo+ooo#.', '#ooo+oooooo+ooo#', '#ooo+oooooo+ooo#',
    '#ooo+oooooo+ooo#', '#ooo+oooooo+ooo#', '.#ooo+oooo+ooo#.', '.#oooo++++oooo#.', '..#oooooooooo#..', '...##oooooo##...', '.....######.....', '................']
CROWN = [
    '................', '.....######.....', '...##oooooo##...', '..#oooooooooo#..', '.#oooooooooooo#.', '.#ookookkookoo#.', '#oookookkookooo#', '#oookkkkkkkkooo#',
    '#oookkkkkkkkooo#', '#oookkkkkkkkooo#', '.#oooooooooooo#.', '.#ookkkkkkkkoo#.', '..#oooooooooo#..', '...##oooooo##...', '.....######.....', '................']
# body, groove, crown, lit edge, shaded edge
DISC_INK = {'r': ((216, 52, 44), (150, 28, 26), (242, 200, 30), (255, 120, 100), (150, 28, 26)), 'w': ((244, 241, 228), (176, 170, 150), (40, 42, 52), (255, 255, 255), (176, 170, 150))}
OUTLINE = (12, 12, 16)
# four in a row's pieces are the checkers disc in red and yellow; a go stone is the same disc with no groove
YELLOW_INK = ((242, 200, 30), (190, 150, 10), None, (255, 236, 120), (190, 150, 10))
STONE = [r.replace('+', 'o') for r in DISC]
# body, lit edge, shaded edge
STONE_INK = {'b': ((40, 42, 52), (96, 100, 118), (16, 17, 22)), 'w': ((244, 241, 228), (255, 255, 255), (176, 170, 150))}

# The rest of the list of games as plain marks too, all in the one grey like the others: two bocce balls with their grooves
# and the pallino; a fish on a line (the lake); a knight; a checker with its groove; stones on a go board; a four in a row
# frame with a piece dropping in; a mahjong tile (the red dragon's character); a sudoku grid with a few numbers in.
_bocce = _drawn(('fill', _disc(5, 10.5, 4.8)), ('clear', _ring(5, 4.5, 6.0, 0.5)), ('clear', _disc(12.2, 11.2, 4.6)), ('fill', _disc(12.2, 11.2, 3.8)),
                ('clear', _ring(12.2, 6.4, 4.75, 0.45)), ('fill', _disc(11.5, 2.8, 1.6)))
MARKS.update({
    'bocce': _bocce,
    'fish': _drawn(('fill', _box(4.6, 0, 5.6, 4.4)), ('fill', _ring(6.2, 4.6, 1.4, 0.5)),
                   ('fill', lambda x, y: ((x - 7.0) / 5.6) ** 2 + ((y - 10.4) / 3.4) ** 2 <= 1), ('fill', _tri((11.4, 10.4), (15.8, 6.6), (15.8, 14.2))),
                   ('clear', _disc(4.0, 9.6, 0.8)), ('clear', _box(8.6, 8.4, 9.2, 12.4))),
    'chess': _solid(CHESS['n'], holes=((7, 4),)),
    'checkers': [row.replace('o', '#').replace('+', '.') for row in DISC],
    'go': _drawn(*[('fill', _box(0, v - 0.3, 16, v + 0.3)) for v in (3.5, 8.5, 13.5)], *[('fill', _box(v - 0.3, 0, v + 0.3, 16)) for v in (3.5, 8.5, 13.5)],
                 ('clear', _disc(8.5, 8.5, 3.9)), ('fill', _disc(8.5, 8.5, 3.3)), ('clear', _disc(13.5, 3.5, 3.0)), ('fill', _ring(13.5, 3.5, 2.2, 0.55)),
                 ('clear', _disc(3.5, 13.5, 3.0)), ('fill', _ring(3.5, 13.5, 2.2, 0.55))),
    'four': _drawn(*[('fill', _disc(2.5 + 3.6 * k, 11.5 - 3.3 * k, 1.75)) for k in range(4)], ('fill', _box(0, 15, 16, 16))),
    'mahjong': _drawn(('fill', _box(2.5, 0, 13.5, 16)), ('clear', _box(3.5, 1, 12.5, 15)), ('fill', _box(4.5, 13.2, 12.5, 15)),
                      ('fill', _box(7.5, 2.2, 8.5, 12)), ('fill', _box(5, 4.5, 11, 9.5)), ('clear', _box(6, 5.5, 10, 8.5)), ('fill', _box(7.5, 5.5, 8.5, 8.5))),
    'sudoku': _drawn(('fill', _box(0.5, 0.5, 15.5, 15.5)), ('clear', _box(1.5, 1.5, 14.5, 14.5)),
                     ('fill', _box(5.5, 0, 6.4, 16)), ('fill', _box(9.6, 0, 10.5, 16)), ('fill', _box(0, 5.5, 16, 6.4)), ('fill', _box(0, 9.6, 16, 10.5)),
                     ('fill', _box(2.6, 2.4, 3.4, 4.6)), ('fill', _box(11.6, 2.6, 13.4, 3.4)), ('fill', _box(12.6, 3.4, 13.4, 4.6)),
                     ('fill', _box(7.2, 7.2, 8.8, 8.8)), ('fill', _box(2.6, 11.6, 4.4, 13.4)), ('clear', _box(3.4, 12.4, 3.6, 12.6)), ('fill', _box(11.6, 11.6, 13.4, 13.4))),
})

# ── mahjong ──
TILE_W, TILE_H = 18, 24            # with its outline; the face inside is 16 by 22
FACE, INK, BLUE, RED, GREEN, FAINT = (244, 241, 228), (27, 28, 34), (38, 84, 168), (200, 40, 40), (30, 130, 70), (70, 96, 150)
DOT4 = ['.##.', '####', '####', '.##.']
DOT6 = ['.####.', '######', '##..##', '##..##', '######', '.####.']
RING = ['...####...', '.########.', '.###..###.', '###....###', '##......##', '##......##', '###....###', '.###..###.', '.########.', '...####...']
STICK = ['.##.', '####', '.##.', '.##.', '####', '.##.']
# one of bamboo is a bird, as on real tiles: g green, b blue, r red, k its eye
BIRD = [
    '......ggg.......', '.....ggggg......', '....ggkgggg.....', '..rrggggggg.....', '....gggggggg....', '....ggbbbbggg...', '....gbbbbbbggg..', '.....gbbbbbbgbb.',
    '.....ggbbbbggbbb', '......ggggggbbb.', '......gggggg.b..', '.......gggg.....', '........r.r.....', '........r.r.....', '.......rr.rr....']
# (shape, x, y, colour) for each tile's face
DOTS = [
    [(RING, 3, 6, BLUE), (DOT4, 6, 9, RED)],
    [(DOT6, 5, 3, GREEN), (DOT6, 5, 13, BLUE)],
    [(DOT6, 0, 1, BLUE), (DOT6, 5, 8, RED), (DOT6, 10, 15, GREEN)],
    [(DOT6, 1, 3, BLUE), (DOT6, 9, 3, GREEN), (DOT6, 1, 13, GREEN), (DOT6, 9, 13, BLUE)],
    [(DOT4, 2, 3, BLUE), (DOT4, 10, 3, GREEN), (DOT4, 6, 9, RED), (DOT4, 2, 15, GREEN), (DOT4, 10, 15, BLUE)],
    [(DOT4, x, y, GREEN if y == 2 else RED) for y in (2, 9, 16) for x in (3, 9)],
    [(DOT4, 1, 1, GREEN), (DOT4, 6, 3, GREEN), (DOT4, 11, 5, GREEN)] + [(DOT4, x, y, RED) for y in (11, 17) for x in (3, 9)],
    [(DOT4, x, y, BLUE) for y in (1, 6, 12, 17) for x in (3, 9)],
    [(DOT4, x, y, c) for y, c in ((2, BLUE), (9, RED), (16, GREEN)) for x in (1, 6, 11)],
]
BAMBOO = [
    None,                                                   # the bird
    [(STICK, 6, 3, GREEN), (STICK, 6, 13, BLUE)],
    [(STICK, 6, 3, BLUE), (STICK, 2, 13, GREEN), (STICK, 10, 13, GREEN)],
    [(STICK, 2, 4, BLUE), (STICK, 10, 4, GREEN), (STICK, 2, 12, GREEN), (STICK, 10, 12, BLUE)],
    [(STICK, 1, 3, GREEN), (STICK, 11, 3, BLUE), (STICK, 6, 8, RED), (STICK, 1, 13, BLUE), (STICK, 11, 13, GREEN)],
    [(STICK, x, y, c) for y, c in ((4, GREEN), (12, BLUE)) for x in (1, 6, 11)],
    [(STICK, 6, 1, RED)] + [(STICK, x, y, GREEN) for y in (8, 15) for x in (1, 6, 11)],
    [(STICK, x, 1, GREEN) for x in (1, 6, 11)] + [(STICK, x, 8, BLUE) for x in (3, 9)] + [(STICK, x, 15, GREEN) for x in (1, 6, 11)],
    [(STICK, x, y, c) for x, c in ((1, GREEN), (6, RED), (11, BLUE)) for y in (1, 8, 15)],
]
# the Chinese numbers one to nine, 9 wide and 7 tall
NUMERALS = [
    ['.........', '.........', '.........', '#########', '.........', '.........', '.........'],
    ['.........', '.#######.', '.........', '.........', '.........', '#########', '.........'],
    ['.#######.', '.........', '.........', '..#####..', '.........', '.........', '#########'],
    ['#########', '#..#.#..#', '#..#.#..#', '#.#..##.#', '##.....##', '#.......#', '#########'],
    ['#########', '....#....', '....#....', '.#######.', '...#...#.', '...#...#.', '#########'],
    ['....#....', '....#....', '#########', '.........', '..#...#..', '.#.....#.', '#.......#'],
    ['...#.....', '...#.....', '...#..###', '######...', '...#.....', '...#....#', '....#####'],
    ['...#.#...', '...#..#..', '..#...#..', '..#....#.', '.#.....#.', '.#......#', '#.......#'],
    ['...#.....', '...#.....', '######...', '...#.#...', '..#..#...', '..#..#..#', '##....###'],
]
# "ten thousand", under every character tile's number; then the four winds and two of the dragons, each 11 by 11
WAN = ['..#.....#..', '###########', '..#.....#..', '.#########.', '.#...#...#.', '.#########.', '.#...#...#.', '###########', '#....#.#..#', '#..#####..#', '#.......###']
WINDS = [
    ['.....#.....', '###########', '.....#.....', '.#########.', '.#...#...#.', '.#########.', '.#...#...#.', '.#########.', '...#.#.#...', '..#..#..#..', '##...#...##'],
    ['.....#.....', '###########', '.....#.....', '.#########.', '.#..#.#..#.', '.#.#####.#.', '.#...#...#.', '.#.#####.#.', '.#...#...#.', '.#...#...#.', '.#......##.'],
    ['...........', '###########', '....#.#....', '....#.#....', '.#########.', '.#..#.#..#.', '.#..#.#..#.', '.#.#..##.#.', '.##......#.', '.#.......#.', '.#########.'],
    ['...#...#...', '...#...#...', '...#...#..#', '####...#.#.', '...#...##..', '...#...#...', '...#...#...', '...#...#...', '..##...#..#', '##.#...#..#', '...#...####'],
]
CHUNG = ['.....#.....', '.....#.....', '.#########.', '.#...#...#.', '.#...#...#.', '.#...#...#.', '.#########.', '.....#.....', '.....#.....', '.....#.....', '.....#.....']
FA = ['..#.#..#.#.', '.#.#..#.#..', '#########.#', '.###..###..', '...#..#.#..', '.###.##.##.', '.#...#####.', '.###..#.#..', '...#..##...', '...#.#..#..', '.##.#....##']
# the little corner marks: 1 to 9, then E S W N
SMALL = {
    '1': ['.#.', '##.', '.#.', '.#.', '###'], '2': ['##.', '..#', '.#.', '#..', '###'], '3': ['##.', '..#', '.#.', '..#', '##.'],
    '4': ['#.#', '#.#', '###', '..#', '..#'], '5': ['###', '#..', '##.', '..#', '##.'], '6': ['.##', '#..', '###', '#.#', '###'],
    '7': ['###', '..#', '.#.', '.#.', '.#.'], '8': ['###', '#.#', '###', '#.#', '###'], '9': ['###', '#.#', '###', '..#', '##.'],
    'E': ['###', '#..', '##.', '#..', '###'], 'S': ['.##', '#..', '.#.', '..#', '##.'], 'W': ['#...#', '#...#', '#.#.#', '##.##', '#...#'], 'N': ['#..#', '##.#', '#.##', '#..#', '#..#'],
}


def stamp(img, rows, x, y, colour, key=None):
    """Puts a shape on a tile's face (x and y count from the face's corner, inside the outline)."""
    for dy, row in enumerate(rows):
        for dx, ch in enumerate(row):
            if ch == '.':
                continue
            assert 0 <= x + dx < TILE_W - 2 and 0 <= y + dy < TILE_H - 2, (rows, x, y)
            img.putpixel((1 + x + dx, 1 + y + dy), (key[ch] if key else colour) + (255,))


def blank_tile(face=FACE):
    img = Image.new('RGBA', (TILE_W, TILE_H), OUTLINE + (255,))
    for cx, cy in ((0, 0), (TILE_W - 1, 0), (0, TILE_H - 1), (TILE_W - 1, TILE_H - 1)):
        img.putpixel((cx, cy), (0, 0, 0, 0))                # the corners are rounded off
    img.paste(Image.new('RGBA', (TILE_W - 2, TILE_H - 2), face + (255,)), (1, 1))
    return img


def mahjong_tiles():
    tiles = []
    for parts in DOTS:
        t = blank_tile()
        for shape, x, y, c in parts:
            stamp(t, shape, x, y, c)
        tiles.append(t)
    for parts in BAMBOO:
        t = blank_tile()
        if parts is None:
            stamp(t, BIRD, 0, 3, None, {'g': GREEN, 'b': BLUE, 'r': RED, 'k': INK})
        else:
            for shape, x, y, c in parts:
                stamp(t, shape, x, y, c)
        tiles.append(t)
    for i, numeral in enumerate(NUMERALS):
        t = blank_tile()
        stamp(t, SMALL[str(i + 1)], 1, 1, FAINT)
        stamp(t, numeral, 6, 1, INK)
        stamp(t, WAN, 3, 10, RED)
        tiles.append(t)
    for letter, glyph in zip('ESWN', WINDS):
        t = blank_tile()
        stamp(t, SMALL[letter], 1, 1, FAINT)
        stamp(t, glyph, 3, 8, INK)
        tiles.append(t)
    red, green, white = blank_tile(), blank_tile(), blank_tile()
    stamp(red, CHUNG, 3, 6, RED)
    stamp(green, FA, 3, 6, GREEN)
    for x0, y0, x1, y1 in ((2, 3, 13, 18), (4, 5, 11, 16)):     # the white dragon is an empty frame
        for x in range(x0, x1 + 1):
            for y in range(y0, y1 + 1):
                if x in (x0, x1) or y in (y0, y1):
                    white.putpixel((1 + x, 1 + y), BLUE + (255,))
    back = blank_tile((30, 110, 64))
    for x in range(2, 14):
        for y in range(2, 20):
            if x in (2, 13) or y in (2, 19) or (x + y) % 4 == 0:
                back.putpixel((1 + x, 1 + y), (70, 160, 100, 255))
    return tiles + [red, green, white, back]


def mask(rows, size):
    assert len(rows) == size and all(len(r) == size for r in rows), rows
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            if ch == '#':
                img.putpixel((x, y), (255, 255, 255, 255))
    return img


def coloured(rows, body, lit, shade, outline, extra=None):
    assert len(rows) == 16 and all(len(r) == 16 for r in rows), rows
    img = Image.new('RGBA', (16, 16), (0, 0, 0, 0))
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            if ch == '.':
                continue
            if ch == '#':
                c = outline
            elif extra and ch in extra:
                c = extra[ch]
            elif x > 0 and row[x - 1] == '#':
                c = lit
            elif x < 15 and row[x + 1] == '#':
                c = shade
            else:
                c = body
            img.putpixel((x, y), c + (255,))
    return img


def row_of(tiles):
    w, h = tiles[0].size
    img = Image.new('RGBA', (w * len(tiles), h), (0, 0, 0, 0))
    for i, t in enumerate(tiles):
        img.paste(t, (i * w, 0))
    return img


def main():
    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
    out = os.path.join(root, 'client', 'public', 'games')
    os.makedirs(out, exist_ok=True)

    suits = row_of([mask(SUITS[s], 11) for s in 'CDSH'])
    suits.save(os.path.join(out, 'suits.png'))
    marks = row_of([mask(MARKS[m], 16) for m in MARKS])
    marks.save(os.path.join(out, 'marks.png'))

    chess = Image.new('RGBA', (96, 32), (0, 0, 0, 0))
    for r, side in enumerate('wb'):
        for i, p in enumerate(CHESS_ORDER):
            chess.paste(coloured(CHESS[p], *CHESS_INK[side]), (i * 16, r * 16))
    chess.save(os.path.join(out, 'chess.png'))

    discs = []
    for side in 'rw':
        body, groove, crown, lit, shade = DISC_INK[side]
        discs.append(coloured(DISC, body, lit, shade, OUTLINE, {'+': groove}))
        discs.append(coloured(CROWN, body, lit, shade, OUTLINE, {'k': crown}))
    checkers = row_of(discs)
    checkers.save(os.path.join(out, 'checkers.png'))

    body, groove, _, lit, shade = YELLOW_INK
    stones = row_of([discs[0], coloured(DISC, body, lit, shade, OUTLINE, {'+': groove})] + [coloured(STONE, *STONE_INK[c], OUTLINE) for c in 'bw'])
    stones.save(os.path.join(out, 'stones.png'))
    tiles = mahjong_tiles()
    assert len(tiles) == 35
    row_of(tiles).save(os.path.join(out, 'mahjong.png'))

    # ── the preview: everything on the colours it is shown on ──
    light, dark, felt, card = (207, 199, 168), (125, 107, 83), (20, 22, 28), (244, 241, 228)
    k = 6
    pv = Image.new('RGBA', (96 * k + 40, (11 * 2 + 32 * 2 + 16 * 3) * k + 160), felt + (255,))

    def put(img, x, y, bg=None, tint=None):
        if tint:
            flat = Image.new('RGBA', img.size, tint + (255,))
            flat.putalpha(img.getchannel('A'))
            img = flat
        big = img.resize((img.width * k, img.height * k), Image.NEAREST)
        if bg:
            pv.paste(Image.new('RGBA', big.size, bg + (255,)), (x, y))
        pv.alpha_composite(big, (x, y))
        return y + big.height + 20

    y = 20
    for i, s in enumerate('CDSH'):                       # suits as they are on a card: black and red on cream
        put(mask(SUITS[s], 11), 20 + i * 11 * k, y, card, (27, 28, 34) if s in 'CS' else (216, 52, 44))
    y = put(marks, 20 + 44 * k + 30, y, None, (124, 140, 255))
    y = put(suits, 20, y, None, (124, 140, 255))           # and in the app colour, on the dark panel
    for half, bg in enumerate((light, dark)):             # every chess piece on both square colours
        y = put(chess, 20, y, bg)
    for bg in (dark, (61, 90, 58)):
        y = put(checkers, 20, y, bg)
    put(stones.crop((0, 0, 32, 16)), 20, y, (30, 80, 170))          # four in a row's board is blue; a go board is wood
    put(stones.crop((32, 0, 64, 16)), 20 + 32 * k + 20, y, (214, 170, 96))
    pv.save(os.path.join(root, 'art', 'games-preview.png'))

    # the mahjong tiles, a suit to a row, at 3 and at 2 screen dots to one of theirs (the sizes they are used most)
    k = 3
    rows = [tiles[0:9], tiles[9:18], tiles[18:27], tiles[27:35]]
    pv = Image.new('RGBA', (9 * (TILE_W + 2) * k + 40 + 9 * (TILE_W + 2) * 2 + 20, 4 * (TILE_H + 4) * k + 40), felt + (255,))
    for r, row in enumerate(rows):
        for i, t in enumerate(row):
            pv.alpha_composite(t.resize((TILE_W * k, TILE_H * k), Image.NEAREST), (20 + i * (TILE_W + 2) * k, 20 + r * (TILE_H + 4) * k))
            pv.alpha_composite(t.resize((TILE_W * 2, TILE_H * 2), Image.NEAREST), (40 + 9 * (TILE_W + 2) * k + i * (TILE_W + 2) * 2, 20 + r * (TILE_H + 4) * k))
    pv.save(os.path.join(root, 'art', 'mahjong-preview.png'))
    print('wrote suits, marks, chess, checkers, stones and mahjong to client/public/games, and the two previews in art/')


if __name__ == '__main__':
    main()
