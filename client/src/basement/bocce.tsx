// Bocce on the page (server/basement/bocce.ts keeps the game; bocce.ts the measures and the rolls). Played on the lawn
// between the horseshoe pits, the court marked only by four pegs at its corners; the balls and the pallino are drawn
// here over the grass (which plays no part: every ball rolls on it alike), and the balls not in play sit in the set's
// wooden case on the grass below the lawn (red and green, and the white pallino). A click on the case opens it large: the whole court along the top, and close up
// round the pallino below. On your turn: press anywhere, drag back away from the far end and let go: the ball is lobbed
// a little way and rolls on. The line says which way, not how far; the strength shakes past half. Joining a side walks
// you to the end that is throwing (it changes every frame).
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { hooks, send, useStore } from '../store';
import { hush, useWatching } from './sound';
import { ahead, BALLS, CX, CY, HALF_V, LONG, pathAt, PR, R, release, roomX, roomY, SIDE_COLORS, SIDES, standing, thrower } from './bocce.ts';
import { LAYOUT } from './backyard.gen.ts';
import type { Ball, Game, Roll } from './bocce.ts';
import { inSides } from './yardgames.ts';
import { banner, drawAim, drawPull, Frame, kit, lit, markThrow, nameOf, standsAt, thrower as throwPose, useDrag, useTicker, useWalkTo } from './yardkit.tsx';
import type { FitPose } from './index';

const ID = 'bocce';
type Flight = { who: string; team: number; pallino: boolean; roll: Roll; after: Game; before: Game; t0: number };
const useLocal = create<{ open: boolean; flight: Flight | null; light: number }>()(() => ({ open: false, flight: null, light: 1 }));
export const setOpen = (open: boolean) => useLocal.setState({ open });
useLocal.subscribe((s, p) => { if (p.open && !s.open) hush(ID); });
const useGame = () => useStore((s) => s.fits[ID] as Game | null | undefined);
const RED = [200, 54, 40], GREEN = [52, 150, 58], PAL = [244, 242, 232];

hooks.fit.push((d) => {
  if (d.id !== ID || d.op !== 'roll') return;
  const before = useStore.getState().fits[ID] as Game | undefined;
  if (!before) return;
  const f: Flight = { who: String(d.who ?? ''), team: Number(d.team), pallino: !!d.pallino, roll: d.roll as Roll, after: d.after as Game, before, t0: performance.now() };
  markThrow(f.who);
  useLocal.setState({ flight: f });
  sound(f);
  window.setTimeout(() => {
    if (useLocal.getState().flight !== f) return;
    useLocal.setState({ flight: null });
    useStore.setState((s) => ({ fits: { ...s.fits, [ID]: f.after } }));
  }, f.roll.air + f.roll.ms + 60);
});

type Seen = { u: number; v: number; team: number };   // team -1: the pallino
/** The pallino and the balls just now, and the one in the air (lobbed, before it rolls). */
function ballsNow(g: Game | null | undefined, t: number) {
  const f = useLocal.getState().flight;
  const list = (p: Game['pallino'], balls: Ball[]): Seen[] => [...(p ? [{ u: p.u, v: p.v, team: -1 }] : []), ...balls.filter((b) => !b.out).map((b) => ({ u: b.u, v: b.v, team: b.team }))];
  if (!f) return { seen: g ? list(g.pallino, g.balls) : [], air: null };
  const el = t - f.t0, rel = el - f.roll.air;
  const thrown = f.pallino ? -1 : f.before.balls.length;
  const seen: Seen[] = [];
  const pathOf = (i: number) => f.roll.paths.find((p) => p.i === i);
  const at = (i: number, u: number, v: number, team: number) => {
    const p = pathOf(i);
    if (!p) { seen.push({ u, v, team }); return; }
    if (i === thrown && rel < 0) return;
    const [pu, pv] = pathAt(p, rel);
    if (p.out && rel >= (p.pts.length / 2 - 1) * (1000 / 30)) return;
    seen.push({ u: pu, v: pv, team });
  };
  if (f.before.pallino) at(-1, f.before.pallino.u, f.before.pallino.v, -1);
  else if (f.pallino) at(-1, 0, 0, -1);
  f.before.balls.forEach((b, i) => { if (!b.out) at(i, b.u, b.v, b.team); });
  if (!f.pallino) at(thrown, 0, 0, f.team);
  let air = null;
  if (rel < 0) {
    const p = pathOf(thrown);
    if (p) {
      const k = el / f.roll.air, [u0, v0] = f.roll.from, u1 = p.pts[0], v1 = p.pts[1];
      air = { u: u0 + (u1 - u0) * k, v: v0 + (v1 - v0) * k, h: 1.5 * (1 - k) + f.roll.apex * 4 * k * (1 - k), team: f.pallino ? -1 : f.team };
    }
  }
  return { seen, air };
}

export function pose(uid: string): FitPose | null {
  const g = useStore.getState().fits[ID] as Game | undefined;
  const at = g ? standing(g, uid) : null;
  if (!g || !at || !standsAt(uid, at[0], at[1])) return null;
  return throwPose(uid, g.end === 0 ? 'right' : 'left', ID);
}

// ── in the yard: the balls on the grass, the pegs at the court's corners, the caddy ──
const GX = CX - 4, GY = Math.floor(roomY(-HALF_V)) - 3, GW = LONG * 8 + 8, GH = Math.ceil(HALF_V * 16) + 6;
/** The set's case on the grass below the lawn (x, y, w, h): the yard's picture says where (scripts/basement/backyard.py
 *  BOCCE_SET), and keeps people from walking through it. */
const CADDY = LAYOUT.things.bocceSet;
function drawCourt(c: CanvasRenderingContext2D, seen: Seen[], light: number) {
  c.clearRect(0, 0, GW, GH);
  for (const [u, v] of [[0, -HALF_V], [LONG, -HALF_V], [0, HALF_V], [LONG, HALF_V]]) {           // the pegs
    const x = Math.round(roomX(u) - GX), y = Math.round(roomY(v) - GY);
    c.fillStyle = 'rgba(0,0,0,0.3)'; c.fillRect(x, y + 1, 2, 1);
    c.fillStyle = lit([236, 232, 220], light); c.fillRect(x, y - 1, 1, 2);
  }
  for (const b of seen.slice().sort((p, q) => p.v - q.v)) {
    const x = Math.round(roomX(b.u) - GX), y = Math.round(roomY(b.v) - GY);
    if (b.team < 0) { c.fillStyle = lit(PAL, light); c.fillRect(x, y, 1, 1); c.fillStyle = 'rgba(0,0,0,0.35)'; c.fillRect(x, y + 1, 1, 1); continue; }
    const col = b.team === 0 ? RED : GREEN;
    c.fillStyle = 'rgba(0,0,0,0.3)'; c.fillRect(x - 1, y + 1, 3, 1);
    c.fillStyle = lit(col, light, 0.7); c.fillRect(x - 1, y - 1, 3, 2);
    c.fillStyle = lit(col, light, 1.15); c.fillRect(x - 1, y - 1, 2, 1);
  }
}
/** A ball as it lies in its case, `d` dots across: a sphere lit from the top left (four tones and a glint), or, if it
 *  is out on the court, the empty hollow it sits in. */
function sphere(c: CanvasRenderingContext2D, x0: number, y0: number, d: number, col: number[] | null, light: number) {
  const r = d / 2, cx = x0 + r, cy = y0 + r;
  for (let y = 0; y < d; y++) for (let x = 0; x < d; x++) {
    const nx = (x + 0.5 - r) / r, ny = (y + 0.5 - r) / r, q = nx * nx + ny * ny;
    if (q > 1.08) continue;
    if (!col) {                                                                                  // the hollow: dark, its near lip lit
      c.fillStyle = lit(ny > 0.45 ? [70, 58, 50] : ny < -0.2 ? [14, 12, 14] : [24, 20, 22], light);
      c.fillRect(x0 + x, y0 + y, 1, 1);
      continue;
    }
    const nz = Math.sqrt(Math.max(0, 1 - Math.min(1, q)));
    const k = Math.max(0, -nx * 0.5 - ny * 0.62 + nz * 0.6);                                     // the light, from the top left
    const m = q > 0.8 && nx + ny > 0.2 ? 0.48 : k > 0.86 ? 1.32 : k > 0.6 ? 1.08 : k > 0.3 ? 0.86 : 0.66;
    c.fillStyle = lit(col, light, m); c.fillRect(x0 + x, y0 + y, 1, 1);
  }
  if (col) {
    c.fillStyle = lit([255, 255, 250], light); c.fillRect(Math.floor(cx - r * 0.45), Math.floor(cy - r * 0.5), 1, 1);   // the glint
    if (d >= 6) { c.fillStyle = lit(col, light, 0.75); c.fillRect(Math.floor(cx) - 1, Math.floor(cy + r * 0.35), 3, 1); }  // a scored band
  }
}
/** The bocce set, open on the grass: a varnished oak case with its lid standing open behind (a brass hinge each side, a
 *  leather strap across it), lined in black foam: the four red balls in the back row, the four green in front, and the
 *  white pallino in its own pocket at the right. Balls out on the court leave their hollows empty. */
function drawCaddy(c: CanvasRenderingContext2D, red: number, green: number, pallino: boolean, light: number) {
  const [, , w, h] = CADDY;
  const fill = (col: number[], x: number, y: number, ww: number, hh: number, m = 1) => { c.fillStyle = lit(col, light, m); c.fillRect(x, y, ww, hh); };
  const OL = [40, 26, 18], OAK = [168, 112, 62], OAK_HI = [206, 150, 90], OAK_LO = [118, 74, 38], FOAM = [34, 30, 34];
  c.clearRect(0, 0, w, h);
  // the lid, open and leaning back: its inside face, a panel framed in the oak, the strap across it
  fill(OL, 2, 0, w - 4, 8);
  fill(OAK_LO, 3, 1, w - 6, 6);
  fill(OAK, 4, 1, w - 8, 1, 1.1);
  fill([100, 62, 32], 6, 2, w - 12, 4);                                                          // its inside, darker
  for (let x = 8; x < w - 8; x += 7) fill([86, 52, 26], x, 2, 1, 4);                              // the boards of it
  fill([70, 40, 24], Math.floor(w / 2) - 6, 3, 12, 2); fill([110, 66, 36], Math.floor(w / 2) - 6, 3, 12, 1);   // the strap
  // the case: its back rim, then the foam inside, then the front
  const ty = 8, fy = h - 6;
  fill(OL, 0, ty - 1, w, h - ty + 1);
  fill(OAK, 1, ty, w - 2, 2); fill(OAK_HI, 1, ty, w - 2, 1);                                     // the back rim, lit
  for (const hx of [6, w - 9]) { fill([226, 186, 92], hx, ty - 1, 3, 2); fill([150, 110, 40], hx, ty, 3, 1); }   // the hinges
  fill(OAK_LO, 1, ty + 2, 2, fy - ty - 2); fill(OAK_LO, w - 3, ty + 2, 2, fy - ty - 2);           // its ends
  fill(OAK, 1, ty + 2, 1, fy - ty - 2, 1.1);
  fill(FOAM, 3, ty + 2, w - 6, fy - ty - 2);
  fill([22, 20, 24], 3, ty + 2, w - 6, 1);                                                        // (the shade under the back rim)
  const D = 6, gap = 2, bx0 = 5, slot = bx0 + 4 * D + 3 * gap + 2;
  fill(OAK_LO, slot - 1, ty + 2, 1, fy - ty - 2);                                                 // the divider, the pallino's pocket beyond
  for (let k = 0; k < 4; k++) {
    sphere(c, bx0 + k * (D + gap), ty + 3, D, k < red ? RED : null, light);
    sphere(c, bx0 + k * (D + gap), ty + 3 + D + 1, D, k < green ? GREEN : null, light);
  }
  sphere(c, slot + 1, ty + 2 + D, 4, pallino ? PAL : null, light);
  // the front: the rim along its top, the boards, a brass catch in the middle
  fill(OAK_HI, 1, fy, w - 2, 1);
  fill(OAK, 1, fy + 1, w - 2, 4);
  fill(OAK, 1, fy + 1, w - 2, 1, 1.12);
  fill(OAK_LO, 1, fy + 3, w - 2, 1);
  fill(OL, Math.floor(w / 2) - 2, fy, 4, 4); fill([226, 186, 92], Math.floor(w / 2) - 1, fy + 1, 2, 2); fill([255, 230, 150], Math.floor(w / 2) - 1, fy + 1, 1, 1);
  for (const x of [1, w - 2]) fill([92, 56, 28], x, fy + 1, 1, 4);
}

export function BocceRoom({ mini, light }: { mini: boolean; light: number }) {
  const g = useGame();
  const open = useLocal((s) => s.open);
  const me = useStore((s) => s.me?.id);
  const court = useRef<HTMLCanvasElement>(null), caddy = useRef<HTMLCanvasElement>(null);
  const air = useRef<HTMLElement>(null), shadow = useRef<HTMLElement>(null);
  useEffect(() => { useLocal.setState({ light }); }, [light]);
  useWatching(open && g?.on && !g.over && !inSides(g, me) ? ID : null);
  useWalkTo(g && me ? standing(g, me) : null);
  const lastKey = useRef('');
  useTicker((t) => {
    const { seen, air: a } = ballsNow(g, t);
    const key = `${seen.map((b) => `${b.u.toFixed(2)},${b.v.toFixed(2)}`).join('|')}${light.toFixed(2)}`;
    if (key !== lastKey.current) {
      lastKey.current = key;
      const c = court.current?.getContext('2d'); if (c) drawCourt(c, seen, light);
      const k = caddy.current?.getContext('2d');
      if (k) { const on = seen.filter((b) => b.team >= 0); drawCaddy(k, BALLS - on.filter((b) => b.team === 0).length, BALLS - on.filter((b) => b.team === 1).length, !seen.some((b) => b.team < 0) && !a, light); }
    }
    const el = air.current, sh = shadow.current;
    if (el && sh) {
      el.style.display = sh.style.display = a ? 'block' : 'none';
      if (a) {
        el.style.left = `${roomX(a.u) - 1.5}px`; el.style.top = `${roomY(a.v) - a.h * 3.3 - 1.5}px`;
        el.style.background = a.team < 0 ? lit(PAL, light) : lit(a.team === 0 ? RED : GREEN, light);
        sh.style.left = `${roomX(a.u) - 1.5}px`; sh.style.top = `${roomY(a.v)}px`;
      }
    }
  }, [g, light]);
  const say = !g || (!g.on && !g.over) ? 'Bocce: click to play or watch' : g.over ? `Bocce: ${g.last}` : `Bocce: ${SIDES[0]} ${g.score[0]}, ${SIDES[1]} ${g.score[1]}`;
  return (
    <>
      <canvas ref={court} className="yg-layer" width={GW} height={GH} style={{ left: GX, top: GY, width: GW, height: GH, zIndex: 3 }} />
      <canvas ref={caddy} className="yg-layer" width={CADDY[2]} height={CADDY[3]} style={{ left: CADDY[0], top: CADDY[1], width: CADDY[2], height: CADDY[3], zIndex: CADDY[1] + CADDY[3] }} />
      <i ref={shadow} className="yg-shadow" style={{ zIndex: 2969, display: 'none' }} />
      <i ref={air} className="yg-air boc" style={{ zIndex: 2970, display: 'none' }} />
      {!mini && <i className="cf-hot" title={say} style={{ left: CADDY[0] - 2, top: CADDY[1] - 2, width: CADDY[2] + 4, height: CADDY[3] + 4, zIndex: 2990 }} onClick={(e) => { e.stopPropagation(); useLocal.setState({ open: true }); }} />}
      {open && !mini && createPortal(<Overlay />, document.querySelector('.main-view') ?? document.body)}
    </>
  );
}

// ── large: the whole court along the top, and close up round the pallino ──
const W = 1000, H = 560, STRIP = 270, ZK = 64;
let K = 26, U0 = -2, V0 = -5.2, OY = 0;
const X = (u: number) => (u - U0) * K, Y = (v: number) => OY + (v - V0) * K;
const strip = () => { K = W / (LONG + 4); U0 = -2; V0 = -STRIP / 2 / K; OY = 0; };
const zoom = (p: { u: number; v: number } | null) => { const c = p ?? { u: LONG / 2, v: 0 }; K = ZK; U0 = c.u - W / 2 / ZK; V0 = c.v - (H - STRIP - 8) / 2 / ZK; OY = STRIP + 8; };

let lawn: HTMLCanvasElement | null = null, lawnLight = -1;
function lawnFor(light: number) {
  if (lawn && Math.abs(lawnLight - light) < 0.05) return lawn;
  lawnLight = light;
  lawn = document.createElement('canvas'); lawn.width = W; lawn.height = H;
  const c = lawn.getContext('2d')!;
  c.fillStyle = lit([66, 126, 52], light); c.fillRect(0, 0, W, H);
  let n = 13; const r = () => ((n = (n * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < 10000; k++) {
    const x = r() * W, y = r() * H, a = r() * Math.PI * 2, l = 2 + r() * 4, q = r();
    c.strokeStyle = lit(q < 0.33 ? [44, 92, 36] : q < 0.7 ? [86, 150, 60] : [126, 184, 84], light);
    c.lineWidth = 1; c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); c.stroke();
  }
  return lawn;
}
function drawBallBig(c: CanvasRenderingContext2D, b: Seen, h: number, light: number) {
  const pal = b.team < 0, r = (pal ? PR : R) * K * (1 + h * 0.08), col = pal ? PAL : b.team === 0 ? RED : GREEN;
  c.fillStyle = 'rgba(0,0,0,0.32)'; c.beginPath(); c.ellipse(X(b.u) + 2 + h * 5, Y(b.v) + 3 + h * 6, r, r * 0.8, 0, 0, Math.PI * 2); c.fill();
  const x = X(b.u), y = Y(b.v) - h * K * 0.15;
  const gr = c.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
  gr.addColorStop(0, lit(col, light, 1.35)); gr.addColorStop(0.6, lit(col, light)); gr.addColorStop(1, lit(col, light, 0.6));
  c.fillStyle = gr; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
  if (!pal) { c.strokeStyle = `rgba(255,255,255,${0.25 * (0.4 + 0.6 * light)})`; c.lineWidth = 1; c.beginPath(); c.arc(x, y, r * 0.6, 0.3, 2.2); c.stroke(); }   // its scored band
}

function Overlay() {
  const g = useGame();
  const me = useStore((s) => s.me?.id);
  const flight = useLocal((s) => s.flight);
  const light = useLocal((s) => s.light);
  const ref = useRef<HTMLCanvasElement>(null);
  const close = () => useLocal.setState({ open: false });
  const shown = flight?.after ?? g;
  const side = !g ? 0 : g.phase === 'pallino' ? (g.tries === 1 ? 1 - g.first : g.first) : g.turn;
  const myTurn = !!g && g.on && !g.over && !flight && !!me && thrower(g, side) === me && !g.hold && (g.phase === 'pallino' || (!!g.pallino && g.thrown[side] < BALLS));
  const e = g?.end ?? 0;
  const k = g ? Math.max(0, g.phase === 'pallino' ? g.teams[side].indexOf(me ?? '') : g.teams[side].length === 2 ? g.thrown[side] % 2 : 0) : 0;
  const { drag, pull, handlers } = useDrag({ W, H, mine: myTurn, game: ID, fwd: ahead(e), max: 0.45, swayK: 0.006, onThrow: (aim, power) => send({ t: 'fit', id: ID, op: 'throw', aim, power }) });
  useEffect(() => { drag.current = null; }, [myTurn, drag]);

  useTicker((t) => {
    const c = ref.current?.getContext('2d');
    if (!c) return;
    const { seen, air } = ballsNow(shown, t);
    const pal = seen.find((b) => b.team < 0) ?? null;
    for (const [view, y0, h] of [[strip, 0, STRIP], [() => zoom(pal), STRIP + 8, H - STRIP - 8]] as [() => void, number, number][]) {
      view();
      c.save(); c.beginPath(); c.rect(0, y0, W, h); c.clip();
      c.drawImage(lawnFor(light), 0, y0, W, h, 0, y0, W, h);
      c.strokeStyle = `rgba(250,250,240,${0.75 * (0.4 + 0.6 * light)})`; c.lineWidth = 2; c.setLineDash([5, 5]);    // a string round the court, between its pegs
      c.strokeRect(X(0), Y(-HALF_V), LONG * K, 2 * HALF_V * K); c.setLineDash([]);
      c.fillStyle = 'rgba(255,255,255,0.12)'; c.fillRect(X(LONG / 2) - 1, Y(-HALF_V), 2, 2 * HALF_V * K);      // the middle line, which the pallino must pass
      seen.slice().sort((p, q) => p.v - q.v).forEach((b) => drawBallBig(c, b, 0, light));
      if (air) drawBallBig(c, air, air.h, light);
      c.restore();
    }
    c.fillStyle = '#000'; c.fillRect(0, STRIP, W, 8);
    strip();
    if (myTurn) {
      const [ru, rv] = release(g!.end, side, k), d = drag.current;
      drawBallBig(c, { u: ru, v: rv, team: g!.phase === 'pallino' ? -1 : side }, 2.5, light);
      if (d) {
        const p = pull(d, t);
        if (p.back) drawAim(c, X(ru), Y(rv), ahead(g!.end) * Math.cos(p.aim), Math.sin(p.aim), 4 * K);
        drawPull(c, d, p.power, W, H);
      }
    }
    if (shown?.frame && !flight) banner(c, shown.frame.team < 0 ? 'NOBODY SCORES' : `${SIDES[shown.frame.team].toUpperCase()} SCORES ${shown.frame.pts}`, W);
  }, [g, flight, myTurn, light]);

  const left = (n: number) => (g ? BALLS - g.thrown[n] : BALLS);
  const say = !g ? '' : g.over ? g.last : flight ? `${nameOf(flight.who)} ${flight.pallino ? 'throws the pallino' : 'rolls'}…`
    : `${g.last ? `${g.last} ` : ''}${myTurn ? (g.phase === 'pallino' ? `Your pallino (${SIDES[side]}): past the middle line, on the court. Press anywhere, drag back, and let go.` : `Your ball (${SIDES[side]}, ${left(side)} left): press anywhere, drag back away from the far end, and let go.`) : g.thrown[0] >= BALLS && g.thrown[1] >= BALLS ? 'Picking up the balls…' : `${SIDES[side]} (${nameOf(thrower(g, side))}) to throw${g.phase === 'pallino' ? ' the pallino' : ''}.`}`;
  return (
    <Frame id={ID} title="Bocce" g={g} me={me} W={W} H={H} mine={myTurn} handlers={handlers} canvas={ref} say={say} close={close}
      names={SIDES} colors={SIDE_COLORS}
      help="Join red or green (one or two a side). Pallino first, four balls a side, nearest scores; first to 12."
      side={(n) => <><span className="ch-left">{'■'.repeat(left(n))}{'□'.repeat(BALLS - left(n))}</span> <b>{g?.score[n] ?? 0}</b></>} />
  );
}

// ── sounds: the soft thump of a ball landing on the grass, the clack of one ball on another ──
function sound(f: Flight) {
  const s = kit(ID, useLocal.getState().open);
  if (!s) return;
  const land = s.now + f.roll.air / 1000;
  s.burst(land, 0.1, 'lowpass', 240, 0.6);
  s.burst(land + 0.05, Math.min(2.5, f.roll.ms / 1000), 'lowpass', 160, 0.05);
  for (const ms of f.roll.clacks) { const at = land + ms / 1000; s.tone(at, 1900, 1500, 0.07, 0.4, 'triangle'); s.burst(at, 0.03, 'highpass', 2600, 0.35); }
}
