// The backyard's lawn, shared by the server (server/basement/backyard.ts keeps it) and the page (backyard.tsx draws it).
//
// The lawn is a grid of patches LC dots square over the rect LAYOUT.things.lawn. Each patch knows when the mower last
// went over it with the engine running, and which way it was going: that is all there is to it. Mown, a patch is a
// smoother, paler green, laid over the way it was mown (away from us light, toward us dark), so the mower leaves stripes;
// over GROW_H hours it grows back into the long grass the picture already shows. It is only a look: nothing else in the
// yard (its games, its seats, walking about) reads it.
//
// Nothing has to be sent as it grows: everybody works it out from the same times. Only a cut is news ('mown').
import { LAYOUT } from './backyard.gen.ts';

export const [LX, LY, LW, LH, LC] = LAYOUT.things.lawn as number[];
export const COLS = Math.round(LW / LC), ROWS = Math.round(LH / LC);
/** The lawn's clock ticks every UNIT_MS: when a patch was cut is counted in these from the lawn's `base`. */
export const UNIT_MS = 120_000;
/** Hours for a mown patch to grow back into long grass. */
export const GROW_H = 36;
/** The way the mower was going: up (away from us), right, down (toward us), left. */
export const DIRS = ['up', 'right', 'down', 'left'] as const;
export type Dir = (typeof DIRS)[number];

export type Lawn = { base: number; t: Uint16Array; d: Uint8Array };
export const unitNow = (now = Date.now()) => Math.floor(now / UNIT_MS);
export const newLawn = (now = Date.now()): Lawn => ({ base: unitNow(now), t: new Uint16Array(COLS * ROWS), d: new Uint8Array(COLS * ROWS) });

/** Hours since patch i was mown (Infinity: never). */
export const hoursSince = (l: Lawn, i: number, unit: number) => (l.t[i] ? Math.max(0, ((unit - (l.base + l.t[i])) * UNIT_MS) / 3_600_000) : Infinity);
/** How freshly mown patch i looks: 1 just mown, down to 0 once it has grown back. */
export const mown = (l: Lawn, i: number, unit: number) => Math.max(0, 1 - hoursSince(l, i, unit) / GROW_H);

/** The mower's deck, where it cuts, from the feet of whoever pushes it and the way they face: x0, y0, x1, y1. It is in
 *  front of them (well ahead, pushed away from us), 16 dots across and 8 along. */
export function deck(x: number, y: number, face: Dir): [number, number, number, number] {
  switch (face) {
    case 'down': return [x - 8, y + 8, x + 8, y + 16];
    case 'up': return [x - 8, y - 48, x + 8, y - 40];
    case 'right': return [x + 10, y - 8, x + 20, y + 4];
    default: return [x - 20, y - 8, x - 10, y + 4];
  }
}
/** The way from one point to the next, by the larger of the two moves. */
export const dirOf = (dx: number, dy: number): Dir => (Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'right' : 'left') : dy >= 0 ? 'down' : 'up');

/** Runs the mower along a path (the feet of whoever pushes it, point to point, facing `face0`): every patch under the deck
 *  on the way is mown just now, laid over the way it faces. Returns how many of them were long grass, for the clippings. */
export function mow(l: Lawn, pts: number[][], unit: number, face0?: Dir): number {
  let fresh = 0;
  const t = Math.max(1, Math.min(65535, unit - l.base));
  const stamp = (x: number, y: number, face: Dir) => {
    const [x0, y0, x1, y1] = deck(x, y, face);
    const c0 = Math.max(0, Math.ceil((x0 - LX) / LC - 0.5)), c1 = Math.min(COLS - 1, Math.floor((x1 - LX) / LC - 0.5));
    const r0 = Math.max(0, Math.ceil((y0 - LY) / LC - 0.5)), r1 = Math.min(ROWS - 1, Math.floor((y1 - LY) / LC - 0.5));
    const d = DIRS.indexOf(face);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const i = r * COLS + c;
        if (mown(l, i, unit) === 0) fresh++;
        l.t[i] = t; l.d[i] = d;
      }
    }
  };
  if (pts.length === 1 && face0) stamp(pts[0][0], pts[0][1], face0);
  for (let k = 1; k < pts.length; k++) {
    const [ax, ay] = pts[k - 1], [bx, by] = pts[k];
    const dx = bx - ax, dy = by - ay, n = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)));
    if (!n) continue;
    const face = face0 ?? dirOf(dx, dy);                       // (the way the mower faces, as it was pushed; else the way it went)
    for (let s = 0; s <= n; s++) stamp(ax + (dx * s) / n, ay + (dy * s) / n, face);
  }
  return fresh;
}

// ── to and from a string, for the server to keep and send: three characters a patch ──
// (12 bits of time and 2 of direction. The 2 bits between them once held a blade height; they are written as 0 and
// ignored when read, so a lawn saved before keeps its stripes.)
const ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
export function pack(l: Lawn): string {
  const out: string[] = [];
  for (let i = 0; i < l.t.length; i++) {
    const v = (Math.min(4095, l.t[i]) << 4) | (l.d[i] & 3);
    out.push(ABC[(v >> 12) & 63], ABC[(v >> 6) & 63], ABC[v & 63]);
  }
  return out.join('');
}
export function unpack(base: number, s: unknown): Lawn {
  const l = newLawn();
  if (Number.isFinite(Number(base))) l.base = Number(base);
  if (typeof s !== 'string' || s.length !== COLS * ROWS * 3) return l;          // (a lawn of another size: it starts long)
  for (let i = 0; i < l.t.length; i++) {
    const a = ABC.indexOf(s[i * 3]), b = ABC.indexOf(s[i * 3 + 1]), c = ABC.indexOf(s[i * 3 + 2]);
    if (a < 0 || b < 0 || c < 0) continue;                                         // (a spoilt patch: long)
    const v = (a << 12) | (b << 6) | c;
    l.t[i] = v >> 4; l.d[i] = v & 3;
  }
  return l;
}
/** Moves the lawn's base on, so its times fit in the string's 12 bits: anything cut that long ago has long grown back. */
export function rebase(l: Lawn, unit: number) {
  if (unit - l.base < 3600) return false;
  const shift = unit - l.base - 1800;
  for (let i = 0; i < l.t.length; i++) l.t[i] = l.t[i] > shift ? l.t[i] - shift : 0;
  l.base += shift;
  return true;
}
