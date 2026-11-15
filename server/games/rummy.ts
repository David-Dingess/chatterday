// Basic rummy, for two to four. On your turn: draw the top of the stock or of the discard pile; lay down any sets
// (three or four of a rank) and runs (three or more in a row in one suit, ace low) you like; lay off cards on melds
// already on the table; then discard one. The first to get rid of every card wins the hand and scores what is left
// in the other hands (face cards 10, aces 1, the rest their number). First to 100 wins.
import { fullDeck, isCard, shuffle, su } from './cards.ts';
import type { Card, Result, Rng, Rules } from './cards.ts';

export const RUMMY_TARGET = 100;
/** The stock is turned over once when it runs out. The second time it runs out, the hand is called. */
const TURNOVERS = 1;

export type Meld = { kind: 'set' | 'run'; cards: Card[] };
export type Rummy = {
  n: number; hands: Card[][]; stock: Card[]; discard: Card[]; melds: Meld[];
  phase: 'draw' | 'play' | 'handEnd' | 'over'; turn: number; dealer: number; handNo: number;
  /** The card taken from the discard pile this turn: it cannot be the one thrown straight back. */
  took: Card | null; turnovers: number; scores: number[];
  /** After a hand: who won it (-1: nobody), what each hand still held, what the winner scored, and whether the stock ran out. */
  summary: { winner: number; left: number[]; points: number; blocked: boolean } | null;
};

/** 1 for an ace up to 13 for a king: aces are low in rummy. */
export const rv = (c: Card) => 'A23456789TJQK'.indexOf(c[0]) + 1;
const pips = (c: Card) => Math.min(10, rv(c));
const count = (h: Card[]) => h.reduce((n, c) => n + pips(c), 0);
const byRun = (a: Card, b: Card) => 'CDSH'.indexOf(su(a)) - 'CDSH'.indexOf(su(b)) || rv(a) - rv(b);

/** Whether these cards make a set or a run, and which. */
export function meldKind(cards: Card[]): 'set' | 'run' | null {
  if (cards.length < 3 || new Set(cards).size !== cards.length) return null;
  if (cards.every((c) => c[0] === cards[0][0])) return 'set';
  if (!cards.every((c) => su(c) === su(cards[0]))) return null;
  const v = cards.map(rv).sort((a, b) => a - b);
  return v.every((x, i) => i === 0 || x === v[i - 1] + 1) ? 'run' : null;
}
/** Whether a card can be added to a meld on the table. */
export function fits(card: Card, m: Meld): boolean {
  if (m.kind === 'set') return card[0] === m.cards[0][0] && !m.cards.includes(card);
  if (su(card) !== su(m.cards[0])) return false;
  const v = m.cards.map(rv);
  return rv(card) === Math.min(...v) - 1 || rv(card) === Math.max(...v) + 1;
}
/** A meld that can be made from these cards (the longest run, else a set), or null. `must` has to be part of it. */
export function findMeld(hand: Card[], must?: Card): Card[] | null {
  let best: Card[] | null = null;
  const sorted = [...hand].sort(byRun);
  for (let i = 0; i < sorted.length; i++) {
    const run = [sorted[i]];
    for (let j = i + 1; j < sorted.length && su(sorted[j]) === su(sorted[i]) && rv(sorted[j]) === rv(run[run.length - 1]) + 1; j++) run.push(sorted[j]);
    if (run.length >= 3 && (!must || run.includes(must)) && (!best || run.length > best.length)) best = run;
  }
  if (best) return best;
  for (const c of hand) {
    const set = hand.filter((x) => x[0] === c[0]);
    if (set.length >= 3 && (!must || set.includes(must))) return set;
  }
  return null;
}

function deal(s: Rummy, rng: Rng) {
  const d = shuffle(fullDeck(), rng);
  const each = s.n === 2 ? 10 : 7;
  s.hands = Array.from({ length: s.n }, (_, i) => d.slice(i * each, (i + 1) * each).sort(byRun));
  s.stock = d.slice(s.n * each);
  s.discard = [s.stock.pop()!];
  s.melds = [];
  s.took = null; s.turnovers = 0; s.summary = null;
  s.phase = 'draw';
  s.turn = (s.dealer + 1) % s.n;
}
function endHand(s: Rummy, winner: number, blocked = false) {
  const left = s.hands.map(count);
  // Out of cards: the winner scores everything left in the other hands. Stock run out: whoever holds least scores the
  // difference from each of the others (nobody, if two are level on least).
  let points = 0;
  if (winner >= 0) points = blocked ? left.reduce((n, v) => n + v - left[winner], 0) : left.reduce((n, v) => n + v, 0);
  if (winner >= 0) s.scores[winner] += points;
  s.summary = { winner, left, points, blocked };
  s.phase = s.scores.some((v) => v >= RUMMY_TARGET) ? 'over' : 'handEnd';
}
function called(s: Rummy) {
  const left = s.hands.map(count), low = Math.min(...left);
  endHand(s, left.filter((v) => v === low).length === 1 ? left.indexOf(low) : -1, true);
}
/** After a card has left the hand: are they out? */
const out = (s: Rummy, seat: number) => { if (s.hands[seat].length) return false; endHand(s, seat); return true; };

export const rummy: Rules<Rummy> = {
  seats: [2, 4],
  bots: true,
  start(players, rng) {
    const n = Math.max(2, Math.min(4, players));
    const s = { n, handNo: 0, dealer: Math.floor(rng() * n), scores: Array(n).fill(0) } as Rummy;
    deal(s, rng);
    return s;
  },
  turn(s) {
    if (s.phase === 'draw' || s.phase === 'play') return [s.turn];
    return s.phase === 'handEnd' ? s.hands.map((_, i) => i) : [];
  },
  move(s, seat, m, rng) {
    if (!m || typeof m !== 'object') return 'That could not be read.';
    if (s.phase === 'handEnd') {
      if (m.next !== true) return 'The hand is over.';
      s.handNo++;
      s.dealer = (s.dealer + 1) % s.n;
      deal(s, rng);
      return null;
    }
    if (s.phase === 'over') return 'The game is over.';
    if (s.turn !== seat) return 'It is not your turn.';
    const hand = s.hands[seat];
    if (s.phase === 'draw') {
      if (m.draw === 'discard') {
        if (!s.discard.length) return 'The discard pile is empty.';
        s.took = s.discard.pop()!;
        hand.push(s.took);
      } else if (m.draw === 'stock') {
        if (!s.stock.length) {
          if (s.turnovers >= TURNOVERS || s.discard.length < 2) { called(s); return null; }
          const top = s.discard.pop()!;
          s.stock = s.discard.reverse();
          s.discard = [top];
          s.turnovers++;
        }
        hand.push(s.stock.pop()!);
        s.took = null;
      } else return 'Draw a card first: from the stock or the discard pile.';
      hand.sort(byRun);
      s.phase = 'play';
      return null;
    }
    // drawn: lay down, lay off, or discard to end the turn
    if (Array.isArray(m.meld)) {
      const cards: unknown[] = m.meld;
      if (cards.length < 3 || cards.length > 13 || !cards.every(isCard) || !cards.every((c) => hand.includes(c))) return 'Pick three or more cards from your hand.';
      const kind = meldKind(cards);
      if (!kind) return 'That is not a set (same rank) or a run (same suit, in a row, ace low).';
      s.hands[seat] = hand.filter((c) => !cards.includes(c));
      s.melds.push({ kind, cards: [...cards].sort(byRun) });
      out(s, seat);
      return null;
    }
    if (m.layoff !== undefined) {
      if (!isCard(m.layoff) || !hand.includes(m.layoff)) return 'Pick one card from your hand to lay off.';
      if (!Number.isInteger(m.on) || m.on < 0 || m.on >= s.melds.length) return 'Pick a meld on the table to add it to.';
      const meld = s.melds[m.on];
      if (!fits(m.layoff, meld)) return 'That card does not fit that meld.';
      hand.splice(hand.indexOf(m.layoff), 1);
      meld.cards.push(m.layoff);
      meld.cards.sort(byRun);
      out(s, seat);
      return null;
    }
    if (m.discard !== undefined) {
      if (!isCard(m.discard) || !hand.includes(m.discard)) return 'Pick one card from your hand to discard.';
      if (m.discard === s.took && hand.length > 1) return 'You cannot discard the card you just picked up from the pile.';
      hand.splice(hand.indexOf(m.discard), 1);
      s.discard.push(m.discard);
      s.took = null;
      if (out(s, seat)) return null;
      s.turn = (seat + 1) % s.n;
      s.phase = 'draw';
      return null;
    }
    return 'Lay down a meld, lay a card off, or discard to end your turn.';
  },
  view(s, seat) {
    const mine = seat >= 0;
    return {
      phase: s.phase, handNo: s.handNo, dealer: s.dealer, target: RUMMY_TARGET,
      hand: mine ? s.hands[seat] : [], counts: s.hands.map((h) => h.length),
      stock: s.stock.length, top: s.discard[s.discard.length - 1] ?? null, pile: s.discard.length,
      melds: s.melds, turn: s.phase === 'draw' || s.phase === 'play' ? s.turn : -1,
      took: mine && s.turn === seat ? s.took : null, scores: s.scores, summary: s.summary,
    };
  },
  result(s): Result | null {
    if (s.phase !== 'over') return null;
    const top = Math.max(...s.scores);
    return { winners: s.scores.map((v, i) => (v === top ? i : -1)).filter((i) => i >= 0), text: `${top} points` };
  },
  pause: () => 800,
  // A plain player: takes the discard only when it finishes a meld, lays down whatever it can, lays off whatever
  // fits, and throws its highest card that is not half of something.
  bot(s, seat) {
    if ((s.phase !== 'draw' && s.phase !== 'play') || s.turn !== seat) return null;
    const hand = s.hands[seat];
    if (s.phase === 'draw') {
      const top = s.discard[s.discard.length - 1];
      return { draw: top && findMeld([...hand, top], top) ? 'discard' : 'stock' };
    }
    const meld = findMeld(hand);
    if (meld) return { meld };
    for (const c of hand) {
      const on = s.melds.findIndex((m) => fits(c, m));
      if (on >= 0 && !(c === s.took && hand.length === 1)) return { layoff: c, on };
    }
    const can = hand.filter((c) => c !== s.took || hand.length === 1);
    const useful = (c: Card) => hand.some((x) => x !== c && (x[0] === c[0] || (su(x) === su(c) && Math.abs(rv(x) - rv(c)) <= 2)));
    const loose = can.filter((c) => !useful(c));
    const pool = loose.length ? loose : can;
    return { discard: pool.reduce((a, b) => (pips(b) > pips(a) ? b : a)) };
  },
};
