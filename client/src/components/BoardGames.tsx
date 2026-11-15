// Three more games for the table: Go, Four in a Row and Mancala. Like the rest (components/Games.tsx), these only
// draw what the server sends and say what was clicked; the rules are in server/games/.
import { useRef } from 'react';
import type { CSSProperties } from 'react';
import { gameOp, tableNote } from '../store';
import type { FourView, GameTable, GoView, MancalaView } from '../types';
import { Plate, Side, useNames, useSquare } from './GameParts';
import { SureButton } from './ui';

// ───────── four in a row ─────────
export function Four({ t, g }: { t: GameTable; g: FourView }) {
  const name = useNames(t);
  const area = useRef<HTMLDivElement>(null);
  const sq = useSquare(area, 7, 6);
  const myTurn = t.phase === 'playing' && g.turn === t.you;
  const full = (col: number) => g.board[col] !== '.';
  /** Where a piece dropped into each column would come to rest. */
  const lands = [0, 1, 2, 3, 4, 5, 6].map((c) => { for (let r = 5; r >= 0; r--) if (g.board[r * 7 + c] === '.') return r * 7 + c; return -1; });
  const drop = (col: number) => {
    if (!myTurn) return;
    if (full(col)) tableNote('That column is full.'); else gameOp('move', { m: { col } });
  };
  const plate = (seat: number) => <Plate t={t} seat={seat}>{seat === 0 ? 'Red' : 'Yellow'}</Plate>;
  return (
    <div className="g-boardgame">
      <div className="g-boardarea" ref={area}>
        <div className="g-four" style={{ '--sq': `${sq}px` } as CSSProperties}>
          {Array.from(g.board, (p, i) => (
            <button type="button" key={i} onClick={() => drop(i % 7)} aria-label={`Column ${(i % 7) + 1}`}
              className={`g-hole${myTurn && !full(i % 7) ? ' can' : ''}${myTurn && lands[i % 7] === i ? ' lands' : ''}${g.last === i ? ' last' : ''}${g.line?.includes(i) ? ' won' : ''}`}>
              {p !== '.' && <i className="g-piece stone" title={p === 'r' ? 'Red' : 'Yellow'} style={{ backgroundPosition: p === 'r' ? '0 0' : '33.333% 0' }} />}
            </button>
          ))}
        </div>
      </div>
      <Side title="Four in a Row">
        {plate(0)}
        {plate(1)}
        {t.phase === 'playing' && <p className={`g-status${myTurn ? ' go' : ''}`}>{myTurn ? 'Your turn: pick a column.' : `Waiting for ${name(g.turn)}.`}</p>}
        <p className="g-quiet">A piece falls to the bottom of its column. Four of yours in a line wins: across, up, or slanted.</p>
      </Side>
    </div>
  );
}

// ───────── mancala ─────────
/** The stones in a pit, drawn one by one up to a pitful; the number beside the pit says how many there really are. */
function Stones({ n, most }: { n: number; most: number }) {
  return <span className="g-stones">{Array.from({ length: Math.min(n, most) }, (_, i) => <i key={i} />)}</span>;
}
export function Mancala({ t, g }: { t: GameTable; g: MancalaView }) {
  const name = useNames(t);
  const base = Math.max(0, t.you), other = 1 - base;
  const myTurn = t.phase === 'playing' && g.turn === t.you;
  const last = g.last;
  const mark = (i: number) => `${last?.from === i ? ' from' : ''}${last?.to === i ? ' last' : ''}`;
  const pit = (i: number, top: boolean) => {
    const mine = myTurn && Math.floor(i / 7) === t.you;
    return (
      <div className={`g-pitbox${top ? ' top' : ''}`} key={i}>
        <button type="button" className={`g-pit${mark(i)}${mine && g.pits[i] ? ' can' : ''}`} disabled={!mine}
          onClick={() => (g.pits[i] ? gameOp('move', { m: { pit: i } }) : tableNote('That pit is empty.'))} aria-label={`A pit with ${g.pits[i]} stones`}>
          <Stones n={g.pits[i]} most={16} />
        </button>
        <b>{g.pits[i]}</b>
      </div>
    );
  };
  const store = (seat: number) => (
    <div className={`g-store${mark(seat * 7 + 6)}`} title={`${name(seat)}'s store`}>
      <Stones n={g.pits[seat * 7 + 6]} most={40} />
      <b>{g.pits[seat * 7 + 6]}</b>
    </div>
  );
  let status = '';
  if (t.phase === 'playing') {
    if (myTurn) status = last?.seat === t.you && last.again ? 'Your last stone landed in your store: go again.' : 'Your turn: pick one of your pits.';
    else status = `Waiting for ${name(g.turn)}${last?.seat === g.turn && last.again ? ', who goes again' : ''}.`;
  }
  return (
    <div className="g-boardgame">
      <div className="g-boardarea">
        <div className="g-mancala">
          {store(other)}
          <div className="g-pitrows">
            <div className="g-pitrow">{[5, 4, 3, 2, 1, 0].map((n) => pit(other * 7 + n, true))}</div>
            <div className="g-pitrow">{[0, 1, 2, 3, 4, 5].map((n) => pit(base * 7 + n, false))}</div>
          </div>
          {store(base)}
        </div>
      </div>
      <Side title="Mancala">
        <Plate t={t} seat={other}>top row · store on the left · {g.pits[other * 7 + 6]}</Plate>
        <Plate t={t} seat={base}>bottom row · store on the right · {g.pits[base * 7 + 6]}</Plate>
        {status && <p className={`g-status${myTurn ? ' go' : ''}`}>{status}</p>}
        {last && last.took > 0 && <p className="g-quiet">{name(last.seat)} captured {last.took}.</p>}
        <p className="g-quiet">Pick up a pit and drop its stones one by one, to the right along your row, into your store, and on round the other row.</p>
        <p className="g-quiet">Last stone in your store: go again. Last stone in an empty pit of yours: take it and whatever is opposite.</p>
        <p className="g-quiet">It ends when one row is empty. The other side keeps what is left in theirs.</p>
      </Side>
    </div>
  );
}

// ───────── go ─────────
/** The marked crossings on each size of board. */
const STARS: Record<number, number[]> = { 9: [2, 4, 6], 13: [3, 6, 9], 19: [3, 9, 15] };
/** The four near the corners and the one in the middle; the full board has the four at the sides as well. */
const isStar = (n: number, r: number, c: number) => {
  const s = STARS[n];
  if (!s || !s.includes(r) || !s.includes(c)) return false;
  return n === 19 || (r === s[1]) === (c === s[1]);
};
export function Go({ t, g }: { t: GameTable; g: GoView }) {
  const name = useNames(t);
  const area = useRef<HTMLDivElement>(null);
  const sq = useSquare(area, g.n, g.n, 1);
  const seated = t.you >= 0 && t.phase === 'playing';
  const myTurn = seated && g.phase === 'play' && g.turn === t.you;
  const marking = g.phase === 'mark';
  const click = (i: number) => {
    if (!seated) return;
    if (marking) { if (g.board[i] !== '.') gameOp('move', { m: { dead: i } }); return; }
    if (!myTurn) return;
    if (g.board[i] !== '.') tableNote('There is a stone there already.'); else gameOp('move', { m: { at: i } });
  };
  const plate = (seat: number) => <Plate t={t} seat={seat}>{seat === 0 ? 'Black' : 'White'} · captured {g.caps[seat]}{marking && g.agreed[seat] ? ' · agreed' : ''}</Plate>;
  let status = '';
  if (t.phase === 'playing') {
    if (marking) status = seated ? 'Click any dead groups, then agree.' : 'The players are agreeing which stones are dead.';
    else status = `${myTurn ? 'Your move.' : `${name(g.turn)} to move.`}${g.last === -1 ? ` ${g.turn === t.you ? name(1 - g.turn) : 'They'} passed.` : ''}`;
  }
  return (
    <div className="g-boardgame">
      <div className="g-boardarea" ref={area}>
        <div className="g-goboard" style={{ '--sq': `${sq}px`, '--n': g.n } as CSSProperties}>
          {Array.from(g.board, (p, i) => {
            const r = Math.floor(i / g.n), c = i % g.n, dead = g.dead.includes(i);
            const own = g.owner && (p === '.' || dead) ? g.owner[i] : '.';
            const cls = `g-pt${r === 0 ? ' t' : ''}${r === g.n - 1 ? ' b' : ''}${c === 0 ? ' l' : ''}${c === g.n - 1 ? ' r' : ''}${p === '.' && isStar(g.n, r, c) ? ' star' : ''}${g.last === i ? ' last' : ''}${(myTurn && p === '.') || (marking && seated && p !== '.') ? ' can' : ''}`;
            return (
              <button type="button" key={i} className={cls} onClick={() => click(i)} aria-label={`${'ABCDEFGHJKLMNOPQRST'[c]}${g.n - r}`}>
                {p !== '.' && <i className={`g-piece stone${dead ? ' dead' : ''}`} title={p === 'b' ? 'Black' : 'White'} style={{ backgroundPosition: p === 'b' ? '66.667% 0' : '100% 0' }} />}
                {own !== '.' && <i className={`g-own ${own}`} />}
              </button>
            );
          })}
        </div>
      </div>
      <Side title="Go">
        {plate(1)}
        {plate(0)}
        {status && <p className={`g-status${myTurn || (marking && seated && !g.agreed[t.you]) ? ' go' : ''}`}>{status}</p>}
        {g.score && <p>Black {g.score[0]} · White {g.score[1]}<small className="g-quiet"> (with {g.komi} for going second)</small></p>}
        {seated && g.phase === 'play' && g.ply === 0 && (
          <div className="g-acts">
            <span className="g-quiet">Board</span>
            {[9, 13, 19].map((n) => <button key={n} className={g.n === n ? 'primary' : ''} onClick={() => gameOp('move', { m: { size: n } })} title={n === 9 ? 'The small board: a quick game, and the one to learn on' : n === 13 ? 'A middle-sized game' : 'The full board'}>{n}</button>)}
          </div>
        )}
        {seated && g.phase === 'play' && (
          <div className="g-acts col">
            <button disabled={!myTurn} onClick={() => gameOp('move', { m: { pass: true } })} title="Play no stone this turn. When both of you pass, the game stops and is counted.">Pass</button>
            <SureButton onSure={() => gameOp('move', { m: { a: 'resign' } })} title="Give up this game">Resign</SureButton>
          </div>
        )}
        {seated && marking && (
          <div className="g-acts col">
            <button className="primary" disabled={g.agreed[t.you]} onClick={() => gameOp('move', { m: { agree: true } })}>{g.agreed[t.you] ? 'Agreed: waiting for them' : 'Agree to this count'}</button>
            <button onClick={() => gameOp('move', { m: { resume: true } })} title="If you cannot agree which stones are dead, play it out">Keep playing</button>
          </div>
        )}
        {marking
          ? <p className="g-quiet">Both passed. Dead stones are ones that could not avoid capture: click a group to mark it (or unmark it). The small squares show whose each empty crossing is.</p>
          : <>
            <p className="g-quiet">Stones go on the crossings and never move. A group with no empty crossing next to it is captured.</p>
            <p className="g-quiet">You score your stones plus the empty crossings they surround. Pass when there is nothing left worth playing.</p>
          </>}
      </Side>
    </div>
  );
}
