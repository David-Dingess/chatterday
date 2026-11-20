// Bocce's measures and rolls, shared by the server (server/basement/bocce.ts keeps the game) and the page (bocce.tsx
// draws it). Played on the lawn between the horseshoe pits: a court 24 feet long, the lawn's width across; the balls
// 107mm, red and green, the pallino 60mm and white. A frame: the pallino, then four balls a side (two each, two to a side), the side whose
// nearest ball is further away throwing next; then the side nearest scores a point for each of its balls nearer than
// the other side's best. Twelve wins. The pallino must stop past the court's middle line. A ball off the court is dead; the pallino knocked off it makes the frame dead,
// and it is played again.
//
// Along the court u runs from its left end (u = 0) to its right (u = 24); across it v, down the picture positive. The
// grass is the same everywhere, however long it is: every ball rolls on it alike.
import { DOTS } from './yardgames.ts';
import type { Sides } from './yardgames.ts';

export const LONG = 24, HALF_V = 4.8, R = 0.175, PR = 0.1, BALLS = 4, TO = 12;
/** How far out the pallino must stop (from the end it was thrown from), and its place if both sides fail to. */
export const P_MIN = 12, P_MID: [number, number] = [LONG / 2, 0];
/** Where the court's left end is in the yard (dots), and its middle line: between the horseshoe pits (shoes.ts), whose
 *  inner edges are at x 89 and 287. */
export const CX = 92, CY = 143;
/** The two sides, by the colour of their balls (a bocce set's are red and green; the other lawn games are red and blue). */
export const SIDES = ['Red', 'Green'], SIDE_COLORS = ['#d8402c', '#3f9a3a'];
export const roomX = (u: number) => CX + u * DOTS, roomY = (v: number) => CY + v * DOTS;
/** How quickly a ball rolling on the lawn slows (feet a second, every second). */
const FRICTION = 3.2;

export type Ball = { team: number; u: number; v: number; out: boolean };
/** One roll: each ball that moved, its path (u, v every 1/30 s from the start of the roll), and how it ended. The ball
 *  thrown is lobbed first: `air` ms in the air from `from` to the first point of its path. i: -1 the pallino, else its
 *  place in the balls. */
export type Path = { i: number; pts: number[]; out: boolean };
export type Roll = { from: [number, number]; air: number; apex: number; paths: Path[]; ms: number; clacks: number[] };

export type Game = Sides & {
  /** which end is throwing: 0 from the left, 1 from the right */
  end: number;
  /** 'pallino': it is being thrown (`tries`: how many have failed); 'balls': the balls are */
  phase: 'pallino' | 'balls';
  tries: number;
  /** the side that throws the pallino (and the first ball), and whose throw it is */
  first: number; turn: number;
  thrown: number[]; score: number[];
  pallino: { u: number; v: number } | null;
  balls: Ball[];
  /** what the last frame came to: who scored, how many */
  frame: { team: number; pts: number } | null;
  /** a moment's wait (the pallino about to be set again, a dead frame about to be cleared): nobody throws */
  hold?: boolean;
};
export const fresh = (): Game => ({ teams: [[], []], on: false, over: false, winner: -1, last: '', busyUntil: 0, end: 0, phase: 'pallino', tries: 0, first: 0, turn: 0, thrown: [0, 0], score: [0, 0], pallino: null, balls: [], frame: null });

/** Who throws a side's next ball (two on a side take turns); the pallino is thrown by whoever throws the side's first. */
export const thrower = (g: Game, team: number) => { const m = g.teams[team]; return m[g.thrown[team] % Math.max(1, m.length)] ?? null; };
/** Where somebody stands, [x, y] in the yard: everybody at the end that is throwing, Red above the middle, Blue below. */
export function standing(g: Game, uid: string): [number, number] | null {
  for (let team = 0; team < 2; team++) {
    const m = g.teams[team], k = m.indexOf(uid);
    if (k < 0) continue;
    const v = (team === 0 ? -1 : 1) * (1.6 + k * 1.6);
    return [roomX(g.end === 0 ? -0.4 : LONG + 0.4), roomY(v)];
  }
  return null;
}
/** Where a side's ball leaves the hand (an underhand roll, a step in from the end). */
export const release = (e: number, team: number, k: number): [number, number] => [e === 0 ? 0.6 : LONG - 0.6, (team === 0 ? -1 : 1) * (1.2 + k * 1.2)];
export const ahead = (e: number) => (e === 0 ? 1 : -1);
/** How far a ball goes, all told, for a strength of 0 to 1 (feet). */
export const reach = (power: number) => 3 + 24 * power;

const inCourt = (u: number, v: number) => u >= 0 && u <= LONG && Math.abs(v) <= HALF_V;
/** How near the pallino a ball is. */
export const near = (b: { u: number; v: number }, p: { u: number; v: number }) => Math.hypot(b.u - p.u, b.v - p.v);

/** A throw from end e: the pallino (`ball` null) or a side's ball (`ball`: its team), `aim` radians toward +v and `power`
 *  0 to 1, `from` the release point, with `w` normal draws for the hand. Every ball on the court can be struck and
 *  struck on. Returns the pallino and balls after it, and the roll to watch. */
export function roll(g: { pallino: Game['pallino']; balls: Ball[] }, e: number, ball: number | null, from: [number, number], aim: number, power: number, w: number[]) {
  const dir = ahead(e);
  const D = reach(power) * (1 + w[0] * 0.018), a = aim + w[1] * 0.009;
  const du = dir * Math.cos(a), dv = Math.sin(a);
  const lob = Math.min(5, D * 0.16);                                   // through the air for the first part, then rolling
  type B = { i: number; u: number; v: number; vu: number; vv: number; r: number; m: number; out: boolean; moved: boolean; pts: number[]; start: number };
  const all: B[] = [];
  if (g.pallino) all.push({ i: -1, u: g.pallino.u, v: g.pallino.v, vu: 0, vv: 0, r: PR, m: 0.3, out: false, moved: false, pts: [], start: 0 });
  g.balls.forEach((b, i) => { if (!b.out) all.push({ i, u: b.u, v: b.v, vu: 0, vv: 0, r: R, m: 1, out: false, moved: false, pts: [], start: 0 }); });
  const speed = Math.sqrt(2 * FRICTION * Math.max(0.1, D - lob));
  const me: B = { i: ball === null ? -1 : g.balls.length, u: from[0] + du * lob, v: from[1] + dv * lob, vu: du * speed, vv: dv * speed, r: ball === null ? PR : R, m: ball === null ? 0.3 : 1, out: false, moved: true, pts: [], start: 0 };
  all.push(me);
  const air = Math.round(320 + lob * 70);
  const dt = 1 / 240, clacks: number[] = [];
  let t = 0, frame = 0, snaps = 0;
  const at = (b: B) => [Math.round(b.u * 100) / 100, Math.round(b.v * 100) / 100];
  const snap = () => { for (const b of all) if (b.moved && !b.out) { if (!b.pts.length) b.start = snaps; b.pts.push(...at(b)); } snaps++; };
  snap();
  for (let step = 0; step < 240 * 14; step++) {
    let moving = false;
    for (const b of all) {
      if (b.out) continue;
      const s = Math.hypot(b.vu, b.vv);
      if (s < 1e-3) { b.vu = b.vv = 0; continue; }
      moving = true;
      const ns = Math.max(0, s - FRICTION * dt * (b.m < 1 ? 1.25 : 1));
      b.vu *= ns / s; b.vv *= ns / s;
      b.u += b.vu * dt; b.v += b.vv * dt;
      if (!inCourt(b.u, b.v)) { b.out = true; if (!b.pts.length) b.start = snaps; b.pts.push(...at(b)); }
    }
    // knocks: two touching and closing are bounced apart along the line between them (a little lost)
    for (let x = 0; x < all.length; x++) for (let y = x + 1; y < all.length; y++) {
      const p = all[x], q = all[y];
      if (p.out || q.out) continue;
      const nu = q.u - p.u, nv = q.v - p.v, d = Math.hypot(nu, nv), rr = p.r + q.r;
      if (d >= rr || d < 1e-6) continue;
      const ku = nu / d, kv = nv / d, rel = (p.vu - q.vu) * ku + (p.vv - q.vv) * kv;
      if (rel > 0) {
        const j = (1 + 0.82) * rel / (1 / p.m + 1 / q.m);
        p.vu -= (j / p.m) * ku; p.vv -= (j / p.m) * kv; q.vu += (j / q.m) * ku; q.vv += (j / q.m) * kv;
        p.moved = q.moved = true;
        if (rel > 0.3 && (!clacks.length || t - clacks[clacks.length - 1] > 0.06)) clacks.push(Math.round(t * 1000));
      }
      const push = (rr - d) / 2;                                       // (and never left overlapping)
      p.u -= ku * push; p.v -= kv * push; q.u += ku * push; q.v += kv * push;
    }
    t += dt;
    if (++frame % 8 === 0) snap();
    if (!moving) break;
  }
  snap();
  // what moved, from the start of the roll (a ball first struck partway through is padded with where it lay)
  const paths: Path[] = all.filter((b) => b.moved && b.pts.length).map((b) => {
    const was = b === me ? null : b.i === -1 ? g.pallino : g.balls[b.i];
    const pts: number[] = [];
    if (was) for (let k = 0; k < b.start; k++) pts.push(Math.round(was.u * 100) / 100, Math.round(was.v * 100) / 100);
    return { i: b.i, pts: pts.concat(b.pts), out: b.out };
  });
  const n = Math.max(...paths.map((p) => p.pts.length));
  const pallinoB = all.find((b) => b.i === -1);
  const pallino = pallinoB ? { u: pallinoB.u, v: pallinoB.v } : null;
  const balls = g.balls.map((b) => ({ ...b }));
  if (ball !== null) balls.push({ team: ball, u: me.u, v: me.v, out: me.out });
  for (const b of all) if (b.i >= 0 && b.i < g.balls.length && b.moved) { balls[b.i].u = b.u; balls[b.i].v = b.v; balls[b.i].out = b.out; }
  if (ball !== null) { balls[balls.length - 1].u = me.u; balls[balls.length - 1].v = me.v; balls[balls.length - 1].out = me.out; }
  const pallinoOut = !!pallinoB?.out;
  return { pallino, pallinoOut, balls, roll: { from, air, apex: 1.2 + lob * 0.25, paths, ms: Math.round((n / 2) * (1000 / 30)), clacks } as Roll };
}

/** Where a path is `ms` in: [u, v] (its last point once it is over). */
export function pathAt(p: Path, ms: number): [number, number] {
  const k = Math.max(0, ms) / (1000 / 30), n = p.pts.length / 2;
  const i = Math.min(n - 1, Math.floor(k)), j = Math.min(n - 1, i + 1), f = Math.min(1, k - i);
  return [p.pts[i * 2] + (p.pts[j * 2] - p.pts[i * 2]) * f, p.pts[i * 2 + 1] + (p.pts[j * 2 + 1] - p.pts[i * 2 + 1]) * f];
}

/** Which side is nearer the pallino just now (by its nearest ball in play), and that ball's distance for each; -1 when
 *  neither has a ball in, or they are level. */
export function nearer(g: Pick<Game, 'pallino' | 'balls'>): { side: number; best: number[] } {
  const best = [Infinity, Infinity];
  if (g.pallino) for (const b of g.balls) if (!b.out) best[b.team] = Math.min(best[b.team], near(b, g.pallino));
  return { side: best[0] < best[1] ? 0 : best[1] < best[0] ? 1 : -1, best };
}
/** The frame's points: the side nearest scores one for each ball of theirs nearer than the other side's nearest. */
export function points(g: Pick<Game, 'pallino' | 'balls'>): { team: number; pts: number } {
  const { side, best } = nearer(g);
  if (side < 0 || !g.pallino) return { team: -1, pts: 0 };
  const pts = g.balls.filter((b) => !b.out && b.team === side && near(b, g.pallino!) < best[1 - side]).length;
  return { team: side, pts };
}
/** Whether the pallino stopped where it may (in the court, far enough out from the end it was thrown from). */
export const pallinoOk = (p: { u: number; v: number } | null, out: boolean, e: number) => !!p && !out && inCourt(p.u, p.v) && (e === 0 ? p.u : LONG - p.u) >= P_MIN;
