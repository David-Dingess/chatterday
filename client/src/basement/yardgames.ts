// What the backyard's lawn games (beer pong on the patio, horseshoes and bocce on the lawn) have in common, shared by the
// server (server/basement/beerpong.ts, horseshoes.ts, bocce.ts keep the games) and the page (pong.tsx, shoes.tsx,
// bocce.tsx draw them). Each game's own measures and throws are in pong.ts, shoes.ts and bocce.ts beside this.
//
// Everything is measured in feet, and drawn in the yard at 8 dots a foot (as cornhole is at the campsite). None of it
// looks at the grass: the lawn is mown for its looks only (lawn.ts), and plays the same however long it is.

/** Dots a foot, in the yard's picture. */
export const DOTS = 8;
export const TEAMS = ['Red', 'Blue'], COLORS = ['#d8402c', '#2f62d8'];

/** Two sides of one or two people each (one person may join both, to practise). */
export type Sides = { teams: string[][]; on: boolean; over: boolean; winner: number; last: string; busyUntil: number };

/** Somebody joining a side between games: the sides after it, or null if they may not. */
export function joined(g: Sides, uid: string, team: number): string[][] | null {
  if ((team !== 0 && team !== 1) || (g.on && !g.over) || g.teams[team].includes(uid) || g.teams[team].length >= 2) return null;
  return g.teams.map((m, k) => (k === team ? [...m, uid] : m));
}
export const inSides = (g: Sides | null | undefined, uid: string | null | undefined) => !!g && !!uid && g.teams.some((m) => m.includes(uid));
export const mySide = (g: Sides | null | undefined, uid: string | null | undefined) => (g && uid ? g.teams.findIndex((m) => m.includes(uid)) : -1);

/** A normal draw (about -2 to 2), for a hand that is never quite steady. */
export const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

/** How far a throw is dragged back for full strength (canvas dots, on a 1000-wide canvas). */
export const PULL = 260;
/** The strength a drag back shows just now: past half it shakes (more the harder it is pulled), and what it shows at the
 *  moment of letting go is what is thrown. Never steady at the top, so the best value is a matter of timing. */
export function shaky(power: number, t: number) {
  const wob = Math.max(0, power - 0.5) * 0.5 * (Math.sin(t / 37) * 0.6 + Math.sin(t / 23 + 1.3) * 0.4);
  return Math.max(0, Math.min(1, power + wob));
}
/** The aim's sway as it is held (radians): small, slow, and also what is thrown. */
export const sway = (t: number, k: number) => k * (Math.sin(t / 410) * 0.7 + Math.sin(t / 157 + 0.6) * 0.3);
