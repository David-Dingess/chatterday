// The whiteboard on the clubhouse wall: one small picture that everybody shares and anybody can draw on.
// It is 200 by 108 dots, each one of twelve inks (0 is the bare board), kept in data/board.bin so it is still
// there after a restart. Pen strokes arrive as short runs of points; they are drawn here too, so the saved
// picture is always the whole truth and a new arrival just asks for it.
import fs from 'node:fs';
import path from 'node:path';
import { DATA } from './config.ts';

export const BOARD_W = 200, BOARD_H = 108;
const INKS = 12;
/** The most dots one piece of a pen stroke may set (see 'line' in drawOn). */
const MAX_DOTS = 250_000;
const file =path.join(DATA, 'board.bin');
const px = new Uint8Array(BOARD_W * BOARD_H);
try {
  const saved = fs.readFileSync(file);
  if (saved.length === px.length) for (let i = 0; i < px.length; i++) px[i] = saved[i] % INKS;
} catch { /* a clean board */ }

// ── a game of Draw & Guess (server/drawguess.ts) borrows the board ──
// The picture that was there is put aside (and it is what goes on saving to the file, so a restart in the middle of a
// game brings it back), only the drawer may draw, and once the game is over the picture is put back.
let kept: Uint8Array | null = null;
let gate: ((userId: string) => boolean) | null = null;
/** Puts the picture aside, and lets only those `mayDraw` says draw until it is given back. */
export function borrowBoard(mayDraw: (userId: string) => boolean) {
  if (!kept) kept = px.slice();
  gate = mayDraw;
  done.clear();
}
/** Gives the board back as it was before the game. */
export function returnBoard() {
  if (kept) px.set(kept);
  kept = null;
  gate = null;
  done.clear();
  touched();
}
/** Wipes the board for the next turn of a game (nobody can undo back past it). */
export function wipeForTurn() {
  px.fill(0);
  done.clear();
}

let timer: ReturnType<typeof setTimeout> | null = null;
function save() {
  timer = null;
  try { fs.writeFileSync(file + '.tmp', kept ?? px); fs.renameSync(file + '.tmp', file); } catch (e: any) { console.log('[board] could not save:', e.message); }
}
const touched = () => { timer ??= setTimeout(save, 2000); };
process.on('exit', () => { if (timer) save(); });

// ── undo ──
// Each person can take back their own last few things (a stroke, a fill, a wipe). For each one we remember what was
// under every dot it changed. Taking it back restores only the dots that still show its ink, so anything somebody
// else has drawn over it since is left alone. Kept in memory only: a restart forgets it.
type Done = { key: string; c: number; under: Map<number, number> };
const done = new Map<string, Done[]>();
const KEEP = 20;
let under: Map<number, number> | null = null;      // where the step being drawn right now notes what it covers
let serial = 0;
function remember(userId: string, key: string, c: number) {
  const list = done.get(userId) ?? [];
  done.set(userId, list);
  const last = list[list.length - 1];
  if (last && last.key === key && last.c === c) return last.under;       // more of the same stroke
  const d: Done = { key, c, under: new Map() };
  list.push(d);
  if (list.length > KEEP) list.shift();
  return d.under;
}
function put(i: number, c: number) {
  if (px[i] === c) return;
  if (under && !under.has(i)) under.set(i, px[i]);
  px[i] = c;
}

function dot(x: number, y: number, c: number, size: number) {
  const x0 = x - (size >> 1), y0 = y - (size >> 1);
  for (let yy = Math.max(0, y0); yy < Math.min(BOARD_H, y0 + size); yy++)
    for (let xx = Math.max(0, x0); xx < Math.min(BOARD_W, x0 + size); xx++) put(yy * BOARD_W + xx, c);
}
/** A straight run of dots from one point to the next, with a square nib. (The page draws the very same way.) */
function stroke(c: number, size: number, x0: number, y0: number, x1: number, y1: number) {
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    dot(x0, y0, c, size);
    if (x0 === x1 && y0 === y1) return;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}
function flood(x: number, y: number, c: number) {
  const from = px[y * BOARD_W + x];
  if (from === c) return;
  const todo = [y * BOARD_W + x];
  while (todo.length) {
    const i = todo.pop()!;
    if (px[i] !== from) continue;
    put(i, c);
    const col = i % BOARD_W;
    if (col > 0) todo.push(i - 1);
    if (col < BOARD_W - 1) todo.push(i + 1);
    if (i >= BOARD_W) todo.push(i - BOARD_W);
    if (i < px.length - BOARD_W) todo.push(i + BOARD_W);
  }
}

const whole = (v: unknown, min: number, max: number): v is number => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;

/** Does one step of drawing for somebody. Gives back the step, checked and tidied, to pass on (`everyone`: to the
 *  one who sent it as well, which undo needs); null if it made no sense or changed nothing. */
export function drawOn(d: any, userId: string): { step: Record<string, unknown>; everyone: boolean } | null {
  try {
    if (gate && !gate(userId)) return null;        // a game is on and it is not their turn to draw
    if (d?.op === 'undo') {
      const last = done.get(userId)?.pop();
      if (!last) return null;
      const at: number[] = [];
      for (const [i, was] of last.under) if (px[i] === last.c) { px[i] = was; at.push(i, was); }
      if (!at.length) return { step: { op: 'set', at }, everyone: false };        // all drawn over since: nothing to put back
      touched();
      return { step: at.length > 8000 ? { op: 'reload' } : { op: 'set', at }, everyone: true };
    }
    if (d?.op === 'clear') {
      under = remember(userId, `clear:${++serial}`, 0);
      for (let i = 0; i < px.length; i++) put(i, 0);
      touched();
      return { step: { op: 'clear' }, everyone: false };
    }
    if (!whole(d?.c, 0, INKS - 1)) return null;
    if (d.op === 'fill') {
      if (!whole(d.x, 0, BOARD_W - 1) || !whole(d.y, 0, BOARD_H - 1)) return null;
      under = remember(userId, `fill:${++serial}`, d.c);
      flood(d.x, d.y, d.c);
      touched();
      return { step: { op: 'fill', c: d.c, x: d.x, y: d.y }, everyone: false };
    }
    if (d.op === 'line') {
      const pts: unknown = d.pts;
      if (!whole(d.s, 1, 12) || !Array.isArray(pts) || pts.length < 4 || pts.length > 800 || pts.length % 2) return null;
      for (let i = 0; i < pts.length; i += 2) if (!whole(pts[i], 0, BOARD_W - 1) || !whole(pts[i + 1], 0, BOARD_H - 1)) return null;
      // How many dots this piece would set: as far as the pen travels, times the nib. A hand sends a piece every fifth
      // of a second, so even a wild scribble with the fattest pen is a small part of this. Without the limit, one
      // message could zigzag corner to corner 399 times (11 million dots), and a burst of them stopped the server
      // answering anybody for seconds.
      let travel = 0;
      for (let i = 2; i < pts.length; i += 2) travel += Math.max(Math.abs(pts[i] - pts[i - 2]), Math.abs(pts[i + 1] - pts[i - 1])) + 1;
      if (travel * d.s * d.s > MAX_DOTS) return null;
      // `k` numbers the stroke (pen down to pen up), which arrives in several pieces: they are taken back together
      under = remember(userId, whole(d.k, 0, 1e9) ? `line:${d.k}` : `line:x${++serial}`, d.c);
      for (let i = 2; i < pts.length; i += 2) stroke(d.c, d.s, pts[i - 2], pts[i - 1], pts[i], pts[i + 1]);
      touched();
      return { step: { op: 'line', c: d.c, s: d.s, pts }, everyone: false };
    }
    return null;
  } finally {
    under = null;
  }
}

/** The whole picture, for somebody who has just arrived. */
export const boardData = () => Buffer.from(px).toString('base64');
