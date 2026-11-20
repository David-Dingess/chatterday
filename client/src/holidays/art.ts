// The holiday decorations, drawn dot by dot (client/src/holidays/decor.tsx puts them in the rooms). Pure drawing, no
// page: scripts can draw them too, to look at them enlarged. Each picture is one or more frames side by side; most are
// outlined as the room's own props are (a dark dot round everything, tinted by what it touches).
//
// The pictures are in room dots (a person is about 30 tall), and nothing that has to be recognised is under 8 dots.

export type RGB = [number, number, number];
export type Pic = { w: number; h: number; px: Uint8ClampedArray };
/** A sprite: its frames (all one size); `tile`: drawn repeated along a wall (a garland), not once. */
export type Sprite = { frames: Pic[]; tile?: boolean };

const hex = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
const mix = (a: RGB, b: RGB, t: number): RGB => a.map((v, i) => Math.round(v + (b[i] - v) * t)) as RGB;
const INK: RGB = [26, 18, 40];                     // the room's outline colour (INK in scripts/make-clubhouse.py)

function pic(w: number, h: number): Pic { return { w, h, px: new Uint8ClampedArray(w * h * 4) }; }
function dot(p: Pic, x: number, y: number, c: RGB, a = 255) {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || y < 0 || x >= p.w || y >= p.h) return;
  const i = (y * p.w + x) * 4;
  p.px[i] = c[0]; p.px[i + 1] = c[1]; p.px[i + 2] = c[2]; p.px[i + 3] = a;
}
const solid = (p: Pic, x: number, y: number) => x >= 0 && y >= 0 && x < p.w && y < p.h && p.px[(y * p.w + x) * 4 + 3] > 0;
const at = (p: Pic, x: number, y: number): RGB => { const i = (y * p.w + x) * 4; return [p.px[i], p.px[i + 1], p.px[i + 2]]; };

/** A dark dot round everything drawn, tinted by what it touches; or one colour (`colour`), for black things on dark walls. */
function outline(p: Pic, colour?: RGB) {
  const add: [number, number, RGB][] = [];
  for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
    if (solid(p, x, y)) continue;
    const nb = [[0, 1], [1, 0], [-1, 0], [0, -1]].find(([dx, dy]) => solid(p, x + dx, y + dy));
    if (nb) add.push([x, y, colour ?? mix(at(p, x + nb[0], y + nb[1]), INK, 0.72)]);
  }
  for (const [x, y, c] of add) dot(p, x, y, c);
}

// The colours, one letter each, for the pictures drawn as rows of letters.
const PAL: Record<string, RGB> = {
  K: INK, X: hex('#241a30'), x: hex('#3d3050'),
  W: hex('#ffffff'), w: hex('#dde2ee'), g: hex('#9aa0b4'), q: hex('#c4ccdc'),
  R: hex('#e23b3b'), r: hex('#a3222f'), P: hex('#ff8fbd'), p: hex('#df5c92'), L: hex('#ffc9df'),
  O: hex('#ff8c26'), o: hex('#c9561a'), Y: hex('#ffd23a'), y: hex('#fff3a8'), D: hex('#e8b830'), d: hex('#a87a18'),
  G: hex('#3fae4a'), H: hex('#1f6e35'), J: hex('#8fd86a'), j: hex('#2b8c40'),
  B: hex('#3a6fe0'), b: hex('#22388a'), C: hex('#9fd6ff'), V: hex('#9a6be0'), v: hex('#cbb4f6'),
  N: hex('#8a5a3c'), n: hex('#5c3a24'), T: hex('#c99a62'), t: hex('#a87a46'), M: hex('#a6ecd2'), E: hex('#ffcf9e'),
};

/** Draws rows of letters (a '.' is nothing); `swap` recolours letters for this frame. */
function rows(lines: string[], swap: Record<string, RGB | null> = {}, into?: Pic, ox = 0, oy = 0): Pic {
  const w = Math.max(...lines.map((l) => l.length));
  const p = into ?? pic(w, lines.length);
  lines.forEach((line, j) => [...line].forEach((ch, i) => {
    if (ch === '.' || ch === ' ') return;
    const c = ch in swap ? swap[ch] : PAL[ch];
    if (c) dot(p, ox + i, oy + j, c);
  }));
  return p;
}
/** A picture `pad` dots bigger all round (room for its outline). */
function padded(src: Pic, pad = 1): Pic {
  const p = pic(src.w + pad * 2, src.h + pad * 2);
  for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) if (solid(src, x, y)) dot(p, x + pad, y + pad, at(src, x, y), src.px[(y * src.w + x) * 4 + 3]);
  return p;
}
const done = (src: Pic, line?: RGB) => { const p = padded(src); outline(p, line); return p; };
/** A seeded random number (0 to 1), the same every time: the art never changes between drawings. */
function rng(seed: number) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }

// ─── Halloween ───────────────────────────────────────────────────────────────────────────────────────────────

const JACK = [
  '.......Hn.......',
  '......Hn........',
  '...ooOOOOOOoo...',
  '..oOOOoOOOoOOo..',
  '.oOOOOoOOOoOOOo.',
  '.oOFFOoOOOoFFOo.',
  'oOFFFOoOOOoFFFOo',
  'oOOOOOoFFOoOOOOo',
  'oOOOOOoOOOoOOOOo',
  'oOFOFFFFFFFFOFOo',
  'oOOFFFFFFFFFFOOo',
  '.oOOFOFFOFFOOOo.',
  '.ooOOOOOOOOOOoo.',
  '...oooooooooo...',
];
/** A carved pumpkin: frame 0 by day (the face dark), frames 1 and 2 lit from inside (the candle flickering). */
function jack(): Sprite {
  // lit, the skin is in the dark (only the face shines) and the face is near white, then a little warmer
  const dark = { O: hex('#d0641c'), o: hex('#8e3a12') };
  return { frames: [rows(JACK, { F: hex('#3a1c10') }), rows(JACK, { ...dark, F: hex('#fff4b0') }), rows(JACK, { ...dark, F: hex('#ffd04a') })].map((p) => done(p)) };
}
/** A plain pumpkin, uncarved (Thanksgiving). */
function pumpkin(): Sprite { return { frames: [done(rows(JACK, { F: PAL.O }))] }; }

const GOURD = [
  '.....nH.....',
  '.....n......',
  '....tTTt....',
  '....TYYT....',
  '...tTYYTt...',
  '...TTYYTT...',
  '..tTTYYTTt..',
  '.tTTTTTTTTt.',
  'tTFFTTTTFFTt',
  'tTFFTTTTFFTt',
  'tTTTTFFTTTTt',
  'tTFTFFFFTFTt',
  'tTTFFFFFFTTt',
  '.tTTTTTTTTt.',
  '..ttttttt...',
];
/** A carved gourd, the old way (the DnD room's jack-o'-lantern): dark by day, lit at night. */
function gourd(): Sprite {
  const dark = { T: hex('#9a7444'), t: hex('#6e4e2a'), Y: hex('#b89a50') };
  return { frames: [rows(GOURD, { F: hex('#3a2410') }), rows(GOURD, { ...dark, F: hex('#fff4b0') }), rows(GOURD, { ...dark, F: hex('#ffd04a') })].map((p) => done(p)) };
}

/** A paper bat on the wall, black with a pale edge so it shows on a dark wall. */
function bat(): Sprite {
  const p = rows([
    'X.....X.X.....X',
    'XX....XXX....XX',
    'XXX..XRXRX..XXX',
    'XXXXXXXXXXXXXXX',
    '.XXXXXXXXXXXXX.',
    '..XX.XXXXX.XX..',
    '......XXX......',
    '.......X.......',
  ]);
  return { frames: [done(p, hex('#8f80b0'))] };
}

/** A cobweb across a corner (the top left; flipped for the other side), and a spider on it on the night itself. */
function cobweb(spider: boolean, grey = false): Sprite {
  // (grey on a light wall: the bathroom's tiles)
  const S = 26, p = pic(S, S + (spider ? 8 : 0)), c = grey ? hex('#7d8396') : hex('#e9ecf6');
  const spokes = [0, 0.3, 0.62, 0.95, 1.25, Math.PI / 2];
  for (const a of spokes) for (let r = 0; r < S; r += 0.5) dot(p, Math.cos(a) * r, Math.sin(a) * r, c, 210);
  for (const R of [7, 13, 19, 25]) {
    for (let k = 0; k < spokes.length - 1; k++) {
      const a0 = spokes[k], a1 = spokes[k + 1];
      for (let t = 0; t <= 1; t += 0.04) {
        const a = a0 + (a1 - a0) * t, sag = Math.sin(Math.PI * t) * R * 0.12;
        dot(p, Math.cos(a) * (R - sag), Math.sin(a) * (R - sag), c, 200);
      }
    }
  }
  if (spider) {
    for (let y = 13; y < S + 1; y++) dot(p, 13, y, c, 200);
    rows(['X.X.X', '.XXX.', 'XXXXX', '.XXX.', 'X.X.X'], {}, p, 11, S + 1);
    dot(p, 12, S + 2, PAL.R); dot(p, 14, S + 2, PAL.R);
  }
  return { frames: [p] };
}

/** A bowl of sweets: a black bowl heaped with wrapped candy. */
function candy(): Sprite {
  return { frames: [done(rows([
    '.....RY.PB.......',
    '...GYRRBYYPRG....',
    '..YRBGPYRGBYRY...',
    '.PGYRYBGRPYGBRP..',
    'XxxxxxxxxxxxxxxxX',
    'XOOOOOOOOOOOOOOOX',
    '.XxxxxxxxxxxxxxX.',
    '..XxxxxxxxxxxxX..',
    '...XXXXXXXXXXX...',
    '.....XxxxxxX.....',
  ], { O: hex('#ff8c26') }))] };
}

/** A sheet ghost hanging from the ceiling (on Halloween night). */
function ghost(): Sprite {
  return { frames: [done(rows([
    '......g......',
    '......g......',
    '....wWWWw....',
    '...wWWWWWw...',
    '..wWWWWWWWw..',
    '..WWXWWWXWW..',
    '..WWXWWWXWW..',
    '..WWWWWWWWW..',
    '.wWWWWXXWWWw.',
    '.WWWWWXXWWWW.',
    '.WWWWWWWWWWW.',
    'wWWWWWWWWWWWw',
    'WWWWWWWWWWWWW',
    'WWWWWWWWWWWWW',
    'WWwWWWwWWwWWW',
    'Ww.wWw.wW.wWw',
    'w...w...w...w',
  ]))] };
}

// ─── Christmas ───────────────────────────────────────────────────────────────────────────────────────────────

const LIGHTS = [PAL.R, PAL.Y, PAL.B, PAL.G, PAL.P, hex('#ffffff')];
/** The tree: three tiers of fir on a red stand, a gold star, baubles, a tinsel swag, and a string of lights that
 *  twinkle (three frames, each light on its own beat; the lights never throw light on anybody). */
function tree(): Sprite {
  const W = 38, H = 60, cx = 19;
  const base = pic(W, H);
  const fir = hex('#2f8f45'), firLo = hex('#1d6233'), firHi = hex('#56b862'), firDeep = hex('#174f2a');
  // the tiers: [top y, bottom y, half width at the bottom]
  const tiers = [[8, 26, 10], [18, 41, 15], [31, 53, 18]];
  for (const [y0, y1, hw] of tiers) {
    for (let y = y0; y <= y1; y++) {
      const t = (y - y0) / (y1 - y0), half = 1 + hw * t;
      for (let x = Math.ceil(cx - half); x <= Math.floor(cx + half); x++) {
        const edge = x - (cx - half), fromRight = cx + half - x;
        // the bottom edge of each tier is ragged (boughs), and the right side is in shade
        const c = y >= y1 - 1 && (x + y) % 3 === 0 ? firDeep : fromRight < 3 ? firLo : edge < 2.5 && y % 2 ? firHi : (x * 7 + y * 3) % 11 === 0 ? firHi : fir;
        dot(base, x, y, c);
      }
    }
  }
  // the trunk and the stand
  for (let y = 54; y <= 55; y++) for (let x = cx - 2; x <= cx + 2; x++) dot(base, x, y, PAL.n);
  rows(['rRRRRRRRRRRr', 'rRRRRRRRRRRr', 'rrrrrrrrrrrr'], {}, base, cx - 6, 56);
  for (let x = cx - 5; x <= cx + 5; x++) dot(base, x, 57, PAL.D);
  // the star
  rows(['...Y...', '...Y...', 'YYYyYYY', '.YYyYY.', '..YYY..', '.YY.YY.', '.Y...Y.'], { y: hex('#fffbe0') }, base, cx - 3, 1);
  // a tinsel swag round each tier
  for (const [y0, y1, hw] of tiers) {
    for (let x = -hw * 0.75; x <= hw * 0.75; x += 0.5) {
      const y = y0 + (y1 - y0) * 0.55 + (x / hw) * (y1 - y0) * 0.35 + Math.sin((x / hw) * 3) * 1;
      const t = (Math.round(y) - y0) / (y1 - y0), half = 1 + hw * t;
      if (Math.abs(x) < half - 1) dot(base, cx + x, y, Math.round(x) % 2 ? PAL.D : PAL.y);
    }
  }
  // baubles, 2 by 2 with a highlight
  const balls: [number, number, RGB][] = [[13, 22, PAL.R], [22, 18, PAL.B], [9, 37, PAL.D], [24, 33, PAL.R], [16, 47, PAL.B], [28, 47, PAL.D], [5, 50, PAL.R], [19, 29, PAL.V]];
  for (const [x, y, c] of balls) { dot(base, x, y, mix(c, [255, 255, 255], 0.5)); dot(base, x + 1, y, c); dot(base, x, y + 1, c); dot(base, x + 1, y + 1, mix(c, INK, 0.35)); }
  // the lights: a string spiralling down; each light lit in some frames, dim in the others
  const lights: [number, number][] = [];
  const r = rng(7);
  for (const [y0, y1, hw] of tiers) for (let k = 0; k < 9; k++) {
    const y = Math.round(y0 + 3 + r() * (y1 - y0 - 4)), t = (y - y0) / (y1 - y0), half = hw * t;
    const x = Math.round(cx - half + 1 + r() * (half * 2 - 2));
    if (!balls.some(([bx, by]) => Math.abs(bx - x) < 2 && Math.abs(by - y) < 2)) lights.push([x, y]);
  }
  const frames = [0, 1, 2].map((f) => {
    const p = pic(W, H); p.px.set(base.px);
    lights.forEach(([x, y], k) => {
      const c = LIGHTS[k % LIGHTS.length], on = (k + f) % 3 !== 0;
      dot(p, x, y, on ? c : mix(c, INK, 0.55));
      if (on && (k + f) % 3 === 1) dot(p, x, y - 1, mix(c, [255, 255, 255], 0.55));
    });
    return done(p);
  });
  return { frames };
}

/** Presents under the tree: boxes in paper of each colour with ribbons and bows. */
function presents(): Sprite {
  const p = pic(40, 18);
  const box = (x: number, y: number, w: number, h: number, paper: RGB, ribbon: RGB) => {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) dot(p, x + i, y + j, j < 3 ? mix(paper, [255, 255, 255], 0.25) : i >= w - 2 ? mix(paper, INK, 0.3) : paper);
    const mx = x + Math.floor(w / 2);
    for (let j = 0; j < h; j++) dot(p, mx, y + j, ribbon);
    for (let i = 0; i < w; i++) dot(p, x + i, y + 1, ribbon);
    rows(['B.B', 'BBB'], { B: ribbon }, p, mx - 1, y - 2);
  };
  box(2, 4, 12, 13, PAL.R, PAL.D);
  box(26, 5, 11, 12, PAL.B, PAL.W);
  box(13, 8, 14, 9, hex('#3fae4a'), PAL.R);
  box(31, 11, 8, 6, PAL.D, PAL.R);
  box(0, 12, 7, 5, PAL.V, PAL.y);
  return { frames: [done(p)] };
}

/** A stocking, in someone's colour, with a white cuff, heel and toe. `colour` as '#rrggbb'. */
export function stocking(colour: string): Sprite {
  const c = hex(colour);
  return { frames: [done(rows([
    'wWWWWWW',
    'WwWwWwW',
    '.SSSSs.',
    '.SSSSs.',
    '.SSSSs.',
    '.SSSSs.',
    '.SSSSs.',
    '.SSSSSs',
    'SSSSSSs',
    'WSSSSSs',
    'WWSSSs.',
    '.WWSS..',
  ], { S: c, s: mix(c, INK, 0.3) }))] };
}

/** A snow globe: a glass ball with a little tree and snow in it, on a red base. */
function snowglobe(): Sprite {
  const p = pic(12, 14), glass = hex('#cfe8ff');
  for (let y = 0; y < 10; y++) for (let x = 0; x < 12; x++) if ((x - 5.5) ** 2 + (y - 5) ** 2 <= 30) dot(p, x, y, glass, 150);
  rows(['..G..', '.GGG.', 'GGGGG', '..n..'], {}, p, 4, 3);
  for (const [x, y] of [[2, 3], [8, 2], [3, 6], [9, 6], [6, 1], [7, 8]]) dot(p, x, y, PAL.W);
  rows(['wwwwwwwwwww', '.RRRRRRRRR.', '.rrrrrrrrr.', 'DDDDDDDDDDD'], {}, p, 0, 9);
  dot(p, 3, 2, PAL.W); dot(p, 3, 1, PAL.W);
  return { frames: [done(p)] };
}

/** The yule log (the DnD room): a birch log with holly and three candles in it, their flames flickering. */
function yulelog(): Sprite {
  const base = rows([
    '.......Y.......Y.......Y......',
    '......WWW.....WWW.....WWW.....',
    '......RRR.....RRR.....RRR.....',
    '......RRR.....RRR.....RRR.....',
    '..wwwwRRRwwwwwRRRwwwwwRRRwwww.',
    '.wWWWWrrrWWXWWrrrWWWWWrrrWWWnw',
    'wWWXWWWWWWWWWWWWWXXWWWWWWWWnTn',
    'wWWWWWWWXXWWHGHWWWWWWWWXWWnTtT',
    'wWWWWWWWWWWHGRGHWWWWWWWWWWnTTt',
    'wqqqXqqqqqqqHRHqqqqqqXqqqqnTtT',
    '.qqqqqqqqqqqqqqqqqqqqqqqqqqnTn',
    '..gggggggggggggggggggggggggnn.',
  ]);
  const frames = [0, 1].map((f) => {
    const p = pic(base.w, base.h); p.px.set(base.px);
    // the flames lean one way, then the other
    for (const x of [7, 15, 23]) { p.px.fill(0, (0 * p.w + x) * 4, (0 * p.w + x) * 4 + 4); dot(p, x + (f ? 1 : -1), 0, PAL.Y); dot(p, x, 1, f ? PAL.y : PAL.Y); }
    return done(p);
  });
  return { frames };
}

// ─── Valentine's, St. Patrick's, Easter, the Fourth, Thanksgiving, New Year's ─────────────────────────────────

/** A paper heart on the wall: `tone` 0 red, 1 pink, 2 pale pink. */
function heart(tone: number): Sprite {
  const [a, b, c] = [[PAL.R, PAL.r, PAL.P], [PAL.P, PAL.p, PAL.L], [PAL.L, PAL.P, PAL.W]][tone];
  return { frames: [done(rows([
    '.AAA...AAA.',
    'AhhAA.AAAAB',
    'AhAAAAAAAAB',
    'AAAAAAAAAAB',
    'AAAAAAAAAAB',
    '.AAAAAAAAB.',
    '..AAAAAAB..',
    '...AAAAB...',
    '....AAB....',
    '.....B.....',
  ], { A: a, B: b, h: c }))] };
}

/** A heart-shaped box of chocolates, open, the lid stood up behind it. */
function chocolates(): Sprite {
  return { frames: [done(rows([
    '..rRRRr...rRRRr...',
    '.rRRRRRr.rRRRRRr..',
    'rRRWRRRRrRRRRRRRr.',
    'rRWRRRRRRRRRRRRRr.',
    'rRRRRRRRRRRRRRRRr.',
    'rrrrrrrrrrrrrrrrr.',
    'rDDDDDDDDDDDDDDDr.',
    'rDnNDnNDnNDnNDnDr.',
    '.rDNnDNnDNnDNnDr..',
    '..rDnNDnNDnNDnr...',
    '...rDDNnDNnDDr....',
    '.....rDDDDDr......',
    '.......rrr........',
  ]))] };
}

/** A shamrock. */
function shamrock(): Sprite {
  return { frames: [done(rows([
    '...GGG...',
    '..GJGGG..',
    '..GGGGG..',
    'GGG.G.GGG',
    'GJGGjGGGj',
    'GGGGjGGGj',
    '.GGjHjGj.',
    '....H....',
    '...H.....',
    '..H......',
  ]))] };
}

/** A pot of gold: a black pot heaped with coins. */
function potofgold(): Sprite {
  return { frames: [done(rows([
    '......yDY.........',
    '....DYDdDYD.yD....',
    '..DYdDYDdYDDYdDY..',
    '.DdYDDdYDYdDDYDdD.',
    'xXXXXXXXXXXXXXXXXx',
    'XxxxxxxxxxxxxxxxxX',
    '.XxwxxxxxxxxxxxxX.',
    '.XxwxxxxxxxxxxxxX.',
    '.XxxxxxxxxxxxxxxX.',
    '..XxxxxxxxxxxxxX..',
    '...XXXXXXXXXXXX...',
    '...X..........X...',
  ]))] };
}

const EGGS: [string, string][] = [['#ffb8d6', '#ff7fb0'], ['#fff09a', '#ffb93a'], ['#a8d8ff', '#5f9cf0'], ['#b8f0cf', '#4fc286'], ['#d9c4ff', '#9a72e8']];
/** A painted egg, pastel with a zigzag band: `n` picks the colours. */
function egg(n: number): Sprite {
  const [a, b] = EGGS[n % EGGS.length].map(hex);
  return { frames: [done(rows([
    '..AAA..',
    '.AhAAA.',
    'AhAAAAA',
    'BABABAB',
    'ABABABA',
    'AAAAAAA',
    'CCCCCCC',
    '.AAAAA.',
    '..AAA..',
  ], { A: a, B: b, C: b, h: PAL.W }))] };
}

/** An Easter basket: woven, with a handle, grass and eggs in it. */
function basket(): Sprite {
  return { frames: [done(rows([
    '.......tTTTTTTt.......',
    '.....tT.......Tt......',
    '....tT.........Tt.....',
    '....T...........T.....',
    '...tT..PP...CC..Tt....',
    '..JJTJPLPPJJCMCJTJJ...',
    '.JGJGJPPPJGJCCCJGJGJ..',
    'tTTTTTTTTTTTTTTTTTTTTt',
    'tTtTtTtTtTtTtTtTtTtTtt',
    'tTTTTTTTTTTTTTTTTTTTTt',
    '.tTtTtTtTtTtTtTtTtTtt.',
    '.tTTTTTTTTTTTTTTTTTTt.',
    '..tTtTtTtTtTtTtTtTtt..',
    '...tttttttttttttttt...',
  ], { M: hex('#5f9cf0') }))] };
}

/** A bunny figure, sitting up: white, pink in the ears, a pink nose. */
function bunny(): Sprite {
  return { frames: [done(rows([
    '..WW..WW....',
    '..WP..WP....',
    '..WP..WP....',
    '..WP..WP....',
    '..WW..WW....',
    '.WWWWWWWW...',
    'WWXWWWWXWW..',
    'WWWWPPWWWW..',
    'WWWWwwWWWw..',
    '.wWWWWWWw...',
    '..WWWWWWW...',
    '.WWWWWWWWW..',
    'WWWWWWWWWWW.',
    'WWwWWWWWwWWW',
    'WWWWWWWWWWWW',
    'WWWwwwwwWWWW',
    '.WWW.qq.WWWq',
    '..qq....qq..',
  ]))] };
}

/** A little stand of three US flags on sticks. */
function flags(): Sprite {
  const flag = ['bbbRRRR', 'bWbWWWW', 'bbbRRRR', 'WWWWWWW', 'RRRRRRR', 'WWWWWWW'];
  const p = pic(20, 22);
  rows(flag, {}, p, 1, 0); rows(flag, {}, p, 7, 3); rows(flag, {}, p, 12, 1);
  for (let y = 0; y < 16; y++) { dot(p, 1, y, PAL.g); }
  for (let y = 3; y < 16; y++) dot(p, 7, y, PAL.g);
  for (let y = 1; y < 16; y++) dot(p, 12, y, PAL.g);
  // the cup they stand in
  rows(['..nNNNNNNNNNn..', '..NTTTTTTTTTN..', '...NTTTTTTTN...', '...NTTTTTTTN...', '....nnnnnnn....'], {}, p, -1, 15);
  return { frames: [done(p)] };
}

/** A cornucopia: a wicker horn spilling a pumpkin, apples, grapes, corn and leaves. */
function cornucopia(): Sprite {
  return { frames: [done(rows([
    '..............................',
    '.........tTTTt.....J..........',
    '.....ttTTTtTTTTt..JJ.YY.......',
    '..tTTTtTTTTtTTTTTt..YyYY......',
    '.tTn..tTTTTtTTTTTTt.YyYYoOOo..',
    'tTn....tTTTTtTTTTTTOOOOOOOOOOo',
    'Tn......tTTTTtTTTTOOOoOOOOoOOo',
    '.........tTTTTtTTTOOOoOOOOoOOo',
    '..........tTTTTtTVVROOoOOOOoOo',
    '...........tTTTTVVVRRoOOOOoOo.',
    '............tTTtVVrRROO.ooOo..',
    '..............tt.VV.RrGG.Hjj..',
    '...................oGGJjj.....',
  ]))] };
}

/** Party hats for New Year's: three cones, striped, with pompoms, and a horn. */
function partyhats(): Sprite {
  const hat = (c: RGB, s: RGB) => rows([
    '..W..', '..A..', '.AB..', '.ABA.', '.BAB.', 'ABABA', 'BABAB', 'AAAAA',
  ], { A: c, B: s });
  const p = pic(26, 11);
  const draw = (src: Pic, ox: number, oy: number) => { for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) if (solid(src, x, y)) dot(p, ox + x, oy + y, at(src, x, y)); };
  draw(hat(PAL.D, PAL.b), 1, 2);
  draw(hat(PAL.P, PAL.W), 8, 0);
  draw(hat(PAL.B, PAL.Y), 15, 3);
  rows(['YYYYYRY', '.....RR'], {}, p, 19, 9);
  return { frames: [done(p)] };
}

/** Confetti on the floor, and a few curls of streamer: no outline, it lies flat. */
function confetti(): Sprite {
  const W = 60, H = 22, p = pic(W, H), r = rng(31);
  const colours = [PAL.R, PAL.Y, PAL.B, PAL.G, PAL.P, PAL.V, PAL.W, PAL.D, PAL.C];
  for (let k = 0; k < 120; k++) {
    // thicker towards the middle of the patch
    const x = W / 2 + (r() - 0.5) * W * (0.4 + 0.6 * r()), y = H / 2 + (r() - 0.5) * H * (0.4 + 0.6 * r()), c = colours[k % colours.length];
    dot(p, x, y, c); if (k % 3) dot(p, x + 1, y, mix(c, INK, 0.2)); else dot(p, x, y + 1, mix(c, INK, 0.2));
  }
  for (const [x0, y0, c] of [[8, 6, PAL.P], [40, 14, PAL.Y], [26, 3, PAL.B]] as [number, number, RGB][]) {
    for (let t = 0; t < 14; t += 0.25) dot(p, x0 + t, y0 + Math.sin(t * 1.1) * 2, c);
  }
  return { frames: [p] };
}

/** Balloons for New Year's: gold, silver and black, on strings. */
function balloons(): Sprite {
  const p = pic(20, 30);
  const ball = (cx: number, cy: number, c: RGB) => {
    for (let y = -5; y <= 5; y++) for (let x = -4; x <= 4; x++) if ((x / 4.4) ** 2 + (y / 5.4) ** 2 <= 1) dot(p, cx + x, cy + y, x >= 2 && y >= 1 ? mix(c, INK, 0.3) : c);
    dot(p, cx - 2, cy - 3, mix(c, [255, 255, 255], 0.7)); dot(p, cx - 2, cy - 2, mix(c, [255, 255, 255], 0.5));
    dot(p, cx, cy + 6, mix(c, INK, 0.3));
  };
  ball(5, 6, PAL.D); ball(14, 8, PAL.q); ball(9, 13, hex('#3a3050'));
  for (const [x0, y0] of [[5, 13], [14, 15], [9, 20]]) for (let y = y0; y < 29; y++) dot(p, x0 + Math.round((y - y0) * (10 - x0) / (29 - y0)), y, PAL.g);
  return { frames: [done(p)] };
}

// A tiny pixel font for the banner: 3 wide, 5 high.
const FONT: Record<string, string[]> = {
  H: ['#.#', '#.#', '###', '#.#', '#.#'], A: ['.#.', '#.#', '###', '#.#', '#.#'], P: ['##.', '#.#', '##.', '#..', '#..'],
  Y: ['#.#', '#.#', '.#.', '.#.', '.#.'], N: ['#..#', '##.#', '#.##', '#..#', '#..#'], E: ['###', '#..', '##.', '#..', '###'],
  W: ['#...#', '#...#', '#.#.#', '#.#.#', '.#.#.'], R: ['##.', '#.#', '##.', '#.#', '#.#'],
};
/** The banner: HAPPY NEW YEAR in white on a black and gold banner with forked ends. */
function banner(): Sprite {
  const text = 'HAPPY NEW YEAR';
  const widths = [...text].map((ch) => (ch === ' ' ? 2 : FONT[ch][0].length));
  const tw = widths.reduce((a, b) => a + b + 1, -1), W = tw + 14, H = 11;
  const p = pic(W, H);
  for (let y = 1; y < H - 1; y++) for (let x = 4; x < W - 4; x++) dot(p, x, y, y === 1 || y === H - 2 ? PAL.D : hex('#1c1630'));
  // the forked ends, tied back
  for (let y = 2; y < H - 2; y++) { const k = Math.abs(y - (H - 1) / 2); for (let x = Math.round(k * 0.6); x < 4; x++) { dot(p, x, y, PAL.d); dot(p, W - 1 - x, y, PAL.d); } }
  let x = 7;
  [...text].forEach((ch, i) => {
    if (ch !== ' ') FONT[ch].forEach((line, j) => [...line].forEach((c, k) => { if (c === '#') dot(p, x + k, 3 + j, i % 2 ? PAL.y : PAL.W); }));
    x += widths[i] + 1;
  });
  return { frames: [done(p)] };
}

/** Streamers hanging from the ceiling, twisted, in party colours (New Year's). */
function streamers(): Sprite {
  const W = 30, H = 16, p = pic(W, H);
  const cols = [PAL.D, PAL.B, PAL.P, PAL.q, PAL.V];
  // a swag across the top, and ribbons hanging from it
  for (let x = 0; x < W; x++) { const y = 1 + Math.sin((x / W) * Math.PI) * 3; dot(p, x, y, PAL.D); dot(p, x, y + 1, PAL.d); }
  [[3, 12], [9, 15], [15, 10], [21, 14], [27, 11]].forEach(([x0, len], k) => {
    const c = cols[k % cols.length], top = 2 + Math.round(Math.sin((x0 / W) * Math.PI) * 3);
    for (let y = top; y < len; y++) { const w = Math.round(Math.sin(y * 0.8 + k) * 1.2); dot(p, x0 + w, y, c); dot(p, x0 + w + 1, y, mix(c, INK, Math.abs(w) ? 0.35 : 0.1)); }
  });
  return { frames: [p], tile: true };
}

// ─── Garlands (drawn along a wall, repeated) ────────────────────────────────────────────────────────────────

/** A garland tile: what hangs on the string, every `step` dots, and how deep the string sags. Two frames when
 *  `twinkle` (the Christmas lights). */
function garland(kind: string): Sprite {
  const W = 24, H = kind === 'xmas' || kind === 'holly' ? 10 : 12;
  const sag = (x: number) => 1 + Math.sin((x / W) * Math.PI) * 2.5;
  const make = (f: number) => {
    const p = pic(W, H);
    if (kind === 'xmas' || kind === 'holly') {
      // a thick fir rope with lights (or, for the DnD room, holly and berries)
      for (let x = 0; x < W; x++) {
        const y = sag(x);
        for (let d = 0; d < 4; d++) dot(p, x, y + d, (x * 3 + d * 5) % 7 === 0 ? hex('#56b862') : d === 3 ? hex('#1d6233') : hex('#2f8f45'));
      }
      if (kind === 'xmas') {
        [[3, PAL.R], [9, PAL.Y], [15, PAL.B], [21, PAL.G]].forEach(([x, c], k) => {
          const y = Math.round(sag(x as number)) + 4, on = (k + f) % 2 === 0;
          const cc = on ? (c as RGB) : mix(c as RGB, INK, 0.5);
          dot(p, x as number, y, PAL.x); dot(p, x as number, y + 1, cc); dot(p, (x as number) + 1, y + 1, cc); dot(p, x as number, y + 2, cc); dot(p, (x as number) + 1, y + 2, mix(cc, INK, 0.2));
          if (on) dot(p, x as number, y + 1, mix(c as RGB, [255, 255, 255], 0.5));
        });
      } else {
        for (const x of [4, 12, 20]) { const y = Math.round(sag(x)) + 1; rows(['HG.GH', '.HGH.', '..R..', '.RR..'], {}, p, x - 2, y); }
      }
      return p;
    }
    // a string, sagging, with things hung on it
    for (let x = 0; x < W; x++) dot(p, x, sag(x), kind === 'autumn' ? PAL.n : PAL.g);
    const hang = (x: number, lines: string[], swap: Record<string, RGB> = {}) => rows(lines, swap, p, x, Math.round(sag(x + 2)));
    if (kind === 'valentine') { hang(2, ['PP.PP', 'PPPPP', '.PPP.', '..P..'], { P: PAL.P }); hang(14, ['RR.RR', 'RRRRR', '.RRR.', '..R..'], { R: PAL.R }); }
    if (kind === 'stpatrick') { for (const x of [3, 15]) hang(x, ['.G.G.', 'GGGGG', '.GGG.', 'GG.GG', '..H..', '..H..']); }
    if (kind === 'pennants' || kind === 'july4' || kind === 'halloween' || kind === 'easter') {
      const cs = kind === 'july4' ? [PAL.R, PAL.W, PAL.B] : kind === 'halloween' ? [PAL.O, PAL.X, PAL.V] : kind === 'easter' ? [hex('#ffb8d6'), hex('#fff09a'), hex('#a8d8ff')] : [PAL.R, PAL.D, PAL.B];
      cs.forEach((c, k) => {
        const x0 = 1 + k * 8, y0 = Math.round(sag(x0 + 3));
        for (let j = 0; j < 7; j++) for (let i = j >> 1; i < 7 - (j >> 1); i++) dot(p, x0 + i, y0 + j, i === j >> 1 ? mix(c, INK, 0.25) : c);
        if (kind === 'halloween' && k === 1) dot(p, x0 + 3, y0 + 2, PAL.O);
        if (kind === 'july4' && k === 1) dot(p, x0 + 3, y0 + 2, PAL.R);
      });
    }
    if (kind === 'autumn') {
      const leaf = ['.A.', 'AAA', 'ABA', '.B.'];
      [[1, PAL.O], [7, PAL.R], [13, PAL.Y], [19, PAL.o]].forEach(([x, c]) => hang(x as number, leaf, { A: c as RGB, B: PAL.n }));
    }
    return p;
  };
  const frames = kind === 'xmas' ? [make(0), make(1)] : [make(0)];
  return { frames, tile: true };
}

/** The fan of pleated bunting for the Fourth, hung on a wall or the front of a counter. */
function fan(): Sprite {
  const W = 28, H = 14, p = pic(W, H), cx = 13.5;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = x - cx, dy = y + 0.5, r = Math.hypot(dx, dy * 2);
    if (r > 14) continue;
    const band = r < 4 ? 'b' : Math.floor((r - 4) / 3.4) % 2 ? 'W' : 'R';
    const pleat = Math.abs(Math.round(Math.atan2(dy, dx) * 6)) % 2 === 1;
    let c = PAL[band];
    if (pleat) c = mix(c, INK, 0.15);
    dot(p, x, y, c);
  }
  dot(p, 12, 1, PAL.W); dot(p, 15, 1, PAL.W); dot(p, 13, 2, PAL.W);
  return { frames: [done(p)] };
}

/** Every sprite, by name. */
const MAKERS: Record<string, () => Sprite> = {
  jack, pumpkin, gourd, bat, web: () => cobweb(false), webspider: () => cobweb(true), webgrey: () => cobweb(false, true), webgreyspider: () => cobweb(true, true), candy, ghost,
  tree, presents, snowglobe, yulelog,
  heart0: () => heart(0), heart1: () => heart(1), heart2: () => heart(2), chocolates,
  shamrock, potofgold,
  egg0: () => egg(0), egg1: () => egg(1), egg2: () => egg(2), egg3: () => egg(3), egg4: () => egg(4), basket, bunny,
  flags, fan, cornucopia, partyhats, confetti, balloons, banner, streamers,
  'g-xmas': () => garland('xmas'), 'g-holly': () => garland('holly'), 'g-valentine': () => garland('valentine'),
  'g-stpatrick': () => garland('stpatrick'), 'g-july4': () => garland('july4'), 'g-halloween': () => garland('halloween'),
  'g-easter': () => garland('easter'), 'g-autumn': () => garland('autumn'), 'g-pennants': () => garland('pennants'),
};
export const SPRITE_NAMES = Object.keys(MAKERS);
const made = new Map<string, Sprite>();
/** A sprite by name (drawn once, then kept). Names starting 'stocking:' take a colour: 'stocking:#ff8800'. */
export function sprite(name: string): Sprite {
  let s = made.get(name);
  if (!s) made.set(name, (s = name.startsWith('stocking:') ? stocking(name.slice(9)) : MAKERS[name]()));
  return s;
}
