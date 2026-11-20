// The whiteboard, opened up to draw on. It is the same picture as the one on the clubhouse wall: everybody sees
// each stroke as it is made, and the server keeps it.
import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { BOARD_H, BOARD_W, ink, INKS, loadBoard, paint, pictDo, pictGuess, pictNow, sendStep, watchBoard, watchPict } from '../board';
import type { Pict } from '../board';
import { useStore } from '../store';
import '../drawguess.css';
import { Icon, SureButton } from './ui';

type Tool = 'pen' | 'eraser' | 'fill';
const NIBS = [1, 2, 4];                 // pen widths, in dots; the eraser is three times as wide
const SEND_EVERY = 200;                 // a stroke is sent on in pieces this often, in ms

export function Board() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const area = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(3);
  const [tool, setTool] = useState<Tool>('pen');
  const [colour, setColour] = useState(1);
  const [nib, setNib] = useState(2);
  const pen = useRef<{ c: number; s: number; k: number; pts: number[]; timer: number } | null>(null);
  const strokes = useRef(Math.floor(Math.random() * 1e6) * 1000);       // numbers my strokes; a random start so two visits do not share numbers
  const [mine, setMine] = useState(0);              // how many things of mine can still be taken back
  const did = () => setMine((n) => Math.min(20, n + 1));
  const undo = () => { if (!mine || pen.current) return; sendStep({ op: 'undo' }); setMine((n) => n - 1); };
  const game = usePict();
  const meId = useStore((s) => s.me?.id);
  // In a game only the drawer draws, and only while the clock runs; what was undoable before it is gone.
  const locked = !!game && (game.phase === 'drawing' || game.phase === 'between') && !(game.phase === 'drawing' && game.drawer === meId);
  const inPlay = !!game && game.phase !== 'over';
  const turnKey = game ? `${game.round}:${game.drawer}:${game.phase}` : '';
  useEffect(() => { setMine(0); up(); }, [turnKey]);   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void loadBoard().catch(() => {});         // in case a stroke was missed while away
    paint(canvas.current);
    return watchBoard(() => paint(canvas.current));
  }, []);
  // The picture is shown at a whole number of screen dots per board dot, as large as fits, so it stays crisp.
  useEffect(() => {
    const el = area.current!;
    const fit = () => setScale(Math.max(1, Math.floor(Math.min((el.clientWidth - 40) / BOARD_W, (el.clientHeight - 40) / BOARD_H))));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const at = (e: ReactPointerEvent): [number, number] => {
    const r = canvas.current!.getBoundingClientRect();
    const clamp = (v: number, max: number) => Math.max(0, Math.min(max, Math.floor(v)));
    return [clamp(((e.clientX - r.left) / r.width) * BOARD_W, BOARD_W - 1), clamp(((e.clientY - r.top) / r.height) * BOARD_H, BOARD_H - 1)];
  };
  const flush = () => {
    const p = pen.current;
    if (!p || p.pts.length < 4) return;
    sendStep({ op: 'line', c: p.c, s: p.s, pts: p.pts, k: p.k });
    p.pts = p.pts.slice(-2);              // the next piece carries on from where this one stopped
  };
  const down = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0 || locked) return;
    up();          // a stroke still open (a second finger went down) is finished first, or its timer would be left running for good
    const [x, y] = at(e);
    if (tool === 'fill') { did(); return sendStep({ op: 'fill', c: colour, x, y }); }
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* the stroke still works, it just stops at the edge */ }
    const c = tool === 'eraser' ? 0 : colour, s = tool === 'eraser' ? nib * 3 : nib;
    ink(c, s, x, y, x, y);
    pen.current = { c, s, k: ++strokes.current, pts: [x, y, x, y], timer: window.setInterval(flush, SEND_EVERY) };
    did();
  };
  const move = (e: ReactPointerEvent) => {
    const p = pen.current;
    if (!p) return;
    const [x, y] = at(e);
    const lx = p.pts[p.pts.length - 2], ly = p.pts[p.pts.length - 1];
    if (x === lx && y === ly) return;
    ink(p.c, p.s, lx, ly, x, y);
    p.pts.push(x, y);
    if (p.pts.length >= 400) flush();
  };
  const up = () => {
    const p = pen.current;
    if (!p) return;
    window.clearInterval(p.timer);
    flush();
    pen.current = null;
  };
  useEffect(() => up, []);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) { e.preventDefault(); undo(); } };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  return (
    <section className="board-view">
      <header className="bar">
        <h2><Icon name="pencil" /> Whiteboard</h2>
        <small>Everyone sees it as you draw, and it stays on the wall.</small>
        <button onClick={() => useStore.setState({ view: { kind: 'hangout' } })}>Back to the room</button>
      </header>
      <DrawGuess game={game} meId={meId ?? ''} />
      <div className={`board-tools${locked ? ' locked' : ''}`}>
        <span className="set">
          {(['pen', 'eraser', 'fill'] as Tool[]).map((t) => (
            <button key={t} className={tool === t ? 'on' : ''} onClick={() => setTool(t)} title={t === 'pen' ? 'Draw' : t === 'eraser' ? 'Erase' : 'Fill an area with the ink'}>{t === 'pen' ? 'Pen' : t === 'eraser' ? 'Eraser' : 'Fill'}</button>
          ))}
        </span>
        <span className="set">
          {NIBS.map((n) => (
            <button key={n} className={`nib${nib === n ? ' on' : ''}`} onClick={() => setNib(n)} title={n === 1 ? 'Fine' : n === 2 ? 'Medium' : 'Thick'}><i style={{ width: n * 3, height: n * 3 }} /></button>
          ))}
        </span>
        <span className="set">
          {INKS.slice(1).map((hex, k) => (
            <button key={hex} className={`ink${colour === k + 1 && tool !== 'eraser' ? ' on' : ''}`} style={{ background: hex }} title="Ink"
              onClick={() => { setColour(k + 1); if (tool === 'eraser') setTool('pen'); }} />
          ))}
        </span>
        <button className="undo" disabled={!mine} onClick={undo} title="Take back the last thing you drew (Ctrl+Z). What others have drawn over it stays.">Undo</button>
        {(!game || game.phase === 'over') && <StartGame />}
        <SureButton className="wipe" title="Wipe the whole board clean, for everyone. Undo brings it back." onSure={() => { did(); sendStep({ op: 'clear' }); }}>Wipe it clean</SureButton>
      </div>
      <div className="board-row">
        <div className="board-area" ref={area}>
          <div className={`board-frame${locked ? ' locked' : ''}`}>
            <canvas ref={canvas} width={BOARD_W} height={BOARD_H} style={{ width: BOARD_W * scale, height: BOARD_H * scale }}
              onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onLostPointerCapture={up} />
          </div>
        </div>
        {game && inPlay && <Guesses game={game} meId={meId ?? ''} />}
        {game && !inPlay && game.feed.length > 0 && <Guesses game={game} meId={meId ?? ''} />}
      </div>
    </section>
  );
}


// ───────── Draw & Guess ─────────
function usePict() {
  const [g, setG] = useState<Pict | null>(pictNow);
  useEffect(() => watchPict(() => setG(pictNow())), []);
  return g;
}
/** Seconds left on the game's clock, counting down. */
function useLeft(ends: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 250); return () => window.clearInterval(t); }, []);
  return Math.max(0, Math.ceil((ends - now) / 1000));
}

/** Starting a game: how many rounds (each one is everybody drawing once). */
function StartGame() {
  const [open, setOpen] = useState(false);
  const online = useStore((s) => Object.values(s.presence).filter((p) => p.state !== 'offline').length);
  if (!open) return <button className="pict-start" onClick={() => setOpen(true)} title="Take turns drawing a word while the other players guess it">Play Draw &amp; Guess</button>;
  return (
    <span className="set pict-rounds">
      <small>Rounds:</small>
      {[1, 2, 3].map((n) => <button key={n} disabled={online < 2} onClick={() => { setOpen(false); pictDo('open', n); }}>{n}</button>)}
      <button onClick={() => setOpen(false)}>Cancel</button>
      {online < 2 && <small className="warn">Needs two people on.</small>}
    </span>
  );
}

/** Beside the board: the game's own feed (what happened and everybody's guesses) and the box to guess in. */
function Guesses({ game, meId }: { game: Pict; meId: string }) {
  const users = useStore((s) => s.users);
  const [text, setText] = useState('');
  const feed = useRef<HTMLOListElement>(null);
  useEffect(() => { const el = feed.current; if (el) el.scrollTop = el.scrollHeight; }, [game.feed.length]);
  const name = (id?: string) => (id && users[id]?.name) || 'Somebody';
  const drawing = game.phase === 'drawing', mine = drawing && game.drawer === meId, got = game.guessed.includes(meId);
  const canType = game.phase !== 'over';
  const place = !drawing ? 'Say something' : mine ? 'You are drawing: chat here, but no word' : got ? 'You got it: chat while the others guess' : 'Type a guess and press Enter';
  const go = () => { const t = text.trim(); if (!t) return; pictGuess(t); setText(''); };
  return (
    <aside className="pict-side">
      <h3>Guesses</h3>
      <ol className="pict-feed" ref={feed}>
        {game.feed.map((l, i) => (
          <li key={i} className={`k-${l.k}`}>
            {l.k === 'guess' ? <><b style={{ color: users[l.who ?? '']?.color }}>{name(l.who)}</b> {l.text}</> : l.text}
          </li>
        ))}
      </ol>
      {canType && (
        <form className="pict-guess" onSubmit={(e) => { e.preventDefault(); go(); }}>
          <input id="pict-guess" value={text} maxLength={60} placeholder={place} autoComplete="off" onChange={(e) => setText(e.target.value)} autoFocus={!mine} />
          <button type="submit" disabled={!text.trim()}>Send</button>
        </form>
      )}
    </aside>
  );
}

function DrawGuess({ game, meId }: { game: Pict | null; meId: string }) {
  const users = useStore((s) => s.users);
  const left = useLeft(game?.ends ?? 0);
  if (!game) return null;
  const name = (id: string) => users[id]?.name ?? 'Somebody';
  const drawing = game.phase === 'drawing', mine = game.drawer === meId;
  const scores = Object.entries(game.scores).sort((a, b) => b[1] - a[1]);
  const players = [...new Set([...scores.map(([id]) => id), ...game.players])].filter((id) => id && (users[id] || game.scores[id]));
  if (game.phase === 'lobby') {
    const ready = game.players.length >= 2;
    return (
      <div className="pict pict-lobby">
        <div className="pict-line">
          <b>Draw &amp; Guess</b>
          <span>{game.rounds} {game.rounds === 1 ? 'round' : 'rounds'}, opened by {name(game.by)}.</span>
          {!game.joined && <button className="pict-join" onClick={() => pictDo('join')}>Join</button>}
          {game.joined && <button className="pict-join" disabled={!ready} onClick={() => pictDo('begin')} title={ready ? 'Start the game for everybody who has joined' : 'Somebody else has to press Join first'}>Start the game</button>}
          {game.joined && <button onClick={() => pictDo('leave')}>Leave</button>}
          {game.joined && !ready && <small>Waiting for somebody else to join.</small>}
          <SureButton className="pict-stop" title="Put the game away, for everybody" onSure={() => pictDo('stop')}>Put it away</SureButton>
        </div>
        <ol className="pict-scores">
          {game.players.map((id) => <li key={id}><span>{name(id)}</span><small>in</small></li>)}
        </ol>
      </div>
    );
  }
  return (
    <div className={`pict pict-${game.phase}`}>
      <div className="pict-line">
        {game.phase === 'over' ? <b>Final scores</b> : <b>Round {game.round} of {game.rounds}</b>}
        {drawing && <span className="pict-who">{mine ? 'You are drawing' : `${name(game.drawer)} is drawing`}</span>}
        {drawing && (mine
          ? <span className="pict-word">{game.word.toUpperCase()}</span>
          : <span className="pict-hint" title="A line for each letter">{[...game.hint].map((ch, i) => <i key={i} className={ch === ' ' ? 'gap' : ''}>{ch === ' ' ? '' : ch}</i>)}</span>)}
        {game.phase === 'between' && <span className="pict-was">The word was <b>{game.was.toUpperCase()}</b></span>}
        {game.phase !== 'over' && <span className={`pict-clock${drawing && left <= 10 ? ' low' : ''}`}>{drawing ? `${left} s` : `next in ${left} s`}</span>}
        {drawing && mine && game.canSwap && <button onClick={() => pictDo('swap')} title="Once a turn, before anybody has got it">A different word</button>}
        {drawing && !mine && <small>{game.guessed.includes(meId) ? 'You got it. Wait for the others.' : game.joined ? 'Type your guesses beside the board.' : 'Watching. Type a guess beside the board to join in.'}</small>}
        {mine && drawing && <small>Draw it: no letters or numbers.</small>}
        {game.phase !== 'over' && game.joined && <button onClick={() => pictDo('leave')} title="Leave the game; it goes on without you">Leave</button>}
        {game.phase !== 'over' && <SureButton className="pict-stop" title="End the game for everybody and put the board back as it was" onSure={() => pictDo('stop')}>Stop the game</SureButton>}
      </div>
      {players.length > 0 && (
        <ol className="pict-scores">
          {players.map((id) => (
            <li key={id} className={`${id === game.drawer && drawing ? 'drawer' : ''}${game.guessed.includes(id) ? ' got' : ''}`}>
              <span>{name(id)}</span><b>{game.scores[id] ?? 0}</b>
              {drawing && id === game.drawer && <small>drawing</small>}
              {drawing && game.guessed.includes(id) && <small>got it</small>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
