// Bowling's physics and scoring, shared by the page (to draw and to add up) and the server (to roll every ball, once).
//
// The lane, seen from above, in inches: x across (0 down the middle, right positive as the bowler sees it), y down the
// lane from the foul line. The lane is 41.5 wide with a gutter each side; the head pin stands 60 feet (720) down, the
// other nine behind it in the usual triangle, 12 apart. A throw is where the bowler stands, the angle it leaves at, how
// hard (0..1) and how much hook (-1..1: positive breaks left, as a right-hander's does). The ball skids straight for the
// first 45 feet (the oil), then hooks, hardest over the last ten. It knocks pins about, and they knock each other; a pin
// that is hit hard enough is down. A ball off the lane drops into the gutter and goes down it to the pit, past everything.
//
// What strikes is the angle the ball comes in at. Too straight and it deflects off the head pin (it is only about
// 2.35 times a pin's weight) and leaves a pin or a split; into the pocket (between the 1 and the 3) at about five
// degrees it drives on through to the 5 and carries; hooked too hard it burns its pace up on the dry boards, comes in
// steep and slow, and leaves the 9 or worse. Pace matters too: a slow ball hooks more and deflects more, a ball thrown
// flat out (power past 0.85) skids, hooking less, and glances off; around 0.75 to 0.85 carries best. Tuned with a
// simulation: a pocket hit at 4-8 degrees strikes about 60-70% of the time, a head-on or light hit hardly ever.

export const LANE_HALF = 20.75, GUTTER = 9.25, PIN_Y = 720, DECK_END = 762;
export const BALL_R = 4.3, PIN_R = 2.4;

/** The ten pins, 1 to 10 (index 0 to 9): the head pin, then 2-3, 4-5-6, 7-8-9-10, left to right. */
export const PINS: [number, number][] = [
  [0, 0], [-6, 1], [6, 1], [-12, 2], [0, 2], [12, 2], [-18, 3], [-6, 3], [6, 3], [18, 3],
].map(([x, row]) => [x, PIN_Y + row * 10.39] as [number, number]);

export type Throw = { x: number; angle: number; power: number; hook: number };
/** A frame of the roll: ball x, y (or -999 once it is in the pit), then each pin's x, y and 1 if down. */
export type Roll = { frames: number[][]; down: number[]; gutter: boolean };

const STEP = 1 / 480;
const FRAME_EVERY = 16;                    // a frame every 16 steps: 33ms
export const FRAME_MS = (FRAME_EVERY * 1000) * STEP;

/** Roll the ball at the pins still standing (`standing[i]`). */
export function roll(t: Throw, standing: boolean[]): Roll {
  const pw = Math.max(0, Math.min(1, t.power)), speed = 250 + pw * 170;           // 14 to 24 mph
  const fast = Math.max(0, pw - 0.85) / 0.15, slow = Math.max(0, 0.7 - pw) / 0.7;
  const MASS = 2.35 * (1 - 0.15 * fast - 0.4 * slow), HOOK = 127 * (1 - 0.2 * fast);       // (a pin weighs 1)
  const ball = { x: Math.max(-LANE_HALF + BALL_R, Math.min(LANE_HALF - BALL_R, t.x)), y: 0, vx: Math.sin(t.angle) * speed, vy: Math.cos(t.angle) * speed, gone: false, gutter: false };
  const pins = PINS.map(([x, y], i) => ({ x, y, vx: 0, vy: 0, up: standing[i], down: false, here: standing[i] }));
  const frames: number[][] = [];
  const snap = () => frames.push([ball.gone ? -999 : Math.round(ball.x * 10) / 10, Math.round(ball.y), ...pins.flatMap((p) => [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10, p.here ? (p.down ? 1 : 0) : 2])]);
  snap();
  let quiet = 0;
  for (let n = 1; n < 480 * 9; n++) {
    if (!ball.gone) {
      // the hook: nothing on the oil, building over the last 15 feet; a big hook costs pace (sharply, near the most)
      const dry = Math.max(0, Math.min(1, (ball.y - 540) / 120));
      if (!ball.gutter) ball.vx += -t.hook * HOOK * dry * STEP;
      ball.vy *= Math.exp(-STEP / 30 - STEP * 0.89 * t.hook ** 4 * (ball.gutter ? 0 : dry));
      ball.x += ball.vx * STEP; ball.y += ball.vy * STEP;
      if (!ball.gutter && Math.abs(ball.x) > LANE_HALF && ball.y < PIN_Y - 20) {           // into the gutter
        ball.gutter = true; ball.vx = 0; ball.x = Math.sign(ball.x) * (LANE_HALF + GUTTER / 2);
      }
      // past where the gutters catch it, the deck has walls (the kickbacks): a ball knocked sideways off a pin bounces
      // off them, soft, rather than rolling off the side of the world (it had, with its rumble playing on for seconds)
      const wall = LANE_HALF + GUTTER - BALL_R;
      if (!ball.gutter && Math.abs(ball.x) > wall) { ball.x = Math.sign(ball.x) * wall; ball.vx *= -0.3; ball.vy *= 0.8; }
      if (ball.y > DECK_END + 12) ball.gone = true;
      // a ball that has all but stopped on the deck (or been turned back) drops off it into the pit
      if (ball.y > PIN_Y - 20 && ball.vy < 25) ball.gone = true;
    }
    // the ball into the pins (it is heavier, but not so heavy it is not turned aside)
    if (!ball.gone && !ball.gutter) for (const p of pins) {
      if (!p.here) continue;
      const dx = p.x - ball.x, dy = p.y - ball.y, d = Math.hypot(dx, dy);
      if (d < BALL_R + PIN_R && d > 0) {
        const nx = dx / d, ny = dy / d, rel = (ball.vx - p.vx) * nx + (ball.vy - p.vy) * ny;
        if (rel > 0) {
          const j = (1.3 * rel) / (1 / 1 + 1 / MASS);
          p.vx += nx * j; p.vy += ny * j; ball.vx -= (nx * j) / MASS; ball.vy -= (ny * j) / MASS;
          p.down = true;
        }
        p.x = ball.x + nx * (BALL_R + PIN_R); p.y = ball.y + ny * (BALL_R + PIN_R);
      }
    }
    // pins into pins: a pin that is moving knocks over whatever it hits
    for (let i = 0; i < pins.length; i++) for (let k = i + 1; k < pins.length; k++) {
      const a = pins[i], b = pins[k];
      if (!a.here || !b.here) continue;
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
      const reach = a.down || b.down ? PIN_R * 2 + 0.6 : PIN_R * 2;      // (a falling pin tips over: it reaches a little further)
      if (d < reach && d > 0) {
        const nx = dx / d, ny = dy / d, rel = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
        if (rel > 0) {
          const j = (1.6 * rel) / 2;
          a.vx -= nx * j; a.vy -= ny * j; b.vx += nx * j; b.vy += ny * j;
          if (rel > 75) { a.down = true; b.down = true; }
        }
      }
    }
    let moving = 0;
    for (const p of pins) {
      if (!p.here) continue;
      const k = Math.exp(-STEP / (p.down ? 0.32 : 0.2));
      p.vx *= k; p.vy *= k;
      p.x += p.vx * STEP; p.y += p.vy * STEP;
      if (Math.hypot(p.x - PINS[pins.indexOf(p)][0], p.y - PINS[pins.indexOf(p)][1]) > 7) p.down = true;
      if (p.y > DECK_END + 10 || Math.abs(p.x) > LANE_HALF + GUTTER) { p.down = true; p.vx = p.vy = 0; }     // into the pit or the gutter
      moving = Math.max(moving, Math.hypot(p.vx, p.vy));
    }
    if (n % FRAME_EVERY === 0) snap();
    if (ball.gone && moving < 2) { if (++quiet > 240) break; } else quiet = 0;
  }
  snap();
  return { frames, down: pins.map((p, i) => (p.here && p.down ? i : -1)).filter((i) => i >= 0), gutter: ball.gutter };
}

/** Each player's pins, ball by ball. Returns the running total after each frame (null where it cannot be added up yet). */
export function scores(rolls: number[]): (number | null)[] {
  const out: (number | null)[] = [];
  let i = 0, total = 0;
  for (let f = 0; f < 10; f++) {
    const a = rolls[i], b = rolls[i + 1], c = rolls[i + 2];
    if (a === undefined) { out.push(null); continue; }
    if (a === 10) {                                    // a strike: ten and the next two balls
      if (b === undefined || c === undefined) { out.push(null); i += 1; continue; }
      total += 10 + b + c; out.push(total); i += 1;
    } else if (b === undefined) { out.push(null); i += 2;
    } else if (a + b === 10) {                         // a spare: ten and the next ball
      if (c === undefined) { out.push(null); i += 2; continue; }
      total += 10 + c; out.push(total); i += 2;
    } else { total += a + b; out.push(total); i += 2; }
  }
  return out;
}

/** The marks for one frame on the scoresheet: X, /, -, or the number. */
export function marks(rolls: number[]): string[][] {
  const out: string[][] = [];
  let i = 0;
  for (let f = 0; f < 10; f++) {
    const m: string[] = [];
    if (f < 9) {
      const a = rolls[i];
      if (a === undefined) { out.push(m); continue; }
      if (a === 10) { m.push('', 'X'); i += 1; }
      else { m.push(a ? String(a) : '-'); const b = rolls[i + 1]; if (b !== undefined) m.push(a + b === 10 ? '/' : b ? String(b) : '-'); i += 2; }
    } else {
      let standing = 10;
      for (let k = 0; k < 3 && rolls[i + k] !== undefined; k++) {
        const v = rolls[i + k];
        m.push(v === 10 && standing === 10 ? 'X' : v === standing ? '/' : v ? String(v) : '-');
        standing = v === standing ? 10 : standing - v;
      }
    }
    out.push(m);
  }
  return out;
}
