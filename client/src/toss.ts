// Throwing paper at the bin in the kitchen: how a wad flies. The server uses this to work out a throw (once, for
// everybody: see the 'toss' message in server/index.ts) and the page uses it to draw the dotted line while somebody
// aims, so the two cannot disagree. Nothing here but arithmetic: no page, no server.
//
// A throw goes where it is aimed, as the room is drawn: in a straight line across the picture from the hand, the
// opposite way to the pull, and it comes down where the pull's strength carries it. (It was once a true lob in a room
// seen from above and in front: the wad was drawn its full height above its place on the floor, so a hard throw
// "down" the room sailed up the picture instead, the dotted line bent away from where it was pointed, and the wad
// came off walls nobody could see it reach.) Its height is still worked out, for when it comes down and how it
// bounces, but it never moves the wad in the picture: a wad is drawn exactly where it is, so what it hits (a wall,
// the bin) it is seen to hit. Height only makes it look nearer: a little bigger (GROW), its shadow a little further
// off. The bin's mouth is where it is drawn.
import { CLUB } from './clubhouse.gen.ts';

export const MAX_PULL = 58;                // as far back as a hand can be drawn, in the room's dots
export const TOSS_STEP_MS = 1000 / 24;     // a throw is sent as where the wad is this often
export const GROW = 0.006;                 // how much bigger a wad is drawn for each dot of height (about 1.7 times at the top of the hardest throw)
const GRAVITY = 430, DT = 1 / 120;
const BIN = CLUB.trash as { x: number; y: number; rim: number; rx: number; ry: number };
const MOUTH = { x: BIN.x, y: BIN.y - BIN.rim };      // the middle of the bin's mouth, in the picture
const LOW = 5;                             // under this height a wad is down at the mouth, or against the bin's side
const [X0, Y0, X1, Y1] = CLUB.floor as number[];
const UP_WALL = 40;                        // how far up the picture of the back wall a wad in the air may be (somebody standing at that wall has their hand over it)
const LATE = 0.8;                          // a throw is over everything in the room for this much of its flight; only in the rest of it, coming down, can it hit the furniture
// The furniture and the inside walls, to come down against: the same rectangles the walking grid is made from
// (not the bin's own, which has its mouth and its sides: see below).
const BLOCKS = (CLUB.blocks as number[][]).filter(([x0, y0, x1, y1]) => !(BIN.x >= x0 && BIN.x <= x1 && BIN.y >= y0 && BIN.y <= y1)).map(([x0, y0, x1, y1]) => [x0 - 2, y0 - 1, x1 + 2, y1 + 2]);
const blocked = (x: number, y: number) => BLOCKS.some((b) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3]);

/** How a wad leaves the hand, from how far the hand was drawn back (`dx`, `dy`: the way it will go, not the way it was pulled). */
export function launch(dx: number, dy: number) {
  // (A gentle pull throws gently; the last of the pull adds more and more, so a full one carries most of the way across the room.)
  const len = Math.sqrt(dx * dx + dy * dy) || 1, pull = Math.min(MAX_PULL, len), speed = pull * 4.3 * (1 + 0.271 * (pull / MAX_PULL) ** 2);
  return { vx: (dx / len) * speed * 0.8, vy: (dy / len) * speed * 0.8, vz: 95 + speed * 0.72 };
}

/** The dotted line while somebody aims: where the wad will be at `n` moments over the first `share` of the throw
 *  (its start only, a third of it: enough to see which way and how hard, not where it comes down). */
export function aimDots(x: number, y: number, dx: number, dy: number, n = 5, share = 1 / 3): number[][] {
  const v = launch(dx, dy), whole = (2 * v.vz) / GRAVITY, out: number[][] = [];
  for (let k = 1; k <= n; k++) { const t = (whole * share * k) / n; out.push([x + v.vx * t, y + v.vy * t]); }
  return out;
}

/** A whole throw from the hand at (x, y): [x, y, height] every TOSS_STEP_MS until the wad drops into the bin (`made`)
 *  or has stopped. `rims`: how many times it came off the rim on the way. `random` settles which way it comes off the rim. */
export function toss(x: number, y: number, dx: number, dy: number, random: () => number = Math.random) {
  let { vx, vy, vz } = launch(dx, dy), z = 0, made = false, rims = 0, bounces = 0;
  const flight = (2 * vz) / GRAVITY;                                               // how long until it is back down to the height it left at
  const path: number[][] = [], every = Math.round(TOSS_STEP_MS / 1000 / DT);
  const note = () => path.push([Math.round(x * 10) / 10, Math.round(y * 10) / 10, Math.round(z * 10) / 10]);
  /** How far from the middle of the bin's mouth, in mouths: under 1 is over the opening. */
  const off = () => Math.sqrt(((x - MOUTH.x) / BIN.rx) ** 2 + ((y - MOUTH.y) / BIN.ry) ** 2);
  /** Against the side of the bin, under its mouth. */
  const onBin = () => Math.abs(x - BIN.x) <= 7.5 && y > MOUTH.y + BIN.ry && y <= BIN.y + 3;
  note();
  for (let n = 1; n <= 120 * 8; n++) {
    const was = z;
    // For most of its flight a wad is up over everything in the room. Only coming down (the last fifth of the
    // flight, and any bounce after) can it come up against a piece of furniture or an inside wall: one way at a
    // time, so it comes off the side it met. What it comes down on top of, it simply lands on.
    const late = n * DT >= flight * LATE || bounces > 0 || rims > 0, inside = late && blocked(x, y);
    if (late && !inside && blocked(x + vx * DT, y)) vx *= -0.4; else x += vx * DT;
    if (late && !inside && blocked(x, y + vy * DT)) vy *= -0.4; else y += vy * DT;
    vz -= GRAVITY * DT; z += vz * DT;
    if (x < X0 || x > X1) { x = Math.max(X0, Math.min(X1, x)); vx *= -0.4; }      // the sides of the room
    // The back wall and the near one. A wad in the air may be over the picture of the back wall (it starts there, in
    // the hand of anybody standing at that wall), but it comes down to the floor at the foot of it.
    if (y < Y0 - UP_WALL || y > Y1) { y = Math.max(Y0 - UP_WALL, Math.min(Y1, y)); vy *= -0.4; }
    if (vz < 0 && y < Y0 - z * 0.45) y = Math.min(Y0, y + 40 * DT);
    if (vz < 0 && was >= LOW && z < LOW && off() <= 1.9) {                        // coming down at the bin's mouth
      if (off() <= 1) { made = true; note(); break; }                             // into it
      rims++;                                                                     // on the rim: it hops, and may yet drop in
      z = LOW; vz = -vz * 0.42;
      const inward = random() < 0.45 ? -1 : 1, kick = 14 + random() * 22, d = Math.sqrt((x - MOUTH.x) ** 2 + (y - MOUTH.y) ** 2) || 1;
      vx = vx * 0.15 + ((x - MOUTH.x) / d) * kick * inward; vy = vy * 0.15 + ((y - MOUTH.y) / d) * kick * inward * 0.6;
    } else if (late && z < LOW && onBin()) {                                      // against the side of the bin: it comes back off it
      x -= vx * DT; y -= vy * DT;
      vx *= -0.4; vy *= -0.4;
    }
    if (z <= 0) {                                                                 // down: a bounce or two, each smaller, then it lies still
      z = 0;
      if (Math.abs(vz) < 45 || ++bounces > 4) { note(); break; }
      vz = -vz * 0.42; vx *= 0.55; vy *= 0.55;
    }
    if (n % every === 0) note();
  }
  return { path, made, rims };
}
