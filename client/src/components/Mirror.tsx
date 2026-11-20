// The bathroom mirror over the sink (client/src/mirror.ts). After a shower it fogs over; clicking it then opens it up
// close, big in the middle of the window, to write on with a finger. The room's mirror shows the same writing, small.
import { memo, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { finger, fogLevel, lift, MIRROR_H, MIRROR_W, misted, paintClose, paintRoom, ROOM_MIRROR, watchMirror } from '../mirror';
import '../mirror.css';

/** The room's mirror: nothing over the picture until it fogs, then the fog (and anything written in it), thinning out as it goes. */
export const WallMirror = memo(function WallMirror() {
  const ref = useRef<HTMLCanvasElement>(null);
  const [fogged, setFogged] = useState(misted);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const draw = () => {
      setFogged(misted());
      paintRoom(ref.current);
      if (ref.current) ref.current.style.opacity = String(fogLevel());
    };
    draw();
    const stop = watchMirror(draw);
    const t = window.setInterval(draw, 1000);        // (the fog thinning out, and drops running down)
    return () => { stop(); clearInterval(t); };
  }, []);
  useEffect(() => { if (!fogged) setOpen(false); }, [fogged]);
  const [x, y, w, h] = ROOM_MIRROR;
  return (
    <>
      <canvas ref={ref} className={`club-mirror${fogged ? ' fogged' : ''}`} width={w} height={h} style={{ left: x, top: y, width: w, height: h }}
        title={fogged ? 'The mirror is steamed up: click to write on it' : undefined}
        onClick={(e) => { if (!fogged) return; e.stopPropagation(); setOpen(true); }} />
      {open && createPortal(<MirrorUp onClose={() => setOpen(false)} />, document.body)}
    </>
  );
});

/** The mirror up close: draw on it with a finger (the mouse held down), which wipes the fog away. */
function MirrorUp({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const down = useRef(false);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', esc);
    let frame = 0;
    const tick = () => { paintClose(ref.current); frame = requestAnimationFrame(tick); };
    tick();
    return () => { document.removeEventListener('keydown', esc); cancelAnimationFrame(frame); lift(); };
  }, [onClose]);
  const dotAt = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * MIRROR_W - 0.5, ((e.clientY - r.top) / r.height) * MIRROR_H - 0.5] as const;
  };
  return (
    <div className="mirror-box" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="mirror-frame">
        <button className="mirror-x" onClick={onClose} aria-label="Close">✕</button>
        <canvas ref={ref} className="mirror-glass" width={MIRROR_W} height={MIRROR_H}
          onPointerDown={(e) => { if (e.button !== 0) return; down.current = true; try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* (not a real pointer) */ } const [x, y] = dotAt(e); finger(x, y, true); }}
          onPointerMove={(e) => { if (!down.current) return; const [x, y] = dotAt(e); finger(x, y, false); }}
          onPointerUp={() => { down.current = false; lift(); }}
          onPointerCancel={() => { down.current = false; lift(); }} />
        <i className="mirror-shelf" aria-hidden />
      </div>
    </div>
  );
}
