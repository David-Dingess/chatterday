import { LAYOUT } from './outside.gen.ts';

// The campfire's numbers, shared by the server (server/basement/outside.ts keeps the fire) and the page (outside.tsx draws it).

/** The seats round the fire (the rest out here are not by it). */
const RING = new Set<number>(LAYOUT.things.ring);

/** Seconds of burning in one log, and how many the ring holds. */
export const LOG_S = 180;
export const MAX_LOGS = 5;
/** How long the embers glow once it has gone out: a log put on them in that time catches by itself. */
export const EMBER_MS = 120_000;
/** A marshmallow's toasting, in units of the fire's heat (about a second each): golden between GOLD[0] and GOLD[1],
 *  alight past BURN, and at DROP it falls off the stick. */
export const GOLD = [5, 7.2] as const, BURN = 9, DROP = 14;

export type Fire = { fuel: number; lit: boolean; at: number; outAt: number; litAt: number };
export type Roast = { seat: number; t0: number; rate: number };
export type Ate = { seat: number; what: string; at: number; d: number };
export type Camp = { fire: Fire; roast: Record<string, Roast>; ate: Record<string, Ate>; toss: { who: string; at: number } | null; last: string; lastAt: number; tally: Record<string, number>; now: number; radio?: boolean };

/** Seconds of fuel left at `now` (server time). */
export const fuelLeft = (f: Fire, now: number) => (f.lit ? Math.max(0, f.fuel - (now - f.at) / 1000) : f.fuel);
/** How toasted a marshmallow is at `now`. */
export const toasted = (r: Roast, now: number) => Math.max(0, ((now - r.t0) / 1000) * r.rate);
/** One word for it, as it comes out. */
export const doneWord = (d: number) => (d < 2 ? 'Warm' : d < GOLD[0] ? 'Pale' : d < GOLD[1] ? 'Golden!' : d < BURN ? 'Brown' : d < 11.5 ? 'Charred' : d < DROP ? 'Burnt!' : 'Dropped it!');

/** What being outside reads as in somebody's status, or null when they are not outside: "By the campfire" in a seat
 *  round the fire, "Outside" anywhere else out there. (For presenceText in components/ui.tsx: the place to put it is
 *  where a person's own activity would otherwise show, after "playing" and before "In voice".) */
export function outdoorsText(p: { floor?: string; place?: string; at?: { seat?: string } } | undefined): string | null {
  if (!p || p.floor !== 'outside') return null;
  const seat = /^b(\d+)$/.exec(p.at?.seat ?? '');
  if (p.place === 'here' && seat && Number(seat[1]) === LAYOUT.things.telescope) return 'Stargazing';
  return p.place === 'here' && seat && RING.has(Number(seat[1])) ? 'By the campfire' : 'Outside';
}
