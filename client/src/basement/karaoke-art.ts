// The karaoke lounge's mic, drawn over the room (client/src/basement/karaoke.tsx): in its stand on the stage, or in the
// singer's hand at their mouth. Little pictures in the dots and colours of ./smokes.ts (and drawn by its pixels()), kept
// apart from the page so a script can draw them over the same frames to look at them.
import type { Art, Marks } from './smokes';

const A = (rows: string[], anchor: [number, number], outline = false): Art => ({ frames: [rows], anchor, outline });
/** A picture that stands on the floor: its anchor is the middle of its bottom row. */
const standing = (rows: string[]): Art => A(rows, [2, rows.length - 1]);

// The mic: a round steel grille (lit on its top left), a black body under it.
const HEAD = ['.NN.', 'NeNn', 'nNnn', '.nn.'];
const POLE = Array.from({ length: 24 }, () => '..A..');
const FEET = ['..A..', '.nAn.', 'n.A.n', 'n...n'];
/** The stand with the mic in its clip, tipped a little toward whoever steps up to it. The anchor is its foot. */
export const STAND_MIC = standing([...HEAD.map((r) => `${r}.`), '.KK..', '..QK.', '..A..', ...POLE, ...FEET]);
/** The stand with its clip empty (the singer has the mic). */
export const STAND_EMPTY = standing(['.....', '.....', '.....', '.....', '.....', '...K.', '..QK.', '..A..', ...POLE, ...FEET]);
/** In the hand, up at the mouth: the grille over the chin, the body down into the fist (`~`: their fingers round it).
 *  The anchor is the middle of the fist. */
export const MIC_HELD = A([...HEAD, '.KK.', '.KQ.', '~~~.', '~~~.'], [2, 7], true);

/** How much each frame of the drink row is raised or lowered (as in ./smokes.ts BOB). */
const BOB = [0, 1, 0, 1];
/** Where the held mic's picture goes on somebody singing (the drink row's lifted frames, `frame` 2 or 3), as the dot in
 *  their 48 x 48 frame its anchor lands on. */
export const micAt = (m: Marks, frame: number): [number, number] => [m.drink.sip[0], m.drink.sip[1] + (BOB[frame % 4] ?? 0)];
