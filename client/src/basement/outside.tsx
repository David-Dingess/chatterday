// Outside: the campsite out past the door in the room's east wall (scripts/basement/outside.py draws it; the fire is kept
// by server/basement/outside.ts, with the numbers in ./campfire.ts).
//
// The fire is drawn here, from what the server says: the logs in the ring (one to five, or cold ash), the flames at a
// size that follows the fuel (small while it catches and when it is nearly gone), embers and smoke once it has gone
// out. Click it to put a log on (or click the woodpile), to light it, or, sat round it, to roast a marshmallow; while it
// is over the fire, "Pull it out!" takes it off (white, then golden, then brown, then alight: golden is the one to aim
// for). Everybody sees everybody's stick.
//
// Out here it gets dark when it does outdoors (the hour on the house's clock, as the yard round the house): the night is laid
// over the scene with holes in it where the fire, the lantern and the porch light are, and the fire's glow over that.
import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { CLUB } from '../clubhouse.gen';
import { marksOf, rowIndex } from '../sprites';
import { hooks, send, toast, useStore } from '../store';
import { houseHM } from '../clock';
import { clickRadio, radioSays } from '../components/Music';
import { doneWord, EMBER_MS, fuelLeft, LOG_S, MAX_LOGS, toasted } from './campfire';
import type { Camp } from './campfire';
import { LAYOUT } from './outside.gen';
import type { FitLayout, FitProps } from './index';
import { goFloor } from './index';
import './outside.css';
import { CornholeRoom } from './cornhole.tsx';
import { SkyView, useSky } from './sky.tsx';
import { SeasonAir } from '../season';
import { OutdoorDecor } from '../holidays/outdoor';

const ID = 'outside';
// what the server says only to me ("Put some wood on first")
hooks.fit.push((d) => { if (d.id === ID && d.op === 'note') toast(String(d.text ?? '')); });
/** How far my clock is ahead of the server's: measured each time it sends the fire. */
let skew = 0;
hooks.fit.push((d) => { if (d.id === ID && d.state?.now) skew = Date.now() - d.state.now; });

const PREVIEW = new URLSearchParams(location.search);
/** The daylight, 0 (night) to 1, as the yard has it (CLUB.light, by the hour on the house's clock; `?hour=21` previews one). */
export function daylight(d: Date) {
  const forced = PREVIEW.get('hour');
  let h: number, m = 0;
  if (forced) h = ((Number(forced) % 24) + 24) % 24;
  else [h, m] = houseHM(d);
  return CLUB.light[h] + (CLUB.light[(h + 1) % 24] - CLUB.light[h]) * (m / 60);
}

/** The colour of a marshmallow toasted this far. */
const MALLOW: [number, string][] = [[0, '#fbf8f0'], [3, '#f6e8c8'], [5, '#ecc070'], [6.2, '#dc9c44'], [7.2, '#b86a28'], [9, '#6a3a1a'], [11.5, '#2a1812']];
function mallow(d: number) {
  for (let k = 1; k < MALLOW.length; k++) {
    const [d1, c1] = MALLOW[k], [d0, c0] = MALLOW[k - 1];
    if (d <= d1) { const t = (d - d0) / (d1 - d0); return `color-mix(in srgb, ${c1} ${Math.round(t * 100)}%, ${c0})`; }
  }
  return MALLOW[MALLOW.length - 1][1];
}

/** How somebody sat in a seat faces the fire: the campfire rows of their sheet (drawn by make-avatars.py and
 *  draw/avatar.ts), and whether they are flipped so the stick is in the hand on the fire's side. */
function view(q: FitLayout['seats'][number], fx: number) {
  if (q.pose === 'side') return { row: 'roast_side' as const, flip: q.flip };
  return { row: q.pose === 'back' ? 'roast_back' as const : 'roast' as const, flip: q.x > fx };
}
/** Whether the sprite sheets have the campfire rows yet (draw/avatar.ts and make-avatars.py: 'roast', 'roast_side',
 *  'roast_back'). Until they do, nobody's pose is changed. */
const HAS_ROWS = (['roast', 'roast_side', 'roast_back'] as string[]).every((r) => rowIndex(r as Parameters<typeof rowIndex>[0]) >= 0);
/** How long a marshmallow is at the mouth once it is pulled out: the eating frames. */
const EAT_MS = 2400;

/** At the campfire the fire has its say in how its sitters are drawn (FitGame.pose): holding a stick out to the fire
 *  while it toasts, and then the marshmallow at the mouth for a moment. */
export function pose(uid: string, key: string) {
  const st = useStore.getState().fits[ID] as Camp | undefined, m = /^b(\d+)$/.exec(key);
  if (!st || !m) return null;
  const n = Number(m[1]), q = LAYOUT.seats[n] as FitLayout['seats'][number] | undefined, [fx] = LAYOUT.things.fire as number[];
  if (!q) return null;
  const v = view(q, fx);
  if (!HAS_ROWS) return null;                                         // (sheets drawn before the campfire rows: sat as usual)
  if (st.roast[uid]?.seat === n) return { row: v.row, first: 0, frames: 2, ms: 700, flip: v.flip };
  const ate = st.ate[uid];
  if (ate && ate.seat === n && ate.what !== 'dropped one in the fire' && Date.now() - skew - ate.at < EAT_MS) return { row: v.row, first: 2, frames: 2, ms: 300, flip: v.flip };
  return null;
}

/** Where somebody sat in a seat has the fist that holds their stick, in the room's dots, from where their frames put
 *  it (the arm a drink is held in: marksOf says where that is for each body), and where the stick's end is: at the
 *  edge of the flames on their side. eat: the fist at the mouth instead (none from behind: the head hides it). */
function fist(user: Parameters<typeof marksOf>[0] | undefined, q: FitLayout['seats'][number], fx: number, eat: boolean) {
  const d = (user ? marksOf(user) : null)?.drink ?? { hold: [27, 25], sip: [26, 21], sit: 6 };
  const ax = d.hold[0] + 4, top = d.hold[1] - 6 + d.sit;              // (the drink's fist is 4 in from the arm, 6 down from the shoulder)
  const v = view(q, fx);
  let p: [number, number] | null;
  if (v.row === 'roast') p = eat ? [ax - 2, top + 2] : [ax + 5, top + 10];
  else if (v.row === 'roast_side') p = eat ? [17, top - 3] : [10, top + 7];
  else p = eat ? null : [ax, top + 3];
  if (!p) return null;
  const x = v.flip ? 47 - p[0] : p[0];
  return { x: q.x - 24 + x, y: q.y - 45 + p[1] };
}
type Pt2 = { x: number; y: number };
/** A toasting stick, from the fist to its sharpened point: a twig, bending a little under its own weight, tapering from
 *  the hand to the point, its bark lit on the side to the light (up and left) and dark on the other, a knot or two and
 *  the bark ringed here and there, the last of it whittled pale to a point. */
function Twig({ from, to }: { from: Pt2; to: Pt2 }) {
  const dx = to.x - from.x, dy = to.y - from.y, len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;                                       // across the stick
  const sag = Math.min(2.5, len / 14);                                       // (bowing down a little, more the longer it is)
  const at = (t: number): Pt2 => ({ x: from.x + dx * t, y: from.y + dy * t + sag * 4 * t * (1 - t) });
  const width = (t: number) => 1.7 - 1.1 * t;
  const N = 14, left: Pt2[] = [], right: Pt2[] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N, p = at(t), w = width(t) / 2;
    left.push({ x: p.x + nx * w, y: p.y + ny * w }); right.push({ x: p.x - nx * w, y: p.y - ny * w });
  }
  const pts = (q: Pt2[]) => q.map((v) => `${v.x.toFixed(2)},${v.y.toFixed(2)}`).join(' ');
  // which edge is the lit one: the one nearer up-and-left
  const litLeft = nx * -0.6 + ny * -0.8 > 0;
  const lit = litLeft ? left : right, dark = litLeft ? right : left;
  const whittle = Math.max(0.78, 1 - 4 / len);
  return (
    <g>
      <polygon points={pts([...left, ...[...right].reverse()])} fill="#6a4a30" />
      <polyline points={pts(dark.slice(0, Math.round(N * whittle)))} fill="none" stroke="#2a1a10" strokeWidth={0.45} />
      <polyline points={pts(lit.slice(1, Math.round(N * whittle)))} fill="none" stroke="#c09868" strokeWidth={0.45} />
      {[0.26, 0.55].map((t) => { const p = at(t), w = width(t) / 2; return <circle key={t} cx={p.x + (litLeft ? -nx : nx) * w} cy={p.y + (litLeft ? -ny : ny) * w} r={0.45} fill="#3a2418" />; })}
      {[0.34, 0.6].map((t) => { const p = at(t), w = width(t) / 2 + 0.2; return <line key={t} x1={p.x + nx * w} y1={p.y + ny * w} x2={p.x - nx * w} y2={p.y - ny * w} stroke="#6a4a30" strokeWidth={0.5} />; })}
      <line x1={at(whittle).x} y1={at(whittle).y} x2={to.x} y2={to.y + 0} stroke="#e8d0a0" strokeWidth={0.6} strokeLinecap="round" />
    </g>
  );
}

/** A marshmallow on the stick at (x, y): a little cylinder, its top face lit, its side in shade, a highlight. It browns
 *  from the side facing the fire first (toward): a golden edge, then caramel, then blistered and black; alight, a little
 *  flame on it and a wisp of smoke. A warm glow on it from the fire (glow: how strong). */
function Mallow({ x, y, d, toward, glow, uid }: { x: number; y: number; d: number; toward: Pt2; glow: number; uid: string }) {
  const gx = toward.x - x, gy = toward.y - y, gl = Math.hypot(gx, gy) || 1;
  const near = mallow(Math.min(14, d * 1.4)), far = mallow(d * 0.7), top = mallow(d * 0.55);
  const id = `mg${uid.replace(/\W/g, '')}`;
  const w = 3.8, h = 3.4, x0 = x - w / 2, y0 = y - h / 2;
  return (
    <g>
      <defs>
        <linearGradient id={id} x1={0.5 - (gx / gl) * 0.5} y1={0.5 - (gy / gl) * 0.5} x2={0.5 + (gx / gl) * 0.5} y2={0.5 + (gy / gl) * 0.5}>
          <stop offset="0%" stopColor={far} /><stop offset="55%" stopColor={far} /><stop offset="100%" stopColor={near} />
        </linearGradient>
      </defs>
      {glow > 0 && <circle cx={x} cy={y} r={4.5} fill="#ff9a3a" opacity={0.28 * glow} />}
      <rect x={x0} y={y0 + 0.9} width={w} height={h - 0.9} rx={0.6} fill={`url(#${id})`} stroke="#3a2418" strokeWidth={0.35} />
      <rect x={x0 + w - 1.1} y={y0 + 1.2} width={0.9} height={h - 1.6} fill="#000" opacity={0.18} />
      <ellipse cx={x} cy={y0 + 0.9} rx={w / 2} ry={0.9} fill={top} stroke="#3a2418" strokeWidth={0.3} />
      {d < 9 && <rect x={x0 + 0.6} y={y0 + 1.6} width={0.6} height={1.2} fill="#ffffff" opacity={0.8} />}
      {d >= 6.2 && d < 9 && <circle cx={x + (gx / gl) * 1.3} cy={y + 0.6 + (gy / gl) * 0.8} r={0.45} fill="#7a3a14" />}
      {d >= 9 && [[-0.9, 0.4], [0.7, 1.1], [0.2, -0.3]].map(([bx, by], k) => <circle key={k} cx={x + bx} cy={y + by} r={0.5} fill="#120a08" />)}
      {d > 9 && <path className="cf-alight" d={`M${x - 1.3},${y0 + 0.6} Q${x - 0.4},${y0 - 3.4} ${x},${y0 - 4.6} Q${x + 0.6},${y0 - 2.4} ${x + 1.3},${y0 + 0.6} Z`} fill="#ffb22e" stroke="#f2701e" strokeWidth={0.4} />}
      {d > 10.5 && <circle className="cf-wisp" cx={x} cy={y0 - 5} r={1.2} fill="#8c8a86" />}
    </g>
  );
}

function stickTip(hand: { x: number; y: number }, fx: number, fy: number) {
  const fire = { x: fx, y: fy - 8 }, dx = hand.x - fire.x, dy = hand.y - fire.y, len = Math.hypot(dx, dy) || 1;
  return { x: fire.x + (dx / len) * 11, y: fire.y - 2 + (dy / len) * 7 };
}

const DUSK_OVER = 3;
const box = (r: number[]): CSSProperties => ({ left: r[0], top: r[1], width: r[2], height: r[3] });

export function Room({ layout, mini, seated }: FitProps) {
  const st = useStore((s) => s.fits[ID]) as Camp | undefined;
  const me = useStore((s) => s.me);
  const mine = useStore((s) => (s.me ? s.presence[s.me.id] : undefined));
  const users = useStore((s) => s.users);
  const playing = useStore((s) => !!s.music.current && s.music.current.pausedAt == null);      // (the radio is the Player: notes float off it while that plays)
  const skyOpen = useSky((s) => s.open);
  const [, tick] = useState(0);
  const [light, setLight] = useState(() => daylight(new Date()));
  useEffect(() => {
    const t = window.setInterval(() => tick((n) => n + 1), 100);
    const l = window.setInterval(() => setLight(daylight(new Date())), 30_000);
    return () => { window.clearInterval(t); window.clearInterval(l); };
  }, []);
  useEffect(() => { if (st?.now && !skew) skew = Date.now() - st.now; }, [st]);
  // The panel round the scene (the woods beyond its edges, things.bg) gets as dark as the scene does at night, so no
  // brighter band shows above and below it (or beside it) when the panel is not the scene's shape.
  const duskNow = Math.min(0.8, (1 - light) * 0.66);
  useEffect(() => {
    const c = [13, 26, 18].map((v, i) => Math.round(v + ([6, 10, 34][i] - v) * duskNow));
    document.documentElement.style.setProperty('--outside-bg', `rgb(${c.join(',')})`);
    return () => { document.documentElement.style.removeProperty('--outside-bg'); };
  }, [duskNow]);
  if (!st) return null;

  const T = layout.things, [fx, fy] = T.fire as number[], ring = T.ring as number[];
  const [FW, FH] = T.sheets.fire as number[], [LW, LH] = T.sheets.logs as number[];
  const now = Date.now() - skew, f = st.fire, fuel = fuelLeft(f, now);
  const burning = f.lit && fuel > 0;
  const since = now - f.outAt;
  const embers = !burning && f.outAt > 0 && since < EMBER_MS;
  const smoke = !burning && f.outAt > 0 && since < EMBER_MS + 90_000;
  const logs = fuel > 0 ? Math.min(MAX_LOGS, Math.max(1, Math.ceil(fuel / LOG_S - 0.15))) : 0;
  // the flames: small while it catches, then by how much wood is left
  const catching = burning && now - f.litAt < 4000;
  const row = !burning ? -1 : catching ? (now - f.litAt < 1800 ? 2 : 1) : fuel > 2.4 * LOG_S ? 0 : fuel > 0.7 * LOG_S ? 1 : 2;
  const k = row === 0 ? 1 : row === 1 ? 0.78 : row === 2 ? 0.5 : embers ? 0.22 * (1 - since / EMBER_MS) + 0.08 : 0;
  const dusk = Math.min(0.8, (1 - light) * 0.66);
  const night = 1 - light;

  // my seat, if I am sat round the fire
  const n = mine && mine.place === 'here' && mine.floor === ID ? Number(/^b(\d+)$/.exec(mine.at?.seat ?? '')?.[1] ?? -1) : -1;
  const atFire = n >= 0 && ring.includes(n) && !!seated[n];
  const roasting = me ? st.roast[me.id] : undefined;
  const canRoast = atFire && burning && !roasting && !Object.values(st.roast).some((r) => r.seat === n);
  // What a click on the fire (or the woodpile) does, the one thing at a time: a marshmallow being held is pulled out
  // first; laid wood not yet lit is lit; a fire that needs wood (out, or under a log's worth left) gets a log, even if
  // I am sat by it (wood first, then the marshmallow); sat by a fire that is going, a marshmallow; otherwise a log.
  const needsWood = !burning || fuel < LOG_S;
  const [op, say]: [string, string] = roasting ? ['pull', 'Pull your marshmallow out']
    : !burning && fuel > 0 ? ['light', 'Light the fire']
      : needsWood && logs < MAX_LOGS ? ['wood', embers ? 'Put a log on the embers' : burning ? 'The fire is low: put a log on' : 'The fire is out: put a log on']
        : canRoast ? ['roast', 'Roast a marshmallow']
          : logs < MAX_LOGS ? ['wood', burning && n < 0 ? 'Put a log on (sit by the fire to roast a marshmallow)' : 'Put a log on'] : ['', 'The fire is as full as it will go'];

  // the night, with light let through round the fire, the lantern and the porch light
  // (the night's layer reaches DUSK_OVER dots past every edge, so no row at the top or bottom is left out of it when the
  //  room is zoomed to a fraction: its holes are placed that much further in)
  const hole = (x: number, y: number, rx: number, ry: number, inner = 0) => `radial-gradient(${rx}px ${ry}px at ${x + DUSK_OVER}px ${y + DUSK_OVER}px, rgba(0,0,0,${inner}) 0%, rgba(0,0,0,${0.35 + inner * 0.5}) 45%, #000 100%)`;
  // (the camp's lamps, torches and bulbs: each lets a little of the night through round it; the fire, the most)
  const holes = [k > 0 ? hole(fx, fy - 4, 40 + 70 * k, 26 + 44 * k) : '', ...layout.lights.map((l) => hole(l.x, l.y, l.rx * 1.1, l.ry * 1.1, 0.3))].filter(Boolean).join(', ');
  const toss = st.toss && now - st.toss.at < 1500 ? st.toss : null;
  const name = (id: string) => users[id]?.name ?? 'Somebody';
  const golden = Object.entries(st.tally).filter(([id, c]) => c > 0 && users[id]).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([id, c]) => `${name(id)} ${c}`).join(', ');
  const pick = (what: string) => { if (what) send({ t: 'fit', id: ID, op: what, ...(what === 'roast' ? { seat: n } : {}) }); };
  const [TW, TH] = (T.sheets.toss as number[] | undefined) ?? [16, 9];

  return (
    <>
      {/* the wood in the ring, and the fire on it */}
      <i className="cf-logs" style={{ left: fx - LW / 2, top: fy - 13, width: LW, height: LH, zIndex: fy - 1, backgroundPosition: `${-logs * LW}px 0`, backgroundSize: `${LW * 6}px ${LH}px` }} />
      {row >= 0 && <i className="cf-fire" style={{ left: fx - FW / 2, top: fy + 3 - FH, width: FW, height: FH, zIndex: fy + 3, backgroundPositionY: `${-row * FH}px`, backgroundSize: `${FW * 4}px ${FH * 4}px`, '--to': `${-FW * 4}px` } as CSSProperties} />}
      {embers && <i className="cf-fire embers" style={{ left: fx - FW / 2, top: fy + 3 - FH, width: FW, height: FH, zIndex: fy + 3, backgroundPositionY: `${-3 * FH}px`, backgroundSize: `${FW * 4}px ${FH * 4}px`, opacity: 0.45 + 0.55 * (1 - since / EMBER_MS), '--to': `${-FW * 4}px` } as CSSProperties} />}
      {(smoke || (burning && row === 2)) && [0, 1, 2, 3].map((j) => <i key={j} className="cf-smoke" style={{ left: fx - 3 + (j % 2) * 3, top: fy - 12, zIndex: 2981, animationDelay: `${-j * 0.8}s`, opacity: (burning ? 0.3 : 0.6) * (1 - dusk * 0.5) } as CSSProperties} />)}
      {/* a log from the woodpile, thrown on */}
      {toss && <i key={toss.at} className="cf-toss" style={{ left: T.woodFrom[0] - TW / 2, top: T.woodFrom[1] - TH / 2, width: TW, height: TH, zIndex: 2990, '--dx': `${fx - T.woodFrom[0]}px`, '--dy': `${fy - 6 - T.woodFrom[1]}px` } as CSSProperties} />}
      {/* and where it lands, a burst of sparks */}
      {toss && [[-17, -22], [-8, -31], [2, -36], [11, -29], [19, -19], [-22, -9], [23, -8], [-4, -24], [7, -40]].map(([sx, sy], j) => (
        <i key={`${toss.at}s${j}`} className="cf-spark" style={{ left: fx, top: fy - 6, zIndex: 2991, '--sx': `${sx}px`, '--sy': `${sy}px`, animationDelay: `${0.55 + (j % 3) * 0.04}s` } as CSSProperties} />
      ))}
      {/* the sticks over the fire, everybody's */}
      {Object.entries(st.roast).map(([id, r]) => {
        const q = layout.seats[r.seat];
        if (!q) return null;
        const hand = fist(users[id], q, fx, false);
        if (!hand) return null;
        const tip = stickTip(hand, fx, fy), d = toasted(r, now);
        // (from behind, the stick is in front of them: it goes behind them, coming out over their shoulder)
        return (
          <svg key={id} className="cf-stick" viewBox={`0 0 ${layout.w} ${layout.h}`} style={{ width: layout.w, height: layout.h, zIndex: q.pose === 'back' ? q.y - 1 : Math.max(q.y + 2, fy + 4) }} aria-label={`${name(id)}'s marshmallow`}>
            <Twig from={hand} to={tip} />
            {(() => { const len = Math.hypot(tip.x - hand.x, tip.y - hand.y) || 1, back = 3.2 / len, mx = tip.x - (tip.x - hand.x) * back, my = tip.y - (tip.y - hand.y) * back;
              return <Mallow x={mx} y={my - 0.4} d={d} toward={{ x: fx, y: fy - 4 }} glow={k} uid={id} />; })()}
          </svg>
        );
      })}
      {/* and once it is pulled out, at the mouth for a moment, on the end of the stick */}
      {Object.entries(st.ate).filter(([, a]) => now - a.at < EAT_MS && a.what !== 'dropped one in the fire').map(([id, a]) => {
        const q = layout.seats[a.seat], at = q && fist(users[id], q, fx, true);
        if (!q || !at) return null;
        const out = view(q, fx).flip ? 1 : -1;
        return (
          <svg key={`eat${id}`} className="cf-stick" viewBox={`0 0 ${layout.w} ${layout.h}`} style={{ width: layout.w, height: layout.h, zIndex: q.y + 2 }}>
            <Twig from={{ x: at.x - out * 10, y: at.y + 10 }} to={{ x: at.x + out * 1.5, y: at.y - 1 }} />
            <Mallow x={at.x + out * 0.5} y={at.y - 1} d={a.d} toward={{ x: fx, y: fy }} glow={0} uid={`eat${id}`} />
          </svg>
        );
      })}
      {/* what each came out as, over whoever ate it */}
      {Object.entries(st.ate).filter(([, a]) => now - a.at < 4000).map(([id, a]) => {
        const q = layout.seats[a.seat];
        return q ? <b key={id} className="cf-say" style={{ left: q.x, top: q.y - 52, zIndex: 3500 }}>{a.what === 'dropped one in the fire' ? 'Dropped it!' : doneWord(a.d)}</b> : null;
      })}
      {st.last && now - st.lastAt < 7000 && <b className="cf-last" style={{ zIndex: 3500 }}>{st.last}</b>}
      {/* night falls out here, but not round the fire */}
      <i className="cf-dusk" style={{ inset: -DUSK_OVER, opacity: dusk, zIndex: 2980, maskImage: holes, WebkitMaskImage: holes } as CSSProperties} />
      {/* the season in the air (client/src/season.tsx): leaves, pollen, fireflies, flurries; what lies on the ground goes under everybody */}
      <SeasonAir scene="campsite" w={layout.w} h={layout.h} light={light} dusk={dusk} airZ={2981} groundZ={1} />
      {/* the holiday's decorations (client/src/holidays/outdoor.tsx), and a snowman while it snows */}
      <OutdoorDecor scene="campsite" seasons={(layout as { seasons?: string[] }).seasons} light={light} w={layout.w} h={layout.h} />
      {k > 0 && <i className={`cf-glow${burning ? '' : ' low'}`} style={{ left: fx - (50 + 80 * k), top: fy - 8 - (30 + 50 * k), width: 2 * (50 + 80 * k), height: 2 * (30 + 50 * k), zIndex: 2983, opacity: (0.28 + 0.6 * night) * Math.min(1, k * 1.3) }} />}
      {night > 0.3 && layout.lights.map((l, j) => <i key={j} className={`cf-glow lamp${l.color === '#ffa850' ? ' torch' : ''}`} style={{ left: l.x - l.rx * 1.2, top: l.y - l.ry * 1.2, width: l.rx * 2.4, height: l.ry * 2.4, zIndex: 2982, opacity: night * 0.6, animationDelay: `${-j * 0.37}s` }} />)}
      {/* the tiki torches' flames: the fire's smallest, at half size, each flickering in its own time */}
      {(T.torches as number[][]).map(([x, y], j) => <i key={`t${j}`} className="cf-torch" style={{ left: x - FW / 4, top: y + 1 - FH / 2, width: FW / 2, height: FH / 2, zIndex: 2984, backgroundPositionY: `${-FH}px`, backgroundSize: `${FW * 2}px ${FH * 2}px`, animationDelay: `${-j * 0.13}s`, '--to': `${-FW * 2}px` } as CSSProperties} />)}
      {/* clicks: the fire, and the woodpile */}
      {!mini && <i className={`cf-hot${op ? '' : ' idle'}`} title={`${say}${golden ? `. Golden marshmallows: ${golden}` : ''}`} style={{ ...box(T.firebox), height: T.firebox[3] - 8, zIndex: 2990 }}
        onClick={(e) => { e.stopPropagation(); pick(op); }} />}
      {/* the woodpile: a log on the fire, unless a marshmallow wants pulling out or there is wood to light */}
      {/* the radio by the west stump is the Player (Music.tsx clickRadio); notes float up off it while that plays */}
      {playing && [0, 1, 2].map((j) => <b key={`n${j}`} className="cf-note" style={{ left: T.radio[0] + 10 + j * 3, top: T.radio[1] + 2, zIndex: 2985, animationDelay: `${-j * 0.9}s` } as CSSProperties}>{j % 2 ? '♫' : '♪'}</b>)}
      {!mini && <i className="cf-hot" title={radioSays()} style={{ ...box(T.radio), zIndex: 2990 }}
        onClick={(e) => { e.stopPropagation(); clickRadio(T.radio[0] + T.radio[2] + 2, T.radio[1] - 20); }} />}
      {/* the telescope: walk over to it and look through */}
      {!mini && <i className="cf-hot" title="The telescope: look at the sky" style={{ left: T.telescopeAt[0], top: T.telescopeAt[1], width: T.telescopeAt[2], height: T.telescopeAt[3], zIndex: 2990 }}
        onClick={(e) => {
          e.stopPropagation();
          const k = T.telescope as number, q = layout.seats[k];
          if (q && !(mine?.place === 'here' && mine.at?.seat === `b${k}`)) send({ t: 'place', place: 'here', x: q.x, y: q.y, seat: `b${k}` });
          useSky.setState({ open: true });
        }} />}
      {/* the path behind the telescope, into the trees: down to the lake (client/src/basement/lake.tsx) */}
      {!mini && <i className="cf-hot" title="The path to the lake" style={{ left: 282, top: 36, width: 40, height: 60, zIndex: 2990 }}
        onClick={(e) => { e.stopPropagation(); goFloor.setState({ to: 'lake' }); }} />}
      {skyOpen && !mini && <SkyView light={light} />}
      <CornholeRoom layout={layout} mini={mini} light={light} />
      {!mini && <i className="cf-hot" title={op === 'pull' || op === 'light' ? say : logs >= MAX_LOGS ? 'The woodpile (the fire is full)' : 'The woodpile: throw a log on the fire'} style={{ ...box(T.woodpile), zIndex: 2990 }}
        onClick={(e) => { e.stopPropagation(); pick(op === 'pull' || op === 'light' ? op : logs < MAX_LOGS ? 'wood' : ''); }} />}
    </>
  );
}

/** What pointing at a seat says. */
const RING = new Set<number>(LAYOUT.things.ring);
const SPOTS = new Set<number>((LAYOUT.things.cornhole as { spots: number[] }).spots);
export const says = (seat: number) => (RING.has(seat) ? 'Sit by the fire' : seat === LAYOUT.things.telescope ? 'Look through the telescope'
  : SPOTS.has(seat) ? "A pitcher's box (click a board to play cornhole)" : 'Sit on a sleeping bag');
