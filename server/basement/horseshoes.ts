// Horseshoes on the backyard's lawn (the page is client/src/basement/shoes.tsx, the pitches client/src/basement/shoes.ts).
//
// Two sides, red and blue, of one or two people each, the stakes 30 feet apart (shoes.ts). Two on a side stand one at each stake; one alone walks to the end
// that is pitching. An inning: two shoes each, the first pitcher pitching both and then the other, from one stake at the
// other; then cancellation scoring (shoes.ts points: ringers cancel ringers and leaners leaners; the side nearest scores
// a ringer 3, a leaner 1, a shoe within six inches 1), whoever scored pitches first in the next, and it is pitched back
// from the other end. First to 21 at the end of an inning wins. No hand is steady: a little of the power and aim chosen
// is changed here at random, and how a shoe meets the stake is partly luck. Put away when nobody has pitched for five
// minutes, and fresh when the server starts.
import { fresh, pitch, points, SHOES, thrower, TO } from '../../client/src/basement/shoes.ts';
import type { Game } from '../../client/src/basement/shoes.ts';
import { gauss, joined, TEAMS } from '../../client/src/basement/yardgames.ts';
import type { FitGame, FitOut } from '../floor.ts';
import { achieve } from '../achievements.ts';

let out: FitOut;
let g: Game = fresh();
let clearing: ReturnType<typeof setTimeout> | null = null;
const tell = () => out.all({ state: g });
const busy = () => !!clearing || Date.now() < g.busyUntil;

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
      g.last = `${TEAMS[g.turn]} pitches first.`;
      return tell();
    }
    case 'throw': {
      const aim = Number(d.aim), power = Number(d.power);
      if (!g.on || g.over || busy() || thrower(g, g.turn) !== uid || g.thrown[g.turn] >= SHOES) return;
      if (!(Math.abs(aim) <= 0.3) || !(power >= 0 && power <= 1)) return;
      const team = g.turn;
      const r = pitch(g.shoes, g.end, team, aim, power, [gauss(), gauss(), gauss()], Math.random);
      g.shoes = r.shoes;
      g.thrown[team]++;
      const shoe = r.shoes[r.shoes.length - 1], who = out.nameOf(uid);
      if (shoe.at === 'ringer') achieve.count(uid, 'ringer');
      g.last = shoe.at === 'ringer' ? `${who}: ringer!` : shoe.at === 'leaner' ? `${who}: a leaner.` : shoe.at === 'out' ? `${who} misses the pit.` : r.pitch.clank ? `${who} hits the stake.` : `${who} is in the pit.`;
      const ended = g.thrown[0] >= SHOES && g.thrown[1] >= SHOES;
      const ms = r.pitch.flightMs + r.pitch.settleMs;
      if (!ended) g.turn = g.thrown[team] < SHOES ? team : 1 - team;     // (both shoes, then the other side's)
      else {
        const p = points(g.shoes);
        g.inning = p;
        const who2 = p[0] > 0 ? 0 : p[1] > 0 ? 1 : -1;
        if (who2 >= 0) {
          g.score[who2] += p[who2];
          g.first = who2;
          g.last = `${TEAMS[who2]} scores ${p[who2]}.`;
        } else g.last = 'Nothing scores: they cancel out.';
        if (g.score[0] >= TO || g.score[1] >= TO) {
          g.over = true; g.on = false; g.winner = g.score[0] > g.score[1] ? 0 : 1;
          g.last += ` ${TEAMS[g.winner]} wins, ${Math.max(...g.score)} to ${Math.min(...g.score)}!`;
          achieve.won('horseshoes', g.teams[g.winner], g.teams[1 - g.winner]);
        }
      }
      g.busyUntil = Date.now() + ms;
      out.all({ op: 'toss', who: uid, team, pitch: r.pitch, after: g });
      if (ended && !g.over) {                                  // a moment to see how they lie, then they are picked up and pitched back
        const was = g;
        clearing = setTimeout(() => {
          clearing = null;
          if (g !== was) return;
          g.shoes = []; g.thrown = [0, 0]; g.end = 1 - g.end; g.turn = g.first; g.inning = null; g.busyUntil = 0;
          g.last = `${TEAMS[g.turn]} pitches first, from the ${g.end ? 'right' : 'left'}.`;
          tell();
        }, ms + 4000);
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
  going: () => (g.on && !g.over ? 'Horseshoes' : null),
  playing: (uid) => (inIt(uid) ? { game: 'Horseshoes', waiting: !g.on || g.over } : null),
  message,
};
export default game;
