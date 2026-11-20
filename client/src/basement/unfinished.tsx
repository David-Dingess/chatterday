// The unfinished basement's TV: an old tube set hooked up to the GameCube, left on a fighting game that plays itself,
// round after round. Two little fighters, red and blue, on a stage floating in a night sky: they run at each other, jump,
// and trade hits; every hit knocks the other back further (the bars along the bottom are their damage), until one goes
// off the edge and a star flashes where they went. Our own little game, drawn dot by dot on the screen (things.screen).
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { FitProps } from './index';
import { TrophyRack } from '../achievements';

/** The trophy rack on the back wall, between the broom and the bulb's cord (room dots, its top left): achievements.tsx. */
const RACK = { x: 226, y: 34 };

type Fighter = { x: number; y: number; vx: number; vy: number; face: 1 | -1; hurt: number; stun: number; swing: number; color: string; out: number };
const FPS = 15;

function Screen({ at }: { at: number[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current, g = cv?.getContext('2d');
    if (!cv || !g) return;
    const [W, H] = [at[2], at[3]];
    const STAGE = { x0: 4, x1: W - 5, y: H - 6 };
    const stars = Array.from({ length: 9 }, (_, k) => [(k * 37) % W, (k * 11) % (H - 8)]);
    const fresh = (x: number, color: string, face: 1 | -1): Fighter => ({ x, y: -2, vx: 0, vy: 0, face, hurt: 0, stun: 0, swing: 0, color, out: 0 });
    const red = fresh(STAGE.x0 + 3, '#ff5a5a', 1), blue = fresh(STAGE.x1 - 3, '#5a9aff', -1);
    let star = 0, starAt = [0, 0], frame = 0;
    const step = () => {
      frame++;
      for (const [me, them] of [[red, blue], [blue, red]] as const) {
        if (me.out) { if (--me.out === 0) Object.assign(me, fresh(me === red ? STAGE.x0 + 3 : STAGE.x1 - 3, me.color, me === red ? 1 : -1)); continue; }
        const onStage = me.y >= STAGE.y && me.x >= STAGE.x0 && me.x <= STAGE.x1;
        if (me.stun > 0) me.stun--;
        else {
          const gap = them.x - me.x;
          me.face = gap >= 0 ? 1 : -1;
          if (Math.abs(gap) > 2.5 || them.out) me.vx += 0.12 * Math.sign(gap || 1) * (them.out ? 0 : 1);
          if (onStage && Math.random() < 0.04) me.vy = -1.4;                                  // a jump now and then
          if (me.x < STAGE.x0 + 1 && me.vy > -0.5 && me.y > STAGE.y - 2) { me.vy = -1.6; me.vx = 0.5; }      // back to the stage
          if (me.x > STAGE.x1 - 1 && me.vy > -0.5 && me.y > STAGE.y - 2) { me.vy = -1.6; me.vx = -0.5; }
          if (!me.swing && !them.out && Math.abs(gap) < 3.5 && Math.abs(them.y - me.y) < 3 && Math.random() < 0.3) {
            me.swing = 3;                                                                     // a hit: the further they are gone, the further they fly
            them.hurt = Math.min(them.hurt + 6 + Math.random() * 10, 160);
            const knock = 0.4 + them.hurt / 70;
            them.vx = me.face * knock; them.vy = -knock * 0.8; them.stun = 4 + Math.floor(them.hurt / 25);
          }
        }
        if (me.swing) me.swing--;
        me.vy += 0.18;
        me.vx *= onStage ? 0.8 : 0.97;
        me.x += me.vx; me.y += me.vy;
        if (me.y >= STAGE.y && me.y - me.vy <= STAGE.y + 0.5 && me.x >= STAGE.x0 && me.x <= STAGE.x1) { me.y = STAGE.y; me.vy = 0; }
        if (me.x < -3 || me.x > W + 3 || me.y > H + 3 || me.y < -12) {                       // gone off the edge: a star, and back in a moment
          star = 8; starAt = [Math.max(1, Math.min(W - 2, me.x)), Math.max(1, Math.min(H - 2, me.y))];
          me.out = 20; me.hurt = 0;
        }
      }
      // ── draw ──
      g.fillStyle = '#141a3a'; g.fillRect(0, 0, W, H);
      g.fillStyle = '#26306a'; g.fillRect(0, H - 9, W, 9);
      g.fillStyle = '#c8d0ff';
      for (const [x, y] of stars) if ((frame + x) % 23) g.fillRect(x, y, 1, 1);
      g.fillStyle = '#3ad0b0'; g.fillRect(STAGE.x0, STAGE.y + 1, STAGE.x1 - STAGE.x0 + 1, 1);   // the stage: a lit edge over a dark block
      g.fillStyle = '#2a3a58'; g.fillRect(STAGE.x0 + 1, STAGE.y + 2, STAGE.x1 - STAGE.x0 - 1, 2);
      for (const f of [red, blue]) {
        if (f.out) continue;
        const x = Math.round(f.x), y = Math.round(f.y);
        g.fillStyle = f.stun && frame % 2 ? '#ffffff' : f.color;
        g.fillRect(x - 1, y - 3, 2, 3);
        g.fillStyle = '#f2d0b0'; g.fillRect(x - 1 + (f.face > 0 ? 1 : 0), y - 4, 1, 1);
        if (f.swing) { g.fillStyle = '#ffffff'; g.fillRect(x + f.face * 2 - (f.face < 0 ? 1 : 0), y - 2, 1, 1); }
      }
      if (star > 0) { g.fillStyle = star % 2 ? '#fff6a0' : '#ffffff'; g.fillRect(starAt[0] - 1, starAt[1], 3, 1); g.fillRect(starAt[0], starAt[1] - 1, 1, 3); star--; }
      for (const [k, f] of [[0, red], [1, blue]] as const) {                                 // the damage bars
        g.fillStyle = '#000'; g.fillRect(3 + k * 11, H - 1, 8, 1);
        g.fillStyle = f.hurt > 100 ? '#ff3030' : f.hurt > 50 ? '#ffb030' : '#f4f4f4';
        g.fillRect(3 + k * 11, H - 1, Math.max(1, Math.round((f.hurt / 160) * 8)), 1);
      }
      g.fillStyle = 'rgba(0,0,0,0.18)';                                                      // the tube's scan lines
      for (let y = frame % 2; y < H; y += 2) g.fillRect(0, y, W, 1);
    };
    const t = window.setInterval(step, 1000 / FPS);
    step();
    return () => window.clearInterval(t);
  }, [at]);
  return <canvas ref={ref} className="fit-tv" width={at[2]} height={at[3]} style={{ left: at[0], top: at[1], width: at[2], height: at[3], zIndex: 197 }} aria-hidden />;
}

/** A clip of your own on the TV instead: client/public/basement/unfinished/tv.gif (kept out of git, like the photos
 *  upstairs). Without one, the little game above plays. */
const CLIP = '/basement/unfinished/tv.gif';

/** Where the picture really is in a clip: a 4:3 game recorded into a 16:9 frame has black bars down the sides (or a
 *  wide one in a tall frame, top and bottom). Measured once off its first frame, as fractions of its width and height. */
function pictureIn(img: HTMLImageElement): [number, number, number, number] {
  const w = img.naturalWidth, h = img.naturalHeight, cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const g = cv.getContext('2d', { willReadFrequently: true });
  if (!g || !w || !h) return [0, 0, 1, 1];
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, w, h).data, lit = (x: number, y: number) => { const k = (y * w + x) * 4; return d[k] + d[k + 1] + d[k + 2] > 60; };
  let x0 = 0, x1 = w - 1, y0 = 0, y1 = h - 1;
  // (a column counts as bar only if most of it is dark: the game's own dark scenery at an edge is not a bar)
  const barCol = (x: number) => { let n = 0; for (let y = 0; y < h; y += 2) if (lit(x, y)) n++; return n < h / 20; };
  const barRow = (y: number) => { let n = 0; for (let x = 0; x < w; x += 2) if (lit(x, y)) n++; return n < w / 20; };
  while (x0 < w / 3 && barCol(x0)) x0++;
  while (x1 > (w * 2) / 3 && barCol(x1)) x1--;
  while (y0 < h / 3 && barRow(y0)) y0++;
  while (y1 > (h * 2) / 3 && barRow(y1)) y1--;
  return [x0 / w, y0 / h, (x1 + 1 - x0) / w, (y1 + 1 - y0) / h];
}

type Pad = { port: number[]; rest: number[]; color: 'indigo' | 'black' };
const PAD_COLORS = { indigo: ['#6a5acd', '#8f80ee', '#43379a'], black: ['#2e2e36', '#50505c', '#18181e'] };

/** A controller lying on the rug, 7 by 5 dots, seen from above: the body, two grips, the stick, A and the C-stick. */
function PadOnRug({ x, y, color }: { x: number; y: number; color: Pad['color'] }) {
  const [body, hi, lo] = PAD_COLORS[color];
  const r = (dx: number, dy: number, w: number, h: number, fill: string) => <rect x={x + dx} y={y + dy} width={w} height={h} fill={fill} />;
  return (
    <g>
      {r(0, 2, 2, 3, lo)}{r(5, 2, 2, 3, lo)}{r(1, 0, 5, 3, body)}{r(0, 1, 2, 3, body)}{r(5, 1, 2, 3, body)}{r(1, 0, 5, 1, hi)}
      {r(1, 1, 1, 1, '#d8dae2')}{r(5, 1, 1, 1, '#3ac06a')}{r(4, 2, 1, 1, '#f0d040')}
    </g>
  );
}

/** The two wired controllers and their cords. Nobody on the couch: they lie on the rug, the cords curving back to the
 *  GameCube. Somebody sat on it: the controllers are in their hands (out of sight in front of them), the cords running
 *  up to them; the first to sit (from the left) has the purple one. */
function Controllers({ pads, seats, seated, couch }: { pads: Pad[]; seats: FitProps['layout']['seats']; seated: boolean[]; couch: number[] }) {
  const playing = couch.filter((n) => seated[n]);
  const X0 = 190, Y0 = 200, W = 140, H = 70;           // the patch of room the cords and pads can be in
  return (
    <svg className="fit-pads" viewBox={`${X0} ${Y0} ${W} ${H}`} style={{ left: X0, top: Y0, width: W, height: H, zIndex: 214 }} aria-hidden>
      {pads.map((p, k) => {
        const held = playing[k] !== undefined ? seats[playing[k]] : null;
        const [px, py] = p.port;
        const [ex, ey] = held ? [held.x + (k ? 3 : -3), held.y - 9] : [p.rest[0] + 3, p.rest[1]];
        const side = ex < px ? -1 : 1;
        const d = `M${px + 0.5} ${py} C ${px + side * 4} ${py + 12}, ${ex - side * 14} ${ey - (held ? 4 : 10)}, ${ex + 0.5} ${ey}`;
        return (
          <g key={k}>
            <path d={d} fill="none" stroke="#3a3a44" strokeWidth={1} transform="translate(0 1)" />
            <path d={d} fill="none" stroke="#141418" strokeWidth={1} />
            {!held && <PadOnRug x={p.rest[0]} y={p.rest[1]} color={p.color} />}
          </g>
        );
      })}
    </svg>
  );
}

export function Room({ layout, seated }: FitProps) {
  const pads = layout.things.pads as Pad[] | undefined;
  const controllers = <>
    {pads ? <Controllers pads={pads} seats={layout.seats} seated={seated} couch={(layout.things.couch as number[]) ?? []} /> : null}
    <TrophyRack x={RACK.x} y={RACK.y} />
  </>;
  const at = layout.things.screen as number[] | undefined;
  const [clip, setClip] = useState<[number, number, number, number] | false | null>(null);
  if (!at) return controllers;
  // The picture fills the screen (cut a little off whichever way it is wider than the screen), in a box the size of the
  // screen; the image itself is drawn bigger, so the bars fall outside the box.
  let img: CSSProperties = { visibility: 'hidden', width: at[2], height: at[3] };
  if (clip) {
    const [fx, fy, fw, fh] = clip, scale = Math.max(at[2] / fw, at[3] / fh);
    const w = scale, h = scale;      // the whole image's size, in screen dots, per unit of its own width and height
    img = { width: w, height: h, left: -fx * w + (at[2] - fw * w) / 2, top: -fy * h + (at[3] - fh * h) / 2 };
  }
  return (
    <>
      {clip !== false && (
        <div className="fit-tv" style={{ left: at[0], top: at[1], width: at[2], height: at[3], zIndex: 198, overflow: 'hidden', visibility: clip ? 'visible' : 'hidden' }}>
          <img className="fit-tv-clip" src={CLIP} alt="" draggable={false} style={img} onError={() => setClip(false)}
            onLoad={(e) => { try { setClip(pictureIn(e.currentTarget)); } catch { setClip([0, 0, 1, 1]); } }} />
        </div>
      )}
      {!clip && <Screen at={at} />}
      {controllers}
    </>
  );
}
