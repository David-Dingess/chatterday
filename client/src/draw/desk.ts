// Draws a desk. Every desk in the house is the same desk: one screen, a tower, a gaming chair. Two things are
// the sitter's own: the colour of its lights (the stripes on the chair take it too), and the one thing they keep
// on it. It comes out as three pictures of the same size that stack: the desk with everything on it, the chair's
// seat, and the chair's back (which goes in front of whoever sits there).
//
// Everything is measured from the desk's origin: the top-left corner of the desk top is one dot right of it.
// The desk top runs from x 1 to 48 and y 0 to 15. The thing on the desk stands on its left corner; the tower is
// at the right end.

import { Cv, Mat, rgb, rows } from './kit.ts';
import type { Picture, RGB } from './kit.ts';
import type { Desk } from '../../../shared/desk.ts';

export type DeskArt = {
  /** where the pictures' top-left corner is, relative to the desk's origin */
  ox: number; oy: number;
  /** desk, legs, screen, tower, pad, keyboard, mouse and the thing on it: outlined as one piece */
  desk: Picture;
  /** the chair's seat and base: outlined */
  chair: Picture;
  /** the chair back, drawn in FRONT of whoever sits there: outlined */
  back: Picture;
  /** the screen's glass as [x, y, w, h] relative to the desk's origin */
  screens: number[][];
  /** the tower's fans as [x, y] relative to the origin */
  fans: number[][];
};

const W = 58, H = 91;                 // room for x -4..53 and y -30..60 round the origin
const dx = 4, dy = 30;                // where the origin is on the canvas
const cy = dy + 8;                    // the chair sits a little back
const INK: RGB = [26, 18, 40];

/** Where things are on the desk top, as [x, y, w, h] from the origin. */
export const PAD_BOX = [10, 3, 30, 12];
export const KEYS_BOX = [11, 8, 11, 4];
export const MOUSE_BOX = [37, 10, 2, 3];
/** What holds the screen up: nothing else may stand there. */
export const STANDS = [[20, -3, 4, 4], [17, 1, 10, 2]];
/** The corner the thing on the desk stands on. */
export const ITEM_SPOT = [1, 4, 8, 11];

/** The dark dot round a finished piece, the way the rest of the room is edged. */
function edged(cv: Cv): Cv {
  const out = new Cv(cv.w, cv.h);
  out.a.set(cv.a);
  for (let y = 0; y < cv.h; y++) for (let x = 0; x < cv.w; x++) {
    if (cv.a[(y * cv.w + x) * 4 + 3]) continue;
    for (const [ax, ay] of [[0, 1], [1, 0], [-1, 0], [0, -1]]) {
      const n = cv.get(x + ax, y + ay);
      if (n) { out.px(x, y, [Math.floor(n[0] * 0.28 + INK[0] * 0.72), Math.floor(n[1] * 0.28 + INK[1] * 0.72), Math.floor(n[2] * 0.28 + INK[2] * 0.72)]); break; }
    }
  }
  return out;
}

const picture = (c: Cv): Picture => ({ w: c.w, h: c.h, data: c.a });
/** Looks a choice up by its id; an id that is not in the table gives nothing (even 'constructor' and the like). */
const own = <T>(table: Record<string, T>, id: unknown): T | undefined => (typeof id === 'string' && Object.hasOwn(table, id) ? table[id] : undefined);

/** A little picture from rows of letters; '.' leaves the dot alone. */
function stamp(c: Cv, x: number, y: number, lines: readonly string[], tones: Record<string, RGB>) {
  lines.forEach((line, j) => { for (let i = 0; i < line.length; i++) { const t = tones[line[i]]; if (t) c.px(x + i, y + j, t); } });
}

// ───────────────────────── the thing on the desk: up to 8 wide and 11 tall ─────────────────────────

type Thing = { art: string[]; tones: Record<string, string> };
const THINGS: Record<string, Thing> = {
  mug: {
    art: ['.wwwww..', 'wbbbbbw.', 'wwwwwwww', 'wwwwws.w', 'swwwwsww', '.sssss..'],
    tones: { w: '#f4f1e9', s: '#c2bdb2', b: '#5a3a26' },
  },
  can: {
    art: ['.sss.', 'sSSSs', 'ggggg', 'gGggd', 'wwwww', 'wwwww', 'gGggd', 'gGggd', '.ddd.'],
    tones: { s: '#cfd6e2', S: '#8d93ab', g: '#2fae8a', G: '#7fe0c0', d: '#1f7a62', w: '#f4f6f9' },
  },
  books: {
    art: ['.gggggg.', '.gppppp.', 'bbbbbb..', 'bppppp..', 'rrrrrrr.', 'rpppppp.'],
    tones: { g: '#3f8f5a', b: '#3b5fb0', r: '#a8323a', p: '#efe6cf' },
  },
  plant: {
    art: ['...g....', '.g.gG.g.', '.gGgGgG.', 'ggGgGGgg', '.gGGGGg.', '..gGGg..', '.tttttt.', '.tTtttT.', '..tttT..', '..tttT..'],
    tones: { g: '#5cb85f', G: '#2f7a43', t: '#c9703a', T: '#9a4f26' },
  },
  cactus: {
    art: ['...f...', '..ggG..', 'g.ggG..', 'g.ggG.g', 'ggggG.g', '..ggGgg', '..ggG..', '.tttttt', '..tttT.', '..tttT.'],
    tones: { g: '#6dbb5f', G: '#3f8a45', f: '#f08ab0', t: '#c9703a', T: '#9a4f26' },
  },
  lamp: {
    art: ['.rrrr...', 'rrrrrR..', 'rrrrrRk.', '.yyyy.k.', '......k.', '.....k..', '....k...', '....k...', '..kkkkk.', '.kkkkkkk'],
    tones: { r: '#e5484d', R: '#a8323a', y: '#ffe97a', k: '#8d93ab' },
  },
  lavalamp: {
    art: ['..ss..', '.ssss.', '.pppp.', '.poop.', '.pOop.', '.pppp.', '.popp.', '.pooP.', '.pppp.', '.ssss.', 'ssssss'],
    tones: { s: '#aab0c2', p: '#7a3fb0', P: '#5a2a8a', o: '#f08a24', O: '#ffc24a' },
  },
  candle: {
    art: ['..y...', '.yoy..', '..o...', '..k...', '.wwww.', '.wwwW.', '.wwwW.', '.wwwW.', 'bbbbbb'],
    tones: { y: '#ffe26a', o: '#f08a24', k: '#3a2a20', w: '#f4ead2', W: '#d2c2a0', b: '#c9a24a' },
  },
  clock: {
    art: ['rr...rr', '.rrrrr.', 'rwwkwwr', 'rwwkwwr', 'rwwkkwr', 'rwwwwwr', '.rRRRr.', 'R.....R'],
    tones: { r: '#e5484d', R: '#a8323a', w: '#f4f6f9', k: '#22242f' },
  },
  frame: {
    art: ['bbbbbbbb', 'bsssssyb', 'bssssssb', 'bsgssssb', 'bgggsggb', 'bggggggb', 'BBBBBBBB', '.B....B.'],
    tones: { b: '#a8744a', B: '#6b4428', s: '#8fc7ea', y: '#ffd84a', g: '#4f9a4a' },
  },
  globe: {
    art: ['..bbb..', '.bggbb.', 'bgggbbb', 'bbggbgb', 'bbbgbgb', '.bbbbb.', '..bbb..', '...k...', '..kkk..', '.kkkkk.'],
    tones: { b: '#3b8fd0', g: '#5cb85f', k: '#c9a24a' },
  },
  snowglobe: {
    art: ['..ccc..', '.cwccc.', 'cccgcwc', 'cwgggcc', 'ccgggcc', '.wwwww.', 'bbbbbbb', 'bBBBBBb'],
    tones: { c: '#bfe3f5', w: '#ffffff', g: '#2f7a43', b: '#a8744a', B: '#6b4428' },
  },
  trophy: {
    art: ['ggggggg', 'gGggdgg', 'g.Ggd.g', '.gGgdg.', '..ggd..', '...g...', '...g...', '..kkk..', '.kkkkk.'],
    tones: { g: '#f2c14e', G: '#fff0a8', d: '#b8862a', k: '#5f3c27' },
  },
  duck: {
    art: ['..yyy...', '.yykyoo.', '.yyyy...', 'yyyyyy.y', 'yyyyyyyy', 'yYyyyyy.', '.YYYYY..'],
    tones: { y: '#ffd84a', Y: '#e0a82a', o: '#f08a24', k: '#22242f' },
  },
  robot: {
    art: ['...r...', '...s...', '.sssss.', '.sysys.', '.sssss.', 'sbbbbbs', 's.byb.s', '..bbb..', '..s.s..', '.ss.ss.'],
    tones: { r: '#e5484d', s: '#c2c8d6', y: '#ffd84a', b: '#3b8fd0' },
  },
  controller: {
    art: ['.kk..kk.', 'kkkkkkkk', 'kwkkkgrk', 'kkkkkkkk', 'kk....kk'],
    tones: { k: '#8f96b0', w: '#2b2e3c', g: '#63d483', r: '#ff6a6e' },
  },
  headphones: {
    art: ['.kkkkk.', 'k.....k', 'k..s..k', 'cc.s.cc', 'cc.s.cc', 'cc.s.cc', '...s...', '...s...', '.sssss.', 'sssssss'],
    tones: { k: '#4a4d62', c: '#e5484d', s: '#c2c8d6' },
  },
  soccer: {
    art: ['..wwww..', '.wkwwkw.', 'wwwwwwww', 'wkwkkwkw', 'wwwkkwww', 'wwwwwwww', '.wkwwkw.', '..wwww..'],
    tones: { w: '#f4f6f9', k: '#1b1c26' },
  },
  baseball: {
    art: ['..wwww..', '.rwwwwr.', 'wwrwwrww', 'wwrwwrww', 'wwrwwrww', 'wwrwwrww', '.rwwwwr.', '..wwww..'],
    tones: { w: '#f8f5ea', r: '#d0222f' },
  },
  basketball: {
    art: ['..oko..', '.ookoo.', 'kookook', 'kkkkkkk', 'kookook', '.ookoo.', '..oko..'],
    tones: { o: '#e8782a', k: '#5a2a14' },
  },
  lunchbag: {
    art: ['.f.f.f.', 'fffffff', 'ppppppP', 'ppppppP', 'pfffppP', 'ppppppP', 'ppppppP', 'ppppppP', 'PPPPPPP'],
    tones: { p: '#c9a26a', P: '#a07a48', f: '#b08a54' },
  },
  sandwich: {
    art: ['..BBBB..', '.bBBBBb.', 'wgrgrggw', 'wbbbbbbw', 'WwwwwwwW', '.WWWWWW.'],
    tones: { b: '#d99a4a', B: '#f0c88a', g: '#5f9e3a', r: '#d8342c', w: '#f4f6f9', W: '#c2c8d6' },
  },
  fishbowl: {
    art: ['..cccc..', '.c....c.', 'cbbbbbbc', 'cbboobbc', 'cbooobbc', 'cbbbbbbc', '.cyyyyc.', '..cccc..'],
    tones: { c: '#cfeaf7', b: '#4f9cd8', o: '#f08a24', y: '#d8c48a' },
  },
  pencils: {
    art: ['.y..g.', '.y.rg.', '.y.rg.', 'kkkkkk', 'kkkkkK', 'kkkkkK', 'kkkkkK', '.kkkK.'],
    tones: { y: '#f2c81e', r: '#e5484d', g: '#3fa55a', k: '#3b5fb0', K: '#2a4486' },
  },
};

/** Where the item's picture goes: [x, y, w, h] from the origin. It stands on the bottom edge of its corner. */
function thingBox(id: string): number[] | null {
  const t = own(THINGS, id);
  if (!t) return null;
  const w = Math.max(...t.art.map((r) => r.length)), h = t.art.length, [sx, sy, sw, sh] = ITEM_SPOT;
  return [sx + Math.floor((sw - w) / 2), sy + sh - h, w, h];
}

function drawThing(c: Cv, id: string) {
  const box = thingBox(id), t = own(THINGS, id);
  if (!box || !t) return;
  const tones: Record<string, RGB> = {};
  for (const k of Object.keys(t.tones)) tones[k] = rgb(t.tones[k]);
  const solid = (i: number, j: number) => j >= 0 && j < t.art.length && i >= 0 && i < t.art[j].length && !!tones[t.art[j][i]];
  // a soft dark edge on the desk round it, so it stands out from the desk top
  for (let j = -1; j <= box[3]; j++) for (let i = -1; i <= box[2]; i++) {
    if (!solid(i, j) && (solid(i + 1, j) || solid(i - 1, j) || solid(i, j + 1) || solid(i, j - 1))) c.tint(dx + box[0] + i, dy + box[1] + j, INK, 0.42);
  }
  stamp(c, dx + box[0], dy + box[1], t.art, tones);
}

// ───────────────────────── the desk ─────────────────────────

const HEX = /^#[0-9a-f]{6}$/i;
const TOP = new Mat('#363a4e', { hi: '#4d5270', lo: '#20222d' });

/** The colour of a desk's lights: the one its sitter picked for it, or else the sitter's own colour. */
export const ledOf = (desk: Desk | null | undefined, accent: string) => (desk && typeof desk.led === 'string' && HEX.test(desk.led) ? desk.led : HEX.test(accent) ? accent : '#8f5fe0');

/** A desk for whoever is sitting at it: `accent` is their own colour, used when they have not picked one for the desk. */
export function drawDesk(desk: Desk, accent: string): DeskArt {
  const light = rgb(ledOf(desk, accent));
  const frame = rgb('#2d3040'), glass = rgb('#0c0f17'), black = rgb('#15161d');
  const screens: number[][] = [], fans: number[][] = [];
  const dark = new Mat('#1d1f29', { hi: '#3a3d50', lo: '#101117' });

  const deskCv = new Cv(W, H);
  {
    const c = deskCv;
    c.rect(dx + 2, dy + 16, dx + 3, dy + 32, TOP.lo);                      // legs
    c.rect(dx + 46, dy + 16, dx + 47, dy + 32, TOP.lo);
    c.part(rows(dx + 1, dy, dx + 48, dy + 15), TOP, 't', '');              // the top
    c.part(rows(dx + 1, dy + 16, dx + 48, dy + 22), new Mat(TOP.lo), '', 'b');
    // the deskpad, in the middle of the desk, with the keyboard and the mouse on it
    const px0 = dx + PAD_BOX[0];
    c.rect(px0, dy + 3, px0 + PAD_BOX[2] - 1, dy + 3 + PAD_BOX[3] - 1, rgb('#191b25'));
    c.rect(px0 + 1, dy + 8, px0 + 11, dy + 11, rgb('#2b2e3c'));            // keyboard
    for (let x = px0 + 2; x < px0 + 11; x += 2) { c.px(x, dy + 9, rgb('#8d93ab')); c.px(x, dy + 10, rgb('#5b6079')); }
    c.rect(px0 + 27, dy + 10, px0 + 28, dy + 12, rgb('#dfe2ea'));          // mouse
    c.px(px0 + 27, dy + 10, rgb('#8d93ab')); c.px(px0 + 28, dy + 10, rgb('#8d93ab'));
    // the screen: its stand, then the glass
    for (const [x, y, w, h] of STANDS) c.rect(dx + x, dy + y, dx + x + w - 1, dy + y + h - 1, black);
    c.rect(dx + 8, dy - 21, dx + 35, dy - 3, frame);
    c.rect(dx + 9, dy - 20, dx + 34, dy - 5, glass);
    screens.push([9, -20, 26, 16]);
    // the tower, at the right end of the desk, with a glass side
    c.part(rows(dx + 38, dy - 16, dx + 47, dy + 3), dark, 'tl', 'rb');
    c.rect(dx + 40, dy - 13, dx + 45, dy, rgb('#0b0c12'));
    fans.push([40, -13], [40, -6]);
    if (desk && desk.item !== 'none') drawThing(c, desk.item);             // their thing, on the left corner
  }

  // the chair's seat, post and feet
  const chairCv = new Cv(W, H);
  chairCv.part(rows(dx + 17, cy + 38, dx + 32, cy + 41), new Mat('#262733', { hi: '#3d3f52', lo: '#15161d' }), 't', 'b');
  chairCv.rect(dx + 24, cy + 44, dx + 25, cy + 45, rgb('#3a3c4c'));
  chairCv.part([[cy + 46, dx + 20, dx + 29], [cy + 47, dx + 19, dx + 30]], new Mat('#2a2b37', { hi: '#3d3f52', lo: '#15161d' }), 't', 'b');

  // its back: a gaming chair with a winged headrest, striped in the colour of the desk's lights
  const backCv = new Cv(W, H);
  backCv.part([[cy + 28, dx + 21, dx + 28], [cy + 29, dx + 19, dx + 30], [cy + 30, dx + 18, dx + 31], [cy + 31, dx + 18, dx + 31],
    ...rows(dx + 16, cy + 32, dx + 33, cy + 43)], new Mat('#262733', { hi: '#42455a', lo: '#15161d' }), 't', 'rb');
  backCv.rect(dx + 18, cy + 33, dx + 19, cy + 42, light);
  backCv.rect(dx + 30, cy + 33, dx + 31, cy + 42, light);
  backCv.rect(dx + 22, cy + 29, dx + 27, cy + 30, light);
  backCv.rect(dx + 21, cy + 39, dx + 28, cy + 41, rgb('#34364a'));         // lumbar cushion

  return { ox: -dx, oy: -dy, desk: picture(edged(deskCv)), chair: picture(edged(chairCv)), back: picture(edged(backCv)), screens, fans };
}

/** Where the thing on a desk is, as [x, y, w, h] from the origin (null with nothing on it): for checking it sits clear of everything else. */
export const itemBox = (desk: Desk): number[] | null => (desk.item === 'none' ? null : thingBox(desk.item));
