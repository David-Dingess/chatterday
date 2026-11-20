// The lake, down the path behind the campsite's telescope (scripts/basement/lake.py draws it; server/basement/lake.ts keeps
// the lines in the water and every catch; ./lake.ts has the numbers both use).
//
// Fishing from the dock. Click one of its six spots to stand there with a rod. To cast: press and hold on the water where
// you want it to go; a meter over you rises and falls, and letting go casts. Let go at the very top (a perfect cast) and
// it lands right there, and rarer things bite; anything less falls short of it. The bobber sits and bobs, a nibble now
// and then; when it goes right under ("!"), click or press Space to set the hook. Then the reel-in, beside you: a fish
// darts up and down a track, and a green bar has to be kept on it. Hold Space (or the mouse button) and the bar rises;
// let go and it falls. While the fish is in the bar the catch meter fills; out of it, the meter drains. Full, it is
// landed (never out of the bar: a perfect catch); empty, it got away and swims off: cast again. The bar has its own
// weight and bounce, each fish its own way of moving, and the meter fills and drains at set rates, per 60th of a second
// (the numbers: server/basement/lake.ts). What comes up shows on a catch card (keep it, or let
// it go: the lake remembers, and the next one may be better), and everybody sees it held up over you. The record board
// by the bait shop has the biggest of each kind, everybody's bests and your own log.
//
// Out here it gets dark when it does outdoors (by the house's clock), with holes in the night round the lamps; it rains when it
// rains in the house's town (rings on the water); and the season's leaves and petals blow across (client/src/season.tsx).
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { marksOf } from '../sprites';
import { hooks, send, soundGain, useStore } from '../store';
import { houseFormat } from '../clock';
import { SeasonAir, useOutdoorWeather } from '../season';
import { OutdoorDecor } from '../holidays/outdoor';
import { daylight } from './outside.tsx';
import { LAYOUT as CAMP } from './outside.gen';
import { LAYOUT } from './lake.gen';
import { CELL_H, CELL_W, FISH, JUNK, KIND, KINDS, PERFECT, RARITY_COLOR, RARITY_WORD, SPOTS, inWater, inches, spotFace, weighs } from './lake';
import type { Catch, Lake, Line, Motion } from './lake';
import type { FitLayout, FitProps } from './index';
import { drawn } from './index';
import { out as busOut, hush } from './sound';
import './lake.css';
import { pageRect } from '../device';

const ID = 'lake';
const SPOT = new Set<number>(SPOTS);
const T = LAYOUT.things as Record<string, any>;
const [FW, FH] = (CAMP.things.sheets as Record<string, number[]>).fire;

type Fight = { diff: number; motion: Motion; bar: number; seed: number };
type Card = { c: Catch; best: boolean; pb: boolean; first: boolean; perfect: boolean };
const useLocal = create<{ card: Card | null; board: boolean; tab: 'records' | 'mine'; log: Catch[] | null }>()(() => ({ card: null, board: false, tab: 'records', log: null }));

/** How far my clock is ahead of the server's. */
let skew = 0;
const now = () => Date.now() - skew;

// ── the reel-in: played here, on my own screen, from what the server says the fish is like ──
// In the game's own units, stepped 60 times a second: the fish moves over 0..FTRACK, the bar over 0..TRACK.
const TRACK = 568, FTRACK = 548, FISH_MAX = 532, STEP_MS = 1000 / 60;
const reel = {
  on: false, f: null as Fight | null, hold: false, rng: () => 0.5, timer: 0, last: 0, acc: 0, sent: 0, clickAt: 0,
  BAR: 200, bar: 368, barV: 0, fish: 508, fishV: 0, target: -1, drift: 0, p: 0.3, in: false, everIn: false, perfect: true,
};
function mulberry(a: number) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function startReel(f: Fight) {
  window.clearTimeout(reel.timer);
  Object.assign(reel, { on: true, f, rng: mulberry(f.seed), last: performance.now(), acc: 0, sent: 0, BAR: f.bar, bar: TRACK - f.bar, barV: 0, fish: 508, fishV: 0, target: -1, drift: 0, p: 0.3, in: false, everIn: false, perfect: true });
  loopReel();
}
function stopReel() { reel.on = false; reel.hold = false; window.clearTimeout(reel.timer); }
/** A whole number from a to b, both in. */
const between = (a: number, b: number) => a + Math.floor(reel.rng() * (b - a + 1));
/** One 60th of a second of the reel-in. */
function stepReel() {
  const { diff, motion } = reel.f!, r = reel.rng, BAR = reel.BAR;
  // the fish: now and then it picks somewhere new to go (more often, and further, the harder it is)
  if (r() < (diff * (motion === 'smooth' ? 20 : 1)) / 4000 && (motion !== 'smooth' || reel.target === -1)) {
    const above = reel.fish, below = FTRACK - reel.fish, pct = Math.min(99, diff + between(10, 44)) / 100;
    reel.target = reel.fish + (-above + r() * (above + below)) * pct;
    if (Math.abs(reel.target - reel.fish) > 180) surgeSound();
  }
  if (motion === 'floater') reel.drift = Math.max(-1.5, reel.drift - 0.01);
  else if (motion === 'sinker') reel.drift = Math.min(1.5, reel.drift + 0.01);
  if (reel.target !== -1 && Math.abs(reel.fish - reel.target) > 3) {
    const acc = (reel.target - reel.fish) / (between(10, 29) + (100 - Math.min(100, diff)));
    reel.fishV += (acc - reel.fishV) / 5;
  } else if (motion !== 'smooth' && r() < diff / 2000) reel.target = reel.fish + (r() < 0.5 ? between(-100, -51) : between(50, 100));
  else reel.target = -1;
  if (motion === 'dart' && r() < diff / 1000) reel.target = reel.fish + (r() < 0.5 ? between(-100 - diff * 2, -51) : between(50, 100 + diff * 2));
  reel.target = Math.max(-1, Math.min(FTRACK, reel.target));
  reel.fish = Math.max(0, Math.min(FISH_MAX, reel.fish + reel.fishV + reel.drift));
  // is it in the bar? (the fish's picture covers fish+16 to fish+44 of the bar's track)
  reel.in = (reel.fish + 44 <= reel.bar + BAR && reel.fish + 16 >= reel.bar) || (reel.fish >= FTRACK - BAR && reel.bar >= TRACK - BAR - 4);
  // the bar: held, it rises; let go, it falls (both gentler with the fish in it); it bounces off the ends
  const g = (reel.hold ? -0.25 : 0.25) * (reel.in ? 0.6 : 1);
  reel.barV += g;
  reel.bar += reel.barV;
  if (reel.bar + BAR > TRACK) { reel.bar = TRACK - BAR; reel.barV = reel.hold ? 0 : -reel.barV * (2 / 3); }
  else if (reel.bar < 0) { reel.bar = 0; reel.barV = reel.hold ? 0 : -reel.barV * (2 / 3); }
  // the catch meter
  reel.p = Math.max(0, Math.min(1, reel.p + (reel.in ? 0.002 : -0.003)));
  if (reel.in) reel.everIn = true;
  else if (reel.everIn) reel.perfect = false;
}
function loopReel() {
  if (!reel.on || !reel.f) return;
  const t = performance.now();
  reel.acc += Math.min(250, t - reel.last);
  reel.last = t;
  for (let n = 0; reel.acc >= STEP_MS && n < 20; n++) {
    reel.acc -= STEP_MS;
    stepReel();
    if (reel.p >= 1) { const perfect = reel.perfect; stopReel(); send({ t: 'fit', id: ID, op: 'land', perfect }); return; }
    if (reel.p <= 0) { stopReel(); send({ t: 'fit', id: ID, op: 'lost', why: 'away' }); return; }
  }
  // (everybody else sees how it is going: the fish on its way in, the rod bent harder while it is out of the bar)
  if (t - reel.sent > 250) { reel.sent = t; send({ t: 'fit', id: ID, op: 'reel', p: Math.round(reel.p * 100) / 100, tn: reel.in ? 0.5 : 1 }); }
  if (reel.hold && t - reel.clickAt > 90) { reel.clickAt = t; clickSound(); }
  reel.timer = window.setTimeout(loopReel, 15);
}

let listening = false;
function listen() {
  if (listening) return;
  listening = true;
  hooks.fit.push((d) => {
    if (d.id !== ID) return;
    if (d.state?.now) skew = Date.now() - d.state.now;
    if (d.op === 'fight') startReel({ diff: Number(d.diff) || 30, motion: (d.motion as Motion) || 'mixed', bar: Math.max(96, Math.min(240, Number(d.bar) || 200)), seed: Number(d.seed) || 1 });
    if (d.op === 'card') { useLocal.setState({ card: { c: d.c as Catch, best: !!d.best, pb: !!d.pb, first: !!d.first, perfect: !!d.perfect } }); splashSound(1); }
    if (d.op === 'log') useLocal.setState({ log: d.rows as Catch[] });
  });
}

// ── sounds: the plop of a bobber landing, the reel's clicks, a fish's run, a splash as it comes out ──
let actx: AudioContext | null = null, noiseBuf: AudioBuffer | null = null;
function audio() {
  const s = useStore.getState();
  const vol = s.voice.deafened ? 0 : soundGain(s.prefs.soundVol) * 0.45;
  if (!vol || document.hidden || (s.me ? s.presence[s.me.id]?.floor : '') !== ID) return null;
  try {
    actx ??= new AudioContext();
    void actx.resume().catch(() => {});
    if (!noiseBuf) { noiseBuf = actx.createBuffer(1, actx.sampleRate, actx.sampleRate); const ch = noiseBuf.getChannelData(0); for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1; }
  } catch { return null; }
  return { a: actx, vol };
}
function burst(at: number, dur: number, type: BiquadFilterType, freq: number, gain: number) {
  const a = actx!, src = a.createBufferSource(), fl = a.createBiquadFilter(), gn = a.createGain();
  src.buffer = noiseBuf; fl.type = type; fl.frequency.value = freq;
  gn.gain.setValueAtTime(Math.max(0.0001, gain), at); gn.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  src.connect(fl).connect(gn).connect(busOut(a, ID)); src.start(at, Math.random() * 0.5); src.stop(at + dur + 0.02);
}
function plopSound(k = 1) {
  const s = audio(); if (!s) return;
  const { a, vol } = s, t = a.currentTime;
  const o = a.createOscillator(), gn = a.createGain();
  o.frequency.setValueAtTime(520, t); o.frequency.exponentialRampToValueAtTime(140, t + 0.09);
  gn.gain.setValueAtTime(vol * 0.5 * k, t); gn.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
  o.connect(gn).connect(busOut(a, ID)); o.start(t); o.stop(t + 0.14);
  burst(t, 0.12, 'bandpass', 1600, vol * 0.25 * k);
}
function splashSound(k = 1) { const s = audio(); if (!s) return; burst(s.a.currentTime, 0.35, 'bandpass', 1100, s.vol * 0.6 * k); burst(s.a.currentTime + 0.05, 0.25, 'highpass', 2600, s.vol * 0.25 * k); }
function clickSound() { const s = audio(); if (!s) return; burst(s.a.currentTime, 0.015, 'highpass', 4200, s.vol * 0.18); }
function surgeSound() { const s = audio(); if (!s) return; burst(s.a.currentTime, 0.3, 'bandpass', 700, s.vol * 0.3); }

// ── where things are on somebody ──
type Pt = { x: number; y: number };
/** Where the hand holding the rod is, on somebody stood at (x, y) facing f (-1 left, 1 right), from the frames of their
 *  'reach' row (the arm held out in frames 2 and 3, raised in frame 1): their face's height says how tall they are. */
function hand(x: number, y: number, f: number, faceY: number, up = false): Pt {
  const fx = up ? 7 : 13, fy = up ? 12 : 26;
  return { x: x - 24 + (f < 0 ? fx : 47 - fx) + 0.5, y: y - 45 + faceY + fy + 0.5 };
}
/** The rod, from the hand: how it is held (a = its angle up from level, toward the water; more than 90 points back over
 *  the shoulder), and where its butt and tip are. */
function rodAt(h: Pt, f: number, a: number, len = 28) {
  const dx = Math.cos(a) * f, dy = -Math.sin(a);
  return { butt: { x: h.x - dx * 5, y: h.y - dy * 5 }, tip: { x: h.x + dx * len, y: h.y + dy * len } };
}

const fmt = (n: number) => n.toFixed(1);
const dayOf = (t: number) => houseFormat('lakeday', { month: 'short', day: 'numeric' }).format(new Date(t));

/** The rod, the line and the bobber (or what is on the end of it), for one person at one spot. */
function Rig({ uid, line, q, n, light, faceY, charging }: { uid: string; line: Line | undefined; q: FitLayout['seats'][number]; n: number; light: number; faceY: number; charging: boolean }) {
  const f = spotFace(n), t = now();
  const d = drawn.get(uid);
  const x = d ? d.x : q.x, y = d ? d.y : q.y;
  const winding = charging || (line?.phase === 'cast' && t - line.t0 < 260);
  const h = hand(x, y, f, faceY, winding);
  const tn = line?.tn ?? 0.3;
  const angle = winding ? 2.0 : !line ? 1.05 : line.phase === 'reel' ? 0.45 + 0.25 * Math.min(1, tn) : 0.55;
  const { butt, tip } = rodAt(h, f, angle);
  // where the end of the line is: in the air, floating, under, or the fish on its way in
  let end: Pt | null = null, bob: 'air' | 'float' | 'bite' | 'fish' | null = null, sag = 6;
  if (line) {
    if (line.phase === 'cast') {
      const k = Math.max(0, Math.min(1, (t - line.t0 - 200) / Math.max(1, line.ms - 200)));
      end = k <= 0 ? { ...tip } : { x: tip.x + (line.x - tip.x) * k, y: tip.y + (line.y - tip.y) * k - Math.sin(Math.PI * k) * 26 };
      bob = 'air'; sag = 0;
    } else if (line.phase === 'reel') {
      const p = line.p ?? 0, from = { x: line.x, y: line.y }, to = { x: q.x + f * 12, y: q.y - 2 };
      const wig = line.dead ? 0 : Math.sin(t / 170 + n) * 7 * (1 - p);
      const dx = to.x - from.x, dy = to.y - from.y, ln = Math.hypot(dx, dy) || 1;
      end = { x: from.x + dx * p + (-dy / ln) * wig, y: from.y + dy * p + (dx / ln) * wig * 0.6 };
      bob = 'fish'; sag = Math.max(0, 3 - tn * 5);
    } else {
      // nibbles: little dips now and then, the same on every screen (from the cast and the second)
      const sec = Math.floor((t - line.t0) / 700), nib = line.phase === 'wait' && ((sec * 2654435761 + line.t0) >>> 0) % 7 === 0 && (t - line.t0) % 700 < 260;
      end = { x: line.x, y: line.y + (line.phase === 'bite' ? 2 + Math.sin(t / 60) * 1.2 : nib ? 1.2 : Math.sin(t / 600 + n) * 0.5) };
      bob = line.phase === 'bite' ? 'bite' : 'float';
    }
  }
  const bend = line?.phase === 'reel' && end ? Math.min(1, tn) * 7 : 0;
  // the rod's curve: bent toward the line while a fish pulls
  const mid = { x: (h.x + tip.x) / 2, y: (h.y + tip.y) / 2 };
  let ctrl = mid;
  if (bend && end) { const ex = end.x - mid.x, ey = end.y - mid.y, el = Math.hypot(ex, ey) || 1; ctrl = { x: mid.x + (ex / el) * bend, y: mid.y + (ey / el) * bend }; }
  const tipB = bend && end ? { x: tip.x + (end.x - tip.x) / (Math.hypot(end.x - tip.x, end.y - tip.y) || 1) * bend * 0.8, y: tip.y + (end.y - tip.y) / (Math.hypot(end.x - tip.x, end.y - tip.y) || 1) * bend * 0.8 } : tip;
  const lineColour = light < 0.4 ? '#c8d0e0' : '#eef2f6';
  const p = (v: Pt) => `${v.x.toFixed(2)},${v.y.toFixed(2)}`;
  return (
    <>
      <svg className="lk-svg" viewBox={`0 0 ${LAYOUT.w} ${LAYOUT.h}`} style={{ width: LAYOUT.w, height: LAYOUT.h, zIndex: Math.round(y) + 1 }}>
        {/* the line, from the tip to the bobber (slack, it sags; taut, it is straight) */}
        {end && <path d={`M${p(tipB)} Q${p({ x: (tipB.x + end.x) / 2, y: Math.max(tipB.y, end.y) + sag })} ${p(end)}`} fill="none" stroke={lineColour} strokeWidth={0.45} opacity={0.85} />}
        {/* the rod: plain wood, brown, with the grain in it (lighter streaks and darker knots along it), a cord-wrapped
            grip and a little wooden reel */}
        <path d={`M${p(butt)} L${p(h)} Q${p(ctrl)} ${p(tipB)}`} fill="none" stroke="#24160c" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
        <path d={`M${p(h)} Q${p(ctrl)} ${p(tipB)}`} fill="none" stroke="#7a4e2a" strokeWidth={0.9} strokeLinecap="round" />
        <path d={`M${p(h)} Q${p(ctrl)} ${p(tipB)}`} fill="none" stroke="#a8784a" strokeWidth={0.32} strokeDasharray="1.4 1.1 0.5 2.2" />
        <path d={`M${p(h)} Q${p(ctrl)} ${p(tipB)}`} fill="none" stroke="#4e3018" strokeWidth={0.4} strokeDasharray="0.45 3.1" strokeDashoffset={1.7} />
        <line x1={butt.x} y1={butt.y} x2={h.x} y2={h.y} stroke="#5a3a20" strokeWidth={1.6} strokeLinecap="round" />
        <line x1={butt.x} y1={butt.y} x2={h.x} y2={h.y} stroke="#3a2414" strokeWidth={1.6} strokeDasharray="0.5 0.6" />
        <circle cx={h.x + (f > 0 ? -0.8 : 0.8)} cy={h.y + 1.8} r={1.25} fill="#6a4426" stroke="#24160c" strokeWidth={0.4} />
        <circle cx={h.x + (f > 0 ? -0.8 : 0.8)} cy={h.y + 1.8} r={0.4} fill="#3a2414" />
      </svg>
      {end && bob && <Bobber at={end} kind={bob} z={bob === 'air' ? Math.round(y) + 2 : 3} t={t} tn={tn} dead={!!line?.dead} />}
      {line?.phase === 'bite' && <svg className="lk-svg" viewBox={`0 0 ${LAYOUT.w} ${LAYOUT.h}`} style={{ width: LAYOUT.w, height: LAYOUT.h, zIndex: 3600 }}>
        {/* "!" over the angler: a bite */}
        <rect x={x - 1.5} y={y - 66} width={3} height={8} fill="#ffe14a" stroke="#1a1228" strokeWidth={0.6} />
        <rect x={x - 1.5} y={y - 56} width={3} height={3} fill="#ffe14a" stroke="#1a1228" strokeWidth={0.6} />
      </svg>}
    </>
  );
}

/** A red and white bobber (in the air, floating, pulled under), or the fish on its way in (a dark shape and a wake of
 *  splashes; junk just comes, a ripple behind it). */
function Bobber({ at, kind, z, t, tn, dead }: { at: Pt; kind: 'air' | 'float' | 'bite' | 'fish'; z: number; t: number; tn: number; dead: boolean }) {
  const { x, y } = at;
  if (kind === 'fish') {
    const k = (t / 110) % 4 | 0;
    return (
      <svg className="lk-svg" viewBox={`0 0 ${LAYOUT.w} ${LAYOUT.h}`} style={{ width: LAYOUT.w, height: LAYOUT.h, zIndex: z }}>
        <ellipse cx={x} cy={y + 1} rx={6} ry={2.2} fill="#0a1a2a" opacity={0.75} />
        {!dead && <path d={`M${x - 6},${y + 1} l-3,-2 l0,4 Z`} fill="#0a1a2a" opacity={0.75} />}
        {[0, 1, 2].map((j) => <ellipse key={j} cx={x} cy={y + 1} rx={4 + ((t / 90 + j * 5) % 14)} ry={(4 + ((t / 90 + j * 5) % 14)) * 0.36} fill="none" stroke="#d8eef4" strokeWidth={0.5} opacity={0.6 * (1 - ((t / 90 + j * 5) % 14) / 14)} />)}
        {!dead && tn > 0.5 && [[-3, -3], [2, -4], [4, -2], [-4, -1]].map(([dx, dy], j) => (j + k) % 2 ? <rect key={j} x={x + dx} y={y + dy - ((k + j) % 3)} width={1} height={1} fill="#f2fbff" /> : null)}
      </svg>
    );
  }
  const under = kind === 'bite';
  return (
    <svg className="lk-svg" viewBox={`0 0 ${LAYOUT.w} ${LAYOUT.h}`} style={{ width: LAYOUT.w, height: LAYOUT.h, zIndex: z }}>
      {kind !== 'air' && <ellipse cx={x} cy={y + 1.2} rx={under ? 5 + (t / 40) % 6 : 3.4 + Math.sin(t / 500) * 0.4} ry={under ? 1.8 + ((t / 40) % 6) * 0.3 : 1.2} fill="none" stroke="#e0f2f6" strokeWidth={0.55} opacity={under ? 0.9 : 0.55} />}
      {under && [[-4, -2], [3, -3], [5, -1]].map(([dx, dy], j) => <rect key={j} x={x + dx} y={y + dy - ((t / 80 + j) % 2)} width={1} height={1} fill="#f2fbff" />)}
      <g transform={`translate(${x - 2.5},${y - (under ? 2 : 6)})`}>
        {!under && <rect x={2} y={-2} width={1} height={2.5} fill="#1a1228" />}
        {!under && <path d="M0.5,3 Q0.5,0.5 2.5,0.5 Q4.5,0.5 4.5,3 Z" fill="#f4f2ec" stroke="#1a1228" strokeWidth={0.5} />}
        <path d="M0.5,3 L4.5,3 Q4.5,6 2.5,6.4 Q0.5,6 0.5,3 Z" fill="#e8402a" stroke="#1a1228" strokeWidth={0.5} />
        <rect x={1.1} y={3.4} width={0.8} height={1.2} fill="#ff8a6a" />
      </g>
    </svg>
  );
}

/** A picture of a catch, from catch.png, k dots a dot. */
export function CatchPic({ kind, k = 1, style }: { kind: string; k?: number; style?: CSSProperties }) {
  const c = KIND[kind]?.cell ?? 0;
  return <i className="lk-pic" style={{ width: CELL_W * k, height: CELL_H * k, backgroundPosition: `${-c * CELL_W * k}px 0`, backgroundSize: `${CELL_W * KINDS.length * k}px ${CELL_H * k}px`, ...style }} />;
}

const DUSK_OVER = 3;
const box = (r: number[]): CSSProperties => ({ left: r[0], top: r[1], width: r[2], height: r[3] });

export function Room({ layout, mini, seated }: FitProps) {
  listen();
  const st = useStore((s) => s.fits[ID]) as Lake | undefined;
  const me = useStore((s) => s.me);
  const mine = useStore((s) => (s.me ? s.presence[s.me.id] : undefined));
  const presence = useStore((s) => s.presence);
  const users = useStore((s) => s.users);
  const wx = useOutdoorWeather();
  const card = useLocal((s) => s.card);
  const boardOpen = useLocal((s) => s.board);
  const [, tick] = useState(0);
  const [light, setLight] = useState(() => daylight(new Date()));
  // a cast being charged (mine): where I pressed, and when; the meter goes up and down from then
  const [charge, setCharge] = useState<{ tx: number; ty: number; t0: number } | null>(null);
  const busy = (!!st && Object.keys(st.lines).length > 0) || !!charge;
  useEffect(() => {
    const t = window.setInterval(() => tick((n) => n + 1), busy ? 40 : 250);
    return () => window.clearInterval(t);
  }, [busy]);
  useEffect(() => { const l = window.setInterval(() => setLight(daylight(new Date())), 30_000); return () => window.clearInterval(l); }, []);
  const wet = wx?.kind === 'rain' || wx?.kind === 'storm';
  const dusk = Math.min(0.82, (1 - light) * 0.66 + (wet ? 0.1 : 0) + Math.max(0, (wx?.cover ?? 0.4) - 0.5) * 0.15 * light);
  useEffect(() => {
    const c = [13, 26, 18].map((v, i) => Math.round(v + ([6, 10, 34][i] - v) * dusk));
    document.documentElement.style.setProperty('--lake-bg', `rgb(${c.join(',')})`);
    return () => { document.documentElement.style.removeProperty('--lake-bg'); };
  }, [dusk]);

  // where I am: at one of the spots (arrived), or not
  const mySpot = !mini && mine?.floor === ID && mine.place === 'here' ? Number(/^b(\d+)$/.exec(mine.at?.seat ?? '')?.[1] ?? -1) : -1;
  const atSpot = SPOT.has(mySpot) && !!seated[mySpot];
  const myLine = me ? st?.lines[me.id] : undefined;
  // walked off with a line out: it is wound in
  useEffect(() => {
    if (myLine && myLine.spot !== mySpot) { send({ t: 'fit', id: ID, op: 'reelin' }); stopReel(); }
  }, [myLine?.spot, mySpot]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (myLine?.phase !== 'reel' && reel.on) stopReel(); }, [myLine?.phase]);
  // a bobber landing, anybody's: a plop
  const landed = useRef(new Set<string>());
  useEffect(() => {
    if (!st) return;
    for (const [uid, l] of Object.entries(st.lines)) {
      const key = `${uid}:${l.t0}`;
      if (l.phase !== 'cast' && !landed.current.has(key)) { landed.current.add(key); if (now() - l.t0 < l.ms + 1500) plopSound(uid === me?.id ? 1 : 0.5); }
    }
  });
  // a catch, anybody's: a splash
  const popped = useRef(new Set<string>());
  useEffect(() => {
    if (!st) return;
    for (const [uid, p] of Object.entries(st.pops)) {
      const key = `${uid}:${p.at}`;
      if (!popped.current.has(key)) { popped.current.add(key); if (now() - p.at < 1500 && (p.what === 'catch' || p.what === 'released') && uid !== me?.id) splashSound(0.5); }
    }
  });
  // Space: set the hook on a bite, and hold to reel (not while typing somewhere)
  useEffect(() => {
    if (!atSpot) return;
    const typing = (e: KeyboardEvent) => { const el = e.target as HTMLElement | null; return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable); };
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || typing(e)) return;
      const l = useStore.getState().me ? (useStore.getState().fits[ID] as Lake | undefined)?.lines[useStore.getState().me!.id] : undefined;
      if (!l) return;
      e.preventDefault();
      if (l.phase === 'bite' && !e.repeat) { send({ t: 'fit', id: ID, op: 'hook' }); reel.hold = true; }
      else if (l.phase === 'reel') reel.hold = true;
    };
    const up = (e: KeyboardEvent) => { if (e.code === 'Space') reel.hold = false; };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, [atSpot]);

  // the cast: pressing on the water and holding
  if (!st) return null;
  const t = now(), night = 1 - light;
  const name = (id: string) => users[id]?.name ?? 'Somebody';
  const f = atSpot ? spotFace(mySpot) : -1;
  const myQ = atSpot ? layout.seats[mySpot] : null;
  const at = (e: ReactPointerEvent<HTMLElement>, r: number[]) => { const b = pageRect(e.currentTarget); return { x: r[0] + ((e.clientX - b.left) * r[2]) / b.width, y: r[1] + ((e.clientY - b.top) * r[3]) / b.height }; };
  // the area that takes a cast: the water on the side I face, from just off the dock
  const castArea = myQ ? (f < 0 ? [0, 0, Math.max(10, myQ.x - 12), 262] : [myQ.x + 12, 0, layout.w - myQ.x - 12, 262]) : null;
  const canCast = atSpot && !myLine && !card;
  const onDown = (e: ReactPointerEvent<HTMLElement>, r: number[]) => {
    e.stopPropagation();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* (still works inside) */ }
    const l = myLine;
    if (l?.phase === 'bite') { send({ t: 'fit', id: ID, op: 'hook' }); reel.hold = true; return; }
    if (l?.phase === 'reel') { reel.hold = true; return; }
    if (!canCast) return;
    const p = at(e, r);
    if (!inWater(p.x, p.y)) return;
    setCharge({ tx: p.x, ty: p.y, t0: performance.now() });
  };
  const onUp = () => {
    reel.hold = false;
    const c = charge;
    if (!c) return;
    setCharge(null);
    if (!canCast) return;
    send({ t: 'fit', id: ID, op: 'cast', spot: mySpot, tx: Math.round(c.tx), ty: Math.round(c.ty), power: Math.round(meter(c.t0) * 1000) / 1000, light: Math.round(light * 100) / 100, wx: wx?.kind ?? 'clear' });
  };
  const capture = (r: number[], z: number, cls = '') => (
    <i className={`lk-cap${cls}`} style={{ ...box(r), zIndex: z }} onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => onDown(e, r)} onPointerUp={onUp} onPointerCancel={onUp} />
  );

  // who is stood at a spot just now (arrived there), with a rod
  const anglers = Object.entries(presence).filter(([id, p]) => p && p.state !== 'offline' && p.floor === ID && p.place === 'here' && users[id])
    .map(([id, p]) => ({ id, n: Number(/^b(\d+)$/.exec(p.at?.seat ?? '')?.[1] ?? -1) })).filter((a) => SPOT.has(a.n) && seated[a.n]);
  const holes = layout.lights.map((l) => `radial-gradient(${l.rx * 1.1}px ${l.ry * 1.1}px at ${l.x + DUSK_OVER}px ${l.y + DUSK_OVER}px, rgba(0,0,0,0.3) 0%, rgba(0,0,0,0.5) 45%, #000 100%)`).join(', ');
  const myD = me ? drawn.get(me.id) : undefined;
  const meX = myD?.x ?? myQ?.x ?? 0, meY = myD?.y ?? myQ?.y ?? 0;

  return (
    <>
      {/* life on the water: glints by day (a moon's path at night), rings in the rain, a fish jumping now and then */}
      <WaterLife t={t} light={light} wet={wet} cover={wx?.cover ?? 0.4} />
      <Wakes />
      {/* the rods, lines and bobbers */}
      {anglers.map(({ id, n }) => <Rig key={id} uid={id} n={n} line={st.lines[id]?.spot === n ? st.lines[id] : undefined} q={layout.seats[n]} light={light} faceY={marksOf(users[id]).faceY} charging={id === me?.id && !!charge} />)}
      {/* what each came up with, held up over them for a moment (or that it got away) */}
      {Object.entries(st.pops).filter(([, p]) => t - p.at < (p.what === 'catch' ? 5000 : 3000)).map(([id, p]) => {
        const dd = drawn.get(id), x = dd?.x, y = dd?.y;
        if (x == null || y == null) return null;
        const word = p.what === 'catch' ? (p.w ? weighs(p.w) : KIND[p.kind ?? '']?.name ?? '') : p.what === 'away' ? 'It got away' : p.what === 'snap' ? 'Snap!' : p.what === 'missed' ? 'Missed it' : p.what === 'released' ? 'Let it go' : 'Kept';
        return (
          <div key={`${id}${p.at}`} className={`lk-pop${p.what === 'catch' ? ' big' : ''}`} style={{ left: x, top: y - (p.what === 'catch' ? 92 : 74), zIndex: 3500 }}>
            {p.what === 'catch' && p.kind && <CatchPic kind={p.kind} />}
            <b style={p.best ? { color: '#ffd04a' } : undefined}>{p.best ? `Record! ${word}` : word}</b>
          </div>
        );
      })}
      {/* a splash where a fish was let go */}
      {Object.entries(st.pops).filter(([, p]) => p.what === 'released' && t - p.at < 1400).map(([id, p]) => {
        const dd = drawn.get(id);
        const a = anglers.find((q) => q.id === id), n = a?.n ?? -1;
        if (!dd || n < 0) return null;
        const sx = dd.x + spotFace(n) * 22, sy = dd.y - 2;
        return <i key={`s${id}${p.at}`} className="lk-splash" style={{ left: sx - 8, top: sy - 10, zIndex: Math.round(sy) }} />;
      })}
      {/* the night, with light let through round the lamps */}
      <i className="cf-dusk" style={{ inset: -DUSK_OVER, opacity: dusk, zIndex: 2980, maskImage: holes, WebkitMaskImage: holes } as CSSProperties} />
      <SeasonAir scene="lake" w={layout.w} h={layout.h} light={light} dusk={dusk} airZ={2981} groundZ={1} />
      {/* the holiday's decorations (client/src/holidays/outdoor.tsx), and a snowman while it snows */}
      <OutdoorDecor scene="lake" seasons={(layout as { seasons?: string[] }).seasons} light={light} w={layout.w} h={layout.h} />
      {night > 0.3 && layout.lights.map((l, j) => <i key={j} className={`cf-glow lamp${l.color === '#ffa850' ? ' torch' : ''}`} style={{ left: l.x - l.rx * 1.2, top: l.y - l.ry * 1.2, width: l.rx * 2.4, height: l.ry * 2.4, zIndex: 2982, opacity: night * 0.6, animationDelay: `${-j * 0.37}s` }} />)}
      {(T.torches as number[][]).map(([x, y], j) => <i key={`t${j}`} className="cf-torch" style={{ left: x - FW / 4, top: y + 1 - FH / 2, width: FW / 2, height: FH / 2, zIndex: 2984, backgroundPositionY: `${-FH}px`, backgroundSize: `${FW * 2}px ${FH * 2}px`, animationDelay: `${-j * 0.13}s`, '--to': `${-FW * 2}px` } as CSSProperties} />)}
      {wet && <i className={`lk-rain${wx?.kind === 'storm' ? ' hard' : ''}`} style={{ zIndex: 2986 }} />}
      {wx?.kind === 'fog' && <i className="lk-fog" style={{ zIndex: 2986 }} />}
      {/* clicks: the record board and the bait shop */}
      {!mini && <i className="cf-hot" title="The record board: the biggest of each, and your catches" style={{ ...box(T.board), zIndex: 2990 }} onClick={(e) => { e.stopPropagation(); useLocal.setState({ board: true }); send({ t: 'fit', id: ID, op: 'log' }); }} />}
      {!mini && <i className="cf-hot" title="The bait shop (the record board is beside it)" style={{ ...box(T.shop), zIndex: 2990 }} onClick={(e) => { e.stopPropagation(); useLocal.setState({ board: true }); send({ t: 'fit', id: ID, op: 'log' }); }} />}
      {/* my cast: press on the water and hold, let go; once it is in, click (or hold) anywhere to hook and reel */}
      {!mini && castArea && canCast && capture(castArea, 2995, ' cast')}
      {!mini && atSpot && (myLine?.phase === 'bite' || myLine?.phase === 'reel') && capture([0, 0, layout.w, layout.h], 3990, ' reel')}
      {/* the cast meter over me, going up and down while I hold (the top of it, a perfect cast) */}
      {charge && myQ && <CastMeter x={f < 0 ? meX + 12 : meX - 22} y={meY - 72} m={meter(charge.t0)} tx={charge.tx} ty={charge.ty} />}
      {/* the reel-in: the track with the fish and my bar on it, and the catch meter beside it */}
      {atSpot && myLine?.phase === 'reel' && reel.on && <Track x={f < 0 ? meX - 46 : meX + 16} y={Math.max(4, meY - 104)} />}
      {card && <CatchCard card={card} />}
      {boardOpen && !mini && createPortal(<RecordBoard st={st} name={name} me={me?.id ?? ''} />, document.querySelector('.main-view') ?? document.body)}
    </>
  );
}

/** How full the cast meter is, held since t0 (performance.now): up in a second, down in a second, again. */
function meter(t0: number) { const u = ((performance.now() - t0) / 1000) % 2; return u <= 1 ? u : 2 - u; }

/** A rectangle of the scene's dots (whole dots: the widgets are drawn as pixel art, crisp). */
const R = ({ x, y, w, h, c, o }: { x: number; y: number; w: number; h: number; c: string; o?: number }) =>
  w > 0 && h > 0 ? <rect x={x} y={y} width={w} height={h} fill={c} opacity={o} /> : null;
/** A wooden frame, w by h: a dark edge, planks lit along the top and left and shaded along the bottom and right, a
 *  little grain, and a nail in each corner. */
function Frame({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  const grain: number[][] = [];
  for (let k = 0; k < (w * h) / 40; k++) { const hx = (k * 7919 + w * 31) % (w - 2), hy = (k * 104729 + h * 17) % (h - 2); grain.push([x + 1 + hx, y + 1 + hy]); }
  return (
    <>
      <R x={x} y={y} w={w} h={h} c="#1a0f07" />
      <R x={x + 1} y={y + 1} w={w - 2} h={h - 2} c="#7a4e2a" />
      {grain.map(([gx, gy], k) => <R key={k} x={gx} y={gy} w={k % 3 ? 2 : 1} h={1} c={k % 2 ? '#6a4224' : '#8a5a32'} />)}
      <R x={x + 1} y={y + 1} w={w - 2} h={1} c="#b07e4a" />
      <R x={x + 1} y={y + 2} w={1} h={h - 3} c="#96643a" />
      <R x={x + 1} y={y + h - 2} w={w - 2} h={1} c="#4e3018" />
      <R x={x + w - 2} y={y + 2} w={1} h={h - 3} c="#5a381c" />
      {[[x + 2, y + 2], [x + w - 3, y + 2], [x + 2, y + h - 3], [x + w - 3, y + h - 3]].map(([nx, ny], k) => <R key={`n${k}`} x={nx} y={ny} w={1} h={1} c="#d8d0bc" />)}
    </>
  );
}
/** A little pixel fish, 9 by 6, head to the left, its tail flicking (frame 0 or 1). */
const FISH_PX = ['..###....', '.#####.#.', '#o#####.#', '########.', '.#####.#.', '..###....'];
const FISH_PX2 = ['..###....', '.#####...', '#o######.', '#######.#', '.#####.#.', '..###...#'];
function PixelFish({ x, y, f }: { x: number; y: number; f: number }) {
  const rows = f ? FISH_PX2 : FISH_PX;
  const out: JSX.Element[] = [];
  rows.forEach((row, ry) => [...row].forEach((ch, rx) => {
    if (ch === '.') return;
    const c = ch === 'o' ? '#1a0f07' : ry <= 1 ? '#ffd27a' : ry >= 4 ? '#c0721a' : rx >= 7 ? '#e08a20' : '#f2a834';
    out.push(<R key={`${rx},${ry}`} x={x + rx} y={y + ry} w={1} h={1} c={c} />);
  }));
  return <>{out}</>;
}

/** The reel-in, in the scene's dots, drawn as pixel art: in a wooden frame, a column of lake water (lighter at the top,
 *  bubbles rising, light moving through it, sand and weed on the bottom), the fish darting about in it and my green bar
 *  (lit along its top, glowing while the fish is in it); beside it the catch meter in its own tube, filling from the
 *  bottom (red, then gold, then green; flashing when it is nearly empty); and the reel on the side, spinning while I hold. */
function Track({ x, y }: { x: number; y: number }) {
  x = Math.round(x); y = Math.round(y);
  const t = performance.now();
  const H = 92, k = H / TRACK, wx = x + 3, wy = y + 3, ww = 12;
  const bands = 12, deep = (i: number) => { const u = i / (bands - 1), a = [0x3f, 0x86, 0xac], b = [0x16, 0x3a, 0x56]; return `rgb(${a.map((v, j) => Math.round(v + (b[j] - v) * u)).join(',')})`; };
  const barY = wy + Math.round(reel.bar * k), barH = Math.max(6, Math.round(reel.BAR * k));
  const fishY = wy + Math.round((reel.fish + 30) * k) - 3;
  const p = reel.p, fillH = Math.round(H * p);
  const low = p < 0.25 && Math.floor(t / 160) % 2 === 0;
  const fill = p < 0.33 ? '#d84a32' : p < 0.66 ? '#e8b830' : '#5ec84a';
  const glow = reel.in ? 0.75 + 0.25 * Math.sin(t / 90) : 0;
  const spin = reel.hold ? t / 70 : t / 400;
  const rx = x + 25, ry = y + H - 6;
  return (
    <svg className="lk-svg" viewBox={`0 0 ${LAYOUT.w} ${LAYOUT.h}`} style={{ width: LAYOUT.w, height: LAYOUT.h, zIndex: 3700 }} shapeRendering="crispEdges">
      <Frame x={x} y={y} w={24} h={H + 6} />
      {/* the water */}
      {Array.from({ length: bands }, (_, i) => <R key={`b${i}`} x={wx} y={wy + Math.floor((i * H) / bands)} w={ww} h={Math.ceil(H / bands) + 1} c={deep(i)} />)}
      <R x={wx} y={wy} w={ww} h={1} c="#0e2232" />
      <R x={wx} y={wy} w={1} h={H} c="#122c40" />
      {[0, 1, 2, 3].map((i) => { const ly = wy + 4 + ((Math.floor(t / 120) + i * 23) % (H - 14)); return <R key={`l${i}`} x={wx + 2 + ((i * 5) % 8)} y={ly} w={3} h={1} c="#7ec0dc" o={0.35} />; })}
      {[0, 1, 2].map((i) => { const by = wy + H - 6 - ((t / (26 + i * 9) + i * 31) % (H - 8)); return <R key={`u${i}`} x={wx + 2 + i * 4 + (Math.floor(by) % 3 === 0 ? 1 : 0)} y={Math.round(by)} w={1} h={1} c="#cdeefa" o={0.85} />; })}
      {/* the bottom: sand, pebbles, two weeds swaying */}
      <R x={wx} y={wy + H - 4} w={ww} h={4} c="#b8975a" />
      <R x={wx} y={wy + H - 4} w={ww} h={1} c="#d8b878" />
      <R x={wx + 3} y={wy + H - 2} w={1} h={1} c="#7a6038" /><R x={wx + 8} y={wy + H - 3} w={2} h={1} c="#8a7044" />
      {[[wx + 1, 7], [wx + 10, 5]].map(([gx, gh], i) => Array.from({ length: gh }, (_, j) => <R key={`w${i}${j}`} x={gx + (Math.floor(t / 500 + j * 0.5 + i) % 2)} y={wy + H - 4 - j} w={1} h={1} c={j % 2 ? '#3e8a3a' : '#2e6e2c'} />))}
      {/* my bar */}
      <R x={wx + 1} y={barY} w={ww - 2} h={barH} c={reel.in ? '#62d04a' : '#46a83a'} o={0.78} />
      <R x={wx + 1} y={barY} w={ww - 2} h={1} c="#c4f8a0" />
      <R x={wx + 1} y={barY + barH - 1} w={ww - 2} h={1} c="#24661c" />
      <R x={wx + 1} y={barY + 1} w={1} h={barH - 2} c="#96ea72" o={0.8} />
      <R x={wx + ww - 2} y={barY + 1} w={1} h={barH - 2} c="#2e7c24" o={0.8} />
      {glow > 0 && <R x={wx + 2} y={barY + 1} w={ww - 4} h={barH - 2} c="#d8ffb0" o={glow * 0.22} />}
      {/* the fish */}
      <PixelFish x={wx + 2} y={fishY} f={Math.floor(t / (reel.in ? 220 : 110)) % 2} />
      {/* the catch meter */}
      <R x={x + 16} y={wy - 1} w={6} h={H + 2} c="#1a0f07" />
      <R x={x + 17} y={wy} w={4} h={H} c="#2a1c14" />
      <R x={x + 17} y={wy + H - fillH} w={4} h={fillH} c={low ? '#ff8a6a' : fill} />
      {fillH > 1 && <R x={x + 17} y={wy + H - fillH} w={1} h={fillH} c="#ffffff" o={0.28} />}
      {fillH > 0 && <R x={x + 17} y={wy + H - fillH} w={4} h={1} c="#ffffff" o={0.45} />}
      {[0.25, 0.5, 0.75].map((m) => <R key={`m${m}`} x={x + 20} y={wy + Math.round(H * (1 - m))} w={1} h={1} c="#000000" o={0.5} />)}
      {/* the reel, on the side */}
      <R x={rx - 1} y={ry - 3} w={3} h={7} c="#1a0f07" />
      <R x={rx - 3} y={ry - 1} w={7} h={3} c="#1a0f07" />
      <R x={rx - 2} y={ry - 2} w={5} h={5} c="#1a0f07" />
      <R x={rx - 1} y={ry - 2} w={3} h={5} c="#8a8c96" />
      <R x={rx - 2} y={ry - 1} w={5} h={3} c="#8a8c96" />
      <R x={rx - 1} y={ry - 1} w={2} h={1} c="#c8cad2" />
      <R x={rx} y={ry} w={1} h={1} c="#3a3c44" />
      <R x={rx + Math.round(Math.cos(spin) * 2)} y={ry + Math.round(Math.sin(spin) * 2)} w={1} h={1} c="#e8d8b0" />
      <R x={x + 23} y={ry} w={2} h={1} c="#1a0f07" />
    </svg>
  );
}

/** The cast meter over me while I hold: a little wooden frame, the strength rising and falling in it, the top of it (a
 *  perfect cast) marked in gold, and a sparkle when the meter is up in it. */
function CastMeter({ x, y, m, tx, ty }: { x: number; y: number; m: number; tx: number; ty: number }) {
  x = Math.round(x); y = Math.round(y);
  const H = 30, top = m >= PERFECT, fh = Math.round(H * m), zone = Math.max(2, Math.round(H * (1 - PERFECT)));
  const t = performance.now();
  return (
    <svg className="lk-svg" viewBox={`0 0 ${LAYOUT.w} ${LAYOUT.h}`} style={{ width: LAYOUT.w, height: LAYOUT.h, zIndex: 3700 }} shapeRendering="crispEdges">
      <Frame x={x} y={y} w={10} h={H + 6} />
      <R x={x + 3} y={y + 3} w={4} h={H} c="#2a1c14" />
      <R x={x + 3} y={y + 3 + H - fh} w={4} h={fh} c={top ? '#7ae04a' : m > 0.6 ? '#e8b830' : '#d86a32'} />
      {fh > 1 && <R x={x + 3} y={y + 3 + H - fh} w={1} h={fh} c="#ffffff" o={0.3} />}
      <R x={x + 2} y={y + 3} w={1} h={zone} c="#ffd84a" />
      <R x={x + 7} y={y + 3} w={1} h={zone} c="#ffd84a" />
      {top && [[-2, 1], [11, 2], [4, -2]].map(([dx, dy], k) => (Math.floor(t / 90) + k) % 3 ? <R key={k} x={x + dx} y={y + dy} w={1} h={1} c="#fff6c0" /> : null)}
      {/* where I am aiming: a small ring on the water */}
      <R x={Math.round(tx) - 1} y={Math.round(ty) - 2} w={3} h={1} c="#f6f0d8" o={0.85} />
      <R x={Math.round(tx) - 1} y={Math.round(ty) + 2} w={3} h={1} c="#f6f0d8" o={0.85} />
      <R x={Math.round(tx) - 2} y={Math.round(ty) - 1} w={1} h={3} c="#f6f0d8" o={0.85} />
      <R x={Math.round(tx) + 2} y={Math.round(ty) - 1} w={1} h={3} c="#f6f0d8" o={0.85} />
    </svg>
  );
}

/** Rings of water spreading out round the buoy and the rocks, one after another, the far side of each passing behind
 *  whatever stands up out of the water (scripts/basement/lake.py, things.wakes). */
const WAKES = (T.wakes ?? []) as [number, number, number, number, number[] | null][];
function Wakes() {
  return (
    <>
      {WAKES.map(([x, y, rx, ry, cut], k) => {
        const w = Math.ceil(rx * 2 + 4), h = Math.ceil(ry * 2 + 3);          // room for a ring at its widest
        const left = x - w, top = y - h;
        const clip = cut ? `polygon(evenodd, 0 0, ${w * 2}px 0, ${w * 2}px ${h * 2}px, 0 ${h * 2}px, 0 0, ${cut[0] - left}px ${cut[1] - top}px, ${cut[2] + 1 - left}px ${cut[1] - top}px, ${cut[2] + 1 - left}px ${cut[3] + 1 - top}px, ${cut[0] - left}px ${cut[3] + 1 - top}px, ${cut[0] - left}px ${cut[1] - top}px)` : undefined;
        return (
          <span key={k} className="lk-wake" style={{ left, top, width: w * 2, height: h * 2, zIndex: 2, clipPath: clip }}>
            {[0, 1, 2].map((n) => <i key={n} style={{ left: w - rx, top: h - ry, width: rx * 2, height: ry * 2, animationDelay: `${-(n * 1.2 + k * 0.7)}s` }} />)}
          </span>
        );
      })}
    </>
  );
}

/** What is going on out on the water: glints that come and go by day (a path of them under the moon at night, when it is
 *  clear), rings where the rain lands, and once in a while a fish jumping. */
function WaterLife({ t, light, wet, cover }: { t: number; light: number; wet: boolean; cover: number }) {
  const spots = WATER_SPOTS;
  const moon = light < 0.25 && cover < 0.7 && !wet;
  // a jump every 23 seconds, somewhere out in the water (the same for everybody)
  const j = Math.floor(t / 23000), jt = (t % 23000) / 900;
  const jp = JUMP_SPOTS[(j * 7919) % JUMP_SPOTS.length];
  return (
    <>
      {light > 0.3 && !wet && spots.slice(0, 18).map(([x, y], k) => <i key={k} className="lk-glint" style={{ left: x, top: y, zIndex: 2, animationDelay: `${-k * 0.77}s`, opacity: 0.4 + 0.6 * light }} />)}
      {moon && spots.filter(([x]) => Math.abs(x - 436) < 14).slice(0, 14).map(([x, y], k) => <i key={`m${k}`} className="lk-glint moon" style={{ left: x, top: y, zIndex: 2981, animationDelay: `${-k * 0.53}s` }} />)}
      {wet && spots.slice(0, 26).map(([x, y], k) => <i key={`r${k}`} className="lk-ring" style={{ left: x - 4, top: y - 1.5, zIndex: 2, animationDelay: `${-((k * 0.37) % 1.6)}s` }} />)}
      {jt < 1 && jp && (
        <>
          <i className="lk-jump" style={{ left: jp[0] - 8, top: jp[1] - 9, zIndex: 3, '--k': jt } as CSSProperties}><CatchPic kind={j % 5 === 0 ? 'bass' : j % 3 === 0 ? 'trout' : 'bluegill'} k={0.4} /></i>
          <i className="lk-splash small" style={{ left: jp[0] - 6, top: jp[1] - 6, zIndex: 3 }} />
        </>
      )}
    </>
  );
}
/** Where a fish may jump: open water all round the leap (its picture, about 16 by 10, goes 8 either side and 12 up as it
 *  arcs), so it never shows over the dock, the boat or the shore. */
const JUMP_SPOTS: number[][] = (() => {
  const out: number[][] = [];
  let a = 777;
  const r = () => { a = (a * 1103515245 + 12345) & 0x7fffffff; return a / 0x7fffffff; };
  for (let k = 0; k < 2000 && out.length < 40; k++) {
    const x = 20 + r() * (LAYOUT.w - 40), y = 70 + r() * 180;
    let ok = true;
    for (let dx = -16; dx <= 16 && ok; dx += 4) for (let dy = -26; dy <= 6 && ok; dy += 4) ok = inWater(x + dx, y + dy);
    // (and well clear of the dock: its lamp posts and the anglers stand up over the water behind it)
    if (ok && x > 222 && x < 396 && y > 84 && y < 272) ok = false;
    if (ok) out.push([Math.round(x), Math.round(y)]);
  }
  return out;
})();
/** Places out on the open water (away from the dock and the shores), picked once, the same everywhere. */
const WATER_SPOTS: number[][] = (() => {
  const out: number[][] = [];
  let a = 12345;
  const r = () => { a = (a * 1103515245 + 12345) & 0x7fffffff; return a / 0x7fffffff; };
  for (let k = 0; k < 400 && out.length < 60; k++) {
    const x = 10 + r() * (LAYOUT.w - 20), y = 60 + r() * 200;
    if ([0, 8, -8].every((dx) => inWater(x + dx, y) && inWater(x + dx, y + 5) && inWater(x + dx, y - 5))) out.push([Math.round(x), Math.round(y)]);
  }
  return out;
})();

/** The catch card: what came up, how big, what it is like; keep it, or let it go. Mine only. */
function CatchCard({ card }: { card: Card }) {
  const k = KIND[card.c.kind];
  if (!k) return null;
  const junk = !k.lb;
  const answer = (keep: boolean) => { send({ t: 'fit', id: ID, op: 'keep', cid: card.c.id, keep }); useLocal.setState({ card: null }); if (!keep) splashSound(0.7); };
  return (
    <div className="lk-card" style={{ zIndex: 4000 }} onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
      <div className="lk-card-top" style={{ color: RARITY_COLOR[k.rarity] }}>{RARITY_WORD[k.rarity]}</div>
      <b className="lk-card-name">{k.name}</b>
      <div className="lk-card-pic"><CatchPic kind={k.id} k={2} /></div>
      {!junk && <div className="lk-card-size">{weighs(card.c.w)} <span>{inches(card.c.len)}</span></div>}
      {(card.best || card.pb || card.first || card.perfect) && <div className="lk-card-flag">{[card.perfect ? 'Perfect catch!' : '', card.best ? 'Lake record!' : card.pb ? 'Your best one yet' : card.first ? 'Your first one' : ''].filter(Boolean).join(' · ')}</div>}
      {k.id === 'bottle' && card.c.note ? <p className="lk-card-note">"{card.c.note}"</p> : <p className="lk-card-say">{k.say}</p>}
      <div className="lk-card-buttons">
        <button onClick={() => answer(true)}>{junk ? 'Keep it' : 'Keep'}</button>
        <button onClick={() => answer(false)}>{junk ? 'Bin it' : 'Let it go'}</button>
      </div>
    </div>
  );
}

/** The record board, opened large: the biggest of each fish and who caught it, the junk that has come up, everybody's
 *  bests, and (another tab) my own catches. */
function RecordBoard({ st, name, me }: { st: Lake; name: (id: string) => string; me: string }) {
  const tab = useLocal((s) => s.tab), log = useLocal((s) => s.log);
  const downOn = useRef(false);
  const close = () => useLocal.setState({ board: false });
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, []);
  const people = Object.keys(st.totals).sort((a, b) => st.totals[b].n - st.totals[a].n);
  return (
    <div className="gr-overlay" onMouseDown={(ev) => { downOn.current = ev.target === ev.currentTarget; }} onClick={(ev) => { if (downOn.current && ev.target === ev.currentTarget) close(); }}>
      <div className="gr-box lk-board" onClick={(ev) => ev.stopPropagation()}>
        <header className="gr-tabs">
          <b className="mg-title">Lake records</b>
          <button className={tab === 'records' ? 'on' : ''} onClick={() => useLocal.setState({ tab: 'records' })}>The board</button>
          <button className={tab === 'mine' ? 'on' : ''} onClick={() => { useLocal.setState({ tab: 'mine' }); send({ t: 'fit', id: ID, op: 'log' }); }}>My catches</button>
          <span />
          <button onClick={close} title="Back to the lake (Esc)">Close</button>
        </header>
        {tab === 'records' ? (
          <div className="lk-board-body">
            <table className="lk-table">
              <thead><tr><th /><th>Fish</th><th>Record</th><th>Caught by</th><th /></tr></thead>
              <tbody>
                {FISH.map((k) => {
                  const r = st.records[k.id];
                  return (
                    <tr key={k.id} className={r ? '' : 'none'}>
                      <td><CatchPic kind={k.id} k={1} style={r ? undefined : { filter: 'brightness(0) invert(1)', opacity: 0.16 }} /></td>
                      <td style={{ color: RARITY_COLOR[k.rarity] }}>{r ? k.name : '???'}</td>
                      <td>{r ? <>{weighs(r.w)} <small>{inches(r.len)}</small></> : <small>not caught yet</small>}</td>
                      <td>{r ? name(r.uid) : ''}</td>
                      <td><small>{r ? dayOf(r.at) : ''}</small></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <table className="lk-table">
              <thead><tr><th /><th>Pulled out of the lake</th><th>How many</th><th>First found by</th><th /></tr></thead>
              <tbody>
                {JUNK.map((k) => {
                  const r = st.junk[k.id];
                  return (
                    <tr key={k.id} className={r ? '' : 'none'}>
                      <td><CatchPic kind={k.id} k={1} style={r ? undefined : { filter: 'brightness(0) invert(1)', opacity: 0.16 }} /></td>
                      <td>{r ? k.name : '???'}</td>
                      <td>{r ? r.n : ''}</td>
                      <td>{r ? name(r.uid) : ''}</td>
                      <td><small>{r ? dayOf(r.at) : ''}</small></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {people.length > 0 && (
              <table className="lk-table lk-bests">
                <thead><tr><th>Everybody's best</th>{FISH.map((k) => <th key={k.id} title={k.name}><CatchPic kind={k.id} k={0.75} /></th>)}<th>Catches</th><th>Kept</th></tr></thead>
                <tbody>
                  {people.map((id) => (
                    <tr key={id} className={id === me ? 'me' : ''}>
                      <td>{name(id)}</td>
                      {FISH.map((k) => { const b = st.best[id]?.[k.id]; const top = b && st.records[k.id]?.uid === id && st.records[k.id]?.w === b.w; return <td key={k.id} className={top ? 'top' : ''}>{b ? weighs(b.w) : ''}</td>; })}
                      <td>{st.totals[id].n}</td>
                      <td>{st.totals[id].kept}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {!people.length && <p className="gr-say">Nothing caught yet. The dock is that way.</p>}
          </div>
        ) : (
          <div className="lk-board-body">
            {!log ? <p className="gr-say">…</p> : !log.length ? <p className="gr-say">You have not caught anything yet.</p> : (
              <table className="lk-table">
                <thead><tr><th /><th>What</th><th>Size</th><th>When</th><th /></tr></thead>
                <tbody>
                  {log.map((c) => (
                    <tr key={c.id}>
                      <td><CatchPic kind={c.kind} k={1} /></td>
                      <td style={{ color: RARITY_COLOR[KIND[c.kind]?.rarity ?? 'junk'] }}>{KIND[c.kind]?.name ?? c.kind}{c.note ? <small className="lk-note"> "{c.note}"</small> : null}</td>
                      <td>{c.w ? <>{weighs(c.w)} <small>{fmt(c.len)} in</small></> : ''}</td>
                      <td><small>{dayOf(c.at)}</small></td>
                      <td><small>{c.kept === 1 ? 'kept' : c.kept === 0 ? (c.w ? 'let go' : 'binned') : ''}</small></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** How somebody at one of the dock's spots is drawn (FitGame.pose): the 'reach' row, the arm out holding the rod (frames 2
 *  and 3, cranking the reel while a fish is on), raised to throw for a moment as they cast (frame 1); turned to face the
 *  water on their side. */
export function pose(uid: string, key: string) {
  const m = /^b(\d+)$/.exec(key);
  if (!m || !SPOT.has(Number(m[1]))) return null;
  const n = Number(m[1]), flip = spotFace(n) > 0;
  const l = (useStore.getState().fits[ID] as Lake | undefined)?.lines[uid];
  if (l && l.spot === n && l.phase === 'cast' && now() - l.t0 < 260) return { row: 'reach' as const, first: 1, frames: 1, ms: 1000, flip };
  if (l && l.spot === n && l.phase === 'reel') return { row: 'reach' as const, first: 2, frames: 2, ms: 200, flip };
  return { row: 'reach' as const, first: 2, frames: 1, ms: 1000, flip };
}

/** What pointing at a seat says. */
export const says = (seat: number) => (SPOT.has(seat) ? 'Fish from here' : 'Sit and look at the water');
// (the game's sounds stop when I leave the lake)
useStore.subscribe((s, p) => {
  const was = p.me ? p.presence[p.me.id]?.floor : '', is = s.me ? s.presence[s.me.id]?.floor : '';
  if (was === ID && is !== ID) { hush(ID); stopReel(); useLocal.setState({ board: false }); }
});
