// The game table, opened up: pick a game, take a seat, play. The card games are here (Hearts, Spades, Rummy), and
// Chess and Checkers; Mahjong is in Mahjong.tsx, and Go, Four in a Row and Mancala in BoardGames.tsx. The server holds
// the game and checks every move (server/games.ts); this only draws what it is sent and says what was clicked. The
// suits, pieces and tiles are our own pixel sprites (scripts/make-games.py), never symbol characters.
import { useContext, useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import '../games.css';
import { GAME_NAMES, gameOp, tableNote, useStore } from '../store';
import type { CheckersView, ChessView, FourView, GameKind, GameTable, GoView, HeartsView, LastTrick, MahjongView, MancalaView, PlayedCard, RummyMeld, RummyView, SpadesView } from '../types';
import { Four, Go, Mancala } from './BoardGames';
import { Between, Mark, Plate, POS, Scale, Side, useNames, useSquare } from './GameParts';
import { Mahjong, MahjongGuide, Tile } from './Mahjong';
import { Avatar, Icon, SureButton } from './ui';
import { goFloor } from '../basement';
import { openTable } from '../basement/gameroom.tsx';
import { setOpen as openLane } from '../basement/bowling.tsx';
import { setOpen as openGolf } from '../basement/minigolf.tsx';
import { setOpen as openShuffle } from '../basement/shuffle.tsx';
import { setOpen as openHoldem } from '../basement/holdem.tsx';
import { setOpen as openCornhole } from '../basement/cornhole.tsx';
import { setOpen as openPong } from '../basement/pong.tsx';
import { setOpen as openShoes } from '../basement/shoes.tsx';
import { setOpen as openBocce } from '../basement/bocce.tsx';
import { useWatching } from '../basement/sound';
import { openSudoku } from './Sudoku';

/** The games that are not at the card table: the game room's (in the basement), cornhole (at the campsite) and the
 *  backyard's (beer pong, horseshoes, bocce). Picking
 *  one goes there and opens it large. */
type Away = { id: string; name: string; where: string; who: string; blurb: string; mark: Parameters<typeof Mark>[0]['name']; floor: string; open: () => void };
const AWAY: Away[] = [
  { id: 'pool', name: 'Pool', where: 'Game room', who: '2 players, or against the house', blurb: 'Eight-ball. Sink your suit, then the eight.', mark: 'pool', floor: 'gameroom', open: () => openTable('pool') },
  { id: 'darts', name: 'Darts', where: 'Game room', who: 'Up to 4 players', blurb: '301, 501, cricket or round the clock.', mark: 'darts', floor: 'gameroom', open: () => openTable('darts') },
  { id: 'shuffle', name: 'Shuffleboard', where: 'Game room', who: '2 players', blurb: 'Slide the weights down the long table. Hang one off the end for four.', mark: 'shuffle', floor: 'gameroom', open: () => openShuffle(true) },
  { id: 'bowling', name: 'Bowling', where: 'Game room', who: 'Up to 4 players', blurb: 'Ten frames down the lane. Strikes, spares and splits.', mark: 'bowling', floor: 'gameroom', open: () => openLane(true) },
  { id: 'holdem', name: "Texas Hold'em", where: 'Game room', who: 'Up to 6 players', blurb: 'No-limit poker for play chips.', mark: 'chips', floor: 'gameroom', open: () => openHoldem(true) },
  { id: 'cornhole', name: 'Cornhole', where: 'Campsite', who: '1 or 2 a side', blurb: 'Bags at the boards. Cancellation scoring, first to 21.', mark: 'cornhole', floor: 'outside', open: () => openCornhole(true) },
  { id: 'beerpong', name: 'Beer Pong', where: 'Backyard', who: '1 or 2 a side', blurb: 'Ten cups racked at each end. Clear theirs first; balls back if both go in.', mark: 'pong', floor: 'backyard', open: () => openPong(true) },
  { id: 'horseshoes', name: 'Horseshoes', where: 'Backyard', who: '1 or 2 a side', blurb: 'Two stakes forty feet apart. Ringers 3, leaners 1, first to 21.', mark: 'shoes', floor: 'backyard', open: () => openShoes(true) },
  { id: 'golf', name: 'Mini golf', where: 'Past the backyard', who: 'Up to 6 players', blurb: 'Nine holes up the path through the backyard gate. Walk up to your ball, drag back and putt.', mark: 'golf', floor: 'minigolf', open: () => openGolf(true) },
  { id: 'fishing', name: 'Fishing', where: 'The lake', who: 'Up to 6 on the dock', blurb: 'Down the path past the campsite. Click a spot on the dock, then cast.', mark: 'fish', floor: 'lake', open: () => {} },
  { id: 'sudoku', name: 'Sudoku', where: 'Bathroom', who: 'Just you', blurb: 'The puzzle book by the toilet. Four difficulties, your own book.', mark: 'sudoku', floor: '', open: () => openSudoku() },
  { id: 'bocce', name: 'Bocce', where: 'Backyard', who: '1 or 2 a side', blurb: 'The pallino, then four balls a side. Nearest scores; first to 12.', mark: 'bocce', floor: 'backyard', open: () => openBocce(true) },
];
function playAway(g: Away) {
  // only the one picked is open large; then back to the room, and down (or out) there if not there already
  openTable(''); openLane(false); openGolf(false); openShuffle(false); openHoldem(false); openCornhole(false); openPong(false); openShoes(false); openBocce(false);
  g.open();
  goFloor.setState({ to: g.floor });
  useStore.setState({ view: { kind: 'hangout' } });
}

const KINDS: GameKind[] = ['hearts', 'spades', 'rummy', 'mahjong', 'chess', 'checkers', 'go', 'four', 'mancala'];
const BLURB: Record<GameKind, [string, string]> = {
  hearts: ['4 players', 'Dodge the hearts and the queen of spades. Lowest score wins when somebody reaches 100.'],
  spades: ['4 players, partners across', 'Bid your tricks, spades are trumps. First side to 500.'],
  rummy: ['2 to 4 players', 'Draw, lay down sets and runs, discard. First to 100.'],
  chess: ['2 people', 'White moves first. Checkmate wins.'],
  checkers: ['2 people', 'Red moves first. Jumps must be taken.'],
  mahjong: ['4 players', 'Draw a tile, throw a tile: four sets and a pair wins. With a coach and a guide for learning it.'],
  go: ['2 people', 'Surround more of the board than the other side. 9, 13 or 19 lines across.'],
  four: ['2 players', 'Drop your pieces down the columns. Four in a line wins.'],
  mancala: ['2 players', 'Sow your stones round the board. Most in your store wins.'],
};
const SEAT_LABELS: Partial<Record<GameKind, string[]>> = {
  chess: ['White', 'Black'], checkers: ['Red', 'White'], spades: ['Side A', 'Side B', 'Side A', 'Side B'],
  mahjong: ['East: deals first', 'South', 'West', 'North'], go: ['Black', 'White'], four: ['Red', 'Yellow'],
};

// ───────── cards ─────────
const SUIT_AT: Record<string, number> = { C: 0, D: 1, S: 2, H: 3 };
const SUIT_WORD: Record<string, string> = { C: 'clubs', D: 'diamonds', S: 'spades', H: 'hearts' };
const RANK_WORD: Record<string, string> = { T: '10', J: 'jack', Q: 'queen', K: 'king', A: 'ace' };
const rankText = (c: string) => (c[0] === 'T' ? '10' : c[0]);
const cardWord = (c: string) => `${RANK_WORD[c[0]] ?? c[0]} of ${SUIT_WORD[c[1]]}`;
const isRed = (c: string) => c[1] === 'D' || c[1] === 'H';

/** One of our pixel suits, in the colour of the text round it (or red, for diamonds and hearts on a card). */
function Suit({ s, big = false }: { s: string; big?: boolean }) {
  return <i className={`g-suit${big ? ' big' : ''}`} aria-hidden style={{ '--i': SUIT_AT[s] } as CSSProperties} />;
}
/** A card, face up. With `onClick` it is a button; `dim` is one that cannot be played now (clicking says why). */
function CardFace({ card, onClick, dim = false, up = false, mark = false }: { card: string; onClick?: () => void; dim?: boolean; up?: boolean; mark?: boolean }) {
  const cls = `g-card${isRed(card) ? ' red' : ''}${dim ? ' dim' : ''}${up ? ' up' : ''}${mark ? ' mark' : ''}`;
  const face = <><span className="g-corner"><b>{rankText(card)}</b><Suit s={card[1]} /></span><Suit s={card[1]} big /></>;
  return onClick
    ? <button type="button" className={`${cls} live`} onClick={onClick} title={cardWord(card)} aria-label={cardWord(card)}>{face}</button>
    : <div className={cls} title={cardWord(card)}>{face}</div>;
}
const CardBack = ({ onClick, title, children }: { onClick?: () => void; title?: string; children?: ReactNode }) =>
  onClick ? <button type="button" className="g-card back live" onClick={onClick} title={title}>{children}</button> : <div className="g-card back" title={title}>{children}</div>;

/** My cards in a row. They overlap as far as they need to, to fit; the corner of every one stays in view. */
function Hand({ cards, state, onCard }: { cards: string[]; state: (c: string) => { dim?: boolean; up?: boolean; mark?: boolean; live?: boolean }; onCard: (c: string) => void }) {
  return (
    <div className="g-hand">
      {cards.map((c) => { const st = state(c); return <div className="g-slot" key={c}><CardFace card={c} dim={st.dim} up={st.up} mark={st.mark} onClick={st.live === false ? undefined : () => onCard(c)} /></div>; })}
      {!cards.length && <p className="g-quiet">No cards.</p>}
    </div>
  );
}

/** The cards on the table for this trick, each in front of whoever played it. An empty trick shows the last one taken. */
function Trick({ trick, last, base, name }: { trick: PlayedCard[]; last: LastTrick; base: number; name: (i: number) => string }) {
  const old = !trick.length && last;
  const cards = old ? last.cards : trick;
  return (
    <div className={`g-trick${old ? ' old' : ''}`}>
      {cards.map((p) => <div key={p.card} className={`g-spot ${POS[(p.seat - base + 4) % 4]}${old && last.winner === p.seat ? ' won' : ''}`}><CardFace card={p.card} /></div>)}
      {old && <span className="g-took">{name(last.winner)} took it</span>}
    </div>
  );
}

// ───────── hearts ─────────
function Hearts({ t, g }: { t: GameTable; g: HeartsView }) {
  const name = useNames(t);
  const base = Math.max(0, t.you);
  const mine = t.you >= 0;
  const [picked, setPicked] = useState<string[]>([]);
  useEffect(() => setPicked([]), [g.handNo, g.phase]);
  const passing = g.phase === 'pass' && mine && !g.myPass;
  const myTurn = g.phase === 'play' && g.turn === t.you;
  const to = (base + { left: 1, right: 3, across: 2, hold: 0 }[g.passDir]) % 4;
  const click = (c: string) => {
    if (passing) setPicked((p) => (p.includes(c) ? p.filter((x) => x !== c) : p.length < 3 ? [...p, c] : p));
    else if (myTurn) gameOp('move', { m: { play: c } });
  };
  let status: ReactNode;
  if (g.phase === 'pass') status = !mine ? 'Everyone is choosing three cards to pass.' : g.myPass ? 'Passed. Waiting for the others.' : `Pick three cards to pass ${g.passDir} to ${name(to)}.`;
  else if (g.phase === 'play') status = myTurn ? (g.trick.length ? 'Your turn: play a card.' : g.legal.length === 1 && g.legal[0] === '2C' ? 'You lead with the two of clubs.' : 'Your turn: lead a card.') : `Waiting for ${name(g.turn)}.`;
  return (
    <div className="g-cards">
      <div className="g-felt">
        {[1, 2, 3].map((d) => { const seat = (base + d) % 4; return <Plate key={d} t={t} seat={seat} pos={POS[d]}>{g.counts[seat]} cards · {g.taken[seat]} {g.taken[seat] === 1 ? 'point' : 'points'}{g.phase === 'pass' && g.passed[seat] ? ' · passed' : ''}</Plate>; })}
        <div className="g-mid">
          {g.phase === 'play' && <Trick trick={g.trick} last={g.last} base={base} name={name} />}
          {(g.phase === 'handEnd' || g.phase === 'over') && g.summary && (
            <Between t={t} title={g.summary.moon >= 0 ? `${name(g.summary.moon)} shot the moon` : `Hand ${g.handNo + 1}`}>
              <table className="g-table"><tbody>{t.seats.map((_, i) => <tr key={i}><td>{name(i)}</td><td>+{g.summary!.points[i]}</td><td><b>{g.scores[i]}</b></td></tr>)}</tbody></table>
            </Between>
          )}
        </div>
        <div className="g-bottom">
          <Plate t={t} seat={base}>{g.taken[base]} {g.taken[base] === 1 ? 'point' : 'points'} this hand</Plate>
          <p className={`g-status${myTurn || passing ? ' go' : ''}`}>{status}</p>
          {passing && <button className="primary" disabled={picked.length !== 3} onClick={() => gameOp('move', { m: { pass: picked } })}>Pass {picked.length} of 3</button>}
          {mine && <Hand cards={g.hand} onCard={click}
            state={(c) => ({ up: picked.includes(c) || !!g.myPass?.includes(c), mark: !!g.received?.includes(c), dim: myTurn && !g.legal.includes(c), live: passing || myTurn })} />}
          {mine && g.received && g.phase === 'play' && <p className="g-quiet">The marked cards are the ones you were passed.</p>}
        </div>
      </div>
      <Side title="Hearts">
        <table className="g-table"><tbody>{t.seats.map((_, i) => <tr key={i} className={g.turn === i ? 'turn' : ''}><td>{name(i)}</td><td><b>{g.scores[i]}</b></td></tr>)}</tbody></table>
        <p className="g-quiet">Lowest score wins when somebody reaches {g.target}.</p>
        <p className="g-quiet">Hearts {g.broken ? 'are broken: they can be led.' : 'cannot be led yet.'}</p>
        <p className="g-quiet"><Suit s="H" /> 1 point each. Queen of <Suit s="S" /> 13.</p>
      </Side>
    </div>
  );
}

// ───────── spades ─────────
const bidText = (b: number | null) => (b === null ? 'no bid yet' : b === 0 ? 'bid nil' : `bid ${b}`);
function Spades({ t, g }: { t: GameTable; g: SpadesView }) {
  const name = useNames(t);
  const base = Math.max(0, t.you);
  const mine = t.you >= 0;
  const myTurn = g.turn === t.you && mine;
  const line = (seat: number) => <>{bidText(g.bids[seat])}{g.phase !== 'bid' ? ` · won ${g.won[seat]}` : ''}{g.dealer === seat ? ' · dealer' : ''}</>;
  let status: ReactNode = '';
  if (g.phase === 'bid') status = myTurn ? 'Your bid: how many tricks will you take?' : `Waiting for ${name(g.turn)} to bid.`;
  else if (g.phase === 'play') status = myTurn ? (g.trick.length ? 'Your turn: play a card.' : 'Your turn: lead a card.') : `Waiting for ${name(g.turn)}.`;
  const sides = [0, 1].map((s) => `${name(s)} and ${name(s + 2)}`);
  return (
    <div className="g-cards">
      <div className="g-felt">
        {[1, 2, 3].map((d) => { const seat = (base + d) % 4; return <Plate key={d} t={t} seat={seat} pos={POS[d]}>{d === 2 && mine ? 'your partner · ' : ''}{line(seat)}</Plate>; })}
        <div className="g-mid">
          {g.phase === 'play' && <Trick trick={g.trick} last={g.last} base={base} name={name} />}
          {g.phase === 'bid' && myTurn && (
            <div className="g-bids">
              <button onClick={() => gameOp('move', { m: { bid: 0 } })} title="Nil: you will take no tricks at all. Worth 100 if you manage it, minus 100 if you take even one.">Nil</button>
              {Array.from({ length: 13 }, (_, i) => <button key={i} onClick={() => gameOp('move', { m: { bid: i + 1 } })}>{i + 1}</button>)}
            </div>
          )}
          {(g.phase === 'handEnd' || g.phase === 'over') && g.summary && (
            <Between t={t} title={`Hand ${g.handNo + 1}`}>
              <table className="g-table"><tbody>{[0, 1].map((s) => <tr key={s}><td>{sides[s]}<small>{g.summary!.lines[s].join('. ')}</small></td><td>{g.summary!.points[s] >= 0 ? '+' : ''}{g.summary!.points[s]}</td><td><b>{g.scores[s]}</b></td></tr>)}</tbody></table>
            </Between>
          )}
        </div>
        <div className="g-bottom">
          <Plate t={t} seat={base}>{line(base)}</Plate>
          <p className={`g-status${myTurn && g.phase !== 'handEnd' ? ' go' : ''}`}>{status}</p>
          {mine && <Hand cards={g.hand} onCard={(c) => gameOp('move', { m: { play: c } })} state={(c) => ({ dim: g.phase === 'play' && myTurn && !g.legal.includes(c), live: g.phase === 'play' && myTurn })} />}
        </div>
      </div>
      <Side title="Spades">
        <table className="g-table"><tbody>{[0, 1].map((s) => <tr key={s} className={mine && t.you % 2 === s ? 'ours' : ''}><td>{sides[s]}<small>{g.bags[s]} {g.bags[s] === 1 ? 'bag' : 'bags'}</small></td><td><b>{g.scores[s]}</b></td></tr>)}</tbody></table>
        <p className="g-quiet">First side to {g.target} wins. A side that falls to {g.floor} loses.</p>
        <p className="g-quiet"><Suit s="S" /> are trumps. They {g.broken ? 'are broken: they can be led.' : 'cannot be led yet.'}</p>
        <p className="g-quiet">Ten bags cost 100.</p>
      </Side>
    </div>
  );
}

// ───────── rummy ─────────
const rummyRank = (c: string) => 'A23456789TJQK'.indexOf(c[0]) + 1;
/** Whether these cards make a set or a run (the server decides; this only lights the button). */
function isMeld(cards: string[]) {
  if (cards.length < 3) return false;
  if (cards.every((c) => c[0] === cards[0][0])) return true;
  if (!cards.every((c) => c[1] === cards[0][1])) return false;
  const v = cards.map(rummyRank).sort((a, b) => a - b);
  return v.every((x, i) => i === 0 || x === v[i - 1] + 1);
}
const fitsMeld = (card: string, m: RummyMeld) => {
  if (m.kind === 'set') return card[0] === m.cards[0][0];
  const v = m.cards.map(rummyRank);
  return card[1] === m.cards[0][1] && (rummyRank(card) === Math.min(...v) - 1 || rummyRank(card) === Math.max(...v) + 1);
};
function Rummy({ t, g }: { t: GameTable; g: RummyView }) {
  const name = useNames(t);
  const base = Math.max(0, t.you);
  const mine = t.you >= 0;
  const [picked, setPicked] = useState<string[]>([]);
  const [byRank, setByRank] = useState(false);
  const hand = byRank ? [...g.hand].sort((a, b) => rummyRank(a) - rummyRank(b) || SUIT_AT[a[1]] - SUIT_AT[b[1]]) : g.hand;
  const held = picked.filter((c) => g.hand.includes(c));
  const myTurn = mine && g.turn === t.you;
  const drawing = myTurn && g.phase === 'draw', playing = myTurn && g.phase === 'play';
  useEffect(() => { if (!playing) setPicked([]); }, [playing]);
  const one = held.length === 1 ? held[0] : null;
  const discard = () => { if (one) gameOp('move', { m: { discard: one } }); else tableNote('Pick one card from your hand to discard.'); };
  let status = '';
  if (drawing) status = 'Your turn: draw from the stock or take the top discard.';
  else if (playing) status = 'Your turn: lay down, lay off, then discard.';
  else if (g.phase === 'draw' || g.phase === 'play') status = `Waiting for ${name(g.turn)}.`;
  const sum = g.summary;
  return (
    <div className="g-cards">
      <div className="g-felt rummy">
        <div className="g-others">{t.seats.map((_, i) => i).filter((i) => i !== base).map((i) => <Plate key={i} t={t} seat={i}>{g.counts[i]} cards{g.dealer === i ? ' · dealer' : ''}</Plate>)}</div>
        <div className="g-mid">
          {(g.phase === 'handEnd' || g.phase === 'over') && sum ? (
            <Between t={t} title={sum.winner < 0 ? 'The stock ran out: nobody scores' : sum.blocked ? `The stock ran out: ${name(sum.winner)} holds least` : `${name(sum.winner)} went out`}>
              <table className="g-table"><tbody>{t.seats.map((_, i) => <tr key={i}><td>{name(i)}<small>{i === sum.winner ? `scores ${sum.points}` : `left holding ${sum.left[i]}`}</small></td><td><b>{g.scores[i]}</b></td></tr>)}</tbody></table>
            </Between>
          ) : (
            <>
              <div className="g-piles">
                <div className="g-pile"><CardBack onClick={drawing ? () => gameOp('move', { m: { draw: 'stock' } }) : undefined} title="The stock"><b>{g.stock}</b></CardBack><small>Stock</small></div>
                <div className="g-pile">
                  {g.top ? <CardFace card={g.top} onClick={drawing ? () => gameOp('move', { m: { draw: 'discard' } }) : playing ? discard : undefined} /> : <button type="button" className="g-card empty" disabled={!playing} onClick={discard} />}
                  <small>{playing ? 'Discard here' : 'Discards'}</small>
                </div>
              </div>
              <div className="g-melds">
                {g.melds.map((m, i) => {
                  const ok = playing && one !== null && fitsMeld(one, m);
                  return <button type="button" key={i} className={`g-meld${ok ? ' ok' : ''}`} disabled={!playing} title={playing ? 'Pick one card from your hand, then click the meld it fits' : m.kind === 'set' ? 'A set' : 'A run'}
                    onClick={() => { if (one) gameOp('move', { m: { layoff: one, on: i } }); else tableNote('Pick one card from your hand first, then the meld to add it to.'); }}>
                    {m.cards.map((c) => <span key={c} className={`g-chip${isRed(c) ? ' red' : ''}`}>{rankText(c)}<Suit s={c[1]} /></span>)}
                  </button>;
                })}
                {!g.melds.length && <p className="g-quiet">Nothing laid down yet.</p>}
              </div>
            </>
          )}
        </div>
        <div className="g-bottom">
          <Plate t={t} seat={base}>{g.counts[base]} cards{g.dealer === base ? ' · dealer' : ''}</Plate>
          <p className={`g-status${myTurn ? ' go' : ''}`}>{status}</p>
          {mine && (g.phase === 'draw' || g.phase === 'play') && (
            <div className="g-acts">
              <button className="primary" disabled={!playing || !isMeld(held)} onClick={() => { gameOp('move', { m: { meld: held } }); setPicked([]); }} title="Three or four of a rank, or three or more in a row in one suit (ace is low)">Lay down</button>
              <button disabled={!playing || !one || (one === g.took && g.hand.length > 1)} onClick={discard} title={one && one === g.took ? 'You cannot discard the card you just picked up from the pile' : 'Ends your turn'}>Discard</button>
              <button onClick={() => setByRank(!byRank)} title="How your hand is sorted">Sort by {byRank ? 'suit' : 'rank'}</button>
            </div>
          )}
          {mine && <Hand cards={hand} onCard={(c) => setPicked((p) => (p.includes(c) ? p.filter((x) => x !== c) : [...p, c]))} state={(c) => ({ up: held.includes(c), mark: c === g.took, live: playing })} />}
        </div>
      </div>
      <Side title="Rummy">
        <table className="g-table"><tbody>{t.seats.map((_, i) => <tr key={i} className={g.turn === i ? 'turn' : ''}><td>{name(i)}</td><td><b>{g.scores[i]}</b></td></tr>)}</tbody></table>
        <p className="g-quiet">First to {g.target} wins.</p>
        <p className="g-quiet">Going out scores the cards left in the other hands: face cards 10, aces 1.</p>
        <p className="g-quiet">Sets: 3 or 4 of a rank. Runs: 3 or more in a row in one suit, ace low.</p>
      </Side>
    </div>
  );
}

// ───────── boards ─────────
/** Draw offers and resigning, the same for both board games. */
function BoardButtons({ t, offer }: { t: GameTable; offer: number | null }) {
  const name = useNames(t);
  if (t.phase !== 'playing' || t.you < 0) return null;
  return (
    <div className="g-acts col">
      {offer === 1 - t.you && <p className="g-status go">{name(offer)} offers a draw.</p>}
      {offer === 1 - t.you
        ? <><button className="primary" onClick={() => gameOp('move', { m: { a: 'accept' } })}>Accept the draw</button><button onClick={() => gameOp('move', { m: { a: 'decline' } })}>Play on</button></>
        : <button disabled={offer === t.you} onClick={() => gameOp('move', { m: { a: 'offer' } })}>{offer === t.you ? 'Draw offered' : 'Offer a draw'}</button>}
      <SureButton onSure={() => gameOp('move', { m: { a: 'resign' } })} title="Give up this game">Resign</SureButton>
    </div>
  );
}

const PIECE_AT = 'pnbrqk';
const PIECE_WORD: Record<string, string> = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
function ChessPiece({ p }: { p: string }) {
  const white = p === p.toUpperCase();
  return <i className="g-piece chess" title={`${white ? 'White' : 'Black'} ${PIECE_WORD[p.toLowerCase()]}`} style={{ backgroundPosition: `${PIECE_AT.indexOf(p.toLowerCase()) * 20}% ${white ? 0 : 100}%` }} />;
}
function Chess({ t, g }: { t: GameTable; g: ChessView }) {
  const name = useNames(t);
  const area = useRef<HTMLDivElement>(null);
  const sq = useSquare(area);
  const [sel, setSel] = useState<number | null>(null);
  const [promo, setPromo] = useState<{ from: number; to: number } | null>(null);
  useEffect(() => { setSel(null); setPromo(null); }, [g.ply]);
  const flip = t.you === 1;
  const myTurn = t.phase === 'playing' && g.turn === t.you;
  const targets = sel !== null ? g.legal[sel] ?? [] : [];
  const click = (i: number) => {
    if (!myTurn || promo) return;
    if (sel !== null && targets.includes(i)) {
      const pawn = g.board[sel].toLowerCase() === 'p';
      if (pawn && (i < 8 || i > 55)) setPromo({ from: sel, to: i });
      else gameOp('move', { m: { from: sel, to: i } });
      return;
    }
    if (g.legal[i]) setSel(sel === i ? null : i);
    else {
      setSel(null);
      const p = g.board[i];
      if (p !== '.' && (p === p.toUpperCase()) === (t.you === 0)) tableNote(g.check ? 'You are in check: that piece cannot help.' : 'That piece has no move.');
    }
  };
  const king = g.check ? g.board.indexOf(g.turn === 0 || (g.turn < 0 && t.result?.winners[0] === 1) ? 'K' : 'k') : -1;
  const order = Array.from({ length: 64 }, (_, i) => (flip ? 63 - i : i));
  const pairs: string[][] = [];
  g.log.forEach((m, i) => { const n = g.ply - g.log.length + i; if (n % 2 === 0 || !pairs.length) pairs.push([`${Math.floor(n / 2) + 1}.`, ...(n % 2 ? ['…'] : []), m]); else pairs[pairs.length - 1].push(m); });
  const takenBy = (white: boolean) => [...g.taken].filter((p) => (p === p.toUpperCase()) !== white);
  const plate = (seat: number) => <Plate t={t} seat={seat}>{seat === 0 ? 'White' : 'Black'}<span className="g-taken">{takenBy(seat === 0).map((p, i) => <ChessPiece key={i} p={p} />)}</span></Plate>;
  return (
    <div className="g-boardgame">
      <div className="g-boardarea" ref={area}>
        <div className="g-board" style={{ '--sq': `${sq}px` } as CSSProperties}>
          {order.map((i) => {
            const p = g.board[i], r = i >> 3, f = i & 7;
            const cls = `g-sq ${(r + f) % 2 ? 'dark' : 'light'}${sel === i ? ' sel' : ''}${g.last?.includes(i) ? ' last' : ''}${king === i ? ' check' : ''}${targets.includes(i) ? (p !== '.' ? ' take' : ' go') : ''}${myTurn && g.legal[i] ? ' can' : ''}`;
            return (
              <button type="button" key={i} className={cls} onClick={() => click(i)} aria-label={`${'abcdefgh'[f]}${8 - r}`}>
                {p !== '.' && <ChessPiece p={p} />}
                {f === (flip ? 7 : 0) && <span className="g-rank">{8 - r}</span>}
                {r === (flip ? 0 : 7) && <span className="g-file">{'abcdefgh'[f]}</span>}
              </button>
            );
          })}
          {promo && (
            <div className="g-promo">
              <b>Promote to</b>
              <span>{'qrbn'.split('').map((p) => <button type="button" key={p} title={PIECE_WORD[p]} onClick={() => { gameOp('move', { m: { ...promo, promo: p } }); setPromo(null); }}><ChessPiece p={t.you === 0 ? p.toUpperCase() : p} /></button>)}</span>
              <button type="button" onClick={() => setPromo(null)}>Cancel</button>
            </div>
          )}
        </div>
      </div>
      <Side title="Chess">
        {plate(flip ? 0 : 1)}
        {plate(flip ? 1 : 0)}
        {t.phase === 'playing' && <p className={`g-status${myTurn ? ' go' : ''}`}>{myTurn ? 'Your move.' : `${name(g.turn)} to move.`}{g.check ? ' Check.' : ''}</p>}
        <ol className="g-log">{pairs.slice(-8).map((p) => <li key={p[0]}><i>{p[0]}</i> {p.slice(1).join('  ')}</li>)}</ol>
        <BoardButtons t={t} offer={g.offer} />
      </Side>
    </div>
  );
}

function Checkers({ t, g }: { t: GameTable; g: CheckersView }) {
  const name = useNames(t);
  const area = useRef<HTMLDivElement>(null);
  const sq = useSquare(area);
  const [path, setPath] = useState<number[]>([]);
  useEffect(() => setPath([]), [g.ply]);
  const flip = t.you === 1;
  const myTurn = t.phase === 'playing' && g.turn === t.you;
  const starts = (p: number[], head: number[]) => head.every((x, i) => p[i] === x);
  const next = path.length ? g.legal.filter((p) => starts(p, path)).map((p) => p[path.length]) : [];
  const mustJump = g.legal.length > 0 && Math.abs((g.legal[0][0] >> 3) - (g.legal[0][1] >> 3)) === 2;
  const click = (i: number) => {
    if (!myTurn) return;
    if (path.length && next.includes(i)) {
      const now = [...path, i];
      if (g.legal.some((p) => p.length === now.length && starts(p, now))) gameOp('move', { m: { path: now } });
      else setPath(now);            // a jump that carries on: keep going
      return;
    }
    if (g.legal.some((p) => p[0] === i)) { setPath(path[0] === i && path.length === 1 ? [] : [i]); return; }
    setPath([]);
    const p = g.board[i];
    if (p !== '.' && (p.toLowerCase() === 'r') === (t.you === 0)) tableNote(mustJump ? 'You have to jump when you can.' : 'That piece has no move.');
  };
  const order = Array.from({ length: 64 }, (_, i) => (flip ? 63 - i : i));
  const at = path.length ? path[path.length - 1] : -1;
  const plate = (seat: number) => <Plate t={t} seat={seat}>{seat === 0 ? 'Red' : 'White'} · {g.left[seat]} left</Plate>;
  return (
    <div className="g-boardgame">
      <div className="g-boardarea" ref={area}>
        <div className="g-board checkers" style={{ '--sq': `${sq}px` } as CSSProperties}>
          {order.map((i) => {
            // while a jump is being built, the piece is shown where it has got to
            const p = i === at ? g.board[path[0]] : path.length > 1 && i === path[0] ? '.' : g.board[i];
            const r = i >> 3, f = i & 7;
            const cls = `g-sq ${(r + f) % 2 ? 'dark' : 'light'}${at === i ? ' sel' : ''}${g.last?.includes(i) ? ' last' : ''}${next.includes(i) ? ' go' : ''}${myTurn && !path.length && g.legal.some((x) => x[0] === i) ? ' can' : ''}`;
            return (
              <button type="button" key={i} className={cls} onClick={() => click(i)} disabled={(r + f) % 2 === 0}>
                {p !== '.' && <i className="g-piece disc" title={`${p.toLowerCase() === 'r' ? 'Red' : 'White'}${p === p.toUpperCase() ? ' king' : ''}`} style={{ backgroundPosition: `${('rRwW'.indexOf(p) * 100) / 3}% 0` }} />}
              </button>
            );
          })}
        </div>
      </div>
      <Side title="Checkers">
        {plate(flip ? 0 : 1)}
        {plate(flip ? 1 : 0)}
        {t.phase === 'playing' && <p className={`g-status${myTurn ? ' go' : ''}`}>{myTurn ? (path.length > 1 ? 'Keep jumping.' : mustJump ? 'Your move: you have to jump.' : 'Your move.') : `${name(g.turn)} to move.`}</p>}
        <p className="g-quiet">Jumps must be taken. A piece that reaches the far row is crowned and can move backwards.</p>
        <BoardButtons t={t} offer={g.offer} />
      </Side>
    </div>
  );
}

// ───────── picking a game, and the seats ─────────
function GameIcon({ kind }: { kind: GameKind }) {
  if (kind === 'hearts') return <Suit s="H" big />;
  if (kind === 'spades') return <Suit s="S" big />;
  if (kind === 'rummy') return <Mark name="cards" />;
  if (kind === 'mancala') return <Mark name="pits" />;
  return <Mark name={kind} />;      // (chess, checkers, go, four, mahjong: plain grey marks like the rest of the list)
}
/** Every game, in one list: the card table's (picked here, played here), then the game room's and cornhole (picking one
 *  goes there). While the card table has a game on it, that one says so and opens it, and the others wait for it. */
function Picker({ onTable }: { onTable: () => void }) {
  const t = useStore((s) => s.table);
  const busy = t?.kind && t.phase !== 'over' ? t.kind : null;
  return (
    <div className="g-picker">
      <div className="g-tiles">
        {KINDS.map((k) => (
          <button key={k} className={`g-tile${busy === k ? ' on' : ''}`} disabled={!!busy && busy !== k} title={busy && busy !== k ? `The card table has ${GAME_NAMES[busy]} on it` : undefined}
            onClick={() => (busy === k ? onTable() : (gameOp('pick', { kind: k }), onTable()))}>
            <GameIcon kind={k} />
            <b>{GAME_NAMES[k]}</b>
            <small>Card table · {BLURB[k][0]}</small>
            {busy === k ? <em>{t?.phase === 'lobby' ? 'Taking seats: join in' : 'On now: watch or play'}</em> : <span>{BLURB[k][1]}</span>}
          </button>
        ))}
        {AWAY.map((g) => (
          <button key={g.id} className="g-tile" onClick={() => playAway(g)}>
            <Mark name={g.mark} />
            <b className={g.name.split(' ').some((w) => w.length > 10) ? 'long' : undefined}>{g.name}</b>
            <small>{g.where} · {g.who}</small>
            <span>{g.blurb}</span>
          </button>
        ))}
      </div>
      <p className="g-quiet">The card table plays one game at a time, here. The game room's are down in the basement, cornhole out at the campsite, fishing at the lake, beer pong, horseshoes and bocce in the backyard, sudoku in the bathroom: picking one takes you there.</p>
    </div>
  );
}
function Lobby({ t }: { t: GameTable }) {
  const kind = t.kind!;
  const name = useNames(t);
  const users = useStore((s) => s.users);
  const k = useContext(Scale);
  const labels = SEAT_LABELS[kind];
  // (a game the server has and this copy of the app has not, until it is reloaded: the seats can still be drawn)
  const blurb = BLURB[kind] ?? ['A new game', 'This copy of the app does not know it yet: reload to play it.'];
  const filled = t.seats.filter((s) => s.bot || s.userId).length;
  const exact = t.bots && t.min === t.seats.length;           // the computer fills whatever seats are left
  const ready = t.you >= 0 && (exact || filled >= t.min);
  const why = t.you < 0 ? 'Take a seat to start.' : ready ? '' : t.bots ? `This needs ${t.min} players: add a computer player.` : `This needs ${t.min} people.`;
  return (
    <div className="g-lobby">
      <h3><GameIcon kind={kind} /> {GAME_NAMES[kind]}</h3>
      <p className="g-quiet">{blurb[0]}. {blurb[1]}</p>
      <div className={`g-seats n${t.seats.length}`}>
        {t.seats.map((s, i) => (
          <div key={i} className={`g-seat${s.userId || s.bot ? ' taken' : ''}${i === t.you ? ' me' : ''}`}>
            <small>{labels ? labels[i] : `Seat ${i + 1}`}</small>
            {s.bot ? <span className="g-bot"><Mark name="robot" /></span> : s.userId ? <Avatar user={users[s.userId]} size={16 * k} /> : <span className="g-bot empty" />}
            <b>{s.userId || s.bot ? name(i) : 'Empty'}</b>
            <span className="g-acts">
              {i !== t.you && !s.userId && <button className={t.you < 0 ? 'primary' : ''} onClick={() => gameOp('sit', { seat: i })}>{t.you < 0 ? 'Sit here' : 'Move here'}</button>}
              {i === t.you && <button onClick={() => gameOp('stand')}>Stand up</button>}
              {t.bots && !s.userId && <button onClick={() => gameOp('bot', { seat: i })}>{s.bot ? 'Remove' : 'Computer'}</button>}
            </span>
          </div>
        ))}
      </div>
      <div className="g-acts">
        <button className="primary big" disabled={!ready} onClick={() => gameOp('start')} title={why}>Start</button>
        <button onClick={() => gameOp('pick', { kind: null })}>Pick another game</button>
      </div>
      {kind === 'mahjong' && <p className="g-quiet">New to it? Press <b>How to play</b> at the top, then start a game against the computer: the coach explains each turn.</p>}
      <p className="g-quiet">{why || (exact && filled < t.seats.length ? 'Empty seats will be played by the computer.' : kind === 'rummy' && filled < 4 ? 'Empty seats are left out.' : 'Ready when you are.')}</p>
    </div>
  );
}

/** Who won, once it is over, with the way back. */
function Result({ t }: { t: GameTable }) {
  const name = useNames(t);
  const r = t.result;
  if (t.phase !== 'over' || !r) return null;
  const who = r.winners.map(name);
  const line = !who.length ? r.text : `${who.length > 1 ? `${who.slice(0, -1).join(', ')} and ${who[who.length - 1]} win` : `${who[0]} wins`}: ${r.text}`;
  return (
    <div className="g-result">
      <b>{line}</b>
      {t.you >= 0 && <button className="primary" onClick={() => gameOp('again')}>Play again</button>}
      {t.you >= 0 ? <button onClick={() => gameOp('end')}>Back to the seats</button> : <span className="g-quiet">The players can deal again.</span>}
    </div>
  );
}

export function Games() {
  const t = useStore((s) => s.table);
  const note = useStore((s) => s.tableNote);
  const users = useStore((s) => s.users);
  const [k, setK] = useState(2);
  const [guide, setGuide] = useState(false);
  // the list of games, or the card table's game (shown to begin with if one is set up or going)
  const [atTable, setAtTable] = useState(() => !!useStore.getState().table?.kind);
  const table = atTable && !!t?.kind;
  useWatching(table ? 'table' : null);       // (watching a game at the card table: "Spectating Chess")
  const area = useRef<HTMLDivElement>(null);
  useEffect(() => { gameOp('sync'); }, []);         // in case a change was missed while this was shut
  // Everything here is sized in whole steps (2 to 6 screen dots to a sprite dot, as many as fit), so the pixel art stays
  // crisp and the cards grow with the window.
  useEffect(() => {
    const el = area.current!;
    const fit = () => setK(Math.max(2, Math.min(6, Math.floor(Math.min(el.clientWidth / 300, el.clientHeight / 236)))));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const g = t?.game;
  const playing = t?.phase === 'playing';
  const noneHere = !!t && !t.seats.some((s) => s.userId && !s.away);
  let about = 'Cards and board games for whoever is around.';
  if (t?.kind) about = t.phase === 'lobby' ? `${GAME_NAMES[t.kind]}: taking seats${t.host && users[t.host] ? ` (set up by ${users[t.host].name})` : ''}` : t.phase === 'over' ? `${GAME_NAMES[t.kind]}: finished` : `${GAME_NAMES[t.kind]}${t.you < 0 ? ': you are watching' : ''}`;
  return (
    <section className="games-view" style={{ '--k': k } as CSSProperties}>
      <header className="bar">
        <h2><Icon name="gamepad" /> Play Games</h2>
        {table && <nav className="g-tabs"><button onClick={() => setAtTable(false)}>All games</button></nav>}
        <small>{table ? about : 'Cards and board games at the table, the game room downstairs, and the games outside'}</small>
        {table && t?.kind === 'mahjong' && <button onClick={() => setGuide(!guide)} title="The tiles, the sets, a turn, claiming, winning and the points">How to play</button>}
        {table && playing && t.you >= 0 && t.bots && <SureButton onSure={() => gameOp('stand')} title="Get up from the table. The computer plays your cards on, and you can take the seat back.">Leave my seat</SureButton>}
        {table && playing && (t.you >= 0 || noneHere) && <SureButton onSure={() => gameOp('end')} title="Stop this game for everyone and go back to the seats">End the game</SureButton>}
        <button onClick={() => useStore.setState({ view: { kind: 'hangout' } })}>Back to the room</button>
      </header>
      <div className="g-area" ref={area}>
        <Scale.Provider value={k}>
        {!table ? <Picker onTable={() => setAtTable(true)} />
          : !t ? <p className="g-quiet">Setting the table…</p>
          : t.phase === 'lobby' || !g ? <Lobby t={t} />
          : (
            <>
              <Result t={t} />
              {t.kind === 'hearts' && <Hearts t={t} g={g as HeartsView} />}
              {t.kind === 'spades' && <Spades t={t} g={g as SpadesView} />}
              {t.kind === 'rummy' && <Rummy t={t} g={g as RummyView} />}
              {t.kind === 'chess' && <Chess t={t} g={g as ChessView} />}
              {t.kind === 'checkers' && <Checkers t={t} g={g as CheckersView} />}
              {t.kind === 'mahjong' && <Mahjong t={t} g={g as MahjongView} />}
              {t.kind === 'go' && <Go t={t} g={g as GoView} />}
              {t.kind === 'four' && <Four t={t} g={g as FourView} />}
              {t.kind === 'mancala' && <Mancala t={t} g={g as MancalaView} />}
            </>
          )}
        </Scale.Provider>
      </div>
      {note && <div className="g-note" role="status">{note}</div>}
      {guide && t?.kind === 'mahjong' && <MahjongGuide onClose={() => setGuide(false)} />}
    </section>
  );
}
