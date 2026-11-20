// Beer pong's measures and throws, shared by the server (server/basement/beerpong.ts keeps the game) and the page
// (pong.tsx draws it). A folding table stands on the patio, long way up and down the picture, left of the table and
// chairs: 8 feet by 2, ten cups racked in a triangle (4-3-2-1) at each end, its point toward the middle.
//
// Along the table u runs from Red's end (u = 0, the top of the picture) to Blue's (u = 8); across it v, -1 to 1 (on the
// picture, left to right). Cups stand 4.8 inches across at the top and touch (bigger than life, to be fair to a mouse);
// the ball is 40mm.
import { LAYOUT } from './backyard.gen.ts';
import { DOTS } from './yardgames.ts';
import type { Sides } from './yardgames.ts';

export const LEN = 8, HALF = 1, CUP = 0.2, BALL = 0.066, TABLE_H = 2.4, CUP_H = 0.4;
/** Where the table is in the yard: the dots of its middle line (x), and of its Red end (y). The yard's picture says
 *  (scripts/basement/backyard.py PONG), and keeps people from walking through it. */
export const [TX, TY] = LAYOUT.things.pong;
export const roomX = (v: number) => TX + v * DOTS, roomY = (u: number) => TY + u * DOTS;
const ROW = CUP * 2 * Math.sin(Math.PI / 3), BACK = 0.2;

export type Cup = { u: number; v: number };
/** A rack at the end of side `s` (its own cups), from the back row forward: rows of so many cups each. */
export function rack(s: number, rows: number[]): Cup[] {
  const out: Cup[] = [];
  rows.forEach((n, r) => {
    const d = BACK + r * ROW;
    for (let i = 0; i < n; i++) out.push({ u: s === 0 ? d : LEN - d, v: (i - (n - 1) / 2) * CUP * 2 });
  });
  return out;
}
/** The re-racks a side may ask for, once a game, of the cups it throws at: six into a triangle, four into a diamond. */
export const RERACK: Record<number, number[]> = { 6: [3, 2, 1], 4: [1, 2, 1] };

export type Hop = { from: [number, number]; to: [number, number]; h0: number; h1: number; apex: number; ms: number };
/** A ball's whole flight: hops (through the air, then any bounce) and how it ended. `cup` is the cup it went in (its
 *  place in the other side's cups before the throw), or -1; `rim` whether it went round the rim first. */
export type Toss = { hops: Hop[]; end: 'cup' | 'table' | 'floor'; cup: number; rim: boolean; bounce?: boolean; cup2?: number };
/** A ball bounced off the table into a cup takes that cup and the one nearest it (if any). */
function bounced(cups: Cup[], t: Toss): Toss {
  const c = cups[t.cup];
  let best = -1, bd = Infinity;
  cups.forEach((q, i) => { if (i === t.cup) return; const d = Math.hypot(q.u - c.u, q.v - c.v); if (d < bd) { bd = d; best = i; } });
  return { ...t, bounce: true, cup2: best };
}

export type Pong = Sides & {
  /** each side's own cups, still standing, at its own end (0 Red at the top, 1 Blue at the bottom) */
  cups: Cup[][];
  /** whose throw it is, and which of the side's two balls (0 or 1) */
  turn: number; shot: number;
  /** cups made this turn (both balls in: balls back) */
  hits: number;
  reracked: boolean[];
  /** in rebuttal: the side whose last cup has gone throws on until it misses */
  rebuttal: boolean;
  /** overtimes played (three cups each) */
  ot: number;
};
export const fresh = (): Pong => ({ teams: [[], []], on: false, over: false, winner: -1, last: '', busyUntil: 0, cups: [rack(0, [4, 3, 2, 1]), rack(1, [4, 3, 2, 1])], turn: 0, shot: 0, hits: 0, reracked: [false, false], rebuttal: false, ot: 0 });

/** Who throws a side's ball: with two on a side, one ball each (in rebuttal, by turns); alone, both. */
export const thrower = (g: Pong, team: number) => { const m = g.teams[team]; return m[g.shot % Math.max(1, m.length)] ?? null; };
/** Where a side's players stand (yard dots): at their own end of the table, side by side if two. */
export function standAt(team: number, k: number, n: number): [number, number] {
  const x = n === 2 ? TX + (k === 0 ? -7 : 7) : TX;
  return [x, team === 0 ? TY - 4 : TY + LEN * DOTS + 8];
}
/** Where the ball leaves the hand: just behind the end of the table, in front of whoever throws it. */
export function release(team: number, k: number, n: number): [number, number] {
  return [team === 0 ? -0.35 : LEN + 0.35, n === 2 ? (k === 0 ? -0.55 : 0.55) : 0];
}
/** Which way a side throws along the table. */
export const ahead = (team: number) => (team === 0 ? 1 : -1);
/** How far a throw carries, to the height of a cup's rim, for a strength of 0 to 1 (feet). */
export const carry = (power: number) => 6.2 + 3.2 * power;   // (the racks sit between a quarter and a half: under the shake)
/** The aim as dragged (radians off straight down the table) is gentled to this: small angles are all that matter. */
export const AIM = 0.4, AIM_MAX = 0.2;

/** A ball thrown by side `team` (from release point `from`, `aim` radians toward +v and `power` 0 to 1), at the other
 *  side's cups, with `w` four normal draws for the unsteady hand and the rim, and `r` a uniform draw function. */
export function shoot(cups: Cup[], team: number, from: [number, number], aim: number, power: number, w: number[], r: () => number): Toss {
  const dir = ahead(team);
  const D = carry(power) * (1 + w[0] * 0.01), a = aim + w[1] * 0.007;
  const du = dir * Math.cos(a), dv = Math.sin(a);
  const hops: Hop[] = [];
  const rimH = TABLE_H + CUP_H;
  let at: [number, number] = [from[0] + du * D, from[1] + dv * D];
  hops.push({ from, to: at, h0: 4.6, h1: rimH, apex: 1.4 + D * 0.12, ms: Math.round(520 + D * 55) });
  const onTable = (p: [number, number]) => p[0] >= 0 && p[0] <= LEN && Math.abs(p[1]) <= HALF;
  const nearest = (p: [number, number]) => {
    let best = -1, bd = Infinity;
    cups.forEach((c, i) => { const d = Math.hypot(c.u - p[0], c.v - p[1]); if (d < bd) { bd = d; best = i; } });
    return { i: best, d: bd };
  };
  let rim = false;
  for (let bounce = 0; bounce < 3; bounce++) {
    const n = nearest(at);
    if (n.i >= 0 && n.d < CUP - BALL * 0.6) return { hops, end: 'cup', cup: n.i, rim };                     // in, clean
    if (n.i >= 0 && n.d < CUP + BALL) {                                                                  // on the rim
      const c = cups[n.i];
      if (!rim && r() < 0.6 * (1 - (n.d - (CUP - BALL * 0.6)) / (BALL * 1.6))) {
        rim = true;
        hops.push({ from: at, to: [c.u, c.v], h0: rimH, h1: rimH - 0.1, apex: 0.08, ms: 260 });          // round it and in
        return { hops, end: 'cup', cup: n.i, rim };
      }
      rim = true;                                                                                      // off it, somewhere
      const ang = Math.atan2(at[1] - c.v, at[0] - c.u) + (r() - 0.5) * 1.6, len = 0.5 + r() * 0.9;
      const to: [number, number] = [at[0] + Math.cos(ang) * len, at[1] + Math.sin(ang) * len];
      const land = onTable(to) ? TABLE_H : 0;
      hops.push({ from: at, to, h0: rimH, h1: land, apex: 0.35, ms: 380 });
      at = to;
      if (!land) return { hops, end: 'floor', cup: -1, rim };
      continue;
    }
    if (!onTable(at)) {                                                                                // past the table: down on the patio
      const last = hops[hops.length - 1];
      const to: [number, number] = [at[0] + du * 0.9, at[1] + dv * 0.9];
      last.h1 = TABLE_H * 0.5;
      hops.push({ from: at, to, h0: TABLE_H * 0.5, h1: 0, apex: 0.1, ms: 240 });
      return { hops, end: 'floor', cup: -1, rim };
    }
    // on the table (short of the cups, or between them): the last hop comes down onto it, and it bounces on
    const last = hops[hops.length - 1];
    last.h1 = TABLE_H;
    const hop = 0.9 + r() * 1.4 - bounce * 0.4;
    const to: [number, number] = [at[0] + du * hop, at[1] + dv * hop + (r() - 0.5) * 0.5];
    const n2 = nearest(to);
    const into = n2.i >= 0 && n2.d < CUP + BALL * 0.5;
    hops.push({ from: at, to, h0: TABLE_H, h1: into ? rimH : onTable(to) ? TABLE_H : 0, apex: 0.7 - bounce * 0.2, ms: 340 });
    at = to;
    if (into) {                                                     // only off the first bounce: after that it is rolling, and stops at a cup's side
      if (bounce === 0 && n2.d < CUP - BALL * 0.6 && r() < 0.25) return bounced(cups, { hops, end: 'cup', cup: n2.i, rim });
      return { hops, end: 'table', cup: -1, rim };
    }
    if (!onTable(to)) return { hops, end: 'floor', cup: -1, rim };
  }
  return { hops, end: 'table', cup: -1, rim };
}
/** How long a toss takes to watch (ms). */
export const tossMs = (t: Toss) => t.hops.reduce((n, h) => n + h.ms, 0);
/** Where the ball is `el` ms into a toss: [u, v, height], or null once it is over. */
export function ballAt(t: Toss, el: number): [number, number, number] | null {
  for (const h of t.hops) {
    if (el > h.ms) { el -= h.ms; continue; }
    const p = el / h.ms;
    return [h.from[0] + (h.to[0] - h.from[0]) * p, h.from[1] + (h.to[1] - h.from[1]) * p, h.h0 + (h.h1 - h.h0) * p + h.apex * 4 * p * (1 - p)];
  }
  return null;
}
