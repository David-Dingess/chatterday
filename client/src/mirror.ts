// The bathroom mirror, steamed up after a shower (server/mirror.ts keeps it). Anybody can write on it with a finger:
// each stroke wipes the fog away to the dark glass beneath, with a soft edge, and now and then a drop runs down from
// it. Strokes are wiped here at once and sent on; everybody's come back from the server the same way (wiping is the
// same however often it is done), so the room's mirror and the one opened up close always show the same thing.
import { hooks, send } from './store';

export const MIRROR_W = 72, MIRROR_H = 48;
/** How the glass of the room's mirror (18 by 12 dots, in the room's picture) takes the big one: 4 by 4 dots each. */
export const ROOM_MIRROR = [86, 239, 18, 12] as const;
const CELL = MIRROR_W / ROOM_MIRROR[2];

// Each dot: 0 fogged, 1 half wiped (the soft edge of a stroke), 2 wiped clear.
const px = new Uint8Array(MIRROR_W * MIRROR_H);
/** The drops running down: x, y, length, and when this page first saw it (0: long since run). */
let drips: { x: number; y: number; len: number; at: number }[] = [];
let on = false, ends = 0, fade = 4 * 60_000;
/** How long a drop takes to run one dot down, in ms. */
const DRIP_MS = 140;

const watchers = new Set<() => void>();
let queued = false;
function changed() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => { queued = false; for (const w of watchers) w(); });
}
/** Calls back whenever the mirror changes (fogs, clears, is written on). Returns the way to stop. */
export function watchMirror(fn: () => void) { watchers.add(fn); return () => { watchers.delete(fn); }; }

/** Whether the mirror is fogged just now (writing on it is possible until the fog has quite gone). */
export const misted = () => on && (!ends || Date.now() < ends);
/** How thick the fog is, 0 to 1: thick while the shower runs and for a while after, then thinning out slowly. */
export function fogLevel(now = Date.now()) {
  if (!on) return 0;
  if (!ends) return 1;
  const left = (ends - now) / fade;
  return left <= 0 ? 0 : Math.min(1, left / 0.75);
}

/** A finger's touch: a small round of clear glass with a soft rim. (The server wipes the very same way.) */
function touch(x: number, y: number) {
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const xx = x + dx, yy = y + dy, d2 = dx * dx + dy * dy;
    if (xx < 0 || yy < 0 || xx >= MIRROR_W || yy >= MIRROR_H || d2 > 5) continue;
    const i = yy * MIRROR_W + xx, v = d2 <= 2 ? 2 : 1;
    if (px[i] < v) px[i] = v;
  }
}
function wipe(x0: number, y0: number, x1: number, y1: number) {
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (let guard = 0; guard < 400; guard++) {
    touch(x0, y0);
    if (x0 === x1 && y0 === y1) return;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}
function wipeAll(pts: number[]) {
  if (pts.length === 2) touch(pts[0] | 0, pts[1] | 0);
  for (let i = 2; i + 1 < pts.length; i += 2) wipe(pts[i - 2] | 0, pts[i - 1] | 0, pts[i] | 0, pts[i + 1] | 0);
}
const takeDrips = (list: unknown, at: number) => {
  const out: typeof drips = [];
  if (Array.isArray(list)) for (let i = 0; i + 2 < list.length; i += 3) out.push({ x: list[i] | 0, y: list[i + 1] | 0, len: list[i + 2] | 0, at });
  return out;
};

function apply(d: any) {
  if (d.op === 'all') {
    on = !!d.on;
    ends = on && Number(d.left) > 0 ? Date.now() + Number(d.left) : 0;
    fade = Number(d.fade) || fade;
    const bin = atob(String(d.data ?? ''));
    if (bin.length === px.length) for (let i = 0; i < px.length; i++) px[i] = Math.min(2, bin.charCodeAt(i));
    drips = takeDrips(d.drips, 0);
  } else if (d.op === 'line' && Array.isArray(d.pts)) {
    wipeAll(d.pts);
    drips = drips.concat(takeDrips(d.drips, performance.now())).slice(-60);
  }
  changed();
}
hooks.mirror.push(apply);
hooks.ready.push(() => send({ t: 'mirror', op: 'hello' }));

// ── my own finger: wiped here straight away, and sent on in pieces a few times a second ──
let pending: number[] = [];
let timer = 0;
function flush() {
  timer = 0;
  if (pending.length >= 2) send({ t: 'mirror', op: 'line', pts: pending });
  pending = pending.length >= 2 ? pending.slice(-2) : [];        // (the next piece carries on from where this one stopped)
}
/** Puts my finger down on the glass, or moves it on to here (dots of the big mirror). */
export function finger(x: number, y: number, down: boolean) {
  if (!misted()) return;
  x = Math.max(0, Math.min(MIRROR_W - 1, Math.round(x))); y = Math.max(0, Math.min(MIRROR_H - 1, Math.round(y)));
  if (down) { if (timer) { clearTimeout(timer); flush(); } pending = []; }
  const last = pending.length >= 2 ? pending.slice(-2) : null;
  if (last && last[0] === x && last[1] === y) return;
  if (last) wipe(last[0], last[1], x, y); else touch(x, y);
  pending.push(x, y);
  if (pending.length >= 380) { if (timer) clearTimeout(timer); flush(); }
  else timer ||= window.setTimeout(flush, 150);
  changed();
}
/** Takes my finger off the glass. */
export function lift() { if (timer) clearTimeout(timer); flush(); pending = []; }

// ── drawing it ──
/** A steady bit of noise for each dot, 0 to 1, the same on every page. */
const noise = (x: number, y: number, k = 0) => {
  let h = (x * 374761393 + y * 668265263 + k * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const mix = (a: number[], b: number[], t: number) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const rgb = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

/** How much of each dot is wiped (0 to 1), drops included as far as they have run by `now`. Also gives the drops' ends. */
function clearness(now: number) {
  const c = new Float32Array(px.length);
  for (let i = 0; i < px.length; i++) c[i] = px[i] / 2;
  const beads: number[] = [];
  let running = false;
  for (const d of drips) {
    const ran = d.at ? Math.min(d.len, Math.floor((now - d.at) / DRIP_MS)) : d.len;
    if (ran < d.len) running = true;
    for (let k = 0; k <= ran; k++) { const y = d.y + k; if (y < MIRROR_H) c[y * MIRROR_W + d.x] = 1; }
    beads.push(d.x, Math.min(MIRROR_H - 1, d.y + ran));
  }
  return { c, beads, running };
}

const GLASS_TOP = rgb('#22303b'), GLASS_LOW = rgb('#151e27'), GLINT = rgb('#334654'), FOG = rgb('#c4d1d9'), BEAD = rgb('#eef4f7'), DROP = rgb('#8fa6b5');
/** Draws the mirror up close into a canvas exactly MIRROR_W by MIRROR_H. Says whether a drop is still running (worth drawing again soon). */
export function paintClose(canvas: HTMLCanvasElement | null, now = performance.now()) {
  const ctx = canvas?.getContext('2d');
  if (!ctx) return false;
  const level = fogLevel();
  const { c, beads, running } = clearness(now);
  const img = ctx.createImageData(MIRROR_W, MIRROR_H);
  for (let y = 0; y < MIRROR_H; y++) for (let x = 0; x < MIRROR_W; x++) {
    const i = y * MIRROR_W + x;
    // the dark glass, a little lighter at the top, with two streaks of light across it (as on the room's mirror)
    let glass = mix(GLASS_TOP, GLASS_LOW, y / (MIRROR_H - 1));
    const s = x + y;
    if (y > 6 && y < MIRROR_H - 4 && ((s >= 44 && s <= 46) || s === 51 || s === 52)) glass = mix(glass, GLINT, 0.9);
    // the fog: uneven, with beads of water caught in it
    const n = noise(x, y);
    let fog = mix(FOG, [255, 255, 255], (n - 0.5) * 0.18);
    if (noise(x, y, 7) < 0.04) fog = BEAD;
    else if (noise(x, y - 1, 7) < 0.04) fog = mix(FOG, GLASS_TOP, 0.12);
    const f = (1 - c[i]) * level * (0.9 + n * 0.1);
    const out = mix(glass, fog, f);
    img.data[i * 4] = out[0]; img.data[i * 4 + 1] = out[1]; img.data[i * 4 + 2] = out[2]; img.data[i * 4 + 3] = 255;
  }
  // the drop at the bottom of each run
  for (let k = 0; k < beads.length; k += 2) {
    const i = beads[k + 1] * MIRROR_W + beads[k];
    const out = mix([img.data[i * 4], img.data[i * 4 + 1], img.data[i * 4 + 2]], DROP, level);
    img.data[i * 4] = out[0]; img.data[i * 4 + 1] = out[1]; img.data[i * 4 + 2] = out[2];
  }
  ctx.putImageData(img, 0, 0);
  return running;
}

const ROOM_FOG = rgb('#e9f0f4'), ROOM_CLEAR = rgb('#6d93a8');
/** The cup and the toothbrush on the shelf, which stand in front of the bottom of the room's mirror (dots of it). */
const IN_FRONT = new Set(['2,11', '3,11', '4,9', '4,10', '4,11']);
/** Draws the room's mirror (ROOM_MIRROR's size) as it is now: the fog, and the writing small. Its opacity is the fog's. */
export function paintRoom(canvas: HTMLCanvasElement | null) {
  const ctx = canvas?.getContext('2d');
  if (!ctx) return;
  const [, , w, h] = ROOM_MIRROR;
  const { c } = clearness(performance.now());
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (IN_FRONT.has(`${x},${y}`)) continue;
    let sum = 0;
    for (let yy = 0; yy < CELL; yy++) for (let xx = 0; xx < CELL; xx++) sum += c[(y * CELL + yy) * MIRROR_W + x * CELL + xx];
    const clear = Math.min(1, (sum / (CELL * CELL)) * 1.6);            // (a thin line still shows, small)
    const out = mix(mix(ROOM_FOG, [214, 226, 233], noise(x, y) * 0.5), ROOM_CLEAR, clear);
    const i = (y * w + x) * 4;
    img.data[i] = out[0]; img.data[i + 1] = out[1]; img.data[i + 2] = out[2]; img.data[i + 3] = 235;
  }
  ctx.putImageData(img, 0, 0);
}
