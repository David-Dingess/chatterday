// The pieces the backyard's lawn games are drawn with (pong.tsx, shoes.tsx, bocce.tsx): the large view's frame (both
// sides, joining, starting, leaving), the press-drag-release throw (as cornhole's: the drag back says which way and how
// hard; past half the strength shakes, and what it shows when let go is what is thrown; the aim sways a little as it is
// held), walking to where a player stands, how a thrower is drawn, and the sounds.
import { useEffect, useRef } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { send, soundGain, useStore } from '../store';
import { out } from './sound';
import type { FitPose } from './index';
import { COLORS, PULL, shaky, sway, TEAMS } from './yardgames.ts';
import type { Sides } from './yardgames.ts';
import './yardgames.css';
import { pageRect } from '../device';

export const nameOf = (id: string | null | undefined) => (id ? useStore.getState().users[id]?.name ?? 'Somebody' : '');

export function useTicker(draw: (t: number) => void, deps: unknown[]) {
  useEffect(() => {
    let raf = 0;
    const go = (t: number) => { draw(t); raf = requestAnimationFrame(go); };
    raf = requestAnimationFrame(go);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/** Shades a colour for the time of day (1 full day, 0 night). */
export const lit = (rgb: number[], light: number, m = 1) => `rgb(${rgb.map((v) => Math.max(0, Math.min(255, Math.round(v * m * (0.4 + 0.6 * light))))).join(',')})`;

// ── who is throwing, and how they are drawn ──
/** Each thrower's last throw (performance.now()), and whether I am drawing one back just now (by game). */
const threw = new Map<string, number>();
export const winding = { game: '', at: 0 };
export const markThrow = (uid: string) => threw.set(uid, performance.now());
/** How somebody stood at a game is drawn: facing `face` ('left', 'right', 'up', 'down'), and through a throw (a wind-up
 *  as it is drawn back, the arm swung through as it goes). `me`: they are me, drawing one back in `game`. */
export function thrower(uid: string, face: 'left' | 'right' | 'up' | 'down', game: string): FitPose {
  const now = performance.now(), el = now - (threw.get(uid) ?? -1e9);
  const wind = (winding.game === game && uid === useStore.getState().me?.id && now - winding.at < 400) || el < 140;
  const swing = el >= 140 && el < 760;
  if (face === 'left' || face === 'right') {
    const flip = face === 'right';
    if (wind) return { row: 'reach', first: 1, frames: 1, ms: 1000, flip };
    if (swing) return { row: 'reach', first: 2, frames: 1, ms: 1000, flip };
    return { row: face === 'right' ? 'walk_right' : 'walk_left', first: 1, frames: 1, ms: 1000 };
  }
  if (face === 'down') {
    if (wind) return { row: 'drink', first: 0, frames: 1, ms: 1000 };
    if (swing) return { row: 'idle', first: 3, frames: 1, ms: 1000 };
    return { row: 'idle', first: 0, frames: 2, ms: 1000 };
  }
  if (wind) return { row: 'walk_up', first: 0, frames: 1, ms: 1000 };
  if (swing) return { row: 'walk_up', first: 2, frames: 1, ms: 1000 };
  return { row: 'walk_up', first: 1, frames: 1, ms: 1000 };
}
/** Whether somebody is stood (or nearly) at a spot in the yard. */
export function standsAt(uid: string, x: number, y: number) {
  const p = useStore.getState().presence[uid];
  return !!p && p.floor === 'backyard' && p.place === 'here' && !!p.at && Math.abs(p.at.x - x) <= 7 && Math.abs(p.at.y - y) <= 7;
}
/** Walks me to where I stand at a game (when I join, and whenever my place there changes), while I am in the yard. */
export function useWalkTo(spot: [number, number] | null) {
  const mine = useStore((s) => (s.me ? s.presence[s.me.id] : undefined));
  const sent = useRef('');
  const key = spot ? `${Math.round(spot[0])},${Math.round(spot[1])}` : '';
  useEffect(() => {
    if (!spot || !mine || mine.floor !== 'backyard') { sent.current = ''; return; }
    if (sent.current === key || (mine.place === 'here' && mine.at && Math.abs(mine.at.x - spot[0]) <= 4 && Math.abs(mine.at.y - spot[1]) <= 4)) return;
    sent.current = key;
    send({ t: 'place', place: 'here', x: Math.round(spot[0]), y: Math.round(spot[1]) });
  }, [key, mine?.floor]);   // eslint-disable-line react-hooks/exhaustive-deps
}

// ── the throw ──
export type Drag = { sx: number; sy: number; x: number; y: number };
/** A drag back on a canvas W wide, H high: where it is, and what it throws. `fwd`: the way the throw goes on the canvas
 *  (+1 to the right, -1 to the left). The aim is the angle off forward (positive: down the canvas, +v), times `k`, plus
 *  the hand's sway; the power how far back, out of PULL, shaking past half. */
export function useDrag(o: { W: number; H: number; mine: boolean; game: string; fwd: number; k?: number; max: number; swayK: number; onThrow: (aim: number, power: number) => void }) {
  const drag = useRef<Drag | null>(null);
  const pull = (d: Drag, t: number) => {
    const dx = d.x - d.sx, dy = d.y - d.sy;
    const tu = -dx * o.fwd, tv = -dy;
    const aim = Math.max(-o.max, Math.min(o.max, Math.atan2(tv, Math.max(1e-3, tu)) * (o.k ?? 1) + sway(t, o.swayK)));
    const raw = Math.min(1, Math.hypot(dx, dy) / PULL);
    return { aim, raw, power: shaky(raw, t), back: tu > 4 };
  };
  const pos = (ev: ReactPointerEvent<HTMLCanvasElement>) => { const r = pageRect(ev.currentTarget); return { x: ((ev.clientX - r.left) * o.W) / r.width, y: ((ev.clientY - r.top) * o.H) / r.height }; };
  const handlers = {
    onPointerDown: (ev: ReactPointerEvent<HTMLCanvasElement>) => {
      if (!o.mine) return;
      try { ev.currentTarget.setPointerCapture(ev.pointerId); } catch { /* (still works inside) */ }
      const p = pos(ev);
      drag.current = { sx: p.x, sy: p.y, x: p.x, y: p.y };
      winding.game = o.game; winding.at = performance.now();
    },
    onPointerMove: (ev: ReactPointerEvent<HTMLCanvasElement>) => { const d = drag.current; if (d) { const p = pos(ev); d.x = p.x; d.y = p.y; winding.at = performance.now(); } },
    onPointerUp: () => {
      const d = drag.current;
      drag.current = null;
      winding.game = '';
      if (!d || !o.mine) return;
      const r = pull(d, performance.now());
      if (!r.back || r.raw < 0.05) return;
      o.onThrow(r.aim, r.power);
    },
  };
  return { drag, pull, handlers };
}
/** The strength bar along the bottom of the canvas (shaking past half), and the pull line. */
export function drawPull(c: CanvasRenderingContext2D, d: Drag, power: number, W: number, H: number) {
  c.strokeStyle = 'rgba(255,255,255,0.35)'; c.lineWidth = 2; c.beginPath(); c.moveTo(d.sx, d.sy); c.lineTo(d.x, d.y); c.stroke();
  const bx = W / 2 - 150, by = H - 22;
  c.fillStyle = 'rgba(0,0,0,0.6)'; c.fillRect(bx - 2, by - 2, 304, 12);
  const bg = c.createLinearGradient(bx, 0, bx + 300, 0); bg.addColorStop(0, '#f2c230'); bg.addColorStop(1, '#ff6a2a');
  c.fillStyle = bg; c.fillRect(bx, by, 300 * power, 8);
  c.fillStyle = 'rgba(255,255,255,0.75)'; c.font = '15px VT323, monospace'; c.textAlign = 'left'; c.fillText('STRENGTH', bx + 310, by + 8);
}
/** Which way, not how far: a short dashed line from the hand. */
export function drawAim(c: CanvasRenderingContext2D, x: number, y: number, dx: number, dy: number, len: number) {
  c.setLineDash([6, 6]); c.strokeStyle = 'rgba(255,255,255,0.7)'; c.lineWidth = 2; c.beginPath();
  c.moveTo(x, y); c.lineTo(x + dx * len, y + dy * len); c.stroke(); c.setLineDash([]);
}
/** Big text across the top of the canvas (an inning's points). */
export function banner(c: CanvasRenderingContext2D, txt: string, W: number) {
  c.font = '30px VT323, monospace'; c.textAlign = 'center'; c.lineWidth = 4; c.strokeStyle = '#1a1008';
  c.strokeText(txt, W / 2, 34); c.fillStyle = '#ffe08a'; c.fillText(txt, W / 2, 34);
}

// ── the large view's frame ──
export function Frame({ id, title, g, me, W, H, mine, handlers, canvas, say, side, close, extra, help, names = TEAMS, colors = COLORS }: {
  id: string; title: string; g: Sides | null | undefined; me: string | undefined; W: number; H: number; mine: boolean;
  handlers: ReturnType<typeof useDrag>['handlers']; canvas: React.RefObject<HTMLCanvasElement | null>; say: string;
  side: (n: number) => ReactNode; close: () => void; extra?: ReactNode; help: string;
  /** the sides' names and colours, if not red and blue (bocce's are red and green) */
  names?: string[]; colors?: string[];
}) {
  const downOn = useRef(false);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [close]);
  const teams = g?.teams ?? [[], []];
  const between = !g?.on || g.over;
  const myTeam = me && g ? g.teams.findIndex((m) => m.includes(me)) : -1;
  return (
    <div className="gr-overlay" onMouseDown={(ev) => { downOn.current = ev.target === ev.currentTarget; }} onClick={(ev) => { if (downOn.current && ev.target === ev.currentTarget) close(); }}>
      <div className="gr-box" onClick={(ev) => ev.stopPropagation()}>
        <header className="gr-tabs">
          <b className="mg-title">{title}</b>
          {[0, 1].map((n) => (
            <span key={n} className={`gr-player${g?.on && !g.over && (g as Sides & { turn?: number }).turn === n ? ' turn' : ''}`} style={{ borderColor: colors[n] }}>
              <b style={{ color: colors[n] }}>{names[n]}</b> {teams[n].map(nameOf).join(' & ') || 'nobody'}
              {between && me && !teams[n].includes(me) && teams[n].length < 2 && <button onClick={() => send({ t: 'fit', id, op: 'join', team: n })}>Join</button>}
              {' '}{side(n)}
            </span>
          ))}
          <span />
          {extra}
          {myTeam >= 0 && between && teams[0].length > 0 && teams[1].length > 0 && <button onClick={() => send({ t: 'fit', id, op: 'start' })}>{g?.over ? 'Play again' : 'Start'}</button>}
          {myTeam >= 0 && <button onClick={() => { send({ t: 'fit', id, op: 'leave' }); close(); }}>Leave</button>}
          <button onClick={close} title="Back to the yard (Esc)">Close</button>
        </header>
        <div className="gr-fill"><canvas ref={canvas} className={`gr-table${mine ? ' mine' : ''}`} style={{ '--ar': W / H } as CSSProperties} width={W} height={H} {...handlers} /></div>
        <p className="gr-say">{!g || (!g.on && !g.over) ? `${g?.last ? `${g.last} ` : ''}${teams[0].length && teams[1].length ? 'Both sides have players: start when ready.' : help}` : say}</p>
      </div>
    </div>
  );
}

// ── sounds (only for whoever has the game open large) ──
let actx: AudioContext | null = null, noise: AudioBuffer | null = null;
/** A little sound kit for one game, or null if it is to be quiet (deafened, the sound turned down, the page hidden). */
export function kit(game: string, open: boolean) {
  const s = useStore.getState();
  const vol = s.voice.deafened ? 0 : soundGain(s.prefs.soundVol) * 0.5;
  if (!vol || !open || document.hidden) return null;
  try {
    actx ??= new AudioContext();
    void actx.resume().catch(() => {});
    if (!noise) { noise = actx.createBuffer(1, actx.sampleRate, actx.sampleRate); const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
  } catch { return null; }
  const a = actx, n = noise, dest = out(a, game);
  return {
    now: a.currentTime,
    /** a burst of filtered noise: a thud, a hiss, a scuff */
    burst(at: number, dur: number, type: BiquadFilterType, freq: number, gain: number) {
      const src = a.createBufferSource(), fl = a.createBiquadFilter(), gn = a.createGain();
      src.buffer = n; fl.type = type; fl.frequency.value = freq;
      gn.gain.setValueAtTime(Math.max(0.0001, gain * vol), at); gn.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      src.connect(fl).connect(gn).connect(dest); src.start(at, Math.random() * 0.5); src.stop(at + dur + 0.02);
    },
    /** a struck tone falling from f0 to f1: a knock, a tock, a clank */
    tone(at: number, f0: number, f1: number, dur: number, gain: number, type: OscillatorType = 'sine') {
      const o = a.createOscillator(), gn = a.createGain();
      o.type = type; o.frequency.setValueAtTime(f0, at); o.frequency.exponentialRampToValueAtTime(f1, at + dur);
      gn.gain.setValueAtTime(gain * vol, at); gn.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      o.connect(gn).connect(dest); o.start(at); o.stop(at + dur + 0.02);
    },
  };
}
