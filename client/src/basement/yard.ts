// What being in the backyard reads as in somebody's status (client/src/components/ui.tsx), from where they are and what
// the yard's game says they are doing (server/basement/backyard.ts): mowing the lawn, smoking, in the hot tub, swimming.
import { useStore } from '../store';
import { LAYOUT } from './backyard.gen.ts';

const T = LAYOUT.things as Record<string, any>;
const TUB = new Set<number>(T.tubSeats as number[]);
const PATIO = new Set<number>(T.patio as number[]);
const [PX, PY, PW, PH] = T.pool as number[];
export const inPool = (x: number, y: number) => x >= PX && x < PX + PW && y >= PY && y < PY + PH;
export type Yard = {
  mower: { by: string | null; on: boolean; x: number; y: number; face: string };
  smoke: Record<string, { kind: string; at: number }>;
  jets: boolean; radio: boolean;
  dives: Record<string, { at: number; spin: boolean }>;
  last: string; lastAt: number; now: number;
  lawn?: { base: number; cells: string };
};
/** What of the yard shows in people's statuses, in a word: for a list of people to be drawn again when it changes (it
 *  is not their presence that changed). */
export function yardKey(s: { fits: Record<string, unknown> }): string {
  const y = s.fits.backyard as Yard | undefined;
  return y ? `${y.mower.by ?? ''}|${Object.entries(y.smoke).map(([id, v]) => id + v.kind).join(',')}` : '';
}
const SMOKING: Record<string, string> = { cig: 'Having a smoke', cigar: 'Smoking a cigar', corncob: 'Smoking a corncob pipe', calabash: 'Smoking a calabash pipe', bubbles: 'Blowing bubbles', fan: 'Cooling off with a fan' };

export function yardText(p: { floor?: string; place?: string; at?: { x: number; y: number; seat?: string } } | undefined): string | null {
  if (!p || p.floor !== 'backyard') return null;
  const s = useStore.getState(), y = s.fits.backyard as Yard | undefined;
  const uid = Object.keys(s.presence).find((id) => s.presence[id] === p);      // (the presence is the store's own object)
  if (uid && y?.mower.by === uid) return 'Mowing the lawn';
  const seat = p.place === 'here' ? /^b(\d+)$/.exec(p.at?.seat ?? '') : null, n = seat ? Number(seat[1]) : -1;
  if (TUB.has(n)) return 'In the hot tub';
  if (n === T.board) return 'On the diving board';
  if (p.place === 'here' && p.at && !seat && inPool(p.at.x, p.at.y)) return 'Swimming';
  const smoking = uid ? y?.smoke[uid]?.kind : undefined;
  if (smoking && SMOKING[smoking]) return SMOKING[smoking];
  if (PATIO.has(n)) return 'On the patio';
  return 'In the backyard';
}
