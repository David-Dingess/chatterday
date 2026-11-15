// The whiteboard, opened up to draw on. It is the same picture as the one on the clubhouse wall: everybody sees
// each stroke as it is made, and the server keeps it.
import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { BOARD_H, BOARD_W, ink, INKS, loadBoard, paint, sendStep, watchBoard } from '../board';
import { useStore } from '../store';
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
    if (e.button !== 0) return;
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
      <div className="board-tools">
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
        <SureButton className="wipe" title="Wipe the whole board clean, for everyone. Undo brings it back." onSure={() => { did(); sendStep({ op: 'clear' }); }}>Wipe it clean</SureButton>
      </div>
      <div className="board-area" ref={area}>
        <div className="board-frame">
          <canvas ref={canvas} width={BOARD_W} height={BOARD_H} style={{ width: BOARD_W * scale, height: BOARD_H * scale }}
            onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onLostPointerCapture={up} />
        </div>
      </div>
    </section>
  );
}
