// Chatterday desktop shell. It shows the web UI served by your friend group's server and adds the
// things a browser tab cannot do: tray presence, a screen picker, system-audio capture, global hotkeys.
const { app, BrowserWindow, Tray, Menu, ipcMain, session, desktopCapturer, globalShortcut, powerMonitor, shell, nativeImage, net, screen, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { spawn, execFile } = require('node:child_process');
const os = require('node:os');
const readline = require('node:readline');
const crypto = require('node:crypto');
const { once } = require('node:events');
const { fileURLToPath } = require('node:url');

if (process.env.CHATTERDAY_PROFILE) app.setPath('userData', path.resolve(process.env.CHATTERDAY_PROFILE));
const cfgPath = path.join(app.getPath('userData'), 'config.json');
let cfg = { serverUrl: '', pendingHash: '', closeToTray: true, autoLaunchSet: false, games: [] };
try { cfg = { ...cfg, ...JSON.parse(fs.readFileSync(cfgPath, 'utf8')) }; } catch { /* first run */ }
const save = () => { fs.mkdirSync(path.dirname(cfgPath), { recursive: true }); fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2)); };
/** One of the small text files packed with the app (the server's address, the keys), or '' when it is not there. */
const packedText = (name) => { try { return fs.readFileSync(path.join(__dirname, name), 'utf8').trim(); } catch { return ''; } };
// The installer is built with the server's address inside it (desktop/server.txt), so nobody has to type one.
const BUILT_IN_SERVER = packedText('server.txt');
// An address that cannot be read as an http(s) one is no address at all: the connect page then asks for one. (Left
// in, it stopped the app from starting: everything below takes the address apart.)
const readable = (u) => { try { return typeof u === 'string' && /^https?:\/\//.test(u) && !!new URL(u).origin; } catch { return false; } };
// config.json holds an address only when somebody typed one into the connect page. The built-in address is used
// straight from the installer and never written there: saved, it would outlive the installer it came with, and a
// later installer with a new address could not move anybody. (Earlier versions did save it. A saved address that
// is the built-in one is therefore dropped here, while the two still agree.)
if (!readable(cfg.serverUrl)) cfg.serverUrl = '';
if (cfg.serverUrl && readable(BUILT_IN_SERVER) && new URL(cfg.serverUrl).origin === new URL(BUILT_IN_SERVER).origin) {
  cfg.serverUrl = '';
  try { save(); } catch { /* it is dropped again at the next start */ }
}
/** The address in use until the app is next started: the typed one, or else the built-in one. */
const SERVER = cfg.serverUrl || (readable(BUILT_IN_SERVER) ? BUILT_IN_SERVER : '');

const origin = () => { try { return new URL(SERVER).origin; } catch { return ''; } };
const isLocalHost = (u) => /^(localhost|127\.0\.0\.1|\[::1\])$/.test(new URL(u).hostname);
// Windows' own PowerShell, by its full path. Asked for by its bare name, Windows looks in the app's folder and then
// along the PATH, and would run whatever program of that name it found first.
const POWERSHELL = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

// Microphone and screen capture need a "secure" page. Inside Tailscale the link is already encrypted,
// so a plain http:// server address is told to count as secure. This has to happen before startup.
if (SERVER.startsWith('http://') && !isLocalHost(SERVER)) {
  app.commandLine.appendSwitch('unsafely-treat-insecure-origin-as-secure', origin());
}
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
if (process.env.CHATTERDAY_FAKE_MEDIA) {
  app.commandLine.appendSwitch('use-fake-device-for-media-stream');
  app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
}

let win = null;
let tray = null;
let quitting = false;
let pendingCapture = null;
let trayState = { muted: false, inVoice: false };
const startHidden = process.argv.includes('--hidden');

// A second copy only wakes the first one and leaves. (Quitting is not instant: without this flag the second copy
// would still reach "ready" below and briefly make a window, a tray icon and a watcher of its own.)
const firstInstance = app.requestSingleInstanceLock();
if (!firstInstance) app.quit();
app.on('second-instance', () => showWindow());

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

const fromServer = (url) => { try { return origin() !== '' && new URL(url).origin === origin(); } catch { return false; } };
// Our own two pages are told by the file they are, not by a name somewhere in the address: any other file whose
// address merely contained "connect.html" used to pass. The address is turned back into a path and the paths are
// compared, so it does not matter how a space or a drive letter happens to be written in it. (The popup's address
// carries a query, which is not part of which file it is.)
const CONNECT_PAGE = path.join(__dirname, 'connect.html');
const POPUP_PAGE = path.join(__dirname, 'popup.html');
const isOurFile = (url, file) => {
  try {
    const u = new URL(url);
    if (u.protocol !== 'file:') return false;
    u.search = '';
    u.hash = '';
    const asked = path.normalize(fileURLToPath(u));
    return process.platform === 'win32' ? asked.toLowerCase() === file.toLowerCase() : asked === file;
  } catch { return false; }
};
const fromConnectPage = (url) => isOurFile(url, CONNECT_PAGE);
const fromPopup = (url) => isOurFile(url, POPUP_PAGE);

function loadApp() {
  if (!SERVER) return win.loadFile(CONNECT_PAGE);
  const hash = cfg.pendingHash ? `/#/${cfg.pendingHash}` : '';       // the demo uses this to sign in by itself
  if (cfg.pendingHash) { cfg.pendingHash = ''; save(); }
  win.loadURL(SERVER + hash).catch(() => {});
}

let wideBounds = null;          // the window's size before it was narrowed to the left panel
function createWindow() {
  win = new BrowserWindow({
    width: 1320, height: 840, minWidth: 900, minHeight: 560, show: !startHidden,
    backgroundColor: '#050805', autoHideMenuBar: true, icon: path.join(__dirname, 'icon.png'),
    frame: false,                // the page draws its own title bar and buttons
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  Menu.setApplicationMenu(null);
  loadApp();

  win.on('close', (e) => {
    if (quitting || !cfg.closeToTray) return;
    e.preventDefault();
    win.hide();
  });
  // With "keep it running in the tray" switched off, closing the window ends the app. (It used to leave the app
  // running with no window: the tray icon then answered a click with an error box.)
  win.on('closed', () => { win = null; if (!quitting) app.quit(); });
  // The page goes silent and leaves voice while the window is closed to the tray; the counter shows instead.
  win.on('hide', () => { win.webContents.send('window-visible', false); showCounter(); });
  win.on('show', () => { win.webContents.send('window-visible', true); hidePopup(); });
  // Back from the taskbar, or clicked on: whatever notice is up has been seen (and the counter never belongs over the window).
  win.on('restore', showCounter);
  win.on('focus', showCounter);
  // Links in chat open in the real browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (fromServer(url) || fromConnectPage(url)) return;
    e.preventDefault();
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
  });
  // The same rule for a redirect: an address that starts at the server and is sent on somewhere else would otherwise
  // put that other place in this window, which is the one with the bridge. Nobody clicked anything, so nothing is
  // opened in the browser. (Only the window's own page: the video player's frame may be sent where YouTube likes.)
  win.webContents.on('will-redirect', (e, url, _inPlace, isMainFrame) => {
    if (!isMainFrame || fromServer(url) || fromConnectPage(url)) return;
    e.preventDefault();
    // With no page of the server's on show (it was the app's own first load), the connect page, not an empty window.
    if (!fromServer(win.webContents.getURL())) setImmediate(() => { if (win && !win.isDestroyed()) void win.loadFile(CONNECT_PAGE); });
  });
  win.webContents.on('did-finish-load', () => { win.webContents.setAudioMuted(false); stopShareSound(); });      // a fresh page is never deafened, and shares nothing
  win.webContents.on('did-fail-load', (_e, code, _desc, url, isMainFrame) => {
    if (isMainFrame && code !== -3 && fromServer(url)) void win.loadFile(CONNECT_PAGE);
  });
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') win.webContents.toggleDevTools();
    if (input.type === 'keyDown' && input.key === 'F5') loadApp();
  });
}

function buildTray() {
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'tray.png')));
  tray.on('click', showWindow);
  refreshTray();
}
function refreshTray() {
  if (!tray) return;
  tray.setToolTip(trayState.inVoice ? `Chatterday: in voice${trayState.muted ? ' (muted)' : ''}` : 'Chatterday');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Chatterday', click: showWindow },
    { label: trayState.muted ? 'Unmute' : 'Mute', enabled: trayState.inVoice, click: () => win?.webContents.send('hotkey', 'mute') },
    { type: 'separator' },
    { label: 'Quit', click: () => { quitting = true; app.quit(); } },
  ]));
}

// ───────── permissions ─────────

const ALLOWED = new Set(['media', 'notifications', 'fullscreen', 'display-capture', 'speaker-selection', 'clipboard-sanitized-write', 'mediaKeySystem']);
function lockDownSession() {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((wc, permission, cb, details) => cb(ALLOWED.has(permission) && fromServer(details.requestingUrl || wc.getURL())));
  // Chromium asks this before it will name the microphones and speakers. The address it passes may or may not end in
  // a slash, and is sometimes missing, so compare origins properly and fall back to the page that is asking.
  const sameOrigin = (u) => { try { return new URL(u).origin === origin(); } catch { return false; } };
  ses.setPermissionCheckHandler((wc, permission, requestingOrigin, details) =>
    ALLOWED.has(permission) && (sameOrigin(requestingOrigin) || sameOrigin(details?.securityOrigin ?? '') || (!requestingOrigin && !!wc && fromServer(wc.getURL()))));
  // Screen capture: the page first tells us which source it wants (select-source), then asks the browser.
  ses.setDisplayMediaRequestHandler(async (request, callback) => {
    const want = pendingCapture;
    pendingCapture = null;
    try {
      if (!want || !fromServer(request.securityOrigin || request.frame?.url || '')) throw new Error('not armed');
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 0, height: 0 } });
      const source = sources.find((s) => s.id === want.id);
      if (!source) throw new Error('source is gone');
      callback({ video: source, audio: want.audio && process.platform === 'win32' ? 'loopback' : undefined });
    } catch {
      try { callback({}); } catch { /* an empty answer is how a request is refused */ }
    }
  });
}

// ───────── presence ─────────

let foreground = { path: '', title: '', product: '' };
let locked = false;
let lastActivity = '';
let subscribed = false;
const GAME_FOLDERS = ['\\steamapps\\common\\', '\\epic games\\', '\\riot games\\', '\\xboxgames\\', '\\gog galaxy\\games\\', '\\gog games\\', '\\ubisoft game launcher\\games\\', '\\ea games\\', '\\origin games\\', '\\rockstar games\\'];
const NOT_GAMES = ['\\epic games\\launcher\\', '\\riot games\\riot client\\', 'wallpaper_engine', '\\steamvr\\', '\\rockstar games\\launcher\\'];
const KNOWN_GAMES = { 'minecraft.windows.exe': 'Minecraft', 'robloxplayerbeta.exe': 'Roblox', 'osu!.exe': 'osu!', 'dolphin.exe': 'Dolphin', 'slippi dolphin.exe': 'Melee', 'overwatch.exe': 'Overwatch', 'wow.exe': 'World of Warcraft', 'gta5.exe': 'GTA V', 'diablo iv.exe': 'Diablo IV' };
const JAVA_GAMES = [[/^Minecraft/i, 'Minecraft'], [/Puzzle Pirates/i, 'Puzzle Pirates'], [/RuneLite|Old School RuneScape/i, 'RuneScape']];
const VIDEO_APPS = { 'vlc.exe': 'VLC', 'mpv.exe': 'mpv', 'mpc-hc64.exe': 'a video', 'mpc-be64.exe': 'a video', 'potplayermini64.exe': 'a video', 'plex.exe': 'Plex', 'plex htpc.exe': 'Plex', 'netflix.exe': 'Netflix', 'stremio.exe': 'Stremio', 'kodi.exe': 'Kodi', 'jellyfinmediaplayer.exe': 'Jellyfin', 'disney+.exe': 'Disney+' };
const BROWSERS = new Set(['chrome.exe', 'msedge.exe', 'firefox.exe', 'brave.exe', 'opera.exe', 'vivaldi.exe', 'arc.exe', 'zen.exe']);
const VIDEO_SITES = [[/YouTube Music/i, null], [/\bYouTube\b/i, 'YouTube'], [/\bNetflix\b/i, 'Netflix'], [/\bTwitch\b/i, 'Twitch'], [/\bHulu\b/i, 'Hulu'], [/Disney\+/i, 'Disney+'], [/Prime Video/i, 'Prime Video'], [/Crunchyroll/i, 'Crunchyroll'], [/\bPlex\b/i, 'Plex'], [/Jellyfin/i, 'Jellyfin'], [/Peacock/i, 'Peacock'], [/Paramount\+/i, 'Paramount+'], [/Apple TV/i, 'Apple TV'], [/\| Max$|HBO Max/i, 'Max']];

// How long the mouse and keyboard may sit untouched before somebody counts as away. It depends on what is in front:
// at the desk it is what the person chose in Settings (the page says: 'activity:away-after'). A game gets far longer,
// because Windows does not count a controller as input, and a video longer still, because it is watched hands-off.
// (The video's limit is not "never": a paused tab left in front overnight should not read as "watching" until morning.)
let awayAfter = 300;
const GAME_IDLE = 30 * 60;
const VIDEO_IDLE = 3 * 60 * 60;
const idleLimit = (state) => (state === 'watching' ? VIDEO_IDLE : state === 'gaming' ? Math.max(GAME_IDLE, awayAfter) : awayAfter);

/** Turns "what window is in front" into one word. Only this result is ever given to the page. */
function classify() {
  const exe = path.win32.basename(foreground.path).toLowerCase();
  if (locked) return { state: 'away', label: '', proc: exe };
  const a = inFront(exe);
  return powerMonitor.getSystemIdleTime() >= idleLimit(a.state) ? { state: 'away', label: '', proc: exe } : a;
}
/** What the window in front says they are doing, whether or not anybody is at the keyboard. */
function inFront(exe) {
  const out = (state, label = '') => ({ state, label, proc: exe });
  const p = foreground.path.toLowerCase();
  if (p === process.execPath.toLowerCase()) return { state: 'desk', label: '', proc: '' };     // Chatterday itself is never a game
  if (!exe) return out('desk');
  const nice = () => (foreground.product && !/^(microsoft|unity|unreal|bootstrap)/i.test(foreground.product) ? foreground.product : foreground.title || exe.replace(/\.exe$/, '')).slice(0, 40);
  if (cfg.games.includes(exe)) return out('gaming', nice());
  if (KNOWN_GAMES[exe]) return out('gaming', KNOWN_GAMES[exe]);
  if (exe === 'javaw.exe' || exe === 'java.exe') { for (const [re, name] of JAVA_GAMES) if (re.test(foreground.title)) return out('gaming', name); }
  if (GAME_FOLDERS.some((f) => p.includes(f)) && !NOT_GAMES.some((f) => p.includes(f))) return out('gaming', nice());
  if (VIDEO_APPS[exe]) return out('watching', VIDEO_APPS[exe]);
  if (BROWSERS.has(exe)) { for (const [re, name] of VIDEO_SITES) if (re.test(foreground.title)) return name ? out('watching', name) : out('desk'); }
  return out('desk');
}

function tickPresence(force = false) {
  if (!win || !subscribed) return;
  const a = { ...classify(), locked };        // "locked" lets the page mute the microphone while the PC is locked
  const key = `${a.state}|${a.label}|${a.proc}|${locked}`;
  if (!force && key === lastActivity) return;
  lastActivity = key;
  win.webContents.send('activity', a);
}

let watcher = null;             // the one presence.ps1 that is running; stopped when the app quits
function startWatcher() {
  if (process.platform !== 'win32' || quitting) return;
  const script = path.join(__dirname, 'presence.ps1').replace('app.asar', 'app.asar.unpacked');
  const ps = spawn(POWERSHELL, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-ParentPid', String(process.pid)], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
  watcher = ps;
  ps.on('error', () => { /* PowerShell would not start: the app carries on, knowing only "here" or "away" */ });
  readline.createInterface({ input: ps.stdout }).on('line', (line) => {
    const [p = '', title = '', product = ''] = line.split('\t');
    foreground = { path: p, title, product };
    tickPresence();
  });
  ps.on('exit', () => { if (!quitting) setTimeout(startWatcher, 15000); });
}

// ───────── getting connected ─────────
// Friends reach the host over Tailscale, a private network. Chatterday does not include or install Tailscale: each
// friend downloads it from Tailscale's own site and signs in with their own free account (so they agree to Tailscale's
// terms themselves), then accepts the link the host sends to share their PC. The connect page explains that and
// watches for it: is Tailscale on this PC, is it running, and does the host's PC answer.

const TAILSCALE = path.join(process.env.ProgramFiles || 'C:\Program Files', 'Tailscale', 'tailscale.exe');
const TAILSCALE_DOWNLOAD = 'https://tailscale.com/download/windows';
/** A file packed beside the app (in the installed app, its resources folder). */
const packed = (name) => (app.isPackaged ? path.join(process.resourcesPath, name) : path.join(__dirname, name));

function tailscaleStatus() {
  return new Promise((resolve) => {
    if (!fs.existsSync(TAILSCALE)) return resolve({ installed: false, state: '' });
    execFile(TAILSCALE, ['status', '--json'], { windowsHide: true, timeout: 8000 }, (_err, out) => {
      try { resolve({ installed: true, state: String(JSON.parse(out).BackendState ?? '') }); }
      catch { resolve({ installed: true, state: 'NoState' }); }
    });
  });
}
async function serverAnswers() {
  try {
    const r = await net.fetch(`${origin()}/api/invite-info?code=x`, { signal: AbortSignal.timeout(5000) });
    return typeof (await r.json()).valid === 'boolean';
  } catch { return false; }
}
async function netState() {
  const [ts, reachable] = await Promise.all([tailscaleStatus(), serverAnswers()]);
  return { ...ts, reachable };
}

// ───────── notices at the corner of the screen ─────────
// A small window of our own at the bottom right: "Sam joined voice chat" for ten seconds, then, while the
// main window is closed to the tray, a little counter of how many people are online. It never makes a sound.

let pop = null;
let popTimer = null;
let popTurn = 0;                // goes up with every show and hide, so a notice that finishes loading late knows it is out of date
let online = 0;
let accent = '#38ff5c';

function popupWindow() {
  if (pop && !pop.isDestroyed()) return pop;
  pop = new BrowserWindow({
    width: 340, height: 92, show: false, frame: false, transparent: true, resizable: false, movable: false, minimizable: false, maximizable: false,
    alwaysOnTop: true, skipTaskbar: true, focusable: false, hasShadow: false,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  pop.setAlwaysOnTop(true, 'screen-saver');
  return pop;
}
function showPopup(kind, text) {
  const { workArea } = screen.getPrimaryDisplay();
  const w = kind === 'toast' ? 340 : 190, h = kind === 'toast' ? 92 : 44;
  const p = popupWindow();
  p.setBounds({ x: workArea.x + workArea.width - w - 16, y: workArea.y + workArea.height - h - 16, width: w, height: h });
  const turn = ++popTurn;
  p.loadFile(path.join(__dirname, 'popup.html'), { query: { kind, text: String(text).slice(0, 80), accent, online: String(online) } }).then(() => { if (turn === popTurn) p.showInactive(); }).catch(() => {});
}
function hidePopup() {
  popTurn++;
  clearTimeout(popTimer);
  popTimer = null;
  if (pop && !pop.isDestroyed()) pop.hide();
}
// "Away" is closed to the tray. A minimized window is not: Electron calls it not visible, but it is still on the
// taskbar, and nothing tells us with a 'show' when it comes back, so a counter put up then used to stay over the window.
const windowAway = () => !win || !(win.isVisible() || win.isMinimized());
function showCounter() {
  clearTimeout(popTimer);
  popTimer = null;
  if (windowAway() && online > 0) showPopup('count', ''); else hidePopup();
}
function notify(text) {
  if (win && win.isVisible() && win.isFocused()) return;          // you are looking at it already
  showPopup('toast', text);
  clearTimeout(popTimer);
  popTimer = setTimeout(showCounter, 10000);
}

// ───────── the sound of a shared window ─────────
// Windows will hand over the sound of one program by itself. sharesound.exe (built from sharesound.cs, packed beside
// the app) does that for the program whose window is being shared, and its sound is passed to the page in small pieces.
// The PC's whole sound is never captured: it contains the voice chat itself, so everybody would hear themselves.
// (Nor "everything except this app": a sound router such as Voicemeeter replays all sound as its own.)
let soundProc = null;
function stopShareSound() {
  const p = soundProc;
  soundProc = null;
  if (p) { try { p.kill(); } catch { /* already gone */ } }
}
function startShareSound(sourceId) {
  stopShareSound();
  const m = /^window:(\d+):/.exec(String(sourceId));
  const exe = packed('sharesound.exe');
  if (process.platform !== 'win32' || !m || !fs.existsSync(exe)) return Promise.resolve({ error: 'There is no sound for this.' });
  return new Promise((resolve) => {
    // --not: never this app's own window (its sound is the voice chat); --parent: stop if the app goes away
    const child = spawn(exe, ['--hwnd', m[1], '--not', String(process.pid), '--parent', String(process.pid)], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    soundProc = child;
    let settled = false, rest = Buffer.alloc(0);
    const done = (r) => { if (!settled) { settled = true; resolve(r); } };
    child.stderr.on('data', (d) => { if (/capturing/.test(String(d))) done({}); });
    child.stdout.on('data', (chunk) => {
      if (soundProc !== child || !win || win.isDestroyed()) return;
      const all = rest.length ? Buffer.concat([rest, chunk]) : chunk;
      const whole = all.length - (all.length % 4);          // whole moments only: two channels of 16 bits
      rest = Buffer.from(all.subarray(whole));
      if (whole) win.webContents.send('share-sound', all.subarray(0, whole));
    });
    child.on('error', () => done({ error: 'The sound helper would not start.' }));
    child.on('exit', () => {
      done({ error: 'That window has no sound to share.' });
      if (soundProc === child) { soundProc = null; if (win && !win.isDestroyed()) win.webContents.send('share-sound', null); }
    });
    setTimeout(() => done({ error: 'The sound helper did not answer.' }), 4000);
  });
}

// ───────── updating itself ─────────
// The server keeps the newest installer. On "Install" the app asks the server what it has, checks the signature on
// it, asks the person at the keyboard, fetches it, checks that it arrived whole, and hands over to it: the installer
// closes the app, replaces it without asking anything more, and opens it again.
//
// The page is whatever answers at the server's address, so two things stand between it and a program being run here:
//  - A question put by the app itself, in a window of Windows' own that the page cannot draw or click. The page can
//    ask for an update; it cannot start one.
//  - A signature. scripts/sign-installer.mjs signs each installer with a private key that only whoever runs the server holds, and the
//    public half is packed into the app (desktop/update-key.txt). An installer without a good signature is not run,
//    whoever serves it. An app built before there was a key has none and checks none: that is how the first signed
//    version reaches an app that cannot check it yet. (See docs/SIGNED-UPDATES.md.)

// For the tests: pretend to be this (old) version, and stop just short of running the installer. A test run may also
// name the public key to check against and how long to wait for a silent server; it never runs anything, so neither
// can be used to get a program run.
const UPDATE_DRY = /^\d+\.\d+\.\d+$/.test(process.env.CHATTERDAY_UPDATE_DRY ?? '') ? process.env.CHATTERDAY_UPDATE_DRY : '';
const VERSION = UPDATE_DRY || app.getVersion();
const isNewer = (a, b) => {
  const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
};
const updateDirs = () => { try { return fs.readdirSync(os.tmpdir()).filter((d) => d.startsWith('chatterday-update-')).map((d) => path.join(os.tmpdir(), d)); } catch { return []; } };
// The installer that brought this copy in is of no more use. (It may still be finishing, so not straight away.)
setTimeout(() => { if (!updating) for (const d of updateDirs()) fs.rm(d, { recursive: true, force: true }, () => {}); }, 60_000).unref();

/** The public key installers are checked against. null: this app was built without one, so signatures are not
 *  asked for. false: it has one that cannot be read, and then no installer passes (never "not checked"). */
const UPDATE_KEY = (() => {
  const text = (UPDATE_DRY && process.env.CHATTERDAY_UPDATE_KEY) || packedText('update-key.txt');
  if (!text) return null;
  try {
    const raw = Buffer.from(text, 'base64');
    if (!/^[A-Za-z0-9+/]{43}=$/.test(text) || raw.length !== 32) return false;
    // (Node wants the key in its wrapped form: these twelve bytes are the wrapping of an Ed25519 public key.)
    return crypto.createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), raw]), format: 'der', type: 'spki' });
  } catch { return false; }
})();
/** What is signed is not the installer's bytes but one short text naming its version and its fingerprint. The version
 *  is in it so that an old installer, signed in its day, cannot be passed off as a new one. The fingerprint is checked
 *  against the bytes once they are here. scripts/sign-installer.mjs builds the same text. */
const signedText = (version, sha) => Buffer.from(`chatterday-update\n${version}\n${sha}\n`);
const signedByHost = ({ version, want, sig }) => {
  try { return /^[A-Za-z0-9+/]{86}==$/.test(sig) && crypto.verify(null, signedText(version, want), UPDATE_KEY, Buffer.from(sig, 'base64')); } catch { return false; }
};

// A server that stops answering must not leave the app "updating" for ever: with nothing new for this long, at the
// start or part-way through the file, the fetch is given up.
const UPDATE_STALL = (UPDATE_DRY && Number(process.env.CHATTERDAY_UPDATE_STALL)) || 30_000;
/** Something to wait with: `signal` ends the fetch when nothing has arrived for too long, `more()` says something
 *  just did, `stop()` ends the waiting, `drop()` ends the fetch as well. */
function patience() {
  const ctl = new AbortController();
  const p = { signal: ctl.signal, ranOut: false, more: () => {}, stop: () => clearTimeout(timer), drop: () => { clearTimeout(timer); ctl.abort(); } };
  let timer = null;
  p.more = () => { clearTimeout(timer); timer = setTimeout(() => { p.ranOut = true; ctl.abort(); }, UPDATE_STALL); };
  p.more();
  return p;
}
/** Asks the server for its installer. The answer's first lines say which version it is, how big, its fingerprint
 *  and (from a server that has one) its signature; the file itself follows, for whoever goes on to read it. */
async function offeredInstaller(signal) {
  // (redirect: an answer that sends the app on to some other address is not the server's, and is not followed.)
  const r = await net.fetch(`${origin()}/download/desktop`, { signal, redirect: 'error' }).catch(() => { throw new Error('The server did not hand over an installer.'); });
  const version = /filename="[^"]*?(\d+\.\d+\.\d+)[^"]*"/.exec(r.headers.get('content-disposition') ?? '')?.[1] ?? '';
  const total = Number(r.headers.get('content-length')) || 0;
  const want = (r.headers.get('x-sha256') ?? '').toLowerCase();
  if (!r.ok || !r.body || !total || !version || !/^[0-9a-f]{64}$/.test(want)) throw new Error('The server did not hand over an installer.');
  return { r, version, total, want, sig: (r.headers.get('x-signature') ?? '').trim() };
}

let updating = false;
let saidNoAt = 0;               // when "Not now" was last chosen: the question is not put again straight away
async function installUpdate() {
  if (process.platform !== 'win32' || !(app.isPackaged || UPDATE_DRY)) return { error: 'Only the installed Windows app can update itself.' };
  if (updating) return { error: 'Already on it.' };
  // A page that asked again and again until somebody gave in would make the question worthless.
  if (Date.now() - saidNoAt < 30_000) return { error: 'You chose "Not now" a moment ago. Try again in half a minute.' };
  // The button is in the window, so the window is open when it is pressed. Closed to the tray, nobody pressed it.
  if (!win || win.isDestroyed() || !win.isVisible() || win.isMinimized()) return { error: 'Open the Chatterday window first.' };
  updating = true;
  const say = (state, part) => { if (win && !win.isDestroyed()) win.webContents.send('update-progress', { state, part }); };
  let wait = null, out = null;
  try {
    if (UPDATE_KEY === false) throw new Error('The update key inside this app cannot be read. Ask whoever runs your server for the newest installer.');
    for (const d of updateDirs()) fs.rmSync(d, { recursive: true, force: true });

    // 1. What is on offer? Only the first lines of the answer are read; the file is fetched after a yes.
    wait = patience();
    const offer = await offeredInstaller(wait.signal);
    wait.drop();
    if (!isNewer(offer.version, VERSION)) throw new Error('This is already the newest app.');
    // 2. Did the host sign it? Checked before anybody is asked anything, so a question only ever appears for the real thing.
    if (UPDATE_KEY && !signedByHost(offer)) throw new Error(`The installer on the server is not signed${offer.sig ? ' with the right key' : ''}, so it was not installed. Tell whoever runs your server.`);
    // 3. The person at the keyboard says yes. "Not now" is the button Enter and Escape press, so a key meant for
    //    the chat cannot say yes by accident.
    const { response } = await dialog.showMessageBox(win, {
      type: 'question', title: 'Chatterday', noLink: true, buttons: ['Install', 'Not now'], defaultId: 1, cancelId: 1,
      message: `Install Chatterday ${offer.version} from ${origin()}?`,
      detail: 'Chatterday will close, replace itself and open again. If you did not press Install just now, choose "Not now".',
    });
    if (response !== 0) { saidNoAt = Date.now(); throw new Error('Nothing was installed.'); }

    // 4. Fetch it. It must be the same installer that was checked and agreed to a moment ago.
    wait = patience();
    const { r, version, total, want } = await offeredInstaller(wait.signal);
    if (version !== offer.version || want !== offer.want) throw new Error('The installer on the server changed just now. Try again.');
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'chatterday-update-')), 'Chatterday-Setup.exe');
    out = fs.createWriteStream(file);
    let failed = null;
    out.on('error', (e) => { failed = e; });
    const hash = crypto.createHash('sha256');
    const reader = r.body.getReader();
    let got = 0, told = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done || failed) break;
      wait.more();
      got += value.length;
      hash.update(value);
      // (a write that fails never drains: the wait ends on the error instead, and `failed` stops the loop)
      if (!out.write(value)) await once(out, 'drain').catch(() => {});
      if (Date.now() - told > 200) { told = Date.now(); say('downloading', got / total); }
    }
    wait.stop();
    if (failed) void reader.cancel().catch(() => {});
    await new Promise((res) => out.end(res));
    if (failed) throw new Error('Could not save the installer: ' + failed.message);
    // 5. Did it arrive whole and unchanged? The fingerprint is the one the signature covers (where there is a key),
    //    so this is also the check that these bytes are the ones the host signed.
    if (got !== total || hash.digest('hex') !== want) throw new Error('The download was damaged on the way. Try again.');
    if (UPDATE_DRY) return { dry: true, version, bytes: got, signed: !!UPDATE_KEY };
    say('installing', 1);
    // --updated: the installer waits for this app to close (and closes it if it does not). /S: no windows, no questions.
    // --force-run: it opens the new app when it is done.
    await new Promise((res, rej) => {
      const child = spawn(file, ['--updated', '/S', '--force-run'], { detached: true, stdio: 'ignore' });
      child.once('error', rej);
      child.once('spawn', () => { child.unref(); res(); });
    });
    setTimeout(() => { quitting = true; app.quit(); }, 400);
    return { version };
  } catch (e) {
    return { error: wait?.ranOut ? 'The server stopped answering. Try again.' : String(e?.message ?? e).slice(0, 200) };
  } finally {
    wait?.stop();
    if (out && !out.destroyed) out.destroy();        // (a fetch that ended half-way leaves the file open, and then it cannot be cleared away)
    updating = false;
  }
}

// ───────── messages from the page ─────────

/** Every request is checked: it must come from the server's own page (or our connect page). */
const allowed = (e, allowConnect) => {
  const url = e.senderFrame?.url ?? '';
  return fromServer(url) || (allowConnect && fromConnectPage(url));
};
const guard = (fn, allowConnect = false) => (e, ...args) => {
  if (!allowed(e, allowConnect)) throw new Error('not allowed');
  return fn(...args);
};
/** The same check for one-way messages (ipcMain.on). Nobody is waiting for an answer to those, so a refused one is
 *  dropped: a throw there has nowhere to go but an error box from the app itself. */
const heard = (fn, allowConnect = false) => (e, ...args) => { if (allowed(e, allowConnect)) fn(...args); };

// A hotkey is taken away from every other program on the PC for as long as it is registered, and each press is told
// to the page. A page that asked for A to Z would have every letter typed anywhere in Windows, and nobody could type.
// So a hotkey needs Ctrl, Alt or the Windows key in it, or to be a function key (Shift does not count: Shift+A is
// only a capital A), and there is a limit on how many there can be.
const MAX_HOTKEYS = 32;
const HOLDING = /^(ctrl|control|alt|option|super|meta|command|cmd|commandorcontrol|cmdorctrl)$/i;
const FUNCTION_KEY = /^f([1-9]|1\d|2[0-4])$/i;
const safeHotkey = (accel) => {
  const keys = accel.split('+');
  return FUNCTION_KEY.test(keys[keys.length - 1]) || keys.slice(0, -1).some((k) => HOLDING.test(k));
};

function registerIpc() {
  ipcMain.on('version', (e) => { e.returnValue = VERSION; });
  // The preload asks which bridge to put up, with the address of the page it finds itself in. Asked here so that
  // there is one rule for "which page is this", not a second, looser one in the preload. (What a page may then ask
  // for is checked again on every message, against the address Electron itself gives for the sender.)
  ipcMain.on('page', (e, url) => {
    const at = String(url ?? '');
    e.returnValue = fromServer(at) ? 'server' : fromConnectPage(at) ? 'connect' : fromPopup(at) ? 'popup' : '';
  });
  ipcMain.handle('update:install', guard(() => installUpdate()));
  ipcMain.handle('share-sound:start', guard((id) => startShareSound(id)));
  ipcMain.on('share-sound:stop', heard(() => stopShareSound()));
  ipcMain.on('activity:subscribe', heard(() => { subscribed = true; tickPresence(true); }));
  ipcMain.on('activity:away-after', heard((seconds) => { awayAfter = Math.max(60, Math.min(3600, Math.round(Number(seconds)) || 300)); tickPresence(); }));
  ipcMain.on('set-tray', heard((s) => {
    trayState = { muted: !!s?.muted, inVoice: !!s?.inVoice };
    refreshTray();
    // Deafened: the whole window is muted here, so nothing on the page can make a sound, whatever it is.
    if (win && !win.isDestroyed()) win.webContents.setAudioMuted(!!s?.deafened && !!s?.inVoice);
  }));

  ipcMain.handle('get-sources', guard(async () => {
    const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 } });
    return sources.map((s) => ({ id: s.id, name: s.name, thumb: s.thumbnail.toDataURL(), kind: s.id.startsWith('screen:') ? 'screen' : 'window' }));
  }));
  ipcMain.handle('select-source', guard((id, audio) => { pendingCapture = { id: String(id), audio: !!audio }; }));

  ipcMain.handle('set-hotkeys', guard((map) => {
    globalShortcut.unregisterAll();
    const result = {};
    let taken = 0;
    for (const [action, accel] of Object.entries(map ?? {}).slice(0, 200)) {
      if (typeof accel !== 'string' || !/^[\w+`]{1,40}$/.test(accel) || !/^(mute|deafen|sound:\d+)$/.test(action)) continue;
      // Refused ones are answered with false, like a combination Windows would not give, so the page can say so.
      if (!safeHotkey(accel) || taken >= MAX_HOTKEYS) { result[action] = false; continue; }
      try { result[action] = globalShortcut.register(accel, () => win?.webContents.send('hotkey', action)); } catch { result[action] = false; }
      if (result[action]) taken++;
    }
    return result;
  }));

  // Windows only reports the start-up entry as ours when asked with the same arguments it was saved with.
  const LOGIN = { args: ['--hidden'] };
  const publicConfig = () => ({ autoLaunch: app.getLoginItemSettings(LOGIN).openAtLogin, closeToTray: cfg.closeToTray, games: cfg.games });
  ipcMain.on('window', heard((what) => {
    if (!win) return;
    if (what === 'minimize') win.minimize();
    else if (what === 'maximize') (win.isMaximized() ? win.unmaximize() : win.maximize());
    else if (what === 'close') win.close();
    else if (/^compact:\d+$/.test(what)) {
      // only the left panel is showing: let the window be as narrow as that panel
      if (win.isMaximized()) win.unmaximize();
      if (!wideBounds) wideBounds = win.getBounds();
      win.setMinimumSize(200, 420);
      const b = win.getBounds();
      win.setBounds({ x: b.x, y: b.y, width: Math.max(200, Math.min(700, Number(what.slice(8)) || 320)), height: b.height });
    } else if (what === 'expand') {
      win.setMinimumSize(900, 560);
      const b = win.getBounds();
      if (wideBounds) win.setBounds({ x: b.x, y: b.y, width: wideBounds.width, height: b.height });
      else if (b.width < 900) win.setBounds({ x: b.x, y: b.y, width: 1320, height: b.height });
      wideBounds = null;
    }
  }, true));
  ipcMain.on('popup', heard((text, colour) => { if (/^#[0-9a-f]{6}$/i.test(colour)) accent = colour; notify(String(text ?? '')); }));
  ipcMain.on('online', heard((count, colour) => {
    online = Math.max(0, Math.min(99, Number(count) || 0));
    if (/^#[0-9a-f]{6}$/i.test(colour)) accent = colour;
    if (!popTimer) showCounter();
  }));
  ipcMain.on('popup:open', (e) => { if (fromPopup(e.senderFrame?.url ?? '')) showWindow(); });
  ipcMain.handle('get-config', guard(publicConfig));
  ipcMain.handle('set-config', guard((c) => {
    if (typeof c?.closeToTray === 'boolean') cfg.closeToTray = c.closeToTray;
    if (Array.isArray(c?.games)) cfg.games = c.games.filter((g) => typeof g === 'string' && /^[^\\/]{1,80}\.exe$/.test(g)).slice(0, 100);
    if (typeof c?.autoLaunch === 'boolean' && app.isPackaged) app.setLoginItemSettings({ openAtLogin: c.autoLaunch, ...LOGIN });      // never from a development copy
    save();
    lastActivity = '';
    return publicConfig();
  }));

  // Forgets a typed address and everything kept for it. The app comes back with the address it was built with, or,
  // having none, with the page that asks for one.
  ipcMain.handle('forget-server', guard(async () => {
    cfg.serverUrl = '';
    save();
    await session.defaultSession.clearStorageData();
    relaunch();
  }, true));

  // typed: the address in use is one somebody typed in, not the one that came with the app.
  ipcMain.handle('connect:state', guard(() => ({ serverUrl: SERVER, builtIn: readable(BUILT_IN_SERVER), typed: !!cfg.serverUrl }), true));
  ipcMain.handle('connect:retry', guard(() => { if (SERVER) loadApp(); }, true));
  ipcMain.handle('net:state', guard(netState, true));
  ipcMain.handle('net:download', guard(() => void shell.openExternal(TAILSCALE_DOWNLOAD), true));
  ipcMain.handle('connect:go', guard(async (text) => {
    let url;
    try { url = new URL(String(text).trim()); } catch { return { error: 'That does not look like an address. It starts with http://' }; }
    if (!/^https?:$/.test(url.protocol)) return { error: 'The link should start with http:// or https://.' };
    try {
      const r = await net.fetch(`${url.origin}/api/invite-info?code=x`, { signal: AbortSignal.timeout(8000) });      // (an address that never answers must not leave the button switched off)
      const j = await r.json();
      if (typeof j.valid !== 'boolean') throw new Error('not chatterday');
    } catch {
      return { error: 'Could not reach a Chatterday server at that address. Is Tailscale connected?' };
    }
    cfg.serverUrl = url.origin;
    save();
    relaunch(); // the secure-origin switch can only be set at startup
    return {};
  }, true));
}

function relaunch() {
  quitting = true;
  app.relaunch({ args: process.argv.slice(1).filter((a) => a !== '--hidden') });
  app.exit(0);
}

app.whenReady().then(() => {
  if (!firstInstance) return;
  lockDownSession();
  registerIpc();
  // Starting with Windows is on unless the person turns it off. Only the installed app does this.
  if (app.isPackaged && !cfg.autoLaunchSet) {
    app.setLoginItemSettings({ openAtLogin: true, args: ['--hidden'] });
    cfg.autoLaunchSet = true;
    save();
  }
  createWindow();
  buildTray();
  startWatcher();
  setInterval(tickPresence, 5000);
  powerMonitor.on('lock-screen', () => { locked = true; tickPresence(); });
  powerMonitor.on('unlock-screen', () => { locked = false; tickPresence(); });
});
app.on('before-quit', () => { quitting = true; stopShareSound(); watcher?.kill(); });
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => { /* stay in the tray */ });
// No new windows, no webviews, no surprise navigation in any frame.
app.on('web-contents-created', (_e, contents) => {
  contents.on('will-attach-webview', (e) => e.preventDefault());
});
