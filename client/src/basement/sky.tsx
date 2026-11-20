// Through the telescope at the campsite: the sky as it is just now over the house's weather town (settings.sky), or,
// with no town picked, at 40° north and the longitude the house's time zone suggests. The bright stars and the constellations people know (lines and names) wheel round with the hour, the
// moon is where it is in the sky and as full as it is tonight, and now and then a shooting star goes over. By day the
// stars are washed out: a blue sky with clouds drifting, and the moon if it is up. Drag to look round the horizon.
import { useEffect, useRef } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { pageRect } from '../device';
import { useStore } from '../store';

let LAT = 40, LON = 0, whereKey = '';
/** Where the sky is seen from: [latitude, longitude]. */
function where(): [number, number] {
  const at = useStore.getState().settings.sky;
  if (at) return at;
  const tz = useStore.getState().settings.tz || undefined;
  const hm = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(new Date(Date.UTC(2026, 0, 1, 12)));
  const off = Number(hm.find((p) => p.type === 'hour')?.value ?? 12) - 12 + Number(hm.find((p) => p.type === 'minute')?.value ?? 0) / 60;
  return [40, Math.max(-180, Math.min(180, off * 15))];
}
const W = 960, H = 540, FOV = 130;                    // degrees across
const R = Math.PI / 180;

export const useSky = create<{ open: boolean }>()(() => ({ open: false }));

// [name, [[ra hours, dec degrees, magnitude]...], lines between them (by index)]
const CONST: [string, number[][], number[][]][] = [
  ['The Big Dipper', [[11.06, 61.75, 1.8], [11.03, 56.38, 2.4], [11.9, 53.69, 2.4], [12.26, 57.03, 3.3], [12.9, 55.96, 1.8], [13.4, 54.93, 2.2], [13.79, 49.31, 1.9]], [[0, 1], [1, 2], [2, 3], [3, 0], [3, 4], [4, 5], [5, 6]]],
  ['Polaris', [[2.53, 89.26, 2.0]], []],
  ['Cassiopeia', [[0.15, 59.15, 2.3], [0.68, 56.54, 2.2], [0.95, 60.72, 2.4], [1.43, 60.24, 2.7], [1.91, 63.67, 3.4]], [[0, 1], [1, 2], [2, 3], [3, 4]]],
  ['Orion', [[5.92, 7.41, 0.5], [5.42, 6.35, 1.6], [5.68, -1.94, 1.8], [5.6, -1.2, 1.7], [5.53, -0.3, 2.2], [5.8, -9.67, 2.1], [5.24, -8.2, 0.1], [5.59, 9.93, 3.4]], [[0, 1], [0, 2], [1, 4], [2, 3], [3, 4], [2, 5], [4, 6], [0, 7], [7, 1]]],
  ['Cygnus', [[20.69, 45.28, 1.3], [20.37, 40.26, 2.2], [20.77, 33.97, 2.5], [19.75, 45.13, 2.9], [19.51, 27.96, 3.1]], [[0, 1], [1, 4], [3, 1], [1, 2]]],
  ['The Summer Triangle', [[18.62, 38.78, 0.0], [20.69, 45.28, 1.3], [19.85, 8.87, 0.8]], [[0, 1], [1, 2], [2, 0]]],
  ['Leo', [[10.14, 11.97, 1.4], [10.12, 16.76, 3.5], [10.33, 19.84, 2.0], [10.28, 23.42, 3.4], [9.88, 26.0, 3.9], [11.24, 20.52, 2.6], [11.82, 14.57, 2.1], [11.24, 15.43, 3.3]], [[0, 1], [1, 2], [2, 3], [3, 4], [2, 5], [5, 6], [6, 7], [7, 0], [5, 7]]],
  ['Scorpius', [[16.09, -19.81, 2.6], [16.01, -22.62, 2.3], [16.49, -26.43, 1.0], [16.6, -28.22, 2.8], [16.84, -34.29, 2.3], [16.86, -38.05, 3.0], [16.91, -42.36, 3.6], [17.2, -43.24, 3.3], [17.62, -43.0, 1.9], [17.79, -40.13, 3.0], [17.56, -37.1, 1.6]], [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [8, 9], [9, 10]]],
  ['Taurus', [[4.6, 16.51, 0.9], [5.44, 28.6, 1.7], [5.63, 21.14, 3.0], [4.48, 19.18, 3.5], [4.33, 15.63, 3.7]], [[0, 4], [4, 3], [3, 1], [0, 2]]],
  ['The Pleiades', [[3.79, 24.12, 1.6], [3.75, 24.37, 3.7], [3.82, 23.95, 3.9], [3.77, 23.95, 4.2], [3.74, 24.11, 4.3]], []],
  ['Gemini', [[7.76, 28.03, 1.1], [7.58, 31.89, 1.6], [6.63, 16.4, 1.9], [7.33, 21.98, 3.5]], [[0, 3], [3, 2], [1, 0]]],
  ['Sirius', [[6.75, -16.72, -1.4]], []],
  ['Arcturus', [[14.26, 19.18, -0.1]], []],
  ['Spica', [[13.42, -11.16, 1.0]], []],
  ['Capella', [[5.28, 46.0, 0.1]], []],
  ['Procyon', [[7.66, 5.22, 0.4]], []],
];
// faint stars everywhere: the same scatter every time
const FIELD = (() => { let s = 3; const r = () => ((s = (s * 16807) % 2147483647) / 2147483647); return Array.from({ length: 900 }, () => [r() * 24, Math.asin(r() * 2 - 1) / R, 3.4 + r() * 2.4]); })();
const CLOUDS = (() => { let s = 9; const r = () => ((s = (s * 16807) % 2147483647) / 2147483647); return Array.from({ length: 9 }, () => [r() * W, 40 + r() * 260, 60 + r() * 120, r()]); })();

const jd = (d: Date) => d.getTime() / 86400000 + 2440587.5;
function altAz(raH: number, dec: number, lst: number) {
  const ha = (lst - raH * 15) * R, d = dec * R, p = LAT * R;
  const alt = Math.asin(Math.sin(d) * Math.sin(p) + Math.cos(d) * Math.cos(p) * Math.cos(ha));
  const az = Math.atan2(-Math.cos(d) * Math.sin(ha), Math.sin(d) * Math.cos(p) - Math.cos(d) * Math.sin(p) * Math.cos(ha));
  return [alt / R, ((az / R) + 360) % 360];
}
/** The moon (low precision, plenty for a picture): its right ascension (hours), declination, how lit (0 to 1) and
 *  whether it is waxing. */
function moon(d: Date) {
  const n = jd(d) - 2451545;
  const L = 218.316 + 13.176396 * n, M = 134.963 + 13.064993 * n, F = 93.272 + 13.22935 * n;
  const lam = (L + 6.289 * Math.sin(M * R)) * R, bet = 5.128 * Math.sin(F * R) * R, eps = 23.44 * R;
  const ra = Math.atan2(Math.sin(lam) * Math.cos(eps) - Math.tan(bet) * Math.sin(eps), Math.cos(lam));
  const dec = Math.asin(Math.sin(bet) * Math.cos(eps) + Math.cos(bet) * Math.sin(eps) * Math.sin(lam));
  const g = 357.528 + 0.9856003 * n, sun = (280.46 + 0.9856474 * n + 1.915 * Math.sin(g * R)) * R;
  const el = lam - sun;
  return { ra: (((ra / R) + 360) % 360) / 15, dec: dec / R, lit: (1 - Math.cos(el)) / 2, waxing: Math.sin(el) > 0 };
}

export function SkyView({ light }: { light: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const look = useRef<number | null>(null), drag = useRef<{ x: number; az: number } | null>(null);
  const shoot = useRef<{ t0: number; x: number; y: number; dx: number; dy: number } | null>(null);
  const close = () => useSky.setState({ open: false });
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', esc);
    let raf = 0;
    const go = (t: number) => { draw(t); raf = requestAnimationFrame(go); };
    raf = requestAnimationFrame(go);
    return () => { window.removeEventListener('keydown', esc); cancelAnimationFrame(raf); };
  });
  const draw = (t: number) => {
    const c = ref.current?.getContext('2d');
    if (!c) return;
    const key = JSON.stringify([useStore.getState().settings.sky, useStore.getState().settings.tz]);
    if (key !== whereKey) { whereKey = key; [LAT, LON] = where(); }
    const now = new Date(), lst = (280.46061837 + 360.98564736629 * (jd(now) - 2451545) + LON) % 360;
    const mo = moon(now), [mAlt, mAz] = altAz(mo.ra, mo.dec, lst);
    if (look.current === null) look.current = mAlt > 5 ? mAz : 180;          // (first: at the moon if it is up, else south)
    const az0 = look.current;
    const P = (alt: number, az: number): [number, number] | null => {
      let da = az - az0; da = ((da + 540) % 360) - 180;
      if (Math.abs(da) > FOV / 2 + 10 || alt < -2) return null;
      return [W / 2 + (da / FOV) * W, H - 60 - (alt / 80) * (H - 80)];
    };
    const night = 1 - light;
    const sky = c.createLinearGradient(0, 0, 0, H);
    const mixc = (a: number[], b: number[]) => `rgb(${a.map((v, i) => Math.round(b[i] + (v - b[i]) * light)).join(',')})`;
    sky.addColorStop(0, mixc([70, 140, 225], [2, 4, 16])); sky.addColorStop(1, mixc([180, 215, 240], [14, 22, 48]));
    c.fillStyle = sky; c.fillRect(0, 0, W, H);
    // the Milky Way, faintly, at night
    if (night > 0.4) {
      for (let k = 0; k < 40; k++) {
        const raH = 17.8 + k * 0.17, dec = -29 + k * 2.2, [al, a] = altAz(raH % 24, dec, lst), p = P(al, a);
        if (!p) continue;
        const gl = c.createRadialGradient(p[0], p[1], 0, p[0], p[1], 70);
        gl.addColorStop(0, `rgba(200,210,255,${0.05 * (night - 0.4)})`); gl.addColorStop(1, 'rgba(200,210,255,0)');
        c.fillStyle = gl; c.fillRect(p[0] - 70, p[1] - 70, 140, 140);
      }
    }
    const starA = Math.max(0, night * 1.25 - 0.25);
    if (starA > 0) {
      for (const [raH, dec, mag] of FIELD) {
        const [al, a] = altAz(raH, dec, lst), p = P(al, a);
        if (!p) continue;
        c.fillStyle = `rgba(230,236,255,${starA * (0.9 - (mag - 3.4) * 0.3) * (0.75 + 0.25 * Math.sin(t / 300 + raH * 9))})`;
        c.fillRect(p[0], p[1], 1.2, 1.2);
      }
      c.font = '15px VT323, monospace'; c.textAlign = 'center';
      for (const [name, stars, lines] of CONST) {
        const pts = stars.map(([ra, dec]) => { const [al, a] = altAz(ra, dec, lst); return P(al, a); });
        c.strokeStyle = `rgba(150,180,255,${starA * 0.35})`; c.lineWidth = 1;
        for (const [i, j] of lines) { const a = pts[i], b = pts[j]; if (a && b && Math.abs(a[0] - b[0]) < W / 2) { c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke(); } }
        stars.forEach(([, , mag], i) => {
          const p = pts[i];
          if (!p) return;
          const r = Math.max(0.8, 3.2 - mag * 0.6);
          const g = c.createRadialGradient(p[0], p[1], 0, p[0], p[1], r * 3);
          g.addColorStop(0, `rgba(255,255,245,${starA})`); g.addColorStop(0.35, `rgba(220,230,255,${starA * 0.5})`); g.addColorStop(1, 'rgba(220,230,255,0)');
          c.fillStyle = g; c.fillRect(p[0] - r * 3, p[1] - r * 3, r * 6, r * 6);
        });
        const vis = pts.filter(Boolean) as [number, number][];
        if (vis.length) { c.fillStyle = `rgba(190,205,255,${starA * 0.6})`; c.fillText(name, vis.reduce((s, p) => s + p[0], 0) / vis.length, Math.max(...vis.map((p) => p[1])) + 22); }
      }
      // now and then, a shooting star
      const s = shoot.current;
      if (!s && Math.random() < 0.0025 * night) shoot.current = { t0: t, x: 100 + Math.random() * (W - 200), y: 30 + Math.random() * 180, dx: (Math.random() < 0.5 ? -1 : 1) * (260 + Math.random() * 200), dy: 90 + Math.random() * 120 };
      if (s) {
        const u = (t - s.t0) / 700;
        if (u > 1) shoot.current = null;
        else {
          const hx = s.x + s.dx * u, hy = s.y + s.dy * u, tx = s.x + s.dx * Math.max(0, u - 0.25), ty = s.y + s.dy * Math.max(0, u - 0.25);
          const g = c.createLinearGradient(tx, ty, hx, hy); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(1, `rgba(255,255,240,${starA * (1 - u * 0.6)})`);
          c.strokeStyle = g; c.lineWidth = 2; c.beginPath(); c.moveTo(tx, ty); c.lineTo(hx, hy); c.stroke();
        }
      }
    }
    // clouds, by day (and dark shapes against the stars at dusk)
    for (const [x, y, w, r] of CLOUDS) {
      // (each cloud is somewhere round the sky, drifting slowly east to west: looking round moves past them)
      let da = ((x / W) * 360 + t * 0.0004 * (0.5 + r)) % 360 - az0; da = ((da % 360) + 540) % 360 - 180;
      if (Math.abs(da) > FOV / 2 + 30) continue;
      const cx = W / 2 + (da / FOV) * W;
      c.fillStyle = `rgba(255,255,255,${0.55 * light})`;
      for (let k = 0; k < 5; k++) { c.beginPath(); c.ellipse(cx + k * w * 0.2, y + Math.sin(k * 2 + r * 6) * 8, w * 0.22, w * 0.12, 0, 0, Math.PI * 2); c.fill(); }
    }
    // the moon: lit on the side toward the sun, its seas in shade
    const mp = P(mAlt, mAz);
    if (mp) {
      const [x, y] = mp, r = 22;
      const halo = c.createRadialGradient(x, y, r, x, y, r * 4);
      halo.addColorStop(0, `rgba(240,240,220,${0.25 * mo.lit * (0.3 + night)})`); halo.addColorStop(1, 'rgba(240,240,220,0)');
      c.fillStyle = halo; c.fillRect(x - r * 4, y - r * 4, r * 8, r * 8);
      c.save(); c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.clip();
      c.fillStyle = mixc([150, 175, 215], [26, 30, 46]); c.fillRect(x - r, y - r, r * 2, r * 2);
      // the lit part: half a disc on the sun's side, and an ellipse that adds (gibbous) or takes away (crescent)
      const side = mo.waxing ? 1 : -1, k = 1 - 2 * mo.lit;
      c.fillStyle = '#f2efe2';
      c.beginPath(); c.arc(x, y, r, -Math.PI / 2, Math.PI / 2, side < 0); c.fill();
      c.fillStyle = k > 0 ? mixc([150, 175, 215], [26, 30, 46]) : '#f2efe2';
      c.beginPath(); c.ellipse(x, y, Math.abs(k) * r, r, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = 'rgba(120,120,110,0.28)';
      for (const [dx, dy, rr] of [[-6, -6, 6], [5, 3, 5], [-2, 9, 4], [8, -9, 3]]) { c.beginPath(); c.arc(x + dx, y + dy, rr, 0, Math.PI * 2); c.fill(); }
      c.restore();
      c.fillStyle = `rgba(255,250,220,${0.5 + 0.4 * night})`; c.font = '15px VT323, monospace'; c.textAlign = 'center';
      c.fillText(`The moon, ${mo.lit > 0.97 ? 'full' : mo.lit < 0.03 ? 'new' : `${Math.round(mo.lit * 100)}% lit, ${mo.waxing ? 'waxing' : 'waning'}`}`, x, y + r + 18);
    }
    // the treetops along the bottom, and the compass
    c.fillStyle = mixc([30, 70, 40], [3, 8, 6]);
    c.beginPath(); c.moveTo(0, H);
    for (let x = 0; x <= W; x += 12) { const a = az0 + ((x - W / 2) / W) * FOV, h = 50 + 26 * Math.abs(Math.sin(a * 0.31)) + 18 * Math.abs(Math.sin(a * 1.7)); c.lineTo(x, H - h); c.lineTo(x + 6, H - h + 14); }
    c.lineTo(W, H); c.fill();
    c.fillStyle = 'rgba(255,255,255,0.65)'; c.font = '18px VT323, monospace';
    ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'].forEach((lab, i) => { const p = P(0, i * 45); if (p) c.fillText(lab, p[0], H - 10); });
    // the eyepiece's round edge
    const v = c.createRadialGradient(W / 2, H / 2, H * 0.45, W / 2, H / 2, W * 0.62);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.85)');
    c.fillStyle = v; c.fillRect(0, 0, W, H);
  };
  const down = (e: ReactPointerEvent<HTMLCanvasElement>) => { try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* */ } drag.current = { x: e.clientX, az: look.current ?? 180 }; };
  const move = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (!d) return;
    const r = pageRect(e.currentTarget);
    look.current = (((d.az - ((e.clientX - d.x) / r.width) * FOV) % 360) + 360) % 360;
  };
  const say = light > 0.6 ? 'Daytime: the stars come out after dark (the moon shows by day when it is up). Drag to look round.' : 'The sky over the campsite just now. Drag to look round.';
  return createPortal(
    <div className="gr-overlay" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="gr-box" onClick={(e) => e.stopPropagation()}>
        <header className="gr-tabs"><b className="mg-title">The telescope</b><span /><button onClick={close} title="Back to the campsite (Esc)">Close</button></header>
        <div className="gr-fill"><canvas ref={ref} className="gr-table sky-view" style={{ '--ar': W / H } as CSSProperties} width={W} height={H} onPointerDown={down} onPointerMove={move} onPointerUp={() => { drag.current = null; }} /></div>
        <p className="gr-say">{say}</p>
      </div>
    </div>,
    document.querySelector('.main-view') ?? document.body,
  );
}
