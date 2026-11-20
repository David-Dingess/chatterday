// The basement's fit-outs. Each is a layout written by scripts/make-basement.py (<id>.gen.ts, from
// scripts/basement/<id>.py), and, if it has a game, a module of its own beside it (<id>.tsx) whose exports are a FitGame.
// Both are found here by their file names: a new fit-out needs no change to this file, the room or the server's list.
//
// What a game module can export (all optional):
//   Room   drawn inside the room, over the floor and under nobody in particular: position children absolutely, in the room's
//          own dots (CLUB.w x CLUB.h, zoomed with it), with zIndex = the y of their foot so people pass in front and behind.
//          A click on anything of its own should stopPropagation(), or the room will take it as "walk here".
//   Side   a panel beside the room (the room shrinks to fit), for a game that needs more than the room: the DnD table's
//          maps, sheets and initiative. It renders its own <aside className="fit-side">, at whatever width it wants.
//   says   what pointing at one of its seats says, by seat number ('Take a shot', 'Throw darts'...).
// Talk to the server with send({ t: 'fit', id, ... }); listen with hooks.fit (every { t: 'fit', id } message), and read
// useStore((s) => s.fits[id]) for the state the server last sent (its hello(), then any message with a `state`).
import type { ComponentType } from 'react';
import { create } from 'zustand';
import type { SpriteRow } from '../sprites';

/** A floor asked for from outside the room (Play Games' Game Room tab): the room takes the stairs there. */
export const goFloor = create<{ to: string | null }>()(() => ({ to: null }));

/** game: whoever sits there is playing (the gaming pose, facing the way the seat does). only: a spot a game sends its
 *  players and watchers to (client/src/basement/spots.ts), never handed to somebody just about in the room. */
export type FitSeat = { x: number; y: number; ax: number; ay: number; pose: 'front' | 'back' | 'side' | 'stand'; flip: boolean; face?: string; game?: boolean; only?: boolean; hit: number[] };
export type FitLayout = {
  id: string; title: string; blurb: string; order: number; w: number; h: number; cell: number;
  seats: FitSeat[]; stands: { x: number; y: number; face: string }[]; things: Record<string, any>;
  /** furniture a click on means something, as upstairs: [what, x, y, width, height] ('fridge': the bar, a drink) */
  spots?: [string, number, number, number, number][];
  /** the part of the basement it shows, if not all of it: [x, y, width, height] (the room zooms to fit it) */
  view?: number[];
  /** the way back: the stairs (or, outside, the door into the house; `face` is the way one walks to it) */
  stairs: { rect: number[]; foot: { x: number; y: number }; face?: string };
  /** not a basement: the outdoors, through a door in the room upstairs (things.door), not on the stairs' menu */
  outdoors?: boolean;
  grid: string[]; lights: { x: number; y: number; rx: number; ry: number; color: string; a: number }[];
  blocks: number[][]; floor: number[]; atlas: number[]; over: { x: number; y: number; w: number; h: number; z: number; sx: number; sy: number }[];
};
/** seated: whether somebody is sat in each of the layout's seats just now (in it, not on their way). */
export type FitProps = { layout: FitLayout; mini: boolean; seated: boolean[] };
/** pose: how somebody sat in one of its seats (`seat`: the seat's key, b0, b1...) is drawn just now, if the game has a
 *  say in it (at the campfire: a stick held out to the fire, a marshmallow eaten); null leaves it to the room. Asked
 *  every frame, so it must be quick. */
export type FitPose = { row: SpriteRow; first: number; frames: number; ms: number; flip?: boolean };
/** body: where somebody is drawn just now, moved and cut off (asked every frame for everybody on the floor, so it must be
 *  quick): dy lowers them (up, if less than 0), and clip hides that many rows from the bottom of their 48-dot square (in
 *  the pool: only their head and shoulders above the water). `seat` is their goal's key; x, y where their feet are. */
export type FitBody = { dy?: number; clip?: number };
export type FitGame = { Room?: ComponentType<FitProps>; Side?: ComponentType<FitProps>; says?: (seat: number) => string | undefined; pose?: (uid: string, seat: string) => FitPose | null;
  body?: (uid: string, seat: string, x: number, y: number) => FitBody | null;
  /** steer: where somebody is just now when the fit-out moves them itself, not by walking them along the floor's paths
   *  (the mower, driven straight wherever it is pushed); null leaves them to the room. Asked every frame. */
  steer?: (uid: string) => { x: number; y: number } | null };
export type Fit = FitLayout & { game: FitGame };

const layouts = import.meta.glob<{ LAYOUT: FitLayout }>('./*.gen.ts', { eager: true });
const games = import.meta.glob<FitGame>('./*.tsx', { eager: true });

export const FITS: Record<string, Fit> = {};
for (const [file, mod] of Object.entries(layouts)) {
  const id = file.replace(/^\.\//, '').replace(/\.gen\.ts$/, '');
  FITS[id] = { ...mod.LAYOUT, game: games[`./${id}.tsx`] ?? {} };
}
/** In the order the stairs' menu lists them. */
export const FIT_LIST = Object.values(FITS).filter((f) => !f.outdoors).sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
/** The outdoors: each out of a door in the room upstairs (things.door: the campsite out of the east wall, the backyard
 *  out of the west). */
export const DOORS: Fit[] = Object.values(FITS).filter((f) => f.outdoors && f.things.door).sort((a, b) => a.order - b.order);
/** Where each person on my floor is drawn just now (their feet) and the frames they are in: kept by the room every frame,
 *  for a fit-out's own drawing to follow them (the mower in front of whoever pushes it, a cigarette's smoke). */
/** first, frames, ms: the frames they are stepping through (for what is laid over them to keep step); el: their element
 *  (its first child is the sprite, whose animation says which of those frames is showing). */
export const drawn = new Map<string, { x: number; y: number; row: string; flip: boolean; first?: number; frames?: number; ms?: number; el?: HTMLElement }>();
