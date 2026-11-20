// Checks the room upstairs after scripts/make-clubhouse.py has laid it out: node scripts/test-room-layout.mjs (exit code 1 if
// anything is wrong). Every way out (the stairs down, the west door to the backyard, the east door to the campsite) and
// every place people walk to (each desk, the fridge, the sudoku table, the pets' tree, the vacuum's way to its dock under
// the whiteboard) must be reachable on the walking grid from the front door; and no door, stair or table may stand on a desk.
import { CLUB } from '../client/src/clubhouse.gen.ts';
import { readFileSync } from 'node:fs';
const C = CLUB.cell, G = CLUB.grid, R = G.length, K = G[0].length;
const ok = (c, r) => r >= 0 && r < R && c >= 0 && c < K && G[r][c] === '.';
const cell = (p) => [Math.floor(p.x / C), Math.floor(p.y / C)];
function nearest(p) { const [c0, r0] = cell(p); let best = null, d = 1e9; for (let r = 0; r < R; r++) for (let c = 0; c < K; c++) if (ok(c, r)) { const dd = Math.hypot(c - c0, r - r0); if (dd < d) { d = dd; best = [c, r]; } } return [best, d]; }
const [start] = nearest(CLUB.door);
const seen = new Set([start.join()]); const q = [start];
while (q.length) { const [c, r] = q.shift(); for (const [dc, dr] of [[1,0],[-1,0],[0,1],[0,-1]]) { const n = [c+dc, r+dr]; if (ok(...n) && !seen.has(n.join())) { seen.add(n.join()); q.push(n); } } }
const gen = (f) => { const s = readFileSync(f, 'utf8'); return JSON.parse(s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1)); };
const yard = gen('client/src/basement/backyard.gen.ts'), out = gen('client/src/basement/outside.gen.ts');
const find = (o, k) => { if (o && typeof o === 'object') { if (k in o) return o[k]; for (const v of Object.values(o)) { const f = find(v, k); if (f) return f; } } return null; };
const targets = { 'stairs top': CLUB.stairs.top, 'west door (backyard) foot': find(yard, 'door').foot, 'east door (campsite) foot': find(out, 'door').foot,
  'sudoku table': { x: CLUB.sudoku.rect[0] + CLUB.sudoku.rect[2] / 2, y: CLUB.sudoku.rect[1] + CLUB.sudoku.rect[3] + 4 },
  ...Object.fromEntries(CLUB.pcs.map((p, k) => [`desk ${k} stand`, { x: p.ax, y: p.ay }])),
  'fridge': CLUB.snack[0], 'pet tree foot': CLUB.pets.tree.foot, 'whiteboard foot': { x: CLUB.board[0] + CLUB.board[2] - 20, y: 124 } };
let bad = 0;
for (const [name, p] of Object.entries(targets)) { const [n, d] = nearest(p); const r = seen.has(n.join()); if (!r || d > 3) bad++; console.log(`${r && d <= 3 ? 'ok ' : 'BAD'} ${name} at ${Math.round(p.x)},${Math.round(p.y)}: nearest walkable cell ${d.toFixed(1)} cells away, ${r ? 'reachable' : 'NOT reachable'} from the front door`); }
// doors and stairs must not overlap a desk
const inter = (a, b) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
const desks = CLUB.spots.filter((s) => s[0] === 'desk').map((s) => s.slice(1));
for (const [name, r] of [['west door', find(yard, 'door').at], ['east door', find(out, 'door').at], ['stairs', CLUB.stairs.rect], ['sudoku', CLUB.sudoku.rect]]) {
  const hit = desks.findIndex((d) => inter(d, r)); if (hit >= 0) { bad++; console.log(`BAD ${name} overlaps desk ${hit}`); } else console.log(`ok  ${name} clear of every desk`);
}
console.log(bad ? `${bad} problem(s)` : 'all reachable, nothing overlaps');
process.exit(bad ? 1 : 0);
