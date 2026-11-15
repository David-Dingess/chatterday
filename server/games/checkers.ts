// American checkers (English draughts). Pieces move one square diagonally forward on the dark squares; a jump over
// an enemy piece takes it, must be taken when there is one, and carries on for as long as the same piece can jump
// again. A piece that reaches the far row is crowned a king (which ends its move) and may then go backwards too.
// You lose when you have no pieces left or none that can move. Forty moves each with no capture and no ordinary
// piece moved is a draw.
//
// The board is 64 squares counted from the top-left (0) along each row; the dark squares are the ones where row plus
// column is odd. Seat 0 is Red: it starts at the bottom, moves up, and goes first. Seat 1 is White. A small letter is
// an ordinary piece ('r', 'w'), a capital a king, a dot an empty square.
import type { Result, Rules } from './cards.ts';

export type Checkers = {
  b: string[]; turn: number;
  /** Half-moves since a capture or an ordinary piece's move, and half-moves played. */
  quiet: number; ply: number;
  /** The squares the last move went through. */
  last: number[] | null; offer: number | null; end: Result | null;
};
export const QUIET_LIMIT = 80;

const R = (i: number) => i >> 3, F = (i: number) => i & 7;
const owner = (p: string) => (p === 'r' || p === 'R' ? 0 : p === 'w' || p === 'W' ? 1 : -1);
const UP = [[-1, -1], [-1, 1]], DOWN = [[1, -1], [1, 1]];
const dirsOf = (p: string) => (p === 'r' ? UP : p === 'w' ? DOWN : [...UP, ...DOWN]);
const crowns = (p: string, row: number) => (p === 'r' && row === 0) || (p === 'w' && row === 7);

function jumps(b: string[], at: number, p: string, path: number[], out: number[][]) {
  let any = false;
  for (const [dr, dc] of dirsOf(p)) {
    const mr = R(at) + dr, mc = F(at) + dc, tr = mr + dr, tc = mc + dc;
    if (tr < 0 || tr > 7 || tc < 0 || tc > 7) continue;
    const mid = mr * 8 + mc, to = tr * 8 + tc;
    if (b[to] !== '.' || owner(b[mid]) !== 1 - owner(p)) continue;
    any = true;
    if (crowns(p, tr)) { out.push([...path, to]); continue; }          // crowned: the move ends there
    const nb = b.slice();
    nb[at] = '.'; nb[mid] = '.'; nb[to] = p;
    jumps(nb, to, p, [...path, to], out);
  }
  if (!any && path.length > 1) out.push(path);
}
/** Every legal move for a seat, each as the squares it goes through. If any piece can jump, only jumps are legal. */
export function legalMoves(b: string[], seat: number): number[][] {
  const taking: number[][] = [], plain: number[][] = [];
  for (let i = 0; i < 64; i++) {
    const p = b[i];
    if (owner(p) !== seat) continue;
    jumps(b, i, p, [i], taking);
    if (taking.length) continue;
    for (const [dr, dc] of dirsOf(p)) {
      const r = R(i) + dr, c = F(i) + dc;
      if (r >= 0 && r < 8 && c >= 0 && c < 8 && b[r * 8 + c] === '.') plain.push([i, r * 8 + c]);
    }
  }
  return taking.length ? taking : plain;
}

export function startBoard(): string[] {
  const b: string[] = [];
  for (let i = 0; i < 64; i++) b.push((R(i) + F(i)) % 2 === 0 ? '.' : R(i) < 3 ? 'w' : R(i) > 4 ? 'r' : '.');
  return b;
}
const draw = (text: string): Result => ({ winners: [], text });
const NAMES = ['Red', 'White'];

export const checkers: Rules<Checkers> = {
  seats: [2, 2],
  bots: false,
  start: () => ({ b: startBoard(), turn: 0, quiet: 0, ply: 0, last: null, offer: null, end: null }),
  turn: (s) => (s.end ? [] : [s.turn]),
  move(s, seat, m) {
    if (!m || typeof m !== 'object') return 'That could not be read.';
    if (s.end) return 'The game is over.';
    if (m.a === 'resign') { s.end = { winners: [1 - seat], text: `${NAMES[seat]} resigned` }; return null; }
    if (m.a === 'offer') { if (s.offer === null) s.offer = seat; return null; }
    if (m.a === 'accept') { if (s.offer !== 1 - seat) return 'There is no draw offer to accept.'; s.end = draw('Draw agreed'); return null; }
    if (m.a === 'decline') { if (s.offer !== 1 - seat) return 'There is no draw offer to turn down.'; s.offer = null; return null; }
    const path: unknown = m.path;
    if (!Array.isArray(path) || path.length < 2 || path.length > 13 || !path.every((x) => Number.isInteger(x) && x >= 0 && x < 64)) return 'Pick a piece, then where it goes.';
    if (s.turn !== seat) return 'It is not your turn.';
    const options = legalMoves(s.b, seat);
    const mv = options.find((o) => o.length === path.length && o.every((x, i) => x === path[i]));
    if (!mv) {
      if (options[0] && Math.abs(R(options[0][0]) - R(options[0][1])) === 2) return path.length > 1 && options.some((o) => o[0] === path[0] && o[1] === path[1]) ? 'Keep jumping: that piece can take another.' : 'You have to jump when you can.';
      return 'That piece cannot move there.';
    }
    const b = s.b;
    let p = b[mv[0]], took = false;
    const man = p === 'r' || p === 'w';
    b[mv[0]] = '.';
    for (let i = 1; i < mv.length; i++) {
      if (Math.abs(R(mv[i]) - R(mv[i - 1])) === 2) { b[(mv[i] + mv[i - 1]) / 2] = '.'; took = true; }
    }
    const end = mv[mv.length - 1];
    if (crowns(p, R(end))) p = p.toUpperCase();
    b[end] = p;
    s.last = mv;
    s.ply++;
    s.quiet = took || man ? 0 : s.quiet + 1;
    s.offer = null;
    s.turn = 1 - seat;
    if (!legalMoves(b, s.turn).length) s.end = { winners: [seat], text: b.some((x) => owner(x) === s.turn) ? `${NAMES[s.turn]} has no move left` : `${NAMES[s.turn]} has no pieces left` };
    else if (s.quiet >= QUIET_LIMIT) s.end = draw('Draw: forty moves each with no capture');
    return null;
  },
  view(s, seat) {
    return {
      board: s.b.join(''), turn: s.end ? -1 : s.turn, legal: !s.end && seat === s.turn ? legalMoves(s.b, seat) : [],
      last: s.last, offer: s.offer, ply: s.ply,
      left: [0, 1].map((t) => s.b.filter((x) => owner(x) === t).length),
    };
  },
  result: (s) => s.end,
};
