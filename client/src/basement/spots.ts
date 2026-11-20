// Walking to a game: whoever has one of the basement's games open, or is playing one, goes and stands (or sits) where
// somebody taking part would: the player whose go it is up at the oche, the lane, the end of the table; the others
// waiting near it; and whoever is only watching off to one side. The spots are seats in the fit-out
// (scripts/basement/gameroom.py: things['gameSpots'], pose 'stand' and `only`, so nobody else is put in them).
//
// A game says which of its spots I belong in just now as a role ('darts-go', 'darts-watch'...) and the seats for it.
// I am sent there once each time the role changes (my turn coming round, joining, opening the game to watch), never
// again while it stays the same: somebody who walks off while watching is left where they went. Nothing happens unless
// I am down in that room, so nobody upstairs is pulled down the stairs.
import { useEffect, useRef } from 'react';
import { send, useStore } from '../store';
import type { FitLayout } from './index';

/** The seat numbers a game room game puts people in, from the layout. */
export type GameSpots = { go?: number; play?: number[]; wait?: number[]; watch?: number[] };
export const gameSpots = (layout: FitLayout, game: string): GameSpots => (layout.things.gameSpots as Record<string, GameSpots> | undefined)?.[game] ?? {};

/** Of `seats`, the one for me: the one I am in already (unless somebody earlier in the order is in it too: two who
 *  picked at once, one moves along), else the first nobody else is in, else the first. */
function pick(seats: number[], floor: string): number | undefined {
  const s = useStore.getState(), me = s.me?.id ?? '';
  const who = (n: number) => Object.entries(s.presence)
    .filter(([, p]) => p && p.state !== 'offline' && p.floor === floor && p.place === 'here' && p.at?.seat === `b${n}`).map(([id]) => id);
  const mine = seats.find((n) => { const w = who(n); return w.includes(me) && !w.some((id) => id < me); });
  return mine ?? seats.find((n) => !who(n).some((id) => id !== me)) ?? seats[0];
}

/** Walk me to one of `seats` when `role` changes to something (null: I am not taking part, and nothing is done). */
export function useGameSpot(layout: FitLayout, mini: boolean, role: string | null, seats: number[] | number | undefined) {
  const floor = useStore((s) => (s.me ? s.presence[s.me.id]?.floor ?? '' : ''));
  const sent = useRef('');
  const list = seats === undefined ? [] : typeof seats === 'number' ? [seats] : seats;
  const here = !mini && floor === layout.id;
  useEffect(() => {
    if (!role || !here || !list.length) { sent.current = ''; return; }
    if (sent.current === role) return;
    sent.current = role;
    const n = pick(list, layout.id), q = n === undefined ? undefined : layout.seats[n];
    if (!q) return;
    const s = useStore.getState(), p = s.me ? s.presence[s.me.id] : undefined;
    if (p?.place === 'here' && p.at?.seat === `b${n}`) return;
    send({ t: 'place', place: 'here', x: q.x, y: q.y, seat: `b${n}` });
  }, [role, here, list.join()]);   // eslint-disable-line react-hooks/exhaustive-deps
}
