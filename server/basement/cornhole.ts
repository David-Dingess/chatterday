// Cornhole at the campsite (the boards are drawn by scripts/basement/outside.py; the page is client/src/basement/cornhole.tsx,
// the throws client/src/basement/cornhole.ts).
//
// Two sides, red and blue, of one or two people each (one person may join both, to practise). Two on a side stand one
// at each end; one alone walks to whichever end is pitching. An inning: four bags each, thrown in turn from one end at
// the other board; then cancellation scoring (a bag in the hole 3, on the deck 1, and only the difference counts, to the
// side that had more), whoever scored throws first in the next, and the next inning is pitched back from the other end.
// First to 21 at the end of an inning wins. No hand is steady: a little of the power and the aim chosen is changed here at
// random. Put away when nobody has thrown for five minutes, and fresh when the server starts (reset; server/floor.ts).
import { BAGS, fresh, pitch, points, TEAMS, thrower, TO } from '../../client/src/basement/cornhole.ts';
import type { Game } from '../../client/src/basement/cornhole.ts';
import type { FitGame, FitOut } from '../floor.ts';
import { achieve } from '../achievements.ts';

let out: FitOut;
let g: Game = fresh();
let clearing: ReturnType<typeof setTimeout> | null = null;
const tell = () => out.all({ state: g });
const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const busy = () => !!clearing || Date.now() < g.busyUntil;

function message(uid: string, d: Record<string, unknown>) {
  switch (d.op) {
    case 'join': {                                       // onto a side (between games)
      const team = Number(d.team);
      if ((team !== 0 && team !== 1) || (g.on && !g.over) || g.teams[team].includes(uid) || g.teams[team].length >= 2) return;
      if (g.over) g = { ...fresh(), teams: g.teams };
      g.teams[team] = [...g.teams[team], uid];
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
      g.last = `${TEAMS[g.turn]} throws first.`;
      return tell();
    }
    case 'throw': {
      const aim = Number(d.aim), power = Number(d.power);
      if (!g.on || g.over || busy() || thrower(g, g.turn) !== uid || g.thrown[g.turn] >= BAGS) return;
      if (!(Math.abs(aim) <= 0.35) || !(power >= 0 && power <= 1)) return;
      const r = pitch(g.bags, g.end, g.turn, aim, power, [gauss(), gauss()]);
      const team = g.turn;
      g.bags = r.bags;
      g.thrown[team]++;
      const bag = r.bags[r.bags.length - 1];
      if (bag.at === 'hole') achieve.count(uid, 'cornhole');
      g.last = bag.at === 'hole' ? `${out.nameOf(uid)}: cornhole!` : bag.at === 'board' ? `${out.nameOf(uid)} is on the board.` : `${out.nameOf(uid)} missed the board.`;
      const ended = g.thrown[0] >= BAGS && g.thrown[1] >= BAGS;
      const ms = r.toss.flightMs + r.toss.slideMs;
      if (!ended) g.turn = g.thrown[1 - team] < BAGS ? 1 - team : team;
      else {                                                // the inning is over: cancellation scoring
        const p = points(g.bags), diff = p[0] - p[1];
        g.inning = p;
        if (diff) {
          const who = diff > 0 ? 0 : 1;
          g.score[who] += Math.abs(diff);
          g.first = who;
          g.last = `${p[0]} to ${p[1]}: ${TEAMS[who]} scores ${Math.abs(diff)}.`;
        } else g.last = `${p[0]} to ${p[1]}: they cancel out.`;
        if (g.score[0] >= TO || g.score[1] >= TO) {
          g.over = true; g.on = false; g.winner = g.score[0] > g.score[1] ? 0 : 1;
          g.last += ` ${TEAMS[g.winner]} wins, ${Math.max(...g.score)} to ${Math.min(...g.score)}!`;
          achieve.won('cornhole', g.teams[g.winner], g.teams[1 - g.winner]);
        }
      }
      g.busyUntil = Date.now() + ms + 250;
      out.all({ op: 'toss', who: uid, team, toss: r.toss, after: g });
      if (ended && !g.over) {                               // a moment to see how they lie, then the bags are picked up and it is pitched back
        const was = g;
        clearing = setTimeout(() => {
          clearing = null;
          if (g !== was) return;
          g.bags = []; g.thrown = [0, 0]; g.end = 1 - g.end; g.turn = g.first; g.inning = null; g.busyUntil = 0;
          g.last = `${TEAMS[g.turn]} throws first, from the ${g.end ? 'right' : 'left'}.`;
          tell();
        }, ms + 3500);
        clearing.unref?.();
      }
      return;
    }
  }
}

const inIt = (uid: string) => g.teams.some((m) => m.includes(uid));
const game: FitGame = {
  start(o) { out = o; },
  hello: () => g,
  reset() { if (clearing) clearTimeout(clearing); clearing = null; g = fresh(); tell(); },
  going: () => (g.on && !g.over ? 'Cornhole' : null),
  playing: (uid) => (inIt(uid) ? { game: 'Cornhole', waiting: !g.on || g.over } : null),
  message,
};
export default game;
