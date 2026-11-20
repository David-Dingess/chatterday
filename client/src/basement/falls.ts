// The backyard's waterfall, drawn a dot at a time on a little canvas over the rocks (scripts/basement/backyard.py draws
// the rocks, the basin at the top and the dark wet face behind the sheet; `fall` and `basin` in the layout say where):
//   the basin, its water running forward to the lip;
//   the lip, where the water bulges over the stone and catches the light;
//   the sheet, every column of it streaming down at its own speed, streaked light and dark, clear at its edges;
//   the foot, where it churns white into the pool, spray thrown up, and rings going out across the water.

const hsh = (a: number, b: number, s = 0) => { let h = (a * 374761393 + b * 668265263 + s * 2246822519) >>> 0; h = ((h ^ (h >>> 13)) * 1274126177) >>> 0; return (h ^ (h >>> 16)) >>> 0; };
type RGB = [number, number, number];
const SHEET_TOP: RGB = [150, 220, 246], SHEET_LOW: RGB = [86, 176, 226], STREAK: RGB = [236, 250, 255], GAP: RGB = [62, 148, 204];
const CURL: RGB = [244, 252, 255], BULGE: RGB = [178, 232, 250], FOAM: RGB = [250, 254, 255], FOAM2: RGB = [196, 236, 250];

/** Where the canvas goes (x, y, w, h, in the yard's dots), from the sheet and the basin: room round the foot for the rings. */
export function fallBox(fall: number[], basin: number[]): number[] {
  const x0 = fall[0] - 16, y0 = basin[1] - basin[3] - 1, x1 = fall[0] + fall[2] + 16, y1 = fall[1] + fall[3] + 10;
  return [x0, y0, x1 - x0, y1 - y0];
}

export function drawFall(ctx: CanvasRenderingContext2D, box: number[], fall: number[], basin: number[], t: number) {
  const [ox, oy, W, H] = box;
  const img = ctx.createImageData(W, H), d = img.data;
  const put = (x: number, y: number, c: RGB, a: number) => {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= W || y >= H || a <= 0) return;
    const i = (y * W + x) * 4, a0 = d[i + 3] / 255, na = a + a0 * (1 - a);
    for (let k = 0; k < 3; k++) d[i + k] = Math.round((c[k] * a + d[i + k] * a0 * (1 - a)) / (na || 1));
    d[i + 3] = Math.round(na * 255);
  };
  const sx0 = fall[0] - ox, sw = fall[2], lip = fall[1] - oy, foot = fall[1] + fall[3] - oy - 1;
  const [bx, by, brx, bry] = [basin[0] - ox, basin[1] - oy, basin[2], basin[3]];
  // the basin: glints running forward over it to the lip
  for (let k = 0; k < 7; k++) {
    const u = ((t * 0.5 + k / 7) % 1), gx = bx + (((hsh(k, 1) % 100) / 100) * 2 - 1) * (brx - 2) * (1 - u * 0.4), gy = by - bry + 1 + u * (bry * 2 - 1);
    put(gx, gy, STREAK, 0.55 * Math.sin(Math.PI * u));
  }
  // the lip: the water bulging over the stone, and the bright curl on its edge
  for (let x = 0; x < sw; x++) {
    const flick = hsh(x, Math.floor(t * 9), 3) % 5;
    put(sx0 + x, lip, BULGE, 0.85);
    put(sx0 + x, lip + 1, flick === 0 ? BULGE : CURL, 0.95);
  }
  // the sheet: every column streaming down at its own speed
  const len = foot - lip - 1;
  for (let x = 0; x < sw; x++) {
    const edge = x === 0 || x === sw - 1, near = x === 1 || x === sw - 2;
    const v = 30 + (hsh(x, 7) % 18), ph = hsh(x, 9) % 40, per = 14 + (hsh(x, 11) % 9), sl = 4 + (hsh(x, 13) % 4);
    for (let j = 0; j < len; j++) {
      const y = lip + 2 + j, f = j / Math.max(1, len);
      const base: RGB = [0, 1, 2].map((k) => SHEET_TOP[k] + (SHEET_LOW[k] - SHEET_TOP[k]) * f) as RGB;
      const m = ((((j - t * v + ph) % per) + per) % per);
      let c = base, a = edge ? 0.45 : near ? 0.72 : 0.86;
      if (m < sl) { c = STREAK; a = Math.min(1, a + 0.1); }
      else if (x % 3 === 1 && (((j - t * v * 0.9 + ph * 3) % 17) + 17) % 17 < 2) c = GAP;
      put(sx0 + x, y, c, a);
    }
  }
  // the sheet spreading a little as it falls: a dot of spray off each side, low down
  for (let j = Math.floor(len * 0.55); j < len; j++) {
    for (const side of [-1, sw]) if (hsh(j, Math.floor(t * 14) + side, 5) % 3 === 0) put(sx0 + side, lip + 2 + j, STREAK, 0.35);
  }
  // the foot: churning white where it hits the pool
  const cx = sx0 + sw / 2, tick = Math.floor(t * 12);
  for (let y = foot - 3; y <= foot + 4; y++) for (let x = sx0 - 5; x < sx0 + sw + 5; x++) {
    const dx = Math.abs(x + 0.5 - cx) / (sw / 2 + 5), dy = Math.abs(y - foot - 1) / 3.5, r = dx * dx + dy * dy;
    if (r > 1) continue;
    const h = hsh(x, y * 31 + tick, 17) % 100;
    if (r < 0.35 || h < 85 * (1 - r)) put(x, y, h % 3 ? FOAM : FOAM2, 0.97 - r * 0.35);
  }
  // spray thrown up off it, and falling back
  for (let k = 0; k < 9; k++) {
    const p = (t * 1.6 + hsh(k, 2) / 4e9) % 1, sx = cx + ((hsh(k, 4) % 100) / 100 - 0.5) * (sw + 6) + (p * ((hsh(k, 6) % 7) - 3)), sy = foot - 1 - Math.sin(Math.PI * p) * (3 + (hsh(k, 8) % 4));
    put(sx, sy, FOAM, 0.75 * (1 - p * 0.6));
  }
  // rings going out across the pool from the foot (only their near half shows: the far half is under the sheet)
  for (let k = 0; k < 3; k++) {
    const r = ((t * 5 + k * 6) % 18), rx = sw / 2 + 4 + r * 0.9, ry = 2 + r * 0.32, a = 0.75 * (1 - r / 18);
    for (let s = 0; s <= 40; s++) {
      const an = (s / 40) * Math.PI;
      put(cx + Math.cos(an) * rx, foot + 2 + Math.sin(an) * ry, CURL, a);
    }
  }
  ctx.putImageData(img, 0, 0);
}
