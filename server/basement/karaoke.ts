// The karaoke lounge, the server's half (the room: scripts/basement/karaoke.py; the page: client/src/basement/karaoke.tsx).
// The songs are the Player's own: a sign-up is a Player song tagged with its singer (the 'music' message, op 'play' with
// karaoke: true; music.ts signUp), so the line-up is the Player's queue, and seeking, pausing, Done (a skip) and keeping
// everybody in step are the Player's as always. What is here:
//   { op: 'search', q }   -> { op: 'found', q, results } to them: YouTube's top hits for the song, "karaoke" added to it
//                            (so karaoke and lyric versions come first), for them to pick one
//   the announcer: whenever the Player moves on from or to somebody's song, everybody is sent { op: 'say', text, at, singer }
//                            ("Great job, Sam! Riya, you're up!"); each page speaks it (if it can hear the Player) and shows it
//   their status: whoever is singing "singing karaoke" (wherever they are), anybody else down here "at karaoke"
//   { op: 'sync', by }    -> the admin only: the singer's head start moves by `by` ms (SYNC_MIN..SYNC_MAX), and everybody
//                            is sent the new state { sync } (it is in hello too). The singer's own video runs that far ahead
//                            of everybody else's, so their voice, which reaches the others late, lands on the beat there.
import { floorOf } from '../floor.ts';
import type { FitGame, FitOut } from '../floor.ts';
import { findVideos, playerChanged, playerNow } from '../music.ts';
import type { Playing } from '../music.ts';

let out: FitOut | undefined;
/** The singer's head start, in ms, to begin with; the admin tunes it by ear (kept across restarts). */
export const SYNC_START = 450, SYNC_MIN = 0, SYNC_MAX = 1500;
let sync = SYNC_START;
const state = () => ({ sync });
const lastSearch = new Map<string, number>();

/** "Sam" of "Sam", and of "Sam Rivera". */
const first = (uid: string) => (out?.nameOf(uid) ?? 'Someone').trim().split(/\s+/)[0] || 'Someone';

/** What the announcer says as the Player goes from `was` to `now`: '' when neither is anybody's song. */
export function announce(was: Playing | null, now: Playing | null, name: (uid: string) => string = first): string {
  if (was && now && was.id === now.id) return '';                  // (a stand-in for a video that would not play: the same turn)
  const a = was?.singer, b = now?.singer;
  const parts: string[] = [];
  if (a) parts.push(`Great job, ${name(a)}!`);
  if (b) parts.push(b === a ? `${name(b)}, you're up again!` : `${name(b)}, you're up!`);
  return parts.join(' ');
}

function changed(was: Playing | null, now: Playing | null) {
  const text = announce(was, now);
  if (text && out) out.all({ op: 'say', text, at: Date.now(), singer: now?.singer ?? null, song: now?.id ?? null });
}

const game: FitGame = {
  start(o) {
    out = o;
    const kept = Number(o.load('sync', SYNC_START));
    sync = Number.isFinite(kept) ? Math.max(SYNC_MIN, Math.min(SYNC_MAX, Math.round(kept))) : SYNC_START;
    playerChanged.push(changed);
  },
  hello: state,
  message(uid, d, o) {
    if (d.op === 'sync') {
      const by = Math.round(Number(d.by));
      if (!o.isAdmin(uid) || !Number.isFinite(by) || !by) return;
      sync = Math.max(SYNC_MIN, Math.min(SYNC_MAX, sync + Math.max(-500, Math.min(500, by))));
      o.save('sync', sync);
      o.all({ state: state() });
      return;
    }
    if (d.op !== 'search') return;
    const q = String(d.q ?? '').replace(/\s+/g, ' ').trim().slice(0, 150);
    const now = Date.now();
    if (!q || now - (lastSearch.get(uid) ?? 0) < 1500) return;
    lastSearch.set(uid, now);
    // (a pasted link is played as it is; anything else is looked for as a karaoke track, unless it says what it wants already)
    const link = /https?:\/\/|youtu\.?be/i.test(q);
    const ask = link || /\b(karaoke|lyrics?|instrumental|sing ?along)\b/i.test(q) ? q : `${q} karaoke`;
    findVideos(ask, 'youtube')
      .then((found) => o.to(uid, { op: 'found', q, results: found.filter((f) => /^[\w-]{11}$/.test(f.videoId)).slice(0, 5) }))
      .catch((e) => { console.error('[karaoke] search:', e); o.to(uid, { op: 'found', q, results: [], error: 'Could not search YouTube just now.' }); });
  },
  playing(uid) {
    if (playerNow.get()?.singer === uid) return { game: 'karaoke', waiting: false, says: 'singing karaoke' };
    // (by the floor alone: out.present() asks everybody's presence, which asks this, round and round)
    if (floorOf(uid) === 'karaoke') return { game: 'karaoke', waiting: false, says: 'at karaoke' };
    return null;
  },
};
export default game;
