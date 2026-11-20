// What can be taken off the smoking table on the backyard's patio (backyard.tsx; the server's half is
// server/basement/backyard.ts), how each is drawn, and where on somebody it goes in every pose. Kept apart from the page,
// with nothing of the browser in it, so scripts can draw the same things over the same frames to look at them
// (scripts/preview-smokes.ts).
//
// Each thing is a little picture, in the room's dots, drawn over the person (not into their frames):
//   a cigarette or a cigar is held at the chest, brought up to the mouth for a drag, and kept in the mouth on the move;
//   a corncob or a calabash pipe stays in the mouth, the hands free;
//   the bubble wand is held up at the chest, brought to the mouth to blow, and carried in the hand at the side;
//   the mini fan is held up to the face (and close up to it now and then), and carried at the side, still spinning.
// Smoke, breath, bubbles and the fan's breeze are the page's to draw: here is only where they come from (`ember`, the
// mouth, `blow`).

export const KINDS = ['cig', 'cigar', 'corncob', 'calabash', 'bubbles', 'fan'] as const;
export type Kind = (typeof KINDS)[number];
export const LABEL: Record<Kind, string> = { cig: 'A cigarette', cigar: 'A cigar', corncob: 'A corncob pipe', calabash: 'A calabash pipe', bubbles: 'Bubbles', fan: 'A mini fan' };
/** How it is held: in the hand, up to the mouth now and then; or in the mouth all along. */
export const IN_MOUTH = new Set<string>(['corncob', 'calabash']);
/** One round of it, and how long of that is the drag (or the blow, or the fan up close). */
export const CYCLE: Record<Kind, { p: number; drag: number }> = {
  cig: { p: 8000, drag: 1400 }, cigar: { p: 11000, drag: 1700 }, corncob: { p: 9000, drag: 1600 }, calabash: { p: 10000, drag: 1800 },
  bubbles: { p: 5200, drag: 1500 }, fan: { p: 9000, drag: 3200 },
};

const hashOf = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); };
/** Where somebody is in their round just now (each in their own time), in ms from the start of it. */
export const phase = (uid: string, kind: string, now: number) => (now + hashOf(uid + kind)) % (CYCLE[kind as Kind]?.p ?? 8000);
export const dragging = (uid: string, kind: string, now: number) => phase(uid, kind, now) < (CYCLE[kind as Kind]?.drag ?? 1400);

// ── the pictures ──
const PAL: Record<string, [string, number?]> = {
  w: ['#f6f3ec'], W: ['#d2cabd'], f: ['#e0a05a'], F: ['#b07034'], O: ['#ff7a2a'], o: ['#c8401c'], a: ['#9a958e'], A: ['#c9c4bc'],
  B: ['#7a4424'], b: ['#552a12'], h: ['#9c6034'], r: ['#d8b048'], R: ['#a8282c'],
  k: ['#f6e08e'], C: ['#e2c060'], c: ['#b08c34'], d: ['#86662a'], x: ['#2a1a10'], s: ['#c09050'], S: ['#7a5228'], K: ['#1c1a20'], Q: ['#3c3a44'],
  M: ['#f6f0de'], m: ['#cfc4a6'], G: ['#c87a2a'], g: ['#8a4a18'], H: ['#eaa458'],
  p: ['#f07ab0'], P: ['#b44a80'], u: ['#8ad8f0'], U: ['#c8f0ff', 0.35], i: ['#ffb8f0', 0.35],
  n: ['#7c8496'], N: ['#a8b0c0'], e: ['#f6f6fa'], y: ['#8ee0c0'], Y: ['#4fae8c'], v: ['#ffffff', 0.85], z: ['#d8f4ff', 0.3],
  '#': ['#1a1228'], ':': ['#1a1228', 0.4],
};
/** A picture: its rows (several frames of it, if it moves), the dot in it that goes on the spot it is put on, and
 *  whether it gets the house's dark outline (only the bigger things: a thin one would be all outline). */
export type Art = { frames: string[][]; anchor: [number, number]; outline?: boolean; ms?: number };
const A = (rows: string[], anchor: [number, number], outline = false): Art => ({ frames: [rows], anchor, outline });

// The cigarette: held up between the fingers of the fist at the chest, the filter end pinched in them (`~`: their own
// skin, wrapped over it), the lit end on top, tipped out, away from the body; in the mouth from the front (from the corner, drooping) and
// side on (out from the lips); the lit end glowing.
const CIG_HAND = A(['..O.', '..w:', '.w:.', '.w:.', '~F~.'], [1, 5]);       // (a faint shadow down its side: it shows on a white shirt)
const CIG_FRONT = A(['Fw..', '.ww.', '...O'], [0, 0]);
const CIG_SIDE = A(['Owwwwf'], [6, 0]);
// The cigar: thicker, darker, a band near the end in the mouth (or the fingers), ash on the lit end, held up and out the same.
const CIGAR_HAND = A(['..aa', '..OO', '.hB.', '.hB.', 'hb..', 'Rr..', '~b~.'], [1, 7]);
const CIGAR_FRONT = A(['hR..', 'BBh.', '.BBa', '..BO'], [0, 0]);
const CIGAR_SIDE = A(['ahhhhrhh', 'OBBBBRBb'], [8, 0]);
// The corncob pipe: a pale stippled cob of a bowl, a wooden stem, a black bit in the teeth.
const CORNCOB_SIDE = A(['.xxx.....', 'kCkCk....', 'CcCcC....', 'kCcCk....', 'CcCcCssSK', '.dcd.....'], [9, 4], true);
const CORNCOB_FRONT = A(['K.....', '.S....', '.kxxxk', '.CkCcC', '.cCcCc', '..dcd.'], [0, 0], true);
// The calabash: the gourd curving down from the mouth and up again, a white meerschaum cup in it.
const CALABASH_SIDE = A(['mxxxm.....', 'MMMMMm....', 'HGGGGg..KK', 'HGGGGg.Q..', '.HGGgQQ...', '..ggg.....'], [10, 2], true);
const CALABASH_FRONT = A(['K......', '.Q.....', '..Q....', '.mxxxm.', '.MMMMM.', 'HGGGGg.', 'HGGGGg.', '.HGgg..', '..gg...'], [0, 0], true);
// The bubble wand: a pink stick with a ring at the top, the soap film across it shining.
const WAND = A(['.uuu.', 'uUiUu', 'uiUiu', 'uUiUu', '.uuu.', '..p..', '..P..', '..p..'], [2, 8], true);
/** The same, held so the ring is at the lips: the dot that goes there is the middle of the ring. */
const WAND_BLOW = { ...WAND, anchor: [2, 2] as [number, number] };
// The mini fan: a round guard with the blades going round in it (two frames), on a mint handle.
const FAN_HEAD = (b: string[]) => ['.nnn.', `n${b[0]}n`, `n${b[1]}n`, `n${b[2]}n`, '.nnn.', '..y..', '..Y..', '..y..'];
const FAN: Art = { frames: [FAN_HEAD(['vzv', 'zez', 'vzv']), FAN_HEAD(['zvz', 'vev', 'zvz'])], anchor: [2, 8], outline: true, ms: 55 };
/** Held up to the face: its middle beside the mouth. */
const FAN_FACE = { ...FAN, anchor: [-1, 2] as [number, number] };

export const ARTS = { CIG_HAND, CIG_FRONT, CIG_SIDE, CIGAR_HAND, CIGAR_FRONT, CIGAR_SIDE, CORNCOB_SIDE, CORNCOB_FRONT, CALABASH_SIDE, CALABASH_FRONT, WAND, WAND_BLOW, FAN, FAN_FACE };
export type ArtName = keyof typeof ARTS;
/** Where it gives off smoke (its lit end, its bowl), or where the bubbles come off, or the fan blows from: the middle of
 *  those dots in it. */
const EMBER_DOTS: Record<string, string> = { cig: 'O', cigar: 'Oa', corncob: 'x', calabash: 'x', bubbles: 'Ui', fan: 'e' };

/** A picture as dots, left-right turned if `flip`: each frame's RGBA, and its size. With the outline, a dot of room
 *  is left round it (so the anchor moves one in, and down). */
export function pixels(art: Art, flip = false, skin = '#f0c2a2'): { w: number; h: number; frames: Uint8ClampedArray[]; anchor: [number, number] } {
  const o = art.outline ? 1 : 0;
  const w0 = Math.max(...art.frames[0].map((r) => r.length)), h0 = art.frames[0].length;
  const w = w0 + o * 2, h = h0 + o * 2;
  const frames = art.frames.map((rows) => {
    const d = new Uint8ClampedArray(w * h * 4);
    const put = (x: number, y: number, col: string, a = 1) => {
      const i = (y * w + x) * 4;
      d[i] = parseInt(col.slice(1, 3), 16); d[i + 1] = parseInt(col.slice(3, 5), 16); d[i + 2] = parseInt(col.slice(5, 7), 16); d[i + 3] = Math.round(a * 255);
    };
    const at = (x: number, y: number) => { const r = rows[y]; const ch = r?.[flip ? w0 - 1 - x : x]; return ch && ch !== '.' ? ch : ''; };
    for (let y = 0; y < h0; y++) for (let x = 0; x < w0; x++) {
      const ch = at(x, y);
      if (ch === '~') put(x + o, y + o, skin);                               // a finger over it: the holder's own skin
      else if (ch && PAL[ch]) put(x + o, y + o, PAL[ch][0], PAL[ch][1] ?? 1);
    }
    if (o) {
      // the outline: round the solid dots (not the see-through soap film or the fan's blur), not into them
      const solid = (x: number, y: number) => { const ch = at(x, y); return !!ch && (PAL[ch]?.[1] ?? 1) > 0.5; };
      for (let y = -1; y <= h0; y++) for (let x = -1; x <= w0; x++) {
        if (at(x, y)) continue;
        if (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1)) put(x + o, y + o, PAL['#'][0], 0.9);
      }
    }
    return d;
  });
  const ax = flip ? w0 - 1 - art.anchor[0] : art.anchor[0];
  return { w, h, frames, anchor: [ax + o, art.anchor[1] + o] };
}
function emberOf(art: Art, kind: string, flip: boolean): [number, number] | null {
  const want = EMBER_DOTS[kind] ?? '';
  let sx = 0, sy = 0, n = 0;
  const rows = art.frames[0], w0 = Math.max(...rows.map((r) => r.length));
  rows.forEach((r, y) => [...r].forEach((ch, x) => { if (want.includes(ch)) { sx += flip ? w0 - 1 - x : x; sy += y; n++; } }));
  if (!n) return null;
  const ax = flip ? w0 - 1 - art.anchor[0] : art.anchor[0];
  return [sx / n - ax, sy / n - art.anchor[1]];
}

// ── where it goes ──
/** What the app knows of where things go on somebody (sprites.ts marksOf): see client/src/draw/avatar.ts. */
export type Marks = { faceY: number; hand: readonly number[]; drink: { hold: readonly number[]; sip: readonly number[]; sit: number }; skin?: string };
/** How much each frame of a row is raised or lowered (y0 in avatar.ts's FRAMES), for the rows somebody can be in out here. */
const BOB: Record<string, number[]> = {
  walk_down: [0, -1, 0, -1], walk_up: [0, -1, 0, -1], walk_left: [0, -1, 0, -1], walk_right: [0, -1, 0, -1],
  idle: [0, 1, 0, 0], sit_front: [0, 1, 0, 0], sit_back: [0, 1, 0, 1], sit_side: [0, 1, 0, 0], drink: [0, 1, 0, 1], drink_sit: [0, 1, 0, 1],
  cheer: [1, -3, -6, -3], gaming_back: [0, 1, 0, 1], roast: [0, 1, 0, 1], roast_side: [0, 1, 0, 1], roast_back: [0, 1, 0, 1],
};
const SITTING = /sit|gaming|roast/;
export type View = 'front' | 'left' | 'right' | 'back';
export function viewOf(row: string, flip: boolean): View | null {
  if (/^walk_up$|_back$|^sit_back$/.test(row)) return 'back';
  if (/^walk_(left|right)$|_side$|^reach$|^punch$/.test(row)) return (row === 'walk_right') !== flip ? 'right' : 'left';
  if (/^(walk_down|idle|sit_front|drink|drink_sit|cheer|dance|roast)$/.test(row)) return 'front';
  return null;                                                              // asleep, flat out, sweeping, on the phone: put away
}

export type Placed = {
  art: ArtName; flip: boolean;
  /** where the picture's top left goes, in dots from the frame's top left (the frame: 48 x 48, feet on row 44) */
  x: number; y: number;
  /** where smoke comes off it (or bubbles, or the breeze), the mouth (for the breath blown out), and which way they face */
  ember: [number, number] | null; mouth: [number, number]; view: View;
  /** drawn at all (from behind, it is hidden by their head) */
  shown: boolean;
};

/** Where `kind` goes on somebody in `row`, frame `frame` (flipped or not), drag: whether they are at it just now
 *  (taking a drag, blowing, the fan up close; the page puts them in the drink row's lifted frames for it). */
export function place(kind: string, m: Marks, row: string, frame: number, flip: boolean, drag: boolean): Placed | null {
  const view = viewOf(row, flip);
  if (!view) return null;
  const f = frame % 4, bob = BOB[row]?.[f] ?? 0;
  const sitDy = SITTING.test(row) ? m.drink.sit : 0;
  const top = m.faceY + 21 + bob + sitDy;                                    // the top of the torso
  const side = view === 'left' || view === 'right', right = view === 'right';
  const fx = (x: number) => (right ? 47 - x : x);
  const mouth: [number, number] = side ? [fx(15), top - 5] : view === 'back' ? [24, top - 6] : [24, top - 5];
  const drinkRow = row === 'drink' || row === 'drink_sit', lifted = drinkRow && f >= 2;
  let art: ArtName, at: [number, number], fl = right;
  const k = kind as Kind;
  if (k === 'cig' || k === 'cigar' || k === 'corncob' || k === 'calabash') {
    const big = k === 'cig' ? 'CIG' : k === 'cigar' ? 'CIGAR' : k === 'corncob' ? 'CORNCOB' : 'CALABASH';
    if (drinkRow && !lifted && (k === 'cig' || k === 'cigar')) { art = `${big}_HAND` as ArtName; at = [m.drink.hold[0], m.drink.hold[1] + bob + sitDy]; fl = false; }
    else if (side) { art = `${big}_SIDE` as ArtName; at = [fx(15), top - 5]; }
    else { art = `${big}_FRONT` as ArtName; at = view === 'back' ? [24, top - 5] : [25, top - 5]; fl = false; }
  } else if (k === 'bubbles' || k === 'fan') {
    const fan = k === 'fan';
    if (drinkRow) {
      if (lifted) { art = fan ? 'FAN_FACE' : 'WAND_BLOW'; at = fan ? [27, top - 6] : [24, top - 4]; }
      else { art = fan ? 'FAN' : 'WAND'; at = [m.drink.hold[0], m.drink.hold[1] - 1 + bob + sitDy]; }
      fl = false;
    } else if (side) {
      const swing = row.startsWith('walk_') ? [2, 0, -2, 0][f] : 0;
      art = fan ? 'FAN' : 'WAND'; at = [fx(23 + swing), top + 9];
    } else {
      // at their side, in the hand on our right (walking, it swings with the arm)
      const sway = row === 'walk_down' || row === 'walk_up' ? [-1, -1, 1, -1][f] : bob;
      art = fan ? 'FAN' : 'WAND'; at = [m.hand[0], m.hand[1] + sway + sitDy];
      fl = false;
    }
  } else return null;
  const a = ARTS[art];
  const px = pixels(a, fl, m.skin);
  const em = emberOf(a, kind, fl);
  return {
    art, flip: fl, x: at[0] - px.anchor[0], y: at[1] - px.anchor[1],
    ember: em ? [at[0] + em[0], at[1] + em[1]] : null, mouth, view,
    shown: view !== 'back' || kind === 'bubbles' || kind === 'fan',
  };
}
