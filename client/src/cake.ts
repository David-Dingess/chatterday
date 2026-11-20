// The birthday cake on the kitchen table, and the card standing beside it, drawn dot by dot (client/src/birthday.tsx
// puts them in the room). Pure drawing, no page: scripts can draw it too, to look at it enlarged.
//
// The cake: a round cake on a white plate, seen from the room's slant, so its top is an oval. White icing with
// sprinkles, pink sides with the icing dripping down them, a row of piping round the top's front edge and its foot in
// the birthday person's colour, and five candles (two at the back, three at the front) striped white and that colour.
// Three frames of the flames moving (each candle's flame on its own beat), and a fourth with them out: bare wicks.
// The card: a folded card stood up like a little tent, its face in their colour with a white heart.

export type RGB = [number, number, number];
export type Pic = { w: number; h: number; px: Uint8ClampedArray };

const hex = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
const mix = (a: RGB, b: RGB, t: number): RGB => a.map((v, i) => Math.round(v + (b[i] - v) * t)) as RGB;
const INK: RGB = [26, 18, 40];                     // the room's outline colour (INK in scripts/make-clubhouse.py)

function pic(w: number, h: number): Pic { return { w, h, px: new Uint8ClampedArray(w * h * 4) }; }
function dot(p: Pic, x: number, y: number, c: RGB) {
  if (x < 0 || y < 0 || x >= p.w || y >= p.h) return;
  const i = (y * p.w + x) * 4;
  p.px[i] = c[0]; p.px[i + 1] = c[1]; p.px[i + 2] = c[2]; p.px[i + 3] = 255;
}
const solid = (p: Pic, x: number, y: number) => x >= 0 && y >= 0 && x < p.w && y < p.h && p.px[(y * p.w + x) * 4 + 3] > 0;
const at = (p: Pic, x: number, y: number): RGB => { const i = (y * p.w + x) * 4; return [p.px[i], p.px[i + 1], p.px[i + 2]]; };

/** A dark dot round everything drawn, tinted by what it touches (as the room's own props are outlined). */
function outline(p: Pic) {
  const add: [number, number, RGB][] = [];
  for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
    if (solid(p, x, y)) continue;
    const nb = [[0, 1], [1, 0], [-1, 0], [0, -1]].find(([dx, dy]) => solid(p, x + dx, y + dy));
    if (nb) add.push([x, y, mix(at(p, x + nb[0], y + nb[1]), INK, 0.72)]);
  }
  for (const [x, y, c] of add) dot(p, x, y, c);
}
/** Rows of an oval: [y, x0, x1] (as ellipse() in scripts/make-clubhouse.py). */
function oval(cx: number, cy: number, rx: number, ry: number): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    const t = 1 - ((y - cy) / ry) ** 2;
    if (t < 0) continue;
    const dx = rx * Math.sqrt(t);
    out.push([y, Math.round(cx - dx), Math.round(cx + dx)]);
  }
  return out;
}
function stamp(p: Pic, x: number, y: number, lines: string[], colours: Record<string, RGB>) {
  lines.forEach((line, j) => [...line].forEach((ch, i) => { if (ch !== '.') dot(p, x + i, y + j, colours[ch]); }));
}

export const CAKE_W = 22, CAKE_H = 29;
/** Frames 0-2 are the candles lit; frame 3 is them out. */
export const CAKE_FRAMES = 4;
/** Where each candle's wick is in the picture: [x, y]. For the smoke when they are blown out. */
export const WICKS: [number, number][] = [[7, 6], [13, 6], [4, 9], [10, 10], [16, 9]];       // (the back two first: the front three are drawn over them)

const FLAMES = [['.y', 'yW', 'WW', 'oo'], ['y.', 'Wy', 'WW', 'oo'], ['..', 'yy', 'yW', 'oo'], ['.y', 'yy', 'WW', 'oo']];
const FLAME: Record<string, RGB> = { y: hex('#ffd23a'), W: hex('#fff7d6'), o: hex('#ff8a24') };

/** The cake, in one frame. `colour` is the birthday person's colour. */
export function cakeFrame(colour: string, frame: number): Pic {
  const p = pic(CAKE_W, CAKE_H);
  const theirs = hex(colour), theirsLo = mix(theirs, INK, 0.35), theirsHi = mix(theirs, [255, 255, 255], 0.4);
  const TOP = 15, FOOT = 22;                                        // the middles of the top's oval and the bottom's
  // the plate
  const plate = hex('#eef1f6'), plateLo = hex('#c3cad8'), plateHi = hex('#ffffff');
  for (const [y, x0, x1] of oval(10.5, FOOT + 1.5, 10, 3.6)) for (let x = x0; x <= x1; x++) dot(p, x, y, y >= FOOT + 4 ? plateLo : x <= x0 + 1 ? plateHi : plate);
  // the side, pink: lit on the left, in shade on the right
  const side = hex('#ff9cc5'), sideLo = hex('#de6f9f'), sideHi = hex('#ffc6de');
  const pink = (x: number) => (x <= 4 ? sideHi : x >= 16 ? sideLo : side);
  for (const [y, x0, x1] of oval(10.5, FOOT, 7.6, 3)) for (let x = x0; x <= x1; x++) for (let yy = TOP; yy <= (y >= FOOT ? y : FOOT); yy++) dot(p, x, yy, pink(x));
  // its foot: piping in their colour, all round where it sits on the plate
  const foot = oval(10.5, FOOT, 7.6, 3).filter(([y]) => y >= FOOT);
  for (const [y, x0, x1] of foot) { dot(p, x0, y, theirsHi); dot(p, x1, y, theirsLo); }
  const last = foot[foot.length - 1];
  for (let x = last[1]; x <= last[2]; x++) dot(p, x, last[0], x % 2 ? theirs : theirsLo);
  // the top: white icing, in a little shade at the back right, with sprinkles
  const icing = hex('#fbf4f7'), icingLo = hex('#e3cfd9'), icingHi = hex('#ffffff');
  const top = oval(10.5, TOP, 7.6, 3.2);
  for (const [y, x0, x1] of top) for (let x = x0; x <= x1; x++) dot(p, x, y, y <= TOP - 2 && x <= 8 ? icingHi : x >= x1 - 1 ? icingLo : icing);
  const edgeOf = (x: number) => Math.max(...top.filter(([, x0, x1]) => x >= x0 && x <= x1).map(([y]) => y));
  // the icing run over the front edge and down the side, in drips of different lengths
  const drips = [2, 1, 3, 1, 1, 2, 1, 1, 3, 1, 1, 2, 1, 3, 1, 2];
  for (let x = 3; x <= 18; x++) for (let k = 1; k <= drips[x - 3]; k++) dot(p, x, edgeOf(x) + k, x >= 16 ? icingLo : icing);
  // the piping along the front edge of the top, in their colour
  for (let x = 3; x <= 18; x += 2) dot(p, x, edgeOf(x), x <= 10 ? theirs : theirsLo);
  const sprinkles: [number, number, string][] = [[5, 13, '#e5484d'], [8, 15, '#4f9cf0'], [12, 12, '#ffd84a'], [15, 14, '#3fbf63'], [6, 16, '#ffd84a'], [13, 16, '#e5484d'], [17, 13, '#4f9cf0'], [9, 12, '#3fbf63']];
  for (const [x, y, c] of sprinkles) dot(p, x, y, hex(c));
  // the candles: two at the back, three in front; in their colour, lit down the left. Drawn before the outline goes
  // round everything, so where they stand up clear of the cake they are outlined like the rest of it.
  const candle = (x: number, base: number) => {
    for (let y = base - 4; y <= base; y++) { dot(p, x, y, theirsHi); dot(p, x + 1, y, y % 2 ? theirs : theirsLo); }
    dot(p, x - 1, base + 1, icingLo); dot(p, x, base + 1, icingLo); dot(p, x + 1, base + 1, icingLo);      // its shadow on the icing
  };
  WICKS.forEach(([x, y]) => candle(x, y + 5));
  outline(p);
  const wick = hex('#2b2230');
  WICKS.forEach(([x, y], k) => {
    if (frame >= 3) { dot(p, x, y, wick); dot(p, x + 1, y, mix(wick, theirs, 0.3)); return; }     // out: the bare wick, burnt black
    stamp(p, x, y - 3, FLAMES[(frame + k * 2) % FLAMES.length], FLAME);
  });
  return p;
}

export const CARD_W = 13, CARD_H = 12;
/** The card standing beside the cake: folded and stood up like a tent, leaning back a little, its face in their colour
 *  with a white heart; the back half shows as a sliver down its right side. */
export function cardPic(colour: string): Pic {
  const p = pic(CARD_W, CARD_H);
  const c = hex(colour), lo = mix(c, INK, 0.3);
  const paper = hex('#f6f1e6'), paperLo = hex('#d8cfbd'), paperHi = hex('#ffffff'), back = hex('#b3a993');
  for (let y = 2; y <= 10; y++) dot(p, 11, y, back);                // the back half, beyond the fold
  for (let y = 1; y <= 10; y++) {
    const inset = y <= 2 ? 1 : 0;                                    // (the fold at the top is narrower: it leans away)
    for (let x = 1 + inset; x <= 10 - inset; x++) dot(p, x, y, y === 1 ? paperHi : x === 10 ? paperLo : paper);
  }
  for (let x = 1; x <= 10; x++) dot(p, x, 10, x === 10 ? lo : c);  // a band of their colour along the bottom
  stamp(p, 2, 3, ['.HH.HH.', 'HhHHHHH', 'HHHHHHH', '.HHHHH.', '..HHH..', '...H...'], { H: c, h: mix(c, [255, 255, 255], 0.5) });
  outline(p);
  return p;
}
