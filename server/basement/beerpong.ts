// Beer pong on the backyard's patio (the page is client/src/basement/pong.tsx, the throws client/src/basement/pong.ts).
//
// Two sides, red and blue, of one or two people each, each at its own end of the table behind its own ten cups. A turn:
// two balls (one each, with two on a side; both, alone). A ball in a cup takes the cup away; both balls of a turn in,
// and the balls come back for another turn. A ball bounced off the table into a cup takes two cups. Once a game each side may have the cups it throws at re-racked, when they
// are down to six (a triangle) or four (a diamond), before its turn's first ball. The side that clears the other's cups
// wins, after the rebuttal: the side whose last cup went keeps throwing (by turns, two to a side) until it misses, and
// if it clears every cup it had left, it is overtime: three cups a side, the side that cleared first throwing first.
// No hand is steady: a little of the power and aim chosen is changed here at random, and a ball on the rim may go in or
// spin out. Put away when nobody has thrown for five minutes, and fresh when the server starts.
import { fresh, rack, release, RERACK, shoot, thrower, tossMs, AIM_MAX } from '../../client/src/basement/pong.ts';
import type { Pong } from '../../client/src/basement/pong.ts';
import { gauss, joined, TEAMS } from '../../client/src/basement/yardgames.ts';
import type { FitGame, FitOut } from '../floor.ts';
import { achieve } from '../achievements.ts';

let out: FitOut;
let g: Pong = fresh();
const tell = () => out.all({ state: g });
const busy = () => Date.now() < g.busyUntil;
const name = (uid: string) => out.nameOf(uid);

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
      g = g.on && !g.over ? { ...fresh(), teams, last: `${name(uid)} left the game.` } : { ...g, teams };
      return tell();
    }
    case 'start': {
      if (!g.teams.some((m) => m.includes(uid)) || !g.teams[0].length || !g.teams[1].length || (g.on && !g.over)) return;
      g = { ...fresh(), teams: g.teams, on: true };
      g.turn = Math.random() < 0.5 ? 0 : 1;
      g.last = `${TEAMS[g.turn]} throws first.`;
      return tell();
    }
    case 'rerack': {
      const s = g.turn, target = g.cups[1 - s];
      if (!g.on || g.over || busy() || g.rebuttal || g.ot || g.shot !== 0 || g.hits !== 0 || g.reracked[s] || !g.teams[s].includes(uid) || !RERACK[target.length]) return;
      g.cups[1 - s] = rack(1 - s, RERACK[target.length]);
      g.reracked[s] = true;
      g.last = `${TEAMS[s]} asks for a re-rack: ${target.length === 6 ? 'a triangle' : 'a diamond'}.`;
      return tell();
    }
    case 'throw': {
      const aim = Number(d.aim), power = Number(d.power);
      const s = g.turn;
      if (!g.on || g.over || busy() || thrower(g, s) !== uid) return;
      if (!(Math.abs(aim) <= AIM_MAX) || !(power >= 0 && power <= 1)) return;
      const m = g.teams[s], k = m.length === 2 ? g.shot % 2 : 0;
      const toss = shoot(g.cups[1 - s], s, release(s, k, m.length), aim, power, [gauss(), gauss()], Math.random);
      const made = toss.end === 'cup';
      if (made) g.cups[1 - s] = g.cups[1 - s].filter((_, i) => i !== toss.cup && i !== toss.cup2);
      const who = name(uid);
      g.last = made ? toss.bounce ? `${who} bounces it in: two cups!` : (toss.rim ? `${who}: round the rim and in!` : `${who} sinks one.`) : toss.rim ? `${who}: in and out.` : toss.end === 'floor' ? `${who} misses the table.` : `${who} misses.`;
      if (g.rebuttal) {
        if (!made) { win(1 - s, `${who} misses the rebuttal.`); }
        else if (!g.cups[1 - s].length) {                       // they cleared them all: overtime, three cups a side
          g.ot++; g.rebuttal = false;
          achieve.award(uid, 'clutch');
          g.cups = [rack(0, [2, 1]), rack(1, [2, 1])];
          g.turn = 1 - s; g.shot = 0; g.hits = 0;
          g.last = `${who} clears them in rebuttal! Overtime: three cups each, ${TEAMS[g.turn]} first.`;
        } else g.shot++;
      } else {
        if (made) g.hits++;
        if (!g.cups[1 - s].length) {                             // the other side's last cup: their rebuttal
          g.rebuttal = true; g.turn = 1 - s; g.shot = 0; g.hits = 0;
          g.last = `${who} sinks the last cup! ${TEAMS[1 - s]}'s rebuttal: keep making them.`;
        } else if (g.shot === 0) g.shot = 1;
        else if (g.hits === 2) { g.shot = 0; g.hits = 0; g.last += ' Both in: balls back!'; }
        else { g.turn = 1 - s; g.shot = 0; g.hits = 0; }
      }
      g.busyUntil = Date.now() + tossMs(toss);      // (the page lets the next throw go once it has watched this one land)
      out.all({ op: 'toss', who: uid, team: s, from: toss.hops[0].from, toss, after: g });
      return;
    }
  }
}
function win(team: number, why: string) {
  g.over = true; g.on = false; g.winner = team; g.rebuttal = false;
  achieve.won('beerpong', g.teams[team], g.teams[1 - team]);
  g.last = `${why} ${TEAMS[team]} wins${g.ot ? ` in overtime` : ''}, with ${g.cups[team].length} cup${g.cups[team].length === 1 ? '' : 's'} left.`;
}

const inIt = (uid: string) => g.teams.some((m) => m.includes(uid));
const game: FitGame = {
  start(o) { out = o; },
  hello: () => g,
  reset() { g = fresh(); tell(); },
  going: () => (g.on && !g.over ? 'Beer Pong' : null),
  playing: (uid) => (inIt(uid) ? { game: 'Beer Pong', waiting: !g.on || g.over } : null),
  message,
};
export default game;
