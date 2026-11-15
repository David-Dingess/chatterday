// Chess, with every rule checked here: legal moves only (no leaving your king in check), castling, en passant,
// promotion, checkmate and stalemate, and draws by three-fold repetition, fifty moves without a capture or pawn move,
// and too few pieces left to mate. Either player can resign or offer a draw.
//
// The board is 64 squares counted from a8 (0) along each rank to h1 (63). White pieces are capitals (PNBRQK), black
// ones small letters, an empty square a dot. Seat 0 is White.
import type { Result, Rules } from './cards.ts';

export type Pos = { b: string[]; white: boolean; castle: string; ep: number };
export type Move = { from: number; to: number; promo?: string; kind?: 'ep' | 'castle' | 'double' };
export type Chess = Pos & {
  /** Half-moves since a capture or a pawn move, and half-moves played. */
  half: number; ply: number;
  /** How often each position has stood on the board. */
  seen: Record<string, number>;
  log: string[]; last: [number, number] | null;
  /** Who has offered a draw (a seat), if anyone. */
  offer: number | null; taken: string; end: Result | null;
};

const R = (i: number) => i >> 3, F = (i: number) => i & 7;
const on = (r: number, f: number) => r >= 0 && r < 8 && f >= 0 && f < 8;
const isWhite = (p: string) => p !== '.' && p === p.toUpperCase();
const KNIGHT = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
const DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]], ORTH = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const ALL = [...DIAG, ...ORTH];
export const squareName = (i: number) => 'abcdefgh'[F(i)] + (8 - R(i));

/** Whether a square is attacked by one side's pieces. */
export function attacked(b: string[], sq: number, byWhite: boolean): boolean {
  const r = R(sq), f = F(sq);
  const P = byWhite ? 'P' : 'p', N = byWhite ? 'N' : 'n', K = byWhite ? 'K' : 'k', B = byWhite ? 'B' : 'b', Rk = byWhite ? 'R' : 'r', Q = byWhite ? 'Q' : 'q';
  const pr = r + (byWhite ? 1 : -1);                    // a pawn attacks the two squares diagonally ahead of it
  for (const df of [-1, 1]) if (on(pr, f + df) && b[pr * 8 + f + df] === P) return true;
  for (const [dr, df] of KNIGHT) if (on(r + dr, f + df) && b[(r + dr) * 8 + f + df] === N) return true;
  for (const [dr, df] of ALL) if (on(r + dr, f + df) && b[(r + dr) * 8 + f + df] === K) return true;
  for (const [dirs, slider] of [[DIAG, B], [ORTH, Rk]] as const) {
    for (const [dr, df] of dirs) {
      for (let rr = r + dr, ff = f + df; on(rr, ff); rr += dr, ff += df) {
        const p = b[rr * 8 + ff];
        if (p === '.') continue;
        if (p === slider || p === Q) return true;
        break;
      }
    }
  }
  return false;
}

/** Every move the pieces can make, before asking whether it leaves the mover's own king in check. */
function pseudo(s: Pos): Move[] {
  const { b, white } = s, out: Move[] = [];
  const add = (from: number, to: number, kind?: Move['kind']) => {
    if (b[from].toLowerCase() === 'p' && (R(to) === 0 || R(to) === 7)) for (const promo of 'qrbn') out.push({ from, to, promo });
    else out.push({ from, to, kind });
  };
  for (let i = 0; i < 64; i++) {
    const p = b[i];
    if (p === '.' || isWhite(p) !== white) continue;
    const r = R(i), f = F(i), kind = p.toLowerCase();
    const free = (t: number) => b[t] === '.' || isWhite(b[t]) !== white;
    if (kind === 'p') {
      const dir = white ? -1 : 1;
      if (on(r + dir, f) && b[i + dir * 8] === '.') {
        add(i, i + dir * 8);
        if (r === (white ? 6 : 1) && b[i + dir * 16] === '.') add(i, i + dir * 16, 'double');
      }
      for (const df of [-1, 1]) {
        if (!on(r + dir, f + df)) continue;
        const t = (r + dir) * 8 + f + df;
        if (b[t] !== '.' && isWhite(b[t]) !== white) add(i, t);
        else if (t === s.ep) add(i, t, 'ep');
      }
    } else if (kind === 'n' || kind === 'k') {
      for (const [dr, df] of kind === 'n' ? KNIGHT : ALL) if (on(r + dr, f + df) && free((r + dr) * 8 + f + df)) add(i, (r + dr) * 8 + f + df);
    } else {
      for (const [dr, df] of kind === 'b' ? DIAG : kind === 'r' ? ORTH : ALL) {
        for (let rr = r + dr, ff = f + df; on(rr, ff); rr += dr, ff += df) {
          const t = rr * 8 + ff;
          if (b[t] === '.') { add(i, t); continue; }
          if (isWhite(b[t]) !== white) add(i, t);
          break;
        }
      }
    }
  }
  // castling: king and rook unmoved, nothing between them, and the king not in, through or into check
  const home = white ? 60 : 4, rook = white ? 'R' : 'r';
  if (b[home] === (white ? 'K' : 'k')) {
    const safe = (...sq: number[]) => sq.every((x) => !attacked(b, x, !white));
    if (s.castle.includes(white ? 'K' : 'k') && b[home + 1] === '.' && b[home + 2] === '.' && b[home + 3] === rook && safe(home, home + 1, home + 2)) out.push({ from: home, to: home + 2, kind: 'castle' });
    if (s.castle.includes(white ? 'Q' : 'q') && b[home - 1] === '.' && b[home - 2] === '.' && b[home - 3] === '.' && b[home - 4] === rook && safe(home, home - 1, home - 2)) out.push({ from: home, to: home - 2, kind: 'castle' });
  }
  return out;
}

/** The position after a move. */
export function after(s: Pos, m: Move): Pos {
  const b = s.b.slice();
  const p = b[m.from], white = s.white;
  let castle = s.castle, ep = -1;
  b[m.to] = m.promo ? (white ? m.promo.toUpperCase() : m.promo) : p;
  b[m.from] = '.';
  if (m.kind === 'ep') b[m.to + (white ? 8 : -8)] = '.';
  if (m.kind === 'double') ep = (m.from + m.to) / 2;
  if (m.kind === 'castle') {
    const east = m.to > m.from;
    b[east ? m.to - 1 : m.to + 1] = b[east ? m.to + 1 : m.to - 2];
    b[east ? m.to + 1 : m.to - 2] = '.';
  }
  if (castle) {
    const lose = (x: string) => { castle = castle.replace(x, ''); };
    if (p === 'K') { lose('K'); lose('Q'); }
    if (p === 'k') { lose('k'); lose('q'); }
    for (const sq of [m.from, m.to]) {
      if (sq === 63) lose('K'); else if (sq === 56) lose('Q'); else if (sq === 7) lose('k'); else if (sq === 0) lose('q');
    }
  }
  return { b, white: !white, castle, ep };
}

const kingOf = (b: string[], white: boolean) => b.indexOf(white ? 'K' : 'k');
export const inCheck = (s: Pos) => attacked(s.b, kingOf(s.b, s.white), !s.white);
/** Every legal move for the side to play. */
export function legalMoves(s: Pos): Move[] {
  return pseudo(s).filter((m) => { const n = after(s, m); return !attacked(n.b, kingOf(n.b, s.white), n.white); });
}
/** How many positions can be reached in exactly `depth` moves: the standard check of a move generator. */
export function perft(s: Pos, depth: number): number {
  if (depth === 0) return 1;
  const moves = legalMoves(s);
  if (depth === 1) return moves.length;
  let n = 0;
  for (const m of moves) n += perft(after(s, m), depth - 1);
  return n;
}

/** A position from the first four fields of a FEN line (pieces, side to move, castling, en passant). */
export function fromFen(fen: string): Pos {
  const [rows, turn, castle, ep] = fen.split(' ');
  const b: string[] = [];
  for (const ch of rows.replace(/\//g, '')) { if (/\d/.test(ch)) for (let i = 0; i < Number(ch); i++) b.push('.'); else b.push(ch); }
  return { b, white: turn !== 'b', castle: castle === '-' ? '' : castle ?? '', ep: ep && ep !== '-' ? 'abcdefgh'.indexOf(ep[0]) + (8 - Number(ep[1])) * 8 : -1 };
}
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -';

/** What makes two positions "the same" for repetition: the pieces, whose move, castling rights, and an en passant
 *  capture only if a pawn stands ready to make it. */
function key(s: Pos) {
  let ep = -1;
  if (s.ep >= 0) {
    const r = R(s.ep) + (s.white ? 1 : -1);
    for (const df of [-1, 1]) if (on(r, F(s.ep) + df) && s.b[r * 8 + F(s.ep) + df] === (s.white ? 'P' : 'p')) ep = s.ep;
  }
  return `${s.b.join('')}${s.white ? 'w' : 'b'}${s.castle}${ep}`;
}
/** Not enough left for anybody to give mate: bare kings, or one side with a single bishop or knight. */
function tooFew(b: string[]) {
  const rest = b.filter((p) => p !== '.' && p !== 'K' && p !== 'k');
  return rest.length === 0 || (rest.length === 1 && 'BbNn'.includes(rest[0]));
}
const draw = (text: string): Result => ({ winners: [], text });

export const chess: Rules<Chess> = {
  seats: [2, 2],
  bots: false,
  start() {
    const s: Chess = { ...fromFen(START), half: 0, ply: 0, seen: {}, log: [], last: null, offer: null, taken: '', end: null };
    s.seen[key(s)] = 1;
    return s;
  },
  turn: (s) => (s.end ? [] : [s.white ? 0 : 1]),
  move(s, seat, m) {
    if (!m || typeof m !== 'object') return 'That could not be read.';
    if (s.end) return 'The game is over.';
    if (m.a === 'resign') { s.end = { winners: [1 - seat], text: `${seat === 0 ? 'White' : 'Black'} resigned` }; return null; }
    if (m.a === 'offer') { if (s.offer === null) s.offer = seat; return null; }
    if (m.a === 'accept') { if (s.offer !== 1 - seat) return 'There is no draw offer to accept.'; s.end = draw('Draw agreed'); return null; }
    if (m.a === 'decline') { if (s.offer !== 1 - seat) return 'There is no draw offer to turn down.'; s.offer = null; return null; }
    if (!Number.isInteger(m.from) || !Number.isInteger(m.to) || m.from < 0 || m.from > 63 || m.to < 0 || m.to > 63) return 'Pick a piece, then a square.';
    if ((s.white ? 0 : 1) !== seat) return 'It is not your turn.';
    const options = legalMoves(s).filter((x) => x.from === m.from && x.to === m.to);
    if (!options.length) return inCheck(s) ? 'That does not get you out of check.' : 'That piece cannot move there.';
    let mv = options[0];
    if (mv.promo) {
      const want = typeof m.promo === 'string' ? options.find((x) => x.promo === m.promo) : undefined;
      if (!want) return 'Pick a piece to promote to.';
      mv = want;
    }
    const piece = s.b[mv.from], victim = mv.kind === 'ep' ? (s.white ? 'p' : 'P') : s.b[mv.to];
    const n = after(s, mv);
    s.b = n.b; s.white = n.white; s.castle = n.castle; s.ep = n.ep;
    s.ply++;
    s.half = piece.toLowerCase() === 'p' || victim !== '.' ? 0 : s.half + 1;
    if (victim !== '.') s.taken += victim;
    s.last = [mv.from, mv.to];
    s.offer = null;
    const k = key(s);
    s.seen[k] = (s.seen[k] ?? 0) + 1;
    const replies = legalMoves(s).length, check = inCheck(s);
    let text = mv.kind === 'castle' ? (mv.to > mv.from ? 'O-O' : 'O-O-O')
      : `${piece.toLowerCase() === 'p' ? '' : piece.toUpperCase()}${squareName(mv.from)}${victim !== '.' ? 'x' : '-'}${squareName(mv.to)}${mv.promo ? '=' + mv.promo.toUpperCase() : ''}`;
    text += !replies && check ? '#' : check ? '+' : '';
    s.log.push(text);
    if (!replies) s.end = check ? { winners: [seat], text: 'Checkmate' } : draw('Stalemate');
    else if (tooFew(s.b)) s.end = draw('Draw: not enough pieces left to mate');
    else if (s.seen[k] >= 3) s.end = draw('Draw: the same position three times');
    else if (s.half >= 100) s.end = draw('Draw: fifty moves without a capture or a pawn move');
    return null;
  },
  view(s, seat) {
    const legal: Record<number, number[]> = {};
    if (!s.end && seat === (s.white ? 0 : 1)) for (const m of legalMoves(s)) { const to = (legal[m.from] ??= []); if (!to.includes(m.to)) to.push(m.to); }
    return {
      board: s.b.join(''), turn: s.end ? -1 : s.white ? 0 : 1, check: !s.end || s.end.text === 'Checkmate' ? inCheck(s) : false,
      legal, last: s.last, log: s.log.slice(-60), ply: s.ply, offer: s.offer, taken: s.taken,
    };
  },
  result: (s) => s.end,
};
