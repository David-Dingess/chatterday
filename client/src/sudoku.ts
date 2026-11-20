// Sudoku for the puzzle book in the bathroom (client/src/components/Sudoku.tsx shows it). Pure, no page: a script can
// run it too (scripts check every puzzle has one answer and how long each took).
//
// A puzzle is made the way a puzzle book's are: a whole solved grid first (filled cell by cell at random), then clues
// taken out in mirror pairs (cell and the cell opposite it through the middle, so the page looks like a printed one),
// each only if the puzzle still has exactly one answer. How hard it is comes from what it takes to solve it, worked out
// by solving it the way a person does, with no guessing:
//   Easy    singles only (the one number a cell can take, the one place a number can go), with plenty of clues
//   Medium  singles only, but far fewer clues, so they are harder to see
//   Hard    needs pointing and claiming, or naked or hidden pairs, somewhere along the way
//   Expert  needs triples, an X-wing, a swordfish or an XY-wing, and can still be solved by those, never by guessing
// A grid is 81 numbers, row by row, 0 for an empty cell; a puzzle travels as a string of 81 digits.

export type Level = 'easy' | 'medium' | 'hard' | 'expert';
export const LEVELS: Level[] = ['easy', 'medium', 'hard', 'expert'];
export const LEVEL_NAME: Record<Level, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard', expert: 'Expert' };
export type Puzzle = { puzzle: string; solution: string; level: Level; clues: number };

// ── the shape of the grid ──
const rowOf = (i: number) => Math.floor(i / 9), colOf = (i: number) => i % 9;
export const boxOf = (i: number) => Math.floor(rowOf(i) / 3) * 3 + Math.floor(colOf(i) / 3);
const range9 = [0, 1, 2, 3, 4, 5, 6, 7, 8];
/** The 27 units: nine rows, nine columns, nine boxes. */
const ROWS = range9.map((r) => range9.map((c) => r * 9 + c));
const COLS = range9.map((c) => range9.map((r) => r * 9 + c));
const BOXES = range9.map((b) => range9.map((k) => (Math.floor(b / 3) * 3 + Math.floor(k / 3)) * 9 + (b % 3) * 3 + (k % 3)));
const UNITS = [...ROWS, ...COLS, ...BOXES];
/** Each cell's 20 peers: the other cells in its row, column and box. */
export const PEERS: number[][] = Array.from({ length: 81 }, (_, i) => {
  const s = new Set([...ROWS[rowOf(i)], ...COLS[colOf(i)], ...BOXES[boxOf(i)]]);
  s.delete(i);
  return [...s];
});
const ALL = 0x3fe;                                   // candidates as bits 1..9
const POP = Array.from({ length: 1024 }, (_, m) => { let n = 0; for (let x = m; x; x &= x - 1) n++; return n; });
const digitsOf = (m: number) => range9.map((k) => k + 1).filter((d) => m & (1 << d));

/** A seeded random number generator (mulberry32), so a puzzle can be made again from its seed when testing. */
export function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle<T>(a: T[], rand: () => number): T[] {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// ── the solver: counts answers (stopping at `limit`), or fills an empty grid at random ──
function search(cells: ArrayLike<number>, limit: number, rand: (() => number) | null): { count: number; first: number[] | null } {
  const g = Array.from(cells), rows = new Int32Array(9), cols = new Int32Array(9), boxes = new Int32Array(9);
  for (let i = 0; i < 81; i++) {
    const v = g[i];
    if (!v) continue;
    const bit = 1 << v, r = rowOf(i), c = colOf(i), b = boxOf(i);
    if ((rows[r] | cols[c] | boxes[b]) & bit) return { count: 0, first: null };
    rows[r] |= bit; cols[c] |= bit; boxes[b] |= bit;
  }
  const empty = g.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0);
  let count = 0, first: number[] | null = null;
  const go = (left: number): boolean => {
    if (!left) { count++; if (!first) first = g.slice(); return count >= limit; }
    let best = -1, bestMask = 0, bestN = 10;                    // the empty cell with fewest numbers left to it
    for (const i of empty) {
      if (g[i]) continue;
      const m = ALL & ~(rows[rowOf(i)] | cols[colOf(i)] | boxes[boxOf(i)]), n = POP[m];
      if (n < bestN) { best = i; bestMask = m; bestN = n; if (n <= 1) break; }
    }
    if (!bestN) return false;
    const r = rowOf(best), c = colOf(best), b = boxOf(best);
    const ds = digitsOf(bestMask);
    if (rand) shuffle(ds, rand);
    for (const d of ds) {
      const bit = 1 << d;
      g[best] = d; rows[r] |= bit; cols[c] |= bit; boxes[b] |= bit;
      if (go(left - 1)) return true;
      g[best] = 0; rows[r] &= ~bit; cols[c] &= ~bit; boxes[b] &= ~bit;
    }
    return false;
  };
  go(empty.length);
  return { count, first };
}
/** How many answers a grid has, up to `limit` (2 is enough to tell one from more than one). */
export const countSolutions = (cells: ArrayLike<number>, limit = 2) => search(cells, limit, null).count;
/** The answer to a grid (the first found), or null if it has none. */
export const solve = (cells: ArrayLike<number>) => search(cells, 1, null).first;
const filledGrid = (rand: () => number) => search(new Array(81).fill(0), 1, rand).first!;

// ── the grader: solves the way a person does, and says the hardest step it needed ──
/** 1: singles only. 2: also pointing/claiming and naked/hidden pairs. 3: also triples, X-wing, swordfish, XY-wing.
 *  4: none of those finish it (it would take guessing or something cleverer). */
export function grade(cells: ArrayLike<number>): number {
  const g = Array.from(cells), cand = new Array<number>(81).fill(0);
  for (let i = 0; i < 81; i++) if (!g[i]) { let m = ALL; for (const p of PEERS[i]) if (g[p]) m &= ~(1 << g[p]); cand[i] = m; }
  let left = g.filter((v) => !v).length, hardest = 1;
  const place = (i: number, d: number) => { g[i] = d; cand[i] = 0; left--; for (const p of PEERS[i]) cand[p] &= ~(1 << d); };
  /** Takes candidates `m` out of cell i; true if any were there. */
  const cut = (i: number, m: number) => { if (g[i] || !(cand[i] & m)) return false; cand[i] &= ~m; return true; };

  const singles = (): boolean => {
    for (let i = 0; i < 81; i++) if (!g[i] && POP[cand[i]] === 1) { place(i, digitsOf(cand[i])[0]); return true; }
    for (const u of UNITS) for (let d = 1; d <= 9; d++) {
      const bit = 1 << d;
      let at = -1, n = 0;
      for (const i of u) if (cand[i] & bit) { at = i; n++; }
      if (n === 1) { place(at, d); return true; }
    }
    return false;
  };
  const basic = (): boolean => {
    // pointing: a number's places in a box all in one row or column clear it from the rest of that line;
    // claiming: its places in a line all in one box clear it from the rest of that box
    for (let d = 1; d <= 9; d++) {
      const bit = 1 << d;
      for (const box of BOXES) {
        const at = box.filter((i) => cand[i] & bit);
        if (at.length < 2) continue;
        for (const [line, of] of [[ROWS, rowOf], [COLS, colOf]] as const) {
          if (!at.every((i) => of(i) === of(at[0]))) continue;
          let any = false;
          for (const i of line[of(at[0])]) if (!box.includes(i)) any = cut(i, bit) || any;
          if (any) return true;
        }
      }
      for (const line of [...ROWS, ...COLS]) {
        const at = line.filter((i) => cand[i] & bit);
        if (at.length < 2 || !at.every((i) => boxOf(i) === boxOf(at[0]))) continue;
        let any = false;
        for (const i of BOXES[boxOf(at[0])]) if (!line.includes(i)) any = cut(i, bit) || any;
        if (any) return true;
      }
    }
    return subsets(2);
  };
  /** Naked and hidden subsets of size n in every unit. */
  const subsets = (n: number): boolean => {
    for (const u of UNITS) {
      const open = u.filter((i) => !g[i]);
      if (open.length <= n) continue;
      // naked: n cells whose candidates together are only n numbers
      for (const pick of combos(open.filter((i) => POP[cand[i]] <= n), n)) {
        const m = pick.reduce((a, i) => a | cand[i], 0);
        if (POP[m] !== n) continue;
        let any = false;
        for (const i of open) if (!pick.includes(i)) any = cut(i, m) || any;
        if (any) return true;
      }
      // hidden: n numbers that can only go in the same n cells
      const ds = range9.map((k) => k + 1).filter((d) => { const c = open.filter((i) => cand[i] & (1 << d)).length; return c >= 1 && c <= n; });
      for (const pick of combos(ds, n)) {
        const m = pick.reduce((a, d) => a | (1 << d), 0);
        const cells = open.filter((i) => cand[i] & m);
        if (cells.length !== n) continue;
        let any = false;
        for (const i of cells) any = cut(i, ALL & ~m) || any;
        if (any) return true;
      }
    }
    return false;
  };
  /** X-wing (n 2) and swordfish (n 3): a number's places in n rows all in the same n columns (or the other way round). */
  const fish = (n: number): boolean => {
    for (let d = 1; d <= 9; d++) {
      const bit = 1 << d;
      for (const [base, cover, across] of [[ROWS, COLS, colOf], [COLS, ROWS, rowOf]] as const) {
        const lines = base.map((line) => line.filter((i) => cand[i] & bit)).map((at, k) => ({ k, at })).filter((l) => l.at.length >= 2 && l.at.length <= n);
        for (const pick of combos(lines, n)) {
          const spots = new Set(pick.flatMap((l) => l.at.map(across)));
          if (spots.size !== n) continue;
          const mine = new Set(pick.flatMap((l) => l.at));
          let any = false;
          for (const s of spots) for (const i of cover[s]) if (!mine.has(i)) any = cut(i, bit) || any;
          if (any) return true;
        }
      }
    }
    return false;
  };
  /** XY-wing: a two-number pivot (xy) seeing two two-number pincers (xz, yz): z goes from every cell both pincers see. */
  const xyWing = (): boolean => {
    for (let p = 0; p < 81; p++) {
      if (POP[cand[p]] !== 2) continue;
      const wings = PEERS[p].filter((i) => POP[cand[i]] === 2 && POP[cand[i] & cand[p]] === 1);
      for (let a = 0; a < wings.length; a++) for (let b = a + 1; b < wings.length; b++) {
        const A = wings[a], B = wings[b];
        if ((cand[A] & cand[B] & cand[p]) || cand[A] === cand[B]) continue;
        const z = cand[A] & cand[B];
        if (POP[z] !== 1 || ((cand[A] | cand[B]) & ~z) !== cand[p]) continue;
        let any = false;
        for (const i of PEERS[A]) if (i !== B && i !== p && PEERS[B].includes(i)) any = cut(i, z) || any;
        if (any) return true;
      }
    }
    return false;
  };

  while (left) {
    if (singles()) continue;
    if (basic()) { hardest = Math.max(hardest, 2); continue; }
    if (subsets(3) || fish(2) || fish(3) || xyWing()) { hardest = 3; continue; }
    return 4;
  }
  return hardest;
}
function combos<T>(a: T[], n: number): T[][] {
  const out: T[][] = [];
  const go = (from: number, pick: T[]) => {
    if (pick.length === n) { out.push(pick.slice()); return; }
    for (let i = from; i <= a.length - (n - pick.length); i++) { pick.push(a[i]); go(i + 1, pick); pick.pop(); }
  };
  go(0, []);
  return out;
}

// ── making a puzzle ──
const PAIRS: number[][] = Array.from({ length: 41 }, (_, i) => (i === 40 ? [40] : [i, 80 - i]));
const GRADE: Record<Level, number> = { easy: 1, medium: 1, hard: 2, expert: 3 };
/** Clues an Easy or Medium puzzle is taken down to: somewhere in this range. */
const CLUES: Record<'easy' | 'medium', [number, number]> = { easy: [38, 42], medium: [30, 33] };

export function makePuzzle(level: Level, rand: () => number = Math.random): Puzzle {
  for (;;) {
    const solution = filledGrid(rand), p = solution.slice();
    const order = shuffle(PAIRS.slice(), rand);
    let clues = 81;
    if (level === 'easy' || level === 'medium') {
      const [lo, hi] = CLUES[level], want = lo + Math.floor(rand() * (hi - lo + 1));
      for (const pair of order) {
        if (clues <= want) break;
        for (const i of pair) p[i] = 0;
        if (countSolutions(p) === 1 && grade(p) === 1) clues -= pair.length;
        else for (const i of pair) p[i] = solution[i];
      }
      if (clues > want + 2) continue;                          // (it would not come down far enough: start again)
    } else {
      // as few clues as it will go to, then (if that is harder than wanted) clues given back until it is just right
      const out: number[][] = [];
      for (const pair of order) {
        for (const i of pair) p[i] = 0;
        if (countSolutions(p) === 1) { clues -= pair.length; out.push(pair); }
        else for (const i of pair) p[i] = solution[i];
      }
      let g = grade(p);
      if (g < GRADE[level]) continue;                          // too easy even with nothing left to take
      shuffle(out, rand);
      while (g > GRADE[level] && out.length) {
        for (const i of out.pop()!) p[i] = solution[i];
        clues = p.filter(Boolean).length;
        g = grade(p);
      }
      if (g !== GRADE[level] || clues > (level === 'expert' ? 30 : 32)) continue;      // (an Expert page with a lot printed on it looks easy)
    }
    return { puzzle: p.join(''), solution: solution.join(''), level, clues: p.filter(Boolean).length };
  }
}

/** A puzzle string back into numbers. */
export const cellsOf = (s: string) => Array.from(s, (ch) => Number(ch) || 0);
