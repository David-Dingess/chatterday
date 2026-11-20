// Horseshoes' measures and pitches, shared by the server (server/basement/horseshoes.ts keeps the game) and the page
// (shoes.tsx draws it). Two stakes 30 feet apart along the lawn (the official distance for women, juniors and over-70s:
// the men's 40 would not leave both pits on the grass, the lawn being 43 feet across), each in a sandpit 4 feet long and
// 3 across, the stakes standing 14 inches out of the sand. A shoe is about 7 inches across, with 3.5 inches between its
// calks.
//
// Along the pitch u runs from the left stake (u = 0) to the right one (u = 30); across it v, down the picture positive.
import { DOTS } from './yardgames.ts';
import type { Sides } from './yardgames.ts';

export const GAP = 30, PIT_HALF_U = 2, PIT_HALF_V = 1.5, STAKE_R = 0.042, SHOE = 0.3, OPEN = 0.145;
/** Where the left stake stands in the yard (dots): the pitch in the middle of the lawn (x 14 to 362, y 100 to 186),
 *  both pits well in from the fence and the patio. */
export const SX = 68, SY = 143;
export const roomX = (u: number) => SX + u * DOTS, roomY = (v: number) => SY + v * DOTS;
export const STAKES = [0, GAP] as const;
/** Shoes each a side in an inning; points to win. */
export const SHOES = 2, TO = 21;

export type At = 'ringer' | 'leaner' | 'pit' | 'out';
/** A shoe where it lies: `a` the way its open end faces (radians, on the ground), at which stake (`stake`, 0 or 1). */
export type Shoe = { team: number; u: number; v: number; a: number; at: At; stake: number };
/** A shoe's journey in a pitch: from where it lands (or lay) to where it stops, starting `delay` (0 to 1) of the way through
 *  the settle (one knocked by another goes when struck). `spin`: how many turns it makes in the air (the pitched one). */
export type Move = { i: number; from: [number, number]; to: [number, number]; a0: number; a1: number; at: At; delay: number };
export type Pitch = { from: [number, number]; land: [number, number]; apex: number; turns: number; moves: Move[]; flightMs: number; settleMs: number; clank: boolean };

export type Game = Sides & {
  /** which end is pitching: 0 from the left stake, at the right one; 1 back again */
  end: number; turn: number; thrown: number[]; first: number; score: number[]; shoes: Shoe[];
  /** what the last inning came to for each side (after cancelling) */
  inning: number[] | null;
};
export const fresh = (): Game => ({ teams: [[], []], on: false, over: false, winner: -1, last: '', busyUntil: 0, end: 0, turn: 0, thrown: [0, 0], first: 0, score: [0, 0], shoes: [], inning: null });

/** Who pitches for a side from the end that is pitching: two on a side stand one at each end; one walks. */
export const thrower = (g: Game, team: number) => { const m = g.teams[team]; return m.length === 2 ? m[g.end] : m[0] ?? null; };
/** Where somebody on a side stands just now, [x, y, end] in the yard (null: not playing). Pitchers stand beside the pit,
 *  Red below it and Blue above, a step in front of the stake. */
export function standing(g: Game, uid: string): [number, number, number] | null {
  for (let team = 0; team < 2; team++) {
    const m = g.teams[team], k = m.indexOf(uid);
    if (k < 0) continue;
    const e = m.length === 2 ? k : g.end;
    return [roomX(e === 0 ? 1.4 : GAP - 1.4), roomY(team === 0 ? 2.5 : -2.4), e];
  }
  return null;
}
/** Where a shoe leaves the hand from end e: at the foul line, 3 feet in front of the stake, on the pitcher's side. */
export const release = (e: number, team: number): [number, number] => [e === 0 ? 3 : GAP - 3, team === 0 ? 1.7 : -1.7];
export const ahead = (e: number) => (e === 0 ? 1 : -1);
/** How far a shoe carries for a strength of 0 to 1 (feet): the far stake is 27 feet from the foul line, at about
 *  four-fifths strength (past half, where the hand shakes). */
export const carry = (power: number) => 16 + 14 * power;
const inPit = (s: number, u: number, v: number) => Math.abs(u - STAKES[s]) <= PIT_HALF_U && Math.abs(v) <= PIT_HALF_V;
const dist = (a: number, b: number, c: number, d: number) => Math.hypot(a - c, b - d);
/** How near the stake a shoe is: from the stake to the nearest part of the shoe (feet). */
export const nearness = (s: Shoe) => (s.at === 'ringer' || s.at === 'leaner' ? 0 : Math.max(0, dist(s.u, s.v, STAKES[s.stake], 0) - SHOE));

/** A shoe pitched from end e by a side, `aim` radians toward +v from straight down the pitch and `power` 0 to 1, with `w`
 *  normal draws for the hand and `r` uniform draws for how it meets the stake. Returns the shoes after it, and the pitch. */
export function pitch(shoes: Shoe[], e: number, team: number, aim: number, power: number, w: number[], r: () => number): { shoes: Shoe[]; pitch: Pitch } {
  const from = release(e, team), dir = ahead(e), s = e === 0 ? 1 : 0, su = STAKES[s];
  const D = carry(power) * (1 + w[0] * 0.012), a = aim + w[1] * 0.006;
  const du = dir * Math.cos(a), dv = Math.sin(a);
  const land: [number, number] = [from[0] + du * D, from[1] + dv * D];
  const out = shoes.map((q) => ({ ...q }));
  const i = out.length, moves: Move[] = [];
  const turns = 1 + Math.round(r() * 2) + 0.25 * Math.round(r() * 3);       // a turn and a quarter, more or less
  const heading = Math.atan2(dv, du);
  const a0 = heading + turns * Math.PI * 2;
  out.push({ team, u: land[0], v: land[1], a: a0, at: 'out', stake: s });
  let clank = false;

  const shoe = out[i];
  const sand = inPit(s, land[0], land[1]);
  // it slides on in the sand (further the flatter and harder it came in); on the grass it stops near where it fell
  let slide = sand ? Math.max(0.15, 0.45 + 0.012 * (D - (GAP - 6)) + w[2] * 0.12) : 0.12;
  let to: [number, number] = [land[0] + du * slide, land[1] + dv * slide];
  let at: At = sand ? 'pit' : 'out';
  let face = heading + (r() - 0.5) * 1.2;
  // does it meet the stake on the way? (its line passing the stake, and how far off it)
  const along = (su - land[0]) * du + (0 - land[1]) * dv;           // how far along the slide the stake is
  const off = Math.abs((su - land[0]) * dv - (0 - land[1]) * du);   // and how far to one side
  const onTop = dist(land[0], land[1], su, 0) < SHOE * 0.8;
  if (sand && (onTop || (along > -0.1 && along < slide + SHOE) && off < SHOE + STAKE_R)) {
    clank = true;
    const left = Math.max(0, slide - along);                        // how much slide it still had at the stake
    const open = r() < 0.72;                                         // its open end leading
    if (off < OPEN - STAKE_R && open && r() > Math.min(0.7, Math.max(0, left - 0.35) * 0.9)) {
      at = 'ringer';                                                  // round the stake: its heel past it, open end back
      to = [su + du * 0.18, dv * 0.18 + (r() - 0.5) * 0.04];
      face = heading + Math.PI;
    } else if (r() < (off < SHOE * 0.6 ? 0.16 : 0.08)) {
      at = 'leaner';                                                  // stopped against it, leaning on it
      to = [su - du * 0.16, -dv * 0.16 + (r() - 0.5) * 0.1];
      face = heading;
    } else {                                                          // off it: glances away, or drops in front of it
      const side = -(Math.sign((0 - land[1]) * du - (su - land[0]) * dv) || 1);   // (to the side it came in on)
      const k = 0.2 + r() * (0.25 + left * 0.5);
      to = [su - du * (0.25 + r() * 0.2) - dv * side * k * 0.6, -dv * (0.25) + du * side * k];
      face = heading + (r() - 0.5) * 2.5;
    }
  }
  if (at !== 'ringer' && at !== 'leaner') at = inPit(s, to[0], to[1]) ? 'pit' : 'out';
  // a shoe lying where this one comes in is knocked on (a ringer knocked off, maybe)
  const hit = out.findIndex((o, j) => j !== i && o.stake === s && o.at !== 'out' && (dist(to[0], to[1], o.u, o.v) < SHOE * 1.2 || dist(land[0], land[1], o.u, o.v) < SHOE));
  if (hit >= 0 && at !== 'ringer') {
    const o = out[hit], was: [number, number] = [o.u, o.v], k = 0.3 + r() * 0.4;
    const off2 = o.at === 'ringer' ? r() < 0.45 : o.at === 'leaner' ? r() < 0.8 : true;
    if (off2) {
      o.u += du * k; o.v += dv * k + (r() - 0.5) * 0.2;
      const a1 = o.a + (r() - 0.5) * 1.5;
      o.at = inPit(s, o.u, o.v) ? 'pit' : 'out';
      moves.push({ i: hit, from: was, to: [o.u, o.v], a0: o.a, a1, at: o.at, delay: 0.25 });
      o.a = a1;
      clank = true;
    }
  }
  shoe.u = to[0]; shoe.v = to[1]; shoe.at = at; shoe.a = face;
  moves.unshift({ i, from: land, to, a0, a1: face, at, delay: 0 });
  const flightMs = Math.round(900 + D * 22), settleMs = sand ? 520 : 200;
  return { shoes: out, pitch: { from, land, apex: 5 + D * 0.12, turns, moves, flightMs, settleMs, clank } };
}

/** An inning's points, after cancelling: ringers cancel ringers and leaners cancel leaners, one for one; then the side
 *  with the shoe nearest a stake scores it and every shoe of theirs nearer than the other side's best: a ringer 3, a
 *  leaner 1, any other shoe 1 if it lies within a shoe's width (6 inches) of the stake. Returns [red, blue]. */
export function points(shoes: Shoe[]): number[] {
  const of = (t: number, at: At) => shoes.filter((s) => s.team === t && s.at === at);
  const left: Shoe[] = [];
  for (const at of ['ringer', 'leaner'] as At[]) {
    const a = of(0, at), b = of(1, at), n = Math.min(a.length, b.length);
    left.push(...a.slice(n), ...b.slice(n));
  }
  left.push(...shoes.filter((s) => s.at === 'pit' && nearness(s) <= 0.5));
  const rank = (s: Shoe) => (s.at === 'ringer' ? -2 : s.at === 'leaner' ? -1 : nearness(s));
  left.sort((p, q) => rank(p) - rank(q));
  const pts = [0, 0];
  if (!left.length) return pts;
  const who = left[0].team;
  for (const s of left) {
    if (s.team !== who) break;
    pts[who] += s.at === 'ringer' ? 3 : 1;
  }
  return pts;
}
