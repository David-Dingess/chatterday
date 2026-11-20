// Table shuffleboard on the page (server/basement/shuffle.ts keeps the turns and the score; shuffle.ts is the physics).
// The table stands in the game room: its weights show on it there, and a click opens it large: the whole table, and the
// scoring end close up. On your turn, press anywhere on the table (where across it you press is where you throw from:
// on either view), drag back and let go: the further back, the harder, and a little up or down angles it. Pace is for
// you to judge: the line drawn from your hand only says which way, and the strength bar shakes once you are past half.
// The server's hand is not steady either. Watching: whoever is throwing is named, a hit clacks and flashes, a weight
// knocked off slides away and fades, and at the end of a round the weights that scored are ringed in gold with their
// points. The sounds are made here (filtered noise and short tones) at the soundboard's volume, and only while the
// table is open in front of you.
import { useEffect, useRef } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { hooks, send, soundGain, useStore } from '../store';
import { hush, onLeavingRoom, out, useWatching } from './sound';
import { HALF, LENGTH, LINES, R, type Puck } from './shuffle';
import type { FitLayout } from './index';
import { gameSpots, useGameSpot } from './spots';
import { pageRect } from '../device';

const ID = 'shuffle';
type Board = { seats: (string | null)[]; pucks: Puck[]; turn: number; thrown: number[]; score: number[]; first: number; on: boolean; over: boolean; winner: number; last: string; busyUntil: number; scored?: [number, number][] };
const COLORS = ['#e5484d', '#3b82f6'];
const NAMES = ['Red', 'Blue'];

/** Something worth seeing in a slide, at `t` ms after it starts: a weight struck (where, how hard), or one leaving the
 *  table (where it was, its velocity in inches a ms, and whether off the end or into a gutter). */
type Hit = { t: number; x: number; y: number; s: number };
type Gone = { i: number; t: number; x: number; y: number; vx: number; vy: number; end: boolean };
type Slide = { who: string; frames: number[][]; ms: number; t0: number; after: Board; hits: Hit[]; gone: Gone[] };
const useLocal = create<{ slide: Slide | null; open: boolean; scoredAt: number }>()(() => ({ slide: null, open: false, scoredAt: 0 }));
/** Opens it large (or shuts it), from outside the room (Play Games' Game Room tab). It shows once the room is the game room. */
export const setOpen = (open: boolean) => useLocal.setState({ open });
// closing it (or being taken out of the room) silences the slide still playing
useLocal.subscribe((s, p) => { if (p.open && !s.open) hush(ID); });
onLeavingRoom(() => useLocal.setState({ open: false }));

/** What happens in a slide, read from its frames: the first moment each weight already lying there is moved (it has
 *  been struck), and the last place and speed of each weight that goes. */
function readSlide(frames: number[][], ms: number) {
  const hits: Hit[] = [], gone: Gone[] = [];
  const n = (frames[0]?.length ?? 0) / 2;
  for (let i = 0; i < n; i++) {
    let still = i < n - 1;                                 // (the new weight is moving from the start)
    for (let k = 1; k < frames.length; k++) {
      const a = frames[k - 1], c = frames[k];
      if (a[i * 2] < 0) break;
      if (c[i * 2] < 0) {
        const p = k >= 2 && frames[k - 2][i * 2] >= 0 ? frames[k - 2] : a;
        const vx = (a[i * 2] - p[i * 2]) / ms, vy = (a[i * 2 + 1] - p[i * 2 + 1]) / ms;
        gone.push({ i, t: (k - 1) * ms, x: a[i * 2], y: a[i * 2 + 1], vx: Math.max(vx, 0.01), vy, end: a[i * 2] > LENGTH - 8 });
        break;
      }
      const d = Math.hypot(c[i * 2] - a[i * 2], c[i * 2 + 1] - a[i * 2 + 1]);
      if (still && d > 0.05) {                             // (struck part way through a frame: its pace shows in the next)
        const e = frames[k + 1] && frames[k + 1][i * 2] >= 0 ? Math.hypot(frames[k + 1][i * 2] - c[i * 2], frames[k + 1][i * 2 + 1] - c[i * 2 + 1]) : d;
        hits.push({ t: (k - 1) * ms, x: a[i * 2], y: a[i * 2 + 1], s: Math.min(1, Math.max(d, e) / ms / 0.12) }); still = false;
      }
      else if (!still && d < 0.01) still = true;
    }
  }
  return { hits, gone };
}

// ── sound: made up on the spot, quiet, at the soundboard's volume, only with the table open in front of me ──
let actx: AudioContext | null = null, noise: AudioBuffer | null = null;
function audio() {
  const s = useStore.getState();
  const vol = s.voice.deafened ? 0 : soundGain(s.prefs.soundVol);
  if (!vol || !useLocal.getState().open || document.hidden) return null;     // (hidden: the app is in the tray, and silent)
  try {
    actx ??= new AudioContext();
    void actx.resume().catch(() => {});
    const c = actx as AudioContext & { setSinkId?: (id: string) => Promise<void>; sinkId?: string };
    if (c.setSinkId && (c.sinkId ?? '') !== s.prefs.outId) c.setSinkId(s.prefs.outId).catch(() => {});
    if (!noise) {
      noise = actx.createBuffer(1, actx.sampleRate, actx.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    return { a: actx, vol: vol * 0.5 };
  } catch { return null; }
}
function burst(a: AudioContext, at: number, dur: number, type: BiquadFilterType, freq: number, q: number, gain: number) {
  const src = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
  src.buffer = noise; f.type = type; f.frequency.value = freq; f.Q.value = q;
  g.gain.setValueAtTime(Math.max(0.0001, gain), at); g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  src.connect(f).connect(g).connect(out(a, ID));
  src.start(at, Math.random() * 0.5); src.stop(at + dur + 0.02);
  src.onended = () => g.disconnect();
}
function tone(a: AudioContext, at: number, f0: number, f1: number, dur: number, gain: number) {
  const o = a.createOscillator(), g = a.createGain();
  o.frequency.setValueAtTime(f0, at); o.frequency.exponentialRampToValueAtTime(f1, at + dur);
  g.gain.setValueAtTime(Math.max(0.0001, gain), at); g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g).connect(out(a, ID)); o.start(at); o.stop(at + dur + 0.02);
  o.onended = () => g.disconnect();
}
/** The whole slide's sound, laid out at once: the new weight's hiss on the powder (louder and brighter the faster it
 *  goes), a clack for every weight struck, and a drop for every one that goes off. */
function soundSlide(s: Slide) {
  const au = audio();
  if (!au) return;
  const { a, vol } = au, t0 = a.currentTime + 0.02, last = (s.frames[0]?.length ?? 2) / 2 - 1;
  const src = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
  src.buffer = noise; src.loop = true; f.type = 'bandpass'; f.Q.value = 0.8; f.frequency.value = 2400;
  g.gain.setValueAtTime(0.0001, t0);
  for (let k = 1; k < s.frames.length; k++) {
    const p = s.frames[k - 1], c = s.frames[k], at = t0 + (k * s.ms) / 1000;
    const v = c[last * 2] < 0 || p[last * 2] < 0 ? 0 : Math.hypot(c[last * 2] - p[last * 2], c[last * 2 + 1] - p[last * 2 + 1]) / s.ms * 1000;      // inches a second
    g.gain.linearRampToValueAtTime(0.0001 + vol * 0.16 * Math.min(1, v / 150), at);
    f.frequency.linearRampToValueAtTime(1400 + v * 14, at);
  }
  const end = t0 + (s.frames.length * s.ms) / 1000;
  g.gain.linearRampToValueAtTime(0.0001, end + 0.05);
  src.connect(f).connect(g).connect(out(a, ID)); src.start(t0); src.stop(end + 0.1);
  src.onended = () => g.disconnect();
  for (const h of s.hits) { const at = t0 + h.t / 1000; burst(a, at, 0.03, 'bandpass', 2600, 4, vol * (0.4 + 0.8 * h.s)); tone(a, at, 1500, 900, 0.04, vol * 0.25 * (0.3 + h.s)); }
  for (const o of s.gone) {
    const at = t0 + o.t / 1000 + 0.12;
    if (o.end) { burst(a, at, 0.09, 'lowpass', 500, 1, vol * 0.9); tone(a, at, 140, 60, 0.14, vol * 0.5); }
    else burst(a, at, 0.07, 'bandpass', 900, 2, vol * 0.6);
  }
}

let listening = false;
function listen() {
  if (listening) return;
  listening = true;
  hooks.fit.push((d) => {
    if (d.id !== ID) return;
    if (d.op !== 'slide') { if ((d.state as Board | undefined) && !(d.state as Board).scored?.length) useLocal.setState({ scoredAt: 0 }); return; }
    const frames = d.frames as number[][], ms = Number(d.ms) || 33;
    const slide: Slide = { who: String(d.who ?? ''), frames, ms, t0: performance.now(), after: d.after as Board, ...readSlide(frames, ms) };
    useLocal.setState({ slide });
    soundSlide(slide);
    window.setTimeout(() => {
      if (useLocal.getState().slide !== slide) return;
      useLocal.setState({ slide: null, scoredAt: slide.after.scored?.length ? performance.now() : 0 });
      useStore.setState((s) => ({ fits: { ...s.fits, [ID]: slide.after } }));
    }, slide.frames.length * slide.ms + 60);
  });
}
const useBoard = () => useStore((s) => s.fits[ID] as Board | null | undefined);
const nameOf = (id: string | null | undefined) => (id ? useStore.getState().users[id]?.name ?? 'Somebody' : '');

/** Every weight just now: [x, y, who, fade] (x < 0: gone). During a slide, from its frames (the new weight is the last
 *  one); one that has gone carries on a little way past the edge, fading, before it is gone. */
function pucksNow(b: Board | null | undefined, t: number): [number, number, number, number][] {
  const s = useLocal.getState().slide;
  if (s) {
    const el = t - s.t0, f = Math.min(s.frames.length - 1, Math.max(0, el / s.ms)), k = Math.floor(f), u = f - k;
    const a = s.frames[k], c = s.frames[Math.min(k + 1, s.frames.length - 1)];
    const whos = [...(b?.pucks ?? []).map((p) => p.who), s.after.pucks[s.after.pucks.length - 1]?.who ?? 0];
    return whos.map((who, i) => {
      if (a[i * 2] < 0 || c[i * 2] < 0) {
        const o = s.gone.find((g) => g.i === i), dt = o ? el - o.t : 1e9;
        if (!o || dt < 0 || dt > 420) return [-1, 0, who, 0];
        return [o.x + o.vx * dt, o.y + o.vy * dt, who, 1 - dt / 420];
      }
      return [a[i * 2] + (c[i * 2] - a[i * 2]) * u, a[i * 2 + 1] + (c[i * 2 + 1] - a[i * 2 + 1]) * u, who, 1];
    });
  }
  return (b?.pucks ?? []).map((p) => (p.live ? [p.x, p.y, p.who, 1] : [-1, 0, p.who, 0]));
}
/** Every frame; or, given `busy`, only while that says something is moving (and once more whenever the game or a slide
 *  changes): the table in the room sits still between throws, and must not keep the page drawing every frame meanwhile. */
function useTicker(draw: (t: number) => void, deps: unknown[], busy?: () => boolean) {
  useEffect(() => {
    let raf = 0;
    const go = (t: number) => { raf = 0; draw(t); if (!busy || busy()) raf = requestAnimationFrame(go); };
    raf = requestAnimationFrame(go);
    const off = busy ? useLocal.subscribe(() => { if (!raf) raf = requestAnimationFrame(go); }) : undefined;
    return () => { cancelAnimationFrame(raf); off?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

// ── in the room: the weights on the table, and a click to open it ──
export function ShuffleRoom({ layout, mini }: { layout: FitLayout; mini: boolean }) {
  listen();
  const b = useBoard();
  const at = layout.things.shuffle as number[];        // the table's top: x, y, width (its length), height (its width)
  const ref = useRef<HTMLCanvasElement>(null);
  const open = useLocal((s) => s.open);
  // (./spots) both players at the end it is thrown from, facing down the table: the one throwing at the end itself, the
  // other just behind; whoever has it open only to watch, along the far end
  const me = useStore((s) => s.me?.id ?? '');
  const seat = b ? b.seats.indexOf(me) : -1, live = !!b?.on && !b.over, go = live && b!.seats[b!.turn] === me;
  const SP = gameSpots(layout, 'shuffle');
  useGameSpot(layout, mini, seat >= 0 && (live || open) ? (go ? 'shuffle-go' : 'shuffle-wait') : open ? 'shuffle-watch' : null, go ? SP.go : seat >= 0 ? SP.wait : SP.watch);
  const S = 4;
  const last = useRef<{ c: CanvasRenderingContext2D | null; key: string }>({ c: null, key: '' });
  useTicker((t) => {
    const c = ref.current?.getContext('2d');
    if (!c) return;
    const pucks = pucksNow(b, t);
    // drawn again only when a weight has moved (left as it is while nobody plays, not redrawn every frame)
    const key = `${at.join(',')}|${pucks.map(([x, y, who, fade]) => `${x.toFixed(2)},${y.toFixed(2)},${who},${fade.toFixed(3)}`).join(' ')}`;
    if (last.current.c === c && last.current.key === key) return;
    last.current = { c, key };
    c.clearRect(0, 0, at[2] * S, at[3] * S);
    for (const [x, y, who, fade] of pucks) {
      if (x < 0 || x > LENGTH + 2) continue;
      c.globalAlpha = fade;
      c.beginPath(); c.arc((x / LENGTH) * at[2] * S, (0.5 + y / (HALF * 2)) * at[3] * S, 4, 0, Math.PI * 2);
      c.fillStyle = COLORS[who]; c.fill(); c.lineWidth = 1.5; c.strokeStyle = '#111'; c.stroke();
    }
    c.globalAlpha = 1;
  }, [b], () => !!useLocal.getState().slide);
  return (
    <>
      <canvas ref={ref} className="gr-mini" width={at[2] * S} height={at[3] * S} style={{ left: at[0], top: at[1], width: at[2], height: at[3], zIndex: at[1] + at[3] + 10 }} />
      <i className="gr-hot" title="Shuffleboard: click to play or watch" style={{ left: at[0] - 4, top: at[1] - 4, width: at[2] + 8, height: at[3] + 12, zIndex: 3 }}
        onClick={(e) => { e.stopPropagation(); if (!mini) useLocal.setState({ open: true }); }} />
      {open && !mini && createPortal(<Overlay layout={layout} />, document.querySelector('.main-view') ?? document.body)}
    </>
  );
}

// ── large ──
const W = 1000, H = 418;                      // the whole table along the top (X0..X1), the scoring end close up below, the strength bar under it
const X0 = 30, X1 = 960, TY = 30, TH = (X1 - X0) * ((HALF * 2) / LENGTH);
const Z0 = LINES.one - 14, ZY = 128, ZH = 246, ZK = ZH / (HALF * 2 + 6);       // the close up: from just before the 1 line, ZK dots an inch
const GUT = 3.2, TROUGH = 3.5, PAD = 2.6;     // inches: the gutter either side, the trough past the end, the padded bumper behind it

/** The sand on the wood: the same scatter of grains every time (a small fixed random). */
const GRAINS = (() => { let s = 7; const r = () => ((s = (s * 16807) % 2147483647) / 2147483647); return Array.from({ length: 1400 }, () => [r() * LENGTH, (r() * 2 - 1) * HALF, r()]); })();

function drawTable(c: CanvasRenderingContext2D, x: (v: number) => number, y: (v: number) => number, k: number) {
  const top = y(-HALF), bot = y(HALF), ex = x(LENGTH);
  // the cabinet round it
  const cab = c.createLinearGradient(0, y(-HALF - GUT - 1.4), 0, y(HALF + GUT + 1.4)); cab.addColorStop(0, '#3a2414'); cab.addColorStop(0.5, '#24160c'); cab.addColorStop(1, '#3a2414');
  c.fillStyle = cab; c.fillRect(x(-4), y(-HALF - GUT - 1.4), x(LENGTH + TROUGH + PAD + 1.2) - x(-4), y(HALF + GUT + 1.4) - y(-HALF - GUT - 1.4));
  c.fillStyle = 'rgba(255,210,150,0.18)'; c.fillRect(x(-4), y(-HALF - GUT - 1.4), x(LENGTH + TROUGH + PAD + 1.2) - x(-4), Math.max(1, 0.25 * k));
  // the gutters, troughs: dark at the bottom, lit along the far lip
  for (const [a, z] of [[-HALF - GUT, -HALF], [HALF, HALF + GUT]]) {
    const gg = c.createLinearGradient(0, y(a), 0, y(z)); gg.addColorStop(0, '#1a0f08'); gg.addColorStop(0.5, '#0a0604'); gg.addColorStop(1, '#22140a');
    c.fillStyle = gg; c.fillRect(x(0), y(a), x(LENGTH) - x(0), y(z) - y(a));
  }
  c.fillStyle = 'rgba(255,220,170,0.22)'; c.fillRect(x(0), y(HALF + GUT) - Math.max(1, 0.3 * k), x(LENGTH) - x(0), Math.max(1, 0.3 * k));
  // the trough past the end, and the padded bumper behind it, with its buttons
  const tg = c.createLinearGradient(ex, 0, x(LENGTH + TROUGH), 0); tg.addColorStop(0, '#060403'); tg.addColorStop(1, '#1c120a');
  c.fillStyle = tg; c.fillRect(ex, y(-HALF - GUT), x(LENGTH + TROUGH) - ex, y(HALF + GUT) - y(-HALF - GUT));
  const px0 = x(LENGTH + TROUGH), px1 = x(LENGTH + TROUGH + PAD);
  const pg = c.createLinearGradient(px0, 0, px1, 0); pg.addColorStop(0, '#5a1414'); pg.addColorStop(0.35, '#9a2a24'); pg.addColorStop(1, '#3a0c0c');
  c.fillStyle = pg; c.fillRect(px0, y(-HALF - GUT), px1 - px0, y(HALF + GUT) - y(-HALF - GUT));
  if (k > 6) for (let v = -HALF - GUT + 2.2; v < HALF + GUT; v += 4.4) {
    c.fillStyle = 'rgba(0,0,0,0.45)'; c.beginPath(); c.arc((px0 + px1) / 2, y(v), 0.35 * k, 0, Math.PI * 2); c.fill();
    c.fillStyle = 'rgba(255,190,170,0.3)'; c.beginPath(); c.arc((px0 + px1) / 2 - 0.1 * k, y(v) - 0.1 * k, 0.15 * k, 0, Math.PI * 2); c.fill();
  }
  // the wood, its boards, and the scoring zones tinted
  const wood = c.createLinearGradient(0, top, 0, bot); wood.addColorStop(0, '#ecd09a'); wood.addColorStop(0.5, '#e2c088'); wood.addColorStop(1, '#cfa870');
  c.fillStyle = wood; c.fillRect(x(0), top, ex - x(0), bot - top);
  c.strokeStyle = 'rgba(120,80,40,0.22)'; c.lineWidth = 1;
  for (let v = -HALF + 2.5; v < HALF; v += 2.5) { c.beginPath(); c.moveTo(x(0), y(v)); c.lineTo(ex, y(v)); c.stroke(); }
  for (const [a, z, tint] of [[LINES.one, LINES.two, 'rgba(70,120,190,0.10)'], [LINES.two, LINES.three, 'rgba(200,150,40,0.14)'], [LINES.three, LENGTH, 'rgba(190,50,30,0.16)']] as [number, number, string][]) {
    c.fillStyle = tint; c.fillRect(x(a), top, x(z) - x(a), bot - top);
  }
  // sanded: grains of powder, light and dark
  const gs = Math.max(1, 0.16 * k);
  for (const [gx, gy, r] of GRAINS) {
    const sx = x(gx);
    if (sx < -2 || sx > c.canvas.width + 2) continue;
    c.fillStyle = r < 0.6 ? 'rgba(255,250,235,0.55)' : 'rgba(110,70,30,0.28)';
    c.fillRect(sx, y(gy), gs, gs);
  }
  // the varnish's gloss, a soft band of light along the wood
  const gl = c.createLinearGradient(0, y(-HALF * 0.75), 0, y(-HALF * 0.05)); gl.addColorStop(0, 'rgba(255,255,255,0)'); gl.addColorStop(0.5, 'rgba(255,250,235,0.22)'); gl.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = gl; c.fillRect(x(0), y(-HALF * 0.75), ex - x(0), y(-HALF * 0.05) - y(-HALF * 0.75));
  c.fillStyle = 'rgba(0,0,0,0.18)'; c.fillRect(x(0), bot - Math.max(1, 0.35 * k), ex - x(0), Math.max(1, 0.35 * k));      // the near edge in shade
  c.fillStyle = 'rgba(255,255,255,0.25)'; c.fillRect(x(0), top, ex - x(0), Math.max(1, 0.2 * k));
  // the lines and their numbers, and the 4 over the end
  c.lineWidth = Math.max(1, 0.4 * k);
  const font = `${Math.max(12, 6 * k)}px VT323, monospace`;
  c.textAlign = 'center'; c.font = font;
  for (const [at, label] of [[LINES.foul, ''], [LINES.one, '1'], [LINES.two, '2'], [LINES.three, '3']] as [number, string][]) {
    c.strokeStyle = label ? '#8a2a1a' : '#3a2a1a';
    c.beginPath(); c.moveTo(x(at), top); c.lineTo(x(at), bot); c.stroke();
    if (label && x(at) > 0) { c.fillStyle = 'rgba(138,42,26,0.6)'; c.fillText(label, (x(at) + x(at === LINES.three ? LENGTH : at === LINES.two ? LINES.three : LINES.two)) / 2, y(0) + 4 * Math.max(1, k / 4)); }
  }
  c.fillStyle = 'rgba(255,215,120,0.75)'; c.font = `${Math.max(12, 3.4 * k)}px VT323, monospace`;
  c.fillText('4', (ex + x(LENGTH + TROUGH)) / 2, k > 6 ? y(-HALF - GUT * 0.35) : y(-HALF) - 2);
}
/** The table drawn once, both views, and copied to the canvas each frame (the grains alone are thousands of dots). */
let tableCache: HTMLCanvasElement | null = null;
void document.fonts?.ready.then(() => { tableCache = null; });             // (drawn again once its numbers' font has come)

function drawPuck(c: CanvasRenderingContext2D, px: number, py: number, r: number, who: number, edge: number | null) {
  if (edge !== null && px + r > edge) {                                                    // hanging over the end: its shadow falls into the trough
    c.save(); c.beginPath(); c.rect(edge, py - r * 3, r * 4, r * 6); c.clip();
    c.beginPath(); c.ellipse(px + r * 0.7, py + r * 0.5, r * 1.1, r * 0.95, 0, 0, Math.PI * 2); c.fillStyle = 'rgba(0,0,0,0.55)'; c.fill(); c.restore();
  }
  c.beginPath(); c.arc(px + r * 0.15, py + r * 0.2, r, 0, Math.PI * 2); c.fillStyle = 'rgba(0,0,0,0.3)'; c.fill();
  const g = c.createRadialGradient(px - r * 0.3, py - r * 0.3, r * 0.1, px, py, r); g.addColorStop(0, '#ffffff'); g.addColorStop(0.25, '#c8ccd4'); g.addColorStop(1, '#6a6e78');
  c.beginPath(); c.arc(px, py, r, 0, Math.PI * 2); c.fillStyle = g; c.fill();
  c.beginPath(); c.arc(px, py, r * 0.62, 0, Math.PI * 2); c.fillStyle = COLORS[who]; c.fill();
  c.beginPath(); c.arc(px - r * 0.2, py - r * 0.2, r * 0.22, 0, Math.PI * 2); c.fillStyle = 'rgba(255,255,255,0.35)'; c.fill();
}

function Overlay({ layout }: { layout: FitLayout }) {
  useWatching(ID);
  void layout;
  const b = useBoard();
  const me = useStore((s) => s.me?.id ?? '');
  const slide = useLocal((s) => s.slide);
  const ref = useRef<HTMLCanvasElement>(null);
  const aim = useRef<{ y: number; sx: number; sy: number; x: number; yy: number } | null>(null);
  const downOn = useRef(false);
  const close = () => useLocal.setState({ open: false });
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, []);
  const myTurn = !!b && b.on && !b.over && b.seats[b.turn] === me && (b.thrown[b.turn] ?? 0) < 4 && !slide;
  const fx = (v: number) => X0 + (v / LENGTH) * (X1 - X0), fy = (v: number) => TY + TH / 2 + (v / (HALF * 2)) * TH;
  const zx = (v: number) => X0 + (v - Z0) * ZK, zy = (v: number) => ZY + ZH / 2 + v * ZK;
  const pull = (a: NonNullable<typeof aim.current>) => ({ power: Math.min(1, Math.max(0, (a.sx - a.x) / 300)), angle: Math.max(-0.12, Math.min(0.12, (a.sy - a.yy) / 900)) });
  useTicker((t) => {
    const c = ref.current?.getContext('2d');
    if (!c) return;
    if (!tableCache) {
      tableCache = document.createElement('canvas'); tableCache.width = W; tableCache.height = H;
      const tc = tableCache.getContext('2d')!;
      tc.fillStyle = '#120c08'; tc.fillRect(0, 0, W, H);
      drawTable(tc, fx, fy, (X1 - X0) / LENGTH);
      tc.save(); tc.beginPath(); tc.rect(0, ZY - 8, W, ZH + 16); tc.clip();
      drawTable(tc, zx, zy, ZK);
      tc.restore();
    }
    c.drawImage(tableCache, 0, 0);
    const kf = (X1 - X0) / LENGTH, rf = Math.max(3, R * kf);
    const ps = pucksNow(b, t);
    const scored = !slide ? b?.scored ?? [] : [];
    ps.forEach(([x, y, who, fade]) => {
      if (x < 0) return;
      c.globalAlpha = fade;
      if (x <= LENGTH + TROUGH) drawPuck(c, fx(x), fy(y), rf * (x > LENGTH ? fade : 1), who, fade < 1 ? null : fx(LENGTH));
      if (x >= Z0 - R) drawPuck(c, zx(x), zy(y), R * ZK * (x > LENGTH ? 0.6 + 0.4 * fade : 1), who, fade < 1 ? null : zx(LENGTH));
      c.globalAlpha = 1;
    });
    // the weights that scored, ringed in gold, their points rising off them
    const sAt = useLocal.getState().scoredAt, since = sAt ? t - sAt : 1e9;
    for (const [i, pts] of scored) {
      const p = b?.pucks[i];
      if (!p || !p.live) continue;
      const glow = 0.6 + 0.4 * Math.sin(t / 160);
      for (const [px, py, r] of [[fx(p.x), fy(p.y), rf], [zx(p.x), zy(p.y), R * ZK]]) {
        c.save(); c.shadowColor = '#ffd24a'; c.shadowBlur = 10; c.strokeStyle = `rgba(255,210,74,${glow})`; c.lineWidth = r > 8 ? 3 : 2;
        c.beginPath(); c.arc(px, py, r + (r > 8 ? 4 : 2), 0, Math.PI * 2); c.stroke(); c.restore();
      }
      const rise = Math.min(1, since / 1400);
      c.globalAlpha = since > 1e8 ? 1 : Math.min(1, 1.6 - rise);
      c.fillStyle = '#ffe08a'; c.strokeStyle = '#3a2000'; c.lineWidth = 3; c.font = '30px VT323, monospace'; c.textAlign = 'center';
      const ty = zy(p.y) - R * ZK - 10 - (since > 1e8 ? 0 : rise * 26);
      c.strokeText(`+${pts}`, zx(p.x), ty); c.fillText(`+${pts}`, zx(p.x), ty);
      c.globalAlpha = 1;
    }
    // hits: a flash where a weight is struck, and the clack written over it
    if (slide) for (const h of slide.hits) {
      const dt = t - slide.t0 - h.t;
      if (dt < 0 || dt > 650) continue;
      const u = dt / 650, a = 1 - u;
      for (const [px, py, r] of h.x >= Z0 ? [[fx(h.x), fy(h.y), rf * 2.4], [zx(h.x), zy(h.y), R * ZK * 1.8]] : [[fx(h.x), fy(h.y), rf * 2.4]]) {
        c.strokeStyle = `rgba(255,255,230,${a * 0.9})`; c.lineWidth = 2;
        c.beginPath(); c.arc(px, py, r * (0.6 + u * 0.9), 0, Math.PI * 2); c.stroke();
      }
      const cx = h.x >= Z0 ? zx(h.x) : fx(h.x), cy = h.x >= Z0 ? zy(h.y) - R * ZK * 2.2 : TY - 6;
      c.globalAlpha = a; c.font = `${20 + 10 * h.s}px VT323, monospace`; c.textAlign = 'center';
      c.fillStyle = '#fff6d8'; c.strokeStyle = '#2a1408'; c.lineWidth = 3;
      c.strokeText('clack!', cx, cy - u * 12); c.fillText('clack!', cx, cy - u * 12);
      c.globalAlpha = 1;
    }
    const a = aim.current;
    if (myTurn) {                                                   // the weight in hand, and which way it is pointed (not how far it will go)
      const y = a ? a.y : 0, { power, angle } = a ? pull(a) : { power: 0, angle: 0 };
      drawPuck(c, fx(0), fy(y), rf, b!.turn, null);
      if (a) {
        c.setLineDash([5, 5]); c.strokeStyle = 'rgba(255,255,255,0.7)'; c.lineWidth = 2;
        c.beginPath(); c.moveTo(fx(0), fy(y)); c.lineTo(fx(Math.cos(angle) * 40), fy(y + Math.sin(angle) * 40)); c.stroke(); c.setLineDash([]);
        // strength: steady while gentle, shaking more and more past half, so a firm throw is judged by feel
        const by = H - 30, bw = 300, wob = Math.max(0, power - 0.5) * 0.7 * (Math.sin(t / 37) * 0.6 + Math.sin(t / 23 + 1.3) * 0.4);
        const shown = Math.max(0, Math.min(1, power + wob));
        c.fillStyle = 'rgba(0,0,0,0.55)'; c.fillRect(X0 - 2, by - 2, bw + 4, 12);
        c.fillStyle = 'rgba(255,255,255,0.08)'; c.fillRect(X0, by, bw, 8);
        const bg = c.createLinearGradient(X0, 0, X0 + bw, 0); bg.addColorStop(0, '#f2c230'); bg.addColorStop(1, '#ff8a3a');
        c.fillStyle = bg; c.fillRect(X0, by, bw * shown, 8);
        c.fillStyle = 'rgba(255,255,255,0.7)'; c.font = '14px VT323, monospace'; c.textAlign = 'left'; c.fillText('STRENGTH', X0 + bw + 10, by + 8);
      }
    }
  }, [b, me, slide, myTurn]);
  const pos = (e: ReactPointerEvent<HTMLCanvasElement>) => { const r = pageRect(e.currentTarget); return { x: ((e.clientX - r.left) * W) / r.width, y: ((e.clientY - r.top) * H) / r.height }; };
  const down = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!myTurn) return;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* (still works inside) */ }
    const p = pos(e);
    // where across the table: from whichever view was pressed (anywhere else, the middle)
    const across = p.y >= TY - 20 && p.y <= TY + TH + 20 ? ((p.y - (TY + TH / 2)) / TH) * HALF * 2 : p.y >= ZY - 10 && p.y <= ZY + ZH + 10 ? (p.y - (ZY + ZH / 2)) / ZK : 0;
    aim.current = { y: Math.max(-HALF + R, Math.min(HALF - R, across)), sx: p.x, sy: p.y, x: p.x, yy: p.y };
  };
  const move = (e: ReactPointerEvent<HTMLCanvasElement>) => { const a = aim.current; if (a) { const p = pos(e); a.x = p.x; a.yy = p.y; } };
  const up = () => {
    const a = aim.current;
    aim.current = null;
    if (!a || !myTurn) return;
    const { power, angle } = pull(a);
    if (power < 0.03) return;
    send({ t: 'fit', id: ID, op: 'throw', y: a.y, angle, power });
  };
  const seats = b?.seats ?? [null, null];
  const sitting = seats.includes(me);
  const thrower = slide ? (slide.who === me ? 'You throw' : `${nameOf(slide.who)} throws`) : '';
  const say = !b || !b.on && !b.over ? `${b?.last ? `${b.last} ` : ''}${seats[0] && seats[1] ? 'Both seats are taken: start when ready.' : 'Take red or blue (or both, to practise). First to 15.'}`
    : b.over ? b.last
      : slide ? `${thrower} (${NAMES[slide.after.pucks[slide.after.pucks.length - 1]?.who ?? 0]})…`
        : `${b.last ? `${b.last} ` : ''}${myTurn ? `Your throw (${NAMES[b.turn]}, ${4 - b.thrown[b.turn]} left): press anywhere on the table, drag back and let go.` : b.thrown[b.turn] >= 4 ? 'Clearing the table…' : `${NAMES[b.turn]} (${nameOf(seats[b.turn])}) to throw.`}`;
  return (
    <div className="gr-overlay" onMouseDown={(e) => { downOn.current = e.target === e.currentTarget; }} onClick={(e) => { if (downOn.current && e.target === e.currentTarget) close(); }}>
      <div className="gr-box" onClick={(e) => e.stopPropagation()}>
        <header className="gr-tabs">
          <b className="mg-title">Shuffleboard</b>
          {[0, 1].map((n) => (
            <span key={n} className={`gr-player${b?.on && b.turn === n ? ' turn' : ''}`} style={{ borderColor: COLORS[n] }}>
              <b style={{ color: COLORS[n] }}>{NAMES[n]}</b> {seats[n] ? nameOf(seats[n]) : (!b?.on || b.over) ? <button onClick={() => send({ t: 'fit', id: ID, op: 'sit', seat: n })}>Sit</button> : 'empty'} <b>{b?.score[n] ?? 0}</b>
            </span>
          ))}
          <span />
          {sitting && (!b?.on || b.over) && seats[0] && seats[1] && <button onClick={() => send({ t: 'fit', id: ID, op: 'start' })}>{b?.over ? 'Play again' : 'Start'}</button>}
          {sitting && <button onClick={() => { send({ t: 'fit', id: ID, op: 'leave' }); close(); }}>Leave</button>}
          <button onClick={close} title="Back to the room (Esc)">Close</button>
        </header>
        <div className="gr-fill"><canvas ref={ref} className={`gr-table${myTurn ? ' mine' : ''}`} style={{ '--ar': W / H } as CSSProperties} width={W} height={H} onPointerDown={down} onPointerMove={move} onPointerUp={up} /></div>
        <p className="gr-say">{say}</p>
      </div>
    </div>
  );
}
