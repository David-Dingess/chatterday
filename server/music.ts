// Music for the voice chat: a shared queue of YouTube videos. The server keeps the list and the clock;
// every person's own app plays the video in YouTube's own embedded player, so nothing is sent through voice.
//
// Searching uses only the official YouTube Data API, with the host's own key (Settings, Admin, or YOUTUBE_KEY in
// .env); YouTube's terms do not allow reading its search pages any other way. Without a key, pasting a YouTube
// link still works: its title comes from YouTube's public oEmbed endpoint.
import { getKV } from './db.ts';

export type Found = { videoId: string; title: string; seconds: number };
export type Song = Found & { id: number; by: string; alts: Found[] };
/** `pausedAt`: how far in it was (in seconds) when somebody paused it for everyone; null or missing while it plays. */
export type Playing = Song & { startedAt: number; pausedAt?: number | null; /** a live stream: it has no length */ live?: boolean };

/** Thrown when there is nothing that may be done: the message is shown to the person who asked. */
export class NoSearch extends Error {}

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

/** The top results for what somebody typed: a link plays that video, anything else is searched for. */
export async function findVideos(text: string): Promise<Found[]> {
  const q = text.trim().slice(0, 200);
  const linked = videoIdOf(q);
  if (linked) return [{ videoId: linked, title: await titleOf(linked), seconds: 0 }];
  const key = youtubeKey();
  if (!key) throw new NoSearch('Searching needs a YouTube key (Settings, Admin). Without one, paste a YouTube link instead.');
  try { return await officialSearch(q, key); }
  catch (e) { console.error('[music] YouTube search failed:', e); throw new NoSearch('YouTube search did not answer. Try again, or paste a link.'); }
}
