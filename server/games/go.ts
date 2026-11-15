// Go. Black and White take turns putting one stone on a crossing of the lines. Stones of one colour that touch
// along the lines are a group, and a group lives on its liberties: the empty crossings next to it. Fill a group's
// last liberty and it is captured and taken off. You may not play where your own stone would have no liberty
// (unless it captures), and you may not play a stone that puts the whole board back to how it was before (ko).
//
// Either side may pass. Two passes in a row stop play, and the two then say which stones left on the board are dead
// (click a group to mark it); either can go back to playing if they disagree. When both agree, it is counted the
// area way: your stones on the board plus the empty crossings only your stones surround. White gets 7.5 extra for
// going second, so there are no draws.
//
// The board is `n` by `n` crossings counted from the top-left along each row: 'b', 'w' or '.'. Seat 0 is Black and
// goes first. Until the first stone is down, either player can change the size of the board (9, 13 or 19).
import type { Result, Rules } from './cards.ts';

export const KOMI = 7.5;
export const SIZES = [9, 13, 19];
export type Go = {
  n: number; b: string[]; turn: number; ply: number; passes: number;
  /** Stones each seat has captured. */
  caps: number[];
  /** Where the last stone went (-1: it was a pass). */
  last: number | null;
  /** Every way the board has looked, so none can come back. */
  seen: string[];
  phase: 'play' | 'mark';
  /** While marking: the stones called dead, and who has agreed. */
  dead: boolean[]; agreed: boolean[];
  end: Result | null;
};
const STONE = ['b', 'w'];
const NAMES = ['Black', 'White'];

function around(n: number, i: number) {
  const out: number[] = [], r = Math.floor(i / n), c = i % n;
  if (r > 0) out.push(i - n);
  if (r < n - 1) out.push(i + n);
  if (c > 0) out.push(i - 1);
  if (c < n - 1) out.push(i + 1);
  return out;
}
/** The stones joined to the one at `at`, and how many liberties they have between them. */
function group(b: string[], n: number, at: number) {
  const colour = b[at], stones = [at], seen = new Set([at]), libs = new Set<number>();
  for (let k = 0; k < stones.length; k++) {
    for (const j of around(n, stones[k])) {
      if (b[j] === '.') libs.add(j);
      else if (b[j] === colour && !seen.has(j)) { seen.add(j); stones.push(j); }
    }
  }
  return { stones, libs: libs.size };
}
/** Whose each crossing is once the dead stones are lifted: 'b', 'w', or '.' for nobody's. And the count for each side. */
function count(s: Go) {
  const n = s.n, b = s.b.map((x, i) => (s.dead[i] ? '.' : x)), owner = b.slice();
  const done = new Array(n * n).fill(false);
  for (let i = 0; i < n * n; i++) {
    if (b[i] !== '.' || done[i]) continue;
    const area = [i], touches = new Set<string>();
    done[i] = true;
    for (let k = 0; k < area.length; k++) {
      for (const j of around(n, area[k])) {
        if (b[j] === '.') { if (!done[j]) { done[j] = true; area.push(j); } } else touches.add(b[j]);
      }
    }
    const whose = touches.size === 1 ? [...touches][0] : '.';
    for (const j of area) owner[j] = whose;
  }
  const black = owner.filter((x) => x === 'b').length, white = owner.filter((x) => x === 'w').length + KOMI;
  return { owner: owner.join(''), score: [black, white] };
}
const fresh = (n: number): Go => ({ n, b: new Array(n * n).fill('.'), turn: 0, ply: 0, passes: 0, caps: [0, 0], last: null, seen: [], phase: 'play', dead: [], agreed: [false, false], end: null });

export const go: Rules<Go> = {
  seats: [2, 2],
  bots: false,
  start: () => fresh(9),
  turn: (s) => (s.end ? [] : s.phase === 'mark' ? [0, 1].filter((i) => !s.agreed[i]) : [s.turn]),
  move(s, seat, m) {
    if (!m || typeof m !== 'object') return 'That could not be read.';
    if (s.end) return 'The game is over.';
    if (m.a === 'resign') { s.end = { winners: [1 - seat], text: `${NAMES[seat]} resigned` }; return null; }
    if (m.size !== undefined) {
      if (!SIZES.includes(m.size)) return 'The board can be 9, 13 or 19 lines across.';
      if (s.ply > 0) return 'The board cannot change once a stone is down.';
      Object.assign(s, fresh(m.size));
      return null;
    }
    if (s.phase === 'mark') {
      if (m.resume === true) { s.phase = 'play'; s.passes = 0; s.dead = []; s.agreed = [false, false]; return null; }
      if (m.agree === true) {
        s.agreed[seat] = true;
        if (s.agreed[0] && s.agreed[1]) {
          const [black, white] = count(s).score;
          s.end = { winners: [black > white ? 0 : 1], text: `${NAMES[black > white ? 0 : 1]} by ${Math.abs(black - white)} (${black} to ${white})` };
        }
        return null;
      }
      if (!Number.isInteger(m.dead) || m.dead < 0 || m.dead >= s.n * s.n || s.b[m.dead] === '.') return 'Click a group of stones to call it dead (or alive again), then agree.';
      const flip = !s.dead[m.dead];
      for (const i of group(s.b, s.n, m.dead).stones) s.dead[i] = flip;
      s.agreed = [false, false];
      return null;
    }
    if (s.turn !== seat) return 'It is not your turn.';
    if (m.pass === true) {
      s.passes++;
      s.ply++;
      s.last = -1;
      s.turn = 1 - seat;
      if (s.passes >= 2) { s.phase = 'mark'; s.dead = new Array(s.n * s.n).fill(false); s.agreed = [false, false]; }
      return null;
    }
    const at: unknown = m.at;
    if (typeof at !== 'number' || !Number.isInteger(at) || at < 0 || at >= s.n * s.n) return 'Pick a crossing.';
    if (s.b[at] !== '.') return 'There is a stone there already.';
    const b = s.b.slice(), me = STONE[seat], them = STONE[1 - seat];
    let took = 0;
    b[at] = me;
    for (const j of around(s.n, at)) {
      if (b[j] !== them) continue;
      const g = group(b, s.n, j);
      if (g.libs === 0) { for (const k of g.stones) b[k] = '.'; took += g.stones.length; }
    }
    if (group(b, s.n, at).libs === 0) return 'A stone there would have no liberties.';
    const key = b.join('');
    if (s.seen.includes(key)) return 'Ko: that would put the board back the way it was. Play somewhere else first.';
    if (!s.seen.length) s.seen.push(s.b.join(''));
    s.seen.push(key);
    s.b = b;
    s.caps[seat] += took;
    s.last = at;
    s.passes = 0;
    s.ply++;
    s.turn = 1 - seat;
    return null;
  },
  view(s) {
    const counting = s.phase === 'mark' || (!!s.end && s.dead.length > 0);
    const c = counting ? count(s) : null;
    return {
      n: s.n, board: s.b.join(''), turn: s.end || s.phase === 'mark' ? -1 : s.turn, ply: s.ply, last: s.last, caps: s.caps, passes: s.passes,
      phase: s.end ? 'over' : s.phase, dead: s.dead.flatMap((d, i) => (d ? [i] : [])), agreed: s.agreed,
      owner: c?.owner ?? null, score: c?.score ?? null, komi: KOMI,
    };
  },
  result: (s) => s.end,
};
