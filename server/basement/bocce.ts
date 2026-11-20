// Bocce on the backyard's lawn (the page is client/src/basement/bocce.tsx, the rolls client/src/basement/bocce.ts).
//
// Two sides, red and green (the colours of the set's balls), of one or two people each, everybody at the end that is
// throwing. A frame: one side throws the pallino (it must stop on the court past its middle line, 12 feet out; if it does not, the other side tries, and if that fails too it
// is set in the middle), then its first ball; after that the side whose nearest ball is further from the pallino throws,
// until it is nearer or out of balls (level: the side that threw last goes again). Four balls a side, two each with two
// on a side. Then the side nearest scores a point for each of its balls nearer than the other side's nearest; it throws
// the pallino in the next frame, played back from the other end. Twelve wins. A ball rolled off the court is dead; the
// pallino knocked off it makes the frame dead, and it is played again from the same end. No hand is steady: a little of
// the power and aim chosen is changed here at random. Put away when nobody has thrown for five minutes, and fresh when
// the server starts.
import { BALLS, fresh, nearer, P_MID, pallinoOk, points, release, roll, SIDES as TEAMS, thrower, TO } from '../../client/src/basement/bocce.ts';
import type { Game } from '../../client/src/basement/bocce.ts';
import { gauss, joined } from '../../client/src/basement/yardgames.ts';
import type { FitGame, FitOut } from '../floor.ts';
import { achieve } from '../achievements.ts';

let out: FitOut;
let g: Game = fresh();
let clearing: ReturnType<typeof setTimeout> | null = null;
const tell = () => out.all({ state: g });
const busy = () => !!clearing || Date.now() < g.busyUntil;
/** The side whose pallino throw it is just now (the other side's, after one that failed). */
const pThrower = () => (g.tries === 1 ? 1 - g.first : g.first);

function later(ms: number, then: () => void) {
  const was = g;
  g.hold = true;
  clearing = setTimeout(() => { clearing = null; if (g !== was) return; g.hold = false; then(); tell(); }, ms);
  clearing.unref?.();
}

function message(uid: string, d: Record<string, unknown>) {
  switch (d.op) {
    case 'join': {
      const teams = joined(g, uid, Number(d.team));
      if (!teams) return;
      g = g.over ? { ...fresh(), teams } : { ...g, teams };
      return tell();
    }
    case 'leave': {
      if (!g.teams.some((m) => m.includes(uid))) return;
      const teams = g.teams.map((m) => m.filter((x) => x !== uid));
      if (g.on && !g.over) { if (clearing) clearTimeout(clearing); clearing = null; g = { ...fresh(), teams, last: `${out.nameOf(uid)} left the game.` }; }
      else g = { ...g, teams };
      return tell();
    }
    case 'start': {
      if (!g.teams.some((m) => m.includes(uid)) || !g.teams[0].length || !g.teams[1].length || (g.on && !g.over)) return;
      g = { ...fresh(), teams: g.teams, on: true, first: Math.random() < 0.5 ? 0 : 1 };
      g.turn = g.first;
      g.last = `${TEAMS[g.first]} throws the pallino.`;
      return tell();
    }
    case 'throw': {
      const aim = Number(d.aim), power = Number(d.power);
      if (!g.on || g.over || busy() || !(Math.abs(aim) <= 0.45) || !(power >= 0 && power <= 1)) return;
      const who = out.nameOf(uid);
      if (g.phase === 'pallino') {
        const side = pThrower();
        if (thrower(g, side) !== uid) return;
        const m = g.teams[side], k = Math.max(0, m.indexOf(uid));
        const r = roll({ pallino: null, balls: [] }, g.end, null, release(g.end, side, k), aim, power, [gauss(), gauss()]);
        const ms = r.roll.air + r.roll.ms;
        const ok = pallinoOk(r.pallino, r.pallinoOut, g.end);
        g.pallino = r.pallino;
        let hold = 0;
        if (ok) {
          g.phase = 'balls'; g.turn = g.first;
          g.last = `${who} sets the pallino. ${TEAMS[g.first]} to throw first.`;
        } else {
          g.tries++;
          g.last = g.tries === 1 ? `${who}'s pallino is no good. ${TEAMS[1 - g.first]} throws it instead.` : `No good again: it goes in the middle. ${TEAMS[g.first]} to throw first.`;
          hold = 1400;
          later(ms + hold, () => {
            if (g.tries >= 2) { g.pallino = { u: P_MID[0], v: P_MID[1] }; g.phase = 'balls'; g.turn = g.first; }
            else g.pallino = null;
          });
        }
        g.busyUntil = Date.now() + ms + hold;      // (nobody throws until it is set again)
        out.all({ op: 'roll', who: uid, team: side, pallino: true, roll: r.roll, after: g });
        return;
      }
      const team = g.turn;
      if (thrower(g, team) !== uid || g.thrown[team] >= BALLS) return;
      const k = g.teams[team].length === 2 ? g.thrown[team] % 2 : 0;
      const r = roll({ pallino: g.pallino, balls: g.balls }, g.end, team, release(g.end, team, k), aim, power, [gauss(), gauss()]);
      const ms = r.roll.air + r.roll.ms;
      g.balls = r.balls; g.thrown[team]++;
      const mine = r.balls[r.balls.length - 1];
      let hold = 0;
      if (r.pallinoOut) {
        hold = 2500;                                       // the pallino knocked off the court: the frame is dead
        g.pallino = null;
        g.last = `${who} knocks the pallino off the court! A dead frame: it is played again.`;
        later(ms + 2500, () => { g.balls = []; g.thrown = [0, 0]; g.phase = 'pallino'; g.tries = 0; g.turn = g.first; g.last = `${TEAMS[g.first]} throws the pallino.`; });
      } else {
        g.pallino = r.pallino;
        const n = nearer(g);
        g.last = mine.out ? `${who}'s ball rolls off the court.` : n.side === team ? `${who} is nearest.` : `${who} is not nearest.`;
        const left = [BALLS - g.thrown[0], BALLS - g.thrown[1]];
        if (left[0] + left[1] === 0) score(ms);
        else {
          const next = n.side < 0 ? team : 1 - n.side;          // whoever is further away (level: the last to throw)
          g.turn = left[next] > 0 ? next : 1 - next;
        }
      }
      g.busyUntil = Date.now() + ms + hold;
      out.all({ op: 'roll', who: uid, team, pallino: false, roll: r.roll, after: g });
      return;
    }
  }
}

function score(ms: number) {
  const p = points(g);
  g.frame = p;
  if (p.team >= 0 && p.pts > 0) {
    g.score[p.team] += p.pts;
    g.first = p.team;
    g.last = `${TEAMS[p.team]} scores ${p.pts}.`;
  } else g.last = 'Nobody scores.';
  if (g.score[0] >= TO || g.score[1] >= TO) {
    g.over = true; g.on = false; g.winner = g.score[0] > g.score[1] ? 0 : 1;
    g.last += ` ${TEAMS[g.winner]} wins, ${Math.max(...g.score)} to ${Math.min(...g.score)}!`;
    achieve.won('bocce', g.teams[g.winner], g.teams[1 - g.winner]);
    return;
  }
  later(ms + 4000, () => {
    g.balls = []; g.thrown = [0, 0]; g.pallino = null; g.phase = 'pallino'; g.tries = 0; g.frame = null;
    g.end = 1 - g.end; g.turn = g.first;
    g.last = `${TEAMS[g.first]} throws the pallino, from the ${g.end ? 'right' : 'left'}.`;
  });
}

const inIt = (uid: string) => g.teams.some((m) => m.includes(uid));
const game: FitGame = {
  start(o) { out = o; },
  hello: () => g,
  reset() { if (clearing) clearTimeout(clearing); clearing = null; g = fresh(); tell(); },
  going: () => (g.on && !g.over ? 'Bocce' : null),
  playing: (uid) => (inIt(uid) ? { game: 'Bocce', waiting: !g.on || g.over } : null),
  message,
};
export default game;
