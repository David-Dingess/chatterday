// Horseshoes on the page (server/basement/horseshoes.ts keeps the game; shoes.ts the measures and the pitches). The two
// sandpits and their stakes are drawn here over the lawn (above the mown grass, which plays no part), with the shoes
// lying in them; a shoe in the air turns over as it flies. A click on either pit opens it large: the whole pitch from
// above along the top, and the pit being pitched at close up below. On your turn the shoe is in your hand at the foul
// line: press anywhere, drag back away from the far stake and let go (as cornhole). The line says which way, not how
// far; the strength shakes past half. Joining a side walks you beside the pit you pitch from.
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { hooks, send, useStore } from '../store';
import { hush, useWatching } from './sound';
import { ahead, GAP, nearness, PIT_HALF_U, PIT_HALF_V, release, roomX, roomY, SHOE, SHOES, standing, STAKES, STAKE_R, SY, thrower } from './shoes.ts';
import type { At, Game, Pitch, Shoe } from './shoes.ts';
import { COLORS, inSides, TEAMS } from './yardgames.ts';
import { banner, drawAim, drawPull, Frame, kit, lit, markThrow, nameOf, standsAt, thrower as throwPose, useDrag, useTicker, useWalkTo } from './yardkit.tsx';
import type { FitPose } from './index';

const ID = 'horseshoes';
type Flight = { who: string; team: number; pitch: Pitch; after: Game; before: Shoe[]; t0: number };
const useLocal = create<{ open: boolean; flight: Flight | null; light: number }>()(() => ({ open: false, flight: null, light: 1 }));
export const setOpen = (open: boolean) => useLocal.setState({ open });
useLocal.subscribe((s, p) => { if (p.open && !s.open) hush(ID); });
const useGame = () => useStore((s) => s.fits[ID] as Game | null | undefined);

hooks.fit.push((d) => {
  if (d.id !== ID || d.op !== 'toss') return;
  const before = (useStore.getState().fits[ID] as Game | undefined)?.shoes ?? [];
  const f: Flight = { who: String(d.who ?? ''), team: Number(d.team), pitch: d.pitch as Pitch, after: d.after as Game, before, t0: performance.now() };
  markThrow(f.who);
  useLocal.setState({ flight: f });
  sound(f);
  window.setTimeout(() => {
    if (useLocal.getState().flight !== f) return;
    useLocal.setState({ flight: null });
    useStore.setState((s) => ({ fits: { ...s.fits, [ID]: f.after } }));
  }, f.pitch.flightMs + f.pitch.settleMs + 60);
});

type Lying = { u: number; v: number; a: number; team: number; at: At };
/** Every shoe just now, and the one in the air (if any): where, how high (feet), which way it faces. */
function shoesNow(g: Game | null | undefined, t: number) {
  const f = useLocal.getState().flight;
  if (!f) return { shoes: (g?.shoes ?? []) as Lying[], air: null };
  const el = t - f.t0, flying = el < f.pitch.flightMs, s = Math.max(0, Math.min(1, (el - f.pitch.flightMs) / f.pitch.settleMs));
  const n = f.after.shoes.length - 1;
  const shoes: Lying[] = [];
  f.after.shoes.forEach((b, i) => {
    if (i === n && flying) return;
    const m = f.pitch.moves.find((q) => q.i === i);
    if (!m) { const p = f.before[i] ?? b; shoes.push(p); return; }
    const k = Math.max(0, Math.min(1, (s - m.delay) / Math.max(0.05, 1 - m.delay))), e = 1 - (1 - k) * (1 - k);
    shoes.push({ u: m.from[0] + (m.to[0] - m.from[0]) * e, v: m.from[1] + (m.to[1] - m.from[1]) * e, a: i === n ? m.a1 : m.a0 + (m.a1 - m.a0) * e, team: b.team, at: k >= 1 ? m.at : 'pit' });
  });
  let air = null;
  if (flying) {
    const p = el / f.pitch.flightMs, [u0, v0] = f.pitch.from, [u1, v1] = f.pitch.land;
    const last = f.pitch.moves[0];
    air = { u: u0 + (u1 - u0) * p, v: v0 + (v1 - v0) * p, h: 3 * (1 - p) + f.pitch.apex * 4 * p * (1 - p), a: last.a1 + (1 - p) * f.pitch.turns * Math.PI * 2, team: f.team, p };
  }
  return { shoes, air };
}

export function pose(uid: string): FitPose | null {
  const g = useStore.getState().fits[ID] as Game | undefined;
  const at = g ? standing(g, uid) : null;
  if (!at || !standsAt(uid, at[0], at[1])) return null;
  return throwPose(uid, at[2] === 0 ? 'right' : 'left', ID);
}

// ── in the yard: the pits, the stakes, the shoes ──
const PW = Math.round((PIT_HALF_U + 0.6) * 2 * 8), PH = Math.round((PIT_HALF_V + 0.6) * 2 * 8);
const pitBox = (s: number) => [Math.round(roomX(STAKES[s]) - PW / 2), Math.round(SY - PH / 2)];
const RED = [196, 52, 40], BLUE = [44, 86, 196];
/** A pit in the yard, a dot to a pixel: its timber frame, the sand, the shoes lying in it (ringers round the stake). */
function drawPit(c: CanvasRenderingContext2D, s: number, shoes: Lying[], idle: boolean, light: number) {
  c.clearRect(0, 0, PW, PH);
  c.fillStyle = 'rgba(0,0,0,0.25)'; c.fillRect(1, 2, PW - 1, PH - 1);
  c.fillStyle = lit([112, 78, 46], light); c.fillRect(0, 0, PW, PH);                                    // the frame
  c.fillStyle = lit([140, 100, 62], light); c.fillRect(0, 0, PW, 1); c.fillRect(0, 0, 1, PH);
  c.fillStyle = lit([86, 58, 34], light); c.fillRect(0, PH - 1, PW, 1); c.fillRect(PW - 1, 0, 1, PH);
  c.fillStyle = lit([214, 190, 132], light); c.fillRect(2, 2, PW - 4, PH - 4);                          // the sand
  let n = 3 + s * 7; const r = () => ((n = (n * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < 60; k++) { const q = r(); c.fillStyle = lit(q < 0.5 ? [190, 164, 108] : [232, 212, 160], light); c.fillRect(2 + Math.floor(r() * (PW - 4)), 2 + Math.floor(r() * (PH - 4)), 1, 1); }
  c.fillStyle = lit([196, 170, 114], light); c.fillRect(Math.round(PW / 2) - 2, Math.round(PH / 2) - 1, 4, 3);   // scuffed round the stake
  const X0 = roomX(STAKES[s]) - PW / 2, Y0 = SY - PH / 2;
  const put = (u: number, v: number, team: number, a: number) => {
    const x = Math.round(roomX(u) - X0), y = Math.round(roomY(v) - Y0), col = team === 0 ? RED : BLUE;
    // a little U, three dots square, its open end the way the shoe faces (to the nearest quarter), its heel painted
    const q4 = ((Math.round(a / (Math.PI / 2)) % 4) + 4) % 4;             // 0 open right, 1 down, 2 left, 3 up
    const U = [['###', '#..', '###'], ['#.#', '#.#', '###'].reverse(), ['###', '..#', '###'], ['#.#', '#.#', '###']][q4];
    const heel = [[0, 1], [1, 0], [2, 1], [1, 2]][q4];
    U.forEach((row, j) => [...row].forEach((ch, i) => {
      if (ch !== '#') return;
      c.fillStyle = i === heel[0] && j === heel[1] ? lit(col, light) : lit([84, 84, 90], light);
      c.fillRect(x - 1 + i, y - 1 + j, 1, 1);
    }));
  };
  for (const q of shoes) if (Math.abs(q.u - STAKES[s]) < PIT_HALF_U + 1.2) put(q.u, q.v, q.team, q.a);
  if (idle) { put(STAKES[s] + (s ? -1.2 : 1.2), -1.1, 0, 0.4); put(STAKES[s] + (s ? -1.3 : 1.3), -0.6, 1, 2.2); }
}

export function ShoesRoom({ mini, light }: { mini: boolean; light: number }) {
  const g = useGame();
  const open = useLocal((s) => s.open);
  const me = useStore((s) => s.me?.id);
  const cans = [useRef<HTMLCanvasElement>(null), useRef<HTMLCanvasElement>(null)];
  const air = useRef<HTMLElement>(null), shadow = useRef<HTMLElement>(null);
  useEffect(() => { useLocal.setState({ light }); }, [light]);
  useWatching(open && g?.on && !g.over && !inSides(g, me) ? ID : null);
  const at = g && me ? standing(g, me) : null;
  useWalkTo(at ? [at[0], at[1]] : null);
  const lastKey = useRef('');
  useTicker((t) => {
    const { shoes, air: a } = shoesNow(g, t);
    const idle = !g?.on && !useLocal.getState().flight;
    const key = `${shoes.map((q) => `${q.u.toFixed(1)},${q.v.toFixed(1)},${q.a.toFixed(1)}`).join('|')}${idle}${light.toFixed(2)}`;
    if (key !== lastKey.current) {
      lastKey.current = key;
      cans.forEach((r, s) => { const c = r.current?.getContext('2d'); if (c) drawPit(c, s, shoes, idle, light); });
    }
    const el = air.current, sh = shadow.current;
    if (el && sh) {
      el.style.display = sh.style.display = a ? 'block' : 'none';
      if (a) {
        el.style.left = `${roomX(a.u) - 2}px`; el.style.top = `${roomY(a.v) - a.h * 3.3 - 1}px`;
        el.style.transform = `rotate(${Math.round((a.a * 180) / Math.PI / 30) * 30}deg)`;
        el.style.borderColor = COLORS[a.team];
        sh.style.left = `${roomX(a.u) - 1.5}px`; sh.style.top = `${roomY(a.v)}px`;
      }
    }
  }, [g, light]);
  const say = !g || (!g.on && !g.over) ? 'Horseshoes: click to play or watch' : g.over ? `Horseshoes: ${g.last}` : `Horseshoes: ${TEAMS[0]} ${g.score[0]}, ${TEAMS[1]} ${g.score[1]}`;
  return (
    <>
      {[0, 1].map((s) => { const [x, y] = pitBox(s); return <canvas key={s} ref={cans[s]} className="yg-layer" width={PW} height={PH} style={{ left: x, top: y, width: PW, height: PH, zIndex: 3 }} />; })}
      {/* the stakes, standing out of the sand: people pass in front of them and behind */}
      {STAKES.map((u, s) => <i key={`k${s}`} className="yg-layer" style={{ left: Math.round(roomX(u)), top: SY - 5, width: 1, height: 6, background: `linear-gradient(${lit([196, 190, 180], light)} 0 1px, ${lit([60, 54, 50], light)} 1px)`, boxShadow: '1px 1px 0 rgba(0,0,0,0.3)', zIndex: SY }} />)}
      <i ref={shadow} className="yg-shadow" style={{ zIndex: 2969, display: 'none' }} />
      <i ref={air} className="yg-air shoe" style={{ zIndex: 2970, display: 'none', border: '1px solid', borderTop: 'none', borderRadius: '0 0 2px 2px' }} />
      {!mini && [0, 1].map((s) => { const [x, y] = pitBox(s); return <i key={`h${s}`} className="cf-hot" title={say} style={{ left: x, top: y - 4, width: PW, height: PH + 4, zIndex: 2990 }} onClick={(e) => { e.stopPropagation(); useLocal.setState({ open: true }); }} />; })}
      {open && !mini && createPortal(<Overlay />, document.querySelector('.main-view') ?? document.body)}
    </>
  );
}

// ── large: the whole pitch along the top, and the pit being pitched at close up ──
const W = 1000, H = 520, STRIP = 200, ZK = 78;
let K = 21, U0 = -3, V0 = -STRIP / 2 / 21, OY = 0;
const X = (u: number) => (u - U0) * K, Y = (v: number) => OY + (v - V0) * K;
const strip = () => { K = W / (GAP + 7.6); U0 = -3.8; V0 = -STRIP / 2 / K; OY = 0; };
const zoom = (e: number) => { const su = STAKES[e === 0 ? 1 : 0]; K = ZK; U0 = su - W / 2 / ZK; V0 = -(H - STRIP - 8) / 2 / ZK; OY = STRIP + 8; };

let lawn: HTMLCanvasElement | null = null, lawnLight = -1;
function lawnFor(light: number) {
  if (lawn && Math.abs(lawnLight - light) < 0.05) return lawn;
  lawnLight = light;
  lawn = document.createElement('canvas'); lawn.width = W; lawn.height = H;
  const c = lawn.getContext('2d')!;
  c.fillStyle = lit([64, 124, 50], light); c.fillRect(0, 0, W, H);
  let n = 5; const r = () => ((n = (n * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < 9000; k++) {
    const x = r() * W, y = r() * H, a = r() * Math.PI * 2, l = 2 + r() * 4, q = r();
    c.strokeStyle = lit(q < 0.33 ? [44, 92, 36] : q < 0.7 ? [86, 150, 60] : [126, 184, 84], light);
    c.lineWidth = 1; c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); c.stroke();
  }
  return lawn;
}
function drawPitBig(c: CanvasRenderingContext2D, s: number, light: number) {
  const su = STAKES[s], x0 = X(su - PIT_HALF_U), x1 = X(su + PIT_HALF_U), y0 = Y(-PIT_HALF_V), y1 = Y(PIT_HALF_V), b = Math.max(3, 0.3 * K);
  c.fillStyle = 'rgba(0,0,0,0.3)'; c.fillRect(x0 - b + 4, y0 - b + 5, x1 - x0 + 2 * b, y1 - y0 + 2 * b);
  c.fillStyle = lit([118, 82, 48], light); c.fillRect(x0 - b, y0 - b, x1 - x0 + 2 * b, y1 - y0 + 2 * b);
  c.fillStyle = lit([150, 108, 66], light); c.fillRect(x0 - b, y0 - b, x1 - x0 + 2 * b, Math.max(1, b * 0.3));
  c.fillStyle = lit([216, 192, 136], light); c.fillRect(x0, y0, x1 - x0, y1 - y0);
  let n = 9 + s; const r = () => ((n = (n * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < (x1 - x0) * (y1 - y0) / 30; k++) { c.fillStyle = r() < 0.5 ? 'rgba(120,90,40,0.18)' : 'rgba(255,245,210,0.25)'; c.fillRect(x0 + r() * (x1 - x0), y0 + r() * (y1 - y0), 2, 2); }
  c.fillStyle = 'rgba(120,90,40,0.18)'; c.beginPath(); c.ellipse(X(su), Y(0), 0.6 * K, 0.4 * K, 0, 0, Math.PI * 2); c.fill();
  c.fillStyle = 'rgba(255,255,255,0.15)'; c.fillRect(X(s === 0 ? 3 : GAP - 3) - 1, Y(-2.6), 2, Y(2.6) - Y(-2.6));       // the foul line
}
function drawStake(c: CanvasRenderingContext2D, s: number, light: number) {
  const x = X(STAKES[s]), y = Y(0), r = Math.max(2.5, STAKE_R * K * 1.3);
  c.strokeStyle = 'rgba(0,0,0,0.35)'; c.lineWidth = r * 1.4; c.beginPath(); c.moveTo(x, y); c.lineTo(x + 1.17 * K * 0.5, y + 1.17 * K * 0.6); c.stroke();
  c.fillStyle = lit([90, 86, 82], light); c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
  c.fillStyle = lit([180, 176, 168], light); c.beginPath(); c.arc(x - r * 0.3, y - r * 0.3, r * 0.45, 0, Math.PI * 2); c.fill();
}
/** A shoe from above, `h` feet up: a steel U, its open end facing `a`, with its owner's colour painted on the heel. */
function drawShoe(c: CanvasRenderingContext2D, q: { u: number; v: number; a: number; team: number }, h: number, light: number) {
  const sc = 1 + h * 0.06, rad = SHOE * 0.72 * K * sc, w = Math.max(2, 0.1 * K * sc);
  const x = X(q.u), y = Y(q.v) - h * K * 0.12;
  if (h > 0.05) { c.strokeStyle = 'rgba(0,0,0,0.3)'; c.lineWidth = w; c.beginPath(); c.arc(X(q.u) + h * 3, Y(q.v) + h * 4, rad, q.a + 0.75, q.a - 0.75 + Math.PI * 2); c.stroke(); }
  else { c.strokeStyle = 'rgba(0,0,0,0.3)'; c.lineWidth = w; c.beginPath(); c.arc(x + 2, y + 3, rad, q.a + 0.75, q.a - 0.75 + Math.PI * 2); c.stroke(); }
  c.lineCap = 'butt';
  c.strokeStyle = lit([96, 98, 104], light); c.lineWidth = w; c.beginPath(); c.arc(x, y, rad, q.a + 0.75, q.a - 0.75 + Math.PI * 2); c.stroke();
  c.strokeStyle = lit([170, 172, 178], light); c.lineWidth = Math.max(1, w * 0.35); c.beginPath(); c.arc(x, y, rad - w * 0.2, q.a + 0.9, q.a + 2.2); c.stroke();
  c.strokeStyle = lit(q.team === 0 ? RED : BLUE, light); c.lineWidth = w; c.beginPath(); c.arc(x, y, rad, q.a + Math.PI - 0.5, q.a + Math.PI + 0.5); c.stroke();
  c.fillStyle = lit([70, 72, 78], light);                                                                        // the calks
  for (const sgn of [1, -1]) c.fillRect(x + Math.cos(q.a + sgn * 0.75) * rad - w / 2, y + Math.sin(q.a + sgn * 0.75) * rad - w / 2, w, w);
}

function Overlay() {
  const g = useGame();
  const me = useStore((s) => s.me?.id);
  const flight = useLocal((s) => s.flight);
  const light = useLocal((s) => s.light);
  const ref = useRef<HTMLCanvasElement>(null);
  const close = () => useLocal.setState({ open: false });
  const shown = flight?.after ?? g;
  const myTurn = !!g && g.on && !g.over && !flight && !!me && thrower(g, g.turn) === me && g.thrown[g.turn] < SHOES;
  const e = g?.end ?? 0;
  const { drag, pull, handlers } = useDrag({ W, H, mine: myTurn, game: ID, fwd: ahead(e), max: 0.3, swayK: 0.004, onThrow: (aim, power) => send({ t: 'fit', id: ID, op: 'throw', aim, power }) });
  useEffect(() => { drag.current = null; }, [myTurn, drag]);

  useTicker((t) => {
    const c = ref.current?.getContext('2d');
    if (!c) return;
    const { shoes, air } = shoesNow(shown, t);
    const end = shown?.end ?? 0;
    for (const [view, y0, h] of [[strip, 0, STRIP], [() => zoom(end), STRIP + 8, H - STRIP - 8]] as [() => void, number, number][]) {
      view();
      c.save(); c.beginPath(); c.rect(0, y0, W, h); c.clip();
      c.drawImage(lawnFor(light), 0, y0, W, h, 0, y0, W, h);
      drawPitBig(c, 0, light); drawPitBig(c, 1, light);
      shoes.forEach((q) => { if (q.at !== 'ringer') drawShoe(c, q, q.at === 'leaner' ? 0.15 : 0, light); });
      drawStake(c, 0, light); drawStake(c, 1, light);
      shoes.forEach((q) => { if (q.at === 'ringer') drawShoe(c, q, 0.02, light); });
      if (air) drawShoe(c, air, air.h, light);
      c.restore();
    }
    c.fillStyle = '#000'; c.fillRect(0, STRIP, W, 8);
    strip();
    if (myTurn) {
      const [ru, rv] = release(g!.end, g!.turn), d = drag.current;
      drawShoe(c, { u: ru, v: rv, a: 0, team: g!.turn }, 3, light);
      if (d) {
        const p = pull(d, t);
        if (p.back) drawAim(c, X(ru), Y(rv), ahead(g!.end) * Math.cos(p.aim), Math.sin(p.aim), 7 * K);
        drawPull(c, d, p.power, W, H);
      }
    }
    if (shown?.inning && !flight) banner(c, `${TEAMS[0]} ${shown.inning[0]}  ·  ${TEAMS[1]} ${shown.inning[1]}`, W);
  }, [g, flight, myTurn, light]);

  const left = (n: number) => (g ? SHOES - g.thrown[n] : SHOES);
  const near = shown?.shoes.length && !flight ? (() => { const best = shown.shoes.filter((q) => q.at !== 'out').sort((p, q) => nearness(p) - nearness(q))[0]; return best ? ` Nearest: ${TEAMS[best.team]}.` : ''; })() : '';
  const say = !g ? '' : g.over ? g.last : flight ? `${nameOf(flight.who)} pitches…`
    : `${g.last ? `${g.last} ` : ''}${myTurn ? `Your pitch (${TEAMS[g.turn]}, ${left(g.turn)} left): press anywhere, drag back away from the far stake, and let go.` : g.thrown[0] >= SHOES && g.thrown[1] >= SHOES ? `Picking up the shoes…` : `${TEAMS[g.turn]} (${nameOf(thrower(g, g.turn))}) to pitch.${near}`}`;
  return (
    <Frame id={ID} title="Horseshoes" g={g} me={me} W={W} H={H} mine={myTurn} handlers={handlers} canvas={ref} say={say} close={close}
      help="Join red or blue (one or two a side). Ringers 3, leaners 1, nearest within six inches 1; first to 21."
      side={(n) => <><span className="ch-left">{'■'.repeat(left(n))}{'□'.repeat(SHOES - left(n))}</span> <b>{g?.score[n] ?? 0}</b></>} />
  );
}

// ── sounds: the clank of steel on the stake, the thump into the sand ──
function sound(f: Flight) {
  const s = kit(ID, useLocal.getState().open);
  if (!s) return;
  const at = s.now + f.pitch.flightMs / 1000;
  s.burst(at, 0.12, 'lowpass', 380, 0.55);
  s.burst(at, 0.25, 'bandpass', 1200, 0.08);
  if (f.pitch.clank) {
    const c = at + f.pitch.settleMs / 2000;
    s.tone(c, 1320, 1290, 0.6, 0.18, 'triangle'); s.tone(c, 2140, 2100, 0.45, 0.09, 'sine'); s.tone(c, 3460, 3400, 0.25, 0.05, 'sine');
    s.burst(c, 0.04, 'highpass', 2500, 0.3);
  }
}
