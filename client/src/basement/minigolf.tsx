// Mini golf, played in the scenes themselves (server/basement/minigolf.ts keeps the turns and the scorecard; golf.ts is
// the physics, played out on the server once a putt; scripts/basement/_golf_art.py draws the three scenes, holes 1 to 3
// up the path from the backyard, 4 to 6 and 7 to 9 each a scene further on to the left). Each hole lies in its scene at
// things.golf's place for it, SC scene dots to one of the hole's own units; this module is the Room of all three
// (minigolf2.tsx and minigolf3.tsx are this one again).
//
// A round: click the kiosk by the first holes (or Mini golf in Play Games) for the scorecard, Join, then Tee off. Whoever
// is to putt is put straight at their ball, putter in hand (the others are out of sight till their turn), facing us for a
// putt across and side on for one up or down, turning as the drag turns. On
// your turn, press on (or near) your ball and drag back: the putter goes back with the drag, the dashed line from the
// ball says only which way, the meter beside you fills with the pull (no marks on it), and the server's unsteady hand
// adds a little either way. Let go and the putter swings through and strikes. The ball rolls with a short trail, lights
// the posts it hits, flies off the ramp with its shadow on the ground, goes down a pipe and pops out of another, goes in
// under the windmill (its sails turning, as they turn on the server), drops into the cup or lips out of it; the balls
// lying on the green are in the way, and one knocked ("clack!") rolls on. Once everybody is down the next hole begins,
// and when that is in the next scene, the players go on to it along the path.
//
// What stands still is in the scene's picture; drawn here: the moving parts (sails, sliding doors, sweepers), the water's
// glints, the balls, the flags, the putter, the aim and the meter, the words of the moment, the board at the top saying
// whose putt it is, and the scorecard. Dark when it is dark outside, the lamps along the path lit.
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { create } from 'zustand';
import { hooks, send, useStore } from '../store';
import { personColor, marksOf, rowIndex } from '../sprites';
import type { SpriteRow } from '../sprites';
import { armAt, CUP_R, inside, sails, sliderAt } from './golf';
import type { Hole } from './golf';
import COURSE from './golf-courses.json';
import { drawn, goFloor } from './index';
import type { FitLayout, FitPose, FitProps } from './index';
import { LAYOUT as G1 } from './minigolf.gen';
import { LAYOUT as G2 } from './minigolf2.gen';
import { LAYOUT as G3 } from './minigolf3.gen';
import { useWatching } from './sound';
import { kit } from './yardkit';
import { daylight } from './outside.tsx';
import { useOutdoorWeather } from '../season';
import { pageRect } from '../device';
import './minigolf.css';

const ID = 'minigolf';
const HOLES = COURSE as unknown as Hole[];
type P = [number, number];
type Golf = { players: string[]; hole: number; strokes: number[][]; balls: (P | null)[]; done: boolean[]; turn: number; on: boolean; over: boolean; busyUntil: number; last: string };
/** A ball knocked by the putt: its path is on the putted ball's clock (a point every `ms` from the stroke). */
type Knocked = { who: string; path: number[][]; result: string };
type RollNow = { who: string; path: number[][]; ms: number; start: number; t0: number; result: string; hits: [number, number][]; lipAt: number; hole: number; knocked: Knocked[]; frames: number };
type GolfThings = { sc: number; holes: { n: number; ox: number; oy: number }[]; mill: { n: number; hub: number[]; len: number; z: number } | null; booth?: number[]; lobby?: number[][]; fountain?: number[]; pond?: number[] };

// ── where each hole is: its scene, and where its (0, 0) is in it ──
const SCENES = [G1, G2, G3] as unknown as FitLayout[];
const PLACE: { scene: string; ox: number; oy: number; sc: number }[] = [];
for (const l of SCENES) { const gt = l.things.golf as GolfThings; for (const h of gt.holes) PLACE[h.n] = { scene: l.id, ox: h.ox, oy: h.oy, sc: gt.sc }; }
export const isGolfScene = (id: string | undefined | null) => !!id && SCENES.some((l) => l.id === id);
const sceneOf = (n: number) => PLACE[Math.max(0, Math.min(HOLES.length - 1, n))]?.scene ?? 'minigolf';
const sx = (n: number, x: number) => PLACE[n].ox + x * PLACE[n].sc;
const sy = (n: number, y: number) => PLACE[n].oy + y * PLACE[n].sc;
const SC = PLACE[0]?.sc ?? 0.4;

const STRIKE_MS = 170;                                     // the putter coming through, before the ball goes
const SINK_MS = 650;                                       // the drop into the cup, after the last point of the roll
const PULL = 54;                                           // a drag this long (scene dots) is a full-strength putt
const K = 3;                                               // the canvases' pixels to a scene dot
const FLAG = ['#e8402a', '#f2c230', '#3a8ae8', '#e8402a', '#f2c230', '#3a8ae8', '#e8402a', '#f2c230', '#3a8ae8'];

const useLocal = create<{ roll: RollNow | null; card: boolean; swing: { who: string; at: number; from: number } | null }>()(() => ({ roll: null, card: false, swing: null }));
/** Opens the scorecard (or shuts it), from outside the room (Play Games). It shows once I am at the mini golf. */
export const setOpen = (open: boolean) => useLocal.setState({ card: open });
const serverNow = () => Date.now() - (useStore.getState().music.skew || 0);
/** My drag back just now: where it began and where it is (scene dots). */
const aim = { on: false, x0: 0, y0: 0, x: 0, y: 0 };

let listening = false;
function listen() {
  if (listening) return;
  listening = true;
  hooks.fit.push((d) => {
    if (d.id !== ID || d.op !== 'putt' || !Array.isArray(d.path)) return;
    const g = useStore.getState().fits[ID] as Golf | undefined;
    const n = Math.min(g?.hole ?? 0, HOLES.length - 1), hole = HOLES[n];
    const path = d.path as number[][];
    // where it passed over the cup without dropping (for the "lip out" moment)
    const lipAt = d.result === 'holed' ? -1 : path.findIndex((p) => p[2] === undefined && Math.hypot(p[0] - hole.cup[0], p[1] - hole.cup[1]) < CUP_R + 3);
    const knocked = (Array.isArray(d.knocked) ? d.knocked as Knocked[] : []).filter((q) => q && Array.isArray(q.path) && q.path.length).map((q) => ({ who: String(q.who), path: q.path, result: String(q.result) }));
    const frames = Math.max(path.length, ...knocked.map((q) => q.path.length));
    const sinks = d.result === 'holed' || knocked.some((q) => q.result === 'holed');
    const now = performance.now(), who = String(d.who);
    const mine = who === useStore.getState().me?.id;
    // the swing: from where my own drag had it (mine), or from a backswing, through to the strike
    const from = mine ? Math.max(-1, -Math.hypot(aim.x - aim.x0, aim.y - aim.y0) / PULL) || -0.8 : -0.8;
    useLocal.setState({ swing: { who, at: now, from } });
    const roll: RollNow = { who, path, ms: Number(d.ms) || 33, start: now + STRIKE_MS, t0: Number(d.t0) || serverNow(), result: String(d.result), hits: Array.isArray(d.hits) ? d.hits as [number, number][] : [], lipAt, hole: n, knocked, frames };
    useLocal.setState({ roll });
    sounds(roll);
    window.setTimeout(() => { if (useLocal.getState().roll === roll) useLocal.setState({ roll: null }); }, STRIKE_MS + frames * roll.ms + (sinks ? SINK_MS + 500 : 600));
  });
}
const useGolf = () => useStore((s) => s.fits[ID] as Golf | null | undefined);
const user = (id: string) => useStore.getState().users[id];
const nameOf = (id: string) => user(id)?.name ?? 'Somebody';
const colorOf = (id: string) => { const u = user(id); return u ? personColor(u) : '#ffffff'; };

/** A ball just now: where (the hole's own units), how high in the air, how far into the cup (0..1); null if not out. */
type BallNow = { x: number; y: number; z: number; sink: number; rolling: boolean } | null;
function along(path: number[][], result: string, el: number, ms: number): BallNow {
  const last = path.length - 1;
  if (el >= last && result === 'holed') { const [x, y] = path[last]; return { x, y, z: 0, sink: Math.min(1, ((el - last) * ms) / SINK_MS), rolling: false }; }
  if (el >= last && result === 'water') return null;
  const f = Math.min(last, Math.max(0, el)), i = Math.floor(f), u = f - i, a = path[i], b = path[Math.min(i + 1, last)];
  if ((a[2] ?? 0) < 0 || (b[2] ?? 0) < 0) return null;                      // down a pipe
  return { x: a[0] + (b[0] - a[0]) * u, y: a[1] + (b[1] - a[1]) * u, z: (a[2] ?? 0) + ((b[2] ?? 0) - (a[2] ?? 0)) * u, sink: 0, rolling: el > 0 && el < last };
}
/** Where a player's ball lies when nothing is rolling (the tee, if they have not putted yet on this hole). */
const lies = (g: Golf, k: number): P | null => (g.done[k] ? null : g.balls[k] ?? HOLES[g.hole]?.tee ?? null);
function ballsNow(g: Golf | null | undefined, now: number): BallNow[] {
  if (!g || !g.on || g.over) return [];
  const r = useLocal.getState().roll;
  return g.players.map((id, k) => {
    if (r && r.who === id) return along(r.path, r.result, (now - r.start) / r.ms, r.ms);
    const kn = r?.knocked.find((q) => q.who === id);
    if (r && kn) return along(kn.path, kn.result, (now - r.start) / r.ms, r.ms);
    // (before anybody has putted, only the one to putt has a ball down on the tee)
    const p = g.balls[k] ?? (g.turn === k ? HOLES[g.hole]?.tee ?? null : null);
    return p && !g.done[k] ? { x: p[0], y: p[1], z: 0, sink: 0, rolling: false } : null;
  });
}

/** Where somebody stands to putt a ball lying at `ball` on hole n (scene dots), and the way to the cup. A putt mostly
 *  across, they face us, the ball just in front of their toes; one mostly up or down the screen, they stand side on to
 *  it (facing left, or right near the scene's right-hand edge), the ball at their feet in front of them. */
function stanceOf(n: number, ball: P) {
  const h = HOLES[n], dx = h.cup[0] - ball[0], dy = h.cup[1] - ball[1], d = Math.hypot(dx, dy) || 1;
  const ux = dx / d, uy = dy / d, bx = sx(n, ball[0]), by = sy(n, ball[1]);
  return { ...feetFor(bx, by, ux, uy), ux, uy };
}
/** Where the golfer's feet go for a putt from (bx, by) along (ux, uy), and which way they face: as a right-handed
 *  golfer stands, the way it goes on their left. Across the screen, they face us; up the screen, they stand to the left
 *  of the ball facing right, down it, to the right facing left. */
function feetFor(bx: number, by: number, ux: number, uy: number) {
  const side = Math.abs(uy) > 0.72, right = side && uy < 0;
  if (side) return { x: Math.round(bx + (right ? -SIDE_X : SIDE_X)), y: Math.round(by + 1), side, right };
  return { x: Math.round(bx), y: Math.round(by - 5), side, right };
}
const SIDE_X = 9;                                          // side on, the ball this far in front of the middle of them
/** Somebody stood at their ball just now (drawn there). */
function atBall(uid: string, n: number, ball: P) {
  const d = drawn.get(uid), st = stanceOf(n, ball);
  return !!d && Math.abs(d.x - st.x) < 1.5 && Math.abs(d.y - st.y) < 1.5;
}
/** Whoever is putting, or about to, just now: the one whose turn it is (stood at their ball), or the one who just
 *  putted, while their putter comes through. */
function putter(g: Golf | null | undefined): { uid: string; ball: P; n: number } | null {
  if (!g || !g.on || g.over) return null;
  const sw = useLocal.getState().swing, r = useLocal.getState().roll;
  if (sw && r && sw.who === r.who && performance.now() - sw.at < 1200) {
    const k = g.players.indexOf(sw.who);
    const b = k >= 0 ? g.balls[k] ?? HOLES[g.hole].tee : null;
    if (b) return { uid: sw.who, ball: b, n: g.hole };
  }
  if (r) return null;
  const who = g.players[g.turn], b = lies(g, g.turn);
  return who && b ? { uid: who, ball: b, n: g.hole } : null;
}
/** Who is shown in a round just now: whoever is putting, or whose putt is rolling. The rest are out of sight. */
function upNow(g: Golf | null | undefined): string {
  if (!g || !g.on || g.over) return '';
  const r = useLocal.getState().roll;
  return r ? r.who : g.players[g.turn] ?? '';
}
/** Where player k waits by hole n, out of the way: along its near side, each in a place of their own. */
function waitSpot(n: number, k: number): number[] {
  const hole = HOLES[n], xs = hole.fairway.map((p) => p[0]), ys = hole.fairway.map((p) => p[1]);
  const top = PLACE[n].oy < 150;
  const x = sx(n, (Math.min(...xs) + Math.max(...xs)) / 2) - 36 + (k % 6) * 15;
  const y = top ? sy(n, Math.max(...ys)) + 9 : sy(n, Math.min(...ys)) - 5;
  return [Math.round(x), Math.round(y)];
}
/** Where each player in a round on the scene I am looking at is just now: the one to putt stood at their ball, the one
 *  whose putt is rolling where they putted from, the rest by the hole. Nobody walks between them: they are just there. */
const stood = new Map<string, number[]>();
function spotOf(uid: string): number[] | null {
  const s = useStore.getState(), g = s.fits[ID] as Golf | undefined;
  if (!g || !g.on || g.over) return null;
  const k = g.players.indexOf(uid), scene = sceneOf(g.hole);
  if (k < 0 || s.presence[uid]?.floor !== scene || (s.me && s.presence[s.me.id]?.floor !== scene)) return null;
  const r = useLocal.getState().roll;
  let at: number[];
  if (r && r.who === uid) at = stood.get(uid) ?? waitSpot(g.hole, k);
  else {
    const p = putter(g);
    if (p && p.uid === uid) { const st = stanceOf(p.n, p.ball); at = [st.x, st.y]; }
    else at = waitSpot(g.hole, k);
  }
  stood.set(uid, at);
  return at;
}

/** How whoever is at their ball is drawn under the golfer (until it is drawn): standing, facing us or side on. */
export function pose(uid: string): FitPose | null {
  const g = useStore.getState().fits[ID] as Golf | undefined;
  const p = putter(g);
  if (!p || p.uid !== uid || !atBall(uid, p.n, p.ball)) return null;
  const st = stanceOf(p.n, p.ball);
  return st.side ? { row: st.right ? 'walk_right' : 'walk_left', first: 1, frames: 1, ms: 1000 } : { row: 'idle', first: 0, frames: 1, ms: 1000 };
}
/** The players in a round are put straight where they go (see spotOf). */
export function steer(uid: string): { x: number; y: number } | null {
  const at = spotOf(uid);
  return at ? { x: at[0], y: at[1] } : null;
}
export const says = () => 'Sit and watch the golf';

// ── sounds: the tock of the putter, a clack, posts, the rattle in the cup, a splash ──
function sounds(r: RollNow) {
  const s = useStore.getState(), here = s.me ? s.presence[s.me.id]?.floor : '';
  if (here !== sceneOf(r.hole)) return;
  const k = kit(ID, true);
  if (!k) return;
  const at = k.now + STRIKE_MS / 1000, step = r.ms / 1000;
  k.tone(at, 1400, 700, 0.06, 0.5, 'triangle'); k.burst(at, 0.04, 'bandpass', 2400, 0.4);
  for (const [i] of r.hits) k.tone(at + i * step, 520, 300, 0.12, 0.35);
  for (const q of r.knocked) { const i = q.path.findIndex((p) => p[0] !== q.path[0][0] || p[1] !== q.path[0][1]); if (i > 0) k.tone(at + i * step, 1800, 1100, 0.05, 0.45, 'triangle'); }
  for (const q of [r, ...r.knocked]) {
    const end = at + (q.path.length - 1) * step;
    if (q.result === 'holed') { k.tone(end, 900, 500, 0.08, 0.4, 'triangle'); k.tone(end + 0.09, 700, 380, 0.08, 0.3, 'triangle'); k.tone(end + 0.17, 500, 300, 0.12, 0.25, 'triangle'); }
    if (q.result === 'water') k.burst(end, 0.45, 'lowpass', 900, 0.6);
  }
}

// ───────────────────────── drawing ─────────────────────────
type Ctx = CanvasRenderingContext2D;
const dot = (c: Ctx, x: number, y: number, w = 1, h = 1) => c.fillRect(Math.round(x * K), Math.round(y * K), Math.round(w * K), Math.round(h * K));
function disc(c: Ctx, x: number, y: number, r: number) { c.beginPath(); c.arc(x * K, y * K, r * K, 0, Math.PI * 2); }
function seg(c: Ctx, a: number[], b: number[], w: number, col: string) { c.strokeStyle = col; c.lineWidth = w * K; c.beginPath(); c.moveTo(a[0] * K, a[1] * K); c.lineTo(b[0] * K, b[1] * K); c.stroke(); }
function caption(c: Ctx, text: string, x: number, y: number, a: number, col = '#fff6d8') {
  if (a <= 0) return;
  c.save(); c.globalAlpha = Math.min(1, a); c.font = `${8 * K}px VT323, monospace`; c.textAlign = 'center';
  c.lineWidth = 2 * K; c.strokeStyle = 'rgba(20,10,5,0.9)'; c.strokeText(text, x * K, y * K); c.fillStyle = col; c.fillText(text, x * K, y * K); c.restore();
}
/** A ball, `r` scene dots across the middle: its shadow, the ball in its owner's colour, lit at its top left. */
function ball(c: Ctx, x: number, y: number, z: number, sink: number, col: string) {
  const r = 1.7 * (1 - sink * 0.6), lift = z * SC * 0.6;
  if (sink < 1) {
    c.fillStyle = 'rgba(0,20,10,0.35)'; c.beginPath(); c.ellipse((x + 0.5) * K, (y + 0.7) * K, (r + 0.2) * K, r * 0.6 * K, 0, 0, Math.PI * 2); c.fill();
    disc(c, x, y - lift - sink * 0.5, r + 0.45); c.fillStyle = '#141018'; c.fill();
    disc(c, x, y - lift - sink * 0.5, r); c.fillStyle = col; c.fill();
    c.fillStyle = 'rgba(255,255,255,0.85)'; dot(c, x - r * 0.55, y - lift - r * 0.55 - sink * 0.5, 0.67, 0.67);
  }
}

/** Water glints for each hole: a few points in the water, each twinkling in its own time. */
const glintsOf = new Map<number, P[]>();
function glints(n: number): P[] {
  let g = glintsOf.get(n);
  if (g) return g;
  g = [];
  const h = HOLES[n];
  for (const w of h.water) for (let y = 0; y < 300; y += 9) for (let x = 0; x < 600; x += 13) if (inside([x + (y % 2) * 6, y], w)) g.push([x + (y % 2) * 6, y]);
  glintsOf.set(n, g);
  return g;
}

/** The ground: what lies or moves on the turf, under everybody (the moving parts, the balls and their trails). */
function drawGround(c: Ctx, g: Golf | null | undefined, here: number[], now: number) {
  c.clearRect(0, 0, c.canvas.width, c.canvas.height);
  const r = useLocal.getState().roll;
  for (const n of here) {
    const h = HOLES[n], live = r && r.hole === n && g?.hole === n ? r : null;
    const el = live ? (now - live.start) / live.ms : 0;
    const t = live ? live.t0 + (now - live.start) : serverNow();
    const X = (x: number) => sx(n, x), Y = (y: number) => sy(n, y);
    // the water's glints
    for (const [k, [x, y]] of glints(n).entries()) {
      const a = Math.sin(t / 420 + k * 1.7);
      if (a > 0.55) { c.fillStyle = `rgba(230,248,255,${(a - 0.55) * 1.6})`; dot(c, Math.round(X(x) + Math.sin(t / 900 + k)), Math.round(Y(y)), 2, 1); }
    }
    // sliding doors: a teal block, lit along its top and left, a yellow stripe, its shadow
    for (const s of h.sliders ?? []) {
      const q = sliderAt(s, t), x0 = X(q.x), y0 = Y(q.y), w = s.w * SC, hh = s.h * SC;
      c.fillStyle = 'rgba(0,20,10,0.35)'; dot(c, x0 + 1, y0 + 1.4, w, hh);
      c.fillStyle = '#1e6a66'; dot(c, x0, y0, w, hh);
      c.fillStyle = '#3aa8a0'; dot(c, x0, y0, w - 1, hh - 1.4);
      c.fillStyle = '#9ae0d8'; dot(c, x0, y0, w, 0.67); dot(c, x0, y0, 0.67, hh);
      c.fillStyle = '#f2c230'; dot(c, x0 + w / 2 - 1, y0 + hh / 2 - 1, 2, 2);
    }
    // sweepers: a striped boom on a brass hub, its shadow on the turf
    for (const arm of h.arms ?? []) {
      const { a, b } = armAt(arm, t), A = [X(a[0]), Y(a[1])], B = [X(b[0]), Y(b[1])];
      c.lineCap = 'round';
      seg(c, [A[0] + 1, A[1] + 1.5], [B[0] + 1, B[1] + 1.5], 2.2, 'rgba(0,20,10,0.35)');
      seg(c, A, B, 2.4, '#5a1a14'); seg(c, A, B, 1.6, '#f2ece0');
      c.lineCap = 'butt';
      for (let k = 0; k < 6; k += 2) seg(c, [A[0] + (B[0] - A[0]) * k / 6, A[1] + (B[1] - A[1]) * k / 6], [A[0] + (B[0] - A[0]) * (k + 1) / 6, A[1] + (B[1] - A[1]) * (k + 1) / 6], 1.6, '#d8402e');
      disc(c, X(arm[0]), Y(arm[1]), 1.8); c.fillStyle = '#6a4a14'; c.fill();
      disc(c, X(arm[0]) - 0.3, Y(arm[1]) - 0.3, 1.2); c.fillStyle = '#e8c860'; c.fill();
    }
    // a post struck just now: a glow round it
    if (live) h.bumpers.forEach(([x, y, rr], k) => {
      let flash = 0;
      for (const [i, j] of live.hits) if (j === k && el >= i) flash = Math.max(flash, Math.exp(-((el - i) * live.ms) / 220));
      if (flash > 0.03) { disc(c, X(x), Y(y), rr * SC + 1 + flash * 2.5); c.fillStyle = `rgba(255,220,120,${0.55 * flash})`; c.fill(); }
    });
    if (!g || g.hole !== n || !g.on || g.over) continue;
    // the balls, and the trail of each one rolling
    const balls = ballsNow(g, now);
    if (live) for (const q of [live, ...live.knocked]) {
      const i = Math.min(q.path.length - 1, Math.floor(el));
      c.lineCap = 'round';
      for (let k = Math.max(1, i - 8); k <= i; k++) {
        const a = q.path[k - 1], b = q.path[k];
        if ((a[2] ?? 0) !== 0 || (b[2] ?? 0) !== 0 || (a[0] === b[0] && a[1] === b[1])) continue;
        seg(c, [X(a[0]), Y(a[1])], [X(b[0]), Y(b[1])], 1.4 * (1 - (i - k) / 10), `rgba(255,255,240,${0.4 * (1 - (i - k) / 9)})`);
      }
    }
    balls.forEach((b, k) => { if (b) ball(c, X(b.x), Y(b.y), b.z, b.sink, colorOf(g.players[k])); });
  }
}

/** The windmill's four sails round their hub, as they are on the server just now. */
function drawSails(c: Ctx, n: number, hub: number[], len: number, now: number) {
  c.clearRect(0, 0, c.canvas.width, c.canvas.height);
  const r = useLocal.getState().roll, live = r && r.hole === n ? r : null;
  const t = live ? live.t0 + (now - live.start) : serverNow();
  const { angle } = sails(HOLES[n], t);
  const cx = c.canvas.width / K / 2, cy = c.canvas.height / K / 2;
  for (let k = 0; k < 4; k++) {
    // (the server's sail k points at angle + k quarter turns, measured as on the screen: π/2 straight down)
    const a = angle + (k * Math.PI) / 2, ux = Math.cos(a), uy = Math.sin(a), vx = -uy, vy = ux;
    const p = (u: number, v: number) => [(cx + ux * u + vx * v) * K, (cy + uy * u + vy * v) * K];
    c.fillStyle = '#3a2418';
    c.beginPath(); for (const [i, q] of [p(0, -0.6), p(len, -0.6), p(len, 0.6), p(0, 0.6)].entries()) { if (i) c.lineTo(q[0], q[1]); else c.moveTo(q[0], q[1]); } c.fill();
    c.beginPath(); for (const [i, q] of [p(5, -2), p(len, -4.5), p(len, 4.5), p(5, 2)].entries()) { if (i) c.lineTo(q[0], q[1]); else c.moveTo(q[0], q[1]); } c.closePath();
    c.fillStyle = '#f4ecd8'; c.fill(); c.strokeStyle = '#7a2a1e'; c.lineWidth = 0.7 * K; c.stroke();
    c.strokeStyle = 'rgba(122,42,30,0.6)'; c.lineWidth = 0.4 * K;
    for (let u = 7; u < len; u += 3) { const w = 2 + 2.5 * (u - 5) / (len - 5), [x0, y0] = p(u, -w), [x1, y1] = p(u, w); c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke(); }
    seg(c, [cx, cy], [cx + ux * len, cy + uy * len], 0.8, '#5a2a1e');
  }
  disc(c, cx, cy, 1.6); c.fillStyle = '#2a2a30'; c.fill(); disc(c, cx - 0.4, cy - 0.4, 0.7); c.fillStyle = '#9a9aa6'; c.fill();
}

/** The golfer, drawn whole over whoever is at their ball (their own sprite is hidden meanwhile), from the very sheet they
 *  are shown from (whatever they have on, sleeves, cuffs, ink and all). The frame's outline is taken off, the arms are
 *  lifted off and laid again bent in to the grip, both hands on it, and the outline put back on the way the sheets draw
 *  it (each edge dot a darker shade of what it edges), so nothing is left over and nothing is doubled; then the putter,
 *  from the hands to its head behind the ball, every dot on the scene's own grid. Facing us for a putt across, the arms
 *  swing with the putter, back with the drag (further the harder) and through on the stroke; side on for a putt up or
 *  down the screen, the near arm reaching down in front of them to the grip and the putter swinging away and back. */
const B = 72;
const CELL_W = 48, UPR = 18, CELL_H = 48 + UPR;
const sheetImgs = new Map<string, HTMLImageElement>();
const frames = new Map<string, ImageData>();
const scratch = document.createElement('canvas');
scratch.width = CELL_W; scratch.height = CELL_H;
const comp = document.createElement('canvas');
comp.width = B; comp.height = B;
type RGBA = [number, number, number, number];
const CLEAR: RGBA = [0, 0, 0, 0];
const INK = [26, 18, 40];
const NEXT = [[0, 1], [1, 0], [-1, 0], [0, -1]];               // (the order the sheets' outline looks round a dot in)
const rnd = (x: number) => { const f = Math.floor(x), d = x - f; return d < 0.5 ? f : d > 0.5 ? f + 1 : f % 2 === 0 ? f : f + 1; };
const edgeOf = (v: RGBA): RGBA => [rnd(v[0] + (INK[0] - v[0]) * 0.72), rnd(v[1] + (INK[1] - v[1]) * 0.72), rnd(v[2] + (INK[2] - v[2]) * 0.72), 255];
const sheetUrl = (el: HTMLElement | undefined) => /url\("?([^")]+)"?\)/.exec((el?.firstElementChild as HTMLElement | null)?.style.backgroundImage ?? '')?.[1] ?? '';

/** One frame of a sheet (a row, the frame along it), headroom and all, with its outline taken off below the shoulders
 *  (`from`, in the cell's rows); null until the sheet has loaded. */
function bareFrame(url: string, row: SpriteRow, f: number, from: number): ImageData | null {
  const key = `${url}|${row}|${f}|${from}`;
  const had = frames.get(key);
  if (had) return had;
  let im = sheetImgs.get(url);
  if (!im) { im = new Image(); im.src = url; sheetImgs.set(url, im); }
  if (!im.complete || !im.naturalWidth) return null;
  const k = im.naturalWidth / (CELL_W * 8), g = scratch.getContext('2d', { willReadFrequently: true })!;
  g.imageSmoothingEnabled = false;
  g.clearRect(0, 0, CELL_W, CELL_H);
  g.drawImage(im, f * CELL_W * k, rowIndex(row) * CELL_H * k, CELL_W * k, CELL_H * k, 0, 0, CELL_W, CELL_H);
  const img = g.getImageData(0, 0, CELL_W, CELL_H), d = img.data;
  // an outline dot is one the shade of a dot beside it, darkened toward the ink (as the sheets draw it)
  const at = (x: number, y: number): RGBA => (x < 0 || y < 0 || x >= CELL_W || y >= CELL_H ? CLEAR : [d[(y * CELL_W + x) * 4], d[(y * CELL_W + x) * 4 + 1], d[(y * CELL_W + x) * 4 + 2], d[(y * CELL_W + x) * 4 + 3]]);
  const off: number[] = [];
  for (let y = Math.max(0, from); y < CELL_H; y++) for (let x = 0; x < CELL_W; x++) {
    const v = at(x, y);
    if (!v[3]) continue;
    if (NEXT.some(([dx, dy]) => { const q = at(x + dx, y + dy); if (!q[3]) return false; const e = edgeOf(q); return Math.abs(e[0] - v[0]) <= 1 && Math.abs(e[1] - v[1]) <= 1 && Math.abs(e[2] - v[2]) <= 1; })) off.push((y * CELL_W + x) * 4);
  }
  for (const i of off) d[i + 3] = 0;
  frames.set(key, img);
  if (frames.size > 60) frames.delete(frames.keys().next().value!);
  return img;
}

function drawGolfer(c: Ctx, uid: string, ox: number, oy: number, px: number, py: number, ballXY: number[], u: number[], s: number, side: boolean, right: boolean): boolean {
  const who = user(uid), d = drawn.get(uid), url = sheetUrl(d?.el);
  if (!who || !url) return false;
  return paintGolfer(c, url, marksOf(who).hand, colorOf(uid), ox, oy, px, py, ballXY, u, s, side, right);
}

function paintGolfer(c: Ctx, url: string, hand: readonly number[], color: string, ox: number, oy: number, px: number, py: number, ballXY: number[], u: number[], s: number, side: boolean, right: boolean): boolean {
  // (side on, the frame is one of the walk's, stood up straight: drawn a dot higher, so a dot lower here)
  const top = hand[1] - 9 - (side ? 1 : 0);                    // the top of the torso, in the frame's own rows
  const src = bareFrame(url, side ? 'walk_left' : 'idle', side ? 1 : 0, top + UPR - 2);
  if (!src) return false;
  const W_ = CELL_W, H_ = CELL_H;
  const dots = new Uint8ClampedArray(src.data);
  const get = (x: number, y: number): RGBA => { if (x < 0 || y < 0 || x >= W_ || y >= H_) return CLEAR; const i = (y * W_ + x) * 4; return [dots[i], dots[i + 1], dots[i + 2], dots[i + 3]]; };
  const set = (x: number, y: number, v: RGBA) => { if (x < 0 || y < 0 || x >= W_ || y >= H_) return; const i = (y * W_ + x) * 4; dots[i] = v[0]; dots[i + 1] = v[1]; dots[i + 2] = v[2]; dots[i + 3] = v[3]; };
  const ys = top + 1 + UPR;                                    // the shoulder's row
  const isArm = new Set<number>();
  const shadow: [number, number][] = [];
  /** Lays an arm's rows (shoulder first, the hand last) from its shoulder at x0 to the grip: the upper arm down to the
   *  elbow, then the forearm to the hand, a row laid again wherever it has to stretch to reach. */
  const lay = (arm: RGBA[][], x0: number, elbowX: number, elbow: number, endX: number, endY: number) => {
    const rows = arm.length, ey = ys + elbow;
    let prev: [number, number] | null = null;
    for (let i = 0; i < rows; i++) {
      let x: number, y: number;
      if (i <= elbow) { const t = i / elbow; x = Math.round(x0 + (elbowX - x0) * t); y = ys + i; }
      else { const t = (i - elbow) / (rows - 1 - elbow); x = Math.round(elbowX + (endX - elbowX) * t); y = Math.round(ey + (endY - ey) * t); }
      const from = prev ? prev[1] + 1 : y;
      for (let yy = Math.min(from, y); yy <= y; yy++) {
        const xx = prev && y > prev[1] ? Math.round(prev[0] + ((x - prev[0]) * (yy - prev[1])) / (y - prev[1])) : x;
        for (let k = 0; k < arm[i].length; k++) if (arm[i][k][3]) { set(xx + k, yy, arm[i][k]); isArm.add(yy * W_ + xx + k); }
        if (i > elbow) for (let k = 0; k < arm[i].length; k++) shadow.push([xx + k, yy + 1]);
      }
      prev = [x, y];
    }
  };
  const armAt = (x0: number, w: number, n: number) => Array.from({ length: n }, (_, i) => Array.from({ length: w }, (_, k) => get(x0 + k, ys + i)));
  let gx: number, gy: number, hands: [RGBA[][], number, number][];
  let hx: number, hy: number;
  const fx = px - 24 - ox, fy = py - 45 - UPR - oy + (side ? 1 : 0);    // where the frame goes on the canvas
  if (!side) {
    // facing us: the arms as they hang, three dots across, ten rows down from the shoulder (the last two the hand)
    const n = 10, xR = hand[0] - 1, xL = 46 - hand[0];
    const armL = armAt(xL, 3, n), armR = armAt(xR, 3, n);
    for (let y = ys; y < ys + n; y++) for (let k = 0; k < 3; k++) { set(xR + k, y, CLEAR); set(xL + k, y, CLEAR); }
    // the hands together in front of the thighs, swung along the line of the putt, rising a dot or two at either end
    const sw = Math.round(u[0] * s * 4), lift = Math.round(Math.abs(s) * 1.6 - u[1] * s * 1.5);
    gx = 24 + sw; gy = ys + n - lift;
    lay(armL, xL, xL + 1, 4, gx - 1, gy + 1);            // the arm on our left: their right hand, the lower on the grip
    lay(armR, xR, xR - 1, 4, gx - 1, gy - 1);            // on our right: their left hand, on top
    hands = [[armL, n, gy + 1], [armR, n, gy - 1]];
    hx = Math.round(ballXY[0] - ox - u[0] * 2.6 + u[0] * s * 9);
    hy = Math.round(ballXY[1] - oy - u[1] * 2.6 + u[1] * s * 4.5 - Math.abs(s * u[0]) * 1.4);
  } else {
    // side on, facing left: the near arm, four dots across and nine rows down, lifted off the body (the body filled in
    // behind it from beside it), and laid reaching down and forward to the grip in front of the hips
    const n = 9, x0 = 22;
    const arm = armAt(x0, 4, n);
    for (let y = ys; y < ys + n; y++) {
      const b = get(x0 + 4, y)[3] ? get(x0 + 4, y) : get(x0 - 1, y);
      for (let k = 0; k < 4; k++) set(x0 + k, y, b[3] ? b : CLEAR);
    }
    // (the putt goes up or down the screen: the putter swings that way, the hands with it a little)
    const along = u[1] * s;
    gx = 16; gy = ys + n - 1 + Math.round(along * 1.5);
    lay(arm, x0, x0 - 2, 4, gx - 1, gy);
    hands = [[arm, n, gy]];
    // the far hand, just above the near one on the grip (the rest of that arm is behind them)
    const hd = arm[n - 1].find((v) => v[3]) ?? CLEAR;
    if (hd[3]) { const lo: RGBA = [Math.round(hd[0] * 0.82), Math.round(hd[1] * 0.82), Math.round(hd[2] * 0.82), 255]; for (const [x, y] of [[gx - 1, gy - 2], [gx, gy - 2], [gx + 1, gy - 2]]) if (!isArm.has(y * W_ + x)) set(x, y, lo); }
    const bx = right ? 2 * (ox + B / 2) - ballXY[0] : ballXY[0];        // (drawn facing left, then turned round)
    hx = Math.round(bx - ox + (right ? -u[0] : u[0]) * s * 3);
    hy = Math.round(ballXY[1] - oy - u[1] * 2.4 + along * 4);
  }
  // a little shadow under each forearm where it crosses them, so an arm shows against a top of its own colour
  for (const [x, y] of shadow) {
    if (isArm.has(y * W_ + x)) continue;
    const e = get(x, y);
    if (e[3]) set(x, y, [Math.round(e[0] * 0.75 + INK[0] * 0.25), Math.round(e[1] * 0.75 + INK[1] * 0.25), Math.round(e[2] * 0.75 + INK[2] * 0.25), 255]);
  }
  // the outline back on, as the sheets draw it, below the shoulders (above them it was never taken off)
  const bare = new Uint8ClampedArray(dots);
  const was = (x: number, y: number) => (x < 0 || y < 0 || x >= W_ || y >= H_ ? 0 : bare[(y * W_ + x) * 4 + 3]);
  for (let y = ys - 3; y < H_; y++) for (let x = 0; x < W_; x++) {
    if (was(x, y)) continue;
    for (const [dx, dy] of NEXT) if (was(x + dx, y + dy)) { const i = ((y + dy) * W_ + x + dx) * 4; set(x, y, edgeOf([bare[i], bare[i + 1], bare[i + 2], 255])); break; }
  }
  // onto the canvas, dot for dot: the frame at their feet
  const g = comp.getContext('2d', { willReadFrequently: true })!;
  g.clearRect(0, 0, B, B);
  g.putImageData(new ImageData(dots, W_, H_), fx, fy);
  // the putter: the shaft from the hands to the head, steel with a dark side, black at the grip
  const ax = fx + gx, ay = fy + gy + 1;
  const steps = Math.max(Math.abs(hx - ax), Math.abs(hy - ay)) || 1;
  for (let i = 0; i <= steps; i++) {
    const x = Math.round(ax + ((hx - ax) * i) / steps), y = Math.round(ay + ((hy - ay) * i) / steps);
    g.fillStyle = i < 3 ? '#16161a' : '#c8ccd6'; g.fillRect(x, y, 1, 1);
    if (i >= 3) { g.fillStyle = '#3a3e48'; g.fillRect(x + 1, y, 1, 1); }
  }
  // the head: a blade in their own colour (the colour of their ball: whose putter it is, at a glance) across the end of
  // the shaft, the shaft into its heel and the toe pointing away from them, lit along its top, dark along its sole,
  // outlined, a glint toward the toe, its shadow on the turf, and a black ferrule where the shaft goes in
  const toe = side ? -1 : hx >= ax ? 1 : -1, len = 5;
  const bx0 = toe > 0 ? hx - 1 : hx - len + 2;
  g.fillStyle = 'rgba(10,30,14,0.45)'; g.fillRect(bx0 + 1, hy + 2, len, 1);
  g.fillStyle = '#1e2026'; g.fillRect(bx0 - 1, hy - 1, len + 2, 4);
  const col = /^#[0-9a-f]{6}$/i.test(color) ? color : '#c8ccd6';
  const toward = (to: number, k: number) => `rgb(${[1, 3, 5].map((i) => Math.round(parseInt(col.slice(i, i + 2), 16) * (1 - k) + to * k)).join(',')})`;
  g.fillStyle = toward(0, 0.3); g.fillRect(bx0, hy, len, 2);
  g.fillStyle = col; g.fillRect(bx0, hy, len, 1);
  g.fillStyle = toward(255, 0.45); g.fillRect(bx0, hy, len - 1, 1);
  g.fillStyle = '#eef0f4'; g.fillRect(toe > 0 ? bx0 + len - 2 : bx0 + 1, hy, 1, 1);
  g.fillStyle = '#16161a'; g.fillRect(hx, hy - 2, 1, 2);
  // the hands over the top of the grip again (the last two rows of each arm): their outlines first, then the hands
  const tops = hands.map(([arm, rows, ey]) => ({ hand2: arm.slice(rows - 2), x0: fx + gx - 1, y0: fy + ey - 1, w: Math.min(arm[0].length, 3) }));
  for (const { hand2, x0, y0, w } of tops) {
    const lit = hand2.flat().find((v) => v[3]);
    if (!lit) continue;
    g.fillStyle = `rgb(${edgeOf(lit).slice(0, 3).join(',')})`;
    g.fillRect(x0 - 1, y0, 1, 2); g.fillRect(x0 + w, y0, 1, 2); g.fillRect(x0, y0 + 2, w, 1);
  }
  for (const { hand2, x0, y0, w } of tops) for (let i = 0; i < 2; i++) for (let k = 0; k < w; k++) {
    const v = hand2[i][k];
    if (v[3]) { g.fillStyle = `rgb(${v[0]},${v[1]},${v[2]})`; g.fillRect(x0 + k, y0 + i, 1, 1); }
  }
  c.clearRect(0, 0, c.canvas.width, c.canvas.height);
  c.imageSmoothingEnabled = false;
  if (side && right) { c.save(); c.translate(B * K, 0); c.scale(-1, 1); c.drawImage(comp, 0, 0, B * K, B * K); c.restore(); }
  else c.drawImage(comp, 0, 0, B * K, B * K);
  return true;
}

/** The players kept out of sight just now (not up), shown again after. */
const away = new Set<HTMLElement>();
/** The sprite hidden just now while the golfer is drawn in its place (one at a time), shown again after. */
let hidden: HTMLElement | null = null;
function hide(el: HTMLElement | undefined) {
  const sp = (el?.firstElementChild as HTMLElement | null) ?? null;
  if (sp === hidden) return;
  if (hidden) hidden.style.visibility = '';
  hidden = sp;
  if (sp) sp.style.visibility = 'hidden';
}

// ───────────────────────── the scene ─────────────────────────
const DUSK_OVER = 3;
const box = (r: number[]): CSSProperties => ({ left: r[0], top: r[1], width: r[2], height: r[3] });

export function Room({ layout, mini }: FitProps) {
  listen();
  const gt = layout.things.golf as GolfThings;
  const here = gt.holes.map((h) => h.n);
  const g = useGolf();
  const me = useStore((s) => s.me?.id ?? '');
  const myFloor = useStore((s) => (s.me ? s.presence[s.me.id]?.floor ?? '' : ''));
  const roll = useLocal((s) => s.roll);
  const card = useLocal((s) => s.card);
  const wx = useOutdoorWeather();
  const [light, setLight] = useState(() => daylight(new Date()));
  useEffect(() => { const l = window.setInterval(() => setLight(daylight(new Date())), 30_000); return () => window.clearInterval(l); }, []);
  const ground = useRef<HTMLCanvasElement>(null), air = useRef<HTMLCanvasElement>(null), sailC = useRef<HTMLCanvasElement>(null), club = useRef<HTMLCanvasElement>(null);
  const flags = useRef<(HTMLCanvasElement | null)[]>([]);
  const at = g ? g.players.indexOf(me) : -1;
  const on = !!g?.on && !g.over;
  const n = g ? Math.max(0, Math.min(g.hole, HOLES.length - 1)) : 0;
  const hole = HOLES[n];
  const playingHere = on && sceneOf(n) === layout.id;
  const myBall = on && at >= 0 ? lies(g!, at) : null;
  const myTurn = on && at >= 0 && g!.turn === at && !g!.done[at] && !roll;
  const down = !mini && myFloor === layout.id;
  // watching (or in) a round: a word to the server now and then, so nobody stood by a hole is sent home for standing about
  useWatching(down && on ? ID : null);

  // ── me, as a player: to the kiosk while we wait to tee off, to my ball on my turn, by the hole otherwise; and on along
  //    the path when the next hole is in the next scene ──
  const sent = useRef('');
  const [, bump] = useState(0);
  useEffect(() => {
    if (!down || !g || at < 0) { sent.current = ''; return; }
    let spot: number[] | null = null;
    if (!on) {
      if (g.over || layout.id !== 'minigolf') return;
      spot = gt.lobby?.[at % (gt.lobby?.length || 1)] ?? null;
    } else if (sceneOf(n) !== layout.id) {
      const to = sceneOf(n);
      const t = window.setTimeout(() => goFloor.setState({ to }), 1400);
      return () => window.clearTimeout(t);
    } else if (myTurn && myBall) {
      const st = stanceOf(n, myBall);
      spot = [st.x, st.y];
    } else if (roll?.who === me) {
      return;                                             // (stay for the follow-through and to watch it go)
    } else {
      spot = waitSpot(n, at);                             // by the hole, out of the way (and out of sight)
    }
    if (!spot) return;
    const key = `${spot[0]},${spot[1]}`;
    if (sent.current === key) return;
    sent.current = key;
    send({ t: 'place', place: 'here', x: spot[0], y: spot[1] });
  }, [down, g, at, on, n, myTurn, myBall?.[0], myBall?.[1], roll?.who, layout.id]);   // eslint-disable-line react-hooks/exhaustive-deps
  // the round over: the card comes up for the players
  const wasOver = useRef(false);
  useEffect(() => { if (g?.over && !wasOver.current && at >= 0 && down) useLocal.setState({ card: true }); wasOver.current = !!g?.over; }, [g?.over, at, down]);

  // ── every frame: the ground, the sails, the flags, the putter, the aim and the words ──
  const millPiece = () => {
    const m = gt.mill;
    if (!m) return null;
    const o = (layout.over as { x: number; y: number; w: number; h: number; z: number }[]).find((q) => q.z === m.z && m.hub[0] >= q.x && m.hub[0] < q.x + q.w && m.hub[1] >= q.y && m.hub[1] < q.y + q.h);
    if (!o) return null;
    const el = [...document.querySelectorAll<HTMLElement>('.club-over')].find((e) => e.style.left === `${o.x}px` && e.style.top === `${o.y}px` && e.style.zIndex === String(o.z));
    return { ...o, el };
  };
  useEffect(() => {
    if (mini) return;
    let raf = 0, airDrawn = true;
    const go = () => {
      raf = requestAnimationFrame(go);
      const g = useStore.getState().fits[ID] as Golf | undefined, r = useLocal.getState().roll;
      const now = performance.now();
      const gc = ground.current?.getContext('2d');
      if (gc) drawGround(gc, g, here, now);
      const mill = gt.mill;
      const sc = sailC.current?.getContext('2d');
      if (sc && mill) drawSails(sc, mill.n, mill.hub, mill.len, now);
      // the flags: each on its pole in the cup, flying, and jolted when a ball drops
      here.forEach((hn, j) => {
        const fc = flags.current[j]?.getContext('2d');
        if (!fc) return;
        fc.clearRect(0, 0, fc.canvas.width, fc.canvas.height);
        let jolt = 0;
        if (r && r.hole === hn) for (const q of [r, ...r.knocked]) if (q.result === 'holed') { const el = (now - r.start) / r.ms - (q.path.length - 1); if (el > 0) jolt = Math.max(jolt, 1 - (el * r.ms) / 700); }
        const wave = Math.sin(now / 260 + hn) * 0.8, shake = jolt > 0 ? Math.sin(now / 30) * jolt * 1.2 : 0;
        fc.fillStyle = '#e8e2d0'; dot(fc, 4 + shake, 2, 0.67, 18);
        fc.fillStyle = '#8a8478'; dot(fc, 4.67 + shake, 2, 0.33, 18);
        fc.fillStyle = FLAG[hn];
        fc.beginPath(); fc.moveTo((4.6 + shake) * K, 2 * K); fc.lineTo((11 + shake) * K, (4 + wave) * K); fc.lineTo((4.6 + shake) * K, 6.6 * K); fc.fill();
        fc.fillStyle = 'rgba(255,255,255,0.35)'; dot(fc, 5 + shake, 2.6, 2, 0.67);
      });
      // the putter, over whoever is at their ball
      const cc = club.current, ctx = cc?.getContext('2d');
      const p = putter(g);
      if (cc && ctx) {
        const d = p ? drawn.get(p.uid) : undefined;
        if (!p || !d || sceneOf(p.n) !== layout.id || !atBall(p.uid, p.n, p.ball)) { hide(undefined); if (cc.style.display !== 'none') cc.style.display = 'none'; }
        else {
          const st = stanceOf(p.n, p.ball), bxy = [sx(p.n, p.ball[0]), sy(p.n, p.ball[1])];
          let u = [st.ux, st.uy], s = 0;
          const sw = useLocal.getState().swing;
          if (sw && sw.who === p.uid && now - sw.at < 1200) {
            const k = Math.min(1, (now - sw.at) / STRIKE_MS);
            s = k < 1 ? sw.from + (1 - sw.from) * k * k : 1 - Math.max(0, (now - sw.at - 700) / 500);
          } else if (aim.on && p.uid === useStore.getState().me?.id) {
            const dx = aim.x - aim.x0, dy = aim.y - aim.y0, pull = Math.hypot(dx, dy);
            if (pull > 2) { u = [-dx / pull, -dy / pull]; s = -Math.min(1, pull / PULL); }
          }
          if (sw && sw.who === p.uid && r) { const dx = r.path[Math.min(3, r.path.length - 1)][0] - r.path[0][0], dy = r.path[Math.min(3, r.path.length - 1)][1] - r.path[0][1], l = Math.hypot(dx, dy); if (l > 0.01) u = [dx / l, dy / l]; }
          // (facing whichever way the putt goes just now: the way the drag points, as it changes, or the way the ball went)
          const ft = feetFor(bxy[0], bxy[1], u[0], u[1]);
          const fx = ft.x, fy = ft.y, ox = fx - B / 2, oy = fy - B + 12;
          const ok = drawGolfer(ctx, p.uid, ox, oy, fx, fy, bxy, u, s, ft.side, ft.right);
          hide(ok ? d.el : undefined);
          cc.style.display = ok ? '' : 'none';
          cc.style.left = `${ox}px`; cc.style.top = `${oy}px`; cc.style.zIndex = String(fy + 1);
        }
      }
      // in a round here, only whoever is up is to be seen; and the windmill seen through, while they or their ball are
      // behind it
      const up = sceneOf(g?.hole ?? 0) === layout.id ? upNow(g) : '';
      const gone = new Set<HTMLElement>();
      if (up && g) for (const id of g.players) { const el = drawn.get(id)?.el; if (id !== up && el) gone.add(el); }
      for (const el of away) if (!gone.has(el)) { el.style.visibility = ''; away.delete(el); }
      for (const el of gone) if (!away.has(el)) { el.style.visibility = 'hidden'; away.add(el); }
      if (mill) {
        const piece = millPiece();
        let behind = false;
        if (piece && p && p.n === mill.n && sceneOf(p.n) === layout.id) {
          const d = drawn.get(p.uid), b = [sx(p.n, p.ball[0]), sy(p.n, p.ball[1])];
          const under = (x: number, y: number, h: number) => x > piece.x - 6 && x < piece.x + piece.w + 6 && y < mill.z + 2 && y > piece.y - h;
          behind = under(b[0], b[1], 2) || (!!d && under(d.x, d.y, 10));
        }
        if (piece?.el) { const o = behind ? '0.35' : ''; if (piece.el.style.opacity !== o) { piece.el.style.opacity = o; if (sailC.current) sailC.current.style.opacity = o; } }
      }
      // the aim, the meter and the moments (drawn afresh only while there is something to draw)
      const ac = air.current?.getContext('2d');
      if (!ac) return;
      const busy = !!r || aim.on || !!(g && g.on && !g.over);
      if (!busy && !airDrawn) return;
      airDrawn = busy;
      ac.clearRect(0, 0, ac.canvas.width, ac.canvas.height);
      const meId = useStore.getState().me?.id ?? '';
      const k = g ? g.players.indexOf(meId) : -1;
      const mine = g && k >= 0 && g.on && !g.over && g.turn === k && !r ? lies(g, k) : null;
      if (mine && g && sceneOf(g.hole) === layout.id) {
        const bx = sx(g.hole, mine[0]), by = sy(g.hole, mine[1]);
        if (aim.on) {
          const dx = aim.x - aim.x0, dy = aim.y - aim.y0, pull = Math.min(PULL, Math.hypot(dx, dy));
          if (pull > 2) {
            const ux = -dx / Math.hypot(dx, dy), uy = -dy / Math.hypot(dx, dy);
            ac.fillStyle = 'rgba(255,255,240,0.9)';
            for (let q = 4; q < 20; q += 3) dot(ac, bx + ux * q - 0.33, by + uy * q - 0.33, 0.67, 0.67);
            // the meter, upright beside me: it fills with the pull, and has no marks on it
            const mx = bx + (bx > 470 ? -20 : 14), my = by - 34;
            ac.fillStyle = '#1a1228'; dot(ac, mx - 1, my - 1, 5, 26);
            ac.fillStyle = '#3a3448'; dot(ac, mx, my, 3, 24);
            const f = pull / PULL, hgt = 24 * f;
            ac.fillStyle = f < 0.55 ? '#5ad06a' : f < 0.85 ? '#f2c230' : '#ff5a4d';
            dot(ac, mx, my + 24 - hgt, 3, hgt);
          }
        } else if (atBall(meId, g.hole, mine)) {
          // my turn and I am at my ball: a ring round it, breathing
          const a = 0.5 + 0.5 * Math.sin(now / 300);
          disc(ac, bx, by, 4 + a); ac.strokeStyle = `rgba(255,246,200,${0.4 + 0.4 * a})`; ac.lineWidth = 0.6 * K; ac.stroke();
        }
      }
      if (r && g && sceneOf(r.hole) === layout.id) {
        const el = (now - r.start) / r.ms, X = (x: number) => sx(r.hole, x), Y = (y: number) => sy(r.hole, y), h = HOLES[r.hole];
        if (r.lipAt >= 0 && el >= r.lipAt) { const age = ((el - r.lipAt) * r.ms) / 1100; caption(ac, 'lip out!', X(h.cup[0]), Y(h.cup[1]) - 22 - age * 4, 1.4 - age * 1.4, '#ffb0a0'); }
        for (const q of [r, ...r.knocked]) {
          const last = q.path.length - 1;
          if (q !== r) {
            const i = q.path.findIndex((pt) => pt[0] !== q.path[0][0] || pt[1] !== q.path[0][1]), age = i > 0 ? ((el - i) * r.ms) / 600 : -1;
            if (age >= 0 && age < 1) caption(ac, 'clack!', X(q.path[0][0]), Y(q.path[0][1]) - 6 - age * 5, 1 - age);
          }
          for (let i = 1; i <= Math.min(last, Math.floor(el)); i++) {
            const a = q.path[i - 1], b = q.path[i];
            if ((a[2] ?? 0) < 0 && (b[2] ?? 0) >= 0) { const age = ((el - i) * r.ms) / 500; if (age < 1) caption(ac, 'pop!', X(b[0]), Y(b[1]) - 6 - age * 5, 1 - age); }
          }
          if (q.result === 'water' && el >= last) {
            const [x, y] = q.path[last], age = ((el - last) * r.ms) / 600;
            for (const dd of [0, 0.25]) { const a2 = age - dd; if (a2 > 0 && a2 < 1) { ac.beginPath(); ac.ellipse(X(x) * K, Y(y) * K, (1.5 + a2 * 6) * K, (1 + a2 * 3.5) * K, 0, 0, Math.PI * 2); ac.strokeStyle = `rgba(220,240,255,${0.8 * (1 - a2)})`; ac.lineWidth = 0.5 * K; ac.stroke(); } }
            caption(ac, 'splash', X(x), Y(y) - 6 - age * 4, 1.3 - age, '#bfe4ff');
          }
          if (q.result === 'holed' && el >= last) {
            const age = ((el - last) * r.ms) / 1000;
            if (age < 1) { disc(ac, X(h.cup[0]), Y(h.cup[1]), 3.5 + age * 7); ac.strokeStyle = `rgba(255,246,216,${0.7 * (1 - age)})`; ac.lineWidth = 0.6 * K; ac.stroke(); }
            const s = g.strokes[g.players.indexOf(q.who)]?.[r.hole] ?? 0;
            const word = q !== r ? 'knocked in!' : s === 0 ? 'hole in one!' : 'plunk!';
            caption(ac, word, X(h.cup[0]), Y(h.cup[1]) - 24 - Math.min(1, age) * 4, 1.8 - age * 0.9, s === 0 && q === r ? '#ffe14a' : '#fff6d8');
          }
        }
      }
    };
    raf = requestAnimationFrame(go);
    return () => { cancelAnimationFrame(raf); hide(undefined); for (const el of away) el.style.visibility = ''; away.clear(); const pc = millPiece(); if (pc?.el) pc.el.style.opacity = ''; };
  }, [mini, layout.id]);   // eslint-disable-line react-hooks/exhaustive-deps

  // ── my putt: press on (or near) my ball, drag back, let go ──
  const myXY = myTurn && myBall && playingHere ? [sx(n, myBall[0]), sy(n, myBall[1])] : null;
  const atMine = !!myXY && !!myBall && atBall(me, n, myBall);
  useEffect(() => {      // (until I am stood there, look again now and then: the room walks me there)
    if (!myXY || atMine) return;
    const t = window.setInterval(() => bump((v) => v + 1), 250);
    return () => window.clearInterval(t);
  }, [!!myXY, atMine]);   // eslint-disable-line react-hooks/exhaustive-deps
  const AREA = 64;
  const area = myXY ? [Math.round(myXY[0] - AREA / 2), Math.round(myXY[1] - AREA / 2), AREA, AREA] : null;
  const where = (e: ReactPointerEvent<HTMLElement>, r: number[]) => { const b = pageRect(e.currentTarget); return { x: r[0] + ((e.clientX - b.left) * r[2]) / b.width, y: r[1] + ((e.clientY - b.top) * r[3]) / b.height }; };
  const onDown = (e: ReactPointerEvent<HTMLElement>) => {
    e.stopPropagation();
    if (!area || !atMine) return;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* (still works inside) */ }
    const p = where(e, area);
    Object.assign(aim, { on: true, x0: p.x, y0: p.y, x: p.x, y: p.y });
  };
  const onMove = (e: ReactPointerEvent<HTMLElement>) => { if (aim.on && area) { const p = where(e, area); aim.x = p.x; aim.y = p.y; } };
  const onUp = () => {
    if (!aim.on) return;
    const dx = aim.x - aim.x0, dy = aim.y - aim.y0, pull = Math.hypot(dx, dy);
    if (pull < 4 || !myTurn) { aim.on = false; return; }
    send({ t: 'fit', id: ID, op: 'putt', angle: Math.atan2(-dy, -dx), power: Math.min(1, pull / PULL) });
    // (the drag is kept until the putt comes back, so the swing starts from where it was)
    window.setTimeout(() => { aim.on = false; }, 400);
  };

  if (mini) return null;
  const night = 1 - light;
  const wet = wx?.kind === 'rain' || wx?.kind === 'storm';
  const dusk = Math.min(0.8, night * 0.66 + (wet ? 0.1 : 0) + Math.max(0, (wx?.cover ?? 0.4) - 0.5) * 0.15 * light);
  const holes = layout.lights.map((l) => `radial-gradient(${l.rx * 1.1}px ${l.ry * 1.1}px at ${l.x + DUSK_OVER}px ${l.y + DUSK_OVER}px, rgba(0,0,0,0.3) 0%, rgba(0,0,0,0.5) 45%, #000 100%)`).join(', ');
  const next = layout.things.next as { to: string; rect: number[]; say: string } | undefined;
  const mill = gt.mill;
  const MILL_C = 64;
  // what the board at the top says
  const total = (k: number) => g!.strokes[k].reduce((a, b) => a + b, 0);
  const first = here[0] + 1, lastH = here[here.length - 1] + 1;
  let head = `Mini golf · holes ${first} to ${lastH}`, sub = layout.id === 'minigolf' ? 'Click the kiosk to play' : '';
  if (g && on) {
    head = `Hole ${n + 1} · ${hole.name} · par ${hole.par}`;
    sub = roll ? `${nameOf(roll.who)} putts…` : at >= 0 && g.turn === at ? (atMine || !playingHere ? (playingHere ? 'Your putt: drag back from your ball' : 'On to the next holes…') : 'Your putt: walking to your ball…') : `${nameOf(g.players[g.turn])} to putt`;
    if (!playingHere) head = `Hole ${n + 1} is ${n < here[0] ? 'back' : 'on'} along the path`;
  } else if (g?.over) {
    const tot = g.players.map((_, k) => total(k)), best = Math.min(...tot);
    head = 'That is the round'; sub = `${g.players.filter((_, k) => tot[k] === best).map(nameOf).join(' and ')} win${tot.filter((x) => x === best).length > 1 ? '' : 's'} on ${best}`;
  } else if (g && g.players.length) {
    sub = `${g.players.map(nameOf).join(', ')} ${g.players.length > 1 ? 'are' : 'is'} in. Tee off at the kiosk`;
  }
  const last = on && g?.last && !roll ? g.last : '';
  return (
    <>
      <canvas ref={ground} className="mg-layer" width={layout.w * K} height={layout.h * K} style={{ width: layout.w, height: layout.h, zIndex: 2 }} />
      {mill && <canvas ref={sailC} className="mg-layer" width={MILL_C * K} height={MILL_C * K} style={{ left: mill.hub[0] - MILL_C / 2, top: mill.hub[1] - MILL_C / 2, width: MILL_C, height: MILL_C, zIndex: mill.z + 1 }} />}
      {here.map((hn, j) => {
        const cx = sx(hn, HOLES[hn].cup[0]), cy = sy(hn, HOLES[hn].cup[1]);
        return <canvas key={hn} ref={(el) => { flags.current[j] = el; }} className="mg-layer" width={14 * K} height={22 * K} style={{ left: Math.round(cx) - 4.5, top: Math.round(cy) - 20, width: 14, height: 22, zIndex: Math.round(cy) }} />;
      })}
      <canvas ref={club} className="mg-layer" width={B * K} height={B * K} style={{ width: B, height: B, display: 'none' }} />
      <canvas ref={air} className="mg-layer" width={layout.w * K} height={layout.h * K} style={{ width: layout.w, height: layout.h, zIndex: 3400 }} />
      {/* the night, with light let through round the lamps */}
      <i className="cf-dusk" style={{ inset: -DUSK_OVER, opacity: dusk, zIndex: 2980, maskImage: holes, WebkitMaskImage: holes } as CSSProperties} />
      {night > 0.3 && layout.lights.map((l, j) => <i key={j} className="cf-glow lamp" style={{ left: l.x - l.rx * 1.2, top: l.y - l.ry * 1.2, width: l.rx * 2.4, height: l.ry * 2.4, zIndex: 2982, opacity: night * 0.6, animationDelay: `${-j * 0.37}s` }} />)}
      {/* the fountain's spray (holes 7 to 9) */}
      {gt.fountain && <i className="mg-spray" style={{ left: gt.fountain[0] - 8, top: gt.fountain[1] - 4, zIndex: gt.fountain[2] + 40 }} />}
      {/* clicks: the kiosk (the scorecard), the path on */}
      {gt.booth && <i className="cf-hot" title="The kiosk: the scorecard, join a round, tee off" style={{ ...box(gt.booth), zIndex: 2990 }} onClick={(e) => { e.stopPropagation(); useLocal.setState({ card: true }); }} />}
      {next && <i className="cf-hot" title={next.say} style={{ ...box(next.rect), zIndex: 2990 }} onClick={(e) => { e.stopPropagation(); goFloor.setState({ to: next.to }); }} />}
      {/* my putt: press on my ball and drag back */}
      {area && atMine && <i className="mg-cap" style={{ ...box(area), zIndex: 3990 }} onClick={(e) => e.stopPropagation()}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => { aim.on = false; }} />}
      {/* the board at the top: the hole, whose putt it is */}
      <div className="mg-board" style={{ zIndex: 3600 }} onClick={(e) => { e.stopPropagation(); useLocal.setState({ card: !card }); }} title="The scorecard">
        <b>{head}</b>
        {sub && <span>{sub}</span>}
        {last && <em>{last}</em>}
      </div>
      {card && <Card g={g} me={me} close={() => useLocal.setState({ card: false })} />}
    </>
  );
}

/** The scorecard, on a card in the scene: the holes and their pars, everybody's strokes, Join / Tee off / Leave. */
function Card({ g, me, close }: { g: Golf | null | undefined; me: string; close: () => void }) {
  const at = g ? g.players.indexOf(me) : -1, joined = at >= 0;
  const on = !!g?.on && !g.over;
  const total = (k: number) => g!.strokes[k]?.reduce((a, b) => a + b, 0) ?? 0;
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [close]);
  const say = !g || !g.players.length ? `Nine holes, turn about, up to six of you. Join, then tee off.`
    : g.over ? 'That is the round.' : !g.on ? `${g.players.map(nameOf).join(', ')} ${g.players.length > 1 ? 'are' : 'is'} in. Tee off when everyone is.`
      : `Hole ${g.hole + 1}: ${nameOf(g.players[g.turn])} to putt.`;
  return (
    <div className="mgs-card" style={{ zIndex: 4000 }} onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
      <div className="mgs-card-top">Scorecard</div>
      <table>
        <thead><tr><th>Hole</th>{HOLES.map((_, k) => <th key={k} className={on && g!.hole === k ? 'now' : ''}>{k + 1}</th>)}<th>Tot</th></tr></thead>
        <tbody>
          <tr className="par"><td>Par</td>{HOLES.map((h, k) => <td key={k}>{h.par}</td>)}<td>{HOLES.reduce((a, h) => a + h.par, 0)}</td></tr>
          {g?.players.map((id, k) => (
            <tr key={id} className={on && g.turn === k ? 'turn' : ''}>
              <td className="who"><i style={{ background: colorOf(id) }} />{nameOf(id)}</td>
              {HOLES.map((h, j) => { const s = g.strokes[k]?.[j] ?? 0; return <td key={j} className={!s ? '' : s < h.par ? 'under' : s > h.par ? 'over' : ''}>{s || ''}</td>; })}
              <td><b>{g.strokes[k] ? total(k) || '' : ''}</b></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>{say}</p>
      <div className="mgs-card-buttons">
        {!joined && (!on) && (g?.players.length ?? 0) < 6 && <button onClick={() => send({ t: 'fit', id: ID, op: 'join' })}>Join</button>}
        {joined && !on && <button onClick={() => { send({ t: 'fit', id: ID, op: 'start' }); close(); }}>{g!.over ? 'Play again' : 'Tee off'}</button>}
        {joined && <button onClick={() => { send({ t: 'fit', id: ID, op: 'leave' }); send({ t: 'place', place: '' }); close(); }}>Leave</button>}
        <button onClick={close}>Close</button>
      </div>
    </div>
  );
}
