// The only bridge between the page and the computer. Kept deliberately small.
const { contextBridge, ipcRenderer } = require('electron');

// Which page is this? The app decides, by its one rule (the server's own address, or exactly one of the app's two
// files), and a page that is none of them gets no bridge at all.
const page = ipcRenderer.sendSync('page', location.href);

if (page === 'popup') {
  // The little notice at the corner of the screen: all it can do is ask for the main window.
  contextBridge.exposeInMainWorld('chatterdayPopup', { open: () => ipcRenderer.send('popup:open') });
} else if (page === 'connect') {
  // The built-in "connect to a server" page.
  contextBridge.exposeInMainWorld('chatterdayConnect', {
    state: () => ipcRenderer.invoke('connect:state'),
    connect: (text) => ipcRenderer.invoke('connect:go', text),
    retry: () => ipcRenderer.invoke('connect:retry'),
    netState: () => ipcRenderer.invoke('net:state'),
    openTailscaleDownload: () => ipcRenderer.invoke('net:download'),
    forget: () => ipcRenderer.invoke('forget-server'),
    windowControl: (what) => ipcRenderer.send('window', String(what)),
  });
} else if (page === 'server') {
  contextBridge.exposeInMainWorld('chatterdayNative', {
    version: ipcRenderer.sendSync('version'),
    platform: process.platform,
    getSources: () => ipcRenderer.invoke('get-sources'),
    selectSource: (id, audio) => ipcRenderer.invoke('select-source', String(id), !!audio),
    onActivity: (cb) => { ipcRenderer.on('activity', (_e, a) => cb(a)); ipcRenderer.send('activity:subscribe'); },
    setAwayAfter: (seconds) => ipcRenderer.send('activity:away-after', Number(seconds)),
    setHotkeys: (map) => ipcRenderer.invoke('set-hotkeys', map),
    onHotkey: (cb) => { ipcRenderer.on('hotkey', (_e, action) => cb(action)); },      // braces: ipcRenderer.on returns ipcRenderer itself, which the page must never be handed
    getConfig: () => ipcRenderer.invoke('get-config'),
    setConfig: (c) => ipcRenderer.invoke('set-config', c),
    setTray: (s) => ipcRenderer.send('set-tray', s),
    forgetServer: () => ipcRenderer.invoke('forget-server'),
    windowControl: (what) => ipcRenderer.send('window', String(what)),
    onWindow: (cb) => { ipcRenderer.on('window-visible', (_e, visible) => cb(!!visible)); },
    popup: (text, accent) => ipcRenderer.send('popup', String(text), String(accent)),
    setOnline: (count, accent) => ipcRenderer.send('online', Number(count), String(accent)),
    installUpdate: () => ipcRenderer.invoke('update:install'),
    startShareSound: (id) => ipcRenderer.invoke('share-sound:start', String(id)),
    stopShareSound: () => ipcRenderer.send('share-sound:stop'),
    onShareSound: (cb) => { ipcRenderer.on('share-sound', (_e, chunk) => cb(chunk)); },
    onUpdate: (cb) => { ipcRenderer.on('update-progress', (_e, p) => cb({ state: String(p?.state), part: Number(p?.part) || 0 })); },
  });
}
