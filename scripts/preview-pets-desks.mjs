// Draws two big pictures for looking over the pets and desks by eye:
//
//     node scripts/preview-pets-desks.mjs
//
// art/pets-preview.png   some random pets, then one of every choice for cats and for dogs (all seven rows each)
// art/desks-preview.png  the desk with every thing that can stand on it, in every colour of light
//
// Needs nothing installed: the drawing code is the same code the app runs, and the PNG writer is below.

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { drawPetSheet } from '../client/src/draw/pet.ts';
import { drawDesk } from '../client/src/draw/desk.ts';
import { DEFAULT_DOG, DEFAULT_PET, PET_OPTIONS, randomPet } from '../shared/pet.ts';
import { DEFAULT_DESK, DESK_OPTIONS } from '../shared/desk.ts';

// ───────────────────────── a tiny PNG writer ─────────────────────────

const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
/** RGBA dots to a PNG file's bytes. */
export function encodePng(w, h, rgba) {
  const head = Buffer.alloc(13);
  head.writeUInt32BE(w, 0); head.writeUInt32BE(h, 4);
  head[8] = 8; head[9] = 6;                       // 8 bits a channel, RGBA
  const lines = Buffer.alloc((w * 4 + 1) * h);    // each row starts with a 0: "no filter"
  for (let y = 0; y < h; y++) Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(lines, y * (w * 4 + 1) + 1);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', deflateSync(lines, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// ───────────────────────── a board to lay pictures out on ─────────────────────────

const FONT = {
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110', E: '111100110100111', F: '111100110100100',
  G: '011100101101011', H: '101101111101101', I: '111010010010111', J: '001001001101010', K: '101101110101101', L: '100100100100111',
  M: '101111111101101', N: '110101101101101', O: '010101101101010', P: '110101110100100', Q: '010101101111011', R: '110101110101101',
  S: '011100010001110', T: '111010010010010', U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101',
  Y: '101101010010010', Z: '111001010100111', 0: '111101101101111', 1: '010110010010111', 2: '110001010100111', 3: '110001010001110',
  4: '101101111001001', 5: '111100110001110', 6: '011100110101010', 7: '111001010010010', 8: '010101010101010', 9: '010101011001110',
  '-': '000000111000000', '+': '000010111010000', '.': '000000000000010', '/': '001001010100100', ':': '000010000010000', ',': '000000000010100',
};

export class Board {
  constructor(w, h, bg = [120, 92, 66]) {
    this.w = w; this.h = h; this.data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) this.data.set([bg[0], bg[1], bg[2], 255], i * 4);
  }
  box(x0, y0, w, h, col) {
    for (let y = Math.max(0, y0); y < Math.min(this.h, y0 + h); y++) for (let x = Math.max(0, x0); x < Math.min(this.w, x0 + w); x++) this.data.set([col[0], col[1], col[2], 255], (y * this.w + x) * 4);
  }
  /** Puts a picture ({ w, h, data }) on the board, each dot `k` across. Clear dots let the board show. */
  put(pic, ox, oy, k = 4) {
    for (let y = 0; y < pic.h; y++) for (let x = 0; x < pic.w; x++) {
      const i = (y * pic.w + x) * 4;
      if (pic.data[i + 3]) this.box(ox + x * k, oy + y * k, k, k, [pic.data[i], pic.data[i + 1], pic.data[i + 2]]);
    }
  }
  text(s, ox, oy, col = [255, 244, 220], k = 2) {
    let x = ox;
    for (const ch of String(s).toUpperCase()) {
      const g = FONT[ch];
      if (g) for (let j = 0; j < 5; j++) for (let i = 0; i < 3; i++) if (g[j * 3 + i] === '1') this.box(x + i * k, oy + j * k, k, k, col);
      x += 4 * k;
    }
  }
  png() { return encodePng(this.w, this.h, this.data); }
}

// ───────────────────────── the pets ─────────────────────────

/** The pets to show, each with a label: random ones first, then every choice once for each kind. */
export function petsToShow() {
  const list = [];
  for (let n = 1; n <= 20; n++) { const p = randomPet(n * 7919); list.push([`random ${n}: ${p.kind} ${p.pattern}`, p]); }
  for (const kind of ['cat', 'dog']) {
    const base = kind === 'cat' ? { ...DEFAULT_PET, pattern: 'solid', coat: '#d98a3d' } : { ...DEFAULT_DOG, pattern: 'solid', collar: 'none' };
    const second = { patches: '#d98a3d', tortie: '#d98a3d', point: '#4a3327', saddle: '#2b2c36', tricolour: '#2b2c36', patch: '#4a3327', spots: '#2b2c36' };
    const first = { patches: '#f6f5f1', tortie: '#2b2c36', point: '#ead8b0', spots: kind === 'dog' ? '#f6f5f1' : '#e0b060', tuxedo: '#2b2c36', mask: '#4d4f5c', tabby: '#9c8a76', tabbywhite: '#a3a7b1' };
    for (const o of PET_OPTIONS[kind].pattern) list.push([`${kind} pattern ${o.id}`, { ...base, pattern: o.id, coat: first[o.id] ?? base.coat, coat2: second[o.id] ?? '#f6f5f1' }]);
    for (const part of ['build', 'fur', 'ears', 'tail', 'collar']) {
      for (const o of PET_OPTIONS[kind][part]) list.push([`${kind} ${part} ${o.id}`, { ...base, pattern: kind === 'cat' ? 'tabbywhite' : 'twotone', coat: kind === 'cat' ? '#a3a7b1' : '#c9945c', [part]: o.id }]);
    }
    // dark coats are the hardest to read, so show a couple
    list.push([`${kind} black, long coat`, { ...base, coat: '#2b2c36', fur: PET_OPTIONS[kind].fur[1].id, collar: PET_OPTIONS[kind].collar[2].id }]);
    list.push([`${kind} white`, { ...base, coat: '#f6f5f1', coat2: '#d3d5db', eyes: kind === 'cat' ? '#63b7e6' : '#22232b' }]);
  }
  return list;
}

function petsBoard() {
  const list = petsToShow(), cols = 10, k = 4, cw = 96 * k + 24, ch = 168 * k + 40;
  const b = new Board(cols * cw + 24, Math.ceil(list.length / cols) * ch + 24);
  list.forEach(([label, pet], n) => {
    const x = 24 + (n % cols) * cw, y = 24 + Math.floor(n / cols) * ch;
    b.text(label, x, y);
    b.put(drawPetSheet(pet), x, y + 16, k);
  });
  return b;
}

// ───────────────────────── the desks ─────────────────────────

const ACCENTS = ['#8f5fe0', '#e5484d', '#3fbf63', '#f2c81e', '#3b9fd0', '#f08a24', '#e86aa8'];

/** The desks to show, each with a label: every thing that can stand on one, then every colour of light. */
export function desksToShow() {
  const list = DESK_OPTIONS.items.map((o, n) => [o.label.toLowerCase(), { led: '', item: o.id }, ACCENTS[n % ACCENTS.length]]);
  for (const led of DESK_OPTIONS.ledColors) list.push([`lights ${led}`, { led, item: DEFAULT_DESK.item }, '#8f5fe0']);
  return list;
}

function desksBoard() {
  const list = desksToShow(), cols = 12, k = 4, cw = 58 * k + 16, ch = 91 * k + 36;
  const b = new Board(cols * cw + 16, Math.ceil(list.length / cols) * ch + 16);
  list.forEach(([label, desk, accent], n) => {
    const x = 16 + (n % cols) * cw, y = 16 + Math.floor(n / cols) * ch;
    b.box(x, y + 14, 58 * k, 91 * k, [163, 119, 71]);          // a patch of floor
    b.text(label, x, y);
    const art = drawDesk(desk, accent);
    for (const pic of [art.desk, art.chair, art.back]) b.put(pic, x, y + 14, k);
  });
  return b;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const art = join(dirname(fileURLToPath(import.meta.url)), '..', 'art');
  mkdirSync(art, { recursive: true });
  const pets = petsBoard(), desks = desksBoard();
  writeFileSync(join(art, 'pets-preview.png'), pets.png());
  writeFileSync(join(art, 'desks-preview.png'), desks.png());
  console.log(`art/pets-preview.png ${pets.w}x${pets.h} (${petsToShow().length} pets), art/desks-preview.png ${desks.w}x${desks.h} (${desksToShow().length} desks)`);
}
