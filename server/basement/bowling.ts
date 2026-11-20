// Bowling's turns and scoresheet (the lane is in the game room, scripts/basement/gameroom.py; client/src/basement/bowling.tsx is the page;
// client/src/basement/bowling.ts the physics and the scoring).
//
// One to four bowl a game of ten frames, in turn: one frame each, then the next player. A throw arrives as where they
// stood, the line they chose, the power where they let the meter go and the hook they put on it; no hand is that steady,
// so a little of each is changed here at random (and more of the hook past 0.6: a big hook is hard to repeat), and the
// ball is rolled once, for everybody. While the bowler lines up, their page sends where they stand and aim (op 'aim', a
// few times a second), passed on to everybody else to draw; the meters are not sent. Strikes and spares, the
// tenth frame's extra balls, and the pins reset between frames: as at a real alley. A fresh
// lane when the server starts, and after five minutes nobody has bowled (reset; server/floor.ts).
import { FRAME_MS, LANE_HALF, roll, scores } from '../../client/src/basement/bowling.ts';
import type { FitGame, FitOut } from '../floor.ts';
import { achieve } from '../achievements.ts';

type Bowl = { players: string[]; rolls: number[][]; turn: number; frame: number; ball: number; standing: boolean[]; on: boolean; over: boolean; busyUntil: number; last: string };
const fresh = (): Bowl => ({ players: [], rolls: [], turn: 0, frame: 0, ball: 0, standing: Array(10).fill(true), on: false, over: false, busyUntil: 0, last: '' });
/** How unsteady the hook is: a little for a gentle one, much more for a big one. */
const hookNoise = (h: number) => 0.04 + 0.08 * Math.max(0, Math.min(1, (Math.abs(h) - 0.6) / 0.2));
let aimAt = 0;                                       // (the last 'aim' passed on: no more than about six a second)
const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

let out: FitOut;
let g: Bowl = fresh();
const tell = () => { out.save('bowl', { ...g, busyUntil: 0 }); out.all({ state: g }); };

function nextBowler() {
  g.ball = 0;
  g.standing = Array(10).fill(true);
  g.turn++;
  if (g.turn >= g.players.length) { g.turn = 0; g.frame++; }
  if (g.frame >= 10) { g.over = true; g.on = false; }
}

function message(uid: string, d: Record<string, unknown>) {
  const at = g.players.indexOf(uid);
  switch (d.op) {
    case 'join': {
      if (at >= 0 || g.players.length >= 4 || (g.on && !g.over)) return;
      if (g.over) g = { ...fresh(), players: g.players, rolls: g.players.map(() => []) };      // (a new game, with whoever played the last)
      g.players.push(uid);
      return tell();
    }
    case 'leave': {
      if (at < 0) return;
      g.players.splice(at, 1); g.rolls.splice(at, 1);
      if (!g.players.length) g = fresh();
      else if (g.on && g.turn >= at) { if (g.turn > at) g.turn--; else { g.turn--; nextBowler(); } }
      return tell();
    }
    case 'start': {
      if (at < 0 || (g.on && !g.over)) return;
      g = { ...fresh(), players: g.players, rolls: g.players.map(() => []), on: true };
      return tell();
    }
    case 'aim': {
      const x = Number(d.x), aim = Number(d.aim), now = Date.now();
      if (!g.on || g.over || at !== g.turn || now < g.busyUntil || now - aimAt < 150) return;
      if (!Number.isFinite(x) || !Number.isFinite(aim) || Math.abs(x) > LANE_HALF || Math.abs(aim) > LANE_HALF + 4) return;
      aimAt = now;
      out.all({ op: 'aim', who: uid, x, aim });
      return;
    }
    case 'bowl': {
      const x = Number(d.x), angle = Number(d.angle), power = Number(d.power), hook = Number(d.hook);
      if (!g.on || g.over || at !== g.turn || Date.now() < g.busyUntil) return;
      if (![x, angle, power, hook].every(Number.isFinite) || Math.abs(x) > LANE_HALF || Math.abs(angle) > 0.2 || power < 0 || power > 1 || Math.abs(hook) > 1) return;
      // no hand is quite steady
      const r = roll({ x, angle: angle + gauss() * 0.0015, power: Math.max(0, Math.min(1, power + gauss() * 0.04)), hook: Math.max(-1, Math.min(1, hook + gauss() * hookNoise(hook))) }, g.standing);
      const before = g.standing.filter(Boolean).length, knocked = r.down.length;
      g.rolls[at].push(knocked);
      for (const i of r.down) g.standing[i] = false;
      const who = out.nameOf(uid);
      const tenth = g.frame === 9 ? g.rolls[at].slice(g.rolls[at].length - g.ball - 1) : [];
      const all = knocked === before;
      g.last = r.gutter ? `${who}: gutter ball.` : all && before === 10 ? `${who}: STRIKE!` : all ? `${who}: spare!` : `${who}: ${knocked || 'no'} pin${knocked === 1 ? '' : 's'}.`;
      if (g.frame < 9) {
        if (g.ball === 0 && !all) g.ball = 1;
        else nextBowler();
      } else {                                               // the tenth: a strike or a spare earns a third ball, on a fresh rack
        const [a, b] = tenth;
        if (g.ball === 0) { g.ball = 1; if (a === 10) g.standing = Array(10).fill(true); }
        else if (g.ball === 1) {
          if (a === 10 || a + b === 10) { g.ball = 2; if (g.standing.every((s) => !s)) g.standing = Array(10).fill(true); }
          else nextBowler();
        } else nextBowler();
      }
      achieve.streak(uid, 'strike', all && before === 10); if (r.gutter) achieve.award(uid, 'gutter');      // (achievements)
      if (g.over) g.players.forEach((p, k) => { if ((scores(g.rolls[k]).at(-1) ?? 0) >= 200) achieve.award(p, 'bowl200'); });
      const ms = r.frames.length * FRAME_MS;
      g.busyUntil = Date.now() + ms + 500;
      out.save('bowl', { ...g, busyUntil: 0 });
      out.all({ op: 'roll', who: uid, frames: r.frames, ms: FRAME_MS, after: g });
      return;
    }
  }
}

const game: FitGame = {
  start(o) { out = o; g = o.load<Bowl>('bowl', g); g.busyUntil = 0; },
  hello: () => g,
  reset() { g = fresh(); tell(); },
  going: () => (g.on && !g.over ? 'Bowling' : null),
  playing: (uid) => (g.players.includes(uid) ? { game: 'Bowling', waiting: !g.on || g.over } : null),
  message,
};
export default game;
