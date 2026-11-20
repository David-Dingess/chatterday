// Where each holiday's decorations go, room by room (the art is client/src/holidays/art.ts; decor.tsx draws it).
// Pure data, no page: scripts lay it over the rooms' pictures to look at it.
//
// Every piece is [x, y] = its top-left corner in room dots; `z` its depth (by default its bottom edge, as the room's own
// props: people standing further down are in front of it). Things on a table or a shelf take the table's depth plus
// one. Nothing here takes clicks, and nothing stands on a seat, on a walk route's narrow places, or over the whiteboard,
// the screens, the clock, the mirror, the sudoku table, the vacuum's dock or the disco switch.
import type { Holiday } from './dates.ts';
import { CLUB } from '../clubhouse.gen.ts';

export type Piece = {
  s: string; x: number; y: number; z?: number;
  /** drawn mirrored (a cobweb in the right-hand corner) */
  flip?: boolean;
  /** only on the day itself (Halloween night: the scarier things) */
  peak?: boolean;
  /** only once the presents are out (Christmas, from the 20th) */
  presents?: boolean;
};
/** A garland run along a wall: x, y (its top), width, depth. */
export type Run = [number, number, number, number];
export type RoomDecor = {
  /** where garlands hang (the holiday picks which garland) */
  runs: Run[];
  /** runs for one holiday instead (New Year's: round the banner) */
  runsFor?: Partial<Record<Holiday, Run[]>>;
  /** which garland, by holiday (the room's own look: holly in the DnD room) */
  garland?: Partial<Record<Holiday, string>>;
  pieces: Partial<Record<Holiday, Piece[]>>;
  /** Christmas stockings, one per person: on each desk ('desks', the clubhouse) or along a ledge [x, y, step, depth] */
  stockings?: 'desks' | [number, number, number, number];
  /** whether lanterns and candles are lit by day too (a room with no daylight in it) */
  alwaysLit?: boolean;
};

export const GARLAND: Record<Holiday, string> = {
  newyear: 'streamers', valentine: 'g-valentine', stpatrick: 'g-stpatrick', easter: 'g-easter', july4: 'g-july4',
  halloween: 'g-halloween', thanksgiving: 'g-autumn', christmas: 'g-xmas',
};

// ─── The clubhouse ──────────────────────────────────────────────────────────────────────────────────────────
// Its wall's free places: the lounge's two narrow strips beside the projector screen (x 349-366 and 505-522), the gap
// between the neon and the big photo (x 118-132), and the bathroom's wall between the plant and the mirror (x 70-84).
// On a table: the lounge's coffee table (z 279), the TV console (326), the kitchen table (272).
const CLUB_WALL: [number, number][] = [[350, 14], [350, 38], [507, 14], [507, 38], [119, 29]];
const COFFEE = 280, CONSOLE = 330;

const club: RoomDecor = {
  // the main room's wall, up under the ceiling: round the photo hung highest (x 269-309); not over the lounge's screen
  runs: [[6, 4, 258, 20], [312, 4, 34, 20]],
  runsFor: { newyear: [[6, 4, 134, 20], [214, 4, 50, 20], [312, 4, 34, 20]] },
  stockings: 'desks',
  pieces: {
    newyear: [
      { s: 'banner', x: 141, y: 3, z: 22 },
      { s: 'partyhats', x: 422, y: 257, z: COFFEE },
      { s: 'confetti', x: 252, y: 198, z: 2 },
      { s: 'confetti', x: 392, y: 284, z: 2 },
    ],
    valentine: [
      { s: 'heart0', x: 351, y: 14 }, { s: 'heart1', x: 352, y: 36 }, { s: 'heart1', x: 508, y: 14 }, { s: 'heart0', x: 509, y: 36 },
      { s: 'heart2', x: 119, y: 29 }, { s: 'heart0', x: 71, y: 237 },
      { s: 'chocolates', x: 425, y: 256, z: COFFEE },
    ],
    stpatrick: [
      ...CLUB_WALL.map(([x, y]) => ({ s: 'shamrock', x: x + 2, y })), { s: 'shamrock', x: 72, y: 237 },
      { s: 'potofgold', x: 425, y: 257, z: COFFEE },
    ],
    easter: [
      { s: 'basket', x: 423, y: 254, z: COFFEE },
      { s: 'bunny', x: 388, y: 287, z: CONSOLE },
      // the eggs, hidden about: by the plant at the stairs, beside the shower, behind the bin, at the end of the cinema
      // seats, under the lamp's table, behind the purple beanbag, by the cat's bowls
      { s: 'egg0', x: 74, y: 178 }, { s: 'egg1', x: 88, y: 314 }, { s: 'egg2', x: 345, y: 312, z: 320 },
      { s: 'egg3', x: 354, y: 148 }, { s: 'egg4', x: 497, y: 234 }, { s: 'egg2', x: 254, y: 186, z: 190 }, { s: 'egg0', x: 178, y: 314 },
    ],
    july4: [
      { s: 'fan', x: 162, y: 242, z: 266 },
      { s: 'flags', x: 424, y: 245, z: COFFEE },
    ],
    halloween: [
      { s: 'web', x: 6, y: 4, z: 20 }, { s: 'webgrey', x: 6, y: 232, z: 240 },
      { s: 'bat', x: 349, y: 16 }, { s: 'bat', x: 350, y: 40 }, { s: 'bat', x: 505, y: 12 }, { s: 'bat', x: 506, y: 34 },
      { s: 'jack', x: 137, y: 196, z: 214 },            // on top of the fridge
      { s: 'jack', x: 356, y: 291, z: CONSOLE },        // on the TV console
      { s: 'jack', x: 232, y: 310 },                    // on the floor by the front door
      { s: 'candy', x: 426, y: 257, z: COFFEE },
      // the night itself: a spider on the web, a ghost in the lounge, more bats, another lantern
      { s: 'webgreyspider', x: 6, y: 232, z: 240, peak: true },     // (in the bathroom: the main room's corner is the clock's and the light switch's)
      { s: 'ghost', x: 507, y: 50, z: 70, peak: true },
      { s: 'bat', x: 117, y: 30, peak: true }, { s: 'bat', x: 117, y: 52, peak: true },
      { s: 'jack', x: 362, y: 213, z: 229, peak: true },            // at the foot of the lounge's palm
    ],
    thanksgiving: [
      { s: 'cornucopia', x: 260, y: 250, z: 273 },      // on the kitchen table
      { s: 'pumpkin', x: 137, y: 196, z: 214 }, { s: 'pumpkin', x: 356, y: 291, z: CONSOLE }, { s: 'pumpkin', x: 232, y: 310 },
    ],
    christmas: [
      { s: 'tree', x: 440, y: 263 },
      { s: 'presents', x: 428, y: 308, presents: true },
      { s: 'snowglobe', x: 417, y: 254, z: COFFEE },
      { s: 'snowglobe', x: 390, y: 291, z: CONSOLE },
    ],
  },
};
// (the old December tree and October pumpkins in deco.png are no longer used: these replace them)

// ─── The game room ──────────────────────────────────────────────────────────────────────────────────────────
// Wall: left of the dartboard (x 6-56), between the jukebox and the bar (160-176), right of the bar (432-448).
// Tables: the lounge's coffee table (z ~231), the bar top (z 120).
const GR_TABLE = 238, BAR = 120;
const gameroom: RoomDecor = {
  // along the top of the wall on the left, and along the back bar's cornice
  runs: [[6, 4, 176, 20], [178, 27, 252, 40]],
  runsFor: { newyear: [[6, 4, 176, 20], [178, 27, 86, 40], [340, 27, 90, 40]] },
  stockings: [204, 100, 28, BAR],
  pieces: {
    newyear: [
      { s: 'banner', x: 266, y: 26, z: 42 },
      { s: 'partyhats', x: 334, y: 209, z: GR_TABLE },
      { s: 'confetti', x: 270, y: 216, z: 2 },
      { s: 'balloons', x: 412, y: 98, z: 150 },
    ],
    valentine: [
      { s: 'heart0', x: 14, y: 30 }, { s: 'heart1', x: 34, y: 46 }, { s: 'heart2', x: 160, y: 32 }, { s: 'heart1', x: 434, y: 40 },
      { s: 'chocolates', x: 338, y: 207, z: GR_TABLE },
    ],
    stpatrick: [
      { s: 'shamrock', x: 16, y: 30 }, { s: 'shamrock', x: 36, y: 46 }, { s: 'shamrock', x: 162, y: 32 }, { s: 'shamrock', x: 435, y: 40 },
      { s: 'potofgold', x: 338, y: 208, z: GR_TABLE },
    ],
    easter: [
      { s: 'basket', x: 336, y: 206, z: GR_TABLE },
      { s: 'bunny', x: 380, y: 80, z: BAR },
      { s: 'egg1', x: 424, y: 142 }, { s: 'egg3', x: 160, y: 96 }, { s: 'egg0', x: 190, y: 312 }, { s: 'egg4', x: 434, y: 280 },
      { s: 'egg2', x: 30, y: 216 }, { s: 'egg1', x: 264, y: 196 },
    ],
    july4: [
      { s: 'fan', x: 284, y: 100, z: BAR },
      { s: 'flags', x: 336, y: 198, z: GR_TABLE },
    ],
    halloween: [
      { s: 'web', x: 6, y: 4, z: 20 }, { s: 'web', x: 496, y: 4, z: 20, flip: true },
      { s: 'bat', x: 12, y: 30 }, { s: 'bat', x: 30, y: 50 }, { s: 'bat', x: 159, y: 30 }, { s: 'bat', x: 432, y: 40 },
      { s: 'jack', x: 226, y: 84, z: BAR }, { s: 'jack', x: 334, y: 84, z: BAR },
      { s: 'jack', x: 112, y: 90 },                    // on the floor against the wall, by the cue rack
      { s: 'candy', x: 339, y: 210, z: GR_TABLE },
      { s: 'webspider', x: 6, y: 4, z: 20, peak: true },
      { s: 'ghost', x: 433, y: 56, z: 70, peak: true },
      { s: 'jack', x: 44, y: 132, peak: true },
    ],
    thanksgiving: [
      { s: 'cornucopia', x: 332, y: 207, z: GR_TABLE },
      { s: 'pumpkin', x: 226, y: 84, z: BAR }, { s: 'pumpkin', x: 334, y: 84, z: BAR }, { s: 'pumpkin', x: 112, y: 90 },
    ],
    christmas: [
      // in the bottom-left corner, beside the poker table (the top-left corner is the darts' watchers')
      { s: 'tree', x: 4, y: 258 },
      { s: 'presents', x: 5, y: 302, z: 323, presents: true },
      { s: 'snowglobe', x: 342, y: 206, z: GR_TABLE },
    ],
  },
};

// ─── The DnD room (a stone chamber: x 0-216) ────────────────────────────────────────────────────────────────
// Its own look: holly on the mantel, a yule log on the hearth, carved gourds for Halloween, the treasure chest's pot
// of gold. Wall: under the two banners (x 64-100 and 138-172, y 60-98). The mantel shelf (x 12-56, y 40).
const dnd: RoomDecor = {
  alwaysLit: true,                                       // (candlelit, and no window: the lanterns burn all day)
  runs: [[12, 41, 44, 60], [100, 37, 38, 60]],
  garland: { christmas: 'g-holly', newyear: 'g-pennants' },
  pieces: {
    newyear: [
      { s: 'partyhats', x: 15, y: 262, z: 300 },        // on the chest
      { s: 'confetti', x: 76, y: 244, z: 2 },
    ],
    valentine: [
      { s: 'heart0', x: 74, y: 66 }, { s: 'heart1', x: 148, y: 66 },
      { s: 'chocolates', x: 18, y: 262, z: 300 },
    ],
    stpatrick: [
      { s: 'shamrock', x: 76, y: 66 }, { s: 'shamrock', x: 150, y: 66 },
      { s: 'potofgold', x: 44, y: 282 },                // by the treasure chest
    ],
    easter: [
      { s: 'basket', x: 176, y: 86 },
      { s: 'egg0', x: 44, y: 284 }, { s: 'egg2', x: 58, y: 90 }, { s: 'egg4', x: 90, y: 88 }, { s: 'egg1', x: 192, y: 282 }, { s: 'egg3', x: 44, y: 212 },
    ],
    july4: [],
    halloween: [
      { s: 'web', x: 6, y: 4, z: 20 }, { s: 'web', x: 184, y: 4, z: 20, flip: true },
      { s: 'bat', x: 66, y: 66 }, { s: 'bat', x: 146, y: 66 },
      { s: 'gourd', x: 42, y: 24, z: 46 },               // on the mantel
      { s: 'gourd', x: 58, y: 88 }, { s: 'gourd', x: 44, y: 278 },
      { s: 'webspider', x: 6, y: 4, z: 20, peak: true },
      { s: 'ghost', x: 160, y: 68, z: 90, peak: true },
      { s: 'gourd', x: 84, y: 84, peak: true },
    ],
    thanksgiving: [
      { s: 'cornucopia', x: 44, y: 280 },
      { s: 'pumpkin', x: 58, y: 88 }, { s: 'pumpkin', x: 84, y: 84 },
    ],
    christmas: [
      { s: 'yulelog', x: 16, y: 94, z: 108 },
    ],
  },
};

// ─── The unfinished basement ────────────────────────────────────────────────────────────────────────────────
// Garlands hang from the pipe along the top of the wall. The bare wall right of the trophy rack (x 290-364; the rack is
// x 226-286, y 34-90, and stays clear) and left of the broom (x 184-200) take the wall things; the workbench (x 82-128, top y 84) and the mini fridge (x 303-318) the
// small things.
const BENCH = 112, MINIFRIDGE = 260;
const unfinished: RoomDecor = {
  runs: [[6, 29, 138, 40], [184, 29, 256, 40]],
  pieces: {
    newyear: [
      { s: 'banner', x: 291, y: 46, z: 60 },
      { s: 'partyhats', x: 296, y: 231, z: MINIFRIDGE },
      { s: 'confetti', x: 230, y: 256, z: 2 },
      { s: 'balloons', x: 206, y: 214, z: 246 },
    ],
    valentine: [
      { s: 'heart0', x: 188, y: 46 }, { s: 'heart1', x: 296, y: 46 }, { s: 'heart2', x: 330, y: 62 }, { s: 'heart0', x: 348, y: 40 },
      { s: 'chocolates', x: 300, y: 229, z: MINIFRIDGE },
    ],
    stpatrick: [
      { s: 'shamrock', x: 189, y: 46 }, { s: 'shamrock', x: 298, y: 46 }, { s: 'shamrock', x: 332, y: 62 }, { s: 'shamrock', x: 350, y: 40 },
      { s: 'potofgold', x: 208, y: 236 },
    ],
    easter: [
      { s: 'basket', x: 320, y: 242 },
      { s: 'bunny', x: 98, y: 68, z: BENCH },
      { s: 'egg0', x: 464, y: 288 }, { s: 'egg1', x: 96, y: 300 }, { s: 'egg2', x: 140, y: 120 }, { s: 'egg3', x: 368, y: 280 },
      { s: 'egg4', x: 212, y: 96 }, { s: 'egg0', x: 184, y: 96 },
    ],
    july4: [
      { s: 'fan', x: 312, y: 50 },
      { s: 'flags', x: 299, y: 220, z: MINIFRIDGE },
    ],
    halloween: [
      { s: 'web', x: 6, y: 30, z: 40 }, { s: 'web', x: 496, y: 4, z: 20, flip: true },
      { s: 'bat', x: 184, y: 44 }, { s: 'bat', x: 296, y: 44 }, { s: 'bat', x: 326, y: 62 }, { s: 'bat', x: 346, y: 40 },
      { s: 'jack', x: 372, y: 62, z: BENCH },           // on the washer
      { s: 'jack', x: 84, y: 70, z: BENCH },            // on the workbench
      { s: 'jack', x: 214, y: 236 },
      { s: 'candy', x: 300, y: 232, z: MINIFRIDGE },
      { s: 'webspider', x: 6, y: 30, z: 40, peak: true },
      { s: 'ghost', x: 186, y: 60, z: 90, peak: true },
      { s: 'jack', x: 196, y: 92, peak: true },
    ],
    thanksgiving: [
      { s: 'cornucopia', x: 88, y: 72, z: BENCH },
      { s: 'pumpkin', x: 372, y: 62, z: BENCH }, { s: 'pumpkin', x: 214, y: 236 },
    ],
    christmas: [
      { s: 'tree', x: 8, y: 84 },
      { s: 'presents', x: 9, y: 126, z: 148, presents: true },
      { s: 'snowglobe', x: 100, y: 72, z: BENCH },
    ],
  },
};

// ─── The karaoke lounge ─────────────────────────────────────────────────────────────────────────────────────
// Wall: under the neon on the left (x 6-60), and the wall right of the line-up board (x 426-522). The stage's two
// speakers (left x 150-170, right x 356-376, top y ~100) hold the small things; stockings hang along the stage's edge.
const SPEAKER = 138;
const karaoke: RoomDecor = {
  alwaysLit: true,
  runs: [[6, 4, 138, 20], [384, 4, 138, 20]],
  stockings: [186, 132, 26, 146],
  pieces: {
    newyear: [
      { s: 'banner', x: 440, y: 30, z: 40 },
      { s: 'partyhats', x: 146, y: 88, z: SPEAKER },
      { s: 'confetti', x: 236, y: 220, z: 2 },
      { s: 'balloons', x: 486, y: 104, z: 146 },
    ],
    valentine: [
      { s: 'heart0', x: 14, y: 54 }, { s: 'heart1', x: 36, y: 68 }, { s: 'heart2', x: 438, y: 24 }, { s: 'heart0', x: 472, y: 44 },
      { s: 'heart1', x: 502, y: 24 }, { s: 'heart2', x: 494, y: 64 },
      { s: 'chocolates', x: 150, y: 86, z: SPEAKER },
    ],
    stpatrick: [
      { s: 'shamrock', x: 16, y: 54 }, { s: 'shamrock', x: 38, y: 68 }, { s: 'shamrock', x: 440, y: 24 }, { s: 'shamrock', x: 474, y: 44 },
      { s: 'shamrock', x: 504, y: 24 },
      { s: 'potofgold', x: 392, y: 95 },
    ],
    easter: [
      { s: 'basket', x: 392, y: 93 },
      { s: 'bunny', x: 153, y: 81, z: SPEAKER },
      { s: 'egg0', x: 44, y: 140 }, { s: 'egg1', x: 512, y: 200 }, { s: 'egg2', x: 128, y: 126 }, { s: 'egg3', x: 512, y: 280 }, { s: 'egg4', x: 30, y: 300 },
    ],
    july4: [
      { s: 'fan', x: 196, y: 126, z: 146 }, { s: 'fan', x: 302, y: 126, z: 146 },
      { s: 'flags', x: 149, y: 77, z: SPEAKER },
    ],
    halloween: [
      { s: 'web', x: 6, y: 4, z: 20 }, { s: 'web', x: 496, y: 4, z: 20, flip: true },
      { s: 'bat', x: 12, y: 54 }, { s: 'bat', x: 34, y: 70 }, { s: 'bat', x: 436, y: 30 }, { s: 'bat', x: 468, y: 50 }, { s: 'bat', x: 440, y: 70 },
      { s: 'jack', x: 151, y: 86, z: SPEAKER }, { s: 'jack', x: 357, y: 86, z: SPEAKER },
      { s: 'candy', x: 394, y: 97 },
      { s: 'webspider', x: 6, y: 4, z: 20, peak: true },
      { s: 'ghost', x: 498, y: 40, z: 70, peak: true },
      { s: 'jack', x: 128, y: 124, peak: true },
    ],
    thanksgiving: [
      { s: 'cornucopia', x: 390, y: 94 },
      { s: 'pumpkin', x: 151, y: 86, z: SPEAKER }, { s: 'pumpkin', x: 357, y: 86, z: SPEAKER },
    ],
    christmas: [
      { s: 'tree', x: 474, y: 84 },
      { s: 'presents', x: 472, y: 128, z: 147, presents: true },
      { s: 'snowglobe', x: 154, y: 86, z: SPEAKER },
    ],
  },
};

export const ROOMS: Record<string, RoomDecor> = { club, gameroom, dnd, unfinished, karaoke };

/** Where each stocking hangs: `slots` are the desks of the people they are for (the clubhouse: each on the front of its
 *  owner's desk, right of the chair), or simply 0, 1, 2... along the room's ledge. */
export function stockingSpots(r: RoomDecor, slots: number[]): { x: number; y: number; z: number; slot: number }[] {
  const s = r.stockings;
  if (!s) return [];
  if (s === 'desks') return slots.filter((k) => k < CLUB.pcs.length).map((k) => ({ x: CLUB.pcs[k].x + 12, y: 103, z: 123, slot: k }));
  const [x, y, step, z] = s;
  return slots.slice(0, 7).map((k, n) => ({ x: x + n * step, y, z, slot: k }));
}
