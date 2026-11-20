// The whiteboard on the clubhouse wall: one small picture (200 by 108 dots, twelve inks) that everybody shares.
// The server keeps it. Every pen stroke is drawn here at once and sent on, and everyone else's strokes arrive
// the same way, so the wall and the big drawing view always show the same thing.
import { api } from './api';
import { hooks, send } from './store';

export const BOARD_W = 200, BOARD_H = 108;
/** Ink 0 is the bare board (what the eraser leaves). */
export const INKS = ['#f7f6f0', '#1b1c22', '#d8342c', '#f08a1c', '#f2c81e', '#3aa845', '#1f9aa8', '#2f62d8', '#7b3fc4', '#e85aa0', '#7a4a2a', '#8d93a3'];
const RGB = INKS.map((h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]);

const px = new Uint8Array(BOARD_W * BOARD_H);
const watchers = new Set<() => void>();
let queued = false;
function changed() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => { queued = false; for (const w of watchers) w(); });
}
/** Calls back whenever the picture changes. Returns the way to stop. */
export function watchBoard(fn: () => void) { watchers.add(fn); return () => { watchers.delete(fn); }; }

function dot(x: number, y: number, c: number, size: number) {
  const x0 = x - (size >> 1), y0 = y - (size >> 1);
  for (let yy = Math.max(0, y0); yy < Math.min(BOARD_H, y0 + size); yy++)
    for (let xx = Math.max(0, x0); xx < Math.min(BOARD_W, x0 + size); xx++) px[yy * BOARD_W + xx] = c;
}
/** A straight run of dots with a square nib. (The server draws the very same way: see server/board.ts.) */
function stroke(c: number, size: number, x0: number, y0: number, x1: number, y1: number) {
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (let guard = 0; guard < 1000; guard++) {
    dot(x0, y0, c, size);
    if (x0 === x1 && y0 === y1) return;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}
function flood(x: number, y: number, c: number) {
  if (x < 0 || y < 0 || x >= BOARD_W || y >= BOARD_H) return;
  const from = px[y * BOARD_W + x];
  if (from === c) return;
  const todo = [y * BOARD_W + x];
  while (todo.length) {
    const i = todo.pop()!;
    if (px[i] !== from) continue;
    px[i] = c;
    const col = i % BOARD_W;
    if (col > 0) todo.push(i - 1);
    if (col < BOARD_W - 1) todo.push(i + 1);
    if (i >= BOARD_W) todo.push(i - BOARD_W);
    if (i < px.length - BOARD_W) todo.push(i + BOARD_W);
  }
}

export type Step = { op: 'line'; c: number; s: number; pts: number[]; /** which of my strokes this is a piece of */ k: number } | { op: 'fill'; c: number; x: number; y: number } | { op: 'clear' } | { op: 'undo' };
function apply(d: any) {
  if (d.op === 'pict') return takePict(d.game);
  const c = (Number(d.c) || 0) % INKS.length;
  if (d.op === 'clear') px.fill(0);
  else if (d.op === 'reload') return void loadBoard().catch(() => {});
  else if (d.op === 'set' && Array.isArray(d.at)) { for (let i = 0; i + 1 < d.at.length; i += 2) if (d.at[i] >= 0 && d.at[i] < px.length) px[d.at[i]] = (d.at[i + 1] | 0) % INKS.length; }       // dots put back by an undo
  else if (d.op === 'fill') flood(d.x | 0, d.y | 0, c);
  else if (d.op === 'line' && Array.isArray(d.pts)) for (let i = 2; i + 1 < d.pts.length; i += 2) stroke(c, d.s | 0, d.pts[i - 2] | 0, d.pts[i - 1] | 0, d.pts[i] | 0, d.pts[i + 1] | 0);
  changed();
}

/** One segment of my own pen, on my own screen only: it is sent on in batches with `sendStep`. */
export function ink(c: number, size: number, x0: number, y0: number, x1: number, y1: number) { stroke(c, size, x0, y0, x1, y1); changed(); }
/** Sends a step to everybody. A fill or a wipe is also done here; pen lines were already drawn as they were made. */
export function sendStep(step: Step) {
  if (step.op === 'fill' || step.op === 'clear') apply(step);       // an undo comes back from the server as the dots to put back
  send({ t: 'board', ...step });
}

/** Puts the picture into a canvas that is exactly BOARD_W by BOARD_H. */
export function paint(canvas: HTMLCanvasElement | null) {
  const ctx = canvas?.getContext('2d');
  if (!ctx) return;
  const img = ctx.createImageData(BOARD_W, BOARD_H);
  for (let i = 0; i < px.length; i++) {
    const [r, g, b] = RGB[px[i]] ?? RGB[0];
    img.data[i * 4] = r; img.data[i * 4 + 1] = g; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

/** Fetches the whole picture as the server has it. */
export async function loadBoard() {
  const r = await api<{ data: string; pict?: Pict | null }>('/board');
  takePict(r.pict ?? null);
  const bin = atob(r.data);
  if (bin.length !== px.length) return;
  for (let i = 0; i < px.length; i++) px[i] = bin.charCodeAt(i) % INKS.length;
  changed();
}
hooks.ready.push(() => void loadBoard().catch(() => {}));

// ───────── Draw & Guess (server/drawguess.ts) ─────────
// The server runs the game; this keeps what it last said. Only the drawer is sent the word. Guesses are typed beside
// the board and shown in the game's own feed, never in the text chat.
export type Pict = {
  by: string; round: number; rounds: number; drawer: string; phase: 'lobby' | 'drawing' | 'between' | 'over';
  /** when this part ends, on this page's clock */ ends: number; turnMs: number;
  /** the word as guessers see it ("_ _ A _"), the word itself (the drawer only), and the word just gone */ hint: string; word: string; was: string;
  guessed: string[]; scores: Record<string, number>; canSwap: boolean;
  /** who is in the game, and whether I am */ players: string[]; joined: boolean;
  /** the game's own lines: what happened, and everybody's guesses */ feed: { k: 'sys' | 'guess' | 'got'; who?: string; text: string }[];
};
let pict: Pict | null = null;
const pictWatchers = new Set<() => void>();
function takePict(g: any) {
  pict = g && typeof g === 'object' ? { ...g, ends: Number(g.ends) - (Number(g.now) || Date.now()) + Date.now() } : null;
  for (const w of pictWatchers) w();
}
/** The game on the board just now, if there is one. */
export const pictNow = () => pict;
/** Calls back whenever the game changes. Returns the way to stop. */
export function watchPict(fn: () => void) { pictWatchers.add(fn); return () => { pictWatchers.delete(fn); }; }
/** Open a game (with so many rounds), join or leave it, start it, stop it, or ask for a different word (the drawer, once a turn). */
export function pictDo(what: 'open' | 'join' | 'leave' | 'begin' | 'stop' | 'swap', rounds?: number) { send({ t: 'board', op: 'pict', do: what, rounds }); }
/** A guess, from the box beside the board. */
export function pictGuess(text: string) { send({ t: 'board', op: 'pict', do: 'guess', text }); }
hooks.board.push(apply);
