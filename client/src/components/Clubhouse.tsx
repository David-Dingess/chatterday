import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { thumbOf } from '../sites';
import { gameShot, sharedGame } from '../games';
import type { CSSProperties, MouseEvent as ReactMouseEvent } from 'react';
import { CLUB } from '../clubhouse.gen';
import { deskPics, houseDay, ledOf, marksOf, mouthOpen, nudeSheetOf, personColor, petSheet, rowIndex, sheetOf, SPRITE_ROW_COUNT, SPRITE_UP } from '../sprites';
import type { SpriteRow } from '../sprites';
import { hooks, send, setPrefs, useStore, veiled } from '../store';
import type { Toss } from '../store';
import { DOORS, drawn, FIT_LIST, FITS, goFloor } from '../basement';
import type { Fit, FitLayout } from '../basement';
import { aimDots, GROW, MAX_PULL } from '../toss';
import { aimDots as kickDots, aimOf } from '../kick';
import type { Message, Place, Presence, User, Weather } from '../types';
import { watchScreens } from '../voice';
import { askableGame, askedAt, askToShare } from '../askshare';
import { BOARD_H, BOARD_W, paint, watchBoard } from '../board';
import { Icon, presenceText } from './ui';
import { clickRadio, closeRadio, RadioMenu, radioSays } from './Music';
import { WallMirror } from './Mirror';
import { SudokuTable } from './Sudoku';
import { BirthdayCake, BirthdayNeon } from '../birthday';
import { HolidayDecor } from '../holidays/decor';
import { Disco } from '../disco';
import { stepVacuum, Vacuum, vacuumPet } from '../vacuum';
import { SceneArt, useOutdoorSeason, useSceneArt } from '../season';
import { OutdoorDecor } from '../holidays/outdoor';
import type { IconName } from './ui';
import { pageRect } from '../device';

// The clubhouse is drawn at its own pixel size (CLUB.w × CLUB.h) and zoomed to fit. Positions are a
// person's feet. People walk between spots along the free cells of CLUB.grid, and step in and out
// of seats (and their bed) at each end rather than sliding through the furniture.

type Pt = { x: number; y: number };
type Anim = { row: SpriteRow; first: number; frames: number; ms: number; flip?: boolean };
type Fx = '' | 'sleep' | 'doze' | 'loo' | 'cook' | 'gone' | 'spin' | 'laugh' | 'cry' | 'stars' | 'hearts' | 'clap' | 'sweep' | 'sweat' | 'shower' | 'phone' | 'call' | 'vcall';
type Goal = Pt & { key: string; ax: number; ay: number; anim: Anim; fx: Fx; reach: number; speed?: number; stay?: boolean };
/** el, px, py, mouth: the element they were last drawn on and what was last written to it, so a frame in which nothing changed writes nothing. */
/** got: the drink (by its `since`) they have been to the fridge for; fridgeAt: when they got there for the one they are fetching; drink: the one last drawn in their hand. */
type Actor = Pt & { path: Pt[]; goal: Goal; arrived: boolean; shown: string; el?: HTMLElement; px?: number; py?: number; mouth?: string; got?: number; fridgeAt?: number; drink?: string; face?: SpriteRow; dy?: number; clip?: number };
type Spot = { x: number; y: number; ax?: number; ay?: number };
/** The pets. Anybody may have one: they build it themselves, and it is in the room while they are in a voice chat. A
 *  pet goes by its owner's id everywhere (here, and in what the server passes on). */
type PetDef = { id: string; name: string; kind: 'cat' | 'dog' };
const petsOf = (people: User[]): PetDef[] => people.filter((u) => u.pet).map((u) => ({ id: u.id, name: u.pet!.name || `${u.name}'s ${u.pet!.kind}`, kind: u.pet!.kind === 'dog' ? 'dog' : 'cat' }));
/** A pet in the room. Every PET_SLOT it picks something to do, from the time, so everyone sees much the same thing.
 *  spot: which of the usual spots it has taken (-1: none); dest: where it is headed; held: somebody is petting it,
 *  or on the way over to; 'gone': walking out of the door, or out. */
/** perch: which shelf of the cat tree it is on, or making for (-1: none). */
type Pet = Pt & { kind: 'cat' | 'dog'; path: Pt[]; slot: number; pose: 'sit' | 'eat' | 'sleep' | 'petted' | 'gone'; shown: string; spot: number; perch: number; dest: Pt; held: boolean; px?: number; py?: number; pz?: number;
  /** asleep on its owner's blanket: which desk's bed (and it is drawn over the sleeper there) */
  bed?: number };
// ── things people can do in the room: on their own, or to and with somebody else ──
type ActKind = 'dance' | 'cheer' | 'lap' | 'spin' | 'laugh' | 'cry' | 'highfive' | 'hug' | 'punch' | 'pet' | 'kick';
const SOLO_ACTS: [ActKind, string][] = [['dance', 'Dance'], ['cheer', 'Jump for joy'], ['lap', 'Run a lap'], ['spin', 'Spin'], ['laugh', 'Laugh'], ['cry', 'Cry']];
const DUO_ACTS: [ActKind, string][] = [['highfive', 'High five'], ['hug', 'Hug'], ['punch', 'Punch']];
/** One beat of an action: how long it lasts, and what the one who started it (a) and the other one (b) look like. */
type Step = { ms: number; a: [Anim, Fx]; b?: [Anim, Fx] };
/** An action in progress. phase -1 means the people are still walking into place. */
/** prevA / prevB: what that person was doing, when they do their part right where they are (no stepping away and back). */
/** pet: the pet being petted, when that is what this is. */
type Act = { id: number; kind: ActKind; a: string; b: string; pet?: string; aim?: Pt; phase: number; until: number; started: number; spotA: Pt; spotB?: Pt; mirror: boolean; prevA?: Goal; prevB?: Goal };
const GAP: Partial<Record<ActKind, number>> = { highfive: 20, hug: 12, punch: 18 };      // how far apart the two stand
const LAP: Pt[] = [{ x: 270, y: 300 }, { x: 150, y: 300 }, { x: 160, y: 188 }, { x: 96, y: 180 }, { x: 270, y: 162 }, { x: 366, y: 190 }, { x: 440, y: 300 }, { x: 292, y: 302 }];
const RUN = 125;                                                                       // pixels a second, on a lap

/** The side-on poses face left. The starter stands to the right of the other person and faces them, unless there was
 *  only room on the left (`m`), in which case everything is mirrored. */
function stepsOf(kind: ActKind, m: boolean): Step[] {
  const a = (row: SpriteRow, first: number, frames = 1, ms = 1000): Anim => ({ row, first, frames, ms, flip: m });
  const b = (row: SpriteRow, first: number, frames = 1, ms = 1000): Anim => ({ row, first, frames, ms, flip: !m });
  switch (kind) {
    case 'dance': return [{ ms: 5200, a: [{ row: 'dance', first: 0, frames: 4, ms: 170 }, ''] }];
    case 'cheer': return [{ ms: 2600, a: [{ row: 'cheer', first: 0, frames: 4, ms: 110 }, ''] }];
    case 'spin': return [{ ms: 2400, a: [still('walk_down', 1), 'spin'] }];
    case 'laugh': return [{ ms: 3600, a: [loop('idle', 0, 260), 'laugh'] }];
    case 'cry': return [{ ms: 4200, a: [loop('idle', 0, 900), 'cry'] }];
    case 'highfive': return [{ ms: 450, a: [a('reach', 0), ''], b: [b('reach', 0), ''] }, { ms: 1100, a: [a('reach', 1), 'clap'], b: [b('reach', 1), ''] }];
    case 'pet': return [{ ms: 3800, a: [a('reach', 2, 2, 380), ''] }];                // leaning in, hand out, stroking
    case 'kick': return [{ ms: 240, a: [a('punch', 0), ''] }, { ms: 560, a: [a('walk_left', 0), ''] }];      // a leg drawn back, then swung through (the ball goes as the second begins)
    case 'hug': return [{ ms: 3200, a: [a('reach', 2, 2, 700), 'hearts'], b: [b('reach', 2, 2, 700), ''] }];
    case 'punch': return [
      { ms: 380, a: [a('punch', 0), ''], b: [loop('idle', 0, 1000), ''] },
      { ms: 420, a: [a('punch', 1), ''], b: [{ row: 'floored', first: 0, frames: 1, ms: 1000, flip: m }, 'stars'] },      // they go down away from the punch
      { ms: 3200, a: [loop('idle', 0, 260), 'laugh'], b: [{ row: 'floored', first: 0, frames: 4, ms: 320, flip: m }, 'stars'] },
    ];
    default: return [];
  }
}

const PET_SLOT = 85_000;                // (long enough that, the walk over taken off, it is a good minute at each stop)
/** A well-mixed number from a counter, so one slot's choice says nothing about the next. */
const scramble = (n: number) => {
  let t = (n + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return (t ^ (t >>> 14)) >>> 0;
};
const PET_SPEED = { cat: 34, dog: 44 };                 // pixels a second

/** What somebody can be doing that leaves no hand for the thing they are holding (it is hidden until they are done). */
const HANDS_BUSY = new Set<Fx>(['sleep', 'shower', 'gone', 'sweep', 'cook', 'phone', 'clap', 'call']);

const SPEED = 46;                       // pixels a second
const still = (row: SpriteRow, first: number, flip = false): Anim => ({ row, first, frames: 1, ms: 1000, flip });
const loop = (row: SpriteRow, first: number, ms: number, flip = false): Anim => ({ row, first, frames: 2, ms, flip });

// The floor people walk on: upstairs (CLUB.grid), or the basement's, whichever I am on (both are the same size,
// in the same cells). The room sets it with onGrid as it draws.
let GRID: string[] = CLUB.grid;
let COLS = GRID[0].length;
let ROWS = GRID.length;
const onGrid = (g: string[]) => { if (g !== GRID) { GRID = g; COLS = g[0].length; ROWS = g.length; } };
const free = (c: number, r: number) => r >= 0 && r < ROWS && c >= 0 && c < COLS && GRID[r][c] === '.';
const cellOf = (p: Pt): [number, number] => [Math.floor(p.x / CLUB.cell), Math.floor(p.y / CLUB.cell)];
const centre = (c: number, r: number): Pt => ({ x: c * CLUB.cell + CLUB.cell / 2, y: r * CLUB.cell + CLUB.cell / 2 });
const STEPS = [[0, 1], [1, 0], [0, -1], [-1, 0]];

/** The nearest cell that can be walked on, searching outwards. */
function nearestFree(p: Pt): [number, number] {
  const [c0, r0] = cellOf(p);
  for (let d = 0; d < 20; d++) {
    for (let r = r0 - d; r <= r0 + d; r++) for (let c = c0 - d; c <= c0 + d; c++) {
      if (Math.max(Math.abs(r - r0), Math.abs(c - c0)) === d && free(c, r)) return [c, r];
    }
  }
  return [c0, r0];
}

/** Shortest walk between two points, moving up, down, left and right only. */
function route(from: Pt, to: Pt): Pt[] {
  const [sc, sr] = nearestFree(from);
  const [tc, tr] = nearestFree(to);
  // A point off the grid (somebody out on the patio above the house or the street below it, or with no place yet)
  // has no cell: no way. Without this, the walk back from it below ran on forever, adding a step each time round, until
  // the page ran out of memory and died: everybody looking at the room, whenever anybody came in from outside (2026-11-18).
  if (!(sc >= 0 && sc < COLS && sr >= 0 && sr < ROWS && tc >= 0 && tc < COLS && tr >= 0 && tr < ROWS)) return [];
  const prev = new Int32Array(COLS * ROWS).fill(-1);
  const start = sr * COLS + sc, end = tr * COLS + tc;
  const queue = [end];                    // search backwards so the walk reads forwards
  prev[end] = end;
  for (let i = 0; i < queue.length && prev[start] < 0; i++) {
    const at = queue[i], c = at % COLS, r = (at - c) / COLS;
    for (const [dc, dr] of STEPS) {
      const nc = c + dc, nr = r + dr, n = nr * COLS + nc;
      if (free(nc, nr) && prev[n] < 0) { prev[n] = at; queue.push(n); }
    }
  }
  const out: Pt[] = [];
  if (prev[start] < 0) return out;
  for (let at = start; ; at = prev[at]) {
    out.push(centre(at % COLS, Math.floor(at / COLS)));
    if (at === end) break;
    if (out.length > COLS * ROWS) return [];          // (can never be longer than every cell: never again round and round)
  }
  // drop the points in the middle of a straight run
  return out.filter((p, i) => i === 0 || i === out.length - 1 || !((out[i - 1].x === p.x && out[i + 1].x === p.x) || (out[i - 1].y === p.y && out[i + 1].y === p.y)));
}

const hash = (s: string) => { let h = 7; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; };
const CINEMA_ORDER = [2, 4, 0, 3, 1, 5];           // every other seat first, from the middle, so nobody is squeezed against a neighbour until they must be
const LIVING_ORDER = [1, 3, 4, 5, 0, 2];           // two on the sofa with a cushion between them, then the armchairs, then the gaps

type Scene = { now: number; taken: Set<string>; seat: number; movie: boolean; /** in the side room: they sit at the kitchen table */ side: boolean };

/** What each piece of furniture that can be clicked says when it is pointed at. */
const SPOT_SAYS: Record<string, string> = {
  kitchen: 'Make some food', bathroom: 'Use the bathroom', showering: 'Take a shower',
  away: 'Step out', wardrobe: 'Change how you look', desk: 'At your desk: gaming, working or sleeping', fridge: 'Grab a drink', cooler: 'Grab a drink from the cooler',
  coffee: 'Grab something off the coffee table', microwave: 'Heat something up', console: 'Play with a toy',
};
/** Things to hold, by where they are fetched from: the fridge, the coffee table, the microwave and the media console.
 *  Whatever is chosen is in your hand for half an hour, a coffee two hours (the server counts them), held like a drink, and lifted now
 *  and then (a sip, a bite, a puff). Their pictures are side by side in drinks.png, in the order of CLUB.drinks. */
type Source = 'fridge' | 'coffee' | 'microwave' | 'console' | 'cooler';
const HELD: Record<Source, { title: string; items: [string, string][] }> = {
  fridge: { title: 'Grab a drink', items: [['beer', 'Beer'], ['coffee', 'Coffee'], ['tiki', 'Tiki drink'], ['water', 'Water'], ['coke', 'Cope Cola']] },
  coffee: { title: 'Off the coffee table', items: [['book', 'A book'], ['cigarette', 'A cigarette'], ['bong', 'The bong'], ['remote', 'The remote'], ['chips', 'Chips'], ['vape', 'A vape']] },
  microwave: { title: 'Heat something up', items: [['pizza', 'Pizza'], ['burger', 'Burger'], ['pasta', 'Pasta'], ['salad', 'Salad'], ['hotdog', 'Hot dog'], ['taco', 'Taco'], ['ramen', 'Ramen'], ['popcorn', 'Popcorn']] },
  console: { title: 'Play with a toy', items: [['yoyo', 'Yo-yo'], ['slinky', 'Slinky'], ['spinner', 'Fidget spinner'], ['cube', 'Twisty cube'], ['eightball', 'Magic 8-ball']] },
  cooler: { title: 'From the cooler', items: [['beer', 'Beer'], ['water', 'Water'], ['coke', 'Cope Cola'], ['tiki', 'Tiki drink']] },
};
const SOURCES = Object.keys(HELD) as Source[];
const sourceOf = (kind: string): Source => SOURCES.find((s) => HELD[s].items.some(([k]) => k === kind)) ?? 'fridge';
/** Where somebody stands to fetch one, and which way they face: at the fridge; at the counter under the microwave;
 *  below the coffee table, looking down at it; above the media console (it is against the near wall). */
const FETCH_AT: Record<Source, Pt & { face: SpriteRow }> = {
  fridge: { x: CLUB.snack[0].x, y: CLUB.snack[0].y, face: 'walk_up' },
  microwave: { x: 182, y: 278, face: 'walk_up' },
  coffee: { x: 435, y: 290, face: 'walk_up' },
  console: { x: 380, y: 300, face: 'walk_down' },
  cooler: { x: CLUB.snack[0].x, y: CLUB.snack[0].y, face: 'walk_up' },      // (only outside: a drink from a cooler is a fridge drink upstairs)
};

/** Every seat that can be clicked, each one a place of its own: the sofa's cushions and the two armchairs, the theatre
 *  seats, the stools at the table and the chair at every desk. `hit` is the part of the picture that is that seat
 *  ([x, y, width, height]): a click anywhere on it sits you in that one and no other. */
const SEATS: { key: string; x: number; y: number; hit: number[] }[] = [
  ...CLUB.living.map((q, n) => ({ key: `living${n}`, x: q.x, y: q.y, hit: q.hit })),
  ...CLUB.theatre.map((q, n) => ({ key: `seat${n}`, x: q.x, y: q.y, hit: q.hit })),
  ...CLUB.table.map((q, n) => ({ key: `table${n}`, x: q.x, y: q.y, hit: q.hit })),
  ...CLUB.pcs.map((q, n) => ({ key: `pc${n}`, x: q.x, y: q.y, hit: q.hit })),
  ...CLUB.bags.map((q, n) => ({ key: `bag${n}`, x: q.x, y: q.y, hit: q.hit })),
  { key: 'arcade0', x: CLUB.arcade.x, y: CLUB.arcade.y, hit: CLUB.arcade.hit },      // the arcade machine: standing at it, playing
];
const inBox = (p: Pt, r: number[]) => p.x >= r[0] && p.x < r[0] + r[2] && p.y >= r[1] && p.y < r[1] + r[3];
/** Somebody cleaning works round the room with a broom: every CLEAN_SLOT they make for another patch of open floor,
 *  picked from the time, so everyone sees them go the same way. Not into the bathroom (it has a light to work), and
 *  not the strip between the desks and their chairs. They get there the way sweeping goes: stroke after stroke (each
 *  SWEEP_STROKE long), the broom pushed out for the first SWEEP_PUSH of it while they step into it (at SWEEP_SPEED),
 *  then drawn back to their feet while they stand. Once there, they keep sweeping that patch on the spot. */
const CLEAN_SLOT = 20_000;
const SWEEP_STROKE = 520, SWEEP_PUSH = 0.45, SWEEP_SPEED = 16;
/** On the phone: stood on a patch of floor of their own, pacing on the spot: every CALL_TURN they turn (to us, away to
 *  one side, back to us, to the other side), and they talk in bursts. */
const CALL_TURN = 6_000;
/** On a video call, at their desk: three take turns, VCALL_TURN each, round and round (each person in their own time):
 *  the man on the main monitor, then the woman, then them. While either face talks they sit still and listen; on their
 *  own turn their head and shoulders bob as they talk, 60% quicker than sitting idle (1100 a frame, so VCALL_BOB). */
const VCALL_TURN = 5_000, VCALL_BOB = Math.round(1100 / 1.6);
const VCALL_TURNS = ['man', 'woman', 'you'] as const;
const vcallTurn = (t: number, seed: number) => VCALL_TURNS[Math.floor((t + seed) / VCALL_TURN) % 3];
const SWEEPABLE: Pt[] = [];
for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
  const p = centre(c, r);
  if (free(c, r) && p.y > 150 && !inBox(p, CLUB.bath.rect)) SWEEPABLE.push(p);
}
/** Where the floor starts, below the back wall: a click a step off the edge of the floor still means "stand there". */
const FLOOR_TOP = (CLUB.grid.findIndex((row) => row.includes('.')) - 1) * CLUB.cell;
/** What a click at some point in the room would do. */
type Target = { kind: 'seat'; seat: (typeof SEATS)[number]; mine: boolean } | { kind: 'taken' } | { kind: 'games' } | { kind: 'arcade' }
  | { kind: 'floor'; x: number; y: number } | { kind: 'spot'; what: string; rect: number[] } | { kind: 'photo'; src: string } | { kind: 'stairs' } | { kind: 'door'; to: string };
/** How much of a picture on the wall shows, from its top down: the desks that stand in front of it hide the rest. */
const shows = (r: number[]) => Math.max(0, Math.min(r[3], ...(CLUB.spots as (string | number)[][])
  .filter((q) => q[0] === 'desk' && Number(q[1]) < r[0] + r[2] && Number(q[1]) + Number(q[3]) > r[0] && Number(q[2]) < r[1] + r[3]).map((q) => Number(q[2]) - r[1])));
/** The wall's frames: the big gilt one, then the small ones. The admin's photos hang over the paintings in them. */
const FRAMES = [{ name: 'poster', at: CLUB.photo }, ...CLUB.gallery].map((f) => ({ ...f, shows: shows(f.at) }));
/** The name a seat is held under while somebody is on it (the same whether they chose it or were put there). */
const heldAs = (seat: string) => seat.replace(/^living/, 'sofa');

/** Where somebody should be, from what they are doing. `i` is the place they hold while they are online: 0 to 5 is a
 *  desk (which is their bed as well); anyone after that is a visitor, with a laptop and no desk. */
function goalFor(u: User, i: number, p: Presence | undefined, s: Scene): Goal {
  const at = (key: string, spot: Spot, anim: Anim, fx: Fx = '', reach = 0): Goal =>
    ({ key, x: spot.x, y: spot.y, ax: spot.ax ?? spot.x, ay: spot.ay ?? spot.y, anim, fx, reach });
  const h = hash(u.id);
  const loo = () => at('loo', CLUB.toilet, loop('sit_side', 0, 900, true), 'loo');
  const stand = (key: string, spot: { x: number; y: number; face: string }, fx: Fx = '') =>
    at(key, spot, spot.face === 'up' ? still('walk_up', 1) : loop('idle', 0, 1000), fx);
  const firstFree = <T,>(keys: string[], make: (key: string) => T): T => {
    const key = keys.find((k) => !s.taken.has(k)) ?? keys[0];
    s.taken.add(key);
    return make(key);
  };

  /** A seat in the theatre, the middle ones first. Everyone who ends up there is seated through this, so no two share a seat. */
  const theatreSeat = (anim: Anim) => firstFree(CINEMA_ORDER.map((n) => `seat${n}`), (key) => at(key, CLUB.theatre[Number(key.slice(4))], anim));
  const gone = () => at('gone', CLUB.door, still('walk_down', 1), 'gone');
  if (!p || p.state === 'offline') return gone();      // not signed in: not in the room at all
  /** On the sofa or an armchair, and on a chair at the kitchen table: sitting the way that seat faces. */
  const sofa = (n: number) => { const seat = CLUB.living[n]; return at(`sofa${n}`, seat, seat.side ? loop('sit_side', 0, 1100, seat.flip) : p.state === 'gaming' ? loop('gaming', 0, 280) : still('sit_front', 0)); };      // (on the sofa itself: sat back in it, quite still)
  const table = (n: number) => { const seat = CLUB.table[n]; return at(`table${n}`, seat, seat.kind === 'side' ? loop('sit_side', 0, 1100, seat.flip) : seat.kind === 'back' ? loop('sit_back', 0, 1100) : loop('sit_front', 0, 1100)); };
  /** At their own desk. (It is noted as in use, so nobody who picked that chair by clicking is left sitting in their lap.) */
  const desk = (anim: Anim) => { s.taken.add(`pc${i}`); return at(`pc${i}`, CLUB.pcs[i], anim); };

  /** Away (the PC idle or locked, and not a word from them for a while), but still in a seat: one they chose by
   *  clicking, or theirs for as long as the call is open. They keep it, and nod off there. */
  const doze = (g: Goal): Goal => (p.state === 'away' ? { ...g, fx: 'doze' } : g);

  // somewhere they chose
  // Somewhere they clicked in the room: that seat, or that patch of floor. It beats everything their PC says they are
  // doing (a game, a video, a shared screen) until they click somewhere else or change "Where are you?".
  if (p.place === 'here' && p.at) {
    const m = /^(living|seat|table|pc|bag|arcade)(\d+)$/.exec(p.at.seat ?? ''), n = m ? Number(m[2]) : -1;
    if (m?.[1] === 'arcade') return doze(at('arcade0', CLUB.arcade, still('walk_right', 1)));      // at the arcade machine, facing it (it stands against the east wall)
    if (m?.[1] === 'bag' && CLUB.bags[n]) return doze(p.state === 'gaming' ? at(`bag${n}`, CLUB.bags[n], loop('gaming', 0, 280)) : at(`bag${n}`, CLUB.bags[n], still('sit_front', 0), 'phone'));      // lying back on a bean bag, legs out over the front, on their phone. Quite still: no bobbing up and down as somebody sitting up does
    if (m?.[1] === 'living' && CLUB.living[n]) return doze(sofa(n));
    if (m?.[1] === 'seat' && CLUB.theatre[n]) return doze(at(`seat${n}`, CLUB.theatre[n], loop('sit_back', 0, 1100)));
    if (m?.[1] === 'table' && CLUB.table[n]) return doze(table(n));
    if (m?.[1] === 'pc' && CLUB.pcs[n]) {
      // The chair at a desk. Somebody else's is theirs the moment they want it (or whoever sat there first): then I stand beside it.
      if (s.taken.has(`pc${n}`)) { const by = centre(...nearestFree({ x: CLUB.pcs[n].ax + 15, y: CLUB.pcs[n].ay })); return doze(at(`by${n}:${by.x},${by.y}`, by, loop('idle', 0, 1000))); }
      s.taken.add(`pc${n}`);
      return doze(at(`pc${n}`, CLUB.pcs[n], n === i && p.state === 'gaming' ? loop('gaming_back', 0, 280) : loop('sit_back', 0, 1100)));
    }
    const [c, r] = nearestFree(p.at), spot = free(...cellOf(p.at)) ? { x: p.at.x, y: p.at.y } : centre(c, r);
    return doze(at(`here${Math.round(spot.x)},${Math.round(spot.y)}`, spot, loop('idle', 0, 1000)));
  }
  // Doomscrolling, chosen by hand: lying back on a bean bag, on their phone, wherever they really are.
  if (p.place === 'doomscrolling' && CLUB.bags.length) return firstFree(CLUB.bags.map((_, n) => `bag${n}`), (key) => at(key, CLUB.bags[Number(key.slice(3))], still('sit_front', 0), 'phone'));
  // I'm here, and Chillin (the same): about, but not at the desk: on a bean bag if one is free, or in the living room.
  if (p.place === 'imhere' || p.place === 'chillin') return doze(firstFree([...CLUB.bags.map((_, n) => `bag${n}`), ...LIVING_ORDER.map((n) => `sofa${n}`)],
    (key) => (key.startsWith('bag') ? at(key, CLUB.bags[Number(key.slice(3))], still('sit_front', 0)) : sofa(Number(key.slice(4))))));
  // A visitor (no desk of their own) at a computer, by what they have said they are doing (Working, even with
  // the app shut or idle, as somebody with a desk sits at it then) or by what their computer says: a laptop out, sat in
  // the main room. The sofa first (its seats facing us), then the bean bags, then
  // the kitchen table; the armchairs and the table's ends, side on, only once those are taken.
  const busyAtComputer = ['working', 'prompting', 'vcall', 'gaming'].includes(p.place ?? '') || (!p.place && p.state !== 'away');
  if (i >= CLUB.pcs.length && busyAtComputer) {
    const game = p.state === 'gaming' || p.place === 'gaming';
    const lap = game ? loop('gaming', 0, 280) : loop('sit_front', 2, 340);      // (frames 2 and 3: typing on the laptop on their knees)
    const sofaSeats = LIVING_ORDER.filter((n) => CLUB.living[n]);
    const keys = [...sofaSeats.filter((n) => !CLUB.living[n].side).map((n) => `sofa${n}`), ...CLUB.bags.map((_, n) => `bag${n}`),
      ...CLUB.table.map((t, n) => (t.kind === 'side' ? '' : `table${n}`)).filter(Boolean),
      ...sofaSeats.filter((n) => CLUB.living[n].side).map((n) => `sofa${n}`), ...CLUB.table.map((t, n) => (t.kind === 'side' ? `table${n}` : '')).filter(Boolean)];
    return firstFree(keys, (key) => {
      const n = Number(/\d+$/.exec(key)![0]);
      if (key.startsWith('bag')) return at(key, CLUB.bags[n], lap);
      if (key.startsWith('sofa')) { const seat = CLUB.living[n]; return seat.side ? sofa(n) : at(key, seat, lap); }
      const seat = CLUB.table[n];
      return seat.kind === 'front' ? at(key, seat, lap) : seat.kind === 'back' ? at(key, seat, loop('sit_back', 2, 340)) : table(n);
    });
  }
  if ((p.place === 'working' || p.place === 'prompting') && i < CLUB.pcs.length) return desk(loop('sit_back', 2, 340));      // at their own desk, typing
  if (p.place === 'vcall' && i < CLUB.pcs.length) { s.taken.add(`pc${i}`); return at(`pc${i}`, CLUB.pcs[i], still('gaming_back', 0), 'vcall'); }      // on a video call at their desk: the frame loop takes it in turns
  if (p.place === 'sleeping') {
    // Their desk has turned into a bed (the room draws it), and they are in it. A visitor, who has no desk and so no bed,
    // has gone home to sleep: out of the room (the list down the left says they are sleeping, and that is enough).
    if (i < CLUB.pcs.length) { s.taken.add(`pc${i}`); return at(`bed${i}`, CLUB.pcs[i].bed, loop('sleep', 2, 1500), 'sleep'); }      // (frames 2 and 3: seen from above, as the bed is)
    return gone();
  }
  if (p.place === 'showering') {                // one at a time: anybody else waits on the bath mat
    if (s.taken.has('shower')) return at('showerwait', CLUB.showerWait, loop('idle', 0, 1000));
    s.taken.add('shower');
    return at('shower', CLUB.shower, loop('idle', 0, 700), 'shower');
  }
  // Working out: jumping on the spot, on the open floor behind the desks.
  if (p.place === 'exercising') return firstFree(CLUB.gym.map((_, k) => `gym${k}`), (key) => at(key, CLUB.gym[Number(key.slice(3))], { row: 'cheer', first: 0, frames: 4, ms: 150 }, 'sweat'));
  if (p.place === 'cleaning') {                 // round the room with a broom, making for a new patch of floor every so often
    const to = SWEEPABLE[scramble(h + Math.floor((s.now + (h % CLEAN_SLOT)) / CLEAN_SLOT)) % SWEEPABLE.length];
    return at(`clean${to.x},${to.y}`, to, loop('idle', 0, 500), 'sweep');
  }
  if (p.place === 'calling') {                  // stepped aside to take a call: a patch of floor of their own
    const to = SWEEPABLE[scramble(h + 77) % SWEEPABLE.length];
    return at(`call${to.x},${to.y}`, to, still('call', 0), 'call');
  }
  if (p.place === 'gaming' && i < CLUB.pcs.length) return desk(loop('gaming_back', 0, 280));
  // "Watching", chosen by hand, is a seat in the theatre. (Watching something on your own PC, which the app notices, is at your desk.)
  if (p.place === 'watching') return theatreSeat(loop('sit_back', 0, 1100));
  if (p.place === 'bathroom' || p.place === 'peeing' || p.place === 'pooping') {      // one toilet: whoever gets there first sits, anyone else waits a few steps off
    if (!s.taken.has('loo')) { s.taken.add('loo'); return loo(); }
    const by = centre(...nearestFree({ x: CLUB.toilet.ax + 16 + (i % 3) * 12, y: CLUB.toilet.ay - 18 }));
    return at(`wait${by.x},${by.y}`, by, loop('idle', 0, 1000));
  }
  if (p.place === 'kitchen') return firstFree(['snack1', 'snack0', 'snack2'], (key) => stand(key, CLUB.snack[Number(key.slice(5))], 'cook'));
  // Away by choice, or their PC has sat idle and they are not in voice: they walk out of the door.
  if (p.place === 'away' || (p.state === 'away' && !p.voice)) return gone();

  // Watching somebody's shared screen (the Screens view is open) is a seat in the theatre, not your desk. If a game
  // has come to the front on their PC meanwhile, they are at their desk playing it.
  if ((p.voice?.watching?.length || p.voice?.big) && p.state !== 'gaming') return theatreSeat(loop('sit_back', 0, 1100));

  // Gaming or watching something happens at your own desk, even while you are in voice.
  if ((p.state === 'gaming' || p.state === 'watching') && i < CLUB.pcs.length) {
    return desk(p.state === 'gaming' ? loop('gaming_back', 0, 280) : loop('sit_back', 0, 1000));
  }
  if (p.voice) {
    // (a seat somebody chose by clicking is theirs: the others are seated round them)
    const pick = (order: number[], name: string) => { const open = order.filter((k) => !s.taken.has(name + k)); return (open.length ? open : order)[s.seat % (open.length || order.length)]; };
    if (s.side) return doze(table(pick(CLUB.table.map((_, k) => k), 'table')));
    if (s.movie) {
      return doze(theatreSeat(p.voice.sharing ? loop('sit_back', 2, 340) : loop('sit_back', 0, 1100)));
    }
    return doze(sofa(pick(LIVING_ORDER, 'sofa')));
  }
  if (p.state !== 'away') {
    return desk(p.state === 'gaming' ? loop('gaming_back', 0, 280) : p.state === 'watching' ? loop('sit_back', 0, 1000) : loop('sit_back', 2, 340));
  }
  return gone();
}

/** Things done upstairs: somebody doing one of these while the group is in the basement has gone up the stairs for it. */
const UPSTAIRS = new Set<string>(['sleeping', 'showering', 'peeing', 'pooping', 'bathroom', 'kitchen', 'cleaning', 'calling', 'doomscrolling', 'imhere', 'chillin', 'away']);
const FACE_ROW: Record<string, SpriteRow> = { up: 'walk_up', down: 'walk_down', left: 'walk_left', right: 'walk_right' };
/** How somebody sits or stands at one of a fit-out's seats. */
const fitSeatAnim = (q: Fit['seats'][number], gaming: boolean): Anim =>
  q.pose === 'back' ? (gaming ? still('gaming_back', 0) : still('sit_back', 0))      // (sat back in it, quite still: no bobbing)
    : q.pose === 'side' ? loop('sit_side', 0, 1100, q.flip)
      : q.pose === 'stand' ? (q.face && q.face !== 'down' ? still(FACE_ROW[q.face] ?? 'walk_down', 1) : loop('idle', 0, 1000))
        : gaming ? loop('gaming', 0, 280) : still('sit_front', 0);
/** The floor somebody is on: '' upstairs, or a basement fit-out. Whatever they are doing upstairs (asleep, in the
 *  bathroom, cooking...) has them upstairs for it, wherever they were. */
const floorOf = (p: Presence | undefined) => (!p || UPSTAIRS.has(p.place ?? '') ? '' : p.floor ?? '');
/** The stairs, for the walk from one floor to the other: they are lost from sight once they get there. */
const stairsGoal = (fit: FitLayout | null, to = ''): Goal => {
  // (upstairs, whoever is outdoors went out of that one's door: the campsite's in the east wall, the backyard's in the west)
  const out = !fit ? DOORS.find((f) => f.id === to) : undefined;
  if (out) { const d = out.things.door; return { key: 'door', x: d.foot.x, y: d.foot.y, ax: d.foot.x, ay: d.foot.y, anim: still(d.side === 'west' ? 'walk_left' : 'walk_right', 1), fx: 'gone', reach: 0 }; }
  // (outdoors, whoever has gone on to a scene past this one went off along its path: the lake, behind the campsite's
  //  telescope; that scene's things.back says where the path leaves this one)
  const on = fit && to ? FITS[to]?.things.back : undefined;
  if (fit && on?.to === fit.id) return { key: 'door', x: on.foot.x, y: on.foot.y, ax: on.foot.x, ay: on.foot.y, anim: still(FACE_ROW[on.face ?? ''] ?? 'walk_up', 1), fx: 'gone', reach: 0 };
  const at = fit ? fit.stairs.foot : CLUB.stairs.top;
  return { key: 'stairs', x: at.x, y: at.y, ax: at.x, ay: at.y, anim: still(fit ? FACE_ROW[fit.stairs.face ?? ''] ?? 'walk_up' : 'walk_down', 1), fx: 'gone', reach: 0 };
};

/** Where somebody is in the basement. It has no desks, beds, bathroom or kitchen: whoever is sleeping, in the bathroom,
 *  cooking, cleaning or away has gone up the stairs for it. Everybody else is down here with the group: in the seat they
 *  picked, on the spot they picked, or in the first free seat (the fit-out lists its best ones first), and once those are
 *  taken, standing about. At a computer they have a laptop on their knees: a game in front of them shows as gaming. */
function fitGoal(u: User, p: Presence | undefined, fit: Fit, s: Scene): Goal {
  const at = (key: string, q: { x: number; y: number; ax?: number; ay?: number }, anim: Anim, fx: Fx = ''): Goal =>
    ({ key, x: q.x, y: q.y, ax: q.ax ?? q.x, ay: q.ay ?? q.y, anim, fx, reach: 0 });
  if (!p || p.state === 'offline' || (p.state === 'away' && !p.voice) || UPSTAIRS.has(p.place ?? '')) return stairsGoal(fit);
  const gaming = p.state === 'gaming' && !fit.outdoors;      // (out by the campfire nobody sits there gaming, whatever their PC says)
  const doze = (g: Goal) => (p.state === 'away' ? { ...g, fx: 'doze' as Fx } : g);
  const seat = (n: number) => at(`b${n}`, fit.seats[n], fitSeatAnim(fit.seats[n], gaming || !!fit.seats[n].game));
  const stand = (n: number) => { const q = fit.stands[n]; return at(`bs${n}`, q, q.face === 'down' ? loop('idle', 0, 1000) : still(FACE_ROW[q.face] ?? 'walk_down', 1)); };
  if (p.place === 'here' && p.at) {
    const m = /^b(\d+)$/.exec(p.at.seat ?? '');
    if (m && fit.seats[Number(m[1])]) return doze(seat(Number(m[1])));
    const spot = centre(...nearestFree({ x: p.at.x, y: p.at.y }));
    return doze(at(`here:${spot.x},${spot.y}`, spot, loop('idle', 0, 1000)));
  }
  if (p.place === 'exercising') {
    const n = fit.stands.findIndex((_, k) => !s.taken.has(`bs${k}`));
    const q = n >= 0 ? fit.stands[n] : fit.stairs.foot;
    if (n >= 0) s.taken.add(`bs${n}`);
    return at(`gym${n}`, q, { row: 'cheer', first: 0, frames: 4, ms: 150 }, 'sweat');
  }
  const n = fit.seats.findIndex((q, k) => !q.only && !s.taken.has(`b${k}`));      // (`only`: a game's spot, for its players and watchers)
  if (n >= 0) { s.taken.add(`b${n}`); return doze(seat(n)); }
  const k = fit.stands.findIndex((_, j) => !s.taken.has(`bs${j}`));
  if (k >= 0) { s.taken.add(`bs${k}`); return doze(stand(k)); }
  const near = centre(...nearestFree({ x: fit.stairs.foot.x + 30 + (hash(u.id) % 120), y: fit.stairs.foot.y + (hash(u.id) % 60) }));
  return doze(at(`near:${near.x},${near.y}`, near, loop('idle', 0, 1000)));
}

const box = (r: number[]): CSSProperties => ({ left: r[0], top: r[1], width: r[2], height: r[3] });
const piece = (o: { x: number; y: number; w: number; h: number; z: number; sx: number; sy: number }): CSSProperties =>
  ({ left: o.x, top: o.y, width: o.w, height: o.h, zIndex: o.z, backgroundPosition: `${-o.sx}px ${-o.sy}px`, backgroundSize: `${CLUB.atlas[0]}px ${CLUB.atlas[1]}px` });

/** What the address asks to be previewed (`?hour=14`, `?weather=rain`, `?date=12-25`), read once as the page loads. */
const PREVIEW = new URLSearchParams(location.search);
// The house keeps one clock for everybody: the time in the town the admin picked (`tz`; '' is the host PC's own).
// (Each of these is made once for a clock: building one is far slower than using it, and the room asks every time it is drawn.)
const CLOCKS = new Map<string, Intl.DateTimeFormat>();
function clockFor(kind: 'time' | 'day', tz: string): Intl.DateTimeFormat {
  const key = `${kind}|${tz}`;
  let f = CLOCKS.get(key);
  if (!f) {
    const how: Intl.DateTimeFormatOptions = kind === 'time' ? { hour: 'numeric', minute: 'numeric', hourCycle: 'h23' } : { month: 'short', day: 'numeric', weekday: 'short' };
    try { f = new Intl.DateTimeFormat('en-US', { ...how, timeZone: tz || undefined }); }
    catch { f = new Intl.DateTimeFormat('en-US', how); }                    // (a time zone this browser does not know: its own clock)
    CLOCKS.set(key, f);
  }
  return f;
}

/** The time now, brought up to date every `ms`. */
function useNow(ms: number) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), ms);
    return () => window.clearInterval(t);
  }, [ms]);
  return now;
}

/** Hour and minute on the house's clock: the time in the town the admin picked (or the host PC's own), the same for
 *  everybody. `?hour=14` in the address previews an hour. */
function houseTime(d: Date, tz: string): [number, number] {
  const forced = PREVIEW.get('hour');
  if (forced !== null && forced !== '') return [((Number(forced) % 24) + 24) % 24, 0];
  const parts = clockFor('time', tz).formatToParts(d);
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return [n('hour') % 24, n('minute')];
}
/** The house's clock, ticking: re-read every `ms`. */
function useHouseTime(ms: number): [number, number, Date, string] {
  const tz = useStore((s) => s.settings.tz);
  const now = useNow(ms);
  const [h, m] = houseTime(now, tz);
  return [h, m, now, tz];
}

/** The weather to show: the real reading for the house's town, or `?weather=rain` (storm, snow, fog, clouds, clear) in the address to preview one. */
function useWeather(): Weather | null {
  const real = useStore((s) => s.weather);
  const forced = PREVIEW.get('weather');
  if (!forced) return real;
  const kind = (['clear', 'clouds', 'rain', 'storm', 'snow', 'fog'] as const).find((k) => k === forced) ?? 'clear';
  return { kind, cover: kind === 'clear' ? 0.1 : kind === 'fog' ? 0.7 : 1, text: kind, temp: real?.temp ?? null, unit: real?.unit ?? 'F', at: 0 };
}

/** A door out to the outdoors, in the room's east wall (the campsite) or west wall (the backyard): its frame (the wall's own
 *  trim, lit as the room is), what is seen beyond it, dimmed with the hour as the windows' views are, and the daylight it
 *  lets in across the floor, only by day. */
const OutDoor = memo(function OutDoor({ fit }: { fit: Fit }) {
  const [hour, minute] = useHouseTime(60_000);
  const light = CLUB.light[hour] + (CLUB.light[(hour + 1) % 24] - CLUB.light[hour]) * (minute / 60);
  const sfx = useSceneArt((fit as { seasons?: string[] }).seasons);      // (the grass beyond it in the season's colours: client/src/season.tsx)
  const d = fit.things.door, pic = (name: string) => `url(/basement/${fit.id}/${name}${name === 'doorview' ? sfx : ''}.png)`;
  return (
    <>
      {d.sun && light > 0 && <i className={`club-door-sun${d.side === 'west' ? ' west' : ''}`} style={{ ...box(d.sun), opacity: 0.55 * light }} />}
      <i className="club-door" style={{ ...box(d.at), backgroundImage: pic('doorview'), filter: `brightness(${0.18 + 0.82 * light}) saturate(${0.5 + 0.5 * light})` }} />
      <i className="club-door" style={{ ...box(d.at), backgroundImage: pic('door') }} />
    </>
  );
});

/** One window's view. The windows look out on ONE sky: `index` says which stretch of it this window shows (they sit side
 *  by side in the sky, wall or no wall between them), so there is one sun or moon, which slides out of one window and
 *  into the next, and the clouds carry on from one to the other. */
const Outside = memo(function Outside({ at, index, count }: { at: number[]; index: number; count: number }) {
  const wx = useWeather();
  const cover = wx?.cover ?? 0.4, wet = wx?.kind === 'rain' || wx?.kind === 'storm';
  const [hour, minute] = useHouseTime(30_000);
  const w = at[2], h = at[3], next = (hour + 1) % 24, t = minute / 60;
  const light = CLUB.light[hour] + (CLUB.light[next] - CLUB.light[hour]) * t;
  // one sun by day and one moon by night, each crossing from left to right and setting behind the hills
  const clock = hour + t, day = clock >= 6 && clock < 18;
  const across = day ? (clock - 6) / 12 : ((clock + 6) % 24) / 12;
  const orb = 10, kind = !day ? 0 : clock >= 8 && clock < 16.5 ? 1 : 2;
  const sky = w * count;                                        // the whole sky's width; this window shows from index * w
  const orbAt: CSSProperties = {
    left: sky * 0.06 + sky * 0.88 * across - index * w - orb / 2, top: h * 0.8 - h * 0.6 * Math.sin(Math.PI * across) - orb / 2, width: orb, height: orb,
    backgroundPosition: `${-kind * orb}px 0`, backgroundSize: `${orb * 3}px ${orb}px`,
  };
  const strip = (name: string, hr: number, opacity = 1) => <i className={name} style={{ backgroundPosition: `${-hr * w}px 0`, backgroundSize: `${w * 24}px ${h}px`, opacity }} />;
  const bar = `color-mix(in srgb, #8a5a3c ${Math.round(100 - 62 * (1 - light))}%, #100e22)`;
  return (
    <div className="club-window" style={box(at)}>
      {strip('sky', hour)}{strip('sky', next, t)}
      <i className="orb" style={{ ...orbAt, opacity: 1 - 0.9 * Math.max(0, (cover - 0.5) * 2) }} />
      <i className="overcast" style={{ opacity: Math.max(0, cover - 0.4) * (wet ? 1.1 : 0.8) * (0.35 + 0.65 * light) + (wet ? 0.15 : 0) }} />
      {/* the clouds drift 60 dots in 70 s (the second band in 48 s): starting each window that much further along makes one band of them */}
      <i className="clouds" style={{ filter: `brightness(${(0.3 + 0.7 * light) * (wet ? 0.7 : 1)})`, opacity: (0.35 + 0.6 * light) * Math.min(1, 0.25 + cover), animationDelay: `${-((index * w) / 60) * 70}s` }} />
      {cover > 0.7 && <i className="clouds second" style={{ filter: `brightness(${(0.3 + 0.7 * light) * (wet ? 0.6 : 0.9)})`, opacity: 0.3 + 0.5 * light, animationDelay: `${-((index * w) / 60) * 48}s` }} />}
      {strip('ground', hour)}{strip('ground', next, t)}
      {wet && <i className={`wx rain${wx?.kind === 'storm' ? ' hard' : ''}`} />}
      {wx?.kind === 'storm' && <i className="wx flash" />}
      {wx?.kind === 'snow' && <i className="wx snow" />}
      {wx?.kind === 'fog' && <i className="wx fog" style={{ opacity: 0.5 + 0.5 * light }} />}
      {/* the bars across the glass are indoors, so the weather goes behind them */}
      {(w > 50 ? [25, 50, 75] : [50]).map((at) => <i key={at} className="muntin v" style={{ background: bar, left: `${at}%` }} />)}<i className="muntin h" style={{ background: bar }} />
    </div>
  );
});

/** The season out of doors, from the month (by the house's date): the yard is drawn in each one's colours. `?date=01-15`
 *  in the address previews a day, and `?season=winter` a season. */
function useSeason(): 'spring' | 'summer' | 'fall' | 'winter' {
  const [, , now, tz] = useHouseTime(60_000);
  const month = useMemo(() => Number(houseDay(tz, now).slice(0, 2)), [tz, now]);
  const asked = PREVIEW.get('season');
  if (asked === 'spring' || asked === 'summer' || asked === 'fall' || asked === 'winter') return asked;
  return month >= 3 && month <= 5 ? 'spring' : month >= 6 && month <= 8 ? 'summer' : month >= 9 && month <= 11 ? 'fall' : 'winter';
}

/** How things stand outdoors just now: the daylight (0 to 1), the weather, and how far the yard is darkened for them. */
function useOutdoors() {
  const wx = useWeather();
  const [hour, minute] = useHouseTime(30_000);
  const next = (hour + 1) % 24;
  const light = CLUB.light[hour] + (CLUB.light[next] - CLUB.light[hour]) * (minute / 60);
  const wet = wx?.kind === 'rain' || wx?.kind === 'storm', cover = wx?.cover ?? 0.4;
  return { wx, light, wet, dusk: Math.min(0.8, (1 - light) * 0.62 + Math.max(0, cover - 0.5) * 0.2 * light + (wet ? 0.12 : 0)) };
}

/** The yard: one fixed scene laid out round the house (drawn by yard_art in scripts/make-clubhouse.py), with the room at
 *  the same place in it always. The panel is a window on to it: a bigger panel shows more of it, and nothing in it moves.
 *  Past the scene's own edges the lawn and the street simply carry on. The weather happens out here: night, rain, snow,
 *  fog; and after dark, unless it is raining, the fire pit is lit. `at` is where the room's corner is in the panel, on
 *  screen; everything else is in the room's own dots. */
const Yard = memo(function Yard({ zoom, at }: { zoom: number; at: number[] }) {
  const { wx, light, wet, dusk } = useOutdoors();
  const Y = CLUB.yard, x = at[0] / zoom, y = at[1] / zoom;
  const fire = light < 0.35 && !wet;
  // Life out there in fair weather: birds across the sky and butterflies by the beds while it is light, fireflies once
  // it is dark. None of it in rain, snow or fog.
  const fair = !!wx && !wet && wx.kind !== 'snow' && wx.kind !== 'fog';
  const season = useSeason();
  return (
    <div className={`yard s-${season}`} style={{ zoom, backgroundPosition: `${x}px ${y}px` }}>
      <i className="yard-street" style={{ left: 0, right: 0, top: y + Y.street[0], height: Y.street[1], backgroundPosition: `${x}px 0`, backgroundSize: `${Y.street[2]}px ${Y.street[1]}px` }} />
      <i className="yard-scene" style={box([x + Y.box[0], y + Y.box[1], Y.box[2], Y.box[3]])} />
      {wx?.kind === 'snow' && <i className="yard-cover snowed" />}
      {/* the holiday's decorations out here (client/src/holidays/outdoor.tsx): under the night, as the yard is */}
      <OutdoorDecor scene="yard" light={1} ox={x} oy={y} />
      {/* (no leaves, petals or pollen blowing about out here: from indoors they drifted over the room's walls, and nothing
          blows about outside while you are in. They are in the outdoor scenes themselves: client/src/season.tsx) */}
      <i className="yard-cover dusk" style={{ opacity: dusk }} />
      {/* the fire is not dimmed by the night: it and its light go over the dark */}
      {fire && <i className="yard-glow" style={box([x + Y.pit[0] - 72, y + Y.pit[1] - 44, 144, 96])} />}
      {fire && <i className="yard-fire" style={box([x + Y.fire[0], y + Y.fire[1], Y.fire[2], Y.fire[3]])} />}
      {fair && light > 0.5 && [[-70, 9], [-118, 13], [372, 11]].map(([top, secs], k) => (
        <i key={`bird${k}`} className="yard-bird" style={{ top: y + top, animationDuration: `${secs}s, 0.34s`, animationDelay: `${-k * 4.3}s, ${-k * 0.1}s` }} />
      ))}
      {fair && light > 0.5 && season !== 'winter' && [[88, 350, '#ffd84a'], [334, 356, '#ff8fc0'], [452, -34, '#8fd0ff'], [-48, 96, '#ffffff']].slice(0, season === 'fall' ? 2 : 4).map(([bx, by, colour], k) => (
        <i key={`fly${k}`} className="yard-butterfly" style={{ left: x + (bx as number), top: y + (by as number), color: colour as string, animationDelay: `${-k * 2.7}s, ${-k * 0.07}s` }} />
      ))}
      {fair && light < 0.3 && (season === 'summer' || season === 'spring') && [[-64, -52], [36, 362], [152, -30], [262, 374], [384, -66], [474, 352], [582, 118], [-92, 220]].map(([bx, by], k) => (
        <i key={`glow${k}`} className="yard-firefly" style={{ left: x + bx, top: y + by, animationDelay: `${-k * 1.3}s, ${-k * 2.1}s` }} />
      ))}
      {wet && <i className={`yard-cover rain${wx?.kind === 'storm' ? ' hard' : ''}`} />}
      {wx?.kind === 'storm' && <i className="yard-cover flash" />}
      {wx?.kind === 'snow' && <i className="yard-cover snow" />}
      {wx?.kind === 'fog' && <i className="yard-cover fog" />}
    </div>
  );
});

/** The tops of what grows along the front of the house: they stand in front of its near wall, so this strip of the
 *  yard goes over the bottom edge of the room, darkened (and snowed on) as the yard is. */
const YardFront = memo(function YardFront() {
  const { wx, dusk } = useOutdoors();
  const season = useSeason();
  const f = CLUB.yard.front;
  if (!f[3]) return null;
  return <i className={`yard-front s-${season}`} style={{ ...box(f), zIndex: 3001 }}>{wx?.kind === 'snow' && <b className="snowed" />}<b style={{ opacity: dusk }} /></i>;
});

/** The room's light. The room itself is shown exactly as it is drawn, at every hour: nothing dims it, tints it or
 *  washes over it (it once followed the clock: darker and bluer at night, then lit and warm; both got in the way of
 *  seeing the room). All that is left is each lamp's own glow, the same day and night. */
/** The room itself, inside the thickness of the house's walls: [x, y, width, height]. */
const INSIDE = [6, 4, CLUB.w - 12, CLUB.h - 10];
/** A clip that keeps a lit patch (`r`: [x, y, width, height]) inside the room, off the walls round it. */
const within = (r: number[]) => `inset(${Math.max(0, INSIDE[1] - r[1])}px ${Math.max(0, r[0] + r[2] - INSIDE[0] - INSIDE[2])}px ${Math.max(0, r[1] + r[3] - INSIDE[1] - INSIDE[3])}px ${Math.max(0, INSIDE[0] - r[0])}px)`;

const RoomLight = memo(function RoomLight({ lights = CLUB.lights }: { lights?: typeof CLUB.lights }) {
  // (none of it falls on the house's own walls, the dark border round the room: that stays one colour)
  return <>{lights.map((l, k) => <i key={k} className="club-glow" style={{ left: l.x - l.rx, top: l.y - l.ry, width: l.rx * 2, height: l.ry * 2, clipPath: within([l.x - l.rx, l.y - l.ry, l.rx * 2, l.ry * 2]), opacity: l.a, '--g': l.color } as CSSProperties} />)}</>;
});

/** What the room puts out by itself: the holidays' decorations, balloons on the desk of anyone whose birthday it is
 *  (by the house's date), and a cake and a card on the kitchen table. `?date=12-25` in the address previews a day. */
const Seasonal = memo(function Seasonal({ people, seats, mini }: { people: User[]; seats: Map<string, number>; mini: boolean }) {
  const [, , now, tz] = useHouseTime(60_000);
  const today = useMemo(() => houseDay(tz, now), [tz, now]);
  /** One piece from the strip, standing with its bottom-left corner at (x, y). */
  const piece = (name: keyof typeof CLUB.deco.at, x: number, y: number, key: string, z = y) => {
    const [sx, w, h] = CLUB.deco.at[name];
    return <i key={key} className="deco" style={{ left: x, top: y - h, width: w, height: h, zIndex: z, backgroundPosition: `${-sx}px 0`, backgroundSize: `${CLUB.deco.size[0]}px ${CLUB.deco.size[1]}px` }} />;
  };
  const parties = people.filter((u) => u.birthday === today && seats.has(u.id) && seats.get(u.id)! < CLUB.pcs.length);
  return (
    <>
      {/* the holidays' decorations (client/src/holidays/): they took over from the October pumpkins and the December tree */}
      <HolidayDecor room="club" />
      {parties.map((u) => {
        const pc = CLUB.pcs[seats.get(u.id)!];
        const z = Math.max(pc.z, 1) + 1;      // in front of the desk itself
        return piece('balloons', pc.dx + 33, pc.dy + 6, `b${u.id}`, z);
      })}
      {/* the cake on the kitchen table, and the card beside it (client/src/birthday.tsx) */}
      <BirthdayCake mini={mini} />
    </>
  );
});

/** The clock in the corner of the wall, in the colour the app is set to: the time, the date under it, and the weather under that. */
const WallClock = memo(function WallClock() {
  const [h, m, now, tz] = useHouseTime(5_000);
  const wx = useWeather();
  const town = useStore((s) => s.settings.town);
  const day = Object.fromEntries(clockFor('day', tz).formatToParts(now).map((p) => [p.type, p.value]));
  return (
    <>
      <b className="club-clock" style={box(CLUB.clock)}>{h % 12 || 12}<i>:</i>{String(m).padStart(2, '0')}<small>{h < 12 ? 'AM' : 'PM'}</small></b>
      <b className="club-temp" style={box(CLUB.temp)} title={wx ? `${town || 'Outside'}: ${wx.text}` : town ? `${town}: waiting for the weather` : 'No town picked for the weather yet (Settings, Admin)'}>{wx ? `${wx.temp ?? '--'}° ${wx.text.split(/[\s/]+/).pop()}` : town ? '...' : ''}</b>
      <b className="club-temp" style={box(CLUB.date)}>{day.weekday} {day.month} {day.day}</b>
    </>
  );
});

/** The whiteboard on the wall: the shared drawing, small. Click it to open it up and draw. */
const WallBoard = memo(function WallBoard() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    paint(ref.current);
    return watchBoard(() => paint(ref.current));
  }, []);
  return <canvas ref={ref} className="club-board" width={BOARD_W} height={BOARD_H} style={box(CLUB.board)} title="The whiteboard: click to draw on it"
    onClick={(e) => { e.stopPropagation(); useStore.setState({ view: { kind: 'board' } }); }} />;
});

export { AT_COMPUTER, PLACES } from '../places';      // (in a file of its own: the phone page uses the list without the room)

/** One desk. They are all the same desk; whoever holds it brings the colour of its lights and the thing on it (while
 *  nobody does, the lights are grey). It is three pictures laid on the room (the chair, the desk, and the chair's back,
 *  which goes in front of whoever sits there), with the screens and the tower's fans over them. `doing` is what its
 *  owner is up to. (While they sleep it is not drawn at all: the room draws a bed in its place.) */
const Rig = memo(function Rig({ pc, owner, doing, rigRef }: { pc: (typeof CLUB.pcs)[number]; owner: User | undefined; doing: string; rigRef?: (el: HTMLDivElement | null) => void }) {
  const color = owner ? ledOf(owner.desk, personColor(owner)) : '#5b6079';
  const pics = deskPics(owner?.desk, color);
  const { art } = pics;
  const size = { left: pc.dx + art.ox, top: pc.dy + art.oy, width: art.desk.w, height: art.desk.h };
  // The chair is pushed in under the desk in this room (`pc.cy`). Its two pictures are drawn for a chair standing 8 dots
  // below the desk's origin (see draw/desk.ts), so they are laid that much higher: where the room has the chair.
  const seat = { ...size, top: size.top + pc.cy - (pc.dy + 8) };
  return (
    <div className={`rig ${doing}`} style={{ '--c': color } as CSSProperties} ref={rigRef}>
      {/* What is on each screen is drawn by the stylesheet, from what its owner is doing: see ".rig" there. It tells the
          screens apart by their place in here, so they come first (and go over the desk's picture by their z-index). */}
      {art.screens.map((sc, n) => <i key={n} className="rig-screen" style={{ ...box([pc.dx + sc[0], pc.dy + sc[1], sc[2], sc[3]]), zIndex: pc.z + 1 }} />)}
      <i className="rig-art" style={{ ...seat, zIndex: 1, backgroundImage: `url(${pics.chair})` }} />
      <i className="rig-art" style={{ ...size, zIndex: pc.z, backgroundImage: `url(${pics.desk})` }} />
      <i className="rig-art" style={{ ...seat, zIndex: pc.back, backgroundImage: `url(${pics.back})` }} />
      {art.fans.map((f, n) => <i key={n} className="rig-fan" style={{ left: pc.dx + f[0], top: pc.dy + f[1], zIndex: pc.z + 1 }} />)}
    </div>
  );
});

export const Hangout = memo(function Hangout({ mini = false }: { mini?: boolean }) {
  const me = useStore((s) => s.me);
  const users = useStore((s) => s.users);
  const presence = useStore((s) => s.presence);
  const previews = useStore((s) => s.previews);
  const watchingScreens = useStore((s) => s.view.kind === 'stage');
  // (only these three: the room is not drawn again each time the noise gate opens or shuts)
  const voiceChannel = useStore((s) => s.voice.channelId);
  const speaking = useStore((s) => s.voice.speaking);
  const micMuted = useStore((s) => s.voice.muted);
  const musicOn = useStore((s) => !!s.music.current && s.music.current.pausedAt == null);

  const people = useMemo(() => Object.values(users).filter((u) => u.role !== 'removed').sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)), [users]);
  const myPlace: Place = (me && presence[me.id]?.place) || '';
  // Upstairs, or the basement fitted out one way or another: the room is drawn, and walked on, as whichever I am on.
  const view = floorOf(me ? presence[me.id] : undefined);
  const fit = view ? FITS[view] ?? null : null;
  onGrid(fit ? fit.grid : CLUB.grid);
  const [stairsMenu, setStairsMenu] = useState<{ x: number; y: number } | null>(null);
  /** Taking the stairs: my room goes dark at once ('dark'), I am on the other floor standing at the stairs, and it comes
   *  back up ('in'). Nobody waits for me to walk there: everybody else on the floor I left sees me walk to the stairs and go. */
  const [move, setMove] = useState<{ to: string; phase: 'dark' | 'in'; t0: number } | null>(null);
  const replan = useRef<() => void>(() => {});
  const [seated, setSeated] = useState<boolean[]>([]);

  // The room fills its panel: as large as will fit, at any size (the art is published at 4x and scaled down smoothly).
  // The yard only shows in whatever room the panel has left over beside or above and below it, because the panel is
  // not the room's shape. The yard itself is one fixed scene: what shows there is whatever lies next to the house.
  const wrap = useRef<HTMLDivElement>(null);
  const [space, setSpace] = useState([0, 0]);                  // the panel's size on screen
  // A basement fit-out may show only part of the basement (the DnD room is a small chamber): that part fills the panel.
  const crop = fit?.view ?? null;
  const VW = crop ? crop[2] : CLUB.w, VH = crop ? crop[3] : CLUB.h;
  // (rounded down: never a hair too big for the panel)
  const zoom = useMemo(() => (space[0] ? Math.max(0.3, Math.min(8, Math.floor(Math.min(space[0] / VW, space[1] / VH) * 200) / 200)) : 1.5), [space, VW, VH]);
  useLayoutEffect(() => {
    const el = wrap.current!;
    const fit = () => setSpace((was) => (was[0] === el.clientWidth && was[1] === el.clientHeight ? was : [el.clientWidth, el.clientHeight]));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  /** Where the room's top-left corner goes in the panel, in whole screen dots, so the yard lines up with it exactly. */
  const corner = useMemo(() => [Math.floor((space[0] - zoom * VW) / 2), Math.floor((space[1] - zoom * VH) / 2)], [space, zoom, VW, VH]);

  // ── the people: positions live outside React and are moved every frame ──
  const actors = useRef(new Map<string, Actor>());
  /** The drink standing on each desk (by desk), and what was last drawn there: set from the frame loop. */
  const deskCups = useRef<(HTMLElement | null)[]>([]);
  const deskShown = useRef<string[]>([]);
  /** Each desk's monitors, for the frame loop to say who is talking on a video call (data-talk). */
  const rigs = useRef<(HTMLDivElement | null)[]>([]);
  const nodes = useRef(new Map<string, HTMLDivElement>());
  const clubNode = useRef<HTMLDivElement>(null);          // the room itself: what is thrown about in it is added to it
  const pets = useRef(new Map<string, Pet>());
  const acts = useRef<Act[]>([]);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [deskMenu, setDeskMenu] = useState<{ x: number; y: number } | null>(null);
  const [drinkMenu, setDrinkMenu] = useState<{ x: number; y: number; from: Source } | null>(null);
  // The menu of things to hold is as long as its list (up to nine rows): once it is drawn, it is moved up as far as it
  // takes to end inside the room, rather than guessing its height.
  const drinkMenuNode = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = drinkMenuNode.current;
    if (!el || !drinkMenu) return;
    el.style.top = `${Math.max(4, Math.min(drinkMenu.y, CLUB.h - el.offsetHeight - 4))}px`;
  }, [drinkMenu]);
  const [photo, setPhoto] = useState<string | null>(null);      // the photo off the wall that is opened up large
  useEffect(() => {
    if (!photo) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setPhoto(null); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [photo]);
  const [hot, setHot] = useState<{ say: string; can: boolean } | null>(null);      // what the place under the pointer says, and whether a click there does anything; null when it is over none
  const petNodes = useRef(new Map<string, HTMLDivElement>());
  const ballNode = useRef<HTMLDivElement>(null);
  // Paper for the bin: whether I have a wad in my hand; the dotted line shown while I aim; and when I last let go
  // (the click that ends a drag is not a click on the room).
  const [holding, setHolding] = useState(false);
  const aimNode = useRef<HTMLDivElement>(null);
  const aimedAt = useRef(0);
  const latest = useRef({ people, presence, view, move });
  latest.current = { people, presence, view, move };

  useEffect(() => {
    /** Sends somebody to a goal: step out of the bed or chair, walk, and step in at the far end, so nobody slides through furniture. */
    const sendTo = (a: Actor, goal: Goal) => {
      if (a.goal.key === goal.key || (goal.stay && a.arrived)) { a.goal = goal; if (a.arrived) a.shown = ''; return; }      // same place: only what they are doing changes
      if (a.arrived) { a.x = a.goal.ax; a.y = a.goal.ay; }
      const from = { x: a.x, y: a.y }, to = { x: goal.ax, y: goal.ay };
      a.path = route(from, to);
      a.goal = goal;
      a.arrived = false;
    };

    // ── actions ──
    const busy = (id: string) => acts.current.some((x) => x.a === id || x.b === id);
    const actGoal = (act: Act, id: string): Goal => {
      const mine = act.a === id;
      if (act.kind === 'lap') {
        const w = LAP[act.phase];
        return { key: `act${act.id}lap${act.phase}`, x: w.x, y: w.y, ax: w.x, ay: w.y, anim: loop('idle', 0, 1000), fx: '', reach: 0, speed: RUN };
      }
      const spot = mine ? act.spotA : act.spotB!;
      const step = act.phase < 0 ? null : stepsOf(act.kind, act.mirror)[act.phase];
      const [anim, fx] = step ? (mine ? step.a : step.b!) : [loop('idle', 0, 1000), '' as Fx];
      return { key: `act${act.id}${mine ? 'a' : 'b'}`, x: spot.x, y: spot.y, ax: spot.x, ay: spot.y, anim, fx, reach: 0, stay: !!(mine ? act.prevA : act.prevB) };
    };
    const startAct = (d: { id: number; kind: string; from: string; target: string; pet?: string; dx?: number; dy?: number }) => {
      const kind = d.kind as ActKind;
      const A = actors.current.get(d.from), B = d.target ? actors.current.get(d.target) : undefined;
      if (!A || A.goal.fx === 'gone' || busy(d.from)) return;
      if (d.target && (!B || B.goal.fx === 'gone' || busy(d.target))) return;
      if (kind === 'kick') {                                 // walk up behind the football, the way it was aimed, and kick it
        const ball = useStore.getState().ball;
        if (!ball || ball.path) return;                      // (it is still rolling)
        const aim = aimOf(d.dx ?? 0, d.dy ?? 0), len = Math.hypot(aim.x, aim.y);
        if (len < 3) return;
        // Behind it, on the far side from where it is going; the nearest floor to there if there is none.
        const back = { x: Math.round(ball.x - (aim.x / len) * 9), y: Math.round(ball.y - (aim.y / len) * 6) };
        const spotA = free(...cellOf(back)) ? back : centre(...nearestFree(back));
        const act: Act = { id: d.id, kind, a: d.from, b: '', aim, phase: -1, until: 0, started: performance.now(), spotA, mirror: spotA.x < ball.x || (spotA.x === ball.x && aim.x > 0) };
        acts.current.push(act);
        sendTo(A, actGoal(act, act.a));
        return;
      }
      if (kind === 'pet') {                                  // walk over to a pet and make a fuss of it
        const pet = d.pet ? pets.current.get(d.pet) : undefined;
        if (!pet || pet.pose === 'gone' || pet.held) return;
        if (pet.path.length) { pet.path = []; pet.pose = 'sit'; pet.spot = -1; pet.perch = -1; pet.dest = { x: pet.x, y: pet.y }; }      // on its way somewhere: it stops and waits
        pet.held = true;
        const gap = 13, open = (x: number) => free(...cellOf({ x, y: pet.y }));
        const mirror = !open(pet.x + gap) && open(pet.x - gap);                               // no room on its right: stand on its left
        const spotA = open(pet.x + gap) || mirror ? { x: pet.x + (mirror ? -gap : gap), y: pet.y } : centre(...nearestFree({ x: pet.x + gap, y: pet.y }));
        const act: Act = { id: d.id, kind, a: d.from, b: '', pet: d.pet, phase: -1, until: 0, started: performance.now(), spotA, mirror };
        acts.current.push(act);
        sendTo(A, actGoal(act, act.a));
        return;
      }
      const stand = (x: Actor) => centre(...nearestFree({ x: x.goal.ax, y: x.goal.ay }));       // on their feet, just clear of their seat
      const act: Act = { id: d.id, kind, a: d.from, b: d.target, phase: kind === 'lap' ? 0 : -1, until: 0, started: performance.now(), spotA: stand(A), mirror: false };
      // Something done alone happens right where they are: they get up, do it, and are back as they were. No walking off.
      if (!B && kind !== 'lap' && A.arrived) { act.spotA = { x: A.goal.x, y: A.goal.y }; act.prevA = A.goal; }
      if (B) {
        const gap = GAP[kind] ?? 18;
        const open = (at: Pt, x: number) => free(...cellOf({ x, y: at.y }));
        /** Open floor all the way from there to `dx` along: room for somebody to stand, with nothing between the two. */
        const clear = (at: Pt, dx: number) => { for (let k = 0; k * CLUB.cell < Math.abs(dx); k++) if (!open(at, at.x + Math.sign(dx) * k * CLUB.cell)) return false; return open(at, at.x + dx); };
        let at: Pt = { x: B.goal.x, y: B.goal.y };
        // if there is floor beside them where they are, they just stand up there; otherwise they step clear of their seat first
        if (B.arrived && (open(at, at.x + gap) || open(at, at.x - gap))) act.prevB = B.goal;
        else {
          // ...to the nearest patch of floor with room for somebody beside them. (Just "clear of the seat" could be a gap
          // one person wide, between two desks say: the other was then put wherever was nearest, in front of them or
          // behind, and the two hugged the air.)
          at = stand(B);
          const [c0, r0] = cellOf(at);
          search: for (let d = 0; d < 14; d++) for (let r = r0 - d; r <= r0 + d; r++) for (let c = c0 - d; c <= c0 + d; c++) {
            if (Math.max(Math.abs(r - r0), Math.abs(c - c0)) !== d || !free(c, r)) continue;
            const p = centre(c, r);
            if (clear(p, gap) || clear(p, -gap)) { at = p; break search; }
          }
        }
        act.spotB = at;
        const beside = (dx: number) => (act.prevB ? open(at, at.x + dx) : clear(at, dx));
        act.mirror = !beside(gap) && beside(-gap);                                            // no room on their right: stand on their left
        act.spotA = beside(gap) || act.mirror ? { x: at.x + (act.mirror ? -gap : gap), y: at.y } : centre(...nearestFree({ x: at.x + gap, y: at.y }));
      }
      acts.current.push(act);
      sendTo(A, actGoal(act, act.a));
      if (B) sendTo(B, actGoal(act, act.b));
    };
    const stepActs = (t: number) => {
      for (const act of [...acts.current]) {
        const A = actors.current.get(act.a), B = act.b ? actors.current.get(act.b) : undefined;
        const end = () => {                                                                      // and everyone goes back to what they were doing
          acts.current = acts.current.filter((x) => x !== act);
          const pet = act.pet ? pets.current.get(act.pet) : undefined;
          if (pet) { pet.held = false; if (pet.pose === 'petted') pet.pose = 'sit'; }
          for (const [who, prev] of [[A, act.prevA], [B, act.prevB]] as const) if (who && prev) { who.goal = prev; who.x = prev.x; who.y = prev.y; who.arrived = true; who.shown = ''; }
          plan();
        };
        if (!A || (act.b && !B) || t - act.started > 40_000) { end(); continue; }
        const show = () => { sendTo(A, actGoal(act, act.a)); if (B) sendTo(B, actGoal(act, act.b)); };
        if (act.kind === 'lap') {
          if (A.arrived && A.goal.key === `act${act.id}lap${act.phase}`) { act.phase++; if (act.phase >= LAP.length) end(); else show(); }
          continue;
        }
        const steps = stepsOf(act.kind, act.mirror);
        // An action this copy of the app has no steps for (the server is newer) is over at once. Reading its first
        // step threw, here in the middle of a frame, and no frame was ever asked for again: the room stood still.
        if (!steps.length) { end(); continue; }
        if (act.phase < 0) {                                                                    // both in place? then it begins
          if (A.arrived && A.goal.key === `act${act.id}a` && (!B || (B.arrived && B.goal.key === `act${act.id}b`))) { act.phase = 0; act.until = t + steps[0].ms; const pet = act.pet ? pets.current.get(act.pet) : undefined; if (pet) pet.pose = 'petted'; show(); }
        } else if (t >= act.until) {
          act.phase++;
          if (act.phase >= steps.length) end(); else { act.until = t + steps[act.phase].ms; show(); }
          // The kick itself: whoever it is tells the server as their leg swings through, and the server sends everyone the roll.
          if (act.kind === 'kick' && act.phase === 1 && act.a === useStore.getState().me?.id && act.aim) send({ t: 'kick', x: Math.round(A.x), y: Math.round(A.y), dx: act.aim.x, dy: act.aim.y });
        }
      }
    };
    hooks.act.push(startAct);

    // ── paper thrown at the bin: each wad in the air (or lying where it missed) is a picture of its own, moved every frame ──
    type Flight = Toss & { el: HTMLElement; shade: HTMLElement; t0: number; seen?: boolean; landed?: number };
    const flights: Flight[] = [];
    const room = () => clubNode.current;
    const BIN = CLUB.trash;
    /** A few words that float up from the bin and fade. */
    const callout = (text: string, at: Pt = { x: BIN.x, y: BIN.y - BIN.rim - 12 }, big = false) => {
      const club = room();
      if (!club) return;
      const b = document.createElement('b');
      b.className = big ? 'club-callout big' : 'club-callout';
      b.textContent = text;
      b.style.left = `${at.x}px`; b.style.top = `${at.y}px`;
      club.append(b);
      window.setTimeout(() => b.remove(), big ? 2600 : 1900);
    };
    /** Confetti bursting out of a point: `n` bits, thrown up and out as far as `reach`. */
    const confetti = (x: number, y: number, n: number, reach: number) => {
      const club = room();
      if (!club) return;
      const hues = ['#e5484d', '#f2c230', '#3fbf63', '#4f9cf0', '#d98ac0', '#f4f1e9', '#f08a2c'];
      for (let k = 0; k < n; k++) {
        const c = document.createElement('i'), angle = -Math.PI / 2 + (Math.random() - 0.5) * 2.4, go = reach * (0.3 + Math.random() * 0.7);
        c.className = 'club-confetti';
        c.style.cssText = `left:${x - 1 + (Math.random() - 0.5) * 6}px;top:${y}px;width:${1 + (k % 2)}px;height:${1 + ((k >> 1) % 2)}px;--c:${hues[k % hues.length]};`
          + `--dx:${(Math.cos(angle) * go).toFixed(1)}px;--up:${(Math.sin(angle) * go).toFixed(1)}px;--down:${(10 + Math.random() * 16).toFixed(1)}px;--rot:${Math.round(Math.random() * 720)}deg;animation-delay:${(Math.random() * 0.15).toFixed(2)}s`;
        club.append(c);
        window.setTimeout(() => c.remove(), 2100);
      }
    };
    /** It went in: paper streamers burst out of the bin, and a word about the shot. */
    const celebrate = (f: Flight) => {
      const club = room();
      if (!club) return;
      confetti(BIN.x, BIN.y - BIN.rim, 36 + Math.min(4, f.streak) * 8, 42);
      const mine = f.from === useStore.getState().me?.id, who = mine ? '' : `${useStore.getState().users[f.from]?.name ?? 'Somebody'}: `;
      callout(who + (f.streak >= 2 ? `${f.streak} in a row!` : f.rims ? 'Off the rim and in!' : f.far >= 150 ? 'From downtown!' : f.far >= 80 ? 'Nice shot!' : 'Swish!'));
    };
    const onToss = (d: Toss) => {
      const club = room();
      // (the bin is upstairs, and so is the paper: somebody down in the basement does not see it fly)
      if (!club || !d.path.length || latest.current.view) return;
      const el = document.createElement('i'), shade = document.createElement('i');
      el.className = 'club-wad'; shade.className = 'club-wad-shadow';
      club.append(shade, el);
      flights.push({ ...d, el, shade, t0: performance.now() });
    };
    hooks.toss.push(onToss);
    let first = true;                       // the first look at the room: pets are where they would be, not walking in
    let planned: string | null = null;      // the floor the people now in the room are on

    const plan = () => {
      const { people, presence } = latest.current;
      const scene: Scene = { now: Date.now(), taken: new Set(), seat: 0, movie: false, side: false };
      const sideId = useStore.getState().channels.filter((c) => c.kind === 'voice')[1]?.id;
      const seatsIn = new Map<number, number>();      // how many are seated so far, in each voice chat
      const showing = new Set<number>();      // voice channels where somebody is sharing a screen
      for (const u of people) { const v = presence[u.id]?.voice; if (v?.sharing) showing.add(v.channelId); }
      const seen = new Set<string>();
      /** The place somebody holds: the desk the server gave them, or, with none of their own, a visitor's laptop. */
      const slotOf = (u: User) => { const q = presence[u.id]; return q && (q.slot ?? -1) >= 0 ? q.slot! : CLUB.pcs.length + (hash(u.id) % CLUB.laptops.length); };
      // The floor I am on: the room shows the people on it. Anybody on another floor is at the stairs, out of sight:
      // somebody leaving walks over to them and is gone; somebody arriving comes out of them. When I have just taken
      // the stairs myself, everybody on the new floor is simply where they are.
      const view = latest.current.view, fit = view ? FITS[view] ?? null : null;
      if (planned !== view) {
        if (planned !== null) { actors.current.clear(); acts.current = []; }
        for (const f of flights.splice(0)) { f.el.remove(); f.shade.remove(); }      // (paper in the air stays on the floor it was thrown on)
        planned = view;
      }
      const here = (u: User) => floorOf(presence[u.id]) === view;
      // Seats people chose by clicking are spoken for before anybody else is seated. Not the chair at somebody else's
      // desk, though: its owner has first call on it, so whoever picked one is placed after everybody else.
      const guestAt = (u: User) => { const q = presence[u.id], m = q?.place === 'here' ? /^pc(\d+)$/.exec(q.at?.seat ?? '') : null; return m && Number(m[1]) !== slotOf(u) ? 1 : 0; };
      for (const u of people) {
        const q = presence[u.id];
        if (here(u) && q?.place === 'here' && q.at?.seat && q.state !== 'offline' && !q.at.seat.startsWith('pc')) scene.taken.add(heldAs(q.at.seat));
      }
      [...people].sort((a, b) => guestAt(a) - guestAt(b)).forEach((u) => {
        seen.add(u.id);
        const p = presence[u.id];
        const i = slotOf(u);
        const seated = !!p?.voice && (p.state === 'desk' || p.state === 'away') && !p.place;
        scene.seat = 0;
        if (seated) { scene.seat = seatsIn.get(p!.voice!.channelId) ?? 0; seatsIn.set(p!.voice!.channelId, scene.seat + 1); }
        scene.side = !!p?.voice && p.voice.channelId === sideId;
        scene.movie = !!p?.voice && !scene.side && showing.has(p.voice.channelId);
        let goal = !here(u) ? stairsGoal(fit, floorOf(presence[u.id])) : fit ? fitGoal(u, p, fit, scene) : goalFor(u, i, p, scene);
        const a = actors.current.get(u.id);
        // (somebody already holding a drink when the room is first looked at has it: no trip to the fridge)
        if (!a) { actors.current.set(u.id, { x: goal.x, y: goal.y, path: [], goal, arrived: true, shown: '', got: p?.drink?.since }); return; }
        // Just come up or down the stairs onto my floor: out of the stairs (wherever they were last seen walking off to them)
        if (here(u) && (a.goal.key === 'stairs' || a.goal.key === 'door') && a.goal.fx === 'gone') { const st = a.goal.key === 'door' ? a.goal : stairsGoal(fit); a.x = st.x; a.y = st.y; a.path = []; a.arrived = true; a.goal = st; }
        if (busy(u.id)) return;                 // in the middle of doing something: their usual place waits
        // A drink is fetched before it is held: over to the fridge, a moment in front of it, and then back to wherever
        // they would be, with it in their hand.
        // (from wherever it is kept: the fridge, the coffee table, the microwave or the media console)
        if (p?.drink && a.got !== p.drink.since && fit) a.got = p.drink.since;      // (in the basement they brought it down with them)
        if (p?.drink && a.got !== p.drink.since && goal.fx !== 'gone') {
          const src = sourceOf(p.drink.kind), f = FETCH_AT[src];
          if (a.goal.key === `fetch:${src}` && a.arrived) {
            a.fridgeAt ??= scene.now;
            if (scene.now - a.fridgeAt > 1200) { a.got = p.drink.since; a.fridgeAt = undefined; }
          }
          if (a.got !== p.drink.since) goal = { key: `fetch:${src}`, x: f.x, y: f.y, ax: f.x, ay: f.y, anim: still(f.face, 1), fx: '', reach: 0 };
        }
        sendTo(a, goal);
      });
      for (const id of actors.current.keys()) if (!seen.has(id)) actors.current.delete(id);

      // The pets: each is here while its owner is online (in a voice chat or not), walking in when they sign
      // in and out again when they go offline. Every PET_SLOT each one picks something to do: a cat is up the cat tree four times in ten;
      // otherwise eat, go and sit by somebody (a dog mostly by its owner), or sit or nap in one of the usual spots.
      // No two take the same place.
      const online = new Set(people.filter((u) => !!presence[u.id] && presence[u.id]?.state !== 'offline').map((u) => u.id));
      const defs = petsOf(people);
      for (const id of pets.current.keys()) if (!defs.some((d) => d.id === id)) pets.current.delete(id);        // somebody's pet is no more
      const door: Pt = { x: CLUB.door.x, y: CLUB.door.y };
      defs.forEach((def) => {
        const k = hash(def.id) % 8;                        // so they do not all get up at the same moment
        if (fit) { pets.current.delete(def.id); return; }      // (the pets stay upstairs)
        const pet = pets.current.get(def.id);
        if (!online.has(def.id)) {                     // its owner has gone offline: it trots out of the door after them
          if (pet && pet.pose !== 'gone' && !pet.held) { pet.path = [...route(pet, door), door]; pet.pose = 'gone'; pet.spot = -1; pet.perch = -1; pet.dest = door; }
          return;
        }
        const slot = Math.floor((Date.now() + k * 4300) / PET_SLOT);       // they do not all get up at the same moment
        // Its owner asleep in their bed (their desk turned bed): it goes and sleeps on them, curled up on the blanket
        // and stays there until they get up. Then it is off about its day at once.
        const sleeper = actors.current.get(def.id);
        const bedOf = sleeper && sleeper.arrived ? /^bed(\d+)$/.exec(sleeper.goal.key) : null;
        if (bedOf && !pet?.held) {
          const n = Number(bedOf[1]), bed = CLUB.pcs[n].bed;
          const onIt: Pt = { x: bed.x - 9, y: bed.at[1] + 63 };
          if (pet && pet.bed === n && pet.pose !== 'gone') return;
          const foot = centre(...nearestFree({ x: bed.ax - 10, y: bed.ay }));
          const from: Pt | null = !pet ? (first ? null : door) : pet.pose === 'gone' && !pet.path.length ? door : { x: pet.x, y: pet.y };
          const walk = from ? route(from, foot) : [];
          pets.current.set(def.id, from && walk.length
            ? { ...from, kind: def.kind, path: [...walk, foot, onIt], slot, pose: 'sleep', shown: '', spot: -1, perch: -1, dest: onIt, held: false, bed: n }
            : { ...onIt, kind: def.kind, path: [], slot, pose: 'sleep', shown: '', spot: -1, perch: -1, dest: onIt, held: false, bed: n });
          return;
        }
        if (pet && (pet.held || (pet.slot === slot && pet.pose !== 'gone' && pet.bed === undefined))) return;
        const others = [...pets.current].filter(([id, p]) => id !== def.id && p.pose !== 'gone').map(([, p]) => p);
        const here = [...actors.current].filter(([, a]) => a.goal.fx !== 'gone');
        const spots = CLUB.pets.spots, h = scramble(slot * 8 + k), pick = h % 100;
        let spot = (h >>> 8) % spots.length;
        while (others.some((p) => p.spot === spot)) spot = (spot + 1) % spots.length;
        const by = (a: Actor): Pt => ({ x: a.goal.ax + ((h >>> 5) % 2 ? 12 : -12), y: a.goal.ay + 3 });
        const mine = here.find(([id]) => id === def.id)?.[1];
        let to: Pt = spots[spot], at = spot;
        // A cat is on the cat tree four times in ten, on whichever shelf no other cat has; the rest of its time (and all
        // of a dog's) goes as it always did, in the same shares: `rest` is `pick` again, over what is left.
        const tree = CLUB.pets.tree, free0 = (h >>> 12) % tree.perches.length;
        const shelf = def.kind === 'cat' && pick < 40 ? [0, 1, 2].map((n) => (free0 + n) % tree.perches.length).find((n) => !others.some((p) => p.perch === n)) ?? -1 : -1;
        const rest = def.kind === 'cat' ? Math.max(0, Math.floor(((pick - 40) * 100) / 60)) : pick;
        let pose: Pet['pose'] = rest < 60 ? 'sit' : 'sleep';
        if (shelf >= 0) { pose = (h >>> 4) % 5 < 2 ? 'sleep' : 'sit'; at = -1; }
        else if (rest < 18 && !others.some((p) => p.pose === 'eat')) { to = CLUB.pets.bowl; pose = 'eat'; at = -1; }
        else if (def.kind === 'dog' && rest < 62 && mine) { to = by(mine); pose = 'sit'; at = -1; }
        else if (rest < 40 && here.length) { to = by(here[(h >>> 8) % here.length][1]); pose = 'sit'; at = -1; }
        // (to a shelf: over to the foot of the tree on the floor, then one jump up)
        let end: Pt = shelf >= 0 ? centre(...nearestFree(tree.foot)) : pose === 'eat' ? { x: to.x, y: to.y } : centre(...nearestFree(to));
        if (shelf < 0 && at < 0 && others.some((p) => Math.hypot(p.dest.x - end.x, p.dest.y - end.y) < 14)) {       // somebody is already there: a spot of its own instead
          at = spot; end = centre(...nearestFree(spots[spot])); if (pose === 'eat') pose = 'sit';
        }
        const last: Pt = shelf >= 0 ? { x: tree.perches[shelf].x, y: tree.perches[shelf].y } : end;
        // a pet whose owner has just come online walks in from the door; with no way there on foot it simply turns up
        const from: Pt | null = !pet ? (first ? null : door) : pet.pose === 'gone' && !pet.path.length ? door : { x: pet.x, y: pet.y };
        const walk = from ? route(from, end) : [];
        pets.current.set(def.id, from && walk.length
          ? { ...from, kind: def.kind, path: shelf >= 0 ? [...walk, end, last] : [...walk, end], slot, pose, shown: '', spot: at, perch: shelf, dest: last, held: false }
          : { ...last, kind: def.kind, path: [], slot, pose, shown: '', spot: at, perch: shelf, dest: last, held: false });
      });
      first = false;
      // Which of the basement's seats somebody is sat in, for the fit-out's own drawing (the controllers' cords, say)
      const sat = fit ? fit.seats.map((_, n) => [...actors.current.values()].some((a) => a.arrived && a.goal.key === `b${n}` && a.goal.fx !== 'gone')) : [];
      setSeated((was) => (was.join() === sat.join() ? was : sat));
    };
    replan.current = plan;
    plan();
    const timer = window.setInterval(plan, 1000);
    let raf = 0, last = performance.now();
    let ballAt: Pt | null = null, ballRolled = 0, ballShown = '';       // where the ball was last drawn, how far it has rolled, and what was last written to it
    let ballEl: HTMLElement | null = null;                              // (and to which element: back upstairs, it is a new one, drawn afresh)
    let cheered = 0;                                                    // the roll whose goal has been cheered (by when it began)
    /** It went in the goal: GOAL!, and confetti out of the net. */
    const scored = (by: string) => {
      const G = CLUB.goal, mine = by === useStore.getState().me?.id;
      confetti(G.x, G.y - 8, 90, 60);
      window.setTimeout(() => confetti(G.x, G.y - 8, 50, 46), 350);
      callout('GOOOOAAALLL!', { x: G.x + 22, y: G.y - 30 }, true);
      if (!mine) window.setTimeout(() => callout(`${useStore.getState().users[by]?.name ?? 'Somebody'} scores!`, { x: G.x + 22, y: G.y - 14 }), 500);
    };
    const frame = (t: number) => {
      const dt = Math.min(0.1, (t - last) / 1000);
      last = t;
      if (acts.current.length) stepActs(t);
      const onDesk: string[] = [];                  // desk → the drink standing on it this frame
      const vcall: string[] = [];                   // desk → who is talking on its video call this frame ('man' or 'woman' on the screen, or 'you')
      const fitGame = latest.current.view ? FITS[latest.current.view]?.game : undefined;      // (a fit-out's own say in how its sitters are drawn: FitGame.pose)
      for (const [id, a] of actors.current) {
        let anim = a.goal.anim, fx: Fx = a.goal.fx;
        // Out of the shower the moment they say so, not a second later when they are next sent somewhere: the sheet
        // they are drawn from in there is taken off them as soon as they stop showering.
        if (fx === 'shower' && latest.current.presence[id]?.place !== 'showering') fx = '';
        // (moved by the fit-out itself just now: the mower, pushed straight where it is steered)
        const steered = fitGame?.steer ? fitGame.steer(id) : null;
        if (steered) { a.x = steered.x; a.y = steered.y; a.path = []; a.arrived = true; }
        // Sweeping: where they are in a round of strokes (each person in their own time), and whether this is the step on.
        const sweeping = fx === 'sweep', out = sweeping && ((t + (hash(id) % 1000)) % SWEEP_STROKE) / SWEEP_STROKE < SWEEP_PUSH;
        let stroke = '';
        if (!a.arrived) {
          let step = sweeping ? (out ? SWEEP_SPEED * dt : 0) : (a.goal.speed ?? SPEED) * dt, dx = 0, dy = 0;
          if (sweeping && a.path.length) { dx = a.path[0].x - a.x; dy = a.path[0].y - a.y; }       // (standing at their strokes, they still face the way they are going)
          while (step > 0 && a.path.length) {
            const to = a.path[0];
            dx = to.x - a.x; dy = to.y - a.y;
            const d = Math.hypot(dx, dy);
            if (d <= step) { a.x = to.x; a.y = to.y; a.path.shift(); step -= d; } else { a.x += (dx / d) * step; a.y += (dy / d) * step; step = 0; }
          }
          if (!a.path.length) { a.arrived = true; a.x = a.goal.x; a.y = a.goal.y; }
          else {
            const row: SpriteRow = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'walk_left' : 'walk_right') : dy < 0 ? 'walk_up' : 'walk_down';
            anim = { row, first: 0, frames: 4, ms: a.goal.speed ? 75 : 150 };
            fx = fx === 'sweep' ? fx : '';              // (the broom goes with them)
          }
        }
        if (fx === 'spin') anim = still((['walk_down', 'walk_left', 'walk_up', 'walk_right'] as const)[Math.floor(t / 110) % 4], 1);
        if (sweeping) {
          // The broom is drawn into their frames (the sweep row), in both hands and standing on the floor at their feet,
          // so it goes behind whatever they are behind. Facing us, or side on (heading away from us they turn side on to
          // it, to the side that is their own): pushed out and stepping into it, then drawn back. The stylesheet kicks
          // up dust off the straw on each push (`stroke`).
          if (anim.row.startsWith('walk_')) a.face = anim.row;          // (the way they are going, or were when they got there)
          const face = a.face ?? 'walk_down';
          const view = face === 'walk_down' ? 'front' : face === 'walk_right' || (face === 'walk_up' && hash(id) % 2 === 1) ? 'right' : 'left';
          stroke = `${view} ${out ? 'out' : 'in'}`;
          anim = view === 'front' ? still('sweep', out ? 0 : 1) : still('sweep', out ? 2 : 3, view === 'right');
        }
        if (fx === 'call' && a.arrived) {
          // Pacing on the phone: to us, side on, to us, the other side; breathing as they stand.
          const turn = Math.floor((t + (hash(id) % CALL_TURN)) / CALL_TURN) % 4, breath = Math.floor(t / 1100) % 2;
          anim = turn % 2 === 0 ? still('call', breath) : still('call', 2 + breath, turn === 3);
        }
        if (fx === 'vcall' && a.arrived) {
          const who = vcallTurn(t, hash(id) % 100_000), pc = Number(a.goal.key.slice(2));
          vcall[pc] = who;
          anim = who === 'you' ? still('gaming_back', Math.floor(t / VCALL_BOB) % 2) : still('gaming_back', 0);      // (in the headset, as for a game)
        }
        // In one of a fit-out's seats, the game may say how they are drawn (at the campfire: a stick held out, a marshmallow eaten).
        const fitPose = a.arrived && fitGame?.pose && !busy(id) ? fitGame.pose(id, a.goal.key) : null;
        if (fitPose) { anim = fitPose; fx = ''; }
        const el = nodes.current.get(id);
        if (!el) continue;
        // Their drink, once they have been to the fridge for it (not in bed or in the shower). Standing
        // or sitting facing us, they hold it properly: the frames with that arm bent, the drink at the chest, and for
        // a second or so in every nine, lifted to the mouth. (Each person sips in their own time.)
        const cup = latest.current.presence[id]?.drink;
        // Anything they are doing with their hands comes first: in the middle of an action (petting, a hug, a dance, a lap...)
        // or sweeping, cooking, on the phone, the drink is put away, and back in the hand once they are done.
        let held = cup && a.got === cup.since && !busy(id) && !HANDS_BUSY.has(fx) && !fitPose ? cup.kind : '';
        // Sat at a desk (theirs or anybody's), it is put down on the desk's front-left corner, and the hand is free.
        const atDesk = held && a.arrived ? /^pc(\d+)$/.exec(a.goal.key) : null;
        if (atDesk) { onDesk[Number(atDesk[1])] = held; held = ''; }
        if (held && a.arrived && anim.first < 2 && (anim.row === 'idle' || anim.row === 'sit_front')) {
          // (a toy from the console is played with in the hand, never lifted to the mouth: the stylesheet animates it)
          const sip = sourceOf(held) !== 'console' && (t + (hash(id) % 9000)) % 9000 > 7700;
          // (the frames are stepped from here, not by the stylesheet, so the drink and the arm under it move as one: it
          // rises and falls with their breathing, where they would be breathing: not lying still on a bean bag)
          const breath = anim.frames > 1 ? Math.floor(t / anim.ms) % 2 : 0;
          anim = still(anim.row === 'idle' ? 'drink' : 'drink_sit', (sip ? 2 : 0) + breath);
        }
        if (el !== a.el) { a.el = el; a.px = a.py = a.dy = undefined; a.clip = 0; el.style.clipPath = ''; a.mouth = undefined; a.shown = ''; a.drink = undefined; }       // a new element: everything is set on it afresh
        if (held !== a.drink) {
          a.drink = held;
          if (held) { el.dataset.drink = held; el.style.setProperty('--di', String(Math.max(0, (CLUB.drinks as string[]).indexOf(held)))); }      // its picture on drinks.png
          else delete el.dataset.drink;
        }
        // (most frames nobody has moved, and nothing is written)
        const px = Math.round(a.x), py = Math.round(a.y);
        // out of doors, the fit-out may lower them into the water (and hide what is under it), or lift them in a dive
        const body = fitGame?.body && !busy(id) ? fitGame.body(id, a.goal.key, a.x, a.y) : null;
        const dy = Math.round(body?.dy ?? 0), clip = Math.max(0, Math.round(body?.clip ?? 0));
        if (fitGame) drawn.set(id, { x: a.x, y: a.y, row: anim.row, flip: !!anim.flip, first: anim.first, frames: anim.frames, ms: anim.ms, el });
        if (px !== a.px || py !== a.py || dy !== a.dy) {
          a.px = px; a.py = py; a.dy = dy;
          el.style.transform = `translate(${px - 24}px, ${py - 45 + dy}px)`;
          el.style.zIndex = String(py);
        }
        if (clip !== (a.clip ?? 0)) { a.clip = clip; el.style.clipPath = clip ? `inset(-200px -200px ${clip}px -200px)` : ''; }
        // talking: flick between the usual frames and the same ones with the mouth open
        // (on the phone they talk in bursts, and listen in between)
        const chat = fx === 'call' && a.arrived && (t + (hash(id) % 9000)) % 9000 < 4200 && Math.floor(t / 700) % 3 !== 2;
        const mouth = (el.classList.contains('speaking') || fx === 'laugh' || chat) && mouthOpen(t) ? '4' : '0';
        if (a.mouth !== mouth) { a.mouth = mouth; (el.firstElementChild as HTMLElement).style.setProperty('--talk', mouth); }
        const key = `${anim.row}/${anim.first}/${anim.frames}/${anim.ms}/${anim.flip ? 1 : 0}/${fx}/${a.goal.reach}/${stroke}`;
        if (key !== a.shown) {
          a.shown = key;
          const sp = el.firstElementChild as HTMLElement;
          sp.style.setProperty('--row', String(rowIndex(anim.row)));
          sp.style.setProperty('--from', String(anim.first));
          sp.style.setProperty('--n', String(anim.frames));
          sp.style.setProperty('--dur', `${anim.ms * anim.frames}ms`);
          sp.style.transform = anim.flip ? 'scaleX(-1)' : '';
          sp.classList.toggle('anim', anim.frames > 1);
          el.style.setProperty('--reach', `${a.goal.reach}px`);
          el.dataset.fx = fx;
          el.dataset.stroke = stroke;
          el.dataset.flip = anim.flip ? '1' : '';
          // which way they face, for whatever is in their hand: the side-on rows face left unless flipped (walk_right is drawn facing right)
          el.dataset.view = /_up$|_back$|^gaming$|^floored$/.test(anim.row) ? 'back' : /left|right|side|reach|punch/.test(anim.row) ? ((anim.row === 'walk_right') !== !!anim.flip ? 'right' : 'left') : 'front';
          // how a drink is held just now: in a fist at the chest ('cup') or lifted for a sip, sitting or not, and a dot lower as they breathe out; otherwise it is in the hand at their side
          el.dataset.hold = anim.row === 'drink' || anim.row === 'drink_sit' ? `${anim.first >= 2 ? 'sip' : 'cup'}${anim.row === 'drink_sit' ? ' sit' : ''}${anim.first % 2 ? ' down' : ''}` : '';
          el.dataset.pose = anim.row === 'sleep' ? (anim.first >= 2 ? 'bed' : 'sleep') : anim.row.startsWith('sit') || anim.row === 'drink_sit' || anim.row.startsWith('gaming') || anim.row.startsWith('roast') ? 'sit' : 'stand';
        }
      }
      for (let n = 0; n < CLUB.pcs.length; n++) {
        const rig = rigs.current[n], who = vcall[n] ?? '';
        if (rig && (rig.dataset.talk ?? '') !== who) { if (who) rig.dataset.talk = who; else delete rig.dataset.talk; }
      }
      for (let n = 0; n < CLUB.pcs.length; n++) {
        const kind = onDesk[n] ?? '', node = deskCups.current[n];
        if (!node || deskShown.current[n] === kind) continue;
        deskShown.current[n] = kind;
        if (kind) { node.dataset.drink = kind; node.style.setProperty('--di', String(Math.max(0, (CLUB.drinks as string[]).indexOf(kind)))); }
        else delete node.dataset.drink;
      }
      if (!latest.current.view) stepVacuum(t, actors.current, pets.current);      // the robot vacuum (client/src/vacuum.tsx)
      for (const [petId, kn] of petNodes.current) {
        const k = pets.current.get(petId);
        if (!k || (k.pose === 'gone' && !k.path.length)) { if (kn.style.display) kn.style.display = ''; continue; }       // not here
        if (!kn.style.display) kn.style.display = 'block';
        const rode = latest.current.view ? null : vacuumPet(petId, k.kind, k, t);      // riding the robot vacuum, or chasing it (client/src/vacuum.tsx)
        let row = k.pose === 'eat' ? 4 : k.pose === 'sleep' ? 5 : k.pose === 'petted' ? 6 : 3, ms = k.pose === 'eat' ? 260 : k.pose === 'petted' ? 240 : 1000, flip = false;
        if (k.path.length) {
          let step = PET_SPEED[k.kind] * dt, dx = 0, dy = 0;
          while (step > 0 && k.path.length) {
            const to = k.path[0];
            dx = to.x - k.x; dy = to.y - k.y;
            const d = Math.hypot(dx, dy);
            if (d <= step) { k.x = to.x; k.y = to.y; k.path.shift(); step -= d; } else { k.x += (dx / d) * step; k.y += (dy / d) * step; step = 0; }
          }
          if (k.path.length) {
            if (Math.abs(dx) > Math.abs(dy)) { row = 1; flip = dx > 0; } else row = dy < 0 ? 2 : 0;
            ms = 130;
          }
        }
        const px = Math.round(k.x), py = Math.round(k.y);
        // (on the cat tree, or jumping on to it, it is in front of the tree, which is otherwise in front of everything behind its foot)
        // (on its owner's bed, or hopping up on to it, it is over the bed and over them)
        const pz = rode !== null ? rode : k.bed !== undefined && Math.hypot(k.x - k.dest.x, k.y - k.dest.y) < 30 ? CLUB.pcs[k.bed].bed.y + 3
          : k.perch >= 0 && Math.hypot(k.x - k.dest.x, k.y - k.dest.y) < 50 ? CLUB.pets.tree.z + 1 : py - 1;
        if (px !== k.px || py !== k.py || pz !== k.pz) {
          k.px = px; k.py = py; k.pz = pz;
          kn.style.transform = `translate(${px - 12}px, ${py - 22}px)`;
          kn.style.zIndex = String(pz);            // just behind anybody level with it, so a hand stroking it shows
        }
        const key = `${row}/${flip ? 1 : 0}`;
        if (key !== k.shown) {
          k.shown = key;
          const sp = kn.firstElementChild as HTMLElement;
          sp.style.setProperty('--row', String(row));
          sp.style.setProperty('--dur', `${ms * 4}ms`);
          sp.style.transform = flip ? 'scaleX(-1)' : '';
          kn.dataset.pose = row === 5 ? 'sleep' : row === 6 ? 'petted' : '';
        }
      }
      // Paper in the air: along the flight the server sent, straight across the picture, drawn exactly where it is
      // (so it is seen to touch whatever it comes off). The higher it is, the bigger it is drawn and the further off
      // its shadow lies. In the bin, it is gone and the bin bursts; a miss lies there two seconds and fades.
      for (let n = flights.length - 1; n >= 0; n--) {
        const f = flights[n], at = Math.max(0, (t - f.t0) / f.ms), k = Math.floor(at), last = f.path.length - 1;
        // Thrown while the window could not be seen (no frames are drawn then) and long since down: it is not shown at
        // all. Every throw of an hour away used to land in the same frame on the way back, each with its burst.
        if (!f.seen && last > 0 && at >= last) { f.el.remove(); f.shade.remove(); flights.splice(n, 1); continue; }
        f.seen = true;
        let p = f.path[last];
        if (k < last) { const a0 = f.path[k], b0 = f.path[k + 1], u = at - k; p = [a0[0] + (b0[0] - a0[0]) * u, a0[1] + (b0[1] - a0[1]) * u, a0[2] + (b0[2] - a0[2]) * u]; }
        else if (f.landed === undefined) {
          f.landed = t;
          if (f.made) celebrate(f); else if (f.rims) callout('Rimmed out!');
        }
        if (f.landed !== undefined && (f.made || t - f.landed > 2700)) { f.el.remove(); f.shade.remove(); flights.splice(n, 1); continue; }
        if (f.landed !== undefined && t - f.landed > 2000) { f.el.classList.add('fade'); f.shade.classList.add('fade'); }
        f.el.style.transform = `translate(${Math.round(p[0]) - 3}px, ${Math.round(p[1]) - 3}px) scale(${(1 + p[2] * GROW).toFixed(2)})`;
        f.el.style.zIndex = String(Math.round(p[1]) + (p[2] > 0 ? 80 : 0));      // (in the air it is in front of what it is passing over)
        f.shade.style.transform = `translate(${Math.round(p[0] + p[2] * 0.06) - 2}px, ${Math.round(p[1] + p[2] * 0.1) + 2}px)`;
        f.shade.style.zIndex = String(Math.round(p[1]) - 1);
      }
      // The football: lying where it is, or part of the way along the roll the server sent. It turns as it goes: a
      // quarter of the way round for every few dots.
      const ball = useStore.getState().ball, bn = ballNode.current;
      if (ball && bn) {
        let bx = ball.x, by = ball.y;
        if (ball.path) {
          const f = Math.max(0, (t - ball.t0) / ball.ms), k = Math.floor(f);
          if (k >= ball.path.length - 1) useStore.setState({ ball: { ...ball, path: null } });      // it has stopped
          else { const p = ball.path[k], q = ball.path[k + 1], u = f - k; bx = p[0] + (q[0] - p[0]) * u; by = p[1] + (q[1] - p[1]) * u; }
          // (a roll that went in: cheered once, as it gets there; not when the page catches up long after)
          if (ball.goal !== undefined && ball.goal >= 0 && k >= ball.goal && cheered !== ball.t0) { cheered = ball.t0; if (k - ball.goal < 20) scored(ball.by ?? ''); }
        }
        if (ballAt) ballRolled += Math.min(40, Math.hypot(bx - ballAt.x, by - ballAt.y));
        ballAt = { x: bx, y: by };
        const key = `${Math.round(bx)},${Math.round(by)},${Math.floor(ballRolled / 5) % 4}`;
        if (bn !== ballEl) { ballEl = bn; ballShown = ''; }
        if (key !== ballShown) {
          ballShown = key;
          bn.style.transform = `translate(${Math.round(bx) - 5}px, ${Math.round(by) - 9}px)`;
          bn.style.zIndex = String(Math.round(by));
          bn.style.backgroundPositionX = `${-11 * (Math.floor(ballRolled / 5) % 4)}px`;
        }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf); window.clearInterval(timer); hooks.act.splice(hooks.act.indexOf(startAct), 1);
      hooks.toss.splice(hooks.toss.indexOf(onToss), 1);
      for (const f of flights) { f.el.remove(); f.shade.remove(); }
    };
  }, []);

  // what people just typed in chat pops up over their heads for a few seconds
  const [said, setSaid] = useState<Record<string, { text: string; at: number }>>({});
  useEffect(() => {
    const onMessage = (m: Message) => {
      if (!useStore.getState().channels.some((c) => c.id === m.channelId)) return;      // a private message is not said out loud
      const a = m.attachments[0];
      const text = veiled(m.content).replace(/\s+/g, ' ').trim() || (a ? (a.kind === 'image' ? '[picture]' : a.kind === 'file' ? '[file]' : '') : '');
      if (!text) return;
      const at = Date.now();
      setSaid((s) => ({ ...s, [m.userId]: { text: text.length > 46 ? `${text.slice(0, 45)}…` : text, at } }));
      window.setTimeout(() => setSaid((s) => {
        if (s[m.userId]?.at !== at) return s;
        const next = { ...s };
        delete next[m.userId];
        return next;
      }), 7000);
    };
    hooks.message.push(onMessage);
    return () => { hooks.message.splice(hooks.message.indexOf(onMessage), 1); };
  }, []);

  // ── what the room itself shows ──
  const sharers = people.filter((u) => presence[u.id]?.voice?.sharing);
  const mine = sharers.filter((u) => presence[u.id]!.voice!.channelId === voiceChannel);
  const onScreen = (mine.length ? mine : sharers).slice(0, 4);
  // Nobody sharing, but somebody has the Player's video large: the projector comes down for that, and says so.
  const playerNow = useStore((s) => s.music.current);
  const bigWatchers = playerNow ? people.filter((u) => presence[u.id]?.voice?.big && presence[u.id]?.state !== 'offline') : [];
  const playerUp = !onScreen.length && bigWatchers.length > 0;
  // (A game nobody is sharing never brings the projector down: it is on its player's own monitor, and that is all.)
  const screenDown = onScreen.length > 0 || playerUp;
  const bigNames = bigWatchers.map((u) => u.name).join(', ');
  const openScreen = async () => {
    if (!onScreen.length) return;
    setPrefs({ roomOpen: true });
    await watchScreens(presence[onScreen[0].id]!.voice!.channelId);
  };
  // who holds which desk right now (the server hands the six out as people come online)
  const seats = useMemo(() => {
    const m = new Map<string, number>();
    for (const u of people) { const p = presence[u.id]; if (p && p.state !== 'offline' && (p.slot ?? -1) >= 0) m.set(u.id, p.slot!); }
    return m;
  }, [people, presence]);
  const atPc = (k: number): [User | undefined, string] => {
    const u = people.find((x) => seats.get(x.id) === k);
    const p = u && presence[u.id];
    if (!p || p.state === 'offline') return [u, 'off'];
    if (p.place === 'prompting') return [u, 'prompting'];                  // a conversation with an AI assistant on the screens
    if (p.place === 'vcall') return [u, 'vcall'];                          // a face on the main monitor, talking by turns with them
    const doing = p.place === 'gaming' || p.place === 'watching' ? p.place : p.place === 'working' ? 'desk' : p.place || p.state === 'away' || (p.voice && p.state === 'desk') ? '' : p.state;
    if (!doing) return [u, 'off'];
    return [u, doing === 'watching' && /youtube/i.test(p.label) ? 'watching yt' : doing];
  };
  const wall = useStore((s) => s.settings.wall);            // today's photos on the lounge wall, by frame: whatever the admin has hung there
  // the house's date, for birthday hats (looked at again once a minute, not every time the room is drawn: working it out is slow)
  const [, , minuteNow, tz] = useHouseTime(60_000);
  const today = useMemo(() => houseDay(tz, minuteNow), [tz, minuteNow]);
  const petDefs = useMemo(() => petsOf(people), [people]);
  /** The desks that are beds just now: whoever holds them has said they are sleeping. */
  const inBed = new Set(people.filter((u) => presence[u.id]?.place === 'sleeping' && presence[u.id]?.state !== 'offline').map((u) => seats.get(u.id) ?? 99).filter((k) => k < CLUB.pcs.length));

  // Places in the room can be clicked to say where you are: the sofa, the theatre, a desk, the shower and so on.
  /** Where in the room the mouse is, in the room's own dots. */
  const roomXY = (e: ReactMouseEvent<HTMLDivElement>): Pt => {
    const r = pageRect(e.currentTarget);
    return { x: ((e.clientX - r.left) * CLUB.w) / r.width, y: ((e.clientY - r.top) * CLUB.h) / r.height };
  };
  const canPick = !mini;
  const myAt = me ? presence[me.id]?.at : undefined;
  /** What a click at that point would do. In this order: a seat (that very one; one somebody else chose is theirs), the
   *  game table, open floor (anywhere that can be walked on, whatever it is near), a piece of furniture that means
   *  something (the kitchen, a desk, the shower and so on), and last a point just off the edge of the floor, which is taken
   *  to mean the nearest place to stand. One function, so what the pointer says and what a click does cannot disagree. */
  const targetAt = (p: Pt): Target | null => {
    const door = !fit ? DOORS.find((f) => inBox(p, f.things.door.hit)) : undefined;
    if (door) return { kind: 'door', to: door.id };              // a door out: to the campfire, or the backyard
    if (inBox(p, fit ? fit.stairs.rect : CLUB.stairs.rect)) return { kind: 'stairs' };
    if (fit) {                                                    // the basement: its seats, and its open floor
      const n = fit.seats.findIndex((q) => inBox(p, q.hit));
      if (n >= 0) {
        const key = `b${n}`, q = fit.seats[n];
        const theirs = people.some((u) => u.id !== me?.id && presence[u.id]?.state !== 'offline' && floorOf(presence[u.id]) === view && presence[u.id]?.place === 'here' && presence[u.id]?.at?.seat === key);
        return theirs ? { kind: 'taken' } : { kind: 'seat', seat: { key, x: q.x, y: q.y, hit: q.hit }, mine: myPlace === 'here' && myAt?.seat === key };
      }
      const sp = (fit.spots ?? []).find(([, x, y, w, h]) => inBox(p, [x, y, w, h]));
      if (sp) return { kind: 'spot', what: sp[0], rect: sp.slice(1) as number[] };
      return free(...cellOf(p)) ? { kind: 'floor', x: p.x, y: p.y } : null;
    }
    // (the chair at a desk that is a bed just now is not there to be sat on)
    const seat = SEATS.find((q) => inBox(p, q.hit) && !(q.key.startsWith('pc') && inBed.has(Number(q.key.slice(2)))));
    if (seat) {
      const theirs = people.some((u) => u.id !== me?.id && presence[u.id]?.state !== 'offline' && (
        (presence[u.id]?.place === 'here' && presence[u.id]?.at?.seat === seat.key)
        // (and the chair at a desk is its owner's for as long as they are sitting at that desk)
        || (seat.key.startsWith('pc') && seats.get(u.id) === Number(seat.key.slice(2)) && actors.current.get(u.id)?.goal.key === seat.key)));
      // (the arcade machine can be played whoever is standing at it: there is just nowhere left to stand)
      return theirs ? (seat.key === 'arcade0' ? { kind: 'arcade' } : { kind: 'taken' }) : { kind: 'seat', seat, mine: myPlace === 'here' && myAt?.seat === seat.key };
    }
    const spot = (CLUB.spots as (string | number)[][]).find((q) => inBox(p, q.slice(1) as number[]));
    // a photo on the wall (if the admin has hung one there), where it shows: a desk standing in front of it is the desk's, not the photo's
    const hung = spot?.[0] === 'desk' ? undefined : FRAMES.find((f) => wall?.[f.name] && inBox(p, f.at));
    if (hung) return { kind: 'photo', src: wall![hung.name] };
    if (inBox(p, CLUB.games)) return { kind: 'games' };
    if (inBox(p, CLUB.trash.hit)) return { kind: 'spot', what: 'trash', rect: CLUB.trash.hit };      // the bin, all of its picture (the floor behind it is not for standing on)
    if (free(...cellOf(p))) return { kind: 'floor', x: p.x, y: p.y };
    if (spot) return { kind: 'spot', what: String(spot[0]), rect: spot.slice(1) as number[] };
    if (p.y >= FLOOR_TOP) {
      const to = centre(...nearestFree(p));
      if (Math.max(Math.abs(to.x - p.x), Math.abs(to.y - p.y)) <= 14) return { kind: 'floor', ...to };
    }
    return null;
  };
  /** Whether I am on my feet just now (walking or standing): paper is only thrown standing up. */
  const onMyFeet = () => { const el = me && nodes.current.get(me.id); return !!el && el.dataset.pose === 'stand' && !['gone', 'shower'].includes(el.dataset.fx ?? ''); };
  /** What the bin says when it is pointed at: what to do, and who has got the most in. */
  const binSays = () => {
    const made = useStore.getState().toss, best = Object.entries(made).filter(([id, n]) => n > 0 && users[id]).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([id, n]) => `${users[id].name} ${n}`).join(', ');
    return `${holding ? 'Drag the paper in your hand back, and let go' : onMyFeet() ? 'Grab some paper to throw' : 'Stand up to grab some paper'}${best ? `. In the bin: ${best}` : ''}`;
  };
  /** Aiming a throw: the wad in my hand is drawn back like a catapult, a dotted line shows the start of where it would
   *  go (the other way), and letting go throws it. A short tug is taken back: the paper stays in my hand. */
  const startAim = (e: ReactMouseEvent<HTMLElement>) => {
    e.preventDefault(); e.stopPropagation();
    const wad = e.currentTarget, club = wad.closest<HTMLElement>('.club'), layer = aimNode.current;
    if (!club || !layer) return;
    const inRoom = (cx: number, cy: number): Pt => { const r = pageRect(club); return { x: ((cx - r.left) * CLUB.w) / r.width, y: ((cy - r.top) * CLUB.h) / r.height }; };
    const box0 = pageRect(wad), hand = inRoom(box0.left + box0.width / 2, box0.top + box0.height / 2);
    const dots = [...layer.querySelectorAll<HTMLElement>('i')], band = layer.querySelector<HTMLElement>('b');
    let pull = { x: 0, y: 0 };                                               // how far back the hand is drawn, turned round: the way the paper will go
    const show = () => {
      const len = Math.hypot(pull.x, pull.y);
      layer.classList.toggle('on', len >= 5);
      wad.style.translate = `${-pull.x}px ${-pull.y}px`;
      aimDots(hand.x, hand.y, pull.x, pull.y, dots.length).forEach(([x, y], k) => { dots[k].style.transform = `translate(${x - 1}px, ${y - 1}px)`; });      // (the very start of the path the wad will be drawn along)
      if (band) { band.style.width = `${len}px`; band.style.transform = `translate(${hand.x}px, ${hand.y}px) rotate(${Math.atan2(-pull.y, -pull.x)}rad)`; }
    };
    const move = (ev: MouseEvent) => {
      const m = inRoom(ev.clientX, ev.clientY), dx = hand.x - m.x, dy = hand.y - m.y, len = Math.hypot(dx, dy), k = len > MAX_PULL ? MAX_PULL / len : 1;
      pull = { x: dx * k, y: dy * k };
      show();
    };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
      layer.classList.remove('on');
      wad.style.translate = '';
      wad.classList.remove('pulled');
      aimedAt.current = performance.now();
      if (Math.hypot(pull.x, pull.y) < 5) return;
      send({ t: 'toss', x: Math.round(hand.x * 10) / 10, y: Math.round(hand.y * 10) / 10, dx: Math.round(pull.x * 10) / 10, dy: Math.round(pull.y * 10) / 10 });
      setHolding(false);
    };
    wad.classList.add('pulled');
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);      // (pointer events: a finger on an iPad as well as the mouse)
  };
  /** Aiming a kick, the same way as a throw: the ball is drawn back like a catapult, a dotted line shows the start of
   *  where it would roll (the other way, off whatever it meets), and letting go sends me over to kick it just so. */
  const startKick = (e: ReactMouseEvent<HTMLElement>) => {
    e.preventDefault(); e.stopPropagation();
    const ballEl = e.currentTarget, club = ballEl.closest<HTMLElement>('.club'), layer = aimNode.current, ball = useStore.getState().ball;
    if (!canPick || !club || !layer || !ball || ball.path) return;
    const inRoom = (cx: number, cy: number): Pt => { const r = pageRect(club); return { x: ((cx - r.left) * CLUB.w) / r.width, y: ((cy - r.top) * CLUB.h) / r.height }; };
    const at = { x: ball.x, y: ball.y }, mid = { x: ball.x, y: ball.y - 4 };      // (where it lies, and the middle of its picture)
    const dots = [...layer.querySelectorAll<HTMLElement>('i')], band = layer.querySelector<HTMLElement>('b');
    let pull = { x: 0, y: 0 };
    const show = () => {
      const len = Math.hypot(pull.x, pull.y);
      layer.classList.toggle('on', len >= 5);
      ballEl.style.translate = `${-pull.x * 0.4}px ${-pull.y * 0.4}px`;
      if (len >= 5) kickDots(at, pull.x, pull.y, dots.length).forEach(([x, y], k) => { dots[k].style.transform = `translate(${x - 1}px, ${y - 5}px)`; });
      if (band) { band.style.width = `${len}px`; band.style.transform = `translate(${mid.x}px, ${mid.y}px) rotate(${Math.atan2(-pull.y, -pull.x)}rad)`; }
    };
    const move = (ev: MouseEvent) => {
      const m = inRoom(ev.clientX, ev.clientY);
      pull = aimOf(mid.x - m.x, mid.y - m.y);
      show();
    };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
      layer.classList.remove('on');
      ballEl.style.translate = '';
      ballEl.classList.remove('pulled');
      aimedAt.current = performance.now();
      if (Math.hypot(pull.x, pull.y) < 5) return;
      send({ t: 'act', kind: 'kick', dx: Math.round(pull.x * 10) / 10, dy: Math.round(pull.y * 10) / 10 });
    };
    ballEl.classList.add('pulled');
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);      // (pointer events: a finger on an iPad as well as the mouse)
  };
  // Taking the stairs, step by step (see `move`).
  useEffect(() => {
    if (!move || !me) return;
    if (move.phase === 'dark') {                 // in the dark: onto the other floor, standing just off the stairs
      // (back from the lake to the campsite: at the end of the path, not at the campsite's door)
      const dest = move.to ? FITS[move.to] ?? null : null, land = dest ? (fit?.things.back?.to === dest.id ? fit.things.back.foot : dest.stairs.foot) : fit?.outdoors ? fit.things.door?.foot ?? CLUB.stairs.top : CLUB.stairs.top;
      let sent = false;
      const go = window.setTimeout(() => { sent = send({ t: 'floor', fit: move.to, x: land.x, y: land.y }); }, 200);
      const check = window.setInterval(() => {
        if (!sent) return;
        if (floorOf(useStore.getState().presence[me.id]) !== move.to) { if (Date.now() - move.t0 > 20_000) setMove(null); return; }
        onGrid(dest ? dest.grid : CLUB.grid);
        replan.current();
        // Not on top of anybody: the nearest bit of floor round the stairs with nobody standing or sitting there.
        const mine = actors.current.get(me.id);
        if (mine) {
          const others = [...actors.current].filter(([id, a]) => id !== me.id && a.goal.fx !== 'gone').map(([, a]) => a);
          const clear = (q: Pt) => others.every((o) => Math.abs(o.x - q.x) >= 18 || Math.abs(o.y - q.y) >= 30);
          let spot: Pt = { x: mine.x, y: mine.y };
          if (!clear(spot)) {
            const [c0, r0] = nearestFree(land);
            search: for (let d = 1; d < 14; d++) for (let r = r0 - d; r <= r0 + d; r++) for (let c = c0 - d; c <= c0 + d; c++) {
              if (Math.max(Math.abs(r - r0), Math.abs(c - c0)) !== d || !free(c, r)) continue;
              const q = centre(c, r);
              if (clear(q)) { spot = q; break search; }
            }
            mine.x = spot.x; mine.y = spot.y; mine.path = []; mine.arrived = true;
            mine.goal = { ...mine.goal, key: `here:${spot.x},${spot.y}`, x: spot.x, y: spot.y, ax: spot.x, ay: spot.y };
            mine.shown = '';
            send({ t: 'place', place: 'here', x: spot.x, y: spot.y });
          }
        }
        setMove({ ...move, phase: 'in' });
      }, 40);
      return () => { window.clearTimeout(go); window.clearInterval(check); };
    }
    const t = window.setTimeout(() => setMove(null), 300);      // ('in': the room fades back up)
    return () => window.clearTimeout(t);
  }, [move, me]);
  /** Off up or down the stairs, to that floor. */
  const takeStairs = (to: string) => { setStairsMenu(null); setMenu(null); if (!move && to !== view) setMove({ to, phase: 'dark', t0: Date.now() }); };
  // Sent somewhere from outside the room (a game picked in Play Games): down (or up) the stairs, once any trip under way is over.
  const askedFloor = goFloor((s) => s.to);
  useEffect(() => {
    if (mini || askedFloor == null || move) return;
    goFloor.setState({ to: null });
    takeStairs(askedFloor);
  }, [askedFloor, move, mini]);   // eslint-disable-line react-hooks/exhaustive-deps
  /** Who is on each floor just now (online), for the stairs' menu. */
  const onFloor = (f: string) => people.filter((u) => { const q = presence[u.id]; return q && q.state !== 'offline' && floorOf(q) === f; }).length;

  const clickRoom = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (performance.now() - aimedAt.current < 300) return;      // (letting go of a throw, not a click)
    if (closeRadio()) return;                                  // (the radio's menu, from the boombox or a radio downstairs)
    if (menu) return setMenu(null);
    if (deskMenu) return setDeskMenu(null);
    if (drinkMenu) return setDrinkMenu(null);
    if (stairsMenu) return setStairsMenu(null);
    if (mini || move) return;
    const t = targetAt(roomXY(e));
    if (t?.kind === 'door') return takeStairs(t.to);           // out of a door
    if (t?.kind === 'stairs' && fit?.outdoors) return takeStairs(fit.things.back?.to ?? '');      // back in (from the lake: back to the campsite)
    if (t?.kind === 'stairs') { const at = roomXY(e); return setStairsMenu({ x: at.x + 6, y: at.y - 10 }); }
    if (t?.kind === 'photo') return setPhoto(t.src);            // (looking at a photo is always allowed, wherever I am)
    if (!canPick || !t || t.kind === 'taken') return;
    // The arcade machine: walk over and stand at it (if I am not there already, and nobody else is), and its games open.
    if (t.kind === 'arcade' || (t.kind === 'seat' && t.seat.key === 'arcade0')) {
      if (t.kind === 'seat' && !t.mine) send({ t: 'place', place: 'here', x: t.seat.x, y: t.seat.y, seat: t.seat.key });
      return void useStore.setState({ view: { kind: 'arcade' } });
    }
    // A seat: sit on that one (the same seat again: get up, and go back to wherever I would be).
    if (t.kind === 'seat') return send(t.mine ? { t: 'place', place: '' } : { t: 'place', place: 'here', x: t.seat.x, y: t.seat.y, seat: t.seat.key });
    if (t.kind === 'games') return void useStore.setState({ view: { kind: 'games' } });      // the table top: the games
    if (t.kind === 'floor') return send({ t: 'place', place: 'here', x: t.x, y: t.y });      // open floor: walk over and stand there
    if (t.what === 'trash') { if (onMyFeet()) setHolding(true); return; }                     // the bin: a wad of paper in my hand, to throw at it
    if (t.what === 'wardrobe') return void useStore.setState({ settingsOpen: 'character' });  // the wardrobe: the character builder
    if (t.what === 'desk') return setDeskMenu({ x: t.rect[0] + t.rect[2] / 2, y: t.rect[1] + 14 });
    if (SOURCES.includes(t.what as Source)) return setDrinkMenu({ x: t.rect[0] + t.rect[2], y: t.rect[1] - 20, from: t.what as Source });      // the fridge and the like: what would you like?
    send({ t: 'place', place: myPlace === t.what ? '' : t.what });                            // a named place (the same one again: back to "I'm here")
  };
  const pointAt = (e: ReactMouseEvent<HTMLDivElement>) => {
    const found = mini ? null : targetAt(roomXY(e));
    const t = canPick || found?.kind === 'photo' ? found : null;
    const fitSays = t?.kind === 'seat' && fit && !t.mine ? fit.game.says?.(Number(t.seat.key.slice(1))) : undefined;
    const say = !t ? null : t.kind === 'door' ? (FITS[t.to]?.things.door.say ?? 'Go outside') : t.kind === 'stairs' && fit?.outdoors ? (fit.things.back?.say ?? 'Go back inside') :t.kind === 'stairs' ? (fit ? 'Take the stairs: back up, or to another basement' : 'Take the stairs down')
      : fitSays ? fitSays : t.kind === 'photo' ? 'Look closer' : t.kind === 'arcade' || (t.kind === 'seat' && t.seat.key === 'arcade0') ? 'Play the arcade machine'
      : t.kind === 'seat' ? (t.mine ? 'Get up' : 'Sit here') : t.kind === 'taken' ? 'Taken' : t.kind === 'games' ? 'Play a game'
      : t.kind === 'floor' ? 'Stand here' : t.what === 'trash' ? binSays() : SPOT_SAYS[t.what] ?? '';
    if (say !== (hot?.say ?? null)) setHot(say === null ? null : { say, can: t?.kind !== 'taken' });
  };

  return (
    <section className={`hangout${mini ? ' mini' : ''}`}>
      <div className="club-row">
      <div className={`club-wrap${crop ? ' cropped' : ''}`} ref={wrap} style={fit?.things.bg ? { background: fit.things.bg } : undefined}>
        {space[0] > 0 && !crop && <Yard zoom={zoom} at={corner} />}
        <div className="club-at" style={crop ? { left: corner[0], top: corner[1], width: VW * zoom, height: VH * zoom, overflow: 'hidden' } : { left: corner[0], top: corner[1] }}>
        <div className="club-crop" style={crop ? { left: -crop[0] * zoom, top: -crop[1] * zoom } : undefined}>
        <div className={`club${hot?.can ? ' hot' : ''}`} ref={clubNode} style={{ zoom, width: CLUB.w, height: CLUB.h }} title={hot?.say || undefined} onClick={clickRoom} onMouseMove={pointAt} onMouseLeave={() => setHot(null)}>
          {fit && (
            <>
              {/* its picture and the pieces in front of people, in the season's set for an outdoor scene (client/src/season.tsx) */}
              <SceneArt fit={fit} piece={piece} />
              <RoomLight lights={fit.lights} />
              {fit.game.Room && <fit.game.Room layout={fit} mini={mini} seated={seated} />}
              {/* the holidays' decorations in this fit-out, if it has any (client/src/holidays/rooms.ts) */}
              <HolidayDecor room={fit.id} />
            </>
          )}
          {!fit && (<>
          <img className="club-base" src="/clubhouse/base.png" alt="" draggable={false} />
          {DOORS.map((f) => <OutDoor key={f.id} fit={f} />)}
          {CLUB.windows.map((r, k) => <Outside key={k} at={r} index={k} count={CLUB.windows.length} />)}
          <WallClock />
          <Disco mini={mini} />{/* the light switch left of the clock, and the disco lights (client/src/disco.tsx) */}
          <Vacuum mini={mini} />{/* the robot vacuum and its dock (client/src/vacuum.tsx) */}
          <WallBoard />
          <WallMirror />
          <SudokuTable mini={mini} />{/* the sudoku book on the side table by the toilet (Sudoku.tsx) */}
          {CLUB.pcs.map((pc, k) => {
            if (inBed.has(k)) return null;            // (a bed just now: its desk, screens and chair are put away)
            const [owner, doing] = atPc(k);
            return <Rig key={k} pc={pc} owner={owner} doing={doing} rigRef={(el) => { rigs.current[k] = el; }} />;
          })}
          {/* a drink put down on a desk by whoever sits there: its front-left corner (the desk's left end is the seat's x
              less 25, its top 38 above the seat; the picture's box stands on the desk 19 dots down, the same 10-by-14 box
              as in the hand) */}
          {CLUB.pcs.map((pc, k) => (
            <i key={`cup${k}`} className="desk-drink" aria-hidden ref={(el) => { deskCups.current[k] = el; if (!el) deskShown.current[k] = ''; }}
              style={{ left: pc.x - 25, top: pc.y - 33, zIndex: pc.y - 1 }} />
          ))}
          {/* the photos on the wall: today's, in each frame the admin's photos reach, over the painted ones and cut to the
              frame's shape (object-fit: cover). The desks in front are drawn over them; `data-clip` is the part that
              shows above them (scanlines.ts leaves its lines off that) */}
          {FRAMES.map((f) => wall?.[f.name] && <img key={`${f.name}:${wall[f.name]}`} className="club-photo" src={wall[f.name]} alt="" draggable={false} data-frame={f.name} data-w={f.at[2]}
            data-clip={`0,0 ${f.at[2]},0 ${f.at[2]},${f.shows} 0,${f.shows}`} style={box(f.at)} onError={(e) => { e.currentTarget.style.display = 'none'; }} />)}
          <div className={`club-roll${screenDown ? ' down' : ''}`} style={{ left: CLUB.screen[0] - 2, top: CLUB.screen[1] - 2, width: CLUB.screen[2] + 4, '--h': `${CLUB.screen[3] + 5}px` } as CSSProperties}><i /></div>
          {/* the speakers thump while the screen is down: a copy of each, from the room's own picture, swelling over the still one */}
          {CLUB.speakers.map((r, n) => <i key={`spk${n}`} className={`club-speaker${screenDown ? ' on' : ''}`} style={{ ...box(r), backgroundPosition: `${-r[0]}px ${-r[1]}px`, backgroundSize: `${CLUB.w}px ${CLUB.h}px` }} />)}
          <div className={`club-screen n${playerUp ? 1 : onScreen.length}`} style={box(CLUB.screen)} role={screenDown ? 'button' : undefined}
            title={onScreen.length ? 'Watch' : playerUp ? `${bigNames} ${bigWatchers.length > 1 ? 'are' : 'is'} watching "${playerNow!.title}" in the Player${voiceChannel != null ? ': click to watch it too' : ''}` : 'Nothing on the projector'}
            onClick={(e) => {
              if (screenDown) e.stopPropagation();
              if (playerUp) { if (voiceChannel != null) useStore.setState({ view: { kind: 'theatre' } }); } else void openScreen();
            }}>
            {playerUp && (
              <span className="feed">
                {thumbOf(playerNow!.videoId) ? <img src={thumbOf(playerNow!.videoId)!} alt="" /> : <i className="static held" />}
                <small>{bigNames} watching the Player: {playerNow!.title}</small>
              </span>
            )}
            {onScreen.map((u) => {
              // Somebody sharing a game (games.ts): a screen for its kind, in the room's own dots, for as
              // long as the game is in front on their PC. A click still opens the real thing.
              const game = sharedGame(presence[u.id]);
              return (
                <span key={u.id} className={`feed${game ? ' game' : ''}`}>
                  {/* Otherwise never the moving picture: a still that changes once a minute. While I have the screens open large, not even that. */}
                  {game ? <img src={gameShot(game)} alt="" draggable={false} />
                    : !watchingScreens && previews[u.id] ? <img src={previews[u.id]} alt="" /> : <i className={`static${watchingScreens ? ' held' : ''}`} />}
                  <small>{u.name}</small>
                </span>
              );
            })}
          </div>
          {/* a desk whose owner is sleeping is a bed: one picture where the desk, its screens and its chair were (none of those is drawn then) */}
          {CLUB.pcs.map((pc, k) => inBed.has(k) && <i key={`bed${k}`} className="club-bed" style={{ ...box(pc.bed.at), backgroundPosition: `${-k * pc.bed.at[2]}px 0`, backgroundSize: `${CLUB.pcs.length * pc.bed.at[2]}px ${pc.bed.at[3]}px` }} />)}
          {CLUB.over.map((o, k) => o.z > 1 && <i key={k} className="club-over" style={piece(o)} />)}
          {/* The light. The room is shown as it is drawn, day and night; every lamp lays its own glow over that
              (RoomLight: CLUB.lights, from the lamps in scripts/make-clubhouse.py); the neon sign is its own picture, so it can glow; and while something is
              on the projector the theatre goes dark, all but the screen (the hole in it) and the light that spills from it. */}
          <BirthdayNeon at={CLUB.neon.at} />
          <RoomLight />
          {(() => {
            const [dx, dy, dw, dh] = CLUB.theatreDark, [sx, sy, sw, sh] = CLUB.screen;
            // (the hole is the screen; and the patch itself is cut off at the inside of the room's walls)
            const hole = (ox: number, oy: number, w: number, h: number) => {
              const x0 = Math.max(0, INSIDE[0] - ox), y0 = Math.max(0, INSIDE[1] - oy), x1 = Math.min(w, INSIDE[0] + INSIDE[2] - ox), y1 = Math.min(h, INSIDE[1] + INSIDE[3] - oy);
              return `path(evenodd, "M${x0} ${y0}H${x1}V${y1}H${x0}Z M${sx - 2 - ox} ${sy - 2 - oy}h${sw + 4}v${sh + 5}h${-(sw + 4)}Z")`;
            };
            const spill = [sx - 34, sy - 6, sw + 68, sh + 96];
            return (
              <>
                <i className={`club-cinema${screenDown ? ' on' : ''}`} style={{ ...box([dx, dy, dw, dh]), clipPath: hole(dx, dy, dw, dh) }} />
                <i className={`club-cinema-glow${screenDown ? ' on' : ''}`} style={{ ...box(spill), clipPath: hole(spill[0], spill[1], spill[2], spill[3]) }} />
              </>
            );
          })()}
          <Seasonal people={people} seats={seats} mini={mini} />
          {/* the boombox is the Player: a click puts on the lo-fi radio, or opens its menu with something on (Music.tsx) */}
          <div className={`boombox${musicOn ? ' on' : ''}`} title={mini ? undefined : radioSays('The boombox')} style={{ left: CLUB.boombox.x, top: CLUB.boombox.y, zIndex: CLUB.boombox.y + 16, ...(mini ? {} : { pointerEvents: 'auto', cursor: 'pointer' }) }}
            onClick={mini ? undefined : (e) => { e.stopPropagation(); clickRadio(CLUB.boombox.x + 22, CLUB.boombox.y - 10, 'The boombox'); }}>
            {CLUB.boombox.speakers.map(([x, y], n) => <i key={n} className="cone" style={{ left: x - CLUB.boombox.x - 3, top: y - CLUB.boombox.y - 3 }} />)}
            <span className="n1"><Icon name="note" size={8} /></span><span className="n2"><Icon name="note" size={8} /></span>
          </div>
          </>)}
          {!fit?.outdoors && <YardFront />}
          {people.map((u) => {
            const p = presence[u.id];
            const asleep = !p || p.state === 'offline';
            const bubble = !asleep && p.state === 'gaming' && (seats.get(u.id) ?? 99) >= CLUB.pcs.length ? p.label : '';   // (somebody with no desk: the game they are playing is said over their head)
            const talking = !!p?.voice && p.voice.channelId === voiceChannel && !!speaking[u.id] && !(u.id === me?.id && micMuted);
            return (
              <div key={u.id} className={`actor${talking ? ' speaking' : ''}`} title={`${u.name} — ${presenceText(p)}`}
                style={(() => { const mk = marksOf(u), d = mk.drink; return { '--hx': `${mk.hand[0]}px`, '--hy': `${mk.hand[1]}px`, '--fy': `${mk.faceY}px`, '--skin': mk.skin,
                  '--cup-x': `${d.hold[0]}px`, '--cup-y': `${d.hold[1]}px`, '--sip-x': `${d.sip[0]}px`, '--sip-y': `${d.sip[1]}px`, '--sit-dy': `${d.sit}px` } as CSSProperties; })()}
                onClick={mini ? undefined : (e) => { e.stopPropagation(); const a = actors.current.get(u.id); if (a && a.goal.fx !== 'gone') setMenu(menu?.id === u.id ? null : { id: u.id, x: a.x, y: a.y }); }}
                ref={(el) => { if (el) nodes.current.set(u.id, el); else nodes.current.delete(u.id); }}>
                <i className="sprite" style={{ '--k': 1, '--up': SPRITE_UP, '--rows': SPRITE_ROW_COUNT, backgroundImage: `url(${sheetOf(u, today)})`, '--nude': !asleep && p.place === 'showering' ? `url(${nudeSheetOf(u)})` : undefined } as CSSProperties} />
                {/* (--nude: the sheet they are drawn from in the shower. Asking for it is what draws it, so it is only there while they are showering) */}
                {/* only the body takes clicks, not the whole square it is drawn in, so the seat or the floor beside somebody can still be clicked */}
                <span className="hit" />
                {/* no name over anybody's head any more (2026-11-16): everybody here knows everybody, and the voice chat lists
                    names anyway. What is left is whether they are muted or deafened, and their status (back 2026-11-19, smaller). */}
                <b className="tag" style={{ color: personColor(u) }}>{!asleep && p?.voice?.deafened ? <em className="quiet"><Icon name="micoff" size={6} /><Icon name="phonesoff" size={6} /></em> : !asleep && p?.voice?.muted ? <em className="quiet"><Icon name="micoff" size={6} /></em> : null}{u.status && <i>{u.status}</i>}</b>
                {(said[u.id] || bubble) && <span className={`say${said[u.id] ? ' chat' : ''}`} style={u.status ? { bottom: 60 } : undefined}>{said[u.id]?.text ?? bubble}</span>}
                <span className="fx" aria-hidden />
                <i className="drink" aria-hidden />
                {/* a wad of paper for the bin, in my other hand: drag it back and let go to throw it */}
                {holding && !mini && u.id === me?.id && <i className="wad" title="Drag back, and let go to throw" onPointerDown={startAim} onClick={(e) => e.stopPropagation()} />}
              </div>
            );
          })}
          {/* the dotted line while a throw is aimed: five dots, each fainter than the last, over the first third of the
              throw and no more (startAim moves them); and the band back to the hand */}
          <div className="club-aim" ref={aimNode}><b />{Array.from({ length: 5 }, (_, k) => <i key={k} />)}</div>
          {/* the football: drag it back and let go to kick it (the room moves it: see the frame loop) */}
          {!fit && <div className="club-ball" ref={ballNode} title={mini ? undefined : 'Drag the ball back, and let go to kick it'}
            onPointerDown={mini ? undefined : startKick} onClick={(e) => e.stopPropagation()} />}
          {!fit && petDefs.map((d) => (
            <div key={d.id} className={`pet ${d.kind}`} data-pet={d.id} title={d.name}
              onClick={mini ? undefined : (e) => { e.stopPropagation(); const p = pets.current.get(d.id); if (p && p.pose !== 'gone') setMenu(menu?.id === `pet:${d.id}` ? null : { id: `pet:${d.id}`, x: p.x - 6, y: p.y + 16 }); }}
              ref={(el) => { if (el) petNodes.current.set(d.id, el); else petNodes.current.delete(d.id); }}>
              <i className="pet-sprite" style={{ backgroundImage: `url(${petSheet(users[d.id].pet!)})` }} />
            </div>
          ))}
          {stairsMenu && !mini && (
            <div className="act-menu stairs-menu" style={{ left: Math.max(4, Math.min(CLUB.w - 110, stairsMenu.x)), top: Math.max(4, Math.min(CLUB.h - 30 - FIT_LIST.length * 11, stairsMenu.y)), zIndex: 4000 }} onClick={(e) => e.stopPropagation()}>
              <b>{fit ? 'Where to?' : 'Downstairs: which basement?'}</b>
              {fit && <button onClick={() => takeStairs('')}>Back upstairs{onFloor('') ? ` (${onFloor('')})` : ''}</button>}
              {FIT_LIST.filter((f) => f.id !== view).map((f) => (
                <button key={f.id} title={f.blurb} onClick={() => takeStairs(f.id)}>{f.title}{onFloor(f.id) ? ` (${onFloor(f.id)})` : ''}</button>
              ))}
            </div>
          )}
          {deskMenu && !mini && (
            <div className="act-menu" style={{ left: Math.max(4, Math.min(CLUB.w - 70, deskMenu.x - 30)), top: Math.max(4, deskMenu.y), zIndex: 4000 }} onClick={(e) => e.stopPropagation()}>
              <b>At your desk</b>
              {([['gaming', 'Gaming'], ['working', 'Working'], ['prompting', 'Prompting'], ['vcall', 'Video call'], ['sleeping', 'Sleeping']] as [Place, string][]).map(([place, label]) => (
                <button key={place} onClick={() => { send({ t: 'place', place: myPlace === place ? '' : place }); setDeskMenu(null); }}>{myPlace === place ? `Stop ${label.toLowerCase()}` : label}</button>
              ))}
            </div>
          )}
          {!mini && <RadioMenu floor={view} w={CLUB.w} h={CLUB.h} />}
          {drinkMenu && !mini && (
            <div ref={drinkMenuNode} className="act-menu" style={{ left: Math.max(4, Math.min(CLUB.w - 70, drinkMenu.x + 2)), top: Math.max(4, Math.min(CLUB.h - 90, drinkMenu.y)), zIndex: 4000 }} onClick={(e) => e.stopPropagation()}>
              <b>{HELD[drinkMenu.from].title}</b>
              {HELD[drinkMenu.from].items.map(([kind, label]) => (
                <button key={kind} onClick={() => { send({ t: 'drink', kind }); setDrinkMenu(null); }}>{label}</button>
              ))}
              {me && presence[me.id]?.drink && <button onClick={() => { send({ t: 'drink', kind: '' }); setDrinkMenu(null); }}>Put it down</button>}
            </div>
          )}
          {menu && !mini && menu.id.startsWith('pet:') && (
            <div className="act-menu" style={{ left: Math.max(4, Math.min(CLUB.w - 70, menu.x + 14)), top: Math.max(4, Math.min(CLUB.h - 27, menu.y - 41)), zIndex: 4000 }} onClick={(e) => e.stopPropagation()}>
              <b>{petDefs.find((d) => `pet:${d.id}` === menu.id)?.name}</b>
              <button onClick={() => { send({ t: 'act', kind: 'pet', pet: menu.id.slice(4) }); setMenu(null); }}>Pet</button>
            </div>
          )}
          {menu && !mini && !menu.id.startsWith('pet:') && (() => {
            const mine = menu.id === me?.id, list = mine ? SOLO_ACTS : DUO_ACTS;
            const askFor = mine ? '' : askableGame(menu.id), asked = !!askFor && !!askedAt(menu.id);      // (client/src/askshare.ts)
            const tall = 12 + (list.length + (askFor ? 1 : 0)) * 11;
            return (
              <div className="act-menu" style={{ left: Math.max(4, Math.min(CLUB.w - 70, menu.x + 14)), top: Math.max(4, Math.min(CLUB.h - tall - 4, menu.y - 30 - tall / 2)), zIndex: 4000 }} onClick={(e) => e.stopPropagation()}>
                <b>{mine ? 'You' : users[menu.id]?.name}</b>
                {list.map(([kind, label]) => (
                  <button key={kind} onClick={() => { send({ t: 'act', kind, userId: mine ? undefined : menu.id }); setMenu(null); }}>{label}</button>
                ))}
                {askFor && <button disabled={asked} title={asked ? 'Asked in the last ten minutes' : `Ask to share ${askFor}`} onClick={() => { askToShare(menu.id); setMenu(null); }}>{asked ? 'Asked' : 'Ask to share'}</button>}
              </div>
            );
          })()}
        </div>
        </div>
        </div>
      </div>
      {fit?.game.Side && !mini && <fit.game.Side layout={fit} mini={mini} seated={seated} />}
      </div>
      <i className={`club-dark${move && move.phase !== 'in' ? ' on' : ''}`} aria-hidden />
      {photo && <div className="lightbox wall" onClick={() => setPhoto(null)}><img src={photo} alt="" onError={() => setPhoto(null)} /></div>}
    </section>
  );
});
