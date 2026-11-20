// The game room's games, on the page (server/basement/gameroom.ts keeps the rules; scripts/basement/gameroom.py draws
// the room). In the room: the balls on the pool table and the darts in the board, small, as they really are; click the
// table or the board to open it large.
// Pool: drag back from the cue ball and let go (the further, the harder); click the cue-ball face beside the table first
// to strike it off centre (top for follow, bottom for draw, either side for side spin; near the edge the tip may slip).
// With ball in hand, click where the cue ball goes first. The aim line runs only as far as the first ball or cushion.
// Everybody watching sees the shooter's cue as it is lined up, the stroke, and hears the balls (quietly, at the
// soundboard's volume, and only with the table open).
// Darts: the sight is where the dart will go; it sways (more the longer you hold your arm up). Press to draw back: a bar
// swings up and down beside the board; let go as it passes the middle. Early or late, the dart drops high or low, and
// the hand always adds a little: the dart is seen flying in from the sight to where it lands.
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { hooks, send, setPrefs, soundGain, useStore } from '../store';
import { hush, onLeavingRoom, out, useWatching } from './sound';
import { thumbOf } from '../sites';
import { gameShot, sharedGame } from '../games';
import { watchScreens } from '../voice';
import { BALL_COLORS, BALL_R, cueOverlaps, PLAY_H, PLAY_W, pockets } from './pool';
import type { PoolWorld } from './pool';
import type { FitProps } from './index';
import { BowlingRoom } from './bowling.tsx';
import { HoldemRoom, holdemSays } from './holdem.tsx';
import { ShuffleRoom } from './shuffle.tsx';
import { gameSpots, useGameSpot } from './spots';
import { clickRadio, radioSays } from '../components/Music';
import { pageRect } from '../device';

const ID = 'gameroom';
const HOUSE = 'house';
type Mode = '301' | '501' | 'cricket' | 'clock';
type Dart = { x: number; y: number; pts: number; label: string };
type Darts = {
  players: string[]; scores: number[]; turn: number; darts: Dart[]; last: { who: string; darts: Dart[]; bust: boolean; total?: number } | null;
  start: number; on: boolean; winner: string | null; mode?: Mode; marks?: number[][];
};
type Pool = { seats: (string | null)[]; world: PoolWorld | null; busyUntil: number };
type State = { pool: Pool; darts: Darts };
type Spin = { x: number; y: number };
/** A ball going down on the shot being played: from the frame it went, where it was, and the pocket it went into. */
type Sink = { k: number; x: number; y: number; px: number; py: number };
type Shot = { frames: number[][]; ms: number; t0: number; after: State; cue: { angle: number; power: number; brk: boolean }; who: string; sink: (Sink | null)[]; shakeAt: number };
/** A dart as it arrives: where it was aimed (the sight) and where it landed, and what it made of the turn. */
type Flight = { dart: Dart; from: { x: number; y: number }; who: string; label: string; bust: boolean; won: boolean; end: boolean; total: number; mode: Mode; t0: number };
const STROKE_MS = 120;                    // the cue going through before the balls move
const FLY_MS = 180;                       // a dart in the air

/** A shot being played back (the same for the room and the big table), which game is open large, the cue or sight of
 *  whoever is lining up (from their 'aim'), and the darts that have just arrived. */
const useLocal = create<{
  shot: Shot | null; open: '' | 'pool' | 'darts';
  poolAim: { who: string; angle: number; pull: number; spin: Spin; at: number } | null;
  dartAim: { who: string; x: number; y: number; at: number } | null;
  flights: Flight[];
}>()(() => ({ shot: null, open: '', poolAim: null, dartAim: null, flights: [] }));
/** Opens the pool table or the dartboard large (or neither: ''), from outside the room (Play Games' Game Room tab). It
 *  shows once the room is the game room. */
export const openTable = (which: '' | 'pool' | 'darts') => useLocal.setState({ open: which });
// closing a game (or being taken out of the room) silences the shot still playing
useLocal.subscribe((s, p) => { if (p.open && s.open !== p.open) hush('gameroom'); });
onLeavingRoom(() => useLocal.setState({ open: '' }));

// ── sound: made up on the spot (filtered noise and short tones), quiet, at the soundboard's volume ──
let actx: AudioContext | null = null, noise: AudioBuffer | null = null;
function audio(game: 'pool' | 'darts') {
  const s = useStore.getState();
  const vol = s.voice.deafened ? 0 : soundGain(s.prefs.soundVol);
  if (!vol || useLocal.getState().open !== game || document.hidden) return null;     // (only with the game open in front of me)
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
    return { a: actx, vol: vol * 0.5 };
  } catch { return null; }
}
/** When (performance.now() ms) in the sound clock's time. */
const atTime = (a: AudioContext, when: number) => a.currentTime + Math.max(0, (when - performance.now()) / 1000);
function burst(a: AudioContext, at: number, dur: number, type: BiquadFilterType, freq: number, q: number, gain: number) {
  const src = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
  src.buffer = noise; f.type = type; f.frequency.value = freq; f.Q.value = q;
  g.gain.setValueAtTime(Math.max(0.0001, gain), at); g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  src.connect(f).connect(g).connect(out(a, 'gameroom'));
  src.start(at, Math.random() * 0.4); src.stop(at + dur + 0.02);
  src.onended = () => g.disconnect();
}
function tone(a: AudioContext, at: number, f0: number, f1: number, dur: number, gain: number) {
  const o = a.createOscillator(), g = a.createGain();
  o.frequency.setValueAtTime(f0, at); o.frequency.exponentialRampToValueAtTime(f1, at + dur);
  g.gain.setValueAtTime(Math.max(0.0001, gain), at); g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g).connect(out(a, 'gameroom')); o.start(at); o.stop(at + dur + 0.02);
  o.onended = () => g.disconnect();
}
const SOUND = {
  clack: (a: AudioContext, at: number, s: number, v: number) => { burst(a, at, 0.025, 'bandpass', 2500, 5, 0.9 * v * Math.pow(s, 0.6)); },
  rail: (a: AudioContext, at: number, s: number, v: number) => { burst(a, at, 0.07, 'lowpass', 420, 1, 0.9 * v * s); tone(a, at, 90, 55, 0.09, 0.5 * v * s); },
  pocket: (a: AudioContext, at: number, s: number, v: number) => {
    const k = 0.4 + 0.6 * s;
    for (let i = 0; i < 4; i++) burst(a, at + i * 0.032 + Math.random() * 0.01, 0.03, 'bandpass', 650 + Math.random() * 700, 3, 0.6 * v * k * (1 - i * 0.2));
    tone(a, at, 120, 70, 0.14, 0.35 * v * k);
  },
  strike: (a: AudioContext, at: number, p: number, v: number) => { burst(a, at, 0.014, 'bandpass', 1500, 2, 0.6 * v * (0.3 + p)); tone(a, at, 220, 150, 0.03, 0.2 * v); },
  thunk: (a: AudioContext, at: number, v: number) => { burst(a, at, 0.06, 'lowpass', 900, 1, 1.1 * v); tone(a, at, 160, 85, 0.09, 0.6 * v); },
};

let listening = false;
function listen() {
  if (listening) return;
  listening = true;
  hooks.fit.push((d) => {
    if (d.id !== ID) return;
    const me = useStore.getState().me?.id ?? '';
    if (d.op === 'shot') {
      const frames = d.frames as number[][], ms = Number(d.ms) || 33, t0 = performance.now() + STROKE_MS;
      const cue = { angle: Number(d.cue?.angle) || 0, power: Number(d.cue?.power) || 0, brk: !!d.cue?.brk };
      // the balls that go down, and into which pocket (the nearest to where they were last seen)
      const sink: (Sink | null)[] = [];
      const pk = pockets();
      for (let n = 0; n < (frames[0]?.length ?? 0) / 2; n++) {
        sink[n] = null;
        for (let k = 1; k < frames.length; k++) {
          if (frames[k][n * 2] < 0 && frames[k - 1][n * 2] >= 0) {
            const x = frames[k - 1][n * 2], y = frames[k - 1][n * 2 + 1];
            const p = pk.reduce((b, q) => (Math.hypot(q.x - x, q.y - y) < Math.hypot(b.x - x, b.y - y) ? q : b));
            sink[n] = { k, x, y, px: p.x, py: p.y };
            break;
          }
        }
      }
      const sounds = (Array.isArray(d.sounds) ? d.sounds : []) as number[][];
      const firstClack = sounds.find((s) => s[1] === 0);
      const shakeAt = cue.brk && cue.power > 0.8 && firstClack ? t0 + firstClack[0] * ms : 0;
      useLocal.setState({ shot: { frames, ms, t0, after: d.after, cue, who: String(d.who ?? ''), sink, shakeAt }, poolAim: null });
      const au = audio('pool');
      if (au) {
        SOUND.strike(au.a, atTime(au.a, t0 - 8), cue.power, au.vol);
        for (const [f, k, s] of sounds) {
          const at = atTime(au.a, t0 + f * ms);
          // (the engine settles the whole rack in one frame: a break is heard as the cluster it really is)
          if (k === 0 && cue.brk && firstClack && f === firstClack[0]) for (let i = 0; i < 6; i++) SOUND.clack(au.a, at + i * 0.007 + Math.random() * 0.006, s * (1 - i * 0.13), au.vol);
          else if (k === 0) SOUND.clack(au.a, at, s, au.vol); else if (k === 1) SOUND.rail(au.a, at, s, au.vol); else SOUND.pocket(au.a, at, s, au.vol);
        }
      }
      window.setTimeout(() => {
        const s = useLocal.getState().shot;
        if (s?.after === d.after) { useLocal.setState({ shot: null }); useStore.setState((st) => ({ fits: { ...st.fits, [ID]: d.after } })); }
      }, STROKE_MS + frames.length * ms + 50);
    } else if (d.op === 'aim' && d.who !== me) {
      if (d.game === 'pool') useLocal.setState({ poolAim: { who: String(d.who), angle: Number(d.angle) || 0, pull: Number(d.pull) || 0, spin: { x: Number(d.spin?.x) || 0, y: Number(d.spin?.y) || 0 }, at: performance.now() } });
      else if (d.game === 'darts') useLocal.setState({ dartAim: { who: String(d.who), x: Number(d.x) || 0, y: Number(d.y) || 0, at: performance.now() } });
    } else if (d.op === 'dart' && d.dart) {
      const t0 = performance.now();
      const f: Flight = { dart: d.dart, from: { x: Number(d.from?.x) || 0, y: Number(d.from?.y) || 0 }, who: String(d.who), label: String(d.label ?? d.dart.label), bust: !!d.bust, won: !!d.won, end: !!d.end, total: Number(d.total) || 0, mode: (d.mode ?? '301') as Mode, t0 };
      useLocal.setState((s) => ({ flights: [...s.flights.filter((x) => t0 - x.t0 < 4000).slice(-8), f], dartAim: null }));
      const au = audio('darts');
      if (au) SOUND.thunk(au.a, atTime(au.a, t0 + FLY_MS), f.dart.pts || f.dart.label !== 'Miss' ? au.vol : au.vol * 0.5);
    }
  });
}
const useGame = () => useStore((s) => s.fits[ID] as State | null | undefined);
const nameOf = (id: string | null | undefined) => (!id ? '' : id === HOUSE ? 'The house' : useStore.getState().users[id]?.name ?? 'Somebody');

/** Where every ball is just now: part way through a shot being played back, or as the table stands. [x, y] or null if down. */
function ballsNow(world: PoolWorld | null, t: number): ([number, number] | null)[] {
  const s = useLocal.getState().shot;
  if (s) {
    const f = Math.min(s.frames.length - 1, Math.max(0, (t - s.t0) / s.ms)), k = Math.floor(f), u = f - k;
    const a = s.frames[k], b = s.frames[Math.min(k + 1, s.frames.length - 1)];
    return Array.from({ length: a.length / 2 }, (_, n) => (a[n * 2] < 0 ? null : [a[n * 2] + ((b[n * 2] < 0 ? a[n * 2] : b[n * 2]) - a[n * 2]) * u, a[n * 2 + 1] + ((b[n * 2 + 1] < 0 ? a[n * 2 + 1] : b[n * 2 + 1]) - a[n * 2 + 1]) * u]));
  }
  return (world?.balls ?? []).map((b) => (b.potted ? null : [b.x, b.y]));
}
/** The number of the ball in place n of the world's list (which is in the order they were racked, not by number). */
const numAt = (w: PoolWorld | null | undefined, n: number) => w?.balls[n]?.num ?? n;
/** Redraws every animation frame while something is moving (and once when the game changes). */
function useFrames(draw: (t: number) => void, deps: unknown[]) {
  const shot = useLocal((s) => s.shot);
  useEffect(() => {
    let raf = 0;
    const go = (t: number) => { draw(t); if (useLocal.getState().shot) raf = requestAnimationFrame(go); };
    raf = requestAnimationFrame(go);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shot, ...deps]);
}

/** A ball as the room shows it: small, flat, no number. */
function drawBall(g: CanvasRenderingContext2D, num: number, x: number, y: number, r: number) {
  const col = num === 0 ? '#f4f1e6' : BALL_COLORS[num];
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2);
  g.fillStyle = num >= 9 ? '#f4f1e6' : col; g.fill();
  if (num >= 9) { g.save(); g.clip(); g.fillStyle = col; g.fillRect(x - r, y - r * 0.55, r * 2, r * 1.1); g.restore(); }
  const sh = g.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.1, x, y, r);
  sh.addColorStop(0, 'rgba(255,255,255,0.35)'); sh.addColorStop(0.45, 'rgba(255,255,255,0)'); sh.addColorStop(1, 'rgba(0,0,0,0.35)');
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fillStyle = sh; g.fill();
}

// ── balls that roll: each keeps which way its number (and its stripe) faces, turned as it travels ──
type V3 = [number, number, number];
const norm = (v: V3): V3 => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function turn(v: V3, k: V3, th: number): V3 {
  const c = Math.cos(th), s = Math.sin(th), kv = k[0] * v[0] + k[1] * v[1] + k[2] * v[2], x = cross(k, v);
  return norm([v[0] * c + x[0] * s + k[0] * kv * (1 - c), v[1] * c + x[1] * s + k[1] * kv * (1 - c), v[2] * c + x[2] * s + k[2] * kv * (1 - c)]);
}
/** n: where the number faces (z is up, at me); a: the stripe's axis. Turned by however far the ball has moved since it
 *  was last drawn (a ball that jumps, put down by hand or respotted, is not spun). */
const orient = new Map<number, { n: V3; a: V3; x: number; y: number }>();
function rolled(num: number, x: number, y: number) {
  let o = orient.get(num);
  if (!o) { o = { n: [0, 0, 1], a: [0, 1, 0], x, y }; orient.set(num, o); }
  const dx = x - o.x, dy = y - o.y, d = Math.hypot(dx, dy);
  if (d > 0.01 && d < 80) { const k: V3 = [-dy / d, dx / d, 0]; o.n = turn(o.n, k, d / BALL_R); o.a = turn(o.a, k, d / BALL_R); }
  o.x = x; o.y = y;
  return o;
}
/** The part of a ball round the direction p (within acos(h) of it) as I see it from above: its edge where it faces me,
 *  and the ball's own outline where it turns away. */
function cap(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, p: V3, h: number, fill: string) {
  const s = Math.sqrt(1 - h * h), e1 = norm(cross(p, Math.abs(p[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0])), e2 = cross(p, e1);
  let seen = 0;
  g.beginPath();
  for (let i = 0; i < 28; i++) {
    const t = (i / 28) * Math.PI * 2, c = Math.cos(t), sn = Math.sin(t);
    const q: V3 = [h * p[0] + s * (c * e1[0] + sn * e2[0]), h * p[1] + s * (c * e1[1] + sn * e2[1]), h * p[2] + s * (c * e1[2] + sn * e2[2])];
    let x = q[0], y = q[1];
    if (q[2] >= 0) seen++;
    else { const l = Math.hypot(x, y) || 1; x /= l; y /= l; }
    if (i) g.lineTo(cx + x * r, cy + y * r); else g.moveTo(cx + x * r, cy + y * r);
  }
  if (!seen) return;
  g.closePath(); g.fillStyle = fill; g.fill();
}
function drawRolled(g: CanvasRenderingContext2D, num: number, x: number, y: number, r: number, o: { n: V3; a: V3 }, alpha = 1) {
  g.globalAlpha = alpha;
  g.beginPath(); g.ellipse(x + r * 0.25, y + r * 0.35, r * 0.95, r * 0.6, 0, 0, Math.PI * 2); g.fillStyle = 'rgba(0,0,0,0.28)'; g.fill();   // its shadow on the felt
  g.save();
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.clip();
  g.fillStyle = num === 0 ? '#f4f1e6' : BALL_COLORS[num]; g.fillRect(x - r, y - r, r * 2, r * 2);
  if (num >= 9) { cap(g, x, y, r, o.a, 0.55, '#f4f1e6'); cap(g, x, y, r, [-o.a[0], -o.a[1], -o.a[2]], 0.55, '#f4f1e6'); }
  if (num === 0) cap(g, x, y, r, o.n, 0.965, '#c8202a');                    // the cue ball's red spot, so it is seen to roll
  else {
    cap(g, x, y, r, o.n, 0.88, '#fff');
    if (o.n[2] > 0.3) {
      const k = 0.55 + 0.45 * o.n[2];
      g.fillStyle = '#111'; g.font = `bold ${Math.round(r * 0.75 * k)}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(String(num), x + r * 0.88 * o.n[0], y + r * 0.88 * o.n[1] + 0.5);
    }
  }
  g.restore();
  // round: darker toward the edge away from the lamp, a bright spot where it catches the light
  const sh = g.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.1, x, y, r);
  sh.addColorStop(0, 'rgba(255,255,255,0.4)'); sh.addColorStop(0.45, 'rgba(255,255,255,0)'); sh.addColorStop(1, 'rgba(0,0,0,0.4)');
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fillStyle = sh; g.fill();
  g.globalAlpha = 1;
}

// ───────────────────────── in the room ─────────────────────────

function MiniTable({ felt }: { felt: number[] }) {
  const game = useGame();
  const ref = useRef<HTMLCanvasElement>(null);
  const S = 4;                                                       // drawn at four dots to the room's one, so the balls are round
  useFrames((t) => {
    const g = ref.current?.getContext('2d');
    if (!g) return;
    g.clearRect(0, 0, felt[2] * S, felt[3] * S);
    const k = (felt[2] * S) / PLAY_W;
    const w = game?.pool.world ?? null;
    ballsNow(w, t).forEach((p, n) => p && drawBall(g, numAt(w, n), p[0] * k, p[1] * k, Math.max(3, BALL_R * k)));
  }, [game]);
  return <canvas ref={ref} className="gr-mini" width={felt[2] * S} height={felt[3] * S} style={{ left: felt[0], top: felt[1], width: felt[2], height: felt[3], zIndex: felt[1] + felt[3] + 2 }} />;
}

/** Each player's darts have flights of their own colour, by their place in the game. */
const DART_COLORS = ['#e0483a', '#3a86e0', '#f2c230', '#46c068'];
const dartColor = (d: Darts | undefined, who: string | undefined) => DART_COLORS[Math.max(0, d?.players.indexOf(who ?? '') ?? 0) % 4];

function MiniBoard({ board }: { board: number[] }) {
  const game = useGame();
  const d = game?.darts;
  const shown = d ? (d.darts.length ? d.darts : d.last?.darts ?? []) : [];
  const col = dartColor(d, d ? (d.darts.length ? d.players[d.turn] : d.last?.who) : undefined);
  const [cx, cy, r] = board;
  return <>{shown.map((p, k) => <i key={k} className="gr-dart" style={{ left: cx + p.x * r * 0.8 - 1.5, top: cy + p.y * r * 0.8 - 1.5, background: col, zIndex: 100 }} />)}</>;
}

/** The TVs over the bar: what the projector upstairs shows. Somebody's shared screen (a still, once a minute, as the
 *  projector has it; one each when two are sharing), or what is on in the Player; otherwise they are off. A click opens it.
 *  A share of a game is a screen for its kind (games.ts), drawn to the TV's shape, in place of the still. */
function BarTVs({ at, mini }: { at: number[][]; mini: boolean }) {
  const users = useStore((s) => s.users);
  const presence = useStore((s) => s.presence);
  const previews = useStore((s) => s.previews);
  const voiceChannel = useStore((s) => s.voice.channelId);
  const playing = useStore((s) => s.music.current);
  const watching = useStore((s) => s.view.kind === 'stage');
  const sharers = Object.values(users).filter((u) => presence[u.id]?.voice?.sharing && presence[u.id]?.state !== 'offline');
  const mine = sharers.filter((u) => presence[u.id]!.voice!.channelId === voiceChannel);
  const on = mine.length ? mine : sharers;
  const thumb = playing ? thumbOf(playing.videoId) : null;
  const open = (k: number) => {
    if (mini) return;
    const u = on.length ? on[k % on.length] : null;
    if (u) { setPrefs({ roomOpen: true }); void watchScreens(presence[u.id]!.voice!.channelId); }
    else if (playing && voiceChannel != null) useStore.setState({ view: { kind: 'theatre' } });
  };
  return (
    <>
      {at.map((r, k) => {
        const u = on.length ? on[k % on.length] : null;
        const g = u ? sharedGame(presence[u.id]) : null;
        const title = u ? `${u.name} is sharing their screen: click to watch` : playing ? `The Player: ${playing.title}` : 'Nothing on';
        return (
          <div key={k} className={`bar-tv${u || playing ? ' on' : ''}${g ? ' game' : ''}`} title={title} style={{ left: r[0], top: r[1], width: r[2], height: r[3], zIndex: 4 }}
            onClick={(e) => { e.stopPropagation(); open(k); }}>
            {g ? <img src={gameShot(g, r[2], r[3])} alt="" draggable={false} />
              : u ? (!watching && previews[u.id] ? <img src={previews[u.id]} alt="" /> : <i className={`static${watching ? ' held' : ''}`} />)
              : playing ? (thumb ? <img src={thumb} alt="" /> : <i className="static held" />) : null}
            {u && !g && <small>{u.name}</small>}{/* (a game has no name over it: on a screen this small the name would hide the picture. Pointing at it says who) */}
          </div>
        );
      })}
    </>
  );
}

export function Room({ layout, mini }: FitProps) {
  listen();
  const open = (which: 'pool' | 'darts') => (e: ReactMouseEvent) => { e.stopPropagation(); if (!mini) useLocal.setState({ open: which }); };
  const felt = layout.things.felt as number[], board = layout.things.board as number[];
  const which = useLocal((s) => s.open);
  // walking to the game (./spots): pool's two cues each at their end of the table, facing it; darts' thrower on the
  // oche and the other players just behind it; whoever has either open only to watch, off to one side
  const g = useGame(), me = useStore((s) => s.me?.id ?? '');
  const cue = g?.pool.seats.indexOf(me) ?? -1, P = gameSpots(layout, 'pool');
  useGameSpot(layout, mini, cue >= 0 ? `pool-play${cue}` : which === 'pool' ? 'pool-watch' : null, cue >= 0 ? P.play?.[cue] : P.watch);
  const d = g?.darts, D = gameSpots(layout, 'darts');
  const dIn = !!d?.players.includes(me), dLive = !!d?.on && !d.winner, dGo = dLive && d!.players[d!.turn] === me;
  const dRole = dIn && (dLive || which === 'darts') ? (dGo ? 'darts-go' : 'darts-wait') : which === 'darts' ? 'darts-watch' : null;
  useGameSpot(layout, mini, dRole, dGo ? D.go : dIn ? D.wait : D.watch);
  return (
    <>
      <MiniTable felt={felt} />
      <MiniBoard board={board} />
      <i className="gr-hot" title="The pool table: click to play or watch" style={{ left: felt[0] - 8, top: felt[1] - 8, width: felt[2] + 16, height: felt[3] + 26, zIndex: 3 }} onClick={open('pool')} />
      {/* the jukebox on the back wall is the Player (as the boombox upstairs is): drawn at 132-158, 56-106 by scripts/basement/gameroom.py */}
      {!mini && <i className="gr-hot" title={radioSays('The jukebox')} style={{ left: 131, top: 55, width: 29, height: 52, zIndex: 3 }} onClick={(e) => { e.stopPropagation(); clickRadio(160, 64, 'The jukebox'); }} />}
      <i className="gr-hot" title="The dartboard: click to play or watch" style={{ left: board[0] - 24, top: board[1] - 18, width: 48, height: 36, zIndex: 3 }} onClick={open('darts')} />
      {which && !mini && createPortal(<Overlay which={which} layout={layout} />, document.querySelector('.main-view') ?? document.body)}
      {layout.things.tvs && <BarTVs at={layout.things.tvs as number[][]} mini={mini} />}
      <ShuffleRoom layout={layout} mini={mini} />
      <BowlingRoom layout={layout} mini={mini} />
      {/* (mini golf's green is out of the room for now: ./minigolf is kept for when it comes back) */}
      <HoldemRoom layout={layout} mini={mini} />
    </>
  );
}

// ───────────────────────── large ─────────────────────────

function Overlay({ which, layout }: { which: 'pool' | 'darts'; layout: FitProps['layout'] }) {
  useWatching('gameroom', which);
  const close = () => useLocal.setState({ open: '' });
  const downOn = useRef(false);                           // (a click that began on the backdrop: a drag that ended there is not one)
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, []);
  return (
    <div className="gr-overlay" onMouseDown={(e) => { downOn.current = e.target === e.currentTarget; }} onClick={(e) => { if (downOn.current && e.target === e.currentTarget) close(); }}>
      <div className="gr-box" onClick={(e) => e.stopPropagation()}>
        <header className="gr-tabs">
          <b className="mg-title">{which === 'pool' ? 'Pool' : 'Darts'}</b>
          <span />
          <button onClick={close} title="Back to the room (Esc)">Close</button>
        </header>
        {which === 'pool' ? <PoolTable layout={layout} /> : <DartBoard layout={layout} />}
      </div>
    </div>
  );
}

/** Back to wherever I would be, putting the cue or the darts down (walking over to play is ./spots). */
const putDown = () => send({ t: 'place', place: '' });

// ── the big table ──
const PAD = 40, SIDE = 72, TW = PLAY_W + PAD * 2, CW = TW + SIDE, CH = PLAY_H + PAD * 2;
/** The cue-ball face beside the table, clicked to say where the tip strikes. */
const FACE = { x: TW + SIDE / 2, y: PAD + 46, r: 26 };
const AIM_MAX = 260;                       // the aim line goes no further than this, even with nothing in the way
const PULL_MAX = 240;

function seeded(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/** The table itself, which never changes: drawn once and kept. Grained wood rails lit along the top, cushions with
 *  angled jaws at the pockets and a lit nose, felt with a faint nap, and the spin panel at the side. */
let art: HTMLCanvasElement | null = null;
function tableArt(): HTMLCanvasElement {
  if (art) return art;
  const c = document.createElement('canvas');
  c.width = CW; c.height = CH;
  const g = c.getContext('2d')!;
  const rnd = seeded(11);
  g.fillStyle = '#140804'; g.fillRect(0, 0, CW, CH);
  const wood = g.createLinearGradient(0, 0, 0, CH); wood.addColorStop(0, '#6e3c1f'); wood.addColorStop(0.5, '#4c2615'); wood.addColorStop(1, '#3a1a0c');
  g.fillStyle = wood; g.fillRect(4, 4, TW - 8, CH - 8);
  // the grain: long wavering lines down the length of each rail
  const grain = (x0: number, y0: number, w: number, h: number, alongX: boolean) => {
    g.save(); g.beginPath(); g.rect(x0, y0, w, h); g.clip();
    const across = alongX ? h : w, len = alongX ? w : h;
    for (let i = 0; i < across * 1.4; i++) {
      const off = (alongX ? y0 : x0) + rnd() * across, amp = 0.5 + rnd() * 1.6, f = 0.004 + rnd() * 0.012, ph = rnd() * 6;
      g.beginPath();
      for (let s = 0; s <= len; s += 10) {
        const v = off + Math.sin(s * f + ph) * amp + Math.sin(s * f * 3.3 + ph * 2) * amp * 0.3;
        if (alongX) { if (s) g.lineTo(x0 + s, v); else g.moveTo(x0 + s, v); } else if (s) g.lineTo(v, y0 + s); else g.moveTo(v, y0 + s);
      }
      g.strokeStyle = rnd() < 0.72 ? `rgba(24,8,0,${0.07 + rnd() * 0.16})` : `rgba(255,205,150,${0.03 + rnd() * 0.06})`;
      g.lineWidth = 0.5 + rnd() * 1.3; g.stroke();
    }
    g.restore();
  };
  grain(4, 4, TW - 8, PAD - 4, true); grain(4, CH - PAD, TW - 8, PAD - 4, true);
  grain(4, PAD, PAD - 4, PLAY_H, false); grain(TW - PAD, PAD, PAD - 4, PLAY_H, false);
  g.fillStyle = 'rgba(255,222,175,0.16)'; g.fillRect(4, 4, TW - 8, 2);                       // the lamp catches the top edge
  g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(4, CH - 6, TW - 8, 2);
  // behind the cushions, where the jaws open: the dark of the pocket mouths
  const K = 13;
  g.fillStyle = '#081c10'; g.fillRect(PAD - K, PAD - K, PLAY_W + K * 2, PLAY_H + K * 2);
  // the cushions: one between each pair of pockets, cut back at an angle at both ends (the jaws)
  const CJ = 33, CB = 21, SJ = 30, SB = 23, X = (v: number) => PAD + v, Y = (v: number) => PAD + v;
  const W = PLAY_W, H = PLAY_H, M = W / 2;
  const rails: { pts: number[][]; g0: number[]; g1: number[]; nose: number[][] }[] = [
    { pts: [[CB, -K], [M - SB, -K], [M - SJ, 0], [CJ, 0]], g0: [0, -K], g1: [0, 0], nose: [[CJ, 0], [M - SJ, 0]] },
    { pts: [[M + SB, -K], [W - CB, -K], [W - CJ, 0], [M + SJ, 0]], g0: [0, -K], g1: [0, 0], nose: [[M + SJ, 0], [W - CJ, 0]] },
    { pts: [[CB, H + K], [M - SB, H + K], [M - SJ, H], [CJ, H]], g0: [0, H + K], g1: [0, H], nose: [[CJ, H], [M - SJ, H]] },
    { pts: [[M + SB, H + K], [W - CB, H + K], [W - CJ, H], [M + SJ, H]], g0: [0, H + K], g1: [0, H], nose: [[M + SJ, H], [W - CJ, H]] },
    { pts: [[-K, CB], [-K, H - CB], [0, H - CJ], [0, CJ]], g0: [-K, 0], g1: [0, 0], nose: [[0, CJ], [0, H - CJ]] },
    { pts: [[W + K, CB], [W + K, H - CB], [W, H - CJ], [W, CJ]], g0: [W + K, 0], g1: [W, 0], nose: [[W, CJ], [W, H - CJ]] },
  ];
  for (const r of rails) {
    const gr = g.createLinearGradient(X(r.g0[0]), Y(r.g0[1]), X(r.g1[0]), Y(r.g1[1]));
    gr.addColorStop(0, '#0c3d23'); gr.addColorStop(0.7, '#17673c'); gr.addColorStop(1, '#22844e');
    g.beginPath(); r.pts.forEach(([x, y], k) => (k ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y)))); g.closePath(); g.fillStyle = gr; g.fill();
  }
  // the felt, brighter under the lamp, with a faint nap
  const felt = g.createRadialGradient(PAD + W / 2, PAD + H / 2, 40, PAD + W / 2, PAD + H / 2, W * 0.65);
  felt.addColorStop(0, '#2a9a5c'); felt.addColorStop(1, '#17643c');
  g.fillStyle = felt; g.fillRect(PAD, PAD, W, H);
  const nap = document.createElement('canvas'); nap.width = nap.height = 64;
  const ng = nap.getContext('2d')!;
  for (let i = 0; i < 900; i++) { ng.fillStyle = rnd() < 0.5 ? `rgba(255,255,255,${rnd() * 0.07})` : `rgba(0,0,0,${rnd() * 0.08})`; ng.fillRect(Math.floor(rnd() * 64), Math.floor(rnd() * 64), 1 + Math.floor(rnd() * 2), 1); }
  g.fillStyle = g.createPattern(nap, 'repeat')!; g.fillRect(PAD, PAD, W, H);
  // the cushions' shadow on the felt (the lamp is above and a little to the top left) and the lit nose of each
  const shade = (x: number, y: number, w: number, h: number, dx: number, dy: number) => {
    const s = g.createLinearGradient(x, y, x + dx, y + dy); s.addColorStop(0, 'rgba(0,0,0,0.3)'); s.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = s; g.fillRect(x, y, w, h);
  };
  shade(PAD, PAD, W, 8, 0, 8); shade(PAD, PAD, 8, H, 8, 0);
  g.strokeStyle = 'rgba(185,250,205,0.42)'; g.lineWidth = 1.5;
  for (const r of rails) { g.beginPath(); g.moveTo(X(r.nose[0][0]), Y(r.nose[0][1])); g.lineTo(X(r.nose[1][0]), Y(r.nose[1][1])); g.stroke(); }
  g.strokeStyle = 'rgba(255,255,255,0.08)'; g.lineWidth = 1;                                   // the head string and the foot spot
  g.beginPath(); g.moveTo(PAD + W * 0.26, PAD); g.lineTo(PAD + W * 0.26, PAD + H); g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.25)'; g.beginPath(); g.arc(PAD + W * 0.72, PAD + H / 2, 2.5, 0, Math.PI * 2); g.fill();
  // the pockets: a leather lip round a deep hole
  for (const p of pockets()) {
    const lip = g.createRadialGradient(PAD + p.x, PAD + p.y, p.r, PAD + p.x, PAD + p.y, p.r + 6);
    lip.addColorStop(0, '#3a2414'); lip.addColorStop(1, '#1a0e06');
    g.beginPath(); g.arc(PAD + p.x, PAD + p.y, p.r + 5, 0, Math.PI * 2); g.fillStyle = lip; g.fill();
    const hole = g.createRadialGradient(PAD + p.x - 3, PAD + p.y - 3, 1, PAD + p.x, PAD + p.y, p.r);
    hole.addColorStop(0, '#000'); hole.addColorStop(0.8, '#060606'); hole.addColorStop(1, '#1c1c1c');
    g.beginPath(); g.arc(PAD + p.x, PAD + p.y, p.r, 0, Math.PI * 2); g.fillStyle = hole; g.fill();
  }
  // mother-of-pearl diamonds along the rails
  const diamond = (x: number, y: number) => {
    const dg = g.createLinearGradient(x - 3, y - 4, x + 3, y + 4); dg.addColorStop(0, '#fffaf0'); dg.addColorStop(1, '#c8bca0');
    g.fillStyle = dg; g.beginPath(); g.moveTo(x, y - 4); g.lineTo(x + 3, y); g.lineTo(x, y + 4); g.lineTo(x - 3, y); g.closePath(); g.fill();
  };
  for (let k = 1; k < 8; k++) if (k !== 4) { diamond(PAD + (W * k) / 8, PAD / 2 - 5); diamond(PAD + (W * k) / 8, CH - PAD / 2 + 5); }
  for (let k = 1; k < 4; k++) { diamond(PAD / 2 - 5, PAD + (H * k) / 4); diamond(TW - PAD / 2 + 5, PAD + (H * k) / 4); }
  // the spin panel: a leather pad with a cue ball's face on it
  const pad = g.createLinearGradient(TW, 0, CW, 0); pad.addColorStop(0, '#0e0704'); pad.addColorStop(0.15, '#241309'); pad.addColorStop(1, '#1a0d06');
  g.fillStyle = pad; g.fillRect(TW, 0, SIDE, CH);
  g.fillStyle = '#d8c8a8'; g.font = '11px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('SPIN', FACE.x, FACE.y - FACE.r - 11);
  const fg = g.createRadialGradient(FACE.x - 8, FACE.y - 9, 3, FACE.x, FACE.y, FACE.r);
  fg.addColorStop(0, '#ffffff'); fg.addColorStop(0.6, '#ece6d6'); fg.addColorStop(1, '#a8a090');
  g.beginPath(); g.arc(FACE.x, FACE.y, FACE.r, 0, Math.PI * 2); g.fillStyle = fg; g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.18)'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(FACE.x - FACE.r, FACE.y); g.lineTo(FACE.x + FACE.r, FACE.y); g.moveTo(FACE.x, FACE.y - FACE.r); g.lineTo(FACE.x, FACE.y + FACE.r); g.stroke();
  g.setLineDash([2, 3]); g.strokeStyle = 'rgba(190,40,40,0.45)';                                 // past this the tip may slip
  g.beginPath(); g.arc(FACE.x, FACE.y, FACE.r * 0.7, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
  g.fillStyle = 'rgba(216,200,168,0.6)'; g.font = '10px sans-serif';
  g.fillText('top: follow', FACE.x, FACE.y + FACE.r + 13); g.fillText('low: draw', FACE.x, FACE.y + FACE.r + 25);
  return (art = c);
}

/** A cue, drawn back `back` from the ball at (x, y), pointing along (ux, uy): blue tip, white ferrule, maple shaft and
 *  a dark butt with a band, and its shadow on the felt. */
function drawCue(g: CanvasRenderingContext2D, x: number, y: number, ux: number, uy: number, back: number) {
  const L = 340, w0 = 3.4, w1 = 8, a = Math.atan2(-uy, -ux);
  const shape = () => { g.beginPath(); g.moveTo(back, -w0 / 2); g.lineTo(back + L, -w1 / 2); g.lineTo(back + L, w1 / 2); g.lineTo(back, w0 / 2); g.closePath(); };
  g.save(); g.translate(x + 6, y + 9); g.rotate(a); shape(); g.fillStyle = 'rgba(0,0,0,0.22)'; g.fill(); g.restore();
  g.save(); g.translate(x, y); g.rotate(a);
  const cg = g.createLinearGradient(back, 0, back + L, 0);
  const at = (d: number) => Math.min(1, d / L);
  cg.addColorStop(0, '#3f7fc8'); cg.addColorStop(at(4), '#3f7fc8'); cg.addColorStop(at(4.5), '#f2eee2'); cg.addColorStop(at(11), '#f2eee2');
  cg.addColorStop(at(11.5), '#ead0a0'); cg.addColorStop(0.6, '#d4b07a'); cg.addColorStop(0.62, '#1a0a04'); cg.addColorStop(0.64, '#c8a060');
  cg.addColorStop(0.66, '#5a2a12'); cg.addColorStop(1, '#2a1008');
  shape(); g.fillStyle = cg; g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.28)'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(back + 5, -w0 / 2 + 0.8); g.lineTo(back + L, -w1 / 2 + 1.2); g.stroke();
  g.restore();
}
/** How far the aim line runs from the cue ball: to where it would first touch a ball or reach a cushion, or AIM_MAX. */
function aimReach(cx: number, cy: number, ux: number, uy: number, balls: ([number, number] | null)[]) {
  let best = AIM_MAX;
  const R2 = (BALL_R * 2) ** 2;
  balls.forEach((p, n) => {
    if (!n || !p) return;
    const bx = p[0] - cx, by = p[1] - cy, proj = bx * ux + by * uy;
    if (proj <= 0) return;
    const d2 = bx * bx + by * by - proj * proj;
    if (d2 < R2) best = Math.min(best, Math.max(0, proj - Math.sqrt(R2 - d2)));
  });
  if (ux > 0) best = Math.min(best, (PLAY_W - BALL_R - cx) / ux); else if (ux < 0) best = Math.min(best, (BALL_R - cx) / ux);
  if (uy > 0) best = Math.min(best, (PLAY_H - BALL_R - cy) / uy); else if (uy < 0) best = Math.min(best, (BALL_R - cy) / uy);
  return Math.max(0, best);
}
const balls7 = (g: 'solid' | 'stripe') => (g === 'solid' ? [1, 2, 3, 4, 5, 6, 7] : [9, 10, 11, 12, 13, 14, 15]);
/** "the 11", "the 3 and the 12" */
const theBalls = (ns: number[]) => { const t = ns.map((n) => `the ${n}`); return t.length > 1 ? `${t.slice(0, -1).join(', ')} and ${t[t.length - 1]}` : t[0] ?? ''; };

function PoolTable({ layout }: { layout: FitProps['layout'] }) {
  const game = useGame();
  const me = useStore((s) => s.me?.id ?? '');
  const shot = useLocal((s) => s.shot);
  const watch = useLocal((s) => s.poolAim);
  const pool = game?.pool, w = pool?.world ?? null;
  const seats = pool?.seats ?? [null, null];
  const mine = seats.indexOf(me);
  const myTurn = !!w && mine >= 0 && w.phase === 'aim' && w.turn === (mine === 0 ? 'user' : 'ai') && !shot;
  const turnSeat = w ? (w.turn === 'user' ? 0 : 1) : -1;
  const ref = useRef<HTMLCanvasElement>(null);
  const aim = useRef<{ x: number; y: number; down: boolean; from?: { x: number; y: number } } | null>(null);
  const spin = useRef<Spin>({ x: 0, y: 0 });
  const sentAt = useRef(0);
  const [, redraw] = useState(0);

  const draw = (t: number) => {
    const el = ref.current, g = el?.getContext('2d');
    if (!g || !el) return;
    g.drawImage(tableArt(), 0, 0);
    const s = useLocal.getState().shot;
    // a hard break shakes the table, a little, for a moment
    el.style.transform = s && s.shakeAt && t >= s.shakeAt && t < s.shakeAt + 150 ? `translate(${(Math.random() * 2 - 1) * 3}px, ${(Math.random() * 2 - 1) * 3}px)` : '';
    const balls = ballsNow(w, t);
    balls.forEach((p, n) => p && drawRolled(g, numAt(w, n), PAD + p[0], PAD + p[1], BALL_R, rolled(n, p[0], p[1])));
    // a ball going down slides into the middle of the pocket and drops away
    if (s) {
      const f = (t - s.t0) / s.ms;
      s.sink.forEach((k, n) => {
        if (!k || f < k.k || f >= k.k + 9) return;
        const u = (f - k.k) / 9, e = Math.min(1, u * 1.6), x = k.x + (k.px - k.x) * e, y = k.y + (k.py - k.y) * e;
        drawRolled(g, numAt(w, n), PAD + x, PAD + y, BALL_R * (1 - 0.65 * u), rolled(n, x, y), 1 - 0.7 * u);
      });
    }
    const cue = balls[0], a = aim.current;
    const bar = (pull: number) => { g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(PAD, CH - 26, PLAY_W, 10); g.fillStyle = pull > 200 ? '#ff5a4d' : '#f2c230'; g.fillRect(PAD, CH - 26, (PLAY_W * Math.min(PULL_MAX, pull)) / PULL_MAX, 10); };
    let shownSpin: Spin | null = null;
    if (s && cue && t < s.t0) {
      // the stroke: the cue goes through to the ball before anything moves
      const u = Math.max(0, 1 - (s.t0 - t) / STROKE_MS), back0 = BALL_R + 6 + s.cue.power * PULL_MAX * 0.6;
      drawCue(g, PAD + cue[0], PAD + cue[1], Math.cos(s.cue.angle), Math.sin(s.cue.angle), back0 + (BALL_R + 1 - back0) * u * u);
    } else if (!s && cue && w) {
      if (myTurn && a && (!w.ballInHand || a.down)) {
        // my cue: drawn back from the cue ball, the way it will go, as far as I have pulled it; the line as far as the first thing it meets
        const dx = cue[0] + PAD - a.x, dy = cue[1] + PAD - a.y, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
        const pull = a.down && a.from ? Math.min(PULL_MAX, Math.hypot(a.x - a.from.x, a.y - a.from.y)) : 0;
        const reach = aimReach(cue[0], cue[1], ux, uy, balls);
        if (reach > 2) {
          const x0 = PAD + cue[0] + ux * BALL_R, y0 = PAD + cue[1] + uy * BALL_R, x1 = PAD + cue[0] + ux * reach, y1 = PAD + cue[1] + uy * reach;
          const lg = g.createLinearGradient(x0, y0, x1, y1); lg.addColorStop(0, 'rgba(255,255,255,0.5)'); lg.addColorStop(1, 'rgba(255,255,255,0)');
          g.setLineDash([6, 6]); g.strokeStyle = lg; g.lineWidth = 2;
          g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); g.setLineDash([]);
        }
        drawCue(g, PAD + cue[0], PAD + cue[1], ux, uy, BALL_R + 6 + pull * 0.6);
        if (pull) bar(pull);
      } else if (!myTurn && watch && t - watch.at < 2000 && watch.who === seats[turnSeat]) {
        // the shooter's cue, as they line it up (no line: that is for the one shooting)
        drawCue(g, PAD + cue[0], PAD + cue[1], Math.cos(watch.angle), Math.sin(watch.angle), BALL_R + 6 + watch.pull * PULL_MAX * 0.6);
        if (watch.pull > 0.02) bar(watch.pull * PULL_MAX);
        shownSpin = watch.spin;
      }
    }
    if (myTurn) shownSpin = spin.current;
    if (shownSpin) {                                                     // where the tip will strike
      const sx = FACE.x + shownSpin.x * FACE.r, sy = FACE.y - shownSpin.y * FACE.r;
      g.beginPath(); g.arc(sx, sy, 4.5, 0, Math.PI * 2); g.fillStyle = Math.hypot(shownSpin.x, shownSpin.y) > 0.7 ? '#d04a3a' : '#3f7fc8'; g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 1; g.stroke();
    }
    if (myTurn && w!.ballInHand && a && !a.down && a.x < TW) { g.globalAlpha = 0.5; drawBall(g, 0, a.x, a.y, BALL_R); g.globalAlpha = 1; }
  };
  useFrames(draw, [game, me]);
  useEffect(() => { draw(performance.now()); });

  /** Tell the others how I am lining up (a few times a second). */
  const tellAim = (force = false) => {
    const a = aim.current, now = performance.now();
    if (!myTurn || !w || !a || (!force && now - sentAt.current < 100)) return;
    sentAt.current = now;
    const cue = w.balls[0], angle = Math.atan2(cue.y + PAD - a.y, cue.x + PAD - a.x);
    const pull = a.down && a.from ? Math.min(PULL_MAX, Math.hypot(a.x - a.from.x, a.y - a.from.y)) / PULL_MAX : 0;
    send({ t: 'fit', id: ID, game: 'pool', op: 'aim', angle, pull, spin: spin.current });
  };
  const at = (e: ReactMouseEvent<HTMLCanvasElement>) => { const r = pageRect(e.currentTarget); return { x: ((e.clientX - r.left) * CW) / r.width, y: ((e.clientY - r.top) * CH) / r.height }; };
  const move = (e: ReactMouseEvent<HTMLCanvasElement>) => {
    const p = at(e);
    if (p.x > TW && !aim.current?.down) return;                               // (over the spin panel: the cue stays where it was)
    aim.current = { ...(aim.current ?? { down: false }), ...p };
    tellAim();
    draw(performance.now());
  };
  const down = (e: ReactMouseEvent<HTMLCanvasElement>) => {
    if (!myTurn) return;
    const p = at(e);
    if (Math.hypot(p.x - FACE.x, p.y - FACE.y) <= FACE.r + 6) {               // where the tip will strike the cue ball
      let sx = (p.x - FACE.x) / FACE.r, sy = -(p.y - FACE.y) / FACE.r;
      const l = Math.hypot(sx, sy);
      if (l > 1) { sx /= l; sy /= l; }
      spin.current = { x: Math.round(sx * 100) / 100, y: Math.round(sy * 100) / 100 };
      tellAim(true);
      draw(performance.now());
      return;
    }
    if (p.x > TW) return;
    aim.current = { ...p, down: true, from: p };
  };
  const up = (e: ReactMouseEvent<HTMLCanvasElement>) => {
    const a = aim.current;
    if (!a?.down || !myTurn || !w) return;
    const p = at(e), pull = Math.hypot(p.x - a.from!.x, p.y - a.from!.y);
    aim.current = { ...p, down: false };
    if (w.ballInHand && pull < 6) {                                                        // put the cue ball down there
      const x = p.x - PAD, y = p.y - PAD;
      if (!cueOverlaps(w, x, y)) send({ t: 'fit', id: ID, game: 'pool', op: 'place', x, y });
      return;
    }
    const cue = w.balls[0];
    if (pull < 8) { tellAim(true); return; }                                               // (a click, not a pull: nothing)
    const angle = Math.atan2(cue.y + PAD - p.y, cue.x + PAD - p.x);
    send({ t: 'fit', id: ID, game: 'pool', op: 'shoot', angle, power: Math.min(1, pull / PULL_MAX), spin: spin.current });
    spin.current = { x: 0, y: 0 };
    redraw((n) => n + 1);
  };

  const groupOf = (seat: number): 'solid' | 'stripe' | null => { const g = w?.userGroup; if (!g) return null; return seat === 0 ? g : g === 'solid' ? 'stripe' : 'solid'; };
  const ls = w?.lastShot;
  const what = (() => {                                              // what the last shot did, in words
    if (!ls) return '';
    const who = nameOf(seats[ls.shooter === 'user' ? 0 : 1]), pots = ls.potted.filter((n) => n > 0);
    if (ls.event.startsWith('8 on the break')) return `${who} sinks the 8 on the break: it goes back on its spot. `;
    if (ls.scratch) return pots.length ? `${who} sinks ${theBalls(pots)}, but scratches. ` : `${who} scratches. `;
    if (ls.foul) return `${who}: ${ls.event.replace('Foul — ', 'foul, ')}. `;
    return pots.length ? `${who} sinks ${theBalls(pots)}. ` : `${who} pots nothing. `;
  })();
  const say = !w ? (seats[0] || seats[1] ? 'Waiting for a second player (or play the house).' : 'Take a cue to play.')
    : w.result ? `${what}${nameOf(seats[w.result.winner === 'user' ? 0 : 1])} wins: ${w.result.reason.toLowerCase()}.`
      : shot ? `${nameOf(shot.who)} shoots…`
        : `${what}${myTurn ? (w.ballInHand ? 'Ball in hand: click where the cue ball goes, then drag back from it to shoot.' : 'Your shot: drag back and let go. Click the ball beside the table for spin.') : `${nameOf(seats[turnSeat])}'s shot${w.ballInHand ? ' (ball in hand)' : ''}.`}`;
  // (while a shot rolls the trays wait for it: the world they read is the one from before)
  return (
    <div className="gr-game">
      <div className="gr-players">
        {[0, 1].map((n) => {
          const grp = groupOf(n);
          return (
            <div key={n} className={`gr-player${w && !w.result && turnSeat === n ? ' turn' : ''}`}>
              {seats[n] ? <b>{nameOf(seats[n])}{grp ? (grp === 'solid' ? ' · solids' : ' · stripes') : ''}</b> : mine < 0 ? <button onClick={() => send({ t: 'fit', id: ID, game: 'pool', op: 'sit', seat: n })}>Take cue {n + 1}</button> : <i>empty</i>}
              {seats[n] && w && (
                <div className="gr-tray" title={grp ? 'Sunk ones are greyed' : 'The table is open: the first ball potted after the break decides'}>
                  {grp ? balls7(grp).map((b) => <i key={b} className={`gr-chip${b >= 9 ? ' stripe' : ''}${w.balls.find((x) => x.num === b)?.potted ? ' sunk' : ''}`} style={{ '--c': BALL_COLORS[b] } as CSSProperties}><b>{b}</b></i>)
                    : <small>open table</small>}
                </div>
              )}
            </div>
          );
        })}
        <span className="gr-gap" />
        {mine >= 0 && !seats[1 - mine] && <button onClick={() => send({ t: 'fit', id: ID, game: 'pool', op: 'house' })}>Play the house</button>}
        {mine >= 0 && w?.result && <button onClick={() => send({ t: 'fit', id: ID, game: 'pool', op: 'rack' })}>Rack them up</button>}
        {mine >= 0 && <button onClick={() => { send({ t: 'fit', id: ID, game: 'pool', op: 'leave' }); putDown(); useLocal.setState({ open: '' }); }}>{w && !w.result ? 'Quit the game' : 'Put the cue down'}</button>}
      </div>
      <div className="gr-fill"><canvas ref={ref} className={`gr-table${myTurn ? ' mine' : ''}`} style={{ '--ar': CW / CH } as CSSProperties} width={CW} height={CH} onPointerMove={move}
        onPointerDown={(e) => { try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* (a pointer the page cannot hold: it still works inside) */ } down(e); }} onPointerUp={up}
        onPointerLeave={() => { if (aim.current && !aim.current.down) { aim.current = null; draw(performance.now()); } }} /></div>
      <p className="gr-say">{say}</p>
    </div>
  );
}

// ── darts ──
const ORDER = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];
const RINGS = { bull: 0.037, outer: 0.094, tIn: 0.582, tOut: 0.629, dIn: 0.953 };
const MODE_NAMES: Record<Mode, string> = { '301': '301', '501': '501', cricket: 'Cricket', clock: 'Round the Clock' };
const CRICKET = [20, 19, 18, 17, 16, 15, 25];
function wedge(r0: number, r1: number, k: number) {
  const a0 = ((k * 18 - 9 - 90) * Math.PI) / 180, a1 = ((k * 18 + 9 - 90) * Math.PI) / 180;
  const p = (r: number, a: number) => `${(r * Math.cos(a)).toFixed(4)} ${(r * Math.sin(a)).toFixed(4)}`;
  return `M${p(r0, a0)} L${p(r1, a0)} A${r1} ${r1} 0 0 1 ${p(r1, a1)} L${p(r0, a1)} A${r0} ${r0} 0 0 0 ${p(r0, a0)} Z`;
}
/** The board in its cabinet: sisal (a speckled grain over the colours), the wire between the beds, the numbers on
 *  their ring. On a board of radius 1 (the outside of the doubles). */
const BOARD_SVG = (
  <g>
    <defs>
      <linearGradient id="gr-wood" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#7a4424" /><stop offset="0.5" stopColor="#5a2e16" /><stop offset="1" stopColor="#3a1a0a" /></linearGradient>
      <radialGradient id="gr-back" r="0.7"><stop offset="0" stopColor="#2a1a10" /><stop offset="1" stopColor="#0e0804" /></radialGradient>
      <radialGradient id="gr-ring" r="0.5"><stop offset="0.75" stopColor="#1a1a1a" /><stop offset="1" stopColor="#060606" /></radialGradient>
      <linearGradient id="gr-barrel" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#6a6e74" /><stop offset="0.45" stopColor="#e8ecef" /><stop offset="1" stopColor="#585c62" /></linearGradient>
      <filter id="gr-sisal" x="-1.1" y="-1.1" width="2.2" height="2.2" filterUnits="userSpaceOnUse">
        <feTurbulence type="fractalNoise" baseFrequency="34" numOctaves="2" seed="4" result="n" />
        <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1.8 0 0 0 -0.62" result="dark" />
        <feComposite in="dark" in2="SourceGraphic" operator="in" />
      </filter>
      <filter id="gr-fleck" x="-1.1" y="-1.1" width="2.2" height="2.2" filterUnits="userSpaceOnUse">
        <feTurbulence type="fractalNoise" baseFrequency="52" numOctaves="1" seed="9" result="n" />
        <feColorMatrix in="n" type="matrix" values="0 0 0 0 1  0 0 0 0 0.95  0 0 0 0 0.85  1.6 0 0 0 -0.78" result="light" />
        <feComposite in="light" in2="SourceGraphic" operator="in" />
      </filter>
    </defs>
    {/* the cabinet: a wooden box, its back in shadow */}
    <rect x={-1.4} y={-1.4} width={2.8} height={2.8} fill="url(#gr-wood)" />
    <rect x={-1.36} y={-1.36} width={2.72} height={2.72} fill="url(#gr-back)" />
    <rect x={-1.4} y={-1.4} width={2.8} height={0.012} fill="rgba(255,220,170,0.25)" />
    <circle r={1.34} fill="rgba(0,0,0,0.5)" transform="translate(0.03 0.04)" />
    <circle r={1.32} fill="url(#gr-ring)" />
    <circle r={1.255} fill="none" stroke="#a8a8a8" strokeWidth={0.008} opacity={0.6} />
    {ORDER.map((num, k) => {
      const dark = k % 2 === 0, a = ((k * 18 - 90) * Math.PI) / 180;
      return (
        <g key={k}>
          <path d={wedge(RINGS.outer, RINGS.tIn, k)} fill={dark ? '#1c1c1c' : '#ecdcb4'} />
          <path d={wedge(RINGS.tIn, RINGS.tOut, k)} fill={dark ? '#c8202a' : '#1f8a4a'} />
          <path d={wedge(RINGS.tOut, RINGS.dIn, k)} fill={dark ? '#1c1c1c' : '#ecdcb4'} />
          <path d={wedge(RINGS.dIn, 1, k)} fill={dark ? '#c8202a' : '#1f8a4a'} />
          <text x={Math.cos(a) * 1.14} y={Math.sin(a) * 1.14 + 0.045} fontSize={0.13} fill="#eceff1" stroke="#000" strokeWidth={0.006} paintOrder="stroke" textAnchor="middle" fontFamily="sans-serif" fontWeight={700}>{num}</text>
        </g>
      );
    })}
    <circle r={RINGS.outer} fill="#1f8a4a" />
    <circle r={RINGS.bull} fill="#c8202a" />
    <circle r={1} fill="#000" filter="url(#gr-sisal)" opacity={0.5} />
    <circle r={1} fill="#000" filter="url(#gr-fleck)" opacity={0.18} />
    {/* the wire: spokes between the numbers, and the rings, each with a shadow on the sisal below it */}
    {[0.006, 0].map((o, k) => (
      <g key={k} stroke={k ? '#d6d9dc' : '#000'} strokeOpacity={k ? 0.85 : 0.45} strokeWidth={0.0075} fill="none" transform={`translate(${o} ${o})`}>
        {ORDER.map((_, j) => { const a = ((j * 18 - 9 - 90) * Math.PI) / 180; return <line key={j} x1={Math.cos(a) * RINGS.outer} y1={Math.sin(a) * RINGS.outer} x2={Math.cos(a) * 1.02} y2={Math.sin(a) * 1.02} />; })}
        {[RINGS.bull, RINGS.outer, RINGS.tIn, RINGS.tOut, RINGS.dIn, 1].map((r) => <circle key={r} r={r} />)}
      </g>
    ))}
  </g>
);

/** Where the sight is, pointed at p, at time t (ms), `held` ms after this dart's aim began: it wanders round where you
 *  point, a different way each throw (the phases `ph`), and further once the arm has been up a while. */
const swayAt = (p: { x: number; y: number }, t: number, ph: number[], held: number): [number, number] => {
  const s = t / 1000, a = 0.1 * (1 + 0.4 * Math.min(1, Math.max(0, (held - 2500) / 1500)));
  return [p.x + a * (0.75 * Math.sin(s * 3.4 + ph[0]) + 0.25 * Math.sin(s * 8.6 + ph[1])), p.y + a * (0.65 * Math.sin(s * 4.6 + ph[2]) + 0.25 * Math.cos(s * 7.4 + ph[3]))];
};
/** The throw's timing bar, `ms` after the press: up and down, once every 800 ms. 0.5 (the middle) is a clean release. */
const meterAt = (ms: number) => { const u = (ms / 800) % 1; return 1 - Math.abs(u * 2 - 1); };
const phases = () => [0, 0, 0, 0].map(() => Math.random() * Math.PI * 2);

/** A good way out from `n` (40 or less), with the darts left: a double, or a single that leaves one. */
function checkout(n: number, left: number): string | null {
  if (n > 40 || n < 2) return null;
  if (n % 2 === 0) return `D${n / 2}`;
  if (left < 2) return null;
  for (const leave of [32, 40, 16, 24, 36, 20, 8, 12, 4, 2]) if (leave < n && n - leave <= 20) return `${n - leave}, D${leave / 2}`;
  return null;
}

/** A dart stuck in the board (or on its way: bigger, its shadow further off), the tip at (x, y): a steel barrel, a dark
 *  shaft and a flight in the player's colour, leaning a little as darts do. */
function DartPin({ x, y, color, scale = 1, lift = 0, rot = 0 }: { x: number; y: number; color: string; scale?: number; lift?: number; rot?: number }) {
  const body = (shadow: boolean) => (
    <>
      <path d="M0 0 L0.012 0.016" stroke={shadow ? '#000' : '#cfd3d6'} strokeWidth={0.006} />
      <path d="M0.012 0.016 L0.04 0.062" stroke={shadow ? '#000' : 'url(#gr-barrel)'} strokeWidth={0.02} strokeLinecap="round" />
      {!shadow && <path d="M0.017 0.025 L0.022 0.023 M0.024 0.036 L0.029 0.034 M0.031 0.047 L0.036 0.045" stroke="#5a5e62" strokeWidth={0.004} />}
      <path d="M0.04 0.062 L0.066 0.104" stroke={shadow ? '#000' : '#26282c'} strokeWidth={0.011} />
      <path d="M0.058 0.092 L0.118 0.112 L0.092 0.165 Z" fill={shadow ? '#000' : color} stroke={shadow ? 'none' : 'rgba(0,0,0,0.45)'} strokeWidth={0.005} />
      <path d="M0.062 0.098 L0.086 0.15" stroke={shadow ? 'none' : 'rgba(255,255,255,0.35)'} strokeWidth={0.004} />
    </>
  );
  const sh = 0.025 + lift, k = scale * 1.7;                            // (drawn at 1.7: at the board's size a real dart's proportions are lost)
  return (
    <g transform={`translate(${x} ${y})`} style={{ pointerEvents: 'none' }}>
      <g transform={`translate(${sh} ${sh * 1.3}) rotate(${rot}) scale(${k})`} opacity={0.35}>{body(true)}</g>
      <g transform={`rotate(${rot}) scale(${k})`}>{body(false)}</g>
    </g>
  );
}

function DartBoard({ layout }: { layout: FitProps['layout'] }) {
  const game = useGame();
  const me = useStore((s) => s.me?.id ?? '');
  const flights = useLocal((s) => s.flights);
  const d = game?.darts;
  const mode: Mode = d?.mode ?? '301';
  const x01 = mode === '301' || mode === '501';
  const sight = useRef<SVGGElement>(null);
  const meter = useRef<SVGRectElement>(null);
  const other = useRef<SVGGElement>(null);
  const point = useRef<{ x: number; y: number } | null>(null);
  const ph = useRef(phases());
  const aimFrom = useRef(0);
  const press = useRef<number | null>(null);
  const drawn = useRef<[number, number] | null>(null);
  const seen = useRef<[number, number] | null>(null);
  const sentAt = useRef(0);
  const [, tick] = useState(0);
  const myTurn = !!d && d.on && !d.winner && d.players[d.turn] === me && d.darts.length < 3;
  const thrower = d && d.on && !d.winner ? d.players[d.turn] : '';
  // each dart a new sway (so it cannot be learnt), and the arm fresh again
  useEffect(() => { ph.current = phases(); aimFrom.current = 0; press.current = null; }, [d?.darts.length, d?.turn, myTurn]);
  // The sight, the timing bar and the thrower's sight as the others see it: moved straight on the page, every frame
  useEffect(() => {
    let raf = 0;
    const go = (t: number) => {
      const p = point.current, el = sight.current;
      if (el) {
        if (myTurn && p) {
          if (!aimFrom.current) aimFrom.current = t;
          const [x, y] = swayAt(p, t, ph.current, t - aimFrom.current);
          drawn.current = [x, y];
          el.setAttribute('transform', `translate(${x} ${y})`); el.style.display = '';
          if (t - sentAt.current > 125) { sentAt.current = t; send({ t: 'fit', id: ID, game: 'darts', op: 'aim', x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 }); }
        } else el.style.display = 'none';
      }
      const m = meter.current;
      if (m) {
        const v = press.current == null ? 0 : meterAt(t - press.current);
        m.parentElement!.style.display = press.current == null ? 'none' : '';
        m.setAttribute('y', String(0.13 - v * 0.26 - 0.006));
      }
      const o = other.current, w = useLocal.getState().dartAim;
      if (o) {
        if (!myTurn && w && t - w.at < 1500 && w.who === thrower) {
          const c = seen.current ?? [w.x, w.y];
          seen.current = [c[0] + (w.x - c[0]) * 0.2, c[1] + (w.y - c[1]) * 0.2];
          o.setAttribute('transform', `translate(${seen.current[0]} ${seen.current[1]})`); o.style.display = '';
        } else { o.style.display = 'none'; seen.current = null; }
      }
      raf = requestAnimationFrame(go);
    };
    raf = requestAnimationFrame(go);
    return () => cancelAnimationFrame(raf);
  }, [myTurn, thrower]);
  // and the darts arriving: drawn again every frame while one is in the air, landing, or its label is up
  useEffect(() => {
    let raf = 0;
    const go = () => { const now = performance.now(); if (useLocal.getState().flights.some((f) => now - f.t0 < 2600)) { tick((n) => n + 1); raf = requestAnimationFrame(go); } else tick((n) => n + 1); };
    raf = requestAnimationFrame(go);
    return () => cancelAnimationFrame(raf);
  }, [flights]);

  const toBoard = (e: ReactPointerEvent<SVGSVGElement>) => { const r = pageRect(e.currentTarget); return { x: ((e.clientX - r.left) / r.width) * 2.8 - 1.4, y: ((e.clientY - r.top) / r.height) * 2.8 - 1.4 }; };
  const pressDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    point.current = toBoard(e);
    if (!myTurn || !drawn.current || press.current != null) return;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* (it still works inside the board) */ }
    press.current = performance.now();
  };
  const letGo = () => {
    const at = press.current;
    press.current = null;
    if (at == null || !myTurn || !drawn.current) return;
    const [x, y] = drawn.current;                                        // where the sight was shown, this very frame
    send({ t: 'fit', id: ID, game: 'darts', op: 'throw', x, y, meter: Math.round(meterAt(performance.now() - at) * 1000) / 1000 });
  };

  const joined = !!d && d.players.includes(me);
  const now = performance.now();
  const flying = flights.filter((f) => now - f.t0 < FLY_MS);
  const landed = (p: Dart) => flights.find((f) => f.dart.x === p.x && f.dart.y === p.y);
  const shownWho = d ? (d.darts.length ? d.players[d.turn] : d.last?.who) : undefined;
  const shown = (d ? (d.darts.length ? d.darts : d.last?.darts ?? []) : []).filter((p) => !flying.some((f) => f.dart.x === p.x && f.dart.y === p.y));
  const call = [...flights].reverse().find((f) => f.end && now - f.t0 < FLY_MS + 2200 && now - f.t0 > FLY_MS);
  const callText = !call ? '' : call.won ? `${nameOf(call.who)} wins!` : call.bust ? `${nameOf(call.who)}: Bust!`
    : call.mode === 'clock' ? (call.total ? `${nameOf(call.who)} moves on ${call.total}` : `${nameOf(call.who)}: no luck`)
      : call.total === 180 ? 'One hundred and eighty!' : `${nameOf(call.who)}: ${call.total}${call.total >= 100 ? '!' : ''}`;
  const turnSoFar = (() => {                                              // the thrower's turn, so far
    if (!d || !thrower || !d.darts.length) return 0;
    if (x01) return d.start - d.scores[d.turn];
    const f = [...flights].reverse().find((x) => x.who === thrower);
    return f && !f.end ? f.total : 0;
  })();
  const scoreText = (k: number) => (!d ? '' : mode === 'clock' ? (d.scores[k] >= 21 ? 'bull' : `on ${d.scores[k]}`) : String(d.scores[k] ?? ''));
  const out = d && thrower && x01 ? checkout(d.scores[d.turn], 3 - d.darts.length) : null;
  const say = !d || !d.players.length ? 'Join, pick a game, and start: three darts a turn.'
    : d.winner ? `${nameOf(d.winner)} wins! Play again, or join in for the next one.`
      : !d.on ? `${d.players.map(nameOf).join(', ')} ${d.players.length > 1 ? 'are' : 'is'} in. Pick a game and start when everyone is.`
        : myTurn ? `Your dart (${d.darts.length + 1} of 3). The sight is where it goes: press to draw back, let go as the bar passes the middle.${x01 ? ' Finish on a double.' : mode === 'cricket' ? ' Close 15 to 20 and the bull.' : ''}`
          : `${nameOf(thrower)} is throwing${turnSoFar ? ` (${turnSoFar} so far)` : ''}.`;
  return (
    <div className="gr-game darts">
      <div className="gr-players">
        {(d?.players ?? []).map((p, k) => (
          <div key={p} className={`gr-player${d!.on && !d!.winner && d!.turn === k ? ' turn' : ''}`}><i className="gr-flight" style={{ background: DART_COLORS[k % 4] }} /><b>{nameOf(p)}</b> <span>{d!.on || d!.winner ? scoreText(k) : ''}</span></div>
        ))}
        <span className="gr-gap" />
        {joined && (!d!.on || d!.winner) && (['301', '501', 'cricket', 'clock'] as Mode[]).map((m) => <button key={m} className={mode === m ? 'on' : ''} onClick={() => send({ t: 'fit', id: ID, game: 'darts', op: 'mode', mode: m })}>{MODE_NAMES[m]}</button>)}
        {!joined && (!d?.on || d.winner) && (d?.players.length ?? 0) < 4 && <button onClick={() => send({ t: 'fit', id: ID, game: 'darts', op: 'join' })}>Join</button>}
        {joined && (!d!.on || d!.winner) && <button onClick={() => send({ t: 'fit', id: ID, game: 'darts', op: 'start' })}>{d!.winner ? 'Play again' : `Start ${MODE_NAMES[mode]}`}</button>}
        {joined && <button onClick={() => { send({ t: 'fit', id: ID, game: 'darts', op: 'leave' }); putDown(); useLocal.setState({ open: '' }); }}>Leave</button>}
      </div>
      <div className="gr-darts-row">
        <svg className={`gr-board${myTurn ? ' mine' : ''}`} viewBox="-1.4 -1.4 2.8 2.8"
          onPointerMove={(e) => { point.current = toBoard(e); }} onPointerLeave={() => { if (press.current == null) point.current = null; }}
          onPointerDown={pressDown} onPointerUp={letGo} onPointerCancel={() => { press.current = null; }}>
          {BOARD_SVG}
          {shown.map((p, k) => {
            const f = landed(p), age = f ? now - f.t0 - FLY_MS : 9999;
            const rot = age >= 0 && age < 300 ? Math.sin((age / 300) * Math.PI * 5) * 9 * (1 - age / 300) : 0;    // still quivering
            return <DartPin key={k} x={p.x} y={p.y} color={dartColor(d, shownWho)} rot={rot} />;
          })}
          {flying.map((f, k) => {
            const u = Math.min(1, (now - f.t0) / FLY_MS), e = u * (2 - u);
            return <DartPin key={`f${k}`} x={f.from.x + (f.dart.x - f.from.x) * e} y={f.from.y + (f.dart.y - f.from.y) * e} color={dartColor(d, f.who)} scale={1.6 - 0.6 * e} lift={(1 - e) * 0.14} />;
          })}
          {flights.map((f, k) => {                                         // what each dart made, floating up off it
            const age = now - f.t0 - FLY_MS;
            if (age < 0 || age > 1100) return null;
            const v = age / 1100;
            return <text key={`l${k}`} x={f.dart.x} y={f.dart.y - 0.08 - 0.16 * v} opacity={1 - v * v} fontSize={0.1} fill={f.bust ? '#ff6a5a' : '#fff'} textAnchor="middle" fontFamily="sans-serif" fontWeight={700} stroke="#000" strokeWidth={0.014} paintOrder="stroke" style={{ pointerEvents: 'none' }}>{f.label}</text>;
          })}
          {callText && <rect x={-0.95} y={-1.375} width={1.9} height={0.24} rx={0.05} fill="rgba(0,0,0,0.72)" stroke="rgba(242,194,48,0.5)" strokeWidth={0.008} style={{ pointerEvents: 'none' }} />}
          {callText && <text x={0} y={-1.2} fontSize={call && (call.total >= 100 || call.won) ? 0.17 : 0.13} fill={call?.bust ? '#ff6a5a' : '#f2c230'} textAnchor="middle" fontFamily="sans-serif" fontWeight={700} stroke="#000" strokeWidth={0.02} paintOrder="stroke" style={{ pointerEvents: 'none' }}>{callText}</text>}
          <g ref={other} style={{ display: 'none', pointerEvents: 'none' }} opacity={0.4}>
            <circle r={0.05} fill="none" stroke="#fff" strokeWidth={0.01} />
            <path d="M-0.075 0 H-0.03 M0.03 0 H0.075 M0 -0.075 V-0.03 M0 0.03 V0.075" stroke="#fff" strokeWidth={0.01} />
          </g>
          {myTurn && (
            <g ref={sight} style={{ display: 'none', pointerEvents: 'none' }}>
              <circle r={0.05} fill="none" stroke="#000" strokeOpacity={0.5} strokeWidth={0.02} />
              <circle r={0.05} fill="none" stroke="#fff" strokeWidth={0.01} />
              <path d="M-0.08 0 H-0.03 M0.03 0 H0.08 M0 -0.08 V-0.03 M0 0.03 V0.08" stroke="#fff" strokeWidth={0.012} />
              <circle r={0.006} fill="#ff5a4d" />
              <g style={{ display: 'none' }} transform="translate(0.11 0)">
                <rect x={-0.018} y={-0.13} width={0.036} height={0.26} rx={0.008} fill="rgba(0,0,0,0.6)" stroke="#fff" strokeWidth={0.006} />
                <rect x={-0.03} y={-0.004} width={0.06} height={0.008} fill="#46c068" />
                <rect ref={meter} x={-0.014} y={0} width={0.028} height={0.012} fill="#f2c230" />
              </g>
            </g>
          )}
        </svg>
        <div className="gr-chalk">
          <h4>{MODE_NAMES[mode]}</h4>
          {d && d.players.length > 0 && mode === 'cricket' ? (
            <table>
              <thead><tr><th />{d.players.map((p) => <th key={p}>{nameOf(p).slice(0, 6)}</th>)}</tr></thead>
              <tbody>
                {CRICKET.map((n, i) => {
                  const dead = d.players.every((_, k) => (d.marks?.[k]?.[i] ?? 0) >= 3);
                  return <tr key={n} className={dead ? 'dead' : ''}><td>{n === 25 ? 'Bull' : n}</td>{d.players.map((p, k) => <td key={p}>{['', '/', 'X', 'Ⓧ'][Math.min(3, d.marks?.[k]?.[i] ?? 0)]}</td>)}</tr>;
                })}
                <tr className="pts"><td>pts</td>{d.players.map((p, k) => <td key={p}>{d.on || d.winner ? d.scores[k] : ''}</td>)}</tr>
              </tbody>
            </table>
          ) : (
            (d?.players ?? []).map((p, k) => <p key={p} className={thrower === p ? 'up' : ''}><span>{nameOf(p)}</span><b>{d!.on || d!.winner ? scoreText(k) : '-'}</b></p>)
          )}
          {thrower && <p className="turn">{nameOf(thrower)}: {d!.darts.map((x) => x.label).join(' · ') || '…'}{turnSoFar ? ` = ${turnSoFar}` : ''}</p>}
          {out && <p className="out">Out: {out}</p>}
          {d?.last?.total != null && !d.winner && d.last.who !== thrower && <p className="was">{nameOf(d.last.who)}: {d.last.bust ? 'bust' : mode === 'clock' ? `+${d.last.total}` : d.last.total}</p>}
        </div>
      </div>
      <p className="gr-say">{say}</p>
    </div>
  );
}

export const says = (seat: number) => holdemSays(seat) ?? (seat < 7 ? 'Sit at the bar' : 'Sit down');
