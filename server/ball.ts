// The football in the clubhouse. There is one, and the server says where it is: it starts each run of the server
// between the theatre seats and the sofa, and stays wherever the last kick left it. A kick goes where it was aimed
// (dragged back from the ball, like paper thrown at the bin), and is worked out here once with client/src/kick.ts:
// everybody is sent the same roll to play back, where the ball is every STEP_MS until it stops, and the step at which
// it went in the goal, if it did.
import { CLUB } from '../client/src/clubhouse.gen.ts';
import { KICK_STEP_MS, roll } from '../client/src/kick.ts';

type Pt = { x: number; y: number };
export const STEP_MS = KICK_STEP_MS;

let at: Pt = { x: CLUB.ball.x, y: CLUB.ball.y };
let until = 0;                                        // it is rolling until then

/** Where the ball is (or, if it is rolling, where it will stop). */
export const ballNow = (): Pt => ({ x: at.x, y: at.y });

/** Somebody standing at `from` kicks it the way (`dx`, `dy`) they aimed. Returns the roll, or null if it cannot be
 *  kicked just now: it is still rolling, they are nowhere near it, or there was no aim to speak of. */
export function kick(from: Pt, dx: number, dy: number): { path: number[][]; goal: number; rest: number } | null {
  if (Date.now() < until || Math.hypot(at.x - from.x, at.y - from.y) > 34 || Math.hypot(dx, dy) < 3) return null;
  const r = roll(at, dx, dy);
  const end = r.path[r.path.length - 1];
  at = { x: end[0], y: end[1] };
  until = Date.now() + r.path.length * STEP_MS;
  return r;
}
