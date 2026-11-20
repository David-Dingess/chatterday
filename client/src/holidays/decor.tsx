// The holiday decorations in a room: the day's holiday (dates.ts), where its things go in this room (rooms.ts), drawn
// from art.ts. Each is a plain picture laid in the room at its depth: nothing takes a click, nothing is saved, and the
// room's own pictures are unchanged (it is all on or off by the date). `?date=MM-DD` (or YYYY-MM-DD) and `?hour=21` in
// the address preview a day and an hour.
//
// What moves (the tree's lights, the garland's bulbs, a lantern's candle, the yule log's flames) moves by the
// stylesheet alone, a frame at a time: no state changes while it does, and none at all with reduced motion. None of it
// throws light on anybody: the lights are in the pictures themselves.
import { memo, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { CLUB } from '../clubhouse.gen';
import { useStore } from '../store';
import { houseHM } from '../clock';
import { personColor } from '../sprites';
import { sprite } from './art';
import type { Pic } from './art';
import { useHoliday } from './dates';
import { GARLAND, ROOMS, stockingSpots } from './rooms';
import './holidays.css';

// The pictures, drawn once each at 4x like the room's own art (scaled down to the room smoothly). A sprite's frames
// side by side; a garland's one above the other (so it can repeat along the wall and still step through its frames).
const SCALE = 4;
const urls = new Map<string, string>();
function urlOf(name: string): string {
  let u = urls.get(name);
  if (u) return u;
  const s = sprite(name), f = s.frames, w = f[0].w, h = f[0].h, down = !!s.tile;
  const one = document.createElement('canvas'), big = document.createElement('canvas');
  one.width = down ? w : w * f.length; one.height = down ? h * f.length : h;
  f.forEach((p: Pic, k) => one.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(p.px), p.w, p.h), down ? 0 : k * w, down ? k * h : 0));
  big.width = one.width * SCALE; big.height = one.height * SCALE;
  const g = big.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  g.drawImage(one, 0, 0, big.width, big.height);
  urls.set(name, (u = big.toDataURL()));
  return u;
}

/** Whether it is dark out on the clubhouse clock (or the hour previewed): the lanterns are lit. Changes twice a day. */
const FORCED_HOUR = new URLSearchParams(location.search).get('hour');
const isDark = () => {
  const h = FORCED_HOUR !== null && FORCED_HOUR !== '' ? ((Number(FORCED_HOUR) % 24) + 24) % 24 : houseHM()[0];
  return CLUB.light[h] < 0.35;
};
function useDark() {
  const [dark, setDark] = useState(isDark);
  useEffect(() => {
    const t = window.setInterval(() => setDark(isDark()), 60_000);
    return () => window.clearInterval(t);
  }, []);
  return dark;
}

/** Lanterns: frame 0 by day, frames 1 and 2 (the candle flickering) once lit. */
const LANTERNS = new Set(['jack', 'gourd']);
/** Pictures that step through all their frames, always: [class, frames]. */
const MOVES: Record<string, string> = { tree: 'tw3', yulelog: 'tw2' };

/** One picture in the room, top-left corner at (x, y). */
function Thing({ name, x, y, z, flip, lit, w: wide }: { name: string; x: number; y: number; z?: number; flip?: boolean; lit?: boolean; w?: number }) {
  const s = sprite(name), f = s.frames, w = f[0].w, h = f[0].h;
  const style: CSSProperties & Record<string, string | number> = {
    left: x, top: y, width: wide ?? w, height: h, zIndex: z ?? y + h, backgroundImage: `url(${urlOf(name)})`, '--fw': `${w}px`, '--fh': `${h}px`,
  };
  let cls = 'hol';
  if (s.tile) {
    style.backgroundSize = `${w}px ${h * f.length}px`;
    cls += ' tile';
    if (f.length > 1) cls += ' tile-tw';
  } else {
    style.backgroundSize = `${w * f.length}px ${h}px`;
    if (LANTERNS.has(name) && lit) { cls += ' flick'; style.backgroundPosition = `${-w}px 0`; }
    else if (MOVES[name]) cls += ` ${MOVES[name]}`;
  }
  if (flip) style.transform = 'scaleX(-1)';
  return <i className={cls} aria-hidden style={style} />;
}

/** The decorations for `room` ('club' upstairs, or a basement fit-out's id), if today is one of the holidays. */
export const HolidayDecor = memo(function HolidayDecor({ room }: { room: string }) {
  const day = useHoliday();
  const dark = useDark();
  const users = useStore((s) => s.users);
  const presence = useStore((s) => s.presence);
  const r = ROOMS[room];
  // Christmas stockings: one for each person holding a desk just now, in their colour, hung on their desk upstairs and in
  // desk order along the room's ledge downstairs
  const stockings = useMemo(() => {
    if (!r?.stockings || day?.id !== 'christmas') return [];
    const people = Object.values(users).filter((u) => u.role !== 'removed').sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    const owned = people.map((u) => ({ u, slot: presence[u.id] && presence[u.id]!.state !== 'offline' && (presence[u.id]!.slot ?? -1) >= 0 ? presence[u.id]!.slot! : 1e9 })).filter((o) => o.slot < CLUB.pcs.length).sort((a, b) => a.slot - b.slot);
    const spots = stockingSpots(r, owned.map((o) => o.slot));
    return spots.map((sp) => ({ ...sp, colour: personColor(owned.find((o) => o.slot === sp.slot)!.u) }));
  }, [r, day?.id, users, presence]);
  if (!r || !day) return null;
  const id = day.id, lit = dark || !!r.alwaysLit;
  const all = r.pieces[id] ?? [];
  // on the day itself, its own things are added, each in place of an everyday one at the same spot (the web gets a spider)
  const pieces = all.filter((p) => (p.peak ? day.peak : !(day.peak && all.some((q) => q.peak && q.x === p.x && q.y === p.y))) && (!p.presents || day.presents));
  const garland = r.garland?.[id] ?? GARLAND[id];
  return (
    <>
      {(r.runsFor?.[id] ?? r.runs).map(([x, y, w, z], k) => <Thing key={`g${k}`} name={garland} x={x} y={y} z={z} w={w} />)}
      {pieces.map((p, k) => <Thing key={k} name={p.s} x={p.x} y={p.y} z={p.z} flip={p.flip} lit={lit} />)}
      {stockings.map((sp) => <Thing key={`st${sp.slot}`} name={`stocking:${sp.colour}`} x={sp.x} y={sp.y} z={sp.z} />)}
    </>
  );
});
