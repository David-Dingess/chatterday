// A look at what can be taken off the backyard's smoking table, on somebody, in every pose it is seen in: each thing a
// row, each pose a column (standing with it, the drag, sat with it, the drag sat, walking towards us, away, side on both
// ways), the same frames the page draws, with the thing laid over them where the page lays it (client/src/basement/smokes.ts).
//   node scripts/preview-smokes.ts out.png [seed]      (a random character from the builder; the default look without a seed)
import fs from 'node:fs';
import zlib from 'node:zlib';
import { framesOf, marksOfPerson, personOf, SPRITE_ROWS } from '../client/src/draw/avatar.ts';
import { DEFAULT_LOOK, randomLook } from '../shared/look.ts';
import { ARTS, IN_MOUTH, KINDS, pixels, place } from '../client/src/basement/smokes.ts';

const [out, seed] = process.argv.slice(2);
if (!out) throw new Error('usage: node scripts/preview-smokes.ts out.png [seed]');
const p = personOf(seed === undefined ? DEFAULT_LOOK : randomLook(Number(seed)), '#7d8597');
const fr = framesOf(p), m = marksOfPerson(p);
const K = 6, BG = [150, 156, 170];
const POSES = (k: string): [string, number, boolean][] => IN_MOUTH.has(k)
  ? [['idle', 0, false], ['idle', 1, false], ['sit_front', 0, false], ['sit_back', 0, false], ['walk_down', 0, false], ['walk_down', 1, false], ['walk_up', 0, false], ['walk_left', 0, false], ['walk_left', 1, false], ['walk_right', 2, false]]
  : [['drink', 0, false], ['drink', 2, true], ['drink_sit', 0, false], ['drink_sit', 2, true], ['walk_down', 0, false], ['walk_down', 2, false], ['walk_up', 0, false], ['walk_left', 0, false], ['walk_left', 1, false], ['walk_right', 2, false]];
const COLS = 10, fw = fr[0].w, fh = fr[0].tall, up = fh - 48;
const W = fw * COLS * K, H = fh * KINDS.length * K;
const px = Buffer.alloc(W * H * 4);
for (let i = 0; i < W * H; i++) { px[i * 4] = BG[0]; px[i * 4 + 1] = BG[1]; px[i * 4 + 2] = BG[2]; px[i * 4 + 3] = 255; }
const dot = (gx: number, gy: number, r: number, g: number, b: number, a: number) => {
  if (gx < 0 || gy < 0 || gx * K >= W || gy * K >= H || a <= 0) return;
  for (let dy = 0; dy < K; dy++) for (let dx = 0; dx < K; dx++) {
    const d = ((gy * K + dy) * W + gx * K + dx) * 4;
    px[d] = Math.round(r * a + px[d] * (1 - a)); px[d + 1] = Math.round(g * a + px[d + 1] * (1 - a)); px[d + 2] = Math.round(b * a + px[d + 2] * (1 - a));
  }
};
KINDS.forEach((kind, ry) => POSES(kind).forEach(([row, f, drag], cx) => {
  const cv = fr[SPRITE_ROWS.indexOf(row as never) * 8 + f];
  const ox = cx * fw, oy = ry * fh;
  for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) { const s = (y * fw + x) * 4; dot(ox + x, oy + y, cv.a[s], cv.a[s + 1], cv.a[s + 2], cv.a[s + 3] / 255); }
  const pl = place(kind, m, row, f, false, drag);
  if (!pl || !pl.shown) return;
  const pic = pixels(ARTS[pl.art], pl.flip, m.skin), d = pic.frames[0];
  for (let y = 0; y < pic.h; y++) for (let x = 0; x < pic.w; x++) { const s = (y * pic.w + x) * 4; dot(ox + pl.x + x, oy + up + pl.y + y, d[s], d[s + 1], d[s + 2], d[s + 3] / 255); }
  if (pl.ember) dot(ox + Math.round(pl.ember[0]), oy + up + Math.round(pl.ember[1]) - 3, 255, 0, 255, 0.5);       // (a mark 3 above where smoke starts)
}));
const row = W * 4 + 1, raw = Buffer.alloc(row * H);
for (let y = 0; y < H; y++) { raw[y * row] = 0; px.copy(raw, y * row + 1, y * W * 4, (y + 1) * W * 4); }
const chunk = (t: string, b: Buffer) => { const l = Buffer.alloc(4); l.writeUInt32BE(b.length); const tb = Buffer.concat([Buffer.from(t), b]); const c = Buffer.alloc(4); c.writeUInt32BE(zlib.crc32(tb)); return Buffer.concat([l, tb, c]); };
const hd = Buffer.alloc(13); hd.writeUInt32BE(W, 0); hd.writeUInt32BE(H, 4); hd[8] = 8; hd[9] = 6;
fs.writeFileSync(out, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', hd), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
console.log('wrote', out, W, 'x', H);
