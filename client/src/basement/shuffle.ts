// Table shuffleboard's physics and scoring, shared by the page (to draw) and the server (to slide every weight, once).
//
// The table, seen from above, in inches: x along it from the end the players throw from (0) to the far end (LENGTH), y
// across it (0 down the middle, half its width either side). A weight is thrown from behind the near foul line, slides on
// the powdered wood, slowing steadily, knocks the others about, and is dead if it goes off the far end or into the gutter
// either side. At the far end: wholly past the 1 line (the far foul line) it scores 1, wholly past the 2 line 2, wholly
// past the 3 line 3, and hanging over the end (its edge past the end, its centre not yet: it falls once that goes over) 4.
// A weight touching a line counts for the zone before it, as in the rules; one that stops short of the far foul line, or
// on it, is taken off the table (server/basement/shuffle.ts). When all eight are thrown, only the player with the weight
// furthest down scores: every one of theirs that is further than the other player's furthest.

export const LENGTH = 264, HALF = 10, R = 1.2;           // 22 feet by 20 inches; a weight is about 2 and a quarter across
export const LINES = { foul: 72, one: LENGTH - 72, two: LENGTH - 24, three: LENGTH - 6 };
const DECEL = 30;                                        // inches a second, every second
const STEP = 1 / 480, FRAME_EVERY = 16;
export const FRAME_MS = FRAME_EVERY * STEP * 1000;

/** A weight on the table: whose (0 or 1), where, and whether it is still in play. */
export type Puck = { who: number; x: number; y: number; live: boolean };
export type Slide = { frames: number[][]; pucks: Puck[] };

/** Slide a new weight for `who`, from (0, y0) at `angle` (radians off straight) and strength 0..1, among those on the
 *  table. Frames: every weight's x and y (x -1 once dead), the new one last. */
export function slide(pucks: Puck[], who: number, y0: number, angle: number, power: number): Slide {
  const all = [...pucks.map((p) => ({ ...p, vx: 0, vy: 0 })), { who, x: 0, y: Math.max(-HALF + R, Math.min(HALF - R, y0)), live: true, vx: 0, vy: 0 }];
  const speed = 70 + Math.max(0, Math.min(1, power)) * 90;
  const me = all[all.length - 1];
  me.vx = Math.cos(angle) * speed; me.vy = Math.sin(angle) * speed;
  const frames: number[][] = [];
  const snap = () => frames.push(all.flatMap((p) => (p.live ? [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10] : [-1, 0])));
  snap();
  for (let n = 1; n < 480 * 12; n++) {
    let moving = false;
    for (const p of all) {
      if (!p.live) continue;
      const v = Math.hypot(p.vx, p.vy);
      if (v > 0) {
        const nv = Math.max(0, v - DECEL * STEP);
        p.vx *= nv / v; p.vy *= nv / v;
        p.x += p.vx * STEP; p.y += p.vy * STEP;
        moving ||= nv > 0;
      }
      if (p.x > LENGTH || Math.abs(p.y) > HALF + R * 0.2) { p.live = false; p.vx = p.vy = 0; }     // off the end, or into the gutter
    }
    for (let i = 0; i < all.length; i++) for (let k = i + 1; k < all.length; k++) {
      const a = all[i], b = all[k];
      if (!a.live || !b.live) continue;
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
      if (d < R * 2 && d > 0) {
        const nx = dx / d, ny = dy / d, rel = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
        const push = (R * 2 - d) / 2;
        a.x -= nx * push; a.y -= ny * push; b.x += nx * push; b.y += ny * push;
        if (rel > 0) { const j = rel * 0.92; a.vx -= nx * j; a.vy -= ny * j; b.vx += nx * j; b.vy += ny * j; }
      }
    }
    if (n % FRAME_EVERY === 0) snap();
    if (!moving) break;
  }
  snap();
  return { frames, pucks: all.map(({ who: w, x, y, live }) => ({ who: w, x, y, live })) };
}

/** Whether a weight at `x` is wholly past a line (one on the line, even by a hair, is not). */
export const past = (x: number, line: number) => x - R >= line;
/** What a weight scores where it lies: a hanger, over the end but with its centre still on the wood, is a 4. */
export const pointsAt = (x: number) => (x > LENGTH ? 0 : x + R > LENGTH ? 4 : past(x, LINES.three) ? 3 : past(x, LINES.two) ? 2 : past(x, LINES.one) ? 1 : 0);

/** The round, once all eight are down: who scores, and how many. */
export function score(pucks: Puck[]): { who: number; points: number; scored: [number, number][] } {
  const live = pucks.filter((p) => p.live && past(p.x, LINES.one) && p.x <= LENGTH);
  if (!live.length) return { who: -1, points: 0, scored: [] };
  const best = live.reduce((a, b) => (b.x > a.x ? b : a));
  const theirs = Math.max(-1, ...live.filter((p) => p.who !== best.who).map((p) => p.x));
  /** which weights scored (their place in `pucks`) and what each was worth, to show them */
  const scored = pucks.flatMap((p, i) => (p.live && p.who === best.who && past(p.x, LINES.one) && p.x <= LENGTH && p.x > theirs ? [[i, pointsAt(p.x)] as [number, number]] : []));
  return { who: best.who, points: scored.reduce((t, s) => t + s[1], 0), scored };
}
