// The robot vacuum in the main room (art in client/src/vacuum-art.ts). It lives on a dock against the back wall under the
// whiteboard, behind the cinema seats (out of everybody's way), and several times a day drives out along a fixed lane
// round the end of the last desk (LANE) and cleans the wood floor: straight on until
// it meets something (furniture, the walls, the rug's boombox), then a turn and on again; anybody standing in its way
// gets their feet bumped (it stops, jolts back a dot, turns and goes on; nothing happens to them). After a couple of
// minutes it finds its way back along the floor to the lane, and along that home, and parks.
//
// Everybody sees the same without the server saying anything: when it runs comes from the clock (as the pets' days do),
// and the run itself is worked out tick by tick (TICK) from when it started, from the room's walk grid and whoever is
// standing about. A run is more likely when the room is quiet (a slot with QUIET_ONLY runs only when at most one person
// is in the room as it starts). Clicking it offers Send it home / Start cleaning: those are the server's
// (server/basement/vacuum.ts keeps the last hour's, op 'start' or 'home', and when), so they are the same for everybody.
//
// A cat in the room may ride it: the run's seed picks whether and which, when it trots over and hops on, and whether it
// hops off partway or rides it home. A dog that it passes may chase it a few steps. The pets themselves are the room's
// (Clubhouse.tsx); it calls vacuumPet() for each one every frame, and that moves them while they are busy with the
// vacuum (marked `held`, so the room leaves them be) and lets them go after.
//
// `?vacuum` in the address runs it every few minutes, for trying it out.
import { memo, useEffect, useRef } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { create } from 'zustand';
import { CLUB } from './clubhouse.gen';
import { send, useStore } from './store';
import { DOCK_H, DOCK_PARK, DOCK_W, dockPic, HEADINGS, VAC_H, VAC_PER, VAC_RX, VAC_RY, VAC_TOP, VAC_W, VAC_X, VAC_Y, vacuumFrame } from './vacuum-art';
import type { Pic } from './vacuum-art';
import './vacuum.css';

type Pt = { x: number; y: number };
/** What the room hands over of the people in it, and of its pets (their own types are Clubhouse.tsx's). */
type Body = { x: number; y: number; arrived: boolean; goal: { fx: string } };
type PetLike = Pt & { path: Pt[]; pose: string; held: boolean; slot: number; perch: number; bed?: number };
type Order = { op: 'start' | 'home'; at: number };

const TEST = new URLSearchParams(location.search).has('vacuum');
const TICK = 50;                                     // ms a step of the run
const STEP = 1;                                      // dots a step: 20 a second
const TURN = 0.22;                                   // radians a step while turning on the spot
const SLOT = TEST ? 6 * 60_000 : 40 * 60_000;        // one chance of a run in every slot
const CLEAN_MS = 120_000;                            // how long a run cleans (plus up to a minute, by its seed)
const BUMP_TICKS = 20;                               // stood still after bumping somebody's feet

// ── the floor it cleans: the main room's wood floor, below the desks' chairs and above the bathroom and kitchen ──
const C = CLUB.cell, COLS = CLUB.grid[0].length, ROWS = CLUB.grid.length;
const walk = (c: number, r: number) => r >= 0 && r < ROWS && c >= 0 && c < COLS && CLUB.grid[r][c] === '.';
const ROOM = { c0: 0, c1: Math.floor(350 / C) - 1, r0: Math.ceil(130 / C), r1: Math.floor(230 / C) - 1 };
const mine = (c: number, r: number) => walk(c, r) && c >= ROOM.c0 && c <= ROOM.c1 && r >= ROOM.r0 && r <= ROOM.r1;
const cellOf = (p: Pt): [number, number] => [Math.floor(p.x / C), Math.floor(p.y / C)];
const onFloor = (p: Pt) => mine(...cellOf(p));
const centre = (c: number, r: number): Pt => ({ x: c * C + C / 2, y: r * C + C / 2 });
/** Points round its footprint: all of them must be on its floor. */
const RIM = Array.from({ length: 12 }, (_, k) => [Math.cos((k * Math.PI) / 6) * (VAC_RX - 1), Math.sin((k * Math.PI) / 6) * (VAC_RY - 1)]);
const fits = (p: Pt) => onFloor(p) && RIM.every(([dx, dy]) => onFloor({ x: p.x + dx, y: p.y + dy }));
/** Cells it fits in whole, standing on the middle of one: what it drives home along. */
const ROOMY = new Set<string>();
for (let r = ROOM.r0; r <= ROOM.r1; r++) for (let c = ROOM.c0; c <= ROOM.c1; c++) if (fits(centre(c, r))) ROOMY.add(`${c},${r}`);
const roomy = (c: number, r: number) => ROOMY.has(`${c},${r}`);

/** Where the dock's picture goes (against the back wall, under the right-hand end of the whiteboard and the projector's
 *  screen, behind the cinema seats: in the corner, not in the middle), and where the vacuum parks on it
 *  (its footprint's middle). */
const DOCK_AT = [CLUB.board[0] + CLUB.board[2] - 20 - DOCK_PARK[0], 92];
const PARK: Pt = { x: DOCK_AT[0] + DOCK_PARK[0], y: DOCK_AT[1] + DOCK_PARK[1] };
/** Which way it faces on the dock: away from the wall, into the room (south). */
const DOCK_A = Math.PI / 2;
/** The dock is on the lounge's floor, not the boards it cleans: the way between the two, driven out and back. Off the
 *  dock towards the seats, along behind them to the left speaker, then round the end of the last desk on to the
 *  boards (LANE_END, the first place it fits on its floor). The corridor is narrower than the walk grid's padding for
 *  people, so it keeps to this line rather than finding its own way. */
const LANE_END: Pt = (() => {
  let best: Pt = centre(...cellOf({ x: 338, y: 142 })), d = Infinity;
  for (const key of ROOMY) {
    const [c, r] = key.split(',').map(Number), p = centre(c, r), e = Math.hypot(p.x - 338, p.y - 142);
    if (e < d) { d = e; best = p; }
  }
  return best;
})();
const LANE: Pt[] = [PARK, { x: PARK.x, y: 124 }, { x: 348, y: 124 }, LANE_END];
/** Which stretch of the lane a point is on (k: from LANE[k] to LANE[k + 1]): the nearest. */
function laneAt(p: Pt): number {
  let best = 0, d = Infinity;
  for (let k = 0; k < LANE.length - 1; k++) {
    const a = LANE[k], b = LANE[k + 1], len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const u = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / len ** 2));
    const e = Math.hypot(a.x + (b.x - a.x) * u - p.x, a.y + (b.y - a.y) * u - p.y);
    if (e < d) { d = e; best = k; }
  }
  return best;
}

/** Shortest way between two points over walkable cells (four ways), as points to go through; `ok` says which cells. */
function route(from: Pt, to: Pt, ok: (c: number, r: number) => boolean): Pt[] {
  const near = (p: Pt): [number, number] => {
    const [c0, r0] = cellOf(p);
    for (let d = 0; d < 12; d++) for (let r = r0 - d; r <= r0 + d; r++) for (let c = c0 - d; c <= c0 + d; c++) if (Math.max(Math.abs(r - r0), Math.abs(c - c0)) === d && ok(c, r)) return [c, r];
    return [c0, r0];
  };
  const [sc, sr] = near(from), [tc, tr] = near(to);
  // (a point off the grid has no way: the walk back from it ran on forever and killed the page, as the room's did)
  if (!(sc >= 0 && sc < COLS && sr >= 0 && sr < ROWS && tc >= 0 && tc < COLS && tr >= 0 && tr < ROWS)) return [];
  const prev = new Int32Array(COLS * ROWS).fill(-1), start = sr * COLS + sc, end = tr * COLS + tc;
  const queue = [end];
  prev[end] = end;
  for (let i = 0; i < queue.length && prev[start] < 0; i++) {
    const at = queue[i], c = at % COLS, r = (at - c) / COLS;
    for (const [dc, dr] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
      const nc = c + dc, nr = r + dr, n = nr * COLS + nc;
      if (ok(nc, nr) && prev[n] < 0) { prev[n] = at; queue.push(n); }
    }
  }
  const out: Pt[] = [];
  if (prev[start] < 0) return out;
  for (let at = start; ; at = prev[at]) { out.push(centre(at % COLS, Math.floor(at / COLS))); if (at === end) break; if (out.length > COLS * ROWS) return []; }
  return out.filter((p, i) => i === 0 || i === out.length - 1 || !((out[i - 1].x === p.x && out[i + 1].x === p.x) || (out[i - 1].y === p.y && out[i + 1].y === p.y)));
}

const scramble = (n: number) => {
  let t = (n + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return (t ^ (t >>> 14)) >>> 0;
};
const hashOf = (s: string) => { let h = 7; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; };

// ── when it runs ──
/** Each slot's run: when it would start, how long it cleans, and whether it goes always or only into a quiet room.
 *  A slot is worked out from the vacuum on its dock as the slot begins; if it was still out then (cleaning on from a
 *  Start cleaning late in the slot before), from the start of the slot before, the two slots' starts and orders together. */
function slotRun(n: number) {
  const h = scramble(n * 7 + 3), pick = (h >>> 10) % 100;
  return { start: n * SLOT + (h % Math.floor(SLOT * (TEST ? 0.2 : 0.7))), clean: CLEAN_MS + ((h >>> 3) % 60) * 1000, seed: h, kind: TEST || pick < 30 ? 'always' : pick < 72 ? 'quiet' : 'none' };
}
/** Whether a slot that runs only into a quiet room did: decided once, by how many were here when this page first asked. */
const quietSlots = new Map<number, boolean>();
let inRoom = 0;

type Start = { op: 'start' | 'home'; at: number; clean: number };
type Run = { slot: number; start: number; seed: number; orders: Start[] };
/** One slot's starts and orders, up to time T. */
function slotStarts(n: number, orders: Order[], T: number): Start[] {
  const s = slotRun(n), list: Start[] = [];
  if (s.kind === 'quiet' && s.start <= T && !quietSlots.has(n)) quietSlots.set(n, inRoom <= 1);
  if (s.kind === 'always' || (s.kind === 'quiet' && quietSlots.get(n))) list.push({ op: 'start', at: s.start, clean: s.clean });
  for (const o of orders) if (o.at >= n * SLOT && o.at < (n + 1) * SLOT) list.push({ ...o, clean: CLEAN_MS });
  return list.filter((o) => o.at <= T).sort((a, b) => a.at - b.at);
}
const runOf = (n: number, starts: Start[]): Run => ({ slot: n, start: n * SLOT, seed: slotRun(n).seed, orders: starts });
const keyOf = (run: Run) => `${run.slot}/${run.orders.map((o) => `${o.op}${o.at}`).join(',')}`;
/** Whether the vacuum was still out as slot n began (its slot before worked out to the end; kept, by what went into it). */
const outAt = new Map<string, boolean>();
function stillOut(n: number, orders: Order[]): boolean {
  const run = runOf(n - 1, slotStarts(n - 1, orders, n * SLOT - 1)), key = keyOf(run);
  let out = outAt.get(key);
  if (out === undefined) {
    const s = docked(key, run);
    if (s.run!.orders.length) { s.until = 0; while (s.tick < SLOT / TICK) { s.tick++; stepSim(s, run.start + s.tick * TICK); } }
    out = s.mode !== 'docked';
    if (outAt.size > 50) outAt.clear();
    outAt.set(key, out);
  }
  return out;
}
/** The run going at time T (server clock): from the start of T's slot, or of the slot before when it was still out. */
function runAt(T: number, orders: Order[]): Run {
  const n = Math.floor(T / SLOT), here = slotStarts(n, orders, T);
  return stillOut(n, orders) ? runOf(n - 1, [...slotStarts(n - 1, orders, T), ...here]) : runOf(n, here);
}

// ── the run, step by step ──
type Sim = Pt & { a: number; orders: number; mode: 'out' | 'clean' | 'home' | 'docked'; turnTo: number | null; pause: number; bumps: number; path: Pt[]; until: number; tick: number; key: string; run: Run | null; z: number;
  /** when it last left the dock (-1: not yet this slot): an outing, for the pets */
  left: number;
  /** who it bumped last, and at which tick: it does not go on bumping the same feet */
  bumped: Map<string, number> };
const docked = (key = '', run: Run | null = null): Sim => ({ ...PARK, a: DOCK_A, orders: 0, mode: 'docked', turnTo: null, pause: 0, bumps: 0, path: [], until: 0, tick: 0, key, run, z: PARK.y + Math.round(VAC_RY), left: -1, bumped: new Map() });
let sim: Sim = docked();
/** Feet to keep clear of this step: people standing on the floor, and pets sat on it. */
let feet: [string, Pt][] = [];
/** The outing going (or last gone on): which slot, and when it left the dock. */
const outing = () => `${sim.run?.slot ?? ''}/${sim.left}`;

const angleTo = (from: Pt, to: Pt) => Math.atan2(to.y - from.y, to.x - from.x);
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

function goHome(s: Sim) {
  const was = s.mode;
  s.mode = 'home';
  s.turnTo = null;
  // still on the lane (on the way out, or already on the way back): back along it
  if (was === 'out' || !onFloor(s)) { s.path = LANE.slice(0, laneAt(s) + 1).reverse(); return; }
  // round anybody standing in the way (their cell and the ones next to it), if there is a way round, to the lane's end, then along it
  const taken = new Set(feet.map(([, f]) => cellOf(f)).flatMap(([c, r]) => [-1, 0, 1].flatMap((dc) => [-1, 0, 1].map((dr) => `${c + dc},${r + dr}`))));
  const here = cellOf(s).join(), park = cellOf(LANE_END).join();
  const ok = (c: number, r: number) => `${c},${r}` === here || `${c},${r}` === park || roomy(c, r);
  const round = route(s, LANE_END, (c, r) => ok(c, r) && (!taken.has(`${c},${r}`) || `${c},${r}` === here || `${c},${r}` === park));
  let way = round.length ? round : route(s, LANE_END, ok);
  if (!way.length) way = route(s, LANE_END, mine);
  s.path = [...way.slice(1), ...LANE.slice(0, -1).reverse()];
}
/** Off the dock (or turned back from going home while still on the lane): along the lane to its floor. */
function goOut(s: Sim) {
  s.mode = 'out';
  s.turnTo = null;
  s.path = LANE.slice(laneAt(s) + 1);
}

/** One step of the run, at time tt. */
function stepSim(s: Sim, tt: number) {
  const run = s.run!;
  while (s.orders < run.orders.length && run.orders[s.orders].at <= tt) {      // (each order is acted on in the step it falls in)
    const o = run.orders[s.orders++];
    if (o.op === 'home' && (s.mode === 'clean' || s.mode === 'out')) goHome(s);
    if (o.op === 'start') {
      s.until = o.at + o.clean;                                  // (already out: it keeps going that much longer)
      if (s.mode === 'docked') { s.left = o.at; goOut(s); }
      else if (s.mode === 'home') { if (onFloor(s)) { s.mode = 'clean'; s.path = []; s.turnTo = null; } else goOut(s); }
    }
  }
  if (s.mode === 'clean' && tt >= s.until) goHome(s);
  if (s.mode === 'docked') return;
  if (tt >= run.start + 2 * SLOT - TICK) { Object.assign(s, PARK, { mode: 'docked', a: DOCK_A, path: [], turnTo: null, pause: 0 }); return; }      // (never out over two slots: it is home, however far it had got)
  if (s.pause > 0) { s.pause--; return; }
  if (s.turnTo !== null) {                                    // turning on the spot
    const d = wrap(s.turnTo - s.a);
    if (Math.abs(d) <= TURN) { s.a = s.turnTo; s.turnTo = null; } else s.a = wrap(s.a + Math.sign(d) * TURN);
    return;
  }
  // somebody's feet just in front: bump, a dot back, stand a moment, then turn away (on the way home: just wait a moment, then on)
  for (const [id, f] of feet) {
    const dx = f.x - s.x, dy = f.y - s.y;
    if ((dx / (VAC_RX + 3)) ** 2 + (dy / (VAC_RY + 3)) ** 2 >= 1 || dx * Math.cos(s.a) + dy * Math.sin(s.a) <= 0) continue;
    if (s.tick - (s.bumped.get(id) ?? -1e9) < 60) continue;
    s.bumped.set(id, s.tick);
    const back = { x: s.x - Math.cos(s.a), y: s.y - Math.sin(s.a) };
    if (fits(back)) { s.x = back.x; s.y = back.y; }
    s.pause = BUMP_TICKS;
    if (s.mode === 'clean') s.turnTo = turnFrom(s, angleTo(s, f));
    else if (s.mode === 'home') goHome(s);                     // (on the way home: a way round them; on the lane, it only waits)
    return;
  }
  if (s.mode === 'out') {                                     // along the lane: a turn at each bend, then on
    const to = s.path[0];
    if (!to) { s.mode = 'clean'; return; }
    const want = angleTo(s, to), d = Math.hypot(to.x - s.x, to.y - s.y);
    if (d > 0.5 && Math.abs(wrap(want - s.a)) > 0.3) { s.turnTo = want; return; }
    if (d <= STEP) { s.x = to.x; s.y = to.y; s.path.shift(); if (!s.path.length) s.mode = 'clean'; }
    else { s.x += ((to.x - s.x) / d) * STEP; s.y += ((to.y - s.y) / d) * STEP; }
    return;
  }
  if (s.mode === 'home') {
    const to = s.path[0];
    if (!to) { s.x = PARK.x; s.y = PARK.y; s.mode = 'docked'; s.a = DOCK_A; return; }
    const want = angleTo(s, to), d = Math.hypot(to.x - s.x, to.y - s.y);
    if (d > 0.5 && Math.abs(wrap(want - s.a)) > 0.3) { s.turnTo = want; return; }
    if (d <= STEP) { s.x = to.x; s.y = to.y; s.path.shift(); if (!s.path.length) s.turnTo = DOCK_A; }
    else { s.x += ((to.x - s.x) / d) * STEP; s.y += ((to.y - s.y) / d) * STEP; }
    if (!s.path.length && s.turnTo === null) { s.mode = 'docked'; s.a = DOCK_A; }
    return;
  }
  const next = { x: s.x + Math.cos(s.a) * STEP, y: s.y + Math.sin(s.a) * STEP };
  if (fits(next)) { s.x = next.x; s.y = next.y; return; }
  s.pause = 3;                                                 // (a knock against the furniture)
  s.turnTo = turnFrom(s, s.a);
  if (s.turnTo === null) goHome(s);                            // boxed in: home
}
/** A new way to go, away from `hit` (the way it ran into something): roughly back the way it came, by its seed, and
 *  open for a few dots at least. */
function turnFrom(s: Sim, hit: number): number | null {
  const h = scramble(s.run!.seed + s.bumps++ * 977);
  const off = ((h % 1000) / 1000 - 0.5) * 2.4;                 // up to about 70 degrees either side of straight back
  const ahead = (a: number) => [3, 6, 9].every((d) => fits({ x: s.x + Math.cos(a) * d, y: s.y + Math.sin(a) * d }));
  for (let k = 0; k < 16; k++) {
    const a = wrap(hit + Math.PI + off + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.35);
    if (ahead(a)) return a;
  }
  return null;
}

/** Brings the run up to time T: the slot worked out step by step from its start. A new slot starts afresh (on the
 *  dock); an order that comes in is folded in where it falls, carrying on from where it is if that is still ahead. */
function advance(T: number, orders: Order[]) {
  const run = runAt(T, orders);
  const key = keyOf(run);
  if (key !== sim.key) {
    const was = sim, same = was.run?.slot === run.slot && was.orders <= run.orders.length
      && run.orders.slice(0, was.orders).every((o, k) => o.at === was.run!.orders[k].at && o.op === was.run!.orders[k].op)
      && (run.orders[was.orders]?.at ?? Infinity) > run.start + was.tick * TICK;
    sim = same ? { ...was, key, run } : docked(key, run);
  }
  const target = Math.floor((T - run.start) / TICK);
  while (sim.tick < target) { sim.tick++; stepSim(sim, run.start + sim.tick * TICK); }
  sim.z = Math.round(sim.y + VAC_RY);
}

// ── what the room calls ──
// (every copy of the room draws it: the room itself, and a small one in a panel. Each has its own element, and all are
// moved; one module-wide element meant that whichever mounted last, or closing the small copy, left the room's own
// vacuum unmoved, sat at the top left corner)
const els = new Set<HTMLElement>(), dockEls = new Set<HTMLElement>();
let shown = '', dockShown = '';
const now = () => Date.now() - (useStore.getState().music.skew || 0);
const ordersOf = (v: unknown): Order[] => (v && Array.isArray((v as { orders?: unknown }).orders) ? (v as { orders: Order[] }).orders : []);
const useOrder = () => useStore((s) => s.fits.vacuum);

/** Every frame, upstairs: moves the vacuum on and draws it. `people`: the room's characters (their feet); `pets`: its pets. */
export function stepVacuum(t: number, people: Map<string, Body>, pets: Map<string, PetLike>) {
  inRoom = 0;
  const f: [string, Pt][] = [];
  for (const [id, a] of people) {
    if (a.goal.fx === 'gone') continue;
    if (!id.startsWith('fam:')) inRoom++;
    if (a.arrived && walk(...cellOf(a))) f.push([id, { x: a.x, y: a.y }]);       // (stood on the floor: not sat in a seat)
  }
  for (const [id, p] of pets) if (!p.held && p.pose !== 'gone' && !p.path.length && p.perch < 0 && p.bed === undefined && walk(...cellOf(p))) f.push([`pet:${id}`, { x: p.x, y: p.y }]);
  feet = f;
  advance(now(), ordersOf(useStore.getState().fits.vacuum));
  // the cats in the room last frame (all of them: vacuumPet hears of each in turn), and this run's rider picked from them
  const here = [...cats].sort();
  cats.clear();
  if (ride.run !== outing() && frames++ > 1) {
    if (ride.pet && ride.state !== 'done' && ride.state !== 'wait') let_go(ride.pet);
    ride = { run: outing(), state: 'done', t0: 0, from: PARK, to: PARK, retarget: 0 };
    const h = scramble(Math.floor(sim.left / 1000) ^ 0x5eed);
    if (sim.left >= 0 && h % 100 < 70 && here.length) ride = { ...ride, state: 'wait', id: here[(h >>> 8) % here.length] };
  }
  if (!els.size) return;
  const h = ((Math.round(sim.a / (Math.PI / 4)) % HEADINGS) + HEADINGS) % HEADINGS;
  const frame = h * VAC_PER + (sim.mode === 'docked' ? 2 : Math.floor(t / 110) % 2);
  const key = `${Math.round(sim.x)},${Math.round(sim.y)},${frame}`;
  if (key === shown) return;
  shown = key;
  for (const el of els) {
    el.style.transform = `translate(${Math.round(sim.x) - VAC_X}px, ${Math.round(sim.y) - VAC_Y}px)`;
    el.style.zIndex = String(sim.z);
    el.style.backgroundPosition = `${-frame * VAC_W}px 0`;
    el.dataset.mode = sim.mode;
  }
  const out = String(sim.mode !== 'docked');
  if (art && dockShown !== out) {
    dockShown = out;
    for (const d of dockEls) { d.dataset.out = out; d.style.backgroundImage = `url(${sim.mode !== 'docked' ? art.dockOff : art.dockOn})`; }
  }
}

// ── the pets ──
type Ride = { run: string; state: 'wait' | 'approach' | 'hop' | 'ride' | 'off' | 'done'; pet?: PetLike; id?: string; t0: number; from: Pt; to: Pt; retarget: number };
let frames = 0;
let ride: Ride = { run: '', state: 'done', t0: 0, from: PARK, to: PARK, retarget: 0 };
const cats = new Set<string>();
const chases = new Map<string, { pet: PetLike; until: number; retarget: number; run: string }>();
const chased = new Map<string, number>();                        // dog → when it last thought about chasing it (once in CHASE_GAP)
const CHASE_GAP = 20_000;
const HOP_MS = 450;
const let_go = (p: PetLike) => { p.held = false; p.path = []; p.slot = -1; };      // (slot -1: the room gives it something to do next)

/** For each pet, every frame (after stepVacuum): moves it while it is riding the vacuum or chasing it. Returns the
 *  depth to draw it at while it is on or hopping on or off; null otherwise (the room places it as usual). */
export function vacuumPet(id: string, kind: 'cat' | 'dog', p: PetLike, t: number): number | null {
  const live = sim.mode !== 'docked', out = outing(), seed = Math.floor(sim.left / 1000);
  if (kind === 'cat' && p.pose !== 'gone') cats.add(id);
  const T = now();
  if (kind === 'dog') {
    const c = chases.get(id);
    if (c) {
      if (c.pet !== p || T > c.until || !live || out !== c.run) { if (c.pet === p) let_go(p); chases.delete(id); return null; }
      if (t > c.retarget) {                                      // a few steps after it, staying a little behind
        c.retarget = t + 500;
        const behind = { x: sim.x - Math.cos(sim.a) * 18, y: sim.y - Math.sin(sim.a) * 10 };
        p.path = [...route(p, behind, walk), behind].slice(1);
      }
      return null;
    }
    if (live && sim.mode === 'clean' && !p.held && !p.path.length && p.pose === 'sit' && p.bed === undefined && p.perch < 0
      && Math.hypot(p.x - sim.x, p.y - sim.y) < 45 && T - (chased.get(id) ?? 0) > CHASE_GAP) {
      chased.set(id, T);
      if (scramble(seed ^ hashOf(id) ^ Math.floor(T / CHASE_GAP)) % 100 < 45) { p.held = true; chases.set(id, { pet: p, until: T + 2500 + (hashOf(id) % 1500), retarget: 0, run: out }); }
    }
    return null;
  }
  // a cat: is it this outing's rider (picked in stepVacuum)?
  if (ride.run !== out || ride.id !== id || ride.state === 'done' || sim.left < 0) return null;
  const h = scramble(seed ^ 0x5eed);
  const boardAt = sim.left + 8000 + ((h >>> 16) % 25) * 1000;
  const offAt = (h >>> 20) % 2 ? Infinity : sim.left + 50_000 + ((h >>> 4) % 60) * 1000;      // partway, or it rides it home
  const top = { x: sim.x, y: sim.y - VAC_TOP };
  if (ride.pet && ride.pet !== p) { ride.state = 'done'; return null; }       // (the room has a new one of it: it went out, say)
  switch (ride.state) {
    case 'wait':
      if (sim.mode !== 'clean' || T < boardAt) return null;
      if (p.held || p.pose === 'gone' || p.bed !== undefined) { ride.state = 'done'; return null; }       // busy (being petted, asleep on somebody): no ride this time
      p.held = true; ride.pet = p; ride.state = 'approach'; ride.t0 = T; ride.retarget = 0;
      return null;
    case 'approach':
      if (sim.mode !== 'clean' || T - ride.t0 > 30_000) { let_go(p); ride.state = 'done'; return null; }
      if (Math.hypot(p.x - sim.x, p.y - sim.y) < 16) { p.path = []; ride.state = 'hop'; ride.t0 = t; ride.from = { x: p.x, y: p.y }; return null; }
      if (t > ride.retarget || !p.path.length) { ride.retarget = t + 700; p.path = [...route(p, sim, walk), { x: sim.x, y: sim.y }].slice(1); }
      return null;
    case 'hop': case 'off': {
      const u = Math.min(1, (t - ride.t0) / HOP_MS), to = ride.state === 'hop' ? top : ride.to;
      p.path = [];
      p.pose = 'sit';
      p.x = ride.from.x + (to.x - ride.from.x) * u;
      p.y = ride.from.y + (to.y - ride.from.y) * u - Math.sin(u * Math.PI) * 7;
      if (u >= 1) {
        if (ride.state === 'hop') ride.state = 'ride';
        else { p.x = to.x; p.y = to.y; let_go(p); ride.state = 'done'; return null; }
      }
      return sim.z + 1;
    }
    case 'ride': {
      p.path = []; p.pose = 'sit'; p.x = top.x; p.y = top.y;
      if (sim.mode === 'docked' || T >= offAt || (sim.mode === 'home' && offAt !== Infinity)) {
        // off to one side, wherever there is floor
        const side = [1, -1, 2].map((k) => ({ x: sim.x + Math.cos(sim.a + (k * Math.PI) / 2) * 16, y: sim.y + Math.sin(sim.a + (k * Math.PI) / 2) * 10 }))
          .find((q) => walk(...cellOf(q))) ?? { x: sim.x + 14, y: sim.y + 4 };
        ride.state = 'off'; ride.t0 = t; ride.from = { ...top }; ride.to = side;
      }
      return sim.z + 1;
    }
  }
  return null;
}

/** Where it is and what it is doing (for trying it out from the page's console). */
export const vacuumNow = () => ({ x: sim.x, y: sim.y, a: sim.a, mode: sim.mode, tick: sim.tick, run: sim.key, rider: ride.id ?? null, ride: ride.state, bumps: sim.bumps, pause: sim.pause, chasing: [...chases.keys()] });

// ── the vacuum and its dock in the room, and its menu ──
const SCALE = 4;
const toUrl = (pics: Pic[]) => {
  const w = pics.reduce((n, p) => n + p.w, 0), h = Math.max(...pics.map((p) => p.h));
  const one = document.createElement('canvas'), big = document.createElement('canvas');
  one.width = w; one.height = h; big.width = w * SCALE; big.height = h * SCALE;
  let x = 0;
  for (const p of pics) { one.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(p.px), p.w, p.h), x, 0); x += p.w; }
  const g = big.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  g.drawImage(one, 0, 0, big.width, big.height);
  return big.toDataURL();
};
let art: { vac: string; dockOn: string; dockOff: string } | null = null;
const artNow = () => (art ??= {
  vac: toUrl(Array.from({ length: HEADINGS * VAC_PER }, (_, k) => vacuumFrame(Math.floor(k / VAC_PER), k % VAC_PER))),
  dockOn: toUrl([dockPic(true)]), dockOff: toUrl([dockPic(false)]),
});

const useMenu = create<{ open: Pt | null }>(() => ({ open: null }));

export const Vacuum = memo(function Vacuum({ mini }: { mini: boolean }) {
  const order = useOrder();
  const { open } = useMenu();
  const menuNode = useRef<HTMLDivElement>(null);
  const pics = artNow();
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!menuNode.current?.contains(e.target as Node)) useMenu.setState({ open: null }); };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);
  const mine = useRef<{ el: HTMLElement | null; dock: HTMLElement | null }>({ el: null, dock: null });
  const keep = (set: Set<HTMLElement>, k: 'el' | 'dock') => (n: HTMLElement | null) => {
    const was = mine.current[k];
    if (was && was !== n) set.delete(was);
    mine.current[k] = n;
    if (n) set.add(n);
    shown = ''; dockShown = '';
  };
  void order;                                                   // (an order re-renders the menu's buttons)
  const live = !mini;
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
  const click = live ? (e: ReactMouseEvent) => { stop(e); useMenu.setState({ open: open ? null : { x: sim.x, y: sim.y } }); } : undefined;
  const say = (op: 'start' | 'home') => { send({ t: 'fit', id: 'vacuum', op }); useMenu.setState({ open: null }); };
  return (
    <>
      <i className={`vac-dock${live ? ' clicky' : ''}`} ref={keep(dockEls, 'dock')} style={{ left: DOCK_AT[0], top: DOCK_AT[1], width: DOCK_W, height: DOCK_H, zIndex: DOCK_AT[1] + 15, backgroundImage: `url(${pics.dockOn})` }}
        title={live ? 'The robot vacuum\'s dock' : undefined} onMouseMove={live ? stop : undefined} onClick={click} />
      <i className={`vacuum${live ? ' clicky' : ''}`} ref={keep(els, 'el')} style={{ width: VAC_W, height: VAC_H, backgroundImage: `url(${pics.vac})`, backgroundSize: `${VAC_W * HEADINGS * VAC_PER}px ${VAC_H}px` }}
        title={live ? 'Robot vacuum' : undefined} onMouseMove={live ? stop : undefined} onClick={click} />
      {open && live && (
        <div ref={menuNode} className="act-menu" style={{ left: Math.max(4, Math.min(CLUB.w - 80, open.x + 12)), top: Math.max(4, open.y - 30), zIndex: 4000 }} onClick={stop}>
          <b>Robot vacuum</b>
          {sim.mode === 'clean' || sim.mode === 'out' ? <button onClick={() => say('home')}>Send it home</button> : <button onClick={() => say('start')}>Start cleaning</button>}
        </div>
      )}
    </>
  );
});
