// The DnD table's map, drawn on live (server/basement/dnd/ink.ts keeps it). A sketch for each map, in a few inks, drawn
// in square dots like the maps themselves: on the war table's map in the panel, and on the little map lying on the table
// in the room. Everybody sees a line as it is being drawn.
//
// Points are in map squares. A line goes to the server in pieces while it is drawn ('start', then 'more' every so often,
// each saying where its points go), and comes back to everybody; the one drawing it has it already and skips the echo.
import { useEffect, useRef } from 'react';
import { create } from 'zustand';
import { hooks, send, useStore } from '../../store';

export type Stroke = { id: string; by: string; c: number; w: number; p: number[] };
type Ink = Record<string, Stroke[]>;

export const INKS: [string, string][] = [['#1c1814', 'Black'], ['#c02a2a', 'Red'], ['#2a5ac8', 'Blue'], ['#2a8a3a', 'Green'], ['#f4efe2', 'White'], ['#e8b020', 'Gold']];
/** Widths, in squares (as the server has them). */
export const WIDTHS: [number, string][] = [[0.08, 'Thin'], [0.16, 'Medium'], [0.32, 'Thick']];
const MAX_NUMS = 1000;

type Local = { ink: Ink; seeded: unknown; c: number; w: number; ver: number; epoch: number };
export const useInk = create<Local>()(() => ({ ink: {}, seeded: null, c: 1, w: 1, ver: 0, epoch: 0 }));

let listening = false;
let drawing: { id: string; key: string; sent: number; last: number; timer: number } | null = null;
const me = () => useStore.getState().me?.id ?? '';
const bump = (wiped = false) => useInk.setState((s) => ({ ver: s.ver + 1, epoch: s.epoch + (wiped ? 1 : 0) }));

export function listenInk() {
  if (listening) return;
  listening = true;
  const seed = () => {
    const h = useStore.getState().fits.dnd as { ink?: Ink } | undefined;
    if (!h || h === useInk.getState().seeded) return;
    useInk.setState({ seeded: h, ink: structuredClone(h.ink ?? {}) });
    bump(true);
  };
  seed();
  useStore.subscribe(seed);
  hooks.fit.push((d) => {
    if (d.id !== 'dnd' || d.op !== 'ink') return;
    const ink = useInk.getState().ink, key = String(d.key ?? ''), list = (ink[key] ??= []);
    if (d.act === 'start') {
      const s = d.stroke as Stroke;
      if (!list.some((x) => x.id === s.id)) list.push(s);
      bump();
    } else if (d.act === 'more') {
      if (drawing && drawing.id === d.sid) return;                 // (mine, being drawn: I am ahead of the echo)
      const s = list.find((x) => x.id === d.sid);
      if (s) s.p.splice(Number(d.at), s.p.length - Number(d.at), ...(d.p as number[]));
      bump();
    } else if (d.act === 'erase') {
      const ids = new Set(d.ids as string[]);
      ink[key] = list.filter((x) => !ids.has(x.id));
      bump(true);
    } else if (d.act === 'clear') {
      ink[key] = [];
      bump(true);
    }
  });
}

const ink = (rest: Record<string, unknown>) => send({ ...rest, t: 'fit', id: 'dnd', op: 'ink' });

/** Starts a line at (x, y), in squares, on the map `key`. */
export function penDown(key: string, x: number, y: number) {
  penUp();
  const { c, w } = useInk.getState();
  const id = `${me().slice(0, 6)}${Math.random().toString(36).slice(2, 10)}`.replace(/[^\w-]/g, '').padEnd(4, '0');
  const p = [round(x), round(y)];
  const list = (useInk.getState().ink[key] ??= []);
  list.push({ id, by: me(), c, w, p });
  ink({ act: 'start', sid: id, c, w, p });
  drawing = { id, key, sent: 2, last: Date.now(), timer: window.setInterval(flush, 70) };
  bump();
}
const round = (v: number) => Math.round(v * 50) / 50;
function flush() {
  const d = drawing;
  if (!d) return;
  const s = useInk.getState().ink[d.key]?.find((x) => x.id === d.id);
  if (!s || s.p.length <= d.sent) return;
  ink({ act: 'more', sid: d.id, at: d.sent, p: s.p.slice(d.sent) });
  d.sent = s.p.length;
}
/** The pen moved to (x, y): a point, if it has gone far enough (a long line carries on as a new one). */
export function penMove(x: number, y: number) {
  const d = drawing;
  if (!d) return;
  const s = useInk.getState().ink[d.key]?.find((q) => q.id === d.id);
  if (!s) return;
  const lx = s.p[s.p.length - 2], ly = s.p[s.p.length - 1];
  if (Math.hypot(x - lx, y - ly) < 0.06) return;
  if (s.p.length >= MAX_NUMS) { const key = d.key; penUp(); penDown(key, lx, ly); return penMove(x, y); }
  s.p.push(round(x), round(y));
  bump();
}
export function penUp() {
  if (!drawing) return;
  flush();
  window.clearInterval(drawing.timer);
  drawing = null;
}

/** The lines within reach of (x, y) that I may rub out. */
export function eraseAt(key: string, x: number, y: number, boss: boolean) {
  const list = useInk.getState().ink[key] ?? [];
  const hit = list.filter((s) => (boss || s.by === me()) && near(s, x, y, Math.max(0.3, WIDTHS[s.w]?.[0] ?? 0.1))).map((s) => s.id);
  if (hit.length) ink({ act: 'erase', ids: hit });
}
function near(s: Stroke, x: number, y: number, r: number) {
  const p = s.p;
  if (p.length === 2) return Math.hypot(p[0] - x, p[1] - y) <= r;
  for (let i = 2; i < p.length; i += 2) {
    const ax = p[i - 2], ay = p[i - 1], bx = p[i], by = p[i + 1], dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
    const t = L ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L)) : 0;
    if (Math.hypot(ax + t * dx - x, ay + t * dy - y) <= r) return true;
  }
  return false;
}
export const undoInk = () => ink({ act: 'undo' });
export const clearInk = () => ink({ act: 'clear' });
export const clearMyInk = () => ink({ act: 'mine' });

/** Draws strokes onto a canvas the size of the map picture (`sq` dots a square), in square dots, from point `from` of
 *  each (by id) on: a growing line is only drawn where it is new. */
function paint(c: CanvasRenderingContext2D, list: Stroke[], sq: number, done: Map<string, number>) {
  for (const s of list) {
    const from = done.get(s.id) ?? 0;
    if (from >= s.p.length) continue;
    const size = Math.max(1, Math.round((WIDTHS[s.w]?.[0] ?? 0.1) * sq)), half = Math.floor(size / 2);
    c.fillStyle = INKS[s.c]?.[0] ?? '#000';
    const dot = (x: number, y: number) => c.fillRect(x - half, y - half, size, size);
    let px = Math.round(s.p[Math.max(0, from - 2)] * sq), py = Math.round(s.p[Math.max(1, from - 1)] * sq);
    if (from === 0) dot(px, py);
    for (let i = Math.max(2, from); i < s.p.length; i += 2) {
      const x = Math.round(s.p[i] * sq), y = Math.round(s.p[i + 1] * sq);
      // (a line of dots from the last point, every step: Bresenham)
      let x0 = px, y0 = py;
      const dx = Math.abs(x - x0), dy = -Math.abs(y - y0), sx = x0 < x ? 1 : -1, sy = y0 < y ? 1 : -1;
      let err = dx + dy, step = 0;
      for (;;) {
        if (step++ % Math.max(1, half) === 0) dot(x0, y0);
        if (x0 === x && y0 === y) break;
        const e2 = 2 * err;
        if (e2 >= dy) { err += dy; x0 += sx; }
        if (e2 <= dx) { err += dx; y0 += sy; }
      }
      dot(x, y);
      px = x; py = y;
    }
    done.set(s.id, s.p.length);
  }
}

/** The drawing on map `mapKey`, over a picture `w` x `h` dots with `sq` dots a square: a canvas that fills its box. */
export function InkCanvas({ mapKey, w, h, sq, className }: { mapKey: string; w: number; h: number; sq: number; className?: string }) {
  listenInk();
  const ref = useRef<HTMLCanvasElement>(null);
  const ver = useInk((s) => s.ver);
  const epoch = useInk((s) => s.epoch);
  const done = useRef<{ key: string; epoch: number; sq: number; w: number; h: number; map: Map<string, number> }>({ key: '', epoch: -1, sq: 0, w: 0, h: 0, map: new Map() });
  useEffect(() => {
    const c = ref.current?.getContext('2d');
    if (!c) return;
    const d = done.current;
    if (d.key !== mapKey || d.epoch !== epoch || d.sq !== sq || d.w !== w || d.h !== h) {   // anything taken away: drawn again from nothing
      c.clearRect(0, 0, w, h);
      done.current = { key: mapKey, epoch, sq, w, h, map: new Map() };
    }
    paint(c, useInk.getState().ink[mapKey] ?? [], sq, done.current.map);
  }, [ver, epoch, mapKey, sq, w, h]);
  return <canvas ref={ref} className={className ?? 'dnd-ink'} width={w} height={h} aria-hidden />;
}
