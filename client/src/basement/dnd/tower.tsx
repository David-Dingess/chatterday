// The dice tower on the DnD room's table: a little oak tower with a tray at its foot. A roll sent through it (the Tower
// switch by the dice, server/basement/dnd.ts: `tower` on the log entry) drops in at the top, rattles down inside (the tower
// shakes, and whoever is in the room hears it), tumbles out into the tray, and its total rises over the tower for a few
// seconds; the log has it as it has every roll. Drawn by the page, dot by dot, in the room's own dots.
import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { soundGain, useStore } from '../../store';
import { out } from '../sound';

export type TowerRoll = { id: string; by: string; total: number; dice: number; flag: string; t0: number };
const useTower = create<{ rolls: TowerRoll[] }>()(() => ({ rolls: [] }));
const seen = new Set<string>();
const LIFE = 9000;

/** How many dice a roll's detail shows (as "2d6 [3, 5]"): the dice to draw, up to six. */
const diceIn = (detail: string) => Math.max(1, Math.min(6, [...detail.matchAll(/\[([^\]]*)\]/g)].reduce((a, m) => a + m[1].split(',').length, 0)));

/** A roll came through the tower (live, not from the log as it was): show it, and rattle. */
export function towerRoll(e: { id: string; by: string; total: number; detail: string; flag: string }) {
  if (seen.has(e.id)) return;
  seen.add(e.id);
  const r: TowerRoll = { id: e.id, by: e.by, total: e.total, dice: diceIn(e.detail), flag: e.flag, t0: Date.now() };
  useTower.setState((s) => ({ rolls: [...s.rolls.filter((x) => Date.now() - x.t0 < LIFE), r].slice(-3) }));
  rattle(r.dice);
}

// ── the sound: dice clattering down inside (muffled, woody), then out into the tray (brighter), at the sounds' volume ──
let actx: AudioContext | null = null, noise: AudioBuffer | null = null;
function audio() {
  const s = useStore.getState();
  const vol = s.voice.deafened ? 0 : soundGain(s.prefs.soundVol);
  const here = (s.presence[s.me?.id ?? '']?.floor ?? '') === 'dnd';
  if (!vol || !here || document.hidden) return null;                // (only down in the DnD room; hidden: the app is in the tray, silent)
  try {
    actx ??= new AudioContext();
    void actx.resume().catch(() => {});
    const c = actx as AudioContext & { setSinkId?: (id: string) => Promise<void>; sinkId?: string };
    if (c.setSinkId && (c.sinkId ?? '') !== s.prefs.outId) c.setSinkId(s.prefs.outId).catch(() => {});
    if (!noise) {
      noise = actx.createBuffer(1, actx.sampleRate, actx.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    return { a: actx, vol: vol * 0.45 };
  } catch { return null; }
}
function clack(a: AudioContext, at: number, freq: number, gain: number, dur = 0.03) {
  const src = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
  src.buffer = noise; f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 6;
  g.gain.setValueAtTime(Math.max(0.0001, gain), at); g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  src.connect(f).connect(g).connect(out(a, 'dnd'));
  src.start(at, Math.random() * 0.5); src.stop(at + dur + 0.02);
  src.onended = () => g.disconnect();
}
function knock(a: AudioContext, at: number, f0: number, gain: number) {
  const o = a.createOscillator(), g = a.createGain();
  o.type = 'triangle'; o.frequency.setValueAtTime(f0, at); o.frequency.exponentialRampToValueAtTime(f0 * 0.6, at + 0.05);
  g.gain.setValueAtTime(Math.max(0.0001, gain), at); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.06);
  o.connect(g).connect(out(a, 'dnd')); o.start(at); o.stop(at + 0.08);
  o.onended = () => g.disconnect();
}
function rattle(dice: number) {
  const au = audio();
  if (!au) return;
  const { a, vol } = au, t0 = a.currentTime + 0.05;
  // down the baffles: each die knocks against the wood four or five times, closer together as it goes
  for (let d = 0; d < dice; d++) {
    let t = t0 + 0.25 + d * 0.05 + Math.random() * 0.04;
    for (let k = 0; k < 5; k++) {
      clack(a, t, 1300 + Math.random() * 700, vol * (0.5 + Math.random() * 0.3), 0.035);
      knock(a, t, 260 + Math.random() * 120, vol * 0.35);
      t += 0.16 - k * 0.022 + Math.random() * 0.03;
    }
  }
  // out into the tray: brighter, bouncing to a stop
  for (let d = 0; d < dice; d++) {
    let t = t0 + 1.0 + d * 0.06 + Math.random() * 0.05, g = 0.8;
    for (let k = 0; k < 4; k++) {
      clack(a, t, 2600 + Math.random() * 1400, vol * g, 0.025);
      t += 0.11 * Math.pow(0.6, k) + Math.random() * 0.02;
      g *= 0.55;
    }
  }
}

// ── drawing ──
// The tower, 14 dots across and 29 down: the tower itself in the middle (crenellated top, the slot the dice go in, iron
// bands, the arch they come out of), the tray at its foot.
const W = 14, H = 29;
const C = { o: '#3a1e0c', d: '#5a3418', m: '#7a4a28', l: '#a06838', h: '#c8884a', i: '#2a2a30', ih: '#5a5a62', k: '#0c0806', f: '#6a1a1e', fh: '#8a2a2e', g: '#d8b040' };
const ART = [
  '..m.m..m.m....',
  '..mmmmmmmmm...',
  '..lkkkkkkkm...',
  '..lmmmmmmmd...',
  '..lmmmmmmmd...',
  '..lmmmmmmmd...',
  '..ihhiiiiii...',
  '..lmmmmmmmd...',
  '..lmmmgmmmd...',
  '..lmmgggmmd...',
  '..lmmmgmmmd...',
  '..lmmmmmmmd...',
  '..lmmmmmmmd...',
  '..ihhiiiiii...',
  '..lmmmmmmmd...',
  '..lmmmmmmmd...',
  '..lmmmmmmmd...',
  '..lmmokkomd...',
  '..lmokkkkod...',
  '..lmokkkkod...',
  '..lmokkkkod...',
  '..ddokkkkdd...',
  'olllfkkkkfllo.',
  'ofhffffffffffo',
  'ofhffffffffffo',
  'offffffffffffo',
  'offffffffffffo',
  'oddddddddddddo',
  '.oooooooooooo.',
];
function drawTower(c: CanvasRenderingContext2D) {
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const k = ART[y][x] as keyof typeof C;
    if (k === ('.' as string)) continue;
    c.fillStyle = C[k]; c.fillRect(x, y, 1, 1);
  }
}

/** The tower, standing at (x, y): its top left, in the room's dots. Click: `onClick`. */
export function Tower({ x, y, z, color, onClick }: { x: number; y: number; z: number; color: (uid: string) => string; onClick?: () => void }) {
  const rolls = useTower((s) => s.rolls);
  const ref = useRef<HTMLCanvasElement>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const c = ref.current?.getContext('2d'); if (c) drawTower(c); }, []);
  const live = rolls.filter((r) => now - r.t0 < LIFE);
  useEffect(() => {
    if (!live.length) return;
    const t = window.setInterval(() => setNow(Date.now()), 60);
    return () => window.clearInterval(t);
  }, [live.length > 0]);           // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (rolls.length) setNow(Date.now()); }, [rolls]);
  // the tower shakes while dice are inside it (a dot either way, every other frame)
  const inside = live.some((r) => now - r.t0 > 250 && now - r.t0 < 1050);
  const shake = inside ? (Math.floor(now / 70) % 2 ? 1 : 0) : 0;
  const dice: { k: string; x: number; y: number; c: string; pip: number }[] = [];
  const totals: { k: string; text: string; y: number; o: number; c: string }[] = [];
  for (const r of live) {
    const t = now - r.t0, col = color(r.by);
    for (let d = 0; d < r.dice; d++) {
      const seed = hash(`${r.id}${d}`), td = t - d * 60;
      if (td < 0) continue;
      if (td < 260) {                                            // falling in at the top
        const f = td / 260;
        dice.push({ k: `${r.id}${d}`, x: x + 4 + (d % 3) * 2, y: Math.round(y - 12 + f * 13), c: col, pip: Math.floor(td / 70) % 4 });
      } else if (td >= 1000) {                                   // out of the arch and across the tray
        const f = Math.min(1, (td - 1000) / 650);
        const tx = x + 2 + ((seed % 9) + d * 3) % 10, ty = y + 23 + ((seed >> 4) % 3);
        const sx = x + 6, sy = y + 21;
        const e = 1 - Math.pow(1 - f, 2);
        const hop = f < 1 ? Math.abs(Math.sin(f * Math.PI * 3)) * (1 - f) * 3 : 0;
        dice.push({ k: `${r.id}${d}`, x: Math.round(sx + (tx - sx) * e), y: Math.round(sy + (ty - sy) * e - hop), c: col, pip: f < 1 ? Math.floor(td / 70) % 4 : seed % 4 });
      }
    }
    if (t > 1500) {                                              // the total, rising over the tower
      const f = Math.min(1, (t - 1500) / 4000);
      totals.push({ k: r.id, text: String(r.total), y: Math.round(y - 4 - f * 6), o: t > LIFE - 1500 ? Math.max(0, (LIFE - t) / 1500) : 1, c: r.flag === 'crit' ? '#3ecf5e' : r.flag === 'fumble' ? '#ff5050' : col });
    }
  }
  return (
    <>
      <canvas ref={ref} className="dnd-tower" width={W} height={H} style={{ left: x + shake, top: y, width: W, height: H, zIndex: z }}
        title="The dice tower: roll through it (Tower, by the dice)" onClick={(e) => { e.stopPropagation(); onClick?.(); }} />
      {dice.map((d) => (
        <i key={d.k} className="dnd-die" style={{ left: d.x, top: d.y, zIndex: z + 1, background: d.c }}><b style={{ left: [0, 2, 1, 2][d.pip], top: [0, 2, 1, 0][d.pip] }} /></i>
      ))}
      {totals.map((t) => <span key={t.k} className="dnd-towertotal" style={{ left: x + 7, top: t.y - 7, zIndex: z + 2, color: t.c, opacity: t.o }}>{t.text}</span>)}
    </>
  );
}
function hash(s: string) { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; }
