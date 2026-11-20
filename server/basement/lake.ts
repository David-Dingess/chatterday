// The lake, down the path past the campsite (scripts/basement/lake.py draws it; client/src/basement/lake.tsx is the page,
// client/src/basement/lake.ts the numbers both share).
//
// Fishing. Anybody stood at one of the dock's six spots can cast: they press on the water where they want it to go and
// hold, a meter rises and falls, and they let go. The page sends where they aimed and how full the meter was; a full
// one (PERFECT) lands right there, anything less falls short along the way to it, a little off (no hand is steady), and
// it stops at the water's edge if it would fly on to land. Then a wait for a bite, a few seconds to a quarter of a minute
// (shorter in the rain, at dawn and dusk, by the weeds), and the bobber goes under: a click or Space in the next few
// seconds sets the hook (missed: the fish lets go and another comes along soon, nothing lost). What is on the line is
// rolled the moment it is hooked, from the hour, the weather, the season, where in the water the bobber is (by the weeds,
// out over the deep, near the shore), whether the cast was perfect (rarer things, less junk) and the angler's luck (one
// more for each fish let go, up to three, spent one a catch). The page plays the reel-in (a bar to keep on the fish as it
// darts up and down its track, client/src/basement/lake.tsx) and says how it went: landed, or lost (it got away: it swims
// off, no harm done). A landed one is kept
// for good, in the catches table, and everybody sees it held up over the angler; the angler gets the catch card and
// keeps it or lets it go.
//
// Every catch is one row of `catches` (who, what, weight in ounces, length in inches, when, kept or let go, from where):
// the one place a catch is written, for the record board here and anything else that wants to know (catchHooks, below,
// are called with each new one). The lines in the water are not kept across a restart (a cast is a few seconds).
import { LAYOUT } from '../../client/src/basement/lake.gen.ts';
import { KIND, KINDS, MAX_CAST, NOTES, PERFECT, SPOTS, inWater, spotFace, zoneAt } from '../../client/src/basement/lake.ts';
import type { Catch, Lake, Line, Pop } from '../../client/src/basement/lake.ts';
import { achieve } from '../achievements.ts';
import { all, db, get, run } from '../db.ts';
import type { FitGame, FitOut } from '../floor.ts';
import { houseMonth } from '../clock.ts';

db.exec(`CREATE TABLE IF NOT EXISTS catches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  weight_oz INTEGER NOT NULL DEFAULT 0,
  length_in REAL NOT NULL DEFAULT 0,
  at INTEGER NOT NULL,
  kept INTEGER,
  spot INTEGER,
  zone TEXT,
  note TEXT
);
CREATE INDEX IF NOT EXISTS catches_user ON catches (user_id, kind);`);

/** Called with every catch as it is landed (before the angler has said keep or let go): for achievements and the like.
 *  A hook that throws is ignored. */
export const catchHooks: ((c: Catch) => void)[] = [];
catchHooks.push((c) => achieve.fishCatch(c.uid, c.kind, c.w));        // the fishing achievements (server/achievements.ts)
type Row = { id: number; user_id: string; kind: string; weight_oz: number; length_in: number; at: number; kept: number | null; note: string | null };
const toCatch = (r: Row): Catch => ({ id: r.id, uid: r.user_id, kind: r.kind, w: r.weight_oz, len: r.length_in, at: r.at, kept: r.kept, ...(r.note ? { note: r.note } : {}) });
/** Somebody's catches, newest first. */
export const catchesOf = (uid: string, limit = 50): Catch[] => all<Row>('SELECT * FROM catches WHERE user_id = ? ORDER BY id DESC LIMIT ?', uid, limit).map(toCatch);

const FAST = !!process.env.CHATTERDAY_FISH_FAST;            // (for trying it out: bites come at once)
const BITE_MS = 2800;                                       // how long the bobber is under: a click in this time hooks it
const GRACE_MS = 500;                                       // (and a little more, for the click's trip here)
const REEL_MAX_MS = 120_000;
const MAX_LUCK = 3;

let out: FitOut;
const lines: Record<string, Line> = {};
const pops: Record<string, Pop> = {};
/** What is waiting for each line, unseen: when the next bite comes, and once hooked what it is. */
const secret = new Map<string, { biteAt: number; zone: string; light: number; wx: string; perfect: boolean; hooked?: { kind: string; w: number; len: number; note?: string; strength: number; expect: number; t0: number } }>();
let luck: Record<string, number> = {};
let board: Pick<Lake, 'records' | 'junk' | 'best' | 'totals' | 'recent'> = { records: {}, junk: {}, best: {}, totals: {}, recent: [] };

/** The record board, read again from the catches (after each one). */
function reboard() {
  const best: Lake['best'] = {}, records: Lake['records'] = {}, junk: Lake['junk'] = {}, totals: Lake['totals'] = {};
  // (SQLite gives the other columns from the row with the MAX: the biggest one's length and when)
  for (const r of all<{ user_id: string; kind: string; w: number; len: number; at: number; n: number }>(
    'SELECT user_id, kind, MAX(weight_oz) AS w, length_in AS len, at, COUNT(*) AS n FROM catches GROUP BY user_id, kind')) {
    (best[r.user_id] ??= {})[r.kind] = { w: r.w, len: r.len, n: r.n, at: r.at };
    if (r.w > 0) {
      const cur = records[r.kind];
      if (!cur || r.w > cur.w || (r.w === cur.w && r.at < cur.at)) records[r.kind] = { uid: r.user_id, w: r.w, len: r.len, at: r.at };
    }
  }
  for (const r of all<{ kind: string; n: number; user_id: string; at: number }>('SELECT kind, COUNT(*) AS n, user_id, MIN(at) AS at FROM catches WHERE weight_oz = 0 GROUP BY kind')) {
    junk[r.kind] = { n: r.n, uid: r.user_id, at: r.at };
  }
  for (const r of all<{ user_id: string; n: number; kept: number; fish: number }>('SELECT user_id, COUNT(*) AS n, SUM(kept = 1) AS kept, SUM(weight_oz > 0) AS fish FROM catches GROUP BY user_id')) {
    totals[r.user_id] = { n: r.n, kept: r.kept ?? 0, fish: r.fish ?? 0 };
  }
  const recent = all<Row>('SELECT * FROM catches ORDER BY id DESC LIMIT 8').map(toCatch);
  board = { records, junk, best, totals, recent };
}

const state = (): Lake => ({ lines, pops, ...board, now: Date.now() });
const tell = () => out.all({ state: state() });

// ── what bites ──
function season(): 'spring' | 'summer' | 'fall' | 'winter' {
  const m = houseMonth();
  return m >= 3 && m <= 5 ? 'spring' : m >= 6 && m <= 8 ? 'summer' : m >= 9 && m <= 11 ? 'fall' : 'winter';
}
const rnd = Math.random;

/** How likely each kind is to be on the line just now, there. */
export function odds(zone: string, light: number, wx: string, lk: number, perfect = false): [string, number][] {
  const night = light < 0.3, twilight = light >= 0.3 && light < 0.8, wet = wx === 'rain' || wx === 'storm';
  const s = season();
  const m = (on: boolean, k: number) => (on ? k : 1);
  return KINDS.map((k) => {
    let w = k.base;
    switch (k.id) {
      case 'bluegill': w *= m(zone === 'weeds', 1.8) * m(s === 'summer', 1.3) * m(night, 0.5) * m(zone === 'deep', 0.6); break;
      case 'perch': w *= m(s === 'winter', 1.6) * m(s === 'fall', 1.2) * m(zone === 'open', 1.2); break;
      case 'crappie': w *= m(twilight, 1.8) * m(s === 'spring', 1.6) * m(zone === 'weeds', 1.2); break;
      case 'bass': w *= m(zone === 'weeds', 2.2) * m(twilight, 1.5) * m(s === 'summer', 1.4) * m(night, 0.6) * m(zone === 'deep', 0.7); break;
      case 'catfish': w *= m(night, 4) * m(wet, 1.4) * m(zone === 'shallow', 1.5) * m(zone === 'deep', 1.2) * m(s === 'summer', 1.2); break;
      case 'trout': w *= m(zone === 'deep', 1.6) * m(s === 'winter', 2) * m(s === 'fall', 1.4) * m(s === 'spring', 1.3) * m(s === 'summer', 0.4) * m(wet, 1.5) * m(wx === 'fog', 1.3); break;
      case 'muskie': w *= (zone === 'deep' ? 2.4 : 0.25) * m(s === 'fall', 1.6) * m(wx === 'storm', 1.8) * m(wet, 1.3) * (1 + 0.5 * lk); break;
      case 'golden': w *= (1 + lk) * m(twilight, 1.5) * m(zone === 'deep', 1.2); break;
      case 'walleye': w *= m(night, 2) * m(twilight, 1.6) * m(s === 'spring', 1.3) * m(zone === 'deep', 1.2) * m(light > 0.9, 0.5); break;
      case 'carp': w *= m(zone === 'shallow', 1.6) * m(zone === 'weeds', 1.3) * m(s === 'summer', 1.3) * m(s === 'winter', 0.5); break;
      case 'gar': w *= m(zone === 'weeds', 1.8) * m(s === 'summer', 1.6) * m(s === 'winter', 0.3) * m(light > 0.8, 1.2); break;
      case 'sturgeon': w *= (zone === 'deep' ? 2.5 : 0.3) * m(s === 'spring', 1.6) * m(s === 'winter', 1.3) * (1 + 0.4 * lk); break;
      case 'eel': w *= (night ? 3 : 0.4) * m(wet, 1.5) * m(zone === 'shallow', 1.3); break;
      // the mythical ones: the phantom glassfish only at night (more in fog), the serpent out over the deep (more in a storm)
      case 'ghost': w *= night ? m(wx === 'fog', 3) * m(wet, 1.4) * (1 + 0.5 * lk) : 0; break;
      case 'serpent': w *= (zone === 'deep' ? 1 : 0.05) * m(wx === 'storm', 4) * m(wet, 1.5) * (1 + 0.5 * lk); break;
      case 'chest': w *= m(zone === 'deep', 1.5) * (1 + 0.3 * lk); break;
      case 'pumpkinseed': w *= m(zone === 'weeds', 1.8) * m(zone === 'shallow', 1.3) * m(s === 'summer', 1.3) * m(night, 0.5); break;
      case 'smallmouth': w *= m(zone === 'open', 1.4) * m(zone === 'deep', 1.2) * m(s === 'fall', 1.4) * m(twilight, 1.3); break;
      case 'bullhead': w *= m(night, 2.5) * m(zone === 'shallow', 1.4) * m(wet, 1.3); break;
      case 'bowfin': w *= m(zone === 'weeds', 2.2) * m(night, 1.5) * m(s === 'summer', 1.3); break;
      case 'goldfish': w *= m(zone === 'shallow', 1.8) * m(zone === 'deep', 0.4); break;
      case 'koi': w *= m(zone === 'weeds', 1.5) * m(light > 0.8, 1.3); break;
      case 'crayfish': w *= m(zone === 'shallow', 2.2) * m(night, 1.5) * m(zone === 'deep', 0.3) * m(s === 'winter', 0.4); break;
      case 'paddlefish': w *= (zone === 'deep' ? 2.4 : 0.3) * m(s === 'spring', 1.5) * (1 + 0.4 * lk); break;
      case 'coelacanth': w *= (zone === 'deep' ? 1 : 0.1) * m(night, 1.6) * (1 + lk); break;
      // the clockwork carp only bites on a perfect cast
      case 'clockwork': w *= perfect ? 1 + 0.5 * lk : 0; break;
      case 'crown': case 'ring': w *= m(zone === 'deep', 1.4) * (1 + 0.3 * lk); break;
      default: w *= m(zone === 'shallow', 1.6) * m(wet, 1.3) * m(zone === 'deep', 0.7);      // (junk washes in near the shore)
    }
    if (perfect) w *= { common: 0.8, uncommon: 1.5, rare: 2.5, legendary: 3, mythic: 3, junk: 0.4 }[k.rarity];      // (a perfect cast: the good stuff)
    return [k.id, w];
  });
}
function pick(o: [string, number][]) {
  let r = rnd() * o.reduce((a, [, w]) => a + w, 0);
  for (const [id, w] of o) { if ((r -= w) <= 0) return id; }
  return o[0][0];
}
/** The catch itself: the kind, and for a fish how big (most are small; now and then a big one, more often out deep). */
export function roll(zone: string, light: number, wx: string, lk: number, perfect = false) {
  const id = pick(odds(zone, light, wx, lk, perfect)), k = KIND[id];
  if (!k.lb) {
    const note = id === 'bottle' ? NOTES[Math.floor(rnd() * NOTES.length)] : undefined;
    return { kind: id, w: 0, len: 0, note, strength: k.fight };
  }
  let r = rnd() ** 2.2;
  if (zone === 'deep') r = r ** 0.8;
  if (lk) r = r ** (1 / (1 + 0.15 * lk));
  if (perfect) r = r ** 0.85;
  const lb = k.lb[0] + (k.lb[1] - k.lb[0]) * r;
  const w = Math.max(2, Math.round(lb * 16));
  const len = Math.round((k.len ?? 10) * Math.cbrt(w / 16) * (1 + (rnd() - 0.5) * 0.08) * 10) / 10;
  return { kind: id, w, len, strength: Math.min(1, k.fight * (0.55 + 0.6 * r)) };
}
/** How long the next bite takes, ms. */
function biteWait(zone: string, light: number, wx: string) {
  let s = 4 + rnd() * 10;
  if (wx === 'rain' || wx === 'storm') s *= 0.6;
  if (light >= 0.3 && light < 0.8) s *= 0.8;
  if (zone === 'weeds') s *= 0.85;
  if (zone === 'deep') s *= 1.15;
  return (FAST ? s * 0.12 : s) * 1000;
}

/** Where a cast lands: from just off the dock where they stand, toward (tx, ty) where they pressed (kept within ~65° of
 *  the way the spot faces, and MAX_CAST away at most). A perfect one lands on it; anything less falls short, by how far
 *  the meter was from the top, and a little off line. It stops at the last of the water if it would carry on to land
 *  (or into the dock). */
function landing(spot: number, tx: number, ty: number, power: number, perfect: boolean) {
  const q = LAYOUT.seats[spot], f = spotFace(spot);
  const ox = q.x + f * 10, oy = q.y - 4;
  const ahead = f > 0 ? 0 : Math.PI;
  const aim = Math.atan2((ty - oy) / 0.8, tx - ox);         // (the water is seen at a slant: less far up than across)
  let d = Math.atan2(Math.sin(aim - ahead), Math.cos(aim - ahead));
  d = Math.max(-1.15, Math.min(1.15, d)) + (perfect ? 0 : (rnd() - 0.5) * 0.12);
  const a = ahead + d;
  const want = Math.max(16, Math.min(MAX_CAST, Math.hypot(tx - ox, (ty - oy) / 0.8)));
  const dist = perfect ? want : Math.max(16, want * (0.2 + (0.8 * power) / PERFECT) * (1 + (rnd() - 0.5) * 0.1));
  let last: { x: number; y: number } | null = null, entered = false;
  for (let t = 0; t <= dist; t += 2) {
    const x = ox + Math.cos(a) * t, y = oy + Math.sin(a) * t * 0.8;      // (the water is seen at a slant: less far up than across)
    if (inWater(x, y) && x > 14 && x < LAYOUT.w - 14) { last = { x, y }; entered = true; } else if (entered) break;      // (not off the edge of the picture)
  }
  return last ?? { x: ox + f * 16, y: oy };
}

function message(uid: string, d: Record<string, unknown>) {
  if (d.op === 'log') { out.to(uid, { op: 'log', rows: catchesOf(uid, 40) }); return; }
  if (!out.present().includes(uid)) return;                // (only somebody out here, online)
  const now = Date.now();
  const line = lines[uid], sec = secret.get(uid);
  switch (d.op) {
    case 'cast': {
      const spot = Number(d.spot), tx = Number(d.tx), ty = Number(d.ty), power = Math.max(0, Math.min(1, Number(d.power)));
      if (!SPOTS.includes(spot) || !Number.isFinite(tx) || !Number.isFinite(ty) || !Number.isFinite(power)) return;
      if (Object.entries(lines).some(([id, l]) => id !== uid && l.spot === spot)) return;
      if (line && line.phase === 'reel') return;
      settle(uid);                                          // (a catch card left unanswered: it went in the cooler)
      const perfect = power >= PERFECT;
      const p = landing(spot, tx, ty, power, perfect);
      const light = Math.max(0, Math.min(1, Number(d.light) || 0)), wx = typeof d.wx === 'string' ? d.wx.slice(0, 10) : 'clear';
      const zone = zoneAt(p.x, p.y);
      const ms = Math.round(500 + Math.min(700, Math.hypot(p.x - LAYOUT.seats[spot].x, p.y - LAYOUT.seats[spot].y) * 4));
      lines[uid] = { spot, phase: 'cast', x: Math.round(p.x), y: Math.round(p.y), t0: now, ms, at: now, ...(perfect ? { perfect: true } : {}) };
      secret.set(uid, { biteAt: now + ms + biteWait(zone, light, wx), zone, light, wx, perfect });
      delete pops[uid];
      return tell();
    }
    case 'reelin': {                                        // the line wound in with nothing on it (or walked off with)
      if (!line) return;
      delete lines[uid]; secret.delete(uid);
      return tell();
    }
    case 'hook': {
      if (!line || !sec || line.phase !== 'bite') return;
      if (now > line.at + BITE_MS + GRACE_MS) return;
      const lk = luck[uid] ?? 0;
      const c = roll(sec.zone, sec.light, sec.wx, lk, sec.perfect);
      if (lk) { luck[uid] = lk - 1; out.save('luck', luck); }
      const k = KIND[c.kind];
      // (the bigger one of its kind, the harder: a tenth easier for the smallest, a fifth harder for the biggest; and a
      // quarter calmer all round, but for the mythical ones, which stay all but impossible)
      const diff = Math.round(k.diff * (k.lb ? 0.9 + 0.3 * ((c.w / 16 - k.lb[0]) / Math.max(0.01, k.lb[1] - k.lb[0])) : 1) * (k.rarity === 'mythic' ? 1 : 0.75));
      const expect = 5800;                                    // (the catch meter fills in this long at best: 0.3 to 1 at 0.12 a second)
      sec.hooked = { ...c, expect, t0: now };
      lines[uid] = { ...line, phase: 'reel', at: now, p: 0.3, tn: 0.5, dead: !k.surge };
      // the bar to keep on it: a big one to start with (200 of the track's 568), a step
      // bigger for every eight fish landed, five steps at most
      const bar = 200 + 8 * Math.min(5, Math.floor((board.totals[uid]?.fish ?? 0) / 8));
      out.to(uid, { op: 'fight', diff, motion: k.motion, bar, seed: Math.floor(rnd() * 1e9) });
      return tell();
    }
    case 'reel': {                                          // how the reel-in is going, for everybody watching
      if (!line || line.phase !== 'reel') return;
      const p = Number(d.p), tn = Number(d.tn);
      if (Number.isFinite(p)) line.p = Math.max(0, Math.min(1, p));
      if (Number.isFinite(tn)) line.tn = Math.max(0, Math.min(1.3, tn));
      return tell();
    }
    case 'lost': {
      if (!line || line.phase !== 'reel') return;
      delete lines[uid]; secret.delete(uid);
      pops[uid] = { at: now, what: d.why === 'snap' ? 'snap' : 'away' };
      return tell();
    }
    case 'land': {
      const h = sec?.hooked;
      if (!line || line.phase !== 'reel' || !h) return;
      if (now - h.t0 < h.expect * 0.8) return;                 // (too quick to have been reeled in)
      delete lines[uid]; secret.delete(uid);
      const rec = board.records[h.kind];
      const mine = board.best[uid]?.[h.kind];
      const best = h.w > 0 && (!rec || h.w > rec.w);
      const r = run('INSERT INTO catches (user_id, kind, weight_oz, length_in, at, kept, spot, zone, note) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)',
        uid, h.kind, h.w, h.len, now, line.spot, sec!.zone, h.note ?? null);
      const id = Number(r.lastInsertRowid);
      const c: Catch = { id, uid, kind: h.kind, w: h.w, len: h.len, at: now, kept: null, ...(h.note ? { note: h.note } : {}) };
      reboard();
      pops[uid] = { kind: h.kind, w: h.w, len: h.len, at: now, what: 'catch', best };
      out.to(uid, { op: 'card', c, best, pb: h.w > 0 && !!mine && h.w > mine.w, first: !mine, perfect: !!d.perfect });
      for (const f of catchHooks) { try { f(c); } catch (e) { console.error('lake: a catch hook threw:', e); } }
      return tell();
    }
    case 'keep': {                                          // the catch card's answer: keep it, or let it go
      const id = Number(d.cid), keep = !!d.keep;
      const row = get<Row>('SELECT * FROM catches WHERE id = ? AND user_id = ?', id, uid);
      if (!row || row.kept !== null) return;
      run('UPDATE catches SET kept = ? WHERE id = ?', keep ? 1 : 0, id);
      if (!keep && row.weight_oz > 0) { luck[uid] = Math.min(MAX_LUCK, (luck[uid] ?? 0) + 1); out.save('luck', luck); }
      pops[uid] = { kind: row.kind, w: row.weight_oz, len: row.length_in, at: now, what: keep ? 'kept' : 'released' };
      reboard();
      return tell();
    }
  }
}

/** Anything of theirs still waiting on the catch card goes in the cooler (kept). */
function settle(uid: string) {
  run('UPDATE catches SET kept = 1 WHERE user_id = ? AND kept IS NULL', uid);
}

/** Every quarter second: casts landing, bites coming and going, reels left too long, and lines of anybody who has gone. */
function tick() {
  const now = Date.now();
  let changed = false;
  const here = new Set(out.present());
  for (const [uid, l] of Object.entries(lines)) {
    const sec = secret.get(uid);
    if (!here.has(uid) || !sec) { delete lines[uid]; secret.delete(uid); changed = true; continue; }
    if (l.phase === 'cast' && now >= l.t0 + l.ms) { l.phase = 'wait'; l.at = now; changed = true; }
    if (l.phase === 'wait' && now >= sec.biteAt) { l.phase = 'bite'; l.at = now; changed = true; }
    if (l.phase === 'bite' && now > l.at + BITE_MS + GRACE_MS) {      // missed it: it lets go; another will come along
      l.phase = 'wait'; l.at = now;
      sec.biteAt = now + biteWait(sec.zone, sec.light, sec.wx) * 0.6;
      pops[uid] = { at: now, what: 'missed' };
      changed = true;
    }
    if (l.phase === 'reel' && now > l.at + REEL_MAX_MS) { delete lines[uid]; secret.delete(uid); pops[uid] = { at: now, what: 'away' }; changed = true; }
  }
  for (const [uid, p] of Object.entries(pops)) if (now - p.at > 8000) { delete pops[uid]; }
  if (changed) tell();
}

const game: FitGame = {
  start(o) {
    out = o;
    luck = o.load<Record<string, number>>('luck', {});
    reboard();
    setInterval(tick, 250).unref?.();
  },
  hello: () => state(),
  message,
};
export default game;
