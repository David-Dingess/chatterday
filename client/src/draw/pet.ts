// Draws a pet from what its owner picked: a sheet of 24px frames, four across and seven rows down.
// Rows, top to bottom: walk down, walk left (mirror it for right), walk up, sit (sit, sit, blink, tail flick),
// eat (head down, facing left), sleep, being petted (eyes shut). Feet are on row 21.
//
// A cat and a dog are each drawn from a "spec": the exact tones and the head as rows of letters. `catSpec` and
// `dogSpec` make a spec from a PetLook; the frame drawing underneath does not know about the builder at all.

import { Cv, Mat, hex, mix, outlined, rgb, same, sheetOf } from './kit.ts';
import type { Picture, RGB, Span } from './kit.ts';
import type { PetLook } from '../../../shared/pet.ts';

const F = 24;
const INK: RGB = rgb('#22232b');
const PINK: RGB = rgb('#e79aa6');
const GOLD: RGB = rgb('#f2c14e');
const DEEP: RGB = [20, 16, 30];
const PALE: RGB = [255, 250, 236];

/** One leg in a side view: where it is (x), whether it is on the far side, and how far it is lifted. */
type Leg = readonly [number, boolean, number];
type Pt = readonly [number, number];
type View = 'front' | 'sit' | 'side' | 'back' | 'rest';

// a walk in four beats: near front and far back reach forward, the legs pass, then the other pair reach
const STAND: Leg[] = [[9, false, 0], [12, true, 0], [15, true, 0], [18, false, 0]];
const REACH: Leg[] = [[8, false, 1], [12, true, 0], [14, true, 1], [18, false, 0]];
const PASS1: Leg[] = [[10, false, 0], [17, false, 0]];
const BACK: Leg[] = [[11, false, 0], [8, true, 1], [15, false, 1], [18, true, 0]];
const PASS2: Leg[] = [[9, false, 0], [16, false, 0]];

const luma = (c: RGB) => (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
/** Dots in a loose diamond grid, the same wherever the body is. */
const dotted = (x: number, y: number) => y % 2 === 0 && (((x + y) % 4) + 4) % 4 === 0;

/** A number from 0 to 7 that changes every two dots, for blotchy coats. */
function blotch(x: number, y: number): number {
  const v = y >> 1, u = (x + (v % 2)) >> 1;
  let h = (Math.imul(u, 374761393) + Math.imul(v, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h ^ (h >>> 16)) % 8;
}

// ───────────────────────── cats ─────────────────────────

export type CatSpec = {
  /** coat, its dark and light tones, the white bits, and the legs on the far side */
  g: string; d: string; l: string; w?: string; far: string;
  eye: string; nose?: string;
  /** the face, the same face with the eyes shut (one row swapped), and the back of the head; letters are tones */
  head: string[]; headBack: string[]; eyeRow: number; shut: string;
  stripes?: boolean; fluffy?: boolean; tailStripes?: boolean;
  /** 'w' white, 'l' light, 's' barely lighter, anything else none */
  chest?: string; sideChest?: string;
  /** which paws are white: 'all', 'front' or 'none' */
  paws?: string;
  // ── everything below is optional extras for the builder ──
  /** the second colour, for patches and points */
  p?: string;
  /** a white paw on the far side */
  farW?: string;
  /** whole legs in another colour */
  leg?: string;
  belly?: string;
  tailCol?: string;
  /** 'thin', 'fluffy' or 'bob' */
  tail?: string;
  /** how much wider the body is from the front, and how much taller from the side */
  f?: number; high?: number;
  /** 'spots', 'patches' or 'tortie' */
  marks?: string;
  /** small touches the builder's cats get: shade beside the tail from behind so it can be seen, and nothing touching the frame's edge */
  neat?: boolean;
  /** 'collar', 'bell' or 'bow' */
  collar?: string; collarColor?: string;
};

/** The seven rows of a cat. */
export function catFrames(s: CatSpec): Cv[][] {
  const G = rgb(s.g), D = rgb(s.d), L = rgb(s.l), W = rgb(s.w ?? '#f6f5f1'), FAR = rgb(s.far);
  const P = rgb(s.p ?? s.d), Q = mix(P, INK, 0.7);
  const tones: Record<string, RGB> = { g: G, d: D, l: L, w: W, y: rgb(s.eye), k: INK, n: rgb(s.nose ?? '#e79aa6'), p: P, q: Q, h: mix(P, PALE, 0.45) };
  const head = s.head, backHead = s.headBack;
  const shutHead = [...head.slice(0, s.eyeRow), s.shut, ...head.slice(s.eyeRow + 1)];
  const wide = Math.floor((head[0].length - 9) / 2);      // a fluffy face is wider
  const tall = head.length - 7;                            // pointed ears stand higher than folded ones
  const stripes = !!s.stripes, fluffy = !!s.fluffy;
  const f = s.f ?? (fluffy ? 1 : 0), high = s.high ?? (fluffy ? 1 : 0);
  const chestKey = s.chest ?? 'w';
  const chest: RGB | null = chestKey === 'w' ? W : chestKey === 'l' ? L : chestKey === 's' ? mix(G, L, 0.5) : null;   // the bib, seen from the front
  const sideChest = (s.sideChest ?? s.chest ?? 'w') === 'w';
  const pawsKey = s.paws ?? 'all';
  const LEG = s.leg ? rgb(s.leg) : G;
  const paw = {
    front: s.leg ? LEG : pawsKey === 'all' || pawsKey === 'front' ? W : G,
    back: s.leg ? LEG : pawsKey === 'all' ? W : G,
  };
  const FARW = rgb(s.farW ?? '#c9cbd0');
  const farLeg = !s.leg ? FAR : same(LEG, W) ? FARW : mix(LEG, INK, 0.3);
  const farPaw = (v: RGB) => (same(v, W) ? FARW : farLeg);
  const tailKind = s.tail ?? (fluffy ? 'fluffy' : 'thin');
  const bob = tailKind === 'bob';
  const tw = tailKind === 'fluffy' ? 3 : 2;
  const TA = s.tailCol ? rgb(s.tailCol) : G;
  const TB = s.tailCol ? TA : (s.tailStripes ?? stripes) ? D : G;
  const COLLAR = s.collar && s.collar !== 'none' ? rgb(s.collarColor ?? '#d8342c') : null;

  function tailUp(c: Cv, pts: Pt[]) {
    pts.forEach(([x, y], i) => { for (let k = 0; k < tw; k++) if (!s.neat || x + k < F - 1) c.px(x + k, y, i % 2 ? TB : TA); });
  }

  /** The coat's markings on the body. Only ever paints over plain coat, so bibs, paws and shading are left alone. */
  function marks(c: Cv, view: View, b: number, top = 0) {
    const on = (x: number, y: number, col: RGB) => { if (same(c.get(x, y), G)) c.px(x, y, col); };
    const box = (x0: number, y0: number, x1: number, y1: number, col: RGB) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) on(x, y, col); };
    if (s.marks === 'spots') {
      const [y0, y1] = view === 'sit' ? [14, 19] : view === 'rest' ? [top + 1, 20] : view === 'side' ? [13 - high + b, 17 + b] : [14 + b, 19 + b];
      for (let y = y0; y <= y1; y++) for (let x = 0; x < F; x++) if (dotted(x, y - b)) on(x, y, D);
    } else if (s.marks === 'patches') {
      if (view === 'side') { box(12, 13 - high + b, 15, 15 - high + b, P); box(17, 15 + b, 19, 17 + b, Q); }
      else if (view === 'front') { box(8 - f, 14 + b, 10, 16 + b, P); box(13, 17 + b, 15 + f, 19 + b, Q); }
      else if (view === 'sit') { box(8 - f, 14, 10, 16, P); box(13, 18, 16 + f, 20, Q); }
      else if (view === 'back') { box(12, 14 + b, 15 + f, 16 + b, P); box(8 - f, 17 + b, 10, 19 + b, Q); }
      else { box(11, top + 1, 14, top + 3, P); box(16, top + 2, 19, top + 4, Q); }
    }
  }

  /** Flecks of the second colour through the whole coat. */
  function flecks(c: Cv, b: number): Cv {
    if (s.marks !== 'tortie') return c;
    for (let y = 0; y < F; y++) for (let x = 0; x < F; x++) {
      if (!same(c.get(x, y), G)) continue;
      const n = blotch(x, y < 19 ? y - b : y);
      if (n < 3) c.px(x, y, P);
      else if (n === 3) c.px(x, y, Q);
    }
    return c;
  }

  /** Facing left. Far legs are drawn first and darker, and every leg keeps a clear gap from the next, so they read as legs. */
  function side(legs: Leg[], o: { bob?: number; headAt?: Pt; wag?: number; shut?: boolean } = {}): Cv {
    const b = o.bob ?? 0, headAt = o.headAt ?? [2, 8], wag = o.wag ?? 0;
    const c = new Cv(F, F);
    tailUp(c, bob ? [[19, 13 + b], [20, 12 + b], [20 + wag, 12 + b]]
      : [[19, 14 + b], [20, 13 + b], [20 + wag, 12 + b], [20 + wag, 11 + b], [19 + wag, 10 + b], [19 + wag, 9 + b]]);
    c.rect(8, 13 - high + b, 19, 18 + b, G);
    c.rect(9, 18 + b, 18, 18 + b, s.belly === 'w' ? W : L);                 // belly
    if (stripes) for (const x of [11, 13, 15, 17]) c.rect(x, 13 + b, x, 15 + b, D);      // tabby stripes down the side
    if (sideChest) c.rect(8, 15 + b, 9 + (fluffy ? 1 : 0), 18 + b, W);
    for (const [x, far, lift] of [...legs.filter((l) => l[1]), ...legs.filter((l) => !l[1])]) {
      const which = x <= 12 ? 'front' : 'back';
      c.rect(x, 19, x + 1, 20 - lift, far ? farLeg : LEG);
      c.rect(x, 21 - lift, x + 1, 21 - lift, far ? farPaw(paw[which]) : paw[which]);
    }
    marks(c, 'side', b);
    if (COLLAR) {                                                           // what shows of it under the chin
      c.px(10 + wide, 13 + b, COLLAR); c.px(9 + wide, 14 + b, COLLAR); c.px(8 + wide, 15 + b, COLLAR);
      if (s.collar === 'bell') c.px(8 + wide, 16 + b, GOLD);
      if (s.collar === 'bow') { c.px(9 + wide, 15 + b, COLLAR); c.px(8 + wide, 16 + b, COLLAR); }
    }
    c.ascii(o.shut ? shutHead : head, tones, s.neat ? Math.max(1, headAt[0] - wide) : headAt[0] - wide, headAt[1] - tall + b);
    return flecks(c, b);
  }

  function collarFront(c: Cv, y: number) {
    if (!COLLAR) return;
    c.rect(9, y, 13, y, COLLAR);
    if (s.collar === 'bell') c.px(11, y + 1, GOLD);
    if (s.collar === 'bow') { c.px(11, y, mix(COLLAR, INK, 0.4)); c.px(9, y + 1, COLLAR); c.px(13, y + 1, COLLAR); }
  }

  function front(o: { step?: number; bob?: number; sit?: boolean; shut?: boolean; flick?: number; nod?: number } = {}): Cv {
    const step = o.step ?? 0, b = o.bob ?? 0, sit = !!o.sit, flick = o.flick ?? 0, nod = o.nod ?? 0;
    const c = new Cv(F, F);
    if (sit) {
      tailUp(c, bob ? [[16 + f, 21], [17 + f, 20 - flick]] : [[16 + f, 21], [17 + f, 20], [18 + f, 20 - flick], [19 + f, 19 - flick]]);
      c.rect(8 - f, 14, 15 + f, 17, G);
      c.rect(7 - f, 18, 16 + f, 21, G);                                     // haunches
      c.rect(7 - f, 19, 7 - f, 20, D); c.rect(16 + f, 19, 16 + f, 20, D);
      if (chest) c.rect(10 - f, 14, 13 + f, 21, chest);                     // chest and belly
      c.rect(9, 20, 10, 21, paw.front); c.rect(13, 20, 14, 21, paw.front);  // front paws together
      c.rect(11, 20, 12, 21, L);
      marks(c, 'sit', 0);
    } else {
      c.rect(8 - f, 14 + b, 15 + f, 19 + b, G);
      if (chest) c.rect(10 - f, 14 + b, 13 + f, 19 + b, chest);
      c.rect(8 - f, 15 + b, 8 - f, 17 + b, D); c.rect(15 + f, 15 + b, 15 + f, 17 + b, D);
      [9, 13].forEach((x, k) => {
        const up = (step === 1 && k === 0) || (step === 3 && k === 1) ? 1 : 0;
        c.rect(x, 20 - up, x + 1, 20 - up, LEG);
        c.rect(x, 21 - up, x + 1, 21 - up, paw.front);
      });
      marks(c, 'front', b);
    }
    collarFront(c, 14 + (sit ? 0 : b));
    c.ascii(o.shut ? shutHead : head, tones, 7 - wide, 7 - tall + (sit ? 0 : b) - nod);
    return flecks(c, sit ? 0 : b);
  }

  function back(step = 0, b = 0): Cv {
    const c = new Cv(F, F);
    c.rect(8 - f, 14 + b, 15 + f, 19 + b, G);
    if (stripes) for (const y of [15, 17]) c.rect(9, y + b, 14, y + b, D);
    [9, 13].forEach((x, k) => {
      const up = (step === 1 && k === 0) || (step === 3 && k === 1) ? 1 : 0;
      c.rect(x, 20 - up, x + 1, 20 - up, LEG);
      c.rect(x, 21 - up, x + 1, 21 - up, paw.back);
    });
    marks(c, 'back', b);
    if (COLLAR) c.rect(9, 14 + b, 13, 14 + b, COLLAR);
    c.ascii(backHead, tones, 7 - wide, 7 - tall + b);
    const sway = step % 2, tx = 11 - f;
    const pts: Pt[] = bob ? [[tx, 18 + b], [tx + sway, 17 + b]]
      : [[tx, 18 + b], [tx, 17 + b], [tx, 16 + b], [tx, 15 + b], [tx + sway, 14 + b], [tx + sway, 13 + b]];
    const shown = COLLAR ? pts.filter(([, y]) => y > 14 + b) : pts;        // the tail stops short of a collar
    if (s.neat) for (const [x, y] of shown) if (y >= 14 + b) c.px(x + tw, y, mix(G, D, 0.75));
    tailUp(c, shown);
    return flecks(c, b);
  }

  /** Asleep: tucked into a loaf, head down on the paws, tail round the body. */
  function loaf(breathe = 0): Cv {
    const c = new Cv(F, F);
    const top = 15 - breathe - high;
    const lump: Span[] = [[top, 9, 18]];
    for (let y = top + 1; y < 21; y++) lump.push([y, 7, 20]);
    lump.push([21, 8, 19]);
    c.part(lump, new Mat(G, { hi: L, lo: D }), 't', '');
    if (stripes) for (const x of [11, 13, 15, 17]) c.rect(x, top, x, top + 2, D);
    marks(c, 'rest', 0, top);
    if (!bob) tailUp(c, [10, 12, 14, 16, 18].map((x): Pt => [x, 21]));
    c.ascii(shutHead, tones, 3 - wide, 13 - tall);
    c.rect(5, 20, 9, 21, s.leg ? LEG : same(paw.front, W) ? W : L);         // paws under the chin
    return flecks(c, 0);
  }

  return [
    [front({ step: 0 }), front({ step: 1, bob: -1 }), front({ step: 2 }), front({ step: 3, bob: -1 })],
    [side(REACH), side(PASS1, { bob: -1, wag: 1 }), side(BACK), side(PASS2, { bob: -1, wag: 1 })],
    [back(0), back(1, -1), back(2), back(3, -1)],
    [front({ sit: true }), front({ sit: true }), front({ sit: true, shut: true }), front({ sit: true, flick: 1 })],
    [side(STAND, { headAt: [1, 13] }), side(STAND, { headAt: [1, 14] }), side(STAND, { headAt: [1, 13], wag: 1 }), side(STAND, { headAt: [1, 14] })],
    [loaf(0), loaf(0), loaf(1), loaf(1)],
    // being petted: eyes shut, pushing the head up into the hand, tail flicking
    [front({ sit: true, shut: true }), front({ sit: true, shut: true, flick: 1, nod: 1 }), front({ sit: true, shut: true }), front({ sit: true, shut: true, flick: 1, nod: 1 })],
  ];
}

/** Makes a face wider for long fur: the cheeks stand out past the ears, with light tufts at the jaw. */
function fluffed(ears: string[], face: string[]): string[] {
  return [
    ...ears.map((r) => `.${r}.`),
    `.${face[0]}.`,
    ...face.slice(1, 4).map((r) => r[0] + r + r[8]),
    `l${face[4][1]}${face[4].slice(1, 8)}${face[4][7]}l`,
    `.l${face[5][2]}${face[5].slice(2, 7)}${face[5][6]}l.`,
  ];
}

/** A cat's spec from what was picked in the builder. */
export function catSpec(p: PetLook): CatSpec {
  const G = rgb(p.coat), lum = luma(G), dark = lum < 0.3;
  const pat = p.pattern, long = p.fur === 'long', chunky = p.build === 'chunky';
  const P = rgb(p.coat2), darkP = luma(P) < 0.3;
  const s: CatSpec = {
    g: p.coat,
    d: hex(mix(G, DEEP, 0.45)),
    l: hex(mix(G, PALE, clamp(0.05 + 0.5 * lum, 0.14, 0.38))),
    far: hex(mix(G, DEEP, dark ? 0.5 : 0.28)),
    w: p.coat2, p: p.coat2, farW: hex(mix(P, [70, 72, 100], 0.2)),
    eye: p.eyes, nose: p.nose,
    head: [], headBack: [], eyeRow: 0, shut: '',
    fluffy: long, tail: p.tail, neat: true,
    f: (long ? 1 : 0) + (chunky ? 1 : 0), high: (long ? 1 : 0) + (chunky ? 1 : 0),
    chest: 's', sideChest: 'none', paws: 'none',
    collar: p.collar, collarColor: p.collarColor,
  };

  // the face: forehead, brow, eyes, muzzle, jaw and chin, nine dots wide
  let face = ['ggggggggg', 'ggggggggg', dark ? 'ggygggygg' : 'gykgggkyg', 'ggllnllgg', '.gglllgg.', '..ggggg..'];
  let shut = dark ? 'gllgggllg' : 'gkkgggkkg';
  let rear = ['ggggggggg', 'ggggggggg', 'ggggggggg', 'ggggggggg', '.ggggggg.', '..ggggg..'];
  let earL = 'g', earR = 'g';
  if (pat === 'tabby' || pat === 'tabbywhite') {
    s.stripes = true; s.chest = 'l';
    face[0] = 'gdgdgdgdg'; face[1] = 'ggdgggdgg';                          // the tabby M on the forehead
    rear = ['ggdgdgdgg', 'ggggggggg', 'gdgdgdgdg', 'ggggggggg', '.ggdgdgg.', '..ggggg..'];
  }
  if (pat === 'tabbywhite') {
    s.chest = 'w'; s.sideChest = 'w'; s.paws = 'all';
    face[3] = 'gwwwnwwwg'; face[4] = '.wwwwwww.'; face[5] = '..wwwww..';
  } else if (pat === 'tuxedo') {
    s.chest = 'w'; s.sideChest = 'w'; s.paws = 'all';
    face[3] = 'gggwnwggg'; face[4] = long ? '.gwwwwwg.' : '.ggwwwgg.'; face[5] = '..gwwwg..';   // the white whisker mark
  } else if (pat === 'socks') {
    s.paws = 'all';
  } else if (pat === 'mask') {                                             // white runs up between the eyes
    s.chest = 'w'; s.sideChest = 'w'; s.paws = 'all'; s.leg = p.coat2; s.belly = 'w';
    face[1] = 'ggggwgggg'; face[2] = dark ? 'ggywwwygg' : 'gykwwwkyg'; face[3] = 'gwwwnwwwg'; face[4] = '.wwwwwww.'; face[5] = '..wwwww..';
    shut = dark ? 'gllwwwllg' : 'gkkwwwkkg';
  } else if (pat === 'patches') {                                          // one ear and eye in each colour
    s.chest = 'none'; s.marks = 'patches';
    earL = 'p'; earR = 'q';
    face[0] = 'pppgggqqq'; face[1] = 'ppgggggqq'; face[2] = 'pykgggkyq'; shut = 'pkkgggkkq';
    rear = ['qqqgggppp', 'qqgggggpp', 'ggggggggg', 'ggggggggg', '.ggggggg.', '..ggggg..'];
  } else if (pat === 'point') {                                            // darker face, ears, legs and tail
    s.leg = p.coat2; s.tailCol = p.coat2;
    earL = earR = 'p';
    face[1] = 'gggpppggg'; face[2] = 'gpypppypg'; face[3] = 'gpppnpppg'; face[4] = '.gpppppg.';
    shut = darkP ? 'ghhppphhg' : 'gkkpppkkg';
  } else if (pat === 'spots') {
    s.chest = 'none'; s.marks = 'spots'; s.tailStripes = true;
    face[0] = 'ggdgggdgg'; face[1] = 'ggggdgggg';
    rear = ['ggggggggg', 'ggdgggdgg', 'ggggdgggg', 'ggdgggdgg', '.ggggggg.', '..ggggg..'];
  } else if (pat === 'tortie') {
    s.chest = 'none'; s.marks = 'tortie';
  }

  const tip = dark ? 'l' : 'd';
  const earRows: Record<string, string[]> = {
    pointed: ['E.......F', 'EE.....FF'],
    folded: ['E.......F'],
    tufted: [`${tip}.......${tip}`, 'E.......F', 'EE.....FF'],
    round: ['.E.....F.', 'EEE...FFF'],
  };
  const shape = Object.hasOwn(earRows, p.ears) ? earRows[p.ears] : earRows.pointed;
  const ears = (l: string, r: string) => shape.map((row) => row.replace(/E/g, l).replace(/F/g, r));
  const build = (e: string[], rows: string[]) => (long ? fluffed(e, rows) : [...e, ...rows]);
  s.eyeRow = shape.length + 2;
  s.head = build(ears(earL, earR), face);
  const shutFace = [...face]; shutFace[2] = shut;
  s.shut = build(ears(earL, earR), shutFace)[s.eyeRow];
  s.headBack = build(ears(earR, earL), rear);
  return s;
}

// ───────────────────────── dogs ─────────────────────────

export type DogSpec = {
  g: string; d: string; l: string; w: string; far: string; ear: string; muzzle: string;
  collar: string; tag?: string;
  /** 'w' for white; otherwise the coat's light tone */
  chest?: string; paws?: string;
  belly?: boolean; shaggy?: boolean;
  /** the face from the front, from the side (looking left) and from behind; letters are tones */
  head: string[]; headSide: string[]; headBack: string[]; eyeRow: number; shut: string;
  // ── everything below is optional extras for the builder ──
  /** the second colour, the left ear, the eyes and the nose */
  p?: string; ear2?: string; eyeCol?: string; nose?: string;
  /** 'collar', 'tag', 'bandana' or 'none' */
  collarKind?: string;
  /** small touches the builder's dogs get: no gap under the chin when the head lifts or there is no collar, shade beside the
   *  tail from behind, and a tail that stops a dot short of the frame's edge */
  neat?: boolean;
  /** 'long', 'short', 'curled' or 'fluffy' */
  tail?: string;
  tailCol?: string;
  /** shorter legs by this much; a shorter body; a wider one from the front; a deeper one from the side */
  drop?: number; short?: number; girth?: number; deep?: number;
  /** 'saddle', 'spots', 'patch' or 'brindle' */
  marks?: string;
};

/** The seven rows of a dog. Bigger than a cat: longer legs, a head with hanging ears, a collar. */
export function dogFrames(s: DogSpec): Cv[][] {
  const G = rgb(s.g), D = rgb(s.d), L = rgb(s.l), W = rgb(s.w), FAR = rgb(s.far);
  const P = rgb(s.p ?? s.d);
  const kind = s.collarKind ?? 'collar';
  const COLLAR = kind === 'none' ? null : rgb(s.collar);
  const TAG = s.tag ? rgb(s.tag) : null;
  const tones: Record<string, RGB> = {
    g: G, d: D, l: L, w: W, e: rgb(s.ear), f: rgb(s.ear2 ?? s.ear), m: rgb(s.muzzle), k: INK, t: PINK,
    i: rgb(s.eyeCol ?? '#22232b'), n: rgb(s.nose ?? '#22232b'), p: P,
  };
  const chest = s.chest === 'w' ? W : L;
  const paw = s.paws === 'w' ? W : L;
  const farPaw = mix(paw, FAR, 0.35);
  const shaggy = !!s.shaggy;
  const tailKind = s.tail ?? (shaggy ? 'fluffy' : 'long');
  const plume = tailKind === 'fluffy' ? 3 : 2;
  const TAIL = s.tailCol ? rgb(s.tailCol) : G;
  const dn = s.drop ?? 0, cut = s.short ?? 0, girth = s.girth ?? 0, deep = s.deep ?? 0;
  const bib = girth < 0 ? -1 : 0;                           // a narrow dog has a narrower bib

  /** A shaggy coat: flecks of light and shade through it, and tufts breaking the outline along the top. */
  function fur(c: Cv, clear = 0): Cv {
    if (!shaggy) return c;
    for (let y = 0; y < F; y++) for (let x = 0; x < F; x++) {
      const n = (x * 7 + y * 13 + x * y) % 11;
      if (same(c.get(x, y), G)) {
        if (n === 0 || n === 5) c.px(x, y, L);
        else if (n === 3) c.px(x, y, D);
      }
    }
    for (let y = 1; y < F; y++) for (let x = 0; x < F; x++) {
      const here = c.get(x, y);
      if (x >= clear && !c.get(x, y - 1) && here && (same(here, G) || same(here, L) || same(here, D)) && (x * 5 + y * 3) % 3 === 0) c.px(x, y - 1, G);
    }
    return c;
  }

  function tail(c: Cv, pts: Pt[]) {
    pts.forEach(([x, y], i) => { for (let k = 0; k < plume; k++) if (!s.neat || x + k < F - 1) c.px(x + k, y, tailKind === 'fluffy' && i >= pts.length - 2 ? L : TAIL); });
  }

  function face(c: Cv, art: string[], ox: number, oy: number, shut = false, happy = false) {
    const lines = [...art];
    if (shut) lines[s.eyeRow] = s.shut;
    c.ascii(lines, tones, ox, oy);
    if (happy) { c.px(ox + 5, oy + lines.length - 1, PINK); c.px(ox + 5, oy + lines.length, PINK); }   // tongue out
  }

  /** The coat's markings on the body. Only ever paints over plain coat. */
  function marks(c: Cv, view: View, b: number, top = 0) {
    if (!s.marks) return;
    const on = (x: number, y: number, col: RGB) => { const v = c.get(x, y); if (same(v, G) || same(v, L)) c.px(x, y, col); };
    const box = (x0: number, y0: number, x1: number, y1: number, col: RGB) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) on(x, y, col); };
    const y0 = 11 - deep + dn + b;                          // the top of the back, from the side
    if (s.marks === 'saddle') {
      const end = 20 - cut;                                 // it runs from the shoulders to the tail, rounded underneath
      if (view === 'side') { box(10, y0, end, y0, mix(P, PALE, 0.15)); box(11, y0 + 1, end, y0 + 1, P); box(12, y0 + 2, end - 1, y0 + 2, P); box(14, y0 + 3, end - 3, y0 + 3, P); }
      else if (view === 'back') box(8 - girth, 13 + dn + b, 15 + girth, 17 + b, P);
      else if (view === 'rest') { box(11, top, 19, top, mix(P, PALE, 0.15)); box(10, top + 1, 21, top + 1, P); box(11, top + 2, 20, top + 2, P); box(13, top + 3, 18, top + 3, P); }
    } else if (s.marks === 'patch') {
      if (view === 'side') box(14 - cut, y0, 17 - cut, y0 + 2, P);
      else if (view === 'back') box(11, 14 + dn + b, 15 + girth, 17 + b, P);
      else if (view === 'rest') box(13, top, 17, top + 2, P);
    } else if (s.marks === 'brindle') {
      if (view === 'side') [10, 12, 14, 16, 18].forEach((x, i) => { if (x < 20 - cut) box(x, y0 + 1 + (i % 2), x, y0 + 3 + (i % 2), D); });
      else if (view === 'back') [8, 10, 12, 14].forEach((x, i) => box(x, 14 + dn + b + (i % 2), x, 16 + dn + b + (i % 2), D));
      else if (view === 'rest') [10, 12, 14, 16, 18].forEach((x, i) => box(x, top + 1 + (i % 2), x, top + 3 + (i % 2), D));
    } else if (s.marks === 'spots') {
      const [r0, r1] = view === 'side' ? [y0 + 1, 20] : view === 'rest' ? [top + 1, 20] : view === 'sit' ? [13 + dn, 19] : [13 + dn + b, 20];
      for (let y = r0; y <= r1; y++) for (let x = 0; x < F; x++) if (dotted(x, y < 19 ? y - b : y) && same(c.get(x, y), G)) c.px(x, y, P);
    }
  }

  /** Facing left. Leg x positions are the cat's, stretched: a dog is longer in the body. */
  function side(legs0: Leg[], o: { bob?: number; headAt?: Pt; wag?: number; shut?: boolean } = {}): Cv {
    const b = o.bob ?? 0, headAt = o.headAt ?? [0, 5], wag = o.wag ?? 0;
    const c = new Cv(F, F);
    const tx = -cut, ty = b + dn - deep;
    const pts: Pt[] = tailKind === 'short' ? [[20, 12], [21 + wag, 11]]
      : tailKind === 'curled' ? [[20, 12], [21, 11], [21, 10], [20 - wag, 9], [18 - wag, 9], [18 - wag, 10]]
      : [[20, 12], [21, 11], [21 + wag, 10], [21 + wag, 9], ...(tailKind === 'fluffy' ? [[20 + wag, 8] as Pt] : [])];
    tail(c, pts.map(([x, y]): Pt => [x + tx, y + ty]));
    const legs = legs0.map(([x, far, lift]): Leg => [x + (x >= 14 && !cut ? 1 : 0), far, lift]);
    for (const [x, far, lift] of legs) if (far) {
      c.rect(x, 15 + dn, x + 1, 20 - lift, FAR);
      c.rect(x, 21 - lift, x + 1, 21 - lift, farPaw);
    }
    c.rect(8, 11 - deep + b + dn, 20 - cut, 16 + b + dn, G);
    c.rect(8, 11 - deep + b + dn, 20 - cut, 11 - deep + b + dn, shaggy ? G : L);      // light along the back
    c.rect(10, 16 + b + dn, 19 - cut, 16 + b + dn, s.belly ? chest : D);             // belly
    c.rect(8, 13 + b + dn, 9, 16 + b + dn, chest);                                   // chest
    for (const [x, far, lift] of legs) if (!far) {
      c.rect(x, 15 + b + dn, x + 1, 20 - lift, G);
      c.rect(x, 21 - lift, x + 1, 21 - lift, paw);
    }
    marks(c, 'side', b);
    if (COLLAR) {
      c.rect(9, 10 + b + dn, 9, 12 + b + dn, COLLAR);
      if (kind === 'bandana') { c.px(8, 13 + b + dn, COLLAR); c.px(9, 13 + b + dn, COLLAR); c.px(8, 14 + b + dn, COLLAR); }
    }
    if (TAG && COLLAR) c.px(8, 13 + b + dn, TAG);
    face(c, s.headSide, headAt[0], headAt[1] + b + dn - (s.headSide.length - 7), o.shut);
    return fur(c, 9);
  }

  /** The collar, seen from the front, with the neck behind it where a gap would show. */
  function collarFront(c: Cv, y: number, bodyTop: number) {
    if (s.neat) for (let r = y + 8; r < bodyTop; r++) { c.rect(8, r, 15, r, G); c.rect(9 - bib, r, 14 + bib, r, chest); }
    if (!COLLAR) return;
    c.rect(8, y + 8, 15, y + 8, COLLAR);
    if (kind === 'bandana') {
      c.rect(8, y + 8, 15, y + 8, mix(COLLAR, INK, 0.22));
      c.rect(9, y + 9, 14, y + 9, COLLAR); c.rect(10, y + 10, 13, y + 10, COLLAR); c.rect(11, y + 11, 12, y + 11, COLLAR);
    }
    if (TAG) c.rect(11, y + 9, 12, y + 9, TAG);
  }

  function front(o: { step?: number; bob?: number; sit?: boolean; shut?: boolean; wag?: number; happy?: boolean; nod?: number } = {}): Cv {
    const step = o.step ?? 0, b = o.bob ?? 0, sit = !!o.sit, wag = o.wag ?? 0, nod = o.nod ?? 0;
    const c = new Cv(F, F);
    const w = girth;
    if (sit) {
      tail(c, tailKind === 'short' ? [[17 + w, 21], [18 + w + wag, 20]]
        : tailKind === 'curled' ? [[17 + w, 21], [18 + w, 20], [19 + w, 19], [18 + w + wag, 18]]
        : [[17 + w, 21], [18 + w, 20], [19 + w + wag, 19], [19 + w + wag, 18]]);
      c.rect(7 - w, 13 + dn, 16 + w, 17, G);
      c.rect(6 - w, 17, 17 + w, 21, G);                                     // haunches
      c.rect(6 - w, 18, 6 - w, 20, D); c.rect(17 + w, 18, 17 + w, 20, D);
      c.rect(9 - bib, 13 + dn, 14 + bib, 21, chest);                        // chest and belly
      for (const x of [9, 13]) {                                            // front legs, straight down, paws together
        c.rect(x, 16, x + 1, 20, G);
        c.rect(x, 21, x + 1, 21, paw);
      }
      c.rect(11, 20, 12, 21, mix(chest, D, 0.35));
      marks(c, 'sit', 0);
    } else {
      c.rect(7 - w, 13 + b + dn, 16 + w, 19 + b, G);
      c.rect(9 - bib, 13 + b + dn, 14 + bib, 19 + b, chest);
      c.rect(7 - w, 14 + b + dn, 7 - w, 18 + b, D); c.rect(16 + w, 14 + b + dn, 16 + w, 18 + b, D);
      [8 - w, 14 + w].forEach((x, k) => {
        const up = (step === 1 && k === 0) || (step === 3 && k === 1) ? 1 : 0;
        c.rect(x, 19, x + 1, 20 - up, G);
        c.rect(x, 21 - up, x + 1, 21 - up, paw);
      });
      marks(c, 'front', b);
    }
    const y = 4 + dn + (sit ? 0 : b) - nod;
    collarFront(c, y, 13 + dn + (sit ? 0 : b));
    face(c, s.head, 6, y - (s.head.length - 8), o.shut, o.happy);
    return fur(c);
  }

  function back(step = 0, b = 0): Cv {
    const c = new Cv(F, F);
    const w = girth;
    c.rect(7 - w, 13 + b + dn, 16 + w, 19 + b, G);
    c.rect(7 - w, 14 + b + dn, 7 - w, 18 + b, D); c.rect(16 + w, 14 + b + dn, 16 + w, 18 + b, D);
    [8 - w, 14 + w].forEach((x, k) => {
      const up = (step === 1 && k === 0) || (step === 3 && k === 1) ? 1 : 0;
      c.rect(x, 19, x + 1, 20 - up, G);
      c.rect(x, 21 - up, x + 1, 21 - up, paw);
    });
    marks(c, 'back', b);
    if (COLLAR) c.rect(8, 12 + b + dn, 15, 12 + b + dn, COLLAR);
    else if (s.neat) c.rect(8, 12 + b + dn, 15, 12 + b + dn, G);
    if (COLLAR && kind === 'bandana') c.rect(10, 13 + b + dn, 13, 13 + b + dn, COLLAR);      // the knot
    c.ascii(s.headBack, tones, 6, 4 + b + dn - (s.headBack.length - 8));
    const sway = step % 2, ty = b + dn;
    const pts: Pt[] = tailKind === 'short' ? [[11, 17], [11 + sway, 16]]
      : tailKind === 'curled' ? [[11, 17], [11, 16], [12, 15], [12 + sway, 14]]
      : [[11, 17], [11, 16], [11, 15], [11 + sway, 14], [11 + sway, 13]];
    if (s.neat) for (const [x, y] of pts) c.px(x + plume, y + ty, mix(G, D, 0.8));    // shade beside the tail, so it can be seen
    tail(c, pts.map(([x, y]): Pt => [x, y + ty]));
    return fur(c);
  }

  /** Asleep: flat out on the floor, chin on the front paws, tail tucked along the side. */
  function lying(breathe = 0): Cv {
    const c = new Cv(F, F);
    const top = 16 - breathe - deep + (dn ? 1 : 0);
    const lump: Span[] = [[top, 9, 19]];
    for (let y = top + 1; y < 21; y++) lump.push([y, 7, 21]);
    lump.push([21, 8, 20]);
    c.part(lump, new Mat(G, { hi: L, lo: D }), 't', '');
    marks(c, 'rest', 0, top);
    tail(c, (tailKind === 'short' ? [19] : [13, 15, 17, 19]).map((x): Pt => [x, 21]));
    c.rect(19, 19, 21, 20, D);                                              // a back leg, folded
    c.rect(3, 20, 8, 21, paw);                                              // front paws, stretched out
    face(c, s.head, 1, 12 - (s.head.length - 8), true);
    return fur(c);
  }

  return [
    [front({ step: 0 }), front({ step: 1, bob: -1 }), front({ step: 2 }), front({ step: 3, bob: -1 })],
    [side(REACH), side(PASS1, { bob: -1, wag: 1 }), side(BACK), side(PASS2, { bob: -1, wag: 1 })],
    [back(0), back(1, -1), back(2), back(3, -1)],
    [front({ sit: true }), front({ sit: true, wag: 1 }), front({ sit: true, shut: true }), front({ sit: true, wag: 1 })],
    [side(STAND, { headAt: [0, 10] }), side(STAND, { headAt: [0, 11] }), side(STAND, { headAt: [0, 10], wag: 1 }), side(STAND, { headAt: [0, 11] })],
    [lying(0), lying(0), lying(1), lying(1)],
    // being petted: eyes shut, tongue out, tail going
    [front({ sit: true, shut: true, happy: true }), front({ sit: true, shut: true, happy: true, wag: 1, nod: 1 }),
      front({ sit: true, shut: true, happy: true }), front({ sit: true, shut: true, happy: true, wag: 1, nod: 1 })],
  ];
}

/** A dog's spec from what was picked in the builder. */
export function dogSpec(p: PetLook): DogSpec {
  const G = rgb(p.coat), lum = luma(G), P = rgb(p.coat2);
  const pat = p.pattern;
  const white = pat === 'tricolour' ? '#f6f3ea' : p.coat2;
  const whiteBits = pat === 'twotone' || pat === 'maskwhite' || pat === 'tricolour';
  const light = mix(G, PALE, clamp(0.1 + 0.45 * lum, 0.16, 0.42));
  const darkMuzzle = pat === 'mask' || pat === 'maskwhite';
  const muzzle = darkMuzzle ? mix(G, [38, 28, 32], 0.78) : pat === 'twotone' || pat === 'tricolour' ? rgb(white) : light;
  const ear = mix(G, DEEP, 0.2);
  const secondEars = pat === 'saddle' || pat === 'tricolour' || pat === 'spots';
  // eyes and nose are dark dots: on a dark coat they need lifting to be seen at all
  let eye = rgb(p.eyes);
  if (Math.abs(luma(eye) - lum) < 0.2) eye = lum < 0.5 ? mix(eye, [255, 226, 170], 0.6) : mix(eye, INK, 0.6);
  let nose = rgb(p.nose);
  if (Math.abs(luma(nose) - luma(muzzle)) < 0.12) nose = luma(muzzle) < 0.5 ? mix(nose, PALE, 0.35) : mix(nose, INK, 0.5);
  const s: DogSpec = {
    g: p.coat,
    d: hex(mix(G, DEEP, 0.24)),
    l: hex(light),
    w: white,
    far: hex(mix(G, DEEP, 0.34)),
    ear: hex(secondEars ? P : ear), ear2: hex(secondEars || pat === 'patch' ? P : ear),
    muzzle: hex(muzzle),
    p: p.coat2, eyeCol: hex(eye), nose: hex(nose),
    collar: p.collarColor, collarKind: p.collar, tag: p.collar === 'tag' ? hex(GOLD) : undefined, neat: true,
    chest: whiteBits ? 'w' : 'l', paws: whiteBits ? 'w' : 'l', belly: whiteBits,
    shaggy: p.fur === 'shaggy', tail: p.tail, tailCol: pat === 'saddle' || pat === 'tricolour' ? p.coat2 : undefined,
    drop: p.build === 'small' ? 2 : 0, short: p.build === 'small' ? 1 : 0,
    girth: p.build === 'small' ? -1 : p.build === 'large' ? 1 : 0, deep: p.build === 'large' ? 1 : 0,
    marks: pat === 'saddle' || pat === 'tricolour' ? 'saddle' : pat === 'spots' || pat === 'patch' || pat === 'brindle' ? pat : undefined,
    head: [], headSide: [], headBack: [], eyeRow: 0, shut: '',
  };

  // the face from the front: the middle seven columns, then the ears either side
  const core = ['ggggggg', 'ggggggg', 'gigggig', 'ggggggg', 'gmmmmmg', 'gmmnmmg', 'gmmmmmg', '.ggggg.'];
  let shutCore = 'iigggii';
  if (pat === 'twotone') core[7] = '.gmmmg.';
  if (pat === 'tricolour') { core[0] = 'gggwggg'; core[1] = 'gggwggg'; core[2] = 'gigwgig'; core[3] = 'ggwwwgg'; core[7] = '.gmmmg.'; shutCore = 'iigwgii'; }   // a white blaze
  if (pat === 'patch') { core[1] = 'pppgggg'; core[2] = 'pipggig'; core[3] = 'pppgggg'; shutCore = 'iipggii'; }
  if (pat === 'spots') { core[0] = 'ggggpgg'; core[3] = 'gpggggg'; }
  if (pat === 'brindle') { core[0] = 'gdgdgdg'; core[1] = 'ggdgdgg'; }
  const rearCore = ['ggggggg', 'ggggggg', 'ggggggg', 'ggggggg', 'ggggggg', 'ggggggg', 'ggggggg', '.ggggg.'];
  if (pat === 'spots') { rearCore[1] = 'ggpgggg'; rearCore[4] = 'ggggpgg'; }
  if (pat === 'brindle') { rearCore[1] = 'gdgdgdg'; rearCore[3] = 'ggdgdgg'; }
  if (pat === 'patch') { rearCore[1] = 'ggggppp'; rearCore[2] = 'ggggppp'; }

  // for each row, the two columns left of the face; the right side mirrors it ('f' is the left ear, 'e' the right)
  type Ears = { above: string[]; left: string[]; rearLeft?: string[]; sideHead: string[] };
  const throat = whiteBits ? 'w' : 'g';
  const earShapes: Record<string, Ears> = {
    floppy: {
      above: [], left: ['..', '.f', 'ff', 'ff', '.f', '..', '..', '..'],
      sideHead: ['...gggg..', '..ggggee.', '.ggiggeee', 'mmmgggeee', 'nmmggggg.', '.mmmgggg.', `...${throat}${throat}ggg.`],
    },
    long: {
      above: [], left: ['..', '.f', 'ff', 'ff', 'ff', 'ff', 'f.', '..'],
      sideHead: ['...gggg..', '..gggggee', '.ggiggeee', 'mmmgggeee', 'nmmgggeee', '.mmmggeee', `...${throat}${throat}ggee`],
    },
    pointed: {
      above: ['.f.......e.', '.ff.....ee.'], left: ['.f', '.g', '.g', '.g', '..', '..', '..', '..'],
      sideHead: ['.....e...', '.....ee..', '...ggeeg.', '..gggggg.', '.ggigggg.', 'mmmggggg.', 'nmmggggg.', '.mmmgggg.', `...${throat}${throat}ggg.`],
    },
    halfup: {
      above: ['.ff.....ee.'], left: ['ff', '.f', '.g', '.g', '..', '..', '..', '..'],
      sideHead: ['.....ee..', '...ggeee.', '..ggggde.', '.ggigggg.', 'mmmggggg.', 'nmmggggg.', '.mmmgggg.', `...${throat}${throat}ggg.`],
    },
  };
  const shape = Object.hasOwn(earShapes, p.ears) ? earShapes[p.ears] : earShapes.floppy;
  const mirror = (pair: string) => (pair[1] + pair[0]).replace(/f/g, 'e');
  const rows = (mid: string[], rear: boolean) => [
    ...shape.above.map((r) => (rear ? r.replace(/f/g, 'E').replace(/e/g, 'f').replace(/E/g, 'e') : r)),
    ...mid.map((m, k) => {
      const l = shape.left[k], r = mirror(l);
      return rear ? l.replace(/f/g, 'e') + m + r.replace(/e/g, 'f') : l + m + r;
    }),
  ];
  if (p.ears === 'halfup') { core[1] = `d${core[1].slice(1, 6)}d`; }       // the tips fold over
  s.head = rows(core, false);
  s.eyeRow = shape.above.length + 2;
  const shutRows = [...core]; shutRows[2] = shutCore;
  s.shut = rows(shutRows, false)[s.eyeRow];
  s.headBack = rows(rearCore, true);
  s.headSide = [...shape.sideHead];
  if (pat === 'patch') {                                                   // the patch round the eye, and that ear
    const k = s.headSide.findIndex((r) => r.includes('i'));
    const paint = (row: string, from: number, to: number) => row.slice(0, from) + row.slice(from, to).replace(/g/g, 'p') + row.slice(to);
    s.headSide[k - 1] = paint(s.headSide[k - 1], 2, 5);
    s.headSide[k] = paint(s.headSide[k], 2, 5);
    s.headSide[k + 1] = paint(s.headSide[k + 1], 3, 5);
    s.headSide = s.headSide.map((r) => r.replace(/e/g, 'f'));
  }
  return s;
}

// ───────────────────────── the sheet ─────────────────────────

let last: { key: string; frames: Cv[][] } | null = null;

const HEX = /^#[0-9a-f]{6}$/i;
const colour = (v: unknown, fallback: string) => (typeof v === 'string' && HEX.test(v) ? v : fallback);
/** Makes sure every colour is one that can be drawn, whatever was handed in. */
function tidy(p: PetLook): PetLook {
  return { ...p, coat: colour(p.coat, '#a3a7b1'), coat2: colour(p.coat2, '#f6f5f1'), eyes: colour(p.eyes, '#d9c84f'), nose: colour(p.nose, '#e79aa6'), collarColor: colour(p.collarColor, '#d8342c') };
}

/** Every frame of a pet, outlined; the last pet drawn is kept, since previews ask for one frame at a time. */
function framesOf(pet: PetLook): Cv[][] {
  const key = JSON.stringify(pet);
  if (last && last.key === key) return last.frames;
  const raw = pet.kind === 'dog' ? dogFrames(dogSpec(tidy(pet))) : catFrames(catSpec(tidy(pet)));
  const frames = raw.map((row) => row.map(outlined));
  last = { key, frames };
  return frames;
}

/** The whole sheet at its real size: 96 x 168, four frames across and seven rows down. */
export function drawPetSheet(pet: PetLook): Picture {
  return sheetOf(framesOf(pet).flat(), 4);
}

/** One frame (24 x 24), for previews. Rows: 0 walk down, 1 walk left, 2 walk up, 3 sit, 4 eat, 5 sleep, 6 petted. */
export function drawPetFrame(pet: PetLook, row: number, frame: number): Picture {
  const frames = framesOf(pet);
  const r = frames[clamp(Math.floor(row) || 0, 0, frames.length - 1)];
  const c = r[clamp(Math.floor(frame) || 0, 0, r.length - 1)];
  return { w: c.w, h: c.h, data: new Uint8ClampedArray(c.a) };
}
