// Bowling on the page (server/basement/bowling.ts keeps the turns and the scores; bowling.ts is the physics and the
// scoring). In the room: the pins standing on the lane, the ball rolling down it, and the scores on the screen on the wall.
// Click the lane to open it large, seen from behind the bowler, with a camera on the pins in the corner.
//
// Throwing, on your turn: drag along the approach (below the foul line) to choose where you stand; point down the lane to
// choose your line (a marker on the arrows shows where you are aiming, and nothing more: where the ball ends up is for you
// to learn). Then three presses of Space (or clicks on the lane): the first sets your line and starts the hook meter
// swinging from side to side, the second stops it (left of the middle breaks left), the third stops the power meter as
// it runs up and down. Both meters run at an even pace and turn straight round at the ends, so no value can be waited
// for. A medium hook strikes best (it brings the ball into the pocket at about five degrees); a full one burns the ball's
// pace up and is the hardest to repeat. Your hand is never quite steady: the server adds a little to everything.
//
// Watching: while someone lines up, their stand and aim come through the server (op 'aim') and their ball and marker
// are drawn; their meters are not shown. Once the ball is well down the lane the camera follows it in, the pin camera
// in the corner shows the deck, and fallen pins tumble, hop and drop into the pit. The sounds (the ball's roll, the
// crash, the pins, the gutter) are made here at the soundboard's volume, only with the lane open in front of you.
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { hooks, send, soundGain, useStore } from '../store';
import { hush, onLeavingRoom, out, useWatching } from './sound';
import { personColor } from '../sprites';
import { BALL_R, DECK_END, GUTTER, LANE_HALF, marks, PIN_R, PIN_Y, PINS, scores } from './bowling';
import type { FitProps } from './index';
import { gameSpots, useGameSpot } from './spots';
import { pageRect } from '../device';

const ID = 'bowling';
type Bowl = { players: string[]; rolls: number[][]; turn: number; frame: number; ball: number; standing: boolean[]; on: boolean; over: boolean; busyUntil: number; last: string };

/** A roll being shown, and what was read from its frames: when the ball first meets a pin, when it is well down the
 *  lane (the camera follows it in from then), and when and where each pin starts to fall. */
type Shown = { who: string; frames: number[][]; ms: number; t0: number; after: Bowl; contact: number; pass: number; falls: ({ t: number; x: number; y: number; spin: number } | null)[]; downs: number };
type Watch = { who: string; x: number; aim: number; at: number };
const useLocal = create<{ roll: Shown | null; open: boolean; watch: Watch | null }>()(() => ({ roll: null, open: false, watch: null }));
/** Opens it large (or shuts it), from outside the room (Play Games' Game Room tab). It shows once the room is the game room. */
export const setOpen = (open: boolean) => useLocal.setState({ open });
// closing it (or being taken out of the room) silences the roll still playing
useLocal.subscribe((s, p) => { if (p.open && !s.open) hush(ID); });
onLeavingRoom(() => useLocal.setState({ open: false }));

function readRoll(frames: number[][], ms: number) {
  let contact = -1, pass = -1;
  const falls: Shown['falls'] = PINS.map(() => null);
  for (let k = 1; k < frames.length; k++) {
    const a = frames[k - 1], c = frames[k];
    if (pass < 0 && c[1] > 450 && c[0] > -900) pass = k * ms;
    for (let i = 0; i < 10; i++) {
      const moved = Math.hypot(c[2 + i * 3] - a[2 + i * 3], c[3 + i * 3] - a[3 + i * 3]);
      if (contact < 0 && c[4 + i * 3] !== 2 && moved > 0.05) contact = (k - 1) * ms;
      if (!falls[i] && c[4 + i * 3] === 1) falls[i] = { t: k * ms, x: c[2 + i * 3], y: c[3 + i * 3], spin: (moved / ms) * (i % 2 ? -1 : 1) * 0.9 };
    }
  }
  const end = frames[frames.length - 1] ?? [];
  return { contact, pass, falls, downs: PINS.filter((_, i) => end[4 + i * 3] === 1).length };
}

// -- sound: made up on the spot (filtered noise and short tones), quiet, at the soundboard's volume --
let actx: AudioContext | null = null, noise: AudioBuffer | null = null;
function audio() {
  const s = useStore.getState();
  const vol = s.voice.deafened ? 0 : soundGain(s.prefs.soundVol);
  if (!vol || !useLocal.getState().open || document.hidden) return null;     // (only with the lane open in front of me; hidden: the app is in the tray, silent)
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
/** The whole roll's sound, laid out at once: the ball's rumble (its pitch following its pace, a rattle in the gutter),
 *  the crash when it meets the pins (bigger the more go down), and a knock for each pin as it falls. */
function soundRoll(r: Shown) {
  const au = audio();
  if (!au) return;
  const { a, vol } = au, t0 = a.currentTime + 0.02;
  const src = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
  src.buffer = noise; src.loop = true; f.type = 'lowpass'; f.Q.value = 4; f.frequency.value = 160;
  g.gain.setValueAtTime(0.0001, t0);
  let last = t0;
  for (let k = 1; k < r.frames.length; k++) {
    const p = r.frames[k - 1], c = r.frames[k], at = t0 + (k * r.ms) / 1000;
    if (c[0] < -900 || p[0] < -900) { g.gain.linearRampToValueAtTime(0.0001, at); last = at; break; }
    const v = (Math.hypot(c[0] - p[0], c[1] - p[1]) / r.ms) * 1000, gutter = Math.abs(c[0]) > LANE_HALF;
    f.frequency.linearRampToValueAtTime(gutter ? 520 + (k % 2) * 260 : 70 + v * 0.45, at);
    g.gain.linearRampToValueAtTime(0.0001 + vol * (gutter ? 0.5 + (k % 2) * 0.35 : 0.9) * Math.min(1, v / 300) * Math.min(1, k / 6), at);
    last = at;
  }
  g.gain.linearRampToValueAtTime(0.0001, last + 0.15);
  src.connect(f).connect(g).connect(out(a, ID)); src.start(t0); src.stop(last + 0.3);
  src.onended = () => g.disconnect();
  if (r.contact >= 0) {
    const at = t0 + r.contact / 1000, k = 0.35 + 0.65 * (r.downs / 10);
    for (let i = 0; i < 3 + r.downs; i++) burst(a, at + i * 0.018 + Math.random() * 0.02, 0.06 + Math.random() * 0.08, 'bandpass', 900 + Math.random() * 2400, 2.5, vol * 1.1 * k * (1 - i * 0.05));
    burst(a, at, 0.18 * k + 0.05, 'lowpass', 400, 1, vol * 1.2 * k); tone(a, at, 150, 70, 0.16, vol * 0.5 * k);
  }
  for (const fl of r.falls) if (fl && fl.t > r.contact + 30) { const at = t0 + fl.t / 1000 + Math.random() * 0.03; burst(a, at, 0.035, 'bandpass', 2200 + Math.random() * 1400, 6, vol * 0.45); tone(a, at, 900 + Math.random() * 300, 600, 0.03, vol * 0.12); }
}

let listening = false;
function listen() {
  if (listening) return;
  listening = true;
  hooks.fit.push((d) => {
    if (d.id !== ID) return;
    if (d.op === 'aim') {                                                // (someone lining up: drawn for everybody else)
      if (d.who !== useStore.getState().me?.id) useLocal.setState({ watch: { who: String(d.who), x: Number(d.x) || 0, aim: Number(d.aim) || 0, at: performance.now() } });
      return;
    }
    if (d.op !== 'roll') return;
    const frames = d.frames as number[][], ms = Number(d.ms) || 33;
    const roll: Shown = { who: String(d.who), frames, ms, t0: performance.now(), after: d.after as Bowl, ...readRoll(frames, ms) };
    useLocal.setState({ roll, watch: null });
    soundRoll(roll);
    window.setTimeout(() => {
      if (useLocal.getState().roll !== roll) return;
      useLocal.setState({ roll: null });
      useStore.setState((s) => ({ fits: { ...s.fits, [ID]: roll.after } }));
    }, roll.frames.length * roll.ms + 900);                               // (a moment to see what is left standing)
  });
}
const useBowl = () => useStore((s) => s.fits[ID] as Bowl | null | undefined);
const user = (id: string) => useStore.getState().users[id];
const nameOf = (id: string) => user(id)?.name ?? 'Somebody';
const colorOf = (id: string) => { const u = user(id); return u ? personColor(u) : '#ffffff'; };

/** A pin just now: where, its state (0 standing, 1 down, 2 not there), and for a fallen one how it lies (turned
 *  `rot`, `hop` inches off the deck as it goes over, `fade` as it drops into the pit). */
type PinNow = { x: number; y: number; st: number; rot: number; hop: number; fade: number };
/** The ball and the pins just now (the ball null when it is not on the lane). */
function sceneNow(b: Bowl | null | undefined, t: number): { ball: [number, number] | null; pins: PinNow[]; who: string } {
  const r = useLocal.getState().roll;
  if (r) {
    const el = t - r.t0, f = Math.min(r.frames.length - 1, Math.max(0, el / r.ms)), k = Math.floor(f), u = f - k;
    const a = r.frames[k], c = r.frames[Math.min(k + 1, r.frames.length - 1)];
    const lerp = (i: number) => a[i] + (c[i] - a[i]) * u;
    const ball: [number, number] | null = a[0] < -900 || c[0] < -900 ? null : [lerp(0), lerp(1)];
    const pins = PINS.map((_, i): PinNow => {
      const x = lerp(2 + i * 3), y = lerp(3 + i * 3), st = a[4 + i * 3], fl = r.falls[i];
      if (st !== 1 || !fl) return { x, y, st, rot: 0, hop: 0, fade: 1 };
      // it goes over the way it is knocked, turning as it slides (the further, the more), with a little hop as it tips
      const dt = Math.max(0, el - fl.t), went = Math.hypot(x - fl.x, y - fl.y), dir = went > 0.4 ? Math.atan2(y - fl.y, x - fl.x) : i * 1.3;
      return { x, y, st, rot: dir + (went / 3.2) * Math.sign(fl.spin || 1), hop: dt < 280 ? 2.6 * Math.sin((Math.PI * dt) / 280) : 0, fade: Math.max(0, Math.min(1, 1 - (y - DECK_END) / 10)) };
    });
    return { ball, pins, who: r.who };
  }
  const standing = b?.standing ?? Array(10).fill(true);
  return { ball: null, pins: PINS.map(([x, y], i) => ({ x, y, st: standing[i] ? 0 : 2, rot: 0, hop: 0, fade: 1 })), who: '' };
}

/** Every frame; or, given `busy`, only while that says something is moving (and once more whenever the game or a roll
 *  changes): the lane in the room sits still between rolls, and must not keep the page drawing every frame meanwhile. */
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

// ───────────────────────── in the room ─────────────────────────

/** The lane in the game room, running up the room: its edges, the end of the pin deck (top) and the foul line. */
type LaneBox = { x0: number; x1: number; top: number; foul: number; gutter: number };

function MiniLane({ lane }: { lane: LaneBox }) {
  const b = useBowl();
  const ref = useRef<HTMLCanvasElement>(null);
  const S = 4, w = lane.x1 - lane.x0 + lane.gutter * 2 + 1, h = lane.foul - lane.top + 1;
  const last = useRef<{ c: CanvasRenderingContext2D | null; key: string }>({ c: null, key: '' });
  useTicker((t) => {
    const c = ref.current?.getContext('2d');
    if (!c) return;
    const sc = sceneNow(b, t);
    // drawn again only when something on it has moved (with nobody bowling, the lane is left as it is, not redrawn
    // sixty times a second while it sits in the room)
    const key = `${w},${h}|${sc.pins.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)},${p.st},${p.fade.toFixed(3)}`).join(' ')}|${sc.ball ? `${sc.ball[0].toFixed(2)},${sc.ball[1].toFixed(2)},${sc.who}` : ''}`;
    if (last.current.c === c && last.current.key === key) return;
    last.current = { c, key };
    c.clearRect(0, 0, w * S, h * S);
    const X = (x: number) => (lane.gutter + (lane.x1 - lane.x0) / 2 + (x * (lane.x1 - lane.x0)) / (2 * LANE_HALF)) * S;
    const Y = (y: number) => (h - (y * (lane.foul - lane.top)) / DECK_END) * S;
    for (const p of [...sc.pins].sort((m, n) => n.y - m.y)) {
      if (p.st === 2 || p.fade <= 0) continue;
      c.globalAlpha = p.fade * (p.st ? 0.55 : 1);
      c.beginPath(); c.arc(X(p.x), Y(p.y), 6.5, 0, Math.PI * 2); c.fillStyle = '#fbf8f0'; c.fill();
      c.lineWidth = 1.5; c.strokeStyle = 'rgba(40,30,20,0.7)'; c.stroke();
      if (!p.st) { c.fillStyle = '#e04040'; c.beginPath(); c.arc(X(p.x), Y(p.y) - 1.5, 2.4, 0, Math.PI * 2); c.fill(); }
    }
    c.globalAlpha = 1;
    if (sc.ball) { c.beginPath(); c.arc(X(sc.ball[0]), Y(sc.ball[1]), 9, 0, Math.PI * 2); c.fillStyle = colorOf(sc.who); c.fill(); c.strokeStyle = '#000'; c.lineWidth = 2; c.stroke(); c.beginPath(); c.arc(X(sc.ball[0]) - 3, Y(sc.ball[1]) - 3, 2.5, 0, Math.PI * 2); c.fillStyle = 'rgba(255,255,255,0.5)'; c.fill(); }
  }, [b], () => !!useLocal.getState().roll);
  return <canvas ref={ref} className="gr-mini" width={w * S} height={h * S} style={{ left: lane.x0 - lane.gutter, top: lane.top, width: w, height: h, zIndex: lane.foul + 1 }} />;
}

function Scoreboard({ at }: { at: number[] }) {
  const b = useBowl();
  return (
    <div className="bw-board" style={{ left: at[0], top: at[1], width: at[2], height: at[3] }}>
      {!b?.players.length ? <span>LANE 1</span> : b.players.slice(0, 2).map((id, k) => {
        const s = scores(b.rolls[k] ?? []), tot = [...s].reverse().find((v) => v !== null) ?? 0;
        return <div key={id} className={b.on && b.turn === k ? 'up' : ''}><span>{nameOf(id).slice(0, 6)}</span><b>{tot}</b></div>;
      })}
    </div>
  );
}

/** The bowling lane, drawn in the game room: its pins and the ball on it, and a click to open it large. */
export function BowlingRoom({ layout, mini }: { layout: FitProps['layout']; mini: boolean }) {
  listen();
  const lane = layout.things.bowl as LaneBox;
  const open = useLocal((s) => s.open);
  const b = useBowl(), me = useStore((s) => s.me?.id ?? '');
  // (./spots) whoever's turn it is walks up onto the approach and faces the pins; the other bowlers sit on the bench
  // behind it (then stand by it); whoever has the lane open only to watch stands off to the side
  const live = !!b?.on && !b.over, up = live && b!.players[b!.turn] === me, playing = !!b?.players.includes(me);
  const S = gameSpots(layout, 'bowling');
  useGameSpot(layout, mini, playing && (live || open) ? (up ? 'bowl-go' : 'bowl-wait') : open ? 'bowl-watch' : null, up ? S.go : playing ? S.wait : S.watch);
  return (
    <>
      <MiniLane lane={lane} />
      {layout.things.scoreboard && <Scoreboard at={layout.things.scoreboard as number[]} />}
      <i className="gr-hot" title="The bowling lane: click to bowl or watch" style={{ left: lane.x0 - lane.gutter, top: lane.top - 60, width: lane.x1 - lane.x0 + lane.gutter * 2, height: lane.foul - lane.top + 60, zIndex: 3 }}
        onClick={(e) => { e.stopPropagation(); if (!mini) useLocal.setState({ open: true }); }} />
      {open && !mini && createPortal(<Overlay />, document.querySelector('.main-view') ?? document.body)}
    </>
  );
}

// ───────────────────────── large ─────────────────────────

type View = { y: number; h: number; F: number; cx: number; hor: number };
const project = (cam: View, x: number, y: number, z: number) => { const D = y - cam.y; return { x: cam.cx + (x * cam.F) / D, y: cam.hor + ((cam.h - z) * cam.F) / D, s: cam.F / D, D }; };

function drawLane(c: CanvasRenderingContext2D, cam: View, wpx: number, hpx: number) {
  c.fillStyle = '#0c0a1e'; c.fillRect(0, 0, wpx, hpx);
  const near = Math.max(cam.y + 12, -60), far = DECK_END + 40;
  const quad = (xa: number, xb: number, ya: number, yb: number, fill: string) => {
    const p = [project(cam, xa, ya, 0), project(cam, xb, ya, 0), project(cam, xb, yb, 0), project(cam, xa, yb, 0)];
    c.beginPath(); p.forEach((q, i) => (i ? c.lineTo(q.x, q.y) : c.moveTo(q.x, q.y))); c.closePath(); c.fillStyle = fill; c.fill();
  };
  quad(-LANE_HALF - GUTTER - 14, LANE_HALF + GUTTER + 14, near, far, '#1a1830');                    // the capping either side
  quad(-LANE_HALF - GUTTER, -LANE_HALF, near, DECK_END, '#4a505e');                              // the gutters
  quad(LANE_HALF, LANE_HALF + GUTTER, near, DECK_END, '#4a505e');
  quad(-LANE_HALF, LANE_HALF, near, PIN_Y - 30, '#e2bc80');                                       // the lane
  quad(-LANE_HALF, LANE_HALF, PIN_Y - 30, DECK_END, '#ecd09c');                                   // the pin deck
  quad(-LANE_HALF - GUTTER, LANE_HALF + GUTTER, DECK_END, far, '#06040c');                       // the pit
  if (near < 0) quad(-LANE_HALF, LANE_HALF, near, 0, '#f0d8a8');                               // the approach (when the camera is behind it: it follows the ball in)
  c.strokeStyle = 'rgba(120,80,40,0.25)'; c.lineWidth = 1;
  for (let k = 1; k < 39; k++) {                                                                  // the boards
    const x = -LANE_HALF + (k * 2 * LANE_HALF) / 39, a = project(cam, x, Math.max(near, 0), 0), b = project(cam, x, DECK_END, 0);
    c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke();
  }
  const f0 = project(cam, -LANE_HALF - GUTTER, 0, 0), f1 = project(cam, LANE_HALF + GUTTER, 0, 0);
  if (near < 0) { c.strokeStyle = '#e04040'; c.lineWidth = Math.max(1, f0.s * 1); c.beginPath(); c.moveTo(f0.x, f0.y); c.lineTo(f1.x, f1.y); c.stroke(); }
  c.fillStyle = '#3a2614';
  for (const bx of [-15, -10, -5, 0, 5, 10, 15]) {                                                 // the arrows, 15 feet down
    const y = 180 + Math.abs(bx) * 2;
    if (y - 9 < near) continue;
    const a = project(cam, bx * 1.04, y, 0), l = project(cam, bx * 1.04 - 0.9, y - 9, 0), r = project(cam, bx * 1.04 + 0.9, y - 9, 0);
    c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(l.x, l.y); c.lineTo(r.x, r.y); c.closePath(); c.fill();
  }
  const top = project(cam, -LANE_HALF - GUTTER - 14, far, 46), bot = project(cam, LANE_HALF + GUTTER + 14, far, 0);   // the pinsetter's housing
  c.fillStyle = '#16142a'; c.fillRect(top.x, top.y, bot.x - top.x, bot.y - top.y);
  c.fillStyle = '#4fe0ff'; c.fillRect(top.x, bot.y - (bot.y - top.y) * 0.08, bot.x - top.x, (bot.y - top.y) * 0.08);
  const neon = ['#ff4fd8', '#4fe0ff', '#c8ff4f', '#ffb84f'];
  for (let k = 0; k < 8; k++) { c.fillStyle = neon[k % 4]; c.fillRect(top.x + ((bot.x - top.x) * (k + 0.5)) / 8 - 3, top.y + (bot.y - top.y) * 0.2, 6, 6); }
}
function drawPin(c: CanvasRenderingContext2D, cam: View, p: PinNow) {
  const { x, y, st: state } = p;
  if (state === 2 || p.fade <= 0) return;
  const base = project(cam, x, y, 0);
  if (base.D < 20) return;
  const s = base.s;
  if (state === 1) {                                                                              // down: lying on its side, tumbling
    const up = project(cam, x, y, 2.2 + p.hop);
    c.save(); c.globalAlpha *= p.fade;
    c.fillStyle = 'rgba(0,0,0,0.22)'; c.beginPath(); c.ellipse(base.x, base.y, 6.5 * s, 1.6 * s, 0, 0, Math.PI * 2); c.fill();
    c.translate(up.x, up.y); c.rotate(Math.atan2(Math.sin(p.rot) * 0.45, Math.cos(p.rot)));      // (flattened: the deck is seen from low down)
    const len = 0.55 + 0.45 * Math.abs(Math.cos(p.rot));
    const lg = c.createLinearGradient(0, -2.4 * s, 0, 2.4 * s); lg.addColorStop(0, '#ffffff'); lg.addColorStop(0.6, '#e8e4da'); lg.addColorStop(1, '#a8a49a');
    c.fillStyle = lg;
    c.beginPath(); c.ellipse(-1.6 * s * len, 0, 4.6 * s * len, 2.4 * s, 0, 0, Math.PI * 2); c.fill();
    c.fillRect(2 * s * len, -0.85 * s, 3.4 * s * len, 1.7 * s);
    c.beginPath(); c.ellipse(5.9 * s * len, 0, 1.4 * s * len, 1.3 * s, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#d82a2a'; c.fillRect(3 * s * len, -0.9 * s, 0.5 * s * len, 1.8 * s); c.fillRect(3.9 * s * len, -0.9 * s, 0.5 * s * len, 1.8 * s);
    c.restore(); return;
  }
  c.fillStyle = 'rgba(0,0,0,0.25)'; c.beginPath(); c.ellipse(base.x, base.y, PIN_R * s * 1.1, PIN_R * s * 0.4, 0, 0, Math.PI * 2); c.fill();
  const belly = project(cam, x, y, 4.5), neck = project(cam, x, y, 10.5), head = project(cam, x, y, 13.2);
  const pg = c.createLinearGradient(belly.x - PIN_R * s, 0, belly.x + PIN_R * s, 0); pg.addColorStop(0, '#ffffff'); pg.addColorStop(0.45, '#f4f1ea'); pg.addColorStop(1, '#bdb8ac');
  c.fillStyle = pg;
  c.beginPath(); c.ellipse(belly.x, belly.y, PIN_R * s, 4.8 * s, 0, 0, Math.PI * 2); c.fill();
  c.fillRect(neck.x - 0.85 * s, neck.y - 1 * s, 1.7 * s, belly.y - neck.y);
  c.beginPath(); c.ellipse(head.x, head.y, 1.25 * s, 1.6 * s, 0, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#d82a2a'; c.fillRect(neck.x - 0.9 * s, neck.y - 0.2 * s, 1.8 * s, 0.6 * s); c.fillRect(neck.x - 0.9 * s, neck.y + 0.8 * s, 1.8 * s, 0.6 * s);
  c.strokeStyle = 'rgba(0,0,0,0.25)'; c.lineWidth = 1; c.beginPath(); c.ellipse(belly.x, belly.y, PIN_R * s, 4.8 * s, 0, 0, Math.PI * 2); c.stroke();
}
function drawBall(c: CanvasRenderingContext2D, cam: View, x: number, y: number, color: string) {
  const drop = Math.max(0, y - DECK_END);                                                         // (into the pit: it sinks out of sight)
  if (drop > 12) return;
  const p = project(cam, x, y, BALL_R - drop * 0.8);
  if (p.D < 10) return;
  const r = BALL_R * p.s;
  c.fillStyle = 'rgba(0,0,0,0.3)'; const g0 = project(cam, x, y, 0); c.beginPath(); c.ellipse(g0.x, g0.y, r, r * 0.35, 0, 0, Math.PI * 2); c.fill();
  c.beginPath(); c.arc(p.x, p.y, r, 0, Math.PI * 2); c.fillStyle = color; c.fill();
  c.beginPath(); c.arc(p.x - r * 0.35, p.y - r * 0.35, r * 0.3, 0, Math.PI * 2); c.fillStyle = 'rgba(255,255,255,0.45)'; c.fill();
  c.fillStyle = 'rgba(0,0,0,0.6)'; for (const [dx, dy] of [[0.1, -0.1], [0.35, -0.05], [0.22, 0.2]]) { c.beginPath(); c.arc(p.x + dx * r, p.y + dy * r, r * 0.08, 0, Math.PI * 2); c.fill(); }
}
function drawScene(c: CanvasRenderingContext2D, cam: View, w: number, h: number, sc: ReturnType<typeof sceneNow>) {
  drawLane(c, cam, w, h);
  const things: { y: number; draw: () => void }[] = sc.pins.map((p) => ({ y: p.y, draw: () => drawPin(c, cam, p) }));
  if (sc.ball) things.push({ y: sc.ball[1], draw: () => drawBall(c, cam, sc.ball![0], sc.ball![1], colorOf(sc.who)) });
  things.sort((a, b) => b.y - a.y).forEach((t) => t.draw());
}

const W = 960, H = 560;
const MAIN: View = { y: -200, h: 30, F: 2170, cx: W / 2, hor: 90 };
const PC_W = 340, PC_H = 220;
const PIN_CAM: View = { y: 560, h: 30, F: 680, cx: PC_W / 2, hor: 52 };
/** Where the main camera is: behind the bowler, until the ball is well down the lane (y 450), then following it in. */
function camNow(t: number): View {
  const r = useLocal.getState().roll;
  if (!r || r.pass < 0) return MAIN;
  const u = Math.max(0, Math.min(1, (t - r.t0 - r.pass) / 600)), e = u * u * (3 - 2 * u);
  return { ...MAIN, y: MAIN.y + (380 - MAIN.y) * e };
}
// The two meters, both in straight lines (triangles) at an even pace, turning straight round at the ends: hook swings
// side to side (-1..1), power runs up and down, so no value is lingered on.
const HOOK_MS = 1100, POWER_MS = 1050;
const hookAt = (ms: number) => { const f = (ms / HOOK_MS + 0.25) % 1; return f < 0.5 ? -1 + 4 * f : 3 - 4 * f; };
const powerAt = (ms: number) => { const f = (ms / POWER_MS) % 1; return f < 0.5 ? f * 2 : 2 - f * 2; };
/** The arrows, 15 feet down: where the line I have chosen crosses them is shown, and no more of it. */
const ARROWS_Y = 180;

function Overlay() {
  useWatching(ID);
  const b = useBowl();
  const me = useStore((s) => s.me?.id ?? '');
  const roll = useLocal((s) => s.roll);
  const ref = useRef<HTMLCanvasElement>(null);
  const pinRef = useRef<HTMLCanvasElement>(null);
  const [pos, setPos] = useState(0);                              // where I stand, across the approach
  const aim = useRef(0);                                          // where I am aiming, across the lane at the pins
  const drag = useRef<'' | 'stand'>('');
  /** The throw, press by press: aiming, then the hook meter swinging, then the power meter running. */
  const step = useRef<{ phase: 'aim' | 'hook' | 'power'; t0: number; hook: number }>({ phase: 'aim', t0: 0, hook: 0 });
  const close = () => useLocal.setState({ open: false });
  const downOn = useRef(false);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, []);
  const at = b ? b.players.indexOf(me) : -1;
  const myTurn = !!b && b.on && !b.over && b.turn === at && !roll;
  const angleOf = () => Math.max(-0.2, Math.min(0.2, Math.atan2(aim.current - pos, PIN_Y)));
  useEffect(() => { step.current = { phase: 'aim', t0: 0, hook: 0 }; }, [myTurn]);
  /** Space or a click on the lane: start the hook meter, stop it, stop the power meter (and bowl). */
  const press = () => {
    if (!myTurn) return;
    const s = step.current, now = performance.now();
    if (s.phase === 'aim') step.current = { phase: 'hook', t0: now, hook: 0 };
    else if (s.phase === 'hook') step.current = { phase: 'power', t0: now, hook: hookAt(now - s.t0) };
    else {
      const power = powerAt(now - s.t0);
      step.current = { phase: 'aim', t0: 0, hook: 0 };
      send({ t: 'fit', id: ID, op: 'bowl', x: pos, angle: angleOf(), power, hook: s.hook });
    }
  };
  const pressRef = useRef(press);
  pressRef.current = press;
  const myTurnRef = useRef(myTurn);
  myTurnRef.current = myTurn;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      // before the first press: the arrows (or A and D) slide the ball across the approach a board at a time (held, it keeps going)
      const dir = e.code === 'ArrowLeft' || e.code === 'KeyA' ? -1 : e.code === 'ArrowRight' || e.code === 'KeyD' ? 1 : 0;
      if (dir) {
        if (!myTurnRef.current || step.current.phase !== 'aim') return;
        e.preventDefault();
        setPos((p) => Math.max(-LANE_HALF + BALL_R, Math.min(LANE_HALF - BALL_R, p + (dir * 2 * LANE_HALF) / 39)));
        return;
      }
      if (e.code !== 'Space' || e.repeat) return;
      e.preventDefault();                                          // (and not a click on whichever button has the focus:
      if (el?.tagName === 'BUTTON') el.blur();                     //  a button is pressed by Space when the key comes up)
      pressRef.current();
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, []);

  // while I line up, where I stand and aim goes to everybody watching (a few times a second, and only when it changes)
  const posRef = useRef(pos);
  posRef.current = pos;
  useEffect(() => {
    if (!myTurn) return;
    let sent = '';
    const tick = window.setInterval(() => {
      const now = `${posRef.current.toFixed(1)} ${aim.current.toFixed(1)}`;
      if (now === sent) return;
      sent = now;
      send({ t: 'fit', id: ID, op: 'aim', x: posRef.current, aim: aim.current });
    }, 200);
    return () => window.clearInterval(tick);
  }, [myTurn]);

  useTicker((t) => {
    const c = ref.current?.getContext('2d'), pc = pinRef.current?.getContext('2d');
    if (!c) return;
    const sc = sceneNow(b, t), r = useLocal.getState().roll;
    // a shake of the picture as the ball meets the pins
    const hit = r && r.contact >= 0 ? t - r.t0 - r.contact : -1, shake = hit >= 0 && hit < 150 ? 3.5 * (1 - hit / 150) : 0;
    c.fillStyle = '#0c0a1e'; c.fillRect(0, 0, W, H);
    c.save(); if (shake) c.translate((Math.random() * 2 - 1) * shake, (Math.random() * 2 - 1) * shake);
    drawScene(c, camNow(t), W, H, sc);
    c.restore();
    /** The marker on the arrows for a line from `x` aiming at `aimX` across the pins. */
    const chevron = (x: number, aimX: number, color: string, alpha: number) => {
      const ax = x + Math.tan(Math.max(-0.2, Math.min(0.2, Math.atan2(aimX - x, PIN_Y)))) * ARROWS_Y, m = project(MAIN, ax, ARROWS_Y, 0.3), sz = Math.max(4, m.s * 3.2);
      c.save(); c.globalAlpha = alpha; c.shadowColor = color; c.shadowBlur = 8; c.strokeStyle = color; c.lineWidth = 2;
      c.beginPath(); c.moveTo(m.x - sz, m.y + sz * 0.6); c.lineTo(m.x, m.y - sz * 0.4); c.lineTo(m.x + sz, m.y + sz * 0.6); c.stroke(); c.restore();
    };
    const w = useLocal.getState().watch;
    if (!myTurn && !r && b?.on && !b.over && w && w.who === b.players[b.turn]) {      // watching someone line up
      chevron(w.x, w.aim, colorOf(w.who), 0.8);
      c.globalAlpha = 0.85; drawBall(c, MAIN, w.x, -8, colorOf(w.who)); c.globalAlpha = 1;
    }
    if (myTurn) {                                                 // me on the approach, and the mark I am aiming over
      const s = step.current, now = performance.now();
      const hook = s.phase === 'hook' ? hookAt(now - s.t0) : s.hook, power = s.phase === 'power' ? powerAt(now - s.t0) : 0;
      chevron(pos, aim.current, s.phase === 'aim' ? '#ff4fd8' : '#ffffff', 1);
      c.globalAlpha = 0.85; drawBall(c, MAIN, pos, -8, colorOf(me)); c.globalAlpha = 1;
      c.font = '16px VT323, monospace';
      // the hook meter, low on the left (clear of the ball): the needle swinging while it is live, then left where it was stopped
      const hx = 24, hy = H - 32, hw = 240;
      c.fillStyle = 'rgba(0,0,0,0.65)'; c.fillRect(hx - 6, hy - 24, hw + 12, 46);
      const hg = c.createLinearGradient(hx, 0, hx + hw, 0); hg.addColorStop(0, '#ff4fd8'); hg.addColorStop(0.5, '#1a1830'); hg.addColorStop(1, '#4fe0ff');
      c.fillStyle = hg; c.fillRect(hx, hy, hw, 14);
      c.fillStyle = 'rgba(255,255,255,0.35)'; c.fillRect(hx + hw / 2 - 1, hy - 2, 2, 18);
      if (s.phase !== 'aim') { const nx = hx + hw / 2 - (hook * hw) / 2; c.fillStyle = s.phase === 'hook' ? '#ffffff' : '#c8ff4f'; c.fillRect(nx - 2, hy - 6, 4, 26); }
      c.fillStyle = '#fff'; c.textAlign = 'left'; c.fillText('◀ HOOK', hx, hy - 8); c.textAlign = 'right'; c.fillText('HOOK ▶', hx + hw, hy - 8);
      // the power meter, up the right
      c.fillStyle = 'rgba(0,0,0,0.55)'; c.fillRect(W - 46, H - 250, 26, 220);
      const grad = c.createLinearGradient(0, H - 30, 0, H - 250); grad.addColorStop(0, '#4fe0ff'); grad.addColorStop(0.7, '#c8ff4f'); grad.addColorStop(1, '#ff4fd8');
      c.fillStyle = grad; c.fillRect(W - 43, H - 30 - 214 * power, 20, 214 * power);
      c.strokeStyle = '#fff'; c.strokeRect(W - 46, H - 250, 26, 220);
      c.fillStyle = '#fff'; c.textAlign = 'center'; c.fillText('POWER', W - 33, H - 256);
      // what the next press does, top left
      const tip = s.phase === 'aim' ? '◀ ▶ move the ball · SPACE: set your line' : s.phase === 'hook' ? 'SPACE: stop the hook' : 'SPACE: stop the power';
      c.font = '18px VT323, monospace'; c.textAlign = 'left';
      c.fillStyle = 'rgba(0,0,0,0.6)'; c.fillRect(10, 10, c.measureText(tip).width + 16, 24);
      c.fillStyle = '#fff'; c.fillText(tip, 18, 27);
    }
    if (pc) { pc.fillStyle = '#000'; drawScene(pc, PIN_CAM, PC_W, PC_H, sc); pc.strokeStyle = '#4fe0ff'; pc.lineWidth = 2; pc.strokeRect(1, 1, PC_W - 2, PC_H - 2); }
  }, [b, me, roll, pos, myTurn]);

  const toCanvas = (e: ReactPointerEvent<HTMLCanvasElement>) => { const r = pageRect(e.currentTarget); return { x: ((e.clientX - r.left) * W) / r.width, y: ((e.clientY - r.top) * H) / r.height }; };
  const foulY = project(MAIN, 0, 0, 0).y;
  /** A point on the canvas, as a position across the lane at depth y. */
  const across = (sx: number, y: number) => ((sx - MAIN.cx) * (y - MAIN.y)) / MAIN.F;
  const down = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!myTurn) return;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* (a pointer the page cannot hold: it still works inside) */ }
    const p = toCanvas(e);
    if (step.current.phase === 'aim' && p.y > foulY - 4) { drag.current = 'stand'; setPos(Math.max(-LANE_HALF + BALL_R, Math.min(LANE_HALF - BALL_R, across(p.x, -8)))); }
    else press();
  };
  const move = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const p = toCanvas(e);
    if (drag.current === 'stand') setPos(Math.max(-LANE_HALF + BALL_R, Math.min(LANE_HALF - BALL_R, across(p.x, -8))));
    else if (myTurn && step.current.phase === 'aim' && p.y < foulY) aim.current = Math.max(-LANE_HALF - 4, Math.min(LANE_HALF + 4, across(p.x, PIN_Y)));
  };
  const up = () => { drag.current = ''; };

  const joined = at >= 0;
  const say = !b || !b.players.length ? 'Join, then start a game: ten frames, one to four bowlers.'
    : b.over ? `${b.last} Game over: ${(() => { const tot = b.players.map((_, k) => scores(b.rolls[k]).at(-1) ?? 0); const best = Math.max(...tot); return `${b.players.filter((_, k) => tot[k] === best).map(nameOf).join(' and ')} with ${best}.`; })()}`
      : !b.on ? `${b.players.map(nameOf).join(', ')} ${b.players.length > 1 ? 'are' : 'is'} in. Start when everyone is.`
        : `${roll ? '' : b.last ? `${b.last} ` : ''}${roll ? `${nameOf(roll.who)} bowls…` : myTurn ? 'Your ball: ← → (or drag on the approach) to move, point down the lane to aim, then Space (or click the lane) three times: set your line, stop the hook, stop the power.' : `${nameOf(b.players[b.turn])} is up.`}`;
  return (
    <div className="gr-overlay" onMouseDown={(e) => { downOn.current = e.target === e.currentTarget; }} onClick={(e) => { if (downOn.current && e.target === e.currentTarget) close(); }}>
      <div className="gr-box" onClick={(e) => e.stopPropagation()}>
        <header className="gr-tabs">
          <b className="mg-title">{b?.on ? `Frame ${Math.min(10, b.frame + 1)}${b.frame === 9 ? `, ball ${b.ball + 1}` : b.ball ? ', second ball' : ''}` : 'Bowling'}</b>
          <span />
          {!joined && (!b?.on || b.over) && (b?.players.length ?? 0) < 4 && <button onClick={() => send({ t: 'fit', id: ID, op: 'join' })}>Join</button>}
          {joined && (!b!.on || b!.over) && <button onClick={() => send({ t: 'fit', id: ID, op: 'start' })}>{b!.over ? 'New game' : 'Start'}</button>}
          {joined && <button onClick={() => { send({ t: 'fit', id: ID, op: 'leave' }); close(); }}>Leave</button>}
          <button onClick={close} title="Back to the room (Esc)">Close</button>
        </header>
        <div className="gr-fill"><div className="bw-stage" style={{ '--ar': W / H } as CSSProperties}>
          <canvas ref={ref} className={`gr-table${myTurn ? ' mine' : ''}`} width={W} height={H} onPointerDown={down} onPointerMove={move} onPointerUp={up} />
          <canvas ref={pinRef} className="bw-pincam" width={PC_W} height={PC_H} />
        </div></div>
        <p className="gr-say">{say}</p>
        {b && b.players.length > 0 && (
          <table className="bw-sheet">
            <tbody>
              {b.players.map((id, k) => {
                const m = marks(b.rolls[k] ?? []), s = scores(b.rolls[k] ?? []);
                return (
                  <tr key={id} className={b.on && b.turn === k ? 'turn' : ''}>
                    <td className="who"><i className="mg-dot" style={{ background: colorOf(id) }} />{nameOf(id)}</td>
                    {m.map((fm, f) => (
                      <td key={f} className={`fr${f === 9 ? ' ten' : ''}${b.on && b.frame === f && b.turn === k ? ' now' : ''}`}>
                        <div className="marks">{(f === 9 ? [0, 1, 2] : [0, 1]).map((i) => <span key={i}>{fm[i] ?? ''}</span>)}</div>
                        <div className="tot">{s[f] ?? ''}</div>
                      </td>
                    ))}
                    <td className="sum">{[...s].reverse().find((v) => v !== null) ?? 0}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export const says = () => 'Sit and watch the lane';
