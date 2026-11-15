import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { send, useStore } from '../store';
import { Icon } from './ui';

// The arcade machine in the clubhouse: four games of our own, in the old styles (a maze chase, a shooter with a
// swarm that dives, a ship among drifting rocks, and bat and ball). Each is played alone, on this PC, with the
// keyboard; the server keeps everyone's best score at each. All of it is drawn here, a dot at a time, on one small
// canvas (W by H) that is shown at a whole number of screen dots to each of its own.

const W = 224, H = 288;
const INK = '#1d1528', CREAM = '#e9d9b0', AMBER = '#f2c230', CORAL = '#e0584f', TEAL = '#3f8f86', GREEN = '#8fd06a', LILAC = '#d98ac0';

/** What is held down, and what has been pressed since the game last looked (`hit`). */
type Keys = { left: boolean; right: boolean; up: boolean; down: boolean; fire: boolean; hit: Set<string> };
/** A game in progress. */
type Run = { step(dt: number, k: Keys): void; draw(g: CanvasRenderingContext2D): void; score: number; lives: number; over: boolean };
type GameDef = { id: string; name: string; blurb: string; keys: string; start: () => Run };

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(list: T[]) => list[Math.floor(Math.random() * list.length)];
const box = (g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, c: string) => { g.fillStyle = c; g.fillRect(Math.round(x), Math.round(y), w, h); };
/** A little picture from rows of letters, each letter a colour; anything else is left clear. */
const stamp = (g: CanvasRenderingContext2D, x: number, y: number, rows: string[], pal: Record<string, string>) => {
  x = Math.round(x); y = Math.round(y);
  rows.forEach((row, j) => { for (let i = 0; i < row.length; i++) { const c = pal[row[i]]; if (c) { g.fillStyle = c; g.fillRect(x + i, y + j, 1, 1); } } });
};
const label = (g: CanvasRenderingContext2D, s: string, x: number, y: number, c = CREAM, align: CanvasTextAlign = 'left', size = 16) => {
  g.font = `${size}px VT323, monospace`; g.textAlign = align; g.textBaseline = 'top'; g.fillStyle = c; g.fillText(s, x, y);
};
/** The line across the top of every game: the score, and what is left of your lives. */
const hud = (g: CanvasRenderingContext2D, r: { score: number; lives: number }, note = '') => {
  box(g, 0, 0, W, H, INK);
  label(g, String(r.score).padStart(5, '0'), 6, 2);
  if (note) label(g, note, W / 2, 2, TEAL, 'center');
  for (let k = 0; k < r.lives; k++) box(g, W - 12 - k * 9, 6, 6, 6, CORAL);
  box(g, 0, 19, W, 1, '#3a2f44');
};

// ───────── Kibble Run: a cat in a maze, eating every piece of kibble while the robot vacuums hunt it ─────────
// The maze is made afresh for every level: a tangle of passages with no dead ends. Catnip (the green leaves in the
// corners) sends the vacuums running for a few seconds, and one caught then is worth a good deal.
function kibbleRun(): Run {
  const COLS = 19, ROWS = 21, T = 11, OX = 7, OY = 24;
  const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  type Mover = { cx: number; cy: number; dx: number; dy: number; p: number };
  let wall: boolean[][] = [], food: number[][] = [], left = 0;
  const open = (c: number, r: number) => r >= 0 && r < ROWS && c >= 0 && c < COLS && !wall[r][c];
  const cat: Mover & { wx: number; wy: number } = { cx: 9, cy: 19, dx: 0, dy: 0, p: 0, wx: 0, wy: 0 };
  const vacs: (Mover & { home: number[]; out: number; hue: string })[] = [[1, 1, CORAL], [17, 1, LILAC], [9, 1, AMBER]].map(([c, r, hue]) => ({ cx: c as number, cy: r as number, dx: 0, dy: 0, p: 0, home: [c as number, r as number], out: 0, hue: hue as string }));
  let level = 1, scared = 0, pause = 1.2, t = 0;
  const run: Run = { score: 0, lives: 3, over: false, step, draw };

  function build() {
    wall = Array.from({ length: ROWS }, () => Array<boolean>(COLS).fill(true));
    const CW = 9, CH = 10, seen = new Set<number>([0]), stack = [[0, 0]];
    wall[1][1] = false;
    while (stack.length) {                                  // a passage to every cell, wandering
      const [c, r] = stack[stack.length - 1];
      const ways = DIRS.filter(([dc, dr]) => c + dc >= 0 && c + dc < CW && r + dr >= 0 && r + dr < CH && !seen.has((r + dr) * CW + c + dc));
      if (!ways.length) { stack.pop(); continue; }
      const [dc, dr] = pick(ways);
      wall[1 + 2 * r + dr][1 + 2 * c + dc] = false; wall[1 + 2 * (r + dr)][1 + 2 * (c + dc)] = false;
      seen.add((r + dr) * CW + c + dc); stack.push([c + dc, r + dr]);
    }
    for (let r = 0; r < CH; r++) for (let c = 0; c < CW; c++) {      // then every dead end is opened through to a neighbour, and a few more walls go besides
      const near = DIRS.filter(([dc, dr]) => c + dc >= 0 && c + dc < CW && r + dr >= 0 && r + dr < CH);
      const shut = near.filter(([dc, dr]) => wall[1 + 2 * r + dr][1 + 2 * c + dc]);
      if (shut.length && (near.length - shut.length <= 1 || Math.random() < 0.12)) { const [dc, dr] = pick(shut); wall[1 + 2 * r + dr][1 + 2 * c + dc] = false; }
    }
    food = wall.map((row) => row.map((w) => (w ? 0 : 1)));
    for (const [c, r] of [[1, 3], [17, 3], [1, 17], [17, 17]]) food[r][c] = 2;      // catnip
    food[19][9] = 0;
    left = food.flat().filter(Boolean).length;
    place();
  }
  function place() {
    Object.assign(cat, { cx: 9, cy: 19, dx: 0, dy: 0, p: 0, wx: 0, wy: 0 });
    for (const v of vacs) Object.assign(v, { cx: v.home[0], cy: v.home[1], dx: 0, dy: 0, p: 0, out: 0 });
    scared = 0; pause = 1.2;
  }
  /** Moves somebody along the passages; `choose` picks their way each time they are in the middle of a tile. */
  function move(e: Mover, dist: number, choose: () => void) {
    for (let guard = 0; dist > 1e-6 && guard < 8; guard++) {
      if (e.p === 0) { choose(); if (!e.dx && !e.dy) return; }
      const room = 1 - e.p;
      if (dist >= room) { e.cx += e.dx; e.cy += e.dy; e.p = 0; dist -= room; } else { e.p += dist; dist = 0; }
    }
  }
  const at = (e: Mover) => [e.cx + e.dx * e.p, e.cy + e.dy * e.p];
  build();

  function step(dt: number, k: Keys) {
    t += dt;
    if (k.left) { cat.wx = -1; cat.wy = 0; } else if (k.right) { cat.wx = 1; cat.wy = 0; } else if (k.up) { cat.wx = 0; cat.wy = -1; } else if (k.down) { cat.wx = 0; cat.wy = 1; }
    if (pause > 0) { pause -= dt; return; }
    scared = Math.max(0, scared - dt);
    if (cat.p > 0 && cat.wx === -cat.dx && cat.wy === -cat.dy) { cat.cx += cat.dx; cat.cy += cat.dy; cat.dx = -cat.dx; cat.dy = -cat.dy; cat.p = 1 - cat.p; }      // turning back, part way along
    move(cat, (5.6 + level * 0.2) * dt, () => {
      if ((cat.wx || cat.wy) && open(cat.cx + cat.wx, cat.cy + cat.wy)) { cat.dx = cat.wx; cat.dy = cat.wy; } else if (!open(cat.cx + cat.dx, cat.cy + cat.dy)) cat.dx = cat.dy = 0;
      const f = food[cat.cy][cat.cx];
      if (f) { food[cat.cy][cat.cx] = 0; left--; run.score += f === 2 ? 50 : 10; if (f === 2) scared = 6; }
    });
    const [hx, hy] = at(cat);
    vacs.forEach((v, n) => {
      if (v.out > 0) { v.out -= dt; return; }
      move(v, (scared ? 3.1 : 4.3 + level * 0.25 - n * 0.3) * dt, () => {
        let ways = DIRS.filter(([dc, dr]) => open(v.cx + dc, v.cy + dr) && !(dc === -v.dx && dr === -v.dy));
        if (!ways.length) ways = DIRS.filter(([dc, dr]) => open(v.cx + dc, v.cy + dr));
        // each has its own idea: the first makes straight for the cat, the second for where the cat is going, the third wanders half the time
        const tx = hx + (n === 1 ? cat.dx * 4 : 0), ty = hy + (n === 1 ? cat.dy * 4 : 0);
        const far = ([dc, dr]: number[]) => (v.cx + dc - tx) ** 2 + (v.cy + dr - ty) ** 2;
        const best = Math.random() < (n === 2 ? 0.5 : 0.15) ? pick(ways) : ways.reduce((a, b) => ((scared ? far(b) > far(a) : far(b) < far(a)) ? b : a));
        v.dx = best[0]; v.dy = best[1];
      });
      const [vx, vy] = at(v);
      if (Math.hypot(vx - hx, vy - hy) < 0.7) {
        if (scared) { run.score += 200; Object.assign(v, { cx: v.home[0], cy: v.home[1], dx: 0, dy: 0, p: 0, out: 3 }); }
        else if (--run.lives <= 0) run.over = true; else place();
      }
    });
    if (left <= 0) { level++; run.score += 500; build(); }
  }
  function draw(g: CanvasRenderingContext2D) {
    hud(g, run, `LEVEL ${level}`);
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const x = OX + c * T, y = OY + r * T;
      if (wall[r][c]) {
        box(g, x, y, T, T, '#2a625c');
        if (open(c, r - 1)) box(g, x, y, T, 1, '#63b9ad');
        if (open(c, r + 1)) box(g, x, y + T - 1, T, 1, '#1b423e');
        if (open(c - 1, r)) box(g, x, y, 1, T, TEAL);
        if (open(c + 1, r)) box(g, x + T - 1, y, 1, T, '#1b423e');
      } else if (food[r][c] === 1) box(g, x + 4, y + 4, 2, 2, '#c9a268');
      else if (food[r][c] === 2) stamp(g, x + 2, y + 2, ['..gg...', '.gggg.g', 'ggGgggg', '.gggGg.', '..ggg..', '...g...'], { g: GREEN, G: '#5fa040' });
    }
    for (const v of vacs) {
      if (v.out > 0) continue;
      const [vx, vy] = at(v), flee = scared > 0 && (scared > 1.5 || Math.floor(t * 8) % 2 === 0);
      stamp(g, OX + vx * T + 1, OY + vy * T + 1, ['..kkkkk..', '.kssssSk.', 'kssssssSk', 'kssllssSk', 'kssllssSk', 'ksssssSSk', 'kssssSSSk', '.kSSSSSk.', '..kkkkk..'],
        { k: '#17141d', s: flee ? '#8fa0c8' : '#b9c0d0', S: flee ? '#62709a' : '#7c8698', l: flee ? '#ffffff' : v.hue });
    }
    const [cx, cy] = at(cat);
    stamp(g, OX + cx * T + 1, OY + cy * T + 1, ['o.......o', 'oo.....oo', 'ooooooooo', 'oOoooooOo', 'okoooooko', 'ooooooooo', 'ooowpwooo', '.ooowooo.', '..ooooo..'],
      { o: '#f0962e', O: '#c96f14', k: '#17141d', w: '#fbf3d6', p: '#f29ab0' });
    if (pause > 0 && !run.over) label(g, 'READY', W / 2, OY + 10 * T - 2, AMBER, 'center');
  }
  return run;
}

// ───────── Moth Raid: a swarm of moths holding its ranks at the top, peeling off to dive at you ─────────
function mothRaid(): Run {
  type Moth = { col: number; row: number; x: number; y: number; mode: 'rank' | 'dive' | 'back'; t: number; aim: number; shot: boolean };
  const HUES = [CREAM, AMBER, CORAL, LILAC];
  let moths: Moth[] = [], shots: number[][] = [], bolts: number[][] = [];
  let x = W / 2, t = 0, wave = 0, cool = 0, next = 1.5, safe = 2, pause = 0;
  const stars = Array.from({ length: 34 }, () => [Math.floor(rnd(0, W)), Math.floor(rnd(22, H)), Math.random() < 0.3 ? 1 : 0]);
  const run: Run = { score: 0, lives: 3, over: false, step, draw };
  /** Where a moth's place in the ranks is just now: the whole swarm sways from side to side. */
  const slot = (m: Moth) => [W / 2 + (m.col - 3.5) * 22 + Math.sin(t * 0.9) * 22, 38 + m.row * 17];
  function muster() {
    wave++;
    moths = [];
    for (let row = 0; row < 4; row++) for (let col = 0; col < 8; col++) moths.push({ col, row, x: W / 2 + (col - 3.5) * 22, y: -20 - row * 17, mode: 'back', t: 0, aim: 0, shot: false });
    next = 2;
  }
  muster();

  function step(dt: number, k: Keys) {
    t += dt;
    if (pause > 0) { pause -= dt; return; }
    safe = Math.max(0, safe - dt); cool = Math.max(0, cool - dt);
    x = Math.max(8, Math.min(W - 8, x + ((k.right ? 1 : 0) - (k.left ? 1 : 0)) * 120 * dt));
    if ((k.hit.has('fire') || (k.fire && cool <= 0)) && shots.length < 3 && cool < 0.2) { shots.push([x, H - 30]); cool = 0.32; }
    for (const s of shots) s[1] -= 270 * dt;
    shots = shots.filter((s) => s[1] > 18);
    for (const b of bolts) b[1] += (105 + wave * 8) * dt;
    bolts = bolts.filter((b) => b[1] < H);
    next -= dt;
    const ranked = moths.filter((m) => m.mode === 'rank');
    if (next <= 0 && ranked.length) { const m = pick(ranked); m.mode = 'dive'; m.t = 0; m.aim = x; m.shot = false; next = Math.max(0.5, 1.7 - wave * 0.12) * rnd(0.6, 1.3); }
    for (const m of moths) {
      const [sx, sy] = slot(m);
      if (m.mode === 'rank') { m.x = sx; m.y = sy; }
      else if (m.mode === 'back') {                      // flying back up to its place
        const d = Math.hypot(sx - m.x, sy - m.y), go = 130 * dt;
        if (d <= go) { m.x = sx; m.y = sy; m.mode = 'rank'; } else { m.x += ((sx - m.x) / d) * go; m.y += ((sy - m.y) / d) * go; }
      } else {                                           // diving: down in a weave, leaning towards where you were, dropping one bolt on the way
        m.t += dt;
        m.y += (88 + wave * 7) * dt;
        m.x += (Math.cos(m.t * 4.2) * 70 + Math.sign(m.aim - m.x) * 34) * dt;
        if (!m.shot && m.y > 110 && m.y < 200) { m.shot = true; bolts.push([m.x, m.y + 6]); }
        if (m.y > H + 10) { m.y = -12; m.mode = 'back'; }
      }
    }
    for (const s of shots) {
      const m = moths.find((q) => Math.abs(q.x - s[0]) < 7 && Math.abs(q.y - s[1]) < 6);
      if (m) { moths = moths.filter((q) => q !== m); s[1] = -99; run.score += m.mode === 'dive' ? 120 : 40 + (3 - m.row) * 10; }
    }
    if (!safe && (bolts.some((b) => Math.abs(b[0] - x) < 6 && Math.abs(b[1] - (H - 22)) < 7) || moths.some((m) => Math.abs(m.x - x) < 10 && Math.abs(m.y - (H - 22)) < 9))) {
      bolts = [];
      if (--run.lives <= 0) run.over = true; else { safe = 2; pause = 0.7; }
    }
    if (!moths.length) { run.score += 300; muster(); }
  }
  function draw(g: CanvasRenderingContext2D) {
    hud(g, run, `WAVE ${wave}`);
    for (const [sx, sy, big] of stars) box(g, sx, sy, 1, 1, big ? '#8d7fa6' : '#4a3f5c');
    const flap = Math.floor(t * 6) % 2;
    for (const m of moths) {
      const hue = HUES[m.row], dark = '#17141d';
      stamp(g, m.x - 6, m.y - 4, flap || m.mode === 'dive'
        ? ['hh..k.k..hh', 'hhh.kkk.hhh', 'hHhhkbkhhHh', '.hhhkbkhhh.', '..hhkbkhh..', '...h.k.h...']
        : ['....k.k....', '.hh.kkk.hh.', 'hHhhkbkhhHh', 'hhhhkbkhhhh', 'hhh.kbk.hhh', '.h...k...h.'], { h: hue, H: dark, k: '#6b5a48', b: '#a08a6a' });
    }
    for (const s of shots) box(g, s[0] - 1, s[1] - 4, 2, 6, AMBER);
    for (const b of bolts) { box(g, b[0] - 1, b[1] - 2, 2, 4, CORAL); box(g, b[0], b[1] + 2, 1, 2, '#ffb0a8'); }
    if (!run.over && (safe <= 0 || Math.floor(t * 10) % 2 === 0))
      stamp(g, x - 6, H - 28, ['.....y.....', '....ccc....', '....ccc....', '.t.ccccc.t.', '.tccccccct.', 'ttccccccctt', 'tttt.a.tttt', 't.t..a..t.t'], { c: CREAM, t: TEAL, y: AMBER, a: '#f08a2c' });
  }
  return run;
}

// ───────── Rock Drift: a ship that turns and thrusts, in a field of rocks that break up when they are shot ─────────
function rockDrift(): Run {
  type Rock = { x: number; y: number; vx: number; vy: number; size: number; turn: number; spin: number; shape: number[] };
  const TOP = 20, RADIUS = [0, 5, 9, 16];
  const ship = { x: W / 2, y: (H + TOP) / 2, vx: 0, vy: 0, a: -Math.PI / 2 };
  let rocks: Rock[] = [], shots: number[][] = [];      // a shot: x, y, vx, vy, seconds left
  let level = 0, safe = 2.5, cool = 0, t = 0, burn = false;
  const run: Run = { score: 0, lives: 3, over: false, step, draw };
  const rock = (x: number, y: number, size: number): Rock => {
    const a = rnd(0, Math.PI * 2), v = rnd(14, 30) * (4 - size) * (1 + level * 0.06);
    return { x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, size, turn: 0, spin: rnd(-1, 1), shape: Array.from({ length: 9 }, () => rnd(0.72, 1.12)) };
  };
  const wrap = (o: { x: number; y: number }) => { o.x = (o.x + W) % W; o.y = TOP + ((o.y - TOP + (H - TOP)) % (H - TOP)); };
  function field() {
    level++;
    for (let k = 0; k < 2 + level; k++) {                // new rocks come in round the edges, clear of the ship
      const side = Math.random() < 0.5;
      rocks.push(rock(side ? rnd(0, W) : pick([10, W - 10]), side ? pick([TOP + 10, H - 10]) : rnd(TOP, H), 3));
    }
  }
  field();

  function step(dt: number, k: Keys) {
    t += dt; safe = Math.max(0, safe - dt); cool = Math.max(0, cool - dt);
    ship.a += ((k.right ? 1 : 0) - (k.left ? 1 : 0)) * 3.7 * dt;
    burn = k.up;
    if (burn) { ship.vx += Math.cos(ship.a) * 150 * dt; ship.vy += Math.sin(ship.a) * 150 * dt; }
    const v = Math.hypot(ship.vx, ship.vy), max = 170, slow = Math.exp(-0.35 * dt) * (v > max ? max / v : 1);
    ship.vx *= slow; ship.vy *= slow;
    ship.x += ship.vx * dt; ship.y += ship.vy * dt; wrap(ship);
    if ((k.hit.has('fire') || (k.fire && cool <= 0)) && shots.length < 4 && cool < 0.12) {
      shots.push([ship.x + Math.cos(ship.a) * 7, ship.y + Math.sin(ship.a) * 7, Math.cos(ship.a) * 250 + ship.vx, Math.sin(ship.a) * 250 + ship.vy, 0.85]);
      cool = 0.24;
    }
    for (const s of shots) { s[0] += s[2] * dt; s[1] += s[3] * dt; s[4] -= dt; const o = { x: s[0], y: s[1] }; wrap(o); s[0] = o.x; s[1] = o.y; }
    for (const r of rocks) { r.x += r.vx * dt; r.y += r.vy * dt; r.turn += r.spin * dt; wrap(r); }
    for (const s of shots) {
      const r = rocks.find((q) => Math.hypot(q.x - s[0], q.y - s[1]) < RADIUS[q.size] + 1);
      if (!r) continue;
      s[4] = 0;
      rocks = rocks.filter((q) => q !== r);
      run.score += [0, 100, 50, 20][r.size];
      if (r.size > 1) rocks.push(rock(r.x, r.y, r.size - 1), rock(r.x, r.y, r.size - 1));
    }
    shots = shots.filter((s) => s[4] > 0);
    if (!safe && rocks.some((r) => Math.hypot(r.x - ship.x, r.y - ship.y) < RADIUS[r.size] + 3)) {
      if (--run.lives <= 0) run.over = true;
      else { Object.assign(ship, { x: W / 2, y: (H + TOP) / 2, vx: 0, vy: 0, a: -Math.PI / 2 }); safe = 2.5; }
    }
    if (!rocks.length) { run.score += 250; safe = Math.max(safe, 1.5); field(); }
  }
  function draw(g: CanvasRenderingContext2D) {
    hud(g, run, `FIELD ${level}`);
    g.save();
    g.beginPath(); g.rect(0, TOP, W, H - TOP); g.clip();
    g.lineWidth = 1; g.lineJoin = 'round';
    for (const r of rocks) {
      g.beginPath();
      r.shape.forEach((m, i) => { const a = r.turn + (i / r.shape.length) * Math.PI * 2, d = RADIUS[r.size] * m; g[i ? 'lineTo' : 'moveTo'](Math.round(r.x + Math.cos(a) * d) + 0.5, Math.round(r.y + Math.sin(a) * d) + 0.5); });
      g.closePath();
      g.fillStyle = '#3d3247'; g.fill(); g.strokeStyle = '#c9a268'; g.stroke();
    }
    for (const s of shots) box(g, s[0] - 1, s[1] - 1, 2, 2, AMBER);
    if (!run.over && (safe <= 0 || Math.floor(t * 10) % 2 === 0)) {
      const p = (d: number, a: number) => [Math.round(ship.x + Math.cos(ship.a + a) * d) + 0.5, Math.round(ship.y + Math.sin(ship.a + a) * d) + 0.5] as const;
      if (burn && Math.floor(t * 20) % 2) { g.beginPath(); g.moveTo(...p(4, 2.7)); g.lineTo(...p(10, Math.PI)); g.lineTo(...p(4, -2.7)); g.strokeStyle = '#f08a2c'; g.stroke(); }
      g.beginPath(); g.moveTo(...p(8, 0)); g.lineTo(...p(7, 2.5)); g.lineTo(...p(3, Math.PI)); g.lineTo(...p(7, -2.5)); g.closePath();
      g.fillStyle = TEAL; g.fill(); g.strokeStyle = CREAM; g.stroke();
    }
    g.restore();
  }
  return run;
}

// ───────── Paddle Duel: bat and ball against the machine, which gets quicker with every point you take off it ─────────
function paddleDuel(): Run {
  const TOP = 22, BAT = 30;
  let me = (H + TOP) / 2, it = (H + TOP) / 2, bx = W / 2, by = (H + TOP) / 2, vx = 0, vy = 0, speed = 135, serve = 1, to = -1, points = 0, rally = 0;
  const run: Run = { score: 0, lives: 3, over: false, step, draw };
  function step(dt: number, k: Keys) {
    me = Math.max(TOP + BAT / 2, Math.min(H - BAT / 2, me + ((k.down ? 1 : 0) - (k.up ? 1 : 0)) * 185 * dt));
    if (serve > 0) {                                      // the ball waits in the middle, then goes towards whoever lost the last point
      serve -= dt; bx = W / 2; by = (H + TOP) / 2;
      if (serve <= 0) { const a = rnd(-0.6, 0.6); speed = 135 + points * 6; vx = Math.cos(a) * speed * to; vy = Math.sin(a) * speed; rally = 0; }
      return;
    }
    // the machine follows the ball when it is coming, a little late and no faster than it can go; otherwise it drifts back to the middle
    const want = vx > 0 ? by + Math.sin(bx / 23) * 9 : (H + TOP) / 2, reach = (78 + points * 11) * dt;
    it += Math.max(-reach, Math.min(reach, want - it));
    it = Math.max(TOP + BAT / 2, Math.min(H - BAT / 2, it));
    bx += vx * dt; by += vy * dt;
    if (by < TOP + 2) { by = TOP + 2; vy = Math.abs(vy); } else if (by > H - 2) { by = H - 2; vy = -Math.abs(vy); }
    const off = (bat: number) => (by - bat) / (BAT / 2);
    if (vx < 0 && bx < 15 && bx > 6 && Math.abs(off(me)) < 1.15) { speed = Math.min(340, speed * 1.06); const a = off(me) * 0.95; vx = Math.cos(a) * speed; vy = Math.sin(a) * speed; bx = 15; rally++; run.score += 5; }
    if (vx > 0 && bx > W - 15 && bx < W - 6 && Math.abs(off(it)) < 1.15) { speed = Math.min(340, speed * 1.06); const a = off(it) * 0.95; vx = -Math.cos(a) * speed; vy = Math.sin(a) * speed; bx = W - 15; }
    if (bx > W + 6) { points++; run.score += 100; serve = 0.9; to = 1; }
    else if (bx < -6) { if (--run.lives <= 0) run.over = true; serve = 0.9; to = -1; }
  }
  function draw(g: CanvasRenderingContext2D) {
    hud(g, run, `${points} WON`);
    for (let y = TOP + 3; y < H; y += 10) box(g, W / 2 - 1, y, 2, 5, '#3a2f44');
    box(g, 9, me - BAT / 2, 4, BAT, TEAL); box(g, 9, me - BAT / 2, 4, 2, '#63b9ad');
    box(g, W - 13, it - BAT / 2, 4, BAT, CORAL); box(g, W - 13, it - BAT / 2, 4, 2, '#ffb0a8');
    box(g, bx - 2, by - 2, 4, 4, CREAM);
    if (rally >= 4) label(g, `RALLY ${rally}`, W / 2, H - 18, '#4a3f5c', 'center');
  }
  return run;
}

export const GAMES: GameDef[] = [
  { id: 'maze', name: 'Kibble Run', blurb: 'Eat every piece of kibble. The robot vacuums are after you; catnip turns the tables.', keys: 'Arrows or WASD: steer', start: kibbleRun },
  { id: 'moths', name: 'Moth Raid', blurb: 'The swarm holds its ranks, then dives. Clear the wave before one gets you.', keys: 'Left and right: move · Space: fire', start: mothRaid },
  { id: 'rocks', name: 'Rock Drift', blurb: 'Turn, thrust and shoot. Big rocks break into small ones, and all of them drift.', keys: 'Left and right: turn · Up: thrust · Space: fire', start: rockDrift },
  { id: 'paddle', name: 'Paddle Duel', blurb: 'Bat and ball against the machine. It gets quicker with every point you take.', keys: 'Up and down: move your bat', start: paddleDuel },
];
const KEY: Record<string, keyof Omit<Keys, 'hit'> | 'start' | 'back'> = {
  ArrowLeft: 'left', a: 'left', A: 'left', ArrowRight: 'right', d: 'right', D: 'right', ArrowUp: 'up', w: 'up', W: 'up', ArrowDown: 'down', s: 'down', S: 'down',
  ' ': 'fire', Enter: 'start', Escape: 'back',
};

export function Arcade() {
  const users = useStore((s) => s.users);
  const me = useStore((s) => s.me);
  const scores = useStore((s) => s.arcade);
  const [chosen, setChosen] = useState(0);                    // which game the list is on
  const [playing, setPlaying] = useState<{ game: number; n: number } | null>(null);      // the game being played (n: which go at it, so "again" starts afresh)
  const [ended, setEnded] = useState<number | null>(null);    // the score it ended on, while "game over" is up
  const [k, setK] = useState(2);
  const area = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const state = useRef({ chosen, playing, ended });
  state.current = { chosen, playing, ended };
  const leave = () => useStore.setState({ view: { kind: 'hangout' } });

  // as big as will fit, in whole screen dots to each of its own
  useEffect(() => {
    const el = area.current!;
    const fit = () => setK(Math.max(1, Math.min(4, Math.floor(Math.min((el.clientWidth - 300) / (W + 28), (el.clientHeight - 24) / (H + 86))))));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The keyboard: the game's keys while one is being played, the list otherwise. Not while typing somewhere (the chat).
  const keys = useRef<Keys>({ left: false, right: false, up: false, down: false, fire: false, hit: new Set() });
  useEffect(() => {
    const typing = (e: KeyboardEvent) => { const el = e.target as HTMLElement | null; return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable); };
    const down = (e: KeyboardEvent) => {
      const what = KEY[e.key];
      if (!what || typing(e) || e.ctrlKey || e.altKey || e.metaKey) return;
      e.preventDefault();
      const s = state.current;
      if (what === 'back') { e.stopPropagation(); if (s.playing) { setPlaying(null); setEnded(null); } else leave(); return; }
      if (s.playing && s.ended === null) {
        if (what !== 'start' && !e.repeat) { keys.current[what] = true; keys.current.hit.add(what); }
        return;
      }
      if (e.repeat) return;
      // (after a game, only Enter starts another: Space was the fire button a moment ago)
      if (what === 'start' || (what === 'fire' && !s.playing)) { setEnded(null); setPlaying({ game: s.playing?.game ?? s.chosen, n: (s.playing?.n ?? 0) + 1 }); }
      else if (!s.playing && (what === 'up' || what === 'down')) setChosen((s.chosen + (what === 'up' ? GAMES.length - 1 : 1)) % GAMES.length);
    };
    const up = (e: KeyboardEvent) => { const what = KEY[e.key]; if (what && what !== 'start' && what !== 'back') keys.current[what] = false; };
    const clear = () => { Object.assign(keys.current, { left: false, right: false, up: false, down: false, fire: false }); };
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    window.addEventListener('blur', clear);
    return () => { window.removeEventListener('keydown', down, true); window.removeEventListener('keyup', up, true); window.removeEventListener('blur', clear); };
  }, []);

  // The game itself: stepped and drawn every frame until it is over, and then its score is sent in.
  useEffect(() => {
    const g = canvas.current?.getContext('2d');
    if (!g) return;
    g.imageSmoothingEnabled = false;
    if (!playing) {                                           // nothing on: the machine's own screen
      box(g, 0, 0, W, H, INK);
      label(g, 'CHATTER', W / 2, 88, AMBER, 'center', 46);
      label(g, 'ARCADE', W / 2, 136, CORAL, 'center', 32);
      label(g, 'PICK A GAME', W / 2, 196, CREAM, 'center');
      label(g, 'ENTER TO START', W / 2, 214, TEAL, 'center');
      return;
    }
    (document.activeElement as HTMLElement | null)?.blur?.();      // (so Space does not press whatever button was last clicked)
    Object.assign(keys.current, { left: false, right: false, up: false, down: false, fire: false });
    keys.current.hit.clear();
    const def = GAMES[playing.game], run = def.start();
    let raf = 0, last = performance.now(), done = false;
    const frame = (now: number) => {
      const dt = Math.min(1 / 30, (now - last) / 1000);
      last = now;
      if (!done) {
        run.step(dt, keys.current);
        keys.current.hit.clear();
        if (run.over) {
          done = true;
          setEnded(run.score);
          if (run.score > 0) send({ t: 'arcade', game: def.id, score: run.score });
        }
      }
      run.draw(g);
      if (done) { label(g, 'GAME OVER', W / 2, 118, AMBER, 'center', 32); label(g, 'ENTER: AGAIN', W / 2, 156, CREAM, 'center'); label(g, 'ESC: GAMES', W / 2, 172, TEAL, 'center'); }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const shown = GAMES[playing?.game ?? chosen];
  const table = scores[shown.id] ?? [];
  const mine = table.find((r) => r.userId === me?.id)?.score ?? 0;
  return (
    <section className="arcade-view">
      <header className="bar">
        <h2><Icon name="gamepad" /> Arcade</h2>
        <small>{playing ? `${shown.name}: ${shown.keys} · Esc: back to the games` : 'Four games on the machine. Up and down to choose, Enter to play.'}</small>
        <button onClick={leave}>Back to the room</button>
      </header>
      <div className="arc-area" ref={area}>
        <div className="arc-cab" style={{ '--k': k } as CSSProperties}>
          <div className="arc-marquee">{shown.name}</div>
          <div className="arc-screen"><canvas ref={canvas} width={W} height={H} /></div>
          <div className="arc-deck"><i className="stick" /><span>{shown.keys}</span><i className="dot y" /><i className="dot r" /><i className="dot w" /></div>
        </div>
        <aside className="arc-side">
          <h3>Games</h3>
          {GAMES.map((d, n) => (
            <button key={d.id} className={`arc-game${d === shown ? ' on' : ''}`} onClick={() => { setChosen(n); setEnded(null); setPlaying({ game: n, n: (playing?.n ?? 0) + 1 }); }} onMouseEnter={() => { if (!playing) setChosen(n); }}>
              <b>{d.name}</b><small>{d.blurb}</small>
            </button>
          ))}
          <h3>Best at {shown.name}</h3>
          {table.length ? (
            <ol className="arc-best">
              {table.map((r, n) => <li key={r.userId} className={r.userId === me?.id ? 'me' : ''}><i>{n + 1}</i><span>{users[r.userId]?.name ?? 'Somebody'}</span><b>{r.score}</b></li>)}
            </ol>
          ) : <p className="arc-none">Nobody has a score yet.</p>}
          {ended !== null && <p className="arc-none">{ended > 0 && ended >= mine ? `A new best for you: ${ended}.` : `You scored ${ended}.${mine ? ` Your best is ${mine}.` : ''}`}</p>}
        </aside>
      </div>
    </section>
  );
}
