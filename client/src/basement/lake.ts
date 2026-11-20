// The lake's numbers, shared by the server (server/basement/lake.ts keeps the lines in the water, rolls what bites and
// keeps every catch) and the page (lake.tsx draws it): what can be caught, how big each kind runs, how it fights, how a
// weight is said, and where the water is (from the layout scripts/basement/lake.py wrote).
import { LAYOUT } from './lake.gen.ts';

export type Rarity = 'common' | 'uncommon' | 'rare' | 'legendary' | 'mythic' | 'junk';
/** One kind of catch. lb: the smallest and the biggest one there is, in pounds (none for junk); len: inches for a
 *  one-pound fish of the kind (length grows as the cube root of the weight); fight: how hard it pulls, 0 to 1; surge:
 *  whether it makes runs (a tire just comes in, heavy). base: how often it bites, before the hour, weather and water. */
export type Kind = { id: string; name: string; rarity: Rarity; base: number; lb?: [number, number]; len?: number; fight: number; surge: boolean; cell: number; say: string; diff: number; motion: Motion };
/** How it moves on the reel-in's track (client/src/basement/lake.tsx): mixed (wanders), dart (sudden jumps), smooth
 *  (glides, often), sinker (drifts down), floater (drifts up). diff: how hard, 0 to about 110 (how often it picks a new
 *  place to go, how far, and how fast it gets there). */
export type Motion = 'mixed' | 'dart' | 'smooth' | 'sinker' | 'floater';

// The order is the catch sheet's (scripts/basement/lake.py CATCH: one 40 x 24 cell each, in this order).
export const KINDS: Kind[] = [
  { id: 'bluegill', name: 'Bluegill', rarity: 'common', base: 26, lb: [0.2, 1.6], len: 10, fight: 0.3, surge: true, cell: 0, say: 'Small, round and furious about it.', diff: 25, motion: 'mixed' },
  { id: 'perch', name: 'Yellow Perch', rarity: 'common', base: 14, lb: [0.2, 2.2], len: 12.5, fight: 0.3, surge: true, cell: 1, say: 'Stripes like a bumblebee that took up swimming.', diff: 35, motion: 'dart' },
  { id: 'crappie', name: 'Crappie', rarity: 'common', base: 16, lb: [0.3, 3], len: 12, fight: 0.35, surge: true, cell: 2, say: 'Paper-thin mouth, big opinions.', diff: 30, motion: 'smooth' },
  { id: 'bass', name: 'Largemouth Bass', rarity: 'uncommon', base: 11, lb: [0.8, 11], len: 12.6, fight: 0.8, surge: true, cell: 3, say: 'Jumped twice and shook its head at you.', diff: 50, motion: 'mixed' },
  { id: 'catfish', name: 'Channel Catfish', rarity: 'uncommon', base: 6, lb: [1.5, 32], len: 13, fight: 0.7, surge: true, cell: 4, say: 'Whiskers. Attitude. Smells like the bottom.', diff: 75, motion: 'mixed' },
  { id: 'trout', name: 'Rainbow Trout', rarity: 'uncommon', base: 6, lb: [0.5, 9], len: 13.9, fight: 0.75, surge: true, cell: 5, say: 'All the colours, none of the patience.', diff: 45, motion: 'mixed' },
  { id: 'muskie', name: 'Muskie', rarity: 'rare', base: 1.2, lb: [8, 48], len: 16.6, fight: 1, surge: true, cell: 6, say: 'The fish of ten thousand casts. This was one of them.', diff: 85, motion: 'dart' },
  { id: 'golden', name: 'Golden Fish', rarity: 'legendary', base: 0.18, lb: [2, 14], len: 12.1, fight: 0.6, surge: true, cell: 7, say: 'It is actually golden. Nobody will believe you.', diff: 100, motion: 'mixed' },
  { id: 'boot', name: 'Old Boot', rarity: 'junk', base: 3.4, fight: 0.15, surge: false, cell: 8, say: 'Size eleven, left foot. Somebody walked home lopsided.', diff: 12, motion: 'sinker' },
  { id: 'tire', name: 'Tire', rarity: 'junk', base: 1.6, fight: 0.5, surge: false, cell: 9, say: 'A whole tire. That counts as a workout.', diff: 18, motion: 'sinker' },
  { id: 'duck', name: 'Rubber Duck', rarity: 'junk', base: 1.9, fight: 0.05, surge: false, cell: 10, say: 'Still squeaks. Still smiling. Unbothered.', diff: 5, motion: 'floater' },
  { id: 'bottle', name: 'Message in a Bottle', rarity: 'junk', base: 1.8, fight: 0.05, surge: false, cell: 11, say: '', diff: 8, motion: 'floater' },
  { id: 'controller', name: 'Game Controller', rarity: 'junk', base: 1.2, fight: 0.1, surge: false, cell: 12, say: 'Somebody rage-quit. Into a lake.', diff: 14, motion: 'sinker' },
  { id: 'phone', name: 'Old Phone', rarity: 'junk', base: 1.0, fight: 0.05, surge: false, cell: 13, say: 'Two bars and 60% battery. Snake still works.', diff: 10, motion: 'sinker' },
  // (more, added later: the sheet's cells 14 on)
  { id: 'walleye', name: 'Walleye', rarity: 'uncommon', base: 7, lb: [0.8, 10], len: 14.5, fight: 0.6, surge: true, cell: 14, say: 'Eyes like marbles. It saw you first.', diff: 45, motion: 'smooth' },
  { id: 'carp', name: 'Common Carp', rarity: 'common', base: 9, lb: [1, 30], len: 11.5, fight: 0.7, surge: true, cell: 15, say: 'Big, bronze and deeply unimpressed.', diff: 15, motion: 'mixed' },
  { id: 'gar', name: 'Longnose Gar', rarity: 'rare', base: 1.6, lb: [2, 20], len: 17, fight: 0.8, surge: true, cell: 16, say: 'All nose. The nose is mostly teeth.', diff: 70, motion: 'dart' },
  { id: 'sturgeon', name: 'Lake Sturgeon', rarity: 'rare', base: 0.9, lb: [10, 90], len: 14, fight: 1, surge: true, cell: 17, say: 'Older than the dock. Possibly older than the lake.', diff: 78, motion: 'sinker' },
  { id: 'eel', name: 'American Eel', rarity: 'rare', base: 1.4, lb: [0.5, 7], len: 24, fight: 0.7, surge: true, cell: 18, say: 'It is a fish. It insists.', diff: 70, motion: 'smooth' },
  { id: 'ghost', name: 'Phantom Glassfish', rarity: 'mythic', base: 0.05, lb: [1, 8], len: 12, fight: 0.6, surge: true, cell: 19, say: 'You can see right through it. It can see right through you.', diff: 105, motion: 'floater' },
  { id: 'serpent', name: 'Lake Serpent', rarity: 'mythic', base: 0.025, lb: [60, 400], len: 30, fight: 1, surge: true, cell: 20, say: 'It was real. Nobody will believe you. You barely believe you.', diff: 120, motion: 'dart' },
  { id: 'chest', name: 'Treasure Chest', rarity: 'rare', base: 0.35, fight: 0.4, surge: false, cell: 21, say: 'Gold coins, a compass that points at the snack bar, and wet sand.', diff: 40, motion: 'sinker' },
  { id: 'cone', name: 'Traffic Cone', rarity: 'junk', base: 1.1, fight: 0.2, surge: false, cell: 22, say: 'Somebody really did not want you parking here.', diff: 12, motion: 'sinker' },
  { id: 'can', name: 'Soda Can', rarity: 'junk', base: 2.2, fight: 0.05, surge: false, cell: 23, say: 'Still fizzes. Do not drink it.', diff: 6, motion: 'sinker' },
  { id: 'shades', name: 'Sunglasses', rarity: 'junk', base: 1.0, fight: 0.05, surge: false, cell: 24, say: 'Too cool for the lake. Now too cool for you.', diff: 8, motion: 'floater' },
  { id: 'skeleton', name: 'Fish Skeleton', rarity: 'junk', base: 0.9, fight: 0.1, surge: false, cell: 25, say: 'This one got away. A long time ago.', diff: 10, motion: 'mixed' },
  // (and more: the sheet's cells 26 on)
  { id: 'pumpkinseed', name: 'Pumpkinseed', rarity: 'common', base: 12, lb: [0.1, 1.2], len: 9.5, fight: 0.3, surge: true, cell: 26, say: 'Dressed for a party nobody told it about.', diff: 25, motion: 'mixed' },
  { id: 'smallmouth', name: 'Smallmouth Bass', rarity: 'uncommon', base: 7, lb: [0.6, 8], len: 12.5, fight: 0.8, surge: true, cell: 27, say: 'Pound for pound, the angriest thing in the lake.', diff: 40, motion: 'mixed' },
  { id: 'bullhead', name: 'Brown Bullhead', rarity: 'common', base: 9, lb: [0.3, 4], len: 11, fight: 0.45, surge: true, cell: 28, say: 'A catfish that never hit its growth spurt.', diff: 46, motion: 'smooth' },
  { id: 'bowfin', name: 'Bowfin', rarity: 'rare', base: 1.4, lb: [1.5, 15], len: 15, fight: 0.9, surge: true, cell: 29, say: 'Older than the dinosaurs. Acts like it, too.', diff: 65, motion: 'dart' },
  { id: 'goldfish', name: 'Lost Goldfish', rarity: 'common', base: 3, lb: [0.05, 1], len: 9, fight: 0.1, surge: true, cell: 30, say: 'Somebody flushed Mr. Bubbles. He did fine.', diff: 10, motion: 'floater' },
  { id: 'koi', name: 'Escaped Koi', rarity: 'uncommon', base: 2.5, lb: [1, 20], len: 12, fight: 0.5, surge: true, cell: 31, say: 'It used to live in a hotel lobby. It misses the fountain.', diff: 35, motion: 'smooth' },
  { id: 'crayfish', name: 'Crayfish', rarity: 'common', base: 7, lb: [0.05, 0.3], len: 9, fight: 0.15, surge: true, cell: 32, say: 'Pinched you twice on the way up. Fair.', diff: 20, motion: 'sinker' },
  { id: 'paddlefish', name: 'Paddlefish', rarity: 'rare', base: 0.8, lb: [10, 120], len: 15, fight: 1, surge: true, cell: 33, say: 'Nobody knows what the paddle is for. Neither does it.', diff: 80, motion: 'sinker' },
  { id: 'coelacanth', name: 'Coelacanth', rarity: 'legendary', base: 0.12, lb: [40, 200], len: 14, fight: 1, surge: true, cell: 34, say: 'Extinct, according to everyone except this fish.', diff: 95, motion: 'mixed' },
  { id: 'clockwork', name: 'Clockwork Carp', rarity: 'mythic', base: 0.06, lb: [2, 12], len: 11, fight: 0.7, surge: true, cell: 35, say: 'Tick, tick, tick. Somebody wound it up and let it go.', diff: 110, motion: 'dart' },
  { id: 'golfball', name: 'Golf Ball', rarity: 'junk', base: 1.6, fight: 0.05, surge: false, cell: 36, say: 'From the mini golf. That was a bad hole.', diff: 5, motion: 'sinker' },
  { id: 'eightball', name: 'The 8-Ball', rarity: 'junk', base: 0.8, fight: 0.05, surge: false, cell: 37, say: 'So that is where it went. Signs point to yes.', diff: 6, motion: 'sinker' },
  { id: 'pin', name: 'Bowling Pin', rarity: 'junk', base: 0.9, fight: 0.1, surge: false, cell: 38, say: 'Still standing. Well, floating.', diff: 8, motion: 'floater' },
  { id: 'gnome', name: 'Garden Gnome', rarity: 'junk', base: 0.8, fight: 0.15, surge: false, cell: 39, say: 'It has seen things down there. It will not say what.', diff: 12, motion: 'sinker' },
  { id: 'sailboat', name: 'Toy Sailboat', rarity: 'junk', base: 1.0, fight: 0.05, surge: false, cell: 40, say: 'Lost at sea. Well, lake.', diff: 6, motion: 'floater' },
  { id: 'pizza', name: 'Pizza Box', rarity: 'junk', base: 1.4, fight: 0.05, surge: false, cell: 41, say: 'One slice left. It is not for you.', diff: 5, motion: 'floater' },
  { id: 'flipflop', name: 'Flip-Flop', rarity: 'junk', base: 1.6, fight: 0.05, surge: false, cell: 42, say: 'Left foot. The right one is out there somewhere.', diff: 5, motion: 'floater' },
  { id: 'crown', name: 'Lost Crown', rarity: 'rare', base: 0.2, fight: 0.3, surge: false, cell: 43, say: 'Heavy is the head. Wet is the crown.', diff: 35, motion: 'sinker' },
  { id: 'ring', name: 'Diamond Ring', rarity: 'rare', base: 0.25, fight: 0.05, surge: false, cell: 44, say: 'Somebody said no. Or yes, and dropped it.', diff: 30, motion: 'sinker' },
];
export const KIND: Record<string, Kind> = Object.fromEntries(KINDS.map((k) => [k.id, k]));
/** The fish (anything with a weight), and everything else that comes up (junk, and the treasure chest). */
export const FISH = KINDS.filter((k) => !!k.lb);
export const JUNK = KINDS.filter((k) => !k.lb);
/** The catch sheet's cells (catch.png): CELL_W x CELL_H each, in KINDS order, in one row. */
export const CELL_W = 40, CELL_H = 24;
export const RARITY_COLOR: Record<Rarity, string> = { common: '#c8d0b8', uncommon: '#7ad070', rare: '#6ab4ff', legendary: '#ffd04a', mythic: '#e07aff', junk: '#b8a890' };
export const RARITY_WORD: Record<Rarity, string> = { common: 'Common', uncommon: 'Uncommon', rare: 'Rare', legendary: 'Legendary', mythic: 'Mythical', junk: 'Junk' };

/** What a bottle can say. */
export const NOTES = [
  'Day 41. The ducks have accepted me as one of their own.',
  'If found, please return to the lake.',
  'The muskie is real. Nobody believes me.',
  'Whoever keeps taking my chair at the campfire: I know.',
  'Grocery list: worms, more worms, a bigger net.',
  'This bottle has been on a journey. You have not.',
  'Please stop throwing tires in here. Signed, the fish.',
  'You are the 1,000th person to find this bottle. There is no prize.',
  'Dear diary, today somebody threw me in a lake.',
  'The golden fish only bites for people who let the others go.',
  'Note to self: bring a bigger boat.',
  'If you can read this, your bobber is still in the water.',
  'Roses are red, the lake is wet. You caught a bottle. Best catch yet.',
  'I owe the bait shop $4. Tell them I am sorry.',
  'Help, I am trapped in a lake. It is actually pretty nice.',
  'The catfish come out at night. So do I.',
];

// ── the water ──
const T = LAYOUT.things as Record<string, any>;
/** The water's runs, row by row: WATER[y] is a list of [x0, x1] (both in), the dock and the boat left out. */
const WATER: number[][][] = T.water;
export const inWater = (x: number, y: number) => {
  const r = WATER[Math.round(y)];
  if (!r) return false;
  const xi = Math.round(x);
  return r.some(([a, b]) => xi >= a && xi <= b);
};
/** The dock's spots to fish from: seat numbers, each with the way it faces (-1 left, 1 right). */
export const SPOTS: number[] = T.spots;
export const spotFace = (n: number) => (LAYOUT.seats[n]?.flip ? 1 : -1);
/** Where the line goes from the end of the rod of somebody at spot n (the tip, roughly, for the server's casts). */
export const tipOf = (n: number) => { const q = LAYOUT.seats[n]; const f = spotFace(n); return { x: q.x + f * 30, y: q.y - 34 }; };
/** The weed beds and lily pads ([x, y, r]): bass and bluegill hang about them. The deep middle: [cx, cy, rx, ry]. */
export const WEEDS: number[][] = T.weeds;
export const DEEP: number[] = T.deep;
export const zoneAt = (x: number, y: number): 'weeds' | 'deep' | 'open' | 'shallow' => {
  if (WEEDS.some(([wx, wy, r]) => (x - wx) ** 2 + (y - wy) ** 2 < r * r)) return 'weeds';
  const [cx, cy, rx, ry] = DEEP;
  if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 < 1) return 'deep';
  // near a shore: water within a little way of land, below or above
  for (const d of [10, 18]) if (!inWater(x, y + d) || !inWater(x, y - d)) return 'shallow';
  return 'open';
};
/** The longest cast, in the scene's dots, at full strength. */
export const MAX_CAST = 170;
/** A cast is perfect when let go with the meter this near the top (0 to 1): it lands right where it was aimed, and rarer
 *  things bite. */
export const PERFECT = 0.95;

// ── lines in the water, as the server tells everybody ──
export type Phase = 'cast' | 'wait' | 'bite' | 'reel';
export type Line = {
  spot: number; phase: Phase;
  /** where the bobber is (lands, floats), in the scene's dots */
  x: number; y: number;
  /** when the cast began, and how long it is in the air (ms) */
  t0: number; ms: number;
  /** when this phase began (server time) */
  at: number;
  /** while reeling: how far in it has come (0 to 1) and the tension on the line (0 to 1+); and whether it is junk (a
   *  dead weight: nothing jumps) */
  p?: number; tn?: number; dead?: boolean;
  /** a perfect cast (rarer bites) */
  perfect?: boolean;
};
/** A catch, as kept for good (server/basement/lake.ts, the catches table). w: ounces (0: junk), len: inches. */
export type Catch = { id: number; uid: string; kind: string; w: number; len: number; at: number; kept: number | null; note?: string };
/** What shows over somebody for a moment: what they landed (and whether it went back), or that it got away. */
export type Pop = { kind?: string; w?: number; len?: number; at: number; what: 'catch' | 'away' | 'snap' | 'missed' | 'released' | 'kept'; best?: boolean };
export type Record_ = { uid: string; w: number; len: number; at: number };
export type Lake = {
  lines: Record<string, Line>;
  pops: Record<string, Pop>;
  /** the biggest of each fish (by weight), and for junk, how many have come up and who found the first */
  records: Record<string, Record_>;
  junk: Record<string, { n: number; uid: string; at: number }>;
  /** each person's best of each kind (weight; junk: how many) */
  best: Record<string, Record<string, { w: number; len: number; n: number; at: number }>>;
  totals: Record<string, { n: number; kept: number; fish: number }>;
  recent: Catch[];
  now: number;
};

/** A weight in ounces said the way a fisherman says it: "4 lb 6 oz", "11 oz". */
export const weighs = (oz: number) => (oz < 16 ? `${oz} oz` : `${Math.floor(oz / 16)} lb${oz % 16 ? ` ${oz % 16} oz` : ''}`);
export const inches = (len: number) => `${len.toFixed(1)} in`;

/** What being at the lake reads as in somebody's status: "Fishing" on the dock at a spot, "At the lake" anywhere else
 *  out there (for presenceText in components/ui.tsx, beside the campsite's and the backyard's). */
const SPOT_SET = new Set<number>(SPOTS);
export function lakeText(p: { floor?: string; place?: string; at?: { seat?: string } } | undefined): string | null {
  if (!p || p.floor !== 'lake') return null;
  const seat = /^b(\d+)$/.exec(p.at?.seat ?? '');
  return p.place === 'here' && seat && SPOT_SET.has(Number(seat[1])) ? 'Fishing' : 'At the lake';
}
