// The backyard (scripts/basement/backyard.py draws it; client/src/basement/backyard.tsx is the page, and the lawn's
// workings are client/src/basement/lawn.ts, shared with it).
//
// What is kept here, for everybody:
//   the lawn: when each patch was last mown and which way (saved, so it is as it was after a restart: the grass goes on
//     growing back while the server is down, since it is all worked out from the time). It is only a look: nothing else
//     out here reads it;
//   the mower: who is pushing it (one at a time), its engine on or off, and where it was left;
//   what everybody out here has off the smoking table: a cigarette, a cigar, a corncob or a calabash pipe, bubbles, a mini
//     fan (until put down, or it burns out, or they go in);
//   the hot tub's jets and the radio, on or off for everybody (kept);
//   a dive off the board, for everybody to see.
import { LAYOUT } from '../../client/src/basement/backyard.gen.ts';
import { DIRS, mow, newLawn, pack, rebase, unitNow, unpack } from '../../client/src/basement/lawn.ts';
import type { Lawn } from '../../client/src/basement/lawn.ts';
import type { FitGame, FitOut } from '../floor.ts';
import { achieve } from '../achievements.ts';

const T = LAYOUT.things as Record<string, any>;
const [HX, HY] = T.mowerHome as [number, number, string];
const SMOKES: Record<string, { ms: number; lit: string; out: string }> = {
  cig: { ms: 7 * 60_000, lit: 'lit a cigarette', out: 'stubbed out a cigarette' },
  cigar: { ms: 30 * 60_000, lit: 'lit a cigar', out: 'put down a cigar' },
  corncob: { ms: 25 * 60_000, lit: 'lit a corncob pipe', out: 'knocked out a corncob pipe' },
  calabash: { ms: 25 * 60_000, lit: 'lit a calabash pipe', out: 'put down a calabash pipe' },
  bubbles: { ms: 12 * 60_000, lit: 'is blowing bubbles', out: 'put the bubbles away' },
  fan: { ms: 30 * 60_000, lit: 'is cooling off with a mini fan', out: 'put the mini fan down' },
};
let out: FitOut;
let lawn: Lawn = newLawn();
let dirty = false;
type Mower = { by: string | null; on: boolean; x: number; y: number; face: string };
let mower: Mower = { by: null, on: false, x: HX, y: HY, face: 'down' };
let smoke: Record<string, { kind: string; at: number }> = {};
let jets = false, radio = false;
let dives: Record<string, { at: number; spin: boolean }> = {};
let last = '', lastAt = 0;

function state() {
  const now = Date.now();
  for (const [id, d] of Object.entries(dives)) if (now - d.at > 6000) delete dives[id];
  return { mower, smoke, jets, radio, dives, last, lastAt, now };
}
/** The whole lawn, only in hello (it is big): after that, cuts are sent as they happen ('mown'). */
const lawnNow = () => ({ base: lawn.base, cells: pack(lawn) });
const tell = () => out.all({ state: state() });
const say = (s: string) => { last = s; lastAt = Date.now(); };
// What everybody has off the smoking table is kept, so a restart does not take a cigar out of somebody's hand; and for a
// minute and a half after one, nobody is taken for gone (their page is still finding its way back).
const saveSmoke = () => out.save('smoke', smoke);
const STARTED = Date.now(), REJOIN_MS = 90_000;
const num = (v: unknown, lo: number, hi: number) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : lo; };

function letGo(x = mower.x, y = mower.y) {
  mower = { ...mower, by: null, on: false, x, y };
  out.save('mower', mower);
}

function message(uid: string, d: Record<string, unknown>) {
  const now = Date.now();
  if (!out.present().includes(uid)) return;              // (only somebody out here, online)
  const who = out.nameOf(uid);
  switch (d.op) {
    case 'grab': {                                       // take the mower's handle (stood at it)
      if (mower.by && mower.by !== uid && out.present().includes(mower.by)) return;      // (somebody else has it: the page shows who)
      if (mower.by === uid) return;
      mower = { ...mower, by: uid, on: false };
      say(`${who} took the mower out`);
      return tell();
    }
    case 'drop': {                                       // let go of it, where I stand
      if (mower.by !== uid) return;
      const x = num(d.x, 0, LAYOUT.w), y = num(d.y, 0, LAYOUT.h);
      letGo(x, y);
      mower.face = DIRS.includes(d.face as never) ? String(d.face) : mower.face;
      say(`${who} left the mower`);
      return tell();
    }
    case 'engine': {
      if (mower.by !== uid) return;
      mower.on = !mower.on;
      if (mower.on) say(`${who} started the mower`);
      return tell();
    }
    case 'at': {                                         // where it is, as it is pushed along: passed on, so everybody sees it driven
      if (mower.by !== uid) return;
      mower.x = num(d.x, 0, LAYOUT.w); mower.y = num(d.y, 0, LAYOUT.h);
      if (DIRS.includes(d.face as never)) mower.face = String(d.face);
      out.all({ op: 'pos', by: uid, x: mower.x, y: mower.y, face: mower.face });
      return;
    }
    case 'mow': {                                        // a stretch pushed with the engine running: cut what was under the deck
      if (mower.by !== uid || !mower.on || !Array.isArray(d.pts)) return;
      const pts = (d.pts as unknown[]).slice(0, 60).filter((p): p is number[] => Array.isArray(p) && p.length === 2)
        .map(([x, y]) => [Math.round(num(x, 0, LAYOUT.w) * 2) / 2, Math.round(num(y, 0, LAYOUT.h) * 2) / 2]);
      if (!pts.length) return;
      const face = DIRS.includes(d.face as never) ? (d.face as (typeof DIRS)[number]) : undefined;
      const unit = unitNow(now);
      if (rebase(lawn, unit)) out.all({ op: 'lawn', lawn: lawnNow() });
      achieve.mowed(uid, mow(lawn, pts, unit, face), lawn, unit);
      dirty = true;
      const [x, y] = pts[pts.length - 1];
      mower.x = x; mower.y = y;
      if (face) mower.face = face;
      out.all({ op: 'mown', pts, unit, face, by: uid });
      return;
    }
    case 'smoke': {                                      // something off the smoking table; the same again puts it down
      // (only the table's own: 'constructor' or '__proto__' is "in" any object, and had counted towards one of everything)
      const kind = String(d.kind ?? ''), known = Object.hasOwn(SMOKES, kind);
      const had = smoke[uid];
      if (had) { delete smoke[uid]; say(`${who} ${SMOKES[had.kind]?.out ?? 'put it down'}`); }
      if (known && had?.kind !== kind) { smoke[uid] = { kind, at: now }; say(`${who} ${SMOKES[kind].lit}`); achieve.note(uid, 'smokes', kind); }
      saveSmoke();
      return tell();
    }
    case 'jets': {
      jets = !jets;
      out.save('jets', jets);
      say(`${who} turned the hot tub's jets ${jets ? 'on' : 'off'}`);
      return tell();
    }
    case 'radio': {
      radio = !radio;
      out.save('radio', radio);
      say(`${who} turned the radio ${radio ? 'on' : 'off'}`);
      return tell();
    }
    case 'dive': {                                       // off the board (the page has them stood on it)
      if (dives[uid] && now - dives[uid].at < 2500) return;
      const spin = Math.random() < 0.35;
      dives[uid] = { at: now, spin };
      say(spin ? `${who} did a spin off the board` : `${who} jumped in off the board`);
      return tell();
    }
  }
}

/** Every few seconds: anybody gone (indoors, or offline) puts down what they were smoking and lets go of the mower;
 *  a cigarette burns out. The lawn is saved now and then. */
let saved = Date.now();
function tick() {
  const now = Date.now();
  const here = new Set(out.present());
  let changed = false;
  if (mower.by && !here.has(mower.by)) { letGo(); changed = true; }
  let smoked = false;
  for (const [id, s] of Object.entries(smoke)) {
    if ((!here.has(id) && now - STARTED > REJOIN_MS) || now - s.at > (SMOKES[s.kind]?.ms ?? 0)) { delete smoke[id]; changed = smoked = true; }
  }
  if (smoked) saveSmoke();
  if (changed) tell();
  if (dirty && now - saved > 15_000) { out.save('lawn', lawnNow()); dirty = false; saved = now; }
}

const game: FitGame = {
  start(o) {
    out = o;
    // (saved before the lawn was simplified, these carried a blade height too: only what is still used is taken)
    const kept = o.load<{ base: number; cells: string } | null>('lawn', null);
    if (kept && typeof kept === 'object') lawn = unpack(kept.base, kept.cells);
    const m = o.load<Record<string, unknown> | null>('mower', null) ?? {};
    mower = {
      by: null, on: false,
      x: Number.isFinite(Number(m.x)) ? Number(m.x) : HX, y: Number.isFinite(Number(m.y)) ? Number(m.y) : HY,
      face: DIRS.includes(m.face as never) ? String(m.face) : 'down',
    };
    jets = o.load<boolean>('jets', false);
    radio = o.load<boolean>('radio', false);
    const lit = o.load<Record<string, { kind?: unknown; at?: unknown }> | null>('smoke', null);
    if (lit && typeof lit === 'object') for (const [id, s] of Object.entries(lit)) {
      if (s && typeof s.kind === 'string' && Object.hasOwn(SMOKES, s.kind) && Number.isFinite(s.at)) smoke[id] = { kind: s.kind, at: s.at as number };
    }
    setInterval(tick, 3000).unref?.();
  },
  hello: () => ({ ...state(), lawn: lawnNow() }),
  message,
};
export default game;
