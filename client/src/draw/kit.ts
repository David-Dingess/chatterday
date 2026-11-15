// The pixel kit everything in the house is drawn with: a small canvas of RGBA dots, materials with a lit and a
// shaded tone, and the dark outline that goes round a finished piece. Characters, pets and desks are all drawn
// by code in this folder, in the browser, from what each person picked. Nothing here touches the DOM, so the
// same code can be run by Node for tests.

export type RGB = readonly [number, number, number];
/** One row of a shape: y, then the first and last x (both included). */
export type Span = readonly [number, number, number];
export type Pattern = (dx: number, dy: number, c: RGB, m: Mat) => RGB;

export const LIGHT: RGB = [255, 240, 205];
export const SHADE: RGB = [46, 28, 78];
export const INK: RGB = [26, 18, 40];
export const WHITE: RGB = [255, 255, 255];

/** Rounds halves to the even number, so colours come out the same as the art this was first drawn with. */
export function round(x: number): number {
  const f = Math.floor(x), d = x - f;
  if (d < 0.5) return f;
  if (d > 0.5) return f + 1;
  return f % 2 === 0 ? f : f + 1;
}

export function rgb(h: string | RGB): RGB {
  if (typeof h !== 'string') return h;
  const s = h.replace('#', '');
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}
export const hex = (c: RGB) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
export const mix = (a: RGB, b: RGB, t: number): RGB => [round(a[0] + (b[0] - a[0]) * t), round(a[1] + (b[1] - a[1]) * t), round(a[2] + (b[2] - a[2]) * t)];
export const same = (a: RGB | null, b: RGB | null) => !!a && !!b && a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

/** A material: a base colour with a lit and a shaded tone, and perhaps a pattern. */
export class Mat {
  base: RGB; hi: RGB; lo: RGB; pat?: Pattern;
  constructor(base: string | RGB, o: { hi?: string | RGB; lo?: string | RGB; pat?: Pattern } = {}) {
    this.base = rgb(base);
    this.hi = o.hi ? rgb(o.hi) : mix(this.base, LIGHT, 0.30);
    this.lo = o.lo ? rgb(o.lo) : mix(this.base, SHADE, 0.30);
    this.pat = o.pat;
  }
}

/** Every dot of `rows(x0, y0, x1, y1)`, as spans. */
export const rows = (x0: number, y0: number, x1: number, y1: number): Span[] => {
  const out: Span[] = [];
  for (let y = y0; y <= y1; y++) out.push([y, x0, x1]);
  return out;
};

export class Cv {
  /** `up`: rows of headroom above row 0, drawn to with a negative y. (A character's frame and head have some, for
   *  whatever stands taller than the frame: a party hat on top of somebody's hair, their head at the top of a jump.) */
  w: number; h: number; up: number; a: Uint8ClampedArray;
  constructor(w = 48, h = 48, up = 0) { this.w = w; this.h = h; this.up = up; this.a = new Uint8ClampedArray(w * (h + up) * 4); }
  /** How many rows there are in all: the picture and the headroom over it. */
  get tall(): number { return this.h + this.up; }

  px(x: number, y: number, c: RGB) {
    if (x < 0 || y < -this.up || x >= this.w || y >= this.h) return;
    const i = ((y + this.up) * this.w + x) * 4;
    this.a[i] = c[0]; this.a[i + 1] = c[1]; this.a[i + 2] = c[2]; this.a[i + 3] = 255;
  }
  /** Rubs a dot out again. */
  clear(x: number, y: number) {
    if (x < 0 || y < -this.up || x >= this.w || y >= this.h) return;
    this.a[((y + this.up) * this.w + x) * 4 + 3] = 0;
  }
  get(x: number, y: number): RGB | null {
    if (x < 0 || y < -this.up || x >= this.w || y >= this.h) return null;
    const i = ((y + this.up) * this.w + x) * 4;
    return this.a[i + 3] ? [this.a[i], this.a[i + 1], this.a[i + 2]] : null;
  }
  /** Mixes a colour into a dot that is already drawn; an empty dot stays empty. */
  tint(x: number, y: number, c: RGB, t: number) {
    const cur = this.get(x, y);
    if (cur) this.px(x, y, mix(cur, c, t));
  }
  rect(x0: number, y0: number, x1: number, y1: number, c: RGB) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.px(x, y, c);
  }
  /** Fills rows of dots with a material and shades the edges: light comes from the top left. `hi` and `lo` say which
   *  edges get the lit and the shaded tone ('t', 'l', 'r', 'b'). Returns the dots it filled, as "x,y" keys. */
  part(spans: readonly Span[], mat: Mat, hi = 't', lo = 'rb', anchor?: readonly [number, number]): Set<string> {
    const pts = new Set<string>();
    for (const [y, x0, x1] of spans) for (let x = x0; x <= x1; x++) pts.add(`${x},${y}`);
    const has = (x: number, y: number) => pts.has(`${x},${y}`);
    for (const key of pts) {
      const comma = key.indexOf(','), x = Number(key.slice(0, comma)), y = Number(key.slice(comma + 1));
      let col = mat.base, edge = true;
      if ((lo.includes('r') && !has(x + 1, y)) || (lo.includes('b') && !has(x, y + 1))) col = mat.lo;
      else if ((hi.includes('t') && !has(x, y - 1)) || (hi.includes('l') && !has(x - 1, y))) col = mat.hi;
      else edge = false;
      if (mat.pat && anchor && !edge) col = mat.pat(x - anchor[0], y - anchor[1], col, mat);
      this.px(x, y, col);
    }
    return pts;
  }
  /** Hand-placed dots: one character for each, looked up in `tones`. Any other character leaves the dot alone. */
  ascii(lines: readonly string[], tones: Record<string, RGB>, ox = 0, oy = 0) {
    lines.forEach((line, y) => { for (let x = 0; x < line.length; x++) { const c = tones[line[x]]; if (c) this.px(x + ox, y + oy, c); } });
  }
  /** Draws another canvas on top of this one, with its corner (the corner of its picture, under any headroom) at (ox, oy). */
  paste(other: Cv, ox: number, oy: number) {
    for (let y = -other.up; y < other.h; y++) for (let x = 0; x < other.w; x++) {
      const i = ((y + other.up) * other.w + x) * 4;
      if (other.a[i + 3]) this.px(x + ox, y + oy, [other.a[i], other.a[i + 1], other.a[i + 2]]);
    }
  }
  flipped(): Cv {
    const c = new Cv(this.w, this.h, this.up);
    for (let y = 0; y < this.tall; y++) for (let x = 0; x < this.w; x++) {
      const s = (y * this.w + (this.w - 1 - x)) * 4, d = (y * this.w + x) * 4;
      c.a[d] = this.a[s]; c.a[d + 1] = this.a[s + 1]; c.a[d + 2] = this.a[s + 2]; c.a[d + 3] = this.a[s + 3];
    }
    return c;
  }
  /** Turned a quarter turn anticlockwise (what numpy's rot90 does). It is the picture itself that is turned: the
   *  result has the same headroom, empty, and whatever stood in it (the point of a party hat) is left off. */
  rotatedLeft(): Cv {
    const c = new Cv(this.h, this.w, this.up);
    for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) {
      const s = ((x + this.up) * this.w + (this.w - 1 - y)) * 4, d = ((y + c.up) * c.w + x) * 4;
      c.a[d] = this.a[s]; c.a[d + 1] = this.a[s + 1]; c.a[d + 2] = this.a[s + 2]; c.a[d + 3] = this.a[s + 3];
    }
    return c;
  }
  /** The same picture moved down by `dy` dots (up, into the headroom, if negative). */
  shifted(dy: number): Cv {
    const c = new Cv(this.w, this.h, this.up);
    c.paste(this, 0, dy);
    return c;
  }
}

/** One dark dot round the silhouette, tinted by whatever it borders. Looks below, right, left, then above. */
export function outlined(cv: Cv): Cv {
  const out = new Cv(cv.w, cv.h, cv.up);
  out.a.set(cv.a);
  for (let y = -cv.up; y < cv.h; y++) for (let x = 0; x < cv.w; x++) {
    if (cv.a[((y + cv.up) * cv.w + x) * 4 + 3]) continue;
    for (const [dx, dy] of [[0, 1], [1, 0], [-1, 0], [0, -1]]) {
      const n = cv.get(x + dx, y + dy);
      if (n) { out.px(x, y, mix(n, INK, 0.72)); break; }
    }
  }
  return out;
}

/** A finished picture: plain RGBA dots, ready for a canvas's putImageData. */
export type Picture = { w: number; h: number; data: Uint8ClampedArray };

/** Lays frames out on one sheet, `cols` across. Every frame must be the same size. (A frame with headroom takes a
 *  cell that much taller: the headroom is the top of the cell.) */
export function sheetOf(frames: readonly Cv[], cols: number): Picture {
  const fw = frames[0].w, fh = frames[0].tall, nrows = Math.ceil(frames.length / cols);
  const data = new Uint8ClampedArray(fw * cols * fh * nrows * 4);
  frames.forEach((f, k) => {
    const ox = (k % cols) * fw, oy = Math.floor(k / cols) * fh;
    for (let y = 0; y < fh; y++) data.set(f.a.subarray(y * fw * 4, (y + 1) * fw * 4), ((oy + y) * fw * cols + ox) * 4);
  });
  return { w: fw * cols, h: fh * nrows, data };
}
