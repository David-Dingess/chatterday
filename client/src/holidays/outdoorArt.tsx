// The holiday decorations out of doors, drawn dot by dot (./outdoor.tsx puts them in the backyard, the campsite, the lake
// and the yard round the house). Pure drawing, no page: a script can draw them too, to look at them enlarged.
//
// Each piece is a few frames of a picture (`base`, drawn into the scene, darkened with the night as the scene is) and,
// for what is lit, the same frames of its light alone (`lit`: a jack-o'-lantern's face, the bulbs of a string), laid
// over the night by the page so it shines. Outlined in the room's ink as the scenes' own props are; a string of lights,
// bunting and a cobweb are fine lines and are not.

import type { Holiday } from './dates';

export type RGB = [number, number, number];
export type Scene = 'backyard' | 'campsite' | 'lake' | 'yard';
export type Pic = { w: number; h: number; px: Uint8ClampedArray };
export type Sprite = { w: number; h: number; base: Pic[]; lit?: Pic[]; ms?: number };

const hex = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
const mix = (a: RGB, b: RGB, t: number): RGB => a.map((v, i) => Math.round(v + (b[i] - v) * t)) as RGB;
const INK: RGB = [26, 18, 40];
const WHITE: RGB = [255, 255, 255];

const pic = (w: number, h: number): Pic => ({ w, h, px: new Uint8ClampedArray(w * h * 4) });
function dot(p: Pic, x: number, y: number, c: RGB, a = 255) {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || y < 0 || x >= p.w || y >= p.h) return;
  const i = (y * p.w + x) * 4;
  p.px[i] = c[0]; p.px[i + 1] = c[1]; p.px[i + 2] = c[2]; p.px[i + 3] = a;
}
const solid = (p: Pic, x: number, y: number) => x >= 0 && y >= 0 && x < p.w && y < p.h && p.px[(y * p.w + x) * 4 + 3] > 0;
const at = (p: Pic, x: number, y: number): RGB => { const i = (y * p.w + x) * 4; return [p.px[i], p.px[i + 1], p.px[i + 2]]; };
function rect(p: Pic, x0: number, y0: number, x1: number, y1: number, c: RGB) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) dot(p, x, y, c); }
/** A dark dot round everything drawn, tinted by what it touches (as the room's own props are outlined). */
function outline(p: Pic) {
  const add: [number, number, RGB][] = [];
  for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
    if (solid(p, x, y)) continue;
    const nb = [[0, 1], [1, 0], [-1, 0], [0, -1]].find(([dx, dy]) => solid(p, x + dx, y + dy));
    if (nb) add.push([x, y, mix(at(p, x + nb[0], y + nb[1]), INK, 0.72)]);
  }
  for (const [x, y, c] of add) dot(p, x, y, c);
  return p;
}
/** The picture with a clear dot all round it (room for its outline). */
function pad(p: Pic): Pic {
  const q = pic(p.w + 2, p.h + 2);
  for (let y = 0; y < p.h; y++) q.px.set(p.px.subarray(y * p.w * 4, (y + 1) * p.w * 4), ((y + 1) * q.w + 1) * 4);
  return q;
}
const ol = (p: Pic) => outline(pad(p));
const sprite = (base: Pic[], lit?: Pic[], ms?: number): Sprite => ({ w: base[0].w, h: base[0].h, base, lit, ms });
/** Rows of an oval: [y, x0, x1]. */
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
  lines.forEach((line, j) => [...line].forEach((ch, i) => { if (ch !== '.' && colours[ch]) dot(p, x + i, y + j, colours[ch]); }));
}
const hash = (a: number, b: number) => { let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) >>> 0; h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
/** The same picture, n times (a piece with no frames of its own beside one that has some). */
const frames = (n: number, f: (k: number) => Pic) => Array.from({ length: n }, (_, k) => f(k));

// ── pumpkins ──
const ORANGE = { base: hex('#e2701e'), hi: hex('#f7a04a'), lo: hex('#a8480f'), rib: hex('#c25a14') };
/** A pumpkin's body on p, its foot on row `foot`, `rx` half across: lit top left, ribs, a stem. */
function pumpkinBody(p: Pic, cx: number, foot: number, rx: number, ry: number, col = ORANGE) {
  const cy = foot - ry;
  for (const [y, x0, x1] of oval(cx, cy, rx, ry)) for (let x = x0; x <= x1; x++) {
    const u = (x - cx) / rx, v = (y - cy) / ry;
    let c = u * 0.6 + v * 0.8 < -0.55 ? col.hi : u * 0.5 + v * 0.8 > 0.55 ? col.lo : col.base;
    if (Math.abs(Math.abs(u) - 0.45) < 0.09 && Math.abs(v) < 0.8) c = col.rib;
    dot(p, x, y, c);
  }
  rect(p, cx, foot - 2 * ry - 2, cx, foot - 2 * ry, hex('#4a6a2a'));
  dot(p, cx + 1, foot - 2 * ry - 2, hex('#6a8a3a'));
}
/** A plain pumpkin (`big`: the bigger one). */
export function pumpkin(big = false): Sprite {
  const w = big ? 15 : 11, h = big ? 12 : 9;
  const p = pic(w, h);
  pumpkinBody(p, (w - 1) / 2, h - 1, big ? 6.4 : 4.6, big ? 4.2 : 3.2);
  return sprite([ol(p)]);
}
/** A jack-o'-lantern: carved eyes, nose and a toothy grin, dark by day, lit from inside at night (three frames of the
 *  candle's flicker). */
export function jackOLantern(variant = 0): Sprite {
  const w = 17, h = 14;
  const face = (p: Pic, c: RGB) => {
    stamp(p, 4, 4, ['.x.....x.', 'xxx...xxx'], { x: c });             // the eyes: two triangles
    dot(p, 8, 7, c);                                                    // the nose
    if (variant % 2) stamp(p, 4, 9, ['x.......x', 'xx.x.x.xx', '.xxxxxxx.'], { x: c });   // a wide grin
    else stamp(p, 4, 9, ['xx.xxx.xx', '.xxxxxxx.'], { x: c });                            // a gap-toothed one
  };
  const base = pic(w, h);
  pumpkinBody(base, 8, h - 1, 7.4, 5.4);
  face(base, hex('#4a1a08'));
  const b = ol(base);
  const flick = [hex('#ffd23a'), hex('#ffe46a'), hex('#ffb82a')];
  const lit = frames(3, (k) => { const p = pic(w, h); face(p, flick[k]); dot(p, 8, 10, hex('#fff2b0')); return pad(p); });
  return sprite(frames(3, () => b), lit, 260);
}
/** Three gourds: a warty yellow crookneck, a striped green one, a white one. */
export function gourds(): Sprite {
  const w = 18, h = 8, p = pic(w, h);
  const one = (cx: number, rx: number, ry: number, c: RGB, stripe?: RGB) => {
    for (const [y, x0, x1] of oval(cx, h - 1 - ry, rx, ry)) for (let x = x0; x <= x1; x++) dot(p, x, y, stripe && x % 2 ? stripe : y < h - 1 - ry && x < cx ? mix(c, WHITE, 0.3) : c);
  };
  one(3.5, 3, 2.5, hex('#e8c23a')); dot(p, 5, 1, hex('#e8c23a')); dot(p, 6, 0, hex('#c8a22a'));
  one(9, 2.6, 2.4, hex('#4a8a3a'), hex('#c8d878'));
  one(14.5, 3, 2.6, hex('#f2ece0')); dot(p, 14, 2, hex('#6a5a3a'));
  return sprite([ol(p)]);
}
/** A bale of straw, its two strings showing. */
export function hayBale(): Sprite {
  const w = 24, h = 14, p = pic(w, h);
  const straw = [hex('#c8a24a'), hex('#d8b65a'), hex('#e8ca72'), hex('#a8823a')];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const top = y < 5;
    let c = top ? straw[2] : straw[(x * 3 + y * 7 + (x >> 1)) % 3 === 0 ? 3 : 1];
    if (top && (x * 5 + y * 3) % 7 === 0) c = straw[1];
    if (!top && (x + y * 3) % 11 === 0) c = straw[2];
    if (x === 0 || y === h - 1) c = straw[3];
    dot(p, x, y, c);
  }
  for (const sx of [6, 17]) for (let y = 0; y < h; y++) dot(p, sx, y, hex('#8a5a2a'));
  return sprite([ol(p)]);
}
/** A scarecrow: a post and a cross bar, a burlap head under a straw hat, a plaid shirt, straw out of the cuffs. */
export function scarecrow(): Sprite {
  const w = 26, h = 40, p = pic(w, h);
  const wood = hex('#7a5232');
  rect(p, 12, 12, 13, h - 1, wood);
  rect(p, 2, 17, 23, 18, wood);
  // the shirt: red plaid
  const plaid = (x: number, y: number) => (x % 4 === 0 || y % 4 === 0 ? hex('#7a1c1c') : (x + y) % 4 === 2 ? hex('#e05a3a') : hex('#c8382a'));
  for (let y = 16; y <= 29; y++) for (let x = 8; x <= 17; x++) dot(p, x, y, plaid(x, y));
  for (let y = 16; y <= 20; y++) for (let x = 3; x <= 22; x++) if (x < 8 || x > 17) dot(p, x, y, plaid(x, y));
  // straw out of the cuffs, the collar, the hem
  for (const [x, y] of [[1, 16], [1, 18], [2, 20], [0, 17], [24, 16], [24, 18], [23, 20], [25, 17], [9, 30], [11, 31], [14, 31], [16, 30]]) dot(p, x, y, hex('#e8ca72'));
  // the jeans below
  rect(p, 9, 30, 16, 30, hex('#3a5a8a'));
  // the head: burlap, stitched eyes and mouth
  for (const [y, x0, x1] of oval(12.5, 11, 4.5, 4.5)) for (let x = x0; x <= x1; x++) dot(p, x, y, (x + y) % 3 ? hex('#c8aa78') : hex('#b0905e'));
  dot(p, 11, 10, INK); dot(p, 14, 10, INK);
  for (let x = 10; x <= 15; x++) dot(p, x, 13, x % 2 ? INK : hex('#8a6a42'));
  // the hat: a wide straw brim and a crown with a band
  rect(p, 5, 6, 20, 7, hex('#d8b65a'));
  rect(p, 8, 2, 17, 5, hex('#e8ca72'));
  rect(p, 8, 5, 17, 5, hex('#8a3a2a'));
  dot(p, 5, 7, hex('#a8823a')); dot(p, 20, 7, hex('#a8823a'));
  // a crow on the bar
  stamp(p, 19, 13, ['.kk.', 'kkkk', '.k.k'], { k: hex('#1c1a24') }); dot(p, 22, 13, hex('#e8a020'));
  return sprite([ol(p)]);
}
/** A cobweb strung across a corner (`flip`: the corner on the right): threads from the corner, and the spiral across them;
 *  a little spider hanging off it. Fine lines, no outline. */
export function cobweb(flip = false, size = 18): Sprite {
  const w = size, h = size, p = pic(w, h);
  const silk: RGB = hex('#eef2f8');
  const X = (x: number) => (flip ? w - 1 - x : x);
  for (let k = 0; k < 5; k++) {
    const a = (k / 4) * (Math.PI / 2);
    for (let r = 0; r < size; r++) dot(p, X(Math.cos(a) * r), Math.sin(a) * r, silk, 210);
  }
  for (const r of [4, 8, 12, 16]) {
    for (let k = 0; k < 4; k++) {
      const a0 = (k / 4) * (Math.PI / 2), a1 = ((k + 1) / 4) * (Math.PI / 2);
      const x0 = Math.cos(a0) * r, y0 = Math.sin(a0) * r, x1 = Math.cos(a1) * (r + 1), y1 = Math.sin(a1) * (r + 1);
      for (let t = 0; t <= 1; t += 0.08) dot(p, X(x0 + (x1 - x0) * t - Math.sin(t * Math.PI) * 0.8), y0 + (y1 - y0) * t - Math.sin(t * Math.PI) * 0.8, silk, 170);
    }
  }
  const sx = X(Math.round(size * 0.55)), sy = Math.round(size * 0.55);
  for (let y = 0; y < 3; y++) dot(p, sx, sy + y, silk, 150);
  stamp(p, sx - 1, sy + 3, ['k.k', '.k.', 'kkk', '.k.'], { k: hex('#141018') });
  return sprite([pad(p)]);
}

// ── strings of things: bunting, bulbs, hearts, shamrocks, tinsel ──
export type StringKind = 'lights' | 'bunting' | 'hearts' | 'shamrocks' | 'tinsel';
const BULBS = ['#ff4a4a', '#3ad06a', '#4a8aff', '#ffd23a', '#ff8a2a', '#e06ae0'].map(hex);
/** A string along points (scene dots), sagging `sag` dots between each pair of them on the level: whatever hangs on it
 *  at even steps. Returns the sprite and where its top-left corner is. Lights twinkle (three frames: each bulb is out
 *  in one of them now and then). */
export function stringOf(kind: StringKind, pts: [number, number][], sag = 4): Sprite & { x: number; y: number } {
  const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
  const x0 = Math.min(...xs) - 4, y0 = Math.min(...ys) - 2, w = Math.max(...xs) - x0 + 5, h = Math.max(...ys) - y0 + sag + 10;
  // the line itself, a dot at a time
  const line: [number, number][] = [];
  for (let k = 1; k < pts.length; k++) {
    const [ax, ay] = pts[k - 1], [bx, by] = pts[k];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay)));
    const level = Math.abs(by - ay) < Math.abs(bx - ax);
    for (let s = 0; s < n; s++) {
      const t = s / n;
      line.push([ax + (bx - ax) * t - x0, ay + (by - ay) * t + (level ? sag * Math.sin(Math.PI * t) : 0) - y0]);
    }
  }
  const wire: RGB = kind === 'lights' ? hex('#1e3a22') : kind === 'tinsel' ? hex('#d8b03a') : hex('#e8dcc0');
  const draw = (frame: number, litOnly: boolean) => {
    const p = pic(w, h);
    if (!litOnly) line.forEach(([x, y], i) => dot(p, x, y, kind === 'tinsel' ? (i % 3 ? hex('#e8c24a') : hex('#c0c8d8')) : wire));
    const step = kind === 'lights' ? 6 : kind === 'bunting' ? 7 : kind === 'tinsel' ? 4 : 8;
    for (let i = 3, k = 0; i < line.length; i += step, k++) {
      const [x, y] = line[i];
      if (kind === 'lights') {
        const c = BULBS[k % BULBS.length];
        const out = hash(k, frame) < 0.22;                             // (this one off just now)
        if (litOnly) { if (!out) { dot(p, x, y + 1, mix(c, WHITE, 0.45)); dot(p, x, y + 2, c); } }
        else { dot(p, x, y + 1, mix(c, INK, 0.25)); dot(p, x, y + 2, mix(c, INK, 0.4)); }
      } else if (litOnly) continue;
      else if (kind === 'bunting') {
        const c = [hex('#d8302a'), hex('#f4f0e8'), hex('#2a4aa8')][k % 3];
        stamp(p, x - 2, y, ['xxxxx', '.xxx.', '.xxx.', '..x..'], { x: c });
        dot(p, x - 2, y, mix(c, INK, 0.3)); dot(p, x + 2, y, mix(c, INK, 0.3));
      } else if (kind === 'hearts') {
        const c = k % 2 ? hex('#ff7aa8') : hex('#e02a4a');
        stamp(p, x - 2, y + 1, ['xx.xx', 'xxxxx', '.xxx.', '..x..'], { x: c }); dot(p, x - 1, y + 1, mix(c, WHITE, 0.5));
      } else if (kind === 'shamrocks') {
        const c = k % 2 ? hex('#3aa84a') : hex('#2a8a3a');
        stamp(p, x - 2, y + 1, ['.x.x.', 'xxxxx', '.xxx.', '..x..', '..s..'], { x: c, s: hex('#1e5a26') });
      } else if (kind === 'tinsel' && k % 4 === 0) {
        const c = k % 8 ? hex('#ffe066') : hex('#e8eef8');
        stamp(p, x - 2, y + 1, ['..x..', 'xxxxx', '.xxx.', 'x...x'], { x: c });
      }
    }
    return p;
  };
  if (kind === 'lights') return { x: x0, y: y0, w, h, base: frames(3, (f) => draw(f, false)), lit: frames(3, (f) => draw(f, true)), ms: 600 };
  return { x: x0, y: y0, w, h, base: [draw(0, false)] };     // (fine lines: no outline, no padding)
}

/** A wreath for a door: fir with red berries and a red bow (`hearts`: a ring of red and pink hearts for Valentine's). */
export function wreath(hearts = false): Sprite {
  const w = 15, h = 17, p = pic(w, h);
  if (hearts) {
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2, x = 7 + Math.cos(a) * 5, y = 7 + Math.sin(a) * 5;
      const c = k % 2 ? hex('#ff7aa8') : hex('#e02a4a');
      stamp(p, Math.round(x) - 2, Math.round(y) - 1, ['xx.xx', 'xxxxx', '.xxx.', '..x..'], { x: c });
    }
    return sprite([ol(p)]);
  }
  const fir = [hex('#1e5a2e'), hex('#2a7038'), hex('#3c8a46')];
  for (let y = 0; y < 15; y++) for (let x = 0; x < 15; x++) {
    const d = Math.hypot(x - 7, y - 7);
    if (d > 7.2 || d < 3.2) continue;
    dot(p, x, y, fir[(x * 7 + y * 3) % 5 === 0 ? 2 : d > 6 || y > 9 ? 0 : 1]);
  }
  for (const [x, y] of [[2, 5], [11, 3], [4, 11], [12, 9], [7, 1]]) dot(p, x, y, hex('#e02a2a'));
  stamp(p, 4, 11, ['xx.xx', '.xxx.', 'x.x.x', 'x...x'], { x: hex('#d8202a') }); dot(p, 6, 12, hex('#ff6a6a'));
  return sprite([ol(p)]);
}

/** A Christmas tree: tiers of fir, baubles, a gold star, and lights that twinkle (three frames). */
export function christmasTree(): Sprite {
  const w = 27, h = 38;
  const tree = pic(w, h);
  const fir = [hex('#123a26'), hex('#1a5232'), hex('#24683e'), hex('#348050')];
  for (let tier = 0; tier < 4; tier++) {
    const top = 4 + tier * 7, tall = 11, wide = 4 + tier * 2.6;
    for (let j = 0; j < tall; j++) {
      const half = 1 + wide * (j / (tall - 1));
      for (let x = Math.round(13 - half); x <= Math.round(13 + half); x++) {
        const u = (x - 13) / Math.max(1, half);
        dot(tree, x, top + j, j >= tall - 1 ? fir[0] : u < -0.4 ? fir[3] : u > 0.45 ? fir[0] : fir[(x + j) % 3 === 0 ? 2 : 1]);
      }
    }
  }
  rect(tree, 12, 33, 14, 35, hex('#6a4a30'));
  rect(tree, 9, 35, 17, 37, hex('#a8302a')); rect(tree, 9, 35, 17, 35, hex('#d84a3a'));                 // the pot, wrapped red
  stamp(tree, 11, 0, ['..y..', 'yyyyy', '.yyy.', 'y...y'], { y: hex('#ffd23a') });                      // the star
  const baubles: [number, number, string][] = [[10, 12, '#e02a2a'], [16, 15, '#4a8aff'], [8, 20, '#ffd23a'], [15, 22, '#e02a2a'], [19, 27, '#e06ae0'], [11, 28, '#4a8aff'], [6, 30, '#ffd23a'], [17, 31, '#e02a2a']];
  for (const [x, y, c] of baubles) { dot(tree, x, y, hex(c)); dot(tree, x, y - 1, mix(hex(c), WHITE, 0.5)); }
  const bulbs: [number, number][] = [];
  for (let k = 0; k < 26; k++) {                                       // the lights, wound round it
    const t = k / 26, y = 7 + t * 25, half = 2 + t * 10;
    bulbs.push([13 + Math.round(Math.sin(k * 1.7) * half * 0.8), Math.round(y)]);
  }
  bulbs.forEach(([x, y], k) => dot(tree, x, y, mix(BULBS[k % 6], INK, 0.2)));
  const b = ol(tree), base = frames(3, () => b);
  const lit = frames(3, (f) => {
    const p = pic(w, h);
    bulbs.forEach(([x, y], k) => { if (hash(k, f + 7) > 0.25) dot(p, x, y, mix(BULBS[k % 6], WHITE, 0.4)); });
    stamp(p, 11, 0, ['..y..', 'yyyyy', '.yyy.', 'y...y'], { y: f === 1 ? hex('#fff2a0') : hex('#ffe066') });
    return pad(p);
  });
  return sprite(base, lit, 500);
}

/** A snowman: three balls of snow, coal eyes and buttons, a carrot, a scarf, stick arms and a hat. */
export function snowman(scarf = '#e5484d'): Sprite {
  const w = 20, h = 27, p = pic(w, h);
  const snow = hex('#f4f8fc'), hi = WHITE, lo = hex('#bfcde0');
  for (const [x0, y0, dx] of [[3, 14, -1], [16, 14, 1]] as const) for (let k = 0; k < 5; k++) dot(p, x0 + dx * k, y0 - k, hex('#5a3a26'));
  for (const [cy, r, ry] of [[20, 6, 5], [12.5, 4.6, 4], [6.5, 3.4, 3]] as const) {
    for (const [y, x0, x1] of oval(9.5, cy, r, ry)) for (let x = x0; x <= x1; x++) dot(p, x, y, y < cy - ry * 0.4 && x < 9.5 ? hi : y > cy + ry * 0.5 || x > 9.5 + r * 0.6 ? lo : snow);
  }
  rect(p, 6, 9, 13, 10, hex(scarf)); rect(p, 12, 10, 13, 13, mix(hex(scarf), INK, 0.25));
  dot(p, 8, 5, INK); dot(p, 11, 5, INK);
  rect(p, 10, 7, 12, 7, hex('#f08a2e')); dot(p, 13, 7, hex('#c8641c'));
  for (const y of [12, 15, 19]) dot(p, 9, y, INK);
  rect(p, 6, 3, 13, 3, hex('#22232d')); rect(p, 7, 0, 12, 2, hex('#22232d')); rect(p, 7, 2, 12, 2, hex('#b9443c'));
  return sprite([ol(p)]);
}

/** An Easter egg, dyed and patterned (`k` picks which). */
export function egg(k: number): Sprite {
  const w = 7, h = 9, p = pic(w, h);
  const cols = ['#ff9ac2', '#8ad0ff', '#ffe066', '#b48ae6', '#8ae0a0', '#ffb070'].map(hex);
  const c = cols[k % cols.length], c2 = cols[(k + 2) % cols.length];
  for (const [y, x0, x1] of oval(3, 4, 2.6, 3.6)) for (let x = x0; x <= x1; x++) {
    let col = c;
    if (k % 3 === 0 && (y === 3 || y === 6)) col = c2;                 // stripes
    if (k % 3 === 1 && (x + y * 2) % 4 === 0) col = WHITE;             // dots
    if (k % 3 === 2 && y >= 4 && (x + y) % 2 === 0) col = c2;          // a zigzag band
    if (y <= 2 && x <= 2) col = mix(col, WHITE, 0.45);
    dot(p, x, y, col);
  }
  return sprite([ol(p)]);
}

/** The Stars and Stripes on a pole, stirring in the breeze (two frames). */
export function flag(): Sprite {
  const w = 22, h = 38;
  const draw = (f: number) => {
    const p = pic(w, h);
    rect(p, 2, 1, 3, h - 1, hex('#c8ccd4')); rect(p, 3, 1, 3, h - 1, hex('#8a8e98'));
    dot(p, 2, 0, hex('#e8c24a')); dot(p, 3, 0, hex('#e8c24a'));
    for (let x = 0; x < 16; x++) {
      const wave = Math.round(Math.sin(x / 3 + f * Math.PI) * (x / 16) * 1.2);
      for (let y = 0; y < 11; y++) {
        const c = x < 7 && y < 6 ? ((x + y) % 2 === 0 && x > 0 && y > 0 && x < 6 && y < 5 ? WHITE : hex('#2a3a8a')) : y % 2 === 0 ? hex('#d02a2a') : hex('#f4f0e8');
        dot(p, 4 + x, 2 + y + wave, x > 10 && f ? mix(c, INK, 0.12) : c);
      }
    }
    return ol(p);
  };
  return sprite([draw(0), draw(1)], undefined, 700);
}

/** A pot of gold: a black cauldron heaped with coins. */
export function potOfGold(): Sprite {
  const w = 14, h = 11, p = pic(w, h);
  for (const [y, x0, x1] of oval(6.5, 7, 6, 3.5)) for (let x = x0; x <= x1; x++) if (y >= 5) dot(p, x, y, x < 5 ? hex('#3a3a46') : hex('#22222c'));
  rect(p, 1, 4, 12, 5, hex('#2a2a34'));
  for (let x = 2; x <= 11; x++) for (let y = 1; y <= 4; y++) if (y >= 4 - Math.round(2.4 * Math.sin(((x - 1) / 11) * Math.PI))) dot(p, x, y, (x + y) % 3 ? hex('#ffd23a') : hex('#c89a1a'));
  dot(p, 5, 2, WHITE); dot(p, 9, 3, hex('#fff2a0'));
  return sprite([ol(p)]);
}

/** A pinwheel of hearts on a stick (Valentine's), or a party horn and streamers (New Year's): something small for the
 *  yard on a light day. */
export function heartStake(): Sprite {
  const w = 11, h = 20, p = pic(w, h);
  rect(p, 5, 8, 5, h - 1, hex('#6a4a30'));
  stamp(p, 0, 0, ['.xxx.xxx.', 'xxxxxxxxx', 'xxxxxxxxx', '.xxxxxxx.', '..xxxxx..', '...xxx...', '....x....'].map((l) => '.' + l), { x: hex('#e02a4a') });
  dot(p, 2, 1, hex('#ff8aa8')); dot(p, 3, 1, hex('#ff8aa8'));
  return sprite([ol(p)]);
}

// ── what goes where ──
/** One piece: a picture by name, its foot (bottom middle) at x, y, sorted among the people at depth z (default y). A
 *  string is placed by its own points instead. `glow`: a small warm halo on the ground round it at night. */
export type Piece = { art: string; x: number; y: number; z?: number; glow?: boolean } | { line: StringKind; pts: [number, number][]; sag?: number; z: number };
export const ART: Record<string, () => Sprite> = {
  jack0: () => jackOLantern(0), jack1: () => jackOLantern(1), pumpkin: () => pumpkin(false), bigPumpkin: () => pumpkin(true),
  gourds, hay: hayBale, scarecrow, web: () => cobweb(false), webR: () => cobweb(true), webS: () => cobweb(false, 13),
  wreath: () => wreath(false), heartWreath: () => wreath(true), tree: christmasTree, snowman: () => snowman(), snowmanB: () => snowman('#3b82f6'),
  flag, gold: potOfGold, heart: heartStake,
  ...Object.fromEntries([0, 1, 2, 3, 4, 5, 6, 7].map((k) => [`egg${k}`, () => egg(k)])),
};

// the backyard (scripts/basement/backyard.py): the cedar fence along the top, its posts every 48 dots; the house wall down
// the right edge, the door in it at y 150-172 (open against the wall above, x 515-518); the bed along the fence y 84-94
// (in two lengths: the young maple in the bed, x 166-262, stands in front of the fence there)
const FENCE: [number, number][][] = [[8, 56, 104, 152], [264, 312, 366]].map((xs) => xs.map((x) => [x, 25] as [number, number]));
const fence = (line: StringKind, sag = 5): Piece[] => FENCE.map((pts) => ({ line, pts, sag, z: 61 }));
// the campsite (scripts/basement/outside.py): the house wall down the left edge, its door at y 164-190
// the lake (scripts/basement/lake.py): the bait shop's front x 24-120, y 222-262, its roof's edge at y 224, the door x 90-108
export const PLACES: Record<Scene, Partial<Record<Holiday, Piece[]>>> = {
  backyard: {
    halloween: [{ art: 'jack0', x: 505, y: 146, glow: true }, { art: 'jack1', x: 505, y: 184, glow: true }, { art: 'bigPumpkin', x: 150, y: 92 },
      { art: 'pumpkin', x: 302, y: 93 }, { art: 'pumpkin', x: 498, y: 70 },
      { art: 'web', x: 17, y: 43, z: 61 }, { art: 'webR', x: 232, y: 43, z: 61 }, { art: 'web', x: 349, y: 43, z: 61 }],
    thanksgiving: [{ art: 'bigPumpkin', x: 505, y: 146 }, { art: 'gourds', x: 506, y: 184 }, { art: 'pumpkin', x: 150, y: 92 }],
    christmas: [...fence('lights'), { line: 'lights', pts: [[521, 2], [521, 145]], z: 70 }, { line: 'lights', pts: [[521, 178], [521, 330]], z: 70 },
      { art: 'wreath', x: 517, y: 137, z: 70 }],
    newyear: [...fence('tinsel')],
    valentine: [...fence('hearts'), { art: 'heartWreath', x: 517, y: 137, z: 70 }, { art: 'heart', x: 200, y: 92 }],
    stpatrick: [...fence('shamrocks'), { art: 'gold', x: 393, y: 306 }],
    easter: [{ art: 'egg0', x: 92, y: 93 }, { art: 'egg1', x: 177, y: 94 }, { art: 'egg2', x: 262, y: 93 }, { art: 'egg3', x: 344, y: 95 },
      { art: 'egg4', x: 509, y: 120 }, { art: 'egg5', x: 368, y: 306 }, { art: 'egg6', x: 508, y: 318 }, { art: 'egg7', x: 22, y: 92 }],
    july4: [...fence('bunting', 6), { art: 'flag', x: 74, y: 91 }],
  },
  campsite: {
    halloween: [{ art: 'jack0', x: 240, y: 196, glow: true }, { art: 'jack1', x: 304, y: 196, glow: true }, { art: 'jack1', x: 10, y: 160, glow: true },
      { art: 'jack0', x: 10, y: 200, glow: true }, { art: 'pumpkin', x: 196, y: 92 }],
    thanksgiving: [{ art: 'hay', x: 196, y: 94 }, { art: 'bigPumpkin', x: 192, y: 82, z: 95 }, { art: 'gourds', x: 178, y: 98 }, { art: 'pumpkin', x: 214, y: 98 },
      { art: 'hay', x: 372, y: 98 }, { art: 'pumpkin', x: 376, y: 85, z: 99 }, { art: 'bigPumpkin', x: 392, y: 101 }],
    christmas: [{ art: 'wreath', x: 8, y: 162, z: 3 }, { line: 'lights', pts: [[3, 4], [3, 156]], z: 3 }, { line: 'lights', pts: [[3, 198], [3, 330]], z: 3 }],
    easter: [{ art: 'egg2', x: 24, y: 100 }, { art: 'egg5', x: 178, y: 92 }, { art: 'egg0', x: 236, y: 96 }, { art: 'egg3', x: 358, y: 300 },
      { art: 'egg6', x: 104, y: 318 }, { art: 'egg1', x: 444, y: 310 }],
    july4: [{ art: 'flag', x: 238, y: 90 }],
  },
  lake: {
    halloween: [{ art: 'jack0', x: 60, y: 272, glow: true }, { art: 'jack1', x: 82, y: 271, glow: true }, { art: 'webS', x: 32, y: 239, z: 263 }],
    thanksgiving: [{ art: 'bigPumpkin', x: 60, y: 272 }, { art: 'gourds', x: 82, y: 271 }],
    christmas: [{ art: 'tree', x: 66, y: 294, glow: true }, { line: 'lights', pts: [[20, 224], [72, 224], [125, 224]], sag: 3, z: 263 },
      { art: 'wreath', x: 99, y: 251, z: 263 }],
    easter: [{ art: 'egg4', x: 150, y: 302 }, { art: 'egg1', x: 330, y: 296 }, { art: 'egg7', x: 500, y: 308 }, { art: 'egg2', x: 60, y: 300 }, { art: 'egg0', x: 252, y: 300 }],
    july4: [{ art: 'flag', x: 22, y: 224, z: 263 }],
  },
  yard: {
    // past the graves (left alone), by the vegetable bed: in the yard's own dots (the room's), make-clubhouse.py yard_art
    halloween: [{ art: 'scarecrow', x: 182, y: -12, z: 1 }],
  },
};
/** Where a snowman stands while it is really snowing (out of everybody's way). */
export const SNOWMAN: Partial<Record<Scene, Piece>> = { backyard: { art: 'snowman', x: 505, y: 328 }, campsite: { art: 'snowmanB', x: 484, y: 302 }, lake: { art: 'snowman', x: 110, y: 302 } };
