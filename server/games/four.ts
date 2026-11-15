// Four in a row. Seven columns and six rows, standing upright: a piece dropped into a column falls to the lowest
// empty space. Four of your colour in a line (across, up, or slanted either way) wins; a full board with no line is
// a draw.
//
// The board is 42 spaces counted from the top-left (0) along each row: -1 is empty, otherwise the seat whose piece
// it is. Seat 0 is Red and goes first; seat 1 is Yellow.
import type { Result, Rng, Rules } from './cards.ts';

export type Four = { b: number[]; turn: number; ply: number; last: number | null; line: number[] | null; end: Result | null };
const W = 7, H = 6;
const NAMES = ['Red', 'Yellow'];
/** Every four spaces in a line. */
const LINES: number[][] = [];
for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
  const er = r + 3 * dr, ec = c + 3 * dc;
  if (er < H && ec >= 0 && ec < W) LINES.push([0, 1, 2, 3].map((k) => (r + k * dr) * W + c + k * dc));
}
/** Where a piece dropped into this column comes to rest (-1: the column is full). */
export function landing(b: number[], col: number) {
  for (let r = H - 1; r >= 0; r--) if (b[r * W + col] < 0) return r * W + col;
  return -1;
}
const lineOf = (b: number[], who: number) => LINES.find((l) => l.every((i) => b[i] === who)) ?? null;

// ── the computer player: looks five moves ahead ──
const WORTH = [0, 1, 4, 12];
/** How good the board looks for `who`: lines only they are in, less lines only the other is in. */
function looks(b: number[], who: number) {
  let v = 0;
  for (const l of LINES) {
    let mine = 0, theirs = 0;
    for (const i of l) { if (b[i] === who) mine++; else if (b[i] >= 0) theirs++; }
    if (!theirs) v += WORTH[mine]; else if (!mine) v -= WORTH[theirs];
  }
  return v;
}
const MIDDLE_FIRST = [3, 2, 4, 1, 5, 0, 6];
function search(b: number[], who: number, depth: number, alpha: number, beta: number): number {
  if (lineOf(b, 1 - who)) return -1000 - depth;            // the other side has just made four
  if (depth === 0) return looks(b, who);
  let best = -Infinity;
  for (const c of MIDDLE_FIRST) {
    const at = landing(b, c);
    if (at < 0) continue;
    b[at] = who;
    const v = -search(b, 1 - who, depth - 1, -beta, -alpha);
    b[at] = -1;
    if (v > best) best = v;
    if (v > alpha) alpha = v;
    if (alpha >= beta) break;
  }
  return best === -Infinity ? 0 : best;                     // a full board: a draw
}

export const four: Rules<Four> = {
  seats: [2, 2],
  bots: true,
  start: () => ({ b: new Array(W * H).fill(-1), turn: 0, ply: 0, last: null, line: null, end: null }),
  turn: (s) => (s.end ? [] : [s.turn]),
  move(s, seat, m) {
    if (!m || typeof m !== 'object') return 'That could not be read.';
    if (s.end) return 'The game is over.';
    if (s.turn !== seat) return 'It is not your turn.';
    if (!Number.isInteger(m.col) || m.col < 0 || m.col >= W) return 'Pick a column.';
    const at = landing(s.b, m.col);
    if (at < 0) return 'That column is full.';
    s.b[at] = seat;
    s.last = at;
    s.ply++;
    s.line = lineOf(s.b, seat);
    if (s.line) s.end = { winners: [seat], text: `${NAMES[seat]} made four in a row` };
    else if (s.ply === W * H) s.end = { winners: [], text: 'Draw: the board is full' };
    else s.turn = 1 - seat;
    return null;
  },
  view: (s) => ({ board: s.b.map((x) => '.ry'[x + 1]).join(''), turn: s.end ? -1 : s.turn, last: s.last, line: s.line, ply: s.ply }),
  result: (s) => s.end,
  pause: () => 700,
  bot(s, seat, rng: Rng) {
    if (s.end || s.turn !== seat) return null;
    const b = s.b.slice();
    let best = -Infinity, cols: number[] = [];
    for (const c of MIDDLE_FIRST) {
      const at = landing(b, c);
      if (at < 0) continue;
      b[at] = seat;
      const v = -search(b, 1 - seat, 5, -Infinity, Infinity);
      b[at] = -1;
      if (v > best) { best = v; cols = [c]; } else if (v === best) cols.push(c);
    }
    return cols.length ? { col: cols[Math.floor(rng() * cols.length)] } : null;
  },
};
