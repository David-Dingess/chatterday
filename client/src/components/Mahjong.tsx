// Mahjong at the game table, built for people who are learning it. The rules are the server's
// (server/games/mahjong.ts); this draws the table, and adds two things for a learner:
//   - the coach: a line under the table saying how far the hand is from ready, which throw it suggests and what a
//     claim would do. The sums come from the server with the hand (`hint`); this only puts them into words. It can be
//     switched off at the side, and stays off or on between visits.
//   - the guide (How to play, at the top): the tiles, the sets, a turn, claiming, winning and the points, on one page.
import { useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { gameOp, tableNote } from '../store';
import type { GameTable, MahjongThrow, MahjongView } from '../types';
import { Between, Plate, Side, useNames } from './GameParts';

const SUITS = ['dots', 'bamboo', 'characters'];
const HONOURS = ['East wind', 'South wind', 'West wind', 'North wind', 'Red dragon', 'Green dragon', 'White dragon'];
const WINDS = ['East', 'South', 'West', 'North'];
export const tileName = (t: number) => (t < 0 ? 'a tile lying face down' : t < 27 ? `${(t % 9) + 1} of ${SUITS[Math.floor(t / 9)]}` : HONOURS[t - 27]);
const many = (n: number, one: string, more = `${one}s`) => `${n} ${n === 1 ? one : more}`;
/** "2 tiles from ready", "ready". */
const awayText = (n: number) => (n <= 0 ? 'ready: one tile from winning' : `${many(n, 'tile')} from ready`);

/** One tile, from our sprite sheet. `t` below zero is a tile lying face down. */
export function Tile({ t, small = false, onClick, cls = '', title }: { t: number; small?: boolean; onClick?: () => void; cls?: string; title?: string }) {
  const style = { '--i': t < 0 ? 34 : t } as CSSProperties;
  const c = `mj-tile${small ? ' small' : ''}${cls ? ` ${cls}` : ''}`;
  const say = title ?? tileName(t);
  return onClick
    ? <button type="button" className={`${c} live`} style={style} onClick={onClick} title={say} aria-label={say} />
    : <i className={c} style={style} title={say} />;
}
const Tiles = ({ tiles, small = true }: { tiles: number[]; small?: boolean }) => <span className="mj-row">{tiles.map((x, i) => <Tile key={i} t={x} small={small} />)}</span>;

function useCoach(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => { try { return localStorage.getItem('chatterday.mahjongCoach') !== 'off'; } catch { return true; } });
  return [on, (v) => { setOn(v); try { localStorage.setItem('chatterday.mahjongCoach', v ? 'on' : 'off'); } catch { /* it just will not be remembered */ } }];
}

export function Mahjong({ t, g }: { t: GameTable; g: MahjongView }) {
  const name = useNames(t);
  const base = Math.max(0, t.you);
  const mine = t.you >= 0;
  const [coach, setCoach] = useCoach();
  /** The place in my hand of the tile I have lifted, ready to throw. */
  const [sel, setSel] = useState(-1);
  useEffect(() => setSel(-1), [g.hand.join(), g.phase]);
  const myTurn = mine && g.phase === 'turn' && g.turn === t.you;
  const offer = g.claim?.mine ?? null;
  const windOf = (seat: number) => (seat - g.dealer + 4) % 4;

  // my hand, with the tile I have just drawn set a little apart at the end
  const hand = g.hand.slice();
  const drewAt = myTurn && g.drew !== null ? hand.lastIndexOf(g.drew) : -1;
  if (drewAt >= 0) hand.push(hand.splice(drewAt, 1)[0]);
  const lifted = sel >= 0 && sel < hand.length ? hand[sel] : -1;
  const throws = g.hint?.throws ?? [];
  const best: MahjongThrow | undefined = throws[0];
  const throwIt = (tile: number) => gameOp('move', { m: { discard: tile } });
  const clickTile = (i: number) => {
    if (!myTurn) return tableNote(g.phase === 'claim' && offer ? 'Claim the tile or pass first.' : 'You throw a tile on your own turn, after drawing.');
    if (sel === i) throwIt(hand[i]); else setSel(i);
  };
  const claim = (what: string, use?: number[]) => gameOp('move', { m: { claim: what, use } });

  // ── what is going on, in a line ──
  let status = '';
  if (g.phase === 'turn') {
    if (myTurn) status = g.can?.win ? 'Your hand is finished: press Win!' : g.drew !== null ? `You drew the ${tileName(g.drew)}. Throw a tile away.` : 'You claimed a tile: now throw one away.';
    else status = `Waiting for ${name(g.turn)}.`;
  } else if (g.phase === 'claim' && g.claim) {
    const thrown = `${name(g.claim.from)} threw the ${tileName(g.claim.tile)}`;
    status = offer ? `${thrown}. You can claim it.` : g.claim.answered ? `${thrown}. Waiting for the others.` : `${thrown}. Waiting to see if anybody wants it.`;
  }
  const said = g.said && g.phase === 'turn' ? `${name(g.said.seat)} called ${g.said.what} with the ${tileName(g.said.tile)}.` : '';

  // ── the coach ──
  let advice: ReactNode = null;
  if (coach && mine && g.hint && (g.phase === 'turn' || g.phase === 'claim')) {
    const h = g.hint;
    if (myTurn && g.can?.win) advice = <>Four sets and a pair: you have won. Press <b>Win!</b></>;
    else if (myTurn && best) {
      const th = lifted >= 0 ? throws.find((x) => x.tile === lifted) : undefined;
      if (th) {
        const verdict = th.away > best.away ? `That is a step backwards: the ${tileName(best.tile)} keeps you ${awayText(best.away)}.`
          : th.left < best.left ? `Fine, but the ${tileName(best.tile)} leaves more to hope for (${many(best.left, 'tile')}).` : 'A good throw.';
        advice = <>Throwing the {tileName(th.tile)} leaves you <b>{awayText(th.away)}</b>, with {many(th.left, 'tile')} still out there that would help{th.helps.length ? <>: <Tiles tiles={th.helps} /></> : '.'} {verdict} Click it again to throw it.</>;
      } else {
        advice = <>You are <b>{awayText(best.away)}</b> if you throw the <b>{tileName(best.tile)}</b> (the tile with the bar under it): that leaves the most tiles that help, {best.left}. Click a tile to see what throwing it would do.</>;
      }
    } else if (offer && g.claim) {
      const now = h.away, bits: string[] = [];
      const closer = (after: number | null) => (after === null || after >= now ? 'does not bring you closer' : after <= 0 ? 'makes you ready' : `brings you closer (${awayText(after)})`);
      if (offer.win) bits.push('It finishes your hand: press Win!');
      else {
        if (offer.kong) bits.push(`A kong ${offer.after.kong !== null && offer.after.kong <= now ? 'costs you nothing and earns an extra tile' : 'would break up something you need'}.`);
        if (offer.pung) bits.push(`A pung ${closer(offer.after.pung)}.`);
        offer.chows.forEach((p, i) => bits.push(`A chow with your ${tileName(p[0])} and ${tileName(p[1])} ${closer(offer.after.chows[i])}.`));
        bits.push('Claiming lays that set face up for everyone to see, and gives up the extra faan for a concealed hand. If it does not bring you closer, pass.');
      }
      advice = <>You are {awayText(now)}. {bits.join(' ')}</>;
    } else if (h.tiles) {
      advice = h.away <= 0
        ? <>You are <b>ready</b>. You win on: <Tiles tiles={h.tiles} /> ({h.left} left that you cannot see). If somebody throws one, claim it to win.</>
        : <>You are <b>{awayText(h.away)}</b>. Tiles that would bring you closer: <Tiles tiles={h.tiles} /> ({h.left} left).</>;
    }
  }

  // ── a seat: who, their sets laid down, and what they have thrown away ──
  const strip = (seat: number, note: string) => {
    const wind = windOf(seat);
    const quiet = { ...t, turn: g.phase === 'claim' ? [] : t.turn };       // (who is thinking about a claim is not for showing)
    return (
      <div className={`mj-strip${seat === t.you ? ' me' : ''}`} key={seat}>
        <Plate t={quiet} seat={seat}>{WINDS[wind]}{wind === 0 ? ' · dealer' : ''} · {many(g.counts[seat], 'tile')}{note ? ` · ${note}` : ''}</Plate>
        <div className="mj-laid">
          {g.melds[seat].length > 0 && (
            <div className="mj-melds">
              {g.melds[seat].map((m, i) => (
                <span className="mj-meld" key={i} title={`${m.kind[0].toUpperCase()}${m.kind.slice(1)}${m.open ? '' : ' (kept face down)'}`}>
                  {(m.tiles.length ? m.tiles : [-1, -1, -1, -1]).map((x, j) => <Tile key={j} t={m.open || !m.tiles.length ? x : j === 0 || j === 3 ? -1 : x} small />)}
                </span>
              ))}
            </div>
          )}
          <div className="mj-pool">
            {g.discards[seat].map((x, i) => <Tile key={i} t={x} small cls={g.last?.seat === seat && i === g.discards[seat].length - 1 ? 'fresh' : ''} />)}
            {!g.discards[seat].length && <span className="g-quiet">Nothing thrown yet.</span>}
          </div>
        </div>
      </div>
    );
  };

  const sum = g.phase === 'handEnd' || g.phase === 'over' ? g.summary : null;
  const ended = !!sum;
  return (
    <div className="mj">
      <div className="mj-top">
        <div className="mj-table">
          {sum ? (
            <Between t={t} title={sum.winner < 0 ? 'The wall ran out: nobody wins this hand' : `${name(sum.winner)} wins ${sum.from < 0 ? 'on a tile from the wall' : `on ${name(sum.from)}'s ${tileName(sum.tile)}`}`}>
              {sum.winner >= 0 && (
                <>
                  <div className="mj-won">
                    {sum.sets.length
                      ? <>{sum.sets.map((s, i) => <span className="mj-meld" key={i} title={s.open ? 'Laid down during play' : 'Kept in the hand'}><Tiles tiles={s.tiles} /></span>)}<span className="mj-meld" title="The pair"><Tiles tiles={sum.pair} /></span></>
                      : <Tiles tiles={sum.hands[sum.winner]} />}
                  </div>
                  <table className="g-table"><tbody>
                    {sum.lines.map((l, i) => <tr key={i}><td>{l.name}</td><td>{l.faan} faan</td></tr>)}
                    {!sum.lines.length && <tr><td>A plain hand: no patterns</td><td>0 faan</td></tr>}
                    <tr><td><b>{sum.faan} faan is worth {many(sum.base, 'point')}</b><small>{sum.from < 0 ? 'Drawn from the wall: all three pay double.' : `${name(sum.from)} threw it and pays double; the other two pay single.`}</small></td><td /></tr>
                  </tbody></table>
                </>
              )}
              <table className="g-table"><tbody>
                {t.seats.map((_, i) => (
                  <tr key={i} className={i === sum.winner ? 'turn' : ''}>
                    <td>{name(i)}{i !== sum.winner && <small><Tiles tiles={sum.hands[i]} /></small>}</td>
                    <td>{sum.pay[i] > 0 ? '+' : ''}{sum.pay[i]}</td><td><b>{g.scores[i]}</b></td>
                  </tr>
                ))}
              </tbody></table>
            </Between>
          ) : (
            <>
              {strip((base + 1) % 4, mine ? 'plays after you' : '')}
              {strip((base + 2) % 4, '')}
              {strip((base + 3) % 4, mine ? 'plays before you' : '')}
              {strip(base, '')}
            </>
          )}
        </div>
        <Side title="Mahjong">
          <table className="g-table"><tbody>
            {t.seats.map((_, i) => <tr key={i} className={g.turn === i ? 'turn' : ''}><td>{name(i)}<small>{WINDS[windOf(i)]}{windOf(i) === 0 ? ' · dealer' : ''}</small></td><td><b>{g.scores[i]}</b></td></tr>)}
          </tbody></table>
          <p className="g-quiet">Hand {g.handNo + 1} of {g.hands}. {many(g.wall, 'tile')} left in the wall.</p>
          <div className="g-acts col">
            <button className={coach ? 'primary' : ''} onClick={() => setCoach(!coach)} title="The coach says how far your hand is from winning, suggests a throw, and says what a claim would do. Only you see it.">Coach: {coach ? 'on' : 'off'}</button>
          </div>
          <p className="g-quiet">You need <b>four sets and a pair</b>.</p>
          <p className="g-quiet"><b>Chow</b>: three in a row in one suit. <b>Pung</b>: three the same. <b>Kong</b>: four the same.</p>
          <p className="g-quiet">A thrown tile can be claimed: for a chow only from the player before you, for a pung, a kong or the win from anybody.</p>
        </Side>
      </div>
      {mine && !ended && (
        <div className="mj-mine">
          <p className={`g-status${myTurn || offer ? ' go' : ''}`}>{said && `${said} `}{status}</p>
          {advice && <p className="mj-coach"><b>Coach</b> {advice}</p>}
          <div className="g-acts">
            {offer && g.claim && (
              <>
                <Tile t={g.claim.tile} />
                {offer.win && <button className="primary big" onClick={() => claim('win')}>Win!</button>}
                {offer.kong && <button onClick={() => claim('kong')} title="Take it to make four the same. You get an extra tile.">Kong</button>}
                {offer.pung && <button onClick={() => claim('pung')} title="Take it to make three the same">Pung</button>}
                {offer.chows.map((p, i) => <button key={i} className="mj-chow" onClick={() => claim('chow', p)} title="Take it to make three in a row">Chow <Tiles tiles={[...p, g.claim!.tile].sort((a, b) => a - b)} /></button>)}
                <button onClick={() => claim('pass')}>Pass</button>
              </>
            )}
            {myTurn && g.can?.win && <button className="primary big" onClick={() => gameOp('move', { m: { win: true } })}>Win!</button>}
            {myTurn && g.can?.kongs.map((k) => <button key={k} onClick={() => gameOp('move', { m: { kong: k } })} title="Lay down all four and take an extra tile">Kong: {tileName(k)}</button>)}
            {myTurn && <button disabled={lifted < 0} onClick={() => throwIt(lifted)} title="Or click the lifted tile again">{lifted >= 0 ? `Throw the ${tileName(lifted)}` : 'Pick a tile to throw'}</button>}
          </div>
          <div className="mj-hand">
            {hand.map((x, i) => (
              <Tile key={i} t={x} onClick={() => clickTile(i)}
                cls={`${sel === i ? 'up' : ''}${coach && myTurn && !g.can?.win && best?.tile === x ? ' mark' : ''}${i === hand.length - 1 && drewAt >= 0 ? ' drew' : ''}`}
                title={`${tileName(x)}${i === hand.length - 1 && drewAt >= 0 ? ' (just drawn)' : ''}`} />
            ))}
          </div>
        </div>
      )}
      {!mine && !ended && <p className="g-status">{status}</p>}
    </div>
  );
}

// ───────── the guide ─────────
const FAAN: [string, number][] = [
  ['All chows', 1], ['A pung of dragons (each)', 1], ['A pung of your own wind', 1], ['A pung of East, the wind of the round', 1],
  ['You drew the winning tile yourself', 1], ['Concealed hand: you claimed nothing until the win', 1], ['Won on the extra tile from a kong', 1], ['Won on the very last tile', 1],
  ['All pungs', 3], ['One suit, with winds or dragons', 3], ['Small three dragons: two pungs of dragons and a pair of the third', 5],
  ['Small four winds: three pungs of winds and a pair of the fourth', 6], ['All one suit', 7], ['Great three dragons: a pung of each', 8],
  ['All winds and dragons', 10], ['Great four winds: a pung of each', 13], ['Thirteen orphans', 13],
];
const Example = ({ sets, children }: { sets: number[][]; children?: ReactNode }) => (
  <div className="mj-example">{sets.map((s, i) => <span className="mj-meld" key={i}><Tiles tiles={s} small={false} /></span>)}{children && <small>{children}</small>}</div>
);
const range = (from: number, n: number) => Array.from({ length: n }, (_, i) => from + i);

export function MahjongGuide({ onClose }: { onClose: () => void }) {
  return (
    <div className="mj-guide" role="dialog" aria-label="How to play mahjong">
      <div className="mj-page">
        <header><h3>How to play Mahjong</h3><button className="primary" onClick={onClose}>Close</button></header>

        <h4>The idea</h4>
        <p>Mahjong is rummy with tiles. Four players hold 13 tiles each. On your turn you draw one and throw one away. The first to hold <b>four sets and a pair</b> wins the hand.</p>
        <Example sets={[[0, 1, 2], [12, 13, 14], [24, 24, 24], [27, 27, 27], [31, 31]]}>A winning hand: two runs, two threes of a kind, and a pair.</Example>

        <h4>The tiles</h4>
        <p>There are three suits, each numbered 1 to 9, and four copies of every tile (136 in all).</p>
        <Example sets={[range(0, 9)]}><b>Dots.</b> Count the circles.</Example>
        <Example sets={[range(9, 9)]}><b>Bamboo.</b> Count the sticks. The bird is the 1.</Example>
        <Example sets={[range(18, 9)]}><b>Characters.</b> The top mark is the number in Chinese; the small blue number in the corner says it in ours.</Example>
        <Example sets={[range(27, 4), range(31, 3)]}><b>Winds</b> (East, South, West, North, with a letter in the corner) and <b>dragons</b> (Red, Green, and White, which is the empty frame). These have no numbers, so they can never be in a run.</Example>

        <h4>Sets</h4>
        <Example sets={[[10, 11, 12]]}><b>Chow</b>: three in a row in one suit. No runs through 9 back to 1, and none with winds or dragons.</Example>
        <Example sets={[[5, 5, 5]]}><b>Pung</b>: three of the same tile.</Example>
        <Example sets={[[32, 32, 32, 32]]}><b>Kong</b>: all four of a tile. It counts as one set, and you take an extra tile to make up for the fourth, so you still finish with a pair.</Example>

        <h4>Your turn</h4>
        <p>You draw a tile (the game does it for you; it sits a little apart at the right of your hand). Then throw one away: click a tile to lift it, and click it again to throw it. If the tile you drew finishes your hand, a <b>Win!</b> button appears instead.</p>

        <h4>Claiming a thrown tile</h4>
        <p>When somebody throws a tile you can use, buttons appear before the next player draws:</p>
        <ul>
          <li><b>Chow</b>: only from the player just before you (their seat says "plays before you").</li>
          <li><b>Pung</b> or <b>Kong</b>: from anybody. Play then jumps to you, and the players in between miss their turn.</li>
          <li><b>Win</b>: from anybody, if it is the last tile you need.</li>
        </ul>
        <p>A set you claim is laid face up beside your name. You do not draw that turn: you throw a tile, and play carries on from you. If two people want the same tile, a win beats a pung and a pung beats a chow.</p>

        <h4>Winning and points</h4>
        <p>Here any four sets and a pair wins, however plain. Patterns in the hand add <b>faan</b>, and every faan roughly doubles what it is worth: 0 faan is 1 point, then 2, 4, 8, 16, 24, 32, 48, 64, and on up to 384 at 13 faan, the limit.</p>
        <table className="g-table"><tbody>{FAAN.map(([what, n]) => <tr key={what}><td>{what}</td><td>{n}</td></tr>)}</tbody></table>
        <Example sets={[[0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33, 33]]}><b>Thirteen orphans</b> is the one winning hand with no sets: every 1 and 9, every wind and dragon, and a second of any of them.</Example>
        <p>If you win on a tile somebody threw, they pay double and the other two pay single. If you drew it yourself, all three pay double. The dealer is East, and the deal passes round once: a game is four hands, and the most points wins.</p>

        <h4>The coach</h4>
        <p>With the coach on (at the side of the table), a line under the table tells you how many tiles your hand is from <b>ready</b>, which means one tile from winning. On your turn it puts a bar under the throw it suggests, and lifting any tile shows what throwing that one would leave. When you can claim, it says whether the claim brings you closer. It only ever looks at what you can see yourself.</p>

        <h4>For a first game</h4>
        <ul>
          <li>Keep tiles that are next to each other (a 4 and a 5, a 6 and an 8) and pairs. Throw the loners.</li>
          <li>A lone wind or dragon fits nothing: let those go first, unless you hold two of one.</li>
          <li>The 1s and 9s are worth less than middle tiles: a 5 can be in three different runs, a 9 in only one.</li>
          <li>You do not have to claim everything. A concealed hand scores an extra faan and keeps your choices open.</li>
          <li>Look at what has been thrown. If three of a tile are already out, your pair of it will never be a pung.</li>
        </ul>

        <h4>Other kinds of mahjong</h4>
        <p>This is the Hong Kong game with the flower tiles left out. Japanese (riichi) and American mahjong add rules of their own on top, but the tiles, the sets, the pair, and claiming a thrown tile are the same everywhere.</p>
        <header><span /><button className="primary" onClick={onClose}>Close</button></header>
      </div>
    </div>
  );
}
