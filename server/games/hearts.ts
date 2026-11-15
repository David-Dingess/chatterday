// Hearts, for four. Pass three cards (left, right, across, then a hand with no pass), the two of clubs leads, follow
// suit if you can, no hearts led until one has been played, no points on the first trick. Each heart is a point and
// the queen of spades thirteen; take all twenty-six and the others get them instead. First to 100 ends it; lowest wins.
import { bySuit, fullDeck, highest, isCard, lowest, rk, shuffle, su, winning } from './cards.ts';
import type { Card, Played, Result, Rng, Rules } from './cards.ts';

const PASS = ['left', 'right', 'across', 'hold'] as const;
const PASS_BY = [1, 3, 2];              // how many seats round the table the cards go
export const HEARTS_TARGET = 100;

export type Hearts = {
  hands: Card[][]; phase: 'pass' | 'play' | 'handEnd' | 'over'; handNo: number; passDir: number;
  /** What each seat has put down to pass (until everyone has), and what each was handed (until they play a card). */
  passes: (Card[] | null)[]; received: (Card[] | null)[];
  trick: Played[]; leader: number; turn: number; broken: boolean;
  /** Points taken so far this hand, and tricks played. */
  taken: number[]; tricks: number;
  scores: number[]; last: { cards: Played[]; winner: number } | null;
  /** After a hand: what each seat was given for it, and who shot the moon (-1: nobody). */
  summary: { points: number[]; moon: number } | null;
};

const points = (c: Card) => (su(c) === 'H' ? 1 : c === 'QS' ? 13 : 0);

function deal(s: Hearts, rng: Rng) {
  const d = shuffle(fullDeck(), rng);
  s.hands = [0, 1, 2, 3].map((i) => d.slice(i * 13, i * 13 + 13).sort(bySuit));
  s.passDir = s.handNo % 4;
  s.passes = [null, null, null, null];
  s.received = [null, null, null, null];
  s.trick = []; s.broken = false; s.taken = [0, 0, 0, 0]; s.tricks = 0; s.last = null; s.summary = null;
  if (s.passDir === 3) beginPlay(s); else s.phase = 'pass';
}
function beginPlay(s: Hearts) {
  s.phase = 'play';
  s.leader = s.turn = s.hands.findIndex((h) => h.includes('2C'));
}

/** The cards that seat may play now (none if it is not their turn). */
export function legal(s: Hearts, seat: number): Card[] {
  if (s.phase !== 'play' || s.turn !== seat) return [];
  const h = s.hands[seat];
  const first = s.tricks === 0;
  if (!s.trick.length) {
    if (first) return ['2C'];
    if (!s.broken) { const plain = h.filter((c) => su(c) !== 'H'); if (plain.length) return plain; }
    return [...h];
  }
  const follow = h.filter((c) => su(c) === su(s.trick[0].card));
  if (follow.length) return follow;
  if (first) { const safe = h.filter((c) => !points(c)); if (safe.length) return safe; }
  return [...h];
}
/** One line on why a card in their hand cannot be played. */
function whyNot(s: Hearts, seat: number): string {
  if (!s.trick.length) return s.tricks === 0 ? 'The two of clubs leads the first trick.' : 'Hearts cannot be led until one has been played.';
  const led = su(s.trick[0].card);
  if (s.hands[seat].some((c) => su(c) === led)) return `You have to follow suit (${{ C: 'clubs', D: 'diamonds', S: 'spades', H: 'hearts' }[led]}).`;
  return 'No hearts or queen of spades on the first trick.';
}

function endHand(s: Hearts) {
  const moon = s.taken.indexOf(26);
  const pts = moon >= 0 ? s.taken.map((_, i) => (i === moon ? 0 : 26)) : [...s.taken];
  s.scores = s.scores.map((v, i) => v + pts[i]);
  s.summary = { points: pts, moon };
  s.phase = s.scores.some((v) => v >= HEARTS_TARGET) ? 'over' : 'handEnd';
}

export const hearts: Rules<Hearts> = {
  seats: [4, 4],
  bots: true,
  start(_players, rng) {
    const s = { handNo: 0, scores: [0, 0, 0, 0] } as Hearts;
    deal(s, rng);
    return s;
  },
  turn(s) {
    if (s.phase === 'pass') return [0, 1, 2, 3].filter((i) => !s.passes[i]);
    if (s.phase === 'play') return [s.turn];
    return s.phase === 'handEnd' ? [0, 1, 2, 3] : [];
  },
  move(s, seat, m, rng) {
    if (!m || typeof m !== 'object') return 'That could not be read.';
    if (s.phase === 'pass') {
      const cards: unknown = m.pass;
      if (!Array.isArray(cards)) return 'Pick three cards to pass.';
      if (s.passes[seat]) return 'You have already passed.';
      if (cards.length !== 3 || !cards.every(isCard) || new Set(cards).size !== 3 || !cards.every((c) => s.hands[seat].includes(c))) return 'Pick three cards from your hand.';
      s.passes[seat] = [...cards];
      if (s.passes.every(Boolean)) {
        for (let i = 0; i < 4; i++) s.hands[i] = s.hands[i].filter((c) => !s.passes[i]!.includes(c));
        for (let i = 0; i < 4; i++) {
          const to = (i + PASS_BY[s.passDir]) % 4;
          s.received[to] = s.passes[i];
          s.hands[to].push(...s.passes[i]!);
        }
        for (const h of s.hands) h.sort(bySuit);
        s.passes = [null, null, null, null];
        beginPlay(s);
      }
      return null;
    }
    if (s.phase === 'play') {
      const card: unknown = m.play;
      if (!isCard(card)) return 'Pick a card to play.';
      if (s.turn !== seat) return 'It is not your turn.';
      const at = s.hands[seat].indexOf(card);
      if (at < 0) return 'That card is not in your hand.';
      if (!legal(s, seat).includes(card)) return whyNot(s, seat);
      s.hands[seat].splice(at, 1);
      s.received[seat] = null;
      s.trick.push({ seat, card });
      if (su(card) === 'H') s.broken = true;
      if (s.trick.length < 4) { s.turn = (seat + 1) % 4; return null; }
      const w = winning(s.trick).seat;
      s.taken[w] += s.trick.reduce((n, p) => n + points(p.card), 0);
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
      deal(s, rng);
      return null;
    }
    return 'The game is over.';
  },
  view(s, seat) {
    const mine = seat >= 0;
    return {
      phase: s.phase, handNo: s.handNo, passDir: PASS[s.passDir], target: HEARTS_TARGET,
      hand: mine ? s.hands[seat] : [], counts: s.hands.map((h) => h.length),
      passed: s.passes.map(Boolean), myPass: mine ? s.passes[seat] : null, received: mine ? s.received[seat] : null,
      trick: s.trick, leader: s.leader, turn: s.phase === 'play' ? s.turn : -1, legal: mine ? legal(s, seat) : [],
      broken: s.broken, taken: s.taken, scores: s.scores, last: s.last, summary: s.summary,
    };
  },
  result(s): Result | null {
    if (s.phase !== 'over') return null;
    const low = Math.min(...s.scores);
    return { winners: [0, 1, 2, 3].filter((i) => s.scores[i] === low), text: `lowest score, ${low}` };
  },
  pause: (s) => (s.phase === 'pass' ? 0 : !s.trick.length && s.last ? 1700 : 800),
  // A plain, careful player: passes its most dangerous cards, ducks tricks that have points in them, and gets rid of
  // the queen of spades and its high hearts when it cannot follow suit. It looks only at its own hand and the table.
  bot(s, seat) {
    const h = s.hands[seat];
    if (s.phase === 'pass') {
      if (s.passes[seat]) return null;
      const spades = h.filter((c) => su(c) === 'S').length;
      const danger = (c: Card) => (c === 'QS' ? 100 : (c === 'AS' || c === 'KS') && spades < 5 ? 60 + rk(c) : su(c) === 'H' ? 14 + rk(c) : rk(c) + (rk(c) >= 9 ? 10 : 0));
      return { pass: [...h].sort((a, b) => danger(b) - danger(a)).slice(0, 3) };
    }
    if (s.phase !== 'play' || s.turn !== seat) return null;
    const ok = legal(s, seat);
    const notQueen = (cs: Card[]) => { const rest = cs.filter((c) => c !== 'QS'); return rest.length ? rest : cs; };
    if (!s.trick.length) return { play: lowest(notQueen(ok)) };
    const led = su(s.trick[0].card);
    if (su(ok[0]) === led) {
      const top = rk(winning(s.trick).card);
      const loaded = s.trick.some((p) => points(p.card) > 0);
      const lastToPlay = s.trick.length === 3;
      if (ok.includes('QS') && top > rk('QS')) return { play: 'QS' };                 // somebody else's ace or king takes her
      if (lastToPlay && !loaded) return { play: highest(notQueen(ok)) };              // a free trick: shed a high card
      const under = ok.filter((c) => rk(c) < top);
      if (under.length) return { play: highest(under) };
      return { play: lastToPlay ? highest(notQueen(ok)) : lowest(notQueen(ok)) };
    }
    if (ok.includes('QS')) return { play: 'QS' };
    const spades = h.filter((c) => su(c) === 'S').length;
    for (const c of ['AS', 'KS']) if (ok.includes(c) && spades <= 3) return { play: c };
    const reds = ok.filter((c) => su(c) === 'H');
    return { play: highest(reds.length ? reds : ok) };
  },
};
