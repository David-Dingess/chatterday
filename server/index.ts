import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { pipeline } from 'node:stream';
import zlib from 'node:zlib';
import type { Duplex } from 'node:stream';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import { DATA, DIST, LIMITS, LK, PORT, ROOT, UPLOADS, bindAddresses } from './config.ts';
import { findVideos, NoSearch, PLAYABLE, playerChanged, playerNow, signUp, videoDetails, youtubeKey } from './music.ts';
import { cleanTown, fetchWeather, findTowns, validZone } from './weather.ts';
import { envZone, hostZone, houseZone } from './clock.ts';
import { MAX_WALL, WALL_TYPES, onNewDay, wallAdd, wallClear, wallPool, wallRemove, wallToday } from './wallphotos.ts';
import { linkIn, previewFor } from './links.ts';
import { BOARD_H, BOARD_W, boardData, drawOn } from './board.ts';
import type { Town, Weather } from './weather.ts';
import { makeMirror } from './mirror.ts';
import { makeDrawGuess } from './drawguess.ts';
import { cleanLook } from '../shared/look.ts';
import { cleanPet } from '../shared/pet.ts';
import { cleanDesk } from '../shared/desk.ts';
import { makeTable } from './games.ts';
import { ballNow, kick, STEP_MS } from './ball.ts';
import { fitGoing, fitHello, fitMessage, fitPlaying, floorOf, loadFitGames, setFloor, UPSTAIRS } from './floor.ts';
import { toss, TOSS_STEP_MS } from '../client/src/toss.ts';
import { CLUB } from '../client/src/clubhouse.gen.ts';
import { LAYOUT as YARD } from '../client/src/basement/backyard.gen.ts';
import type { Playing, Song } from './music.ts';
import { COLORS, checkPassword, cleanName, createUser, resetPassword, setPassword, whyNot } from './accounts.ts';
import { all, createInvite, get, getKV, rid, run, setKV, sha, tx, userCount } from './db.ts';
import { execFile, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { kickFromVoice, onVoiceChange, restartLiveKit, startLiveKit, stopLiveKit, voiceReady, voiceToken } from './livekit.ts';
import { achieve } from './achievements.ts';

// ───────────────────────── helpers ─────────────────────────

type UserRow = {
  id: string; name: string; color: string; avatar: string | null; emoji: string; role: string;
  theme: string | null; status: string; invisible: number; look: string | null; pet: string | null; desk: string | null;
  entrance: number | null; exit_sound: number | null; entrance_at: number | null; prefs: string | null; prefs_at: number | null; talk: number | null; birthday: string | null; seen_at: number | null;
};
const parsed = (text: string | null) => { try { return text ? JSON.parse(text) : null; } catch { return null; } };

// What everybody may know about a person. `look`, `pet` and `desk` are what they built for themselves; each
// person's own app draws the pictures from them.
const publicUser = (u: UserRow) => ({
  id: u.id, name: u.name, color: u.color, emoji: u.emoji, role: u.role, status: u.status,
  avatar: u.avatar ? `/files/${u.avatar}` : null, look: parsed(u.look), pet: parsed(u.pet), desk: parsed(u.desk),
  talk: u.talk ?? null, birthday: u.birthday ?? null, seenAt: u.seen_at ?? null,
});
const selfUser = (u: UserRow) => ({ ...publicUser(u), theme: parsed(u.theme), invisible: !!u.invisible, entrance: u.entrance ?? null, exit: u.exit_sound ?? null,
  prefs: parsed(u.prefs), prefsAt: u.prefs_at ?? 0 });
const userById = (id: string) => get<UserRow>('SELECT * FROM users WHERE id = ?', id);
/** People sign in by name, so no two may share one (whatever the capitals). */
const nameTaken = (name: string, butFor = '') => !!get('SELECT 1 FROM users WHERE name = ? COLLATE NOCASE AND id != ?', name, butFor);

function json(res: ServerResponse, code: number, body: unknown) {
  const text = JSON.stringify(body);
  // A big answer (a page of chat, the drawing board) goes squeezed to whoever can read it: JSON shrinks to a fifth or
  // far less, and gzip of a few tens of KB takes well under a millisecond, so doing it as it goes costs nothing felt.
  // (small ones go as they are: squeezing them saves less than the header that says so)
  if (text.length >= 2048 && res.req && reads(res.req, 'gzip')) {
    const squeezed = zlib.gzipSync(text, { level: 6 });
    res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding', 'Content-Length': squeezed.length });
    return void res.end(squeezed);
  }
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(text);
}

/** Something the caller got wrong: answered with 400, and not written to the log as a fault of ours. */
class BadRequest extends Error {}

/** JSON from outside, read so that nothing in it can make String() or Number() throw. An object that has a 'toString'
 *  or a 'valueOf' of its own which is not a function does exactly that, and every handler below leans on those two
 *  to tame what it is sent: each such message used to end as a fault of ours, with a stack trace in the log. */
const parseJson = (text: string): unknown => JSON.parse(text, (k, v) => (k === 'toString' || k === 'valueOf' ? undefined : v));


/** The body of a request, which has to be a JSON object (every caller reads fields off it). */
function readJson(req: IncomingMessage, limit = 256 * 1024): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) { reject(new BadRequest('That is too much to send.')); req.destroy(); } else chunks.push(c);
    });
    req.on('end', () => {
      let body: unknown;
      try { body = parseJson(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { /* refused just below */ }
      if (body && typeof body === 'object' && !Array.isArray(body)) resolve(body); else reject(new BadRequest('That request could not be read.'));
    });
    req.on('error', reject);
  });
}

const isLoopback = (req: IncomingMessage) => /^(::ffff:)?127\.|^::1$/.test(req.socket.remoteAddress ?? '');

/** Really someone at the host PC: a loopback connection, asked for by a loopback name, and not a proxy on this PC
 *  passing on somebody else (`tailscale serve` and the like connect from 127.0.0.1 too). The name check stops a web
 *  page that points its own domain at 127.0.0.1 (DNS rebinding) from passing itself off as local. */
const isHostPC = (req: IncomingMessage) =>
  isLoopback(req) && /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(String(req.headers.host ?? '')) &&
  !req.headers['x-forwarded-for'] && !req.headers['x-forwarded-host'] && !req.headers.forwarded &&
  !Object.keys(req.headers).some((k) => k.startsWith('tailscale-'));

/** Browsers always send Origin on writes and WebSocket upgrades; it must be our own address. */
function sameOrigin(req: IncomingMessage) {
  try {
    const host = new URL(req.headers.origin ?? '').host;
    const fwd = isLoopback(req) ? String(req.headers['x-forwarded-host'] ?? '') : '';
    return host === req.headers.host || (fwd !== '' && host === fwd);
  } catch { return false; }
}

function cookie(req: IncomingMessage, name: string) {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return '';
}

function auth(req: IncomingMessage): UserRow | null {
  const token = cookie(req, 'cd_session');
  if (!token) return null;
  const hash = sha(token);
  const s = get<{ user_id: string; last_seen: number }>('SELECT user_id, last_seen FROM sessions WHERE hash = ?', hash);
  if (!s) return null;
  const u = userById(s.user_id);
  if (!u || u.role === 'removed') return null;
  if (Date.now() - s.last_seen > 60_000) run('UPDATE sessions SET last_seen = ? WHERE hash = ?', Date.now(), hash);
  return u;
}

/** Work out the real type from the first bytes; never trust what the uploader claims. */
function sniff(b: Buffer): string {
  const s = (o: number, n: number) => b.subarray(o, o + n).toString('latin1');
  if (b[0] === 0x89 && s(1, 3) === 'PNG') return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (s(0, 4) === 'GIF8') return 'image/gif';
  if (s(0, 4) === 'RIFF' && s(8, 4) === 'WEBP') return 'image/webp';
  if (s(0, 4) === 'RIFF' && s(8, 4) === 'WAVE') return 'audio/wav';
  if (s(0, 4) === 'OggS') return 'audio/ogg';
  if (s(0, 4) === 'fLaC') return 'audio/flac';
  if (s(0, 3) === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return 'audio/mpeg';
  if (s(4, 4) === 'ftyp') return /^M4A|^M4B/.test(s(8, 4)) ? 'audio/mp4' : s(8, 4) === 'avif' ? 'image/avif' : 'video/mp4';
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'video/webm';
  return 'application/octet-stream';
}
const INLINE = /^(image|audio|video)\//;

// ───────────────────────── live state ─────────────────────────

/** `watching`: whose shared screens this person has open, so the one sharing can see who is looking. */
type Voice = { channelId: number; muted: boolean; deafened: boolean; sharing: boolean; watching: string[]; /** they have the Player's video large (the Theatre view, or full screen) */ big: boolean;
  /** what they are sharing, in a few words: the window or screen they picked ("Elden Ring", "Screen 1") */ label: string };
type Conn = {
  ws: WebSocket; userId: string; kind: string; alive: boolean; hits: number;
  /** The sign-in this connection came in on (its hash): when that is ended, so is the connection. */
  session: string;
  activity: { state: string; label: string }; voice: Voice | null;
};
const conns = new Set<Conn>();
/** How much each person has sent in the last ten seconds, over every window they have open. The allowance is the
 *  person's, not the connection's: counted per connection, forty connections were forty allowances, and one person
 *  could hold the whole server up for seconds at a time. */
const meters = new Map<string, { hits: number; bytes: number; kinds?: Map<string, number>; cut?: boolean }>();
/** The most windows one person may have connected at once (the app, a browser tab or two, a phone: nowhere near). */
const MAX_WINDOWS = 12;
/** The most one person may send in ten seconds, in bytes, before their connection is dropped. */
const MAX_BYTES = 8 * 1024 * 1024;
/** Closes the live connections of whoever has just been signed out; their page goes back to the sign-in screen. */
function signOut(which: (c: Conn) => boolean, why: string) {
  for (const c of conns) if (which(c)) c.ws.close(4001, why);
}
const previews = new Map<string, string>();
const RANK: Record<string, number> = { away: 0, desk: 1, watching: 2, gaming: 3 };

// Where someone says they are, which wins over what their PC reports.
// A spot they clicked ('here') keeps what they had chosen before it (`under`), to go back to when they leave the spot.
type At = { place: string; since: number; until: number; at?: { x: number; y: number; seat: string }; under?: At };
// What they choose by hand wins over what their PC (or the lack of one) says: it stays through the PC going idle or
// locking, the app closing and the server restarting, until they choose something else. With nothing of theirs
// connected it still shows, for up to PLACE_HOLD after they chose it (then they are just offline). A spot in the
// room they clicked ('here': a seat, a bean bag, a spot on the floor) is only where they are standing, and goes when
// they do; but not when the server restarts under them. It is kept on disk with the rest, and for REJOIN_MS after the
// server starts, nobody counts as gone: everybody's app is on its way back, and finds them where they were.
const PLACE_HOLD = 8 * 3600_000;
const STARTED = Date.now(), REJOIN_MS = 90_000;
const rejoining = () => Date.now() - STARTED < REJOIN_MS;
/** Restarting for an update (restartForUpdate, far below): set here, at the top, as voice messages can arrive while the rest of this file is still being read. */
let restarting = false;
const places = new Map<string, At>((() => { try { return Object.entries(JSON.parse(getKV('places', '{}')) as Record<string, At>); } catch { return []; } })());
const savePlaces = () => setKV('places', JSON.stringify(Object.fromEntries(places)));
// Gone to bed for the night. "Sleeping" chosen in the night (or still standing when the night begins) holds until the
// morning: through the PC locking, the app quitting, the page taking it back when the PC is touched, all of it. Only
// their choosing something else by hand ends it sooner. The night is 10 PM to 8 AM, on the house's clock. Kept on disk
// as well, so a restart of the server does not wake anybody. (userId → when it ends)
const asleep: Record<string, { until: number; since: number }> = (() => { try { return JSON.parse(getKV('asleep', '{}')); } catch { return {}; } })();
const saveAsleep = () => setKV('asleep', JSON.stringify(asleep));
const NIGHT = { start: 22, end: 8 };
const nightOf = (_userId: string) => NIGHT;      // (one night for everybody; a per-person sleep window can come later)
/** Minutes past midnight on the house's clock. */
function clockMin(at = Date.now()) {
  const [h, m] = new Date(at).toLocaleTimeString('en-US', { hour12: false, timeZone: houseZone() }).split(':').map(Number);
  return (h % 24) * 60 + m;
}
/** When their night ends, if it is night for them now. */
function nightEnds(userId: string, at = Date.now()) {
  const { start, end } = nightOf(userId), now = clockMin(at);
  const inside = start > end ? now >= start * 60 || now < end * 60 : now >= start * 60 && now < end * 60;
  if (!inside) return 0;
  const left = (end * 60 - now + 1440) % 1440 || 1440;
  return at - (at % 60_000) + left * 60_000;
}
/** Asleep for the night (put to bed now if they chose "Sleeping" earlier and the night has begun). */
function sleeping(userId: string) {
  const z = asleep[userId];
  if (z && z.until <= Date.now()) {
    delete asleep[userId]; saveAsleep();
    // (morning, and not about: out of bed, so the status held for the absent does not keep them there past 8)
    if (places.get(userId)?.place === 'sleeping' && ![...conns].some((c) => c.userId === userId)) { places.delete(userId); savePlaces(); }
  }
  else if (z) return z;
  const p = places.get(userId);
  if (p?.place !== 'sleeping') return undefined;
  const until = nightEnds(userId);
  if (!until) return undefined;
  asleep[userId] = { until, since: p.since };
  saveAsleep();
  wakeAt(userId);
  return asleep[userId];
}
const wakeTimers = new Map<string, NodeJS.Timeout>();
const placeTimers = new Map<string, NodeJS.Timeout>();      // (the "that place is over" check, one per person: see 'place')
/** In the morning: still about, they stay in bed as before (until they say otherwise); not about, they are offline. */
function wakeAt(userId: string) {
  const z = asleep[userId];
  clearTimeout(wakeTimers.get(userId));
  if (z) wakeTimers.set(userId, setTimeout(() => { sleeping(userId); pushPresence(userId); }, Math.max(0, z.until - Date.now()) + 500).unref());
}
for (const id of Object.keys(asleep)) wakeAt(id);
// Whoever is not asleep, checked every minute, so somebody who chose "Sleeping" at 9 and is still in bed at 10 is held there.
// (and anything chosen that has run out by now, an errand or a status held for somebody long gone, is taken down)
setInterval(() => {
  for (const [id, p] of places) {
    if (p.place === 'sleeping' && !asleep[id]) sleeping(id);
    if (!placeOf(id)) pushPresence(id);
  }
}, 60_000).unref();
// 'here' is a seat or a point on the floor that somebody clicked in the room; it comes with where (`at`).
const PLACES = new Set(['gaming', 'watching', 'kitchen', 'peeing', 'pooping', 'bathroom', 'sleeping', 'working', 'cleaning', 'exercising', 'showering', 'prompting', 'doomscrolling', 'vcall', 'calling', 'away', 'here', 'imhere', 'chillin']);
// The short errands wear off by themselves, so nobody is left in the bathroom overnight because they forgot to say they
// were back. The rest last until they are changed (the page takes "sleeping" and "away" back when its person returns).
const PLACE_MS: Record<string, number> = { peeing: 3 * 60_000, pooping: 10 * 60_000, bathroom: 10 * 60_000, kitchen: 20 * 60_000, showering: 20 * 60_000, cleaning: 60 * 60_000, exercising: 90 * 60_000, calling: 45 * 60_000 };
// Things people do in the room, on their own or (the last three) to somebody else. The server only passes them on.
// ('kick': walking up to the football, with the way it was aimed. The kick itself is its own message, sent when they get there: see ball.ts.)
const ACTS = new Set(['dance', 'cheer', 'lap', 'spin', 'laugh', 'cry', 'highfive', 'hug', 'punch', 'pet', 'kick']);
// Paper thrown at the bin in the kitchen. A throw is worked out here (client/src/toss.ts, which the page also uses to
// draw the aiming line) and everybody is sent the same flight. How many each person has got in is kept for good;
// how many in a row, only while the server runs.
const tossMade: Record<string, number> = (() => { try { return JSON.parse(getKV('paperToss', '{}')); } catch { return {}; } })();
const tossStreak = new Map<string, number>();
const lastToss = new Map<string, number>();
/** The games on the arcade machine (they are played in the page: client/src/components/Arcade.tsx). The server keeps the scores. */
const ARCADE = ['maze', 'moths', 'rocks', 'paddle'];
const arcadeScores = () => Object.fromEntries(ARCADE.map((g) => [g, all<{ userId: string; score: number }>('SELECT user_id AS userId, score FROM arcade_scores WHERE game = ? ORDER BY score DESC, at ASC LIMIT 6', g)]));
const ACTS_WITH = new Set(['highfive', 'hug', 'punch']);
const lastAct = new Map<string, number>();
let actIds = 0;

// The house has six of everything: six desks, six bunks. Nobody owns one. Whoever is online holds a numbered
// place, the lowest that is free when they arrive, and keeps it until they go: places 0 to 5 are a desk and a
// bunk; anyone after that is a visitor with a laptop and a spot on the floor.
const slots = new Map<string, number>();
function takeSlot(userId: string) {
  if (slots.has(userId)) return;
  const used = new Set(slots.values());
  let n = 0;
  while (used.has(n)) n++;
  slots.set(userId, n);
}
/** How long before the same person's entrance sound plays again: somebody in and out of voice all evening is announced once. */
const ENTRANCE_REST = 60 * 60_000;
const lastExit = new Map<string, number>();
/** Their exit sound, for whoever is still in the voice chat they have just left (and not again for a minute). */
function exitSound(userId: string, chan: number) {
  const id = userById(userId)?.exit_sound;
  if (!id || Date.now() - (lastExit.get(userId) ?? 0) < 60_000 || !get('SELECT 1 FROM sounds WHERE id = ?', id)) return;
  lastExit.set(userId, Date.now());
  toVoice(chan, { t: 'sound', id, userId, channelId: chan }, userId);
}
const lastWave = new Map<string, number>();         // "from>to" → when
// Ask to share (client/src/askshare.ts): "from>to" → when asked, once per ASK_EVERY; and the asks still waiting for an
// answer, so a "Not now" is passed back only to somebody who really asked, and only once.
const ASK_EVERY = 10 * 60_000;
const lastAsk = new Map<string, number>();
const askOpen = new Set<string>();
// A drink from the fridge. It is theirs for half an hour (a coffee, two hours: it is sipped all morning), wherever they
// go and whatever else they do, then it is finished. At a desk it stands on the desk rather than in the hand. `since` tells one drink from the next: the room has them walk to the fridge for each new one.
// (anything else in the hand is counted the same way: off the coffee table, out of the microwave, a toy from the console)
const DRINKS = new Set(['beer', 'coffee', 'tiki', 'water', 'coke', 'book', 'cigarette', 'bong', 'remote', 'chips', 'vape',
  'pizza', 'burger', 'pasta', 'salad', 'hotdog', 'taco', 'ramen', 'popcorn', 'yoyo', 'slinky', 'spinner', 'cube', 'eightball']);
const DRINK_MS = 30 * 60_000;
const drinkMs = (kind: string) => (kind === 'coffee' ? 2 * 60 * 60_000 : DRINK_MS);
// What is in their hand. Kept on disk too, so a restart of the server does not take anybody's drink away.
const drinks = new Map<string, { kind: string; since: number; until: number }>((() => { try { return Object.entries(JSON.parse(getKV('drinks', '{}')) as Record<string, { kind: string; since: number; until: number }>).filter(([, d]) => d.until > Date.now()); } catch { return []; } })());
const saveDrinks = () => setKV('drinks', JSON.stringify(Object.fromEntries(drinks)));
/** The disco lights in the main room (the switch left of the wall clock): one for everybody, kept through a restart. */
let disco = getKV('disco', '0') === '1';
/** When it is finished, everyone is told: unless they have a fresh one by then. */
// One timer per person, the last one replacing the one before: a message per second for two hours used to leave
// thousands of them waiting, each a closure kept in memory until its drink would have run out.
const drinkTimers = new Map<string, NodeJS.Timeout>();
function finishDrink(userId: string, since: number, ms: number) {
  clearTimeout(drinkTimers.get(userId));
  drinkTimers.set(userId, setTimeout(() => { if (drinks.get(userId)?.since === since) { drinks.delete(userId); saveDrinks(); pushPresence(userId); } }, ms).unref());
}
for (const [id, d] of drinks) finishDrink(id, d.since, Math.max(0, d.until - Date.now()) + 200);      // (the ones kept through a restart)
function drinkOf(userId: string) {
  const d = drinks.get(userId);
  if (d && d.until < Date.now()) { drinks.delete(userId); return undefined; }
  return d;
}
function placeOf(userId: string) {
  const p = places.get(userId);
  if (!p) return undefined;
  const gone = ![...conns].some((c) => c.userId === userId);
  if (gone && !rejoining() && p.place === 'here') { leaveSpot(userId); return placeOf(userId); }
  if ((p.until && p.until < Date.now()) || (gone && !rejoining() && Date.now() - p.since > PLACE_HOLD)) { places.delete(userId); savePlaces(); return undefined; }
  return p;
}
/** Off the spot they clicked: back to what they had chosen before it, if it still stands, or to what their PC says.
 *  Only a choice made in the last UNDER_MS comes back: one kept underneath all day (a status picked in the morning, then
 *  a seat clicked, the stairs taken, a game played) had come back hours later, out of nowhere, when they left a spot. */
const UNDER_MS = 2 * 60 * 60_000;
function leaveSpot(userId: string) {
  const p = places.get(userId);
  if (p?.place !== 'here') return;
  const u = p.under;
  if (u && !(u.until && u.until < Date.now()) && Date.now() - u.since < UNDER_MS) { places.set(userId, u); console.log(`[place] ${stamp()} ${userById(userId)?.name ?? userId}: back to ${u.place} (chosen before the spot they left)`); }
  else places.delete(userId);
  savePlaces();
}
/** A spot clicked in the room, over whatever they had chosen (kept underneath, however many spots they click). */
function standAt(userId: string, at: { x: number; y: number; seat: string }) {
  const p = places.get(userId);
  const under = p?.place === 'here' ? p.under : p && p.place !== 'sleeping' ? p : undefined;
  places.set(userId, { place: 'here', since: Date.now(), until: 0, at, ...(under ? { under } : {}) });
  touched.set(userId, Date.now());
}
// Standing about: somebody on a spot they clicked who has done nothing in the room for SPOT_IDLE_MS (no click, no step,
// no shot, no act) goes back to what they are really doing, their chosen status or their PC's, and back upstairs if they
// are downstairs (gaming, they go and sit at their desk). The page's own reports (activity, previews, typing) do not count.
// A seat in the DnD room is the exception: a player listening to the DM can sit through a long scene without a click.
const [PX, PY, PW, PH] = YARD.things.pool as number[];
const inPool = (x: number, y: number) => x >= PX && x < PX + PW && y >= PY && y < PY + PH;
const SPOT_IDLE_MS = Number(process.env.CHATTERDAY_SPOT_IDLE_MS) || 3 * 60_000;      // (shorter only for trying it out)
const TOUCHES = new Set(['place', 'floor', 'fit', 'act', 'kick', 'toss', 'arcade', 'drink', 'game', 'board', 'watch']);      // ('watch': a game open large in front of them, watched: client/src/basement/sound.ts)
const touched = new Map<string, number>();
setInterval(() => {
  const now = Date.now();
  for (const [id, p] of places) {
    if (p.place !== 'here' || now - Math.max(p.since, touched.get(id) ?? 0) < SPOT_IDLE_MS) continue;
    if (p.at?.seat && (floorOf(id) === 'dnd' || floorOf(id) === 'outside' || floorOf(id) === 'backyard' || floorOf(id) === 'lake' || floorOf(id).startsWith('minigolf'))) continue;      // (nor does a seat round the campfire, in the backyard, on the dock or by the golf: people sit and talk, and wait for a bite)
    if (floorOf(id) === 'backyard' && p.at && inPool(p.at.x, p.at.y)) continue;      // (nor does swimming about in the pool)
    leaveSpot(id);
    if (floorOf(id)) setFloor(id, '');
    pushPresence(id);
  }
}, 15_000).unref();

/** What somebody is doing and where, for everybody's page: and which floor they are on, if not upstairs. */
function presenceOf(userId: string) {
  const p = presenceHere(userId), floor = floorOf(userId);
  return floor ? { ...p, floor } : p;
}
function presenceHere(userId: string) {
  const all = [...conns].filter((c) => c.userId === userId);
  const voice = all.find((c) => c.voice)?.voice ?? null;
  const u = userById(userId);
  const z = sleeping(userId);
  // Asleep for the night with the app closed: in bed all the same (not offline)
  if (z && !u?.invisible && !all.length) return { state: 'away', label: '', voice, place: 'sleeping', since: z.since, slot: -1 };
  if (u?.invisible && !voice) return { state: 'offline', label: '', voice: null, place: '', since: 0, slot: -1 };
  if (!all.length) {
    const held = placeOf(userId);      // gone, but what they said they were doing still stands for a while
    return held ? { state: 'away', label: '', voice: null, place: held.place, since: held.since, slot: -1 } : { state: 'offline', label: '', voice: null, place: '', since: 0, slot: -1 };
  }
  let best = all[0].activity;
  for (const c of all) if (RANK[c.activity.state] > RANK[best.state]) best = c.activity;
  const at = placeOf(userId), cup = drinkOf(userId), slot = slots.get(userId) ?? -1;
  if (z) return { state: best.state, label: best.label, voice, place: 'sleeping', since: z.since, slot };
  const play = playingNow(userId);
  return { state: best.state, label: best.label, voice, place: at?.place ?? '', since: at?.since ?? 0, slot, at: at?.at, drink: cup ? { kind: cup.kind, since: cup.since } : undefined,
    ...(play ? { playing: play } : {}) };
}
function broadcast(msg: unknown, except?: Conn) {
  const data = JSON.stringify(msg);
  for (const c of conns) if (c !== except && c.ws.readyState === 1) c.ws.send(data);
}
/** Sends something to everyone in one voice chat (but for one person, if given). */
function toVoice(channelId: number, msg: unknown, exceptUser?: string) {
  const data = JSON.stringify(msg);
  for (const c of conns) if (c.voice?.channelId === channelId && c.userId !== exceptUser && c.ws.readyState === 1) c.ws.send(data);
}
/** Sends something to one person, on every device they have open. */
function toUser(userId: string, msg: unknown) {
  const data = JSON.stringify(msg);
  for (const c of conns) if (c.userId === userId && c.ws.readyState === 1) c.ws.send(data);
}
/** The time on the clubhouse clock, for lines in the log. */
const stamp = () => new Date().toLocaleTimeString('en-US', { hour12: false, timeZone: houseZone() });
const pushPresence = (userId: string) => broadcast({ t: 'presence', userId, presence: presenceOf(userId) });
// A game somebody is in here (the card table upstairs, or one of the basement's), for their status: "Playing Bowling",
// "Waiting to play Hearts". The games do not say when it changes, so it is looked at again after every move anybody
// makes at a game and every few seconds (a game put away for being left, a seat given up for being gone), and pushed
// for whoever's has changed.
// Watching one (a game open in front of them, at the card table or down in the basement, the page saying so: 'watch')
// while it is under way and they are not in it reads "Spectating Chess". What they watch is forgotten when they close
// it, or after a while with no word (the page says so once a minute).
const watching = new Map<string, { id: string; part: string; at: number }>();
function playingNow(userId: string): { game: string; waiting: boolean; watching?: boolean } | null {
  try {
    const mine = gameTable.playing(userId) ?? fitPlaying(userId) ?? drawGuess.playing(userId);
    if (mine) return mine;
    const w = watching.get(userId);
    if (!w || Date.now() - w.at > 150_000) return null;
    const game = w.id === 'table' ? gameTable.going() : fitGoing(w.id, w.part);
    return game ? { game, waiting: false, watching: true } : null;
  } catch { return null; }
}
const playingWas = new Map<string, string>();
function pushPlaying() {
  for (const id of new Set([...conns].map((c) => c.userId))) {
    const now = JSON.stringify(playingNow(id));
    if ((playingWas.get(id) ?? 'null') === now) continue;
    playingWas.set(id, now);
    pushPresence(id);
  }
}
setInterval(pushPlaying, 5_000).unref();
/** Who is about just now, for the stairs' vote and the basement's games: online, not away, not asleep. */
const presentIds = () => [...new Set([...conns].map((c) => c.userId))].filter((id) => { const p = presenceOf(id); return p.state !== 'away' && p.state !== 'offline' && p.place !== 'sleeping'; });
const pushUser = (userId: string) => { const u = userById(userId); if (u) broadcast({ t: 'user', user: publicUser(u) }); };
const channels = () => all("SELECT id, name, kind, position FROM channels WHERE kind != 'dm' ORDER BY position, id");

// ── private chats: a channel of kind 'dm' whose name is its two people's ids, in order, joined by '|' ──
const dmName = (a: string, b: string) => [a, b].sort().join('|');
/** Who may see a channel: null means everybody. A private chat is seen by its two people and nobody else, the admin included. */
function membersOf(channelId: number): string[] | null {
  const ch = get<{ name: string; kind: string }>('SELECT name, kind FROM channels WHERE id = ?', channelId);
  if (!ch) return [];
  return ch.kind === 'dm' ? ch.name.split('|') : null;
}
const canSee = (userId: string, channelId: number) => { const m = membersOf(channelId); return m === null || m.includes(userId); };
/** Sends something about a channel to the people who may see it. */
function toChannel(channelId: number, msg: unknown, except?: Conn) {
  const m = membersOf(channelId);
  if (m === null) return broadcast(msg, except);
  const data = JSON.stringify(msg);
  for (const c of conns) if (c !== except && m.includes(c.userId) && c.ws.readyState === 1) c.ws.send(data);
}
const dmsOf = (userId: string) => all<{ id: number; name: string }>("SELECT id, name FROM channels WHERE kind = 'dm'")
  .filter((c) => c.name.split('|').includes(userId)).map((c) => ({ id: c.id, with: c.name.split('|').find((x) => x !== userId)! }));

// ── the game table: the games themselves are in games.ts, which is handed these ways to reach people ──
const gameTable = makeTable({
  send(userId, msg) { const data = JSON.stringify(msg); for (const c of conns) if (c.userId === userId && c.ws.readyState === 1) c.ws.send(data); },
  everyone: () => [...new Set([...conns].map((c) => c.userId))],
  online: (userId) => [...conns].some((c) => c.userId === userId),
  won: (kind, winners, seats) => achieve.tableWon(kind, winners, seats),      // (achievements)
});

// ── Draw & Guess on the whiteboard (server/drawguess.ts): played on the board alone, never in the text chat ──
const drawGuess = makeDrawGuess({
  send: (userId, msg) => toUser(userId, msg),
  online: () => [...new Set([...conns].map((c) => c.userId))],
  canDraw: (userId) => [...conns].some((c) => c.userId === userId),
  nameOf: (userId) => userById(userId)?.name ?? 'Somebody',
  tell: (userId, text) => toUser(userId, { t: 'toast', text }),
  board: (op) => broadcast({ t: 'board', op }),
  changed: () => pushPlaying(),
});

// ── the bathroom mirror (server/mirror.ts): steamed up by a shower, written on with a finger, in memory only ──
const mirror = makeMirror({
  showering: () => [...places.keys()].map((id) => placeOf(id)).filter((p) => p?.place === 'showering').map((p) => p!.since),
  everyone: (msg) => broadcast(msg),
});

// ── who was on when: one row for each stretch somebody was online, and each stretch in voice ──
run('UPDATE spans SET open = 0');                               // whatever was open when the server last stopped ended then
run('DELETE FROM spans WHERE end < ?', Date.now() - 14 * 86_400_000);
function spanStart(userId: string, kind: 'online' | 'voice') {
  if (get('SELECT 1 FROM spans WHERE user_id = ? AND kind = ? AND open = 1', userId, kind)) return;
  run('INSERT INTO spans (user_id, kind, start, end, open) VALUES (?, ?, ?, ?, 1)', userId, kind, Date.now(), Date.now());
}
const spanEnd = (userId: string, kind: 'online' | 'voice') => run('UPDATE spans SET end = ?, open = 0 WHERE user_id = ? AND kind = ? AND open = 1', Date.now(), userId, kind);
setInterval(() => run('UPDATE spans SET end = ? WHERE open = 1', Date.now()), 60_000).unref();      // so a crash loses a minute at most
// (achievements: a minute in voice for everybody in a voice chat, and who is in which, for the full squad)
setInterval(() => { const rooms = new Map<number, string[]>(); for (const c of conns) if (c.voice) rooms.set(c.voice.channelId, [...(rooms.get(c.voice.channelId) ?? []), c.userId]); achieve.voiceTick(rooms); }, 60_000).unref();
/** Where the campsite's telescope looks up from: the weather town, to a tenth of a degree, or nowhere in particular. */
function skyAt(): [number, number] | null { const t = town(); return t ? [Math.round(t.lat * 10) / 10, Math.round(t.lon * 10) / 10] : null; }
/** When today began on the house's clock. */
function houseMidnight() {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: houseZone(), hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23' }).formatToParts(new Date());
  const n = (t: string) => Number(p.find((x) => x.type === t)?.value ?? 0);
  return Date.now() - ((n('hour') % 24) * 3600 + n('minute') * 60 + n('second')) * 1000;
}
// (`entranceFor`: somebody's own entrance clip, from the "entrance sounds" folder. The app needs it to play it, and
// keeps it off the soundboard.)
const sounds = () => all<any>('SELECT id, name, emoji, file_id, user_id, entrance_for FROM sounds ORDER BY name COLLATE NOCASE')
  .map((s) => ({ id: s.id, name: s.name, emoji: s.emoji, url: `/files/${s.file_id}`, userId: s.user_id, ...(s.entrance_for ? { entranceFor: s.entrance_for } : {}) }));
/** Whether this person may have this sound as their entrance or exit sound: any soundboard clip, or their own entrance clip. */
const mayPick = (soundId: unknown, userId: string) => Number.isInteger(soundId) && !!get('SELECT 1 FROM sounds WHERE id = ? AND (entrance_for IS NULL OR entrance_for = ?)', soundId as number, userId);
/** The newest installer in desktop/dist, by version number (so 0.1.10 counts as newer than 0.1.9). */
function newestInstaller(): { file: string; name: string; version: string } | null {
  try {
    const dir = process.env.CHATTERDAY_INSTALLERS || path.join(ROOT, 'desktop', 'dist');      // (another folder: for a test server, which should not offer the real one)
    const parts = (f: string) => (/(\d+)\.(\d+)\.(\d+)/.exec(f) ?? []).slice(1).map(Number);
    const exe = fs.readdirSync(dir).filter((f) => /Setup.*\.exe$/i.test(f) && parts(f).length === 3)
      .sort((x, y) => { const m = parts(x), n = parts(y); return m[0] - n[0] || m[1] - n[1] || m[2] - n[2]; }).pop();
    return exe ? { file: path.join(dir, exe), name: exe, version: parts(exe).join('.') } : null;
  } catch { return null; }
}
/** Its version, so an older installed app can say there is a newer one. */
const appVersion = () => newestInstaller()?.version ?? '';
const town = (): Town | null => cleanTown(parsed(getKV('town')));
const unit = (): 'F' | 'C' => (getKV('unit') === 'C' ? 'C' : 'F');
/** Today's photos on the lounge wall (server/wallphotos.ts), and the one in the big gilt frame, if there are any. */
const wall = () => wallToday();
const photo = () => wall().poster ?? null;
// What every signed-in app is told about this server. (The Giphy key is here because each person's own app
// searches Giphy with it; no other key ever leaves the server.)
const settings = () => ({
  serverName: getKV('serverName', 'Chatterday'), publicUrl: getKV('publicUrl', ''), voice: voiceReady, gifKey: getKV('giphyKey', '') || process.env.GIPHY_KEY || '',
  appVersion: appVersion(), tz: houseZone(), town: town()?.name ?? '', sky: skyAt(), unit: unit(), photo: photo(), wall: wall(),
});

function messagesOut(rows: any[]) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const reacts = all<any>(`SELECT message_id, user_id, emoji FROM reactions WHERE message_id IN (${ids.map(() => '?').join(',')})`, ...ids);
  // each message's thread: how many replies, and when the last came in
  const threads = all<any>(`SELECT thread_id, COUNT(*) AS n, MAX(created_at) AS last FROM messages WHERE thread_id IN (${ids.map(() => '?').join(',')}) GROUP BY thread_id`, ...ids);
  return rows.map((r) => {
    const reactions: Record<string, string[]> = {};
    for (const x of reacts) if (x.message_id === r.id) (reactions[x.emoji] ??= []).push(x.user_id);
    const th = threads.find((x) => x.thread_id === r.id);
    return {
      id: r.id, channelId: r.channel_id, userId: r.user_id, content: r.content,
      attachments: JSON.parse(r.attachments), createdAt: r.created_at, editedAt: r.edited_at, reactions,
      ...(r.thread_id ? { threadId: r.thread_id } : {}), ...(th ? { replies: th.n, lastReply: th.last } : {}),
    };
  });
}
const messageOut = (id: number) => messagesOut(all('SELECT * FROM messages WHERE id = ?', id))[0];

/** Attachments are rebuilt from our own records; nothing a client sends is stored as-is. */
function cleanAttachments(input: unknown): any[] {
  const out: any[] = [];
  if (!Array.isArray(input)) return out;
  for (const a of input.slice(0, 10)) {
    if (a?.kind === 'file' && typeof a.id === 'string') {
      const f = get<any>('SELECT * FROM files WHERE id = ?', a.id);
      if (f) out.push({ kind: 'file', id: f.id, url: `/files/${f.id}`, mime: f.mime, name: f.name, size: f.size });
    } else if (a?.kind === 'image' && typeof a.url === 'string' && /^(https:\/\/|\/files\/[\w-]+$)/.test(a.url) && a.url.length < 600) {
      out.push({ kind: 'image', url: a.url, name: String(a.name ?? '').slice(0, 80) });
    } else if (a?.kind === 'theme' && a.theme && JSON.stringify(a.theme).length < 4000) {
      out.push({ kind: 'theme', theme: a.theme });
    }
  }
  return out;
}

// ───────────────────────── which build of the UI is out ─────────────────────────
// An app left open (or sitting in the tray) keeps running the page it loaded. So the server says which build it is
// handing out, when someone connects and again whenever `npm run build` has produced a new one, and a page that
// is running an older build reloads itself.
function buildId() {
  // the newest file anywhere in the built UI: code, pictures and sprite sheets alike
  let newest = 0;
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      // (not the .br/.gz copies scripts/precompress.mjs writes after the build: they are not a new build)
      if (e.isDirectory()) walk(full); else if (!/\.(br|gz)$/.test(e.name)) newest = Math.max(newest, fs.statSync(full).mtimeMs);
    }
  };
  try { walk(DIST); } catch { return ''; }
  return String(Math.round(newest));
}
let build = buildId();
setInterval(() => {
  const now = buildId();
  if (now && now !== build) { build = now; broadcast({ t: 'build', build }); }
}, 15_000).unref();

// ───────────────────────── the wall: the weather outside ──────────────────────────────────────────────
let weather: Weather | null = null;
async function pollWeather() {
  const where = town();
  if (!where) { if (weather) { weather = null; broadcast({ t: 'weather', weather }); } return; }
  const w = await fetchWeather(where, unit());
  if (!w) return;                                   // keep the last reading if the weather service did not answer
  const changed = !weather || w.kind !== weather.kind || w.cover !== weather.cover || w.temp !== weather.temp || w.unit !== weather.unit || w.text !== weather.text;
  weather = w;
  if (changed) broadcast({ t: 'weather', weather });
}
setInterval(pollWeather, 10 * 60_000).unref();
void pollWeather();


// ───────────────────────── music ─────────────────────────
// One queue for the voice chat. `startedAt` is when the current video began, so everyone plays the same moment.
// `autoplay` is always off: picking what YouTube would play next means reading its watch pages, which its terms do
// not allow (and the official API has no "related videos" any more). The field stays so older apps still read it.
const music = { current: null as Playing | null, queue: [] as Song[], autoplay: false };
playerNow.get = () => music.current;               // (for the karaoke lounge: who is singing)
let songIds = 0;
let songTimer: NodeJS.Timeout | undefined;
const songOut = (s: Song) => ({ id: s.id, videoId: s.videoId, title: s.title, by: s.by, seconds: s.seconds, auto: !!s.auto, singer: s.singer });
const musicOut = () => ({ current: music.current && { ...songOut(music.current), startedAt: music.current.startedAt, pausedAt: music.current.pausedAt ?? null, live: !!music.current.live }, queue: music.queue.map(songOut), autoplay: music.autoplay, now: Date.now() });
// The Player outlives a restart: what is on, paused or playing and how far in, and the queue, are kept in kv (with when
// they were kept). Back up, a video that was playing carries on from where it was when the server stopped; a paused one
// is still paused; a live stream is simply on again.
const saveMusic = () => setKV('music', JSON.stringify({ current: music.current, queue: music.queue, songIds, at: Date.now() }));
(() => {
  try {
    const m = JSON.parse(getKV('music', 'null')) as { current: Playing | null; queue: Song[]; songIds: number; at: number } | null;
    if (!m) return;
    songIds = Number(m.songIds) || 0;
    music.queue = Array.isArray(m.queue) ? m.queue.filter((s) => PLAYABLE.test(s?.videoId)) : [];
    const cur = m.current && PLAYABLE.test(m.current.videoId) ? m.current : null;
    if (cur && cur.pausedAt == null && !cur.live) {
      const into = Math.max(0, (m.at - cur.startedAt) / 1000);
      if (cur.seconds && into > cur.seconds) { music.current = null; return; }      // (it had finished)
      cur.startedAt = Date.now() + 3000 - into * 1000;                            // (a moment for everybody's app to come back)
    }
    music.current = cur;
  } catch { /* nothing kept */ }
})();
const pushMusic = () => { saveMusic(); broadcast({ t: 'music', music: musicOut() }); };
songClock();                                       // (what was put back still moves on when it ends)
/** A track somebody asks for by its id (from the history or a saved list): only what a YouTube id and a title can be. */
function cleanTrack(t: any): { videoId: string; title: string; seconds: number } | null {
  if (!t || typeof t.videoId !== 'string' || !PLAYABLE.test(t.videoId)) return null;
  const blank = 'YouTube video';
  return { videoId: t.videoId, title: String(t.title ?? blank).slice(0, 120) || blank, seconds: Math.max(0, Math.min(86_400, Math.round(Number(t.seconds) || 0))) };
}
const playlists = () => all<any>('SELECT id, name, user_id AS userId FROM playlists ORDER BY name COLLATE NOCASE').map((l) => ({
  ...l, items: all('SELECT id, video_id AS videoId, title, seconds FROM playlist_items WHERE playlist_id = ? ORDER BY id', l.id),
}));

/** If nobody's player reports the end, move on a little after the video's length. Set again after a jump or a pause. */
function songClock() {
  clearTimeout(songTimer);
  const cur = music.current;
  if (!cur?.seconds || cur.pausedAt != null) return;
  const left = cur.seconds - (Date.now() - cur.startedAt) / 1000;
  songTimer = setTimeout(() => playNext(), (Math.max(0, left) + 12) * 1000).unref();
}
/** Whether a song somebody picks waits its turn: behind whatever is on, unless that is only autoplay's choice (with
 *  the queue run out), which gives way at once to a song somebody chose. */
const queueBehind = () => !!music.current && (!music.current.auto || music.queue.length > 0);
/** On to the next one in the queue, or nothing. */
function playNext() {
  startSong(music.queue.shift() ?? null);
}
// A long video is picked up where it was left: how far in each one was (in seconds) when it last stopped short of its
// end, by its YouTube id. Kept for good, so it outlives a restart and an empty voice chat. Songs start from the top:
// only videos of ten minutes or more are remembered, and not their first minute or their last half minute.
const LONG_VIDEO = 600;
const leftOff: Record<string, { at: number; when: number }> = (() => { try { return JSON.parse(getKV('musicLeftOff', '{}')); } catch { return {}; } })();
/** Note how far the current video has got (or forget it, if it is over or has barely begun). True if anything changed. */
function noteLeftOff(): boolean {
  const cur = music.current;
  if (!cur || cur.live) return false;
  const at = Math.floor(cur.pausedAt ?? (Date.now() - cur.startedAt) / 1000);
  const long = cur.seconds ? cur.seconds >= LONG_VIDEO : at >= LONG_VIDEO || !!leftOff[cur.videoId];
  const keep = long && at >= 60 && !(cur.seconds && at > cur.seconds - 30);
  const had = leftOff[cur.videoId];
  if (!keep) {
    // (over, or wound back to the start: forgotten. A video still in its first minute keeps what it had, so a quick look does not lose the place.)
    if (!had || (at < 60 && long)) return false;
    delete leftOff[cur.videoId];
  } else {
    if (had?.at === at) return false;
    leftOff[cur.videoId] = { at, when: Date.now() };
    const ids = Object.keys(leftOff);
    if (ids.length > 200) for (const id of ids.sort((a, b) => leftOff[a].when - leftOff[b].when).slice(0, ids.length - 200)) delete leftOff[id];
  }
  setKV('musicLeftOff', JSON.stringify(leftOff));
  return true;
}
// (every quarter of a minute while something plays, so a server that is stopped without warning has lost no more than that)
setInterval(() => { if (music.current && music.current.pausedAt == null) { noteLeftOff(); saveMusic(); } }, 15_000).unref();
const clockText = (sec: number) => `${sec >= 3600 ? `${Math.floor(sec / 3600)}:${String(Math.floor(sec / 60) % 60).padStart(2, '0')}` : Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
function startSong(song: Song | null) {
  clearTimeout(songTimer);
  noteLeftOff();                                   // what was playing, before it goes
  // Where it was left, less a few seconds to find the thread again (unless it is the same video carrying straight on: a stand-in after "bad" has a new id).
  const from = song && leftOff[song.videoId] ? Math.max(0, leftOff[song.videoId].at - 5) : 0;
  const was = music.current;
  // (playing, with a length: a stand-in for a video that would not play arrives carrying the old one's pause and "live" mark)
  music.current = song && { ...song, startedAt: Date.now() + 1500 - from * 1000, pausedAt: null, live: false };
  for (const f of playerChanged) { try { f(was, music.current); } catch (e) { console.error('[music] after a change:', e); } }     // (the karaoke's announcer)
  if (song && from) broadcast({ t: 'toast', text: `"${song.title.slice(0, 50)}" picks up where it left off, at ${clockText(from)}. Drag the bar back to start it over.` });
  if (song) {
    tx(() => {
      run('INSERT INTO plays (video_id, title, seconds, user_id, played_at) VALUES (?, ?, ?, ?, ?)', song.videoId, song.title, song.seconds, song.by, Date.now());
      run('DELETE FROM plays WHERE id <= (SELECT MAX(id) FROM plays) - 500');
    });
  }
  songClock();
  pushMusic();
}
// YouTube's terms: data stored from it is deleted or refreshed within 30 days. The play history (what "Recently
// played" lists) is simply let go after 30 days; saved playlists are checked again with YouTube, and a video that is
// gone or private by then drops out of the list.
const STALE_MS = 30 * 24 * 3600_000;
async function refreshYouTubeData() {
  const now = Date.now();
  run('DELETE FROM plays WHERE played_at < ?', now - STALE_MS);
  const stale = all<{ id: number; video_id: string }>('SELECT id, video_id FROM playlist_items WHERE fetched_at < ? ORDER BY fetched_at LIMIT 50', now - STALE_MS + 3600_000);
  if (!stale.length) return;
  try {
    if (youtubeKey()) {
      const found = await videoDetails([...new Set(stale.map((s) => s.video_id))]);
      for (const s of stale) {
        const v = found.get(s.video_id);
        if (v) run('UPDATE playlist_items SET title = ?, seconds = ?, fetched_at = ? WHERE id = ?', v.title, v.seconds, now, s.id);
        else run('DELETE FROM playlist_items WHERE id = ?', s.id);
      }
    } else {
      for (const s of stale) {                                 // no key: the title again from YouTube's public oEmbed
        const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${s.video_id}`)}`, { signal: AbortSignal.timeout(8000) });
        if (r.ok) run('UPDATE playlist_items SET title = ?, fetched_at = ? WHERE id = ?', String(((await r.json()) as any).title ?? '').slice(0, 120) || 'YouTube video', now, s.id);
        else if (r.status === 404 || r.status === 401 || r.status === 403) run('DELETE FROM playlist_items WHERE id = ?', s.id);
      }
    }
  } catch (e) { console.error('[music] could not refresh saved songs (will try again later):', e); }
}
setTimeout(() => void refreshYouTubeData(), 60_000).unref();
setInterval(() => void refreshYouTubeData(), 6 * 3600_000).unref();

/** Nobody left in the main voice chat: the music stops and the queue is emptied. */
function musicCheck() {
  // (not while the server is restarting, when every app leaves voice on purpose, nor while they are all coming back)
  if (restarting || rejoining()) return;
  const main = mainVoiceId();            // the player belongs to the main voice chat; the Game Table has none
  if ((music.current || music.queue.length) && ![...conns].some((c) => c.voice?.channelId === main)) { music.queue = []; startSong(null); }
}
// Once everybody has had time to come back after a restart: if nobody is in the voice chat after all, the music stops.
setTimeout(musicCheck, REJOIN_MS + 1000).unref();
const mainVoiceId = () => get<{ id: number }>("SELECT id FROM channels WHERE kind = 'voice' ORDER BY position, id LIMIT 1")?.id;
const tell = (c: Conn, text: string) => { if (c.ws.readyState === 1) c.ws.send(JSON.stringify({ t: 'toast', text })); };

// ───────────────────────── HTTP ─────────────────────────

// Wrong passwords in the last five minutes: for one name from one address, and for the address whatever the name
// (so guessing cannot be spread over made-up names, and this list cannot be grown without end).
const loginTries = new Map<string, number[]>();
const TRY_MS = 5 * 60_000;
const recentTries = (key: string, now: number) => (loginTries.get(key) ?? []).filter((t) => now - t < TRY_MS);
setInterval(() => { const now = Date.now(); for (const [k, t] of loginTries) if (now - t[t.length - 1] >= TRY_MS) loginTries.delete(k); }, TRY_MS).unref();

/** Signs this device in as somebody: a new session, kept in a cookie only the server can read. */
function startSession(req: IncomingMessage, res: ServerResponse, userId: string, device: unknown) {
  const token = rid(32), now = Date.now();
  run('INSERT INTO sessions (hash, user_id, device, created_at, last_seen) VALUES (?, ?, ?, ?, ?)', sha(token), userId, String(device ?? '').slice(0, 60), now, now);
  const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `cd_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000${secure}`);
}

async function api(req: IncomingMessage, res: ServerResponse, url: URL) {
  const p = url.pathname.slice(4);
  const m = req.method ?? 'GET';
  if (m !== 'GET' && !sameOrigin(req)) return json(res, 403, { error: 'Request came from another site.' });

  const inviteRow = (code: string) =>
    get<any>('SELECT * FROM invites WHERE hash = ? AND used_at IS NULL AND expires_at > ?', sha(code), Date.now());

  /** Signs this browser in as somebody: a random token in a cookie the page cannot read; only its hash is kept. */
  const signIn = (userId: string, device: unknown) => startSession(req, res, userId, device);

  // What the sign-in page needs before anyone is signed in: is this server brand new, and may this visitor set it up?
  if (m === 'GET' && p === '/hello') {
    return json(res, 200, { serverName: getKV('serverName', 'Chatterday'), needsSetup: userCount() === 0, local: isHostPC(req), port: PORT });
  }

  // The very first account, which is the admin. Only while nobody has an account, and only from the host PC
  // itself, so that nobody else on the network can claim a server that has just been started.
  if (m === 'POST' && p === '/setup') {
    if (userCount() > 0) return json(res, 400, { error: 'This server has already been set up.' });
    if (!isHostPC(req)) return json(res, 403, { error: 'Set the server up from the PC it runs on.' });
    const body = await readJson(req);
    if (userCount() > 0) return json(res, 400, { error: 'This server has already been set up.' }); // again: another setup may have finished while this body arrived
    const name = cleanName(body.name), password = String(body.password ?? '');
    const why = whyNot(name, password);
    if (why) return json(res, 400, { error: why });
    const serverName = String(body.serverName ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
    if (serverName) setKV('serverName', serverName);
    signIn(createUser(name, password, 'admin'), body.device);
    console.log(`[setup] ${name} set this server up and is its admin`);
    return json(res, 200, { ok: true });
  }

  if (m === 'GET' && p === '/invite-info') {
    const inv = inviteRow(url.searchParams.get('code') ?? '');
    return json(res, 200, { valid: !!inv, serverName: getKV('serverName', 'Chatterday') });
  }

  // Using an invite: the newcomer picks their own name and password. The invite is then spent.
  if (m === 'POST' && p === '/redeem') {
    const body = await readJson(req);
    const who = `${req.socket.remoteAddress}|invite`;
    const now = Date.now();
    const tries = recentTries(who, now);
    const inv = inviteRow(String(body.code ?? '').trim());
    // The limit only meets bad codes: a good one always works. Codes are far too long to guess, and behind a proxy
    // everyone shares one address, so one person's typos must not lock every newcomer out.
    if (!inv) {
      if (tries.length >= 12) return json(res, 429, { error: 'Too many tries. Wait a few minutes.' });
      loginTries.set(who, [...tries, now]);
      return json(res, 400, { error: 'That invite is used up or has expired. Ask for a new one.' });
    }
    const name = cleanName(body.name), password = String(body.password ?? '');
    const why = whyNot(name, password);
    if (why) return json(res, 400, { error: why });
    let userId = '';
    try {
      tx(() => {                                              // the new person, the spent invite and the sign-in: all or none
        // Spend it first, and only if it is still unused: should two redeems ever interleave, one finds it gone.
        if (!run('UPDATE invites SET used_at = ? WHERE hash = ? AND used_at IS NULL', now, inv.hash).changes) throw new BadRequest('spent');
        userId = createUser(name, password, inv.role === 'admin' ? 'admin' : 'member');
        run('UPDATE invites SET used_by = ? WHERE hash = ?', userId, inv.hash);
        signIn(userId, body.device);
      });
    } catch (e) {
      if (e instanceof BadRequest && e.message === 'spent') return json(res, 400, { error: 'That invite is used up or has expired. Ask for a new one.' });
      throw e;
    }
    pushUser(userId);
    console.log(`[invite] ${name} joined with an invite`);
    return json(res, 200, { ok: true });
  }

  if (m === 'POST' && p === '/login') {
    const body = await readJson(req);
    const name = String(body.name ?? '').trim().slice(0, 24);
    const from = String(req.socket.remoteAddress), who = `${from}|${name.toLowerCase()}`;
    const now = Date.now();
    const tries = recentTries(who, now), fromHere = recentTries(from, now);
    if (tries.length >= 8 || fromHere.length >= 40) return json(res, 429, { error: 'Too many tries. Wait a few minutes.' });
    const user = get<UserRow & { pass: string | null }>("SELECT * FROM users WHERE name = ? COLLATE NOCASE AND role != 'removed'", name);
    if (!user || !checkPassword(String(body.password ?? ''), user.pass)) {
      loginTries.set(who, [...tries, now]);
      loginTries.set(from, [...fromHere, now]);
      return json(res, 401, { error: 'That name and password do not match.' });
    }
    loginTries.delete(who);
    startSession(req, res, user.id, body.device);
    return json(res, 200, { ok: true });
  }

  const me = auth(req);
  if (!me) return json(res, 401, { error: 'Not signed in.' });
  const admin = me.role === 'admin';

  if (m === 'GET' && p === '/me') return json(res, 200, { me: selfUser(me) });

  // Changing my own password: the old one first. Every other device of mine is signed out.
  if (m === 'POST' && p === '/password') {
    const body = await readJson(req);
    const row = get<{ pass: string | null }>('SELECT pass FROM users WHERE id = ?', me.id);
    if (!checkPassword(String(body.old ?? ''), row?.pass)) return json(res, 400, { error: 'That is not your current password.' });
    const next = String(body.new ?? '');
    if (next.length < 8 || next.length > 200) return json(res, 400, { error: 'Pick a password of at least 8 characters.' });
    const current = sha(cookie(req, 'cd_session'));
    tx(() => {
      setPassword(me.id, next);
      run('DELETE FROM sessions WHERE user_id = ? AND hash != ?', me.id, current);
    });
    signOut((c) => c.userId === me.id && c.session !== current, 'new password');
    return json(res, 200, { ok: true });
  }

  if (m === 'POST' && p === '/logout') {
    const session = sha(cookie(req, 'cd_session'));
    run('DELETE FROM sessions WHERE hash = ?', session);
    signOut((c) => c.session === session, 'signed out');
    res.setHeader('Set-Cookie', 'cd_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
    return json(res, 200, { ok: true });
  }

  if (m === 'GET' && p === '/timeline') {                     // today so far: when each person was on, and when in voice
    const from = houseMidnight();
    run('UPDATE spans SET end = ? WHERE open = 1', Date.now());
    return json(res, 200, { from, to: Date.now(), spans: all('SELECT user_id AS userId, kind, start, end FROM spans WHERE end > ? ORDER BY start', from) });
  }
  if (m === 'POST' && p === '/unread') {                      // how many messages are newer than the last one I read, in each chat I can see
    const since = (await readJson(req)).since ?? {};
    const counts: Record<number, number> = {};
    for (const [cid, last] of Object.entries(since).slice(0, 200)) {
      const id = Number(cid);
      if (!Number.isInteger(id) || !canSee(me.id, id)) continue;
      const n = get<{ n: number }>('SELECT COUNT(*) AS n FROM messages WHERE channel_id = ? AND id > ? AND user_id != ?', id, Number(last) || 0, me.id)!.n;
      if (n) counts[id] = n;
    }
    return json(res, 200, { counts });
  }
  if (m === 'POST' && p === '/dm') {                          // open (or start) my private chat with one person
    const other = userById(String((await readJson(req)).userId ?? ''));
    if (!other || other.id === me.id || other.role === 'removed') return json(res, 404, { error: 'No such person.' });
    const name = dmName(me.id, other.id);
    let ch = get<{ id: number }>("SELECT id FROM channels WHERE kind = 'dm' AND name = ?", name);
    if (!ch) {
      ch = { id: Number(run("INSERT INTO channels (name, kind, position) VALUES (?, 'dm', 99)", name).lastInsertRowid) };
      for (const c of conns) {
        if ((c.userId === me.id || c.userId === other.id) && c.ws.readyState === 1) c.ws.send(JSON.stringify({ t: 'dm', id: ch.id, with: c.userId === me.id ? other.id : me.id }));
      }
    }
    return json(res, 200, { id: ch.id });
  }
  if (m === 'GET' && p === '/messages') {
    const channel = Number(url.searchParams.get('channel'));
    if (!canSee(me.id, channel)) return json(res, 403, { error: 'That chat is private.' });
    const before = Number(url.searchParams.get('before')) || Number.MAX_SAFE_INTEGER;
    const around = Number(url.searchParams.get('around'));
    if (around) {                                             // the messages either side of one, oldest first
      const older = all('SELECT * FROM messages WHERE channel_id = ? AND thread_id IS NULL AND id <= ? ORDER BY id DESC LIMIT 30', channel, around).reverse();
      const newer = all('SELECT * FROM messages WHERE channel_id = ? AND thread_id IS NULL AND id > ? ORDER BY id LIMIT 30', channel, around);
      return json(res, 200, { messages: messagesOut([...older, ...newer]), more: older.length === 30, latest: newer.length < 30 });
    }
    const rows = all('SELECT * FROM messages WHERE channel_id = ? AND thread_id IS NULL AND id < ? ORDER BY id DESC LIMIT 50', channel, before).reverse();
    return json(res, 200, { messages: messagesOut(rows), more: rows.length === 50 });
  }
  if (m === 'GET' && p === '/thread') {                       // a message and every reply in its thread, oldest first
    const root = get<any>('SELECT * FROM messages WHERE id = ?', Number(url.searchParams.get('id')));
    if (!root || root.thread_id || !canSee(me.id, root.channel_id)) return json(res, 404, { error: 'That thread is gone.' });
    return json(res, 200, { root: messagesOut([root])[0], replies: messagesOut(all('SELECT * FROM messages WHERE thread_id = ? ORDER BY id LIMIT 500', root.id)) });
  }
  if (m === 'GET' && p === '/search') {                       // words anywhere in a message, newest first; optionally one person's
    const q = (url.searchParams.get('q') ?? '').trim().slice(0, 80);
    const who = url.searchParams.get('user') ?? '';
    const inChannel = Number(url.searchParams.get('channel'));            // search stays inside the chat it was typed in
    if (q.length < 2 || !inChannel || !canSee(me.id, inChannel)) return json(res, 200, { messages: [] });
    const like = `%${q.replace(/[\\%_]/g, (ch) => '\\' + ch)}%`;
    const rows = who
      ? all("SELECT * FROM messages WHERE channel_id = ? AND content LIKE ? ESCAPE '\\' AND user_id = ? ORDER BY id DESC LIMIT 60", inChannel, like, who)
      : all("SELECT * FROM messages WHERE channel_id = ? AND content LIKE ? ESCAPE '\\' ORDER BY id DESC LIMIT 60", inChannel, like);
    return json(res, 200, { messages: messagesOut(rows) });
  }

  // ── the player: what has been played, and saved lists ──
  if (m === 'GET' && p === '/music/history') {        // (Recent shows the last ten)
    return json(res, 200, { items: all('SELECT video_id AS videoId, title, seconds, MAX(played_at) AS at FROM plays GROUP BY video_id ORDER BY at DESC LIMIT 10') });
  }
  if (m === 'GET' && p === '/music/lists') return json(res, 200, { lists: playlists() });
  if (m === 'POST' && p === '/music/lists') {
    const b = await readJson(req);
    const name = String(b.name ?? '').trim().slice(0, 40);
    const items = (Array.isArray(b.items) ? b.items : []).map(cleanTrack).filter(Boolean).slice(0, 100);
    if (!name || get<{ n: number }>('SELECT COUNT(*) AS n FROM playlists')!.n >= 50) return json(res, 400, { error: 'Give the list a name (there can be 50 lists at most).' });
    tx(() => {                                                // one write to the disk for the list and all its tracks, not one each
      const id = Number(run('INSERT INTO playlists (name, user_id, created_at) VALUES (?, ?, ?)', name, me.id, Date.now()).lastInsertRowid);
      for (const t of items) run('INSERT INTO playlist_items (playlist_id, video_id, title, seconds, fetched_at) VALUES (?, ?, ?, ?, ?)', id, t!.videoId, t!.title, t!.seconds, Date.now());
    });
    return json(res, 200, { lists: playlists() });
  }
  const listPath = /^\/music\/lists\/(\d+)(?:\/items(?:\/(\d+))?)?$/.exec(p);
  if (listPath && get('SELECT 1 FROM playlists WHERE id = ?', Number(listPath[1]))) {
    const listId = Number(listPath[1]);
    if (m === 'POST' && p.endsWith('/items')) {
      const t = cleanTrack(await readJson(req));
      if (t && get<{ n: number }>('SELECT COUNT(*) AS n FROM playlist_items WHERE playlist_id = ?', listId)!.n < 100) {
        run('INSERT INTO playlist_items (playlist_id, video_id, title, seconds, fetched_at) VALUES (?, ?, ?, ?, ?)', listId, t.videoId, t.title, t.seconds, Date.now());
      }
    } else if (m === 'DELETE' && listPath[2]) run('DELETE FROM playlist_items WHERE id = ? AND playlist_id = ?', Number(listPath[2]), listId);
    else if (m === 'DELETE') tx(() => { run('DELETE FROM playlist_items WHERE playlist_id = ?', listId); run('DELETE FROM playlists WHERE id = ?', listId); });
    return json(res, 200, { lists: playlists() });
  }

  if (m === 'POST' && p === '/upload') {
    const kind = url.searchParams.get('kind') ?? 'attachment';
    if (!Object.hasOwn(LIMITS, kind)) return json(res, 400, { error: 'Unknown upload kind.' });      // only the kinds listed, not 'constructor' and the like
    // (photos for the wall are the admin's alone: anybody else's is refused before any of it is kept)
    if (kind === 'photo' && me.role !== 'admin') { req.resume(); await new Promise((done) => { req.on('end', done); req.on('close', done); }); return json(res, 403, { error: 'Only the admin can put photos on the wall.' }); }
    const limit = LIMITS[kind as keyof typeof LIMITS];
    const id = rid(15);
    const file = path.join(UPLOADS, id);
    const out = fs.createWriteStream(file);
    let size = 0;
    let head = Buffer.alloc(0);
    let failed = '', ours = false;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (head.length < 16) head = Buffer.concat([head, c]).subarray(0, 16);
      if (failed) return;                                     // the rest of something already refused is read and dropped
      if (size > limit) { failed = `Too big. The limit is ${Math.round(limit / 1048576)} MB.`; out.end(); return; }
      if (!out.write(c)) { req.pause(); out.once('drain', () => req.resume()); }
    });
    req.on('end', () => out.end());
    // Over when the file is closed: all of it written, refused part-way, cut off by the sender, or the disk said no.
    await new Promise<void>((done) => {
      out.on('close', () => done());
      out.on('error', (e) => { console.error('[upload]', e.message); failed ||= 'The server could not keep that file.'; ours = true; req.resume(); });
      req.on('close', () => { if (!req.complete) out.destroy(); });
    });
    if (!failed && !req.complete) { fs.rm(file, () => {}); return void res.destroy(); }      // cut off part-way: nobody is waiting for an answer
    const mime = sniff(head);
    if (!failed && kind === 'avatar' && !/^image\/(png|jpeg|webp|gif)$/.test(mime)) failed = 'That is not a picture (PNG, JPG, WebP or GIF).';
    if (!failed && kind === 'photo' && !WALL_TYPES.test(mime)) failed = 'That is not a photo (PNG, JPG or WebP).';
    if (!failed && kind === 'sound' && !/^(audio|video)\//.test(mime)) failed = 'That is not an audio file.';
    if (failed || size === 0) { fs.rm(file, () => {}); return json(res, ours ? 500 : 400, { error: failed || 'Empty upload.' }); }
    const name = (url.searchParams.get('name') ?? 'file').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 120) || 'file';
    run('INSERT INTO files (id, user_id, name, mime, size, kind, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', id, me.id, name, mime, size, kind, Date.now());
    return json(res, 200, { kind: 'file', id, url: `/files/${id}`, mime, name, size });
  }

  if (m === 'POST' && p === '/voice/token') {
    const { channelId } = await readJson(req);
    if (!voiceReady) return json(res, 503, { error: 'Voice is not running on the server.' });
    if (!get("SELECT 1 FROM channels WHERE id = ? AND kind = 'voice'", Number(channelId))) return json(res, 404, { error: 'No such voice channel.' });
    return json(res, 200, { token: await voiceToken(me, Number(channelId)) });
  }

  if (m === 'POST' && p === '/profile') {
    const b = await readJson(req);
    let name = me.name;
    if (typeof b.name === 'string' && cleanName(b.name) !== me.name) {
      name = cleanName(b.name);
      const why = whyNot(name, null, me.id);
      if (why) return json(res, 400, { error: why });
    }
    const color = /^#[0-9a-f]{6}$/i.test(b.color ?? '') ? String(b.color).toLowerCase() : me.color;
    const emoji = typeof b.emoji === 'string' && b.emoji.length <= 16 && b.emoji ? b.emoji : me.emoji;
    const status = typeof b.status === 'string' ? b.status.replace(/\s+/g, ' ').trim().slice(0, 40) : me.status;
    const talk = b.talk === null ? null : typeof b.talk === 'number' && b.talk >= 0.002 && b.talk <= 0.2 ? b.talk : me.talk;
    const entrance = b.entrance === null ? null : mayPick(b.entrance, me.id) ? b.entrance : me.entrance;
    const exit = b.exit === null ? null : mayPick(b.exit, me.id) ? b.exit : me.exit_sound;
    const invisible = typeof b.invisible === 'boolean' ? Number(b.invisible) : me.invisible;
    let avatar = me.avatar;
    if (b.avatar === null) avatar = null;
    else if (typeof b.avatar === 'string' && get("SELECT 1 FROM files WHERE id = ? AND mime LIKE 'image/%'", b.avatar)) avatar = b.avatar;
    let theme = me.theme;
    if (b.theme === null) theme = null;
    else if (b.theme && JSON.stringify(b.theme).length < 4000) theme = JSON.stringify(b.theme);
    // Going invisible is going offline as far as anyone can tell: the stretch in today's timeline ends here, and
    // this is when they were last seen. Coming back while connected starts a new stretch.
    if (invisible && !me.invisible) { spanEnd(me.id, 'online'); run('UPDATE users SET seen_at = ? WHERE id = ?', Date.now(), me.id); }
    if (!invisible && me.invisible && [...conns].some((c) => c.userId === me.id)) spanStart(me.id, 'online');
    // What they built: only what is on the lists in the shared folder survives.
    const look = b.look === undefined ? me.look : JSON.stringify(cleanLook(b.look));
    const desk = b.desk === undefined ? me.desk : JSON.stringify(cleanDesk(b.desk));
    const petLook = b.pet === undefined ? undefined : cleanPet(b.pet);
    const pet = petLook === undefined ? me.pet : petLook ? JSON.stringify(petLook) : null;
    const birthday = b.birthday === undefined ? me.birthday : /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(String(b.birthday ?? '')) ? String(b.birthday) : null;
    run('UPDATE users SET name = ?, color = ?, emoji = ?, status = ?, invisible = ?, avatar = ?, theme = ?, look = ?, pet = ?, desk = ?, birthday = ?, entrance = ?, exit_sound = ?, talk = ? WHERE id = ?',
      name, color, emoji, status, invisible, avatar, theme, look, pet, desk, birthday, entrance, exit, talk, me.id);
    pushUser(me.id);
    pushPresence(me.id);
    return json(res, 200, { me: selfUser(userById(me.id)!) });
  }

  if (m === 'GET' && p === '/stash') return json(res, 200, { items: all('SELECT id, url, name FROM stash ORDER BY id DESC') });
  if (m === 'POST' && p === '/stash') {
    const b = await readJson(req);
    if (typeof b.url !== 'string' || !/^(https:\/\/|\/files\/[\w-]+$)/.test(b.url) || b.url.length > 600) return json(res, 400, { error: 'Bad link.' });
    run('INSERT OR IGNORE INTO stash (url, name, user_id, created_at) VALUES (?, ?, ?, ?)', b.url, String(b.name ?? '').slice(0, 60), me.id, Date.now());
    return json(res, 200, { ok: true });
  }
  if (m === 'DELETE' && p.startsWith('/stash/')) { run('DELETE FROM stash WHERE id = ?', Number(p.slice(7))); return json(res, 200, { ok: true }); }

  if (m === 'POST' && p === '/sounds') {
    const b = await readJson(req);
    if (!get("SELECT 1 FROM files WHERE id = ? AND kind = 'sound'", String(b.fileId))) return json(res, 400, { error: 'Upload the sound first.' });
    run('INSERT INTO sounds (name, emoji, file_id, user_id, created_at) VALUES (?, ?, ?, ?, ?)',
      String(b.name ?? 'sound').trim().slice(0, 24) || 'sound', String(b.emoji ?? 'note').slice(0, 16) || 'note', String(b.fileId), me.id, Date.now());
    broadcast({ t: 'sounds', sounds: sounds() });
    return json(res, 200, { ok: true });
  }
  if (m === 'GET' && p === '/board') return json(res, 200, { w: BOARD_W, h: BOARD_H, data: boardData(), pict: drawGuess.stateFor(me.id) });
  if (m === 'DELETE' && p.startsWith('/sounds/')) {
    const s = get<any>('SELECT * FROM sounds WHERE id = ?', Number(p.slice(8)));
    if (s && (admin || s.user_id === me.id)) { run('DELETE FROM sounds WHERE id = ?', s.id); broadcast({ t: 'sounds', sounds: sounds() }); }
    return json(res, 200, { ok: true });
  }

  // ── admin only below ──
  if (!admin) return json(res, 403, { error: 'Only the admin can do that.' });

  // Invites: a link that lets one new person in. It is shown once, here; only its hash is kept.
  if (m === 'POST' && p === '/invites') {
    const b = await readJson(req);
    const hours = [24, 72, 168, 720].includes(Number(b.hours)) ? Number(b.hours) : 72;
    const code = createInvite({ createdBy: me.id, hours, label: String(b.label ?? '').replace(/\s+/g, ' ').trim(), role: b.role === 'admin' ? 'admin' : 'member' });
    return json(res, 200, { code, expiresAt: Date.now() + hours * 3600_000 });
  }
  if (m === 'GET' && p === '/admin/invites') {
    return json(res, 200, {
      invites: all<any>('SELECT substr(hash, 1, 16) AS id, label, role, created_at AS createdAt, expires_at AS expiresAt, used_at AS usedAt, used_by AS usedBy FROM invites WHERE expires_at > ? OR used_at IS NOT NULL ORDER BY created_at DESC LIMIT 60', Date.now()),
    });
  }
  if (m === 'DELETE' && p.startsWith('/admin/invites/')) {
    const id = p.slice(15);
    if (/^[0-9a-f]{16}$/.test(id)) run('DELETE FROM invites WHERE substr(hash, 1, 16) = ?', id);
    return json(res, 200, { ok: true });
  }

  if (m === 'POST' && p === '/admin/password') {            // a new password for somebody who has lost theirs, shown once for the admin to pass on
    const target = userById(String((await readJson(req)).userId ?? ''));
    const password = target && resetPassword(target.id);
    if (password) signOut((c) => c.userId === target.id, 'new password');
    if (!target || !password) return json(res, 404, { error: 'No such person.' });
    for (const c of conns) if (c.userId === target.id) c.ws.close(4001, 'signed out');
    return json(res, 200, { name: target.name, password });
  }
  if (m === 'POST' && p === '/admin/role') {
    const b = await readJson(req);
    const who = userById(String(b.userId ?? ''));
    if (!who || who.role === 'removed') return json(res, 404, { error: 'No such person.' });
    if (who.id === me.id) return json(res, 400, { error: 'Ask another admin to change your own role.' });
    run('UPDATE users SET role = ? WHERE id = ?', b.role === 'admin' ? 'admin' : 'member', who.id);
    pushUser(who.id);
    return json(res, 200, { ok: true });
  }
  if (m === 'POST' && p === '/admin/birthday') {              // 'MM-DD', or empty for none
    const b = await readJson(req);
    const day = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(String(b.birthday ?? '')) ? String(b.birthday) : null;
    const who = userById(String(b.userId ?? ''));
    if (!who) return json(res, 404, { error: 'No such person.' });
    run('UPDATE users SET birthday = ? WHERE id = ?', day, who.id);
    pushUser(who.id);
    return json(res, 200, { ok: true });
  }
  if (m === 'GET' && p === '/admin/people') {
    return json(res, 200, {
      people: all<any>("SELECT id, name, role, created_at AS createdAt, seen_at AS seenAt FROM users WHERE role != 'removed' ORDER BY name COLLATE NOCASE").map((u) => ({
        ...u, devices: all('SELECT device, created_at, last_seen FROM sessions WHERE user_id = ?', u.id),
      })),
    });
  }
  // Tidying up after somebody who has wandered off: the admin can wipe their status line (the words under their name),
  // and set where they are for them: back to nothing chosen ('', at their computer or offline, as their PC says), Away,
  // Sleeping (put to bed, which holds for the night as if they had chosen it), or any other place. They are told, if
  // they are about. Whatever they choose themselves afterwards wins as usual.
  if (m === 'POST' && p === '/admin/set-status') {
    const b = await readJson(req);
    const who = userById(String(b.userId ?? ''));
    if (!who || who.role === 'removed') return json(res, 404, { error: 'No such person.' });
    const place = b.place === undefined ? undefined : String(b.place);
    if (place !== undefined && place !== '' && (!PLACES.has(place) || place === 'here')) return json(res, 400, { error: 'No such place.' });
    const done: string[] = [];
    if (b.clearText === true && who.status) { run("UPDATE users SET status = '' WHERE id = ?", who.id); pushUser(who.id); done.push('cleared the status line'); }
    if (place !== undefined) {
      if (asleep[who.id]) { delete asleep[who.id]; saveAsleep(); clearTimeout(wakeTimers.get(who.id)); }
      if (place === '') places.delete(who.id);
      else {
        if (UPSTAIRS.has(place)) setFloor(who.id, '');
        const ms = PLACE_MS[place] ?? 0;
        places.set(who.id, { place, since: Date.now(), until: ms ? Date.now() + ms : 0 });
      }
      savePlaces();
      pushPresence(who.id);
      done.push(place ? `set them to ${place}` : 'cleared where they are');
    }
    if (!done.length) return json(res, 200, { ok: true });
    console.log(`[place] ${stamp()} ${me.name} ${done.join(' and ')} for ${who.name}`);
    toUser(who.id, { t: 'toast', text: `${me.name} tidied up your status.` });
    return json(res, 200, { ok: true });
  }
  // Takes somebody out of the voice chat (left there AFK, say): LiveKit drops them, their page leaves the call, and they
  // are told who did it. They can join again whenever they like.
  if (m === 'POST' && p === '/admin/kick-voice') {
    const who = userById(String((await readJson(req)).userId ?? ''));
    if (!who || who.role === 'removed') return json(res, 404, { error: 'No such person.' });
    if (who.id === me.id) return json(res, 400, { error: 'Use Leave to leave the call yourself.' });
    const chans = [...conns].filter((c) => c.userId === who.id && c.voice).map((c) => c.voice!.channelId);
    if (!chans.length) return json(res, 400, { error: `${who.name} is not in a voice chat.` });
    await kickFromVoice(who.id, [...new Set(chans)]);
    console.log(`[voice] ${stamp()} ${me.name} took ${who.name} out of voice`);
    toUser(who.id, { t: 'toast', text: `${me.name} took you out of the voice chat.` });
    return json(res, 200, { ok: true });
  }
  if (m === 'POST' && p === '/admin/remove') {
    const userId = String((await readJson(req)).userId);
    if (userId === me.id) return json(res, 400, { error: 'You cannot remove yourself.' });
    tx(() => {
      run("UPDATE users SET role = 'removed' WHERE id = ?", userId);
      run('DELETE FROM sessions WHERE user_id = ?', userId);
    });
    signOut((c) => c.userId === userId, 'removed');
    // and out of the voice chat: the pass LiveKit gave them would otherwise keep them in the call until they left
    void kickFromVoice(userId, all<{ id: number }>("SELECT id FROM channels WHERE kind = 'voice'").map((ch) => ch.id));
    pushUser(userId);
    return json(res, 200, { ok: true });
  }

  // The server's own settings. Keys are kept in the database on the host PC and never sent back out, except the
  // Giphy key, which every signed-in app needs to search with.
  if (m === 'GET' && p === '/admin/config') {
    return json(res, 200, {
      giphyKey: getKV('giphyKey', ''), giphyFromEnv: !!process.env.GIPHY_KEY, youtubeKey: !!(getKV('youtubeKey') || process.env.YOUTUBE_KEY), town: town(), tz: getKV('tz'), hostTz: hostZone(), envTz: envZone(),
      unit: unit(), photo: photo(), wall: wallPool().map((id) => ({ id, url: `/files/${id}` })), wallMax: MAX_WALL, installer: installerState(),
    });
  }
  if (m === 'POST' && p === '/admin/settings') {
    const b = await readJson(req);
    if (typeof b.serverName === 'string') setKV('serverName', b.serverName.replace(/\s+/g, ' ').trim().slice(0, 40) || 'Chatterday');
    if (typeof b.publicUrl === 'string' && /^(https?:\/\/[^\s/]+(:\d+)?)?$/.test(b.publicUrl.trim().replace(/\/+$/, ''))) setKV('publicUrl', b.publicUrl.trim().replace(/\/+$/, '').slice(0, 200));
    if (typeof b.giphyKey === 'string' && /^[A-Za-z0-9]{0,64}$/.test(b.giphyKey.trim())) setKV('giphyKey', b.giphyKey.trim());
    if (typeof b.youtubeKey === 'string' && /^[A-Za-z0-9_-]{0,80}$/.test(b.youtubeKey.trim())) setKV('youtubeKey', b.youtubeKey.trim());
    if (b.unit === 'F' || b.unit === 'C') setKV('unit', b.unit);
    if (b.tz === '' || validZone(b.tz)) setKV('tz', b.tz);
    if (b.town === null) setKV('town', '');
    else if (b.town !== undefined) {                          // picking a town also sets the house's clock to that town's
      const t = cleanTown(b.town);
      if (t) { setKV('town', JSON.stringify(t)); if (b.tz === undefined) setKV('tz', t.tz); }
    }
    // the wall's photos: one added (`photo` is v1's name for it) or taken down, or all of them taken down
    if (b.photo === null || b.wallClear === true) wallClear();
    const add = b.wallAdd ?? (typeof b.photo === 'string' ? b.photo : undefined);
    if (add !== undefined) { const why = wallAdd(add); if (why) return json(res, 400, { error: why }); }
    if (b.wallRemove !== undefined) wallRemove(b.wallRemove);
    broadcast({ t: 'settings', settings: settings() });
    if (b.town !== undefined || b.unit !== undefined) void pollWeather();
    return json(res, 200, { ok: true });
  }
  if (m === 'GET' && p === '/admin/towns') {                  // towns that match what the admin typed
    const q = (url.searchParams.get('q') ?? '').trim();
    if (q.length < 2) return json(res, 200, { towns: [] });
    try { return json(res, 200, { towns: await findTowns(q) }); } catch { return json(res, 502, { error: 'Could not look that up just now.' }); }
  }
  // The installer friends use: the address it opens is packed into it. (Tailscale is not: each friend installs it themselves.)
  if (m === 'POST' && p === '/admin/installer') {
    const b = await readJson(req);
    const dir = path.join(ROOT, 'desktop');
    if (typeof b.serverUrl === 'string' && /^https?:\/\/[^\s/]+(:\d+)?$/.test(b.serverUrl.trim())) fs.writeFileSync(path.join(dir, 'server.txt'), b.serverUrl.trim() + '\n');
    if (b.build) {
      const why = buildInstaller();
      if (why) return json(res, 400, { error: why });
    }
    return json(res, 200, { installer: installerState() });
  }
  if (m === 'POST' && p === '/channels') {
    const b = await readJson(req);
    const kind = b.kind === 'voice' ? 'voice' : 'text';
    const name = String(b.name ?? '').trim().slice(0, 32);
    if (!name) return json(res, 400, { error: 'Name it.' });
    run('INSERT INTO channels (name, kind, position) VALUES (?, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM channels))', name, kind);
    broadcast({ t: 'channels', channels: channels() });
    return json(res, 200, { ok: true });
  }
  if ((m === 'PATCH' || m === 'DELETE') && p.startsWith('/channels/')) {
    const id = Number(p.slice(10));
    // A private chat is not the admin's to rename or delete: its name is who is in it, so renaming one would let him in.
    if (!get("SELECT 1 FROM channels WHERE id = ? AND kind != 'dm'", id)) return json(res, 404, { error: 'No such channel.' });
    if (m === 'PATCH') {
      const b = await readJson(req);
      run('UPDATE channels SET name = ? WHERE id = ?', String(b.name ?? '').trim().slice(0, 32) || 'channel', id);
    } else {
      tx(() => {
        run('DELETE FROM channels WHERE id = ?', id);
        run('DELETE FROM reactions WHERE message_id IN (SELECT id FROM messages WHERE channel_id = ?)', id);
        run('DELETE FROM messages WHERE channel_id = ?', id);
      });
    }
    broadcast({ t: 'channels', channels: channels() });
    return json(res, 200, { ok: true });
  }
  return json(res, 404, { error: 'Not found.' });
}

/** Sends a file as the body of an answer. Unlike a bare pipe, this closes the file when the reader goes away
 *  part-way (a download cancelled, a video scrubbed along), and a file that cannot be read ends the answer
 *  instead of stopping the server. */
function sendFile(res: ServerResponse, file: string, part?: { start: number; end: number }) {
  pipeline(fs.createReadStream(file, part), res, () => { /* the reader left, or the file could not be read: nothing more to do */ });
}

function serveUpload(req: IncomingMessage, res: ServerResponse, id: string) {
  if (!auth(req)) { res.writeHead(401).end(); return; }
  const f = /^[\w-]+$/.test(id) ? get<any>('SELECT * FROM files WHERE id = ?', id) : null;
  const file = path.join(UPLOADS, id);
  if (!f || !fs.existsSync(file)) { res.writeHead(404).end(); return; }
  const headers: Record<string, string | number> = {
    'Content-Type': f.mime, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=31536000, immutable',
    'Content-Disposition': `${INLINE.test(f.mime) ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.name)}`,
    'Content-Security-Policy': "default-src 'none'; sandbox",
  };
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, f.size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), f.size - 1) : f.size - 1;
    if (start > end) { res.writeHead(416, { 'Content-Range': `bytes */${f.size}` }).end(); return; }
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${f.size}`, 'Content-Length': end - start + 1 });
    sendFile(res, file, { start, end });
  } else {
    res.writeHead(200, { ...headers, 'Content-Length': f.size });
    sendFile(res, file);
  }
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.map': 'application/json',
};

const statOf = (file: string) => { try { return fs.statSync(file); } catch { return null; } };

// ── squeezed answers ── The app's code is near 2 MB as built, and most of the people here come in over the internet,
// where that is the slow part of opening it. Squeezed it is about a fifth of that. `npm run build` leaves a .br and a
// .gz beside each such file (scripts/precompress.mjs); anything without one is squeezed here once and kept in memory.
const SQUEEZE = new Set(['.js', '.mjs', '.css', '.html', '.svg', '.json', '.webmanifest', '.wasm', '.txt', '.xml']);

/** Whether the asker reads this squeezing, by its Accept-Encoding ("br;q=0" is a no; "*" stands for any not named). */
function reads(req: IncomingMessage, enc: 'br' | 'gzip') {
  const said = String(req.headers['accept-encoding'] ?? '').toLowerCase().split(',').map((s) => s.trim().split(/\s*;\s*/));
  const q = (name: string) => {
    const e = said.find(([n]) => n === name);
    if (!e) return null;
    const m = /^q=([\d.]+)$/.exec(e[1] ?? '');
    return m ? Number(m[1]) : 1;
  };
  const own = q(enc);
  return own !== null ? own > 0 : (q('*') ?? 0) > 0;
}

/** Files squeezed here because the build left no copy (a bare `vite build`), by path. Only ever the UI's own few
 *  files, each replaced when it changes, so this stays small. */
const squeezedHere = new Map<string, { at: number; size: number; body: Buffer | null }>();

/** The squeezed copy of a built file this asker can read, if there is one; otherwise null and the plain file goes. */
function squeezedOf(req: IncomingMessage, file: string, st: fs.Stats): { enc: string; file?: string; body?: Buffer; size: number } | null {
  if (!SQUEEZE.has(path.extname(file)) || st.size < 1024) return null;
  for (const [enc, ext] of [['br', '.br'], ['gzip', '.gz']] as const) {
    if (!reads(req, enc)) continue;
    const c = statOf(file + ext);
    // (a copy older than its file is from the build before: the plain one is right, and stale code is not. The
    // millisecond is for the copy's date, which is set to its file's and can land a hair short)
    if (c?.isFile() && c.mtimeMs >= st.mtimeMs - 1) return { enc, file: file + ext, size: c.size };
  }
  if (!reads(req, 'gzip') || st.size > 8 << 20) return null;
  const kept = squeezedHere.get(file);
  if (kept && kept.at === st.mtimeMs && kept.size === st.size) return kept.body ? { enc: 'gzip', body: kept.body, size: kept.body.length } : null;
  // The first asker gets the plain file while the squeezing runs off to the side, so nobody waits on it.
  squeezedHere.set(file, { at: st.mtimeMs, size: st.size, body: null });
  fs.readFile(file, (err, raw) => {
    if (err) { squeezedHere.delete(file); return; }
    zlib.gzip(raw, { level: 9 }, (e, body) => {
      const now = squeezedHere.get(file);
      if (now?.at !== st.mtimeMs || now.size !== st.size) return;            // (changed again meanwhile)
      if (!e && body.length < raw.length) now.body = body;                    // (else it stays plain, and is not tried again)
    });
  });
  return null;
}

function serveStatic(req: IncomingMessage, res: ServerResponse, pathname: string, fallback = true) {
  let asked: string;
  try { asked = decodeURIComponent(pathname); } catch { res.writeHead(400).end(); return; }
  let file = path.join(DIST, asked);
  if (file !== DIST && !file.startsWith(DIST + path.sep)) { res.writeHead(403).end(); return; }      // (not a folder beside it whose name merely starts the same)
  let st = statOf(file);
  if ((!st || st.isDirectory()) && !fallback) { res.writeHead(404).end(); return; }
  if (!st || st.isDirectory()) { file = path.join(DIST, 'index.html'); st = statOf(file); }
  if (!st) { res.writeHead(503, { 'Content-Type': 'text/plain' }).end('The UI is not built yet. Run: npm run build'); return; }
  const ext = path.extname(file);
  // Pictures and the page itself are asked for again on every load ('no-cache'). With the file's date on the answer,
  // the app says which copy it holds and gets a short "not changed" back instead of the whole file once more.
  const dated = new Date(st.mtimeMs).toUTCString();
  const headers: Record<string, string> = { 'Content-Type': MIME[ext] ?? 'application/octet-stream', 'Last-Modified': dated };
  if (ext === '.html') {
    const host = req.headers.host ?? '';
    headers['Cache-Control'] = 'no-cache';
    headers['Content-Security-Policy'] = [
      "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'",
      "img-src 'self' https: data: blob:", "media-src 'self' https: blob:",
      `connect-src 'self' ws://${host} wss://${host} https://api.giphy.com`, 'frame-src https://www.youtube-nocookie.com',
      "worker-src 'self' blob:", "object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'", "form-action 'none'",
    ].join('; ');
  } else headers['Cache-Control'] = pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
  // (so a cache in between never hands a squeezed copy to a reader that cannot open it, nor the reverse)
  if (SQUEEZE.has(ext)) headers.Vary = 'Accept-Encoding';
  if (req.headers['if-modified-since'] === dated) { res.writeHead(304, headers).end(); return; }
  // (no piece of a file is ever asked for here, and none is given: an ask for one gets the whole plain file, as before)
  const squeezed = req.headers.range ? null : squeezedOf(req, file, st);
  if (!squeezed) { res.writeHead(200, headers); return sendFile(res, file); }
  // (a length only for the copy held in memory: one on disk can be rewritten by a build between looking and reading,
  // and a promised length that comes up short leaves the page hanging; unsized, the answer just ends where the file does)
  res.writeHead(200, { ...headers, 'Content-Encoding': squeezed.enc, ...(squeezed.body ? { 'Content-Length': String(squeezed.size) } : {}) });
  if (squeezed.body) res.end(squeezed.body); else sendFile(res, squeezed.file!);
}

let installerSha = { key: '', sha: '' };
function serveInstaller(res: ServerResponse) {
  const newest = newestInstaller();
  if (!newest) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('The desktop app has not been built on the server yet.'); return; }
  const { file, name: exe } = newest;
  const st = fs.statSync(file);
  // Its fingerprint goes along, so an app that fetches it to update itself can tell that it arrived whole.
  const key = `${exe}|${st.size}|${st.mtimeMs}`;
  if (installerSha.key !== key) {
    const hash = crypto.createHash('sha256'), buf = Buffer.alloc(1 << 20), fd = fs.openSync(file, 'r');
    for (let n = 0; (n = fs.readSync(fd, buf, 0, buf.length, null)) > 0;) hash.update(buf.subarray(0, n));
    fs.closeSync(fd);
    installerSha = { key, sha: hash.digest('hex') };
  }
  // The fingerprint only shows that the file arrived whole. That it was built by whoever runs this server is shown by their signature, which
  // scripts/sign-installer.mjs leaves beside the installer (the same name with .sig after it). It goes along too, and
  // an app with their public key inside runs nothing without it. Read each time: it is tiny, and it is written after
  // the installer, perhaps after the installer was first asked for.
  let sig = '';
  try { sig = fs.readFileSync(file + '.sig', 'utf8').trim(); } catch { /* not signed: apps from before signing do not ask */ }
  res.writeHead(200, {
    'Content-Type': 'application/octet-stream', 'Content-Length': st.size, 'Content-Disposition': `attachment; filename="${exe}"`, 'X-Sha256': installerSha.sha,
    ...(/^[A-Za-z0-9+/]{86}==$/.test(sig) ? { 'X-Signature': sig } : {}),
  });
  sendFile(res, file);
}

// ── building the friends' installer from the admin page ──
let building: { started: number; log: string; done: boolean; ok: boolean } | null = null;
const readLine = (file: string) => { try { return fs.readFileSync(file, 'utf8').trim(); } catch { return ''; } };
/** This PC's Tailscale address, if it has one: friends' PCs are only allowed to reach this. */
const tailscaleIp = () => bindAddresses().find((a) => a !== '127.0.0.1' && a !== '0.0.0.0' && Number(a.split('.')[0]) === 100) ?? '';
function installerState() {
  const dir = path.join(ROOT, 'desktop'), newest = newestInstaller();
  return {
    serverUrl: readLine(path.join(dir, 'server.txt')),
    built: newest ? { name: newest.name, version: newest.version, at: Math.round(fs.statSync(newest.file).mtimeMs) } : null,
    building: !!building && !building.done, failed: !!building?.done && !building.ok, log: building ? building.log.slice(-1500) : '',
    tailscaleIp: tailscaleIp(), port: PORT, mediaPorts: [LK.tcp, LK.udp],
  };
}
/** Starts the build (a few minutes: it fetches Electron the first time). Returns why not, or ''. */
function buildInstaller() {
  if (building && !building.done) return 'The installer is already being built.';
  if (process.platform !== 'win32') return 'The installer can only be built on Windows.';
  if (!readLine(path.join(ROOT, 'desktop', 'server.txt'))) return 'Save the address friends connect to first.';
  const job = { started: Date.now(), log: '', done: false, ok: false };
  building = job;
  const ps = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(ROOT, 'scripts', 'build-installer.ps1')], { cwd: ROOT, windowsHide: true });
  const note = (d: Buffer) => { job.log = (job.log + d.toString()).replace(/tskey-[\w-]+/g, 'tskey-…').slice(-20_000); };
  ps.stdout.on('data', note);
  ps.stderr.on('data', note);
  ps.on('error', (e) => { job.log += `\n${e.message}`; job.done = true; });
  ps.on('close', (code) => { job.done = true; job.ok = code === 0; broadcast({ t: 'settings', settings: settings() }); });
  return '';
}

/** LiveKit's own HTTP endpoints (connection pre-checks) live under /rtc. */
function proxyHttp(req: IncomingMessage, res: ServerResponse) {
  const up = http.request({ host: '127.0.0.1', port: LK.port, path: req.url, method: req.method, headers: req.headers }, (r) => {
    res.writeHead(r.statusCode ?? 502, r.headers);
    r.pipe(res);
  });
  up.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
  req.pipe(up);
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  // An address that cannot be read ("//" is one) is turned away here; left to throw, it would stop the whole server.
  let url: URL;
  try { url = new URL(req.url ?? '/', 'http://x'); } catch { res.writeHead(400).end(); return; }
  const p = url.pathname;
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  try {
    // For whoever looks after the host PC: how many people are on and in voice, asked from this PC only.
    // Look at it before restarting the server, so nobody is cut off mid-call.
    if (p === '/local/status' && isHostPC(req)) {
      const ids = (list: Conn[]) => new Set(list.map((c) => c.userId)).size;
      return json(res, 200, { online: ids([...conns]), inVoice: ids([...conns].filter((c) => c.voice)), build });
    }
    // Where everybody is, as the server has it, for looking into the room from this PC (somebody nobody can see, say):
    // what every app is told, plus each of their connections' kind, how long it has been open and what the page last said.
    if (p === '/local/presence' && isHostPC(req)) {
      const out: Record<string, unknown> = {};
      for (const u of all<UserRow>('SELECT * FROM users')) {
        const mine = [...conns].filter((c) => c.userId === u.id);
        if (!mine.length && presenceOf(u.id).state === 'offline') continue;
        out[u.name] = { presence: presenceOf(u.id), floor: floorOf(u.id), place: places.get(u.id) ?? null,
          conns: mine.map((c) => ({ kind: c.kind, activity: c.activity, voice: c.voice ? { channelId: c.voice.channelId } : null })) };
      }
      return json(res, 200, out);
    }
    // Restarting for an update, without cutting anybody off for good (scripts/restart.ps1, and the tray's Restart). Only
    // from this PC, and only with a header of our own: a web page open here could post to this address, but cannot
    // add that header without asking first, and nothing here says yes.
    if (p === '/local/restart' && isHostPC(req)) {
      if (req.method !== 'POST' || req.headers['x-chatterday-local'] !== 'restart') return void res.writeHead(403).end();
      const ids = (list: Conn[]) => new Set(list.map((c) => c.userId)).size;
      json(res, 200, { ok: true, inVoice: ids([...conns].filter((c) => c.voice)) });
      return restartForUpdate();
    }
    if (p.startsWith('/rtc')) return auth(req) ? proxyHttp(req, res) : void res.writeHead(401).end();
    if (p.startsWith('/api/')) return await api(req, res, url);
    if (p.startsWith('/files/')) return serveUpload(req, res, p.slice(7));
    if (p === '/download/desktop') return serveInstaller(res);
    return serveStatic(req, res, p);
  } catch (e) {
    if (e instanceof BadRequest) return res.headersSent ? void res.end() : json(res, 400, { error: e.message });
    if ((e as NodeJS.ErrnoException)?.code === 'ECONNRESET') return void res.destroy();      // (the client went away mid-request: nothing to answer, nothing to log)
    console.error('[http]', p, e);
    if (!res.headersSent) json(res, 500, { error: 'Server error.' }); else res.end();
  }
}

// ───────────────────────── WebSocket ─────────────────────────

const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });

function onSocket(ws: WebSocket, user: UserRow, kind: string, session: string) {
  const meter = meters.get(user.id) ?? { hits: 0, bytes: 0 };
  meters.set(user.id, meter);
  const c: Conn = {
    ws, userId: user.id, kind, session, alive: true, activity: { state: 'desk', label: '' }, voice: null,
    get hits() { return meter.hits; }, set hits(n: number) { meter.hits = n; },      // (shared by all this person's windows: see `meters`)
  };
  conns.add(c);
  // (somebody invisible comes and goes without "last seen" moving, or it would give them away)
  if (!user.invisible || user.seen_at == null) run('UPDATE users SET seen_at = ? WHERE id = ?', Date.now(), user.id);
  takeSlot(user.id);
  if (!user.invisible) spanStart(user.id, 'online');
  const presence: Record<string, unknown> = {};
  const users = all<UserRow>('SELECT * FROM users');
  for (const u of users) presence[u.id] = presenceOf(u.id);
  const lastIds: Record<number, number> = {};
  for (const r of all<any>('SELECT channel_id, MAX(id) AS id FROM messages GROUP BY channel_id')) if (canSee(user.id, r.channel_id)) lastIds[r.channel_id] = r.id;
  ws.send(JSON.stringify({
    t: 'ready', me: selfUser(user), users: users.map(publicUser), channels: channels(), presence,
    sounds: sounds(), settings: settings(), previews: Object.fromEntries(previews), lastIds, music: musicOut(), weather, build, dms: dmsOf(user.id),
    ball: ballNow(), arcade: arcadeScores(), toss: tossMade, fits: fitHello(), disco,
  }));
  pushPresence(user.id);

  ws.on('pong', () => { c.alive = true; });
  // A frame the 'ws' library refuses (bigger than maxPayload, or malformed) arrives here as an 'error', and the
  // socket is closed. With nobody listening for it, it would stop the whole server.
  ws.on('error', (e) => console.error('[ws]', userById(c.userId)?.name ?? c.userId, e.message));
  ws.on('close', () => {
    conns.delete(c);
    if (c.voice) exitSound(c.userId, c.voice.channelId);
    if (c.voice && ![...conns].some((o) => o.userId === c.userId && o.voice)) spanEnd(c.userId, 'voice');
    if (![...conns].some((o) => o.userId === c.userId)) {       // their last window closed: this is when they were last seen
      leaveSpot(c.userId);      // (off the spot: what they chose stays, see PLACE_HOLD)
      slots.delete(c.userId);
      spanEnd(c.userId, 'online');
      if (!userById(c.userId)?.invisible) {
        run('UPDATE users SET seen_at = ? WHERE id = ?', Date.now(), c.userId);
        pushUser(c.userId);
      }
    }
    if (c.voice?.sharing && previews.delete(c.userId)) broadcast({ t: 'preview', userId: c.userId, data: null });
    pushPresence(c.userId);
    musicCheck();
    if (![...conns].some((o) => o.userId === c.userId)) gameTable.gone(c.userId);      // in a game, their seat is kept for them
  });
  ws.on('message', (raw) => {
    // 120 per person per 10 s, reset by the ticker below (counted first: a flood is not even read). No page sends
    // anything like that, so a connection ten times over it is a runaway or an attack, and is dropped rather than
    // listened to any longer (even a frame that is not read has to be taken off the wire first).
    meter.bytes += (raw as Buffer).length;
    if (meter.bytes > MAX_BYTES) { ws.terminate(); return; }     // (and the same for sheer size: the biggest thing a page sends is a 120 KB picture once a minute)
    if (++c.hits > 120) {
      // Over the allowance: ignored, and said in the log every ten seconds (below), with what it was. Unsaid, it was
      // invisible: somebody's clicks in the room went nowhere and their connection kept being cut off, with nothing to show why.
      const kind = /"t"\s*:\s*"([\w-]{1,24})"/.exec((raw as Buffer).subarray(0, 200).toString())?.[1] ?? '?';
      (meter.kinds ??= new Map()).set(kind, (meter.kinds.get(kind) ?? 0) + 1);
      if (c.hits > 1200) { meter.cut = true; ws.terminate(); }
      return;
    }
    let d: any;
    try { d = parseJson(raw.toString()); } catch { return; }
    if (!d || typeof d !== 'object') return;
    try { onMessage(c, d); } catch (e) { console.error('[ws]', d?.t, e); }
  });
}

function onMessage(c: Conn, d: any) {
  const uid = c.userId;
  if (TOUCHES.has(d.t) && !d.auto) touched.set(uid, Date.now());      // (doing something in the room: see SPOT_IDLE_MS)
  switch (d.t) {
    case 'send': {
      const content = String(d.content ?? '').slice(0, 4000);
      const attachments = cleanAttachments(d.attachments);
      const channelId = Number(d.channelId);
      if ((!content.trim() && !attachments.length) || !get("SELECT 1 FROM channels WHERE id = ? AND kind IN ('text', 'dm')", channelId) || !canSee(uid, channelId)) return;
      // a reply in a thread: it hangs off a message in the same chat (and a reply cannot have a thread of its own)
      const threadId = d.threadId == null ? null : Number(d.threadId);
      if (threadId != null && !get('SELECT 1 FROM messages WHERE id = ? AND channel_id = ? AND thread_id IS NULL', threadId, channelId)) return;
      const r = run('INSERT INTO messages (channel_id, user_id, content, attachments, created_at, thread_id) VALUES (?, ?, ?, ?, ?, ?)',
        channelId, uid, content, JSON.stringify(attachments), Date.now(), threadId);
      // (the sender's own tag for the message comes back with it; nothing bigger than a tag is passed on to everyone)
      const nonce = typeof d.nonce === 'number' || (typeof d.nonce === 'string' && d.nonce.length <= 64) ? d.nonce : undefined;
      toChannel(channelId, { t: 'msg', message: messageOut(Number(r.lastInsertRowid)), nonce });
      achieve.count(uid, 'chat');
      if (threadId != null) toChannel(channelId, { t: 'msg_edit', message: messageOut(threadId) });      // (its count of replies)
      const link = linkIn(content.replace(/\|\|[^\n]+?\|\|/g, ' '));        // a link inside a spoiler gets no card
      if (link) {                                             // a card for the first link, added once the page has been read
        const mid = Number(r.lastInsertRowid);
        void previewFor(link).then((card) => {
          const row = card && get<any>('SELECT attachments FROM messages WHERE id = ?', mid);
          if (!row) return;
          run('UPDATE messages SET attachments = ? WHERE id = ?', JSON.stringify([...JSON.parse(row.attachments), card]), mid);
          toChannel(channelId, { t: 'msg_edit', message: messageOut(mid) });
        }).catch((e) => console.error('[links]', e));
      }
      break;
    }
    case 'edit': {
      const content = String(d.content ?? '').slice(0, 4000);
      if (!content.trim()) return;
      // (an edit that changes nothing is not an edit: the message is not marked as edited, and nobody is told)
      const r = run('UPDATE messages SET content = ?, edited_at = ? WHERE id = ? AND user_id = ? AND content <> ?', content, Date.now(), Number(d.id), uid, content);
      if (r.changes) { const edited = messageOut(Number(d.id)); toChannel(edited.channelId, { t: 'msg_edit', message: edited }); }
      break;
    }
    case 'delete': {
      const row = get<any>('SELECT * FROM messages WHERE id = ?', Number(d.id));
      if (!row || !canSee(uid, row.channel_id) || (row.user_id !== uid && userById(uid)?.role !== 'admin')) return;
      const replies = row.thread_id ? [] : all<{ id: number }>('SELECT id FROM messages WHERE thread_id = ?', row.id).map((x) => x.id);
      tx(() => {
        for (const id of [row.id, ...replies]) { run('DELETE FROM messages WHERE id = ?', id); run('DELETE FROM reactions WHERE message_id = ?', id); }
      });
      toChannel(row.channel_id, { t: 'msg_delete', id: row.id, channelId: row.channel_id });
      if (row.thread_id && get('SELECT 1 FROM messages WHERE id = ?', row.thread_id)) toChannel(row.channel_id, { t: 'msg_edit', message: messageOut(row.thread_id) });
      break;
    }
    case 'react': {
      const emoji = String(d.emoji ?? '').slice(0, 16);
      const id = Number(d.id);
      const where = get<{ channel_id: number }>('SELECT channel_id FROM messages WHERE id = ?', id);
      if (!emoji || !where || !canSee(uid, where.channel_id)) return;
      const had = run('DELETE FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?', id, uid, emoji).changes;
      if (!had) {
        // Twenty different reactions on one message is plenty. With no limit, one person could pile on thousands (any
        // 16 letters count as one), and all of them are sent to everybody again each time one changes.
        const kinds = all<{ emoji: string }>('SELECT DISTINCT emoji FROM reactions WHERE message_id = ?', id).map((r) => r.emoji);
        if (kinds.length >= 20 && !kinds.includes(emoji)) return;
        run('INSERT INTO reactions (message_id, user_id, emoji) VALUES (?, ?, ?)', id, uid, emoji);
      }
      toChannel(where.channel_id, { t: 'msg_edit', message: messageOut(id) });
      break;
    }
    case 'typing':
      if (canSee(uid, Number(d.channelId))) toChannel(Number(d.channelId), { t: 'typing', channelId: Number(d.channelId), userId: uid }, c);
      break;
    case 'activity': {
      const state = typeof d.state === 'string' && Object.hasOwn(RANK, d.state) ? d.state : 'desk';
      const label = String(d.label ?? '').slice(0, 60);
      if (state === c.activity.state && label === c.activity.label) return;
      c.activity = { state, label };
      achieve.activity(uid, state);
      pushPresence(uid);
      break;
    }
    case 'place': {
      const x = Number(d.x), y = Number(d.y);
      if (d.place === 'here' && !(x >= 0 && x <= 4000 && y >= 0 && y <= 4000)) return;
      const seat = typeof d.seat === 'string' && /^(living|seat|table|pc|bag|arcade|b)\d{1,2}$/.test(d.seat) ? d.seat : '';      // (pc: the chair at a desk; bag: a bean bag; arcade: standing at the arcade machine)
      // Asleep for the night: the page taking "Sleeping" back by itself (the PC touched again) is not them getting up.
      // Anything they choose by hand is.
      if (sleeping(uid)) {
        if (d.auto || d.place === 'sleeping') return;
        delete asleep[uid]; saveAsleep(); clearTimeout(wakeTimers.get(uid));
      }
      if (UPSTAIRS.has(d.place)) setFloor(uid, '');      // (in the basement: they go back up for it)
      if (PLACES.has(d.place)) {
        const ms = PLACE_MS[d.place] ?? 0;
        if (d.place === 'here') standAt(uid, { x: Math.round(x), y: Math.round(y), seat });
        else { places.set(uid, { place: d.place, since: Date.now(), until: ms ? Date.now() + ms : 0 }); console.log(`[place] ${stamp()} ${userById(uid)?.name ?? uid}: ${d.place}${d.auto ? ' (by itself)' : ''}`); }
        // (if they have gone somewhere else by then, that place stands and nothing is sent)
        // (one timer per person: a new place replaces the last one's, so they cannot pile up)
        clearTimeout(placeTimers.get(uid));
        if (ms) placeTimers.set(uid, setTimeout(() => { placeTimers.delete(uid); if (!placeOf(uid)) pushPresence(uid); }, ms + 500).unref());
        if (!d.auto) achieve.place(uid, d.place);
      } else places.delete(uid);
      savePlaces();
      pushPresence(uid);
      break;
    }
    case 'drink': {                                 // something from the fridge (anything else: put it down)
      if (DRINKS.has(d.kind)) {
        const since = Date.now();
        const ms = drinkMs(d.kind);
        drinks.set(uid, { kind: d.kind, since, until: since + ms });
        finishDrink(uid, since, ms + 200);
      } else drinks.delete(uid);
      saveDrinks();
      pushPresence(uid);
      break;
    }
    case 'voice': {
      const was = c.voice;
      const channelId = Number(d.channelId);
      c.voice = d.channelId != null && get("SELECT 1 FROM channels WHERE id = ? AND kind = 'voice'", channelId)
        ? { channelId, muted: !!d.muted, deafened: !!d.deafened, sharing: !!d.sharing, big: !!d.big, watching: Array.isArray(d.watching) ? d.watching.filter((x: unknown) => typeof x === 'string' && x.length <= 40 && x !== uid).slice(0, 8) : [],
          label: d.sharing && typeof d.label === 'string' ? cleanName(d.label.slice(0, 200)).slice(0, 60) : '' }
        : null;
      if (was?.sharing && !c.voice?.sharing && previews.delete(uid)) broadcast({ t: 'preview', userId: uid, data: null });
      // In the log: who joined, left, and shared (and whether with the PC's sound), so "people heard themselves" can be traced afterwards.
      const say = (what: string) => console.log(`[voice] ${stamp()} ${userById(uid)?.name ?? uid} ${what}`);
      // `again`: a page saying where it is once more, after its connection to here dropped and came back while it
      // stayed in the call. That is not an arrival: no entrance sound, and the log says so.
      const again = d.again === true;
      if (!was && c.voice) say(again ? `is still in voice chat ${c.voice.channelId} (reconnected)` : `joined voice chat ${c.voice.channelId}`);
      if (was && !c.voice) say('left voice');
      if (!was?.sharing && c.voice?.sharing) say(`started sharing a screen${d.sound ? ' WITH the sound of the PC' : ', without sound'}`);
      if (was?.sharing && !c.voice?.sharing) say('stopped sharing');
      pushPresence(uid);
      if (!was && c.voice) spanStart(uid, 'voice');
      if (was && !c.voice && ![...conns].some((o) => o.userId === uid && o.voice)) spanEnd(uid, 'voice');
      musicCheck();
      if (was && (!c.voice || c.voice.channelId !== was.channelId)) exitSound(uid, was.channelId);
      // Their entrance sound, for everyone in the channel (them too), a moment after they arrive (and not again for an
      // hour: ENTRANCE_REST). Not when they are the first one in: an entrance played to nobody but the person making it is odd.
      const entrance = !was && c.voice && !again ? userById(uid)?.entrance : null;
      const company = !!c.voice && [...conns].some((o) => o.userId !== uid && o.voice?.channelId === c.voice!.channelId);
      // (when it last played is kept in the database (users.entrance_at): a restart of the server used to forget it)
      if (entrance && company && Date.now() - (userById(uid)?.entrance_at ?? 0) > ENTRANCE_REST && get('SELECT 1 FROM sounds WHERE id = ?', entrance)) {
        run('UPDATE users SET entrance_at = ? WHERE id = ?', Date.now(), uid);
        const chan = c.voice!.channelId;
        // (`entrance`: the page plays it quieter than a soundboard press)
        setTimeout(() => toVoice(chan, { t: 'sound', id: entrance, userId: uid, channelId: chan, entrance: true }), 700).unref();
      }
      break;
    }
    case 'act': {                                   // dance, high five, punch...: everyone's room plays it out
      const kind = String(d.kind ?? '');
      if (!ACTS.has(kind) || Date.now() - (lastAct.get(uid) ?? 0) < 2500) return;
      const target = ACTS_WITH.has(kind) ? String(d.userId ?? '') : '';
      if (ACTS_WITH.has(kind) && (target === uid || !userById(target) || presenceOf(target).state === 'offline')) return;
      const pet = kind === 'pet' ? String(d.pet ?? '') : '';        // petting: whose pet (a pet goes by its owner's id)
      if (kind === 'pet' && (!userById(pet)?.pet || presenceOf(pet).state === 'offline')) return;
      lastAct.set(uid, Date.now());
      c.hits += 5;
      const aim = kind === 'kick' ? [Number(d.dx), Number(d.dy)].map((v) => (Number.isFinite(v) ? Math.max(-80, Math.min(80, Math.round(v * 10) / 10)) : 0)) : [0, 0];      // kicking: which way, and how hard
      broadcast({ t: 'act', id: ++actIds, kind, from: uid, target, pet, dx: aim[0], dy: aim[1] });
      achieve.act(uid, kind, target, pet);
      break;
    }
    case 'floor': {                                 // the stairs: to that floor ('' is upstairs), standing where they come off the stairs (x, y)
      const x = Number(d.x), y = Number(d.y);
      if (typeof d.fit !== 'string' || !(x >= 0 && x <= 4000 && y >= 0 && y <= 4000) || !setFloor(uid, d.fit)) return;
      if (sleeping(uid)) { delete asleep[uid]; saveAsleep(); clearTimeout(wakeTimers.get(uid)); }
      standAt(uid, { x: Math.round(x), y: Math.round(y), seat: '' });
      savePlaces();
      pushPresence(uid);
      break;
    }
    case 'fit':                                     // a basement fit-out's own game (server/basement/<id>.ts)
      // (`game` names a part of one, 'pool' or 'darts': floor.ts keeps when each part was last played by it, so a page
      // sending a new long one every time had filled the server's memory with them for five minutes at a go)
      if (d.game !== undefined && (typeof d.game !== 'string' || d.game.length > 16)) return;
      fitMessage(uid, d);
      pushPlaying();
      break;
    case 'kick': {                                  // the football: they have walked up to it, and this is the kick. Everyone is sent the same roll
      const [x, y, dx, dy] = [d.x, d.y, d.dx, d.dy].map(Number);
      c.hits += 5;
      if (![x, y, dx, dy].every(Number.isFinite)) return;
      const r = kick({ x, y }, dx, dy);
      if (r) broadcast({ t: 'ball', path: r.path, ms: STEP_MS, goal: r.goal, by: uid });
      if (r && r.goal >= 0) achieve.award(uid, 'goal');
      break;
    }
    case 'toss': {                                  // a wad of paper thrown at the bin: from where, and how far back the hand was drawn (the way it goes)
      const [x, y, dx, dy] = [d.x, d.y, d.dx, d.dy].map(Number);
      if (![x, y, dx, dy].every(Number.isFinite) || x < 0 || x > CLUB.w || y < 0 || y > CLUB.h || Date.now() - (lastToss.get(uid) ?? 0) < 500) return;
      lastToss.set(uid, Date.now());
      c.hits += 3;
      const flight = toss(x, y, dx, dy);
      const streak = flight.made ? (tossStreak.get(uid) ?? 0) + 1 : 0;
      tossStreak.set(uid, streak);
      if (flight.made) { tossMade[uid] = (tossMade[uid] ?? 0) + 1; setKV('paperToss', JSON.stringify(tossMade)); }
      broadcast({ t: 'toss', from: uid, path: flight.path, ms: TOSS_STEP_MS, made: flight.made, rims: flight.rims, streak, far: Math.round(Math.hypot(CLUB.trash.x - x, CLUB.trash.y - y)), count: tossMade[uid] ?? 0 });
      achieve.toss(uid, flight.made, tossMade[uid] ?? 0);
      break;
    }
    case 'arcade': {                                // a score on the arcade machine: kept if it is that person's best at that game
      const game = String(d.game ?? ''), score = Math.floor(Number(d.score));
      c.hits += 10;
      if (!ARCADE.includes(game) || !(score > 0 && score < 10_000_000)) return;
      achieve.arcade(uid, game, score);
      if (score <= (get<{ score: number }>('SELECT score FROM arcade_scores WHERE game = ? AND user_id = ?', game, uid)?.score ?? 0)) return;
      run('INSERT INTO arcade_scores (game, user_id, score, at) VALUES (?, ?, ?, ?) ON CONFLICT (game, user_id) DO UPDATE SET score = excluded.score, at = excluded.at', game, uid, score, Date.now());
      broadcast({ t: 'arcade', scores: arcadeScores() });
      break;
    }
    case 'disco': {                                 // the light switch by the wall clock: disco lights on or off, for everybody (client/src/disco.tsx)
      c.hits += 10;
      if (!!d.on === disco) return;
      disco = !!d.on;
      setKV('disco', disco ? '1' : '0');
      broadcast({ t: 'disco', on: disco });
      achieve.disco(uid, disco);
      break;
    }
    case 'wave': {                                  // "come and join": a nudge for one person
      const target = String(d.userId ?? '');
      if (target === uid || !userById(target)) return;
      c.hits += 20;
      const key = `${uid}>${target}`;
      if (Date.now() - (lastWave.get(key) ?? 0) < 8000) return;
      lastWave.set(key, Date.now());
      for (const o of conns) if (o.userId === target && o.ws.readyState === 1) o.ws.send(JSON.stringify({ t: 'wave', from: uid }));
      break;
    }
    case 'ask': {                                   // "can I watch?": asking somebody in my voice chat to share the game their PC names
      const target = String(d.userId ?? '');
      if (target === uid || !userById(target) || !c.voice) return;
      c.hits += 20;
      const p = presenceOf(target);
      if (p.state !== 'gaming' || !p.label || !p.voice || p.voice.channelId !== c.voice.channelId || p.voice.sharing) return;
      const key = `${uid}>${target}`, now = Date.now();
      if (now - (lastAsk.get(key) ?? 0) < ASK_EVERY) return;
      lastAsk.set(key, now);
      askOpen.add(key);
      setTimeout(() => askOpen.delete(key), ASK_EVERY).unref();
      console.log(`[ask] ${stamp()} ${userById(uid)?.name ?? uid} asked ${userById(target)?.name ?? target} to share ${p.label}`);
      const data = JSON.stringify({ t: 'ask', from: uid, game: p.label });
      for (const o of conns) if (o.userId === target && o.ws.readyState === 1) o.ws.send(data);
      break;
    }
    case 'askno': {                                 // "Not now": the one who asked is told, quietly
      const from = String(d.userId ?? ''), key = `${from}>${uid}`;
      if (!askOpen.delete(key)) return;
      toUser(from, { t: 'askno', from: uid });
      break;
    }
    case 'music': {
      if (!c.voice) return;                       // the music belongs to the people in voice
      const cur = music.current;
      const id = Number(d.id);
      if (d.op === 'add') {
        const q = String(d.q ?? '').trim();
        if (!q || music.queue.length >= 30) return;
        c.hits += 15;
        findVideos(q).then((found) => {
          if (!found.length) return tell(c, `Nothing on YouTube for "${q.slice(0, 40)}".`);
          if (!c.voice || music.queue.length >= 30) return;    // (asked again: the search took a moment, and others were adding too)
          const song: Song = { ...found[0], id: ++songIds, by: uid, alts: found.slice(1) };
          achieve.count(uid, 'dj');
          if (queueBehind()) { music.queue.push(song); pushMusic(); } else startSong(song);
        }).catch((e) => { if (e instanceof NoSearch) return tell(c, e.message); console.error('[music]', e); tell(c, 'Could not search YouTube just now.'); });
      } else if (d.op === 'play' || d.op === 'list') {           // straight from the history, or a whole saved list
        const tracks = d.op === 'play' ? [cleanTrack(d)] : all<any>('SELECT video_id AS videoId, title, seconds FROM playlist_items WHERE playlist_id = ? ORDER BY id', Number(d.id)).map(cleanTrack);
        c.hits += 10;
        // a karaoke sign-up (client/src/basement/karaoke.tsx): tagged with its singer, the other search results kept as stand-ins
        const sing = d.op === 'play' && d.karaoke === true;
        for (const t of tracks) {
          if (!t || music.queue.length >= 30) continue;
          const song: Song = { ...t, id: ++songIds, by: uid, alts: sing && Array.isArray(d.alts) ? d.alts.slice(0, 4).map(cleanTrack).filter((a: unknown): a is Song['alts'][number] => !!a) : [] };
          if (sing) { if (!signUp(music, { ...song, singer: uid }, startSong)) tell(c, 'You have two songs waiting to sing already.'); }
          else if (queueBehind()) music.queue.push(song); else startSong(song);
        }
        pushMusic();
      } else if ((d.op === 'skip' && (d.id == null || cur?.id === id)) || (d.op === 'ended' && cur?.id === id)) {
        // (a skip that names its song only skips that one: two people pressing Skip together skip one song, not two)
        if (cur) playNext();
      } else if (d.op === 'bad' && cur?.id === id && cur.videoId === String(d.videoId)) {
        // this video may not be played outside youtube.com: try the next search result, then give up on it
        const alt = cur.alts.shift();
        if (alt) startSong({ ...cur, ...alt });
        else { broadcast({ t: 'toast', text: `YouTube will not let "${cur.title.slice(0, 50)}" play here.` }); playNext(); }
      } else if (d.op === 'length' && cur?.id === id && !cur.seconds) {
        // A video asked for by its link (or found with the official search) arrives without its length. The first
        // player to load it reports it, and from then on everyone has the bar; a live stream is marked as one.
        const sec = Math.round(Number(d.seconds));
        if (d.live === true) { if (!cur.live) { cur.live = true; pushMusic(); } }
        else if (sec >= 1 && sec <= 86_400) {
          cur.seconds = sec;
          run('UPDATE plays SET seconds = ? WHERE video_id = ? AND seconds = 0', sec, cur.videoId);        // so Recent and saved lists know it next time
          songClock();
          pushMusic();
        }
      } else if (d.op === 'seek' && cur?.id === id) {              // somebody dragged the bar: everyone jumps there
        const to = Math.max(0, Math.min(cur.seconds ? cur.seconds - 1 : 86_400, Number(d.to) || 0));
        c.hits += 3;
        if (cur.pausedAt != null) cur.pausedAt = to; else cur.startedAt = Date.now() - to * 1000;
        songClock();
        pushMusic();
      } else if (d.op === 'pause' && cur?.id === id && cur.pausedAt == null) {
        cur.pausedAt = Math.max(0, (Date.now() - cur.startedAt) / 1000);
        songClock();
        pushMusic();
      } else if (d.op === 'resume' && cur?.id === id && cur.pausedAt != null) {
        cur.startedAt = Date.now() - cur.pausedAt * 1000 + 300;     // a moment's grace, so everyone starts on the same beat
        cur.pausedAt = null;
        songClock();
        pushMusic();
      } else if (d.op === 'remove') {
        music.queue = music.queue.filter((s) => s.id !== id);
        pushMusic();
      } else if (d.op === 'stop') {
        music.queue = [];
        startSong(null);
      }
      break;
    }
    case 'prefs': {                // their settings, kept here so they follow them to another PC; the newest change wins
      const at = Number(d.at), text = d.prefs && typeof d.prefs === 'object' && !Array.isArray(d.prefs) ? JSON.stringify(d.prefs) : '';
      if (!text || text.length > 20_000 || !Number.isFinite(at) || at > Date.now() + 60_000 || at <= (userById(uid)?.prefs_at ?? 0)) return;
      // What has been read is never un-read by a device that is behind: each chat keeps the furthest either side got to.
      try {
        const had = JSON.parse(userById(uid)?.prefs ?? 'null')?.lastRead;
        if (had && typeof had === 'object') {
          const lr: Record<string, number> = d.prefs.lastRead && typeof d.prefs.lastRead === 'object' ? { ...d.prefs.lastRead } : {};
          for (const [cid, id] of Object.entries(had)) if (Number(id) > (Number(lr[cid]) || 0)) lr[cid] = Number(id);
          d.prefs = { ...d.prefs, lastRead: lr };
        }
      } catch { /* kept as sent */ }
      run('UPDATE users SET prefs = ?, prefs_at = ? WHERE id = ?', JSON.stringify(d.prefs), at, uid);
      for (const o of conns) if (o !== c && o.userId === uid && o.ws.readyState === 1) o.ws.send(JSON.stringify({ t: 'prefs', prefs: d.prefs, at }));
      break;
    }
    case 'watch': {                // a game open in front of them, watched (client/src/basement/sound.ts): see playingNow
      if (d.stop === true) watching.delete(uid);
      else if (typeof d.id === 'string' && d.id.length <= 24 && (d.part === undefined || (typeof d.part === 'string' && d.part.length <= 24))) watching.set(uid, { id: d.id, part: String(d.part ?? ''), at: Date.now() });
      pushPlaying();
      break;
    }
    case 'game':                   // the game table: picking a game, seats, moves (all checked in games.ts)
      gameTable.handle(uid, d);
      pushPlaying();
      break;
    case 'mirror': {               // the steamed-up bathroom mirror: a finger's stroke (passed on to everybody), or a page asking for all of it
      const back = mirror.handle(d, uid);
      if (back && c.ws.readyState === 1) c.ws.send(JSON.stringify(back));
      break;
    }
    case 'board': {                // a pen stroke, a fill or a wipe on the whiteboard: kept here, and passed on to everybody else
      if (d.op === 'pict') { drawGuess.handle(uid, d); break; }        // Draw & Guess: open, join, leave, begin, a guess, stop, "a different word"
      const did = drawOn(d, uid);
      if (!did) return;
      const out = JSON.stringify({ t: 'board', ...did.step });
      for (const o of conns) if ((did.everyone || o !== c) && o.ws.readyState === 1) o.ws.send(out);
      break;
    }
    case 'sound': {
      if (!c.voice || !get('SELECT 1 FROM sounds WHERE id = ? AND entrance_for IS NULL', Number(d.id))) return;      // (an entrance clip is not a button: it plays when its person arrives, and only then)
      c.hits += 8; // about 15 sounds per 10 s at most
      const chan = c.voice.channelId;
      // in the log: who pressed which sound in which voice chat, and exactly who it was sent to
      const heardBy = new Set([...conns].filter((o) => o.voice?.channelId === chan && o.ws.readyState === 1).map((o) => userById(o.userId)?.name ?? o.userId));
      toVoice(chan, { t: 'sound', id: Number(d.id), userId: uid, channelId: chan });
      achieve.count(uid, 'sound');
      console.log(`[sound] ${stamp()} ${userById(uid)?.name ?? uid} played sound ${Number(d.id)} in voice chat ${chan}; sent to: ${[...heardBy].join(', ')}`);
      break;
    }
    case 'oops': {                                  // a page could not draw itself (client/src/components/Boundary.tsx): what threw, and where
      const clean = (v: unknown, n: number) => String(v ?? '').replace(/[^\x20-\x7e\n]/g, '').slice(0, n);
      const top = clean(d.stack, 1200).split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 4).join(' | ');
      console.log(`[oops] ${stamp()} ${userById(uid)?.name ?? uid} (${c.kind}): ${clean(d.message, 300)}\n  in: ${clean(d.where, 600)}\n  at: ${top}\n  on: ${clean(d.ua, 200)}`);
      break;
    }
    case 'stats': {                                 // how a shared screen is really getting through, for the log (see shareStats in the page)
      if (!c.voice || !Array.isArray(d.lines)) return;
      c.hits += 6;
      const who = userById(uid)?.name ?? uid, at = stamp();
      for (const line of d.lines.slice(0, 6)) if (typeof line === 'string') console.log(`[share] ${at} ${who} ${line.replace(/[^\x20-\x7e]/g, '').slice(0, 900)}`);
      break;
    }
    case 'preview': {
      if (!c.voice?.sharing || typeof d.data !== 'string' || !d.data.startsWith('data:image/jpeg;base64,') || d.data.length > 120_000) return;
      c.hits += 30; // the page sends one a minute; each is up to 120 KB for everybody, so four in 10 s is the most anyone gets through
      previews.set(uid, d.data);
      broadcast({ t: 'preview', userId: uid, data: d.data }, c);
      break;
    }
  }
}

setInterval(() => {
  for (const [uid, m] of meters) {
    if (m.kinds?.size) {
      const top = [...m.kinds].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, n]) => `${k} x${n}`).join(', ');
      console.log(`[ws] ${stamp()} ${userById(uid)?.name ?? uid} sent ${m.hits} messages in 10 s; past the first 120 were ignored (${top})${m.cut ? ', and the connection was cut' : ''}`);
    }
    m.hits = m.bytes = 0; m.kinds = undefined; m.cut = false;
  }
}, 10_000);
setInterval(() => {
  for (const c of conns) {
    if (!c.alive) { c.ws.terminate(); continue; }
    // Signed out since it connected (a new password set from the command line, say, which this server is not told
    // about): the connection goes too, within half a minute.
    if (!get('SELECT 1 FROM sessions WHERE hash = ?', c.session)) { c.ws.close(4001, 'signed out'); continue; }
    c.alive = false;
    c.ws.ping();
  }
}, 30_000);

function onUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
  // Node hands the connection over with nobody listening for its errors. Until something below takes it on, one
  // (the other end hanging up while it is being turned away, say) must not stop the whole server.
  socket.on('error', () => {});
  let url: URL;
  try { url = new URL(req.url ?? '/', 'http://x'); } catch { socket.destroy(); return; }
  const user = sameOrigin(req) ? auth(req) : null;
  if (!user) { socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n'); return; }
  if (url.pathname === '/ws') {
    // Each connection is told about by, and tells, every other: a thousand from one person slowed everybody down.
    // (The page tries again by itself, a little later each time, so a window turned away here is not stuck.)
    let mine = 0;
    for (const c of conns) if (c.userId === user.id) mine++;
    if (mine >= MAX_WINDOWS) { socket.end('HTTP/1.1 429 Too Many Requests\r\n\r\n'); return; }
    const session = sha(cookie(req, 'cd_session'));
    wss.handleUpgrade(req, socket, head, (ws) => onSocket(ws, user, url.searchParams.get('kind') === 'app' ? 'app' : 'web', session));
  } else if (url.pathname.startsWith('/rtc')) {
    // Hand the raw connection to LiveKit's signalling port.
    const up = net.connect(LK.port, '127.0.0.1', () => {
      let raw = `${req.method} ${req.url} HTTP/1.1\r\n`;
      for (let i = 0; i < req.rawHeaders.length; i += 2) raw += `${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`;
      up.write(raw + '\r\n');
      if (head.length) up.write(head);
      socket.pipe(up).pipe(socket);
    });
    up.on('error', () => socket.destroy());
    socket.on('error', () => up.destroy());
  } else socket.destroy();
}

// ───────────────────────── start ─────────────────────────

const listening = new Map<string, http.Server>();
/** Addresses already acted on. One that is there but will not be listened on (taken by something else, say) is tried
 *  again every half minute; without this it would also restart LiveKit, and drop every call, each time. */
const noticed = new Set<string>();
let started = false;
function listen() {
  const here = bindAddresses();
  for (const addr of noticed) if (!here.includes(addr)) noticed.delete(addr);
  for (const addr of here) {
    const fresh = !noticed.has(addr);
    noticed.add(addr);
    if (listening.has(addr)) continue;
    if (started && fresh) { restartLiveKit(); guessPublicUrl(); }
    const server = http.createServer(handle);
    server.on('upgrade', onUpgrade);
    server.on('error', (e: NodeJS.ErrnoException) => {
      listening.delete(addr);
      if (e.code === 'EADDRINUSE' && addr === '127.0.0.1') { console.error(`Port ${PORT} is already in use. Is Chatterday already running?`); process.exit(1); }
    });
    server.listen(PORT, addr, () => console.log(`[http] listening on http://${addr}:${PORT}`));
    listening.set(addr, server);
  }
}
/** If Tailscale is installed, pre-fill the address friends use with this PC's Tailscale name. */
function guessPublicUrl() {
  if (getKV('publicUrl')) return;
  const tryExe = (exe: string, next?: () => void) =>
    execFile(exe, ['status', '--json'], { windowsHide: true, timeout: 5000 }, (err, out) => {
      if (err) return next?.();
      try {
        const name = String(JSON.parse(out).Self?.DNSName ?? '').replace(/\.$/, '');
        if (name && !getKV('publicUrl')) { setKV('publicUrl', `http://${name}:${PORT}`); console.log(`[http] friends connect to http://${name}:${PORT}`); broadcast({ t: 'settings', settings: settings() }); }
      } catch { /* not logged in yet */ }
    });
  tryExe('tailscale', () => tryExe('C:\\Program Files\\Tailscale\\tailscale.exe'));
}

listen();
started = true;
guessPublicUrl();
setInterval(listen, 30_000).unref(); // picks up the Tailscale address if it appears later

/** The soundboard folder next to the app is kept in step with the buttons. Looked at when the server starts and every
 *  20 seconds after, so nothing needs a restart.
 *  - A file dropped in becomes a button for everyone. A file is only ever taken in once: delete its button in the app
 *    and it stays deleted, though the file is still there.
 *  - A file taken out of the folder takes its button with it (only buttons that came from the folder; ones added in
 *    the app are left alone). It has to be missing two looks in a row, so a file caught mid-rename is not lost. */
const soundGone = new Set<number>();
function importSoundboard() {
  const dir = path.join(ROOT, 'soundboard');
  if (!fs.existsSync(dir)) return 0;
  const entries = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile());
  const baseOf = (file: string) => file.replace(/\.[^.]+$/, '').trim().slice(0, 24).toLowerCase();
  const files = new Set(entries.map((e) => e.name.slice(0, 120))), bases = new Set(entries.map((e) => baseOf(e.name)));
  let removed = 0;
  for (const s of all<any>("SELECT s.id, s.name, s.file_id, f.name AS file FROM sounds s LEFT JOIN files f ON f.id = s.file_id WHERE s.user_id = 'soundboard'")) {
    if (files.has(s.file) || bases.has(String(s.name).toLowerCase())) { soundGone.delete(s.id); continue; }
    if (!soundGone.has(s.id)) { soundGone.add(s.id); continue; }
    soundGone.delete(s.id);
    run('DELETE FROM sounds WHERE id = ?', s.id);
    run("DELETE FROM files WHERE id = ? AND user_id = 'soundboard'", s.file_id);        // so the same file can be put back later
    fs.rmSync(path.join(UPLOADS, String(s.file_id)), { force: true });
    console.log(`[sounds] removed "${s.name}": its file has left the soundboard folder`);
    removed++;
  }
  let added = 0;
  for (const entry of entries) {
    const name = entry.name.replace(/\.[^.]+$/, '').trim().slice(0, 24);
    const src = path.join(dir, entry.name);
    const st = fs.statSync(src);
    const size = st.size;
    if (Date.now() - st.mtimeMs < 3000) continue;        // still being copied in: next time round
    if (!name || size === 0 || size > LIMITS.sound || get('SELECT 1 FROM sounds WHERE name = ? COLLATE NOCASE AND entrance_for IS NULL', name)) continue;
    if (get("SELECT 1 FROM files WHERE user_id = 'soundboard' AND kind = 'sound' AND name = ? AND size = ?", entry.name.slice(0, 120), size)) continue;
    const head = Buffer.alloc(16);
    const fd = fs.openSync(src, 'r');
    fs.readSync(fd, head, 0, 16, 0);
    fs.closeSync(fd);
    const mime = sniff(head);       // by its contents, so a file with no extension still works
    if (!/^(audio|video)\//.test(mime)) { console.log(`[sounds] skipped "${entry.name}": not an audio file`); continue; }
    const id = rid(15);
    fs.copyFileSync(src, path.join(UPLOADS, id));
    tx(() => {                      // both or neither: a file on record with no button would never be taken in again
      run('INSERT INTO files (id, user_id, name, mime, size, kind, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', id, 'soundboard', entry.name.slice(0, 120), mime, size, 'sound', Date.now());
      run('INSERT INTO sounds (name, emoji, file_id, user_id, created_at) VALUES (?, ?, ?, ?, ?)', name, 'note', id, 'soundboard', Date.now());
    });
    added++;
  }
  if (added) console.log(`[sounds] added ${added} from the soundboard folder`);
  return added + removed;
}
/** The "entrance sounds" folder next to the app: a file named after a person (Sam.mp3 for Sam, in capitals or
 *  not) is that person's own entrance clip. It plays for everyone in the voice chat, them included, when they join.
 *  Looked at along with the soundboard folder, so nothing needs a restart.
 *  - The first time a person's file is taken in, it becomes their entrance sound. They can still pick a soundboard
 *    clip, or none, in Settings, and have theirs back from the same list.
 *  - A different file under their name takes the clip's place; what they have picked in Settings is left alone.
 *  - A file taken out of the folder (missing two looks in a row) takes the clip with it.
 *  The clip is nobody's button: it is kept off the soundboard, and nobody else can pick it. */
const entranceGone = new Set<number>();
const entranceSaid = new Set<string>();             // what has been said in the log about a file that cannot be used, said once
/** Tells a person's own devices which entrance and exit sound they now have (nobody else is told what those are). */
const tellSounds = (userId: string) => { const u = userById(userId); if (u) toUser(userId, { t: 'user', user: { ...publicUser(u), entrance: u.entrance ?? null, exit: u.exit_sound ?? null } }); };
function importEntrances() {
  const dir = path.join(ROOT, 'entrance sounds');
  if (!fs.existsSync(dir)) return 0;
  const entries = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile());
  const files = new Set(entries.map((e) => e.name.slice(0, 120)));
  const say = (file: string, why: string) => { if (!entranceSaid.has(`${file}: ${why}`)) { entranceSaid.add(`${file}: ${why}`); console.log(`[entrance] "${file}" is not in use: ${why}`); } };
  const clips = () => all<any>('SELECT s.id, s.file_id, s.entrance_for, f.name AS file, f.size FROM sounds s LEFT JOIN files f ON f.id = s.file_id WHERE s.entrance_for IS NOT NULL');
  let changed = 0;
  for (const entry of entries) {
    const file = entry.name.slice(0, 120), base = entry.name.replace(/\.[^.]+$/, '').trim();
    const src = path.join(dir, entry.name);
    const st = fs.statSync(src);
    const had = clips();
    if (had.some((s) => s.file === file && s.size === st.size)) continue;          // already taken in
    if (Date.now() - st.mtimeMs < 3000) continue;                                  // still being copied in: next time round
    const who = get<UserRow>("SELECT * FROM users WHERE name = ? COLLATE NOCASE AND role != 'removed'", base);
    if (!who) { say(entry.name, `nobody here is called "${base}" (it is taken in when somebody is)`); continue; }
    if (st.size === 0 || st.size > LIMITS.sound) { say(entry.name, st.size ? `it is over ${Math.round(LIMITS.sound / 1048576)} MB` : 'it is empty'); continue; }
    const cur = had.find((s) => s.entrance_for === who.id);
    if (cur && cur.file !== file && files.has(cur.file)) { say(entry.name, `${who.name} already has "${cur.file}" in the folder`); continue; }
    const head = Buffer.alloc(16);
    const fd = fs.openSync(src, 'r');
    fs.readSync(fd, head, 0, 16, 0);
    fs.closeSync(fd);
    const mime = sniff(head);
    if (!/^(audio|video)\//.test(mime)) { say(entry.name, 'it is not an audio file'); continue; }
    const id = rid(15);
    fs.copyFileSync(src, path.join(UPLOADS, id));
    tx(() => {
      run('INSERT INTO files (id, user_id, name, mime, size, kind, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', id, 'entrance', file, mime, st.size, 'sound', Date.now());
      if (cur) {                    // the same clip with a new file under it, so whoever has it picked keeps it
        run('UPDATE sounds SET file_id = ?, name = ? WHERE id = ?', id, base.slice(0, 24), cur.id);
        run("DELETE FROM files WHERE id = ? AND user_id = 'entrance'", cur.file_id);
      } else {
        const made = run('INSERT INTO sounds (name, emoji, file_id, user_id, created_at, entrance_for) VALUES (?, ?, ?, ?, ?, ?)', base.slice(0, 24), 'note', id, 'entrance', Date.now(), who.id);
        run('UPDATE users SET entrance = ? WHERE id = ?', Number(made.lastInsertRowid), who.id);
      }
    });
    if (cur) fs.rmSync(path.join(UPLOADS, String(cur.file_id)), { force: true });
    else tellSounds(who.id);        // their Settings shows it at once
    console.log(`[entrance] "${entry.name}" ${cur ? 'has replaced' : 'is now'} ${who.name}'s entrance sound`);
    changed++;
  }
  for (const s of clips()) {
    if (files.has(s.file)) { entranceGone.delete(s.id); continue; }
    if (!entranceGone.has(s.id)) { entranceGone.add(s.id); continue; }
    entranceGone.delete(s.id);
    const whose = all<{ id: string }>('SELECT id FROM users WHERE entrance = ? OR exit_sound = ?', s.id, s.id);
    tx(() => {
      run('DELETE FROM sounds WHERE id = ?', s.id);
      run("DELETE FROM files WHERE id = ? AND user_id = 'entrance'", s.file_id);
      run('UPDATE users SET entrance = NULL WHERE entrance = ?', s.id);
      run('UPDATE users SET exit_sound = NULL WHERE exit_sound = ?', s.id);
    });
    fs.rmSync(path.join(UPLOADS, String(s.file_id)), { force: true });
    for (const u of whose) tellSounds(u.id);
    console.log(`[entrance] removed "${s.file}": it has left the entrance sounds folder`);
    changed++;
  }
  return changed;
}
// (a file that cannot be read just now, open in another program say, is no reason not to start: it is tried again next time)
const lookAtSoundboard = () => {
  let changed = 0;
  try { changed += importSoundboard(); } catch (e: any) { console.log('[sounds]', e.message); }
  try { changed += importEntrances(); } catch (e: any) { console.log('[entrance]', e.message); }
  if (changed) broadcast({ t: 'sounds', sounds: sounds() });
};
setInterval(lookAtSoundboard, 20_000).unref();
lookAtSoundboard();

// Whether voice is up is part of the settings every app holds, so say so whenever it changes (LiveKit starting,
// stopping, or being restarted), not only the once.
onVoiceChange(() => broadcast({ t: 'settings', settings: settings() }));
onNewDay(() => broadcast({ t: 'settings', settings: settings() }));      // (midnight on the house's clock: a new set of photos on the wall)
await startLiveKit();

if (userCount() === 0) console.log(`\n  This server is new. Open http://127.0.0.1:${PORT} on this PC to set it up.\n`);

/** Today on the house's clock, as 'MM-DD' (what a birthday is kept as). */
const houseDay = () => new Intl.DateTimeFormat('en-CA', { timeZone: houseZone(), month: '2-digit', day: '2-digit' }).format(new Date());
// A birthday is said in the text chat, once per person a year: at midnight on the house's clock, or the first time the server is up
// that day. Said by the house (user_id 'house', which the chat draws as a line of its own, not a message from anybody).
// The cake and the card are server/basement/birthday.ts.
function sayBirthdays() {
  const year = new Intl.DateTimeFormat('en-CA', { timeZone: houseZone(), year: 'numeric' }).format(new Date());
  const ch = get<{ id: number }>("SELECT id FROM channels WHERE kind = 'text' ORDER BY position, id LIMIT 1");
  if (!ch) return;
  for (const u of all<{ id: string; name: string }>("SELECT id, name FROM users WHERE birthday = ? AND role != 'removed'", houseDay())) {
    if (getKV(`bday:said:${year}:${u.id}`)) continue;
    setKV(`bday:said:${year}:${u.id}`, String(Date.now()));
    const r = run("INSERT INTO messages (channel_id, user_id, content, attachments, created_at) VALUES (?, 'house', ?, '[]', ?)",
      ch.id, `It's ${u.name}'s birthday! There's a cake on the kitchen table, and a card to sign.`, Date.now());
    toChannel(ch.id, { t: 'msg', message: messageOut(Number(r.lastInsertRowid)) });
  }
}
setTimeout(sayBirthdays, 5_000).unref?.();
setInterval(sayBirthdays, 60_000).unref?.();

// If something unexpected goes wrong, write down what before stopping; Start Chatterday.bat starts the server again.
for (const kind of ['uncaughtException', 'unhandledRejection'] as const) {
  process.on(kind, (err: unknown) => {
    const text = `${new Date().toISOString()} ${kind}: ${err instanceof Error ? err.stack : String(err)}\n\n`;
    console.error(text);
    try { fs.appendFileSync(path.join(DATA, 'crash.log'), text); } catch { /* nothing more to do */ }
    stopLiveKit();
    process.exit(1);
  });
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { saveMusic(); stopLiveKit(); process.exit(0); });

// A restart for an update. Simply stopping (the old way) dropped everyone's call: the apps tried to carry the call on
// to the new LiveKit, which knows nothing of it ("could not restart participant"), and some came back out of voice.
// Now every app is told first. Those in a voice chat note which one and leave it properly; the server stops a moment
// later and the tray's watcher starts it again; each app reconnects, loads the new version if there is one, and goes
// back into the same voice chat (client/src/voice.ts, "the server restarting").
function restartForUpdate() {
  if (restarting) return;
  restarting = true;
  const inVoice = new Set([...conns].filter((c) => c.voice).map((c) => userById(c.userId)?.name ?? c.userId));
  console.log(`[http] ${stamp()} restarting for an update${inVoice.size ? `: ${[...inVoice].join(', ')} leave voice and are put back` : ''}`);
  broadcast({ t: 'restarting' });
  saveMusic();
  setTimeout(() => { saveMusic(); stopLiveKit(); process.exit(0); }, 3000);
}
process.on('exit', stopLiveKit);

// The basement's games (server/basement/*.ts), last of all: loading them waits on the files, and nothing above may be left
// half set up while it does (messages are already being answered by then).
void loadFitGames({ all: (msg) => broadcast(msg), to: (uid, msg) => toUser(uid, msg), present: presentIds, nameOf: (uid) => userById(uid)?.name ?? 'Somebody', isAdmin: (uid) => userById(uid)?.role === 'admin' });
