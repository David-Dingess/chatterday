// The voice engine (livekit-client) is half of everything the page would otherwise fetch before it can draw, and it is
// wanted only once somebody joins a call. So it is a chunk of its own: fetched when the page has settled after loading
// (so joining is as quick as ever), or by joinVoice if that comes first. Everything that touches it runs with a room,
// which only exists once it is here.
import type * as LK from './livekit-parts';
import { whenIdle } from './later';

let mod: typeof LK | null = null;
let loading: Promise<typeof LK> | null = null;

export function loadLivekit(): Promise<typeof LK> {
  if (mod) return Promise.resolve(mod);
  return (loading ??= import('./livekit-parts').then((m) => (mod = m), (e) => { loading = null; throw e; }));
}

/** The voice engine, once loadLivekit has brought it (anywhere a room exists, it has). */
export const lk = (): typeof LK => {
  if (!mod) throw new Error('The voice engine is not loaded yet.');
  return mod;
};

whenIdle(() => { loadLivekit().catch(() => {}); }, 1500);
