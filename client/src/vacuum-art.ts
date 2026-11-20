// The robot vacuum and its dock, drawn dot by dot (client/src/vacuum.tsx puts them in the room and drives it). Pure
// drawing, no page: a script can draw them too, to look at them enlarged.
//
// The vacuum: a round robot seen from the room's slant, so its top is an oval with a band of its side showing below.
// Charcoal, with a pale bumper round the front of the rim, a raised sensor turret towards the back, a round button in
// the middle with a status light (green while it runs, amber on the dock), and while it runs two little side brushes
// spinning under its front corners. Eight headings, so the bumper and the turret say which way it is going.
// The dock: a small charging tower stood against the back wall, with its floor plate in front of it.

export type RGB = [number, number, number];
export type Pic = { w: number; h: number; px: Uint8ClampedArray };

const hex = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
const mix = (a: RGB, b: RGB, t: number): RGB => a.map((v, i) => Math.round(v + (b[i] - v) * t)) as RGB;
const INK: RGB = [26, 18, 40];                     // the room's outline colour (INK in scripts/make-clubhouse.py)

function pic(w: number, h: number): Pic { return { w, h, px: new Uint8ClampedArray(w * h * 4) }; }
function dot(p: Pic, x: number, y: number, c: RGB) {
  if (x < 0 || y < 0 || x >= p.w || y >= p.h) return;
  const i = (y * p.w + x) * 4;
  p.px[i] = c[0]; p.px[i + 1] = c[1]; p.px[i + 2] = c[2]; p.px[i + 3] = 255;
}
const solid = (p: Pic, x: number, y: number) => x >= 0 && y >= 0 && x < p.w && y < p.h && p.px[(y * p.w + x) * 4 + 3] > 0;
const at = (p: Pic, x: number, y: number): RGB => { const i = (y * p.w + x) * 4; return [p.px[i], p.px[i + 1], p.px[i + 2]]; };
/** A dark dot round everything drawn, tinted by what it touches (as the room's own props are outlined). */
function outline(p: Pic) {
  const add: [number, number, RGB][] = [];
  for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
    if (solid(p, x, y)) continue;
    const nb = [[0, 1], [1, 0], [-1, 0], [0, -1]].find(([dx, dy]) => solid(p, x + dx, y + dy));
    if (nb) add.push([x, y, mix(at(p, x + nb[0], y + nb[1]), INK, 0.72)]);
  }
  for (const [x, y, c] of add) dot(p, x, y, c);
}
/** Whether a dot's centre is inside an oval. */
const inOval = (x: number, y: number, cx: number, cy: number, rx: number, ry: number) => ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1;

/** One frame's box. The vacuum stands in it with the middle of its footprint on the floor at (VAC_X, VAC_Y). */
export const VAC_W = 26, VAC_H = 18;
export const VAC_X = 13, VAC_Y = 11;
/** How big it is on the floor: the half-widths of its footprint (for bumping into things). */
export const VAC_RX = 10, VAC_RY = 5.5;
/** Frames per heading: brushes one way, brushes the other way, and still (on the dock). */
export const VAC_PER = 3;
/** The headings drawn, clockwise from east (facing right): east, south-east (towards us and right), south... */
export const HEADINGS = 8;
/** How far above its footprint the top of it is: where a cat riding it sits. */
export const VAC_TOP = 4;

const CX = 13, TOP_Y = 7, RX = 10, RY = 5.4, SIDE = 4;         // the top's oval, and how tall the side band is

/** The vacuum facing heading `h` (0..7, clockwise from east). `frame`: 0 and 1 running (the brushes turning), 2 still. */
export function vacuumFrame(h: number, frame: number): Pic {
  const p = pic(VAC_W, VAC_H);
  const a = (h * Math.PI) / 4, fx = Math.cos(a), fy = Math.sin(a);
  const running = frame < 2;
  // the side brushes first, on the floor under its two front corners: the body covers whatever is under it
  if (running) {
    const bristle = hex('#d9dce6'), hub = hex('#7d8394');
    for (const side of [-1, 1]) {
      const b = a + side * 0.75;
      const bx = Math.round(CX - 0.5 + Math.cos(b) * (RX - 1)), by = Math.round(TOP_Y + SIDE - 0.5 + Math.sin(b) * (RY - 0.5));
      // three bristles, at one of two turns (the frames take turns): a little star either way
      const arms = (frame + (side > 0 ? 1 : 0)) % 2 ? [[2, 0], [-1, 2], [-1, -2]] : [[-2, 0], [1, 2], [1, -2]];
      for (const [dx, dy] of arms) { dot(p, bx + dx, by + Math.sign(dy), bristle); dot(p, bx + Math.sign(dx), by + Math.sign(dy) * (Math.abs(dy) > 1 ? 1 : 0), bristle); }
      dot(p, bx, by, hub);
    }
  }
  // the side, all round the front half: dark, a little lighter in the middle where the light from above catches it,
  // and the bumper (pale) across the part of it that faces the way it is going
  const sideC = hex('#2a2d38'), sideHi = hex('#3c4150'), bump = hex('#9ea3b3'), bumpLo = hex('#7a8092');
  for (let x = 0; x < VAC_W; x++) for (let y = 0; y < VAC_H; y++) {
    let inSide = false;
    for (let k = 0; k <= SIDE; k++) if (inOval(x, y - k, CX, TOP_Y, RX, RY)) { inSide = true; break; }
    if (!inSide || inOval(x, y, CX, TOP_Y, RX, RY)) continue;
    const ang = Math.atan2(((y + 0.5 - SIDE * 0.5) - TOP_Y) / RY, (x + 0.5 - CX) / RX);
    const front = Math.cos(ang - a) > 0.35;
    const mid = Math.abs(x + 0.5 - CX) < RX * 0.45;
    const low = !inOval(x, y - SIDE + 1, CX, TOP_Y, RX, RY);       // the bottom row of the band: in shade
    dot(p, x, y, front ? (low ? bumpLo : bump) : low ? mix(sideC, INK, 0.3) : mid ? sideHi : sideC);
  }
  // the top: charcoal, with its rim a shade lighter and the bumper's lip round the front of it; a sheen at the back left
  const top = hex('#41454f'), topLo = hex('#353842'), rim = hex('#5d6272'), sheen = hex('#5a6070');
  for (let x = 0; x < VAC_W; x++) for (let y = 0; y < VAC_H; y++) {
    if (!inOval(x, y, CX, TOP_Y, RX, RY)) continue;
    const edge = !inOval(x, y, CX, TOP_Y, RX - 1.3, RY - 1);
    const ang = Math.atan2((y + 0.5 - TOP_Y) / RY, (x + 0.5 - CX) / RX);
    const front = Math.cos(ang - a) > 0.5;
    let c = (x + 0.5 - CX) / RX + (y + 0.5 - TOP_Y) / RY > 0.7 ? topLo : top;
    if (edge) c = front ? bump : rim;
    else if (inOval(x, y, CX - 4, TOP_Y - 2, 3.2, 1.4)) c = sheen;
    dot(p, x, y, c);
  }
  // the sensor turret, raised a dot, towards the back: pale grey with a dark window band across it
  const tx = CX - fx * 4.4, ty = TOP_Y - 1 - fy * 2.2;
  const turret = hex('#c5c9d4'), turretLo = hex('#9aa0ae'), window = hex('#1d1f27');
  for (let x = 0; x < VAC_W; x++) for (let y = 0; y < VAC_H; y++) {
    if (inOval(x, y, tx, ty + 1, 3, 1.9) && !inOval(x, y, tx, ty, 3, 1.9)) dot(p, x, y, turretLo);      // its side
    else if (inOval(x, y, tx, ty, 3, 1.9)) dot(p, x, y, y + 0.5 > ty ? window : turret);
  }
  // the button in the middle, a little in front of the centre: a pale ring, its status light in it
  const bx = Math.round(CX - 0.5 + fx * 2.5), by = Math.round(TOP_Y - 0.5 + fy * 1.2);
  const ring = hex('#b9bdc8');
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) dot(p, bx + dx, by + dy, ring);
  dot(p, bx, by, running ? hex('#59e07a') : hex('#f2b43a'));
  outline(p);
  return p;
}

export const DOCK_W = 18, DOCK_H = 20;
/** Where the vacuum parks on the dock, in the dock's picture: the middle of its footprint (facing away from the wall). */
export const DOCK_PARK: [number, number] = [9, 16];
/** The dock, against the back wall under the whiteboard (the vacuum backs on to it and leaves facing away, into the
 *  room): a tower (its top, lit from above, and its face towards the room, with a dark strip and the charging lights in
 *  it) at the wall end of a floor plate that runs out from it towards us, with two brass contacts on the plate, under
 *  the vacuum when it is home. Drawn from the room's slant. */
export function dockPic(lit: boolean): Pic {
  const p = pic(DOCK_W, DOCK_H);
  const plate = hex('#30333d'), plateHi = hex('#454a57'), plateLo = hex('#24262e'), brass = hex('#d9b04a');
  // the floor plate: a low dark slab out from the wall, its near edge in shade
  for (let y = 9; y <= 18; y++) for (let x = 1; x <= 16; x++) dot(p, x, y, y === 18 ? plateLo : x === 1 ? plateHi : x === 16 ? mix(plate, INK, 0.3) : plate);
  for (const x of [6, 7, 10, 11]) { dot(p, x, 12, brass); dot(p, x, 13, mix(brass, INK, 0.35)); }
  // the tower, standing on the plate's wall end: its top, then its face
  const topC = hex('#cfd2db'), topLo = hex('#b2b6c3'), face = hex('#8e93a3'), faceLo = hex('#737888');
  for (let y = 1; y <= 3; y++) for (let x = 4; x <= 13; x++) dot(p, x, y, x === 13 ? topLo : y === 1 ? hex('#e6e9ef') : topC);
  for (let y = 4; y <= 9; y++) for (let x = 4; x <= 13; x++) dot(p, x, y, x === 13 || y === 9 ? faceLo : face);
  for (let x = 5; x <= 12; x++) dot(p, x, 5, hex('#2a2d38'));
  for (const x of [8, 9]) dot(p, x, 5, lit ? hex('#59e07a') : hex('#3a5c46'));
  outline(p);
  return p;
}
