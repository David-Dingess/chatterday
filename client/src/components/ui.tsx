import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { ICON_NAMES } from '../icons.gen';
import { logoSvg } from '../logo';
import { faceTop, houseDay, mouthOpen, personColor, rowIndex, sheetOf, SPRITE_ROW_COUNT, SPRITE_UP } from '../sprites';
import { useStore } from '../store';
import type { SpriteRow } from '../sprites';
import type { Presence, User } from '../types';
import { outdoorsText } from '../basement/campfire';
import { yardText } from '../basement/yard';
import { lakeText } from '../basement/lake';

// The faces of whoever is talking just now. One loop for all of them, running only while somebody talks, flips their
// mouths open and shut on the room's clock (mouthOpen), and writes nothing but a changed --talk: no React render.
const talkers = new Set<HTMLElement>();
let flapping = 0;
const flap = (t: number) => {
  const m = mouthOpen(t) ? '1' : '0';
  for (const el of talkers) if (el.style.getPropertyValue('--talk') !== m) el.style.setProperty('--talk', m);
  flapping = talkers.size ? requestAnimationFrame(flap) : 0;
};

/** The Chatterday mark, drawn in this person's own accent colour (theme.ts sets the two variables). */
const LOGO_MARKUP = logoSvg('var(--accent)', 'var(--logo-tile)');
export function Logo({ size = 56 }: { size?: number }) {
  return <span className="logo" role="img" aria-label="Chatterday" style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: LOGO_MARKUP }} />;
}

export function Avatar({ user, size = 36, speaking = false }: { user: User | undefined; size?: number; speaking?: boolean }) {
  const tz = useStore((s) => s.settings.tz);
  const style: CSSProperties = { width: size, height: size, fontSize: size * 0.55, background: personColor(user) };
  const z = size / 24;        // everyone's picture is their character's face: a 24px square of the first idle frame
  const face: CSSProperties | null = user ? {
    backgroundImage: `url(${sheetOf(user, houseDay(tz))})`, backgroundSize: `${384 * z}px ${(48 + SPRITE_UP) * SPRITE_ROW_COUNT * z}px`,      // eight frames across: four, then the same four talking; each cell has SPRITE_UP rows of headroom over its frame
    // (--talk is 1 while the mouth is open: the same frame four along, as in the room)
    backgroundPosition: `calc(${-12 * z}px - var(--talk, 0) * ${192 * z}px) ${-(rowIndex('idle') * (48 + SPRITE_UP) + SPRITE_UP + faceTop(user)) * z}px`,
  } : null;
  const faceEl = useRef<HTMLElement>(null);
  const hasFace = !!face;
  useEffect(() => {
    const el = faceEl.current;
    if (!speaking || !el) return;
    talkers.add(el);
    if (!flapping) flapping = requestAnimationFrame(flap);
    return () => { talkers.delete(el); el.style.removeProperty('--talk'); };      // done talking: the mouth shuts
  }, [speaking, hasFace]);
  return (
    <span className={`avatar${speaking ? ' speaking' : ''}`} style={style}>
      {face && <i ref={faceEl} className="face" style={face} />}
    </span>
  );
}

/** One animation from a person's sprite sheet. `first` and `frames` pick the frames within the row. */
export function Sprite({ url, row, first = 0, frames = 1, ms = 500, scale = 2 }: { url: string; row: SpriteRow; first?: number; frames?: number; ms?: number; scale?: number }) {
  const style = { '--k': scale, '--up': SPRITE_UP, '--rows': SPRITE_ROW_COUNT, '--row': rowIndex(row), '--from': first, '--n': frames, '--dur': `${ms * frames}ms`, backgroundImage: `url(${url})` } as CSSProperties;
  return <i className={`sprite${frames > 1 ? ' anim' : ''}`} style={style} />;
}

export function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-label={title}>
        <header><h2>{title}</h2><button className="icon" onClick={onClose} aria-label="Close"><Icon name="close" /></button></header>
        {children}
      </div>
    </div>
  );
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span><b>{label}</b>{hint && <small>{hint}</small>}</span>
    </label>
  );
}

export const STATE_TEXT: Record<Presence['state'], string> = {
  offline: 'Offline', away: 'Away', desk: 'At the computer', gaming: 'Gaming', watching: 'Watching',
};
export const PLACE_TEXT: Record<string, string> = {
  gaming: 'Gaming', watching: 'Watching something', kitchen: 'Making something to eat', peeing: 'Peeing', pooping: 'Pooping',
  bathroom: 'In the bathroom', sleeping: 'Sleeping', working: 'Working', away: 'Away',
  cleaning: 'Cleaning', exercising: 'Exercising', showering: 'In the shower', prompting: 'Prompting', doomscrolling: 'Doomscrolling', vcall: 'On a video call', calling: 'On the phone', imhere: "I'm here", chillin: 'Chillin',
};
export function presenceText(p: Presence | undefined) {
  if (!p) return 'Offline';
  // Gaming or watching, said by hand while the PC sees the same: what it sees still shows, with the game's or site's name.
  const seen = (p.place === 'gaming' || p.place === 'watching') && p.state === p.place;
  if (p.state !== 'offline' && p.place && p.place !== 'here' && !seen) return PLACE_TEXT[p.place] ?? 'Away';      // 'here' is only where in the room: what they are doing still shows
  // in one of our own games (and not away): that is what they are doing
  if (p.playing && p.state !== 'away' && p.state !== 'offline') {
    const what = p.playing.says ?? `${p.playing.watching ? 'spectating' : p.playing.waiting ? 'waiting to play' : 'playing'} ${p.playing.game}`;
    return p.voice ? `In voice · ${what}` : what[0].toUpperCase() + what.slice(1);
  }
  // out the east door: by the campfire, or about the campsite; out the west door: mowing, swimming, in the hot tub...
  const outdoors = p.state !== 'offline' ? outdoorsText(p) ?? yardText(p) ?? lakeText(p) : null;
  if (outdoors) return p.voice ? `In voice · ${outdoors.toLowerCase()}` : outdoors;
  if (p.voice) return p.state === 'gaming' ? `In voice · gaming${p.label ? ` ${p.label}` : ''}` : p.state === 'away' ? 'In voice · away' : 'In voice';
  return p.label ? `${STATE_TEXT[p.state]} · ${p.label}` : STATE_TEXT[p.state];
}

// (made once: the chat asks for a time and a day for every message it draws, and building a formatter is the slow part)
const TIME = new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit' });
const DAY = new Intl.DateTimeFormat([], { weekday: 'long', month: 'long', day: 'numeric' });
export const fmtTime = (ts: number) => TIME.format(ts);
export function fmtDay(ts: number) {
  const day = new Date(ts).toDateString();
  if (day === new Date().toDateString()) return 'Today';
  if (day === new Date(Date.now() - 86400000).toDateString()) return 'Yesterday';
  return DAY.format(ts);
}
export const fmtSize = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Turns a key press into the "Ctrl+Shift+M" form the desktop shell registers as a global hotkey. */
export function toAccelerator(e: KeyboardEvent | React.KeyboardEvent): string | null {
  const c = e.code;
  let key = '';
  if (/^Key[A-Z]$/.test(c)) key = c.slice(3);
  else if (/^Digit\d$/.test(c)) key = c.slice(5);
  else if (/^F\d{1,2}$/.test(c)) key = c;
  else if (/^Numpad\d$/.test(c)) key = 'num' + c.slice(6);
  else if (c === 'Backquote') key = '`';
  else return null;
  const mods = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift'].filter(Boolean) as string[];
  if (!mods.length && !/^F\d/.test(key) && !key.startsWith('num')) return null; // a bare letter would eat typing everywhere
  return [...mods, key].join('+');
}

/** A button for something that cannot be undone: the first click turns it into "Sure?", a second click does it.
 *  It goes back to normal by itself after a few seconds, or when you click somewhere else. No pop-up window. */
export function SureButton({ onSure, children, title, className = '', ask = 'Sure?' }: { onSure: () => void; children: ReactNode; title?: string; className?: string; ask?: string }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), 3500);
    return () => window.clearTimeout(t);
  }, [armed]);
  return (
    <button className={`${className}${armed ? ' sure' : ''}`} title={armed ? 'Click again to go ahead' : title} onBlur={() => setArmed(false)}
      onClick={() => { if (armed) { setArmed(false); onSure(); } else setArmed(true); }}>{armed ? ask : children}</button>
  );
}

// The favourite star: the same 8x8 star as the icon sheet's ('star' in scripts/make-icons.py), solid, or as its outline
// only (every pixel of it that touches the outside), for a sound that is not a favourite yet.
const STAR = ['...##...', '...##...', '########', '.######.', '..####..', '.##..##.', '##....##', '........'];
const lit = (x: number, y: number) => STAR[y]?.[x] === '#';
const STAR_PX = { solid: [] as [number, number][], outline: [] as [number, number][] };
for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if (lit(x, y)) {
  STAR_PX.solid.push([x, y]);
  if (!lit(x - 1, y) || !lit(x + 1, y) || !lit(x, y - 1) || !lit(x, y + 1)) STAR_PX.outline.push([x, y]);
}
export function Star({ on, size = 12 }: { on: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 8 8" shapeRendering="crispEdges" aria-hidden fill="currentColor">
      {STAR_PX[on ? 'solid' : 'outline'].map(([x, y]) => <rect key={`${x},${y}`} x={x} y={y} width={1} height={1} />)}
    </svg>
  );
}

export type IconName = (typeof ICON_NAMES)[number];
/** One of the app's own 8x8 pixel icons, in the colour of the text around it. */
export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  const i = ICON_NAMES.indexOf(name);
  const style = { width: size, height: size, WebkitMaskSize: `${ICON_NAMES.length * size}px ${size}px`, WebkitMaskPosition: `${-i * size}px 0` } as CSSProperties;
  return <i className="px" aria-hidden style={style} />;
}
