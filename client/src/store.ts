import { create } from 'zustand';
import { api } from './api';
import { applyTheme } from './theme';
import { native } from './native';
import type { Attachment, Channel, GameKind, GameTable, Me, Message, Music, Presence, ServerSettings, Sound, User, Weather } from './types';

export type Prefs = {
  micId: string; outId: string; echo: boolean; noise: boolean; agc: boolean;
  ptt: boolean; pttKey: string;
  /** The soundboard slider, 0 to 1. It is a position, not a loudness: see soundGain. */
  soundVol: number; userVol: Record<string, number>; mediaVol: Record<string, number>;
  shareQuality: '720p30' | '1080p30' | '1080p60'; /** Send a shared window's own sound along with it (through the desktop app's helper). A whole screen never has sound. */
  shareAppSound: boolean;
  shareActivity: boolean; shareDetail: boolean;
  /** Minutes with the mouse and keyboard untouched before I count as away. */
  awayAfter: number;
  notify: 'all' | 'mentions' | 'none'; chimes: boolean;
  /** action → accelerator. Actions: "mute", "deafen", "sound:<id>". Desktop app only. */
  hotkeys: Record<string, string>;
  lastRead: Record<number, number>;
  dockOpen: boolean;
  /** How tall the soundboard's buttons may stand before they scroll (its top edge can be dragged). */
  dockH: number;
  /** Whether the Player in the left panel is open, or folded down to its title. */
  playerOpen: boolean;
  /** Widths of the left panel and the chat panel, which can be dragged. */
  leftW: number; chatW: number;
  /** Whether the middle of the window (the room, where-are-you and the soundboard) is shown. */
  roomOpen: boolean;
  /** Even out how loud everybody's voice is, by turning the louder ones down. */
  levelVoices: boolean;
  /** Mute the microphone while the PC is locked (desktop app). */
  lockMute: boolean;
  /** Tell me when I am talking with my microphone muted. */
  mutedNudge: boolean;
  /** Switch to a headset when it is plugged in, and back when it goes. */
  autoDevice: boolean;
  /** My own text size for the left panel and the chat, on top of what the screen's size already gives (1 is as it comes). */
  textSize: number;
  /** Noise gate: send nothing from my microphone while I am below my own talking line. */
  gate: boolean;
  /** Whether the player in the left panel shows its video, or just plays the sound. */
  showVideo: boolean;
  /** How wide the desktop window is when only the left panel is showing (0: as wide as the panel was). */
  soloW: number;
  /** The player's slider, 0 to 1. A position too: see playerLevel. */
  playerVol: number;
  /** Turn music and soundboard clips down while somebody else is talking. */
  duck: boolean;
  /** Bumped when a default changes and everybody should get the new one once. */
  v: number;
};
const DEFAULT_PREFS: Prefs = {
  micId: '', outId: '', echo: true, noise: true, agc: true, ptt: false, pttKey: 'Backquote',
  soundVol: 0.65, userVol: {}, mediaVol: {}, shareQuality: '1080p30', shareAppSound: true,
  shareActivity: true, shareDetail: true, awayAfter: 5, notify: 'all', chimes: true, hotkeys: {}, lastRead: {}, dockOpen: false, dockH: 80, playerOpen: true, leftW: 310, chatW: 440,
  roomOpen: true, levelVoices: true, lockMute: true, mutedNudge: true, autoDevice: true, textSize: 1, gate: false, showVideo: false, soloW: 0, playerVol: 0.73, duck: true, v: 5,
};
// The browser can refuse to keep anything (site data blocked, or full). A setting then lasts until the page is closed,
// rather than not changing at all.
const kept = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const keep = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* not kept */ } };
/** Settings as they were saved or sent, less any that are not the kind of thing their default is (a list of volumes
 *  that came back as null, say): those would break whatever reads them. */
const sane = (p: object) => Object.fromEntries(Object.entries(p).filter(([k, v]) =>
  !(k in DEFAULT_PREFS) || (v !== null && !Array.isArray(v) && typeof v === typeof DEFAULT_PREFS[k as keyof Prefs])));
function loadPrefs(): Prefs {
  try {
    const saved = JSON.parse(kept('cd_prefs') ?? '{}');
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return DEFAULT_PREFS;
    if ((saved.v ?? 1) < 3) saved.v = 3;
    if (saved.v < 4) { saved.dockOpen = false; saved.v = 4; }                             // the soundboard now starts folded away
    // The two volume sliders used to hold a loudness. They hold a position now (so the quiet end has room), under new
    // names; what was set before is carried over to the position that sounds the same.
    if (saved.soundVol === undefined && typeof saved.sfxVol === 'number') saved.soundVol = saved.sfxVol <= 0 ? 0 : Math.max(0.02, Math.min(1, 1 + Math.log10(saved.sfxVol) / 2));
    // (for one afternoon the player's slider ran from 5% to 30%; a position saved then is moved to where it sounds the same)
    if ((saved.v ?? 1) < 5 && typeof saved.playerVol === 'number' && saved.playerVol > 0) saved.playerVol = Math.min(1, Math.log(5 * Math.pow(6, saved.playerVol)) / Math.log(30));
    if (saved.playerVol === undefined && typeof saved.musicVol === 'number') saved.playerVol = saved.musicVol <= 0 ? 0 : Math.max(0.02, Math.min(1, Math.log(Math.max(1, saved.musicVol * 30)) / Math.log(30)));
    if ((saved.v ?? 1) < 5) saved.v = 5;
    return { ...DEFAULT_PREFS, ...sane(saved) } as Prefs;
  } catch { return DEFAULT_PREFS; }
}

/** What the middle of the window shows: the room, shared screens, the Player's video large (theatre), the whiteboard,
 *  or the game table. */
export type View = { kind: 'hangout' } | { kind: 'stage' } | { kind: 'theatre' } | { kind: 'board' } | { kind: 'games' } | { kind: 'arcade' };
/** The football in the clubhouse: where it lies (or, while it rolls, where it will stop); and the roll itself, a point
 *  every `ms` from `t0` (by performance.now()), which the room plays back and then forgets. */
/** A wad of paper thrown at the bin: who threw it, where it is every `ms` ([x, y, height]), whether it went in, how many
 *  times it came off the rim, how many that person has now got in running, and how far away they stood. */
export type Toss = { from: string; path: number[][]; ms: number; made: boolean; rims: number; streak: number; far: number };
export type Ball = { x: number; y: number; path: number[][] | null; ms: number; t0: number };
export type VoiceState = {
  channelId: number | null; connecting: boolean; muted: boolean; deafened: boolean; sharing: boolean;
  micError: string; error: string;
  speaking: Record<string, boolean>; screens: string[]; rev: number;
  /** True while the noise gate is holding my microphone shut. */
  gated: boolean;
  /** True for a few seconds after I was caught talking with my microphone muted. */
  talkingMuted: boolean;
};

type State = {
  phase: 'loading' | 'gate' | 'ready'; connected: boolean;
  me: Me | null; users: Record<string, User>; channels: Channel[]; presence: Record<string, Presence>;
  /** Soundboard sounds that are playing now, and when each one ends: its button waits until then. */
  soundBusy: Record<number, number>;
  sounds: Sound[]; settings: ServerSettings; previews: Record<string, string>;
  messages: Record<number, Message[]>; more: Record<number, boolean>; loaded: Record<number, boolean>;
  /** True while the chat is showing an old stretch of messages (after jumping to a search result), not the latest. */
  historic: Record<number, boolean>;
  typing: Record<number, Record<string, number>>; unread: Record<number, number>;
  /** How many unread messages each chat holds, for the badges. (`unread` only says whether, and whether I was mentioned.) */
  counts: Record<number, number>;
  view: View; chat: number | null; settingsOpen: string | null; picker: boolean;
  voice: VoiceState; prefs: Prefs; toast: string;
  /** The shared music queue; `skew` is how far this PC's clock is from the server's. */
  music: Music & { skew: number };
  /** True while somebody else is talking (and for a moment after): music and clips play quieter. */
  ducked: boolean;
  /** My private chats: the channel each one lives in, and who it is with. */
  dms: { id: number; with: string }[];
  /** Something worth acting on now, with one button (somebody started sharing their screen). */
  notice: { text: string; label: string; run: () => void } | null;
  /** The weather where the house is (the town the admin picked), for its windows and its yard. */
  weather: Weather | null;
  asking: { title: string; value: string; resolve: (v: string | null) => void } | null;
  /** The game table as the server last described it to me (null until it has), and its last "no, because" line. */
  table: GameTable | null; tableNote: string;
  ball: Ball | null;
  /** How many wads of paper each person has got into the bin, ever. */
  toss: Record<string, number>;
  /** The arcade machine's best scores, by game: the top few people at each. */
  arcade: Record<string, { userId: string; score: number }[]>;
};

export const useStore = create<State>()(() => ({
  phase: 'loading', connected: false,
  me: null, users: {}, channels: [], presence: {}, sounds: [], soundBusy: {},
  settings: { serverName: 'Chatterday', publicUrl: '', voice: false, gifKey: '', appVersion: '', tz: '', town: '', unit: 'F', photo: null }, previews: {},
  messages: {}, more: {}, loaded: {}, historic: {}, typing: {}, unread: {}, counts: {},
  view: { kind: 'hangout' }, chat: null, settingsOpen: null, picker: false,
  voice: { channelId: null, connecting: false, muted: false, deafened: false, sharing: false, micError: '', error: '', speaking: {}, screens: [], rev: 0, gated: false, talkingMuted: false },
  prefs: loadPrefs(), toast: '', asking: null, music: { current: null, queue: [], now: 0, skew: 0 }, ducked: false, weather: null, dms: [], notice: null, table: null, tableNote: '', ball: null, arcade: {}, toss: {},
}));
const S = useStore.getState;
const set = useStore.setState;

/** The soundboard slider's position as a loudness: from 40 dB down at the bottom to full at the top, in even steps to the ear. */
export const soundGain = (pos: number) => (pos <= 0 ? 0 : Math.pow(10, (Math.min(1, pos) - 1) * 2));
/** The player slider's position as a share of YouTube's full volume: from 1% (its quietest step) at the bottom to
 *  30% at the top (music sits well under voices), again in even steps to the ear. */
export const playerLevel = (pos: number) => (pos <= 0 ? 0 : 0.01 * Math.pow(30, Math.min(1, pos)));

export function setPrefs(p: Partial<Prefs>) {
  const prefs = { ...S().prefs, ...p };
  keep('cd_prefs', JSON.stringify(prefs));
  set({ prefs });
  if (Object.keys(p).every((k) => LOCAL_ONLY.has(k))) return;
  keep('cd_prefs_at', String(Date.now()));
  window.clearTimeout(prefsTimer);
  prefsTimer = window.setTimeout(pushPrefs, 3000);
}

// ───────── settings that follow you ─────────
// Most settings are also kept on the server, so another PC (or a reinstall) starts the way you left things; whichever
// side changed last wins. Which microphone and speakers, the panel widths and the text size belong to one PC and stay on it.
const LOCAL_ONLY = new Set(['micId', 'outId', 'leftW', 'chatW', 'soloW', 'roomOpen', 'dockOpen', 'dockH', 'playerOpen', 'textSize', 'v']);
const roaming = (p: object) => Object.fromEntries(Object.entries(sane(p)).filter(([k]) => !LOCAL_ONLY.has(k) && k in DEFAULT_PREFS));
const prefsAt = () => Number(kept('cd_prefs_at')) || 0;
let prefsTimer = 0;
function pushPrefs() {
  if (!prefsAt()) keep('cd_prefs_at', String(Date.now()));
  send({ t: 'prefs', prefs: roaming(S().prefs), at: prefsAt() });
}
/** The newest message there is in each chat, as far as this page has heard. */
let newest: Record<number, number> = {};
/** Takes the server's copy if it is newer than mine. */
function takePrefs(prefs: unknown, at: number) {
  if (!prefs || typeof prefs !== 'object' || !(at > prefsAt())) return;
  const mine = S().prefs, next = { ...mine, ...roaming(prefs) } as Prefs;
  // What has been read is never un-read: each chat keeps whichever side had got further.
  next.lastRead = { ...next.lastRead };
  let ahead = false;
  for (const [cid, id] of Object.entries(mine.lastRead)) if (id > (next.lastRead[Number(cid)] ?? 0)) { next.lastRead[Number(cid)] = id; ahead = true; }
  keep('cd_prefs', JSON.stringify(next));
  keep('cd_prefs_at', String(ahead ? Math.max(Date.now(), at + 1) : at));
  set({ prefs: next });
  if (ahead) {                          // the server is told what this PC had read, so the two end up the same
    window.clearTimeout(prefsTimer);
    prefsTimer = window.setTimeout(pushPrefs, 3000);
  }
  // ...and a chat read to its end on another PC stops showing as unread on this one.
  const { unread, counts } = S();
  const read = Object.keys(unread).map(Number).filter((cid) => (unread[cid] || counts[cid]) && newest[cid] && (next.lastRead[cid] ?? 0) >= newest[cid]);
  if (read.length) set({ unread: { ...unread, ...Object.fromEntries(read.map((cid) => [cid, 0])) }, counts: { ...counts, ...Object.fromEntries(read.map((cid) => [cid, 0])) } });
}
function syncPrefs(me: Me) {
  const theirs = me.prefsAt ?? 0;
  if (me.prefs && theirs > prefsAt()) takePrefs(me.prefs, theirs);
  else if (!me.prefs || prefsAt() > theirs) pushPrefs();
}

let toastTimer = 0;
export function toast(text: string) {
  set({ toast: text });
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => set({ toast: '' }), 5000);
}

/** An in-app replacement for window.prompt, which the desktop shell does not have. */
export const ask = (title: string, value = '') =>
  new Promise<string | null>((resolve) => {
    S().asking?.resolve(null);          // a question still open is answered "never mind", not left waiting for good
    set({ asking: { title, value, resolve } });
  });

/** Other modules subscribe here so the store never has to import them. */
export const hooks = {
  ready: [] as (() => void)[],
  sound: [] as ((id: number, channelId?: number) => void)[],
  message: [] as ((m: Message) => void)[],
  presence: [] as ((userId: string, prev: Presence | undefined, next: Presence) => void)[],
  wave: [] as ((from: string) => void)[],
  act: [] as ((a: { id: number; kind: string; from: string; target: string; pet: string }) => void)[],
  toss: [] as ((t: Toss) => void)[],
  /** A step of drawing on the whiteboard, from somebody else. */
  board: [] as ((d: any) => void)[],
};

// ───────── staying up to date ─────────
// The server names the build it is handing out (it changes whenever any file of the UI does: code or pictures).
// The first name this page hears is the build it was loaded from; when a different one is announced, the page
// reloads: straight away, or as soon as you leave voice if you are in it.
let myBuild = '';
let reloadWaiting = false;
function checkBuild(id: unknown) {
  if (typeof id !== 'string' || !id || reloadWaiting) return;
  if (!myBuild) { myBuild = id; return; }
  if (id === myBuild) return;
  reloadWaiting = true;
  const go = () => window.setTimeout(() => location.reload(), 1500);
  if (S().voice.channelId == null) { toast('Updating Chatterday…'); go(); return; }
  toast('A new version of Chatterday is ready. It will load when you leave voice.');
  const stop = useStore.subscribe((st) => { if (st.voice.channelId == null) { stop(); go(); } });
}

// ───────── socket ─────────

let ws: WebSocket | null = null;
let retry = 0;
let retryTimer = 0;
let booting = false;

/** Sends something to the server. False if there is no connection just now: it was not sent, and will not be. */
export function send(obj: unknown): boolean {
  if (ws?.readyState !== 1) return false;
  ws.send(JSON.stringify(obj));
  return true;
}

/** Tries again after a wait that doubles each time, up to 15 seconds: the host PC may be off all night. */
function retryLater() {
  window.clearTimeout(retryTimer);
  retryTimer = window.setTimeout(boot, Math.min(15000, 1000 * 2 ** retry++));
}

export async function boot() {
  if (booting) return;                  // one at a time: two would open two connections, and everything would arrive twice
  booting = true;
  window.clearTimeout(retryTimer);
  try {
    await api('/me');
    // Signed in already, so the sign-in page (which clears a name and password given in the address) never shows:
    // clear them here, or the password stays in the address bar.
    if (location.hash.startsWith('#/login/')) history.replaceState(null, '', location.pathname + location.search);
    connect();
  } catch (e: any) {
    if (e.status === 401) set({ phase: 'gate' });
    else retryLater();                  // server is down; keep trying
  } finally { booting = false; }
}

function connect() {
  if (ws && ws.readyState <= 1) return; // already connected, or connecting
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const sock = new WebSocket(`${proto}://${location.host}/ws?kind=${native ? 'app' : 'web'}`);
  ws = sock;
  sock.onopen = () => { retry = 0; };
  sock.onmessage = (ev) => onEvent(JSON.parse(ev.data));
  sock.onclose = () => {
    if (ws !== sock) return;
    set({ connected: false });
    retryLater();
  };
}

function onEvent(d: any) {
  const s = S();
  switch (d.t) {
    case 'ready': {
      const users: Record<string, User> = {};
      for (const u of d.users as User[]) users[u.id] = u;
      newest = { ...(d.lastIds as Record<number, number>) };
      syncPrefs(d.me);                  // first: what counts as read may have been settled on another PC
      const lastRead = S().prefs.lastRead;
      const unread: Record<number, number> = {};
      for (const [cid, last] of Object.entries(newest)) {
        if (last > (lastRead[Number(cid)] ?? 0)) unread[Number(cid)] = 1;
      }
      applyTheme(d.me.theme);
      set({
        phase: 'ready', connected: true, me: d.me, users, channels: d.channels, presence: d.presence, sounds: d.sounds,
        settings: d.settings, previews: d.previews, unread, counts: {}, loaded: {}, messages: {}, more: {},
        ...(d.music ? { music: { ...d.music, skew: Date.now() - d.music.now } } : {}),
        weather: d.weather ?? null, dms: d.dms ?? [],
        ball: d.ball ? { x: Number(d.ball.x), y: Number(d.ball.y), path: null, ms: 50, t0: 0 } : null, arcade: d.arcade ?? {}, toss: d.toss ?? {},
      });
      // how many are waiting in each chat with something new (a chat read while the answer was on its way stays at none)
      if (Object.keys(unread).length) void api<{ counts: Record<number, number> }>('/unread', { since: Object.fromEntries(Object.keys(unread).map((cid) => [cid, lastRead[Number(cid)] ?? 0])) }).then((r) => {
        const now = S();
        set({ counts: { ...Object.fromEntries(Object.entries(r.counts).filter(([cid]) => now.unread[Number(cid)])), ...Object.fromEntries(Object.entries(now.counts).filter(([, n]) => n > 0)) } });
      }).catch(() => {});
      const open = S().chat;
      if (open != null) void openText(open, true);
      for (const h of hooks.ready) h();
      send({ t: 'game', op: 'sync' });          // what is on the game table (and, if I hold a seat there, that I am back)
      checkBuild(d.build);
      break;
    }
    case 'msg': {
      const m = d.message as Message;
      const viewing = s.chat === m.channelId && !document.hidden;
      const patch: Partial<State> = {};
      if (m.id > (newest[m.channelId] ?? 0)) newest[m.channelId] = m.id;
      arriving.get(m.channelId)?.push(m);
      if (s.loaded[m.channelId] && !s.historic[m.channelId]) patch.messages = { ...s.messages, [m.channelId]: [...(s.messages[m.channelId] ?? []), m] };
      if (viewing) markRead(m.channelId, m.id);
      else if (m.userId !== s.me?.id) {
        patch.unread = { ...s.unread, [m.channelId]: Math.max(s.unread[m.channelId] ?? 0, mentionsMe(m) ? 2 : 1) };
        patch.counts = { ...s.counts, [m.channelId]: (s.counts[m.channelId] ?? 0) + 1 };
      }
      if (s.typing[m.channelId]?.[m.userId]) {          // they have sent it: no longer typing
        const t = { ...s.typing[m.channelId] };
        delete t[m.userId];
        patch.typing = { ...s.typing, [m.channelId]: t };
      }
      if (Object.keys(patch).length) set(patch);
      for (const h of hooks.message) h(m);
      break;
    }
    case 'msg_edit': {
      const m = d.message as Message;
      const list = s.messages[m.channelId];
      if (list) set({ messages: { ...s.messages, [m.channelId]: list.map((x) => (x.id === m.id ? m : x)) } });
      break;
    }
    case 'msg_delete': {
      const list = s.messages[d.channelId];
      if (list) set({ messages: { ...s.messages, [d.channelId]: list.filter((x) => x.id !== d.id) } });
      break;
    }
    case 'typing':
      set({ typing: { ...s.typing, [d.channelId]: { ...(s.typing[d.channelId] ?? {}), [d.userId]: Date.now() } } });
      break;
    case 'presence': {
      const prev = s.presence[d.userId];
      set({ presence: { ...s.presence, [d.userId]: d.presence } });
      for (const h of hooks.presence) h(d.userId, prev, d.presence);
      break;
    }
    case 'user': {
      const patch: Partial<State> = { users: { ...s.users, [d.user.id]: d.user } };
      if (d.user.id === s.me?.id) patch.me = { ...s.me!, ...d.user };
      set(patch);
      break;
    }
    case 'channels': {
      const channels = d.channels as Channel[];
      // (a private chat is not in this list, and stays open)
      set({ channels, chat: s.chat != null && (channels.some((c) => c.id === s.chat) || s.dms.some((x) => x.id === s.chat)) ? s.chat : null });
      break;
    }
    case 'sounds': set({ sounds: d.sounds }); break;
    case 'settings': set({ settings: d.settings }); break;
    case 'preview': {
      const previews = { ...s.previews };
      if (d.data) previews[d.userId] = d.data; else delete previews[d.userId];
      set({ previews });
      break;
    }
    case 'sound': for (const h of hooks.sound) h(d.id, d.channelId); break;
    case 'music':
      set({ music: { ...d.music, skew: Date.now() - d.music.now }, ...(!d.music.current && s.view.kind === 'theatre' ? { view: { kind: 'hangout' as const } } : {}) });      // nothing left to watch
      break;
    case 'toast': toast(String(d.text ?? '')); break;
    case 'weather': set({ weather: d.weather }); break;
    case 'build': checkBuild(d.build); break;
    case 'board': for (const h of hooks.board) h(d); break;
    case 'game': onTable(d); break;
    case 'ball': {                 // somebody kicked the football: the whole roll, which the room plays back from now
      const path = d.path as number[][], end = path[path.length - 1];
      if (end) set({ ball: { x: end[0], y: end[1], path, ms: Number(d.ms) || 50, t0: performance.now() } });
      break;
    }
    case 'arcade': set({ arcade: d.scores ?? {} }); break;
    case 'toss': {                 // somebody threw a wad of paper at the bin: the whole flight, for the room to play
      const flight: Toss = { from: String(d.from), path: d.path as number[][], ms: Number(d.ms) || 42, made: !!d.made, rims: Number(d.rims) || 0, streak: Number(d.streak) || 0, far: Number(d.far) || 0 };
      if (flight.made) set({ toss: { ...s.toss, [flight.from]: Number(d.count) || 0 } });
      for (const h of hooks.toss) h(flight);
      break;
    }
    case 'prefs': takePrefs(d.prefs, Number(d.at)); break;
    case 'dm': if (!s.dms.some((x) => x.id === d.id)) set({ dms: [...s.dms, { id: Number(d.id), with: String(d.with) }] }); break;
    case 'act': for (const h of hooks.act) h({ id: Number(d.id), kind: String(d.kind), from: String(d.from), target: String(d.target ?? ''), pet: String(d.pet ?? '') }); break;
    case 'wave':
      toast(`${s.users[d.from]?.name ?? 'Someone'} is waving you over.`);
      for (const h of hooks.wave) h(String(d.from));
      break;
  }
}

// ───────── the game table ─────────
export const GAME_NAMES: Record<GameKind, string> = { hearts: 'Hearts', spades: 'Spades', rummy: 'Rummy', chess: 'Chess', checkers: 'Checkers', mahjong: 'Mahjong', go: 'Go', four: 'Four in a Row', mancala: 'Mancala' };
let noteTimer = 0;
/** A line under the game ("You have to follow suit"), which goes away by itself. */
export function tableNote(text: string) {
  set({ tableNote: text });
  window.clearTimeout(noteTimer);
  if (text) noteTimer = window.setTimeout(() => set({ tableNote: '' }), 5000);
}
/** Does something at the game table: `gameOp('sit', { seat: 2 })`, `gameOp('move', { m: { play: 'QS' } })`. */
export function gameOp(op: string, more: Record<string, unknown> = {}) {
  if (!send({ t: 'game', op, ...more })) tableNote('No connection to the server.');
}
const openGames = () => set({ view: { kind: 'games' } });
function onTable(d: any) {
  if (typeof d.error === 'string') return tableNote(d.error);
  const next = d.table as GameTable | undefined;
  if (!next || typeof next !== 'object') return;
  const s = S(), prev = s.table, me = s.me?.id;
  set({ table: next });
  if (!prev || !next.kind) return;                    // (the first picture after connecting is not news)
  const away = s.view.kind !== 'games';
  const name = GAME_NAMES[next.kind];
  // somebody is setting up a game, or has started one I am not looking at; or it has come round to me
  if (next.phase === 'lobby' && next.host && next.host !== me && (prev.kind !== next.kind || prev.host !== next.host) && away) notify(`${userName(next.host)} is setting up ${name} at the game table.`, 'Join', openGames);
  else if (next.phase === 'playing' && prev.phase !== 'playing' && away) notify(`${name} has started at the game table.`, next.you >= 0 ? 'Play' : 'Watch', openGames);
  else if (next.phase === 'playing' && next.you >= 0 && next.turn.includes(next.you) && !prev.turn.includes(next.you) && (away || document.hidden)) toast(`${name}: it is your turn.`);
}

/** ||hidden until clicked||, as typed. */
export const SPOILER = /\|\|[^\n]+?\|\|/g;
/** A message's text for the places that show it at a glance (a speech bubble, a notification): spoilers stay hidden. */
export const veiled = (text: string) => text.replace(SPOILER, '[spoiler]');

export function mentionsMe(m: Message) {
  const me = S().me;
  if (!me) return false;
  const c = m.content.toLowerCase();
  return c.includes('@' + me.name.toLowerCase()) || c.includes('@everyone');
}

// ───────── chat actions ─────────

export function markRead(channelId: number, id?: number) {
  const s = S();
  const last = id ?? s.messages[channelId]?.at(-1)?.id;
  if (last && last > (s.prefs.lastRead[channelId] ?? 0)) setPrefs({ lastRead: { ...s.prefs.lastRead, [channelId]: last } });
  if (s.unread[channelId] || s.counts[channelId]) set({ unread: { ...S().unread, [channelId]: 0 }, counts: { ...S().counts, [channelId]: 0 } });
}

/** Chats whose latest messages are being fetched, and what has arrived for each meanwhile. A message that comes in
 *  after the server has answered but before the answer is here would otherwise be in neither, and never be shown. */
const arriving = new Map<number, Message[]>();

export async function loadMessages(channelId: number, older = false) {
  const s = S();
  const before = older ? s.messages[channelId]?.[0]?.id : undefined;
  const held: Message[] = [];
  if (!older) arriving.set(channelId, held);
  const r = await api<{ messages: Message[]; more: boolean }>(`/messages?channel=${channelId}${before ? `&before=${before}` : ''}`)
    .finally(() => { if (arriving.get(channelId) === held) arriving.delete(channelId); });
  const last = r.messages.at(-1)?.id ?? 0;
  const cur = older ? S().messages[channelId] ?? [] : held.filter((m) => m.id > last);
  set({
    messages: { ...S().messages, [channelId]: [...r.messages, ...cur] },
    more: { ...S().more, [channelId]: r.more },
    loaded: { ...S().loaded, [channelId]: true },
    ...(older ? {} : { historic: { ...S().historic, [channelId]: false } }),
  });
}

/** Shows the stretch of chat around one message (a search result). New messages are not added until you go back to the latest. */
export async function jumpTo(channelId: number, id: number) {
  const r = await api<{ messages: Message[]; more: boolean; latest: boolean }>(`/messages?channel=${channelId}&around=${id}`);
  set({
    messages: { ...S().messages, [channelId]: r.messages }, more: { ...S().more, [channelId]: r.more },
    loaded: { ...S().loaded, [channelId]: true }, historic: { ...S().historic, [channelId]: !r.latest },
  });
}

/** Opens the text chat beside the room, or closes it if it is already open. */
export async function openText(id: number, keep = false) {
  if (!keep && S().chat === id) { set({ chat: null }); return; }
  set({ chat: id });
  if (!S().loaded[id]) await loadMessages(id).catch(() => {});
  // Read only if the window can be seen, as with a message that arrives (above). The connection coming back opens
  // the chat again by itself, and behind a hidden window that used to mark everything read that nobody had looked at.
  if (!document.hidden) markRead(id);
}

/** Opens my private chat with somebody (it is made the first time). */
export async function openDm(userId: string) {
  try {
    const { id } = await api<{ id: number }>('/dm', { userId });
    if (!S().dms.some((x) => x.id === id)) set({ dms: [...S().dms, { id, with: userId }] });
    await openText(id, true);
  } catch (e: any) { toast(e.message); }
}

let noticeTimer = 0;
/** Shows a notice with one button. It goes away by itself after a while. */
export function notify(text: string, label: string, run: () => void, ms = 25_000) {
  window.clearTimeout(noticeTimer);
  set({ notice: { text, label, run: () => { set({ notice: null }); run(); } } });
  noticeTimer = window.setTimeout(() => set({ notice: null }), ms);
}

/** False if it could not be sent (no connection): the person is told, so what they typed is not quietly lost. */
export function sendMessage(channelId: number, content: string, attachments: Attachment[] = []): boolean {
  const sent = send({ t: 'send', channelId, content, attachments });
  if (!sent) toast('No connection to the server: that was not sent.');
  return sent;
}

export const userName = (id: string) => S().users[id]?.name ?? 'someone';
