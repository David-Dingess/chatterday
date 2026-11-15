// Spades, for four in two partnerships (the people sitting across from each other). Everyone bids how many tricks
// they will take, or nil (none at all). Spades are trumps and cannot be led until one has been played. A side that
// makes its bid scores ten a trick plus one for each extra (a "bag"); ten bags cost a hundred. A nil is worth a
// hundred, made or lost. First side to 500 wins (or the other side falling to -200).
import { beats, bySuit, fullDeck, highest, isCard, lowest, rk, shuffle, su, winning } from './cards.ts';
import type { Card, Played, Result, Rng, Rules } from './cards.ts';

export const SPADES_TARGET = 500, SPADES_FLOOR = -200;

export type Spades = {
  hands: Card[][]; phase: 'bid' | 'play' | 'handEnd' | 'over'; handNo: number; dealer: number;
  /** What each seat bid (0 is nil), null until they have. */
  bids: (number | null)[]; won: number[];
  trick: Played[]; leader: number; turn: number; broken: boolean; tricks: number;
  /** For the two sides (seats 0 and 2, seats 1 and 3). */
  scores: number[]; bags: number[];
  last: { cards: Played[]; winner: number } | null;
  /** After a hand, for each side: what the hand was worth, and the lines that make it up. */
  summary: { points: number[]; lines: string[][] } | null;
};

function deal(s: Spades, rng: Rng) {
  const d = shuffle(fullDeck(), rng);
  s.hands = [0, 1, 2, 3].map((i) => d.slice(i * 13, i * 13 + 13).sort(bySuit));
  s.bids = [null, null, null, null];
  s.won = [0, 0, 0, 0];
  s.trick = []; s.broken = false; s.tricks = 0; s.last = null; s.summary = null;
  s.phase = 'bid';
  s.leader = s.turn = (s.dealer + 1) % 4;
}

export function legal(s: Spades, seat: number): Card[] {
  if (s.phase !== 'play' || s.turn !== seat) return [];
  const h = s.hands[seat];
  if (!s.trick.length) {
    if (!s.broken) { const plain = h.filter((c) => su(c) !== 'S'); if (plain.length) return plain; }
    return [...h];
  }
  const follow = h.filter((c) => su(c) === su(s.trick[0].card));
  return follow.length ? follow : [...h];
}

function endHand(s: Spades) {
  const points = [0, 0], lines: string[][] = [[], []];
  for (const t of [0, 1]) {
    const seats = [t, t + 2];
    let contract = 0, made = 0, bags = 0;
    for (const i of seats) {
      if (s.bids[i] === 0) {
        if (s.won[i] === 0) { points[t] += 100; lines[t].push('Nil made: +100'); }
        else { points[t] -= 100; bags += s.won[i]; lines[t].push(`Nil lost: -100`); }
      } else { contract += s.bids[i]!; made += s.won[i]; }
    }
    if (contract > 0) {
      if (made >= contract) { points[t] += 10 * contract; bags += made - contract; lines[t].push(`Bid ${contract}, took ${made}: +${10 * contract}`); }
      else { points[t] -= 10 * contract; lines[t].push(`Bid ${contract}, took ${made}: -${10 * contract}`); }
    }
    if (bags) { points[t] += bags; lines[t].push(`${bags} bag${bags === 1 ? '' : 's'}: +${bags}`); }
    s.bags[t] += bags;
    while (s.bags[t] >= 10) { s.bags[t] -= 10; points[t] -= 100; lines[t].push('Ten bags: -100'); }
    s.scores[t] += points[t];
  }
  s.summary = { points, lines };
  const [a, b] = s.scores;
  const done = a !== b && (Math.max(a, b) >= SPADES_TARGET || Math.min(a, b) <= SPADES_FLOOR);
  s.phase = done ? 'over' : 'handEnd';
}

/** Roughly how many tricks a hand is worth. */
function worth(h: Card[]): number {
  let t = 0;
  const spades = h.filter((c) => su(c) === 'S');
  for (const x of 'CDH') {
    const cs = h.filter((c) => su(c) === x);
    if (cs.includes('A' + x)) t += 1;
    if (cs.includes('K' + x) && cs.length >= 2 && cs.length <= 5) t += 0.7;
    if (cs.includes('Q' + x) && cs.includes('K' + x) && cs.length === 3) t += 0.3;
    if (cs.length <= 1 && spades.length >= 3) t += 0.6;                 // short in a suit, with trumps to cut it
  }
  if (spades.includes('AS')) t += 1;
  if (spades.includes('KS') && spades.length >= 2) t += 1;
  if (spades.includes('QS') && spades.length >= 3) t += 0.8;
  t += Math.max(0, spades.length - 4);
  return t;
}

export const spades: Rules<Spades> = {
  seats: [4, 4],
  bots: true,
  start(_players, rng) {
    const s = { handNo: 0, dealer: Math.floor(rng() * 4), scores: [0, 0], bags: [0, 0] } as Spades;
    deal(s, rng);
    return s;
  },
  turn(s) {
    if (s.phase === 'bid' || s.phase === 'play') return [s.turn];
    return s.phase === 'handEnd' ? [0, 1, 2, 3] : [];
  },
  move(s, seat, m, rng) {
    if (!m || typeof m !== 'object') return 'That could not be read.';
    if (s.phase === 'bid') {
      if (!Number.isInteger(m.bid) || m.bid < 0 || m.bid > 13) return 'Bid a number of tricks from 1 to 13, or nil.';
      if (s.turn !== seat) return 'It is not your turn to bid.';
      s.bids[seat] = m.bid;
      s.turn = (seat + 1) % 4;
      if (s.bids.every((b) => b !== null)) { s.phase = 'play'; s.turn = s.leader; }
      return null;
    }
    if (s.phase === 'play') {
      const card: unknown = m.play;
      if (!isCard(card)) return 'Pick a card to play.';
      if (s.turn !== seat) return 'It is not your turn.';
      const at = s.hands[seat].indexOf(card);
      if (at < 0) return 'That card is not in your hand.';
      if (!legal(s, seat).includes(card)) return s.trick.length ? 'You have to follow suit.' : 'Spades cannot be led until one has been played.';
      s.hands[seat].splice(at, 1);
      s.trick.push({ seat, card });
      if (su(card) === 'S') s.broken = true;
      if (s.trick.length < 4) { s.turn = (seat + 1) % 4; return null; }
      const w = winning(s.trick, 'S').seat;
      s.won[w]++;
      s.last = { cards: s.trick, winner: w };
      s.trick = [];
      s.tricks++;
      s.leader = s.turn = w;
      if (s.tricks === 13) endHand(s);
      return null;
    }
    if (s.phase === 'handEnd') {
      if (m.next !== true) return 'The hand is over.';
      s.handNo++;
      s.dealer = (s.dealer + 1) % 4;
      deal(s, rng);
      return null;
    }
    return 'The game is over.';
  },
  view(s, seat) {
    const mine = seat >= 0;
    return {
      phase: s.phase, handNo: s.handNo, dealer: s.dealer, target: SPADES_TARGET, floor: SPADES_FLOOR,
      hand: mine ? s.hands[seat] : [], counts: s.hands.map((h) => h.length),
      bids: s.bids, won: s.won, trick: s.trick, leader: s.leader, turn: s.phase === 'bid' || s.phase === 'play' ? s.turn : -1,
      legal: mine ? legal(s, seat) : [], broken: s.broken, scores: s.scores, bags: s.bags, last: s.last, summary: s.summary,
    };
  },
  result(s): Result | null {
    if (s.phase !== 'over') return null;
    const t = s.scores[0] > s.scores[1] ? 0 : 1;
    return { winners: [t, t + 2], text: `${s.scores[t]} to ${s.scores[1 - t]}` };
  },
  pause: (s) => (s.phase === 'play' && !s.trick.length && s.last ? 1700 : 800),
  // A plain, sensible player: bids what its high cards and trumps are worth, wins tricks as cheaply as it can while
  // its side still needs them, leaves its partner's winners alone, and ducks everything once the bid is made.
  bot(s, seat) {
    const h = s.hands[seat];
    if (s.phase === 'bid') {
      if (s.turn !== seat) return null;
      const t = worth(h);
      const sp = h.filter((c) => su(c) === 'S');
      const quiet = t < 1 && sp.length <= 3 && sp.every((c) => rk(c) <= rk('9S')) && h.every((c) => rk(c) <= rk('QS'));
      return { bid: quiet ? 0 : Math.max(1, Math.min(13, Math.round(t))) };
    }
    if (s.phase !== 'play' || s.turn !== seat) return null;
    const ok = legal(s, seat);
    const mate = (seat + 2) % 4;
    const nil = s.bids[seat] === 0;
    const need = [seat, mate].reduce((n, i) => n + (s.bids[i] ? s.bids[i]! - s.won[i] : 0), 0) > 0;
    const plain = ok.filter((c) => su(c) !== 'S');
    if (!s.trick.length) {
      if (nil || !need) return { play: lowest(ok) };
      const ace = plain.find((c) => c[0] === 'A');
      if (ace) return { play: ace };
      if (!plain.length) return { play: highest(ok) };
      const len = (c: Card) => plain.filter((x) => su(x) === su(c)).length;
      return { play: lowest(plain.filter((c) => len(c) === Math.max(...plain.map(len)))) };
    }
    const led = su(s.trick[0].card);
    const cur = winning(s.trick, 'S');
    const lastToPlay = s.trick.length === 3;
    const winners = ok.filter((c) => beats(c, cur.card, 'S'));
    if (su(ok[0]) === led && ok.every((c) => su(c) === led)) {
      const losers = ok.filter((c) => !beats(c, cur.card, 'S'));
      if (nil) return { play: losers.length ? highest(losers) : lowest(ok) };
      if (cur.seat === mate && (lastToPlay || rk(cur.card) >= rk('JS') || su(cur.card) === 'S' && led !== 'S')) return { play: lowest(ok) };
      if (need && winners.length) return { play: lastToPlay ? lowest(winners) : rk(highest(winners)) >= rk('QS') ? highest(winners) : lowest(ok) };
      return { play: lowest(ok) };
    }
    // cannot follow suit
    if (nil) {
      if (plain.length) return { play: highest(plain) };
      const under = ok.filter((c) => !beats(c, cur.card, 'S'));
      return { play: under.length ? highest(under) : lowest(ok) };
    }
    const trumps = winners.filter((c) => su(c) === 'S');
    if (need && cur.seat !== mate && trumps.length) return { play: lowest(trumps) };
    return { play: plain.length ? lowest(plain) : lowest(ok) };
  },
};
