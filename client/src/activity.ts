// Decides the one word of presence we tell the server, plus notifications for new messages.
import { native } from './native';
import type { RawActivity } from './native';
import { chime } from './sfx';
import { hooks, mentionsMe, send, useStore, userName, veiled } from './store';
import { setMuted } from './voice';

const S = useStore.getState;
export let lastNative: RawActivity | null = null;
let lastInput = Date.now();
let lastSent = '';

const GAME_HOLD = 60_000;
let game: { label: string; until: number } | null = null;        // the game last seen in front, and until when it still counts

/** How long with nothing touched before "away": the person's own choice (Settings → Privacy). The desktop app is told
 *  the same figure, and stretches it by itself while a game or a video is in front. */
const awayMin = () => Math.max(1, Math.min(60, Number(S().prefs.awayAfter) || 5));
const awayMs = () => awayMin() * 60_000;
// A browser tab only hears the mouse and keys while they are over it, so somebody busy in another window looks idle
// from here. It waits three times as long before it says "away".
const TAB_PATIENCE = 3;
// When I was last heard talking in voice. Nobody is away in the middle of a conversation, hands on the mouse or not.
let lastSpoke = 0;
const talking = () => { const s = S(); return s.voice.channelId != null && !s.voice.muted && !!s.me && !!s.voice.speaking[s.me.id]; };

/** The programs lately in front on this PC, newest first, for Settings → Desktop app ("count this as a game"): by the
 *  time anybody has clicked over to Settings, the app itself is the one in front. `game`: recognised as one already. */
export const recentProcs: { proc: string; game: boolean }[] = [];

function current(): { state: string; label: string } {
  const s = S();
  if (!s.prefs.shareActivity) return { state: 'desk', label: '' };
  const now = Date.now();
  if (talking()) lastSpoke = now;
  // Somebody's stream, open in this window. Not with the PC locked, and not with a game in front on this PC: then
  // the game is what they are doing (the room seats them at their desk for it too).
  const others = s.voice.screens.filter((id) => id !== s.me?.id);
  if (s.view.kind === 'stage' && !document.hidden && others.length && !lastNative?.locked && lastNative?.state !== 'gaming') {
    return { state: 'watching', label: s.prefs.shareDetail ? `${userName(others[0])}'s stream` : '' };
  }
  if (lastNative) {
    // A game stays "on" for a minute after it leaves the front. Somebody flicking to a browser for a guide and back
    // again should not have their character walking to and fro across the room. Going away (idle, or the PC locked)
    // still shows at once.
    if (lastNative.state === 'gaming') game = { label: lastNative.label, until: now + GAME_HOLD };
    else if (lastNative.state === 'away') {
      game = null;
      if (!lastNative.locked && now - lastSpoke < awayMs()) return { state: 'desk', label: '' };      // idle hands, but talking
    } else if (game && now < game.until) return { state: 'gaming', label: s.prefs.shareDetail ? game.label : '' };
    return { state: lastNative.state, label: s.prefs.shareDetail ? lastNative.label : '' };
  }
  return { state: now - Math.max(lastInput, lastSpoke) > awayMs() * TAB_PATIENCE ? 'away' : 'desk', label: '' };
}

// "Sleeping" and "Away", chosen by hand, are taken back when their person returns: the PC went idle (or was locked)
// after they chose it, and now it is in use again. One chosen while already away stands (somebody back for a moment
// to say they are off to bed), until the next time.
let lastState = '', awaySince = 0, placeSetAt = 0;
hooks.presence.push((userId, prev, next) => { if (userId === S().me?.id && prev?.place !== next.place) placeSetAt = Date.now(); });

export function pushActivity(force = false) {
  const a = current();
  if (a.state === 'away' && lastState !== 'away') awaySince = Date.now();
  if (lastState === 'away' && a.state !== 'away' && placeSetAt < awaySince) {
    const s = S(), place = s.me && s.presence[s.me.id]?.place;
    if (place === 'sleeping' || place === 'away') send({ t: 'place', place: '' });
  }
  lastState = a.state;
  const key = a.state + '|' + a.label;
  if (!force && key === lastSent) return;
  lastSent = key;
  send({ t: 'activity', ...a });
}

// Locking the PC mutes the microphone, and unlocking puts it back: but only if it was the lock that muted it.
let lockMuted = false;
function onLock(locked: boolean) {
  const s = S();
  if (locked) {
    if (s.prefs.lockMute && s.voice.channelId != null && !s.voice.muted) { lockMuted = true; void setMuted(true, true); }
  } else if (lockMuted) {
    lockMuted = false;
    if (s.voice.channelId != null && s.voice.muted) void setMuted(false, true);
  }
}
let wasLocked = false;
native?.onActivity((a) => {
  lastNative = a;
  if (a.proc && recentProcs[0]?.proc !== a.proc) {
    const at = recentProcs.findIndex((r) => r.proc === a.proc);
    if (at >= 0) recentProcs.splice(at, 1);
    recentProcs.unshift({ proc: a.proc, game: false });
    recentProcs.length = Math.min(recentProcs.length, 6);
  }
  if (a.proc && a.state !== 'away') recentProcs[0].game = a.state === 'gaming';
  pushActivity();
  if (!!a.locked !== wasLocked) { wasLocked = !!a.locked; onLock(wasLocked); }
});
native?.setAwayAfter?.(awayMin() * 60);
const touched = () => { lastInput = Date.now(); };
for (const ev of ['mousemove', 'keydown', 'pointerdown', 'wheel', 'touchstart', 'focus'] as const) window.addEventListener(ev, touched, { passive: true });
document.addEventListener('visibilitychange', () => { if (!document.hidden) touched(); });       // back on this tab
setInterval(pushActivity, 15_000);
hooks.ready.push(() => pushActivity(true));
useStore.subscribe((s, prev) => {
  if (s.prefs.awayAfter !== prev.prefs.awayAfter) native?.setAwayAfter?.(awayMin() * 60);
  if (s.voice.speaking !== prev.voice.speaking && talking()) lastSpoke = Date.now();
  if (s.view !== prev.view || s.prefs !== prev.prefs || s.voice.screens !== prev.voice.screens || s.voice.speaking !== prev.voice.speaking) pushActivity();
});

let lastPing = 0;
hooks.message.push((m) => {
  const s = S();
  if (m.userId === s.me?.id || s.prefs.notify === 'none') return;
  const viewing = s.chat === m.channelId && document.hasFocus();
  const dm = s.dms.find((x) => x.id === m.channelId);
  const mention = mentionsMe(m) || !!dm;
  if (s.prefs.notify === 'mentions' && !mention) return;
  // A small ping for every message from somebody else, with the chat open or not (but not a volley of them)
  if (Date.now() - lastPing > 1200) { lastPing = Date.now(); chime('message'); }
  if (viewing) return;
  if (document.hasFocus() || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const n = new Notification(dm ? `${userName(m.userId)} (private)` : `${userName(m.userId)} in Text Chat`, { body: veiled(m.content) || 'sent an attachment', silent: true, tag: `fc-${m.channelId}` });
  n.onclick = () => { window.focus(); n.close(); };
});
