// What comes off the things from the smoking table (./smokes.ts), drawn on one canvas over the backyard: smoke curling
// up off a lit end or a pipe's bowl, the breath blown out after a drag, bubbles drifting off the wand and popping, the
// mini fan's breeze. All of it where it was let go of, in the yard: somebody walking on leaves their smoke and their
// bubbles behind them, as they would. The canvas is the yard's size in dots, drawn SCALE times finer, so a puff can be soft.

export const SCALE = 3;
type Kind = 'smoke' | 'breath' | 'glow' | 'bubble' | 'pop' | 'wind';
type P = { k: Kind; x: number; y: number; vx: number; vy: number; age: number; life: number; r: number; r1: number; a: number; seed: number; pipe?: boolean };

function blob(col: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!, gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  gr.addColorStop(0, col); gr.addColorStop(0.45, col.replace(/[\d.]+\)$/, '0.55)')); gr.addColorStop(1, col.replace(/[\d.]+\)$/, '0)'));
  g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
  return c;
}

export function makePuffs() {
  const ps: P[] = [];
  let sprites: Record<string, HTMLCanvasElement> | null = null;
  const sprite = (k: string) => {
    sprites ??= { smoke: blob('rgba(214,212,206,1)'), pipe: blob('rgba(200,208,222,1)'), glow: blob('rgba(255,150,60,1)') };
    return sprites[k];
  };
  const add = (p: Partial<P> & { k: Kind; x: number; y: number }) => {
    if (ps.length > 600) ps.shift();
    ps.push({ vx: 0, vy: 0, age: 0, life: 1, r: 1, r1: 1, a: 1, seed: Math.random() * 1000, ...p });
  };
  return {
    get count() { return ps.length; },
    /** a wisp off a lit end: thin, rising, drifting */
    wisp(x: number, y: number, pipe = false) {
      add({ k: 'smoke', x, y, vx: (Math.random() - 0.4) * 1.5, vy: -(5 + Math.random() * 3), life: 2.6 + Math.random(), r: 0.6, r1: pipe ? 3.6 : 3, a: pipe ? 0.5 : 0.42, pipe });
    },
    /** breath blown out: from the mouth, the way they face (dir -1 left, 1 right, 0 towards us) */
    breath(x: number, y: number, dir: number, pipe = false) {
      const out = dir ? dir * (9 + Math.random() * 5) : (Math.random() - 0.5) * 7;
      add({ k: 'breath', x, y, vx: out, vy: dir ? -1 - Math.random() * 2 : 2 + Math.random() * 2, life: 2 + Math.random() * 0.8, r: 0.8, r1: 4.5 + Math.random() * 1.5, a: 0.62, pipe });
    },
    /** the lit end glowing as they draw on it */
    glow(x: number, y: number) { add({ k: 'glow', x, y, life: 0.12, r: 1.6, r1: 1.6, a: 0.8 }); },
    bubble(x: number, y: number, vx: number, vy: number) {
      add({ k: 'bubble', x, y, vx, vy, life: 1.8 + Math.random() * 2.6, r: 0.4, r1: 0.9 + Math.random() * 1.5, a: 1 });
    },
    /** a streak of breeze off the fan, along (dx, dy) */
    wind(x: number, y: number, dx: number, dy: number) {
      const n = Math.hypot(dx, dy) || 1;
      add({ k: 'wind', x: x + (Math.random() - 0.5) * 2, y: y + (Math.random() - 0.5) * 2, vx: (dx / n) * 22, vy: (dy / n) * 22, life: 0.28 + Math.random() * 0.1, r: 2.2, r1: 2.2, a: 0.7 });
    },
    step(dt: number) {
      for (let i = ps.length - 1; i >= 0; i--) {
        const p = ps[i];
        p.age += dt;
        if (p.age >= p.life) {
          if (p.k === 'bubble') add({ k: 'pop', x: p.x, y: p.y, life: 0.2, r: p.r1, r1: p.r1 * 1.8, a: 0.9 });
          ps.splice(i, 1);
          continue;
        }
        const t = p.age / p.life;
        if (p.k === 'smoke') { p.vx += Math.sin(p.age * 2.4 + p.seed) * 3 * dt; p.vy *= 1 - 0.15 * dt; }
        if (p.k === 'breath') { p.vx *= 1 - 1.6 * dt; p.vy += (-6 - p.vy) * 1.4 * dt; }       // blown out, slowing, then rising off
        if (p.k === 'bubble') { p.vx *= 1 - 0.6 * dt; p.vy += (-2.2 - p.vy) * 0.8 * dt; p.vx += Math.sin(p.age * 3 + p.seed) * 2.5 * dt; }
        if (p.k === 'wind') { p.vx *= 1 - 2 * dt; p.vy *= 1 - 2 * dt; }
        p.x += p.vx * dt; p.y += p.vy * dt;
        if (p.k === 'bubble' && t < 0.15) p.r = p.r1 * Math.min(1, 0.4 + t * 4);
        else if (p.k === 'bubble') p.r = p.r1;
      }
    },
    draw(ctx: CanvasRenderingContext2D) {
      const S = SCALE;
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      for (const p of ps) {
        const t = p.age / p.life;
        if (p.k === 'smoke' || p.k === 'breath') {
          const r = (p.r + (p.r1 - p.r) * Math.sqrt(t)) * S;
          ctx.globalAlpha = p.a * (t < 0.12 ? t / 0.12 : 1) * (1 - t) * (1 - t * 0.3);
          ctx.drawImage(sprite(p.pipe ? 'pipe' : 'smoke'), p.x * S - r, p.y * S - r, r * 2, r * 2);
        } else if (p.k === 'glow') {
          ctx.globalAlpha = p.a * (1 - t);
          ctx.globalCompositeOperation = 'lighter';
          ctx.drawImage(sprite('glow'), p.x * S - p.r * S, p.y * S - p.r * S, p.r * S * 2, p.r * S * 2);
          ctx.globalCompositeOperation = 'source-over';
        } else if (p.k === 'bubble') {
          const r = p.r * S, x = p.x * S, y = p.y * S, hue = (p.seed + p.age * 90) % 360;
          ctx.globalAlpha = t > 0.85 ? (1 - t) / 0.15 * 0.9 + 0.1 : 1;
          ctx.fillStyle = `hsla(${hue}, 90%, 85%, 0.12)`;
          ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
          ctx.lineWidth = 0.9;
          ctx.strokeStyle = `hsla(${hue}, 85%, 88%, 0.85)`;
          ctx.stroke();
          ctx.strokeStyle = `hsla(${(hue + 140) % 360}, 90%, 80%, 0.55)`;
          ctx.beginPath(); ctx.arc(x, y, r * 0.8, 0.4, 1.9); ctx.stroke();
          ctx.fillStyle = 'rgba(255,255,255,0.95)';
          ctx.fillRect(Math.round(x - r * 0.45), Math.round(y - r * 0.5), 1.5, 1.5);
        } else if (p.k === 'pop') {
          const r = (p.r + (p.r1 - p.r) * t) * S;
          ctx.globalAlpha = p.a * (1 - t);
          ctx.fillStyle = 'rgba(240,250,255,1)';
          for (let j = 0; j < 6; j++) { const an = j * 1.047 + p.seed; ctx.fillRect(p.x * S + Math.cos(an) * r - 0.75, p.y * S + Math.sin(an) * r - 0.75, 1.5, 1.5); }
        } else if (p.k === 'wind') {
          const n = Math.hypot(p.vx, p.vy) || 1, l = p.r * S;
          ctx.globalAlpha = p.a * Math.sin(Math.PI * t);
          ctx.strokeStyle = 'rgba(235,248,255,1)';
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(p.x * S, p.y * S); ctx.lineTo(p.x * S - (p.vx / n) * l, p.y * S - (p.vy / n) * l); ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    },
  };
}
