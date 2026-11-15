// A throwaway copy of Chatterday for looking at changes: fresh data every time, its own ports, and
// pretend friends who keep changing what they are doing so you can watch them move around the
// house. Nothing here touches the real data folder. Close the window (or Ctrl+C) to stop.
import { exec, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';

process.env.PORT ??= '4478';
// a second demo on another port (PORT=4479) gets its own folder, so two can run side by side
const data = path.join(os.tmpdir(), process.env.PORT === '4478' ? 'chatterday-demo-data' : `chatterday-demo-data-${process.env.PORT}`);
fs.rmSync(data, { recursive: true, force: true });
process.env.CHATTERDAY_DATA = data;
process.env.CHATTERDAY_LK_PORT ??= '7890';
const base = `http://127.0.0.1:${process.env.PORT}`;

await import('../server/index.ts');
const { all, run, setKV } = await import('../server/db.ts');
const { createUser } = await import('../server/accounts.ts');
const { randomLook } = await import('../shared/look.ts');
const { randomPet } = await import('../shared/pet.ts');
const { randomDesk } = await import('../shared/desk.ts');
const [voiceId, sideId] = all("SELECT id FROM channels WHERE kind = 'voice' ORDER BY position, id").map((c) => c.id);
const textId = all("SELECT id FROM channels WHERE kind = 'text' ORDER BY position, id")[0].id;

// What each friend does, in order; everyone moves on to their next thing every STEP seconds.
const STEP = Number(process.env.DEMO_STEP) || 24;
const away = { state: 'away', label: '' };
const desk = { state: 'desk', label: '' };
const game = (label) => ({ state: 'gaming', label });
const watch = (label) => ({ state: 'watching', label });
const inVoice = (activity, sharing = false) => ({ ...activity, voice: { muted: false, sharing } });
const inSide = (activity) => ({ ...activity, side: true, voice: { muted: false, sharing: false } });      // the Game Table (the second voice chat), at the table
const gone = (place) => ({ ...desk, place });            // one of the "Where are you?" buttons
// Five friends are about when you walk in, which with you fills the house's six desks. Two more turn up later:
// the house has no desk for them, so they are visitors with a laptop.
const cast = [
  { name: 'Robin', pet: true, plan: [inVoice(game('Kart Racing')), gone('kitchen'), inVoice(desk), inVoice(desk, true), gone('bathroom'), 'offline'] },
  { name: 'Sam', pet: true, plan: [inVoice(desk), inSide(desk), inVoice(desk), inVoice(desk), game('Dungeon Run'), gone('kitchen')] },
  { name: 'Kit', pet: false, plan: [gone('kitchen'), inSide(desk), gone('bathroom'), 'offline', inVoice(desk), desk] },
  { name: 'Juno', pet: true, plan: [inVoice(desk), inVoice(desk, true), gone('sleeping'), game('Card Night'), away, desk] },
  { name: 'Mika', pet: true, plan: [watch('YouTube'), desk, gone('kitchen'), inVoice(desk), away, 'offline'] },
  { name: 'Pat', pet: false, plan: ['offline', game('Block World'), inVoice(desk), inVoice(desk), gone('sleeping'), desk] },
  { name: 'Noor', pet: true, plan: ['offline', 'offline', desk, inVoice(desk), game('Kart Racing'), desk] },
];

// The accounts are made here, straight in the throwaway database, each with a look, a desk and (mostly) a pet.
const PASSWORD = 'demo-password';
const COLORS = ['#3fbf63', '#ff8f2e', '#ff6fb7', '#3b82f6', '#e5484d', '#2fd3c6', '#f2c230'];
const you = createUser('Alex', PASSWORD, 'admin');
run('UPDATE users SET look = ?, pet = ?, desk = ?, color = ? WHERE id = ?', JSON.stringify(randomLook(11)), JSON.stringify({ ...randomPet(4), name: 'Biscuit' }), JSON.stringify(randomDesk(3)), '#8b6be0', you);
const PET_NAMES = ['Mochi', 'Pepper', 'Waffles', 'Luna', 'Ziggy', 'Olive', 'Bean'];
cast.forEach((f, k) => {
  f.id = createUser(f.name, PASSWORD, 'member');
  run('UPDATE users SET look = ?, pet = ?, desk = ?, color = ? WHERE id = ?', JSON.stringify(randomLook(101 + k * 7)), f.pet ? JSON.stringify({ ...randomPet(31 + k * 5), name: PET_NAMES[k] }) : null,
    JSON.stringify(randomDesk(57 + k * 3)), COLORS[k % COLORS.length], f.id);
});
setKV('serverName', 'The Treehouse');
setKV('publicUrl', `http://localhost:${process.env.PORT}`);      // so an invite made in the demo opens the demo
// a little chat, so the text column is not empty
const lines = [['Robin', 'anyone up for a few rounds tonight?'], ['Sam', 'in after dinner'], ['Juno', 'I am making tacos, give me 20'], ['Kit', 'save me a seat on the sofa'], ['Robin', 'theatre at 9, I will share my screen']];
lines.forEach(([who, text], k) => run('INSERT INTO messages (channel_id, user_id, content, attachments, created_at) VALUES (?, ?, ?, ?, ?)', textId, cast.find((f) => f.name === who).id, text, '[]', Date.now() - (lines.length - k) * 60_000));

async function join(name) {
  const r = await fetch(`${base}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base },
    body: JSON.stringify({ name, password: PASSWORD, device: 'demo' }),
  });
  const cookie = (r.headers.get('set-cookie') ?? '').split(';')[0];
  if (!r.ok || !cookie) throw new Error(`could not sign ${name} in: ${await r.text()}`);
  return cookie;
}

function apply(friend, what) {
  if (what === 'offline') { friend.ws?.close(); friend.ws = null; return; }
  const send = (ws) => {
    ws.send(JSON.stringify({ t: 'activity', state: what.state, label: what.label }));
    ws.send(JSON.stringify({ t: 'voice', channelId: what.voice ? (what.side ? sideId : voiceId) : null, deafened: false, muted: false, sharing: false, ...what.voice }));
    ws.send(JSON.stringify({ t: 'place', place: what.place ?? '' }));
  };
  if (friend.ws?.readyState === WebSocket.OPEN) return send(friend.ws);
  friend.ws?.terminate();                          // one that was still on its way in: start again
  const ws = new WebSocket(`ws://127.0.0.1:${process.env.PORT}/ws?kind=app`, { headers: { Cookie: friend.cookie, Origin: base } });
  friend.ws = ws;
  ws.on('open', () => { if (friend.ws === ws) send(ws); });
  ws.on('error', () => {});
}

// The link signs you in as Alex, who is the admin.
const link = `http://localhost:${process.env.PORT}/#/login/Alex/${PASSWORD}`;
// DEMO_APP=1 opens it in the desktop app (with its own window frame) instead of the browser.
const electron = path.resolve(import.meta.dirname, '..', 'desktop', 'node_modules', 'electron', 'dist', 'electron.exe');
if (process.env.DEMO_APP && fs.existsSync(electron)) {
  const profile = path.join(os.tmpdir(), 'chatterday-demo-profile');
  fs.rmSync(profile, { recursive: true, force: true });
  fs.mkdirSync(profile, { recursive: true });
  fs.writeFileSync(path.join(profile, 'config.json'), JSON.stringify({ serverUrl: `http://localhost:${process.env.PORT}`, pendingHash: `login/Alex/${PASSWORD}`, closeToTray: false }));
  console.log(`\n  Chatterday demo is running in the desktop app. It signs you in as Alex, the admin.\n  Friends change what they are doing every ${STEP} seconds. Close the app window to stop the demo.\n`);
  const app = spawn(electron, [path.resolve(import.meta.dirname, '..', 'desktop')], { env: { ...process.env, CHATTERDAY_PROFILE: profile }, stdio: 'ignore' });
  app.on('exit', () => process.exit(0));
} else {
  console.log(`\n  Chatterday demo is running. If the page did not open, go to:\n  ${link}\n\n  It signs you in as Alex, the admin. Friends change what they are doing every ${STEP} seconds.\n  Close this window to stop the demo.\n`);
  if (!process.env.DEMO_NO_OPEN) exec(`start "" "${link}"`);
}

for (const friend of cast) friend.cookie = await join(friend.name);
let turn = Number(process.env.DEMO_TURN) || 0;
const tick = () => { cast.forEach((f) => apply(f, f.plan[turn % f.plan.length])); turn++; };
tick();
globalThis.chatterdayDemo = { tick };            // for scripts/screenshots.mjs, which moves everyone on by itself
if (!process.env.DEMO_HOLD) setInterval(tick, STEP * 1000);      // DEMO_HOLD=1 keeps everyone where they are, for taking pictures
