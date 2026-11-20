// Kicking the football: how it rolls. The server uses this to work out a kick (once, for everybody: see the 'kick'
// message in server/index.ts and server/ball.ts) and the page uses it to draw the dotted line while somebody aims, so
// the two cannot disagree. Nothing here but arithmetic: no page, no server, and no dice. A kick goes exactly where it
// is aimed, as hard as the pull says, the way paper is thrown at the bin (toss.ts).
//
// It rolls along the floor, comes off the furniture and the walls (the room's own list of them, from
// scripts/make-clubhouse.py) and slows on the carpet. Into the goal by the stairs (CLUB.goal), the net takes the pace
// off it: it lies in the net a moment and then is rolled back out in front of the goal. However it ends, it ends
// somewhere a person can walk to, so it can be kicked again.
import { CLUB } from './clubhouse.gen.ts';

type Pt = { x: number; y: number };
export const MAX_KICK = 58;                // as far back as the ball can be drawn, in the room's dots
export const KICK_STEP_MS = 50;            // a roll is sent as where the ball is this often
const R = 4;                               // half the ball, in the room's dots
const DT = 1 / 120, EVERY = Math.round(KICK_STEP_MS / 1000 / DT);
const [X0, Y0, X1, Y1] = CLUB.floor as number[];      // the edges of the floor
// Each thing in its way, a little bigger all round: by half the ball across, and less up and down the room (the room
// is seen from above and in front, so the ball's foot is near the bottom of its picture).
const BLOCKS = (CLUB.blocks as number[][]).map(([x0, y0, x1, y1]) => [x0 - R, y0 - 2, x1 + R, y1 + 3]);
const hits = (x: number, y: number) => x < X0 || x > X1 || y < Y0 || y > Y1 || BLOCKS.some((b) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3]);
const GOAL = CLUB.goal as { box: number[]; x: number; y: number; mouth: number };
const inGoal = (x: number, y: number) => x >= GOAL.box[0] && x <= GOAL.box[2] && y >= GOAL.box[1] && y <= GOAL.box[3];

// Where a person can stand: the cells of the walking grid that can be reached on foot from the door.
const CELL = CLUB.cell as number, COLS = CLUB.grid[0].length, ROWS = CLUB.grid.length;
const open = (c: number, r: number) => r >= 0 && r < ROWS && c >= 0 && c < COLS && CLUB.grid[r][c] === '.';
function nearest(p: Pt, ok: (c: number, r: number) => boolean): [number, number] | null {
  const c0 = Math.floor(p.x / CELL), r0 = Math.floor(p.y / CELL);
  for (let d = 0; d < 30; d++) {
    for (let r = r0 - d; r <= r0 + d; r++) for (let c = c0 - d; c <= c0 + d; c++) {
      if (Math.max(Math.abs(r - r0), Math.abs(c - c0)) === d && ok(c, r)) return [c, r];
    }
  }
  return null;
}
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
const standable = (c: number, r: number) => reach.has(r * COLS + c);

/** The pull, no longer than MAX_KICK (`dx`, `dy`: the way the ball will go, not the way it was pulled). */
export function aimOf(dx: number, dy: number): Pt {
  const len = Math.hypot(dx, dy), k = len > MAX_KICK ? MAX_KICK / len : 1;
  return { x: dx * k, y: dy * k };
}

/** A whole kick of the ball lying at `at`: where it is every KICK_STEP_MS until it stops (`path`), and the step at
 *  which it went in the goal (`goal`, or -1). A gentle pull nudges it; a full one sends it most of the way across. */
export function roll(at: Pt, dx: number, dy: number): { path: number[][]; goal: number; rest: number } {
  const aim = aimOf(dx, dy), pull = Math.hypot(aim.x, aim.y);
  const speed = pull ? 40 + pull * 5.5 : 0;                           // dots a second, as it leaves the foot
  let { x, y } = at, vx = pull ? (aim.x / pull) * speed : 0, vy = pull ? (aim.y / pull) * speed : 0, goal = -1;
  const path: number[][] = [];
  const note = () => path.push([Math.round(x * 10) / 10, Math.round(y * 10) / 10]);
  note();
  for (let n = 1; n <= 120 * 10 && speed; n++) {
    // (one way at a time, so it comes off a wall or the side of a sofa the right way, and cannot slip through a corner)
    if (hits(x + vx * DT, y)) vx *= -0.72; else x += vx * DT;
    if (hits(x, y + vy * DT)) vy *= -0.72; else y += vy * DT;
    if (goal < 0 && inGoal(x, y)) { goal = path.length; vx *= 0.25; vy *= 0.25; }      // in! the net takes the pace off it
    const v = Math.hypot(vx, vy), slower = Math.max(0, v * Math.exp(-1.05 * DT) - 14 * DT);      // the carpet takes the speed off it
    if (v > 0) { vx *= slower / v; vy *= slower / v; }
    if (n % EVERY === 0) note();
    if (slower < 7) break;
  }
  note();
  const rest = path.length;                                            // (where it came to rest by itself)
  /** Rolls it on, slowly, to `to`. */
  const ease = (to: Pt) => {
    const steps = Math.max(2, Math.ceil(Math.hypot(to.x - x, to.y - y) / 1.4)), x0 = x, y0 = y;
    for (let k = 1; k <= steps; k++) { const f = 1 - (1 - k / steps) ** 2; x = x0 + (to.x - x0) * f; y = y0 + (to.y - y0) * f; note(); }
  };
  if (goal >= 0) {
    // It lies in the net for a moment, and then is rolled back out to the floor in front of the goal.
    for (let k = 0; k < 30; k++) note();
    const cell = nearest({ x: GOAL.mouth + 16, y: GOAL.y }, standable);
    if (cell) ease({ x: cell[0] * CELL + CELL / 2, y: cell[1] * CELL + CELL / 2 });
  } else {
    // It may have stopped where nobody can get at it (tucked against the sofa, say). Then it trickles on, slowly, to the
    // nearest place somebody can stand.
    const cell = nearest({ x, y }, standable);
    if (cell && !standable(Math.floor(x / CELL), Math.floor(y / CELL))) ease({ x: cell[0] * CELL + CELL / 2, y: cell[1] * CELL + CELL / 2 });
  }
  return { path, goal, rest };
}
/** The dotted line while somebody aims: `n` points along the first `share` of the roll (enough to see which way and
 *  how hard, and the first thing it comes off; not where it ends up). */
export function aimDots(at: Pt, dx: number, dy: number, n = 5, share = 1 / 3): number[][] {
  const { path, rest } = roll(at, dx, dy), end = rest;
  const out: number[][] = [];
  for (let k = 1; k <= n; k++) out.push(path[Math.min(path.length - 1, Math.round((end * share * k) / n))]);
  return out;
}
