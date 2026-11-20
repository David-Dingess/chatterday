// Each basement game lays a whole shot's sound out at once (the roll, the clacks, the crash), well ahead of time. So
// that closing the game, or being taken out of the room, also silences what was still to come, everything a game
// makes goes through one gain of its own, which hush() cuts at once and throws away (the next sound makes a fresh one).
import { useEffect } from 'react';
import { send, useStore } from '../store';

const buses = new Map<string, { a: AudioContext; g: GainNode }>();

/** Where a game's sounds go: its own gain, into the speakers. */
export function out(a: AudioContext, game: string): AudioNode {
  let b = buses.get(game);
  if (!b || b.a !== a) { b = { a, g: a.createGain() }; b.g.connect(a.destination); buses.set(game, b); }
  return b.g;
}

/** Silences everything a game has playing or still to play. */
export function hush(game: string) {
  const b = buses.get(game);
  if (!b) return;
  buses.delete(game);
  try { b.g.gain.cancelScheduledValues(0); b.g.gain.setValueAtTime(0, b.a.currentTime); b.g.disconnect(); } catch { /* (already gone) */ }
}

/** Runs `shut` whenever I leave the game room (up the stairs by hand, or sent back to my desk for standing about too
 *  long): a game open large, or being watched, closes then and goes quiet, as it would have with Close. Not when I
 *  arrive: Play Games opens a game before the stairs have taken me down. */
export function onLeavingRoom(shut: () => void) {
  let down = false;
  useStore.subscribe((s) => {
    const now = (s.presence[s.me?.id ?? '']?.floor ?? '') === 'gameroom';
    if (down && !now) shut();
    down = now;
  });
}

/** While a game is open large in front of me, a word to the server every minute that I am still watching it: someone
 *  standing by the lane watching friends play is not standing about, and must not be sent back to their desk (the
 *  server's SPOT_IDLE_MS, which counts only clicks and steps), and while a game is going that they are not in, their
 *  status says they are spectating it. `id` is the game (a fit-out game's id, or 'table' for the card table), `part`
 *  which of its games ('pool', 'darts'); null: nothing is being watched. Not while the app is hidden. */
export function useWatching(id: string | null, part = '') {
  useEffect(() => {
    if (!id) return;
    const tick = () => { if (!document.hidden) send({ t: 'watch', id, part }); };
    tick();
    const t = window.setInterval(tick, 60_000);
    return () => { window.clearInterval(t); send({ t: 'watch', stop: true }); };
  }, [id, part]);
}
