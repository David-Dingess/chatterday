// The photos on the lounge wall: the admin uploads them (Settings → Admin), and the wall's five frames show a new set
// every day at midnight on the house's clock (server/clock.ts). The big gilt frame is filled first, then the four small
// ones (CLUB.gallery, from scripts/make-clubhouse.py); with fewer than five photos the rest keep the paintings the
// room was drawn with. Each photo is cut to a frame's shape where it hangs (the app covers the frame with it, from the
// middle), and shown whole when somebody clicks it.
//
// The photos are ordinary uploads (kind 'photo', only the admin may send one, PNG, JPEG or WebP, see LIMITS.photo) in
// data/uploads, which stays out of git. Their order is kv 'wallPhotos', a JSON list of file ids. Chatterday v1 had one
// photo, kv 'photo': it becomes the first in the list.
import fs from 'node:fs';
import path from 'node:path';
import { UPLOADS } from './config.ts';
import { get, getKV, run, setKV } from './db.ts';
import { houseToday } from './clock.ts';
import { CLUB } from '../client/src/clubhouse.gen.ts';

/** The frames, in the order they are filled: the big one, then the small ones. */
export const FRAMES = ['poster', ...CLUB.gallery.map((g) => g.name)];
/** At most this many photos in the pool. */
export const MAX_WALL = 60;
/** What a wall photo may be. (Not GIF: a moving picture on the wall is not a photo.) */
export const WALL_TYPES = /^image\/(png|jpeg|webp)$/;

const isWallFile = (id: unknown): id is string =>
  typeof id === 'string' && /^[\w-]{1,40}$/.test(id) && !!get("SELECT 1 FROM files WHERE id = ? AND kind = 'photo' AND mime LIKE 'image/%'", id);

/** The photos, in order. */
export function wallPool(): string[] {
  let ids: unknown = [];
  try { ids = JSON.parse(getKV('wallPhotos', '[]')); } catch { /* broken: none */ }
  const list = Array.isArray(ids) ? ids.filter(isWallFile) : [];
  const legacy = getKV('photo');                              // v1's one photo, until the list is first written
  if (legacy && !list.includes(legacy) && isWallFile(legacy)) list.unshift(legacy);
  return [...new Set(list)];
}
function savePool(ids: string[]) {
  setKV('wallPhotos', JSON.stringify(ids));
  setKV('photo', '');
}

/** Adds one uploaded photo to the end. The reason it can't, or ''. */
export function wallAdd(id: unknown): string {
  if (!isWallFile(id)) return 'That photo was not found.';
  const pool = wallPool();
  if (pool.includes(id)) return '';
  if (pool.length >= MAX_WALL) return `The wall holds ${MAX_WALL} photos. Take one down first.`;
  savePool([...pool, id]);
  return '';
}

/** Takes one photo down, and deletes its file. */
export function wallRemove(id: unknown) {
  const pool = wallPool();
  if (typeof id !== 'string' || !pool.includes(id)) return;
  savePool(pool.filter((x) => x !== id));
  forget(id);
}

/** Takes them all down. */
export function wallClear() {
  const pool = wallPool();
  savePool([]);
  for (const id of pool) forget(id);
}

function forget(id: string) {
  run("DELETE FROM files WHERE id = ? AND kind = 'photo'", id);
  fs.rm(path.join(UPLOADS, id), { force: true }, () => {});
}

/** Days since 1970 on the house's clock. */
export const houseDayNumber = (at = Date.now()) => { const [y, md] = houseToday(at); return Math.round(Date.parse(`${y}-${md}T00:00:00Z`) / 86_400_000); };

/** Today's photo in each frame that has one: { poster: '/files/…', boat: … }.
 *  With n photos, min(n, 5) frames are filled, and each day moves on by that many, so a big pool shows new photos
 *  every day and no photo hangs twice on one day. */
export function wallToday(day = houseDayNumber(), pool = wallPool()): Record<string, string> {
  const out: Record<string, string> = {};
  const n = pool.length, k = Math.min(n, FRAMES.length);
  for (let i = 0; i < k; i++) out[FRAMES[i]] = `/files/${pool[(((day * k + i) % n) + n) % n]}`;
  return out;
}

/** Calls back when the house's day turns over (checked once a minute), so everybody's wall can change at midnight. */
export function onNewDay(cb: () => void) {
  let last = houseDayNumber();
  setInterval(() => { const d = houseDayNumber(); if (d !== last) { last = d; cb(); } }, 60_000).unref();
}
