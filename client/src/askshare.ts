// Ask to share: a button on a friend's row (and on them in the room) that asks them to share the game they are playing.
// They see "Riya wants to watch your Kart Racing" at their PC, with Share it and Not now; Not now tells the asker
// quietly ("Riya is not sharing right now"). Nothing goes in the text chat.
//
// Only offered when it can come to something: their PC reports a game by name (presence 'gaming' with a label: "Gaming"
// picked by hand has none, and neither has a PC that keeps its game's name to itself), they are in the same voice chat
// as the asker (a stream is only seen from inside its voice chat), and they are not sharing already.
// Once per asker per person in ten minutes (the server holds to that too), and a "Not now" hushes every ask about that
// game for half an hour, answered quietly for them: nobody gets notice after notice in the middle of a match.
import { lastNative } from './activity';
import { native } from './native';
import type { Source } from './native';
import { hooks, notify, send, toast, useStore } from './store';
import type { Presence } from './types';
import { startShare } from './voice';

const S = useStore.getState;
/** One ask per asker per person in this long. */
export const ASK_EVERY = 10 * 60_000;
/** After "Not now", asks about the same game are answered "not now" for them for this long. */
const HUSH_NO = 30 * 60_000;
/** A notice left unanswered (they were busy in the game) hushes asks for this long. */
const HUSH_IGNORED = ASK_EVERY;
/** How long the notice stays up: they have to get out of their game to see it. */
const NOTICE_MS = 60_000;
const KEY = 'cd_asks';

const nameOf = (id: string) => S().users[id]?.name ?? 'Someone';

// ───────── asking ─────────

let asked: Record<string, number> = (() => { try { const k = JSON.parse(localStorage.getItem(KEY) ?? '{}'); return k && typeof k === 'object' ? k : {}; } catch { return {}; } })();
function keep() {
  const now = Date.now();
  for (const [id, t] of Object.entries(asked)) if (!(now - t < ASK_EVERY)) delete asked[id];
  try { localStorage.setItem(KEY, JSON.stringify(asked)); } catch { /* lasts until the page closes */ }
}

/** The game I may ask this person to share, or '' when the button should not show. */
export function askableGame(userId: string, s = S()): string {
  const me = s.me, p: Presence | undefined = s.presence[userId];
  if (!me || userId === me.id || !p) return '';
  if (p.state !== 'gaming' || !p.label.trim()) return '';                 // a game their PC has named
  if (!p.voice || p.voice.sharing) return '';                              // in voice, and not sharing it already
  if (s.voice.channelId == null || p.voice.channelId !== s.voice.channelId) return '';      // and in my voice chat
  return p.label.trim();
}
/** When I last asked them, if it was in the last ten minutes (0: free to ask). */
export function askedAt(userId: string): number {
  const t = asked[userId] ?? 0;
  return Date.now() - t < ASK_EVERY ? t : 0;
}
export function askToShare(userId: string) {
  const game = askableGame(userId);
  if (!game) return;
  if (askedAt(userId)) return toast(`You asked ${nameOf(userId)} a few minutes ago.`);
  if (!send({ t: 'ask', userId })) return toast('No connection to the server: that was not sent.');
  asked[userId] = Date.now();
  keep();
  toast(`You asked ${nameOf(userId)} to share ${game}.`);
}

// ───────── being asked ─────────

type Open = { from: string[]; game: string; notice: unknown; answered: boolean };
let open: Open | null = null;
let hush: { game: string; until: number } | null = null;
let showing = false;
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const hushed = (game: string) => !!hush && same(hush.game, game) && Date.now() < hush.until;
const no = (from: string) => send({ t: 'askno', userId: from });

const names = (ids: string[]) => { const n = ids.map(nameOf); return n.length < 2 ? n[0] : `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`; };
function show(o: Open) {
  const text = `${names(o.from)} ${o.from.length > 1 ? 'want' : 'wants'} to watch your ${o.game}`;
  showing = true;           // (my own notice taking the place of my own notice is not "went unanswered")
  try { notify(text, 'Share it', () => { o.answered = true; open = null; void shareGame(o.game); }, NOTICE_MS,
    { label: 'Not now', run: () => { o.answered = true; open = null; hush = { game: o.game, until: Date.now() + HUSH_NO }; for (const f of o.from) no(f); } }); } finally { showing = false; }
  o.notice = S().notice;
}

hooks.ask.push((d) => {
  const from = String(d.from ?? '');
  if (!S().users[from]) return;
  if (d.t === 'askno') { toast(`${nameOf(from)} is not sharing right now.`); return; }
  const game = String(d.game ?? '').trim();
  const s = S();
  if (!game || s.voice.sharing || from === s.me?.id) return;               // (sharing already: they can see it)
  if (hushed(game)) { no(from); return; }                                  // said "not now" to this game already
  if (open && same(open.game, game) && s.notice === open.notice) {        // one notice, however many ask
    if (!open.from.includes(from)) open.from.push(from);
    show(open);
    return;
  }
  open = { from: [from], game, notice: null, answered: false };
  show(open);
  // Behind the game, the desktop app's own corner notice says it too; clicking it brings the window up, where the
  // buttons are waiting. (Once per notice: more asks only add names to the one in the window.)
  native?.popup?.(`${nameOf(from)} wants to watch your ${game}`, getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#38ff5c');
});

// The notice went without an answer (it timed out, or a notice with more to it took its place): they are busy playing.
// Asks about that game are hushed for a while, as after "Not now", but the askers are not told anything more.
useStore.subscribe((s, prev) => {
  if (!open || showing || s.notice === prev.notice || s.notice === open.notice || prev.notice !== open.notice) return;
  const o = open;
  // (a moment later: a button clears the notice first and only then says which one it was)
  window.setTimeout(() => {
    if (!o.answered) hush = { game: o.game, until: Date.now() + HUSH_IGNORED };
    if (open === o) open = null;
  }, 0);
});

// ───────── sharing it ─────────

const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, '');
/** The window of the game in front, picked from the shareable windows by its name: the title Windows gives it, against
 *  the game's name and its program's name. Only a single clear match counts; anything less, and the picker opens. */
export function gameWindow(sources: Source[], game: string, proc = ''): Source | null {
  const wants = [norm(game), norm(proc.replace(/\.exe$/i, ''))].filter((w) => w.length >= 3);
  const wins = sources.filter((x) => x.kind === 'window' && norm(x.name) && !/^chatterday$/i.test(x.name.trim()));
  const exact = wins.filter((x) => wants.includes(norm(x.name)));
  if (exact.length === 1) return exact[0];
  const near = wins.filter((x) => wants.some((w) => norm(x.name).includes(w) || (norm(x.name).length >= 4 && w.includes(norm(x.name)))));
  return near.length === 1 ? near[0] : null;
}
async function shareGame(game: string) {
  const s = S();
  if (s.voice.sharing) return;
  if (s.voice.channelId == null) return toast('Join a voice channel first.');
  if (!native) { void startShare(); return; }                              // (a browser shows its own picker)
  const sources = await native.getSources().catch(() => [] as Source[]);
  const proc = lastNative?.state === 'gaming' ? lastNative.proc : '';
  const win = gameWindow(sources, game, proc);
  if (win) void startShare(win.id, game);
  else useStore.setState({ picker: true });
}
