// The bathroom mirror, steamed up. Once somebody has been in the shower for a little while, the mirror over the sink
// fogs over, and anybody can write on it with a finger: every stroke wipes the fog away to the dark glass beneath, and
// now and then a drop runs down from it. A few minutes after the last shower ends the fog lifts by itself, writing and
// all. Kept in memory only (a restart clears the mirror): there is no saving and no history.
// The page draws the strokes the same way (client/src/mirror.ts), so both always agree on what is wiped.

import { achieve } from './achievements.ts';

export const MIRROR_W = 72, MIRROR_H = 48;
/** How long somebody has to have been showering before the mirror fogs up. */
const STEAM_MS = Number(process.env.CHATTERDAY_MIRROR_STEAM_MS) || 45_000;
/** How long after the last shower ends until the fog has gone, writing and all. (The page lets it thin out slowly.) */
const CLEAR_MS = Number(process.env.CHATTERDAY_MIRROR_CLEAR_MS) || 4 * 60_000;
/** The most drops running down the glass at once. */
const MAX_DRIPS = 60;

// Each dot of the glass: 0 fogged, 1 the soft edge of a stroke (half wiped), 2 wiped clear.
const px = new Uint8Array(MIRROR_W * MIRROR_H);
/** The drops: where each one starts and how far it runs down, x, y, length, ... */
let drips: number[] = [];
/** Whether the mirror is fogged at all, and (once the shower is over) when the fog will have gone. */
let on = false, ends = 0;

/** A finger's touch: a small round of clear glass with a soft rim. (The page wipes the very same way.) */
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
  for (;;) {
    touch(x0, y0);
    if (x0 === x1 && y0 === y1) return;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

const whole = (v: unknown, min: number, max: number): v is number => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;

/** What the mirror is like just now, for a page that has just arrived (or after it has fogged up or cleared). */
const stateMsg = () => ({ t: 'mirror', op: 'all', on, left: on && ends ? Math.max(0, ends - Date.now()) : 0, fade: CLEAR_MS, data: Buffer.from(px).toString('base64'), drips });

export function makeMirror(o: {
  /** Since when each person who is showering just now has been (whoever is showering, however long). */
  showering: () => number[];
  /** Sends to every page in the room. */
  everyone: (msg: unknown) => void;
}) {
  const look = () => {
    const now = Date.now();
    const steamy = o.showering().some((since) => now - since >= STEAM_MS);
    if (steamy && (!on || ends)) {                   // fogs over (or back over, writing and all still there, if somebody is in again)
      if (!on) { px.fill(0); drips = []; }
      on = true; ends = 0;
      o.everyone(stateMsg());
    } else if (!steamy && on && !ends) {             // out of the shower: from now on the fog thins out
      ends = now + CLEAR_MS;
      o.everyone(stateMsg());
    } else if (on && ends && now >= ends) {          // gone: a clear mirror again
      on = false; ends = 0;
      px.fill(0); drips = [];
      o.everyone(stateMsg());
    }
  };
  setInterval(look, Math.min(5000, Math.max(500, STEAM_MS / 4))).unref();

  return {
    /** Something from a page: 'hello' (it wants the whole mirror; the answer is for it alone) or 'line' (a piece of a
     *  finger's stroke, which is passed on to everybody, its sender too, with any drops that ran from it). */
    handle(d: any, by = ''): unknown | null {
      if (d?.op === 'hello') return stateMsg();
      if (d?.op !== 'line' || !on) return null;
      const pts: unknown = d.pts;
      if (!Array.isArray(pts) || pts.length < 2 || pts.length > 400 || pts.length % 2) return null;
      for (let i = 0; i < pts.length; i += 2) if (!whole(pts[i], 0, MIRROR_W - 1) || !whole(pts[i + 1], 0, MIRROR_H - 1)) return null;
      if (pts.length === 2) touch(pts[0], pts[1]);
      for (let i = 2; i < pts.length; i += 2) wipe(pts[i - 2], pts[i - 1], pts[i], pts[i + 1]);
      // Now and then a drop gathers under the stroke and runs down: from its lowest points, at most two a piece.
      const fresh: number[] = [];
      for (let i = 0; i < pts.length && fresh.length < 6; i += 2) {
        const x = pts[i] as number, y = (pts[i + 1] as number) + 2;
        if (y >= MIRROR_H - 3 || Math.random() > 0.08) continue;
        fresh.push(Math.max(0, Math.min(MIRROR_W - 1, x + (Math.random() < 0.5 ? -1 : 1))), y, Math.min(MIRROR_H - 1 - y, 4 + Math.floor(Math.random() * 12)));
      }
      drips = drips.concat(fresh).slice(-MAX_DRIPS * 3);
      o.everyone({ t: 'mirror', op: 'line', pts, drips: fresh });
      if (by) achieve.award(by, 'mirror');
      return null;
    },
  };
}
