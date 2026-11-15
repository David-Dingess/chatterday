import type { Theme } from './theme';
import type { Look } from '../../shared/look.ts';
import type { PetLook } from '../../shared/pet.ts';
import type { Desk } from '../../shared/desk.ts';

export type { Look, PetLook, Desk };

/** `look`, `pet` and `desk` are what the person built for themselves (null until they have); this app draws them. */
export type User = { id: string; name: string; color: string; avatar: string | null; emoji: string; role: string; status: string; look: Look | null; pet: PetLook | null; desk: Desk | null; talk?: number | null; birthday?: string | null; seenAt?: number | null };
export type Me = User & { theme: Theme | null; invisible: boolean; entrance?: number | null; exit?: number | null; /** my settings as the server last had them, and when they were changed */ prefs?: Record<string, unknown> | null; prefsAt?: number };
export type Channel = { id: number; name: string; kind: 'text' | 'voice'; position: number };
export type VoiceInfo = { channelId: number; muted: boolean; deafened: boolean; sharing: boolean; /** whose shared screens they have open */ watching?: string[]; /** they have the Player's video large */ big?: boolean };
export type Place = '' | 'gaming' | 'watching' | 'kitchen' | 'bathroom' | 'sleeping' | 'working' | 'cleaning' | 'exercising' | 'showering' | 'away' | 'here';
export type Presence = { state: 'offline' | 'away' | 'desk' | 'gaming' | 'watching'; label: string; voice: VoiceInfo | null; place?: Place; since?: number; /** which desk and bunk they hold while online (0 to 5), 6 and up for a visitor with a laptop, -1 if none */ slot?: number;
  /** With place 'here': the seat they clicked (living3, seat2, table0), or the point on the floor they are standing at. */
  at?: { x: number; y: number; seat?: string };
  /** A drink from the fridge, in their hand for eight minutes. `since` tells one drink from the next. */
  drink?: { kind: string; since: number } };
export type Attachment =
  | { kind: 'file'; id: string; url: string; mime: string; name: string; size: number }
  | { kind: 'image'; url: string; name: string }
  | { kind: 'theme'; theme: Theme }
  | { kind: 'link'; url: string; title: string; description: string; image: string; site: string };
export type Message = {
  id: number; channelId: number; userId: string; content: string; attachments: Attachment[];
  createdAt: number; editedAt: number | null; reactions: Record<string, string[]>;
};
export type Sound = { id: number; name: string; emoji: string; url: string; userId: string; /** set on a person's own entrance clip (from the server's "entrance sounds" folder): their id. Not a soundboard button. */ entranceFor?: string };
export type Track = { videoId: string; title: string; seconds: number };
export type Playlist = { id: number; name: string; userId: string; items: (Track & { id: number })[] };
export type Song = { id: number; videoId: string; title: string; by: string; seconds: number };
/** What is playing: `startedAt` is when it began (on the server's clock); `pausedAt` is how far in it stands while paused for everyone. */
export type Playing = Song & { startedAt: number; pausedAt?: number | null; /** a live stream: no length, no bar */ live?: boolean };
export type Music = { current: Playing | null; queue: Song[]; now: number };
export type Weather = { kind: 'clear' | 'clouds' | 'rain' | 'storm' | 'snow' | 'fog'; cover: number; text: string; temp: number | null; unit: 'F' | 'C'; at: number };
/** `tz`: the clock the house keeps; `town`: where its weather is read for ('' for none); `photo`: the picture on the lounge wall. */
export type ServerSettings = { serverName: string; publicUrl: string; voice: boolean; gifKey: string; appVersion?: string; tz: string; town: string; unit: 'F' | 'C'; photo: string | null };

// ── the game table (the server's side is server/games.ts, and the rules of each game are in server/games/) ──
export type GameKind = 'hearts' | 'spades' | 'rummy' | 'chess' | 'checkers' | 'mahjong' | 'go' | 'four' | 'mancala';
/** A card is its rank then its suit: "QS" is the queen of spades, "TH" the ten of hearts. */
export type PlayedCard = { seat: number; card: string };
export type LastTrick = { cards: PlayedCard[]; winner: number } | null;
export type HeartsView = {
  phase: 'pass' | 'play' | 'handEnd' | 'over'; handNo: number; passDir: 'left' | 'right' | 'across' | 'hold'; target: number;
  hand: string[]; counts: number[]; passed: boolean[]; myPass: string[] | null; received: string[] | null;
  trick: PlayedCard[]; leader: number; turn: number; legal: string[]; broken: boolean; taken: number[]; scores: number[];
  last: LastTrick; summary: { points: number[]; moon: number } | null;
};
export type SpadesView = {
  phase: 'bid' | 'play' | 'handEnd' | 'over'; handNo: number; dealer: number; target: number; floor: number;
  hand: string[]; counts: number[]; /** 0 is nil; null until they have bid */ bids: (number | null)[]; won: number[];
  trick: PlayedCard[]; leader: number; turn: number; legal: string[]; broken: boolean;
  /** for the two sides: seats 0 and 2, seats 1 and 3 */ scores: number[]; bags: number[];
  last: LastTrick; summary: { points: number[]; lines: string[][] } | null;
};
export type RummyMeld = { kind: 'set' | 'run'; cards: string[] };
export type RummyView = {
  phase: 'draw' | 'play' | 'handEnd' | 'over'; handNo: number; dealer: number; target: number;
  hand: string[]; counts: number[]; stock: number; top: string | null; pile: number; melds: RummyMeld[]; turn: number;
  /** the card I took from the discard pile this turn (it cannot go straight back) */ took: string | null; scores: number[];
  summary: { winner: number; left: number[]; points: number; blocked: boolean } | null;
};
/** `board` is 64 squares from a8 along each rank to h1: capitals are White, small letters Black, a dot is empty. */
export type ChessView = {
  board: string; turn: number; check: boolean; /** for whoever is to move: from each square, where that piece may go */ legal: Record<number, number[]>;
  last: [number, number] | null; log: string[]; ply: number; offer: number | null; taken: string;
};
/** `board` is 64 squares from the top-left: r/w are pieces, R/W kings. `legal` holds each move as the squares it passes through. */
export type CheckersView = { board: string; turn: number; legal: number[][]; last: number[] | null; offer: number | null; ply: number; left: number[] };
/** `board` is 42 spaces from the top-left, seven to a row: r, y or a dot. `line` is the four that won. */
export type FourView = { board: string; turn: number; last: number | null; line: number[] | null; ply: number };
/** The fourteen places in the order the stones travel: 0 to 5 seat 0's pits, 6 its store, 7 to 12 seat 1's pits, 13 its store. */
export type MancalaView = { pits: number[]; turn: number; ply: number; last: { seat: number; from: number; to: number; again: boolean; took: number } | null };
/** `board` is n by n crossings from the top-left: b, w or a dot. While the dead stones are being agreed (and after),
 *  `owner` says whose each crossing counts as and `score` is black's and white's count. */
export type GoView = {
  n: number; board: string; turn: number; ply: number; /** -1 for a pass */ last: number | null; caps: number[]; passes: number;
  phase: 'play' | 'mark' | 'over'; dead: number[]; agreed: boolean[]; owner: string | null; score: number[] | null; komi: number;
};
/** A mahjong tile is a number: 0 to 8 dots, 9 to 17 bamboo, 18 to 26 characters, 27 to 30 the winds (east, south, west,
 *  north), 31 to 33 the red, green and white dragons. */
export type MahjongMeld = { kind: 'chow' | 'pung' | 'kong'; from: number; open: boolean; /** empty when it lies face down */ tiles: number[] };
/** What throwing one tile would leave: how many tiles from ready, and the tiles (and how many of them are left) that would then help. */
export type MahjongThrow = { tile: number; away: number; helps: number[]; left: number };
export type MahjongView = {
  phase: 'turn' | 'claim' | 'handEnd' | 'over'; handNo: number; hands: number; dealer: number; turn: number; wall: number;
  hand: number[]; /** the tile I have just drawn */ drew: number | null; counts: number[]; melds: MahjongMeld[][]; discards: number[][];
  last: { seat: number; tile: number } | null; said: { seat: number; what: 'chow' | 'pung' | 'kong'; tile: number } | null; scores: number[];
  summary: {
    winner: number; from: number; tile: number; lines: { name: string; faan: number }[]; faan: number; base: number; pay: number[];
    sets: { tiles: number[]; open: boolean }[]; pair: number[]; hands: number[][];
  } | null;
  /** on my turn: whether my hand has won, and the kongs I could declare */
  can: { win: boolean; kongs: number[] } | null;
  /** a thrown tile on offer: `mine` is what I may do with it, and how far from ready each would leave me */
  claim: { tile: number; from: number; answered: boolean; mine: { win: boolean; kong: boolean; pung: boolean; chows: number[][]; after: { pung: number | null; kong: number | null; chows: number[] } } | null } | null;
  /** the coach's sums for my hand: how many tiles it is from ready (0: one tile from winning), each throw I could make
   *  (best first) on my turn, or else the tiles I am hoping for and how many of them are left */
  hint: { away: number; throws?: MahjongThrow[]; tiles?: number[]; left?: number } | null;
};
export type GameSeat = { userId: string | null; bot: boolean; /** dropped off: the seat is kept for them */ away: boolean };
/** Everything this person may see of the table: one of these arrives whenever anything changes. */
export type GameTable = {
  kind: GameKind | null; phase: 'lobby' | 'playing' | 'over'; host: string | null; seats: GameSeat[];
  /** my seat, or -1 if I am watching */ you: number;
  game: HeartsView | SpadesView | RummyView | ChessView | CheckersView | MahjongView | GoView | FourView | MancalaView | null;
  result: { winners: number[]; text: string } | null;
  /** the seats that may do something now */ turn: number[]; min: number; bots: boolean;
};
