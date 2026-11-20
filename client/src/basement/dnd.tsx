// The DnD room's tabletop, on the page: a panel beside the room (server/basement/dnd.ts keeps it all; scripts/basement/
// dnd.py draws the room and the three battle maps). In the room, the map lies on the table with everybody's token on it.
//
// The panel: the map at the top (drag a token to move it, drag the map to look about, the wheel to zoom; the ruler measures
// in five-foot squares and everybody sees it; a ping shows everybody where), and under it the dice and their log, the
// initiative tracker, and character sheets (anything with a modifier on a sheet can be clicked to roll it).
//
// Parts of it live in ./dnd/: the initiative board on the wall and the tracker (tracker.tsx), the dice tower on the table
// (tower.tsx) and the drawing on the map (ink.tsx).
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode, WheelEvent as ReactWheelEvent } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { upload } from '../api';
import { Modal, SureButton } from '../components/ui';
import { hooks, send, toast, useStore } from '../store';
import { personColor } from '../sprites';
import { INKS, InkCanvas, WIDTHS, clearInk, clearMyInk, eraseAt, listenInk, penDown, penMove, penUp, undoInk, useInk } from './dnd/ink';
import { Tower, towerRoll } from './dnd/tower';
import { Tracker, WallBoard } from './dnd/tracker';
import type { Init, TrackerApi } from './dnd/tracker';
import './dnd/dnd.css';
import type { FitProps } from './index';
import { useGameSpot } from './spots';
import { pageRect } from '../device';

const ID = 'dnd';
type Token = { id: string; name: string; img: string; color: string; x: number; y: number; size: number; hp: number; maxHp: number; ac: number; hidden: boolean; owner: string; sheet: string };
type MapRec = { url: string; name: string; cols: number };
type St = { dm: string; map: MapRec | null; tokens: Token[]; init: { round: number; turn: number; list: Init[] }; maps: MapRec[]; inkAll?: boolean };
type Entry = { id: string; by: string; label: string; expr: string; detail: string; total: number; at: number; flag: '' | 'crit' | 'fumble'; secret: boolean; tower?: boolean };
const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;
type Ab = (typeof ABILITIES)[number];
const AB_NAME: Record<Ab, string> = { str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' };
const SKILLS: [string, Ab][] = [
  ['Acrobatics', 'dex'], ['Animal Handling', 'wis'], ['Arcana', 'int'], ['Athletics', 'str'], ['Deception', 'cha'], ['History', 'int'],
  ['Insight', 'wis'], ['Intimidation', 'cha'], ['Investigation', 'int'], ['Medicine', 'wis'], ['Nature', 'int'], ['Perception', 'wis'],
  ['Performance', 'cha'], ['Persuasion', 'cha'], ['Religion', 'int'], ['Sleight of Hand', 'dex'], ['Stealth', 'dex'], ['Survival', 'wis'],
];
type Attack = { name: string; bonus: number; damage: string };
type Sheet = {
  id: string; owner: string; name: string; cls: string; level: number; race: string; background: string; alignment: string; img: string;
  abilities: Record<Ab, number>; saves: Ab[]; skills: Record<string, number>;
  ac: number; speed: number; hp: number; maxHp: number; tempHp: number; hitDice: string;
  attacks: Attack[]; spellAbility: '' | Ab; slots: number[]; used: number[];
  spells: string; features: string; inventory: string; coins: Record<'cp' | 'sp' | 'ep' | 'gp' | 'pp', number>; notes: string;
};
const blankSheet = (): Sheet => ({
  id: '', owner: '', name: 'New character', cls: 'Fighter', level: 1, race: 'Human', background: '', alignment: '', img: '',
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, saves: [], skills: {},
  ac: 10, speed: 30, hp: 10, maxHp: 10, tempHp: 0, hitDice: '1d10', attacks: [], spellAbility: '', slots: Array(9).fill(0), used: Array(9).fill(0),
  spells: '', features: '', inventory: '', coins: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 }, notes: '',
});
const mod = (score: number) => Math.floor((score - 10) / 2);
const prof = (level: number) => 2 + Math.floor((Math.max(1, level) - 1) / 4);
const signed = (n: number) => (n >= 0 ? `+${n}` : String(n));

// ── what the page knows of the table ──
type Local = {
  st: St | null; log: Entry[]; sheets: Record<string, Sheet>; seeded: unknown;
  measures: Record<string, { a: number[]; b: number[]; at: number }>; pings: { id: number; by: string; x: number; y: number }[];
  tab: 'dice' | 'init' | 'sheets'; sheet: string; token: string; tool: 'move' | 'ruler' | 'ping' | 'draw' | 'erase'; collapsed: boolean; adv: '' | 'adv' | 'dis'; secret: boolean;
  /** rolls go through the dice tower; board: the initiative board open large */
  tower: boolean; board: boolean;
};
const useDnd = create<Local>()(() => ({ st: null, log: [], sheets: {}, seeded: null, measures: {}, pings: [], tab: 'dice', sheet: '', token: '', tool: 'move', collapsed: false, adv: '', secret: false, tower: false, board: false }));
let listening = false;
let pingIds = 0;
function listen() {
  if (listening) return;
  listening = true;
  listenInk();
  const seed = () => {
    const h = useStore.getState().fits[ID] as { st: St; log: Entry[]; sheets: Record<string, Sheet> } | undefined;
    if (!h || h === useDnd.getState().seeded) return;
    useDnd.setState({ seeded: h, st: h.st, log: h.log ?? [], sheets: h.sheets ?? {} });
  };
  seed();
  useStore.subscribe(seed);
  hooks.fit.push((d) => {
    if (d.id !== ID) return;
    const s = useDnd.getState();
    if (d.op === 'st') useDnd.setState({ st: d.st });
    else if (d.op === 'log') {
      useDnd.setState({ log: [...s.log.filter((e) => e.id !== d.entry.id), d.entry].slice(-150) });
      if (d.entry.tower) towerRoll(d.entry);
    }
    else if (d.op === 'clearlog') useDnd.setState({ log: [] });
    else if (d.op === 'sheet') useDnd.setState({ sheets: { ...s.sheets, [d.sheet.id]: d.sheet } });
    else if (d.op === 'unsheet') { const next = { ...s.sheets }; delete next[d.oid]; useDnd.setState({ sheets: next, sheet: s.sheet === d.oid ? '' : s.sheet }); }
    else if (d.op === 'measure') {
      const m = { ...s.measures };
      if (d.a && d.b) m[d.by] = { a: d.a, b: d.b, at: Date.now() }; else delete m[d.by];
      useDnd.setState({ measures: m });
    } else if (d.op === 'ping') {
      const p = { id: ++pingIds, by: String(d.by), x: Number(d.x), y: Number(d.y) };
      useDnd.setState({ pings: [...s.pings, p] });
      window.setTimeout(() => useDnd.setState((q) => ({ pings: q.pings.filter((x) => x !== p) })), 1600);
    } else if (d.op === 'bad') toast(String(d.text));
  });
}
/** To the table. A thing's own id (a token's, a sheet's, a row's) goes as `oid`: `id` is the fit-out's, which says where
 *  the message goes (sent as `id`, it had sent token moves, removals and row edits nowhere). */
const act = (op: string, rest: Record<string, unknown> = {}) => { const { id, ...more } = rest; send({ ...more, ...(id === undefined ? {} : { oid: id }), t: 'fit', id: ID, op }); };
const user = (id: string) => useStore.getState().users[id];
const nameOf = (id: string) => user(id)?.name ?? 'Somebody';
const colorOf = (id: string) => { const u = user(id); return u ? personColor(u) : '#aaaaaa'; };
/** Roll dice for everybody to see (advantage or disadvantage turns a lone d20 into two). */
function roll(expr: string, label = '') {
  const { adv, secret, tower } = useDnd.getState();
  const e = adv && /^1?d20\b/i.test(expr.trim()) ? expr.trim().replace(/^1?d20/i, adv === 'adv' ? '2d20kh1' : '2d20kl1') : expr;
  act('roll', { expr: e, label: label + (e !== expr ? (adv === 'adv' ? ' (advantage)' : ' (disadvantage)') : ''), secret, tower });
}
const trackerApi = (me: string): TrackerApi => ({ me, act, colorOf });
/** May I draw on the map (the DM, anybody with nobody in the chair, or everybody when the DM lets them)? */
const mayDraw = (st: St | null, me: string) => !st?.dm || st.dm === me || !!st.inkAll;
const mayEdit = (owner: string) => { const st = useDnd.getState().st, me = useStore.getState().me?.id ?? ''; return !st?.dm || st.dm === me || owner === me; };

// ───────────────────────── in the room ─────────────────────────

type Flame = { x: number; y: number; w: number; h: number; kind: 'hearth' | 'torch' };
const FIRE = ['', '#5a0e04', '#8a1a06', '#b02a08', '#d04010', '#e05a10', '#f07818', '#f89420', '#ffb030', '#ffc848', '#ffd860', '#ffe888', '#fff4b0', '#fffbe0'];

/** A fire, drawn dot by dot and never the same twice: heat rises from the bottom row, drifting and cooling as it goes
 *  (the hearth spreads it across the logs; a torch keeps it to a tongue over its head). About twelve times a second. */
function Fire({ f }: { f: Flame }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current?.getContext('2d');
    if (!c) return;
    const { w, h } = f, top = FIRE.length - 1;
    const heat = new Uint8Array(w * h);
    const img = c.createImageData(w, h);
    const rgb = FIRE.map((col) => (col ? [parseInt(col.slice(1, 3), 16), parseInt(col.slice(3, 5), 16), parseInt(col.slice(5, 7), 16)] : null));
    const tick = () => {
      for (let x = 0; x < w; x++) {                                        // the source: hottest in the middle
        const mid = 1 - Math.abs(x - (w - 1) / 2) / (w / 2);
        heat[(h - 1) * w + x] = f.kind === 'torch' ? (mid > 0.45 ? top - (Math.random() < 0.3 ? 2 : 0) : 0) : Math.max(0, Math.round(top * (0.55 + 0.45 * mid) - Math.random() * 4));
      }
      for (let y = 1; y < h; y++) for (let x = 0; x < w; x++) {
        const v = heat[y * w + x];
        const drift = Math.round(Math.random() * 2 - 1), to = (y - 1) * w + Math.min(w - 1, Math.max(0, x + drift));
        heat[to] = Math.max(0, v - (Math.random() < (f.kind === 'torch' ? 0.62 : 0.45) ? 1 : 0) - (Math.random() < 0.12 ? 1 : 0));
      }
      for (let i = 0; i < w * h; i++) {
        const col = rgb[heat[i]];
        img.data[i * 4 + 3] = col ? 255 : 0;
        if (col) { img.data[i * 4] = col[0]; img.data[i * 4 + 1] = col[1]; img.data[i * 4 + 2] = col[2]; }
      }
      c.putImageData(img, 0, 0);
    };
    tick();
    const t = window.setInterval(tick, 80);
    return () => window.clearInterval(t);
  }, [f]);
  return <canvas ref={ref} className="fit-fire" width={f.w} height={f.h} style={{ left: f.x, top: f.y, width: f.w, height: f.h, zIndex: 2 }} aria-hidden />;
}

export function Room({ layout, mini }: FitProps) {
  listen();
  const flames = (layout.things.flames as Flame[] | undefined) ?? [];
  const st = useDnd((s) => s.st);
  const board = useDnd((s) => s.board);
  const me = useStore((s) => s.me?.id ?? '');
  // taking the DM's chair walks me to it, at the head of the table (./spots); the players sit round it as they come in
  useGameSpot(layout, mini, st?.dm === me && me ? 'dnd-dm' : null, layout.things.dmSeat as number | undefined);
  const [size, setSize] = useState<[number, number] | null>(null);
  const t = layout.things.table as number[];
  const map = st?.map;
  const sq = size && map ? size[0] / map.cols : 0;
  // the map, fitted into the table's parchment
  const k = size ? Math.min(t[2] / size[0], t[3] / size[1]) : 1;
  const w = size ? size[0] * k : t[2], h = size ? size[1] * k : t[3];
  return (
    <>
    {flames.map((f, k) => <Fire key={k} f={f} />)}
    <WallBoard st={st} api={trackerApi(me)} at={BOARD} z={2} onOpen={mini ? undefined : () => useDnd.setState({ board: true })} />
    <Tower x={t[0] - 1} y={t[1] - 10} z={((layout.things.tableZ as number | undefined) ?? 3) + 1} color={colorOf}
      onClick={mini ? undefined : () => useDnd.setState({ tower: true, tab: 'dice', collapsed: false })} />
    {board && !mini && st && createPortal(
      <Modal title={`Initiative · round ${st.init.round}`} onClose={() => useDnd.setState({ board: false })} wide>
        <div className="modal-body"><Tracker st={st} api={trackerApi(me)} big /></div>
      </Modal>, document.body)}
    <div className="dnd-table" style={{ left: t[0] + (t[2] - w) / 2, top: t[1] + (t[3] - h) / 2, width: w, height: h, zIndex: (layout.things.tableZ as number | undefined) ?? 3 }}
      title="The war table: the map is in the panel beside the room" onClick={(e) => { e.stopPropagation(); useDnd.setState({ collapsed: false }); }}>
      {map && <img src={map.url} alt="" draggable={false} onLoad={(e) => setSize([e.currentTarget.naturalWidth, e.currentTarget.naturalHeight])} />}
      {map && size && sq > 0 && <InkCanvas mapKey={map.url} w={size[0]} h={size[1]} sq={sq} className="dnd-tableink" />}
      {sq > 0 && st!.tokens.filter((x) => !x.hidden || st!.dm === me).map((x) => (
        <i key={x.id} style={{ left: x.x * sq * k, top: x.y * sq * k, width: Math.max(2, x.size * sq * k), height: Math.max(2, x.size * sq * k), background: x.color }} />
      ))}
    </div>
    </>
  );
}

/** The initiative board on the wall, under the right-hand banner, by the DM's end of the table: [x, y, width, height]. */
const BOARD = [141, 62, 31, 33];

// ───────────────────────── the panel ─────────────────────────

export function Side() {
  listen();
  const collapsed = useDnd((s) => s.collapsed);
  const st = useDnd((s) => s.st);
  const tab = useDnd((s) => s.tab);
  const me = useStore((s) => s.me?.id ?? '');
  // (the war table takes 70% of the width; the room, a small chamber, the rest)
  if (collapsed) return <aside className="fit-side" style={{ flex: '0 0 34px' }}><div className="dnd-panel min"><button title="Open the war table" onClick={() => useDnd.setState({ collapsed: false })}>◀</button><span>War table</span></div></aside>;
  const dm = st?.dm ?? '';
  return (
    <aside className="fit-side" style={{ flex: '0 0 70%' }}>
    <div className="dnd-panel">
      <header className="dnd-head">
        <b>War table</b>
        <span className="dnd-dm">{dm ? (dm === me ? 'You are the DM' : `${nameOf(dm)} is the DM`) : 'No DM: anybody can do anything'}</span>
        {!dm && <button onClick={() => act('dm', { take: true })}>Take the DM's chair</button>}
        {dm === me && <button onClick={() => act('dm', { take: false })}>Leave the chair</button>}
        <button title="Fold the panel away" onClick={() => useDnd.setState({ collapsed: true })}>▶</button>
      </header>
      <MapView />
      <nav className="dnd-tabs">
        {(['dice', 'init', 'sheets'] as const).map((k) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => useDnd.setState({ tab: k })}>{k === 'dice' ? 'Dice' : k === 'init' ? `Initiative${st?.init.list.length ? ` · round ${st.init.round}` : ''}` : 'Sheets'}</button>)}
      </nav>
      <div className="dnd-pane">{tab === 'dice' ? <Dice /> : tab === 'init' ? <Initiative /> : <Sheets />}</div>
    </div>
    </aside>
  );
}

// ── the map ──
function MapView() {
  const st = useDnd((s) => s.st);
  const want = useDnd((s) => s.tool);
  const inkC = useInk((s) => s.c);
  const inkW = useInk((s) => s.w);
  const sel = useDnd((s) => s.token);
  const measures = useDnd((s) => s.measures);
  const pings = useDnd((s) => s.pings);
  const me = useStore((s) => s.me?.id ?? '');
  const box = useRef<HTMLDivElement>(null);
  const [nat, setNat] = useState<[number, number]>([768, 528]);
  const [view, setView] = useState({ x: 0, y: 0, z: 1 });
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null);
  const [ruler, setRuler] = useState<{ a: number[]; b: number[] } | null>(null);
  const action = useRef<{ kind: 'pan' | 'token' | 'ruler' | 'draw' | 'erase'; sx: number; sy: number; vx: number; vy: number; id?: string; ox?: number; oy?: number; moved?: boolean; lastSent?: number } | null>(null);
  const map = st?.map ?? null;
  const sq = map ? nat[0] / map.cols : 24;
  const isDm = !!st && st.dm === me;
  const canDraw = mayDraw(st, me), boss = !st?.dm || isDm;
  const tool = (want === 'draw' || want === 'erase') && !canDraw ? 'move' : want;      // (the DM stopped the players drawing)
  const inkKey = map?.url ?? '';
  const fit = () => { const el = box.current; if (!el) return; const z = Math.min(el.clientWidth / nat[0], el.clientHeight / nat[1]); setView({ z, x: (el.clientWidth - nat[0] * z) / 2, y: (el.clientHeight - nat[1] * z) / 2 }); };
  useEffect(() => { fit(); }, [nat[0], nat[1]]);              // eslint-disable-line react-hooks/exhaustive-deps
  // the map closed (or me taken out of the room) in the middle of a line: the line ends there, and its sending stops
  useEffect(() => () => { if (action.current?.kind === 'draw') penUp(); }, []);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => fit());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);                                                       // eslint-disable-line react-hooks/exhaustive-deps
  /** A point on screen, in squares on the map. */
  const toSq = (cx: number, cy: number) => { const r = pageRect(box.current!); return [(cx - r.left - view.x) / view.z / sq, (cy - r.top - view.y) / view.z / sq]; };
  const wheel = (e: ReactWheelEvent) => {
    const r = pageRect(box.current!), px = e.clientX - r.left, py = e.clientY - r.top;
    const z = Math.max(0.15, Math.min(6, view.z * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
    setView({ z, x: px - ((px - view.x) * z) / view.z, y: py - ((py - view.y) * z) / view.z });
  };
  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* (still works inside) */ }
    const [x, y] = toSq(e.clientX, e.clientY);
    const tokenEl = (e.target as HTMLElement).closest<HTMLElement>('[data-token]');
    if (tool === 'ping' || e.altKey) { act('ping', { x, y }); return; }
    if (tool === 'ruler') { action.current = { kind: 'ruler', sx: x, sy: y, vx: 0, vy: 0 }; setRuler({ a: [x, y], b: [x, y] }); return; }
    if (tool === 'draw') { action.current = { kind: 'draw', sx: x, sy: y, vx: 0, vy: 0 }; penDown(inkKey, x, y); return; }
    if (tool === 'erase') { action.current = { kind: 'erase', sx: x, sy: y, vx: 0, vy: 0, lastSent: Date.now() }; eraseAt(inkKey, x, y, boss); return; }
    if (tokenEl) {
      const t = st?.tokens.find((q) => q.id === tokenEl.dataset.token);
      if (t) { useDnd.setState({ token: t.id }); if (mayEdit(t.owner)) { action.current = { kind: 'token', sx: x, sy: y, vx: 0, vy: 0, id: t.id, ox: t.x, oy: t.y }; } return; }
    }
    useDnd.setState({ token: '' });
    action.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
  };
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    const a = action.current;
    if (!a) return;
    if (a.kind === 'pan') setView((v) => ({ ...v, x: a.vx + e.clientX - a.sx, y: a.vy + e.clientY - a.sy }));
    else {
      const [x, y] = toSq(e.clientX, e.clientY);
      if (a.kind === 'draw') { penMove(x, y); return; }
      if (a.kind === 'erase') { if (Date.now() - (a.lastSent ?? 0) > 90) { a.lastSent = Date.now(); eraseAt(inkKey, x, y, boss); } return; }
      if (a.kind === 'token') { a.moved = a.moved || Math.hypot(x - a.sx, y - a.sy) > 0.3; setDrag({ id: a.id!, x: a.ox! + x - a.sx, y: a.oy! + y - a.sy }); }
      else {
        setRuler({ a: [a.sx, a.sy], b: [x, y] });
        if (!a.lastSent || Date.now() - a.lastSent > 120) { a.lastSent = Date.now(); act('measure', { a: [a.sx, a.sy], b: [x, y] }); }
      }
    }
  };
  const up = () => {
    const a = action.current;
    action.current = null;
    if (a?.kind === 'draw') penUp();
    if (a?.kind === 'token' && a.moved && drag) act('move', { id: a.id, x: Math.round(drag.x), y: Math.round(drag.y) });
    if (a?.kind === 'ruler') { setRuler(null); act('measure', { a: null, b: null }); }
    setDrag(null);
  };
  const lines = [...(ruler ? [{ by: me, ...ruler }] : []), ...Object.entries(measures).filter(([by, m]) => by !== me && Date.now() - m.at < 5000).map(([by, m]) => ({ by, a: m.a, b: m.b }))];
  const feet = (a: number[], b: number[]) => Math.round(Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]))) * 5;
  const pickMap = async (file: File) => {
    try {
      const f = await upload(file, 'attachment');
      if (!f.mime.startsWith('image/')) return toast('That is not a picture.');
      act('map', { url: f.url, name: file.name.replace(/\.[^.]+$/, '').slice(0, 60), cols: 30 });
    } catch (err) { toast((err as Error).message); }
  };
  const mapBusy = !!st?.dm && !isDm;
  return (
    <div className="dnd-map-wrap">
      <div className="dnd-tools">
        {(['move', 'ruler', 'ping'] as const).map((k) => <button key={k} className={tool === k ? 'on' : ''} onClick={() => useDnd.setState({ tool: k })} title={k === 'move' ? 'Move tokens, drag the map' : k === 'ruler' ? 'Measure (everybody sees it)' : 'Ping a spot (or Alt+click)'}>{k === 'move' ? 'Move' : k === 'ruler' ? 'Ruler' : 'Ping'}</button>)}
        {canDraw && (['draw', 'erase'] as const).map((k) => <button key={k} className={tool === k ? 'on' : ''} onClick={() => useDnd.setState({ tool: k })} title={k === 'draw' ? 'Draw on the map (everybody sees it)' : 'Rub out lines on the map'}>{k === 'draw' ? 'Draw' : 'Eraser'}</button>)}
        <button onClick={fit} title="Fit the map to the panel">Fit</button>
        <span className="gap" />
        <button onClick={() => act('token', { token: { name: nameOf(me), color: colorOf(me), x: Math.round(map ? map.cols / 2 : 5), y: 2, size: 1 } })}>+ Token</button>
        {!mapBusy && (
          <select value={map?.url ?? ''} onChange={(e) => { const m = st?.maps.find((q) => q.url === e.target.value); if (m) act('map', m); else if (e.target.value === '') act('map', { url: null }); }}>
            <option value="">(no map)</option>
            {st?.maps.map((m) => <option key={m.url} value={m.url}>{m.name}</option>)}
          </select>
        )}
        {!mapBusy && map && <SureButton className="danger" ask="Remove it?" onSure={() => { act('map', { url: null }); act('unmap', { url: map.url }); }} title="Take this map off the table and out of the list (its drawing goes with it)">Remove map</SureButton>}
        {!mapBusy && <label className="dnd-btn">Upload map<input type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void pickMap(f); }} /></label>}
        {!mapBusy && map && <label className="dnd-cols" title="How many squares across the map is: lines the grid up with the picture">Squares <input type="number" min={4} max={120} value={map.cols} onChange={(e) => act('map', { ...map, cols: Number(e.target.value) })} /></label>}
      </div>
      {(tool === 'draw' || tool === 'erase' || isDm) && (
        <div className="dnd-tools dnd-inkbar">
          {canDraw && <>
            {INKS.map(([c, n], k) => <button key={c} className={`ink${inkC === k && tool === 'draw' ? ' on' : ''}`} title={n} style={{ background: c }} onClick={() => { useInk.setState({ c: k }); useDnd.setState({ tool: 'draw' }); }} />)}
            {WIDTHS.map(([, n], k) => <button key={n} className={inkW === k ? 'on' : ''} onClick={() => { useInk.setState({ w: k }); useDnd.setState({ tool: 'draw' }); }}>{n}</button>)}
            <button onClick={undoInk} title="Take back your last line">Undo</button>
          </>}
          <span className="gap" />
          {isDm && <button className={st?.inkAll ? 'on' : ''} onClick={() => act('inkall', { on: !st?.inkAll })} title="Let the players draw on the map too">Players draw{st?.inkAll ? ': on' : ': off'}</button>}
          {boss ? <SureButton className="danger" onSure={clearInk} title="Rub out the whole drawing on this map">Clear drawing</SureButton>
            : canDraw && <SureButton className="danger" onSure={clearMyInk} title="Rub out every line you drew on this map">Clear my lines</SureButton>}
        </div>
      )}
      <div ref={box} className={`dnd-map tool-${tool}`} onWheel={wheel} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        <div className="dnd-world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})`, width: nat[0], height: nat[1] }}>
          {map ? <img src={map.url} alt="" draggable={false} onLoad={(e) => setNat([e.currentTarget.naturalWidth, e.currentTarget.naturalHeight])} /> : <div className="dnd-blank" />}
          <div className="dnd-grid" style={{ backgroundSize: `${sq}px ${sq}px` }} />
          <InkCanvas mapKey={inkKey} w={nat[0]} h={nat[1]} sq={sq} />
          {st?.tokens.filter((t) => !t.hidden || isDm || !st.dm).map((t) => {
            const at = drag?.id === t.id ? drag : t;
            const style: CSSProperties = { left: at.x * sq, top: at.y * sq, width: t.size * sq, height: t.size * sq, borderColor: t.color, background: t.img ? `center / cover url(${t.img})` : t.color, opacity: t.hidden ? 0.45 : 1 };
            return (
              <div key={t.id} data-token={t.id} className={`dnd-token${sel === t.id ? ' sel' : ''}`} style={style} title={`${t.name}${t.maxHp ? ` · ${t.hp}/${t.maxHp} HP` : ''}${t.ac ? ` · AC ${t.ac}` : ''}`}>
                {!t.img && <span style={{ fontSize: sq * 0.42 * Math.min(2, t.size) }}>{t.name.slice(0, 2)}</span>}
                {t.maxHp > 0 && mayEdit(t.owner) && <i className="hp" style={{ width: `${Math.max(0, Math.min(1, t.hp / t.maxHp)) * 100}%` }} />}
              </div>
            );
          })}
          <svg className="dnd-over" width={nat[0]} height={nat[1]}>
            {lines.map((l, k) => (
              <g key={k}>
                <line x1={(l.a[0]) * sq} y1={(l.a[1]) * sq} x2={(l.b[0]) * sq} y2={(l.b[1]) * sq} stroke={colorOf(l.by)} strokeWidth={4 / view.z} strokeDasharray={`${10 / view.z} ${6 / view.z}`} />
                <text x={l.b[0] * sq + 8 / view.z} y={l.b[1] * sq - 8 / view.z} fontSize={18 / view.z} fill="#fff" stroke="#000" strokeWidth={4 / view.z} paintOrder="stroke">{feet(l.a, l.b)} ft</text>
              </g>
            ))}
            {pings.map((p) => <circle key={p.id} className="dnd-ping" cx={p.x * sq} cy={p.y * sq} r={sq} stroke={colorOf(p.by)} strokeWidth={4 / view.z} fill="none" />)}
          </svg>
        </div>
      </div>
      {sel && st?.tokens.some((t) => t.id === sel) && <TokenEditor token={st.tokens.find((t) => t.id === sel)!} isDm={isDm} dmSet={!!st.dm} />}
    </div>
  );
}

function TokenEditor({ token, isDm, dmSet }: { token: Token; isDm: boolean; dmSet: boolean }) {
  const sheets = useDnd((s) => s.sheets);
  const can = mayEdit(token.owner);
  const [t, setT] = useState(token);
  useEffect(() => setT(token), [token]);
  const save = (patch: Partial<Token>) => { const next = { ...t, ...patch }; setT(next); act('token', { token: next }); };
  const pic = async (file: File) => { try { const f = await upload(file, 'attachment'); if (f.mime.startsWith('image/')) save({ img: f.url }); else toast('That is not a picture.'); } catch (e) { toast((e as Error).message); } };
  if (!can) return <div className="dnd-tokened"><b>{t.name}</b>{t.maxHp > 0 && <span>{t.hp}/{t.maxHp} HP</span>}{t.ac > 0 && <span>AC {t.ac}</span>}<span className="muted">{nameOf(t.owner)}'s</span></div>;
  return (
    <div className="dnd-tokened">
      <input className="name" value={t.name} onChange={(e) => setT({ ...t, name: e.target.value })} onBlur={() => save({})} />
      <label>HP <input type="number" value={t.hp} onChange={(e) => save({ hp: Number(e.target.value) })} /> / <input type="number" value={t.maxHp} onChange={(e) => save({ maxHp: Number(e.target.value) })} /></label>
      <label>AC <input type="number" value={t.ac} onChange={(e) => save({ ac: Number(e.target.value) })} /></label>
      <label>Size <select value={t.size} onChange={(e) => save({ size: Number(e.target.value) })}>{[1, 2, 3, 4].map((n) => <option key={n} value={n}>{['Medium', 'Large', 'Huge', 'Gargantuan'][n - 1]}</option>)}</select></label>
      <input type="color" value={t.color} onChange={(e) => save({ color: e.target.value })} title="Colour" />
      <label className="dnd-btn">Picture<input type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void pic(f); }} /></label>
      {t.img && <button onClick={() => save({ img: '' })}>No picture</button>}
      <label>Sheet <select value={t.sheet} onChange={(e) => save({ sheet: e.target.value })}><option value="">(none)</option>{Object.values(sheets).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      {(isDm || !dmSet) && <label><input type="checkbox" checked={t.hidden} onChange={(e) => save({ hidden: e.target.checked })} /> Hidden</label>}
      <button onClick={() => act('init', { act: 'add', token: t.id, roll: true, bonus: t.sheet && sheets[t.sheet] ? mod(sheets[t.sheet].abilities.dex) : 0 })}>Roll initiative</button>
      <button className="danger" onClick={() => { act('untoken', { id: t.id }); useDnd.setState({ token: '' }); }}>Remove</button>
    </div>
  );
}

// ── dice ──
function Dice() {
  const log = useDnd((s) => s.log);
  const adv = useDnd((s) => s.adv);
  const secret = useDnd((s) => s.secret);
  const tower = useDnd((s) => s.tower);
  const [expr, setExpr] = useState('1d20');
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [log.length]);
  return (
    <div className="dnd-dice">
      <div className="dnd-dicebar">
        {[4, 6, 8, 10, 12, 20, 100].map((n) => <button key={n} onClick={() => roll(`1d${n}`)}>d{n}</button>)}
        <form onSubmit={(e) => { e.preventDefault(); if (expr.trim()) roll(expr.trim()); }}>
          <input value={expr} onChange={(e) => setExpr(e.target.value)} placeholder="2d6+3, 4d6kh3, d%" />
          <button type="submit">Roll</button>
        </form>
        <button className={adv === 'adv' ? 'on' : ''} onClick={() => useDnd.setState({ adv: adv === 'adv' ? '' : 'adv' })} title="Roll d20s twice and keep the higher">Adv</button>
        <button className={adv === 'dis' ? 'on' : ''} onClick={() => useDnd.setState({ adv: adv === 'dis' ? '' : 'dis' })} title="Roll d20s twice and keep the lower">Dis</button>
        <label title="Only you and the DM see it"><input type="checkbox" checked={secret} onChange={(e) => useDnd.setState({ secret: e.target.checked })} /> Secret</label>
        <button className={tower ? 'on' : ''} onClick={() => useDnd.setState({ tower: !tower })} title="Send the dice down the tower on the table: everybody in the room sees them tumble and hears them rattle">Tower</button>
        {log.length > 0 && <SureButton className="danger" onSure={() => act('clearlog')} title="Wipe the dice log for everybody">Clear log</SureButton>}
      </div>
      <div className="dnd-log">
        {log.map((e) => (
          <div key={e.id} className={`dnd-roll ${e.flag}${e.secret ? ' secret' : ''}${e.tower ? ' tower' : ''}`}>
            <b style={{ color: colorOf(e.by) }}>{nameOf(e.by)}</b>{e.label && <span className="lbl">{e.label}</span>}{e.secret && <span className="lbl">secret</span>}{e.tower && <span className="lbl">down the tower</span>}
            <span className="tot">{e.total}</span>
            <small>{e.detail}{e.flag === 'crit' ? ' · natural 20!' : e.flag === 'fumble' ? ' · natural 1' : ''}</small>
          </div>
        ))}
        <div ref={end} />
      </div>
    </div>
  );
}

// ── initiative (./dnd/tracker.tsx; the same tracker opens large from the board on the room's wall) ──
function Initiative() {
  const st = useDnd((s) => s.st);
  const me = useStore((s) => s.me?.id ?? '');
  if (!st) return null;
  return <Tracker st={st} api={trackerApi(me)} />;
}

// ── character sheets ──
function Sheets() {
  const sheets = useDnd((s) => s.sheets);
  const open = useDnd((s) => s.sheet);
  const me = useStore((s) => s.me?.id ?? '');
  const list = Object.values(sheets).sort((a, b) => (a.owner === me ? 0 : 1) - (b.owner === me ? 0 : 1) || a.name.localeCompare(b.name));
  const sheet = open ? sheets[open] : null;
  return (
    <div className="dnd-sheets">
      <div className="row">
        <select value={open} onChange={(e) => useDnd.setState({ sheet: e.target.value })}>
          <option value="">Choose a character…</option>
          {list.map((s) => <option key={s.id} value={s.id}>{s.name} ({nameOf(s.owner)})</option>)}
        </select>
        <button onClick={() => { act('sheet', { sheet: { ...blankSheet(), name: `${nameOf(me)}'s character` } }); toast('A new sheet: choose it from the list.'); }}>New sheet</button>
      </div>
      {sheet ? <SheetView key={sheet.id} sheet={{ ...blankSheet(), ...sheet }} /> : <p className="muted">Each sheet is its owner's to fill in (and the DM's). Anything with a + or − beside it can be clicked to roll.</p>}
    </div>
  );
}

function SheetView({ sheet: given }: { sheet: Sheet }) {
  const can = mayEdit(given.owner);
  const [s, setS] = useState(given);
  useEffect(() => setS(given), [given]);
  const timer = useRef(0);
  const put = (patch: Partial<Sheet>) => {
    const next = { ...s, ...patch };
    setS(next);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => act('sheet', { sheet: next }), 500);     // (saved half a second after the last change)
  };
  const pb = prof(s.level);
  const abMod = (a: Ab) => mod(s.abilities[a] ?? 10);
  const skill = (n: string, a: Ab) => abMod(a) + pb * (s.skills[n] ?? 0);
  const save = (a: Ab) => abMod(a) + (s.saves.includes(a) ? pb : 0);
  const spellMod = s.spellAbility ? abMod(s.spellAbility) : 0;
  const R = ({ n, label, children }: { n: number; label: string; children?: ReactNode }) => (
    <button className="dnd-r" onClick={() => roll(`1d20${signed(n)}`, `${s.name}: ${label}`)} title={`Roll ${label}`}>{children ?? signed(n)}</button>
  );
  const num = (v: number, set: (n: number) => void, w = 44) => <input type="number" value={v} disabled={!can} style={{ width: w }} onChange={(e) => set(Number(e.target.value))} />;
  const txt = (v: string, set: (t: string) => void, ph = '') => <input value={v} disabled={!can} placeholder={ph} onChange={(e) => set(e.target.value)} />;
  const pic = async (file: File) => { try { const f = await upload(file, 'attachment'); if (f.mime.startsWith('image/')) put({ img: f.url }); } catch (e) { toast((e as Error).message); } };
  const passive = 10 + skill('Perception', 'wis');
  return (
    <div className="dnd-sheet">
      <div className="top">
        {s.img ? <img src={s.img} alt="" /> : <div className="noimg">{s.name.slice(0, 1)}</div>}
        <div className="who">
          <input className="name" value={s.name} disabled={!can} onChange={(e) => put({ name: e.target.value })} />
          <div className="line">
            {txt(s.race, (v) => put({ race: v }), 'Race')} {txt(s.cls, (v) => put({ cls: v }), 'Class')}
            <label>Level {num(s.level, (v) => put({ level: Math.max(1, Math.min(20, v)) }), 40)}</label>
            {txt(s.background, (v) => put({ background: v }), 'Background')} {txt(s.alignment, (v) => put({ alignment: v }), 'Alignment')}
          </div>
          <div className="line">
            <span>Proficiency {signed(pb)}</span><span>Passive Perception {passive}</span>
            {can && <label className="dnd-btn">Picture<input type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void pic(f); }} /></label>}
            {can && <button className="danger" onClick={() => act('unsheet', { id: s.id })}>Delete sheet</button>}
          </div>
        </div>
      </div>
      <div className="vitals">
        <label>AC {num(s.ac, (v) => put({ ac: v }))}</label>
        <label>Speed {num(s.speed, (v) => put({ speed: v }))}</label>
        <label>HP {num(s.hp, (v) => put({ hp: v }))} / {num(s.maxHp, (v) => put({ maxHp: v }))}</label>
        <label>Temp {num(s.tempHp, (v) => put({ tempHp: v }))}</label>
        <label>Hit dice {txt(s.hitDice, (v) => put({ hitDice: v }))}</label>
        <span>Initiative <R n={abMod('dex')} label="initiative" /></span>
        <button onClick={() => act('init', { act: 'add', name: s.name, sheet: s.id, roll: true, bonus: abMod('dex'), hp: s.hp, maxHp: s.maxHp })}>Into initiative</button>
      </div>
      <div className="cols">
        <div className="abilities">
          {ABILITIES.map((a) => (
            <div key={a} className="ab">
              <small>{AB_NAME[a]}</small>
              <R n={abMod(a)} label={`${AB_NAME[a]} check`} />
              {num(s.abilities[a], (v) => put({ abilities: { ...s.abilities, [a]: Math.max(1, Math.min(30, v)) } }), 46)}
              <label className="sv" title="Proficient in this saving throw"><input type="checkbox" disabled={!can} checked={s.saves.includes(a)} onChange={(e) => put({ saves: e.target.checked ? [...s.saves, a] : s.saves.filter((x) => x !== a) })} />save <R n={save(a)} label={`${AB_NAME[a]} save`} /></label>
            </div>
          ))}
        </div>
        <div className="skills">
          {SKILLS.map(([n, a]) => (
            <div key={n} className="sk">
              <button className={`pr p${s.skills[n] ?? 0}`} disabled={!can} title="None, proficient, expertise" onClick={() => put({ skills: { ...s.skills, [n]: ((s.skills[n] ?? 0) + 1) % 3 } })}>{['○', '●', '◆'][s.skills[n] ?? 0]}</button>
              <R n={skill(n, a)} label={n} />
              <span>{n} <small>({a})</small></span>
            </div>
          ))}
        </div>
      </div>
      <h4>Attacks</h4>
      {s.attacks.map((x, k) => (
        <div key={k} className="atk">
          {txt(x.name, (v) => put({ attacks: s.attacks.map((q, i) => (i === k ? { ...q, name: v } : q)) }), 'Weapon or spell')}
          <label>to hit {num(x.bonus, (v) => put({ attacks: s.attacks.map((q, i) => (i === k ? { ...q, bonus: v } : q)) }))}</label>
          {txt(x.damage, (v) => put({ attacks: s.attacks.map((q, i) => (i === k ? { ...q, damage: v } : q)) }), '1d8+3')}
          <button onClick={() => roll(`1d20${signed(x.bonus)}`, `${s.name}: ${x.name || 'attack'}`)}>Attack</button>
          <button onClick={() => x.damage && roll(x.damage, `${s.name}: ${x.name || 'attack'} damage`)}>Damage</button>
          {can && <button onClick={() => put({ attacks: s.attacks.filter((_, i) => i !== k) })}>✕</button>}
        </div>
      ))}
      {can && <button onClick={() => put({ attacks: [...s.attacks, { name: '', bonus: pb + abMod('str'), damage: `1d8${signed(abMod('str'))}` }] })}>+ Attack</button>}
      <h4>Spellcasting</h4>
      <div className="line">
        <label>Ability <select disabled={!can} value={s.spellAbility} onChange={(e) => put({ spellAbility: e.target.value as Sheet['spellAbility'] })}><option value="">none</option>{ABILITIES.map((a) => <option key={a} value={a}>{AB_NAME[a]}</option>)}</select></label>
        {s.spellAbility && <><span>Save DC {8 + pb + spellMod}</span><span>Spell attack <R n={pb + spellMod} label="spell attack" /></span></>}
      </div>
      {s.spellAbility && (
        <div className="slots">
          {s.slots.map((n, k) => (
            <div key={k} className="slot">
              <small>{k + 1}</small>
              {num(n, (v) => put({ slots: s.slots.map((q, i) => (i === k ? Math.max(0, Math.min(9, v)) : q)) }), 36)}
              <div className="pips">{Array.from({ length: n }, (_, i) => <i key={i} className={i < (s.used[k] ?? 0) ? 'used' : ''} onClick={() => can && put({ used: s.used.map((q, j) => (j === k ? (i < q ? i : i + 1) : q)) })} />)}</div>
            </div>
          ))}
          {can && <button onClick={() => put({ used: Array(9).fill(0) })}>Long rest</button>}
        </div>
      )}
      <textarea disabled={!can} value={s.spells} placeholder="Spells known or prepared…" onChange={(e) => put({ spells: e.target.value })} />
      <h4>Features and traits</h4>
      <textarea disabled={!can} value={s.features} onChange={(e) => put({ features: e.target.value })} />
      <h4>Inventory</h4>
      <div className="line">{(['cp', 'sp', 'ep', 'gp', 'pp'] as const).map((c) => <label key={c}>{c.toUpperCase()} {num(s.coins[c], (v) => put({ coins: { ...s.coins, [c]: v } }), 56)}</label>)}</div>
      <textarea disabled={!can} value={s.inventory} onChange={(e) => put({ inventory: e.target.value })} />
      <h4>Notes</h4>
      <textarea disabled={!can} value={s.notes} onChange={(e) => put({ notes: e.target.value })} />
    </div>
  );
}

export const says = (seat: number) => (seat === 5 ? 'The DM\'s chair' : 'Take a seat at the table');
