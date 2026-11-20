// The DnD table's map, drawn on live (server/basement/dnd.ts routes { op: 'ink' } here; client/src/basement/dnd/ink.tsx
// draws it). Kept in its own folder so floor.ts does not take it for a fit-out game of its own.
//
// Each map has its own drawing, kept by the map's address ('' is the bare table with no map): switching maps puts that
// map's sketch back. A stroke is a line of points in map squares (so it stays on the grid whatever the picture's size), an
// ink (one of INKS on the page) and a width in squares. Strokes arrive while they are being drawn: 'start' with the first
// points, then 'more' (each says where its points go, so a repeat does no harm), and everybody sees them as they grow.
// A stroke's id travels as `sid` (`id` on the wire is the fit-out's).
//
// Who may: the DM (or anybody, with nobody in the chair) draws, rubs out any stroke and clears the map; players draw only
// when the DM lets them (st.inkAll), and rub out, undo or clear only their own.

export type Stroke = { id: string; by: string; c: number; w: number; p: number[] };
export type Ink = Record<string, Stroke[]>;

export const INK_COUNT = 6;
export const WIDTHS = [0.08, 0.16, 0.32];
const MAX_STROKES = 1500, MAX_NUMS = 1000, MAX_MAP_NUMS = 120_000;
const SID = /^[\w-]{4,24}$/;

const pts = (v: unknown, room: number): number[] => {
  if (!Array.isArray(v)) return [];
  const out: number[] = [];
  for (const n of v.slice(0, Math.max(0, room) & ~1)) {
    const x = Number(n);
    if (!Number.isFinite(x)) return [];
    out.push(Math.round(Math.max(-20, Math.min(300, x)) * 50) / 50);
  }
  return out.length % 2 ? out.slice(0, -1) : out;
};
const used = (list: Stroke[]) => list.reduce((a, s) => a + s.p.length, 0);

/** Applies one ink message; returns what to tell everybody (null: nothing changed). */
export function inkMessage(ink: Ink, uid: string, key: string, d: Record<string, unknown>, may: { draw: boolean; boss: boolean }): Record<string, unknown> | null {
  const list = (ink[key] ??= []);
  switch (d.act) {
    case 'start': {
      if (!may.draw || typeof d.sid !== 'string' || !SID.test(d.sid) || list.length >= MAX_STROKES) return null;
      if (list.some((s) => s.id === d.sid)) return null;
      const p = pts(d.p, Math.min(MAX_NUMS, MAX_MAP_NUMS - used(list)));
      if (!p.length) return null;
      const s: Stroke = { id: d.sid, by: uid, c: Math.max(0, Math.min(INK_COUNT - 1, Math.round(Number(d.c) || 0))), w: Math.max(0, Math.min(WIDTHS.length - 1, Math.round(Number(d.w) || 0))), p };
      list.push(s);
      return { act: 'start', key, stroke: s };
    }
    case 'more': {
      const s = list.find((x) => x.id === d.sid);
      if (!s || s.by !== uid || !may.draw) return null;
      const at = Math.max(0, Math.min(s.p.length, Math.round(Number(d.at) || 0))) & ~1;
      const p = pts(d.p, Math.min(MAX_NUMS - at, MAX_MAP_NUMS - used(list) + (s.p.length - at)));
      if (!p.length) return null;
      s.p.splice(at, s.p.length - at, ...p);
      return { act: 'more', key, sid: s.id, at, p };
    }
    case 'erase': {
      const ids = new Set(Array.isArray(d.ids) ? d.ids.filter((x): x is string => typeof x === 'string').slice(0, 200) : []);
      const gone = list.filter((s) => ids.has(s.id) && (may.boss || s.by === uid)).map((s) => s.id);
      if (!gone.length) return null;
      ink[key] = list.filter((s) => !gone.includes(s.id));
      return { act: 'erase', key, ids: gone };
    }
    case 'undo': {
      for (let k = list.length - 1; k >= 0; k--) {
        if (list[k].by !== uid) continue;
        const [s] = list.splice(k, 1);
        return { act: 'erase', key, ids: [s.id] };
      }
      return null;
    }
    case 'mine': {                                               // rub out every line of mine on this map
      const gone = list.filter((s) => s.by === uid).map((s) => s.id);
      if (!gone.length) return null;
      ink[key] = list.filter((s) => s.by !== uid);
      return { act: 'erase', key, ids: gone };
    }
    case 'clear': {
      if (!may.boss || !list.length) return null;
      ink[key] = [];
      return { act: 'clear', key };
    }
  }
  return null;
}

/** A drawing as it came back from the database or a backup, made safe. */
export function cleanInk(v: unknown): Ink {
  const out: Ink = {};
  if (!v || typeof v !== 'object') return out;
  for (const [key, list] of Object.entries(v as Record<string, unknown>)) {
    if (!Array.isArray(list)) continue;
    out[key] = list.filter((s): s is Stroke => !!s && typeof s === 'object' && typeof (s as Stroke).id === 'string' && Array.isArray((s as Stroke).p)).slice(0, MAX_STROKES);
  }
  return out;
}
