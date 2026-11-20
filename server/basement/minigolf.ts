// Mini golf's turns and scorecard (its nine holes are laid out in three scenes past the backyard's gate,
// scripts/basement/_golf_art.py; client/src/basement/minigolf.tsx is the page; client/src/basement/golf.ts is the
// physics, golf-courses.json the nine holes).
//
// One to six players go round together, a hole at a time. Turns go round among those who have not holed out: each putt
// is played out here, once, and everybody is sent the same roll. The page sends where it aimed and how hard; the hand is
// never quite steady, so a little is added to both here. Water is a stroke's penalty, the ball going back where it was
// putted from. The balls lying on the green are in the way: a putt knocks them on, and each stays where it stops for
// its owner's next putt (a ball knocked into the water goes back where it lay, with no penalty; one knocked into the cup
// is holed for its owner, on the strokes they had taken). Seven strokes on a hole and the ball is picked up. When everyone is down, the next hole begins, whoever
// did best on the last one going first.
//
// The game can be put away (reset, below): it starts fresh when the server does, and floor.ts puts it away when nobody
// has putted for a while. Whatever it is handed to load is still made safe to play on (a card from the six-hole course
// is filled out to nine holes, the hole kept on the course, a ball that is no longer on the green put back on the tee).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inside, putt } from '../../client/src/basement/golf.ts';
import type { Hole } from '../../client/src/basement/golf.ts';
import type { FitGame, FitOut } from '../floor.ts';
import { achieve } from '../achievements.ts';

const HOLES = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'client', 'src', 'basement', 'golf-courses.json'), 'utf8')) as Hole[];
const MAX_STROKES = 7;
const EVERY = 8, FRAME_MS = (EVERY / 240) * 1000;
const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

type P = [number, number];
type Golf = { players: string[]; hole: number; strokes: number[][]; balls: (P | null)[]; done: boolean[]; turn: number; on: boolean; over: boolean; busyUntil: number; last: string };
const fresh = (): Golf => ({ players: [], hole: 0, strokes: [], balls: [], done: [], turn: 0, on: false, over: false, busyUntil: 0, last: '' });

/** A saved game made safe for the course as it is now: every list as long as the players, every card as long as the course. */
function sane(x: Partial<Golf> | null | undefined): Golf {
  if (!x || !Array.isArray(x.players)) return fresh();
  const players = x.players.filter((p): p is string => typeof p === 'string').slice(0, 6), n = players.length;
  if (!n) return fresh();
  const hole = Math.max(0, Math.min(HOLES.length - 1, Math.floor(Number(x.hole) || 0)));
  const h = HOLES[hole];
  const onGreen = (b: unknown): b is P => Array.isArray(b) && b.length === 2 && b.every(Number.isFinite) && inside(b as P, h.fairway) && !h.water.some((w) => inside(b as P, w));
  const g: Golf = {
    ...fresh(), players, hole,
    strokes: players.map((_, k) => HOLES.map((_, i) => { const s = Number(x.strokes?.[k]?.[i]); return Number.isFinite(s) ? Math.max(0, Math.min(MAX_STROKES + 1, s)) : 0; })),
    balls: players.map((_, k) => (onGreen(x.balls?.[k]) ? x.balls![k] : null)),
    done: players.map((_, k) => !!x.done?.[k]),
    turn: Math.max(0, Math.min(n - 1, Math.floor(Number(x.turn) || 0))),
    on: !!x.on, over: !!x.over, last: typeof x.last === 'string' ? x.last : '',
  };
  if (g.on && !g.over && g.done[g.turn] && !nextTurnIn(g)) g.done = players.map(() => false);   // (nobody left to putt: play the hole again)
  return g;
}

let out: FitOut;
let g: Golf = fresh();
const tell = () => { out.save('golf', { ...g, busyUntil: 0 }); out.all({ state: g }); };

function nextHole() {
  const prev = g.hole;
  g.hole++;
  if (g.hole >= HOLES.length) {
    g.hole = HOLES.length - 1; g.over = true; g.on = false; g.last = 'That is the round.';
    const par = HOLES.reduce((a, h) => a + h.par, 0);      // (achievements: a round under par)
    g.players.forEach((p, k) => { if (g.strokes[k].reduce((a, s) => a + s, 0) < par) achieve.award(p, 'underPar'); });
    return;
  }
  g.balls = g.players.map(() => null);
  g.done = g.players.map(() => false);
  // the honour: whoever did best on the last hole goes first
  let best = 0;
  g.players.forEach((_, k) => { if (g.strokes[k][prev] < g.strokes[best][prev]) best = k; });
  g.turn = best;
}
function nextTurnIn(x: Golf) {
  const n = x.players.length;
  for (let k = 1; k <= n; k++) { const i = (x.turn + k) % n; if (!x.done[i]) { x.turn = i; return true; } }
  return false;
}
const nextTurn = () => nextTurnIn(g);

/** What the room is told about a putt, as it is played out. */
function telling(who: string, roll: ReturnType<typeof putt>, s: number, par: number) {
  if (roll.result === 'holed') {
    const how = s === 1 ? 'a hole in one!' : s <= par - 2 ? 'an eagle!' : s === par - 1 ? 'a birdie.' : s === par ? 'par.' : s === par + 1 ? 'a bogey.' : `${s} strokes.`;
    return `${who}${roll.jumped ? ' clears the water and' : roll.piped ? ' comes out of the pipe and' : ''} drops it: ${how}`;
  }
  if (roll.result === 'water') return roll.jumped ? `${who} goes for the jump and comes down wet: a stroke's penalty.` : `${who} found the water: a stroke's penalty.`;
  if (roll.lipped) return `${who} lips out.`;
  if (roll.jumped) return `${who} clears the water.`;
  if (roll.piped) return `${who} goes down the pipe…`;
  return '';
}

function message(uid: string, d: Record<string, unknown>) {
  const at = g.players.indexOf(uid);
  switch (d.op) {
    case 'join': {
      if (at >= 0 || g.players.length >= 6 || (g.on && !g.over)) return;
      if (g.over) g = fresh();
      g.players.push(uid);
      return tell();
    }
    case 'leave': {
      if (at < 0) return;
      for (const list of [g.players, g.strokes, g.balls, g.done] as unknown[][]) list.splice(at, 1);
      if (!g.players.length) g = fresh();
      // (somebody before the one putting leaving moves everybody after them up one: the turn moves up with them)
      else if (g.on) { if (at < g.turn) g.turn--; if (g.turn >= g.players.length) g.turn = 0; if (g.done[g.turn] && !nextTurn()) nextHole(); }
      return tell();
    }
    case 'start': {
      if (at < 0 || (g.on && !g.over)) return;
      g = { ...fresh(), players: g.players, strokes: g.players.map(() => HOLES.map(() => 0)), balls: g.players.map(() => null), done: g.players.map(() => false), on: true };
      return tell();
    }
    case 'putt': {
      const angle = Number(d.angle), power = Number(d.power);
      if (!g.on || g.over || at !== g.turn || Date.now() < g.busyUntil || !Number.isFinite(angle) || Math.abs(angle) > 10 || !(power > 0 && power <= 1)) return;
      const hole = HOLES[g.hole], from = g.balls[at] ?? hole.tee, t0 = Date.now();
      // the other balls lying on the green are in the way: knocked, they roll on, and stay where they stop
      const lying = g.players.map((_, k) => k).filter((k) => k !== at && !g.done[k] && g.balls[k]);
      // the unsteady hand: a little under a degree either way, and a few per cent on the pace
      const roll = putt(hole, from, angle + gauss() * 0.014, Math.max(0.01, Math.min(1, power * (1 + gauss() * 0.04))), t0, EVERY, lying.map((k) => g.balls[k]!));
      g.strokes[at][g.hole] += roll.result === 'water' ? 2 : 1;
      const who = out.nameOf(uid);
      g.last = telling(who, roll, g.strokes[at][g.hole], hole.par);
      if (roll.result === 'holed') g.done[at] = true;
      if (roll.result === 'holed' && g.strokes[at][g.hole] === 1) { achieve.award(uid, 'ace'); if (hole.name === 'The Dogleg') achieve.award(uid, 'dogleg'); }
      else {
        g.balls[at] = roll.end;
        if (g.strokes[at][g.hole] >= MAX_STROKES) { g.strokes[at][g.hole] = MAX_STROKES; g.done[at] = true; g.last = `${who} picks up on ${MAX_STROKES}.`; }
      }
      // a knocked ball: where it stopped (back where it lay if it went in the water); knocked in, its owner is down on
      // the strokes they had taken
      for (const q of roll.knocked) {
        const k = lying[q.k], whose = out.nameOf(g.players[k]);
        if (q.result === 'holed') { g.done[k] = true; g.last = `${g.last} ${who} knocks ${whose}'s ball in: ${whose} is down in ${g.strokes[k][g.hole]}.`.trim(); }
        else g.balls[k] = q.end;
      }
      const knocked = roll.knocked.map((q) => ({ who: g.players[lying[q.k]], path: q.path, result: q.result }));
      const frames = Math.max(roll.path.length, ...knocked.map((q) => q.path.length));
      const ms = frames * FRAME_MS + (roll.result === 'holed' || knocked.some((q) => q.result === 'holed') ? 700 : 0);   // (and a moment to see it drop)
      g.busyUntil = Date.now() + ms + 300;
      const moved = !nextTurn();
      out.save('golf', { ...g, busyUntil: 0 });
      out.all({ op: 'putt', who: uid, path: roll.path, ms: FRAME_MS, t0, result: roll.result, hits: roll.hits, knocked });
      const same = g;                                         // (put away in the meantime: these do nothing)
      setTimeout(() => { if (g === same) tell(); }, ms + 50).unref?.();            // (the table as it now stands, once the ball has stopped)
      if (moved) {                                            // everyone is down: the next hole, a moment after the ball drops
        g.busyUntil = Date.now() + ms + 2000;
        // (not if the hole has moved on meanwhile: somebody leaving with everyone else down does that at once, and a
        // second go here had skipped a hole)
        const hole = g.hole;
        setTimeout(() => { if (g !== same || g.hole !== hole || !g.on) return; nextHole(); g.busyUntil = 0; tell(); }, ms + 1800).unref?.();
      }
      return;
    }
  }
}

const game: FitGame = {
  start(o) { out = o; g = sane(o.load<Golf>('golf', g)); g.busyUntil = 0; },
  hello: () => g,
  message,
  reset() { g = fresh(); tell(); },
  going: () => (g.on && !g.over ? 'Mini Golf' : null),
  playing: (uid) => (g.players.includes(uid) ? { game: 'Mini Golf', waiting: !g.on || g.over } : null),
};
export default game;
