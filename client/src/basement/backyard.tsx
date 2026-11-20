// The backyard: out past the door in the room's west wall, above the stairs (scripts/basement/backyard.py draws it; the
// server's half is server/basement/backyard.ts, and the lawn's workings are ./lawn.ts, shared with it).
//
// Drawn here, over the picture:
//   the lawn's mown patches, inside its hidden bounds (LAYOUT.things.lawn): a paler, smoother green striped by the way
//     the mower went, growing back over a day and a half into the long grass the picture shows (a canvas, clear where
//     it is long, redrawn when it is cut and every minute). It is only a look: nothing else here reads it;
//   the mower, by the gate or wherever it was left, or in front of whoever is pushing it (whichever way they face), with
//     its engine shaking and smoking when it runs; while I push it, a strip of controls (engine on/off, let go) and the
//     keys to drive it (WASD or the arrows, Shift slower; E, Q), or press and drag on the lawn. It stays inside the lawn;
//   the smoking table on the patio: a click on it is a menu (a cigarette, a cigar, a corncob or a calabash pipe, the
//     bubbles, a mini fan), and they go over and take it; then it is in their hand or their mouth however they stand,
//     sit or walk (./smokes.ts), with smoke curling off it and blown out after each drag, bubbles blown off the wand
//     (or trailed behind them as they walk), the fan's breeze (./puffs.ts, all of it left in the air where it came off);
//   the pool: anybody in the water is lowered into it, head and shoulders above it (FitGame.body), a ring round them; the
//     diving board: stood on it, click it again to jump (or spin) in, with a splash; the water shimmering, the waterfall;
//   the hot tub: those in it sat in the water to the chest, the jets churning it (the panel turns them on), steam;
//   the radio (the Player: Music.tsx clickRadio), the night as it falls, with the pool lit from underneath.
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { marksOf } from '../sprites';
import { hooks, send, toast, useStore } from '../store';
import { clickRadio, radioSays } from '../components/Music';
import { LAYOUT } from './backyard.gen';
import { drawn, goFloor } from './index';
import type { FitBody, FitLayout, FitPose, FitProps } from './index';
import { COLS, deck, DIRS, LC, LH, LW, LX, LY, mow, mown, newLawn, ROWS, unitNow, unpack } from './lawn';
import type { Dir, Lawn } from './lawn';
import { daylight } from './outside.tsx';
import { SeasonAir, useSceneArt } from '../season';
import { OutdoorDecor } from '../holidays/outdoor';
import { LawnGames, lawnPose } from './lawngames.tsx';
import { inPool } from './yard';
import { drawFall, fallBox } from './falls';
import { makePuffs, SCALE } from './puffs';
import { ARTS, CYCLE, dragging, IN_MOUTH, KINDS, LABEL, phase, pixels, place } from './smokes';
import type { ArtName, Kind, Placed } from './smokes';
import type { Yard } from './yard';
import './backyard.css';
import { pageRect } from '../device';

const ID = 'backyard';
const T = LAYOUT.things as Record<string, any>;
const BOARD = T.board as number, BOARD_KEY = `b${T.board}`;
const TUB = new Set<number>(T.tubSeats as number[]);
const PATIO = new Set<number>(T.patio as number[]);
const [WX, , WW] = T.pool as number[];
/** The smoking table (the whole of it: a click on it is its menu), and where to stand to take something off it. */
const TABLE = (T.smokeTable as number[] | undefined) ?? (() => { const r = Object.values(T.smoke as Record<string, number[]>); const x0 = Math.min(...r.map((b) => b[0])), y0 = Math.min(...r.map((b) => b[1])); return [x0, y0, Math.max(...r.map((b) => b[0] + b[2])) - x0, Math.max(...r.map((b) => b[1] + b[3])) - y0]; })();
const STAND = (T.smokeStand as number[] | undefined) ?? [TABLE[0] + TABLE[2] / 2, TABLE[1] + TABLE[3] + 6];
const MOWER = T.mower as { w: number; h: number; foot: Record<Dir, [number, number]> };
const FACE_CELL: Record<Dir, number> = { down: 0, up: 1, left: 2, right: 3 };
const DIRS_BY_CELL: Dir[] = ['down', 'up', 'left', 'right'];

// ── the lawn, kept here as the server last told it (it is too big to keep in the store's state) ──
let lawn: Lawn = newLawn();
let lawnFrom: unknown = null;
let lawnRev = 0;
/** Grass cut from long just now, for the clippings: where, and when. */
const clippings: { x: number; y: number; at: number }[] = [];
function loadLawn(l: { base: number; cells: string } | undefined) {
  if (!l || l === lawnFrom) return;
  lawnFrom = l;
  lawn = unpack(l.base, l.cells);
  lawnRev++;
}
loadLawn((useStore.getState().fits[ID] as Yard | undefined)?.lawn);
useStore.subscribe((s) => loadLawn((s.fits[ID] as Yard | undefined)?.lawn));
hooks.fit.push((d) => {
  if (d.id !== ID) return;
  if (d.op === 'note') toast(String(d.text ?? ''));
  if (d.op === 'lawn') loadLawn(d.lawn);
  if (d.op === 'mown' && Array.isArray(d.pts)) {
    const fresh = mow(lawn, d.pts, Number(d.unit) || unitNow(), DIRS.includes(d.face) ? d.face : undefined);
    lawnRev++;
    if (fresh > 0) { const p = d.pts[d.pts.length - 1]; clippings.push({ x: p[0], y: p[1], at: performance.now() }); if (clippings.length > 8) clippings.shift(); }
  }
});
/** How far my clock is ahead of the server's. */
let skew = 0;
hooks.fit.push((d) => { if (d.id === ID && d.state?.now) skew = Date.now() - d.state.now; });

/** Which way whoever is pushing the mower faces. */
const faces = new Map<string, Dir>();
const myId = () => useStore.getState().me?.id;

// ── the mower is driven, not walked: straight wherever it is pushed, at its own pace, and only over the lawn ──
/** Me pushing it: where my feet are, which way I face, whether I am moving, and where I pointed (pressed on the lawn). */
const drive = { on: false, x: 0, y: 0, face: 'down' as Dir, moving: false, target: null as null | { x: number; y: number } };
/** The places I sent as I drove it (my place follows the mower now and then): any other place of mine while I hold it
 *  is me walking off somewhere else, and that lets go of it. */
const drivenTo: string[] = [];
function drivePlace(x: number, y: number) {
  drivenTo.push(`${x},${y}`); if (drivenTo.length > 6) drivenTo.shift();
  send({ t: 'place', place: 'here', x, y });
}
/** Somebody else pushing it, as they last said: from where it was shown to where it is now, eased over a moment. */
const remote = new Map<string, { x0: number; y0: number; x1: number; y1: number; t0: number; face: Dir }>();
const EASE_MS = 140;
const WAYS: Record<string, [number, number]> = { w: [0, -1], arrowup: [0, -1], s: [0, 1], arrowdown: [0, 1], a: [-1, 0], arrowleft: [-1, 0], d: [1, 0], arrowright: [1, 0] };
function remoteAt(uid: string) {
  const r = remote.get(uid);
  if (!r) return null;
  const k = Math.min(1, (performance.now() - r.t0) / EASE_MS);
  return { x: r.x0 + (r.x1 - r.x0) * k, y: r.y0 + (r.y1 - r.y0) * k };
}
hooks.fit.push((d) => {
  if (d.id !== ID || d.op !== 'pos' || typeof d.by !== 'string' || d.by === myId()) return;
  const at = remoteAt(d.by) ?? drawn.get(d.by) ?? { x: Number(d.x), y: Number(d.y) };
  remote.set(d.by, { x0: at.x, y0: at.y, x1: Number(d.x), y1: Number(d.y), t0: performance.now(), face: DIRS.includes(d.face) ? d.face : 'down' });
  faces.set(d.by, DIRS.includes(d.face) ? d.face : 'down');
});
/** How far out of bounds a pusher at (x, y) facing `face` is: their feet must be on the lawn, and so must the middle of
 *  the mower's deck in front of them (0: all in). A push is allowed if it does not make this worse, so the mower can
 *  always be brought back but never taken off the grass. */
function offLawn(x: number, y: number, face: Dir) {
  const out = (v: number, lo: number, hi: number) => (v < lo ? lo - v : v > hi ? v - hi : 0);
  const [x0, y0, x1, y1] = deck(x, y, face), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  return out(x, LX, LX + LW) + out(y, LY, LY + LH) + out(cx, LX, LX + LW) + out(cy, LY, LY + LH);
}

export function steer(uid: string) {
  const st = useStore.getState().fits[ID] as Yard | undefined;
  if (!st || st.mower.by !== uid) return null;
  if (uid === myId()) return drive.on ? { x: drive.x, y: drive.y } : null;
  return remoteAt(uid);
}
/** Whether whoever pushes the mower is moving it just now. */
function pushing(uid: string) {
  if (uid === myId()) return drive.moving;
  const r = remote.get(uid);
  return !!r && performance.now() - r.t0 < 260 && (r.x0 !== r.x1 || r.y0 !== r.y1);
}

// ── how people are drawn out here ──
const hash = (s: string) => { let h = 7; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; };
/** The pool's depth where somebody stands, as how far they are lowered into it: deep at the board end, shallow at the
 *  steps (at the very end, on the steps themselves, up to the waist). */
function sink(x: number) {
  const u = (x - WX) / WW;
  if (u > 0.93) return 4;
  return Math.round(19 - 9 * Math.max(0, Math.min(1, (u - 0.2) / 0.65)));
}
/** A dive off the board: how far it is through (seconds), or -1. */
function diveT(uid: string) {
  const st = useStore.getState().fits[ID] as Yard | undefined, d = st?.dives[uid];
  if (!d) return -1;
  const t = (Date.now() - skew - d.at) / 1000;
  return t >= 0 && t < 3 ? t : -1;
}
const TIPX = (LAYOUT.seats[BOARD] as FitLayout['seats'][number]).x;

export function body(uid: string, key: string, x: number, y: number): FitBody | null {
  const t = diveT(uid);
  if (key === BOARD_KEY && t >= 0) {
    // crouch, up into the air, and down into the water (the water's line stays where it is: what goes under is hidden)
    const s = sink(TIPX);
    let dy: number;
    if (t < 0.15) dy = 1;
    else if (t < 0.5) dy = -18 * Math.sin(((t - 0.15) / 0.35) * (Math.PI / 2));
    else if (t < 0.85) dy = -18 + (18 + s) * Math.pow((t - 0.5) / 0.35, 2);
    else dy = s;
    return { dy, clip: t >= 0.5 ? 7 + dy : 0 };
  }
  const m = /^b(\d+)$/.exec(key), n = m ? Number(m[1]) : -1;
  const q = n >= 0 ? (LAYOUT.seats[n] as FitLayout['seats'][number] | undefined) : undefined;
  const there = !!q && Math.abs(x - q.x) < 1 && Math.abs(y - q.y) < 1;
  // on a lounger: the seat is past its foot (so they are drawn over it), and they are lifted back up onto it
  if (LOUNGE.has(n) && there) return { dy: LOUNGE_LIFT };
  // sat in the hot tub, in the water to the chest (once there: not on the way to it)
  if (TUB.has(n) && there) return { dy: 2, clip: 3 + 12 + 2 };
  // In the pool and not yet at a seat: swimming. On the way to a seat as well (the diving board, the hot tub, a lounger):
  // only the walk to no seat at all was swum, so whoever was in the water and clicked the board walked over the water
  // to it (2026-11-18). On the board itself, which stands out over the water, they are up on it, not in it.
  if (!there && inPool(x, y)) { const s = sink(x); return { dy: s, clip: 7 + s }; }
  return null;
}

/** Each thing off the smoking table as a picture to lay over somebody (made once, as it is first needed). */
const artUrls = new Map<string, { url: string; w: number; h: number; n: number; ms: number }>();
function artUrl(name: ArtName, flip: boolean, skin: string) {
  const key = `${name}${flip ? '<' : '>'}${skin}`;
  let u = artUrls.get(key);
  if (!u) {
    const px = pixels(ARTS[name], flip, skin), c = document.createElement('canvas');
    c.width = px.w * px.frames.length; c.height = px.h;
    const g = c.getContext('2d')!;
    px.frames.forEach((d, i) => g.putImageData(new ImageData(d as Uint8ClampedArray<ArrayBuffer>, px.w, px.h), i * px.w, 0));
    u = { url: c.toDataURL(), w: px.w, h: px.h, n: px.frames.length, ms: ARTS[name].ms ?? 100 };
    artUrls.set(key, u);
  }
  return u;
}
const PIPES = new Set(['corncob', 'calabash']);
/** The loungers' seats (scripts/basement/backyard.py), and how far whoever lies out on one is lifted onto it. */
const LOUNGE_Y = 320, LOUNGE_LIFT = -12;
const LOUNGE = new Set(LAYOUT.seats.flatMap((q, i) => (q.y === LOUNGE_Y ? [i] : [])));
const BASIN = (T.basin as number[] | undefined) ?? [T.fall[0] + T.fall[2] / 2, T.fall[1] - 2, T.fall[2] / 2, 2];
const FALL_BOX = fallBox(T.fall, BASIN);

export function pose(uid: string, key: string): FitPose | null {
  const lawnGame = lawnPose(uid);                                   // (stood at one of the lawn games: facing the play, throwing)
  if (lawnGame) return lawnGame;
  const st = useStore.getState().fits[ID] as Yard | undefined;
  if (!st) return null;
  const t = diveT(uid);
  if (key === BOARD_KEY && t >= 0) {
    if (st.dives[uid]?.spin && t > 0.15 && t < 0.85) return { row: (['walk_down', 'walk_left', 'walk_up', 'walk_right'] as const)[Math.floor(t / 0.09) % 4], first: 1, frames: 1, ms: 1000 };
    return { row: 'cheer', first: 0, frames: 4, ms: 110 };
  }
  if (st.mower.by === uid) {
    const row = `walk_${faces.get(uid) ?? st.mower.face ?? 'down'}` as FitPose['row'];
    return pushing(uid) ? { row, first: 0, frames: 4, ms: 170 } : { row, first: 1, frames: 1, ms: 1000 };
  }
  const smoking = st.smoke[uid];
  if (smoking && !IN_MOUTH.has(smoking.kind)) {                     // (a pipe stays in the mouth: the hands are free)
    const m = /^b(\d+)$/.exec(key), q = m ? LAYOUT.seats[Number(m[1])] as FitLayout['seats'][number] | undefined : undefined;
    if (q && q.pose !== 'front') return null;
    if (TUB.has(m ? Number(m[1]) : -1)) return null;
    const drag = dragging(uid, smoking.kind, Date.now());
    return { row: q ? 'drink_sit' : 'drink', first: drag ? 2 : 0, frames: 2, ms: drag ? 500 : 900 };
  }
  return null;
}

/** What pointing at a seat says. */
export const says = (seat: number) => (TUB.has(seat) ? 'Get in the hot tub' : seat === BOARD ? 'Stand on the diving board'
  : (LAYOUT.seats[seat] as FitLayout['seats'][number] | undefined)?.y === LOUNGE_Y ? 'Lie out by the pool' : PATIO.has(seat) ? 'Sit on the patio' : undefined);

// ── the lawn's colours ──
type RGB = [number, number, number];
const mixc = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const LIGHT: RGB = [255, 244, 220], SHADE: RGB = [20, 14, 40];
/** Freshly mown grass: a paler, smoother green than the long grass in the picture, in each season's picture's own colours
 *  (scripts/basement/_seasons.py: the spring's lusher, the fall's tired, winter's dormant straw). Under snow the mown
 *  patches are not shown at all. */
const MOWN_BY: Record<string, RGB> = { '': [118, 184, 80], '-spring': [124, 196, 86], '-fall': [152, 166, 80], '-winter': [186, 170, 116] };
let MOWN: RGB = MOWN_BY[''];
/** The panel round the scene, by day, in each season. */
const BG_BY: Record<string, RGB> = { '': [29, 74, 36], '-spring': [32, 82, 40], '-fall': [70, 78, 36], '-winter': [96, 86, 54], '-snow': [190, 200, 214] };
const hsh = (x: number, y: number) => { let h = (x * 374761393 + y * 668265263) >>> 0; h = ((h ^ (h >>> 13)) * 1274126177) >>> 0; return (h ^ (h >>> 16)) >>> 0; };
/** The mown patches only: clear wherever the grass is long, so the picture's own long grass (and anything drawn on it)
 *  shows through; a mown patch is laid over the way it was mown (away from us light, toward us dark, across a little),
 *  and fades back into the long grass as it grows. */
function paint(ctx: CanvasRenderingContext2D, l: Lawn) {
  const img = ctx.createImageData(LW, LH), px = img.data, unit = unitNow(Date.now() - skew);
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const i = r * COLS + c, m = mown(l, i, unit);
      if (m <= 0) continue;
      const k = [0.2, 0.07, -0.2, -0.07][l.d[i]];
      const cut = k > 0 ? mixc(MOWN, LIGHT, k) : mixc(MOWN, SHADE, -k);
      const shadeTop = r > 0 && mown(l, i - COLS, unit) < m * 0.5;      // (longer grass just above casts a little shade)
      const a = Math.min(1, Math.pow(m, 0.7) * 1.15), along = l.d[i] % 2 === 0;    // (mown up or down: its blades lie in columns; across, in rows)
      for (let dy = 0; dy < LC; dy++) {
        for (let dx = 0; dx < LC; dx++) {
          const x = c * LC + dx, y = r * LC + dy, o = (y * LW + x) * 4;
          let col = cut;
          // short blades: a faint grain the way it was mown, flecks of light and dark, and a little of the long grass
          // under it still showing through
          const lane = hsh(along ? x + LX : 7, along ? 3 : y + LY) % 3, n = hsh(x + 900, y) % 13;
          col = lane === 0 ? mixc(col, SHADE, 0.07) : lane === 1 ? mixc(col, LIGHT, 0.04) : col;
          if (n === 0) col = mixc(col, SHADE, 0.16); else if (n === 1) col = mixc(col, LIGHT, 0.12);
          if (shadeTop && dy === 0) col = mixc(col, SHADE, 0.2);
          px[o] = col[0]; px[o + 1] = col[1]; px[o + 2] = col[2]; px[o + 3] = Math.round(255 * a * (0.8 + (hsh(x, y + 50) % 5) * 0.04));
        }
      }
    }
  }
  ctx.putImageData(img, 0, 0);
}

// ── sounds: the mower's engine, a splash ──
let actx: AudioContext | null = null;
const audio = () => { try { actx ??= new AudioContext(); if (actx.state === 'suspended') void actx.resume(); return actx; } catch { return null; } };
function splash() {
  const a = audio();
  if (!a) return;
  const n = a.sampleRate * 0.6, buf = a.createBuffer(1, n, a.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2.2);
  const src = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
  src.buffer = buf; f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 0.7; g.gain.value = 0.18;
  src.connect(f).connect(g).connect(a.destination); src.start();
}
/** The engine, while it runs: a low two-stroke putter, a little higher while it moves. */
function useEngine(on: boolean, mini: boolean) {
  const n = useRef<{ g: GainNode; o: OscillatorNode[] } | null>(null);
  useEffect(() => {
    if (!on || mini) return;
    const a = audio();
    if (!a) return;
    const g = a.createGain(), f = a.createBiquadFilter(), am = a.createGain(), lfo = a.createOscillator();
    f.type = 'lowpass'; f.frequency.value = 520;
    g.gain.value = 0;
    g.gain.setTargetAtTime(0.05, a.currentTime, 0.4);
    const o = [a.createOscillator(), a.createOscillator()];
    o[0].type = 'sawtooth'; o[0].frequency.value = 46; o[1].type = 'square'; o[1].frequency.value = 92.5;
    lfo.frequency.value = 23; lfo.connect(am.gain); am.gain.value = 0.5;
    o.forEach((x) => x.connect(am)); am.connect(f).connect(g).connect(a.destination);
    o.forEach((x) => x.start()); lfo.start();
    n.current = { g, o };
    return () => {
      g.gain.setTargetAtTime(0, a.currentTime, 0.15);
      window.setTimeout(() => { o.forEach((x) => { try { x.stop(); } catch { /* */ } }); try { lfo.stop(); } catch { /* */ } g.disconnect(); }, 600);
      n.current = null;
    };
  }, [on, mini]);
  return n;
}

const box = (r: number[]): CSSProperties => ({ left: r[0], top: r[1], width: r[2], height: r[3] });
const DUSK_OVER = 3;

export function Room({ layout, mini }: FitProps) {
  const st = useStore((s) => s.fits[ID]) as Yard | undefined;
  const me = useStore((s) => s.me);
  const mine = useStore((s) => (s.me ? s.presence[s.me.id] : undefined));
  const users = useStore((s) => s.users);
  const presence = useStore((s) => s.presence);
  const playing = useStore((s) => !!s.music.current && s.music.current.pausedAt == null);      // (the radio is the Player: notes float off it while that plays)
  const [, tick] = useState(0);
  const [light, setLight] = useState(() => daylight(new Date()));
  const canvas = useRef<HTMLCanvasElement>(null);
  const mowerEl = useRef<HTMLElement>(null);
  const fx = useRef<HTMLDivElement>(null);
  const puffCanvas = useRef<HTMLCanvasElement>(null);
  const fallCanvas = useRef<HTMLCanvasElement>(null);
  const puffs = useState(makePuffs)[0];
  const fetching = useRef<{ kind: string; since: number } | null>(null);
  const [tableMenu, setTableMenu] = useState(false);
  const grabbing = useRef<{ x: number; y: number; since: number } | null>(null);
  const keys = useRef(new Set<string>());
  const droppedAt = useRef(0);
  const iHold = !!st && !!me && st.mower.by === me.id;
  // (the engine is heard only by whoever is pushing it)
  const engine = useEngine(!!st?.mower.on && iHold, mini);
  const art = useSceneArt((layout as { seasons?: string[] }).seasons);      // the season's pictures ('' summer, '-fall', '-snow'...)
  MOWN = MOWN_BY[art] ?? MOWN_BY[''];

  useEffect(() => {
    const t = window.setInterval(() => tick((n) => n + 1), 100);
    const l = window.setInterval(() => setLight(daylight(new Date())), 30_000);
    return () => { window.clearInterval(t); window.clearInterval(l); };
  }, []);
  // the panel round the scene darkens with the night, as the campsite's does
  const dusk = Math.min(0.78, (1 - light) * 0.66), night = 1 - light;
  useEffect(() => {
    const c = (BG_BY[art] ?? BG_BY['']).map((v, i) => Math.round(v + ([8, 14, 34][i] - v) * dusk));
    document.documentElement.style.setProperty('--yard-bg', `rgb(${c.join(',')})`);
    return () => { document.documentElement.style.removeProperty('--yard-bg'); };
  }, [dusk, art]);

  // the waterfall, a dot at a time, twenty-odd times a second
  useEffect(() => {
    const t0 = performance.now();
    const t = window.setInterval(() => {
      const ctx = fallCanvas.current?.getContext('2d');
      if (ctx) drawFall(ctx, FALL_BOX, T.fall, BASIN, (performance.now() - t0) / 1000);
    }, mini ? 200 : 45);
    return () => window.clearInterval(t);
  }, [mini]);
  // the lawn: painted when it changes (at most once a frame) and every minute, as it grows
  useEffect(() => {
    let raf = 0, shown = -1, at = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const ctx = canvas.current?.getContext('2d');
      if (!ctx) return;
      const now = Date.now();
      if (lawnRev === shown && now - at < 60_000) return;
      shown = lawnRev; at = now;
      paint(ctx, lawn);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [art]);                                                         // (and again in a new season's colours)

  // every frame: the mower where it is, my mowing sent on, the smokers' smoke and the swimmers' rings where they are
  useEffect(() => {
    let raf = 0, pts: number[][] = [], sentAt = 0, atAt = 0, placeAt = 0, last = performance.now();
    // what comes off what people have from the smoking table: let go of in the yard, a little at a time each
    const next = new Map<string, number>();
    const due = (k: string, every: number, wall: number) => { if (wall < (next.get(k) ?? 0)) return false; next.set(k, wall + every * (0.7 + Math.random() * 0.6)); return true; };
    const emit = (uid: string, kind: string, pl: Placed, ox: number, oy: number, dr: boolean, wall: number, row: string) => {
      if (!puffCanvas.current) return;
      const ph = phase(uid, kind, wall), cy = CYCLE[kind as Kind];
      const E = pl.ember ? [ox + pl.ember[0], oy + pl.ember[1]] : null, M = [ox + pl.mouth[0], oy + pl.mouth[1]];
      const dir = pl.view === 'left' ? -1 : pl.view === 'right' ? 1 : 0;
      if (kind === 'bubbles') {
        if (!E) return;
        if (row.startsWith('drink') && dr && ph > 350) { if (due(`${uid}u`, 140, wall)) puffs.bubble(E[0], E[1], (Math.random() - 0.5) * 18 + dir * 10, -3 + Math.random() * 7); }
        else if (row.startsWith('walk_') && due(`${uid}u`, 380, wall)) puffs.bubble(E[0], E[1], (Math.random() - 0.5) * 5, -1 - Math.random() * 2);
      } else if (kind === 'fan') {
        if (!E || !row.startsWith('drink')) return;
        if (due(`${uid}f`, dr ? 60 : 120, wall)) puffs.wind(E[0], E[1], dr ? -1 : M[0] - E[0], dr ? -0.2 : M[1] - 1 - E[1]);
      } else {
        const pipe = PIPES.has(kind);
        if (E && due(`${uid}w`, dr ? 200 : pipe ? 380 : 330, wall)) puffs.wisp(E[0], E[1] - 0.5, pipe);
        if (E && dr && ph > 250 && pl.shown && due(`${uid}g`, 80, wall)) puffs.glow(E[0], E[1]);
        if (ph > cy.drag + 250 && ph < cy.drag + 1350 && due(`${uid}b`, 55, wall)) puffs.breath(M[0] + dir, M[1] + (pl.view === 'back' ? -3 : 0.5), dir, pipe);
      }
    };
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const s = useStore.getState(), y = s.fits[ID] as Yard | undefined, myId = s.me?.id;
      if (!y) return;
      const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const by = y.mower.by;
      // ── me pushing it: driven straight by the keys (or toward where I pressed), kept on the lawn ──
      if (myId && by === myId) {
        if (!drive.on) {
          const q = drawn.get(myId);
          Object.assign(drive, { on: true, x: q?.x ?? y.mower.x, y: q?.y ?? y.mower.y, face: (y.mower.face as Dir) || 'down', moving: false, target: null });
        }
        let vx = 0, vy = 0;
        for (const k of keys.current) { const w = WAYS[k]; if (w) { vx += w[0]; vy += w[1]; } }
        if (vx || vy) drive.target = null;
        else if (drive.target) {
          const dx = drive.target.x - drive.x, dy = drive.target.y - drive.y;
          if (Math.hypot(dx, dy) < 1.5) drive.target = null; else { vx = dx; vy = dy; }
        }
        const x0 = drive.x, y0 = drive.y;
        if (vx || vy) {
          const n = Math.hypot(vx, vy);
          vx /= n; vy /= n;
          // it turns to face the way it is pushed, but only once that is plainly the way (no flicking on a diagonal)
          if (Math.abs(vx) > Math.abs(vy) + 0.25) drive.face = vx > 0 ? 'right' : 'left';
          else if (Math.abs(vy) > Math.abs(vx) + 0.25) drive.face = vy > 0 ? 'down' : 'up';
          const step = (keys.current.has('shift') ? 13 : 30) * dt;
          const bad = offLawn(drive.x, drive.y, drive.face);
          for (const [nx, ny] of [[drive.x + vx * step, drive.y + vy * step], [drive.x + vx * step, drive.y], [drive.x, drive.y + vy * step]]) {
            if (offLawn(nx, ny, drive.face) <= bad + 1e-6 && (nx !== drive.x || ny !== drive.y)) { drive.x = nx; drive.y = ny; break; }
          }
          if (drive.target && drive.x === x0 && drive.y === y0) drive.target = null;      // (pressed somewhere it cannot go: it stops)
        }
        drive.moving = drive.x !== x0 || drive.y !== y0;
        faces.set(myId, drive.face);
        const here = [Math.round(drive.x * 2) / 2, Math.round(drive.y * 2) / 2];
        // where I am, for everybody to see it driven (and now and then as my place, for when I let go)
        if (drive.moving && now - atAt > 90) { atAt = now; send({ t: 'fit', id: ID, op: 'at', x: here[0], y: here[1], face: drive.face }); }
        if (drive.moving && now - placeAt > 2000) { placeAt = now; drivePlace(Math.round(drive.x), Math.round(drive.y)); }
        // the cutting: the path my feet take with the engine running, sent on a few times a second (a stretch at a time,
        // each one way round: a turn starts the next)
        if (y.mower.on) {
          const prev = pts[pts.length - 1];
          if (prev && prev[2] !== FACE_CELL[drive.face]) {
            if (pts.length >= 2) send({ t: 'fit', id: ID, op: 'mow', pts: pts.map((q) => [q[0], q[1]]), face: DIRS_BY_CELL[prev[2]] });
            pts = [[prev[0], prev[1], FACE_CELL[drive.face]]]; sentAt = now;
          }
          const p0 = pts[pts.length - 1];
          if (!p0 || Math.hypot(here[0] - p0[0], here[1] - p0[1]) >= 1) pts.push([here[0], here[1], FACE_CELL[drive.face]]);
          if (pts.length >= 2 && now - sentAt > 120) {
            send({ t: 'fit', id: ID, op: 'mow', pts: pts.map((q) => [q[0], q[1]]), face: drive.face });
            pts = [pts[pts.length - 1]]; sentAt = now;
          }
          const e = engine.current, a = actx;
          if (e && a) e.o[0].frequency.setTargetAtTime(drive.moving ? 52 : 46, a.currentTime, 0.2);
        } else pts = [];
      } else if (drive.on) { drive.on = false; drive.moving = false; drive.target = null; pts = []; }
      // the mower: in front of whoever pushes it, whichever way they face, or where it was left
      const p = by ? (by === myId ? (drive.on ? drive : undefined) : remoteAt(by) ?? drawn.get(by)) : undefined;
      let fx0 = y.mower.x, fy0 = y.mower.y, face = (y.mower.face as Dir) || 'down';
      if (by && p) { face = faces.get(by) ?? face; fx0 = p.x; fy0 = p.y; }
      const el = mowerEl.current;
      if (el) {
        const [ax, ay] = MOWER.foot[face];
        el.style.transform = `translate(${Math.round(fx0 - ax)}px, ${Math.round(fy0 - ay)}px)`;
        el.style.backgroundPositionX = `${-FACE_CELL[face] * MOWER.w}px`;
        el.style.zIndex = String(Math.round(fy0 + (face === 'down' ? 16 : face === 'up' ? -1 : 2)));
        el.dataset.face = face;
      }
      // walking over to the mower to take it: once I am at it
      const g = grabbing.current;
      if (g && myId) {
        const q = drawn.get(myId);
        if (by) grabbing.current = null;
        else if (q && Math.hypot(q.x - g.x, q.y - g.y) < 5) { grabbing.current = null; faces.set(myId, (y.mower.face as Dir) || 'down'); send({ t: 'fit', id: ID, op: 'grab' }); }
        else if (Date.now() - g.since > 15_000) grabbing.current = null;
      }
      // what comes off what people have from the smoking table, moved on and drawn
      const pc = puffCanvas.current?.getContext('2d');
      if (pc && (puffs.count || pc.canvas.dataset.dirty)) { puffs.step(dt); puffs.draw(pc); pc.canvas.dataset.dirty = puffs.count ? '1' : ''; }
      // walking over to the smoking table for something: once I am there, I take it
      const fe = fetching.current;
      if (fe && myId) {
        const q = drawn.get(myId);
        if (q && Math.hypot(q.x - STAND[0], q.y - STAND[1]) < 6) { fetching.current = null; send({ t: 'fit', id: ID, op: 'smoke', kind: fe.kind }); }
        else if (Date.now() - fe.since > 45_000) fetching.current = null;
      }
      // what they have, and the rings: placed on the people they belong to
      const box2 = fx.current;
      if (box2) {
        for (const node of Array.from(box2.children) as HTMLElement[]) {
          const uid = node.dataset.uid!, q = drawn.get(uid);
          if (!q) { node.style.display = 'none'; continue; }
          node.style.display = '';
          const kind = node.dataset.kind!;
          const pres = s.presence[uid], seat = pres?.at?.seat ?? '';
          const bd = body(uid, pres?.place === 'here' ? seat : '', q.x, q.y);
          if (kind === 'ring') {
            if (!bd || !bd.clip) { node.style.display = 'none'; continue; }
            // (the water's line: just above their feet in the pool, at the chest sat in the hot tub)
            node.style.transform = `translate(${Math.round(q.x)}px, ${Math.round(q.y - (seat && TUB.has(Number(seat.slice(1))) ? 12 : 4))}px)`;
            node.style.zIndex = String(Math.round(q.y) + 1);
            continue;
          }
          // what they have, where it goes on them in the frame they are showing just now (the sprite's own animation says
          // which: so it keeps step with them as they walk and breathe), and what comes off it
          const u = s.users[uid], item = node.firstElementChild as HTMLElement | null;
          if (!u || !item) { node.style.display = 'none'; continue; }
          let f = q.first ?? 0;
          const spr = q.el?.firstElementChild as HTMLElement | null | undefined;
          if (spr && (q.frames ?? 1) > 1) { const an = spr.getAnimations?.()[0]; f += Math.floor(Number(an?.currentTime ?? 0) / (q.ms || 150)) % (q.frames ?? 1); }
          const wall = Date.now(), dr = dragging(uid, kind, wall);
          const mk = marksOf(u), pl = place(kind, mk, q.row, f, q.flip, dr);
          if (!pl) { node.style.display = 'none'; continue; }
          const art = artUrl(pl.art, pl.flip, mk.skin);
          const ox = q.x - 24, oy = q.y - 45 + (bd?.dy ?? 0), clip = bd?.clip ?? 0;
          const under = clip > 0 && pl.y + art.h / 2 > 48 - clip;          // (in the water)
          item.style.display = pl.shown && !under ? '' : 'none';
          const key = `${pl.art}${pl.flip}${mk.skin}`;
          if (item.dataset.art !== key) {
            item.dataset.art = key;
            Object.assign(item.style, { backgroundImage: `url(${art.url})`, width: `${art.w}px`, height: `${art.h}px`, backgroundSize: `${art.w * art.n}px ${art.h}px` });
            item.style.setProperty('--to', `${-art.w * art.n}px`); item.style.setProperty('--n', String(art.n)); item.style.setProperty('--ms', `${art.ms * art.n}ms`);
            item.classList.toggle('spin', art.n > 1);
          }
          node.style.transform = `translate(${Math.round(ox + pl.x)}px, ${Math.round(oy + pl.y)}px)`;
          node.style.zIndex = String(Math.round(q.y) + 2);
          if (!under) emit(uid, kind, pl, ox, oy, dr, wall, q.row);
        }
      }
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [engine]);

  // the keys while I push it: WASD or the arrows push it that way (Shift: slower); E the engine on or off, Q let go
  useEffect(() => {
    if (!iHold || mini) return;
    const typing = (e: KeyboardEvent) => { const t = e.target as HTMLElement | null; return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable); };
    const down = (e: KeyboardEvent) => {
      if (typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'shift') { keys.current.add(k); return; }
      if (WAYS[k]) { keys.current.add(k); e.preventDefault(); return; }
      if (e.repeat) return;
      if (k === 'e') send({ t: 'fit', id: ID, op: 'engine' });
      else if (k === 'q') letGo();
    };
    const up = (e: KeyboardEvent) => keys.current.delete(e.key.toLowerCase());
    const blur = () => keys.current.clear();
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur); keys.current.clear(); };
  }, [iHold, mini]);   // eslint-disable-line react-hooks/exhaustive-deps

  // gone off somewhere else with it (a seat, the water, a click on the ground away from the lawn): it is left where it
  // is, and I carry on there (not brought back to it)
  const heldFrom = useRef('');
  useEffect(() => {
    const at = mine?.place === 'here' ? mine.at : undefined, k = at ? `${at.x},${at.y},${at.seat ?? ''}` : '';
    if (!iHold) { heldFrom.current = ''; return; }
    if (!heldFrom.current) { heldFrom.current = k || '-'; return; }
    if (!at || k === heldFrom.current || (!at.seat && drivenTo.includes(`${at.x},${at.y}`))) return;
    const x = drive.on ? drive.x : st!.mower.x, y = drive.on ? drive.y : st!.mower.y;
    droppedAt.current = Date.now();
    send({ t: 'fit', id: ID, op: 'drop', x: Math.round(x * 2) / 2, y: Math.round(y * 2) / 2, face: drive.on ? drive.face : st!.mower.face });
  }, [iHold, mine?.at?.x, mine?.at?.y, mine?.at?.seat]);   // eslint-disable-line react-hooks/exhaustive-deps

  // my dive: once I am in the air, I land in the water where the board's end is (off the board, swimming)
  const myDive = me ? st?.dives[me.id]?.at : undefined;
  useEffect(() => {
    if (!myDive || !me) return;
    const q = layout.seats[BOARD];
    // (coming up a little way out from the board, and swimming on)
    const t = window.setTimeout(() => send({ t: 'place', place: 'here', x: q.x + 18, y: q.y + 2 }), Math.max(0, 1100 - (Date.now() - skew - myDive)));
    return () => window.clearTimeout(t);
  }, [myDive]);   // eslint-disable-line react-hooks/exhaustive-deps
  // the splash, heard
  const splashes = useRef(new Set<number>());
  useEffect(() => {
    if (!st || mini) return;
    for (const d of Object.values(st.dives)) {
      if (splashes.current.has(d.at)) continue;
      splashes.current.add(d.at);
      const wait = d.at + 800 - (Date.now() - skew);
      if (wait > -400) window.setTimeout(splash, Math.max(0, wait));
    }
  }, [st?.dives, mini]);   // eslint-disable-line react-hooks/exhaustive-deps

  if (!st) return null;
  const now = Date.now() - skew;
  const name = (id: string) => users[id]?.name ?? 'Somebody';
  const op = (o: string, extra: Record<string, unknown> = {}) => send({ t: 'fit', id: ID, op: o, ...extra });
  /** Something off the smoking table: sat by it (or stood at it), it is taken there and then; otherwise I go over to it first. */
  function take(kind: string) {
    setTableMenu(false);
    if (!me) return;
    const have = st!.smoke[me.id]?.kind, q = drawn.get(me.id);
    const seat = mine?.place === 'here' ? /^b(\d+)$/.exec(mine.at?.seat ?? '') : null, sq = seat ? LAYOUT.seats[Number(seat[1])] : null;
    const near = (sq && PATIO.has(Number(seat![1])) && Math.abs(sq.x - STAND[0]) < 50 && Math.abs(sq.y - STAND[1]) < 20) || (q && Math.hypot(q.x - STAND[0], q.y - STAND[1]) < 14);
    if (have === kind || near) { fetching.current = null; op('smoke', { kind }); return; }
    fetching.current = { kind, since: Date.now() };
    send({ t: 'place', place: 'here', x: STAND[0], y: STAND[1] });
  }
  /** Letting go of it: it stays where it is, and I stand where I am (not taken back to wherever I last walked to). */
  function letGo() {
    const x = drive.on ? drive.x : st!.mower.x, y = drive.on ? drive.y : st!.mower.y;
    droppedAt.current = Date.now();
    send({ t: 'place', place: 'here', x: Math.round(x), y: Math.round(y) });
    op('drop', { x: Math.round(x * 2) / 2, y: Math.round(y * 2) / 2, face: drive.on ? drive.face : st!.mower.face });
  }
  function walkTo(x: number, y: number) {
    const [x0, y0, x1, y1] = layout.floor;
    send({ t: 'place', place: 'here', x: Math.round(Math.max(x0 + 2, Math.min(x1 - 2, x))), y: Math.round(Math.max(y0 + 2, Math.min(y1 - 2, y))) });
  }

  const M = st.mower, holder = M.by && users[M.by] ? M.by : null;
  const here = (id: string) => presence[id]?.floor === ID && presence[id]?.state !== 'offline';
  const swimmers = Object.keys(presence).filter((id) => here(id));
  const smokers = Object.entries(st.smoke).filter(([id]) => here(id));
  const myDrawn = me ? drawn.get(me.id) : undefined;
  const onBoard = mine?.place === 'here' && mine.at?.seat === BOARD_KEY;
  const lights = layout.lights;
  const [px, py, pw, ph] = T.pool as number[];
  const hole = (x: number, y: number, rx: number, ry: number, inner = 0) => `radial-gradient(${rx}px ${ry}px at ${x + DUSK_OVER}px ${y + DUSK_OVER}px, rgba(0,0,0,${inner}) 0%, rgba(0,0,0,${0.35 + inner * 0.5}) 45%, #000 100%)`;
  const holes = lights.map((l) => hole(l.x, l.y, l.rx * 1.1, l.ry * 1.1, 0.3)).join(', ');
  const dives = Object.entries(st.dives).filter(([, d]) => now - d.at > 780 && now - d.at < 2200);
  const tip = layout.seats[BOARD];

  // pressing (and dragging) on the lawn, while I push the mower: it is pushed straight toward the point, and stops there
  const pointAt = (e: { clientX: number; clientY: number; currentTarget: HTMLElement }) => {
    const r = pageRect(e.currentTarget);
    return { x: LX - 20 + ((e.clientX - r.left) / r.width) * (LW + 40), y: LY - 20 + ((e.clientY - r.top) / r.height) * (LH + 40) };
  };
  const drag = (e: ReactPointerEvent<HTMLElement>, first = false) => {
    if (!first && !(e.buttons & 1)) return;
    drive.target = pointAt(e);
  };
  /** A press on a seat or the way back in, where the pressing area reaches over it, is that and not a push: it is left
   *  to the room (sitting, or going in, lets go of the mower). */
  const inBox = (p: { x: number; y: number }, b?: number[]) => !!b && p.x >= b[0] && p.x < b[0] + b[2] && p.y >= b[1] && p.y < b[1] + b[3];
  const passes = (p: { x: number; y: number }) => layout.seats.some((q) => inBox(p, q.hit)) || inBox(p, layout.stairs?.rect) || inBox(p, T.door?.hit)
    || (layout.spots ?? []).some(([, x, y, w, h]) => inBox(p, [x, y, w, h]));

  return (
    <>
      {/* the lawn as it is: long, mown, striped, growing back */}
      <canvas ref={canvas} className="by-lawn" width={LW} height={LH} style={{ left: LX, top: LY, width: LW, height: LH, visibility: art === '-snow' ? 'hidden' : undefined }} />
      {/* clippings thrown up where long grass was just cut */}
      {clippings.filter((c) => performance.now() - c.at < 700).map((c) => [0, 1, 2, 3, 4].map((j) => (
        <i key={`${c.at}-${j}`} className="by-clip" style={{ left: c.x, top: c.y - 2, zIndex: Math.round(c.y) + 20, '--cx': `${(j - 2) * 4}px`, '--cy': `${-5 - (j % 3) * 3}px`, animationDelay: `${j * 0.04}s` } as CSSProperties} />
      )))}
      {/* the pool's water shimmering, and the waterfall */}
      <i className="by-shimmer" style={{ left: px, top: py + 5, width: pw, height: ph - 5 }} />
      <canvas ref={fallCanvas} className="by-fall" width={FALL_BOX[2]} height={FALL_BOX[3]} style={{ ...box(FALL_BOX), zIndex: T.fall[1] + T.fall[3] + 4 }} />
      {/* the hot tub: churning with the jets on, and steaming */}
      <i className={`by-tub${st.jets ? ' jets' : ''}`} style={box(T.tub)} />
      {[0, 1, 2, 3].map((j) => <i key={`st${j}`} className="by-steam" style={{ left: T.tub[0] + 10 + j * 20, top: T.tub[1] + 6, zIndex: 400, animationDelay: `${-j * 1.3}s`, opacity: (st.jets ? 0.5 : 0.28) * (0.6 + 0.6 * night) } as CSSProperties} />)}
      {/* the candle on the table */}
      <i className="by-candle" style={{ left: T.candle[0] - 1, top: T.candle[1] - 2, zIndex: 3000 }} />
      {/* the mower */}
      <i ref={mowerEl} className={`by-mower${M.on ? ' on' : ''}`} style={{ width: MOWER.w, height: MOWER.h, backgroundSize: `${MOWER.w * 4}px ${MOWER.h}px` }}>
        {M.on && [0, 1, 2].map((j) => <b key={j} className="by-exhaust" style={{ animationDelay: `${-j * 0.25}s` }} />)}
      </i>
      {!mini && !holder && (() => {
        // (only the mower itself: its deck, engine and bag, not its handle or whoever is stood at it)
        const [x0, y0, x1, y1] = deck(M.x, M.y, (M.face as Dir) || 'down');
        const busy = grabbing.current;
        return <i className="cf-hot" title={busy ? 'Walking over to the mower...' : 'The lawn mower: take it, and mow the lawn'} style={{ left: x0 - 3, top: y0 - 6, width: x1 - x0 + 6, height: y1 - y0 + 10, zIndex: 2990 }}
          onClick={(e) => { e.stopPropagation(); if (!me || Date.now() - droppedAt.current < 800) return; grabbing.current = { x: M.x, y: M.y, since: Date.now() }; walkTo(M.x, M.y); }} />;
      })()}
      {/* pushing it: press and drag on the lawn to go where I point */}
      {!mini && iHold && <i className="by-drive" title="Press where to push it" style={{ left: LX - 20, top: LY - 20, width: LW + 40, height: LH + 40 }}
        onPointerDown={(e) => { if (passes(pointAt(e))) return; e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); drag(e, true); }} onPointerMove={(e) => drag(e)}
        onClick={(e) => { if (!passes(pointAt(e))) e.stopPropagation(); }} />}
      {/* the people out here: what they hold, what they blow, the rings round them in the water */}
      <div ref={fx} className="by-fx">
        {smokers.map(([id, s]) => <div key={`${id}${s.kind}`} data-uid={id} data-kind={s.kind} className="by-smoke"><i className="item" /></div>)}
        {swimmers.map((id) => <div key={`r${id}`} data-uid={id} data-kind="ring" className="by-ring"><i /><i /></div>)}
      </div>
      {/* a splash where somebody went in */}
      {dives.map(([id, d]) => (
        <div key={`sp${d.at}`} className="by-splash" style={{ left: tip.x, top: tip.y - 4, zIndex: tip.y + 3 }}>
          {[[-9, -14], [-5, -20], [0, -24], [5, -19], [9, -13], [-12, -6], [12, -7], [-2, -17], [3, -22]].map(([sx, sy], j) => <i key={j} style={{ '--sx': `${sx}px`, '--sy': `${sy}px`, animationDelay: `${(j % 3) * 0.04}s` } as CSSProperties} />)}
          <b /><b className="two" />
          <span className="cf-say" style={{ left: 0, top: -48 }}>{d.spin ? 'Spin!' : 'Splash!'} {name(id)}</span>
        </div>
      ))}
      {/* the path up through the gate in the top left corner: to the mini golf (client/src/basement/minigolf.tsx) */}
      {!mini && T.golfPath && <i className="cf-hot" title="The path to the mini golf" style={{ ...box(T.golfPath), zIndex: 2990 }}
        onClick={(e) => { e.stopPropagation(); goFloor.setState({ to: 'minigolf' }); }} />}
      {/* the radio on its crate is the Player (Music.tsx clickRadio) */}
      {playing && [0, 1, 2].map((j) => <b key={`n${j}`} className="cf-note" style={{ left: T.radio[0] + 10 + j * 3, top: T.radio[1] + 2, zIndex: 2985, animationDelay: `${-j * 0.9}s` } as CSSProperties}>{j % 2 ? '♫' : '♪'}</b>)}
      {!mini && <i className="cf-hot" title={radioSays()} style={{ ...box(T.radio), zIndex: 2990 }}
        onClick={(e) => { e.stopPropagation(); clickRadio(T.radio[0] + T.radio[2] + 2, T.radio[1] - 20); }} />}
      {/* the smoke and the bubbles, the breath and the breeze */}
      {!mini && <canvas ref={puffCanvas} className="by-puffs" width={layout.w * SCALE} height={layout.h * SCALE} style={{ width: layout.w, height: layout.h, zIndex: 2979 }} />}
      {/* the smoking table: a click on it is the menu of what is on it */}
      {!mini && <i className="cf-hot" title="The smoking table: a cigarette, a cigar, a pipe, bubbles, a mini fan" style={{ ...box(TABLE), zIndex: 2990 }}
        onClick={(e) => { e.stopPropagation(); setTableMenu((v) => !v); }} />}
      {!mini && tableMenu && (() => {
        const have = me ? st.smoke[me.id]?.kind : undefined;
        return (
          <div className="act-menu" style={{ left: TABLE[0] + TABLE[2] + 3, top: Math.max(4, TABLE[1] - 34), zIndex: 4000 }} onClick={(e) => e.stopPropagation()}>
            <b>Off the smoking table</b>
            {KINDS.map((k) => <button key={k} onClick={() => take(k)}>{have === k ? `Put down ${LABEL[k].replace(/^An? /, 'the ').toLowerCase()}` : LABEL[k]}</button>)}
          </div>
        );
      })()}
      {/* the hot tub's panel: the jets */}
      {!mini && <i className="cf-hot" title={st.jets ? "The hot tub's jets are on (click to turn them off)" : "The hot tub's jets: click to turn them on"} style={{ ...box(T.tubPanel), zIndex: 2990 }}
        onClick={(e) => { e.stopPropagation(); op('jets'); }} />}
      {/* the diving board: onto it, then off it */}
      {!mini && <i className="cf-hot" title={onBoard ? 'Jump in!' : 'The diving board: walk out on to it'} style={{ ...box(T.boardAt), zIndex: 2990 }}
        onClick={(e) => {
          e.stopPropagation();
          if (onBoard) op('dive');
          else send({ t: 'place', place: 'here', x: tip.x, y: tip.y, seat: BOARD_KEY });
        }} />}
      {/* what I am doing with the mower */}
      {!mini && iHold && (
        <div className="by-hud" style={{ zIndex: 3600 }} onClick={(e) => e.stopPropagation()}>
          <button className={M.on ? 'on' : ''} onClick={() => op('engine')} title="E">{M.on ? 'Engine on' : 'Engine off'}</button>
          <button onClick={letGo} title="Q">Let go</button>
          <em>WASD or arrows (Shift: slower), or press on the lawn</em>
        </div>
      )}
      {!mini && holder && holder !== me?.id && myDrawn && <span className="by-who" style={{ zIndex: 3500 }}>{name(holder)} is mowing</span>}
      {st.last && now - st.lastAt < 7000 && <b className="cf-last" style={{ zIndex: 3500 }}>{st.last}</b>}
      {/* the lawn games: beer pong on the patio, horseshoes and bocce on the lawn (./lawngames.tsx) */}
      <LawnGames mini={mini} light={light} />
      {/* night falls, but not round the lights; the pool glows from underneath */}
      <i className="cf-dusk" style={{ inset: -DUSK_OVER, opacity: dusk, zIndex: 2980, maskImage: holes, WebkitMaskImage: holes } as CSSProperties} />
      {/* the season in the air (client/src/season.tsx): leaves, pollen, fireflies, flurries; what lies on the ground goes under everybody (over the lawn) */}
      <SeasonAir scene="backyard" w={layout.w} h={layout.h} light={light} dusk={dusk} airZ={2981} groundZ={4} />
      {/* the holiday's decorations (client/src/holidays/outdoor.tsx), and a snowman while it snows */}
      <OutdoorDecor scene="backyard" seasons={(layout as { seasons?: string[] }).seasons} light={light} w={layout.w} h={layout.h} />
      {night > 0.3 && <i className="by-poolglow" style={{ left: px - 10, top: py - 6, width: pw + 20, height: ph + 12, zIndex: 2981, opacity: night * 0.75 }} />}
      {night > 0.3 && lights.map((l, j) => <i key={j} className="cf-glow lamp" style={{ left: l.x - l.rx * 1.2, top: l.y - l.ry * 1.2, width: l.rx * 2.4, height: l.ry * 2.4, zIndex: 2982, opacity: night * 0.55 }} />)}
    </>
  );
}
