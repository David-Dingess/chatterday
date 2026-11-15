// What can THIS PC capture and send when it shares a screen at 1080p / 60? A measurement, not a test.
// It opens the desktop app against the TEST server (port 4478, which must already be running: node scripts/test-server.mjs,
// and it signs in as Sam, one of the two people that makes), fills the window with
// something that changes on every frame, shares the monitor the window is on at 1080p60, and prints what was captured
// and what was sent, once for each way of sending it. Nothing here touches the real server or real voice chat.
// It uses the real screen and the real microphone (in the test server's own voice chat, where nobody else is): the
// browser's fake devices, which the smoke test uses, also swap the screen for a made-up one at 20 frames a second.
// Usage: node scripts/share-probe.mjs            (the window opens on the monitor above the main one, like the smoke test)
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';

const root = path.resolve(import.meta.dirname, '..');
// The test server (scripts/test-server.mjs) makes two people, Robin and Sam, with this password.
const password = 'smoke-test-password';
const PORT = process.env.SMOKE_PORT ?? '4478';
const ORIGIN = `http://localhost:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Each way of sending the picture that is worth comparing. {} is how the app sends it today.
const WAYS = [
  ['as the app sends it now', {}],
  ['the same, one copy only (no small copy for small windows)', { simulcast: false }],
  ['H.264', { codec: 'h264' }],
  ['H.264, one copy only', { codec: 'h264', simulcast: false }],
  ['VP9', { codec: 'vp9' }],
  ['AV1', { codec: 'av1' }],
];

const profile = path.join(os.tmpdir(), 'chatterday-probe-profile');
fs.rmSync(profile, { recursive: true, force: true });
fs.mkdirSync(profile, { recursive: true });
fs.writeFileSync(path.join(profile, 'config.json'), JSON.stringify({ serverUrl: ORIGIN }));
const exe = path.join(root, 'desktop', 'node_modules', 'electron', 'dist', 'electron.exe');
// PROBE_ARGS: extra switches for the app, to try a browser feature (for example --enable-features=AllowWgcScreenCapturer).
// PROBE_ONLY=1: just the first way.
const extra = (process.env.PROBE_ARGS ?? '').split(' ').filter(Boolean);
if (process.env.PROBE_ONLY) WAYS.length = Number(process.env.PROBE_ONLY);
// PROBE_TRIAL='{"video":{...}}': one way of your own (the same settings localStorage.cd_share takes).
if (process.env.PROBE_TRIAL) WAYS.splice(0, WAYS.length, ['trial ' + process.env.PROBE_TRIAL, JSON.parse(process.env.PROBE_TRIAL)]);
const child = spawn(exe, ['--inspect=9336', path.join(root, 'desktop'), '--remote-debugging-port=9335', '--hidden', '--disable-features=CalculateNativeWinOcclusion', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', ...extra], {
  env: { ...process.env, CHATTERDAY_PROFILE: profile, CHATTERDAY_FAKE_MEDIA: '', CHATTERDAY_UPDATE_DRY: '0.0.1' }, stdio: 'ignore',
});

async function inMain(expression) {
  const [target] = await (await fetch('http://127.0.0.1:9336/json')).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  const reply = await new Promise((res) => { ws.on('message', (raw) => res(JSON.parse(raw))); ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } })); });
  ws.close();
  return reply.result?.result?.value;
}
let cdp, seq = 0;
const pending = new Map();
async function attach() {
  for (let i = 0; i < 60; i++) {
    try {
      const targets = await (await fetch('http://127.0.0.1:9335/json')).json();
      const page = targets.find((t) => t.type === 'page' && t.url.startsWith(ORIGIN));
      if (page) {
        cdp = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => { cdp.on('open', res); cdp.on('error', rej); });
        cdp.on('message', (raw) => { const m = JSON.parse(raw); pending.get(m.id)?.(m); pending.delete(m.id); });
        return;
      }
    } catch { /* not up yet */ }
    await sleep(500);
  }
  throw new Error('Electron window never appeared');
}
async function js(expression) {
  const id = ++seq;
  const reply = new Promise((res) => pending.set(id, res));
  cdp.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: `(async () => { ${expression} })()`, awaitPromise: true, returnByValue: true, userGesture: true } }));
  const m = await reply;
  if (m.result?.exceptionDetails) throw new Error(m.result.exceptionDetails.exception?.description ?? 'page error');
  return m.result?.result?.value;
}

try {
  await attach();
  // on the monitor above the main one, filling it; and which screen in the picker that monitor is
  const where = await inMain(`(async () => {
    const { screen, BrowserWindow, desktopCapturer } = process.mainModule.require('electron');
    const main = screen.getPrimaryDisplay();
    const above = screen.getAllDisplays().filter((d) => d.workArea.y + d.workArea.height <= main.bounds.y + 1).sort((a, b) => b.workArea.y - a.workArea.y)[0];
    const d = ${JSON.stringify(process.env.SMOKE_DISPLAY ?? '')} === 'main' || !above ? main : above;
    const win = BrowserWindow.getAllWindows()[0];
    win.setBounds(d.workArea);
    win.show();
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
    const source = sources.find((s) => String(s.display_id) === String(d.id)) ?? sources[0];
    return { name: source.name, monitor: d.size.width * d.scaleFactor + 'x' + d.size.height * d.scaleFactor + ' at ' + d.displayFrequency + ' Hz, scaled ' + Math.round(d.scaleFactor * 100) + '%', top: d === above };
  })()`);
  // PROBE_WINDOW=1: share the test window itself (as a window) instead of the whole monitor: windows are captured another way
  if (process.env.PROBE_WINDOW) { where.name = 'Chatterday'; where.monitor = 'this window, ' + where.monitor; }
  if (extra.length) console.log(`With ${extra.join(' ')}`);
  console.log(`Sharing ${where.name} (${where.monitor}; ${where.top ? 'the monitor above the main one' : 'the main monitor'}) at 1080p60.\n`);

  await js(`
    await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Sam', password: ${JSON.stringify(password)}, device: 'share probe' }) });
    const p = JSON.parse(localStorage.getItem('cd_prefs') ?? '{}'); p.shareQuality = '1080p60'; p.chimes = false; localStorage.setItem('cd_prefs', JSON.stringify(p)); localStorage.setItem('cd_prefs_at', String(Date.now() + 86400000));
    localStorage.setItem('cd_share', '{"dynacast":false}');`);
  await js(`location.href = '/'`).catch(() => {});
  await sleep(2500);
  await attach();
  // something that changes all over, every frame, the way a game does
  await js(`
    const c = document.createElement('canvas'); c.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:99999;pointer-events:none;opacity:0.92';
    c.width = 960; c.height = 540; document.body.append(c);
    const g = c.getContext('2d'); let t = 0; window.probeFrames = 0;
    const draw = () => { t++; window.probeFrames++;
      for (let i = 0; i < 48; i++) { g.fillStyle = 'hsl(' + ((i * 37 + t * 5) % 360) + ' 70% ' + (30 + (i * 13 + t) % 40) + '%)'; g.fillRect(((i * 97 + t * (3 + i % 7)) % 1100) - 140, (i * 53 + t * (i % 5)) % 540, 140, 60); }
      requestAnimationFrame(draw); };
    draw();`);
  await js(`[...document.querySelectorAll('.chan')].find((b) => b.textContent.includes('Voice Chat')).click()`);
  await sleep(5000);
  const f0 = await js(`return window.probeFrames`); await sleep(2000);
  console.log(`The window is drawing ${Math.round((await js(`return window.probeFrames`) - f0) / 2)} new frames a second.\n`);

  for (const [label, trial] of WAYS) {
    await js(`localStorage.setItem('cd_share', ${JSON.stringify(JSON.stringify({ ...trial, dynacast: false }))})`);
    await js(`document.querySelector('.voicebar-buttons button:nth-child(3)').click()`);
    await js(`for (let i = 0; i < 40 && !document.querySelector('.source-grid button'); i++) await new Promise((r) => setTimeout(r, 250));
      const all = [...document.querySelectorAll('.source-grid button')]; (all.find((b) => b.textContent.includes(${JSON.stringify(where.name)})) ?? all[0]).click()`);
    await sleep(12000);
    await js(`await window.fcShareStats()`);
    await sleep(10000);
    const lines = await js(`return await window.fcShareStats()`);
    console.log(`${label}:\n  ${(lines[0] ?? 'nothing was sent').replace(/^is sending /, '').replace(/; /g, '\n  ').replace(/ \| /g, '\n  ')}\n`);
    await js(`document.querySelector('.voicebar-buttons button:nth-child(3)').click()`);
    await sleep(2500);
  }
  await js(`localStorage.removeItem('cd_share')`);
} catch (e) {
  console.error('probe failed:', e.message);
} finally {
  child.kill();
  process.exit(0);
}
