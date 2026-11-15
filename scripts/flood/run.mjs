// The flood tests, all of them, against a throwaway server of their own: never the real one, never real data.
//
//   node scripts/flood/run.mjs            everything (about eight minutes)
//   node scripts/flood/run.mjs quick      without the slow parts (the message fuzz and the game rules)
//
// It starts scripts/flood/server.mjs on port 4591 with a fresh data folder in the temp directory (and its own LiveKit
// on 7950, so it runs beside the real server). That makes six people to test with: Robin (the admin), Sam, Kit, Juno,
// Mika and Pat, who all sign in with one password, made up anew for each run. Then it runs:
//   access.mjs      who can reach what: signed out, another site, a member trying the admin's things, private chats,
//                   paths out of the built UI, uploads that pretend to be something else
//   flood.mjs       floods and malformed traffic: chat, connections, frames, nonsense in every field of every message,
//                   the whiteboard, thumbnails, reactions, HTTP, uploads cut off, stalled connections, hundreds of
//                   characters saved at once, password guessing
//   fuzz-games.mjs  the rules of every table game played out with nonsense thrown in at every step
// and stops the server again. Each prints "ok" or "FAIL" a line; this ends with which of the three failed, if any.
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = import.meta.dirname, root = path.resolve(here, '..', '..');
const quick = process.argv.includes('quick');
const DATA = path.join(os.tmpdir(), 'chatterday-flood-data'), LOG = path.join(os.tmpdir(), 'chatterday-flood.log');
const env = { ...process.env, PORT: '4591', FLOOD_PORT: '4591', CHATTERDAY_LK_PORT: '7950', CHATTERDAY_DATA: DATA, FLOOD_LOG: LOG, FLOOD_PASSWORD: crypto.randomBytes(18).toString('base64url') };

fs.rmSync(DATA, { recursive: true, force: true });
fs.mkdirSync(DATA, { recursive: true });
const log = fs.openSync(LOG, 'w');
const server = spawn(process.execPath, [path.join(here, 'server.mjs')], { cwd: root, env, stdio: ['ignore', log, log], windowsHide: true });
/** Stops the throwaway server and the LiveKit it started (which a plain kill would leave behind). */
const stop = () => {
  if (server.exitCode !== null) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/T', '/F', '/PID', String(server.pid)], { stdio: 'ignore' }); else server.kill();
};
process.on('exit', stop);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130));

// it is ready once the six test sign-ins exist (they are made after it starts listening)
const ready = () => { try { return fs.readFileSync(LOG, 'utf8').includes('Made 6 sign-ins'); } catch { return false; } };
for (let i = 0; i < 120 && !ready(); i++) {
  if (server.exitCode !== null) { console.error(`The test server stopped by itself. Its log: ${LOG}`); process.exit(1); }
  await new Promise((r) => setTimeout(r, 500));
}
if (!ready()) { console.error(`The test server did not come up in a minute. Its log: ${LOG}`); process.exit(1); }
console.log(`test server up on 127.0.0.1:4591 (data: ${DATA}, log: ${LOG})\n`);

const failed = [];
const run = (file, ...args) => {
  console.log(`\n──────── ${file} ${args.join(' ')} ────────`);
  if (spawnSync(process.execPath, [path.join(here, file), ...args], { cwd: root, env, stdio: 'inherit' }).status !== 0) failed.push(file);
};
run('access.mjs');
run('flood.mjs', ...(quick ? ['chat', 'multi', 'conns', 'frames', 'board', 'preview', 'react', 'http', 'uploads', 'slow', 'looks', 'login'] : []));
if (!quick) run('fuzz-games.mjs');

stop();
console.log(failed.length ? `\nFAILED: ${failed.join(', ')}` : '\nAll of it passed.');
process.exit(failed.length ? 1 : 0);
