// Looks for things that work on Windows and break on Linux, before the server moves (docs/linux-hosting.md).
//
//   node scripts/linux-check.mjs
//
// Windows finds "Room.png" when the code asks for "room.png"; Linux does not. So every relative import in the server,
// the shared code and the client, and every "/path.ext" string in the client that names a file in client/public, must
// match the file's name letter for letter. It also lists Windows-only paths (backslashes, drive letters, .exe, .ps1)
// left in the server's code, for a person to look at: most are fine (they only run on Windows).
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const problems = [];
const notes = [];

/** Does `full` exist with exactly this spelling, folder by folder? */
function exactExists(full) {
  const rel = path.relative(ROOT, full);
  if (rel.startsWith('..')) return fs.existsSync(full);
  let dir = ROOT;
  for (const part of rel.split(path.sep)) {
    let names;
    try { names = fs.readdirSync(dir); } catch { return false; }
    if (!names.includes(part)) return false;
    dir = path.join(dir, part);
  }
  return true;
}
const anyCaseExists = (full) => fs.existsSync(full);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue;
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walk(f, out);
    else if (/\.(ts|tsx|mjs|js)$/.test(e.name)) out.push(f);
  }
  return out;
}

const EXTS = ['', '.ts', '.tsx', '.js', '.mjs', '.json', '/index.ts', '/index.tsx'];
const code = ['server', 'shared', 'client/src', 'scripts'].flatMap((d) => fs.existsSync(path.join(ROOT, d)) ? walk(path.join(ROOT, d)) : []);
const rel = (f) => path.relative(ROOT, f).replaceAll('\\', '/');

// 1. Relative imports, letter for letter.
for (const file of code) {
  const src = fs.readFileSync(file, 'utf8');
  for (const m of src.matchAll(/(?:import|export)[^'"]*?from\s*['"](\.{1,2}\/[^'"]+)['"]|import\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)|import\s+['"](\.{1,2}\/[^'"]+)['"]/g)) {
    const spec = (m[1] || m[2] || m[3]).split('?')[0];
    const base = path.resolve(path.dirname(file), spec);
    const hit = EXTS.map((x) => base + x).find((c) => anyCaseExists(c) && fs.statSync(c).isFile());
    if (!hit) continue;                                   // (generated, or not a file: tsc and vite would say so on Windows too)
    if (!EXTS.some((x) => exactExists(base + x) && fs.statSync(base + x).isFile())) problems.push(`${rel(file)}: import "${spec}" differs in case from the file on disk`);
  }
}

// 2. "/something.ext" strings in the client that name a file in client/public.
const PUB = path.join(ROOT, 'client', 'public');
const clientCode = code.filter((f) => rel(f).startsWith('client/'));
for (const file of clientCode) {
  const src = fs.readFileSync(file, 'utf8');
  for (const m of src.matchAll(/['"`](\/[\w./-]+\.(?:png|jpe?g|gif|webp|svg|mp3|wav|ogg|json|ttf|woff2?|html))['"`]/gi)) {
    const full = path.join(PUB, m[1]);
    if (anyCaseExists(full) && !exactExists(full)) problems.push(`${rel(file)}: "${m[1]}" differs in case from the file in client/public`);
  }
}

// 3. Windows-only spellings left in the server.
for (const file of code.filter((f) => /^(server|shared)\//.test(rel(f)))) {
  fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    if (/^\s*(\/\/|\*)/.test(line)) return;
    if (/[A-Z]:\\\\|\.ps1\b|powershell|cmd\.exe|\.exe['"]/i.test(line)) notes.push(`${rel(file)}:${i + 1}: ${line.trim().slice(0, 140)}`);
  });
}

console.log(`Checked ${code.length} files.`);
if (notes.length) { console.log(`\nWindows-only spellings in the server (look at each; most only run on Windows):`); for (const n of notes) console.log('  ' + n); }
if (problems.length) { console.log(`\n${problems.length} case problem(s) that would break on Linux:`); for (const p of problems) console.log('  ' + p); process.exit(1); }
console.log('\nNo case problems: every import and public file name matches letter for letter.');
