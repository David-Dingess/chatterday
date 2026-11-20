// Game alerts: "Sam started Kart Racing", a quiet notice at the corner (the same one as "Watch" for a shared screen),
// with one button. Joining him if he is in a voice chat; waving him over if he is not.
//
// Only a game his PC reports (presence state 'gaming' with the game's name, from the desktop app): "Gaming" picked by
// hand is a place, not a state, and comes with no name. Each page decides for itself from the presence it is sent
// anyway, so the server has nothing to do. No sound, nothing in the text chat.
import { lastNative } from './activity';
import { native } from './native';
import { hooks, notify, send, toast, useStore } from './store';
import type { Presence } from './types';
import { joinVoice } from './voice';

const S = useStore.getState;
/** One notice per person per game, at most, in this long. */
const TOLD_EVERY = 3 * 3600_000;
/** A game seen in this long is the same sitting, not a new start: a page that reloads for an update, a server restart
 *  (everybody comes back "offline" first), or a game that left the front for longer than the 60 s the PC holds it. */
const SAME_SITTING = 10 * 60_000;
const KEY = 'cd_gamealerts';

type Kept = { told: Record<string, number>; seen: Record<string, number> };
function load(): Kept {
  try {
    const k = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { told: k?.told && typeof k.told === 'object' ? k.told : {}, seen: k?.seen && typeof k.seen === 'object' ? k.seen : {} };
  } catch { return { told: {}, seen: {} }; }
}
let kept = load();
function save() {
  const now = Date.now();
  // (only what still counts is kept)
  for (const m of [kept.told, kept.seen]) for (const [k, t] of Object.entries(m)) if (!(now - t < TOLD_EVERY)) delete m[k];
  try { localStorage.setItem(KEY, JSON.stringify(kept)); } catch { /* lasts until the page closes */ }
}

/** The game somebody's PC says is in front, or '' (none, picked by hand, or they keep its name to themselves). */
const gameOf = (p: Presence | undefined) => (p && p.state === 'gaming' ? p.label.trim() : '');
const keyOf = (userId: string, game: string) => `${userId}|${game.toLowerCase()}`;

/** Everybody playing something now is "seen" playing it: kept fresh, so a later report of the same game is not news. */
function markSeen() {
  const s = S(), now = Date.now();
  for (const [id, p] of Object.entries(s.presence)) { const g = gameOf(p); if (g && id !== s.me?.id) kept.seen[keyOf(id, g)] = now; }
  save();
}
hooks.ready.push(markSeen);          // (what is already going on when the page connects is not news)
window.setInterval(markSeen, 60_000);

/** Why not to say anything to me just now, if there is a reason. */
function quiet(p: Presence): boolean {
  const s = S(), me = s.me, mine = me && s.presence[me.id];
  if (!me || !s.prefs.gameAlerts) return true;
  if (mine?.place === 'sleeping') return true;                                       // gone to bed
  if (p.voice && s.voice.channelId === p.voice.channelId) return true;              // with them already
  if (lastNative?.state === 'gaming') return true;                                  // a game in front on my own PC (the app cannot tell full screen from not)
  if (s.notice) return true;                                                        // (never over a notice with more to it: a shared screen, the game table)
  return false;
}

hooks.presence.push((userId, prev, next) => {
  const s = S();
  if (userId === s.me?.id) return;
  const game = gameOf(next);
  if (!game || game === gameOf(prev)) return;
  const key = keyOf(userId, game), now = Date.now();
  const fresh = !(now - (kept.seen[key] ?? 0) < SAME_SITTING);
  kept.seen[key] = now;
  if (!fresh || now - (kept.told[key] ?? 0) < TOLD_EVERY || quiet(next)) { save(); return; }
  kept.told[key] = now;
  save();
  const name = s.users[userId]?.name ?? 'Someone';
  const join = !!next.voice && s.settings.voice;
  notify(`${name} started ${game}.`, join ? `Join ${name}` : 'Wave', () => {
    const p = S().presence[userId];
    if (p?.voice && S().settings.voice) { if (S().voice.channelId !== p.voice.channelId) void joinVoice(p.voice.channelId); return; }
    send({ t: 'wave', userId });
    toast(`You waved at ${name}.`);
  }, 20_000);
  // With the window closed to the tray or behind another one, the desktop app's own corner notice says it too (it
  // shows nothing while the window is in front, and clicking it opens the window, where the button is waiting).
  native?.popup?.(`${name} started ${game}`, getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#38ff5c');
});
