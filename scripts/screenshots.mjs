// Takes the pictures in the README: starts the demo (throwaway data, pretend friends), opens it in a browser nobody
// sees, and saves what it shows to docs/screenshots.
//
//     npm run build
//     node scripts/screenshots.mjs
//
// It needs Chrome or Edge (it looks in the usual places; BROWSER=<path to the .exe> says where otherwise).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';

process.env.PORT ??= '4480';
process.env.CHATTERDAY_LK_PORT ??= '7895';
process.env.DEMO_NO_OPEN = '1';
process.env.DEMO_HOLD = '1';                       // everyone stays where they are; this script moves them on
const base = `http://localhost:${process.env.PORT}`;
await import('./demo.mjs');
const demo = globalThis.chatterdayDemo;

const out = path.resolve(import.meta.dirname, '..', 'docs', 'screenshots');
fs.mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const exe = [process.env.BROWSER, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].find((p) => p && fs.existsSync(p));
if (!exe) { console.error('No Chrome or Edge found. Set BROWSER to the path of one.'); process.exit(1); }
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'chatterday-shots-'));
const W = 1320, H = 840, DEBUG = 9555;
const browser = spawn(exe, ['--headless=new', `--remote-debugging-port=${DEBUG}`, `--user-data-dir=${profile}`, `--window-size=${W},${H}`, '--hide-scrollbars', '--no-first-run',
  '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: 'ignore' });

// ── talking to the browser (the Chrome DevTools protocol, over one WebSocket) ──
let target;
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200);
  target = await fetch(`http://127.0.0.1:${DEBUG}/json`).then((r) => r.json()).then((list) => list.find((t) => t.type === 'page')).catch(() => null);
}
if (!target) { console.error('The browser did not start.'); browser.kill(); process.exit(1); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
let ids = 0;
const waiting = new Map();
ws.on('message', (raw) => { const d = JSON.parse(raw.toString()); if (d.id && waiting.has(d.id)) { waiting.get(d.id)(d); waiting.delete(d.id); } });
const cdp = (method, params = {}) => new Promise((res) => { const id = ++ids; waiting.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
/** Runs a few lines in the page and gives back what they return. */
const js = async (body) => {
  const r = await cdp('Runtime.evaluate', { expression: `(async () => { ${body} })()`, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? 'the page threw');
  return r.result?.result?.value;
};
const go = async (url, wait = 2500) => { await cdp('Page.navigate', { url }); await sleep(wait); };
/** Signs in as the demo's admin. (From a blank page: going from one address in the app to another only changes the part after the #, which loads nothing.) */
const signIn = async () => { await go('about:blank', 300); await go(`${base}/#/login/Avery/demo-password`, 4000); };
const shot = async (name) => {
  const r = await cdp('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(out, `${name}.png`), Buffer.from(r.result.data, 'base64'));
  console.log('  saved', name + '.png');
};
const click = (text, within = 'button') => js(`const b = [...document.querySelectorAll(${JSON.stringify(within)})].find((x) => x.textContent.trim().startsWith(${JSON.stringify(text)})); if (!b) throw new Error('no button: ' + ${JSON.stringify(text)}); b.click(); await new Promise((r) => setTimeout(r, 500));`);
/** Clicks a spot in the house, given in the room's own dots (clubhouse.gen.ts), as a real mouse click would. */
const clickRoom = async (x, y) => {
  const at = await js(`const r = document.querySelector('.club').getBoundingClientRect(); return { x: r.left + ${x} * r.width / ${528}, y: r.top + ${y} * r.height / ${334} };`);
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await cdp('Input.dispatchMouseEvent', { type, x: at.x, y: at.y, button: 'left', clickCount: 1 });
  await sleep(1500);
};
const post = (url, body) => js(`const r = await fetch(${JSON.stringify(url)}, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: ${JSON.stringify(JSON.stringify(body))} }); return r.json();`);

await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });

try {
  // ── a brand-new server, as the person setting it up sees it. (The demo already has people in it, so the page
  //    is told otherwise for this one picture.) ──
  const fresh = await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `const real = window.fetch; window.fetch = (u, o) => String(u).endsWith('/api/hello') ? Promise.resolve(new Response(JSON.stringify({ serverName: 'Chatterday', needsSetup: true, local: true }), { headers: { 'Content-Type': 'application/json' } })) : real(u, o);` });
  await go(base + '/');
  await shot('setup');
  await cdp('Page.removeScriptToEvaluateOnNewDocument', { identifier: fresh.result.identifier });

  // ── the house, as the admin: an afternoon with most people in ──
  await signIn();
  await go(`${base}/?hour=15`, 9000);                           // long enough for everyone to walk to where they are going
  await shot('house');

  // ── the same, with the chat open ──
  await click('#Text Chat', '.channels button');
  await sleep(1500);
  await shot('chat');
  await click('#Text Chat', '.channels button');

  // ── movie night: somebody shares a screen, and everyone in voice takes a seat in the theatre ──
  for (let k = 0; k < 3; k++) { demo.tick(); await sleep(700); }
  await go(`${base}/?hour=21`, 16000);
  await shot('theatre');

  // ── the game table and the arcade machine, opened by clicking them in the room ──
  await go(`${base}/?hour=15`, 6000);
  await clickRoom(276, 256);                                     // the table top (CLUB.games)
  await shot('games');
  await go(`${base}/?hour=15`, 6000);
  await clickRoom(16, 196);                                      // the arcade cabinet (CLUB.arcade.hit)
  await sleep(1500);
  await shot('arcade');
  await go(`${base}/?hour=15`, 4000);

  // ── the builders and the admin's pages ──
  await js(`document.querySelector('button[title="Settings"]').click(); await new Promise((r) => setTimeout(r, 900));`);
  await click('Clothes', '.builder-parts .seg button');
  await shot('character');
  await click('Pet', '.settings nav button');
  await shot('pet');
  await click('Desk', '.settings nav button');
  await shot('desk');
  await click('Admin', '.settings nav button');
  await sleep(600);
  await shot('admin');

  // ── downstairs and outside: everybody online goes down the stairs (or out of the door) together ──
  const FLOORS = [['gameroom', 22, 233, 15], ['karaoke', 22, 233, 15], ['dnd', 22, 233, 15], ['outside', 36, 178, 21], ['backyard', 492, 161, 15],
    ['lake', 202, 314, 15], ['minigolf', 474, 326, 15]];
  for (const [fit, x, y, hour] of FLOORS) {
    await go(`${base}/?hour=${hour}`, 3000);
    await demo.floor(fit, x, y);
    await sleep(5000);
    await shot(fit);
  }
  await demo.floor('', 260, 200);

  // ── somebody new, with an invite: the welcome flow ──
  const invite = await post('/api/invites', { label: 'for Dana', hours: 72 });
  await post('/api/logout', {});
  await post('/api/redeem', { code: invite.code, name: 'Dana', password: 'demo-password', device: 'screenshots' });
  await go('about:blank', 300);
  await go(base + '/', 3000);
  await shot('welcome');
} finally {
  ws.close();
  browser.kill();
  await sleep(500);
  fs.rmSync(profile, { recursive: true, force: true });
}
console.log('Pictures are in', out);
process.exit(0);
