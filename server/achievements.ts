// Achievements: things people do in Chatterday, counted on the server and kept for good. The trophy rack in the unfinished
// basement shows them (client/src/achievements.tsx); a toast in the bottom right corner tells whoever earns one, and
// nobody else.
//
// How it works. Each person has counters (a number under a key: 'pee', 'voiceMin', 'toss'...) and, for "every kind of"
// achievements, sets (the things seen under a key, their count is the counter). An achievement with a `key` and a `goal`
// is earned when that counter reaches the goal; one without is earned when the server calls award() at the moment it
// happens. Counters and unlock times are in two small tables (ach_count, ach_got), so a restart keeps everything.
//
// The rest of the server reports what happens through `achieve` (below), one line at each place: achieve.count(uid,
// 'pee'), achieve.award(uid, 'breakEight'), achieve.won('pool', [winner], [loser]). None of it ever throws into the caller:
// a broken achievement must never break a game.
//
// Backfill: what the server already kept for good is read once at every start (paper balls in the bin, arcade scores,
// golden marshmallows, sudoku books, birthday candles blown out, chat messages, the last 14 days of voice), and only ever
// raises a counter (max), so it can run again and again. Everything else starts at zero on the day this shipped.
import { all, db, get, run } from './db.ts';
import { COLS, ROWS, hoursSince } from '../client/src/basement/lawn.ts';
import type { Lawn } from '../client/src/basement/lawn.ts';
import { KINDS as LAKE_KINDS } from '../client/src/basement/lake.ts';
import { houseHour } from './clock.ts';

/** The lake's kinds, for its achievements: the fish of the Field Guide (not the legendary or mythical ones), and the junk. */
const FIELD_GUIDE = LAKE_KINDS.filter((k) => k.lb && (k.rarity === 'common' || k.rarity === 'uncommon' || k.rarity === 'rare')).map((k) => k.id);
const LAKE_JUNK = LAKE_KINDS.filter((k) => k.rarity === 'junk').map((k) => k.id);

/** house: the clubhouse upstairs and its statuses; social: people and voice; table: the Game Table, Draw & Guess,
 *  sudoku; gameroom: the basement's game room and the arcade; yard: the backyard and the campsite; odd: everything else.
 *  lake: kept for the fishing achievements to come (the client already has its badge). */
export type Cat = 'house' | 'social' | 'table' | 'gameroom' | 'yard' | 'odd' | 'lake';
/** 1 easy, 2 a grind, 3 rare. */
export type Def = { id: string; name: string; text: string; cat: Cat; tier: 1 | 2 | 3; hidden?: boolean; key?: string; goal?: number };

const MIN = 60;
export const DEFS: Def[] = [
  // ── the clubhouse ──
  { id: 'firstPee', cat: 'house', tier: 1, name: 'Breaking the Seal', text: 'Pee for the first time.', key: 'pee', goal: 1 },
  { id: 'pee100', cat: 'house', tier: 2, name: 'Range Finder', text: 'Pee 100 times, from whatever distance felt right.', key: 'pee', goal: 100 },
  { id: 'poop50', cat: 'house', tier: 2, name: 'Throne Room', text: 'Go and sit on the throne 50 times.', key: 'poop', goal: 50 },
  { id: 'shower25', cat: 'house', tier: 2, name: 'Squeaky Clean', text: 'Take 25 showers.', key: 'shower', goal: 25 },
  { id: 'work50', cat: 'house', tier: 2, name: 'Clocked In', text: 'Say you are Working 50 times.', key: 'work', goal: 50 },
  { id: 'doom25', cat: 'house', tier: 2, name: 'Thumb Workout', text: 'Doomscroll 25 times.', key: 'doom', goal: 25 },
  { id: 'prompt25', cat: 'house', tier: 2, name: 'Prompt Engineer', text: 'Say you are Prompting 25 times.', key: 'prompt', goal: 25 },
  { id: 'tour', cat: 'house', tier: 2, name: 'Man About the House', text: 'Pick 12 different answers to Where are you?', key: 'places', goal: 12 },
  { id: 'stillUp', cat: 'house', tier: 3, hidden: true, name: 'Still Up', text: 'Be gaming between 3 and 5 in the morning.' },
  { id: 'toss5', cat: 'house', tier: 2, name: 'Heating Up', text: 'Get five paper balls in the bin in a row.', key: 'tossRun', goal: 5 },
  { id: 'toss100', cat: 'house', tier: 2, name: 'Waste Management', text: 'Get 100 paper balls in the bin.', key: 'toss', goal: 100 },
  { id: 'goal', cat: 'house', tier: 1, name: 'Top Bins', text: 'Kick the football into the goal.' },
  // ── people and voice ──
  { id: 'voice10', cat: 'social', tier: 1, name: 'Pull Up a Chair', text: 'Spend 10 minutes in a voice chat.', key: 'voiceMin', goal: 10 },
  { id: 'voice100h', cat: 'social', tier: 2, name: 'Regular', text: 'Spend 100 hours in voice.', key: 'voiceMin', goal: 100 * MIN },
  { id: 'voice500h', cat: 'social', tier: 3, name: 'Part of the Furniture', text: 'Spend 500 hours in voice.', key: 'voiceMin', goal: 500 * MIN },
  { id: 'fullSquad', cat: 'social', tier: 3, name: 'Full Squad', text: 'Be in a voice chat when all six are in it.' },
  { id: 'chat1000', cat: 'social', tier: 2, name: 'Chatterbox', text: 'Send 1,000 messages.', key: 'chat', goal: 1000 },
  { id: 'dance50', cat: 'social', tier: 2, name: 'Floor Filler', text: 'Dance 50 times.', key: 'dance', goal: 50 },
  { id: 'hugs', cat: 'social', tier: 2, name: 'Group Hug', text: 'Hug five different people.', key: 'hugged', goal: 5 },
  { id: 'punch', cat: 'social', tier: 1, hidden: true, name: 'Fight Club', text: 'Throw your first punch.' },
  { id: 'pet100', cat: 'social', tier: 2, name: 'Who Is a Good Boy', text: 'Pet the pets 100 times.', key: 'pet', goal: 100 },
  { id: 'allPets', cat: 'social', tier: 3, name: 'Petting Zoo', text: 'Pet every pet in the house.', key: 'pets', goal: 8 },
  { id: 'sound500', cat: 'social', tier: 2, name: 'Soundboard Menace', text: 'Play 500 soundboard sounds.', key: 'sound', goal: 500 },
  { id: 'dj50', cat: 'social', tier: 2, name: 'Aux Cord', text: 'Put 50 songs on the Player.', key: 'dj', goal: 50 },
  // ── the Game Table, the whiteboard, the sudoku book ──
  { id: 'tableWin', cat: 'table', tier: 1, name: 'Pull Up a Seat', text: 'Win a game at the Game Table.', key: 'tableWins', goal: 1 },
  { id: 'table50', cat: 'table', tier: 3, name: 'House Rules', text: 'Win 50 games at the Game Table.', key: 'tableWins', goal: 50 },
  { id: 'cards', cat: 'table', tier: 2, name: 'Card Shark', text: 'Win at Hearts, Spades and Rummy.', key: 'cardWins', goal: 3 },
  { id: 'boards', cat: 'table', tier: 3, name: 'Board Certified', text: 'Win at Chess, Checkers, Go, Four in a Row and Mancala.', key: 'boardWins', goal: 5 },
  { id: 'mahjong', cat: 'table', tier: 2, name: 'Mahjong!', text: 'Win a game of Mahjong.' },
  { id: 'pictWin', cat: 'table', tier: 2, name: 'Picasso', text: 'Win a game of Draw & Guess.' },
  { id: 'sudoku1', cat: 'table', tier: 1, name: 'Light Reading', text: 'Finish a sudoku from the book by the toilet.', key: 'sudoku', goal: 1 },
  { id: 'sudoku25', cat: 'table', tier: 2, name: 'Bathroom Reading', text: 'Finish 25 sudokus.', key: 'sudoku', goal: 25 },
  { id: 'sudokuExpert', cat: 'table', tier: 3, name: 'Grid Lord', text: 'Solve an Expert sudoku.', key: 'sudokuExpert', goal: 1 },
  { id: 'sudokuFast', cat: 'table', tier: 2, name: 'Speed Solver', text: 'Solve an Easy sudoku in under 4 minutes.' },
  // ── the game room and the arcade ──
  { id: 'poolWin', cat: 'gameroom', tier: 1, name: "Rack 'Em", text: 'Win a game of pool against a friend.' },
  { id: 'breakEight', cat: 'gameroom', tier: 3, name: 'Eight on the Break', text: 'Sink the 8 on the break.' },
  { id: 'house', cat: 'gameroom', tier: 2, name: 'Beat the House', text: 'Win a game of pool against the house.' },
  { id: 'bull', cat: 'gameroom', tier: 1, name: 'Bullseye', text: 'Hit the inner bull.' },
  { id: 'ton80', cat: 'gameroom', tier: 3, name: 'One Hundred and Eighty', text: 'Three treble 20s in one turn.' },
  { id: 'turkey', cat: 'gameroom', tier: 2, name: 'Turkey', text: 'Bowl three strikes in a row.', key: 'strikeRun', goal: 3 },
  { id: 'gutter', cat: 'gameroom', tier: 1, hidden: true, name: 'Bumpers Exist for a Reason', text: 'Bowl a gutter ball.' },
  { id: 'bowl200', cat: 'gameroom', tier: 3, name: 'Two Hundred Club', text: 'Bowl a 200 game.' },
  { id: 'ace', cat: 'gameroom', tier: 2, name: 'Ace', text: 'A hole in one at mini golf.' },
  { id: 'dogleg', cat: 'gameroom', tier: 3, name: 'Around the Bend', text: 'A hole in one on The Dogleg.' },
  { id: 'underPar', cat: 'gameroom', tier: 2, name: 'Under Par', text: 'Finish a round of mini golf under par.' },
  { id: 'shuffleWin', cat: 'gameroom', tier: 1, name: 'Hammer Time', text: 'Win a game of shuffleboard against a friend.' },
  { id: 'fullHouse', cat: 'gameroom', tier: 2, name: 'Full Boat', text: "Win a Hold'em hand with a full house or better." },
  { id: 'sevenTwo', cat: 'gameroom', tier: 3, hidden: true, name: 'The Hammer', text: "Win a Hold'em hand holding 7-2 offsuit." },
  { id: 'arcadeAll', cat: 'gameroom', tier: 1, name: 'Quarter Muncher', text: 'Post a score on all four arcade games.', key: 'arcade', goal: 4 },
  { id: 'arcadeTop', cat: 'gameroom', tier: 2, name: 'High Score', text: "Take the top score on an arcade game from somebody else." },
  // ── outside: the backyard and the campsite ──
  { id: 'lawn', cat: 'yard', tier: 3, name: 'Mow the Whole Lawn', text: 'Be pushing the mower when the whole lawn is freshly cut.' },
  { id: 'grass', cat: 'yard', tier: 2, name: 'Groundskeeper', text: 'Cut 5,000 patches of long grass.', key: 'grass', goal: 5000 },
  { id: 'cornhole', cat: 'yard', tier: 1, name: 'Cornhole!', text: 'Sink a bag in the hole.', key: 'cornhole', goal: 1 },
  { id: 'ringer', cat: 'yard', tier: 1, name: 'Ringer', text: 'Throw a horseshoe ringer.', key: 'ringer', goal: 1 },
  { id: 'clutch', cat: 'yard', tier: 3, name: 'Rebuttal', text: 'Clear the last cups in a beer pong rebuttal and force overtime.' },
  { id: 'yardWins', cat: 'yard', tier: 3, name: 'Lawn Games Legend', text: 'Win at cornhole, beer pong, horseshoes and bocce.', key: 'yardWins', goal: 4 },
  { id: 'golden', cat: 'yard', tier: 1, name: 'Golden Brown', text: 'Toast a golden marshmallow.', key: 'golden', goal: 1 },
  { id: 'burnt', cat: 'yard', tier: 1, hidden: true, name: 'An Offering', text: 'Let a marshmallow fall into the fire.' },
  { id: 'smokes', cat: 'yard', tier: 2, name: 'Sampler Platter', text: 'Take one of everything off the smoking table.', key: 'smokes', goal: 6 },
  // ── everything else ──
  { id: 'disco3am', cat: 'odd', tier: 3, hidden: true, name: 'Disco Inferno', text: 'Turn the disco lights on at 3 AM.' },
  { id: 'mirror', cat: 'odd', tier: 1, name: 'Steamy', text: 'Write on the steamed-up bathroom mirror.' },
  { id: 'vacuum10', cat: 'odd', tier: 1, name: 'Roomba Wrangler', text: 'Send the robot vacuum off to clean 10 times.', key: 'vacuum', goal: 10 },
  { id: 'candles', cat: 'odd', tier: 2, name: 'Make a Wish', text: 'Blow out the candles on a birthday cake.' },
  { id: 'nat20', cat: 'odd', tier: 1, name: 'Natural 20', text: 'Roll a natural 20 in the DnD room.' },
  { id: 'nat1', cat: 'odd', tier: 1, hidden: true, name: 'Critical Fail', text: 'Roll a natural 1 in the DnD room.' },
  { id: 'collector', cat: 'odd', tier: 3, name: 'Trophy Hunter', text: 'Earn 30 achievements.', key: 'earned', goal: 30 },
  // ── the lake (fishing): from the lake's catch log, through fishCatch() below (server/basement/lake.ts calls it) ──
  { id: 'firstFish', cat: 'lake', tier: 1, name: 'Gone Fishing', text: 'Catch a fish at the lake.', key: 'fish', goal: 1 },
  { id: 'fish100', cat: 'lake', tier: 2, name: 'Reel Regular', text: 'Catch 100 fish.', key: 'fish', goal: 100 },
  { id: 'fishKinds', cat: 'lake', tier: 3, name: 'Field Guide', text: 'Catch every kind of fish in the lake (the legendary and mythical ones aside).', key: 'fishKinds', goal: FIELD_GUIDE.length },
  { id: 'muskie', cat: 'lake', tier: 3, name: 'Ten Thousand Casts', text: 'Land a muskie.' },
  { id: 'goldFish', cat: 'lake', tier: 3, hidden: true, name: 'Midas Touch', text: 'Catch the golden fish.' },
  { id: 'bigCat', cat: 'lake', tier: 2, name: 'Whiskers', text: 'Land a catfish over 20 pounds.' },
  { id: 'junkKinds', cat: 'lake', tier: 2, name: "One Man's Trash", text: 'Pull up every kind of junk in the lake.', key: 'junkKinds', goal: LAKE_JUNK.length },
  { id: 'treasure', cat: 'lake', tier: 2, hidden: true, name: 'X Marks the Spot', text: 'Fish up a treasure chest.' },
  { id: 'ghostFish', cat: 'lake', tier: 3, hidden: true, name: 'Seeing Things', text: 'Catch the ghost fish.' },
  { id: 'serpent', cat: 'lake', tier: 3, hidden: true, name: 'Here Be Dragons', text: 'Land the Lake Serpent.' },
  { id: 'clockwork', cat: 'lake', tier: 3, hidden: true, name: 'Like Clockwork', text: 'Land the Clockwork Carp (it only bites on a perfect cast).' },
  { id: 'coelacanth', cat: 'lake', tier: 3, hidden: true, name: 'Living Fossil', text: 'Catch a coelacanth.' },
  { id: 'royalty', cat: 'lake', tier: 2, hidden: true, name: 'Heavy Is the Head', text: 'Fish up the lost crown.' },
  { id: 'proposal', cat: 'lake', tier: 2, hidden: true, name: 'Put a Ring on It', text: 'Fish up a diamond ring.' },
  { id: 'bottle', cat: 'lake', tier: 1, name: 'Pen Pal', text: 'Fish up a message in a bottle.' },
  { id: 'controller', cat: 'lake', tier: 1, hidden: true, name: 'Controller Disconnected', text: 'Fish a game controller out of the lake.' },
];
const BY_ID = new Map(DEFS.map((d) => [d.id, d]));
const BY_KEY = new Map<string, Def[]>();
for (const d of DEFS) if (d.key) BY_KEY.set(d.key, [...(BY_KEY.get(d.key) ?? []), d]);

// ── storage ──
db.exec(`
CREATE TABLE IF NOT EXISTS ach_got (user_id TEXT NOT NULL, id TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (user_id, id));
CREATE TABLE IF NOT EXISTS ach_count (user_id TEXT NOT NULL, key TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, items TEXT, PRIMARY KEY (user_id, key));
`);
const gotOf = (uid: string, id: string) => !!get('SELECT 1 FROM ach_got WHERE user_id = ? AND id = ?', uid, id);
const nOf = (uid: string, key: string) => get<{ n: number }>('SELECT n FROM ach_count WHERE user_id = ? AND key = ?', uid, key)?.n ?? 0;
const setN = (uid: string, key: string, n: number) =>
  run('INSERT INTO ach_count (user_id, key, n) VALUES (?, ?, ?) ON CONFLICT (user_id, key) DO UPDATE SET n = excluded.n', uid, key, n);
/** Somebody who can earn things: a person with an account (not the house, not a computer player, not removed). */
const isPerson = (uid: unknown): uid is string => typeof uid === 'string' && !!uid && !!get("SELECT 1 FROM users WHERE id = ? AND role != 'removed'", uid);

// ── telling people ──
type Listener = (uid: string, ids: string[]) => void;
let listener: Listener | null = null;
let quiet = false;                              // (the backfill at start: nobody is told, there is nobody to tell)
const fresh = new Map<string, string[]>();
function tellLater(uid: string, id: string) {
  if (quiet || !listener) return;
  const had = fresh.get(uid);
  if (had) { had.push(id); return; }
  fresh.set(uid, [id]);
  // (a moment later, so several earned by one thing arrive together, in one message)
  setTimeout(() => { const ids = fresh.get(uid) ?? []; fresh.delete(uid); try { listener?.(uid, ids); } catch (e) { console.error('[achievements]', e); } }, 50).unref?.();
}

/** Earns it now (once only: a second time does nothing). */
function unlock(uid: string, id: string, at = Date.now()) {
  const def = BY_ID.get(id);
  if (!def || !isPerson(uid) || gotOf(uid, id)) return false;
  run('INSERT INTO ach_got (user_id, id, at) VALUES (?, ?, ?)', uid, id, at);
  console.log(`[achievement] ${uid} earned ${def.name}`);
  tellLater(uid, id);
  if (id !== 'collector') setTo(uid, 'earned', get<{ n: number }>("SELECT COUNT(*) AS n FROM ach_got WHERE user_id = ? AND id != 'collector'", uid)!.n);
  return true;
}
/** A counter has moved: anything it has now reached is earned. */
function check(uid: string, key: string, n: number) {
  for (const d of BY_KEY.get(key) ?? []) if (n >= (d.goal ?? 1)) unlock(uid, d.id);
}
function setTo(uid: string, key: string, n: number) {
  setN(uid, key, n);
  check(uid, key, n);
}
const lastCount = new Map<string, number>();
/** Runs in a row so far (achieve.streak), in memory only. */
const runs = new Map<string, number>();
const safe = <F extends (...a: any[]) => void>(fn: F): F => ((...a: Parameters<F>) => { try { fn(...a); } catch (e) { console.error('[achievements]', e); } }) as F;

const CARDS = new Set(['hearts', 'spades', 'rummy']), BOARDS = new Set(['chess', 'checkers', 'go', 'four', 'mancala']);
const YARD = new Set(['cornhole', 'beerpong', 'horseshoes', 'bocce']);
/** The Where-are-you statuses, and the counter each one adds to. */
const PLACE_KEYS: Record<string, string> = { peeing: 'pee', pooping: 'poop', showering: 'shower', working: 'work', doomscrolling: 'doom', prompting: 'prompt' };
const BIG_HANDS = new Set(['Full house', 'Four of a kind', 'Straight flush', 'Royal flush']);

export const achieve = {
  /** Earns one achievement for one person (an event: the 8 on the break, a natural 20). */
  award: safe((uid: string, id: string) => { unlock(uid, id); }),
  /** Adds to a counter. `every`: not counted again for that long after the last time (no farming by clicking). */
  count: safe((uid: string, key: string, n = 1, every = 0) => {
    if (!(n > 0) || !isPerson(uid)) return;
    if (every) {
      const k = `${uid}\n${key}`, now = Date.now();
      if (now - (lastCount.get(k) ?? 0) < every) return;
      lastCount.set(k, now);
    }
    setTo(uid, key, nOf(uid, key) + Math.round(n));
  }),
  /** Raises a counter to at least `n` (a best, or a total read from somewhere else); never lowers it. */
  best: safe((uid: string, key: string, n: number) => {
    if (!(n > 0) || !isPerson(uid) || n <= nOf(uid, key)) return;
    setTo(uid, key, Math.round(n));
  }),
  /** Adds a thing to a set ("every pet", "every arcade game"); the counter is how many different things there are. */
  note: safe((uid: string, key: string, item: string) => {
    if (!item || !isPerson(uid)) return;
    const row = get<{ items: string | null }>('SELECT items FROM ach_count WHERE user_id = ? AND key = ?', uid, key);
    let items: string[] = [];
    try { items = JSON.parse(row?.items ?? '[]'); } catch { /* (start again) */ }
    if (items.includes(item)) return;
    items.push(item);
    run('INSERT INTO ach_count (user_id, key, n, items) VALUES (?, ?, ?, ?) ON CONFLICT (user_id, key) DO UPDATE SET n = excluded.n, items = excluded.items', uid, key, items.length, JSON.stringify(items));
    check(uid, key, items.length);
  }),
  /** A run of something in a row (strikes, paper balls): kept in memory, and the best run kept for good. */
  streak: safe((uid: string, key: string, hit: boolean) => {
    const k = `${uid}\n${key}`, now = hit ? (runs.get(k) ?? 0) + 1 : 0;
    runs.set(k, now);
    if (now) achieve.best(uid, `${key}Run`, now);
  }),

  // ── the events themselves, one call from each place they happen ──
  /** A catch landed at the lake (kind: the lake's id for it; w: its weight in ounces, 0 for junk). */
  fishCatch: safe((uid: string, kind: string, w: number) => {
    if (kind === 'chest') { unlock(uid, 'treasure'); return; }
    if (kind === 'crown') { unlock(uid, 'royalty'); return; }
    if (kind === 'ring') { unlock(uid, 'proposal'); return; }
    if (LAKE_JUNK.includes(kind)) {
      achieve.note(uid, 'junkKinds', kind);
      if (kind === 'bottle') unlock(uid, 'bottle');
      if (kind === 'controller') unlock(uid, 'controller');
      return;
    }
    achieve.count(uid, 'fish');
    if (FIELD_GUIDE.includes(kind)) achieve.note(uid, 'fishKinds', kind);
    if (kind === 'muskie') unlock(uid, 'muskie');
    if (kind === 'golden') unlock(uid, 'goldFish');
    if (kind === 'ghost') unlock(uid, 'ghostFish');
    if (kind === 'serpent') unlock(uid, 'serpent');
    if (kind === 'clockwork') unlock(uid, 'clockwork');
    if (kind === 'coelacanth') unlock(uid, 'coelacanth');
    if (kind === 'catfish' && w > 20 * 16) unlock(uid, 'bigCat');
  }),
  /** "Where are you?", chosen by hand. */
  place: safe((uid: string, place: string) => {
    if (place === 'here') return;
    achieve.note(uid, 'places', place);
    const key = PLACE_KEYS[place];
    if (!key) return;
    achieve.count(uid, key, 1, 2 * 60_000);
  }),
  /** What their PC says they are doing. */
  activity: safe((uid: string, state: string) => { const h = houseHour(); if (state === 'gaming' && h >= 3 && h < 5) unlock(uid, 'stillUp'); }),
  /** Dance, hug, punch, pet... (already checked as allowed). */
  act: safe((uid: string, kind: string, target: string, pet: string) => {
    if (kind === 'dance') achieve.count(uid, 'dance');
    else if (kind === 'hug' && target) achieve.note(uid, 'hugged', target);
    else if (kind === 'punch') unlock(uid, 'punch');
    else if (kind === 'pet' && pet) { achieve.count(uid, 'pet'); achieve.note(uid, 'pets', pet); }
  }),
  /** Every minute: who is in which voice chat. Six of the six in one is the full squad. */
  voiceTick: safe((rooms: Map<number, string[]>) => {
    for (const ids of rooms.values()) {
      const people = [...new Set(ids)].filter(isPerson);
      for (const id of people) achieve.count(id, 'voiceMin');
      if (people.length >= 6) for (const id of people) unlock(id, 'fullSquad');
    }
  }),
  /** A paper ball thrown at the bin: in or not, the run so far, and how many they have ever got in. */
  toss: safe((uid: string, made: boolean, total: number) => { achieve.streak(uid, 'toss', made); achieve.best(uid, 'toss', total); }),
  disco: safe((uid: string, on: boolean) => { if (on && houseHour() === 3) unlock(uid, 'disco3am'); }),
  /** An arcade score sent in (any score: their best or not). Taking the top spot from somebody else is High Score. */
  arcade: safe((uid: string, game: string, score: number) => {
    achieve.note(uid, 'arcade', game);
    const others = get<{ top: number | null }>('SELECT MAX(score) AS top FROM arcade_scores WHERE game = ? AND user_id != ?', game, uid)?.top;
    if (others != null && score > others) unlock(uid, 'arcadeTop');
  }),
  /** A game won. `winners` and `losers` are people (anything else, the house or a computer player, is left out by the
   *  caller or ignored here). Somebody playing both sides to practise beats nobody: a win needs a loser who is not them. */
  won: safe((game: string, winners: string[], losers: string[]) => {
    const w = [...new Set(winners)].filter(Boolean);
    if (!w.length || !losers.some((l) => l && !w.includes(l))) return;
    for (const uid of w) {
      if (game === 'pool') unlock(uid, 'poolWin');
      else if (game === 'shuffle') unlock(uid, 'shuffleWin');
      else if (game === 'drawguess') unlock(uid, 'pictWin');
      if (YARD.has(game)) achieve.note(uid, 'yardWins', game);
    }
  }),
  /** The Game Table: a game over, its winners (people only), and whether anybody at all sat against them. */
  tableWon: safe((kind: string, winners: string[], seats: number) => {
    if (seats < 2) return;
    for (const uid of new Set(winners)) {
      if (!isPerson(uid)) continue;
      achieve.count(uid, 'tableWins');
      if (CARDS.has(kind)) achieve.note(uid, 'cardWins', kind);
      if (BOARDS.has(kind)) achieve.note(uid, 'boardWins', kind);
      if (kind === 'mahjong') unlock(uid, 'mahjong');
    }
  }),
  /** Hold'em: a hand won, with the hand it was won with ('' when everybody else folded) and the two cards held. */
  holdem: safe((uid: string, hand: string, hole: string[] | null) => {
    if (BIG_HANDS.has(hand)) unlock(uid, 'fullHouse');
    if (hole && hole.length === 2 && hole.map((c) => c[0]).sort().join('') === '27' && hole[0][1] !== hole[1][1]) unlock(uid, 'sevenTwo');
  }),
  /** A sudoku book saved: how many finished at each level, and the best times (ms). */
  sudoku: safe((uid: string, book: unknown) => {
    const done = (book as { done?: Record<string, { n?: number; best?: number | null }> } | null)?.done ?? {};
    const total = Object.values(done).reduce((a, d) => a + (Number(d?.n) || 0), 0);
    achieve.best(uid, 'sudoku', total);
    achieve.best(uid, 'sudokuExpert', Number(done.expert?.n) || 0);
    const easy = Number(done.easy?.best);
    if (easy > 0 && easy < 4 * 60_000) unlock(uid, 'sudokuFast');
  }),
  /** A stretch of lawn mown: the long grass cut counts, and if the whole lawn is now fresh (all of it mown in the last
   *  two hours), whoever is pushing has mown the whole lawn. */
  mowed: safe((uid: string, cut: number, lawn: Lawn, unit: number) => {
    if (cut > 0) achieve.count(uid, 'grass', cut);
    if (gotOf(uid, 'lawn')) return;
    const n = COLS * ROWS;
    let fresh = 0;
    for (let i = 0; i < n; i++) if (hoursSince(lawn, i, unit) <= 2) fresh++;
    if (fresh >= n * 0.99) unlock(uid, 'lawn');
  }),

  // ── for the page (server/basement/trophies.ts) ──
  /** Called with the person and what they have just earned (ids), a moment after they earn it. */
  listen(fn: Listener) { listener = fn; },
  /** Everybody's achievements: the list (a hidden one's name and line only once somebody has earned it) and who has
   *  earned what, when. Small enough for everybody's 'ready'. */
  board() {
    const got: Record<string, Record<string, number>> = {};
    for (const r of all<{ user_id: string; id: string; at: number }>('SELECT user_id, id, at FROM ach_got')) {
      if (BY_ID.has(r.id)) (got[r.user_id] ??= {})[r.id] = r.at;
    }
    const someone = new Set(Object.values(got).flatMap((g) => Object.keys(g)));
    const defs = DEFS.map((d) => (d.hidden && !someone.has(d.id) ? { id: d.id, cat: d.cat, tier: d.tier, hidden: true, name: '', text: '' } : d));
    return { defs, got };
  },
  /** Where everybody is on the counted ones: person → achievement id → counter. Asked for when the rack is opened. */
  progress() {
    const out: Record<string, Record<string, number>> = {};
    const rows = all<{ user_id: string; key: string; n: number }>('SELECT user_id, key, n FROM ach_count');
    for (const r of rows) for (const d of BY_KEY.get(r.key) ?? []) if ((d.goal ?? 1) > 1) (out[r.user_id] ??= {})[d.id] = r.n;
    return out;
  },
  /** One achievement in full, for the toast of whoever just earned it. */
  def: (id: string) => BY_ID.get(id) ?? null,

  /** Read once at start: what the server already kept for good, so nobody starts at zero on things they had done. */
  backfill() {
    quiet = true;
    try {
      const kv = (key: string) => get<{ value: string }>('SELECT value FROM kv WHERE key = ?', key)?.value;
      const json = <T>(s: string | undefined, fb: T): T => { try { return s ? JSON.parse(s) : fb; } catch { return fb; } };
      for (const [uid, n] of Object.entries(json<Record<string, number>>(kv('paperToss'), {}))) achieve.best(uid, 'toss', n);
      for (const [uid, n] of Object.entries(json<Record<string, number>>(kv('fit:outside:tally'), {}))) achieve.best(uid, 'golden', n);
      for (const r of all<{ user_id: string; game: string }>('SELECT user_id, game FROM arcade_scores')) achieve.note(r.user_id, 'arcade', r.game);
      for (const r of all<{ key: string; value: string }>("SELECT key, value FROM kv WHERE key LIKE 'fit:sudoku:book:%'")) achieve.sudoku(r.key.slice('fit:sudoku:book:'.length), json(r.value, null));
      for (const r of all<{ value: string }>("SELECT value FROM kv WHERE key LIKE 'fit:birthday:blown:%'")) {
        const b = json<{ by?: string; at?: number } | null>(r.value, null);
        if (b?.by) unlock(b.by, 'candles', b.at ?? Date.now());
      }
      for (const r of all<{ user_id: string; n: number }>('SELECT user_id, COUNT(*) AS n FROM messages GROUP BY user_id')) achieve.best(r.user_id, 'chat', r.n);
      for (const r of all<{ user_id: string; ms: number }>("SELECT user_id, SUM(end - start) AS ms FROM spans WHERE kind = 'voice' GROUP BY user_id")) achieve.best(r.user_id, 'voiceMin', Math.floor(r.ms / 60_000));
    } catch (e) { console.error('[achievements] backfill:', e); } finally { quiet = false; }
  },
};
