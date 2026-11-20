// Texas hold'em at the poker table in the game room (the table is in scripts/basement/gameroom.py; the page is
// client/src/basement/holdem.tsx). Play chips only: nothing here is money, and nothing is kept past a restart.
//
// Six seats. Anyone can sit at a free one and buy in for what they like between 20 and 500 big blinds; any seated
// player can change the blinds, which count from the next hand. The table deals by itself whenever two or more are
// sat in with chips: the button moves on a seat each hand, the small and big blinds are posted for them, two cards
// each, then the four rounds of betting (pre-flop, flop, turn, river), no limit: a raise must be at least the last
// bet or raise (all in for less is allowed, and does not reopen the betting for those who have already acted). Side
// pots for whoever is all in, a bet nobody called goes back, and the best five of seven win at the showdown (split
// evenly on a tie, the odd chip to the first seat left of the button).
//
// The cards are private. The deck and everybody's two cards live only here: each player is sent their own (op
// 'hole', and again on asking: op 'mine'), and nobody else's reach anybody, in a message or in hello(), until the
// showdown, when the hands still in are turned up. The shuffle is crypto's.
//
// Nobody can stall it: whoever is to act has 30 seconds (then they check if they can, or fold), and twice timed out
// in a row they are sat out from the next hand. Sitting out, coming back, a rebuy when busted (or topping up, between
// hands), and leaving (in a hand, that folds you first) are all there. A fresh table when the server starts, and when
// nobody has done anything at it for five minutes (reset; server/floor.ts).
import { randomInt } from 'node:crypto';
import type { FitGame, FitOut } from '../floor.ts';
import { achieve } from '../achievements.ts';

// ── the hand evaluator ──
// A card is its rank and suit: 'AS', 'TD', '7H'. A hand's value is a list compared item by item: its kind (8 straight
// flush ... 0 high card), then the ranks that settle ties within the kind, highest first.
const RANKS = '23456789TJQKA';
const rankOf = (c: string) => RANKS.indexOf(c[0]) + 2;
export const HAND_NAMES = ['High card', 'One pair', 'Two pair', 'Three of a kind', 'Straight', 'Flush', 'Full house', 'Four of a kind', 'Straight flush'];
/** The highest straight in a set of ranks (5 for the wheel, A-2-3-4-5), or 0. */
function straightHigh(ranks: Set<number>) {
  for (let hi = 14; hi >= 5; hi--) {
    let ok = true;
    for (let r = hi; r > hi - 5; r--) if (!ranks.has(r === 1 ? 14 : r)) { ok = false; break; }
    if (ok) return hi;
  }
  return 0;
}
/** The best five-card hand among five to seven cards. */
export function evaluate(cards: string[]): { value: number[]; name: string } {
  const bySuit = new Map<string, number[]>();
  const count = new Map<number, number>();
  for (const c of cards) {
    const r = rankOf(c);
    count.set(r, (count.get(r) ?? 0) + 1);
    bySuit.set(c[1], [...(bySuit.get(c[1]) ?? []), r]);
  }
  const flush = [...bySuit.values()].find((s) => s.length >= 5)?.sort((a, b) => b - a);
  if (flush) {
    const sf = straightHigh(new Set(flush));
    if (sf) return { value: [8, sf], name: sf === 14 ? 'Royal flush' : 'Straight flush' };
  }
  // ranks grouped: the biggest groups first, then the higher rank
  const groups = [...count].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const ranksDesc = [...count.keys()].sort((a, b) => b - a);
  const kick = (skip: number[], n: number) => ranksDesc.filter((r) => !skip.includes(r)).slice(0, n);
  if (groups[0][1] === 4) return { value: [7, groups[0][0], ...kick([groups[0][0]], 1)], name: HAND_NAMES[7] };
  if (groups[0][1] === 3 && groups[1]?.[1] >= 2) return { value: [6, groups[0][0], groups[1][0]], name: HAND_NAMES[6] };
  if (flush) return { value: [5, ...flush.slice(0, 5)], name: HAND_NAMES[5] };
  const st = straightHigh(new Set(ranksDesc));
  if (st) return { value: [4, st], name: HAND_NAMES[4] };
  if (groups[0][1] === 3) return { value: [3, groups[0][0], ...kick([groups[0][0]], 2)], name: HAND_NAMES[3] };
  if (groups[0][1] === 2 && groups[1]?.[1] === 2) {
    const [a, b] = [groups[0][0], groups[1][0]];               // (with three pairs, the third pair's rank can be the kicker)
    return { value: [2, a, b, ...kick([a, b], 1)], name: HAND_NAMES[2] };
  }
  if (groups[0][1] === 2) return { value: [1, groups[0][0], ...kick([groups[0][0]], 3)], name: HAND_NAMES[1] };
  return { value: [0, ...ranksDesc.slice(0, 5)], name: HAND_NAMES[0] };
}
export function compare(a: number[], b: number[]) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) - (b[i] ?? 0);
  return 0;
}
function deck() {
  const d: string[] = [];
  for (const r of RANKS) for (const s of 'CDHS') d.push(r + s);
  for (let i = d.length - 1; i > 0; i--) { const j = randomInt(i + 1); [d[i], d[j]] = [d[j], d[i]]; }
  return d;
}

// ── the table ──
export const SEATS = 6;
const TURN_MS = 30_000;
const NEXT_MS = 6_000;                     // from a hand's end to the next deal (time to see the showdown)
const FIRST_MS = 3_000;                    // from two being ready to the first deal
const STREET_MS = 900;                     // between streets when nobody is left to bet (all in: the board runs out)
const MIN_BUY = 20, MAX_BUY = 500;         // buy-ins, in big blinds

type Seat = { uid: string; stack: number; out: boolean; gone: boolean; timeouts: number };
type Stage = 'idle' | 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';
type Win = { seat: number; amount: number; hand: string };
export type Holdem = {
  seats: (Seat | null)[];
  sb: number; bb: number;                  // the blinds for the next hand
  hand: number; stage: Stage;
  button: number; sbSeat: number; bbSeat: number; hbb: number;
  board: string[];
  dealt: boolean[]; folded: boolean[]; allIn: boolean[];
  bet: number[];                           // put in on this street
  put: number[];                           // put in this hand, all streets
  pot: number;                             // collected from the streets before this one
  toAct: number; curBet: number; minRaise: number;
  turnLeft: number;                        // ms left for whoever is to act, when this was sent
  shown: (string[] | null)[];              // the cards turned up at the showdown
  wins: Win[]; last: string;
  nextIn: number;                          // ms to the next deal, when this was sent (0: none coming)
};
const fresh = (): Holdem => ({
  seats: Array(SEATS).fill(null), sb: 5, bb: 10, hand: 0, stage: 'idle', button: -1, sbSeat: -1, bbSeat: -1, hbb: 10, board: [],
  dealt: Array(SEATS).fill(false), folded: Array(SEATS).fill(false), allIn: Array(SEATS).fill(false), bet: Array(SEATS).fill(0), put: Array(SEATS).fill(0),
  pot: 0, toAct: -1, curBet: 0, minRaise: 0, turnLeft: 0, shown: Array(SEATS).fill(null), wins: [], last: '', nextIn: 0,
});

let out: FitOut;
let g: Holdem = fresh();
// kept here only, never sent whole: the deck, everybody's two cards, who has acted since the last full raise, and
// who may still raise
let pack: string[] = [];
let holes: (string[] | null)[] = Array(SEATS).fill(null);
let acted: boolean[] = Array(SEATS).fill(false);
let canRaise: boolean[] = Array(SEATS).fill(true);
let turnAt = 0;                            // when the one to act must have acted by
let nextAt = 0;                            // when the next hand is dealt (0: not yet)
let timer: ReturnType<typeof setTimeout> | null = null;
const later = (ms: number, fn: () => void) => { if (timer) clearTimeout(timer); timer = setTimeout(() => { timer = null; fn(); }, ms); };
const live = () => g.stage !== 'idle' && g.stage !== 'showdown';

/** The table as everybody may see it: no deck and nobody's cards, but what the one to act may do (for the page's
 *  buttons; the server checks again when they do it), and the clocks as times left (the page's clock is its own). */
const view = () => {
  const now = Date.now(), k = g.toAct;
  return { ...g, turnLeft: k >= 0 && live() ? Math.max(0, turnAt - now) : 0, nextIn: nextAt ? Math.max(0, nextAt - now) : 0, opts: k >= 0 && live() ? options(k) : null };
};
const tell = () => out.all({ state: view() });
const name = (k: number) => out.nameOf(g.seats[k]?.uid ?? '');
/** Who is still in the hand. */
const inHand = (k: number) => g.dealt[k] && !g.folded[k];
/** Who can still bet: in the hand and not all in. */
const canAct = (k: number) => inHand(k) && !g.allIn[k];
/** The next seat round from `k` (clockwise, not k itself) that passes the test. */
function nextSeat(k: number, ok: (j: number) => boolean) {
  for (let i = 1; i <= SEATS; i++) { const j = (k + i + SEATS) % SEATS; if (ok(j)) return j; }
  return -1;
}
/** Sat in, with chips, and here: dealt into the next hand. */
const ready = (k: number) => { const s = g.seats[k]; return !!s && !s.gone && !s.out && s.stack > 0; };

/** Between hands: deals the next if two or more are ready, after a moment; otherwise waits for them. (In a hand, or
 *  showing one's end, it is for endHand to deal the next.) */
function schedule(ms: number) {
  if (g.stage !== 'idle') return;
  const n = g.seats.filter((_, k) => ready(k)).length;
  if (n < 2) { nextAt = 0; if (timer) { clearTimeout(timer); timer = null; } return; }
  if (nextAt && nextAt > Date.now()) return;                    // (one already coming)
  nextAt = Date.now() + ms;
  later(ms, deal);
}

function pay(k: number, amount: number) {
  const s = g.seats[k]!, a = Math.min(amount, s.stack);
  s.stack -= a; g.bet[k] += a; g.put[k] += a;
  if (s.stack === 0) g.allIn[k] = true;
  return a;
}

function deal() {
  nextAt = 0;
  if (live()) return;
  // the seats left in the last hand cleared away. (Whoever wanders off is not sat out for it: out.present() counts
  // only those on a floor called 'holdem', and the table is in the game room. Their clock sits them out instead.)
  g.seats = g.seats.map((s) => (s && s.gone ? null : s));
  const players = g.seats.map((_, k) => ready(k));
  if (players.filter(Boolean).length < 2) { g.stage = 'idle'; g.toAct = -1; return tell(); }
  g.hand++;
  g.stage = 'preflop';
  g.board = []; g.pot = 0; g.wins = []; g.shown = Array(SEATS).fill(null);
  g.dealt = players; g.folded = Array(SEATS).fill(false); g.allIn = Array(SEATS).fill(false);
  g.bet = Array(SEATS).fill(0); g.put = Array(SEATS).fill(0);
  g.button = nextSeat(g.button < 0 ? randomInt(SEATS) : g.button, (j) => players[j]);
  const heads = players.filter(Boolean).length === 2;
  // heads up, the button is the small blind and acts first before the flop; otherwise the two seats after it
  g.sbSeat = heads ? g.button : nextSeat(g.button, (j) => players[j]);
  g.bbSeat = nextSeat(g.sbSeat, (j) => players[j]);
  g.hbb = g.bb;
  pay(g.sbSeat, g.sb); pay(g.bbSeat, g.bb);
  g.curBet = g.bb; g.minRaise = g.bb;                            // (a short big blind all in still makes it a big blind to call)
  pack = deck();
  holes = Array(SEATS).fill(null);
  for (let r = 0; r < 2; r++) for (let i = 1; i <= SEATS; i++) { const k = (g.sbSeat - 1 + i + SEATS) % SEATS; if (players[k]) (holes[k] ??= []).push(pack.pop()!); }
  acted = Array(SEATS).fill(false); canRaise = Array(SEATS).fill(true);
  g.last = `Hand ${g.hand}: ${name(g.button)} has the button; blinds ${g.sb}/${g.bb}.`;
  for (let k = 0; k < SEATS; k++) if (holes[k]) out.to(g.seats[k]!.uid, { op: 'hole', hand: g.hand, seat: k, cards: holes[k] });
  g.toAct = -1;
  advance(g.bbSeat);
}

/** After `from` has acted (or the street opened): the next to act, or the end of the street, or of the hand. */
function advance(from: number) {
  const still = g.seats.map((_, k) => inHand(k));
  if (still.filter(Boolean).length === 1) return finish();
  const k = nextSeat(from, (j) => canAct(j) && (!acted[j] || g.bet[j] < g.curBet));
  // (one left who can bet, and nothing for them to call: the street is over too)
  if (k < 0 || (g.seats.filter((_, j) => canAct(j)).length === 1 && g.bet[k] >= g.curBet)) return endStreet();
  g.toAct = k;
  turnAt = Date.now() + TURN_MS;
  later(TURN_MS + 300, () => timeout(k));
  tell();
}

/** A bet nobody called goes back to whoever made it. */
function returnUncalled() {
  const order = g.bet.map((b, k) => [b, k]).sort((a, b) => b[0] - a[0]);
  const [top, k] = order[0], second = order[1]?.[0] ?? 0;
  if (top > second) { const back = top - second; g.bet[k] -= back; g.put[k] -= back; g.seats[k]!.stack += back; if (g.seats[k]!.stack > 0) g.allIn[k] = false; }
}

function endStreet() {
  returnUncalled();
  g.pot += g.bet.reduce((a, b) => a + b, 0);
  g.bet = Array(SEATS).fill(0);
  g.curBet = 0; g.minRaise = g.hbb; g.toAct = -1;
  acted = Array(SEATS).fill(false); canRaise = Array(SEATS).fill(true);
  if (g.stage === 'river') return showdown();
  const next = ({ preflop: 'flop', flop: 'turn', turn: 'river' } as const)[g.stage as 'preflop' | 'flop' | 'turn'];
  pack.pop();                                                    // (a burn card)
  g.board.push(...pack.splice(-(next === 'flop' ? 3 : 1)));
  g.stage = next;
  // nobody left to bet against anybody: the rest of the board comes out, a card at a time
  if (g.seats.filter((_, k) => canAct(k)).length < 2) { tell(); return later(STREET_MS, endStreet); }
  advance(g.button);
}

/** Everybody but one has folded: they take it all, their cards unseen. */
function finish() {
  returnUncalled();
  g.pot += g.bet.reduce((a, b) => a + b, 0);
  g.bet = Array(SEATS).fill(0);
  const k = g.seats.findIndex((_, j) => inHand(j));
  g.seats[k]!.stack += g.pot;
  g.wins = [{ seat: k, amount: g.pot, hand: '' }];
  g.last = `${name(k)} wins ${g.pot}: everybody else folded.`;
  endHand();
}

/** The pots, main then sides: each with what is in it and who can win it (in the hand, and put at least that much in). */
export function pots(put: number[], inIt: boolean[]) {
  const left = [...put];
  const res: { amount: number; seats: number[] }[] = [];
  for (;;) {
    const levels = left.map((p, k) => (inIt[k] && p > 0 ? p : Infinity));
    const lvl = Math.min(...levels);
    if (!Number.isFinite(lvl)) break;
    let amount = 0;
    for (let k = 0; k < left.length; k++) { const a = Math.min(left[k], lvl); amount += a; left[k] -= a; }
    const seats = levels.map((p, k) => (p !== Infinity ? k : -1)).filter((k) => k >= 0);
    if (res.length && res[res.length - 1].seats.length === seats.length) res[res.length - 1].amount += amount;   // (the same people: one pot)
    else res.push({ amount, seats });
  }
  const dead = left.reduce((a, b) => a + b, 0);                    // (more than anybody still in put in, from those who folded)
  if (dead && res.length) res[res.length - 1].amount += dead;
  return res;
}

function showdown() {
  g.stage = 'showdown';
  g.toAct = -1;
  const best = g.seats.map((_, k) => (inHand(k) ? evaluate([...holes[k]!, ...g.board]) : null));
  for (let k = 0; k < SEATS; k++) if (inHand(k)) g.shown[k] = holes[k];
  const won = new Map<number, { amount: number; hand: string }>();
  for (const p of pots(g.put, g.seats.map((_, k) => inHand(k)))) {
    let top: number[] | null = null, winners: number[] = [];
    for (const k of p.seats) {
      const c = top ? compare(best[k]!.value, top) : 1;
      if (c > 0) { top = best[k]!.value; winners = [k]; } else if (c === 0) winners.push(k);
    }
    const share = Math.floor(p.amount / winners.length);
    let odd = p.amount - share * winners.length;
    // the odd chips go to the first winners left of the button
    const order = [...winners].sort((a, b) => ((a - g.button + SEATS - 1) % SEATS) - ((b - g.button + SEATS - 1) % SEATS));
    for (const k of order) {
      const a = share + (odd > 0 ? 1 : 0); if (odd > 0) odd--;
      g.seats[k]!.stack += a;
      won.set(k, { amount: (won.get(k)?.amount ?? 0) + a, hand: best[k]!.name });
    }
  }
  g.wins = [...won].map(([seat, w]) => ({ seat, ...w }));
  g.last = g.wins.map((w) => `${name(w.seat)} wins ${w.amount} with ${w.hand === 'Royal flush' ? 'a royal flush' : w.hand.toLowerCase()}.`).join(' ');
  endHand();
}

function endHand() {
  for (const w of g.wins) { const u = g.seats[w.seat]?.uid; if (u) achieve.holdem(u, w.hand, holes[w.seat]); }      // (achievements)
  g.pot = 0;
  g.toAct = -1;
  if (g.stage !== 'showdown') g.stage = 'showdown';               // (a hand won without one still stays up a moment)
  for (const s of g.seats) if (s && s.stack === 0) s.out = true;  // busted: sat out until a rebuy
  // the end stays up a moment; then the next hand, if there are two to play it
  nextAt = g.seats.filter((_, k) => ready(k)).length >= 2 ? Date.now() + NEXT_MS : 0;
  later(NEXT_MS, () => {
    g.stage = 'idle'; nextAt = 0;
    if (g.seats.filter((_, k) => ready(k)).length >= 2) return deal();
    g.seats = g.seats.map((s) => (s && s.gone ? null : s));
    tell();
  });
  tell();
}

function timeout(k: number) {
  if (!live() || g.toAct !== k) return;
  const s = g.seats[k]!;
  s.timeouts++;
  if (s.timeouts >= 2) s.out = true;                            // (twice in a row: sat out from the next hand)
  act(k, g.bet[k] >= g.curBet ? 'check' : 'fold', 0, true);
}

/** Somebody acts: fold, check, call, raise (to `to`, their whole bet on this street), or all in. */
function act(k: number, what: string, to: number, auto = false) {
  if (!live() || g.toAct !== k) return;
  const s = g.seats[k]!, owe = g.curBet - g.bet[k];
  if (!auto) s.timeouts = 0;
  let said = '';
  if (what === 'fold') { g.folded[k] = true; said = auto ? 'runs out of time and folds' : 'folds'; }
  else if (what === 'check') { if (owe > 0) return; said = auto ? 'runs out of time and checks' : 'checks'; }
  else if (what === 'call') { if (owe <= 0) return; const a = pay(k, owe); said = g.allIn[k] ? `calls ${a}, all in` : `calls ${a}`; }
  else if (what === 'allin' && g.bet[k] + s.stack <= g.curBet) { const a = pay(k, s.stack); said = `calls ${a}, all in`; }   // (all in for no more than the bet: a call)
  else if (what === 'raise' || what === 'allin') {
    const most = g.bet[k] + s.stack;
    if (what === 'allin') to = most;
    if (!Number.isInteger(to) || to <= g.curBet || to > most) return;
    const full = to - g.curBet >= g.minRaise;
    if (!full && to !== most) return;                            // (less than a full raise only when it is everything)
    if (!canRaise[k]) return;                                    // (an all in for less does not reopen the betting)
    const opened = g.curBet === 0;
    pay(k, to - g.bet[k]);
    if (full) { g.minRaise = to - g.curBet; for (let j = 0; j < SEATS; j++) if (j !== k) canRaise[j] = true; }
    else for (let j = 0; j < SEATS; j++) if (j !== k && acted[j]) canRaise[j] = false;
    g.curBet = to;
    for (let j = 0; j < SEATS; j++) if (j !== k) acted[j] = false;
    said = `${opened ? 'bets' : 'raises to'} ${to}${g.allIn[k] ? ', all in' : ''}`;
  } else return;
  acted[k] = true;
  g.last = `${name(k)} ${said}.`;
  advance(k);
}

/** What the one to act may do just now (for the page's buttons; the server checks again when they do it). */
function options(k: number) {
  const s = g.seats[k]!, most = g.bet[k] + s.stack;
  return { call: Math.min(g.curBet - g.bet[k], s.stack), minTo: Math.min(most, g.curBet + g.minRaise), maxTo: most, raise: canRaise[k] && most > g.curBet };
}

function message(uid: string, d: Record<string, unknown>) {
  const at = g.seats.findIndex((s) => s?.uid === uid && !s.gone);
  const int = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) ? v : NaN);
  switch (d.op) {
    case 'sit': {
      const k = int(d.seat), buy = int(d.buy);
      if (at >= 0 || !(k >= 0 && k < SEATS) || g.seats[k]) return;
      if (!(buy >= MIN_BUY * g.bb && buy <= MAX_BUY * g.bb)) return out.to(uid, { op: 'note', text: `Buy in for ${MIN_BUY * g.bb} to ${MAX_BUY * g.bb}.` });
      g.seats[k] = { uid, stack: buy, out: false, gone: false, timeouts: 0 };
      g.last = `${out.nameOf(uid)} sits down with ${buy}.`;
      tell();
      return schedule(FIRST_MS);
    }
    case 'rebuy': {
      const add = int(d.buy);
      if (at < 0) return;
      const s = g.seats[at]!;
      if (live() && g.dealt[at] && !g.folded[at]) return out.to(uid, { op: 'note', text: 'Between hands.' });
      if (!(add >= 1 && s.stack + add >= MIN_BUY * g.bb && s.stack + add <= MAX_BUY * g.bb)) return out.to(uid, { op: 'note', text: `Up to ${MAX_BUY * g.bb} in front of you, and at least ${MIN_BUY * g.bb}.` });
      s.stack += add;
      if (s.stack - add === 0) s.out = false;                    // (busted and back in)
      g.last = `${out.nameOf(uid)} ${s.stack === add ? 'buys back in for' : 'adds'} ${add}.`;
      tell();
      return schedule(FIRST_MS);
    }
    case 'blinds': {
      const sb = int(d.sb), bb = int(d.bb);
      if (at < 0 || !(sb >= 1 && bb >= sb && bb <= 1_000_000 && bb <= sb * 10)) return;
      g.sb = sb; g.bb = bb;
      g.last = `${out.nameOf(uid)} sets the blinds to ${sb}/${bb}${live() ? ', from the next hand' : ''}.`;
      return tell();
    }
    case 'sitout': {
      if (at < 0) return;
      const s = g.seats[at]!;
      s.out = !!d.on && true;
      if (!d.on) { if (s.stack === 0) { s.out = true; return out.to(uid, { op: 'note', text: 'Buy back in first.' }); } s.timeouts = 0; }
      tell();
      return schedule(FIRST_MS);
    }
    case 'leave': {
      if (at < 0) return;
      const s = g.seats[at]!;
      g.last = `${out.nameOf(uid)} leaves the table.`;
      if (live() && inHand(at)) {                                // in a hand: folded, the seat kept till it ends (their chips are in the pot)
        s.gone = true;
        g.folded[at] = true;
        if (g.toAct === at) { acted[at] = true; return advance(at); }
        if (g.seats.filter((_, j) => inHand(j)).length === 1) return finish();
        if (g.toAct >= 0 && !canAct(g.toAct)) return advance(g.toAct);
        return tell();
      }
      if (live() && g.dealt[at]) s.gone = true;                  // (folded already: the seat is cleared at the next deal)
      else g.seats[at] = null;
      tell();
      return schedule(FIRST_MS);
    }
    case 'act': {
      if (at < 0) return;
      const what = String(d.what), to = d.to === undefined ? 0 : int(d.to);
      return act(at, what, to);
    }
    case 'mine': {                                               // (a page opened mid-hand: my cards again)
      if (at >= 0 && live() && holes[at]) out.to(uid, { op: 'hole', hand: g.hand, seat: at, cards: holes[at] });
      return;
    }
  }
}

const game: FitGame = {
  start(o) { out = o; },
  hello: () => view(),
  reset() {
    if (timer) clearTimeout(timer);
    timer = null; nextAt = 0; pack = []; holes = Array(SEATS).fill(null);
    g = fresh(); tell();
  },
  message,
  going: () => (live() ? "Texas Hold'em" : null),
  playing(uid) {
    const k = g.seats.findIndex((s) => s?.uid === uid && !s.gone);
    if (k < 0) return null;
    return { game: "Texas Hold'em", waiting: !(live() && inHand(k)) };
  },
};
export default game;
