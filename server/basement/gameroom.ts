// The game room's games (scripts/basement/gameroom.py draws the room; client/src/basement/gameroom.tsx is the page).
//
// Pool: 8-ball for two, on the engine in client/src/basement/pool.ts (from the secretof.life site). Two cues: either can
// be taken by anybody down there, or the second by the house (the engine's own player). A shot is played out here, once:
// everybody is sent the same roll, a frame every FRAME_MS, what was heard on the way (balls meeting, cushions, pockets:
// [frame, kind, strength]) and the table as it stands afterwards. The world's two sides, 'user' and 'ai', are the two cues:
// seat 0 and seat 1. The page sends an angle, a power and where the tip strikes the cue ball (spin, {x, y} in [-1, 1]);
// the hand is never quite steady (worse on a hard shot, worse again near the edge of the ball: a miscue), worked out here.
// While it lines up, the shooter's page sends 'aim' (the angle and how far the cue is drawn back) a few times a second,
// passed on to everybody and never saved, so the others can watch the cue; the house sends its own before it shoots.
//
// Darts: 301, 501, Cricket or Around the Clock, for one to four. The page sends where the sight was when they let go
// (on a board of radius 1: the outside of the double ring) and the throw's timing (`meter`, 0 to 1: 0.5 is a clean
// release; early or late drops the dart high or low). The dart lands where the sight was, moved by the timing and by a
// small wobble of the hand, worked out here. Three darts a turn. 301/501: a double (or the bull) to finish; a dart that
// would leave 1, go below nothing, or reach nothing without a double is a bust (the turn's score is put back).
// Cricket: 15 to 20 and the bull, three marks to close a number, marks past that score while anyone else has it open;
// all closed and not behind wins. Around the Clock: 1 to 20 in order, then the bull; a double moves on two, a treble
// three. Every dart is sent as it lands ('dart', with where it was aimed from, so the page can show it flying in), and
// the thrower's sight as 'aim', like pool's.
//
// Both start fresh when the server does, and either is put away after five minutes nobody has played it (reset, below;
// server/floor.ts).
import { aiShoot, BALL_R, cueOverlaps, initWorld, MAX_SHOT_SPEED, MIN_SHOT_SPEED, placeCue, PLAY_H, PLAY_W, resolveTurn, setPoolSoundSink, shoot, step } from '../../client/src/basement/pool.ts';
import type { PoolWorld } from '../../client/src/basement/pool.ts';
import type { FitGame, FitOut } from '../floor.ts';
import { achieve } from '../achievements.ts';

export const HOUSE = 'house';
const STEP_MS = 1000 / 240;                 // the engine's step
const FRAME_EVERY = 8;                      // a frame sent every 8 steps: 33ms
const FRAME_MS = STEP_MS * FRAME_EVERY;
const SOUNDS = { ball: 0, rail: 1, pocket: 2 } as const;

type Pool = { seats: (string | null)[]; world: PoolWorld | null; busyUntil: number };
type Mode = '301' | '501' | 'cricket' | 'clock';
type Dart = { x: number; y: number; pts: number; label: string };
type Darts = {
  players: string[]; scores: number[]; turn: number; darts: Dart[]; last: { who: string; darts: Dart[]; bust: boolean; total?: number } | null;
  start: number; on: boolean; winner: string | null;
  /** (absent on a game saved before there were modes: 301) */
  mode?: Mode;
  /** Cricket: each player's marks on 20, 19, 18, 17, 16, 15 and the bull (0 to 3) */
  marks?: number[][];
};
const MODES: Mode[] = ['301', '501', 'cricket', 'clock'];
const CRICKET = [20, 19, 18, 17, 16, 15, 25];

let out: FitOut;
const freshPool = (): Pool => ({ seats: [null, null], world: null, busyUntil: 0 });
const freshDarts = (mode: Mode = '301'): Darts => ({ players: [], scores: [], turn: 0, darts: [], last: null, start: 301, on: false, winner: null, mode, marks: [] });
let pool: Pool = freshPool();
let darts: Darts = freshDarts();

const state = () => ({ pool: { seats: pool.seats, world: pool.world, busyUntil: pool.busyUntil }, darts });
const save = () => { out.save('pool', { ...pool, busyUntil: 0 }); out.save('darts', darts); };
const tell = () => { save(); out.all({ state: state() }); };
const side = (seat: number) => (seat === 0 ? 'user' : 'ai') as 'user' | 'ai';
const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const num = (v: unknown, lo: number, hi: number) => { const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? n : null; };
/** Messages that only show what somebody is doing ('aim'): no more than about ten a second from anyone. */
const lastAim = new Map<string, number>();
const tooSoon = (uid: string, ms: number) => { const now = Date.now(), t = lastAim.get(uid) ?? 0; if (now - t < ms) return true; lastAim.set(uid, now); return false; };

// ── pool ──
function rack() {
  pool.world = initWorld(Math.random() < 0.5);
  pool.busyUntil = 0;
  tell();
  houseTurn(1500);
}
/** Play the shot just set going, send it to everybody, and settle the rules. */
function playOut(cue: { angle: number; power: number }) {
  const w = pool.world!;
  const who = pool.seats[w.turn === 'user' ? 0 : 1];
  const brk = w.isBreak;
  const snap = () => w.balls.flatMap((b) => (b.potted ? [-1, -1] : [Math.round(b.x * 10) / 10, Math.round(b.y * 10) / 10]));
  const frames: number[][] = [snap()];
  // what is heard on the way: the loudest of each kind in each frame, the faint ones left out
  const heard = new Map<string, [number, number, number]>();
  let n = 1;
  setPoolSoundSink((kind, s) => {
    if (s < 0.01) return;
    const f = Math.ceil(n / FRAME_EVERY), k = SOUNDS[kind], key = `${f}:${k}`, had = heard.get(key);
    if (!had || had[2] < s) heard.set(key, [f, k, Math.round(s * 100) / 100]);
  });
  try {
    for (; w.phase === 'shooting'; n++) {
      step(w, STEP_MS);
      if (n % FRAME_EVERY === 0) frames.push(snap());
    }
  } finally { setPoolSoundSink(null); }
  frames.push(snap());
  resolveTurn(w);
  if (brk && w.shot.potted.includes(8) && who) achieve.award(who, 'breakEight');      // (achievements: the 8 on the break, and a game won)
  if (w.phase === 'gameover' && w.result) { const [win, lose] = w.result.winner === 'user' ? pool.seats : [pool.seats[1], pool.seats[0]]; if (win && lose === HOUSE) achieve.award(win, 'house'); else if (win && lose) achieve.won('pool', [win], [lose]); }
  const sounds = [...heard.values()].sort((a, b) => a[0] - b[0]).slice(0, 60);
  const ms = Math.round(frames.length * FRAME_MS);
  pool.busyUntil = Date.now() + ms + 400 + 120;
  save();
  out.all({ op: 'shot', frames, ms: FRAME_MS, sounds, cue: { ...cue, brk }, who, after: state() });
  houseTurn(ms + 1600);
}
/** The house's go, when it is its turn: it puts the cue ball down if it has it in hand, lines the shot up where
 *  everybody can see (its cue drawn back, as a player's is), then plays it. The shot is chosen on a copy of the table
 *  (aiShoot), so what it shows is what it plays. */
function houseTurn(wait: number) {
  const w = pool.world;
  if (!w || w.phase !== 'aim' || pool.seats[1] !== HOUSE || w.turn !== 'ai') return;
  const still = () => pool.world === w && w.phase === 'aim' && w.turn === 'ai' && pool.seats[1] === HOUSE;
  setTimeout(() => {
    if (!still()) return;
    const t = JSON.parse(JSON.stringify(w)) as PoolWorld;
    aiShoot(t);
    if (t.phase !== 'shooting') return;
    const c = t.balls[0], angle = Math.atan2(c.vy, c.vx);
    const power = Math.max(0, Math.min(1, (Math.hypot(c.vx, c.vy) - MIN_SHOT_SPEED) / (MAX_SHOT_SPEED - MIN_SHOT_SPEED)));
    if (w.ballInHand) { placeCue(w, c.x, c.y); tell(); }
    const LINE = 900, STEPS = 9;
    for (let k = 1; k <= STEPS; k++) {
      setTimeout(() => { if (still()) out.all({ op: 'aim', game: 'pool', who: HOUSE, angle, pull: (power * k) / STEPS, spin: { x: 0, y: 0 } }); }, (LINE * k) / STEPS).unref?.();
    }
    setTimeout(() => {
      if (!still()) return;
      shoot(w, angle, power);
      if (w.phase === 'shooting') playOut({ angle, power });
    }, LINE + 250).unref?.();
  }, wait).unref?.();
}
function poolMessage(uid: string, d: Record<string, unknown>) {
  const mine = pool.seats.indexOf(uid);
  const w = pool.world;
  switch (d.op) {
    case 'sit': {
      const seat = Number(d.seat);
      if (mine >= 0 || (seat !== 0 && seat !== 1) || pool.seats[seat]) return;
      pool.seats[seat] = uid;
      if (pool.seats[0] && pool.seats[1] && (!w || w.phase === 'gameover')) return rack();
      return tell();
    }
    case 'house': {                                            // play the house: it takes the other cue
      if (mine < 0 || pool.seats[1 - mine]) return;
      if (mine === 0) pool.seats[1] = HOUSE;
      else { pool.seats = [uid, HOUSE]; }                     // (the house always plays as the second cue)
      return rack();
    }
    case 'leave': {
      if (mine < 0) return;
      pool.seats[mine] = null;
      if (pool.seats.every((s) => !s || s === HOUSE)) pool.seats = [null, null];
      pool.world = null;
      return tell();
    }
    case 'rack': {                                             // another game, once this one is over
      if (mine < 0 || !pool.seats[0] || !pool.seats[1] || (w && w.phase !== 'gameover')) return;
      return rack();
    }
    case 'place': {                                            // ball in hand: the cue ball put down
      const x = Number(d.x), y = Number(d.y);
      if (!w || mine < 0 || w.turn !== side(mine) || !w.ballInHand || w.phase !== 'aim' || Date.now() < pool.busyUntil) return;
      if (!(x >= BALL_R && x <= PLAY_W - BALL_R && y >= BALL_R && y <= PLAY_H - BALL_R) || cueOverlaps(w, x, y)) return;
      placeCue(w, x, y);
      return tell();
    }
    case 'aim': {                                              // lining up: shown to the others, never kept
      const angle = num(d.angle, -10, 10), pull = num(d.pull, 0, 1);
      if (!w || mine < 0 || w.turn !== side(mine) || w.phase !== 'aim' || angle == null || pull == null || tooSoon(`${uid}:pool`, 80)) return;
      const sp = d.spin as { x?: unknown; y?: unknown } | undefined;
      const sx = num(sp?.x, -1, 1) ?? 0, sy = num(sp?.y, -1, 1) ?? 0;
      return out.all({ op: 'aim', game: 'pool', who: uid, angle, pull, spin: { x: sx, y: sy } });
    }
    case 'shoot': {
      const angle = Number(d.angle), power = Number(d.power);
      if (!w || mine < 0 || w.turn !== side(mine) || w.phase !== 'aim' || Date.now() < pool.busyUntil) return;
      if (!Number.isFinite(angle) || !(power > 0 && power <= 1)) return;
      const sp = d.spin as { x?: unknown; y?: unknown } | undefined;
      let sx = Number(sp?.x ?? 0), sy = Number(sp?.y ?? 0);
      if (!Number.isFinite(sx) || !Number.isFinite(sy)) return;
      const off = Math.hypot(sx, sy);
      if (off > 1) { sx /= off; sy /= off; }
      // the hand: steadier on a gentle shot, and the tip may slip near the edge of the ball
      const sigma = 0.003 + 0.006 * power * power + (Math.hypot(sx, sy) > 0.7 ? 0.004 : 0);
      const a = angle + gauss() * sigma, p = Math.max(0.01, Math.min(1, power * (1 + gauss() * 0.03)));
      shoot(w, a, p, { x: sx, y: sy });
      return playOut({ angle: a, power: p });
    }
  }
}

// ── darts ──
const ORDER = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];
/** What a dart at (x, y) scores, on a board of radius 1 (the outside of the doubles; y down). Real proportions.
 *  `num` is the number hit (25 for either bull, 0 for a miss) and `mult` single, double or treble. */
export function scoreAt(x: number, y: number): { pts: number; label: string; num: number; mult: number } {
  const r = Math.hypot(x, y);
  if (r <= 0.037) return { pts: 50, label: 'Bull!', num: 25, mult: 2 };
  if (r <= 0.094) return { pts: 25, label: '25', num: 25, mult: 1 };
  if (r > 1) return { pts: 0, label: 'Miss', num: 0, mult: 0 };
  const deg = (Math.atan2(x, -y) * 180) / Math.PI;
  const n = ORDER[Math.floor((((deg + 9) % 360) + 360) % 360 / 18)];
  if (r >= 0.953) return { pts: n * 2, label: `D${n}`, num: n, mult: 2 };
  if (r >= 0.582 && r <= 0.629) return { pts: n * 3, label: `T${n}`, num: n, mult: 3 };
  return { pts: n, label: String(n), num: n, mult: 1 };
}
const WOBBLE = 0.045;           // the hand, either way: about the width of the treble ring (simulated: a careful thrower makes T20 about one in four)
/** Where a throw lands: where the sight was, dropped by the timing (a clean release is 0.5), and a small wobble. */
export function landing(ax: number, ay: number, meter: number) {
  return { x: ax + gauss() * WOBBLE, y: ay + (meter - 0.5) * 0.2 + gauss() * WOBBLE };
}
const modeOf = (d: Darts): Mode => d.mode ?? '301';
const startScore = (m: Mode) => (m === '501' ? 501 : m === 'cricket' ? 0 : m === 'clock' ? 1 : 301);

function endTurn(bust: boolean, total: number) {
  darts.last = { who: darts.players[darts.turn], darts: darts.darts, bust, total };
  darts.darts = [];
  darts.turn = (darts.turn + 1) % darts.players.length;
  darts.start = darts.scores[darts.turn];
}
/** The turn so far, as the mode counts it: points (301, 501, Cricket) or numbers moved on (Around the Clock). */
let turnTotal = 0;
function dartsMessage(uid: string, d: Record<string, unknown>) {
  const at = darts.players.indexOf(uid);
  const mode = modeOf(darts);
  switch (d.op) {
    case 'join': {                                             // between games, or before the first: the others stay
      if (at >= 0 || darts.players.length >= 4 || (darts.on && !darts.winner)) return;
      darts.players.push(uid);
      darts.scores.push(startScore(mode));
      darts.marks = [...(darts.marks ?? []), [0, 0, 0, 0, 0, 0, 0]];
      return tell();
    }
    case 'mode': {
      const m = d.mode as Mode;
      if (at < 0 || !MODES.includes(m) || (darts.on && !darts.winner)) return;
      darts.mode = m;
      return tell();
    }
    case 'leave': {
      if (at < 0) return;
      darts.players.splice(at, 1);
      darts.scores.splice(at, 1);
      darts.marks?.splice(at, 1);
      if (!darts.players.length) darts = freshDarts(mode);
      else if (darts.on && !darts.winner) {
        if (at < darts.turn) darts.turn--;
        darts.turn %= darts.players.length; darts.darts = []; darts.start = darts.scores[darts.turn]; turnTotal = 0;
      }
      return tell();
    }
    case 'start': {                                            // a new game, for everybody who has joined
      if (at < 0 || (darts.on && !darts.winner)) return;
      const s = startScore(mode);
      darts = { ...darts, mode, scores: darts.players.map(() => s), marks: darts.players.map(() => [0, 0, 0, 0, 0, 0, 0]), turn: 0, darts: [], last: null, start: s, on: true, winner: null };
      turnTotal = 0;
      return tell();
    }
    case 'aim': {                                              // the thrower's sight, for the others to watch
      const x = num(d.x, -1.6, 1.6), y = num(d.y, -1.6, 1.6);
      if (!darts.on || darts.winner || darts.players[darts.turn] !== uid || x == null || y == null || tooSoon(`${uid}:darts`, 100)) return;
      return out.all({ op: 'aim', game: 'darts', who: uid, x, y });
    }
    case 'throw': {
      const ax = num(d.x, -1.6, 1.6), ay = num(d.y, -1.6, 1.6);
      // (a page from before the timing meter sends none: it gets a release no better than chance)
      const meter = d.meter === undefined ? Math.random() : num(d.meter, 0, 1);
      if (!darts.on || darts.winner || darts.players[darts.turn] !== uid || darts.darts.length >= 3) return;
      if (ax == null || ay == null || meter == null) return;
      if (!darts.darts.length) turnTotal = 0;
      const { x, y } = landing(ax, ay, meter);
      const hit = scoreAt(x, y), dart: Dart = { x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000, pts: hit.pts, label: hit.label };
      darts.darts.push(dart);
      const k = darts.turn;
      let bust = false, won = false, label = hit.label;
      if (mode === 'cricket') {
        const marks = (darts.marks ??= darts.players.map(() => [0, 0, 0, 0, 0, 0, 0]));
        while (marks.length < darts.players.length) marks.push([0, 0, 0, 0, 0, 0, 0]);
        const i = CRICKET.indexOf(hit.num);
        if (i >= 0) {
          const had = marks[k][i], closing = Math.min(3 - had, hit.mult), extra = hit.mult - closing;
          marks[k][i] = had + closing;
          if (extra > 0 && marks.some((m, j) => j !== k && m[i] < 3)) { const p = extra * hit.num; darts.scores[k] += p; turnTotal += p; }
          if (had < 3 && marks[k][i] === 3) label = `${hit.label} closed`;
        } else if (hit.num) label = `${hit.label} (no use)`;
        won = marks[k].every((m) => m >= 3) && darts.scores.every((s, j) => j === k || darts.scores[k] >= s);
      } else if (mode === 'clock') {
        const target = darts.scores[k];
        if (target >= 21 ? hit.num === 25 : hit.num === target) {
          if (target >= 21) won = true;
          else { darts.scores[k] = Math.min(21, target + hit.mult); turnTotal += darts.scores[k] - target; }
        }
      } else {
        const left = darts.scores[k] - hit.pts, double = hit.mult === 2;
        if (left < 0 || left === 1 || (left === 0 && !double)) { bust = true; darts.scores[k] = darts.start; label = 'Bust!'; }
        else { darts.scores[k] = left; turnTotal += hit.pts; won = left === 0; }
      }
      const end = bust || won || darts.darts.length === 3;
      if (hit.label === 'Bull!') achieve.award(uid, 'bull'); else if (darts.darts.length === 3 && darts.darts.every((x) => x.label === 'T20')) achieve.award(uid, 'ton80');
      out.all({ op: 'dart', dart, from: { x: ax, y: ay }, who: uid, label, bust, won, end, total: bust ? 0 : turnTotal, mode });
      if (won) { darts.winner = uid; darts.last = { who: uid, darts: darts.darts, bust: false, total: turnTotal }; }
      else if (end) endTurn(bust, bust ? 0 : turnTotal);
      return tell();
    }
  }
}

const game: FitGame = {
  start(o) {
    out = o;
    pool = o.load<Pool>('pool', pool);
    darts = o.load<Darts>('darts', darts);
    pool.busyUntil = 0;
    houseTurn(4000);
  },
  hello: state,
  going(part) {
    if (part === 'pool') return pool.world && pool.world.phase !== 'gameover' ? 'Pool' : null;
    if (part === 'darts') return darts.on && !darts.winner ? 'Darts' : null;
    return null;
  },
  playing(uid) {
    if (pool.seats.includes(uid)) return { game: 'Pool', waiting: !pool.world || pool.world.phase === 'gameover' };
    if (darts.players.includes(uid)) return { game: 'Darts', waiting: !darts.on || !!darts.winner };
    return null;
  },
  reset(part) {
    if (part === 'pool') pool = freshPool();
    else if (part === 'darts') { darts = freshDarts(); turnTotal = 0; }
    else return;
    tell();
  },
  message(uid, d) {
    if (d.game === 'pool') poolMessage(uid, d);
    else if (d.game === 'darts') dartsMessage(uid, d);
  },
};
export default game;
