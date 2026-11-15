// Checks the share-sound helper (desktop/sharesound.exe) with real sound, without the app.
// A separate program plays a quiet test tone. The helper must hear the tone when asked for that program's sound, and
// must NOT hear it when asked for a different program's sound. You will hear the tone twice, about two seconds each.
// Usage: node scripts/sharesound-test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const exe = path.join(root, 'desktop', 'sharesound.exe');
const TONE = 1900, RATE = 48000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

// a quiet 1900 Hz tone as a WAV file, 2.6 s
const wav = path.join(os.tmpdir(), 'chatterday-test-tone.wav');
{
  const n = Math.round(RATE * 2.6), data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * TONE * i) / RATE) * 0.06 * 32767 * Math.min(1, i / 2400, (n - i) / 2400)), i * 2);
  const head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + data.length, 4); head.write('WAVEfmt ', 8); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22);
  head.writeUInt32LE(RATE, 24); head.writeUInt32LE(RATE * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34); head.write('data', 36); head.writeUInt32LE(data.length, 40);
  fs.writeFileSync(wav, Buffer.concat([head, data]));
}
/** Another program that plays the tone (a hidden PowerShell). Resolves with its process once it is running. */
function player() {
  return spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Start-Sleep -Milliseconds 900; (New-Object Media.SoundPlayer '${wav}').PlaySync()`], { windowsHide: true, stdio: 'ignore' });
}
/** How strong the tone is in a stretch of 16-bit stereo sound, in dB (0 is full scale; silence is far below -80). */
function toneLevel(pcm) {
  const n = pcm.length >> 2;
  if (n < RATE / 4) return -200;
  const w = (2 * Math.PI * TONE) / RATE, c = 2 * Math.cos(w);
  let s1 = 0, s2 = 0;
  for (let i = 0; i < n; i++) { const x = (pcm.readInt16LE(i * 4) + pcm.readInt16LE(i * 4 + 2)) / 65536; const s0 = x + c * s1 - s2; s2 = s1; s1 = s0; }
  const power = s1 * s1 + s2 * s2 - c * s1 * s2;
  return Math.round(10 * Math.log10(Math.max(1e-20, power / ((n * n) / 4))));
}
/** Runs the helper for a while and returns what it captured, plus what it said. */
async function capture(args, ms) {
  const child = spawn(exe, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const chunks = [];
  let said = '';
  child.stdout.on('data', (c) => chunks.push(c));
  child.stderr.on('data', (c) => { said += c.toString(); });
  const code = new Promise((res) => child.on('exit', res));
  await sleep(ms);
  child.kill();
  return { pcm: Buffer.concat(chunks), said: said.trim().replace(/\s+/g, ' '), code: await Promise.race([code, sleep(1500).then(() => 'killed')]) };
}

if (!fs.existsSync(exe)) { console.log('desktop/sharesound.exe is not built: run "npm run helper" in the desktop folder'); process.exit(1); }

// 1. one program's sound: the tone's own program
let p = player();
let got = await capture(['--include', String(p.pid), '--parent', String(process.pid)], 3600);
const own = toneLevel(got.pcm);
check('asked for one program, the helper hears that program', /capturing/.test(got.said) && own > -45, `tone at ${own} dB, ${(got.pcm.length / 192000).toFixed(1)} s of sound; helper said "${got.said}"`);

// 2. while the tone plays in one program, asking for a different, silent program must give silence
const idle = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Start-Sleep -Seconds 10'], { windowsHide: true, stdio: 'ignore' });
await sleep(400);
p = player();
got = await capture(['--include', String(idle.pid), '--parent', String(process.pid)], 3600);
const other = toneLevel(got.pcm);
idle.kill();
check('asked for another, silent program, the tone is not heard', /capturing/.test(got.said) && other < own - 40, `tone at ${other} dB (it was ${own} dB when asked for)`);
// ("Everything except one program" is in the helper too, but the app does not use it: on a PC with a sound router such
// as Voicemeeter the router replays every sound as its own, so the left-out program is heard anyway. Measured 2026-11-12.)

// 3. it refuses to capture the app itself through a window, and stops when its parent is gone
got = await capture(['--include', String(process.pid), '--not', String(process.pid)], 600);
check('it refuses when the target is the app itself', got.code === 3, `exit ${got.code}: "${got.said}"`);
got = await capture(['--exclude', '4', '--parent', '999999'], 2500);
check('it stops by itself when the app that started it is gone', got.code === 0, `exit ${got.code}`);

fs.rmSync(wav, { force: true });
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
