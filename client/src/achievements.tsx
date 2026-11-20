// Achievements, the page's side (the server counts them: server/achievements.ts; it talks to pages through
// server/basement/trophies.ts as { t: 'fit', id: 'trophies' }).
//   the toast: bottom right, for whoever has just earned one and nobody else: its badge, its name and its line, a little
//     run of notes, six seconds each, stacking when several arrive;
//   the trophy rack: on the wall of the unfinished basement (TrophyRack, drawn by client/src/basement/unfinished.tsx).
//     Clicking it opens the trophy room in the middle of the window: a tab for everybody together (the leaderboard, the
//     latest, how rare each one is) and one for each person (every achievement, earned or not, with progress bars);
//   the badges: drawn here, dot by dot, 16 by 16: the shape and colour say the category, the rim the tier (bronze easy,
//     silver a grind, gold rare), the sign in the middle the category again. Not earned: grey. Hidden: a question mark.
import { memo, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { create } from 'zustand';
import { hooks, send, useStore } from './store';
import { chime } from './sfx';
import './achievements.css';

const ID = 'trophies';
type Cat = 'house' | 'social' | 'table' | 'gameroom' | 'yard' | 'odd' | 'lake';
type Def = { id: string; name: string; text: string; cat: Cat; tier: 1 | 2 | 3; hidden?: boolean; key?: string; goal?: number };
type Board = { defs: Def[]; got: Record<string, Record<string, number>> };
const CAT_NAMES: Record<Cat, string> = { house: 'The clubhouse', social: 'People and voice', table: 'Games and puzzles', gameroom: 'The game room', yard: 'Outside', odd: 'Odds and ends', lake: 'The lake' };
const TIER_NAMES = ['', 'Bronze', 'Silver', 'Gold'];

// ── the badges ──
const OUTLINE = '#0d0f14';
const RIM: Record<number, [string, string]> = { 1: ['#c9803f', '#f0b070'], 2: ['#aeb8cc', '#eef3ff'], 3: ['#e8b830', '#fff3a0'] };
const FILL: Record<Cat, string> = { house: '#9c3b2c', social: '#a8489a', table: '#2e8a55', gameroom: '#5a3fb0', yard: '#b8742a', odd: '#2a8a95', lake: '#2a5fb0' };
const SHAPES: Record<Cat, (dx: number, dy: number, y: number) => boolean> = {
  house: (dx, _dy, y) => y >= 1 && y <= 15 && (y <= 8 ? dx <= 6.5 : dx <= 6.5 - (y - 8) * 0.95),          // a shield
  social: (dx, dy) => dx * dx + dy * dy <= 7.4 * 7.4,                                                   // a medal
  table: (dx, dy) => dx <= 6 && dy <= 7.5 && !(dx > 5 && dy > 7),                                        // a playing card
  gameroom: (dx, dy) => dx + dy <= 8.2,                                                                  // a diamond
  yard: (dx, dy) => dx <= 7 && dy <= 7.9 - dx * 0.55,                                                    // a hexagon
  odd: (dx, dy) => dx <= 7.2 && dy <= 7.2 && dx + dy <= 10.5,                                            // an octagon
  lake: (dx, _dy, y) => (y >= 8 ? dx * dx + (y - 9) * (y - 9) <= 6.6 * 6.6 : dx <= (y + 0.5) * 0.75),  // a drop of water
};
const GLYPHS: Record<Cat | 'hidden', string[]> = {
  house: ['...#...', '..###..', '.#####.', '#######', '.##.##.', '.##.##.', '.#####.'],
  social: ['.......', '.##.##.', '#######', '#######', '.#####.', '..###..', '...#...'],
  table: ['...#...', '..###..', '.#####.', '#######', '#######', '...#...', '..###..'],
  gameroom: ['..###..', '.#####.', '##...##', '##.#.##', '##...##', '.#####.', '..###..'],
  yard: ['...#...', '..###..', '.#####.', '..###..', '.#####.', '#######', '...#...'],
  odd: ['...#...', '...#...', '#######', '.#####.', '..###..', '.##.##.', '.#...#.'],
  lake: ['.......', '..###.#', '.######', '##.####', '.######', '..###.#', '.......'],
  hidden: ['.#####.', '##...##', '....##.', '...##..', '...##..', '.......', '...##..'],
};
const badges = new Map<string, string>();
/** A badge as a picture (a data URL, made once): earned in colour, or not yet in greys; hidden ones with a question mark. */
function badge(cat: Cat, tier: number, earned: boolean, hidden: boolean): string {
  const key = `${cat}${tier}${earned ? 1 : 0}${hidden ? 1 : 0}`;
  const had = badges.get(key);
  if (had) return had;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 16;
  const g = cv.getContext('2d');
  if (!g) return '';
  const shape = SHAPES[cat] ?? SHAPES.odd;
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < 16 && y < 16 && shape(Math.abs(x - 7.5), Math.abs(y - 7.5), y);
  const edge = (x: number, y: number) => !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1);
  const [rim, shine] = earned ? RIM[tier] ?? RIM[1] : ['#4a4e5a', '#626776'];
  const fill = earned ? FILL[cat] : '#262932';
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      if (!inside(x, y)) continue;
      const outer = edge(x, y);
      const ring = !outer && [[-1, 0], [1, 0], [0, -1], [0, 1]].some(([a, b]) => inside(x + a, y + b) && edge(x + a, y + b));
      g.fillStyle = outer ? OUTLINE : ring ? (x + y < 14 ? shine : rim) : fill;
      g.fillRect(x, y, 1, 1);
    }
  }
  if (earned) { g.fillStyle = 'rgba(255,255,255,0.16)'; for (let y = 2; y < 8; y++) for (let x = 2; x < 8; x++) if (inside(x, y) && !edge(x, y) && x + y < 9) g.fillRect(x, y, 1, 1); }
  const glyph = GLYPHS[hidden && !earned ? 'hidden' : cat];
  const top = cat === 'house' ? 3 : cat === 'lake' ? 6 : 4;
  for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) {
    if (glyph[y][x] !== '#') continue;
    g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(x + 5, y + top + 1, 1, 1);           // (a drop shadow, a dot down and right)
  }
  for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) {
    if (glyph[y][x] !== '#') continue;
    g.fillStyle = earned ? '#f6f0dc' : '#5c6170'; g.fillRect(x + 4, y + top, 1, 1);
  }
  const url = cv.toDataURL();
  badges.set(key, url);
  return url;
}
const Badge = memo(function Badge({ def, earned, open, size = 48 }: { def: Def; earned: boolean; open: boolean; size?: number }) {
  return <img className="ach-badge" src={badge(def.cat, def.tier, earned, !!def.hidden && !open)} width={size} height={size} alt="" draggable={false} />;
});

// ── what the server has said ──
const useBoard = () => useStore((s) => s.fits[ID] as Board | null | undefined);
const useAch = create<{ open: boolean; tab: string; progress: Record<string, Record<string, number>>; toasts: { key: number; def: Def }[] }>(() => ({ open: false, tab: '', progress: {}, toasts: [] }));
let toastKeys = 0;
const TOAST_MS = 6000;
hooks.fit.push((d) => {
  if (d?.id !== ID) return;
  if (d.op === 'progress') useAch.setState({ progress: d.progress ?? {} });
  else if (d.op === 'got' && Array.isArray(d.defs)) {
    const fresh = (d.defs as Def[]).map((def) => ({ key: ++toastKeys, def }));
    if (!fresh.length) return;
    useAch.setState((s) => ({ toasts: [...s.toasts, ...fresh].slice(-5) }));
    chime('trophy');
    for (const t of fresh) window.setTimeout(() => useAch.setState((s) => ({ toasts: s.toasts.filter((x) => x.key !== t.key) })), TOAST_MS);
    if (useAch.getState().open) send({ t: 'fit', id: ID, op: 'load' });
  }
});
/** Opens the trophy room (on a person's tab, or everybody's). */
export function openTrophies(tab = '') {
  useAch.setState({ open: true, tab });
  send({ t: 'fit', id: ID, op: 'load' });
}

// ── the toasts ──
function Toasts() {
  const toasts = useAch((s) => s.toasts);
  if (!toasts.length) return null;
  return (
    <div className="ach-toasts" aria-live="polite">
      {toasts.map(({ key, def }) => (
        <div key={key} className={`ach-toast tier${def.tier}`} style={{ animationDuration: `0.24s, 0.3s`, animationDelay: `0s, ${TOAST_MS / 1000 - 0.3}s` }}>
          <Badge def={def} earned open size={56} />
          <div>
            <small>Achievement unlocked</small>
            <b>{def.name}</b>
            <p>{def.text}</p>
          </div>
          <i className="ach-toast-bar" style={{ animationDuration: `${TOAST_MS}ms` }} />
        </div>
      ))}
    </div>
  );
}

// ── the trophy room ──
const day = (at: number) => new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

function Trophies() {
  const open = useAch((s) => s.open);
  const tab = useAch((s) => s.tab);
  const progress = useAch((s) => s.progress);
  const board = useBoard();
  const users = useStore((s) => s.users);
  const meId = useStore((s) => s.me?.id ?? '');
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') useAch.setState({ open: false }); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [open]);
  // Who has a tab: the six (anybody who is not a guest), and a guest once they have earned something.
  const people = useMemo(() => Object.values(users)
    .filter((u) => u.role !== 'removed' && (u.role !== 'guest' || Object.keys(board?.got[u.id] ?? {}).length))
    .sort((a, b) => (a.role === 'guest' ? 1 : 0) - (b.role === 'guest' ? 1 : 0) || a.name.localeCompare(b.name)), [users, board]);
  if (!open || !board) return null;
  const close = () => useAch.setState({ open: false });
  const defs = board.defs;
  const counted = people.length || 1;
  const holders = (id: string) => people.filter((p) => board.got[p.id]?.[id]);
  const rarity = (id: string) => holders(id).length / counted;
  /** Shown in words to whoever is looking: a hidden one only once they have it themselves. */
  const seen = (d: Def) => !d.hidden || !!board.got[meId]?.[d.id];
  const person = people.find((p) => p.id === tab);
  return createPortal(
    <div className="ach-scrim" onPointerDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <section className="ach-room" role="dialog" aria-label="Trophy rack">
        <header className="ach-head">
          <h2>Trophy Rack</h2>
          <button type="button" className="ach-x" onClick={close} aria-label="Close">X</button>
        </header>
        <nav className="ach-tabs">
          <button type="button" className={!person ? 'on' : ''} onClick={() => useAch.setState({ tab: '' })}>Everyone</button>
          {people.map((p) => (
            <button type="button" key={p.id} className={person?.id === p.id ? 'on' : ''} style={{ ['--who' as string]: p.color }} onClick={() => useAch.setState({ tab: p.id })}>
              {p.name}<span>{Object.keys(board.got[p.id] ?? {}).length}</span>
            </button>
          ))}
        </nav>
        <div className="ach-body">
          {person ? <PersonTab defs={defs} got={board.got[person.id] ?? {}} counts={progress[person.id] ?? {}} rarity={rarity} seen={seen} name={person.name} /> : (
            <EveryoneTab defs={defs} board={board} people={people} rarity={rarity} holders={holders} seen={seen} />
          )}
        </div>
      </section>
    </div>,
    document.body,
  );
}

function PersonTab({ defs, got, counts, rarity, seen, name }: { defs: Def[]; got: Record<string, number>; counts: Record<string, number>; rarity: (id: string) => number; seen: (d: Def) => boolean; name: string }) {
  const n = defs.filter((d) => got[d.id]).length;
  const cats = [...new Set(defs.map((d) => d.cat))];
  return (
    <>
      <div className="ach-sum">
        <b>{name}</b> has earned <b>{n}</b> of {defs.length}
        <span className="ach-meter"><i style={{ width: `${Math.round((n / Math.max(1, defs.length)) * 100)}%` }} /></span>
        {Math.round((n / Math.max(1, defs.length)) * 100)}%
      </div>
      {cats.map((cat) => (
        <section key={cat} className="ach-cat">
          <h3>{CAT_NAMES[cat]}</h3>
          <div className="ach-grid">
            {defs.filter((d) => d.cat === cat).map((d) => {
              const at = got[d.id], open = !!at || (seen(d) && !!d.name);
              const goal = d.goal ?? 1, have = Math.min(goal, counts[d.id] ?? 0);
              return (
                <div key={d.id} className={`ach-card${at ? ' got' : ''}`}>
                  <Badge def={d} earned={!!at} open={open} />
                  <div>
                    <b>{open ? d.name : '???'}</b>
                    <p>{open ? d.text : 'Hidden until it is earned.'}</p>
                    {at ? <small>Earned {day(at)} · {TIER_NAMES[d.tier]} · {Math.round(rarity(d.id) * 100)}% have it</small>
                      : goal > 1 && open ? (
                        <span className="ach-prog"><span className="ach-meter"><i style={{ width: `${(have / goal) * 100}%` }} /></span><small>{have.toLocaleString()} / {goal.toLocaleString()}</small></span>
                      ) : <small>{TIER_NAMES[d.tier]}</small>}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </>
  );
}

function EveryoneTab({ defs, board, people, rarity, holders, seen }: { defs: Def[]; board: Board; people: { id: string; name: string; color: string }[]; rarity: (id: string) => number; holders: (id: string) => { id: string; name: string; color: string }[]; seen: (d: Def) => boolean }) {
  const byId = new Map(defs.map((d) => [d.id, d]));
  const rows = people.map((p) => {
    const mine = Object.entries(board.got[p.id] ?? {}).filter(([id]) => byId.has(id));
    const rarest = mine.map(([id]) => byId.get(id)!).sort((a, b) => rarity(a.id) - rarity(b.id) || b.tier - a.tier)[0];
    const gold = mine.filter(([id]) => byId.get(id)!.tier === 3).length;
    return { p, n: mine.length, gold, rarest, last: Math.max(0, ...mine.map(([, at]) => at)) };
  }).sort((a, b) => b.n - a.n || b.gold - a.gold || a.last - b.last);
  const latest = people.flatMap((p) => Object.entries(board.got[p.id] ?? {}).map(([id, at]) => ({ p, d: byId.get(id), at })))
    .filter((x): x is { p: (typeof people)[number]; d: Def; at: number } => !!x.d).sort((a, b) => b.at - a.at).slice(0, 8);
  const [showAll, setShowAll] = useState(false);
  const list = [...defs].sort((a, b) => rarity(a.id) - rarity(b.id) || b.tier - a.tier);
  return (
    <>
      <section className="ach-cat">
        <h3>Leaderboard</h3>
        <table className="ach-board">
          <thead><tr><th>#</th><th>Who</th><th>Earned</th><th>Gold</th><th>Rarest</th></tr></thead>
          <tbody>
            {rows.map((r, k) => (
              <tr key={r.p.id} onClick={() => useAch.setState({ tab: r.p.id })}>
                <td>{k + 1}</td>
                <td style={{ color: r.p.color }}>{r.p.name}</td>
                <td>{r.n}</td>
                <td>{r.gold}</td>
                <td>{r.rarest ? <span className="ach-inline"><Badge def={r.rarest} earned open={seen(r.rarest)} size={24} />{seen(r.rarest) ? r.rarest.name : '???'} <small>{Math.round(rarity(r.rarest.id) * 100)}%</small></span> : <small>nothing yet</small>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {!!latest.length && (
        <section className="ach-cat">
          <h3>Latest</h3>
          <ul className="ach-latest">
            {latest.map((x) => (
              <li key={`${x.p.id}:${x.d.id}`}><Badge def={x.d} earned open={seen(x.d)} size={24} /><span style={{ color: x.p.color }}>{x.p.name}</span> {seen(x.d) ? x.d.name : 'a hidden one'} <small>{day(x.at)}</small></li>
            ))}
          </ul>
        </section>
      )}
      <section className="ach-cat">
        <h3>Rarest first <button type="button" className="ach-more" onClick={() => setShowAll(!showAll)}>{showAll ? 'Fewer' : `All ${defs.length}`}</button></h3>
        <div className="ach-grid">
          {(showAll ? list : list.slice(0, 12)).map((d) => {
            const who = holders(d.id), open = seen(d) && !!d.name;
            return (
              <div key={d.id} className={`ach-card${who.length ? ' got' : ''}`}>
                <Badge def={d} earned={!!who.length} open={open} />
                <div>
                  <b>{open ? d.name : '???'}</b>
                  <p>{open ? d.text : 'Hidden until it is earned.'}</p>
                  <small>{who.length ? <>{who.map((p, k) => <span key={p.id} style={{ color: p.color }}>{k ? ', ' : ''}{p.name}</span>)} · {Math.round(rarity(d.id) * 100)}%</> : 'Nobody yet'}</small>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}

// ── the rack on the basement wall ──
/** The trophy rack, hung on the unfinished basement's back wall (room dots: `x`, `y` its top left). Its three shelves
 *  fill up with cups as the group earns achievements, gold ones first. Click: the trophy room. */
export function TrophyRack({ x, y }: { x: number; y: number }) {
  const board = useBoard();
  const W = 60, H = 56;
  const cups = useMemo(() => {
    if (!board) return [] as number[];
    const tiers = new Map(board.defs.map((d) => [d.id, d.tier]));
    return Object.values(board.got).flatMap((g) => Object.keys(g).map((id) => tiers.get(id) ?? 1)).sort((a, b) => b - a).slice(0, 12);
  }, [board]);
  const newest = useMemo(() => Math.max(0, ...Object.values(board?.got ?? {}).flatMap((g) => Object.values(g))), [board]);
  const fresh = Date.now() - newest < 10 * 60_000;
  const r = (k: string, rx: number, ry: number, w: number, h: number, fill: string) => <rect key={k} x={rx} y={ry} width={w} height={h} fill={fill} />;
  const shelves = [14, 32, 50];
  const parts: ReactNode[] = [
    r('back', 2, 2, W - 4, H - 4, '#3a2a1e'), r('backlo', 2, H - 6, W - 4, 4, '#2e2118'),
    r('l', 0, 0, 3, H, '#6e4a2c'), r('r', W - 3, 0, 3, H, '#5a3c24'), r('t', 0, 0, W, 3, '#8a5e36'), r('t2', 0, 3, W, 1, '#4a321e'),
  ];
  shelves.forEach((sy, k) => parts.push(r(`s${k}`, 1, sy, W - 2, 2, '#9a6a3c'), r(`s${k}b`, 1, sy + 2, W - 2, 1, '#2a1c12')));
  cups.forEach((tier, k) => {
    const shelf = Math.floor(k / 4), slot = k % 4, cx = 6 + slot * 13, base = shelves[shelf];
    const [c, hi] = RIM[tier] ?? RIM[1], lo = tier === 3 ? '#a87c18' : tier === 2 ? '#7a8498' : '#8a5426';
    parts.push(
      r(`c${k}a`, cx + 2, base - 11, 6, 1, hi), r(`c${k}b`, cx + 2, base - 10, 6, 4, c), r(`c${k}c`, cx + 6, base - 10, 2, 4, lo),
      r(`c${k}hl`, cx, base - 10, 2, 1, c), r(`c${k}hl2`, cx, base - 9, 1, 2, c), r(`c${k}hr`, cx + 8, base - 10, 2, 1, lo), r(`c${k}hr2`, cx + 9, base - 9, 1, 2, lo),
      r(`c${k}d`, cx + 3, base - 6, 4, 1, c), r(`c${k}e`, cx + 4, base - 5, 2, 2, lo), r(`c${k}f`, cx + 2, base - 3, 6, 1, '#2a2a2a'), r(`c${k}g`, cx + 2, base - 2, 6, 2, '#1a1a1a'),
    );
  });
  return (
    <svg className={`ach-rack${fresh ? ' fresh' : ''}`} viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{ left: x, top: y, zIndex: y + H }}
      role="button" aria-label="Trophy rack: achievements" onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); openTrophies(); }}>
      <title>Trophy rack</title>
      {parts}
      {fresh && cups.length > 0 && <rect className="ach-glint" x={6 + 2} y={shelves[0] - 11} width={1} height={1} fill="#ffffff" />}
    </svg>
  );
}

// The toasts and the trophy room are mounted once, on their own, over everything else.
if (typeof document !== 'undefined') {
  const el = document.createElement('div');
  el.id = 'ach-root';
  document.body.appendChild(el);
  createRoot(el).render(<><Toasts /><Trophies /></>);
}
