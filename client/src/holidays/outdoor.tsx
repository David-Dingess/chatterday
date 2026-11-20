// The holidays out of doors: the backyard, the campsite, the lake and the yard round the house dressed for the holiday on
// the clubhouse clock (./dates.ts useHoliday; `?date=MM-DD` previews one, `?hour=21` the night). The pieces are drawn
// in ./outdoorArt.tsx and stood in each scene here, each where it is in nobody's way: on ground nobody walks (beds,
// verges, the strip by the house wall), never on a seat, a walk to one, a game, the mower's lawn or a place on the dock.
//
//   Halloween      jack-o'-lanterns by the back door, round the campfire and at the bait shop (lit at night), pumpkins in
//                  the bed, cobwebs on the fence, a scarecrow by the vegetable bed past the graves (the graves themselves
//                  are left alone)
//   Thanksgiving   hay bales, pumpkins and gourds at the edge of the campsite; pumpkins by the back door and the bait shop
//   Christmas      bulbs along the fence and down the house walls (twinkling at night), wreaths on the back door, the
//                  campsite's door and the bait shop's, a lit tree by the bait shop
//   New Year's     tinsel on the fence; fireworks over the lake at night
//   Valentine's    hearts strung along the fence, a wreath of hearts on the back door, a heart on a stake in the bed
//   St. Patrick's  shamrocks along the fence, a pot of gold by the gnome
//   Easter         eggs hidden in the beds and the grass
//   Fourth of July bunting on the fence, the flag, and on the night of the 4th fireworks over the lake
//   and whenever it is really snowing (the scene in its snow pictures), a snowman.
//
// Cheap: every picture is drawn once, as the first page needs it; frames move by CSS steps, not React; the fireworks are
// one canvas on a frame loop, only while they are on. Under prefers-reduced-motion nothing twinkles or waves, and the
// fireworks are fewer and slower. Lights shine; the people never glow (the lit layer is the bulbs themselves, and the
// small halo round a jack-o'-lantern or the tree stays on the ground beside it).
import { memo, useEffect, useMemo, useRef } from 'react';
import type { CSSProperties } from 'react';
import { useHoliday } from './dates';
import type { Holiday } from './dates';
import { useSceneArt } from '../season';
import { ART, PLACES, SNOWMAN, stringOf } from './outdoorArt';
import type { Pic, Sprite } from './outdoorArt';
import './outdoor.css';

import type { Scene } from './outdoorArt';

// ── the pictures, made once each ──
const SCALE = 4;
function strip(pics: Pic[]) {
  const w = pics.reduce((n, p) => n + p.w, 0), h = Math.max(...pics.map((p) => p.h));
  const one = document.createElement('canvas'), big = document.createElement('canvas');
  one.width = w; one.height = h; big.width = w * SCALE; big.height = h * SCALE;
  let x = 0;
  for (const p of pics) { one.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(p.px), p.w, p.h), x, 0); x += p.w; }
  const g = big.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  g.drawImage(one, 0, 0, big.width, big.height);
  return big.toDataURL();
}
type Drawn = { w: number; h: number; n: number; ms: number; base: string; lit?: string; x?: number; y?: number };
const made = new Map<string, Drawn>();
function drawn(key: string, make: () => Sprite & { x?: number; y?: number }): Drawn {
  let d = made.get(key);
  if (!d) {
    const s = make();
    d = { w: s.w, h: s.h, n: s.base.length, ms: s.ms ?? 500, base: strip(s.base), lit: s.lit ? strip(s.lit) : undefined, x: s.x, y: s.y };
    made.set(key, d);
  }
  return d;
}

/** The fireworks over the lake: on New Year's (either night) and the night of the Fourth. */
const FIREWORKS = (h: { id: Holiday; peak: boolean } | null) => !!h && (h.id === 'newyear' || (h.id === 'july4' && h.peak));

type Props = {
  scene: Scene;
  /** the scene's seasons (its layout's `seasons`), for the snow */
  seasons?: string[];
  /** the daylight, 0 (night) to 1 */
  light: number;
  /** where the scene's own (0, 0) is (the yard is drawn offset in its panel) */
  ox?: number; oy?: number;
  /** the scene's size, for the fireworks */
  w?: number; h?: number;
};

/** The holiday's decorations for one outdoor scene. */
export const OutdoorDecor = memo(function OutdoorDecor({ scene, seasons, light, ox = 0, oy = 0, w = 528, h = 334 }: Props) {
  const day = useHoliday();
  const art = useSceneArt(seasons);
  const pieces = useMemo(() => {
    const out = [...((day && PLACES[scene][day.id]) ?? [])];
    if (art === '-snow' && SNOWMAN[scene]) out.push(SNOWMAN[scene]!);
    return out;
  }, [day, scene, art]);
  const night = 1 - light, lit = night > 0.3 ? Math.min(1, (night - 0.3) / 0.4) : 0;
  const fireworks = scene === 'lake' && FIREWORKS(day) && night > 0.6;
  if (!pieces.length && !fireworks) return null;
  return (
    <>
      {pieces.map((p, k) => {
        const d = 'line' in p ? drawn(`${p.line}:${JSON.stringify(p.pts)}:${p.sag ?? 4}`, () => stringOf(p.line, p.pts, p.sag)) : drawn(p.art, ART[p.art]);
        const left = 'line' in p ? d.x! : p.x - d.w / 2, top = 'line' in p ? d.y! : p.y - d.h + 1;
        const z = 'line' in p ? p.z : p.z ?? p.y;
        const style = (url: string, zIndex: number, extra?: CSSProperties): CSSProperties => ({
          left: left + ox, top: top + oy, width: d.w, height: d.h, zIndex, backgroundImage: `url(${url})`, backgroundSize: `${d.w * d.n}px ${d.h}px`,
          '--to': `${-d.w * d.n}px`, '--n': d.n, '--d': `${d.ms * d.n}ms`, ...extra,
        } as CSSProperties);
        return (
          <span key={k}>
            <i className={`od${d.n > 1 && !d.lit ? ' anim' : ''}`} style={style(d.base, Math.round(z))} />
            {d.lit && lit > 0 && <i className="od anim" style={style(d.lit, 2984, { opacity: lit })} />}
            {'art' in p && p.glow && lit > 0 && <i className={`od-glow${p.art === 'tree' ? ' tree' : ''}`} style={{ left: p.x + ox - 14, top: p.y + oy - 16, width: 28, height: 22, zIndex: 2983, opacity: 0.8 * lit }} />}
          </span>
        );
      })}
      {fireworks && <Fireworks w={w} h={h} />}
    </>
  );
});

// ── fireworks: a burst every second or so somewhere over the water, rising on a trail, opening into a ring of sparks
//    that fall and fade. Worked out from the clock, so everybody sees the same ones. ──
const hash = (a: number, b: number) => { let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) >>> 0; h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const SPARKS = [['#ff4a4a', '#ffb0a0'], ['#4a8aff', '#c0d8ff'], ['#ffd23a', '#fff2b0'], ['#3ad06a', '#b8f0c8'], ['#e06ae0', '#f8c0f8'], ['#ffffff', '#d8e0f0']];
const S = 2;
function Fireworks({ w, h }: { w: number; h: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const calm = matchMedia('(prefers-reduced-motion: reduce)');
    let raf = 0, last = 0;
    const tick = (ms: number) => {
      raf = requestAnimationFrame(tick);
      if (ms - last < 50) return;
      last = ms;
      const g = ref.current?.getContext('2d');
      if (!g) return;
      g.clearRect(0, 0, g.canvas.width, g.canvas.height);
      const slow = calm.matches, every = slow ? 3.2 : 1.1, t = Date.now() / 1000;
      const dot = (x: number, y: number) => g.fillRect(Math.round(x) * S, Math.round(y) * S, S, S);
      const now = Math.floor(t / every);
      for (let i = now - 3; i <= now; i++) {
        const u = t - i * every - hash(i, 9) * 0.4;                  // seconds since this one went up
        if (u < 0) continue;
        const bx = 70 + hash(i, 1) * (w - 140), by = 22 + hash(i, 2) * 70, rise = 0.7;
        const [c, c2] = SPARKS[Math.floor(hash(i, 3) * SPARKS.length)];
        if (u < rise) {                                              // the rocket going up, its trail behind it
          const p = u / rise, y = 150 + (by - 150) * (1 - (1 - p) ** 2);
          g.fillStyle = '#fff2c0'; dot(bx, y);
          if (!slow) { g.fillStyle = 'rgba(255, 200, 120, 0.5)'; dot(bx, y + 2); dot(bx, y + 4); }
          continue;
        }
        const v = u - rise, life = 1.6;
        if (v > life) continue;
        const n = 30 + Math.floor(hash(i, 4) * 12), r = 30 * (1 - (1 - Math.min(1, v / 0.7)) ** 2) * (0.7 + 0.5 * hash(i, 5));
        const fall = 9 * v * v;
        g.globalAlpha = Math.max(0, 1 - v / life);
        if (v < 0.12) { g.fillStyle = '#ffffff'; for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) dot(bx + dx, by + dy); }   // (the flash as it opens)
        for (let k = 0; k < n; k++) {
          const a = (k / n) * Math.PI * 2 + hash(i, 6) * 0.3;
          const x = bx + Math.cos(a) * r, y = by + Math.sin(a) * r * 0.8 + fall;
          g.fillStyle = k % 3 ? c : c2; dot(x, y);
          if (v < 1) { g.fillStyle = c; dot(bx + Math.cos(a) * r * 0.86, by + Math.sin(a) * r * 0.69 + fall * 0.9); }   // (each spark's short tail)
          if (k % 2 === 0) { g.fillStyle = c2; dot(bx + Math.cos(a + 0.1) * r * 0.55, by + Math.sin(a + 0.1) * r * 0.44 + fall); }   // (an inner ring)
        }
        g.globalAlpha = 1;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [w, h]);
  return <canvas ref={ref} className="od-fireworks" width={w * S} height={h * S} style={{ width: w, height: h, zIndex: 2985 }} />;
}
