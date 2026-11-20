// Music for the voice chat: a shared queue of YouTube videos. The server keeps the list and the clock; every person's
// own app plays the video in YouTube's own embedded player, so nothing is sent through voice.
//
// Searching uses only the official YouTube Data API, with the host's own key (Settings, Admin, or YOUTUBE_KEY in .env).
// YouTube's terms do not allow reading its pages any other way. Without a key, pasting a link still works: its title
// comes from YouTube's public oEmbed endpoint.
import { getKV } from './db.ts';

export type Found = { videoId: string; title: string; seconds: number };
/** `auto`: put on by autoplay, after `by`'s pick. `singer`: a karaoke sign-up, sung by them (server/basement/karaoke.ts). */
export type Song = Found & { id: number; by: string; alts: Found[]; auto?: boolean; singer?: string };
/** `pausedAt`: how far in it was (in seconds) when somebody paused it for everyone; null or missing while it plays. */
export type Playing = Song & { startedAt: number; pausedAt?: number | null; /** a live stream: it has no length */ live?: boolean };

/** Thrown when there is nothing that may be done: the message is shown to the person who asked. */
export class NoSearch extends Error {}

// ── karaoke ──
// A karaoke song is an ordinary Player song tagged with who sings it, so seeking, pausing, skipping and staying in step
// all work as they always do. The karaoke lounge (server/basement/karaoke.ts) is told whenever what is on changes.
/** Called with what was on and what is on now, every time the Player moves on (index.ts startSong). */
export const playerChanged: ((was: Playing | null, now: Playing | null) => void)[] = [];
/** What the Player has on just now (index.ts puts the real one here). */
export const playerNow = { get: (): Playing | null => null };
/** How many songs one person may have waiting to sing at once. */
export const KARAOKE_EACH = 2;
/** A karaoke sign-up joins the Player's queue after the last one signed up before it (ahead of songs queued just to
 *  listen to), or starts at once if what is on is nothing, the radio or autoplay's pick and nobody else is waiting to
 *  sing. False: they already have KARAOKE_EACH waiting. */
export function signUp(music: { current: Playing | null; queue: Song[] }, song: Song, start: (s: Song) => void): boolean {
  if (music.queue.filter((s) => s.singer === song.singer).length >= KARAOKE_EACH) return false;
  const cur = music.current;
  if ((!cur || cur.auto || cur.live) && !music.queue.some((s) => s.singer)) { start(song); return true; }
  let at = 0;
  music.queue.forEach((s, i) => { if (s.singer) at = i + 1; });
  music.queue.splice(at, 0, song);
  return true;
}

/** The video a link points at, or '' if the text is not a YouTube link. */
export function videoIdOf(text: string): string {
  const m = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{11})/.exec(text);
  return m ? m[1] : '';
}

export const youtubeKey = () => getKV('youtubeKey') || process.env.YOUTUBE_KEY || '';

export async function titleOf(videoId: string): Promise<string> {
  try {
    const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}`, { signal: AbortSignal.timeout(8000) });
    if (r.ok) return String((await r.json() as any).title ?? '').slice(0, 120);
  } catch { /* fall through */ }
  return 'YouTube video';
}

/** ISO 8601 durations from the API ("PT1H2M3S") as seconds. */
const isoSeconds = (d: string | undefined) => {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(d ?? '');
  return m ? ((+(m[1] ?? 0) * 24 + +(m[2] ?? 0)) * 60 + +(m[3] ?? 0)) * 60 + +(m[4] ?? 0) : 0;
};

const unescape = (s: string) => s.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

/** Title and length of some videos, from the API (one call for up to 50). Missing ones are simply left out. */
export async function videoDetails(ids: string[], key = youtubeKey()): Promise<Map<string, { title: string; seconds: number }>> {
  const out = new Map<string, { title: string; seconds: number }>();
  if (!key || !ids.length) return out;
  const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails&id=${ids.slice(0, 50).join(',')}&key=${encodeURIComponent(key)}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`YouTube said ${r.status}`);
  for (const v of ((await r.json()) as any).items ?? []) {
    if (v.id) out.set(String(v.id), { title: unescape(String(v.snippet?.title ?? '')).slice(0, 120), seconds: isoSeconds(v.contentDetails?.duration) });
  }
  return out;
}

async function officialSearch(q: string, key: string): Promise<Found[]> {
  const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoEmbeddable=true&maxResults=5&q=${encodeURIComponent(q)}&key=${encodeURIComponent(key)}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`YouTube search said ${r.status}`);
  const found: Found[] = (((await r.json()) as any).items ?? []).filter((i: any) => i.id?.videoId)
    .map((i: any) => ({ videoId: String(i.id.videoId), title: unescape(String(i.snippet?.title ?? '')).slice(0, 120), seconds: 0 }));
  try {                                                         // lengths, so the queue moves on by itself
    const more = await videoDetails(found.map((f) => f.videoId), key);
    for (const f of found) f.seconds = more.get(f.videoId)?.seconds ?? 0;
  } catch { /* without lengths it still plays; the player says when a video ends */ }
  return found;
}

/** Any id the player knows how to play: a YouTube id. */
export const PLAYABLE = /^[\w-]{11}$/;

const cut = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);

// ── the radios in the rooms ──
// A click on a radio (the boombox, the jukebox, the radios outside) asks for this instead of a search: Lofi Girl's 24/7
// "lofi hip hop radio - beats to relax/study to". The stream is started over now and then under a new id, so with a
// YouTube key the id is looked up (the channel's live streams, through the official search) and kept for an hour.
// Without a key, or if that fails, the id kept here plays.
export const LOFI_RADIO = 'radio:lofi';
const LOFI_GIRL = 'UCSJ4gkVC6NrvII8umztf0Ow';                 // the Lofi Girl channel
const LOFI_TITLE = 'lofi hip hop radio - beats to relax/study to';
const LOFI_KNOWN: Found = { videoId: 'rFZHOHl-L8A', title: LOFI_TITLE, seconds: 0 };      // (the one on 2026-11-18)
let lofiKept: { at: number; found: Found[] } | null = null;
async function lofiRadio(): Promise<Found[]> {
  if (lofiKept && Date.now() - lofiKept.at < 3_600_000) return lofiKept.found;
  const key = youtubeKey();
  if (!key) return [LOFI_KNOWN];
  try {
    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&eventType=live&videoEmbeddable=true&maxResults=10&channelId=${LOFI_GIRL}&key=${encodeURIComponent(key)}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`YouTube search said ${r.status}`);
    const theirs: Found[] = (((await r.json()) as any).items ?? []).filter((i: any) => /^[\w-]{11}$/.test(i.id?.videoId ?? ''))
      .map((i: any) => ({ videoId: String(i.id.videoId), title: cut(unescape(String(i.snippet?.title ?? '')).replace(/\p{Extended_Pictographic}|\uFE0F/gu, '')), seconds: 0 }));
    // (the study one first; its other streams, sleep, jazz and so on, stand in if it will not play)
    const study = theirs.find((f) => /relax\/study|study\/relax/i.test(f.title));
    if (study) {
      const found = [{ ...study, title: LOFI_TITLE }, ...theirs.filter((f) => f !== study)];
      if (!found.some((f) => f.videoId === LOFI_KNOWN.videoId)) found.push(LOFI_KNOWN);
      lofiKept = { at: Date.now(), found };
      return found;
    }
    console.error('[music] the lo-fi radio was not among the live streams: playing the id kept in the code');
  } catch (e) { console.error('[music] looking for the lo-fi radio:', e); }
  return [LOFI_KNOWN];
}

/** The top results for what somebody typed: a link plays that video, anything else is searched for on YouTube. */
export async function findVideos(text: string): Promise<Found[]> {
  if (text === LOFI_RADIO) return lofiRadio();
  const q = text.trim().slice(0, 200);
  const linked = videoIdOf(q);
  if (linked) return [{ videoId: linked, title: await titleOf(linked), seconds: 0 }];
  const key = youtubeKey();
  if (!key) throw new NoSearch('Searching needs a YouTube key (Settings, Admin). Without one, paste a YouTube link instead.');
  try { return await officialSearch(q, key); }
  catch (e) { console.error('[music] YouTube search failed:', e); throw new NoSearch('YouTube search did not answer. Try again, or paste a link.'); }
}
