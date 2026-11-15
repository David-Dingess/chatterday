// Pictures of what the character builder can make, for checking the art by eye and for the docs.
//
//     node scripts/preview-looks.mjs
//
// writes art/looks-preview.png (two dozen random characters in six poses) and art/look-parts-preview.png (every
// choice of every part on a plain character). For a closer look at one thing:
//
//     node scripts/preview-looks.mjs part hair 0 12 out.png [skin=#52301f] [hair=#1d1a20] [views=sit_side.0,gaming.2]
//     node scripts/preview-looks.mjs looks 0 8 out.png
//     node scripts/preview-looks.mjs sheet out.png 1234            (every frame of random look 1234)
//     node scripts/preview-looks.mjs sheet out.png '{"hair":{"style":"long","color":"#553828"}}'
//     node scripts/preview-looks.mjs shower out.png 1234           (the same, from the sheet for the shower)
//
// No packages needed: the PNG is written here with node:zlib.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SPRITE_ROWS, SPRITE_UP, drawFrame, drawNudeSheet } from '../client/src/draw/avatar.ts';
import { DEFAULT_LOOK, LOOK_OPTIONS, cleanLook, randomLook } from '../shared/look.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const BG = [44, 47, 62], BAND = [52, 56, 73], INK = [214, 218, 236], DIM = [140, 146, 172];
const F = 48, CH = F + SPRITE_UP;       // a frame is F by F, in a cell CH tall: the headroom over it is where a party hat or a jump goes

// ── a PNG, by hand ──
const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc(buf) { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0); out.write(type, 4, 'ascii'); data.copy(out, 8);
  out.writeUInt32BE(crc(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
function png(w, h, rgba) {
  const head = Buffer.alloc(13);
  head.writeUInt32BE(w, 0); head.writeUInt32BE(h, 4); head[8] = 8; head[9] = 6;         // 8 bits a channel, RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// ── a board to lay frames out on, with a tiny 3-by-5 alphabet for the labels ──
const GLYPHS = {
  a: '010101111101101', b: '110101110101110', c: '011100100100011', d: '110101101101110', e: '111100110100111', f: '111100110100100', g: '011100101101011',
  h: '101101111101101', i: '111010010010111', j: '001001001101010', k: '101101110101101', l: '100100100100111', m: '101111111101101', n: '110101101101101',
  o: '010101101101010', p: '110101110100100', q: '010101101011001', r: '110101110101101', s: '011100010001110', t: '111010010010010', u: '101101101101111',
  v: '101101101101010', w: '101101111111101', x: '101101010101101', y: '101101010010010', z: '111001010100111',
  0: '111101101101111', 1: '010110010010111', 2: '111001111100111', 3: '111001111001111', 4: '101101111001001', 5: '111100111001111', 6: '111100111101111',
  7: '111001001010010', 8: '111101111101111', 9: '111101111001111', '-': '000000111000000', '#': '101111101111101', '.': '000000000000010', ',': '000000000010100',
};
class Board {
  constructor(w, h) { this.w = w; this.h = h; this.a = new Uint8ClampedArray(w * h * 4); this.fill(0, 0, w, h, BG); }
  fill(x0, y0, w, h, c) {
    for (let y = Math.max(0, y0); y < Math.min(this.h, y0 + h); y++) for (let x = Math.max(0, x0); x < Math.min(this.w, x0 + w); x++) {
      const i = (y * this.w + x) * 4; this.a[i] = c[0]; this.a[i + 1] = c[1]; this.a[i + 2] = c[2]; this.a[i + 3] = 255;
    }
  }
  /** A frame, each dot k by k. */
  blit(pic, ox, oy, k) {
    for (let y = 0; y < pic.h; y++) for (let x = 0; x < pic.w; x++) {
      const i = (y * pic.w + x) * 4;
      if (pic.data[i + 3]) this.fill(ox + x * k, oy + y * k, k, k, pic.data.subarray(i, i + 3));
    }
  }
  text(s, x, y, c = INK, k = 2) {
    for (const ch of String(s).toLowerCase()) {
      const g = GLYPHS[ch];
      if (g) for (let i = 0; i < 15; i++) if (g[i] === '1') this.fill(x + (i % 3) * k, y + Math.floor(i / 3) * k, k, k, c);
      x += 4 * k;
    }
  }
  save(path) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, png(this.w, this.h, this.a));
    console.log('wrote', path, `${this.w}x${this.h}`);
  }
}

const ACCENTS = ['#8b6be0', '#3fbf63', '#ff8f2e', '#ff6fb7', '#3b82f6', '#e5484d', '#2bb3a3', '#f4d03f'];
const FRONT = ['idle', 0], SIDE = ['walk_left', 1], BACK = ['walk_up', 1];
const POSES = [FRONT, SIDE, BACK, ['sit_front', 0], ['gaming', 0], ['sleep', 0]];

// ── two dozen random characters ──
function looksBoard(from, count, k = 3, perRow = 2) {
  const cell = F * k, tall = CH * k, rows = Math.ceil(count / perRow);
  const b = new Board(perRow * POSES.length * cell + (perRow - 1) * 12, rows * tall);
  for (let n = 0; n < count; n++) {
    const seed = from + n, look = randomLook(seed), accent = ACCENTS[seed % ACCENTS.length];
    const ox = (n % perRow) * (POSES.length * cell + 12), oy = Math.floor(n / perRow) * tall;
    if (Math.floor(n / perRow) % 2) b.fill(ox, oy, POSES.length * cell, tall, BAND);
    POSES.forEach(([row, i], j) => b.blit(drawFrame(look, accent, row, i), ox + j * cell, oy, k));
    b.text(String(seed), ox + 3, oy + 3, DIM);
  }
  return b;
}

// ── every choice of every part ──
// A plain character to show parts on. Short hair and a plain top, so the part is what stands out.
const PLAIN = cleanLook({ ...DEFAULT_LOOK, hair: { style: 'crop', color: '#6f4831' }, facial: { style: 'none', color: '#6f4831' }, top: { kind: 'tee', color: '#6f9ad2', pattern: 'plain', color2: '#f3f0e8' } });
const O = LOOK_OPTIONS;
const SECTIONS = {
  body: { views: [FRONT, SIDE], items: O.body.map((o) => [o, { body: o.id }]) },
  height: { views: [FRONT], items: O.height.map((o) => [o, { height: o.id }]) },
  skin: { views: [FRONT, SIDE], items: O.skinColors.map((c) => [{ id: c, label: c }, { skin: c, hair: { style: 'crop', color: '#2e2228' } }]) },
  eyes: { views: [FRONT, SIDE], items: O.eyes.map((o) => [o, { eyes: o.id, eyeColor: '#3f7fbf' }]) },
  brows: { views: [FRONT, SIDE], items: O.brows.map((o) => [o, { brows: o.id }]) },
  mouth: { views: [FRONT, SIDE], items: O.mouth.map((o) => [o, { mouth: o.id }]) },
  marks: { views: [FRONT, SIDE], items: O.marks.map((o) => [o, { marks: o.id }]) },
  hair: { views: [FRONT, SIDE, BACK], items: O.hair.map((o) => [o, { hair: { style: o.id } }]) },
  facial: { views: [FRONT, SIDE], items: O.facial.map((o) => [o, { facial: { style: o.id } }]) },
  hat: { views: [FRONT, SIDE, BACK], items: O.hat.map((o) => [o, { hat: { kind: o.id, color: '#d8473f' } }]) },
  glasses: { views: [FRONT, SIDE], items: O.glasses.map((o) => [o, { glasses: o.id }]) },
  top: { views: [FRONT, SIDE, BACK], items: O.top.map((o) => [o, { top: { kind: o.id } }]) },
  pattern: { views: [FRONT, BACK], items: O.pattern.map((o) => [o, { top: { pattern: o.id, color: '#2a9d8f', color2: '#f4d03f' } }]) },
  bottom: { views: [FRONT, SIDE, ['sit_front', 0]], items: O.bottom.map((o) => [o, { bottom: { kind: o.id, color: '#3f5078' } }]) },
  shoes: { views: [FRONT, SIDE], items: O.shoes.map((o) => [o, { shoes: { kind: o.id, color: '#d8473f' }, bottom: { kind: 'shorts' } }]) },
  extras: { views: [FRONT, SIDE, BACK], items: O.extras.map((o) => [o, { extras: [o.id] }]) },
};
/** The plain character with one thing changed. Nested parts (hair, top, ...) keep their other fields. */
function withPart(base, change) {
  const out = { ...base };
  for (const [key, v] of Object.entries(change)) out[key] = v && typeof v === 'object' && !Array.isArray(v) ? { ...base[key], ...v } : v;
  return cleanLook(out);
}
function sectionRows(name, base, from = 0, count = Infinity, across = 12) {
  const sec = SECTIONS[name], rows = [[]];
  let used = 0;
  for (const [opt, change] of sec.items.slice(from, from + count)) {
    if (used + sec.views.length > across) { rows.push([]); used = 0; }
    rows[rows.length - 1].push({ label: opt.label, id: opt.id, look: withPart(base, change), views: sec.views });
    used += sec.views.length;
  }
  return rows;
}
function partsBoard(names, base, from, count, k = 3, across = 12) {
  const cell = F * k, tall = CH * k, labelH = 14, headH = 22;
  const blocks = names.map((name) => ({ name, rows: sectionRows(name, base, from, count, across) }));
  const height = blocks.reduce((h, bl) => h + headH + bl.rows.length * (tall + labelH), 0);
  const b = new Board(across * cell, height);
  let y = 0;
  for (const bl of blocks) {
    b.fill(0, y, b.w, headH, BAND);
    b.text(bl.name, 6, y + 6, INK, 2);
    y += headH;
    for (const row of bl.rows) {
      let x = 0;
      for (const item of row) {
        item.views.forEach(([r, i], j) => b.blit(drawFrame(item.look, '#8b6be0', r, i), x + j * cell, y, k));
        b.text(item.label, x + 4, y + tall + 2, DIM, 2);
        x += item.views.length * cell;
      }
      y += tall + labelH;
    }
  }
  return b;
}

/** Every frame of one character: the rows in two blocks, side by side. `nude` is the sheet for the shower instead. */
function sheetBoard(look, accent, k = 3, nude = false) {
  const cell = F * k, tall = CH * k, half = Math.ceil(SPRITE_ROWS.length / 2), b = new Board(8 * cell + 12, half * tall);
  const bare = nude ? drawNudeSheet(look, accent) : null;
  /** One cell cut from a whole sheet. */
  const cut = (pic, r, i) => {
    const data = new Uint8ClampedArray(F * CH * 4);
    for (let y = 0; y < CH; y++) data.set(pic.data.subarray(((r * CH + y) * pic.w + i * F) * 4, ((r * CH + y) * pic.w + (i + 1) * F) * 4), y * F * 4);
    return { w: F, h: CH, data };
  };
  SPRITE_ROWS.forEach((row, r) => {
    const ox = r < half ? 0 : 4 * cell + 12, oy = (r % half) * tall;
    if (r % 2) b.fill(ox, oy, 4 * cell, tall, BAND);
    for (let i = 0; i < 4; i++) {
      const f = row === 'idle' && i === 1 ? 5 : i;                            // one talking frame, to see the mouth
      b.blit(bare ? cut(bare, r, f) : drawFrame(look, accent, row, f), ox + i * cell, oy, k);
    }
    b.text(row, ox + 3, oy + 3, DIM);
  });
  return b;
}

const [mode, ...args] = process.argv.slice(2);
const overrides = (list) => {
  const base = { ...PLAIN };
  for (const kv of list) {
    const [key, v] = kv.split('=');
    if (key === 'skin') base.skin = v;
    else if (key === 'hair') { base.hair = { ...base.hair, color: v }; base.facial = { ...base.facial, color: v }; }
    else if (key === 'style') base.hair = { ...base.hair, style: v };
    else if (key === 'hat') base.hat = { kind: v, color: '#d8473f' };
    else if (key === 'body') base.body = v;
    else if (key === 'height') base.height = v;
    else if (key === 'top') base.top = { ...base.top, kind: v };
    else if (key === 'extras') base.extras = v.split(',');
  }
  return cleanLook(base);
};
if (mode === 'part') {
  const [name, from, count, out, ...rest] = args;
  const names = name.split(',');
  const poses = rest.find((kv) => kv.startsWith('views='));                  // e.g. views=sit_side.0,gaming.2,sleep.2
  if (poses) for (const n of names) SECTIONS[n].views = poses.slice(6).split(',').map((v) => [v.split('.')[0], Number(v.split('.')[1] ?? 0)]);
  partsBoard(names, overrides(rest), Number(from), Number(count), 3, SECTIONS[names[0]].views.length * (SECTIONS[names[0]].views.length > 4 ? 2 : 3)).save(resolve(out));
} else if (mode === 'looks') {
  looksBoard(Number(args[0]), Number(args[1])).save(resolve(args[2]));
} else if (mode === 'sheet') {
  const what = args[1] ?? '1';
  const look = /^\d+$/.test(what) ? randomLook(Number(what)) : withPart(PLAIN, JSON.parse(what));
  sheetBoard(look, args[2] ?? '#8b6be0').save(resolve(args[0]));
} else if (mode === 'shower') {
  const what = args[1] ?? '1';
  const look = /^\d+$/.test(what) ? randomLook(Number(what)) : withPart(PLAIN, JSON.parse(what));
  sheetBoard(look, args[2] ?? '#8b6be0', 3, true).save(resolve(args[0]));
} else {
  looksBoard(1, 24).save(join(root, 'art', 'looks-preview.png'));
  partsBoard(Object.keys(SECTIONS), PLAIN, 0, Infinity).save(join(root, 'art', 'look-parts-preview.png'));
}
