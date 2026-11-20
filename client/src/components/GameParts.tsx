// The pieces every game at the table is drawn with (components/Games.tsx and the games beside it): who is in which
// seat, the panel at the side, the box between hands, and the sums that keep the pixel art in whole screen dots.
import { createContext, useContext, useEffect, useState } from 'react';
import type { CSSProperties, ReactNode, RefObject } from 'react';
import { gameOp, useStore } from '../store';
import type { GameTable } from '../types';
import { Avatar } from './ui';

/** How many screen dots a sprite dot gets in this view (2 to 6): see Games, which measures it. */
export const Scale = createContext(2);

const MARKS = ['robot', 'cards', 'pits', 'pool', 'darts', 'shuffle', 'bowling', 'golf', 'chips', 'cornhole', 'pong', 'shoes', 'bocce', 'fish', 'chess', 'checkers', 'go', 'four', 'mahjong', 'sudoku'] as const;
/** A 16x16 pixel mark: a robot head (a computer player), a hand of cards, a mancala board, or one of the basement's
 *  games (the eight ball, a dartboard, a shuffleboard weight, a pin and ball, a flag, a poker chip), cornhole, or the
 *  backyard's (a rack of cups, a horseshoe, two bocce balls and the pallino), a fish (the lake), and the card table's board
 *  games and the sudoku book in the same plain grey (a knight, a checker, a go board, four in a row, a mahjong tile, a grid). */
export function Mark({ name }: { name: (typeof MARKS)[number] }) {
  return <i className="g-mark" aria-hidden style={{ '--i': MARKS.indexOf(name) } as CSSProperties} />;
}

// ───────── who is who ─────────
export function useNames(t: GameTable) {
  const users = useStore((s) => s.users);
  return (i: number) => {
    const s = t.seats[i];
    if (!s) return '';
    if (s.bot) return `Computer ${t.seats.slice(0, i + 1).filter((x) => x.bot).length}`;
    return s.userId ? users[s.userId]?.name ?? 'Someone' : 'Empty seat';
  };
}
export const POS = ['bottom', 'left', 'top', 'right'];

/** A seat at the table: who is in it, a line about them, and whether it is their turn. */
export function Plate({ t, seat, pos = '', children }: { t: GameTable; seat: number; pos?: string; children?: ReactNode }) {
  const users = useStore((s) => s.users);
  const k = useContext(Scale);
  const name = useNames(t);
  const s = t.seats[seat];
  if (!s) return null;
  const turn = t.phase === 'playing' && t.turn.includes(seat) && t.turn.length < t.seats.length;
  return (
    <div className={`g-plate ${pos}${turn ? ' turn' : ''}${seat === t.you ? ' me' : ''}${s.away ? ' away' : ''}`}>
      {s.bot ? <span className="g-bot"><Mark name="robot" /></span> : <Avatar user={s.userId ? users[s.userId] : undefined} size={12 * k} />}
      <span className="g-who"><b>{name(seat)}{seat === t.you ? ' (you)' : ''}</b>{children && <small>{children}</small>}</span>
      {s.away && <span className="g-tag">Away</span>}
      {s.away && t.phase === 'playing' && t.bots && t.you >= 0 && <button className="g-small" onClick={() => gameOp('replace', { seat })} title="They have dropped off. Their seat is kept for them; after a few seconds you can let the computer play on for them.">Computer takes over</button>}
      {s.bot && t.phase === 'playing' && t.you < 0 && <button className="g-small" onClick={() => gameOp('sit', { seat })} title="Play on yourself from here">Take this seat</button>}
    </div>
  );
}

/** The few lines at the side: the scores, and what the game is played to. */
export function Side({ title, children }: { title: string; children: ReactNode }) {
  return <aside className="g-side"><h3>{title}</h3>{children}</aside>;
}
/** What shows over the middle of the table between hands, with the button that deals the next one. */
export function Between({ t, title, children }: { t: GameTable; title: string; children: ReactNode }) {
  return (
    <div className="g-between">
      <h3>{title}</h3>
      {children}
      {t.phase === 'playing' && (t.you >= 0 ? <button className="primary" onClick={() => gameOp('move', { m: { next: true } })}>Deal the next hand</button> : <p className="g-quiet">Waiting for the players to deal the next hand.</p>)}
    </div>
  );
}

/** How many screen dots each of a board's 16 sprite dots gets, so that the whole board (so many squares across and
 *  down) fits the space there is. Gives back the size of one square. */
export function useSquare(ref: RefObject<HTMLDivElement | null>, cols = 8, rows = 8, least = 2) {
  const [n, setN] = useState(3);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => setN(Math.max(least, Math.floor(Math.min((el.clientWidth - 12) / (cols * 16), (el.clientHeight - 12) / (rows * 16)))));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, cols, rows, least]);
  return n * 16;
}
