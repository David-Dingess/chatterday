// The voice changer's controls in the voice bar (hold to use, a small list to pick from), and the mark by the name of
// anybody who has one on, so everyone knows it is a bit. The sound itself is voicefx.ts.
import { useEffect, useRef, useState } from 'react';
import { captureKey, EFFECTS, fxAvailable, holdFx, lockFx, pickFx, setFxKey, useFx } from '../voicefx';
import '../voicefx.css';

/** A magic wand, in the app's 8x8 pixels and the colour of the text around it. */
const WAND = ['......#.', '.....###', '......#.', '.....#..', '....#...', '...#....', '..#.....', '.#......'];
export function WandIcon({ size = 16 }: { size?: number }) {
  return (
    <svg className="vfx-wand" width={size} height={size} viewBox="0 0 8 8" shapeRendering="crispEdges" aria-hidden>
      {WAND.flatMap((row, y) => [...row].map((c, x) => (c === '#' ? <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill="currentColor" /> : null)))}
    </svg>
  );
}

const nameOf = (id: string) => EFFECTS.find((e) => e.id === id)?.name ?? id;
const keyName = (code: string) => code.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Numpad/, 'Num ').replace(/(Left|Right)$/, ' ($1)');

/** By a person's name while their voice changer is on (mine too, so I can see it is). */
export function FxBadge({ userId, me }: { userId: string; me: boolean }) {
  const fx = useFx((s) => (me ? s.on : s.others[userId]) ?? null);
  if (!fx) return null;
  return <i className="vfx-badge" title={`Voice changer on: ${nameOf(fx)}`}><WandIcon size={12} /></i>;
}

/** In the voice bar: hold the wand to talk through the chosen effect; the arrow beside it picks one. */
export function VoiceFxButton() {
  const { pick, key, on, lock } = useFx();
  const [open, setOpen] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('pointerdown', away);
    return () => window.removeEventListener('pointerdown', away);
  }, [open]);
  useEffect(() => {
    if (!waiting) return;
    captureKey(true);
    const got = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code !== 'Escape') setFxKey(e.code === 'Backspace' || e.code === 'Delete' ? '' : e.code);
      setWaiting(false);
    };
    window.addEventListener('keydown', got, true);
    return () => { window.removeEventListener('keydown', got, true); captureKey(false); };
  }, [waiting]);
  useEffect(() => () => holdFx(false), []);          // (the bar goes away with the call: nothing stays held)
  if (!fxAvailable()) return null;

  const down = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    if (lock) return lockFx(false);              // locked on: a press takes it off
    e.currentTarget.setPointerCapture(e.pointerId);
    holdFx(true);
  };
  const up = () => holdFx(false);
  return (
    <div className="vfx" ref={box}>
      <button className={`vfx-hold${on ? ' on' : ''}`} onPointerDown={down} onPointerUp={up} onPointerCancel={up} onLostPointerCapture={up} onContextMenu={(e) => e.preventDefault()}
        title={lock ? `${nameOf(pick)} is locked on: click to turn it off` : `Hold to talk as ${nameOf(pick)}${key ? ` (or hold ${keyName(key)})` : ''}. Everyone hears it.`}>
        <WandIcon />
      </button>
      <button className={`vfx-more${open ? ' open' : ''}`} title="Pick a voice" onClick={() => setOpen(!open)}>▾</button>
      {open && (
        <div className="vfx-list" role="menu">
          <b>Voice changer</b>
          {EFFECTS.map((e) => (
            <button key={e.id} role="menuitemradio" aria-checked={pick === e.id} className={pick === e.id ? 'picked' : ''} title={e.hint} onClick={() => pickFx(e.id)}>{e.name}</button>
          ))}
          <label className="vfx-lock" title="Keep it on without holding anything (until you turn it off or leave the voice chat)">
            <input type="checkbox" checked={lock} onChange={(e) => lockFx(e.target.checked)} /> Lock on
          </label>
          <div className="vfx-key">
            <span>Hold key</span>
            <button onClick={() => setWaiting(!waiting)} title="A key to hold instead of the button, while Chatterday is the window in front (Backspace clears it)">{waiting ? 'Press a key…' : key ? keyName(key) : 'None'}</button>
          </div>
          <small>Everyone in the voice chat hears it, and sees the wand by your name.</small>
        </div>
      )}
    </div>
  );
}
