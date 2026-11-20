// Cornhole on the page (server/basement/cornhole.ts keeps the game; cornhole.ts the measures and the throws). The boards
// are in the campsite's picture, down the bottom left; the bags on them are drawn here, in the room, for everybody, and a
// bag in the air flies in its arc. A click on either board opens it large: the whole pitch from above, both boards and
// every bag. On your turn your bag is in your hand beside your board: press anywhere, drag back away from the far board
// and let go (as the shuffleboard is played, and the paper thrown at the bin). The line drawn says which way, not how
// far; the strength bar shakes once you are past half, and no hand is quite steady. Joining a side walks you to your
// pitcher's box (and, alone on a side, to the end that is pitching, every inning).
import { useEffect, useRef } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { hooks, send, soundGain, useStore } from '../store';
import { hush, out, useWatching } from './sound';
import { ahead, BAG, BAGS, BOARDS, COLORS, HALF_W, HOLE_R, lift, release, standing, TEAMS, thrower } from './cornhole';
import type { Bag, Game, Toss } from './cornhole';
import type { FitLayout } from './index';
import { pageRect } from '../device';

const ID = 'cornhole';
type Flight = { who: string; team: number; toss: Toss; after: Game; before: Bag[]; t0: number };
const useLocal = create<{ open: boolean; flight: Flight | null; light: number }>()(() => ({ open: false, flight: null, light: 1 }));
/** Opens it large (or shuts it), from outside the room (Play Games' Outdoors tab). It shows once the room is the campsite. */
export const setOpen = (open: boolean) => useLocal.setState({ open });
useLocal.subscribe((s, p) => { if (p.open && !s.open) hush(ID); });
const useGame = () => useStore((s) => s.fits[ID] as Game | null | undefined);
const nameOf = (id: string | null | undefined) => (id ? useStore.getState().users[id]?.name ?? 'Somebody' : '');

let listening = false;
function listen() {
  if (listening) return;
  listening = true;
  hooks.fit.push((d) => {
    if (d.id !== ID || d.op !== 'toss') return;
    const before = (useStore.getState().fits[ID] as Game | undefined)?.bags ?? [];
    const f: Flight = { who: String(d.who ?? ''), team: Number(d.team), toss: d.toss as Toss, after: d.after as Game, before, t0: performance.now() };
    useLocal.setState({ flight: f });
    sound(f);
    window.setTimeout(() => {
      if (useLocal.getState().flight !== f) return;
      useLocal.setState({ flight: null });
      useStore.setState((s) => ({ fits: { ...s.fits, [ID]: f.after } }));
    }, f.toss.flightMs + f.toss.slideMs + 60);
  });
}

/** Every bag just now, [u, v, height, team, shown] (height in feet off the ground, for one in the air or on a deck), and
 *  the one in the air (if any) with how far through its flight it is. */
function bagsNow(g: Game | null | undefined, t: number) {
  const f = useLocal.getState().flight;
  if (!f) return { bags: (g?.bags ?? []).map((b) => [b.u, b.v, lift(b.u, b.v), b.team, b.at !== 'hole'] as const), air: null };
  const el = t - f.t0, flying = el < f.toss.flightMs, s = Math.max(0, Math.min(1, (el - f.toss.flightMs) / f.toss.slideMs));
  const n = f.after.bags.length - 1;
  const bags = f.after.bags.map((b, i) => {
    const m = f.toss.moves.find((q) => q.i === i);
    if (i === n && flying) return [b.u, b.v, 0, b.team, false] as const;
    if (!m) { const p = f.before[i] ?? b; return [p.u, p.v, lift(p.u, p.v), p.team, p.at !== 'hole'] as const; }
    const k = Math.max(0, Math.min(1, (s - m.delay) / Math.max(0.05, 1 - m.delay)));
    const e = 1 - (1 - k) * (1 - k);                                    // (sliding, slowing to a stop)
    const u = m.from[0] + (m.to[0] - m.from[0]) * e, v = m.from[1] + (m.to[1] - m.from[1]) * e;
    return [u, v, lift(u, v), b.team, !(m.at === 'hole' && k >= 0.98)] as const;
  });
  let air = null;
  if (flying) {
    const p = el / f.toss.flightMs, [u0, v0] = f.toss.from, [u1, v1] = f.toss.land;
    const h1 = lift(u1, v1), h = 3.2 * (1 - p) + h1 * p + f.toss.apex * 4 * p * (1 - p);
    air = { u: u0 + (u1 - u0) * p, v: v0 + (v1 - v0) * p, h, team: f.team, p };
  }
  return { bags, air };
}

/** Every frame; or, given `busy`, only while that says something is moving (and once more whenever the game or a toss
 *  changes): the bags in the campsite lie still between tosses, and must not keep the page drawing every frame meanwhile. */
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

// ── in the room: the bags on the boards and the grass, one in the air, and walking to my pitcher's box ──
export function CornholeRoom({ layout, mini, light }: { layout: FitLayout; mini: boolean; light: number }) {
  listen();
  const g = useGame();
  const open = useLocal((s) => s.open);
  const me = useStore((s) => s.me?.id);
  const mine = useStore((s) => (s.me ? s.presence[s.me.id] : undefined));
  const C = layout.things.cornhole as { left: number[]; right: number[]; y: number; spots: number[] };
  const X0 = C.left[1], Y0 = C.y, K = 8;                                 // u = 0 (the left board's front edge) is at X0; 8 dots a foot
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { useLocal.setState({ light }); }, [light]);
  useWatching(open && g?.on && me && !g.teams.some((m) => m.includes(me)) ? ID : null);

  // to my pitcher's box: when I join, and (alone on my side) every time it is pitched from the other end
  const where = g && me ? standing(g, me) : null;
  const sent = useRef('');
  useEffect(() => {
    if (where === null || !mine || mine.floor !== 'outside') { sent.current = ''; return; }
    const n = C.spots[where], q = layout.seats[n], key = `b${n}`;
    if (!q || (mine.place === 'here' && mine.at?.seat === key) || sent.current === key) return;
    sent.current = key;
    send({ t: 'place', place: 'here', x: q.x, y: q.y, seat: key });
  }, [where, mine?.floor, mine?.place, mine?.at?.seat]);   // eslint-disable-line react-hooks/exhaustive-deps

  // the bags: drawn straight onto absolutely placed dots, every frame (a few at most), but only touched when one has
  // moved (rewriting their styles every frame had the page work out their look again sixty times a second for nothing)
  const last = useRef<{ box: HTMLElement | null; key: string }>({ box: null, key: '' });
  useTicker((t) => {
    const box = ref.current;
    if (!box) return;
    const { bags, air } = bagsNow(g, t);
    const key = `${X0},${Y0}|${bags.map(([u, v, h, team, shown]) => `${u.toFixed(3)},${v.toFixed(3)},${h.toFixed(3)},${team},${shown}`).join(' ')}|${air ? `${air.u.toFixed(3)},${air.v.toFixed(3)},${air.h.toFixed(3)},${air.team},${Math.round(air.p * 720)}` : ''}`;
    if (last.current.box === box && last.current.key === key) return;
    last.current = { box, key };
    const want = bags.length + (air ? 2 : 0);
    while (box.children.length < want) box.appendChild(document.createElement('i'));
    while (box.children.length > want) box.lastChild!.remove();
    bags.forEach(([u, v, h, team, shown], i) => {
      const el = box.children[i] as HTMLElement;
      el.className = `ch-bag${h ? '' : ' grass'}`;
      el.style.cssText = `left:${X0 + u * K - 2}px;top:${Y0 + v * K - h * K - 2}px;background:${COLORS[team]};z-index:${Math.round(Y0 + 9 + v)};display:${shown ? 'block' : 'none'}`;
    });
    if (air) {
      const sh = box.children[bags.length] as HTMLElement, el = box.children[bags.length + 1] as HTMLElement;
      sh.className = 'ch-shadow';
      sh.style.cssText = `left:${X0 + air.u * K - 2}px;top:${Y0 + air.v * K - lift(air.u, air.v) * K - 1}px;z-index:${Y0 + 9}`;
      el.className = 'ch-bag air';
      el.style.cssText = `left:${X0 + air.u * K - 2}px;top:${Y0 + air.v * K - air.h * K - 2}px;background:${COLORS[air.team]};z-index:3000;transform:rotate(${Math.round(air.p * 720)}deg)`;
    }
  }, [g, X0, Y0], () => !!useLocal.getState().flight);

  const hot = (r: number[]) => ({ left: r[0] - 2, top: C.y - 18, width: r[1] - r[0] + 4, height: 28, zIndex: 2990 });
  const say = !g || (!g.on && !g.over) ? 'Cornhole: click to play or watch' : g.over ? `Cornhole: ${g.last}` : `Cornhole: ${TEAMS[0]} ${g.score[0]}, ${TEAMS[1]} ${g.score[1]}`;
  return (
    <>
      <div ref={ref} className="ch-bags" />
      {!mini && [C.left, C.right].map((r, k) => <i key={k} className="cf-hot" title={say} style={hot(r)} onClick={(e) => { e.stopPropagation(); useLocal.setState({ open: true }); }} />)}
      {open && !mini && createPortal(<Overlay />, document.querySelector('.main-view') ?? document.body)}
    </>
  );
}

// ── large: the whole pitch from above, both boards, every bag ──
// Two views, as the shuffleboard has: the whole pitch along the top, and the board being thrown at close up below it.
const W = 1000, H = 520, STRIP = 200, ZK = 62;
const ZOOM_U = 9, ZOOM_V = (H - STRIP - 8) / ZK;   // the close-up's size in feet
/** The view being drawn just now: dots a foot, and where its top-left corner is on the lane, and on the canvas. */
let K = 24, U0 = -6.2, V0 = -STRIP / 2 / 24, OX = 0, OY = 0;
const X = (u: number) => OX + (u - U0) * K, Y = (v: number) => OY + (v - V0) * K;
const strip = () => { K = 24; U0 = -6.2; V0 = -STRIP / 2 / 24; OX = 0; OY = 0; };
const zoom = (e: number) => {
  const b = BOARDS[e === 0 ? 1 : 0], mid = (b.u0 + b.u1) / 2 - (e === 0 ? 1 : -1) * 1.2;   // (a little more of the grass in front of it)
  K = ZK; U0 = mid - ZOOM_U / 2 - (W - ZOOM_U * ZK) / 2 / ZK; V0 = -ZOOM_V / 2; OX = 0; OY = STRIP + 8;
};
/** How far back a full-strength throw is dragged (canvas dots). */
const PULL = 260;

/** The lawn, drawn once: a strip of thick grass down the pitch, mown in bands, fading to black at its edges. */
let lawn: HTMLCanvasElement | null = null, lawnLight = -1;
function lawnFor(light: number) {
  if (lawn && Math.abs(lawnLight - light) < 0.05) return lawn;
  lawnLight = light;
  lawn = document.createElement('canvas'); lawn.width = W; lawn.height = H;
  const c = lawn.getContext('2d')!;
  const day = (a: number[]) => `rgb(${a.map((v) => Math.round(v * (0.28 + 0.72 * light))).join(',')})`;
  c.fillStyle = day([62, 120, 48]); c.fillRect(0, 0, W, H);
  for (let x = 0; x < W; x += 48) { c.fillStyle = (x / 48) % 2 ? 'rgba(255,255,200,0.05)' : 'rgba(0,0,0,0.05)'; c.fillRect(x, 0, 48, H); }   // mown bands
  let n = 7; const r = () => ((n = (n * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < 9000; k++) {                                       // blades, seen from above: short strokes every which way
    const x = r() * W, y = r() * H, a = r() * Math.PI * 2, l = 2 + r() * 4, g = r();
    c.strokeStyle = day(g < 0.33 ? [44, 92, 36] : g < 0.7 ? [86, 150, 60] : [128, 186, 84]);
    c.lineWidth = 1; c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); c.stroke();
  }
  const fade = (x0: number, y0: number, x1: number, y1: number) => { const g = c.createLinearGradient(x0, y0, x1, y1); g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)'); return g; };
  c.fillStyle = fade(0, 0, 0, 40); c.fillRect(0, 0, W, 40);
  c.fillStyle = fade(0, H, 0, H - 40); c.fillRect(0, H - 40, W, 40);
  c.fillStyle = fade(0, 0, 40, 0); c.fillRect(0, 0, 40, H);
  c.fillStyle = fade(W, 0, W - 40, 0); c.fillRect(W - 40, 0, 40, H);
  return lawn;
}

function drawBoard(c: CanvasRenderingContext2D, b: (typeof BOARDS)[number], light: number) {
  const x0 = X(b.u0), x1 = X(b.u1), y0 = Y(-HALF_W), y1 = Y(HALF_W), k = 0.4 + 0.6 * light;
  const sh = (hex: string) => { const n = parseInt(hex.slice(1), 16); return `rgb(${[n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.min(255, Math.round(v * k))).join(',')})`; };
  const back = b.hole < 0 ? x0 : x1;                                      // the high end
  const bw = Math.max(2, 0.12 * K), sd = 0.15 * K;
  c.fillStyle = 'rgba(0,0,0,0.35)'; c.fillRect(x0 + sd, y0 + sd * 1.3, x1 - x0, y1 - y0);   // its shadow
  c.fillStyle = sh('#2f5a44'); c.fillRect(x0, y0, x1 - x0, y1 - y0);      // the painted border
  const g = c.createLinearGradient(back, 0, back === x0 ? x1 : x0, 0);    // the deck, lighter toward its raised back
  g.addColorStop(0, sh('#e8d0a4')); g.addColorStop(1, sh('#cfb084'));
  c.fillStyle = g; c.fillRect(x0 + bw, y0 + bw, x1 - x0 - 2 * bw, y1 - y0 - 2 * bw);
  c.strokeStyle = `rgba(140,100,50,${0.25 * k})`; c.lineWidth = 1;
  for (let v = -0.55; v <= 0.6; v += 0.55) { c.beginPath(); c.moveTo(x0 + bw, Y(v)); c.lineTo(x1 - bw, Y(v)); c.stroke(); }   // the birch's grain
  const tx = X(b.hole < 0 ? b.u1 - 1.2 : b.u0 + 1.2), d = b.hole < 0 ? -1 : 1;   // a pine on it, its top toward the hole
  c.fillStyle = sh('#2f5a44'); c.beginPath(); c.moveTo(tx - d * 0.38 * K, Y(-0.38)); c.lineTo(tx - d * 0.38 * K, Y(0.38)); c.lineTo(tx + d * 0.46 * K, Y(0)); c.fill();
  c.fillStyle = '#0c0806'; c.beginPath(); c.arc(X(b.hole), Y(0), HOLE_R * K, 0, Math.PI * 2); c.fill();   // the hole
  c.strokeStyle = `rgba(255,240,210,${0.4 * k})`; c.lineWidth = 1.5; c.beginPath(); c.arc(X(b.hole), Y(0), HOLE_R * K, Math.PI * 0.75, Math.PI * 1.75); c.stroke();
  c.fillStyle = 'rgba(255,255,255,0.12)'; c.fillRect(X(b.hole < 0 ? b.u1 : b.u0) - 1, Y(-2.6), 2, Y(2.6) - Y(-2.6));   // the foul line, past its pitcher's boxes
}

/** A beanbag from above, `h` feet up (in the air: bigger, and its shadow left behind on the grass). */
function drawBag(c: CanvasRenderingContext2D, u: number, v: number, h: number, team: number, spin: number, light: number, air = false) {
  const s = BAG * K * (1 + h * 0.09), k = 0.45 + 0.55 * light;
  if (air) { c.fillStyle = 'rgba(0,0,0,0.3)'; c.beginPath(); c.ellipse(X(u) + h * 3, Y(v) + h * 4, BAG * K * 0.55, BAG * K * 0.45, 0, 0, Math.PI * 2); c.fill(); }
  const x = X(u), y = Y(v) - (air ? h * 2 : 0);
  c.save(); c.translate(x, y); c.rotate(spin);
  const col = team === 0 ? [206, 60, 42] : [44, 92, 206], rgb = (m: number) => `rgb(${col.map((q) => Math.min(255, Math.round(q * k * m))).join(',')})`;
  if (!air) { c.fillStyle = 'rgba(0,0,0,0.3)'; c.beginPath(); c.roundRect(-s / 2 + 2, -s / 2 + 2.5, s, s, s * 0.32); c.fill(); }
  c.fillStyle = rgb(0.72); c.beginPath(); c.roundRect(-s / 2, -s / 2, s, s, s * 0.32); c.fill();      // a soft, slumped square
  const g = c.createRadialGradient(-s * 0.15, -s * 0.18, 0, 0, 0, s * 0.62);
  g.addColorStop(0, rgb(1.25)); g.addColorStop(0.7, rgb(0.95)); g.addColorStop(1, rgb(0.7));
  c.fillStyle = g; c.beginPath(); c.roundRect(-s / 2 + 1, -s / 2 + 1, s - 2, s - 2, s * 0.3); c.fill();
  c.strokeStyle = `rgba(0,0,0,${0.25 * k})`; c.setLineDash([2, 2]); c.lineWidth = 1;               // its stitched seam
  c.beginPath(); c.roundRect(-s / 2 + 2.5, -s / 2 + 2.5, s - 5, s - 5, s * 0.25); c.stroke(); c.setLineDash([]);
  c.restore();
}

function Overlay() {
  const g = useGame();
  const me = useStore((s) => s.me?.id);
  const flight = useLocal((s) => s.flight);
  const ref = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ sx: number; sy: number; x: number; y: number } | null>(null);
  const downOn = useRef(false);
  const close = () => useLocal.setState({ open: false });
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, []);
  const shown = flight?.after ?? g;
  const myTeam = me && g ? g.teams.findIndex((m) => m.includes(me)) : -1;
  const myTurn = !!g && g.on && !g.over && !flight && !!me && thrower(g, g.turn) === me && g.thrown[g.turn] < BAGS;
  /** The throw a drag back makes: which way (the other way from the drag) and how hard (how far back). */
  const pull = (d: NonNullable<typeof drag.current>) => {
    const dir = ahead(g!.end), tu = -(d.x - d.sx) / K, tv = -(d.y - d.sy) / K;
    return { aim: Math.max(-0.35, Math.min(0.35, Math.atan2(tv * dir, tu * dir))), power: Math.min(1, Math.hypot(d.x - d.sx, d.y - d.sy) / PULL), back: (d.x - d.sx) * dir < 0 };
  };

  useTicker((t) => {
    const c = ref.current?.getContext('2d');
    if (!c) return;
    const light = useLocal.getState().light;
    const { bags, air } = bagsNow(shown, t);
    const e = shown?.end ?? 0;
    for (const [view, y0, h] of [[strip, 0, STRIP], [() => zoom(e), STRIP + 8, H - STRIP - 8]] as [() => void, number, number][]) {
      view();
      c.save(); c.beginPath(); c.rect(0, y0, W, h); c.clip();
      c.drawImage(lawnFor(light), 0, y0, W, h);
      for (const b of BOARDS) drawBoard(c, b, light);
      bags.forEach(([u, v, hh, team, vis]) => { if (vis) drawBag(c, u, v, hh, team, ((u * 7 + v * 3) % 1) - 0.5, light); });
      if (air) drawBag(c, air.u, air.v, air.h, air.team, air.p * 7, light, true);
      c.restore();
    }
    c.fillStyle = '#000'; c.fillRect(0, STRIP, W, 8);
    if (light < 1) { c.fillStyle = `rgba(6,10,34,${(1 - light) * 0.25})`; c.fillRect(0, 0, W, H); }
    strip();
    if (myTurn) {                                                         // my bag, ready in my hand, and the drag back
      const [ru, rv] = release(g!.end, g!.turn), d = drag.current;
      drawBag(c, ru, rv, 3, g!.turn, 0, light, true);
      if (d) {
        const { aim, power, back } = pull(d), dir = ahead(g!.end);
        c.strokeStyle = 'rgba(255,255,255,0.35)'; c.lineWidth = 2; c.beginPath(); c.moveTo(d.sx, d.sy); c.lineTo(d.x, d.y); c.stroke();   // the pull
        if (back) {
          c.setLineDash([6, 6]); c.strokeStyle = 'rgba(255,255,255,0.75)'; c.beginPath();   // which way (not how far)
          c.moveTo(X(ru), Y(rv)); c.lineTo(X(ru + dir * Math.cos(aim) * 6), Y(rv + dir * Math.sin(aim) * 6)); c.stroke(); c.setLineDash([]);
          const wob = Math.max(0, power - 0.5) * 0.5 * (Math.sin(t / 37) * 0.6 + Math.sin(t / 23 + 1.3) * 0.4), shownP = Math.max(0, Math.min(1, power + wob));
          const bx = W / 2 - 150, by = H - 22;
          c.fillStyle = 'rgba(0,0,0,0.6)'; c.fillRect(bx - 2, by - 2, 304, 12);
          const bg = c.createLinearGradient(bx, 0, bx + 300, 0); bg.addColorStop(0, '#f2c230'); bg.addColorStop(1, '#ff6a2a');
          c.fillStyle = bg; c.fillRect(bx, by, 300 * shownP, 8);
          c.fillStyle = 'rgba(255,255,255,0.75)'; c.font = '15px VT323, monospace'; c.textAlign = 'left'; c.fillText('STRENGTH', bx + 310, by + 8);
        }
      }
    }
    if (shown?.inning && !flight) {
      c.font = '30px VT323, monospace'; c.textAlign = 'center'; c.lineWidth = 4; c.strokeStyle = '#1a1008';
      const txt = `${TEAMS[0]} ${shown.inning[0]}  ·  ${TEAMS[1]} ${shown.inning[1]}`;
      c.strokeText(txt, W / 2, 34); c.fillStyle = '#ffe08a'; c.fillText(txt, W / 2, 34);
    }
  }, [g, flight, myTurn]);

  const pos = (ev: ReactPointerEvent<HTMLCanvasElement>) => { const r = pageRect(ev.currentTarget); return { x: ((ev.clientX - r.left) * W) / r.width, y: ((ev.clientY - r.top) * H) / r.height }; };
  const down = (ev: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!myTurn) return;
    try { ev.currentTarget.setPointerCapture(ev.pointerId); } catch { /* (still works inside) */ }
    const p = pos(ev);
    drag.current = { sx: p.x, sy: p.y, x: p.x, y: p.y };
  };
  const move = (ev: ReactPointerEvent<HTMLCanvasElement>) => { const d = drag.current; if (d) { const p = pos(ev); d.x = p.x; d.y = p.y; } };
  const up = () => {
    const d = drag.current;
    drag.current = null;
    if (!d || !myTurn) return;
    const { aim, power, back } = pull(d);
    if (!back || power < 0.05) return;
    send({ t: 'fit', id: ID, op: 'throw', aim, power });
  };

  const teams = g?.teams ?? [[], []];
  const between = !g?.on || g.over;
  const left = (n: number) => (g ? BAGS - g.thrown[n] : BAGS);
  const say = !g || (!g.on && !g.over)
    ? `${g?.last ? `${g.last} ` : ''}${teams[0].length && teams[1].length ? 'Both sides have players: start when ready.' : 'Join red or blue (one or two a side; or both, to practise). First to 21.'}`
    : g.over ? g.last
      : flight ? `${nameOf(flight.who)} throws…`
        : `${g.last ? `${g.last} ` : ''}${myTurn ? `Your throw (${TEAMS[g.turn]}, ${left(g.turn)} left): press anywhere, drag back away from the far board, and let go.` : g.thrown[0] >= BAGS && g.thrown[1] >= BAGS ? 'Picking up the bags…' : `${TEAMS[g.turn]} (${nameOf(thrower(g, g.turn))}) to throw.`}`;
  return (
    <div className="gr-overlay" onMouseDown={(ev) => { downOn.current = ev.target === ev.currentTarget; }} onClick={(ev) => { if (downOn.current && ev.target === ev.currentTarget) close(); }}>
      <div className="gr-box" onClick={(ev) => ev.stopPropagation()}>
        <header className="gr-tabs">
          <b className="mg-title">Cornhole</b>
          {[0, 1].map((n) => (
            <span key={n} className={`gr-player${g?.on && g.turn === n ? ' turn' : ''}`} style={{ borderColor: COLORS[n] }}>
              <b style={{ color: COLORS[n] }}>{TEAMS[n]}</b> {teams[n].map(nameOf).join(' & ') || 'nobody'}
              {between && me && !teams[n].includes(me) && teams[n].length < 2 && <button onClick={() => send({ t: 'fit', id: ID, op: 'join', team: n })}>Join</button>}
              {' '}<span className="ch-left">{'■'.repeat(left(n))}{'□'.repeat(BAGS - left(n))}</span> <b>{g?.score[n] ?? 0}</b>
            </span>
          ))}
          <span />
          {myTeam >= 0 && between && teams[0].length > 0 && teams[1].length > 0 && <button onClick={() => send({ t: 'fit', id: ID, op: 'start' })}>{g?.over ? 'Play again' : 'Start'}</button>}
          {myTeam >= 0 && <button onClick={() => { send({ t: 'fit', id: ID, op: 'leave' }); close(); }}>Leave</button>}
          <button onClick={close} title="Back to the campsite (Esc)">Close</button>
        </header>
        <div className="gr-fill"><canvas ref={ref} className={`gr-table${myTurn ? ' mine' : ''}`} style={{ '--ar': W / H } as CSSProperties} width={W} height={H} onPointerDown={down} onPointerMove={move} onPointerUp={up} /></div>
        <p className="gr-say">{say}</p>
      </div>
    </div>
  );
}

// ── sounds: the bag landing (a thud on the deck, a soft thump on the grass), a swish into the hole, a knock on a bag ──
let actx: AudioContext | null = null, noise: AudioBuffer | null = null;
function sound(f: Flight) {
  const s = useStore.getState();
  const vol = s.voice.deafened ? 0 : soundGain(s.prefs.soundVol) * 0.5;
  if (!vol || !useLocal.getState().open || document.hidden) return;
  try {
    actx ??= new AudioContext();
    void actx.resume().catch(() => {});
    if (!noise) { noise = actx.createBuffer(1, actx.sampleRate, actx.sampleRate); const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
  } catch { return; }
  const a = actx, t0 = a.currentTime + f.toss.flightMs / 1000;
  const burst = (at: number, dur: number, type: BiquadFilterType, freq: number, gain: number) => {
    const src = a.createBufferSource(), fl = a.createBiquadFilter(), gn = a.createGain();
    src.buffer = noise; fl.type = type; fl.frequency.value = freq;
    gn.gain.setValueAtTime(Math.max(0.0001, gain), at); gn.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(fl).connect(gn).connect(out(a, ID)); src.start(at, Math.random() * 0.5); src.stop(at + dur + 0.02);
  };
  const thud = (at: number, gain: number) => {
    const o = a.createOscillator(), gn = a.createGain();
    o.frequency.setValueAtTime(150, at); o.frequency.exponentialRampToValueAtTime(70, at + 0.12);
    gn.gain.setValueAtTime(gain, at); gn.gain.exponentialRampToValueAtTime(0.0001, at + 0.14);
    o.connect(gn).connect(out(a, ID)); o.start(at); o.stop(at + 0.16);
  };
  const n = f.after.bags.length - 1, mine = f.toss.moves.find((m) => m.i === n);
  const landed = lift(f.toss.land[0], f.toss.land[1]) > 0;
  if (landed) { thud(t0, vol * 0.9); burst(t0, 0.08, 'lowpass', 420, vol * 0.8); burst(t0 + 0.05, f.toss.slideMs / 1000, 'bandpass', 1400, vol * 0.12); }
  else if (mine?.at === 'hole') burst(t0, 0.25, 'bandpass', 2200, vol * 0.4);
  else { burst(t0, 0.07, 'lowpass', 260, vol * 0.5); }
  for (const m of f.toss.moves) {
    const at = t0 + (m.delay * f.toss.slideMs) / 1000;
    if (m.i !== n && m.delay > 0) { thud(at, vol * 0.4); burst(at, 0.04, 'bandpass', 900, vol * 0.4); }
    if (m.at === 'hole') burst(at + f.toss.slideMs / 1000 * 0.8, 0.3, 'bandpass', 1800, vol * 0.45);
  }
}
