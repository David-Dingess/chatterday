// What the season puts in the air out of doors, over every outdoor scene (the yard round the house, the backyard, the
// campsite): leaves blowing across in the fall (more when the town's wind is up, some settling on the ground for a while),
// petals off the flowering trees and some days a pollen haze in the spring, fireflies on summer nights where the scene
// has none of its own, and light flurries when it is really snowing where the scene has no snow of its own. Nothing in
// rain or storm (the rain is enough), nothing indoors.
//
// Pixel-styled: whole dots, a few colours, no soft glow. Cheap: two canvases a scene (the air, over everything; the ground,
// under the people: leaves and petals lying there, the haze's wash), drawn from a frame loop, never through React state.
// Every dot is worked out from the clock alone (which leaf it is, where it started, how far it has gone), so everybody
// sees the same leaves at the same moment. Under prefers-reduced-motion there are far fewer, and they go slower.
//
// Previews, as the room's own: `?date=10-20` (or `?season=fall`), `?weather=snow`, `?hour=21`; and `?wind=25` (mph) and
// `?pollen=1` (or 0) for these.
import { memo, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useStore } from './store';
import type { Weather } from './types';
import { clubDay } from './holidays/dates';

const PREVIEW = new URLSearchParams(location.search);
const SEASON_DAY: Record<string, string> = { spring: '04-10', summer: '07-10', fall: '10-20', winter: '01-15' };

/** Today on the house's clock as [year, 'MM-DD'], or the day the address previews (`?date=MM-DD` or `?date=YYYY-MM-DD`, as
 *  the holidays read it: client/src/holidays/dates.ts clubDay; or `?season=`). */
function today(): [string, string] {
  const season = PREVIEW.get('season');
  const [y, m, d] = clubDay().split('-');
  if (!PREVIEW.get('date') && season && SEASON_DAY[season]) return [y, SEASON_DAY[season]];
  return [y, `${m}-${d}`];
}

export type Season = 'spring' | 'summer' | 'fall' | 'winter';
/** The season out of doors, from the month on the house's clock, the same for the yard round the house and every outdoor scene:
 *  March to May spring, June to August summer, September to November fall, December to February winter. `?date=` and
 *  `?season=` preview one. */
export function outdoorSeason(): Season {
  const asked = PREVIEW.get('season');
  if (asked === 'spring' || asked === 'summer' || asked === 'fall' || asked === 'winter') return asked;
  const m = Number(today()[1].slice(0, 2));
  return m >= 3 && m <= 5 ? 'spring' : m >= 6 && m <= 8 ? 'summer' : m >= 9 && m <= 11 ? 'fall' : 'winter';
}
/** The season, looked at again every minute (a render only when it changes). */
export function useOutdoorSeason(): Season {
  const [s, set] = useState(outdoorSeason);
  useEffect(() => { const t = window.setInterval(() => set(outdoorSeason()), 60_000); return () => window.clearInterval(t); }, []);
  return s;
}
/** Which set of pictures an outdoor scene shows (scripts/make-basement.py draws one a season for a fit-out whose layout
 *  lists `seasons`): '' (summer: base.png), '-spring', '-fall', '-winter', or '-snow' while it is really snowing (or
 *  `?weather=snow`). A scene without seasons always ''. */
export function useSceneArt(seasons: string[] | undefined): string {
  const season = useOutdoorSeason();
  const wx = useOutdoorWeather();
  if (!seasons?.length) return '';
  const want = wx?.kind === 'snow' ? 'snow' : season;
  return seasons.includes(want) ? `-${want}` : '';
}

type Piece = { x: number; y: number; w: number; h: number; z: number; sx: number; sy: number };
/** A fit-out's own picture and the pieces of it drawn in front of people, in the season's set (Clubhouse.tsx puts this
 *  where it used to put base.png and over.png). `piece` places one piece (Clubhouse.tsx's own). */
export const SceneArt = memo(function SceneArt({ fit, piece }: { fit: { id: string; over: Piece[]; atlas: number[]; seasons?: string[] }; piece: (o: Piece) => CSSProperties }) {
  const sfx = useSceneArt(fit.seasons);
  return (
    <>
      <img className="club-base" src={`/basement/${fit.id}/base${sfx}.png`} alt="" draggable={false} />
      {fit.over.map((o, k) => <i key={k} className="club-over" style={{ ...piece(o), backgroundImage: `url(/basement/${fit.id}/over${sfx}.png)`, backgroundSize: `${fit.atlas[0]}px ${fit.atlas[1]}px` }} />)}
    </>
  );
});

/** The weather as the room shows it: the real reading, or `?weather=` (and `?wind=`) to preview. */
export function useOutdoorWeather(): Weather | null {
  const real = useStore((s) => s.weather);
  const forced = PREVIEW.get('weather'), wind = PREVIEW.get('wind');
  let wx = real;
  if (forced) {
    const kind = (['clear', 'clouds', 'rain', 'storm', 'snow', 'fog'] as const).find((k) => k === forced) ?? 'clear';
    wx = { kind, cover: kind === 'clear' ? 0.1 : kind === 'fog' ? 0.7 : 1, text: kind, temp: real?.temp ?? null, unit: real?.unit ?? 'F', windMph: real?.windMph, windFrom: real?.windFrom, at: 0 };
  }
  if (wind !== null && wind !== '' && wx) wx = { ...wx, windMph: Number(wind) || 0 };
  return wx;
}

// ── the clock-driven randomness: the same numbers on every screen ──
const hash = (a: number, b: number, c: number) => {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 2246822519)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const frac = (v: number) => v - Math.floor(v);

/** What is in the air today, from the date, the weather and the daylight. */
type Now = { leaves: number; petals: boolean; pollen: number; flies: boolean; flurries: boolean; wind: number; dir: number; drift: number };
function conditions(wx: Weather | null, light: number, own: Own): Now {
  const [year, md] = today();
  const m = Number(md.slice(0, 2)), d = Number(md.slice(3, 5));
  const wet = wx?.kind === 'rain' || wx?.kind === 'storm', snow = wx?.kind === 'snow', fog = wx?.kind === 'fog';
  const fair = !!wx && !wet && !snow && !fog;
  const mph = Math.max(0, Math.min(40, wx?.windMph ?? 6));
  // Which way it blows (to the east, unless the station says otherwise: a westerly is the commonest), and how
  // far it carries things up or down the picture (north is up).
  const from = wx?.windFrom, to = ((from ?? 270) + 180) * Math.PI / 180;
  const ex = Math.sin(to), ny = -Math.cos(to);
  const dir = Math.abs(ex) < 0.2 ? (ex < 0 ? -1 : 1) : Math.sign(ex);
  // The fall, mid-September to the end of November: more leaves the windier it is.
  const fall = (m === 9 && d >= 15) || m === 10 || m === 11;
  const leaves = !fall || wet || snow ? 0 : mph >= 18 ? 2.4 : mph >= 9 ? 1.5 : 1;
  // A pollen day: late March and April, most days, not in rain or fog (and `?pollen=` to preview one).
  const asked = PREVIEW.get('pollen');
  const season = (m === 3 && d >= 18) || m === 4;
  const roll = hash(Number(year), m * 40 + d, 77);
  const pollen = asked !== null && asked !== '' ? Number(asked) : !season || wet || fog || snow || roll > 0.6 ? 0 : 0.55 + 0.45 * hash(Number(year), m * 40 + d, 78);
  return {
    leaves, pollen, wind: mph, dir, drift: ny * 0.35,
    petals: m >= 3 && m <= 5 && !wet && !snow && own.petals.length > 0,
    // (as the yard's own: spring and summer nights in fair weather)
    flies: !own.flies && fair && light < 0.3 && m >= 3 && m <= 8,
    flurries: !own.snow && snow,
  };
}

/** What a scene already has of its own, and where its flowering trees are (canopy centre and size, in the scene's dots). */
type Own = { flies?: boolean; snow?: boolean; petals: number[][] };
const OWN: Record<string, Own> = {
  // the yard has its own fireflies (Clubhouse.tsx Yard) and its own falling snow; its dogwoods and the little Japanese
  // maple flower in the spring (make-clubhouse.py: stand('dogwood', -76, 268), ('dogwood', 692, 250), ('jmaple', 150, 392))
  yard: { flies: true, snow: true, petals: [[-76, 226, 22, 15, 0], [692, 208, 22, 15, 0], [150, 360, 20, 8, 1]] },
  // the backyard has nothing in flower but the beds; the campsite's two dogwoods in the near row of the woods are drawn
  // in flower (scripts/basement/outside.py: their feet at (99, 78) and (358, 80))
  backyard: { petals: [] },
  campsite: { petals: [[99, 39, 20, 13, 0], [358, 41, 20, 13, 0]] },
  // the lake has nothing in flower (scripts/basement/lake.py)
  lake: { petals: [] },
};

// ── colours ──
const LEAF = ['#c8461c', '#e26a24', '#f29a3a', '#eac83a', '#9c5a1e', '#a02c18', '#7a4218'];
const PETAL = [['#fdfbf4', '#f4bcd0', '#ffffff'], ['#ea8cac', '#f9bcd0', '#d2628a']];
const POLLEN = ['#f2e27a', '#e8d65a', '#fff3a8'];
const NIGHT = [6, 10, 34];
const rgbOf = (hex: string) => [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16));
/** A colour darkened toward the night's blue, as the scene round it is (`dusk`: how far). */
function dim(hex: string, dusk: number) {
  const c = rgbOf(hex);
  return `rgb(${c.map((v, i) => Math.round(v + (NIGHT[i] - v) * dusk)).join(',')})`;
}

const S = 2;               // canvas pixels a dot
// Ten a second is as smooth as this can look: everything is drawn snapped to whole dots, and the quickest thing in the
// air (pollen in a 40 mph wind) crosses about nine dots a second, most of it two to six. At 20 most frames were the
// same picture as the one before, two full-size canvases cleared and drawn again for nothing: the biggest cost left in
// an idle room outdoors (or in the basement's small copy of one), there all the time somebody is in it.
const FPS = 10;

type Props = {
  scene: 'yard' | 'backyard' | 'campsite' | 'lake';
  /** the canvases' size, in dots; and where the scene's own (0, 0) is on them */
  w: number; h: number; ox?: number; oy?: number;
  /** the part of the scene's own dots particles are spread over: [x, y, w, h] */
  area?: number[];
  light: number; dusk: number;
  /** z-index of the air (over the people) and of the ground (under them); unset: in document order */
  airZ?: number; groundZ?: number;
};

/** The season's particles for one outdoor scene. */
export function SeasonAir({ scene, w, h, ox = 0, oy = 0, area, light, dusk, airZ, groundZ }: Props) {
  const wx = useOutdoorWeather();
  const air = useRef<HTMLCanvasElement>(null), ground = useRef<HTMLCanvasElement>(null);
  const live = useRef({ wx, light, dusk, w, h, ox, oy, area: area ?? [0, 0, w, h] });
  live.current = { wx, light, dusk, w, h, ox, oy, area: area ?? [0, 0, w, h] };
  const own = OWN[scene];
  // (whether anything is out at all just now: if not, no canvases and no frame loop)
  const now = conditions(wx, light, own);
  const any = now.leaves > 0 || now.petals || now.pollen > 0 || now.flies || now.flurries;

  useEffect(() => {
    if (!any) return;
    const calm = matchMedia('(prefers-reduced-motion: reduce)');
    let raf = 0, last = 0, cond = now, condAt = 0;
    const tick = (ms: number) => {
      raf = requestAnimationFrame(tick);
      if (ms - last < 1000 / FPS - 4) return;           // (a little early is fine: on time, frames 16.7 ms apart missed by a hair and ran one late)
      last = ms;
      const L = live.current, a = air.current?.getContext('2d'), g = ground.current?.getContext('2d');
      if (!a || !g) return;
      const t = Date.now() / 1000;
      if (ms - condAt > 5000) { cond = conditions(L.wx, L.light, own); condAt = ms; }
      const slow = calm.matches;
      a.clearRect(0, 0, a.canvas.width, a.canvas.height);
      g.clearRect(0, 0, g.canvas.width, g.canvas.height);
      draw(a, g, t, cond, L, own, slow);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // (everything that changes from frame to frame is read from `live`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [any, scene]);

  if (!any) return null;
  const style = (z: number | undefined): CSSProperties => ({ position: 'absolute', left: 0, top: 0, width: w, height: h, zIndex: z, pointerEvents: 'none', imageRendering: 'pixelated', display: 'block' });
  return (
    <>
      <canvas ref={ground} className="season-ground" width={Math.ceil(w * S)} height={Math.ceil(h * S)} style={style(groundZ)} />
      <canvas ref={air} className="season-air" width={Math.ceil(w * S)} height={Math.ceil(h * S)} style={style(airZ)} />
    </>
  );
}

/** What the frame loop reads each frame (kept in a ref, so a new weather reading or hour never restarts it). */
type Live = { wx: Weather | null; light: number; dusk: number; w: number; h: number; ox: number; oy: number; area: number[] };

function draw(a: CanvasRenderingContext2D, g: CanvasRenderingContext2D, t: number, c: Now, L: Live, own: Own, slow: boolean) {
  const [AX, AY, AW, AH] = L.area, ox = L.ox, oy = L.oy;
  const size = AW * AH;
  const dot = (ctx: CanvasRenderingContext2D, x: number, y: number) => ctx.fillRect(Math.round(x + ox) * S, Math.round(y + oy) * S, S, S);
  const few = slow ? 0.35 : 1, pace = slow ? 0.5 : 1;
  const T = t * pace;                                   // (slower under reduced motion: the clock itself runs slow)

  // ── the pollen haze: a faint yellow wash on the ground (under the people), and motes drifting in the air ──
  if (c.pollen > 0) {
    g.fillStyle = `rgba(236, 214, 90, ${0.07 * c.pollen})`; g.fillRect((AX + ox) * S, (AY + oy) * S, AW * S, AH * S);
    const n = Math.round((size / 5500) * c.pollen * few);
    for (let i = 0; i < n; i++) {
      const vx = (1.2 + 2.2 * hash(i, 1, 11)) * c.dir * (0.6 + c.wind / 20);
      const x = AX + ((((hash(i, 2, 11) * AW + vx * T + 3 * Math.sin(T * 0.4 + i)) % AW) + AW) % AW);
      const y = AY + ((((hash(i, 3, 11) * AH + 2.5 * Math.sin(T * 0.3 + i * 1.7) + c.drift * vx * T * 0.2) % AH) + AH) % AH);
      // (each mote shows for a while and is gone for a while: the haze shimmers rather than crawls)
      if (frac(T / (6 + 5 * hash(i, 4, 11)) + hash(i, 5, 11)) > 0.7) continue;
      a.fillStyle = dim(POLLEN[i % POLLEN.length], L.dusk);
      dot(a, x, y);
    }
  }

  // ── leaves, blowing across; one in four comes down and lies on the ground for a while ──
  if (c.leaves > 0) {
    const n = Math.round((size / 14000) * c.leaves * few);
    const speed = 9 + c.wind * 0.9;                     // dots a second
    const cross = AW + 40;
    for (let i = 0; i < n; i++) {
      const settles = hash(i, 0, 21) < 0.25;
      const fly = (cross / speed) * (0.85 + 0.3 * hash(i, 1, 21));
      const rest = settles ? 25 + 25 * hash(i, 2, 21) : 0;
      const period = fly + rest + 4 * hash(i, 3, 21);   // (a pause before the next leaf in this slot)
      const k = T / period + hash(i, 4, 21), cyc = Math.floor(k), u = (k - cyc) * period;
      const r = (j: number) => hash(i, cyc, 30 + j);
      const land = settles ? 0.25 + 0.6 * r(0) : 1;     // how far across it gets, if it comes down
      const startX = c.dir > 0 ? AX - 20 : AX + AW + 20;
      const gy = AY + 10 + r(1) * (AH - 20);           // the ground under it, where it started
      const colour = LEAF[Math.floor(r(2) * LEAF.length)];
      const tFly = fly * land;
      if (u < tFly) {
        const x = startX + c.dir * (cross / fly) * u * (0.9 + 0.2 * r(3));
        const y = gy + c.drift * speed * u + 3 * Math.sin(u * (1.2 + r(4)) + r(5) * 6);
        // in the air: up off the ground, bobbing; one that comes down sinks to it as it goes
        const up = settles ? 14 * (1 - u / tFly) * (0.6 + 0.4 * r(6)) : 8 + 5 * Math.sin(u * 0.9 + r(7) * 6);
        // its shadow on the ground below it (on the ground canvas: under the people), so it reads as up in the air
        g.fillStyle = 'rgba(20, 24, 10, 0.28)';
        dot(g, x, y + 1);
        // tumbling: flat (two by two, a darker vein), tipping (two across, two down), edge on (one)
        const spin = Math.floor(u * (4 + 3 * r(8)) + r(9) * 4) % 4;
        const px = x, py = y - up;
        a.fillStyle = dim(colour, L.dusk);
        dot(a, px, py);
        if (spin === 0) { dot(a, px + 1, py); dot(a, px, py + 1); a.fillStyle = dim(colour, Math.min(1, L.dusk + 0.3)); dot(a, px + 1, py + 1); }
        else if (spin === 1) dot(a, px + 1, py);
        else if (spin === 2) dot(a, px, py + 1);
        // (spin 3: edge on, one dot)
      } else if (settles && u < tFly + rest) {
        // lying where it came down, fading out over the last few seconds (the ground canvas is under the night already)
        const x = startX + c.dir * (cross / fly) * tFly * (0.9 + 0.2 * r(3));
        const y = gy + c.drift * speed * tFly;
        const left = tFly + rest - u;
        g.globalAlpha = Math.min(1, left / 4);
        g.fillStyle = colour;
        dot(g, x, y); dot(g, x + 1, y + (r(10) < 0.5 ? 0 : 1));
        g.globalAlpha = 1;
      }
    }
  }

  // ── petals off the flowering trees: a few at a time, down and drifting with the wind, lying a while ──
  if (c.petals) {
    own.petals.forEach(([cx, cy, rx, ry, kind], tree) => {
      const n = Math.max(1, Math.round(6 * few));
      for (let i = 0; i < n; i++) {
        const fall = 5 + 3 * hash(tree, i, 41), rest = 18 + 14 * hash(tree, i, 42);
        const period = fall + rest + 6 * hash(tree, i, 43);
        const k = T / period + hash(tree, i, 44), cyc = Math.floor(k), u = (k - cyc) * period;
        const r = (j: number) => hash(tree * 31 + i, cyc, 50 + j);
        const x0 = cx + (r(0) * 2 - 1) * rx, y0 = cy + (r(1) * 2 - 1) * ry * 0.6;
        const drop = ry * 0.8 + 10 + 10 * r(2);         // from the blossom to the ground under it
        const carry = c.dir * (4 + c.wind * 0.5) * (0.6 + 0.6 * r(3));
        const colour = PETAL[kind][Math.floor(r(4) * 3)];
        if (u < fall) {
          const p = u / fall;
          a.fillStyle = dim(colour, L.dusk);
          dot(a, x0 + carry * p + 2 * Math.sin(u * 2.4 + r(5) * 6), y0 + drop * p);
        } else if (u < fall + rest) {
          g.globalAlpha = Math.min(1, (fall + rest - u) / 4);
          g.fillStyle = colour;
          dot(g, x0 + carry, y0 + drop);
          g.globalAlpha = 1;
        }
      }
    });
  }

  // ── fireflies, on spring and summer nights: a dot that lights now and then as it wanders ──
  if (c.flies) {
    const n = Math.round((size / 9000) * few);
    for (let i = 0; i < n; i++) {
      const blink = 3 + 3 * hash(i, 1, 61), on = frac(t / blink + hash(i, 2, 61));
      if (on > 0.22) continue;                          // (lit a fifth of the time; the blink keeps its own pace)
      const x = AX + 8 + hash(i, 3, 61) * (AW - 16) + 14 * Math.sin(T * 0.21 + i * 2.1) + 6 * Math.sin(T * 0.53 + i);
      const y = AY + 8 + hash(i, 4, 61) * (AH - 16) + 10 * Math.sin(T * 0.17 + i * 1.3) + 5 * Math.cos(T * 0.47 + i);
      const bright = on < 0.03 || on > 0.19 ? 0.5 : 1;  // (coming on and going off)
      a.globalAlpha = bright;
      a.fillStyle = '#e9ff8a';
      dot(a, x, y);
      a.globalAlpha = 0.3 * bright;
      a.fillStyle = '#b8e05a';
      dot(a, x - 1, y); dot(a, x + 1, y); dot(a, x, y - 1); dot(a, x, y + 1);
      a.globalAlpha = 1;
    }
  }

  // ── flurries, when it is really snowing: a light scatter of white dots, wavering down ──
  if (c.flurries) {
    const n = Math.round((size / 3500) * few);
    for (let i = 0; i < n; i++) {
      const vy = 9 + 6 * hash(i, 1, 71);
      const period = (AH + 20) / vy;
      const k = T / period + hash(i, 2, 71), cyc = Math.floor(k), u = (k - cyc) * period;
      const x = AX + hash(i, cyc, 72) * AW + c.dir * (2 + c.wind * 0.3) * u + 3 * Math.sin(u * 1.3 + i);
      a.fillStyle = dim(hash(i, 3, 71) < 0.7 ? '#f4f8fc' : '#d6e0ee', L.dusk * 0.6);
      dot(a, x, AY - 10 + vy * u);
    }
  }
}
