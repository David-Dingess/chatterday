// Centered rework of pixel-sun #9 (ray tail) in several palettes. Usage: node ray-tail.mjs <outDir>
import fs from 'node:fs';
import path from 'node:path';

const out = process.argv[2];
fs.mkdirSync(out, { recursive: true });

// 13x13 grid; col/row 6 is the exact middle of the tile. S = sun, D = typing dot (knocked out), R = ray, T = tail.
const G = [
  '.............',
  '......R......',
  '..R.......R..',
  '....SSSSS....',
  '...SSSSSSS...',
  '...SSSSSSS...',
  '.R.SDSDSDS.R.',
  '...SSSSSSS...',
  '...SSSSSSS...',
  '...SSSSSS....',
  '..TT.....R...',
  '.T....R......',
  '.............',
];
// Mirror check: everything except the tail and the bottom-right corner of the sun is symmetric about col 6.

const CELL = 36, OFF = (512 - 13 * CELL) / 2; // 22px margin each side -> the grid is centred on the tile

const palettes = [
  ['01-coral', 'Coral (the original red, now centred)', '#f0554f', '#ffd23f'],
  ['02-indigo', 'Indigo, the app accent', '#7c8cff', '#ffd23f'],
  ['03-night', 'Night: app dark with sun yellow', '#14161c', '#ffd23f'],
  ['04-teal', 'Teal', '#14a39a', '#ffd23f'],
  ['05-sky', 'Sky blue', '#3d9df2', '#ffe066'],
  ['06-grape', 'Grape', '#6a3fb5', '#ffd23f'],
  ['07-pink', 'Bubblegum pink', '#ff5c9d', '#fff1a8'],
  ['08-phosphor', 'Phosphor green on dark (matches #5)', '#0d1410', '#38ff5c'],
  ['09-navy-amber', 'Navy with warm amber', '#1d2a5c', '#f5a623'],
  ['10-tangerine', 'Tangerine with cream sun', '#f27a1a', '#fff4d6'],
  ['11-mint', 'Mint with dark ink sun', '#7fe0b4', '#14161c'],
  ['12-sunrise', 'Indigo-to-coral gradient (like #11)', 'url(#sky)', '#ffd23f', ['#7c8cff', '#f0554f']],
];

function svg([, title, bg, sun, grad]) {
  const dot = grad ? grad[0] : bg; // knocked-out dots show the tile colour
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512" shape-rendering="crispEdges">\n<title>Chatterday - ${title}</title>\n`;
  if (grad) s += `<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${grad[0]}"/><stop offset="1" stop-color="${grad[1]}"/></linearGradient></defs>\n`;
  s += `<rect width="512" height="512" rx="112" fill="${bg}"/>\n`;
  G.forEach((row, r) => [...row].forEach((c, k) => {
    if (c === '.') return;
    const fill = c === 'D' ? (grad ? `url(#sky)` : dot) : sun;
    s += `<rect x="${OFF + k * CELL}" y="${OFF + r * CELL}" width="${CELL}" height="${CELL}" fill="${fill}"/>\n`;
  }));
  return s + '</svg>\n';
}
// Gradient dots: draw them as the gradient so they read as holes. userSpaceOnUse keeps the hole matching the tile behind it.
const fixGrad = (t) => t.replace('x2="0" y2="1"', 'x1="0" y1="0" x2="0" y2="512" gradientUnits="userSpaceOnUse"').replace('x1="0" y1="0" x1="0" y1="0"', 'x1="0" y1="0"');

const cards = [];
for (const p of palettes) {
  const file = `${p[0]}.svg`;
  fs.writeFileSync(path.join(out, file), fixGrad(svg(p)));
  cards.push(`<figure><div class="row"><div class="sw light"><img src="${file}" width="150"><img src="${file}" width="32"><img src="${file}" width="16"></div><div class="sw dark"><img src="${file}" width="32"><img src="${file}" width="16"></div></div><figcaption><b>${p[0].slice(0, 2)}.</b> ${p[1]}</figcaption></figure>`);
}

// Before/after: the old #9 with a centre line, and the new one.
const guide = `<svg class="guide" viewBox="0 0 512 512"><line x1="256" y1="0" x2="256" y2="512" stroke="#00e5ff" stroke-width="3" stroke-dasharray="10 8"/><line x1="0" y1="256" x2="512" y2="256" stroke="#00e5ff" stroke-width="3" stroke-dasharray="10 8"/></svg>`;
fs.writeFileSync(path.join(out, 'index.html'), `<!doctype html><meta charset="utf-8"><title>Chatterday - ray tail, centred</title>
<style>
body{margin:0;padding:24px;background:#14161c;color:#e8e8ee;font:14px/1.4 system-ui,sans-serif}
h1{font-size:24px;margin:0 0 4px}p.sub{color:#9aa0b4;margin:0 0 20px}
.ba{display:flex;gap:24px;margin-bottom:24px}.ba div{position:relative;width:220px}.ba img,.ba .guide{width:220px;height:220px;display:block}.ba .guide{position:absolute;top:0;left:0}
.ba span{display:block;text-align:center;margin-top:6px;color:#9aa0b4}
.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}
figure{margin:0;background:#1d2029;border-radius:12px;padding:12px}
.row{display:flex;gap:8px}.sw{display:flex;align-items:flex-end;gap:10px;padding:12px;border-radius:8px}
.light{background:#f3f1ea;flex:1}.dark{background:#0b0c10}
img{image-rendering:pixelated;display:block}figcaption{margin-top:8px;color:#c5c8d6}
</style>
<h1>Chatterday — ray tail, centred</h1><p class="sub">#9 rebuilt on a 13×13 grid so the sun sits on the exact centre of the tile (dashed lines), in 12 colourways · 150 / 32 / 16px</p>
<div class="ba"><div><img src="../09-ray-tail.svg">${guide}<span>Before: sun sits right of centre</span></div><div><img src="01-coral.svg">${guide}<span>After: centred</span></div></div>
<div class="grid">${cards.join('\n')}</div>`);
console.log('wrote', palettes.length, 'svgs to', out);
