// Table shuffleboard's turns and score (the table is in the game room, scripts/basement/gameroom.py; the page is
// client/src/basement/shuffle.tsx; the physics client/src/basement/shuffle.ts).
//
// Two players, red and blue (one person may take both, to practise). They throw in turn, four weights each, every slide
// played out here once and sent to everybody; when all eight are down the round is scored, and whoever scored throws
// first in the next. First to 15 wins. No hand is steady: a throw arrives as the line and pace the player chose, and a
// little of each is changed here at random (one sigma is about half the 3 zone in length). When a round is scored the
// weights that counted are named (scored: their places in pucks, and points), for the page to ring them. A weight that
// stops short of the far foul line is taken off after its slide (the rules' "removed from the board"). A clear table
// when the server starts, and after five minutes nobody has thrown (reset; server/floor.ts).
import { FRAME_MS, HALF, LINES, past, R, score, slide } from '../../client/src/basement/shuffle.ts';
import type { Puck } from '../../client/src/basement/shuffle.ts';
import type { FitGame, FitOut } from '../floor.ts';
import { achieve } from '../achievements.ts';

const TO = 15;
type Board = { seats: (string | null)[]; pucks: Puck[]; turn: number; thrown: number[]; score: number[]; first: number; on: boolean; over: boolean; winner: number; last: string; busyUntil: number; scored: [number, number][] };
const fresh = (): Board => ({ seats: [null, null], pucks: [], turn: 0, thrown: [0, 0], score: [0, 0], first: 0, on: false, over: false, winner: -1, last: '', busyUntil: 0, scored: [] });
const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
/** The clear-up timer after a round, if one is waiting (a reset calls it off). */
let clearing: ReturnType<typeof setTimeout> | null = null;

let out: FitOut;
let b: Board = fresh();
const tell = () => { out.save('board', { ...b, busyUntil: 0 }); out.all({ state: b }); };
const names = ['Red', 'Blue'];

function message(uid: string, d: Record<string, unknown>) {
  switch (d.op) {
    case 'sit': {
      const seat = Number(d.seat);
      if ((seat !== 0 && seat !== 1) || b.seats[seat] || (b.on && !b.over)) return;
      b.seats[seat] = uid;
      return tell();
    }
    case 'leave': {
      if (!b.seats.includes(uid)) return;
      b.seats = b.seats.map((s) => (s === uid ? null : s));
      // a game given up, or the table left empty after one: the old score goes with it
      if (b.on && !b.over) b = { ...fresh(), seats: b.seats, last: `${out.nameOf(uid)} left the table.` };
      else if (!b.seats[0] && !b.seats[1]) b = fresh();
      return tell();
    }
    case 'start': {
      if (!b.seats.includes(uid) || !b.seats[0] || !b.seats[1] || (b.on && !b.over)) return;
      b = { ...fresh(), seats: b.seats, on: true, first: Math.random() < 0.5 ? 0 : 1 };
      b.turn = b.first;
      b.last = `${names[b.turn]} throws first.`;
      return tell();
    }
    case 'throw': {
      const y = Number(d.y), angle = Number(d.angle), power = Number(d.power);
      if (!b.on || b.over || b.seats[b.turn] !== uid || Date.now() < b.busyUntil || b.thrown[b.turn] >= 4) return;
      if (!(Math.abs(y) <= HALF - R) || !(Math.abs(angle) <= 0.12) || !(power >= 0 && power <= 1)) return;
      // no hand is quite steady
      const r = slide(b.pucks, b.turn, y, angle + gauss() * 0.004, Math.max(0, Math.min(1, power * (1 + gauss() * 0.012))));
      // a weight that has stopped short of the far foul line (or on it) is taken off, as in the rules: it cannot score,
      // and may not stay to guard the others (the page sees it go when the slide is over)
      const short = r.pucks.filter((p) => p.live && !past(p.x, LINES.one)).length;
      b.pucks = r.pucks.map((p) => (p.live && !past(p.x, LINES.one) ? { ...p, live: false } : p));
      b.thrown[b.turn]++;
      const ms = r.frames.length * FRAME_MS;
      b.last = short ? `Short of the line: ${short === 1 ? 'that weight comes' : `${short} weights come`} off.` : '';
      if (b.thrown[0] >= 4 && b.thrown[1] >= 4) {             // the round is over: score it
        const sc = score(b.pucks);
        b.scored = sc.scored;
        if (sc.who >= 0 && sc.points > 0) {
          b.score[sc.who] += sc.points;
          b.last = `${b.last} ${names[sc.who]} scores ${sc.points}.`.trim();
          b.first = sc.who;
        } else b.last = `${b.last} Nobody scores.`.trim();
        if (b.score[0] >= TO || b.score[1] >= TO) { b.over = true; b.on = false; b.winner = b.score[0] >= TO ? 0 : 1; b.last += ` ${names[b.winner]} wins!`; achieve.won('shuffle', [b.seats[b.winner] ?? ''], [b.seats[1 - b.winner] ?? '']); }
      } else b.turn = b.thrown[1 - b.turn] < 4 ? 1 - b.turn : b.turn;
      const ended = b.thrown[0] >= 4 && b.thrown[1] >= 4;
      // nobody throws again until the weights have stopped, nor, at the end of a round, until the table is cleared
      b.busyUntil = Date.now() + ms + (ended ? 3000 + 200 : 300);
      const after = { ...b };
      out.save('board', { ...b, busyUntil: 0 });
      out.all({ op: 'slide', who: uid, frames: r.frames, ms: FRAME_MS, after });
      if (ended && !b.over) {                                   // a moment to see where they lie, then the table is cleared for the next round
        const was = b;                                          // (not if the table has been put away meanwhile)
        clearing = setTimeout(() => { clearing = null; if (b !== was) return; b.pucks = []; b.scored = []; b.thrown = [0, 0]; b.turn = b.first; b.busyUntil = 0; b.last += ` ${names[b.turn]} throws first.`; tell(); }, ms + 3000);
        clearing.unref?.();
      }
      return;
    }
  }
}

const game: FitGame = {
  start(o) { out = o; b = o.load<Board>('board', b); b.busyUntil = 0; b.scored ??= []; },
  hello: () => b,
  reset() { if (clearing) clearTimeout(clearing); clearing = null; b = fresh(); tell(); },
  going: () => (b.on && !b.over ? 'Shuffleboard' : null),
  playing: (uid) => (b.seats.includes(uid) ? { game: 'Shuffleboard', waiting: !b.on || b.over } : null),
  message,
};
export default game;
