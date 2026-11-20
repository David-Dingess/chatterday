// The sudoku book on the little table by the toilet. Clicking it opens the book up close in the middle of the window, a
// paper puzzle book: the puzzle on the left page, a pencil, an eraser and the four difficulties' tabs on the right.
// Solo: each person has their own book, kept on the server (server/basement/sudoku.ts) so it follows them between PCs:
// the puzzle they are on at each difficulty, what they have written in, their pencil marks and the time so far, how
// many they have finished and their best times. The puzzles are made here (client/src/sudoku.ts).
//
// Keys: 1-9 write a number (Shift+1-9, or with the pencil picked up, a pencil mark), arrows move, Backspace/Delete/0
// rub out, N picks up or puts down the pencil, Ctrl+Z or U takes back, Esc closes.
import { memo, useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { CLUB } from '../clubhouse.gen';
import { hooks, send, useStore } from '../store';
import { LEVEL_NAME, LEVELS, makePuzzle, PEERS, boxOf } from '../sudoku';
import type { Level } from '../sudoku';
import { SureButton } from './ui';
import '../sudoku.css';

type Game = { puzzle: string; solution: string; grid: string; notes: number[]; ms: number; no: number; solved: boolean; slips: number };
type Book = { at: number; last: Level; mistakes: boolean; games: Partial<Record<Level, Game>>; done: Partial<Record<Level, { n: number; best: number | null }>> };
const blank = (): Book => ({ at: 0, last: 'easy', mistakes: false, games: {}, done: {} });

// ── the book: kept here, in this browser (for opening at once) and on the server (the one that counts: newest wins) ──
const useBook = create<{ book: Book; heard: boolean }>(() => ({ book: blank(), heard: false }));
const meId = () => useStore.getState().me?.id ?? '';
const localKey = () => `fc_sudoku_${meId()}`;
function readLocal(): Book | null {
  try { const b = JSON.parse(localStorage.getItem(localKey()) ?? 'null'); return b && typeof b === 'object' && b.games ? b : null; } catch { return null; }
}
function writeLocal(b: Book) { try { localStorage.setItem(localKey(), JSON.stringify(b)); } catch { /* (private window: the server still has it) */ } }

/** The clock on the puzzle being played: its saved time plus the stretch since `since` (0: not running). */
let since = 0;
const elapsed = (g: Game | undefined) => (g ? g.ms + (since && !g.solved ? Date.now() - since : 0) : 0);
/** Folds the running stretch into the puzzle's saved time (before a save, or on stopping the clock). */
function foldClock(b: Book): Book {
  const g = b.games[b.last];
  if (!since || !g || g.solved) { if (since) since = Date.now(); return b; }
  const now = Date.now(), ms = g.ms + (now - since);
  since = now;
  return { ...b, games: { ...b.games, [b.last]: { ...g, ms } } };
}

let saveTimer = 0;
function pushSave() {
  window.clearTimeout(saveTimer);
  saveTimer = 0;
  const book = useBook.getState().book;
  if (book.at) send({ t: 'fit', id: 'sudoku', op: 'save', book });
}
/** Changes the book: stamped now, kept in this browser, and sent to the server a moment later (straight away with `now`). */
function commit(change: (b: Book) => Book, now = false) {
  const book = { ...change(foldClock(useBook.getState().book)), at: Date.now() };
  useBook.setState({ book });
  writeLocal(book);
  window.clearTimeout(saveTimer);
  if (now) pushSave(); else saveTimer = window.setTimeout(pushSave, 1200);
}
hooks.fit.push((d) => {
  if (d?.id !== 'sudoku' || d.op !== 'book') return;
  const theirs = d.book as Book | null, mine = useBook.getState().book;
  if (!theirs) { useBook.setState({ heard: true }); if (mine.at) pushSave(); return; }      // (never kept on the server: this browser's copy goes up)
  if (theirs.at > mine.at) {
    if (since) since = Date.now();                               // (another PC's time for this puzzle is the one that counts now)
    useBook.setState({ book: theirs, heard: true });
    writeLocal(theirs);
  } else {
    useBook.setState({ heard: true });
    if (theirs.at < mine.at) pushSave();
  }
});
function openBook() {
  const local = readLocal();
  if (local && local.at > useBook.getState().book.at) useBook.setState({ book: local });
  send({ t: 'fit', id: 'sudoku', op: 'load' });
}

/** Undo, for each difficulty: what the grid and the pencil marks were before each change. In memory only. */
const undos = new Map<Level, { grid: string; notes: number[] }[]>();
const clock = (ms: number) => { const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return `${h ? `${h}:${String(m).padStart(2, '0')}` : m}:${String(s % 60).padStart(2, '0')}`; };

// ── in the room: the table and the book on it, to click ──
const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
const useOpen = create<{ open: boolean }>(() => ({ open: false }));
/** Opens the book (from Play Games). */
export const openSudoku = () => useOpen.setState({ open: true });
export const SudokuTable = memo(function SudokuTable({ mini }: { mini: boolean }) {
  const open = useOpen((s) => s.open);
  if (mini) return null;
  const [x, y, w, h] = CLUB.sudoku.rect;
  return (
    <>
      <i className="club-sudoku" style={{ left: x, top: y, width: w, height: h, zIndex: y + h - 2 }}
        title="The sudoku book" onMouseMove={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); useOpen.setState({ open: true }); }} />
      {open && createPortal(
        // (a portal still bubbles its events up through the room in React: kept here, so a click in the book never
        // reaches the room behind it, a desk or a seat under the tabs)
        <div style={{ display: 'contents' }} onClick={stop} onDoubleClick={stop} onContextMenu={stop} onPointerDown={stop} onPointerUp={stop}
          onPointerMove={stop} onMouseDown={stop} onMouseUp={stop} onMouseMove={stop} onTouchStart={stop} onTouchEnd={stop} onWheel={stop}>
          <SudokuBook onClose={() => useOpen.setState({ open: false })} />
        </div>, document.body)}
    </>
  );
});

// ── the book up close ──
function SudokuBook({ onClose }: { onClose: () => void }) {
  const { book, heard } = useBook();
  const level = book.last, game = book.games[level];
  const [sel, setSel] = useState(-1);
  const [pencil, setPencil] = useState(false);
  const [, tick] = useState(0);
  const [making, setMaking] = useState(false);

  // open: ask the server for the book; the clock runs while the book is open and the window is in front
  useEffect(() => {
    openBook();
    since = document.hidden ? 0 : Date.now();
    const vis = () => { if (document.hidden) { commit((b) => b, true); since = 0; } else since = Date.now(); };
    document.addEventListener('visibilitychange', vis);
    const t = window.setInterval(() => tick((n) => n + 1), 500);
    const keep = window.setInterval(() => { if (since && useBook.getState().book.at) commit((b) => b); }, 15_000);
    return () => {
      document.removeEventListener('visibilitychange', vis);
      clearInterval(t); clearInterval(keep);
      if (useBook.getState().book.at) commit((b) => b, true);
      since = 0;
    };
  }, []);

  // a fresh puzzle for a difficulty with none yet (once the server has said what it has, so as not to start one it already has)
  const fresh = useCallback((lv: Level, no: number) => {
    setMaking(true);
    window.setTimeout(() => {                                    // (a moment for "turning to a fresh page" to show; Expert can take a tenth of a second)
      const p = makePuzzle(lv);
      undos.delete(lv);
      commit((b) => ({ ...b, last: lv, games: { ...b.games, [lv]: { puzzle: p.puzzle, solution: p.solution, grid: p.puzzle, notes: new Array(81).fill(0), ms: 0, no, solved: false, slips: 0 } } }), true);
      setSel(-1);
      setMaking(false);
    }, 30);
  }, []);
  useEffect(() => {
    if (!game && !making && (heard || !navigator.onLine)) fresh(level, (book.done[level]?.n ?? 0) + 1);
  }, [game, making, heard, level, book.done, fresh]);
  useEffect(() => {                                              // (no answer from the server: carry on with this browser's copy)
    if (heard) return;
    const t = window.setTimeout(() => useBook.setState({ heard: true }), 2500);
    return () => clearTimeout(t);
  }, [heard]);

  const change = useCallback((fn: (g: Game) => Partial<Game> | null) => {
    const b = useBook.getState().book, g = b.games[b.last];
    if (!g || g.solved) return;
    const next = fn(g);
    if (!next) return;
    const stack = undos.get(b.last) ?? [];
    stack.push({ grid: g.grid, notes: g.notes });
    if (stack.length > 300) stack.shift();
    undos.set(b.last, stack);
    commit((bk) => {
      const was = bk.games[bk.last]!, g2 = { ...was, ...next };
      if (g2.grid === g2.solution && !was.solved) {               // finished: the clock stops, and it counts
        const d = bk.done[bk.last] ?? { n: 0, best: null };
        return { ...bk, games: { ...bk.games, [bk.last]: { ...g2, solved: true } }, done: { ...bk.done, [bk.last]: { n: d.n + 1, best: d.best === null ? g2.ms : Math.min(d.best, g2.ms) } } };
      }
      return { ...bk, games: { ...bk.games, [bk.last]: g2 } };
    }, g.grid !== (next.grid ?? g.grid) && next.grid === g.solution);
  }, []);

  const write = useCallback((i: number, d: number, asNote: boolean) => change((g) => {
    if (i < 0 || g.puzzle[i] !== '0') return null;
    const notes = g.notes.slice();
    if (asNote) {
      if (g.grid[i] !== '0') return null;
      notes[i] ^= 1 << d;
      return { notes };
    }
    const grid = g.grid.split('');
    if (grid[i] === String(d)) { grid[i] = '0'; return { grid: grid.join('') }; }
    grid[i] = String(d);
    notes[i] = 0;
    for (const p of PEERS[i]) notes[p] &= ~(1 << d);             // (the number crossed out of the pencil marks it now rules out)
    return { grid: grid.join(''), notes, slips: g.slips + (String(d) !== g.solution[i] ? 1 : 0) };
  }), [change]);
  const rub = useCallback((i: number) => change((g) => {
    if (i < 0 || g.puzzle[i] !== '0') return null;
    if (g.grid[i] !== '0') { const grid = g.grid.split(''); grid[i] = '0'; return { grid: grid.join('') }; }
    if (!g.notes[i]) return null;
    const notes = g.notes.slice(); notes[i] = 0;
    return { notes };
  }), [change]);
  const undo = useCallback(() => {
    const b = useBook.getState().book, g = b.games[b.last], stack = undos.get(b.last);
    if (!g || g.solved || !stack?.length) return;
    const was = stack.pop()!;
    commit((bk) => ({ ...bk, games: { ...bk.games, [bk.last]: { ...bk.games[bk.last]!, ...was } } }));
  }, []);
  const pickLevel = (lv: Level) => { if (lv !== level) { commit((b) => ({ ...b, last: lv }), true); setSel(-1); } };

  // keys (taken before the rest of the app sees them: nothing else should hear digits or Esc while the book is open)
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.('input:not([type="checkbox"]), textarea, [contenteditable="true"]')) return;
      const k = e.key, digit = /^Digit([1-9])$/.exec(e.code)?.[1] ?? (/^[1-9]$/.test(k) ? k : null);
      let used = true;
      if (k === 'Escape') onClose();
      else if (digit && !e.ctrlKey && !e.metaKey && !e.altKey) write(sel, Number(digit), pencil !== e.shiftKey);
      else if ((k === 'z' || k === 'Z') && (e.ctrlKey || e.metaKey)) undo();
      else if (k === 'u' || k === 'U') undo();
      else if (k === 'n' || k === 'N' || k === 'p' || k === 'P') setPencil((v) => !v);
      else if (k === 'Backspace' || k === 'Delete' || k === '0') rub(sel);
      else if (k.startsWith('Arrow')) {
        const [dr, dc] = k === 'ArrowUp' ? [-1, 0] : k === 'ArrowDown' ? [1, 0] : k === 'ArrowLeft' ? [0, -1] : [0, 1];
        setSel((s) => { const at = s < 0 ? 40 : s; return ((Math.floor(at / 9) + dr + 9) % 9) * 9 + ((at % 9) + dc + 9) % 9; });
      } else used = false;
      if (used) { e.preventDefault(); e.stopPropagation(); }
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [sel, pencil, write, rub, undo, onClose]);

  const ms = elapsed(game);
  const selVal = game && sel >= 0 ? game.grid[sel] : '0';
  const left = (d: number) => (game ? 9 - [...game.grid].filter((c) => c === String(d)).length : 9);
  const started = !!game && game.grid !== game.puzzle;
  return (
    <div className="sdk-scrim" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sdk-book" role="dialog" aria-label="Sudoku book">
        <button className="sdk-x" onClick={onClose} aria-label="Close">✕</button>
        <div className="sdk-tabs" role="tablist">
          {LEVELS.map((lv) => (
            <button key={lv} role="tab" aria-selected={lv === level} className={`sdk-tab ${lv}${lv === level ? ' on' : ''}`} onClick={() => pickLevel(lv)}>{LEVEL_NAME[lv]}</button>
          ))}
        </div>
        <div className="sdk-page sdk-left">
          <div className="sdk-head">
            <b>No. {game?.no ?? (book.done[level]?.n ?? 0) + 1}</b>
            <span>{LEVEL_NAME[level]}</span>
            <span className="sdk-clock" title="Time on this puzzle">{clock(ms)}</span>
          </div>
          <div className={`sdk-grid${pencil ? ' penciling' : ''}`}>
            {game && !making ? Array.from({ length: 81 }, (_, i) => {
              const r = Math.floor(i / 9), c = i % 9, clue = game.puzzle[i] !== '0', v = game.grid[i];
              const wrong = book.mistakes && !clue && v !== '0' && v !== game.solution[i];
              const peer = sel >= 0 && i !== sel && (Math.floor(sel / 9) === r || sel % 9 === c || boxOf(sel) === boxOf(i));
              const same = selVal !== '0' && v === selVal && i !== sel;
              const cls = ['sdk-cell', clue ? 'clue' : v !== '0' ? 'pen' : '', wrong ? 'wrong' : '', i === sel ? 'sel' : peer ? 'peer' : '', same ? 'same' : '',
                c % 3 === 2 && c < 8 ? 'thick-r' : '', r % 3 === 2 && r < 8 ? 'thick-b' : ''].filter(Boolean).join(' ');
              return (
                <div key={i} className={cls} onPointerDown={(e) => { e.preventDefault(); setSel(i); }}>
                  {v !== '0' ? v : game.notes[i] ? (
                    <span className="sdk-notes">{[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => <i key={d}>{game.notes[i] & (1 << d) ? d : ''}</i>)}</span>
                  ) : null}
                </div>
              );
            }) : <p className="sdk-fresh">Turning to a fresh page...</p>}
            {game?.solved && !making && (
              <div className="sdk-stamp"><b>Solved</b><span>{clock(game.ms)}</span>{book.done[level]?.best === game.ms && <small>Best time</small>}</div>
            )}
          </div>
        </div>
        <div className="sdk-spine" aria-hidden />
        <div className="sdk-page sdk-right">
          <div className="sdk-pad">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => (
              <button key={d} className={`sdk-num${left(d) <= 0 ? ' gone' : ''}`} disabled={!game || game.solved}
                title={pencil ? `Pencil in ${d}` : `Write ${d}`} onClick={() => write(sel, d, pencil)}>{d}</button>
            ))}
          </div>
          <div className="sdk-tools">
            <button className={`sdk-tool${pencil ? ' on' : ''}`} onClick={() => setPencil((v) => !v)} title="Pencil marks (N)" aria-pressed={pencil}>
              <span className="sdk-pencil" aria-hidden />Pencil
            </button>
            <button className="sdk-tool" onClick={() => rub(sel)} title="Rub out (Backspace)" disabled={!game || game.solved}><span className="sdk-eraser" aria-hidden />Eraser</button>
            <button className="sdk-tool" onClick={undo} title="Take back (Ctrl+Z)" disabled={!game || game.solved || !undos.get(level)?.length}>Undo</button>
          </div>
          <label className="sdk-check">
            <input type="checkbox" checked={book.mistakes} onChange={(e) => { const on = e.target.checked; commit((b) => ({ ...b, mistakes: on }), true); }} />
            <span>Show mistakes</span>
            {book.mistakes && game ? <em>{game.slips} so far</em> : null}
          </label>
          <table className="sdk-stats">
            <thead><tr><th /><th>Done</th><th>Best</th></tr></thead>
            <tbody>
              {LEVELS.map((lv) => (
                <tr key={lv} className={lv === level ? 'on' : ''}><th>{LEVEL_NAME[lv]}</th><td>{book.done[lv]?.n ?? 0}</td><td>{book.done[lv]?.best != null ? clock(book.done[lv]!.best!) : '-'}</td></tr>
              ))}
            </tbody>
          </table>
          {game?.solved
            ? <button className="sdk-next" onClick={() => fresh(level, game.no + 1)}>Next puzzle</button>
            : started
              ? <SureButton className="sdk-next" ask="Start over on a new one?" onSure={() => fresh(level, (game?.no ?? 0) + 1)}>New puzzle</SureButton>
              : <button className="sdk-next" disabled={!game || making} onClick={() => fresh(level, (game?.no ?? 0) + 1)}>New puzzle</button>}
          <p className="sdk-keys">1-9 write · Shift+1-9 or N pencil · arrows move · Backspace rub out · Ctrl+Z undo · Esc close</p>
        </div>
      </div>
    </div>
  );
}
