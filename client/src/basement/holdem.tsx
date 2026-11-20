// Texas hold'em on the page (server/basement/holdem.ts deals, keeps the chips and decides every hand; the table is
// drawn in the game room by scripts/basement/gameroom.py). Play chips only.
//
// In the room: the cards face down in front of whoever is in the hand, their chips, the bets, the board and the dealer
// button, small, on the felt; click the table to open it large. Large: the table from above, six seats round it, each
// with its name, its stack, its cards (mine face up, everybody else's face down until a showdown turns them over) and
// its bet; the pot and the board in the middle, the button and the blinds, and a bar under whoever is to act running
// down their 30 seconds. Under the table: on my turn Fold, Check or Call, a raise (a slider and an amount, with quick
// sizes: the least allowed, half the pot, the pot) and All in; otherwise the buy-in (then click a free seat), the
// blinds, sitting out and topping up. The server checks everything again: these buttons only offer what it allows.
//
// My two cards come to me alone (op 'hole'); a page opened mid-hand asks for them again (op 'mine'). Taking a seat
// walks my character to that chair at the table. The sounds (cards dealt, chips, my turn) are made here at the
// soundboard's volume, only with the table open in front of me, and stop when it is closed.
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { hooks, send, soundGain, useStore } from '../store';
import { personColor } from '../sprites';
import { LAYOUT } from './gameroom.gen';
import type { FitProps } from './index';
import { useWatching } from './sound';
import { gameSpots, useGameSpot } from './spots';
import { pageRect } from '../device';

const ID = 'holdem';
const SEATS = 6;
type Seat = { uid: string; stack: number; out: boolean; gone: boolean; timeouts: number };
type Stage = 'idle' | 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';
type Holdem = {
  seats: (Seat | null)[]; sb: number; bb: number; hand: number; stage: Stage; button: number; sbSeat: number; bbSeat: number; hbb: number;
  board: string[]; dealt: boolean[]; folded: boolean[]; allIn: boolean[]; bet: number[]; put: number[]; pot: number;
  toAct: number; curBet: number; minRaise: number; turnLeft: number; shown: (string[] | null)[];
  wins: { seat: number; amount: number; hand: string }[]; last: string; nextIn: number;
  opts: { call: number; minTo: number; maxTo: number; raise: boolean } | null;
};
const TURN_MS = 30_000;
const MIN_BUY = 20, MAX_BUY = 500;

/** open: shown large; hole: my two cards, for that hand; stamp: when the last state came (its clocks count from it). */
const useLocal = create<{ open: boolean; hole: { hand: number; cards: string[] } | null; stamp: number; note: string }>()(() => ({ open: false, hole: null, stamp: 0, note: '' }));
/** Opens it large (or shuts it), from outside the room (Play Games' Game Room tab). It shows once the room is the game room. */
export const setOpen = (open: boolean) => useLocal.setState({ open });
const useTable = () => useStore((s) => s.fits[ID] as Holdem | null | undefined);
const user = (id: string) => useStore.getState().users[id];
const nameOf = (id: string) => user(id)?.name ?? 'Somebody';
const colorOf = (id: string) => { const u = user(id); return u ? personColor(u) : '#ffffff'; };
const live = (h: Holdem | null | undefined) => !!h && h.stage !== 'idle' && h.stage !== 'showdown';
const mySeatIn = (h: Holdem | null | undefined, me: string) => (h ? h.seats.findIndex((s) => s?.uid === me && !s.gone) : -1);

// ── sound: made up on the spot, quiet, at the soundboard's volume, through one gain that closing the table cuts ──
let actx: AudioContext | null = null, noise: AudioBuffer | null = null, bus: GainNode | null = null;
function audio() {
  const s = useStore.getState();
  const vol = s.voice.deafened ? 0 : soundGain(s.prefs.soundVol);
  if (!vol || !useLocal.getState().open || document.hidden) return null;
  try {
    actx ??= new AudioContext();
    void actx.resume().catch(() => {});
    const c = actx as AudioContext & { setSinkId?: (id: string) => Promise<void>; sinkId?: string };
    if (c.setSinkId && (c.sinkId ?? '') !== s.prefs.outId) c.setSinkId(s.prefs.outId).catch(() => {});
    if (!noise) {
      noise = actx.createBuffer(1, actx.sampleRate / 2, actx.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (!bus) { bus = actx.createGain(); bus.connect(actx.destination); }
    return { a: actx, out: bus, vol: vol * 0.45 };
  } catch { return null; }
}
/** Silences everything still to play (the table closed, or the room gone). */
function hush() {
  if (!bus) return;
  try { bus.gain.cancelScheduledValues(0); bus.gain.setValueAtTime(0, bus.context.currentTime); bus.disconnect(); } catch { /* (gone already) */ }
  bus = null;
}
useLocal.subscribe((s, p) => { if (p.open && !s.open) hush(); });
function burst(at: number, dur: number, type: BiquadFilterType, freq: number, q: number, gain: number) {
  const au = audio();
  if (!au) return;
  const { a, out } = au, src = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
  src.buffer = noise; f.type = type; f.frequency.value = freq; f.Q.value = q;
  const t = a.currentTime + at;
  g.gain.setValueAtTime(Math.max(0.0001, gain * au.vol), t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(out); src.start(t, Math.random() * 0.4); src.stop(t + dur + 0.02);
  src.onended = () => g.disconnect();
}
function tone(at: number, f0: number, dur: number, gain: number) {
  const au = audio();
  if (!au) return;
  const { a, out } = au, o = a.createOscillator(), g = a.createGain(), t = a.currentTime + at;
  o.type = 'triangle'; o.frequency.setValueAtTime(f0, t);
  g.gain.setValueAtTime(Math.max(0.0001, gain * au.vol), t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(out); o.start(t); o.stop(t + dur + 0.02);
  o.onended = () => g.disconnect();
}
/** A card flicked across the felt: a short swish of high noise. */
const flick = (at: number) => { burst(at, 0.07, 'bandpass', 3800 + Math.random() * 1500, 1.2, 0.5); burst(at + 0.05, 0.03, 'highpass', 6000, 0.7, 0.25); };
/** Clay chips clicking onto each other. */
const chips = (at: number, n: number) => { for (let i = 0; i < n; i++) { const t = at + i * (0.035 + Math.random() * 0.03); burst(t, 0.025, 'bandpass', 2600 + Math.random() * 1800, 8, 0.6); tone(t, 3200 + Math.random() * 900, 0.03, 0.08); } };
function soundFor(prev: Holdem | null | undefined, next: Holdem, me: string) {
  if (!prev) return;
  if (next.hand > prev.hand) { const n = next.dealt.filter(Boolean).length * 2; for (let i = 0; i < n; i++) flick(i * 0.07); chips(0.05, 3); return; }
  if (next.board.length > prev.board.length) for (let i = 0; i < next.board.length - prev.board.length; i++) flick(i * 0.12);
  const put = (h: Holdem) => h.put.reduce((a, b) => a + b, 0);
  if (next.hand === prev.hand && put(next) > put(prev)) chips(0, 3 + Math.floor(Math.random() * 3));
  if (next.wins.length && !prev.wins.length) chips(0.2, 9);
  const mine = mySeatIn(next, me);
  if (mine >= 0 && next.toAct === mine && prev.toAct !== mine) { tone(0, 880, 0.18, 0.35); tone(0.12, 1320, 0.22, 0.3); }
}

let listening = false;
function listen() {
  if (listening) return;
  listening = true;
  hooks.fit.push((d) => {
    if (d.id !== ID) return;
    if ('state' in d) useLocal.setState({ stamp: performance.now() });
    if (d.op === 'hole' && Array.isArray(d.cards)) useLocal.setState({ hole: { hand: Number(d.hand), cards: (d.cards as unknown[]).map(String) } });
    if (d.op === 'note') { useLocal.setState({ note: String(d.text ?? '') }); window.setTimeout(() => useLocal.setState({ note: '' }), 5000); }
  });
  useStore.subscribe((s, p) => {
    const a = p.fits[ID] as Holdem | undefined, b = s.fits[ID] as Holdem | undefined;
    if (b && a !== b) soundFor(a, b, s.me?.id ?? '');
  });
}

// ── drawing: pixel cards, chips ──
const SUIT_PX: Record<string, string[]> = {
  H: ['.XX.XX.', 'XXXXXXX', 'XXXXXXX', 'XXXXXXX', '.XXXXX.', '..XXX..', '...X...'],
  D: ['...X...', '..XXX..', '.XXXXX.', 'XXXXXXX', '.XXXXX.', '..XXX..', '...X...'],
  S: ['...X...', '..XXX..', '.XXXXX.', 'XXXXXXX', 'XXXXXXX', '.X.X.X.', '..XXX..'],
  C: ['..XXX..', '..XXX..', 'X.XXX.X', 'XXXXXXX', 'X.XXX.X', '...X...', '..XXX..'],
};
const red = (c: string) => c[1] === 'H' || c[1] === 'D';
function suit(c: CanvasRenderingContext2D, s: string, x: number, y: number, p: number, col: string) {
  c.fillStyle = col;
  SUIT_PX[s].forEach((row, j) => { for (let i = 0; i < row.length; i++) if (row[i] === 'X') c.fillRect(Math.round(x + i * p), Math.round(y + j * p), Math.ceil(p), Math.ceil(p)); });
}
function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}
/** A card, w wide (it is 1.4 times as tall): face up, or its back (card null); `dim` for one folded. */
function drawCard(c: CanvasRenderingContext2D, x: number, y: number, w: number, card: string | null, dim = false) {
  const h = Math.round(w * 1.4), r = Math.max(2, w * 0.08);
  c.save();
  if (dim) c.globalAlpha *= 0.45;
  c.fillStyle = 'rgba(0,0,0,0.35)'; roundRect(c, x + 2, y + 3, w, h, r); c.fill();
  if (!card) {
    c.fillStyle = '#f4efe2'; roundRect(c, x, y, w, h, r); c.fill();
    const m = Math.max(2, w * 0.09);
    c.fillStyle = '#8a1c22'; c.fillRect(x + m, y + m, w - m * 2, h - m * 2);
    c.save(); c.beginPath(); c.rect(x + m, y + m, w - m * 2, h - m * 2); c.clip();
    c.strokeStyle = '#b8343a'; c.lineWidth = Math.max(1, w / 30);
    const step = Math.max(4, w / 6);
    for (let k = -h; k < w + h; k += step) { c.beginPath(); c.moveTo(x + k, y); c.lineTo(x + k + h, y + h); c.stroke(); c.beginPath(); c.moveTo(x + k, y + h); c.lineTo(x + k + h, y); c.stroke(); }
    c.restore();
    c.strokeStyle = '#d8b040'; c.lineWidth = 1; c.strokeRect(x + m + 1.5, y + m + 1.5, w - m * 2 - 3, h - m * 2 - 3);
  } else {
    const g = c.createLinearGradient(x, y, x + w, y + h); g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#e6dfcc');
    c.fillStyle = g; roundRect(c, x, y, w, h, r); c.fill();
    const col = red(card) ? '#c8202a' : '#1a1a22';
    c.fillStyle = col; c.font = `${Math.round(w * 0.46)}px VT323, monospace`; c.textAlign = 'left'; c.textBaseline = 'top';
    c.fillText(card[0] === 'T' ? '10' : card[0], x + w * 0.1, y + w * 0.02);
    suit(c, card[1], x + w * 0.1, y + w * 0.44, w / 26, col);
    const p = w / 13;
    suit(c, card[1], x + w / 2 - p * 3.5, y + h * 0.5, p, col);
  }
  c.strokeStyle = 'rgba(30,20,20,0.75)'; c.lineWidth = 1; roundRect(c, x + 0.5, y + 0.5, w - 1, h - 1, r); c.stroke();
  c.restore();
}
const CHIP = [[1000, '#e8c040'], [500, '#8a4ad8'], [100, '#26262c'], [25, '#2a9a4a'], [5, '#d03a30'], [1, '#f0ece0']] as const;
/** A pile of chips for an amount: its denominations, a column of each, edge stripes, lit on top. */
function drawChips(c: CanvasRenderingContext2D, x: number, y: number, amount: number, r = 9) {
  let left = amount;
  const cols: { col: string; n: number }[] = [];
  for (const [v, col] of CHIP) { const n = Math.floor(left / v); if (n) { cols.push({ col, n: Math.min(n, 8) }); left -= n * v; } }
  const shown = cols.slice(0, 4);
  shown.forEach((s, i) => {
    const cx = x + (i - (shown.length - 1) / 2) * (r * 2 + 2);
    c.fillStyle = 'rgba(0,0,0,0.35)'; c.beginPath(); c.ellipse(cx + 2, y + 2, r, r * 0.55, 0, 0, Math.PI * 2); c.fill();
    for (let k = 0; k < s.n; k++) {
      const cy = y - k * 3;
      c.fillStyle = s.col; c.beginPath(); c.ellipse(cx, cy, r, r * 0.55, 0, 0, Math.PI * 2); c.fill();
      c.strokeStyle = 'rgba(0,0,0,0.5)'; c.lineWidth = 1; c.stroke();
      c.fillStyle = s.col === '#f0ece0' ? '#5a7ad0' : '#f4f1e6';
      for (let a = 0; a < 6; a++) { const t = (a / 6) * Math.PI * 2; c.fillRect(cx + Math.cos(t) * r * 0.8 - 1, cy + Math.sin(t) * r * 0.45 - 1, 2, 2); }
    }
    const top = y - (s.n - 1) * 3;
    c.fillStyle = 'rgba(255,255,255,0.28)'; c.beginPath(); c.ellipse(cx - r * 0.25, top - r * 0.12, r * 0.45, r * 0.2, 0, 0, Math.PI * 2); c.fill();
  });
}

// ───────────────────────── in the room ─────────────────────────

/** Where each game seat's things go on the felt in the room, as fractions of the felt (clockwise from the near left). */
const MINI_AT: [number, number][] = [[0.22, 0.78], [0.06, 0.5], [0.22, 0.22], [0.78, 0.22], [0.94, 0.5], [0.78, 0.78]];

function MiniTable({ felt, z }: { felt: number[]; z: number }) {
  const h = useTable();
  const ref = useRef<HTMLCanvasElement>(null);
  const S = 4, [fx, fy, fw, fh] = felt;
  useEffect(() => {
    const c = ref.current?.getContext('2d');
    if (!c) return;
    c.clearRect(0, 0, fw * S, fh * S);
    if (!h) return;
    const P = (k: number) => [MINI_AT[k][0] * fw * S, MINI_AT[k][1] * fh * S];
    for (let k = 0; k < SEATS; k++) {
      const s = h.seats[k];
      if (!s) continue;
      const [x, y] = P(k), toward = (v: number, mid: number) => v + (mid - v) * 0.35;
      const cx = toward(x, (fw * S) / 2), cy = toward(y, (fh * S) / 2);
      if (h.dealt[k] && !h.folded[k] && h.stage !== 'idle') {
        const shown = h.shown[k];
        for (let i = 0; i < 2; i++) {
          c.fillStyle = shown ? '#fbf8f0' : '#8a1c22'; c.fillRect(cx - 7 + i * 7, cy - 6, 6, 9);
          c.fillStyle = shown ? (red(shown[i]) ? '#c8202a' : '#1a1a22') : '#d8b040'; c.fillRect(cx - 5 + i * 7, cy - 3, 2, 3);
          c.strokeStyle = 'rgba(0,0,0,0.6)'; c.lineWidth = 1; c.strokeRect(cx - 6.5 + i * 7, cy - 5.5, 5, 8);
        }
      }
      if (s.stack > 0) {                                             // their stack, at their edge of the felt
        const n = Math.min(4, 1 + Math.floor(Math.log10(Math.max(1, s.stack))));
        for (let i = 0; i < n; i++) { c.fillStyle = i % 2 ? '#f4f1e6' : colorOf(s.uid); c.fillRect(x - 3, y - i * 2, 6, 2); }
        c.fillStyle = 'rgba(0,0,0,0.4)'; c.fillRect(x - 3, y + 2, 6, 1);
      }
      if (h.bet[k] > 0) { c.fillStyle = '#d03a30'; c.fillRect(toward(x, (fw * S) / 2) + (x < (fw * S) / 2 ? 10 : -14), cy + 2, 4, 3); }
      if (h.button === k && h.hand > 0) { c.fillStyle = '#ffffff'; c.beginPath(); c.arc(cx + (k < 3 ? 12 : -12), cy + 3, 2.5, 0, Math.PI * 2); c.fill(); }
    }
    h.board.forEach((card, i) => {                                   // the board
      const x = (fw * S) / 2 - 2.5 * 9 + i * 9, y = (fh * S) / 2 - 6;
      c.fillStyle = '#fbf8f0'; c.fillRect(x, y, 7, 10);
      c.fillStyle = red(card) ? '#c8202a' : '#1a1a22'; c.fillRect(x + 2, y + 3, 3, 4);
      c.strokeStyle = 'rgba(0,0,0,0.6)'; c.strokeRect(x + 0.5, y + 0.5, 6, 9);
    });
  }, [h, fw, fh]);
  return <canvas ref={ref} className="gr-mini" width={fw * S} height={fh * S} style={{ left: fx, top: fy, width: fw, height: fh, zIndex: z }} />;
}

type HoldemThings = { table: number[]; felt: number[]; z: number; seats: number[] };

/** The poker table in the game room: what is on its felt, and a click to open it large. Taking a seat in the game
 *  walks my character to that chair. */
export function HoldemRoom({ layout, mini }: { layout: FitProps['layout']; mini: boolean }) {
  listen();
  const t = layout.things.holdem as HoldemThings | undefined;
  const open = useLocal((s) => s.open);
  const h = useTable(), me = useStore((s) => s.me?.id ?? '');
  const mine = mySeatIn(h, me);
  const hand = h?.hand ?? 0, inIt = live(h);
  // my cards, if I am in a hand and do not have them (the page opened, or came back, mid-hand)
  useEffect(() => {
    if (mini || mine < 0 || !inIt || useLocal.getState().hole?.hand === hand) return;
    send({ t: 'fit', id: ID, op: 'mine' });
  }, [mine, hand, inIt, mini]);
  // (./spots) to my chair when I take a seat (or come down to the game room with one); with the table open and no
  // chair at it, standing round its rug to watch
  useGameSpot(layout, mini, mine >= 0 ? `holdem-seat${mine}` : open ? 'holdem-watch' : null, mine >= 0 ? t?.seats[mine] : gameSpots(layout, 'holdem').watch);
  useEffect(() => () => hush(), []);
  if (!t) return null;
  const [fx, fy, fw, fh] = t.felt;
  return (
    <>
      <MiniTable felt={t.felt} z={t.z} />
      <i className="gr-hot" title="The poker table: click to play or watch" style={{ left: fx, top: fy, width: fw, height: fh + 10, zIndex: t.z }}
        onClick={(e) => { e.stopPropagation(); if (!mini) useLocal.setState({ open: true }); }} />
      {open && !mini && createPortal(<Overlay />, document.querySelector('.main-view') ?? document.body)}
    </>
  );
}

/** What pointing at a chair at the poker table says (the game room's says asks this first). */
export const holdemSays = (seat: number) => {
  const t = LAYOUT.things.holdem as HoldemThings | undefined;
  return t?.seats.includes(seat) ? 'Sit at the poker table (click the table to play)' : undefined;
};

// ───────────────────────── large ─────────────────────────

const W = 960, H = 600;
const CX = 480, CY = 290, STRAIGHT = 190, RAIL_R = 190;
/** Each seat's name plate, clockwise from the near left. */
const PLATE: [number, number][] = [[330, 548], [86, 290], [330, 34], [630, 34], [874, 290], [630, 548]];
const PW = 156, PH = 46;
const lerp = (a: [number, number], b: [number, number], t: number): [number, number] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const cardsAt = (k: number) => lerp(PLATE[k], [CX, CY], k === 1 || k === 4 ? 0.3 : 0.36);
const betAt = (k: number) => lerp(PLATE[k], [CX, CY], k === 1 || k === 4 ? 0.52 : k === 0 || k === 5 ? 0.65 : 0.5);
function stadium(c: CanvasRenderingContext2D, half: number, r: number) {
  c.beginPath();
  c.moveTo(CX - half, CY - r); c.lineTo(CX + half, CY - r);
  c.arc(CX + half, CY, r, -Math.PI / 2, Math.PI / 2); c.lineTo(CX - half, CY + r);
  c.arc(CX - half, CY, r, Math.PI / 2, Math.PI * 1.5); c.closePath();
}
/** The room and the table, drawn once: a navy rug with a gold lattice, the table's shadow, the padded rail, the walnut
 *  racetrack, the felt with the lamp's light on it and its nap, the gold betting line. */
let tableArt: HTMLCanvasElement | null = null;
function table(): HTMLCanvasElement {
  if (tableArt) return tableArt;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const c = cv.getContext('2d')!;
  c.fillStyle = '#141a30'; c.fillRect(0, 0, W, H);
  c.fillStyle = '#1c2440';
  for (let y = 0; y < H; y += 4) for (let x = 0; x < W; x += 4) { const u = (x + y) % 40, v = (x - y + 4000) % 40; if (u < 4 || v < 4) c.fillRect(x, y, 4, 4); }
  c.fillStyle = 'rgba(201,161,58,0.35)';
  for (let y = 0; y < H; y += 40) for (let x = (y / 40) % 2 ? 20 : 0; x < W; x += 40) c.fillRect(x - 2, y - 2, 4, 4);
  const v = c.createRadialGradient(CX, CY, 120, CX, CY, 620); v.addColorStop(0, 'rgba(255,216,144,0.10)'); v.addColorStop(1, 'rgba(0,0,0,0.55)');
  c.fillStyle = v; c.fillRect(0, 0, W, H);
  c.save(); c.translate(10, 16); c.fillStyle = 'rgba(0,0,0,0.5)'; stadium(c, STRAIGHT, RAIL_R + 4); c.fill(); c.restore();
  // the rail: dark oxblood leather, lit along its top
  const rg = c.createLinearGradient(0, CY - RAIL_R, 0, CY + RAIL_R); rg.addColorStop(0, '#5a3a30'); rg.addColorStop(0.08, '#3a221c'); rg.addColorStop(0.9, '#1e0e0a'); rg.addColorStop(1, '#120806');
  c.fillStyle = rg; stadium(c, STRAIGHT, RAIL_R); c.fill();
  c.strokeStyle = 'rgba(255,220,190,0.18)'; c.lineWidth = 2; stadium(c, STRAIGHT, RAIL_R - 3); c.stroke();
  c.setLineDash([3, 5]); c.strokeStyle = 'rgba(0,0,0,0.45)'; c.lineWidth = 1; stadium(c, STRAIGHT, RAIL_R - 16); c.stroke(); c.setLineDash([]);
  // the walnut racetrack
  const wg = c.createLinearGradient(0, CY - RAIL_R, 0, CY + RAIL_R); wg.addColorStop(0, '#b07a48'); wg.addColorStop(0.5, '#7a4a28'); wg.addColorStop(1, '#4a2a14');
  c.fillStyle = wg; stadium(c, STRAIGHT, RAIL_R - 30); c.fill();
  c.strokeStyle = 'rgba(40,20,8,0.5)'; c.lineWidth = 1;
  for (let k = 0; k < 4; k++) { stadium(c, STRAIGHT, RAIL_R - 33 - k * 3); c.stroke(); }
  // the felt
  const fg = c.createRadialGradient(CX, CY - 30, 40, CX, CY, RAIL_R + STRAIGHT); fg.addColorStop(0, '#2c8a5e'); fg.addColorStop(0.55, '#1e6a48'); fg.addColorStop(1, '#123e2a');
  c.fillStyle = fg; stadium(c, STRAIGHT, RAIL_R - 44); c.fill();
  c.save(); stadium(c, STRAIGHT, RAIL_R - 44); c.clip();
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 9000; i++) { c.fillStyle = rnd() < 0.5 ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.05)'; c.fillRect(Math.floor(rnd() * W / 2) * 2, Math.floor(rnd() * H / 2) * 2, 2, 2); }
  c.strokeStyle = 'rgba(0,0,0,0.4)'; c.lineWidth = 6; stadium(c, STRAIGHT, RAIL_R - 44); c.stroke();     // the racetrack's shadow on the felt
  c.restore();
  c.setLineDash([6, 4]); c.strokeStyle = 'rgba(216,176,64,0.55)'; c.lineWidth = 2; stadium(c, STRAIGHT - 10, RAIL_R - 96); c.stroke(); c.setLineDash([]);
  c.fillStyle = 'rgba(255,255,255,0.07)'; c.font = '40px VT323, monospace'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText("TEXAS HOLD'EM", CX, CY + 72);
  tableArt = cv;
  return cv;
}

function Overlay() {
  useWatching('holdem');
  const h = useTable();
  const me = useStore((s) => s.me?.id ?? '');
  const { hole, stamp, note } = useLocal();
  const ref = useRef<HTMLCanvasElement>(null);
  const close = () => useLocal.setState({ open: false });
  const downOn = useRef(false);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, []);
  const mine = mySeatIn(h, me);
  const bb = h?.bb ?? 10;
  const [buy, setBuy] = useState(String(100 * bb));
  const [blinds, setBlinds] = useState<[string, string]>([String(h?.sb ?? 5), String(bb)]);
  useEffect(() => { setBlinds([String(h?.sb ?? 5), String(h?.bb ?? 10)]); setBuy((v) => { const n = Number(v); return n >= MIN_BUY * bb && n <= MAX_BUY * bb ? v : String(100 * bb); }); }, [h?.sb, h?.bb, bb]);
  const myTurn = !!h && live(h) && mine >= 0 && h.toAct === mine && !!h.opts;
  const opts = myTurn ? h!.opts! : null;
  const [to, setTo] = useState(0);
  useEffect(() => { if (opts) setTo(opts.minTo); }, [h?.hand, h?.stage, h?.curBet, myTurn]);    // (a fresh decision: back to the least)
  const myCards = hole && h && hole.hand === h.hand && mine >= 0 && h.dealt[mine] ? hole.cards : null;

  // ── the picture ──
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const c = ref.current?.getContext('2d');
      if (!c) return;
      c.imageSmoothingEnabled = false;
      c.drawImage(table(), 0, 0);
      c.textBaseline = 'middle';
      if (!h) return;
      const going = h.stage !== 'idle';
      // the pot and the board
      const inPot = h.pot + h.bet.reduce((a, b) => a + b, 0);
      if (inPot > 0 && going) {
        drawChips(c, CX - 44, CY - 62, h.pot || inPot, 10);                // (beside its number, clear of the far seats' bets)
        c.font = '22px VT323, monospace'; c.textAlign = 'left'; c.fillStyle = '#f2e6a8';
        c.fillText(`Pot ${inPot}`, CX - 6, CY - 64);
      }
      const cw = 58;
      for (let i = 0; i < 5; i++) {
        const x = CX - (5 * cw + 4 * 8) / 2 + i * (cw + 8), y = CY - 40;
        if (h.board[i] && going) drawCard(c, x, y, cw, h.board[i]);
        else { c.strokeStyle = 'rgba(216,176,64,0.22)'; c.lineWidth = 1; roundRect(c, x + 0.5, y + 0.5, cw - 1, cw * 1.4 - 1, 4); c.stroke(); }
      }
      // the seats
      const now = performance.now();
      for (let k = 0; k < SEATS; k++) {
        const s = h.seats[k], [px, py] = PLATE[k];
        const x0 = px - PW / 2, y0 = py - PH / 2;
        const acting = going && h.toAct === k;
        const winner = h.wins.find((w) => w.seat === k);
        c.fillStyle = acting ? 'rgba(40,30,10,0.92)' : 'rgba(10,8,16,0.86)'; roundRect(c, x0, y0, PW, PH, 4); c.fill();
        c.strokeStyle = winner ? '#f2c230' : acting ? '#f2e6a8' : k === mine ? '#4fe0ff' : 'rgba(216,176,64,0.4)'; c.lineWidth = winner || acting ? 2 : 1;
        roundRect(c, x0 + 0.5, y0 + 0.5, PW - 1, PH - 1, 4); c.stroke();
        c.textAlign = 'left';
        if (!s) {
          c.fillStyle = 'rgba(242,230,168,0.55)'; c.font = '20px VT323, monospace'; c.textAlign = 'center';
          c.fillText(mine < 0 ? 'Sit here' : 'Empty seat', px, py);
          continue;
        }
        c.fillStyle = colorOf(s.uid); c.fillRect(x0 + 6, y0 + 8, 6, PH - 16);
        c.font = '20px VT323, monospace'; c.fillStyle = s.gone ? '#8a8f88' : '#ecebe4';
        const nm = nameOf(s.uid);
        c.fillText(nm.length > 13 ? nm.slice(0, 12) + '…' : nm, x0 + 18, y0 + 14);
        c.fillStyle = '#f2e6a8'; c.font = '19px VT323, monospace';
        const tag = s.gone ? 'left' : going && h.dealt[k] && h.allIn[k] ? 'ALL IN' : going && h.dealt[k] && h.folded[k] ? 'folded' : s.out ? (s.stack ? 'sitting out' : 'busted') : '';
        c.fillText(`${s.stack}`, x0 + 18, y0 + 32);
        if (tag) { c.fillStyle = tag === 'ALL IN' ? '#ff8a6a' : '#9a9a90'; c.textAlign = 'right'; c.fillText(tag, x0 + PW - 8, y0 + 32); }
        if (winner) { c.fillStyle = '#f2c230'; c.textAlign = 'right'; c.fillText(`+${winner.amount}`, x0 + PW - 8, y0 + 14); }
        if (acting) {                                                        // their clock, running down under the plate
          const left = Math.max(0, h.turnLeft - (now - stamp)) / TURN_MS;
          c.fillStyle = 'rgba(0,0,0,0.6)'; c.fillRect(x0 + 4, y0 + PH - 5, PW - 8, 3);
          c.fillStyle = left < 0.25 ? '#ff5a4d' : '#f2c230'; c.fillRect(x0 + 4, y0 + PH - 5, (PW - 8) * left, 3);
        }
        // their cards
        if (going && h.dealt[k]) {
          const [cx, cy] = cardsAt(k), w = k === mine && myCards ? 54 : 40;
          const cards = h.shown[k] ?? (k === mine ? myCards : null);
          const folded = h.folded[k];
          if (!folded || k === mine) for (let i = 0; i < 2; i++) drawCard(c, cx - w + i * (w * 0.78) - 2, cy - w * 0.7, w, cards ? cards[i] : null, folded);
          if (winner?.hand) { c.font = '18px VT323, monospace'; c.textAlign = 'center'; c.fillStyle = '#f2c230'; c.fillText(winner.hand, cx, cy + w * 0.85); }
        }
        // their bet
        if (going && h.bet[k] > 0) {
          const [bx, by] = betAt(k);
          drawChips(c, bx, by, h.bet[k], 8);
          c.font = '18px VT323, monospace'; c.textAlign = 'center'; c.fillStyle = '#ffffff';
          c.fillText(String(h.bet[k]), bx, by + 18);
        }
        // the button and the blinds
        if (going && h.hand > 0) {
          const [cx, cy] = cardsAt(k), side = k < 3 ? 1 : -1, dx = cx + side * 64, dy = cy + (k === 1 || k === 4 ? 46 : 0);
          if (h.button === k) {
            c.fillStyle = 'rgba(0,0,0,0.4)'; c.beginPath(); c.arc(dx + 2, dy + 3, 13, 0, Math.PI * 2); c.fill();
            const bg = c.createRadialGradient(dx - 4, dy - 4, 2, dx, dy, 13); bg.addColorStop(0, '#ffffff'); bg.addColorStop(1, '#cfcabc');
            c.fillStyle = bg; c.beginPath(); c.arc(dx, dy, 12, 0, Math.PI * 2); c.fill();
            c.strokeStyle = '#3a3a3a'; c.lineWidth = 1; c.stroke();
            c.fillStyle = '#1a1a22'; c.font = '18px VT323, monospace'; c.textAlign = 'center'; c.fillText('D', dx, dy + 1);
          }
          const blind = h.sbSeat === k ? 'SB' : h.bbSeat === k ? 'BB' : '';
          if (blind && h.stage === 'preflop') {
            const ex = dx + (h.button === k ? side * 30 : 0);
            c.fillStyle = blind === 'SB' ? '#2a5ad0' : '#d0a020'; c.beginPath(); c.arc(ex, dy, 11, 0, Math.PI * 2); c.fill();
            c.fillStyle = '#ffffff'; c.font = '15px VT323, monospace'; c.textAlign = 'center'; c.fillText(blind, ex, dy + 1);
          }
        }
      }
      if (!going || h.stage === 'showdown') {
        const msg = h.nextIn > 0 ? `Next hand in ${Math.max(0, Math.ceil((h.nextIn - (now - stamp)) / 1000))}` : h.seats.filter(Boolean).length < 2 ? 'Waiting for players' : '';
        if (msg) { c.font = '22px VT323, monospace'; c.textAlign = 'center'; c.fillStyle = 'rgba(242,230,168,0.8)'; c.fillText(msg, CX, CY + 110); }
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [h, me, mine, myCards, stamp]);

  const toCanvas = (e: ReactPointerEvent<HTMLCanvasElement>) => { const r = pageRect(e.currentTarget); return { x: ((e.clientX - r.left) * W) / r.width, y: ((e.clientY - r.top) * H) / r.height }; };
  const seatUnder = (x: number, y: number) => PLATE.findIndex(([px, py]) => Math.abs(x - px) <= PW / 2 && Math.abs(y - py) <= PH / 2);
  const down = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const p = toCanvas(e), k = seatUnder(p.x, p.y);
    if (k >= 0 && mine < 0 && h && !h.seats[k]) send({ t: 'fit', id: ID, op: 'sit', seat: k, buy: Math.round(Number(buy)) });
  };
  const [hover, setHover] = useState(false);
  const move = (e: ReactPointerEvent<HTMLCanvasElement>) => { const p = toCanvas(e), k = seatUnder(p.x, p.y); setHover(k >= 0 && mine < 0 && !!h && !h.seats[k]); };

  const act = (what: string, amount?: number) => send({ t: 'fit', id: ID, op: 'act', what, ...(amount !== undefined ? { to: amount } : {}) });
  const s = mine >= 0 ? h!.seats[mine]! : null;
  const inHandNow = !!h && live(h) && mine >= 0 && h.dealt[mine] && !h.folded[mine];
  const potNow = h ? h.pot + h.bet.reduce((a, b) => a + b, 0) : 0;
  const clampTo = (v: number) => (opts ? Math.max(opts.minTo, Math.min(opts.maxTo, Math.round(v))) : 0);
  /** A raise of a share of the pot: what it would be after my call, that much on top. */
  const potRaise = (share: number) => (opts && h ? clampTo(h.curBet + share * (potNow + opts.call)) : 0);
  const buyN = Math.round(Number(buy)), buyOk = buyN >= MIN_BUY * bb && buyN <= MAX_BUY * bb;
  const topUpMax = s ? MAX_BUY * bb - s.stack : 0;
  const say = note || (h?.last ?? '') || 'Pick a buy-in, then click an empty seat. The table deals once two are sat.';
  const title = h && h.hand > 0 ? `Texas Hold'em · hand ${h.hand} · blinds ${h.sb}/${h.bb}` : `Texas Hold'em · blinds ${h?.sb ?? 5}/${bb}`;
  return (
    <div className="gr-overlay" onMouseDown={(e) => { downOn.current = e.target === e.currentTarget; }} onClick={(e) => { if (downOn.current && e.target === e.currentTarget) close(); }}>
      <div className="gr-box" onClick={(e) => e.stopPropagation()}>
        <header className="gr-tabs">
          <b className="mg-title">{title}</b>
          <span />
          {s && (s.out
            ? s.stack > 0 && <button onClick={() => send({ t: 'fit', id: ID, op: 'sitout', on: false })}>I'm back</button>
            : <button onClick={() => send({ t: 'fit', id: ID, op: 'sitout', on: true })} title="Not dealt in from the next hand">Sit out</button>)}
          {s && <button onClick={() => { send({ t: 'fit', id: ID, op: 'leave' }); send({ t: 'place', place: '' }); useLocal.setState({ hole: null }); }} title={inHandNow ? 'Leaving folds your hand' : 'Leave the table'}>Leave</button>}
          <button onClick={close} title="Back to the room (Esc)">Close</button>
        </header>
        <div className="gr-fill">
          <canvas ref={ref} className={`gr-table ho-table${hover ? ' sit' : ''}`} width={W} height={H} style={{ '--ar': W / H } as CSSProperties}
            onPointerDown={down} onPointerMove={move} onPointerLeave={() => setHover(false)} />
        </div>
        <p className="gr-say">{say}</p>
        <div className="ho-bar">
          {opts && h ? (
            <>
              <button onClick={() => act('fold')}>Fold</button>
              {opts.call > 0 ? <button className="ho-go" onClick={() => act('call')}>Call {opts.call}{opts.call >= s!.stack ? ' (all in)' : ''}</button>
                : <button className="ho-go" onClick={() => act('check')}>Check</button>}
              {opts.raise && opts.maxTo > opts.minTo && (
                <span className="ho-raise">
                  <input type="range" min={opts.minTo} max={opts.maxTo} step={1} value={to} onChange={(e) => setTo(clampTo(Number(e.target.value)))} aria-label="Raise to" />
                  <input type="number" min={opts.minTo} max={opts.maxTo} value={to} onChange={(e) => setTo(Number(e.target.value) || 0)} onBlur={() => setTo(clampTo(to))} aria-label="Raise to" />
                  <button onClick={() => setTo(opts.minTo)} title="The least raise allowed">Min</button>
                  <button onClick={() => setTo(potRaise(0.5))}>½ pot</button>
                  <button onClick={() => setTo(potRaise(1))}>Pot</button>
                  <button className="ho-go" onClick={() => act(clampTo(to) >= opts.maxTo ? 'allin' : 'raise', clampTo(to))}>{h.curBet === 0 ? 'Bet' : 'Raise to'} {clampTo(to)}</button>
                </span>
              )}
              {opts.raise && <button className="ho-allin" onClick={() => act('allin')}>All in {opts.maxTo}</button>}
            </>
          ) : (
            <>
              {mine < 0 && (
                <label className="ho-field">Buy in
                  <input type="number" min={MIN_BUY * bb} max={MAX_BUY * bb} step={bb} value={buy} onChange={(e) => setBuy(e.target.value)} className={buyOk ? '' : 'bad'} />
                  <small>{MIN_BUY * bb} to {MAX_BUY * bb}, then click a free seat</small>
                </label>
              )}
              {mine < 0 && h && h.seats.some((x) => !x) && <button disabled={!buyOk} onClick={() => send({ t: 'fit', id: ID, op: 'sit', seat: h.seats.findIndex((x) => !x), buy: buyN })}>Sit anywhere</button>}
              {s && (
                <label className="ho-field">Blinds
                  <input type="number" min={1} value={blinds[0]} onChange={(e) => setBlinds([e.target.value, blinds[1]])} aria-label="Small blind" />
                  /
                  <input type="number" min={1} value={blinds[1]} onChange={(e) => setBlinds([blinds[0], e.target.value])} aria-label="Big blind" />
                  <button onClick={() => send({ t: 'fit', id: ID, op: 'blinds', sb: Math.round(Number(blinds[0])), bb: Math.round(Number(blinds[1])) })}
                    disabled={!(Number(blinds[0]) >= 1 && Number(blinds[1]) >= Number(blinds[0]))} title="From the next hand">Set</button>
                </label>
              )}
              {s && !inHandNow && topUpMax > 0 && (
                <label className="ho-field">{s.stack === 0 ? 'Rebuy' : 'Add chips'}
                  <input type="number" min={1} max={topUpMax} step={bb} value={buy} onChange={(e) => setBuy(e.target.value)} />
                  <button onClick={() => send({ t: 'fit', id: ID, op: 'rebuy', buy: Math.round(Number(buy)) })}>{s.stack === 0 ? 'Buy back in' : 'Add'}</button>
                </label>
              )}
              {s && live(h) && h!.toAct >= 0 && <small className="ho-wait">{h!.seats[h!.toAct] ? `${nameOf(h!.seats[h!.toAct]!.uid)} to act…` : ''}</small>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
