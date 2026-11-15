// The football in the clubhouse. There is one, and the server says where it is: it starts each run of the server
// between the theatre seats and the sofa, and stays wherever the last kick left it. A kick is worked out here, once,
// and everybody is sent the same roll to play back: where the ball is every STEP_MS until it stops. It bounces off
// the furniture and the walls (the room's own list of them, from scripts/make-clubhouse.py) and always ends up
// somewhere a person can walk to, so it can be kicked again.
import { CLUB } from '../client/src/clubhouse.gen.ts';

type Pt = { x: number; y: number };
export const STEP_MS = 50;
const R = 4;                                          // half the ball, in the room's dots
const [X0, Y0, X1, Y1] = CLUB.floor as number[];      // the edges of the floor
// Each thing in its way, a little bigger all round: by half the ball across, and less up and down the room (the room
// is seen from above and in front, so the ball's foot is near the bottom of its picture).
const BLOCKS = (CLUB.blocks as number[][]).map(([x0, y0, x1, y1]) => [x0 - R, y0 - 2, x1 + R, y1 + 3]);
const hits = (x: number, y: number) => x < X0 || x > X1 || y < Y0 || y > Y1 || BLOCKS.some((b) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3]);

// Where a person can stand: the cells of the walking grid that can be reached on foot from the door.
const CELL = CLUB.cell as number, COLS = CLUB.grid[0].length, ROWS = CLUB.grid.length;
const open = (c: number, r: number) => r >= 0 && r < ROWS && c >= 0 && c < COLS && CLUB.grid[r][c] === '.';
const reach = new Set<number>();
{
  const start = nearest(CLUB.door, open);
  const todo = start ? [start] : [];
  if (start) reach.add(start[1] * COLS + start[0]);
  while (todo.length) {
    const [c, r] = todo.pop()!;
    for (const [dc, dr] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
      const n = (r + dr) * COLS + c + dc;
      if (open(c + dc, r + dr) && !reach.has(n)) { reach.add(n); todo.push([c + dc, r + dr]); }
    }
  }
}
function nearest(p: Pt, ok: (c: number, r: number) => boolean): [number, number] | null {
  const c0 = Math.floor(p.x / CELL), r0 = Math.floor(p.y / CELL);
  for (let d = 0; d < 30; d++) {
    for (let r = r0 - d; r <= r0 + d; r++) for (let c = c0 - d; c <= c0 + d; c++) {
      if (Math.max(Math.abs(r - r0), Math.abs(c - c0)) === d && ok(c, r)) return [c, r];
    }
  }
  return null;
}
const standable = (c: number, r: number) => reach.has(r * COLS + c);

let at: Pt = { x: CLUB.ball.x, y: CLUB.ball.y };
let until = 0;                                        // it is rolling until then

/** Where the ball is (or, if it is rolling, where it will stop). */
export const ballNow = (): Pt => ({ x: at.x, y: at.y });

/** Somebody kicks it. `from` is where they stand: it goes off away from them, give or take a good deal; with nobody
 *  to go by, any way at all. Returns the roll (a point every STEP_MS, the last one where it stops), or null if it
 *  cannot be kicked just now: it is still rolling, or they are nowhere near it. */
export function kick(from: Pt | null): number[][] | null {
  if (Date.now() < until) return null;
  const far = from ? Math.hypot(at.x - from.x, at.y - from.y) : 0;
  if (far > 34) return null;
  let angle = Math.random() * Math.PI * 2;
  if (from && far > 1) angle = Math.atan2(at.y - from.y, at.x - from.x) + (Math.random() - 0.5) * 2.4;
  const speed = 190 + Math.random() * 120;            // dots a second, as it leaves the foot
  let { x, y } = at, vx = Math.cos(angle) * speed, vy = Math.sin(angle) * speed;
  const dt = 1 / 120, path: number[][] = [];
  const note = () => path.push([Math.round(x * 10) / 10, Math.round(y * 10) / 10]);
  note();
  for (let n = 1; n <= 120 * 10; n++) {
    // (one way at a time, so it comes off a wall or the side of a sofa the right way, and cannot slip through a corner)
    if (hits(x + vx * dt, y)) vx *= -0.72; else x += vx * dt;
    if (hits(x, y + vy * dt)) vy *= -0.72; else y += vy * dt;
    const v = Math.hypot(vx, vy), slower = Math.max(0, v * Math.exp(-1.05 * dt) - 14 * dt);      // the carpet takes the speed off it
    if (v > 0) { vx *= slower / v; vy *= slower / v; }
    if (n % 6 === 0) note();
    if (slower < 7) break;
  }
  // It may have stopped where nobody can get at it (tucked against the sofa, say). Then it trickles on, slowly, to the
  // nearest place somebody can stand.
  const cell = nearest({ x, y }, standable);
  if (cell && !standable(Math.floor(x / CELL), Math.floor(y / CELL))) {
    const to = { x: cell[0] * CELL + CELL / 2, y: cell[1] * CELL + CELL / 2 }, steps = Math.max(2, Math.ceil(Math.hypot(to.x - x, to.y - y) / 1.4));
    const x0 = x, y0 = y;
    for (let k = 1; k <= steps; k++) { const f = 1 - (1 - k / steps) ** 2; x = x0 + (to.x - x0) * f; y = y0 + (to.y - y0) * f; note(); }
  } else note();
  at = { x: path[path.length - 1][0], y: path[path.length - 1][1] };
  until = Date.now() + path.length * STEP_MS;
  return path;
}
