// The disco lights in the main room: a light switch on the wall just left of the wall clock, and while it is down,
// the room's lamps go out, the room dims a little and coloured pools of light sweep over the walls and floor, with a
// mirror ball's glints sliding across them.
//
// Everybody sees the same: the switch is the server's (`disco` in kv, op `disco`), and the lights are worked out from
// the server's clock (the Player's `skew`), so they move together on every PC. Nothing can hear the Player (the
// embeds give no sound to listen to), so there is no beat detection: while it is playing, the lights pulse at a fixed
// 120 BPM; paused or empty, they only drift. Reduced motion: the slow drift only.
//
// The light is one small canvas laid just over the room's picture and under everything standing in the room, so it
// never falls on anybody: characters, pets and props are drawn over it, as they are. Hard-edged pixel blobs with a
// dithered rim, two room dots to a light dot, redrawn 15 times a second (steps, never smooth).
//
// And the mirror ball itself (2026-11-19): switched on, it comes down on its chain from the top of the room to hang in
// front of the big gilt photo, turning and glinting; switched off, it winds back up the way it came.
import { memo, useEffect, useRef, useState } from 'react';
import { CLUB } from './clubhouse.gen';
import { send, useStore } from './store';
import './disco.css';

const SCALE = 2;                                      // room dots per light dot
const GW = Math.ceil(CLUB.w / SCALE), GH = Math.ceil(CLUB.h / SCALE);
/** Rectangles [x, y, w, h] in room dots that the light never touches: the bathroom (it has its own light), the wall
 *  clock's panel (it is lit by itself), and the projector screen with the whiteboard behind it (kept readable). */
const KEEP_DARK: number[][] = [
  [CLUB.bath.rect[0], CLUB.bath.rect[1] - 2, CLUB.bath.rect[2] + 4, CLUB.bath.rect[3] + 4],
  [CLUB.clock[0] - 2, CLUB.clock[1] - 3, CLUB.clock[2] + 4, CLUB.temp[1] + CLUB.temp[3] - CLUB.clock[1] + 6],
  [CLUB.screen[0] - 2, CLUB.screen[1] - 2, CLUB.screen[2] + 4, CLUB.screen[3] + 6],
];
/** The room inside the house's walls. */
const INSIDE = [6, 4, CLUB.w - 12, CLUB.h - 10];
/** Where the switch is: on the bare wall between the house's left wall and the clock's panel. */
const SWITCH = { x: Math.round((INSIDE[0] + CLUB.clock[0] - 2) / 2) - 3, y: CLUB.clock[1] + 5, w: 6, h: 9 };

const BEAT_MS = 500;                                  // 120 BPM
/** Hard-light colours: under 128 darkens, over 128 lightens, so one layer both dims the room and throws coloured light. */
const DIM = [40, 32, 88, 150] as const;               // a dark violet, a little over half strength
const COLOURS: [number, number, number][] = [
  [255, 40, 190], [40, 230, 255], [255, 220, 40], [70, 255, 90], [150, 70, 255], [255, 120, 30],
];
/** 4x4 ordered dither, 0..15. */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

const rgba = (r: number, g: number, b: number, a: number) => ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;     // (little-endian ImageData)
/** Which light dots the light may fall on. */
const MASK = (() => {
  const m = new Uint8Array(GW * GH);
  for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) {
    const x = gx * SCALE + SCALE / 2, y = gy * SCALE + SCALE / 2;
    const inRoom = x >= INSIDE[0] && x < INSIDE[0] + INSIDE[2] && y >= INSIDE[1] && y < INSIDE[1] + INSIDE[3];
    m[gy * GW + gx] = inRoom && !KEEP_DARK.some(([kx, ky, kw, kh]) => x >= kx && x < kx + kw && y >= ky && y < ky + kh) ? 1 : 0;
  }
  return m;
})();
/** The dimmed room with no light on it yet: copied in at the start of every frame. */
const BASE = (() => {
  const b = new Uint32Array(GW * GH), dim = rgba(...DIM);
  for (let k = 0; k < b.length; k++) if (MASK[k]) b[k] = dim;
  return b;
})();
/** A fixed scatter of mirror-ball glints: where across (0..1) and down (0..1), and a twinkle seed. */
const GLINTS = Array.from({ length: 56 }, (_, k) => {
  const h = (n: number) => { const s = Math.sin(k * 127.1 + n * 311.7) * 43758.5453; return s - Math.floor(s); };
  return { u: h(1), v: h(2), seed: h(3) };
});
const hash = (a: number, b: number) => { const s = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return s - Math.floor(s); };

/** Draws one frame for server time `t` (ms) into `px`. */
function frame(px: Uint32Array, t: number, playing: boolean, calm: boolean) {
  px.set(BASE);
  const beat = Math.floor(t / BEAT_MS), into = (t % BEAT_MS) / BEAT_MS;
  // the pulse, in steps: a hit on the beat, then two steps down (none while drifting)
  const pulse = calm || !playing ? 0.55 : into < 0.16 ? 1 : into < 0.4 ? 0.72 : 0.5;
  const pace = calm ? 0.25 : playing ? 1 : 0.4;       // how fast the pools travel
  const s = t / 1000 * pace;
  for (let k = 0; k < 5; k++) {
    // each pool wanders the room on its own figure of eight; while playing, the colours step round every two beats
    const cx = GW * (0.5 + 0.44 * Math.sin(s * (0.21 + k * 0.037) + k * 1.9));
    const cy = GH * (0.55 + 0.42 * Math.sin(s * (0.29 + k * 0.041) + k * 2.7));
    const colour = COLOURS[(k + (playing && !calm ? Math.floor(beat / 2) : Math.floor(t / 20_000))) % COLOURS.length];
    const r = (24 + (k % 3) * 5) * (playing && !calm ? 0.85 + 0.25 * (pulse - 0.5) / 0.5 : 1);
    const core = r * 0.62;
    const alpha = Math.round(150 * pulse + 40);
    const full = rgba(colour[0], colour[1], colour[2], alpha), half = rgba(colour[0], colour[1], colour[2], Math.round(alpha * 0.55));
    const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(GW - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(GH - 1, Math.ceil(cy + r));
    for (let y = y0; y <= y1; y++) {
      const dy = (y - cy) * 1.35;                      // (a little squashed: light on a floor seen from above)
      for (let x = x0; x <= x1; x++) {
        const i = y * GW + x;
        if (!MASK[i]) continue;
        const d = Math.hypot(x - cx, dy);
        if (d >= r) continue;
        if (d < core) { px[i] = full; continue; }
        // the rim: dithered from the core's edge out to nothing
        const fade = 1 - (d - core) / (r - core);
        if (fade * 16 > BAYER[(y & 3) * 4 + (x & 3)]) px[i] = half;
      }
    }
  }
  // the mirror ball: glints sliding sideways across walls and floor, twinkling, flashing brighter on the beat
  const drift = (t / 1000) * (calm ? 0.004 : playing ? 0.03 : 0.012);
  const step = Math.floor(t / 250);
  const spark = rgba(255, 255, 255, playing && !calm && into < 0.16 ? 255 : 210);
  for (const g of GLINTS) {
    if (!calm && hash(g.seed * 100, step) < 0.3) continue;
    const x = Math.floor((((g.u + drift) % 1) + 1) % 1 * GW), y = Math.floor(g.v * GH);
    const i = y * GW + x;
    if (!MASK[i]) continue;
    px[i] = spark;
    if (playing && !calm && into < 0.16) {                // on the beat: a little cross
      if (x > 0 && MASK[i - 1]) px[i - 1] = spark;
      if (x < GW - 1 && MASK[i + 1]) px[i + 1] = spark;
      if (y > 0 && MASK[i - GW]) px[i - GW] = spark;
      if (y < GH - 1 && MASK[i + GW]) px[i + GW] = spark;
    }
  }
}

const MOTION = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
const reducedMotion = () => !!MOTION?.matches;

/** The lights themselves: one canvas under everybody. Runs only while the switch is on. */
function Lights() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current, ctx = cv?.getContext('2d');
    if (!cv || !ctx) return;
    const img = ctx.createImageData(GW, GH), px = new Uint32Array(img.data.buffer);
    // the room's own lamps go out while the disco is on (the room's lamp glows: .club-glow, in the stylesheet)
    const room = cv.parentElement;
    room?.setAttribute('data-disco', '');
    // (the props are dimmed to match, all but the bathroom's: marked here, and again now and then for any put back since)
    const [bx, by, bw, bh] = CLUB.bath.rect;
    const keepBath = () => room?.querySelectorAll<HTMLElement>(':scope > .club-over').forEach((el) => {
      const x = parseFloat(el.style.left), y = parseFloat(el.style.top);
      el.toggleAttribute('data-disco-keep', x >= bx && x < bx + bw && y >= by && y < by + bh);
    });
    let raf = 0, last = -1, marked = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (performance.now() - marked > 2000) { marked = performance.now(); keepBath(); }
      const calm = reducedMotion();
      const { music } = useStore.getState();
      const t = Date.now() - (music.skew || 0);
      const due = Math.floor(t / (calm ? 250 : 1000 / 15));     // 15 frames a second (4 when calm)
      if (due === last) return;
      last = due;
      const playing = !!music.current && music.current.pausedAt == null;
      frame(px, t, playing, calm);
      ctx.putImageData(img, 0, 0);
    };
    tick();
    return () => { cancelAnimationFrame(raf); room?.removeAttribute('data-disco'); };
  }, []);
  return <canvas ref={ref} className="disco-lights" width={GW} height={GH} aria-hidden />;
}

/** The mirror ball: hung in front of the biggest picture on the wall (the gilt frame, behind the middle desks). */
const PHOTO: { at: number[] } | null = { at: CLUB.photo };
const BALL_D = 40;                                    // the ball, in room dots
const PAD = 4;                                        // room round it on its canvas for the glints' arms
const CW = BALL_D + PAD * 2;
const BALL = PHOTO   // (centred on the part of the photo above the desks: they stand in front of its lower third)
  ? { x: Math.round(PHOTO.at[0] + PHOTO.at[2] / 2 - CW / 2), y: Math.round(PHOTO.at[1] + Math.min(PHOTO.at[3], 47) / 2 - CW / 2) }
  : { x: 160, y: 16 };
const DROP = BALL.y + CW + 6;                         // how far it travels: from wholly above the room to hanging
const BAND = Math.PI / 12;                            // each row of mirror tiles: 15° of latitude
const TURN_MS = 9000;                                 // once round
const LIGHT = (() => { const l = [-0.5, -0.62, 0.6]; const n = Math.hypot(l[0], l[1], l[2]); return l.map((v) => v / n); })();
const tileHash = (a: number, b: number) => { const s = Math.sin(a * 91.7 + b * 47.3 + 3.1) * 24634.6345; return s - Math.floor(s); };

/** Draws the ball for time `t` (ms) into `px` (CW × CW). */
function drawBall(px: Uint32Array, t: number, calm: boolean) {
  px.fill(0);
  const rot = calm ? 0.6 : (t / TURN_MS) * Math.PI * 2;
  const r = BALL_D / 2, twinkle = Math.floor(t / 120);
  const grout = rgba(38, 40, 54, 255);
  for (let y = 0; y < BALL_D; y++) for (let x = 0; x < BALL_D; x++) {
    const nx = (x + 0.5 - r) / r, ny = (y + 0.5 - r) / r, q = nx * nx + ny * ny;
    if (q > 1) continue;
    const nz = Math.sqrt(1 - q);
    const lat = Math.asin(-ny), lon = Math.atan2(nx, nz) + rot;
    const fb = (lat + Math.PI / 2) / BAND, band = Math.floor(fb);
    const across = Math.max(4, Math.round(24 * Math.sin((band + 0.5) * BAND)));     // fewer tiles round the poles
    const fl = (((lon / (Math.PI * 2)) % 1) + 1) % 1 * across, col = Math.floor(fl);
    const i = (y + PAD) * CW + x + PAD;
    // the grout between the tiles (not at the rim, where the tiles are too foreshortened to show it)
    if (nz > 0.3 && (fb - band < 0.16 || fl - col < 0.16)) { px[i] = grout; continue; }
    // each tile is flat: lit by its own middle's facing, so it is one colour, and flashes as it turns to the light
    const tl = (band + 0.5) * BAND - Math.PI / 2, tn = ((col + 0.5) / across) * Math.PI * 2 - rot;
    const fx = Math.cos(tl) * Math.sin(tn), fy = -Math.sin(tl), fz = Math.cos(tl) * Math.cos(tn);
    const lit = Math.max(0, fx * LIGHT[0] + fy * LIGHT[1] + fz * LIGHT[2]);
    const h = tileHash(band, col);
    let v = 70 + 70 * h + 110 * lit * lit;
    const shine = lit > 0.93 || (!calm && tileHash(band * 7 + twinkle, col) > 0.985);
    if (shine) v = 255;
    v *= 0.5 + 0.5 * nz;                                // the rim falls away into shadow
    const k = Math.min(255, Math.round(v));
    // a few tiles throw back the room's coloured lights
    const c = h > 0.86 && !shine ? COLOURS[Math.floor(h * 1000) % COLOURS.length] : null;
    px[i] = c ? rgba(Math.round((c[0] * k) / 255), Math.round((c[1] * k) / 255), Math.round((c[2] * k) / 255), 255)
      : rgba(k, Math.min(255, k + 4), Math.min(255, k + 14), 255);
  }
  if (calm) return;
  // glints: little four-pointed stars that come and go over the lit side
  const star = rgba(255, 255, 255, 255), soft = rgba(220, 235, 255, 200);
  for (let n = 0; n < 4; n++) {
    const at = t / 700 + n * 0.37, life = at % 1, cycle = Math.floor(at);
    if (life > 0.55) continue;
    const a = tileHash(n, cycle) * Math.PI * 2, d = 0.2 + 0.6 * tileHash(cycle, n);
    const sx = Math.round(PAD + r + Math.cos(a) * r * d - r * 0.15), sy = Math.round(PAD + r + Math.sin(a) * r * d - r * 0.2);
    const arm = life < 0.15 || life > 0.4 ? 1 : 3;
    px[sy * CW + sx] = star;
    for (let k = 1; k <= arm; k++) {
      const c = k === arm && arm > 1 ? soft : star;
      if (sx - k >= 0) px[sy * CW + sx - k] = c;
      if (sx + k < CW) px[sy * CW + sx + k] = c;
      if (sy - k >= 0) px[(sy - k) * CW + sx] = c;
      if (sy + k < CW) px[(sy + k) * CW + sx] = c;
    }
  }
}

/** The ball's own canvas, turning while it is shown. */
function BallCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current, ctx = cv?.getContext('2d');
    if (!cv || !ctx) return;
    const img = ctx.createImageData(CW, CW), px = new Uint32Array(img.data.buffer);
    let raf = 0, last = -1;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const calm = reducedMotion(), t = Date.now();
      const due = Math.floor(t / (calm ? 1000 : 1000 / 15));
      if (due === last) return;
      last = due;
      drawBall(px, t, calm);
      ctx.putImageData(img, 0, 0);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, []);
  return <canvas ref={ref} className="disco-ball" width={CW} height={CW} style={{ top: BALL.y }} />;
}

const TRAVEL_MS = 2400;
/** The ball on its chain: lowered when the switch goes on, wound back up when it goes off, gone once it is up. On
 *  already when the room first opens (the switch arriving from the server just after), it is simply there. */
function MirrorBall({ on }: { on: boolean }) {
  const born = useRef(performance.now());
  const [phase, setPhase] = useState<'gone' | 'up' | 'down'>(on ? 'down' : 'gone');
  const [still, setStill] = useState(on);
  const phaseNow = useRef(phase);
  phaseNow.current = phase;
  useEffect(() => {
    const calm = reducedMotion();
    if (on) {
      if (phaseNow.current === 'gone' && performance.now() - born.current < 2500) { setStill(true); setPhase('down'); return; }
      setStill(calm);
      if (phaseNow.current !== 'gone') { setPhase('down'); return; }       // (caught on its way up: straight back down)
      setPhase('up');
      let b = 0;
      const a = requestAnimationFrame(() => { b = requestAnimationFrame(() => setPhase('down')); });   // drawn up there first, so it travels
      return () => { cancelAnimationFrame(a); cancelAnimationFrame(b); };
    }
    if (phaseNow.current === 'gone') return;
    setStill(calm);
    setPhase('up');
    const done = window.setTimeout(() => setPhase('gone'), calm ? 0 : TRAVEL_MS + 100);
    return () => window.clearTimeout(done);
  }, [on]);
  if (phase === 'gone') return null;
  return (
    <div className="disco-drop" style={{ left: BALL.x, width: CW, height: DROP }} aria-hidden>
      <div className={`disco-rig${phase === 'down' ? ' down' : ''}${still ? ' still' : ''}`}
        style={{ transform: phase === 'down' ? 'translateY(0)' : `translateY(${-DROP}px)` }}>
        <i className="disco-chain" style={{ left: CW / 2 - 1, height: BALL.y + PAD + 1 }} />
        <BallCanvas />
      </div>
    </div>
  );
}

/** The switch on the wall and, while it is on, the lights. Only in the main room (the room shows this only there). */
export const Disco = memo(function Disco({ mini = false }: { mini?: boolean }) {
  const on = useStore((s) => s.disco);
  return (
    <>
      {on && <Lights />}
      <MirrorBall on={on} />
      <i className={`disco-switch${on ? ' on' : ''}`} role={mini ? undefined : 'button'} aria-pressed={on}
        style={{ left: SWITCH.x, top: SWITCH.y, width: SWITCH.w, height: SWITCH.h }}
        title={mini ? undefined : on ? 'Lights back on' : 'Disco lights'}
        onMouseMove={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); if (!mini) send({ t: 'disco', on: !on }); }} />
    </>
  );
});
