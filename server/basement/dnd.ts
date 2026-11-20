// The DnD room's tabletop (scripts/basement/dnd.py draws the room; client/src/basement/dnd.tsx is the page, a panel beside
// the room). Everything a table needs, kept here so everybody sees the same and it survives restarts:
//
//   the DM        one person can take the DM's chair. With a DM, players move and edit only their own tokens and sheets,
//                 and only the DM sees hidden tokens and private rolls; with nobody in the chair, anybody can do anything.
//   the map       a picture (one of the room's own battle maps, or anybody's upload), squares across, and a grid on it.
//   tokens        on the map, in squares: a name, a picture or a colour, a size, hit points, hidden or not, an owner.
//   dice          any expression ("2d6+3", "d20", "4d6kh3", "d%"), rolled here, fairly, into the log everybody reads; a
//                 roll can go through the dice tower on the table (`tower` on the entry: the room shows it tumbling).
//   initiative    the order of play, the round, whose turn, and hit points for the ones without a token. The room hangs it
//                 on the wall as a board. The DM runs it: adds and takes out, sets or rolls the numbers, moves the turn on;
//                 a player may put their own character in, roll or set its number, and end their own turn.
//   ink           the map, drawn on live: a sketch for each map (./dnd/ink.ts).
//   sheets        character sheets, each its owner's (the page knows their shape; here they are kept as they come).
//   rulers, pings passed straight on to everybody, not kept.
//
// Messages go out as { op: 'st' } (the table: DM, map, tokens, initiative, the map library), { op: 'log' } (a roll),
// { op: 'sheet' } / { op: 'unsheet' }, { op: 'ink' }, { op: 'measure' } and { op: 'ping' }; hello() has all of it.
//
// Backed up, apart from the database: every change to the table, the log or a sheet is written (a moment later) to
// data/backups/dnd/latest.json, with a dated copy at most every ten minutes (the last 200 kept), and every upload the
// table uses (a map, a token's picture, anything a sheet points at) is copied to data/backups/dnd/files with its record.
// A database that has lost the table (a fresh one, a bad copy) is filled from latest.json when the server starts, and
// an upload gone from data/uploads is put back from its copy.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA, UPLOADS } from '../config.ts';
import { get, run } from '../db.ts';
import type { FitGame, FitOut } from '../floor.ts';
import { achieve } from '../achievements.ts';
import { cleanInk, inkMessage, type Ink } from './dnd/ink.ts';

type Token = { id: string; name: string; img: string; color: string; x: number; y: number; size: number; hp: number; maxHp: number; ac: number; hidden: boolean; owner: string; sheet: string };
/** owner: whose it is ('' for the DM's own monsters); bonus: added to a d20 when it is rolled; foe: a monster or an NPC
 *  (added by name), as against a character (a token or a sheet); hidden: players see it only as "???". */
type Init = { id: string; name: string; init: number; token: string; hp: number; maxHp: number; owner?: string; bonus?: number; foe?: boolean; hidden?: boolean };
type Map = { url: string; name: string; cols: number };
/** inkAll: the DM lets the players draw on the map too. */
type St = { dm: string; map: Map | null; tokens: Token[]; init: { round: number; turn: number; list: Init[] }; maps: Map[]; inkAll?: boolean };
type Entry = { id: string; by: string; label: string; expr: string; detail: string; total: number; at: number; flag: '' | 'crit' | 'fumble'; secret: boolean; tower?: boolean };
type Sheet = Record<string, unknown> & { id: string; owner: string; name: string };

const BUILT_IN: Map[] = [
  { url: '/basement/dnd/map-tavern.png', name: 'The tavern', cols: 32 },
  { url: '/basement/dnd/map-dungeon.png', name: 'The dungeon', cols: 32 },
  { url: '/basement/dnd/map-forest.png', name: 'The forest road', cols: 32 },
];
const URL_OK = (u: unknown): u is string => typeof u === 'string' && (/^\/files\/[\w-]{1,40}$/.test(u) || BUILT_IN.some((m) => m.url === u));
const COLOR = (c: unknown) => (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c : '#8a8a8a');
const TXT = (s: unknown, n: number) => (typeof s === 'string' ? s.replace(/[\x00-\x1f]/g, ' ').slice(0, n) : '');
const NUM = (v: unknown, lo: number, hi: number, d = 0) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
const id = () => crypto.randomBytes(6).toString('base64url');
/** A sheet by its id: only the table's own (sheets['__proto__'] is "there" in any object, and had let a page past the
 *  60-sheet limit with as many sheets as it liked). */
const sheetOf = (sid: unknown) => (typeof sid === 'string' && Object.hasOwn(sheets, sid) ? sheets[sid] : undefined);

let out: FitOut;
let st: St = { dm: '', map: BUILT_IN[0], tokens: [], init: { round: 1, turn: 0, list: [] }, maps: [...BUILT_IN] };
let log: Entry[] = [];
let sheets: Record<string, Sheet> = {};
let ink: Ink = {};
let inkTimer: NodeJS.Timeout | undefined;
const saveInk = () => { clearTimeout(inkTimer); inkTimer = setTimeout(() => { out.save('ink', ink); backup(); }, 1500); inkTimer.unref?.(); };

const saveSt = () => { out.save('st', st); backup(); };
const pushSt = () => { saveSt(); out.all({ op: 'st', st }); };
/** May `uid` change this thing (owned by `owner`)? */
const may = (uid: string, owner = '') => !st.dm || st.dm === uid || (!!owner && owner === uid);

// ── dice ──
const RNG = () => crypto.randomInt(0, 2 ** 31) / 2 ** 31;
const die = (sides: number) => 1 + Math.floor(RNG() * sides);
/** Rolls a dice expression. Terms are added or taken away: NdM, NdMkhK / NdMklK (keep the highest or lowest K), d% and
 *  plain numbers. Returns null for anything it cannot read, or too many dice. */
export function rollExpr(expr: string): { total: number; detail: string; natural: number | null } | null {
  const src = expr.replace(/\s+/g, '').toLowerCase().replace(/d%/g, 'd100');
  if (!src || src.length > 60 || !/^[-+]?(\d*d\d+(k[hl]\d+)?|\d+)([-+](\d*d\d+(k[hl]\d+)?|\d+))*$/.test(src)) return null;
  let total = 0, count = 0, natural: number | null = null;
  const bits: string[] = [];
  for (const m of src.matchAll(/([-+]?)(?:(\d*)d(\d+)(?:k([hl])(\d+))?|(\d+))/g)) {
    const sign = m[1] === '-' ? -1 : 1;
    if (m[6] !== undefined) { total += sign * Number(m[6]); bits.push(`${sign < 0 ? '- ' : bits.length ? '+ ' : ''}${m[6]}`); continue; }
    const n = m[2] === '' ? 1 : Number(m[2]), sides = Number(m[3]);
    if (n < 1 || n > 100 || sides < 2 || sides > 1000 || (count += n) > 100) return null;
    const rolls = Array.from({ length: n }, () => die(sides));
    let kept = rolls.map(() => true);
    if (m[4]) {
      const k = Math.min(n, Number(m[5])), order = rolls.map((v, i) => [v, i]).sort((a, b) => (m[4] === 'h' ? b[0] - a[0] : a[0] - b[0]));
      kept = rolls.map(() => false);
      for (const [, i] of order.slice(0, k)) kept[i] = true;
    }
    const sum = rolls.reduce((a, v, i) => a + (kept[i] ? v : 0), 0);
    total += sign * sum;
    if (sides === 20 && kept.filter(Boolean).length === 1) natural = rolls[kept.indexOf(true)];
    bits.push(`${sign < 0 ? '- ' : bits.length ? '+ ' : ''}${n}d${sides}${m[4] ? `k${m[4]}${m[5]}` : ''} [${rolls.map((v, i) => (kept[i] ? String(v) : `~${v}~`)).join(', ')}]`);
  }
  return { total, detail: bits.join(' '), natural };
}

function message(uid: string, msg: Record<string, unknown>) {
  // (`id` on the wire is the fit-out's own, 'dnd': a token's, sheet's or row's id comes as `oid`, and is `id` here)
  const d: Record<string, unknown> = { ...msg, id: msg.oid };
  const isDm = st.dm === uid;
  switch (d.op) {
    case 'dm': {                                                 // take the DM's chair, or leave it
      if (d.take && !st.dm) st.dm = uid;
      else if (!d.take && isDm) st.dm = '';
      else return;
      return pushSt();
    }
    case 'map': {                                                // put a map on the table (and keep it in the library)
      if (!may(uid)) return;
      if (d.url === null) { st.map = null; return pushSt(); }
      if (!URL_OK(d.url)) return;
      const map = { url: d.url, name: TXT(d.name, 60) || 'Map', cols: NUM(d.cols, 4, 120, 30) };
      st.map = map;
      st.maps = [map, ...st.maps.filter((m) => m.url !== map.url)].slice(0, 30);
      // (a map that has dropped off the end of the library takes its drawing with it, as one taken out does: else every
      // map ever put up kept its sketch, saved whole on every stroke)
      const dropped = Object.keys(ink).filter((k) => k && !st.maps.some((m) => m.url === k));
      if (dropped.length) { keepCopy(); for (const k of dropped) delete ink[k]; saveInk(); }
      return pushSt();
    }
    case 'unmap': {                                              // take a map out of the library
      if (!may(uid) || typeof d.url !== 'string') return;
      keepCopy();
      st.maps = st.maps.filter((m) => m.url !== d.url);
      if (ink[d.url] && st.map?.url !== d.url) { delete ink[d.url]; saveInk(); }     // (its drawing goes with it)
      return pushSt();
    }
    case 'token': {                                              // add a token, or change one
      const t = d.token as Partial<Token> | undefined;
      if (!t || typeof t !== 'object') return;
      const was = st.tokens.find((x) => x.id === t.id);
      if (was && !may(uid, was.owner)) return;
      if (!was && st.tokens.length >= 200) return;
      const next: Token = {
        id: was?.id ?? id(), name: TXT(t.name, 40) || 'Token', img: URL_OK(t.img) ? t.img : '', color: COLOR(t.color),
        x: Math.round(NUM(t.x, -10, 200)), y: Math.round(NUM(t.y, -10, 200)), size: Math.round(NUM(t.size, 1, 4, 1)),
        hp: Math.round(NUM(t.hp, -999, 9999)), maxHp: Math.round(NUM(t.maxHp, 0, 9999)), ac: Math.round(NUM(t.ac, 0, 50)),
        // (an owner is somebody's id: kept to that length, as it is saved and sent with the table on every change)
        hidden: !!t.hidden && (isDm || !st.dm), owner: was ? (isDm && typeof t.owner === 'string' ? TXT(t.owner, 40) : was.owner) : (typeof t.owner === 'string' && (isDm || !st.dm) ? TXT(t.owner, 40) : uid),
        sheet: typeof t.sheet === 'string' && (t.sheet === '' || sheetOf(t.sheet)) ? t.sheet : was?.sheet ?? '',
      };
      if (was) Object.assign(was, next); else st.tokens.push(next);
      return pushSt();
    }
    case 'move': {
      const t = st.tokens.find((x) => x.id === d.id);
      if (!t || !may(uid, t.owner)) return;
      t.x = Math.round(NUM(d.x, -10, 200, t.x)); t.y = Math.round(NUM(d.y, -10, 200, t.y));
      return pushSt();
    }
    case 'untoken': {
      const t = st.tokens.find((x) => x.id === d.id);
      if (!t || !may(uid, t.owner)) return;
      st.tokens = st.tokens.filter((x) => x !== t);
      st.init.list = st.init.list.filter((x) => x.token !== t.id);
      return pushSt();
    }
    case 'roll': {                                               // dice, into the log (a secret roll: for the roller and the DM only)
      const r = rollExpr(TXT(d.expr, 60));
      if (!r) return out.to(uid, { op: 'bad', text: `Can't roll "${TXT(d.expr, 30)}". Try 1d20+5, 2d6, 4d6kh3 or d%.` });
      const entry: Entry = { id: id(), by: uid, label: TXT(d.label, 60), expr: TXT(d.expr, 60), detail: r.detail, total: r.total, at: Date.now(), flag: r.natural === 20 ? 'crit' : r.natural === 1 ? 'fumble' : '', secret: !!d.secret, tower: !!d.tower };
      if (entry.flag) achieve.award(uid, entry.flag === 'crit' ? 'nat20' : 'nat1');
      if (entry.secret) {
        out.to(uid, { op: 'log', entry });
        if (st.dm && st.dm !== uid) out.to(st.dm, { op: 'log', entry });
        return;
      }
      log = [...log, entry].slice(-120);
      out.save('log', log); backup();
      return out.all({ op: 'log', entry });
    }
    case 'clearlog': {                                           // anybody may wipe the dice log (a dated copy is kept first)
      if (!log.length) return;
      keepCopy();
      log = [];
      out.save('log', log); backup();
      return out.all({ op: 'clearlog' });
    }
    case 'init': {                                               // the initiative tracker (the board on the wall)
      const I = st.init;
      const act = d.act, boss = may(uid);
      const mine = (e: Init) => boss || (!!e.owner && e.owner === uid);
      const resort = () => { const cur = I.list[I.turn]?.id; I.list.sort((a, b) => b.init - a.init || (b.bonus ?? 0) - (a.bonus ?? 0)); I.turn = Math.max(0, I.list.findIndex((x) => x.id === cur)); };
      /** d20 plus their bonus, rolled into the log for everybody (a hidden one: for the DM only), and their number. */
      const rollFor = (name: string, expr: string, hidden: boolean): number | null => {
        const r = rollExpr(expr);
        if (!r) return null;
        const entry: Entry = { id: id(), by: uid, label: `${name}: initiative`, expr, detail: r.detail, total: r.total, at: Date.now(), flag: r.natural === 20 ? 'crit' : r.natural === 1 ? 'fumble' : '', secret: hidden };
        if (hidden) { out.to(uid, { op: 'log', entry }); if (st.dm && st.dm !== uid) out.to(st.dm, { op: 'log', entry }); return r.total; }
        log = [...log, entry].slice(-120);
        out.save('log', log); backup();
        out.all({ op: 'log', entry });
        return r.total;
      };
      if (act === 'add') {
        const tok = st.tokens.find((x) => x.id === d.token);
        const sheet = sheetOf(d.sheet);
        if (tok && !may(uid, tok.owner)) return;                   // (a player puts in only their own)
        if (sheet && !may(uid, sheet.owner)) return;
        const name = TXT(d.name, 40) || tok?.name || sheet?.name || 'Creature';
        const bonus = Math.round(NUM(d.bonus, -20, 30, 0));
        const foe = boss && !tok && !sheet;                           // (a player adding a name is adding themselves)
        const hidden = boss && !!st.dm && (!!d.hidden || !!tok?.hidden);
        // the same token or sheet again: its number rolled (or set) afresh, not a second row
        const again = I.list.find((x) => (tok && x.token === tok.id) || (sheet && !x.token && x.name === name && x.owner === sheet.owner));
        if (!again && I.list.length >= 40) return;
        let init = Math.round(NUM(d.init, -20, 60));
        if (d.roll) { const r = rollFor(name, `1d20${bonus >= 0 ? '+' : ''}${bonus}`, hidden); if (r === null) return; init = r; }
        if (again) { again.init = init; again.bonus = bonus; resort(); return pushSt(); }
        const owner = tok?.owner ?? sheet?.owner ?? (boss ? '' : uid);
        I.list.push({ id: id(), name, init, token: tok?.id ?? '', hp: Math.round(NUM(d.hp, -999, 9999, tok?.hp ?? 0)), maxHp: Math.round(NUM(d.maxHp, 0, 9999, tok?.maxHp ?? 0)), owner, bonus, foe, hidden });
        resort();
      } else if (act === 'set') {
        const e = I.list.find((x) => x.id === d.id);
        if (!e || !mine(e)) return;
        if (d.init !== undefined) e.init = Math.round(NUM(d.init, -20, 60, e.init));
        if (d.hp !== undefined) e.hp = Math.round(NUM(d.hp, -999, 9999, e.hp));
        if (d.maxHp !== undefined) e.maxHp = Math.round(NUM(d.maxHp, 0, 9999, e.maxHp));
        if (d.bonus !== undefined) e.bonus = Math.round(NUM(d.bonus, -20, 30, e.bonus ?? 0));
        if (d.name !== undefined) e.name = TXT(d.name, 40) || e.name;
        if (d.hidden !== undefined && boss) e.hidden = !!d.hidden && !!st.dm;
        resort();
      } else if (act === 'roll') {                                // roll one of them again: d20 plus their bonus
        const e = I.list.find((x) => x.id === d.id);
        if (!e || !mine(e)) return;
        const b = e.bonus ?? 0, r = rollFor(e.name, `1d20${b >= 0 ? '+' : ''}${b}`, !!e.hidden);
        if (r === null) return;
        e.init = r;
        resort();
      } else if (act === 'remove') {
        const k = I.list.findIndex((x) => x.id === d.id);
        if (k < 0 || !mine(I.list[k])) return;
        I.list.splice(k, 1);
        if (I.turn >= I.list.length) I.turn = 0; else if (k < I.turn) I.turn--;
      } else if (act === 'next') {                                // the DM moves it on; a player can end their own turn
        if (!I.list.length) return;
        const cur = I.list[I.turn];
        if (!boss && !(cur?.owner === uid && (typeof d.from !== 'string' || d.from === cur.id))) return;
        I.turn++;
        if (I.turn >= I.list.length) { I.turn = 0; I.round++; }
      } else if (act === 'prev') {
        if (!I.list.length || !boss) return;
        I.turn--;
        if (I.turn < 0) { I.turn = I.list.length - 1; I.round = Math.max(1, I.round - 1); }
      } else if (act === 'restart') {                             // the same order, from the top of round 1
        if (!boss) return;
        I.turn = 0; I.round = 1;
      } else if (act === 'clear') {
        if (!boss) return;
        st.init = { round: 1, turn: 0, list: [] };
      } else if (act === 'tokens') {                              // every token on the map not already in: rolled in (d20, plus Dex from a linked sheet)
        if (!boss) return;
        for (const t of st.tokens) {
          if (I.list.some((x) => x.token === t.id) || I.list.length >= 40) continue;
          const sh = sheetOf(t.sheet), bonus = Math.floor((Number((sh?.abilities as Record<string, number> | undefined)?.dex ?? 10) - 10) / 2);
          const hidden = t.hidden && !!st.dm;
          const r = rollFor(t.name, `1d20${bonus >= 0 ? '+' : ''}${bonus}`, hidden);
          I.list.push({ id: id(), name: t.name, init: r ?? die(20) + bonus, token: t.id, hp: t.hp, maxHp: t.maxHp, owner: t.owner === st.dm ? '' : t.owner, bonus, foe: t.owner === st.dm || t.owner === '', hidden });
        }
        I.list.sort((a, b) => b.init - a.init || (b.bonus ?? 0) - (a.bonus ?? 0));
        I.turn = 0;
      } else return;
      return pushSt();
    }
    case 'ink': {                                                // drawing on the map (./dnd/ink.ts)
      const boss = may(uid);
      if (d.act === 'clear' || d.act === 'mine') keepCopy();
      const said = inkMessage(ink, uid, st.map?.url ?? '', d, { draw: boss || !!st.inkAll, boss });
      if (!said) return;
      saveInk();
      return out.all({ op: 'ink', ...said });
    }
    case 'inkall': {                                             // the DM lets the players draw on the map, or stops them
      if (!st.dm || st.dm !== uid) return;
      st.inkAll = !!d.on;
      return pushSt();
    }
    case 'sheet': {                                              // a character sheet, saved (new, or one of mine)
      const s = d.sheet as Sheet | undefined;
      if (!s || typeof s !== 'object' || JSON.stringify(s).length > 40_000) return;
      const was = sheetOf(s.id);
      if (was && !may(uid, was.owner)) return;
      if (!was && Object.keys(sheets).length >= 60) return;
      const sheet: Sheet = { ...s, id: was?.id ?? id(), owner: was?.owner ?? uid, name: TXT(s.name, 60) || 'Unnamed' };
      sheets[sheet.id] = sheet;
      out.save('sheets', sheets); backup();
      return out.all({ op: 'sheet', sheet });
    }
    case 'unsheet': {
      const s = sheetOf(d.id);
      if (!s || !may(uid, s.owner)) return;
      delete sheets[s.id];
      for (const t of st.tokens) if (t.sheet === s.id) t.sheet = '';
      out.save('sheets', sheets); backup();
      out.all({ op: 'unsheet', oid: s.id });
      return pushSt();
    }
    case 'measure':                                              // a ruler being drawn (squares), or put away
      return out.all({ op: 'measure', by: uid, a: Array.isArray(d.a) ? (d.a as number[]).slice(0, 2).map((v) => NUM(v, -50, 300)) : null, b: Array.isArray(d.b) ? (d.b as number[]).slice(0, 2).map((v) => NUM(v, -50, 300)) : null });
    case 'ping':
      return out.all({ op: 'ping', by: uid, x: NUM(d.x, -50, 300), y: NUM(d.y, -50, 300) });
  }
}

// ── the backup ──
const BACKUP = path.join(DATA, 'backups', 'dnd'), FILES = path.join(BACKUP, 'files');
const KEEP = 200, DATED_EVERY = 10 * 60_000;
let backupTimer: NodeJS.Timeout | undefined, lastDated = 0;
/** The uploads the table uses, by id: whatever /files/<id> appears anywhere in it. */
const uploadsIn = (json: string) => new Set([...json.matchAll(/\/files\/([\w-]{1,40})/g)].map((m) => m[1]));
function backup() {
  clearTimeout(backupTimer);
  backupTimer = setTimeout(writeBackup, 2000);
  backupTimer.unref?.();
}
/** A dated copy now, whenever it was last made: before anything is wiped, so it can be got back. */
function keepCopy() { lastDated = 0; writeBackup(); }
function writeBackup() {
  try {
    fs.mkdirSync(FILES, { recursive: true });
    const json = JSON.stringify({ at: Date.now(), st, log, sheets, ink });
    fs.writeFileSync(path.join(BACKUP, 'latest.json.tmp'), json);
    fs.renameSync(path.join(BACKUP, 'latest.json.tmp'), path.join(BACKUP, 'latest.json'));      // (never half written)
    if (Date.now() - lastDated >= DATED_EVERY) {
      lastDated = Date.now();
      fs.writeFileSync(path.join(BACKUP, `dnd-${new Date().toISOString().replace(/[:.]/g, '-')}.json`), json);
      const dated = fs.readdirSync(BACKUP).filter((f) => /^dnd-.*\.json$/.test(f)).sort();
      for (const f of dated.slice(0, Math.max(0, dated.length - KEEP))) fs.rmSync(path.join(BACKUP, f), { force: true });
    }
    for (const fid of uploadsIn(json)) {
      const copy = path.join(FILES, fid), from = path.join(UPLOADS, fid);
      if (fs.existsSync(copy) || !fs.existsSync(from)) continue;
      fs.copyFileSync(from, copy);
      const row = get('SELECT * FROM files WHERE id = ?', fid);
      if (row) fs.writeFileSync(`${copy}.json`, JSON.stringify(row));
    }
  } catch (e) { console.error('[dnd] backup:', e); }
}
/** At start: the table from the backup if the database has none, and any upload it uses put back if it has gone. */
function restore(o: FitOut) {
  try {
    const file = path.join(BACKUP, 'latest.json');
    if (!fs.existsSync(file)) return;
    const b = JSON.parse(fs.readFileSync(file, 'utf8')) as { st: St; log: Entry[]; sheets: Record<string, Sheet>; ink?: Ink };
    if (o.load<St | null>('st', null) === null && b.st) {
      o.save('st', b.st); o.save('log', b.log ?? []); o.save('sheets', b.sheets ?? {}); o.save('ink', b.ink ?? {});
      console.log('[dnd] the table was not in the database: restored from data/backups/dnd/latest.json');
    } else if (o.load<Ink | null>('ink', null) === null && b.ink) o.save('ink', b.ink);       // (a table saved before the map could be drawn on)
    for (const fid of uploadsIn(JSON.stringify([o.load('st', null), o.load('sheets', null)]))) {
      const copy = path.join(FILES, fid), to = path.join(UPLOADS, fid);
      if (!fs.existsSync(copy)) continue;
      if (!fs.existsSync(to)) { fs.mkdirSync(UPLOADS, { recursive: true }); fs.copyFileSync(copy, to); console.log(`[dnd] upload ${fid} put back from the backup`); }
      if (!get('SELECT id FROM files WHERE id = ?', fid) && fs.existsSync(`${copy}.json`)) {
        const r = JSON.parse(fs.readFileSync(`${copy}.json`, 'utf8'));
        run('INSERT INTO files (id, user_id, name, mime, size, kind, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', r.id, r.user_id, r.name, r.mime, r.size, r.kind, r.created_at);
      }
    }
  } catch (e) { console.error('[dnd] restore:', e); }
}

const game: FitGame = {
  start(o) {
    out = o;
    restore(o);
    st = o.load<St>('st', st);
    for (const m of BUILT_IN) if (!st.maps.some((x) => x.url === m.url)) st.maps.push(m);
    log = o.load<Entry[]>('log', []);
    sheets = o.load<Record<string, Sheet>>('sheets', {});
    ink = cleanInk(o.load<unknown>('ink', {}));
    writeBackup();                                                // (a copy as it stands, and of any upload not copied yet)
  },
  hello: () => ({ st, log, sheets, ink }),
  message,
};
export default game;
