// Cornhole's numbers and throws, shared by the server (server/basement/cornhole.ts keeps the game) and the page
// (cornhole.tsx draws it). The boards stand down the bottom left of the campsite (scripts/basement/outside.py), to the
// rules' measures: each board 2 feet by 4, its deck 2.5 inches off the ground at the front and 12 at the back, a hole 6
// inches across with its middle 9 inches in from the back; the front edges 27 feet apart; the bags 6 inches square.
//
// Everything here is in feet, along the lane: u from the left board's front edge toward the right board (the left board
// is u -4 to 0, the right one 27 to 31), and v across it, down the screen positive (the boards are v -1 to 1).

export const GAP = 27, LONG = 4, HALF_W = 1, HOLE_IN = 0.75, HOLE_R = 0.25, BAG = 0.5;
export const FRONT_H = 2.5 / 12, BACK_H = 1;
/** Each board: its ends along the lane, and where the middle of its hole is. */
export const BOARDS = [{ u0: -LONG, u1: 0, hole: -LONG + HOLE_IN }, { u0: GAP, u1: GAP + LONG, hole: GAP + LONG - HOLE_IN }] as const;
/** Bags each a side in an inning; points to win. */
export const BAGS = 4, TO = 21;
export const TEAMS = ['Red', 'Blue'], COLORS = ['#d8402c', '#2f62d8'];

export type Where = 'board' | 'grass' | 'hole';
export type Bag = { team: number; u: number; v: number; at: Where };
/** A bag's journey in a throw: from where it starts to where it ends, starting `delay` (0 to 1) of the way through the
 *  slide (a bag knocked on by another starts when it is struck). */
export type Move = { i: number; from: [number, number]; to: [number, number]; at: Where; delay: number };
export type Toss = { from: [number, number]; land: [number, number]; apex: number; moves: Move[]; flightMs: number; slideMs: number };

export type Game = {
  /** the people on each side: one (who walks to whichever end is pitching) or two (one at each end) */
  teams: string[][];
  on: boolean; over: boolean; winner: number;
  /** which end is pitching: 0 from the left board, at the right one; 1 back again */
  end: number; turn: number; thrown: number[]; first: number; score: number[]; bags: Bag[];
  /** what the last inning came to, for each side, before cancelling */
  inning: number[] | null;
  last: string; busyUntil: number;
};
export const fresh = (): Game => ({ teams: [[], []], on: false, over: false, winner: -1, end: 0, turn: 0, thrown: [0, 0], first: 0, score: [0, 0], bags: [], inning: null, last: '', busyUntil: 0 });

/** Who stands where: the pitcher's box a side's player at end `e` is in (0 left red, 1 left blue, 2 right red, 3 right
 *  blue), for things.cornhole.spots. */
export const spotOf = (team: number, e: number) => e * 2 + team;
/** Where somebody on a side stands just now (null: not playing): two on a side stand one at each end; one walks. */
export function standing(g: Game, uid: string): number | null {
  for (let team = 0; team < 2; team++) {
    const m = g.teams[team], k = m.indexOf(uid);
    if (k < 0) continue;
    return spotOf(team, m.length === 2 ? k : g.end);
  }
  return null;
}
/** Who throws for a side from the end that is pitching. */
export const thrower = (g: Game, team: number) => { const m = g.teams[team]; return m.length === 2 ? m[g.end] : m[0] ?? null; };

/** How high the deck of a board is at a point (feet), or 0 off the boards. */
export function lift(u: number, v: number) {
  if (Math.abs(v) > HALF_W) return 0;
  if (u >= BOARDS[0].u0 && u <= BOARDS[0].u1) return FRONT_H + (BACK_H - FRONT_H) * (-u / LONG);
  if (u >= BOARDS[1].u0 && u <= BOARDS[1].u1) return FRONT_H + (BACK_H - FRONT_H) * ((u - GAP) / LONG);
  return 0;
}
/** Where a thrower lets go from: beside their board, at its front edge (the foul line), on their side's side of it. */
export const release = (e: number, team: number): [number, number] => [e === 0 ? -0.3 : GAP + 0.3, team === 0 ? -1.6 : 1.6];
/** Which way a throw from end e goes along the lane, and across it for a positive aim (the thrower's right). */
export const ahead = (e: number) => (e === 0 ? 1 : -1);
/** How far a throw carries for a power of 0 to 1 (feet, through the air). */
export const carry = (power: number) => 14 + 22 * power;

const onBoard = (b: (typeof BOARDS)[number], u: number, v: number) => u >= b.u0 && u <= b.u1 && Math.abs(v) <= HALF_W;
const dist = (a: number, b: number, c: number, d: number) => Math.hypot(a - c, b - d);

/** A bag thrown from end e by a side, `aim` radians to the thrower's right of straight down the lane and `power` 0 to 1,
 *  with `wobble` (two numbers, each about a normal draw) for an unsteady hand. Returns the bags after it, and its toss. */
export function pitch(bags: Bag[], e: number, team: number, aim: number, power: number, wobble: [number, number]): { bags: Bag[]; toss: Toss } {
  const [u0, v0] = release(e, team), dir = ahead(e);
  const D = carry(power) * (1 + wobble[0] * 0.02), a = aim + wobble[1] * 0.01;
  const du = dir * Math.cos(a), dv = dir * Math.sin(a);                   // (aiming right: facing back down the lane, that is up the screen)
  const land: [number, number] = [u0 + du * D, v0 + dv * D];
  const target = BOARDS[e === 0 ? 1 : 0];
  const out = bags.map((b) => ({ ...b }));
  const i = out.length;
  const moves: Move[] = [];
  out.push({ team, u: land[0], v: land[1], at: 'grass' });

  // slides bag k from where it is, `len` feet in the direction (su, sv), starting `delay` through the slide; it may
  // drop into the hole, go off the deck, or strike another bag and pass the rest on (a little lost in the knock)
  const slide = (k: number, su: number, sv: number, len: number, delay: number, depth: number) => {
    const b = out[k], from: [number, number] = [b.u, b.v];
    let u = b.u, v = b.v, at: Where = 'board';
    const step = 0.02;
    for (let s = 0; s < len; s += step) {
      const nu = u + su * step, nv = v + sv * step;
      if (dist(nu, nv, target.hole, 0) < HOLE_R + 0.02) { u = target.hole; v = 0; at = 'hole'; break; }
      if (!onBoard(target, nu, nv)) {                                    // off the deck: down onto the grass beside it
        u = nu + su * 0.35; v = nv + sv * 0.35; at = 'grass'; break;
      }
      const hit = depth < 3 ? out.findIndex((o, j) => j !== k && o.at === 'board' && dist(nu, nv, o.u, o.v) < BAG * 0.9) : -1;
      if (hit >= 0) {
        u = nu; v = nv;
        b.u = u; b.v = v;
        slide(hit, su, sv, (len - s) * 0.7, Math.min(0.95, delay + (1 - delay) * (s / len)), depth + 1);
        break;
      }
      u = nu; v = nv;
    }
    b.u = u; b.v = v; b.at = at;
    moves.push({ i: k, from, to: [u, v], at, delay });
  };

  const bag = out[i];
  if (dist(land[0], land[1], target.hole, 0) < HOLE_R) {                 // straight in, without touching the deck
    bag.u = target.hole; bag.v = 0; bag.at = 'hole';
    moves.push({ i, from: land, to: [bag.u, bag.v], at: 'hole', delay: 0 });
  } else if (onBoard(target, land[0], land[1])) {
    bag.at = 'board';
    const sat = out.findIndex((o, j) => j !== i && o.at === 'board' && dist(land[0], land[1], o.u, o.v) < BAG * 0.8);
    if (sat >= 0) {                                                       // landing on a bag already there: it is knocked on, this one stops
      moves.push({ i, from: land, to: land, at: 'board', delay: 0 });
      slide(sat, du, dv, 0.25 + 0.02 * D, 0.05, 1);
    } else slide(i, du, dv, 0.35 + 0.045 * D, 0, 0);
  } else {                                                                // the grass: a short skid and it stops (no points)
    bag.u = land[0] + du * 0.15; bag.v = land[1] + dv * 0.15;
    moves.push({ i, from: land, to: [bag.u, bag.v], at: 'grass', delay: 0 });
  }
  const flightMs = Math.round(650 + D * 13), slideMs = moves.some((m) => m.at !== 'grass' || m.i !== i) ? 520 : 160;
  return { bags: out, toss: { from: [u0, v0], land, apex: 2.2 + D * 0.17, moves, flightMs, slideMs } };
}

/** The points each side has on the boards: 3 a bag in the hole, 1 a bag on a deck. */
export const points = (bags: Bag[]) => [0, 1].map((t) => bags.filter((b) => b.team === t).reduce((n, b) => n + (b.at === 'hole' ? 3 : b.at === 'board' ? 1 : 0), 0));
