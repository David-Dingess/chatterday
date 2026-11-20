// Mini golf's physics, shared by the page (to draw) and the server (to play every putt out, once). A hole is a top-down
// course in its own space (W x H, 600 x 300), from golf-courses.json: the fairway's outline (its edges are the rails),
// more rails inside it, round rubber posts, water (in it: a stroke's penalty and back where the putt was taken from), sand
// (slows the ball right down), slopes (rectangles that tilt one way) and mounds (round hills, or hollows, with perhaps a
// flat top), and one gimmick or two: a windmill whose sails close its door as they come round, pipes (in at one mouth,
// out of another), sliding blocks, one-way flaps, ramps that throw the ball over water, and sweepers (a bar turning on a
// hub, which knocks the ball on as fast as the part of it that struck is moving). A putt is an angle and a strength; the
// ball rolls until it stops, drops, or finds water (a ball does not come to rest where a sweeper will come round).
//
// Everything that moves (the sails, the blocks, the sweepers) is keyed to the clock (`t0`, in ms), so the server and
// every page see it in the same place. The cup takes a ball only if it is slow enough to fall in the time it spends over the hole (a
// ball straight over the middle can be firmer than one clipping the edge); faster, it lips out, bent round by the rim.
//
// A roll's path is a point every few steps: [x, y] on the green, [x, y, z] in the air (z the height, for the page to lift
// it and leave its shadow), [x, y, -1] out of sight in a pipe.

export const W = 600, H = 300;
export const BALL_R = 5, CUP_R = 8, PIPE_R = 11;
export const MIN_SPEED = 50, MAX_SPEED = 540;

type P = [number, number];
/** A block sliding to and fro: at rest it is (x, y, w, h); it moves by (dx, dy) and back again every `period` ms. */
export type Slider = { x: number; y: number; w: number; h: number; dx: number; dy: number; period: number; phase?: number };
/** A pipe: in at mouth `a`, out at `b`, heading `out` degrees (0 across, 90 down the screen). */
export type Pipe = { a: P; b: P; out: number };
/** A windmill: its front wall runs along y, centred on x, `w` wide and `d` deep (going up the screen), with a door `door`
 *  wide through the middle. Its four sails turn at `speed` (radians a second) and shut the door as each comes down. */
export type Mill = { x: number; y: number; w: number; d: number; door: number; speed: number };
export type Hole = {
  name: string; par: number; tee: P; cup: P; fairway: P[];
  walls: [P, P][]; bumpers: [number, number, number][]; water: P[][]; sand: P[][];
  /** [x, y, width, height, push across, push down] (units a second, every second) */
  slopes: [number, number, number, number, number, number][];
  windmill: Mill | null;
  /** [x, y, radius, push, flat]: a round hill (push > 0, away from the middle) or hollow (< 0), flat in the middle out to `flat` */
  mounds?: [number, number, number, number, number?][];
  pipes?: Pipe[];
  sliders?: Slider[];
  /** one-way flaps [a, b]: they swing open for a ball going to the right of a→b (seen down the line), and stop one coming back */
  gates?: [P, P][];
  /** [x, y, width, height, heading in degrees (0, 90, 180, 270)]: uphill that way; off the top edge the ball flies */
  ramps?: [number, number, number, number, number][];
  /** sweepers [x, y, reach, speed, phase]: a bar through a hub at (x, y), `reach` out either side, turning at `speed`
   *  (radians a second; less than nought, the other way), `phase` a part of a turn at t = 0 */
  arms?: [number, number, number, number, number?][];
};
export type Result = 'stopped' | 'holed' | 'water';
export type Roll = {
  path: number[][]; end: P; result: Result;
  /** [point in the path, bumper] for every post a ball hit, the putted one or one it knocked (the page lights them) */
  hits: [number, number][];
  lipped: boolean; piped: boolean; jumped: boolean;
  /** the balls lying on the green that were knocked: `k` is the place in the `others` handed to putt(), the path is on
   *  the same clock as the putted ball's (a point every `every` steps from the stroke), and a ball knocked into water or
   *  off the green is put back where it lay (`end`) */
  knocked: { k: number; path: number[][]; end: P; result: Result }[];
};

const STEP = 1 / 240;
const MAX_T = 15;
const ROLL_DRAG = 34;          // what the green takes off a rolling ball every second; also what a slope must beat to start one
const SAIL_HALF = 0.3;         // how far either side of straight down a sail shuts the door (radians)
const RAMP_PULL = 230;         // a ramp's uphill
const DROP_T = 0.085;          // how long a ball must spend over the hole to fall in (seconds)

const rad = (deg: number) => (deg * Math.PI) / 180;

/** The windmill's sails at time t (ms): the angle of the first (the others a quarter turn on), and whether the door is shut. */
export function sails(h: Hole, t: number): { angle: number; shut: boolean } {
  const m = h.windmill;
  if (!m) return { angle: 0, shut: false };
  const angle = ((t / 1000) * m.speed) % (Math.PI / 2);
  // a sail points straight down (π/2) when the angle, a quarter turn at a time, is π/2 too: within SAIL_HALF of it, shut
  const off = Math.abs(((angle - Math.PI / 2) % (Math.PI / 2) + Math.PI / 2) % (Math.PI / 2));
  return { angle, shut: Math.min(off, Math.PI / 2 - off) < SAIL_HALF };
}
/** The windmill's two blocks either side of the door (x, y, w, h). */
export function millBlocks(m: Mill): [number, number, number, number][] {
  const side = (m.w - m.door) / 2;
  return [[m.x - m.w / 2, m.y - m.d, side, m.d], [m.x + m.door / 2, m.y - m.d, side, m.d]];
}
/** Where a sliding block is at time t (ms), and how fast it is going (units a second). */
export function sliderAt(s: Slider, t: number): { x: number; y: number; vx: number; vy: number } {
  const w = (Math.PI * 2) / s.period, a = w * t + (s.phase ?? 0) * Math.PI * 2;
  const k = 0.5 - 0.5 * Math.cos(a), dk = 0.5 * Math.sin(a) * w * 1000;
  return { x: s.x + s.dx * k, y: s.y + s.dy * k, vx: s.dx * dk, vy: s.dy * dk };
}

/** A sweeper's bar at time t (ms): its angle, and its two tips. */
export function armAt([x, y, reach, speed, phase = 0]: [number, number, number, number, number?], t: number): { angle: number; a: P; b: P } {
  const angle = (t / 1000) * speed + phase * Math.PI * 2, ux = Math.cos(angle) * reach, uy = Math.sin(angle) * reach;
  return { angle, a: [x - ux, y - uy], b: [x + ux, y + uy] };
}

export function inside(p: P, poly: P[]) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
const edges = (poly: P[]): [P, P][] => poly.map((p, i) => [p, poly[(i + 1) % poly.length]]);
const box = (x: number, y: number, w: number, h: number): [P, P][] => edges([[x, y], [x + w, y], [x + w, y + h], [x, y + h]]);
const inRect = (px: number, py: number, x: number, y: number, w: number, h: number) => px >= x && px <= x + w && py >= y && py <= y + h;

type Ball = { x: number; y: number; vx: number; vy: number };
/** Bounce off a line: if the ball is touching it and moving into it, it comes away, a little slower. A line that is itself
 *  moving (wvx, wvy) knocks the ball on with it. */
function bounce(b: Ball, [a, c]: [P, P], give = 0.78, wvx = 0, wvy = 0) {
  const ex = c[0] - a[0], ey = c[1] - a[1], len2 = ex * ex + ey * ey || 1;
  const t = Math.max(0, Math.min(1, ((b.x - a[0]) * ex + (b.y - a[1]) * ey) / len2));
  const qx = a[0] + ex * t, qy = a[1] + ey * t, dx = b.x - qx, dy = b.y - qy, d = Math.hypot(dx, dy);
  if (d >= BALL_R || d === 0) return false;
  const nx = dx / d, ny = dy / d, vn = (b.vx - wvx) * nx + (b.vy - wvy) * ny;
  b.x = qx + nx * BALL_R; b.y = qy + ny * BALL_R;
  if (vn < 0) { b.vx -= (1 + give) * vn * nx; b.vy -= (1 + give) * vn * ny; }
  return true;
}
/** A one-way flap: it lets the ball through going one way (it swings open) and stops it coming back. */
function flap(b: Ball, [a, c]: [P, P]) {
  const ex = c[0] - a[0], ey = c[1] - a[1], len = Math.hypot(ex, ey) || 1, nx = -ey / len, ny = ex / len;
  if ((b.x - a[0]) * nx + (b.y - a[1]) * ny <= 0) return false;        // on the near side: it swings open
  if (b.vx * nx + b.vy * ny >= 0) return false;                          // through, and going on
  return bounce(b, [a, c], 0.45);
}

/** How the ground leans at (x, y): the push it gives a ball there (units a second, every second). */
export function lean(h: Hole, x: number, y: number): P {
  let ax = 0, ay = 0;
  for (const [sx, sy, w, hh, px, py] of h.slopes) if (inRect(x, y, sx, sy, w, hh)) { ax += px; ay += py; }
  for (const [mx, my, r, push, flat = 0] of h.mounds ?? []) {
    const dx = x - mx, dy = y - my, d = Math.hypot(dx, dy);
    if (d <= flat || d >= r || d === 0) continue;
    const k = push * Math.sin((Math.PI * (d - flat)) / (r - flat));         // steepest halfway down, level at the top and the foot
    ax += (dx / d) * k; ay += (dy / d) * k;
  }
  for (const [rx, ry, w, hh, dir] of h.ramps ?? []) if (inRect(x, y, rx, ry, w, hh)) { ax -= Math.cos(rad(dir)) * RAMP_PULL; ay -= Math.sin(rad(dir)) * RAMP_PULL; }
  return [ax, ay];
}

/** One ball on the move (or lying still until something knocks it): its path, a point every `every` steps from the
 *  stroke, and how it is getting on. */
type Body = {
  b: Ball; start: P; path: number[][]; moving: boolean; struck: boolean; done: boolean; result: Result; end: P;
  air: number; airT: number; piped: number; pipe: Pipe | null; mouth: P | null; overCup: boolean; slow: number; wasOnRamp: number;
  lipped: boolean; wasPiped: boolean; jumped: boolean;
};
const BOUNCE_BALLS = 0.9;      // how much of their closing pace two balls keep when they knock together

/** A putt from `from` at `angle` (radians), strength 0..1, struck at time t0 (ms). Where the ball goes, a point every
 *  `every` steps, and how it ended. `others` are the balls lying on the green: the putted ball knocks them (equal
 *  weights, a little lost), they roll on by the same rules and knock each other, and each that moved is in `knocked`. */
export function putt(h: Hole, from: P, angle: number, power: number, t0: number, every = 8, others: P[] = []): Roll {
  const speed = MIN_SPEED + Math.max(0, Math.min(1, power)) * (MAX_SPEED - MIN_SPEED);
  const walls = [...edges(h.fairway), ...h.walls];
  if (h.windmill) for (const [x, y, w, hh] of millBlocks(h.windmill)) walls.push(...box(x, y, w, hh));
  const r1 = (v: number) => Math.round(v * 10) / 10;
  const body = (p: P, vx: number, vy: number, moving: boolean): Body => ({
    b: { x: p[0], y: p[1], vx, vy }, start: p, path: [[r1(p[0]), r1(p[1])]], moving, struck: moving, done: false, result: 'stopped', end: p,
    air: 0, airT: 0, piped: 0, pipe: null, mouth: null, overCup: false, slow: 0, wasOnRamp: -1, lipped: false, wasPiped: false, jumped: false,
  });
  const bodies = [body(from, Math.cos(angle) * speed, Math.sin(angle) * speed, true), ...others.map((p) => body(p, 0, 0, false))];
  const hits: [number, number][] = [];
  const finish = (q: Body, result: Result, at: P) => { q.path.push([r1(at[0]), r1(at[1])]); q.result = result; q.end = result === 'holed' ? h.cup : q.start; q.done = true; };

  /** One step for one ball: true if it has come to rest. */
  const step = (q: Body, t: number): boolean => {
    const b = q.b;
    // in a pipe: out of sight a moment, then out of the other end
    if (q.piped > 0) {
      if (--q.piped === 0) {
        const pp = q.pipe!, sp = Math.max(70, Math.hypot(b.vx, b.vy) * 0.85);
        b.vx = Math.cos(rad(pp.out)) * sp; b.vy = Math.sin(rad(pp.out)) * sp;
        b.x += Math.cos(rad(pp.out)) * (PIPE_R - 2); b.y += Math.sin(rad(pp.out)) * (PIPE_R - 2);
      }
      return false;
    }
    const sp = Math.hypot(b.vx, b.vy);
    if (q.air > 0) {
      // in the air: nothing on the ground touches it, only the rails round the outside
      b.x += b.vx * STEP; b.y += b.vy * STEP;
      for (const wl of edges(h.fairway)) bounce(b, wl, 0.6);
      q.air -= STEP;
      if (q.air <= 0) {                                                     // down: the landing takes most of the pace off
        b.vx *= 0.62; b.vy *= 0.62;
        if (h.water.some((w) => inside([b.x, b.y], w))) finish(q, 'water', [b.x, b.y]);
      }
      return false;
    }
    const p: P = [b.x, b.y];
    // the green: rolling slows it (more on sand), slopes push it
    const sand = h.sand.some((s) => inside(p, s));
    const keep = Math.exp(-STEP / (sand ? 0.22 : 1.3));
    b.vx *= keep; b.vy *= keep;
    if (sp > 0) { const drop = Math.min(sp, (sand ? 160 : ROLL_DRAG) * STEP); b.vx -= (b.vx / sp) * drop; b.vy -= (b.vy / sp) * drop; }
    const [ax, ay] = lean(h, b.x, b.y);
    b.vx += ax * STEP; b.vy += ay * STEP;
    b.x += b.vx * STEP; b.y += b.vy * STEP;
    // a ramp: off its top edge, going its way, the ball flies; the faster, the further (as the square of the pace)
    const ramps = h.ramps ?? [];
    const onRamp = ramps.findIndex(([x, y, w, hh]) => inRect(b.x, b.y, x, y, w, hh));
    if (q.wasOnRamp >= 0 && onRamp < 0) {
      const [x, y, w, hh, dir] = ramps[q.wasOnRamp], ux = Math.cos(rad(dir)), uy = Math.sin(rad(dir));
      const over = ux > 0.5 ? b.x > x + w : ux < -0.5 ? b.x < x : uy > 0.5 ? b.y > y + hh : b.y < y;
      const along = b.vx * ux + b.vy * uy;
      if (over && along > 40) { q.airT = q.air = Math.hypot(b.vx, b.vy) / 700; q.jumped = true; q.wasOnRamp = -1; return false; }
    }
    q.wasOnRamp = onRamp;
    for (const wl of walls) bounce(b, wl);
    if (h.windmill && sails(h, t).shut) { const m = h.windmill; bounce(b, [[m.x - m.door / 2, m.y], [m.x + m.door / 2, m.y]], 0.5); }
    for (const s of h.sliders ?? []) { const v = sliderAt(s, t); for (const e of box(v.x, v.y, s.w, s.h)) bounce(b, e, 0.7, v.vx, v.vy); }
    for (const gt of h.gates ?? []) flap(b, gt);
    // a sweeper: the bar knocks the ball on as fast as the part of it that struck is going (faster out at the tips)
    for (const arm of h.arms ?? []) {
      const { a, b: c } = armAt(arm, t), ex = c[0] - a[0], ey = c[1] - a[1], u = Math.max(0, Math.min(1, ((b.x - a[0]) * ex + (b.y - a[1]) * ey) / (ex * ex + ey * ey)));
      const rx = a[0] + ex * u - arm[0], ry = a[1] + ey * u - arm[1];
      bounce(b, [a, c], 0.6, -arm[3] * ry, arm[3] * rx);
      if (Math.hypot(b.x - arm[0], b.y - arm[1]) < 4 + BALL_R) { const d = Math.hypot(b.x - arm[0], b.y - arm[1]) || 1; b.x = arm[0] + ((b.x - arm[0]) / d) * (4 + BALL_R); b.y = arm[1] + ((b.y - arm[1]) / d) * (4 + BALL_R); }   // (the hub)
    }
    h.bumpers.forEach(([cx, cy, r], k) => {
      const dx = b.x - cx, dy = b.y - cy, d = Math.hypot(dx, dy);
      if (d < r + BALL_R && d > 0) {
        const nx = dx / d, ny = dy / d, vn = b.vx * nx + b.vy * ny;
        b.x = cx + nx * (r + BALL_R); b.y = cy + ny * (r + BALL_R);
        if (vn < 0) { b.vx -= 1.9 * vn * nx; b.vy -= 1.9 * vn * ny; hits.push([q.path.length, k]); }   // (rubber gives a little back)
      }
    });
    const now = Math.hypot(b.vx, b.vy);
    // the cup: in, if the ball spends long enough over the hole to drop; if not, the rim turns it and it skims on
    const cdx = b.x - h.cup[0], cdy = b.y - h.cup[1], cd = Math.hypot(cdx, cdy);
    if (cd < CUP_R) {
      if (!q.overCup) {
        q.overCup = true;
        const off = now > 0 ? Math.abs(cdx * b.vy - cdy * b.vx) / now : 0;    // how far off the middle its line runs
        const chord = 2 * Math.sqrt(Math.max(0, CUP_R * CUP_R - off * off));
        if (now <= chord / DROP_T + 12) { finish(q, 'holed', h.cup); return false; }
        // a lip-out: bent away from the side it caught, and slowed by the rim
        const side = Math.sign(cdx * b.vy - cdy * b.vx) || 1, turn = side * (0.35 + 0.5 * (off / CUP_R)), k = 0.72;
        const c = Math.cos(turn), s = Math.sin(turn), vx = b.vx;
        b.vx = (vx * c - b.vy * s) * k; b.vy = (vx * s + b.vy * c) * k;
        q.lipped = true;
      } else if (now < 30) { finish(q, 'holed', h.cup); return false; }    // (it stalled on the rim)
    } else q.overCup = false;
    if (h.water.some((w) => inside([b.x, b.y], w))) { finish(q, 'water', [b.x, b.y]); return false; }
    // a pipe's mouth: in it goes (the mouth is the last the page sees of it)
    const pp = (h.pipes ?? []).find((v) => Math.hypot(b.x - v.a[0], b.y - v.a[1]) < PIPE_R - 3);
    if (pp) {
      q.mouth = pp.a; q.pipe = pp; q.wasPiped = true;
      b.x = pp.b[0]; b.y = pp.b[1];
      q.piped = Math.max(60, Math.min(150, Math.round(Math.hypot(pp.a[0] - pp.b[0], pp.a[1] - pp.b[1]) / 3)));
      return false;
    }
    // stopped: slow for a quarter of a second (a ball turning round on a slope passes through slow, and goes on)
    const [lx, ly] = lean(h, b.x, b.y);
    q.slow = now < 3 ? q.slow + 1 : 0;
    const swept = (h.arms ?? []).some(([x, y, reach]) => Math.hypot(b.x - x, b.y - y) < reach + BALL_R - 0.5);   // (a sweeper will be round for it)
    return !swept && ((now < 1.5 && Math.hypot(lx, ly) <= ROLL_DRAG) || q.slow > 60);
  };
  /** At rest: it lies there (and other balls still rolling can knock it again) until everything has stopped. */
  const rest = (q: Body) => { q.moving = false; q.b.vx = q.b.vy = 0; q.slow = 0; };
  /** Two balls on the ground touching: if closing, equal weights share the push along the line between them. */
  const knock = (p: Body, q: Body) => {
    const a = p.b, c = q.b, d = Math.hypot(c.x - a.x, c.y - a.y);
    if (d >= BALL_R * 2) return;
    let nx: number, ny: number;
    if (d > 1e-9) { nx = (c.x - a.x) / d; ny = (c.y - a.y) / d; }
    else { const m = Math.hypot(a.vx - c.vx, a.vy - c.vy); if (!m) return; nx = (a.vx - c.vx) / m; ny = (a.vy - c.vy) / m; }   // (one on top of the other)
    const vn = (a.vx - c.vx) * nx + (a.vy - c.vy) * ny;        // closing pace along the line
    if (vn > 0) {
      const j = ((1 + BOUNCE_BALLS) * vn) / 2;
      a.vx -= j * nx; a.vy -= j * ny; c.vx += j * nx; c.vy += j * ny;
      p.moving = q.moving = p.struck = q.struck = true;
    }
    // overlapping: only a ball already moving is moved out, so a ball nothing struck never shifts
    const over = BALL_R * 2 - d, ma = p.moving && (a.vx || a.vy), mc = q.moving && (c.vx || c.vy), share = ma && mc ? 0.5 : 1;
    if (ma) { a.x -= nx * over * share; a.y -= ny * over * share; }
    if (mc) { c.x += nx * over * share; c.y += ny * over * share; }
  };

  for (let n = 1; n * STEP < MAX_T; n++) {
    const t = t0 + n * STEP * 1000;
    for (const q of bodies) if (q.moving && !q.done && step(q, t)) rest(q);
    if (bodies.length > 1) {
      const ground = (q: Body) => !q.done && q.piped === 0 && q.air <= 0;
      for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) {
        const p = bodies[i], q = bodies[j];
        if ((p.moving || q.moving) && ground(p) && ground(q)) knock(p, q);
      }
    }
    if (n % every === 0) for (const q of bodies) {
      if (q.done) continue;
      const b = q.b;
      if (q.piped > 0) { q.path.push(q.mouth ? [q.mouth[0], q.mouth[1]] : [r1(b.x), r1(b.y), -1]); q.mouth = null; }
      else if (q.air > 0) { const f = 1 - q.air / q.airT; q.path.push([r1(b.x), r1(b.y), r1(q.airT * 90 * 4 * f * (1 - f))]); }
      else q.path.push([r1(b.x), r1(b.y)]);
    }
    if (bodies.every((q) => q.done || !q.moving)) break;
  }
  // where each lies (out of time: where it is), if that is safely on the green; a ball pushed through a rail's corner
  // goes back where it was
  for (const q of bodies) if (!q.done) {
    const end: P = [r1(q.b.x), r1(q.b.y)];
    q.done = true;
    if (!inside(end, h.fairway) || h.water.some((w) => inside(end, w))) q.end = q.start;
    else { q.end = end; const last = q.path[q.path.length - 1]; if (last[0] !== end[0] || last[1] !== end[1] || last.length > 2) q.path.push(end); }
  }
  const [m] = bodies;
  return {
    path: m.path, end: m.end, result: m.result, hits, lipped: m.lipped, piped: m.wasPiped, jumped: m.jumped,
    knocked: bodies.slice(1).map((q, k) => ({ k, q })).filter(({ q }) => q.struck).map(({ k, q }) => ({ k, path: q.path, end: q.end, result: q.result })),
  };
}
