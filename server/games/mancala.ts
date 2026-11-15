// Mancala, the Kalah way. Each side has six pits with four stones in each, and a store at its right-hand end. On
// your turn you pick up everything in one of your pits and drop the stones one at a time into the pits that follow,
// going round anticlockwise: along your own row, into your own store, then along the other row (never into the
// other store).
//   - If the last stone lands in your store, you go again.
//   - If it lands in an empty pit of your own and the pit opposite has stones, you take those and your own stone.
// When one side's pits are all empty, the other side keeps what is left in theirs. Most stones wins.
//
// The fourteen places are counted round the way the stones go: 0 to 5 are seat 0's pits, 6 its store, 7 to 12 seat
// 1's pits, 13 its store. So the pit opposite pit i is 12 - i.
import type { Result, Rng, Rules } from './cards.ts';

export type Mancala = {
  pits: number[]; turn: number; ply: number;
  /** The last move: whose, from which pit to where, whether it earned another go, and how many stones it captured. */
  last: { seat: number; from: number; to: number; again: boolean; took: number } | null;
  end: Result | null;
};
const STORE = [6, 13];
const own = (seat: number, i: number) => i >= seat * 7 && i < seat * 7 + 6;
const side = (pits: number[], seat: number) => pits.slice(seat * 7, seat * 7 + 6);
const empty = (pits: number[], seat: number) => side(pits, seat).every((n) => n === 0);

function sow(pits: number[], seat: number, from: number) {
  let n = pits[from], i = from, took = 0;
  pits[from] = 0;
  while (n > 0) {
    i = (i + 1) % 14;
    if (i === STORE[1 - seat]) continue;
    pits[i]++;
    n--;
  }
  if (own(seat, i) && pits[i] === 1 && pits[12 - i] > 0) {
    took = pits[12 - i] + 1;
    pits[STORE[seat]] += took;
    pits[i] = 0;
    pits[12 - i] = 0;
  }
  return { to: i, again: i === STORE[seat], took };
}
/** If either side has run out, the stones still in pits go to whoever's pits they are in. True if the game is over. */
function sweep(pits: number[]) {
  if (!empty(pits, 0) && !empty(pits, 1)) return false;
  for (const seat of [0, 1]) for (let i = seat * 7; i < seat * 7 + 6; i++) { pits[STORE[seat]] += pits[i]; pits[i] = 0; }
  return true;
}

// ── the computer player: looks a few moves ahead for the most stones in its store ──
function search(pits: number[], seat: number, depth: number): number {
  if (depth === 0) return pits[STORE[seat]] - pits[STORE[1 - seat]];
  let best = -Infinity;
  for (let i = seat * 7; i < seat * 7 + 6; i++) {
    if (!pits[i]) continue;
    const p = pits.slice();
    const { again } = sow(p, seat, i);
    const v = sweep(p) ? p[STORE[seat]] - p[STORE[1 - seat]] : again ? search(p, seat, depth - 1) : -search(p, 1 - seat, depth - 1);
    if (v > best) best = v;
  }
  return best;
}

export const mancala: Rules<Mancala> = {
  seats: [2, 2],
  bots: true,
  start: () => ({ pits: [4, 4, 4, 4, 4, 4, 0, 4, 4, 4, 4, 4, 4, 0], turn: 0, ply: 0, last: null, end: null }),
  turn: (s) => (s.end ? [] : [s.turn]),
  move(s, seat, m) {
    if (!m || typeof m !== 'object') return 'That could not be read.';
    if (s.end) return 'The game is over.';
    if (s.turn !== seat) return 'It is not your turn.';
    if (!Number.isInteger(m.pit) || !own(seat, m.pit)) return 'Pick one of your own pits.';
    if (!s.pits[m.pit]) return 'That pit is empty.';
    const { to, again, took } = sow(s.pits, seat, m.pit);
    s.last = { seat, from: m.pit, to, again, took };
    s.ply++;
    if (sweep(s.pits)) {
      const [a, b] = [s.pits[6], s.pits[13]];
      s.end = a === b ? { winners: [], text: `Draw: ${a} stones each` } : { winners: [a > b ? 0 : 1], text: `${Math.max(a, b)} stones to ${Math.min(a, b)}` };
    } else if (!again) s.turn = 1 - seat;
    return null;
  },
  view: (s) => ({ pits: s.pits, turn: s.end ? -1 : s.turn, last: s.last, ply: s.ply }),
  result: (s) => s.end,
  pause: () => 900,
  bot(s, seat, rng: Rng) {
    if (s.end || s.turn !== seat) return null;
    let best = -Infinity, picks: number[] = [];
    for (let i = seat * 7; i < seat * 7 + 6; i++) {
      if (!s.pits[i]) continue;
      const p = s.pits.slice();
      const { again } = sow(p, seat, i);
      const v = sweep(p) ? p[STORE[seat]] - p[STORE[1 - seat]] : again ? search(p, seat, 6) : -search(p, 1 - seat, 6);
      if (v > best) { best = v; picks = [i]; } else if (v === best) picks.push(i);
    }
    return picks.length ? { pit: picks[Math.floor(rng() * picks.length)] } : null;
  },
};
