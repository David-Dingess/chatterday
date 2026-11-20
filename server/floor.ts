// Which floor each person is on: upstairs (the clubhouse, '') or the basement, fitted out one of several ways (a fit-out:
// 'unfinished', 'gameroom'...). Clicking the stairs and picking one takes you there: your room goes dark at once, and you
// are standing at the other end of the stairs (the floor you left sees you walk to them and go). Everyone goes where they like; the room only
// shows the people on your floor.
//
// The basement's fit-outs are the layouts the drawing script wrote to client/src/basement/<id>.gen.ts. A fit-out with a
// game of its own also has a module in server/basement/<id>.ts (see loadFitGames below).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getKV, setKV } from './db.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LAYOUTS = path.join(HERE, '..', 'client', 'src', 'basement');
const GAMES = path.join(HERE, 'basement');

/** The fit-outs there are, by id. */
export const FITS = new Set(fs.existsSync(LAYOUTS) ? fs.readdirSync(LAYOUTS).filter((f) => f.endsWith('.gen.ts')).map((f) => f.slice(0, -7)) : []);

/** Things done upstairs: choosing one of these from the basement takes you back up for it. */
export const UPSTAIRS = new Set(['sleeping', 'showering', 'peeing', 'pooping', 'bathroom', 'kitchen', 'cleaning', 'imhere', 'chillin', 'away']);

// Who is on which floor: missing is upstairs. Kept in kv, so a restart leaves everyone where they were.
const floors = new Map<string, string>((() => {
  try { return Object.entries(JSON.parse(getKV('floors', '{}')) as Record<string, string>).filter(([, f]) => FITS.has(f)); } catch { return []; }
})());
const save = () => setKV('floors', JSON.stringify(Object.fromEntries(floors)));

/** The floor somebody is on: '' upstairs, or the id of the basement fit-out they are in. */
export const floorOf = (uid: string) => floors.get(uid) ?? '';

/** Somebody took the stairs. Returns false for a floor there is not. */
export function setFloor(uid: string, fit: string): boolean {
  if (fit !== '' && !FITS.has(fit)) return false;
  if (floorOf(uid) === fit) return true;
  if (fit) floors.set(uid, fit); else floors.delete(uid);
  save();
  return true;
}

// ── the fit-outs' own games ──
// A fit-out with a game (pool, darts, minigolf...) has a module in server/basement/<id>.ts whose default export is a
// FitGame. The page sends it { t: 'fit', id, ... } and it answers through `out`; what it puts in hello() is in
// everybody's 'ready' (fits[id]), so a page opened in the middle of a game sees it as it stands.
export type FitOut = {
  /** to everybody: arrives at the page as { t: 'fit', id, ...msg } */
  all: (msg: Record<string, unknown>) => void;
  /** to one person, on every device they have open */
  to: (uid: string, msg: Record<string, unknown>) => void;
  /** kept across restarts (in kv, under fit:<id>:<key>) */
  save: (key: string, value: unknown) => void;
  load: <T>(key: string, fallback: T) => T;
  /** who is down here just now: in this fit-out, online and not away; and anyone's name */
  present: () => string[];
  nameOf: (uid: string) => string;
  /** whether they are the admin (the one who runs the place) */
  isAdmin: (uid: string) => boolean;
};
export type FitGame = {
  hello?: () => unknown;
  message?: (uid: string, d: Record<string, unknown>, out: FitOut) => void;
  start?: (out: FitOut) => void;
  /** A game that can be put away (pool, darts, bowling...), as against a table that keeps its things (DnD). Such a game
   *  starts fresh when the server does (restart, update, push: nothing it saved is read back), and is put away when
   *  nobody has touched it for IDLE_MS: reset() puts it back as new and tells everybody. `part` is the `game` its
   *  messages carry, where one module has more than one game ('pool', 'darts'); '' otherwise. */
  reset?: (part: string) => void;
  /** Whether somebody is in this game: playing it (a game going, and them in it), or waiting to (sat or joined, with
   *  none going yet). Their status says so ("Playing Bowling"), or in words of its own (`says`: "singing karaoke"); null
   *  when they are not in it. */
  playing?: (uid: string) => { game: string; waiting: boolean; says?: string } | null;
  /** The game under way at it just now, by its name ('Pool'), for whoever is watching; null when none is. `part` as for
   *  reset(). */
  going?: (part: string) => string | null;
};

/** A game nobody has sent anything to for this long is put away (a game left on had kept every table taken). */
export const IDLE_MS = 5 * 60_000;
const games = new Map<string, { game: FitGame; out: FitOut }>();
/** When each game (fit-out id, then part) was last played. */
const lastPlayed = new Map<string, { id: string; part: string; at: number }>();
setInterval(() => {
  const now = Date.now();
  for (const [key, p] of lastPlayed) {
    if (now - p.at < IDLE_MS) continue;
    lastPlayed.delete(key);
    const g = games.get(p.id);
    try { g?.game.reset?.(p.part); } catch (e) { console.error(`basement game ${p.id} would not reset:`, e); }
  }
}, 20_000).unref?.();

export async function loadFitGames(d: { all: (msg: unknown) => void; to: (uid: string, msg: unknown) => void; present: () => string[]; nameOf: (uid: string) => string; isAdmin: (uid: string) => boolean }) {
  if (!fs.existsSync(GAMES)) return;
  for (const f of fs.readdirSync(GAMES)) {
    if (!f.endsWith('.ts')) continue;
    const id = f.slice(0, -3);
    try {
      const game = ((await import(pathToFileURL(path.join(GAMES, f)).href)) as { default: FitGame }).default;
      const out: FitOut = {
        all: (msg) => d.all({ ...msg, t: 'fit', id }),
        to: (uid, msg) => d.to(uid, { ...msg, t: 'fit', id }),
        save: (key, value) => setKV(`fit:${id}:${key}`, JSON.stringify(value)),
        // (a game that can be put away starts fresh: see reset above)
        load: (key, fallback) => { if (game.reset) return fallback; try { return JSON.parse(getKV(`fit:${id}:${key}`, '')) ?? fallback; } catch { return fallback; } },
        present: () => d.present().filter((uid) => floorOf(uid) === id),
        nameOf: d.nameOf,
        isAdmin: d.isAdmin,
      };
      games.set(id, { game, out });
      game.start?.(out);
      // Anybody already connected (straight back after a restart, before the games were loaded) had none of this in
      // their hello: without it a fit-out draws nothing of its own (the backyard's water, its tables) until something
      // in it changes. So everybody is sent it now, as it is.
      try { d.all({ t: 'fit', id, state: game.hello?.() ?? null }); } catch (e) { console.error(`basement game ${id} could not say hello:`, e); }
    } catch (e) {
      console.error(`basement game ${id} would not load:`, e);
    }
  }
}

/** The basement game somebody is in, if any (a game going wins over one they are only waiting at). */
export function fitPlaying(uid: string): { game: string; waiting: boolean; says?: string } | null {
  let found: { game: string; waiting: boolean; says?: string } | null = null;
  for (const g of games.values()) {
    let p: { game: string; waiting: boolean; says?: string } | null = null;
    try { p = g.game.playing?.(uid) ?? null; } catch { /* (a game that cannot say is not being played) */ }
    if (p && (!found || (found.waiting && !p.waiting))) found = p;
  }
  return found;
}

/** The game under way in one fit-out's game (and part), if any: for somebody watching it. */
export function fitGoing(id: string, part: string): string | null {
  try { return games.get(id)?.game.going?.(part) ?? null; } catch { return null; }
}

export const fitHello = () => Object.fromEntries([...games].map(([id, g]) => [id, g.game.hello?.() ?? null]));

export function fitMessage(uid: string, d: Record<string, unknown>) {
  const g = typeof d.id === 'string' ? games.get(d.id) : undefined;
  if (!g?.game.message) return;
  if (g.game.reset) { const part = typeof d.game === 'string' ? d.game : ''; lastPlayed.set(`${d.id}:${part}`, { id: d.id as string, part, at: Date.now() }); }
  try { g.game.message(uid, d, g.out); } catch (e) { console.error(`basement game ${String(d.id)}:`, e); }
}
