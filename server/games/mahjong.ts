// Mahjong, the Hong Kong way, cut down to what a first game needs (no flower tiles, and any finished hand may win).
//
// There are 136 tiles: three suits numbered 1 to 9 (dots, bamboo, characters), four winds and three dragons, four of
// each. Everybody holds 13. On your turn you draw one and throw one away, and you are trying to finish a hand of
// FOUR SETS AND A PAIR. A set is a chow (three in a row in one suit), a pung (three the same) or a kong (four the
// same, which earns an extra tile). The one odd hand that also wins is thirteen orphans: one of each 1, 9, wind and
// dragon, and a second of any of them.
//
// A tile somebody throws away can be claimed before the next player draws:
//   - to win with, by anybody;
//   - for a pung or a kong, by anybody who holds two (or three) of it;
//   - for a chow, only by the player whose turn is next.
// A win beats a pung, a pung beats a chow, and of two winners the one whose turn would come first gets it. A claimed
// set is laid face up, and whoever claimed throws a tile and play goes on from them.
//
// A winning hand is worth "faan" for its patterns (see `scoreHand`), and faan turn into points (`BASE`). If the
// winning tile was thrown away, the thrower pays double and the other two pay single; if the winner drew it, all
// three pay double. A game here is four hands, the deal passing round once. The wall running out is a drawn hand.
//
// A tile is a number: 0 to 8 dots, 9 to 17 bamboo, 18 to 26 characters, 27 to 30 the winds (east, south, west,
// north), 31 the red dragon, 32 the green, 33 the white.
//
// This file also works out the help a learner is shown (`hint`): how many tiles a hand is from being "ready" (one
// tile from winning), and which throws and which draws bring it closer. The computer players use the same sums.
import { shuffle } from './cards.ts';
import type { Result, Rng, Rules } from './cards.ts';

export const HANDS = 4;
/** Points for 0 faan, 1 faan, and so on up to the limit of 13. */
export const BASE = [1, 2, 4, 8, 16, 24, 32, 48, 64, 96, 128, 192, 256, 384];
export const LIMIT = 13;

export type Meld = { kind: 'chow' | 'pung' | 'kong'; tiles: number[]; /** whose throw it was claimed from (-1: all their own) */ from: number; /** face up */ open: boolean };
type Options = { win: boolean; kong: boolean; pung: boolean; chows: number[][] };
type Answer = { a: 'pass' | 'win' | 'pung' | 'kong' | 'chow'; use?: number[] };
type Line = { name: string; faan: number };
type Summary = {
  winner: number; from: number; tile: number; lines: Line[]; faan: number; base: number; pay: number[];
  /** The winning hand, set by set (empty for thirteen orphans), and everybody's tiles turned over. */
  sets: { tiles: number[]; open: boolean }[]; pair: number[]; hands: number[][];
};
export type Mahjong = {
  phase: 'turn' | 'claim' | 'handEnd' | 'over'; handNo: number; dealer: number; turn: number;
  wall: number[]; hands: number[][]; melds: Meld[][]; discards: number[][];
  /** What the player whose turn it is has just drawn (null: they claimed a tile instead), and whether a kong earned it. */
  drew: number | null; kongDraw: boolean;
  /** The thrown tile lying on the table, and what each of the others may do with it and has said. */
  last: { seat: number; tile: number } | null;
  claim: { tile: number; from: number; options: (Options | null)[]; answers: (Answer | null)[] } | null;
  /** The last thing anybody called out. */
  said: { seat: number; what: 'chow' | 'pung' | 'kong'; tile: number } | null;
  scores: number[]; summary: Summary | null;
};

const WIND_NAMES = ['East', 'South', 'West', 'North'];
const DRAGON_NAMES = ['Red', 'Green', 'White'];
const ORPHANS = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33];
const asc = (a: number, b: number) => a - b;
const isTile = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 34;
export const tally = (tiles: number[]) => { const c = new Array<number>(34).fill(0); for (const t of tiles) c[t]++; return c; };
/** The wind a seat has this hand: 0 east (the dealer), then south, west, north in turn order. */
export const windOf = (s: { dealer: number }, seat: number) => (seat - s.dealer + 4) % 4;
function take(hand: number[], tile: number, n = 1) { for (let k = 0; k < n; k++) hand.splice(hand.indexOf(tile), 1); }

// ───────── is it a winning hand, and how can it be split ─────────
/** Every way of splitting these tiles into `need` sets and a pair, using all of them. */
export function splits(c: number[], need: number) {
  const out: { pair: number; sets: number[][] }[] = [], sets: number[][] = [];
  let pair = -1;
  const go = (from: number) => {
    let i = from;
    while (i < 34 && !c[i]) i++;
    if (i === 34) { if (pair >= 0 && sets.length === need) out.push({ pair, sets: sets.map((x) => x.slice()) }); return; }
    if (c[i] >= 2 && pair < 0) { c[i] -= 2; pair = i; go(i); pair = -1; c[i] += 2; }
    if (sets.length >= need) return;
    if (c[i] >= 3) { c[i] -= 3; sets.push([i, i, i]); go(i); sets.pop(); c[i] += 3; }
    if (i < 27 && i % 9 <= 6 && c[i + 1] && c[i + 2]) {
      c[i]--; c[i + 1]--; c[i + 2]--; sets.push([i, i + 1, i + 2]);
      go(i);
      sets.pop(); c[i]++; c[i + 1]++; c[i + 2]++;
    }
  };
  go(0);
  return out;
}
const orphans = (c: number[]) => ORPHANS.every((t) => c[t] >= 1) && ORPHANS.reduce((n, t) => n + c[t], 0) === 14;
/** Whether these tiles, with `melds` sets already laid down, are a finished hand. */
export function wins(tiles: number[], melds: number) {
  if (tiles.length !== 14 - 3 * melds) return false;
  const c = tally(tiles);
  return splits(c, 4 - melds).length > 0 || (melds === 0 && orphans(c));
}

// ───────── how far a hand is from winning ─────────
/** How many tiles have to change before the hand is ready (0: one tile from winning; -1: it has won). `fixed` is the
 *  number of sets laid down. The sum: every set is two tiles nearer, every pair or two-tiles-of-a-run is one nearer,
 *  and only as many of those count as there are sets still to make. */
export function away(c: number[], fixed: number): number {
  let best = 8;
  const go = (from: number, sets: number, parts: number, pair: number) => {
    let i = from;
    while (i < 34 && !c[i]) i++;
    if (i === 34) {
      const v = 8 - 2 * sets - Math.min(parts, 4 - sets) - pair;
      if (v < best) best = v;
      return;
    }
    const run = i < 27, n = i % 9;
    if (c[i] >= 3) { c[i] -= 3; go(i, sets + 1, parts, pair); c[i] += 3; }
    if (run && n <= 6 && c[i + 1] && c[i + 2]) { c[i]--; c[i + 1]--; c[i + 2]--; go(i, sets + 1, parts, pair); c[i]++; c[i + 1]++; c[i + 2]++; }
    if (c[i] >= 2) {
      c[i] -= 2;
      if (!pair) go(i, sets, parts, 1);
      go(i, sets, parts + 1, pair);
      c[i] += 2;
    }
    if (run && n <= 7 && c[i + 1]) { c[i]--; c[i + 1]--; go(i, sets, parts + 1, pair); c[i]++; c[i + 1]++; }
    if (run && n <= 6 && c[i + 2]) { c[i]--; c[i + 2]--; go(i, sets, parts + 1, pair); c[i]++; c[i + 2]++; }
    const k = c[i];                                           // or this tile is part of nothing
    c[i] = 0; go(i + 1, sets, parts, pair); c[i] = k;
  };
  go(0, fixed, 0, 0);
  if (fixed === 0) {                                          // thirteen orphans: one of each, and any second one
    const kinds = ORPHANS.filter((t) => c[t]).length;
    best = Math.min(best, 13 - kinds - (ORPHANS.some((t) => c[t] >= 2) ? 1 : 0));
  }
  return best;
}
/** The tiles that would bring a hand of 13 (or 10, 7...) closer, and how many of them `unseen` says are still about. */
function helpers(c: number[], fixed: number, unseen: number[]) {
  const now = away(c, fixed), tiles: number[] = [];
  let left = 0;
  for (let t = 0; t < 34; t++) {
    if (c[t] >= 4) continue;
    // only a tile next to something held, or an orphan, can help: skip the rest without doing the sum
    const near = c[t] > 0 || (t < 27 && ((t % 9 > 0 && c[t - 1]) || (t % 9 < 8 && c[t + 1]) || (t % 9 > 1 && c[t - 2]) || (t % 9 < 7 && c[t + 2])));
    if (!near && !(fixed === 0 && ORPHANS.includes(t))) continue;
    c[t]++;
    if (away(c, fixed) < now) { tiles.push(t); left += unseen[t]; }
    c[t]--;
  }
  return { tiles, left };
}
/** How many of each tile this seat cannot see: not in its hand, not thrown away, not laid face up. */
function unseenBy(s: Mahjong, seat: number) {
  const u = new Array<number>(34).fill(4);
  for (const t of s.hands[seat]) u[t]--;
  for (const pile of s.discards) for (const t of pile) u[t]--;
  s.melds.forEach((ms, i) => { for (const m of ms) if (m.open || i === seat) for (const t of m.tiles) u[t]--; });
  return u.map((n) => Math.max(0, n));
}
type Throw = { tile: number; away: number; helps: number[]; left: number };
/** For a hand that has to throw a tile: what each different throw leaves, the best first. */
function throwsOf(s: Mahjong, seat: number): Throw[] {
  const c = tally(s.hands[seat]), fixed = s.melds[seat].length, unseen = unseenBy(s, seat), out: Throw[] = [];
  for (let t = 0; t < 34; t++) {
    if (!c[t]) continue;
    c[t]--;
    const h = helpers(c, fixed, unseen);
    out.push({ tile: t, away: away(c, fixed), helps: h.tiles, left: h.left });
    c[t]++;
  }
  // nearest first, then the most tiles that help; between equals, let go of a wind or dragon, then a 1 or 9
  const loose = (t: number) => (t >= 27 ? 2 : t % 9 === 0 || t % 9 === 8 ? 1 : 0);
  return out.sort((a, b) => a.away - b.away || b.left - a.left || loose(b.tile) - loose(a.tile));
}
/** What claiming would leave: how far the hand would be after laying the set down (and, for a pung or chow, throwing its best tile). */
function awayAfter(hand: number[], fixed: number, used: number[]) {
  const c = tally(hand);
  for (const t of used) c[t]--;
  return away(c, fixed + 1);
}

// ───────── scoring ─────────
/** The faan a winning hand is worth: the best of every way it can be read. `concealed` includes the winning tile. */
export function scoreHand(s: Mahjong, seat: number, concealed: number[], selfDrawn: boolean) {
  const melds = s.melds[seat], c = tally(concealed);
  const lastTile = s.wall.length === 0;
  const extras: Line[] = [];
  if (selfDrawn) extras.push({ name: 'Drew the winning tile yourself', faan: 1 });
  if (melds.every((m) => !m.open)) extras.push({ name: 'Concealed hand: nothing claimed', faan: 1 });
  if (selfDrawn && s.kongDraw) extras.push({ name: 'Won on the extra tile from a kong', faan: 1 });
  if (lastTile) extras.push({ name: 'Won on the last tile', faan: 1 });
  const total = (lines: Line[]) => Math.min(LIMIT, lines.reduce((n, l) => n + l.faan, 0));
  type Read = { lines: Line[]; faan: number; sets: { tiles: number[]; open: boolean }[]; pair: number[] };
  let best: Read | null = null;
  if (!melds.length && orphans(c)) best = { lines: [{ name: 'Thirteen orphans', faan: 13 }], faan: 13, sets: [], pair: [] };
  const all = [...concealed, ...melds.flatMap((m) => m.tiles)];
  const suits = new Set(all.filter((t) => t < 27).map((t) => Math.floor(t / 9)));
  const honours = all.some((t) => t >= 27);
  for (const sp of splits(c, 4 - melds.length)) {
    const sets = [...melds.map((m) => ({ tiles: m.tiles, open: m.open })), ...sp.sets.map((tiles) => ({ tiles, open: false }))];
    const pungs = sets.filter((x) => x.tiles[0] === x.tiles[1]).map((x) => x.tiles[0]);
    const lines: Line[] = [];
    if (suits.size === 0) lines.push({ name: 'All winds and dragons', faan: 10 });
    else if (suits.size === 1) lines.push(honours ? { name: 'One suit with winds or dragons', faan: 3 } : { name: 'All one suit', faan: 7 });
    if (pungs.length === 4) lines.push({ name: 'All pungs', faan: 3 });
    else if (pungs.length === 0) lines.push({ name: 'All chows', faan: 1 });
    const dragons = pungs.filter((t) => t >= 31), winds = pungs.filter((t) => t >= 27 && t <= 30);
    if (dragons.length === 3) lines.push({ name: 'Great three dragons', faan: 8 });
    else if (dragons.length === 2 && sp.pair >= 31) lines.push({ name: 'Small three dragons', faan: 5 });
    else for (const t of dragons) lines.push({ name: `Pung of ${DRAGON_NAMES[t - 31]} dragons`, faan: 1 });
    if (winds.length === 4) lines.push({ name: 'Great four winds', faan: 13 });
    else if (winds.length === 3 && sp.pair >= 27 && sp.pair <= 30) lines.push({ name: 'Small four winds', faan: 6 });
    else {
      const mine = 27 + windOf(s, seat);
      if (winds.includes(mine)) lines.push({ name: `Pung of your own wind (${WIND_NAMES[mine - 27]})`, faan: 1 });
      if (winds.includes(27)) lines.push({ name: 'Pung of the round wind (East)', faan: 1 });
    }
    lines.push(...extras);
    const faan = total(lines);
    if (!best || faan > best.faan) best = { lines, faan, sets, pair: [sp.pair, sp.pair] };
  }
  return best!;
}

// ───────── the flow of a hand ─────────
function deal(s: Mahjong, rng: Rng) {
  const wall: number[] = [];
  for (let t = 0; t < 34; t++) wall.push(t, t, t, t);
  s.wall = shuffle(wall, rng);
  s.hands = [0, 1, 2, 3].map(() => s.wall.splice(-13).sort(asc));
  s.melds = [[], [], [], []];
  s.discards = [[], [], [], []];
  s.claim = null; s.said = null; s.last = null; s.summary = null;
  draw(s, s.dealer, false);
}
/** The hand is over: somebody won (see `finish`), or the wall ran out. */
function endHand(s: Mahjong, summary: Summary) {
  s.summary = summary;
  s.claim = null;
  s.drew = null;
  s.phase = s.handNo + 1 >= HANDS ? 'over' : 'handEnd';
}
const reveal = (s: Mahjong) => s.hands.map((h) => h.slice());
function draw(s: Mahjong, seat: number, kong: boolean) {
  s.claim = null;
  if (!s.wall.length) return endHand(s, { winner: -1, from: -1, tile: -1, lines: [], faan: 0, base: 0, pay: [0, 0, 0, 0], sets: [], pair: [], hands: reveal(s) });
  const t = kong ? s.wall.shift()! : s.wall.pop()!;            // a kong's extra tile comes off the other end of the wall
  s.hands[seat].push(t);
  s.hands[seat].sort(asc);
  s.drew = t;
  s.kongDraw = kong;
  s.turn = seat;
  s.phase = 'turn';
}
function finish(s: Mahjong, winner: number, from: number, tile: number) {
  const concealed = from >= 0 ? [...s.hands[winner], tile].sort(asc) : s.hands[winner].slice();
  const sc = scoreHand(s, winner, concealed, from < 0);
  const base = BASE[sc.faan], pay = [0, 0, 0, 0];
  for (let i = 0; i < 4; i++) {
    if (i === winner) continue;
    const owes = from < 0 || i === from ? base * 2 : base;
    pay[i] -= owes;
    pay[winner] += owes;
  }
  pay.forEach((p, i) => { s.scores[i] += p; });
  const hands = reveal(s);
  hands[winner] = concealed;
  endHand(s, { winner, from, tile, lines: sc.lines, faan: sc.faan, base, pay, sets: sc.sets, pair: sc.pair, hands });
}
/** The pairs of tiles in a hand that make a run with `tile`. */
function chowsWith(hand: number[], tile: number) {
  if (tile >= 27) return [];
  const n = tile % 9, out: number[][] = [];
  for (const [a, b] of [[-2, -1], [-1, 1], [1, 2]]) {
    if (n + a < 0 || n + b > 8) continue;
    if (hand.includes(tile + a) && hand.includes(tile + b)) out.push([tile + a, tile + b]);
  }
  return out;
}
/** A tile has been thrown: who may claim it? If nobody can, the next player draws. */
function offer(s: Mahjong, from: number, tile: number) {
  const lastTile = s.wall.length === 0;                      // the very last throw can only be claimed to win
  const options = [0, 1, 2, 3].map((seat): Options | null => {
    if (seat === from) return null;
    const hand = s.hands[seat], held = hand.filter((x) => x === tile).length;
    const o: Options = {
      win: wins([...hand, tile], s.melds[seat].length), kong: !lastTile && held === 3, pung: !lastTile && held >= 2,
      chows: !lastTile && seat === (from + 1) % 4 ? chowsWith(hand, tile) : [],
    };
    return o.win || o.pung || o.chows.length ? o : null;
  });
  if (options.every((o) => !o)) return draw(s, (from + 1) % 4, false);
  s.claim = { tile, from, options, answers: [null, null, null, null] };
  s.phase = 'claim';
}
const RANK = { pass: 0, chow: 1, pung: 2, kong: 2, win: 3 };
/** Somebody has answered: once nobody still thinking could beat the strongest call, it is settled. */
function settleClaim(s: Mahjong) {
  const cl = s.claim!;
  const turnsAway = (seat: number) => (seat - cl.from + 4) % 4;
  let best = -1;
  for (let i = 0; i < 4; i++) {
    const a = cl.answers[i];
    if (!a || a.a === 'pass') continue;
    if (best < 0 || RANK[a.a] > RANK[cl.answers[best]!.a] || (RANK[a.a] === RANK[cl.answers[best]!.a] && turnsAway(i) < turnsAway(best))) best = i;
  }
  for (let i = 0; i < 4; i++) {
    const o = cl.options[i];
    if (!o || cl.answers[i]) continue;                       // (this one is still thinking)
    if (best < 0) return;
    const could = o.win ? 3 : o.pung ? 2 : 1, has = RANK[cl.answers[best]!.a];
    if (could > has || (could === 3 && has === 3 && turnsAway(i) < turnsAway(best))) return;
  }
  if (best < 0) return draw(s, (cl.from + 1) % 4, false);
  const a = cl.answers[best]!, t = cl.tile, hand = s.hands[best];
  if (a.a === 'win') return finish(s, best, cl.from, t);
  s.discards[cl.from].pop();                                 // the tile leaves the thrower's pile for the claimer's set
  s.last = null;
  s.claim = null;
  s.said = { seat: best, what: a.a as 'chow' | 'pung' | 'kong', tile: t };
  if (a.a === 'kong') {
    take(hand, t, 3);
    s.melds[best].push({ kind: 'kong', tiles: [t, t, t, t], from: cl.from, open: true });
    return draw(s, best, true);
  }
  if (a.a === 'pung') { take(hand, t, 2); s.melds[best].push({ kind: 'pung', tiles: [t, t, t], from: cl.from, open: true }); }
  else { for (const x of a.use!) take(hand, x); s.melds[best].push({ kind: 'chow', tiles: [t, ...a.use!].sort(asc), from: cl.from, open: true }); }
  s.turn = best;                                             // no draw: they throw a tile and play goes on from them
  s.drew = null;
  s.kongDraw = false;
  s.phase = 'turn';
}
/** The kongs the player whose turn it is could declare: four in hand, or the fourth to a pung already laid down. */
function kongsOf(s: Mahjong, seat: number) {
  if (s.drew === null || !s.wall.length) return [];
  const c = tally(s.hands[seat]);
  return [...new Set(s.hands[seat])].filter((t) => c[t] === 4 || s.melds[seat].some((m) => m.kind === 'pung' && m.tiles[0] === t));
}

export const mahjong: Rules<Mahjong> = {
  seats: [4, 4],
  bots: true,
  start(_players, rng) {
    const s = { phase: 'turn', handNo: 0, dealer: 0, turn: 0, drew: null, kongDraw: false, scores: [0, 0, 0, 0] } as Mahjong;
    deal(s, rng);
    return s;
  },
  turn(s) {
    if (s.phase === 'turn') return [s.turn];
    if (s.phase === 'claim') return [0, 1, 2, 3].filter((i) => s.claim!.options[i] && !s.claim!.answers[i]);
    return s.phase === 'handEnd' ? [0, 1, 2, 3] : [];
  },
  // who could claim a tile shows what they hold: each is told only whether they themselves are being waited for
  secretTurn: (s) => s.phase === 'claim',
  move(s, seat, m, rng) {
    if (!m || typeof m !== 'object') return 'That could not be read.';
    if (s.phase === 'handEnd') {
      if (m.next !== true) return 'The hand is over.';
      s.handNo++;
      s.dealer = (s.dealer + 1) % 4;
      deal(s, rng);
      return null;
    }
    if (s.phase === 'over') return 'The game is over.';
    if (s.phase === 'claim') {
      const cl = s.claim!, o = cl.options[seat];
      if (!o) return 'You cannot claim that tile.';
      if (cl.answers[seat]) return 'You have already answered.';
      const a: unknown = m.claim;
      if (a === 'pass') cl.answers[seat] = { a };
      else if (a === 'win') { if (!o.win) return 'That tile does not finish your hand.'; cl.answers[seat] = { a }; }
      else if (a === 'kong') { if (!o.kong) return 'You need three of that tile for a kong.'; cl.answers[seat] = { a }; }
      else if (a === 'pung') { if (!o.pung) return 'You need two of that tile for a pung.'; cl.answers[seat] = { a }; }
      else if (a === 'chow') {
        if (!o.chows.length) return 'Only the next player can chow, with two tiles that make a run with it.';
        const use = Array.isArray(m.use) ? o.chows.find((p) => p[0] === m.use[0] && p[1] === m.use[1]) : o.chows.length === 1 ? o.chows[0] : undefined;
        if (!use) return 'Pick which two tiles to make the run with.';
        cl.answers[seat] = { a, use };
      } else return 'Claim it or pass.';
      settleClaim(s);
      return null;
    }
    if (s.turn !== seat) return 'It is not your turn.';
    const hand = s.hands[seat];
    if (m.win === true) {
      if (s.drew === null) return 'You can only win this way on a tile you drew.';
      if (!wins(hand, s.melds[seat].length)) return 'That is not a finished hand yet: four sets and a pair.';
      finish(s, seat, -1, s.drew);
      return null;
    }
    if (m.kong !== undefined) {
      if (!isTile(m.kong) || !kongsOf(s, seat).includes(m.kong)) return s.drew === null ? 'A kong can only be declared after drawing a tile.' : 'You need all four of a tile for a kong.';
      const t: number = m.kong, pung = s.melds[seat].find((x) => x.kind === 'pung' && x.tiles[0] === t);
      if (hand.filter((x) => x === t).length === 4) { take(hand, t, 4); s.melds[seat].push({ kind: 'kong', tiles: [t, t, t, t], from: -1, open: false }); }
      else { take(hand, t); pung!.kind = 'kong'; pung!.tiles.push(t); }
      s.said = { seat, what: 'kong', tile: t };
      draw(s, seat, true);
      return null;
    }
    if (!isTile(m.discard) || !hand.includes(m.discard)) return 'Pick a tile from your hand to throw away.';
    take(hand, m.discard);
    s.discards[seat].push(m.discard);
    s.last = { seat, tile: m.discard };
    s.drew = null;
    s.said = null;
    offer(s, seat, m.discard);
    return null;
  },
  view(s, seat) {
    const mine = seat >= 0, live = s.phase === 'turn' || s.phase === 'claim';
    const myTurn = mine && s.phase === 'turn' && s.turn === seat;
    const fixed = mine ? s.melds[seat].length : 0;
    const o = mine && s.phase === 'claim' && !s.claim!.answers[seat] ? s.claim!.options[seat] : null;
    let hint: Record<string, unknown> | null = null, claim: Record<string, unknown> | null = null;
    if (mine && live) {
      if (myTurn) { const throws = throwsOf(s, seat); hint = { away: throws[0].away, throws }; }
      else { const c = tally(s.hands[seat]); hint = { away: away(c, fixed), ...helpers(c, fixed, unseenBy(s, seat)) }; }
    }
    if (s.claim) {
      const hand = mine ? s.hands[seat] : [], t = s.claim.tile;
      claim = {
        tile: t, from: s.claim.from, answered: mine && !!s.claim.answers[seat],
        // what I may do with it, and for each, how far my hand would be from ready afterwards
        mine: o && { ...o, after: { pung: o.pung ? awayAfter(hand, fixed, [t, t]) : null, kong: o.kong ? awayAfter(hand, fixed, [t, t, t]) : null, chows: o.chows.map((p) => awayAfter(hand, fixed, p)) } },
      };
    }
    return {
      phase: s.phase, handNo: s.handNo, hands: HANDS, dealer: s.dealer, turn: s.phase === 'turn' ? s.turn : -1, wall: s.wall.length,
      hand: mine ? s.hands[seat] : [], drew: myTurn ? s.drew : null, counts: s.hands.map((h) => h.length),
      // a kong made all from one's own hand lies face down: the others see only that it is there
      melds: s.melds.map((ms, i) => ms.map((x) => ({ kind: x.kind, from: x.from, open: x.open, tiles: x.open || i === seat || !live ? x.tiles : [] }))),
      discards: s.discards, last: s.last, said: s.said, scores: s.scores, summary: s.summary,
      can: myTurn ? { win: s.drew !== null && wins(s.hands[seat], fixed), kongs: kongsOf(s, seat) } : null,
      claim, hint,
    };
  },
  result(s): Result | null {
    if (s.phase !== 'over') return null;
    const top = Math.max(...s.scores);
    return { winners: s.scores.flatMap((v, i) => (v === top ? [i] : [])), text: `${top} points after ${HANDS} hands` };
  },
  pause: (s) => (s.phase === 'claim' ? 500 : 900),
  // A plain, quick player: wins when it can, claims a tile when that brings its hand closer, and throws whatever
  // leaves it nearest to ready with the most tiles still to hope for.
  bot(s, seat) {
    const hand = s.hands[seat], fixed = s.melds[seat].length;
    if (s.phase === 'claim') {
      const cl = s.claim!, o = cl.options[seat];
      if (!o || cl.answers[seat]) return null;
      if (o.win) return { claim: 'win' };
      const now = away(tally(hand), fixed), t = cl.tile;
      if (o.kong && awayAfter(hand, fixed, [t, t, t]) <= now) return { claim: 'kong' };
      if (o.pung && awayAfter(hand, fixed, [t, t]) < now) return { claim: 'pung' };
      const use = o.chows.find((p) => awayAfter(hand, fixed, p) < now);
      return use ? { claim: 'chow', use } : { claim: 'pass' };
    }
    if (s.phase !== 'turn' || s.turn !== seat) return null;
    if (s.drew !== null && wins(hand, fixed)) return { win: true };
    const throws = throwsOf(s, seat);
    for (const t of kongsOf(s, seat)) {
      const c = tally(hand), whole = c[t] === 4;
      c[t] -= whole ? 4 : 1;
      if (away(c, fixed + (whole ? 1 : 0)) <= throws[0].away) return { kong: t };
    }
    return { discard: throws[0].tile };
  },
};
