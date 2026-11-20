// The campfire, outside (scripts/basement/outside.py draws the campsite; client/src/basement/outside.tsx is the page).
//
// One fire for everybody. It has fuel, in seconds of burning: each log from the woodpile is LOG_S of it, and the ring
// holds MAX_LOGS. Lit, it burns down; when the fuel runs out it goes out, and its embers glow for EMBER_MS. A log put on
// glowing embers catches by itself; on cold ash it only lies there until somebody lights it (and lighting an empty
// ring does nothing: wood first). It keeps burning, or stays out, when the server restarts: it is saved, and there is
// no reset() (that would make it start fresh on every restart and be put away when left), so a fire left burning
// while the server was down has burnt that much lower.
//
// Marshmallows: anybody sat in one of the seats round the fire (LAYOUT.things.ring) while it burns can hold one over it on
// a stick ('roast'). It toasts at the rate the fire is burning at (a big fire is quicker, so harder to time): white, then
// golden, then brown, then it catches and goes black. 'pull' takes it out, and what it was is said for everybody;
// held too long, it drops off into the fire. Golden ones are counted, for good.
import { LAYOUT } from '../../client/src/basement/outside.gen.ts';
import { BURN, DROP, EMBER_MS, fuelLeft, GOLD, LOG_S, MAX_LOGS, toasted as toastedAt } from '../../client/src/basement/campfire.ts';
import type { Ate, Camp as State, Fire, Roast } from '../../client/src/basement/campfire.ts';
import type { FitGame, FitOut } from '../floor.ts';
import { achieve } from '../achievements.ts';

const RING = new Set<number>(LAYOUT.things.ring as number[]);
let out: FitOut;
let fire: Fire = { fuel: 3 * LOG_S, lit: true, at: Date.now(), outAt: 0, litAt: Date.now() };
let roast: Record<string, Roast> = {};
let ate: Record<string, Ate> = {};
let toss: State['toss'] = null;
let tally: Record<string, number> = {};
let last = '', lastAt = 0;
let radio = false;                                       // the radio by the fire: on or off, for everybody (kept)
const tossed = new Map<string, number>();                // (a log each, every so often: no piling the whole woodpile on at once)

/** Seconds of fuel left just now. */
const left = (now = Date.now()) => fuelLeft(fire, now);
/** Fuel counted from now on, so a change starts from where it stands. */
const rebase = (now: number) => { fire.fuel = left(now); fire.at = now; };
const burning = (now = Date.now()) => fire.lit && left(now) > 0;
/** How hot the fire is, for toasting: 0.8 for a few embers' worth to 1.4 for a full ring. */
const heat = (now = Date.now()) => 0.8 + 0.6 * Math.min(1, left(now) / (MAX_LOGS * LOG_S));
const toasted = (r: Roast, now = Date.now()) => toastedAt(r, now);

function verdict(d: number): string {
  if (d < 2) return 'barely warmed one through';
  if (d < GOLD[0]) return 'pulled out a pale one, lightly toasted';
  if (d < GOLD[1]) return 'toasted a perfect golden marshmallow';
  if (d < BURN) return 'made a nice dark brown one';
  if (d < 11.5) return 'set one alight, blew it out and ate it charred';
  return 'ate a marshmallow burnt to a crisp';
}

function state(): State {
  const now = Date.now();
  for (const [id, a] of Object.entries(ate)) if (now - a.at > 8000) delete ate[id];
  return { fire: { ...fire }, roast, ate, toss, last, lastAt, tally, now, radio };
}
const tell = () => { out.save('fire', fire); out.all({ state: state() }); };
const say = (s: string) => { last = s; lastAt = Date.now(); };

function message(uid: string, d: Record<string, unknown>) {
  const now = Date.now();
  if (!out.present().includes(uid)) return;              // (only somebody out here, online)
  const who = out.nameOf(uid);
  switch (d.op) {
    case 'wood': {                                        // a log from the woodpile, onto the fire
      if (now - (tossed.get(uid) ?? 0) < 1500) return;
      rebase(now);
      if (fire.fuel > (MAX_LOGS - 1) * LOG_S + 5) { out.to(uid, { op: 'note', text: 'The fire is as full as it will go.' }); return; }
      tossed.set(uid, now);
      fire.fuel += LOG_S;
      toss = { who: uid, at: now };
      if (!fire.lit && fire.outAt && now - fire.outAt < EMBER_MS) { fire.lit = true; fire.litAt = now; say(`${who} put a log on the embers, and it caught`); }
      else say(fire.lit ? `${who} put a log on the fire` : `${who} laid a log in the cold fire`);
      return tell();
    }
    case 'light': {
      if (fire.lit && left(now) > 0) return;
      rebase(now);
      if (fire.fuel <= 0) { out.to(uid, { op: 'note', text: 'Put some wood on first.' }); return; }
      fire.lit = true; fire.litAt = now; fire.at = now;
      say(`${who} lit the fire`);
      return tell();
    }
    case 'roast': {                                       // a marshmallow on a stick, over the fire
      const seat = Number(d.seat);
      if (!RING.has(seat) || roast[uid] || !burning(now)) return;
      if (Object.values(roast).some((r) => r.seat === seat)) return;
      roast[uid] = { seat, t0: now, rate: heat(now) };
      delete ate[uid];
      return tell();
    }
    case 'radio': {                                       // the radio, on or off
      radio = !radio;
      out.save('radio', radio);
      say(`${who} turned the radio ${radio ? 'on' : 'off'}`);
      return tell();
    }
    case 'pull': {                                        // out of the fire, and eaten
      const r = roast[uid];
      if (!r) return;
      const done = toasted(r, now);
      delete roast[uid];
      const what = verdict(done);
      ate[uid] = { seat: r.seat, what, at: now, d: Math.round(done * 10) / 10 };
      if (done >= GOLD[0] && done < GOLD[1]) { tally[uid] = (tally[uid] ?? 0) + 1; out.save('tally', tally); achieve.count(uid, 'golden'); }
      say(`${who} ${what}`);
      return tell();
    }
  }
}

/** Every second: the fire going out when its fuel does, marshmallows held too long dropping off, and anybody who has
 *  gone (indoors, or offline) taking their stick with them. */
function tick() {
  const now = Date.now();
  let changed = false;
  if (fire.lit && left(now) <= 0) {
    fire.outAt = fire.at + fire.fuel * 1000;
    fire.fuel = 0; fire.lit = false; fire.at = now;
    for (const id of Object.keys(roast)) delete roast[id];
    say('The fire has gone out');
    changed = true;
  }
  const here = new Set(out.present());
  for (const [id, r] of Object.entries(roast)) {
    if (!here.has(id)) { delete roast[id]; changed = true; continue; }
    if (toasted(r, now) >= DROP) {
      delete roast[id];
      ate[id] = { seat: r.seat, what: 'dropped one in the fire', at: now, d: DROP };
      achieve.award(id, 'burnt');
      say(`${out.nameOf(id)}'s marshmallow dropped off into the fire`);
      changed = true;
    }
  }
  if (changed) tell();
}

const game: FitGame = {
  start(o) {
    out = o;
    fire = { ...fire, ...o.load<Partial<Fire>>('fire', {}) };
    tally = o.load<Record<string, number>>('tally', {});
    radio = o.load<boolean>('radio', false);
    setInterval(tick, 1000).unref?.();
  },
  hello: () => state(),
  message,
};
export default game;
