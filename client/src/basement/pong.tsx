// Beer pong on the page (server/basement/beerpong.ts keeps the game; pong.ts the measures and the throws). The folding
// table stands on the patio, drawn here over the yard's picture with both racks of cups on it, and a ball in the air
// flies its arc for everybody. A click on the table opens it large: the table from above, side on, Red's cups at the
// left. On your turn the ball is in your hand at your end: press anywhere, drag back away from the far cups and let go.
// The line drawn says which way, not how far; the strength shakes past half and the hand sways a little, and what they
// show when you let go is what is thrown. Joining a side walks you to your end of the table.
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { hooks, send, useStore } from '../store';
import { hush, useWatching } from './sound';
import { ahead, AIM, AIM_MAX, ballAt, BALL, CUP, HALF, LEN, release, RERACK, roomX, roomY, standAt, TABLE_H, thrower, tossMs, TX, TY } from './pong.ts';
import type { Cup, Pong, Toss } from './pong.ts';
import { COLORS, inSides, mySide, TEAMS } from './yardgames.ts';
import { banner, drawAim, drawPull, Frame, kit, lit, markThrow, nameOf, standsAt, thrower as throwPose, useDrag, useTicker, useWalkTo } from './yardkit.tsx';
import type { FitPose } from './index';

const ID = 'beerpong';
type Flight = { who: string; team: number; toss: Toss; after: Pong; before: Cup[][]; t0: number };
const useLocal = create<{ open: boolean; flight: Flight | null; light: number }>()(() => ({ open: false, flight: null, light: 1 }));
/** Opens it large (or shuts it), from Play Games. */
export const setOpen = (open: boolean) => useLocal.setState({ open });
useLocal.subscribe((s, p) => { if (p.open && !s.open) hush(ID); });
const useGame = () => useStore((s) => s.fits[ID] as Pong | null | undefined);

hooks.fit.push((d) => {
  if (d.id !== ID || d.op !== 'toss') return;
  const before = ((useStore.getState().fits[ID] as Pong | undefined)?.cups ?? [[], []]).map((c) => c.slice());
  const f: Flight = { who: String(d.who ?? ''), team: Number(d.team), toss: d.toss as Toss, after: d.after as Pong, before, t0: performance.now() };
  markThrow(f.who);
  useLocal.setState({ flight: f });
  sound(f);
  window.setTimeout(() => {
    if (useLocal.getState().flight !== f) return;
    useLocal.setState({ flight: null });
    useStore.setState((s) => ({ fits: { ...s.fits, [ID]: f.after } }));
  }, tossMs(f.toss) + 80);
});

/** The cups standing just now (a cup made goes once the ball is in it), and the ball in the air, if any. */
function now(g: Pong | null | undefined, t: number) {
  const f = useLocal.getState().flight;
  if (!f) return { cups: g?.cups ?? [[], []], ball: null as [number, number, number] | null, f };
  const el = t - f.t0, ball = ballAt(f.toss, el);
  const cups = f.before.map((c, s) => (s === 1 - f.team && f.toss.end === 'cup' && !ball ? c.filter((_, i) => i !== f.toss.cup && i !== f.toss.cup2) : c));
  return { cups, ball, f };
}

/** Where I stand at the table, if I am playing. */
function mySpot(g: Pong | null | undefined, me: string | undefined): [number, number] | null {
  const s = mySide(g, me);
  if (!g || s < 0 || !me) return null;
  const m = g.teams[s];
  return standAt(s, m.indexOf(me), m.length);
}
/** How a player at the table is drawn: facing down it from their end, and through a throw. */
export function pose(uid: string): FitPose | null {
  const g = useStore.getState().fits[ID] as Pong | undefined;
  const s = mySide(g, uid);
  if (!g || s < 0) return null;
  const [x, y] = standAt(s, g.teams[s].indexOf(uid), g.teams[s].length);
  return standsAt(uid, x, y) ? throwPose(uid, s === 0 ? 'down' : 'up', ID) : null;
}

// ── in the yard: the table and its cups ──
/** Dots up the picture for a foot of height, out here (the table is 2.4 feet high: its top stands 12 dots up). */
const Z = 5;
const LIFT = Math.round(TABLE_H * Z);                                    // (the table top, raised by its height in the picture)
const CX0 = TX - 12, CY0 = TY - LIFT - 6, CW = 24, CH = LEN * 8 + LIFT + 12;
/** The folding table, a dot to a pixel, outlined as everything in the yard is: its white top (lit down the left, the
 *  fold across its middle), the thick edge of it at our end, and under that end the steel legs standing on the pavers,
 *  a U of them braced across near the foot, in the dark of its shadow. (The far end's legs are under the top, out of
 *  sight, as they would be.) */
function drawTable(c: CanvasRenderingContext2D, cups: Cup[][], light: number) {
  c.clearRect(0, 0, CW, CH);
  const X = (x: number) => x - CX0, Y = (y: number) => y - CY0;
  const x0 = X(TX - 8), x1 = X(TX + 8), top = Y(TY - LIFT), bot = Y(TY + LEN * 8 - LIFT), gy = Y(TY + LEN * 8);
  const fill = (col: number[], x: number, y: number, w: number, h: number) => { c.fillStyle = lit(col, light); c.fillRect(x, y, w, h); };
  const OL = [44, 42, 50];
  c.fillStyle = 'rgba(0,0,0,0.3)'; c.fillRect(x0 + 1, Y(TY) + 1, 17, LEN * 8);                  // its shadow on the pavers
  c.fillStyle = 'rgba(0,0,0,0.22)'; c.fillRect(x0 + 2, bot + 2, 13, gy - bot - 3);                // the dark under it
  // the legs at our end: steel tube, lit down the left, rubber feet, and the brace across them
  for (const lx of [x0 + 1, x1 - 3]) {
    fill(OL, lx - 1, bot + 2, 4, gy - bot - 1);
    fill([176, 180, 188], lx, bot + 2, 1, gy - bot - 3);
    fill([116, 120, 130], lx + 1, bot + 2, 1, gy - bot - 3);
    fill([30, 30, 34], lx - 1, gy - 1, 4, 1);                                                   // the foot
  }
  const by = gy - 5;
  fill(OL, x0 + 3, by - 1, x1 - x0 - 6, 3);
  fill([150, 154, 162], x0 + 3, by, x1 - x0 - 6, 1);
  fill([190, 194, 200], x0 + 5, by, 3, 1);
  // the top: outlined, its edge at our end two dots thick
  fill(OL, x0 - 1, top - 1, 18, bot - top + 4);
  fill([226, 224, 216], x0, top, 16, bot - top);                                                 // white plastic
  fill([240, 239, 233], x0 + 1, top + 1, 6, bot - top - 2);
  fill([248, 247, 242], x0, top, 16, 1);                                                         // the far edge, catching the light
  fill([204, 202, 194], x1 - 1, top + 1, 1, bot - top - 1);                                      // its right side, in shade
  const mid = top + Math.round((bot - top) / 2);
  fill([196, 194, 186], x0, mid, 16, 1);                                                         // the fold across its middle
  fill([150, 150, 156], x0, mid, 1, 1); fill([150, 150, 156], x1 - 1, mid, 1, 1);                // and its hinges
  fill([180, 178, 170], x0, bot, 16, 1);                                                         // the edge at our end
  fill([138, 136, 130], x0, bot + 1, 16, 1);
  fill([200, 198, 190], x0 + 1, bot, 5, 1);
  c.fillStyle = lit([200, 198, 190], light); for (let k = 0; k < 6; k++) c.fillRect(x0 + 3 + ((k * 5) % 11), top + 6 + k * 9, 1, 1);
  for (const side of cups) {                                                                        // the cups, back rows first
    const order = side.slice().sort((p, q) => p.u - q.u);
    for (const cup of order) {
      const cx = Math.round(X(roomX(cup.v))) - 1, cy = Math.round(Y(roomY(cup.u) - LIFT)) - 2;
      c.fillStyle = lit([150, 24, 22], light); c.fillRect(cx, cy + 1, 3, 2);
      c.fillStyle = lit([214, 44, 36], light); c.fillRect(cx, cy + 1, 2, 2);
      c.fillStyle = lit([250, 246, 240], light); c.fillRect(cx, cy, 3, 1);
      c.fillStyle = lit([120, 20, 18], light); c.fillRect(cx + 1, cy + 1, 1, 1);
    }
  }
}

export function PongRoom({ mini, light }: { mini: boolean; light: number }) {
  const g = useGame();
  const open = useLocal((s) => s.open);
  const me = useStore((s) => s.me?.id);
  const can = useRef<HTMLCanvasElement>(null);
  const air = useRef<HTMLElement>(null), shadow = useRef<HTMLElement>(null);
  useWatching(open && g?.on && !g.over && !inSides(g, me) ? ID : null);
  useWalkTo(mySpot(g, me));
  useEffect(() => { useLocal.setState({ light }); }, [light]);
  const lastKey = useRef('');
  useTicker((t) => {
    const { cups, ball } = now(g, t);
    const key = `${cups[0].length},${cups[1].length},${cups.flat().map((q) => q.u.toFixed(2) + q.v.toFixed(2)).join('')},${light.toFixed(2)}`;
    const c = can.current?.getContext('2d');
    if (c && key !== lastKey.current) { lastKey.current = key; drawTable(c, cups, light); }
    const a = air.current, sh = shadow.current;
    if (a && sh) {
      a.style.display = sh.style.display = ball ? 'block' : 'none';
      if (ball) {
        const [u, v, h] = ball, x = roomX(v), y = roomY(u);
        a.style.left = `${x - 1}px`; a.style.top = `${y - h * Z - 1}px`;
        const onTable = u >= 0 && u <= LEN && Math.abs(v) <= HALF;
        sh.style.left = `${x - 1.5}px`; sh.style.top = `${y - (onTable ? LIFT : 0)}px`;
      }
    }
  }, [g, light]);
  const say = !g || (!g.on && !g.over) ? 'Beer pong: click to play or watch' : g.over ? `Beer pong: ${g.last}` : `Beer pong: ${TEAMS[0]} ${g.cups[0].length} cups, ${TEAMS[1]} ${g.cups[1].length}`;
  return (
    <>
      <canvas ref={can} className="yg-layer" width={CW} height={CH} style={{ left: CX0, top: CY0, width: CW, height: CH, zIndex: TY + LEN * 8 }} />
      <i ref={shadow} className="yg-shadow" style={{ zIndex: 2969, display: 'none' }} />
      <i ref={air} className="yg-air" style={{ zIndex: 2970, display: 'none' }} />
      {!mini && <i className="cf-hot" title={say} style={{ left: TX - 9, top: TY - LIFT - 1, width: 18, height: LEN * 8 + LIFT + 2, zIndex: 2990 }} onClick={(e) => { e.stopPropagation(); useLocal.setState({ open: true }); }} />}
      {open && !mini && createPortal(<Overlay />, document.querySelector('.main-view') ?? document.body)}
    </>
  );
}

// ── large: the table from above, side on ──
const W = 1000, H = 420, K = 108, OX = (W - LEN * K) / 2, OY = H / 2 + 6;
const X = (u: number) => OX + u * K, Y = (v: number) => OY + v * K;

let floor: HTMLCanvasElement | null = null, floorLight = -1;
/** The patio's pavers, drawn once (and again as the light changes). */
function pavers(light: number) {
  if (floor && Math.abs(floorLight - light) < 0.05) return floor;
  floorLight = light;
  floor = document.createElement('canvas'); floor.width = W; floor.height = H;
  const c = floor.getContext('2d')!;
  let n = 11; const r = () => ((n = (n * 16807) % 2147483647) / 2147483647);
  c.fillStyle = lit([70, 74, 82], light); c.fillRect(0, 0, W, H);
  for (let y = -40, row = 0; y < H; y += 66, row++) for (let x = -((row % 2) * 60); x < W; x += 120) {
    const k = 0.85 + r() * 0.3;
    c.fillStyle = lit([118 * k, 124 * k, 134 * k], light); c.fillRect(x + 3, y + 3, 114, 60);
    c.fillStyle = lit([140 * k, 146 * k, 156 * k], light); c.fillRect(x + 3, y + 3, 114, 3);
    for (let s = 0; s < 30; s++) { c.fillStyle = `rgba(0,0,0,${0.05 + r() * 0.08})`; c.fillRect(x + 4 + r() * 110, y + 5 + r() * 54, 2, 2); }
  }
  return floor;
}
/** A cup from above, lit as the table is (the large view is drawn as by day, whatever the hour in the yard): the red
 *  of its side round the edge, its rolled white rim, the white inside, and the beer in it. */
function drawCup(c: CanvasRenderingContext2D, u: number, v: number, gone = 1) {
  const x = X(u), y = Y(v), r = CUP * K;
  const disc = (col: string, dx: number, dy: number, rr: number) => { c.fillStyle = col; c.beginPath(); c.arc(x + dx, y + dy, rr, 0, Math.PI * 2); c.fill(); };
  c.globalAlpha = gone;
  disc('rgba(0,0,0,0.3)', 4, 5, r);
  disc('#e8352c', 0, 0, r);                       // the red cup
  disc('#ff6a5c', -1, -1, r - 2);                 // lit at the top left
  disc('#e8352c', 0, 0, r - 3);
  disc('#fbf8f2', 0, 0, r - 4);                   // its white rim
  disc('#d9d4cb', 1, 1, r - 7);                   // the inside, in its own shade
  disc('#f4c24a', 1, 1, r - 9);                   // the beer
  disc('#ffe39a', -1, -1, r - 13);
  c.fillStyle = 'rgba(255,255,255,0.55)'; c.fillRect(x - r * 0.55, y - r * 0.45, 4, 3);
  c.globalAlpha = 1;
}
function drawBall(c: CanvasRenderingContext2D, u: number, v: number, h: number) {
  const r = BALL * K * (1 + h * 0.07), sh = Math.max(0, h - TABLE_H);
  c.fillStyle = 'rgba(0,0,0,0.3)'; c.beginPath(); c.ellipse(X(u) + 3 + sh * 6, Y(v) + 4 + sh * 8, BALL * K, BALL * K * 0.8, 0, 0, Math.PI * 2); c.fill();
  const x = X(u), y = Y(v) - sh * 4;
  c.fillStyle = '#ece8de'; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#ffffff'; c.beginPath(); c.arc(x - r * 0.3, y - r * 0.3, r * 0.45, 0, Math.PI * 2); c.fill();
}

function Overlay() {
  const g = useGame();
  const me = useStore((s) => s.me?.id);
  const flight = useLocal((s) => s.flight);
  const light = useLocal((s) => s.light);
  const ref = useRef<HTMLCanvasElement>(null);
  const close = () => useLocal.setState({ open: false });
  const shown = flight?.after ?? g;
  const s = g?.turn ?? 0;
  const myTurn = !!g && g.on && !g.over && !flight && !!me && thrower(g, s) === me;
  const k = g && g.teams[s].length === 2 ? g.shot % 2 : 0;
  const from = g ? release(s, k, g.teams[s].length) : ([0, 0] as [number, number]);
  const { drag, pull, handlers } = useDrag({ W, H, mine: myTurn, game: ID, fwd: ahead(s), k: AIM, max: AIM_MAX, swayK: 0.003, onThrow: (aim, power) => send({ t: 'fit', id: ID, op: 'throw', aim, power }) });
  useEffect(() => { drag.current = null; }, [myTurn, drag]);

  useTicker((t) => {
    const c = ref.current?.getContext('2d');
    if (!c) return;
    const { cups, ball, f } = now(g, t);
    c.drawImage(pavers(light), 0, 0);
    // the table: its shadow, its white top, the fold across the middle
    c.fillStyle = 'rgba(0,0,0,0.35)'; c.fillRect(X(0) + 10, Y(-HALF) + 14, LEN * K, 2 * HALF * K);
    c.fillStyle = '#cfccc2'; c.fillRect(X(0) - 3, Y(-HALF) - 3, LEN * K + 6, 2 * HALF * K + 6);
    const top = c.createLinearGradient(0, Y(-HALF), 0, Y(HALF)); top.addColorStop(0, '#f4f2ec'); top.addColorStop(1, '#dedbd2');
    c.fillStyle = top; c.fillRect(X(0), Y(-HALF), LEN * K, 2 * HALF * K);
    c.fillStyle = 'rgba(0,0,0,0.08)'; c.fillRect(X(LEN / 2) - 1, Y(-HALF), 2, 2 * HALF * K);
    for (let q = 0; q < 40; q++) { c.fillStyle = 'rgba(0,0,0,0.035)'; c.fillRect(X(((q * 37) % 79) / 10), Y(((q * 13) % 19) / 10 - 0.95), 3, 2); }
    // the cups at each end, those still standing; one just made sinks away
    cups.forEach((side) => side.forEach((q) => drawCup(c, q.u, q.v)));
    if (f && f.toss.end === 'cup' && !ball) for (const i of [f.toss.cup, f.toss.cup2 ?? -1]) { const q = f.before[1 - f.team][i]; if (q) drawCup(c, q.u, q.v, 0.4); }
    if (ball) drawBall(c, ball[0], ball[1], ball[2]);
    // names at each end
    c.font = '24px VT323, monospace'; c.textAlign = 'center'; c.lineWidth = 4; c.strokeStyle = '#14100c';
    for (const n of [0, 1]) { const txt = `${TEAMS[n]}: ${(shown?.teams[n] ?? []).map(nameOf).join(' & ') || 'nobody'}`, x = n === 0 ? X(0.9) : X(LEN - 0.9); c.strokeText(txt, x, Y(-HALF) - 16); c.fillStyle = COLORS[n]; c.fillText(txt, x, Y(-HALF) - 16); }
    if (myTurn) {
      const d = drag.current;
      drawBall(c, from[0], from[1], 4.4);
      if (d) {
        const p = pull(d, t);
        if (p.back) drawAim(c, X(from[0]), Y(from[1]), ahead(s) * Math.cos(p.aim), Math.sin(p.aim), 0.9 * K);
        drawPull(c, d, p.power, W, H);
      }
    }
    if (shown?.rebuttal && !f) banner(c, `${TEAMS[shown.turn]}: REBUTTAL`, W);
    else if (shown?.ot && !f && shown.on) banner(c, `OVERTIME${shown.ot > 1 ? ` ${shown.ot}` : ''}`, W);
  }, [g, flight, myTurn, light]);

  const mine = mySide(g, me);
  const canRerack = !!g && g.on && !g.over && !flight && mine === g.turn && g.shot === 0 && g.hits === 0 && !g.reracked[mine] && !g.rebuttal && !g.ot && !!RERACK[g.cups[1 - mine].length];
  const say = !g ? '' : g.over ? g.last : flight ? `${nameOf(flight.who)} throws…`
    : `${g.last ? `${g.last} ` : ''}${myTurn ? `Your throw (${TEAMS[s]}${g.rebuttal ? ', rebuttal' : `, ball ${g.shot + 1} of 2`}): press anywhere, drag back away from the far cups, and let go.` : `${TEAMS[s]} (${nameOf(thrower(g, s))}) to throw${g.rebuttal ? ', in rebuttal' : ''}.`}`;
  return (
    <Frame id={ID} title="Beer Pong" g={g} me={me} W={W} H={H} mine={myTurn} handlers={handlers} canvas={ref} say={say} close={close}
      help="Join red or blue (one or two a side; or both, to practise). Clear the other side's ten cups. A ball bounced off the table into a cup takes two."
      side={(n) => <span className="yg-sides">{g?.cups[n].length ?? 10} cups{g?.reracked[n] ? ', re-racked' : ''}</span>}
      extra={canRerack ? <button onClick={() => send({ t: 'fit', id: ID, op: 'rerack' })} title="Once a game, at six cups or four">Re-rack ({g!.cups[1 - mine].length === 6 ? 'triangle' : 'diamond'})</button> : null} />
  );
}

// ── sounds: the tock of the ball on the table, the plop into a cup, the rattle round a rim ──
function sound(f: Flight) {
  const s = kit(ID, useLocal.getState().open);
  if (!s) return;
  let at = s.now;
  f.toss.hops.forEach((h, i) => {
    at += h.ms / 1000;
    const last = i === f.toss.hops.length - 1;
    if (last && f.toss.end === 'cup') { s.tone(at, 520, 180, 0.18, 0.35); s.burst(at, 0.25, 'lowpass', 600, 0.35); }
    else if (h.h1 > 0.1 && Math.abs(h.h1 - TABLE_H) < 0.01) { s.tone(at, 2400, 1900, 0.05, 0.25, 'triangle'); s.burst(at, 0.03, 'highpass', 3000, 0.2); }
    else if (h.h1 > TABLE_H) { s.tone(at, 1600, 1500, 0.06, 0.18, 'triangle'); s.tone(at + 0.08, 1500, 1400, 0.05, 0.12, 'triangle'); }
    else if (h.h1 <= 0.01) { s.tone(at, 1700, 1300, 0.05, 0.12, 'triangle'); s.tone(at + 0.22, 1700, 1300, 0.04, 0.07, 'triangle'); }
  });
}
