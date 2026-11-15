// Deafened means silence: nothing in the app makes a sound until you undeafen. Voices, shared screens, the player,
// soundboard clips and the tones each look at `voice.deafened` themselves; the desktop app also mutes its whole
// window. This file catches whatever is left: any sound or video element on the page (a clip somebody posted in
// chat, say), including ones that appear, start, or are unmuted by hand while you are deafened.
import { useStore } from './store';

const mine = new WeakSet<HTMLMediaElement>();       // the ones muted here, so only those are given their sound back
export const deaf = () => { const v = useStore.getState().voice; return v.deafened && v.channelId != null; };

function hush(el: HTMLMediaElement) {
  if (el.muted) return;
  el.muted = true;
  mine.add(el);
}
function sweep() {
  const on = deaf();
  for (const el of document.querySelectorAll<HTMLMediaElement>('audio, video')) {
    if (on) hush(el);
    else if (mine.has(el)) { el.muted = false; mine.delete(el); }
  }
}

// Sounds and videos that turn up later are only looked out for while deafened: watching the whole page for new ones
// costs a little on every change to it, all day, and deafened is rare.
const arrivals = new MutationObserver(() => { if (deaf()) sweep(); });
let looking = false;
useStore.subscribe((s, prev) => {
  if (s.voice.deafened === prev.voice.deafened && s.voice.channelId === prev.voice.channelId) return;
  sweep();
  const on = deaf();
  if (on && !looking) arrivals.observe(document.documentElement, { childList: true, subtree: true });
  else if (!on && looking) arrivals.disconnect();
  looking = on;
});
for (const ev of ['play', 'volumechange'] as const) {
  document.addEventListener(ev, (e) => { if (deaf() && e.target instanceof HTMLMediaElement) hush(e.target); }, true);
}
