// Squeezes the built UI once, at build time, so the server never has to while someone waits: beside every file
// worth squeezing in client/dist (code, styles, pages, the icon) go a .br and a .gz copy, and the server hands
// out whichever the browser can read (serveStatic in server/index.ts). Pictures and fonts are left alone: they
// are squeezed already, and a second go only costs time.
//   node scripts/precompress.mjs [folder]      (the folder defaults to client/dist; npm run build runs it)
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { promisify } from 'node:util';

const brotli = promisify(zlib.brotliCompress), gzip = promisify(zlib.gzip);
const ROOT = path.resolve(process.argv[2] || path.join(import.meta.dirname, '..', 'client', 'dist'));
const SQUEEZE = new Set(['.js', '.mjs', '.css', '.html', '.svg', '.json', '.webmanifest', '.wasm', '.txt', '.xml']);
const SMALL = 1024;         // (below this a squeezed copy saves less than the headers it costs)

const files = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full);
    else if (SQUEEZE.has(path.extname(e.name).toLowerCase())) files.push(full);
  }
};
walk(ROOT);

let raw = 0, br = 0, gz = 0, kept = 0;
await Promise.all(files.map(async (file) => {
  const st = fs.statSync(file);
  for (const old of ['.br', '.gz']) fs.rmSync(file + old, { force: true });      // (never leave a copy of an older build)
  if (st.size < SMALL) return;
  const body = fs.readFileSync(file);
  const [b, g] = await Promise.all([
    brotli(body, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: body.length,
      [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT } }),
    gzip(body, { level: 9 }),
  ]);
  raw += body.length; kept++;
  // Each copy carries its original's date. The server only trusts a copy at least as new as the file it stands for,
  // and the app's "a new build is out" check looks at the newest date in the folder, so squeezing does not count
  // as a second build and reload everyone's page again.
  for (const [ext, out] of [['.br', b], ['.gz', g]]) {
    if (out.length >= body.length) continue;          // (no smaller for it: the plain file goes out instead)
    fs.writeFileSync(file + ext, out);
    fs.utimesSync(file + ext, st.atimeMs / 1000, st.mtimeMs / 1000);      // (it may land a hair earlier: the server allows a millisecond)
    if (ext === '.br') br += out.length; else gz += out.length;
  }
}));
const kb = (n) => `${Math.round(n / 1024)} KB`;
console.log(`precompress: ${kept} files in ${path.relative(process.cwd(), ROOT) || '.'}, ${kb(raw)} -> brotli ${kb(br)}, gzip ${kb(gz)}`);
