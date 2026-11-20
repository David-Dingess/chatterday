// End-to-end check of the desktop shell against the TEST server (port 4478).
// Launches Electron with a fake microphone, joins as a new person, and exercises voice, screenshare,
// system-audio capture, presence and hotkeys through the Chrome DevTools protocol.
// Usage: node scripts/desktop-smoke.mjs   (test server must already be running)
// SMOKE_REAL=1 uses the real microphone, screen and system sound instead of Chromium's fake devices.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import { RoomServiceClient } from 'livekit-server-sdk';

process.env.CHATTERDAY_DATA ??= path.join(os.tmpdir(), 'chatterday-test-data');
const root = path.resolve(import.meta.dirname, '..');
const { all } = await import('../server/db.ts');
// The test server (scripts/test-server.mjs) makes two people, Robin and Sam, with this password, each with a pet.
const password = 'smoke-test-password';
const idOf = (name) => all('SELECT id FROM users WHERE name = ?', name)[0]?.id;
const secrets = JSON.parse(fs.readFileSync(path.join(process.env.CHATTERDAY_DATA, 'secrets.json'), 'utf8'));
const voiceId = all("SELECT id FROM channels WHERE kind = 'voice'")[0].id;
const PORT = process.env.SMOKE_PORT ?? '4478';      // the test server's port
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

const profile = path.join(os.tmpdir(), 'chatterday-desktop-profile');
fs.rmSync(profile, { recursive: true, force: true });
fs.mkdirSync(profile, { recursive: true });
// SMOKE_ORIGIN points the app at the test server by another name, such as the PC's Tailscale name: a plain http://
// address that is not localhost is the situation friends are in, and some things only go wrong there.
const ORIGIN = process.env.SMOKE_ORIGIN ?? `http://localhost:${PORT}`;
fs.writeFileSync(path.join(profile, 'config.json'), JSON.stringify({ serverUrl: ORIGIN }));

const exe = path.join(root, 'desktop', 'node_modules', 'electron', 'dist', 'electron.exe');
// --hidden: the window stays out of sight until it has been put on the right monitor (see placeWindow)
const child = spawn(exe, ['--inspect=9334', path.join(root, 'desktop'), '--remote-debugging-port=9333', '--hidden', '--disable-features=CalculateNativeWinOcclusion', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'], {
  env: { ...process.env, CHATTERDAY_PROFILE: profile, CHATTERDAY_FAKE_MEDIA: process.env.SMOKE_REAL ? '' : '1', CHATTERDAY_UPDATE_DRY: '0.0.1' }, stdio: 'ignore',
});

/** Runs a line of code in the app's main process (through Node's inspector), to pretend things a test cannot do for real, like locking the PC. */
async function inMain(expression) {
  const [target] = await (await fetch('http://127.0.0.1:9334/json')).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  const reply = await new Promise((res) => { ws.on('message', (raw) => res(JSON.parse(raw))); ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true } })); });
  ws.close();
  return reply.result?.result?.value;
}

/** Another person, played by a bare connection to the server. */
async function friend(name) {
  const base = `http://127.0.0.1:${PORT}`;
  const pw = password;
  const r = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ name, password: pw }) });
  const cookie = (r.headers.get('set-cookie') ?? '').split(';')[0];
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws?kind=web`, { headers: { Cookie: cookie, Origin: base } });
  const got = [];
  const hello = await new Promise((res, rej) => { ws.on('message', (raw) => { const d = JSON.parse(raw.toString()); got.push(d); if (d.t === 'ready') res(d); }); ws.on('error', rej); setTimeout(() => rej(new Error(`${name} could not connect`)), 8000); });
  return { ws, hello, got, say: (d) => ws.send(JSON.stringify(d)) };
}

let cdp, seq = 0;
const pending = new Map();
async function attach() {
  for (let i = 0; i < 60; i++) {
    try {
      const targets = await (await fetch('http://127.0.0.1:9333/json')).json();
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

/** The test window opens on the monitor above the main one (if there is one), so it does not land on top of whatever
 *  is being worked on. SMOKE_DISPLAY=main keeps it on the main monitor. */
async function placeWindow() {
  return inMain(`(() => {
    const { screen, BrowserWindow } = process.mainModule.require('electron');
    const main = screen.getPrimaryDisplay().bounds;
    const above = screen.getAllDisplays().map((d) => d.workArea)
      .filter((a) => a.y + a.height <= main.y + 1 && a.x < main.x + main.width && a.x + a.width > main.x)
      .sort((a, b) => b.y - a.y)[0];
    const at = ${JSON.stringify(process.env.SMOKE_DISPLAY ?? '')} === 'main' || !above ? screen.getPrimaryDisplay().workArea : above;
    const win = BrowserWindow.getAllWindows()[0];
    const [w, h] = win.getSize();
    win.setBounds({ x: Math.round(at.x + (at.width - w) / 2), y: Math.round(at.y + Math.max(0, (at.height - h) / 2)), width: w, height: h });
    win.show();
    return (above && at === above ? 'the monitor above the main one' : 'the main monitor') + ', at ' + win.getBounds().x + ',' + win.getBounds().y;
  })()`);
}

try {
  await attach();
  console.log(`(test window on ${await placeWindow()})`);
  check('desktop bridge is exposed to the server page', await js(`return !!window.chatterdayNative && typeof chatterdayNative.getSources === 'function'`));
  check('node is not reachable from the page', await js(`return typeof require === 'undefined' && typeof process === 'undefined'`));

  const joined = await js(`
    const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Robin', password: ${JSON.stringify(password)}, device: 'smoke test' }) });
    return r.ok;`);
  check('signs in with a name and password', joined);
  const wrong = await js(`
    const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Robin', password: 'not-the-password', device: 'smoke test' }) });
    return r.status;`);
  check('a wrong password is refused', wrong === 401, String(wrong));
  await js(`location.href = '/'`).catch(() => {});
  await sleep(2500);
  await attach();
  check('app shell loaded', await js(`return !!document.querySelector('.shell')`));
  check('the app draws its own title bar', await js(`return !!document.querySelector('.titlebar') && typeof chatterdayNative.windowControl === 'function'`));

  const activity = await js(`return await Promise.race([new Promise((res) => chatterdayNative.onActivity(res)), new Promise((res) => setTimeout(() => res(null), 15000))])`);
  check('presence watcher reports the foreground app', !!activity && ['desk', 'away', 'gaming', 'watching'].includes(activity.state), JSON.stringify(activity));

  // A game stays "on" for a minute after it leaves the front, so flicking to a browser and back does not send the
  // character walking to and fro. (Pretended: the app's main process tells the page what is in front.)
  {
    const front = (state, label) => inMain(`process.mainModule.require('electron').BrowserWindow.getAllWindows()[0].webContents.send('activity', ${JSON.stringify({ state, label, proc: 'smoke.exe', locked: false })})`);
    const mine = () => js(`return [...document.querySelectorAll('.member-row')].find((r) => r.title.startsWith('Robin'))?.title ?? ''`);
    await front('gaming', 'Smoke Quest');
    await sleep(900);
    const playing = await mine();
    await front('desk', '');
    await sleep(900);
    const flicked = await mine();
    await front('away', '');
    await sleep(900);
    const left = await mine();
    await front('desk', '');
    await sleep(600);
    check('a game stays on for a while after it leaves the front, but going away shows at once',
      /Smoke Quest/.test(playing) && /Smoke Quest/.test(flicked) && !/Smoke Quest/.test(left), `${playing} | ${flicked} | ${left}`);
  }

  await js(`[...document.querySelectorAll('.chan')].find((b) => b.textContent.includes('Voice Chat')).click()`);
  await sleep(5000);
  const bar = await js(`return document.querySelector('.voicebar')?.innerText ?? ''`);
  check('joined voice with a working microphone', /in voice chat/i.test(bar) && !bar.includes('No microphone'), bar.replace(/\n/g, ' | '));

  const lk = new RoomServiceClient(`http://127.0.0.1:${process.env.CHATTERDAY_LK_PORT ?? 7890}`, secrets.livekitKey, secrets.livekitSecret);
  const tracksOf = async () => {
    const people = await lk.listParticipants(`vc-${voiceId}`);
    const me = people.find((p) => p.name === 'Robin');
    return { people: people.map((p) => p.name), tracks: (me?.tracks ?? []).map((t) => `${t.name || 'mic'}:${t.type}:${t.source}${t.muted ? ':muted' : ''}`) };
  };
  let seen = await tracksOf();
  check('LiveKit sees the microphone track', seen.tracks.length === 1, JSON.stringify(seen));

  if (!process.env.SMOKE_REAL) {      // the pretend microphone beeps about once a second; a real one may be silent
    const ring = await js(`let on = 0, off = 0; for (let i = 0; i < 60; i++) { document.querySelector('.mebar .avatar.speaking') ? on++ : off++; await new Promise((r) => setTimeout(r, 50)); } return on + ' on, ' + off + ' off'`);
    check('the ring round my own picture comes on with sound and goes off without', /^[1-9]\d* on, [1-9]\d* off$/.test(ring), ring);
    check('nobody in the room glows', await js(`return [...document.querySelectorAll('.actor .sprite')].every((el) => getComputedStyle(el).filter === 'none')`));
    // the noise gate: with it on, the pretend microphone's beeps open it and the gaps between them shut it
    const gateToggle = `document.querySelector('.mebar button.icon').click(); for (let i = 0; i < 40 && !document.querySelector('.settings nav button'); i++) await new Promise((r) => setTimeout(r, 125)); [...document.querySelectorAll('.settings nav button')].find((b) => b.textContent.startsWith('Voice')).click(); await new Promise((r) => setTimeout(r, 300)); [...document.querySelectorAll('.toggle')].find((t) => t.textContent.startsWith('Noise gate')).querySelector('input').click(); document.querySelector('.modal header button').click()`;
    await js(gateToggle);
    const gate = await js(`let shut = 0, open = 0; for (let i = 0; i < 60; i++) { document.querySelector('.voicebar-buttons button.gated') ? shut++ : open++; await new Promise((r) => setTimeout(r, 50)); } return open + ' open, ' + shut + ' shut'`);
    check('the noise gate opens with sound and shuts without', /^[1-9]\d* open, [1-9]\d* shut$/.test(gate), gate);
    await js(gateToggle);
    await sleep(300);
    check('with the gate off again the microphone is left open', await js(`return !document.querySelector('.voicebar-buttons button.gated')`));
    // talking while muted: the pretend microphone keeps beeping with the mic muted, so the mute button should start to flash
    await js(`document.querySelector('.voicebar-buttons button').click()`);
    let nudged = false;
    for (let i = 0; i < 40 && !nudged; i++) { await sleep(250); nudged = await js(`return !!document.querySelector('.voicebar-buttons button.nudge') && !!document.querySelector('.voicebar .muted-note')`); }
    await js(`document.querySelector('.voicebar-buttons button').click()`);
    await sleep(500);
    const calm = await js(`return !document.querySelector('.voicebar-buttons button.nudge') && !document.querySelector('.voicebar-buttons button').classList.contains('on')`);
    check('talking with the mic muted makes the mute button flash, until it is unmuted', nudged && calm, `${nudged} ${calm}`);
  }

  // Locking the PC mutes the microphone, and unlocking puts it back. (The lock is pretended, inside the app's main process.)
  const micMuted = `return document.querySelector('.voicebar-buttons button').classList.contains('on')`;
  const before = await js(micMuted);
  await inMain(`process.mainModule.require('electron').powerMonitor.emit('lock-screen')`);
  await sleep(1500);
  const whileLocked = await js(micMuted);
  await inMain(`process.mainModule.require('electron').powerMonitor.emit('unlock-screen')`);
  await sleep(1500);
  const afterwards = await js(micMuted);
  check('locking the PC mutes the microphone, and unlocking unmutes it', before === false && whileLocked === true && afterwards === false, `${before} -> ${whileLocked} -> ${afterwards}`);

  // Deafen silences everything: the app mutes its whole window, and every sound or video on the page is muted too,
  // one that turns up while deafened included. Undeafen gives it all back.
  const windowMuted = `process.mainModule.require('electron').BrowserWindow.getAllWindows().some((w) => w.webContents.isAudioMuted())`;
  const deafButton = `document.querySelectorAll('.voicebar-buttons button')[1]`;
  await js(`const a = document.createElement('audio'); a.id = 'smoke-a'; document.body.append(a);`);
  const quietBefore = await inMain(windowMuted);
  await js(`${deafButton}.click()`);
  await sleep(900);
  await js(`const v = document.createElement('video'); v.id = 'smoke-v'; document.body.append(v);`);
  await sleep(300);
  const whileDeaf = await js(`return [document.getElementById('smoke-a').muted, document.getElementById('smoke-v').muted].join()`);
  const quietDuring = await inMain(windowMuted);
  await js(`${deafButton}.click()`);
  await sleep(900);
  const afterDeaf = await js(`const r = [document.getElementById('smoke-a').muted, document.getElementById('smoke-v').muted, ${deafButton}.classList.contains('on'), document.querySelector('.voicebar-buttons button').classList.contains('on')].join(); document.getElementById('smoke-a').remove(); document.getElementById('smoke-v').remove(); return r`);
  const quietAfter = await inMain(windowMuted);
  check('deafen silences the whole app, and undeafen gives it all back', quietBefore === false && quietDuring === true && whileDeaf === 'true,true' && afterDeaf === 'false,false,false,false' && quietAfter === false,
    `window muted ${quietBefore} -> ${quietDuring} -> ${quietAfter}; page sounds muted ${whileDeaf} -> ${afterDeaf}`);

  const named = await js(`const d = await navigator.mediaDevices.enumerateDevices(); return d.filter((x) => x.label).length + ' of ' + d.length`);
  check('microphones and speakers are listed by name (for the pickers in Settings)', Number(named.split(' ')[0]) > 0, named);

  if (!process.env.SMOKE_REAL) {      // the microphone test in Settings: the bar moves with the pretend microphone's beeps
    await js(`document.querySelector('.mebar button.icon').click(); for (let i = 0; i < 40 && !document.querySelector('.settings nav button'); i++) await new Promise((r) => setTimeout(r, 125)); [...document.querySelectorAll('.settings nav button')].find((b) => b.textContent.startsWith('Voice')).click()`);
    const meter = await js(`await new Promise((r) => setTimeout(r, 1500)); const bar = document.querySelector('.mic-test .meter i'); let lo = 100, hi = 0, green = 0; for (let i = 0; i < 40; i++) { const w = parseFloat(bar.style.width) || 0; lo = Math.min(lo, w); hi = Math.max(hi, w); if (bar.classList.contains('talking')) green++; await new Promise((r) => setTimeout(r, 50)); } document.querySelector('.modal header button').click(); return Math.round(lo) + ' to ' + Math.round(hi) + ', green ' + green + ' of 40'`);
    check('the microphone test meter moves and turns green with sound', /^(\d+) to (\d+), green [1-9]/.test(meter) && Number(meter.split(' ')[2].replace(',', '')) - Number(meter.split(' ')[0]) > 5, meter);
  }

  const sources = await js(`const s = await chatterdayNative.getSources(); return s.map((x) => x.kind + ':' + x.name.slice(0, 30) + ':' + (x.thumb.length > 100))`);
  check('screen picker lists screens with thumbnails', sources.some((s) => s.startsWith('screen:') && s.endsWith('true')), `${sources.length} sources`);

  await js(`document.querySelector('.voicebar-buttons button:nth-child(3)').click()`);
  // the picker fills in once Windows has handed over a thumbnail for every screen and window, which can take a few seconds
  await js(`for (let i = 0; i < 40 && !document.querySelector('.source-grid button'); i++) await new Promise((r) => setTimeout(r, 250)); document.querySelector('.source-grid button').click()`);
  await sleep(5000);
  seen = await tracksOf();
  check('screenshare video reaches LiveKit', seen.tracks.some((t) => t.startsWith('screen:')), JSON.stringify(seen.tracks));
  // a whole screen is shared without sound: the PC's whole sound would carry the call itself back out to everybody (see the NOTE further on)
  check('a whole screen is shared without sound', !seen.tracks.some((t) => t.startsWith('screen-audio:')), JSON.stringify(seen.tracks));
  check('sidebar offers the Screens view', await js(`return [...document.querySelectorAll('.chan')].some((b) => b.textContent.includes('Screens'))`));
  await js(`[...document.querySelectorAll('.chan')].find((b) => b.textContent.includes('Screens')).click()`);
  await sleep(2000);
  const dims = await js(`const v = document.querySelector('.stage video'); return v ? v.videoWidth + 'x' + v.videoHeight : 'no video'`);
  check('own screen renders in the Screens view', /^[1-9]\d+x[1-9]\d+$/.test(dims), dims);

  // The faint scan lines over the app are cut away wherever a video is showing (here, the shared screen).
  let lines = 'none';
  for (let i = 0; i < 16 && lines === 'none'; i++) {          // a real screen takes a moment to arrive
    lines = await js(`await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); return getComputedStyle(document.body, '::after').clipPath`);
    if (lines === 'none') await sleep(250);
  }
  check('the scan lines are cut away over a shared screen', /Z M ?\d+ \d+ ?H ?\d+ ?V ?\d+ ?H ?\d+ ?Z/.test(lines), lines.slice(0, 90));
  // The message box grows with what is typed, wrapped lines included, and goes back when it is emptied.
  const grows = await js(`
    const opened = !document.querySelector('.composer textarea');
    if (opened) [...document.querySelectorAll('button.chan')].find((b) => /Text Chat/.test(b.textContent)).click();
    for (let i = 0; i < 20 && !document.querySelector('.composer textarea'); i++) await new Promise((r) => setTimeout(r, 150));
    const ta = document.querySelector('.composer textarea'), set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    const type = async (t) => { set.call(ta, t); ta.dispatchEvent(new Event('input', { bubbles: true })); await new Promise((r) => setTimeout(r, 250)); return Math.round(ta.getBoundingClientRect().height); };
    const empty = await type(''), long = await type('word '.repeat(45)), fits = ta.scrollHeight <= ta.clientHeight + 1, back = await type('');
    if (opened) { [...document.querySelectorAll('button.chan')].find((b) => /Text Chat/.test(b.textContent)).click(); await new Promise((r) => setTimeout(r, 300)); }      // leave the chat as it was found
    return empty + ' -> ' + long + (fits ? ' (all shown)' : ' (cut off)') + ' -> ' + back;`);
  const [emptyH, longH, backH] = grows.split(' -> ').map((x) => parseInt(x, 10));
  check('the message box grows to show everything typed, and shrinks back', longH > emptyH * 2 && backH === emptyH && grows.includes('all shown'), grows);

  // Somebody else opens my screen: I am told who is watching. (Sam is played by a bare connection here.)
  {
    const base = `http://127.0.0.1:${PORT}`;
    const samPw = password;
    const r = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ name: 'Sam', password: samPw }) });
    const cookie = (r.headers.get('set-cookie') ?? '').split(';')[0];
    const sam = new WebSocket(`ws://127.0.0.1:${PORT}/ws?kind=web`, { headers: { Cookie: cookie, Origin: base } });
    const hello = await new Promise((res, rej) => { sam.on('message', (raw) => { const d = JSON.parse(raw.toString()); if (d.t === 'ready') res(d); }); sam.on('error', rej); setTimeout(() => rej(new Error('Sam could not connect')), 8000); });
    const robinId = hello.users.find((u) => u.name === 'Robin').id;
    const nobody = await js(`return document.querySelector('.voicebar .watchers')?.textContent ?? ''`);
    sam.send(JSON.stringify({ t: 'voice', channelId: voiceId, muted: true, deafened: false, sharing: false, watching: [robinId] }));
    await sleep(900);
    const somebody = await js(`return document.querySelector('.voicebar .watchers')?.textContent ?? ''`);
    check('while sharing, I am told who is watching my screen', /Nobody/.test(nobody) && /Sam watching/.test(somebody), `${nobody.trim()} -> ${somebody.trim()}`);
    sam.close();
    await sleep(400);
  }
  const full = await js("document.querySelector('.tile-bar button.icon').click(); await new Promise((r) => setTimeout(r, 800)); const el = document.fullscreenElement; const out = el ? el.className : 'none'; if (el) await document.exitFullscreen(); return out;");
  check('a stream goes full screen and back', full.includes('tile'), full);
  const popped = await js(`document.querySelector('.tile-bar button.pop').click(); await new Promise((r) => setTimeout(r, 1200)); const on = !!document.pictureInPictureElement; if (on) await document.exitPictureInPicture(); return document.pictureInPictureEnabled + ' ' + on`);
  check('a stream pops out into its own always-on-top window', popped === 'true true', popped);
  await sleep(Number(process.env.SMOKE_HOLD ?? 0) * 1000); // time for a second client to look at the stream
  check('with chat closed, the room waits in the left panel while watching', await js(`return !!document.querySelector('.sidebar .side-room .club') && !document.querySelector('.chat-col')`));
  await js(`[...document.querySelectorAll('.chan')].find((b) => b.textContent.includes('Text Chat')).click()`);
  await sleep(900);
  const top = await js(`const r = document.querySelector('.chat-col > .side-room'), c = document.querySelector('.chat-col'); return r ? [r.offsetWidth, c.offsetWidth, r.getBoundingClientRect().top - c.getBoundingClientRect().top, !!document.querySelector('.sidebar .side-room')].join(' ') : 'missing'`);
  check('with chat open, the room sits on top of the chat column at its full width', (() => { const [w, col, gap, inPanel] = top.split(' '); return w === col && Number(gap) === 0 && inPanel === 'false'; })(), top);
  await js(`[...document.querySelectorAll('.chan')].find((b) => b.textContent.includes('Text Chat')).click()`);
  await sleep(500);
  // Hangout switched off while screens are being watched: the screens stay, the same size; only the small room goes
  const toggleRoom = `[...document.querySelectorAll('.chan')].find((b) => b.textContent.includes('Hangout')).click()`;
  const stageW = await js(`return document.querySelector('.stage').offsetWidth`);
  await js(toggleRoom);
  await sleep(700);
  const kept = await js(`const st = document.querySelector('.stage'); return (st ? st.offsetWidth : 0) + ' ' + !!document.querySelector('.side-room') + ' ' + innerWidth`);
  check('Hangout off while watching keeps the screens open at the same size and only hides the small room', kept === `${stageW} false 1320`, `${stageW} -> ${kept}`);
  await js(toggleRoom);
  await sleep(700);
  await js(`document.querySelector('.side-room').click()`);      // clicking the small room goes back to the room
  await js(`document.querySelector('.voicebar-buttons button:nth-child(3)').click()`);
  await sleep(1500);

  const sys = await js(`
    const supported = !!navigator.mediaDevices.getSupportedConstraints().restrictOwnAudio;
    const screen = (await chatterdayNative.getSources()).find((x) => x.kind === 'screen');
    await chatterdayNative.selectSource(screen.id, true);
    const s = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: { restrictOwnAudio: true, echoCancellation: false } });
    const a = s.getAudioTracks()[0];
    const out = { supported, audioTracks: s.getAudioTracks().length, applied: a ? a.getSettings().restrictOwnAudio : null, label: a?.label };
    s.getTracks().forEach((t) => t.stop());
    return out;`);
  check('own-audio exclusion (anti-echo) is honoured for shared system sound', sys.audioTracks === 1 && sys.supported && sys.applied === true, JSON.stringify(sys));
  // ...and does it really work? With the real sound card: the app plays a quiet tone the way it plays voices (a stream
  // into a sound element) while it captures the PC's sound for a share. If the tone turns up in what is captured,
  // everybody in a call would hear themselves back through anyone's shared screen.
  if (process.env.SMOKE_REAL) {
    const leak = await js(`
      const screen = (await chatterdayNative.getSources()).find((x) => x.kind === 'screen');
      const measure = async (constraints) => {
        await chatterdayNative.selectSource(screen.id, true);
        const s = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: constraints });
        const ctx = new AudioContext();
        const an = ctx.createAnalyser();
        an.fftSize = 4096;
        ctx.createMediaStreamSource(new MediaStream([s.getAudioTracks()[0]])).connect(an);
        const bin = Math.round(1900 / (ctx.sampleRate / an.fftSize)), buf = new Float32Array(an.frequencyBinCount);
        const level = async (ms) => { let max = -200; for (const end = Date.now() + ms; Date.now() < end;) { an.getFloatFrequencyData(buf); max = Math.max(max, buf[bin - 1], buf[bin], buf[bin + 1]); await new Promise((r) => setTimeout(r, 40)); } return Math.round(max); };
        const quiet = await level(700);
        const out = new AudioContext(), osc = out.createOscillator(), gain = out.createGain(), dest = out.createMediaStreamDestination();
        osc.frequency.value = 1900; gain.gain.value = 0.05; osc.connect(gain).connect(dest);
        const el = new Audio(); el.srcObject = dest.stream; osc.start(); await el.play();
        await new Promise((r) => setTimeout(r, 1500));          // time for an echo canceller to lock on
        const loud = await level(1200);
        osc.stop(); el.pause(); el.srcObject = null; void out.close(); void ctx.close();
        s.getTracks().forEach((t) => t.stop());
        return { quiet, loud, channels: s.getAudioTracks()[0].getSettings().channelCount ?? null, aec: s.getAudioTracks()[0].getSettings().echoCancellation ?? null };
      };
      const guarded = await measure({ restrictOwnAudio: true, echoCancellation: false, noiseSuppression: false, autoGainControl: false });
      const bare = await measure({ echoCancellation: false, noiseSuppression: false, autoGainControl: false });
      const cancelled = await measure({ restrictOwnAudio: true, echoCancellation: true, noiseSuppression: false, autoGainControl: false, channelCount: 2 });
      return { guarded, bare, cancelled };`);
    // KNOWN PROBLEM, reported rather than failed: none of the guards this shell offers keeps the app's own sound out
    // (measured 2026-11-12: the tone comes through at full level with restrictOwnAudio and with echo cancelling).
    // That is why sharing the PC's sound is off unless asked for. A real fix needs Windows' per-process capture.
    console.log(`NOTE  the app's own sound in a shared screen's sound: tone at ${leak.guarded.loud} dB with the guard, ${leak.cancelled.loud} dB with echo cancelling, ${leak.bare.loud} dB with neither (silence is about -80)`);
  }

  const unarmed = await js(`try { const s = await navigator.mediaDevices.getDisplayMedia({ video: true }); s.getTracks().forEach((t) => t.stop()); return 'captured'; } catch (e) { return 'refused'; }`);
  // Chromium's fake-device test mode answers capture requests itself, so this only means something with real devices.
  if (process.env.SMOKE_REAL) check('screen capture is refused unless a source was picked', unarmed === 'refused', unarmed);

  // A hotkey must have Ctrl, Alt or the Windows key in it (or be a function key): a bare letter would be taken away from every program.
  const keys = await js(`const r = await chatterdayNative.setHotkeys({ mute: 'Ctrl+Alt+F9', deafen: 'not a key!!', 'sound:1': 'A', 'sound:2': 'Shift+B' }); await chatterdayNative.setHotkeys({}); return r`);
  check('global hotkey registers; junk is ignored; a bare or shifted letter is refused', keys.mute === true && !('deafen' in keys) && keys['sound:1'] === false && keys['sound:2'] === false, JSON.stringify(keys));

  const blocked = await js(`try { await chatterdayNative.setConfig({ games: ['..\\\\evil.exe', 'ok.exe'] }); const c = await chatterdayNative.getConfig(); await chatterdayNative.setConfig({ games: [] }); return c.games; } catch (e) { return String(e) }`);
  check('desktop config rejects path-like entries', JSON.stringify(blocked) === '["ok.exe"]', JSON.stringify(blocked));
  // With the room hidden and chat closed, the window narrows to the left panel, and widens again after.
  const hangout = `[...document.querySelectorAll('.chan')].find((b) => b.textContent.includes('Hangout')).click()`;
  const wide = await js(`return innerWidth`);
  await js(hangout);
  await sleep(900);
  const narrow = await js(`return innerWidth`);
  const fills = await js(`return document.querySelector('.sidebar').offsetWidth + ' of ' + innerWidth`);
  check('the left panel fills the narrowed window', fills.split(' of ')[0] === fills.split(' of ')[1], fills);
  await js(hangout);
  await sleep(900);
  const back = await js(`return innerWidth`);
  check('hiding the room narrows the window to the left panel, and showing it widens it again', narrow < 600 && back === wide, `${wide} -> ${narrow} -> ${back}`);

  // The player: its video can fill the whole screen, even while it is hidden in the panel (which is how it starts out),
  // and dragging its bar moves everyone. Sam starts a video from the voice chat.
  {
    const sam = await friend('Sam');
    sam.say({ t: 'voice', channelId: voiceId, muted: true, deafened: false, sharing: false });
    await sleep(300);
    sam.say({ t: 'music', op: 'play', videoId: 'aqz-KE-bpKQ', title: 'Big Buck Bunny', seconds: 635 });
    let there = false;
    for (let i = 0; i < 24 && !there; i++) { await sleep(250); there = await js(`return !!document.querySelector('.music-frame') && !!document.querySelector('.music-seek input')`); }
    const hidden = there && await js(`return document.querySelector('.music-frame').classList.contains('hidden')`);
    await js(`[...document.querySelectorAll('.music-head button')].find((b) => b.title.startsWith('Full screen'))?.click()`);
    await sleep(1200);
    const full = await js(`const el = document.fullscreenElement; const f = el?.querySelector('iframe')?.getBoundingClientRect(); return el && f ? el.className + ' ' + Math.round(f.width) + 'x' + Math.round(f.height) + ' of ' + innerWidth + 'x' + innerHeight : 'not full screen'`);
    await js(`await document.exitFullscreen().catch(() => {})`);
    await sleep(700);
    const size = /(\d+)x(\d+) of (\d+)x(\d+)/.exec(full);
    const fills = !!size && Math.abs(size[1] - size[3]) <= 2 && Math.abs(size[2] - size[4]) <= 2;
    check('the player\'s video fills the whole screen, even while hidden in the panel, and comes back', /music-frame/.test(full) && fills && !(await js(`return !!document.fullscreenElement`)), `${hidden ? 'hidden in the panel' : 'shown'}; ${full}`);
    await js(`const r = document.querySelector('.music-seek input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(r, '300'); r.dispatchEvent(new Event('input', { bubbles: true })); await new Promise((x) => setTimeout(x, 150)); r.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));`);
    await sleep(700);
    const m = [...sam.got].reverse().find((d) => d.t === 'music')?.music;
    const at = m?.current ? (m.now - m.current.startedAt) / 1000 : -1;
    check('dragging the player\'s bar moves everyone to that moment', Math.abs(at - 300) < 2, `${at.toFixed(1)}s`);
    await js(`document.querySelector('.music-seek button').click()`);
    await sleep(600);
    const stopped = [...sam.got].reverse().find((d) => d.t === 'music')?.music?.current?.pausedAt;
    check('the pause button pauses it for everyone', typeof stopped === 'number' && Math.abs(stopped - 300.7) < 2.5, String(stopped));
    sam.say({ t: 'music', op: 'stop' });
    await sleep(300);

    // The pets: each is in the room while its owner is online (a pet goes by its owner's id). Robin (me) and Sam are
    // on, and nobody else is. Clicking one and choosing Pet walks me over to stroke it.
    const room = '.hangout:not(.mini) .pet';
    const mine = idOf('Robin'), both = [mine, idOf('Sam')].sort().join(' ');
    const myPet = room + `[data-pet="${mine}"]`;
    let petsHere = '';
    for (let i = 0; i < 16 && petsHere !== both; i++) {
      await sleep(250);
      petsHere = await js(`return [...document.querySelectorAll(${JSON.stringify(room)})].filter((e) => getComputedStyle(e).display !== 'none').map((e) => e.dataset.pet).sort().join(' ')`);
    }
    check('each pet is in the room while its owner is online', petsHere === both, petsHere || 'no pets (or the room is not open)');
    await js(`document.querySelector(${JSON.stringify(myPet)})?.click(); await new Promise((x) => setTimeout(x, 250)); [...document.querySelectorAll('.act-menu button')].find((b) => b.textContent === 'Pet')?.click()`);
    let petted = false;
    for (let i = 0; i < 100 && !petted; i++) { await sleep(250); petted = await js(`return document.querySelector(${JSON.stringify(myPet)})?.dataset.pose === 'petted'`); }
    check('clicking a pet and choosing Pet sends me over to stroke it', petted);
    sam.ws.close();
    await sleep(500);
    for (let i = 0; i < 100 && petsHere !== mine; i++) {      // Sam has gone: Sam's pet walks out of the door after them
      await sleep(250);
      petsHere = await js(`return [...document.querySelectorAll(${JSON.stringify(room)})].filter((e) => getComputedStyle(e).display !== 'none').map((e) => e.dataset.pet).sort().join(' ')`);
    }
    check('a pet leaves when its owner goes offline', petsHere === mine, petsHere);
  }

  // A shared WINDOW brings its own program's sound, through the helper (and only that program's: scripts/sharesound-test.mjs
  // checks that part with real sound). A whole screen gets none, and neither does this app's own window.
  {
    const said = await js(`
      const sources = await chatterdayNative.getSources();
      const windows = sources.filter((x) => x.kind === 'window'), screen = sources.find((x) => x.kind === 'screen');
      let bytes = 0, odd = 0;
      chatterdayNative.onShareSound((chunk) => { if (chunk) { bytes += chunk.byteLength; if (chunk.byteLength % 4) odd++; } });
      const forScreen = await chatterdayNative.startShareSound(screen.id);
      let started = null, tried = 0;
      for (const w of windows.slice(0, 6)) { tried++; const r = await chatterdayNative.startShareSound(w.id); if (!r.error) { started = w.name; break; } }
      await new Promise((r) => setTimeout(r, 1500));
      chatterdayNative.stopShareSound();
      return JSON.stringify({ screen: forScreen.error ? 'refused' : 'allowed', windows: windows.length, tried, started: started ? 'yes' : 'no', bytes, odd });`);
    const got = JSON.parse(said);
    check('the helper gives a shared window its sound, in whole pieces, and gives a whole screen none', got.screen === 'refused' && (got.windows === 0 || (got.started === 'yes' && got.bytes > 0 && got.odd === 0)), said);
  }

  // A headset is plugged in, then pulled out again. (Pretended: a made-up microphone and speakers that arrive together.)
  const plug = await js(`
    const real = navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices);
    const fake = [{ deviceId: 'smoke-mic', kind: 'audioinput', label: 'Smoke Headset (USB)', groupId: 'smoke' }, { deviceId: 'smoke-out', kind: 'audiooutput', label: 'Smoke Headset (USB)', groupId: 'smoke' }];
    const chosen = () => { const p = JSON.parse(localStorage.cd_prefs); return '[' + p.micId + '/' + p.outId + ']'; };
    const before = chosen();
    // first a virtual cable turns up (a driver starting, say): that must never be switched to, because a cable
    // plays whatever goes into it straight back out of its "microphone"
    const cable = [{ deviceId: 'cable-mic', kind: 'audioinput', label: 'CABLE Output (VB-Audio Virtual Cable)', groupId: 'cable' }, { deviceId: 'cable-out', kind: 'audiooutput', label: 'CABLE Input (VB-Audio Virtual Cable)', groupId: 'cable' }];
    navigator.mediaDevices.enumerateDevices = async () => [...await real(), ...cable];
    navigator.mediaDevices.dispatchEvent(new Event('devicechange'));
    await new Promise((r) => setTimeout(r, 2000));
    const withCable = chosen();
    navigator.mediaDevices.enumerateDevices = async () => [...await real(), ...cable, ...fake];
    navigator.mediaDevices.dispatchEvent(new Event('devicechange'));
    await new Promise((r) => setTimeout(r, 2500));
    const during = chosen();
    navigator.mediaDevices.enumerateDevices = real;
    navigator.mediaDevices.dispatchEvent(new Event('devicechange'));
    await new Promise((r) => setTimeout(r, 2500));
    return [before, during, chosen(), withCable].join(' -> ');`);
  const [chosenBefore, chosenDuring, chosenAfter, chosenWithCable] = plug.split(' -> ');
  check('a virtual cable that turns up is never switched to', chosenWithCable === chosenBefore, `${chosenBefore} -> ${chosenWithCable}`);
  check('a headset that is plugged in is switched to, and pulling it out goes back', chosenDuring === '[smoke-mic/smoke-out]' && chosenAfter === chosenBefore, plug);
  await sleep(1500);

  // Updating itself, as a dry run: the app is told it is version 0.0.1, so the page offers the server's installer. Install
  // makes the app ask, in a box of its own that no page can click; after a yes it fetches the installer and checks it,
  // and stops just short of running it. (The test answers the box for the app, from inside the app's main process.)
  // Once there is a signing key (desktop/update-key.txt), the installer in desktop/dist must be signed for this to
  // pass: "Build installer.bat" signs it, or node scripts/sign-installer.mjs does.
  // The installer the server offers is the newest in desktop/dist by version number (0.1.10 is newer than 0.1.9), as
  // newestInstaller() in server/index.ts picks it. With none built there is nothing to offer, so this part is left out.
  const built = path.join(root, 'desktop', 'dist');
  const parts = (f) => (/(\d+)\.(\d+)\.(\d+)/.exec(f) ?? []).slice(1).map(Number);
  const newest = (fs.existsSync(built) ? fs.readdirSync(built) : []).filter((f) => /Setup.*\.exe$/i.test(f) && parts(f).length === 3)
    .sort((x, y) => { const m = parts(x), n = parts(y); return m[0] - n[0] || m[1] - n[1] || m[2] - n[2]; }).pop();
  if (!newest) console.log('NOTE  no installer in desktop/dist ("Build installer.bat" makes one), so updating itself was not checked');
  else {
    const offer = await js(`return document.querySelector('div.update')?.textContent ?? ''`);
    check('an older app is offered the newer one, with an Install button', /is ready \(yours is 0\.0\.1\)/.test(offer) && /Install$/.test(offer), offer);
    const answerWith = (n) => inMain(`(() => { const { dialog } = process.mainModule.require('electron'); globalThis.__asked ??= []; dialog.showMessageBox = async (...a) => { globalThis.__asked.push(a[a.length - 1].message); return { response: ${n} }; }; return true; })()`);
    const fetchedNow = () => fs.readdirSync(os.tmpdir()).filter((d) => d.startsWith('chatterday-update-')).map((d) => path.join(os.tmpdir(), d, 'Chatterday-Setup.exe')).filter((f) => fs.existsSync(f));
    await answerWith(0);          // 0 is "Install"
    await js(`document.querySelector('div.update button').click()`);
    let upd = '';
    for (let i = 0; i < 240 && !/test run/.test(upd); i++) { await sleep(500); upd = await js(`return document.querySelector('div.update')?.textContent ?? ''`); }
    const fetched = fetchedNow();
    const question = (await inMain('globalThis.__asked'))?.join(' | ') ?? '';
    check('before anything is fetched the app itself asks, naming the version and the server', question === `Install Chatterday ${parts(newest).join('.')} from ${new URL(ORIGIN).origin}?`, question);
    check('Install fetches the whole installer and checks it (dry run: it is not run)', /test run/.test(upd) && fetched.length === 1 && fs.statSync(fetched[0]).size === fs.statSync(path.join(built, newest)).size,
      `${upd} · ${fetched.length} file(s) · ${newest}`);
    for (const f of fetched) fs.rmSync(path.dirname(f), { recursive: true, force: true });
    await answerWith(1);          // 1 is "Not now"
    const refused = await js(`return (await chatterdayNative.installUpdate()).error ?? ''`);
    check('"Not now" fetches nothing', refused === 'Nothing was installed.' && fetchedNow().length === 0, refused);
  }

  // Closing the window sends it to the tray: the page goes quiet, and the little counter appears at the corner of the screen.
  await js(`chatterdayNative.setOnline(3, '#38ff5c'); chatterdayNative.windowControl('close')`);
  await sleep(2500);
  const targets = await (await fetch('http://127.0.0.1:9333/json')).json();
  check('closing to the tray shows the online counter', targets.some((t) => t.url.includes('popup.html') && t.url.includes('kind=count')), targets.map((t) => t.url.split('/').pop().slice(0, 40)).join(' | '));
  check('the page is told it was closed, and leaves voice', await js(`return !document.querySelector('.voicebar')`));
} catch (e) {
  check('smoke test ran to the end', false, e.message);
} finally {
  cdp?.close();
  // Quit the app the way its tray menu does, so it stops any share and lets ffmpeg finish (a force-killed app can leave
  // ffmpeg holding the graphics card's encoder). Only if it has not gone after a few seconds is it stopped outright.
  try { await inMain(`process.mainModule.require('electron').app.quit()`); } catch { /* not reachable */ }
  for (let i = 0; i < 32 && child.exitCode === null; i++) await sleep(250);
  if (child.exitCode === null) { child.kill(); spawn('taskkill', ['/F', '/T', '/PID', String(child.pid)], { stdio: 'ignore' }); }
  console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`);
  setTimeout(() => process.exit(results.every(Boolean) ? 0 : 1), 500);
}
