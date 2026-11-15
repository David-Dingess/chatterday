// Everybody's pictures. Nobody's character, pet or desk comes from the server as a picture: the server passes on
// what each person picked (their `look`, `pet` and `desk`), and this app draws the sprite sheets itself with the
// code in ./draw, once for each different look, and keeps them as images in memory.
import { drawNudeSheet, drawSheet, faceY, marksOf as marksOfLook, SPRITE_ROWS, SPRITE_UP } from './draw/avatar.ts';
import type { Marks } from './draw/avatar.ts';
import { drawDesk, ledOf } from './draw/desk.ts';
import type { DeskArt } from './draw/desk.ts';
import type { Picture } from './draw/kit.ts';
import { drawPetSheet } from './draw/pet.ts';
import { cleanDesk, DEFAULT_DESK } from '../../shared/desk.ts';
import { cleanLook, randomLook } from '../../shared/look.ts';
import { cleanPet } from '../../shared/pet.ts';
import type { Desk, Look, PetLook, User } from './types';

/** SPRITE_UP: rows of headroom above every 48-dot frame on a sheet (a party hat, a jump): a cell is 48 wide and 48 + this tall. */
export { SPRITE_ROWS, SPRITE_UP };
export type { Marks };
export type SpriteRow = (typeof SPRITE_ROWS)[number];
export const rowIndex = (row: SpriteRow) => SPRITE_ROWS.indexOf(row);
export const SPRITE_ROW_COUNT = SPRITE_ROWS.length;

/** The art is drawn at its own size and published four times bigger, so it stays even at any zoom, like the room. */
const BIG = 4;
/** A drawn picture as an image address the page can show. */
function urlOf(pic: Picture, k = BIG): string {
  const small = document.createElement('canvas');
  small.width = pic.w; small.height = pic.h;
  small.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(pic.data), pic.w, pic.h), 0, 0);
  const big = document.createElement('canvas');
  big.width = pic.w * k; big.height = pic.h * k;
  const g = big.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  g.drawImage(small, 0, 0, big.width, big.height);
  const b64 = big.toDataURL('image/png').split(',')[1], bytes = atob(b64), buf = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) buf[i] = bytes.charCodeAt(i);
  return URL.createObjectURL(new Blob([buf], { type: 'image/png' }));
}

/** Pictures already drawn, by what they are of. The oldest are let go once there are a lot (trying things on in a builder makes many). */
const drawn = new Map<string, string[]>();
function once(key: string, make: () => string[]): string[] {
  const had = drawn.get(key);
  if (had) { drawn.delete(key); drawn.set(key, had); return had; }       // moved to the back of the queue: it is in use
  const urls = make();
  drawn.set(key, urls);
  if (drawn.size > 160) {
    const [oldest, gone] = drawn.entries().next().value!;
    drawn.delete(oldest);
    window.setTimeout(() => gone.forEach((u) => URL.revokeObjectURL(u)), 30_000);       // after anything still showing it has moved on
  }
  return urls;
}
/** One see-through dot: what is shown in place of a picture that could not be drawn. */
const BLANK = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
/** A picture that fails to draw must never take the whole page down with it: it is left blank, and the reason is noted once. */
const failed = new Set<string>();
function safely(key: string, n: number, make: () => string[]): string[] {
  if (failed.has(key)) return Array(n).fill(BLANK);
  try { return once(key, make); }
  catch (e) { failed.add(key); console.error('[draw] could not draw', key.slice(0, 60), e); return Array(n).fill(BLANK); }
}

const hash = (s: string) => { let h = 7; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; };
type Seen = Pick<User, 'id' | 'look' | 'color'> & { birthday?: string | null };

/** A person's colour: their name tag, their headset and blanket, the lights on the desk they sit at. */
export const personColor = (user: Pick<User, 'color'> | undefined) => (user && /^#[0-9a-f]{6}$/i.test(user.color) ? user.color : '#9aa0b0');

/** What somebody looks like: what they built, or, until they have, a look made up from their id. */
export const lookOf = (user: Pick<User, 'id' | 'look'>): Look => (user.look ? cleanLook(user.look) : randomLook(hash(user.id)));

/** Today as 'MM-DD' on the house's clock, for birthdays. `?date=12-25` in the address previews a day. */
export function houseDay(tz: string, now = new Date()): string {
  const forced = new URLSearchParams(location.search).get('date');
  if (forced && /^\d\d-\d\d$/.test(forced)) return forced;
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz || undefined, month: '2-digit', day: '2-digit' }).format(now); }
  catch { return new Intl.DateTimeFormat('en-CA', { month: '2-digit', day: '2-digit' }).format(now); }
}

/** The sheet somebody is drawn from. On their birthday (`today` is the house's date) they wear a party hat. */
export function sheetOf(user: Seen, today = ''): string {
  let look = lookOf(user);
  if (today && user.birthday === today) look = { ...look, hat: { kind: 'party', color: '#f2c230' } };
  const accent = personColor(user);
  return safely(`who|${accent}|${JSON.stringify(look)}`, 1, () => [urlOf(drawSheet(look, accent))])[0];
}
/** The sheet for a look that is still being tried on in a builder. */
export const sheetFor = (look: Look, accent: string) => safely(`who|${accent}|${JSON.stringify(look)}`, 1, () => [urlOf(drawSheet(look, accent))])[0];
/** The sheet somebody in the shower is drawn from: the same rows, with nothing on and the middle of them blocked out.
 *  It is only drawn when somebody first needs it. */
export function nudeSheetOf(user: Seen): string {
  const look = lookOf(user), accent = personColor(user);
  return safely(`nude|${accent}|${JSON.stringify(look)}`, 1, () => [urlOf(drawNudeSheet(look, accent))])[0];
}
/** The top of a 24px square round somebody's face in their first idle frame: their picture in lists is cut from there.
 *  It is counted from the top of the frame: on a sheet, the frame is SPRITE_UP rows down its cell. */
export const faceTop = (user: Pick<User, 'id' | 'look'>) => { try { return faceY(lookOf(user)); } catch { return 4; } };

/** Where things go on somebody, in dots from the top left of a frame (add SPRITE_UP to a y to count from the top of the
 *  cell): the top of their face, the hand hanging at their side, where a drink stands in their fist (held, sipping, and
 *  how much lower when sitting), and the colour of their skin. */
export function marksOf(user: Pick<User, 'id' | 'look'>): Marks {
  const key = user.look ?? user.id;                                          // (a look that changes arrives as a new object)
  let m = typeof key === 'string' ? marksById.get(key) : marksByLook.get(key);
  if (m) return m;
  try {
    const look = lookOf(user), shape = `${look.height}|${look.body}|${look.skin}`;     // all that the marks come from
    m = marksByShape.get(shape);
    if (!m) { m = marksOfLook(look); marksByShape.set(shape, m); if (marksByShape.size > 500) marksByShape.delete(marksByShape.keys().next().value!); }
  } catch { m = NO_MARKS; }
  if (typeof key === 'string') { marksById.set(key, m); if (marksById.size > 500) marksById.delete(marksById.keys().next().value!); }
  else marksByLook.set(key, m);
  return m;
}
const marksByLook = new WeakMap<object, Marks>(), marksById = new Map<string, Marks>(), marksByShape = new Map<string, Marks>();
/** For a look that could not be read: the marks of a medium person. */
const NO_MARKS: Marks = { faceY: 4, hand: [33, 34], drink: { hold: [28, 31], sip: [30, 27], sit: 1 }, skin: '#e8b48c' };

/** A pet's sheet: 24px frames, four across, seven rows (walk down, left, up, sit, eat, sleep, being petted). */
export function petSheet(pet: PetLook): string {
  const p = cleanPet(pet);
  return p ? safely(`pet|${JSON.stringify(p)}`, 1, () => [urlOf(drawPetSheet(p))])[0] : '';
}

export { ledOf };
export type DeskPics = { desk: string; chair: string; back: string; art: DeskArt };
/** A desk the way whoever sits at it has it (their lights, their thing on it): the desk itself, the chair's seat, and the chair's back (which goes in front of them). `accent` is their own colour. */
export function deskPics(desk: Desk | null | undefined, accent: string): DeskPics {
  const d = desk ? cleanDesk(desk) : DEFAULT_DESK;
  const key = `desk|${accent}|${JSON.stringify(d)}`;
  let art = arts.get(key);
  if (!art) { art = drawDesk(d, accent); arts.set(key, art); if (arts.size > 200) arts.delete(arts.keys().next().value!); }
  const [a, b, c] = once(key, () => [urlOf(art!.desk), urlOf(art!.chair), urlOf(art!.back)]);
  return { desk: a, chair: b, back: c, art };
}
const arts = new Map<string, DeskArt>();
