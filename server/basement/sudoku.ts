// The sudoku book on the bathroom's side table (client/src/components/Sudoku.tsx). Not a basement fit-out: it rides the
// same plumbing ({ t: 'fit', id: 'sudoku', op }), as the robot vacuum does. Solo: nothing here goes to anybody else.
// All it does is keep each person's book, so it follows them from one PC to another: the puzzle they are on at each
// difficulty (its clues, answer, what they have written in and their pencil marks, the time so far), how many they
// have finished at each and their best times, and whether they like mistakes shown. The page makes the puzzles.
//   { op: 'load' }               -> { op: 'book', book } to them (null: they have never opened it)
//   { op: 'save', book }         kept if newer than what is kept (book.at, the page's clock), then sent to their other windows
import type { FitGame, FitOut } from '../floor.ts';
import { achieve } from '../achievements.ts';

const LEVELS = ['easy', 'medium', 'hard', 'expert'] as const;
const GRID = /^[0-9]{81}$/;
let out: FitOut;

const num = (v: unknown, max: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max ? Math.floor(v) : null);
/** What of a page's book can be kept: only the known parts, each checked, so a bad page cannot fill the database. */
function clean(b: unknown): Record<string, unknown> | null {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return null;
  const o = b as Record<string, unknown>, at = num(o.at, Date.now() + 60_000);
  if (!at) return null;
  const games: Record<string, unknown> = {}, done: Record<string, unknown> = {};
  for (const lv of LEVELS) {
    const g = (o.games as Record<string, any> | undefined)?.[lv];
    if (g && typeof g === 'object' && GRID.test(g.puzzle) && GRID.test(g.solution) && GRID.test(g.grid)
      && Array.isArray(g.notes) && g.notes.length === 81 && g.notes.every((n: unknown) => num(n, 1023) !== null)) {
      games[lv] = { puzzle: g.puzzle, solution: g.solution, grid: g.grid, notes: g.notes, ms: num(g.ms, 1e9) ?? 0, no: num(g.no, 1e6) ?? 1, solved: !!g.solved, slips: num(g.slips, 1e4) ?? 0 };
    }
    const d = (o.done as Record<string, any> | undefined)?.[lv];
    if (d && typeof d === 'object') done[lv] = { n: num(d.n, 1e6) ?? 0, best: num(d.best, 1e9) };
  }
  const last = LEVELS.includes(o.last as never) ? o.last : 'easy';
  return { at, last, mistakes: !!o.mistakes, games, done };
}
const keyOf = (uid: string) => `book:${uid}`;

const game: FitGame = {
  start(o) { out = o; },
  hello: () => null,
  message(uid, d) {
    if (d.op === 'load') { out.to(uid, { op: 'book', book: out.load(keyOf(uid), null) }); return; }
    if (d.op !== 'save') return;
    const book = clean(d.book);
    if (!book) return;
    const kept = out.load<{ at?: number } | null>(keyOf(uid), null);
    if (kept && (kept.at ?? 0) >= (book.at as number)) return;      // (an older save, arriving late from another window)
    out.save(keyOf(uid), book);
    out.to(uid, { op: 'book', book });
    achieve.sudoku(uid, book);
  },
};
export default game;
