// The game table: one table, one game at a time, shared by everybody. Somebody picks a game, people take seats,
// somebody presses Start. The whole game lives here, in memory (a restart loses it, which is fine), every move is
// checked here, and each person is sent only what they may see: their own hand, the table, and how many cards the
// others hold. The rules of each game are in server/games/, as plain functions that know nothing about sockets.
//
// Nothing in this file touches a socket either: it is handed a way to send (`TableIO`), so it can be run and tested
// on its own.
import crypto from 'node:crypto';
import type { Result, Rng, Rules } from './games/cards.ts';
import { hearts } from './games/hearts.ts';
import { spades } from './games/spades.ts';
import { rummy } from './games/rummy.ts';
import { chess } from './games/chess.ts';
import { checkers } from './games/checkers.ts';
import { four } from './games/four.ts';
import { mancala } from './games/mancala.ts';
import { go } from './games/go.ts';
import { mahjong } from './games/mahjong.ts';

export const GAMES: Record<string, Rules<any>> = { hearts, spades, rummy, mahjong, chess, checkers, go, four, mancala };
/** How long somebody who has dropped off keeps their seat before the others may hand it to the computer. */
export const AWAY_GRACE = 15_000;

export type TableIO = {
  /** Sends something to every window one person has open. */
  send(userId: string, msg: unknown): void;
  /** Everybody connected right now. */
  everyone(): string[];
  online(userId: string): boolean;
  /** Runs something a little later (a computer player taking its turn). */
  later?(fn: () => void, ms: number): void;
  now?(): number;
  rng?: Rng;
};
type Seat = { userId: string | null; bot: boolean };
export type TableView = {
  kind: string | null; phase: 'lobby' | 'playing' | 'over';
  /** Who picked the game. */
  host: string | null;
  seats: { userId: string | null; bot: boolean; away: boolean }[];
  /** The seat of whoever this is for, or -1 if they are watching. */
  you: number;
  /** What that seat may see of the game (see each game's `view`). */
  game: Record<string, unknown> | null;
  result: Result | null;
  /** The seats that may do something now. */
  turn: number[];
  /** Fewest seats that must be filled to start, and whether the computer can fill seats. */
  min: number; bots: boolean;
};

export function makeTable(io: TableIO) {
  const later = io.later ?? ((fn, ms) => { setTimeout(fn, ms).unref(); });
  const now = io.now ?? Date.now;
  const rng: Rng = io.rng ?? (() => crypto.randomInt(0x1_0000_0000) / 0x1_0000_0000);

  let kind: string | null = null;
  let phase: TableView['phase'] = 'lobby';
  let host: string | null = null;
  let seats: Seat[] = [];
  let state: any = null;
  /** Counts games, so a computer player's turn that was waiting when its game ended does nothing. */
  let gameId = 0;
  let thinking = -1;
  /** When each seated person dropped off. */
  const awayAt = new Map<string, number>();

  const rules = () => (kind && Object.hasOwn(GAMES, kind) ? GAMES[kind] : null);
  const seatOf = (userId: string) => seats.findIndex((s) => !s.bot && s.userId === userId);
  const filled = (s: Seat) => s.bot || s.userId !== null;
  const people = () => seats.filter((s) => !s.bot && s.userId !== null);

  function view(userId: string): TableView {
    const r = rules();
    const you = seatOf(userId);
    return {
      kind, phase, host, you,
      seats: seats.map((s) => ({ userId: s.userId, bot: s.bot, away: !s.bot && s.userId !== null && !io.online(s.userId) })),
      game: r && state ? r.view(state, you) : null,
      result: r && state && phase === 'over' ? r.result(state) : null,
      turn: r && state && phase === 'playing' ? r.turn(state) : [],
      min: r ? r.seats[0] : 0, bots: !!r?.bots,
    };
  }
  /** One snapshot each, to everybody connected. */
  function push() { for (const id of io.everyone()) io.send(id, { t: 'game', table: view(id) }); }
  const refuse = (userId: string, error: string) => io.send(userId, { t: 'game', error });

  function toLobby() {
    gameId++;
    state = null;
    phase = 'lobby';
    // (anybody who dropped off during the game does not hold a seat at an empty table)
    for (const s of seats) if (!s.bot && s.userId !== null && !io.online(s.userId)) s.userId = null;
  }
  function begin() {
    const r = rules()!;
    gameId++;
    state = r.start(seats.length, rng);
    phase = 'playing';
  }
  /** After anything that changed the game: is it over, and is it a computer player's turn? */
  function settle() {
    const r = rules();
    if (!r || phase !== 'playing') return;
    if (r.result(state)) { phase = 'over'; gameId++; return; }
    if (!people().length) { toLobby(); return; }            // only computers left: nobody is playing
    think();
  }
  function think() {
    const r = rules();
    if (!r?.bot || phase !== 'playing' || thinking === gameId) return;
    const ready = r.turn(state).some((i) => seats[i]?.bot && r.bot!(state, i, rng) != null);
    if (!ready) return;
    const id = (thinking = gameId);
    later(() => {
      if (thinking === id) thinking = -1;
      if (id !== gameId || phase !== 'playing') return;
      try {
        for (const i of r.turn(state)) {
          if (!seats[i]?.bot) continue;
          const m = r.bot!(state, i, rng);
          if (m == null) continue;
          const err = r.move(state, i, m, rng);
          if (err) { console.error('[games] a computer player tried something illegal:', kind, JSON.stringify(m), err); return; }
          break;
        }
      } catch (e) { console.error('[games]', e); return; }
      settle();
      push();
    }, r.pause?.(state) ?? 800);
  }

  /** Something from a person's page. Nothing in `d` is trusted. */
  function handle(userId: string, d: any) {
    if (!d || typeof d !== 'object' || typeof d.op !== 'string') return;
    const r = rules();
    const me = seatOf(userId);
    const seat: number = Number.isInteger(d.seat) && d.seat >= 0 && d.seat < seats.length ? d.seat : -1;
    switch (d.op) {
      case 'sync': {                // "what is on the table?": asked when a page connects
        const back = awayAt.delete(userId);
        if (back && me >= 0) push(); else io.send(userId, { t: 'game', table: view(userId) });
        return;
      }
      case 'pick': {                // choose the game (or none): only between games
        if (phase === 'playing') return refuse(userId, 'A game is being played. End it first.');
        if (d.kind === null) { kind = null; seats = []; host = null; toLobby(); return push(); }
        if (typeof d.kind !== 'string' || !Object.hasOwn(GAMES, d.kind)) return;
        // People stay where they are sitting if the new game has that seat (partners stay partners), or move up to a free one.
        const max = GAMES[d.kind].seats[1];
        const next: Seat[] = Array.from({ length: max }, () => ({ userId: null, bot: false }));
        const staying = seats.map((s) => (!s.bot && s.userId !== null && io.online(s.userId) ? s : null));
        staying.forEach((s, i) => { if (s && i < max) next[i] = s; });
        staying.forEach((s, i) => { const free = next.findIndex((x) => x.userId === null); if (s && i >= max && free >= 0) next[free] = s; });
        kind = d.kind;
        host = userId;
        seats = next;
        toLobby();
        return push();
      }
      case 'sit': {
        if (!r || seat < 0) return;
        const target = seats[seat];
        if (phase === 'lobby') {
          if (!target.bot && target.userId !== null && target.userId !== userId) return refuse(userId, 'That seat is taken.');
          if (me >= 0) seats[me] = { userId: null, bot: false };
          seats[seat] = { userId, bot: false };
          return push();
        }
        if (phase !== 'playing') return;
        if (me >= 0) return refuse(userId, 'You already have a seat.');
        if (!target.bot) return refuse(userId, 'That seat is taken.');      // mid-game, a person can take over from the computer
        seats[seat] = { userId, bot: false };
        return push();
      }
      case 'stand': {
        if (!r || me < 0) return;
        if (phase === 'playing') {
          if (r.bots) seats[me] = { userId: null, bot: true };              // the computer plays their cards on
          else { const err = r.move(state, me, { a: 'resign' }, rng); if (err) return refuse(userId, err); }
          settle();
        } else seats[me] = { userId: null, bot: false };
        return push();
      }
      case 'bot': {                 // put a computer player in an empty seat, or take it out again
        if (!r || seat < 0 || phase !== 'lobby') return;
        if (!r.bots) return refuse(userId, 'This game is for people only.');
        const target = seats[seat];
        if (target.bot) seats[seat] = { userId: null, bot: false };
        else if (target.userId === null) seats[seat] = { userId: null, bot: true };
        else return refuse(userId, 'That seat is taken.');
        return push();
      }
      case 'start': {
        if (!r || phase !== 'lobby') return;
        if (me < 0) return refuse(userId, 'Take a seat first.');
        // A game for exactly four is filled up with computer players; otherwise the empty seats are left out.
        if (r.bots && r.seats[0] === r.seats[1]) seats = seats.map((s) => (filled(s) ? s : { userId: null, bot: true }));
        const playing = seats.filter(filled);
        if (playing.length < r.seats[0]) return refuse(userId, r.bots ? `This needs ${r.seats[0]} players. Add a computer player or two.` : `This needs ${r.seats[0]} people.`);
        seats = playing;
        begin();
        settle();
        return push();
      }
      case 'move': {
        if (!r || phase !== 'playing') return;                // (also: a move for a game that is no longer there)
        if (me < 0) return refuse(userId, 'You are watching this one.');
        let err: string | null;
        try { err = r.move(state, me, d.m, rng); } catch (e) { console.error('[games]', kind, e); err = 'That could not be read.'; }
        if (err) return refuse(userId, err);
        settle();
        return push();
      }
      case 'replace': {             // hand an absent player's seat to the computer
        if (!r || phase !== 'playing' || seat < 0 || me < 0) return;
        const target = seats[seat];
        if (!r.bots || target.bot || target.userId === null) return;
        if (io.online(target.userId)) return refuse(userId, 'They are here.');
        if (now() - (awayAt.get(target.userId) ?? 0) < AWAY_GRACE) return refuse(userId, 'Give them a few more seconds to come back.');
        seats[seat] = { userId: null, bot: true };
        settle();
        return push();
      }
      case 'end': {                 // stop the game and go back to the seats
        if (!r || phase === 'lobby') return;
        if (me < 0 && people().some((s) => io.online(s.userId!))) return refuse(userId, 'Only the people playing can end it.');
        toLobby();
        return push();
      }
      case 'again': {               // the same game again, same seats
        if (!r || phase !== 'over') return;
        if (me < 0) return refuse(userId, 'Take a seat first.');
        begin();
        settle();
        return push();
      }
    }
  }

  /** Somebody's last window has closed. In a game they keep their seat; at an empty table they do not. */
  function gone(userId: string) {
    const me = seatOf(userId);
    if (me < 0) return;
    if (phase === 'lobby') seats[me] = { userId: null, bot: false };
    else awayAt.set(userId, now());
    push();
  }

  return { handle, gone, view, /** for tests: the game itself */ peek: () => ({ kind, phase, seats, state }) };
}
