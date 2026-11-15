// Draws the official Chatterday icon files, in the release colours, from the grid in client/src/logo.ts:
//   client/public/icon.svg   the page's icon before the app has loaded (the app then recolours the tab icon)
//   desktop/icon.png         256px, the desktop app's window icon and what the installer is built from
//   desktop/icon.ico         16-256px, for Windows
//   desktop/tray.png         32px, the tray icon
//   art/logo.svg             512px master
// Run: node scripts/make-logo.mjs
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { LOGO_GRID, LOGO_SUN, LOGO_TILE, logoSvg } from '../client/src/logo.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const SUN = hex(LOGO_SUN), TILE = hex(LOGO_TILE);
const N = LOGO_GRID.length, RADIUS = 2.85;   // same tile and corner as logoSvg

/** Which colour (or none) is at a point of the 13x13 design. */
function at(u, v) {
  const r = RADIUS, cx = Math.min(Math.max(u, r), N - r), cy = Math.min(Math.max(v, r), N - r);
  if ((u - cx) ** 2 + (v - cy) ** 2 > r * r) return null;               // outside the rounded tile
  const c = LOGO_GRID[Math.floor(v)]?.[Math.floor(u)];
  return c && c !== '.' && c !== 'D' ? SUN : TILE;
}

/** RGBA pixels at `size`, 4x4 supersampled so the round corners are smooth and the cells stay sharp. */
function raster(size) {
  const px = Buffer.alloc(size * size * 4), S = 4;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
      const c = at(((x + (i + 0.5) / S) / size) * N, ((y + (j + 0.5) / S) / size) * N);
      if (c) { r += c[0]; g += c[1]; b += c[2]; a++; }
    }
    const o = (y * size + x) * 4;
    if (a) { px[o] = r / a; px[o + 1] = g / a; px[o + 2] = b / a; px[o + 3] = Math.round((255 * a) / (S * S)); }
  }
  return px;
}

const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = (buf) => { let c = -1; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size) {
  const px = raster(size), rows = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) px.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(rows, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
/** An .ico holding PNG images (Windows Vista and later read these). */
function ico(sizes) {
  const imgs = sizes.map(png), head = Buffer.alloc(6 + 16 * sizes.length);
  head.writeUInt16LE(1, 2); head.writeUInt16LE(sizes.length, 4);
  let off = head.length;
  sizes.forEach((s, i) => {
    const e = 6 + i * 16;
    head[e] = s >= 256 ? 0 : s; head[e + 1] = s >= 256 ? 0 : s; head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(imgs[i].length, e + 8); head.writeUInt32LE(off, e + 12); off += imgs[i].length;
  });
  return Buffer.concat([head, ...imgs]);
}

const write = (rel, data) => { fs.writeFileSync(path.join(ROOT, rel), data); console.log(`wrote ${rel} (${data.length} bytes)`); };
write('client/public/icon.svg', logoSvg(LOGO_SUN, LOGO_TILE) + '\n');
write('art/logo.svg', logoSvg(LOGO_SUN, LOGO_TILE, 512) + '\n');
write('desktop/icon.png', png(256));
write('desktop/tray.png', png(32));
write('desktop/icon.ico', ico([16, 24, 32, 48, 64, 128, 256]));
