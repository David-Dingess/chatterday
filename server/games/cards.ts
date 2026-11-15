// Playing cards, and the few things every card game here needs. A card is two letters: its rank, then its suit
// ("QS" is the queen of spades, "TH" the ten of hearts).
export type Card = string;
/** A source of random numbers from 0 up to (not including) 1, so a test can deal the same cards twice. */
export type Rng = () => number;
/** One card on the table, and whose it is. */
export type Played = { seat: number; card: Card };
/** How a game ended: who won (nobody, for a draw) and a short line saying how. */
export type Result = { winners: number[]; text: string };

export const RANKS = '23456789TJQKA';
export const SUITS = 'CDSH';
/** 0 for a two up to 12 for an ace. */
export const rk = (c: Card) => RANKS.indexOf(c[0]);
export const su = (c: Card) => c[1];
export const isCard = (v: unknown): v is Card => typeof v === 'string' && v.length === 2 && RANKS.includes(v[0]) && SUITS.includes(v[1]);

export function fullDeck(): Card[] {
  const d: Card[] = [];
  for (const s of SUITS) for (const r of RANKS) d.push(r + s);
  return d;
}
export function shuffle<T>(a: T[], rng: Rng): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
/** Clubs, diamonds, spades, hearts (black and red in turn), low to high within each. */
export const bySuit = (a: Card, b: Card) => SUITS.indexOf(su(a)) - SUITS.indexOf(su(b)) || rk(a) - rk(b);
export const lowest = (cs: Card[]) => cs.reduce((a, b) => (rk(b) < rk(a) ? b : a));
export const highest = (cs: Card[]) => cs.reduce((a, b) => (rk(b) > rk(a) ? b : a));

/** Whether card `a` beats card `b`, which is winning the trick so far. */
export const beats = (a: Card, b: Card, trump = '') => (su(a) === su(b) ? rk(a) > rk(b) : su(a) === trump);
/** The play that is winning a trick (the first card's suit leads; a trump, if there is one, beats it). */
export function winning(trick: Played[], trump = ''): Played {
  let best = trick[0];
  for (const p of trick) if (beats(p.card, best.card, trump)) best = p;
  return best;
}

/** What every game hands the table: its rules as plain functions over a state that is nothing but data. */
export interface Rules<S> {
  /** Fewest and most seats. */
  seats: [number, number];
  /** Whether empty seats can be played by the computer. */
  bots: boolean;
  start(players: number, rng: Rng): S;
  /** The seats that may do something now (none once it is over). */
  turn(s: S): number[];
  /** Does one thing for one seat. Gives back a short line saying why not, or null when it was done. Never trusts `m`. */
  move(s: S, seat: number, m: any, rng: Rng): string | null;
  /** What one seat may see; -1 is somebody watching, who sees no hand at all. */
  view(s: S, seat: number): Record<string, unknown>;
  result(s: S): Result | null;
  /** What a computer player in that seat does now (null: nothing, it waits for a person). */
  bot?(s: S, seat: number, rng: Rng): unknown;
  /** How long a computer player waits before it does it, in ms. */
  pause?(s: S): number;
}
